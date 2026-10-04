import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { test } from 'node:test';
import {
  APPROVAL_KEY_REF,
  type CommsError,
  credentialsLockPath,
  type PendingRevocation,
  type PendingRevocationTokenState,
  type SecretStore,
} from '@agentcomms/core';
import { parseBundle, serialiseBundle, type TokenBundle } from '../src/auth/bundle.ts';
import {
  classifyRevocationAnswer,
  createPendingRevocation,
  pendingRevocationTokens,
  type RevocationEvidence,
  retryPendingRevocations,
  revocationTokenResult,
  revokePendingEntry,
} from '../src/operations/revocations.ts';
import { DROP, type HttpReply, startFakeSlack } from './support/fake-slack.ts';
import { type Harness, newHarness } from './support/harness.ts';

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

interface RevocationMachine {
  readonly harness: Harness;
  readonly ref: string;
  readonly bundle: TokenBundle;
  readonly entry: PendingRevocation;
}

async function revocationMachine(over: Partial<TokenBundle> = {}): Promise<RevocationMachine> {
  const harness = await newHarness();
  const ref = 'slack/token/superseded';
  const old = bundle(over);
  await (await harness.core.secrets('file')).set(ref, serialiseBundle(old));
  const entry = createPendingRevocation({ ref, store: 'file', workspace: 'T123', createdAt: CREATED, bundle: old });
  await harness.core.config.update((config) => ({ ...config, pendingRevocations: [entry] }));
  return { harness, ref, bundle: old, entry };
}

function wrapStore(inner: SecretStore, over: Partial<SecretStore>): SecretStore {
  return {
    kind: inner.kind,
    get: inner.get.bind(inner),
    set: inner.set.bind(inner),
    delete: inner.delete.bind(inner),
    invalidate: inner.invalidate.bind(inner),
    ...(inner.settled ? { settled: inner.settled.bind(inner) } : {}),
    ...over,
  };
}

function failBundleDeletion(machine: RevocationMachine): void {
  const open = machine.harness.core.secrets.bind(machine.harness.core);
  machine.harness.core.secrets = (async (kind) => {
    const inner = await open(kind);
    return wrapStore(inner, {
      async delete(ref) {
        if (ref === machine.ref) throw new Error('the secret store refused deletion');
        return inner.delete(ref);
      },
    });
  }) as typeof machine.harness.core.secrets;
}

async function ledgerEntry(machine: RevocationMachine): Promise<PendingRevocation | undefined> {
  return (await machine.harness.core.config.load()).pendingRevocations?.find((entry) => entry.ref === machine.ref);
}

const ACCESS_ANSWERS: ReadonlyArray<{
  readonly label: string;
  readonly answer: unknown | HttpReply | typeof DROP;
  readonly status: PendingRevocationTokenState['status'];
}> = [
  { label: 'ok and revoked', answer: { ok: true, revoked: true }, status: 'revoked' },
  { label: 'ok and not revoked', answer: { ok: true, revoked: false }, status: 'pending' },
  { label: 'ok without revoked', answer: { ok: true }, status: 'pending' },
  { label: 'token_revoked', answer: { ok: false, error: 'token_revoked' }, status: 'revoked' },
  { label: 'token_expired', answer: { ok: false, error: 'token_expired' }, status: 'revoked' },
  { label: 'invalid_auth', answer: { ok: false, error: 'invalid_auth' }, status: 'pending' },
  { label: 'account_inactive', answer: { ok: false, error: 'account_inactive' }, status: 'pending' },
  { label: 'ratelimited', answer: { ok: false, error: 'ratelimited' }, status: 'pending' },
  {
    label: 'http 500 with JSON',
    answer: { status: 500, body: { ok: false, error: 'token_revoked' } },
    status: 'pending',
  },
  { label: 'dropped connection', answer: DROP, status: 'pending' },
  { label: 'unreadable empty body', answer: undefined, status: 'pending' },
  { label: 'unnamed refusal', answer: { ok: false }, status: 'pending' },
  { label: 'a future error', answer: { ok: false, error: 'future_error' }, status: 'pending' },
];

test('the executor persists the access token’s own cautious answer through a guarded auth.revoke', async () => {
  for (const item of ACCESS_ANSWERS) {
    const machine = await revocationMachine({ refreshToken: undefined, refreshExpiresAt: undefined });
    failBundleDeletion(machine);
    const fake = await startFakeSlack({ 'auth.revoke': () => item.answer });
    try {
      const result = await revokePendingEntry(
        machine.harness.context({ fetch: fake.fetch, now: () => new Date('2026-10-04T13:00:00.000Z') }),
        machine.ref,
      );
      assert.equal(result.tokens[0]?.status, item.status, item.label);
      assert.equal((await ledgerEntry(machine))?.tokens.access.status, item.status, item.label);
      assert.ok(await (await machine.harness.core.secrets('file')).get(machine.ref), `${item.label}: bundle was lost`);
      assert.deepEqual(
        fake.requests.map((request) => request.method),
        ['auth.revoke'],
        item.label,
      );
      assert.equal(fake.requests[0]?.authorization, `Bearer ${machine.bundle.accessToken}`, item.label);
      assert.equal(
        JSON.stringify(result).includes(machine.bundle.accessToken),
        false,
        `${item.label}: token in result`,
      );
    } finally {
      await fake.close();
    }
  }
});

const REFRESH_ANSWERS = ACCESS_ANSWERS.filter((item) => item.label !== 'unreadable empty body');

test('the refresh token is always called second and persists its own answer without borrowing access success', async () => {
  for (const item of REFRESH_ANSWERS) {
    const machine = await revocationMachine();
    failBundleDeletion(machine);
    let call = 0;
    const fake = await startFakeSlack({
      'auth.revoke': () => {
        call += 1;
        return call === 1 ? { ok: true, revoked: true } : item.answer;
      },
    });
    try {
      const result = await revokePendingEntry(
        machine.harness.context({ fetch: fake.fetch, now: () => new Date('2026-10-04T13:00:00.000Z') }),
        machine.ref,
      );
      assert.deepEqual(
        result.tokens.map(({ kind, status }) => ({ kind, status })),
        [
          { kind: 'access', status: 'revoked' },
          { kind: 'refresh', status: item.status },
        ],
        item.label,
      );
      const kept = await ledgerEntry(machine);
      assert.equal(kept?.tokens.access.status, 'revoked', item.label);
      assert.equal(kept?.tokens.refresh?.status, item.status, item.label);
      assert.ok(await (await machine.harness.core.secrets('file')).get(machine.ref), `${item.label}: bundle was lost`);
      assert.deepEqual(
        fake.requests.map((request) => request.authorization),
        [`Bearer ${machine.bundle.accessToken}`, `Bearer ${machine.bundle.refreshToken}`],
        item.label,
      );
    } finally {
      await fake.close();
    }
  }
});

test('two conclusive answers still make two calls, then delete the bundle before the exact ledger entry', async () => {
  const machine = await revocationMachine();
  const events: string[] = [];
  const open = machine.harness.core.secrets.bind(machine.harness.core);
  machine.harness.core.secrets = (async (kind) => {
    const inner = await open(kind);
    return wrapStore(inner, {
      async delete(ref) {
        const present = (await machine.harness.core.config.load()).pendingRevocations?.some(
          (entry) => entry.ref === ref,
        );
        events.push(`delete:${String(present)}`);
        return inner.delete(ref);
      },
    });
  }) as typeof machine.harness.core.secrets;
  const fake = await startFakeSlack({
    'auth.revoke': () => {
      events.push(`network-lock:${String(existsSync(credentialsLockPath(machine.harness.configDir)))}`);
      return { ok: true, revoked: true };
    },
  });
  try {
    const result = await revokePendingEntry(
      machine.harness.context({ fetch: fake.fetch, now: () => new Date('2026-10-04T13:00:00.000Z') }),
      machine.ref,
    );
    assert.deepEqual(
      result.tokens.map(({ kind, status }) => ({ kind, status })),
      [
        { kind: 'access', status: 'revoked' },
        { kind: 'refresh', status: 'revoked' },
      ],
    );
    assert.deepEqual(
      fake.requests.map((request) => request.authorization),
      [`Bearer ${machine.bundle.accessToken}`, `Bearer ${machine.bundle.refreshToken}`],
    );
    assert.equal(await (await machine.harness.core.secrets('file')).get(machine.ref), null);
    assert.equal(await ledgerEntry(machine), undefined);
    assert.deepEqual(events, ['network-lock:false', 'network-lock:false', 'delete:true']);
    assert.equal(result.cleaned, true);
  } finally {
    await fake.close();
  }
});

test('a pending first answer never suppresses an independently conclusive refresh answer', async () => {
  const machine = await revocationMachine();
  let call = 0;
  const fake = await startFakeSlack({
    'auth.revoke': () => (++call === 1 ? { ok: false, error: 'invalid_auth' } : { ok: true, revoked: true }),
  });
  try {
    const result = await revokePendingEntry(
      machine.harness.context({ fetch: fake.fetch, now: () => new Date('2026-10-04T13:00:00.000Z') }),
      machine.ref,
    );
    assert.deepEqual(
      result.tokens.map(({ kind, status }) => ({ kind, status })),
      [
        { kind: 'access', status: 'pending' },
        { kind: 'refresh', status: 'revoked' },
      ],
    );
    assert.equal(fake.requests.length, 2);
    assert.ok(await ledgerEntry(machine));
    assert.ok(await (await machine.harness.core.secrets('file')).get(machine.ref));
  } finally {
    await fake.close();
  }
});

test('wrong refs, caller tokens, final rows and bad stores make no revocation request', async () => {
  const cases = ['missing', 'corrupt', 'failed-read'] as const;
  for (const what of cases) {
    const machine = await revocationMachine({ refreshToken: undefined });
    const secrets = await machine.harness.core.secrets('file');
    if (what === 'missing') await secrets.delete(machine.ref);
    if (what === 'corrupt') await secrets.set(machine.ref, '{not a bundle');
    if (what === 'failed-read') {
      const open = machine.harness.core.secrets.bind(machine.harness.core);
      machine.harness.core.secrets = (async (kind) => {
        const inner = await open(kind);
        return wrapStore(inner, {
          async get(ref) {
            if (ref === machine.ref) throw new Error('the store could not be read');
            return inner.get(ref);
          },
        });
      }) as typeof machine.harness.core.secrets;
    }
    const fake = await startFakeSlack({ 'auth.revoke': () => ({ ok: true, revoked: true }) });
    try {
      const result = await revokePendingEntry(
        machine.harness.context({ fetch: fake.fetch, now: () => new Date('2026-10-04T13:00:00.000Z') }),
        machine.ref,
      );
      assert.equal(result.tokens[0]?.status, 'pending', what);
      assert.ok(result.issue, `${what}: no refusal was reported`);
      assert.equal(fake.requests.length, 0, what);
    } finally {
      await fake.close();
    }
  }

  const machine = await revocationMachine({ refreshToken: undefined });
  const fake = await startFakeSlack({ 'auth.revoke': () => ({ ok: true, revoked: true }) });
  try {
    const context = machine.harness.context({ fetch: fake.fetch });
    await assert.rejects(revokePendingEntry(context, 'slack/token/not-this-entry'), (error: CommsError) => {
      assert.equal(error.code, 'NOT_FOUND');
      return true;
    });
    await assert.rejects(
      revokePendingEntry(context, { ref: machine.ref, token: machine.bundle.accessToken } as never),
      /reference must be passed by name; a token is never accepted/,
    );
    assert.equal(fake.requests.length, 0);
  } finally {
    await fake.close();
  }
});

test('the executor reads the bundle from the ledger entry’s recorded store, not the configured default', async () => {
  const machine = await revocationMachine({ refreshToken: undefined });
  await machine.harness.core.config.update((config) => ({ ...config, secrets: { store: 'keychain' } }));
  const opened: Array<string | undefined> = [];
  const open = machine.harness.core.secrets.bind(machine.harness.core);
  machine.harness.core.secrets = (async (kind) => {
    opened.push(kind);
    if (kind !== 'file') throw new Error('the configured default store must not be opened');
    return open(kind);
  }) as typeof machine.harness.core.secrets;
  const fake = await startFakeSlack({ 'auth.revoke': () => ({ ok: false, error: 'invalid_auth' }) });
  try {
    const result = await revokePendingEntry(machine.harness.context({ fetch: fake.fetch }), machine.ref);
    assert.equal(result.tokens[0]?.status, 'pending');
    assert.deepEqual(opened, ['file']);
    assert.equal(fake.requests.length, 1);
  } finally {
    await fake.close();
  }
});

test('a pending ref shared with any live secret owner or another ledger row is refused before revocation', async () => {
  const cases = ['account', 'other-platform', 'client', 'inbox', 'approval', 'another-ledger-row'] as const;
  for (const owner of cases) {
    const machine = await revocationMachine({ refreshToken: undefined });
    let ref = machine.ref;
    if (owner === 'account' || owner === 'other-platform') {
      const account = await machine.harness.addWorkspace({ alias: 'live' });
      await machine.harness.core.config.update((config) => ({
        ...config,
        accounts: {
          ...config.accounts,
          live: { ...account, platform: owner === 'account' ? 'slack' : 'whatsapp', secretRef: machine.ref },
        },
      }));
    } else if (owner === 'client') {
      await machine.harness.core.config.update((config) => ({
        ...config,
        clients: {
          ...config.clients,
          live: {
            provider: 'gmail',
            clientId: 'fake-client-id.apps.googleusercontent.com',
            secretRef: machine.ref,
            addedAt: CREATED,
          },
        },
      }));
    } else if (owner === 'inbox') {
      await machine.harness.core.config.update((config) => ({
        ...config,
        inboxes: {
          ...config.inboxes,
          live: {
            id: 'ibx_AAAAAAAAAAAAAAAA',
            provider: 'gmail',
            email: 'person@example.invalid',
            identity: 'oidc',
            client: 'live',
            tier: 'read',
            contacts: false,
            grantedScopes: [],
            secretRef: machine.ref,
            internalDomains: [],
            createdAt: CREATED,
          },
        },
      }));
    } else if (owner === 'approval') {
      const secrets = await machine.harness.core.secrets('file');
      const raw = await secrets.get(machine.ref);
      assert.ok(raw);
      await secrets.set(APPROVAL_KEY_REF, raw);
      await secrets.delete(machine.ref);
      ref = APPROVAL_KEY_REF;
      await machine.harness.core.config.update((config) => ({
        ...config,
        pendingRevocations: config.pendingRevocations?.map((entry) => ({ ...entry, ref })),
      }));
    } else {
      await machine.harness.core.config.update((config) => ({
        ...config,
        pendingRevocations: [...(config.pendingRevocations ?? []), { ...machine.entry, platform: 'gmail' }],
      }));
    }
    const fake = await startFakeSlack({ 'auth.revoke': () => ({ ok: true, revoked: true }) });
    try {
      await assert.rejects(
        revokePendingEntry(machine.harness.context({ fetch: fake.fetch }), ref),
        /pending credential reference is not exclusive/,
        owner,
      );
      assert.equal(fake.requests.length, 0, owner);
      assert.ok(await (await machine.harness.core.secrets('file')).get(ref), owner);
    } finally {
      await fake.close();
    }
  }
});

test('an already-final token is not called and a deadline reached is expired without a request', async () => {
  const machine = await revocationMachine({ refreshToken: undefined });
  failBundleDeletion(machine);
  await machine.harness.core.config.update((config) => ({
    ...config,
    pendingRevocations: config.pendingRevocations?.map((entry) => ({
      ...entry,
      tokens: { ...entry.tokens, access: { ...entry.tokens.access, status: 'revoked' } },
    })),
  }));
  const fake = await startFakeSlack({ 'auth.revoke': () => ({ ok: true, revoked: true }) });
  try {
    const final = await revokePendingEntry(machine.harness.context({ fetch: fake.fetch }), machine.ref);
    assert.equal(final.tokens[0]?.status, 'revoked');
    assert.equal(fake.requests.length, 0);
  } finally {
    await fake.close();
  }

  const expired = await revocationMachine({
    refreshToken: undefined,
    accessExpiresAt: '2026-10-04T13:00:00.000Z',
  });
  failBundleDeletion(expired);
  const noCall = await startFakeSlack({ 'auth.revoke': () => ({ ok: true, revoked: true }) });
  try {
    const result = await revokePendingEntry(
      expired.harness.context({ fetch: noCall.fetch, now: () => new Date('2026-10-04T13:00:00.000Z') }),
      expired.ref,
    );
    assert.equal(result.tokens[0]?.status, 'expired');
    assert.equal(noCall.requests.length, 0);
  } finally {
    await noCall.close();
  }
});

test('the status compare-and-set refuses a changed location, deadline or pending state', async () => {
  for (const mutation of ['store', 'deadline', 'status'] as const) {
    const machine = await revocationMachine({ refreshToken: undefined });
    let received = false;
    let changed = false;
    const fake = await startFakeSlack({
      'auth.revoke': () => {
        received = true;
        return { ok: true, revoked: true };
      },
    });
    const update = machine.harness.core.config.update.bind(machine.harness.core.config);
    machine.harness.core.config.update = (async (...args: Parameters<typeof update>) => {
      if (received && !changed) {
        changed = true;
        await update((config) => ({
          ...config,
          pendingRevocations: config.pendingRevocations?.map((entry) => {
            if (mutation === 'store') return { ...entry, store: 'keychain' };
            if (mutation === 'deadline')
              return {
                ...entry,
                tokens: { ...entry.tokens, access: { ...entry.tokens.access, deadline: FALLBACK } },
              };
            if (mutation === 'status')
              return {
                ...entry,
                tokens: { ...entry.tokens, access: { ...entry.tokens.access, status: 'expired' } },
              };
            return entry;
          }),
        }));
      }
      return update(...args);
    }) as typeof machine.harness.core.config.update;
    try {
      await assert.rejects(
        revokePendingEntry(
          machine.harness.context({ fetch: fake.fetch, now: () => new Date('2026-10-04T13:00:00.000Z') }),
          machine.ref,
        ),
        /changed while its token was being revoked/,
        mutation,
      );
      assert.equal(fake.requests.length, 1, mutation);
    } finally {
      await fake.close();
    }
  }
});

test('one entry never updates another pending bundle in the same workspace', async () => {
  const machine = await revocationMachine({ refreshToken: undefined });
  failBundleDeletion(machine);
  const otherRef = 'slack/token/other-pending';
  const otherBundle = bundle({ accessToken: 'fake-other-access', refreshToken: undefined });
  await (await machine.harness.core.secrets('file')).set(otherRef, serialiseBundle(otherBundle));
  const other = createPendingRevocation({
    ref: otherRef,
    store: 'file',
    workspace: machine.entry.workspace,
    createdAt: CREATED,
    bundle: otherBundle,
  });
  await machine.harness.core.config.update((config) => ({
    ...config,
    pendingRevocations: [...(config.pendingRevocations ?? []), other],
  }));
  const fake = await startFakeSlack({ 'auth.revoke': () => ({ ok: true, revoked: true }) });
  try {
    await revokePendingEntry(machine.harness.context({ fetch: fake.fetch }), machine.ref);
    const entries = (await machine.harness.core.config.load()).pendingRevocations ?? [];
    assert.equal(entries.find((entry) => entry.ref === machine.ref)?.tokens.access.status, 'revoked');
    assert.equal(entries.find((entry) => entry.ref === otherRef)?.tokens.access.status, 'pending');
    assert.equal(fake.requests[0]?.authorization, `Bearer ${machine.bundle.accessToken}`);
  } finally {
    await fake.close();
  }
});

test('a lost answer leaves pending state, and a fresh context retries instead of inventing success', async () => {
  const machine = await revocationMachine({ refreshToken: undefined });
  let received = false;
  const fake = await startFakeSlack({
    'auth.revoke': () => {
      received = true;
      return { ok: true, revoked: true };
    },
  });
  const update = machine.harness.core.config.update.bind(machine.harness.core.config);
  machine.harness.core.config.update = (async (...args: Parameters<typeof update>) => {
    if (received) {
      received = false;
      throw new Error('process stopped before the status write');
    }
    return update(...args);
  }) as typeof machine.harness.core.config.update;
  try {
    await assert.rejects(
      revokePendingEntry(machine.harness.context({ fetch: fake.fetch }), machine.ref),
      /process stopped/,
    );
    assert.equal((await ledgerEntry(machine))?.tokens.access.status, 'pending');
    machine.harness.core.config.update = update;
    const retried = await revokePendingEntry(machine.harness.context({ fetch: fake.fetch }), machine.ref);
    assert.equal(retried.tokens[0]?.status, 'revoked');
    assert.equal(fake.requests.length, 2);
  } finally {
    await fake.close();
  }
});

test('cleanup restores a deleted bundle when ledger removal definitely fails', async () => {
  const machine = await revocationMachine({ refreshToken: undefined });
  const update = machine.harness.core.config.update.bind(machine.harness.core.config);
  let writes = 0;
  machine.harness.core.config.update = (async (...args: Parameters<typeof update>) => {
    writes += 1;
    if (writes === 2) throw new Error('ledger removal did not commit');
    return update(...args);
  }) as typeof machine.harness.core.config.update;
  const fake = await startFakeSlack({ 'auth.revoke': () => ({ ok: true, revoked: true }) });
  try {
    const result = await revokePendingEntry(machine.harness.context({ fetch: fake.fetch }), machine.ref);
    assert.equal(result.cleaned, false);
    assert.equal(result.issue?.code, 'CONFIG_WRITE_FAILED');
    assert.equal((await ledgerEntry(machine))?.tokens.access.status, 'revoked');
    assert.equal(await (await machine.harness.core.secrets('file')).get(machine.ref), serialiseBundle(machine.bundle));
  } finally {
    await fake.close();
  }
});

test('cleanup reconciles a committed ledger removal whose update reported failure', async () => {
  const machine = await revocationMachine({ refreshToken: undefined });
  const update = machine.harness.core.config.update.bind(machine.harness.core.config);
  let writes = 0;
  machine.harness.core.config.update = (async (...args: Parameters<typeof update>) => {
    writes += 1;
    const result = await update(...args);
    if (writes === 2) throw new Error('ledger removal committed before lock release failed');
    return result;
  }) as typeof machine.harness.core.config.update;
  const fake = await startFakeSlack({ 'auth.revoke': () => ({ ok: true, revoked: true }) });
  try {
    const result = await revokePendingEntry(machine.harness.context({ fetch: fake.fetch }), machine.ref);
    assert.equal(result.cleaned, true);
    assert.equal(result.issue, undefined);
    assert.equal(await ledgerEntry(machine), undefined);
    assert.equal(await (await machine.harness.core.secrets('file')).get(machine.ref), null);
  } finally {
    await fake.close();
  }
});

test('a final row whose bundle was already deleted completes cleanup after a restart', async () => {
  const machine = await revocationMachine({ refreshToken: undefined });
  await machine.harness.core.config.update((config) => ({
    ...config,
    pendingRevocations: config.pendingRevocations?.map((entry) => ({
      ...entry,
      tokens: { ...entry.tokens, access: { ...entry.tokens.access, status: 'revoked' } },
    })),
  }));
  await (await machine.harness.core.secrets('file')).delete(machine.ref);
  const fake = await startFakeSlack({ 'auth.revoke': () => ({ ok: true, revoked: true }) });
  try {
    const result = await revokePendingEntry(machine.harness.context({ fetch: fake.fetch }), machine.ref);
    assert.equal(result.cleaned, true);
    assert.equal(await ledgerEntry(machine), undefined);
    assert.equal(fake.requests.length, 0);
  } finally {
    await fake.close();
  }
});

test('retrying all entries continues past one bad bundle and returns plain states for each', async () => {
  const machine = await revocationMachine({ refreshToken: undefined });
  const badRef = 'slack/token/bad-pending';
  const bad = createPendingRevocation({
    ref: badRef,
    store: 'file',
    workspace: 'T999',
    createdAt: CREATED,
    bundle: bundle({ accessToken: 'fake-bad-access', refreshToken: undefined }),
  });
  await (await machine.harness.core.secrets('file')).set(badRef, '{broken');
  await machine.harness.core.config.update((config) => ({
    ...config,
    pendingRevocations: [...(config.pendingRevocations ?? []), bad],
  }));
  const fake = await startFakeSlack({ 'auth.revoke': () => ({ ok: false, error: 'invalid_auth' }) });
  try {
    const results = await retryPendingRevocations(machine.harness.context({ fetch: fake.fetch }));
    assert.deepEqual(
      results.map((result) => ({ ref: result.ref, status: result.tokens[0]?.status, issue: Boolean(result.issue) })),
      [
        { ref: machine.ref, status: 'pending', issue: false },
        { ref: badRef, status: 'pending', issue: true },
      ],
    );
    assert.equal(fake.requests.length, 1);
    assert.equal(JSON.stringify(results).includes('fake-'), false, 'a plain result carried a token');
    assert.equal(parseBundle(await (await machine.harness.core.secrets('file')).get(machine.ref))?.state, 'ready');
  } finally {
    await fake.close();
  }
});

test('retrying all entries isolates a thrown first entry and continues with the next', async () => {
  const machine = await revocationMachine({ refreshToken: undefined });
  const nextRef = 'slack/token/next-pending';
  const nextBundle = bundle({ accessToken: 'fake-next-access', refreshToken: undefined });
  const next = createPendingRevocation({
    ref: nextRef,
    store: 'file',
    workspace: 'T999',
    createdAt: CREATED,
    bundle: nextBundle,
  });
  await (await machine.harness.core.secrets('file')).set(nextRef, serialiseBundle(nextBundle));
  await machine.harness.core.config.update((config) => ({
    ...config,
    pendingRevocations: [...(config.pendingRevocations ?? []), next],
  }));
  const update = machine.harness.core.config.update.bind(machine.harness.core.config);
  let failed = false;
  machine.harness.core.config.update = (async (...args: Parameters<typeof update>) => {
    if (!failed) {
      failed = true;
      throw new Error('first status write stopped');
    }
    return update(...args);
  }) as typeof machine.harness.core.config.update;
  const fake = await startFakeSlack({ 'auth.revoke': () => ({ ok: false, error: 'invalid_auth' }) });
  try {
    const results = await retryPendingRevocations(machine.harness.context({ fetch: fake.fetch }));
    assert.deepEqual(
      results.map((result) => ({ ref: result.ref, issue: result.issue?.code })),
      [
        { ref: machine.ref, issue: 'UNEXPECTED' },
        { ref: nextRef, issue: undefined },
      ],
    );
    assert.deepEqual(
      fake.requests.map((request) => request.authorization),
      [`Bearer ${machine.bundle.accessToken}`, `Bearer ${nextBundle.accessToken}`],
    );
  } finally {
    await fake.close();
  }
});
