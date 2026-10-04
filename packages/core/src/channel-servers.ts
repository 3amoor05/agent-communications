import type { ChannelEntry, ChannelManifest } from './channel-manifest.ts';
import { type BuiltInChannel, CHANNEL_SNAPSHOT } from './channels.generated.ts';
import { CommsError } from './errors.ts';
import type { InstallOptions, McpProduct, Narrowing } from './mcp-install.ts';
import { rivalPackageWarnings, rivalWordWarnings } from './other-servers.ts';

/**
 * The MCP servers this suite ships, and what the shared installer needs to know to register each one.
 *
 * One list, read by every installer. `agent-gmail mcp install` and `agent-slack mcp install` register their own
 * server; the core server's `comms_server_install` registers any of them. Each package used to keep these facts
 * beside its own installer, and a second installer holding a copy would have been a second place for a package name,
 * a flag or an npx argument to drift — the Slack entry once started `agent-slack --workspace acme` with no command at
 * all, because a shared default was wrong for one product. So the channel packages spread these, and add only what
 * is theirs: the version they are, and where their own code lives.
 *
 * What each warns about is here too: the other servers for the same service that send with no approval step. It was
 * the one fact the channels kept to themselves, so registering Gmail from chat warned about nothing while
 * `agent-gmail mcp install` warned about exactly those servers — the same registration, telling a person less on one
 * surface.
 *
 * **Derived, not written.** Every fact here comes from a channel's manifest — the `"agentcomms"` field of its
 * `package.json` — through core's build-time snapshot of them (`channels.generated.ts`). This table used to be written
 * out by hand, with a function per channel for its flags; those functions are now read off the manifest's
 * `narrowing` and `rivals`, so a new channel is a manifest rather than an edit here, and a golden test holds the
 * derived behaviour to what the hand-written table did.
 */
/**
 * A channel's word: `core`, `gmail`, `slack` — a string, checked against core's snapshot of the manifests
 * (`isChannel`, `channelServer`) wherever one arrives from outside, rather than a union a new channel has to be
 * added to by hand. `BuiltInChannel` is the union of this release's, generated with the snapshot.
 */
export type Channel = string;

export type { BuiltInChannel };

/** Every channel in core's snapshot, the core first. */
export const CHANNELS: readonly Channel[] = Object.freeze(CHANNEL_SNAPSHOT.map((entry) => entry.manifest.channel));

/** Everything about a server except the version being installed and where its code lives. */
export type ServerFacts = Omit<McpProduct, 'version' | 'moduleUrl'>;

/**
 * The value a pin's flag carries in an entry's arguments: `--account acme/resend`, or `--account=acme/resend` — the
 * first given, in either form.
 *
 * Every server reads both — Commander does, and so does `agent-gmail-mcp` — so an entry pinned by hand in the one-word
 * form is pinned. Reading back only the two-word form made such an entry look unpinned, and `--force` and the update
 * then registered its replacement reaching every account, under a preview that said nothing had changed.
 */
function flagValue(args: readonly string[], flag: string): string | undefined {
  for (const [index, argument] of args.entries()) {
    if (argument === flag) return args[index + 1];
    if (argument.startsWith(`${flag}=`)) return argument.slice(flag.length + 1);
  }
  return undefined;
}

/**
 * The flags a server is started with, from the options `mcp install` was given: each of the manifest's `narrowing`
 * entries in order — a pin's flag and its value when it has one, a switch's flag when it is on.
 */
export function narrowingArgs(manifest: ChannelManifest, options: InstallOptions): string[] {
  const args: string[] = [];
  for (const { option, flag, kind } of manifest.narrowing ?? []) {
    const value = (options as unknown as Partial<Record<string, unknown>>)[option];
    if (kind === 'pin' && typeof value === 'string' && value) args.push(flag, value);
    if (kind === 'switch' && value) args.push(flag);
  }
  return args;
}

/**
 * The pin and switches a registered entry's arguments carry, read back as the options `narrowingArgs` takes — as the
 * doctor's repair reads them, so `--force` keeps what a registered entry narrowed.
 */
export function narrowingFromArgs(manifest: ChannelManifest, args: readonly string[]): Narrowing {
  const narrowing: Record<string, string | boolean> = {};
  for (const { option, flag, kind } of manifest.narrowing ?? []) {
    if (kind === 'pin') {
      const value = flagValue(args, flag);
      if (value) narrowing[option] = value;
    } else if (args.includes(flag)) {
      narrowing[option] = true;
    }
  }
  return narrowing as Narrowing;
}

/** A channel's server facts, from its manifest. */
export function serverFactsOf({ packageName, manifest }: ChannelEntry): ServerFacts {
  const { server, rivals } = manifest;
  const facts: ServerFacts = {
    packageName,
    binary: manifest.binary,
    defaultServerName: server.defaultName,
    npxPackage: server.npxPackage,
    ...(server.npxArgs === undefined ? {} : { npxArgs: server.npxArgs }),
    ...(server.entryFiles === undefined ? {} : { entryFiles: server.entryFiles }),
    ...(server.bins === undefined ? {} : { bins: server.bins }),
    serverArgs: (options) => narrowingArgs(manifest, options),
    narrowingOf: (args) => narrowingFromArgs(manifest, args),
  };
  if (rivals === undefined) return facts;
  /*
   * Our own `read` token cannot post, whatever else is installed — but that was never the point. Another server for
   * the same service sends with *its* credential, and an agent uses whichever tool it finds; every approval step here
   * stands beside that route rather than in front of it. Told apart from this server by these same facts, read when
   * a registration asks rather than while this table is being built.
   */
  return {
    ...facts,
    warnAbout: (servers, platform) => [
      ...(rivals.packages ? rivalPackageWarnings(servers, rivals.packages, platform) : []),
      ...(rivals.word !== undefined && rivals.can !== undefined
        ? rivalWordWarnings(servers, rivals.word, rivals.can, facts)
        : []),
    ],
  };
}

export const CHANNEL_SERVERS: Readonly<Record<BuiltInChannel, ServerFacts>> = Object.freeze(
  Object.fromEntries(CHANNEL_SNAPSHOT.map((entry) => [entry.manifest.channel, serverFactsOf(entry)])) as Record<
    BuiltInChannel,
    ServerFacts
  >,
);

/** How each server is named to a person: in a preview, and in what a tool returns. */
export const CHANNEL_LABELS: Readonly<Record<BuiltInChannel, string>> = Object.freeze(
  Object.fromEntries(CHANNEL_SNAPSHOT.map((entry) => [entry.manifest.channel, entry.manifest.label])) as Record<
    BuiltInChannel,
    string
  >,
);

/** A channel's manifest, from core's snapshot. */
export function channelManifest(channel: string): ChannelManifest | undefined {
  return CHANNEL_SNAPSHOT.find((entry) => entry.manifest.channel === channel)?.manifest;
}

export function isChannel(value: unknown): value is Channel {
  return typeof value === 'string' && (CHANNELS as readonly string[]).includes(value);
}

/** Refuses a word that is not a channel of this release, naming the ones that are. */
function notAChannel(value: unknown): CommsError {
  return new CommsError('USAGE', `"${String(value)}" is not a channel`, { hint: `One of: ${CHANNELS.join(', ')}.` });
}

/** A channel's server facts, by its word; refused for a word that is not a channel. */
export function channelServer(channel: Channel): ServerFacts {
  if (!isChannel(channel)) throw notAChannel(channel);
  return CHANNEL_SERVERS[channel as BuiltInChannel];
}

/** How a channel's server is named to a person, by its word; refused for a word that is not a channel. */
export function channelLabel(channel: Channel): string {
  if (!isChannel(channel)) throw notAChannel(channel);
  return CHANNEL_LABELS[channel as BuiltInChannel];
}

/** A channel's manifest, by its word; refused for a word that is not a channel. */
export function requireChannelManifest(channel: Channel): ChannelManifest {
  const manifest = channelManifest(channel);
  if (manifest === undefined) throw notAChannel(channel);
  return manifest;
}
