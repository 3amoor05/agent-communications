import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { test } from 'node:test';
import { asV2, CommsError, LEGACY_DRAIN_REASON } from '@agentcomms/core';
import { readV1Record, v1SendRecord, writeV1Record } from '../../core/test/fixtures/approval-v1-0.13.0.ts';
import { GmailContext } from '../src/context.ts';
import { createDraft } from '../src/operations/drafts.ts';
import { inboxPolicy } from '../src/operations/inboxes.ts';
import { executeSend, finishApproval, prepareSend } from '../src/operations/send.ts';
import { newHarness } from './support/harness.ts';

/*
 * Every Gmail operation that relies on the send epoch makes the configuration version 3 first (CUE-404 Task 4): a
 * prepare, a claim, an approval and a send-policy write each find the file as an earlier release left it and convert
 * it before anything else — and a send an earlier release left waiting is retired on the way.
 */

const LEGACY_ID = `ap_${'0'.repeat(25)}1`;
const EXPECT = { to: ['sam@partner.test'], cc: [], bcc: [], subject: 'Tuesday' };

async function connected() {
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
  // Escalation off, with the consent a terminal would have obtained: the send under test goes on `chat`.
  await harness.core.config.update(
    (config) => ({ ...config, defaults: { ...config.defaults, riskEscalation: false } }),
    { consent: { kind: 'loosening-consent', paths: ['defaults.riskEscalation'] } },
  );
  const context = new GmailContext({ core: harness.core, env: harness.env });
  return { harness, inbox, context, file: harness.core.config.path };
}

const versionOf = (file: string) => (JSON.parse(readFileSync(file, 'utf8')) as { version: number }).version;

/** The file as the earlier release it came from left it: its own version, nothing of version 3. */
function asEarlierRelease(file: string, version: 1 | 2): void {
  const { naming: _naming, sendEpochs: _epochs, legacyDrain: _drain, ...rest } = JSON.parse(readFileSync(file, 'utf8'));
  writeFileSync(file, `${JSON.stringify({ ...rest, version }, null, 2)}\n`);
}

test('a prepare, a claim, an approval and a send-policy write each convert the configuration to version 3 first', async () => {
  const { harness, inbox, context, file } = await connected();
  assert.equal(versionOf(file), 1, 'the harness starts where an earlier release left it');
  const stateDir = harness.core.paths.stateDir;
  const draft = await createDraft(context, 'work', { to: EXPECT.to, subject: EXPECT.subject, text: 'Tuesday works.' });
  const waiting = writeV1Record(
    stateDir,
    v1SendRecord({
      approvalId: LEGACY_ID,
      inboxId: inbox.id,
      inboxSub: 'sub-1',
      draftId: draft.draftId,
      draftMessageId: 'msg-v1',
      digest: 'a'.repeat(64),
      expect: EXPECT,
      createdAt: new Date(Date.now() - 60_000).toISOString(),
    }),
  );

  // Prepare: converted, and the earlier release's waiting send retired in its own shape before the new one is made.
  const prepared = await prepareSend(context, 'work', draft.draftId);
  assert.equal(versionOf(file), 3);
  assert.deepEqual(prepared.legacyDrain, { couldNotRevoke: [], inFlight: [] });
  const retired = JSON.parse(readV1Record(stateDir, LEGACY_ID)) as Record<string, unknown>;
  assert.deepEqual(retired, {
    ...JSON.parse(waiting),
    state: 'revoked',
    reason: LEGACY_DRAIN_REASON,
    updatedAt: retired.updatedAt,
  });
  assert.equal(asV2(await harness.core.approvals.get(prepared.approvalId))?.sendEpoch, 0);

  // Claim.
  asEarlierRelease(file, 1);
  const sent = await executeSend(context, 'work', {
    draftId: draft.draftId,
    approvalId: prepared.approvalId,
    expect: EXPECT,
  });
  assert.ok(sent.sentMessageId);
  assert.equal(versionOf(file), 3);

  // Approval: refused — there is nothing to approve — but only after the conversion.
  asEarlierRelease(file, 1);
  await assert.rejects(finishApproval(context, `ap_${'0'.repeat(25)}9`, 'ABCD'), CommsError);
  assert.equal(versionOf(file), 3);

  // A send-policy write converts, then raises the epoch it fences; a change-policy write alone converts nothing.
  asEarlierRelease(file, 1);
  await inboxPolicy(context, 'work', { changePolicy: 'confirm' });
  assert.equal(versionOf(file), 1);
  await inboxPolicy(context, 'work', { sendPolicy: 'never' });
  const written = JSON.parse(readFileSync(file, 'utf8')) as { version: number; sendEpochs?: Record<string, number> };
  assert.equal(written.version, 3);
  assert.deepEqual(written.sendEpochs, { [inbox.id]: 1 });
});
