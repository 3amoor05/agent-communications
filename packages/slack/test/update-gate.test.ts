import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { PassThrough } from 'node:stream';
import { test } from 'node:test';
import { UPDATE_FIRST, updateCheckPath } from '@agentcomms/core';
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

test('an update that is out stops every Slack tool but the doctor, and a call claiming an approval goes ahead', async () => {
  const harness = await newHarness();
  await harness.addWorkspace({ alias: 'acme' });
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
    const post = await call('slack_post_send', {
      workspace: 'acme',
      draftId: 'dr_none',
      approvalId: `ap_${'0'.repeat(26)}`,
      expectChannel: 'C0000000000',
    });
    assert.notEqual(code(post), 'UPDATE_REQUIRED', 'a call claiming an approval is not stopped');
  } finally {
    await Promise.all([client.close(), server.close()]);
  }
});

test('agent-slack: with nobody to ask a command exits 11 naming both ways on, and the doctor still runs', async () => {
  const harness = await newHarness();
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
  // The listener a sign-in starts is not stopped: stopping it would break the sign-in under way. (This flow does not
  // exist, so it ends for that reason instead.)
  const listener = await command(['sign-in-listen', 'flow_none', '--json']);
  assert.notEqual(listener.exit, 11, listener.stdout);
  assert.doesNotMatch(listener.stdout, /UPDATE_REQUIRED/);
});
