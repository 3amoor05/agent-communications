import { mkdirSync, realpathSync, symlinkSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { CHANNEL_SNAPSHOT } from '../../../src/channels.generated.ts';
import { tempDir } from '../../helpers/temp.ts';

/*
 * Package trees for the CLI locator, written into a temporary directory: the shapes an installation of this suite takes
 * on disk — a managed runtime, an npx cache, a global prefix, a checkout with or without a build — reduced to the files
 * the locator reads. Nothing in them runs; each entry is a one-line module.
 */

export const VERSION = '0.13.0';

/** A package of this suite, by its channel word, as core's snapshot of the manifests has it. */
export function suiteEntry(channel: string): (typeof CHANNEL_SNAPSHOT)[number] {
  const entry = CHANNEL_SNAPSHOT.find((each) => each.manifest.channel === channel);
  if (!entry) throw new Error(`no channel ${channel}`);
  return entry;
}

export interface PackageSpec {
  /** Defaults to the channel's package name. */
  name?: string;
  version?: string;
  /** `engines.node`; null leaves it out. */
  engines?: string | null;
  /** `agentcomms.binary`; null leaves the field out. Defaults to the channel's binary. */
  binary?: string | null;
  /** `bin`; null leaves it out. Defaults to the channel's binary mapped to `./dist/cli.mjs`. */
  bin?: Record<string, string> | null;
  /** Files to create, relative to the package root. Defaults to `src/cli.ts` and `dist/cli.mjs`. */
  files?: readonly string[];
}

/** Writes one package of `channel` at `root`, and returns `root`. */
export function writePackage(root: string, channel: string, spec: PackageSpec = {}): string {
  const entry = suiteEntry(channel);
  const binary = spec.binary === undefined ? entry.manifest.binary : spec.binary;
  const manifest: Record<string, unknown> = {
    name: spec.name ?? entry.packageName,
    version: spec.version ?? VERSION,
    type: 'module',
  };
  if (spec.engines !== null) manifest.engines = { node: spec.engines ?? '>=22.12.0' };
  if (spec.bin !== null) manifest.bin = spec.bin ?? { [entry.manifest.binary]: './dist/cli.mjs' };
  if (binary !== null) manifest.agentcomms = { channel, binary };
  mkdirSync(root, { recursive: true });
  writeFileSync(join(root, 'package.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  for (const file of spec.files ?? ['src/cli.ts', 'dist/cli.mjs']) writeFile(join(root, file));
  return root;
}

/** A one-line module at `path`, its directories created. */
export function writeFile(path: string, text = 'export {};\n'): string {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, text);
  return path;
}

/** A symbolic link at `path` to `target`, its directory created. */
export function link(target: string, path: string): string {
  mkdirSync(dirname(path), { recursive: true });
  symlinkSync(target, path);
  return path;
}

/** The `file:` URL of a module of a package: what a caller's `import.meta.url` is. */
export function moduleUrl(root: string, ...segments: string[]): string {
  return pathToFileURL(join(root, ...segments)).href;
}

/** A fresh, real (symlink-free) temporary directory: macOS's own is behind `/var` → `/private/var`. */
export function realTemp(prefix = 'cli-command-'): string {
  return realpathSync(tempDir(prefix));
}

/**
 * A checkout of this repository: `pnpm-workspace.yaml` naming `packages/*`, core and the named channels under
 * `packages/`, and each channel's `node_modules/@agentcomms/core` linked to the sibling core, as pnpm links a
 * workspace dependency.
 */
export function writeCheckout(
  root: string,
  channels: readonly string[],
  options: { coreFiles?: readonly string[]; coreVersion?: string } = {},
): { root: string; core: string; packages: Record<string, string> } {
  mkdirSync(root, { recursive: true });
  writeFileSync(join(root, 'pnpm-workspace.yaml'), "packages:\n  - 'packages/*'\n\ncatalog:\n  zod: ^4.0.0\n");
  writeFileSync(join(root, 'package.json'), `${JSON.stringify({ name: 'agent-communications', private: true })}\n`);
  const core = writePackage(join(root, 'packages', 'core'), 'core', {
    ...(options.coreFiles === undefined ? {} : { files: options.coreFiles }),
    ...(options.coreVersion === undefined ? {} : { version: options.coreVersion }),
  });
  const packages: Record<string, string> = {};
  for (const channel of channels) {
    const short = suiteEntry(channel).packageName.split('/')[1] ?? channel;
    const at = writePackage(join(root, 'packages', short), channel, {
      files: ['src/cli.ts', 'src/mcp/install.ts', 'dist/cli.mjs'],
    });
    link(join('..', '..', '..', 'core'), join(at, 'node_modules', '@agentcomms', 'core'));
    packages[channel] = at;
  }
  return { root, core, packages };
}
