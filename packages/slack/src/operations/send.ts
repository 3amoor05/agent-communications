import { setTimeout as sleep } from 'node:timers/promises';
import {
  type ApprovalRecord,
  type AttachPolicy,
  type CanonicalChannelMessage,
  type ChannelPreview,
  type ClaimOptions,
  CommsError,
  canonicalJson,
  type Expectation,
  messageDigest,
  type SendPolicy,
  sha256Hex,
  stricterPolicy,
  truncateDisplay,
} from '@agentcomms/core';
import { callSlack, type SlackCall } from '../api/call.ts';
import { spendOn, type WritePermit } from '../api/guard.ts';
import { slackFileUpload } from '../api/upload.ts';
import { type ComposedPayload, payloadOf } from '../compose/blocks.ts';
import type { SlackDraft } from '../compose/drafts.ts';
import { checkRecordedFile, rereadFile, type SlackDraftFile } from '../compose/files.ts';
import { mentionedUserIds, previewOf, urlsInWords } from '../compose/preview.ts';
import { decodeSlackText } from '../text/decode.ts';
import { requireConversation } from './destination.ts';
import { type Channel, channelOf, type NameBook } from './people.ts';

/**
 * The gate between a draft and a channel.
 *
 * The same shape as Gmail's, because it is the same problem and the Gmail one has been audited: prepare produces
 * an approval bound to exactly these bytes, the person is shown what will be posted, and posting claims the
 * approval once and spends a permit that is open for one request.
 *
 * Two things differ, and both come from Slack rather than from taste.
 *
 * **The gate has four doors, not one.** Gmail could guard sending by looking for a URL ending in `/send`. Slack
 * has four separate ways to put something in front of people, only one of which needs `chat:write` — a file share
 * carries an `initial_comment`, which is a message; a reaction notifies somebody and is attributed to them. All of
 * them are behind the permit, which is why the allowlist classifies methods rather than matching a path.
 *
 * **The reach is inside the digest.** A mail preview lists its recipients; a channel preview has to count them.
 * If the room grew between the preview and the post, the message now reaches people nobody agreed to reach, and
 * the approval is void rather than merely stale.
 */

/** What a caller restates at post time, so it cannot post something other than what it showed. */
export function expectationFor(payload: { channel: string }, notifies: { estimated: number }): Expectation {
  /*
   * Slack's shape, in the fields the approval store already has.
   *
   * `to` is where it goes and `subject` carries the reach, because those are the two facts a caller could get
   * wrong in a way that matters: the wrong room, or a far bigger room than the one it showed. Mapped rather than
   * invented so this uses the same single-claim, same-digest machinery the Gmail gate does, which has been
   * audited; a parallel implementation for chat would be a second place for the same bug to live.
   */
  return { to: [payload.channel], cc: [], bcc: [], subject: `reaches ${notifies.estimated}` };
}

export interface PreparedPost {
  readonly approvalId: string;
  readonly draftId: string;
  readonly preview: ChannelPreview;
  readonly expect: Expectation;
  readonly policy: SendPolicy;
  readonly requiredPolicy: SendPolicy;
  readonly riskFlags: readonly string[];
  readonly expiresAt: string;
}

/**
 * Where the gate writes what it did.
 *
 * Gmail records every operation; the first version of this file recorded none, so `agentcomms audit tail` showed
 * nothing at all for a Slack workspace and there was no answer to "what did it post, and when". Optional only so
 * a unit test can leave it out; every real caller passes one.
 */
export interface AuditSink {
  append(record: {
    inboxId: string;
    alias?: string;
    operation: string;
    outcome: 'ok' | 'refused' | 'failed' | 'started';
    ids?: Record<string, string | string[]>;
    approvalId?: string;
    reason?: string;
    surface?: 'cli' | 'mcp';
  }): Promise<unknown>;
}

export interface PrepareDeps {
  readonly call: SlackCall;
  readonly audit?: AuditSink | undefined;
  readonly surface?: 'cli' | 'mcp' | undefined;
  readonly accountId: string;
  readonly workspaceId: string;
  readonly workspaceName: string;
  /** The user id this posts as. In the digest: two accounts in one workspace are two different people speaking. */
  readonly postingAs: string;
  readonly policy: SendPolicy;
  /**
   * What the workspace was connected as, and what Slack granted it — for a post with files, which needs both `send` and
   * `files:write`. Read from the configuration by `gateDepsFor`; a post of text alone does not look at them.
   */
  readonly mode?: string | undefined;
  readonly grantedScopes?: readonly string[] | undefined;
  /** Which local files may be sent: the attachment jail's folders, as `attachPolicyOf` reads them. */
  readonly attachPolicy?: AttachPolicy | undefined;
  readonly approvals: {
    create(input: {
      inboxId: string;
      inboxSub?: string | undefined;
      draftId: string;
      draftMessageId: string;
      digest: string;
      policy: SendPolicy;
      requiredPolicy: SendPolicy;
      riskFlags: string[];
      expect: Expectation;
    }): Promise<ApprovalRecord>;
  };
}

/** The channel, and how many people are in it — or why that could not be established. */
async function roomOf(
  call: SlackCall,
  channelId: string,
): Promise<{ channel: Channel | undefined; members: number | undefined; why: string | undefined }> {
  try {
    const response = await callSlack(call, 'conversations.info', { channel: channelId, include_num_members: true });
    const channel = channelOf((response.channel as Record<string, unknown> | undefined) ?? {});
    return { channel, members: channel.memberCount, why: undefined };
  } catch (error) {
    /*
     * Never guessed.
     *
     * A count this could not read is reported as unreadable, not as zero and not as a small number. The whole
     * value of the figure is that somebody is about to agree to it, and a number nobody measured is worse than an
     * honest gap — it reads exactly like one that was measured.
     */
    return { channel: undefined, members: undefined, why: (error as Error).message };
  }
}

/**
 * Refuses a post to a room this account has not joined — issue #43.
 *
 * A post to a room this account has not joined puts the person into a conversation they are not part of, under their
 * name — an agent that picked the wrong room — and Slack cannot be relied on to refuse it first. So a room that was
 * read, and does not say it counts this account as a member, is refused.
 *
 * A direct message and a group DM are exempt by what they are, never by `is_member`: Slack leaves that field out of a
 * DM's answer, and `channelOf` reads a missing field as false, so checking the field alone would refuse every DM. A
 * room that could not be read is not refused here — nothing is known about it — and its preview says membership was
 * not checked (see `previewOf`).
 *
 * `SCOPE_MISSING`, the code Slack's own `not_in_channel` maps to in `callSlack`: the same fact, found before Slack is
 * asked to post rather than after.
 */
function requireMember(channel: Channel, channelId: string): void {
  if (channel.isIm || channel.isMpim || channel.isMember) return;
  const name = channel.name?.text;
  const named = name ? `#${truncateDisplay(name, 80)} (${channelId})` : channelId;
  throw new CommsError('SCOPE_MISSING', `nothing was sent: this account is not a member of ${named}`, {
    hint: 'Join the channel in Slack yourself, then prepare the post again: agent-slack never joins a channel for you.',
    details: { channel: channelId, reason: 'not-a-member' },
  });
}

/**
 * The flag on a post's approval whose reach could not be counted when it was prepared.
 *
 * Read back as well as shown. The digest binds a reach nobody measured as exactly that, and the approval screen reads
 * this to say so when it voids one — rather than quoting the `0` that stood in for the count as though it were one.
 */
export const REACH_UNKNOWN = 'reach-unknown';

/** The flag on a post's approval that carries files: what the approval screen and the audit can tell a file post by. */
export const CONTAINS_FILES = 'contains-files';

/**
 * The flag on a post with files whose words hold a link, which Slack may unfurl for the whole room — issue #44. Its
 * preview warns about it; see `unfurlWarnings`.
 */
export const LINK_MAY_UNFURL = 'link-may-unfurl';

/** Anything about this post a person should look at twice. Flags, never refusals. */
function risksOf(
  payload: { text: string },
  notifies: { channel: boolean; here: boolean; estimated: number; unknown?: string | undefined },
  files: number,
): string[] {
  const flags: string[] = [];
  if (files > 0) flags.push(CONTAINS_FILES);
  if (notifies.channel) flags.push('notifies-channel');
  if (notifies.here) flags.push('notifies-here');
  if (notifies.unknown !== undefined) flags.push(REACH_UNKNOWN);
  if (notifies.estimated >= 50) flags.push('large-audience');
  const { references } = decodeSlackText(payload.text);
  if (references.some((reference) => reference.kind === 'link')) flags.push('contains-link');
  // Only with files: a message posts with unfurling off, and its flags are what they always were.
  if (files > 0 && urlsInWords(payload.text).length > 0) flags.push(LINK_MAY_UNFURL);
  return flags;
}

/** A post as it would go now: what a person is shown, and the digest that binds exactly that. */
export interface PostView {
  readonly preview: ChannelPreview;
  readonly digest: string;
  /** Why the room could not be read, when it could not — so its reach is a gap, not a number. */
  readonly roomUnread: string | undefined;
  /** What posts: the one payload the preview was rendered from and the digest was taken over. */
  readonly payload: ComposedPayload;
}

/**
 * What a draft posts: its text, composed again — and only if that is exactly what the draft file holds.
 *
 * The preview is read from `text`. The post sends `blocks` as well, and a client renders the blocks and notifies from
 * them, so a draft whose blocks say something its text does not would be shown as one message and posted as another —
 * approved on the strength of words nobody would see, reaching people the preview never counted. The composer cannot
 * write one; a file edited by hand can, and anything with a shell can edit it. So the payload is made again from
 * `text` by the composer that made it, and a draft that is not byte for byte that payload — blocks, flags, or a field
 * nothing here writes — is refused before anyone is shown anything. Checked here because preparing, the approval
 * screen and posting all come through `viewPost`: no surface can show or send a draft this has not passed.
 *
 * The thread is checked for being a string first, because it is the one field composed again *from* the file rather
 * than against it: a `thread_ts` the file holds as a number went back into the payload as that number, compared equal
 * to itself, and passed — to fail inside the digest as UNEXPECTED, where the gate's refusal belonged, and as `null` to
 * prepare as a message outside any thread. The composer writes a string or nothing; anything else was written by hand.
 * (`text` and `channel` are checked to be strings when the file is read — see `isDraftShaped`.)
 */
export function postedPayload(draft: SlackDraft): ComposedPayload {
  const stored = draft.payload;
  const threadTs: unknown = stored.thread_ts;
  if (threadTs !== undefined && typeof threadTs !== 'string') throw notComposed(draft);
  const posted = payloadOf(stored.text, stored.channel, threadTs);
  if (canonicalJson(stored) !== canonicalJson(posted)) throw notComposed(draft);
  return posted;
}

/** The gate's refusal of a draft that is not what its text composes to — one wording, whichever part of it differs. */
function notComposed(draft: SlackDraft): CommsError {
  return new CommsError(
    'BAD_DATA',
    `nothing was sent: draft "${draft.draftId}" is not what its text composes to, so its preview would not be what posts`,
    { hint: changedOutsideHint(draft.draftId), details: { draftId: draft.draftId, reason: 'not-composed' } },
  );
}

/**
 * What to do about a draft file changed outside agent-slack: there is no mending one, only composing it again.
 *
 * One sentence for every place that finds one — the gate, and `draft show` and `slack_draft_get`, which show a draft as
 * the gate would post it — so the advice cannot differ between showing a draft and trying to post it.
 */
export function changedOutsideHint(draftId: string): string {
  return `It was changed outside agent-slack. Delete it with \`agent-slack draft delete ${draftId} --workspace <name>\` and compose it again.`;
}

/**
 * Reads the room once and builds both halves from that one reading.
 *
 * One function for the three places that need them — preparing, the approval screen, and posting. They were two
 * copies, and the approval screen, which had neither, rendered a room of four hundred as a count it could not read:
 * the person typing the code was never shown the reach their approval bound. Built in one place, what is shown and
 * what is bound cannot drift apart between the three.
 */
export async function viewPost(
  deps: Pick<PrepareDeps, 'call' | 'workspaceId' | 'workspaceName' | 'postingAs'>,
  draft: SlackDraft,
  book: NameBook,
): Promise<PostView> {
  // Before Slack is asked anything: a draft that is not what its text composes to is shown to nobody.
  const payload = postedPayload(draft);
  // A draft stored before 0.12.0, or written by hand, may name a user: refused here too, before Slack is asked.
  requireConversation(payload.channel, deps.workspaceName);
  const { channel, members, why } = await roomOf(deps.call, payload.channel);
  // Here, so preparing, the approval screen and posting all refuse it — and posting before the approval is claimed.
  if (channel) requireMember(channel, payload.channel);
  if (channel) book.addChannel(channel);

  const preview = previewOf({
    // Rendered from the payload that posts, not from the file it was checked against.
    draft: { ...draft, payload },
    workspace: deps.workspaceName,
    postingAs: deps.postingAs,
    channel,
    book,
    memberCount: members,
    countUnknown: why,
    membershipUnchecked: why,
  });

  const canonical: CanonicalChannelMessage = {
    kind: 'channel',
    workspace: deps.workspaceId,
    postingAs: deps.postingAs,
    channel: payload.channel,
    ...(channel?.name?.text ? { channelName: channel.name.text } : {}),
    ...(payload.thread_ts ? { threadTs: payload.thread_ts } : {}),
    visibleText: preview.body,
    // The exact bytes `postPrepared` sends, so a change to any field of them counts as a change.
    payloadSha256: sha256Hex(JSON.stringify(payload)),
    notifies: {
      here: preview.notifies.here,
      channel: preview.notifies.channel,
      // Ids, not the names the preview shows — see `mentionedUserIds`.
      users: mentionedUserIds(payload.text),
      estimated: preview.notifies.estimated,
      // A reach nobody could count is bound as that, not as the `0` that stands in for it — see `roomOf`.
      unmeasured: preview.notifies.unknown !== undefined,
    },
    /*
     * Each file as it will leave — the name Slack shows, its type, its size and its hash — so a file whose bytes change
     * is a different post, and its approval is void. Empty for a post of text alone, which is the digest it always was.
     */
    attachments: (draft.files ?? []).map((file) => ({
      filename: file.name,
      mimeType: file.mimeType,
      size: file.size,
      sha256: file.sha256,
    })),
  };
  return { preview, digest: messageDigest(canonical), roomUnread: why, payload };
}

/**
 * Refuses a post with files from a workspace that cannot send one: connected to read, or not granted `files:write`.
 *
 * Checked at prepare, so nobody is shown a preview they could never post, and again at send, because the grant can
 * narrow in between. Slack would refuse it anyway — a `read` token holds no posting scope — but only after the bytes had
 * gone to it, and in words that do not say what to do. A post of text alone never comes here.
 */
export function requireFileSending(deps: Pick<PrepareDeps, 'mode' | 'grantedScopes' | 'workspaceName'>): void {
  const alias = deps.workspaceName;
  if (deps.mode !== 'send') {
    throw new CommsError('SCOPE_MISSING', `"${alias}" is connected to read, and cannot send files`, {
      hint: `Nothing was sent. Moving it to send takes a person: \`agent-slack workspace mode ${alias}\` shows the steps, as slack_mode does from a chat.`,
      details: { mode: deps.mode ?? null },
    });
  }
  if (!(deps.grantedScopes ?? []).includes('files:write')) {
    const command = `agent-slack workspace reauth ${alias} --mode send`;
    throw new CommsError('SCOPE_MISSING', `"${alias}" was not granted files:write, which sending a file needs`, {
      hint: `Nothing was sent. Sign in again to grant it: \`${command}\`. If the app itself does not offer files:write, update it with \`agent-slack manifest --mode send\` first.`,
      details: { scope: 'files:write', command },
    });
  }
}

/** The jail's folders, which every file post needs — and which only a caller that built its deps by hand could lack. */
function attachPolicyFor(deps: Pick<PrepareDeps, 'attachPolicy'>): AttachPolicy {
  if (deps.attachPolicy === undefined) {
    throw new CommsError('SEND_REFUSED', 'a post with files was prepared without the folders files may come from', {
      hint: 'This is a bug — please report it.',
    });
  }
  return deps.attachPolicy;
}

/**
 * The command that puts a draft's files on it again, as it is run: the draft's id and the workspace's own name, and
 * only the paths left to fill in. `draft update` takes nothing without `--workspace`, and a refusal whose one step
 * leaves it out offers a command that fails.
 */
export function refileCommand(workspace: string, draftId: string): string {
  return `agent-slack draft update ${draftId} --workspace ${workspace} --file <path…>`;
}

/**
 * Reads every file of a draft again, and refuses the post if any is no longer the file the draft recorded.
 *
 * Before anyone is shown anything: the preview lists each file's hash, and a person must never be asked to approve
 * bytes other than the ones listed. The draft's record is what the digest binds, so a file that changed since is
 * refused here rather than shown as its old self.
 */
async function filesAsRecorded(
  deps: Pick<PrepareDeps, 'attachPolicy' | 'workspaceName'>,
  draft: SlackDraft,
): Promise<void> {
  const files = draft.files ?? [];
  if (files.length === 0) return;
  const policy = attachPolicyFor(deps);
  for (const file of files) {
    const check = await checkRecordedFile(file, policy);
    if (!check.ok) {
      throw new CommsError(
        'BAD_DATA',
        `nothing was prepared: ${file.name} is not the file the draft recorded — ${check.why}`,
        {
          hint: `Put the files on the draft again with \`${refileCommand(deps.workspaceName, draft.draftId)}\` (every one: --file replaces the list) or slack_draft_update, then prepare it again.`,
          details: {
            draftId: draft.draftId,
            file: file.name,
            path: file.path,
            reason: 'file-changed',
            command: refileCommand(deps.workspaceName, draft.draftId),
          },
        },
      );
    }
  }
}

/**
 * Prepares one post, and shows what it will be.
 *
 * Nothing is posted here and nothing can be: the permit stays closed, and the only Slack call made is a read of
 * the channel so the reach can be counted. A post with files is checked first — the workspace can send them, and each
 * is still the file the draft recorded — so a refusal asks Slack nothing.
 */
export async function preparePost(deps: PrepareDeps, draft: SlackDraft, book: NameBook): Promise<PreparedPost> {
  if (deps.policy === 'never') {
    throw new CommsError('POLICY_NEVER', 'posting is turned off for this workspace (policy: never)', {
      hint: 'The preview below is pasteable — send it yourself in Slack, or change the policy at a terminal.',
    });
  }
  const files = draft.files ?? [];
  if (files.length > 0) {
    requireFileSending(deps);
    await filesAsRecorded(deps, draft);
  }
  const { preview, digest, payload } = await viewPost(deps, draft, book);

  const riskFlags = risksOf(payload, preview.notifies, files.length);
  /*
   * A broadcast raises the ceremony by itself.
   *
   * Under `chat` policy an ordinary message is agreed to in the conversation. `@channel` to four hundred people
   * is not an ordinary message, and the person who would be interrupted is not in the conversation to object.
   * `@here` is a broadcast too: it reaches whoever is online, which nothing here can count, and leaving it out let one
   * to a small room go on a yes in the chat.
   *
   * So does a reach nobody could count. A user group, or any mention the preview cannot put a number on, used to go on
   * a yes in the chat with its reach shown as zero; a person approving it at a terminal is told it is not known.
   */
  const broadcast = preview.notifies.channel || preview.notifies.here;
  const requiredPolicy: SendPolicy =
    broadcast || preview.notifies.estimated >= 50 || preview.notifies.unknown !== undefined ? 'confirm' : 'chat';

  const record = await deps.approvals.create({
    inboxId: deps.accountId,
    inboxSub: deps.postingAs,
    draftId: draft.draftId,
    draftMessageId: draft.revision,
    digest,
    policy: deps.policy,
    requiredPolicy,
    riskFlags,
    expect: expectationFor(payload, preview.notifies),
  });

  await deps.audit?.append({
    inboxId: deps.accountId,
    alias: deps.workspaceName,
    operation: 'slack.post.prepare',
    outcome: 'started',
    ids: { channel: payload.channel, draftId: draft.draftId },
    approvalId: record.approvalId,
    ...(deps.surface ? { surface: deps.surface } : {}),
  });

  return {
    approvalId: record.approvalId,
    draftId: draft.draftId,
    preview: {
      ...preview,
      context: { ...preview.context, approvalId: record.approvalId },
      policy: describePolicy(stricterPolicy(deps.policy, requiredPolicy)),
    },
    expect: record.expect,
    policy: deps.policy,
    requiredPolicy,
    riskFlags,
    expiresAt: record.expiresAt,
  };
}

function describePolicy(policy: SendPolicy): string {
  switch (policy) {
    case 'never':
      return 'nothing can be posted from this workspace';
    case 'confirm':
      return 'this needs a person to approve it at a terminal before it posts';
    default:
      return 'say yes and it posts';
  }
}

export interface PostDeps extends PrepareDeps {
  readonly permit: WritePermit;
  readonly approvals: PrepareDeps['approvals'] & {
    claimForSend(
      approvalId: string,
      live: {
        draftMessageId: string;
        digest: string;
        inboxId: string;
        inboxSub?: string | undefined;
        policy: SendPolicy;
        expect: Expectation;
      },
      options?: ClaimOptions,
    ): Promise<ApprovalRecord>;
    complete(approvalId: string, outcome: { sentMessageId: string } | { error: string }): Promise<ApprovalRecord>;
  };
}

export interface PostedMessage {
  readonly approvalId: string;
  readonly channel: string;
  readonly ts: string;
}

/** One file of a post, as Slack now has it: its id there, and what was sent. */
export interface PostedFile {
  readonly id: string;
  readonly name: string;
  readonly size: number;
  readonly sha256: string;
}

/**
 * A post with files, once posted.
 *
 * `ts` is the message the files were posted in, when Slack had attached them to one by the time it was asked — and
 * `null` otherwise, with `note` saying so. Never a guess: `files.completeUploadExternal` returns no message at all, and
 * a ts made up to fill the gap would send whoever replies to it to the wrong message. The file ids are always here.
 */
export interface PostedFiles {
  readonly approvalId: string;
  readonly channel: string;
  readonly ts: string | null;
  readonly files: readonly PostedFile[];
  readonly note?: string | undefined;
}

/** The command a person runs to approve at their own terminal. The same whichever surface asked. */
export function approveCommand(approvalId: string): string {
  return `agent-slack approve ${approvalId}`;
}

/**
 * What the caller is told while an approval waits for a person, in the words of the surface it is using.
 *
 * The person's step is the same from either surface: `agent-slack approve` is a terminal command, and under
 * `confirm` that is the point of it. The agent's next step is not. A CLI caller runs its command again, and an MCP
 * caller calls its tool — telling an agent in a chat to run `agent-slack post send` would send it looking for a shell
 * it may not have, to take a step its own tool takes. No input is echoed: the emoji and the channel are the caller's
 * own, and this may be printed at a terminal.
 */
function waitingHint(kind: 'post' | 'reaction', surface: 'cli' | 'mcp' | undefined, approvalId: string): string {
  const show =
    kind === 'post' ? 'Show the user the preview, then' : 'Tell the user which emoji and which message, then';
  const again =
    surface === 'mcp'
      ? kind === 'post'
        ? 'call `slack_post_send` again with the same arguments'
        : `call \`slack_react_send\` with approvalId ${approvalId} and the same channel, ts and emoji`
      : kind === 'post'
        ? 'run the same `agent-slack post send` again'
        : `run the same \`agent-slack react\` command again with \`--approval ${approvalId}\` added`;
  return `${show} ask them to run \`${approveCommand(approvalId)}\` in their own terminal. When they have, ${again}. You cannot approve this yourself.`;
}

/**
 * Claims an approval, and when it is waiting for a person, says so with the command they run as data.
 *
 * The hint is prose for whoever reads it. An agent relaying the step to a person should not have to dig a command out
 * of a sentence, so the wait carries it in `details.command` too — from both surfaces, because both come through here.
 * Everything else the claim throws goes out exactly as the store threw it.
 */
async function claimOrHandOver(
  deps: PostDeps,
  approvalId: string,
  live: Parameters<PostDeps['approvals']['claimForSend']>[1],
  pendingHint: string,
): Promise<void> {
  try {
    await deps.approvals.claimForSend(approvalId, live, { pendingHint });
  } catch (error) {
    if (!(error instanceof CommsError) || error.code !== 'APPROVAL_PENDING') throw error;
    throw new CommsError(error.code, error.message, {
      ...(error.hint === undefined ? {} : { hint: error.hint }),
      details: { ...error.details, command: approveCommand(approvalId) },
    });
  }
}

/**
 * Posts one prepared message, once.
 *
 * Everything that could refuse it has refused before Slack is reached: the approval is claimed under a lock with
 * an `O_EXCL` marker that makes the claim single-use across processes, the digest is recomputed from the draft as
 * it is *now*, and the permit is opened around exactly one request and closed in a `finally` — so a write that
 * throws halfway leaves no door open behind it.
 */
export async function postPrepared(
  deps: PostDeps,
  draft: SlackDraft,
  approvalId: string,
  expectChannel: string,
  book: NameBook,
): Promise<PostedMessage | PostedFiles> {
  /*
   * The caller restates the destination; this builds the rest.
   *
   * It used to take the whole `Expectation`, which meant the CLI had to reconstruct a value `preparePost` had
   * composed — and it reconstructed it wrongly, with an empty subject against the stored `reaches N`. The command
   * therefore refused every post it was given, and no test saw it because the tests called this function directly
   * with the value `preparePost` had returned. A caller can honestly say which channel it believes it is posting
   * to; it cannot honestly restate a reach it did not measure, so it no longer pretends to.
   */
  if (expectChannel !== draft.payload.channel) {
    throw new CommsError(
      'APPROVAL_VOID',
      `nothing was sent: this draft posts to ${draft.payload.channel}, not ${expectChannel}`,
      {
        hint: 'Check the channel in the preview, then pass that one.',
      },
    );
  }
  /*
   * A post with files, asked again whether this workspace may send one: the grant can narrow between prepare and send.
   * Before the claim, so a refusal here spends nothing, and the approval is there to use once the grant is mended.
   */
  const files = draft.files ?? [];
  const policy = files.length > 0 ? attachPolicyFor(deps) : undefined;
  if (files.length > 0) requireFileSending(deps);
  // The payload sent below is this one: checked against the file, previewed, and the one the digest is taken over.
  const { preview, digest, payload } = await viewPost(deps, draft, book);

  await claimOrHandOver(
    deps,
    approvalId,
    {
      draftMessageId: draft.revision,
      digest,
      inboxId: deps.accountId,
      inboxSub: deps.postingAs,
      policy: deps.policy,
      // Built from the live values, the same way `preparePost` built the stored one — one source, so they agree.
      expect: expectationFor(payload, preview.notifies),
    },
    waitingHint('post', deps.surface, approvalId),
  );

  if (policy !== undefined) return postFiles(deps, approvalId, draft.draftId, payload, files, policy);

  try {
    const response = await spendOn(deps.permit, approvalId, 'chat.postMessage', () =>
      callSlack({ ...deps.call, permit: deps.permit }, 'chat.postMessage', {
        channel: payload.channel,
        text: payload.text,
        blocks: JSON.stringify(payload.blocks),
        thread_ts: payload.thread_ts,
        unfurl_links: payload.unfurl_links,
        unfurl_media: payload.unfurl_media,
      }),
    );
    const ts = typeof response.ts === 'string' ? response.ts : '';
    await deps.approvals.complete(approvalId, { sentMessageId: ts });
    await deps.audit?.append({
      inboxId: deps.accountId,
      alias: deps.workspaceName,
      operation: 'slack.post',
      outcome: 'ok',
      ids: { channel: payload.channel, ts },
      approvalId,
      ...(deps.surface ? { surface: deps.surface } : {}),
    });
    return { approvalId, channel: payload.channel, ts };
  } catch (error) {
    // Recorded before it is rethrown: an approval left in `sending` is one whose outcome nobody knows.
    await deps.approvals.complete(approvalId, { error: (error as Error).message });
    await deps.audit?.append({
      inboxId: deps.accountId,
      alias: deps.workspaceName,
      operation: 'slack.post',
      outcome: 'failed',
      ids: { channel: payload.channel },
      approvalId,
      reason: (error as Error).message,
      ...(deps.surface ? { surface: deps.surface } : {}),
    });
    throw error;
  }
}

/** The call that makes uploaded files visible, and so the one a file post's permit is opened for. */
const PUBLISH_FILES = 'files.completeUploadExternal';

/**
 * How long to wait, before each look, for Slack to attach the posted files to a message: four looks over three seconds.
 *
 * Bounded because the post has already happened and the person is waiting on an answer that is only a courtesy. Slack
 * attaches the message a moment after the call that shares the files returns, and until it has there is no ts to give.
 */
const SHARE_WAITS_MS: readonly number[] = [0, 250, 750, 2000];

/** Who uploaded what, in words: for a failure after some files had gone up and before any was shared. */
function discarded(uploaded: readonly { name: string }[]): string {
  if (uploaded.length === 0) return '';
  const names = uploaded.map((file) => truncateDisplay(file.name, 60));
  return uploaded.length === 1
    ? `${names[0]} was uploaded and never shared; Slack discards it.`
    : `${names.join(', ')} were uploaded and never shared; Slack discards them.`;
}

/**
 * A file whose bytes went out and whose answer did not come back as success, in words: a 500 after the body was read,
 * or a connection dropped. Whether Slack kept them is not known, so it is said to be possible, never either way.
 */
function perhapsDiscarded(possible: readonly { name: string }[]): string {
  if (possible.length === 0) return '';
  const names = possible.map((file) => truncateDisplay(file.name, 60)).join(', ');
  return `${names} may have been uploaded before the failure; nothing shared it, so if Slack has it, Slack discards it.`;
}

/** The refusal for a file that is not the one approved: nothing more is sent, and the approval is spent. */
function notApproved(
  file: SlackDraftFile,
  why: string,
  uploaded: readonly { id: string; name: string }[],
  command: string,
): CommsError {
  return new CommsError(
    'APPROVAL_VOID',
    `${uploaded.length === 0 ? 'nothing was sent' : 'nothing was posted'}: ${file.name} is not the file that was approved — ${why}`,
    {
      hint: [
        discarded(uploaded),
        `Put the files on the draft again with \`${command}\` or slack_draft_update, prepare it, and approve the new preview.`,
      ]
        .filter(Boolean)
        .join(' '),
      details: { file: file.name, path: file.path, reason: 'file-changed', uploaded: [...uploaded], command },
    },
  );
}

/** The ts of the message a posted file is in, in this channel, from `files.info`'s shares — or undefined. */
function shareTs(file: unknown, channel: string): string | undefined {
  const shares = (file as { shares?: Record<string, unknown> } | null | undefined)?.shares;
  for (const kind of ['public', 'private']) {
    const entries = (shares?.[kind] as Record<string, unknown> | undefined)?.[channel];
    if (!Array.isArray(entries)) continue;
    for (const entry of entries) {
      const ts = (entry as { ts?: unknown } | null)?.ts;
      if (typeof ts === 'string' && /^\d+\.\d+$/.test(ts)) return ts;
    }
  }
  return undefined;
}

/**
 * The message a file post landed in, if Slack will say: a few looks at the first file's shares, and then an honest gap.
 *
 * A read, after the post, with no permit: nothing here can post again. A failure to ask is reported as the gap it is,
 * not as a failed post — the files are posted either way.
 */
async function messageTsOf(
  call: SlackCall,
  fileId: string,
  channel: string,
): Promise<{ ts: string | null; note?: string }> {
  let why = 'Slack had not attached the files to a message yet';
  for (const wait of SHARE_WAITS_MS) {
    if (wait > 0) await sleep(wait);
    try {
      const ts = shareTs((await callSlack(call, 'files.info', { file: fileId })).file, channel);
      if (ts !== undefined) return { ts };
    } catch (error) {
      why = `Slack could not be asked which message holds them (${(error as Error).message})`;
    }
  }
  return { ts: null, note: `${why}, so the message's ts is not known; the files are posted, and their ids are below` };
}

/**
 * Posts the files of one prepared post, once — after the approval has been claimed.
 *
 * Inside one permit, for the one call that shares the files, and in this order:
 *
 * 1. Every file is read again and matched to what was approved — not a link, a regular file, its own real path, still
 *    admitted by the jail, the approved size and hash — all of them before anything is uploaded. One that is not voids
 *    the approval, and nothing at all has left the machine.
 * 2. Then file by file: Slack is asked where to put it, the file is read and hashed again, and the bytes just hashed go
 *    to that URL. Never bytes kept from an earlier reading: what is hashed is what is sent.
 * 3. Then one call names the channel, the thread and the words, and makes every file visible as one post.
 *
 * A failure before the last step posts nothing, and says which files had been uploaded — Slack discards a file that
 * is never shared. A failure at it is a failed post. Afterwards, a few looks at `files.info` for the message's ts.
 */
async function postFiles(
  deps: PostDeps,
  approvalId: string,
  draftId: string,
  payload: ComposedPayload,
  files: readonly SlackDraftFile[],
  policy: AttachPolicy,
): Promise<PostedFiles> {
  const uploaded: { id: string; name: string }[] = [];
  /*
   * The file whose bytes are on their way, from the moment the POST starts until its answer says they arrived. If the
   * upload fails in between, they may have reached Slack or may not — so the failure names it as possibly uploaded.
   */
  let inFlight: { id: string; name: string } | undefined;
  const posted: PostedFile[] = [];
  const call: SlackCall = { ...deps.call, permit: deps.permit };
  const refile = refileCommand(deps.workspaceName, draftId);
  let stage: 'check' | 'upload' | 'complete' = 'check';
  try {
    await spendOn(deps.permit, approvalId, PUBLISH_FILES, async () => {
      for (const file of files) {
        const check = await checkRecordedFile(file, policy);
        if (!check.ok) throw notApproved(file, check.why, uploaded, refile);
      }
      stage = 'upload';
      for (const file of files) {
        const place = await callSlack(call, 'files.getUploadURLExternal', { filename: file.name, length: file.size });
        if (typeof place.upload_url !== 'string' || typeof place.file_id !== 'string') {
          throw new CommsError('PROVIDER_UNAVAILABLE', 'Slack’s answer held no upload URL for the file', {
            hint: 'Try again shortly.',
          });
        }
        const read = await rereadFile(file, policy);
        if (!read.ok) throw notApproved(file, read.why, uploaded, refile);
        inFlight = { id: place.file_id, name: file.name };
        await slackFileUpload(call, { url: place.upload_url, bytes: read.bytes });
        inFlight = undefined;
        uploaded.push({ id: place.file_id, name: file.name });
        posted.push({ id: place.file_id, name: file.name, size: file.size, sha256: file.sha256 });
      }
      stage = 'complete';
      await callSlack(call, PUBLISH_FILES, {
        files: JSON.stringify(posted.map((file) => ({ id: file.id, title: file.name }))),
        channel_id: payload.channel,
        // The words, when there are any, as the files' own message: one post, not a message and then some files.
        initial_comment: payload.text === '' ? undefined : payload.text,
        thread_ts: payload.thread_ts,
      });
    });
  } catch (error) {
    const possiblyUploaded = inFlight === undefined ? [] : [inFlight];
    const reported = reportFailure(error, stage, uploaded, possiblyUploaded);
    const message = reported instanceof Error ? reported.message : String(reported);
    // Recorded before it is rethrown: an approval left in `sending` is one whose outcome nobody knows.
    await deps.approvals.complete(approvalId, { error: message });
    await deps.audit?.append({
      inboxId: deps.accountId,
      alias: deps.workspaceName,
      operation: 'slack.post',
      outcome: stage === 'check' ? 'refused' : 'failed',
      // Which files went up, and which may have: by id and name, never by what is in them.
      ids: {
        channel: payload.channel,
        ...(uploaded.length > 0
          ? { files: uploaded.map((file) => file.id), fileNames: uploaded.map((file) => file.name) }
          : {}),
        ...(possiblyUploaded.length > 0
          ? {
              possiblyUploaded: possiblyUploaded.map((file) => file.id),
              possiblyUploadedNames: possiblyUploaded.map((file) => file.name),
            }
          : {}),
      },
      approvalId,
      reason: message,
      ...(deps.surface ? { surface: deps.surface } : {}),
    });
    throw reported;
  }

  const first = posted[0]?.id ?? '';
  const { ts, note } = await messageTsOf(deps.call, first, payload.channel);
  await deps.approvals.complete(approvalId, { sentMessageId: ts ?? posted.map((file) => file.id).join(',') });
  await deps.audit?.append({
    inboxId: deps.accountId,
    alias: deps.workspaceName,
    operation: 'slack.post',
    outcome: 'ok',
    // What was posted, by what it is: ids, names, sizes and hashes. Never a byte of it.
    ids: {
      channel: payload.channel,
      ...(ts === null ? {} : { ts }),
      files: posted.map((file) => file.id),
      fileNames: posted.map((file) => file.name),
      fileSizes: posted.map((file) => String(file.size)),
      fileSha256: posted.map((file) => file.sha256),
    },
    approvalId,
    ...(deps.surface ? { surface: deps.surface } : {}),
  });
  return { approvalId, channel: payload.channel, ts, files: posted, ...(note === undefined ? {} : { note }) };
}

/**
 * A file post's failure, in words that say what did and did not happen.
 *
 * A refusal of a changed file is already worded for itself. Anything else before the files were shared posts nothing,
 * and names the files that had gone up, and the one that may have — its bytes sent, its answer failed; a failure at
 * the call that shares them is a failed post.
 */
function reportFailure(
  error: unknown,
  stage: 'check' | 'upload' | 'complete',
  uploaded: readonly { id: string; name: string }[],
  possiblyUploaded: readonly { id: string; name: string }[],
): unknown {
  if (!(error instanceof CommsError) || error.code === 'APPROVAL_VOID') return error;
  const which = {
    uploaded: [...uploaded],
    ...(possiblyUploaded.length > 0 ? { possiblyUploaded: [...possiblyUploaded] } : {}),
  };
  if (stage === 'complete') {
    return new CommsError(error.code, `the post failed: ${error.message}`, {
      hint: [error.hint, 'The files were uploaded; if Slack did not share them, it discards them.']
        .filter(Boolean)
        .join(' '),
      details: { ...error.details, stage, ...which },
    });
  }
  return new CommsError(error.code, `nothing was posted: ${error.message}`, {
    hint: [discarded(uploaded), perhapsDiscarded(possiblyUploaded), error.hint].filter(Boolean).join(' '),
    details: { ...error.details, stage, ...which },
  });
}

/**
 * A reaction, at lower ceremony — D6.
 *
 * Adding one notifies a person and is attributed to them, so it is a post and goes through the same approval
 * machinery as a message: an approval bound to this emoji, on this message, claimed once. What is *lower* about
 * the ceremony is the preview, not the gate — a reaction is one line rather than a rendered message, and putting
 * it through the full preview-and-approve flow would train people to approve without reading, which costs more
 * safety than it buys.
 *
 * An earlier version took an `approvalId` and never created or claimed one, so any string opened the door. The
 * distinction D6 draws between `chat` and `confirm` was not implemented either: both simply went.
 */
export interface PreparedReaction {
  readonly approvalId: string;
  readonly channel: string;
  readonly ts: string;
  readonly name: string;
  readonly remove: boolean;
  readonly requiredPolicy: SendPolicy;
  readonly expect: Expectation;
}

/** What a reaction's approval is bound to: this emoji, on this message, in this workspace, as this account. */
function reactionDigest(deps: { workspaceId: string; postingAs: string }, options: ReactionOptions): string {
  return sha256Hex(
    JSON.stringify({
      kind: 'reaction',
      workspace: deps.workspaceId,
      postingAs: deps.postingAs,
      channel: options.channel,
      ts: options.ts,
      name: options.name,
      remove: options.remove === true,
    }),
  );
}

export interface ReactionOptions {
  readonly channel: string;
  readonly ts: string;
  readonly name: string;
  readonly remove?: boolean | undefined;
}

function reactionExpectation(options: ReactionOptions): Expectation {
  return { to: [options.channel], cc: [], bcc: [], subject: `:${options.name}: on ${options.ts}` };
}

/** Where a reaction's approval says what it is for, in place of the draft a post has. */
function reactionDraftId(options: ReactionOptions): string {
  return `reaction:${options.channel}:${options.ts}`;
}

/**
 * The reaction an approval was prepared for, read back from the record — or `undefined` when it is a post's.
 *
 * A reaction has no draft file: what it is lives in the record itself, spread over fields the approval store
 * already has — the message in the draft id, the emoji in the expectation, a removal in the risk flags. Approving
 * one used to read `draftId` as a draft, which it is not, so every reaction under `confirm` was refused at the
 * approval screen and could never be made.
 *
 * What comes back is only believed once it reproduces the record's own digest. That is what makes the one line a
 * person reads the act the approval permits, rather than a reading of some fields that happen to sit near it.
 */
export function reactionOfApproval(record: ApprovalRecord, workspaceId: string): ReactionOptions | undefined {
  const where = /^reaction:([^:]+):(.+)$/.exec(record.draftId);
  if (!where) return undefined;
  const what = /^:(.+): on (.+)$/.exec(record.expect.subject);
  const options: ReactionOptions = {
    channel: where[1] ?? '',
    ts: where[2] ?? '',
    name: what?.[1] ?? '',
    remove: record.riskFlags.includes('removes-reaction'),
  };
  if (!what || reactionDigest({ workspaceId, postingAs: record.inboxSub ?? '' }, options) !== record.digest) {
    throw new CommsError('BAD_DATA', 'this approval does not describe the reaction it is bound to', {
      hint: 'Nothing was approved. Run the `agent-slack react` command again for a new approval.',
      details: { approvalId: record.approvalId },
    });
  }
  return options;
}

export async function prepareReaction(deps: PrepareDeps, options: ReactionOptions): Promise<PreparedReaction> {
  if (deps.policy === 'never') {
    throw new CommsError('POLICY_NEVER', 'posting is turned off for this workspace (policy: never)');
  }
  const digest = reactionDigest(deps, options);
  const record = await deps.approvals.create({
    inboxId: deps.accountId,
    inboxSub: deps.postingAs,
    draftId: reactionDraftId(options),
    // No draft to edit, so the reaction's own digest stands in: the same value means the same act.
    draftMessageId: digest,
    digest,
    policy: deps.policy,
    /*
     * A reaction never raises its own ceremony.
     *
     * A message can, because a broadcast reaches a room. A reaction reaches the one person who wrote the
     * message, so the workspace's own policy decides: `chat` is a yes in the conversation, `confirm` is the same
     * typed approval a message needs.
     */
    requiredPolicy: 'chat',
    riskFlags: options.remove ? ['removes-reaction'] : [],
    expect: reactionExpectation(options),
  });
  return {
    approvalId: record.approvalId,
    channel: options.channel,
    ts: options.ts,
    name: options.name,
    remove: options.remove === true,
    requiredPolicy: 'chat',
    expect: record.expect,
  };
}

/** Applies one prepared reaction, once, through the permit. */
export async function reactPrepared(
  deps: PostDeps,
  approvalId: string,
  options: ReactionOptions,
): Promise<{ approvalId: string }> {
  const digest = reactionDigest(deps, options);
  await claimOrHandOver(
    deps,
    approvalId,
    {
      draftMessageId: digest,
      digest,
      inboxId: deps.accountId,
      inboxSub: deps.postingAs,
      policy: deps.policy,
      expect: reactionExpectation(options),
    },
    waitingHint('reaction', deps.surface, approvalId),
  );
  const method = options.remove ? 'reactions.remove' : 'reactions.add';
  try {
    await spendOn(deps.permit, approvalId, method, () =>
      callSlack({ ...deps.call, permit: deps.permit }, method, {
        channel: options.channel,
        timestamp: options.ts,
        name: options.name,
      }),
    );
    await deps.approvals.complete(approvalId, { sentMessageId: options.ts });
    await deps.audit?.append({
      inboxId: deps.accountId,
      alias: deps.workspaceName,
      operation: options.remove ? 'slack.reaction.remove' : 'slack.reaction.add',
      outcome: 'ok',
      ids: { channel: options.channel, ts: options.ts, emoji: options.name },
      approvalId,
      ...(deps.surface ? { surface: deps.surface } : {}),
    });
    return { approvalId };
  } catch (error) {
    await deps.approvals.complete(approvalId, { error: (error as Error).message });
    throw error;
  }
}
