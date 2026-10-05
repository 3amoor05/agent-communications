import { CommsError, ensureSendEpochConfig, type LegacyDrainReport } from '@agentcomms/core';
import { openDraftStore } from '../compose/drafts.ts';
import { checkFileCount, recordFiles } from '../compose/files.ts';
import type { SlackContext } from '../context.ts';
import { requireConversation } from './destination.ts';
import { attachPolicyOf, type DraftInput, draftPayload, ownDraft } from './drafts.ts';
import { gateDepsFor } from './gate.ts';
import { NameBook } from './people.ts';
import {
  type PostedFiles,
  type PostedMessage,
  type PreparedPost,
  postPrepared,
  preparePost,
  prepareReaction,
  type ReactionOptions,
  type ReactionResult,
  reactPrepared,
} from './send.ts';
import type { SessionDeps } from './session.ts';

/**
 * Posting a prepared draft and reacting, as both surfaces do them.
 *
 * `agent-slack post send` and `slack_post_send`, `agent-slack react` and `slack_react` with `slack_react_send`: one
 * function each, so a refusal one surface makes the other makes too. Until the owner's rule of 2026-09-25 only the
 * CLI could post, and its commands held these steps inline; a second copy for the tools would have been a second
 * place for a check to go missing — which is what happened to the audit sink the one time the MCP server assembled
 * the gate for itself (see `gateDepsFor`).
 *
 * Nothing here decides whether a person has approved. That is the approval store's, under the workspace's policy as
 * it is when the claim is made: under `chat` the person's yes in the conversation is the approval and the claim goes
 * through; under `confirm` the claim waits for `agent-slack approve` at a terminal, which no tool runs; under `never`
 * it refuses. So posting from a chat is exactly as gated as posting from a shell.
 */

/**
 * What to prepare: a draft already written, or a message to write as one first.
 *
 * Exactly one. `draftId` is `agent-slack post prepare --draft`: a draft `draft create` wrote, or one whose approval
 * expired and is being shown again. The message is `draft create` and `post prepare` in one call, which is how a tool
 * does it — with its text, its files, or both. Given both a draft and a message, which one was meant is a guess, so it
 * is refused rather than made.
 */
export interface PrepareRequest {
  readonly draftId?: string | undefined;
  readonly channel?: string | undefined;
  readonly text?: string | undefined;
  readonly threadTs?: string | undefined;
  readonly mentionUsers?: readonly string[] | undefined;
  readonly broadcast?: unknown;
  /** Local files to post, by path, for a new message: see `DraftInput.files`. */
  readonly files?: readonly string[] | undefined;
}

function draftToWrite(request: PrepareRequest): DraftInput | undefined {
  const composing = [
    request.channel,
    request.text,
    request.threadTs,
    request.mentionUsers,
    request.broadcast,
    request.files,
  ].some((given) => given !== undefined);
  if (request.draftId !== undefined) {
    if (composing) {
      throw new CommsError('USAGE', 'prepare a draft already written, or a new message — not both', {
        hint: 'Pass `draftId` alone, or `channel` with `text`, `files` or both (and `threadTs`, `mentionUsers` or `broadcast`) without it.',
      });
    }
    return undefined;
  }
  if (request.channel === undefined || (request.text === undefined && (request.files ?? []).length === 0)) {
    throw new CommsError(
      'USAGE',
      'nothing to prepare: name a draft, or give the channel and the text or files of a new one',
      { hint: 'Pass `draftId` for a draft already written, or `channel` with `text`, `files` or both to write one.' },
    );
  }
  return {
    channel: request.channel,
    text: request.text,
    threadTs: request.threadTs,
    mentionUsers: request.mentionUsers,
    broadcast: request.broadcast,
    files: request.files,
  };
}

/** What became of the approvals an earlier release prepared, when the call retired them (`ensureSendEpochConfig`). */
export interface LegacyDrainNote {
  readonly legacyDrain?: LegacyDrainReport | undefined;
}

/** `result`, and the drain's report beside it when there is one. */
function noting<T extends object>(result: T, legacyDrain: LegacyDrainReport | undefined): T & LegacyDrainNote {
  return legacyDrain === undefined ? result : { ...result, legacyDrain };
}

/**
 * Prepares a post and returns the preview a person must approve: `agent-slack post prepare` and `slack_post_prepare`.
 *
 * One function, so the same draft gives the same preview from either surface and a draft written at a terminal — or
 * one whose approval ran out — can be prepared from a chat. The request is checked and a new message composed before
 * Slack is asked anything, so a bad mention is refused without opening the workspace — and so is a file that may not
 * be sent, since each one is checked and recorded here, on this machine; the draft is written only once the workspace
 * has opened, so a sign-in that has lapsed leaves no draft behind it.
 */
export async function prepareDraftPost(
  context: SlackContext,
  alias: string,
  request: PrepareRequest,
  slack: SessionDeps = {},
): Promise<PreparedPost & LegacyDrainNote> {
  const writing = draftToWrite(request);
  if (writing !== undefined) requireConversation(writing.channel, alias, context.handoffs);
  const composed = writing === undefined ? undefined : { payload: draftPayload(writing), source: writing.text ?? '' };
  const paths = writing?.files ?? [];
  checkFileCount(paths.length);
  const files = paths.length === 0 ? [] : await recordFiles(paths, await attachPolicyOf(context));
  // Before the epoch is read for the approval: version 3, and an earlier release's records retired.
  const { legacyDrain } = await ensureSendEpochConfig(context.core, { now: context.now });
  const gate = await gateDepsFor(context, alias, slack);
  const store = openDraftStore(context.core.paths.stateDir, context.now, context.handoffs);
  const draft =
    composed === undefined
      ? // Another workspace's draft is absent here: drafts share one directory, and the id alone proves nothing.
        await ownDraft(store, gate.accountId, request.draftId as string)
      : await store.create(gate.accountId, composed.payload, composed.source, files);
  return noting(await preparePost(gate, draft, new NameBook()), legacyDrain);
}

export interface SendPostInput {
  readonly draftId: string;
  readonly approvalId: string;
  /** The channel the caller believes this goes to, restated from the preview and checked against the draft. */
  readonly expectChannel: string;
  /**
   * The call's cancellation: `slack_post_send` passes the MCP request's signal, and `post send` none — Ctrl-C ends
   * the process. See `PostDeps.signal` for how far it reaches.
   */
  readonly signal?: AbortSignal | undefined;
}

/**
 * Posts one prepared draft of this workspace, once, if its approval allows it now.
 *
 * A post of text alone comes back as the message it made. A post with files comes back with their ids in Slack, and
 * the message's ts when Slack had attached them to one — `null`, and a note saying so, when it had not.
 */
export async function sendPost(
  context: SlackContext,
  alias: string,
  input: SendPostInput,
  slack: SessionDeps = {},
): Promise<(PostedMessage | PostedFiles) & LegacyDrainNote> {
  // First, as every claim does: version 3, and an earlier release's records retired.
  const { legacyDrain } = await ensureSendEpochConfig(context.core, { now: context.now });
  const gate = await gateDepsFor(context, alias, slack);
  const store = openDraftStore(context.core.paths.stateDir, context.now, context.handoffs);
  // Another workspace's draft is absent here: drafts share one directory, and the id alone proves nothing.
  const draft = await ownDraft(store, gate.accountId, input.draftId);
  return noting(
    await postPrepared({ ...gate, signal: input.signal }, draft, input.approvalId, input.expectChannel, new NameBook()),
    legacyDrain,
  );
}

/**
 * Adds or removes one reaction.
 *
 * One step under `chat`, two under `confirm` — the shape a post has. Without an approval id this makes an approval
 * and tries it at once: under `chat` that is the yes the conversation already gave, and under `confirm` the claim
 * waits, naming the approval a person has to give. With one, it claims that approval and makes none — so a retry
 * after a person approved does not mint a new approval that nobody has seen.
 */
export async function react(
  context: SlackContext,
  alias: string,
  wanted: ReactionOptions,
  approvalId: string | undefined,
  slack: SessionDeps = {},
): Promise<ReactionResult & LegacyDrainNote> {
  // First — it prepares, or claims, or both: version 3, and an earlier release's records retired.
  const { legacyDrain } = await ensureSendEpochConfig(context.core, { now: context.now });
  const gate = await gateDepsFor(context, alias, slack);
  const claiming = approvalId ?? (await prepareReaction(gate, wanted)).approvalId;
  return noting(await reactPrepared(gate, claiming, wanted), legacyDrain);
}
