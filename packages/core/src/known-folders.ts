import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { childEnvironment, windowsSystemProgram } from './system-programs.ts';

/**
 * Where Windows keeps a person's own folders — Downloads, Documents — which a person or a domain can move to another
 * drive, or into OneDrive. The profile's `Downloads` and `Documents` are only where they start out.
 *
 * Read from `User Shell Folders` in the registry, with `reg.exe` by its full path under the Windows folder — never the
 * bare `reg`, which Windows would look for in the current folder first, and the current folder is one a download may
 * have saved a stranger's `reg.exe` into — and with the child told not to look in its own current folder either. Read
 * only for the profile of the user running this, since the registry says nothing about any other, and never for longer
 * than two seconds.
 */

/** The Downloads known folder's own id, under which `User Shell Folders` keeps where it is. */
export const DOWNLOADS_KNOWN_FOLDER = '{374DE290-123F-4565-9164-39C4925E467B}';
/** The Documents known folder's name there: `Personal`, for historical reasons. */
export const DOCUMENTS_KNOWN_FOLDER = 'Personal';

/** How a program is run to read the registry: `execFileSync`'s shape, so a test can stand in for it. */
export type RegistryRunner = (
  command: string,
  args: readonly string[],
  options: { env: NodeJS.ProcessEnv; timeout: number },
) => string;

export interface KnownFolderDeps {
  /** The platform this runs on: Windows alone has the registry. */
  platform?: NodeJS.Platform | undefined;
  /** The environment of the running process: its own profile and its Windows folder. */
  processEnv?: NodeJS.ProcessEnv | undefined;
  run?: RegistryRunner | undefined;
}

const USER_SHELL_FOLDERS = 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\User Shell Folders';

function runReg(
  command: string,
  args: readonly string[],
  options: { env: NodeJS.ProcessEnv; timeout: number },
): string {
  return execFileSync(command, [...args], {
    encoding: 'utf8',
    timeout: options.timeout,
    env: options.env,
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'ignore'],
  });
}

/**
 * Where the registry says one of the running user's known folders is — `valueName` under `User Shell Folders` — with
 * `%USERPROFILE%` and the like expanded from `env`; or undefined: not on Windows, not this user's own profile, not
 * answered in time, or not an absolute path on a drive.
 */
export function registryShellFolder(
  env: NodeJS.ProcessEnv,
  valueName: string,
  deps: KnownFolderDeps = {},
): string | undefined {
  if ((deps.platform ?? process.platform) !== 'win32') return undefined;
  const processEnv = deps.processEnv ?? process.env;
  const own = processEnv.USERPROFILE;
  if (
    !own ||
    !env.USERPROFILE ||
    path.win32.resolve(own).toLowerCase() !== path.win32.resolve(env.USERPROFILE).toLowerCase()
  ) {
    return undefined;
  }
  let output: string;
  try {
    output = (deps.run ?? runReg)(
      windowsSystemProgram('reg.exe', processEnv),
      ['query', USER_SHELL_FOLDERS, '/v', valueName],
      {
        env: childEnvironment(processEnv, 'win32'),
        timeout: 2000,
      },
    );
  } catch {
    return undefined;
  }
  const line = output.split(/\r?\n/).find((entry) => entry.trim().toLowerCase().startsWith(valueName.toLowerCase()));
  const value = /REG_(?:EXPAND_)?SZ\s+(.+?)\s*$/.exec(line ?? '')?.[1];
  if (value === undefined) return undefined;
  const expanded = value.replace(/%([^%]+)%/g, (whole, name: string) => {
    const found = Object.entries(env).find(([key]) => key.toLowerCase() === name.toLowerCase())?.[1];
    return found ?? whole;
  });
  if (expanded.includes('%') || !/^[A-Za-z]:[\\/]/.test(expanded)) return undefined;
  return path.win32.resolve(expanded);
}

/*
 * The registry is asked once per folder and profile in a process: the deny list is built more than once for each
 * download, and each would otherwise start `reg.exe` again for an answer that does not change while it runs.
 */
const asked = new Map<string, string | undefined>();

/** `registryShellFolder`, asked once per process for each folder and profile when no test stands in for the registry. */
export function knownFolder(env: NodeJS.ProcessEnv, valueName: string, deps: KnownFolderDeps = {}): string | undefined {
  if (deps.run !== undefined || deps.platform !== undefined || deps.processEnv !== undefined) {
    return registryShellFolder(env, valueName, deps);
  }
  const key = `${valueName}\u0000${env.USERPROFILE ?? ''}`;
  if (!asked.has(key)) asked.set(key, registryShellFolder(env, valueName));
  return asked.get(key);
}
