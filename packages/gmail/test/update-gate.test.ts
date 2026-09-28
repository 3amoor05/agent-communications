import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { test } from 'node:test';
import { UPDATE_FIRST, updateCheckPath } from '@agentcomms/core';
import { type Harness, newHarness } from './support/harness.ts';
import { cli, connect, type ToolResult } from './support/surfaces.ts';

/*
 * The daily update check's stop, on Gmail's server and command (design 2026-09-28): an update that is out stops
 * every tool but the doctor, and every command but the exempt ones. The check is turned back on here — the harness
 * turns it off — with a file a check wrote a moment ago, so nothing here asks a registry; `npm_config_registry`
 * points at a port nobody answers on besides.
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
const text = (result: ToolResult) => (result.content ?? []).find((part) => part.type === 'text')?.text ?? '';

test('an update that is out stops every Gmail tool but the doctor, and a call claiming an approval goes ahead', async () => {
  const harness = await newHarness();
  await harness.addInbox({ alias: 'work', email: 'jo@example.test', refreshToken: 'fake-refresh-token' });
  updateOut(harness);
  const { call, close } = await connect({ core: harness.core, env: harness.env });
  try {
    const listed = await call('gmail_inboxes_list', {});
    assert.equal(code(listed), 'UPDATE_REQUIRED');
    assert.ok(text(listed).startsWith(UPDATE_FIRST), text(listed));
    assert.match(text(listed), /This is agent-gmail \d+\.\d+\.\d+[^;]*; the latest release is 99\.0\.0/);
    assert.match(text(listed), /gmail_inboxes_list did not run/);
    assert.notEqual(code(await call('gmail_doctor', {})), 'UPDATE_REQUIRED');
    // Claiming an approval the person already gave: past the stop, to the tool's own answer.
    const cancel = await call('gmail_send_cancel', { approvalId: `ap_${'0'.repeat(26)}` });
    assert.notEqual(code(cancel), 'UPDATE_REQUIRED');
  } finally {
    await close();
  }
});

test('agent-gmail: with nobody to ask a command exits 11 naming both ways on, and the doctor still runs', async () => {
  const harness = await newHarness();
  updateOut(harness);
  const listed = await cli(harness, ['inbox', 'list', '--json']);
  assert.equal(listed.code, 11, listed.stdout + listed.stderr);
  const error = listed.envelope<unknown>().error as { code: string; message: string };
  assert.equal(error.code, 'UPDATE_REQUIRED');
  assert.match(error.message, /`agentcomms update`/);
  assert.match(error.message, /`agentcomms update --later`/);
  const doctor = await cli(harness, ['doctor', '--json']);
  assert.notEqual(doctor.code, 11, doctor.stdout);
  // The listener a sign-in starts is not stopped: stopping it would break the sign-in under way. (This flow does not
  // exist, so it ends for that reason instead.)
  const listener = await cli(harness, ['oauth-listen', 'flow_none', '--json']);
  assert.notEqual(listener.code, 11, listener.stdout);
  assert.doesNotMatch(listener.stdout, /UPDATE_REQUIRED/);
});
