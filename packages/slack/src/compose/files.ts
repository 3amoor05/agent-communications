import { createHash } from 'node:crypto';
import { constants } from 'node:fs';
import { type FileHandle, lstat, open } from 'node:fs/promises';
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

/*
 * A file is opened without following a link at its own name, and without waiting on one that is not a file: a FIFO
 * put in the file's place would hold a blocking open until something wrote to it. Neither flag exists on Windows,
 * where the link was refused by `lstat` already and there are no FIFOs to open.
 */
const READ_FLAGS =
  process.platform === 'win32' ? constants.O_RDONLY : constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK;

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
 */
async function measure(
  real: string,
  shown: string,
  keep: boolean,
): Promise<{ size: number; sha256: string; bytes: Buffer | undefined }> {
  let handle: FileHandle;
  try {
    handle = await open(real, READ_FLAGS);
  } catch (error) {
    throw unreadable(error, shown);
  }
  try {
    const info = await handle.stat();
    if (!info.isFile()) throw notRegular(shown);
    if (info.size === 0) {
      throw new CommsError('BAD_DATA', `${shown} is empty`, { hint: 'There is nothing in it to send.' });
    }
    if (info.size > MAX_FILE_BYTES) throw tooLarge(shown);
    const hash = createHash('sha256');
    const pieces: Buffer[] = [];
    await readThrough(handle, info.size, shown, (piece) => {
      hash.update(piece);
      if (keep) pieces.push(piece);
    });
    return { size: info.size, sha256: hash.digest('hex'), bytes: keep ? Buffer.concat(pieces, info.size) : undefined };
  } catch (error) {
    throw unreadable(error, shown);
  } finally {
    await handle.close();
  }
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
  let info: Awaited<ReturnType<typeof lstat>>;
  try {
    info = await lstat(requested);
  } catch (error) {
    throw unreadable(error, given);
  }
  if (info.isSymbolicLink()) throw isALink(given);
  if (!info.isFile()) throw notRegular(given);
  // The folders the person allows, and none of the ones never sent: the rule Gmail's attachments follow.
  const real = await checkAttachable(requested, policy);
  const name = basename(real);
  const { size, sha256 } = await measure(real, given, false);
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
