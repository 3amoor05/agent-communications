#!/usr/bin/env node
/**
 * The channels this repository ships, read from the one place each says what it is: the `"agentcomms"` field of its
 * `package.json` (design 2026-09-26).
 *
 * Plain JavaScript with no dependencies, on purpose: the release workflow runs `node scripts/packages.mjs` — which
 * reads this — in a job that installs nothing. So this only *reads* the manifests. They are *checked*, against core's
 * zod schema and against each other, by `scripts/sync-channels.mjs`, which `pnpm verify` runs; and core's snapshot of
 * them is written there too.
 *
 *   node scripts/channels.mjs      # prints: core gmail slack
 */
import { readdirSync, readFileSync, realpathSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = fileURLToPath(new URL('..', import.meta.url));

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
    let packageJson;
    try {
      packageJson = JSON.parse(readFileSync(join(root, 'packages', entry.name, 'package.json'), 'utf8'));
    } catch (error) {
      if (error?.code === 'ENOENT') continue;
      throw new Error(`packages/${entry.name}/package.json: ${error.message}`);
    }
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
    found.push({ directory: entry.name, packageName: packageJson.name, manifest, packageJson });
  }
  return found.sort((a, b) =>
    a.directory === 'core' ? -1 : b.directory === 'core' ? 1 : a.directory < b.directory ? -1 : 1,
  );
}

// Run directly, print the channel words.
const invoked = process.argv[1] ? realpathSync(process.argv[1]) : '';
if (invoked === realpathSync(fileURLToPath(import.meta.url))) {
  process.stdout.write(
    `${readChannels()
      .map((channel) => channel.directory)
      .join(' ')}\n`,
  );
}
