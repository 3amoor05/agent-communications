import assert from 'node:assert/strict';
import {
  chmodSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  realpathSync,
  symlinkSync,
  unlinkSync,
  utimesSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  type CliCommandRequest,
  type CliCommandResult,
  locateCliCommand,
  type NodeRuntime,
  type PrintedCommand,
} from '../src/cli-command.ts';
import { commandAsJson, commandText, inlineCommand, shellCommand } from '../src/cli-runtime.ts';
import { type ExternalCommand, externalCommand } from '../src/command-brands.ts';
import { findUngatedGmailServers, otherSlackServerRemoval } from '../src/other-servers.ts';
import type { PathName, ResolvedPaths } from '../src/paths.ts';
import { satisfiesRange } from '../src/versions.ts';
import {
  link,
  moduleUrl,
  realTemp,
  suiteEntry,
  VERSION,
  writeCheckout,
  writeFile,
  writePackage,
} from './fixtures/cli-command/trees.ts';

/*
 * The CLI locator (design 2026-10-04, D1 and D5): a command for a person to run names this Node and a checked file of
 * the product it runs, never a bare suite binary, and pins the suite directories that command uses. Own-product and
 * channel→core here; another product's command is CUE-403 task 7.
 */

const PATHS: ResolvedPaths = {
  configDir: resolve('/pins/config'),
  stateDir: resolve('/pins/state'),
  dataDir: resolve('/pins/data'),
  secretsDir: resolve('/pins/secrets'),
  downloadsDir: resolve('/pins/downloads'),
};
const FOUR: readonly PathName[] = ['configDir', 'stateDir', 'dataDir', 'secretsDir'];
const PINS = [
  '--config-dir',
  PATHS.configDir,
  '--state-dir',
  PATHS.stateDir,
  '--data-dir',
  PATHS.dataDir,
  '--secrets-dir',
  PATHS.secretsDir,
];
/** A Node new enough for every package, run with no flags: what most tests locate under. */
const NODE: NodeRuntime = { version: 'v22.18.0', execArgv: [] };
const STRIP = '--experimental-strip-types';
const TRANSFORM = '--experimental-transform-types';

function request(
  callerUrl: string,
  callerChannel: string,
  targetChannel: string,
  overrides: Partial<CliCommandRequest> = {},
): CliCommandRequest {
  return {
    caller: { url: callerUrl, packageName: suiteEntry(callerChannel).packageName },
    target: suiteEntry(targetChannel),
    words: ['approve', 'abc123'],
    uses: FOUR,
    paths: PATHS,
    platform: 'linux',
    ...overrides,
  };
}

function located(result: CliCommandResult): PrintedCommand {
  assert.equal(result.ok, true, result.ok ? '' : `not located: ${result.reason}: ${result.message}`);
  if (!result.ok) throw new Error('unreachable');
  return result.command;
}

/**
 * No command at all — nothing to paste, no words, no bare binary in its place — and a sentence naming the product,
 * its package and the exact version it needs.
 */
function notLocated(result: CliCommandResult, reason: string, channel: string, version = VERSION) {
  assert.equal(result.ok, false, 'no command');
  if (result.ok) throw new Error('unreachable');
  assert.equal(result.reason, reason, result.message);
  assert.ok(!('command' in result), 'the failure carries no command');
  const { packageName, manifest } = suiteEntry(channel);
  assert.equal(result.package, packageName);
  assert.equal(result.product, manifest.label);
  assert.equal(result.version, version);
  assert.ok(result.message.includes(`${manifest.label} ${version} (${packageName})`), result.message);
  for (const { manifest: each } of [suiteEntry('core'), suiteEntry('gmail'), suiteEntry('slack')]) {
    assert.doesNotMatch(result.message, new RegExp(`(?:^|[\\s\`'"])${each.binary}\\s+[a-z-]`), 'no bare command');
  }
  return result;
}

// ── 1a: the product's own CLI, wherever it is installed ─────────────────────────────────────────────────────────────

test('own locator: a managed runtime, an npx cache, a global prefix and a built checkout each run their own bin (1a)', () => {
  const temp = realTemp();
  const shapes = [
    [
      'managed runtime',
      'gmail',
      join(temp, 'data', 'runtime', `${VERSION}-gmail`, 'node_modules', '@agentcomms', 'gmail'),
    ],
    ['npx cache', 'slack', join(temp, 'npm', '_npx', '0a1b2c3d', 'node_modules', '@agentcomms', 'slack')],
    ['global prefix', 'resend', join(temp, 'prefix', 'lib', 'node_modules', '@agentcomms', 'resend')],
    ['built checkout', 'whatsapp', join(temp, 'checkout', 'packages', 'whatsapp')],
    ['managed core', 'core', join(temp, 'data', 'runtime', `${VERSION}-core`, 'node_modules', '@agentcomms', 'core')],
  ] as const;
  for (const [shape, channel, root] of shapes) {
    writePackage(root, channel, {
      files: ['dist/cli.mjs'],
      engines: channel === 'whatsapp' ? '>=22.16.0' : '>=22.12.0',
    });
    const entry = join(root, 'dist', 'cli.mjs');
    for (const platform of ['darwin', 'win32'] as const) {
      const result = locateCliCommand(
        request(moduleUrl(root, 'dist', 'cli.mjs'), channel, channel, { platform }),
        NODE,
      );
      const command = located(result);
      const words = [process.execPath, entry, ...PINS, 'approve', 'abc123'];
      assert.deepEqual(command.words, words, `${shape} on ${platform}`);
      assert.equal(command.platform, platform);
      // Rendered by the one quoting contract every printed command uses.
      assert.equal(command.line, shellCommand(words, platform).line, `${shape} on ${platform}`);
      assert.equal(command.entry, entry);
      assert.ok(result.ok && result.basis.direction === 'own' && result.basis.entryKind === 'bin', shape);
      assert.ok(result.ok && result.basis.callerRoot === root && result.basis.targetRoot === root, shape);
    }
  }
});

test("own locator: a checkout run from source — the local launcher's shape — runs src/cli.ts with the strip flag (1a)", () => {
  const { packages } = writeCheckout(join(realTemp(), 'checkout'), ['gmail']);
  const root = packages.gmail as string;
  for (const platform of ['linux', 'win32'] as const) {
    const result = locateCliCommand(
      request(moduleUrl(root, 'src', 'mcp', 'install.ts'), 'gmail', 'gmail', { platform }),
      NODE,
    );
    const command = located(result);
    const words = [process.execPath, STRIP, join(root, 'src', 'cli.ts'), ...PINS, 'approve', 'abc123'];
    assert.deepEqual(command.words, words);
    assert.equal(command.line, shellCommand(words, platform).line);
    assert.ok(result.ok && result.basis.callerSource && result.basis.entryKind === 'source');
  }
});

test('a located command cannot be made again from its constructor', () => {
  const root = writePackage(join(realTemp(), 'gmail'), 'gmail', { files: ['dist/cli.mjs'] });
  const command = located(locateCliCommand(request(moduleUrl(root, 'dist', 'cli.mjs'), 'gmail', 'gmail'), NODE));
  const Made = command.constructor as new (...args: unknown[]) => unknown;
  assert.throws(() => new Made(Symbol('forged'), ['agent-gmail', 'approve'], 'linux', '/x'), TypeError);
  assert.ok(Object.isFrozen(command) && Object.isFrozen(command.words));
});

// ── 1b: only the two allowed Node flags; source never looks at dist ─────────────────────────────────────────────────

test('only the strip flag, and transform-types from a source run that used it, are carried; nothing else in execArgv (1b)', () => {
  const { packages } = writeCheckout(join(realTemp(), 'checkout'), ['slack']);
  const root = packages.slack as string;
  const noisy = [
    '--inspect=9229',
    '--require',
    '/tmp/preload.cjs',
    '--import=./loader.mjs',
    '--conditions=development',
    '--no-warnings',
    '--disable-warning=ExperimentalWarning',
    '--enable-source-maps',
    '--max-old-space-size=4096',
    '--title=agent',
    '--test',
    '--eval=1',
    STRIP,
  ];
  const source = moduleUrl(root, 'src', 'mcp', 'install.ts');
  const entry = join(root, 'src', 'cli.ts');
  const flagsOf = (command: PrintedCommand) => command.words.slice(1, command.words.indexOf(command.entry));
  assert.deepEqual(
    flagsOf(located(locateCliCommand(request(source, 'slack', 'slack'), { version: 'v22.18.0', execArgv: noisy }))),
    [STRIP],
  );
  assert.deepEqual(
    flagsOf(
      located(
        locateCliCommand(request(source, 'slack', 'slack'), { version: 'v22.18.0', execArgv: [...noisy, TRANSFORM] }),
      ),
    ),
    [STRIP, TRANSFORM],
  );
  // With no flags at all, a TypeScript entry still gets the strip flag: Node 22.12–22.17 needs it.
  assert.deepEqual(
    flagsOf(located(locateCliCommand(request(source, 'slack', 'slack'), { version: 'v22.12.0', execArgv: [] }))),
    [STRIP],
  );
  assert.equal(located(locateCliCommand(request(source, 'slack', 'slack'), NODE)).entry, entry);
  // A built entry gets none, whatever the running process was started with.
  const built = moduleUrl(root, 'dist', 'cli.mjs');
  const command = located(
    locateCliCommand(request(built, 'slack', 'slack'), { version: 'v22.18.0', execArgv: [...noisy, TRANSFORM] }),
  );
  assert.deepEqual(command.words, [process.execPath, join(root, 'dist', 'cli.mjs'), ...PINS, 'approve', 'abc123']);
});

test('a source caller runs src/cli.ts whether dist is absent, stale or not a file at all (1b)', () => {
  const temp = realTemp();
  const variants: [string, (root: string) => void][] = [
    ['no dist', () => {}],
    [
      'a stale dist',
      (root) => {
        const stale = writeFile(join(root, 'dist', 'cli.mjs'), 'throw new Error("stale");\n');
        utimesSync(stale, new Date(2020, 0, 1), new Date(2020, 0, 1));
      },
    ],
    ['dist/cli.mjs a directory', (root) => mkdirSync(join(root, 'dist', 'cli.mjs'), { recursive: true })],
  ];
  for (const [name, arrange] of variants) {
    const root = writePackage(join(temp, name.replace(/\W+/g, '-')), 'gmail', {
      files: ['src/cli.ts', 'src/mcp/install.ts'],
    });
    arrange(root);
    const command = located(
      locateCliCommand(request(moduleUrl(root, 'src', 'mcp', 'install.ts'), 'gmail', 'gmail'), NODE),
    );
    assert.equal(command.entry, join(root, 'src', 'cli.ts'), name);
    assert.deepEqual(command.words.slice(0, 3), [process.execPath, STRIP, join(root, 'src', 'cli.ts')], name);
  }
});

// ── 1c: the Gmail wrapper locates Gmail ─────────────────────────────────────────────────────────────────────────────

test("the Gmail wrapper locates Gmail from Gmail's own module, and never itself (1c)", () => {
  const modules = join(realTemp(), 'npx', 'node_modules', '@agentcomms');
  const gmail = writePackage(join(modules, 'gmail'), 'gmail', { files: ['dist/index.mjs', 'dist/cli.mjs'] });
  const wrapper = writePackage(join(modules, 'gmail-mcp'), 'gmail', {
    name: '@agentcomms/gmail-mcp',
    binary: null,
    bin: { 'agent-gmail-mcp': './dist/server.mjs' },
    files: ['dist/server.mjs'],
  });
  // What `@agentcomms/gmail` exports for it: a module of Gmail's own package, built.
  const command = located(locateCliCommand(request(moduleUrl(gmail, 'dist', 'index.mjs'), 'gmail', 'gmail'), NODE));
  assert.equal(command.entry, join(gmail, 'dist', 'cli.mjs'));
  // The wrapper's own module is not Gmail, whatever it says it is…
  notLocated(
    locateCliCommand(request(moduleUrl(wrapper, 'dist', 'server.mjs'), 'gmail', 'gmail'), NODE),
    'manifest',
    'gmail',
  );
  // …and as itself it is not Gmail's own CLI, so it is no own-product command either.
  const server = moduleUrl(wrapper, 'dist', 'server.mjs');
  const asItself = request(server, 'gmail', 'gmail', { caller: { url: server, packageName: '@agentcomms/gmail-mcp' } });
  notLocated(locateCliCommand(asItself, NODE), 'direction', 'gmail');
});

// ── 1d: a manifest or entry that is not right gives no command, and nothing in its place ───────────────────────────

test("no command, and no bare fallback, when the manifest's bin is missing or disagrees with agentcomms.binary (1d)", () => {
  const temp = realTemp();
  const cases: [string, Parameters<typeof writePackage>[2]][] = [
    ['no bin', { bin: null }],
    ['no agentcomms.binary', { binary: null }],
    ['agentcomms.binary names another command', { binary: 'agent-gmail2', bin: { 'agent-gmail2': './dist/cli.mjs' } }],
    ['bin names another command', { bin: { 'agent-gmail-old': './dist/cli.mjs' } }],
    ['bin is empty', { bin: { 'agent-gmail': '' } }],
  ];
  for (const [name, spec] of cases) {
    const root = writePackage(join(temp, name.replace(/\W+/g, '-')), 'gmail', { ...spec, files: ['dist/cli.mjs'] });
    notLocated(locateCliCommand(request(moduleUrl(root, 'dist', 'cli.mjs'), 'gmail', 'gmail'), NODE), 'bin', 'gmail');
  }
});

test('no command when the entry is missing, unreadable, a directory, or outside its package (1d)', () => {
  const temp = realTemp();
  const outside = writeFile(join(temp, 'elsewhere', 'cli.mjs'));
  const cases: [string, Parameters<typeof writePackage>[2], (root: string) => void][] = [
    ['missing', { files: [] }, () => {}],
    ['a directory', { files: [] }, (root) => mkdirSync(join(root, 'dist', 'cli.mjs'), { recursive: true })],
    ['a symlink out of the package', { files: [] }, (root) => link(outside, join(root, 'dist', 'cli.mjs'))],
    ['a bin path out of the package', { bin: { 'agent-gmail': '../elsewhere/cli.mjs' }, files: [] }, () => {}],
  ];
  if (process.platform !== 'win32' && process.getuid?.() !== 0) {
    cases.push(['unreadable', { files: [] }, (root) => chmodSync(writeFile(join(root, 'dist', 'cli.mjs')), 0o000)]);
  }
  for (const [name, spec, arrange] of cases) {
    const root = writePackage(join(temp, name.replace(/\W+/g, '-')), 'gmail', spec);
    arrange(root);
    notLocated(locateCliCommand(request(moduleUrl(root, 'dist', 'cli.mjs'), 'gmail', 'gmail'), NODE), 'entry', 'gmail');
  }
  // A source caller whose src/cli.ts is gone does not fall back to a built entry.
  const source = writePackage(join(temp, 'no-source'), 'gmail', { files: ['src/mcp/install.ts', 'dist/cli.mjs'] });
  notLocated(
    locateCliCommand(request(moduleUrl(source, 'src', 'mcp', 'install.ts'), 'gmail', 'gmail'), NODE),
    'entry',
    'gmail',
  );
});

test('no command when the nearest manifest is not the product the caller says it is (1d)', () => {
  const temp = realTemp();
  const evil = writePackage(join(temp, 'evil'), 'gmail', { name: '@agentcomms/gmail-evil', files: ['dist/cli.mjs'] });
  notLocated(
    locateCliCommand(request(moduleUrl(evil, 'dist', 'cli.mjs'), 'gmail', 'gmail'), NODE),
    'manifest',
    'gmail',
  );
  // A package of its own nested inside the product's is still the nearest manifest, and it is not the product.
  const outer = writePackage(join(temp, 'outer'), 'slack', { files: ['dist/cli.mjs'] });
  writeFileSync(join(outer, 'dist', 'package.json'), '{"type":"module"}\n');
  notLocated(
    locateCliCommand(request(moduleUrl(outer, 'dist', 'cli.mjs'), 'slack', 'slack'), NODE),
    'manifest',
    'slack',
  );
  const broken = join(temp, 'broken');
  writeFile(join(broken, 'dist', 'cli.mjs'));
  writeFileSync(join(broken, 'package.json'), '{ not json');
  notLocated(
    locateCliCommand(request(moduleUrl(broken, 'dist', 'cli.mjs'), 'gmail', 'gmail'), NODE),
    'manifest',
    'gmail',
  );
  notLocated(locateCliCommand(request('https://example.invalid/cli.mjs', 'gmail', 'gmail'), NODE), 'caller', 'gmail');
});

// ── Node's engine range: the target's, against this Node ────────────────────────────────────────────────────────────

test("a Node outside the target's engines.node range gets no command, and the reason names the range", () => {
  const temp = realTemp();
  const whatsapp = writePackage(join(temp, 'whatsapp'), 'whatsapp', { engines: '>=22.16.0', files: ['dist/cli.mjs'] });
  const url = moduleUrl(whatsapp, 'dist', 'cli.mjs');
  const old = notLocated(
    locateCliCommand(request(url, 'whatsapp', 'whatsapp'), { version: 'v22.15.1', execArgv: [] }),
    'engine',
    'whatsapp',
  );
  assert.equal(old.nodeRange, '>=22.16.0');
  assert.match(old.message, />=22\.16\.0/);
  assert.match(old.message, /22\.15\.1/);
  located(locateCliCommand(request(url, 'whatsapp', 'whatsapp'), { version: 'v22.16.0', execArgv: [] }));
  // A range this cannot read, or none at all, is not taken as permission.
  for (const [name, engines] of [
    ['caret', '^22.12.0'],
    ['none', null],
  ] as const) {
    const root = writePackage(join(temp, name), 'gmail', { engines, files: ['dist/cli.mjs'] });
    notLocated(
      locateCliCommand(request(moduleUrl(root, 'dist', 'cli.mjs'), 'gmail', 'gmail'), NODE),
      'engine',
      'gmail',
    );
  }
  // Channel to core checks core's range, not the channel's.
  const { packages } = writeCheckout(join(temp, 'checkout'), ['gmail']);
  const core = notLocated(
    locateCliCommand(request(moduleUrl(packages.gmail as string, 'dist', 'cli.mjs'), 'gmail', 'core'), {
      version: 'v22.11.0',
      execArgv: [],
    }),
    'engine',
    'core',
  );
  assert.equal(core.nodeRange, '>=22.12.0');
});

test('engine ranges are read as semver comparators, and anything else is unknown', () => {
  assert.equal(satisfiesRange('22.18.0', '>=22.12.0'), true);
  assert.equal(satisfiesRange('v22.12.0', '>=22.12.0'), true);
  assert.equal(satisfiesRange('22.11.9', '>=22.12.0'), false);
  assert.equal(satisfiesRange('24.1.0', '>=22.12.0 <24.0.0'), false);
  assert.equal(satisfiesRange('20.19.0', '^20.19.0 || >=22.12.0'), null);
  assert.equal(satisfiesRange('20.19.0', '>=20.19.0 <21.0.0 || >=22.12.0'), true);
  assert.equal(satisfiesRange('22.12.0', '=22.12.0'), true);
  assert.equal(satisfiesRange('22.12.0', '22.12.0'), true);
  assert.equal(satisfiesRange('22.12.0', '>22.12.0'), false);
  assert.equal(satisfiesRange('22.12.0', '<=22.12.0'), true);
  assert.equal(satisfiesRange('22.12.0', ''), null);
  assert.equal(satisfiesRange('22.12.0', '>=22'), null);
  assert.equal(satisfiesRange('not a version', '>=22.12.0'), null);
});

// ── 2a: channel to core ─────────────────────────────────────────────────────────────────────────────────────────────

test("a source channel in the same checkout runs core's src/cli.ts, with core's dist absent or stale (2a)", () => {
  for (const coreFiles of [['src/cli.ts'], ['src/cli.ts', 'dist/cli.mjs']]) {
    const checkout = writeCheckout(join(realTemp(), 'checkout'), ['gmail'], { coreFiles });
    const gmail = checkout.packages.gmail as string;
    const result = locateCliCommand(request(moduleUrl(gmail, 'src', 'mcp', 'install.ts'), 'gmail', 'core'), NODE);
    const command = located(result);
    assert.deepEqual(command.words, [
      process.execPath,
      STRIP,
      join(checkout.core, 'src', 'cli.ts'),
      ...PINS,
      'approve',
      'abc123',
    ]);
    assert.ok(result.ok);
    assert.deepEqual(result.basis, {
      direction: 'channel-to-core',
      callerSource: true,
      callerRoot: gmail,
      callerVersion: VERSION,
      targetRoot: checkout.core,
      targetVersion: VERSION,
      callerWorkspace: checkout.root,
      targetWorkspace: checkout.root,
      sameCheckout: true,
      entryKind: 'source',
    });
  }
});

test("a built channel runs core's manifest bin, even beside core's source in the same checkout (2a)", () => {
  const checkout = writeCheckout(join(realTemp(), 'checkout'), ['slack']);
  const slack = checkout.packages.slack as string;
  const result = locateCliCommand(request(moduleUrl(slack, 'dist', 'cli.mjs'), 'slack', 'core'), NODE);
  assert.deepEqual(located(result).words, [
    process.execPath,
    join(checkout.core, 'dist', 'cli.mjs'),
    ...PINS,
    'approve',
    'abc123',
  ]);
  assert.ok(result.ok);
  assert.equal(result.basis.callerSource, false);
  assert.equal(result.basis.sameCheckout, true);
  assert.equal(result.basis.entryKind, 'bin');
  // And with no build of core, there is nothing to run: core's source is not a fallback for a built caller.
  const unbuilt = writeCheckout(join(realTemp(), 'checkout'), ['slack'], { coreFiles: ['src/cli.ts'] });
  notLocated(
    locateCliCommand(request(moduleUrl(unbuilt.packages.slack as string, 'dist', 'cli.mjs'), 'slack', 'core'), NODE),
    'entry',
    'core',
  );
});

test("a source channel with an installed core, not a workspace package, runs that core's bin (2a)", () => {
  const checkout = writeCheckout(join(realTemp(), 'checkout'), ['resend']);
  const resend = checkout.packages.resend as string;
  // The link pnpm made, replaced by an installed copy: inside the checkout, but no workspace package of it.
  const installed = join(resend, 'node_modules', '@agentcomms', 'core');
  const linked = realpathSync(installed);
  assert.equal(linked, checkout.core);
  rmLink(installed);
  writePackage(installed, 'core', { files: ['dist/cli.mjs', 'src/cli.ts'] });
  const result = locateCliCommand(request(moduleUrl(resend, 'src', 'mcp', 'install.ts'), 'resend', 'core'), NODE);
  assert.equal(located(result).entry, join(installed, 'dist', 'cli.mjs'));
  assert.ok(result.ok);
  assert.equal(result.basis.callerSource, true);
  assert.equal(result.basis.callerWorkspace, checkout.root);
  assert.equal(result.basis.targetWorkspace, null);
  assert.equal(result.basis.sameCheckout, false);
  assert.equal(result.basis.entryKind, 'bin');
});

test("a source channel whose core is in another checkout runs that core's bin (2a)", () => {
  const temp = realTemp();
  const here = writeCheckout(join(temp, 'here'), ['gmail']);
  const there = writeCheckout(join(temp, 'there'), []);
  const gmail = here.packages.gmail as string;
  rmLink(join(gmail, 'node_modules', '@agentcomms', 'core'));
  symlinkSync(there.core, join(gmail, 'node_modules', '@agentcomms', 'core'));
  const result = locateCliCommand(request(moduleUrl(gmail, 'src', 'mcp', 'install.ts'), 'gmail', 'core'), NODE);
  assert.equal(located(result).entry, join(there.core, 'dist', 'cli.mjs'));
  assert.ok(result.ok);
  assert.equal(result.basis.targetRoot, there.core);
  assert.equal(result.basis.callerWorkspace, here.root);
  assert.equal(result.basis.targetWorkspace, there.root);
  assert.equal(result.basis.sameCheckout, false);
});

test('a workspace that does not list core as one of its packages is not the same checkout (2a)', () => {
  const checkout = writeCheckout(join(realTemp(), 'checkout'), ['gmail']);
  writeFileSync(join(checkout.root, 'pnpm-workspace.yaml'), 'packages:\n  - packages/gmail\n  - "!packages/core"\n');
  const result = locateCliCommand(
    request(moduleUrl(checkout.packages.gmail as string, 'src', 'mcp', 'install.ts'), 'gmail', 'core'),
    NODE,
  );
  assert.equal(located(result).entry, join(checkout.core, 'dist', 'cli.mjs'));
  assert.ok(result.ok);
  assert.equal(result.basis.callerWorkspace, checkout.root);
  assert.equal(result.basis.targetWorkspace, null);
  assert.equal(result.basis.sameCheckout, false);
});

test('channel and core at different versions, no core at all, or a core that is not core give no command (2a)', () => {
  const temp = realTemp();
  const older = writeCheckout(join(temp, 'older'), ['gmail'], { coreVersion: '0.12.0' });
  const mismatch = notLocated(
    locateCliCommand(
      request(moduleUrl(older.packages.gmail as string, 'src', 'mcp', 'install.ts'), 'gmail', 'core'),
      NODE,
    ),
    'version',
    'core',
  );
  assert.match(mismatch.message, /0\.12\.0/);
  const alone = writePackage(join(temp, 'alone'), 'gmail', { files: ['src/mcp/install.ts', 'dist/cli.mjs'] });
  notLocated(locateCliCommand(request(moduleUrl(alone, 'dist', 'cli.mjs'), 'gmail', 'core'), NODE), 'core', 'core');
  const impostor = writePackage(join(temp, 'impostor'), 'slack', { files: ['dist/cli.mjs'] });
  writePackage(join(impostor, 'node_modules', '@agentcomms', 'core'), 'core', { name: '@agentcomms/core-evil' });
  notLocated(
    locateCliCommand(request(moduleUrl(impostor, 'dist', 'cli.mjs'), 'slack', 'core'), NODE),
    'manifest',
    'core',
  );
});

test('another product is not located in this direction yet, and gets no command', () => {
  const { packages } = writeCheckout(join(realTemp(), 'checkout'), ['gmail', 'slack']);
  notLocated(
    locateCliCommand(request(moduleUrl(packages.gmail as string, 'dist', 'cli.mjs'), 'gmail', 'slack'), NODE),
    'direction',
    'slack',
  );
  // Core asking for a channel's command is the same direction: another product, located from registrations.
  const core = writePackage(join(realTemp(), 'core'), 'core', { files: ['dist/cli.mjs'] });
  notLocated(
    locateCliCommand(request(moduleUrl(core, 'dist', 'cli.mjs'), 'core', 'whatsapp'), NODE),
    'direction',
    'whatsapp',
  );
});

// ── The words: the caller's, after the entry, with the directories the command uses ────────────────────────────────

test('only the directories the command uses are pinned, between the entry and its words and before any --', () => {
  const root = writePackage(join(realTemp(), 'gmail'), 'gmail', { files: ['dist/cli.mjs'] });
  const url = moduleUrl(root, 'dist', 'cli.mjs');
  const entry = join(root, 'dist', 'cli.mjs');
  const one = located(
    locateCliCommand(
      request(url, 'gmail', 'gmail', { uses: ['secretsDir'], words: ['inbox', 'reauth', 'work'] }),
      NODE,
    ),
  );
  assert.deepEqual(one.words, [process.execPath, entry, '--secrets-dir', PATHS.secretsDir, 'inbox', 'reauth', 'work']);
  const download = located(
    locateCliCommand(
      request(url, 'gmail', 'gmail', { uses: ['downloadsDir', 'configDir'], words: ['attachment', 'download', 'id'] }),
      NODE,
    ),
  );
  assert.deepEqual(download.words, [
    process.execPath,
    entry,
    '--config-dir',
    PATHS.configDir,
    '--downloads-dir',
    PATHS.downloadsDir,
    'attachment',
    'download',
    'id',
  ]);
  const none = located(locateCliCommand(request(url, 'gmail', 'gmail', { uses: [], words: ['--help'] }), NODE));
  assert.deepEqual(none.words, [process.execPath, entry, '--help']);
  // Path options in the caller's words are replaced by the canonical pins; after `--` every word is data, kept exactly.
  const replaced = located(
    locateCliCommand(
      request(url, 'gmail', 'gmail', {
        uses: ['configDir'],
        words: ['client', 'add', '--config-dir', 'relative', '--state-dir=x', '--', '--config-dir=kept', '--state-dir'],
      }),
      NODE,
    ),
  );
  assert.deepEqual(replaced.words, [
    process.execPath,
    entry,
    '--config-dir',
    PATHS.configDir,
    'client',
    'add',
    '--',
    '--config-dir=kept',
    '--state-dir',
  ]);
  // A path option with no value before `--` is no command at all.
  notLocated(
    locateCliCommand(request(url, 'gmail', 'gmail', { words: ['approve', '--state-dir', '--', 'x'] }), NODE),
    'arguments',
    'gmail',
  );
});

test('the caller never supplies word zero: a suite command as the first word is a programming error', () => {
  const root = writePackage(join(realTemp(), 'gmail'), 'gmail', { files: ['dist/cli.mjs'] });
  for (const first of ['agent-gmail', 'AgentComms', 'agent-slack.cmd', process.execPath]) {
    assert.throws(
      () =>
        locateCliCommand(
          request(moduleUrl(root, 'dist', 'cli.mjs'), 'gmail', 'gmail', { words: [first, 'approve'] }),
          NODE,
        ),
      TypeError,
      first,
    );
  }
});

test('a located and an external command render through the same contract as every printed command', () => {
  const root = writePackage(join(realTemp(), 'gmail'), 'gmail', { files: ['dist/cli.mjs'] });
  const printed = located(
    locateCliCommand(request(moduleUrl(root, 'dist', 'cli.mjs'), 'gmail', 'gmail', { platform: 'darwin' }), NODE),
  );
  assert.equal(inlineCommand(printed), `\`${shellCommand(printed.words, 'darwin').line}\``);
  assert.equal(commandText(printed), shellCommand(printed.words, 'darwin').line);
  const windows: ExternalCommand = externalCommand(['claude', 'mcp', 'remove', '$x&whoami&'], 'removal', 'win32');
  assert.equal(windows.line, null);
  assert.equal(commandText(windows), commandText(shellCommand(windows.words, 'win32')));
  assert.equal(inlineCommand(windows), inlineCommand(shellCommand(windows.words, 'win32')));
  assert.match(
    commandText(windows),
    new RegExp(`^${escapeRegExp(commandAsJson(windows.words))} \\(the command's words`),
  );
});

// ── 7b and 7e: external commands ────────────────────────────────────────────────────────────────────────────────────

const CORE_ROOT = realpathSync(fileURLToPath(new URL('../', import.meta.url)));
const GMAIL_ROOT = realpathSync(fileURLToPath(new URL('../../gmail/', import.meta.url)));

test('externalCommand refuses any word naming a command of this suite, in any case, alone or in a payload (7b)', () => {
  const refused: string[][] = [
    ['agent-gmail', 'approve', 'abc'],
    ['agentcomms'],
    ['AGENTCOMMS', 'approve'],
    ['Agent-Slack.CMD', 'post', 'send'],
    ['D:\\Profiles\\me\\AppData\\Roaming\\npm\\agent-whatsapp.ps1', '--help'],
    ['/usr/local/bin/agent-resend', 'send'],
    ['./node_modules/.bin/agent-gmail', 'approve'],
    ['agent-gmail-mcp'],
    ['npx', '-y', 'agent-slack', 'mcp'],
    ['env', 'FOO=1', 'agentcomms', 'approve'],
    ['sh', '-c', 'agent-slack post send x'],
    ['sh', '-c', 'cd /tmp && agentcomms approve x'],
    ['cmd', '/c', 'agentcomms.cmd approve x'],
    ['powershell', '-Command', '& "C:\\npm\\Agent-Gmail.ps1" approve x'],
    ['xargs', '--arg=agent-resend'],
    ['claude', 'mcp', 'add', 'gmail', '--', 'agent-gmail', 'mcp'],
  ];
  for (const words of refused) {
    assert.throws(
      () => externalCommand(words, 'a test', 'linux'),
      { name: 'TypeError', message: /names a command of this suite/ },
      JSON.stringify(words),
    );
  }
  // A word that only contains a command's letters inside a longer one is not that command.
  externalCommand(['chmod', '700', '/profiles/me/.config/agent-communications'], 'a test', 'linux');
  externalCommand(['claude', 'mcp', 'remove', 'agent-gmail-old'], 'a test', 'linux');
});

test('externalCommand refuses any package of this suite named as a specifier (7b)', () => {
  for (const words of [
    ['npx', '-y', '@agentcomms/gmail@0.13.0', 'approve'],
    ['npx', '@AgentComms/core'],
    ['pnpm', 'dlx', '@agentcomms/slack'],
    ['node', 'C:\\x\\node_modules\\@agentcomms\\gmail\\dist\\cli.mjs'],
    ['node', '/opt/lib/node_modules/@agentcomms/resend/dist/cli.mjs'],
    ['sh', '-c', 'npx -y @agentcomms/whatsapp mcp'],
  ]) {
    // Its own refusal, and not only the command-name one that `agentcomms` inside the scope would also make.
    assert.throws(
      () => externalCommand(words, 'a test', 'linux'),
      { name: 'TypeError', message: /names a package of this suite/ },
      JSON.stringify(words),
    );
  }
});

test('externalCommand refuses a path inside a suite package root, directly or through a symlink (7b)', () => {
  const temp = realTemp();
  const linkedFile = link(join(GMAIL_ROOT, 'src', 'cli.ts'), join(temp, 'entry.ts'));
  const linkedDir = link(GMAIL_ROOT, join(temp, 'checkout-link'));
  const installed = writePackage(join(temp, 'somewhere', 'gmail'), 'gmail', { files: ['dist/cli.mjs'] });
  for (const words of [
    ['node', join(GMAIL_ROOT, 'dist', 'cli.mjs'), 'approve'],
    ['node', join(CORE_ROOT, 'src', 'cli.ts')],
    ['node', join(GMAIL_ROOT, 'not', 'there', 'yet.mjs')],
    ['node', linkedFile],
    ['node', join(linkedDir, 'src', 'cli.ts')],
    ['node', join(installed, 'dist', 'cli.mjs')],
    ['node', `--import=${join(CORE_ROOT, 'src', 'cli.ts')}`],
    ['sh', '-c', `node "${join(GMAIL_ROOT, 'dist', 'cli.mjs')}" approve x`],
    ['node', new URL(`file://${join(CORE_ROOT, 'dist', 'cli.mjs')}`).href],
  ]) {
    assert.throws(
      () => externalCommand(words, 'a test', 'linux'),
      { name: 'TypeError', message: /is a path inside .*, a package of this suite/ },
      JSON.stringify(words),
    );
  }
});

test('externalCommand needs words and a reason', () => {
  assert.throws(() => externalCommand([], 'a test', 'linux'), TypeError);
  assert.throws(() => externalCommand([''], 'a test', 'linux'), TypeError);
  assert.throws(() => externalCommand(['chmod', '700', '/x'], ' ', 'linux'), TypeError);
});

test('the reviewed external commands are accepted: chmod 700, claude and codex mcp get and remove (7e-external)', () => {
  const temp = realTemp();
  const accepted: [string[], NodeJS.Platform][] = [
    [['chmod', '700', join(temp, 'config')], 'darwin'],
    [['chmod', '700', '/profiles/me/.local/state/agent-communications/secrets'], 'linux'],
    [['claude', 'mcp', 'remove', 'gmail', '--scope', 'user'], 'linux'],
    [['claude', 'mcp', 'remove', 'old gmail'], 'win32'],
    [['codex', 'mcp', 'remove', 'slack-acme'], 'linux'],
    [['codex', 'mcp', 'get', 'resend'], 'linux'],
    [['claude', 'mcp', 'get', '7/gmail'], 'linux'],
    [['claude', 'mcp', 'remove', '$x&whoami&'], 'win32'],
  ];
  for (const [words, platform] of accepted) {
    const command = externalCommand(words, 'a reviewed external program', platform);
    assert.deepEqual(command.words, words);
    assert.equal(command.line, shellCommand(words, platform).line);
    assert.equal(command.reason, 'a reviewed external program');
    assert.ok(Object.isFrozen(command) && Object.isFrozen(command.words));
  }
  // `other-servers.ts`'s removals of another server go through it and print exactly what they always did.
  const rival = {
    client: 'claude-code',
    name: 'old gmail',
    path: '/profiles/me/.claude.json',
    command: 'npx',
    args: ['-y', '@shinzolabs/gmail-mcp'],
    env: {},
    scope: 'user' as const,
  };
  assert.equal(findUngatedGmailServers([rival], 'darwin')[0]?.removal, "claude mcp remove 'old gmail'");
  assert.equal(
    otherSlackServerRemoval({ ...rival, client: 'codex', name: 'slack-helper', args: ['/opt/slack.js'] }, 'linux'),
    'codex mcp remove slack-helper',
  );
});

test('a server whose name is a suite command is removed in prose, never by a command naming it', () => {
  const server = {
    client: 'claude-code',
    name: 'agent-slack',
    path: '/profiles/me/.claude.json',
    command: 'node',
    args: ['/opt/someone-elses-slack.js'],
    env: {},
    scope: 'user' as const,
  };
  const removal = otherSlackServerRemoval(server, 'linux');
  assert.equal(removal, 'remove "agent-slack" from /profiles/me/.claude.json by hand, then restart claude-code');
  assert.doesNotMatch(removal, /mcp remove/);
});

// ── The import graph: brands, registrations and the locator, one way only ───────────────────────────────────────────

const SRC = realpathSync(fileURLToPath(new URL('../src/', import.meta.url)));
const GRAPHED = ['command-brands.ts', 'registrations.ts', 'cli-command.ts', 'mcp-install.ts', 'operations/servers.ts'];
/** The permitted edges among them, importer → imported (plan, task 6; task 10 lets the operations use the locator). */
const PERMITTED: readonly (readonly [string, string])[] = [
  ['registrations.ts', 'mcp-install.ts'],
  ['cli-command.ts', 'command-brands.ts'],
  ['cli-command.ts', 'registrations.ts'],
  ['mcp-install.ts', 'command-brands.ts'],
  ['operations/servers.ts', 'registrations.ts'],
  ['operations/servers.ts', 'mcp-install.ts'],
  ['operations/servers.ts', 'cli-command.ts'],
];
/** What must never be reachable, through any chain of runtime imports across core's sources. */
const UNREACHABLE: readonly (readonly [string, readonly string[]])[] = [
  ['command-brands.ts', ['mcp-install.ts', 'operations/servers.ts', 'registrations.ts', 'cli-command.ts']],
  ['registrations.ts', ['cli-command.ts', 'operations/servers.ts']],
  ['mcp-install.ts', ['registrations.ts', 'cli-command.ts', 'operations/servers.ts']],
  ['cli-command.ts', ['operations/servers.ts']],
];

interface Edge {
  from: string;
  to: string;
  typeOnly: boolean;
}

function sourceGraph(): Edge[] {
  const files = (readdirSync(SRC, { recursive: true }) as string[]).filter((file) => file.endsWith('.ts'));
  const edges: Edge[] = [];
  // An import or export clause holds no `;`, so the match cannot run on into the next statement.
  const statics = /^(?:import|export)\s+(type\s+)?([^;]*?)\s*from\s*['"](\.\.?\/[^'"]+)['"]/gm;
  const bare = /^import\s+['"](\.\.?\/[^'"]+)['"]/gm;
  const dynamic = /\bimport\(\s*['"](\.\.?\/[^'"]+)['"]\s*\)/g;
  for (const file of files) {
    const from = file.split(sep).join('/');
    const text = readFileSync(join(SRC, file), 'utf8');
    const add = (specifier: string, typeOnly: boolean) => {
      const to = relative(SRC, resolve(SRC, dirname(file), specifier))
        .split(sep)
        .join('/');
      edges.push({ from, to, typeOnly });
    };
    for (const match of text.matchAll(statics)) {
      const clause = match[2] ?? '';
      const named = /^\{([\s\S]*)\}$/.exec(clause.trim());
      const allTypes =
        named !== null &&
        (named[1] ?? '')
          .split(',')
          .map((part) => part.trim())
          .filter(Boolean)
          .every((part) => part.startsWith('type '));
      add(match[3] as string, Boolean(match[1]) || allTypes);
    }
    for (const match of text.matchAll(bare)) add(match[1] as string, false);
    for (const match of text.matchAll(dynamic)) add(match[1] as string, false);
  }
  return edges;
}

/** Kahn's algorithm: the nodes in an order where every importer comes after what it imports, or null on a cycle. */
function topologicalOrder(nodes: readonly string[], edges: readonly (readonly [string, string])[]): string[] | null {
  const waiting = new Map(nodes.map((node) => [node, edges.filter(([from]) => from === node).length]));
  const order: string[] = [];
  const ready = nodes.filter((node) => waiting.get(node) === 0);
  while (ready.length > 0) {
    const node = ready.shift() as string;
    order.push(node);
    for (const [from, to] of edges) {
      if (to !== node) continue;
      const left = (waiting.get(from) ?? 0) - 1;
      waiting.set(from, left);
      if (left === 0) ready.push(from);
    }
  }
  return order.length === nodes.length ? order : null;
}

test('command-brands, registrations, cli-command, mcp-install and operations/servers import one way only, with no cycle', () => {
  const edges = sourceGraph();
  assert.ok(edges.length > 100, 'the sources were read');
  const among = edges.filter(({ from, to }) => GRAPHED.includes(from) && GRAPHED.includes(to) && from !== to);
  const pairs = [...new Set(among.map(({ from, to }) => `${from} -> ${to}`))].map(
    (pair) => pair.split(' -> ') as [string, string],
  );
  const permitted = new Set(PERMITTED.map(([from, to]) => `${from} -> ${to}`));
  // Type-only imports count too: a module that must not import another must not name its types either.
  assert.deepEqual(
    pairs.filter(([from, to]) => !permitted.has(`${from} -> ${to}`)),
    [],
    'every import among them is one the design permits',
  );
  // The edges this task relies on are really there, so the graph read is the real one rather than an empty one.
  for (const edge of [
    'mcp-install.ts -> command-brands.ts',
    'registrations.ts -> mcp-install.ts',
    'operations/servers.ts -> registrations.ts',
  ]) {
    assert.ok(
      pairs.some(([from, to]) => `${from} -> ${to}` === edge),
      edge,
    );
  }
  assert.notEqual(topologicalOrder(GRAPHED, pairs), null, 'the imports among them sort topologically');
  assert.notEqual(topologicalOrder(GRAPHED, PERMITTED), null, 'and so does every edge the design permits');
  // Through any other module, at runtime: no chain of imports may lead back.
  const runtime = new Map<string, string[]>();
  for (const { from, to, typeOnly } of edges) if (!typeOnly) runtime.set(from, [...(runtime.get(from) ?? []), to]);
  for (const [start, forbidden] of UNREACHABLE) {
    const seen = new Set<string>();
    const queue = [start];
    while (queue.length > 0) {
      const node = queue.shift() as string;
      for (const next of runtime.get(node) ?? []) {
        if (seen.has(next)) continue;
        seen.add(next);
        queue.push(next);
      }
    }
    assert.deepEqual(
      forbidden.filter((module) => seen.has(module)),
      [],
      `${start} reaches none of ${forbidden.join(', ')}`,
    );
  }
});

test('the topological check fails on a cycle', () => {
  assert.equal(
    topologicalOrder(
      ['a', 'b', 'c'],
      [
        ['a', 'b'],
        ['b', 'c'],
        ['c', 'a'],
      ],
    ),
    null,
  );
  assert.deepEqual(topologicalOrder(['a', 'b'], [['a', 'b']]), ['b', 'a']);
});

/** Removes a link itself, never what it points at. */
function rmLink(path: string): void {
  unlinkSync(path);
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
