import { randomBytes } from 'node:crypto';
import { link, open, readFile, rename, rm, stat, utimes } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { CommsError } from './errors.ts';
import { ensurePrivateDir } from './fs.ts';

interface LockTimings {
  /** Give up after this long. */
  timeoutMs?: number;
  /** A lock whose recorded time is older than this is assumed abandoned by a crashed process. */
  staleMs?: number;
  /**
   * Renew the lock this often while `fn` runs, so a holder that is still working is never judged abandoned.
   *
   * Opt-in, for locks held across work of unbounded length. Staleness was judged from a time written once, at
   * acquisition, so a live holder that ran past `staleMs` could be taken over mid-operation — for the credentials
   * lock, a migration with enough credentials and a slow enough keychain, recreating the very race the lock
   * exists to prevent.
   */
  renewMs?: number;
  /**
   * Give up after waiting this long in all, however often the lock has changed hands meanwhile.
   *
   * Counted from when this caller began to wait, and never restarted. It is what bounds `timeoutPerHolder`, which
   * restarts the timeout at every hand-over and so, alone, bounds nothing: the lock is not a queue that serves its
   * callers in turn. Every waiter polls, and whoever looks first after a release takes it, so a waiter that keeps
   * looking at the wrong moment can watch caller after caller arrive later and go first — for as long as callers
   * keep arriving.
   */
  maxWaitMs?: number;
}

/**
 * How `withFileLock` takes its lock: how long it waits, when a lock counts as abandoned, and how a holder keeps one.
 *
 * `timeoutPerHolder` comes only with `maxWaitMs`, so that no caller can ask for a wait with no end.
 */
export type LockOptions = LockTimings &
  (
    | { timeoutPerHolder?: false }
    | {
        /**
         * Count `timeoutMs` from the last time the lock changed hands, rather than from when this caller began to
         * wait.
         *
         * Opt-in, for a lock that is a queue: many callers arriving at the same moment, each holding it for a moment.
         * Counted from the start, the timeout is a budget for the whole queue ahead, so on a machine slow enough the
         * last caller in line gives up — "another process is holding" — while the lock is being handed on exactly as
         * it should be. Counted per holder, a waiter gives up only once one holder has kept the lock for the whole
         * timeout, which is the stuck lock the timeout is there to catch. A waiter sees a hand-over as a different
         * token in the lock file.
         *
         * Not the default, and never without `maxWaitMs`: on its own it lets a waiter wait for as long as the lock
         * keeps changing hands, and a lock that is polled rather than queued can keep changing hands past one waiter
         * for ever.
         */
        timeoutPerHolder: true;
        maxWaitMs: number;
      }
  );

/**
 * Opening `wx` failed because someone else holds the path — retry, rather than failing the command.
 *
 * EPERM and EBUSY are how Windows reports what EEXIST reports elsewhere: the file is there, or the holder is deleting
 * it as we open it. EACCES is deliberately not here — that is a permissions problem, and waiting five seconds to
 * announce that another process holds the lock would be both slower and untrue.
 */
const CONTENDED = new Set(['EEXIST', 'EPERM', 'EBUSY']);

interface LockBody {
  pid: number;
  at: string;
  token: string;
}

/**
 * The file operations a lock is made of, one method each, so a test can count and interrupt every one of them: the
 * create that is the attempt, the read that checks a holder, the touch that renews, the unlink that releases.
 * `withFileLock` uses the real ones; `tryFileLock` takes another for a caller whose every step is counted.
 */
export interface LockIo {
  /** Creates `path` exclusively (`wx`, 0600) holding `body`: the one attempt to take the lock. */
  create(path: string, body: string): Promise<void>;
  /** The lock file's text: a holder's body. */
  read(path: string): Promise<string>;
  /** The lock file's modification time, in milliseconds: where a renewal shows. */
  mtime(path: string): Promise<number>;
  /** Sets the lock file's times to now: a renewal. */
  touch(path: string): Promise<void>;
  rename(from: string, to: string): Promise<void>;
  link(from: string, to: string): Promise<void>;
  /** Removes a lock file, or one moved aside; a missing one is no error. */
  remove(path: string): Promise<void>;
}

/** The real file system's lock operations. */
export const NODE_LOCK_IO: LockIo = Object.freeze({
  async create(path: string, body: string): Promise<void> {
    const handle = await open(path, 'wx', 0o600);
    try {
      await handle.writeFile(body);
    } finally {
      await handle.close();
    }
  },
  read: (path: string) => readFile(path, 'utf8'),
  mtime: async (path: string) => (await stat(path)).mtimeMs,
  touch: (path: string) => {
    const now = new Date();
    return utimes(path, now, now);
  },
  rename: (from: string, to: string) => rename(from, to),
  link: (from: string, to: string) => link(from, to),
  remove: (path: string) => rm(path, { force: true }),
});

async function readLock(path: string, io: LockIo = NODE_LOCK_IO): Promise<LockBody | null> {
  try {
    return JSON.parse(await io.read(path)) as LockBody;
  } catch {
    return null;
  }
}

/**
 * An unreadable or half-written lock counts as stale only through its age — and when the body cannot be read, that
 * age has to come from the file itself.
 *
 * `withFileLock` creates the lock file and writes its body in two separate awaits with no fsync between them, so a
 * SIGKILL, an OOM kill or a power cut in between leaves a zero-byte lock on disk. Reading "no body" as "not stale"
 * meant that file wedged config, the approval ledger and the send ledger permanently, for every process, with no
 * way out but finding and deleting it by hand. A corrupt timestamp inside an otherwise readable body is the same
 * trap wearing a different hat: `Date.now() - NaN > staleMs` is false, forever.
 */
async function isStale(
  path: string,
  body: LockBody | null,
  staleMs: number,
  io: LockIo = NODE_LOCK_IO,
): Promise<boolean> {
  let touched: number;
  try {
    touched = await io.mtime(path);
  } catch {
    // The lock is gone; whoever is waiting will simply create their own.
    return false;
  }
  /*
   * The fresher of the declared time and the file's own modification time.
   *
   * A renewing holder touches the file rather than rewriting it: a rewrite would have to check the token and then
   * write, and a takeover landing between the two would have this holder overwrite a new holder's token. Touching
   * a file that has since been replaced only keeps the new holder's lock fresh, which is harmless. So a renewal
   * shows up as the modification time, and that has to count.
   */
  const declared = body ? new Date(body.at).getTime() : Number.NaN;
  const freshest = Number.isFinite(declared) ? Math.max(declared, touched) : touched;
  return Date.now() - freshest > staleMs;
}

/**
 * Takes over an abandoned lock safely: move it aside atomically (only one waiter's rename can succeed), re-check that
 * what was moved really is stale, and if it was someone's live lock after all, put it back.
 */
async function takeOverStale(lockPath: string, staleMs: number, io: LockIo = NODE_LOCK_IO): Promise<void> {
  const aside = `${lockPath}.stale-${randomBytes(6).toString('hex')}`;
  try {
    await io.rename(lockPath, aside);
  } catch {
    return; // someone else moved it first
  }
  const moved = await readLock(aside, io);
  if (!(await isStale(aside, moved, staleMs, io))) {
    // Not stale after all: put it back. `link` leaves the copy in place to clean up, but some file systems (overlay
    // mounts in containers) have no hard links, so fall back to renaming it back — losing the holder's lock would
    // leave no mutual exclusion at all.
    try {
      await io.link(aside, lockPath);
    } catch {
      // Write the holder's lock back by hand rather than leaving the path unlocked. `wx`, never a rename: a rename
      // replaces whatever is there, and between the move and now another waiter may have taken the lock legitimately.
      // Overwriting that would hand the same lock to two holders, which is worse than the case this is repairing.
      try {
        await io.create(lockPath, JSON.stringify(moved));
      } catch {
        // A new holder exists, or the path is unusable; either way there is nothing left to restore.
      }
    }
  }
  await io.remove(aside);
}

/**
 * Runs `fn` while holding an exclusive lock file. The CLI and several MCP server processes share config, approvals and
 * counters; every read-modify-write of those goes through here so no update is lost. Keep critical sections to file
 * I/O: do network work first, then re-check preconditions under the lock. (Single-use sends do not rely on this lock
 * alone: see the O_EXCL claim marker in the approval store.)
 */
export async function withFileLock<T>(lockPath: string, fn: () => Promise<T>, options: LockOptions = {}): Promise<T> {
  const timeoutMs = options.timeoutMs ?? 5000;
  const staleMs = options.staleMs ?? 30_000;
  const started = Date.now();
  let deadline = started + timeoutMs;
  /** `maxWaitMs`'s end: fixed when the wait begins, whatever the lock does. */
  const limit = options.maxWaitMs === undefined ? Number.POSITIVE_INFINITY : started + options.maxWaitMs;
  const token = randomBytes(12).toString('hex');
  let lastCode = 'EEXIST';
  /** The token of the holder this caller saw last, and how many times it has seen the lock change hands. */
  let holder: string | undefined;
  let handOvers = 0;
  await ensurePrivateDir(dirname(lockPath));
  for (;;) {
    try {
      const handle = await open(lockPath, 'wx', 0o600);
      await handle.writeFile(JSON.stringify({ pid: process.pid, at: new Date().toISOString(), token }));
      await handle.close();
      break;
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (!CONTENDED.has(code ?? '')) throw error;
      lastCode = code ?? lastCode;
      // Only EEXIST tells us the file is really there and can be read; under the Windows codes there is nothing to
      // read yet, so back off and look again rather than deciding it is abandoned.
      if (code === 'EEXIST') {
        const body = await readLock(lockPath);
        if (await isStale(lockPath, body, staleMs)) {
          await takeOverStale(lockPath, staleMs);
          continue;
        }
        // A body not yet written, or one without a token, says nothing about who holds it: wait for the next look.
        const seen = typeof body?.token === 'string' ? body.token : undefined;
        if (seen !== undefined && seen !== holder) {
          if (holder !== undefined) handOvers += 1;
          holder = seen;
          if (options.timeoutPerHolder) deadline = Date.now() + timeoutMs;
        }
      }
      if (Date.now() > limit) {
        throw new CommsError(
          'LOCK_TIMEOUT',
          `gave up waiting for ${lockPath}: the wait hit its overall limit of ${(limit - started) / 1000} s`,
          {
            hint:
              (handOvers > 0
                ? `It changed hands ${handOvers} time(s) while this waited, never to this process: busy rather than stuck. Retry in a moment.`
                : 'Retry in a moment. If it persists and no other process is running, delete the lock file.') +
              (lastCode === 'EEXIST' ? '' : ` (last error: ${lastCode})`),
          },
        );
      }
      if (Date.now() > deadline) {
        throw new CommsError('LOCK_TIMEOUT', `another agent-communications process is holding ${lockPath}`, {
          hint:
            `Retry in a moment. If it persists and no other process is running, delete the lock file.` +
            (lastCode === 'EEXIST' ? '' : ` (last error: ${lastCode})`),
        });
      }
      await sleep(25 + Math.floor(Math.random() * 50));
    }
  }
  const renewal = options.renewMs
    ? setInterval(() => {
        const now = new Date();
        void utimes(lockPath, now, now).catch(() => undefined);
      }, options.renewMs)
    : undefined;
  renewal?.unref?.();
  try {
    return await fn();
  } finally {
    if (renewal) clearInterval(renewal);
    // Only remove the lock if it is still ours (a very slow holder could have been taken over as stale).
    const current = await readLock(lockPath);
    if (current?.token === token) await rm(lockPath, { force: true });
  }
}

/** A lock `tryFileLock` took: its holder's token, and a look at whether the lock file still names it. */
export interface HeldFileLock {
  /** This holder's token, as written in the lock file. */
  readonly token: string;
  /**
   * Re-reads the lock file: true while it still holds this holder's token. A look, not a fence — ownership can change
   * the moment after it answers — so a holder asks it before each step it must not start once the lock is lost.
   */
  stillHeld(): Promise<boolean>;
}

/** What a single try at a lock came to: not taken — someone holds it — or taken, and what `fn` returned. */
export type TryLockResult<T> = { readonly acquired: false } | { readonly acquired: true; readonly value: T };

export interface TryLockOptions {
  /** A lock whose recorded time and modification time are both older than this is abandoned. 30 s by default. */
  staleMs?: number | undefined;
  /** Renew the lock this often while `fn` runs, as `withFileLock`'s `renewMs`. Opt-in. */
  renewMs?: number | undefined;
  /** The lock's file operations: the real ones by default. */
  io?: LockIo | undefined;
}

/**
 * Runs `fn` holding an exclusive lock file — if the lock can be had now — and otherwise does nothing at all.
 *
 * One attempt, with `withFileLock`'s stale-lock and token rules: a lock held by a live holder is busy, and this returns
 * `{ acquired: false }` at once, without polling or sleeping; an abandoned one (older than `staleMs`) is taken over
 * exactly as `withFileLock` takes it over, and tried once more. For work that must never queue behind another holder —
 * daily approval maintenance, the unsent report — where a busy record is counted and left, not waited for.
 *
 * `fn` is given the holder's token and `stillHeld()`, so a long holder can check, before each step, that it was not
 * judged abandoned and taken over. The directory must exist: this creates nothing but the lock file.
 */
export async function tryFileLock<T>(
  lockPath: string,
  fn: (held: HeldFileLock) => Promise<T>,
  options: TryLockOptions = {},
): Promise<TryLockResult<T>> {
  const io = options.io ?? NODE_LOCK_IO;
  const staleMs = options.staleMs ?? 30_000;
  const token = randomBytes(12).toString('hex');
  const body = () => JSON.stringify({ pid: process.pid, at: new Date().toISOString(), token });
  let taken = false;
  // At most two creates: the attempt, and — only after an abandoned lock was moved aside — the one after it.
  for (let attempt = 0; attempt < 2 && !taken; attempt += 1) {
    try {
      await io.create(lockPath, body());
      taken = true;
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (!CONTENDED.has(code ?? '')) throw error;
      // Only EEXIST says the file is there to be read; under the Windows codes it is busy, and is left.
      if (code !== 'EEXIST' || attempt > 0) return { acquired: false };
      const holder = await readLock(lockPath, io);
      if (!(await isStale(lockPath, holder, staleMs, io))) return { acquired: false };
      await takeOverStale(lockPath, staleMs, io);
    }
  }
  if (!taken) return { acquired: false };
  const renewal = options.renewMs
    ? setInterval(() => {
        void io.touch(lockPath).catch(() => undefined);
      }, options.renewMs)
    : undefined;
  renewal?.unref?.();
  const held: HeldFileLock = {
    token,
    stillHeld: async () => (await readLock(lockPath, io))?.token === token,
  };
  try {
    return { acquired: true, value: await fn(held) };
  } finally {
    if (renewal) clearInterval(renewal);
    // Only remove the lock if it is still ours: a holder judged abandoned may have been taken over.
    const current = await readLock(lockPath, io);
    if (current?.token === token) await io.remove(lockPath).catch(() => undefined);
  }
}

/**
 * The lock every operation that rewrites stored credentials in bulk must hold.
 *
 * Next to the configuration rather than in the state directory, because it guards the same thing the config lock
 * does from a different angle: which backend holds which credential. The config lock serialises writes to the
 * file; this serialises the operations that move secrets *between* backends around those writes, which take far
 * longer than a config write and must not interleave with each other.
 *
 * Two opposite migrations were the case that forced it. One copied into a backend while the other was cleaning
 * the same backend out, and the result was a credential in neither — the active backend empty, and the one it
 * had been copied from emptied too.
 *
 * **S3's token refresh must take this lock too**, before it is wired to anything. A refresh rewrites a credential
 * under the same reference, which a migration's own checks cannot see; holding this lock is what serialises the
 * two. Recorded in the Slack design spec next to the phase table.
 */
export function credentialsLockPath(configDir: string): string {
  return join(configDir, '.credentials.lock');
}

/**
 * Runs `fn` holding the credentials lock, renewed for as long as `fn` runs.
 *
 * Renewed rather than given a long stale window. What runs under this has no upper bound on its length — a
 * migration of many credentials, each waiting on the keychain — so any fixed window is one a live holder can
 * outlast. With renewal the window only has to cover a holder that has actually died, which is also why it can be
 * short: a crashed migration stops blocking the next one in two minutes rather than ten.
 *
 * A short timeout by default, because a second caller arriving while one is running should be told so promptly
 * rather than queue behind a prompt nobody is answering. A caller that is not a person — a token refresh behind
 * another workspace's refresh, whose holder is waiting on a network call rather than on anybody — may wait longer.
 */
export function withCredentialsLock<T>(
  configDir: string,
  fn: () => Promise<T>,
  options: { timeoutMs?: number } = {},
): Promise<T> {
  return withFileLock(credentialsLockPath(configDir), fn, {
    staleMs: 2 * 60_000,
    renewMs: 20_000,
    timeoutMs: options.timeoutMs ?? 5_000,
  });
}
