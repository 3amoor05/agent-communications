import assert from 'node:assert/strict';
import { test } from 'node:test';
import { UNTRUSTED_TAG } from '@agentcomms/core';
import { renderChats } from '../src/cli/render.ts';
import type { ChatView, MessageView, UntrustedField } from '../src/present.ts';
import { ALICE, addMessages, addRows, type Fixture, HOSTILE, HOSTILE_GROUP, message } from './support/fixture.ts';
import { type CliRun, newHarness } from './support/harness.ts';

/**
 * Everything a contact controls reaches a model only inside core's untrusted-content envelope: message text, a
 * caption, a file name, a sender's name, a group's subject. Hostile strings are defused inside it, and hidden
 * characters are both removed and reported.
 */

const ACCOUNT = 'acme/whatsapp';
const OPEN = new RegExp(`^<${UNTRUSTED_TAG} boundary="([A-Za-z0-9_-]+)" field="([a-z-]+)" inbox="acme/whatsapp"`);

function assertEnveloped(field: UntrustedField | null | undefined, kind: string, boundary: string): string {
  assert.ok(field, `${kind} is present`);
  const lines = field.enveloped.split('\n');
  const open = OPEN.exec(lines[0] ?? '');
  assert.ok(open, `${kind} opens an envelope: ${lines[0]}`);
  assert.equal(open[1], boundary, 'one boundary for the whole response');
  assert.equal(open[2], kind);
  assert.equal(lines.at(-1), `</${UNTRUSTED_TAG} boundary="${boundary}">`);
  const inner = lines.slice(1, -1).join('\n');
  // Nothing inside can close the envelope, whatever the sender wrote.
  assert.doesNotMatch(inner, new RegExp(`</${UNTRUSTED_TAG}`));
  return inner;
}

function boundaryOf(field: UntrustedField): string {
  return OPEN.exec(field.enveloped)?.[1] as string;
}

test('every body, caption, sender name, group name and file name comes back inside the envelope — and only there', async () => {
  const harness = await newHarness();
  await harness.ready(ACCOUNT);

  const chats = (await harness.cli(['chats', '--account', ACCOUNT, '--json'])).data().chats as ChatView[];
  const boundary = boundaryOf(chats[0]?.name as UntrustedField);
  for (const chat of chats) {
    assertEnveloped(chat.name, chat.kind === 'group' ? 'group-name' : 'chat-name', boundary);
  }

  const read = (await harness.cli(['read', ALICE, '--account', ACCOUNT, '--json'])).data();
  const messages = read.messages as MessageView[];
  // The newest is a deleted message, which has no text: take the boundary from the first that has.
  const one = boundaryOf(messages.find((message) => message.content)?.content as UntrustedField);
  assert.equal(messages[0]?.kind, 'deleted');
  assert.equal(messages[0]?.content, null);
  for (const message of messages) {
    if (message.content) assertEnveloped(message.content, 'message', one);
    if (message.sender?.name) assertEnveloped(message.sender.name, 'sender-name', one);
    if (message.media?.name) assertEnveloped(message.media.name, 'file-name', one);
  }
  const photo = messages.find((message) => message.id === '4') as MessageView;
  assert.equal(assertEnveloped(photo.content, 'message', one), 'photo of the whiteboard');

  // The raw strings never appear outside an envelope: strip every envelope, and none of them is left.
  const outside = JSON.stringify(read).replace(
    /<untrusted-content[\s\S]*?<\/untrusted-content boundary=\\"[^"\\]+\\">/g,
    '',
  );
  for (const raw of ['Lunch on Thursday', 'whiteboard', 'Alice Example', 'invoice-2026-05']) {
    assert.ok(!outside.includes(raw), `"${raw}" appears outside an envelope`);
  }
});

test('an envelope-shaped closing tag, chat-template tokens and role markers in a message are defused and counted', async () => {
  const harness = await newHarness();
  await harness.ready(ACCOUNT);
  const read = (await harness.cli(['read', ALICE, '--account', ACCOUNT, '--json'])).data();
  const hostile = (read.messages as MessageView[]).find((message) => message.id === '5') as MessageView;
  const inner = assertEnveloped(hostile.content, 'message', boundaryOf(hostile.content as UntrustedField));
  assert.match(inner, /&lt;\/untrusted-content/);
  assert.match(inner, /\[control token removed\]/);
  assert.match(inner, /Human \(quoted\):/);
  assert.equal(hostile.tokensNeutralised, 3);

  const group = (await harness.cli(['read', HOSTILE_GROUP, '--account', ACCOUNT, '--json'])).data();
  const name = (group.chat as ChatView).name as UntrustedField;
  const subject = assertEnveloped(name, 'group-name', boundaryOf(name));
  assert.match(subject, /&lt;\/untrusted-content>/);
  assert.equal(name.hidden.bidi, true, 'a group subject with a bidi override is flagged');
  const document = (group.messages as MessageView[])[0] as MessageView;
  assert.match(assertEnveloped(document.content, 'message', boundaryOf(name)), /report&lt;\/untrusted-content>\.pdf/);
  assert.ok(document.tokensNeutralised >= 1);
  assert.ok(!JSON.stringify(group).includes(HOSTILE.fileName), 'the raw file name is nowhere in the result');
});

test('bidi overrides and zero-width characters are removed from the text and flagged on the message', async () => {
  const harness = await newHarness();
  await harness.ready(ACCOUNT);
  const read = (await harness.cli(['read', ALICE, '--account', ACCOUNT, '--json'])).data();
  const message = (read.messages as MessageView[]).find((row) => row.id === '6') as MessageView;
  const inner = assertEnveloped(message.content, 'message', boundaryOf(message.content as UntrustedField));
  assert.equal(inner, 'Pay yrrab now please');
  assert.deepEqual(message.hidden, { characters: 3, bidi: true });
  assert.deepEqual(message.content?.hidden, { characters: 3, bidi: true });
  assert.equal(message.tokensNeutralised, 0, 'hidden characters are counted once, as hidden');

  const clean = (read.messages as MessageView[]).find((row) => row.id === '1') as MessageView;
  assert.deepEqual(clean.hidden, { characters: 0, bidi: false });

  const human = await harness.cli(['read', ALICE, '--account', ACCOUNT]);
  assert.match(human.stdout, /3 hidden character\(s\), bidi/);
  assert.doesNotMatch(human.stdout, /[\u202A-\u202E\u200B]/, 'a terminal never receives them');
});

test('links in a body are reported by domain with core’s flags, and never outside the envelope', async () => {
  const harness = await newHarness();
  await harness.ready(ACCOUNT);
  const read = (await harness.cli(['read', ALICE, '--account', ACCOUNT, '--json'])).data();
  const message = (read.messages as MessageView[]).find((row) => row.id === '7') as MessageView;
  assert.deepEqual(message.links, [
    { domain: 'xn--pple-43d.test', flags: ['punycode'] },
    { domain: 'bit.ly', flags: ['shortener'] },
  ]);
  assert.equal(message.kind, 'link');
});

test('an id from the store that is not in WhatsApp’s form never reaches output: its chat is left out and said to be, a sender’s is dropped', async () => {
  const ESC = '\u001b';
  const harness = await newHarness();
  const fixture = harness.fixture as Fixture;
  await addRows(fixture, 'ZWACHATSESSION', [
    { Z_PK: 20, ZCONTACTJID: `1203630000000009${ESC}[2J@g.us`, ZPARTNERNAME: null, ZSESSIONTYPE: 1 },
    { Z_PK: 21, ZCONTACTJID: '120363000000000021@g.us', ZPARTNERNAME: null, ZSESSIONTYPE: 1 },
  ]);
  await addRows(fixture, 'ZWAGROUPMEMBER', [
    { Z_PK: 30, ZCHATSESSION: 21, ZMEMBERJID: `1555${ESC}]52;c;eA==@s.whatsapp.net` },
  ]);
  await addMessages(fixture, [
    message(40, 20, 800000500, 0, 'weirdly addressed'),
    message(41, 21, 800000501, 0, 'oddly sent', { ZGROUPMEMBER: 30 }),
    message(42, 21, 800000502, 0, 'oddly from', { ZFROMJID: `x${ESC}[1A@s.whatsapp.net` }),
  ]);
  await harness.ready(ACCOUNT);
  const again = await harness.cli(['sync', '--account', ACCOUNT, '--json']);
  const degraded = again.data().degraded as { part: string; costs: string }[];
  assert.ok(
    degraded.some((entry) => /chat ids/.test(entry.part) && /1 chat/.test(entry.costs)),
    JSON.stringify(degraded),
  );
  assert.match((await harness.cli(['sync', '--account', ACCOUNT])).stdout, /1 chat\(s\) .*left out/);

  const everything = [
    await harness.cli(['chats', '--account', ACCOUNT, '--limit', '500', '--json']),
    await harness.cli(['chats', '--account', ACCOUNT, '--limit', '500']),
    await harness.cli(['read', '120363000000000021@g.us', '--account', ACCOUNT, '--json']),
    await harness.cli(['read', '120363000000000021@g.us', '--account', ACCOUNT]),
    await harness.cli(['search', 'weirdly', '--account', ACCOUNT, '--json']),
    await harness.cli(['status', '--no-check']),
  ];
  for (const output of everything) assert.ok(!output.stdout.includes(ESC), output.stdout);
  const read = everything[2]?.data().messages as MessageView[];
  assert.deepEqual(
    read.map((entry) => [entry.id, entry.sender?.jid ?? null]),
    [
      ['42', null],
      ['41', null],
    ],
    'the messages are kept, from nobody that can be named',
  );
  const found = (everything[4] as CliRun).data().results as unknown[];
  assert.equal(found.length, 0, 'the chat is not in the index at all');
});

test('an id printed in place of a name is escaped on its way to the terminal, whatever reached the index', () => {
  const id = '1203630000000009\u001b[2J@g.us';
  const text = renderChats(
    {
      account: ACCOUNT,
      indexedAt: '2026-09-26T00:00:00.000Z',
      chats: [{ id, kind: 'group', phone: null, name: null, lastMessageAt: null, messages: 0 }],
      complete: true,
    },
    false,
  );
  assert.ok(!text.includes('\u001b'), text);
});
