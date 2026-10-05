import assert from 'node:assert/strict';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
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
  refusesWithoutATerminal,
  type Shell,
  sealAttempts,
  suiteCommandsOn,
  suiteTraces,
  wordsOf,
} from '../../../test/helpers/real-shell.mjs';
import { type Harness, newHarness } from './support/harness.ts';

/*
 * Resend's terminal approval pasted into a real shell (CUE-403; design 2026-10-04 §4 item 8). A harmless change —
 * loosening how an account's sends are approved — is prepared at Resend's CLI and through its server, in this process,
 * against the loopback fake Resend, which records every request and every send. The approve command each gives is
 * Resend's own, as this checkout runs it: this Node, type stripping and `src/cli.ts`, with the harness's folders
 * pinned. A person pastes it into a fresh shell with a terminal (`test/helpers/real-shell.mjs`): no suite command on
 * PATH, every suite variable a decoy, another working folder, and a seal that refuses the keychain and every
 * connection off the machine. No email is sent, and Resend is asked nothing.
 */

const RESEND_CLI = real(fileURLToPath(new URL('../src/cli.ts', import.meta.url)));
const SOURCE_FLAGS = ['--experimental-strip-types'];
const ACCOUNT = 'acme/resend';

/** An account that can send under `confirm`, its changes approved under `confirm`, and the fake Resend behind it. */
async function machine(): Promise<Harness> {
  const harness = await newHarness();
  await harness.addAccount({ name: ACCOUNT, tier: 'sending_access', sendPolicy: 'confirm', changePolicy: 'confirm' });
  return harness;
}

function shellFor(harness: Harness, name: string): Shell {
  const shell = freshShell(join(harness.dir, 'shells', name));
  assert.deepEqual(suiteCommandsOn(shell.env.PATH), [], 'no suite command on the fresh shell’s PATH');
  return shell;
}

/** Nothing of the shell's reached a keychain or left the machine, no decoy was used, and Resend was asked nothing. */
function assertClean(harness: Harness, shell: Shell, before: number): void {
  assert.deepEqual(sealAttempts(shell.sealLog), [], 'no keychain and no connection off the machine');
  assert.deepEqual(suiteTraces(shell), [], 'no suite folder found from the shell’s environment');
  assert.deepEqual(harness.fake.sends(), [], 'no email was sent');
  assert.equal(harness.fake.requests.length, before, 'Resend was asked nothing');
}

/** Resend's own command, as this checkout runs it, pinned to exactly the harness's four folders, then `tail`. */
function assertResendCommand(command: string, harness: Harness, tail: readonly string[]): void {
  const words = wordsOf(command);
  assert.ok(words !== null, `a line to paste: ${command}`);
  assert.deepEqual(words.slice(0, 3), [process.execPath, ...SOURCE_FLAGS, RESEND_CLI], command);
  const pins = pinsOf(words);
  assert.deepEqual(Object.keys(pins).sort(), [...FOUR_FOLDERS].sort(), command);
  for (const key of FOUR_FOLDERS) {
    assert.equal(pins[key], harness.core.paths[key], `${PATH_OPTIONS[key]}: ${command}`);
    assert.ok(isCanonical(pins[key] as string), command);
  }
  assert.deepEqual(words.slice(3 + FOUR_FOLDERS.length * 2), tail, command);
}

/**
 * Pastes `approve` where a person would: a terminal of their own on POSIX, the code typed back. Windows gives a test no
 * terminal, so there each shell runs it and it refuses for want of one, naming the very command pasted.
 */
async function personApproves(harness: Harness, approve: string, id: string, shell: Shell): Promise<boolean> {
  if (process.platform === 'win32') {
    refusesWithoutATerminal(approve, shell, ['approve', id]);
    return false;
  }
  assertResendCommand(approve, harness, ['approve', id]);
  if (NEEDS_TERMINAL.skip !== undefined) return false;
  const approved = await posixTerminalAsync(approve, shell);
  assert.equal(approved.status, 0, approved.stdout);
  assert.match(approved.stdout, /Approved/);
  return true;
}

test('a Resend change prepared at the CLI is approved with Resend’s own command at a fresh terminal and run again from a fresh shell; nothing is sent (8a, 8c, 8d)', async (t) => {
  const harness = await machine();
  t.after(() => harness.close());
  const before = harness.fake.requests.length;
  const prepared = await harness.cli(['--json', 'account', 'policy', ACCOUNT, '--send', 'chat'], {
    platform: process.platform,
  });
  assert.equal(prepared.code, 10, prepared.stdout);
  const { error } = prepared.json();
  const id = String(error?.details?.approvalId);
  const hint = String(error?.hint);
  assert.deepEqual(environmentAssignments(hint), []);
  const approve = commandEndingWith(hint, ['approve', id]);
  const tail = ['account', 'policy', ACCOUNT, '--send', 'chat', '--approval', id];
  const rerun = commandEndingWith(hint, tail);

  const person = shellFor(harness, 'person');
  if (await personApproves(harness, approve, id, person)) {
    assertResendCommand(rerun, harness, tail);
    const agent = shellFor(harness, 'agent');
    const applied = await posixShellAsync(rerun, agent);
    assert.equal(applied.status, 0, `${applied.stdout}\n${applied.stderr}`);
    assert.equal((await harness.core.config.load()).accounts[ACCOUNT]?.sendPolicy, 'chat');
    assertClean(harness, agent, before);
  }
  assertClean(harness, person, before);
});

test('a Resend change prepared through Resend’s server is approved at a fresh terminal, and the server applies it in the same store (8a, 8c, 8d)', async (t) => {
  const harness = await machine();
  t.after(() => harness.close());
  const before = harness.fake.requests.length;
  const server = await harness.mcp({ platform: process.platform });
  t.after(() => server.close());
  const call = async (args: Record<string, unknown>) =>
    (await server.call('resend_account_policy', args)).structuredContent as Record<string, unknown>;

  const asked = await call({ account: ACCOUNT, sendPolicy: 'chat' });
  assert.equal(asked.approvalRequired, true, JSON.stringify(asked));
  const id = String(asked.approvalId);
  const said = Object.values(asked)
    .filter((value): value is string => typeof value === 'string')
    .join('\n');
  assert.deepEqual(environmentAssignments(said), []);
  const approve = commandEndingWith(said, ['approve', id]);

  const person = shellFor(harness, 'person');
  if (await personApproves(harness, approve, id, person)) {
    const applied = await call({ account: ACCOUNT, sendPolicy: 'chat', approvalId: id });
    assert.equal(applied.applied, true, JSON.stringify(applied));
    assert.equal((await harness.core.config.load()).accounts[ACCOUNT]?.sendPolicy, 'chat');
  }
  assertClean(harness, person, before);
});
