import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

/*
 * Case 0000 of the CUE-403 design, against the built package: a command located by a built caller, for another
 * product registered from a source checkout, runs — on the oldest Node the suite supports.
 *
 * Node 22.12–22.17 runs TypeScript only with `--experimental-strip-types`; from 22.18 it needs nothing. So the printed
 * command carries that flag for a `.ts` entry whatever the caller is, and this test runs it. The release workflow runs
 * this file alone under exactly Node 22.12.0, after building under the repository's own Node (see `old-node` in
 * `.github/workflows/release.yml`); under any newer Node it still checks the words.
 *
 * Plain `.mjs`, importing the build: no TypeScript of its own, so the old Node can load it without any flag.
 */

const CORE = fileURLToPath(new URL('../', import.meta.url));
const { VERSION, locateCliCommand, requireChannelManifest } = await import(
  pathToFileURL(join(CORE, 'dist', 'index.mjs')).href
);

function write(path, text) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, text);
}

function manifest(channel, version) {
  const { binary } = requireChannelManifest(channel);
  return `${JSON.stringify({
    name: `@agentcomms/${channel}`,
    version,
    type: 'module',
    engines: { node: '>=22.12.0' },
    bin: { [binary]: './dist/cli.mjs' },
    agentcomms: { channel, binary },
  })}\n`;
}

test(`a built caller's command for another product's local source registration runs on Node ${process.versions.node} (0000)`, () => {
  const temp = realpathSync(mkdtempSync(join(tmpdir(), 'cli-command-old-node-')));
  try {
    // The printing package: a built Gmail, at this release.
    const gmail = join(temp, 'gmail');
    write(join(gmail, 'package.json'), manifest('gmail', VERSION));
    write(join(gmail, 'dist', 'cli.mjs'), 'export {};\n');
    // Slack, registered by the local launcher from a checkout with no build: its source CLI only, which has types.
    const slack = join(temp, 'checkout', 'packages', 'slack');
    write(join(slack, 'package.json'), manifest('slack', VERSION));
    const entry = join(slack, 'src', 'cli.ts');
    write(
      entry,
      'const words: readonly string[] = process.argv.slice(2);\nprocess.stdout.write(JSON.stringify(words));\n',
    );
    const paths = {
      configDir: join(temp, 'config'),
      stateDir: join(temp, 'state'),
      dataDir: join(temp, 'data'),
      secretsDir: join(temp, 'secrets'),
      downloadsDir: join(temp, 'downloads'),
    };
    const result = locateCliCommand({
      caller: { url: pathToFileURL(join(gmail, 'dist', 'cli.mjs')).href, packageName: '@agentcomms/gmail' },
      target: { packageName: '@agentcomms/slack', manifest: requireChannelManifest('slack') },
      words: ['approve', 'abc123'],
      uses: ['configDir', 'stateDir'],
      paths,
      registrations: [
        {
          client: 'claude-code',
          path: join(temp, '.claude.json'),
          name: 'slack',
          // The interpreter the registration names is never run: the command is this Node's.
          command: join(temp, 'no-such-node'),
          args: ['--experimental-strip-types', entry, '--config-dir', paths.configDir, 'mcp'],
        },
      ],
    });
    assert.equal(result.ok, true, result.message);
    assert.deepEqual(result.command.words, [
      process.execPath,
      '--experimental-strip-types',
      entry,
      '--config-dir',
      paths.configDir,
      '--state-dir',
      paths.stateDir,
      'approve',
      'abc123',
    ]);
    // And it runs, here, with no shell and nothing on PATH.
    const [program, ...args] = result.command.words;
    const ran = spawnSync(program, args, { encoding: 'utf8', env: { PATH: '' } });
    assert.equal(ran.status, 0, ran.stderr);
    assert.deepEqual(JSON.parse(ran.stdout), [
      '--config-dir',
      paths.configDir,
      '--state-dir',
      paths.stateDir,
      'approve',
      'abc123',
    ]);
    assert.equal(
      readFileSync(entry, 'utf8').includes(': readonly string[]'),
      true,
      'the entry needed its types stripped',
    );
  } finally {
    rmSync(temp, { recursive: true, force: true });
  }
});
