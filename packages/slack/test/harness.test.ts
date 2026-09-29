import assert from 'node:assert/strict';
import { test } from 'node:test';
import { resolvePaths } from '@agentcomms/core';
import { assertInsideHome, newHarness } from './support/harness.ts';

/**
 * The harness's environment keeps everything core resolves from it inside the harness's own temporary home — on every
 * platform, not only the one running the tests.
 *
 * Core reads the home from `HOME` on macOS and Linux and from `USERPROFILE` on Windows. A harness that set only the
 * first passed every test on macOS and Linux, and on Windows saved its downloads into the runner's real Downloads
 * folder, the same one for every test: the 0.8.0 release run failed ten download tests that way, each on a file or a
 * folder another test had left there. The harness refuses to start when a path leaves its home, but only for the
 * platform it runs on; these ask core what each platform would resolve, so the Windows case is caught on a Mac too.
 * Nothing here is written anywhere: a path is only resolved and compared.
 */

test('every path the harness’s environment resolves to is inside its own home, on macOS, Linux and Windows', async () => {
  const harness = await newHarness();
  for (const platform of ['darwin', 'linux', 'win32'] as const) {
    const paths = resolvePaths({ env: harness.env, platform });
    assert.doesNotThrow(() => assertInsideHome(paths, harness.home), platform);
  }
});

test('the environment the harness had before — HOME alone — is refused for Windows, naming what would have leaked', async () => {
  const harness = await newHarness();
  const { USERPROFILE: _userProfile, ...homeAlone } = harness.env;
  // Still enough on macOS and Linux, which is why nothing but a Windows run noticed.
  assert.doesNotThrow(() => assertInsideHome(resolvePaths({ env: homeAlone, platform: 'linux' }), harness.home));
  assert.throws(
    () => assertInsideHome(resolvePaths({ env: homeAlone, platform: 'win32' }), harness.home),
    /^Error: the harness resolves dataDir to .+ and downloadsDir to .+, outside its own home /,
  );
});
