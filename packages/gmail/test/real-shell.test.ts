import assert from 'node:assert/strict';
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  baseEnvironment,
  commandEndingWith,
  environmentAssignments,
  type Finished,
  FOUR_FOLDERS,
  type Folder,
  type Folders,
  freshShell,
  inWindowsShells,
  isCanonical,
  NEEDS_TERMINAL,
  ON_POSIX,
  PATH_OPTIONS,
  pinsOf,
  posixShellAsync,
  posixTerminalAsync,
  real,
  refusesWithoutATerminal,
  runNodeAsync,
  type Shell,
  sealAttempts,
  startMcpServer,
  suiteCommandsOn,
  suiteTraces,
  wordsOf,
} from '../../../test/helpers/real-shell.mjs';
import { GmailContext } from '../src/context.ts';
import { createDraft } from '../src/operations/drafts.ts';
import type { FakeMessage } from './support/fake-google.ts';
import { type Harness, newHarness, tempDir } from './support/harness.ts';

/*
 * Gmail's handoffs pasted into real shells (CUE-403; design 2026-10-04 §4 items 3d and 8). Gmail is run as this
 * checkout runs it — its source, under this Node with type stripping — and so are the commands it prints, which name
 * that Node, that flag and `src/cli.ts`. The person pastes them into a fresh shell (`test/helpers/real-shell.mjs`): no
 * suite command on PATH, every suite variable a decoy, another working folder, and a seal that refuses the keychain and
 * every connection off the machine. Google is the harness's fake, on this machine, named to both by
 * AGENT_COMMS_GOOGLE_ROOT_URL, and it records every request it is sent.
 */

const GMAIL_CLI = real(fileURLToPath(new URL('../src/cli.ts', import.meta.url)));
/** How a source caller's own command runs its `.ts` entry, and the only flag it carries (D1). */
const SOURCE_FLAGS = ['--experimental-strip-types'];

function base64url(text: string): string {
  return Buffer.from(text, 'utf8').toString('base64url');
}

const MESSAGE: FakeMessage = {
  id: 'm1',
  threadId: 'm1',
  labelIds: ['INBOX'],
  internalDate: String(Date.parse('2026-09-15T09:00:00Z')),
  payload: {
    partId: '',
    mimeType: 'multipart/mixed',
    headers: [
      { name: 'From', value: 'Sam Lee <sam@partner.test>' },
      { name: 'Subject', value: 'Invoice for August' },
    ],
    parts: [
      { partId: '0', mimeType: 'text/plain', body: { size: 2, data: base64url('hi') } },
      {
        partId: '1',
        mimeType: 'application/pdf',
        filename: 'invoice.pdf',
        headers: [{ name: 'Content-Disposition', value: 'attachment; filename="invoice.pdf"' }],
        body: { size: 13, attachmentId: 'a1' },
      },
    ],
  },
};

interface Printing {
  harness: Harness;
  root: string;
  /** Every suite folder the printing process pinned, resolved: what a printed command must carry. */
  folders: Required<Folders>;
  env: NodeJS.ProcessEnv;
  sealLog: string;
  print(args: readonly string[]): Promise<Finished>;
}

/**
 * A mailbox with one attachment, behind the fake Google — and the process that prints: Gmail's own CLI from source,
 * with the harness's folders pinned, and downloads pinned by a relative option from a working folder of its own.
 */
async function printing(): Promise<Printing> {
  const harness = await newHarness({
    accounts: [
      { sub: 'sub-1', email: 'jo@example.test', messages: { m1: MESSAGE }, attachments: { a1: 'invoice bytes' } },
    ],
  });
  await harness.connectInbox({ alias: 'work', email: 'jo@example.test', sub: 'sub-1', sendPolicy: 'confirm' });
  const root = tempDir('agent-gmail-real-shell-');
  const cwd = join(root, 'print-cwd');
  const tmp = join(root, 'print-tmp');
  mkdirSync(cwd, { recursive: true });
  mkdirSync(tmp, { recursive: true });
  const { configDir, stateDir, dataDir, secretsDir } = harness.core.paths;
  const folders = { configDir, stateDir, dataDir, secretsDir, downloadsDir: resolve(cwd, 'saved') };
  const pins = [
    ...FOUR_FOLDERS.flatMap((key) => [PATH_OPTIONS[key], folders[key]]),
    PATH_OPTIONS.downloadsDir,
    'saved',
  ];
  const sealLog = join(root, 'print-seal.jsonl');
  const env = {
    ...baseEnvironment({ home: join(root, 'print-home'), tmp, sealLog }),
    AGENT_COMMS_GOOGLE_ROOT_URL: harness.google.url,
  };
  const print = (args: readonly string[]) => runNodeAsync([...SOURCE_FLAGS, GMAIL_CLI, ...pins, ...args], { env, cwd });
  return { harness, root, folders, env, sealLog, print };
}

/** A fresh shell that can reach the fake Google — and nothing else off the machine — with no suite command on PATH. */
function shellFor(p: Printing, name: string): Shell {
  const shell = freshShell(join(p.root, name), { extra: { AGENT_COMMS_GOOGLE_ROOT_URL: p.harness.google.url } });
  assert.deepEqual(suiteCommandsOn(shell.env.PATH), [], 'no suite command on the fresh shell’s PATH');
  return shell;
}

function assertClean(shell: Shell): void {
  assert.deepEqual(sealAttempts(shell.sealLog), [], 'no keychain and no connection off the machine');
  assert.deepEqual(suiteTraces(shell), [], 'no suite folder found from the shell’s environment');
}

/**
 * Checks a printed command is Gmail's own, as this checkout runs it: this Node, the type-stripping flag, Gmail's
 * `src/cli.ts`, exactly one canonical option for each folder in `uses` with the printing process's value, then `tail`.
 */
function assertGmailCommand(
  command: string,
  p: Printing,
  uses: readonly Folder[],
  tail: readonly string[],
): readonly string[] {
  const words = wordsOf(command);
  assert.ok(words !== null, `a line to paste: ${command}`);
  assert.deepEqual(words.slice(0, 3), [process.execPath, ...SOURCE_FLAGS, GMAIL_CLI], command);
  const pins = pinsOf(words);
  assert.deepEqual(Object.keys(pins).sort(), [...uses].sort(), `exactly the folders it uses: ${command}`);
  for (const key of uses) {
    assert.equal(pins[key], p.folders[key], `${PATH_OPTIONS[key]}: ${command}`);
    assert.ok(isCanonical(pins[key] as string), command);
  }
  assert.equal(words.length, 3 + uses.length * 2 + tail.length, `nothing else in it: ${command}`);
  assert.deepEqual(words.slice(-tail.length), tail, command);
  return words;
}

/** A `--json` run's envelope, printed first. */
function envelope(result: Finished): {
  ok: boolean;
  data?: Record<string, unknown>;
  error?: { code: string; hint?: string; details?: Record<string, unknown> };
} {
  const line = String(result.stdout)
    .split('\n')
    .find((each) => each.startsWith('{'));
  assert.ok(line, `no JSON in:\n${result.stdout}\n${result.stderr}`);
  return JSON.parse(line);
}

/** What the fake Google was asked to send: none, ever, in these tests. */
function sends(harness: Harness): string[] {
  return harness.google.requests
    .filter((request) => request.method === 'POST' && /\/send\b/.test(request.path))
    .map((request) => request.path);
}

// ── 3d: a download's handoffs ───────────────────────────────────────────────────────────────────────────────────

test(
  'a download hands over its rerun with the downloads folder pinned, and its approval without; pasted, the file is saved in the printing process’s downloads (3d, 8c)',
  ON_POSIX,
  async () => {
    const p = await printing();

    // Under `chat`: the agent asks the person, then runs the download again with the answer.
    const asked = await p.print(['attachments', 'download', 'm1', '--inbox', 'work']);
    assert.equal(asked.status, 10, `${asked.stdout}\n${asked.stderr}`);
    assert.deepEqual(environmentAssignments(`${asked.stdout}${asked.stderr}`), []);
    const choice = /--choice (ap_[0-9A-Z]+)/.exec(asked.stderr)?.[1] as string;
    assert.ok(choice, asked.stderr);
    const toFill = ['--to', '<downloads|current|folder>', '--choice', choice];
    const rerun = commandEndingWith(asked.stderr, toFill);
    // The words to fill in come after the located command, unquoted; the command itself saves files, so it carries
    // downloads — the printing process's, made absolute from its working folder.
    assertGmailCommand(
      rerun,
      p,
      [...FOUR_FOLDERS, 'downloadsDir'],
      ['attachments', 'download', 'm1', '--inbox', 'work', ...toFill],
    );

    // Answered "downloads", and run from a fresh shell whose home has a Downloads of its own: saved where it was asked.
    const shell = shellFor(p, 'agent');
    const saved = await posixShellAsync(rerun.replace('<downloads|current|folder>', 'downloads'), shell);
    assert.equal(saved.status, 0, `${saved.stdout}\n${saved.stderr}`);
    assert.equal(readFileSync(join(p.folders.downloadsDir, 'invoice.pdf'), 'utf8'), 'invoice bytes');
    assertClean(shell);

    // Under `confirm`: the person answers at their terminal with `approve`, which saves nothing, so it opens no downloads.
    const tightened = await p.print(['inbox', 'policy', 'work', '--change', 'confirm']);
    assert.equal(tightened.status, 0, tightened.stderr);
    const again = await p.print(['attachments', 'download', 'm1', '--inbox', 'work']);
    assert.equal(again.status, 10, again.stderr);
    const id = /--choice (ap_[0-9A-Z]+)/.exec(again.stderr)?.[1] as string;
    const approve = commandEndingWith(again.stderr, ['approve', id]);
    assertGmailCommand(approve, p, FOUR_FOLDERS, ['approve', id]);
    const then = commandEndingWith(again.stderr, ['--choice', id]);
    assertGmailCommand(
      then,
      p,
      [...FOUR_FOLDERS, 'downloadsDir'],
      ['attachments', 'download', 'm1', '--inbox', 'work', '--choice', id],
    );
    assert.deepEqual(sends(p.harness), []);
    assert.deepEqual(sealAttempts(p.sealLog), [], 'the printing process reached nothing off the machine either');
  },
);

// ── 8a, 8c, 8d: a harmless change, approved with Gmail's own command ────────────────────────────────────────────

test('a Gmail change prepared at the CLI is approved with Gmail’s own command at a fresh terminal and run again from a fresh shell; Google is asked nothing (8a, 8c, 8d)', async () => {
  const p = await printing();
  assert.equal((await p.print(['inbox', 'policy', 'work', '--change', 'confirm'])).status, 0);
  const before = p.harness.google.requests.length;

  const prepared = envelope(await p.print(['inbox', 'policy', 'work', '--send', 'chat', '--json']));
  assert.equal(prepared.error?.code, 'APPROVAL_PENDING', JSON.stringify(prepared));
  const id = String(prepared.error?.details?.approvalId);
  const hint = String(prepared.error?.hint);
  assert.deepEqual(environmentAssignments(hint), []);
  const approve = commandEndingWith(hint, ['approve', id]);
  // Gmail runs the command again as it was given, `--json` and all, with the approval added.
  const tail = ['inbox', 'policy', 'work', '--send', 'chat', '--json', '--approval', id];
  const rerun = commandEndingWith(hint, tail);
  const person = shellFor(p, 'person');
  const agent = shellFor(p, 'agent');

  if (process.platform === 'win32') {
    // No terminal to give a person from here: it refuses for want of one, naming the very command pasted.
    refusesWithoutATerminal(approve, person, ['approve', id]);
  } else {
    assertGmailCommand(approve, p, FOUR_FOLDERS, ['approve', id]);
    assertGmailCommand(rerun, p, FOUR_FOLDERS, tail);
    if (NEEDS_TERMINAL.skip === undefined) {
      const approved = await posixTerminalAsync(approve, person);
      assert.equal(approved.status, 0, approved.stdout);
      assert.match(
        approved.stdout,
        /Approved\. This command approves; the change is applied by the command that prepared it\./,
      );
      const applied = await posixShellAsync(rerun, agent);
      assert.equal(applied.status, 0, `${applied.stdout}\n${applied.stderr}`);
      assert.equal((await p.harness.core.config.load()).inboxes.work?.sendPolicy, 'chat');
    }
  }
  assertClean(person);
  assertClean(agent);
  assert.equal(p.harness.google.requests.length, before, 'Google was asked nothing');
  assert.deepEqual(sends(p.harness), []);
});

test('a Gmail change prepared through Gmail’s server is approved at a fresh terminal, and the server applies it in the same store (8a, 8c, 8d)', async (t) => {
  const p = await printing();
  assert.equal((await p.print(['inbox', 'policy', 'work', '--change', 'confirm'])).status, 0);
  const before = p.harness.google.requests.length;
  const registered = FOUR_FOLDERS.flatMap((key) => [PATH_OPTIONS[key], p.folders[key]]);
  const server = startMcpServer(process.execPath, [...SOURCE_FLAGS, GMAIL_CLI, ...registered, 'mcp'], {
    env: p.env,
    cwd: p.root,
  });
  t.after(() => server.close());

  const asked = await server.call('gmail_inbox_policy', { inbox: 'work', sendPolicy: 'chat' });
  assert.equal(asked.approvalRequired, true, JSON.stringify(asked));
  const id = String(asked.approvalId);
  // What the tool says to do, in its own words: every string it returned.
  const said = Object.values(asked)
    .filter((value): value is string => typeof value === 'string')
    .join('\n');
  const approve = commandEndingWith(said, ['approve', id]);
  assert.deepEqual(environmentAssignments(said), []);
  const person = shellFor(p, 'person');
  if (process.platform === 'win32') {
    refusesWithoutATerminal(approve, person, ['approve', id]);
  } else {
    assertGmailCommand(approve, p, FOUR_FOLDERS, ['approve', id]);
    if (NEEDS_TERMINAL.skip === undefined) {
      const approved = await posixTerminalAsync(approve, person);
      assert.equal(approved.status, 0, approved.stdout);
      const applied = await server.call('gmail_inbox_policy', { inbox: 'work', sendPolicy: 'chat', approvalId: id });
      assert.equal(applied.applied, true, JSON.stringify(applied));
      assert.equal((await p.harness.core.config.load()).inboxes.work?.sendPolicy, 'chat');
    }
  }
  assertClean(person);
  assert.equal(p.harness.google.requests.length, before, 'Google was asked nothing');
  assert.deepEqual(sends(p.harness), []);
  assert.ok(existsSync(join(p.folders.stateDir, 'approvals', `${id}.json`)), 'the approval is in the pinned state');
});

// ── D7: the wait a refusal names, pasted beside the approve ─────────────────────────────────────────────────────

/**
 * Pastes the wait a refusal printed where the agent runs it, and what it then reports: on POSIX at once, while the
 * person approves at a fresh terminal — the wait sees their approval; on Windows, where no test has a terminal to give
 * the person, `approve` refuses for want of one, the approval is cancelled from the printing process, and the wait
 * pasted in each Windows shell finds it there, cancelled. Either way the wait reached the printing process's store, by
 * its pins: from the decoys it would find nothing.
 */
async function waitBesideApprove(
  p: Printing,
  { approve, wait, id, answer }: { approve: string; wait: string; id: string; answer: 'challenge' | 'save' },
): Promise<void> {
  const person = shellFor(p, 'person');
  const agent = shellFor(p, 'agent');
  if (process.platform === 'win32') {
    refusesWithoutATerminal(approve, person, ['approve', id]);
    const cancelled = await p.print(['send', 'cancel', id]);
    assert.equal(cancelled.status, 0, `${cancelled.stdout}\n${cancelled.stderr}`);
    inWindowsShells(wait, agent, (result, name) => {
      assert.equal(result.status, 0, `${name}: ${result.stdout}\n${result.stderr}`);
      assert.match(result.stdout, new RegExp(`^${id}: revoked`, 'm'), name);
    });
  } else if (NEEDS_TERMINAL.skip === undefined) {
    // The agent waits as it was told, and the person approves meanwhile, each in a shell of their own.
    const waiting = posixShellAsync(wait, agent);
    const approved = await posixTerminalAsync(approve, { ...person, answer });
    assert.equal(approved.status, 0, approved.stdout);
    const waited = await waiting;
    assert.equal(waited.status, 0, `${waited.stdout}\n${waited.stderr}`);
    assert.match(
      waited.stdout,
      new RegExp(`^${id}: ${answer === 'save' ? 'answered' : 'approved'}, and can be used now`, 'm'),
    );
  }
  assertClean(person);
  assertClean(agent);
}

test('a send refused for want of the person names Gmail’s own approve and send wait; pasted, the wait sees the person approve at a fresh terminal, and nothing is sent (D7-a)', async () => {
  const p = await printing();
  const context = new GmailContext({ core: p.harness.core, env: p.harness.env });
  const { draftId } = await createDraft(context, 'work', { to: ['sam@partner.test'], subject: 'Tuesday', text: 'hi' });
  const prepared = envelope(await p.print(['send', 'prepare', draftId, '--inbox', 'work', '--json']));
  const id = String(prepared.data?.approvalId);
  const refused = envelope(
    await p.print([
      ...['send', 'execute', draftId, '--inbox', 'work', '--approval', id],
      ...['--expect-to', 'sam@partner.test', '--expect-subject', 'Tuesday', '--json'],
    ]),
  );
  assert.equal(refused.error?.code, 'APPROVAL_PENDING', JSON.stringify(refused));
  const hint = String(refused.error?.hint);
  assert.deepEqual(environmentAssignments(hint), []);
  const approve = commandEndingWith(hint, ['approve', id]);
  const wait = commandEndingWith(hint, ['send', 'wait', id]);
  if (process.platform !== 'win32') {
    assertGmailCommand(approve, p, FOUR_FOLDERS, ['approve', id]);
    assertGmailCommand(wait, p, FOUR_FOLDERS, ['send', 'wait', id]);
  }
  await waitBesideApprove(p, { approve, wait, id, answer: 'challenge' });
  assert.deepEqual(sends(p.harness), [], 'approving and waiting send nothing');
  assert.deepEqual(sealAttempts(p.sealLog), [], 'the printing process reached nothing off the machine either');
});

test('a download under confirm names Gmail’s own approve and its wait; pasted, the wait sees the person answer at a fresh terminal (D7-b)', async () => {
  const p = await printing();
  assert.equal((await p.print(['inbox', 'policy', 'work', '--change', 'confirm'])).status, 0);
  const asked = await p.print(['attachments', 'download', 'm1', '--inbox', 'work']);
  assert.equal(asked.status, 10, asked.stderr);
  const id = /--choice (ap_[0-9A-Z]+)/.exec(asked.stderr)?.[1] as string;
  assert.ok(id, asked.stderr);
  assert.deepEqual(environmentAssignments(`${asked.stdout}${asked.stderr}`), []);
  const approve = commandEndingWith(asked.stderr, ['approve', id]);
  const wait = commandEndingWith(asked.stderr, ['send', 'wait', id]);
  if (process.platform !== 'win32') {
    assertGmailCommand(approve, p, FOUR_FOLDERS, ['approve', id]);
    assertGmailCommand(wait, p, FOUR_FOLDERS, ['send', 'wait', id]);
  }
  await waitBesideApprove(p, { approve, wait, id, answer: 'save' });
  assert.deepEqual(sends(p.harness), []);
});
