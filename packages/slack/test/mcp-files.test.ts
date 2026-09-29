import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdirSync, realpathSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { type TestContext, test } from 'node:test';
import { Client } from '@modelcontextprotocol/client';
import { InMemoryTransport } from '@modelcontextprotocol/server';
import { createSlackMcpServer } from '../src/mcp/server.ts';
import { type FakeSlack, startFakeSlack } from './support/fake-slack.ts';
import { type Harness, newHarness } from './support/harness.ts';

/**
 * Files from a chat: `slack_draft_create`, `slack_draft_update`, `slack_post_prepare` and `slack_post_send`.
 *
 * The same operations the commands run (see `cli-files.test.ts`), through an MCP client, against a loopback Slack of
 * both hosts through the real guard. And what a model reads before it calls any of them — the server's instructions and
 * the tools' descriptions — says that files can be posted, that the preview lists them, and that the approval is bound
 * to each file's hash and checked again at send.
 */

interface ToolResult {
  isError?: boolean;
  structuredContent?: Record<string, unknown>;
}

interface DraftFile {
  path: string;
  name: string;
  size: number;
  sha256: string;
  mimeType: string;
}

async function world(t: TestContext) {
  const harness = await newHarness();
  await harness.addWorkspace({ alias: 'acme', mode: 'send' });
  const fake = await startFakeSlack({
    'conversations.info': () => ({ ok: true, channel: { id: 'C1', name: 'eng', num_members: 4 } }),
  });
  t.after(() => fake.close());
  const uploads = fake.acceptUploads();
  const docs = join(harness.home, 'docs');
  mkdirSync(docs);
  const { client, call, close } = await connect(harness, fake);
  t.after(close);
  return { harness, fake, uploads, docs, client, call };
}

async function connect(harness: Harness, fake: FakeSlack) {
  const { server } = await createSlackMcpServer({ core: harness.core, env: harness.env, fetch: fake.fetch });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 'test', version: '0' });
  await Promise.all([client.connect(clientTransport), server.connect(serverTransport)]);
  const call = async (name: string, args: Record<string, unknown>) =>
    (await client.callTool({ name, arguments: args })) as ToolResult;
  return { client, call, close: async () => void (await Promise.all([client.close(), server.close()])) };
}

/** What a call returned, when it succeeded; fails the test with the error when it did not. */
function ok<T>(result: ToolResult): T {
  assert.notEqual(result.isError, true, JSON.stringify(result.structuredContent));
  return result.structuredContent as T;
}

function file(dir: string, name: string, content: string | Buffer): string {
  const path = join(dir, name);
  writeFileSync(path, content);
  return realpathSync.native(path);
}

function sha256(bytes: string | Buffer): string {
  return createHash('sha256').update(bytes).digest('hex');
}

test('slack_draft_create takes local files, and records each by path, name, size, hash and type', async (t) => {
  const { call, docs, fake } = await world(t);
  const report = file(docs, 'report.pdf', '%PDF-1.7 the report');
  const draft = ok<{ draftId: string; files?: DraftFile[]; payload: { text: string } }>(
    await call('slack_draft_create', { workspace: 'acme', channel: 'C1', files: [report] }),
  );
  assert.deepEqual(draft.files, [
    { path: report, name: 'report.pdf', size: 19, sha256: sha256('%PDF-1.7 the report'), mimeType: 'application/pdf' },
  ]);
  assert.equal(draft.payload.text, '', 'with files, the words are optional');
  assert.deepEqual(fake.requests, [], 'writing a draft reached Slack');

  // Refused as the command refuses it: outside the home folder, in the words that say what to do.
  const hidden = join(docs, '..', '.ssh');
  mkdirSync(hidden);
  const refused = await call('slack_draft_create', {
    workspace: 'acme',
    channel: 'C1',
    files: [file(hidden, 'id_ed25519', 'KEY')],
  });
  assert.equal(refused.isError, true);
  assert.match(JSON.stringify(refused.structuredContent), /hidden folders in your home are never attached/);
});

test('slack_draft_update replaces with files, adds with addFiles, and is a new revision each time', async (t) => {
  const { call, docs } = await world(t);
  const a = file(docs, 'a.txt', 'a');
  const b = file(docs, 'b.txt', 'bb');
  type Draft = { draftId: string; revision: string; files?: DraftFile[]; payload: { text: string; channel: string } };
  const created = ok<Draft>(
    await call('slack_draft_create', { workspace: 'acme', channel: 'C1', text: 'hi', files: [a] }),
  );

  const added = ok<Draft>(
    await call('slack_draft_update', { workspace: 'acme', draftId: created.draftId, addFiles: [b] }),
  );
  assert.deepEqual(
    added.files?.map((recorded) => recorded.path),
    [a, b],
  );
  assert.notEqual(added.revision, created.revision);

  const replaced = ok<Draft>(
    await call('slack_draft_update', { workspace: 'acme', draftId: created.draftId, files: [b], text: 'just b' }),
  );
  assert.deepEqual(
    replaced.files?.map((recorded) => recorded.path),
    [b],
  );
  assert.equal(replaced.payload.text, 'just b');
  assert.notEqual(replaced.revision, added.revision);

  // `slack_draft_get` shows the files it would post.
  const shown = ok<{ draft: { files?: DraftFile[] } }>(
    await call('slack_draft_get', { workspace: 'acme', draftId: created.draftId }),
  );
  assert.deepEqual(shown.draft.files, replaced.files);
});

test('slack_post_prepare composes a post with files, and slack_post_send returns their ids and the message’s ts', async (t) => {
  const { call, docs, uploads } = await world(t);
  const chart = Buffer.from([0x89, 0x50, 0x4e, 0x47, 7]);
  const real = file(docs, 'chart.png', chart);

  const prepared = ok<{
    draftId: string;
    approvalId: string;
    riskFlags: string[];
    preview: { attachments?: Record<string, unknown>[]; warnings?: string[] };
  }>(await call('slack_post_prepare', { workspace: 'acme', channel: 'C1', text: 'the chart', files: [real] }));
  assert.deepEqual(prepared.preview.attachments, [
    { filename: 'chart.png', size: 5, mimeType: 'image/png', sha256: sha256(chart), path: real },
  ]);
  assert.ok(prepared.riskFlags.includes('contains-files'));
  assert.equal(uploads.issued.length, 0, 'preparing asked for somewhere to upload');

  const posted = ok<{
    ts: string | null;
    channel: string;
    files: { id: string; name: string; size: number; sha256: string }[];
  }>(
    await call('slack_post_send', {
      workspace: 'acme',
      draftId: prepared.draftId,
      approvalId: prepared.approvalId,
      expectChannel: 'C1',
    }),
  );
  assert.equal(posted.ts, '1700000000.000200');
  assert.deepEqual(posted.files, [
    { id: uploads.issued[0]?.fileId, name: 'chart.png', size: 5, sha256: sha256(chart) },
  ]);
  assert.deepEqual(uploads.received[uploads.issued[0]?.fileId ?? ''], chart);
  assert.equal(uploads.completed[0]?.initialComment, 'the chart');
});

test('slack_post_prepare with neither words nor files is still nothing to prepare', async (t) => {
  const { call } = await world(t);
  const neither = await call('slack_post_prepare', { workspace: 'acme', channel: 'C1', files: [] });
  assert.equal(neither.isError, true);
  assert.match(JSON.stringify(neither.structuredContent), /nothing to prepare/);
});

test('what a model reads first says files can be posted, the preview lists them, and each hash is checked at send', async (t) => {
  const { client } = await world(t);
  const greeting = client.getInstructions() ?? '';
  assert.ok(Buffer.byteLength(greeting) < 2048, `${Buffer.byteLength(greeting)} bytes`);
  assert.match(greeting, /Files post the same way/);
  assert.match(greeting, /the preview lists each with its SHA-256/);
  assert.match(greeting, /bound to those bytes, and every file is read and checked again at send/);

  const tools = (await client.listTools()).tools;
  const described = (name: string): string => tools.find((tool) => tool.name === name)?.description ?? '';
  for (const name of ['slack_draft_create', 'slack_post_prepare', 'slack_draft_update']) {
    assert.match(described(name), /files/, name);
    const properties = tools.find((tool) => tool.name === name)?.inputSchema.properties as Record<string, unknown>;
    assert.ok(properties.files, `${name} takes files`);
  }
  assert.match(described('slack_post_prepare'), /SHA-256/);
  assert.match(described('slack_post_send'), /read again/);
  assert.match(described('slack_post_send'), /`ts`/);
  assert.match(described('slack_draft_update'), /voids any approval/);
  const update = tools.find((tool) => tool.name === 'slack_draft_update');
  assert.equal(update?.annotations?.readOnlyHint, false);
  assert.equal(update?.annotations?.openWorldHint, false, 'updating a draft reaches nothing but this machine');
});
