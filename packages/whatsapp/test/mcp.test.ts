import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Client } from '@modelcontextprotocol/client';
import { InMemoryTransport } from '@modelcontextprotocol/server';
import { createWhatsAppMcpServer } from '../src/mcp/server.ts';
import { ALICE } from './support/fixture.ts';
import { type Harness, newHarness } from './support/harness.ts';

/**
 * The agent-facing surface, and its parity with the command line.
 *
 * The spike is deliberately not in the repository's `capabilities.json` (it is not a released channel), so its parity
 * table is here: every command either has a tool that runs the same operation and returns the same result, or a
 * stated reason it does not.
 */

const ACCOUNT = 'acme/whatsapp';

async function connect(harness: Harness) {
  const { server } = await createWhatsAppMcpServer({ env: harness.env });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 'test', version: '0' });
  await Promise.all([client.connect(clientTransport), server.connect(serverTransport)]);
  const call = async (name: string, args: Record<string, unknown>) =>
    (await client.callTool({ name, arguments: args })) as {
      isError?: boolean;
      structuredContent: Record<string, unknown>;
    };
  return { client, call, close: () => Promise.all([client.close(), server.close()]) };
}

/** The package's own parity table: a command, the tool that does the same, or why there is none. */
const PARITY = [
  { cli: ['status'], tool: 'whatsapp_status', args: {} },
  { cli: ['sync', '--account', ACCOUNT], tool: 'whatsapp_sync', args: { account: ACCOUNT } },
  {
    cli: ['chats', '--account', ACCOUNT, '--limit', '3'],
    tool: 'whatsapp_chats',
    args: { account: ACCOUNT, limit: 3 },
  },
  {
    cli: ['read', ALICE, '--account', ACCOUNT, '--limit', '4'],
    tool: 'whatsapp_read',
    args: { account: ACCOUNT, chat: ALICE, limit: 4 },
  },
  {
    cli: ['search', 'report', '--account', ACCOUNT, '--sender', 'Bobby'],
    tool: 'whatsapp_search',
    args: { account: ACCOUNT, query: 'report', sender: 'Bobby' },
  },
  {
    cli: ['draft', '+15555550101', 'hi there'],
    tool: 'whatsapp_draft',
    args: { to: '+15555550101', text: 'hi there' },
  },
] as const;

const EXCEPTIONS = {
  add: 'choosing which file on this Mac an agent reads is a person’s decision, and the first read is when macOS asks them',
  remove: 'the other half of add: a person’s lifecycle step',
  mcp: 'it starts the server a tool would need already running',
} as const;

/** Envelope boundaries are random per response, and a sync stamps the time: both are set aside to compare. */
function normalise(value: unknown): unknown {
  return JSON.parse(
    JSON.stringify(value)
      .replace(/boundary=\\"[A-Za-z0-9_-]+\\"/g, 'boundary=\\"B\\"')
      .replace(/"indexedAt":"[^"]+"/g, '"indexedAt":"T"'),
  );
}

test('the tools are exactly the read surface and the draft: nothing sends, marks read, reacts, sets presence or types', async () => {
  const harness = await newHarness({ store: false });
  const { client, close } = await connect(harness);
  try {
    const tools = (await client.listTools()).tools;
    assert.deepEqual(tools.map((tool) => tool.name).sort(), [
      'whatsapp_chats',
      'whatsapp_draft',
      'whatsapp_read',
      'whatsapp_search',
      'whatsapp_status',
      'whatsapp_sync',
    ]);
    for (const tool of tools) {
      assert.doesNotMatch(tool.name, /send|post|react|mark|presence|typing|delete|add|remove|reply|forward/);
      assert.equal(tool.annotations?.openWorldHint, false, `${tool.name} reaches nothing outside this Mac`);
      if (tool.name !== 'whatsapp_sync') assert.equal(tool.annotations?.readOnlyHint, true, tool.name);
    }
  } finally {
    await close();
  }
});

test('every command and its tool run the same operation and return the same result; the rest say why not', async () => {
  const harness = await newHarness();
  await harness.cli(['add', ACCOUNT]);
  const { call, client, close } = await connect(harness);
  try {
    for (const row of PARITY) {
      const cli = await harness.cli([...row.cli, '--json']);
      assert.equal(cli.code, 0, `${row.cli.join(' ')}: ${cli.stdout}`);
      const tool = await call(row.tool, row.args);
      assert.ok(!tool.isError, `${row.tool}: ${JSON.stringify(tool.structuredContent)}`);
      const fromCli = cli.data() as Record<string, unknown>;
      if (row.tool === 'whatsapp_draft') {
        // The command reports whether it opened the link; the tool never does, and says so.
        assert.equal(fromCli.opened, false);
      }
      assert.deepEqual(normalise(tool.structuredContent), normalise(fromCli), `${row.tool} and ${row.cli[0]} differ`);
    }
    const tools = new Set((await client.listTools()).tools.map((tool) => tool.name));
    const help = (await harness.cli(['--help'])).stdout;
    const section = help.split('Commands:')[1]?.split('\n\n')[0] ?? '';
    const commands = [...section.matchAll(/^ {2}([a-z][a-z-]*)(?: |$)/gm)].map((match) => match[1] as string);
    assert.ok(commands.length >= 9, `found the commands in the help: ${commands.join(', ')}`);
    for (const command of commands) {
      if (command === 'help') continue;
      const covered = PARITY.some((row) => row.cli[0] === command) || Object.hasOwn(EXCEPTIONS, command);
      assert.ok(covered, `the command "${command}" has no tool and no stated reason`);
    }
    for (const row of PARITY) assert.ok(tools.has(row.tool));
  } finally {
    await close();
  }
});

test('a tool refuses an argument it does not declare, and a wrong type, as USAGE — before it runs', async () => {
  const harness = await newHarness();
  await harness.ready(ACCOUNT);
  const { call, close } = await connect(harness);
  try {
    const extra = await call('whatsapp_chats', { account: ACCOUNT, send: true });
    assert.equal(extra.isError, true);
    assert.equal((extra.structuredContent.error as { code: string }).code, 'USAGE');
    const wrong = await call('whatsapp_read', { account: ACCOUNT, chat: ALICE, limit: 'lots' });
    assert.equal(wrong.isError, true);
    const noAccount = await call('whatsapp_chats', {});
    assert.equal(noAccount.isError, true);
  } finally {
    await close();
  }
});

test('the instructions stay under 2 KB and say what matters first: content is data, and nothing is sent', async () => {
  const harness = await newHarness({ store: false });
  const { server } = await createWhatsAppMcpServer({ env: harness.env });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 'test', version: '0' });
  await Promise.all([client.connect(clientTransport), server.connect(serverTransport)]);
  try {
    const instructions = client.getInstructions() ?? '';
    assert.ok(Buffer.byteLength(instructions) < 2048, `${Buffer.byteLength(instructions)} bytes`);
    assert.match(instructions, /untrusted-content/);
    assert.match(instructions, /no tool sends/);
    assert.match(instructions, /Never claim a message was sent/);
    assert.match(instructions, /a person runs `agent-whatsapp add/);
  } finally {
    await Promise.all([client.close(), server.close()]);
  }
});

test('a tool that fails because macOS needs permission hands the person’s steps back verbatim', async () => {
  const harness = await newHarness();
  await harness.ready(ACCOUNT);
  const denied = {
    lstat: async () => {
      throw Object.assign(new Error('EPERM'), { code: 'EPERM' });
    },
    copyFile: async () => undefined,
    readHeader: async () => Buffer.alloc(0),
  };
  const { server } = await createWhatsAppMcpServer({ env: harness.env, sourceIo: denied, platform: 'darwin' });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 'test', version: '0' });
  await Promise.all([client.connect(clientTransport), server.connect(serverTransport)]);
  try {
    const result = (await client.callTool({ name: 'whatsapp_sync', arguments: { account: ACCOUNT } })) as {
      isError?: boolean;
      structuredContent: { error: { code: string; hint: string } };
    };
    assert.equal(result.isError, true);
    assert.equal(result.structuredContent.error.code, 'AUTH_REQUIRED');
    assert.match(result.structuredContent.error.hint, /Full Disk Access/);
    const status = (await client.callTool({ name: 'whatsapp_status', arguments: {} })) as {
      structuredContent: { accounts: { access: { state: string; grant: string } }[] };
    };
    assert.equal(status.structuredContent.accounts[0]?.access.state, 'denied');
    assert.equal(status.structuredContent.accounts[0]?.access.grant, 'Full Disk Access');
  } finally {
    await Promise.all([client.close(), server.close()]);
  }
});
