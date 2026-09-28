import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { dirname, join } from 'node:path';
import { PassThrough } from 'node:stream';
import { test } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { Client } from '@modelcontextprotocol/client';
import { InMemoryTransport } from '@modelcontextprotocol/server';
import { type GatedChange, gatedChange } from '../src/change-flow.ts';
import { CHANNEL_SERVERS } from '../src/channel-servers.ts';
import type { Streams } from '../src/cli-runtime.ts';
import { type Core, openCore } from '../src/core.ts';
import { CommsError } from '../src/errors.ts';
import { type CoreMcpOptions, createCoreMcpServer } from '../src/mcp/server.ts';
import {
  type RegistrationItem,
  type UpdateDeps,
  type UpdateReport,
  type UpdateResult,
  type UpdateStep,
  updateCheckFindings,
} from '../src/operations/update.ts';
import { updateAutoChange, updateLaterChange } from '../src/operations/update-settings.ts';
import { checkForUpdates, terminalUpdateHooks } from '../src/update-check.ts';
import {
  approvalsOf,
  claimsApproval,
  exemptFromUpdateGate,
  updateGateAtTerminal,
  updateToolGate,
} from '../src/update-gate.ts';
import {
  nextLocalMidnight,
  pendingUpdate,
  readUpdateCheck,
  UPDATE_CHECK_FILE,
  UPDATE_CHECK_LEASE_MS,
  UPDATE_FIRST,
  type UpdateCheckRecord,
  updateCheckPath,
  updateVerdict,
} from '../src/update-state.ts';
import { VERSION } from '../src/version.ts';
import { tempDir } from './helpers/temp.ts';

/*
 * The daily update check (design 2026-09-28): once a day the machine asks npm for the latest release, and every
 * server and command stops — "Hang on a minute, there's an update. Let's update first." — until it is updated or put
 * off until midnight.
 *
 * Nothing here reaches npm. The registry is a function a test hands the checker, or a server on the loopback address;
 * every machine's `npm_config_registry` points at a port nobody answers on besides, so an ask that slipped past a
 * stand-in fails at once rather than reaching the real one. The clock is the test's.
 */

const LATEST = '99.0.0';
const OLD = '0.0.1';
const CORE = '@agentcomms/core';
const CLI = fileURLToPath(new URL('../src/cli.ts', import.meta.url));
const SRC = fileURLToPath(new URL('../src/', import.meta.url));
const NODE_FLAGS = ['--experimental-strip-types', '--disable-warning=ExperimentalWarning'];
/** The core's server, and its command: what a verdict is asked for. */
const SERVER = { channel: 'core', surface: 'server' } as const;
const COMMAND = { channel: 'core', surface: 'command' } as const;
const EMPTY: UpdateCheckRecord = {
  lastChecked: null,
  latest: null,
  behind: null,
  current: null,
  lastError: null,
  snoozedUntil: null,
  checking: null,
};

interface Machine {
  home: string;
  env: Record<string, string>;
  core: Core;
  stateDir: string;
}

/** A home of its own with the check **on**: nothing here sets the switch every other harness sets. */
function machine(extra: Record<string, string> = {}): Machine {
  const home = tempDir('comms-update-gate-');
  const configDir = join(home, 'config');
  mkdirSync(configDir);
  writeFileSync(join(configDir, 'config.json'), `${JSON.stringify({ version: 2, secrets: { store: 'file' } })}\n`);
  const env = {
    HOME: home,
    USERPROFILE: home,
    APPDATA: join(home, 'AppData'),
    LOCALAPPDATA: join(home, 'AppData', 'Local'),
    PATH: join(home, 'bin'),
    AGENT_COMMS_CONFIG_DIR: configDir,
    AGENT_COMMS_DATA_DIR: join(home, 'data'),
    AGENT_COMMS_CLIENT_CLI_DIRS: '',
    NO_COLOR: '1',
    npm_config_offline: 'true',
    // Nobody answers here: an ask that got past a stand-in fails at once instead of reaching the real registry.
    npm_config_registry: 'http://127.0.0.1:9/',
    ...extra,
  };
  const core = openCore({ env });
  return { home, env, core, stateDir: core.paths.stateDir };
}

/** The file as a check would have left it: asked `ago` milliseconds before `at`. */
function seed(m: Machine, record: Partial<UpdateCheckRecord>, at = new Date()): void {
  mkdirSync(m.stateDir, { recursive: true });
  writeFileSync(
    updateCheckPath(m.stateDir),
    JSON.stringify({
      lastChecked: at.toISOString(),
      latest: null,
      behind: null,
      lastError: null,
      snoozedUntil: null,
      ...record,
    }),
  );
}

/** A registry that answers `latest` for core, counting the asks. */
function registry(latest: string | (() => Promise<string>) = LATEST) {
  const asked: string[] = [];
  const latestVersion = async (name: string) => {
    asked.push(name);
    return typeof latest === 'string' ? latest : latest();
  };
  return { asked, latestVersion };
}

/** The update's other stand-ins: nothing registered, and `global` installed globally. */
function deps(latestVersion: UpdateDeps['latestVersion'], global: Record<string, string> = { [CORE]: OLD }) {
  const installed = { ...global };
  return {
    latestVersion,
    globalPackages: async () => ({ ...installed }),
    installGlobal: async (spec: string) => {
      const at = spec.lastIndexOf('@');
      installed[spec.slice(0, at)] = spec.slice(at + 1);
    },
    installRuntime: async () => undefined,
  } satisfies UpdateDeps;
}

interface ToolResult {
  isError?: boolean;
  content?: { type: string; text?: string }[];
  structuredContent?: Record<string, unknown>;
}

/** A registry that cannot be reached: what a server is handed when a test is not about the registry. */
const unreachable = async (): Promise<string> => {
  throw new Error('the registry could not be reached (a test that is not about it)');
};

async function connect(m: Machine, options: Partial<CoreMcpOptions> = {}) {
  const { server } = await createCoreMcpServer({
    core: m.core,
    env: m.env,
    keyring: null,
    update: deps(unreachable),
    ...options,
  });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 'test', version: '0' });
  await Promise.all([client.connect(clientTransport), server.connect(serverTransport)]);
  const call = async (name: string, args: Record<string, unknown> = {}) =>
    (await client.callTool({ name, arguments: args })) as ToolResult;
  return { call, close: () => Promise.all([client.close(), server.close()]) };
}

const textOf = (result: ToolResult) => result.content?.find((part) => part.type === 'text')?.text ?? '';
const codeOf = (result: ToolResult) =>
  (result.structuredContent as { error?: { code?: string } } | undefined)?.error?.code;
const stopped = (result: ToolResult) => codeOf(result) === 'UPDATE_REQUIRED';

/** Polls until `ready` holds, or fails after `ms`. */
async function until(ready: () => boolean | Promise<boolean>, what: string, ms = 5_000): Promise<void> {
  const deadline = Date.now() + ms;
  while (!(await ready())) {
    if (Date.now() > deadline) assert.fail(`timed out waiting for ${what}`);
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}

// ── The reader carries no network code ───────────────────────────────────────────────────────────────────────

test('the reader, the gate and "not now" import nothing that reaches the registry', () => {
  /*
   * WhatsApp imports exactly these, and promises it reaches no network: the modules they reach, followed through
   * every value import, must not include the checker, `npm.ts` or the update — which all ask the registry — nor any
   * network module, nor call `fetch`.
   */
  const seen = new Set<string>();
  const stack = ['update-state.ts', 'update-gate.ts', join('operations', 'update-settings.ts')].map((file) =>
    join(SRC, file),
  );
  const bare = new Set<string>();
  while (stack.length > 0) {
    const file = stack.pop() as string;
    if (seen.has(file)) continue;
    seen.add(file);
    const source = readFileSync(file, 'utf8');
    for (const match of source.matchAll(/^\s*(?:import|export)\s+(type\s+)?[^;'"]*?from\s*['"]([^'"]+)['"]/gm)) {
      if (match[1]) continue; // a type is erased; it reaches nothing at run time
      const specifier = match[2] as string;
      if (specifier.startsWith('.')) stack.push(join(dirname(file), specifier));
      else bare.add(specifier.replace(/^node:/, ''));
    }
    for (const match of source.matchAll(/\bimport\(\s*['"]([^'"]+)['"]\s*\)/g)) {
      bare.add((match[1] as string).replace(/^node:/, ''));
    }
    assert.doesNotMatch(
      source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, ''),
      /\bfetch\s*\(/,
      `${file} calls fetch`,
    );
  }
  const reached = [...seen].map((file) => file.slice(SRC.length).replaceAll('\\', '/'));
  assert.ok(reached.includes('update-state.ts') && reached.includes('change-flow.ts'), 'the graph was read');
  for (const asks of ['npm.ts', 'update-check.ts', 'operations/update.ts']) {
    assert.ok(!reached.includes(asks), `the reader reaches ${asks}, which asks the registry`);
  }
  const network = ['net', 'http', 'https', 'http2', 'tls', 'dgram', 'dns', 'dns/promises', 'undici'];
  assert.deepEqual(
    [...bare].filter((name) => network.includes(name)),
    [],
  );
});

// ── The checker: once a day, for the whole machine ────────────────────────────────────────────────────────────

test('a stale file triggers one check, and never a second in the same day — two at once included', async () => {
  const m = machine();
  const { asked, latestVersion } = registry();
  const start = new Date('2026-09-28T09:00:00.000Z');
  const at = (ms: number) => () => new Date(start.getTime() + ms);
  const check = (ms: number) => checkForUpdates(m.core, m.env, { deps: deps(latestVersion), now: at(ms) });

  // No file at all is as stale as a file can be. Two calls at the same moment: one asks.
  const [first, second] = await Promise.all([check(0), check(0)]);
  assert.deepEqual([first.asked, second.asked].sort(), [false, true]);
  assert.deepEqual(asked, [CORE], 'the registry was asked once, for core alone');
  const record = await readUpdateCheck(m.stateDir);
  assert.equal(record.lastChecked, start.toISOString());
  assert.equal(record.latest, LATEST);
  assert.equal(record.behind, true, 'the global core at 0.0.1 is behind');

  // The rest of the day: nothing.
  for (const ms of [60_000, 12 * 3_600_000, 24 * 3_600_000 - 1]) {
    assert.equal((await check(ms)).asked, false, `asked again ${ms} ms later`);
  }
  assert.equal(asked.length, 1);
  // A day on, once.
  assert.equal((await check(24 * 3_600_000)).asked, true);
  assert.equal((await check(24 * 3_600_000 + 1)).asked, false);
  assert.equal(asked.length, 2);
  // Another process's clock, read a moment before this claim was written, is not a clock gone back.
  assert.equal((await check(24 * 3_600_000 - 5)).asked, false, 'a clock read milliseconds earlier asked again');
  // A clock that did go back — hours — asks: the record is from its future, and cannot be trusted.
  assert.equal((await check(20 * 3_600_000)).asked, true);
  assert.equal(asked.length, 3);
});

/** A registry on the loopback address that answers `latest` for core after `delayMs`, and counts every request. */
async function loopbackRegistry(latest: string, delayMs: number) {
  const requests: string[] = [];
  const server: Server = createServer((request, response) => {
    requests.push(request.url ?? '');
    setTimeout(() => {
      response
        .writeHead(200, { 'content-type': 'application/json' })
        .end(JSON.stringify({ name: CORE, 'dist-tags': { latest }, versions: { [latest]: {} } }));
    }, delayMs);
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${port}/`,
    requests,
    close: () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections();
        server.close(() => resolve());
      }),
  };
}

test('two processes that find the file a day old at the same moment ask the registry once between them', async () => {
  const m = machine();
  // Slow enough that both are asking at once unless one of them does not ask at all.
  const served = await loopbackRegistry(LATEST, 1_500);
  const dir = tempDir('comms-update-race-');
  const go = join(dir, 'go');
  const script = join(dir, 'check.ts');
  writeFileSync(
    script,
    [
      `import { writeFileSync, existsSync } from 'node:fs';`,
      `import { openCore } from ${JSON.stringify(pathToFileURL(join(SRC, 'core.ts')).href)};`,
      `import { checkForUpdates } from ${JSON.stringify(pathToFileURL(join(SRC, 'update-check.ts')).href)};`,
      'const env = JSON.parse(process.env.GATE_ENV);',
      'const core = openCore({ env });',
      // Ready, then wait for the word: both start the check within a few milliseconds of each other.
      'writeFileSync(process.env.READY, "");',
      `while (!existsSync(${JSON.stringify(go)})) await new Promise((resolve) => setTimeout(resolve, 5));`,
      'const outcome = await checkForUpdates(core, env, { deps: { globalPackages: async () => ({}) } });',
      'process.stdout.write(JSON.stringify({ asked: outcome.asked }));',
      '',
    ].join('\n'),
  );
  const env = { ...m.env, npm_config_registry: served.url };
  const child = (name: string) => {
    const ready = join(dir, `${name}.ready`);
    const process_ = spawn(process.execPath, [...NODE_FLAGS, script], {
      env: { PATH: process.env.PATH ?? '', GATE_ENV: JSON.stringify(env), READY: ready },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    process_.stdout.on('data', (chunk) => {
      stdout += String(chunk);
    });
    process_.stderr.on('data', (chunk) => {
      stderr += String(chunk);
    });
    const done = new Promise<{ asked: boolean }>((resolve, reject) => {
      process_.once('error', reject);
      process_.once('close', (code) =>
        code === 0 ? resolve(JSON.parse(stdout) as { asked: boolean }) : reject(new Error(`exit ${code}: ${stderr}`)),
      );
    });
    return { ready, done };
  };
  try {
    const one = child('one');
    const two = child('two');
    await until(() => existsSync(one.ready) && existsSync(two.ready), 'both processes to start', 60_000);
    writeFileSync(go, '');
    const outcomes = await Promise.all([one.done, two.done]);
    assert.deepEqual(outcomes.map((outcome) => outcome.asked).sort(), [false, true], 'one of them asked');
    assert.deepEqual(served.requests, ['/@agentcomms%2fcore'], 'the registry was asked once');
    assert.equal((await readUpdateCheck(m.stateDir)).latest, LATEST);
  } finally {
    await served.close();
  }
});

test('offline, the check stops nothing: it keeps the last result, says why, and is not tried again that day', async () => {
  const m = machine();
  const offline = registry(async () => {
    throw new Error('http://127.0.0.1:9 could not be reached (ECONNREFUSED)');
  });
  const now = new Date();
  const outcome = await checkForUpdates(m.core, m.env, { deps: deps(offline.latestVersion), now: () => now });
  assert.equal(outcome.asked, true);
  assert.equal(outcome.record.latest, null);
  assert.equal(outcome.record.lastChecked, now.toISOString(), 'the ask counts as the day’s');
  assert.match(String(outcome.record.lastError), /ECONNREFUSED/);
  assert.equal(
    await pendingUpdate({ core: m.core, env: m.env, running: VERSION, ...SERVER }),
    null,
    'nothing is stopped',
  );
  assert.equal((await checkForUpdates(m.core, m.env, { deps: deps(offline.latestVersion) })).asked, false);
  assert.equal(offline.asked.length, 1);

  // A machine that knew of an update before going offline still knows of it: the file keeps its last result.
  const known = machine();
  seed(known, { latest: LATEST, behind: true }, new Date(Date.now() - 25 * 3_600_000));
  await checkForUpdates(known.core, known.env, { deps: deps(offline.latestVersion) });
  const kept = await readUpdateCheck(known.stateDir);
  assert.equal(kept.latest, LATEST);
  assert.equal(kept.behind, true);
});

test('a hanging registry never delays a tool call: the check runs in the background and the gate reads the file', async () => {
  const m = machine();
  let answer: (version: string) => void = () => undefined;
  const hanging = registry(() => new Promise<string>((resolve) => (answer = resolve)));
  const { call, close } = await connect(m, { update: deps(hanging.latestVersion) });
  try {
    const started = Date.now();
    const first = await call('comms_channels_available');
    assert.ok(Date.now() - started < 2_000, 'the call waited for the registry');
    assert.equal(first.isError, undefined, JSON.stringify(first.structuredContent));
    await until(() => hanging.asked.length === 1, 'the background check to ask');
    // The registry answers; once the file says so, the next call is stopped.
    answer(LATEST);
    await until(async () => (await readUpdateCheck(m.stateDir)).behind === true, 'the check to be recorded');
    const second = await call('comms_channels_available');
    assert.ok(stopped(second), JSON.stringify(second.structuredContent));
    assert.equal(hanging.asked.length, 1, 'one check, whatever the number of calls');
  } finally {
    await close();
  }
});

test('a prerelease named latest never stops anything, in the file or from the registry', async () => {
  const m = machine();
  seed(m, { latest: '99.0.0-rc.1', behind: true });
  assert.equal(await pendingUpdate({ core: m.core, env: m.env, running: VERSION, ...SERVER }), null);
  const { call, close } = await connect(m);
  try {
    assert.ok(!stopped(await call('comms_channels_available')));
  } finally {
    await close();
  }
  // Asked of the registry: recorded as it said, and not counted.
  const fresh = machine();
  const rc = registry('99.0.0-rc.1');
  const outcome = await checkForUpdates(fresh.core, fresh.env, { deps: deps(rc.latestVersion) });
  assert.equal(outcome.record.latest, '99.0.0-rc.1');
  assert.equal(outcome.record.behind, null);
  assert.equal(await pendingUpdate({ core: fresh.core, env: fresh.env, running: VERSION, ...SERVER }), null);
  // And the release after it is: 99.0.0 is newer than anything this checkout is.
  seed(fresh, { latest: LATEST, behind: true });
  assert.notEqual(await pendingUpdate({ core: fresh.core, env: fresh.env, running: VERSION, ...SERVER }), null);
});

// ── The server's stop ───────────────────────────────────────────────────────────────────────────────────────────

test('an update that is out stops a tool with the owner’s words, and never the update, the doctor or the paths', async () => {
  const m = machine();
  seed(m, { latest: LATEST, behind: true });
  const { latestVersion } = registry();
  const { call, close } = await connect(m, { update: deps(latestVersion) });
  try {
    const result = await call('comms_channels_available');
    assert.equal(result.isError, true);
    assert.ok(textOf(result).startsWith(UPDATE_FIRST), textOf(result));
    assert.ok(textOf(result).startsWith("Hang on a minute, there's an update. Let's update first."));
    assert.match(
      textOf(result),
      new RegExp(`agentcomms ${VERSION.replaceAll('.', '\\.')}; the latest release is 99\\.0\\.0`),
    );
    assert.match(textOf(result), /comms_update/);
    assert.match(textOf(result), /`agentcomms update`/);
    assert.match(textOf(result), /`later: true`/);
    // Both ways on have an npx form, for a machine with neither the core server nor `agentcomms` — a plugin's alone.
    assert.match(textOf(result), /`npx -y @agentcomms\/core@latest update`/);
    assert.match(textOf(result), /`npx -y @agentcomms\/core@latest update --later`/);
    assert.match(textOf(result), /a plugin's, an extension's — is updated where it was installed/);
    assert.match(textOf(result), /comms_channels_available did not run/);
    // Claude Code and Codex show the model only the structured content: the same words are there.
    const error = (result.structuredContent as { error: { message: string; details: Record<string, unknown> } }).error;
    assert.ok(error.message.startsWith(UPDATE_FIRST));
    assert.equal(error.details.running, VERSION);
    assert.equal(error.details.latest, LATEST);
    assert.equal(error.details.installed, false);

    for (const [name, args] of [
      ['comms_update', { check: true }],
      ['comms_doctor', {}],
      ['comms_paths', {}],
    ] as const) {
      const passed = await call(name, args);
      assert.ok(!stopped(passed), `${name} was stopped`);
      assert.notEqual(passed.isError, true, `${name}: ${JSON.stringify(passed.structuredContent)}`);
    }
  } finally {
    await close();
  }
});

test('a call that claims an approval this machine holds goes ahead; an empty or unknown one, and a new call, are stopped', async () => {
  const m = machine();
  const { call, close } = await connect(m);
  try {
    // Prepared before the check landed.
    const prepared = await call('comms_update', { later: true });
    const approvalId = (prepared.structuredContent as { approvalId: string }).approvalId;
    assert.match(approvalId, /^ap_/);
    assert.equal(await claimsApproval(m.core, approvalId), true);
    // The check lands.
    seed(m, { latest: LATEST, behind: true });
    const revoke = await call('comms_approval_revoke', { approvalId });
    assert.ok(!stopped(revoke), JSON.stringify(revoke.structuredContent));
    assert.equal(revoke.isError, undefined);
    // The key alone claims nothing. Let past, each of these would run the tool's first call with an update out — and
    // a tightening applies at once: the policy would be `confirm` now, with no approval claimed at all.
    for (const claimed of ['', 'ap_', 'not-an-approval', `ap_${'0'.repeat(26)}`]) {
      assert.equal(await claimsApproval(m.core, claimed), false, JSON.stringify(claimed));
      const result = await call('comms_change_policy', { set: 'confirm', approvalId: claimed });
      assert.ok(stopped(result), `${JSON.stringify(claimed)}: ${JSON.stringify(result.structuredContent)}`);
    }
    assert.equal((await m.core.config.load()).defaults.changePolicy, undefined, 'the policy was changed');
    // Without one: stopped.
    assert.ok(stopped(await call('comms_change_policy', { set: 'confirm' })));
  } finally {
    await close();
  }
});

// ── "Restart", only where restarting starts the latest ─────────────────────────────────────────────────────────

test('an update installed but not yet loaded says to restart the client, not to update', async () => {
  const m = machine();
  // What the check found: every registration of the core server names 99.0.0.
  seed(m, { latest: LATEST, behind: false, current: { registered: ['core'], global: [] } });
  const { call, close } = await connect(m);
  try {
    const result = await call('comms_audit_tail');
    assert.ok(stopped(result));
    const text = textOf(result);
    assert.match(
      text,
      /^Hang on a minute, the update is installed, but this server isn't running it yet\. Restart the client first\./,
    );
    assert.match(text, /99\.0\.0 is installed on this machine/);
    assert.doesNotMatch(text, /Let's update first/);
    assert.equal(
      (result.structuredContent as { error: { details: { installed: boolean } } }).error.details.installed,
      true,
    );
  } finally {
    await close();
  }

  // And an update applied here is what makes it so: the old server, registered with Cursor, stops saying "update" at
  // once. A server nothing here registers — Gmail's, started by a plugin — is not made "installed" by it.
  const updated = machine();
  cursorWith(updated, { agentcomms: npxEntry('core', OLD) });
  seed(updated, { latest: LATEST, behind: true });
  const { latestVersion } = registry();
  const server = await connect(updated, { update: deps(latestVersion) });
  try {
    assert.match(textOf(await server.call('comms_audit_tail')), /Let's update first/);
    const first = (await server.call('comms_update', { noVerify: true })).structuredContent as { approvalId: string };
    const applied = await server.call('comms_update', { noVerify: true, approvalId: first.approvalId });
    assert.equal(applied.isError, undefined, JSON.stringify(applied.structuredContent));
    const record = await readUpdateCheck(updated.stateDir);
    assert.equal(record.behind, false);
    assert.deepEqual(record.current, { registered: ['core'], global: ['core'] });
    assert.match(textOf(await server.call('comms_audit_tail')), /Restart the client first/);
    const gmail = await pendingUpdate({
      core: updated.core,
      env: updated.env,
      running: VERSION,
      channel: 'gmail',
      surface: 'server',
    });
    assert.equal(gmail?.kind, 'update');
  } finally {
    await server.close();
  }
});

/** Cursor's own configuration, in this machine's home, holding `servers`: a client the scan reads. */
function cursorWith(m: Machine, servers: Record<string, { command: string; args: string[] }>): void {
  mkdirSync(join(m.home, '.cursor'), { recursive: true });
  writeFileSync(join(m.home, '.cursor', 'mcp.json'), `${JSON.stringify({ mcpServers: servers }, null, 2)}\n`);
}

/** An entry the npx launcher writes for `channel` — pinned to `version`, or, as one written by hand, to nothing. */
function npxEntry(channel: 'core' | 'gmail', version: string | null): { command: string; args: string[] } {
  const facts = CHANNEL_SERVERS[channel];
  const spec = version === null ? facts.npxPackage : `${facts.npxPackage}@${version}`;
  return { command: 'npx', args: ['-y', spec, ...(facts.npxArgs ?? [])] };
}

test('"restart" is never said for a server the check did not find registered at the latest release', async () => {
  const verdict = (record: Partial<UpdateCheckRecord>, where: { channel: string; surface: 'server' | 'command' }) =>
    updateVerdict({ ...EMPTY, latest: LATEST, ...record }, VERSION, where)?.kind;
  // Nothing behind, and nothing found at the latest either: "update", not "restart" — machine-wide `behind` says
  // nothing about this server. Nor does a check that could not tell.
  assert.equal(verdict({ behind: false, current: null }, SERVER), 'update');
  assert.equal(verdict({ behind: null, current: null }, SERVER), 'update');
  assert.equal(verdict({ behind: false, current: { registered: [], global: [] } }, SERVER), 'update');
  // Each channel its own, and each surface its own: a server by its registrations, a command by its global package.
  const current = { registered: ['gmail'], global: ['core'] };
  assert.equal(verdict({ current }, { channel: 'gmail', surface: 'server' }), 'restart');
  assert.equal(verdict({ current }, SERVER), 'update');
  assert.equal(verdict({ current }, COMMAND), 'restart');
  assert.equal(verdict({ current }, { channel: 'gmail', surface: 'command' }), 'update');

  // The machine the review found: no registration the scan can see (a plugin's server) and no global package. The
  // check finds nothing behind, and the server still says "update".
  const bare = machine();
  const { latestVersion } = registry();
  await checkForUpdates(bare.core, bare.env, { deps: deps(latestVersion, {}) });
  const found = await readUpdateCheck(bare.stateDir);
  assert.equal(found.behind, false);
  assert.deepEqual(found.current, { registered: [], global: [] });
  const { call, close } = await connect(bare);
  try {
    const text = textOf(await call('comms_audit_tail'));
    assert.ok(text.startsWith(UPDATE_FIRST), text);
    assert.doesNotMatch(text, /Restart the client/);
  } finally {
    await close();
  }

  // A hand-written entry that pins no release, and a Gmail one pinned at the latest beside it: Gmail is not known to
  // be at the latest — restarting may start the unpinned one's npx cache — and the machine is not known either way.
  const unpinned = machine();
  cursorWith(unpinned, { gmail: npxEntry('gmail', null), 'gmail-latest': npxEntry('gmail', LATEST) });
  await checkForUpdates(unpinned.core, unpinned.env, { deps: deps(latestVersion, {}) });
  const record = await readUpdateCheck(unpinned.stateDir);
  assert.equal(record.behind, null);
  assert.deepEqual(record.current, { registered: [], global: [] });
  const gate = updateToolGate({
    core: unpinned.core,
    env: unpinned.env,
    server: 'agent-gmail',
    channel: 'gmail',
    running: VERSION,
    exempt: [],
  });
  const stop = (await gate('gmail_search', {})) as { content: { text: string }[] } | null;
  assert.ok(stop?.content[0]?.text.startsWith(UPDATE_FIRST), JSON.stringify(stop));

  // Pinned at the latest and nothing else: that server, and only that one, is "installed".
  const pinned = machine();
  cursorWith(pinned, { gmail: npxEntry('gmail', LATEST) });
  await checkForUpdates(pinned.core, pinned.env, { deps: deps(latestVersion, {}) });
  assert.deepEqual((await readUpdateCheck(pinned.stateDir)).current, { registered: ['gmail'], global: [] });
});

/** One client's registration of `channel`'s server, as a report lists it. */
function registration(channel: string, version: string | null, over: Partial<RegistrationItem> = {}): RegistrationItem {
  return {
    kind: 'registration',
    channel,
    package: `@agentcomms/${channel}`,
    client: 'cursor',
    name: channel,
    scope: 'user',
    path: 'mcp.json',
    launcher: 'npx',
    version,
    latest: LATEST,
    narrowing: [],
    ...over,
  };
}

const globalPackage = (name: string, version: string) =>
  ({ kind: 'global', package: name, version, latest: LATEST }) as const;

function report(over: Partial<UpdateReport> = {}): UpdateReport {
  return { core: VERSION, latest: { [CORE]: LATEST }, behind: [], upToDate: [], unpinned: [], unreadable: [], ...over };
}

test('what a check records: a channel is current only on what the scan saw pinning the latest release', () => {
  const find = (over: Partial<UpdateReport>) => updateCheckFindings(report(over), LATEST);
  assert.deepEqual(
    find({}),
    { behind: false, current: { registered: [], global: [] } },
    'nothing seen, nothing current',
  );
  const atLatest = registration('gmail', LATEST);
  assert.deepEqual(find({ upToDate: [atLatest] }).current.registered, ['gmail']);
  // Another registration of the same channel that pins nothing: not current, and the machine not known.
  const unpinned = find({ upToDate: [atLatest], unpinned: [registration('gmail', null, { name: 'mine' })] });
  assert.deepEqual(unpinned, { behind: null, current: { registered: [], global: [] } });
  // Another channel's pins nothing: Gmail is still current.
  assert.deepEqual(find({ upToDate: [atLatest], unpinned: [registration('slack', null)] }).current.registered, [
    'gmail',
  ]);
  // One behind beside one at the latest: not current.
  const behind = find({ upToDate: [atLatest], behind: [registration('gmail', OLD, { name: 'old' })] });
  assert.deepEqual(behind, { behind: true, current: { registered: [], global: [] } });
  // A client's configuration unread may hold another: nothing is current. The global list unread says nothing of
  // registrations.
  const client = { client: 'gemini', path: 'settings.json', reason: 'it is not JSON, even allowing comments' };
  assert.deepEqual(find({ upToDate: [atLatest], unreadable: [client] }).current.registered, []);
  const npm = { client: 'npm', path: 'the global packages (npm ls --global)', reason: 'npm was not found' };
  assert.deepEqual(find({ upToDate: [atLatest], unreadable: [npm] }), {
    behind: null,
    current: { registered: ['gmail'], global: [] },
  });
  // A command's own package, installed globally at the latest; and only its own: gmail-mcp is not agent-gmail.
  assert.deepEqual(find({ upToDate: [globalPackage(CORE, LATEST)] }).current.global, ['core']);
  assert.deepEqual(find({ behind: [globalPackage(CORE, OLD)] }).current.global, []);
  assert.deepEqual(find({ upToDate: [globalPackage('@agentcomms/gmail-mcp', LATEST)] }).current.global, []);
});

test('what an update records: what it moved counts, and a step that failed, was skipped or left for a person does not', () => {
  const core = registration('core', OLD);
  const before = report({ behind: [core, globalPackage(CORE, OLD)] });
  const registered = (
    outcome: 'registered' | 'failed' | 'skipped',
    verification?: 'passed' | 'failed' | 'skipped',
  ): UpdateStep => ({
    kind: 'registration',
    channel: 'core',
    client: core.client,
    name: core.name,
    scope: 'user',
    path: core.path,
    launcher: 'npx',
    from: OLD,
    to: LATEST,
    narrowing: [],
    outcome,
    ...(verification ? { verification } : {}),
  });
  const installed = (outcome: 'updated' | 'failed'): UpdateStep => ({
    kind: 'global',
    package: CORE,
    from: OLD,
    to: LATEST,
    outcome,
  });
  const result = (steps: UpdateResult['steps'], over: Partial<UpdateResult> = {}): UpdateResult => ({
    status: 'updated',
    latest: { [CORE]: LATEST },
    steps,
    manual: [],
    ok: true,
    next: null,
    ...over,
  });
  assert.deepEqual(
    updateCheckFindings(before, LATEST, result([registered('registered', 'skipped'), installed('updated')])),
    { behind: false, current: { registered: ['core'], global: ['core'] } },
  );
  for (const step of [registered('failed'), registered('skipped'), registered('registered', 'failed')]) {
    assert.deepEqual(
      updateCheckFindings(before, LATEST, result([step, installed('failed')], { status: 'failed', ok: false })),
      { behind: true, current: { registered: [], global: [] } },
      JSON.stringify(step),
    );
  }
  // Every step worked, and a second registration of the core server was left for a person: still behind, and the
  // core server is not current — restarting may start the one left behind.
  const left = registration('core', OLD, { name: 'by-hand', launcher: 'other' });
  const withManual = report({ behind: [core, left, globalPackage(CORE, OLD)] });
  assert.deepEqual(
    updateCheckFindings(
      withManual,
      LATEST,
      result([registered('registered'), installed('updated')], { manual: [left] }),
    ),
    { behind: true, current: { registered: [], global: ['core'] } },
  );
  // Nothing it could do — what is behind is all a person's — is still behind; nothing to do at all is not.
  assert.equal(updateCheckFindings(report(), LATEST, result([], { status: 'manual' })).behind, true);
  assert.equal(updateCheckFindings(report(), LATEST, result([], { status: 'up-to-date' })).behind, false);
});

test('what an update records: an old entry by the same name in another scope is not the one it moved', () => {
  /*
   * Claude Code, with a user-scope `gmail` the update registers again, and a `gmail` one project pins to an old
   * release. The update leaves the project's for a person (it registers at user scope only), and in that project
   * Claude Code starts the project's — so Gmail is not known to run the latest there, and restarting would not help.
   * Twice: a local-scope entry, which Claude Code keeps in the same `~/.claude.json` as the user's, told apart only by
   * its scope; and a project-scope one, in the project's own `.mcp.json`.
   */
  const claudeJson = '~/.claude.json';
  const user = registration('gmail', OLD, { client: 'claude-code', path: claudeJson });
  const moved: UpdateStep = {
    kind: 'registration',
    channel: 'gmail',
    client: 'claude-code',
    name: 'gmail',
    scope: 'user',
    path: claudeJson,
    launcher: 'npx',
    from: OLD,
    to: LATEST,
    narrowing: [],
    outcome: 'registered',
    verification: 'passed',
  };
  for (const [label, left] of [
    [
      'local scope, the same file',
      registration('gmail', OLD, { client: 'claude-code', scope: 'project', path: claudeJson }),
    ],
    [
      'project scope, its own file',
      registration('gmail', OLD, { client: 'claude-code', scope: 'project', path: '/work/app/.mcp.json' }),
    ],
  ] as const) {
    const pinnedOld = { ...left, updatable: false, reason: 'it is registered for one project' };
    const findings = updateCheckFindings(report({ behind: [user, pinnedOld] }), LATEST, {
      status: 'manual',
      latest: { [CORE]: LATEST },
      steps: [moved],
      manual: [pinnedOld],
      ok: true,
      next: null,
    });
    assert.deepEqual(findings, { behind: true, current: { registered: [], global: [] } }, label);
  }
  // Moved on its own, the user's entry does make Gmail current: the key still finds the registration it moved.
  assert.deepEqual(
    updateCheckFindings(report({ behind: [user] }), LATEST, {
      status: 'updated',
      latest: { [CORE]: LATEST },
      steps: [moved],
      manual: [],
      ok: true,
      next: null,
    }).current.registered,
    ['gmail'],
  );
});

// ── Not now ───────────────────────────────────────────────────────────────────────────────────────────────────

test('not now lasts until local midnight, and holds for every server on the machine', async () => {
  const m = machine();
  seed(m, { latest: LATEST, behind: true });
  const evening = new Date(2026, 8, 28, 21, 30, 0);
  const midnight = nextLocalMidnight(evening);
  assert.deepEqual(
    [midnight.getFullYear(), midnight.getMonth(), midnight.getDate(), midnight.getHours(), midnight.getMinutes()],
    [2026, 8, 29, 0, 0],
  );
  const change = updateLaterChange(m.core, { now: () => evening });
  const plan = await change.plan(await m.core.config.load());
  assert.equal(plan.summary, `Skip the update to ${LATEST} until tomorrow`);
  assert.match(String(plan.effects?.[0]), /until midnight, local time \(2026-09-29 00:00\)/);
  const result = await change.apply(undefined, plan);
  assert.equal(result.snoozedUntil, midnight.toISOString());

  const at = (when: Date) => pendingUpdate({ core: m.core, env: m.env, running: VERSION, now: () => when, ...SERVER });
  assert.equal(await at(evening), null);
  assert.equal(await at(new Date(midnight.getTime() - 1)), null, 'a millisecond before midnight: still put off');
  assert.notEqual(await at(midnight), null, 'at midnight it asks again');

  // Machine-wide: a second server — another process, another core, the same state directory — reads it too.
  const other = { ...m, core: openCore({ env: m.env }) };
  const gate = updateToolGate({
    core: other.core,
    env: m.env,
    server: 'agent-gmail',
    channel: 'gmail',
    running: VERSION,
    exempt: [],
    now: () => evening,
  });
  assert.equal(await gate('gmail_search', {}), null);
  const later = updateToolGate({
    core: other.core,
    env: m.env,
    server: 'agent-gmail',
    channel: 'gmail',
    running: VERSION,
    exempt: [],
    now: () => midnight,
  });
  assert.notEqual(await later('gmail_search', {}), null);
});

test('not now and turning the check off each need the person’s approval, and cannot be applied without it', async () => {
  const m = machine();
  seed(m, { latest: LATEST, behind: true });
  const { call, close } = await connect(m);
  try {
    // Not now: a preview and an id, and nothing written yet.
    const later = (await call('comms_update', { later: true })).structuredContent as Record<string, unknown>;
    assert.equal(later.approvalRequired, true);
    assert.equal(later.summary, `Skip the update to ${LATEST} until tomorrow`);
    assert.match(String(later.preview), /puts off the update to 99\.0\.0 until midnight/);
    assert.equal((await readUpdateCheck(m.stateDir)).snoozedUntil, null);
    // An id it did not prepare is refused, and nothing is written.
    const forged = await call('comms_update', { later: true, approvalId: `ap_${'0'.repeat(26)}` });
    assert.equal(forged.isError, true);
    assert.equal((await readUpdateCheck(m.stateDir)).snoozedUntil, null);
    assert.ok(stopped(await call('comms_channels_available')), 'still stopped');
    // With its own id, after the person's yes: put off.
    const applied = (await call('comms_update', { later: true, approvalId: later.approvalId })).structuredContent as {
      applied: boolean;
      result: { snoozedUntil: string };
    };
    assert.equal(applied.applied, true);
    assert.equal(applied.result.snoozedUntil, nextLocalMidnight(new Date()).toISOString());
    assert.ok(!stopped(await call('comms_channels_available')), 'carries on until midnight');

    // Off: a loosening, prepared, and applied only with its id.
    const off = (await call('comms_update', { auto: 'off' })).structuredContent as Record<string, unknown>;
    assert.equal(off.approvalRequired, true);
    assert.match(String(off.preview), /daily update check: on → off/);
    assert.equal((await m.core.config.load()).defaults.updateCheck, undefined);
    const turned = (await call('comms_update', { auto: 'off', approvalId: off.approvalId })).structuredContent as {
      result: { updateCheck: string; changed: boolean };
    };
    assert.deepEqual(turned.result, { updateCheck: 'off', changed: true });
    assert.equal((await m.core.config.load()).defaults.updateCheck, 'off');
    // On: tightening, applied at once.
    const on = (await call('comms_update', { auto: 'on' })).structuredContent as Record<string, unknown>;
    assert.equal(on.applied, true);
    assert.equal((await m.core.config.load()).defaults.updateCheck, 'on');

    // One at a time.
    const both = await call('comms_update', { later: true, auto: 'off' });
    assert.equal(codeOf(both), 'USAGE');
  } finally {
    await close();
  }
  // The store itself refuses turning it off without the person's consent, whoever asks.
  await assert.rejects(
    m.core.config.update((config) => ({ ...config, defaults: { ...config.defaults, updateCheck: 'off' } })),
    (error: unknown) => error instanceof CommsError && error.code === 'LOOSENING_REFUSED',
  );
  // And without an approval the change flow applies neither: both need one.
  const fresh = machine();
  seed(fresh, { latest: LATEST, behind: true });
  const changes: GatedChange<unknown>[] = [updateLaterChange(fresh.core), updateAutoChange(fresh.core, 'off')];
  for (const change of changes) {
    const request = await change.plan(await fresh.core.config.load());
    const outcome = await gatedChange(fresh.core, change, { surface: 'mcp' });
    assert.equal(outcome.status, 'approval-required', request.summary);
  }
});

test('the command: --later and --auto off wait for an approval; --auto on applies at once', () => {
  const m = machine();
  seed(m, { latest: LATEST, behind: true });
  const run = (args: string[]) =>
    spawnSync(process.execPath, [...NODE_FLAGS, CLI, ...args], {
      encoding: 'utf8',
      env: { ...m.env, CLAUDECODE: '1' },
    });
  const later = run(['update', '--later', '--json']);
  assert.equal(later.status, 10, later.stdout + later.stderr);
  const pending = JSON.parse(later.stdout) as { error: { code: string; hint: string; details: { preview: string } } };
  assert.equal(pending.error.code, 'APPROVAL_PENDING');
  assert.match(pending.error.details.preview, /puts off the update to 99\.0\.0/);
  assert.match(pending.error.hint, /agentcomms update --later --approval ap_/);
  const off = run(['update', '--auto', 'off', '--json']);
  assert.equal(off.status, 10, off.stdout + off.stderr);
  const on = run(['update', '--auto', 'on', '--json']);
  assert.equal(on.status, 0, on.stdout + on.stderr);
  const bad = run(['update', '--auto', 'maybe', '--json']);
  assert.equal(bad.status, 64);
  const mixed = run(['update', '--later', '--check', '--json']);
  assert.equal(mixed.status, 64);
});

// ── Switched off ──────────────────────────────────────────────────────────────────────────────────────────────

test('CI, AGENT_COMMS_UPDATE_CHECK=off and the machine’s own setting each skip everything: no check, no stop', async () => {
  for (const [label, extra, setting] of [
    ['CI', { CI: 'true' }, undefined],
    ['the switch', { AGENT_COMMS_UPDATE_CHECK: 'off' }, undefined],
    ['the setting', {}, 'off'],
  ] as const) {
    const m = machine(extra);
    if (setting) {
      writeFileSync(
        join(m.env.AGENT_COMMS_CONFIG_DIR as string, 'config.json'),
        JSON.stringify({ version: 2, secrets: { store: 'file' }, defaults: { updateCheck: setting } }),
      );
    }
    const stale = new Date(Date.now() - 3 * 24 * 3_600_000);
    seed(m, { latest: LATEST, behind: true }, stale);
    const { asked, latestVersion } = registry();
    const outcome = await checkForUpdates(m.core, m.env, { deps: deps(latestVersion) });
    assert.equal(outcome.asked, false, label);
    assert.deepEqual(asked, [], `${label}: the registry was asked`);
    assert.equal(await pendingUpdate({ core: m.core, env: m.env, running: VERSION, ...SERVER }), null, label);
    const { call, close } = await connect(m, { update: deps(latestVersion) });
    try {
      assert.ok(!stopped(await call('comms_channels_available')), label);
    } finally {
      await close();
    }
    const cli = spawnSync(process.execPath, [...NODE_FLAGS, CLI, 'channels', '--json'], {
      encoding: 'utf8',
      env: m.env,
    });
    assert.equal(cli.status, 0, `${label}: ${cli.stdout}${cli.stderr}`);
    assert.equal((await readUpdateCheck(m.stateDir)).lastChecked, stale.toISOString(), `${label}: file rewritten`);
  }
  // `CI=false` and `CI=0` are not CI.
  const notCi = machine({ CI: 'false' });
  seed(notCi, { latest: LATEST, behind: true });
  assert.notEqual(await pendingUpdate({ core: notCi.core, env: notCi.env, running: VERSION, ...SERVER }), null);
});

// ── The terminal ──────────────────────────────────────────────────────────────────────────────────────────────

test('which commands are never stopped: update, doctor, paths, approve, approvals, help, and the server itself', () => {
  for (const path of [
    ['update'],
    ['doctor'],
    ['paths'],
    ['approve', 'ap_x'],
    ['approvals', 'list'],
    ['help'],
    ['mcp'],
    [],
  ]) {
    assert.equal(exemptFromUpdateGate(path), true, path.join(' '));
  }
  for (const path of [
    ['channels'],
    ['policy'],
    ['mcp', 'install'],
    ['mcp', 'prune'],
    ['audit', 'tail'],
    ['search'],
    // A channel's command that writes to this machine: Slack's `files download`, Gmail's `attachments download`.
    ['files', 'download'],
    ['attachments', 'download'],
  ]) {
    assert.equal(exemptFromUpdateGate(path), false, path.join(' '));
  }
  assert.equal(exemptFromUpdateGate(['status'], ['status']), true, 'a channel adds its own doctor');
});

test('the approvals a command claims: --approval, --mcp-approval, and an argument named approvalId', () => {
  // As Commander hands a `preAction` hook the command: its options, and its arguments as read.
  const command = {
    opts: () => ({ approval: 'ap_one', mcpApproval: 'ap_two', account: 'acme/resend' }),
    registeredArguments: [{ name: () => 'inbox' }, { name: () => 'approvalId' }],
    processedArgs: ['work', 'ap_three'],
  };
  assert.deepEqual(approvalsOf(command), ['ap_one', 'ap_two', 'ap_three']);
  assert.deepEqual(approvalsOf({ opts: () => ({}) }), [undefined, undefined]);
});

/** A terminal a person answers: each prompt on stderr gets the next answer, and every answer is used. */
function terminal(answers: string[]) {
  const stdin = Object.assign(new PassThrough(), { isTTY: true });
  const stdout = Object.assign(new PassThrough(), { isTTY: true });
  const stderr = new PassThrough();
  let out = '';
  let err = '';
  const queue = [...answers];
  stdout.on('data', (chunk) => {
    out += String(chunk);
  });
  stderr.on('data', (chunk) => {
    err += String(chunk);
    if (/\? $|: $/.test(String(chunk)) && queue.length > 0) {
      const answer = queue.shift() as string;
      setImmediate(() => stdin.write(`${answer}\n`));
    }
  });
  return {
    streams: { stdin, stdout, stderr } as unknown as Streams,
    out: () => out,
    err: () => err,
    left: () => queue.length,
  };
}

async function gateAt(
  m: Machine,
  answers: string[],
  extra: Partial<Parameters<typeof updateGateAtTerminal>[0]> = {},
  update: UpdateDeps = deps(registry().latestVersion),
) {
  const tty = terminal(answers);
  const output = extra.output ?? { json: false, color: false };
  const outcome = await updateGateAtTerminal({
    core: m.core,
    env: m.env,
    binary: 'agentcomms',
    channel: 'core',
    running: VERSION,
    output,
    streams: tty.streams,
    ...terminalUpdateHooks(m.core, m.env, { output, streams: tty.streams, deps: update }),
    ...extra,
  }).then(
    (value) => ({ value, error: null as CommsError | null }),
    (error: CommsError) => ({ value: null, error }),
  );
  return { ...outcome, tty };
}

test('at a terminal: "Update now, later today, or cancel?" — and each answer does what it says', async () => {
  // Cancel: nothing runs, nothing changes.
  const cancelled = machine();
  seed(cancelled, { latest: LATEST, behind: true });
  const cancel = await gateAt(cancelled, ['cancel']);
  assert.match(
    cancel.tty.err(),
    new RegExp(
      `^${LATEST.replaceAll('.', '\\.')} is out \\(you have ${VERSION.replaceAll('.', '\\.')}\\)\\. Update now, later today, or cancel\\? `,
    ),
  );
  assert.equal(cancel.error?.code, 'USAGE');
  assert.match(String(cancel.error?.message), /cancelled: agentcomms did not run/);
  assert.equal((await readUpdateCheck(cancelled.stateDir)).snoozedUntil, null);

  // Later: put off until midnight — the answer is the approval — and the command runs.
  const put = machine();
  seed(put, { latest: LATEST, behind: true });
  const later = await gateAt(put, ['later']);
  assert.equal(later.error, null, String(later.error));
  assert.equal(later.value, null, 'the command runs');
  assert.equal(later.tty.left(), 0);
  assert.doesNotMatch(later.tty.err(), /Type yes/, 'nothing more was asked under chat');
  assert.equal((await readUpdateCheck(put.stateDir)).snoozedUntil, nextLocalMidnight(new Date()).toISOString());

  // Now: the update, with its own preview and yes, then "run your command again" — and the command does not run.
  const now = machine();
  seed(now, { latest: LATEST, behind: true });
  const update = await gateAt(now, ['now', 'yes']);
  assert.equal(update.error, null, String(update.error));
  assert.equal(update.value, 0);
  assert.match(update.tty.out(), /CHANGE PREVIEW/);
  assert.match(update.tty.out(), /updates the global @agentcomms\/core from 0\.0\.1 to 99\.0\.0/);
  assert.match(update.tty.out(), /Updated\. Run your command again\.\n$/);
  assert.equal((await readUpdateCheck(now.stateDir)).behind, false, 'recorded as updated');
  assert.equal((await pendingUpdate({ core: now.core, env: now.env, running: VERSION, ...COMMAND }))?.kind, 'restart');

  // Without a network-capable update (WhatsApp): it says what to run, and ends.
  const reader = machine();
  seed(reader, { latest: LATEST, behind: true });
  const handoff = await gateAt(reader, ['now'], { check: undefined, update: undefined, binary: 'agent-whatsapp' });
  assert.equal(handoff.value, 11);
  assert.match(handoff.tty.out(), /Run `agentcomms update`/);
});

test('with nobody to ask, the command does not run and ends with UPDATE_REQUIRED, exit 11, naming both commands', () => {
  const m = machine();
  seed(m, { latest: LATEST, behind: true });
  const run = (args: string[], extra: Record<string, string> = {}) =>
    spawnSync(process.execPath, [...NODE_FLAGS, CLI, ...args], { encoding: 'utf8', env: { ...m.env, ...extra } });
  const json = run(['channels', '--json']);
  assert.equal(json.status, 11, json.stdout + json.stderr);
  const error = (JSON.parse(json.stdout) as { error: { code: string; message: string } }).error;
  assert.equal(error.code, 'UPDATE_REQUIRED');
  assert.ok(error.message.startsWith(UPDATE_FIRST));
  assert.match(error.message, /`agentcomms update`/);
  assert.match(error.message, /`agentcomms update --later`/);
  const plain = run(['audit', 'tail']);
  assert.equal(plain.status, 11);
  assert.match(plain.stderr, /agentcomms update --later/);
  assert.equal(plain.stdout, '', 'the command printed nothing');
  // The exempt ones run.
  for (const args of [['paths', '--json'], ['approvals', 'list', '--json'], ['--version']]) {
    const passed = run(args);
    assert.equal(passed.status, 0, `${args.join(' ')}: ${passed.stdout}${passed.stderr}`);
  }
  // Put off, it runs.
  writeFileSync(
    updateCheckPath(m.stateDir),
    JSON.stringify({
      ...JSON.parse(readFileSync(updateCheckPath(m.stateDir), 'utf8')),
      snoozedUntil: nextLocalMidnight(new Date()).toISOString(),
    }),
  );
  assert.equal(run(['channels', '--json']).status, 0);
});

test('at a terminal the check waits about three seconds at most, then the command goes on without it', async () => {
  const m = machine();
  const started = Date.now();
  // A check that never ends, and hears nothing: nothing but the gate's own wait can end the wait. (A second limit
  // here, so that a gate that waits for ever fails this test rather than hanging it.)
  const gate = updateGateAtTerminal({
    core: m.core,
    env: m.env,
    binary: 'agentcomms',
    channel: 'core',
    running: VERSION,
    output: { json: true, color: false },
    streams: terminal([]).streams,
    check: () => new Promise<void>(() => undefined),
    waitMs: 200,
  });
  let limit: NodeJS.Timeout | undefined;
  const outcome = await Promise.race([
    gate,
    new Promise<'waited on'>((resolve) => {
      limit = setTimeout(() => resolve('waited on'), 10_000);
    }),
  ]);
  clearTimeout(limit);
  assert.equal(outcome, null, 'nothing known, nothing stopped — and the command went on');
  assert.ok(Date.now() - started < 5_000, `waited ${Date.now() - started} ms`);
  // The real wait is about three seconds.
  const { TERMINAL_CHECK_WAIT_MS } = await import('../src/update-gate.ts');
  assert.equal(TERMINAL_CHECK_WAIT_MS, 3_000);
  assert.equal(existsSync(join(m.stateDir, UPDATE_CHECK_FILE)), false, 'a check that gave up wrote nothing here');
});

test('a registry slower than the terminal waits is still heard from: the check finishes beside the command', async () => {
  const m = machine();
  const served = await loopbackRegistry(LATEST, 1_500);
  const env = { ...m.env, npm_config_registry: served.url };
  try {
    const started = Date.now();
    const output = { json: true, color: false };
    const streams = terminal([]).streams;
    const outcome = await updateGateAtTerminal({
      core: m.core,
      env,
      binary: 'agentcomms',
      channel: 'core',
      running: VERSION,
      output,
      streams,
      ...terminalUpdateHooks(m.core, env, { output, streams, deps: { globalPackages: async () => ({}) } }),
      waitMs: 200,
    });
    assert.equal(outcome, null, 'the command goes on');
    assert.ok(Date.now() - started < 1_400, `the command waited ${Date.now() - started} ms for the registry`);
    // The ask was not cut off at the wait: its answer lands, and the day's check is a real one.
    await until(async () => (await readUpdateCheck(m.stateDir)).latest === LATEST, 'the answer to be recorded', 15_000);
    const record = await readUpdateCheck(m.stateDir);
    assert.equal(record.lastError, null);
    assert.equal(record.checking, null, 'the claim was given up');
    assert.deepEqual(served.requests, ['/@agentcomms%2fcore']);
  } finally {
    await served.close();
  }
});

test('an ask that never finished does not use up the day: its claim runs out and the next process asks', async () => {
  const m = machine();
  const start = new Date('2026-09-28T09:00:00.000Z');
  const at = (ms: number) => () => new Date(start.getTime() + ms);
  // The first process claims the check and is gone before the registry answers — interrupted, or closed by its client.
  const gone = registry(() => new Promise<string>(() => undefined));
  void checkForUpdates(m.core, m.env, { deps: deps(gone.latestVersion), now: at(0) });
  await until(() => gone.asked.length === 1, 'the first process to ask');
  const claimed = await readUpdateCheck(m.stateDir);
  assert.equal(claimed.checking, start.toISOString());
  assert.equal(claimed.lastChecked, null, 'the day was used up before the ask was over');
  // While the claim holds, nobody else asks.
  const next = registry();
  assert.equal(
    (await checkForUpdates(m.core, m.env, { deps: deps(next.latestVersion), now: at(60_000) })).asked,
    false,
  );
  assert.deepEqual(next.asked, []);
  // Once it has run out, the next process does, and the day's check is its.
  const after = await checkForUpdates(m.core, m.env, {
    deps: deps(next.latestVersion),
    now: at(UPDATE_CHECK_LEASE_MS),
  });
  assert.equal(after.asked, true);
  assert.equal(after.record.latest, LATEST);
  assert.equal(after.record.lastChecked, at(UPDATE_CHECK_LEASE_MS)().toISOString());
  assert.equal(after.record.checking, null);
});

test('at a terminal, an agent or --json is never asked, even with a terminal on both ends', async () => {
  for (const [label, env, output] of [
    ['an agent (CLAUDECODE)', { CLAUDECODE: '1' }, { json: false, color: false }],
    ['--json', {}, { json: true, color: false }],
  ] as const) {
    const m = machine(env);
    seed(m, { latest: LATEST, behind: true });
    const asked = await gateAt(m, ['later'], { output });
    assert.equal(asked.error?.code, 'UPDATE_REQUIRED', `${label}: ${String(asked.error)}`);
    assert.equal(asked.tty.err(), '', `${label}: it was asked`);
    assert.equal(asked.tty.left(), 1, `${label}: an answer was taken`);
    assert.equal((await readUpdateCheck(m.stateDir)).snoozedUntil, null, `${label}: put off with nobody asked`);
  }
});

test('at a terminal, an update installed and an older copy running stops as the servers do, and says to run the installed one', async () => {
  const m = machine();
  seed(m, { latest: LATEST, behind: false, current: { registered: [], global: ['core'] } });
  // Nobody to ask: stopped, and told so — not a note beside a command that runs.
  const script = await gateAt(m, [], { output: { json: true, color: false } });
  assert.equal(script.error?.code, 'UPDATE_REQUIRED');
  assert.match(
    String(script.error?.message),
    /^Hang on a minute, the update is installed, but this command isn't running it yet\./,
  );
  assert.match(String(script.error?.message), /99\.0\.0 is installed globally, and this agentcomms is /);
  assert.match(String(script.error?.message), /`agentcomms update --later`/);
  // A person: now says to run it again from the installed one, ends 11, and runs nothing and updates nothing.
  let updated = false;
  const person = await gateAt(m, ['now'], {
    update: async () => {
      updated = true;
      return 'updated';
    },
  });
  assert.match(person.tty.err(), /^99\.0\.0 is installed \(this is [^)]+\)\. Switch now, later today, or cancel\? /);
  assert.equal(person.value, 11);
  assert.match(person.tty.out(), /Run your command again from the installed one\. agentcomms did not run\./);
  assert.equal(updated, false, 'there was nothing to update');
  // Later: put off, and the command runs.
  const later = await gateAt(m, ['later']);
  assert.equal(later.value, null);
  assert.notEqual((await readUpdateCheck(m.stateDir)).snoozedUntil, null);
});

test('now, at a terminal: "Updated" only when this command is at the latest release after it; the command never runs', async () => {
  // The update has nothing to do — this copy is not what it updates (npx's cache, say): not "Updated", and exit 11.
  const short = machine();
  seed(short, { latest: LATEST, behind: null });
  const nothing = await gateAt(short, ['now', 'yes'], {}, deps(registry().latestVersion, {}));
  assert.equal(nothing.error, null, String(nothing.error));
  assert.equal(nothing.value, 11);
  assert.doesNotMatch(nothing.tty.out(), /Updated\./);
  assert.match(nothing.tty.out(), /agentcomms did not run: the update did not bring it to 99\.0\.0/);

  // The check could not tell (npm ls unreadable, say), and the global package was at the latest all along: the update
  // changes nothing, and says so — not "Updated" — and the command still did not run.
  const already = machine();
  seed(already, { latest: LATEST, behind: null });
  const installed = await gateAt(already, ['now', 'yes'], {}, deps(registry().latestVersion, { [CORE]: LATEST }));
  assert.equal(installed.value, 11, installed.tty.out());
  assert.match(installed.tty.out(), /Nothing was changed\./);
  assert.doesNotMatch(installed.tty.out(), /Updated\./);
  assert.match(
    installed.tty.out(),
    /99\.0\.0 is installed here: run your command again from it\. agentcomms did not run\./,
  );

  // A step fails: said, not "Updated", exit 69 — and the file keeps saying "update", not "restart".
  const failing = machine();
  seed(failing, { latest: LATEST, behind: true });
  const broken = {
    ...deps(registry().latestVersion),
    installGlobal: async () => {
      throw new Error('npm could not write to the global directory (EACCES)');
    },
  };
  const failed = await gateAt(failing, ['now', 'yes'], {}, broken);
  assert.equal(failed.value, 69, failed.tty.out());
  assert.doesNotMatch(failed.tty.out(), /Updated\./);
  assert.match(failed.tty.out(), /agentcomms did not run: the update did not finish/);
  const record = await readUpdateCheck(failing.stateDir);
  assert.equal(record.behind, true, 'a failed update was recorded as done');
  assert.deepEqual(record.current, { registered: [], global: [] });
  assert.equal(
    (await pendingUpdate({ core: failing.core, env: failing.env, running: VERSION, ...COMMAND }))?.kind,
    'update',
  );
  assert.equal(
    (await pendingUpdate({ core: failing.core, env: failing.env, running: VERSION, ...SERVER }))?.kind,
    'update',
  );
});

test('at a terminal, a command claiming an approval this machine holds runs, as the same call over MCP does', async () => {
  const m = machine();
  const prepared = await gatedChange(m.core, updateLaterChange(m.core), { surface: 'mcp' });
  assert.equal(prepared.status, 'approval-required');
  const approvalId = (prepared as { prepared: { approvalId: string } }).prepared.approvalId;
  assert.match(approvalId, /^ap_/);
  seed(m, { latest: LATEST, behind: true });
  const claimed = await gateAt(m, [], { output: { json: true, color: false }, approvals: [undefined, approvalId] });
  assert.equal(claimed.error, null, String(claimed.error));
  assert.equal(claimed.value, null, 'the command runs');
  for (const approvals of [[''], ['ap_'], [`ap_${'0'.repeat(26)}`], [undefined, undefined]]) {
    const refused = await gateAt(m, [], { output: { json: true, color: false }, approvals });
    assert.equal(refused.error?.code, 'UPDATE_REQUIRED', JSON.stringify(approvals));
  }
  // And through the command itself: `--approval` with a held id goes past the stop — to the command's own answer —
  // and one nobody prepared does not.
  const run = (args: string[]) =>
    spawnSync(process.execPath, [...NODE_FLAGS, CLI, ...args], { encoding: 'utf8', env: m.env });
  const held = run(['policy', 'chat', '--approval', approvalId, '--json']);
  assert.notEqual(held.status, 11, held.stdout + held.stderr);
  assert.doesNotMatch(held.stdout, /UPDATE_REQUIRED/);
  const unknown = run(['policy', 'chat', '--approval', `ap_${'0'.repeat(26)}`, '--json']);
  assert.equal(unknown.status, 11, unknown.stdout + unknown.stderr);
});

// ── The doctor ────────────────────────────────────────────────────────────────────────────────────────────────

test('the doctor gives the check one line: on or off, when last checked, the latest, and what is running', async () => {
  const m = machine();
  const checked = new Date('2026-09-28T09:00:00.000Z');
  seed(m, { latest: LATEST, behind: true }, checked);
  const { call, close } = await connect(m);
  try {
    const report = (await call('comms_doctor')).structuredContent as {
      ok: boolean;
      checks: { name: string; detail: string; warn?: boolean; fix?: string }[];
    };
    const line = report.checks.filter((check) => check.name === 'update check');
    assert.equal(line.length, 1);
    assert.equal(line[0]?.detail, `on · last checked ${checked.toISOString()} · latest ${LATEST} · running ${VERSION}`);
    assert.equal(line[0]?.warn, true);
    assert.match(String(line[0]?.fix), /agentcomms update --later/);
    // "Installed: restart" only when both the core's server and its command would start the latest: the doctor
    // speaks for both.
    const fixFor = async (current: UpdateCheckRecord['current']) => {
      seed(m, { latest: LATEST, behind: false, current }, checked);
      const again = (await call('comms_doctor')).structuredContent as { checks: { name: string; fix?: string }[] };
      return String(again.checks.find((check) => check.name === 'update check')?.fix);
    };
    assert.match(await fixFor({ registered: ['core'], global: [] }), /^Run `agentcomms update`/);
    assert.match(await fixFor({ registered: [], global: ['core'] }), /^Run `agentcomms update`/);
    assert.match(await fixFor({ registered: ['core'], global: ['core'] }), /is installed on this machine: restart/);
  } finally {
    await close();
  }
  const off = machine({ AGENT_COMMS_UPDATE_CHECK: 'off' });
  const { call: offCall, close: offClose } = await connect(off);
  try {
    const report = (await offCall('comms_doctor')).structuredContent as { checks: { name: string; detail: string }[] };
    assert.equal(
      report.checks.find((check) => check.name === 'update check')?.detail,
      `off (AGENT_COMMS_UPDATE_CHECK is set) · last checked never · latest unknown · running ${VERSION}`,
    );
  } finally {
    await offClose();
  }
});
