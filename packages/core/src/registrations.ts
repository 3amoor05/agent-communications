import type { ChannelEntry } from './channel-manifest.ts';
import { commandLinePackage, type RegisteredServer } from './mcp-clients.ts';
import {
  isProductServer,
  type Launcher,
  type McpProduct,
  managedRuntimeVersion,
  pinnedVersion,
} from './mcp-install.ts';
import { PATH_OPTIONS, type PathName, type PathOverrides, withoutPathOptions } from './paths.ts';

/**
 * What a registered server's entry says about the product it starts: whether it is that product's, how it was
 * launched, the version it pins, the suite directories it pins and the files it names — read from the entry's words
 * alone, and never by running anything it names.
 *
 * Neutral ground between the reports that list registrations (`operations/servers.ts`, `operations/update.ts`) and the
 * locator, which reads them to find another product's command (`cli-command.ts`): both parse an entry the same way
 * because both parse it here. It may use the installer's own recognisers (`mcp-install.ts`), which the installer keeps
 * for its overwrite protection; nothing here imports the locator, so the locator can import this.
 *
 * `platform` is the system the entry was registered on. On Windows, whose file names are not case-sensitive, names and
 * path segments are compared without case; everywhere else exactly.
 */

/** The product facts an entry is read against. */
export type RegistrationFacts = Pick<McpProduct, 'packageName' | 'npxPackage' | 'binary' | 'bins' | 'entryFiles'>;

/** How an entry starts its server: the launcher `mcp install` wrote it with, or `other` for one it did not. */
export type RegistrationLauncher = Launcher | 'other';

/** A channel's registration facts, from its manifest. */
export function registrationFactsOf({ packageName, manifest }: ChannelEntry): RegistrationFacts {
  return {
    packageName,
    npxPackage: manifest.server.npxPackage,
    binary: manifest.binary,
    ...(manifest.server.bins === undefined ? {} : { bins: manifest.server.bins }),
    ...(manifest.server.entryFiles === undefined ? {} : { entryFiles: manifest.server.entryFiles }),
  };
}

/** How a registered entry starts its server: the launcher `mcp install` wrote it with, or `other` for one it did not. */
export function launcherOf(
  server: Pick<RegisteredServer, 'command' | 'args'>,
  facts: Pick<RegistrationFacts, 'packageName' | 'npxPackage'>,
  platform?: NodeJS.Platform,
): RegistrationLauncher {
  const fold = folding(platform);
  const parts = [server.command, ...server.args];
  if (parts.some((part) => managedRuntimeVersion(part, facts.packageName, platform) !== null)) return 'managed';
  if (server.args.some((arg) => fold(arg).startsWith(fold(`${facts.npxPackage}@`)))) return 'npx';
  const local = new RegExp(
    '[/\\\\]packages[/\\\\][^/\\\\]+[/\\\\](?:src[/\\\\]cli\\.ts|dist[/\\\\]cli\\.mjs)$',
    platform === 'win32' ? 'i' : '',
  );
  if (parts.some((part) => local.test(part))) return 'local';
  return 'other';
}

/** The version an entry pins — a managed runtime's or an npx spec's — or null for one that pins none. */
export function registrationVersion(
  server: Pick<RegisteredServer, 'args'>,
  facts: Pick<RegistrationFacts, 'packageName' | 'npxPackage'>,
  platform?: NodeJS.Platform,
): string | null {
  return server.args.map((arg) => pinnedVersion(arg, facts, platform)).find((found) => found !== null) ?? null;
}

const REGISTRATION_PATH_OPTIONS = PATH_OPTIONS.filter(({ key }) => key !== 'downloadsDir') as readonly {
  key: Exclude<PathName, 'downloadsDir'>;
  flag: string;
}[];

/**
 * The four suite roots an entry pins, in both supported flag forms, stopping where option parsing stops. Invalid or
 * empty pins are absent; downloads are never a server registration's pin.
 */
export function registrationPathPins(args: readonly string[]): Omit<PathOverrides, 'downloadsDir'> {
  const pins: Omit<PathOverrides, 'downloadsDir'> = {};
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === '--') break;
    for (const { key, flag } of REGISTRATION_PATH_OPTIONS) {
      if (argument === flag) {
        const value = args[index + 1];
        if (value !== undefined && value !== '--' && value.length > 0) pins[key] = value;
        index += 1;
        break;
      }
      if (argument?.startsWith(`${flag}=`)) {
        const value = argument.slice(flag.length + 1);
        if (value.length > 0) pins[key] = value;
        break;
      }
    }
  }
  return pins;
}

/**
 * Whether an entry starts this product, judged on its own words: the suite's path options and their values are taken
 * out, and the package its command line launches is read again from what is left rather than taken from the entry.
 * A folder pinned as `/tmp/@agentcomms/slack` never makes a Gmail registration Slack's.
 */
export function startsProduct(
  server: Pick<RegisteredServer, 'command' | 'args'>,
  facts: RegistrationFacts,
  platform?: NodeJS.Platform,
): boolean {
  const { words: args } = withoutPathOptions(server.args);
  const packageName = commandLinePackage(server.command, args);
  return isProductServer(
    { command: server.command, args, ...(packageName === undefined ? {} : { packageName }) },
    facts,
    platform,
  );
}

/**
 * A command's name as Windows finds it — its last path segment without `.cmd`, `.exe`, `.bat` or `.ps1` — without case
 * on Windows (`platform`), and exactly elsewhere.
 */
export function commandStem(command: string, platform?: NodeJS.Platform): string {
  return folding(platform)((command.split(/[\\/]+/).at(-1) ?? '').replace(/\.(?:cmd|exe|bat|ps1)$/i, ''));
}

/** Whether npx runs the entry: its program is npx, or it names the product's package at a version, as npx does. */
export function isNpxRegistration(
  server: Pick<RegisteredServer, 'command' | 'args'>,
  facts: Pick<RegistrationFacts, 'packageName' | 'npxPackage'>,
  platform?: NodeJS.Platform,
): boolean {
  return commandStem(server.command, platform) === 'npx' || launcherOf(server, facts, platform) === 'npx';
}

/**
 * The files an entry names as what it starts, as it writes them: every script among its words before `--` once the
 * path options are out (an interpreter's flags may name one too, so each is a candidate, not the answer), and its
 * program when that is one of the product's own commands — a link into the package, or a script npm wrote beside it.
 */
export function registrationFiles(
  server: Pick<RegisteredServer, 'command' | 'args'>,
  facts: Pick<RegistrationFacts, 'binary' | 'bins'>,
  platform?: NodeJS.Platform,
): { scripts: string[]; command: string | null } {
  const { words } = withoutPathOptions(server.args);
  const sentinel = words.indexOf('--');
  const options = sentinel < 0 ? words : words.slice(0, sentinel);
  const fold = folding(platform);
  const scripts = options
    .flatMap((word) => [
      word,
      ...(word.startsWith('--') && word.includes('=') ? [word.slice(word.indexOf('=') + 1)] : []),
    ])
    .filter((word) => !word.startsWith('-') && /\.(?:[cm]?js|[cm]?ts)$/i.test(word));
  const own = [facts.binary, ...(facts.bins ?? [])].map(fold).includes(commandStem(server.command, platform));
  return { scripts, command: own ? server.command : null };
}

function folding(platform: NodeJS.Platform | undefined): (text: string) => string {
  return platform === 'win32' ? (text) => text.toLowerCase() : (text) => text;
}
