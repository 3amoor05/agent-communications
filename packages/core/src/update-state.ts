import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { type UpdateCheckSetting, updateCheckSetting } from './config.ts';
import type { Core } from './core.ts';
import { writeFileAtomic } from './fs.ts';
import { withFileLock } from './lock.ts';
import { isBehind, isPrerelease, isVersion } from './versions.ts';

/**
 * The daily update check, as every server and command reads it (design 2026-09-28): one file per machine,
 * `update-check.json` in the state directory, saying when the registry was last asked, the latest release it named,
 * whether this machine's registrations were behind it, and any "not now" with when it runs out.
 *
 * This is the reader, and it has **no network code at all**: it reads and writes that file, and says what it means.
 * Asking the registry is the checker's (`update-check.ts`), which every server and command but WhatsApp's also
 * imports. WhatsApp's package promises it reaches no network — `packages/whatsapp/test/no-network.test.ts` holds it to
 * that — so it imports only this, and learns of an update once any other server or command on the machine has asked.
 */

/** The file, in the state directory: one per machine, shared by every server and command on it. */
export const UPDATE_CHECK_FILE = 'update-check.json';

/**
 * The switch that turns the whole thing off for one process — no check, no stop — whatever the setting says. Every
 * test harness and every script here that runs a command or a server sets it, so no test and no verify step asks the
 * real registry.
 */
export const UPDATE_CHECK_ENV: 'AGENT_COMMS_UPDATE_CHECK' = 'AGENT_COMMS_UPDATE_CHECK';

/** How long a check is good for: the registry is asked at most once in this long, by the whole machine. */
export const UPDATE_CHECK_INTERVAL_MS: number = 24 * 60 * 60 * 1000;

/** What the stop says first, word for word: the owner's words. */
export const UPDATE_FIRST = "Hang on a minute, there's an update. Let's update first.";

export interface UpdateCheckRecord {
  /**
   * When the registry was last asked, as an ISO time — whether or not it answered. A failed ask counts: a machine
   * that is offline would otherwise ask again on every command, and a command at a terminal waits for it.
   */
  lastChecked: string | null;
  /** The latest release the registry last named: the `latest` dist-tag of `@agentcomms/core`. */
  latest: string | null;
  /**
   * Whether anything on this machine — a registration, a runtime, a global package — was behind `latest` at that
   * check, as `comms_update` with `check` finds it. `false` with an older server running is an update installed and
   * not yet loaded: the client has to be restarted, not updated again. `null` when it is not known.
   */
  behind: boolean | null;
  /** Why the last ask got no answer, when it got none. Kept for the doctor; nothing is stopped on its account. */
  lastError: string | null;
  /** A person's "not now": nothing stops until this ISO time, the local midnight after they said it. */
  snoozedUntil: string | null;
}

export const EMPTY_UPDATE_CHECK: Readonly<UpdateCheckRecord> = Object.freeze({
  lastChecked: null,
  latest: null,
  behind: null,
  lastError: null,
  snoozedUntil: null,
});

export function updateCheckPath(stateDir: string): string {
  return join(stateDir, UPDATE_CHECK_FILE);
}

const isTime = (value: unknown): value is string => typeof value === 'string' && Number.isFinite(Date.parse(value));

/**
 * The record as the file holds it, each field checked on its own: one that is missing or not what it should be reads
 * as not known. A file that is missing, unreadable or not JSON is an empty record — never a reason to stop anything.
 */
export async function readUpdateCheck(stateDir: string): Promise<UpdateCheckRecord> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(await readFile(updateCheckPath(stateDir), 'utf8'));
  } catch {
    return { ...EMPTY_UPDATE_CHECK };
  }
  const held = (typeof parsed === 'object' && parsed !== null ? parsed : {}) as Record<string, unknown>;
  return {
    lastChecked: isTime(held.lastChecked) ? held.lastChecked : null,
    latest: isVersion(held.latest) ? held.latest : null,
    behind: typeof held.behind === 'boolean' ? held.behind : null,
    lastError: typeof held.lastError === 'string' ? held.lastError.slice(0, 300) : null,
    snoozedUntil: isTime(held.snoozedUntil) ? held.snoozedUntil : null,
  };
}

/**
 * Reads the record, changes it and writes it back, under a lock beside it, atomically — so a server recording a check
 * and a person's "not now" arriving at the same moment each keep what the other wrote. Returns what `change` returned
 * alongside the record written; `change` returning `null` writes nothing.
 */
export async function changeUpdateCheck<T = void>(
  stateDir: string,
  change: (record: UpdateCheckRecord) => { record: UpdateCheckRecord; result?: T } | null,
): Promise<{ record: UpdateCheckRecord; result: T | undefined; written: boolean }> {
  return withFileLock(
    join(stateDir, '.update-check.lock'),
    async () => {
      const current = await readUpdateCheck(stateDir);
      const next = change(current);
      if (next === null) return { record: current, result: undefined, written: false };
      await writeFileAtomic(updateCheckPath(stateDir), `${JSON.stringify(next.record, null, 2)}\n`);
      return { record: next.record, result: next.result, written: true };
    },
    { timeoutMs: 2_000 },
  );
}

/**
 * Whether the check is due: never asked, asked a day or more ago, or — a clock that went back — asked more than a few
 * minutes in the future. A few minutes are allowed for, because two processes' clocks are read at slightly different
 * moments, and a check just claimed by one must not look due to the other.
 */
export function updateCheckDue(record: UpdateCheckRecord, now: Date): boolean {
  if (record.lastChecked === null) return true;
  const since = now.getTime() - Date.parse(record.lastChecked);
  return !(since >= -CLOCK_SKEW_MS && since < UPDATE_CHECK_INTERVAL_MS);
}

const CLOCK_SKEW_MS = 5 * 60 * 1000;

/** What turned the check off for this process, from its environment: `CI`, or the switch. Null when neither did. */
export function updateCheckSwitchedOff(env: NodeJS.ProcessEnv): 'CI' | typeof UPDATE_CHECK_ENV | null {
  // `CI` as `canPrompt` reads it: set, and not `0` or `false`.
  if (env.CI && env.CI !== '0' && env.CI !== 'false') return 'CI';
  const value = env[UPDATE_CHECK_ENV]?.trim().toLowerCase();
  if (value !== undefined && ['off', '0', 'false', 'no'].includes(value)) return UPDATE_CHECK_ENV;
  return null;
}

/** Whether a check may run at all, and if not, what turned it off: the environment first, then the machine's setting. */
export async function updateCheckEnabled(
  core: Core,
  env: NodeJS.ProcessEnv,
): Promise<{ on: true } | { on: false; by: 'CI' | typeof UPDATE_CHECK_ENV | 'setting' }> {
  const switched = updateCheckSwitchedOff(env);
  if (switched !== null) return { on: false, by: switched };
  return (await machineSetting(core)) === 'off' ? { on: false, by: 'setting' } : { on: true };
}

/**
 * The machine's setting, from `config.json`. A configuration that cannot be read counts as `on`, the default: what is
 * wrong with it is for the doctor and the tools to say, and it must not quietly turn this off.
 */
async function machineSetting(core: Core): Promise<UpdateCheckSetting> {
  try {
    return updateCheckSetting(await core.config.load());
  } catch {
    return 'on';
  }
}

/** The start of the next local day: when a "not now" runs out. */
export function nextLocalMidnight(now: Date): Date {
  return new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 0, 0, 0, 0);
}

/** A local time as a person reads it in a preview: `2026-09-29 00:00`. */
export function localStamp(at: Date): string {
  const two = (value: number) => String(value).padStart(2, '0');
  return `${at.getFullYear()}-${two(at.getMonth() + 1)}-${two(at.getDate())} ${two(at.getHours())}:${two(at.getMinutes())}`;
}

/** Whether a person's "not now" still holds. */
export function updateSnoozed(record: UpdateCheckRecord, now: Date): boolean {
  return record.snoozedUntil !== null && now.getTime() < Date.parse(record.snoozedUntil);
}

/**
 * The latest release as the check counts it: a version, and not a prerelease — 0.8.0-rc.1 is never an update anybody
 * is stopped for. Null when the file names none.
 */
export function countedLatest(record: UpdateCheckRecord): string | null {
  return record.latest !== null && isVersion(record.latest) && !isPrerelease(record.latest) ? record.latest : null;
}

/** An update that stops a server or a command running `running`. */
export interface PendingUpdate {
  /**
   * `update`: a newer release is out and this machine is behind it, or it is not known whether it is. `restart`: it
   * is installed — nothing on this machine is behind — and this process simply started before it was.
   */
  kind: 'update' | 'restart';
  running: string;
  latest: string;
}

/** What the record means for a process running `running`, ignoring any "not now": null when there is nothing newer. */
export function updateVerdict(record: UpdateCheckRecord, running: string): PendingUpdate | null {
  const latest = countedLatest(record);
  if (latest === null || !isVersion(running) || !isBehind(running, latest)) return null;
  return { kind: record.behind === false ? 'restart' : 'update', running, latest };
}

/**
 * The update that stops this process now, from the file as it is — or null: switched off, snoozed, or nothing newer.
 * Reads two files and asks nobody.
 */
export async function pendingUpdate(options: {
  core: Core;
  env: NodeJS.ProcessEnv;
  running: string;
  now?: (() => Date) | undefined;
}): Promise<PendingUpdate | null> {
  if (!(await updateCheckEnabled(options.core, options.env)).on) return null;
  const record = await readUpdateCheck(options.core.paths.stateDir);
  if (updateSnoozed(record, (options.now ?? (() => new Date()))())) return null;
  return updateVerdict(record, options.running);
}

/** The two ways on, as a tool call and as a command, for a reply's details. */
export const UPDATE_WAYS: {
  readonly update: { readonly tool: 'comms_update'; readonly command: string; readonly npx: string };
  readonly later: {
    readonly tool: 'comms_update';
    readonly arguments: { readonly later: true };
    readonly command: string;
  };
} = Object.freeze({
  update: { tool: 'comms_update', command: 'agentcomms update', npx: 'npx -y @agentcomms/core@latest update' },
  later: { tool: 'comms_update', arguments: { later: true }, command: 'agentcomms update --later' },
});

/**
 * What a stopped tool call says, in words an agent passes on: the owner's sentence first, then the versions, then the
 * two ways on — the update, from chat or a terminal, or "not now", which the person approves like any other change.
 */
export function updateStopMessage(pending: PendingUpdate, where: { server: string; tool: string }): string {
  const didNotRun = `Nothing was done: ${where.tool} did not run.`;
  const later =
    'Not now: call comms_update with `later: true` — a change the person approves — and nothing stops again until midnight; the next request after it asks again. At a terminal: `agentcomms update --later`.';
  if (pending.kind === 'restart') {
    return [
      "Hang on a minute, the update is installed, but this server isn't running it yet. Restart the client first.",
      `This is ${where.server} ${pending.running}; ${pending.latest} is installed on this machine, and a client starts it only once it is restarted. ${didNotRun}`,
      `Ask the person to restart the MCP client — quit it and open it again — and carry on after. ${later}`,
    ].join('\n');
  }
  return [
    UPDATE_FIRST,
    `This is ${where.server} ${pending.running}; the latest release is ${pending.latest}. ${didNotRun}`,
    'Ask the person which they want:',
    `- Update now: call comms_update on the agentcomms (core) server. It shows every step and asks before it changes anything; restart the client after. At a terminal: \`${UPDATE_WAYS.update.command}\` (\`${UPDATE_WAYS.update.npx}\` where agentcomms is not installed).`,
    `- ${later}`,
  ].join('\n');
}
