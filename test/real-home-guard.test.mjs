import assert from 'node:assert/strict';
import { join } from 'node:path';
import { test } from 'node:test';
import { fixtureWrites, freshShell } from './helpers/real-shell.mjs';
import { tempDir } from './helpers/temp-dir.mjs';

/**
 * The real-shell fixtures never write the real home (CUE-403; design 2026-10-04 §4 item 9).
 *
 * Every folder and file they make goes through `fixtureWrites`, which refuses a target in the home before the call
 * reaches the file system. Tested here with a spy in the file system's place and a home of the test's own, standing for
 * the real one: nothing below names the machine's home, and nothing is written anywhere — the spy writes nothing.
 */

/** A file system that records each call it is given, and does nothing. */
function spy() {
  const calls = [];
  const record =
    (name) =>
    (...args) => {
      calls.push([name, ...args.map(String)]);
    };
  return {
    calls,
    fs: {
      mkdir: record('mkdir'),
      writeFile: record('writeFile'),
      open: record('open'),
      rename: record('rename'),
      rm: record('rm'),
    },
  };
}

/** A home and a temporary folder that stand for the machine's, under one of the test's own: the temp folder inside the home, as on Windows. */
async function machine() {
  const root = await tempDir('agentcomms-real-home-guard-');
  const home = join(root, 'Users', 'someone');
  return { home, temp: join(home, 'AppData', 'Local', 'Temp') };
}

test('a write the fixtures make in the home is refused before any call reaches the file system (9b)', async () => {
  const { home, temp } = await machine();
  const { calls, fs } = spy();
  const writes = fixtureWrites({ fs, home, temp });
  const targets = [
    home,
    join(home, '.config', 'agent-communications'),
    join(home, '.cursor', 'mcp.json'),
    join(home, 'Downloads', 'agent-communications', 'invoice.pdf'),
    join(home, 'AppData', 'Local', 'agent-communications', 'secrets'),
  ];
  for (const target of targets) {
    assert.throws(() => writes.mkdir(target, { recursive: true }), /refused before writing/, `mkdir ${target}`);
    assert.throws(() => writes.writeFile(target, 'x'), /refused before writing/, `writeFile ${target}`);
    assert.throws(() => writes.open(target, 'w'), /refused before writing/, `open ${target}`);
    assert.throws(() => writes.rm(target, { recursive: true }), /refused before writing/, `rm ${target}`);
    // A rename into the home, or out of it.
    assert.throws(() => writes.rename(join(temp, 'made'), target), /refused before writing/, `rename to ${target}`);
    assert.throws(() => writes.rename(target, join(temp, 'made')), /refused before writing/, `rename ${target}`);
  }
  // A fresh shell under the home is refused before its first folder is made.
  assert.throws(() => freshShell(join(home, 'shell'), { writes }), /refused before writing/);
  assert.deepEqual(calls, [], 'nothing reached the file system');
});

test('a write under the temporary folder — inside the home on Windows — and outside the home reaches it (9b)', async () => {
  const { home, temp } = await machine();
  const { calls, fs } = spy();
  const writes = fixtureWrites({ fs, home, temp });
  const elsewhere = join(home, '..', '..', 'elsewhere');
  writes.mkdir(join(temp, 'agentcomms-real-shell-x'), { recursive: true });
  writes.writeFile(join(elsewhere, 'config.json'), '{}');
  writes.rename(join(temp, 'a'), join(temp, 'b'));
  freshShell(join(temp, 'agentcomms-real-shell-y'), { writes });
  assert.deepEqual(
    calls.map(([name]) => name),
    ['mkdir', 'writeFile', 'rename', 'mkdir', 'mkdir'],
    'the spy is the file system the guard hands a call on to',
  );
});
