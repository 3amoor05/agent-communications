import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { openCore } from '../src/core.ts';
import { displayUrl, knownClientConfigs, listRegisteredServers, scanRegisteredServers } from '../src/mcp-clients.ts';
import { managedRuntimeEntry } from '../src/mcp-install.ts';
import { channelsAvailable } from '../src/operations/servers.ts';
import { VERSION } from '../src/version.ts';
import { tempDir } from './helpers/temp.ts';

/**
 * What the scanner can read of the MCP clients' own files, and what it says about the ones it cannot.
 *
 * `mcp prune` deletes whatever this does not report as registered, so a file it skipped in silence — a comment in
 * a VS Code `mcp.json`, codex moved by `CODEX_HOME`, a project's `.mcp.json` — was a runtime deleted from under a
 * client that still starts it. Every file here is in a temporary home; `CODEX_HOME` and `CLAUDE_CONFIG_DIR` are
 * set to temporary directories or left out, never inherited.
 */

function write(path: string, text: string): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, text);
}

function fileOf(env: NodeJS.ProcessEnv, client: string): string {
  const path = knownClientConfigs(env, 'linux').find((file) => file.client === client)?.path;
  assert.ok(path, `no config file for ${client}`);
  return path;
}

test('channel registrations retain and classify the four suite path pins', async () => {
  const home = tempDir();
  const env = { HOME: home, USERPROFILE: home, AGENT_COMMS_CONFIG_DIR: join(home, 'config'), PATH: '' };
  const core = openCore({ env });
  const entry = managedRuntimeEntry(core.paths.dataDir, '@agentcomms/gmail', VERSION);
  write(
    fileOf(env, 'cursor'),
    JSON.stringify({
      mcpServers: {
        legacy: { command: process.execPath, args: [entry, 'mcp'] },
        pinned: {
          command: process.execPath,
          args: [
            entry,
            '--config-dir',
            core.paths.configDir,
            `--state-dir=${core.paths.stateDir}`,
            '--data-dir',
            core.paths.dataDir,
            `--secrets-dir=${core.paths.secretsDir}`,
            'mcp',
          ],
        },
      },
    }),
  );
  const gmail = (await channelsAvailable(core, env)).channels.find((channel) => channel.channel === 'gmail');
  assert.ok(gmail);
  const by = (name: string) => gmail.registered.find((registration) => registration.name === name);
  assert.deepEqual(by('legacy')?.pathPins, {});
  assert.deepEqual(by('pinned')?.pathPins, {
    configDir: core.paths.configDir,
    stateDir: core.paths.stateDir,
    dataDir: core.paths.dataDir,
    secretsDir: core.paths.secretsDir,
  });
});

test('VS Code and Gemini entries written with comments and trailing commas are read, as those clients read them', async () => {
  const home = tempDir();
  const env = { HOME: home };
  write(
    fileOf(env, 'vscode'),
    [
      '{',
      '  // added by hand',
      '  "servers": {',
      '    "slack": { "type": "stdio", "command": "node", "args": ["/r/cli.mjs", "mcp",], },',
      '  },',
      '  /* and a block comment, with "quotes" and // inside */',
      '}',
    ].join('\n'),
  );
  write(
    fileOf(env, 'gemini'),
    '{ "mcpServers": { "gmail": { "command": "node", "args": ["https://not-a-comment.example/x"] } } } // done',
  );

  const scan = await scanRegisteredServers(env, 'linux');
  assert.deepEqual(scan.unreadable, []);
  const by = (client: string) => scan.servers.find((server) => server.client === client);
  assert.deepEqual(by('vscode')?.args, ['/r/cli.mjs', 'mcp']);
  // `//` inside a string is text, not a comment.
  assert.deepEqual(by('gemini')?.args, ['https://not-a-comment.example/x']);
});

test('a client config that exists and cannot be read is reported by name, never skipped as if it were empty', async () => {
  const home = tempDir();
  const env = { HOME: home };
  // Claude Desktop reads plain JSON; a comment there is a file the client cannot read either, but this cannot
  // tell what it was meant to hold.
  write(fileOf(env, 'claude-desktop'), '{ "mcpServers": { "slack": // half an edit');
  write(fileOf(env, 'codex'), '[mcp_servers.slack\ncommand = "node"\n');
  write(fileOf(env, 'cursor'), JSON.stringify({ mcpServers: { fine: { command: 'node', args: [] } } }));

  const scan = await scanRegisteredServers(env, 'linux');
  assert.deepEqual(
    scan.unreadable.map((file) => file.path).sort(),
    [fileOf(env, 'claude-desktop'), fileOf(env, 'codex')].sort(),
  );
  assert.deepEqual(
    scan.servers.map((server) => server.name),
    ['fine'],
    'what could be read is still reported',
  );
  // The reason says where, never what: a line of somebody's config can hold a token.
  for (const file of scan.unreadable) assert.doesNotMatch(file.reason, /slack|node/);
});

test('codex is read from CODEX_HOME, and Claude Code from CLAUDE_CONFIG_DIR, when either is set', async () => {
  const home = tempDir();
  const codexHome = tempDir();
  const claudeDir = tempDir();
  write(join(codexHome, 'config.toml'), '[mcp_servers.moved]\ncommand = "node"\nargs = ["/r/a.mjs"]\n');
  write(join(claudeDir, '.claude.json'), JSON.stringify({ mcpServers: { relocated: { command: 'node', args: [] } } }));
  // The default places hold something else, which is exactly what must not be read instead.
  write(join(home, '.codex', 'config.toml'), '[mcp_servers.stale]\ncommand = "node"\n');
  write(join(home, '.claude.json'), JSON.stringify({ mcpServers: { stale: { command: 'node', args: [] } } }));

  const env = { HOME: home, CODEX_HOME: codexHome, CLAUDE_CONFIG_DIR: claudeDir };
  const servers = await listRegisteredServers(env, 'linux');
  assert.deepEqual(servers.map((server) => `${server.client}:${server.name}`).sort(), [
    'claude-code:relocated',
    'codex:moved',
  ]);
  assert.equal(fileOf(env, 'codex'), join(codexHome, 'config.toml'));
});

test("a config a caller names is read in its client's format, once, and one for an unknown client is never skipped", async () => {
  const home = tempDir();
  const env = { HOME: home };
  // Another CODEX_HOME, as a record of an earlier install would name it: TOML, because codex writes TOML.
  const codex = join(tempDir(), 'config.toml');
  write(codex, '[mcp_servers.slack]\ncommand = "node"\nargs = ["/r/cli.mjs", "mcp"]\n');
  const scan = await scanRegisteredServers(env, 'linux', [
    { client: 'codex', path: codex },
    { client: 'codex', path: codex },
  ]);
  assert.deepEqual(
    scan.servers.map((server) => [server.client, server.path, server.args[0]]),
    [['codex', codex, '/r/cli.mjs']],
  );

  // A client this does not know: read as JSON with comments, so TOML is unreadable rather than nothing registered.
  const unknown = await scanRegisteredServers(env, 'linux', [{ client: 'someday', path: codex }]);
  assert.deepEqual(
    unknown.unreadable.map((file) => file.path),
    [codex],
  );
});

test("a project's .mcp.json, for each project Claude Code lists, is read as a project-scoped entry", async () => {
  const home = tempDir();
  const project = tempDir();
  const gone = join(tempDir(), 'deleted-since');
  write(join(home, '.claude.json'), JSON.stringify({ projects: { [project]: {}, [gone]: {} } }));
  write(join(project, '.mcp.json'), JSON.stringify({ mcpServers: { team: { command: 'node', args: ['/r/b.mjs'] } } }));

  const scan = await scanRegisteredServers({ HOME: home }, 'linux');
  assert.deepEqual(scan.unreadable, [], 'a project that no longer exists is not a file that cannot be read');
  const [found] = scan.servers;
  assert.equal(found?.name, 'team');
  assert.equal(found?.client, 'claude-code');
  assert.equal(found?.scope, 'project');
  assert.equal(found?.path, join(project, '.mcp.json'));
});

test('the same entry at user and project scope is two entries, not one', async () => {
  const home = tempDir();
  const entry = { command: 'node', args: ['/r/cli.mjs', 'mcp'] };
  write(
    join(home, '.claude.json'),
    JSON.stringify({ mcpServers: { slack: entry }, projects: { '/p': { mcpServers: { slack: entry } } } }),
  );
  const servers = await listRegisteredServers({ HOME: home }, 'linux');
  assert.deepEqual(servers.map((server) => `${server.name}:${server.scope}`).sort(), ['slack:project', 'slack:user']);
});

test('codex: an [mcp_servers] table with inline entries is read, env and all', async () => {
  const home = tempDir();
  write(
    join(home, '.codex', 'config.toml'),
    [
      'model = "o3"',
      'instructions = """',
      '[mcp_servers.not_a_table]',
      'a multi-line string that only looks like a header',
      '"""',
      '',
      '[mcp_servers]',
      'slack = { command = "npx", args = ["-y", "@modelcontextprotocol/server-slack"], env = { SLACK_TEAM_ID = "T0001" } }',
      '"quoted.name" = { command = \'C:\\bin\\node.exe\', args = [',
      '  "a.mjs", # a comment inside an array',
      '  "mcp",',
      '] }',
      '',
      '[mcp_servers.sectioned]',
      'command = "node"',
      'args = ["b.mjs"]',
      '',
      '[mcp_servers.sectioned.env]',
      'PATH = "/usr/bin:\\u0041"',
      '',
      '[mcp_servers.sectioned.tools.search]',
      'enabled = true',
    ].join('\n'),
  );
  const scan = await scanRegisteredServers({ HOME: home }, 'linux');
  assert.deepEqual(scan.unreadable, []);
  const by = (name: string) => scan.servers.find((server) => server.name === name);
  assert.deepEqual(by('slack')?.args, ['-y', '@modelcontextprotocol/server-slack']);
  assert.deepEqual(by('slack')?.env, { SLACK_TEAM_ID: 'T0001' });
  assert.equal(by('slack')?.packageName, '@modelcontextprotocol/server-slack');
  assert.equal(by('quoted.name')?.command, 'C:\\bin\\node.exe', 'a literal string keeps its backslashes');
  assert.deepEqual(by('quoted.name')?.args, ['a.mjs', 'mcp']);
  assert.deepEqual(by('sectioned')?.env, { PATH: '/usr/bin:A' });
  assert.deepEqual(scan.servers.map((server) => server.name).sort(), ['quoted.name', 'sectioned', 'slack']);
});

test("another server's URL is shown by scheme and host only — a path can be the key", () => {
  assert.equal(displayUrl('https://mcp.slack.com/mcp'), 'https://mcp.slack.com');
  const shown =
    displayUrl('https://someone:hunter2@mcp.example.net:8443/fake-path-key/slack?key=fake-secret-1#frag') ?? '';
  assert.equal(shown, 'https://mcp.example.net:8443');
  assert.equal(displayUrl('not a url?key=fake-secret-2'), undefined, 'what cannot be parsed is not shown at all');
});
