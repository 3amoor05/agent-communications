import { gatedChangeAtTerminal } from './change-flow.ts';
import { channelServer } from './channel-servers.ts';
import { type OutputOptions, type Streams, writeResult } from './cli-runtime.ts';
import type { Core } from './core.ts';
import { npmLatestVersion } from './npm.ts';
import { type UpdateDeps, updateChange, updateCheck } from './operations/update.ts';
import { renderUpdate } from './render.ts';
import type { TerminalUpdateHooks } from './update-gate.ts';
import {
  changeUpdateCheck,
  EMPTY_UPDATE_CHECK,
  readUpdateCheck,
  type UpdateCheckRecord,
  updateCheckDue,
  updateCheckEnabled,
  updateCheckUnderway,
} from './update-state.ts';
import { isPrerelease, isVersion } from './versions.ts';

/**
 * The daily update check's checker: the half that asks the registry (design 2026-09-28 §1).
 *
 * At most once in 24 hours for the whole machine, it reads the `latest` dist-tag of `@agentcomms/core` — every
 * package here is released together under one version, so that one number is the latest of each — and runs the same
 * "what is behind" check `comms_update` runs with `check`, handing it that number, so the registry is asked once. What
 * it found goes in `update-check.json`, where every server and command reads it.
 *
 * Two processes finding the file a day old at the same moment do not both ask: the first to take the file's lock
 * claims the check (`checking`), and the second, reading the file under the same lock, finds it claimed. The day's
 * `lastChecked` is written when the ask is over, so an ask cut short — a command the person interrupted, a server
 * whose client closed it — does not use up the day: its claim runs out (`UPDATE_CHECK_LEASE_MS`) and the next process
 * asks. An ask that fails — offline, a registry that does not answer — is recorded as the day's ask, keeps the last
 * result, and stops nothing. It never throws.
 *
 * Nothing here gives up on the registry sooner than the registry's own timeout: a command at a terminal stops
 * *waiting* after about three seconds and goes on, and the check carries on beside it. Cut off at three seconds, a
 * registry that takes five would have been asked every day and heard from never.
 *
 * WhatsApp imports none of this: see `update-state.ts`.
 */

const CORE_PACKAGE = channelServer('core').packageName;

export interface UpdateCheckOptions {
  /** The registry and `npm ls`, for a test — nothing a test runs reads the real ones. */
  deps?: UpdateDeps | undefined;
  now?: (() => Date) | undefined;
}

export interface UpdateCheckOutcome {
  /** Whether this call asked the registry: false when the check is off, not due, or another process is asking. */
  asked: boolean;
  record: UpdateCheckRecord;
}

/** The check, when it is on and due: once in 24 hours per machine, recorded in `update-check.json`. */
export async function checkForUpdates(
  core: Core,
  env: NodeJS.ProcessEnv,
  options: UpdateCheckOptions = {},
): Promise<UpdateCheckOutcome> {
  const stateDir = core.paths.stateDir;
  const now = options.now ?? (() => new Date());
  try {
    if (!(await updateCheckEnabled(core, env)).on) return { asked: false, record: await readUpdateCheck(stateDir) };
    // The claim: under the lock, due or not — and claimed by another process or not — is decided on the file as it is
    // now, and the claim written before anyone asks, so of two processes that both found it a day old, one asks. The
    // time is read under the lock too: read before it, the second process's time could be earlier than the first's
    // claim, which reads as a clock gone back.
    const claim = await changeUpdateCheck<string>(stateDir, (record) => {
      const claimedAt = now();
      if (!updateCheckDue(record, claimedAt) || updateCheckUnderway(record, claimedAt)) return null;
      const checking = claimedAt.toISOString();
      return { record: { ...record, checking }, result: checking };
    }).catch(() => null);
    if (claim?.result === undefined) return { asked: false, record: await readUpdateCheck(stateDir) };
    await ask(core, env, { ...options, now, claimedAt: claim.result });
    return { asked: true, record: await readUpdateCheck(stateDir) };
  } catch {
    // The check never stops anything, a command least of all: whatever went wrong, the file is what it was.
    return { asked: false, record: await readUpdateCheck(stateDir).catch(() => ({ ...EMPTY_UPDATE_CHECK })) };
  }
}

async function ask(
  core: Core,
  env: NodeJS.ProcessEnv,
  options: UpdateCheckOptions & { now: () => Date; claimedAt: string },
): Promise<void> {
  const deps = options.deps ?? {};
  /**
   * The ask is over: what it found is written, the day's check recorded as of the claim, and the claim given up — if
   * the claim is still this ask's. A check a person asked for, or an update, records what it found and gives up any
   * claim as it does; so does another process once this claim ran out and it claimed the check itself. Either way
   * what is in the file is newer than what this ask found, and writing over it would put back the machine as it was
   * before an update: "update" where "restart" is right.
   */
  const settle = (found: Partial<UpdateCheckRecord>) =>
    changeUpdateCheck(core.paths.stateDir, (record) =>
      record.checking === options.claimedAt
        ? { record: { ...record, ...found, lastChecked: options.claimedAt, checking: null } }
        : null,
    ).catch(() => undefined);
  const reason = (error: unknown) => (error instanceof Error ? error.message : String(error)).slice(0, 300);
  let latest: string;
  try {
    latest = await (deps.latestVersion ?? ((name: string) => npmLatestVersion(name, { env })))(CORE_PACKAGE);
    if (!isVersion(latest))
      throw new Error(
        `the npm registry names ${JSON.stringify(String(latest)).slice(0, 60)} as the latest release, which is not a version`,
      );
  } catch (error) {
    await settle({ lastError: reason(error) });
    return;
  }
  if (isPrerelease(latest)) {
    // Recorded as the registry said it, and never counted: nobody is stopped for a release candidate.
    await settle({ latest, behind: null, current: null, lastError: null });
    return;
  }
  try {
    // `comms_update`'s own check, handed the one number: it records what it finds, by this clock, and so ends the ask
    // — under this ask's claim, so only while the claim is still its own.
    await updateCheck(core, env, { ...deps, latestVersion: async () => latest, now: options.now }, options.claimedAt);
  } catch (error) {
    // The registry answered, and something here could not be read: what is known is recorded, and the rest is not.
    await settle({ latest, behind: null, current: null, lastError: reason(error) });
  }
}

/**
 * What a command at a terminal hands the update gate (`updateGateAtTerminal`): the check, and the update itself for
 * the person's "now" — its own preview and yes.
 *
 * Every command but WhatsApp's is given these. WhatsApp's is given neither, and reads the file as it is.
 */
export function terminalUpdateHooks(
  core: Core,
  env: NodeJS.ProcessEnv,
  options: {
    output: OutputOptions;
    streams: Streams;
    /** The command that approves a change beside this CLI — see `gatedChangeAtTerminal`. */
    approveCommand?: string | undefined;
    deps?: UpdateDeps | undefined;
    now?: (() => Date) | undefined;
  },
): TerminalUpdateHooks {
  return {
    check: async () => {
      await checkForUpdates(core, env, { deps: options.deps, now: options.now });
    },
    update: async () => {
      const result = await gatedChangeAtTerminal(core, updateChange(core, env, {}, options.deps), {
        env,
        output: options.output,
        command: 'agentcomms update',
        approveCommand: options.approveCommand,
        streams: options.streams,
      });
      writeResult(result, options.output, (r) => renderUpdate(r, options.output.color), options.streams);
      if (!result.ok) return 'failed';
      // Every step worked and nothing was left for a person. Anything short of that — nothing it could do, or
      // something left behind — is not "Updated": the gate says so, and the command still does not run.
      return result.status === 'updated' && result.manual.length === 0 ? 'updated' : 'short';
    },
  };
}
