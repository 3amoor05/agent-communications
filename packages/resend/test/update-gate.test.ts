import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { test } from 'node:test';
import { UPDATE_FIRST, updateCheckPath } from '@agentcomms/core';
import { type Harness, newHarness, type ToolResult } from './support/harness.ts';

/*
 * The daily update check's stop, on Resend's server and command (design 2026-09-28): an update that is out stops
 * every tool but the doctor, and every command but the exempt ones. The check is turned back on here — the harness
 * turns it off — with a file a check wrote a moment ago, so nothing here asks a registry; Resend is the loopback fake.
 */

function updateOut(harness: Harness): void {
  harness.env.AGENT_COMMS_UPDATE_CHECK = 'on';
  harness.env.npm_config_registry = 'http://127.0.0.1:9/';
  const stateDir = harness.core.paths.stateDir;
  mkdirSync(stateDir, { recursive: true });
  writeFileSync(
    updateCheckPath(stateDir),
    JSON.stringify({ lastChecked: new Date().toISOString(), latest: '99.0.0', behind: true }),
  );
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
    updateOut(harness);
    const { call, close } = await harness.mcp();
    try {
      const listed = await call('resend_accounts_list', {});
      assert.equal(code(listed), 'UPDATE_REQUIRED');
      assert.ok(text(listed).startsWith(UPDATE_FIRST), text(listed));
      assert.match(text(listed), /This is agent-resend /);
      assert.notEqual(code(await call('resend_doctor', {})), 'UPDATE_REQUIRED');
      const status = await call('resend_send_status', { account: 'acme/resend', approvalId: `ap_${'0'.repeat(26)}` });
      assert.notEqual(code(status), 'UPDATE_REQUIRED', 'a call claiming an approval is not stopped');
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
    updateOut(harness);
    const listed = await harness.cli(['--json', 'account', 'list']);
    assert.equal(listed.code, 11, listed.stdout + listed.stderr);
    const error = (listed.json() as { error: { code: string; message: string } }).error;
    assert.equal(error.code, 'UPDATE_REQUIRED');
    assert.match(error.message, /`agentcomms update`/);
    assert.match(error.message, /`agentcomms update --later`/);
    const doctor = await harness.cli(['--json', 'doctor']);
    assert.notEqual(doctor.code, 11, doctor.stdout);
  } finally {
    await harness.close();
  }
});
