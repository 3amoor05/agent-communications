import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PassThrough } from 'node:stream';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/client';
import { InMemoryTransport } from '@modelcontextprotocol/server';
import {
  commandEndingWith,
  environmentAssignments,
  FOUR_FOLDERS,
  freshShell,
  isCanonical,
  NEEDS_TERMINAL,
  PATH_OPTIONS,
  pinsOf,
  posixShellAsync,
  posixTerminalAsync,
  real,
  type Shell,
  sealAttempts,
  suiteCommandsOn,
  suiteTraces,
  windowsShells,
  wordsOf,
} from '../../../test/helpers/real-shell.mjs';
import { run } from '../src/cli/program.ts';
import { createSlackMcpServer } from '../src/mcp/server.ts';
import { type FakeSlack, startFakeSlack } from './support/fake-slack.ts';
import { type Harness, newHarness } from './support/harness.ts';

/*
 * Slack's terminal approval pasted into a real shell (CUE-403; design 2026-10-04 §4 item 8). A harmless change —
 * loosening how a workspace's posts are approved — is prepared at Slack's CLI and through its server, in this process,
 * against the loopback fake Slack, which records every request. The approve command each gives is Slack's own, as this
 * checkout runs it: this Node, type stripping and `src/cli.ts`, with the harness's folders pinned. A person pastes it
 * into a fresh shell with a terminal (`test/helpers/real-shell.mjs`): no suite command on PATH, every suite variable a
 * decoy, another working folder, and a seal that refuses the keychain and every connection off the machine. No post,
 * no reaction and no request at all reaches Slack.
 */

const SLACK_CLI = real(fileURLToPath(new URL('../src/cli.ts', import.meta.url)));
const SOURCE_FLAGS = ['--experimental-strip-types'];

interface Machine {
  harness: Harness;
  slack: FakeSlack;
  cli(argv: readonly string[]): Promise<{ code: number; stdout: string; stderr: string }>;
}

/** A workspace that can post under `confirm`, changes approved under `confirm`, and the fake Slack it would reach. */
async function machine(): Promise<Machine> {
  const harness = await newHarness();
  await harness.addWorkspace({ alias: 'acme', mode: 'send', sendPolicy: 'confirm' });
  // Slack would take a post — and none is ever made.
  const slack = await startFakeSlack({ 'chat.postMessage': () => ({ ok: true, ts: '1700000000.000100' }) });
  const cli = async (argv: readonly string[]) => {
    let stdout = '';
    let stderr = '';
    const out = new PassThrough();
    const err = new PassThrough();
    const input = new PassThrough();
    input.end();
    out.on('data', (chunk) => {
      stdout += String(chunk);
    });
    err.on('data', (chunk) => {
      stderr += String(chunk);
    });
    const code = await run([...argv], {
      core: harness.core,
      env: harness.env,
      platform: process.platform,
      exchange: (params) => harness.exchange(params),
      streams: {
        stdout: Object.assign(out, { isTTY: false }),
        stderr: Object.assign(err, { isTTY: false }),
        stdin: Object.assign(input, { isTTY: false }),
      },
      openBrowser: () => undefined,
      probe: slack.fetch,
      read: slack.fetch,
    });
    return { code, stdout, stderr };
  };
  const machine = { harness, slack, cli };
  const tightened = await cli(['workspace', 'policy', 'acme', '--change', 'confirm']);
  assert.equal(tightened.code, 0, tightened.stderr);
  return machine;
}

function shellFor(m: Machine, name: string): Shell {
  const shell = freshShell(join(m.harness.home, 'shells', name));
  assert.deepEqual(suiteCommandsOn(shell.env.PATH), [], 'no suite command on the fresh shell’s PATH');
  return shell;
}

/** Nothing of the shell's reached a keychain or left the machine, no decoy was used, and Slack was asked nothing. */
function assertClean(m: Machine, shell: Shell): void {
  assert.deepEqual(sealAttempts(shell.sealLog), [], 'no keychain and no connection off the machine');
  assert.deepEqual(suiteTraces(shell), [], 'no suite folder found from the shell’s environment');
  assert.deepEqual(
    m.slack.requests.map((request) => request.method),
    [],
    'no post, no reaction, no request at all reached Slack',
  );
}

/** Slack's own command, as this checkout runs it, pinned to exactly the harness's four folders, then `tail`. */
function assertSlackCommand(command: string, m: Machine, tail: readonly string[]): void {
  const words = wordsOf(command);
  assert.ok(words !== null, `a line to paste: ${command}`);
  assert.deepEqual(words.slice(0, 3), [process.execPath, ...SOURCE_FLAGS, SLACK_CLI], command);
  const pins = pinsOf(words);
  assert.deepEqual(Object.keys(pins).sort(), [...FOUR_FOLDERS].sort(), command);
  for (const key of FOUR_FOLDERS) {
    assert.equal(pins[key], m.harness.core.paths[key], `${PATH_OPTIONS[key]}: ${command}`);
    assert.ok(isCanonical(pins[key] as string), command);
  }
  assert.deepEqual(words.slice(3 + FOUR_FOLDERS.length * 2), tail, command);
}

/** Every audit record in the harness's state. */
function audit(m: Machine): Array<Record<string, unknown>> {
  const dir = join(m.harness.core.paths.stateDir, 'audit');
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((file) => file.endsWith('.jsonl'))
    .flatMap((file) => readFileSync(join(dir, file), 'utf8').split('\n'))
    .filter(Boolean)
    .map((line) => JSON.parse(line) as Record<string, unknown>);
}

/**
 * Pastes `approve` where a person would: a terminal of their own on POSIX, the code typed back. Windows gives a test no
 * terminal, so there each shell runs it and it refuses for want of one — against the harness's own approval store.
 */
async function personApproves(m: Machine, approve: string, id: string, shell: Shell): Promise<boolean> {
  if (process.platform === 'win32') {
    for (const each of windowsShells()) {
      const result = each.run(approve, { env: shell.env, cwd: shell.cwd });
      assert.match(`${result.stdout}${result.stderr}`, /needs an interactive terminal/, each.name);
    }
    assert.ok(audit(m).some((record) => record.approvalId === id && record.outcome === 'refused'));
    return false;
  }
  assertSlackCommand(approve, m, ['approve', id]);
  if (NEEDS_TERMINAL.skip !== undefined) return false;
  const approved = await posixTerminalAsync(approve, shell);
  assert.equal(approved.status, 0, approved.stdout);
  assert.match(approved.stdout, /Approved/);
  return true;
}

test('a Slack change prepared at the CLI is approved with Slack’s own command at a fresh terminal and run again from a fresh shell; Slack is asked nothing (8a, 8c, 8d)', async (t) => {
  const m = await machine();
  t.after(() => m.slack.close());
  const prepared = await m.cli(['--json', 'workspace', 'policy', 'acme', '--send', 'chat']);
  assert.equal(prepared.code, 10, prepared.stdout);
  const { error } = JSON.parse(prepared.stdout) as { error: { hint: string; details: { approvalId: string } } };
  const id = error.details.approvalId;
  assert.deepEqual(environmentAssignments(error.hint), []);
  const approve = commandEndingWith(error.hint, ['approve', id]);
  const tail = ['workspace', 'policy', 'acme', '--send', 'chat', '--approval', id];
  const rerun = commandEndingWith(error.hint, tail);

  const person = shellFor(m, 'person');
  if (await personApproves(m, approve, id, person)) {
    assertSlackCommand(rerun, m, tail);
    const agent = shellFor(m, 'agent');
    const applied = await posixShellAsync(rerun, agent);
    assert.equal(applied.status, 0, `${applied.stdout}\n${applied.stderr}`);
    assert.equal((await m.harness.core.config.load()).accounts.acme?.sendPolicy, 'chat');
    assertClean(m, agent);
  }
  assertClean(m, person);
});

test('a Slack change prepared through Slack’s server is approved at a fresh terminal, and the server applies it in the same store (8a, 8c, 8d)', async (t) => {
  const m = await machine();
  t.after(() => m.slack.close());
  const { server } = await createSlackMcpServer({
    core: m.harness.core,
    env: m.harness.env,
    exchange: (params) => m.harness.exchange(params),
    fetch: m.slack.fetch,
    platform: process.platform,
  });
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 'cue-403-real-shell', version: '0' });
  await Promise.all([client.connect(clientSide), server.connect(serverSide)]);
  t.after(() => Promise.all([client.close(), server.close()]));
  const call = async (args: Record<string, unknown>) =>
    (await client.callTool({ name: 'slack_workspace_policy', arguments: args })).structuredContent as Record<
      string,
      unknown
    >;

  const asked = await call({ workspace: 'acme', sendPolicy: 'chat' });
  assert.equal(asked.approvalRequired, true, JSON.stringify(asked));
  const id = String(asked.approvalId);
  const said = Object.values(asked)
    .filter((value): value is string => typeof value === 'string')
    .join('\n');
  assert.deepEqual(environmentAssignments(said), []);
  const approve = commandEndingWith(said, ['approve', id]);

  const person = shellFor(m, 'person');
  if (await personApproves(m, approve, id, person)) {
    const applied = await call({ workspace: 'acme', sendPolicy: 'chat', approvalId: id });
    assert.equal(applied.applied, true, JSON.stringify(applied));
    assert.equal((await m.harness.core.config.load()).accounts.acme?.sendPolicy, 'chat');
  }
  assertClean(m, person);
});
