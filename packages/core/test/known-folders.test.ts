import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  DOCUMENTS_KNOWN_FOLDER,
  DOWNLOADS_KNOWN_FOLDER,
  type RegistryRunner,
  registryShellFolder,
} from '../src/known-folders.ts';

/*
 * Where Windows says Downloads and Documents are, read from the registry with `reg.exe` by its full path — never the
 * bare `reg`, which Windows would look for in the current folder first, where a download may have saved a stranger's
 * `reg.exe`. Every run here goes through a stand-in: nothing is started.
 */

const PROFILE = { USERPROFILE: 'C:\\Users\\sam', SystemRoot: 'C:\\Windows' };

function recorder(output: string) {
  const calls: Array<{ command: string; args: readonly string[]; env: NodeJS.ProcessEnv }> = [];
  const run: RegistryRunner = (command, args, options) => {
    calls.push({ command, args, env: options.env });
    return output;
  };
  return { calls, run };
}

test('the registry is read with reg.exe under the Windows folder, and the child told not to look in its current folder', () => {
  const { calls, run } = recorder(
    `\r\nHKEY_CURRENT_USER\\Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\User Shell Folders\r\n    ${DOWNLOADS_KNOWN_FOLDER}    REG_EXPAND_SZ    %USERPROFILE%\\Downloads\r\n\r\n`,
  );
  const found = registryShellFolder(PROFILE, DOWNLOADS_KNOWN_FOLDER, { platform: 'win32', processEnv: PROFILE, run });
  assert.equal(found, 'C:\\Users\\sam\\Downloads');
  assert.equal(calls.length, 1);
  assert.equal(calls[0]?.command, 'C:\\Windows\\System32\\reg.exe');
  assert.deepEqual(calls[0]?.args, [
    'query',
    'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\User Shell Folders',
    '/v',
    DOWNLOADS_KNOWN_FOLDER,
  ]);
  assert.equal(calls[0]?.env.NoDefaultCurrentDirectoryInExePath, '1');
});

test('Documents is read the same way, moved wherever a person or a domain put it', () => {
  const { run } = recorder(`    ${DOCUMENTS_KNOWN_FOLDER}    REG_EXPAND_SZ    D:\\OneDrive\\Documents\r\n`);
  assert.equal(
    registryShellFolder(PROFILE, DOCUMENTS_KNOWN_FOLDER, { platform: 'win32', processEnv: PROFILE, run }),
    'D:\\OneDrive\\Documents',
  );
});

test('nothing is read for another profile, off Windows, or when the answer is not a folder on a drive', () => {
  const { calls, run } = recorder(`    ${DOCUMENTS_KNOWN_FOLDER}    REG_SZ    D:\\Docs\r\n`);
  // A test's temporary profile is not the running user's: the registry says nothing about it.
  assert.equal(
    registryShellFolder({ USERPROFILE: 'C:\\Temp\\home' }, DOCUMENTS_KNOWN_FOLDER, {
      platform: 'win32',
      processEnv: PROFILE,
      run,
    }),
    undefined,
  );
  assert.equal(
    registryShellFolder(PROFILE, DOCUMENTS_KNOWN_FOLDER, { platform: 'darwin', processEnv: PROFILE, run }),
    undefined,
  );
  assert.equal(calls.length, 0);
  for (const value of ['\\\\server\\share\\Docs', '%UNKNOWN%\\Docs', 'Docs']) {
    const answer = recorder(`    ${DOCUMENTS_KNOWN_FOLDER}    REG_EXPAND_SZ    ${value}\r\n`);
    assert.equal(
      registryShellFolder(PROFILE, DOCUMENTS_KNOWN_FOLDER, { platform: 'win32', processEnv: PROFILE, run: answer.run }),
      undefined,
      value,
    );
  }
  // A registry that does not answer is no answer.
  assert.equal(
    registryShellFolder(PROFILE, DOCUMENTS_KNOWN_FOLDER, {
      platform: 'win32',
      processEnv: PROFILE,
      run: () => {
        throw new Error('timed out');
      },
    }),
    undefined,
  );
});
