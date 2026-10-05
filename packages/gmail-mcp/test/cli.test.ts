import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, realpathSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const ENTRY = fileURLToPath(new URL('../src/server.ts', import.meta.url));

interface Ran {
  code: number | null;
  stdout: string;
  stderr: string;
}

/**
 * The bin's environment: a directory of the run's own for its configuration and its home, and nothing else from the
 * machine running the tests but `PATH`.
 *
 * The home goes under both of the names core reads it by: `HOME` on macOS and Linux, `USERPROFILE` on Windows, as
 * Node's own `homedir()` does there. This used to inherit the whole environment — the real home under both names, the
 * real `%LOCALAPPDATA%` — with one fixed `/tmp` directory shared by every run as its configuration.
 */
function binEnv(): NodeJS.ProcessEnv {
  // realpath: on macOS the temporary directory is a symlink, and core compares resolved paths.
  const home = realpathSync(mkdtempSync(join(tmpdir(), 'agent-gmail-mcp-')));
  return {
    PATH: process.env.PATH ?? '',
    HOME: home,
    USERPROFILE: home,
    AGENT_COMMS_CONFIG_DIR: join(home, 'config'),
    NO_COLOR: '1',
    AGENT_COMMS_UPDATE_CHECK: 'off',
  };
}

/** Starts the bin and closes its stdin, which is how a client ending a session looks to the server. */
function runBin(
  args: string[],
  { closeStdin = true, env = binEnv() }: { closeStdin?: boolean; env?: NodeJS.ProcessEnv } = {},
): Promise<Ran> {
  return new Promise((resolve, reject) => {
    const child = spawn(
      process.execPath,
      ['--experimental-strip-types', '--disable-warning=ExperimentalWarning', ENTRY, ...args],
      {
        stdio: ['pipe', 'pipe', 'pipe'],
        env,
      },
    );
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => {
      stdout += String(chunk);
    });
    child.stderr.on('data', (chunk) => {
      stderr += String(chunk);
    });
    child.once('error', reject);
    child.once('exit', (code) => resolve({ code, stdout, stderr }));
    if (closeStdin) child.stdin.end();
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error(`the server did not exit; stderr: ${stderr.slice(0, 300)}`));
    }, 20_000);
    timer.unref();
  });
}

test('--help explains the options and writes nothing to stdout', async () => {
  const result = await runBin(['--help']);
  assert.equal(result.code, 0);
  // stdout belongs to the protocol, even when the process is only printing help.
  assert.equal(result.stdout, '');
  assert.match(result.stderr, /--inbox <alias>/);
  assert.match(result.stderr, /--read-only/);
  for (const flag of ['--config-dir', '--state-dir', '--data-dir', '--secrets-dir']) {
    assert.match(result.stderr, new RegExp(flag));
  }
  assert.doesNotMatch(result.stderr, /--downloads-dir/);
});

test('the wrapper strictly parses and applies all four registration path pins before startup', async () => {
  const env = binEnv();
  const home = env.HOME as string;
  const pinned = join(home, 'pinned');
  mkdirSync(pinned, { recursive: true });
  writeFileSync(
    join(pinned, 'config.json'),
    `${JSON.stringify({
      version: 1,
      secrets: { store: 'file' },
      inboxes: {
        work: {
          id: 'ibx_AAAAAAAAAAAAAAAA',
          provider: 'gmail',
          email: 'jo@example.test',
          identity: 'oidc',
          client: 'default',
          tier: 'read',
          grantedScopes: [],
          secretRef: 'gmail:refresh:ibx_AAAAAAAAAAAAAAAA',
          createdAt: '2026-10-05T00:00:00.000Z',
        },
      },
    })}\n`,
  );
  const result = await runBin(
    [
      '--config-dir',
      pinned,
      '--state-dir',
      join(home, 'pinned-state'),
      '--data-dir',
      join(home, 'pinned-data'),
      '--secrets-dir',
      join(home, 'pinned-secrets'),
      '--inbox',
      'work',
    ],
    { env },
  );
  assert.equal(result.code, 0, result.stderr);
  assert.equal(result.stdout, '');
});

test('the wrapper refuses unknown and empty path options as usage before startup', async () => {
  for (const args of [['--unknown'], ['--config-dir=']]) {
    const result = await runBin(args);
    assert.equal(result.code, 64, `${args.join(' ')}: ${result.stderr}`);
    assert.equal(result.stdout, '');
    assert.match(result.stderr, /usage|non-empty|unknown/i);
  }
});

test('the server exits when its client disconnects, rather than lingering', async () => {
  const result = await runBin([]);
  assert.equal(result.code, 0);
  assert.equal(result.stdout, '', 'a server that spoke to nobody must not print anything on stdout');
});

test('a pinned mailbox that does not exist fails at startup, not on the first call', async () => {
  const result = await runBin(['--inbox', 'missing']);
  assert.notEqual(result.code, 0);
  assert.match(result.stderr, /missing/);
});
