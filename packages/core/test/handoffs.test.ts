import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { beginChangeApproval, claimChange } from '../src/changes.ts';
import type { NodeRuntime } from '../src/cli-command.ts';
import { commandText, inlineCommand, type ShellCommand, shellCommand } from '../src/cli-runtime.ts';
import { openCore } from '../src/core.ts';
import { CommsError } from '../src/errors.ts';
import {
  CORE_CALLER,
  cliHandoffs,
  type Handoff,
  handoffChoices,
  handoffSentence,
  handoffSentenceToFill,
  handoffsFor,
  handoffText,
  isCommand,
  registeredFor,
  requireHandoffs,
} from '../src/handoffs.ts';
import { knownClientConfigs } from '../src/mcp-clients.ts';
import type { ResolvedPaths } from '../src/paths.ts';
import { VERSION as CORE_VERSION } from '../src/version.ts';
import { moduleUrl, realTemp, registration, writeCheckout, writeManaged } from './fixtures/cli-command/trees.ts';
import { assertNoBareCommand, coreInline } from './helpers/handoffs.ts';

/*
 * The API a package tells a person what to run with (CONTRIBUTING.md, "Telling a person what to run"): made once from
 * the package's caller, its folders and its shell; `own`, `core` and `of` for the CLI words; and the renderers that put
 * a command — or why there is none — in a line, a field or a sentence.
 */

const PATHS: ResolvedPaths = {
  configDir: resolve('/pins/config'),
  stateDir: resolve('/pins/state'),
  dataDir: resolve('/pins/data'),
  secretsDir: resolve('/pins/secrets'),
  downloadsDir: resolve('/pins/downloads'),
};
const FOUR = [
  '--config-dir',
  PATHS.configDir,
  '--state-dir',
  PATHS.stateDir,
  '--data-dir',
  PATHS.dataDir,
  '--secrets-dir',
  PATHS.secretsDir,
];
const NODE: NodeRuntime = { version: 'v22.18.0', execArgv: [] };

/** A checkout with Gmail built, and Gmail's handoffs as its built CLI makes them. */
function gmailHandoffs(
  options: { registrations?: Parameters<typeof cliHandoffs>[0]['registrations']; env?: NodeJS.ProcessEnv } = {},
) {
  const checkout = writeCheckout(join(realTemp(), 'checkout'), ['gmail']);
  const gmail = checkout.packages.gmail as string;
  const handoffs = cliHandoffs({
    caller: { url: moduleUrl(gmail, 'dist', 'cli.mjs'), packageName: '@agentcomms/gmail' },
    paths: PATHS,
    platform: 'linux',
    runtime: NODE,
    ...options,
  });
  return { checkout, gmail, handoffs };
}

function words(handoff: Handoff | ShellCommand): readonly string[] {
  assert.ok(isCommand(handoff), 'message' in handoff ? handoff.message : '');
  return handoff.words;
}

test("a package's handoffs: its own CLI, core's, and another product's from its registrations", () => {
  const { checkout, gmail, handoffs } = gmailHandoffs();
  assert.deepEqual(words(handoffs.own(['approve', 'ap_1'])), [
    process.execPath,
    join(gmail, 'dist', 'cli.mjs'),
    ...FOUR,
    'approve',
    'ap_1',
  ]);
  // Core, as Gmail's installed dependency finds it: a built caller runs core's manifest bin.
  assert.deepEqual(words(handoffs.core(['doctor'])), [
    process.execPath,
    join(checkout.core, 'dist', 'cli.mjs'),
    ...FOUR,
    'doctor',
  ]);
  assert.deepEqual(handoffs.of('gmail', ['doctor']), handoffs.own(['doctor']));
  // Another product, with nothing registered given: no command, and it says so.
  const slack = handoffs.of('slack', ['approve', 'ap_1']);
  assert.ok(!isCommand(slack) && slack.reason === 'no-registrations', JSON.stringify(slack));
  // With its registration: the managed runtime it names.
  const { entry } = writeManaged(join(realTemp(), 'data'), 'slack');
  const registered = gmailHandoffs({ registrations: [registration({ command: '/n', args: [entry, 'mcp'] })] });
  assert.deepEqual(words(registered.handoffs.of('slack', ['approve', 'ap_1'])), [
    process.execPath,
    entry,
    ...FOUR,
    'approve',
    'ap_1',
  ]);
  assert.throws(() => handoffs.of('telegram', ['x']), TypeError);
});

test('a command pins the four folders every command opens, the downloads folder only when asked, or what it names', () => {
  const { gmail, handoffs } = gmailHandoffs();
  const entry = join(gmail, 'dist', 'cli.mjs');
  assert.deepEqual(words(handoffs.own(['x'], { downloads: true })), [
    process.execPath,
    entry,
    ...FOUR,
    '--downloads-dir',
    PATHS.downloadsDir,
    'x',
  ]);
  assert.deepEqual(words(handoffs.own(['--help'], { uses: [] })), [process.execPath, entry, '--help']);
  assert.deepEqual(words(handoffs.own(['x'], { uses: ['secretsDir'] })), [
    process.execPath,
    entry,
    '--secrets-dir',
    PATHS.secretsDir,
    'x',
  ]);
  // Quoted for another shell: the same words, another line.
  const windows = handoffs.on('win32').own(['inbox', 'remove', 'old mail']);
  assert.ok(isCommand(windows));
  assert.equal(windows.platform, 'win32');
  assert.equal(windows.line, shellCommand(windows.words, 'win32').line);
  assert.equal(handoffs.on('linux'), handoffs, 'the same shell is the same handoffs');
});

test("registered() reads this machine's registrations from the environment the handoffs were made with", async () => {
  const home = realTemp('home-');
  const env = { HOME: home, USERPROFILE: home, PATH: '' };
  const { entry } = writeManaged(join(home, 'data'), 'slack');
  const claude = knownClientConfigs(env, 'linux').find((file) => file.client === 'claude-code')?.path as string;
  writeFileSync(claude, JSON.stringify({ mcpServers: { slack: { command: '/n', args: [entry, 'mcp'] } } }));
  const { handoffs } = gmailHandoffs({ env });
  assert.ok(!isCommand(handoffs.of('slack', ['doctor'])), 'nothing read yet');
  const registered = await handoffs.registered();
  assert.deepEqual(words(registered.of('slack', ['doctor'])), [process.execPath, entry, ...FOUR, 'doctor']);
  assert.deepEqual(
    words((await registeredFor(handoffs)).of('slack', ['doctor'])),
    words(registered.of('slack', ['doctor'])),
  );
});

test('a command renders as a line, as words to type, or — with none — as the sentence saying why', () => {
  const { handoffs } = gmailHandoffs();
  const printed = handoffs.own(['approve', 'ap_1']);
  assert.ok(isCommand(printed));
  assert.equal(handoffText(printed), printed.line);
  assert.equal(
    handoffSentence(printed, (command) => `Run ${command}.`),
    `Run \`${printed.line}\`.`,
  );
  // On Windows, a word no line carries safely: its words as JSON, saying it has to be typed.
  const unprintable = handoffs.on('win32').own(['inbox', 'remove', '$x&whoami&']);
  assert.ok(isCommand(unprintable) && unprintable.line === null);
  assert.equal(handoffText(unprintable), commandText(unprintable));
  assert.equal(
    handoffSentence(unprintable, (command) => `Run ${command}.`),
    `Run ${inlineCommand(unprintable)}.`,
  );
  // No command: the sentence saying why, and nothing in the command's place.
  const missing = handoffs.of('slack', ['approve', 'ap_1']);
  assert.ok(!isCommand(missing));
  assert.equal(handoffText(missing), missing.message);
  assert.equal(
    handoffSentence(missing, (command) => `Run ${command}.`),
    missing.message,
  );
  // Words for the agent to fill in go before `--`, as written.
  const download = handoffs.own(['attachments', 'download', '--', '--odd']);
  assert.ok(isCommand(download));
  const filled = handoffSentenceToFill(download, ['--to', '<folder>'], (command) => `Run ${command}.`);
  assert.ok(filled.endsWith(` attachments download --to <folder> -- --odd\`.`), filled);
  assert.equal(
    handoffSentenceToFill(missing, ['<folder>'], (command) => command),
    missing.message,
  );
  // Choices: the commands, then why the others have none.
  assert.equal(handoffChoices([printed], 'none:'), inlineCommand(printed));
  assert.equal(handoffChoices([printed, printed], 'none:'), `${inlineCommand(printed)} or ${inlineCommand(printed)}`);
  assert.equal(
    handoffChoices([missing], 'And none is locatable here:'),
    `And none is locatable here: ${missing.message}`,
  );
  assert.equal(
    handoffChoices([printed, missing], 'none:'),
    `${inlineCommand(printed)} (${missing.message.replace(/\.$/, '')})`,
  );
});

test('the bridge: without its caller, a package gets the bare commands it printed before CUE-403', () => {
  const bridge = handoffsFor(undefined, { platform: 'linux', approveCommand: 'agent-gmail approve' });
  assert.deepEqual(bridge.own(['approve', 'ap_1']), shellCommand(['agent-gmail', 'approve', 'ap_1'], 'linux'));
  assert.deepEqual(bridge.own(['inbox', 'add']), shellCommand(['agent-gmail', 'inbox', 'add'], 'linux'));
  assert.deepEqual(bridge.core(['update']), shellCommand(['agentcomms', 'update'], 'linux'));
  assert.deepEqual(bridge.of('slack', ['approve']), shellCommand(['agent-slack', 'approve'], 'linux'));
  // The approve command as the package named it, whatever its words.
  assert.deepEqual(
    handoffsFor({}, { approveCommand: 'agent-slack 7' }).own(['approve', 'ap_1']),
    shellCommand(['agent-slack', '7', 'ap_1'], process.platform),
  );
  // With its caller, the package's own: located.
  const { handoffs } = gmailHandoffs();
  assert.equal(handoffsFor({ handoffs }), handoffs);
  assert.deepEqual(handoffsFor({ handoffs }, { platform: 'win32' }).own(['x']), handoffs.on('win32').own(['x']));
});

test('openCore gives core its handoffs from a caller, and core’s own CLI and server always give one', () => {
  const home = realTemp('home-');
  const env = { HOME: home, USERPROFILE: home, AGENT_COMMS_CONFIG_DIR: join(home, 'config') };
  const bare = openCore({ env });
  assert.equal(bare.handoffs, undefined);
  assert.throws(() => requireHandoffs(bare), /opened without its caller/);
  const own = openCore({ env, caller: CORE_CALLER });
  assert.equal(requireHandoffs(own), own.handoffs);
  const help = own.handoffs?.own(['--help'], { uses: [] });
  assert.ok(help !== undefined && isCommand(help));
  assert.equal(help.words.at(-2), fileURLToPath(new URL('../src/cli.ts', import.meta.url)));
  // The two places core opens itself, read from their source: neither may leave the caller out.
  const source = (path: string) => readFileSync(fileURLToPath(new URL(path, import.meta.url)), 'utf8');
  assert.match(source('../src/cli.ts'), /openCore\(\{ env, platform, pathOverrides, caller: CORE_CALLER \}\)/);
  assert.match(source('../src/mcp/server.ts'), /openCore\(\{ env, caller: CORE_CALLER \}\)/);
  assert.throws(
    () => cliHandoffs({ caller: { url: CORE_CALLER.url, packageName: '@someone/else' }, paths: PATHS }),
    TypeError,
  );
});

// ── 7d (core): a misdirected approval is corrected with commands that run, or with why there is none ────────────────

/** A machine whose Claude Code has a managed Gmail of this release registered, and core opened as core. */
function machineWithGmail() {
  const home = realTemp('home-');
  const env = { HOME: home, USERPROFILE: home, AGENT_COMMS_CONFIG_DIR: join(home, 'config'), PATH: '' };
  const { entry } = writeManaged(join(home, 'data'), 'gmail', { version: CORE_VERSION });
  const claude = knownClientConfigs(env, process.platform).find((file) => file.client === 'claude-code')
    ?.path as string;
  writeFileSync(claude, JSON.stringify({ mcpServers: { gmail: { command: '/n', args: [entry, 'mcp'] } } }));
  return { env, entry, core: openCore({ env, caller: CORE_CALLER }) };
}

async function sendRecord(core: ReturnType<typeof openCore>) {
  return core.approvals.create({
    inboxId: 'ibx_AAAAAAAAAAAAAAAA',
    draftId: 'r-1',
    draftMessageId: 'm-1',
    digest: 'd-1',
    policy: 'confirm',
    requiredPolicy: 'confirm',
    riskFlags: [],
    expect: { to: ['sam@partner.test'], cc: [], bcc: [], subject: 'hi' },
  });
}

test("a send's approval offered as a change names every sending channel's approve, located or why not (7d-core)", async () => {
  const { core, entry } = machineWithGmail();
  const send = await sendRecord(core);
  const registered = await requireHandoffs(core).registered();
  const gmail = registered.of('gmail', ['approve', send.approvalId]);
  assert.ok(isCommand(gmail) && gmail.words.includes(entry), 'Gmail is found where it is registered');
  const config = await core.config.load();
  for (const attempt of [
    () => beginChangeApproval(core, send.approvalId, { surface: 'cli' }),
    () => claimChange(core, send.approvalId, { before: config, after: config, effects: ['x'] }, { surface: 'mcp' }),
  ]) {
    await assert.rejects(attempt(), (error: unknown) => {
      assert.ok(error instanceof CommsError && error.code === 'USAGE', String(error));
      assert.match(error.message, /is for a send, not a configuration change/);
      const hint = error.hint ?? '';
      assert.ok(hint.startsWith(`It is approved with the command that prepared it — ${inlineCommand(gmail)} (`), hint);
      for (const label of ['Slack', 'Resend'])
        assert.match(hint, new RegExp(`${label} \\S+ \\(@agentcomms/\\w+\\) is not locatable here`));
      assert.doesNotMatch(hint, /WhatsApp/, 'only channels that send are named');
      assertNoBareCommand(hint);
      return true;
    });
  }
});

test("a change's approval offered as a send is approved with this installation's own approve (7d-core)", async () => {
  const { core } = machineWithGmail();
  const change = await core.approvals.createChange({
    change: { summary: 'x', target: { kind: 'account', name: 'acme/slack' }, loosened: [], effects: ['x'] },
    policy: 'chat',
  });
  await assert.rejects(core.approvals.issueChallenge(change.approvalId), (error: unknown) => {
    assert.ok(error instanceof CommsError);
    assert.equal(
      error.hint,
      `A person approves it with ${coreInline(core.paths, ['approve', change.approvalId])}, and it permits only the change it was prepared for.`,
    );
    return true;
  });
});
