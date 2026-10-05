import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { type TestContext, test } from 'node:test';
import { CommsError, deriveLegacyV1State } from '@agentcomms/core';
import {
  readV1Record,
  v1RecordPath,
  v1SendRecord,
  writeV1Record,
} from '../../core/test/fixtures/approval-v1-0.13.0.ts';
import { SlackContext } from '../src/context.ts';
import { beginApproval, finishApproval, revokeApproval } from '../src/operations/approve.ts';
import { prepareDraftPost, react, sendPost } from '../src/operations/post.ts';
import { startFakeSlack } from './support/fake-slack.ts';
import { newHarness } from './support/harness.ts';

/*
 * A post and a reaction 0.13.0 prepared (digest version 1) meet this release's Slack gate (CUE-404 Task 1). Neither
 * is posted, reacted with or approved here, and nothing is written to them; the approval screen refuses before it
 * reads the room or the draft. A person's cancel at `agent-slack approve` retires one in its own shape.
 */

const POST_ID = `ap_${'0'.repeat(25)}1`;
const REACTION_ID = `ap_${'0'.repeat(25)}2`;
const TS = '1700000000.000100';

async function world(t: TestContext, ageMs: number) {
  const harness = await newHarness();
  const account = await harness.addWorkspace({ alias: 'acme', mode: 'send' });
  const fake = await startFakeSlack({
    'conversations.info': () => ({ ok: true, channel: { id: 'C1', name: 'eng', num_members: 4, is_member: true } }),
    'chat.postMessage': () => ({ ok: true, ts: TS }),
    'reactions.add': () => ({ ok: true }),
  });
  t.after(() => fake.close());
  const context = new SlackContext({ core: harness.core, env: harness.env, surface: 'mcp' });
  // A real draft for the post to name: the version refusal must come before it matters what is in it.
  const draft = await prepareDraftPost(context, 'acme', { channel: 'C1', text: 'the report' }, { fetch: fake.fetch });
  const createdAt = new Date(Date.now() - ageMs).toISOString();
  const stateDir = harness.core.paths.stateDir;
  const records = {
    post: v1SendRecord({
      approvalId: POST_ID,
      inboxId: account.id,
      inboxSub: account.userId,
      draftId: draft.draftId,
      draftMessageId: 'rev-at-prepare',
      digest: 'b'.repeat(64),
      expect: { to: ['C1'], cc: [], bcc: [], subject: 'reaches 4' },
      createdAt,
    }),
    reaction: v1SendRecord({
      approvalId: REACTION_ID,
      inboxId: account.id,
      inboxSub: account.userId,
      draftId: `reaction:C1:${TS}`,
      draftMessageId: 'c'.repeat(64),
      digest: 'c'.repeat(64),
      expect: { to: ['C1'], cc: [], bcc: [], subject: `:thumbsup: on ${TS}` },
      createdAt,
    }),
  };
  const bytes = { post: writeV1Record(stateDir, records.post), reaction: writeV1Record(stateDir, records.reaction) };
  return { context, fake, draftId: draft.draftId, stateDir, records, bytes };
}

function isVersionRefusal(e: unknown): boolean {
  return (
    e instanceof CommsError &&
    e.code === 'APPROVAL_VOID' &&
    /prepared by a different version of agent-communications/.test(e.message)
  );
}

test('a version-1 post or reaction is never posted, reacted with or approved here, and nothing is written', async (t) => {
  for (const [moment, age] of [
    ['fresh', 60 * 1000],
    ['past its original expiry', 11 * 60 * 1000],
  ] as const) {
    const { context, fake, draftId, stateDir, bytes } = await world(t, age);
    const slack = { fetch: fake.fetch };
    await assert.rejects(
      sendPost(context, 'acme', { draftId, approvalId: POST_ID, expectChannel: 'C1' }, slack),
      isVersionRefusal,
      `post, ${moment}`,
    );
    await assert.rejects(
      react(context, 'acme', { channel: 'C1', ts: TS, name: 'thumbsup' }, REACTION_ID, slack),
      isVersionRefusal,
      `reaction, ${moment}`,
    );
    // The approval screen, both halves, before the room or the draft is read.
    const asked = fake.requests.length;
    for (const approvalId of [POST_ID, REACTION_ID]) {
      await assert.rejects(beginApproval(context, approvalId, slack), isVersionRefusal, `begin ${approvalId}`);
      await assert.rejects(
        finishApproval(context, approvalId, 'ABCD', slack),
        isVersionRefusal,
        `finish ${approvalId}`,
      );
    }
    assert.equal(fake.requests.length, asked, `${moment}: approving asked Slack nothing`);
    assert.equal(fake.requests.filter((seen) => seen.method === 'chat.postMessage').length, 0, 'nothing was posted');
    assert.equal(fake.requests.filter((seen) => seen.method === 'reactions.add').length, 0, 'nothing was reacted');
    for (const [approvalId, original] of [
      [POST_ID, bytes.post],
      [REACTION_ID, bytes.reaction],
    ] as const) {
      assert.equal(readV1Record(stateDir, approvalId), original, `${approvalId}, ${moment}: byte-identical`);
      assert.equal(existsSync(v1RecordPath(stateDir, approvalId, '.claim')), false, `${moment}: no claim marker`);
    }
  }
});

test('cancelling a fresh version-1 post at agent-slack approve writes a v1-shaped revoked', async (t) => {
  const { context, stateDir, records } = await world(t, 60 * 1000);
  for (const [approvalId, original] of [
    [POST_ID, records.post],
    [REACTION_ID, records.reaction],
  ] as const) {
    await revokeApproval(context, approvalId);
    const after = JSON.parse(readV1Record(stateDir, approvalId)) as Record<string, unknown>;
    assert.equal(after.digestVersion, 1);
    assert.equal('kind' in after, false, 'a v1 send stays without a kind');
    assert.notEqual(after.updatedAt, original.updatedAt);
    assert.deepStrictEqual(after, {
      ...original,
      state: 'revoked',
      reason: 'cancelled at the terminal',
      updatedAt: after.updatedAt,
    });
    assert.equal(existsSync(v1RecordPath(stateDir, approvalId, '.claim')), false);
    assert.equal(deriveLegacyV1State(after as never, new Date()).state, 'revoked');
  }
});
