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

const code = (result: ToolResult) =>
  (result.structuredContent as { error?: { code?: string } } | undefined)?.error?.code;
const text = (result: ToolResult) =>
  ((result as { content?: { type: string; text?: string }[] }).content ?? []).find((part) => part.type === 'text')
    ?.text ?? '';

test('an update that is out stops every Resend tool but the doctor, and a call claiming an approval goes ahead', async () => {
  const harness = await newHarness();
  try {
    await harness.addAccount({ name: 'acme/resend' });
    const approvalId = await heldApproval(harness);
    updateOut(harness);
    const { call, close } = await harness.mcp();
    try {
      const listed = await call('resend_accounts_list', {});
      assert.equal(code(listed), 'UPDATE_REQUIRED');
      assert.ok(text(listed).startsWith(UPDATE_FIRST), text(listed));
      assert.match(text(listed), /This is agent-resend /);
      assert.notEqual(code(await call('resend_doctor', {})), 'UPDATE_REQUIRED');
      const status = await call('resend_send_status', { account: 'acme/resend', approvalId });
      assert.notEqual(code(status), 'UPDATE_REQUIRED', 'a call claiming an approval is not stopped');
      // The key alone claims nothing: an empty id, or one nobody here prepared, is stopped like any new call.
      for (const claimed of ['', `ap_${'0'.repeat(26)}`]) {
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
    await harness.addAccount({ name: 'acme/resend' });
    const approvalId = await heldApproval(harness);
    updateOut(harness);
    // A command carrying an approval this machine holds goes past the stop, as `resend_send_status` does over MCP —
    // by its argument here — to the command's own answer; one nobody here prepared does not.
    const held = await harness.cli(['--json', 'send', 'status', approvalId, '--account', 'acme/resend']);
    assert.notEqual(held.code, 11, held.stdout + held.stderr);
    assert.doesNotMatch(held.stdout, /UPDATE_REQUIRED/);
    const unknown = await harness.cli(['--json', 'send', 'status', `ap_${'0'.repeat(26)}`, '--account', 'acme/resend']);
    assert.equal(unknown.code, 11, unknown.stdout + unknown.stderr);
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
