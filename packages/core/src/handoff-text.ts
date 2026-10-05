import { CHANNEL_SNAPSHOT } from './channels.generated.ts';
import type { CliCommandNotLocated, PrintedCommand } from './cli-command.ts';
import { commandText, inlineCommand, lineWithWordsToFill, type ShellCommand, shellCommand } from './cli-runtime.ts';
import type { PathName } from './paths.ts';

/**
 * A handoff as words a person reads, and what a core function that prints one is given (CUE-403; CONTRIBUTING.md,
 * "Telling a person what to run"). `handoffs.ts` makes located handoffs and re-exports all of this.
 *
 * Kept apart from the locator on purpose: the configuration store, the secret stores and the attachment jail print
 * handoffs too, and the locator's own imports reach the configuration store, so importing it from them would be a
 * cycle. Nothing here locates anything or imports a module that does: a located command is made by `handoffs.ts` and
 * handed in, and what is here only renders one — or, with none handed in, prints the bare commands of the deprecated
 * bridge.
 */

/** A command for a person to run, located, or the sentence saying why there is none here. */
export type Handoff = PrintedCommand | CliCommandNotLocated;

export interface HandoffUse {
  /** The suite folders the command reads or writes; the four every command opens when left out. */
  readonly uses?: readonly PathName[] | undefined;
  /** It also reads or writes downloads, so the downloads folder is pinned too. */
  readonly downloads?: boolean | undefined;
}

/**
 * What makes a package's commands. `CliHandoffs` is the real one; a package that has not given core its caller yet gets
 * the deprecated bridge from `handoffsFor`, whose commands are bare names, as before CUE-403.
 */
export interface HandoffMaker {
  /** The shell the commands are quoted for. */
  readonly platform: NodeJS.Platform;
  /** The printing package's own CLI, with these words after the program. */
  own(words: readonly string[], use?: HandoffUse): Handoff | ShellCommand;
  /** The core CLI: the printing package's own when that is core, the core it has installed otherwise. */
  core(words: readonly string[], use?: HandoffUse): Handoff | ShellCommand;
  /** The CLI of `channel` — `core`, `gmail`, `slack` …: own, core, or another product found among its registrations. */
  of(channel: string, words: readonly string[], use?: HandoffUse): Handoff | ShellCommand;
}

/**
 * What a core function that prints a command for its caller takes where it used to take the shell's `platform`: the
 * caller's handoffs, which carry their platform. A bare platform still works, and prints the deprecated bridge's bare
 * commands, until every package gives core its caller (CUE-403 task 15).
 */
export type HandoffsOrPlatform = HandoffMaker | NodeJS.Platform;

/**
 * The deprecated bridge: commands by their bare names, as before CUE-403 — its own named by `approveCommand`
 * (`agent-gmail approve`), or `agentcomms`. Only `handoffsFor` and `asHandoffMaker` make one.
 */
export function bareHandoffs(platform: NodeJS.Platform, approveCommand?: string | undefined): HandoffMaker {
  // The approve command as the package named it — its own words for `approve` — and its program for everything else.
  const approve = (approveCommand ?? 'agentcomms approve').trim().split(/\s+/);
  const ownBinary = approve[0] as string;
  return Object.freeze({
    platform,
    own: (words: readonly string[]) =>
      shellCommand(words[0] === 'approve' ? [...approve, ...words.slice(1)] : [ownBinary, ...words], platform),
    core: (words: readonly string[]) => shellCommand(['agentcomms', ...words], platform),
    of: (channel: string, words: readonly string[]) => {
      const entry = CHANNEL_SNAPSHOT.find((each) => each.manifest.channel === channel);
      if (entry === undefined) throw new TypeError(`"${channel}" is not a channel of this release`);
      return shellCommand([entry.manifest.binary, ...words], platform);
    },
  });
}

/** The handoffs a core function was given — or, for a bare platform or none, the bridge's for that shell. */
export function asHandoffMaker(handoffs: HandoffsOrPlatform | undefined): HandoffMaker {
  if (handoffs === undefined) return bareHandoffs(process.platform);
  return typeof handoffs === 'string' ? bareHandoffs(handoffs) : handoffs;
}

/** The shell a function's `HandoffsOrPlatform` quotes for. */
export function platformOf(handoffs: HandoffsOrPlatform | undefined): NodeJS.Platform {
  if (handoffs === undefined) return process.platform;
  return typeof handoffs === 'string' ? handoffs : handoffs.platform;
}

/** Whether a handoff is a command to run, rather than the sentence saying why there is none. */
export function isCommand(handoff: Handoff | ShellCommand): handoff is PrintedCommand | ShellCommand {
  return !('message' in handoff);
}

/**
 * A handoff as a value of its own — a list's line, a field's value: the command's line, or its words as JSON with what
 * to do when no line is safe in every Windows shell; or, with no command, the sentence saying why.
 */
export function handoffText(handoff: Handoff | ShellCommand): string {
  return isCommand(handoff) ? commandText(handoff) : handoff.message;
}

export interface HandoffSentenceOptions {
  /**
   * Said before the reason when there is no command: another way to do it that needs no command — a tool to call from
   * a chat — as a sentence of its own. The command's sentence usually names it too.
   */
  readonly instead?: string | undefined;
}

/** The sentence saying why there is no command, after another way when there is one. */
function noCommand(handoff: CliCommandNotLocated, options: HandoffSentenceOptions): string {
  return options.instead === undefined ? handoff.message : `${options.instead} ${handoff.message}`;
}

/**
 * A sentence that gives the command, in backticks, made by `say`; or, with no command, the sentence saying why there is
 * none — after `instead`, when given — never `say` with something else in the command's place.
 */
export function handoffSentence(
  handoff: Handoff | ShellCommand,
  say: (command: string) => string,
  options: HandoffSentenceOptions = {},
): string {
  return isCommand(handoff) ? say(inlineCommand(handoff)) : noCommand(handoff, options);
}

/**
 * As `handoffSentence`, for a command with words the agent is to fill in — a placeholder such as `<folder>`, printed as
 * written — before its first `--`. With no line to show them in, the command is shown as its words, placeholders among
 * them, saying it has to be typed.
 */
export function handoffSentenceToFill(
  handoff: Handoff | ShellCommand,
  toFill: readonly string[],
  say: (command: string) => string,
  options: HandoffSentenceOptions = {},
): string {
  if (!isCommand(handoff)) return noCommand(handoff, options);
  const line = lineWithWordsToFill(handoff, ...toFill);
  if (line !== null) return say(`\`${line}\``);
  return say(inlineCommand(shellCommand([...handoff.words, ...toFill], handoff.platform)));
}

/**
 * Commands that each could do it — one per channel, say — as one phrase: the commands joined by "or", then, for each
 * that has none here, the sentence saying why. `none` is said when not one of them is a command.
 */
export function handoffChoices(
  handoffs: readonly (Handoff | ShellCommand)[],
  none: string,
  options: { conjunction?: 'or' | 'and' } = {},
): string {
  const commands = handoffs.filter(isCommand).map((handoff) => inlineCommand(handoff));
  const missing = handoffs.filter((handoff): handoff is CliCommandNotLocated => !isCommand(handoff));
  // The same reason for each is said once: five mailboxes on a product that is not registered are one reason.
  const reasons = [...new Set(missing.map((handoff) => handoff.message))].join(' ');
  if (commands.length === 0) return `${none} ${reasons}`.trim();
  const conjunction = options.conjunction ?? 'or';
  const joined =
    commands.length === 1
      ? (commands[0] as string)
      : `${commands.slice(0, -1).join(', ')} ${conjunction} ${commands.at(-1)}`;
  return reasons === '' ? joined : `${joined} (${reasons.replace(/\.$/, '')})`;
}
