import { gatedChangeAtTerminal } from './change-flow.ts';
import { channelServer } from './channel-servers.ts';
import { type OutputOptions, type Streams, writeResult } from './cli-runtime.ts';
import type { Core } from './core.ts';
import { EXIT_CODES } from './errors.ts';
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
 * records the time before it asks, and the second, reading the file under the same lock, finds it fresh. An ask that
 * fails — offline, a registry that does not answer — is recorded as the day's ask, keeps the last result, and stops
 * nothing. It never throws.
 *
 * WhatsApp imports none of this: see `update-state.ts`.
 */

const CORE_PACKAGE = channelServer('core').packageName;

export interface UpdateCheckOptions {
  /** The registry and `npm ls`, for a test — nothing a test runs reads the real ones. */
  deps?: UpdateDeps | undefined;
  now?: (() => Date) | undefined;
  /** Gives up when this aborts: a command at a terminal waits about three seconds for the check, and no longer. */
  signal?: AbortSignal | undefined;
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
    // The claim: under the lock, due or not is decided on the file as it is now, and the time written before anyone
    // asks — so of two processes that both found it a day old, one asks. The time is read under the lock too: read
    // before it, the second process's time could be earlier than the first's claim, which reads as a clock gone back.
    const claim = await changeUpdateCheck<boolean>(stateDir, (record) => {
      const claimedAt = now();
      return updateCheckDue(record, claimedAt)
        ? { record: { ...record, lastChecked: claimedAt.toISOString() }, result: true }
        : null;
    }).catch(() => null);
    if (claim === null || claim.result !== true) return { asked: false, record: await readUpdateCheck(stateDir) };
    await ask(core, env, { ...options, now });
    return { asked: true, record: await readUpdateCheck(stateDir) };
  } catch {
    // The check never stops anything, a command least of all: whatever went wrong, the file is what it was.
    return { asked: false, record: await readUpdateCheck(stateDir).catch(() => ({ ...EMPTY_UPDATE_CHECK })) };
  }
}

async function ask(
  core: Core,
  env: NodeJS.ProcessEnv,
  options: UpdateCheckOptions & { now: () => Date },
): Promise<void> {
  const deps = options.deps ?? {};
  const signal = options.signal ?? deps.signal;
  const failed = (error: unknown) =>
    changeUpdateCheck(core.paths.stateDir, (record) => ({
      record: { ...record, lastError: (error instanceof Error ? error.message : String(error)).slice(0, 300) },
    })).catch(() => undefined);
  let latest: string;
  try {
    latest = await (deps.latestVersion ?? ((name: string) => npmLatestVersion(name, { env, signal })))(CORE_PACKAGE);
    if (!isVersion(latest))
      throw new Error(
        `the npm registry names ${JSON.stringify(String(latest)).slice(0, 60)} as the latest release, which is not a version`,
      );
  } catch (error) {
    await failed(error);
    return;
  }
  if (isPrerelease(latest)) {
    // Recorded as the registry said it, and never counted: nobody is stopped for a release candidate.
    await changeUpdateCheck(core.paths.stateDir, (record) => ({
      record: { ...record, latest, behind: null, lastError: null },
    })).catch(() => undefined);
    return;
  }
  try {
    // `comms_update`'s own check, handed the one number: it records what it finds, by this clock.
    await updateCheck(core, env, { ...deps, latestVersion: async () => latest, signal, now: options.now });
  } catch (error) {
    // The registry answered, and something here could not be read: what is known is recorded, and the rest is not.
    await changeUpdateCheck(core.paths.stateDir, (record) => ({
      record: {
        ...record,
        latest,
        behind: null,
        lastError: (error instanceof Error ? error.message : String(error)).slice(0, 300),
      },
    })).catch(() => undefined);
  }
}

/**
 * What a command at a terminal hands the update gate (`updateGateAtTerminal`): the check, and the update itself for
 * the person's "now" — its own preview and yes, then "Updated. Run your command again."
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
    check: async (signal) => {
      await checkForUpdates(core, env, { deps: options.deps, now: options.now, signal });
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
      if (!result.ok || result.status === 'manual') return EXIT_CODES.UNAVAILABLE;
      options.streams.stdout.write('Updated. Run your command again.\n');
      return EXIT_CODES.OK;
    },
  };
}
