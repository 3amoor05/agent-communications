import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { afterEach, test } from 'node:test';
import { asV2, CommsError, deriveLegacyV1State } from '@agentcomms/core';
import {
  readV1Record,
  v1RecordPath,
  v1SendRecord,
  writeV1Record,
} from '../../core/test/fixtures/approval-v1-0.13.0.ts';
import {
  beginSendApproval,
  executeSend,
  finishSendApproval,
  prepareSend,
  revokeSendApproval,
} from '../src/operations/send.ts';
import { type Harness, newHarness } from './support/harness.ts';

/*
 * A send approval 0.13.0 prepared (digest version 1) meets this release's Resend gate (CUE-404 Task 1). It is never
 * executed or approved here — the approval screen refuses before it reads the stored message again — nothing is
 * written to it, and nothing reaches Resend. A person's cancel at `agent-resend approve` retires it in its own shape.
 */

let harness: Harness;
afterEach(async () => {
  await harness?.close();
});

const FRESH_ID = `ap_${'0'.repeat(25)}1`;
const APPROVED_ID = `ap_${'0'.repeat(25)}2`;
const EXPECT = { to: ['sam@partner.test'], cc: [], bcc: [], subject: 'Phase 2 plan' };

async function withLegacy(ageMs: number) {
  harness = await newHarness();
  const account = await harness.addAccount({ name: 'acme/resend', mode: 'send' });
  const context = harness.context('mcp');
  // A message prepared on this machine, so the stored one a record names is really there: the refusal comes first.
  const prepared = await prepareSend(context, 'acme/resend', {
    from: 'Acme <hello@acme.test>',
    to: EXPECT.to,
    subject: EXPECT.subject,
    text: 'Hi Sam, the plan is attached to the thread.',
  });
  const stored = asV2(await harness.core.approvals.get(prepared.approvalId));
  assert.ok(stored);
  const createdAt = new Date(Date.now() - ageMs).toISOString();
  const fields = {
    inboxId: account.id,
    inboxSub: account.userId,
    draftId: stored.draftId,
    draftMessageId: stored.contentDigest,
    digest: stored.contentDigest,
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
      approvedDigest: stored.contentDigest,
      approvedVia: 'terminal',
    }),
  };
  const stateDir = harness.core.paths.stateDir;
  const bytes = { fresh: writeV1Record(stateDir, records.fresh), approved: writeV1Record(stateDir, records.approved) };
  return { context, stateDir, records, bytes };
}

function isVersionRefusal(e: unknown): boolean {
  return (
    e instanceof CommsError &&
    e.code === 'APPROVAL_VOID' &&
    /prepared by a different version of agent-communications/.test(e.message)
  );
}

test('a version-1 send is refused at execute and at terminal approval, nothing is written, and nothing reaches Resend', async () => {
  for (const [moment, age] of [
    ['fresh', 60 * 1000],
    ['past its original expiry', 11 * 60 * 1000],
  ] as const) {
    const { context, stateDir, bytes } = await withLegacy(age);
    for (const [approvalId, original] of [
      [FRESH_ID, bytes.fresh],
      [APPROVED_ID, bytes.approved],
    ] as const) {
      await assert.rejects(
        executeSend(context, 'acme/resend', { approvalId, expect: EXPECT }),
        isVersionRefusal,
        `execute ${approvalId}, ${moment}`,
      );
      await assert.rejects(beginSendApproval(context, approvalId), isVersionRefusal, `begin ${approvalId}, ${moment}`);
      await assert.rejects(
        finishSendApproval(context, approvalId, 'ABCD'),
        isVersionRefusal,
        `finish ${approvalId}, ${moment}`,
      );
      assert.equal(readV1Record(stateDir, approvalId), original, `${approvalId}, ${moment}: byte-identical`);
      assert.equal(existsSync(v1RecordPath(stateDir, approvalId, '.claim')), false, `${moment}: no claim marker`);
    }
    assert.equal(harness.fake.sends().length, 0, `${moment}: nothing reached Resend's send route`);
    await harness.close();
  }
});

test('cancelling a fresh version-1 send at agent-resend approve writes a v1-shaped revoked', async () => {
  const { context, stateDir, records } = await withLegacy(60 * 1000);
  for (const [approvalId, original] of [
    [FRESH_ID, records.fresh],
    [APPROVED_ID, records.approved],
  ] as const) {
    await revokeSendApproval(context, approvalId);
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
