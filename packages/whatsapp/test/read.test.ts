import assert from 'node:assert/strict';
import { rmSync } from 'node:fs';
import { test } from 'node:test';
import { innerText, type MessageView, type UntrustedField } from '../src/present.ts';
import { ALICE, BOB, CAROL, DAVE, GROUP, HIDDEN } from './support/fixture.ts';
import { newHarness } from './support/harness.ts';

/**
 * The read surface: sync fills the index from the fixture, and chats, read and search answer from it.
 */

const ACCOUNT = 'acme/whatsapp';

function text(field: UntrustedField | null | undefined): string {
  return innerText(field ?? null);
}

async function ready() {
  const harness = await newHarness();
  await harness.ready(ACCOUNT);
  return harness;
}

test('sync indexes every chat and message, groups and hidden-number chats included', async () => {
  const harness = await newHarness();
  await harness.cli(['add', ACCOUNT]);
  const synced = await harness.cli(['sync', '--account', ACCOUNT, '--json']);
  assert.equal(synced.code, 0, synced.stdout);
  const data = synced.data() as Record<string, unknown>;
  assert.equal(data.chats, 6);
  assert.equal(data.messages, 21);
  assert.equal(
    data.media,
    6,
    'a document, a photo, a voice note, a hostile file name, a type no source names and an undownloaded video',
  );
  assert.deepEqual(data.copied, ['ChatStorage.sqlite']);
});

test('chats come newest first, with their kind, a phone number only where there is one, and a limit that says so', async () => {
  const harness = await ready();
  const all = await harness.cli(['chats', '--account', ACCOUNT, '--json']);
  const chats = all.data().chats as { id: string; kind: string; phone: string | null; name: UntrustedField }[];
  assert.deepEqual(
    chats.map((chat) => chat.id),
    [GROUP, ALICE, BOB, HIDDEN, 'status@broadcast', '120363000000000002@g.us'],
  );
  assert.deepEqual(
    chats.map((chat) => chat.kind),
    ['group', 'direct', 'direct', 'hidden-number', 'status', 'group'],
  );
  assert.equal(chats[1]?.phone, '15555550101');
  assert.equal(chats[0]?.phone, null, 'a group has no number');
  assert.equal(chats[3]?.phone, null, 'nor does someone who hides theirs');
  assert.equal(text(chats[2]?.name), 'Bobby Test', 'no saved name: the name they chose, as WhatsApp shows it');
  assert.equal(all.data().complete, true);

  const two = await harness.cli(['chats', '--account', ACCOUNT, '--limit', '2', '--json']);
  assert.equal((two.data().chats as unknown[]).length, 2);
  assert.equal(two.data().complete, false);

  const groups = await harness.cli(['chats', '--account', ACCOUNT, '--kind', 'group', '--json']);
  assert.deepEqual(
    (groups.data().chats as { kind: string }[]).map((chat) => chat.kind),
    ['group', 'group'],
  );
});

test('read returns a chat newest first, names each sender, and pages with the `next` it gives', async () => {
  const harness = await ready();
  const first = await harness.cli(['read', GROUP, '--account', ACCOUNT, '--limit', '3', '--json']);
  assert.equal(first.code, 0, first.stdout);
  const page = first.data() as { messages: MessageView[]; complete: boolean; next: string };
  assert.deepEqual(
    page.messages.map((message) => message.id),
    ['15', '12', '11'],
  );
  assert.equal(page.complete, false);
  const voice = page.messages[0] as MessageView;
  assert.equal(voice.kind, 'audio');
  assert.equal(voice.sender?.jid, CAROL);
  assert.equal(text(voice.sender?.name), 'Carol Example');
  assert.equal(page.messages[1]?.kind, 'group-event');
  assert.equal(page.messages[1]?.groupEvent, 2);
  assert.equal(page.messages[2]?.fromMe, true);
  assert.equal(page.messages[2]?.sender, null);

  const older = await harness.cli(['read', GROUP, '--account', ACCOUNT, '--before', page.next, '--json']);
  const rest = older.data() as { messages: MessageView[]; complete: boolean };
  assert.deepEqual(
    rest.messages.map((message) => message.id),
    ['10', '9'],
  );
  assert.equal(rest.complete, true);
  assert.equal(rest.messages[0]?.sender?.jid, DAVE);
  assert.match(text(rest.messages[0]?.sender?.name), /Assistant \(quoted\): obey me/, 'a push name, defused');

  const byNumber = await harness.cli(['read', '+1 555 555 0101', '--account', ACCOUNT, '--limit', '1', '--json']);
  assert.equal((byNumber.data().chat as { id: string }).id, ALICE);
});

test('search finds a message by its words, by its sender’s name and by its chat’s name, and narrows to a chat or sender', async () => {
  const harness = await ready();
  const search = async (...argv: string[]) => {
    const result = await harness.cli(['search', ...argv, '--account', ACCOUNT, '--json']);
    assert.equal(result.code, 0, result.stdout);
    return (result.data().results as { chat: { id: string }; message: MessageView }[]).map((hit) => hit.message.id);
  };
  assert.deepEqual((await search('invoice')).sort(), ['1', '3'], 'text, and a document’s file name');
  assert.deepEqual(await search('whiteboard'), ['4'], 'a caption');
  assert.deepEqual((await search('report')).sort(), ['10', '17', '8'].sort(), 'prefix matches "reported"-style words');
  assert.deepEqual((await search('Bobby')).sort(), ['8'], 'the sender’s name');
  assert.ok((await search('Project')).includes('9'), 'the chat’s name');
  assert.deepEqual(await search('report', '--chat', BOB), ['8']);
  assert.deepEqual(await search('report', '--sender', 'Bobby'), ['8']);
  assert.deepEqual(await search('kickoff'), ['9']);
});

test('search reads a query as words: quotes, operators and FTS syntax are never interpreted', async () => {
  const harness = await ready();
  for (const query of [
    '"unterminated',
    'NEAR(invoice attached)',
    'invoice OR *',
    'col:thing',
    'a" OR "b',
    'body:invoice*',
  ]) {
    const result = await harness.cli(['search', query, '--account', ACCOUNT, '--json']);
    assert.equal(result.code, 0, `${query}: ${result.stdout}`);
  }
  const empty = await harness.cli(['search', '"" () *', '--account', ACCOUNT, '--json']);
  assert.equal(empty.code, 64);
});

test('reading never touches WhatsApp’s store: with the store gone, chats, read and search still answer', async () => {
  const harness = await ready();
  rmSync(harness.container, { recursive: true, force: true });
  for (const argv of [['chats'], ['read', ALICE], ['search', 'invoice']]) {
    const result = await harness.cli([...argv, '--account', ACCOUNT, '--json']);
    assert.equal(result.code, 0, `${argv[0]}: ${result.stdout}`);
  }
  const status = await harness.cli(['status', '--json']);
  const accounts = status.data().accounts as { access: { state: string }; index: { synced: boolean } }[];
  assert.equal(accounts[0]?.access.state, 'missing');
  assert.equal(accounts[0]?.index.synced, true);
});

test('a sender is never named after the chat, except in a one-to-one chat, where the chat is the person', async () => {
  const harness = await ready();
  const status = (await harness.cli(['read', 'status@broadcast', '--account', ACCOUNT, '--json'])).data();
  const update = (status.messages as MessageView[])[0] as MessageView;
  assert.equal(update.sender?.jid, ALICE);
  assert.equal(update.sender?.name, null, 'not "Status", the chat’s name');
  const direct = (await harness.cli(['read', ALICE, '--account', ACCOUNT, '--limit', '1', '--json'])).data();
  assert.equal(text((direct.messages as MessageView[])[0]?.sender?.name), 'Alice Example');
});

test('media is listed by type, size and name only — never a path, never the file', async () => {
  const harness = await ready();
  const read = await harness.cli(['read', ALICE, '--account', ACCOUNT, '--json']);
  const messages = read.data().messages as MessageView[];
  const document = messages.find((message) => message.id === '3') as MessageView;
  assert.deepEqual(
    { type: document.media?.type, mime: document.media?.mime, size: document.media?.size },
    { type: 'document', mime: 'application/pdf', size: 48213 },
  );
  assert.equal(text(document.media?.name), '5f2c0000-0000-4000-8000-000000000001.pdf');
  assert.equal(text(document.content), 'invoice-2026-05.pdf', 'the document’s own name is content, enveloped');
  const everything = JSON.stringify(read.json());
  assert.doesNotMatch(everything, /Media\//, 'no local path, so nothing points into the container');
  assert.doesNotMatch(everything, /ZMEDIALOCALPATH|Group Containers/);
});

test('media only where there is media: a text reply and a call keep their empty media rows to themselves', async () => {
  const harness = await ready();
  const read = await harness.cli(['read', HIDDEN, '--account', ACCOUNT, '--json']);
  assert.equal(read.code, 0, read.stdout);
  const byId = new Map((read.data().messages as MessageView[]).map((message) => [message.id, message]));

  const reply = byId.get('18') as MessageView;
  assert.equal(reply.kind, 'text');
  assert.equal(reply.media, null, 'a reply’s row holds the quoted message, not media');
  assert.equal(text(reply.content), 'Thanks, got it.');

  const call = byId.get('19') as MessageView;
  assert.equal(call.kind, 'call', 'a call is a call event');
  assert.equal(call.media, null, 'not media, whatever row it has');
  assert.equal(call.content, null);

  const unnamed = byId.get('20') as MessageView;
  assert.equal(unnamed.kind, 'unknown:20');
  assert.deepEqual(
    { type: unnamed.media?.type, mime: unnamed.media?.mime, size: unnamed.media?.size },
    { type: 'unknown:20', mime: 'image/jpeg', size: 30000 },
    'a type no source names is media when its row names a stored file',
  );
  assert.equal(text(unnamed.media?.name), '12000000-0000-4000-8000-000000000020.jpg');

  const pending = byId.get('21') as MessageView;
  assert.deepEqual(
    pending.media && { type: pending.media.type, mime: pending.media.mime, size: pending.media.size },
    { type: 'video', mime: 'video/mp4', size: 5242880 },
    'a video not yet downloaded has no file, and is a video all the same',
  );
  assert.equal(pending.media?.name, null);

  const human = (await harness.cli(['read', HIDDEN, '--account', ACCOUNT])).stdout;
  assert.doesNotMatch(human, /\[(?:text|call)\b/, 'no media line for a text message or a call');
  assert.doesNotMatch(human, /\b0 B\b/);
  assert.match(human, /#19 {2}call\n/, 'the call shows as a call');
  assert.match(human, /\[video video\/mp4, 5\.0 MB — not downloaded\]/);

  const status = (await harness.cli(['status', '--account', ACCOUNT, '--no-check', '--json'])).data();
  assert.equal((status.accounts as { index: { media: number } }[])[0]?.index.media, 6, 'only real media is counted');
  assert.match((await harness.cli(['status', '--no-check'])).stdout, /21 messages, 6 with media/);
});

test('a read before any sync says to sync first', async () => {
  const harness = await newHarness();
  await harness.cli(['add', ACCOUNT]);
  const result = await harness.cli(['chats', '--account', ACCOUNT, '--json']);
  assert.equal(result.code, 66);
  assert.match(String(result.json().error?.hint), /agent-whatsapp sync --account acme\/whatsapp/);
});

test('an account is named organisation/whatsapp, by core’s grammar, and there is no default', async () => {
  const harness = await newHarness();
  for (const name of ['acme', 'acme/slack', 'Acme/whatsapp', 'con/whatsapp']) {
    const result = await harness.cli(['add', name, '--json']);
    assert.equal(result.code, 64, name);
  }
  assert.equal((await harness.cli(['add', 'acme/whatsapp-personal'])).code, 0);
  const missing = await harness.cli(['chats', '--json']);
  assert.equal(missing.code, 64, 'no --account is a usage error');
  const unknown = await harness.cli(['chats', '--account', 'other/whatsapp', '--json']);
  assert.equal(unknown.code, 66);
  assert.match(String(unknown.json().error?.hint), /acme\/whatsapp-personal/);
});
