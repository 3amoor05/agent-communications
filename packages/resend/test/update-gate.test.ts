import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { test } from 'node:test';
import { gatedChange, UPDATE_FIRST, updateCheckPath, updateLaterChange } from '@agentcomms/core';
import { type Harness, newHarness, type ToolResult } from './support/harness.ts';

/*
 * The daily update check's stop, on Resend's server and command (design 2026-09-28): an update that is out stops
 * every tool but the doctor, and every command but the exempt ones. The check is turned back on here — the harness
 * turns it off — with a file a check wrote a moment ago, so nothing here asks a registry; Resend is the loopback fake.
 */

function updateOut(harness: Harness, current: { registered: string[]; global: string[] } | null = null): void {
  harness.env.AGENT_COMMS_UPDATE_CHECK = 'on';
  harness.env.npm_config_registry = 'http://127.0.0.1:9/';
  const stateDir = harness.core.paths.stateDir;
  mkdirSync(stateDir, { recursive: true });
  writeFileSync(
    updateCheckPath(stateDir),
    JSON.stringify({ lastChecked: new Date().toISOString(), latest: '99.0.0', behind: true, current }),
  );
}

/** An approval this machine holds, prepared before the update was found — as a send approved moments before is. */
async function heldApproval(harness: Harness): Promise<string> {
  const prepared = await gatedChange(harness.core, updateLaterChange(harness.core), { surface: 'mcp' });
  assert.equal(prepared.status, 'approval-required');
  return (prepared as { prepared: { approvalId: string } }).prepared.approvalId;
}

/**
 * A send approval of the account's, as `resend_send_prepare` leaves one — or, `used`, as a send that went out leaves
 * it: claimed and completed through the store, the way `resend_send_execute` does. Nothing here reaches Resend.
 */
async function sendApproval(harness: Harness, accountId: string, used = false): Promise<string> {
  const expect = { to: ['someone@example.test'], cc: [], bcc: [], subject: 'Hello' };
  const draft = { draftMessageId: 'revision_one', digest: 'a'.repeat(64) };
  const record = await harness.core.approvals.create({
    inboxId: accountId,
    draftId: 'draft_one',
    ...draft,
    policy: 'chat',
    requiredPolicy: 'chat',
    riskFlags: [],
    expect,
  });
  if (used) {
    await harness.core.approvals.claimForSend(record.approvalId, {
      inboxId: accountId,
      ...draft,
      policy: 'chat',
      expect,
    });
    await harness.core.approvals.complete(record.approvalId, { sentMessageId: 'email_one' });
    assert.equal((await harness.core.approvals.get(record.approvalId))?.state, 'used');
  }
  return record.approvalId;
}

const code = (result: ToolResult) =>
  (result.structuredContent as { error?: { code?: string } } | undefined)?.error?.code;
const text = (result: ToolResult) =>
  ((result as { content?: { type: string; text?: string }[] }).content ?? []).find((part) => part.type === 'text')
    ?.text ?? '';

test('an update that is out stops every Resend tool but the doctor, and a call claiming an approval goes ahead', async () => {
  const harness = await newHarness();
  try {
    const account = await harness.addAccount({ name: 'acme/resend' });
    const pending = await sendApproval(harness, account.id);
    const sent = await sendApproval(harness, account.id, true);
    const change = await heldApproval(harness);
    updateOut(harness);
    const { call, close } = await harness.mcp();
    try {
      const listed = await call('resend_accounts_list', {});
      assert.equal(code(listed), 'UPDATE_REQUIRED');
      assert.ok(text(listed).startsWith(UPDATE_FIRST), text(listed));
      assert.match(text(listed), /This is agent-resend /);
      assert.notEqual(code(await call('resend_doctor', {})), 'UPDATE_REQUIRED');
      // The status of a send is looked up by the approval it went under — waiting, or used once it went — and goes
      // past the stop as the send did.
      for (const approvalId of [pending, sent]) {
        const status = await call('resend_send_status', { account: 'acme/resend', approvalId });
        assert.notEqual(code(status), 'UPDATE_REQUIRED', 'a look-up of a send is not stopped');
        assert.equal(status.isError, undefined, JSON.stringify(status.structuredContent));
      }
      // A used approval claims nothing else: sending under it again is stopped, not merely refused past the stop.
      const again = await call('resend_send_execute', {
        account: 'acme/resend',
        approvalId: sent,
        expect: { to: ['someone@example.test'], cc: [], bcc: [], subject: 'Hello' },
      });
      assert.equal(code(again), 'UPDATE_REQUIRED', JSON.stringify(again.structuredContent));
      // The key alone claims nothing: an empty id, one nobody here prepared, or a change's — "not now", which an
      // agent can have prepared while stopped — is stopped like any new call.
      for (const claimed of ['', `ap_${'0'.repeat(26)}`, change]) {
        const refused = await call('resend_send_status', { account: 'acme/resend', approvalId: claimed });
        assert.equal(code(refused), 'UPDATE_REQUIRED', JSON.stringify(claimed));
      }
      // Every registration of Resend's server here names the latest: restart the client. Another channel's, or
      // Resend's global command, says nothing of this server: update.
      updateOut(harness, { registered: ['resend'], global: [] });
      assert.match(text(await call('resend_accounts_list', {})), /Restart the client first/);
      updateOut(harness, { registered: ['gmail'], global: ['resend'] });
      assert.ok(text(await call('resend_accounts_list', {})).startsWith(UPDATE_FIRST));
    } finally {
      await close();
    }
  } finally {
    await harness.close();
  }
});

test('agent-resend: with nobody to ask a command exits 11 naming both ways on, and the doctor still runs', async () => {
  const harness = await newHarness();
  try {
    const account = await harness.addAccount({ name: 'acme/resend' });
    const sent = await sendApproval(harness, account.id, true);
    const change = await heldApproval(harness);
    updateOut(harness);
    // `send status` looks a send up by its approval, used as it is, and goes past the stop as `resend_send_status`
    // does over MCP — by its argument here — to the command's own answer. One nobody here prepared, or a change's,
    // does not.
    const held = await harness.cli(['--json', 'send', 'status', sent, '--account', 'acme/resend']);
    assert.equal(held.code, 0, held.stdout + held.stderr);
    assert.doesNotMatch(held.stdout, /UPDATE_REQUIRED/);
    for (const claimed of [`ap_${'0'.repeat(26)}`, change]) {
      const refused = await harness.cli(['--json', 'send', 'status', claimed, '--account', 'acme/resend']);
      assert.equal(refused.code, 11, refused.stdout + refused.stderr);
    }
    const listed = await harness.cli(['--json', 'account', 'list']);
    assert.equal(listed.code, 11, listed.stdout + listed.stderr);
    const error = (listed.json() as { error: { code: string; message: string } }).error;
    assert.equal(error.code, 'UPDATE_REQUIRED');
    assert.match(error.message, /`agentcomms update`/);
    assert.match(error.message, /`agentcomms update --later`/);
    // Resend's package installed globally at the latest, and this copy older: stopped, and told to run the installed
    // one.
    updateOut(harness, { registered: [], global: ['resend'] });
    const older = await harness.cli(['--json', 'account', 'list']);
    assert.equal(older.code, 11, older.stdout);
    assert.match(older.stdout, /isn't running it yet/);
    updateOut(harness);
    const doctor = await harness.cli(['--json', 'doctor']);
    assert.notEqual(doctor.code, 11, doctor.stdout);
  } finally {
    await harness.close();
  }
});

test('an approval the stop let through is refused by the policy report, over MCP and at the terminal: nothing is reported', async () => {
  /*
   * "Not now" — waiting, a change — lets a call past the stop, and an agent that was stopped can have it prepared
   * without the person. The report took the id and claimed none, answering past the stop as though it were not there.
   * It refuses it now, as `comms_change_policy` does without `set`.
   */
  const harness = await newHarness();
  try {
    await harness.addAccount({ name: 'acme/resend' });
    const later = await heldApproval(harness);
    updateOut(harness);
    const before = JSON.stringify(await harness.core.config.load());
    const { call, close } = await harness.mcp();
    try {
      const report = await call('resend_account_policy', { account: 'acme/resend', approvalId: later });
      assert.equal(code(report), 'USAGE', JSON.stringify(report.structuredContent));
      assert.match(
        text(report),
        /an approval goes with a policy to set; without `sendPolicy`, `mode` or `changePolicy`/,
      );
      assert.doesNotMatch(text(report), /"sendPolicyFrom"/, 'the policy was reported');
    } finally {
      await close();
    }
    const refused = await harness.cli(['--json', 'account', 'policy', 'acme/resend', '--approval', later]);
    assert.equal(refused.code, 64, refused.stdout + refused.stderr);
    const error = (refused.json() as { error: { code: string; message: string } }).error;
    assert.equal(error.code, 'USAGE');
    assert.match(error.message, /an approval goes with a policy to set; without --send, --mode or --change/);

    assert.equal(JSON.stringify(await harness.core.config.load()), before, 'the account was changed');
    assert.equal((await harness.core.approvals.get(later))?.state, 'pending', 'the approval was claimed');
  } finally {
    await harness.close();
  }
});
