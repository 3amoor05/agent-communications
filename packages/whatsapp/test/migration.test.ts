import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { Client } from '@modelcontextprotocol/client';
import { InMemoryTransport } from '@modelcontextprotocol/server';
import { createWhatsAppMcpServer } from '../src/mcp/server.ts';
import type { SourceIo } from '../src/source/snapshot.ts';
import { SPIKE_CONFIG_FILE } from '../src/spike-migration.ts';
import { openDatabase } from '../src/sqlite.ts';
import { ALICE, BOB, ERIN_STATUS } from './support/fixture.ts';
import { type Harness, newHarness } from './support/harness.ts';

/**
 * The one-time move of the spike's accounts, from `whatsapp-spike.json` into core's `config.json`.
 *
 * Every test here starts from a spike file written as the spike wrote it. None opens WhatsApp's store to migrate: the
 * store's file operations are replaced by ones that fail the test if they are called.
 */

const ACCOUNT = 'personal/whatsapp';
const SPIKE_ID = 'acc_SPKE00000000000A';

/** File operations that fail loudly: the migration, and the reads after it, must never reach WhatsApp's store. */
const untouchable: SourceIo = {
  lstat: async () => {
    throw new Error('the store was looked at');
  },
  open: async () => {
    throw new Error('the store was opened');
  },
};

function writeSpike(harness: Harness, accounts: Record<string, unknown>): void {
  writeFileSync(join(harness.configDir, SPIKE_CONFIG_FILE), `${JSON.stringify({ version: 1, accounts }, null, 2)}\n`);
}

/**
 * A machine as the spike left it: its account and index built by this release, then turned back into the spike's
 * file — the same id, the index where the spike kept it, and the person's deny list in the spike's record.
 */
async function spikeMachine(): Promise<{ harness: Harness; index: string }> {
  const harness = await newHarness();
  await harness.ready(ACCOUNT);
  const id = String(harness.coreConfig().accounts[ACCOUNT]?.id);
  const index = join(harness.env.AGENT_COMMS_STATE_DIR as string, 'whatsapp', id, 'index.sqlite');
  assert.ok(existsSync(index));
  // Back to the spike's shape: nothing in config.json, the record in the spike's own file, under the spike's id.
  const config = harness.coreConfig();
  writeFileSync(join(harness.configDir, 'config.json'), `${JSON.stringify({ ...config, accounts: {} }, null, 2)}\n`);
  const spikeIndex = join(harness.env.AGENT_COMMS_STATE_DIR as string, 'whatsapp', SPIKE_ID);
  rmSync(spikeIndex, { recursive: true, force: true });
  const { renameSync } = await import('node:fs');
  renameSync(join(index, '..'), spikeIndex);
  writeSpike(harness, {
    [ACCOUNT]: { id: SPIKE_ID, createdAt: '2026-09-26T07:00:00.000Z', chats: { allow: [], deny: [BOB] } },
  });
  return { harness, index: join(spikeIndex, 'index.sqlite') };
}

test('the first command moves the spike’s account into config.json — same id, same index, its lists first — once', async () => {
  const { harness, index } = await spikeMachine();
  const indexBefore = readFileSync(index);

  // A read, not a sync: the index the spike built is the one read, and the store is never touched.
  const chats = await harness.cli(['chats', '--account', ACCOUNT, '--json'], { sourceIo: untouchable });
  assert.equal(chats.code, 0, chats.stdout);
  const ids = (chats.data().chats as { id: string }[]).map((chat) => chat.id);
  assert.ok(ids.includes(ALICE));
  assert.ok(!ids.includes(BOB), 'the deny list came with it, and applied from the first read');
  assert.deepEqual(readFileSync(index), indexBefore, 'the index was read, not rebuilt');

  assert.match(
    chats.stderr,
    /Moved the WhatsApp spike's account personal\/whatsapp from whatsapp-spike\.json into config\.json/,
  );
  const record = harness.coreConfig().accounts[ACCOUNT] as Record<string, unknown>;
  assert.deepEqual(record, {
    id: SPIKE_ID,
    platform: 'whatsapp',
    workspace: 'group.net.whatsapp.WhatsApp.shared',
    workspaceName: 'WhatsApp for Mac',
    userId: 'store-owner',
    tier: 'read',
    mode: 'read',
    grantedScopes: ['local-store:read'],
    secretRef: `whatsapp:none:${SPIKE_ID}`,
    createdAt: '2026-09-26T07:00:00.000Z',
  });
  assert.deepEqual(harness.listsFile(), { version: 1, accounts: { [SPIKE_ID]: { allow: [], deny: [BOB] } } });
  assert.ok(!existsSync(join(harness.configDir, SPIKE_CONFIG_FILE)), 'the spike’s file is put aside');
  const kept = readdirSync(harness.configDir).filter((name) => name.startsWith(`${SPIKE_CONFIG_FILE}.migrated-`));
  assert.equal(kept.length, 1, 'kept, not deleted');

  // Logged, in core's audit log, with the account's id and never a chat.
  const auditDir = join(harness.env.AGENT_COMMS_STATE_DIR as string, 'audit');
  const lines = readdirSync(auditDir).flatMap((file) =>
    readFileSync(join(auditDir, file), 'utf8')
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line)),
  );
  const moved = lines.filter((line) => line.operation === 'whatsapp.accounts.migrate');
  assert.equal(moved.length, 1);
  assert.equal(moved[0].outcome, 'ok');
  assert.deepEqual(moved[0].ids, { accounts: [SPIKE_ID] });
  assert.doesNotMatch(JSON.stringify(moved[0]), /15555550102/, 'the log names no chat');

  // Once: the next command finds nothing to move, and says nothing.
  const again = await harness.cli(['status', '--no-check', '--json'], { sourceIo: untouchable });
  assert.equal(again.code, 0);
  assert.equal(again.stderr, '');
  assert.equal(again.data().spike, undefined);
  assert.equal((again.data().accounts as { chatLists: { deny: number } }[])[0]?.chatLists.deny, 1);
});

test('a server started on a spike machine moves the account too, and names it', async () => {
  const { harness } = await spikeMachine();
  const { server } = await createWhatsAppMcpServer({ env: harness.env, sourceIo: untouchable });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 'test', version: '0' });
  await Promise.all([client.connect(clientTransport), server.connect(serverTransport)]);
  try {
    assert.match(client.getInstructions() ?? '', /Known accounts: personal\/whatsapp\./);
    const read = (await client.callTool({ name: 'whatsapp_read', arguments: { account: ACCOUNT, chat: BOB } })) as {
      isError?: boolean;
    };
    assert.equal(read.isError, true, 'the deny list applies on the agent’s side too');
  } finally {
    await Promise.all([client.close(), server.close()]);
  }
  assert.deepEqual(Object.keys(harness.coreConfig().accounts), [ACCOUNT]);
});

test('a name that is taken is not forced: the rest move, and the log says which did not and why', async () => {
  const harness = await newHarness();
  await harness.ready('acme/whatsapp');
  writeSpike(harness, {
    'acme/whatsapp': { id: 'acc_SPKE00000000000B', createdAt: '2026-09-26T07:00:00.000Z' },
    'acme/slack': { id: 'acc_SPKE00000000000C', createdAt: '2026-09-26T07:00:00.000Z' },
    [ACCOUNT]: {
      id: SPIKE_ID,
      source: join(harness.home, 'elsewhere', 'ChatStorage.sqlite'),
      createdAt: '2026-09-26T07:00:00.000Z',
    },
  });
  const status = await harness.cli(['status', '--no-check', '--json']);
  assert.equal(status.code, 0);
  assert.match(status.stderr, /acme\/whatsapp was not moved: "acme\/whatsapp" is already connected/);
  assert.match(
    status.stderr,
    /acme\/slack was not moved: "acme\/slack" ends in \/slack, but this is a whatsapp account/,
  );
  const accounts = harness.coreConfig().accounts;
  assert.deepEqual(Object.keys(accounts).sort(), ['acme/whatsapp', ACCOUNT]);
  assert.notEqual(accounts['acme/whatsapp']?.id, 'acc_SPKE00000000000B', 'the account already there is untouched');
  assert.equal(accounts[ACCOUNT]?.source, join(harness.home, 'elsewhere', 'ChatStorage.sqlite'));
  assert.match(String(accounts[ACCOUNT]?.workspace), /^file:[0-9a-f]{16}$/, 'a store elsewhere is known by its path');
  assert.match(String(status.data().spike), /was not moved/);
  assert.ok(!existsSync(join(harness.configDir, SPIKE_CONFIG_FILE)), 'put aside all the same: it happens once');
});

test('on a configuration that still has the old flat names, nothing moves until they are migrated', async () => {
  const harness = await newHarness();
  writeFileSync(
    join(harness.configDir, 'config.json'),
    `${JSON.stringify({ version: 1, secrets: { store: 'file' } })}\n`,
  );
  writeSpike(harness, { [ACCOUNT]: { id: SPIKE_ID, createdAt: '2026-09-26T07:00:00.000Z' } });
  const status = await harness.cli(['status', '--no-check', '--json']);
  assert.equal(status.code, 0);
  assert.match(status.stderr, /not moved: the configuration still has the old flat names/);
  assert.ok(existsSync(join(harness.configDir, SPIKE_CONFIG_FILE)), 'left where it is for the next run');
  assert.equal(JSON.parse(readFileSync(join(harness.configDir, 'config.json'), 'utf8')).accounts, undefined);
});

test('a spike account that is not moved has its index named, where it was left, and what to do with it', async () => {
  const { harness, index } = await spikeMachine();
  // The spike's name is taken before the migration runs, by an account of its own.
  const configPath = join(harness.configDir, 'config.json');
  const config = JSON.parse(readFileSync(configPath, 'utf8'));
  config.accounts[ACCOUNT] = {
    id: 'acc_TAKEN00000000000',
    platform: 'whatsapp',
    workspace: 'group.net.whatsapp.WhatsApp.shared',
    workspaceName: 'WhatsApp for Mac',
    userId: 'store-owner',
    tier: 'read',
    mode: 'read',
    grantedScopes: ['local-store:read'],
    secretRef: 'whatsapp:none:acc_TAKEN00000000000',
    createdAt: '2026-09-26T08:00:00.000Z',
  };
  writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`);
  const status = await harness.cli(['status', '--no-check', '--json']);
  assert.equal(status.code, 0);
  const folder = join(index, '..');
  assert.ok(existsSync(index), 'left as it was: nothing is deleted without the person');
  for (const said of [status.stderr, String(status.data().spike)]) {
    assert.match(said, /personal\/whatsapp was not moved/);
    assert.ok(said.includes(folder), `the folder is named: ${said}`);
    assert.match(said, /plaintext copy of its messages/);
    assert.match(said, /delete/);
  }
});

test('an index the spike wrote before status sessions were a kind of their own is read with each chat’s kind from its id', async () => {
  const { harness, index } = await spikeMachine();
  // The spike classified `<number>@status` sessions as unknown, under the same index format.
  const db = await openDatabase(index);
  db.exec(`UPDATE chats SET kind = 'unknown' WHERE id LIKE '%@status'`);
  db.close();
  const chats = async (...argv: string[]) =>
    (
      (await harness.cli(['chats', '--account', ACCOUNT, ...argv, '--json'], { sourceIo: untouchable })).data()
        .chats as { id: string; kind: string }[]
    ).map((chat) => `${chat.id} ${chat.kind}`);
  assert.ok(!(await chats()).some((chat) => chat.startsWith(ERIN_STATUS)), 'not listed among conversations');
  assert.ok((await chats('--kind', 'status')).includes(`${ERIN_STATUS} status`));
  assert.deepEqual(await chats('--kind', 'unknown'), []);
  const search = await harness.cli(['search', 'beach', '--account', ACCOUNT, '--json'], { sourceIo: untouchable });
  assert.deepEqual(search.data().results, [], 'nor searched by default');
  const asked = await harness.cli(['search', 'beach', '--account', ACCOUNT, '--kind', 'status', '--json']);
  assert.equal((asked.data().results as { chat: { kind: string } }[])[0]?.chat.kind, 'status');
  const status = await harness.cli(['status', '--no-check', '--json'], { sourceIo: untouchable });
  const counted = (status.data().accounts as { index: { chats: number; statusChats: number } }[])[0]?.index;
  assert.deepEqual([counted?.chats, counted?.statusChats], [5, 2], 'nor counted as one');
});
