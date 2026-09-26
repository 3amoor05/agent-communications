import { randomBytes } from 'node:crypto';
import { constants } from 'node:fs';
import { copyFile, lstat, open, readdir, rm } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { CommsError, ensurePrivateDir } from '@agentcomms/core';
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
 * everything else reads the copy. The source files are only ever `lstat`ed and read — `copyFile` opens them read-only
 * (on APFS it clones them, which is instant and takes no extra space). Nothing here opens the source with SQLite,
 * takes a lock on it, or touches its `-shm`.
 *
 * **Why the copy is consistent.** Each source file is fingerprinted — inode, size and nanosecond mtime — before and
 * after the copy. If WhatsApp wrote anything in between, the copy is thrown away and taken again, a few times, and
 * then refused rather than read half-written. The caller then asks SQLite to check the copy (`quick_check`).
 */

export interface SourceStat {
  ino: bigint;
  size: bigint;
  mtimeNs: bigint;
  isFile(): boolean;
  isSymbolicLink(): boolean;
}

/** The only three things this package does to the source files. Injected so a test can deny, hang or race them. */
export interface SourceIo {
  lstat(path: string): Promise<SourceStat>;
  copyFile(from: string, to: string): Promise<void>;
  /** The first `bytes` bytes, read-only, never following a link. */
  readHeader(path: string, bytes: number): Promise<Buffer>;
}

export const nodeSourceIo: SourceIo = {
  lstat: (path) => lstat(path, { bigint: true }),
  // EXCL: the destination is a fresh private directory, so an existing file there is a bug, not something to replace.
  copyFile: (from, to) => copyFile(from, to, constants.COPYFILE_FICLONE | constants.COPYFILE_EXCL),
  async readHeader(path, bytes) {
    const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
    try {
      const buffer = Buffer.alloc(bytes);
      const { bytesRead } = await handle.read(buffer, 0, bytes, 0);
      return buffer.subarray(0, bytesRead);
    } finally {
      await handle.close();
    }
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
 * How long copying one file may take. Longer than the rest: on APFS the copy is a clone and instant, but elsewhere it
 * is a real copy of what can be a large database — and a permission dialog would already have stopped the `lstat`
 * that comes first, under the short limit.
 */
export const COPY_TIMEOUT_MS = 120_000;

class SourceTimeout extends Error {
  override name = 'SourceTimeout';
}

/** Per I/O object, a call that timed out and has not settled. While it holds a thread, nothing else starts. */
const stuckCalls = new WeakMap<SourceIo, Promise<unknown>>();

export interface SourceOptions {
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
  return new CommsError('TRANSIENT', 'reading WhatsApp’s message store is waiting for a macOS permission dialog', {
    hint: `Look for a dialog asking whether ${app} may access data from other apps, choose Allow, then run this again. An MCP server cannot answer it: run \`agent-whatsapp status\` in a terminal once, or grant Full Disk Access.`,
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
        ? 'Is WhatsApp for Mac installed and signed in here? It creates this file once it has synced. The WhatsApp Business app keeps its own, under group.net.whatsapp.WhatsAppSMB.shared: pass it with --source.'
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

interface Fingerprint {
  /** Only files that exist, by name, with what identifies their content. */
  files: Map<string, string>;
}

async function fingerprint(sourceDir: string, options: SourceOptions): Promise<Fingerprint> {
  const io = options.io ?? nodeSourceIo;
  const files = new Map<string, string>();
  for (const name of [STORE_FILE, ...SIDE_FILES]) {
    const path = join(sourceDir, name);
    let info: SourceStat;
    try {
      info = await bounded(options, () => io.lstat(path));
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (name !== STORE_FILE && code === 'ENOENT') continue;
      throw sourceError(error, join(sourceDir, STORE_FILE), options);
    }
    if (info.isSymbolicLink() || !info.isFile()) {
      // A link could point anywhere — at the key store beside it, say. Refused, not followed.
      throw new CommsError('USAGE', `${path} is not a regular file, so it is not read`, {
        hint: 'Point --source at the real ChatStorage.sqlite, not a link to it.',
        details: { path },
      });
    }
    files.set(name, `${info.ino}:${info.size}:${info.mtimeNs}`);
  }
  return { files };
}

function same(a: Fingerprint, b: Fingerprint): boolean {
  if (a.files.size !== b.files.size) return false;
  for (const [name, value] of a.files) if (b.files.get(name) !== value) return false;
  return true;
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
  options: SourceOptions = {},
): Promise<StoreSnapshot> {
  checkStorePath(storePath);
  const io = options.io ?? nodeSourceIo;
  const attempts = options.attempts ?? 5;
  const sleep = options.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const sourceDir = dirname(storePath);
  await ensurePrivateDir(workDir);

  for (let attempt = 1; attempt <= attempts; attempt++) {
    const before = await fingerprint(sourceDir, options);
    const directory = join(workDir, `snapshot-${randomBytes(6).toString('hex')}`);
    await ensurePrivateDir(directory);
    try {
      for (const name of before.files.keys()) {
        await bounded(
          options,
          () => io.copyFile(join(sourceDir, name), join(directory, name)),
          options.timeoutMs ?? COPY_TIMEOUT_MS,
        );
      }
      const after = await fingerprint(sourceDir, options);
      if (same(before, after)) {
        return {
          directory,
          database: join(directory, STORE_FILE),
          copied: [...before.files.keys()],
          attempts: attempt,
          dispose: () => rm(directory, { recursive: true, force: true }),
        };
      }
    } catch (error) {
      await rm(directory, { recursive: true, force: true });
      throw sourceError(error, storePath, options);
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
export async function probeStore(storePath: string, options: SourceOptions = {}): Promise<void> {
  checkStorePath(storePath);
  const io = options.io ?? nodeSourceIo;
  let header: Buffer;
  try {
    const info = await bounded(options, () => io.lstat(storePath));
    if (info.isSymbolicLink() || !info.isFile()) {
      throw new CommsError('USAGE', `${storePath} is not a regular file, so it is not read`, {
        hint: 'Point --source at the real ChatStorage.sqlite, not a link to it.',
      });
    }
    header = await bounded(options, () => io.readHeader(storePath, SQLITE_HEADER.length));
  } catch (error) {
    throw sourceError(error, storePath, options);
  }
  if (!header.equals(SQLITE_HEADER)) {
    throw new CommsError('BAD_DATA', `${storePath} is not an SQLite database`, {
      details: { reason: 'NOT_SQLITE', path: storePath },
    });
  }
}
