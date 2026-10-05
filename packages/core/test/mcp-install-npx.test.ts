import assert from 'node:assert/strict';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { type McpProduct, mcpInstall } from '../src/mcp-install.ts';
import { tempDir } from './helpers/temp.ts';

/**
 * The `npx` entry keeps `mcp` exactly when the package `npx` runs is the whole CLI.
 *
 * Gmail's `@agentcomms/gmail-mcp` starts the server as its bin, so `mcp` there would be read as an argument. Slack's
 * `@agentcomms/slack` is the CLI, and the entry without `mcp` ran it: `unknown option '--workspace'`, exit 64, in a
 * client config already written. One rule served both, and it was right for one of them.
 *
 * `--client json` with `apply: false` and `noVerify` writes nothing and starts nothing. HOME is a scratch directory
 * because the installer reads every client's config there to list what else is registered.
 */
function product(runsCli: boolean | undefined): McpProduct {
  return {
    packageName: '@agentcomms/example',
    binary: 'agent-example',
    defaultServerName: 'example',
    npxPackage: runsCli ? '@agentcomms/example' : '@agentcomms/example-mcp',
    ...(runsCli === undefined ? {} : { npxArgs: runsCli ? ['mcp'] : [] }),
    version: '9.9.9',
    moduleUrl: import.meta.url,
    serverArgs: () => ['--pin', 'acme'],
    narrowingOf: () => ({}),
  };
}

async function npxArgs(runsCli: boolean | undefined): Promise<string[]> {
  const home = tempDir();
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    HOME: home,
    USERPROFILE: home,
    APPDATA: join(home, 'AppData', 'Roaming'),
    AGENT_COMMS_UPDATE_CHECK: 'off', // no test asks the real npm registry, or stops for a release
  };
  // The scanner follows these to where codex and Claude Code keep their real configs; this test reads neither.
  delete env.CODEX_HOME;
  delete env.CLAUDE_CONFIG_DIR;
  const paths = {
    configDir: join(home, 'config'),
    stateDir: join(home, 'state'),
    dataDir: join(home, 'data'),
    secretsDir: join(home, 'secrets'),
  };
  const context = { env, core: { paths } };
  const result = await mcpInstall(context, product(runsCli), {
    client: 'json',
    launcher: 'npx',
    apply: false,
    noVerify: true,
  });
  assert.equal(result.applied, false);
  assert.equal(result.entry.env.AGENT_COMMS_CONFIG_DIR, undefined);
  assert.ok(!result.entry.args.includes('--downloads-dir'));
  return result.entry.args;
}

const pins = (home: string): string[] => [
  '--config-dir',
  join(home, 'config'),
  '--state-dir',
  join(home, 'state'),
  '--data-dir',
  join(home, 'data'),
  '--secrets-dir',
  join(home, 'secrets'),
];

test('a CLI package run through npx is told to start the server', async () => {
  const args = await npxArgs(true);
  const home = dirname(args[3] ?? '');
  assert.deepEqual(args, ['-y', '@agentcomms/example@9.9.9', ...pins(home), 'mcp', '--pin', 'acme']);
});

test('a server-only package run through npx is not handed `mcp` as an argument', async () => {
  for (const runsCli of [false, undefined]) {
    const args = await npxArgs(runsCli);
    const home = dirname(args[3] ?? '');
    assert.deepEqual(args, ['-y', '@agentcomms/example-mcp@9.9.9', ...pins(home), '--pin', 'acme']);
  }
});
