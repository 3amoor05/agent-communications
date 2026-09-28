import assert from 'node:assert/strict';
import { existsSync, symlinkSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { managedRuntimeDir, managedRuntimeEntry } from '@agentcomms/core';
import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';
import { GmailContext } from '../src/context.ts';
import { clientAdd } from '../src/operations/clients.ts';
import { VERSION } from '../src/version.ts';
import { type Harness, newHarness, TEST_CLIENT_ID, TEST_CLIENT_SECRET, tempDir } from './support/harness.ts';
import {
  applied,
  approvalAsked,
  type CliRun,
  cli,
  connect,
  pendingApproval,
  type ToolResult,
  toolError,
  wire,
} from './support/surfaces.ts';

/*
 * Registering the Gmail server, and removing its old runtimes, are changes a person approves (design 2026-09-25
 * §3.1) — whichever surface asks. `comms_server_install` and `comms_server_prune` on the core server always asked;
 * `agent-gmail mcp install`, `mcp prune` and `setup --mcp-client` did not, so an agent could register a server by
 * picking the command over the tool. They are now the same change, and these tests hold them to it: the same
 * preview, one approval good on either surface, and nothing written before it is claimed.
 *
 * Nothing here reaches npm, a real client config or the keychain: every client config is under a temporary home, the
 * `npx` launcher only names a package that nothing runs (`--no-verify`), and a managed runtime is laid out by hand.
 */

/**
 * A harness with one mailbox, and a home of its own for the client configs — Windows' too, which are found through
 * `APPDATA` rather than the home.
 */
async function machine(): Promise<{ harness: Harness; home: string; env: NodeJS.ProcessEnv }> {
  const harness = await newHarness({ accounts: [{ sub: 'sub-1', email: 'jo@example.test' }] });
  await harness.addInbox({ alias: 'work', email: 'jo@example.test', sub: 'sub-1', refreshToken: 'rt_x' });
  const home = tempDir();
  return {
    harness,
    home,
    env: {
      HOME: home,
      USERPROFILE: home,
      APPDATA: join(home, 'AppData', 'Roaming'),
      LOCALAPPDATA: join(home, 'AppData', 'Local'),
    },
  };
}

/**
 * The core MCP server, started as a client starts it — `agentcomms mcp`, from the core this package is built
 * against — over stdio, with this harness's configuration and the same home. Its data directory is the harness's, so
 * a runtime one surface finds is the one the other finds.
 *
 * Its environment is pinned whole. The transport adds `PATH` and `HOME` from the process running the tests — and
 * `APPDATA` on Windows, where a client's config is found through it — unless they are given, so they are: the home is
 * the test's, and `PATH` holds only `ps`, which `prune` needs to see what is running and nothing else it could start.
 */
async function coreServer(harness: Harness, env: NodeJS.ProcessEnv) {
  const coreCli = join(dirname(fileURLToPath(import.meta.resolve('@agentcomms/core'))), 'cli.mjs');
  const bin = tempDir();
  const ps = ['/bin/ps', '/usr/bin/ps'].find((path) => existsSync(path));
  if (ps) symlinkSync(ps, join(bin, 'ps'));
  const serverEnv: Record<string, string> = {};
  for (const [key, value] of Object.entries({
    ...harness.env,
    ...env,
    PATH: bin,
    AGENT_COMMS_DATA_DIR: harness.core.paths.dataDir,
  })) {
    if (value !== undefined) serverEnv[key] = value;
  }
  const client = new Client({ name: 'registration-test', version: '0' });
  await client.connect(
    new StdioClientTransport({ command: process.execPath, args: [coreCli, 'mcp'], env: serverEnv, stderr: 'ignore' }),
  );
  return {
    call: async (name: string, args: Record<string, unknown>) =>
      (await client.callTool({ name, arguments: args })) as ToolResult,
    close: () => client.close(),
  };
}

/** The preview without its first line, which names the approval: what two approvals for one change share. */
const body = (preview: string) => preview.split('\n').slice(1).join('\n');

/** A managed runtime of this release, laid out as the installer leaves one, so registering it fetches nothing. */
async function readyRuntime(harness: Harness): Promise<string> {
  const { dataDir } = harness.core.paths;
  const root = managedRuntimeDir(dataDir, '@agentcomms/gmail', VERSION);
  const entry = managedRuntimeEntry(dataDir, '@agentcomms/gmail', VERSION);
  await mkdir(dirname(entry), { recursive: true });
  await writeFile(entry, '');
  await writeFile(join(root, 'package.json'), JSON.stringify({ dependencies: { '@agentcomms/gmail': VERSION } }));
  await writeFile(
    join(root, 'node_modules', '@agentcomms', 'gmail', 'package.json'),
    JSON.stringify({ name: '@agentcomms/gmail', version: VERSION }),
  );
  return entry;
}

const envelopeError = (run: CliRun) => run.envelope().error;

test('an approval from comms_server_install registers from `agent-gmail mcp install --approval`, and the other way round', async () => {
  const { harness, home, env } = await machine();
  const server = await coreServer(harness, env);
  try {
    // ── Prepared in chat, claimed at the command line ──
    const request = {
      channel: 'gmail',
      client: 'cursor',
      launcher: 'npx',
      inbox: 'work',
      readOnly: true,
      noVerify: true,
    };
    const command = [
      'mcp',
      'install',
      '--client',
      'cursor',
      '--launcher',
      'npx',
      '--inbox',
      'work',
      '--read-only',
      '--no-verify',
      '--json',
    ];
    const cursor = join(home, '.cursor', 'mcp.json');

    const fromChat = approvalAsked(await server.call('comms_server_install', request));
    assert.match(
      fromChat.preview,
      /registers the Gmail MCP server with cursor as "gmail", pinned to the mailbox work, read-only/,
    );
    assert.match(fromChat.preview, new RegExp(`fetch @agentcomms/gmail-mcp@${VERSION.replaceAll('.', '\\.')}`));
    // The command, asked the same thing, says the same thing: the approval is bound to these words.
    const fromCommand = await cli(harness, command, { env });
    assert.equal(body(String(envelopeError(fromCommand)?.details?.preview)), body(fromChat.preview));
    assert.equal(existsSync(cursor), false, 'nothing is written while it is only asked');

    // For other arguments — the same server without `--read-only` — the approval is not the command's to claim.
    const narrower = approvalAsked(await server.call('comms_server_install', request));
    const wider = await cli(
      harness,
      [...command.filter((word) => word !== '--read-only'), '--approval', narrower.approvalId],
      { env },
    );
    assert.equal(envelopeError(wider)?.code, 'APPROVAL_VOID', wider.stdout);
    assert.equal(existsSync(cursor), false, 'a refused claim writes nothing');

    const claimed = await cli(harness, [...command, '--approval', fromChat.approvalId], { env });
    assert.equal(claimed.code, 0, claimed.stdout);
    const result = claimed.envelope<{ applied: boolean; restart: string }>().data;
    assert.equal(result?.applied, true);
    assert.match(String(result?.restart), /Restart cursor/);
    const written = JSON.parse(await readFile(cursor, 'utf8')) as { mcpServers: { gmail: { args: string[] } } };
    assert.deepEqual(written.mcpServers.gmail.args, [
      '-y',
      `@agentcomms/gmail-mcp@${VERSION}`,
      '--inbox',
      'work',
      '--read-only',
    ]);

    // ── Prepared at the command line, claimed in chat — with the default launcher, whose runtime is here ──
    const runtime = await readyRuntime(harness);
    const gemini = join(home, '.gemini', 'settings.json');
    const asked = await cli(harness, ['mcp', 'install', '--client', 'gemini', '--no-verify', '--json'], { env });
    const approvalId = pendingApproval(asked);
    assert.match(
      String(envelopeError(asked)?.details?.preview),
      /registers the Gmail MCP server with gemini as "gmail"/,
    );
    assert.equal(existsSync(gemini), false);

    const done = applied<{ applied: boolean }>(
      await server.call('comms_server_install', { channel: 'gmail', client: 'gemini', noVerify: true, approvalId }),
    );
    assert.equal(done.applied, true);
    const settings = JSON.parse(await readFile(gemini, 'utf8')) as { mcpServers: { gmail: { args: string[] } } };
    assert.deepEqual(settings.mcpServers.gmail.args, [runtime, 'mcp']);

    // Spent: the same approval registers nothing a second time, from either surface.
    const again = await cli(
      harness,
      ['mcp', 'install', '--client', 'gemini', '--no-verify', '--force', '--json', '--approval', approvalId],
      {
        env,
      },
    );
    assert.notEqual(again.code, 0, again.stdout);
    assert.ok(
      toolError(
        await server.call('comms_server_install', {
          channel: 'gmail',
          client: 'gemini',
          noVerify: true,
          force: true,
          approvalId,
        }),
      ),
    );
  } finally {
    await server.close();
  }
});

test('a person at the terminal approves a registration there and then, having read what it does', async () => {
  const { harness, home, env } = await machine();
  const run = await cli(harness, ['mcp', 'install', '--client', 'cursor', '--launcher', 'npx', '--no-verify'], {
    env,
    tty: true,
    answer: true,
  });
  assert.equal(run.code, 0, `${run.stdout}${run.stderr}`);
  assert.match(run.stdout, /CHANGE PREVIEW[\s\S]*registers the Gmail MCP server with cursor/, 'shown before asked');
  assert.match(run.stderr, /Type yes to apply this change/);
  assert.ok(existsSync(join(home, '.cursor', 'mcp.json')));

  // An agent holding a terminal is not a person at it: it gets the preview and the id, and nothing is written.
  const other = await machine();
  const agent = await cli(other.harness, ['mcp', 'install', '--client', 'cursor', '--launcher', 'npx', '--no-verify'], {
    env: { ...other.env, CLAUDECODE: '1' },
    tty: true,
    answer: true,
  });
  assert.equal(agent.code, 10, `${agent.stdout}${agent.stderr}`);
  assert.match(agent.stderr, /--approval ap_/);
  assert.equal(existsSync(join(other.home, '.cursor', 'mcp.json')), false);
});

test('printing an entry, or `--client json`, writes nothing and so asks nobody', async () => {
  const { harness, home, env } = await machine();
  for (const argv of [
    ['mcp', 'install', '--client', 'cursor', '--launcher', 'npx', '--no-verify', '--print', '--json'],
    ['mcp', 'install', '--client', 'json', '--launcher', 'npx', '--no-verify', '--json'],
  ]) {
    const run = await cli(harness, argv, { env });
    assert.equal(run.code, 0, `${argv.join(' ')}: ${run.stdout}`);
    assert.equal(run.envelope<{ applied: boolean }>().data?.applied, false);
  }
  assert.deepEqual(await harness.core.approvals.list(), [], 'no approval was made');
  assert.equal(existsSync(join(home, '.cursor', 'mcp.json')), false);
});

test('`setup --mcp-client` stops for approval without registering, and only `--mcp-approval` carries it', async () => {
  const { harness, home, env } = await machine();
  const cursor = join(home, '.cursor', 'mcp.json');
  const argv = ['setup', '--mcp-client', 'cursor', '--launcher', 'local', '--json'];

  const first = await cli(harness, argv, { env });
  assert.equal(first.code, 10, `a registration nobody approved must not exit 0: ${first.stdout}`);
  const report = first.envelope<{
    did: string[];
    blocked: { step: string; needs: string; approvalId: string; preview: string; hint: string };
  }>().data;
  assert.equal(report?.blocked.step, 'mcp');
  assert.match(String(report?.blocked.preview), /registers the Gmail MCP server with cursor as "gmail"/);
  assert.match(
    String(report?.blocked.hint),
    new RegExp(
      `agent-gmail setup --mcp-client cursor --launcher local --json --mcp-approval ${report?.blocked.approvalId}\``,
    ),
  );
  assert.deepEqual(report?.did, []);
  assert.equal(existsSync(cursor), false, 'nothing was registered');

  // `--approval` is the OAuth client's: handed the registration's id, it registers nothing, and asks again.
  const wrongFlag = await cli(harness, [...argv, '--approval', String(report?.blocked.approvalId)], { env });
  assert.equal(wrongFlag.code, 10, wrongFlag.stdout);
  const asked = wrongFlag.envelope<{ blocked: { approvalId: string } }>().data?.blocked.approvalId;
  assert.notEqual(asked, report?.blocked.approvalId, 'a new approval, for the change the flag did not carry');
  assert.equal(existsSync(cursor), false);

  const done = await cli(harness, [...argv, '--mcp-approval', String(report?.blocked.approvalId)], { env });
  assert.equal(done.code, 0, done.stdout);
  assert.ok(done.envelope<{ did: string[] }>().data?.did.includes('registered the server with cursor'));
  assert.ok(existsSync(cursor));

  // Read by a person, the report says what they are agreeing to and what to run once they have.
  const other = await machine();
  const plain = await cli(other.harness, ['setup', '--mcp-client', 'cursor', '--launcher', 'local'], {
    env: other.env,
  });
  assert.equal(plain.code, 10, plain.stderr);
  assert.match(plain.stdout, /Stopped at: mcp/);
  assert.match(plain.stdout, /CHANGE PREVIEW[\s\S]*registers the Gmail MCP server with cursor/);
  assert.match(plain.stdout, /--mcp-approval ap_/);
});

test('an interactive setup given `--mcp-client` asks as `mcp install` does: nobody has answered anything yet', async () => {
  const argv = ['setup', '--mcp-client', 'cursor', '--launcher', 'local', '--no-browser', '--no-tui'];

  // A terminal held by an agent: the preview and the id, the flag to carry it back, and nothing registered.
  const { harness, home, env } = await machine();
  const cursor = join(home, '.cursor', 'mcp.json');
  const agentEnv = { ...env, CLAUDECODE: '1' };
  const agent = await cli(harness, argv, { env: agentEnv, tty: true, answer: true });
  assert.equal(agent.code, 10, `${agent.stdout}${agent.stderr}`);
  assert.match(agent.stdout, /registers the Gmail MCP server with cursor/);
  const id = /--mcp-approval (ap_[\w-]+)`/.exec(agent.stderr)?.[1];
  assert.ok(id, `the hint names --mcp-approval: ${agent.stderr}`);
  assert.equal(existsSync(cursor), false);

  const claimed = await cli(harness, [...argv, '--mcp-approval', id], { env: agentEnv, tty: true });
  assert.equal(claimed.code, 0, `${claimed.stdout}${claimed.stderr}`);
  assert.ok(existsSync(cursor));

  // A person at the terminal reads the preview and says yes.
  const person = await machine();
  const said = await cli(person.harness, argv, { env: person.env, tty: true, answer: true });
  assert.equal(said.code, 0, `${said.stdout}${said.stderr}`);
  assert.match(said.stdout, /CHANGE PREVIEW[\s\S]*registers the Gmail MCP server with cursor/);
  assert.ok(existsSync(join(person.home, '.cursor', 'mcp.json')));
});

test('an interactive setup that asked "Connect this to an agent?" takes the yes under chat, and the code under confirm', async () => {
  const argv = ['setup', '--launcher', 'local', '--no-browser', '--no-tui'];
  // Continue where it left off, yes to connecting an agent, then the fourth client in the list: Cursor.
  const answers = [
    [/which one\?/, '1'],
    [/Connect this to an agent\?/, 'y'],
    [/which one\?/, '4'],
  ] as const;

  // Under `chat` the answer a moment ago is the approval: nothing more is asked, and the server is registered.
  const chat = await machine();
  const said = await cli(chat.harness, argv, { env: chat.env, tty: true, replies: answers });
  assert.equal(said.code, 0, `${said.stdout}${said.stderr}`);
  assert.doesNotMatch(said.stderr, /Type yes to apply this change/, 'it asked again for what was just asked for');
  assert.ok(existsSync(join(chat.home, '.cursor', 'mcp.json')));

  // Under `confirm` a registration is approved with the code, whoever asked for it — a yes typed into a question is
  // what an agent holding a terminal could give. Enter instead of the code: nothing registered.
  const confirm = async () => {
    const m = await machine();
    await m.harness.core.config.update((c) => ({ ...c, defaults: { ...c.defaults, changePolicy: 'confirm' } }));
    return m;
  };
  const unanswered = await confirm();
  const refused = await cli(unanswered.harness, argv, {
    env: unanswered.env,
    tty: true,
    replies: [...answers, [/to approve this change/, '']],
  });
  assert.match(refused.stdout, /CHANGE PREVIEW[\s\S]*registers the Gmail MCP server with cursor/);
  assert.equal(existsSync(join(unanswered.home, '.cursor', 'mcp.json')), false, 'registered without the code');

  // And the code, typed back, registers it.
  const confirmed = await confirm();
  const typed = await cli(confirmed.harness, argv, { env: confirmed.env, tty: true, replies: answers, answer: true });
  assert.equal(typed.code, 0, `${typed.stdout}${typed.stderr}`);
  assert.ok(existsSync(join(confirmed.home, '.cursor', 'mcp.json')));
});

test(
  '`mcp prune`: a dry run is free; removing needs an approval, and removes only what it showed',
  process.platform === 'win32'
    ? { skip: 'no `ps` on Windows: prune keeps everything when it cannot list processes' }
    : {},
  async () => {
    const { harness, env } = await machine();
    const { dataDir } = harness.core.paths;
    const runtime = async (version: string) => {
      const dir = managedRuntimeDir(dataDir, '@agentcomms/gmail', version);
      await mkdir(join(dir, 'node_modules', '@agentcomms', 'gmail'), { recursive: true });
      return dir;
    };
    const old = await runtime('0.0.1');
    const current = await runtime(VERSION);

    const dry = await cli(harness, ['mcp', 'prune', '--dry-run', '--json'], { env });
    assert.equal(dry.code, 0, dry.stdout);
    assert.deepEqual(
      dry.envelope<{ removed: { path: string }[] }>().data?.removed.map((item) => item.path),
      [old],
    );
    assert.deepEqual(await harness.core.approvals.list(), [], 'a dry run asks nobody');

    const asked = await cli(harness, ['mcp', 'prune', '--json'], { env });
    const approvalId = pendingApproval(asked);
    assert.match(String(envelopeError(asked)?.details?.preview), /deletes the unused Gmail runtime 0\.0\.1/);
    assert.ok(existsSync(old), 'asking removed nothing');

    const done = await cli(harness, ['mcp', 'prune', '--json', '--approval', approvalId], { env });
    assert.equal(done.code, 0, done.stdout);
    assert.ok(!existsSync(old));
    assert.ok(existsSync(current), 'this release stays');
  },
);

test('a server name that could rewrite the preview is refused by `agent-gmail mcp install`, before anybody is asked', async () => {
  // Quoted in the sentence the person approves, this name read as a pin and `--read-only` the entry would not have.
  const { harness, home, env } = await machine();
  const spoof = 'gmail", pinned to the mailbox work, read-only, "';
  const run = await cli(harness, ['mcp', 'install', '--client', 'cursor', '--name', spoof, '--json'], { env });
  assert.equal(run.code, 64, run.stdout);
  assert.match(String(envelopeError(run)?.message), /a server name is 1 to 64 letters/);
  assert.deepEqual(await harness.core.approvals.list(), [], 'nobody was asked');
  assert.equal(existsSync(join(home, '.cursor', 'mcp.json')), false);
});

test('`agent-gmail mcp install` and comms_server_install warn about the same ungated servers', async () => {
  const { harness, home, env } = await machine();
  await mkdir(join(home, '.cursor'), { recursive: true });
  await writeFile(
    join(home, '.cursor', 'mcp.json'),
    JSON.stringify({
      mcpServers: {
        'old-gmail': { command: 'npx', args: ['-y', '@artymclabin/gmail-mcp'] },
        'team-slack': { command: 'npx', args: ['-y', '@modelcontextprotocol/server-slack'] },
      },
    }),
  );
  const server = await coreServer(harness, env);
  try {
    const command = await cli(harness, ['mcp', 'install', '--client', 'cursor', '--print', '--no-verify', '--json'], {
      env,
    });
    assert.equal(command.code, 0, command.stdout);
    const fromCommand = command.envelope<{ warnings: string[] }>().data?.warnings ?? [];
    const fromChat = applied<{ warnings: string[] }>(
      await server.call('comms_server_install', { channel: 'gmail', client: 'cursor', print: true, noVerify: true }),
    ).warnings;
    assert.deepEqual(fromChat, fromCommand);
    assert.equal(fromCommand.length, 1, JSON.stringify(fromCommand));
    assert.match(fromCommand[0] ?? '', /@artymclabin\/gmail-mcp is registered with cursor as "old-gmail"/);
  } finally {
    await server.close();
  }
});

test(
  'an approval to prune from comms_server_prune is claimed by `agent-gmail mcp prune --approval`, and the other way round',
  process.platform === 'win32'
    ? { skip: 'no `ps` on Windows: prune keeps everything when it cannot list processes' }
    : {},
  async () => {
    const { harness, env } = await machine();
    const { dataDir } = harness.core.paths;
    const runtime = async (version: string) => {
      const dir = managedRuntimeDir(dataDir, '@agentcomms/gmail', version);
      await mkdir(join(dir, 'node_modules', '@agentcomms', 'gmail'), { recursive: true });
      return dir;
    };
    const server = await coreServer(harness, env);
    try {
      // Prepared in chat, claimed at the command line.
      const first = await runtime('0.0.1');
      const fromChat = approvalAsked(await server.call('comms_server_prune', { channel: 'gmail' }));
      assert.match(fromChat.preview, /deletes the unused Gmail runtime 0\.0\.1/);
      const claimed = await cli(harness, ['mcp', 'prune', '--json', '--approval', fromChat.approvalId], { env });
      assert.equal(claimed.code, 0, claimed.stdout);
      assert.deepEqual(
        claimed.envelope<{ removed: { path: string }[] }>().data?.removed.map((item) => item.path),
        [first],
      );
      assert.ok(!existsSync(first));

      // Prepared at the command line, claimed in chat.
      const second = await runtime('0.0.2');
      const asked = await cli(harness, ['mcp', 'prune', '--json'], { env });
      const approvalId = pendingApproval(asked);
      assert.ok(existsSync(second), 'asking removed nothing');
      const done = applied<{ removed: { path: string }[] }>(
        await server.call('comms_server_prune', { channel: 'gmail', approvalId }),
      );
      assert.deepEqual(
        done.removed.map((item) => item.path),
        [second],
      );
      assert.ok(!existsSync(second));
    } finally {
      await server.close();
    }
  },
);

/*
 * `setup --inbox … --mcp-client …` without a terminal stops at the browser: the sign-in is handed off, and the
 * registration step comes after it. That step used to be dropped there — the mailbox was connected later by a finish
 * that knew nothing of it, everything exited 0, and the server was never registered. The request now travels with the
 * sign-in, and the finish that connects the mailbox takes it up, through the same change `setup` and `mcp install`
 * make. None of these sign-ins leaves a listener waiting: each is consented to before its test ends.
 */

/** A machine `setup` has taken past its client step — an OAuth client, no mailbox — with a home for client configs. */
async function clientOnly(): Promise<{ harness: Harness; env: NodeJS.ProcessEnv; cursor: string }> {
  const harness = await newHarness({ accounts: [{ sub: 'sub-2', email: 'sam@example.test' }] });
  const file = join(tempDir(), 'client_secret.json');
  await writeFile(
    file,
    JSON.stringify({ installed: { client_id: TEST_CLIENT_ID, client_secret: TEST_CLIENT_SECRET } }),
  );
  await clientAdd(new GmailContext({ core: harness.core, env: harness.env }), { path: file, store: 'file' });
  const home = tempDir();
  const env = {
    HOME: home,
    USERPROFILE: home,
    APPDATA: join(home, 'AppData', 'Roaming'),
    LOCALAPPDATA: join(home, 'AppData', 'Local'),
  };
  return { harness, env, cursor: join(home, '.cursor', 'mcp.json') };
}

/** `setup` asked for a mailbox and the agent connection at once, with the launcher that needs nothing from npm. */
const BOTH = [
  'setup',
  '--inbox',
  'home',
  '--email',
  'sam@example.test',
  '--mcp-client',
  'cursor',
  '--launcher',
  'local',
];

interface HandOff {
  handoff: { authUrl: string; finish: string; registerWith?: { client: string; launcher?: string } };
  blocked: { step: string; hint: string };
  did: string[];
}

/** `setup` handing the sign-in off, as an agent runs it, and the browser coming back: what the finish then finds. */
async function handedOff(machine: Awaited<ReturnType<typeof clientOnly>>): Promise<HandOff> {
  const run = await cli(machine.harness, [...BOTH, '--json'], { env: machine.env });
  assert.equal(run.code, 0, `${run.stdout}${run.stderr}`);
  const report = run.envelope<HandOff>().data;
  assert.ok(report?.handoff, run.stdout);
  await fetch(machine.harness.google.consent(report.handoff.authUrl));
  return report;
}

/** A printed command as the argv this CLI takes: without the binary. */
const argvOf = (command: string) => command.split(' ').slice(1);

/** The sign-in's record on disk, as the finish will read it. */
async function flowRecord(harness: Harness, flowId: string): Promise<Record<string, unknown>> {
  return JSON.parse(await readFile(join(harness.core.paths.stateDir, 'flows', `${flowId}.json`), 'utf8'));
}

test('`setup --inbox --mcp-client` hands the registration on with the sign-in, and says the finish will ask for it', async () => {
  const machine = await clientOnly();
  const run = await cli(machine.harness, BOTH, { env: machine.env });
  assert.equal(run.code, 0, `${run.stdout}${run.stderr}`);
  const finish = /agent-gmail inbox add --finish (fl_\w+) --wait (\d+)/.exec(run.stdout);
  assert.ok(finish, run.stdout);
  // One wait, whoever prints the finish: `setup` said 120 where `inbox add --start` said 60.
  assert.equal(finish[2], '60');
  assert.match(
    run.stdout,
    /--wait 60\nFinishing it will also register the Gmail server with cursor, after the person approves the registration\./,
  );
  // Recorded where the finish will find it, and nothing registered yet.
  assert.deepEqual((await flowRecord(machine.harness, String(finish[1]))).registerWith, {
    client: 'cursor',
    launcher: 'local',
  });
  assert.equal(existsSync(machine.cursor), false);
  const link = /^\s+(http\S+)$/m.exec(run.stdout)?.[1];
  assert.ok(link, run.stdout);
  await fetch(machine.harness.google.consent(link));
});

test('finishing it without a terminal connects the mailbox and hands back the registration, which `mcp install --approval` claims', async () => {
  const machine = await clientOnly();
  const report = await handedOff(machine);
  assert.deepEqual(report.handoff.registerWith, { client: 'cursor', launcher: 'local' });
  assert.match(report.blocked.hint, /also registers the server with cursor/);
  assert.deepEqual(report.did, ['started a sign-in for "home"'], 'nothing claims the registration happened');

  const finished = await cli(machine.harness, [...argvOf(report.handoff.finish), '--json'], { env: machine.env });
  // Exit 10, "waiting for an approval", in an envelope that says the finish itself worked.
  assert.equal(finished.code, 10, `${finished.stdout}${finished.stderr}`);
  const envelope = finished.envelope<{
    alias: string;
    inbox: { email: string };
    registration: { client: string; status: string; approvalId: string; preview: string; claim: string };
  }>();
  assert.equal(envelope.ok, true, finished.stdout);
  assert.equal(envelope.data?.alias, 'home');
  assert.equal(envelope.data?.inbox.email, 'sam@example.test');
  const registration = envelope.data?.registration;
  assert.equal(registration?.client, 'cursor');
  assert.equal(registration?.status, 'approval-required');
  assert.match(String(registration?.approvalId), /^ap_/);
  assert.match(String(registration?.preview), /registers the Gmail MCP server with cursor as "gmail"/);
  assert.equal(
    registration?.claim,
    `agent-gmail mcp install --client cursor --launcher local --approval ${registration?.approvalId}`,
  );
  assert.equal(existsSync(machine.cursor), false, 'nothing is registered before the person agrees');
  // The mailbox is connected whatever the registration is waiting for.
  const listed = await cli(machine.harness, ['inbox', 'list', '--json'], { env: machine.env });
  assert.deepEqual(
    listed.envelope<{ alias: string }[]>().data?.map((inbox) => inbox.alias),
    ['home'],
  );

  // The same change `mcp install` makes, so its `--approval` claims it and registers.
  const claimed = await cli(machine.harness, [...argvOf(String(registration?.claim)), '--json'], {
    env: machine.env,
  });
  assert.equal(claimed.code, 0, `${claimed.stdout}${claimed.stderr}`);
  assert.equal(claimed.envelope<{ applied: boolean }>().data?.applied, true);
  const written = JSON.parse(await readFile(machine.cursor, 'utf8')) as { mcpServers: Record<string, unknown> };
  assert.ok(written.mcpServers.gmail, JSON.stringify(written));

  // Read by a person, the finish says the same: connected, then what waits, and the command that claims it.
  const other = await clientOnly();
  const plain = await cli(other.harness, argvOf((await handedOff(other)).handoff.finish), { env: other.env });
  assert.equal(plain.code, 10, `${plain.stdout}${plain.stderr}`);
  assert.match(plain.stdout, /Connected sam@example\.test as "home"/);
  assert.match(plain.stdout, /register the Gmail server with cursor\. That waits for the person's approval/);
  assert.match(plain.stdout, /CHANGE PREVIEW[\s\S]*registers the Gmail MCP server with cursor/);
  assert.match(plain.stdout, /run `agent-gmail mcp install --client cursor --launcher local --approval ap_\w+`/);
});

test('a person finishing it at a terminal approves the registration there and then', async () => {
  const machine = await clientOnly();
  const report = await handedOff(machine);
  const finished = await cli(machine.harness, argvOf(report.handoff.finish), {
    env: machine.env,
    tty: true,
    answer: true,
  });
  assert.equal(finished.code, 0, `${finished.stdout}${finished.stderr}`);
  assert.match(finished.stderr, /Connected sam@example\.test as "home"\. Setup also asked to register/);
  assert.match(
    finished.stdout,
    /CHANGE PREVIEW[\s\S]*registers the Gmail MCP server with cursor/,
    'shown before asked',
  );
  assert.match(finished.stdout, /Registered "gmail" with cursor/);
  assert.ok(existsSync(machine.cursor));
});

test('a client that already has the server is left alone by the finish', async () => {
  const machine = await clientOnly();
  await mkdir(dirname(machine.cursor), { recursive: true });
  const entry = JSON.stringify({ mcpServers: { gmail: { command: 'npx', args: ['-y', '@agentcomms/gmail-mcp'] } } });
  await writeFile(machine.cursor, entry);
  const report = await handedOff(machine);
  const finished = await cli(machine.harness, [...argvOf(report.handoff.finish), '--json'], { env: machine.env });
  assert.equal(finished.code, 0, `${finished.stdout}${finished.stderr}`);
  assert.deepEqual(finished.envelope<{ registration: unknown }>().data?.registration, {
    client: 'cursor',
    status: 'already-registered',
  });
  assert.equal(await readFile(machine.cursor, 'utf8'), entry);
  assert.deepEqual(await machine.harness.core.approvals.list(), [], 'nobody was asked anything');
});

test('a sign-in that carries no registration finishes exactly as it always did', async () => {
  // Started by `inbox add --start`, as every flow before this change was: its record has no `registerWith` at all.
  const machine = await clientOnly();
  const started = await cli(
    machine.harness,
    ['inbox', 'add', 'home', '--start', '--email', 'sam@example.test', '--json'],
    { env: machine.env },
  );
  const flow = started.envelope<{ flowId: string; authUrl: string }>().data;
  assert.ok(flow, started.stdout);
  assert.equal(Object.hasOwn(await flowRecord(machine.harness, flow.flowId), 'registerWith'), false);
  await fetch(machine.harness.google.consent(flow.authUrl));

  const finished = await cli(machine.harness, ['inbox', 'add', '--finish', flow.flowId, '--json'], {
    env: machine.env,
  });
  assert.equal(finished.code, 0, `${finished.stdout}${finished.stderr}`);
  const data = finished.envelope<Record<string, unknown>>().data ?? {};
  assert.deepEqual(Object.keys(data).sort(), ['alias', 'inbox', 'missingScopes', 'reauthorised']);
  assert.equal(existsSync(machine.cursor), false);
  assert.deepEqual(await machine.harness.core.approvals.list(), []);
});

test('gmail_inbox_finish connects the mailbox and hands the registration back for comms_server_install, making none', async () => {
  const machine = await clientOnly();
  const report = await handedOff(machine);
  const flowId = /--finish (fl_\w+)/.exec(report.handoff.finish)?.[1];
  const server = await connect({ core: machine.harness.core, env: { ...machine.harness.env, ...machine.env } });
  try {
    const result = wire(await server.call('gmail_inbox_finish', { flowId, waitSeconds: 10 }));
    assert.equal(result.alias, 'home');
    assert.equal(result.email, 'sam@example.test');
    const pending = result.pendingRegistration as Record<string, unknown>;
    assert.equal(pending.client, 'cursor');
    assert.equal(pending.tool, 'comms_server_install');
    assert.deepEqual(pending.arguments, { channel: 'gmail', client: 'cursor', launcher: 'local' });
    assert.match(String(pending.next), /not registered with cursor yet/);
  } finally {
    await server.close();
  }
  assert.equal(existsSync(machine.cursor), false, 'this server registers nothing');
  assert.deepEqual(await machine.harness.core.approvals.list(), [], 'and prepares nothing');
});
