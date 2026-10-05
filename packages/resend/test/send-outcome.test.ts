import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';
import { ApprovalStore, asV2, CommsError, SENDING_LEASE_MS } from '@agentcomms/core';
import { writeOutcomeOf } from '../src/api/client.ts';
import { renderSent } from '../src/cli/render.ts';
import { SendRecords } from '../src/compose/store.ts';
import { executeSend, prepareSend } from '../src/operations/send.ts';
import { type Harness, newHarness } from './support/harness.ts';

/** A refusal's details apart from where its approval stands, which each test checks on its own (decision 8). */
function apartFromApproval(details: Record<string, unknown> | undefined): Record<string, unknown> {
  const { approval: _approval, ...rest } = details ?? {};
  return rest;
}
const approvalState = (error: CommsError) => (error.details?.approval as { state?: string } | undefined)?.state;

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
  const state = async () => asV2(await harness.core.approvals.get(approval.approvalId))?.state;
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
        now: () => new Date(Date.now() + SENDING_LEASE_MS),
        loadConfig: () => harness.core.config.load(),
      });
      assert.equal(asV2(await later.get(approval.approvalId))?.state, 'unknown');
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
      // The record's own state, classified before Resend is asked anything: refused for what it is.
      assert.match(retry.message, /^nothing was sent: the send it was claimed for failed/);
      assert.equal(retry.hint, 'Prepare the send again and show the new preview to the user.');
      assert.equal(approvalState(retry), 'failed');
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

test('every certain no-send path attempts release, approval, local record and audit independently', async (t) => {
  type Step = 'release' | 'approval' | 'record' | 'audit';
  const failureSets: ReadonlyArray<ReadonlyArray<Step>> = [
    ['release'],
    ['approval'],
    ['record'],
    ['audit'],
    ['release', 'approval'],
    ['release', 'record'],
    ['release', 'audit'],
    ['approval', 'record'],
    ['approval', 'audit'],
    ['record', 'audit'],
  ];
  const triggers = [
    'reservation failure',
    'attempt record',
    'started audit',
    'throttle preflight',
    'Resend refusal',
  ] as const;

  for (const trigger of triggers) {
    for (const failures of failureSets) {
      await t.test(`${trigger}; ${failures.join(' and ')} fail`, async () => {
        const { approval, context, send, state } = await prepared();
        const config = await harness.core.config.load();
        const accountId = config.accounts['acme/resend']?.id;
        assert.ok(accountId);
        const original: Error =
          trigger === 'throttle preflight'
            ? new Error('the throttle state could not be read before the request')
            : new CommsError('LOCK_TIMEOUT', `${trigger} stopped the send`, {
                hint: 'Keep the first hint.',
                details: { trigger },
              });
        if (trigger === 'Resend refusal') {
          harness.fake.intercept = (request) =>
            request.method === 'POST' && request.path === '/emails'
              ? { status: 400, body: { name: 'validation_error', message: 'Resend refused before sending' } }
              : undefined;
        }

        const calls: Step[] = [];
        const reserve = SendRecords.prototype.reserve;
        const release = SendRecords.prototype.release;
        const record = SendRecords.prototype.record;
        const complete = harness.core.approvals.complete.bind(harness.core.approvals);
        const append = harness.core.audit.append.bind(harness.core.audit);
        SendRecords.prototype.reserve = async function (...args) {
          await reserve.apply(this, args);
          if (trigger === 'reservation failure' && args[1] === approval.approvalId) {
            throw original;
          }
        };
        SendRecords.prototype.release = async function (id, approvalId) {
          calls.push('release');
          if (failures.includes('release')) throw new Error('release disk is read-only');
          return release.call(this, id, approvalId);
        };
        SendRecords.prototype.record = async function (id, line) {
          if (line.event === 'attempt' && trigger === 'attempt record') throw original;
          if (line.event === 'failed') {
            calls.push('record');
            if (failures.includes('record')) throw new Error('send record disk is read-only');
          }
          return record.call(this, id, line);
        };
        harness.core.approvals.complete = async (approvalId, claimToken, outcome) => {
          calls.push('approval');
          if (failures.includes('approval')) throw new Error('approval disk is read-only');
          return complete(approvalId, claimToken, outcome);
        };
        harness.core.audit.append = async (audit, ...rest) => {
          if (audit.operation !== 'resend.send.execute') return append(audit, ...rest);
          if (audit.outcome === 'started' && trigger === 'started audit') throw original;
          if (audit.outcome === 'failed') {
            calls.push('audit');
            if (failures.includes('audit')) throw new Error('audit disk is read-only');
          }
          return append(audit, ...rest);
        };
        if (trigger === 'throttle preflight') {
          context.throttle().before = async () => {
            throw original;
          };
        }

        try {
          const error = await send().then(
            () => assert.fail(`${trigger} was reported as a send`),
            (thrown: unknown) => thrown,
          );
          assert.ok(error instanceof CommsError, String(error));
          assert.deepEqual(calls, ['release', 'approval', 'record', 'audit']);
          if (original instanceof CommsError) {
            assert.ok(error.cause instanceof CommsError);
            const cause = error.cause as CommsError;
            assert.equal(error.code, cause.code);
            assert.equal(error.message, cause.message);
            assert.deepEqual(apartFromApproval(error.details), apartFromApproval(cause.details));
            if (trigger !== 'Resend refusal') assert.equal(cause, original);
            if (cause.hint !== undefined) assert.ok(error.hint?.startsWith(cause.hint));
          } else {
            assert.equal(error.code, 'UNEXPECTED');
            assert.equal(error.message, original.message);
            assert.deepEqual(apartFromApproval(error.details), {});
            assert.equal(error.cause, original);
          }
          // Where the approval stands once settled: failed — or still sending, when that could not be recorded.
          assert.equal(approvalState(error), failures.includes('approval') ? 'sending' : 'failed');
          for (const step of failures) {
            const needle = step === 'record' ? 'send record' : step;
            assert.match(error.hint ?? '', new RegExp(`${needle} .*read-only`));
          }
          assert.equal(await state(), failures.includes('approval') ? 'sending' : 'failed');
          if (trigger === 'throttle preflight') assert.equal(harness.fake.sends().length, 0);

          const records = new SendRecords(harness.core.paths.stateDir);
          const probe = await records.reserve(accountId, 'capacity-probe', { perHour: 1, perDay: 1 }).then(
            () => 'free' as const,
            (thrown: unknown) => {
              assert.ok(thrown instanceof CommsError, String(thrown));
              assert.equal(thrown.code, 'RATE_CAPPED');
              return 'held' as const;
            },
          );
          assert.equal(probe, failures.includes('release') ? 'held' : 'free');
          if (probe === 'free') await release.call(records, accountId, 'capacity-probe');
        } finally {
          SendRecords.prototype.reserve = reserve;
          SendRecords.prototype.release = release;
          SendRecords.prototype.record = record;
          harness.core.approvals.complete = complete;
          harness.core.audit.append = append;
        }
      });
    }
  }
});

test('a reservation append failure releases a possibly committed Resend slot and keeps the first error', async () => {
  const { send, state } = await prepared();
  const accountId = (await harness.core.config.load()).accounts['acme/resend']?.id;
  assert.ok(accountId);
  const reserve = SendRecords.prototype.reserve;
  const original = new Error('the reservation append reached disk but its close failed');
  SendRecords.prototype.reserve = async function (...args) {
    await reserve.apply(this, args);
    throw original;
  };
  try {
    const error = await send().then(
      () => assert.fail('a failed reservation was reported as a send'),
      (thrown: unknown) => thrown,
    );
    assert.ok(error instanceof CommsError, String(error));
    assert.equal(error.code, 'UNEXPECTED');
    assert.equal(error.message, original.message);
    assert.equal(error.hint, undefined);
    assert.equal(error.cause, original);
    assert.equal(await state(), 'failed');
  } finally {
    SendRecords.prototype.reserve = reserve;
  }
  const records = new SendRecords(harness.core.paths.stateDir);
  await records.reserve(accountId, 'capacity-probe', { perHour: 1, perDay: 1 });
});

test('a Resend cap refusal takes no slot, completes the claimed approval and remains RATE_CAPPED', async () => {
  const { approval, send, state } = await prepared();
  const accountId = (await harness.core.config.load()).accounts['acme/resend']?.id;
  assert.ok(accountId);
  await harness.core.config.update((config) => ({
    ...config,
    defaults: { ...config.defaults, sendCaps: { perHour: 1, perDay: 10 } },
  }));
  const records = new SendRecords(harness.core.paths.stateDir);
  await records.reserve(accountId, 'earlier-send', { perHour: 1, perDay: 10 });

  const error = await send().then(
    () => assert.fail('an over-cap send was reported as sent'),
    (thrown: unknown) => thrown,
  );
  assert.ok(error instanceof CommsError, String(error));
  assert.equal(error.code, 'RATE_CAPPED');
  assert.equal(error.message, 'nothing was sent: the send limit for this account is reached');
  assert.equal(error.cause instanceof CommsError, true);
  assert.equal(await state(), 'failed');
  const local = await records.summary(accountId, approval.approvalId);
  assert.equal(local?.state, 'failed');
  await assert.rejects(records.reserve(accountId, 'capacity-probe', { perHour: 1, perDay: 10 }), (thrown: unknown) => {
    assert.ok(thrown instanceof CommsError, String(thrown));
    return thrown.code === 'RATE_CAPPED';
  });
});

test('an unknown Resend outcome attempts its local record and audit independently without releasing the slot', async () => {
  const { approval, send, state } = await prepared();
  const accountId = (await harness.core.config.load()).accounts['acme/resend']?.id;
  assert.ok(accountId);
  harness.fake.afterSend = () => ({ status: 500, body: { name: 'application_error', message: 'answer lost' } });
  const calls: string[] = [];
  const record = SendRecords.prototype.record;
  SendRecords.prototype.record = async function (id, line) {
    if (line.event === 'unknown') {
      calls.push('record');
      throw new Error('send record disk is read-only');
    }
    return record.call(this, id, line);
  };
  const append = harness.core.audit.append.bind(harness.core.audit);
  harness.core.audit.append = async (audit, ...rest) => {
    if (audit.operation === 'resend.send.execute' && audit.outcome === 'failed') {
      calls.push('audit');
      throw new Error('audit disk is read-only');
    }
    return append(audit, ...rest);
  };
  try {
    const error = await send().then(
      () => assert.fail('an unknown outcome was reported as sent'),
      (thrown: unknown) => thrown,
    );
    assert.ok(error instanceof CommsError, String(error));
    assert.equal(error.code, 'TRANSIENT');
    assert.match(error.message, /^whether the email was sent is not known:/);
    assert.match(error.hint ?? '', /send record could not record this \(send record disk is read-only\)/);
    assert.match(error.hint ?? '', /audit log could not record this \(audit disk is read-only\)/);
    assert.ok(error.cause instanceof CommsError);
    assert.deepEqual(calls, ['record', 'audit']);
    assert.equal(await state(), 'sending');
    const records = new SendRecords(harness.core.paths.stateDir);
    await assert.rejects(records.reserve(accountId, 'capacity-probe', { perHour: 1, perDay: 1 }), (thrown: unknown) => {
      assert.ok(thrown instanceof CommsError, String(thrown));
      return thrown.code === 'RATE_CAPPED';
    });
    assert.equal((await records.summary(accountId, approval.approvalId))?.state, 'attempted');
  } finally {
    SendRecords.prototype.record = record;
    harness.core.audit.append = append;
  }
});

test('Resend success is never rewritten when its approval, send record or audit bookkeeping fails', async (t) => {
  await t.test('approval record', async () => {
    const { send, state } = await prepared();
    const store = harness.core.approvals;
    const complete = store.complete.bind(store);
    store.complete = async (approvalId, claimToken, outcome) => {
      if ('sentMessageId' in outcome) throw new Error('approval disk is read-only');
      return complete(approvalId, claimToken, outcome);
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
