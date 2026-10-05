import assert from 'node:assert/strict';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { setTimeout as sleep } from 'node:timers/promises';
import { deriveLegacyV1State } from '../src/approval-legacy.ts';
import { asV2, stateOf } from '../src/approval-stored.ts';
import { validateV2 } from '../src/approval-validate.ts';
import {
  type ApprovalRecord,
  ApprovalStore,
  type ChangeBinding,
  changeDigest,
  downloadDigest,
  type Expectation,
  publicView,
} from '../src/approvals.ts';
import { openCore } from '../src/core.ts';
import { canonicalJson, sha256Hex } from '../src/digest.ts';
import { CommsError } from '../src/errors.ts';
import { CORE_CALLER } from '../src/handoffs.ts';
import { APPROVAL_ID_PATTERN } from '../src/ids.ts';
import { withFileLock } from '../src/lock.ts';
import { revokeApproval } from '../src/operations/maintenance.ts';
import {
  readV1Record,
  V1_CREATED_AT,
  v1ChangeRecord,
  v1DownloadRecord,
  v1RecordPath,
  v1SendRecord,
  writeV1Record,
} from './fixtures/approval-v1-0.13.0.ts';
import { coreHandoffs } from './helpers/handoffs.ts';
import { type LiveConfigState, liveConfig } from './helpers/live-config.ts';
import { tempDir } from './helpers/temp.ts';

const INBOX = 'ibx_AAAAAAAAAAAAAAAA';
const OTHER_INBOX = 'ibx_BBBBBBBBBBBBBBBB';
const SLACK = 'acc_AAAAAAAAAAAAAAAA';

/** What the store classifies by: `acme/gmail` sending under `policy`, a second mailbox, and a Slack account. */
function gate(policy: 'chat' | 'confirm' | 'never' = 'chat', extra: LiveConfigState = {}): LiveConfigState {
  return {
    inboxes: { 'acme/gmail': { id: INBOX, sendPolicy: policy }, 'acme/gmail-2': { id: OTHER_INBOX } },
    accounts: { 'acme/slack': { id: SLACK } },
    ...extra,
  };
}
const EXPECT: Expectation = { to: ['sam@partner.test'], cc: [], bcc: [], subject: 'Re: plan' };
/** Content digests as a provider's would be: lowercase hex SHA-256, the only encoding a version-2 record holds. */
const DIGEST_A = 'a'.repeat(64);
const DIGEST_B = 'b'.repeat(64);
const DIGEST_C = 'c'.repeat(64);
const LIVE_DRAFT = { draftMessageId: 'msg-v1', contentDigest: DIGEST_A };

function clock(start = Date.parse('2026-09-18T10:00:00.000Z')) {
  let t = start;
  return { now: () => new Date(t), advance: (ms: number) => (t += ms) };
}

async function setup(policy: 'chat' | 'confirm' = 'chat', escalated = false) {
  const time = clock();
  const dir = tempDir();
  // Core's own handoffs, as `openCore({ caller })` hands the store: a refusal that names a command needs them.
  const handoffs = coreHandoffs({
    configDir: dir,
    stateDir: dir,
    dataDir: dir,
    secretsDir: dir,
    downloadsDir: dir,
  });
  const config = liveConfig(dir, gate(policy));
  const store = new ApprovalStore(dir, { now: time.now, handoffs, loadConfig: config.loadConfig });
  const record = await store.create({
    channel: 'gmail',
    inboxId: INBOX,
    inboxSub: 'sub-1',
    draftId: 'r-draft-1',
    draftMessageId: 'msg-v1',
    contentDigest: DIGEST_A,
    sendEpoch: 0,
    policy,
    requiredPolicy: escalated ? 'confirm' : policy,
    riskFlags: escalated ? ['tainted-recipient'] : [],
    expect: EXPECT,
  });
  return { store, record, time, config, dir };
}

const live = (overrides: Partial<Parameters<ApprovalStore['claimForSend']>[1]> = {}) => ({
  inboxId: INBOX,
  inboxSub: 'sub-1',
  ...LIVE_DRAFT,
  expect: EXPECT,
  ...overrides,
});

function isRefusal(pattern: RegExp, code?: string) {
  return (e: unknown) =>
    e instanceof CommsError && (code === undefined || e.code === code) && e.exitCode === 10 && pattern.test(e.message);
}

async function humanApproves(store: ApprovalStore, id: string, draft = LIVE_DRAFT) {
  const challenge = await store.issueChallenge(id);
  return store.approve(id, 'terminal', draft, challenge.toLowerCase());
}

test('a new record is pending, has no challenge until one is issued, and expires after ten minutes', async () => {
  const { store, record, time } = await setup();
  assert.match(record.approvalId, APPROVAL_ID_PATTERN);
  assert.equal(record.challengeHash, undefined);
  assert.equal(record.state, 'pending');
  time.advance(10 * 60 * 1000);
  assert.equal(asV2(await store.get(record.approvalId))?.state, 'expired');
  await assert.rejects(store.claimForSend(record.approvalId, live()), isRefusal(/expired/, 'APPROVAL_EXPIRED'));
});

test('chat: the matching draft is claimed once, then completed; later claims are refused', async () => {
  const { store, record } = await setup();
  const claim = await store.claimForSend(record.approvalId, live());
  assert.equal(claim.record.state, 'sending');
  await assert.rejects(
    store.claimForSend(record.approvalId, live()),
    isRefusal(/being sent by another call since .+; wait for it/, 'APPROVAL_PENDING'),
  );
  assert.equal((await store.complete(record.approvalId, claim.claimToken, { sentMessageId: 'sent-1' })).state, 'used');
  await assert.rejects(
    store.claimForSend(record.approvalId, live()),
    isRefusal(/used already: it was sent at .+, message id sent-1/, 'APPROVAL_VOID'),
  );
});

test('parallel claims from many stores ("processes"): exactly one wins', async () => {
  const { store, record, time, config } = await setup();
  const stateDir = store.directory.replace(/[/\\]approvals$/, '');
  const results = await Promise.allSettled(
    Array.from({ length: 10 }, () =>
      new ApprovalStore(stateDir, { now: time.now, loadConfig: config.loadConfig }).claimForSend(
        record.approvalId,
        live(),
      ),
    ),
  );
  assert.equal(results.filter((r) => r.status === 'fulfilled').length, 1);
});

test('a display name around the same address is not a different recipient', async () => {
  const { store, record } = await setup();
  // The provider returns what it parsed; the caller gave bare addresses. Same people, so the approval still holds.
  const claimed = await store.claimForSend(
    record.approvalId,
    live({ expect: { ...EXPECT, to: EXPECT.to.map((address) => `Sam Lee <${address}>`) } }),
  );
  assert.equal(claimed.record.state, 'sending');
});

test('integrity failures void the record for good; each carries its specific code', async () => {
  const cases: [string, Partial<ReturnType<typeof live>>, RegExp, string][] = [
    ['A→B→A swap restores content, not the message id', { draftMessageId: 'msg-v3' }, /edited after/, 'APPROVAL_VOID'],
    ['content changed', { contentDigest: DIGEST_B }, /content changed/, 'APPROVAL_VOID'],
    ['other account', { inboxSub: 'sub-2' }, /different account/, 'APPROVAL_VOID'],
    ['no account named at all', { inboxSub: undefined }, /could not be confirmed/, 'APPROVAL_VOID'],
    ['recipients differ', { expect: { ...EXPECT, bcc: ['x@evil.test'] } }, /do not match/, 'APPROVAL_VOID'],
  ];
  for (const [name, overrides, message, code] of cases) {
    const { store, record } = await setup();
    await assert.rejects(store.claimForSend(record.approvalId, live(overrides)), isRefusal(message, code), name);
    assert.equal((asV2(await store.get(record.approvalId)) as ApprovalRecord).state, 'revoked', `${name}: voided`);
    await assert.rejects(store.claimForSend(record.approvalId, live()), isRefusal(/voided/, 'APPROVAL_VOID'), name);
  }
  // The policy is the configuration's, read under the record's lock: tightened to never, the claim revokes.
  const { store, record, config } = await setup();
  config.write(gate('never'));
  await assert.rejects(store.claimForSend(record.approvalId, live()), isRefusal(/policy: never/, 'POLICY_NEVER'));
  assert.equal(asV2(await store.get(record.approvalId))?.state, 'revoked');
});

test('a claim for another inbox is the one NOT_FOUND, and leaves the record as it is', async () => {
  const { store, record } = await setup();
  const missing = `ap_${'0'.repeat(26)}`;
  const envelope = async (claim: Promise<unknown>) => {
    try {
      await claim;
    } catch (error) {
      assert.ok(error instanceof CommsError);
      return {
        code: error.code,
        message: error.message.replace(/ap_\w+/, 'ap_ID'),
        hint: error.hint,
        details: error.details,
      };
    }
    assert.fail('the claim should be refused');
  };
  const foreign = await envelope(store.claimForSend(record.approvalId, live({ inboxId: OTHER_INBOX })));
  assert.deepEqual(foreign, await envelope(store.claimForSend(missing, live({ inboxId: OTHER_INBOX }))));
  assert.equal(foreign.code, 'NOT_FOUND');
  assert.deepEqual(foreign.details, { approval: null });
  assert.equal(asV2(await store.get(record.approvalId))?.state, 'pending', 'not voided: it is not the caller’s');
  assert.equal((await store.claimForSend(record.approvalId, live())).record.state, 'sending');
});

test('expect comparison ignores order and case but not content', async () => {
  const { store, record } = await setup();
  const reordered = { ...EXPECT, to: ['SAM@partner.test'] };
  assert.equal((await store.claimForSend(record.approvalId, live({ expect: reordered }))).record.state, 'sending');
});

test('confirm: a claim before approval is refused without voiding; after a human approves, it succeeds', async () => {
  const { store, record } = await setup('confirm');
  await assert.rejects(
    store.claimForSend(record.approvalId, live()),
    isRefusal(/outside the chat/, 'APPROVAL_PENDING'),
  );
  assert.equal(asV2(await store.get(record.approvalId))?.state, 'pending', 'still approvable');
  const approved = await humanApproves(store, record.approvalId);
  assert.equal(approved.state, 'approved');
  assert.equal(approved.approvedBindingDigest, approved.bindingDigest, 'the binding the person approved');
  assert.equal(approved.approvedDigest, undefined, 'a send carries the approved binding, not a content digest');
  assert.equal(approved.challengeHash, undefined, 'the challenge is spent');
  assert.equal((await store.claimForSend(record.approvalId, live())).record.state, 'sending');
});

test('a claim waiting for a person says what the product making it tells it to, and no product by default', async () => {
  // The store is shared by every product and the command that approves is not: its own default named
  // `agent-gmail approve`, so a Slack post held for approval sent the agent to a command that could not approve it.
  const { store, record } = await setup('confirm');
  const hint = async (options?: Parameters<ApprovalStore['claimForSend']>[2]) => {
    try {
      await store.claimForSend(record.approvalId, live(), options);
    } catch (error) {
      assert.ok(error instanceof CommsError && error.code === 'APPROVAL_PENDING');
      return error.hint ?? '';
    }
    assert.fail('the claim should wait for a person');
  };
  assert.equal(
    await hint({ pendingHint: 'Run the product’s own approve command.' }),
    'Run the product’s own approve command.',
  );
  const neutral = await hint();
  assert.match(neutral, /approve/);
  assert.doesNotMatch(neutral, /gmail|slack/i, 'a default that names a product is wrong for every other one');
  assert.equal(asV2(await store.get(record.approvalId))?.state, 'pending', 'and asking twice changed nothing');
});

test('an escalated chat send needs a human approval; a looser live policy never relaxes it', async () => {
  const { store, record } = await setup('chat', true);
  assert.equal(record.requiredPolicy, 'confirm');
  await assert.rejects(
    store.claimForSend(record.approvalId, live()),
    isRefusal(/outside the chat/, 'APPROVAL_PENDING'),
  );
  await humanApproves(store, record.approvalId);
  assert.equal((await store.claimForSend(record.approvalId, live())).record.state, 'sending');
});

test('a record that requires "never" is refused, whatever the live policy says', async () => {
  // The gap this closes: the effective policy was only compared against `confirm`, so a record carrying
  // `requiredPolicy: never` — a policy that was tightened after the preview, or an escalation that decided this
  // must not go at all — fell straight through to being claimed from `pending`.
  const time = clock();
  const dir = tempDir();
  const store = new ApprovalStore(dir, { now: time.now, loadConfig: liveConfig(dir, gate()).loadConfig });
  const record = await store.create({
    channel: 'gmail',
    inboxId: INBOX,
    inboxSub: 'sub-1',
    draftId: 'r-draft-1',
    draftMessageId: 'msg-v1',
    contentDigest: DIGEST_A,
    sendEpoch: 0,
    policy: 'chat',
    requiredPolicy: 'never',
    riskFlags: ['policy-tightened'],
    expect: EXPECT,
  });
  await assert.rejects(store.claimForSend(record.approvalId, live()), isRefusal(/turned off/, 'POLICY_NEVER'));
  assert.equal(asV2(await store.get(record.approvalId))?.state, 'revoked');

  // And a human approval does not rescue it either: `never` means never.
  const second = await store.create({
    channel: 'gmail',
    inboxId: INBOX,
    inboxSub: 'sub-1',
    draftId: 'r-draft-2',
    draftMessageId: 'msg-v1',
    contentDigest: DIGEST_A,
    sendEpoch: 0,
    policy: 'chat',
    requiredPolicy: 'never',
    riskFlags: [],
    expect: EXPECT,
  });
  // Nor can a person approve it: the attempt itself revokes it, and nothing is ever written as approved.
  await assert.rejects(humanApproves(store, second.approvalId), isRefusal(/turned off/, 'POLICY_NEVER'));
  assert.equal(asV2(await store.get(second.approvalId))?.state, 'revoked');
  // Revoked by `never`, and said so from then on (D2): voided, with its reason.
  await assert.rejects(
    store.claimForSend(second.approvalId, live()),
    isRefusal(/voided \(sending is turned off/, 'APPROVAL_VOID'),
  );
});

test('approving content that changed since prepare voids the record (the human would see something else)', async () => {
  const { store, record } = await setup('confirm');
  const challenge = await store.issueChallenge(record.approvalId);
  await assert.rejects(
    store.approve(record.approvalId, 'terminal', { draftMessageId: 'msg-v2', contentDigest: DIGEST_C }, challenge),
    isRefusal(/changed after the preview/, 'APPROVAL_VOID'),
  );
  assert.equal(asV2(await store.get(record.approvalId))?.state, 'revoked');
});

test('challenges: case-insensitive, never exposed, three wrong answers void the record', async () => {
  const { store, record } = await setup('confirm');
  const challenge = await store.issueChallenge(record.approvalId);
  assert.match(challenge, /^[A-Z]{4}$/);
  const stored = asV2(await store.get(record.approvalId)) as ApprovalRecord;
  assert.ok(stored.challengeHash && !stored.challengeHash.includes(challenge));
  assert.equal('challengeHash' in publicView(stored), false, 'listings never carry the challenge hash');
  const wrong = challenge === 'AAAA' ? 'BBBB' : 'AAAA';
  const approve = (answer: string) => store.approve(record.approvalId, 'terminal', LIVE_DRAFT, answer);
  await assert.rejects(approve(wrong), isRefusal(/did not match/, 'APPROVAL_REQUIRED'));
  await assert.rejects(approve(wrong), isRefusal(/did not match/, 'APPROVAL_REQUIRED'));
  await assert.rejects(approve(wrong), isRefusal(/too many wrong/, 'APPROVAL_VOID'));
  assert.equal(asV2(await store.get(record.approvalId))?.state, 'revoked');
  await assert.rejects(approve(challenge), isRefusal(/voided/, 'APPROVAL_VOID'));
});

test('approving without an issued challenge is refused', async () => {
  const { store, record } = await setup('confirm');
  await assert.rejects(
    store.approve(record.approvalId, 'terminal', LIVE_DRAFT, 'ABCD'),
    isRefusal(/no challenge was issued/),
  );
});

test('a send left in "sending" by a dead process reads as unknown and can still record its outcome', async () => {
  const { store, record, time } = await setup();
  const { claimToken } = await store.claimForSend(record.approvalId, live());
  time.advance(5 * 60 * 1000);
  assert.equal(asV2(await store.get(record.approvalId))?.state, 'unknown');
  assert.equal((await store.complete(record.approvalId, claimToken, { sentMessageId: 's1' })).state, 'used');
});

test('the O_EXCL claim marker refuses a second claim even if the record file were reset', async () => {
  const { store, record } = await setup();
  await store.claimForSend(record.approvalId, live());
  const path = join(store.directory, `${record.approvalId}.json`);
  // Reset to exactly what a pending record is — no `sendingAt` left behind, which would read as corrupt — so what
  // refuses the second claim is the marker alone.
  const { sendingAt: _claimed, ...reset } = JSON.parse(readFileSync(path, 'utf8'));
  writeFileSync(path, JSON.stringify({ ...reset, state: 'pending' }));
  await assert.rejects(store.claimForSend(record.approvalId, live()), isRefusal(/already claimed/, 'APPROVAL_VOID'));
});

test('failed sends are recorded; revoke leaves finished records alone', async () => {
  const { store, record } = await setup();
  const { claimToken } = await store.claimForSend(record.approvalId, live());
  assert.equal((await store.complete(record.approvalId, claimToken, { error: 'backendError' })).state, 'failed');
  assert.equal(stateOf(await store.revoke(record.approvalId, 'user', { disposition: 'person' })), 'failed');
});

test('create ignores caller-supplied ids, states and challenges', async () => {
  const { store, record } = await setup();
  const sneaky = {
    ...record,
    state: 'approved',
    approvedDigest: DIGEST_A,
    challengeHash: 'x',
  } as unknown as Parameters<ApprovalStore['create']>[0];
  const created = await store.create(sneaky);
  assert.notEqual(created.approvalId, record.approvalId);
  assert.equal(created.state, 'pending');
  assert.equal(created.approvedDigest, undefined);
  assert.equal(created.challengeHash, undefined);
  assert.equal(asV2(await store.get(record.approvalId))?.state, 'pending', 'the original is untouched');
});

test('list filters by inbox and state; malformed ids are refused before touching the file system', async () => {
  const { store, record } = await setup();
  const second = await store.create({ ...record, sendEpoch: 0, inboxId: OTHER_INBOX });
  await store.revoke(second.approvalId, 'user', { disposition: 'person' });
  assert.deepEqual(
    (await store.list({ inboxId: INBOX })).map((r) => asV2(r)?.approvalId),
    [record.approvalId],
  );
  assert.equal((await store.list({ states: ['revoked'] })).length, 1);
  await assert.rejects(store.get('../../config'), (e: unknown) => e instanceof CommsError && e.code === 'USAGE');
});

/** A change approval in the same store: `acme/slack` widened from read to send. */
const CHANGE: ChangeBinding = {
  summary: 'Let acme/slack post',
  target: { kind: 'account', name: 'acme/slack', id: 'acc_AAAAAAAAAAAAAAAA' },
  loosened: [{ path: 'accounts.acme/slack.mode', before: 'read', after: 'send', id: 'acc_AAAAAAAAAAAAAAAA' }],
  effects: ['signs in to Slack again'],
};

test('a change approval is never spent as a send, nor a send approval as a change — and trying harms neither', async () => {
  const { store, record: send } = await setup();
  const change = await store.createChange({ channel: 'slack', change: CHANGE, policy: 'chat' });
  assert.equal(change.kind, 'change');
  assert.equal(send.kind, 'send', 'a version-2 send says it is one');

  // Another kind's id is the one NOT_FOUND, as an id that names nothing is: nothing of the record is said.
  const wrongKind = (pattern: RegExp) => (e: unknown) =>
    e instanceof CommsError &&
    e.code === 'NOT_FOUND' &&
    pattern.test(e.message) &&
    JSON.stringify(e.details) === JSON.stringify({ approval: null });
  const asSend = /^nothing was sent: no approval ap_\w+$/;
  const asChange = /^nothing was changed: no approval ap_\w+$/;

  // Every door a send uses refuses a change's approval: the challenge, the typed approval and the claim.
  await assert.rejects(store.issueChallenge(change.approvalId), wrongKind(asSend), 'issueChallenge');
  await assert.rejects(store.approve(change.approvalId, 'terminal', LIVE_DRAFT, 'ABCD'), wrongKind(asSend), 'approve');
  await assert.rejects(store.claimForSend(change.approvalId, live()), wrongKind(asSend), 'claimForSend');
  // And the doors a change uses refuse a send's.
  await assert.rejects(store.issueChallenge(send.approvalId, 'change'), wrongKind(asChange), 'issueChallenge change');
  await assert.rejects(
    store.approve(send.approvalId, 'terminal', LIVE_DRAFT, 'ABCD', 'change'),
    wrongKind(asChange),
    'approve change',
  );
  await assert.rejects(
    store.claimForChange(send.approvalId, { change: CHANGE, policy: 'chat' }),
    wrongKind(asChange),
    'claimForChange',
  );

  // Neither was voided or consumed by the attempts: each still works for what it is.
  assert.equal(asV2(await store.get(send.approvalId))?.state, 'pending');
  assert.equal(asV2(await store.get(change.approvalId))?.state, 'pending');
  assert.equal((await store.claimForSend(send.approvalId, live())).record.state, 'sending');
  assert.equal((await store.claimForChange(change.approvalId, { change: CHANGE, policy: 'chat' })).state, 'used');
});

test('a change approval is claimed once, even if its record file were reset', async () => {
  const { store } = await setup();
  const change = await store.createChange({ channel: 'slack', change: CHANGE, policy: 'chat' });
  const claim = () => store.claimForChange(change.approvalId, { change: CHANGE, policy: 'chat' });
  assert.equal((await claim()).state, 'used');
  await assert.rejects(
    claim(),
    isRefusal(/nothing was changed: the approved change was already claimed at /, 'APPROVAL_VOID'),
  );
  const path = join(store.directory, `${change.approvalId}.json`);
  const { usedAt: _used, ...reset } = JSON.parse(readFileSync(path, 'utf8'));
  writeFileSync(path, JSON.stringify({ ...reset, state: 'pending' }));
  await assert.rejects(claim(), isRefusal(/nothing was changed: this approval was already claimed/, 'APPROVAL_VOID'));
});

test('a change approval is bound to a digest the store computes, of the change it stores', async () => {
  const { store } = await setup();
  const change = await store.createChange({ channel: 'slack', change: CHANGE, policy: 'confirm' });
  assert.equal(change.contentDigest, changeDigest(CHANGE));
  assert.equal(
    change.draftMessageId,
    change.contentDigest,
    'the digest stands in for a draft revision, as a reaction’s does',
  );
  assert.equal(change.inboxId, 'acc_AAAAAAAAAAAAAAAA');
  assert.equal(change.requiredPolicy, 'confirm');
  // The order the classifier lists loosenings in does not matter; the values, the account and the effects do.
  const two = {
    ...CHANGE,
    loosened: [...CHANGE.loosened, { path: 'defaults.sendPolicy', before: 'confirm', after: 'chat' }],
  };
  assert.equal(changeDigest(two), changeDigest({ ...two, loosened: [...two.loosened].reverse() }));
  assert.notEqual(changeDigest(CHANGE), changeDigest({ ...CHANGE, effects: [] }));
  assert.notEqual(
    changeDigest(CHANGE),
    changeDigest({ ...CHANGE, target: { kind: 'account', name: 'acme/slack', id: 'acc_BBBBBBBBBBBBBBBB' } }),
  );
  const reworded: ChangeBinding = { ...CHANGE, summary: 'worded differently' };
  assert.equal(changeDigest(CHANGE), changeDigest(reworded), 'the summary is not bound');
});

// ── A claim whose caller is cancelled while it waits ────────────────────────────────────────────────────────────

/**
 * Holds a record's lock, as another process part-way through a transition of it would, until `release` is called.
 * Resolves once the lock is held, so a claim made after it has to wait.
 */
async function holdLock(store: ApprovalStore, approvalId: string): Promise<{ release: () => Promise<void> }> {
  let release!: () => void;
  const released = new Promise<void>((settle) => {
    release = settle;
  });
  let held!: () => void;
  const holding = new Promise<void>((settle) => {
    held = settle;
  });
  const done = withFileLock(join(store.directory, `${approvalId}.json.lock`), async () => {
    held();
    await released;
  });
  await holding;
  return {
    release: async () => {
      release();
      await done;
    },
  };
}

/**
 * A claim started with its signal clear, which is then cancelled while the claim waits for the lock, and the lock let
 * go: what the claim does next is what the tests below are about.
 */
async function cancelledWhileWaiting<T>(
  store: ApprovalStore,
  approvalId: string,
  claim: (signal: AbortSignal) => Promise<T>,
) {
  const lock = await holdLock(store, approvalId);
  const cancel = new AbortController();
  const claiming = claim(cancel.signal);
  // Long enough for the claim to be waiting on the lock rather than on its way to it; either way, it waits.
  await sleep(100);
  cancel.abort();
  await lock.release();
  return claiming;
}

function isCancelled(message: RegExp) {
  return (e: unknown) =>
    e instanceof CommsError && e.code === 'USAGE' && message.test(e.message) && e.details?.reason === 'cancelled';
}

test('a send claim cancelled while it waits for the lock writes nothing: the record is as it was, for the same call again', async () => {
  const { store, record } = await setup('confirm');
  await humanApproves(store, record.approvalId);
  const claim = (signal?: AbortSignal) => store.claimForSend(record.approvalId, live(), signal ? { signal } : {});

  await assert.rejects(
    cancelledWhileWaiting(store, record.approvalId, claim),
    isCancelled(/^cancelled: nothing was sent$/),
  );
  // Still approved, and with no claim marker: before the change it was `sending`, spent on a call nobody awaited.
  assert.equal(asV2(await store.get(record.approvalId))?.state, 'approved');
  assert.equal((await claim()).record.state, 'sending');
});

test('a change claim cancelled while it waits for the lock writes nothing, and the approval can still be claimed', async () => {
  const { store } = await setup();
  const change = await store.createChange({ channel: 'slack', change: CHANGE, policy: 'chat' });
  const claim = (signal?: AbortSignal) =>
    store.claimForChange(change.approvalId, { change: CHANGE, policy: 'chat' }, signal ? { signal } : {});

  await assert.rejects(
    cancelledWhileWaiting(store, change.approvalId, claim),
    isCancelled(/^cancelled: nothing was changed$/),
  );
  assert.equal(asV2(await store.get(change.approvalId))?.state, 'pending');
  assert.equal((await claim()).state, 'used');
});

test('a download’s question claimed by a call cancelled while it waits for the lock stays open, and the answer unused', async () => {
  const dir = tempDir();
  const store = new ApprovalStore(dir, { now: clock().now, loadConfig: liveConfig(dir, gate()).loadConfig });
  const request = {
    target: { kind: 'account' as const, name: 'acme/slack', id: 'acc_AAAAAAAAAAAAAAAA' },
    operation: 'files.download',
    request: { selection: { kind: 'files', fileIds: ['F01'] }, maxFiles: 50 },
    files: ['F01'],
    names: ['report.pdf'],
  };
  const question = await store.createDownload({
    channel: 'slack',
    download: {
      ...request,
      summary: 'where to save 1 file from acme/slack',
      folders: { downloads: '/d', current: '/c' },
    },
    policy: 'chat',
  });
  const claim = (signal?: AbortSignal) =>
    store.claimForDownload(question.approvalId, request, signal ? { policy: 'chat', signal } : { policy: 'chat' });

  await assert.rejects(cancelledWhileWaiting(store, question.approvalId, claim), (e: unknown) => {
    assert.ok(isCancelled(/^cancelled: nothing was saved$/)(e), String(e));
    assert.equal((e as CommsError).details?.choiceId, question.approvalId);
    return true;
  });
  assert.equal(asV2(await store.get(question.approvalId))?.state, 'pending');
  assert.equal((await claim()).state, 'used');
});

// ── Records from an earlier release (version 1) ─────────────────────────────────────────────────────────────────

/*
 * 0.13.0 wrote version 1: a send with no `kind`, one `digest`, no binding. This release reads such a record but never
 * claims, approves, answers or completes it (D1's version gate), and writes it only to retire it — in its own shape,
 * when a person cancels it or its owner is removed. Each case below checks the bytes on disk, not only the result.
 */

const V1_SEND_ID = `ap_${'0'.repeat(25)}1`;
const V1_APPROVED_ID = `ap_${'0'.repeat(25)}2`;
const V1_CHANGE_ID = `ap_${'0'.repeat(25)}3`;
const V1_DOWNLOAD_ID = `ap_${'0'.repeat(25)}4`;
const V1_DOWNLOAD = {
  summary: 'where to save 1 file from acme/slack',
  target: { kind: 'account' as const, name: 'acme/slack', id: 'acc_AAAAAAAAAAAAAAAA' },
  operation: 'files.download',
  request: { selection: { kind: 'files', fileIds: ['F01'] }, maxFiles: 50 },
  files: ['F01'],
  names: ['report.pdf'],
  folders: { downloads: '/d', current: '/c' },
};

/** A store over a state directory holding one version-1 record of each kind, as 0.13.0 left them, at 10:00. */
function legacyStore(state: { send?: string; approved?: string } = {}) {
  const dir = tempDir();
  const time = clock(Date.parse(V1_CREATED_AT));
  const store = new ApprovalStore(dir, {
    now: time.now,
    handoffs: coreHandoffs({ configDir: dir, stateDir: dir, dataDir: dir, secretsDir: dir, downloadsDir: dir }),
  });
  const bytes = {
    send: writeV1Record(
      dir,
      v1SendRecord({
        approvalId: V1_SEND_ID,
        inboxId: INBOX,
        inboxSub: 'sub-1',
        draftId: 'r-draft-1',
        draftMessageId: 'msg-v1',
        digest: DIGEST_A,
        expect: EXPECT,
        state: state.send ?? 'pending',
      }),
    ),
    approved: writeV1Record(
      dir,
      v1SendRecord({
        approvalId: V1_APPROVED_ID,
        inboxId: INBOX,
        inboxSub: 'sub-1',
        draftId: 'r-draft-2',
        draftMessageId: 'msg-v1',
        digest: DIGEST_A,
        policy: 'confirm',
        expect: EXPECT,
        state: state.approved ?? 'approved',
        approvedDigest: DIGEST_A,
        approvedVia: 'terminal',
      }),
    ),
    change: writeV1Record(
      dir,
      v1ChangeRecord({ approvalId: V1_CHANGE_ID, digest: changeDigest(CHANGE), change: { ...CHANGE } }),
    ),
    download: writeV1Record(
      dir,
      v1DownloadRecord({
        approvalId: V1_DOWNLOAD_ID,
        digest: downloadDigest(V1_DOWNLOAD),
        download: { ...V1_DOWNLOAD },
      }),
    ),
  };
  return { dir, store, time, bytes };
}

function isVersionRefusal(e: unknown): boolean {
  return (
    e instanceof CommsError &&
    e.code === 'APPROVAL_VOID' &&
    /prepared by a different version of agent-communications/.test(e.message)
  );
}

/** The record's bytes are what they were, and no claim marker was made beside it. */
function untouched(dir: string, approvalId: string, before: string, why: string) {
  assert.equal(readV1Record(dir, approvalId), before, `${why}: the file is byte-identical`);
  assert.equal(existsSync(v1RecordPath(dir, approvalId, '.claim')), false, `${why}: no claim marker`);
}

test('a version-1 record is refused by the version gate on every claim, approve, challenge, answer and complete — writing nothing', async () => {
  for (const moment of ['fresh', 'past its original expiry'] as const) {
    const { dir, store, time, bytes } = legacyStore();
    if (moment !== 'fresh') time.advance(31 * 60 * 1000);
    const attempts: [string, string, string, () => Promise<unknown>][] = [
      ['issueChallenge', V1_SEND_ID, bytes.send, () => store.issueChallenge(V1_SEND_ID)],
      ['approve', V1_SEND_ID, bytes.send, () => store.approve(V1_SEND_ID, 'terminal', LIVE_DRAFT, 'ABCD')],
      ['claimForSend (pending)', V1_SEND_ID, bytes.send, () => store.claimForSend(V1_SEND_ID, live())],
      ['claimForSend (approved)', V1_APPROVED_ID, bytes.approved, () => store.claimForSend(V1_APPROVED_ID, live())],
      ['complete', V1_SEND_ID, bytes.send, () => store.complete(V1_SEND_ID, 'f'.repeat(32), { sentMessageId: 's1' })],
      ['issueChallenge (change)', V1_CHANGE_ID, bytes.change, () => store.issueChallenge(V1_CHANGE_ID, 'change')],
      [
        'approve (change)',
        V1_CHANGE_ID,
        bytes.change,
        () =>
          store.approve(
            V1_CHANGE_ID,
            'terminal',
            { draftMessageId: changeDigest(CHANGE), contentDigest: changeDigest(CHANGE) },
            'ABCD',
            'change',
          ),
      ],
      [
        'claimForChange',
        V1_CHANGE_ID,
        bytes.change,
        () => store.claimForChange(V1_CHANGE_ID, { change: CHANGE, policy: 'chat' }),
      ],
      [
        'answerDownload',
        V1_DOWNLOAD_ID,
        bytes.download,
        () => store.answerDownload(V1_DOWNLOAD_ID, 'terminal', { choice: 'downloads' }),
      ],
      [
        'claimForDownload',
        V1_DOWNLOAD_ID,
        bytes.download,
        () =>
          store.claimForDownload(
            V1_DOWNLOAD_ID,
            {
              target: V1_DOWNLOAD.target,
              operation: V1_DOWNLOAD.operation,
              request: V1_DOWNLOAD.request,
              files: V1_DOWNLOAD.files,
              names: V1_DOWNLOAD.names,
            },
            { policy: 'chat' },
          ),
      ],
    ];
    for (const [name, approvalId, before, attempt] of attempts) {
      await assert.rejects(attempt(), isVersionRefusal, `${name}, ${moment}`);
      untouched(dir, approvalId, before, `${name}, ${moment}`);
    }
  }
});

test('a person’s revoke of a fresh v1 record writes a v1-shaped revoked', async () => {
  for (const disposition of ['person', 'lifecycle'] as const) {
    const { dir, store, time, bytes } = legacyStore();
    time.advance(60 * 1000);
    for (const [approvalId, before] of [
      [V1_SEND_ID, bytes.send],
      [V1_APPROVED_ID, bytes.approved],
      [V1_CHANGE_ID, bytes.change],
      [V1_DOWNLOAD_ID, bytes.download],
    ] as const) {
      const result = await store.revoke(approvalId, 'revoked by the user', { disposition });
      assert.equal(stateOf(result), 'revoked', `${disposition} ${approvalId}`);
      const original = JSON.parse(before) as Record<string, unknown>;
      const after = JSON.parse(readV1Record(dir, approvalId)) as Record<string, unknown>;
      assert.equal(after.digestVersion, 1);
      // The original, plus the state, the reason and `updatedAt` — and nothing else: no field of version 2.
      assert.deepStrictEqual(after, {
        ...original,
        state: 'revoked',
        reason: 'revoked by the user',
        updatedAt: '2026-09-18T10:01:00.000Z',
      });
      assert.deepStrictEqual(Object.keys(after).sort(), [...new Set([...Object.keys(original), 'reason'])].sort());
      for (const added of [
        'contentDigest',
        'bindingDigest',
        'channel',
        'ownerScope',
        'route',
        'revokedAt',
        'expiredAt',
      ]) {
        assert.equal(added in after, false, `${approvalId}: no ${added}`);
      }
      if (approvalId === V1_SEND_ID || approvalId === V1_APPROVED_ID)
        assert.equal('kind' in after, false, 'a v1 send stays without a kind');
      assert.equal(existsSync(v1RecordPath(dir, approvalId, '.claim')), false, 'no claim marker');
      // And 0.13.0's own rules read it as revoked: a running 0.13 process can no longer claim it.
      assert.equal(deriveLegacyV1State(after as never, time.now()).state, 'revoked');
    }
  }
});

test('a person’s revoke of an expired v1 record writes nothing', async () => {
  const { dir, store, time, bytes } = legacyStore();
  time.advance(10 * 60 * 1000); // exactly the original expiry: expired, as 0.13.0 derived it.
  for (const [approvalId, before] of [
    [V1_SEND_ID, bytes.send],
    [V1_APPROVED_ID, bytes.approved],
    [V1_CHANGE_ID, bytes.change],
  ] as const) {
    const result = await store.revoke(approvalId, 'revoked by the user', { disposition: 'person' });
    assert.equal(stateOf(result), 'expired', `${approvalId}: returned as it reads, not an error`);
    untouched(dir, approvalId, before, approvalId);
  }
});

test('revoking a v1 record in any other derived state writes nothing', async () => {
  const states: [string, number, string][] = [
    ['used', 0, 'used'],
    ['failed', 0, 'failed'],
    ['revoked', 0, 'revoked'],
    ['sending', 60 * 1000, 'sending'],
    ['sending', 5 * 60 * 1000, 'unknown'],
  ];
  for (const [stored, after, derived] of states) {
    const { dir, store, time, bytes } = legacyStore({ send: stored });
    time.advance(after);
    const result = await store.revoke(V1_SEND_ID, 'revoked by the user', { disposition: 'person' });
    assert.equal(stateOf(result), derived, `${stored} after ${after} ms`);
    untouched(dir, V1_SEND_ID, bytes.send, `${stored} after ${after} ms`);
  }
});

test('an integrity revoke of a fresh v1 record gets the version refusal, and the file is byte-identical', async () => {
  const { dir, store, bytes } = legacyStore();
  for (const [approvalId, before] of [
    [V1_SEND_ID, bytes.send],
    [V1_APPROVED_ID, bytes.approved],
    [V1_CHANGE_ID, bytes.change],
    [V1_DOWNLOAD_ID, bytes.download],
  ] as const) {
    await assert.rejects(store.revoke(approvalId, 'the draft changed', { disposition: 'integrity' }), isVersionRefusal);
    untouched(dir, approvalId, before, approvalId);
  }
});

test('a v1 record stays revocable after its owner is gone: agentcomms approvals revoke needs neither the account nor any config', async () => {
  const dir = tempDir();
  // A config with no accounts at all: the record's `acc_` owner was removed by another path.
  writeFileSync(join(dir, 'config.json'), `${JSON.stringify({ version: 2 }, null, 2)}\n`);
  const core = openCore({
    env: { AGENT_COMMS_CONFIG_DIR: dir, HOME: dir, USERPROFILE: dir },
    now: () => new Date(Date.parse(V1_CREATED_AT) + 60 * 1000),
    caller: CORE_CALLER,
  });
  const record = v1SendRecord({
    approvalId: V1_SEND_ID,
    inboxId: 'acc_AAAAAAAAAAAAAAAA',
    inboxSub: 'U0POSTER',
    draftId: 'sd_post',
    draftMessageId: 'rev-3',
    digest: DIGEST_A,
    expect: { to: ['C0ROOM'], cc: [], bcc: [], subject: 'reaches 3' },
  });
  writeV1Record(core.paths.stateDir, record);
  const view = await revokeApproval(core, V1_SEND_ID, 'cli');
  assert.equal(view.state, 'revoked');
  const after = JSON.parse(readV1Record(core.paths.stateDir, V1_SEND_ID)) as Record<string, unknown>;
  assert.deepStrictEqual(after, {
    ...record,
    state: 'revoked',
    reason: 'revoked by the user',
    updatedAt: '2026-09-18T10:01:00.000Z',
  });
});

// ── What each transition writes (CUE-404 Task 2) ────────────────────────────────────────────────────────────────

/** The record's file, parsed, exactly as the store left it. */
function stored(store: ApprovalStore, approvalId: string): Record<string, unknown> {
  return JSON.parse(readFileSync(join(store.directory, `${approvalId}.json`), 'utf8')) as Record<string, unknown>;
}

/** What a transition added, removed and changed, `updatedAt` aside — and the record it left, which must validate. */
async function writes(store: ApprovalStore, approvalId: string, transition: () => Promise<unknown>) {
  const before = stored(store, approvalId);
  await transition().catch(() => undefined);
  const after = stored(store, approvalId);
  const keys = new Set([...Object.keys(before), ...Object.keys(after)]);
  const added = [...keys].filter((key) => !(key in before) && key in after).sort();
  const removed = [...keys].filter((key) => key in before && !(key in after)).sort();
  const changed = [...keys]
    .filter((key) => key in before && key in after && key !== 'updatedAt')
    .filter((key) => JSON.stringify(before[key]) !== JSON.stringify(after[key]))
    .sort();
  const validation = validateV2(after as unknown as ApprovalRecord, approvalId);
  assert.deepEqual(validation, { ok: true }, `${approvalId} validates after the transition`);
  return { added, removed, changed, after };
}

test('each send transition writes exactly its fields, and every record it leaves validates', async () => {
  const { store, record, time } = await setup('confirm');
  assert.deepEqual(validateV2(stored(store, record.approvalId) as never, record.approvalId), { ok: true }, 'create');
  let challenge = '';
  const issued = await writes(store, record.approvalId, async () => {
    challenge = await store.issueChallenge(record.approvalId);
  });
  assert.deepEqual([issued.added, issued.removed, issued.changed], [['challengeHash'], [], []]);
  time.advance(60_000);
  const approved = await writes(store, record.approvalId, () =>
    store.approve(record.approvalId, 'terminal', LIVE_DRAFT, challenge),
  );
  assert.deepEqual(approved.added, ['approvedAt', 'approvedBindingDigest', 'approvedVia', 'usableUntil']);
  assert.deepEqual(approved.removed, ['challengeHash']);
  assert.deepEqual(approved.changed, ['state']);
  assert.equal(approved.after.approvedAt, '2026-09-18T10:01:00.000Z');
  assert.equal(approved.after.usableUntil, '2026-09-19T10:01:00.000Z', '24 hours after approval');
  assert.equal(approved.after.approvedBindingDigest, record.bindingDigest);
  time.advance(60_000);
  let token = '';
  const sending = await writes(store, record.approvalId, async () => {
    token = (await store.claimForSend(record.approvalId, live())).claimToken;
  });
  assert.deepEqual([sending.added, sending.removed, sending.changed], [['sendingAt'], [], ['state']]);
  assert.equal(sending.after.sendingAt, '2026-09-18T10:02:00.000Z');
  // An empty provider id records nothing: the record stays `sending`.
  const empty = await writes(store, record.approvalId, () =>
    store.complete(record.approvalId, token, { sentMessageId: '' }),
  );
  assert.deepEqual([empty.added, empty.removed, empty.changed], [[], [], []]);
  await assert.rejects(
    store.complete(record.approvalId, token, { sentMessageId: '' }),
    (e: unknown) => e instanceof CommsError && e.code === 'BAD_DATA',
  );
  time.advance(30_000);
  const used = await writes(store, record.approvalId, () =>
    store.complete(record.approvalId, token, { sentMessageId: 's-1' }),
  );
  assert.deepEqual(used.added, ['sentAt', 'sentMessageId', 'usedAt']);
  assert.deepEqual(used.changed, ['state']);
  assert.equal(used.after.usedAt, used.after.sentAt, 'usedAt is the moment the provider accepted it');
  assert.equal(used.after.sentAt, '2026-09-18T10:02:30.000Z');

  const failing = await setup();
  const failingClaim = await failing.store.claimForSend(failing.record.approvalId, live());
  failing.time.advance(1000);
  const failed = await writes(failing.store, failing.record.approvalId, () =>
    failing.store.complete(failing.record.approvalId, failingClaim.claimToken, { error: 'backendError' }),
  );
  assert.deepEqual([failed.added, failed.changed], [['failedAt', 'reason'], ['state']]);
});

test('every revoke and void of a version-2 record writes revokedAt, and nothing else of its own', async () => {
  const cases: [string, (s: Awaited<ReturnType<typeof setup>>) => Promise<unknown>, string[]][] = [
    [
      'revoke',
      ({ store, record }) => store.revoke(record.approvalId, 'user', { disposition: 'person' }),
      ['reason', 'revokedAt'],
    ],
    [
      'a claim that voids',
      ({ store, record }) => store.claimForSend(record.approvalId, live({ contentDigest: DIGEST_B })),
      ['reason', 'revokedAt'],
    ],
    [
      'an approval of changed content',
      async ({ store, record }) => {
        const code = await store.issueChallenge(record.approvalId);
        await store.approve(record.approvalId, 'terminal', { draftMessageId: 'msg-v2', contentDigest: DIGEST_C }, code);
      },
      ['challengeHash', 'reason', 'revokedAt'],
    ],
    [
      'three wrong codes',
      async ({ store, record }) => {
        const code = await store.issueChallenge(record.approvalId);
        const wrong = code === 'AAAA' ? 'BBBB' : 'AAAA';
        for (let i = 0; i < 3; i += 1)
          await store.approve(record.approvalId, 'terminal', LIVE_DRAFT, wrong).catch(() => undefined);
      },
      ['challengeHash', 'reason', 'revokedAt'],
    ],
  ];
  for (const [name, act, added] of cases) {
    const fixture = await setup('confirm');
    const result = await writes(fixture.store, fixture.record.approvalId, () => act(fixture));
    assert.deepEqual(result.added, added, name);
    assert.equal(result.after.state, 'revoked', name);
    assert.equal(result.after.revokedAt, '2026-09-18T10:00:00.000Z', name);
  }
});

test('a change claim writes usedAt; one approved at a terminal writes the approval first', async () => {
  const { store, time } = await setup();
  const direct = await store.createChange({ channel: 'slack', change: CHANGE, policy: 'chat' });
  time.advance(30_000);
  const claimed = await writes(store, direct.approvalId, () =>
    store.claimForChange(direct.approvalId, { change: CHANGE, policy: 'chat' }),
  );
  assert.deepEqual([claimed.added, claimed.changed], [['usedAt'], ['state']]);
  assert.equal(claimed.after.usedAt, '2026-09-18T10:00:30.000Z');

  const confirm = await store.createChange({ channel: 'slack', change: CHANGE, policy: 'confirm' });
  const live = { draftMessageId: confirm.contentDigest, contentDigest: confirm.contentDigest };
  const code = await store.issueChallenge(confirm.approvalId, 'change');
  const approved = await writes(store, confirm.approvalId, () =>
    store.approve(confirm.approvalId, 'terminal', live, code, 'change'),
  );
  assert.deepEqual(approved.added, ['approvedAt', 'approvedBindingDigest', 'approvedVia', 'usableUntil']);
  time.advance(10 * 60 * 1000);
  const used = await writes(store, confirm.approvalId, () =>
    store.claimForChange(confirm.approvalId, { change: CHANGE, policy: 'confirm' }),
  );
  assert.deepEqual([used.added, used.changed], [['usedAt'], ['state']]);
  assert.equal(used.after.usedAt, '2026-09-18T10:10:30.000Z', 'after the approval, inside its window');
});

test('a download’s answer binds the answer to the record, with no approvedAt; its claim writes usedAt', async () => {
  const dir = tempDir();
  const store = new ApprovalStore(dir, { now: clock().now, loadConfig: liveConfig(dir, gate()).loadConfig });
  const request = {
    target: { kind: 'account' as const, name: 'acme/slack', id: 'acc_AAAAAAAAAAAAAAAA' },
    operation: 'files.download',
    request: { selection: { kind: 'files', fileIds: ['F01'] }, maxFiles: 50 },
    files: ['F01'],
    names: ['report.pdf'],
  };
  const question = await store.createDownload({
    channel: 'slack',
    download: {
      ...request,
      summary: 'where to save 1 file from acme/slack',
      folders: { downloads: '/d', current: '/c' },
    },
    policy: 'confirm',
  });
  const answered = await writes(store, question.approvalId, () =>
    store.answerDownload(question.approvalId, 'terminal', { choice: 'downloads' }),
  );
  assert.deepEqual(answered.added, ['approvedDigest', 'approvedVia']);
  assert.deepEqual(answered.changed, ['download', 'state']);
  assert.equal(
    answered.after.approvedDigest,
    sha256Hex(canonicalJson({ bindingDigest: question.bindingDigest, answer: { choice: 'downloads' } })),
  );
  assert.equal('approvedAt' in answered.after, false, 'a question is answered, not approved into a window');
  const claimed = await writes(store, question.approvalId, () =>
    store.claimForDownload(question.approvalId, request, { policy: 'confirm' }),
  );
  assert.deepEqual([claimed.added, claimed.changed], [['usedAt'], ['state']]);

  const chat = await store.createDownload({
    channel: 'slack',
    download: {
      ...request,
      summary: 'where to save 1 file from acme/slack',
      folders: { downloads: '/d', current: '/c' },
    },
    policy: 'chat',
  });
  const direct = await writes(store, chat.approvalId, () =>
    store.claimForDownload(chat.approvalId, request, { policy: 'chat' }),
  );
  assert.deepEqual([direct.added, direct.changed], [['usedAt'], ['state']], 'a chat answer is never persisted');
});

test('a derived expiry is persisted with expiredAt at the boundary that applied; a clock before creation at the time it was seen', async () => {
  const deadline = await setup();
  deadline.time.advance(25 * 60 * 1000);
  const expired = await writes(deadline.store, deadline.record.approvalId, () =>
    deadline.store.revoke(deadline.record.approvalId, 'user', { disposition: 'person' }),
  );
  assert.deepEqual(expired.added, ['expiredAt', 'reason']);
  assert.equal(expired.after.expiredAt, deadline.record.expiresAt, 'the boundary, not the moment it was noticed');

  const rollback = await setup();
  rollback.time.advance(-5 * 60 * 1000);
  const anomaly = await writes(rollback.store, rollback.record.approvalId, () =>
    rollback.store.revoke(rollback.record.approvalId, 'user', { disposition: 'person' }),
  );
  assert.equal(anomaly.after.state, 'expired');
  assert.equal(anomaly.after.reason, 'clock-anomaly');
  assert.equal(anomaly.after.expiredAt, '2026-09-18T09:55:00.000Z', 'the time the clock was seen');

  const stale = await setup();
  const staleClaim = await stale.store.claimForSend(stale.record.approvalId, live());
  stale.time.advance(5 * 60 * 1000);
  const unknown = await writes(stale.store, stale.record.approvalId, () =>
    stale.store.complete(stale.record.approvalId, staleClaim.claimToken, { error: 'x' }).then(() => undefined),
  );
  assert.equal(unknown.after.state, 'failed', 'a late outcome still lands, from unknown');
});

// ── Route-bound lifetimes (CUE-404 Task 6; design 2026-10-05 §D1) ───────────────────────────────────────────────

const MINUTE = 60_000;
const at = (ms: number) => new Date(Date.parse('2026-09-18T10:00:00.000Z') + ms).toISOString();
const stateNow = async (store: ApprovalStore, approvalId: string) => asV2(await store.get(approvalId));

test('chat-route records expire at ten minutes and confirm-route records at thirty, escalated sends included; equality is expired', async () => {
  for (const [name, policy, escalated, lifetime] of [
    ['a chat send', 'chat', false, 10 * MINUTE],
    ['a confirm send', 'confirm', false, 30 * MINUTE],
    ['an escalated chat send', 'chat', true, 30 * MINUTE],
  ] as const) {
    const { store, record, time } = await setup(policy, escalated);
    assert.equal(record.route, lifetime === 10 * MINUTE ? 'chat' : 'confirm', name);
    assert.equal(record.expiresAt, at(lifetime), name);
    time.advance(lifetime - 1);
    assert.equal((await stateNow(store, record.approvalId))?.state, 'pending', `${name}, a millisecond before`);
    time.advance(1);
    await assert.rejects(store.claimForSend(record.approvalId, live()), isRefusal(/expired/, 'APPROVAL_EXPIRED'), name);
    const expired = await stateNow(store, record.approvalId);
    assert.equal(expired?.state, 'expired', `${name}, at the boundary`);
    assert.equal(expired?.expiredAt, at(lifetime), `${name}: the boundary is what is written`);
  }
  for (const [policy, lifetime] of [
    ['chat', 10 * MINUTE],
    ['confirm', 30 * MINUTE],
  ] as const) {
    const { store, time } = await setup();
    const change = await store.createChange({ channel: 'slack', change: CHANGE, policy });
    time.advance(lifetime - 1);
    assert.equal((await stateNow(store, change.approvalId))?.state, 'pending', `a ${policy} change`);
    time.advance(1);
    assert.equal((await stateNow(store, change.approvalId))?.state, 'expired', `a ${policy} change, at ${lifetime}`);
  }
});

test('a confirm route never claims directly after loosening; a chat route tightened to confirm waits inside its own window', async () => {
  const confirm = await setup('confirm');
  confirm.config.write(gate('chat'));
  await assert.rejects(
    confirm.store.claimForSend(confirm.record.approvalId, live()),
    isRefusal(/outside the chat/, 'APPROVAL_PENDING'),
  );
  assert.equal((await stateNow(confirm.store, confirm.record.approvalId))?.state, 'pending');

  const chat = await setup('chat');
  chat.config.write(gate('confirm'));
  chat.time.advance(5 * MINUTE);
  await assert.rejects(
    chat.store.claimForSend(chat.record.approvalId, live()),
    isRefusal(/outside the chat/, 'APPROVAL_PENDING'),
  );
  assert.equal((await stateNow(chat.store, chat.record.approvalId))?.state, 'pending', 'waiting, not voided');
  // A person approves it inside the ten minutes it was given: from then it has a day.
  const code = await chat.store.issueChallenge(chat.record.approvalId);
  await chat.store.approve(chat.record.approvalId, 'terminal', LIVE_DRAFT, code);
  chat.time.advance(20 * MINUTE);
  assert.equal((await chat.store.claimForSend(chat.record.approvalId, live())).record.state, 'sending');
  // Unapproved, the tightened record does not outlive its original window.
  const late = await setup('chat');
  late.config.write(gate('confirm'));
  late.time.advance(10 * MINUTE);
  await assert.rejects(
    late.store.claimForSend(late.record.approvalId, live()),
    isRefusal(/expired/, 'APPROVAL_EXPIRED'),
  );
});

test('an approved send survives its pending deadline and expires exactly a day after approval, unused', async () => {
  const { store, record, time } = await setup('confirm');
  time.advance(MINUTE);
  await humanApproves(store, record.approvalId);
  const approved = await stateNow(store, record.approvalId);
  assert.equal(approved?.usableUntil, at(MINUTE + 24 * 60 * MINUTE));
  time.advance(30 * MINUTE);
  assert.equal((await stateNow(store, record.approvalId))?.state, 'approved', 'past the pending deadline');
  time.advance(24 * 60 * MINUTE - 30 * MINUTE - 1);
  assert.equal((await stateNow(store, record.approvalId))?.state, 'approved', 'a millisecond before its day ends');
  time.advance(1);
  await assert.rejects(
    store.claimForSend(record.approvalId, live()),
    (e: unknown) =>
      e instanceof CommsError &&
      e.code === 'APPROVAL_EXPIRED' &&
      e.message ===
        `this approval expired; nothing was sent with it: approved at ${at(MINUTE)}, expired unused at ${at(MINUTE + 24 * 60 * MINUTE)}`,
  );
  const expired = await stateNow(store, record.approvalId);
  assert.equal(expired?.expiredAt, expired?.usableUntil, 'the boundary that applied is the approval’s own');
  assert.equal(expired?.approvedAt, at(MINUTE), 'and its approval is kept');

  // Claimed inside the day: once.
  const again = await setup('confirm');
  await humanApproves(again.store, again.record.approvalId);
  again.time.advance(23 * 60 * MINUTE);
  assert.equal((await again.store.claimForSend(again.record.approvalId, live())).record.state, 'sending');
});

test('an approved change can be claimed until its own day ends, not its pending deadline', async () => {
  const { store, time } = await setup();
  const change = await store.createChange({ channel: 'slack', change: CHANGE, policy: 'confirm' });
  const digest = { draftMessageId: change.contentDigest, contentDigest: change.contentDigest };
  time.advance(MINUTE);
  await store.approve(
    change.approvalId,
    'terminal',
    digest,
    await store.issueChallenge(change.approvalId, 'change'),
    'change',
  );
  time.advance(12 * 60 * MINUTE);
  assert.equal((await store.claimForChange(change.approvalId, { change: CHANGE, policy: 'confirm' })).state, 'used');
});

test('an approval at the pending deadline is refused as expired, and nothing approved is written', async () => {
  const { store, record, time } = await setup('confirm');
  const code = await store.issueChallenge(record.approvalId);
  time.advance(30 * MINUTE);
  await assert.rejects(
    store.approve(record.approvalId, 'terminal', LIVE_DRAFT, code),
    (e: unknown) =>
      e instanceof CommsError &&
      e.code === 'APPROVAL_EXPIRED' &&
      e.message ===
        `this approval expired; nothing was sent with it: prepared at ${at(0)}, expired at ${at(30 * MINUTE)}`,
  );
  const after = await stateNow(store, record.approvalId);
  assert.equal(after?.state, 'expired');
  assert.equal(after?.approvedAt, undefined, 'never approved at the boundary');
});

test('a download’s question expires thirty minutes after it was asked, answered or not, and never gains a window of its own', async () => {
  const dir = tempDir();
  const time = clock();
  const store = new ApprovalStore(dir, { now: time.now, loadConfig: liveConfig(dir, gate()).loadConfig });
  const request = {
    target: { kind: 'account' as const, name: 'acme/slack', id: SLACK },
    operation: 'files.download',
    request: { selection: { kind: 'files', fileIds: ['F01'] }, maxFiles: 50 },
    files: ['F01'],
    names: ['report.pdf'],
  };
  const ask = () =>
    store.createDownload({
      channel: 'slack',
      download: { ...request, summary: 'where to save 1 file', folders: { downloads: '/d', current: '/c' } },
      policy: 'confirm',
    });
  const unanswered = await ask();
  const answered = await ask();
  time.advance(29 * MINUTE);
  await store.answerDownload(answered.approvalId, 'terminal', { choice: 'downloads' });
  time.advance(MINUTE);
  for (const question of [unanswered, answered]) {
    const now = await stateNow(store, question.approvalId);
    assert.equal(now?.state, 'expired');
    assert.equal(now?.expiredAt, at(30 * MINUTE));
    assert.equal(now?.usableUntil, undefined);
    assert.equal(now?.approvedAt, undefined);
  }
});

test('a conversational no the server never hears: claims at eleven and twenty-nine minutes find a chat route expired', async () => {
  const { store, record, time } = await setup('chat');
  time.advance(11 * MINUTE);
  await assert.rejects(store.claimForSend(record.approvalId, live()), isRefusal(/expired/, 'APPROVAL_EXPIRED'), '11');
  time.advance(18 * MINUTE);
  await assert.rejects(store.claimForSend(record.approvalId, live()), isRefusal(/expired/, 'APPROVAL_EXPIRED'), '29');
  assert.equal((await stateNow(store, record.approvalId))?.expiredAt, at(10 * MINUTE));
});

test('two simultaneous claims after the former ten-minute boundary of a confirm route: one winner', async () => {
  const { store, record, time, config } = await setup('confirm');
  time.advance(11 * MINUTE);
  assert.equal((await stateNow(store, record.approvalId))?.state, 'pending', 'thirty minutes, not ten');
  await humanApproves(store, record.approvalId);
  const stateDir = store.directory.replace(/[/\\]approvals$/, '');
  const results = await Promise.allSettled(
    [0, 1].map(() =>
      new ApprovalStore(stateDir, { now: time.now, loadConfig: config.loadConfig }).claimForSend(
        record.approvalId,
        live(),
      ),
    ),
  );
  assert.equal(results.filter((result) => result.status === 'fulfilled').length, 1);
  assert.equal((await stateNow(store, record.approvalId))?.state, 'sending');
});

test('a clock moved back before creation or approval expires the record at the time it was seen, safely, for good', async () => {
  // Before creation: pending.
  const pending = await setup('confirm');
  pending.time.advance(-5 * MINUTE);
  await assert.rejects(
    pending.store.claimForSend(pending.record.approvalId, live()),
    (e: unknown) =>
      e instanceof CommsError &&
      e.code === 'APPROVAL_EXPIRED' &&
      e.message ===
        `the clock moved backwards; this approval was expired safely at ${at(-5 * MINUTE)}; nothing was sent with it`,
  );
  // Before approval: approved a minute in, then the clock goes back half a minute.
  const approved = await setup('confirm');
  approved.time.advance(MINUTE);
  await humanApproves(approved.store, approved.record.approvalId);
  approved.time.advance(-30_000);
  await assert.rejects(
    approved.store.claimForSend(approved.record.approvalId, live()),
    isRefusal(/the clock moved backwards; this approval was expired safely at /, 'APPROVAL_EXPIRED'),
  );
  for (const [fixture, seen] of [
    [pending, at(-5 * MINUTE)],
    [approved, at(30_000)],
  ] as const) {
    const written = stored(fixture.store, fixture.record.approvalId);
    assert.equal(written.state, 'expired');
    assert.equal(written.reason, 'clock-anomaly');
    assert.equal(written.expiredAt, seen, 'the time the clock was seen');
    // A restart with the clock put right: still expired, and the same record.
    const restarted = new ApprovalStore(fixture.dir, {
      now: () => new Date(Date.parse(at(2 * MINUTE))),
      loadConfig: fixture.config.loadConfig,
    });
    assert.equal(asV2(await restarted.get(fixture.record.approvalId))?.state, 'expired');
    await assert.rejects(
      restarted.claimForSend(fixture.record.approvalId, live()),
      isRefusal(/clock moved backwards/, 'APPROVAL_EXPIRED'),
    );
  }
  // Only that reason excuses an expiry before creation: the same record with another reason is corrupt.
  const path = join(pending.store.directory, `${pending.record.approvalId}.json`);
  writeFileSync(
    path,
    JSON.stringify({ ...stored(pending.store, pending.record.approvalId), reason: 'the approval window passed' }),
  );
  const read = await pending.store.get(pending.record.approvalId);
  assert.equal(read === null ? null : stateOf(read), 'corrupt');
});
