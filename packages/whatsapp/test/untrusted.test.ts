import assert from 'node:assert/strict';
import { test } from 'node:test';
import { UNTRUSTED_TAG } from '@agentcomms/core';
import type { ChatView, MessageView, UntrustedField } from '../src/present.ts';
import { ALICE, HOSTILE, HOSTILE_GROUP } from './support/fixture.ts';
import { newHarness } from './support/harness.ts';

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
