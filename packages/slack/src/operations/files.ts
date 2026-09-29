import { createHash } from 'node:crypto';
import { type FileHandle, rm } from 'node:fs/promises';
import { basename } from 'node:path';
import {
  askWhereToSave,
  type CheckedAnswer,
  CommsError,
  checkDownloadAnswer,
  createSavedFile,
  type DestinationQuestion,
  type DownloadAnswer,
  type DownloadRequest,
  downloadRecordPath,
  effectiveChangePolicy,
  fileRisks,
  fileWarnings,
  type InternetMark,
  type InternetMarkKind,
  isPlainFileName,
  markFromInternet,
  newBoundary,
  type SaveChoice,
  savedName,
  saveFailure,
  saveFolders,
  settleDestination,
  type WarnedFile,
  wrapUntrusted,
  writeFileAtomic,
} from '@agentcomms/core';
import { callSlack, type SlackCall } from '../api/call.ts';
import { type SlackFileBody, type SlackFileRequest, slackFileDownload } from '../api/download.ts';
import type { SlackContext } from '../context.ts';
import { senderField } from '../text/field.ts';
import { type NumberOption, numberOption } from './numbers.ts';
import { NameBook } from './people.ts';
import type { WorkspaceSession } from './session.ts';

/**
 * Saving files from Slack to disk: by id, from one message, or from a conversation — where the person says.
 *
 * Gmail's attachment download is the model, with its weak spots fixed. Nothing is ever opened or run, and nothing is
 * saved until the person has said where: the first call looks the files up and answers with the question — the files
 * by name and size, and three places to save them, the first two by their exact paths (core's `save-destination.ts`)
 * — and the second, carrying the person's answer and the question's id, claims the question for these files and no
 * others and saves them. The question is held to the workspace's change policy: under `confirm` the answer is the one
 * the person gave at their own terminal (`agent-slack approve`), never one in the arguments. No answer saves into a
 * folder on core's deny list (`save-deny.ts`). Each file is saved in the chosen folder under the name its uploader gave
 * it, made safe by core's `savedName` — with `.download` after it unless its extension is one that is only ever
 * opened — the name the question showed, and marked as downloaded from the internet; the write is exclusive and
 * refuses to follow a link, and nothing else is written in that folder. A file-system error names the folder and the file's id, never the uploader's name.
 * The name, title, uploader and type — which the uploader chose — come back beside the path, each inside the
 * untrusted-content envelope, and the saved name and path too unless the name is plainly a file name.
 *
 * The bytes come through the guarded transport (`api/download.ts`), which is the only thing here that sends the token
 * anywhere but the Slack Web API. This module never decides whether an address is safe to follow: it hands the
 * transport the address Slack gave and the file it was looked up as, and turns each refusal into a sentence. One file
 * that cannot be fetched is skipped with its reason and the rest carry on; the manifest — under this package's own
 * state directory — and the audit record are written for whatever was saved, however the run ends.
 */

type Raw = Record<string, unknown>;

/** Fetches one file's bytes. The guarded transport by default; a test hands in a stand-in, so nothing is fetched. */
export type FileDownloader = (call: SlackCall, request: SlackFileRequest) => Promise<SlackFileBody>;

export interface FileDownloadDeps {
  download?: FileDownloader | undefined;
  /**
   * Lower byte caps, for a test that has to reach them without writing 500 MiB. Only ever lower: a number above
   * {@link MAX_FILE_BYTES} or {@link MAX_RUN_BYTES} is not used, so nothing can raise either cap through this.
   */
  caps?: { perFile?: number | undefined; perRun?: number | undefined } | undefined;
  /** How a saved file is marked as downloaded from the internet: core's `markFromInternet` unless a test says. */
  mark?: ((path: string) => Promise<InternetMark>) | undefined;
  /**
   * How a file's bytes are written into the file made for them: the handle's own `writeFile` unless a test says, to see
   * what had happened to the file by then.
   */
  write?: ((handle: FileHandle, bytes: Buffer) => Promise<void>) | undefined;
}

interface Caps {
  readonly perFile: number;
  readonly perRun: number;
}

function capsOf(deps: FileDownloadDeps): Caps {
  const lower = (wanted: number | undefined, most: number) =>
    wanted !== undefined && Number.isSafeInteger(wanted) && wanted > 0 ? Math.min(wanted, most) : most;
  return { perFile: lower(deps.caps?.perFile, MAX_FILE_BYTES), perRun: lower(deps.caps?.perRun, MAX_RUN_BYTES) };
}

/** The command that answers a download's question at a person's own terminal, under a `confirm` change policy. */
const APPROVE_COMMAND = 'agent-slack approve';

/** How many files one run saves at most: `--max-files` on the command line, `maxFiles` in a tool call. */
export const MAX_FILES: NumberOption = { flag: '--max-files', arg: 'maxFiles', min: 1, max: 200 };
export const DEFAULT_MAX_FILES = 50;

const MIB = 1024 * 1024;
/** The most one file may be. Checked on the bytes received, not on the size Slack reports. */
export const MAX_FILE_BYTES: number = 100 * MIB;
/** The most one run may save, all files together. */
export const MAX_RUN_BYTES: number = 500 * MIB;

/*
 * Slack's ids, as patterns.
 *
 * Each of these becomes part of the address the transport checks, or of the question a download is bound to, so each
 * is held to the shape Slack gives it — capital letters and digits after a one-letter kind — before it is used. A
 * conversation is a public or private channel (`C`), a group DM or an older private channel (`G`), or a DM (`D`). A
 * message timestamp is seconds, a dot and a fraction; `since` may leave the fraction out.
 */
const FILE_ID = /^F[A-Z0-9]{1,40}$/;
const CONVERSATION_ID = /^[CDG][A-Z0-9]{1,40}$/;
const TEAM_ID = /^[TE][A-Z0-9]{1,40}$/;
const USER_ID = /^[UWB][A-Z0-9]{1,40}$/;
const MESSAGE_TS = /^\d{1,12}\.\d{1,9}$/;
const SINCE_TS = /^\d{1,12}(?:\.\d{1,9})?$/;
/** A MIME type with no parameters, as Gmail's `mimeTypeField` holds one: anything more is somebody's words. */
const MIME_TYPE =
  /^(?:application|audio|font|haptics|image|message|model|multipart|text|video)\/[a-z0-9][a-z0-9!#$&^_.+-]{0,126}$/i;

// ── Which files ────────────────────────────────────────────────────────────────────────────────────────────────────

export interface FileDownloadRequest extends DownloadAnswer {
  /** These files, by Slack file id. */
  fileIds?: readonly string[] | undefined;
  /** With `ts`, one message's conversation; alone, the conversation whose files to save. */
  channel?: string | undefined;
  /** With `channel`: the message whose files to save. */
  ts?: string | undefined;
  /**
   * With `channel` alone: only files uploaded at or after this Slack timestamp, to the second.
   *
   * Uploaded, not shared: `files.list` filters on a file's `created` time, so a file uploaded earlier and shared into
   * the conversation after `since` is left out.
   */
  since?: string | undefined;
  /** How many files at most, as given; checked against {@link MAX_FILES}. Fifty when left out. */
  maxFiles?: unknown;
  /** Which surface asked, so a refusal names the argument as that surface spells it. */
  surface?: 'cli' | 'mcp' | undefined;
}

export type FileSelection =
  | { readonly kind: 'files'; readonly fileIds: readonly string[] }
  | { readonly kind: 'message'; readonly channel: string; readonly ts: string }
  | { readonly kind: 'channel'; readonly channel: string; readonly since?: string | undefined };

export interface FileDownloadPlan {
  readonly selection: FileSelection;
  readonly maxFiles: number;
  /** The person's answer and the question's id, checked for their form: none yet, or one to save with. */
  readonly answer: CheckedAnswer;
}

/** How each surface spells the ways of naming files, so a refusal reads as the caller wrote the call. */
function selectors(surface: 'cli' | 'mcp' | undefined) {
  return surface === 'mcp'
    ? {
        all: '`fileIds`, or `channel` with `ts` for one message, or `channel` alone for a conversation',
        files: '`fileIds`',
        ts: '`ts`',
        since: '`since`',
        channel: '`channel`',
        example: 'For example `{ "channel": "C024BE7LR", "ts": "1700000000.000100" }`.',
      }
    : {
        all: '`--file <id>…`, or `--message <channel> <ts>`, or `--channel <id>`',
        files: '`--file`',
        ts: '`--message`',
        since: '`--since`',
        channel: '`--channel`',
        example:
          'For example `agent-slack files download --workspace acme/slack --message C024BE7LR 1700000000.000100`.',
      };
}

/** A value a caller gave, quoted and cut, for a refusal that has to say which one it was. */
function quoted(value: string): string {
  return JSON.stringify(value.length > 64 ? `${value.slice(0, 64)}…` : value);
}

/**
 * Which files a download names, how many it may save, and the answer it carries: checked, or the USAGE refusal.
 *
 * Exactly one way of naming files — ids; a conversation and a message timestamp; or a conversation alone, from a
 * timestamp on — because two at once is a caller who meant one of them, and guessing which would save files nobody
 * asked for. Each id is held to Slack's shape here, before anything is read: every one of them becomes part of the
 * address the transport checks, or of the question the person answers. An answer without the question it answers is
 * refused here too (core's `checkDownloadAnswer`).
 *
 * Its own function so that each surface can call it before it opens the workspace, as `searchPaging` is — opening it
 * reads the credential from the secret store and may renew a token with Slack, and a refusal that needs nothing but
 * the arguments should cost neither. {@link downloadFiles} checks again for a caller that did not.
 */
export function downloadSelection(request: FileDownloadRequest): FileDownloadPlan {
  const words = selectors(request.surface);
  const refuse = (message: string, hint = `Name the files one way: ${words.all}.`): never => {
    throw new CommsError('USAGE', message, { hint });
  };
  const maxFiles = numberOption(request.surface, request.maxFiles, MAX_FILES) ?? DEFAULT_MAX_FILES;
  const answer = checkDownloadAnswer(request, request.surface ?? 'cli');
  const { channel, ts, since } = request;

  if (request.fileIds !== undefined) {
    if (channel !== undefined || ts !== undefined || since !== undefined) {
      refuse(`name the files one way, not two: ${words.files} names them by id`);
    }
    const fileIds = [...new Set(request.fileIds)];
    if (fileIds.length === 0)
      refuse(`${words.files} names no file`, 'Pass one Slack file id or more: F, then capitals and digits.');
    for (const id of fileIds) {
      if (typeof id !== 'string' || !FILE_ID.test(id)) {
        refuse(
          `${quoted(String(id))} is not a Slack file id`,
          'A file id is F followed by capital letters and digits.',
        );
      }
    }
    return { selection: { kind: 'files', fileIds }, maxFiles, answer };
  }

  if (channel === undefined) {
    if (ts !== undefined) refuse(`${words.ts} needs the conversation the message is in`);
    if (since !== undefined) refuse(`${words.since} needs the conversation whose files to save`);
    refuse(`name the files to save: ${words.all}`, words.example);
  }
  const conversation = channel as string;
  if (!CONVERSATION_ID.test(conversation)) {
    refuse(
      `${quoted(conversation)} is not a Slack conversation id`,
      'A channel id starts with C or G, a DM with D, and continues in capitals and digits.',
    );
  }
  if (ts !== undefined) {
    if (since !== undefined) refuse(`${words.since} is for a conversation's files, not for one message's`);
    if (!MESSAGE_TS.test(ts)) {
      refuse(`${quoted(ts)} is not a Slack message timestamp`, 'A timestamp looks like 1700000000.000100.');
    }
    return { selection: { kind: 'message', channel: conversation, ts }, maxFiles, answer };
  }
  if (since !== undefined && !SINCE_TS.test(since)) {
    refuse(`${quoted(since)} is not a Slack timestamp`, 'A timestamp looks like 1700000000 or 1700000000.000100.');
  }
  return {
    selection: { kind: 'channel', channel: conversation, ...(since === undefined ? {} : { since }) },
    maxFiles,
    answer,
  };
}

// ── What comes back ────────────────────────────────────────────────────────────────────────────────────────────────

/** A file a download names, as its question lists it: what it is and where it came from, before any byte. */
export interface SlackFileToSave {
  /** Slack's id for the file. */
  readonly fileId: string;
  /** The conversation and message it was shared in, or null when none is known: Slack's ids, never words. */
  readonly channel: string | null;
  readonly ts: string | null;
  /** Wrapped: the name the uploader gave it. `(unnamed)` when there was none. */
  readonly name: string;
  /** Wrapped, or null when it has none. */
  readonly title: string | null;
  /** Who uploaded it: Slack's id, and the name they go by — wrapped, since anybody can change their own. */
  readonly uploader: { readonly id: string | null; readonly name: string | null };
  /** What the uploader's client declared: a bare MIME type, wrapped when it is anything more, or null. */
  readonly mimetype: string | null;
  /** The size Slack reports, or null when it gives none. The bytes saved are counted again as they arrive. */
  readonly size: number | null;
  readonly riskFlags: readonly string[];
  /**
   * Why the file's own record could not be looked up, when it could not — or null.
   *
   * Only a conversation's files have it: listed without the message each was shared in, each is looked up by id for
   * that, and one whose lookup failed is listed from the listing's record, with no message. That says nothing about the
   * file — Slack may well know its message — so the result says why rather than let it pass for a file shared nowhere.
   */
  readonly lookupFailed: string | null;
}

export interface SavedSlackFile extends Omit<SlackFileToSave, 'size'> {
  /**
   * The name it was saved under: the uploader's, made safe by core's `savedFileName` and never over a file already
   * there. Bare while it is plainly a file name, and wrapped otherwise — see `isPlainFileName`.
   */
  readonly savedAs: string;
  /** Where it was saved: the folder the person chose, and `savedAs`. Wrapped whenever `savedAs` is. */
  readonly path: string;
  /** The bytes written. */
  readonly size: number;
  readonly sha256: string;
  /**
   * The mark the saved file carries as downloaded from the internet — macOS's quarantine attribute, Windows's
   * `Zone.Identifier` — or null: on a system with no such mark, or when it could not be written, which `warnings` says.
   */
  readonly marked: InternetMarkKind | null;
}

export interface SkippedSlackFile {
  readonly fileId: string;
  /** Why, in a sentence. */
  readonly reason: string;
  /**
   * The same, as a word to branch on: one of the transport's refusals (`external`, `wrong-host`, `wrong-path`,
   * `redirect`, `sign-in-page`, `too-large`, `http-error`, `network`), or `max-files`, `lookup`, `deleted`, `hidden`,
   * `no-address`, `bad-id`, `unexpected` — or `stopped`, a file the run stopped before it was saved.
   */
  readonly cause: string;
}

export interface FileDownloadResult {
  /** False: this is what was saved, not a question. */
  readonly destinationRequired: false;
  readonly workspace: string;
  readonly selection: FileSelection;
  /** The folder the files were saved in, as its real path; null when there was nothing to save. */
  readonly folder: string | null;
  /** How the folder was chosen: the answer the person gave, or null when there was nothing to save. */
  readonly chosen: SaveChoice | null;
  readonly files: readonly SavedSlackFile[];
  readonly skipped: readonly SkippedSlackFile[];
  /**
   * This package's own record of the download, under its state directory — never in the person's folder, where
   * nothing is written but the files. Null when there was nothing to save.
   */
  readonly manifestPath: string | null;
  readonly totalBytes: number;
  /**
   * What the person should know about the files saved, one line each: a file saved with `.download` after its name
   * and why, a file with a risk flag, a file that could not be marked as downloaded from the internet. Plain file names
   * are named; any other is called by its place in `files`.
   */
  readonly warnings: readonly string[];
  /**
   * False when not every file named was tried: the most files a run may save left some unread — skipped as
   * `max-files`, or never listed — or the run stopped part-way, and the files it stopped before are skipped as
   * `stopped`. Only the manifest can say the second: a run that stopped ends in an error, not in a result.
   */
  readonly complete: boolean;
}

/** What a download answers before anything is saved: the question for the person, with the files it would save. */
export interface FileDownloadQuestion extends DestinationQuestion {
  readonly workspace: string;
  readonly selection: FileSelection;
  readonly files: readonly SlackFileToSave[];
  /** What would not be saved, and why: known before any byte is fetched. */
  readonly skipped: readonly SkippedSlackFile[];
  /** What the files declare, together; a file whose size Slack does not give counts nothing. */
  readonly totalBytes: number;
  /** False when the most files a run may save left some of the conversation's out. */
  readonly complete: boolean;
}

// ── The run ────────────────────────────────────────────────────────────────────────────────────────────────────────

function list(value: unknown): Raw[] {
  return Array.isArray(value) ? (value.filter((v) => typeof v === 'object' && v !== null) as Raw[]) : [];
}

function str(value: unknown): string | undefined {
  return typeof value === 'string' && value !== '' ? value : undefined;
}

/** Orders two Slack timestamps: seconds, then the fraction as written — never as a float, which rounds the micros. */
function compareTs(a: string, b: string): number {
  const [aSeconds = '0', aFraction = ''] = a.split('.');
  const [bSeconds = '0', bFraction = ''] = b.split('.');
  const seconds = Number(aSeconds) - Number(bSeconds);
  if (seconds !== 0) return seconds;
  return aFraction.padEnd(9, '0').localeCompare(bFraction.padEnd(9, '0'));
}

/**
 * The message a file was first shared in: the earliest share Slack lists, in `preferred` when it lists one there.
 *
 * Slack keeps a file's shares by conversation, public and private (a DM's are private), each with the timestamp of
 * the message that carried it. Only well-formed ids and timestamps count, since both are reported as Slack's own.
 */
function firstShare(record: Raw, preferred?: string): { channel: string; ts: string } | undefined {
  const shares = (record.shares as Raw | undefined) ?? {};
  const found: { channel: string; ts: string }[] = [];
  for (const kind of ['public', 'private']) {
    const byConversation = (shares[kind] as Raw | undefined) ?? {};
    if (typeof byConversation !== 'object') continue;
    for (const [channel, entries] of Object.entries(byConversation)) {
      if (!CONVERSATION_ID.test(channel)) continue;
      for (const share of list(entries)) {
        const ts = str(share.ts);
        if (ts !== undefined && MESSAGE_TS.test(ts)) found.push({ channel, ts });
      }
    }
  }
  const pool = found.some((share) => share.channel === preferred)
    ? found.filter((share) => share.channel === preferred)
    : found;
  return pool.sort((a, b) => compareTs(a.ts, b.ts) || a.channel.localeCompare(b.channel))[0];
}

/** Something to save: an id, and — when a listing or a message already says — where it was shared. */
interface Candidate {
  readonly fileId: string;
  /** The listing's record; absent when the file is to be looked up by id with `files.info`. */
  readonly record?: Raw | undefined;
  /** The message the caller named, when they named one. */
  readonly message?: { channel: string; ts: string } | undefined;
}

/**
 * A message, by conversation and timestamp: its own row from the history, or — for a reply in a thread, which the
 * history leaves out — from the thread.
 */
async function findMessage(call: SlackCall, channel: string, ts: string): Promise<Raw> {
  const history = await callSlack(call, 'conversations.history', { channel, latest: ts, inclusive: true, limit: 1 });
  const top = list(history.messages).find((message) => message.ts === ts);
  if (top) return top;
  const missing = () =>
    new CommsError('NOT_FOUND', `no message ${ts} in ${channel}`, {
      hint: 'Check the timestamp: it is the message’s own `ts`, as `agent-slack read` shows it.',
    });
  let replies: Awaited<ReturnType<typeof callSlack>>;
  try {
    replies = await callSlack(call, 'conversations.replies', {
      channel,
      ts,
      oldest: ts,
      latest: ts,
      inclusive: true,
      limit: 10,
    });
  } catch (error) {
    // `thread_not_found` is Slack's word for a timestamp it has no message for; the caller asked for a message.
    if (error instanceof CommsError && error.code === 'NOT_FOUND') throw missing();
    throw error;
  }
  const reply = list(replies.messages).find((message) => message.ts === ts);
  if (reply) return reply;
  throw missing();
}

/**
 * A conversation's files, newest first, until `maxFiles` of them — and whether that was all of them.
 *
 * `files.list` pages by number. The page size is fixed for the whole listing, since a page counted in another size is
 * another page; and the pages are bounded, so a reply that never says it is done cannot keep this asking.
 */
async function listConversationFiles(
  call: SlackCall,
  channel: string,
  since: string | undefined,
  maxFiles: number,
): Promise<{ records: Raw[]; complete: boolean }> {
  const count = Math.min(maxFiles, 100);
  const records: Raw[] = [];
  // Whole seconds: a file's `created` is whole seconds, so the fraction of `since` can only ever move the start later.
  const from = since === undefined ? undefined : since.split('.')[0];
  for (let page = 1; page <= 20; page += 1) {
    const response = await callSlack(call, 'files.list', { channel, ts_from: from, count, page });
    const got = list(response.files);
    const paging = (response.paging as Raw | undefined) ?? {};
    const pages = typeof paging.pages === 'number' ? paging.pages : page;
    const room = maxFiles - records.length;
    records.push(...got.slice(0, room));
    const more = got.length > room || page < pages;
    if (records.length >= maxFiles) return { records, complete: !more };
    if (!more || got.length === 0) return { records, complete: true };
  }
  return { records, complete: false };
}

/** The files a selection names, in order, and whether the bound left any out. */
async function candidatesFor(
  call: SlackCall,
  plan: FileDownloadPlan,
): Promise<{ candidates: Candidate[]; complete: boolean }> {
  const { selection } = plan;
  switch (selection.kind) {
    case 'files':
      return { candidates: selection.fileIds.map((fileId) => ({ fileId })), complete: true };
    case 'message': {
      const message = await findMessage(call, selection.channel, selection.ts);
      const files = list(message.files);
      // Refused before anything is asked: a message with nothing to save has no question to put to anybody.
      if (files.length === 0) {
        throw new CommsError('NOT_FOUND', `message ${selection.ts} in ${selection.channel} has no files`, {
          hint: 'A link in the text is not a file; only what was uploaded to the message can be saved.',
        });
      }
      const where = { channel: selection.channel, ts: selection.ts };
      // Each looked up again by id: a message can carry a partial record — a Slack Connect file says only
      // `check_file_info` — and the address the transport checks should come from the file's own record.
      return {
        candidates: files.map((file) => ({ fileId: str(file.id) ?? '', message: where })),
        complete: true,
      };
    }
    case 'channel': {
      const listed = await listConversationFiles(call, selection.channel, selection.since, plan.maxFiles);
      return {
        candidates: listed.records.map((record) => ({ fileId: str(record.id) ?? '', record })),
        complete: listed.complete,
      };
    }
  }
}

/** What each of the transport's refusals means to somebody who asked for the file. */
const REASONS = {
  external: 'the file is held outside Slack, and the token is never sent there',
  'wrong-host': 'Slack gave an address outside files.slack.com for it, and the token is never sent there',
  'wrong-path': 'the address Slack gave is not this file’s, so it was not followed',
  redirect: 'files.slack.com redirected the download, and a redirect is never followed',
  'sign-in-page': 'Slack answered with its sign-in page: this workspace’s token cannot read the file',
} as const;

/** Why a file cannot be fetched at all, from its record alone — or undefined when it can be tried. */
function unfetchable(record: Raw, fileId: string): { cause: string; reason: string } | undefined {
  if (str(record.id) !== fileId) return { cause: 'bad-id', reason: 'Slack answered with a record for another file' };
  if (record.mode === 'tombstone') return { cause: 'deleted', reason: 'the file was deleted' };
  if (record.mode === 'hidden_by_limit') {
    return { cause: 'hidden', reason: 'the workspace’s plan hides this file, so Slack will not serve it' };
  }
  // Held somewhere else — Google Drive, Dropbox, a link — so there is no Slack address for it, and the token never
  // goes to wherever it is.
  if (record.is_external === true || record.mode === 'external') return { cause: 'external', reason: REASONS.external };
  if (str(record.url_private_download) === undefined && str(record.url_private) === undefined) {
    return { cause: 'no-address', reason: 'Slack gave no address for its bytes' };
  }
  return undefined;
}

/** A byte count as a person would say it: whole mebibytes as such, anything else in bytes. */
function bytes(count: number): string {
  return count > 0 && count % MIB === 0 ? `${count / MIB} MiB` : `${count} bytes`;
}

/** Why a file too large to save was not saved: the one file's cap, or what was left of the run's. */
function tooLarge(maxBytes: number, caps: Caps): string {
  return maxBytes >= caps.perFile
    ? `larger than ${bytes(caps.perFile)}, the most one file may be`
    : `larger than the ${bytes(Math.max(maxBytes, 0))} left of the ${bytes(caps.perRun)} one run may save`;
}

/** Whether the file's own record says it is a web page: an HTML file, which Slack's sign-in page looks like. */
function declaredAsWebPage(record: Raw): boolean {
  return str(record.mimetype)?.split(';')[0]?.trim().toLowerCase() === 'text/html' || record.filetype === 'html';
}

/** A refusal from the transport — or anything else it threw — as the skipped entry it becomes. */
function refusalOf(error: unknown, record: Raw, maxBytes: number, caps: Caps): { cause: string; reason: string } {
  const message = error instanceof Error ? error.message : String(error);
  const details = error instanceof CommsError ? error.details : undefined;
  const reason = typeof details?.reason === 'string' ? details.reason : undefined;
  /*
   * The transport refuses any web page, because that is what Slack's sign-in page is, and it cannot tell that page
   * from a file that is one. When the file is declared as a web page, blaming the token would send the person to fix
   * scopes that are fine, so the reason says what is actually known. The refusal, and its cause, stay the same.
   */
  if (reason === 'sign-in-page' && declaredAsWebPage(record)) {
    return {
      cause: reason,
      reason:
        'Slack answered with a web page, and this file is declared as one: the two cannot be told apart, so it was not saved',
    };
  }
  if (reason !== undefined && Object.hasOwn(REASONS, reason)) {
    return { cause: reason, reason: REASONS[reason as keyof typeof REASONS] };
  }
  switch (reason) {
    case 'too-large':
      return { cause: reason, reason: tooLarge(maxBytes, caps) };
    case 'http-error': {
      const status = typeof details?.status === 'number' ? ` ${details.status}` : '';
      return { cause: reason, reason: `files.slack.com answered with HTTP${status}` };
    }
    case 'network':
      return { cause: reason, reason: `could not fetch it from files.slack.com: ${message}` };
    default:
      return { cause: 'unexpected', reason: `could not fetch it: ${message}` };
  }
}

/** A file the request names and a download would save: its own record, and where it was shared. */
interface Planned {
  readonly fileId: string;
  readonly record: Raw;
  readonly message: { channel: string; ts: string } | undefined;
  readonly lookupFailed: string | undefined;
}

/**
 * The failures of a lookup that every later lookup in the run would meet too: Slack's rate limit or an outage, a token
 * it no longer takes, a scope the workspace was not granted. One file Slack will not describe is `NOT_FOUND`, and is
 * one file.
 */
const RUN_WIDE_FAILURES: ReadonlySet<string> = new Set(['TRANSIENT', 'AUTH_REQUIRED', 'SCOPE_MISSING']);

/**
 * The files a download would save, each with its own record, and those it would not, each with the reason — found
 * before anything is asked or fetched, so the question lists exactly what the answer saves.
 */
async function planFiles(
  call: SlackCall,
  plan: FileDownloadPlan,
  caps: Caps,
): Promise<{ planned: Planned[]; skipped: SkippedSlackFile[]; complete: boolean }> {
  const found = await candidatesFor(call, plan);
  const planned: Planned[] = [];
  const skipped: SkippedSlackFile[] = [];
  const skip = (fileId: string, refusal: { cause: string; reason: string }) => {
    skipped.push({ fileId, reason: refusal.reason, cause: refusal.cause });
  };
  let complete = found.complete;
  const seen = new Set<string>();
  let reached = 0;

  /*
   * One file's own record, by id — until a lookup fails in a way every later one would.
   *
   * Slack's rate limit, a token it no longer takes, a scope the workspace lacks: after one of those, each further
   * `files.info` fails the same way, and a conversation's two hundred files would be two hundred more calls against a
   * rate limit the person's other work shares. They used to be made all the same, and every file after the first
   * saved as undated with nothing saying why. So the lookups stop there for the rest of the run, and each file after
   * it carries the reason it was not looked up.
   */
  let lookupsStopped: string | undefined;
  const lookUp = async (fileId: string): Promise<{ readonly record?: Raw } | { readonly failed: string }> => {
    if (lookupsStopped !== undefined) return { failed: lookupsStopped };
    try {
      const response = await callSlack(call, 'files.info', { file: fileId });
      const own = response.file;
      return typeof own === 'object' && own !== null ? { record: own as Raw } : {};
    } catch (error) {
      const why = messageOf(error);
      if (error instanceof CommsError && RUN_WIDE_FAILURES.has(error.code)) {
        lookupsStopped = `not looked up, because an earlier lookup in this download failed: ${why}`;
      }
      return { failed: why };
    }
  };

  for (const candidate of found.candidates) {
    const { fileId } = candidate;
    if (seen.has(fileId)) continue;
    seen.add(fileId);
    if (reached >= plan.maxFiles) {
      complete = false;
      skip(fileId, { cause: 'max-files', reason: `more than ${plan.maxFiles} files` });
      continue;
    }
    reached += 1;
    if (!FILE_ID.test(fileId)) {
      skip(fileId, { cause: 'bad-id', reason: 'Slack listed it with an id that is not a file id' });
      continue;
    }

    let record = candidate.record;
    let lookupFailed: string | undefined;
    /*
     * A listing names the conversations a file is in, not the message: Slack documents `files.list` records with
     * `channels`, `groups` and `ims` and no `shares`, which `files.info` has, with each message's timestamp. Without
     * one the file would be listed with no message although it was shared in the very conversation asked about, so it
     * is looked up by id — as a message's files are, and as `--file` already pays for. Should the lookup fail, the
     * listing's own record still says where the bytes are, and the file is listed with no message, saying why.
     */
    if (record !== undefined && firstShare(record) === undefined) {
      const looked = await lookUp(fileId);
      if ('failed' in looked) lookupFailed = looked.failed;
      else if (looked.record !== undefined) record = looked.record;
    }
    if (record === undefined) {
      const looked = await lookUp(fileId);
      if ('failed' in looked) {
        // One file Slack will not describe — gone, or in a conversation this account is not in — is one file.
        skip(fileId, { cause: 'lookup', reason: looked.failed });
        continue;
      }
      record = looked.record ?? {};
    }
    const refused = unfetchable(record, fileId);
    if (refused) {
      skip(fileId, refused);
      continue;
    }
    // Slack's own figure, when it gives one, spares asking about a file that could only be refused. The bytes
    // received are still what the cap is held to: this is a shortcut, never the check.
    const declared = typeof record.size === 'number' ? record.size : undefined;
    if (declared !== undefined && declared > caps.perFile) {
      skip(fileId, { cause: 'too-large', reason: tooLarge(caps.perFile, caps) });
      continue;
    }
    const message =
      candidate.message ?? firstShare(record, plan.selection.kind === 'channel' ? plan.selection.channel : undefined);
    planned.push({ fileId, record, message, lookupFailed });
  }
  return { planned, skipped, complete };
}

/**
 * Saves the files a request names — once the person has said where — and reports each one saved or skipped.
 *
 * Without an answer nothing is saved: the files are looked up, and what comes back is the question, with the files by
 * name and size and anything that would not be saved with its reason. With the person's answer and the question's
 * `choiceId`, the question is claimed — for this workspace, this selection and these files only — and each file is
 * fetched and saved in the chosen folder under its uploader's name, made safe.
 *
 * No file may be more than 100 MiB and no run more than 500 MiB: the transport is handed the smaller of the file's cap
 * and what is left of the run's, and holds the bytes it receives to it.
 */
export async function downloadFiles(
  context: SlackContext,
  session: WorkspaceSession,
  request: FileDownloadRequest,
  deps: FileDownloadDeps = {},
): Promise<FileDownloadQuestion | FileDownloadResult> {
  const plan = downloadSelection({ ...request, surface: request.surface ?? context.surface });
  const download = deps.download ?? slackFileDownload;
  const caps = capsOf(deps);
  const { call, name: workspace } = session;

  // What to save is found before anything is asked: a message that does not exist, or has no files, asks nothing.
  const { planned, skipped, complete: listedAll } = await planFiles(call, plan, caps);
  const described = await describe(call, workspace, planned);
  // Under the uploader's name, made safe; the file's own id when nothing of the name is left. Worked out once, from the
  // records as they are now, and bound into the question: a file renamed on Slack after the question was asked would
  // otherwise be saved under a name the person never saw, so a claim with other names is refused.
  const names = planned.map(({ fileId, record }) => savedName(str(record.name) ?? '', fileId));
  const binding: DownloadRequest = {
    target: { kind: 'account', name: workspace, id: session.accountId },
    operation: 'files.download',
    request: { selection: plan.selection, maxFiles: plan.maxFiles },
    files: planned.map((entry) => entry.fileId),
    names: names.map((name) => name.name),
  };
  const config = await context.config();
  const folders = () => saveFolders({ configured: config.defaults.downloadsDir, env: context.env, cwd: context.cwd });
  // Where a stranger's files land is a change to this machine, answered as this workspace's other changes are approved.
  const policy = effectiveChangePolicy(config, { account: workspace });
  const { answer } = plan;

  if (answer.kind === 'none') {
    if (planned.length === 0) return nothingToSave(workspace, plan.selection, skipped, listedAll);
    const declared = described.files.reduce((sum, file) => sum + (file.size ?? 0), 0);
    const question = await askWhereToSave(context.core, {
      request: binding,
      folders: folders(),
      configured: Boolean(config.defaults.downloadsDir),
      count: planned.length,
      bytes: declared,
      listing: planned.map((_, index) => ({
        name: names[index]?.name ?? '',
        size: described.files[index]?.size ?? null,
        renamed: names[index]?.renamed,
        flags: [...(described.files[index]?.riskFlags ?? [])],
      })),
      policy,
      approveCommand: APPROVE_COMMAND,
      surface: context.surface,
      tool: 'slack_file_download',
      env: context.env,
    });
    return {
      ...question,
      workspace,
      selection: plan.selection,
      files: described.files,
      skipped,
      totalBytes: declared,
      complete: listedAll,
    };
  }
  // A person's own `--to` with nothing to save has nothing to decide; an answer to a question is claimed whatever the
  // request holds now, so that one asked about other files is refused rather than answered with nothing.
  if (answer.kind === 'person' && planned.length === 0) {
    return nothingToSave(workspace, plan.selection, skipped, listedAll);
  }
  const destination = await settleDestination(context.core, {
    answer,
    request: binding,
    folders,
    policy,
    approveCommand: APPROVE_COMMAND,
    surface: context.surface,
    env: context.env,
  });

  const saved: SavedSlackFile[] = [];
  // What the result warns about each file written: its rename, its flags, a mark that could not be made.
  const warned: WarnedFile[] = [];
  const unmarked: string[] = [];
  let complete = listedAll;
  let totalBytes = 0;
  // Boxed, so that even something thrown as `undefined` still counts as the run having stopped.
  let stopped: { readonly error: unknown } | undefined;
  // A file whose write failed and whose part-written copy could not be removed either: see below.
  let leftBehind: { readonly fileId: string; readonly path: string } | undefined;

  let at = 0;
  try {
    for (; at < planned.length; at += 1) {
      const { fileId, record } = planned[at] as Planned;
      const listed = described.files[at] as SlackFileToSave;
      const left = caps.perRun - totalBytes;
      const maxBytes = Math.min(caps.perFile, left);
      const declared = typeof record.size === 'number' ? record.size : undefined;
      if (maxBytes <= 0 || (declared !== undefined && declared > maxBytes)) {
        skipped.push({ fileId, cause: 'too-large', reason: tooLarge(maxBytes, caps) });
        continue;
      }

      const url = (str(record.url_private_download) ?? str(record.url_private)) as string;
      const uploaderTeam = str(record.user_team);
      const teamId = uploaderTeam !== undefined && TEAM_ID.test(uploaderTeam) ? uploaderTeam : session.teamId;
      let body: SlackFileBody;
      try {
        body = await download(call, { url, teamId, fileId, maxBytes });
      } catch (error) {
        const refusal = refusalOf(error, record, maxBytes, caps);
        skipped.push({ fileId, reason: refusal.reason, cause: refusal.cause });
        continue;
      }
      // The transport holds the bytes to the cap. Checked again before anything is written, because a cap that holds
      // only while one other module is right is a cap on that module, not on the disk.
      if (body.bytes.byteLength > maxBytes) {
        skipped.push({ fileId, cause: 'too-large', reason: tooLarge(maxBytes, caps) });
        continue;
      }

      // The name the question showed, which the claim held the record to. Created in the folder that was checked, and
      // proved to be there; an error from the file system names the folder and the file's id, never the name, which
      // its own message would carry in the path.
      const { name, given, renamed } = names[at] as ReturnType<typeof savedName>;
      const { path, handle } = await createSavedFile(destination, name, { fileId });
      let marking: InternetMark;
      try {
        /*
         * Marked as downloaded from the internet the moment it exists, before a byte of it is written: a program that
         * watches the folder and acts on a file as soon as it is there, or as soon as it is closed, finds it marked
         * already. A mark that cannot be made is said in the result, file by file; the file is still saved.
         */
        marking = await (deps.mark ?? markFromInternet)(path);
        await (deps.write ?? ((file, bytes) => file.writeFile(bytes)))(handle, body.bytes);
        await handle.close();
      } catch (error) {
        /*
         * A file cut short is worse than none. It looks like the file, under the file's own name, and neither the
         * manifest nor the audit lists it — and a run again saves the whole one beside it as `-2`. So it is removed
         * before the failure goes on; the path was created here, exclusively, so what is removed is this run's own.
         *
         * The removal can fail too: a full copy-on-write disk, a handle Windows still holds. Then the part-written
         * file stays, and the error, the manifest and the audit record each name it — the one thing worse than a file
         * cut short is one nobody mentions.
         */
        await handle.close().catch(() => undefined);
        await rm(path, { force: true }).catch(() => {
          // The path ends in the uploader's name: carried as a saved path is, inside the envelope unless plainly a name.
          leftBehind = { fileId, path: savedNameFields(path, described.wrap, fileId).path };
        });
        throw saveFailure(error, { folder: destination.folder, fileId });
      }
      totalBytes += body.bytes.byteLength;
      const { size: _declared, ...rest } = listed;
      saved.push({
        ...rest,
        ...savedNameFields(path, described.wrap, fileId),
        size: body.bytes.byteLength,
        sha256: createHash('sha256').update(body.bytes).digest('hex'),
        marked: marking.mark,
      });
      const position = saved.length;
      const savedAs = basename(path);
      warned.push({ given, savedAs, renamed, flags: listed.riskFlags, position });
      if (marking.failure !== undefined) {
        unmarked.push(
          `${isPlainFileName(savedAs) ? savedAs : `file ${position}`} is not marked as downloaded from the internet: ${marking.failure}`,
        );
      }
    }
  } catch (error) {
    // A file that could not be written is this machine's problem and stops the run. What was saved before it is
    // still recorded, below, before the failure is reported.
    stopped = { error };
  }

  /*
   * The files the run stopped before: the one it was on, and each it never reached.
   *
   * Without them the manifest of a run that stopped part-way listed what was saved and nothing else, and said it was
   * complete — while the error sent the caller to that manifest to ask only for what was missing. For files named by
   * id the caller could work that out; for a conversation's files, nothing recorded which they were.
   */
  const stoppedBefore: string[] = [];
  if (stopped !== undefined) {
    complete = false;
    for (const { fileId } of planned.slice(at)) {
      stoppedBefore.push(fileId);
      skipped.push({
        fileId,
        cause: 'stopped',
        reason:
          leftBehind?.fileId === fileId
            ? `the download stopped while it was being written, and the part written could not be removed: ${leftBehind.path}`
            : 'the download stopped before this file was saved',
      });
    }
  }

  const now = context.now();
  const manifestPath = downloadRecordPath(context.core, now, destination.choiceId);
  const result: FileDownloadResult = {
    destinationRequired: false,
    workspace,
    selection: plan.selection,
    folder: destination.folder,
    chosen: destination.choice,
    files: saved,
    skipped,
    manifestPath,
    totalBytes,
    warnings: [...fileWarnings(warned, 'result'), ...unmarked],
    complete,
  };

  /*
   * The manifest and the audit record, each written whatever became of the other.
   *
   * They used to be one step, the manifest first: a manifest that could not be written — a folder where it goes, a
   * full disk — took the audit record with it, and on a run that had already stopped the two were lost without a
   * word. Files were on disk that no record named. The audit record is the one this machine keeps, so it is written
   * even when the manifest is not, and says so.
   */
  let manifestFailure: { readonly error: unknown } | undefined;
  try {
    // This package's own file, under its state directory: never in the folder the person chose.
    await writeFileAtomic(
      manifestPath,
      `${JSON.stringify({ at: now.toISOString(), choiceId: destination.choiceId, answeredVia: destination.answeredVia, ...result }, null, 2)}\n`,
    );
  } catch (error) {
    manifestFailure = { error };
  }
  let auditFailure: { readonly error: unknown } | undefined;
  try {
    // The first Slack read that is audited: it leaves files on this machine, and the record says which, how many
    // and in which folder.
    await context.core.audit.append({
      inboxId: session.accountId,
      alias: workspace,
      operation: 'files.download',
      outcome: stopped === undefined && manifestFailure === undefined ? 'ok' : 'failed',
      surface: context.surface,
      ids: {
        fileIds: saved.map((file) => file.fileId),
        skippedFileIds: skipped.map((entry) => entry.fileId),
        ...(plan.selection.kind === 'files' ? {} : { channel: plan.selection.channel }),
        ...(plan.selection.kind === 'message' ? { ts: plan.selection.ts } : {}),
      },
      ...(destination.choiceId ? { approvalId: destination.choiceId } : {}),
      // The folder and the files' ids, never a saved name: a name is the uploader's words, and the audit log is read back.
      reason: `${saved.length} file(s), ${totalBytes} bytes, saved to ${destination.folder} (${destination.choice}, answered ${
        destination.answeredVia === 'flag' ? 'by flag' : `in ${destination.answeredVia}`
      }); ${skipped.length} skipped${manifestFailure === undefined ? '' : '; the manifest not written'}${
        leftBehind === undefined ? '' : `; part of ${leftBehind.fileId} could not be removed from ${destination.folder}`
      }`,
    });
  } catch (error) {
    auditFailure = { error };
  }

  if (stopped === undefined && manifestFailure === undefined && auditFailure === undefined) return result;
  throw unfinished({
    stopped,
    manifestFailure,
    auditFailure,
    files: saved,
    folder: destination.folder,
    manifestPath,
    stoppedBefore,
    leftBehind,
  });
}

/** A download with nothing in it to save: said, with each reason, and nothing asked, made or written. */
function nothingToSave(
  workspace: string,
  selection: FileSelection,
  skipped: readonly SkippedSlackFile[],
  complete: boolean,
): FileDownloadResult {
  return {
    destinationRequired: false,
    workspace,
    selection,
    folder: null,
    chosen: null,
    files: [],
    skipped,
    manifestPath: null,
    totalBytes: 0,
    warnings: [],
    complete,
  };
}

/** A failure's message, whatever was thrown. */
function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * The error a run ends with once files may be on disk: what went wrong, and what was saved and where it is listed.
 *
 * A bare filesystem error — `ENOTDIR`, `EISDIR` — told the caller only that the call failed. An agent told that runs
 * it again, and every file saved the first time is saved a second time beside itself as `-2`. So the error says how
 * many were saved and which record lists them, which files it stopped before, and any part-written file it could not
 * remove, and carries the same in `details`. A refusal the run stopped on keeps its own code and hint; anything else is
 * `CONFIG`, as another file this machine could not write is.
 *
 * When neither the manifest nor the audit record could be written, the hint names the files itself — by Slack's ids,
 * and the folder they are in: a saved name is the uploader's words, and a hint is the tool's. `details` has them too,
 * but the command line prints `details` only with `--json`, and a person reading the hint had nowhere else to find
 * what was on their disk.
 */
function unfinished(state: {
  readonly stopped: { readonly error: unknown } | undefined;
  readonly manifestFailure: { readonly error: unknown } | undefined;
  readonly auditFailure: { readonly error: unknown } | undefined;
  readonly files: readonly SavedSlackFile[];
  readonly folder: string;
  readonly manifestPath: string;
  readonly stoppedBefore: readonly string[];
  readonly leftBehind: { readonly fileId: string; readonly path: string } | undefined;
}): CommsError {
  const { stopped, manifestFailure, auditFailure, files, folder, manifestPath, stoppedBefore, leftBehind } = state;
  const cause = (stopped ?? manifestFailure ?? auditFailure)?.error;
  const own = cause instanceof CommsError ? cause : undefined;
  const count = files.length;
  const them = count === 1 ? 'it' : 'them';

  // Said only when it is true: a run that saved nothing — every file skipped — has nothing to say was saved.
  const savedSoFar = count === 0 ? '' : `${count === 1 ? 'the file was' : 'the files were'} saved`;
  let message: string;
  if (stopped !== undefined) message = `the download stopped part-way: ${messageOf(stopped.error)}`;
  else if (manifestFailure !== undefined) {
    message = `${savedSoFar === '' ? '' : `${savedSoFar}, but `}the manifest could not be written: ${messageOf(manifestFailure.error)}`;
  } else {
    message = `${savedSoFar === '' ? '' : `${savedSoFar} and the manifest lists ${them}, but `}the audit log could not be written: ${messageOf(auditFailure?.error)}`;
  }

  const hint: string[] = [];
  if (own?.hint !== undefined) hint.push(own.hint);
  if (count === 0) hint.push('Nothing was saved.');
  else {
    const listed =
      manifestFailure === undefined
        ? `, and the manifest at ${manifestPath} lists ${them}`
        : auditFailure === undefined
          ? ', and the audit log records which'
          : `, and nothing else records ${count === 1 ? 'it' : 'which'}: ${files.map((file) => file.fileId).join(', ')}, in ${folder}`;
    hint.push(
      `${count === 1 ? '1 file was' : `${count} files were`} saved${stopped === undefined ? '' : ' before it stopped'}${listed}.`,
      `Running the download again saves ${count === 1 ? 'that file' : 'each of those files'} a second time, so ask only for what is missing.`,
    );
  }
  if (stoppedBefore.length > 0) {
    const which =
      stoppedBefore.length === 1
        ? 'The file it stopped before is'
        : `The ${stoppedBefore.length} files it stopped before are`;
    hint.push(
      manifestFailure === undefined
        ? `${which} in the manifest under \`skipped\`, as \`stopped\`.`
        : auditFailure === undefined
          ? `${which} in the audit log, among the skipped.`
          : `${which} ${stoppedBefore.join(', ')}.`,
    );
  }
  if (leftBehind !== undefined) {
    hint.push(
      `Part of ${leftBehind.fileId} was written and could not be removed: delete it — it is not the whole file. It is ${leftBehind.path}`,
    );
  }

  return new CommsError(own?.code ?? 'CONFIG', message, {
    hint: hint.join(' '),
    details: {
      ...(own?.details ?? {}),
      saved: count,
      savedFiles: files.map((file) => ({ fileId: file.fileId, path: file.path })),
      stoppedBefore: [...stoppedBefore],
      partialFile: leftBehind?.path ?? null,
      manifestPath: manifestFailure === undefined ? manifestPath : null,
      audited: auditFailure === undefined,
    },
    cause,
  });
}

type Wrap = (text: string, field: string, fileId: string) => string;

/**
 * The files as they are handed back: every field the uploader chose inside the envelope, one boundary for the whole
 * result, and the uploader's name looked up once per person — bounded, and an id when it cannot be had. The wrapper is
 * returned too, so the names the files are saved under go into the same envelope.
 */
async function describe(
  call: SlackCall,
  workspace: string,
  planned: readonly Planned[],
): Promise<{ files: SlackFileToSave[]; wrap: Wrap }> {
  const boundary = newBoundary();
  const wrap: Wrap = (text, field, fileId) => wrapUntrusted(text, { field, inbox: workspace, id: fileId }, boundary);
  if (planned.length === 0) return { files: [], wrap };
  const book = new NameBook();
  const uploaders = planned.map(({ record }) => str(record.user)).filter((id) => id !== undefined && USER_ID.test(id));
  await book.learnPeople(call, new Set(uploaders as string[]));

  const files = planned.map(({ fileId, message, record, lookupFailed }) => {
    const rawName = str(record.name);
    const rawTitle = str(record.title);
    const rawType = str(record.mimetype)?.trim();
    const userId = str(record.user);
    const uploaderId = userId !== undefined && USER_ID.test(userId) ? userId : null;
    const person = uploaderId === null ? undefined : book.person(uploaderId);
    // The name they go by in Slack, else the name an app uploaded under: either is somebody's choice of words.
    const uploaderName = person?.displayName?.text ?? person?.realName?.text ?? senderField(str(record.username))?.text;
    return {
      fileId,
      channel: message?.channel ?? null,
      ts: message?.ts ?? null,
      name: rawName === undefined ? '(unnamed)' : wrap(senderField(rawName).text, 'filename', fileId),
      title: rawTitle === undefined ? null : wrap(senderField(rawTitle).text, 'title', fileId),
      uploader: {
        id: uploaderId,
        name: uploaderName === undefined ? null : wrap(uploaderName, 'uploader-name', fileId),
      },
      mimetype:
        rawType === undefined
          ? null
          : MIME_TYPE.test(rawType)
            ? rawType.toLowerCase()
            : wrap(rawType.slice(0, 500), 'mime-type', fileId),
      size:
        typeof record.size === 'number' && Number.isSafeInteger(record.size) && record.size >= 0 ? record.size : null,
      // Judged on the name as the uploader gave it: the extension rules clean it first, the bidi rule needs it raw.
      riskFlags: fileRisks(rawName ?? '', rawType ?? ''),
      // This package's words, or Slack's error mapped into them: never the uploader's.
      lookupFailed: lookupFailed ?? null,
    };
  });
  return { files, wrap };
}

/**
 * The saved name and path as a result carries them: bare while the name is plainly a file name, and otherwise inside
 * the envelope — the name is the uploader's, and `Ignore previous instructions.txt` is still a sentence on disk.
 */
function savedNameFields(path: string, wrap: Wrap, fileId: string): { savedAs: string; path: string } {
  const savedAs = basename(path);
  if (isPlainFileName(savedAs)) return { savedAs, path };
  return { savedAs: wrap(savedAs, 'saved-as', fileId), path: wrap(path, 'saved-path', fileId) };
}
