import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import {
  CHANNELS,
  type CliCommandNotLocated,
  type CliHandoffs,
  type Core,
  channelManifest,
  cliHandoffs,
  type HandoffUse,
  handoffText,
  inlineCommand,
  isCommand,
  type NodeRuntime,
  type ResolvedPaths,
} from '@agentcomms/core';
import { RESEND_CALLER } from '../../src/caller.ts';

/*
 * What this package prints for a command, made the way it makes it — for a test to compare output with (CUE-403; the
 * pattern of core's `test/helpers/handoffs.ts`). Not a second way to make one: these call core's `cliHandoffs` from
 * this package's own caller, for the same folders and shell. A test that cares what the command *is* — its program, its
 * entry, its pins — asserts that on its words too (`locatedResendLine`).
 */

/** Resend's own handoffs for these folders and this shell, as its CLI and server make them. */
export function resendHandoffs(
  paths: Readonly<ResolvedPaths>,
  platform: NodeJS.Platform = process.platform,
  runtime?: NodeRuntime,
): CliHandoffs {
  return cliHandoffs({ caller: RESEND_CALLER, paths, platform, ...(runtime === undefined ? {} : { runtime }) });
}

/** Resend's own command with these words in backticks, as a sentence gives it; asserted to be located. */
export function resendInline(
  core: Pick<Core, 'paths'>,
  words: readonly string[],
  platform: NodeJS.Platform = 'darwin',
  use?: HandoffUse,
): string {
  const handoff = resendHandoffs(core.paths, platform).own(words, use);
  assert.ok(isCommand(handoff), `Resend locates its own command here: ${'message' in handoff ? handoff.message : ''}`);
  return inlineCommand(handoff);
}

/** The same as a value of its own: its line, or its words as JSON with what to do. */
export function resendText(
  core: Pick<Core, 'paths'>,
  words: readonly string[],
  platform: NodeJS.Platform = 'darwin',
  use?: HandoffUse,
): string {
  return handoffText(resendHandoffs(core.paths, platform).own(words, use));
}

/** Core's command, as this package finds it through its installed dependency on core. */
export function coreText(
  core: Pick<Core, 'paths'>,
  words: readonly string[],
  platform: NodeJS.Platform = 'darwin',
): string {
  return handoffText(resendHandoffs(core.paths, platform).core(words));
}

/** A Node outside Resend's `engines.node`: every command located for it is the not-locatable sentence. */
export const OLD_NODE: NodeRuntime = Object.freeze({ version: 'v20.0.0', execArgv: [] });

/** Why there is no command, for a Node that Resend does not run on. */
export function notLocatable(core: Pick<Core, 'paths'>): CliCommandNotLocated {
  const handoff = resendHandoffs(core.paths, 'darwin', OLD_NODE).own(['doctor']);
  assert.ok(!isCommand(handoff), 'an old Node locates nothing');
  return handoff;
}

/** Every command of this suite, by name — any case, with or without a Windows extension. */
const SUITE = CHANNELS.flatMap((channel) => {
  const manifest = channelManifest(channel);
  return manifest === undefined ? [] : [manifest.binary, ...(manifest.server.bins ?? [])];
});
const BARE: RegExp = new RegExp(
  `(?:^|[\\s\`'"(\\[,])(?:${SUITE.join('|')})(?:\\.(?:cmd|exe|ps1|bat))?(?:\\s+[\\w<\\[-]|\`|'|"|$)`,
  'im',
);

/** The suite commands `assertNoBareCommand` knows, for a test that checks it knows Resend's. */
export const SUITE_COMMANDS: readonly string[] = Object.freeze(SUITE);

/**
 * Fails when `text` names a suite command by its bare name: alone in quotes or backticks, or followed by anything to
 * run with it — in any case, with a Windows extension or without.
 */
export function assertNoBareCommand(text: string, what = 'the output'): void {
  assert.doesNotMatch(text, BARE, `${what} names a suite command by its bare name: ${text}`);
}

/** Resend's own CLI entry here: its source, since the tests run it from source. */
export const RESEND_SOURCE_CLI: string = fileURLToPath(new URL('../../src/cli.ts', import.meta.url));

/**
 * The command in backticks in `text` that ends with `words`, checked to be Resend's own, located: this Node, then
 * Resend's CLI entry here, then path pins, then the words. For output whose folders a test cannot name in advance.
 */
export function locatedResendLine(text: string, words: readonly string[]): string {
  const tail = ` ${words.join(' ')}`;
  const line = [...text.matchAll(/`([^`]+)`/g)].map((match) => match[1] as string).find((each) => each.endsWith(tail));
  assert.ok(line !== undefined, `no command ending in "${tail.trim()}" in: ${text}`);
  assert.ok(line.startsWith(`${process.execPath} `), `the program is this Node: ${line}`);
  assert.ok(line.includes(` ${RESEND_SOURCE_CLI} `), `it runs Resend's own CLI: ${line}`);
  assertNoBareCommand(text);
  return line;
}
