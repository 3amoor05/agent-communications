/**
 * A barrier inside the released 0.13.0 `agent-gmail`'s record lock, for the one mixed-version case that needs a 0.13
 * claim to be *holding* the lock while this release converts the configuration (CUE-404 Task 24; design 2026-10-05
 * §5 Round-29 (c)). Loaded before anything else runs in that process, after the seal.
 *
 * The released claim takes the record's lock, reads the record, and writes its `sending` state by renaming a
 * temporary file over `<id>.json` — nothing it does in between reaches Google, so nothing the fake Google holds can
 * stop it there. This holds that one rename instead, from outside the release: the first rename onto the file
 * `AGENTCOMMS_TEST_HOLD_WRITE` names writes `reached` into the folder `AGENTCOMMS_TEST_HOLD_SIGNALS` names and waits
 * for `release` to appear there. Every other file operation is untouched, and the release's code is not.
 */

import { existsSync, writeFileSync } from 'node:fs';
import fsp from 'node:fs/promises';
import { syncBuiltinESMExports } from 'node:module';
import { basename, dirname, join } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';

const TARGET = process.env.AGENTCOMMS_TEST_HOLD_WRITE;
const SIGNALS = process.env.AGENTCOMMS_TEST_HOLD_SIGNALS;
if (!TARGET || !SIGNALS) throw new Error('released-hold.mjs needs AGENTCOMMS_TEST_HOLD_WRITE and _SIGNALS');

/**
 * The record by its own name, `<id>.json` in an `approvals` folder: an approval id is unique, and a folder can be named
 * two ways — Windows' short `RUNNER~1` and its long form, macOS's `/var` and `/private/var` — where a file's name cannot.
 */
const same = (path, target) =>
  basename(path) === basename(target) && basename(dirname(path)) === basename(dirname(target));

let held = false;
const rename = fsp.rename;
fsp.rename = async function heldRename(from, to) {
  if (!held && same(String(to), TARGET)) {
    held = true;
    writeFileSync(join(SIGNALS, 'reached'), '');
    while (!existsSync(join(SIGNALS, 'release'))) await sleep(10);
  }
  return rename.call(this, from, to);
};
syncBuiltinESMExports();
