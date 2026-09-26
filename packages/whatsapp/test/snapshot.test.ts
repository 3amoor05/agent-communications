import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdirSync, readdirSync, readFileSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { test } from 'node:test';
import { isCommsError } from '@agentcomms/core';
import { STORE_FILE } from '../src/source/location.ts';
import { nodeSourceIo, probeStore, type SourceIo, snapshotStore } from '../src/source/snapshot.ts';
import { openDatabase } from '../src/sqlite.ts';
import { buildFixtureStore, LATE_MESSAGE, writeDecoy } from './support/fixture.ts';
import { newHarness, tempDir } from './support/harness.ts';

/**
 * Reading WhatsApp's store must never change it, must see what the running app has not yet folded into the main file,
 * and must read nothing else in the container. These are the promises the real store will be trusted with.
 */

function digest(path: string): string {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

function snapshotOf(dir: string): Record<string, { sha: string; size: number; mtimeNs: bigint }> {
  const out: Record<string, { sha: string; size: number; mtimeNs: bigint }> = {};
  for (const name of readdirSync(dir).sort()) {
    const path = join(dir, name);
    const info = statSync(path, { bigint: true });
    // Windows locks byte ranges of a live `-shm` file, so its bytes cannot be read there; its size and mtime can.
    const sha = process.platform === 'win32' && name.endsWith('-shm') ? 'locked' : digest(path);
    out[name] = { sha, size: Number(info.size), mtimeNs: info.mtimeNs };
  }
  return out;
}

/** Records every path each operation was asked for, and passes through to the real file system. */
function spyIo(): { io: SourceIo; touched: string[] } {
  const touched: string[] = [];
  return {
    touched,
    io: {
      lstat: (path) => {
        touched.push(path);
        return nodeSourceIo.lstat(path);
      },
      copyFile: (from, to) => {
        touched.push(from);
        return nodeSourceIo.copyFile(from, to);
      },
      readHeader: (path, bytes) => {
        touched.push(path);
        return nodeSourceIo.readHeader(path, bytes);
      },
    },
  };
}

test('sync never writes to the source: every file beside the store is byte-for-byte and mtime-for-mtime unchanged, and nothing new appears', async () => {
  const harness = await newHarness({ store: { wal: true } });
  try {
    const before = snapshotOf(harness.container);
    assert.ok(before[`${STORE_FILE}-wal`], 'the fixture holds a write-ahead log, as a running WhatsApp does');
    await harness.ready();
    const after = snapshotOf(harness.container);
    assert.deepEqual(after, before, 'the container is exactly as it was: same files, same bytes, same mtimes');
  } finally {
    harness.fixture?.close();
  }
});

test('messages still in the write-ahead log are read while WhatsApp holds the store open — which SQLite’s immutable mode would miss', async () => {
  const harness = await newHarness({ store: { wal: true } });
  try {
    await harness.ready();
    const found = await harness.cli(['search', 'write-ahead', '--account', 'acme/whatsapp', '--json']);
    assert.equal(found.code, 0, found.stdout);
    const results = found.data().results as { message: { content: { enveloped: string } } }[];
    assert.equal(results.length, 1);
    assert.match(results[0]?.message.content.enveloped ?? '', new RegExp(LATE_MESSAGE));

    // The alternative this design rejected, shown rather than asserted in prose: `immutable=1` reads the main file
    // only, so the newest message is not there.
    const path = harness.fixture?.path as string;
    const immutable = await openDatabase(`file:${path}?immutable=1`, { readOnly: true });
    try {
      const row = immutable.prepare('SELECT COUNT(*) AS n FROM ZWAMESSAGE WHERE ZTEXT = ?').get(LATE_MESSAGE) as {
        n: number;
      };
      assert.equal(row.n, 0, 'immutable mode does not see the log');
    } finally {
      immutable.close();
    }
  } finally {
    harness.fixture?.close();
  }
});

test('only ChatStorage.sqlite and its log are read: the key store beside it is never touched, and cannot be named', async () => {
  const harness = await newHarness({ store: { wal: true } });
  try {
    const decoy = writeDecoy(harness.container);
    writeDecoy(harness.container, 'ContactsV2.sqlite');
    const spy = spyIo();
    const context = harness.context({ sourceIo: spy.io });
    const work = tempDir();
    const snapshot = await snapshotStore(harness.fixture?.path as string, work, context.sourceOptions(true));
    await snapshot.dispose();
    const names = new Set(spy.touched.map((path) => basename(path)));
    assert.deepEqual(
      [...names].sort(),
      [STORE_FILE, `${STORE_FILE}-journal`, `${STORE_FILE}-wal`],
      'the journal is only looked for; nothing else is',
    );
    assert.ok(!spy.touched.includes(decoy));

    // Named directly, the key store is refused on its name, before a single byte is read.
    const again = spyIo();
    await assert.rejects(
      probeStore(decoy, { io: again.io }),
      (error: unknown) => isCommsError(error) && error.code === 'USAGE',
    );
    assert.deepEqual(again.touched, []);
    const added = await harness.cli(['add', 'acme/whatsapp', '--source', decoy, '--json']);
    assert.equal(added.code, 64);
    assert.match(String(added.json().error?.message), /only a file named ChatStorage\.sqlite/);
  } finally {
    harness.fixture?.close();
  }
});

// Creating a symbolic link needs a privilege Windows does not give an ordinary process.
test('a link in place of the store is refused, not followed', { skip: process.platform === 'win32' }, async () => {
  const dir = tempDir();
  const real = await buildFixtureStore(join(dir, 'real'));
  const linked = join(dir, 'linked');
  mkdirSync(linked);
  symlinkSync(real.path, join(linked, STORE_FILE));
  await assert.rejects(
    probeStore(join(linked, STORE_FILE)),
    (error: unknown) => isCommsError(error) && /not a regular file/.test(error.message),
  );
  await assert.rejects(
    snapshotStore(join(linked, STORE_FILE), tempDir()),
    (error: unknown) => isCommsError(error) && /not a regular file/.test(error.message),
  );
});

test('a store that keeps changing while it is copied is copied again, then refused rather than read half-written', async () => {
  const dir = tempDir();
  const fixture = await buildFixtureStore(dir, { wal: true });
  try {
    let copies = 0;
    const racing: SourceIo = {
      ...nodeSourceIo,
      async copyFile(from, to) {
        await nodeSourceIo.copyFile(from, to);
        copies += 1;
        // WhatsApp writes between the fingerprint and the second look, every time.
        fixture.write(`UPDATE ZWACHATSESSION SET ZUNREADCOUNT = ${copies} WHERE Z_PK = 1`);
      },
    };
    const work = tempDir();
    await assert.rejects(
      snapshotStore(fixture.path, work, { io: racing, attempts: 3, sleep: async () => undefined }),
      (error: unknown) => isCommsError(error) && error.code === 'TRANSIENT' && error.details?.reason === 'STORE_BUSY',
    );
    assert.deepEqual(readdirSync(work), [], 'every abandoned copy was deleted');

    // Once it settles, the next attempt succeeds.
    let calls = 0;
    const settling: SourceIo = {
      ...nodeSourceIo,
      async copyFile(from, to) {
        await nodeSourceIo.copyFile(from, to);
        calls += 1;
        if (calls === 1) fixture.write('UPDATE ZWACHATSESSION SET ZUNREADCOUNT = 99 WHERE Z_PK = 1');
      },
    };
    const snapshot = await snapshotStore(fixture.path, work, { io: settling, sleep: async () => undefined });
    assert.equal(snapshot.attempts, 2);
    await snapshot.dispose();
  } finally {
    fixture.close();
  }
});

test('macOS refusing access says exactly what to allow, and to which app — and writes nothing', async () => {
  const harness = await newHarness({ env: { __CFBundleIdentifier: 'com.apple.Terminal' } });
  const denied: SourceIo = {
    ...nodeSourceIo,
    lstat: async () => {
      throw Object.assign(new Error('EPERM: operation not permitted'), { code: 'EPERM' });
    },
    readHeader: async () => {
      throw Object.assign(new Error('EPERM: operation not permitted'), { code: 'EPERM' });
    },
  };
  const result = await harness.cli(['add', 'acme/whatsapp', '--json'], { sourceIo: denied, platform: 'darwin' });
  assert.equal(result.code, 77, 'permission needed');
  const error = result.json().error as { message: string; hint: string; details: Record<string, unknown> };
  assert.match(error.message, /not allowed to read .*ChatStorage\.sqlite/);
  assert.match(error.hint, /access data from other apps/);
  assert.match(error.hint, /Privacy & Security → Full Disk Access/);
  assert.match(error.hint, /Terminal/);
  assert.equal(error.details.reason, 'MACOS_PRIVACY');
  assert.equal(error.details.grant, 'Full Disk Access');
  assert.deepEqual(harness.coreConfig().accounts ?? {}, {}, 'nothing added');

  // status reports the same, as a state, rather than failing.
  const status = await harness.cli(['status', '--json'], { sourceIo: denied, platform: 'darwin' });
  assert.equal(status.code, 0);
});

test('a missing store says WhatsApp for Mac may not be installed, and names where the Business app keeps its own', async () => {
  const harness = await newHarness({ store: false });
  const result = await harness.cli(['add', 'acme/whatsapp', '--json']);
  assert.equal(result.code, 66);
  const error = result.json().error as { message: string; hint: string };
  assert.match(error.message, /no WhatsApp message store at/);
  assert.match(error.hint, /WhatsApp for Mac installed and signed in/);
  assert.match(error.hint, /WhatsAppSMB/);
});

test('a permission dialog nobody answers fails in seconds with what to look for, instead of hanging', async () => {
  const harness = await newHarness();
  const hanging: SourceIo = {
    ...nodeSourceIo,
    lstat: () => new Promise(() => undefined),
  };
  const started = Date.now();
  const result = await harness.cli(['add', 'acme/whatsapp', '--json'], { sourceIo: hanging, sourceTimeoutMs: 50 });
  assert.ok(Date.now() - started < 5_000);
  assert.equal(result.code, 75, 'temporary: retry once the dialog is answered');
  const error = result.json().error as { message: string; hint: string; details: Record<string, unknown> };
  assert.match(error.message, /waiting for a macOS permission dialog/);
  assert.match(error.hint, /access data from other apps/);
  assert.equal(error.details.reason, 'MACOS_PROMPT_PENDING');
});

test('the copy is deleted after every sync, and one a crash left behind is removed by the next', async () => {
  const harness = await newHarness();
  await harness.ready();
  const config = harness.coreConfig();
  const id = Object.values(config.accounts)[0]?.id as string;
  const dir = join(harness.env.AGENT_COMMS_STATE_DIR as string, 'whatsapp', id);
  assert.deepEqual(
    readdirSync(dir).filter((name) => name.startsWith('snapshot-')),
    [],
  );
  mkdirSync(join(dir, 'snapshot-crashed'));
  writeFileSync(join(dir, 'snapshot-crashed', STORE_FILE), 'left behind');
  const synced = await harness.cli(['sync', '--account', 'acme/whatsapp', '--json']);
  assert.equal(synced.code, 0);
  assert.equal((synced.data().snapshot as { staleRemoved: number }).staleRemoved, 1);
  assert.deepEqual(
    readdirSync(dir).filter((name) => name.startsWith('snapshot-')),
    [],
  );
  if (process.platform !== 'win32') {
    assert.equal(statSync(join(dir, 'index.sqlite')).mode & 0o777, 0o600, 'the index is owner-only');
    assert.equal(statSync(dir).mode & 0o777, 0o700);
  }
});
