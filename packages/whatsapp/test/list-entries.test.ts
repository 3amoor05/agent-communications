import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ALICE, BOB } from './support/fixture.ts';
import { newHarness } from './support/harness.ts';
import { ACCOUNT, asIfAbsent, connect, NOBODY, person, surfaces } from './support/surfaces.ts';

/**
 * What goes on a list: a number with its country code, the chat it names shown back, and `00` read as `+` wherever a
 * number is taken.
 */

test('a number on a list needs its country code: one without is refused, not kept to match nothing, and the chat an entry names is named', async () => {
  const harness = await newHarness();
  await harness.ready(ACCOUNT);
  const { call, close } = await connect(harness);
  const on = surfaces(harness, call);
  try {
    // As a person writes a number at home: without the country code, it could be anyone's in any country.
    for (const national of ['(555) 555-0102', '5555550102', '15555550102']) {
      for (const command of ['deny', 'allow', 'clear']) {
        const refused = await harness.cli([command, national, '--account', ACCOUNT, '--json']);
        assert.equal(refused.code, 64, `${command} ${national}: ${refused.stdout}`);
        assert.match(String(refused.json().error?.message), /country code/);
        assert.match(String(refused.json().error?.hint), /\+1 555 555 0102|00/);
      }
    }
    assert.equal(harness.listsFile(), null, 'nothing was written');
    assert.equal((await on.read(BOB)).code, 0);

    // With it — as + or as 00 — the entry is the chat, and the chat is named, from the index.
    for (const number of ['+1 (555) 555-0102', '00 1 555 555 0102']) {
      const denied = await harness.cli(['deny', number, '--account', ACCOUNT, '--json']);
      assert.equal(denied.code, 0, denied.stdout);
      const data = denied.data() as { deny: string[]; chat: { id: string; kind: string } | null; warning?: string };
      assert.deepEqual(data.deny, [BOB]);
      assert.deepEqual(data.chat && { id: data.chat.id, kind: data.chat.kind }, { id: BOB, kind: 'direct' });
      assert.equal(data.warning, undefined);
      assert.match((await harness.cli(['deny', number, '--account', ACCOUNT])).stdout, /Bobby Test/);
      assert.equal((await on.read(BOB)).code, 66, 'and it hides what it names');
      await person(harness, 'clear');
    }

    // A number with no chat is kept — a person may hide one before it writes — and said to match none yet.
    const ahead = await harness.cli(['deny', '+44 7700 900123', '--account', ACCOUNT, '--json']);
    assert.equal(ahead.code, 0, ahead.stdout);
    assert.deepEqual((ahead.data() as { deny: string[] }).deny, ['447700900123@s.whatsapp.net']);
    assert.equal((ahead.data() as { chat: unknown }).chat, null);
    assert.match(String((ahead.data() as { warning?: string }).warning), /no chat .* in the index/);
    assert.match((await harness.cli(['deny', '+44 7700 900123', '--account', ACCOUNT])).stdout, /no chat/);
  } finally {
    await close();
  }
});

test('a number with a leading 00 is the international number, and one with a single leading 0 is refused as national', async () => {
  const harness = await newHarness();
  await harness.ready(ACCOUNT);
  const { call, close } = await connect(harness);
  const on = surfaces(harness, call);
  try {
    assert.deepEqual((await on.read('00 1 555 555 0101')).ids, (await on.read(ALICE)).ids);
    await person(harness, 'deny', '+15555550102');
    assert.equal((await on.read('0015555550102')).code, 66, 'the denied number, written with 00, is the same entry');
    assert.equal((await on.draft('00 1 555 555 0102')).code, 66, 'and not drafted to');
    const alice = await on.draft('00 1 555 555 0101');
    assert.deepEqual(alice.links, {
      app: 'whatsapp://send?phone=15555550101&text=hello',
      web: 'https://wa.me/15555550101?text=hello',
    });
    for (const national of ['07700 900123', '0 555 555 0102']) {
      const read = await on.read(national);
      assert.deepEqual([read.code, read.error?.code], [64, 'USAGE'], national);
      assert.match(String(read.error?.hint), /country code/);
    }
  } finally {
    await close();
  }
});
