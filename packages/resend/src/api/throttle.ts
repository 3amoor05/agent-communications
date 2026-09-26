import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { setTimeout as sleepFor } from 'node:timers/promises';
import { CommsError, withFileLock, writeFileAtomic } from '@agentcomms/core';

/**
 * How often this machine may ask Resend anything, per account — and when it must stop asking.
 *
 * Resend allows 10 requests a second **per team, shared by every key**, with no burst. The team's own production
 * mail spends that budget too, so an agent paging through sent mail must never be the reason a password-reset email
 * is refused. Two rules:
 *
 * - **At most one request every 500 ms** (two a second), counted across every process on this machine — a CLI
 *   command and two MCP servers share one budget, because each reserves its slot in one file under a lock.
 * - **A 429 stops everything** until the time Resend gave (`retry-after`, else `ratelimit-reset`), and so does a
 *   response saying none are left (`ratelimit-remaining: 0`). Nothing is retried: the next call is refused with the
 *   time to wait, and whoever asked decides whether to ask again.
 */

export const DEFAULT_INTERVAL_MS = 500;

interface ThrottleFile {
  /** The earliest time, in ms since the epoch, the next request may leave. */
  next: number;
  /** Until when Resend asked for no requests at all. */
  blockedUntil: number;
}

export interface ThrottleOptions {
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
  /** Tests shorten this; nothing a person or an agent passes can. */
  intervalMs?: number;
}

export class Throttle {
  readonly path: string;
  readonly #now: () => number;
  readonly #sleep: (ms: number) => Promise<void>;
  readonly #interval: number;

  constructor(stateDir: string, accountId: string, options: ThrottleOptions = {}) {
    if (!/^acc_[A-Z0-9]{16}$/.test(accountId)) throw new Error(`not an account id: ${accountId}`);
    this.path = join(stateDir, 'resend', 'throttle', `${accountId}.json`);
    this.#now = options.now ?? Date.now;
    this.#sleep = options.sleep ?? ((ms) => sleepFor(ms).then(() => undefined));
    this.#interval = options.intervalMs ?? DEFAULT_INTERVAL_MS;
  }

  async #read(): Promise<ThrottleFile> {
    try {
      const parsed = JSON.parse(await readFile(this.path, 'utf8')) as Partial<ThrottleFile>;
      return {
        next: Number.isFinite(parsed.next) ? Number(parsed.next) : 0,
        blockedUntil: Number.isFinite(parsed.blockedUntil) ? Number(parsed.blockedUntil) : 0,
      };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT' || error instanceof SyntaxError) {
        return { next: 0, blockedUntil: 0 };
      }
      throw error;
    }
  }

  /** When Resend will next be asked anything by this account, or null when it is not holding off. */
  async blockedUntil(): Promise<string | null> {
    const state = await this.#read();
    return state.blockedUntil > this.#now() ? new Date(state.blockedUntil).toISOString() : null;
  }

  /**
   * Waits for this request's slot, or refuses at once while Resend has asked for none.
   *
   * The slot is reserved under the lock and waited for outside it, so a slow request does not hold every other
   * process's reservation.
   */
  async before(): Promise<void> {
    const wait = await withFileLock(`${this.path}.lock`, async () => {
      const state = await this.#read();
      const now = this.#now();
      if (state.blockedUntil > now) {
        const seconds = Math.ceil((state.blockedUntil - now) / 1000);
        throw new CommsError('TRANSIENT', 'Resend asked this machine to stop for now (rate limit)', {
          hint: `Nothing was sent to Resend. Try again in ${seconds} second(s); the team's own mail shares this limit.`,
          details: { retryAfterSeconds: seconds, blockedUntil: new Date(state.blockedUntil).toISOString() },
        });
      }
      const slot = Math.max(now, state.next);
      await writeFileAtomic(this.path, JSON.stringify({ ...state, next: slot + this.#interval }));
      return slot - now;
    });
    if (wait > 0) await this.#sleep(wait);
  }

  /** Reads what Resend said about the budget, and stops this account when it says to. Returns the stop, if any. */
  async after(status: number, headers: Headers): Promise<number | null> {
    const seconds = (name: string): number | null => {
      const value = headers.get(name);
      if (value === null || !/^\s*\d+(\.\d+)?\s*$/.test(value)) return null;
      return Number(value);
    };
    let stopFor: number | null = null;
    if (status === 429) stopFor = seconds('retry-after') ?? seconds('ratelimit-reset') ?? 1;
    else if (seconds('ratelimit-remaining') === 0) stopFor = seconds('ratelimit-reset') ?? 1;
    if (stopFor === null) return null;
    const until = this.#now() + Math.max(1, stopFor) * 1000;
    await withFileLock(`${this.path}.lock`, async () => {
      const state = await this.#read();
      await writeFileAtomic(this.path, JSON.stringify({ ...state, blockedUntil: Math.max(state.blockedUntil, until) }));
    });
    return Math.max(1, Math.ceil(stopFor));
  }
}
