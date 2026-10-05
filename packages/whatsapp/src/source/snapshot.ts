import { randomBytes } from 'node:crypto';
import { constants } from 'node:fs';
import { type FileHandle, lstat, open, readdir, rm } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import {
  type CliHandoffs,
  CommsError,
  ensurePrivateDir,
  handoffSentence,
  handoffSentenceToFill,
} from '@agentcomms/core';
import { checkStorePath, responsibleApp, SIDE_FILES, STORE_FILE } from './location.ts';

/**
 * Taking a consistent, private copy of WhatsApp's message store without ever writing to it.
 *
 * **Why a copy, and not SQLite's own read-only modes.** WhatsApp for Mac holds the store open in WAL mode, so recent
 * messages live in `ChatStorage.sqlite-wal` until the app folds them into the main file.
 *
 * - `mode=ro` still takes locks on the database and writes read-marks into the app's `-shm` shared-memory file: a
 *   "read-only" connection that writes to the app's files, and whose locks can hold up the app's own checkpoint.
 * - `immutable=1` takes no locks and writes nothing, but it ignores the log entirely — so it misses exactly the
 *   newest messages — and if the app writes while it reads, it can read torn pages. The test suite shows the miss:
 *   the same store read `immutable` returns none of the rows a live writer holds in the log.
 *
 * So the store and its log are copied, byte for byte, into a private directory under this package's state, and
 * everything else reads the copy. Nothing here opens the source with SQLite, takes a lock on it, or touches its
 * `-shm`.
 *
 * **Why a link can never be read through.** Each source file is opened once — read-only, refusing a link
 * (`O_NOFOLLOW`), and without waiting on a pipe (`O_NONBLOCK`) — and every byte copied comes from that one open
 * file. Its path is never opened again, so a name swapped for a link to the key store beside it, after the check and
 * before the copy, changes nothing: the copy is of the file that was opened. What is opened must be a regular file
 * with exactly one name — a hard link would give the key store a second name, which `O_NOFOLLOW` does not see — and,
 * after the copy, its name must still be the one it was opened by. The cost is APFS's clone: `copyFile`, which clones,
 * takes a path and would open it again, so the bytes are copied instead — the store's size, briefly, in this
 * package's state.
 *
 * **Why the copy is consistent.** Every file is open before any is copied, and each is fingerprinted from its open
 * handle — device, inode, links, size and nanosecond mtime — before and after the copy; after it, each name is looked
 * at again (`lstat`, which opens nothing) for a file that appeared, went, or was replaced. If WhatsApp wrote anything
 * in between, the copy is thrown away and taken again, a few times, and then refused rather than read half-written.
 * The caller then asks SQLite to check the copy (`quick_check`).
 */

export interface SourceStat {
  dev: bigint;
  ino: bigint;
  nlink: bigint;
  size: bigint;
  mtimeNs: bigint;
  isFile(): boolean;
  isSymbolicLink(): boolean;
}

/** A source file, open. Everything read from a source is read through one of these, never through its path. */
export interface SourceHandle {
  /** `fstat`: the open file, whatever its name now names. */
  stat(): Promise<SourceStat>;
  /** Up to `buffer.length` bytes from `position`; 0 at the end. */
  read(buffer: Buffer, position: number): Promise<number>;
  close(): Promise<void>;
}

/** The only two things this package does to the source files. Injected so a test can deny, hang or race them. */
export interface SourceIo {
  /** Looks at a name without opening it. */
  lstat(path: string): Promise<SourceStat>;
  /** Opens a file read-only, refusing a link and never waiting on a pipe. */
  open(path: string): Promise<SourceHandle>;
}

/*
 * Windows has no O_NOFOLLOW or O_NONBLOCK; there, a link needs a privilege an ordinary process lacks, and the store
 * this reads is WhatsApp for Mac's.
 */
const SOURCE_FLAGS = constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0) | (constants.O_NONBLOCK ?? 0);

export const nodeSourceIo: SourceIo = {
  lstat: (path) => lstat(path, { bigint: true }),
  async open(path) {
    const handle: FileHandle = await open(path, SOURCE_FLAGS);
    return {
      stat: () => handle.stat({ bigint: true }),
      read: async (buffer, position) => (await handle.read(buffer, 0, buffer.length, position)).bytesRead,
      close: () => handle.close(),
    };
  },
};

/**
 * How long one file operation on the source may take before the call fails.
 *
 * macOS 15.2 and later ask "… would like to access data from other apps" the first time a process reads another
 * app's container, and the read waits for the answer. A background MCP server cannot click Allow, and a file call
 * already on the libuv thread pool cannot be cancelled — the same trap core's keychain store is built around, and the
 * same answer: race it against a timer and fail with a message that says to look for the dialog.
 */
export const SOURCE_TIMEOUT_MS = 12_000;

/**
 * How long copying one file may take. Longer than the rest: it is a real copy of what can be a large database — and a
 * permission dialog would already have stopped the `open` that comes first, under the short limit.
 */
export const COPY_TIMEOUT_MS = 120_000;

class SourceTimeout extends Error {
  override name = 'SourceTimeout';
}

/** Per I/O object, a call that timed out and has not settled. While it holds a thread, nothing else starts. */
const stuckCalls = new WeakMap<SourceIo, Promise<unknown>>();

export interface SourceOptions {
  /**
   * What a refusal names to run — `status` at a terminal, an `add` for another store — located as the package printing
   * it finds its own command (`WhatsAppContext.handoffs`). Required: there is no bare `agent-whatsapp` to fall back on.
   */
  handoffs: CliHandoffs;
  io?: SourceIo | undefined;
  env?: NodeJS.ProcessEnv | undefined;
  platform?: NodeJS.Platform | undefined;
  timeoutMs?: number | undefined;
  /** Copies attempted before a store that keeps changing is refused. */
  attempts?: number | undefined;
  sleep?: ((ms: number) => Promise<void>) | undefined;
  /** The account's default store, so "not found" can say WhatsApp may not be installed rather than blame a path. */
  isDefault?: boolean | undefined;
}

function pendingError(options: SourceOptions): CommsError {
  const app = responsibleApp(options.env ?? {}) ?? 'your terminal or MCP client';
  const terminal = handoffSentence(
    options.handoffs.own(['status']),
    (command) => `An MCP server cannot answer it: run ${command} in a terminal once, or grant Full Disk Access.`,
    { instead: 'An MCP server cannot answer it: grant Full Disk Access.' },
  );
  return new CommsError('TRANSIENT', 'reading WhatsApp’s message store is waiting for a macOS permission dialog', {
    hint: `Look for a dialog asking whether ${app} may access data from other apps, choose Allow, then run this again. ${terminal}`,
    details: { reason: 'MACOS_PROMPT_PENDING' },
  });
}

async function bounded<T>(options: SourceOptions, work: () => Promise<T>, limitMs?: number): Promise<T> {
  const io = options.io ?? nodeSourceIo;
  if (stuckCalls.has(io)) throw pendingError(options);
  const native = work();
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => reject(new SourceTimeout()), limitMs ?? options.timeoutMs ?? SOURCE_TIMEOUT_MS);
  });
  try {
    return await Promise.race([native, timeout]);
  } catch (error) {
    if (error instanceof SourceTimeout) {
      const settled: Promise<unknown> = native.then(
        () => undefined,
        () => undefined,
      );
      stuckCalls.set(io, settled);
      void settled.then(() => {
        if (stuckCalls.get(io) === settled) stuckCalls.delete(io);
      });
      throw pendingError(options);
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * What a failed read of the source means, in words a person can act on.
 *
 * `EPERM` is how macOS reports a privacy (TCC) refusal: the container is another app's, and reading it needs the
 * person's consent for whichever app is responsible for this process. `EACCES` is ordinary file permissions, and gets
 * the same advice on a Mac because the fix a person can make is the same.
 */
export function sourceError(error: unknown, path: string, options: SourceOptions): CommsError {
  if (error instanceof CommsError) return error;
  const code = (error as NodeJS.ErrnoException | undefined)?.code;
  const platform = options.platform ?? process.platform;
  if (code === 'ENOENT' || code === 'ENOTDIR') {
    return new CommsError('NOT_FOUND', `there is no WhatsApp message store at ${path}`, {
      hint: options.isDefault
        ? `Is WhatsApp for Mac installed and signed in here? It creates this file once it has synced. ${handoffSentenceToFill(
            options.handoffs.own(['add']),
            ['<organisation>/whatsapp', '--source', '<path to its ChatStorage.sqlite>'],
            (command) =>
              `The WhatsApp Business app keeps its own, under group.net.whatsapp.WhatsAppSMB.shared: add it with ${command}.`,
            {
              instead:
                'The WhatsApp Business app keeps its own, under group.net.whatsapp.WhatsAppSMB.shared: a person adds that with add’s --source.',
            },
          )}`
        : 'Check the path given with --source.',
      details: { reason: 'NO_STORE', path },
    });
  }
  if (code === 'EPERM' || code === 'EACCES') {
    const app = responsibleApp(options.env ?? {});
    const who = app ?? 'the app this runs in — your terminal or editor, or the MCP client that started the server';
    const hint =
      platform === 'darwin'
        ? `macOS protects other apps' data. When it asks whether ${app ?? 'this app'} may "access data from other apps", choose Allow. If it did not ask, or the answer was Don't Allow: System Settings → Privacy & Security → Full Disk Access, turn it on for ${who}, then quit and reopen ${app ?? 'that app'} and run this again.`
        : 'This user cannot read that file. Check its permissions.';
    return new CommsError('AUTH_REQUIRED', `this process is not allowed to read ${path}`, {
      hint,
      details: {
        reason: platform === 'darwin' ? 'MACOS_PRIVACY' : 'FILE_PERMISSIONS',
        path,
        ...(app === null ? {} : { responsibleApp: app }),
        grant: platform === 'darwin' ? 'Full Disk Access' : null,
      },
    });
  }
  const message = error instanceof Error ? error.message : String(error);
  return new CommsError('PROVIDER_UNAVAILABLE', `WhatsApp's message store could not be read: ${message}`, {
    details: { path },
  });
}

function notRegular(path: string): CommsError {
  // A link could point anywhere — at the key store beside it, say. Refused, not followed.
  return new CommsError('USAGE', `${path} is not a regular file, so it is not read`, {
    hint: 'Point --source at the real ChatStorage.sqlite, not a link to it.',
    details: { path },
  });
}

/**
 * What an open source file must be before a byte of it is read: a regular file with exactly one name.
 *
 * A second name is how a hard link would hand this package the key store under the store's name — `O_NOFOLLOW` sees
 * only symbolic links — and a real store has one. None (0) is a file deleted since it was opened: a log WhatsApp
 * removed, which the fingerprint then reports as a change.
 */
function checkOpened(info: SourceStat, path: string): void {
  if (!info.isFile()) throw notRegular(path);
  if (info.nlink > 1n) {
    throw new CommsError('USAGE', `${path} has more than one name (a hard link), so it is not read`, {
      hint: 'A link could give another file — the key store beside it — this name. Point --source at a ChatStorage.sqlite with no other name.',
      details: { path, links: Number(info.nlink) },
    });
  }
}

/** What identifies a file's content and place: which file, how many names, how long, when last written. */
function fingerprintOf(info: SourceStat): string {
  return `${info.dev}:${info.ino}:${info.nlink}:${info.size}:${info.mtimeNs}`;
}

interface OpenSource {
  readonly name: string;
  readonly path: string;
  readonly handle: SourceHandle;
  before: string;
  info: SourceStat;
}

/** Opens the store and whichever side files exist, each once, and fingerprints each from its handle. */
async function openSources(sourceDir: string, storePath: string, options: SourceOptions): Promise<OpenSource[]> {
  const io = options.io ?? nodeSourceIo;
  const opened: OpenSource[] = [];
  try {
    for (const name of [STORE_FILE, ...SIDE_FILES]) {
      const path = join(sourceDir, name);
      let handle: SourceHandle;
      try {
        handle = await bounded(options, () => io.open(path));
      } catch (error) {
        const code = (error as NodeJS.ErrnoException).code;
        if (name !== STORE_FILE && code === 'ENOENT') continue;
        // What O_NOFOLLOW answers for a link: ELOOP (macOS, Linux), EMLINK (the BSDs).
        if (code === 'ELOOP' || code === 'EMLINK') throw notRegular(path);
        throw sourceError(error, storePath, options);
      }
      const info = await bounded(options, () => handle.stat()).catch(async (error: unknown) => {
        await handle.close().catch(() => undefined);
        throw sourceError(error, storePath, options);
      });
      opened.push({ name, path, handle, before: fingerprintOf(info), info });
      checkOpened(info, path);
    }
    return opened;
  } catch (error) {
    await closeSources(opened);
    throw error;
  }
}

async function closeSources(sources: readonly OpenSource[]): Promise<void> {
  for (const source of sources) await source.handle.close().catch(() => undefined);
}

const CHUNK_BYTES = 1024 * 1024;

/** Every byte of an open source file, into a file created for it — exclusively, owner-only. */
async function copyOpened(source: SourceHandle, to: string): Promise<void> {
  // EXCL: the destination is a fresh private directory, so an existing file there is a bug, not something to replace.
  const out = await open(to, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL, 0o600);
  try {
    const buffer = Buffer.allocUnsafe(CHUNK_BYTES);
    for (let position = 0; ; ) {
      const bytes = await source.read(buffer, position);
      if (bytes === 0) break;
      for (let written = 0; written < bytes; ) {
        written += (await out.write(buffer, written, bytes - written, position + written)).bytesWritten;
      }
      position += bytes;
    }
  } finally {
    await out.close();
  }
}

/**
 * Whether the sources are as they were when opened: each open file unchanged, each name still naming the file opened
 * by it, and no side file come or gone. A name now held by a link is refused outright.
 */
async function unchanged(sources: readonly OpenSource[], sourceDir: string, options: SourceOptions): Promise<boolean> {
  const io = options.io ?? nodeSourceIo;
  let same = true;
  for (const source of sources) {
    if (fingerprintOf(await bounded(options, () => source.handle.stat())) !== source.before) same = false;
  }
  for (const name of [STORE_FILE, ...SIDE_FILES]) {
    const path = join(sourceDir, name);
    const source = sources.find((entry) => entry.name === name);
    let info: SourceStat;
    try {
      info = await bounded(options, () => io.lstat(path));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      if (source) same = false;
      continue;
    }
    if (info.isSymbolicLink() || !info.isFile()) throw notRegular(path);
    if (!source || info.dev !== source.info.dev || info.ino !== source.info.ino) same = false;
  }
  return same;
}

export interface StoreSnapshot {
  /** The private directory holding the copy. */
  readonly directory: string;
  /** The copied `ChatStorage.sqlite`, safe to open read-write: it is ours. */
  readonly database: string;
  /** Which source files were copied — the store, and its log when there was one. */
  readonly copied: readonly string[];
  readonly attempts: number;
  dispose(): Promise<void>;
}

/** Snapshot directories a crashed run left behind. Called under the account's sync lock, so none is in use. */
export async function removeStaleSnapshots(workDir: string): Promise<number> {
  let removed = 0;
  for (const entry of await readdir(workDir).catch(() => [] as string[])) {
    if (!entry.startsWith('snapshot-')) continue;
    await rm(join(workDir, entry), { recursive: true, force: true });
    removed += 1;
  }
  return removed;
}

/**
 * A consistent private copy of the store and its log, in a new directory under `workDir`.
 *
 * The caller owns the result and must `dispose()` it: the copy is every message in the store, and it lives only as
 * long as the import that reads it.
 */
export async function snapshotStore(
  storePath: string,
  workDir: string,
  options: SourceOptions,
): Promise<StoreSnapshot> {
  checkStorePath(storePath);
  const attempts = options.attempts ?? 5;
  const sleep = options.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const sourceDir = dirname(storePath);
  await ensurePrivateDir(workDir);

  for (let attempt = 1; attempt <= attempts; attempt++) {
    const sources = await openSources(sourceDir, storePath, options);
    const directory = join(workDir, `snapshot-${randomBytes(6).toString('hex')}`);
    let consistent: boolean;
    try {
      await ensurePrivateDir(directory);
      for (const source of sources) {
        await bounded(
          options,
          () => copyOpened(source.handle, join(directory, source.name)),
          options.timeoutMs ?? COPY_TIMEOUT_MS,
        );
      }
      consistent = await unchanged(sources, sourceDir, options);
    } catch (error) {
      await closeSources(sources);
      await rm(directory, { recursive: true, force: true });
      throw sourceError(error, storePath, options);
    }
    await closeSources(sources);
    if (consistent) {
      return {
        directory,
        database: join(directory, STORE_FILE),
        copied: sources.map((source) => source.name),
        attempts: attempt,
        dispose: () => rm(directory, { recursive: true, force: true }),
      };
    }
    await rm(directory, { recursive: true, force: true });
    if (attempt < attempts) await sleep(50 * attempt);
  }
  throw new CommsError(
    'TRANSIENT',
    'WhatsApp kept writing to its message store while it was being copied, so no consistent copy could be taken',
    {
      hint: 'Try again in a moment. If WhatsApp is still syncing history after being set up, wait for it to finish.',
      details: { reason: 'STORE_BUSY', attempts },
    },
  );
}

const SQLITE_HEADER = Buffer.from('SQLite format 3\0', 'latin1');

/**
 * Proves this process may read the store, by reading its first sixteen bytes.
 *
 * Opening the file is what macOS's privacy check guards, so this is the cheapest honest test of access: a `stat` can
 * succeed where an `open` is refused. The bytes are only compared with SQLite's magic header.
 */
export async function probeStore(storePath: string, options: SourceOptions): Promise<void> {
  checkStorePath(storePath);
  const io = options.io ?? nodeSourceIo;
  let header: Buffer;
  try {
    const handle = await bounded(options, () => io.open(storePath)).catch((error: unknown) => {
      const code = (error as NodeJS.ErrnoException).code;
      throw code === 'ELOOP' || code === 'EMLINK' ? notRegular(storePath) : error;
    });
    try {
      checkOpened(await bounded(options, () => handle.stat()), storePath);
      const buffer = Buffer.alloc(SQLITE_HEADER.length);
      header = buffer.subarray(0, await bounded(options, () => handle.read(buffer, 0)));
    } finally {
      await handle.close().catch(() => undefined);
    }
  } catch (error) {
    throw sourceError(error, storePath, options);
  }
  if (!header.equals(SQLITE_HEADER)) {
    throw new CommsError('BAD_DATA', `${storePath} is not an SQLite database`, {
      details: { reason: 'NOT_SQLITE', path: storePath },
    });
  }
}
