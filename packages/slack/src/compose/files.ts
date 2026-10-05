import { createHash } from 'node:crypto';
import { type BigIntStats, constants } from 'node:fs';
import { type FileHandle, lstat, open, realpath } from 'node:fs/promises';
import { basename, extname, resolve } from 'node:path';
import { type AttachPolicy, CommsError, checkAttachable, expandHome } from '@agentcomms/core';

/**
 * Local files on a draft: which ones may be named, and what is recorded about each.
 *
 * A file is named by its path, and the draft records what it is rather than what it holds: the real path, the name it
 * will have in Slack, its size, its SHA-256 and its type. Never the bytes. They stay where they are, and are read again
 * when the post is prepared and again when it is sent, and matched to this record each time — so what a person
 * approves is these files as they were recorded, and nothing that changed since goes out under that approval.
 *
 * Which files: the rule Gmail's attachments follow, from core's attachment jail, unchanged. Under the allowed folders
 * (`defaults.attachRoots`, the home folder unless someone changed it), outside the deny list — every hidden folder in
 * the home, the configuration folder, `.git` folders and `.env` files anywhere — and by its real path, as a regular
 * file. And one rule more, because a file named here is read again later: it is named by itself. A link at the name
 * given is refused rather than followed, so what the draft records is the file the person pointed at, and the record
 * cannot be pointed somewhere else between now and the send by changing where the link goes.
 */

export interface SlackDraftFile {
  /** The real path, as the jail resolved it: where the bytes are read from again, at prepare and at send. */
  readonly path: string;
  /** The name Slack shows: the file's own, never one an agent typed. */
  readonly name: string;
  readonly size: number;
  readonly sha256: string;
  /** From the name's extension: what the preview says the file is, and what the approval is bound to. */
  readonly mimeType: string;
}

/** The most files one post carries. */
export const MAX_FILES: number = 10;

/** The most bytes one file may have: 100 MiB. */
export const MAX_FILE_BYTES: number = 100 * 1024 * 1024;

/** Above this a file is still sent, and the preview says how large it is: 10 MiB. */
export const WARN_FILE_BYTES: number = 10 * 1024 * 1024;

/*
 * A file is opened without following a link at its own name, and without waiting on one that is not a file: a FIFO
 * put in the file's place would hold a blocking open until something wrote to it. Neither flag exists on Windows,
 * where the link was refused by `lstat` already and there are no FIFOs to open.
 */
const READ_FLAGS =
  process.platform === 'win32' ? constants.O_RDONLY : constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK;

/**
 * For tests only: what runs between the steps of one read, so a test can move a file at exactly those moments.
 *
 * `beforeOpen` runs after the file was looked at and judged and before it is opened; `afterRead` after its bytes were
 * read and before its name is looked at again. Nothing in the package sets either, and neither is exported from the
 * package root.
 */
export const TEST_ONLY_HOOKS: { beforeOpen?: (path: string) => void; afterRead?: (path: string) => void } = {};

/** How much of a file is read at a time: enough to be quick, little enough that a large file is never all in memory. */
const CHUNK = 1024 * 1024;

/*
 * The type a file is recorded with, by its extension. What Slack itself decides it is may differ, and does not matter
 * here: this is what the person is shown and what the approval binds, so it only has to be the same every time the
 * same name is read — which a lookup by extension is, and a guess from the contents would not have to be.
 */
const TYPES: Readonly<Record<string, string>> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.bmp': 'image/bmp',
  '.heic': 'image/heic',
  '.pdf': 'application/pdf',
  '.txt': 'text/plain',
  '.log': 'text/plain',
  '.md': 'text/markdown',
  '.markdown': 'text/markdown',
  '.csv': 'text/csv',
  '.tsv': 'text/tab-separated-values',
  '.json': 'application/json',
  '.yaml': 'text/yaml',
  '.yml': 'text/yaml',
  '.xml': 'text/xml',
  '.html': 'text/html',
  '.css': 'text/css',
  '.js': 'text/javascript',
  '.mjs': 'text/javascript',
  '.ts': 'text/x-typescript',
  '.py': 'text/x-python',
  '.rb': 'text/x-ruby',
  '.go': 'text/x-go',
  '.rs': 'text/x-rust',
  '.java': 'text/x-java',
  '.c': 'text/x-c',
  '.h': 'text/x-c',
  '.cpp': 'text/x-c++',
  '.sh': 'text/x-shellscript',
  '.sql': 'text/x-sql',
  '.diff': 'text/x-diff',
  '.patch': 'text/x-diff',
  '.ics': 'text/calendar',
  '.zip': 'application/zip',
  '.gz': 'application/gzip',
  '.mp3': 'audio/mpeg',
  '.mp4': 'video/mp4',
  '.mov': 'video/quicktime',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
};

/** The type a file of this name is recorded as. Anything not listed is `application/octet-stream`. */
export function mimeTypeOf(name: string): string {
  return TYPES[extname(name).toLowerCase()] ?? 'application/octet-stream';
}

/**
 * Whether Slack shows a file of this type in the channel itself, rather than as a name to click.
 *
 * Images and PDFs are previewed, and text of every kind — plain, Markdown, CSV, JSON, code — opens as a snippet
 * anyone in the room reads without downloading anything. Worth a warning: what a person may take for "a file I am
 * sending" is, for these, its contents shown to everyone.
 */
export function showsInline(mimeType: string): boolean {
  return (
    mimeType.startsWith('image/') ||
    mimeType.startsWith('text/') ||
    ['application/pdf', 'application/json'].includes(mimeType)
  );
}

/** Refuses a list of files longer than one post carries, before any of them is read. */
export function checkFileCount(count: number): void {
  if (count > MAX_FILES) {
    throw new CommsError('USAGE', `a post carries at most ${MAX_FILES} files, and this would be ${count}`, {
      hint: `Send the rest in a second post, or put them in one archive.`,
      details: { maxFiles: MAX_FILES, count },
    });
  }
}

function tooLarge(shown: string): CommsError {
  return new CommsError('BAD_DATA', `${shown} is larger than 100 MiB, the most one file may be`, {
    hint: 'Share a link to it instead, or send a smaller file.',
    details: { maxBytes: MAX_FILE_BYTES },
  });
}

function notRegular(shown: string): CommsError {
  return new CommsError('BAD_DATA', `${shown} is not a regular file`, {
    hint: 'Name a file: not a folder, a device or a pipe.',
  });
}

function moved(shown: string): CommsError {
  return new CommsError('BAD_DATA', `${shown} moved while it was being read`, {
    hint: 'Wait until nothing is moving or replacing it, or a folder above it, then try again.',
  });
}

/** Whether two looks at a file saw the same file: the same device and the same file on it, whatever its name. */
function sameFile(a: BigIntStats, b: BigIntStats): boolean {
  return a.dev === b.dev && a.ino === b.ino;
}

/** A look at a name that does not follow it, with identities exact: on Windows a file's index does not fit a number. */
function look(path: string): Promise<BigIntStats> {
  return lstat(path, { bigint: true });
}

function isALink(shown: string): CommsError {
  return new CommsError('BAD_DATA', `${shown} is a link, and a file is named by itself`, {
    hint: 'Name the file the link points to, if that is the one you mean.',
  });
}

/** What an error from the file system means here, in the words a person needs. */
function unreadable(error: unknown, shown: string): CommsError {
  if (error instanceof CommsError) return error;
  const code = (error as NodeJS.ErrnoException).code;
  if (code === 'ENOENT' || code === 'ENOTDIR') return new CommsError('NOT_FOUND', `no file at ${shown}`);
  // What `O_NOFOLLOW` answers for a link at the name: it became one after `lstat` looked.
  if (code === 'ELOOP') return isALink(shown);
  return new CommsError('BAD_DATA', `${shown} could not be read: ${(error as Error).message}`);
}

/**
 * Reads an open file from its start to its end, handing each piece to `take`, and returns how many bytes it held.
 *
 * Checked against the size `fstat` gave when it was opened, both ways: a file that grows past the limit while it is
 * read stops being read, and one that is not the length it said is refused rather than recorded half-read.
 */
async function readThrough(
  handle: FileHandle,
  size: number,
  shown: string,
  take: (piece: Buffer) => void,
): Promise<void> {
  const buffer = Buffer.alloc(Math.max(1, Math.min(CHUNK, size)));
  let total = 0;
  for (;;) {
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, total);
    if (bytesRead === 0) break;
    total += bytesRead;
    if (total > MAX_FILE_BYTES) throw tooLarge(shown);
    take(Buffer.from(buffer.subarray(0, bytesRead)));
  }
  if (total !== size) {
    throw new CommsError('BAD_DATA', `${shown} changed while it was being read`, {
      hint: 'Wait until nothing is writing to it, then try again.',
    });
  }
}

/**
 * Opens one file that is already known to be admitted, and measures it: its size, its hash, and, when asked, its bytes.
 *
 * Every limit is checked on the open file, from `fstat`, before anything is read — so a file too large is refused
 * without a byte of it read, and what is measured is the file that was opened rather than whatever the name points
 * to by the time a second call looks.
 *
 * And it has to be the file that was judged. `expected` is what the caller's own `lstat` saw before the jail judged
 * the path; the open file must be that one — the same device, the same file on it — and after the read the path must
 * still be its own real path and still name that file. Between the judging and the opening, a folder above the file
 * could be swapped for a link to somewhere else: `O_NOFOLLOW` guards only the file's own name, and Windows has no such
 * flag at all. Checked this way, with nothing particular to any platform, a file that moved in either gap is refused.
 */
async function measure(
  real: string,
  shown: string,
  keep: boolean,
  expected: BigIntStats,
): Promise<{ size: number; sha256: string; bytes: Buffer | undefined }> {
  TEST_ONLY_HOOKS.beforeOpen?.(real);
  let handle: FileHandle;
  try {
    handle = await open(real, READ_FLAGS);
  } catch (error) {
    throw unreadable(error, shown);
  }
  let measured: { size: number; sha256: string; bytes: Buffer | undefined };
  try {
    const info = await handle.stat({ bigint: true });
    if (!info.isFile()) throw notRegular(shown);
    if (!sameFile(info, expected)) throw moved(shown);
    const size = Number(info.size);
    if (size === 0) {
      throw new CommsError('BAD_DATA', `${shown} is empty`, { hint: 'There is nothing in it to send.' });
    }
    if (size > MAX_FILE_BYTES) throw tooLarge(shown);
    const hash = createHash('sha256');
    const pieces: Buffer[] = [];
    await readThrough(handle, size, shown, (piece) => {
      hash.update(piece);
      if (keep) pieces.push(piece);
    });
    measured = { size, sha256: hash.digest('hex'), bytes: keep ? Buffer.concat(pieces, size) : undefined };
  } catch (error) {
    throw unreadable(error, shown);
  } finally {
    await handle.close();
  }
  TEST_ONLY_HOOKS.afterRead?.(real);
  // After the read: the name still leads, by its real path, to the file that was read.
  let after: BigIntStats;
  let where: string;
  try {
    after = await look(real);
    where = await realpath(real);
  } catch {
    throw moved(shown);
  }
  if (where !== real) throw moved(shown);
  if (!sameFile(after, expected)) throw moved(shown);
  return measured;
}

/**
 * Checks one file named for a draft, and says what it is.
 *
 * In this order, each before anything the next one does: the name itself is looked at without following it — a link
 * or anything that is not a regular file is refused there, before it is opened — then core's attachment jail judges
 * the real path, and only then is the file opened, measured against the limits, hashed and typed.
 */
export async function recordFile(given: string, policy: AttachPolicy): Promise<SlackDraftFile> {
  const requested = resolve(expandHome(given, policy.home));
  let info: BigIntStats;
  try {
    info = await look(requested);
  } catch (error) {
    throw unreadable(error, given);
  }
  if (info.isSymbolicLink()) throw isALink(given);
  if (!info.isFile()) throw notRegular(given);
  // The folders the person allows, and none of the ones never sent: the rule Gmail's attachments follow.
  const real = await checkAttachable(requested, policy);
  const name = basename(real);
  // The file the look above saw, and no other, is the one measured: see `measure`.
  const { size, sha256 } = await measure(real, given, false, info);
  return { path: real, name, size, sha256, mimeType: mimeTypeOf(name) };
}

/**
 * Checks every file named for a draft, in the order given, on top of the `already` it has.
 *
 * The count first, so an eleventh file is refused before the first is read; then each file, and the first refusal
 * stops the lot — a draft is written with every file it was given, or not at all.
 */
export async function recordFiles(
  paths: readonly string[],
  policy: AttachPolicy,
  already = 0,
): Promise<SlackDraftFile[]> {
  checkFileCount(already + paths.length);
  const recorded: SlackDraftFile[] = [];
  for (const path of paths) recorded.push(await recordFile(path, policy));
  return recorded;
}

/** A recorded file read again: whether it is still the file recorded, and why not when it is not. */
export type FileCheck = { readonly ok: true } | { readonly ok: false; readonly why: string };

/** A recorded file read again for sending: its bytes, when it is still the file recorded — or why it is not. */
export type FileRead = { readonly ok: true; readonly bytes: Buffer } | { readonly ok: false; readonly why: string };

/**
 * Reads a recorded file again, and hands back its bytes only if it is still, in every way the draft recorded, that
 * file.
 *
 * The same checks as recording it, from the record's side: the name and type are the ones its path gives; the path is
 * not a link, is a regular file, and is still its own real path — so no folder above it was swapped for a link to
 * somewhere else; core's jail still admits it; and opened without following a link, it is the recorded size and has
 * the recorded hash. What comes back is the bytes that were just hashed, never a copy kept from before.
 *
 * The answer is a value rather than a throw, because the gate says it differently at each step: at prepare nothing has
 * been approved yet, and at send the approval it voids is named.
 */
export async function rereadFile(file: SlackDraftFile, policy: AttachPolicy): Promise<FileRead> {
  return recheck(file, policy, true) as Promise<FileRead>;
}

/**
 * The same checks as {@link rereadFile}, keeping nothing: for when every file has to be checked before any is sent, and
 * ten files of 100 MiB each are not all to be held in memory at once to do it.
 */
export async function checkRecordedFile(file: SlackDraftFile, policy: AttachPolicy): Promise<FileCheck> {
  const check = await recheck(file, policy, false);
  return check.ok ? { ok: true } : check;
}

async function recheck(
  file: SlackDraftFile,
  policy: AttachPolicy,
  keep: boolean,
): Promise<FileRead | { readonly ok: true; readonly bytes: undefined }> {
  const not = (why: string): { ok: false; why: string } => ({ ok: false, why });
  // Nothing but this package writes these, and it writes them from the path: a record saying otherwise was edited.
  if (file.name !== basename(file.path) || file.mimeType !== mimeTypeOf(file.name)) {
    return not('its record was changed outside agent-communications');
  }
  let info: BigIntStats;
  let real: string;
  try {
    info = await look(file.path);
    real = await realpath(file.path);
  } catch {
    return not('it is no longer there');
  }
  if (info.isSymbolicLink()) return not('a link has been put in its place');
  if (!info.isFile()) return not('it is no longer a regular file');
  if (real !== file.path) return not('its path now leads somewhere else');
  try {
    if ((await checkAttachable(file.path, policy)) !== file.path) return not('its path now leads somewhere else');
  } catch (error) {
    return not(`it may no longer be sent: ${(error as Error).message}`);
  }
  let measured: { size: number; sha256: string; bytes: Buffer | undefined };
  try {
    measured = await measure(file.path, file.name, keep, info);
  } catch (error) {
    // Said as the reason, not as the file's name followed by it: the caller names the file.
    const message = (error as Error).message;
    return not(message.startsWith(`${file.name} `) ? `it ${message.slice(file.name.length + 1)}` : message);
  }
  if (measured.size !== file.size) return not(`it is ${measured.size} bytes now, not the ${file.size} recorded`);
  if (measured.sha256 !== file.sha256) return not('its contents have changed');
  if (!keep) return { ok: true, bytes: undefined };
  if (measured.bytes === undefined) return not('it could not be read');
  return { ok: true, bytes: measured.bytes };
}
