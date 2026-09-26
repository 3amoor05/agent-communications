import assert from 'node:assert/strict';
import { join } from 'node:path';
import { test } from 'node:test';
import { Client } from '@modelcontextprotocol/client';
import { InMemoryTransport } from '@modelcontextprotocol/server';
import { createWhatsAppMcpServer } from '../src/mcp/server.ts';
import { ALICE, BOB, buildFixtureStore, GROUP } from './support/fixture.ts';
import { newHarness } from './support/harness.ts';
import { ACCOUNT, asIfAbsent, connect, NOBODY, person, surfaces } from './support/surfaces.ts';

/**
 * A draft and the person's lists: a draft cannot be used to find out which chats are hidden, and a number denied on
 * one account is not drafted to by naming another.
 */

test('a draft cannot tell a hidden chat from one that does not exist, on both surfaces, by number or by id', async () => {
  const harness = await newHarness();
  await harness.ready(ACCOUNT);
  const { call, close } = await connect(harness);
  const on = surfaces(harness, call);
  try {
    // Nothing hidden: nothing to give away, so any number is drafted to, in the index or not.
    assert.equal((await on.draft(NOBODY)).code, 0, 'a number with no chat, while the lists hide nobody');
    assert.equal((await on.draft(NOBODY, false)).code, 0);

    await person(harness, 'deny', '+1 555 555 0102');
    for (const withAccount of [true, false]) {
      const absent = await on.draft(NOBODY, withAccount);
      const hidden = await on.draft(BOB, withAccount);
      assert.equal(hidden.code, 66, `hidden, ${withAccount ? 'with' : 'without'} --account`);
      assert.equal(absent.code, 66, 'and one with no chat, the same');
      assert.deepEqual(
        { code: hidden.error?.code, message: hidden.error?.message, hint: hidden.error?.hint },
        { code: absent.error?.code, ...asIfAbsent(absent.error, BOB) },
        'word for word',
      );
      assert.equal((await on.draft('+1 555 555 0102', withAccount)).code, 66, 'by number too');
    }
    // A status id says it cannot be drafted to before anything is looked up, hidden author or not.
    const denied = await on.draft('15555550102@status');
    const nobody = await on.draft('15555550199@status');
    assert.deepEqual([denied.code, denied.error?.code], [64, 'USAGE']);
    assert.deepEqual(denied.error?.message, nobody.error?.message);
    // A visible chat in the index is drafted to as before.
    assert.equal((await on.draft(ALICE)).code, 0);
    assert.equal((await on.draft('+1 555 555 0101', false)).code, 0);
  } finally {
    await close();
  }
});

test('a number denied on any account is not drafted to through another — a draft is a link to a number, not to an account', async () => {
  const harness = await newHarness();
  await harness.ready(ACCOUNT);
  const business = await buildFixtureStore(join(harness.root, 'business'));
  const added = await harness.cli(['add', 'biz/whatsapp', '--source', business.path, '--json'], {
    env: harness.personEnv,
  });
  assert.equal(added.code, 0, added.stdout);
  await harness.cli(['sync', '--account', 'biz/whatsapp'], { env: harness.personEnv });
  const { call, close } = await connect(harness);
  const on = surfaces(harness, call);
  try {
    await person(harness, 'deny', BOB);
    const viaBiz = await on.draft(BOB, 'biz/whatsapp');
    const absentInBiz = await on.draft(NOBODY, 'biz/whatsapp');
    assert.equal(viaBiz.code, 66, 'refused through the other account');
    assert.deepEqual(
      { message: viaBiz.error?.message, hint: viaBiz.error?.hint },
      asIfAbsent(absentInBiz.error, BOB),
      'as a chat that is not there',
    );
    assert.equal((await on.draft(ALICE, 'biz/whatsapp')).code, 0, 'the others, as before');
    assert.equal((await on.read(BOB)).code, 66);

    // An allow list is its own account's: it holds for a draft that names no account, not for one that names another
    // — even while that other account's own lists hide something.
    await person(harness, 'clear');
    await person(harness, 'allow', ALICE);
    const bizDenies = await harness.cli(['deny', GROUP, '--account', 'biz/whatsapp', '--json']);
    assert.equal(bizDenies.code, 0, bizDenies.stdout);
    assert.equal((await on.draft(BOB, false)).code, 66, 'no account named: every account’s lists');
    assert.equal((await on.draft(BOB, 'biz/whatsapp')).code, 0, 'the account named: its own');
    assert.equal((await on.draft(GROUP, 'biz/whatsapp')).code, 66);
    await harness.cli(['clear', '--account', 'biz/whatsapp']);
    await person(harness, 'clear');
    await person(harness, 'deny', BOB);

    // A server pinned to the other account serves that account alone, and its lists.
    const { server } = await createWhatsAppMcpServer({ env: harness.env, account: 'biz/whatsapp' });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: 'test', version: '0' });
    await Promise.all([client.connect(clientTransport), server.connect(serverTransport)]);
    try {
      const pinned = (await client.callTool({ name: 'whatsapp_draft', arguments: { to: BOB, text: 'hi' } })) as {
        isError?: boolean;
      };
      assert.ok(!pinned.isError, 'nothing about another account reaches a pinned server');
    } finally {
      await Promise.all([client.close(), server.close()]);
    }
  } finally {
    await close();
  }
});
