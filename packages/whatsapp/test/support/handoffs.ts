import assert from 'node:assert/strict';
import { realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  CHANNELS,
  type CliHandoffs,
  channelManifest,
  cliHandoffs,
  type Handoff,
  type HandoffUse,
  handoffText,
  inlineCommand,
  isCommand,
  type NodeRuntime,
  type ResolvedPaths,
  resolvePaths,
} from '@agentcomms/core';
import { CALLER } from '../../src/caller.ts';

/*
 * What WhatsApp's own CLI and server print for a command, made the way they make it — for a test to compare output
 * with (CUE-403; CONTRIBUTING.md, "Telling a person what to run"). Not a second way to make one: these call core's
 * `cliHandoffs` from this package's own caller, for the folders and shell of the run. A test that cares what the command
 * *is* — this Node, this package's CLI, its pins — checks that on its words with `assertLocatedHere`.
 */

/** The folders a CLI run, or a server, in `env` uses: the four a command is pinned to come from these. */
export function pathsOf(env: NodeJS.ProcessEnv, platform: NodeJS.Platform = 'darwin'): ResolvedPaths {
  return resolvePaths({ env, platform });
}

/** WhatsApp's own handoffs for a run in `env`, quoted for `platform`, as its CLI and server make them. */
export function whatsappHandoffs(
  env: NodeJS.ProcessEnv,
  platform: NodeJS.Platform = 'darwin',
  runtime?: NodeRuntime,
): CliHandoffs {
  return cliHandoffs({
    caller: CALLER,
    paths: pathsOf(env, platform),
    platform,
    env,
    ...(runtime === undefined ? {} : { runtime }),
  });
}

/** WhatsApp's own command with these words, as a value of its own: its line, or its words as JSON with what to do. */
export function ownText(
  env: NodeJS.ProcessEnv,
  words: readonly string[],
  platform: NodeJS.Platform = 'darwin',
  use?: HandoffUse,
): string {
  return handoffText(located(whatsappHandoffs(env, platform).own(words, use)));
}

/** The same, in backticks, as a sentence gives it. */
export function ownInline(
  env: NodeJS.ProcessEnv,
  words: readonly string[],
  platform: NodeJS.Platform = 'darwin',
  use?: HandoffUse,
): string {
  return inlineCommand(located(whatsappHandoffs(env, platform).own(words, use)));
}

/** Core's command, as this package finds it through its installed dependency on core, in backticks. */
export function coreInline(
  env: NodeJS.ProcessEnv,
  words: readonly string[],
  platform: NodeJS.Platform = 'darwin',
): string {
  return inlineCommand(located(whatsappHandoffs(env, platform).core(words)));
}

function located<T extends Handoff>(handoff: T): Exclude<T, { message: string }> {
  assert.ok(isCommand(handoff), `located here: ${'message' in handoff ? handoff.message : ''}`);
  return handoff as Exclude<T, { message: string }>;
}

/** This package's source CLI here — the tests run it from source, so a located command of its own runs this file. */
export const OWN_SOURCE_CLI: string = realpathSync(fileURLToPath(new URL('../../src/cli.ts', import.meta.url)));

/**
 * The words of a command this package printed for itself, checked to be located here: this Node, the flag a TypeScript
 * entry needs, this package's source CLI, the four folders of the run pinned, then `words`.
 */
export function assertLocatedHere(
  commandWords: readonly string[],
  env: NodeJS.ProcessEnv,
  words: readonly string[],
): void {
  const { configDir, stateDir, dataDir, secretsDir } = pathsOf(env);
  assert.deepEqual(commandWords, [
    process.execPath,
    '--experimental-strip-types',
    OWN_SOURCE_CLI,
    '--config-dir',
    configDir,
    '--state-dir',
    stateDir,
    '--data-dir',
    dataDir,
    '--secrets-dir',
    secretsDir,
    ...words,
  ]);
}

/** Every command of this suite, by name — read from the manifests, never listed by hand. */
const SUITE = CHANNELS.flatMap((channel) => {
  const manifest = channelManifest(channel);
  return manifest === undefined ? [] : [manifest.binary, ...(manifest.server.bins ?? [])];
});

/**
 * A suite command named by its bare name, in any case and with a Windows extension, at the start of a shell word:
 * alone in quotes or backticks, or followed by anything to run with it — a subcommand, an option such as `--help`, a
 * placeholder. Prose that names the program and goes on in words (`agent-whatsapp needs Node 22.16`) is a different
 * test's business; every string this is used on is a handoff, where any of these is a command nobody can run.
 */
const BARE = new RegExp(
  `(?:^|[\\s\`'"(\\[,])(?:${SUITE.join('|')})(?:\\.(?:cmd|exe|ps1|bat))?(?:[\`'"]|\\s+[\\w<\\[-])`,
  'i',
);

/** Fails when `text` names a suite command by its bare name, rather than a command located here or none. */
export function assertNoBareCommand(text: string, what = 'the output'): void {
  assert.doesNotMatch(text, BARE, `${what} names a suite command by its bare name: ${text}`);
}

/** Whether `text` would be caught: for the checker's own fixtures. */
export function namesBareCommand(text: string): boolean {
  return BARE.test(text);
}
