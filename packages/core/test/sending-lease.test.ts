import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { setTimeout as sleep } from 'node:timers/promises';
import { SENDING_LEASE_MS, unknownAtOf } from '../src/approval-binding.ts';
import { asV2 } from '../src/approval-stored.ts';
import { validateV2 } from '../src/approval-validate.ts';
import { type ApprovalRecord, ApprovalStore, type Expectation, publicView } from '../src/approvals.ts';
import { CommsError } from '../src/errors.ts';
import { fenceOrStop, LEASE_LOST_BEFORE_SEND, withSendingLease } from '../src/sending-lease.ts';
import { liveConfig } from './helpers/live-config.ts';
import { tempDir } from './helpers/temp.ts';
import { OWNER, T0, v2Record } from './helpers/v2-records.ts';

/*
 * The sending lease (CUE-404 Task 7; design 2026-10-05 §D1, "Version-2 timestamps fail closed", and §D2): the claim's
 * private token, the thirty-second renewal, the two-minute lease, the fence before each provider step, and the one
 * caller — the claimant — who may still record what the provider said once the lease has run out.
 */

const EXPECT: Expectation = { to: ['sam@partner.test'], cc: [], bcc: [], subject: 'Re: plan' };
const LIVE = {
  inboxId: OWNER,
  inboxSub: 'sub-1',
  draftMessageId: 'msg-v1',
  contentDigest: 'a'.repeat(64),
  expect: EXPECT,
};
const at = (ms: number) => new Date(T0 + ms).toISOString();

function clock(start = T0) {
  let t = start;
  return { now: () => new Date(t), advance: (ms: number) => (t += ms), set: (ms: number) => (t = ms) };
}

/** A store over a fresh state directory, its mailbox sending under chat, at `T0` on a clock of its own. */
function machine() {
  const dir = tempDir();
  const time = clock();
  const config = liveConfig(dir, { inboxes: { 'acme/gmail': { id: OWNER, sendPolicy: 'chat' } } });
  const open = () => new ApprovalStore(dir, { now: time.now, loadConfig: config.loadConfig });
  return { dir, time, config, store: open(), open };
}

/** A machine with one send claimed at `T0`. */
async function claimed() {
  const m = machine();
  const record = await m.store.create({
    channel: 'gmail',
    inboxId: OWNER,
    inboxSub: 'sub-1',
    draftId: 'r-draft-1',
    draftMessageId: 'msg-v1',
    contentDigest: 'a'.repeat(64),
    sendEpoch: 0,
    policy: 'chat',
    requiredPolicy: 'chat',
    riskFlags: [],
    expect: EXPECT,
  });
  const claim = await m.store.claimForSend(record.approvalId, LIVE);
  return { ...m, id: record.approvalId, claim };
}

const file = (dir: string, id: string, suffix = '.json') =>
  readFileSync(join(dir, 'approvals', `${id}${suffix}`), 'utf8');
const stateOf = async (store: ApprovalStore, id: string) => asV2(await store.get(id));

// ── The token ───────────────────────────────────────────────────────────────────────────────────────────────────

test('the claim creates one private random token, and no record, view, approval object, error or result shows it', async () => {
  const one = await claimed();
  const two = await claimed();
  for (const { claim } of [one, two]) assert.match(claim.claimToken, /^[0-9a-f]{32}$/);
  assert.notEqual(one.claim.claimToken, two.claim.claimToken);
  const token = one.claim.claimToken;
  // Kept in the claim's marker, and nowhere else on disk.
  assert.equal(JSON.parse(file(one.dir, one.id, '.claim')).token, token);
  const shown: string[] = [
    file(one.dir, one.id),
    JSON.stringify(one.claim.record),
    JSON.stringify(publicView(one.claim.record)),
    JSON.stringify(await one.store.get(one.id)),
    JSON.stringify(await one.store.list()),
    JSON.stringify(await one.store.inspect(one.id)),
  ];
  // What other callers are told of it, and every refusal along the way.
  for (const attempt of [
    () => one.store.claimForSend(one.id, LIVE),
    () => one.store.heartbeat(one.id, two.claim.claimToken),
    () => one.store.complete(one.id, '', { sentMessageId: 's-1' }),
    () => one.store.revoke(one.id, 'no', { disposition: 'person' }).then(() => one.store.claimForSend(one.id, LIVE)),
  ]) {
    try {
      await attempt();
    } catch (error) {
      assert.ok(error instanceof CommsError, String(error));
      shown.push(JSON.stringify({ message: error.message, hint: error.hint, details: error.details }));
    }
  }
  shown.push(JSON.stringify(await one.store.complete(one.id, token, { sentMessageId: 's-1' })));
  shown.push(file(one.dir, one.id));
  for (const text of shown) assert.ok(!text.includes(token), `the token shows in ${text.slice(0, 120)}`);
});

// ── Renewal, and the lease ──────────────────────────────────────────────────────────────────────────────────────

/** Waits, in real time, for `check` to hold. */
async function until(check: () => Promise<boolean> | boolean, what: string) {
  for (let i = 0; i < 1000; i += 1) {
    if (await check()) return;
    await sleep(5);
  }
  assert.fail(`never: ${what}`);
}

test('the claimant renews its lease every thirty seconds while its work is outstanding, by its token, and stops when the work settles', async (t) => {
  const { store, id, claim, time, dir } = await claimed();
  t.mock.timers.enable({ apis: ['setInterval'] });
  const tokens: string[] = [];
  let settled = 0;
  const renewing = {
    heartbeat: async (approvalId: string, claimToken: string) => {
      tokens.push(claimToken);
      try {
        return await store.heartbeat(approvalId, claimToken);
      } finally {
        settled += 1;
      }
    },
  };
  let finish!: (value: string) => void;
  const work = new Promise<string>((settle) => {
    finish = settle;
  });
  const leased = withSendingLease(renewing, id, claim.claimToken, () => work);
  for (let beat = 1; beat <= 3; beat += 1) {
    time.advance(30_000);
    t.mock.timers.tick(30_000);
    // Settled — its lock let go too — before the next tick: one renewal at a time, so a tick during one is skipped.
    await until(
      () => settled === beat && JSON.parse(file(dir, id)).sendingHeartbeatAt === at(beat * 30_000),
      `renewal ${beat} written under the lock`,
    );
  }
  // Long work stays sending: three renewals past the claim, it is still within its lease.
  time.advance(SENDING_LEASE_MS - 1);
  assert.equal((await stateOf(store, id))?.state, 'sending');
  finish('done');
  assert.equal(await leased, 'done');
  t.mock.timers.tick(5 * 30_000);
  await sleep(20);
  assert.deepEqual(tokens, [claim.claimToken, claim.claimToken, claim.claimToken], 'no renewal after it settled');
  assert.deepEqual(validateV2(JSON.parse(file(dir, id)), id), { ok: true });
});

test('unknownAt is exactly the last renewal, or the claim, plus two minutes, never stored; at it, the record is unknown', async () => {
  // A hand-built record whose update time is neither its claim nor its renewal: only the renewal counts.
  const m = machine();
  const record = v2Record({ kind: 'send', state: 'sending', heartbeat: true });
  const id = record.approvalId;
  mkdirSync(join(m.dir, 'approvals'), { recursive: true });
  writeFileSync(join(m.dir, 'approvals', `${id}.json`), JSON.stringify(record));
  const renewed = Date.parse(record.sendingHeartbeatAt as string);
  assert.equal(unknownAtOf(record), new Date(renewed + SENDING_LEASE_MS).toISOString());
  assert.notEqual(record.updatedAt, record.sendingHeartbeatAt, 'updatedAt is not what the lease is measured from');
  m.time.set(renewed + SENDING_LEASE_MS - 1);
  const before = await m.store.inspect(id);
  assert.equal(before.outcome.state, 'sending');
  assert.equal(before.outcome.approval.unknownAt, new Date(renewed + SENDING_LEASE_MS).toISOString());
  assert.equal('unknownAt' in JSON.parse(file(m.dir, id)), false, 'derived, never stored');
  m.time.set(renewed + SENDING_LEASE_MS);
  const after = await m.store.inspect(id);
  assert.equal(after.outcome.state, 'unknown', 'equality takes the later state');
  assert.equal(JSON.parse(file(m.dir, id)).state, 'unknown', 'and a locked read persists it');
  // Without a renewal, from the claim itself.
  const unrenewed = v2Record({ kind: 'send', state: 'sending', approvalId: `ap_${'0'.repeat(25)}W` });
  assert.equal(
    unknownAtOf(unrenewed),
    new Date(Date.parse(unrenewed.sendingAt as string) + SENDING_LEASE_MS).toISOString(),
  );
});

test('a renewal suspended past the lease: status persists unknown, and the original claim then records used or failed', async () => {
  for (const outcome of ['used', 'failed'] as const) {
    const { store, id, claim, time, open } = await claimed();
    time.advance(30_000);
    assert.equal(await store.heartbeat(id, claim.claimToken), 'renewed');
    // The claimant is suspended: no renewal for two minutes. Another process looks.
    time.advance(SENDING_LEASE_MS);
    const other = open();
    const seen = await other.inspect(id);
    assert.equal(seen.outcome.state, 'unknown');
    assert.equal(seen.outcome.error?.code, 'SEND_OUTCOME_UNKNOWN');
    const persisted = await stateOf(store, id);
    assert.equal(persisted?.state, 'unknown');
    assert.match(persisted?.reason ?? '', /stopped before recording an outcome/);
    // The provider's answer arrives late: only the claimant records it, and the stale reason goes.
    time.advance(10_000);
    const recorded =
      outcome === 'used'
        ? await store.complete(id, claim.claimToken, { sentMessageId: 'sent-1' })
        : await store.complete(id, claim.claimToken, { error: 'backendError: the mailbox refused it' });
    assert.equal(recorded.state, outcome);
    assert.equal(recorded.reason, outcome === 'used' ? undefined : 'backendError: the mailbox refused it');
    assert.equal(recorded.sendingHeartbeatAt, at(30_000), 'the last renewal it made is kept');
    assert.deepEqual(validateV2(recorded, id), { ok: true });
  }
});

test('a renewal that cannot be written takes the same path: the lease runs out, and the claimant still records the outcome', async (t) => {
  const { store, id, claim, time, open } = await claimed();
  t.mock.timers.enable({ apis: ['setInterval'] });
  const failing = {
    heartbeat: async () => {
      throw new Error('the state directory is read-only');
    },
  };
  let finish!: () => void;
  const work = new Promise<void>((settle) => {
    finish = settle;
  });
  const leased = withSendingLease(failing, id, claim.claimToken, () => work);
  for (let beat = 0; beat < 4; beat += 1) {
    time.advance(30_000);
    t.mock.timers.tick(30_000);
  }
  await sleep(20);
  assert.equal((await open().inspect(id)).outcome.state, 'unknown', 'the lease ran out');
  finish();
  await leased;
  assert.equal((await store.complete(id, claim.claimToken, { sentMessageId: 's-1' })).state, 'used');
});

// ── Who may move a record ───────────────────────────────────────────────────────────────────────────────────────

test('a missing, stale or different token can neither renew nor finish a send, and writes nothing', async () => {
  const { store, id, claim, dir } = await claimed();
  const other = await claimed();
  const before = file(dir, id);
  for (const token of ['', 'f'.repeat(32), other.claim.claimToken, claim.claimToken.toUpperCase()]) {
    for (const attempt of [
      () => store.heartbeat(id, token),
      () => store.fence(id, token),
      () => store.complete(id, token, { sentMessageId: 's-1' }),
      () => store.complete(id, token, { error: 'nope' }),
    ]) {
      await assert.rejects(
        attempt(),
        (e: unknown) => e instanceof CommsError && /does not hold the claim/.test(e.message),
        JSON.stringify(token),
      );
    }
  }
  assert.equal(file(dir, id), before);
  assert.equal((await store.complete(id, claim.claimToken, { sentMessageId: 's-1' })).state, 'used');
});

test('approve, revoke and claim leave unknown final, and a resumed renewal never brings it back to sending', async () => {
  const { store, id, claim, time, dir } = await claimed();
  time.advance(SENDING_LEASE_MS);
  assert.equal((await store.inspect(id)).outcome.state, 'unknown');
  const before = file(dir, id);
  await assert.rejects(
    store.claimForSend(id, LIVE),
    (e: unknown) => e instanceof CommsError && e.code === 'SEND_OUTCOME_UNKNOWN',
  );
  await assert.rejects(
    store.issueChallenge(id),
    (e: unknown) => e instanceof CommsError && e.code === 'SEND_OUTCOME_UNKNOWN',
  );
  await assert.rejects(
    store.approve(id, 'terminal', { draftMessageId: 'msg-v1', contentDigest: 'a'.repeat(64) }, 'ABCD'),
    (e: unknown) => e instanceof CommsError && e.code === 'SEND_OUTCOME_UNKNOWN',
  );
  assert.equal(asV2(await store.revoke(id, 'cancelled', { disposition: 'person' }))?.state, 'unknown');
  // The claimant wakes and renews: lost, and nothing written.
  assert.equal(await store.heartbeat(id, claim.claimToken), 'lost');
  assert.equal(await store.fence(id, claim.claimToken), 'stop');
  assert.equal(file(dir, id), before, 'unknown, byte for byte');
});

test('persisted expiry or unknown stays final through a clock rollback and a restart; a rollback after used or failed changes nothing', async () => {
  // Expired.
  const expiring = machine();
  const pending = await expiring.store.create({
    channel: 'gmail',
    inboxId: OWNER,
    inboxSub: 'sub-1',
    draftId: 'r-draft-1',
    draftMessageId: 'msg-v1',
    contentDigest: 'a'.repeat(64),
    sendEpoch: 0,
    policy: 'chat',
    requiredPolicy: 'chat',
    riskFlags: [],
    expect: EXPECT,
  });
  expiring.time.advance(11 * 60_000);
  assert.equal((await expiring.store.inspect(pending.approvalId)).outcome.state, 'expired');
  // Unknown.
  const lost = await claimed();
  lost.time.advance(SENDING_LEASE_MS);
  assert.equal((await lost.store.inspect(lost.id)).outcome.state, 'unknown');
  // Used and failed.
  const used = await claimed();
  await used.store.complete(used.id, used.claim.claimToken, { sentMessageId: 's-1' });
  const failed = await claimed();
  await failed.store.complete(failed.id, failed.claim.claimToken, { error: 'refused' });

  for (const [m, id, state] of [
    [expiring, pending.approvalId, 'expired'],
    [lost, lost.id, 'unknown'],
    [used, used.id, 'used'],
    [failed, failed.id, 'failed'],
  ] as const) {
    const bytes = file(m.dir, id);
    // The clock rolled back past the claim, then a restart.
    m.time.set(T0 - 60 * 60_000);
    const restarted = m.open();
    assert.equal((await restarted.inspect(id)).outcome.state, state, `${state}, after a rollback and a restart`);
    assert.equal(file(m.dir, id), bytes, `${state}: nothing rewritten`);
  }
});

// ── What other callers are told ─────────────────────────────────────────────────────────────────────────────────

test('another caller seeing a fresh sending record is told to wait for it, retryably, with when it started and when it lapses', async () => {
  const { store, id, claim, time } = await claimed();
  time.advance(30_000);
  await store.heartbeat(id, claim.claimToken);
  await assert.rejects(store.claimForSend(id, LIVE), (e: unknown) => {
    assert.ok(e instanceof CommsError);
    assert.equal(e.code, 'APPROVAL_PENDING');
    assert.equal(e.retryable, true);
    assert.equal(e.message, `nothing was sent: it is being sent by another call since ${at(0)}; wait for it`);
    // Never "prepare again": the send is under way.
    assert.doesNotMatch(e.message, /prepare/i);
    assert.match(e.hint ?? '', /Do not prepare it again/);
    const approval = e.details?.approval as Record<string, unknown>;
    assert.equal(approval.state, 'sending');
    assert.equal(approval.claimable, false);
    assert.equal(approval.sendingAt, at(0));
    assert.equal(approval.sendingHeartbeatAt, at(30_000));
    assert.equal(approval.unknownAt, at(30_000 + SENDING_LEASE_MS));
    return true;
  });
});

// ── The fence, directly, with no provider ───────────────────────────────────────────────────────────────────────

test('fence stops once another caller persisted unknown', async () => {
  const { store, id, claim, time, open, dir } = await claimed();
  time.advance(SENDING_LEASE_MS);
  assert.equal((await open().inspect(id)).outcome.state, 'unknown');
  const before = file(dir, id);
  assert.equal(await store.fence(id, claim.claimToken), 'stop');
  assert.equal(JSON.parse(file(dir, id)).sendingHeartbeatAt, undefined, 'its heartbeat was not refreshed');
  assert.equal(file(dir, id), before);
});

test('fence refreshes the heartbeat and proceeds while the claim owns sending', async () => {
  const { store, id, claim, time, dir } = await claimed();
  time.advance(90_000);
  assert.equal(await store.fence(id, claim.claimToken), 'go');
  assert.equal(JSON.parse(file(dir, id)).sendingHeartbeatAt, at(90_000));
  // And so its lease now runs from the fence, not the claim.
  time.advance(SENDING_LEASE_MS - 1);
  assert.equal((await store.inspect(id)).outcome.state, 'sending');
});

test('fenceOrStop before any provider step completes the record failed with lease-lost-before-send', async () => {
  const { store, id, claim, time } = await claimed();
  time.advance(SENDING_LEASE_MS);
  const verdict = await fenceOrStop(store, id, claim.claimToken, { stepsStarted: 0 });
  assert.equal(verdict.proceed, false);
  assert.ok(!verdict.proceed && verdict.error);
  assert.match(verdict.error.message, /^nothing was sent: /);
  const record = (await stateOf(store, id)) as ApprovalRecord;
  assert.equal(record.state, 'failed');
  assert.equal(record.reason, LEASE_LOST_BEFORE_SEND);
  assert.ok(record.failedAt);
  // While it holds the send, the fence lets the step go.
  const going = await claimed();
  assert.deepEqual(await fenceOrStop(going.store, going.id, going.claim.claimToken, { stepsStarted: 0 }), {
    proceed: true,
  });
});

test('fenceOrStop after a started step leaves the failure to its caller', async () => {
  const { store, id, claim, time } = await claimed();
  time.advance(SENDING_LEASE_MS);
  const verdict = await fenceOrStop(store, id, claim.claimToken, { stepsStarted: 2 });
  assert.deepEqual(verdict, { proceed: false, error: null });
  const record = await stateOf(store, id);
  assert.equal(
    record?.state,
    'unknown',
    'no lease-lost-before-send is written: earlier steps may have reached the provider',
  );
  assert.notEqual(record?.reason, LEASE_LOST_BEFORE_SEND);
});
