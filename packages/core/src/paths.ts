import { homedir, userInfo } from 'node:os';
import { join, resolve } from 'node:path';

export const APP_DIR_NAME = 'agent-communications';

export interface PathEnvironment {
  env?: NodeJS.ProcessEnv;
  platform?: NodeJS.Platform;
  home?: string;
}

export interface ResolvedPaths {
  /** config.json and everything a user edits. */
  configDir: string;
  /** Approvals, pending OAuth flows, audit log, rate-cap counters, taint set. */
  stateDir: string;
  /** The file secret store: refresh tokens, client secrets, the approval key. */
  secretsDir: string;
  /** Managed runtime installs for MCP clients. */
  dataDir: string;
  /**
   * Default root for exports and for the files Resend's received mail carries. A Gmail attachment or a Slack file is
   * not saved here: those downloads ask the person where to save (`save-destination.ts`).
   */
  downloadsDir: string;
}

/**
 * Where everything lives. `AGENT_COMMS_CONFIG_DIR` wins; then `XDG_CONFIG_HOME` (honoured on macOS too, because that is
 * where agents and people look first); then `~/.config` on macOS and Linux, `%APPDATA%` on Windows.
 *
 * On Windows, state and the file secret store go under `%LOCALAPPDATA%` rather than beside the config: `%APPDATA%` is
 * the roaming profile, which a domain copies between machines — and refresh tokens, approvals and audit records are
 * exactly what should not travel that way. An explicit `AGENT_COMMS_CONFIG_DIR` keeps everything together, because
 * someone who names a directory means that directory.
 */
export function resolvePaths(options: PathEnvironment = {}): ResolvedPaths {
  const env = options.env ?? process.env;
  const platform = options.platform ?? process.platform;
  const home = options.home ?? homeOf(env, platform);

  const configDir = resolve(
    env.AGENT_COMMS_CONFIG_DIR ||
      (env.XDG_CONFIG_HOME
        ? join(env.XDG_CONFIG_HOME, APP_DIR_NAME)
        : platform === 'win32'
          ? join(env.APPDATA || join(home, 'AppData', 'Roaming'), APP_DIR_NAME)
          : join(home, '.config', APP_DIR_NAME)),
  );
  const explicitConfigDir = Boolean(env.AGENT_COMMS_CONFIG_DIR);
  const localRoot =
    platform === 'win32' && !explicitConfigDir
      ? join(env.LOCALAPPDATA || join(home, 'AppData', 'Local'), APP_DIR_NAME)
      : configDir;
  const stateDir = resolve(env.AGENT_COMMS_STATE_DIR || join(localRoot, 'state'));
  const secretsDir = resolve(join(localRoot, 'secrets'));
  const dataDir = resolve(
    env.AGENT_COMMS_DATA_DIR ||
      (platform === 'win32'
        ? join(env.LOCALAPPDATA || join(home, 'AppData', 'Local'), APP_DIR_NAME)
        : env.XDG_DATA_HOME
          ? join(env.XDG_DATA_HOME, APP_DIR_NAME)
          : join(home, '.local', 'share', APP_DIR_NAME)),
  );
  const downloadsDir = resolve(join(home, 'Downloads', APP_DIR_NAME));
  return { configDir, stateDir, secretsDir, dataDir, downloadsDir };
}

/**
 * The home the environment names, which is where Node's own `homedir()` looks for the running process — `HOME`, or
 * `USERPROFILE` on Windows. Asking `homedir()` directly ignored an environment passed in, so every test that gave the
 * harness a temporary HOME still had its data and downloads resolved to the real ones: one day of test runs left 748
 * backups of fixture entries in the maintainer's own data directory.
 *
 * Its own function since a download asks where to save: the person's Downloads folder is `<this>/Downloads`, and a
 * folder they type as `~/…` is expanded from it — the same home every other path here is resolved from. When the
 * environment names none, the account's own home is taken ({@link accountHome}); `account` is for a test to say what
 * that is.
 */
export function homeOf(
  env: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform,
  account: () => string = accountHome,
): string {
  return (platform === 'win32' ? env.USERPROFILE : env.HOME) || account();
}

/**
 * The home the account itself has, for when the environment names none: the password database's (`os.userInfo()`),
 * which no variable moves, rather than `homedir()`, which reads `HOME` first — from this process's environment, not the
 * one the caller passed, and so from somewhere the caller did not say. Only when there is no such entry — some
 * containers run as an id with none — is `homedir()` asked instead.
 */
export function accountHome(): string {
  try {
    const home = userInfo().homedir;
    if (home) return home;
  } catch {
    // An account with no entry in the database.
  }
  return homedir();
}

/**
 * Expands a leading `~` to the home directory. Nothing else is expanded. `joinPaths` is the platform's own, for a path
 * judged for another platform than this one: a Linux home joined on Windows would otherwise take its backslashes.
 */
export function expandHome(
  path: string,
  home: string = homedir(),
  joinPaths: (...parts: string[]) => string = join,
): string {
  if (path === '~') return home;
  if (path.startsWith('~/') || path.startsWith('~\\')) return joinPaths(home, path.slice(2));
  return path;
}

/**
 * The user's home directory, read from an environment.
 *
 * Windows does not set `HOME`; it sets `USERPROFILE`. Call sites that wrote `env.HOME ?? ''` and handed the result to
 * `expandHome` were therefore broken on Windows in a way that reads as safe: `''` is not nullish, so `expandHome`'s
 * own `homedir()` default never fires, `~` expands to the empty string, and `resolve('')` is the process's current
 * working directory. An attachment jail whose root is `['~']` then permits whatever directory the server was started
 * in, and the `~/.*` deny rule tests for dot-folders under that directory instead of under the real home — so
 * `~/.ssh` and `~/.aws` stopped being denied and started being attachable.
 *
 * `||` rather than `??` deliberately: `HOME=''` is exactly as broken as `HOME` unset, and was the shape of the bug.
 */
export function homeDirectory(env: NodeJS.ProcessEnv = process.env): string {
  return env.HOME || env.USERPROFILE || homedir();
}
