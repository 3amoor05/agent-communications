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
import type { Streams } from '../src/cli-runtime.ts';
import { type Core, openCore } from '../src/core.ts';
import { CommsError } from '../src/errors.ts';
import { type CoreMcpOptions, createCoreMcpServer } from '../src/mcp/server.ts';
import type { UpdateDeps } from '../src/operations/update.ts';
import { updateAutoChange, updateLaterChange } from '../src/operations/update-settings.ts';
import { checkForUpdates, terminalUpdateHooks } from '../src/update-check.ts';
import { exemptFromUpdateGate, updateGateAtTerminal, updateToolGate } from '../src/update-gate.ts';
import {
  nextLocalMidnight,
  pendingUpdate,
  readUpdateCheck,
  UPDATE_CHECK_FILE,
  UPDATE_FIRST,
  type UpdateCheckRecord,
  updateCheckPath,
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
  assert.equal(await pendingUpdate({ core: m.core, env: m.env, running: VERSION }), null, 'nothing is stopped');
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
  assert.equal(await pendingUpdate({ core: m.core, env: m.env, running: VERSION }), null);
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
  assert.equal(await pendingUpdate({ core: fresh.core, env: fresh.env, running: VERSION }), null);
  // And the release after it is: 99.0.0 is newer than anything this checkout is.
  seed(fresh, { latest: LATEST, behind: true });
  assert.notEqual(await pendingUpdate({ core: fresh.core, env: fresh.env, running: VERSION }), null);
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

test('a call that claims an approval the person already gave goes ahead; the next new one is stopped', async () => {
  const m = machine();
  const { call, close } = await connect(m);
  try {
    // Prepared before the check landed.
    const asked = await call('comms_change_policy', { set: 'confirm' });
    assert.equal(asked.isError, undefined);
    const prepared = await call('comms_update', { later: true });
    const approvalId = (prepared.structuredContent as { approvalId: string }).approvalId;
    assert.match(approvalId, /^ap_/);
    // The check lands.
    seed(m, { latest: LATEST, behind: true });
    const revoke = await call('comms_approval_revoke', { approvalId });
    assert.ok(!stopped(revoke), JSON.stringify(revoke.structuredContent));
    assert.equal(revoke.isError, undefined);
    // A made-up id still goes past the stop — to be refused by the tool itself, as it always was.
    const claimed = await call('comms_change_policy', { set: 'chat', approvalId: `ap_${'0'.repeat(26)}` });
    assert.ok(!stopped(claimed));
    assert.equal(codeOf(claimed), 'NOT_FOUND');
    // Without one: stopped.
    assert.ok(stopped(await call('comms_change_policy', { set: 'chat' })));
  } finally {
    await close();
  }
});

test('an update installed but not yet loaded says to restart the client, not to update', async () => {
  const m = machine();
  seed(m, { latest: LATEST, behind: false });
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

  // And an update applied here is what makes it so: the old server stops saying "update" at once.
  const updated = machine();
  seed(updated, { latest: LATEST, behind: true });
  const { latestVersion } = registry();
  const server = await connect(updated, { update: deps(latestVersion) });
  try {
    assert.match(textOf(await server.call('comms_audit_tail')), /Let's update first/);
    const first = (await server.call('comms_update', {})).structuredContent as { approvalId: string };
    const applied = await server.call('comms_update', { approvalId: first.approvalId });
    assert.equal(applied.isError, undefined, JSON.stringify(applied.structuredContent));
    assert.equal((await readUpdateCheck(updated.stateDir)).behind, false);
    assert.match(textOf(await server.call('comms_audit_tail')), /Restart the client first/);
  } finally {
    await server.close();
  }
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

  const at = (when: Date) => pendingUpdate({ core: m.core, env: m.env, running: VERSION, now: () => when });
  assert.equal(await at(evening), null);
  assert.equal(await at(new Date(midnight.getTime() - 1)), null, 'a millisecond before midnight: still put off');
  assert.notEqual(await at(midnight), null, 'at midnight it asks again');

  // Machine-wide: a second server — another process, another core, the same state directory — reads it too.
  const other = { ...m, core: openCore({ env: m.env }) };
  const gate = updateToolGate({
    core: other.core,
    env: m.env,
    server: 'agent-gmail',
    running: VERSION,
    exempt: [],
    now: () => evening,
  });
  assert.equal(await gate('gmail_search', {}), null);
  const later = updateToolGate({
    core: other.core,
    env: m.env,
    server: 'agent-gmail',
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
    assert.equal(await pendingUpdate({ core: m.core, env: m.env, running: VERSION }), null, label);
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
  assert.notEqual(await pendingUpdate({ core: notCi.core, env: notCi.env, running: VERSION }), null);
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
  for (const path of [['channels'], ['policy'], ['mcp', 'install'], ['mcp', 'prune'], ['audit', 'tail'], ['search']]) {
    assert.equal(exemptFromUpdateGate(path), false, path.join(' '));
  }
  assert.equal(exemptFromUpdateGate(['status'], ['status']), true, 'a channel adds its own doctor');
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

async function gateAt(m: Machine, answers: string[], extra: Partial<Parameters<typeof updateGateAtTerminal>[0]> = {}) {
  const tty = terminal(answers);
  const { latestVersion } = registry();
  const output = { json: false, color: false };
  const outcome = await updateGateAtTerminal({
    core: m.core,
    env: m.env,
    binary: 'agentcomms',
    running: VERSION,
    output,
    streams: tty.streams,
    ...terminalUpdateHooks(m.core, m.env, { output, streams: tty.streams, deps: deps(latestVersion) }),
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
  const outcome = await updateGateAtTerminal({
    core: m.core,
    env: m.env,
    binary: 'agentcomms',
    running: VERSION,
    output: { json: true, color: false },
    streams: terminal([]).streams,
    check: (signal) => new Promise((resolve) => signal.addEventListener('abort', () => resolve())),
    waitMs: 200,
  });
  assert.equal(outcome, null, 'nothing known, nothing stopped');
  assert.ok(Date.now() - started < 2_000);
  // The real wait is about three seconds.
  const { TERMINAL_CHECK_WAIT_MS } = await import('../src/update-gate.ts');
  assert.equal(TERMINAL_CHECK_WAIT_MS, 3_000);
  assert.equal(existsSync(join(m.stateDir, UPDATE_CHECK_FILE)), false, 'a check that gave up wrote nothing here');
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
