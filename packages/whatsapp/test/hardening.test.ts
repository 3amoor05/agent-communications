import assert from 'node:assert/strict';
import { chmodSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { LISTS_FILE } from '../src/lists.ts';
import { MIN_NODE, nodeSupportsSqlite, requireSupportedNode } from '../src/sqlite.ts';
import { ALICE, BOB } from './support/fixture.ts';
import { newHarness } from './support/harness.ts';

/**
 * What the spike's own risk table asked for before this was more than a spike, where it was cheap: the Node it needs
 * stated and checked before any work, the index — a plaintext copy of messages — kept owner-only, and the person's
 * lists failing closed.
 */

test('the Node this needs is stated, and anything older is refused with which Node it is and what to install', () => {
  const manifest = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
  assert.equal(manifest.engines.node, `>=${MIN_NODE}`, 'engines says what the check checks');
  for (const version of ['22.16.0', '22.22.3', '23.0.0', '24.1.0', 'v25.0.0']) {
    assert.equal(nodeSupportsSqlite(version), true, version);
  }
  for (const version of ['22.15.1', '22.12.0', '20.18.0', '18.0.0']) {
    assert.equal(nodeSupportsSqlite(version), false, version);
  }
  assert.throws(
    () => requireSupportedNode('22.12.0'),
    (error: { code?: string; message: string; hint?: string; details?: Record<string, unknown> }) =>
      error.code === 'CONFIG' &&
      /needs Node 22\.16\.0 or newer, and this is Node 22\.12\.0/.test(error.message) &&
      /node:sqlite/.test(error.hint ?? '') &&
      error.details?.reason === 'NODE_TOO_OLD',
  );
  assert.doesNotThrow(() => requireSupportedNode(), 'the Node running these tests is one it supports');
});

test('the index is owner-only, and put back to owner-only when something loosened it', async (t) => {
  if (process.platform === 'win32') return t.skip('POSIX permissions');
  const harness = await newHarness();
  await harness.ready('acme/whatsapp');
  const id = String(harness.coreConfig().accounts['acme/whatsapp']?.id);
  const directory = join(harness.env.AGENT_COMMS_STATE_DIR as string, 'whatsapp', id);
  const index = join(directory, 'index.sqlite');
  const mode = (path: string) => statSync(path).mode & 0o777;
  assert.equal(mode(directory), 0o700);
  assert.equal(mode(index), 0o600);

  // A backup restore, a careless chmod: the plaintext copy is readable by others until the next read puts it back.
  chmodSync(directory, 0o755);
  chmodSync(index, 0o644);
  const chats = await harness.cli(['chats', '--account', 'acme/whatsapp', '--json']);
  assert.equal(chats.code, 0, chats.stdout);
  assert.equal(mode(directory), 0o700);
  assert.equal(mode(index), 0o600);
});

test('a lists file that cannot be read, or does not parse, shows no chat at all — never every chat', async (t) => {
  const harness = await newHarness();
  await harness.ready('acme/whatsapp');
  assert.equal((await harness.cli(['deny', BOB, '--account', 'acme/whatsapp'])).code, 0);
  const path = join(harness.configDir, LISTS_FILE);

  writeFileSync(path, '{ not json');
  for (const argv of [['chats'], ['read', ALICE], ['search', 'invoice'], ['sync']]) {
    const refused = await harness.cli([...argv, '--account', 'acme/whatsapp', '--json']);
    assert.equal(refused.code, 78, `${argv[0]}: ${refused.stdout}`);
    assert.match(String(refused.json().error?.message), /so no chat is shown/);
  }
  const draft = await harness.cli(['draft', ALICE, 'hi', '--json']);
  assert.equal(draft.code, 78, 'not drafted to either: the lists cannot be checked');

  if (process.platform === 'win32') return t.skip('POSIX permissions');
  writeFileSync(path, `${JSON.stringify({ version: 1, accounts: {} })}\n`);
  chmodSync(path, 0o000);
  try {
    const unreadable = await harness.cli(['chats', '--account', 'acme/whatsapp', '--json']);
    if (process.getuid?.() === 0) return t.skip('root reads anything');
    assert.equal(unreadable.code, 78, unreadable.stdout);
    assert.match(String(unreadable.json().error?.message), /could not be read, so no chat is shown/);
  } finally {
    chmodSync(path, 0o600);
  }
});
