import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { PassThrough } from 'node:stream';
import { test } from 'node:test';
import { openCore } from '@agentcomms/core';
import { run } from '../src/cli/program.ts';
import { GmailContext } from '../src/context.ts';
import { tempDir } from './support/harness.ts';

/** The command printed for a change has to be pasteable on the platform where this CLI is running (CUE-398). */

interface ErrorEnvelope {
  error?: { hint?: string };
}

test('the Gmail operation context carries an explicitly selected platform', () => {
  const root = tempDir('agent-gmail-platform-');
  const env = { AGENT_COMMS_CONFIG_DIR: join(root, 'config') };
  const context = new GmailContext({ core: openCore({ env }), env, platform: 'win32' });
  assert.equal(context.platform, 'win32');
});

function escapedForRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

async function addClient(
  filename: string,
  name: string,
  platform: NodeJS.Platform,
): Promise<{ hint: string; clientPath: string }> {
  const root = tempDir('agent-gmail-quote-');
  const configDir = join(root, 'config');
  mkdirSync(configDir);
  writeFileSync(join(configDir, 'config.json'), `${JSON.stringify({ version: 1, secrets: { store: 'file' } })}\n`);
  const clientPath = join(root, filename);
  writeFileSync(
    clientPath,
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
  return { hint: String((JSON.parse(stdout) as ErrorEnvelope).error?.hint), clientPath };
}

test('commands to run again quote a spaced word on POSIX and print words instead of an unsafe Windows line', async () => {
  const posix = await addClient('client secret.json', 'posix-client', 'darwin');
  assert.match(
    posix.hint,
    new RegExp(`agent-gmail client add '${escapedForRegExp(posix.clientPath)}' --name posix-client --json --approval`),
  );

  const windows = await addClient('client 100%.json', 'windows-client', 'win32');
  assert.match(windows.hint, /\["agent-gmail","client","add",/);
  assert.match(windows.hint, /client 100\\u0025\.json/);
  assert.match(windows.hint, /cannot be quoted the same way for cmd\.exe and for PowerShell/);
});

test('Windows prints a bare-safe trailing backslash but refuses a quote-requiring trailing-backslash word', async () => {
  const safe = await addClient('C:\\Profiles\\', 'safe-backslash', 'win32');
  assert.doesNotMatch(safe.hint, /\["agent-gmail"/);
  assert.ok(safe.hint.includes(safe.clientPath), safe.hint);

  const refused = await addClient('C:\\Profiles\\First Last\\', 'refused-backslash', 'win32');
  assert.match(refused.hint, /\["agent-gmail","client","add",/);
  assert.match(refused.hint, /C:\\\\Profiles\\\\First Last\\\\/);
  assert.match(refused.hint, /cannot be quoted the same way for cmd\.exe and for PowerShell/);
});
