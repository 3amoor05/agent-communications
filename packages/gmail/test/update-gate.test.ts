import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { test } from 'node:test';
import {
  claimUpdateCheck,
  gatedChange,
  readUpdateCheck,
  UPDATE_CHECK_CHILD_COMMAND,
  UPDATE_FIRST,
  updateCheckPath,
  updateLaterChange,
} from '@agentcomms/core';
import { type Harness, newHarness } from './support/harness.ts';
import { cli, connect, type ToolResult } from './support/surfaces.ts';

/*
 * The daily update check's stop, on Gmail's server and command (design 2026-09-28): an update that is out stops
 * every tool but the doctor, and every command but the exempt ones. The check is turned back on here — the harness
 * turns it off — with a file a check wrote a moment ago, so nothing here asks a registry; `npm_config_registry`
 * points at a port nobody answers on besides.
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
const text = (result: ToolResult) => (result.content ?? []).find((part) => part.type === 'text')?.text ?? '';

test('an update that is out stops every Gmail tool but the doctor, and a call claiming an approval goes ahead', async () => {
  const harness = await newHarness();
  await harness.addInbox({ alias: 'work', email: 'jo@example.test', refreshToken: 'fake-refresh-token' });
  const approvalId = await heldApproval(harness);
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
    const cancel = await call('gmail_send_cancel', { approvalId });
    assert.notEqual(code(cancel), 'UPDATE_REQUIRED');
    // One nobody here prepared claims nothing, and is stopped like any new call.
    assert.equal(code(await call('gmail_send_cancel', { approvalId: `ap_${'0'.repeat(26)}` })), 'UPDATE_REQUIRED');
    // Every registration of Gmail's server here names the latest: restart the client. Another channel's, or Gmail's
    // global command, says nothing of this server: update.
    updateOut(harness, { registered: ['gmail'], global: [] });
    assert.match(text(await call('gmail_inboxes_list', {})), /Restart the client first/);
    updateOut(harness, { registered: ['slack'], global: ['gmail'] });
    assert.ok(text(await call('gmail_inboxes_list', {})).startsWith(UPDATE_FIRST));
  } finally {
    await close();
  }
});

test('agent-gmail: with nobody to ask a command exits 11 naming both ways on, and the doctor still runs', async () => {
  const harness = await newHarness();
  const approvalId = await heldApproval(harness);
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
  // A command carrying an approval this machine holds goes past the stop, as `gmail_send_cancel` does over MCP — by
  // its argument here — to the command's own answer; one nobody here prepared does not.
  const held = await cli(harness, ['send', 'cancel', approvalId, '--json']);
  assert.notEqual(held.code, 11, held.stdout + held.stderr);
  assert.doesNotMatch(held.stdout, /UPDATE_REQUIRED/);
  assert.equal((await cli(harness, ['send', 'cancel', `ap_${'0'.repeat(26)}`, '--json'])).code, 11);
  // Gmail's package installed globally at the latest, and this copy older: stopped, and told to run the installed one.
  updateOut(harness, { registered: [], global: ['gmail'] });
  const older = await cli(harness, ['inbox', 'list', '--json']);
  assert.equal(older.code, 11, older.stdout);
  assert.match((older.envelope<unknown>().error as { message: string }).message, /isn't running it yet/);
});

test('agent-gmail: an approval the stop let through is refused by a finish, and by a setup that would not claim it', async () => {
  /*
   * "Not now" — waiting, a change — lets a command past the stop, and an agent that was stopped can have it prepared
   * without the person. `inbox reauth --finish` took `--approval` and claimed none; `setup` claimed each of its two
   * only at the step that uses it, and a run that never got there dropped it after doing the steps before — a sign-in
   * started, a preview prepared — past the stop. Each refuses it now, before anything is done.
   */
  const harness = await newHarness();
  await harness.addInbox({ alias: 'work', email: 'jo@example.test', refreshToken: 'fake-refresh-token' });
  const later = await heldApproval(harness);
  updateOut(harness);
  const before = JSON.stringify(await harness.core.config.load());
  for (const [argv, words] of [
    // A flow id of the right shape that nothing started: without the refusal, the finish looks it up.
    [
      ['inbox', 'reauth', 'work', '--finish', `fl_${'0'.repeat(22)}`, '--approval', later],
      /--finish collects a sign-in/,
    ],
    // A client is registered already: no step of this run registers one.
    [
      ['setup', '--inbox', 'work', '--approval', later],
      /already registered, so this run registers none and takes no --approval/,
    ],
    // No client named: nothing claims the registration's approval, whatever the run reaches.
    [['setup', '--inbox', 'work', '--mcp-approval', later], /names no client with --mcp-client/],
    // A mailbox to sign in first: the run stops at its browser, before the registration.
    [
      ['setup', '--mcp-client', 'cursor', '--inbox', 'home', '--mcp-approval', later],
      /signs a mailbox in first, and that waits for a browser/,
    ],
  ] as const) {
    const refused = await cli(harness, [...argv, '--json']);
    assert.equal(refused.code, 64, `${argv.join(' ')}: ${refused.stdout}${refused.stderr}`);
    const error = refused.envelope<unknown>().error as { code: string; message: string };
    assert.equal(error.code, 'USAGE', argv.join(' '));
    assert.match(error.message, words, argv.join(' '));
  }
  assert.equal(JSON.stringify(await harness.core.config.load()), before, 'a mailbox or a client was changed');
  assert.deepEqual(
    (await harness.core.approvals.list()).map((record) => [record.approvalId, record.state]),
    [[later, 'pending']],
    'an approval was claimed, or another prepared',
  );
});

test('agent-gmail finishes the update check a command handed on: under its claim, never stopped, and not in help', async () => {
  // The child a command starts for the day's check (#48) is this CLI again, with the hidden command and the claim.
  const harness = await newHarness();
  updateOut(harness);
  // A day old, so every other command would ask first — and, with an update out, be stopped.
  const stateDir = harness.core.paths.stateDir;
  writeFileSync(updateCheckPath(stateDir), JSON.stringify({ latest: '99.0.0', behind: true }));
  const claimedAt = await claimUpdateCheck(harness.core);
  assert.ok(claimedAt !== null);
  const child = await cli(harness, [UPDATE_CHECK_CHILD_COMMAND, claimedAt, '--json']);
  assert.equal(child.code, 0, child.stdout + child.stderr);
  // The registry here refuses at once: the ask is recorded as the day's, with why, and the claim given up.
  const record = await readUpdateCheck(stateDir);
  assert.deepEqual([record.lastChecked, record.checking], [claimedAt, null]);
  assert.match(String(record.lastError), /could not be reached/);
  assert.doesNotMatch((await cli(harness, ['--help'])).stdout, new RegExp(UPDATE_CHECK_CHILD_COMMAND));
});
