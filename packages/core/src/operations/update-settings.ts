import type { GatedChange } from '../change-flow.ts';
import { type Config, type UpdateCheckSetting, updateCheckSetting } from '../config.ts';
import type { Core } from '../core.ts';
import { CommsError } from '../errors.ts';
import { changeUpdateCheck, countedLatest, localStamp, nextLocalMidnight, readUpdateCheck } from '../update-state.ts';

/**
 * The daily update check's two settings, from a terminal (`agentcomms update --later`, `--auto on|off`) or a chat
 * (`comms_update` with `later` or `auto`): "not now", and the check itself on or off (design 2026-09-28 §2, §4).
 *
 * Both are changes a person approves, through the one flow every change goes through. "Not now" is the person's
 * decision, not the agent's: were it a free switch, an agent could clear the stop without asking and the stop would
 * do nothing. It is an effect — it writes the state file, not the configuration — so the approval binds its sentence,
 * the release and the midnight included. Turning the check off is a loosening of `defaults.updateCheck`, which
 * `ConfigStore.update` refuses without the person's consent; turning it on tightens, and applies at once.
 *
 * Neither reads the registry: they are the reader's, so WhatsApp's command can offer "later" with no network code.
 */

export interface UpdateLaterResult {
  /** When the stop comes back: the local midnight after the person said not now. Null when there was nothing to do. */
  snoozedUntil: string | null;
  /** The release put off, as the last check named it; null when no check has named one. */
  latest: string | null;
  /** False when it was already put off until then, and nothing was written. */
  changed: boolean;
}

/**
 * "Not now": no server or command on this machine stops for the update until the next local midnight.
 *
 * `plan` reads the file on both calls, so a claim made after midnight — a different midnight in the sentence — or
 * for a newer release is a different change, and refused.
 */
export function updateLaterChange(
  core: Core,
  options: { now?: (() => Date) | undefined } = {},
): GatedChange<UpdateLaterResult> {
  const now = options.now ?? (() => new Date());
  let planned: { until: Date; latest: string | null; changed: boolean } | null = null;
  return {
    plan: async (config: Config) => {
      const record = await readUpdateCheck(core.paths.stateDir);
      const until = nextLocalMidnight(now());
      const latest = countedLatest(record);
      const changed = record.snoozedUntil === null || Date.parse(record.snoozedUntil) < until.getTime();
      planned = { until, latest, changed };
      const what = latest === null ? 'the daily update check' : `the update to ${latest}`;
      return {
        before: config,
        after: config,
        effects: changed
          ? [
              `puts off ${what} until midnight, local time (${localStamp(until)}): until then no server or command on this machine stops for it, and the first request after asks again`,
            ]
          : [],
        summary:
          latest === null
            ? 'Skip the daily update check until tomorrow'
            : `Skip the update to ${latest} until tomorrow`,
      };
    },
    apply: async () => {
      if (planned === null) throw new CommsError('UNEXPECTED', 'not now was applied before it was planned');
      const { until, latest, changed } = planned;
      if (changed) {
        await changeUpdateCheck(core.paths.stateDir, (record) => ({
          record: { ...record, snoozedUntil: until.toISOString() },
        }));
      }
      const record = await readUpdateCheck(core.paths.stateDir);
      return { snoozedUntil: record.snoozedUntil, latest, changed };
    },
  };
}

export interface UpdateAutoResult {
  /** The machine's setting now. */
  updateCheck: UpdateCheckSetting;
  /** False when it already was, and nothing was written. */
  changed: boolean;
}

/** The daily update check on or off for this machine, in `config.json`: off is a loosening, on applies at once. */
export function updateAutoChange(core: Core, setting: UpdateCheckSetting): GatedChange<UpdateAutoResult> {
  if (setting !== 'on' && setting !== 'off') {
    throw new CommsError('USAGE', `"${String(setting)}" is not a setting of the daily update check; use on or off`);
  }
  const set = (config: Config): Config => ({ ...config, defaults: { ...config.defaults, updateCheck: setting } });
  return {
    plan: (config: Config) => ({
      before: config,
      after: updateCheckSetting(config) === setting ? config : set(config),
      summary:
        setting === 'off'
          ? 'Turn off the daily update check on this machine'
          : 'Turn on the daily update check on this machine',
    }),
    apply: async (consent, request) => {
      if (request.after === request.before) return { updateCheck: setting, changed: false };
      await core.config.update(set, consent ? { consent } : {});
      return { updateCheck: setting, changed: true };
    },
  };
}
