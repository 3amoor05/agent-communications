import assert from 'node:assert/strict';
import { existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';
import { syncAccount } from '../src/operations/sync.ts';
import { nodeSourceIo, type SourceIo } from '../src/source/snapshot.ts';
import { openDatabase } from '../src/sqlite.ts';
import { BOB } from './support/fixture.ts';
import { type CliRun, type Harness, newHarness } from './support/harness.ts';

/**
 * What a person's command does to a sync already running. The interleaving is real: the command runs, in this
 * process, from inside the sync — when the sync opens WhatsApp's store, after it read the account and its lists and
 * before it writes the index.
 */

const ACCOUNT = 'acme/whatsapp';
const BOB_TEXT = 'Bob here, about the quarterly report';

function accountDir(harness: Harness): string {
  const id = String(harness.coreConfig().accounts[ACCOUNT]?.id);
  return join(harness.env.AGENT_COMMS_STATE_DIR as string, 'whatsapp', id);
}

/** The store's file operations, with `during` run once, the first time the sync opens a file. */
function interrupted(during: () => Promise<void>): SourceIo {
  let fired = false;
  return {
    ...nodeSourceIo,
    async open(path) {
      if (!fired) {
        fired = true;
        await during();
      }
      return nodeSourceIo.open(path);
    },
  };
}

async function bodies(index: string): Promise<string[]> {
  const db = await openDatabase(index, { readOnly: true });
  try {
    return (db.prepare('SELECT body FROM messages WHERE body IS NOT NULL').all() as { body: string }[]).map(
      (row) => row.body,
    );
  } finally {
    db.close();
  }
}

test('a deny made while a sync runs is in the index that sync writes: the chat is not', async () => {
  const harness = await newHarness();
  await harness.ready(ACCOUNT);
  const index = join(accountDir(harness), 'index.sqlite');
  const io = interrupted(async () => {
    const denied = await harness.cli(['deny', BOB, '--account', ACCOUNT, '--json'], { env: harness.personEnv });
    assert.equal(denied.code, 0, denied.stdout);
  });
  const synced = await harness.cli(['sync', '--account', ACCOUNT, '--json'], { env: harness.personEnv, sourceIo: io });
  assert.equal(synced.code, 0, synced.stdout);
  assert.equal(synced.data().chats, 5, 'counted without it');
  assert.ok(!(await bodies(index)).includes(BOB_TEXT), 'no copy of the denied chat on disk');
});

test('a remove made while a sync runs waits for it, then removes everything: no index is left for an account that is gone', async () => {
  const harness = await newHarness();
  await harness.ready(ACCOUNT);
  const dir = accountDir(harness);
  let removal: Promise<CliRun> | undefined;
  const io = interrupted(async () => {
    removal = harness.cli(['remove', ACCOUNT, '--json'], { env: harness.personEnv });
    // Long enough for a remove that does not wait to finish first.
    await Promise.race([removal, delay(1500)]);
  });
  const synced = await harness.cli(['sync', '--account', ACCOUNT, '--json'], { env: harness.personEnv, sourceIo: io });
  const removed = await (removal as Promise<CliRun>);
  assert.equal(removed.code, 0, removed.stdout);
  assert.equal(synced.code, 0, `the sync that was running finished: ${synced.stdout}`);
  assert.equal(harness.coreConfig().accounts[ACCOUNT], undefined);
  assert.ok(!existsSync(dir), 'the account’s folder, index and all, is gone');
  assert.ok(!existsSync(`${dir}.sync.lock`), 'and so is the lock');
});

test('a sync that waited behind a remove finds its account gone, and writes nothing', async () => {
  /*
   * In-process, and ordered by the sync's own progress rather than a timer: it first looks its account up, then
   * waits for the lock a remove holds. The remove happens only once the lookup is done, so the sync is certainly
   * waiting behind it. A timer let a slow start look the account up after it was gone — refused by the lookup, not
   * by the check made once the lock is held, which is what this proves.
   */
  const harness = await newHarness();
  await harness.ready(ACCOUNT);
  const dir = accountDir(harness);
  const context = harness.context();
  // Another process holds the account's sync lock, as a remove does while it removes.
  mkdirSync(join(dir, '..'), { recursive: true });
  const lock = `${dir}.sync.lock`;
  writeFileSync(
    lock,
    JSON.stringify({ pid: process.pid, at: new Date().toISOString(), token: 'fake-lock-held-by-a-remove' }),
  );
  let lookedUp!: () => void;
  const lookup = new Promise<void>((resolve) => {
    lookedUp = resolve;
  });
  const account = context.account.bind(context);
  context.account = async (...args: Parameters<typeof account>) => {
    const found = await account(...args);
    lookedUp();
    return found;
  };
  const syncing = syncAccount(context, { account: ACCOUNT }).then(
    () => null,
    (error: unknown) => error,
  );
  await lookup;
  // What that remove does: the account out of config.json, its folder deleted; then it lets go.
  const configPath = join(harness.configDir, 'config.json');
  const config = JSON.parse(readFileSync(configPath, 'utf8'));
  delete config.accounts[ACCOUNT];
  writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`);
  rmSync(dir, { recursive: true, force: true });
  rmSync(lock);
  const refused = (await syncing) as { code?: string; message?: string } | null;
  assert.ok(refused, 'the sync went ahead for an account that was removed while it waited');
  assert.equal(refused.code, 'NOT_FOUND');
  assert.match(String(refused.message), /removed/);
  assert.ok(!existsSync(dir), 'no folder, and no index in it, for an account that is gone');
});

test('an account taken out of config.json by any other means while it syncs gets no new index', async () => {
  const harness = await newHarness();
  await harness.ready(ACCOUNT);
  const index = join(accountDir(harness), 'index.sqlite');
  const before = statSync(index, { bigint: true });
  const io = interrupted(async () => {
    const configPath = join(harness.configDir, 'config.json');
    const config = JSON.parse(readFileSync(configPath, 'utf8'));
    delete config.accounts[ACCOUNT];
    writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`);
  });
  const synced = await harness.cli(['sync', '--account', ACCOUNT, '--json'], { env: harness.personEnv, sourceIo: io });
  assert.equal(synced.code, 66, synced.stdout);
  assert.match(String(synced.json().error?.message), /removed while it was being synced/);
  const after = statSync(index, { bigint: true });
  assert.deepEqual([after.ino, after.mtimeNs], [before.ino, before.mtimeNs], 'the index was not replaced');
});
