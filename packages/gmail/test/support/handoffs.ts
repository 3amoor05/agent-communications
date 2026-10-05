import assert from 'node:assert/strict';
import { mkdtempSync, readdirSync, readFileSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  type CliHandoffs,
  cliHandoffs,
  type HandoffUse,
  handoffText,
  inlineCommand,
  isCommand,
  type ResolvedPaths,
  resolvePaths,
} from '@agentcomms/core';
import { GMAIL_CALLER } from '../../src/caller.ts';

/*
 * What Gmail's CLI and server print for a command, made the way they make it — for a test to compare output with
 * (CUE-403). Not a second way to make one: these call core's `cliHandoffs` from Gmail's own caller, for the same
 * folders and shell. A test that cares what the command *is* — its program, its entry, its pins — asserts that on its
 * words too, with `gmailRetryWords`.
 */

/** Gmail's own handoffs for these folders and this shell, as its CLI and server make them. */
export function gmailHandoffs(
  paths: Readonly<ResolvedPaths>,
  platform: NodeJS.Platform = process.platform,
): CliHandoffs {
  return cliHandoffs({ caller: GMAIL_CALLER, paths, platform });
}

/**
 * Gmail's own handoffs for a home of the test's own — never the real one — for a renderer or a refusal tested without a
 * harness: the folders only pin the command, and nothing is read from them.
 */
export function testHandoffs(platform: NodeJS.Platform = process.platform): CliHandoffs {
  const home = realpathSync.native(mkdtempSync(join(tmpdir(), 'agent-gmail-handoffs-')));
  return gmailHandoffs(resolvePaths({ env: { HOME: home, USERPROFILE: home }, platform }), platform);
}

/** Gmail's own command with these words, as a value of its own: its line, or its words as JSON with what to do. */
export function gmailCommand(
  paths: Readonly<ResolvedPaths>,
  words: readonly string[],
  platform: NodeJS.Platform = process.platform,
  use?: HandoffUse,
): string {
  return handoffText(gmailHandoffs(paths, platform).own(words, use));
}

/** The same, in backticks, as a sentence gives it — asserting there is one here. */
export function gmailInline(
  paths: Readonly<ResolvedPaths>,
  words: readonly string[],
  platform: NodeJS.Platform = process.platform,
  use?: HandoffUse,
): string {
  const handoff = gmailHandoffs(paths, platform).own(words, use);
  assert.ok(isCommand(handoff), `Gmail locates its own command here: ${'message' in handoff ? handoff.message : ''}`);
  return inlineCommand(handoff);
}

/** Gmail's own CLI entry here: its source, since the tests run Gmail from source. */
export const GMAIL_SOURCE_CLI: string = fileURLToPath(new URL('../../src/cli.ts', import.meta.url));

/** Core's CLI entry here, which a Gmail run from source locates through its workspace dependency on core. */
export const CORE_SOURCE_CLI: string = fileURLToPath(new URL('../../../core/src/cli.ts', import.meta.url));

/**
 * Every command of this suite by name — each package's manifest binary and server bins, read from this checkout's
 * manifests rather than listed here, so a channel added later is covered — in any case and with a Windows extension.
 */
const PACKAGES = fileURLToPath(new URL('../../..', import.meta.url));
const SUITE = readdirSync(PACKAGES).flatMap((name) => {
  try {
    const manifest = JSON.parse(readFileSync(join(PACKAGES, name, 'package.json'), 'utf8')) as {
      agentcomms?: { binary?: string; server?: { bins?: string[] } };
    };
    const { agentcomms } = manifest;
    return agentcomms?.binary ? [agentcomms.binary, ...(agentcomms.server?.bins ?? [])] : [];
  } catch {
    return [];
  }
});
const escaped = SUITE.map((name) => name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
const BARE = new RegExp(`(?:^|[\\s\`'"(\\[,])(?:${escaped.join('|')})(?:\\.(?:cmd|exe|ps1|bat))?\\s+[\\w<\\[-]`, 'i');

/** The suite's command names this checks for: for a test that the check is not vacuous. */
export const SUITE_COMMANDS: readonly string[] = Object.freeze([...SUITE]);

/** Fails when `text` names a suite command by its bare name — in any case — followed by anything to run with it. */
export function assertNoBareCommand(text: string, what = 'the output'): void {
  assert.doesNotMatch(text, BARE, `${what} names a suite command by its bare name: ${text}`);
}

/** The words of a POSIX line, as a POSIX shell splits them: what a printed command hands the program. */
export function splitPosixWords(line: string): string[] {
  const words: string[] = [];
  let word = '';
  let started = false;
  let quote: 'single' | 'double' | null = null;
  for (let index = 0; index < line.length; index += 1) {
    const character = line[index] ?? '';
    if (quote === 'single') {
      if (character === "'") quote = null;
      else word += character;
      continue;
    }
    if (quote === 'double') {
      if (character === '"') {
        quote = null;
        continue;
      }
      if (character === '\\') {
        const escapedCharacter = line[index + 1];
        if (escapedCharacter === undefined) throw new Error('a POSIX command cannot end with a backslash');
        if (escapedCharacter === '\n') {
          index += 1;
          continue;
        }
        if (['$', '`', '"', '\\'].includes(escapedCharacter)) {
          word += escapedCharacter;
          index += 1;
          continue;
        }
      }
      word += character;
      continue;
    }
    if (/\s/.test(character)) {
      if (started) {
        words.push(word);
        word = '';
        started = false;
      }
      continue;
    }
    started = true;
    if (character === "'") quote = 'single';
    else if (character === '"') quote = 'double';
    else if (character === '\\') {
      const escapedCharacter = line[index + 1];
      if (escapedCharacter === undefined) throw new Error('a POSIX command cannot end with a backslash');
      index += 1;
      if (escapedCharacter !== '\n') word += escapedCharacter;
    } else word += character;
  }
  if (quote !== null) throw new Error(`an ${quote}-quoted word was not closed`);
  if (started) words.push(word);
  return words;
}

/**
 * The words after the program of a POSIX line Gmail printed for itself, checked to be its own command located here:
 * this Node, the flag a TypeScript entry needs and no other, Gmail's own `src/cli.ts`, then the rest — what a test runs
 * again in-process with `run(words)`.
 */
export function gmailRetryWords(line: string): string[] {
  const [program, flag, entry, ...rest] = splitPosixWords(line);
  assert.equal(program, process.execPath, `the program is this Node: ${line}`);
  assert.equal(
    flag,
    '--experimental-strip-types',
    `a TypeScript entry is run with strip-types, and nothing else: ${line}`,
  );
  assert.equal(entry, GMAIL_SOURCE_CLI, `it runs Gmail's own CLI: ${line}`);
  return rest;
}

/** The command in backticks in `text` that ends with `words`, checked to be Gmail's own, located; its line. */
export function locatedGmailLine(text: string, words: readonly string[]): string {
  const tail = ` ${words.join(' ')}`;
  const line = [...text.matchAll(/`([^`]+)`/g)].map((match) => match[1] as string).find((each) => each.endsWith(tail));
  assert.ok(line !== undefined, `no command ending in "${tail.trim()}" in: ${text}`);
  gmailRetryWords(line);
  assertNoBareCommand(text);
  return line;
}

/**
 * The command in backticks in `text` that ends with `words`, checked to be core's own, located from Gmail through its
 * runtime dependency on core: this Node, strip-types, core's `src/cli.ts` in this checkout, pins, the words.
 */
export function locatedCoreLine(text: string, words: readonly string[]): string {
  const tail = ` ${words.join(' ')}`;
  const line = [...text.matchAll(/`([^`]+)`/g)].map((match) => match[1] as string).find((each) => each.endsWith(tail));
  assert.ok(line !== undefined, `no command ending in "${tail.trim()}" in: ${text}`);
  const [program, flag, entry, ...rest] = splitPosixWords(line);
  assert.equal(program, process.execPath, `the program is this Node: ${line}`);
  assert.equal(flag, '--experimental-strip-types', `core's source entry runs with strip-types: ${line}`);
  assert.equal(entry, CORE_SOURCE_CLI, `it runs core's own CLI, through Gmail's dependency on it: ${line}`);
  assert.equal(rest[0], '--config-dir', `with the folders pinned: ${line}`);
  assertNoBareCommand(text);
  return line;
}
