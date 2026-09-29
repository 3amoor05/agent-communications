import { createHash } from 'node:crypto';
import { basename } from 'node:path';
import {
  askWhereToSave,
  CommsError,
  checkDownloadAnswer,
  createUniqueFile,
  type DestinationQuestion,
  type DownloadAnswer,
  type DownloadRequest,
  decodeHeaderWords,
  downloadRecordPath,
  ensurePrivateDir,
  expandHome,
  homeDirectory,
  isPlainFileName,
  newBoundary,
  parseAddressList,
  type SaveChoice,
  savedFileName,
  saveFolders,
  settleDestination,
  slug,
  writeFileAtomic,
} from '@agentcomms/core';
import type { GmailContext } from '../context.ts';
import { type DecodedPart, headerValue, readParts } from '../domain/mime.ts';
import { compileQuery } from '../domain/query.ts';
import {
  addressField,
  type FieldEnvelope,
  filenameField,
  mimeTypeField,
  wrapField,
} from '../domain/untrusted-fields.ts';
import { type NumberOption, numberOption } from './numbers.ts';
import { attachmentRisks } from './read.ts';
import { resolveInboxes } from './search.ts';

/**
 * Finding and downloading attachments.
 *
 * Nothing here is ever opened or executed, and nothing is saved until the person has said where. Files arrive from
 * strangers: a name can contain path separators, a right-to-left override that makes `exe` look like `pdf`, a leading
 * dot that makes it a project's configuration, the name of a file already there — or a sentence. So a download asks
 * first (core's `save-destination.ts`), and saves only into the folder the person chose, under the name the sender
 * gave the file made safe by `savedFileName`; the write is `O_EXCL` and refuses to follow a link. What the sender
 * called the file comes back beside the path, wrapped as untrusted content, and so do the subject and the type they
 * declared — and the saved name and path too, unless the name is plainly a file name.
 */

export interface AttachmentRow {
  inbox: string;
  messageId: string;
  threadId: string;
  partId: string;
  attachmentId: string | undefined;
  /** Wrapped: the sender named it. `(unnamed)` when they did not. */
  filename: string;
  /** A bare MIME type, or wrapped when it is anything more. */
  mimeType: string;
  size: number;
  date: string | null;
  /** A bare address, or wrapped when it is anything more. */
  from: string | null;
  /** Wrapped: the sender wrote it. */
  subject: string;
  riskFlags: string[];
}

export interface FindAttachmentsOptions {
  inboxes?: string[] | 'all' | undefined;
  /** Extra Gmail syntax, combined with the filters below. */
  query?: string | undefined;
  from?: string | undefined;
  filename?: string | undefined;
  after?: string | undefined;
  before?: string | undefined;
  /** At least this many bytes, as given; checked by `findAttachments` against {@link MIN_BYTES}. */
  minBytes?: unknown;
  /** At most this many bytes, as given; checked against {@link MAX_BYTES}. */
  maxBytes?: unknown;
  mimeType?: string | undefined;
  /** How many rows, as given; checked against {@link FIND_LIMIT}. Twenty-five when left out. */
  limit?: unknown;
}

/** The filters as `attachmentQuery` writes them: sizes that have been checked. */
export type AttachmentFilters = Omit<FindAttachmentsOptions, 'minBytes' | 'maxBytes' | 'limit'> & {
  minBytes?: number | undefined;
  maxBytes?: number | undefined;
};

// 0 bytes at least is no lower bound, as it always was; at most 0 bytes was ignored, so it is refused instead.
export const MIN_BYTES: NumberOption = { flag: '--min-bytes', arg: 'minBytes', min: 0 };
export const MAX_BYTES: NumberOption = { flag: '--max-bytes', arg: 'maxBytes', min: 1 };
export const FIND_LIMIT: NumberOption = { flag: '--limit', arg: 'limit', min: 1, max: 100 };

export interface FindAttachmentsResult {
  query: string;
  rows: AttachmentRow[];
  /** Attachments held in Drive rather than in the message: there is no Drive permission, so they cannot be fetched. */
  driveLinks: number;
  errors: Array<{ inbox: string; code: string; message: string }>;
  complete: boolean;
}

/** Builds the Gmail query for the filters, so a caller does not have to know the syntax. */
export function attachmentQuery(options: AttachmentFilters): string {
  const parts = ['has:attachment'];
  if (options.from) parts.push(`from:${options.from}`);
  if (options.filename) parts.push(`filename:${options.filename}`);
  if (options.after) parts.push(`after:${options.after}`);
  if (options.before) parts.push(`before:${options.before}`);
  if (options.minBytes) parts.push(`larger:${options.minBytes}`);
  if (options.maxBytes) parts.push(`smaller:${options.maxBytes}`);
  if (options.query) parts.push(options.query);
  return parts.join(' ');
}

export async function findAttachments(
  context: GmailContext,
  options: FindAttachmentsOptions = {},
): Promise<FindAttachmentsResult> {
  // Checked before anything is read, so a number out of range is refused the same way from either surface.
  const minBytes = numberOption(context, options.minBytes, MIN_BYTES);
  const maxBytes = numberOption(context, options.maxBytes, MAX_BYTES);
  const limit = numberOption(context, options.limit, FIND_LIMIT) ?? 25;
  const config = await context.config();
  const aliases = await resolveInboxes(context, options.inboxes);
  const query = compileQuery(attachmentQuery({ ...options, minBytes, maxBytes }), {
    timezone: config.defaults.timezone,
  }).compiled;

  const rows: AttachmentRow[] = [];
  const errors: FindAttachmentsResult['errors'] = [];
  let driveLinks = 0;
  const boundary = newBoundary();

  for (const alias of aliases) {
    try {
      const resolved = await context.inbox(alias);
      await context.requireCapability(resolved, 'read');
      const transport = await context.transport(alias);
      const page = await transport.listMessages({ query, maxResults: limit });
      for (const entry of page.ids) {
        if (rows.length >= limit) break;
        const message = await transport.getMessageMetadata(entry.id);
        const headers = message.payload?.headers ?? [];
        const parts = readParts(message.payload);
        const date = message.internalDate ? new Date(Number(message.internalDate)).toISOString() : null;
        // Sender-controlled, every one, and each row leaves this function as structured data outside any envelope.
        // This path is reached by an agent triaging mail on its own initiative, so the sender does not need the user
        // to open anything: the name, the type, the address and the subject are wrapped here, or kept bare only while
        // they are nothing but an address or a MIME type.
        const envelope: FieldEnvelope = { boundary, inbox: alias, id: message.id ?? entry.id };
        const address = parseAddressList(headerValue(headers, 'From'))[0]?.address;
        const from = address === undefined ? null : addressField(address, 'from-address', envelope);
        // Decoded first, then cut, then wrapped: see `read.ts` on why the encoded form hides a forged tag.
        const subject = wrapField(
          decodeHeaderWords(headerValue(headers, 'Subject') ?? '').slice(0, 120),
          'subject',
          envelope,
        );
        for (const part of parts.attachments) {
          if (part.disposition === 'inline' && !part.filename) continue;
          const filename = part.filename ?? '(unnamed)';
          if (options.mimeType && !part.mimeType.includes(options.mimeType.toLowerCase())) continue;
          if (minBytes && part.size < minBytes) continue;
          if (maxBytes && part.size > maxBytes) continue;
          if (!part.attachmentId) {
            // A Drive link is a link in the body, not bytes in the message.
            driveLinks += 1;
            continue;
          }
          rows.push({
            inbox: alias,
            messageId: message.id ?? entry.id,
            threadId: message.threadId ?? entry.threadId ?? '',
            partId: part.partId,
            attachmentId: part.attachmentId,
            filename: filenameField(part.filename, envelope),
            mimeType: mimeTypeField(part.mimeType, envelope),
            size: part.size,
            date,
            from,
            subject,
            // Flagged on the name the file would actually be written under, not the one the sender sent:
            // `invoice.exe ` is stripped to `invoice.exe` on the way to disk, and the `$`-anchored extension checks
            // do not match the trailing space, so the executable was written and the flag was not raised.
            riskFlags: attachmentRisks(filename, part.mimeType),
          });
        }
      }
    } catch (error) {
      const failure = error as CommsError;
      errors.push({ inbox: alias, code: failure.code ?? 'UNEXPECTED', message: failure.message });
    }
  }

  rows.sort((a, b) => (b.date ?? '').localeCompare(a.date ?? ''));
  return { query, rows: rows.slice(0, limit), driveLinks, errors, complete: errors.length === 0 };
}

// ── Downloading ──────────────────────────────────────────────────────────────────────────────────────────────────

/** One attachment a download names, as the question lists it: what it is and where it came from, before any byte. */
export interface AttachmentToSave {
  messageId: string;
  /** Which attachment of the message it is: the part id Gmail gave it. */
  partId: string;
  /** Wrapped: the name the sender gave it. `(unnamed)` when they did not. */
  filename: string;
  /** What the message says it holds. The bytes saved are counted again as they arrive. */
  size: number;
  /** What the sender declared: a bare MIME type, or wrapped when it is anything more. */
  mimeType: string;
  /** A bare address, or wrapped when it is anything more. */
  from: string | null;
  /** Wrapped: the sender wrote it. */
  subject: string;
  date: string | null;
  riskFlags: string[];
}

export interface DownloadedFile {
  /** Wrapped: the name the sender gave it, as `gmail_attachments_find` shows it. `(unnamed)` when they gave none. */
  filename: string;
  /**
   * The name it was saved under: the sender's, made safe by core's `savedFileName` and never over a file already
   * there. Bare while it is plainly a file name, and wrapped otherwise — see `isPlainFileName`.
   */
  savedAs: string;
  /** Where it was saved: the folder the person chose, and `savedAs`. Wrapped whenever `savedAs` is. */
  path: string;
  /** Which attachment of the message it is: the part id Gmail gave it. */
  partId: string;
  /** The bytes written. */
  size: number;
  sha256: string;
  /** What the sender declared: a bare MIME type, or wrapped when it is anything more. */
  mimeType: string;
  messageId: string;
  /** Who sent it: a bare address, or wrapped when it is anything more. */
  from: string | null;
  /** Wrapped: the subject of the message it came with. */
  subject: string;
  date: string | null;
  /** True when an identical file (same hash) had already been written in this batch: `path` is that one's. */
  duplicate: boolean;
  riskFlags: string[];
}

export interface DownloadSkip {
  messageId: string;
  partId: string;
  reason: string;
}

/** What a download answers once it has saved — or found nothing to save. */
export interface DownloadResult {
  /** False: this is what was saved, not a question. */
  destinationRequired: false;
  /** The folder the files were saved in, as its real path; null when there was nothing to save. */
  folder: string | null;
  /** How the folder was chosen: the answer the person gave, or null when there was nothing to save. */
  chosen: SaveChoice | null;
  files: DownloadedFile[];
  skipped: DownloadSkip[];
  /**
   * This package's own record of the download, under its state directory — never in the person's folder, where
   * nothing is written but the files. Null when there was nothing to save.
   */
  manifestPath: string | null;
  totalBytes: number;
}

/** What a download answers before anything is saved: the question for the person, with the files it would save. */
export interface DownloadQuestion extends DestinationQuestion {
  files: AttachmentToSave[];
  skipped: DownloadSkip[];
  /** What the files declare, together. */
  totalBytes: number;
}

export interface DownloadOptions extends DownloadAnswer {
  /** How many files at most, as given; checked by `downloadAttachments` against {@link MAX_FILES}. */
  maxFiles?: unknown;
  maxBytes?: number | undefined;
}

export const DEFAULT_MAX_FILES = 50;
export const MAX_FILES: NumberOption = { flag: '--max-files', arg: 'maxFiles', min: 1, max: 200 };
export const DEFAULT_MAX_BYTES: number = 500 * 1024 * 1024;

const DAY = /^\d{4}-\d{2}-\d{2}$/;

/**
 * A day, `YYYY-MM-DD`, for a folder or file name — or `undated`. Gmail's time, not the sender's; still only a date or
 * nothing, since it becomes part of a path: a number that is no time at all threw, and one past the year 9999 came
 * out as `+010000-01`.
 */
export function dayOf(at: number | null | undefined): string {
  const time = new Date(at ?? Number.NaN);
  if (Number.isNaN(time.getTime())) return 'undated';
  const day = time.toISOString().slice(0, 10);
  return DAY.test(day) ? day : 'undated';
}

/** The downloads root, where exports go: `~/Downloads/agent-communications` unless the config says otherwise. */
export async function downloadsRoot(context: GmailContext): Promise<string> {
  const config = await context.config();
  const configured = config.defaults.downloadsDir;
  const root = configured ? expandHome(configured, homeDirectory(context.env)) : context.core.paths.downloadsDir;
  await ensurePrivateDir(root);
  return root;
}

/** One attachment the request names and a download would save, with the message it is on. */
interface Planned {
  readonly messageId: string;
  readonly part: DecodedPart & { attachmentId: string };
  readonly listed: AttachmentToSave;
}

/**
 * Downloads specific attachments — where the person says, and only once they have said it.
 *
 * Without an answer nothing is saved. The messages are read, and what comes back is the question: the attachments
 * the request names, by name and size, and three places to save them, the first two by their exact paths — see core's
 * `save-destination.ts`. With the person's answer and the question's `choiceId` the question is claimed, for these
 * messages and these attachments only, and each attachment is saved in the chosen folder under the name its sender
 * gave it, made safe by `savedFileName`, created exclusively and never through a link or over a file already there.
 * Nothing else is written into that folder.
 *
 * The attachment id is resolved fresh from the message each time: Gmail's ids are reported to change between fetches,
 * and a stale one fails in a way that looks like the file is gone.
 */
export async function downloadAttachments(
  context: GmailContext,
  alias: string,
  targets: Array<{ messageId: string; partId?: string | undefined; filename?: string | undefined }>,
  options: DownloadOptions = {},
): Promise<DownloadQuestion | DownloadResult> {
  // Before the mailbox is read or a folder made: no messages at all made a folder, wrote a manifest of nothing and
  // answered `files: []`, as if there had been nothing to save. The command takes one message id or more.
  if (targets.length === 0) {
    throw new CommsError('USAGE', 'name the messages whose attachments to save', {
      hint: context.surface === 'mcp' ? 'Pass one message id or more in `messageIds`.' : 'Pass one message id or more.',
    });
  }
  // Before the mailbox is read or a folder made: none at all saved nothing and said each file was one too many.
  const maxFiles = numberOption(context, options.maxFiles, MAX_FILES) ?? DEFAULT_MAX_FILES;
  // And the answer: one without the question it answers is refused before anything is read.
  const answer = checkDownloadAnswer(options, context.surface);
  const resolved = await context.inbox(alias);
  await context.requireCapability(resolved, 'read');
  const transport = await context.transport(alias);
  const maxBytes = options.maxBytes ?? DEFAULT_MAX_BYTES;

  const planned: Planned[] = [];
  const skipped: DownloadSkip[] = [];
  const boundary = newBoundary();

  for (const target of targets) {
    const message = await transport.getMessage(target.messageId);
    const parts = readParts(message.payload);
    const messageId = message.id ?? target.messageId;
    const envelope: FieldEnvelope = { boundary, inbox: alias, id: messageId };
    const headers = message.payload?.headers ?? [];
    const address = parseAddressList(headerValue(headers, 'From'))[0]?.address;
    const from = address === undefined ? null : addressField(address, 'from-address', envelope);
    // Decoded first, then cut, then wrapped: see `read.ts` on why the encoded form hides a forged tag.
    const subject = wrapField(
      decodeHeaderWords(headerValue(headers, 'Subject') ?? '').slice(0, 120),
      'subject',
      envelope,
    );
    const date = message.internalDate ? new Date(Number(message.internalDate)).toISOString() : null;
    // Which attachments this target names. `partId` picks exactly one; a `filename` picks the one with that name;
    // naming neither means every attachment on the message. That last case used to fall through to
    // `find(c => c.filename === target.filename)` with `filename` undefined — which matches an unnamed inline part,
    // a signature image say, and otherwise nothing at all. So the MCP tool, whose `partId` is optional and
    // documented as *narrowing* to one attachment, downloaded the one thing nobody asked for, or reported "no such
    // attachment" for a message plainly carrying one.
    const chosen = target.partId
      ? parts.attachments.filter((candidate) => candidate.partId === target.partId)
      : target.filename !== undefined
        ? parts.attachments.filter((candidate) => candidate.filename === target.filename)
        : parts.attachments;

    if (chosen.length === 0) {
      skipped.push({ messageId: target.messageId, partId: target.partId ?? '', reason: 'no such attachment' });
      continue;
    }

    for (const part of chosen) {
      if (planned.length >= maxFiles) {
        skipped.push({ messageId: target.messageId, partId: part.partId, reason: `more than ${maxFiles} files` });
        continue;
      }
      if (!part.attachmentId) {
        skipped.push({
          messageId: target.messageId,
          partId: part.partId,
          reason: 'this part holds no downloadable bytes (a Drive link, perhaps)',
        });
        continue;
      }
      planned.push({
        messageId: target.messageId,
        part: part as DecodedPart & { attachmentId: string },
        listed: {
          messageId: target.messageId,
          partId: part.partId,
          filename: filenameField(part.filename, envelope),
          size: part.size,
          mimeType: mimeTypeField(part.mimeType, envelope),
          from,
          subject,
          date,
          riskFlags: attachmentRisks(part.filename ?? '', part.mimeType),
        },
      });
    }
  }

  // The request as the question is bound to it: the messages and parts named, and the most it may save.
  const request: DownloadRequest = {
    target: { kind: 'inbox', name: alias, id: resolved.inbox.id },
    operation: 'attachments.download',
    request: {
      targets: targets.map((target) => ({
        messageId: target.messageId,
        partId: target.partId ?? null,
        filename: target.filename ?? null,
      })),
      maxFiles,
    },
    files: planned.map((entry) => `${entry.messageId}/${entry.part.partId}`),
  };

  const config = await context.config();
  const folders = () => saveFolders({ configured: config.defaults.downloadsDir, env: context.env, cwd: context.cwd });

  if (answer.kind === 'none') {
    // Nothing to save is said as it is, with the reasons, rather than asked about.
    if (planned.length === 0) return nothingToSave(skipped);
    const question = await askWhereToSave(context.core, {
      request,
      folders: folders(),
      configured: Boolean(config.defaults.downloadsDir),
      count: planned.length,
      bytes: planned.reduce((sum, entry) => sum + entry.part.size, 0),
      surface: context.surface,
      tool: 'gmail_attachment_download',
    });
    return {
      ...question,
      files: planned.map((entry) => entry.listed),
      skipped,
      totalBytes: planned.reduce((sum, entry) => sum + entry.part.size, 0),
    };
  }
  // A person's own `--to` with nothing to save has nothing to decide; an answer to a question is claimed whatever the
  // request holds now, so that one asked about other files is refused rather than answered with nothing.
  if (answer.kind === 'person' && planned.length === 0) return nothingToSave(skipped);

  const destination = await settleDestination(context.core, { answer, request, folders, env: context.env });
  const files: DownloadedFile[] = [];
  const seenHashes = new Map<string, { path: string; savedAs: string }>();
  let totalBytes = 0;

  for (const { messageId, part, listed } of planned) {
    if (totalBytes + part.size > maxBytes) {
      skipped.push({ messageId, partId: part.partId, reason: `more than ${maxBytes} bytes in one batch` });
      continue;
    }
    const bytes = await transport.getAttachment(messageId, part.attachmentId);
    const sha256 = createHash('sha256').update(bytes).digest('hex');
    const envelope: FieldEnvelope = { boundary, inbox: alias, id: messageId };
    const existing = seenHashes.get(sha256);
    if (existing) {
      files.push({ ...savedFields(listed, existing), size: bytes.byteLength, sha256, duplicate: true });
      continue;
    }

    // Under the sender's name, made safe; the part's own id when nothing of the name is left.
    const name = savedFileName(
      decodeHeaderWords(part.filename ?? ''),
      `${slug(messageId, 64, 'message')}-part-${slug(part.partId, 32, 'root')}`,
    );
    const { path, handle } = await createUniqueFile(destination.folder, name);
    try {
      await handle.writeFile(bytes);
    } finally {
      await handle.close();
    }
    const shown = savedNameFields(path, envelope);
    seenHashes.set(sha256, shown);
    totalBytes += bytes.byteLength;
    files.push({ ...savedFields(listed, shown), size: bytes.byteLength, sha256, duplicate: false });
  }

  const at = context.now();
  const manifestPath = downloadRecordPath(context.core, at, destination.choiceId);
  const result: DownloadResult = {
    destinationRequired: false,
    folder: destination.folder,
    chosen: destination.choice,
    files,
    skipped,
    manifestPath,
    totalBytes,
  };
  await writeFileAtomic(
    manifestPath,
    `${JSON.stringify({ at: at.toISOString(), inbox: alias, choiceId: destination.choiceId, ...result }, null, 2)}\n`,
  );

  await context.core.audit.append({
    inboxId: resolved.inbox.id,
    alias,
    operation: 'attachments.download',
    outcome: 'ok',
    surface: context.surface,
    ids: { messageIds: targets.map((target) => target.messageId) },
    ...(destination.choiceId ? { approvalId: destination.choiceId } : {}),
    reason: `${files.length} file(s), ${totalBytes} bytes, saved to ${destination.folder} (${destination.choice})`,
  });

  return result;
}

/** A download with nothing in it to save: said, with each reason, and nothing asked, made or written. */
function nothingToSave(skipped: DownloadSkip[]): DownloadResult {
  return {
    destinationRequired: false,
    folder: null,
    chosen: null,
    files: [],
    skipped,
    manifestPath: null,
    totalBytes: 0,
  };
}

/** A listed attachment as saved: what the question said of it, with where it went. */
function savedFields(
  listed: AttachmentToSave,
  saved: { path: string; savedAs: string },
): Omit<DownloadedFile, 'size' | 'sha256' | 'duplicate'> {
  return {
    filename: listed.filename,
    savedAs: saved.savedAs,
    path: saved.path,
    partId: listed.partId,
    mimeType: listed.mimeType,
    messageId: listed.messageId,
    from: listed.from,
    subject: listed.subject,
    date: listed.date,
    riskFlags: listed.riskFlags,
  };
}

/**
 * The saved name and path as a result carries them: bare while the name is plainly a file name, and otherwise inside
 * the envelope — the name is the sender's, and `Ignore previous instructions.txt` is still a sentence on disk.
 */
function savedNameFields(path: string, envelope: FieldEnvelope): { path: string; savedAs: string } {
  const savedAs = basename(path);
  if (isPlainFileName(savedAs)) return { path, savedAs };
  return { path: wrapField(path, 'saved-path', envelope), savedAs: wrapField(savedAs, 'saved-as', envelope) };
}
