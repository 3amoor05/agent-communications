/*
 * §4 7e-encapsulation (CUE-403 task 15): there are two kinds of command a person is told to run, and each is made in
 * one place. A `PrintedCommand` — one of this suite's own CLIs — only by the locator, in `cli-command.ts`; an
 * `ExternalCommand` — any other program — only by `externalCommand`. Neither class, nor the gate its constructor
 * checks, is reachable from `command-brands.ts`, `cli-command.ts` or core's public entry; neither type can be forged
 * from an object of the same shape; and the types themselves stay usable, as a parameter or a return type.
 *
 * Each `@ts-expect-error` is a way round the locator that must not compile. Compiled by
 * `test/printed-command-types.test.mjs`: one that compiled would leave its directive unused, a compile error too.
 */

import * as locator from '../../../../packages/core/src/cli-command.ts';
import * as brands from '../../../../packages/core/src/command-brands.ts';
import type { ExternalCommand, PrintedCommand } from '../../../../packages/core/src/index.ts';
import * as entry from '../../../../packages/core/src/index.ts';

// ── The locator's own module: the class is a type only, and its gate is not exported ───────────────────────────────

// @ts-expect-error the class is exported as a type only, so it is no value to construct
export const LocatorClass = locator.PrintedCommand;
// @ts-expect-error the gate a constructor call has to pass stays in the module
export const locatorGate = locator.GATE;

// ── The external brand's module: no `PrintedCommand` at all, and its own class and gate kept in ────────────────────

// @ts-expect-error `command-brands.ts` makes no printed command
export const brandsPrinted = brands.PrintedCommand;
// @ts-expect-error nor exposes the external command's class
export const ExternalClass = brands.ExternalCommand;
// @ts-expect-error nor its gate
export const brandsGate = brands.GATE;

// ── Core's public entry: the two types and their two constructors' callers, and nothing else ──────────────────────

// @ts-expect-error no class to construct a printed command with
export const EntryPrinted = entry.PrintedCommand;
// @ts-expect-error no class to construct an external command with
export const EntryExternal = entry.ExternalCommand;
// @ts-expect-error no gate
export const entryGate = entry.GATE;
// @ts-expect-error no quoting that hands back something printable: the bare-name era's constructor is gone
export const bareName = entry.shellCommand;
// @ts-expect-error nor the internal quoting the two brands use
export const quoting = entry.quoteCommand;
// @ts-expect-error nor the bridge that printed bare names
export const bridge = entry.handoffsFor;

// ── Neither type can be made from an object of the same shape ───────────────────────────────────────────────────

// @ts-expect-error the private field is the brand: no object literal of the same shape has it
export const forgedPrinted: PrintedCommand = {
  words: ['node', 'cli.mjs', 'approve'],
  line: 'node cli.mjs approve',
  platform: 'linux',
  entry: '/x/cli.mjs',
  toJSON: () => 'node cli.mjs approve',
};

// @ts-expect-error an external command made by hand, not by `externalCommand`
export const forgedExternal: ExternalCommand = {
  words: ['chmod', '700', '/x'],
  line: 'chmod 700 /x',
  platform: 'linux',
  reason: 'x',
};

// ── What stays usable: the types, as parameters and return types, and the two ways to make one ─────────────────────

export function relay(command: PrintedCommand): PrintedCommand {
  return command;
}

export function external(words: readonly string[]): ExternalCommand {
  return entry.externalCommand(words, 'a program this suite does not ship', 'linux');
}

export const locate: typeof entry.locateCliCommand = entry.locateCliCommand;
