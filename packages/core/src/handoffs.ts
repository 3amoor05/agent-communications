import type { ChannelEntry } from './channel-manifest.ts';
import { CHANNEL_SNAPSHOT } from './channels.generated.ts';
import { type CliCommandCaller, locateCliCommand, type NodeRuntime } from './cli-command.ts';
import { bareHandoffs, type Handoff, type HandoffMaker, type HandoffUse } from './handoff-text.ts';
import { type RegisteredServer, scanRegisteredServers } from './mcp-clients.ts';
import type { PathName, ResolvedPaths } from './paths.ts';

export {
  asHandoffMaker,
  type Handoff,
  type HandoffMaker,
  type HandoffSentenceOptions,
  type HandoffsOrPlatform,
  type HandoffUse,
  handoffChoices,
  handoffSentence,
  handoffSentenceToFill,
  handoffText,
  isCommand,
  platformOf,
} from './handoff-text.ts';

/**
 * The commands a package tells a person to run, made once per printing process (design 2026-10-04, D1 and D5;
 * CUE-403). How a channel migrates a handoff to these is in CONTRIBUTING.md, "Telling a person what to run".
 *
 * A package makes them from where it is — a module of its own and its package name, the caller — with the folders and
 * shell of the process printing: `openCore({ caller })` puts them on `core.handoffs`. Each method takes the CLI's own
 * words, never the program, and returns a `Handoff`: a located `PrintedCommand`, or why there is none here. Nothing
 * here quotes a line by hand, names a bare binary, or guesses an installation.
 */

/** The suite folders every CLI command opens: what a command is pinned to unless it says otherwise. */
export const HANDOFF_FOLDERS: readonly PathName[] = Object.freeze(['configDir', 'stateDir', 'dataDir', 'secretsDir']);

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
  return bareHandoffs(options.platform ?? process.platform, options.approveCommand);
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
