import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { PassThrough } from 'node:stream';
import { test } from 'node:test';
import { gatedChange, UPDATE_FIRST, updateCheckPath, updateLaterChange } from '@agentcomms/core';
import { Client } from '@modelcontextprotocol/client';
import { InMemoryTransport } from '@modelcontextprotocol/server';
import { run } from '../src/cli/program.ts';
import { createSlackMcpServer } from '../src/mcp/server.ts';
import { type Harness, newHarness } from './support/harness.ts';

/*
 * The daily update check's stop, on Slack's server and command (design 2026-09-28): an update that is out stops every
 * tool but the doctor, and every command but the exempt ones. The check is turned back on here — the harness turns it
 * off — with a file a check wrote a moment ago, so nothing here asks a registry, and Slack is a fetch that refuses.
 */

interface ToolResult {
  isError?: boolean;
  content?: { type: string; text?: string }[];
  structuredContent?: Record<string, unknown>;
}

const refuseEverything = async () => new Response(JSON.stringify({ ok: false, error: 'unknown_method' }));

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

/** An approval this machine holds, prepared before the update was found — as a post approved moments before is. */
async function heldApproval(harness: Harness): Promise<string> {
  const prepared = await gatedChange(harness.core, updateLaterChange(harness.core), { surface: 'mcp' });
  assert.equal(prepared.status, 'approval-required');
  return (prepared as { prepared: { approvalId: string } }).prepared.approvalId;
}

const code = (result: ToolResult) =>
  (result.structuredContent as { error?: { code?: string } } | undefined)?.error?.code;
const text = (result: ToolResult) => (result.content ?? []).find((part) => part.type === 'text')?.text ?? '';

test('an update that is out stops every Slack tool but the doctor, and a call claiming an approval goes ahead', async () => {
  const harness = await newHarness();
  await harness.addWorkspace({ alias: 'acme' });
  const approvalId = await heldApproval(harness);
  updateOut(harness);
  const { server } = await createSlackMcpServer({
    core: harness.core,
    env: harness.env,
    fetch: refuseEverything,
    probe: (input, init) => harness.probe(input, init),
  });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 'test', version: '0' });
  await Promise.all([client.connect(clientTransport), server.connect(serverTransport)]);
  const call = async (name: string, args: Record<string, unknown>) =>
    (await client.callTool({ name, arguments: args })) as ToolResult;
  try {
    const listed = await call('slack_workspaces_list', {});
    assert.equal(code(listed), 'UPDATE_REQUIRED');
    assert.ok(text(listed).startsWith(UPDATE_FIRST), text(listed));
    assert.match(text(listed), /This is agent-slack /);
    assert.notEqual(code(await call('slack_doctor', { offline: true })), 'UPDATE_REQUIRED');
    const send = (claimed: string) =>
      call('slack_post_send', {
        workspace: 'acme',
        draftId: 'dr_none',
        approvalId: claimed,
        expectChannel: 'C0000000000',
      });
    assert.notEqual(code(await send(approvalId)), 'UPDATE_REQUIRED', 'a call claiming an approval is not stopped');
    // The key alone claims nothing: an empty id, or one nobody here prepared, is stopped like any new call.
    for (const claimed of ['', `ap_${'0'.repeat(26)}`]) {
      assert.equal(code(await send(claimed)), 'UPDATE_REQUIRED', JSON.stringify(claimed));
    }
    // Every registration of Slack's server here names the latest: restart the client. Another channel's, or Slack's
    // global command, says nothing of this server: update.
    updateOut(harness, { registered: ['slack'], global: [] });
    assert.match(text(await call('slack_workspaces_list', {})), /Restart the client first/);
    updateOut(harness, { registered: ['gmail'], global: ['slack'] });
    assert.ok(text(await call('slack_workspaces_list', {})).startsWith(UPDATE_FIRST));
  } finally {
    await Promise.all([client.close(), server.close()]);
  }
});

test('agent-slack: with nobody to ask a command exits 11 naming both ways on, and the doctor still runs', async () => {
  const harness = await newHarness();
  const approvalId = await heldApproval(harness);
  updateOut(harness);
  const command = async (argv: string[]) => {
    let stdout = '';
    const out = new PassThrough();
    out.on('data', (chunk) => {
      stdout += String(chunk);
    });
    const exit = await run(argv, {
      core: harness.core,
      env: harness.env,
      streams: { stdout: out, stderr: new PassThrough(), stdin: new PassThrough() },
      openBrowser: () => undefined,
      probe: (input, init) => harness.probe(input, init),
      read: refuseEverything,
    });
    return { exit, stdout };
  };
  const listed = await command(['workspace', 'list', '--json']);
  assert.equal(listed.exit, 11, listed.stdout);
  const error = (JSON.parse(listed.stdout) as { error: { code: string; message: string } }).error;
  assert.equal(error.code, 'UPDATE_REQUIRED');
  assert.match(error.message, /`agentcomms update`/);
  assert.match(error.message, /`agentcomms update --later`/);
  const doctor = await command(['doctor', '--offline', '--json']);
  assert.notEqual(doctor.exit, 11, doctor.stdout);
  // A command carrying an approval this machine holds goes past the stop, as `slack_post_send` does over MCP — to
  // the command's own answer (this approval is not a post's); one nobody here prepared does not.
  const post = (claimed: string) =>
    command([
      'post',
      'send',
      '--workspace',
      'acme',
      '--draft',
      'dr_none',
      '--approval',
      claimed,
      '--expect-channel',
      'C0000000000',
      '--json',
    ]);
  const held = await post(approvalId);
  assert.notEqual(held.exit, 11, held.stdout);
  assert.doesNotMatch(held.stdout, /UPDATE_REQUIRED/);
  assert.equal((await post(`ap_${'0'.repeat(26)}`)).exit, 11);
  // Slack's package installed globally at the latest, and this copy older: stopped, and told to run the installed one.
  updateOut(harness, { registered: [], global: ['slack'] });
  const older = await command(['workspace', 'list', '--json']);
  assert.equal(older.exit, 11, older.stdout);
  assert.match(older.stdout, /isn't running it yet/);
  // The listener a sign-in starts is not stopped: stopping it would break the sign-in under way. (This flow does not
  // exist, so it ends for that reason instead.)
  const listener = await command(['sign-in-listen', 'flow_none', '--json']);
  assert.notEqual(listener.exit, 11, listener.stdout);
  assert.doesNotMatch(listener.stdout, /UPDATE_REQUIRED/);
});
