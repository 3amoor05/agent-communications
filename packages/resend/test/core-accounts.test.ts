import assert from 'node:assert/strict';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, test } from 'node:test';
import {
  beginChangeApproval,
  finishChangeApproval,
  migrateNames,
  planNamesMigration,
  type SecretStore,
} from '@agentcomms/core';
// Core's own migration, by path: it is not on the package's surface, and a test must never reach the real keychain,
// which only this function's `stores` argument keeps it from.
import { migrateSecrets } from '../../core/src/operations/secrets-migrate.ts';
import { secretRefFor } from '../src/accounts.ts';
import { FULL, type Harness, newHarness, ok, refused } from './support/harness.ts';

/**
 * Resend accounts live in core's configuration now, as the generic record (design 2026-09-26 §5) — so everything core
 * does with an account does it with these too: names are looked up through core, a former name is refused with the
 * one it has now, `names migrate` renames them, `secrets migrate` moves their keys, and a loosening is approved under
 * the account's own change policy when it sets one.
 */

let harness: Harness;
afterEach(async () => {
  await harness?.close();
});

const configFile = () => join(harness.dir, 'config', 'config.json');
const readConfig = () => JSON.parse(readFileSync(configFile(), 'utf8')) as Record<string, unknown>;

/** A config file written before anything has read one, so no cached copy of another can be in the way. */
function startWith(body: Record<string, unknown>): void {
  writeFileSync(configFile(), `${JSON.stringify(body, null, 2)}\n`);
}

const SLACK = {
  id: 'acc_SSSSSSSSSSSSSSSS',
  platform: 'slack',
  workspace: 'T_ACME',
  userId: 'U_ACME',
  tier: 'read',
  mode: 'read',
  grantedScopes: [],
  secretRef: 'slack/token/acc_SSSSSSSSSSSSSSSS',
  createdAt: '2026-09-20T00:00:00.000Z',
};

test('an account is added to core’s accounts map as the generic record, and no file of its own is written', async () => {
  harness = await newHarness();
  const added = await harness.cli(['--json', 'account', 'add', 'acme/resend'], { env: { RESEND_API_KEY: FULL } });
  assert.equal(added.code, 0, added.stdout);
  const accounts = readConfig().accounts as Record<string, Record<string, unknown>>;
  const record = accounts['acme/resend'];
  assert.ok(record, 'the account is in config.json');
  const id = String(record.id);
  assert.match(id, /^acc_[A-Z0-9]{16}$/);
  assert.deepEqual(
    { ...record, id: 'ID', createdAt: 'T' },
    {
      id: 'ID',
      platform: 'resend',
      workspace: record.workspace,
      userId: record.workspace,
      tier: 'read',
      mode: 'read',
      grantedScopes: ['full_access'],
      secretRef: secretRefFor(id),
      createdAt: 'T',
    },
  );
  assert.match(String(record.workspace), /^key_[0-9a-f]{8}$/, 'a fingerprint of the key, and nothing of the key');
  assert.ok(!existsSync(join(harness.dir, 'config', 'resend-accounts.json')), 'no file of its own');
});

test('names are looked up through core: another platform’s account is not a Resend account, and a v1 name is shared', async () => {
  harness = await newHarness();
  startWith({ version: 2, secrets: { store: 'file' }, accounts: { 'acme/slack': SLACK } });
  await harness.addAccount({ name: 'acme/resend' });
  const list = await harness.cli(['--json', 'account', 'list']);
  assert.deepEqual(
    list.json<{ accounts: { name: string }[] }>().data?.accounts.map((account) => account.name),
    ['acme/resend'],
    'a Slack workspace is not listed',
  );
  const slack = await harness.cli(['--json', 'account', 'show', 'acme/slack']);
  assert.equal(slack.code, 66, slack.stdout);
  assert.match(String(slack.json().error?.message), /no Resend account called "acme\/slack"/);
  const { call, close } = await harness.mcp();
  try {
    assert.equal(refused(await call('resend_domains', { account: 'acme/slack' })).code, 'NOT_FOUND');
  } finally {
    await close();
  }

  // Version 1 names every account with a plain word, shared by mailboxes and accounts alike.
  await harness.close();
  harness = await newHarness();
  startWith({
    version: 1,
    secrets: { store: 'file' },
    inboxes: {},
    accounts: { work: { ...SLACK, secretRef: 'slack/token/acc_SSSSSSSSSSSSSSSS' } },
  });
  const taken = await harness.cli(['--json', 'account', 'add', 'work'], { env: { RESEND_API_KEY: FULL } });
  assert.equal(taken.code, 64, taken.stdout);
  assert.match(String(taken.json().error?.message), /already an account called "work"/);
  assert.equal(harness.fake.requests.length, 0, 'refused before the key was read or Resend asked');
});

test('names migrate renames a Resend account, its old name is refused with the new one, and a pinned server follows it', async () => {
  harness = await newHarness();
  startWith({ version: 1, secrets: { store: 'file' }, inboxes: {}, accounts: {} });
  const added = await harness.cli(['--json', 'account', 'add', 'acme'], { env: { RESEND_API_KEY: FULL } });
  assert.equal(added.code, 0, added.stdout);
  const pinned = await harness.mcp({ account: 'acme' });
  try {
    const plan = planNamesMigration(await harness.core.config.load());
    assert.equal(plan.status, 'ready');
    assert.ok(plan.status === 'ready');
    assert.deepEqual(
      plan.rows.map((row) => [row.from, row.to, row.platform]),
      [['acme', 'acme/resend', 'resend']],
    );
    const migrated = await migrateNames(harness.core.config, plan);
    assert.equal(migrated.status, 'migrated');

    // The old name is refused with the new one, from both surfaces.
    const old = await harness.cli(['--json', 'account', 'show', 'acme']);
    assert.equal(old.code, 66, old.stdout);
    assert.match(String(old.json().error?.message), /"acme" was renamed to "acme\/resend"/);
    const { call, close } = await harness.mcp();
    try {
      const byTool = refused(await call('resend_account_show', { account: 'acme' }));
      assert.equal(byTool.message, old.json().error?.message);
    } finally {
      await close();
    }
    const now = await harness.cli(['--json', 'account', 'show', 'acme/resend']);
    assert.equal(now.code, 0, now.stdout);

    // A server pinned before the rename acts on the account by its id, under the name it has now.
    const shown = ok<{ name: string }>(await pinned.call('resend_account_show', {}));
    assert.equal(shown.name, 'acme/resend');
    const read = ok<{ available: boolean }>(await pinned.call('resend_domains', {}));
    assert.equal(read.available, true);
  } finally {
    await pinned.close();
  }
});

/** A secret store in memory: the stand-in for the keychain, which no test may touch. */
function memoryStore(kind: 'keychain' | 'file'): { values: Map<string, string>; store: SecretStore } {
  const values = new Map<string, string>();
  return {
    values,
    store: {
      kind,
      get: async (ref) => values.get(ref) ?? null,
      set: async (ref, value) => {
        values.set(ref, value);
      },
      delete: async (ref) => values.delete(ref),
      invalidate: () => undefined,
    },
  };
}

test('secrets migrate moves a Resend key with everything else, and agent-resend reads it where it went', async () => {
  harness = await newHarness();
  const account = await harness.addAccount({ name: 'acme/resend' });
  // The key, moved as if it had been kept in the keychain all along: the in-memory stand-in holds it.
  const keychain = memoryStore('keychain');
  const files = await harness.core.secrets('file');
  keychain.values.set(account.secretRef, String(await files.get(account.secretRef)));
  await files.delete(account.secretRef);
  await harness.core.config.update((config) => ({ ...config, secrets: { store: 'keychain' } }));

  // Out of the keychain is a loosening: approved, as `agentcomms secrets migrate --to file` asks for it.
  const result = await migrateSecrets(
    harness.core as never,
    'file',
    { source: keychain.store, target: files },
    { kind: 'loosening-consent', paths: ['secrets.store'] },
  );
  assert.deepEqual(result.leftovers, []);
  assert.ok(result.moved >= 1);
  assert.equal(keychain.values.has(account.secretRef), false, 'the original is gone from where nothing reads');
  assert.equal(await files.get(account.secretRef), FULL);

  // agent-resend now finds the key in the store the configuration names.
  const domains = await harness.cli(['--json', 'domains', '--account', 'acme/resend']);
  assert.equal(domains.code, 0, domains.stdout);
  assert.ok(harness.fake.requests.some((request) => request.headers.authorization === `Bearer ${FULL}`));
});

test('an account’s own change policy governs its changes: under confirm, a loosening waits for a terminal', async () => {
  harness = await newHarness();
  await harness.addAccount({ name: 'acme/resend', mode: 'read' });
  const { call, close } = await harness.mcp();
  try {
    // Tightening applies at once, from a chat.
    const tightened = ok<{ applied: boolean; result: Record<string, unknown> }>(
      await call('resend_account_policy', { account: 'acme/resend', changePolicy: 'confirm' }),
    );
    assert.equal(tightened.applied, true);
    assert.equal(tightened.result.changePolicy, 'confirm');
    assert.equal(tightened.result.changePolicyFrom, 'account');
    assert.equal((await harness.core.config.load()).defaults.changePolicy, undefined, 'the machine is still chat');

    // A loosening of this account is approved at a terminal, whatever the machine's default says.
    const asked = ok<{ approvalRequired: boolean; approvalId: string; policy: string; preview: string }>(
      await call('resend_account_policy', { account: 'acme/resend', mode: 'send' }),
    );
    assert.equal(asked.approvalRequired, true);
    assert.equal(asked.policy, 'confirm');
    assert.match(asked.preview, /approved by a code typed at a terminal/);
    const early = refused(
      await call('resend_account_policy', { account: 'acme/resend', mode: 'send', approvalId: asked.approvalId }),
    );
    assert.match(early.hint ?? '', /agent-resend approve/);
    assert.equal((await harness.context().accounts.require('acme/resend')).account.mode, 'read');

    // A person at a terminal types the code; then the same call applies it.
    const prompt = await beginChangeApproval(harness.core, asked.approvalId, { surface: 'cli' });
    await finishChangeApproval(harness.core, asked.approvalId, prompt.challenge, { surface: 'cli' });
    const applied = ok<{ applied: boolean }>(
      await call('resend_account_policy', { account: 'acme/resend', mode: 'send', approvalId: asked.approvalId }),
    );
    assert.equal(applied.applied, true);
    const now = (await harness.context().accounts.require('acme/resend')).account;
    assert.equal(now.mode, 'send');
    assert.equal(now.tier, 'send', 'tier says what mode says, for any reader that looks at it');

    // And loosening the change policy itself is approved under the one in force, confirm.
    const relax = ok<{ policy: string }>(
      await call('resend_account_policy', { account: 'acme/resend', changePolicy: 'chat' }),
    );
    assert.equal(relax.policy, 'confirm');
  } finally {
    await close();
  }
});
