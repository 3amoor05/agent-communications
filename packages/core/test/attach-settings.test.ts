import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, realpathSync, symlinkSync, writeFileSync } from 'node:fs';
import { join, parse } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/client';
import { InMemoryTransport } from '@modelcontextprotocol/server';
import { renderAttach } from '../src/cli.ts';
import { type Core, openCore } from '../src/core.ts';
import { defaultAttachDeny } from '../src/jail.ts';
import { createCoreMcpServer } from '../src/mcp/server.ts';
import { attachReport, checkedPath } from '../src/operations/attach-settings.ts';
import { coreCommand, coreHandoffs, coreInline } from './helpers/handoffs.ts';
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

const NOT_ON_WINDOWS = { skip: process.platform === 'win32' && 'needs a POSIX shell' };

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
    // This installation's own command, with the folder for the person to fill in.
    const add = coreCommand(m.core.paths, ['attach', 'roots', 'add']);
    assert.ok(plain.stdout.includes(`To allow another folder: \`${add} <folder>\``), plain.stdout);
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
  assert.equal(
    asked.json().error.hint,
    `Show the person the preview. Once they say yes, run ${coreInline(m.core.paths, ['attach', 'roots', 'add', folder, '--approval', approvalId])}.`,
  );
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

test('a folder listed with no place covers nothing: adding its proper form is a widening, approved first', async () => {
  // `outgoing`, written by hand, is read against wherever a process starts; the jail ignores it. Its proper form —
  // here the same folder written in full — is then a new folder to attach from, and needs the person's approval.
  const m = machine({ attachRoots: ['~', 'outgoing'] });
  const full = join(process.cwd(), 'outgoing');
  const { ok, close } = await connect(m);
  try {
    const prepared = await ok({ rootsAdd: full });
    assert.equal(prepared.approvalRequired, true, 'taken as already allowed, or applied with nobody asked');
    assert.deepEqual((await defaultsOf(m)).attachRoots, ['~', 'outgoing'], 'written before it was approved');
  } finally {
    await close();
  }
});

test('the report shows a listed folder that names no place apart: it allows nothing, and says how to take it out', async () => {
  for (const [roots, allowed] of [
    [['outgoing'], 0],
    [['~', 'outgoing'], 1],
  ] as const) {
    const m = machine({ attachRoots: [...roots] });
    const { ok, close } = await connect(m);
    try {
      const report = await ok();
      assert.equal((report.roots as unknown[]).length, allowed, JSON.stringify(roots));
      assert.deepEqual(report.ignored, ['outgoing'], 'shown as allowed, or left out');
    } finally {
      await close();
    }
    const shown = cli(m, ['attach']);
    assert.equal(shown.status, 0, shown.stderr);
    assert.match(shown.stdout, /Listed, but allowing nothing[^\n]*\n[^\n]*\n/);
    assert.ok(shown.stdout.includes(`\n  ${coreCommand(m.core.paths, ['attach', 'roots', 'remove', 'outgoing'])}\n`));
    if (allowed === 0) assert.match(shown.stdout, /so nothing can be attached/);
    else assert.doesNotMatch(shown.stdout, /so nothing can be attached/);
  }
});

test('an entry is taken out exactly as it is listed: spaces at either end, or nothing at all, from both surfaces', async () => {
  const m = machine({ attachRoots: ['~', ' outgoing ', ''] });
  const shown = cli(m, ['attach']);
  const report = await attachReport(m.core, m.env);
  // Both forms are asked for by name. The test runner's host must not decide which command the assertion expects.
  const remove = (entry: string, platform: NodeJS.Platform) =>
    coreCommand(m.core.paths, ['attach', 'roots', 'remove', entry], platform);
  const posix = renderAttach(report, coreHandoffs(m.core.paths, 'darwin'));
  assert.ok(
    remove(' outgoing ', 'darwin').endsWith(" remove ' outgoing '") && remove('', 'darwin').endsWith(" remove ''"),
  );
  assert.ok(
    posix.includes(`\n  ${remove(' outgoing ', 'darwin')}\n  ${remove('', 'darwin')}\n`),
    `the spaces and the empty entry are not visible: ${posix}`,
  );
  const windows = renderAttach(report, coreHandoffs(m.core.paths, 'win32'));
  assert.ok(remove(' outgoing ', 'win32').endsWith(' remove " outgoing "'), remove(' outgoing ', 'win32'));
  assert.ok(
    windows.includes(`\n  ${remove(' outgoing ', 'win32')}\n  ${remove('', 'win32')}\n`),
    `the Windows command words are not visible: ${windows}`,
  );
  assert.match(shown.stdout, /Listed, but allowing nothing/, 'the CLI did not render the report');
  const { ok, error, close } = await connect(m);
  try {
    // Trimmed, it is another entry, and is not listed.
    assert.match(String((await error({ rootsRemove: 'outgoing' })).message), /"outgoing" is not one of the folders/);
    await ok({ rootsRemove: ' outgoing ' });
    assert.deepEqual((await defaultsOf(m)).attachRoots, ['~', '']);
  } finally {
    await close();
  }
  const removed = cli(m, ['attach', 'roots', 'remove', '']);
  assert.equal(removed.status, 0, removed.stderr);
  assert.deepEqual((await defaultsOf(m)).attachRoots, ['~']);
});

test(
  'the command shown to take an entry out gives the shell back the entry, as written: nothing in it is expanded or run',
  NOT_ON_WINDOWS,
  () => {
    const marker = join(tempDir('comms-attach-shell-'), 'ran');
    const entries = ['$HOME/outgoing', `$(touch ${marker})`, "it's here", 'back\\slash', ' spaced ', ''];
    const m = machine({ attachRoots: ['~', ...entries] });
    const shown = cli(m, ['attach']);
    assert.equal(shown.status, 0, shown.stderr);
    const prefix = coreCommand(m.core.paths, ['attach', 'roots', 'remove']);
    const commands = shown.stdout.split('\n').filter((line) => line.startsWith(`  ${prefix} `));
    assert.equal(commands.length, entries.length);
    for (const [index, command] of commands.entries()) {
      // The shell reads the line; printf hands back the one word it was given in place of the folder.
      const word = command.trim().slice(prefix.length + 1);
      const echoed = spawnSync('/bin/sh', ['-c', `printf '%s' ${word}`], { encoding: 'utf8' });
      assert.equal(echoed.stdout, entries[index], command);
    }
    assert.equal(existsSync(marker), false, 'a $(…) in an entry was run');
  },
);

test(
  'a space at the end of a folder is part of its name: /allowed and "/allowed " are two entries, and taking one off is approved',
  NOT_ON_WINDOWS,
  async () => {
    const base = realpathSync.native(tempDir('comms-attach-space-'));
    const plain = join(base, 'allowed');
    const spaced = `${plain} `;
    mkdirSync(plain);
    mkdirSync(spaced);
    const m = machine({ attachDeny: [plain, spaced] });
    const { ok, close } = await connect(m);
    try {
      // Removing a deny entry widens what can be sent, even when another entry differs from it only by the space.
      const asked = await ok({ denyRemove: spaced });
      assert.equal(asked.approvalRequired, true, 'taken off with nobody asked');
      await ok({ denyRemove: spaced, approvalId: asked.approvalId });
      assert.deepEqual((await defaultsOf(m)).attachDeny, [plain], 'the other entry was taken off with it');
      // And a folder added with a space at its end keeps it.
      const add = await ok({ rootsAdd: spaced });
      await ok({ rootsAdd: spaced, approvalId: add.approvalId });
      assert.ok((await defaultsOf(m)).attachRoots.includes(spaced), 'the space was trimmed off');
    } finally {
      await close();
    }
  },
);
