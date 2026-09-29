import assert from 'node:assert/strict';
import { existsSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { PassThrough } from 'node:stream';
import { test } from 'node:test';
import { EXIT_CODES, gatedChange, UPDATE_FIRST, updateCheckPath, updateLaterChange } from '@agentcomms/core';
import { Client } from '@modelcontextprotocol/client';
import { InMemoryTransport } from '@modelcontextprotocol/server';
import { run } from '../src/cli/program.ts';
import { createSlackMcpServer } from '../src/mcp/server.ts';
import type { FileDownloader, FileDownloadResult } from '../src/operations/files.ts';
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

test('an approval the stop let through is refused by a report, the steps, the app step and a finish: nothing is shown or collected', async () => {
  /*
   * "Not now" — waiting, a change — lets a call past the stop, and an agent that was stopped can have it prepared
   * without the person. Each of these took the id and claimed none: they answered as though it were not there, past
   * the stop. Now each refuses it as usage, on both surfaces, before it reads or collects anything.
   */
  const harness = await newHarness();
  // `read`, and its app never asked for posting; and one that posts. Each with the port it last signed in with.
  await harness.addWorkspace({ alias: 'acme', redirectPort: 51234 });
  await harness.addWorkspace({ alias: 'beta', mode: 'send', workspaceId: 'T0002', redirectPort: 51235 });
  const later = await heldApproval(harness);
  updateOut(harness);
  const before = JSON.stringify(await harness.core.config.load());

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
    for (const [what, tool, args, words] of [
      ['the report', 'slack_mode_set', { workspace: 'acme', mode: 'read' }, /only reports acme's mode/],
      ['the steps to read', 'slack_mode_set', { workspace: 'beta', mode: 'read' }, /changes nothing here/],
      ['the app step', 'slack_mode_set', { workspace: 'acme', mode: 'send' }, /has to ask for the send scopes first/],
      ['the policy report', 'slack_workspace_policy', { workspace: 'acme' }, /an approval goes with a policy to set/],
    ] as const) {
      const result = await call(tool, { ...args, approvalId: later });
      assert.equal(code(result), 'USAGE', `${what}: ${JSON.stringify(result.structuredContent)}`);
      assert.match(text(result), words, what);
      assert.doesNotMatch(text(result), /"manifest"|"steps"|"sendPolicy"/, `${what} was answered`);
    }
  } finally {
    await Promise.all([client.close(), server.close()]);
  }

  const command = async (argv: string[]) => {
    let stdout = '';
    const out = new PassThrough();
    out.on('data', (chunk) => {
      stdout += String(chunk);
    });
    const exit = await run([...argv, '--approval', later, '--json'], {
      core: harness.core,
      env: harness.env,
      streams: { stdout: out, stderr: new PassThrough(), stdin: new PassThrough() },
      openBrowser: () => undefined,
      probe: (input, init) => harness.probe(input, init),
      read: refuseEverything,
    });
    return { exit, stdout };
  };
  for (const [argv, words] of [
    [['workspace', 'mode', 'acme'], /only reports acme's mode/],
    [['workspace', 'mode', 'beta', 'read'], /changes nothing here/],
    [['workspace', 'mode', 'acme', 'send'], /has to ask for the send scopes first/],
    [['workspace', 'policy', 'acme'], /an approval goes with a policy to set/],
    [['workspace', 'add', '--finish', 'sfl_none'], /--finish collects a sign-in already started/],
    [['workspace', 'reauth', 'acme', '--finish', 'sfl_none'], /--finish collects a sign-in already started/],
  ] as const) {
    const refused = await command([...argv]);
    assert.equal(refused.exit, EXIT_CODES.USAGE, `${argv.join(' ')}: ${refused.stdout}`);
    const error = (JSON.parse(refused.stdout) as { error: { code: string; message: string } }).error;
    assert.equal(error.code, 'USAGE', argv.join(' '));
    assert.match(error.message, words, argv.join(' '));
  }

  assert.equal(JSON.stringify(await harness.core.config.load()), before, 'a workspace was changed');
  assert.equal((await harness.core.approvals.get(later))?.state, 'pending', 'the approval was claimed');
});

// ── Saving files: `slack_file_download` and `agent-slack files download` ─────────────────────────────────────────

/*
 * The download is the one Slack surface that writes to this machine, so it is held to the stop by name rather than
 * left to "every tool registered after the gate" and "every command that runs through `act`". Each case counts what
 * reached Slack, what reached the file transport and what reached the disk: a stop that answered correctly after the
 * download had begun would pass a test that read only the answer.
 */

const FILE_ID = 'F0AAA1';

/** Slack, as far as one file by id needs it, recording each method it is asked; never the real one. */
function slackForOneFile() {
  const asked: string[] = [];
  const fetch = async (input: string | URL | Request, _init?: RequestInit) => {
    const url = String(input instanceof Request ? input.url : input);
    const method = url.split('/api/')[1]?.split('?')[0] ?? '';
    asked.push(method);
    const replies: Record<string, unknown> = {
      'files.info': {
        ok: true,
        file: {
          id: FILE_ID,
          name: 'numbers.pdf',
          title: 'Numbers',
          mimetype: 'application/pdf',
          user: 'U0001',
          url_private_download: `https://files.slack.com/files-pri/T0001-${FILE_ID}/download/numbers.pdf`,
          shares: { public: { C0AAA1: [{ ts: '1700000000.000100' }] } },
        },
      },
      'users.info': { ok: true, user: { id: 'U0001', profile: { display_name: 'sam' } } },
    };
    return new Response(JSON.stringify(replies[method] ?? { ok: false, error: 'unknown_method' }));
  };
  return { fetch, asked };
}

/** The file transport's stand-in: the bytes of the one file, recording each file asked for. */
function fileTransport() {
  const asked: string[] = [];
  const download: FileDownloader = async (_call, request) => {
    asked.push(request.fileId);
    return { bytes: Buffer.from('%PDF-1.4 numbers'), contentType: 'application/pdf' };
  };
  return { download, asked };
}

/**
 * A harness with a workspace, and a downloads folder of its own in the config.
 *
 * Not `core.paths.downloadsDir`: on Windows that is under USERPROFILE, which the harness does not set, so it is the
 * runner's own Downloads folder — shared with every other test file running beside this one, and never emptied — and
 * "nothing was saved" would read their files.
 */
async function downloadHarness(): Promise<{ harness: Harness; root: string }> {
  const harness = await newHarness();
  await harness.addWorkspace({ alias: 'acme' });
  const root = join(harness.configDir, 'downloads');
  await harness.core.config.update((config) => ({ ...config, defaults: { ...config.defaults, downloadsDir: root } }), {
    consent: { kind: 'loosening-consent', paths: ['defaults.downloadsDir'] },
  });
  return { harness, root };
}

/** Everything under a downloads root, as paths below it: empty when nothing was ever written there. */
function saved(root: string): string[] {
  return existsSync(root) ? (readdirSync(root, { recursive: true }) as string[]).sort() : [];
}

async function downloadAudits(harness: Harness): Promise<number> {
  const records = await harness.core.audit.tail({ limit: 50 });
  return records.filter((record) => record.operation === 'files.download').length;
}

/** The check's file as a check that could not reach the registry leaves it: asked today, nothing learnt. */
function offline(harness: Harness): void {
  harness.env.AGENT_COMMS_UPDATE_CHECK = 'on';
  harness.env.npm_config_registry = 'http://127.0.0.1:9/';
  const stateDir = harness.core.paths.stateDir;
  mkdirSync(stateDir, { recursive: true });
  writeFileSync(
    updateCheckPath(stateDir),
    JSON.stringify({
      lastChecked: new Date().toISOString(),
      latest: null,
      behind: null,
      current: null,
      lastError: 'http://127.0.0.1:9 could not be reached (ECONNREFUSED)',
    }),
  );
}

/**
 * The ways past the stop that are not an update. "Not now" is written an hour ahead rather than at the midnight the
 * product writes, so a run that crosses midnight cannot see it run out; the gate reads only whether it is still ahead.
 */
const WAYS_PAST: readonly { label: string; apply: (harness: Harness) => Promise<void> | void }[] = [
  {
    label: 'not now',
    apply: (harness) => {
      updateOut(harness);
      writeFileSync(
        updateCheckPath(harness.core.paths.stateDir),
        JSON.stringify({
          lastChecked: new Date().toISOString(),
          latest: '99.0.0',
          behind: true,
          current: null,
          snoozedUntil: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
        }),
      );
    },
  },
  {
    label: 'switched off for the process',
    apply: (harness) => {
      updateOut(harness);
      harness.env.AGENT_COMMS_UPDATE_CHECK = 'off';
    },
  },
  {
    label: 'turned off for the machine',
    apply: async (harness) => {
      updateOut(harness);
      await harness.core.config.update(
        (config) => ({ ...config, defaults: { ...config.defaults, updateCheck: 'off' } }),
        { consent: { kind: 'loosening-consent', paths: ['defaults.updateCheck'] } },
      );
    },
  },
  {
    label: 'CI',
    apply: (harness) => {
      updateOut(harness);
      harness.env.CI = 'true';
    },
  },
  { label: 'offline', apply: offline },
];

async function downloadOverMcp(harness: Harness, args: Record<string, unknown> = {}) {
  const slack = slackForOneFile();
  const transport = fileTransport();
  const { server } = await createSlackMcpServer({
    core: harness.core,
    env: harness.env,
    fetch: slack.fetch,
    fileDownload: transport.download,
  });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 'test', version: '0' });
  await Promise.all([client.connect(clientTransport), server.connect(serverTransport)]);
  try {
    const result = (await client.callTool({
      name: 'slack_file_download',
      arguments: { workspace: 'acme', fileIds: [FILE_ID], ...args },
    })) as ToolResult;
    return { result, slack: slack.asked, transport: transport.asked };
  } finally {
    await Promise.all([client.close(), server.close()]);
  }
}

/** The command with no terminal on any end, as a script or an agent's shell runs it. */
async function downloadAtCommand(harness: Harness, extra: string[] = [], options: { json?: boolean } = {}) {
  const slack = slackForOneFile();
  const transport = fileTransport();
  let stdout = '';
  let stderr = '';
  const out = new PassThrough();
  out.on('data', (chunk) => {
    stdout += String(chunk);
  });
  const err = new PassThrough();
  err.on('data', (chunk) => {
    stderr += String(chunk);
  });
  const argv = [
    ...(options.json === false ? [] : ['--json']),
    ...['files', 'download', '--workspace', 'acme', '--file', FILE_ID],
    ...extra,
  ];
  const exit = await run(argv, {
    core: harness.core,
    env: harness.env,
    streams: {
      stdout: Object.assign(out, { isTTY: false }),
      stderr: Object.assign(err, { isTTY: false }),
      stdin: Object.assign(new PassThrough(), { isTTY: false }),
    },
    openBrowser: () => undefined,
    probe: (input, init) => harness.probe(input, init),
    read: slack.fetch,
    fileDownload: transport.download,
  });
  return { exit, stdout, stderr, slack: slack.asked, transport: transport.asked };
}

test('slack_file_download: an update that is out answers "Hang on a minute" and saves nothing — no Slack, no transport, no disk', async () => {
  const { harness, root } = await downloadHarness();
  updateOut(harness);
  const { result, slack, transport } = await downloadOverMcp(harness);
  assert.equal(result.isError, true, JSON.stringify(result.structuredContent));
  assert.equal(code(result), 'UPDATE_REQUIRED', JSON.stringify(result.structuredContent));
  assert.ok(text(result).startsWith("Hang on a minute, there's an update. Let's update first."), text(result));
  assert.match(text(result), /This is agent-slack /);
  assert.match(text(result), /slack_file_download did not run/);
  const error = (result.structuredContent as { error: { message: string; details: Record<string, unknown> } }).error;
  assert.ok(error.message.startsWith(UPDATE_FIRST), 'the structured content carries the same words');
  assert.equal(error.details.tool, 'slack_file_download');
  assert.equal(error.details.server, 'agent-slack');
  assert.deepEqual(slack, [], 'Slack was asked about the file');
  assert.deepEqual(transport, [], 'the file was fetched');
  assert.deepEqual(saved(root), [], 'something was written under the downloads root');
  assert.equal(await downloadAudits(harness), 0, 'a download was audited');
});

test('agent-slack files download: with no terminal an update that is out exits 11 and writes nothing', async () => {
  for (const json of [true, false]) {
    const label = json ? '--json' : 'plain';
    const { harness, root } = await downloadHarness();
    updateOut(harness);
    const stopped = await downloadAtCommand(harness, [], { json });
    assert.equal(stopped.exit, EXIT_CODES.UPDATE, `${label}: ${stopped.stdout}${stopped.stderr}`);
    assert.equal(stopped.exit, 11);
    if (json) {
      const error = (JSON.parse(stopped.stdout) as { error: { code: string; message: string } }).error;
      assert.equal(error.code, 'UPDATE_REQUIRED');
      assert.ok(error.message.startsWith(UPDATE_FIRST), error.message);
      assert.match(error.message, /`agentcomms update`/);
      assert.match(error.message, /`agentcomms update --later`/);
    } else {
      assert.ok(stopped.stderr.includes(UPDATE_FIRST), `${label}: ${stopped.stderr}`);
      assert.doesNotMatch(stopped.stdout, /numbers|F0AAA1/, `${label}: the command reported a download`);
    }
    assert.deepEqual(stopped.slack, [], `${label}: Slack was asked about the file`);
    assert.deepEqual(stopped.transport, [], `${label}: the file was fetched`);
    assert.deepEqual(saved(root), [], `${label}: something was written under the downloads root`);
    assert.equal(await downloadAudits(harness), 0, `${label}: a download was audited`);
  }
});

/** Whether a saved file is on disk, inside this harness's downloads root. */
function savedInside(root: string, path: string | undefined): boolean {
  if (path === undefined || !existsSync(path)) return false;
  const below = relative(root, path);
  return below !== '' && !below.startsWith('..') && !below.includes(':');
}

test('the download goes ahead when the update is put off, switched off, turned off, in CI or offline — over MCP and at the command', async () => {
  for (const { label, apply } of WAYS_PAST) {
    // Over MCP. The same call is stopped first, so what lets it through is the way past and nothing else; offline
    // has no update out to be stopped for.
    const tool = await downloadHarness();
    if (label !== 'offline') {
      updateOut(tool.harness);
      const control = await downloadOverMcp(tool.harness);
      assert.equal(code(control.result), 'UPDATE_REQUIRED', `${label}: the control call was not stopped`);
    }
    await apply(tool.harness);
    const passed = await downloadOverMcp(tool.harness);
    assert.notEqual(passed.result.isError, true, `${label}: ${JSON.stringify(passed.result.structuredContent)}`);
    const result = passed.result.structuredContent as unknown as FileDownloadResult;
    assert.equal(result.files.length, 1, `${label}: ${JSON.stringify(result)}`);
    assert.ok(savedInside(tool.root, result.files[0]?.path), `${label}: the saved file is not on disk`);
    assert.deepEqual(passed.transport, [FILE_ID], `${label}: the file was not fetched over MCP`);

    // At the command, with no terminal: exit 0 and the file on disk, where the same command was stopped first.
    const command = await downloadHarness();
    if (label !== 'offline') {
      updateOut(command.harness);
      const control = await downloadAtCommand(command.harness);
      assert.equal(control.exit, 11, `${label}: the control command was not stopped`);
    }
    await apply(command.harness);
    const ran = await downloadAtCommand(command.harness);
    assert.equal(ran.exit, EXIT_CODES.OK, `${label}: ${ran.stdout}${ran.stderr}`);
    const data = (JSON.parse(ran.stdout) as { data: FileDownloadResult }).data;
    assert.equal(data.files.length, 1, `${label}: ${ran.stdout}`);
    assert.ok(savedInside(command.root, data.files[0]?.path), `${label}: the saved file is not on disk`);
    assert.deepEqual(ran.transport, [FILE_ID], `${label}: the file was not fetched at the command`);
  }
});

test('the download takes no approval, so one it claims is refused as usage and cannot walk it past the stop', async () => {
  // The stop lets through a call carrying an approval this machine holds (§2). A download needs no approval and
  // declares none: `approvalId` on the tool, or `--approval` on the command, is refused before the gate is asked — so
  // even a real one opens nothing here, and the download stays stopped until the update or "not now".
  const { harness, root } = await downloadHarness();
  const approvalId = await heldApproval(harness);
  updateOut(harness);

  const tool = await downloadOverMcp(harness, { approvalId });
  assert.equal(code(tool.result), 'USAGE', JSON.stringify(tool.result.structuredContent));
  assert.match(text(tool.result), /does not take `approvalId`/);
  assert.deepEqual([...tool.slack, ...tool.transport], [], 'the claimed approval reached Slack or the transport');

  const command = await downloadAtCommand(harness, ['--approval', approvalId]);
  assert.equal(command.exit, EXIT_CODES.USAGE, `${command.stdout}${command.stderr}`);
  assert.deepEqual([...command.slack, ...command.transport], [], 'the claimed approval reached Slack or the transport');

  assert.deepEqual(saved(root), [], 'something was written under the downloads root');
  assert.equal(await downloadAudits(harness), 0, 'a download was audited');
});
