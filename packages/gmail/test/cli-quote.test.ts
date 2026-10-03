import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { PassThrough } from 'node:stream';
import { test } from 'node:test';
import { openCore } from '@agentcomms/core';
import { run } from '../src/cli/program.ts';
import { tempDir } from './support/harness.ts';

/** The command printed for a change has to be pasteable on the platform where this CLI is running (CUE-398). */

interface ErrorEnvelope {
  error?: { hint?: string };
}

async function addClient(filename: string, name: string, platform: NodeJS.Platform): Promise<string> {
  const root = tempDir('agent-gmail-quote-');
  const configDir = join(root, 'config');
  mkdirSync(configDir);
  writeFileSync(join(configDir, 'config.json'), `${JSON.stringify({ version: 1, secrets: { store: 'file' } })}\n`);
  writeFileSync(
    join(root, filename),
    JSON.stringify({
      installed: {
        client_id: `${name}.apps.googleusercontent.com`,
        client_secret: 'not-a-real-secret',
        project_id: 'test-project',
        redirect_uris: ['http://localhost'],
      },
    }),
  );
  const env = {
    AGENT_COMMS_CONFIG_DIR: configDir,
    AGENT_COMMS_UPDATE_CHECK: 'off',
    HOME: root,
    USERPROFILE: root,
    NO_COLOR: '1',
  };
  const core = openCore({ env });
  let stdout = '';
  const out = new PassThrough();
  out.on('data', (chunk) => {
    stdout += String(chunk);
  });
  const code = await run(['client', 'add', join(root, filename), '--name', name, '--json'], {
    core,
    env,
    platform,
    streams: { stdout: out, stderr: new PassThrough(), stdin: new PassThrough() },
  });
  assert.equal(code, 10, stdout);
  return String((JSON.parse(stdout) as ErrorEnvelope).error?.hint);
}

test('commands to run again quote a spaced word on POSIX and print words instead of an unsafe Windows line', async () => {
  const posix = await addClient('client secret.json', 'posix-client', 'darwin');
  assert.match(posix, /agent-gmail client add '\/.*\/client secret\.json' --name posix-client --json --approval/);

  const windows = await addClient('client 100%.json', 'windows-client', 'win32');
  assert.match(windows, /\["agent-gmail","client","add",/);
  assert.match(windows, /client 100\\u0025\.json/);
  assert.match(windows, /cannot be quoted the same way for cmd\.exe and for PowerShell/);
});
