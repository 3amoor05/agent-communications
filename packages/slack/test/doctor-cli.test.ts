import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { PassThrough } from 'node:stream';
import { test } from 'node:test';
import type { SecretStore } from '@agentcomms/core';
import { migrateSecrets } from '../../core/src/operations/secrets-migrate.ts';
import { secretsStoreSwitchAsReleased0121, writeAsReleased0121 } from '../../core/test/fixtures/config-v2-0.12.1.ts';
import { serialiseBundle, type TokenBundle } from '../src/auth/bundle.ts';
import { run } from '../src/cli/program.ts';
import { renderDoctor, renderRemoved } from '../src/cli/render.ts';
import { removeWorkspaceChange } from '../src/operations/changes.ts';
import { runDoctor } from '../src/operations/doctor.ts';
import { createPendingRevocation } from '../src/operations/revocations.ts';
import { startFakeSlack } from './support/fake-slack.ts';
import { assertNoBareCommand, slackCommand } from './support/handoffs.ts';
import { type Harness, newHarness, slackOk } from './support/harness.ts';

/**
 * `doctor` against a credential that is due, one that must not be refreshed, and a store that will not answer.
 *
 * Its own file rather than more of `cli.test.ts`, which is already close to the per-file timeout on a busy machine.
 */

interface Envelope<T> {
  ok: boolean;
  data?: T;
}

async function cli(
  harness: Harness,
  argv: string[],
  fetch?: (input: string | URL | Request, init?: RequestInit) => Promise<Response>,
): Promise<{ code: number; text: string; json: <T>() => T }> {
  let stdout = '';
  const out = new PassThrough();
  out.on('data', (chunk) => {
    stdout += String(chunk);
  });
  const code = await run(argv, {
    core: harness.core,
    env: harness.env,
    exchange: (params) => harness.exchange(params),
    streams: { stdout: out, stderr: new PassThrough(), stdin: new PassThrough() },
    openBrowser: () => undefined,
    probe: (input, init) => harness.probe(input, init),
    ...(fetch ? { fetch } : {}),
  });
  return { code, text: stdout, json: <T>() => JSON.parse(stdout) as T };
}

async function plantPending(
  harness: Harness,
  workspace = 'T0001',
  suffix = '',
): Promise<{ ref: string; old: TokenBundle }> {
  const ref = `slack/token/pending-${workspace}${suffix}`;
  const now = Date.now();
  const old: TokenBundle = {
    v: 1,
    state: 'ready',
    accessToken: `fake-old-access-${workspace}${suffix}`,
    refreshToken: `fake-old-refresh-${workspace}${suffix}`,
    accessExpiresAt: new Date(now + 60_000).toISOString(),
    refreshExpiresAt: new Date(now + 120_000).toISOString(),
    issuedAt: new Date(now).toISOString(),
  };
  await (await harness.core.secrets('file')).set(ref, serialiseBundle(old));
  await harness.core.config.update((config) => ({
    ...config,
    pendingRevocations: [
      ...(config.pendingRevocations ?? []),
      createPendingRevocation({ ref, store: 'file', workspace, createdAt: new Date(now).toISOString(), bundle: old }),
    ],
  }));
  return { ref, old };
}

test('doctor retries both retained tokens after a new context, then reports their states and deadlines', async () => {
  const harness = await newHarness();
  await harness.addWorkspace({ alias: 'acme' });
  const { ref, old } = await plantPending(harness);
  const fake = await startFakeSlack({
    'auth.revoke': (request) =>
      request.authorization?.includes('access')
        ? { ok: false, error: 'token_revoked' }
        : { ok: false, error: 'invalid_auth' },
  });
  try {
    let callsBeforeIdentity = -1;
    const result = await runDoctor(harness.context({ fetch: fake.fetch }), {
      offline: false,
      probe: (input, init) => {
        callsBeforeIdentity = fake.requests.length;
        return harness.probe(input, init);
      },
    });
    assert.equal(callsBeforeIdentity, 2, 'ordinary identity checks started before pending cleanup');
    assert.deepEqual(
      fake.requests.map((request) => request.authorization),
      [`Bearer ${old.accessToken}`, `Bearer ${old.refreshToken}`],
    );
    assert.deepEqual(
      result.cleanup?.[0]?.tokens.map(({ kind, status }) => ({ kind, status })),
      [
        { kind: 'access', status: 'revoked' },
        { kind: 'refresh', status: 'pending' },
      ],
    );
    assert.match(
      result.checks.find((check) => check.id === 'pending-revocation')?.detail ?? '',
      /access revoked.*refresh pending.*deadline/s,
    );
    assert.ok((await harness.core.config.load()).pendingRevocations?.some((entry) => entry.ref === ref));
    assert.ok(await (await harness.core.secrets('file')).get(ref));
  } finally {
    await fake.close();
  }
});

test('offline doctor reports pending access and refresh deadlines without calling Slack', async () => {
  const harness = await newHarness();
  await harness.addWorkspace({ alias: 'acme' });
  const { old } = await plantPending(harness);
  const fake = await startFakeSlack({ 'auth.revoke': () => ({ ok: true, revoked: true }) });
  try {
    const result = await cli(harness, ['doctor', '--offline'], fake.fetch);
    assert.equal(result.code, 0);
    assert.equal(fake.requests.length, 0);
    assert.match(result.text, /access pending/);
    assert.match(result.text, /refresh pending/);
    assert.match(result.text, new RegExp(old.accessExpiresAt));
    assert.match(result.text, new RegExp(old.refreshExpiresAt ?? 'never'));
    assert.doesNotMatch(result.text, /uninstall(ed)? the app/i);
  } finally {
    await fake.close();
  }
});

test('workspace remove retries matching old tokens before deleting the current credential and retains failures', async () => {
  const harness = await newHarness();
  const account = await harness.addWorkspace({ alias: 'acme' });
  const { ref, old } = await plantPending(harness);
  const other = await plantPending(harness, 'T9999');
  const fake = await startFakeSlack({ 'auth.revoke': () => ({ ok: false, error: 'invalid_auth' }) });
  const currentPresentAtRevoke: boolean[] = [];
  const fetch = async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    currentPresentAtRevoke.push((await (await harness.core.secrets('file')).get(account.secretRef)) !== null);
    return fake.fetch(input, init);
  };
  try {
    const context = harness.context({ fetch });
    const removed = await removeWorkspaceChange(context, 'acme').apply(
      undefined as never,
      {
        before: await harness.core.config.load(),
      } as never,
    );
    assert.equal(removed.removed, true);
    assert.deepEqual(
      currentPresentAtRevoke,
      [true, true],
      'both access and refresh revokes must precede current deletion',
    );
    assert.deepEqual(
      fake.requests.map((request) => request.authorization),
      [`Bearer ${old.accessToken}`, `Bearer ${old.refreshToken}`],
    );
    assert.equal(removed.cleanup?.[0]?.tokens[0]?.status, 'pending');
    assert.equal(removed.cleanup?.[0]?.tokens[1]?.status, 'pending');
    const text = renderRemoved(removed, context.handoffs);
    assert.match(text, /access pending/);
    assert.match(text, /refresh pending/);
    assert.match(text, new RegExp(old.accessExpiresAt));
    assert.match(text, new RegExp(old.refreshExpiresAt ?? 'never'));
    assert.match(text, /doctor to retry/);
    assert.match(text, /app is still installed/);
    assert.doesNotMatch(text, /uninstalled the app/i);
    assert.equal(await (await harness.core.secrets('file')).get(account.secretRef), null);
    assert.ok(await (await harness.core.secrets('file')).get(ref));
    assert.ok((await harness.core.config.load()).pendingRevocations?.some((entry) => entry.ref === ref));
    assert.ok((await harness.core.config.load()).pendingRevocations?.some((entry) => entry.ref === other.ref));
    const diagnosis = await runDoctor(context, { offline: true });
    assert.equal(diagnosis.cleanup?.length, 2);
  } finally {
    await fake.close();
  }
});

test('a second old entry survives removal while a successful old entry is cleaned', async () => {
  const harness = await newHarness();
  await harness.addWorkspace({ alias: 'acme' });
  const first = await plantPending(harness);
  const second = await plantPending(harness, 'T0001', '-second');
  const fake = await startFakeSlack({
    'auth.revoke': (request) =>
      request.authorization?.includes('-second') ? { ok: false, error: 'invalid_auth' } : { ok: true, revoked: true },
  });
  try {
    const context = harness.context({ fetch: fake.fetch });
    const removed = await removeWorkspaceChange(context, 'acme').apply(
      undefined as never,
      {
        before: await harness.core.config.load(),
      } as never,
    );
    assert.deepEqual(
      removed.cleanup.map(({ ref, cleaned }) => ({ ref, cleaned })),
      [
        { ref: first.ref, cleaned: true },
        { ref: second.ref, cleaned: false },
      ],
    );
    assert.equal(await (await harness.core.secrets('file')).get(first.ref), null);
    assert.ok(await (await harness.core.secrets('file')).get(second.ref));
    assert.deepEqual(
      (await harness.core.config.load()).pendingRevocations?.map((entry) => entry.ref),
      [second.ref],
    );
    assert.equal((await runDoctor(context, { offline: true })).cleanup?.[0]?.ref, second.ref);
  } finally {
    await fake.close();
  }
});

test('doctor retries retained failures after a restart and accepts already-invalid answers', async () => {
  const harness = await newHarness();
  await harness.addWorkspace({ alias: 'acme' });
  const { ref } = await plantPending(harness);
  const first = await startFakeSlack({ 'auth.revoke': () => ({ ok: false, error: 'invalid_auth' }) });
  try {
    const result = await runDoctor(harness.context({ fetch: first.fetch }), {
      probe: (input, init) => harness.probe(input, init),
    });
    assert.deepEqual(
      result.cleanup?.[0]?.tokens.map((token) => token.status),
      ['pending', 'pending'],
    );
  } finally {
    await first.close();
  }
  const afterRestart = await startFakeSlack({
    'auth.revoke': (request) => ({
      ok: false,
      error: request.authorization?.includes('access') ? 'token_revoked' : 'token_expired',
    }),
  });
  try {
    const result = await runDoctor(harness.context({ fetch: afterRestart.fetch }), {
      probe: (input, init) => harness.probe(input, init),
    });
    assert.deepEqual(
      result.cleanup?.[0]?.tokens.map((token) => token.status),
      ['revoked', 'revoked'],
    );
    assert.equal(result.cleanup?.[0]?.cleaned, true);
    assert.equal(afterRestart.requests.length, 2);
    assert.equal(await (await harness.core.secrets('file')).get(ref), null);
    assert.equal((await harness.core.config.load()).pendingRevocations, undefined);
  } finally {
    await afterRestart.close();
  }
});

test('doctor filters pending entries by workspace, and expiry finishes both tokens without Slack', async () => {
  const harness = await newHarness();
  await harness.addWorkspace({ alias: 'acme' });
  await harness.addWorkspace({ alias: 'other', workspaceId: 'T9999' });
  const chosen = await plantPending(harness);
  const untouched = await plantPending(harness, 'T9999');
  const fake = await startFakeSlack({ 'auth.revoke': () => ({ ok: false, error: 'ratelimited' }) });
  try {
    const now = new Date(Date.parse(chosen.old.refreshExpiresAt ?? '') + 1);
    const chosenResult = await runDoctor(harness.context({ fetch: fake.fetch, now: () => now }), {
      workspace: 'acme',
      probe: (input, init) => harness.probe(input, init),
    });
    assert.deepEqual(
      chosenResult.cleanup?.map((entry) => entry.ref),
      [chosen.ref],
    );
    assert.deepEqual(
      chosenResult.cleanup?.[0]?.tokens.map((token) => token.status),
      ['expired', 'expired'],
    );
    assert.equal(fake.requests.length, 0);
    assert.equal(await (await harness.core.secrets('file')).get(chosen.ref), null);
    assert.ok(await (await harness.core.secrets('file')).get(untouched.ref));
    const all = await runDoctor(harness.context({ fetch: fake.fetch }), {
      probe: (input, init) => harness.probe(input, init),
    });
    assert.deepEqual(
      all.cleanup?.map((entry) => entry.ref),
      [untouched.ref],
    );
  } finally {
    await fake.close();
  }
});

test('doctor reports missing and corrupt retained bundles without dropping ledger ownership', async () => {
  for (const damaged of ['missing', 'corrupt'] as const) {
    const harness = await newHarness();
    await harness.addWorkspace({ alias: 'acme' });
    const { ref } = await plantPending(harness);
    const secrets = await harness.core.secrets('file');
    if (damaged === 'missing') await secrets.delete(ref);
    else await secrets.set(ref, '{broken');
    const fake = await startFakeSlack({ 'auth.revoke': () => ({ ok: true, revoked: true }) });
    try {
      const result = await runDoctor(harness.context({ fetch: fake.fetch }), {
        probe: (input, init) => harness.probe(input, init),
      });
      assert.equal(result.cleanup?.[0]?.cleaned, false, damaged);
      assert.equal(result.cleanup?.[0]?.tokens[0]?.status, 'pending', damaged);
      assert.ok(result.cleanup?.[0]?.issue, damaged);
      const text = renderDoctor(result, false);
      assert.match(text, /pending revocation ledger entry retained/);
      assert.doesNotMatch(text, /old bundle retained/);
      assert.ok(text.includes(result.cleanup?.[0]?.issue?.message ?? 'missing issue'), damaged);
      assert.match(text, damaged === 'missing' ? /missing from its recorded store/ : /could not be read/);
      assert.equal(fake.requests.length, 0, damaged);
      assert.ok(
        (await harness.core.config.load()).pendingRevocations?.some((entry) => entry.ref === ref),
        damaged,
      );
    } finally {
      await fake.close();
    }
  }
});

test('removal reports a retained ledger entry honestly when its old bundle is missing or corrupt', async () => {
  for (const damaged of ['missing', 'corrupt'] as const) {
    const harness = await newHarness();
    await harness.addWorkspace({ alias: 'acme' });
    const { ref } = await plantPending(harness);
    const secrets = await harness.core.secrets('file');
    if (damaged === 'missing') await secrets.delete(ref);
    else await secrets.set(ref, '{broken');
    const fake = await startFakeSlack({ 'auth.revoke': () => ({ ok: true, revoked: true }) });
    try {
      const context = harness.context({ fetch: fake.fetch });
      const removed = await removeWorkspaceChange(context, 'acme').apply(
        undefined as never,
        {
          before: await harness.core.config.load(),
        } as never,
      );
      const issue = removed.cleanup[0]?.issue;
      assert.ok(issue, damaged);
      const text = renderRemoved(removed, context.handoffs);
      assert.ok(
        text.includes(`ledger entry remains for ${slackCommand(harness.core.paths, ['doctor'])} to retry`),
        text,
      );
      assertNoBareCommand(text);
      assert.ok(text.includes(issue.message), `${damaged}: the cleanup issue was omitted`);
      assert.doesNotMatch(text, /old credential bundle remains/);
      assert.match(text, damaged === 'missing' ? /missing from its recorded store/ : /could not be read/);
      assert.ok((await harness.core.config.load()).pendingRevocations?.some((entry) => entry.ref === ref));
      assert.equal(fake.requests.length, 0);
    } finally {
      await fake.close();
    }
  }
});

function memoryKeychain(): SecretStore {
  const values = new Map<string, string>();
  return {
    kind: 'keychain',
    get: async (ref) => values.get(ref) ?? null,
    set: async (ref, value) => {
      values.set(ref, value);
    },
    delete: async (ref) => values.delete(ref),
    invalidate: () => undefined,
  };
}

test('doctor and remove follow a pending bundle through current and prior-release store switches', async () => {
  for (const modern of [true, false]) {
    const harness = await newHarness({ version: 2 });
    const alias = 'acme/slack';
    const account = await harness.addWorkspace({ alias });
    const { ref, old } = await plantPending(harness);
    const file = await harness.core.secrets('file');
    const target = memoryKeychain();
    if (modern) {
      // The package entry and source migration expose the same runtime core through distinct private TS declarations.
      await migrateSecrets(harness.core as unknown as Parameters<typeof migrateSecrets>[0], 'keychain', {
        source: file,
        target,
      });
      assert.equal((await harness.core.config.load()).pendingRevocations?.[0]?.store, 'keychain');
      assert.equal(await file.get(ref), null);
      assert.ok(await target.get(ref));
    } else {
      const current = await file.get(account.secretRef);
      assert.ok(current);
      await target.set(account.secretRef, current);
      await file.delete(account.secretRef);
      const configPath = harness.core.config.path;
      const before = readFileSync(configPath, 'utf8');
      const beforeLedger = JSON.parse(before).pendingRevocations;
      const released = writeAsReleased0121(before, (raw) => secretsStoreSwitchAsReleased0121(raw, 'keychain'));
      writeFileSync(configPath, released);
      const persisted = JSON.parse(readFileSync(configPath, 'utf8'));
      assert.equal(
        JSON.stringify(persisted.pendingRevocations),
        JSON.stringify(beforeLedger),
        'the frozen old writer changed the unknown ledger',
      );
      assert.deepEqual(persisted.secrets, { store: 'keychain' });
      assert.equal((await harness.core.config.load()).pendingRevocations?.[0]?.store, 'file');
      assert.ok(await file.get(ref));
      assert.equal(await target.get(ref), null);
    }
    const open = harness.core.secrets.bind(harness.core);
    harness.core.secrets = (async (kind) => (kind === 'keychain' ? target : open(kind))) as typeof harness.core.secrets;
    const fake = await startFakeSlack({ 'auth.revoke': () => ({ ok: false, error: 'invalid_auth' }) });
    try {
      const context = harness.context({ fetch: fake.fetch });
      const checked = await runDoctor(context, { probe: (input, init) => harness.probe(input, init) });
      assert.equal(checked.cleanup?.[0]?.issue, undefined, String(modern));
      assert.equal(checked.cleanup?.[0]?.tokens[0]?.status, 'pending');
      const removed = await removeWorkspaceChange(context, alias).apply(
        undefined as never,
        {
          before: await harness.core.config.load(),
        } as never,
      );
      assert.equal(removed.removed, true);
      assert.deepEqual(
        fake.requests.map((request) => request.authorization),
        [
          `Bearer ${old.accessToken}`,
          `Bearer ${old.refreshToken}`,
          `Bearer ${old.accessToken}`,
          `Bearer ${old.refreshToken}`,
        ],
        String(modern),
      );
      assert.equal(await target.get(account.secretRef), null);
      assert.ok(await (modern ? target : file).get(ref));
    } finally {
      await fake.close();
    }
  }
});

test('an expired but refreshable token is renewed first, then asked about — not skipped', async () => {
  /*
   * An expired access token is the ordinary state of a workspace nobody has used today. `doctor` used to skip it,
   * because Slack would refuse it — so the one command run to find out whether a workspace works never checked the
   * workspace most likely to be in question. It now does what the next read would: renews it under the same locks,
   * then asks Slack about the token that came back.
   */
  const harness = await newHarness();
  await harness.addWorkspace({ alias: 'acme', bundle: { accessExpiresAt: '2020-01-01T00:00:00.000Z' } });
  harness.reply = () =>
    slackOk({ authed_user: { access_token: 'fake-renewed-token', refresh_token: 'fake-renewed-refresh' } });
  const sentWith: string[] = [];
  harness.probe = (_input, init) => {
    sentWith.push(new Headers(init?.headers).get('authorization') ?? '');
    return Promise.resolve(harness.authTest());
  };

  const result = await cli(harness, ['--json', 'doctor']);
  assert.equal(harness.calls.length, 1, 'doctor did not renew a token that was due');
  assert.equal(harness.calls[0]?.params.grant_type, 'refresh_token');
  assert.deepEqual(
    sentWith,
    ['Bearer fake-renewed-token'],
    'doctor asked about the expired token, not the renewed one',
  );
  const checks = result.json<Envelope<{ checks: { id: string; status: string; detail: string }[] }>>().data?.checks;
  assert.equal(checks?.find((check) => check.id === 'identity')?.status, 'ok');
  assert.match(
    checks?.find((check) => check.id === 'credential-state')?.detail ?? '',
    /valid until/,
    'the state check described the credential from before the renewal',
  );
});

test('an expired token that must not be refreshed is neither renewed nor asked about', async () => {
  /*
   * `refresh-uncertain` may hold a spent refresh token, and nothing may present it again — doctor included.
   * Counted, not `assert.fail`ed inside the probe: `probeIdentity` turns every thrown thing into
   * `{ kind: 'unreachable' }` on purpose, so an assertion raised in there is swallowed.
   */
  const harness = await newHarness();
  await harness.addWorkspace({
    alias: 'acme',
    bundle: { state: 'refresh-uncertain', accessExpiresAt: '2020-01-01T00:00:00.000Z' },
  });
  let asked = 0;
  harness.probe = () => {
    asked += 1;
    return Promise.resolve(harness.authTest());
  };

  const result = await cli(harness, ['--json', 'doctor']);
  assert.equal(harness.calls.length, 0, 'doctor presented a refresh token that may already be spent');
  assert.equal(asked, 0, 'doctor asked Slack about a token it already knew was stale');
  const checks = result.json<Envelope<{ checks: { id: string; status: string; detail: string }[] }>>().data?.checks;
  const identity = checks?.find((check) => check.id === 'identity');
  assert.equal(identity?.status, 'unknown');
  assert.equal(identity?.detail, 'not asked', 'doctor tried to renew a credential it knew could not be renewed');
  assert.equal(checks?.find((check) => check.id === 'credential-state')?.status, 'fail');
});

test('a secret store that will not answer is not reported as a corrupt credential', async () => {
  /*
   * Both used to read "unreadable", whose fix is `reauth` — advice that, for a keychain that only wanted
   * unlocking, throws away a refresh token that was fine. The file store stands in for the keychain here: its
   * entry is replaced by a directory, so reading it fails in the store rather than in the parse.
   */
  const harness = await newHarness();
  const account = await harness.addWorkspace({ alias: 'acme' });
  const entry = join(
    harness.core.paths.secretsDir,
    `${createHash('sha256').update(account.secretRef).digest('hex').slice(0, 32)}.json`,
  );
  rmSync(entry);
  mkdirSync(entry);

  const result = await cli(harness, ['--json', 'doctor', '--offline']);
  const checks =
    result.json<Envelope<{ checks: { id: string; status: string; detail: string; fix: string }[] }>>().data?.checks;
  const credential = checks?.find((check) => check.id === 'credential');
  assert.equal(credential?.status, 'fail');
  assert.match(credential?.detail ?? '', /secret store could not be read/);
  assert.doesNotMatch(credential?.fix ?? '', /reauth/, 'a store problem was answered with re-authorisation');
});
