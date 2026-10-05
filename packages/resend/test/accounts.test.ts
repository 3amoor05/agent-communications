import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';
import { CommsError } from '@agentcomms/core';
import { secretRefFor } from '../src/accounts.ts';
import { ResendContext } from '../src/context.ts';
import { runDoctor } from '../src/operations/doctor.ts';
import { assertNoBareCommand, resendInline, resendText } from './support/handoffs.ts';
import { FULL, type Harness, LOCKED, newHarness, SENDING } from './support/harness.ts';

/**
 * Connecting a key, and the promise that goes with it: **the key never leaves the secret store** — not into output,
 * not into the audit log, not into an error, not into any file but the one the store keeps it in.
 */

let harness: Harness;
afterEach(async () => {
  await harness?.close();
});

/** Every recognisable piece of a key: the whole, and the part after `re_`. */
const pieces = (key: string) => [key, key.slice(3), key.slice(-12)];

async function assertKeyNowhere(key: string, texts: string[], options: { stored?: boolean } = {}) {
  for (const piece of pieces(key)) {
    for (const text of texts) assert.ok(!text.includes(piece), `output carries ${piece}`);
    const files = (await harness.everyFile()).filter((file) => file.text.includes(piece));
    // The file secret store keeps it in exactly one file, under secrets/; nothing else may hold it.
    const allowed = options.stored === false ? 0 : 1;
    assert.ok(files.length <= allowed, `${files.map((file) => file.path).join(', ')} carry ${piece}`);
    for (const file of files) assert.match(file.path, /config[/\\]secrets[/\\]/);
  }
}

test('a full-access key typed through RESEND_API_KEY is detected, stored only in the secret store, and printed nowhere', async () => {
  harness = await newHarness();
  const result = await harness.cli(['--json', 'account', 'add', 'acme/resend'], { env: { RESEND_API_KEY: FULL } });
  assert.equal(result.code, 0, result.stdout + result.stderr);
  const data = result.json<Record<string, unknown>>().data ?? {};
  assert.equal(data.key, 'full_access');
  assert.equal(data.mode, 'read', 'a full-access key is added read-only unless a person asks for send');
  assert.match(String(data.guarantee), /enforced by agent-resend’s own code, not by the key/);
  const account = (await harness.context().accounts.require('acme/resend')).account;
  assert.equal(await (await harness.core.secrets('file')).get(secretRefFor(account.id)), FULL);
  assert.ok(!JSON.stringify(account).includes(FULL.slice(3)), 'the account record holds no part of the key');
  await assertKeyNowhere(FULL, [result.stdout, result.stderr, JSON.stringify(await harness.audit())]);
});

test('a sending-only key is detected by Resend’s restricted_api_key, needs a person’s yes to connect in send mode, and records a declared domain', async () => {
  harness = await newHarness();
  // No terminal: the change waits for a person, and nothing is stored until it is approved.
  const first = await harness.cli(['--json', 'account', 'add', 'acme/resend-send', '--domain', 'acme.test'], {
    env: { RESEND_API_KEY: LOCKED },
  });
  assert.equal(first.code, 10, first.stdout);
  const pending = first.json().error;
  assert.equal(pending?.code, 'APPROVAL_PENDING');
  assert.match(String(pending?.details?.preview), /acme\/resend-send mode \(connected by this change\): read → send/);
  assert.equal(await harness.context().accounts.find('acme/resend-send'), null, 'nothing stored before the approval');
  const approvalId = String(pending?.details?.approvalId);
  const second = await harness.cli(
    ['--json', 'account', 'add', 'acme/resend-send', '--domain', 'acme.test', '--approval', approvalId],
    { env: { RESEND_API_KEY: LOCKED } },
  );
  assert.equal(second.code, 0, second.stdout);
  const data = second.json<Record<string, unknown>>().data ?? {};
  assert.equal(data.key, 'sending_access');
  assert.equal(data.mode, 'send');
  assert.equal(data.domainLock, 'acme.test');
  assert.equal(data.canRead, false);
  // The detection asked for domains only: no send route was touched to find out.
  assert.equal(harness.fake.sends().length, 0);
  await assertKeyNowhere(LOCKED, [first.stdout, second.stdout, JSON.stringify(await harness.audit())]);
});

test('at a terminal, connecting in send mode asks the person there, and anything but yes stores nothing', async () => {
  harness = await newHarness();
  const declined = await harness.cli(['account', 'add', 'acme/resend', '--mode', 'send'], {
    env: { RESEND_API_KEY: FULL },
    tty: true,
    input: ['no'],
  });
  assert.notEqual(declined.code, 0);
  assert.equal(await harness.context().accounts.find('acme/resend'), null);
  const accepted = await harness.cli(['account', 'add', 'acme/resend', '--mode', 'send'], {
    env: { RESEND_API_KEY: FULL },
    tty: true,
    input: ['yes'],
  });
  assert.equal(accepted.code, 0, accepted.stderr);
  assert.equal((await harness.context().accounts.require('acme/resend')).account.mode, 'send');
  await assertKeyNowhere(FULL, [declined.stdout, declined.stderr, accepted.stdout, accepted.stderr]);
});

test('the hidden prompt reads the key at a terminal and never echoes it', async () => {
  harness = await newHarness();
  const result = await harness.cli(['account', 'add', 'acme/resend'], { tty: true, input: [FULL] });
  assert.equal(result.code, 0, result.stderr);
  assert.match(result.stderr, /not shown as you type/);
  await assertKeyNowhere(FULL, [result.stdout, result.stderr]);
});

test('an agent is refused before any key is read, and there is no terminal-less way in', async () => {
  harness = await newHarness();
  const agent = await harness.cli(['--json', 'account', 'add', 'acme/resend'], {
    env: { RESEND_API_KEY: FULL, CLAUDECODE: '1' },
  });
  assert.equal(agent.code, 77);
  assert.match(String(agent.json().error?.message), /by a person at their own terminal, not by an agent/);
  const none = await harness.cli(['--json', 'account', 'add', 'acme/resend']);
  assert.equal(none.code, 77);
  assert.match(String(none.json().error?.hint), /RESEND_API_KEY/);
  assert.equal(harness.fake.requests.length, 0, 'Resend was never asked');
  assert.equal(await harness.context().accounts.find('acme/resend'), null);
});

test('a key Resend refuses is refused, and the refusal does not carry it — even when Resend’s message does', async () => {
  harness = await newHarness();
  const unknown = 're_fakeunknown_0123456789abcdef';
  const result = await harness.cli(['--json', 'account', 'add', 'acme/resend'], { env: { RESEND_API_KEY: unknown } });
  assert.equal(result.code, 77);
  assert.equal(result.json().error?.code, 'AUTH_REQUIRED');
  // The fake echoes the key in its error message, as a careless server might.
  await assertKeyNowhere(unknown, [result.stdout, result.stderr], { stored: false });
  const shaped = await harness.cli(['--json', 'account', 'add', 'acme/resend'], {
    env: { RESEND_API_KEY: 'not a key at all' },
  });
  assert.equal(shaped.code, 65);
  assert.ok(!shaped.stdout.includes('not a key at all'));
});

test('names follow the grammar, and --domain is only for a sending-only key', async () => {
  harness = await newHarness();
  for (const name of ['acme', 'acme/gmail', 'Acme/resend']) {
    const result = await harness.cli(['--json', 'account', 'add', name], { env: { RESEND_API_KEY: FULL } });
    assert.equal(result.code, 64, `${name}: ${result.stdout}`);
  }
  const full = await harness.cli(['--json', 'account', 'add', 'acme/resend', '--domain', 'acme.test'], {
    env: { RESEND_API_KEY: FULL },
  });
  assert.equal(full.code, 64);
  assert.match(String(full.json().error?.message), /only for a sending-only key/);
});

test('removing an account is a change a person approves, and takes the key out of the store', async () => {
  harness = await newHarness();
  const account = await harness.addAccount({ name: 'acme/resend' });
  const first = await harness.cli(['--json', 'account', 'remove', 'acme/resend'], { env: { CLAUDECODE: '1' } });
  assert.equal(first.code, 10);
  assert.ok(await (await harness.core.secrets('file')).get(account.secretRef), 'still there before the approval');
  const approvalId = String(first.json().error?.details?.approvalId);
  const second = await harness.cli(['--json', 'account', 'remove', 'acme/resend', '--approval', approvalId], {
    env: { CLAUDECODE: '1' },
  });
  assert.equal(second.code, 0, second.stdout);
  assert.equal(await (await harness.core.secrets('file')).get(account.secretRef), null);
  assert.equal(await harness.context().accounts.find('acme/resend'), null);
});

test('tightening a send policy applies at once; loosening it, or read → send, waits for a person', async () => {
  harness = await newHarness();
  await harness.addAccount({ name: 'acme/resend', mode: 'read' });
  const tighten = await harness.cli(['--json', 'account', 'policy', 'acme/resend', '--send', 'confirm'], {
    env: { CLAUDECODE: '1' },
  });
  assert.equal(tighten.code, 0, tighten.stdout);
  assert.equal((await harness.context().accounts.require('acme/resend')).account.sendPolicy, 'confirm');
  const loosen = await harness.cli(['--json', 'account', 'policy', 'acme/resend', '--send', 'chat'], {
    env: { CLAUDECODE: '1' },
  });
  assert.equal(loosen.code, 10);
  assert.match(String(loosen.json().error?.details?.preview), /acme\/resend send policy: confirm → chat/);
  assert.equal((await harness.context().accounts.require('acme/resend')).account.sendPolicy, 'confirm');
  const widen = await harness.cli(['--json', 'account', 'policy', 'acme/resend', '--mode', 'send'], {
    env: { CLAUDECODE: '1' },
  });
  assert.equal(widen.code, 10);
  assert.equal((await harness.context().accounts.require('acme/resend')).account.mode, 'read');
});

test('core’s configuration refuses a loosening of a Resend account that carries no consent, whoever writes it', async () => {
  harness = await newHarness();
  await harness.addAccount({ name: 'acme/resend', mode: 'read', sendPolicy: 'confirm' });
  const set = (change: Record<string, unknown>) =>
    harness.core.config.update((config) => {
      const held = config.accounts['acme/resend'];
      assert.ok(held);
      return { ...config, accounts: { ...config.accounts, 'acme/resend': { ...held, ...change } } };
    });
  // Wider mode, looser send policy, looser change policy: each is core's classifier's to judge, and each is refused.
  for (const change of [{ mode: 'send', tier: 'send' }, { sendPolicy: 'chat' }, { mode: 'post', tier: 'post' }]) {
    await assert.rejects(
      set(change),
      (error: unknown) => error instanceof CommsError && error.code === 'LOOSENING_REFUSED',
      JSON.stringify(change),
    );
  }
  await set({ changePolicy: 'confirm' });
  await assert.rejects(
    set({ changePolicy: 'chat' }),
    (error: unknown) => error instanceof CommsError && error.code === 'LOOSENING_REFUSED',
  );
  const account = (await harness.context().accounts.require('acme/resend')).account;
  assert.equal(account.mode, 'read');
  assert.equal(account.sendPolicy, 'confirm');
  assert.equal(account.changePolicy, 'confirm');
});

test('a record with a mode outside read and send is refused, never read as something narrower', async () => {
  harness = await newHarness();
  await harness.addAccount({ name: 'acme/resend', mode: 'read' });
  // Written as a person would have to, with consent: core reads any word, so one odd account cannot make the file
  // unreadable. Acting on it is this package's to refuse.
  await harness.core.config.update(
    (config) => {
      const held = config.accounts['acme/resend'];
      assert.ok(held);
      return { ...config, accounts: { ...config.accounts, 'acme/resend': { ...held, mode: 'post', tier: 'post' } } };
    },
    { consent: { kind: 'loosening-consent', paths: ['accounts.acme/resend.mode'] } },
  );
  const shown = await harness.cli(['--json', 'account', 'show', 'acme/resend']);
  assert.equal(shown.code, 78, shown.stdout);
  assert.match(String(shown.json().error?.message), /its mode is "post"/);
  const prepared = await harness.cli([
    '--json',
    'send',
    'prepare',
    '--account',
    'acme/resend',
    '--from',
    'hello@acme.test',
    '--to',
    'sam@partner.test',
    '--subject',
    'Hi',
    '--text',
    'Hi',
  ]);
  assert.equal(prepared.code, 78, prepared.stdout);
  assert.equal(harness.fake.sends().length, 0);
});

test('an invalid account renders its repair for the selected shell platform', async () => {
  harness = await newHarness();
  await harness.addAccount({ name: '7/resend', mode: 'read' });
  await harness.core.config.update(
    (config) => {
      const held = config.accounts['7/resend'];
      assert.ok(held);
      return { ...config, accounts: { ...config.accounts, '7/resend': { ...held, mode: 'post', tier: 'post' } } };
    },
    { consent: { kind: 'loosening-consent', paths: ['accounts.7/resend.mode'] } },
  );
  // Resend's own `account remove`, located and quoted for Windows: the name is quoted there, as every printed command is.
  const repair = `Remove it with ${resendInline(harness.core, ['account', 'remove', '7/resend'], 'win32')} and add it again, or fix it in the configuration file.`;
  assert.match(repair, /"7\/resend"/);
  await assert.rejects(harness.context('cli', 'win32').accounts.require('7/resend'), (error: CommsError) => {
    assert.equal(error.hint, repair);
    assertNoBareCommand(error.hint ?? '');
    return true;
  });
  const shown = await harness.cli(['--json', 'account', 'show', '7/resend'], { platform: 'win32' });
  assert.equal(shown.code, 78, shown.stdout);
  assert.equal(shown.json().error?.hint, repair);
});

test('show and doctor say plainly that read-only is this package’s promise, not the key’s', async () => {
  harness = await newHarness();
  await harness.addAccount({ name: 'acme/resend', mode: 'read' });
  await harness.addAccount({ name: 'acme/resend-send', tier: 'sending_access', key: SENDING });
  const show = await harness.cli(['account', 'show', 'acme/resend']);
  assert.match(show.stdout, /Read-only is enforced by agent-resend’s own code, not by the key/);
  const doctor = await harness.cli(['--json', 'doctor']);
  assert.equal(doctor.code, 0, doctor.stdout);
  const result = doctor.json<{
    readOnly: string;
    accounts: { name: string; checks: { name: string; ok: boolean; detail: string }[] }[];
  }>().data;
  assert.match(String(result?.readOnly), /Resend has no read-only API key/);
  const sending = result?.accounts.find((account) => account.name === 'acme/resend-send');
  assert.ok(sending?.checks.some((check) => check.ok && /unavailable by design/.test(check.detail)));
});

test('doctor renders its repair commands for the selected shell platform', async () => {
  harness = await newHarness();
  const account = await harness.addAccount({ name: '7/resend', mode: 'read' });
  await (await harness.core.secrets('file')).delete(account.secretRef);
  const result = await runDoctor(
    new ResendContext({
      core: harness.core,
      env: harness.env,
      fetch: harness.fake.fetch,
      throttle: { intervalMs: 0 },
      platform: 'win32',
    }),
    { offline: true },
  );
  const missing = result.accounts[0]?.checks.find((check) => check.name === 'key stored');
  assert.equal(
    missing?.fix,
    `${resendText(harness.core, ['account', 'remove', '7/resend'], 'win32')}, then ${resendText(harness.core, ['account', 'add', '7/resend'], 'win32')}`,
  );
  assert.match(String(missing?.fix), /"7\/resend"/);
});
