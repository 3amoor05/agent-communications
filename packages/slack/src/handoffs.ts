import { type Handoff, inlineCommand, isCommand, type PrintedCommand } from '@agentcomms/core';

/**
 * One sentence that names several of this package's commands — the app's manifest, then `app update`, then the move —
 * or, when any of them has no command here, the way that needs none and why (CONTRIBUTING.md, "Telling a person what to
 * run"). They come from one locator and one caller, so in practice they are all commands or none are; said once either
 * way, never as a sentence with a gap where a command was.
 *
 * Each command is shown in backticks, as a sentence gives one (`inlineCommand`), or as `show` renders it — core's
 * `commandText` for a line of its own, as a terminal's list prints it.
 */
export function handoffsSentence(
  handoffs: readonly Handoff[],
  say: (commands: readonly string[]) => string,
  instead: string,
  show: (command: PrintedCommand) => string = inlineCommand,
): string {
  const missing = handoffs.find((handoff) => !isCommand(handoff));
  if (missing === undefined) return say(handoffs.map((handoff) => show(handoff as PrintedCommand)));
  return `${instead} ${(missing as Exclude<Handoff, PrintedCommand>).message}`;
}
