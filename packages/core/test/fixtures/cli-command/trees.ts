import { chmodSync, existsSync, mkdirSync, realpathSync, symlinkSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { CHANNEL_SNAPSHOT } from '../../../src/channels.generated.ts';
import type { RegisteredServer } from '../../../src/mcp-clients.ts';
import { VERSION } from '../../../src/version.ts';
import { tempDir } from '../../helpers/temp.ts';

/*
 * Package trees for the CLI locator, written into a temporary directory: the shapes an installation of this suite takes
 * on disk — a managed runtime, an npx cache, a global prefix, a checkout with or without a build — reduced to the files
 * the locator reads. Nothing in them runs; each entry is a one-line module.
 */

/** This release: the trees are of the same version as the core locating in them, as a same-release install is. */
export { VERSION };

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
    const short = shortName(channel);
    const at = writePackage(join(root, 'packages', short), channel, {
      files: ['src/cli.ts', 'src/mcp/install.ts', 'dist/cli.mjs'],
    });
    link(join('..', '..', '..', 'core'), join(at, 'node_modules', '@agentcomms', 'core'));
    packages[channel] = at;
  }
  return { root, core, packages };
}

/** The unscoped name of a channel's package: `gmail`, `core`. */
export function shortName(channel: string): string {
  return suiteEntry(channel).packageName.split('/')[1] ?? channel;
}

/**
 * A managed runtime as the installer leaves one — `<data>/runtime/<version>-<name>/node_modules/@agentcomms/<name>` —
 * and the CLI a managed registration starts. `handMade` leaves out the runtime's own manifest: a directory of that
 * shape somebody made, not the installer.
 */
export function writeManaged(
  dataDir: string,
  channel: string,
  options: { version?: string; spec?: PackageSpec; handMade?: boolean } = {},
): { root: string; entry: string } {
  const version = options.version ?? VERSION;
  const short = shortName(channel);
  const runtime = join(dataDir, 'runtime', `${version}-${short}`);
  const root = join(runtime, 'node_modules', '@agentcomms', short);
  writePackage(root, channel, { version, files: ['dist/cli.mjs'], ...options.spec });
  if (!options.handMade) {
    writeFileSync(
      join(runtime, 'package.json'),
      `${JSON.stringify({ name: `${suiteEntry(channel).manifest.binary}-runtime`, private: true, dependencies: { [suiteEntry(channel).packageName]: version } })}\n`,
    );
  }
  return { root, entry: join(root, 'dist', 'cli.mjs') };
}

/**
 * A global npm install under `prefix`: on POSIX the package in `lib/node_modules` and its command in `bin`, a link to
 * the package's CLI; on Windows (`windows`) the package in `node_modules` and its command a `.cmd` script beside it.
 */
export function writeGlobal(
  prefix: string,
  channel: string,
  options: { windows?: boolean; version?: string; spec?: PackageSpec; command?: string } = {},
): { root: string; command: string } {
  const short = shortName(channel);
  const { binary } = suiteEntry(channel).manifest;
  const root = join(prefix, ...(options.windows ? [] : ['lib']), 'node_modules', '@agentcomms', short);
  writePackage(root, channel, {
    files: ['dist/cli.mjs'],
    ...(options.version ? { version: options.version } : {}),
    ...options.spec,
  });
  if (options.windows) {
    const command = join(prefix, options.command ?? `${binary}.cmd`);
    writeFile(
      command,
      `@ECHO off\r\n"%~dp0\\node.exe" "%~dp0\\node_modules\\@agentcomms\\${short}\\dist\\cli.mjs" %*\r\n`,
    );
    return { root, command };
  }
  const command = link(
    join('..', 'lib', 'node_modules', '@agentcomms', short, 'dist', 'cli.mjs'),
    join(prefix, 'bin', options.command ?? binary),
  );
  return { root, command };
}

/** A registered server as a client's file holds one: by default a user-scope Claude Code entry. */
export function registration(
  over: Partial<RegisteredServer> & Pick<RegisteredServer, 'command' | 'args'>,
): RegisteredServer {
  return { client: 'claude-code', path: '/cfg/.claude.json', name: 'server', scope: 'user', ...over };
}

/** The four registration pins of a set of directories, spaced. */
export function pinArgs(paths: { configDir: string; stateDir: string; dataDir: string; secretsDir: string }): string[] {
  return [
    '--config-dir',
    paths.configDir,
    '--state-dir',
    paths.stateDir,
    '--data-dir',
    paths.dataDir,
    '--secrets-dir',
    paths.secretsDir,
  ];
}

/**
 * A program at `dir/name` that only leaves a mark when it runs: a registered interpreter that must never be started.
 */
export function markingProgram(dir: string, name = 'node'): { path: string; ran: () => boolean } {
  const marker = join(dir, `${name}.ran`);
  const path = writeFile(join(dir, name), `#!/bin/sh\necho ran > '${marker}'\n`);
  chmodSync(path, 0o755);
  return { path, ran: () => existsSync(marker) };
}
