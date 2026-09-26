import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Visibility } from '../src/visibility.ts';
import { ALICE, addMessages, BOB, ERIN_STATUS, type Fixture, GROUP, HIDDEN, message } from './support/fixture.ts';
import { newHarness } from './support/harness.ts';
import { ACCOUNT, asIfAbsent, connect, NOBODY, person, surfaces } from './support/surfaces.ts';

/**
 * Whose a status post is, when the lists hide someone: a post is checked against its author, so one with no author
 * could be anyone's and is hidden, and counted. A group is a chat, allowed or denied whole, whoever wrote in it.
 */

test('whose a status post is: the author WhatsApp recorded, the contact whose own session it is, or the person; with none, it is hidden while the lists hide anyone', () => {
  const nobodyHidden = new Visibility({ allow: [], deny: [] });
  const aliceDenied = new Visibility({ allow: [], deny: [ALICE] });
  // chat, kind, sender, fromMe → seen with no lists, seen with Alice denied
  const cases: [string, string, string | null, boolean, boolean, boolean][] = [
    ['status@broadcast', 'status', ALICE, false, true, false],
    ['status@broadcast', 'status', BOB, false, true, true],
    ['status@broadcast', 'status', HIDDEN, false, true, true],
    ['status@broadcast', 'status', null, false, true, false],
    ['status@broadcast', 'status', null, true, true, true],
    ['status@broadcast', 'status', '  ', false, true, false],
    ['status@broadcast', 'status', 'STATUS@broadcast', false, true, false],
    ['status@broadcast', 'status', GROUP, false, true, false],
    [ERIN_STATUS, 'status', null, false, true, true],
    ['15555550101@status', 'status', null, false, true, false],
    [GROUP, 'group', null, false, true, true],
    [GROUP, 'group', ALICE, false, true, true],
    [ALICE, 'direct', ALICE, false, true, false],
  ];
  for (const [chat, kind, sender, fromMe, open, denied] of cases) {
    const what = `${chat} ${kind} from ${sender}${fromMe ? ' (the person)' : ''}`;
    assert.equal(nobodyHidden.seesMessage(chat, kind, sender, fromMe), open, `${what}, no lists`);
    assert.equal(aliceDenied.seesMessage(chat, kind, sender, fromMe), denied, `${what}, Alice denied`);
  }
  assert.equal(aliceDenied.unattributed('status@broadcast', 'status', null, false), true);
  assert.equal(aliceDenied.unattributed('status@broadcast', 'status', GROUP, false), true);
  assert.equal(aliceDenied.unattributed('status@broadcast', 'status', null, true), false, 'the person’s own');
  assert.equal(aliceDenied.unattributed(ERIN_STATUS, 'status', null, false), false, 'Erin’s own session');
  assert.equal(aliceDenied.unattributed(GROUP, 'group', null, false), false, 'a group has no per-author rule');
});

test('a status post WhatsApp recorded no author for is hidden while the lists hide anyone, on both surfaces, and status counts it', async () => {
  const harness = await newHarness();
  await addMessages(harness.fixture as Fixture, [
    // The review's case: in the status feed, from a contact, with neither a ZFROMJID nor a group-member row.
    message(30, 5, 800000041, 0, 'sunrise from somebody'),
    // Posted by the person.
    message(31, 5, 800000042, 0, 'sunrise of my own', { ZISFROMME: 1 }),
    // In a contact's own session, which names its author when the row does not.
    message(32, 7, 800000061, 0, 'sunrise at the beach'),
    // An "author" that is no person: the feed's own id, in capitals, so it is not recognised as the chat's.
    message(33, 5, 800000043, 0, 'sunrise from the feed', { ZFROMJID: 'STATUS@broadcast' }),
  ]);
  await harness.ready(ACCOUNT);
  const { call, close } = await connect(harness);
  const on = surfaces(harness, call);
  const feedCount = async () =>
    (
      (await harness.cli(['chats', '--account', ACCOUNT, '--kind', 'status', '--json'])).data().chats as {
        id: string;
        messages: number;
      }[]
    ).find((chat) => chat.id === 'status@broadcast')?.messages;
  try {
    // Nobody hidden: there is no one to check an author against, so every post shows.
    assert.deepEqual(await on.search('sunrise', '--kind', 'status'), ['30', '31', '32', '33']);
    assert.deepEqual((await on.read('status@broadcast')).ids, ['33', '31', '30', '16']);

    // Alice denied, after the sync: a post with no author could be hers, so it is not shown.
    await person(harness, 'deny', '+15555550101');
    assert.deepEqual(await on.search('sunrise', '--kind', 'status'), ['31', '32']);
    assert.deepEqual((await on.read('status@broadcast')).ids, ['31'], 'hers, and those with no author, are hidden');
    assert.deepEqual((await on.read(ERIN_STATUS)).ids, ['32', '22'], 'Erin’s session is Erin’s');
    assert.equal(await feedCount(), 1, 'nor counted in the feed');
    const pageFrom = async (before: string) =>
      (await harness.cli(['read', 'status@broadcast', '--account', ACCOUNT, '--before', before, '--json'])).json()
        .error;
    assert.deepEqual(
      await pageFrom('30'),
      JSON.parse(JSON.stringify(await pageFrom('999999')).replaceAll('999999', '30')),
      'paging from one is refused as from a message that does not exist',
    );
    assert.equal((await on.counts()).unattributedStatus, 2, 'status says how many, and never which');
    assert.match((await harness.cli(['status', '--no-check'])).stdout, /2 status update\(s\) hidden/);

    // The sync applies the same rule, on both surfaces: left out of the index, and still counted.
    assert.match((await harness.cli(['sync', '--account', ACCOUNT])).stdout, /2 status update\(s\) hidden/);
    const synced = await call('whatsapp_sync', { account: ACCOUNT });
    assert.equal(synced.structuredContent.unattributedStatus, 2);
    assert.deepEqual(await on.search('sunrise', '--kind', 'status'), ['31', '32']);
    await person(harness, 'deny', 'status@broadcast');
    assert.equal((await on.counts()).unattributedStatus, 0, 'a hidden feed is hidden whole, and nothing is said of it');
    await person(harness, 'clear');
    assert.deepEqual(await on.search('sunrise', '--kind', 'status'), ['31', '32'], 'not in the index to show');
    assert.equal((await on.counts()).unattributedStatus, 2, 'and said so, until the next sync');
    await harness.cli(['sync', '--account', ACCOUNT]);
    assert.deepEqual(await on.search('sunrise', '--kind', 'status'), ['30', '31', '32', '33']);
    assert.equal((await on.counts()).unattributedStatus, 0, 'none hidden while nobody is');

    // An allow list hides everyone not on it, so a post with no author is hidden under one too.
    await person(harness, 'allow', 'status@broadcast');
    assert.deepEqual((await on.read('status@broadcast')).ids, ['31']);
    assert.equal((await on.counts()).unattributedStatus, 2);
    await person(harness, 'deny', 'status@broadcast');
    assert.equal((await on.counts()).unattributedStatus, 0, 'nor of those the index holds');
  } finally {
    await close();
  }
});

test('a group is a chat: a denied person’s messages in a group the agent may see stay visible, with an author or without', async () => {
  const harness = await newHarness();
  await addMessages(harness.fixture as Fixture, [
    // Neither has a group-member row: one names Alice in ZFROMJID, the other names nobody.
    message(34, 3, 800000306, 0, 'harbour plans, from Alice', { ZFROMJID: ALICE }),
    message(35, 3, 800000307, 0, 'harbour plans, from nobody named'),
  ]);
  await harness.ready(ACCOUNT);
  const { call, close } = await connect(harness);
  const on = surfaces(harness, call);
  try {
    await person(harness, 'deny', '+15555550101');
    assert.deepEqual(await on.search('harbour'), ['34', '35'], 'the group may be seen, so all of it may');
    assert.deepEqual(((await on.read(GROUP)).ids ?? []).slice(0, 2), ['35', '34']);
    await harness.cli(['sync', '--account', ACCOUNT]);
    assert.deepEqual(await on.search('harbour'), ['34', '35'], 'and the sync keeps them');
    assert.equal((await on.counts()).unattributedStatus, 0, 'nothing in a group is hidden by its author');

    await person(harness, 'deny', GROUP);
    assert.deepEqual(await on.search('harbour'), [], 'denying the group is what hides it');
    assert.equal((await on.read(GROUP)).code, 66);
  } finally {
    await close();
  }
});
