import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { type LockOptions, withFileLock, writeFileAtomic } from '@agentcomms/core';

/**
 * The shared history caches (design 2026-10-05 §D4): what a recipient analysis learned from this mailbox's Sent, kept
 * for ten minutes so the separate terminal-approval process reuses what `prepare` observed instead of starting its
 * history work again.
 *
 * Two files under the state directory, each changed only under its own lock and replaced only by an atomic write, so a
 * reader — which takes no lock — sees the complete old file or the complete new one, never part of either:
 *
 * - **Addresses**: by (immutable mailbox id, canonical address), what the prior-send check found. No sender-controlled
 *   prose is stored: an id, an address, an answer and two times.
 * - **Correspondents**: by mailbox id, the domains its last two hundred sent messages went to.
 *
 * Every locked change, in this order: entries whose expiry is at or before now are removed, the new observations are
 * applied, and then the oldest — by observation time, the key breaking ties — are evicted until at most the cap remain.
 * A file that is not valid JSON, or not this shape, reads as empty and is never trusted for anything: the caller decides
 * what that means conservatively. An entry is stale at its expiry (equality is stale).
 */

/** How long an observation is used for: ten minutes, stale at equality. */
export const HISTORY_CACHE_MS: number = 10 * 60 * 1000;

/** The most entries each cache keeps per state directory. */
export const HISTORY_CACHE_CAP: number = 5_000;

/**
 * How long a change may wait for a cache's lock in all, however often it changes hands meanwhile. The lock is a queue —
 * separate processes each holding it for one short change — so a waiter's timeout counts from the last hand-over, and
 * gives up early only on a holder that keeps it the whole timeout; this bounds the rest.
 */
export const HISTORY_LOCK_MAX_WAIT_MS: number = 30_000;

/** What a prior-send check of one address found, as the cache keeps it. */
export type HistoryResult = 'written' | 'not-written' | 'budget-exhausted' | 'provider-error';

const RESULTS: ReadonlySet<string> = new Set(['written', 'not-written', 'budget-exhausted', 'provider-error']);

export interface CachedAnswer {
  readonly result: HistoryResult;
  readonly observedAt: string;
  readonly expiresAt: string;
}

export interface CachedDomains {
  readonly domains: readonly string[];
  readonly observedAt: string;
  readonly expiresAt: string;
}

/** A read of one cache: what it holds, or that its file could not be trusted. */
export type CacheRead<T> = { readonly state: 'ok'; readonly value: T } | { readonly state: 'malformed' };

export interface HistoryCacheOptions {
  readonly now: () => Date;
  /** How many entries each cache keeps; {@link HISTORY_CACHE_CAP} unless a test says otherwise. */
  readonly cap?: number | undefined;
  /** The atomic write. A test replaces it with one that fails, before the rename or after it. */
  readonly write?: ((path: string, data: string) => Promise<void>) | undefined;
  /** How long one holder may keep the lock before a waiter gives up: the lock's own default unless a test shortens it. */
  readonly lockTimeoutMs?: number | undefined;
  /** How long a change may wait for the lock in all: {@link HISTORY_LOCK_MAX_WAIT_MS} unless a test shortens it. */
  readonly lockMaxWaitMs?: number | undefined;
}

interface Timed {
  observedAt: string;
  expiresAt: string;
}

/** The two time fields every entry carries: finite, and the expiry after the observation. */
function isTimed(value: unknown): value is Timed {
  if (typeof value !== 'object' || value === null) return false;
  const { observedAt, expiresAt } = value as Record<string, unknown>;
  if (typeof observedAt !== 'string' || typeof expiresAt !== 'string') return false;
  const observed = Date.parse(observedAt);
  const expires = Date.parse(expiresAt);
  return Number.isFinite(observed) && Number.isFinite(expires) && expires > observed;
}

function isAnswer(value: unknown): value is CachedAnswer {
  return isTimed(value) && RESULTS.has(String((value as unknown as Record<string, unknown>).result));
}

function isDomains(value: unknown): value is CachedDomains {
  const domains = (value as Record<string, unknown> | null)?.domains;
  return isTimed(value) && Array.isArray(domains) && domains.every((domain) => typeof domain === 'string');
}

/** The entries of a cache file of this shape, or null for anything else. */
function entriesOf<T>(text: string, field: string, valid: (value: unknown) => value is T): Record<string, T> | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return null;
  }
  if (typeof parsed !== 'object' || parsed === null || (parsed as Record<string, unknown>).version !== 1) return null;
  const entries = (parsed as Record<string, unknown>)[field];
  if (typeof entries !== 'object' || entries === null || Array.isArray(entries)) return null;
  for (const value of Object.values(entries)) if (!valid(value)) return null;
  return entries as Record<string, T>;
}

export class HistoryCache {
  readonly directory: string;
  readonly #now: () => Date;
  readonly #cap: number;
  readonly #write: (path: string, data: string) => Promise<void>;
  readonly #lock: LockOptions;

  constructor(stateDir: string, options: HistoryCacheOptions) {
    this.directory = join(stateDir, 'gmail-history');
    this.#now = options.now;
    this.#cap = options.cap ?? HISTORY_CACHE_CAP;
    this.#write = options.write ?? ((path, data) => writeFileAtomic(path, data));
    // Counted per holder (D4-j): counted from the start, the last of several writers arriving at once gave up while the
    // lock was being handed on as it should be — on a Windows runner, after five seconds of other processes' changes.
    this.#lock = {
      timeoutPerHolder: true,
      maxWaitMs: options.lockMaxWaitMs ?? HISTORY_LOCK_MAX_WAIT_MS,
      ...(options.lockTimeoutMs === undefined ? {} : { timeoutMs: options.lockTimeoutMs }),
    };
  }

  get addressesPath(): string {
    return join(this.directory, 'addresses.json');
  }

  get correspondentsPath(): string {
    return join(this.directory, 'correspondents.json');
  }

  /** The key of one address's answer: the mailbox's immutable id, then the canonical address. */
  static addressKey(inboxId: string, canonical: string): string {
    return `${inboxId} ${canonical}`;
  }

  /**
   * The fresh answers this mailbox's cache holds for these addresses, read without the lock — or `malformed`, when its
   * file is not one this release can trust.
   */
  async readAddresses(inboxId: string, canonicals: readonly string[]): Promise<CacheRead<Map<string, CachedAnswer>>> {
    const entries = await this.#read(this.addressesPath, 'entries', isAnswer);
    if (entries === null) return { state: 'malformed' };
    const now = this.#now().getTime();
    const fresh = new Map<string, CachedAnswer>();
    for (const canonical of canonicals) {
      const key = HistoryCache.addressKey(inboxId, canonical);
      const entry = Object.hasOwn(entries, key) ? entries[key] : undefined;
      if (entry !== undefined && now < Date.parse(entry.expiresAt)) fresh.set(canonical, entry);
    }
    return { state: 'ok', value: fresh };
  }

  /**
   * Records what this operation observed, in one locked change (see above). A malformed file is replaced. Throws when
   * the write fails: the caller must then not use these observations to suppress anything.
   */
  async recordAddresses(inboxId: string, observations: ReadonlyMap<string, HistoryResult>): Promise<void> {
    await this.#change(this.addressesPath, 'entries', isAnswer, (at, expires) =>
      [...observations].map(([canonical, result]) => [
        HistoryCache.addressKey(inboxId, canonical),
        { result, observedAt: at, expiresAt: expires },
      ]),
    );
  }

  /** This mailbox's correspondent domains while fresh, null when there are none, or `malformed`. */
  async readCorrespondents(inboxId: string): Promise<CacheRead<readonly string[] | null>> {
    const mailboxes = await this.#read(this.correspondentsPath, 'mailboxes', isDomains);
    if (mailboxes === null) return { state: 'malformed' };
    const entry = Object.hasOwn(mailboxes, inboxId) ? mailboxes[inboxId] : undefined;
    const fresh = entry !== undefined && this.#now().getTime() < Date.parse(entry.expiresAt);
    return { state: 'ok', value: fresh ? [...entry.domains] : null };
  }

  /** Records one mailbox's correspondent domains, in one locked change. Throws when the write fails. */
  async recordCorrespondents(inboxId: string, domains: readonly string[]): Promise<void> {
    await this.#change(this.correspondentsPath, 'mailboxes', isDomains, (at, expires) => [
      [inboxId, { domains: [...domains].sort(), observedAt: at, expiresAt: expires }],
    ]);
  }

  /** A cache's entries; `{}` when it does not exist yet; null when it cannot be trusted. */
  async #read<T>(
    path: string,
    field: string,
    valid: (value: unknown) => value is T,
  ): Promise<Record<string, T> | null> {
    let text: string;
    try {
      text = await readFile(path, 'utf8');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return {};
      return null;
    }
    return entriesOf(text, field, valid);
  }

  async #change<T extends Timed>(
    path: string,
    field: string,
    valid: (value: unknown) => value is T,
    observe: (at: string, expires: string) => Array<[string, T]>,
  ): Promise<void> {
    await withFileLock(
      `${path}.lock`,
      async () => {
        const now = this.#now();
        // Malformed or unreadable: replaced, never trusted, by this valid write.
        const entries = (await this.#read(path, field, valid)) ?? {};
        // First what has expired — at or before now — so a fresh entry is never evicted in its place.
        const kept = Object.entries(entries).filter(([, entry]) => Date.parse(entry.expiresAt) > now.getTime());
        const byKey = new Map<string, T>(kept);
        for (const [key, entry] of observe(
          now.toISOString(),
          new Date(now.getTime() + HISTORY_CACHE_MS).toISOString(),
        )) {
          byKey.set(key, entry);
        }
        // Then the oldest observations, the key breaking ties, until the cap: the same order whoever wrote first.
        const ordered = [...byKey].sort(
          ([keyA, a], [keyB, b]) =>
            Date.parse(a.observedAt) - Date.parse(b.observedAt) || (keyA < keyB ? -1 : keyA > keyB ? 1 : 0),
        );
        const survivors = ordered.slice(Math.max(0, ordered.length - this.#cap));
        await this.#write(path, JSON.stringify({ version: 1, [field]: Object.fromEntries(survivors) }));
      },
      this.#lock,
    );
  }
}
