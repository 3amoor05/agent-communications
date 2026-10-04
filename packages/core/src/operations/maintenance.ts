import { access, constants, stat } from 'node:fs/promises';
import { type ApprovalRecord, type ApprovalState, approvalKind, publicView } from '../approvals.ts';
import type { AuditRecord } from '../audit.ts';
import { revokeChange } from '../changes.ts';
import { type Channel, channelServer } from '../channel-servers.ts';
import { listed, manifestOf } from '../channel-words.ts';
import { commandText, inlineCommand, shellCommand } from '../cli-runtime.ts';
import { type Config, emptyConfig, secretsStoreOf } from '../config.ts';
import type { Core } from '../core.ts';
import { CommsError } from '../errors.ts';
import { isGroupOrWorldAccessible } from '../fs.ts';
import { resolveName } from '../names.ts';
import type { ResolvedPaths } from '../paths.ts';
import { type KeyringModule, keychainNamespace, loadKeyringModule, probeKeychain } from '../secrets.ts';
import {
  countedLatest,
  readUpdateCheck,
  UPDATE_CHECK_ENV,
  updateCheckEnabled,
  updateSnoozed,
  updateVerdict,
} from '../update-state.ts';
import { VERSION } from '../version.ts';
import { type ChannelRegistration, CLIENTS, channelsAvailable } from './servers.ts';

/**
 * The core's own read-only and housekeeping operations: where things live, whether this machine is healthy, what the
 * audit log says, and which approvals exist.
 *
 * Each is one function that `agentcomms` and the core MCP server both call, so a command and its tool cannot drift in
 * what they return or what they refuse. They lived inside the CLI until the server needed them, and the CLI is the one
 * module a library may never import: it starts `main()` when the running script is called `cli.mjs`, which is also
 * what every product's CLI is called.
 */

export function corePaths(core: Core): ResolvedPaths {
  return core.paths;
}

export interface DoctorCheck {
  name: string;
  ok: boolean;
  /**
   * Something to look at rather than a failure: a channel with accounts that no client starts, a client config that
   * cannot be read. `ok` stays true, and so does the report's — a doctor that failed on a machine used only from a
   * terminal would be failing on nothing. Present only on such a check, so every other reads as it always did.
   */
  warn?: true;
  detail: string;
  fix?: string;
}

export interface DoctorReport {
  checks: DoctorCheck[];
  ok: boolean;
}

export interface DoctorOptions {
  /**
   * The keychain module to probe, for a test: the real one writes, reads and deletes an item in the login keychain,
   * and a test must never touch it. `null` is a machine without the module. Left out, the real module is loaded.
   */
  keyring?: KeyringModule | null | undefined;
  /** The shell the commands it prints are quoted for: this machine's, unless a test asks for another by name. */
  platform?: NodeJS.Platform | undefined;
}

/**
 * Whether this machine is healthy. `env` is where the MCP clients' configs are found — the one `agentcomms` runs with,
 * or the core server's — as `agentcomms channels` finds them.
 */
export async function doctor(core: Core, env: NodeJS.ProcessEnv, options: DoctorOptions = {}): Promise<DoctorReport> {
  const checks: DoctorCheck[] = [];
  const platform = options.platform ?? process.platform;
  const [major = 0, minor = 0] = process.versions.node.split('.').map(Number);
  const nodeOk = major > 22 || (major === 22 && minor >= 12);
  checks.push({
    name: 'node',
    ok: nodeOk,
    detail: `Node ${process.versions.node} at ${process.execPath}`,
    ...(nodeOk ? {} : { fix: 'Install Node 22.12 or newer.' }),
  });

  for (const [name, dir] of [
    ['config dir', core.paths.configDir],
    ['state dir', core.paths.stateDir],
  ] as const) {
    try {
      await access(dir, constants.R_OK | constants.W_OK);
      const loose = await isGroupOrWorldAccessible(dir);
      checks.push({
        name,
        ok: !loose,
        detail: dir,
        ...(loose ? { fix: commandText(shellCommand(['chmod', '700', dir], platform)) } : {}),
      });
    } catch {
      checks.push({ name, ok: true, detail: `${dir} (not created yet — created on first use)` });
    }
  }

  let config: Config = emptyConfig();
  let readable = true;
  try {
    config = await core.config.load();
    const exists = await stat(core.config.path).then(
      () => true,
      () => false,
    );
    checks.push({ name: 'config', ok: true, detail: exists ? core.config.path : 'no config yet' });
  } catch (error) {
    readable = false;
    checks.push({
      name: 'config',
      ok: false,
      detail: error instanceof Error ? error.message : String(error),
      fix: 'Fix or restore config.json.',
    });
  }

  /*
   * The one thing on this machine that nothing else announces.
   *
   * A version-1 config is not broken — every command reads and writes it unchanged — so this never fails. It is
   * here because the migration has no symptom until an old name is used somewhere that has already moved on, and
   * because the release requirement is the part people get wrong: one config is shared by everything on a machine,
   * and a program older than 0.2.0 refuses the migrated file outright.
   */
  const toMigrate = readable && config.version === 1;
  checks.push({
    name: 'account names',
    ok: true,
    // `config` falls back to an empty one when the file could not be read, and an empty one is version 2 — which
    // would announce a migration that may not have happened. The check above already says the file is unreadable.
    detail: !readable
      ? 'unknown — the configuration could not be read'
      : toMigrate
        ? 'the old flat names, which still work'
        : 'organisation/platform',
    ...(toMigrate
      ? {
          fix: 'See what they would become with `agentcomms names migrate --dry-run`, once everything sharing this config is on 0.2.0 or later.',
        }
      : {}),
  });

  const keyring = options.keyring !== undefined ? options.keyring : await loadKeyringModule();
  // `probeKeychain` loads the real module when handed none, so a machine without it is answered here instead.
  const probe = keyring
    ? await probeKeychain(keyring, keychainNamespace(core.paths.configDir))
    : { ok: false, reason: 'the optional @napi-rs/keyring package is not installed for this platform' };
  const usesKeychain = secretsStoreOf(config) === 'keychain';
  checks.push({
    name: 'system keychain',
    ok: probe.ok || !usesKeychain,
    detail: probe.ok ? 'readable and writable' : `unavailable: ${probe.reason}`,
    ...(probe.ok || !usesKeychain
      ? {}
      : { fix: 'Unlock the keychain, or move secrets to files: `agentcomms secrets migrate --to file`.' }),
  });
  checks.push({
    name: 'secret backend',
    ok: true,
    detail: config.secrets?.store ?? 'not chosen yet (keychain by default)',
  });
  checks.push(await updateCheckLine(core, env));
  checks.push(...(await registrationChecks(core, env, readable ? config : null, platform)));
  return { checks, ok: checks.every((c) => c.ok) };
}

/**
 * The daily update check, in one line (design 2026-09-28 §4): on or off — and what turned it off — when the registry
 * was last asked, the latest release it named, and the release running here. Never a failure: an update that is out
 * is something to look at, with the two ways on, and the rest is information.
 */
async function updateCheckLine(core: Core, env: NodeJS.ProcessEnv): Promise<DoctorCheck> {
  const enabled = await updateCheckEnabled(core, env);
  const record = await readUpdateCheck(core.paths.stateDir);
  const now = new Date();
  const off = enabled.on
    ? 'on'
    : `off (${enabled.by === 'setting' ? 'agentcomms update --auto off' : enabled.by === 'CI' ? 'CI is set' : `${UPDATE_CHECK_ENV} is set`})`;
  const latest =
    record.latest === null
      ? 'unknown'
      : countedLatest(record) === null
        ? `${record.latest} (a prerelease, not counted)`
        : record.latest;
  const snoozed = updateSnoozed(record, now);
  const parts = [off, `last checked ${record.lastChecked ?? 'never'}`, `latest ${latest}`, `running ${VERSION}`];
  if (snoozed && record.snoozedUntil !== null) parts.push(`put off until ${record.snoozedUntil}`);
  if (record.lastError !== null) parts.push(`the last check got no answer: ${record.lastError}`);
  // The core's server and its command, each as its own stop reads it: installed only when both would start `latest`.
  const verdict = (surface: 'server' | 'command') =>
    enabled.on && !snoozed ? updateVerdict(record, VERSION, { channel: 'core', surface }) : null;
  const [asServer, asCommand] = [verdict('server'), verdict('command')];
  const pending = asServer ?? asCommand;
  return {
    name: 'update check',
    ok: true,
    ...(pending ? { warn: true as const } : {}),
    detail: parts.join(' · '),
    ...(pending === null
      ? {}
      : {
          fix:
            asServer?.kind === 'restart' && asCommand?.kind === 'restart'
              ? `${pending.latest} is installed on this machine: restart the MCP clients, and run commands from it.`
              : 'Run `agentcomms update` (comms_update from a chat), or `agentcomms update --later` to put it off until tomorrow.',
        }),
  };
}

/**
 * Which MCP clients start each server, read the way `agentcomms channels` reads it.
 *
 * Every check above passed on a machine where an install had registered nothing: the only symptom was a client with
 * none of the tools, and the doctor said all was well. So every client config is read for every server:
 *
 *  - an entry whose command or script has gone fails, with the command that registers it again — the client starts
 *    it, it exits, and the client says only that it failed;
 *  - a channel with accounts here that no client starts is something to look at, not a failure: it may be used only
 *    from a terminal, but somebody who connected a mailbox and sees no Gmail tools has usually hit exactly this;
 *  - a client config that cannot be read is said to be unreadable, and nothing is concluded from its silence.
 *
 * `config` is null when it could not be read: the check above says so, and no channel is said to have accounts.
 */
async function registrationChecks(
  core: Core,
  env: NodeJS.ProcessEnv,
  config: Config | null,
  platform: NodeJS.Platform,
): Promise<DoctorCheck[]> {
  const report = await channelsAvailable(core, env);
  const checks: DoctorCheck[] = report.unreadable.map((file) => ({
    name: 'client config',
    ok: true,
    warn: true,
    detail: `${file.path} could not be read (${file.reason}), so which servers ${file.client} starts is not known`,
    fix: `Look at ${file.path}: until it can be read, nothing here can say what it registers.`,
  }));
  const blind = report.unreadable.map((file) => file.path);
  const where = (entry: ChannelRegistration) =>
    `${entry.client} as "${entry.name}" in ${entry.path}${entry.scope === 'project' ? ' (for one project)' : ''}`;
  for (const channel of report.channels) {
    const name = `${channel.channel} server`;
    for (const entry of channel.registered) {
      if (entry.missing === null) continue;
      checks.push({
        name,
        ok: false,
        detail: `registered with ${where(entry)}, but ${entry.missing} is no longer there, so ${entry.client} cannot start it`,
        fix: registerAgain(channel.channel, entry, platform),
      });
    }
    const working = channel.registered.filter((entry) => entry.missing === null);
    if (working.length > 0) {
      checks.push({ name, ok: true, detail: `registered with ${working.map(where).join('; ')}` });
      continue;
    }
    // Registered, and every entry of it broken: the failures above say so, each with what to run.
    if (channel.registered.length > 0) continue;
    const accounts = config === null ? [] : accountsOf(config, channel.channel);
    if (accounts.length === 0) continue;
    const clients = CLIENTS.filter((client) => client !== 'json').join(', ');
    checks.push({
      name,
      ok: true,
      warn: true,
      detail: `${listed(accounts, 'and')} ${accounts.length === 1 ? 'is' : 'are'} set up here, but no MCP client${blind.length > 0 ? ' this could read' : ''} starts the ${channel.label} server${blind.length > 0 ? ` — ${listed(blind, 'and')} could not be read` : ''}`,
      fix: `Register it with the client you use: ${inlineCommand(shellCommand([channel.binary, 'mcp', 'install', '--help'], platform))} (${clients}), or comms_server_install with channel "${channel.channel}" from a chat. Used only from a terminal, it needs nothing.`,
    });
  }
  return checks;
}

/** The names of a channel's accounts on this machine, from the map its manifest keeps them in; none for the core. */
function accountsOf(config: Config, channel: Channel): string[] {
  const accounts = manifestOf(channel)?.accounts;
  if (accounts === undefined) return [];
  if (accounts.map === 'inboxes') return Object.keys(config.inboxes).sort();
  return Object.entries(config.accounts)
    .filter(([, account]) => account.platform === channel)
    .map(([name]) => name)
    .sort();
}

/**
 * What registers a broken entry again as it was: its client, its name, its pin and `--read-only`, and its launcher —
 * the flags `mcp install`'s own hint repeats when it refuses to replace an entry without `--force`, so following it
 * narrows or widens nothing. A project's entry is not one `mcp install` writes, and is said to be where it is instead.
 */
function registerAgain(channel: Channel, entry: ChannelRegistration, platform: NodeJS.Platform): string {
  if (entry.scope === 'project') {
    return `It is registered for one project, in ${entry.path}, and \`mcp install\` registers at user scope only: remove it or register it again there, with ${entry.client}'s own command.`;
  }
  const facts = channelServer(channel);
  const words = [facts.binary, 'mcp', 'install', '--client', entry.client];
  if (entry.name !== facts.defaultServerName) words.push('--name', entry.name);
  words.push(...entry.narrowing);
  if (entry.launcher === 'npx' || entry.launcher === 'local') words.push('--launcher', entry.launcher);
  words.push('--force');
  // The entry's name and pins are read from the client's file, which may hold anything: see `shellCommand`.
  return `Register it again: ${inlineCommand(shellCommand(words, platform))}.`;
}

/** An inbox's id from its name — the current one, so a former name is answered with what it is called now. */
function inboxIdFor(config: Config, alias: string | undefined): string | undefined {
  if (!alias) return undefined;
  return resolveName(config, 'inbox', alias, () => new CommsError('NOT_FOUND', `no inbox called "${alias}"`)).inbox.id;
}

export interface AuditTailOptions {
  inbox?: string | undefined;
  since?: string | undefined;
  limit?: number | undefined;
}

export async function auditTail(core: Core, options: AuditTailOptions = {}): Promise<AuditRecord[]> {
  const limit = options.limit ?? 50;
  if (!Number.isInteger(limit) || limit < 1) {
    throw new CommsError('USAGE', 'the limit must be a positive whole number');
  }
  const inboxId = inboxIdFor(await core.config.load(), options.inbox);
  // The inbox filter goes INTO the scan, not after it. `tail` applies it while counting toward `limit`; filtering
  // the returned array instead meant a quiet inbox's history was read as empty whenever a busier one had produced
  // `limit` records since — and raising `--limit` changed the answer, which is the tell. This is what someone asks
  // to find out what was sent from a mailbox.
  return core.audit.tail({
    limit,
    ...(inboxId ? { inbox: inboxId } : {}),
    ...(options.since ? { since: options.since } : {}),
  });
}

export const APPROVAL_STATES: readonly ApprovalState[] = Object.freeze([
  'pending',
  'approved',
  'sending',
  'used',
  'failed',
  'unknown',
  'expired',
  'revoked',
]);

export type ApprovalView = Omit<ApprovalRecord, 'challengeHash'>;

export async function listApprovals(
  core: Core,
  options: { inbox?: string | undefined; state?: string | undefined } = {},
): Promise<ApprovalView[]> {
  // A state that does not exist matched nothing, and read as "no approvals" — the one answer that is never a
  // reason to look again.
  if (options.state !== undefined && !(APPROVAL_STATES as readonly string[]).includes(options.state)) {
    throw new CommsError('USAGE', `"${options.state}" is not an approval state`, {
      hint: `One of: ${APPROVAL_STATES.join(', ')}.`,
    });
  }
  const inboxId = inboxIdFor(await core.config.load(), options.inbox);
  const records = await core.approvals.list({
    ...(inboxId ? { inboxId } : {}),
    ...(options.state ? { states: [options.state as ApprovalState] } : {}),
  });
  return records.map(publicView);
}

/**
 * Revokes an approval of either kind. Refusing is never the dangerous direction, so this asks nobody.
 *
 * A change approval is revoked through `revokeChange`, which records it in the audit log as every other step of a
 * change approval is; a send approval as it always was.
 */
export async function revokeApproval(core: Core, approvalId: string, surface: 'cli' | 'mcp'): Promise<ApprovalView> {
  const existing = await core.approvals.get(approvalId);
  const reason = 'revoked by the user';
  const record =
    existing && approvalKind(existing) === 'change'
      ? await revokeChange(core, approvalId, reason, { surface })
      : await core.approvals.revoke(approvalId, reason);
  return publicView(record);
}
