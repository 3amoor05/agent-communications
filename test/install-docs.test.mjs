import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { REGISTRY } from '../scripts/channels.mjs';
import { PACKAGES } from '../scripts/packages.mjs';

/**
 * What the documents tell a person to run to register, re-register and tidy up the MCP server, against what the
 * CLIs do.
 *
 * Each of these was wrong in a way nothing else caught, because the code they describe had changed under them and
 * had its own tests. The plugin's description said `npx -y @agentcomms/slack mcp install`, which has needed
 * `--client` since the CLIs stopped writing into a client nobody named: exit 64 on the first thing a new user
 * runs. The troubleshooting page offered `mcp install --list`, a flag that never existed, and a `jq` filter on
 * `.name`, a field no check has. Its "re-register" commands, and the setup skill's fix for `mcp-command`, are
 * refused for an entry that is already there unless they carry `--force`. And four pages promised `mcp prune`
 * never removes a runtime "any client registers", which is more than any config scan can see.
 *
 * `docs/reference` is left out because it is generated from the CLIs themselves, and the design specs and the
 * changelog because they record what was true when they were written.
 */

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const run = promisify(execFile);

async function markdownUnder(directory) {
  const found = [];
  for (const entry of await readdir(join(ROOT, directory), { withFileTypes: true, recursive: true })) {
    if (entry.isFile() && entry.name.endsWith('.md')) found.push(join(entry.parentPath, entry.name));
  }
  return found;
}

async function documents() {
  const files = [
    ...(await markdownUnder('docs')).filter((path) => !/[/\\](?:reference|superpowers)[/\\]/.test(path)),
    ...(await markdownUnder('skills')),
    join(ROOT, 'README.md'),
    // Every published package's README, from the channel registry: a new channel's is checked from its first commit.
    ...PACKAGES.map((name) => join(ROOT, 'packages', name, 'README.md')),
    join(ROOT, '.claude-plugin', 'marketplace.json'),
    join(ROOT, 'gemini-extension.json'),
  ];
  return Promise.all(files.map(async (path) => ({ path: relative(ROOT, path), text: await readFile(path, 'utf8') })));
}

/**
 * Every `mcp install` a document gives, with the CLI it belongs to and the flags it passes.
 *
 * The core's too: `agentcomms mcp install` is the one registration that has to come from a terminal, so it is the
 * first command a person copies from the README.
 */
function installCommands(text) {
  const found = [];
  for (const [command, binary, tail] of text.matchAll(INSTALL)) {
    const words = (tail.split('#')[0] ?? '').trim().split(/\s+/).filter(Boolean);
    found.push({
      command: command.trim(),
      cli: channelOf(binary),
      flags: words.filter((word) => word.startsWith('--')),
    });
  }
  return found;
}

const escapeRegExp = (text) => text.replace(/[\\^$.*+?()[\]{}|/]/g, '\\$&');

/**
 * How each channel's `mcp install` is spelled in a document — by its binary, or by its package through `npx` — read
 * from the channel registry, so a new channel's install commands are checked like the others'.
 */
const SPELLINGS = REGISTRY.channels.flatMap(({ directory, packageName, manifest }) => [
  // Not part of a longer word or of the scope: `agentcomms` is also the start of `@agentcomms/…`.
  { channel: directory, pattern: `(?<![@\\w-])${escapeRegExp(manifest.binary)}` },
  { channel: directory, pattern: `${escapeRegExp(packageName)}(?:@\\S+)?` },
]);
const INSTALL = new RegExp(
  `(${SPELLINGS.map((spelling) => spelling.pattern).join('|')}) mcp install([^\`|"\\n]*)`,
  'g',
);
const channelOf = (spelled) =>
  SPELLINGS.find((spelling) => new RegExp(`^(?:${spelling.pattern})$`).test(spelled))?.channel;

/** The flags `mcp install --help` lists, read with a scratch home: `--help` reads no config, and must not start to. */
async function installFlags(cli) {
  const home = await mkdtemp(join(tmpdir(), 'install-docs-'));
  const { stdout } = await run(
    process.execPath,
    [
      '--experimental-strip-types',
      '--disable-warning=ExperimentalWarning',
      join(ROOT, 'packages', cli, 'src', 'cli.ts'),
      'mcp',
      'install',
      '--help',
    ],
    {
      env: {
        PATH: process.env.PATH ?? '',
        HOME: home,
        USERPROFILE: home,
        AGENT_COMMS_CONFIG_DIR: join(home, 'config'),
        NO_COLOR: '1',
        AGENT_COMMS_UPDATE_CHECK: 'off',
      },
    },
  ).finally(() => rm(home, { recursive: true, force: true }));
  return new Set(stdout.match(/--[a-z][a-z-]*/g) ?? []);
}

test('every `mcp install` a document gives names a client, and passes only flags the CLI has', async () => {
  const known = Object.fromEntries(
    await Promise.all(REGISTRY.channels.map(async ({ directory }) => [directory, await installFlags(directory)])),
  );
  assert.ok(known.gmail.has('--client') && known.slack.has('--force'), 'the help text was not read');
  assert.ok(known.core.has('--client') && known.core.has('--approval'), 'the core usage table was not read');

  const wrong = [];
  let seen = 0;
  for (const { path, text } of await documents()) {
    for (const { command, cli, flags } of installCommands(text)) {
      seen += 1;
      if (!flags.includes('--client')) wrong.push(`${path}: ${command} has no --client`);
      for (const flag of flags) if (!known[cli].has(flag)) wrong.push(`${path}: ${command} passes ${flag}`);
    }
  }
  assert.ok(seen > 10, `only ${seen} commands found — the pattern is wrong`);
  assert.deepEqual(wrong, []);
});

test("a command that re-registers an entry that is already there carries --force, or is doctor's own fix", async () => {
  const wrong = [];
  for (const { path, text } of await documents()) {
    for (const line of text.split('\n')) {
      if (!/mcp install/.test(line) || !/re-?register|rewrites|re-run|mcp-command/i.test(line)) continue;
      if (/--force|the `fix`/.test(line)) continue;
      wrong.push(`${path}: ${line.trim()}`);
    }
  }
  assert.deepEqual(wrong, []);
});

test('doctor checks are picked out by id, the field every check has', async () => {
  const wrong = [];
  for (const { path, text } of await documents()) {
    for (const line of text.split('\n')) {
      if (/doctor/.test(line) && /select\(\.name\b/.test(line)) wrong.push(`${path}: ${line.trim()}`);
    }
  }
  assert.deepEqual(wrong, []);
});

test('no document promises that prune keeps whatever any client registers', async () => {
  const wrong = [];
  for (const { path, text } of await documents()) {
    // Prose wraps, so the words are matched across line breaks.
    const prose = text.replace(/\s+/g, ' ');
    for (const [promise] of prose.matchAll(
      /\b(?:any|no) (?:MCP )?client registers\b|keeps anything a client registers/gi,
    )) {
      wrong.push(`${path}: ${promise}`);
    }
  }
  assert.deepEqual(wrong, []);
});

test('troubleshooting gives 0.13.0’s bare commands a best-effort way to run, at that exact release and never latest (CUE-403)', async () => {
  // Design 2026-10-04, D7: what a person can do with a command 0.13.0 or earlier printed by its bare name, and what
  // that cannot recover. And D8 and §5: PATH shims are a follow-up, and on Windows a default Node gives words to type.
  const page = await readFile(join(ROOT, 'docs', 'troubleshooting.md'), 'utf8');
  const start = page.indexOf('### A command a result gave you is not found');
  assert.notEqual(start, -1, 'the section is there');
  const end = page.indexOf('\n### ', start + 4);
  const section = page.slice(start, end === -1 ? undefined : end);
  const prose = section.replace(/\s+/g, ' ');

  // 0.13.1: the command, the words to type, or none here.
  assert.match(prose, /names the Node and the file of the installation that printed it/);
  assert.match(prose, /not locatable here/);
  assert.match(prose, /C:\\Program Files/);
  assert.match(prose, /words to type/);
  // The two routes for an older result: a managed registration's own Node and entry, and npx at exactly that release.
  assert.match(prose, /best effort/i);
  assert.match(section, /runtime\/0\.13\.0-<product>\/node_modules\/@agentcomms\/<product>\/dist\/cli\.mjs/);
  assert.match(section, /npx -y @agentcomms\/<product>@0\.13\.0 /);
  // Every package spec — not a path through a package's folder — names that exact release.
  for (const [spec] of section.matchAll(/@agentcomms\/[a-z<>-]+(?![\w/<>-])(?:@\S+)?/g)) {
    assert.match(spec, /@0\.13\.0$/, `${spec}: the exact release that printed it, never latest or a range`);
  }
  assert.doesNotMatch(section, /latest/, 'never latest');
  // What neither can do.
  assert.match(prose, /global install or a checkout/);
  assert.match(prose, /AGENT_COMMS_CONFIG_DIR/);
  assert.match(prose, /`comms_paths`.*cannot/);
  assert.match(prose, /npx may not be installed/i);
  assert.match(prose, /may not name its Node/);
  // PATH shims are not part of this.
  assert.match(prose, /PATH shims/);
  assert.match(prose, /follow-up/);
});
