import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Client } from '@modelcontextprotocol/client';
import { InMemoryTransport } from '@modelcontextprotocol/server';
import { createWhatsAppMcpServer } from '../src/mcp/server.ts';
import { composeDraft } from '../src/operations/draft.ts';
import { ALICE, BOB, BROADCAST_LIST, ERIN_STATUS, GROUP, HIDDEN, HOSTILE_GROUP } from './support/fixture.ts';
import { newHarness } from './support/harness.ts';

/**
 * Sending is the person's: a draft is text and a link that opens WhatsApp with it filled in. Nothing here sends, and
 * only a person — never an agent — opens the link on the screen.
 */

test('a draft to a number returns a whatsapp:// link and a wa.me link with the text encoded, and says nothing was sent', () => {
  const draft = composeDraft({ to: '+1 (555) 555-0101', text: 'On my way — 10 min & counting?\nSee you' });
  assert.deepEqual(draft.to, { chat: '15555550101@s.whatsapp.net', phone: '15555550101', kind: 'phone' });
  const encoded = encodeURIComponent('On my way — 10 min & counting?\nSee you');
  assert.deepEqual(draft.links, {
    app: `whatsapp://send?phone=15555550101&text=${encoded}`,
    web: `https://wa.me/15555550101?text=${encoded}`,
  });
  assert.equal(new URL(draft.links?.web as string).searchParams.get('text'), 'On my way — 10 min & counting?\nSee you');
  assert.equal(draft.sent, false);
  assert.equal(draft.pasteInstead, false);
  assert.match(draft.note, /Nothing was sent/);
  assert.match(draft.note, /you press send/);
});

test('a draft to a group, or to someone who hides their number, returns the text to paste — no link can target it', () => {
  for (const to of [GROUP, HIDDEN]) {
    const draft = composeDraft({ to, text: 'hello' });
    assert.equal(draft.links, null, to);
    assert.equal(draft.pasteInstead, true);
    assert.equal(draft.text, 'hello');
    assert.match(draft.reason ?? '', to === GROUP ? /A group has no number/ : /no phone number/);
    assert.equal(draft.sent, false);
  }
});

test('a draft with hidden or control characters is refused, so what the person reads is what would go out', () => {
  for (const text of ['pay \u202Eevil', 'hi\u200Bthere', 'tag\u{E0041}\u{E0042}', 'bell\u0007']) {
    assert.throws(
      () => composeDraft({ to: '+15555550101', text }),
      (error: unknown) => (error as { code?: string }).code === 'BAD_DATA' && /hidden or control/.test(String(error)),
    );
  }
  // Newlines and tabs are ordinary text.
  assert.ok(composeDraft({ to: '+15555550101', text: 'line one\n\tline two' }).links);
});

test('a number that is not a phone number, an empty draft and an overlong one are refused', () => {
  for (const to of ['12', 'call me', '+1555abc0101', '1234567890123456', 'x@g.us/../']) {
    assert.throws(
      () => composeDraft({ to, text: 'hi' }),
      (error: unknown) => (error as { code?: string }).code === 'USAGE',
      to,
    );
  }
  assert.throws(() => composeDraft({ to: '+15555550101', text: '   ' }), /empty/);
  assert.throws(() => composeDraft({ to: '+15555550101', text: 'x'.repeat(4097) }), /longer than/);
});

test('--open opens the app link for a person, is refused to an agent, and nothing opens without it', async () => {
  const opened: string[] = [];
  const open = (url: string) => {
    opened.push(url);
    return true;
  };
  const person = await newHarness({ store: false });
  const shown = await person.cli(['draft', '+15555550101', 'On my way', '--json'], { open });
  assert.equal(shown.code, 0);
  assert.deepEqual(opened, [], 'no --open, nothing opened');
  assert.equal(shown.data().opened, false);

  const opening = await person.cli(['draft', '+15555550101', 'On my way', '--open', '--json'], { open });
  assert.equal(opening.code, 0);
  assert.deepEqual(opened, ['whatsapp://send?phone=15555550101&text=On%20my%20way']);
  assert.equal(opening.data().opened, true);
  assert.equal(opening.data().sent, false);

  const agent = await newHarness({ store: false, env: { CLAUDECODE: '1' } });
  const refused = await agent.cli(['draft', '+15555550101', 'On my way', '--open', '--json'], { open });
  assert.equal(refused.code, 10, 'only a person may');
  assert.match(String(refused.json().error?.message), /only a person opens a draft/);
  assert.equal(opened.length, 1, 'the agent opened nothing');

  const group = await person.cli(['draft', GROUP, 'hello', '--open', '--json'], { open });
  assert.equal(group.code, 64);
  assert.equal(opened.length, 1);
});

test('the MCP draft tool returns the link and never opens anything', async () => {
  const harness = await newHarness({ store: false });
  const { server } = await createWhatsAppMcpServer({ env: harness.env });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 'test', version: '0' });
  await Promise.all([client.connect(clientTransport), server.connect(serverTransport)]);
  try {
    const result = (await client.callTool({
      name: 'whatsapp_draft',
      arguments: { to: '+15555550101', text: 'hi' },
    })) as {
      structuredContent: Record<string, unknown>;
    };
    assert.equal(result.structuredContent.opened, false);
    assert.equal(result.structuredContent.sent, false);
    assert.equal((result.structuredContent.links as { web: string }).web, 'https://wa.me/15555550101?text=hi');
    const tool = (await client.listTools()).tools.find((entry) => entry.name === 'whatsapp_draft');
    assert.match(tool?.description ?? '', /sends nothing and opens nothing/);
  } finally {
    await Promise.all([client.close(), server.close()]);
  }
});

test('draft takes the chat ids chats prints, with --account, on both surfaces — a number’s id becomes a link, the rest text to paste', async () => {
  const account = 'acme/whatsapp';
  const harness = await newHarness();
  await harness.ready(account);
  // The ids exactly as a person sees them: the line under each chat in `chats`.
  const human = (await harness.cli(['chats', '--account', account])).stdout;
  const printed = [...human.matchAll(/^ {2}(\S+@\S+)$/gm)].map((match) => match[1] as string);
  assert.deepEqual(printed.sort(), [ALICE, BOB, GROUP, HIDDEN, BROADCAST_LIST, HOSTILE_GROUP].sort());
  const { server } = await createWhatsAppMcpServer({ env: harness.env });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 'test', version: '0' });
  await Promise.all([client.connect(clientTransport), server.connect(serverTransport)]);
  try {
    const reasons: Record<string, RegExp> = {
      [GROUP]: /A group has no number/,
      [HOSTILE_GROUP]: /A group has no number/,
      [HIDDEN]: /no phone number/,
      [BROADCAST_LIST]: /A broadcast list has no number/,
    };
    for (const id of printed) {
      const cli = await harness.cli(['draft', id, 'On my way', '--account', account, '--json']);
      assert.equal(cli.code, 0, `${id}: ${cli.stdout}`);
      const tool = (await client.callTool({
        name: 'whatsapp_draft',
        arguments: { account, to: id, text: 'On my way' },
      })) as { isError?: boolean; structuredContent: Record<string, unknown> };
      assert.ok(!tool.isError, `${id}: ${JSON.stringify(tool.structuredContent)}`);
      assert.deepEqual(tool.structuredContent, cli.data(), `${id}: the command and the tool agree`);
      const draft = cli.data() as { to: { chat: string; phone: string | null }; links: unknown; reason?: string };
      assert.equal(draft.to.chat, id);
      const phone = /^(\d+)@s\.whatsapp\.net$/.exec(id)?.[1] ?? null;
      assert.equal(draft.to.phone, phone, id);
      if (phone) {
        assert.deepEqual(draft.links, {
          app: `whatsapp://send?phone=${phone}&text=On%20my%20way`,
          web: `https://wa.me/${phone}?text=On%20my%20way`,
        });
      } else {
        assert.equal(draft.links, null, id);
        assert.match(draft.reason ?? '', reasons[id] as RegExp, id);
      }
    }

    // A status update is not a chat anyone writes to: refused, by name, on both surfaces.
    for (const id of [ERIN_STATUS, 'status@broadcast']) {
      const cli = await harness.cli(['draft', id, 'nice', '--account', account, '--json']);
      assert.equal(cli.code, 64, `${id}: ${cli.stdout}`);
      assert.match(String(cli.json().error?.message), /status update/);
      const tool = (await client.callTool({ name: 'whatsapp_draft', arguments: { to: id, text: 'nice' } })) as {
        isError?: boolean;
        structuredContent: { error: { code: string; hint: string } };
      };
      assert.equal(tool.isError, true);
      assert.equal(tool.structuredContent.error.code, 'USAGE');
    }
    const erin = await harness.cli(['draft', ERIN_STATUS, 'nice', '--json']);
    assert.match(String(erin.json().error?.hint), /\+15555550105/, 'the author’s own chat is named instead');

    const unknown = await harness.cli(['draft', ALICE, 'hi', '--account', 'other/whatsapp', '--json']);
    assert.equal(unknown.code, 66, 'an account that does not exist is not quietly ignored');
    const unknownTool = (await client.callTool({
      name: 'whatsapp_draft',
      arguments: { account: 'other/whatsapp', to: ALICE, text: 'hi' },
    })) as { isError?: boolean; structuredContent: { error: { code: string } } };
    assert.equal(unknownTool.isError, true);
    assert.equal(unknownTool.structuredContent.error.code, 'NOT_FOUND', 'nor by the tool');
  } finally {
    await Promise.all([client.close(), server.close()]);
  }
});
