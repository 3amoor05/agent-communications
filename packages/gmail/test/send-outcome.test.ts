import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ApprovalStore, asV2, CommsError, SENDING_LEASE_MS } from '@agentcomms/core';
import { renderSent } from '../src/cli/render.ts';
import { GmailContext } from '../src/context.ts';
import { mapGoogleError, sendCertainlyRefused } from '../src/gmail-api/errors.ts';
import { createDraft } from '../src/operations/drafts.ts';
import { executeSend, prepareSend } from '../src/operations/send.ts';
import { DRAFT_SEND_PATH } from './support/fake-google.ts';
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
  const state = async () => asV2(await setup.harness.core.approvals.get(approval.approvalId))?.state;
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
    now: () => new Date(Date.now() + SENDING_LEASE_MS),
    loadConfig: () => setup.harness.core.config.load(),
  });
  assert.equal(asV2(await later.get(approval.approvalId))?.state, 'unknown');
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
      setup.harness.google.failNext(DRAFT_SEND_PATH, 1, status);

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
    setup.harness.google.failNext(DRAFT_SEND_PATH, 1, 422);

    const error = await send().then(
      () => assert.fail('422 was reported as a send'),
      (thrown: unknown) => thrown,
    );
    assert.ok(error instanceof CommsError);
    assert.equal(await state(), 'sending');
    assert.equal(error.details?.outcome, 'unknown');
  });
});

test('a final draft read failure is a certain no-send whose slot, approval and audit are settled', async () => {
  const setup = await world();
  const { approval, send, state } = await prepared(setup);
  const transport = await setup.context.transport('work');
  const getDraft = transport.getDraft.bind(transport);
  const original = new CommsError('LOCK_TIMEOUT', 'the final draft read could not finish', {
    hint: 'This is the first failure.',
    details: { phase: 'final-read' },
  });
  let reads = 0;
  transport.getDraft = async (draftId) => {
    reads += 1;
    if (reads === 2) throw original;
    return getDraft(draftId);
  };

  const error = await send().then(
    () => assert.fail('a send whose final draft read failed was reported as sent'),
    (thrown: unknown) => thrown,
  );
  assert.ok(error instanceof CommsError, String(error));
  assert.equal(error.code, original.code);
  assert.equal(error.message, original.message);
  assert.equal(error.hint, original.hint);
  assert.deepEqual(error.details, original.details);
  assert.equal(error.cause, original);
  assert.equal(await state(), 'failed');
  const inbox = (await setup.harness.core.config.load()).inboxes.work;
  assert.ok(inbox);
  assert.deepEqual(await setup.harness.core.ledger.status(inbox.id, { perHour: 20, perDay: 100 }), {
    hour: 0,
    day: 0,
  });
  assert.equal(setup.harness.google.requests.filter((request) => request.path.endsWith('/send')).length, 0);
  const audit = await setup.harness.core.audit.tail({ inbox: 'work' });
  const outcome = audit.findLast((entry) => entry.operation === 'send.execute');
  assert.equal(outcome?.outcome, 'failed');
  assert.equal(outcome?.reason, original.message);
  assert.equal((outcome?.ids?.approvalIds as string[] | undefined)?.[0], approval.approvalId);
});

test('every certain no-send path attempts each bookkeeping step independently', async (t) => {
  const failureSets: ReadonlyArray<ReadonlyArray<'release' | 'approval' | 'audit'>> = [
    ['release'],
    ['approval'],
    ['audit'],
    ['release', 'approval'],
    ['release', 'audit'],
    ['approval', 'audit'],
  ];
  const triggers = [
    'claimed draft mismatch',
    'reservation failure',
    'final draft read',
    'changed draft',
    'Gmail refusal',
  ] as const;

  for (const trigger of triggers) {
    for (const failures of failureSets) {
      await t.test(`${trigger}; ${failures.join(' and ')} fail`, async () => {
        const setup = await world();
        const { send, state } = await prepared(setup);
        const transport = await setup.context.transport('work');
        const original = new CommsError('SEND_REFUSED', `${trigger} stopped the send`, {
          hint: 'Keep the first hint.',
          details: { trigger },
        });
        const reserve = setup.harness.core.ledger.reserve.bind(setup.harness.core.ledger);
        if (trigger === 'claimed draft mismatch') {
          const claimForSend = setup.harness.core.approvals.claimForSend.bind(setup.harness.core.approvals);
          setup.harness.core.approvals.claimForSend = async (...args) => {
            const claim = await claimForSend(...args);
            return { ...claim, record: { ...claim.record, draftId: 'dr_another_draft' } };
          };
        } else if (trigger === 'reservation failure') {
          setup.harness.core.ledger.reserve = async (...args) => {
            await reserve(...args);
            throw original;
          };
        }
        if (trigger === 'final draft read' || trigger === 'changed draft') {
          const getDraft = transport.getDraft.bind(transport);
          let reads = 0;
          transport.getDraft = async (draftId) => {
            reads += 1;
            const draft = await getDraft(draftId);
            if (reads !== 2) return draft;
            if (trigger === 'final draft read') throw original;
            return {
              ...draft,
              message: draft.message ? { ...draft.message, id: `${draft.message.id ?? 'message'}-changed` } : undefined,
            };
          };
        } else {
          transport.sendDraft = async () => {
            throw original;
          };
        }

        const calls: string[] = [];
        const release = setup.harness.core.ledger.release.bind(setup.harness.core.ledger);
        setup.harness.core.ledger.release = async (inboxId, approvalId) => {
          calls.push('release');
          if (failures.includes('release')) throw new Error('release disk is read-only');
          return release(inboxId, approvalId);
        };
        const complete = setup.harness.core.approvals.complete.bind(setup.harness.core.approvals);
        setup.harness.core.approvals.complete = async (approvalId, claimToken, outcome) => {
          calls.push('approval');
          if (failures.includes('approval')) throw new Error('approval disk is read-only');
          return complete(approvalId, claimToken, outcome);
        };
        const append = setup.harness.core.audit.append.bind(setup.harness.core.audit);
        setup.harness.core.audit.append = async (record, ...rest) => {
          if (record.operation !== 'send.execute') return append(record, ...rest);
          calls.push('audit');
          if (failures.includes('audit')) throw new Error('audit disk is read-only');
          return append(record, ...rest);
        };

        const error = await send().then(
          () => assert.fail(`${trigger} was reported as a send`),
          (thrown: unknown) => thrown,
        );
        assert.ok(error instanceof CommsError, String(error));
        assert.deepEqual(calls, ['release', 'approval', 'audit']);
        if (trigger === 'claimed draft mismatch') {
          assert.equal(error.code, 'APPROVAL_VOID');
          assert.equal(error.message, 'nothing was sent: this approval was prepared for a different draft');
          assert.ok(error.cause instanceof CommsError);
          assert.equal(error.cause.message, error.message);
        } else if (trigger === 'changed draft') {
          assert.equal(error.code, 'APPROVAL_VOID');
          assert.equal(error.message, 'nothing was sent: the draft changed while it was being sent');
          assert.ok(error.cause instanceof CommsError);
          assert.equal(error.cause.message, error.message);
        } else {
          assert.equal(error.code, original.code);
          assert.equal(error.message, original.message);
          assert.deepEqual(error.details, original.details);
          assert.equal(error.cause, original);
        }
        assert.match(error.hint ?? '', /^Keep the first hint\.|^Prepare the send again/);
        for (const step of failures) assert.match(error.hint ?? '', new RegExp(`${step} .*read-only`));
        assert.equal(await state(), failures.includes('approval') ? 'sending' : 'failed');
        const inbox = (await setup.harness.core.config.load()).inboxes.work;
        assert.ok(inbox);
        assert.equal(
          (await setup.harness.core.ledger.status(inbox.id, { perHour: 20, perDay: 100 })).hour,
          failures.includes('release') && trigger !== 'claimed draft mismatch' ? 1 : 0,
        );
      });
    }
  }
});

test('a reservation append failure releases a possibly committed slot and keeps the first error', async () => {
  const setup = await world();
  const { send, state } = await prepared(setup);
  const reserve = setup.harness.core.ledger.reserve.bind(setup.harness.core.ledger);
  const original = new Error('the reservation append reached disk but its close failed');
  setup.harness.core.ledger.reserve = async (...args) => {
    await reserve(...args);
    throw original;
  };

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
  const inbox = (await setup.harness.core.config.load()).inboxes.work;
  assert.ok(inbox);
  assert.equal((await setup.harness.core.ledger.status(inbox.id, { perHour: 20, perDay: 100 })).hour, 0);
});

test('a cap refusal takes no slot, completes the claimed approval and remains RATE_CAPPED', async () => {
  const setup = await world();
  const { approval, send, state } = await prepared(setup);
  const inbox = (await setup.harness.core.config.load()).inboxes.work;
  assert.ok(inbox);
  await setup.harness.core.config.update((config) => ({
    ...config,
    defaults: { ...config.defaults, sendCaps: { perHour: 1, perDay: 10 } },
  }));
  await setup.harness.core.ledger.reserve(inbox.id, 'earlier-send', { perHour: 1, perDay: 10 });

  const error = await send().then(
    () => assert.fail('an over-cap send was reported as sent'),
    (thrown: unknown) => thrown,
  );
  assert.ok(error instanceof CommsError, String(error));
  assert.equal(error.code, 'RATE_CAPPED');
  assert.equal(error.message, 'nothing was sent: the send limit for this inbox is reached');
  assert.equal(error.details?.hour, 1);
  assert.equal(error.cause instanceof CommsError, true);
  assert.equal(await state(), 'failed');
  assert.equal((await setup.harness.core.ledger.status(inbox.id, { perHour: 1, perDay: 10 })).hour, 1);
  const audit = await setup.harness.core.audit.tail({ inbox: 'work' });
  const outcome = audit.findLast((entry) => entry.operation === 'send.execute');
  assert.equal(outcome?.outcome, 'failed');
  assert.equal((outcome?.ids?.approvalIds as string[] | undefined)?.[0], approval.approvalId);
});

test('an unknown Gmail outcome keeps its slot and approval when its audit also fails', async () => {
  const setup = await world();
  const { approval, send, state } = await prepared(setup);
  const transport = await setup.context.transport('work');
  const original = new CommsError('PROVIDER_UNAVAILABLE', 'the connection ended after the request left', {
    hint: 'The provider answer was lost.',
    details: { providerRequest: 'gmail-send-1' },
  });
  transport.sendDraft = async () => {
    throw original;
  };
  const append = setup.harness.core.audit.append.bind(setup.harness.core.audit);
  setup.harness.core.audit.append = async (record, ...rest) => {
    if (record.operation === 'send.execute') throw new Error('audit disk is read-only');
    return append(record, ...rest);
  };

  const error = await send().then(
    () => assert.fail('an unknown outcome was reported as sent'),
    (thrown: unknown) => thrown,
  );
  assert.ok(error instanceof CommsError, String(error));
  assert.equal(error.code, original.code);
  assert.match(error.message, /^whether the email was sent is not known:/);
  assert.match(error.hint ?? '', /^Check the Sent folder/);
  assert.match(error.hint ?? '', /audit log could not record this either \(audit disk is read-only\)/);
  assert.deepEqual(error.details, {
    providerRequest: 'gmail-send-1',
    approvalId: approval.approvalId,
    outcome: 'unknown',
  });
  assert.equal(error.cause, original);
  assert.equal(await state(), 'sending');
  const inbox = (await setup.harness.core.config.load()).inboxes.work;
  assert.ok(inbox);
  assert.equal((await setup.harness.core.ledger.status(inbox.id, { perHour: 20, perDay: 100 })).hour, 1);
});

test('Gmail success is never rewritten when its approval or audit bookkeeping fails', async (t) => {
  await t.test('approval record', async () => {
    const setup = await world();
    const { send, state } = await prepared(setup);
    const store = setup.harness.core.approvals;
    const complete = store.complete.bind(store);
    store.complete = async (approvalId, claimToken, outcome) => {
      if ('sentMessageId' in outcome) throw new Error('approval disk is read-only');
      return complete(approvalId, claimToken, outcome);
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
