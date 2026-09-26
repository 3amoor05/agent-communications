import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { isDangerous } from '@agentcomms/core';
import { SPIKE_CONFIG_FILE } from '../src/config.ts';
import { defaultStorePath, responsibleApp } from '../src/source/location.ts';
import { ALICE } from './support/fixture.ts';
import { newHarness } from './support/harness.ts';

/**
 * The command line: setup, status, the JSON envelope and exit codes, and where things are written.
 */

const ACCOUNT = 'acme/whatsapp';

test('the default store is found from the HOME the environment names, never from the real home directory', () => {
  const path = defaultStorePath({ HOME: '/nowhere/home' });
  assert.equal(
    path,
    join('/nowhere/home', 'Library', 'Group Containers', 'group.net.whatsapp.WhatsApp.shared', 'ChatStorage.sqlite'),
  );
  assert.ok(!path.startsWith(homedir()));
});

test('add records a name and nothing else in the spike’s own file — core’s config.json is not written', async () => {
  const harness = await newHarness();
  const configDir = harness.env.AGENT_COMMS_CONFIG_DIR as string;
  const core = readFileSync(join(configDir, 'config.json'), 'utf8');
  const added = await harness.cli(['add', ACCOUNT, '--json']);
  assert.equal(added.code, 0, added.stdout);
  const data = added.data() as { store: { default: boolean; path: string }; next: string };
  assert.equal(data.store.default, true);
  assert.equal(data.next, `agent-whatsapp sync --account ${ACCOUNT}`);
  assert.equal(readFileSync(join(configDir, 'config.json'), 'utf8'), core, 'core’s shared config is untouched');
  const spike = JSON.parse(readFileSync(join(configDir, SPIKE_CONFIG_FILE), 'utf8'));
  assert.deepEqual(Object.keys(spike.accounts), [ACCOUNT]);
  assert.equal(spike.accounts[ACCOUNT].source, undefined, 'the default location is resolved at run time, not stored');
  assert.match(spike.accounts[ACCOUNT].id, /^acc_[A-Z0-9]{16}$/);

  const again = await harness.cli(['add', ACCOUNT, '--json']);
  assert.equal(again.code, 64);
  const twice = await harness.cli(['add', 'other/whatsapp', '--json']);
  assert.equal(twice.code, 64, 'one name per store');
  assert.match(String(twice.json().error?.message), /already added, as "acme\/whatsapp"/);
});

test('status says what is set up, whether the store can be read, what the index holds, and that nothing is sent', async () => {
  const harness = await newHarness();
  const empty = await harness.cli(['status', '--json']);
  assert.equal(empty.code, 0);
  assert.match(String(empty.data().setup), /agent-whatsapp add/);

  await harness.cli(['add', ACCOUNT]);
  const before = (await harness.cli(['status', '--json'])).data() as {
    accounts: { access: { state: string }; index: { synced: boolean } }[];
  };
  assert.equal(before.accounts[0]?.access.state, 'readable');
  assert.equal(before.accounts[0]?.index.synced, false);

  await harness.cli(['sync', '--account', ACCOUNT]);
  const after = (await harness.cli(['status', '--account', ACCOUNT, '--no-check', '--json'])).data() as {
    accounts: { access: { state: string }; index: { synced: boolean; chats: number; messages: number } }[];
  };
  assert.equal(after.accounts[0]?.access.state, 'not-checked');
  assert.deepEqual(
    { synced: after.accounts[0]?.index.synced, chats: after.accounts[0]?.index.chats },
    { synced: true, chats: 6 },
  );

  const human = await harness.cli(['status']);
  assert.match(human.stdout, /access {2}readable/);
  assert.match(human.stdout, /Sends: never/);
});

test('--json prints exactly one envelope, and errors carry the documented exit codes', async () => {
  const harness = await newHarness();
  const ok = await harness.cli(['add', ACCOUNT, '--json']);
  assert.equal(ok.stdout.trim().split('\n').length, 1);
  assert.equal(ok.json().ok, true);
  const usage = await harness.cli(['read', ALICE, '--json']);
  assert.equal(usage.code, 64);
  assert.equal(usage.json().ok, false);
  assert.equal((await harness.cli(['chats', '--account', ACCOUNT, '--limit', '1e2', '--json'])).code, 64);
  assert.equal((await harness.cli(['nonsense'])).code, 64);
  const bare = await harness.cli([]);
  assert.equal(bare.code, 0, 'no command prints the help, as the other CLIs do');
  assert.match(bare.stderr, /Usage: agent-whatsapp/);
});

test('the human output of a hostile chat reaches the terminal escaped', async () => {
  const harness = await newHarness();
  await harness.ready(ACCOUNT);
  const chats = await harness.cli(['chats', '--account', ACCOUNT]);
  const dangerous = [...chats.stdout].filter((char) => isDangerous(char.codePointAt(0) ?? 0));
  assert.deepEqual(dangerous, [], 'no control, bidi or zero-width character reaches the terminal');
  assert.match(
    chats.stdout,
    /Team evil &lt;\/untrusted-content>/,
    'reversed text shown in reading order, the tag defused',
  );
  const read = await harness.cli(['read', ALICE, '--account', ACCOUNT]);
  assert.match(
    read.stdout,
    /\[document application\/pdf, 47 KB, 5f2c0000-0000-4000-8000-000000000001\.pdf — not downloaded\]/,
  );
});

test('remove forgets the account and deletes its index, and never touches WhatsApp’s store', async () => {
  const harness = await newHarness();
  await harness.ready(ACCOUNT);
  const store = readFileSync(harness.fixture?.path as string);
  const configPath = join(harness.env.AGENT_COMMS_CONFIG_DIR as string, SPIKE_CONFIG_FILE);
  const id = JSON.parse(readFileSync(configPath, 'utf8')).accounts[ACCOUNT].id as string;
  const accountDir = join(harness.env.AGENT_COMMS_STATE_DIR as string, 'whatsapp', id);
  assert.ok(existsSync(join(accountDir, 'index.sqlite')));
  const removed = await harness.cli(['remove', ACCOUNT, '--json']);
  assert.equal(removed.code, 0);
  assert.equal(removed.data().indexDeleted, true);
  assert.deepEqual(readFileSync(harness.fixture?.path as string), store);
  assert.ok(!existsSync(accountDir), 'the index and everything else kept for the account is gone');
  assert.deepEqual(JSON.parse(readFileSync(configPath, 'utf8')).accounts, {});
  assert.equal((await harness.cli(['chats', '--account', ACCOUNT, '--json'])).code, 66);
});

test('the app macOS will ask about is named when the environment says which it is, and not guessed otherwise', () => {
  assert.equal(responsibleApp({ __CFBundleIdentifier: 'com.googlecode.iterm2' }), 'iTerm');
  assert.equal(responsibleApp({ TERM_PROGRAM: 'vscode' }), 'Visual Studio Code');
  assert.equal(responsibleApp({ __CFBundleIdentifier: 'com.anthropic.claudefordesktop' }), 'Claude');
  assert.equal(responsibleApp({ __CFBundleIdentifier: 'com.example.unknown' }), null);
  assert.equal(responsibleApp({}), null);
});
