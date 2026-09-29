import assert from 'node:assert/strict';
import { test } from 'node:test';
import { absoluteSearchPath, childEnvironment, windowsFolder, windowsSystemProgram } from '../src/system-programs.ts';

/*
 * A bare program name on Windows is looked up in the current folder first — the folder a download may have saved a
 * stranger's `reg.exe` into. These hold the three answers every spawn relies on: the Windows folder, a program under
 * it by its full path, and the environment that stops a child looking in its own current folder.
 */

test('a Windows program is named by its full path under the Windows folder the environment names, whatever its case', () => {
  assert.equal(windowsSystemProgram('reg.exe', { SystemRoot: 'D:\\Win' }), 'D:\\Win\\System32\\reg.exe');
  assert.equal(windowsSystemProgram('cmd.exe', { systemroot: 'C:\\Windows' }), 'C:\\Windows\\System32\\cmd.exe');
  assert.equal(windowsSystemProgram('cmd.exe', { windir: 'E:\\W' }), 'E:\\W\\System32\\cmd.exe');
  // Anything that is not a drive's absolute path is not taken: it would be read against the current folder, or be
  // another machine's.
  for (const value of ['Windows', '.\\Windows', '\\\\host\\share\\Windows', '\\Windows', 'C:Windows', '']) {
    assert.equal(windowsFolder({ SystemRoot: value }), 'C:\\Windows', value);
  }
  assert.equal(windowsSystemProgram('reg.exe', {}), 'C:\\Windows\\System32\\reg.exe');
});

test('a child started on Windows is told not to take programs from its current folder; elsewhere its environment is as given', () => {
  const env = { PATH: 'C:\\bin', USERPROFILE: 'C:\\Users\\sam' };
  const windows = childEnvironment(env, 'win32');
  assert.equal(windows.NoDefaultCurrentDirectoryInExePath, '1');
  assert.equal(windows.PATH, 'C:\\bin');
  // A copy: the environment passed in is not changed under whoever passed it.
  assert.equal((env as NodeJS.ProcessEnv).NoDefaultCurrentDirectoryInExePath, undefined);
  for (const platform of ['darwin', 'linux'] as const) {
    assert.equal(childEnvironment(env, platform).NoDefaultCurrentDirectoryInExePath, undefined, platform);
  }
});

test('a search path keeps only the folders that name themselves: never an empty or relative entry, which is the current folder', () => {
  assert.deepEqual(absoluteSearchPath(['/usr/bin', '', '.', 'bin', './bin', '/opt/homebrew/bin'], 'darwin'), [
    '/usr/bin',
    '/opt/homebrew/bin',
  ]);
  assert.deepEqual(
    absoluteSearchPath(
      ['C:\\Windows\\System32', '', '.', 'bin', '\\tools', 'C:tools', '\\\\host\\bin', 'D:/x'],
      'win32',
    ),
    ['C:\\Windows\\System32', 'D:/x'],
  );
});
