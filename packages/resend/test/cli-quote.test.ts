import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, realpathSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PassThrough } from 'node:stream';
import { test } from 'node:test';
import { openCore } from '@agentcomms/core';
import { run } from '../src/cli/program.ts';

/** The command printed for a person to add a key has to fit the shell on the platform running this CLI (CUE-398). */

interface ErrorEnvelope {
  error?: { hint?: string };
}

async function addAccount(domain: string, platform: NodeJS.Platform): Promise<string> {
  const root = realpathSync.native(mkdtempSync(join(tmpdir(), 'agent-resend-quote-')));
  const configDir = join(root, 'config');
  mkdirSync(configDir);
  writeFileSync(join(configDir, 'config.json'), `${JSON.stringify({ version: 2, secrets: { store: 'file' } })}\n`);
  const env = {
    AGENT_COMMS_CONFIG_DIR: configDir,
    AGENT_COMMS_UPDATE_CHECK: 'off',
    HOME: root,
    USERPROFILE: root,
    NO_COLOR: '1',
    CLAUDECODE: '1',
  };
  const core = openCore({ env });
  let stdout = '';
  const out = new PassThrough();
  out.on('data', (chunk) => {
    stdout += String(chunk);
  });
  const code = await run(['--json', 'account', 'add', 'acme/resend', '--domain', domain], {
    core,
    env,
    platform,
    fetch: async () => {
      throw new Error('the key refusal must happen before Resend is called');
    },
    streams: { stdout: out, stderr: new PassThrough(), stdin: new PassThrough() },
  });
  assert.equal(code, 77, stdout);
  return String((JSON.parse(stdout) as ErrorEnvelope).error?.hint);
}

test('the hand-off command quotes a spaced word on POSIX and prints words instead of an unsafe Windows line', async () => {
  const posix = await addAccount('two words.test', 'darwin');
  assert.match(posix, /agent-resend account add acme\/resend --domain 'two words\.test'/);

  const windows = await addAccount('client%domain.test', 'win32');
  assert.match(windows, /\["agent-resend","account","add","acme\/resend","--domain","client\\u0025domain\.test"\]/);
  assert.match(windows, /cannot be quoted the same way for cmd\.exe and for PowerShell/);
});
