import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';
import { ApprovalStore, CommsError, SENDING_STALE_MS } from '@agentcomms/core';
import { writeOutcomeOf } from '../src/api/client.ts';
import { renderSent } from '../src/cli/render.ts';
import { SendRecords } from '../src/compose/store.ts';
import { executeSend, prepareSend } from '../src/operations/send.ts';
import { type Harness, newHarness } from './support/harness.ts';

/**
 * A response says a send was refused only when Resend documents it as a pre-action answer. Everything else may be an
 * email the provider has already accepted, and local bookkeeping after a confirmed acceptance cannot change that.
 */

let harness: Harness;
afterEach(async () => {
  await harness?.close();
});

const message = {
  from: 'Acme <hello@acme.test>',
  to: ['sam@partner.test'],
  subject: 'Phase 2 plan',
  text: 'Hi Sam, the plan is attached to the thread.',
};

async function prepared() {
  harness = await newHarness();
  await harness.addAccount({ name: 'acme/resend', mode: 'send' });
  const context = harness.context();
  const approval = await prepareSend(context, 'acme/resend', message);
  const send = () => executeSend(context, 'acme/resend', { approvalId: approval.approvalId, expect: approval.expect });
  const state = async () => (await harness.core.approvals.get(approval.approvalId))?.state;
  return { context, approval, send, state };
}

test('Resend’s certain-refusal classifier is a narrow allowlist', () => {
  for (const status of [400, 401, 403, 404, 422, 429]) assert.equal(writeOutcomeOf(status), 'not-sent', String(status));
  for (const status of [405, 408, 409, 500]) assert.equal(writeOutcomeOf(status), 'unknown', String(status));
  assert.equal(writeOutcomeOf(undefined), 'unknown', 'no answer');
});

test('Resend acting before its answer is lost leaves the approval sending and tells the person where to check', async (t) => {
  for (const [what, answer] of [
    ['a 502', { status: 502, body: { name: 'application_error', message: 'upstream' } }],
    ['a dropped connection', { status: 0, drop: true }],
  ] as const) {
    await t.test(what, async () => {
      const { approval, send, state } = await prepared();
      harness.fake.afterSend = () => answer;

      const error = await send().then(
        () => assert.fail(`${what} was reported as a confirmed send`),
        (thrown: unknown) => thrown,
      );
      assert.ok(error instanceof CommsError);
      assert.match(error.message, /^whether the email was sent is not known:/);
      assert.match(error.hint ?? '', /Resend dashboard or ask the recipient/);
      assert.equal(error.details?.outcome, 'unknown');
      assert.equal(await state(), 'sending');
      const later = new ApprovalStore(harness.core.paths.stateDir, {
        now: () => new Date(Date.now() + SENDING_STALE_MS),
      });
      assert.equal((await later.get(approval.approvalId))?.state, 'unknown');
      assert.equal(harness.fake.sent.length, 1, 'Resend accepted one email');
      const local = await new SendRecords(harness.core.paths.stateDir).summary(
        (await harness.core.config.load()).accounts['acme/resend']?.id ?? '',
        approval.approvalId,
      );
      assert.equal(local?.state, 'unknown');
    });
  }
});

test('only Resend responses documented as pre-action refusals mark the approval failed', async (t) => {
  for (const status of [400, 401, 403, 404, 422, 429]) {
    await t.test(String(status), async () => {
      const { send, state } = await prepared();
      harness.fake.intercept = (request) =>
        request.method === 'POST' && request.path === '/emails'
          ? { status, body: { name: 'validation_error', message: 'refused before sending' } }
          : undefined;

      const error = await send().then(
        () => assert.fail(`${status} was reported as a send`),
        (thrown: unknown) => thrown,
      );
      assert.ok(error instanceof CommsError);
      assert.equal(error.details?.outcome, 'not-sent');
      assert.equal(await state(), 'failed');
      assert.equal(harness.fake.sent.length, 0);

      const retry = await send().then(
        () => assert.fail(`${status} reused a failed approval`),
        (thrown: unknown) => thrown,
      );
      assert.ok(retry instanceof CommsError);
      assert.match(retry.message, /the send under this approval was refused; nothing was sent/);
      assert.equal(retry.hint, 'Prepare the send again if it should still go.');
    });
  }

  await t.test('409 is an idempotency conflict whose outcome is unknown', async () => {
    const { send, state } = await prepared();
    harness.fake.intercept = (request) =>
      request.method === 'POST' && request.path === '/emails'
        ? { status: 409, body: { name: 'invalid_idempotent_request', message: 'already in progress' } }
        : undefined;

    const error = await send().then(
      () => assert.fail('409 was reported as a send'),
      (thrown: unknown) => thrown,
    );
    assert.ok(error instanceof CommsError);
    assert.equal(error.details?.outcome, 'unknown');
    assert.equal(await state(), 'sending');
  });
});

test('Resend success is never rewritten when its approval, send record or audit bookkeeping fails', async (t) => {
  await t.test('approval record', async () => {
    const { send, state } = await prepared();
    const store = harness.core.approvals;
    const complete = store.complete.bind(store);
    store.complete = async (approvalId, outcome) => {
      if ('sentMessageId' in outcome) throw new Error('approval disk is read-only');
      return complete(approvalId, outcome);
    };

    const result = await send();
    assert.ok(result.resendId);
    assert.match(result.note ?? '', /the approval could not be marked used \(approval disk is read-only\)/);
    assert.match(renderSent(result), /approval could not be marked used/);
    assert.equal(await state(), 'sending');
  });

  await t.test('send record', async () => {
    const { send, state } = await prepared();
    const record = SendRecords.prototype.record;
    SendRecords.prototype.record = async function (accountId, line) {
      if (line.event === 'sent') throw new Error('send record disk is read-only');
      return record.call(this, accountId, line);
    };
    try {
      const result = await send();
      assert.ok(result.resendId);
      assert.match(result.note ?? '', /the send record could not record it \(send record disk is read-only\)/);
      assert.match(renderSent(result), /send record could not record it/);
      assert.equal(await state(), 'used');
    } finally {
      SendRecords.prototype.record = record;
    }
  });

  await t.test('audit record', async () => {
    const { send, state } = await prepared();
    const audit = harness.core.audit;
    const append = audit.append.bind(audit);
    audit.append = async (record, ...rest) => {
      if (record.operation === 'resend.send.execute' && record.outcome === 'ok') {
        throw new Error('audit disk is read-only');
      }
      return append(record, ...rest);
    };

    const result = await send();
    assert.ok(result.resendId);
    assert.match(result.note ?? '', /the audit log could not record it \(audit disk is read-only\)/);
    assert.match(renderSent(result), /audit log could not record it/);
    assert.equal(await state(), 'used');
  });
});
