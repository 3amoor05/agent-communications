import assert from 'node:assert/strict';
import { Client } from '@modelcontextprotocol/client';
import { InMemoryTransport } from '@modelcontextprotocol/server';
import { createWhatsAppMcpServer } from '../../src/mcp/server.ts';
import type { Harness } from './harness.ts';

/**
 * Reading through both surfaces at once — the command and its tool — reduced to what a person's lists decide: which
 * chats and messages come back, and what a refusal says. Each call asserts the two surfaces agree.
 */

export const ACCOUNT = 'acme/whatsapp';

/** What a tool call returns, as these tests read it. */
export interface ToolResult {
  isError?: boolean;
  structuredContent: Record<string, unknown> & { error?: { code: string; message: string; hint: string | null } };
}

export type Call = (name: string, args: Record<string, unknown>) => Promise<ToolResult>;

/** A refusal, as both surfaces give it. */
export interface Refusal {
  code: string;
  message: string;
  hint: string;
}

export interface Surfaces {
  chats(kind?: string): Promise<string[]>;
  search(words: string, ...argv: string[]): Promise<string[]>;
  read(chat: string): Promise<{ code: number; error?: Refusal; ids?: string[] }>;
  draft(to: string, withAccount?: boolean | string): Promise<{ code: number; error?: Refusal; links?: unknown }>;
  counts(): Promise<{
    chats: number | undefined;
    statusChats: number | undefined;
    messages: number | undefined;
    unattributedStatus: number | undefined;
  }>;
}
/** A number with no chat in the fixture. */
export const NOBODY = '15555550199@s.whatsapp.net';

export async function connect(
  harness: Harness,
): Promise<{ client: Client; call: Call; close: () => Promise<unknown> }> {
  const { server } = await createWhatsAppMcpServer({ env: harness.env, platform: 'darwin' });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 'test', version: '0' });
  await Promise.all([client.connect(clientTransport), server.connect(serverTransport)]);
  const call: Call = async (name, args) => (await client.callTool({ name, arguments: args })) as ToolResult;
  return { client, call, close: () => Promise.all([client.close(), server.close()]) };
}

export function surfaces(harness: Harness, call: Call): Surfaces {
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
        return { code: cli.code, error: cli.json().error as unknown as Refusal };
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
        return { code: cli.code, error: cli.json().error as unknown as Refusal };
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

/** One of the person's list commands, at their terminal, which must succeed. */
export async function person(harness: Harness, ...argv: string[]): Promise<{ allow: string[]; deny: string[] }> {
  const result = await harness.cli([...argv, '--account', ACCOUNT, '--json']);
  assert.equal(result.code, 0, `${argv.join(' ')}: ${result.stdout}`);
  return result.data() as { allow: string[]; deny: string[] };
}

/** What a chat that does not exist gets, with its id standing in for the one asked about. */
export function asIfAbsent(
  error: { message: string; hint: string } | undefined,
  id: string,
): { message: string; hint: string } | undefined {
  return error && { message: error.message.replace(NOBODY, id), hint: error.hint };
}
