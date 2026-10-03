import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/client';
import { InMemoryTransport } from '@modelcontextprotocol/server';
import { type Core, openCore } from '../src/core.ts';
import { createCoreMcpServer } from '../src/mcp/server.ts';
import { tempDir } from './helpers/temp.ts';

/*
 * `agentcomms org …` and the `comms_org…` tools: the same operations from both surfaces (design 2026-10-02 §D9), the
 * same refusals, and — wherever either shows anything — never the client secret and never the profile's bytes.
 */

const CLI = fileURLToPath(new URL('../src/cli.ts', import.meta.url));
const NODE_FLAGS = ['--experimental-strip-types', '--disable-warning=ExperimentalWarning'];
const CLIENT_A = '111111111111-aaaaaaaaaaaa.apps.googleusercontent.com';
const SECRET = 'fake-surface-secret-not-real';

interface Machine {
  home: string;
  configDir: string;
  env: Record<string, string>;
  core: Core;
  profile: string;
}

function machine(): Machine {
  const home = tempDir('comms-org-surface-');
  const configDir = join(home, 'config');
  mkdirSync(configDir);
  writeFileSync(join(configDir, 'config.json'), `${JSON.stringify({ version: 2, secrets: { store: 'file' } })}\n`);
  const profile = join(home, 'acme.agentcomms.json');
  writeFileSync(
    profile,
    JSON.stringify({
      agentcomms: 'organisation-profile',
      version: 1,
      organisation: 'acme',
      label: 'Acme Test Org',
      gmail: { clientId: CLIENT_A, clientSecret: SECRET, serves: { domains: ['acme.test'] } },
      slack: {
        workspace: 'TACME0001',
        workspaceName: 'Acme',
        redirectPort: 51234,
        apps: { read: { clientId: '1.2' } },
      },
    }),
  );
  const env = {
    HOME: home,
    USERPROFILE: home,
    APPDATA: join(home, 'AppData'),
    PATH: join(home, 'bin'),
    AGENT_COMMS_CONFIG_DIR: configDir,
    NO_COLOR: '1',
    AGENT_COMMS_CLIENT_CLI_DIRS: '',
    AGENT_COMMS_UPDATE_CHECK: 'off',
  };
  return { home, configDir, env, core: openCore({ env }), profile };
}

function cli(m: Machine, args: string[], cwd?: string) {
  const result = spawnSync(process.execPath, [...NODE_FLAGS, CLI, ...args], { encoding: 'utf8', env: m.env, cwd });
  assert.ok(!`${result.stdout}${result.stderr}`.includes(SECRET), `the secret was printed by ${args.join(' ')}`);
  const json = () => JSON.parse(result.stdout.trim().split('\n')[0] ?? '');
  return { ...result, json };
}

interface ToolResult {
  isError?: boolean;
  structuredContent?: Record<string, unknown>;
  content?: { text?: string }[];
}

async function connect(m: Machine) {
  const { server } = await createCoreMcpServer({ core: m.core, env: m.env, keyring: null });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 'test', version: '0' });
  await Promise.all([client.connect(clientTransport), server.connect(serverTransport)]);
  const call = async (name: string, args: Record<string, unknown> = {}) => {
    const result = (await client.callTool({ name, arguments: args })) as ToolResult;
    assert.ok(!JSON.stringify(result).includes(SECRET), `the secret was returned by ${name}`);
    return result;
  };
  const ok = async (name: string, args: Record<string, unknown> = {}) => {
    const result = await call(name, args);
    assert.notEqual(result.isError, true, `${name}: ${JSON.stringify(result.structuredContent)}`);
    return result.structuredContent as Record<string, unknown>;
  };
  return { client, call, ok, close: () => Promise.all([client.close(), server.close()]) };
}

function everyFile(dir: string): { path: string; text: string }[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? everyFile(path) : [{ path, text: readFileSync(path, 'utf8') }];
  });
}

test('every org tool is offered with the annotations of what it does, and changes take an approval', async () => {
  const m = machine();
  const { client, close } = await connect(m);
  try {
    const tools = new Map((await client.listTools()).tools.map((tool) => [tool.name, tool]));
    for (const name of ['comms_orgs_list', 'comms_org_show']) {
      assert.equal(tools.get(name)?.annotations?.readOnlyHint, true, name);
      assert.ok(!('approvalId' in (tools.get(name)?.inputSchema.properties ?? {})), `${name} takes no approval`);
    }
    for (const name of ['comms_org_add', 'comms_org_update', 'comms_org_remove']) {
      const tool = tools.get(name);
      assert.equal(tool?.annotations?.readOnlyHint, false, name);
      assert.equal(tool?.annotations?.openWorldHint, false, `${name} makes no outbound request`);
      assert.ok('approvalId' in (tool?.inputSchema.properties ?? {}), `${name} takes its approval`);
    }
    assert.equal(tools.get('comms_org_remove')?.annotations?.destructiveHint, true);
    assert.equal(tools.get('comms_org_add')?.annotations?.destructiveHint, false);
  } finally {
    await close();
  }
});

test('from a chat: add is previewed then claimed, list and show read it, update and remove go the same way', async () => {
  const m = machine();
  const { ok, call, close } = await connect(m);
  try {
    const first = await ok('comms_org_add', { file: m.profile });
    assert.equal(first.approvalRequired, true);
    assert.match(String(first.preview), /client secret: included/);
    assert.match(String(first.preview), /addresses at acme\.test/);
    const done = await ok('comms_org_add', { file: m.profile, approvalId: first.approvalId });
    assert.equal(done.applied, true);
    assert.equal((done.result as { gmail: { client: string } }).gmail.client, 'acme-1');

    const listed = await ok('comms_orgs_list');
    assert.equal((listed.organisations as { organisation: string }[])[0]?.organisation, 'acme');
    const shown = await ok('comms_org_show', { organisation: 'acme' });
    assert.equal((shown.gmail as { active: string }).active, 'acme-1');

    // Drift-free and unchanged: nothing to approve, and an approval offered is refused rather than dropped.
    const same = await ok('comms_org_update', { organisation: 'acme' });
    assert.equal(same.applied, true);
    const on = await ok('comms_org_update', { organisation: 'acme', forOtherAddresses: 'on' });
    assert.equal(on.approvalRequired, true);
    assert.match(String(on.preview), /for other addresses: off → on/);
    await ok('comms_org_update', { organisation: 'acme', forOtherAddresses: 'on', approvalId: on.approvalId });
    const refused = await call('comms_org_update', { organisation: 'acme', forOtherAddresses: 'maybe' });
    assert.equal(refused.isError, true);

    const removing = await ok('comms_org_remove', { organisation: 'acme' });
    assert.equal(removing.approvalRequired, true);
    assert.match(String(removing.preview), /removes the OAuth client "acme-1"/);
    const removed = await ok('comms_org_remove', { organisation: 'acme', approvalId: removing.approvalId });
    assert.deepEqual((removed.result as { removed: string[] }).removed, ['acme-1']);
    const after = await m.core.config.load();
    assert.equal(after.version, 2);
    assert.equal(after.version === 2 ? after.organisations : null, undefined, 'the record is gone');
  } finally {
    await close();
  }
});

test('at a terminal: the same change, the same view, and --for-other-addresses read the way each command takes it', async () => {
  const m = machine();
  // An agent's run stops with the preview and the approval id, and the rerun names the file absolutely.
  const asked = cli(m, ['org', 'add', 'acme.agentcomms.json', '--for-other-addresses', '--json'], m.home);
  assert.equal(asked.status, 10, asked.stderr);
  const pending = asked.json().error;
  assert.match(pending.details.preview, /for other addresses: on/);
  // Absolute — the run again from another directory reads the same file — whatever the temp directory resolves to.
  assert.match(pending.hint, /org add (?:\/|[A-Za-z]:\\)\S*acme\.agentcomms\.json --for-other-addresses --approval/);
  // Claimed from the same place: the path a preview names is part of what was approved.
  const done = cli(
    m,
    ['org', 'add', 'acme.agentcomms.json', '--for-other-addresses', '--approval', pending.details.approvalId, '--json'],
    m.home,
  );
  assert.equal(done.status, 0, done.stdout + done.stderr);
  assert.equal(done.json().data.profile.forOtherAddresses, true);

  // The same view from both surfaces.
  const { ok, close } = await connect(m);
  try {
    const byTool = await ok('comms_org_show', { organisation: 'acme' });
    const byCommand = cli(m, ['org', 'show', 'acme', '--json']);
    assert.deepEqual(byCommand.json().data, byTool);
  } finally {
    await close();
  }

  // `org update` takes the word after the flag; without one it is refused.
  const off = cli(m, ['org', 'update', 'acme', '--for-other-addresses', 'off', '--json']);
  assert.equal(off.status, 0, off.stdout + off.stderr);
  assert.equal(off.json().data.profile.forOtherAddresses, false);
  assert.equal(cli(m, ['org', 'update', 'acme', '--for-other-addresses', '--json']).status, 64);
  const on = cli(m, ['org', 'update', 'acme', '--for-other-addresses', 'on', '--json']);
  assert.equal(on.status, 10);

  // Options a command does not take, and an approval on one that reads, are refused before anything runs.
  assert.equal(cli(m, ['org', 'list', '--store', 'file', '--json']).status, 64);
  // And `org`'s options are refused by every other command, rather than taken and ignored.
  assert.equal(cli(m, ['secrets', 'migrate', '--to', 'file', '--store', 'keychain', '--json']).status, 64);
  assert.equal(cli(m, ['channels', '--adopt', 'desktop', '--json']).status, 64);
  assert.equal(cli(m, ['org', 'show', 'acme', '--approval', 'ap_00000000000000000000000000', '--json']).status, 64);
  assert.equal(cli(m, ['org', 'remove', 'acme', '--source', m.profile, '--json']).status, 64);
  assert.equal(cli(m, ['org', 'add', 'https://example.test/rgc.json', '--json']).status, 64);
  const plain = cli(m, ['org', 'list']);
  assert.match(plain.stdout, /acme — Acme Test Org/);
});

test('nothing on the machine holds the secret but the secret store: config, approvals, audit, state', async () => {
  const m = machine();
  const asked = cli(m, ['org', 'add', m.profile, '--json']);
  cli(m, ['org', 'add', m.profile, '--approval', asked.json().error.details.approvalId, '--json']);
  cli(m, ['org', 'show', 'acme']);
  cli(m, ['doctor']);
  for (const { path, text } of everyFile(m.home)) {
    if (path === m.profile || path.startsWith(m.core.paths.secretsDir)) continue;
    assert.ok(!text.includes(SECRET), `the client secret is in ${path}`);
  }
  assert.ok(
    everyFile(m.core.paths.secretsDir).some(({ text }) => text.includes(SECRET)),
    'and it is in the store',
  );
});
