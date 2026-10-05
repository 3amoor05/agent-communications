import assert from 'node:assert/strict';
import { test } from 'node:test';
import { bindingDigestOf } from '../src/approval-binding.ts';
import { CLOCK_ANOMALY, type IntegrityReason, validateV2 } from '../src/approval-validate.ts';
import type { ApprovalRecord, ApprovalState } from '../src/approvals.ts';
import { edited, T0, type V2Spec, v2Record } from './helpers/v2-records.ts';

/*
 * The version-2 integrity validator (design 2026-10-05 §D1, "Digest integrity" and "Version-2 timestamps fail
 * closed"): each record either passes, or is corrupt for one fixed reason, and is attributable or not.
 */

const ID = `ap_${'0'.repeat(25)}V`;
const iso = (ms: number) => new Date(ms).toISOString();
const MIN = 60_000;

function verdict(record: ApprovalRecord): 'ok' | IntegrityReason {
  const result = validateV2(record, ID);
  return result.ok ? 'ok' : result.reason;
}

function corrupt(record: ApprovalRecord, reason: IntegrityReason, why: string, attribution = 'verified') {
  const result = validateV2(record, ID);
  assert.deepEqual(result, { ok: false, reason, attribution }, why);
}

const SEND_STATES: ApprovalState[] = [
  'pending',
  'approved',
  'sending',
  'used',
  'failed',
  'unknown',
  'revoked',
  'expired',
];
const OTHER_STATES: ApprovalState[] = ['pending', 'approved', 'used', 'revoked', 'expired'];

test('kind × route × approvedVia × state: every combination is valid or corrupt for its one reason', () => {
  const expected = (spec: V2Spec): 'ok' | IntegrityReason => {
    const { kind, state, via } = spec;
    if (kind === 'send') {
      if (via === undefined) return state === 'approved' ? 'timestamp-missing' : 'ok';
      return state === 'pending' ? 'timestamp-misplaced' : 'ok';
    }
    if (kind === 'change') {
      if (!OTHER_STATES.includes(state)) return 'state-impossible';
      if (via === undefined) return state === 'approved' ? 'timestamp-missing' : 'ok';
      if (state === 'pending') return 'timestamp-misplaced';
      // A change's confirm is terminal-only: one approved in a form is corrupt, whatever happened next.
      return via === 'terminal' ? 'ok' : 'evidence-invalid';
    }
    if (!OTHER_STATES.includes(state)) return 'state-impossible';
    if (via === undefined) return state === 'approved' ? 'evidence-missing' : 'ok';
    return state === 'pending' ? 'evidence-contradictory' : 'ok';
  };
  let checked = 0;
  for (const kind of ['send', 'change', 'download'] as const) {
    const routes = kind === 'download' ? [undefined] : (['chat', 'confirm'] as const);
    for (const route of routes) {
      for (const via of [undefined, 'terminal', 'elicitation'] as const) {
        for (const state of SEND_STATES) {
          const spec: V2Spec = { kind, state, via, ...(route === undefined ? {} : { route }) };
          // A kind that cannot reach a state is built in a state it can, then moved: the builder writes valid records.
          const reachable = kind === 'send' || OTHER_STATES.includes(state);
          const record = reachable
            ? v2Record(spec)
            : edited(v2Record({ ...spec, state: 'pending', via: undefined }), { state });
          const want = reachable ? expected(spec) : 'state-impossible';
          assert.equal(verdict(record), want, `${kind} ${route ?? '-'} ${via ?? 'chat'} ${state}`);
          checked += 1;
        }
      }
    }
  }
  assert.equal(checked, (2 + 2 + 1) * 3 * 8);
});

test('an approved lineage in every descendant state, with missing, invalid or contradictory evidence, is corrupt', () => {
  const lineages: [V2Spec['kind'], ApprovalState[]][] = [
    ['send', ['approved', 'sending', 'used', 'failed', 'unknown', 'revoked', 'expired']],
    ['change', ['approved', 'used', 'revoked', 'expired']],
    ['download', ['approved', 'used', 'revoked', 'expired']],
  ];
  for (const [kind, states] of lineages) {
    for (const state of states) {
      const record = v2Record({ kind, state, via: 'terminal', route: 'confirm' });
      const name = `${kind} ${state}`;
      assert.equal(verdict(record), 'ok', `${name}: valid as built`);
      corrupt(edited(record, { approvedVia: undefined }), 'evidence-missing', `${name}: no approvedVia`);
      // There is no chat channel of approval: a chat yes claims straight from pending and never writes one.
      corrupt(edited(record, { approvedVia: 'chat' }), 'evidence-invalid', `${name}: approvedVia chat`);
      corrupt(edited(record, { approvedVia: 'TERMINAL' }), 'evidence-invalid', `${name}: approvedVia malformed`);
      if (kind === 'download') {
        corrupt(edited(record, { approvedDigest: undefined }), 'evidence-missing', `${name}: no approvedDigest`);
        corrupt(edited(record, { approvedDigest: 'f'.repeat(64) }), 'evidence-contradictory', `${name}: other answer`);
        corrupt(edited(record, { approvedDigest: 'nope' }), 'evidence-contradictory', `${name}: malformed`);
        const { answer: _answer, ...unanswered } = record.download ?? ({} as never);
        corrupt(edited(record, { download: unanswered }), 'evidence-missing', `${name}: no recorded answer`);
        corrupt(
          edited(record, { download: { ...record.download, answer: { choice: 'current' } } }),
          'evidence-contradictory',
          `${name}: the answer moved after it was bound`,
        );
        corrupt(
          edited(record, { approvedAt: iso(T0 + MIN), usableUntil: iso(T0 + MIN + 86_400_000) }),
          'timestamp-misplaced',
          `${name}: approvedAt on a download`,
        );
      } else {
        corrupt(
          edited(record, { approvedBindingDigest: undefined }),
          'evidence-missing',
          `${name}: no approved binding`,
        );
        corrupt(
          edited(record, { approvedBindingDigest: 'f'.repeat(64) }),
          'evidence-contradictory',
          `${name}: other binding`,
        );
        corrupt(
          edited(record, { approvedBindingDigest: 'nope' }),
          'evidence-contradictory',
          `${name}: malformed binding`,
        );
        corrupt(
          edited(record, { approvedDigest: record.contentDigest }),
          'evidence-contradictory',
          `${name}: a content digest as evidence`,
        );
        corrupt(edited(record, { approvedAt: undefined }), 'timestamp-missing', `${name}: no approvedAt`);
      }
    }
  }
});

test('direct-chat records carry no evidence: sending and used stay valid without it, and failed or unknown must not have it', () => {
  for (const state of ['sending', 'used', 'failed', 'unknown', 'revoked', 'expired'] as const) {
    const record = v2Record({ kind: 'send', state });
    assert.equal(verdict(record), 'ok', `direct-chat send ${state}`);
    assert.equal(record.approvedVia, undefined);
    corrupt(
      edited(record, { approvedVia: 'terminal' }),
      'evidence-contradictory',
      `${state}: approvedVia without approval`,
    );
    corrupt(
      edited(record, { approvedBindingDigest: record.bindingDigest }),
      'evidence-contradictory',
      `${state}: binding without approval`,
    );
  }
  for (const state of ['used', 'revoked', 'expired'] as const) {
    assert.equal(verdict(v2Record({ kind: 'change', state })), 'ok', `direct-chat change ${state}`);
    // A chat-policy download claimed straight from pending to used, with no evidence at all.
    assert.equal(verdict(v2Record({ kind: 'download', state })), 'ok', `direct-chat download ${state}`);
  }
  // A stored answer is allowed only with valid terminal or form evidence.
  const direct = v2Record({ kind: 'download', state: 'used' });
  corrupt(
    edited(direct, { download: { ...direct.download, answer: { choice: 'downloads' } } }),
    'evidence-missing',
    'a direct-chat download with an injected answer',
  );
});

test('confirm downloads answered at a terminal or in a form are valid in approved and used, with no approvedAt', () => {
  for (const via of ['terminal', 'elicitation'] as const) {
    for (const state of ['approved', 'used'] as const) {
      const record = v2Record({ kind: 'download', state, via });
      assert.equal(record.approvedAt, undefined);
      assert.equal(record.policy, 'confirm');
      assert.equal(verdict(record), 'ok', `${via} ${state}`);
    }
  }
});

test('an approved-then-revoked record keeps its evidence and is valid', () => {
  for (const kind of ['send', 'change'] as const) {
    const record = v2Record({ kind, state: 'revoked', via: 'terminal', route: 'confirm' });
    assert.ok(record.approvedAt && record.approvedVia && record.approvedBindingDigest);
    assert.equal(verdict(record), 'ok', kind);
  }
  assert.equal(verdict(v2Record({ kind: 'download', state: 'revoked', via: 'elicitation' })), 'ok');
});

test('digest version, digest encodings and the binding: each its own reason, and its own attribution', () => {
  const record = v2Record({ kind: 'send', state: 'pending' });
  for (const version of [undefined, 1, 3, '2', 2.5]) {
    corrupt(edited(record, { digestVersion: version }), 'digest-version', `digestVersion ${String(version)}`);
  }
  corrupt(
    edited(record, { contentDigest: 'A'.repeat(64) }),
    'binding-mismatch',
    'non-canonical content digest',
    'unverifiable',
  );
  const rebound = (fields: Record<string, unknown>) => {
    const next = edited(record, fields);
    return edited(next, { bindingDigest: bindingDigestOf(next) });
  };
  corrupt(rebound({ contentDigest: 'A'.repeat(64) }), 'content-digest-malformed', 'upper-case hex, rebound');
  corrupt(rebound({ contentDigest: 'digest-A' }), 'content-digest-malformed', 'not hex, rebound');
  corrupt(edited(record, { bindingDigest: undefined }), 'binding-missing', 'no binding', 'unverifiable');
  corrupt(edited(record, { bindingDigest: 'B'.repeat(64) }), 'binding-malformed', 'upper-case binding', 'unverifiable');
  corrupt(edited(record, { bindingDigest: 'b'.repeat(63) }), 'binding-malformed', 'short binding', 'unverifiable');
  corrupt(edited(record, { bindingDigest: 'b'.repeat(64) }), 'binding-mismatch', 'other binding', 'unverifiable');
  assert.deepEqual(validateV2(record, `ap_${'0'.repeat(25)}W`), {
    ok: false,
    reason: 'file-name-mismatch',
    attribution: 'unverifiable',
  });
  // A change's and a download's content is recomputed from what they store.
  const change = v2Record({ kind: 'change', state: 'pending' });
  corrupt(
    edited(change, { change: { ...change.change, effects: ['something else'] } }),
    'content-digest-mismatch',
    'a change whose stored change moved',
  );
  const download = v2Record({ kind: 'download', state: 'pending' });
  corrupt(
    edited(download, { download: { ...download.download, files: ['m1/9', 'm1/2'] } }),
    'content-digest-mismatch',
    'a download whose files moved',
  );
});

test('identity: owner scope, the epoch and a download’s listing names are consistent with what is bound', () => {
  // The listing is bound and so are the names: rebound around a reordered listing, only the two disagree.
  const relisted = v2Record({ kind: 'download', state: 'pending' });
  const listing = relisted.download?.listing ?? [];
  const mismatched = edited(relisted, { download: { ...relisted.download, listing: [...listing].reverse() } });
  corrupt(
    edited(mismatched, { bindingDigest: bindingDigestOf(mismatched) }),
    'listing-mismatch',
    'listing names out of order',
  );
  for (const scope of ['owner', 'prospective', 'global'] as const) {
    assert.equal(verdict(v2Record({ kind: 'change', state: 'pending', scope })), 'ok', `change ${scope}`);
  }
  const send = v2Record({ kind: 'send', state: 'pending' });
  for (const epoch of [-1, 1.5, '0']) {
    const next = edited(send, { sendEpoch: epoch });
    corrupt(
      edited(next, { bindingDigest: bindingDigestOf(next) }),
      'identity-contradiction',
      `sendEpoch ${String(epoch)}`,
    );
  }
});

test('lifetimes: exact pending profile per route, 24 hours once approved', () => {
  const chat = v2Record({ kind: 'send', state: 'pending', route: 'chat' });
  const confirm = v2Record({ kind: 'send', state: 'pending', route: 'confirm' });
  assert.equal(Date.parse(chat.expiresAt) - Date.parse(chat.createdAt), 600_000);
  assert.equal(Date.parse(confirm.expiresAt) - Date.parse(confirm.createdAt), 1_800_000);
  corrupt(
    edited(chat, { expiresAt: iso(T0 + 600_001) }),
    'lifetime-mismatch',
    'a chat route open a millisecond longer',
  );
  corrupt(edited(confirm, { expiresAt: iso(T0 + 600_000) }), 'lifetime-mismatch', 'a confirm route open ten minutes');
  const download = v2Record({ kind: 'download', state: 'pending' });
  corrupt(edited(download, { expiresAt: iso(T0 + 600_000) }), 'lifetime-mismatch', 'a download open ten minutes');
  const approved = v2Record({ kind: 'send', state: 'approved', via: 'terminal', route: 'confirm' });
  corrupt(
    edited(approved, { usableUntil: iso(T0 + MIN + 86_400_001) }),
    'lifetime-mismatch',
    'usableUntil a millisecond late',
  );
  corrupt(edited(approved, { usableUntil: undefined }), 'timestamp-missing', 'approvedAt without usableUntil');
});

test('an approved record whose approvedAt equals expiresAt is corrupt; createdAt <= approvedAt < expiresAt', () => {
  const approved = v2Record({ kind: 'send', state: 'approved', via: 'terminal', route: 'chat' });
  const at = (ms: number) => ({ approvedAt: iso(ms), usableUntil: iso(ms + 86_400_000) });
  assert.equal(verdict(edited(approved, at(T0))), 'ok', 'approved at the moment it was made');
  assert.equal(verdict(edited(approved, at(T0 + 599_999))), 'ok', 'the last moment before the deadline');
  corrupt(edited(approved, at(T0 + 600_000)), 'timestamp-misordered', 'approvedAt == expiresAt');
  corrupt(edited(approved, at(T0 - 1)), 'timestamp-misordered', 'approved before it was made');
});

test('every state-specific timestamp missing, non-finite, misplaced or misordered is corrupt', () => {
  const used = v2Record({ kind: 'send', state: 'used', heartbeat: true });
  for (const field of ['createdAt', 'expiresAt', 'sendingAt', 'usedAt', 'sentAt'] as const) {
    corrupt(edited(used, { [field]: undefined }), 'timestamp-missing', `${field} missing`);
    for (const bad of ['', 'yesterday', '2026-10-05T09:00:00Z', '2026-13-05T09:00:00.000Z', 1_791_200_000_000, null]) {
      corrupt(edited(used, { [field]: bad }), 'timestamp-invalid', `${field} = ${String(bad)}`);
    }
  }
  const missing: [ApprovalState, string][] = [
    ['failed', 'failedAt'],
    ['revoked', 'revokedAt'],
    ['expired', 'expiredAt'],
    ['sending', 'sendingAt'],
    ['unknown', 'sendingAt'],
  ];
  for (const [state, field] of missing) {
    corrupt(
      edited(v2Record({ kind: 'send', state }), { [field]: undefined }),
      'timestamp-missing',
      `${state} without ${field}`,
    );
  }
  // Each in a state it does not belong to.
  const pending = v2Record({ kind: 'send', state: 'pending' });
  for (const field of ['sendingAt', 'sendingHeartbeatAt', 'usedAt', 'sentAt', 'failedAt', 'revokedAt', 'expiredAt']) {
    corrupt(edited(pending, { [field]: iso(T0 + MIN) }), 'timestamp-misplaced', `${field} on pending`);
  }
  corrupt(edited(used, { failedAt: used.usedAt }), 'timestamp-misplaced', 'failedAt on used');
  corrupt(
    edited(v2Record({ kind: 'send', state: 'failed' }), { sentAt: iso(T0 + 3 * MIN) }),
    'timestamp-misplaced',
    'sentAt on failed',
  );
  corrupt(
    edited(v2Record({ kind: 'change', state: 'used' }), { sendingAt: iso(T0 + MIN) }),
    'timestamp-misplaced',
    'sendingAt on a change',
  );
  corrupt(
    edited(v2Record({ kind: 'send', state: 'revoked' }), { expiredAt: iso(T0 + 11 * MIN) }),
    'timestamp-misplaced',
    'expiredAt on revoked',
  );
  // Out of order.
  corrupt(edited(used, { sendingAt: iso(T0 - 1) }), 'timestamp-misordered', 'claimed before it was made');
  corrupt(edited(used, { sendingAt: iso(T0 + 600_000) }), 'timestamp-misordered', 'claimed at the pending deadline');
  const failed = v2Record({ kind: 'send', state: 'failed' });
  corrupt(edited(failed, { failedAt: iso(T0) }), 'timestamp-misordered', 'failed before it was claimed');
  const revoked = v2Record({ kind: 'send', state: 'revoked' });
  corrupt(edited(revoked, { revokedAt: iso(T0 - 1) }), 'timestamp-misordered', 'revoked before it was made');
  corrupt(
    edited(revoked, { revokedAt: revoked.expiresAt }),
    'timestamp-misordered',
    'revoked at the deadline: that is an expiry',
  );
  const approvedRevoked = v2Record({ kind: 'send', state: 'revoked', via: 'terminal', route: 'confirm' });
  corrupt(
    edited(approvedRevoked, { revokedAt: iso(T0 + 30_000) }),
    'timestamp-misordered',
    'revoked before it was approved',
  );
  const expired = v2Record({ kind: 'send', state: 'expired' });
  corrupt(edited(expired, { expiredAt: iso(T0 - 1) }), 'timestamp-misordered', 'expired before it was made');
});

test('a used send has usedAt == sentAt and a provider id; a change’s and a download’s usedAt sits in its window', () => {
  const used = v2Record({ kind: 'send', state: 'used' });
  assert.equal(used.usedAt, used.sentAt);
  corrupt(
    edited(used, { usedAt: iso(Date.parse(used.sentAt as string) + 1) }),
    'timestamp-misordered',
    'usedAt after sentAt',
  );
  corrupt(
    edited(used, { sentAt: iso(T0 + MIN - 1), usedAt: iso(T0 + MIN - 1) }),
    'timestamp-misordered',
    'sent before it was claimed',
  );
  corrupt(edited(used, { sentMessageId: '' }), 'sent-id-missing', 'an empty provider id');
  corrupt(edited(used, { sentMessageId: undefined }), 'sent-id-missing', 'no provider id');
  corrupt(
    edited(v2Record({ kind: 'send', state: 'failed' }), { sentMessageId: 'x' }),
    'timestamp-misplaced',
    'a provider id on a failed send',
  );
  for (const kind of ['change', 'download'] as const) {
    const direct = v2Record({ kind, state: 'used' });
    corrupt(edited(direct, { usedAt: iso(T0 - 1) }), 'timestamp-misordered', `${kind}: used before it was made`);
    corrupt(edited(direct, { usedAt: direct.expiresAt }), 'timestamp-misordered', `${kind}: used at its deadline`);
  }
  const approvedChange = v2Record({ kind: 'change', state: 'used', via: 'terminal', route: 'confirm' });
  assert.equal(
    verdict(edited(approvedChange, { usedAt: iso(T0 + 2 * 3_600_000) })),
    'ok',
    'an approved change used two hours later',
  );
  corrupt(edited(approvedChange, { usedAt: iso(T0 + 30_000) }), 'timestamp-misordered', 'used before it was approved');
  corrupt(
    edited(approvedChange, { usedAt: approvedChange.usableUntil }),
    'timestamp-misordered',
    'used at usableUntil',
  );
});

test('the heartbeat: absent before a claim, optional after it, finite, and between sendingAt and the outcome', () => {
  for (const state of ['sending', 'used', 'failed', 'unknown'] as const) {
    assert.equal(verdict(v2Record({ kind: 'send', state })), 'ok', `${state} without a heartbeat`);
    assert.equal(verdict(v2Record({ kind: 'send', state, heartbeat: true })), 'ok', `${state} with one`);
  }
  for (const state of ['pending', 'approved', 'revoked', 'expired'] as const) {
    const record = v2Record({ kind: 'send', state, via: state === 'approved' ? 'terminal' : undefined });
    corrupt(edited(record, { sendingHeartbeatAt: iso(T0 + MIN) }), 'timestamp-misplaced', `a heartbeat on ${state}`);
  }
  const sending = v2Record({ kind: 'send', state: 'sending', heartbeat: true });
  corrupt(
    edited(sending, { sendingHeartbeatAt: iso(T0 + MIN - 1) }),
    'timestamp-misordered',
    'a heartbeat before the claim',
  );
  corrupt(edited(sending, { sendingHeartbeatAt: 'soon' }), 'timestamp-invalid', 'a heartbeat that is not a time');
  const used = v2Record({ kind: 'send', state: 'used', heartbeat: true });
  corrupt(
    edited(used, { sendingHeartbeatAt: iso(Date.parse(used.usedAt as string) + 1) }),
    'timestamp-misordered',
    'a heartbeat after it was used',
  );
  const failed = v2Record({ kind: 'send', state: 'failed', heartbeat: true });
  corrupt(
    edited(failed, { sendingHeartbeatAt: iso(Date.parse(failed.failedAt as string) + 1) }),
    'timestamp-misordered',
    'a heartbeat after it failed',
  );
});

test('the clock-anomaly exemption covers exactly an expiry with that reason, and nothing else', () => {
  const expired = v2Record({ kind: 'send', state: 'expired' });
  const early = { expiredAt: iso(T0 - 5 * MIN) };
  assert.equal(verdict(edited(expired, { ...early, reason: CLOCK_ANOMALY })), 'ok', 'expired as the clock was seen');
  corrupt(
    edited(expired, { ...early, reason: 'the approval window passed' }),
    'timestamp-misordered',
    'another reason is not exempt',
  );
  const approved = v2Record({ kind: 'send', state: 'expired', via: 'terminal', route: 'confirm' });
  assert.equal(
    verdict(edited(approved, { expiredAt: iso(T0 + 30_000), reason: CLOCK_ANOMALY })),
    'ok',
    'before approvedAt',
  );
  corrupt(
    edited(approved, { expiredAt: iso(T0 + 30_000) }),
    'timestamp-misordered',
    'before approvedAt, ordinary reason',
  );
  // It appears only on that expiry, and every other rule still applies to it.
  corrupt(
    edited(v2Record({ kind: 'send', state: 'revoked' }), { reason: CLOCK_ANOMALY }),
    'timestamp-misplaced',
    'on a revoked record',
  );
  corrupt(
    edited(v2Record({ kind: 'send', state: 'pending' }), { reason: CLOCK_ANOMALY }),
    'timestamp-misplaced',
    'on a pending record',
  );
  corrupt(
    edited(expired, { ...early, reason: CLOCK_ANOMALY, sendingAt: iso(T0) }),
    'timestamp-misplaced',
    'still no sendingAt',
  );
});
