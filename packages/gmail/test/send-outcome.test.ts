import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ApprovalStore, CommsError, SENDING_STALE_MS } from '@agentcomms/core';
import { renderSent } from '../src/cli/render.ts';
import { GmailContext } from '../src/context.ts';
import { mapGoogleError, sendCertainlyRefused } from '../src/gmail-api/errors.ts';
import { createDraft } from '../src/operations/drafts.ts';
import { executeSend, prepareSend } from '../src/operations/send.ts';
import { type Harness, newHarness } from './support/harness.ts';

/**
 * Once the request has left, a failed answer and a failed send are different facts. These tests keep the approval on
 * the honest side of that difference: failed only when Gmail certainly refused, sending when the outcome is unknown,
 * and used whenever Gmail answered that it sent the message even if the local bookkeeping then broke.
 */

async function world(): Promise<{ harness: Harness; context: GmailContext; draftId: string }> {
  const harness = await newHarness({
    accounts: [
      {
        sub: 'sub-1',
        email: 'jo@example.test',
        sendAs: [{ sendAsEmail: 'jo@example.test', displayName: 'Jo Example', isDefault: true, isPrimary: true }],
      },
    ],
  });
  await harness.connectInbox({ alias: 'work', email: 'jo@example.test', sub: 'sub-1', sendPolicy: 'chat' });
  const context = new GmailContext({ core: harness.core, env: harness.env });
  const draft = await createDraft(context, 'work', {
    to: ['sam@partner.test'],
    subject: 'Tuesday',
    text: 'Tuesday works for me.',
  });
  return { harness, context, draftId: draft.draftId };
}

async function prepared(setup: Awaited<ReturnType<typeof world>>) {
  const approval = await prepareSend(setup.context, 'work', setup.draftId);
  const send = () =>
    executeSend(setup.context, 'work', {
      draftId: setup.draftId,
      approvalId: approval.approvalId,
      expect: approval.expect,
    });
  const state = async () => (await setup.harness.core.approvals.get(approval.approvalId))?.state;
  return { approval, send, state };
}

test('Gmail’s certain-refusal classifier is a narrow allowlist', () => {
  for (const status of [400, 401, 403, 404, 429]) {
    const mapped = mapGoogleError({ response: { status, data: { error: { code: status, message: 'refused' } } } });
    assert.equal(sendCertainlyRefused(mapped), true, String(status));
  }
  for (const status of [405, 408, 409, 422, 500]) {
    const mapped = mapGoogleError({ response: { status, data: { error: { code: status, message: 'uncertain' } } } });
    assert.equal(sendCertainlyRefused(mapped), false, String(status));
  }
  assert.equal(sendCertainlyRefused(mapGoogleError(new Error('connection dropped'))), false);
  assert.equal(sendCertainlyRefused(new CommsError('SEND_REFUSED', 'the local guard stopped it')), true);
});

test('Gmail acting before its answer is lost leaves the approval sending and tells the person where to check', async () => {
  const setup = await world();
  const { approval, send, state } = await prepared(setup);
  setup.harness.google.afterSend = () => ({
    status: 500,
    body: { error: { code: 500, message: 'the answer was lost after Gmail accepted the draft' } },
  });

  const error = await send().then(
    () => assert.fail('the lost answer was reported as a confirmed send'),
    (thrown: unknown) => thrown,
  );
  assert.ok(error instanceof CommsError);
  assert.match(error.message, /^whether the email was sent is not known:/);
  assert.match(error.hint ?? '', /Sent folder/);
  assert.equal(error.details?.outcome, 'unknown');
  assert.equal(await state(), 'sending');
  const later = new ApprovalStore(setup.harness.core.paths.stateDir, {
    now: () => new Date(Date.now() + SENDING_STALE_MS),
  });
  assert.equal((await later.get(approval.approvalId))?.state, 'unknown');
  assert.equal(setup.harness.google.requests.filter((request) => request.path.endsWith('/send')).length, 1);
  const account = setup.harness.google.accounts.get('sub-1');
  assert.equal(
    Object.values(account?.messages ?? {}).filter((message) => message.labelIds?.includes('SENT')).length,
    1,
  );
  const audit = await setup.harness.core.audit.tail({ inbox: 'work' });
  const outcome = audit.findLast((entry) => entry.operation === 'send.execute');
  assert.equal(outcome?.outcome, 'failed');
  assert.match(outcome?.reason ?? '', /^outcome unknown:/);
  assert.equal(Array.isArray(outcome?.ids?.approvalIds), true);
  assert.equal((outcome?.ids?.approvalIds as string[] | undefined)?.[0], approval.approvalId);
});

test('only Gmail responses documented as pre-action refusals mark the approval failed', async (t) => {
  for (const status of [400, 401, 403, 404, 429]) {
    await t.test(String(status), async () => {
      const setup = await world();
      const { send, state } = await prepared(setup);
      setup.harness.google.failNext('/gmail/v1/users/me/drafts/send', 1, status);

      const error = await send().then(
        () => assert.fail(`${status} was reported as a send`),
        (thrown: unknown) => thrown,
      );
      assert.ok(error instanceof CommsError);
      assert.equal(await state(), 'failed');
      assert.doesNotMatch(error.message, /not known/);
      assert.equal(error.details?.outcome, undefined);

      const retry = await send().then(
        () => assert.fail(`${status} reused a failed approval`),
        (thrown: unknown) => thrown,
      );
      assert.ok(retry instanceof CommsError);
      assert.match(retry.message, /the send under this approval was refused; nothing was sent/);
    });
  }

  await t.test('422 is not one of Gmail’s documented responses', async () => {
    const setup = await world();
    const { send, state } = await prepared(setup);
    setup.harness.google.failNext('/gmail/v1/users/me/drafts/send', 1, 422);

    const error = await send().then(
      () => assert.fail('422 was reported as a send'),
      (thrown: unknown) => thrown,
    );
    assert.ok(error instanceof CommsError);
    assert.equal(await state(), 'sending');
    assert.equal(error.details?.outcome, 'unknown');
  });
});

test('Gmail success is never rewritten when its approval or audit bookkeeping fails', async (t) => {
  await t.test('approval record', async () => {
    const setup = await world();
    const { send, state } = await prepared(setup);
    const store = setup.harness.core.approvals;
    const complete = store.complete.bind(store);
    store.complete = async (approvalId, outcome) => {
      if ('sentMessageId' in outcome) throw new Error('approval disk is read-only');
      return complete(approvalId, outcome);
    };

    const result = await send();
    assert.ok(result.sentMessageId);
    assert.match(result.note ?? '', /the approval could not be marked used \(approval disk is read-only\)/);
    assert.match(renderSent(result, false), /approval could not be marked used/);
    assert.equal(await state(), 'sending');
  });

  await t.test('audit record', async () => {
    const setup = await world();
    const { send, state } = await prepared(setup);
    const audit = setup.harness.core.audit;
    const append = audit.append.bind(audit);
    audit.append = async (record, ...rest) => {
      if (record.operation === 'send.execute' && record.outcome === 'ok') {
        throw new Error('audit disk is read-only');
      }
      return append(record, ...rest);
    };

    const result = await send();
    assert.ok(result.sentMessageId);
    assert.match(result.note ?? '', /the audit log could not record it \(audit disk is read-only\)/);
    assert.match(renderSent(result, false), /audit log could not record it/);
    assert.equal(await state(), 'used');
  });
});
