import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { PendingRevocationTokenState } from '@agentcomms/core';
import type { TokenBundle } from '../src/auth/bundle.ts';
import {
  classifyRevocationAnswer,
  createPendingRevocation,
  pendingRevocationTokens,
  type RevocationEvidence,
  revocationTokenResult,
} from '../src/operations/revocations.ts';

const CREATED = '2026-10-04T12:00:00.000Z';
const FALLBACK = '2026-11-03T12:00:00.000Z';

function bundle(over: Partial<TokenBundle> = {}): TokenBundle {
  return {
    v: 1,
    state: 'ready',
    accessToken: 'fake-old-access',
    accessExpiresAt: '2026-10-05T00:00:00.000Z',
    refreshToken: 'fake-old-refresh',
    refreshExpiresAt: '2026-11-01T00:00:00.000Z',
    issuedAt: '2026-10-04T00:00:00.000Z',
    ...over,
  };
}

test('a pending entry fixes each deadline from its own valid expiry and falls back exactly thirty days', () => {
  const cases: Array<{
    label: string;
    bundle: TokenBundle;
    access: string;
    refresh?: string;
  }> = [
    {
      label: 'both valid',
      bundle: bundle(),
      access: '2026-10-05T00:00:00.000Z',
      refresh: '2026-11-01T00:00:00.000Z',
    },
    {
      label: 'an unreadable access expiry',
      bundle: bundle({ accessExpiresAt: 'whenever' }),
      access: FALLBACK,
      refresh: '2026-11-01T00:00:00.000Z',
    },
    {
      label: 'an absent access expiry',
      bundle: bundle({ accessExpiresAt: undefined as unknown as string }),
      access: FALLBACK,
      refresh: '2026-11-01T00:00:00.000Z',
    },
    {
      label: 'an unreadable refresh expiry',
      bundle: bundle({ refreshExpiresAt: 'later' }),
      access: '2026-10-05T00:00:00.000Z',
      refresh: FALLBACK,
    },
    {
      label: 'an absent refresh expiry',
      bundle: bundle({ refreshExpiresAt: undefined }),
      access: '2026-10-05T00:00:00.000Z',
      refresh: FALLBACK,
    },
    {
      label: 'no refresh token',
      bundle: bundle({ refreshToken: undefined, refreshExpiresAt: '2026-11-01T00:00:00.000Z' }),
      access: '2026-10-05T00:00:00.000Z',
    },
  ];

  for (const item of cases) {
    const before = structuredClone(item.bundle);
    const entry = createPendingRevocation({
      ref: 'slack/token/superseded',
      store: 'file',
      workspace: 'T123',
      createdAt: CREATED,
      bundle: item.bundle,
    });
    assert.equal(entry.ref, 'slack/token/superseded', item.label);
    assert.equal(entry.store, 'file', item.label);
    assert.equal(entry.platform, 'slack', item.label);
    assert.equal(entry.workspace, 'T123', item.label);
    assert.equal(entry.createdAt, CREATED, item.label);
    assert.deepEqual(entry.tokens.access, { status: 'pending', deadline: item.access }, item.label);
    assert.deepEqual(
      entry.tokens.refresh,
      item.refresh === undefined ? undefined : { status: 'pending', deadline: item.refresh },
      item.label,
    );
    assert.deepEqual(item.bundle, before, `${item.label}: the old bundle was changed`);
    assert.equal(Object.isFrozen(entry), true, `${item.label}: the entry is mutable`);
    assert.equal(Object.isFrozen(entry.tokens), true, `${item.label}: the token map is mutable`);
    assert.equal(Object.isFrozen(entry.tokens.access), true, `${item.label}: the access state is mutable`);
  }
});

test('access and refresh enumerate independently and never imply a cascade', () => {
  const withBoth = createPendingRevocation({
    ref: 'slack/token/both',
    store: 'keychain',
    workspace: 'T123',
    createdAt: CREATED,
    bundle: bundle(),
  });
  assert.deepEqual(
    pendingRevocationTokens(withBoth).map(({ kind, state }) => ({ kind, ...state })),
    [
      { kind: 'access', status: 'pending', deadline: '2026-10-05T00:00:00.000Z' },
      { kind: 'refresh', status: 'pending', deadline: '2026-11-01T00:00:00.000Z' },
    ],
  );

  const accessOnly = createPendingRevocation({
    ref: 'slack/token/access-only',
    store: 'keychain',
    workspace: 'T123',
    createdAt: CREATED,
    bundle: bundle({ refreshToken: undefined }),
  });
  assert.deepEqual(
    pendingRevocationTokens(accessOnly).map(({ kind }) => kind),
    ['access'],
  );
});

test('one Slack answer classifies only that token by the complete cautious matrix', () => {
  const state: PendingRevocationTokenState = { status: 'pending', deadline: '2026-10-05T00:00:00.000Z' };
  const now = new Date('2026-10-04T13:00:00.000Z');
  const cases: Array<[string, RevocationEvidence, PendingRevocationTokenState['status']]> = [
    ['confirmed', { kind: 'response', response: { ok: true, revoked: true } }, 'revoked'],
    ['false', { kind: 'response', response: { ok: true, revoked: false } }, 'pending'],
    ['absent', { kind: 'response', response: { ok: true } }, 'pending'],
    ['token_revoked', { kind: 'response', response: { ok: false, error: 'token_revoked' } }, 'revoked'],
    ['token_expired', { kind: 'response', response: { ok: false, error: 'token_expired' } }, 'revoked'],
    ['invalid_auth', { kind: 'response', response: { ok: false, error: 'invalid_auth' } }, 'pending'],
    ['account_inactive', { kind: 'response', response: { ok: false, error: 'account_inactive' } }, 'pending'],
    ['ratelimited', { kind: 'response', response: { ok: false, error: 'ratelimited' } }, 'pending'],
    [
      'http 500 with a conclusive-looking body',
      { kind: 'http', status: 500, response: { ok: false, error: 'token_revoked' } },
      'pending',
    ],
    ['dropped connection', { kind: 'network' }, 'pending'],
    ['unreadable answer', { kind: 'unreadable' }, 'pending'],
    ['unnamed refusal', { kind: 'response', response: { ok: false } }, 'pending'],
    ['future error', { kind: 'response', response: { ok: false, error: 'future_error' } }, 'pending'],
  ];

  for (const [label, evidence, expected] of cases) {
    const classified = classifyRevocationAnswer(state, evidence, now);
    assert.deepEqual(classified, { status: expected, deadline: state.deadline }, label);
    assert.notEqual(classified, state, `${label}: the caller's state was returned for mutation`);
    assert.equal(Object.isFrozen(classified), true, `${label}: the answer is mutable`);
  }
  assert.deepEqual(state, { status: 'pending', deadline: '2026-10-05T00:00:00.000Z' });
});

test('a pending token expires at its fixed boundary, while final states never move backwards', () => {
  const pending: PendingRevocationTokenState = { status: 'pending', deadline: '2026-10-05T00:00:00.000Z' };
  const confirmed: RevocationEvidence = { kind: 'response', response: { ok: true, revoked: true } };
  assert.equal(classifyRevocationAnswer(pending, confirmed, new Date('2026-10-04T23:59:59.999Z')).status, 'revoked');
  assert.equal(classifyRevocationAnswer(pending, confirmed, new Date(pending.deadline)).status, 'expired');
  assert.equal(classifyRevocationAnswer(pending, { kind: 'network' }, new Date(pending.deadline)).status, 'expired');

  for (const status of ['revoked', 'expired'] as const) {
    const final = { status, deadline: pending.deadline };
    assert.deepEqual(
      classifyRevocationAnswer(final, { kind: 'response', response: { ok: true, revoked: false } }, new Date(CREATED)),
      final,
    );
  }
});

test('the plain token result names its kind, state and fixed deadline', () => {
  assert.deepEqual(revocationTokenResult('refresh', { status: 'pending', deadline: '2026-11-01T00:00:00.000Z' }), {
    kind: 'refresh',
    status: 'pending',
    deadline: '2026-11-01T00:00:00.000Z',
  });
});
