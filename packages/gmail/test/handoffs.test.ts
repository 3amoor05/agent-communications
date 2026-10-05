import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import { join, sep } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { CommsError, type ConfigStore, handoffText, inlineCommand, isCommand, resolvePaths } from '@agentcomms/core';
import { GmailContext } from '../src/context.ts';
import { clientAdd } from '../src/operations/clients.ts';
import { createDraft } from '../src/operations/drafts.ts';
import {
  assertNoBareCommand,
  CORE_SOURCE_CLI,
  GMAIL_SOURCE_CLI,
  gmailHandoffs,
  gmailRetryWords,
  locatedCoreLine,
  SUITE_COMMANDS,
  splitPosixWords,
} from './support/handoffs.ts';
import { newHarness, TEST_CLIENT_ID, TEST_CLIENT_SECRET, tempDir } from './support/harness.ts';
import { cli, connect, toolError } from './support/surfaces.ts';

/*
 * The Gmail slice of CUE-403's §4 7d: every command Gmail tells a person to run is this installation's own, located —
 * this Node, Gmail's checked CLI entry, its folders pinned — or says why there is none here. Never a bare binary that is
 * not on most people's PATH, never an option-only fragment printed as if it were a command, in any case on Windows.
 * Each test drives a real surface: the CLI in-process, the server over MCP, an operation through its context. None of
 * them reaches Google's send endpoint.
 */

// ── The fixture itself: it would catch each of these shapes, so passing it means something ─────────────────────

test('the bare-command fixture rejects every suite binary, alone with an argument or an option, in any case (7d-gmail)', () => {
  // Derived from this checkout's manifests, so a channel added later is checked too.
  assert.ok(SUITE_COMMANDS.includes('agent-gmail'), SUITE_COMMANDS.join(', '));
  assert.ok(SUITE_COMMANDS.includes('agent-gmail-mcp'), 'the wrapper bin is a suite command');
  assert.ok(SUITE_COMMANDS.includes('agentcomms'), "core's binary is a suite command");
  for (const bare of [
    'Run `agent-gmail --help` to see the commands.',
    'Nothing to do. Try agent-gmail --help.',
    'Add one with `agent-gmail client add <client_secret.json>`.',
    'Set up mailboxes with the `agent-gmail setup` command.',
    'run `agentcomms secrets migrate --to file`',
    // Mixed case and a Windows extension, as a Windows registration or a person's own typing has it.
    'Run `Agent-Gmail.CMD --help`.',
    'Run AGENT-GMAIL.exe inbox add work',
    'Try `agent-gmail-mcp --inbox work`.',
    'Run `AgentComms.ps1 update`.',
  ]) {
    assert.throws(() => assertNoBareCommand(bare), /names a suite command by its bare name/, bare);
  }
  // A name as an identity, or inside a path, is not a command to run.
  for (const identity of [
    'The Gmail server is registered as "gmail".',
    '/tmp/agent-gmail-cli-offline-abc/config',
    '@agentcomms/gmail-mcp is the server-only package.',
  ]) {
    assertNoBareCommand(identity);
  }
});

// ── The bare binary and the current --help site ─────────────────────────────────────────────────────────────

test("a command or an option that is not one names this installation's own --help, located (7d-gmail)", async () => {
  const harness = await newHarness();
  for (const platform of ['darwin', 'win32'] as const) {
    // `--help` reads no folder, so nothing is pinned: the program, the flag a TypeScript entry needs, the entry.
    const help = gmailHandoffs(harness.core.paths, platform).own(['--help'], { uses: [] });
    assert.ok(isCommand(help), 'message' in help ? help.message : '');
    assert.deepEqual(help.words, [process.execPath, '--experimental-strip-types', GMAIL_SOURCE_CLI, '--help']);

    for (const argv of [['nonsense'], ['inbox', 'list', '--no-such-option']]) {
      const refused = await cli(harness, argv, { platform });
      assert.equal(refused.code, 64);
      assert.ok(refused.stderr.includes(`Run ${inlineCommand(help)} to see the commands.`), refused.stderr);
      assertNoBareCommand(refused.stderr, platform);
    }

    const unknown = await cli(harness, ['nonsense', '--json'], { platform });
    assert.equal(unknown.code, 64);
    const hint = unknown.envelope().error?.hint ?? '';
    assert.equal(hint, `Run ${inlineCommand(help)} to see the commands.`, platform);
    assertNoBareCommand(hint, platform);

    // A path option that is not one fails before any folder is known; its help needs none.
    const empty = await cli(harness, ['--config-dir=', 'inbox', 'list'], { platform });
    assert.equal(empty.code, 64);
    assert.ok(empty.stderr.includes(`Run ${inlineCommand(help)} to see the commands.`), `${platform}: ${empty.stderr}`);
    assertNoBareCommand(empty.stderr, platform);
  }
  // And the line runs Gmail's own CLI with only the words given: no folder, no other flag.
  const darwin = gmailHandoffs(harness.core.paths, 'darwin').own(['--help'], { uses: [] });
  assert.ok(isCommand(darwin) && darwin.line !== null);
  assert.deepEqual(gmailRetryWords(darwin.line), ['--help']);
});

test("setup's help and examples, and the mcp install example, are this installation's own commands (7d-gmail)", async () => {
  const harness = await newHarness();
  const setupHelp = await cli(harness, ['setup', '--org-approval', 'ap_x', '--json']);
  assert.equal(setupHelp.code, 64);
  const helpHint = setupHelp.envelope().error?.hint ?? '';
  const [line] = [...helpHint.matchAll(/`([^`]+)`/g)].map((match) => match[1] as string);
  assert.deepEqual(gmailRetryWords(line ?? ''), ['setup', '--help'], 'help pins no folder');
  assertNoBareCommand(helpHint);

  const install = await cli(harness, ['mcp', 'install', '--json']);
  assert.equal(install.code, 64);
  const example = install.envelope().error?.hint ?? '';
  const [exampleLine] = [...example.matchAll(/`([^`]+)`/g)].map((match) => match[1] as string);
  const words = gmailRetryWords(exampleLine ?? '');
  assert.deepEqual(words.slice(-4), ['mcp', 'install', '--client', 'claude-code']);
  // A command that opens the suite's folders runs on this process's: each pinned once, canonical, before the words.
  const { configDir, stateDir, dataDir, secretsDir } = harness.core.paths;
  assert.deepEqual(words.slice(0, 8), [
    '--config-dir',
    configDir,
    '--state-dir',
    stateDir,
    '--data-dir',
    dataDir,
    '--secrets-dir',
    secretsDir,
  ]);
  assert.equal(words.includes('--downloads-dir'), false, 'mcp install saves nothing');
  assertNoBareCommand(example);
});

// ── An option-only fragment: never printed as a command of its own ─────────────────────────────────────────

test('a client whose secret cannot be put back is registered again by one whole command, never `--name … --replace` (7d-gmail)', async () => {
  const harness = await newHarness();
  const context = new GmailContext({ core: harness.core, env: harness.env, platform: 'darwin' });
  const path = join(tempDir(), 'client_secret.json');
  await writeFile(
    path,
    JSON.stringify({ installed: { client_id: TEST_CLIENT_ID, client_secret: TEST_CLIENT_SECRET } }),
  );
  // The configuration write fails, and so does taking the new secret back out: the one case that prints the repair.
  const store = await harness.core.secrets('file');
  const failing = new Proxy(store, {
    get(target, property) {
      if (property === 'delete') return async () => Promise.reject(new Error('the secret store went away'));
      const value = Reflect.get(target, property, target);
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });
  harness.core.secrets = async () => failing;
  (harness.core.config as { update: ConfigStore['update'] }).update = async () => {
    throw new Error('the disk is full');
  };
  await assert.rejects(
    clientAdd(context, { path, name: 'desktop', store: 'file', noProbe: true }),
    (error: unknown) => {
      assert.ok(error instanceof CommsError, String(error));
      const hint = error.hint ?? '';
      assert.match(
        hint,
        /The secret store could not be put back as it was: register the client again from its JSON: `/,
      );
      const lines = [...hint.matchAll(/`([^`]+)`/g)].map((match) => match[1] as string);
      assert.equal(lines.length, 1, `one command, no fragment beside it: ${hint}`);
      const [line] = lines;
      // The placeholder is the agent's to fill in, after the located command and its options.
      assert.ok(line?.endsWith(' <client_secret.json>'), line);
      const words = gmailRetryWords((line ?? '').replace(/ <client_secret\.json>$/, ''));
      assert.deepEqual(words.slice(-5), ['client', 'add', '--name', 'desktop', '--replace']);
      assert.doesNotMatch(hint, /`--name/, 'an option-only fragment printed as a command');
      assertNoBareCommand(hint);
      return true;
    },
  );
});

// ── Windows: located, quoted for every shell or shown as words to type, never a name in any case ─────────────

test('on Windows every handoff is the located command, as a line or as its words, never a bare name (7d-gmail)', async () => {
  const harness = await newHarness({ accounts: [{ sub: 'sub-1', email: 'jo@example.test' }] });
  await harness.addInbox({ alias: 'work', email: 'jo@example.test', sub: 'sub-1', refreshToken: 'rt_x' });
  const handoffs = gmailHandoffs(harness.core.paths, 'win32');
  assert.equal((await cli(harness, ['inbox', 'policy', 'work', '--send', 'never', '--json'])).code, 0);
  // A change waiting for approval, at the CLI: the command to run again, located and quoted for Windows.
  const asked = await cli(harness, ['inbox', 'policy', 'work', '--send', 'chat', '--json'], { platform: 'win32' });
  assert.equal(asked.code, 10, asked.stdout);
  const error = asked.envelope().error;
  const approvalId = String(error?.details?.approvalId);
  const rerun = handoffs.own(['inbox', 'policy', 'work', '--send', 'chat', '--json', '--approval', approvalId]);
  assert.ok(isCommand(rerun));
  assert.ok((error?.hint ?? '').includes(inlineCommand(rerun)), error?.hint);
  assertNoBareCommand(error?.hint ?? '', 'win32');
  // An agent told to hand the person the approve command.
  const approve = await cli(harness, ['approve', approvalId, '--json'], {
    platform: 'win32',
    env: { CLAUDECODE: '1' },
  });
  const approveHint = approve.envelope().error?.hint ?? '';
  const own = handoffs.own(['approve', approvalId]);
  assert.ok(isCommand(own));
  assert.ok(approveHint.includes(inlineCommand(own)), approveHint);
  assertNoBareCommand(approveHint, 'win32');
});

test('on Windows the located command is this Node and Gmail’s checked entry, never a suite name in any case (7d-gmail)', () => {
  /*
   * What Windows itself puts on PATH — `Agent-Gmail.CMD` in npm's global folder, say — is a name a person could paste,
   * and not one this prints: the command is this Node and Gmail's checked entry, whatever case such a name is in.
   */
  const paths = resolvePaths({ env: { HOME: tempDir('agent-gmail-7d-home-') }, platform: 'win32' });
  const located = gmailHandoffs(paths, 'win32').own(['inbox', 'reauth', 'work']);
  assert.ok(isCommand(located));
  assert.equal(located.words[0], process.execPath);
  assert.equal(located.words[2], GMAIL_SOURCE_CLI);
  for (const word of located.words) assert.doesNotMatch(word, /^agent-gmail(?:\.cmd|\.exe|\.ps1)?$/i, word);
  assertNoBareCommand(handoffText(located), 'win32');
});

// ── Core's commands from Gmail: through its runtime dependency on core, located ──────────────────────────────

test("a file outside the allowed folders is refused with core's own attach command, located from Gmail (7d-gmail)", async () => {
  const harness = await newHarness({ accounts: [{ sub: 'sub-1', email: 'jo@example.test' }] });
  await harness.connectInbox({ alias: 'work', email: 'jo@example.test', sub: 'sub-1' });
  const context = new GmailContext({ core: harness.core, env: harness.env, platform: 'darwin' });
  const outside = join(tempDir('agent-gmail-outside-'), 'report.pdf');
  await writeFile(outside, 'not really a pdf');
  await assert.rejects(
    createDraft(context, 'work', { to: ['sam@example.test'], subject: 'x', text: 'y', attach: [outside] }),
    (error: unknown) => {
      assert.ok(error instanceof CommsError, String(error));
      const hint = error.hint ?? '';
      // `attach roots add <folder>`: core's, with the folder for the agent to fill in.
      const line = [...hint.matchAll(/`([^`]+)`/g)]
        .map((match) => match[1] as string)
        .find((each) => each.includes(' attach '));
      assert.ok(line, hint);
      const [program, flag, entry, ...rest] = splitPosixWords(line.replace(/ <folder>$/, ''));
      assert.equal(program, process.execPath);
      assert.equal(flag, '--experimental-strip-types');
      assert.equal(entry, CORE_SOURCE_CLI, 'core, through Gmail’s dependency on it');
      assert.deepEqual(rest.slice(-3), ['attach', 'roots', 'add']);
      assert.ok(line.endsWith(' <folder>'), line);
      assertNoBareCommand(hint);
      return true;
    },
  );
});

test('the update stop and the secret-store refusal name core’s commands, located from Gmail (7d-gmail)', async () => {
  const harness = await newHarness();
  const path = join(tempDir(), 'client_secret.json');
  await writeFile(
    path,
    JSON.stringify({ installed: { client_id: TEST_CLIENT_ID, client_secret: TEST_CLIENT_SECRET } }),
  );
  // The harness keeps secrets in files: asking for the keychain is refused with core's `secrets migrate`.
  const refused = await cli(harness, ['client', 'add', path, '--store', 'keychain', '--json']);
  assert.equal(refused.code, 78, refused.stdout);
  locatedCoreLine(refused.envelope().error?.hint ?? '', ['secrets', 'migrate', '--to', 'keychain']);
});

// ── The MCP surface: the greeting and the descriptions name no CLI; a result carries the command ─────────────

test('the greeting and every tool say to run the command a result gives, and name no CLI of their own (7d-gmail)', async () => {
  const harness = await newHarness();
  const { client, call, close } = await connect({ core: harness.core, env: harness.env });
  try {
    assertNoBareCommand(client.getInstructions() ?? '', 'the greeting');
    const { tools } = await client.listTools();
    assert.ok(tools.length > 20, `${tools.length} tools`);
    for (const tool of tools) {
      assertNoBareCommand(tool.description ?? '', `${tool.name}'s description`);
      assertNoBareCommand(JSON.stringify(tool.inputSchema), `${tool.name}'s arguments`);
      assertNoBareCommand(JSON.stringify(tool.outputSchema ?? {}), `${tool.name}'s result`);
    }
    // A result does carry one: the doctor's repair is this installation's own `setup`, located.
    const doctor = await call('gmail_doctor', {});
    const checks = (doctor.structuredContent?.checks ?? []) as Array<{ id: string; fix?: string | null }>;
    const fix = checks.find((check) => check.id === 'inboxes')?.fix ?? '';
    assert.deepEqual(gmailRetryWords(fix).slice(-1), ['setup'], fix);
    assert.equal(toolError(await call('gmail_inbox_show', { inbox: 'nobody' })).code, 'NOT_FOUND');
  } finally {
    await close();
  }
});

// ── Nothing in Gmail's runtime source names a suite command by its bare name in a string it prints ──────────────

test('Gmail’s source prints no suite command by its bare name: only reviewed identities (7d-gmail)', () => {
  /*
   * A line-level check of this package's runtime source, ahead of the syntax-tree guard (CUE-403 task 15): every
   * string or template naming `agent-gmail` or `agentcomms` followed by words is one of the few reviewed identities —
   * the program name Commander shows in usage, the update gate's prose name, the server's MCP name, the sign-in page's
   * brand. The deprecated bridge's field is gone with the bridge (CUE-403 task 15).
   */
  const reviewed = new Map<string, RegExp>([
    ['src/cli/program.ts', /^\s*(?:\.name\('agent-gmail'\)|binary: 'agent-gmail',)$/],
    ['src/mcp/server.ts', /^\s*(?:\{ name: 'agent-gmail', version: VERSION \},|server: 'agent-gmail',)$/],
    ['src/auth/loopback.ts', /agent-gmail<\/(?:p|title)>/],
  ]);
  const root = fileURLToPath(new URL('..', import.meta.url));
  // Every module of the package's runtime source, found rather than listed, so a new one is checked too.
  const files = (readdirSync(join(root, 'src'), { recursive: true }) as string[])
    .filter((file) => file.endsWith('.ts'))
    .map((file) => `src/${file.split(sep).join('/')}`);
  assert.ok(files.length > 40, `${files.length} modules`);
  for (const file of files) {
    const lines = readFileSync(join(root, file), 'utf8').split('\n');
    for (const [index, line] of lines.entries()) {
      // Comments say what the code did before; they are not printed.
      if (/^\s*(?:\/\/|\*|\/\*)/.test(line)) continue;
      if (!/['"`][^'"`]*\b(?:agent-gmail|agentcomms)\b/.test(line)) continue;
      if (
        /@agentcomms\//.test(line) &&
        !/\bagent-gmail\b|\bagentcomms [a-z]/.test(line.replace(/@agentcomms\/[\w-]+/g, ''))
      )
        continue;
      const allowed = reviewed.get(file);
      assert.ok(allowed?.test(line), `${file}:${index + 1} names a suite command: ${line.trim()}`);
    }
  }
});
