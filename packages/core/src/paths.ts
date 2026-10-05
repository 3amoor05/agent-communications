import { homedir, userInfo } from 'node:os';
import { join, resolve } from 'node:path';

export const APP_DIR_NAME = 'agent-communications';

/** The five suite directories a CLI can pin independently. */
export const PATH_OPTIONS = [
  { key: 'configDir', option: 'config-dir', flag: '--config-dir' },
  { key: 'stateDir', option: 'state-dir', flag: '--state-dir' },
  { key: 'dataDir', option: 'data-dir', flag: '--data-dir' },
  { key: 'secretsDir', option: 'secrets-dir', flag: '--secrets-dir' },
  { key: 'downloadsDir', option: 'downloads-dir', flag: '--downloads-dir' },
] as const;

export type PathName = (typeof PATH_OPTIONS)[number]['key'];
export type PathOptionName = (typeof PATH_OPTIONS)[number]['option'];
export type PathOverrides = Partial<Record<PathName, string>>;

/**
 * Words with the five path options and their values taken out where an option parser would read them — before the
 * first `--`, in both the `--x value` and `--x=value` forms — and every word from `--` on kept as it is.
 *
 * What a registered entry is recognised by. A pinned folder is a folder: `/tmp/@agentcomms/slack`, or one ending in
 * `packages/slack/src/cli.ts`, read as a package or an entry, made a Gmail registration Slack's. `dangling` says a
 * spaced option had no value before `--` or the end, which is a broken entry rather than one to guess about.
 */
export function withoutPathOptions(words: readonly string[]): { words: string[]; dangling: boolean } {
  const flags: readonly string[] = PATH_OPTIONS.map(({ flag }) => flag);
  const kept: string[] = [];
  let dangling = false;
  for (let index = 0; index < words.length; index += 1) {
    const word = words[index] as string;
    if (word === '--') {
      kept.push(...words.slice(index));
      break;
    }
    if (flags.includes(word)) {
      const value = words[index + 1];
      if (value === undefined || value === '--') dangling = true;
      else index += 1;
      continue;
    }
    if (flags.some((flag) => word.startsWith(`${flag}=`))) continue;
    kept.push(word);
  }
  return { words: kept, dangling };
}

export interface PathEnvironment {
  env?: NodeJS.ProcessEnv;
  platform?: NodeJS.Platform;
  home?: string;
  /** Explicit CLI pins. Each replaces only the directory it names, after defaults and environment are resolved. */
  pathOverrides?: PathOverrides;
}

export interface ResolvedPathIdentity {
  paths: ResolvedPaths;
  /** Only the explicitly pinned directories, with their canonical absolute values. */
  pathOverrides: Readonly<PathOverrides>;
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
  return resolvePathIdentity(options).paths;
}

/** Resolves the environment/default identity, then overlays each explicit pin without re-deriving any sibling. */
export function resolvePathIdentity(options: PathEnvironment = {}): ResolvedPathIdentity {
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
  const derived: ResolvedPaths = { configDir, stateDir, secretsDir, dataDir, downloadsDir };
  const pathOverrides: PathOverrides = {};
  for (const { key } of PATH_OPTIONS) {
    const value = options.pathOverrides?.[key];
    if (value === undefined) continue;
    if (value.length === 0) throw new TypeError(`${key} cannot be empty`);
    // `resolve` makes a relative pin absolute and removes redundant trailing separators while preserving a root.
    pathOverrides[key] = resolve(value);
  }
  return {
    paths: { ...derived, ...pathOverrides },
    pathOverrides: Object.freeze(pathOverrides),
  };
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
 * A path as a preview shows it: the home at its start written `~`, the way a person reads and types it. The inverse of
 * `expandHome`, and like it, nothing else is touched. Case is ignored on Windows, whose paths are not case-sensitive.
 */
export function shortenHome(path: string, home: string, platform: NodeJS.Platform = process.platform): string {
  if (!home) return path;
  const same = (a: string, b: string) => (platform === 'win32' ? a.toLowerCase() === b.toLowerCase() : a === b);
  // A loop rather than a pattern anchored at the end, which backtracks over every run of separators in the string.
  let end = home.length;
  while (end > 0 && (home[end - 1] === '/' || home[end - 1] === '\\')) end -= 1;
  const root = home.slice(0, end);
  if (same(path, root)) return '~';
  for (const separator of platform === 'win32' ? ['\\', '/'] : ['/']) {
    const prefix = `${root}${separator}`;
    if (path.length > prefix.length && same(path.slice(0, prefix.length), prefix)) {
      return `~${separator}${path.slice(prefix.length)}`;
    }
  }
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
