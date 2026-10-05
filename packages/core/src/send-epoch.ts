import type { Config, LegacyDrainOutcome } from './config.ts';
import type { Core } from './core.ts';
import { CommsError } from './errors.ts';

/**
 * The send epoch (design 2026-10-05 §D1, "`never` revokes; loosening revives nothing").
 *
 * Config keeps a per-owner integer that every write turning an owner's effective send policy to `never` raises, and
 * nothing ever lowers. A send's approval stores its owner's epoch as read at prepare, bound into its identity, and a
 * claim or an approval compares it with the live one: a record from before a `never` can never send, whatever the
 * policy says by then.
 */

/** An owner's send epoch in `config`: its stored value, or 0 when it has none. */
export function sendEpochOf(config: Config, ownerId: string): number {
  const epochs = (config as { sendEpochs?: Record<string, unknown> | undefined }).sendEpochs;
  const epoch = epochs !== undefined && Object.hasOwn(epochs, ownerId) ? epochs[ownerId] : undefined;
  return typeof epoch === 'number' && Number.isInteger(epoch) && epoch >= 0 ? epoch : 0;
}

/** The reason a record from an earlier release is retired with by the drain. */
export const LEGACY_DRAIN_REASON = 'prepared by an earlier release; prepare it again';

/**
 * How long a drain stays open after the conversion that opened it, at least: the longest lifetime an earlier release
 * gave a pending send approval — 0.13.0's ten minutes (`APPROVAL_TTL_MS`) — so a record it prepared in a moment this
 * release could not see has expired by its own rules before the drain stops looking.
 */
export const LEGACY_DRAIN_MS: number = 10 * 60 * 1000;

/** What a drain reports of the records it tracks, by id only. */
export interface LegacyDrainReport {
  /** Still open: their revocation failed, or was not yet tried. Retried by the next operation that relies on the epoch. */
  couldNotRevoke: string[];
  /**
   * Reached by an earlier release's send it had already admitted — the stated limit: under way, `unknown`, or already
   * `used` or `failed` when the drain got there. Never revoked; listed so that window is never silent.
   */
  inFlight: string[];
}

/**
 * The configuration as an operation that relies on the send epoch needs it: version 3, with every record an earlier
 * release prepared being retired (design 2026-10-05 §D1, "Old releases are locked out before the fence is relied on").
 *
 * Run first by every send prepare, claim and approval, and every send-policy write. A version-1 or -2 configuration is
 * converted to version 3 in one locked write (`ConfigStore.convertToVersion3`), the scan of the approvals under the
 * same lock tracking every version-1 send record still `pending` or `approved` by its own rules. While that drain is
 * open, every call rescans for one written since, retries each open revocation under its record's lock
 * (`revokeLegacy`), records what became of each, and closes the drain only once every tracked record has an outcome,
 * the rescan finds nothing new, and `LEGACY_DRAIN_MS` has passed since it opened. The config lock and a record's lock
 * are never held together.
 *
 * `legacyDrain` is the report, ids only, whenever a drain was open during the call.
 */
export async function ensureSendEpochConfig(
  core: Core,
  options: { now?: (() => Date) | undefined } = {},
): Promise<{ config: Config; legacyDrain?: LegacyDrainReport }> {
  const now = options.now ?? (() => new Date());
  const converted = await core.config.convertToVersion3(
    async () => Object.fromEntries((await activeLegacySends(core)).map((id) => [id, 'open' as const])),
    { now },
  );
  const config = converted.config;
  if (config.version !== 3 || config.legacyDrain === undefined) return { config };
  return drain(core, now);
}

/** Every version-1 send record still `pending` or `approved` by its own release's rules: what a drain must retire. */
async function activeLegacySends(core: Core): Promise<string[]> {
  const listed = await core.approvals.list({ states: ['pending', 'approved'] });
  return listed.flatMap((stored) =>
    stored.form === 'legacy' && stored.view.kind === 'send' ? [stored.view.approvalId] : [],
  );
}

/** One step of an open drain: rescan, retry, record, and close when it may. */
async function drain(core: Core, now: () => Date): Promise<{ config: Config; legacyDrain: LegacyDrainReport }> {
  // A record a paused earlier-release prepare wrote after the last scan joins the drain, in a locked write.
  const active = await activeLegacySends(core);
  const opened = await core.config.load();
  const tracked = opened.version === 3 ? (opened.legacyDrain?.tracked ?? {}) : {};
  if (active.some((id) => !Object.hasOwn(tracked, id))) {
    await core.config.update((current) => withTracked(current, active));
  }

  // Each open one retried under its own lock — never with the config lock held.
  const current = await core.config.load();
  const open =
    current.version === 3
      ? Object.entries(current.legacyDrain?.tracked ?? {}).flatMap(([id, status]) => (status === 'open' ? [id] : []))
      : [];
  const outcomes: Record<string, LegacyDrainOutcome> = {};
  for (const approvalId of open) {
    try {
      const record = await core.approvals.revokeLegacy(approvalId, LEGACY_DRAIN_REASON);
      outcomes[approvalId] = outcomeOf(record.state);
    } catch (error) {
      // Gone altogether: nothing can claim it any more. Anything else is retried by the next call.
      if (error instanceof CommsError && error.code === 'NOT_FOUND') outcomes[approvalId] = 'revoked';
    }
  }

  // What became of each, recorded in a locked write that rescans once more and closes the drain only when it may.
  const config = await core.config.update(async (latest) => {
    if (latest.version !== 3 || latest.legacyDrain === undefined) return latest;
    const records = { ...latest.legacyDrain.tracked };
    for (const [approvalId, outcome] of Object.entries(outcomes)) {
      if (records[approvalId] === 'open') records[approvalId] = outcome;
    }
    let foundNew = false;
    for (const approvalId of await activeLegacySends(core)) {
      if (!Object.hasOwn(records, approvalId)) {
        records[approvalId] = 'open';
        foundNew = true;
      }
    }
    const finished = Object.values(records).every((status) => status !== 'open');
    const lapsed = now().getTime() >= Date.parse(latest.legacyDrain.since) + LEGACY_DRAIN_MS;
    if (finished && !foundNew && lapsed) {
      const { legacyDrain: _closed, ...rest } = latest;
      return rest;
    }
    return { ...latest, legacyDrain: { ...latest.legacyDrain, tracked: records } };
  });
  const recorded = config.version === 3 ? (config.legacyDrain?.tracked ?? {}) : {};
  const ended = { ...recorded };
  // A drain this call closed reports what it last recorded.
  for (const [approvalId, outcome] of Object.entries(outcomes)) ended[approvalId] ??= outcome;
  for (const approvalId of Object.keys(tracked)) ended[approvalId] ??= tracked[approvalId] ?? 'open';
  return {
    config,
    legacyDrain: {
      couldNotRevoke: Object.keys(recorded)
        .filter((approvalId) => recorded[approvalId] === 'open')
        .sort(),
      inFlight: Object.keys(ended)
        .filter((approvalId) => ['sending', 'unknown', 'used', 'failed'].includes(ended[approvalId] ?? ''))
        .sort(),
    },
  };
}

/** `current` with every id in `active` it does not track yet tracked as open. */
function withTracked(current: Config, active: readonly string[]): Config {
  if (current.version !== 3 || current.legacyDrain === undefined) return current;
  const tracked = { ...current.legacyDrain.tracked };
  for (const approvalId of active) if (!Object.hasOwn(tracked, approvalId)) tracked[approvalId] = 'open';
  return { ...current, legacyDrain: { ...current.legacyDrain, tracked } };
}

/** What a tracked record's state means to the drain once `revokeLegacy` has reached it. */
function outcomeOf(state: string): LegacyDrainOutcome {
  switch (state) {
    case 'revoked':
    case 'expired':
    case 'used':
    case 'failed':
    case 'sending':
    case 'unknown':
      return state;
    default:
      // `revokeLegacy` rewrites a pending or approved record, so neither comes back: anything else is not one it knows.
      throw new CommsError('UNEXPECTED', `a record from an earlier release read as "${state}" after it was retired`);
  }
}
