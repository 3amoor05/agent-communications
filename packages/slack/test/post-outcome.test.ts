import assert from 'node:assert/strict';
import { realpathSync, writeFileSync } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { type TestContext, test } from 'node:test';
import { ApprovalStore, type AuditRecord, asV2, CommsError, SENDING_LEASE_MS } from '@agentcomms/core';
import { SlackContext } from '../src/context.ts';
import { prepareDraftPost, sendPost } from '../src/operations/post.ts';
import { DROP, type FakeSlack, startFakeSlack } from './support/fake-slack.ts';
import { type Harness, newHarness } from './support/harness.ts';

/**
 * What a post's approval and audit record say once the request that posts has gone out.
 *
 * Three outcomes, and only one of them is known to be a failure. Slack refusing in so many words posted nothing, and
 * the approval is recorded as failed. Slack taking the post and the answer never arriving whole — a dropped connection,
 * a 5xx, Slack's own "some of it may have succeeded" — may have posted: the approval is left in `sending`, which the
 * store reads as `unknown` once the attempt is plainly over, and nothing says it failed. And Slack accepting the post is
 * a post, whatever the bookkeeping after it does: a write that fails afterwards is said beside the result, and never
 * turns the record into a failure — the one wrong answer that gets a post made twice.
 */

const TS = '1700000000.000100';

/** A workspace that can post under `chat`, and a Slack that takes posts and files. */
async function world(t: TestContext) {
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

/** A draft prepared through the operation both surfaces post through, with files or words alone, and its send. */
async function prepared(harness: Harness, fetch: FakeSlack['fetch'], files: string[] = []) {
  const context = new SlackContext({ core: harness.core, env: harness.env, surface: 'mcp' });
  const draft = await prepareDraftPost(
    context,
    'acme',
    { channel: 'C1', text: 'the report', ...(files.length > 0 ? { files } : {}) },
    { fetch },
  );
  const send = (through: FakeSlack['fetch'] = fetch) =>
    sendPost(
      context,
      'acme',
      { draftId: draft.draftId, approvalId: draft.approvalId, expectChannel: 'C1' },
      { fetch: through },
    );
  const state = async () => asV2(await harness.core.approvals.get(draft.approvalId))?.state;
  return { draft, send, state };
}

async function audited(harness: Harness): Promise<AuditRecord[]> {
  return (await harness.core.audit.tail({ limit: 20 })).filter((record) => record.operation === 'slack.post');
}

/** The URL a request went to, whatever form it was handed over in. */
function urlOf(input: string | URL | Request): string {
  return typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
}

/** Every outcome the store was asked to record, by kind: a test holds "never recorded as failed" against it. */
function recordedOutcomes(harness: Harness): string[] {
  const seen: string[] = [];
  const store = harness.core.approvals;
  const complete = store.complete.bind(store);
  store.complete = (approvalId, claimToken, outcome) => {
    seen.push('error' in outcome ? 'failed' : 'used');
    return complete(approvalId, claimToken, outcome);
  };
  return seen;
}

// ── A post that may have happened ──────────────────────────────────────────────────────────────────────────────

test('a post Slack took whose answer was lost on the way back is left to read unknown, never recorded as failed', async (t) => {
  const { harness, fake, posted } = await world(t);
  const { draft, send, state } = await prepared(harness, fake.fetch);
  // Slack takes the post — it is in the channel — and the connection drops before the answer.
  fake.script['chat.postMessage'] = () => DROP;
  const outcomes = recordedOutcomes(harness);

  const error = await send().then(
    () => assert.fail('a post whose answer never came was reported as posted'),
    (thrown: unknown) => thrown,
  );
  assert.ok(error instanceof CommsError, String(error));
  assert.match(error.message, /^whether it was posted is not known: could not reach Slack/);
  assert.equal(error.details?.outcome, 'unknown');
  assert.match(error.hint ?? '', /Look in the channel before anything else/);
  assert.equal(posted(), 1, 'Slack was not asked to post');

  // Before the change this was `failed`: a post that is in the channel, recorded as one that is not.
  assert.deepEqual(outcomes, [], 'an outcome nobody knows was recorded');
  assert.equal(await state(), 'sending');
  const later = new ApprovalStore(harness.core.paths.stateDir, {
    now: () => new Date(Date.now() + SENDING_LEASE_MS),
    loadConfig: () => harness.core.config.load(),
  });
  assert.equal(asV2(await later.get(draft.approvalId))?.state, 'unknown');
  const [record] = await audited(harness);
  assert.equal(record?.outcome, 'failed');
  assert.match(record?.reason ?? '', /^outcome unknown: could not reach Slack/);

  // And the approval is not spent a second time: the same call again posts nothing.
  await assert.rejects(send(), CommsError);
  assert.equal(posted(), 1);
});

test('what Slack answered decides the record: a refusal is a failure, anything that may have posted is not', async (t) => {
  /*
   * Each answer to the request that posts, and what the approval should say after it. Only an error on the method's own
   * allowlist of refusals made before acting — and a 429, which Slack sends instead of acting — posted nothing. Anything
   * else may have posted: a 5xx after Slack took the request, the errors Slack itself says may follow a partial
   * success, one that describes Slack's state rather than the request, one documented for the other posting method
   * only, and one Slack has never documented at all — its lists say they are not exhaustive.
   */
  const cases: { what: string; slack?: unknown; status?: number; asked?: boolean; state: string }[] = [
    { what: 'Slack refusing: channel_not_found', slack: { ok: false, error: 'channel_not_found' }, state: 'failed' },
    { what: 'Slack refusing: restricted_action', slack: { ok: false, error: 'restricted_action' }, state: 'failed' },
    { what: 'Slack’s own maybe: internal_error', slack: { ok: false, error: 'internal_error' }, state: 'sending' },
    {
      what: 'Slack’s state: service_unavailable',
      slack: { ok: false, error: 'service_unavailable' },
      state: 'sending',
    },
    {
      what: 'an error Slack never documented',
      slack: { ok: false, error: 'something_new_went_wrong' },
      state: 'sending',
    },
    {
      what: 'a refusal listed for sharing files only: posting_to_channel_denied',
      slack: { ok: false, error: 'posting_to_channel_denied' },
      state: 'sending',
    },
    { what: 'a 429, which Slack sends instead of acting', status: 429, asked: false, state: 'failed' },
    { what: 'a 503 after Slack took the request', status: 503, asked: true, state: 'sending' },
  ];
  for (const { what, slack, status, asked, state: expected } of cases) {
    const { harness, fake } = await world(t);
    const { send, state } = await prepared(harness, fake.fetch);
    if (slack !== undefined) fake.script['chat.postMessage'] = () => slack;
    const through: FakeSlack['fetch'] = async (input, init) => {
      if (status === undefined || !urlOf(input).endsWith('/chat.postMessage')) return fake.fetch(input, init);
      if (asked) await fake.fetch(input, init);
      return new Response('', { status, headers: status === 429 ? { 'retry-after': '3' } : {} });
    };

    const error = await send(through).then(
      () => assert.fail(`${what}: reported as posted`),
      (thrown: unknown) => thrown,
    );
    assert.ok(error instanceof CommsError, `${what}: ${String(error)}`);
    assert.equal(await state(), expected, what);
    const [record] = await audited(harness);
    assert.equal(record?.outcome, 'failed', what);
    if (expected === 'sending') {
      assert.match(error.message, /^whether it was posted is not known: /, what);
      assert.match(record?.reason ?? '', /^outcome unknown: /, what);
    } else {
      assert.doesNotMatch(error.message, /not known/, what);
      assert.doesNotMatch(record?.reason ?? '', /unknown/, what);
    }
  }
});

test('what Slack answered the share of a post with files decides the record, by that method’s own refusals', async (t) => {
  const cases: { what: string; answer: () => unknown; state: 'sending' | 'failed' }[] = [
    { what: 'a dropped connection', answer: () => DROP, state: 'sending' },
    { what: 'internal_error', answer: () => ({ ok: false, error: 'internal_error' }), state: 'sending' },
    {
      what: 'an error Slack never documented',
      answer: () => ({ ok: false, error: 'something_new_went_wrong' }),
      state: 'sending',
    },
    {
      what: 'a refusal listed for messages only: restricted_action',
      answer: () => ({ ok: false, error: 'restricted_action' }),
      state: 'sending',
    },
    {
      what: 'Slack refusing: posting_to_channel_denied',
      answer: () => ({ ok: false, error: 'posting_to_channel_denied' }),
      state: 'failed',
    },
  ];
  for (const { what, answer, state: expected } of cases) {
    const { harness, fake, uploads, report } = await world(t);
    const { send, state } = await prepared(harness, fake.fetch, [report]);
    // The share is recorded — for all a test can tell, Slack has made the files visible — and answered with this case.
    const share = fake.script['files.completeUploadExternal'];
    fake.script['files.completeUploadExternal'] = (seen) => {
      share?.(seen);
      return answer();
    };
    const outcomes = recordedOutcomes(harness);

    const error = await send().then(
      () => assert.fail(`${what}: reported as posted`),
      (thrown: unknown) => thrown,
    );
    assert.ok(error instanceof CommsError, `${what}: ${String(error)}`);
    assert.equal(uploads.completed.length, 1, `${what}: the files were not shared`);
    assert.equal(await state(), expected, what);
    const [record] = await audited(harness);
    assert.equal(record?.outcome, 'failed', what);
    assert.deepEqual(record?.ids?.files, [uploads.issued[0]?.fileId], what);
    if (expected === 'sending') {
      assert.match(error.message, /^whether the files were posted is not known: /, what);
      assert.equal(error.details?.outcome, 'unknown', what);
      assert.deepEqual(error.details?.uploaded, [{ id: uploads.issued[0]?.fileId, name: 'report.pdf' }], what);
      // Before the change, `failed`: files that may be in the channel, recorded as a post that did not happen.
      assert.deepEqual(outcomes, [], `${what}: an outcome nobody knows was recorded`);
      assert.match(record?.reason ?? '', /^outcome unknown: /, what);
    } else {
      assert.match(error.message, /^the post failed: /, what);
      assert.deepEqual(outcomes, ['failed'], what);
      assert.doesNotMatch(record?.reason ?? '', /unknown/, what);
    }
  }
});

// ── A post that happened ───────────────────────────────────────────────────────────────────────────────────────

test('a post Slack accepted whose approval then cannot be marked used is a post: never failed, and the result says so', async (t) => {
  for (const withFiles of [false, true]) {
    const what = withFiles ? 'with files' : 'words alone';
    const { harness, fake, report, posted, uploads } = await world(t);
    const { send, state } = await prepared(harness, fake.fetch, withFiles ? [report] : []);
    // The completion's write fails — the store's lock held past its timeout, say — once Slack has the post.
    const store = harness.core.approvals;
    const complete = store.complete.bind(store);
    const asked: string[] = [];
    store.complete = async (approvalId, claimToken, outcome) => {
      asked.push('error' in outcome ? 'failed' : 'used');
      if ('sentMessageId' in outcome) {
        throw new CommsError('LOCK_TIMEOUT', 'another agent-communications process is holding the approval');
      }
      return complete(approvalId, claimToken, outcome);
    };

    const result = await send();
    assert.equal(result.ts, TS, what);
    assert.match(
      result.note ?? '',
      /the approval could not be marked used \(another agent-communications process is holding the approval\)/,
      what,
    );
    assert.equal(withFiles ? uploads.completed.length : posted(), 1, what);
    // Before the change the failure path ran next, and the post Slack accepted was recorded as failed.
    assert.deepEqual(asked, ['used'], `${what}: a failure was recorded after the post was accepted`);
    assert.equal(await state(), 'sending', what);
    const [record] = await audited(harness);
    assert.equal(record?.outcome, 'ok', what);
    assert.equal(record?.ids?.ts, TS, what);
    assert.match(record?.reason ?? '', /the approval could not be marked used/, what);
  }
});

test('a post Slack accepted whose audit record then cannot be written is a post, and the result says the record is missing', async (t) => {
  const { harness, fake, posted } = await world(t);
  const { draft, send, state } = await prepared(harness, fake.fetch);
  const audit = harness.core.audit;
  const append = audit.append.bind(audit);
  audit.append = async (record, ...rest) => {
    if (record.operation === 'slack.post') throw new Error('EROFS: read-only file system');
    return append(record, ...rest);
  };

  const result = await send();
  assert.equal(result.ts, TS);
  assert.equal(result.approvalId, draft.approvalId);
  assert.match(result.note ?? '', /the audit log could not record it \(EROFS: read-only file system\)/);
  assert.equal(posted(), 1);
  assert.equal(await state(), 'used');
});
