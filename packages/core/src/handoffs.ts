import type { ChannelEntry } from './channel-manifest.ts';
import { CHANNEL_SNAPSHOT } from './channels.generated.ts';
import {
  type CliCommandCaller,
  type CliCommandNotLocated,
  locateCliCommand,
  type NodeRuntime,
  type PrintedCommand,
} from './cli-command.ts';
import { commandText, inlineCommand, lineWithWordsToFill, type ShellCommand, shellCommand } from './cli-runtime.ts';
import { type RegisteredServer, scanRegisteredServers } from './mcp-clients.ts';
import type { PathName, ResolvedPaths } from './paths.ts';

/**
 * The commands a package tells a person to run, made once per printing process (design 2026-10-04, D1 and D5;
 * CUE-403). How a channel migrates a handoff to these is in CONTRIBUTING.md, "Telling a person what to run".
 *
 * A package makes them from where it is — a module of its own and its package name, the caller — with the folders and
 * shell of the process printing: `openCore({ caller })` puts them on `core.handoffs`. Each method takes the CLI's own
 * words, never the program, and returns a `Handoff`: a located `PrintedCommand`, or why there is none here. Nothing
 * here quotes a line by hand, names a bare binary, or guesses an installation.
 */

/** A command for a person to run, located, or the sentence saying why there is none here. */
export type Handoff = PrintedCommand | CliCommandNotLocated;

/** The suite folders every CLI command opens: what a command is pinned to unless it says otherwise. */
export const HANDOFF_FOLDERS: readonly PathName[] = Object.freeze(['configDir', 'stateDir', 'dataDir', 'secretsDir']);

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

export interface CliHandoffs extends HandoffMaker {
  /** The printing package: one of its own modules and its name. */
  readonly caller: CliCommandCaller;
  own(words: readonly string[], use?: HandoffUse): Handoff;
  core(words: readonly string[], use?: HandoffUse): Handoff;
  of(channel: string, words: readonly string[], use?: HandoffUse): Handoff;
  /** The same commands, quoted for another shell. */
  on(platform: NodeJS.Platform): CliHandoffs;
  /**
   * The same, able to find another product: with the servers registered with this machine's MCP clients read now, from
   * the environment these were made with. Read once per call; nothing a registration names is run.
   */
  registered(): Promise<CliHandoffs>;
  /** The same, finding another product among these registrations: a scan the caller has already read. */
  withRegistrations(registrations: readonly RegisteredServer[]): CliHandoffs;
}

export interface CliHandoffsOptions {
  /** A module of the printing package (`import.meta.url`) and that package's name. */
  readonly caller: CliCommandCaller;
  /** The printing process's folders. */
  readonly paths: Readonly<ResolvedPaths>;
  readonly platform?: NodeJS.Platform | undefined;
  /** Where the MCP clients' configurations are found, for `registered()`: this process's unless given. */
  readonly env?: NodeJS.ProcessEnv | undefined;
  readonly registrations?: readonly RegisteredServer[] | undefined;
  /** For a test only: the Node version and flags the commands are located for. Its program is always this one's. */
  readonly runtime?: NodeRuntime | undefined;
}

/**
 * Core as a caller: a module of this package. Only core's own entry points — its CLI, its server — open core with it.
 * Bundled into another package, this module belongs to that package, so the manifest check refuses it there and it
 * locates nothing: a channel gives its own caller, never this one.
 */
export const CORE_CALLER: CliCommandCaller = Object.freeze({ url: import.meta.url, packageName: '@agentcomms/core' });

/** A channel of this release, by its word; a programming error for a word that is none. */
function entryOf(channel: string): ChannelEntry {
  const entry = CHANNEL_SNAPSHOT.find((each) => each.manifest.channel === channel);
  if (entry === undefined) throw new TypeError(`"${channel}" is not a channel of this release`);
  return entry;
}

/** The folders a command is pinned to. */
function usesOf(use: HandoffUse | undefined): PathName[] {
  return [...(use?.uses ?? HANDOFF_FOLDERS), ...(use?.downloads ? (['downloadsDir'] as const) : [])];
}

/** The commands a package prints, located from `caller` (CONTRIBUTING.md, "Telling a person what to run"). */
export function cliHandoffs(options: CliHandoffsOptions): CliHandoffs {
  const { caller, paths, registrations } = options;
  const platform = options.platform ?? process.platform;
  const own = CHANNEL_SNAPSHOT.find((entry) => entry.packageName === caller.packageName);
  if (own === undefined) throw new TypeError(`${caller.packageName} is not a package of this suite`);
  const locate = (target: ChannelEntry, words: readonly string[], use: HandoffUse | undefined): Handoff => {
    const result = locateCliCommand(
      {
        caller,
        target,
        words,
        uses: usesOf(use),
        paths,
        platform,
        ...(registrations === undefined ? {} : { registrations }),
      },
      ...(options.runtime === undefined ? [] : [options.runtime]),
    );
    return result.ok ? result.command : result;
  };
  const handoffs: CliHandoffs = Object.freeze({
    caller,
    platform,
    own: (words: readonly string[], use?: HandoffUse) => locate(own, words, use),
    core: (words: readonly string[], use?: HandoffUse) => locate(entryOf('core'), words, use),
    of: (channel: string, words: readonly string[], use?: HandoffUse) => locate(entryOf(channel), words, use),
    on: (other: NodeJS.Platform) => (other === platform ? handoffs : cliHandoffs({ ...options, platform: other })),
    registered: async () =>
      cliHandoffs({
        ...options,
        registrations: (await scanRegisteredServers(options.env ?? process.env, platform)).servers,
      }),
    withRegistrations: (servers: readonly RegisteredServer[]) => cliHandoffs({ ...options, registrations: servers }),
  });
  return handoffs;
}

/**
 * `core.handoffs`, for code that runs only where its package opened core with its caller — a channel's own CLI and
 * server, once migrated. A programming error otherwise: the package has to give core its caller (`openCore({ caller })`).
 */
export function requireHandoffs(core: { readonly handoffs?: CliHandoffs | undefined }): CliHandoffs {
  if (core.handoffs === undefined) {
    throw new TypeError('core was opened without its caller, so it cannot locate a command: pass openCore({ caller })');
  }
  return core.handoffs;
}

/**
 * The commands of whatever is printing: `core.handoffs` when the package gave core its caller, quoted for `platform`.
 *
 * @deprecated Otherwise — a package that has not given core its caller yet — a bridge whose commands are bare names, as
 * before CUE-403, its own named by `approveCommand` (`agent-gmail approve`) or `agentcomms`. It goes once every package
 * gives core its caller (CUE-403 task 15); nothing new should rely on it.
 */
export function handoffsFor(
  core: { readonly handoffs?: CliHandoffs | undefined } | undefined,
  options: { platform?: NodeJS.Platform | undefined; approveCommand?: string | undefined } = {},
): HandoffMaker {
  const located = core?.handoffs;
  if (located !== undefined) return options.platform === undefined ? located : located.on(options.platform);
  const platform = options.platform ?? process.platform;
  // The approve command as the package named it — its own words for `approve` — and its program for everything else.
  const approve = (options.approveCommand ?? 'agentcomms approve').trim().split(/\s+/);
  const ownBinary = approve[0] as string;
  return Object.freeze({
    platform,
    own: (words: readonly string[]) =>
      shellCommand(words[0] === 'approve' ? [...approve, ...words.slice(1)] : [ownBinary, ...words], platform),
    core: (words: readonly string[]) => shellCommand(['agentcomms', ...words], platform),
    of: (channel: string, words: readonly string[]) =>
      shellCommand([entryOf(channel).manifest.binary, ...words], platform),
  });
}

/** The same maker, finding another product among these registrations when it is a real one. */
export function withRegistrationsFor(maker: HandoffMaker, registrations: readonly RegisteredServer[]): HandoffMaker {
  return 'withRegistrations' in maker && typeof maker.withRegistrations === 'function'
    ? (maker as CliHandoffs).withRegistrations(registrations)
    : maker;
}

/** The same maker, able to find another product when it is a real one: registrations read now. */
export async function registeredFor(maker: HandoffMaker): Promise<HandoffMaker> {
  return 'registered' in maker && typeof maker.registered === 'function' ? (maker as CliHandoffs).registered() : maker;
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

/**
 * A sentence that gives the command, in backticks, made by `say`; or, with no command, the sentence saying why there is
 * none — never `say` with something else in the command's place.
 */
export function handoffSentence(handoff: Handoff | ShellCommand, say: (command: string) => string): string {
  return isCommand(handoff) ? say(inlineCommand(handoff)) : handoff.message;
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
): string {
  if (!isCommand(handoff)) return handoff.message;
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
  const reasons = missing.map((handoff) => handoff.message).join(' ');
  if (commands.length === 0) return `${none} ${reasons}`.trim();
  const conjunction = options.conjunction ?? 'or';
  const joined =
    commands.length === 1
      ? (commands[0] as string)
      : `${commands.slice(0, -1).join(', ')} ${conjunction} ${commands.at(-1)}`;
  return reasons === '' ? joined : `${joined} (${reasons.replace(/\.$/, '')})`;
}
