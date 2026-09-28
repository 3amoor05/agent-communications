import assert from 'node:assert/strict';
import { test } from 'node:test';
import { isInside, resolvePaths } from '@agentcomms/core';
import { newHarness } from './support/harness.ts';

/**
 * Everything core resolves from the harness's environment stays inside the harness's own temporary directory — on
 * every platform, not only the one running the tests. Core reads the home from `HOME` on macOS and Linux and from
 * `USERPROFILE` on Windows; a harness with `HOME` alone passed everywhere but Windows, where it resolved the default
 * data and downloads directories to the real profile of whoever ran the tests. Asking core what each platform would
 * resolve catches that on a Mac too. Nothing is written: paths are only resolved and compared.
 */
test('every path the harness resolves is inside its own temporary directory, on macOS, Linux and Windows', async () => {
  const harness = await newHarness();
  const own = harness.configDir;
  for (const platform of ['darwin', 'linux', 'win32'] as const) {
    const outside = Object.entries(resolvePaths({ env: harness.env, platform })).filter(
      ([, path]) => !isInside(path, own),
    );
    assert.deepEqual(outside, [], platform);
  }
});
