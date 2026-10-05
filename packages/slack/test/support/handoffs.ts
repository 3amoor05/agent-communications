import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  CHANNELS,
  type CliHandoffs,
  cliHandoffs,
  type Handoff,
  type HandoffUse,
  handoffSentenceToFill,
  handoffText,
  inlineCommand,
  isCommand,
  type PrintedCommand,
  type ResolvedPaths,
  requireChannelManifest,
} from '@agentcomms/core';
import { SLACK_CALLER } from '../../src/caller.ts';

/*
 * What Slack's CLI and server print for a command, made the way they make it — for a test to compare output with. Not a
 * second way to make one: these call core's same `cliHandoffs` from Slack's own caller, for the same folders and shell
 * (CONTRIBUTING.md, "Telling a person what to run"). A test that cares what the command *is* — its program, its entry,
 * its pins — asserts that on its words too.
 */

/**
 * Folders for a unit test that prints commands but opens no store: what the commands are pinned to. Never made on disk;
 * a test that opens a store uses its harness's folders instead.
 */
export const TEST_PATHS: Readonly<ResolvedPaths> = Object.freeze({
  configDir: resolve('/pins/config'),
  stateDir: resolve('/pins/state'),
  dataDir: resolve('/pins/data'),
  secretsDir: resolve('/pins/secrets'),
  downloadsDir: resolve('/pins/downloads'),
});

/** Slack's own handoffs for these folders and this shell, as its CLI and server make them. */
export function slackHandoffs(
  paths: Readonly<ResolvedPaths> = TEST_PATHS,
  platform: NodeJS.Platform = process.platform,
): CliHandoffs {
  return cliHandoffs({ caller: SLACK_CALLER, paths, platform });
}

/** A handoff that is a command: fails, with why, when it is the sentence saying there is none. */
export function located(handoff: Handoff): PrintedCommand {
  assert.ok(isCommand(handoff), `Slack locates its own command here: ${'message' in handoff ? handoff.message : ''}`);
  return handoff as PrintedCommand;
}

/** Slack's own command with these words, as a value of its own: its line, or its words as JSON with what to do. */
export function slackCommand(
  paths: Readonly<ResolvedPaths>,
  words: readonly string[],
  platform: NodeJS.Platform = process.platform,
  use?: HandoffUse,
): string {
  return handoffText(located(slackHandoffs(paths, platform).own(words, use)));
}

/** The same, in backticks, as a sentence gives it. */
export function slackInline(
  paths: Readonly<ResolvedPaths>,
  words: readonly string[],
  platform: NodeJS.Platform = process.platform,
  use?: HandoffUse,
): string {
  return inlineCommand(located(slackHandoffs(paths, platform).own(words, use)));
}

/** Slack's own command with words for the agent to fill in after it (`<name>`), in backticks, as a sentence gives it. */
export function slackInlineToFill(
  paths: Readonly<ResolvedPaths>,
  words: readonly string[],
  toFill: readonly string[],
  platform: NodeJS.Platform = process.platform,
): string {
  return handoffSentenceToFill(located(slackHandoffs(paths, platform).own(words)), toFill, (command) => command);
}

/** Core's command, from Slack's installed core, in backticks. */
export function coreInline(
  paths: Readonly<ResolvedPaths>,
  words: readonly string[],
  platform: NodeJS.Platform = process.platform,
  use?: HandoffUse,
): string {
  return inlineCommand(located(slackHandoffs(paths, platform).core(words, use)));
}

/** Core's command with words for the agent to fill in after it (`<folder>`), in backticks, as a sentence gives it. */
export function coreInlineToFill(
  paths: Readonly<ResolvedPaths>,
  words: readonly string[],
  toFill: readonly string[],
  platform: NodeJS.Platform = process.platform,
): string {
  return handoffSentenceToFill(located(slackHandoffs(paths, platform).core(words)), toFill, (command) => command);
}

/** Every command of this suite, by name, in any case and with a Windows extension. */
const SUITE = CHANNELS.flatMap((channel) => {
  const manifest = requireChannelManifest(channel);
  return [manifest.binary, ...(manifest.server.bins ?? [])];
});
const NAME = `(?:${SUITE.join('|')})(?:\\.(?:cmd|exe|ps1|bat))?`;
/** A suite name followed by anything to run with it, or one alone as a command in backticks: in any case. */
const BARE = new RegExp(`(?:^|[\\s\`'"(\\[,])${NAME}\\s+[\\w<\\[-]|\`${NAME}\``, 'i');

/** Fails when `text` names a suite command by its bare name, alone or followed by anything to run with it. */
export function assertNoBareCommand(text: string, what = 'the output'): void {
  assert.doesNotMatch(text, BARE, `${what} names a suite command by its bare name: ${text}`);
}

/** Slack's own CLI entry here: its source, since the tests run Slack from source. */
export const SLACK_SOURCE_CLI: string = fileURLToPath(new URL('../../src/cli.ts', import.meta.url));

/**
 * The words of a printed POSIX line, as a POSIX shell reads them: a single-quoted word is taken as it stands (with
 * `'\\''` for a quote inside it), and anything else splits on spaces. Enough for what Slack prints with `darwin`
 * pinned — on a Windows runner too, where this Node's path is a quoted word with backslashes in it.
 */
export function posixWords(line: string): string[] {
  return [...line.matchAll(/'((?:[^']|'\\'')*)'|(\S+)/g)].map((match) =>
    match[1] !== undefined ? match[1].replaceAll("'\\''", "'") : (match[2] as string),
  );
}

/**
 * The command in backticks in `text` that ends with `words`, checked to be Slack's own, located: this Node, then Slack's
 * CLI entry here, then path pins, then the words. For output whose folders a test cannot name in advance.
 */
export function locatedSlackLine(text: string, words: readonly string[]): string {
  const line = [...text.matchAll(/`([^`]+)`/g)]
    .map((match) => match[1] as string)
    .find((each) => posixWords(each).slice(-words.length).join('\0') === words.join('\0'));
  assert.ok(line !== undefined, `no command ending in "${words.join(' ')}" in: ${text}`);
  const printed = posixWords(line);
  assert.equal(printed[0], process.execPath, `the program is this Node: ${line}`);
  assert.ok(printed.includes(SLACK_SOURCE_CLI), `it runs Slack's own CLI: ${line}`);
  assertNoBareCommand(text);
  return line;
}

/**
 * What Slack's CLI is given when a person pastes a printed POSIX line: the words after its entry, the folder pins
 * first. Checked to be this Node running Slack's own entry here, so a test that runs a printed command in process runs
 * exactly what the line would, pins and all.
 */
export function argvAfterEntry(line: string): string[] {
  const words = posixWords(line);
  assert.equal(words[0], process.execPath, `the program is this Node: ${line}`);
  const entry = words.indexOf(SLACK_SOURCE_CLI);
  assert.ok(entry > 0, `it runs Slack's own CLI: ${line}`);
  return words.slice(entry + 1);
}
