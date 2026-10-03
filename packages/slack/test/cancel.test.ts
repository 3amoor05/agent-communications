import assert from 'node:assert/strict';
import { realpathSync, writeFileSync } from 'node:fs';
import { mkdir, readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { type TestContext, test } from 'node:test';
import { type AuditRecord, CommsError } from '@agentcomms/core';
import { Client } from '@modelcontextprotocol/client';
import { InMemoryTransport } from '@modelcontextprotocol/server';
import { SlackContext } from '../src/context.ts';
import { createSlackMcpServer } from '../src/mcp/server.ts';
import { downloadFiles, type FileDownloadQuestion, type FileDownloadResult } from '../src/operations/files.ts';
import { prepareDraftPost, sendPost } from '../src/operations/post.ts';
import { openWorkspace } from '../src/operations/session.ts';
import { type FakeSlack, startFakeSlack, UPLOADS } from './support/fake-slack.ts';
import { type Harness, newHarness } from './support/harness.ts';

/**
 * A call cancelled from the MCP client: `slack_file_download` and `slack_post_send` (CUE-305).
 *
 * The SDK aborts a request's signal when its client sends `notifications/cancelled`, and the two tools that move bytes
 * used to take only their arguments, so a cancelled download went on fetching until the file was whole or its own limit
 * ran out, and a cancelled post went on uploading. Now the signal reaches both transfers.
 *
 * What a cancellation may and may not do is the point of these tests. A download stops the file on its way and fetches
 * nothing after it, and no part of that file is left on disk. A post cancelled before the person's approval is claimed
 * posts nothing and leaves the approval unused; one cancelled after the claim and before Slack has the post posts
 * nothing and records the approval as failed, saying why; one cancelled once the request that posts has gone out is
 * posted, and says so, because that request is never abandoned — Slack may already have acted on it.
 *
 * The server keeps going after its client has stopped listening, and the SDK sends a cancelled request no answer, so the
 * tests over MCP wait for what the server leaves behind — the audit record, the approval's state — rather than for a
 * reply. The tests of the operations drive the moments a client cannot reach on cue.
 */

interface ToolResult {
  isError?: boolean;
  structuredContent?: Record<string, unknown>;
}

const TEAM = 'T0001';
const CHANNEL = 'C0CH01';
const TS = '1700000000.000100';

/** Polls for what a server leaves behind once it has finished, rather than sleeping a fixed time. */
async function eventually<T>(what: string, look: () => Promise<T | undefined>, ms = 10_000): Promise<T> {
  const until = Date.now() + ms;
  for (;;) {
    const seen = await look();
    if (seen !== undefined) return seen;
    if (Date.now() > until) assert.fail(`${what}, within ${ms} ms`);
    await new Promise((settle) => setTimeout(settle, 20));
  }
}

/** What is in a folder, or nothing when it was never made. */
async function listing(folder: string): Promise<string[]> {
  try {
    return (await readdir(folder)).sort();
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw error;
  }
}

async function audited(harness: Harness, operation: string): Promise<AuditRecord[]> {
  return (await harness.core.audit.tail({ limit: 20 })).filter((record) => record.operation === operation);
}

async function connect(t: TestContext, harness: Harness, fake: FakeSlack) {
  const { server } = await createSlackMcpServer({ core: harness.core, env: harness.env, fetch: fake.fetch });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 'test', version: '0' });
  await Promise.all([client.connect(clientTransport), server.connect(serverTransport)]);
  t.after(() => Promise.all([client.close(), server.close()]));
  const call = async (name: string, args: Record<string, unknown>, signal?: AbortSignal) =>
    (await client.callTool({ name, arguments: args }, signal ? { signal } : {})) as ToolResult;
  return { call };
}

function ok<T>(result: ToolResult): T {
  assert.notEqual(result.isError, true, JSON.stringify(result.structuredContent));
  return result.structuredContent as T;
}

/** A cancellation, told from any other failure by its code, its words and `details.reason`. */
function isCancellation(message: RegExp) {
  return (error: unknown): boolean => {
    assert.ok(error instanceof CommsError, String(error));
    assert.equal(error.code, 'USAGE');
    assert.match(error.message, message);
    assert.equal(error.details?.reason, 'cancelled');
    return true;
  };
}

// ── Downloads ──────────────────────────────────────────────────────────────────────────────────────────────────────

function fileRecord(id: string, name: string): Record<string, unknown> {
  return {
    id,
    name,
    title: name,
    mimetype: 'application/pdf',
    user: 'U0001',
    user_team: TEAM,
    is_external: false,
    mode: 'hosted',
    url_private_download: `https://files.slack.com/files-pri/${TEAM}-${id}/download/${name}`,
    shares: { public: { [CHANNEL]: [{ ts: TS }] } },
  };
}

const RECORDS: Record<string, Record<string, unknown>> = {
  F0SLOW: fileRecord('F0SLOW', 'slow.pdf'),
  F0NEXT: fileRecord('F0NEXT', 'next.pdf'),
};

/** A workspace that can read, and a Slack with two files: the tests say how the files host answers each. */
async function downloadWorld(t: TestContext) {
  const harness = await newHarness();
  await harness.addWorkspace({ alias: 'acme', mode: 'read' });
  const fake = await startFakeSlack({
    'files.info': ({ params }) => {
      const record = RECORDS[params.get('file') ?? ''];
      return record ? { ok: true, file: record } : { ok: false, error: 'file_not_found' };
    },
    'users.info': () => ({ ok: true, user: { id: 'U0001', profile: { display_name: 'sam' } } }),
  });
  t.after(() => fake.close());
  fake.files[`${TEAM}-F0NEXT`] = () => ({ body: '%PDF-1.7 next', headers: { 'content-type': 'application/pdf' } });
  const downloads = join(harness.home, 'Downloads');
  const fetched = () => fake.requests.filter((seen) => seen.host === 'files').map((seen) => seen.path.split('/')[2]);
  return { harness, fake, downloads, fetched };
}

/** The manifest a run wrote for its question, under this package's state directory. */
async function manifestOf(harness: Harness, choiceId: string): Promise<FileDownloadResult> {
  const folder = join(harness.core.paths.stateDir, 'downloads');
  const name = (await listing(folder)).find((entry) => entry.endsWith(`_${choiceId}.json`));
  assert.ok(name, `no manifest for ${choiceId} in ${folder}`);
  return JSON.parse(await readFile(join(folder, name), 'utf8')) as FileDownloadResult;
}

test('a download cancelled over MCP stops the file on its way, fetches nothing after it, and leaves none of it on disk', async (t) => {
  const { harness, fake, downloads, fetched } = await downloadWorld(t);
  const cancel = new AbortController();
  // The first file: its headers and one byte, then silence with the connection held — and the person cancels as it starts.
  fake.files[`${TEAM}-F0SLOW`] = () => {
    cancel.abort();
    return { stall: true, headers: { 'content-type': 'application/pdf' } };
  };
  const { call } = await connect(t, harness, fake);
  const args = { workspace: 'acme', fileIds: ['F0SLOW', 'F0NEXT'] };
  const asked = ok<FileDownloadQuestion>(await call('slack_file_download', args));

  await assert.rejects(
    call('slack_file_download', { ...args, saveTo: 'downloads', choiceId: asked.choiceId }, cancel.signal),
  );
  // Recorded once the run has stopped: before the change, the stalled file held it for the thirty seconds the host may
  // go silent, then the next file was fetched and saved, and the run reported success.
  const [record] = await eventually('the download recorded as stopped', async () => {
    const records = await audited(harness, 'files.download');
    return records.length > 0 ? records : undefined;
  });
  assert.equal(record?.outcome, 'failed');
  assert.match(record?.reason ?? '', /; the call was cancelled$/);

  assert.deepEqual(await listing(downloads), [], 'a file was left in the folder');
  assert.deepEqual(fetched(), [`${TEAM}-F0SLOW`], 'a file was fetched after the cancellation');
  const manifest = await manifestOf(harness, asked.choiceId);
  assert.deepEqual(manifest.files, []);
  assert.deepEqual(
    manifest.skipped.map(({ fileId, cause, reason }) => ({ fileId, cause, reason })),
    ['F0SLOW', 'F0NEXT'].map((fileId) => ({
      fileId,
      cause: 'stopped',
      reason: 'the call was cancelled before this file was saved',
    })),
  );
  assert.equal(manifest.complete, false);
});

test('a download cancelled before the person’s answer is claimed saves nothing, fetches nothing, and leaves the answer to use', async (t) => {
  const { harness, fake, downloads, fetched } = await downloadWorld(t);
  fake.files[`${TEAM}-F0SLOW`] = () => ({ body: '%PDF-1.7 slow', headers: { 'content-type': 'application/pdf' } });
  const context = new SlackContext({ core: harness.core, env: harness.env, surface: 'mcp' });
  const session = await openWorkspace(context, 'acme', { fetch: fake.fetch });
  const request = { fileIds: ['F0SLOW', 'F0NEXT'], surface: 'mcp' as const };
  const asked = (await downloadFiles(context, session, request)) as FileDownloadQuestion;
  assert.equal(asked.destinationRequired, true);

  // Cancelled while the files are looked up again, before anything is claimed or fetched.
  const cancel = new AbortController();
  const lookUp = fake.script['files.info'];
  fake.script['files.info'] = (seen) => {
    cancel.abort();
    return lookUp?.(seen);
  };
  const answer = { ...request, saveTo: 'downloads', choiceId: asked.choiceId };
  await assert.rejects(
    downloadFiles(context, session, answer, { signal: cancel.signal }),
    isCancellation(/^cancelled: nothing was saved$/),
  );
  assert.equal((await harness.core.approvals.get(asked.choiceId))?.state, 'pending', 'the answer was spent');
  assert.deepEqual(fetched(), []);
  assert.deepEqual(await audited(harness, 'files.download'), [], 'a run that never started was recorded');

  // The same answer, again, saves the files: nothing about it was used up.
  fake.script['files.info'] = lookUp as NonNullable<typeof lookUp>;
  const saved = (await downloadFiles(context, session, answer)) as FileDownloadResult;
  assert.deepEqual(
    saved.files.map((entry) => entry.fileId),
    ['F0SLOW', 'F0NEXT'],
  );
  assert.deepEqual(await listing(downloads), ['next.pdf', 'slow.pdf']);
});

// ── Posts ──────────────────────────────────────────────────────────────────────────────────────────────────────────

/** A workspace that can post under `chat`, and a Slack that takes posts and files. */
async function postWorld(t: TestContext) {
  const harness = await newHarness();
  await harness.addWorkspace({ alias: 'acme', mode: 'send' });
  const fake = await startFakeSlack({
    'conversations.info': () => ({ ok: true, channel: { id: 'C1', name: 'eng', num_members: 4, is_member: true } }),
    'chat.postMessage': () => ({ ok: true, ts: TS }),
  });
  t.after(() => fake.close());
  const uploads = fake.acceptUploads({ ts: TS });
  const docs = join(harness.home, 'docs');
  await mkdir(docs);
  const report = join(docs, 'report.pdf');
  writeFileSync(report, '%PDF-1.7 the report');
  const posted = () => fake.requests.filter((seen) => seen.method === 'chat.postMessage').length;
  return { harness, fake, uploads, report: realpathSync.native(report), posted };
}

/** The operation both surfaces post through, and a draft prepared for it — with files, or words alone. */
async function prepared(harness: Harness, fetch: FakeSlack['fetch'], files: string[] = []) {
  const context = new SlackContext({ core: harness.core, env: harness.env, surface: 'mcp' });
  const draft = await prepareDraftPost(
    context,
    'acme',
    { channel: 'C1', text: 'the report', ...(files.length > 0 ? { files } : {}) },
    { fetch },
  );
  const send = (signal?: AbortSignal, through: FakeSlack['fetch'] = fetch) =>
    sendPost(
      context,
      'acme',
      { draftId: draft.draftId, approvalId: draft.approvalId, expectChannel: 'C1', ...(signal ? { signal } : {}) },
      { fetch: through },
    );
  const state = async () => (await harness.core.approvals.get(draft.approvalId))?.state;
  return { draft, send, state };
}

/** The URL a request went to, whatever form it was handed over in. */
function urlOf(input: string | URL | Request): string {
  return typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
}

test('a post with files cancelled over MCP while a file uploads shares nothing, and the approval says it was cancelled', async (t) => {
  const { harness, fake, uploads, report, posted } = await postWorld(t);
  const { call } = await connect(t, harness, fake);
  const draft = ok<{ draftId: string; approvalId: string }>(
    await call('slack_post_prepare', { workspace: 'acme', channel: 'C1', text: 'the report', files: [report] }),
  );
  const cancel = new AbortController();
  // Slack takes the bytes and never answers; the person cancels while the upload waits.
  fake.uploadAnswer = () => {
    cancel.abort();
    return { stall: true };
  };

  await assert.rejects(
    call(
      'slack_post_send',
      { workspace: 'acme', draftId: draft.draftId, approvalId: draft.approvalId, expectChannel: 'C1' },
      cancel.signal,
    ),
  );
  /*
   * Before the change the upload waited out its own five minutes, with the approval in `sending` all that time. The
   * audit record is the last thing a failed post writes — after the approval's outcome — so it is what is waited for.
   */
  const [record] = await eventually('the post recorded as failed', async () => {
    const records = await audited(harness, 'slack.post');
    return records.length > 0 ? records : undefined;
  });
  const settled = await harness.core.approvals.get(draft.approvalId);
  assert.equal(settled?.state, 'failed', 'an approval of a post that never happened says it was used');
  assert.match(settled?.reason ?? '', /^cancelled: nothing was posted$/);
  assert.equal(uploads.issued.length, 1, 'the file was not on its way when the call was cancelled');
  assert.deepEqual(uploads.completed, [], 'the files were shared');
  assert.equal(posted(), 0);
  assert.equal(record?.outcome, 'failed');
  assert.equal(record?.reason, 'cancelled: nothing was posted');
  assert.deepEqual(record?.ids?.possiblyUploaded, [uploads.issued[0]?.fileId]);
});

test('a post cancelled before its approval is claimed posts nothing, and the approval is left to use', async (t) => {
  const { harness, fake, posted } = await postWorld(t);
  const { send, state, draft } = await prepared(harness, fake.fetch);
  // Cancelled while the room is looked up again, before the claim.
  const cancel = new AbortController();
  const room = fake.script['conversations.info'];
  fake.script['conversations.info'] = (seen) => {
    cancel.abort();
    return room?.(seen);
  };

  await assert.rejects(send(cancel.signal), isCancellation(/^cancelled: nothing was posted$/));
  assert.equal(await state(), 'pending', 'the approval was claimed');
  assert.equal(posted(), 0);
  assert.deepEqual(await audited(harness, 'slack.post'), []);

  // The same approval posts it, once, when the call is not cancelled.
  fake.script['conversations.info'] = room as NonNullable<typeof room>;
  assert.deepEqual(await send(), { approvalId: draft.approvalId, channel: 'C1', ts: TS });
  assert.equal(await state(), 'used');
  assert.equal(posted(), 1);
});

test('a post cancelled after its approval is claimed and before Slack has it posts nothing, and records the approval as failed', async (t) => {
  const { harness, fake, posted } = await postWorld(t);
  const { send, state, draft } = await prepared(harness, fake.fetch);
  // Cancelled during the claim itself: the approval is spent, and nothing has gone to Slack.
  const cancel = new AbortController();
  const store = harness.core.approvals;
  const claim = store.claimForSend.bind(store);
  store.claimForSend = async (...args: Parameters<typeof claim>) => {
    const claimed = await claim(...args);
    cancel.abort();
    return claimed;
  };

  await assert.rejects(send(cancel.signal), isCancellation(/^cancelled: nothing was posted$/));
  assert.equal(posted(), 0, 'it was posted after the cancellation');
  assert.equal(await state(), 'failed');
  assert.equal((await store.get(draft.approvalId))?.reason, 'cancelled: nothing was posted');
  const [record] = await audited(harness, 'slack.post');
  assert.equal(record?.outcome, 'failed');
  assert.equal(record?.reason, 'cancelled: nothing was posted');
});

test('a post with files cancelled after the last upload and before they are shared posts nothing', async (t) => {
  const { harness, fake, uploads, report } = await postWorld(t);
  const { send, state } = await prepared(harness, fake.fetch, [report]);
  const cancel = new AbortController();
  /*
   * The upload's answer, whose body the transport lets go of the moment it has the status — and as it does, the person
   * cancels. The upload has finished; the one request left is the one that would share the files.
   */
  const through: FakeSlack['fetch'] = async (input, init) => {
    const answer = await fake.fetch(input, init);
    if (!urlOf(input).startsWith(UPLOADS)) return answer;
    return new Response(new ReadableStream({ cancel: () => cancel.abort() }), { status: answer.status });
  };

  await assert.rejects(send(cancel.signal, through), isCancellation(/^cancelled: nothing was posted$/));
  assert.equal(Object.keys(uploads.received).length, 1, 'the upload did not finish');
  assert.deepEqual(uploads.completed, [], 'the files were shared after the cancellation');
  assert.equal(await state(), 'failed');
});

test('a post cancelled once its request has gone out is posted, the approval is used, and the result says so', async (t) => {
  const { harness, fake, posted } = await postWorld(t);
  const { send, state, draft } = await prepared(harness, fake.fetch);
  const cancel = new AbortController();
  /*
   * Slack takes the post and answers, and the person cancels as the answer is on its way. Then as `fetch` would: a
   * request whose own signal fired before its answer was read is reported as aborted, whatever Slack did with it — so
   * a post sent on the cancellable signal would be recorded as failed although it is in the channel.
   */
  const through: FakeSlack['fetch'] = async (input, init) => {
    if (!urlOf(input).endsWith('/chat.postMessage')) return fake.fetch(input, init);
    const answer = await fake.fetch(input, { ...init, signal: null });
    cancel.abort();
    init?.signal?.throwIfAborted();
    return answer;
  };

  const result = await send(cancel.signal, through);
  const late = 'the call was cancelled too late to stop it: Slack accepted the post, and a post cannot be taken back';
  assert.deepEqual(result, { approvalId: draft.approvalId, channel: 'C1', ts: TS, note: late });
  assert.equal(posted(), 1);
  assert.equal(await state(), 'used');
  const [record] = await audited(harness, 'slack.post');
  assert.equal(record?.outcome, 'ok');
  assert.equal(record?.reason, late);
});

test('a post with files cancelled while they are being shared is posted, and the result and the audit say so', async (t) => {
  const { harness, fake, uploads, report } = await postWorld(t);
  const { send, state } = await prepared(harness, fake.fetch, [report]);
  const cancel = new AbortController();
  // The request that shares the files, answered, and the cancellation arriving with the answer: as for words alone.
  const through: FakeSlack['fetch'] = async (input, init) => {
    if (!urlOf(input).endsWith('/files.completeUploadExternal')) return fake.fetch(input, init);
    const answer = await fake.fetch(input, { ...init, signal: null });
    cancel.abort();
    init?.signal?.throwIfAborted();
    return answer;
  };

  const result = await send(cancel.signal, through);
  const late = 'the call was cancelled too late to stop it: Slack accepted the post, and a post cannot be taken back';
  assert.equal(uploads.completed.length, 1);
  assert.equal(result.ts, TS, 'the message’s ts was not looked up');
  assert.equal((result as { note?: string }).note, late);
  assert.equal(await state(), 'used');
  const [record] = await audited(harness, 'slack.post');
  assert.equal(record?.outcome, 'ok');
  assert.equal(record?.reason, late);
});
