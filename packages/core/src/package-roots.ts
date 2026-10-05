import { readFileSync, realpathSync } from 'node:fs';
import { basename, dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { CHANNEL_SNAPSHOT } from './channels.generated.ts';

/**
 * What a package's own `package.json` says, read from disk, where one package ends, and which commands are this suite's
 * — the facts both the CLI locator (`cli-command.ts`) and the external-command constructor (`command-brands.ts`)
 * decide from.
 *
 * Synchronous: a printed command is often built where a sentence is, inside a hint or a renderer, and these are a
 * handful of small local reads. Nothing here runs anything, and nothing here imports the rest of core.
 */

/** The scope every package of this suite is published under. */
export const SUITE_SCOPE = '@agentcomms/';

/** Every command a manifest declares — each channel's `binary` and its server's other `bins` — lowercased. */
export const SUITE_COMMANDS: ReadonlySet<string> = new Set(
  CHANNEL_SNAPSHOT.flatMap(({ manifest }) => [manifest.binary, ...(manifest.server.bins ?? [])]).map((name) =>
    name.toLowerCase(),
  ),
);

/** The extensions Windows finds an executable by: `agent-gmail.cmd` is `agent-gmail`. */
export const EXECUTABLE_EXTENSION: RegExp = /\.(?:cmd|exe|bat|ps1|com)$/i;

/**
 * The suite command a word names as a program — its last path part, without a Windows extension, compared without
 * case as Windows compares executable names — or null.
 */
export function suiteCommandOf(word: string): string | null {
  const name = (word.split(/[\\/]/).at(-1) ?? '').replace(EXECUTABLE_EXTENSION, '').toLowerCase();
  return SUITE_COMMANDS.has(name) ? name : null;
}

/** A parsed `package.json`, as an object, or null when there is none, it cannot be read, or it is not an object. */
export function readPackageManifest(dir: string): Record<string, unknown> | null {
  const read = readPackageFile(dir);
  return read === 'absent' ? null : read;
}

/** `absent` when the directory has no `package.json`; otherwise what it says, or null when that cannot be read. */
function readPackageFile(dir: string): Record<string, unknown> | null | 'absent' {
  let text: string;
  try {
    text = readFileSync(join(dir, 'package.json'), 'utf8');
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    return code === 'ENOENT' || code === 'ENOTDIR' ? 'absent' : null;
  }
  try {
    const parsed: unknown = JSON.parse(text);
    return typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

/**
 * The nearest package at or above `start`: the first directory with a `package.json`, and what it says (null when it
 * cannot be read or parsed). Not the nearest one with a particular name — the package a module belongs to is the
 * nearest one, as Node itself decides, and a caller that names a different one has to be told so.
 */
export function nearestPackage(start: string): { root: string; manifest: Record<string, unknown> | null } | null {
  let dir = resolve(start);
  for (;;) {
    const manifest = readPackageFile(dir);
    if (manifest !== 'absent') return { root: dir, manifest };
    const parent = dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

/**
 * Whether `path` is `root` or inside it, by whole path segments: `/x/core-evil` is not inside `/x/core`, which a
 * comparison of strings would say it was. Both are taken as given; a caller compares real paths with real paths.
 */
export function isWithin(root: string, path: string): boolean {
  const between = relative(resolve(root), resolve(path));
  return between === '' || (!isAbsolute(between) && between !== '..' && !/^\.\.[\\/]/.test(between));
}

/** The real path of `path`, or of its deepest ancestor that exists with the rest joined on; null when none does. */
export function realpathOfExisting(path: string): string | null {
  let current = resolve(path);
  const rest: string[] = [];
  for (;;) {
    try {
      const real = realpathSync(current);
      return rest.length === 0 ? real : join(real, ...rest.reverse());
    } catch {
      const parent = dirname(current);
      if (parent === current) return null;
      rest.push(basename(current));
      current = parent;
    }
  }
}

/**
 * The root of the suite package `path` is in — itself or any ancestor whose `package.json` names a package of this
 * suite — as written and after resolving links, or null. Every ancestor is looked at, not only the nearest package:
 * a file in `packages/gmail/node_modules/x` is still inside Gmail's root.
 */
export function suitePackageRootOf(path: string): string | null {
  const candidates = [resolve(path)];
  const real = realpathOfExisting(path);
  if (real !== null && real !== candidates[0]) candidates.push(real);
  for (const candidate of candidates) {
    let dir = candidate;
    for (;;) {
      const name = readPackageManifest(dir)?.name;
      if (typeof name === 'string' && name.startsWith(SUITE_SCOPE)) return dir;
      const parent = dirname(dir);
      if (parent === dir) break;
      dir = parent;
    }
  }
  return null;
}
