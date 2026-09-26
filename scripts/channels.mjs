#!/usr/bin/env node
/**
 * The channel registry: the one list of channels this repository's tooling reads, derived from the one place each
 * channel says what it is — the `"agentcomms"` field of its `package.json` (design 2026-09-26).
 *
 * The 2026-09-20 skills design promised this list, and it was never built: which channels exist was written down
 * about eleven times instead — the publish list, the licence script, the parity surfaces and drivers, the reference
 * generator, the version sync, the skill contracts and four tests — and each copy was one more place a new channel
 * had to be added by hand, or would silently not be checked. Every one of those now reads `REGISTRY`, a view of this
 * derivation, so a new `packages/<channel>` with the field is discovered by all of them without an edit.
 *
 * Plain JavaScript with no dependencies, on purpose: the release workflow runs `node scripts/packages.mjs` — which
 * reads this — in a job that installs nothing. So this only *reads* the manifests. They are *checked*, against core's
 * zod schema and against each other, by `scripts/sync-channels.mjs`, which `pnpm verify` runs; and core's snapshot of
 * them is written there too.
 *
 *   node scripts/channels.mjs      # prints the channel words, e.g. core gmail resend slack whatsapp
 */
import { readdirSync, readFileSync, realpathSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = fileURLToPath(new URL('..', import.meta.url));

export const SCOPE = '@agentcomms';

/**
 * Every package under `root/packages` that declares a channel, as `{ directory, packageName, manifest, packageJson }`:
 * the core first, then the rest by their channel word.
 *
 * A directory is found by being there. There is no list to add a channel to — a new `packages/<channel>` with the field
 * is a channel for every tool that reads this. A channel's word is its directory's name, as a package's directory is
 * its unscoped name, so the two cannot drift apart.
 */
export function readChannels(root = ROOT) {
  const found = [];
  for (const entry of readdirSync(join(root, 'packages'), { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const packageJson = readPackageJson(root, entry.name);
    if (packageJson === null) continue;
    const manifest = packageJson.agentcomms;
    if (manifest === undefined) continue;
    if (manifest === null || typeof manifest !== 'object' || typeof manifest.channel !== 'string') {
      throw new Error(`packages/${entry.name}/package.json: "agentcomms" has no channel`);
    }
    if (manifest.channel !== entry.name) {
      throw new Error(
        `packages/${entry.name}/package.json: declares channel "${manifest.channel}", but a channel's word is its directory's name`,
      );
    }
    if (packageJson.name !== `${SCOPE}/${entry.name}`) {
      throw new Error(`packages/${entry.name}/package.json: a channel's package is ${SCOPE}/${entry.name}`);
    }
    found.push({ directory: entry.name, packageName: packageJson.name, manifest, packageJson });
  }
  return found.sort((a, b) =>
    a.directory === 'core' ? -1 : b.directory === 'core' ? 1 : a.directory < b.directory ? -1 : 1,
  );
}

function readPackageJson(root, directory) {
  try {
    return JSON.parse(readFileSync(join(root, 'packages', directory, 'package.json'), 'utf8'));
  } catch (error) {
    if (error?.code === 'ENOENT') return null;
    throw new Error(`packages/${directory}/package.json: ${error.message}`);
  }
}

/**
 * The order packages are published in: each after every package of this suite it depends on, and otherwise by name.
 *
 * Load-bearing — a consumer installing `gmail` must find the exact `core` it pins already on the registry — so it is
 * computed from the dependencies rather than trusted, and `test/release-packages.test.mjs` still checks the result.
 */
function publishOrder(root, names) {
  const depends = new Map(
    names.map((name) => {
      const manifest = readPackageJson(root, name);
      if (manifest === null) throw new Error(`a channel names ${SCOPE}/${name}, and there is no packages/${name}`);
      const fields = ['dependencies', 'optionalDependencies', 'peerDependencies', 'devDependencies'];
      const own = fields.flatMap((field) => Object.keys(manifest[field] ?? {}));
      return [name, own.filter((d) => d.startsWith(`${SCOPE}/`)).map((d) => d.slice(SCOPE.length + 1))];
    }),
  );
  const ordered = [];
  const pending = new Set(names);
  while (pending.size > 0) {
    const ready = [...pending].filter((name) => depends.get(name).every((d) => !pending.has(d))).sort();
    if (ready.length === 0)
      throw new Error(`these packages depend on each other in a circle: ${[...pending].join(', ')}`);
    ordered.push(ready[0]);
    pending.delete(ready[0]);
  }
  return ordered;
}

/**
 * Gmail's reference pages kept the names they had before there was a second channel: they are linked from outside
 * this repository. Every channel after it gets `docs/reference/<channel>-cli.md` and `<channel>-mcp-tools.md`.
 */
const REFERENCE_NAMES = Object.freeze({
  gmail: { cli: 'docs/reference/cli.md', mcp: 'docs/reference/mcp-tools.md' },
});

/** `Gmail` → `Gmail`, `WhatsApp` → `WhatsApp`: the middle of a server factory's name, `create<Name>McpServer`. */
const pascal = (label) => {
  const letters = label.replace(/[^A-Za-z0-9]/g, '');
  return letters.charAt(0).toUpperCase() + letters.slice(1);
};

const escapeRegExp = (text) => text.replace(/[\\^$.*+?()[\]{}|/]/g, '\\$&');

/**
 * Everything the tooling knows about the channels under `root`, derived from their manifests.
 *
 * - `channels`: the entries `readChannels` returns.
 * - `packages`: every package to publish, in publish order — each channel, and any package a channel's server is run
 *   through (`server.npxPackage`, Gmail's `gmail-mcp`).
 * - `wrappers`: those server-only packages, and the channel each wraps.
 * - `surfaces`: how each CLI and server is read (`registries.mjs`); `drivers`: how each is driven (`operations.mjs`).
 *   A channel's CLI is `src/cli.ts`, its Commander program `src/cli/program.ts` exporting `run`, and its server
 *   `src/mcp/server.ts` exporting `create<Label>McpServer`. The core's CLI is a usage table, and `main`.
 * - `reference`: each channel's generated reference pages. `products`: what `tool-drift` checks.
 * - `skillFamilies`: each channel's skill prefix and contract, with the words of every *other* channel its skills
 *   must never use (`foreign`). The core's `comms-` skills manage every channel, so theirs is empty.
 * - `platforms`: the platform words accounts are named with (`cue/<platform>`).
 */
export function loadRegistry(root = ROOT) {
  const channels = readChannels(root);
  const wrappers = {};
  for (const { directory, packageName, manifest } of channels) {
    const npx = manifest.server?.npxPackage;
    if (typeof npx === 'string' && npx !== packageName && npx.startsWith(`${SCOPE}/`)) {
      wrappers[npx.slice(SCOPE.length + 1)] = directory;
    }
  }
  const packages = publishOrder(root, [...channels.map((c) => c.directory), ...Object.keys(wrappers)]);

  const isCore = (directory) => directory === 'core';
  const surfaces = channels.map(({ directory, manifest }) =>
    isCore(directory)
      ? { package: directory, binary: manifest.binary, entry: `packages/${directory}/src/cli.ts`, cli: 'usage' }
      : {
          package: directory,
          binary: manifest.binary,
          entry: `packages/${directory}/src/cli.ts`,
          program: `packages/${directory}/src/cli/program.ts`,
          cli: 'commander',
        },
  );
  const drivers = Object.fromEntries(
    channels.map(({ directory, manifest }) => [
      directory,
      isCore(directory)
        ? {
            cli: `packages/${directory}/src/cli.ts`,
            run: 'main',
            server: `packages/${directory}/src/mcp/server.ts`,
            factory: 'createCoreMcpServer',
          }
        : {
            cli: `packages/${directory}/src/cli/program.ts`,
            run: 'run',
            server: `packages/${directory}/src/mcp/server.ts`,
            factory: `create${pascal(manifest.label)}McpServer`,
          },
    ]),
  );
  /** A channel's tool prefix is its word; the core's tools are `comms_…`. */
  const toolPrefix = (directory, manifest) => (isCore(directory) ? 'comms' : manifest.channel);
  const reference = Object.fromEntries(
    channels.map(({ directory }) => [
      directory,
      REFERENCE_NAMES[directory] ?? {
        cli: isCore(directory) ? null : `docs/reference/${directory}-cli.md`,
        mcp: `docs/reference/${directory}-mcp-tools.md`,
      },
    ]),
  );
  const products = channels.map(({ directory, manifest }) => {
    const surface = surfaces.find((s) => s.package === directory);
    return {
      channel: directory,
      tool: toolPrefix(directory, manifest),
      binary: manifest.binary,
      server: drivers[directory].server,
      reference: reference[directory].mcp,
      program: surface.program ?? surface.entry,
      ...(surface.cli === 'usage' ? { usage: true } : {}),
    };
  });

  const skillDirectories = (() => {
    try {
      return readdirSync(join(root, 'skills'), { withFileTypes: true })
        .filter((entry) => entry.isDirectory() && !entry.name.startsWith('_'))
        .map((entry) => entry.name)
        .sort();
    } catch (error) {
      if (error?.code === 'ENOENT') return [];
      throw error;
    }
  })();
  /** What names a channel: its tools, its commands, its packages and its skills. */
  const wordsOf = ({ directory, packageName, manifest }) => [
    new RegExp(`\\b${escapeRegExp(toolPrefix(directory, manifest))}_[a-z_]+`),
    ...[manifest.binary, ...(manifest.server?.bins ?? [])].map((binary) => new RegExp(`\\b${escapeRegExp(binary)}\\b`)),
    ...[
      packageName,
      ...Object.entries(wrappers)
        .filter(([, of]) => of === directory)
        .map(([w]) => `${SCOPE}/${w}`),
    ].map((name) => new RegExp(`${escapeRegExp(name)}\\b`)),
    ...skillDirectories
      .filter((skill) => manifest.skills && skill.startsWith(manifest.skills.prefix))
      .map((skill) => new RegExp(`\\b${escapeRegExp(skill)}\\b`)),
  ];
  const skillFamilies = channels
    .filter(({ manifest }) => manifest.skills)
    .map((channel) => ({
      channel: channel.directory,
      family: channel.manifest.skills.prefix.slice(0, -1),
      prefix: channel.manifest.skills.prefix,
      contract: channel.manifest.skills.contract,
      readme: `packages/${channel.directory}/README.md`,
      foreign: isCore(channel.directory)
        ? []
        : channels.filter((other) => other !== channel && !isCore(other.directory)).flatMap(wordsOf),
    }));
  const platforms = channels.filter(({ manifest }) => manifest.accounts).map(({ manifest }) => manifest.channel);

  return { root, channels, packages, wrappers, surfaces, drivers, reference, products, skillFamilies, platforms };
}

/** The registry of this checkout. */
export const REGISTRY = loadRegistry();

/** The skill family a skill belongs to, by its name's prefix — or undefined, which every reader refuses. */
export function skillFamilyOf(registry, skill) {
  return registry.skillFamilies.find((family) => skill.startsWith(family.prefix));
}

// Run directly, print the channel words.
const invoked = process.argv[1] ? realpathSync(process.argv[1]) : '';
if (invoked === realpathSync(fileURLToPath(import.meta.url))) {
  process.stdout.write(`${REGISTRY.channels.map((channel) => channel.directory).join(' ')}\n`);
}
