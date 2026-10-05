import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { isCommsError } from '@agentcomms/core';
import { inspectSchema } from '../src/source/schema.ts';
import { openDatabase } from '../src/sqlite.ts';
import { buildFixtureStore, type FixtureOptions } from './support/fixture.ts';
import { ownInline } from './support/handoffs.ts';
import { newHarness, tempDir } from './support/harness.ts';

/**
 * WhatsApp changes its storage without notice. The reader checks the layout before it reads, refuses by name when a
 * part it depends on is gone, and says what it is doing without when an optional part is.
 */

async function inspect(options: FixtureOptions) {
  const fixture = await buildFixtureStore(tempDir(), options);
  const db = await openDatabase(fixture.path, { readOnly: true });
  try {
    return inspectSchema(db);
  } finally {
    db.close();
  }
}

test('a store with the layout the public readers describe passes, with nothing degraded', async () => {
  const report = await inspect({});
  assert.deepEqual(report.degraded, []);
});

test('a store missing a required table or column is refused, naming every missing part at once', async () => {
  await assert.rejects(
    inspect({ omitColumns: ['ZWAMESSAGE.ZTEXT', 'ZWACHATSESSION.ZCONTACTJID'] }),
    (error: unknown) => {
      assert.ok(isCommsError(error));
      assert.equal(error.code, 'BAD_DATA');
      assert.equal(error.details?.reason, 'SCHEMA_DRIFT');
      assert.deepEqual(error.details?.missing, ['ZWACHATSESSION.ZCONTACTJID', 'ZWAMESSAGE.ZTEXT']);
      assert.match(error.message, /no longer has the layout this reader knows/);
      return true;
    },
  );
  await assert.rejects(inspect({ omitTables: ['ZWAMESSAGE'] }), (error: unknown) => {
    assert.ok(isCommsError(error));
    assert.deepEqual(error.details?.missing, ['ZWAMESSAGE']);
    return true;
  });
});

test('an optional part that is missing costs one named feature, and is reported rather than guessed', async () => {
  const report = await inspect({
    omitTables: ['ZWAPROFILEPUSHNAME'],
    omitColumns: ['ZWAMEDIAITEM.ZTITLE', 'ZWAGROUPMEMBER.ZMEMBERJID'],
  });
  assert.deepEqual(
    report.degraded.map((entry) => entry.part),
    ['ZWAGROUPMEMBER', 'ZWAMEDIAITEM.ZTITLE', 'ZWAPROFILEPUSHNAME'],
  );
  assert.match(report.degraded.find((entry) => entry.part === 'ZWAGROUPMEMBER')?.costs ?? '', /who sent each message/);
});

test('a drifted store indexes nothing and leaves the previous index as it was', async () => {
  const harness = await newHarness();
  await harness.ready();
  const config = harness.coreConfig();
  const id = Object.values(config.accounts)[0]?.id as string;
  const index = join(harness.env.AGENT_COMMS_STATE_DIR as string, 'whatsapp', id, 'index.sqlite');
  const before = readFileSync(index);

  // WhatsApp ships an update that renames a column the reader needs.
  const live = await openDatabase(harness.fixture?.path as string);
  live.exec('ALTER TABLE ZWAMESSAGE RENAME COLUMN ZTEXT TO ZTEXTBODY');
  live.close();

  const synced = await harness.cli(['sync', '--account', 'acme/whatsapp', '--json']);
  assert.equal(synced.code, 65);
  const details = synced.json().error?.details as { missing: string[] } | undefined;
  assert.deepEqual(details?.missing, ['ZWAMESSAGE.ZTEXT']);
  assert.ok(existsSync(index));
  assert.deepEqual(readFileSync(index), before, 'the last good index is untouched');
  const chats = await harness.cli(['chats', '--account', 'acme/whatsapp', '--json']);
  assert.equal(chats.code, 0, 'reads keep working on what was last synced');
});

test('a store without the optional tables still syncs, and says what it is doing without', async () => {
  const harness = await newHarness({
    store: { omitTables: ['ZWAMEDIAITEM', 'ZWAPROFILEPUSHNAME', 'ZWAGROUPMEMBER'] },
  });
  await harness.cli(['add', 'acme/whatsapp']);
  const synced = await harness.cli(['sync', '--account', 'acme/whatsapp', '--json']);
  assert.equal(synced.code, 0, synced.stdout);
  const data = synced.data() as { messages: number; degraded: { part: string }[] };
  assert.ok(data.messages > 0);
  assert.deepEqual(data.degraded.map((entry) => entry.part).sort(), [
    'ZWAGROUPMEMBER',
    'ZWAMEDIAITEM',
    'ZWAPROFILEPUSHNAME',
  ]);
  const status = await harness.cli(['status', '--json']);
  const accounts = status.data().accounts as { index: { degraded: unknown[] } }[];
  assert.equal(accounts[0]?.index.degraded.length, 3);
});

test('an index an earlier reader built, under older rules, is refused until the next sync', async () => {
  const harness = await newHarness();
  await harness.ready();
  const config = harness.coreConfig();
  const id = Object.values(config.accounts)[0]?.id as string;
  const index = await openDatabase(join(harness.env.AGENT_COMMS_STATE_DIR as string, 'whatsapp', id, 'index.sqlite'));
  index.exec("UPDATE meta SET value = '1' WHERE key = 'format'");
  index.close();

  const stale = await harness.cli(['chats', '--account', 'acme/whatsapp', '--json']);
  assert.equal(stale.code, 78, stale.stdout);
  assert.equal(
    stale.json().error?.hint,
    `Run ${ownInline(harness.env, ['sync', '--account', 'acme/whatsapp'])} to rebuild it.`,
  );
  assert.equal((await harness.cli(['sync', '--account', 'acme/whatsapp'])).code, 0);
  assert.equal((await harness.cli(['chats', '--account', 'acme/whatsapp', '--json'])).code, 0);
});
