import { basename, isAbsolute, join } from 'node:path';
import { CommsError } from '@agentcomms/core';

/**
 * Where WhatsApp for Mac keeps its messages, and which files this package may ever read.
 *
 * The native WhatsApp for Mac app keeps its Core Data store in its shared group container, unencrypted on disk (Mysk,
 * 2026-05-23). The same container holds `Axolotl.sqlite` — the Signal session keys that make this Mac a linked device
 * — and `ContactsV2.sqlite`, `LocalKeyValue.sqlite` and the media folder. This package reads **one** file there and
 * its SQLite side files, by exact name, and nothing else: never a glob, never a directory listing, never a key store.
 */

export const STORE_FILE = 'ChatStorage.sqlite';

/**
 * The side files SQLite keeps beside a database: the write-ahead log, which holds every change not yet folded into the
 * main file, and a rollback journal, which exists only mid-transaction in rollback mode. The `-shm` index is left out
 * on purpose: it is shared memory the running app maps, it is rebuilt from the log by whoever opens the copy, and
 * reading it would be touching the app's live coordination state for nothing.
 */
export const SIDE_FILES: readonly string[] = Object.freeze([`${STORE_FILE}-wal`, `${STORE_FILE}-journal`]);

/** WhatsApp for Mac's shared group container. WhatsApp Business uses `group.net.whatsapp.WhatsAppSMB.shared`. */
export const WHATSAPP_GROUP_CONTAINER = 'group.net.whatsapp.WhatsApp.shared';

/**
 * The default store, from the home directory the environment names.
 *
 * From `env`, never `os.homedir()`: a test gives the harness a temporary HOME, and `homedir()` ignores it and reads
 * the real one — which, here, would be the owner's real WhatsApp messages.
 */
export function defaultStorePath(env: NodeJS.ProcessEnv): string {
  const home = env.HOME || env.USERPROFILE;
  if (!home) {
    throw new CommsError('CONFIG', 'no home directory in the environment, so the WhatsApp store cannot be found', {
      hint: 'Set HOME, or pass the store with --source.',
    });
  }
  return join(home, 'Library', 'Group Containers', WHATSAPP_GROUP_CONTAINER, STORE_FILE);
}

/**
 * A store path this package is willing to read: absolute, and named `ChatStorage.sqlite`.
 *
 * Checked on the string, before anything is opened, so a `--source` pointing at `Axolotl.sqlite` — or anything else a
 * mistyped or malicious argument names — is refused without its bytes ever being read, copied or parsed.
 */
export function checkStorePath(path: string): string {
  if (!isAbsolute(path)) {
    throw new CommsError('USAGE', 'the WhatsApp store must be given as an absolute path', {
      hint: `A path ending in /${STORE_FILE}.`,
    });
  }
  if (basename(path) !== STORE_FILE) {
    throw new CommsError('USAGE', `this reads only a file named ${STORE_FILE}, and "${basename(path)}" is not one`, {
      hint: 'Point --source at the ChatStorage.sqlite file itself. Nothing else in the WhatsApp folder is read.',
    });
  }
  return path;
}

/** Expands a leading `~` against the environment's home, as `defaultStorePath` does. */
export function expandSource(path: string, env: NodeJS.ProcessEnv): string {
  const home = env.HOME || env.USERPROFILE || '';
  if (home && (path === '~' || path.startsWith('~/'))) return join(home, path.slice(2));
  return path;
}

/**
 * The app macOS will ask about, as best this process can tell.
 *
 * macOS attributes a file access to the *responsible* app — the terminal a command runs in, or the MCP client that
 * started the server — not to `node`. GUI-launched processes carry `__CFBundleIdentifier`; terminals set
 * `TERM_PROGRAM`. Neither is authoritative, so an unknown one is said as such rather than guessed.
 */
const KNOWN_APPS: Readonly<Record<string, string>> = {
  'com.apple.Terminal': 'Terminal',
  Apple_Terminal: 'Terminal',
  'com.googlecode.iterm2': 'iTerm',
  'iTerm.app': 'iTerm',
  'com.microsoft.VSCode': 'Visual Studio Code',
  vscode: 'Visual Studio Code',
  'dev.warp.Warp-Stable': 'Warp',
  WarpTerminal: 'Warp',
  'com.mitchellh.ghostty': 'Ghostty',
  ghostty: 'Ghostty',
  'com.anthropic.claudefordesktop': 'Claude',
  'com.todesktop.230313mzl4w4u92': 'Cursor',
};

export function responsibleApp(env: NodeJS.ProcessEnv): string | null {
  for (const key of [env.__CFBundleIdentifier, env.TERM_PROGRAM]) {
    if (key && Object.hasOwn(KNOWN_APPS, key)) return new Map(Object.entries(KNOWN_APPS)).get(key) ?? null;
  }
  return null;
}
