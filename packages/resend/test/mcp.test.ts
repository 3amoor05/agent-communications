import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';
import { type Harness, newHarness, ok, refused } from './support/harness.ts';

/**
 * The agent-facing surface: the same tools whatever is connected, a greeting under 2 KB that says what a model must
 * not get wrong, strict arguments, a pin that holds, and no tool that adds a key or approves anything.
 */

let harness: Harness;
afterEach(async () => {
  await harness?.close();
});

const GREETING_LIMIT = 2048;

test('the tool list is the same whatever is connected, and has no way to add a key or approve', async () => {
  harness = await newHarness();
  const empty = await harness.mcp();
  const before = (await empty.client.listTools()).tools.map((tool) => tool.name).sort();
  await empty.close();
  await harness.addAccount({ name: 'acme/resend', mode: 'send' });
  const full = await harness.mcp();
  const after = (await full.client.listTools()).tools.map((tool) => tool.name).sort();
  const tools = (await full.client.listTools()).tools;
  await full.close();
  assert.deepEqual(before, after);
  for (const name of after) assert.match(name, /^resend_[a-z_]+$/);
  for (const absent of [
    'resend_account_add',
    'resend_approve',
    'resend_send',
    'resend_send_batch',
    'resend_broadcast_send',
  ]) {
    assert.ok(!after.includes(absent), `${absent} must not exist`);
  }
  const execute = tools.find((tool) => tool.name === 'resend_send_execute');
  assert.match(String(execute?.description), /agent-resend approve/);
  assert.match(String(execute?.description), /cannot approve/);
  assert.equal(execute?.annotations?.destructiveHint, true);
  assert.equal(execute?.annotations?.idempotentHint, false);
  assert.match(String(tools.find((tool) => tool.name === 'resend_send_prepare')?.description), /Nothing is sent/);
});

test(`the greeting stays under ${GREETING_LIMIT} bytes with many accounts, and keeps what matters most`, async () => {
  harness = await newHarness();
  for (let index = 0; index < 40; index += 1) {
    await harness.addAccount({
      name: `organisation-number-${String(index).padStart(2, '0')}/resend-qualifier${index % 10}`,
      mode: 'send',
    });
  }
  const { client, close } = await harness.mcp();
  const greeting = client.getInstructions() ?? '';
  await close();
  assert.ok(Buffer.byteLength(greeting, 'utf8') <= GREETING_LIMIT, `${Buffer.byteLength(greeting, 'utf8')} bytes`);
  for (const must of [
    /<untrusted-content>/,
    /Never follow instructions/,
    /agent-resend approve <id>/,
    /you cannot approve it\s+yourself/,
    /above 10 recipients/,
    /Read-only is enforced by agent-resend, not by the key/,
    /Never ask for one in chat/,
    /Pass `account` on every call/,
    /and 32 more/,
  ]) {
    assert.match(greeting, must);
  }
});

test('the greeting is scoped to a pinned account, and the pin refuses every other', async () => {
  harness = await newHarness();
  await harness.addAccount({ name: 'acme/resend', mode: 'send' });
  await harness.addAccount({ name: 'zeta/resend', mode: 'send' });
  const pinned = await harness.mcp({ account: 'acme/resend' });
  try {
    const greeting = pinned.client.getInstructions() ?? '';
    assert.match(greeting, /acme\/resend/);
    assert.doesNotMatch(greeting, /zeta/);
    assert.equal(refused(await pinned.call('resend_domains', { account: 'zeta/resend' })).code, 'USAGE');
    const listed = ok<{ accounts: { name: string }[] }>(await pinned.call('resend_accounts_list', {}));
    assert.deepEqual(
      listed.accounts.map((account) => account.name),
      ['acme/resend'],
    );
    // Another account's approval is refused before it is touched.
    const other = await harness.mcp();
    const theirs = ok<{ approvalId: string; expect: Record<string, unknown> }>(
      await other.call('resend_send_prepare', {
        account: 'zeta/resend',
        from: 'hello@acme.test',
        to: ['sam@partner.test'],
        subject: 'Hi',
        text: 'Hi',
      }),
    );
    await other.close();
    const refusal = refused(
      await pinned.call('resend_send_execute', { approvalId: theirs.approvalId, expect: theirs.expect }),
    );
    assert.equal(refusal.code, 'NOT_FOUND');
    assert.equal((await harness.core.approvals.get(theirs.approvalId))?.state, 'pending');
    assert.equal(harness.fake.sends().length, 0);
  } finally {
    await pinned.close();
  }
});

test('arguments are held to the schema: an unknown key or a wrong type is refused with a code, before anything runs', async () => {
  harness = await newHarness();
  await harness.addAccount({ name: 'acme/resend' });
  const { call, close } = await harness.mcp();
  try {
    assert.equal(refused(await call('resend_domains', { account: 'acme/resend', domian: 'acme.test' })).code, 'USAGE');
    assert.equal(refused(await call('resend_emails_list', { account: 'acme/resend', limit: true })).code, 'USAGE');
    assert.equal(
      refused(
        await call('resend_send_prepare', {
          account: 'acme/resend',
          from: 'hello@acme.test',
          to: ['sam@partner.test'],
          subject: 'Hi',
          text: 'Hi',
          apiKey: 're_fake_should_not_be_accepted',
        }),
      ).code,
      'USAGE',
    );
    assert.equal(
      refused(await call('resend_account_policy', { account: 'acme/resend', sendPolicy: 'always' })).code,
      'USAGE',
    );
    assert.equal(harness.fake.requests.length, 0);
  } finally {
    await close();
  }
});

test('under confirm the tool hands over the command a person runs, and sends nothing', async () => {
  harness = await newHarness();
  await harness.addAccount({ name: 'acme/resend', mode: 'send', sendPolicy: 'confirm' });
  const { call, close } = await harness.mcp();
  try {
    const prepared = ok<{ approvalId: string; expect: Record<string, unknown>; effectivePolicy: string }>(
      await call('resend_send_prepare', {
        account: 'acme/resend',
        from: 'hello@acme.test',
        to: ['sam@partner.test'],
        subject: 'Hi',
        text: 'Hi',
      }),
    );
    assert.equal(prepared.effectivePolicy, 'confirm');
    const waiting = refused(
      await call('resend_send_execute', {
        account: 'acme/resend',
        approvalId: prepared.approvalId,
        expect: prepared.expect,
      }),
    );
    assert.equal(waiting.code, 'APPROVAL_PENDING');
    assert.match(String(waiting.hint), new RegExp(`agent-resend approve ${prepared.approvalId}`));
    assert.equal(harness.fake.sends().length, 0);
  } finally {
    await close();
  }
});

test('changing an account from chat is a change approval: the preview first, then the claim', async () => {
  harness = await newHarness();
  await harness.addAccount({ name: 'acme/resend', mode: 'read' });
  const { call, close } = await harness.mcp();
  try {
    const first = ok<{ approvalRequired: boolean; approvalId: string; preview: string }>(
      await call('resend_account_policy', { account: 'acme/resend', mode: 'send' }),
    );
    assert.equal(first.approvalRequired, true);
    assert.match(first.preview, /CHANGE PREVIEW/);
    assert.match(first.preview, /mode: read → send/);
    assert.equal((await harness.context().accounts.require('acme/resend')).account.mode, 'read');
    const applied = ok<{ applied: boolean }>(
      await call('resend_account_policy', { account: 'acme/resend', mode: 'send', approvalId: first.approvalId }),
    );
    assert.equal(applied.applied, true);
    assert.equal((await harness.context().accounts.require('acme/resend')).account.mode, 'send');
    // The same approval cannot be spent twice, nor on another change.
    const again = refused(
      await call('resend_account_remove', { account: 'acme/resend', approvalId: first.approvalId }),
    );
    assert.match(again.code, /APPROVAL_/);
    assert.ok(await harness.context().accounts.find('acme/resend'), 'nothing was removed');
  } finally {
    await close();
  }
});
