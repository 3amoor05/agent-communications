import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { type TestContext, test } from 'node:test';
import {
  type ApprovalStore,
  type AuditRecord,
  asV2,
  CommsError,
  type Core,
  openCore,
  withFileLock,
} from '@agentcomms/core';
import { Client } from '@modelcontextprotocol/client';
import { InMemoryTransport } from '@modelcontextprotocol/server';
import { GMAIL_CALLER } from '../src/caller.ts';
import { GmailContext } from '../src/context.ts';
import type { GmailTransport, RawMessage } from '../src/gmail-api/transport.ts';
import { createGmailMcpServer } from '../src/mcp/server.ts';
import { type DownloadQuestion, type DownloadResult, downloadAttachments } from '../src/operations/attachments.ts';
import { tempDir } from './support/harness.ts';

/**
 * A call cancelled from the MCP client: `gmail_attachment_download` (CUE-397).
 *
 * The SDK aborts a request's signal when its client sends `notifications/cancelled`. The download already accepts a
 * signal, both while it claims the person's answer and while it reads Gmail's bytes; these tests hold the MCP adapter
 * to passing that signal through. A file saved in full before cancellation stays, the file in flight leaves no part
 * behind, and nothing after it is fetched.
 */

interface ToolResult {
  isError?: boolean;
  structuredContent?: Record<string, unknown>;
}

function message(id: string, attachmentId: string): RawMessage {
  const filename = `${id}.pdf`;
  return {
    id,
    threadId: id,
    labelIds: ['INBOX'],
    internalDate: String(Date.parse('2026-09-15T09:00:00Z')),
    payload: {
      partId: '',
      mimeType: 'multipart/mixed',
      headers: [
        { name: 'From', value: 'sam@partner.test' },
        { name: 'Subject', value: `Attachment ${id}` },
      ],
      parts: [
        { partId: '0', mimeType: 'text/plain', body: { size: 2, data: Buffer.from('hi').toString('base64url') } },
        {
          partId: '1',
          mimeType: 'application/pdf',
          filename,
          headers: [{ name: 'Content-Disposition', value: `attachment; filename="${filename}"` }],
          body: { size: 16, attachmentId },
        },
      ],
    },
  };
}

interface World {
  core: Core;
  env: NodeJS.ProcessEnv;
  home: string;
  cwd: string;
  fetched: string[];
  transport: GmailTransport;
  context: GmailContext;
}

function downloadWorld(): World {
  const messages = {
    m1: message('m1', 'a1'),
    m2: message('m2', 'a2'),
    m3: message('m3', 'a3'),
  };
  const attachments = { a1: 'first file whole', a2: 'second file bytes', a3: 'third file bytes' };
  const configDir = tempDir('agent-gmail-cancel-config-');
  const home = tempDir('agent-gmail-cancel-home-');
  const env = {
    AGENT_COMMS_CONFIG_DIR: configDir,
    AGENT_COMMS_UPDATE_CHECK: 'off',
    HOME: home,
    USERPROFILE: home,
    NO_COLOR: '1',
  };
  writeFileSync(
    join(configDir, 'config.json'),
    `${JSON.stringify(
      {
        version: 1,
        secrets: { store: 'file' },
        clients: {
          default: {
            provider: 'gmail',
            clientId: 'test-client.apps.googleusercontent.com',
            secretRef: 'client:default:secret',
            addedAt: '2026-09-15T09:00:00.000Z',
          },
        },
        inboxes: {
          work: {
            id: 'ibx_0000000000000001',
            provider: 'gmail',
            email: 'jo@example.test',
            sub: 'sub-1',
            identity: 'oidc',
            client: 'default',
            tier: 'read',
            contacts: false,
            grantedScopes: ['https://www.googleapis.com/auth/gmail.readonly'],
            secretRef: 'gmail:refresh:ibx_0000000000000001',
            internalDomains: ['example.test'],
            createdAt: '2026-09-15T09:00:00.000Z',
          },
        },
      },
      null,
      2,
    )}\n`,
  );
  const core = openCore({ env, caller: GMAIL_CALLER });
  const cwd = tempDir('agent-gmail-cancel-cwd-');
  const fetched: string[] = [];
  const transport = {
    alias: 'work',
    inboxId: 'ibx_0000000000000001',
    getMessage: async (messageId: string) => messages[messageId as keyof typeof messages] as RawMessage,
    getAttachment: async (messageId: string, attachmentId: string, about?: { signal?: AbortSignal }) => {
      fetched.push(messageId);
      if (messageId !== 'm2') return Buffer.from(attachments[attachmentId as keyof typeof attachments]);
      return new Promise<Buffer>((_resolve, reject) => {
        const stopped = () => {
          reject(
            new CommsError('TRANSIENT', `the download of attachment ${messageId}/1 was cancelled`, {
              details: { why: 'cancelled', messageId, partId: '1' },
            }),
          );
        };
        if (about?.signal?.aborted) stopped();
        else about?.signal?.addEventListener('abort', stopped, { once: true });
      });
    },
  } as GmailTransport;
  const context = new GmailContext({ core, env, cwd, surface: 'mcp', createTransport: () => transport });
  return { core, env, home, cwd, fetched, transport, context };
}

async function connect(t: TestContext, world: World) {
  const built = await createGmailMcpServer({
    core: world.core,
    env: world.env,
    cwd: world.cwd,
    createTransport: () => world.transport,
  });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 'cancel-test', version: '0' });
  await Promise.all([client.connect(clientTransport), built.server.connect(serverTransport)]);
  t.after(() => Promise.all([client.close(), built.close()]));
  const call = async (args: Record<string, unknown>, signal?: AbortSignal) =>
    (await client.callTool(
      { name: 'gmail_attachment_download', arguments: args },
      signal === undefined ? {} : { signal },
    )) as ToolResult;
  return call;
}

function result<T>(answer: ToolResult): T {
  assert.notEqual(answer.isError, true, JSON.stringify(answer.structuredContent));
  return answer.structuredContent as T;
}

async function listing(folder: string): Promise<string[]> {
  try {
    return (await readdir(folder)).sort();
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw error;
  }
}

/** Polls for what the server leaves behind after the SDK has stopped waiting for its cancelled request. */
async function eventually<T>(what: string, look: () => Promise<T | undefined>, ms = 10_000): Promise<T> {
  const until = Date.now() + ms;
  for (;;) {
    const found = await look();
    if (found !== undefined) return found;
    if (Date.now() > until) assert.fail(`${what}, within ${ms} ms`);
    await new Promise((settle) => setTimeout(settle, 20));
  }
}

async function auditOf(world: World): Promise<AuditRecord | undefined> {
  return (await world.core.audit.tail({ limit: 20 })).find((record) => record.operation === 'attachments.download');
}

async function manifestOf(world: World, choiceId: string): Promise<DownloadResult & { complete: boolean }> {
  const folder = join(world.core.paths.stateDir, 'downloads');
  const name = (await listing(folder)).find((entry) => entry.endsWith(`_${choiceId}.json`));
  assert.ok(name, `no manifest for ${choiceId} in ${folder}`);
  return JSON.parse(await readFile(join(folder, name), 'utf8')) as DownloadResult & { complete: boolean };
}

test('a download cancelled over MCP keeps a file already saved, stops the next on its way, and leaves none of it on disk', {
  timeout: 45_000,
}, async (t) => {
  const world = downloadWorld();
  const call = await connect(t, world);
  const args = { inbox: 'work', messageIds: ['m1', 'm2', 'm3'] };
  const asked = result<DownloadQuestion>(await call(args));
  const cancel = new AbortController();
  const watching = setInterval(() => {
    if (world.fetched.includes('m2')) cancel.abort();
  }, 20);
  t.after(() => clearInterval(watching));

  await assert.rejects(
    call({ ...args, saveTo: 'downloads', choiceId: asked.choiceId }, cancel.signal),
    /abort|cancel/i,
  );

  const audit = await eventually('the cancelled download was audited', () => auditOf(world));
  assert.equal(audit.outcome, 'failed');
  assert.match(audit.reason ?? '', /1 file\(s\), 16 bytes[\s\S]*stopped part-way/);
  assert.deepEqual(await listing(join(world.home, 'Downloads')), ['m1.pdf']);
  assert.deepEqual(world.fetched, ['m1', 'm2'], 'an attachment was fetched after the cancellation');
  const manifest = await manifestOf(world, asked.choiceId);
  assert.equal(manifest.complete, false);
  assert.deepEqual(
    manifest.files.map((file) => `${file.messageId}/${file.partId}`),
    ['m1/1'],
  );
  assert.deepEqual(
    manifest.skipped.map((file) => ({ id: `${file.messageId}/${file.partId}`, cause: file.cause })),
    [
      { id: 'm2/1', cause: 'stopped' },
      { id: 'm3/1', cause: 'stopped' },
    ],
  );
});

/** Holds an approval's lock until `release`, as another process part-way through a claim would. */
async function holdLock(store: ApprovalStore, approvalId: string): Promise<{ release: () => Promise<void> }> {
  let release!: () => void;
  const released = new Promise<void>((settle) => {
    release = settle;
  });
  let held!: () => void;
  const holding = new Promise<void>((settle) => {
    held = settle;
  });
  const done = withFileLock(join(store.directory, `${approvalId}.json.lock`), async () => {
    held();
    await released;
  });
  await holding;
  return {
    release: async () => {
      release();
      await done;
    },
  };
}

/** Resolves when the store is next asked to claim a download, before the claim itself starts. */
function whenClaimed(store: ApprovalStore): Promise<void> {
  return new Promise((entered) => {
    const original = store.claimForDownload.bind(store);
    store.claimForDownload = (...args) => {
      entered();
      return original(...args);
    };
  });
}

test('a download cancelled while its destination claim waits saves nothing and leaves the answer to use', async () => {
  const world = downloadWorld();
  const targets = [{ messageId: 'm1' }];
  const asked = (await downloadAttachments(world.context, 'work', targets)) as DownloadQuestion;
  const store = world.core.approvals;
  const lock = await holdLock(store, asked.choiceId);
  const claiming = whenClaimed(store);
  const cancel = new AbortController();
  const saving = downloadAttachments(world.context, 'work', targets, {
    saveTo: 'downloads',
    choiceId: asked.choiceId,
    signal: cancel.signal,
  });
  await claiming;
  cancel.abort();
  await lock.release();

  await assert.rejects(saving, (error: unknown) => {
    assert.ok(error instanceof CommsError);
    assert.equal(error.code, 'USAGE');
    assert.equal(error.details?.reason, 'cancelled');
    return true;
  });
  assert.equal(asV2(await store.get(asked.choiceId))?.state, 'pending', 'the answer was spent');
  assert.deepEqual(await listing(join(world.home, 'Downloads')), []);
  assert.equal(await auditOf(world), undefined, 'a download that never started was audited');

  const saved = (await downloadAttachments(world.context, 'work', targets, {
    saveTo: 'downloads',
    choiceId: asked.choiceId,
  })) as DownloadResult;
  assert.deepEqual(
    saved.files.map((file) => `${file.messageId}/${file.partId}`),
    ['m1/1'],
  );
});
