import assert from 'node:assert/strict';
import childProcess from 'node:child_process';
import dns from 'node:dns';
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
import net from 'node:net';
import { join } from 'node:path';
import { test } from 'node:test';
import tls from 'node:tls';
import { fileURLToPath } from 'node:url';
import { openCore, UPDATE_FIRST, updateCheckPath, updateLaterChange } from '@agentcomms/core';
import { coreInline } from './support/handoffs.ts';
import { newHarness, tempDir } from './support/harness.ts';
import { ACCOUNT, connect } from './support/surfaces.ts';

/*
 * The daily update check on WhatsApp (design 2026-09-28): this package has no network code, so it never asks the
 * registry — it imports the reader alone, and stops for an update once any other server or command on the machine
 * has found one. Shown with the network cut off at the socket, DNS, TLS, `fetch` and process creation, as
 * `no-network.test.ts` cuts it; and in the bundle as it ships, which carries the reader and not the checker.
 */

const PACKAGE = fileURLToPath(new URL('..', import.meta.url));

function files(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory() ? files(join(directory, entry.name)) : [join(directory, entry.name)],
  );
}

test('with the network cut off, an update in the file stops every tool but whatsapp_status and every command but status', async () => {
  const harness = await newHarness({ env: { AGENT_COMMS_UPDATE_CHECK: 'on' } });
  await harness.ready();
  const core = openCore({ env: harness.env });
  // A day stale on purpose: anything that could ask the registry would ask now. WhatsApp must not.
  const checked = new Date(Date.now() - 3 * 24 * 3_600_000).toISOString();
  mkdirSync(core.paths.stateDir, { recursive: true });
  writeFileSync(
    updateCheckPath(core.paths.stateDir),
    JSON.stringify({ lastChecked: checked, latest: '99.0.0', behind: true }),
  );

  const attempts: string[] = [];
  const refuse = (what: string) =>
    function refused(): never {
      attempts.push(what);
      throw new Error(`network attempted: ${what}`);
    };
  const saved = {
    connect: net.Socket.prototype.connect,
    tlsConnect: tls.connect,
    lookup: dns.lookup,
    fetch: globalThis.fetch,
    spawn: childProcess.spawn,
    execFile: childProcess.execFile,
  };
  net.Socket.prototype.connect = refuse('net.Socket.connect') as typeof net.Socket.prototype.connect;
  tls.connect = refuse('tls.connect') as typeof tls.connect;
  dns.lookup = refuse('dns.lookup') as unknown as typeof dns.lookup;
  globalThis.fetch = refuse('fetch') as typeof fetch;
  childProcess.spawn = refuse('child_process.spawn') as typeof childProcess.spawn;
  childProcess.execFile = refuse('child_process.execFile') as unknown as typeof childProcess.execFile;
  syncBuiltinESMExports();
  try {
    const { call, close } = await connect(harness);
    try {
      const chats = await call('whatsapp_chats', { account: ACCOUNT });
      assert.equal(chats.structuredContent.error?.code, 'UPDATE_REQUIRED');
      const text = (chats as { content?: { type: string; text?: string }[] }).content?.[0]?.text ?? '';
      assert.ok(text.startsWith(UPDATE_FIRST), text);
      assert.match(text, /This is agent-whatsapp /);
      const status = await call('whatsapp_status', {});
      assert.notEqual(status.isError, true, JSON.stringify(status.structuredContent));
      // Every registration of WhatsApp's server here names the latest — the file says so, and no network is needed
      // to read it: restart the client, not update.
      const record = { lastChecked: checked, latest: '99.0.0', behind: true };
      const installed = { ...record, current: { registered: ['whatsapp'], global: [] } };
      writeFileSync(updateCheckPath(core.paths.stateDir), JSON.stringify(installed));
      const restart = await call('whatsapp_chats', { account: ACCOUNT });
      const restartText = (restart as { content?: { type: string; text?: string }[] }).content?.[0]?.text ?? '';
      assert.match(restartText, /Restart the client first/);
      writeFileSync(updateCheckPath(core.paths.stateDir), JSON.stringify(record));
    } finally {
      await close();
    }
    const refused = await harness.cli(['chats', '--account', ACCOUNT, '--json']);
    assert.equal(refused.code, 11, refused.stdout + refused.stderr);
    const error = refused.json().error as { code: string; message: string };
    assert.equal(error.code, 'UPDATE_REQUIRED');
    // Core's commands, as this package finds core through its own dependency on it: never a bare `agentcomms`.
    assert.ok(error.message.includes(coreInline(harness.env, ['update'])), error.message);
    assert.ok(error.message.includes(coreInline(harness.env, ['update', '--later'])), error.message);
    assert.equal((await harness.cli(['status', '--json'])).code, 0);
    // WhatsApp's package installed globally at the latest, and this copy older: stopped, and told to run the
    // installed one.
    const stale = { lastChecked: checked, latest: '99.0.0', behind: true };
    writeFileSync(
      updateCheckPath(core.paths.stateDir),
      JSON.stringify({ ...stale, current: { registered: [], global: ['whatsapp'] } }),
    );
    const older = await harness.cli(['chats', '--account', ACCOUNT, '--json']);
    assert.equal(older.code, 11, older.stdout);
    assert.match((older.json().error as { message: string }).message, /isn't running it yet/);
    writeFileSync(updateCheckPath(core.paths.stateDir), JSON.stringify(stale));

    // "Not now", said anywhere on the machine — here through core's own change — holds for WhatsApp too.
    const later = updateLaterChange(core);
    await later.apply(undefined, await later.plan(await core.config.load()));
    assert.equal((await harness.cli(['chats', '--account', ACCOUNT, '--json'])).code, 0);
  } finally {
    net.Socket.prototype.connect = saved.connect;
    tls.connect = saved.tlsConnect;
    dns.lookup = saved.lookup;
    globalThis.fetch = saved.fetch;
    childProcess.spawn = saved.spawn;
    childProcess.execFile = saved.execFile;
    syncBuiltinESMExports();
  }
  assert.deepEqual(attempts, [], 'nothing reached for the network');
  const record = JSON.parse(readFileSync(updateCheckPath(core.paths.stateDir), 'utf8')) as { lastChecked: string };
  assert.equal(record.lastChecked, checked, 'WhatsApp did not check, stale as the file was');
});

test('a flag-pinned WhatsApp run reads update state from the pinned directory and starts no child', async () => {
  const harness = await newHarness({ env: { AGENT_COMMS_UPDATE_CHECK: 'on' } });
  const ambient = tempDir('agent-whatsapp-update-ambient-');
  const pinned = openCore({ env: harness.env });
  mkdirSync(pinned.paths.stateDir, { recursive: true });
  writeFileSync(
    updateCheckPath(pinned.paths.stateDir),
    JSON.stringify({ lastChecked: new Date().toISOString(), latest: '99.0.0', behind: true }),
  );
  const spawn = childProcess.spawn;
  const attempts: string[] = [];
  childProcess.spawn = ((..._args: unknown[]) => {
    attempts.push('child_process.spawn');
    throw new Error('WhatsApp must not start an update child');
  }) as typeof childProcess.spawn;
  syncBuiltinESMExports();
  try {
    const { configDir, stateDir, dataDir, secretsDir, downloadsDir } = pinned.paths;
    const result = await harness.cli(
      [
        '--config-dir',
        configDir,
        '--state-dir',
        stateDir,
        '--data-dir',
        dataDir,
        '--secrets-dir',
        secretsDir,
        '--downloads-dir',
        downloadsDir,
        'chats',
        '--account',
        ACCOUNT,
        '--json',
      ],
      {
        env: {
          ...harness.env,
          AGENT_COMMS_CONFIG_DIR: join(ambient, 'config'),
          AGENT_COMMS_STATE_DIR: join(ambient, 'state'),
          AGENT_COMMS_DATA_DIR: join(ambient, 'data'),
          HOME: join(ambient, 'home'),
          USERPROFILE: join(ambient, 'home'),
        },
      },
    );
    assert.equal(result.code, 11, result.stdout + result.stderr);
    assert.equal((result.json().error as { code?: string }).code, 'UPDATE_REQUIRED');
  } finally {
    childProcess.spawn = spawn;
    syncBuiltinESMExports();
  }
  assert.deepEqual(attempts, []);
});

test('the bundle as it ships carries the update gate’s reader, and none of the checker', async () => {
  const { build } = await import('tsdown');
  const outDir = tempDir('agent-whatsapp-gate-bundle-');
  await build({
    config: false,
    cwd: PACKAGE,
    entry: { index: 'src/index.ts', cli: 'src/cli.ts' },
    format: 'esm',
    platform: 'node',
    target: 'node22',
    outDir,
    dts: false,
    noExternal: [/.*/],
    external: ['@napi-rs/keyring'],
    logLevel: 'silent',
  });
  const shipped = files(outDir)
    .filter((file) => file.endsWith('.mjs'))
    .map((file) => readFileSync(file, 'utf8'))
    .join('\n');
  assert.match(shipped, /update-check\.json/, 'the reader is there');
  assert.match(shipped, /Hang on a minute, there's an update\. Let's update first\./);
  for (const checker of [
    'checkForUpdates',
    'npmLatestVersion',
    'terminalUpdateHooks',
    'npmGlobalPackages',
    'claimUpdateCheck',
    'askUnderClaim',
    'runUpdateCheckChild',
    'updateCheckChildEntry',
    'updateCheckChildEnvironment',
    'UPDATE_CHECK_CHILD_COMMAND',
    'update-check-child',
  ]) {
    assert.ok(!shipped.includes(checker), `the bundle carries ${checker}`);
  }
});
