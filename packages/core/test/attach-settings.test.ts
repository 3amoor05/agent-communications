import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, realpathSync, symlinkSync, writeFileSync } from 'node:fs';
import { join, parse } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/client';
import { InMemoryTransport } from '@modelcontextprotocol/server';
import { type Core, openCore } from '../src/core.ts';
import { defaultAttachDeny } from '../src/jail.ts';
import { createCoreMcpServer } from '../src/mcp/server.ts';
import { checkedPath } from '../src/operations/attach-settings.ts';
import { tempDir } from './helpers/temp.ts';

/*
 * The folders attachments may come from, and the paths they never may (issue #45): `agentcomms attach` and
 * `comms_attach`, one operation. Nothing named a way to allow another folder — the jail's hint said to copy the file
 * under the home folder, because there was no command. Now there is, and it is a change like any other: widening what
 * can be attached (a root added, a deny entry removed) is shown and approved first; narrowing it applies at once.
 *
 * Every test runs against a temporary home and config directory; nothing reads the real ones.
 */

const CLI = fileURLToPath(new URL('../src/cli.ts', import.meta.url));
const NODE_FLAGS = ['--experimental-strip-types', '--disable-warning=ExperimentalWarning'];

interface Machine {
  home: string;
  configDir: string;
  env: Record<string, string>;
  core: Core;
}

function machine(defaults?: Record<string, unknown>): Machine {
  const home = tempDir('comms-attach-');
  const configDir = join(home, 'config');
  mkdirSync(configDir);
  if (defaults) {
    writeFileSync(join(configDir, 'config.json'), `${JSON.stringify({ version: 2, defaults }, null, 2)}\n`);
  }
  const env = {
    HOME: home,
    USERPROFILE: home,
    APPDATA: join(home, 'AppData', 'Roaming'),
    PATH: join(home, 'bin'),
    AGENT_COMMS_CONFIG_DIR: configDir,
    NO_COLOR: '1',
    AGENT_COMMS_CLIENT_CLI_DIRS: '',
    AGENT_COMMS_UPDATE_CHECK: 'off',
  };
  return { home, configDir, env, core: openCore({ env }) };
}

function cli(m: Machine, args: string[], extra: Record<string, string> = {}) {
  const result = spawnSync(process.execPath, [...NODE_FLAGS, CLI, ...args], {
    encoding: 'utf8',
    env: { ...m.env, ...extra },
  });
  const json = () => JSON.parse(result.stdout.trim().split('\n')[0] ?? '');
  return { ...result, json };
}

interface ToolResult {
  isError?: boolean;
  structuredContent?: Record<string, unknown>;
}

async function connect(m: Machine) {
  const { server } = await createCoreMcpServer({ core: m.core, env: m.env, keyring: null });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 'test', version: '0' });
  await Promise.all([client.connect(clientTransport), server.connect(serverTransport)]);
  const call = async (args: Record<string, unknown> = {}) =>
    (await client.callTool({ name: 'comms_attach', arguments: args })) as ToolResult;
  const ok = async (args: Record<string, unknown> = {}) => {
    const result = await call(args);
    assert.notEqual(result.isError, true, JSON.stringify(result.structuredContent));
    return result.structuredContent as Record<string, unknown>;
  };
  const error = async (args: Record<string, unknown>) => {
    const result = await call(args);
    assert.equal(result.isError, true, JSON.stringify(result.structuredContent));
    return (result.structuredContent as { error: { code: string; message: string; hint: string | null } }).error;
  };
  return { ok, call, error, close: () => Promise.all([client.close(), server.close()]) };
}

const defaultsOf = async (m: Machine) => (await m.core.config.load()).defaults;

test('on Windows a folder is named with its drive or share: a path with no drive would be whichever drive is current', () => {
  for (const ok of ['C:\\outgoing', 'd:/outgoing', '\\\\server\\share\\outgoing', '~\\outgoing', '~/outgoing', '~']) {
    assert.equal(checkedPath(ok, 'win32'), ok, ok);
  }
  for (const bad of ['\\outgoing', '/outgoing', 'outgoing', 'C:outgoing', '\\\\?\\C:\\x', '\\\\.\\pipe\\x']) {
    assert.throws(() => checkedPath(bad, 'win32'), /does not name its drive|relative path/, bad);
  }
  // Elsewhere a path from the root is absolute, as it always was.
  assert.equal(checkedPath('/srv/outgoing', 'linux'), '/srv/outgoing');
  assert.throws(() => checkedPath('outgoing', 'linux'), /relative path/);
});

test('the report lists the folders, the person’s own deny entries and the built-in list, the same from both surfaces', async () => {
  const m = machine({ attachRoots: ['~', join('~', 'work')], attachDeny: [join('~', 'work', 'secret')] });
  mkdirSync(join(m.home, 'work'));
  const { ok, close } = await connect(m);
  try {
    const report = await ok();
    const home = realpathSync.native(m.home);
    assert.deepEqual(report.roots, [
      { path: '~', real: home },
      { path: join('~', 'work'), real: join(home, 'work') },
    ]);
    assert.deepEqual(report.deny, [{ path: join('~', 'work', 'secret'), real: join(home, 'work', 'secret') }]);
    const builtIn = report.builtIn as { path: string; real: string | null }[];
    assert.deepEqual(
      builtIn.map((entry) => entry.path),
      defaultAttachDeny(m.core.paths.configDir, m.env),
    );
    // A pattern names no one place.
    assert.equal(builtIn.find((entry) => entry.path === '**/.git/**')?.real, null);
    assert.equal(builtIn.find((entry) => entry.path === '~/.*')?.real, null);

    const byCommand = cli(m, ['attach', '--json']);
    assert.equal(byCommand.status, 0, byCommand.stderr);
    assert.deepEqual(byCommand.json().data, report);
    const plain = cli(m, ['attach']);
    assert.equal(plain.status, 0, plain.stderr);
    assert.match(plain.stdout, /agentcomms attach roots add <folder>/, 'it says how to allow another folder');
  } finally {
    await close();
  }
});

test('adding a folder is approved first, the preview names where a link leads, and the claim writes it as written', async () => {
  const m = machine();
  // A link under the home that leads to the top of the disk: written as `~/link`, it would let everything be attached.
  const top = parse(realpathSync.native(m.home)).root;
  symlinkSync(top, join(m.home, 'link'), process.platform === 'win32' ? 'junction' : 'dir');
  const written = join('~', 'link');
  const { ok, call, close } = await connect(m);
  try {
    const first = await ok({ rootsAdd: written });
    assert.equal(first.applied, false);
    assert.equal(first.approvalRequired, true);
    assert.equal(first.policy, 'chat');
    const preview = String(first.preview);
    assert.match(preview, /folders attachments may come from: ~ → ~, ~[/\\]link/, 'the value as written');
    assert.ok(preview.includes(`leads to ${top}`), `the real path is shown: ${preview}`);
    assert.deepEqual((await defaultsOf(m)).attachRoots, ['~'], 'nothing is written before the claim');

    // The same arguments and the id: applied, as written.
    const applied = await ok({ rootsAdd: written, approvalId: first.approvalId });
    assert.equal(applied.applied, true);
    const result = applied.result as { changed: boolean; roots: { path: string }[] };
    assert.equal(result.changed, true);
    assert.deepEqual(
      result.roots.map((root) => root.path),
      ['~', written],
    );
    assert.deepEqual((await defaultsOf(m)).attachRoots, ['~', written]);

    // Spent: the same id does not add it twice, or anything else.
    const again = await call({ rootsAdd: join('~', 'other'), approvalId: first.approvalId });
    assert.equal(again.isError, true);
  } finally {
    await close();
  }
  // The audit log has the change, from the surface that asked, beside the approval's own steps.
  const audit = await m.core.audit.tail();
  const line = audit.find((record) => record.operation === 'attach.roots.add');
  assert.equal(line?.outcome, 'ok', JSON.stringify(audit));
  assert.equal(line?.surface, 'mcp');
  assert.equal(line?.reason, written);
  assert.ok(audit.some((record) => record.operation === 'change.claim'));
});

test('a folder inside one already allowed changes nothing, and says which folder allows it', async () => {
  const m = machine();
  mkdirSync(join(m.home, 'work'));
  const { ok, close } = await connect(m);
  try {
    const result = await ok({ rootsAdd: join('~', 'work') });
    assert.equal(result.applied, true, 'nothing to approve');
    const outcome = result.result as { changed: boolean; note: string };
    assert.equal(outcome.changed, false);
    assert.match(outcome.note, /already/);
    assert.match(outcome.note, /inside ~/);
    assert.deepEqual((await defaultsOf(m)).attachRoots, ['~']);
    assert.deepEqual(await m.core.approvals.list(), [], 'nobody was asked');
  } finally {
    await close();
  }
});

test('removing a folder applies at once; removing the last one says nothing can be attached', async () => {
  const m = machine({ attachRoots: ['~', join('~', 'work')] });
  const { ok, error, close } = await connect(m);
  try {
    const removed = await ok({ rootsRemove: join('~', 'work') });
    assert.equal(removed.applied, true);
    assert.deepEqual((await defaultsOf(m)).attachRoots, ['~']);

    const last = await ok({ rootsRemove: '~' });
    assert.equal(last.applied, true);
    assert.deepEqual((await defaultsOf(m)).attachRoots, []);
    assert.match(String((last.result as { note: string }).note), /nothing can be attached/);

    // One that is not listed is refused, with what is.
    const missing = await error({ rootsRemove: join('~', 'elsewhere') });
    assert.equal(missing.code, 'NOT_FOUND');
    assert.match(missing.message, /not one of the folders/);
    assert.deepEqual(await m.core.approvals.list(), [], 'nobody was asked anything');
  } finally {
    await close();
  }
});

test('a deny entry is added at once, and removing one is approved first', async () => {
  const m = machine();
  const entry = join('~', 'private');
  const { ok, close } = await connect(m);
  try {
    const added = await ok({ denyAdd: entry });
    assert.equal(added.applied, true);
    assert.deepEqual((await defaultsOf(m)).attachDeny, [entry]);

    const asked = await ok({ denyRemove: entry });
    assert.equal(asked.approvalRequired, true);
    assert.match(String(asked.preview), /files attachments may never come from: ~[/\\]private → none/);
    assert.deepEqual((await defaultsOf(m)).attachDeny, [entry], 'nothing removed before the claim');

    const removed = await ok({ denyRemove: entry, approvalId: asked.approvalId });
    assert.equal(removed.applied, true);
    assert.deepEqual((await defaultsOf(m)).attachDeny, []);
  } finally {
    await close();
  }
});

test('the built-in list cannot be removed, a relative path is refused, and one call makes one change', async () => {
  const m = machine({});
  const before = readFileSync(join(m.configDir, 'config.json'), 'utf8');
  const { error, close } = await connect(m);
  try {
    const builtIn = await error({ denyRemove: '~/Library' });
    assert.equal(builtIn.code, 'USAGE');
    assert.match(builtIn.message, /built-in list/);

    for (const args of [{ rootsAdd: 'work' }, { denyAdd: join('.', 'x') }, { rootsAdd: '~user/x' }]) {
      const relative = await error(args);
      assert.equal(relative.code, 'USAGE', JSON.stringify(args));
      assert.match(relative.message, /absolute|~/);
    }

    const two = await error({ rootsAdd: join('~', 'a'), denyAdd: join('~', 'b') });
    assert.equal(two.code, 'USAGE');
    assert.match(two.message, /one change/);

    // A report takes no approval.
    const report = await error({ approvalId: 'ap_00000000000000000000000000' });
    assert.equal(report.code, 'USAGE');
  } finally {
    await close();
  }
  assert.equal(readFileSync(join(m.configDir, 'config.json'), 'utf8'), before, 'nothing was written');
  assert.deepEqual(await m.core.approvals.list(), []);
});

test('`agentcomms attach roots add` is the same change at the command line: an agent gets the id, and claims it', async () => {
  const m = machine();
  // Outside the home, so it is not already allowed.
  const folder = realpathSync.native(tempDir('comms-attach-outside-'));
  const asked = cli(m, ['attach', 'roots', 'add', folder, '--json'], { CLAUDECODE: '1' });
  assert.equal(asked.status, 10, asked.stdout + asked.stderr);
  const { approvalId, preview } = asked.json().error.details as { approvalId: string; preview: string };
  assert.ok(preview.includes('folders attachments may come from'), preview);
  assert.match(asked.json().error.hint, new RegExp(`agentcomms attach roots add .* --approval ${approvalId}`));
  assert.deepEqual((await defaultsOf(m)).attachRoots, ['~']);

  const claimed = cli(m, ['attach', 'roots', 'add', folder, '--approval', approvalId, '--json'], { CLAUDECODE: '1' });
  assert.equal(claimed.status, 0, claimed.stdout + claimed.stderr);
  assert.deepEqual((await defaultsOf(m)).attachRoots, ['~', folder]);

  // Narrowing asks nobody at the command line either.
  const removed = cli(m, ['attach', 'roots', 'remove', folder, '--json'], { CLAUDECODE: '1' });
  assert.equal(removed.status, 0, removed.stdout + removed.stderr);
  assert.deepEqual((await defaultsOf(m)).attachRoots, ['~']);
  const denied = cli(m, ['attach', 'deny', 'add', join('~', 'taxes'), '--json'], { CLAUDECODE: '1' });
  assert.equal(denied.status, 0, denied.stdout + denied.stderr);
  assert.deepEqual((await defaultsOf(m)).attachDeny, [join('~', 'taxes')]);

  // A relative path, a missing one, and an approval on the report: usage, each.
  assert.equal(cli(m, ['attach', 'roots', 'add', 'work', '--json']).status, 64);
  assert.equal(cli(m, ['attach', 'roots', 'add', '--json']).status, 64);
  assert.equal(cli(m, ['attach', '--approval', approvalId, '--json']).status, 64);
});

test('an entry that names no place, written by hand, can still be taken out as it is listed', async () => {
  const m = machine({ attachRoots: ['~', 'legacy-folder'], attachDeny: ['old-deny'] });
  const { ok, error, close } = await connect(m);
  try {
    // Adding one is refused as it always was: a relative path means wherever this started.
    assert.match(String((await error({ rootsAdd: 'legacy-folder' })).message), /relative path/);
    // Taking it out is a tightening, applied at once, as listed.
    await ok({ rootsRemove: 'legacy-folder' });
    assert.deepEqual((await defaultsOf(m)).attachRoots, ['~']);
    // One that is not listed is still refused, by name.
    assert.match(String((await error({ rootsRemove: 'never-listed' })).message), /never-listed/);
  } finally {
    await close();
  }
});
