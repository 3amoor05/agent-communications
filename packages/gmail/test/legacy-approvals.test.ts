import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { test } from 'node:test';
import { CommsError, deriveLegacyV1State, stateOf } from '@agentcomms/core';
import {
  readV1Record,
  v1RecordPath,
  v1SendRecord,
  writeV1Record,
} from '../../core/test/fixtures/approval-v1-0.13.0.ts';
import { GmailContext } from '../src/context.ts';
import { createDraft } from '../src/operations/drafts.ts';
import { beginApproval, executeSend, finishApproval, revokeApproval } from '../src/operations/send.ts';
import { newHarness } from './support/harness.ts';

/*
 * A send approval 0.13.0 prepared (digest version 1) meets this release's Gmail gate (CUE-404 Task 1). It is never
 * executed or approved here — the version refusal comes before the draft is read, so no provider read is made for it
 * and nothing is written to it — and a person's cancel retires it in its own shape, so a running 0.13 process can no
 * longer claim it either.
 */

const FRESH_ID = `ap_${'0'.repeat(25)}1`;
const APPROVED_ID = `ap_${'0'.repeat(25)}2`;
const EXPECT = { to: ['sam@partner.test'], cc: [], bcc: [], subject: 'Tuesday' };

async function withLegacy(ageMs: number) {
  const harness = await newHarness({
    accounts: [
      {
        sub: 'sub-1',
        email: 'jo@example.test',
        sendAs: [{ sendAsEmail: 'jo@example.test', displayName: 'Jo Example', isDefault: true, isPrimary: true }],
      },
    ],
  });
  const inbox = await harness.connectInbox({
    alias: 'work',
    email: 'jo@example.test',
    sub: 'sub-1',
    sendPolicy: 'chat',
  });
  const context = new GmailContext({ core: harness.core, env: harness.env });
  const draft = await createDraft(context, 'work', { to: EXPECT.to, subject: EXPECT.subject, text: 'Tuesday works.' });
  const createdAt = new Date(Date.now() - ageMs).toISOString();
  const stateDir = harness.core.paths.stateDir;
  const fields = {
    inboxId: inbox.id,
    inboxSub: 'sub-1',
    draftId: draft.draftId,
    draftMessageId: 'msg-at-prepare',
    digest: 'a'.repeat(64),
    expect: EXPECT,
    createdAt,
  };
  const records = {
    fresh: v1SendRecord({ ...fields, approvalId: FRESH_ID }),
    approved: v1SendRecord({
      ...fields,
      approvalId: APPROVED_ID,
      policy: 'confirm',
      state: 'approved',
      approvedDigest: 'a'.repeat(64),
      approvedVia: 'terminal',
    }),
  };
  const bytes = { fresh: writeV1Record(stateDir, records.fresh), approved: writeV1Record(stateDir, records.approved) };
  return { harness, context, draftId: draft.draftId, stateDir, records, bytes };
}

function isVersionRefusal(e: unknown): boolean {
  return (
    e instanceof CommsError &&
    e.code === 'APPROVAL_VOID' &&
    /prepared by a different version of agent-communications/.test(e.message)
  );
}

test('a version-1 send is refused at execute and at terminal approval before the draft is read, and nothing is written', async () => {
  for (const [moment, age] of [
    ['fresh', 60 * 1000],
    ['past its original expiry', 11 * 60 * 1000],
  ] as const) {
    const { harness, context, draftId, stateDir, bytes } = await withLegacy(age);
    const before = harness.google.requests.length;
    for (const [approvalId, original] of [
      [FRESH_ID, bytes.fresh],
      [APPROVED_ID, bytes.approved],
    ] as const) {
      await assert.rejects(
        executeSend(context, 'work', { draftId, approvalId, expect: EXPECT }),
        isVersionRefusal,
        `execute ${approvalId}, ${moment}`,
      );
      await assert.rejects(beginApproval(context, approvalId), isVersionRefusal, `begin ${approvalId}, ${moment}`);
      await assert.rejects(
        finishApproval(context, approvalId, 'ABCD'),
        isVersionRefusal,
        `finish ${approvalId}, ${moment}`,
      );
      assert.equal(readV1Record(stateDir, approvalId), original, `${approvalId}, ${moment}: byte-identical`);
      assert.equal(existsSync(v1RecordPath(stateDir, approvalId, '.claim')), false, `${moment}: no claim marker`);
    }
    const asked = harness.google.requests.slice(before);
    assert.deepEqual(
      asked.filter((request) => request.path.includes('/drafts') || request.path.endsWith('/send')),
      [],
      `${moment}: neither the draft nor a send endpoint was asked for`,
    );
  }
});

test('cancelling a fresh version-1 send in Gmail writes a v1-shaped revoked', async () => {
  const { context, stateDir, records } = await withLegacy(60 * 1000);
  for (const [approvalId, original] of [
    [FRESH_ID, records.fresh],
    [APPROVED_ID, records.approved],
  ] as const) {
    // What `gmail_send_cancel`, `agent-gmail send cancel` and Enter at `agent-gmail approve` all call.
    const result = await revokeApproval(context, approvalId);
    assert.equal(stateOf(result), 'revoked');
    const after = JSON.parse(readV1Record(stateDir, approvalId)) as Record<string, unknown>;
    assert.equal(typeof after.updatedAt, 'string');
    assert.equal(after.digestVersion, 1);
    assert.equal('kind' in after, false, 'a v1 send stays without a kind');
    assert.notEqual(after.updatedAt, original.updatedAt);
    assert.deepStrictEqual(after, { ...original, state: 'revoked', reason: 'cancelled', updatedAt: after.updatedAt });

    assert.equal(existsSync(v1RecordPath(stateDir, approvalId, '.claim')), false);
    assert.equal(deriveLegacyV1State(after as never, new Date()).state, 'revoked');
  }
});
