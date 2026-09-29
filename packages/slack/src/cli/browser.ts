import { spawn } from 'node:child_process';
import { accessSync, constants } from 'node:fs';
import { delimiter, join } from 'node:path';
import { absoluteSearchPath, childEnvironment, windowsSystemProgram } from '@agentcomms/core';

/** What `openInBrowser` starts with: the real `spawn` and this process's environment, unless a test passes its own. */
export interface BrowserDeps {
  spawn?: typeof spawn | undefined;
  env?: NodeJS.ProcessEnv | undefined;
}

/**
 * Opens the authorisation link in the user's browser.
 *
 * Best effort by design: the link has already been printed, and a sign-in that cannot start a browser is not a
 * failed sign-in — it is a link somebody opens by hand. Identical to the Gmail package's, because the reasoning
 * is identical and two different answers to "how do I open a URL" would be two things to maintain.
 *
 * The program that opens it is named by its full path, never looked up by a bare name. On Windows the lookup starts in
 * the current folder, and a download may have saved a stranger's program there: it would be what ran. So it is the
 * `rundll32.exe` under the Windows folder, started with `NoDefaultCurrentDirectoryInExePath`, handing the link to
 * `url.dll`'s `FileProtocolHandler` — which opens it as a double-click would, and which no shell stands in front of.
 * `cmd.exe /c start` did, and read the link as a command line: every `&` in it ended the command there, so the browser
 * got the link cut short and what followed was run as a command of its own. `/usr/bin/open` on macOS; and elsewhere the
 * `xdg-open` in the first absolute directory of `PATH` that holds one. When there is none, nothing is started and the
 * link is left for somebody to open.
 */
export function openInBrowser(
  url: string,
  platform: NodeJS.Platform = process.platform,
  deps: BrowserDeps = {},
): boolean {
  const env = deps.env ?? process.env;
  const command = browserOpener(platform, env);
  if (command === null) return false;
  // The link is one argument, whole: nothing between here and the handler reads it as anything but a link.
  const args = platform === 'win32' ? ['url.dll,FileProtocolHandler', url] : [url];
  try {
    const child = (deps.spawn ?? spawn)(command, args, {
      stdio: 'ignore',
      detached: true,
      env: childEnvironment(env, platform),
    });
    child.on('error', () => undefined);
    child.unref();
    return true;
  } catch {
    return false;
  }
}

/** The opener's full path, or null when there is none that can be named without looking in the current folder. */
function browserOpener(platform: NodeJS.Platform, env: NodeJS.ProcessEnv): string | null {
  if (platform === 'win32') return windowsSystemProgram('rundll32.exe', env);
  if (platform === 'darwin') return '/usr/bin/open';
  // An empty or relative entry of PATH is the current folder by another name, so only absolute ones are looked in.
  for (const directory of absoluteSearchPath((env.PATH ?? '').split(delimiter), platform)) {
    const candidate = join(directory, 'xdg-open');
    try {
      accessSync(candidate, constants.X_OK);
      return candidate;
    } catch {
      // not here; the next directory
    }
  }
  return null;
}
