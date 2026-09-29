import assert from 'node:assert/strict';
import type { SpawnOptions, spawn } from 'node:child_process';
import { chmodSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, dirname, join, relative } from 'node:path';
import { type TestContext, test } from 'node:test';
import { openInBrowser } from '../src/cli/browser.ts';

/*
 * The authorisation link is opened by a program named by its full path. A bare name is looked up, on Windows first in the
 * current folder — where a download may have saved a stranger's `cmd.exe` — and on Unix in whatever an empty or
 * relative entry of PATH reaches from there. Nothing here opens a browser: `spawn` is a stand-in that records what it
 * was asked to start, and an `xdg-open` is a file these tests write into a temporary directory.
 */

const LINK = 'https://slack.com/oauth/v2/authorize?client_id=x&state=y';

const NOT_ON_WINDOWS =
  process.platform === 'win32' ? { skip: 'an executable bit and a POSIX PATH are what this is about' } : {};

interface Started {
  command: string;
  args: readonly string[];
  options: SpawnOptions;
}

/** A `spawn` that starts nothing and records what it was asked to start. */
function recorder(): { started: Started[]; spawn: typeof spawn } {
  const started: Started[] = [];
  const fake = (command: string, args: readonly string[], options: SpawnOptions) => {
    started.push({ command, args, options });
    return { on: () => undefined, unref: () => undefined };
  };
  return { started, spawn: fake as unknown as typeof spawn };
}

function tempDir(t: TestContext): string {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'agent-slack-browser-')));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

/** An executable `xdg-open` in `directory`, which does nothing if it is ever run. */
function xdgOpen(directory: string): string {
  const file = join(directory, 'xdg-open');
  writeFileSync(file, '#!/bin/sh\nexit 0\n');
  chmodSync(file, 0o755);
  return file;
}

test('on Windows the link is opened by cmd.exe under the Windows folder, told not to look in its current folder', () => {
  const { started, spawn } = recorder();
  assert.equal(openInBrowser(LINK, 'win32', { spawn, env: { SystemRoot: 'C:\\Windows', PATH: 'C:\\Tools' } }), true);
  assert.equal(started.length, 1);
  const [run] = started;
  assert.equal(run?.command, 'C:\\Windows\\System32\\cmd.exe', 'cmd.exe by its full path, never the bare name');
  assert.deepEqual(run?.args, ['/c', 'start', '', LINK]);
  assert.equal(
    run?.options.env?.NoDefaultCurrentDirectoryInExePath,
    '1',
    'the child is told not to take a program from its current folder',
  );
  assert.equal(run?.options.env?.PATH, 'C:\\Tools', 'the rest of the environment is passed on');
  // The Windows folder is the one the environment names.
  openInBrowser(LINK, 'win32', { spawn, env: { SystemRoot: 'D:\\Win' } });
  assert.equal(started[1]?.command, 'D:\\Win\\System32\\cmd.exe');
});

test('on macOS it is /usr/bin/open, with the environment as it is', () => {
  const { started, spawn } = recorder();
  assert.equal(openInBrowser(LINK, 'darwin', { spawn, env: { PATH: '/usr/bin' } }), true);
  assert.equal(started[0]?.command, '/usr/bin/open', 'open by its full path, never the bare name');
  assert.deepEqual(started[0]?.args, [LINK]);
  assert.deepEqual(started[0]?.options.env, { PATH: '/usr/bin' });
});

test(
  'elsewhere it is the xdg-open of the first absolute PATH directory; an empty, `.` or relative entry is never looked in',
  NOT_ON_WINDOWS,
  (t) => {
    // The relative entry really reaches an `xdg-open` from this test's current folder, so a search that took it
    // would find that one first.
    const cwdDecoy = relative(process.cwd(), tempDir(t));
    xdgOpen(cwdDecoy);
    const installed = xdgOpen(tempDir(t));
    const { started, spawn } = recorder();
    const everything = { PATH: ['', '.', cwdDecoy, dirname(installed)].join(delimiter) };
    assert.equal(openInBrowser(LINK, 'linux', { spawn, env: everything }), true);
    assert.equal(
      started[0]?.command,
      installed,
      'the xdg-open in the absolute directory, never the one a relative entry reaches',
    );
    assert.deepEqual(started[0]?.args, [LINK]);
    assert.deepEqual(started[0]?.options.env, everything);

    started.length = 0;
    const onlyRelative = { PATH: ['', '.', cwdDecoy].join(delimiter) };
    assert.equal(openInBrowser(LINK, 'linux', { spawn, env: onlyRelative }), false, 'nothing opened is reported');
    assert.deepEqual(started, [], 'with only relative entries nothing is started, though one of them holds xdg-open');
    assert.equal(openInBrowser(LINK, 'linux', { spawn, env: {} }), false);
    assert.deepEqual(started, [], 'with no PATH nothing is started');
  },
);
