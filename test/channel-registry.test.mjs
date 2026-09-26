import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { cp, mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { promisify } from 'node:util';
import { loadRegistry, REGISTRY } from '../scripts/channels.mjs';
import { snapshotSource } from '../scripts/sync-channels.mjs';
import { tempDir } from './helpers/temp-dir.mjs';

/**
 * One registry of channels for every tool in this repository (design 2026-09-26, step 2).
 *
 * Which channels exist was written down about eleven times — the publish list, the licence script, the parity
 * surfaces and drivers, the reference generator, the version sync, the skill contracts and four tests — and a new
 * channel had to be added to each by hand, or was silently not checked. They all read `scripts/channels.mjs` now,
 * which derives the list from each channel's own manifest. This proves it the way it would fail: a channel package
 * nobody has told any of them about is dropped into a copy of the repository, and every consumer finds it.
 */

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const exec = promisify(execFile);

/** A channel as a new package would declare it — the manifest a Resend or WhatsApp package adds, and nothing else. */
function newcomerManifest(version) {
  return {
    name: '@agentcomms/newcomer',
    version,
    type: 'module',
    license: 'MIT',
    bin: { 'agent-newcomer': './dist/cli.mjs' },
    devDependencies: { '@agentcomms/core': 'workspace:*' },
    agentcomms: {
      contract: 1,
      channel: 'newcomer',
      label: 'Newcomer',
      binary: 'agent-newcomer',
      server: { defaultName: 'newcomer', npxPackage: '@agentcomms/newcomer', npxArgs: ['mcp'] },
      accounts: {
        map: 'accounts',
        noun: 'account',
        modes: ['read', 'send'],
        guarantee: { ceiling: 'grant', floor: 'code', why: 'The platform has no read-only credential.' },
      },
      narrowing: [{ option: 'account', flag: '--account', kind: 'pin' }],
      rivals: { word: 'newcomer', can: 'send through Newcomer' },
      hosts: ['api.newcomer.test'],
      approve: 'agent-newcomer approve',
      skills: { prefix: 'newcomer-', contract: 'skills/_shared/contract-newcomer.md' },
    },
  };
}

/** A copy of the repository's tooling, manifests and skills — no source, no dependencies — with a newcomer in it. */
async function treeWithNewcomer() {
  const root = await tempDir('channel-registry-');
  for (const path of [
    'package.json',
    'README.md',
    'scripts',
    'skills',
    '.claude-plugin',
    'gemini-extension.json',
    'bin',
  ]) {
    await cp(join(ROOT, path), join(root, path), { recursive: true });
  }
  for (const entry of await readdir(join(ROOT, 'packages'), { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    await mkdir(join(root, 'packages', entry.name), { recursive: true });
    await cp(join(ROOT, 'packages', entry.name, 'package.json'), join(root, 'packages', entry.name, 'package.json'));
  }
  const version = JSON.parse(await readFile(join(ROOT, 'package.json'), 'utf8')).version;
  await mkdir(join(root, 'packages', 'newcomer'), { recursive: true });
  await writeFile(
    join(root, 'packages', 'newcomer', 'package.json'),
    `${JSON.stringify(newcomerManifest(version), null, 2)}\n`,
  );
  await writeFile(
    join(root, 'skills', '_shared', 'contract-newcomer.md'),
    '# Newcomer contract\n\nName the account.\n',
  );
  await mkdir(join(root, 'skills', 'newcomer-reading', 'references'), { recursive: true });
  await writeFile(
    join(root, 'skills', 'newcomer-reading', 'SKILL.md'),
    `---\nname: newcomer-reading\ndescription: "Read a Newcomer account. Symptoms: what came in."\ncompatibility: "@agentcomms/newcomer@${version}"\n---\n`,
  );
  return { root, version };
}

const run = async (root, script, args = []) => {
  const { stdout } = await exec(process.execPath, [join(root, 'scripts', script), ...args], { cwd: root });
  return stdout;
};

test('a channel package dropped into the tree is discovered by every consumer of the registry', async () => {
  const { root, version } = await treeWithNewcomer();

  // Every channel this checkout ships, and the newcomer among them in its place.
  const shipped = REGISTRY.channels.map((channel) => channel.directory);
  const every = ['core', ...[...shipped.filter((channel) => channel !== 'core'), 'newcomer'].sort()];
  const others = shipped.filter((channel) => channel !== 'core');

  // The registry itself, and the two scripts a shell reads it through.
  assert.equal((await run(root, 'channels.mjs')).trim(), every.join(' '));
  const published = (await run(root, 'packages.mjs')).trim().split(' ');
  assert.ok(published.includes('newcomer'), 'published');
  assert.ok(published.indexOf('newcomer') > published.indexOf('core'), 'after the core it depends on');

  // The parity check's surfaces and drivers, read by the scripts in that tree.
  const registries = await import(pathToFileURL(join(root, 'scripts', 'registries.mjs')).href);
  assert.deepEqual(
    registries.SURFACES.map((surface) => surface.package),
    every,
  );
  assert.deepEqual(
    registries.SURFACES.find((surface) => surface.package === 'newcomer'),
    {
      package: 'newcomer',
      binary: 'agent-newcomer',
      entry: 'packages/newcomer/src/cli.ts',
      program: 'packages/newcomer/src/cli/program.ts',
      cli: 'commander',
    },
  );
  assert.deepEqual(registries.WRAPPERS, { 'gmail-mcp': 'gmail' }, 'a channel that is its own server wraps nothing');
  const operations = await import(pathToFileURL(join(root, 'scripts', 'operations.mjs')).href);
  assert.deepEqual(Object.keys(operations.DRIVERS), every);
  assert.deepEqual(operations.DRIVERS.newcomer, {
    cli: 'packages/newcomer/src/cli/program.ts',
    run: 'run',
    server: 'packages/newcomer/src/mcp/server.ts',
    factory: 'createNewcomerMcpServer',
  });

  // The views the tests and the generators read: tool drift, the reference pages, skill commands and contracts,
  // install commands, and account names.
  const registry = loadRegistry(root);
  assert.deepEqual(
    registry.products.find((product) => product.channel === 'newcomer'),
    {
      channel: 'newcomer',
      tool: 'newcomer',
      binary: 'agent-newcomer',
      server: 'packages/newcomer/src/mcp/server.ts',
      reference: 'docs/reference/newcomer-mcp-tools.md',
      program: 'packages/newcomer/src/cli/program.ts',
    },
  );
  assert.deepEqual(registry.reference.newcomer, {
    cli: 'docs/reference/newcomer-cli.md',
    mcp: 'docs/reference/newcomer-mcp-tools.md',
  });
  assert.ok(registry.platforms.includes('newcomer'), 'account names on the new platform');
  const family = (name) => registry.skillFamilies.find((each) => each.family === name);
  assert.equal(family('newcomer').contract, 'skills/_shared/contract-newcomer.md');
  assert.equal(family('newcomer').readme, 'packages/newcomer/README.md');
  const words = (name) => family(name).foreign.map(String).join(' ');
  // Its skills may not borrow another channel's words, and no other channel's skills may borrow its.
  assert.match(words('newcomer'), /gmail_/);
  assert.match(words('newcomer'), /agent-slack/);
  for (const other of others) {
    assert.match(words(other), /newcomer_\[a-z_\]\+/);
    assert.match(words(other), /agent-newcomer/);
    assert.match(words(other), /@agentcomms\\\/newcomer/);
    assert.match(words(other), /newcomer-reading/);
  }
  assert.deepEqual(family('comms').foreign, [], 'the core’s skills manage every channel');

  // Core's snapshot: the manifest is validated against core's schema and built in.
  const snapshot = await snapshotSource(root);
  assert.match(snapshot, /packageName: '@agentcomms\/newcomer'/);
  assert.match(snapshot, /channel: 'newcomer'/);

  // The version sync bumps its manifest, and a pin of it anywhere the sync rewrites pins.
  const extension = JSON.parse(await readFile(join(root, 'gemini-extension.json'), 'utf8'));
  extension.mcpServers.newcomer = { command: 'npx', args: ['-y', `@agentcomms/newcomer@${version}`, 'mcp'] };
  await writeFile(join(root, 'gemini-extension.json'), `${JSON.stringify(extension, null, 2)}\n`);
  const rootManifest = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));
  await writeFile(join(root, 'package.json'), `${JSON.stringify({ ...rootManifest, version: '9.9.9' }, null, 2)}\n`);
  await run(root, 'sync-versions.mjs');
  assert.equal(JSON.parse(await readFile(join(root, 'packages', 'newcomer', 'package.json'), 'utf8')).version, '9.9.9');
  assert.deepEqual(JSON.parse(await readFile(join(root, 'gemini-extension.json'), 'utf8')).mcpServers.newcomer.args, [
    '-y',
    '@agentcomms/newcomer@9.9.9',
    'mcp',
  ]);

  // The skills sync gives its skills the contract its manifest names.
  await run(root, 'sync-skills.mjs');
  assert.equal(
    await readFile(join(root, 'skills', 'newcomer-reading', 'references', 'contract.md'), 'utf8'),
    await readFile(join(root, 'skills', '_shared', 'contract-newcomer.md'), 'utf8'),
  );
});

test('a skill whose prefix no channel declares is refused, even with a contract file to match', async () => {
  const { root } = await treeWithNewcomer();
  // The old rule chose a contract by the name alone, so any `_shared/contract-<word>.md` made a family.
  await writeFile(join(root, 'skills', '_shared', 'contract-orphan.md'), '# Orphan\n');
  await mkdir(join(root, 'skills', 'orphan-skill', 'references'), { recursive: true });
  await writeFile(
    join(root, 'skills', 'orphan-skill', 'SKILL.md'),
    '---\nname: orphan-skill\ndescription: "An orphan. Symptoms: none."\n---\n',
  );
  await assert.rejects(run(root, 'sync-skills.mjs', ['--check']), (error) => {
    assert.match(String(error.stderr), /skills\/orphan-skill: no channel's skills start "orphan-"/);
    return true;
  });
});

test('a channel whose word is not its directory, or whose package is not its own, is refused by the registry', async () => {
  const { root, version } = await treeWithNewcomer();
  const path = join(root, 'packages', 'newcomer', 'package.json');
  const manifest = newcomerManifest(version);
  await writeFile(path, JSON.stringify({ ...manifest, agentcomms: { ...manifest.agentcomms, channel: 'other' } }));
  assert.throws(() => loadRegistry(root), /declares channel "other", but a channel's word is its directory's name/);
  await writeFile(path, JSON.stringify({ ...manifest, name: '@someone/newcomer' }));
  assert.throws(() => loadRegistry(root), /a channel's package is @agentcomms\/newcomer/);
  // And the schema in core refuses what the plain reader lets through: a mode outside the vocabulary.
  await writeFile(
    path,
    JSON.stringify({
      ...manifest,
      agentcomms: { ...manifest.agentcomms, accounts: { ...manifest.agentcomms.accounts, modes: ['read', 'post'] } },
    }),
  );
  await assert.rejects(snapshotSource(root), /@agentcomms\/newcomer: agentcomms\.accounts\.modes/);
});

/**
 * Everything that walks the channels reads the registry — directly, or through `packages.mjs` — rather than keeping a
 * list. Checked as text, as `release-packages.test.mjs` checks the release scripts: some of these cannot be run here
 * (the reference generator starts every server), and the property that failed eleven times is a literal list. Each
 * consumer names the view it must read, so one that imports the registry and then keeps its own list anyway fails.
 */
const CONSUMERS = {
  'scripts/packages.mjs': [/from '\.\/channels\.mjs'/, /REGISTRY\.packages/],
  'scripts/third-party-licenses.mjs': [/import \{ PACKAGES \} from '\.\/packages\.mjs'/],
  'scripts/sync-versions.mjs': [/from '\.\/packages\.mjs'/, /of PACKAGES\b/, /PINNED = new RegExp/],
  'scripts/registries.mjs': [/REGISTRY\.surfaces/, /REGISTRY\.wrappers/],
  'scripts/operations.mjs': [/REGISTRY\.drivers/, /REGISTRY\.platforms/],
  'scripts/sync-reference.mjs': [
    /const CLIS = REGISTRY\.surfaces/,
    /const SERVERS = REGISTRY\.channels/,
    /REGISTRY\.skillFamilies/,
  ],
  'scripts/sync-skills.mjs': [/skillFamilyOf\(REGISTRY, name\)/],
  'scripts/verify-skills.mjs': [/REGISTRY\.platforms/],
  'scripts/sync-channels.mjs': [/readChannels\(root\)/],
  'test/tool-drift.test.mjs': [/const PRODUCTS = REGISTRY\.products/],
  'test/skill-commands.test.mjs': [/const CLIS = REGISTRY\.surfaces/, /REGISTRY\.skillFamilies/],
  'test/install-docs.test.mjs': [/REGISTRY\.channels/, /PACKAGES\.map/],
  'test/skill-contracts.test.mjs': [
    /const FOREIGN = Object\.fromEntries\(REGISTRY\.skillFamilies/,
    /skillFamilyOf\(REGISTRY/,
  ],
  'test/manifests.test.mjs': [/from '\.\.\/scripts\/packages\.mjs'/, /'scripts\/channels\.mjs'/],
  'test/parity.test.mjs': [/SURFACES/, /WRAPPERS/, /PACKAGES/],
  'test/release-packages.test.mjs': [/'third-party-licenses\.mjs'/],
};

/** Files whose fixtures name channels on purpose — rows of a capabilities table — and are only held to what they read. */
const FIXTURE_FILES = new Set(['test/parity.test.mjs']);

/**
 * Channel words written out as a list, in the shapes the old copies took: an array of names, an alternation, an
 * object keyed by channel holding a list or a computed value, and a product entry naming one.
 */
const LITERAL_LIST = new RegExp(
  [
    String.raw`['"](?:core|gmail|slack)['"]\s*,\s*['"](?:core|gmail|gmail-mcp|slack)['"]`,
    String.raw`\b(?:gmail|slack|core)\|(?:gmail|slack|core)\b`,
    // Two keys at least: one channel's own extra rule (`{ slack: [/mailbox/] }`) is not a list of channels.
    String.raw`\b(?:gmail|slack|core):\s*(?:\[|await\b)[\s\S]{0,400}?\b(?:gmail|slack|core):\s*(?:\[|await\b)`,
    String.raw`\b(?:tool|package|channel):\s*['"](?:gmail|slack|core)['"]`,
    // A conditional choosing between channel words: `pkg === 'slack' ? 'slack' : 'gmail'`.
    String.raw`\?\s*['"](?:gmail|slack|core)['"]\s*:[^;\n]*?['"](?:gmail|slack|core)['"]`,
  ].join('|'),
);

test('every consumer reads the registry, and none keeps a list of channels of its own', async () => {
  const problems = [];
  for (const [file, reads] of Object.entries(CONSUMERS)) {
    const source = await readFile(join(ROOT, file), 'utf8');
    for (const pattern of reads) if (!pattern.test(source)) problems.push(`${file} does not read ${pattern}`);
    if (FIXTURE_FILES.has(file)) continue;
    const code = source.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/.*$/gm, '$1');
    const found = LITERAL_LIST.exec(code);
    if (found) problems.push(`${file} lists channels itself: ${found[0]}`);
  }
  assert.deepEqual(problems, []);
  // The pattern finds every list this replaced, and leaves one channel's own rule alone.
  assert.doesNotMatch('const ALSO_FOREIGN = { slack: [/\\bmailbox(es)?\\b/i] };', LITERAL_LIST);
  for (const old of [
    "const PACKAGES = ['core', 'gmail', 'gmail-mcp', 'slack'];",
    '/(agent-gmail|agent-slack|agentcomms|@agentcomms\\/(?:gmail|slack|core)(?:@\\S+)?) mcp install/g',
    '`agent-communications/(${ALIAS})/(?!(?:gmail|slack)(?:-[a-z0-9-]+)?/)`',
    'const FOREIGN = { gmail: [/\\bslack_[a-z_]+/], slack: [/\\bgmail_[a-z_]+/] };',
    "const known = { gmail: await installFlags('gmail'), slack: await installFlags('slack') };",
    "const PRODUCTS = [{ tool: 'gmail', binary: 'agent-gmail' }];",
    "export const SURFACES = Object.freeze([{ package: 'core', binary: 'agentcomms' }]);",
    "cli: binary.includes('slack') ? 'slack' : binary.includes('gmail') ? 'gmail' : 'core',",
    "return `parity/${pkg === 'slack' ? 'slack' : 'gmail'}`;",
  ]) {
    assert.match(old, LITERAL_LIST, old);
  }
});

test('this checkout’s registry is the five channels and six packages it ships', () => {
  assert.deepEqual(
    REGISTRY.channels.map((channel) => channel.directory),
    ['core', 'gmail', 'resend', 'slack', 'whatsapp'],
  );
  assert.deepEqual(REGISTRY.packages, ['core', 'gmail', 'gmail-mcp', 'resend', 'slack', 'whatsapp']);
  assert.deepEqual(REGISTRY.platforms, ['gmail', 'resend', 'slack', 'whatsapp']);
});
