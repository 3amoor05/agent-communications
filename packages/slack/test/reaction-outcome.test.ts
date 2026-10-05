import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ApprovalStore, type AuditRecord, asV2, CommsError, SENDING_LEASE_MS } from '@agentcomms/core';
import { certainlyRefused } from '../src/api/call.ts';
import { SlackContext } from '../src/context.ts';
import { gateDepsFor } from '../src/operations/gate.ts';
import { prepareReaction, reactPrepared } from '../src/operations/send.ts';
import { type Harness, newHarness } from './support/harness.ts';

/**
 * What a reaction's approval and audit record say once the request that changes it has gone out.
 *
 * The three outcomes are the same as a post's. Slack refusing before it acts is failed. An answer that does not say
 * whether it acted leaves the approval in `sending`, to read as `unknown`, and never records a failure that invites a
 * second reaction. Slack accepting the reaction is success whatever bookkeeping fails afterwards. `already_reacted`
 * is success too: the reaction the person asked for is there, so calling it failed would invite the wrong retry.
 */

const WANTED = { channel: 'C1', ts: '1700000000.000100', name: 'tada' };
const NO_REACTION_NOTE =
  'Slack says this account had no such reaction on the message, so there was nothing of yours to remove; reactions other people added are not affected.';

interface ReactionResult {
  readonly approvalId: string;
  readonly note?: string | undefined;
}

const DROP: unique symbol = Symbol('drop the connection instead of answering');

/** A Slack reached through the injected transport, recording every method and answering from a replaceable script. */
function fakeSlack(script: Record<string, () => unknown>) {
  const requests: string[] = [];
  const fetch = async (input: string | URL | Request): Promise<Response> => {
    const url = String(input instanceof Request ? input.url : input);
    const method = url.split('/api/')[1] ?? '';
    requests.push(method);
    const answer = script[method]?.() ?? { ok: false, error: 'unknown_method' };
    if (answer === DROP) throw new TypeError('fetch failed');
    return new Response(JSON.stringify(answer));
  };
  return { script, requests, fetch };
}

/** A workspace that can react under `chat`, and a Slack that accepts the reaction. */
async function world(remove = false) {
  const harness = await newHarness();
  await harness.addWorkspace({ alias: 'acme', mode: 'send' });
  const method = remove ? 'reactions.remove' : 'reactions.add';
  const fake = fakeSlack({ [method]: () => ({ ok: true }) });
  const context = new SlackContext({ core: harness.core, env: harness.env, surface: 'mcp' });
  const wanted = { ...WANTED, remove };
  const gate = await gateDepsFor(context, 'acme', { fetch: fake.fetch });
  const prepared = await prepareReaction(gate, wanted);
  const change = (through: typeof fake.fetch = fake.fetch): Promise<ReactionResult> =>
    reactPrepared({ ...gate, call: { ...gate.call, fetch: through } }, prepared.approvalId, wanted);
  const state = async () => asV2(await harness.core.approvals.get(prepared.approvalId))?.state;
  const changed = () => fake.requests.filter((seen) => seen === method).length;
  return { harness, fake, method, change, state, approvalId: prepared.approvalId, changed };
}

async function audited(harness: Harness, operation = 'slack.reaction.add'): Promise<AuditRecord[]> {
  return (await harness.core.audit.tail({ limit: 20 })).filter((record) => record.operation === operation);
}

/** Every outcome the store was asked to record, so a test can prove an unknown or success was never made failed. */
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

/** A Slack-named refusal, as `callSlack` presents one to the outcome classifier. */
function refused(name: string): CommsError {
  return new CommsError('PROVIDER_UNAVAILABLE', `Slack refused the request: ${name}`, {
    details: { slackError: name },
  });
}

test('the documented pre-action reaction refusals are certain, and Slack state or partial failures are not', () => {
  const add = [
    'access_denied',
    'accesslimited',
    'account_inactive',
    'bad_timestamp',
    'channel_not_found',
    'deprecated_endpoint',
    'ekm_access_denied',
    'enterprise_is_restricted',
    'invalid_arg_name',
    'invalid_arguments',
    'invalid_array_arg',
    'invalid_auth',
    'invalid_charset',
    'invalid_form_data',
    'invalid_name',
    'invalid_post_type',
    'is_archived',
    'message_not_found',
    'method_deprecated',
    'missing_post_type',
    'missing_scope',
    'no_access',
    'no_item_specified',
    'no_permission',
    'not_allowed_token_type',
    'not_authed',
    'not_reactable',
    'ratelimited',
    'team_access_not_granted',
    'thread_locked',
    'token_expired',
    'token_revoked',
    'too_many_emoji',
    'too_many_reactions',
    'two_factor_setup_required',
  ];
  const remove = [
    'access_denied',
    'accesslimited',
    'account_inactive',
    'bad_timestamp',
    'channel_not_found',
    'deprecated_endpoint',
    'ekm_access_denied',
    'enterprise_is_restricted',
    'file_comment_not_found',
    'file_not_found',
    'invalid_arg_name',
    'invalid_arguments',
    'invalid_array_arg',
    'invalid_auth',
    'invalid_charset',
    'invalid_form_data',
    'invalid_name',
    'invalid_post_type',
    'message_not_found',
    'method_deprecated',
    'missing_post_type',
    'missing_scope',
    'no_access',
    'no_item_specified',
    'no_permission',
    'not_allowed_token_type',
    'not_authed',
    'ratelimited',
    'team_access_not_granted',
    'thread_locked',
    'token_expired',
    'token_revoked',
    'two_factor_setup_required',
  ];
  const uncertain = [
    'external_channel_migrating',
    'fatal_error',
    'internal_error',
    'org_login_required',
    'request_timeout',
    'service_unavailable',
    'team_added_to_org',
    'something_new_went_wrong',
  ];

  for (const name of add) assert.equal(certainlyRefused(refused(name), 'reactions.add'), true, name);
  for (const name of remove) assert.equal(certainlyRefused(refused(name), 'reactions.remove'), true, name);
  for (const method of ['reactions.add', 'reactions.remove'] as const) {
    for (const name of uncertain) assert.equal(certainlyRefused(refused(name), method), false, `${method}: ${name}`);
    assert.equal(
      certainlyRefused(
        new CommsError('TRANSIENT', 'Slack is rate-limiting this workspace', {
          details: { retryAfterSeconds: 3 },
        }),
        method,
      ),
      true,
      `${method}: HTTP 429`,
    );
  }
  assert.equal(
    certainlyRefused(refused('already_reacted'), 'reactions.add'),
    false,
    'already_reacted is the desired state, not a failure',
  );
  assert.equal(
    certainlyRefused(refused('no_reaction'), 'reactions.remove'),
    false,
    'no_reaction is the desired removal state, not a failure',
  );
});

test('a reaction Slack took whose answer was lost is left to read unknown, never recorded as failed', async () => {
  const { harness, fake, change, state, approvalId, changed } = await world();
  fake.script['reactions.add'] = () => DROP;
  const outcomes = recordedOutcomes(harness);

  const error = await change().then(
    () => assert.fail('a reaction whose answer never came was reported as added'),
    (thrown: unknown) => thrown,
  );
  assert.ok(error instanceof CommsError, String(error));
  assert.match(error.message, /^whether the reaction was added is not known: could not reach Slack/);
  assert.equal(error.details?.outcome, 'unknown');
  assert.match(error.hint ?? '', /Look at the message before anything else/);
  assert.equal(changed(), 1, 'Slack was not asked to react');
  assert.deepEqual(outcomes, [], 'an outcome nobody knows was recorded');
  assert.equal(await state(), 'sending');
  const later = new ApprovalStore(harness.core.paths.stateDir, {
    now: () => new Date(Date.now() + SENDING_LEASE_MS),
    loadConfig: () => harness.core.config.load(),
  });
  assert.equal(asV2(await later.get(approvalId))?.state, 'unknown');
  const [record] = await audited(harness);
  assert.equal(record?.outcome, 'failed');
  assert.match(record?.reason ?? '', /^outcome unknown: could not reach Slack/);
});

test('an unknown reaction outcome still reaches the caller when its audit record cannot be written', async () => {
  const { harness, fake, change, state } = await world();
  fake.script['reactions.add'] = () => DROP;
  const audit = harness.core.audit;
  const append = audit.append.bind(audit);
  audit.append = async (record, ...rest) => {
    if (record.operation === 'slack.reaction.add') throw new Error('EROFS: read-only file system');
    return append(record, ...rest);
  };

  const error = await change().then(
    () => assert.fail('a reaction whose answer never came was reported as added'),
    (thrown: unknown) => thrown,
  );
  assert.ok(error instanceof CommsError, String(error));
  assert.match(error.message, /^whether the reaction was added is not known: could not reach Slack/);
  assert.match(error.hint ?? '', /audit log could not record this either \(EROFS: read-only file system\)/);
  assert.equal(await state(), 'sending');
});

test('what Slack answered decides a reaction record: a refusal is failed, anything that may have acted is not', async () => {
  const cases: { what: string; answer: unknown; state: 'failed' | 'sending' }[] = [
    { what: 'Slack refusing: invalid_name', answer: { ok: false, error: 'invalid_name' }, state: 'failed' },
    { what: 'Slack refusing: message_not_found', answer: { ok: false, error: 'message_not_found' }, state: 'failed' },
    { what: 'Slack refusing: too_many_reactions', answer: { ok: false, error: 'too_many_reactions' }, state: 'failed' },
    { what: 'Slack’s own maybe: internal_error', answer: { ok: false, error: 'internal_error' }, state: 'sending' },
    {
      what: 'Slack’s state: service_unavailable',
      answer: { ok: false, error: 'service_unavailable' },
      state: 'sending',
    },
    {
      what: 'an error Slack never documented',
      answer: { ok: false, error: 'something_new_went_wrong' },
      state: 'sending',
    },
  ];
  for (const { what, answer, state: expected } of cases) {
    const { harness, fake, change, state } = await world();
    fake.script['reactions.add'] = () => answer;
    const outcomes = recordedOutcomes(harness);

    const error = await change().then(
      () => assert.fail(`${what}: reported as added`),
      (thrown: unknown) => thrown,
    );
    assert.ok(error instanceof CommsError, `${what}: ${String(error)}`);
    assert.equal(await state(), expected, what);
    const [record] = await audited(harness);
    assert.equal(record?.outcome, 'failed', what);
    if (expected === 'sending') {
      assert.match(error.message, /^whether the reaction was added is not known: /, what);
      assert.deepEqual(outcomes, [], `${what}: an outcome nobody knows was recorded`);
      assert.match(record?.reason ?? '', /^outcome unknown: /, what);
    } else {
      assert.doesNotMatch(error.message, /not known/, what);
      assert.deepEqual(outcomes, ['failed'], what);
      assert.doesNotMatch(record?.reason ?? '', /unknown/, what);
    }
  }
});

test('already_reacted is recorded as used because the requested reaction is there, and the result says so', async () => {
  const { harness, fake, change, state, changed } = await world();
  fake.script['reactions.add'] = () => ({ ok: false, error: 'already_reacted' });
  const outcomes = recordedOutcomes(harness);

  const result = await change();
  assert.match(result.note ?? '', /Slack says this account had already added the reaction/);
  assert.equal(changed(), 1);
  assert.deepEqual(outcomes, ['used'], 'the state already reached was recorded as a failure');
  assert.equal(await state(), 'used');
  const [record] = await audited(harness);
  assert.equal(record?.outcome, 'ok');
  assert.match(record?.reason ?? '', /already added/);
});

test('already_reacted from a removal does not claim that the reaction was removed', async () => {
  const { harness, fake, change, state } = await world(true);
  fake.script['reactions.remove'] = () => ({ ok: false, error: 'already_reacted' });
  const outcomes = recordedOutcomes(harness);

  const error = await change().then(
    () => assert.fail('a removal Slack did not confirm was reported as removed'),
    (thrown: unknown) => thrown,
  );
  assert.ok(error instanceof CommsError, String(error));
  assert.match(error.message, /^whether the reaction was removed is not known: /);
  assert.deepEqual(outcomes, []);
  assert.equal(await state(), 'sending');
});

test('no_reaction is recorded as used because this account has nothing to remove, and the result says whose reactions remain', async () => {
  const { harness, fake, change, state, changed } = await world(true);
  fake.script['reactions.remove'] = () => ({ ok: false, error: 'no_reaction' });
  const outcomes = recordedOutcomes(harness);

  const result = await change();
  assert.equal(result.note, NO_REACTION_NOTE);
  assert.equal(changed(), 1);
  assert.deepEqual(outcomes, ['used'], 'the state already reached was recorded as a failure');
  assert.equal(await state(), 'used');
  const [record] = await audited(harness, 'slack.reaction.remove');
  assert.equal(record?.outcome, 'ok');
  assert.equal(record?.reason, NO_REACTION_NOTE);
});

test('no_reaction from an addition remains unknown rather than claiming that the reaction is present', async () => {
  const { harness, fake, change, state } = await world();
  fake.script['reactions.add'] = () => ({ ok: false, error: 'no_reaction' });
  const outcomes = recordedOutcomes(harness);

  const error = await change().then(
    () => assert.fail('an addition Slack did not confirm was reported as added'),
    (thrown: unknown) => thrown,
  );
  assert.ok(error instanceof CommsError, String(error));
  assert.match(error.message, /^whether the reaction was added is not known: /);
  assert.deepEqual(outcomes, []);
  assert.equal(await state(), 'sending');
});

test('no_reaction remains success when recording that result is incomplete', async (t) => {
  await t.test('the approval failure is noted', async () => {
    const { harness, fake, change, state } = await world(true);
    fake.script['reactions.remove'] = () => ({ ok: false, error: 'no_reaction' });
    const store = harness.core.approvals;
    const complete = store.complete.bind(store);
    store.complete = async (approvalId, claimToken, outcome) => {
      if ('sentMessageId' in outcome) throw new Error('approval ledger is read-only');
      return complete(approvalId, claimToken, outcome);
    };

    const result = await change();
    assert.match(result.note ?? '', new RegExp(`^${NO_REACTION_NOTE.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`));
    assert.match(result.note ?? '', /approval could not be marked used \(approval ledger is read-only\)/);
    assert.equal(await state(), 'sending');
    const [record] = await audited(harness, 'slack.reaction.remove');
    assert.equal(record?.outcome, 'ok');
  });

  await t.test('the audit failure is noted', async () => {
    const { harness, fake, change, state } = await world(true);
    fake.script['reactions.remove'] = () => ({ ok: false, error: 'no_reaction' });
    const audit = harness.core.audit;
    const append = audit.append.bind(audit);
    audit.append = async (record, ...rest) => {
      if (record.operation === 'slack.reaction.remove') throw new Error('audit ledger is read-only');
      return append(record, ...rest);
    };

    const result = await change();
    assert.match(result.note ?? '', new RegExp(`^${NO_REACTION_NOTE.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`));
    assert.match(result.note ?? '', /audit log could not record it \(audit ledger is read-only\)/);
    assert.equal(await state(), 'used');
  });
});

test('a reaction Slack accepted whose approval cannot be marked used is never failed, and the result says so', async () => {
  const { harness, change, state, changed } = await world();
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

  const result = await change();
  assert.match(
    result.note ?? '',
    /the approval could not be marked used \(another agent-communications process is holding the approval\)/,
  );
  assert.equal(changed(), 1);
  assert.deepEqual(asked, ['used'], 'a failure was recorded after Slack accepted the reaction');
  assert.equal(await state(), 'sending');
  const [record] = await audited(harness);
  assert.equal(record?.outcome, 'ok');
  assert.match(record?.reason ?? '', /the approval could not be marked used/);
});

test('a reaction Slack accepted whose audit record cannot be written is success with the missing record noted', async () => {
  const { harness, change, state, changed } = await world();
  const audit = harness.core.audit;
  const append = audit.append.bind(audit);
  audit.append = async (record, ...rest) => {
    if (record.operation === 'slack.reaction.add') throw new Error('EROFS: read-only file system');
    return append(record, ...rest);
  };

  const result = await change();
  assert.match(result.note ?? '', /the audit log could not record it \(EROFS: read-only file system\)/);
  assert.equal(changed(), 1);
  assert.equal(await state(), 'used');
});

test('a bookkeeping failure while recording a refusal cannot hide what Slack refused', async () => {
  const { harness, fake, change, state } = await world();
  fake.script['reactions.add'] = () => ({ ok: false, error: 'channel_not_found' });
  const store = harness.core.approvals;
  const complete = store.complete.bind(store);
  store.complete = async (approvalId, claimToken, outcome) => {
    if ('error' in outcome) {
      throw new CommsError('LOCK_TIMEOUT', 'another agent-communications process is holding the approval');
    }
    return complete(approvalId, claimToken, outcome);
  };

  const error = await change().then(
    () => assert.fail('Slack’s refusal was reported as a reaction'),
    (thrown: unknown) => thrown,
  );
  assert.ok(error instanceof CommsError, String(error));
  assert.equal(error.code, 'NOT_FOUND');
  assert.equal(error.message, 'no such channel, or this account cannot see it');
  assert.match(error.hint ?? '', /approval could not be marked failed/i);
  assert.match(error.hint ?? '', /another agent-communications process is holding the approval/);
  assert.equal(await state(), 'sending');
  const [record] = await audited(harness);
  assert.equal(record?.outcome, 'failed', 'the audit is still attempted after the approval write fails');
  assert.match(record?.reason ?? '', /approval could not be marked failed/);
});

test('an audit failure while recording a refusal cannot hide what Slack refused', async () => {
  const { harness, fake, change, state } = await world();
  fake.script['reactions.add'] = () => ({ ok: false, error: 'channel_not_found' });
  const audit = harness.core.audit;
  const append = audit.append.bind(audit);
  audit.append = async (record, ...rest) => {
    if (record.operation === 'slack.reaction.add') throw new Error('EROFS: read-only file system');
    return append(record, ...rest);
  };

  const error = await change().then(
    () => assert.fail('Slack’s refusal was reported as a reaction'),
    (thrown: unknown) => thrown,
  );
  assert.ok(error instanceof CommsError, String(error));
  assert.equal(error.code, 'NOT_FOUND');
  assert.equal(error.message, 'no such channel, or this account cannot see it');
  assert.match(error.hint ?? '', /audit log could not record the refusal \(EROFS: read-only file system\)/);
  assert.equal(await state(), 'failed');
});
