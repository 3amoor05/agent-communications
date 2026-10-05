import { accessSync, constants, readFileSync, realpathSync, statSync } from 'node:fs';
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { ChannelEntry } from './channel-manifest.ts';
import { CHANNEL_SNAPSHOT } from './channels.generated.ts';
import { normalizePathOptionWords, shellCommand } from './cli-runtime.ts';
import { isWithin, nearestPackage, readPackageManifest, suiteCommandOf } from './package-roots.ts';
import type { PathName, PathOverrides, ResolvedPaths } from './paths.ts';
import { VERSION } from './version.ts';
import { satisfiesRange } from './versions.ts';

/**
 * The command a person is told to run for one of this suite's own CLIs (design 2026-10-04, D1 and D5; CUE-403).
 *
 * A bare `agent-gmail approve …` is not runnable for most of the people it is printed for: a package run by npx, by a
 * managed runtime or from a checkout puts nothing on their PATH. So every such command names this process's Node and
 * a checked file of the product it runs, with the suite directories it uses pinned as options — and when no file can
 * be checked, there is no command at all, only a sentence saying what is missing. The caller says which package it is
 * and what to run; it never supplies the program or quotes the line.
 *
 * Two directions are located here. A product's own CLI is found from the product itself, walking from one of its own
 * modules to its manifest: no registration is ever asked. A channel's handoff to core is found the way the channel
 * itself finds core, through its installed dependency, and only the same release. Another product's command, found
 * through what is registered with the person's MCP clients, is not located yet (CUE-403 task 7): it gets no command.
 *
 * What is checked is checked when the command is printed, not for ever (D6): the file it names is real, readable and
 * inside its package then, and a later change to that installation is a later fact.
 */

/** The gate a constructor call has to pass: only this module holds it. */
const GATE: unique symbol = Symbol('locateCliCommand');

/**
 * A command that runs one of this suite's own CLIs, made only by `locateCliCommand`. Rendered as every printed command
 * is — a line to paste, or on Windows its words as JSON when no line is safe in every shell (`inlineCommand`,
 * `commandText`).
 *
 * A class with a private field, so the type is nominal: an object literal with the same fields is not one, and nor is
 * a spread copy of one with other words in it, as it would be with a symbol-keyed brand. Only the type is exported;
 * the class and its gate are not.
 */
class PrintedCommand {
  readonly #entry: string;
  /** The words, as the program is to receive them: this Node, its flags, the entry, then the CLI's own words. */
  readonly words: readonly string[];
  /** The line to paste; null when one of the words has no printing that every Windows shell passes on alike. */
  readonly line: string | null;
  readonly platform: NodeJS.Platform;

  constructor(gate: typeof GATE, words: readonly string[], platform: NodeJS.Platform, entry: string) {
    if (gate !== GATE) throw new TypeError('a printed command is made by locateCliCommand, and only there');
    this.#entry = entry;
    this.words = Object.freeze([...words]);
    this.line = shellCommand(this.words, platform).line;
    this.platform = platform;
    Object.freeze(this);
  }

  /** The real path of the file it runs, as it was checked when the command was located. */
  get entry(): string {
    return this.#entry;
  }
}

export type { PrintedCommand };

/** The package asking: a module of its own (`import.meta.url`), and the package that module is expected to be in. */
export interface CliCommandCaller {
  readonly url: string;
  readonly packageName: string;
}

export interface CliCommandRequest {
  readonly caller: CliCommandCaller;
  /** The product whose CLI is to run, as core's snapshot of the manifests has it. */
  readonly target: ChannelEntry;
  /** The CLI's own words: its subcommand and arguments, never the program. */
  readonly words: readonly string[];
  /** The suite directories the command reads or writes, each pinned to its value in `paths`; no other is. */
  readonly uses: readonly PathName[];
  /** The printing process's resolved directories. */
  readonly paths: Readonly<ResolvedPaths>;
  /** The shell the line is quoted for. */
  readonly platform?: NodeJS.Platform | undefined;
}

/** The Node a command is located for: this process's, unless a test says otherwise. Its program is always this one's. */
export interface NodeRuntime {
  /** `process.version`, checked against the target's `engines.node`. */
  readonly version: string;
  /** `process.execArgv`, read only for whether `--experimental-transform-types` was used. */
  readonly execArgv: readonly string[];
}

export type CliDirection = 'own' | 'channel-to-core';

/** What a located command was decided from, so that a test, and a person reading a report, can see why. */
export interface CliCommandBasis {
  readonly direction: CliDirection;
  /** The caller's module is TypeScript source: its URL ends in `.ts`. */
  readonly callerSource: boolean;
  /** The caller's package root, real. */
  readonly callerRoot: string;
  readonly callerVersion: string | null;
  /** The target's package root, real: the caller's own for `own`. */
  readonly targetRoot: string;
  readonly targetVersion: string | null;
  /** The real repository checkout each root is a workspace package of, or null; channel to core only. */
  readonly callerWorkspace: string | null;
  readonly targetWorkspace: string | null;
  /** Both are workspace packages of one checkout — always so for `own`, where they are one package. */
  readonly sameCheckout: boolean;
  /** `src/cli.ts`, or the manifest's bin. */
  readonly entryKind: 'source' | 'bin';
}

/** Why there is no command: the step that found nothing it could check. */
export type CliNotLocatedReason =
  | 'caller'
  | 'manifest'
  | 'core'
  | 'version'
  | 'engine'
  | 'bin'
  | 'entry'
  | 'interpreter'
  | 'arguments'
  | 'direction';

export interface CliCommandLocated {
  readonly ok: true;
  readonly command: PrintedCommand;
  readonly basis: CliCommandBasis;
}

/** No command: nothing to run, and a sentence naming the product, its package and the exact version it needs. */
export interface CliCommandNotLocated {
  readonly ok: false;
  readonly reason: CliNotLocatedReason;
  /** How the product is named to a person: `Gmail`. */
  readonly product: string;
  readonly package: string;
  /** The exact version needed: the printing package's own, since the suite is released together. */
  readonly version: string;
  /** For `engine`: the Node range the target declares. */
  readonly nodeRange?: string | undefined;
  /** What was found, in a clause. */
  readonly detail: string;
  /** The whole sentence to show. */
  readonly message: string;
}

export type CliCommandResult = CliCommandLocated | CliCommandNotLocated;

const STRIP_TYPES = '--experimental-strip-types';
const TRANSFORM_TYPES = '--experimental-transform-types';

/** The suite's channel packages, which reach core through their own dependency on it. */
const CHANNEL_PACKAGES: ReadonlySet<string> = new Set(
  CHANNEL_SNAPSHOT.filter(({ manifest }) => manifest.channel !== 'core').map(({ packageName }) => packageName),
);

/**
 * Locates the command that runs `request.target`'s CLI with `request.words`, or says why there is none.
 *
 * The program is always this process's Node (`process.execPath`), which must satisfy the target's `engines.node`; no
 * interpreter named anywhere else is run, or asked its version. A TypeScript entry gets `--experimental-strip-types`,
 * which Node 22.12–22.17 needs, and `--experimental-transform-types` only when this source run was started with it;
 * no other flag this process was started with is carried — debug, preload, condition and memory flags are not what the
 * CLI needs. The suite directories the command uses go between the entry and its words, one canonical option each,
 * before any `--`.
 *
 * Synchronous, so a hint or a renderer can call it where it builds its sentence.
 */
export function locateCliCommand(
  request: CliCommandRequest,
  runtime: NodeRuntime = { version: process.version, execArgv: process.execArgv },
): CliCommandResult {
  const { caller, target } = request;
  const [first] = request.words;
  if (first !== undefined && (isAbsolute(first) || suiteCommandOf(first) !== null)) {
    throw new TypeError(`the words to run start after the program: ${JSON.stringify(first)} is one`);
  }
  // The exact version needed is the printing package's: the suite is released together.
  let version = VERSION;
  const fail = (reason: CliNotLocatedReason, detail: string, nodeRange?: string) =>
    notLocated(target, version, reason, detail, runtime.version, nodeRange);

  let callerFile: string;
  try {
    callerFile = fileURLToPath(caller.url);
  } catch {
    return fail('caller', `${caller.url} is not a module on this machine`);
  }
  const callerSource = callerFile.endsWith('.ts');
  // The package a module belongs to is the nearest manifest, and it has to be the one the caller says it is: a module
  // of a wrapper, or of a bundle that copied this code, would otherwise locate itself as the product.
  const found = nearestPackage(dirname(callerFile));
  const callerManifest = found?.manifest ?? null;
  if (found === null || callerManifest === null || callerManifest.name !== caller.packageName) {
    const name = typeof callerManifest?.name === 'string' ? callerManifest.name : 'no named package';
    return fail('manifest', `the package ${callerFile} belongs to is ${name}, not ${caller.packageName}`);
  }
  if (typeof callerManifest.version === 'string') version = callerManifest.version;
  let callerRoot: string;
  try {
    callerRoot = realpathSync(found.root);
  } catch {
    return fail('caller', `${found.root} cannot be resolved`);
  }

  let direction: CliDirection;
  let targetRoot: string;
  let targetManifest: Record<string, unknown>;
  let callerWorkspace: string | null = null;
  let targetWorkspace: string | null = null;
  let sameCheckout = true;
  if (caller.packageName === target.packageName) {
    direction = 'own';
    targetRoot = callerRoot;
    targetManifest = callerManifest;
  } else if (target.manifest.channel === 'core' && CHANNEL_PACKAGES.has(caller.packageName)) {
    direction = 'channel-to-core';
    // Core as the channel itself finds it: its installed dependency, not core's exported module or a sibling folder.
    const installed = installedPackage(dirname(callerFile), target.packageName);
    if (installed === null) {
      return fail('core', `${caller.packageName} has no ${target.packageName} installed where it can find one`);
    }
    targetRoot = installed;
    const manifest = readPackageManifest(targetRoot);
    if (manifest === null || manifest.name !== target.packageName) {
      return fail('manifest', `the package found as ${target.packageName}, at ${targetRoot}, is not that package`);
    }
    if (manifest.version !== version) {
      const theirs = typeof manifest.version === 'string' ? manifest.version : 'of no version';
      return fail(
        'version',
        `${caller.packageName} ${version} finds ${target.packageName} ${theirs}, at ${targetRoot}`,
      );
    }
    targetManifest = manifest;
    // Core's source runs only beside a channel's source, as one checkout: never because a path happens to end in `.ts`.
    callerWorkspace = workspaceOf(callerRoot);
    targetWorkspace = workspaceOf(targetRoot);
    sameCheckout = callerWorkspace !== null && callerWorkspace === targetWorkspace;
  } else {
    return fail('direction', `finding it from ${caller.packageName} is not supported in this release yet`);
  }

  const engines = targetManifest.engines;
  const range = typeof engines === 'object' && engines !== null ? (engines as Record<string, unknown>).node : undefined;
  if (typeof range !== 'string') {
    return fail('engine', `${target.packageName} at ${targetRoot} declares no Node range this can check`);
  }
  if (satisfiesRange(runtime.version, range) !== true) {
    return fail('engine', `it needs Node ${range}, and this is Node ${runtime.version}`, range);
  }

  const source = callerSource && sameCheckout;
  let entry: string;
  if (source) {
    // Exactly the source CLI, and never a build beside it: a checkout with no build, or a stale one, runs its source.
    entry = join(targetRoot, 'src', 'cli.ts');
  } else {
    const declared = targetManifest.agentcomms;
    const binary =
      typeof declared === 'object' && declared !== null ? (declared as Record<string, unknown>).binary : undefined;
    const bin = targetManifest.bin;
    const path =
      binary === target.manifest.binary &&
      typeof bin === 'object' &&
      bin !== null &&
      Object.hasOwn(bin, target.manifest.binary)
        ? (bin as Record<string, unknown>)[target.manifest.binary]
        : undefined;
    if (typeof path !== 'string' || path.length === 0) {
      return fail('bin', `the bin of ${target.packageName} at ${targetRoot} does not name the command it declares`);
    }
    entry = resolve(targetRoot, path);
  }
  const checked = checkedEntry(targetRoot, entry);
  if (checked.ok === false) return fail('entry', checked.why);

  if (!isAbsolute(process.execPath)) return fail('interpreter', `this Node, ${process.execPath}, is not a full path`);
  const typescript = /\.[cm]?ts$/.test(checked.path);
  const flags = typescript
    ? [STRIP_TYPES, ...(callerSource && runtime.execArgv.includes(TRANSFORM_TYPES) ? [TRANSFORM_TYPES] : [])]
    : [];

  const pins: PathOverrides = {};
  for (const key of request.uses) pins[key] = request.paths[key];
  let words: string[];
  try {
    words = normalizePathOptionWords(request.words, pins, 0);
  } catch (error) {
    return fail('arguments', error instanceof Error ? error.message : String(error));
  }

  const platform = request.platform ?? process.platform;
  const command = new PrintedCommand(
    GATE,
    [process.execPath, ...flags, checked.path, ...words],
    platform,
    checked.path,
  );
  const targetVersion = typeof targetManifest.version === 'string' ? targetManifest.version : null;
  return Object.freeze({
    ok: true as const,
    command,
    basis: Object.freeze({
      direction,
      callerSource,
      callerRoot,
      callerVersion: typeof callerManifest.version === 'string' ? callerManifest.version : null,
      targetRoot,
      targetVersion,
      callerWorkspace,
      targetWorkspace,
      sameCheckout,
      entryKind: source ? ('source' as const) : ('bin' as const),
    }),
  });
}

function notLocated(
  target: ChannelEntry,
  version: string,
  reason: CliNotLocatedReason,
  detail: string,
  nodeVersion: string,
  nodeRange: string | undefined,
): CliCommandNotLocated {
  const named = `${target.manifest.label} ${version} (${target.packageName})`;
  const message =
    nodeRange === undefined
      ? `${named} is not locatable here: ${detail}. Install or update it through your usual route, then try again.`
      : `${named} needs Node ${nodeRange}, and this is Node ${nodeVersion}, so there is no command to run it with here. Run it again under a Node in that range.`;
  return Object.freeze({
    ok: false as const,
    reason,
    product: target.manifest.label,
    package: target.packageName,
    version,
    ...(nodeRange === undefined ? {} : { nodeRange }),
    detail,
    message,
  });
}

/**
 * The entry's real path, when it is a readable regular file inside its package's real root by whole segments — as
 * written and after links are resolved — or why not.
 */
function checkedEntry(root: string, entry: string): { ok: true; path: string } | { ok: false; why: string } {
  if (!isWithin(root, entry)) return { ok: false, why: `${entry} is outside its package, ${root}` };
  let real: string;
  try {
    real = realpathSync(entry);
  } catch {
    return { ok: false, why: `${entry} is not there` };
  }
  if (!isWithin(root, real)) return { ok: false, why: `${entry} leads to ${real}, outside its package, ${root}` };
  try {
    if (!statSync(real).isFile()) return { ok: false, why: `${entry} is not a file` };
    accessSync(real, constants.R_OK);
  } catch {
    return { ok: false, why: `${entry} cannot be read` };
  }
  return { ok: true, path: real };
}

/**
 * The real root of the package `name` installed for a module in `start`, found as Node's own resolution finds one: in
 * `node_modules` of each directory from there up. Not resolved through its `exports` — core's point at a build, and
 * which entry to run is decided here — and never from a global folder, which `import` does not read either.
 */
function installedPackage(start: string, name: string): string | null {
  let dir = resolve(start);
  for (;;) {
    if (basename(dir) !== 'node_modules') {
      const candidate = join(dir, 'node_modules', ...name.split('/'));
      try {
        if (statSync(candidate).isDirectory()) return realpathSync(candidate);
      } catch {
        // not installed here
      }
    }
    const parent = dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

/**
 * The real repository checkout whose workspace lists `root` as one of its packages, or null: the nearest
 * `pnpm-workspace.yaml` above it, and its `packages` globs. A package under the checkout but not one of them — an
 * installed copy in its `node_modules` — is not a workspace package of it.
 */
function workspaceOf(root: string): string | null {
  let dir = dirname(root);
  for (;;) {
    const globs = workspaceGlobs(dir);
    if (globs !== null) return inWorkspace(relative(dir, root).split(sep), globs) ? dir : null;
    const parent = dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

/** The `packages` globs of `dir/pnpm-workspace.yaml`, or null when there is no such file. */
function workspaceGlobs(dir: string): string[] | null {
  let text: string;
  try {
    text = readFileSync(join(dir, 'pnpm-workspace.yaml'), 'utf8');
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    return code === 'ENOENT' || code === 'ENOTDIR' ? null : [];
  }
  const unquote = (glob: string) => glob.trim().replace(/^(['"])(.*)\1$/, '$2');
  const lines = text.split(/\r?\n/);
  const at = lines.findIndex((line) => /^packages\s*:/.test(line));
  if (at < 0) return [];
  const inline = /^packages\s*:\s*\[(.*)\]\s*(?:#.*)?$/.exec(lines[at] as string);
  if (inline) return (inline[1] ?? '').split(',').map(unquote).filter(Boolean);
  const globs: string[] = [];
  for (const line of lines.slice(at + 1)) {
    if (/^\s*(?:#.*)?$/.test(line)) continue;
    const item = /^\s+-\s*(.*?)\s*(?:#.*)?$/.exec(line);
    if (!item) break;
    globs.push(unquote(item[1] ?? ''));
  }
  return globs;
}

/** Whether a path, as segments from the workspace root, is one of its packages: some glob takes it and no `!` one. */
function inWorkspace(segments: readonly string[], globs: readonly string[]): boolean {
  const matches = (glob: string) =>
    segmentsMatch(
      segments,
      glob
        .replace(/^\.\//, '')
        .replace(/\/+$/, '')
        .split('/')
        .filter((part) => part !== '.'),
    );
  const included = globs.filter((glob) => !glob.startsWith('!'));
  const excluded = globs.filter((glob) => glob.startsWith('!')).map((glob) => glob.slice(1));
  return included.some(matches) && !excluded.some(matches);
}

function segmentsMatch(path: readonly string[], pattern: readonly string[]): boolean {
  const [head, ...rest] = pattern;
  if (head === undefined) return path.length === 0;
  if (head === '**') return segmentsMatch(path, rest) || (path.length > 0 && segmentsMatch(path.slice(1), pattern));
  const [segment] = path;
  if (segment === undefined) return false;
  const glob = new RegExp(`^${head.split('*').map(escapeRegExp).join('[^/]*')}$`);
  return glob.test(segment) && segmentsMatch(path.slice(1), rest);
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
