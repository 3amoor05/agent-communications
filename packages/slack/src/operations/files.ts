import { createHash } from 'node:crypto';
import { mkdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import {
  CommsError,
  createUniqueFile,
  ensurePrivateDir,
  expandHome,
  fileRisks,
  homeDirectory,
  keptExtension,
  newBoundary,
  relativeSubpath,
  resolveInsideRoot,
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
 * Saving files from Slack to disk: by id, from one message, or from a conversation.
 *
 * Gmail's attachment download is the model, with its weak spots fixed. Nothing is ever opened or run, and nothing is
 * written outside the downloads root. No part of a saved path is anybody's words: a file is saved as
 * `<date>_<channel>-<ts>/<file id>[.ext]`, every part of it Slack's own ids and times, checked against a pattern before
 * it is joined to anything. The write is exclusive and refuses to follow a link, the manifest is replaced by a rename
 * rather than written through whatever is at its path, and the name, title, uploader and type — which the uploader
 * chose — come back beside the path, each inside the untrusted-content envelope.
 *
 * The bytes come through the guarded transport (`api/download.ts`), which is the only thing here that sends the token
 * anywhere but the Slack Web API. This module never decides whether an address is safe to follow: it hands the
 * transport the address Slack gave and the file it was looked up as, and turns each refusal into a sentence. One file
 * that cannot be fetched is skipped with its reason and the rest carry on; the manifest and the audit record are
 * written for whatever was saved, however the run ends.
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
 * Each of these becomes part of a path on disk or of the address the transport checks, so each is held to the shape
 * Slack gives it — capital letters and digits after a one-letter kind — before it is used. A conversation is a public
 * or private channel (`C`), a group DM or an older private channel (`G`), or a DM (`D`). A message timestamp is
 * seconds, a dot and a fraction; `since` may leave the fraction out.
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

export interface FileDownloadRequest {
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
  /** A folder inside the workspace's own downloads folder. Never absolute, never climbing out. */
  out?: string | undefined;
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
  /** `out`, checked: a relative subpath, `''` when none was given. */
  readonly out: string;
  readonly maxFiles: number;
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
 * Which files a download names, how many it may save and where: checked, or the USAGE refusal.
 *
 * Exactly one way of naming files — ids; a conversation and a message timestamp; or a conversation alone, from a
 * timestamp on — because two at once is a caller who meant one of them, and guessing which would save files nobody
 * asked for. Each id is held to Slack's shape here, before anything is read: every one of them becomes part of a path
 * or of the address the transport checks.
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
  const out = relativeSubpath(request.out);
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
    return { selection: { kind: 'files', fileIds }, out, maxFiles };
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
    return { selection: { kind: 'message', channel: conversation, ts }, out, maxFiles };
  }
  if (since !== undefined && !SINCE_TS.test(since)) {
    refuse(`${quoted(since)} is not a Slack timestamp`, 'A timestamp looks like 1700000000 or 1700000000.000100.');
  }
  return {
    selection: { kind: 'channel', channel: conversation, ...(since === undefined ? {} : { since }) },
    out,
    maxFiles,
  };
}

// ── What comes back ────────────────────────────────────────────────────────────────────────────────────────────────

export interface SavedSlackFile {
  /** Slack's id for the file, which also names the saved file. */
  readonly fileId: string;
  /** Where it was saved. Every part of it is this package's own — workspace, date, ids — and none of it the uploader's. */
  readonly path: string;
  /** The conversation and message it was saved under, or null for `undated_<file id>`: Slack's ids, never words. */
  readonly channel: string | null;
  readonly ts: string | null;
  /** Wrapped: the name the uploader gave it. The file is not saved under it. `(unnamed)` when there was none. */
  readonly name: string;
  /** Wrapped, or null when it has none. */
  readonly title: string | null;
  /** Who uploaded it: Slack's id, and the name they go by — wrapped, since anybody can change their own. */
  readonly uploader: { readonly id: string | null; readonly name: string | null };
  /** What the uploader's client declared: a bare MIME type, wrapped when it is anything more, or null. */
  readonly mimetype: string | null;
  /** The bytes written. */
  readonly size: number;
  readonly sha256: string;
  readonly riskFlags: readonly string[];
}

export interface SkippedSlackFile {
  readonly fileId: string;
  /** Why, in a sentence. */
  readonly reason: string;
  /**
   * The same, as a word to branch on: one of the transport's refusals (`external`, `wrong-host`, `wrong-path`,
   * `redirect`, `sign-in-page`, `too-large`, `http-error`, `network`), or `max-files`, `lookup`, `deleted`, `hidden`,
   * `no-address`, `bad-id`, `unexpected`.
   */
  readonly cause: string;
}

export interface FileDownloadResult {
  readonly workspace: string;
  readonly selection: FileSelection;
  /** The workspace's folder, with `out`: where the manifest is. */
  readonly directory: string;
  readonly files: readonly SavedSlackFile[];
  readonly skipped: readonly SkippedSlackFile[];
  readonly manifestPath: string;
  readonly totalBytes: number;
  /** False when the most files a run may save left some unread: skipped as `max-files`, or never listed. */
  readonly complete: boolean;
}

// ── The run ────────────────────────────────────────────────────────────────────────────────────────────────────────

function list(value: unknown): Raw[] {
  return Array.isArray(value) ? (value.filter((v) => typeof v === 'object' && v !== null) as Raw[]) : [];
}

function str(value: unknown): string | undefined {
  return typeof value === 'string' && value !== '' ? value : undefined;
}

/** The downloads root: `~/Downloads/agent-communications` unless the config says otherwise — Gmail's root, too. */
async function downloadsRoot(context: SlackContext): Promise<string> {
  const config = await context.config();
  const configured = config.defaults.downloadsDir;
  const root = configured ? expandHome(configured, homeDirectory(context.env)) : context.core.paths.downloadsDir;
  await ensurePrivateDir(root);
  return root;
}

/** A Slack timestamp's day, `YYYY-MM-DD` in UTC, for a folder name — or `undated`. Only ever a date or nothing. */
function dayOf(ts: string): string {
  const time = new Date(Number(ts.split('.')[0]) * 1000);
  if (Number.isNaN(time.getTime())) return 'undated';
  const day = time.toISOString().slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(day) ? day : 'undated';
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
 * the message that carried it. Only well-formed ids and timestamps count, since both become a folder name.
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

/**
 * The message a file is saved under, as a folder: `<day>_<channel>-<ts>`, or `undated_<file id>` when none is known.
 */
function folderOf(fileId: string, message: { channel: string; ts: string } | undefined): string {
  return message ? `${dayOf(message.ts)}_${message.channel}-${message.ts}` : `undated_${fileId}`;
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
      // Refused before a folder is made: a message with nothing to save would otherwise leave a manifest of nothing.
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

/** A file that was saved, as the run kept it, before its fields are made safe to hand back. */
interface Saved {
  readonly fileId: string;
  readonly path: string;
  readonly message: { channel: string; ts: string } | undefined;
  readonly record: Raw;
  readonly size: number;
  readonly sha256: string;
}

/**
 * Saves the files a request names under the downloads root, and reports each one saved or skipped.
 *
 * Each is saved as `<downloads>/<workspace>/<out>/<date>_<channel>-<ts>/<file id>[.ext]`, in the message it was
 * shared in — the one named, or the file's first share, or `undated_<file id>` when Slack lists none. The extension is
 * kept only for a common document or image type (core's `keptExtension`). `<out>` is refused if it is absolute or
 * climbs out, before anything is joined to it, and every folder is resolved inside the root after links are followed.
 *
 * No file may be more than 100 MiB and no run more than 500 MiB: the transport is handed the smaller of the file's cap
 * and what is left of the run's, and holds the bytes it receives to it.
 */
export async function downloadFiles(
  context: SlackContext,
  session: WorkspaceSession,
  request: FileDownloadRequest,
  deps: FileDownloadDeps = {},
): Promise<FileDownloadResult> {
  const plan = downloadSelection({ ...request, surface: request.surface ?? context.surface });
  const download = deps.download ?? slackFileDownload;
  const caps = capsOf(deps);
  const { call, name: workspace } = session;

  // What to save is found before a folder is made: a message that does not exist, or has no files, makes nothing.
  const found = await candidatesFor(call, plan);

  const root = await downloadsRoot(context);
  const directory = await resolveInsideRoot(root, join(workspace, plan.out));
  await mkdir(directory, { recursive: true, mode: 0o700 });

  const saved: Saved[] = [];
  const skipped: SkippedSlackFile[] = [];
  const skip = (fileId: string, refusal: { cause: string; reason: string }) => {
    skipped.push({ fileId, reason: refusal.reason, cause: refusal.cause });
  };
  let complete = found.complete;
  let totalBytes = 0;
  // Boxed, so that even something thrown as `undefined` still counts as the run having stopped.
  let stopped: { readonly error: unknown } | undefined;
  const seen = new Set<string>();
  let reached = 0;

  try {
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
      /*
       * A listing names the conversations a file is in, not the message: Slack documents `files.list` records with
       * `channels`, `groups` and `ims` and no `shares`, which `files.info` has, with each message's timestamp. Without
       * one the file would be saved as `undated_<id>` although it was shared in the very conversation asked about, so
       * it is looked up by id — as a message's files are, and as `--file` already pays for. Should the lookup fail,
       * the listing's own record still says where the bytes are, and the file is saved as undated.
       */
      if (record !== undefined && firstShare(record) === undefined) {
        try {
          const response = await callSlack(call, 'files.info', { file: fileId });
          const own = response.file;
          if (typeof own === 'object' && own !== null) record = own as Raw;
        } catch {
          // Kept as listed.
        }
      }
      if (record === undefined) {
        try {
          const response = await callSlack(call, 'files.info', { file: fileId });
          record = (response.file as Raw | undefined) ?? {};
        } catch (error) {
          // One file Slack will not describe — gone, or in a conversation this account is not in — is one file.
          skip(fileId, { cause: 'lookup', reason: error instanceof Error ? error.message : String(error) });
          continue;
        }
      }
      const refused = unfetchable(record, fileId);
      if (refused) {
        skip(fileId, refused);
        continue;
      }

      const left = caps.perRun - totalBytes;
      const maxBytes = Math.min(caps.perFile, left);
      // Slack's own figure, when it gives one, spares a fetch that could only be refused. The bytes received are
      // still what the cap is held to: this is a shortcut, never the check.
      const declared = typeof record.size === 'number' ? record.size : undefined;
      if (maxBytes <= 0 || (declared !== undefined && declared > maxBytes)) {
        skip(fileId, { cause: 'too-large', reason: tooLarge(maxBytes, caps) });
        continue;
      }

      const url = (str(record.url_private_download) ?? str(record.url_private)) as string;
      const uploaderTeam = str(record.user_team);
      const teamId = uploaderTeam !== undefined && TEAM_ID.test(uploaderTeam) ? uploaderTeam : session.teamId;
      let body: SlackFileBody;
      try {
        body = await download(call, { url, teamId, fileId, maxBytes });
      } catch (error) {
        skip(fileId, refusalOf(error, record, maxBytes, caps));
        continue;
      }
      // The transport holds the bytes to the cap. Checked again before anything is written, because a cap that holds
      // only while one other module is right is a cap on that module, not on the disk.
      if (body.bytes.byteLength > maxBytes) {
        skip(fileId, { cause: 'too-large', reason: tooLarge(maxBytes, caps) });
        continue;
      }

      const message =
        candidate.message ?? firstShare(record, plan.selection.kind === 'channel' ? plan.selection.channel : undefined);
      const folder = await resolveInsideRoot(root, join(workspace, plan.out, folderOf(fileId, message)));
      await mkdir(folder, { recursive: true, mode: 0o700 });
      const { path, handle } = await createUniqueFile(folder, `${fileId}${keptExtension(str(record.name) ?? '')}`);
      try {
        await handle.writeFile(body.bytes);
        await handle.close();
      } catch (error) {
        /*
         * A file cut short is worse than none. It looks like the file, under the file's own name, and neither the
         * manifest nor the audit lists it — and a run again saves the whole one beside it as `-2`. So it is removed
         * before the failure goes on; the path was created here, exclusively, so what is removed is this run's own.
         */
        await handle.close().catch(() => undefined);
        await rm(path, { force: true }).catch(() => undefined);
        throw error;
      }
      totalBytes += body.bytes.byteLength;
      saved.push({
        fileId,
        path,
        message,
        record,
        size: body.bytes.byteLength,
        sha256: createHash('sha256').update(body.bytes).digest('hex'),
      });
    }
  } catch (error) {
    // A file that could not be written, or a folder that could not be made, is this machine's problem and stops the
    // run. What was saved before it is still recorded, below, before the failure is reported.
    stopped = { error };
  }

  const files = await describe(call, workspace, saved);
  const manifestPath = join(directory, 'manifest.json');
  const result: FileDownloadResult = {
    workspace,
    selection: plan.selection,
    directory,
    files,
    skipped,
    manifestPath,
    totalBytes,
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
    /*
     * Replaced by a rename, never written in place. `writeFile` on `manifest.json` follows a link somebody left at that
     * path and writes the manifest wherever it points; a temporary file created exclusively beside it and renamed over
     * it replaces the link itself.
     */
    await writeFileAtomic(manifestPath, `${JSON.stringify({ at: context.now().toISOString(), ...result }, null, 2)}\n`);
  } catch (error) {
    manifestFailure = { error };
  }
  let auditFailure: { readonly error: unknown } | undefined;
  try {
    // The first Slack read that is audited: it leaves files on this machine, and the record says which and how many.
    await context.core.audit.append({
      inboxId: session.accountId,
      alias: workspace,
      operation: 'files.download',
      outcome: stopped === undefined && manifestFailure === undefined ? 'ok' : 'failed',
      surface: context.surface,
      ids: {
        fileIds: files.map((file) => file.fileId),
        skippedFileIds: skipped.map((entry) => entry.fileId),
        ...(plan.selection.kind === 'files' ? {} : { channel: plan.selection.channel }),
        ...(plan.selection.kind === 'message' ? { ts: plan.selection.ts } : {}),
      },
      reason: `${files.length} file(s), ${totalBytes} bytes; ${skipped.length} skipped${
        manifestFailure === undefined ? '' : '; manifest.json not written'
      }`,
    });
  } catch (error) {
    auditFailure = { error };
  }

  if (stopped === undefined && manifestFailure === undefined && auditFailure === undefined) return result;
  throw unfinished({ stopped, manifestFailure, auditFailure, files, manifestPath });
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
 * many were saved and which record lists them, and carries their ids and paths in `details` for when neither record
 * could be written. A refusal the run stopped on keeps its own code and hint; anything else is `CONFIG`, as another
 * file this machine could not write is.
 */
function unfinished(state: {
  readonly stopped: { readonly error: unknown } | undefined;
  readonly manifestFailure: { readonly error: unknown } | undefined;
  readonly auditFailure: { readonly error: unknown } | undefined;
  readonly files: readonly SavedSlackFile[];
  readonly manifestPath: string;
}): CommsError {
  const { stopped, manifestFailure, auditFailure, files, manifestPath } = state;
  const cause = (stopped ?? manifestFailure ?? auditFailure)?.error;
  const own = cause instanceof CommsError ? cause : undefined;
  const count = files.length;
  const them = count === 1 ? 'it' : 'them';
  const listed =
    manifestFailure === undefined
      ? `manifest.json lists ${them}`
      : auditFailure === undefined
        ? 'the audit log records which'
        : `\`savedFiles\` in this error lists ${them}`;

  // Said only when it is true: a run that saved nothing — every file skipped — has nothing to say was saved.
  const savedSoFar = count === 0 ? '' : `${count === 1 ? 'the file was' : 'the files were'} saved`;
  let message: string;
  if (stopped !== undefined) message = `the download stopped part-way: ${messageOf(stopped.error)}`;
  else if (manifestFailure !== undefined) {
    message = `${savedSoFar === '' ? '' : `${savedSoFar}, but `}manifest.json could not be written: ${messageOf(manifestFailure.error)}`;
  } else {
    message = `${savedSoFar === '' ? '' : `${savedSoFar} and manifest.json lists ${them}, but `}the audit log could not be written: ${messageOf(auditFailure?.error)}`;
  }
  const saved =
    count === 0
      ? 'Nothing was saved.'
      : `${count === 1 ? '1 file was' : `${count} files were`} saved${stopped === undefined ? '' : ' before it stopped'}, and ${listed}. Running it again saves each of ${them} again, as a second copy, so ask only for what is missing.`;

  return new CommsError(own?.code ?? 'CONFIG', message, {
    hint: own?.hint === undefined ? saved : `${own.hint} ${saved}`,
    details: {
      ...(own?.details ?? {}),
      saved: count,
      savedFiles: files.map((file) => ({ fileId: file.fileId, path: file.path })),
      manifestPath: manifestFailure === undefined ? manifestPath : null,
      audited: auditFailure === undefined,
    },
    cause,
  });
}

/**
 * The saved files as they are handed back: every field the uploader chose inside the envelope, one boundary for the
 * whole result, and the uploader's name looked up once per person — bounded, and an id when it cannot be had.
 */
async function describe(call: SlackCall, workspace: string, saved: readonly Saved[]): Promise<SavedSlackFile[]> {
  const boundary = newBoundary();
  const wrap = (text: string, field: string, fileId: string) =>
    wrapUntrusted(text, { field, inbox: workspace, id: fileId }, boundary);
  const book = new NameBook();
  const uploaders = saved.map(({ record }) => str(record.user)).filter((id) => id !== undefined && USER_ID.test(id));
  await book.learnPeople(call, new Set(uploaders as string[]));

  return saved.map(({ fileId, path, message, record, size, sha256 }) => {
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
      path,
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
      size,
      sha256,
      // Judged on the name as the uploader gave it: the extension rules clean it first, the bidi rule needs it raw.
      riskFlags: fileRisks(rawName ?? '', rawType ?? ''),
    };
  });
}
