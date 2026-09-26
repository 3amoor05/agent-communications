import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { Client } from '@modelcontextprotocol/client';
import { InMemoryTransport } from '@modelcontextprotocol/server';
import { createWhatsAppMcpServer } from '../src/mcp/server.ts';
import { allowChat, clearChats, denyChat } from '../src/operations/chat-lists.ts';
import { Visibility } from '../src/visibility.ts';
import {
  ALICE,
  addMessages,
  BOB,
  buildFixtureStore,
  ERIN_STATUS,
  type Fixture,
  GROUP,
  HIDDEN,
  message,
} from './support/fixture.ts';
import { type Harness, newHarness } from './support/harness.ts';

/**
 * A person's allow and deny lists of chats: which chats an agent may see at all. Applied by every read on both
 * surfaces — chats, read, search, draft and status's counts — and by sync, which leaves hidden chats out of the index.
 * A hidden chat does not appear, and asking for it by id gets exactly the answer a chat that does not exist gets.
 */

const ACCOUNT = 'acme/whatsapp';
const NOBODY = '15555550199@s.whatsapp.net';

async function connect(harness: Harness) {
  const { server } = await createWhatsAppMcpServer({ env: harness.env });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 'test', version: '0' });
  await Promise.all([client.connect(clientTransport), server.connect(serverTransport)]);
  const call = async (name: string, args: Record<string, unknown>) =>
    (await client.callTool({ name, arguments: args })) as {
      isError?: boolean;
      structuredContent: Record<string, unknown> & { error?: { code: string; message: string; hint: string | null } };
    };
  return { client, call, close: () => Promise.all([client.close(), server.close()]) };
}

/** Reads through both surfaces, reduced to what a list decides: which chats and messages come back. */
function surfaces(harness: Harness, call: Awaited<ReturnType<typeof connect>>['call']) {
  return {
    async chats(kind?: string) {
      const cli = await harness.cli(['chats', '--account', ACCOUNT, ...(kind ? ['--kind', kind] : []), '--json']);
      assert.equal(cli.code, 0, cli.stdout);
      const tool = await call('whatsapp_chats', { account: ACCOUNT, ...(kind ? { kind } : {}) });
      const ids = (data: Record<string, unknown>) => (data.chats as { id: string }[]).map((chat) => chat.id);
      assert.deepEqual(ids(tool.structuredContent), ids(cli.data()), 'the tool and the command agree');
      return ids(cli.data());
    },
    async search(words: string, ...argv: string[]) {
      const cli = await harness.cli(['search', words, '--account', ACCOUNT, ...argv, '--json']);
      assert.equal(cli.code, 0, cli.stdout);
      const args: Record<string, unknown> = { account: ACCOUNT, query: words };
      for (let i = 0; i < argv.length; i += 2) args[(argv[i] as string).replace(/^--/, '')] = argv[i + 1];
      const tool = await call('whatsapp_search', args);
      const ids = (data: Record<string, unknown>) =>
        (data.results as { message: { id: string } }[]).map((hit) => hit.message.id).sort();
      assert.deepEqual(ids(tool.structuredContent), ids(cli.data()), 'the tool and the command agree');
      return ids(cli.data());
    },
    /** A read by id: the error code and message on both surfaces, or `ok` with the message ids. */
    async read(chat: string) {
      const cli = await harness.cli(['read', chat, '--account', ACCOUNT, '--json']);
      const tool = await call('whatsapp_read', { account: ACCOUNT, chat });
      if (cli.code !== 0) {
        assert.equal(tool.isError, true, `${chat}: the tool refuses it too`);
        assert.deepEqual(tool.structuredContent.error, cli.json().error, 'the same refusal');
        return { code: cli.code, error: cli.json().error as { code: string; message: string; hint: string } };
      }
      assert.ok(!tool.isError, JSON.stringify(tool.structuredContent));
      return { code: 0, ids: (cli.data().messages as { id: string }[]).map((message) => message.id) };
    },
    /** A draft on both surfaces: with `--account`, or another account named, or (false) none. */
    async draft(to: string, withAccount: boolean | string = true) {
      const account = withAccount === true ? ACCOUNT : withAccount === false ? undefined : withAccount;
      const cli = await harness.cli(['draft', to, 'hello', ...(account ? ['--account', account] : []), '--json']);
      const tool = await call('whatsapp_draft', { ...(account ? { account } : {}), to, text: 'hello' });
      if (cli.code !== 0) {
        assert.equal(tool.isError, true, `${to}: the tool refuses it too`);
        assert.deepEqual(tool.structuredContent.error, cli.json().error);
        return { code: cli.code, error: cli.json().error as { code: string; message: string; hint: string } };
      }
      assert.ok(!tool.isError, JSON.stringify(tool.structuredContent));
      return { code: 0, links: cli.data().links };
    },
    async counts() {
      const cli = (await harness.cli(['status', '--no-check', '--json'])).data();
      const tool = (await call('whatsapp_status', { check: false })).structuredContent;
      const of = (data: Record<string, unknown>) =>
        (
          data.accounts as {
            index: { chats: number; statusChats: number; messages: number; unattributedStatus: number };
          }[]
        )[0]?.index;
      assert.deepEqual(of(tool), of(cli));
      const index = of(cli);
      return {
        chats: index?.chats,
        statusChats: index?.statusChats,
        messages: index?.messages,
        unattributedStatus: index?.unattributedStatus,
      };
    },
  };
}

async function person(harness: Harness, ...argv: string[]) {
  const result = await harness.cli([...argv, '--account', ACCOUNT, '--json']);
  assert.equal(result.code, 0, `${argv.join(' ')}: ${result.stdout}`);
  return result.data() as { allow: string[]; deny: string[] };
}

/** What a chat that does not exist gets, with its id standing in for the one asked about. */
function asIfAbsent(error: { message: string; hint: string } | undefined, id: string) {
  return error && { message: error.message.replace(NOBODY, id), hint: error.hint };
}

test('deny hides a chat from every read on both surfaces, and answers for it as for a chat that does not exist', async () => {
  const harness = await newHarness();
  await harness.ready(ACCOUNT);
  const { call, close } = await connect(harness);
  const on = surfaces(harness, call);
  try {
    const before = await on.counts();
    const lists = await person(harness, 'deny', '+1 555 555 0102');
    assert.deepEqual(lists, { ...lists, allow: [], deny: [BOB] }, 'a number is kept as its chat id');

    assert.ok(!(await on.chats()).includes(BOB));
    assert.deepEqual(await on.search('report'), ['10', '17'], 'Bob’s message is not found');
    assert.deepEqual(await on.search('Bobby'), []);
    assert.deepEqual(await on.search('report', '--chat', BOB), []);

    const absent = await on.read(NOBODY);
    const hidden = await on.read(BOB);
    assert.equal(hidden.code, 66);
    assert.equal(hidden.error?.code, 'NOT_FOUND');
    assert.deepEqual(
      { message: hidden.error?.message, hint: hidden.error?.hint },
      asIfAbsent(absent.error, BOB),
      'the refusal is word for word the one a chat that does not exist gets',
    );
    assert.equal((await on.read('+15555550102')).code, 66, 'by number too');

    for (const withAccount of [true, false]) {
      const draft = await on.draft(BOB, withAccount);
      assert.equal(draft.code, 66, `draft ${withAccount ? 'with' : 'without'} --account`);
      assert.equal(draft.error?.code, 'NOT_FOUND');
    }
    assert.equal((await on.draft(ALICE)).code, 0, 'the others are drafted to as before');

    const after = await on.counts();
    assert.equal(after.chats, (before.chats as number) - 1, 'nor is it counted');
    assert.equal(after.messages, (before.messages as number) - 1);
  } finally {
    await close();
  }
});

test('an allow list shows only the chats on it, on both surfaces', async () => {
  const harness = await newHarness();
  await harness.ready(ACCOUNT);
  const { call, close } = await connect(harness);
  const on = surfaces(harness, call);
  try {
    await person(harness, 'allow', ALICE);
    const lists = await person(harness, 'allow', GROUP);
    assert.deepEqual([lists.allow, lists.deny], [[ALICE, GROUP], []]);

    assert.deepEqual(await on.chats(), [GROUP, ALICE]);
    assert.deepEqual(await on.chats('status'), [], 'status updates of people not allowed stay hidden');
    assert.deepEqual(await on.search('invoice'), ['1', '3']);
    assert.deepEqual(await on.search('report'), ['10'], 'only the group’s');
    assert.equal((await on.read(HIDDEN)).code, 66);
    assert.equal((await on.read(ALICE)).code, 0);
    assert.equal((await on.draft(BOB)).code, 66, 'nor drafted to');
    assert.equal((await on.draft('+1 555 555 0199')).code, 66, 'not even a number that has no chat');
    assert.ok((await on.draft(ALICE)).links);
    assert.equal((await on.counts()).chats, 2);
  } finally {
    await close();
  }
});

test('deny beats allow, a number and its id are one entry, a number covers its status posts, and clear undoes', async () => {
  const harness = await newHarness();
  await harness.ready(ACCOUNT);
  const { call, close } = await connect(harness);
  const on = surfaces(harness, call);
  try {
    await person(harness, 'allow', ALICE);
    await person(harness, 'allow', GROUP);
    const byNumber = await person(harness, 'deny', '15555550101');
    const byId = await person(harness, 'deny', ALICE);
    assert.deepEqual([byNumber.deny, byId.deny], [[ALICE], [ALICE]], 'a number and its id are one entry');
    assert.deepEqual(await on.chats(), [GROUP], 'denied and allowed: denied wins');
    const lists = await person(harness, 'allow', '+1 555 555 0101');
    assert.deepEqual([lists.allow, lists.deny], [[ALICE, GROUP], []], 'allowing it again takes it off the deny list');
    assert.deepEqual(await on.chats(), [GROUP, ALICE]);

    const cleared = await person(harness, 'clear', '+15555550101');
    assert.deepEqual([cleared.allow, cleared.deny], [[GROUP], []], 'clear takes one chat off both lists');
    const empty = await person(harness, 'clear');
    assert.deepEqual([empty.allow, empty.deny], [[], []], 'and with no chat, empties both');
    assert.equal((await on.chats()).length, 6, 'everything but status updates, as before');

    // A number names the person: their own status posts go with them, and their posts in the status feed.
    assert.deepEqual(await on.chats('status'), [ERIN_STATUS, 'status@broadcast']);
    await person(harness, 'deny', '+15555550105');
    assert.deepEqual(await on.chats('status'), ['status@broadcast']);
    assert.deepEqual(await on.search('update', '--kind', 'status'), ['16']);
    await person(harness, 'deny', ALICE);
    assert.deepEqual(await on.search('update', '--kind', 'status'), [], 'Alice’s post in the status feed is hers');
    assert.deepEqual((await on.read('status@broadcast')).ids, []);
    const feed = (await harness.cli(['chats', '--account', ACCOUNT, '--kind', 'status', '--json'])).data();
    assert.equal((feed.chats as { messages: number }[])[0]?.messages, 0, 'nor is it counted in the feed');
    const pageFrom = async (before: string) =>
      (await harness.cli(['read', 'status@broadcast', '--account', ACCOUNT, '--before', before, '--json'])).json()
        .error;
    assert.deepEqual(
      await pageFrom('16'),
      JSON.parse(JSON.stringify(await pageFrom('999999')).replaceAll('999999', '16')),
      'paging from her post is refused as from a message that does not exist',
    );

    // Denying the only allowed chat hides it; it does not empty the allow list and show everything.
    await person(harness, 'clear');
    await person(harness, 'allow', GROUP);
    const denied = await person(harness, 'deny', GROUP);
    assert.deepEqual([denied.allow, denied.deny], [[GROUP], [GROUP]]);
    assert.deepEqual(await on.chats(), []);
  } finally {
    await close();
  }
});

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
    await person(harness, 'deny', '15555550101');
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
    await person(harness, 'deny', '15555550101');
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

test('a list applies at once, and the next sync leaves what it hides out of the index', async () => {
  const harness = await newHarness();
  await harness.ready(ACCOUNT);
  const { call, close } = await connect(harness);
  const on = surfaces(harness, call);
  try {
    await person(harness, 'deny', BOB);
    assert.equal((await on.read(BOB)).code, 66, 'hidden from the index already there, without a sync');
    await person(harness, 'clear');
    assert.equal((await on.read(BOB)).code, 0);

    await person(harness, 'deny', BOB);
    const synced = await harness.cli(['sync', '--account', ACCOUNT, '--json']);
    assert.equal(synced.data().chats, 5, 'the sync did not index it');
    await person(harness, 'clear');
    assert.equal((await on.read(BOB)).code, 66, 'not in the index at all: cleared, it is still not there');
    const cleared = await harness.cli(['clear', '--account', ACCOUNT]);
    assert.match(cleared.stdout, /agent-whatsapp sync --account acme\/whatsapp/, 'the person is told to sync');
    await harness.cli(['sync', '--account', ACCOUNT]);
    assert.equal((await on.read(BOB)).code, 0, 'the next sync brings it back');

    // A status post whose author is hidden is left out of the index too, though the feed it is in is not.
    await person(harness, 'deny', ALICE);
    await harness.cli(['sync', '--account', ACCOUNT]);
    await person(harness, 'clear');
    assert.deepEqual((await on.read('status@broadcast')).ids, []);
    await harness.cli(['sync', '--account', ACCOUNT]);
    assert.deepEqual((await on.read('status@broadcast')).ids, ['16']);
  } finally {
    await close();
  }
});

test('allow, deny and clear are a person’s: refused to an agent, unchanged by one, and offered by no tool', async () => {
  const harness = await newHarness({ env: { CLAUDECODE: '1' } });
  await harness.ready(ACCOUNT);
  const configPath = join(harness.configDir, 'config.json');
  const config = readFileSync(configPath);
  assert.equal(harness.listsFile(), null);
  for (const argv of [['allow', ALICE], ['deny', ALICE], ['clear'], ['clear', ALICE]]) {
    const result = await harness.cli([...argv, '--account', ACCOUNT, '--json']);
    assert.equal(result.code, 10, `${argv.join(' ')}: only a person may`);
    assert.equal(result.json().error?.code, 'LOOSENING_REFUSED');
    assert.match(String(result.json().error?.message), /only a person changes which chats an agent may see/);
    assert.match(String(result.json().error?.hint), new RegExp(`agent-whatsapp ${argv[0]}`));
  }
  assert.deepEqual(readFileSync(configPath), config, 'nothing was written');
  assert.equal(harness.listsFile(), null, 'no list was written either');

  // Nor from anywhere but the command line, marker or no marker: the operations refuse a server's context.
  const plain = await newHarness();
  await plain.ready(ACCOUNT);
  const server = plain.context({ surface: 'mcp' });
  for (const attempt of [
    () => allowChat(server, { account: ACCOUNT, chat: ALICE }),
    () => denyChat(server, { account: ACCOUNT, chat: ALICE }),
    () => clearChats(server, { account: ACCOUNT }),
  ]) {
    await assert.rejects(attempt, (error: unknown) => (error as { code?: string }).code === 'LOOSENING_REFUSED');
  }
  const cli = plain.context({ surface: 'cli' });
  assert.deepEqual((await denyChat(cli, { account: ACCOUNT, chat: ALICE })).deny, [ALICE], 'a person’s terminal may');

  const { client, close } = await connect(harness);
  try {
    const tools = (await client.listTools()).tools.map((tool) => tool.name);
    assert.ok(!tools.some((name) => /allow|deny|clear|list|hide|visib/.test(name)), tools.join(', '));
  } finally {
    await close();
  }
});
