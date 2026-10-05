import type { RegisteredServer } from './mcp-clients.ts';
import { type Launcher, type McpProduct, managedRuntimeVersion, pinnedVersion } from './mcp-install.ts';
import { PATH_OPTIONS, type PathName, type PathOverrides } from './paths.ts';

/**
 * What a registered server's entry says about the product it starts: how it was launched, the version it pins and the
 * suite directories it pins — read from the entry's words alone, and never by running anything it names.
 *
 * Neutral ground between the reports that list registrations (`operations/servers.ts`, `operations/update.ts`) and the
 * locator, which will read them to find another product's command (`cli-command.ts`, CUE-403 task 7): both parse an
 * entry the same way because both parse it here. It may use the installer's own recognisers (`mcp-install.ts`), which
 * the installer keeps for its overwrite protection; nothing here imports the locator, so the locator can import this.
 */

/** The product facts an entry is read against. */
export type RegistrationFacts = Pick<McpProduct, 'packageName' | 'npxPackage'>;

/** How a registered entry starts its server: the launcher `mcp install` wrote it with, or `other` for one it did not. */
export function launcherOf(
  server: Pick<RegisteredServer, 'command' | 'args'>,
  facts: RegistrationFacts,
): Launcher | 'other' {
  const parts = [server.command, ...server.args];
  if (parts.some((part) => managedRuntimeVersion(part, facts.packageName) !== null)) return 'managed';
  if (server.args.some((arg) => arg.startsWith(`${facts.npxPackage}@`))) return 'npx';
  if (parts.some((part) => /[/\\]packages[/\\][^/\\]+[/\\](?:src[/\\]cli\.ts|dist[/\\]cli\.mjs)$/.test(part)))
    return 'local';
  return 'other';
}

/** The version an entry pins — a managed runtime's or an npx spec's — or null for one that pins none. */
export function registrationVersion(server: Pick<RegisteredServer, 'args'>, facts: RegistrationFacts): string | null {
  return server.args.map((arg) => pinnedVersion(arg, facts)).find((found) => found !== null) ?? null;
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
