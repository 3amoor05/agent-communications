import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  closeSync,
  constants,
  linkSync,
  mkdirSync,
  openSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { basename, join } from 'node:path';
import { test } from 'node:test';
import { isCommsError } from '@agentcomms/core';
import { STORE_FILE } from '../src/source/location.ts';
import { nodeSourceIo, probeStore, type SourceIo, snapshotStore } from '../src/source/snapshot.ts';
import { openDatabase } from '../src/sqlite.ts';
import { buildFixtureStore, LATE_MESSAGE, writeDecoy } from './support/fixture.ts';
import { whatsappHandoffs } from './support/handoffs.ts';
import { newHarness, tempDir } from './support/harness.ts';

/** What a refusal names to run, for the reads below that are not a command's: folders nobody opens. */
const HANDOFFS = whatsappHandoffs({ HOME: '/nowhere', AGENT_COMMS_CONFIG_DIR: '/nowhere/config' });

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
function spyIo(): { io: SourceIo; touched: string[]; opened: string[] } {
  const touched: string[] = [];
  const opened: string[] = [];
  return {
    touched,
    opened,
    io: {
      lstat: (path) => {
        touched.push(path);
        return nodeSourceIo.lstat(path);
      },
      open: (path) => {
        touched.push(path);
        opened.push(basename(path));
        return nodeSourceIo.open(path);
      },
    },
  };
}

/** The real file system, with `after` run once the first read of each file opened has returned. */
function readingIo(after: (path: string) => void): SourceIo {
  return {
    ...nodeSourceIo,
    async open(path) {
      const handle = await nodeSourceIo.open(path);
      let first = true;
      return {
        ...handle,
        async read(buffer, position) {
          const bytes = await handle.read(buffer, position);
          if (first) {
            first = false;
            after(path);
          }
          return bytes;
        },
      };
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
    if (process.platform !== 'win32') {
      for (const name of readdirSync(snapshot.directory)) {
        assert.equal(statSync(join(snapshot.directory, name)).mode & 0o777, 0o600, `${name} is owner-only`);
      }
    }
    await snapshot.dispose();
    const names = new Set(spy.touched.map((path) => basename(path)));
    assert.deepEqual(
      [...names].sort(),
      [STORE_FILE, `${STORE_FILE}-journal`, `${STORE_FILE}-wal`],
      'the journal is only looked for; nothing else is',
    );
    assert.ok(!spy.touched.includes(decoy));
    assert.deepEqual(
      spy.opened,
      [STORE_FILE, `${STORE_FILE}-wal`, `${STORE_FILE}-journal`],
      'each is opened once, and the copy reads from that open file, never through its name again',
    );

    // Named directly, the key store is refused on its name, before a single byte is read.
    const again = spyIo();
    await assert.rejects(
      probeStore(decoy, { handoffs: HANDOFFS, io: again.io }),
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
  // Refused when it is opened, before a byte is read — not found out afterwards.
  let reads = 0;
  const io = readingIo(() => {
    reads += 1;
  });
  await assert.rejects(
    probeStore(join(linked, STORE_FILE), { handoffs: HANDOFFS, io }),
    (error: unknown) => isCommsError(error) && /not a regular file/.test(error.message),
  );
  await assert.rejects(
    snapshotStore(join(linked, STORE_FILE), tempDir(), { handoffs: HANDOFFS, io }),
    (error: unknown) => isCommsError(error) && /not a regular file/.test(error.message),
  );

  // Nor in place of its log, pointing at the key store.
  const store = await buildFixtureStore(join(dir, 'logged'));
  symlinkSync(writeDecoy(join(dir, 'logged')), `${store.path}-wal`);
  const work = tempDir();
  await assert.rejects(
    snapshotStore(store.path, work, { handoffs: HANDOFFS, io }),
    (error: unknown) => isCommsError(error) && /-wal is not a regular file/.test(error.message),
  );
  assert.deepEqual(readdirSync(work), []);
  assert.equal(reads, 0, 'nothing was read through a link');
});

test('a log that appears, or a store replaced by another file, while it is copied means the copy is taken again', async () => {
  const dir = tempDir();
  const fixture = await buildFixtureStore(join(dir, 'container'));
  const journal = `${fixture.path}-journal`;
  let appeared = false;
  const appearing = readingIo(() => {
    if (appeared) return;
    appeared = true;
    writeFileSync(journal, 'a rollback journal, begun mid-copy');
  });
  const first = await snapshotStore(fixture.path, tempDir(), {
    handoffs: HANDOFFS,
    io: appearing,
    sleep: async () => undefined,
  });
  assert.equal(first.attempts, 2, 'the journal that appeared was not in the first copy');
  assert.deepEqual(first.copied, [STORE_FILE, `${STORE_FILE}-journal`]);
  await first.dispose();
  rmSync(journal);

  // Replaced under its name: the file opened is unchanged, but the name no longer names it.
  const other = await buildFixtureStore(join(dir, 'other'));
  let replaced = false;
  const replacing = readingIo((path) => {
    if (replaced || basename(path) !== STORE_FILE) return;
    replaced = true;
    renameSync(fixture.path, join(dir, 'moved-aside.sqlite'));
    renameSync(other.path, fixture.path);
  });
  const second = await snapshotStore(fixture.path, tempDir(), {
    handoffs: HANDOFFS,
    io: replacing,
    sleep: async () => undefined,
  });
  assert.equal(second.attempts, 2, 'the store that took its name is copied, in a second attempt');
  await second.dispose();

  // Gone by the second look, as a log WhatsApp removes is — by its name, where a platform keeps an open file's links.
  const logged = await buildFixtureStore(join(dir, 'logged'), { wal: true });
  try {
    let gone = false;
    const vanishing: SourceIo = {
      ...nodeSourceIo,
      async lstat(path) {
        if (!gone && basename(path) === `${STORE_FILE}-wal`) {
          gone = true;
          throw Object.assign(new Error('ENOENT: no such file or directory'), { code: 'ENOENT' });
        }
        return nodeSourceIo.lstat(path);
      },
    };
    const third = await snapshotStore(logged.path, tempDir(), {
      handoffs: HANDOFFS,
      io: vanishing,
      sleep: async () => undefined,
    });
    assert.equal(third.attempts, 2, 'a log gone from its name is copied again');
    await third.dispose();
  } finally {
    logged.close();
  }
});

/**
 * The race a check-then-copy loses: the store's name handed to a link to the key store between the look and the copy,
 * and handed back before the second look, so the two looks agree. The hook fires just after the first time the store
 * is examined — opened, or `lstat`ed by a design that looks before it copies — and puts the store back just before the
 * second.
 */
function racingIo(store: string, key: string, options: { restore: boolean }) {
  const aside = `${store}.aside`;
  let looks = 0;
  const swap = () => {
    renameSync(store, aside);
    symlinkSync(key, store);
  };
  const restore = () => {
    rmSync(store);
    renameSync(aside, store);
  };
  const look = async <T>(path: string, real: () => Promise<T>): Promise<T> => {
    if (basename(path) !== STORE_FILE) return real();
    looks += 1;
    if (looks === 2 && options.restore) restore();
    const result = await real();
    if (looks === 1) swap();
    return result;
  };
  const io = {
    ...nodeSourceIo,
    lstat: (path: string) => look(path, () => nodeSourceIo.lstat(path)),
    open: (path: string) => look(path, () => nodeSourceIo.open(path)),
  } as SourceIo;
  return { io, swapped: () => looks > 0 };
}

test('a store swapped for a link to the key store mid-copy is never read through it: the copy is of the original, or refused', {
  skip: process.platform === 'win32',
}, async () => {
  for (const restore of [true, false]) {
    const dir = tempDir();
    const fixture = await buildFixtureStore(join(dir, 'container'));
    const key = writeDecoy(join(dir, 'container'));
    const original = readFileSync(fixture.path);
    const race = racingIo(fixture.path, key, { restore });
    const work = tempDir();
    let copied: Buffer | null = null;
    let refused: unknown = null;
    try {
      // One attempt: a link found in the store's place after the copy is refused there and then, not retried.
      const snapshot = await snapshotStore(fixture.path, work, { handoffs: HANDOFFS, io: race.io, attempts: 1 });
      copied = readFileSync(snapshot.database);
      await snapshot.dispose();
    } catch (error) {
      refused = error;
    }
    assert.ok(race.swapped(), 'the race ran');
    if (copied) {
      assert.ok(!copied.includes(Buffer.from('decoy: never read')), 'the key store was not copied');
      assert.ok(copied.equals(original), 'what was copied is the store as it was opened');
    } else {
      assert.ok(isCommsError(refused) && /not a regular file/.test(refused.message), String(refused));
    }
    if (!restore) assert.ok(refused, 'a link still in the store’s place is refused');
    assert.deepEqual(readdirSync(work), [], 'nothing is left behind');
  }
});

test('a store with a second name — a hard link, which could be the key store’s — is refused, and so is a pipe', {
  skip: process.platform === 'win32',
}, async () => {
  const dir = tempDir();
  const fixture = await buildFixtureStore(join(dir, 'container'));
  linkSync(fixture.path, join(dir, 'another-name.sqlite'));
  for (const attempt of [
    () => snapshotStore(fixture.path, tempDir(), { handoffs: HANDOFFS }),
    () => probeStore(fixture.path, { handoffs: HANDOFFS }),
  ]) {
    await assert.rejects(
      attempt,
      (error: unknown) => isCommsError(error) && error.code === 'USAGE' && /more than one name/.test(error.message),
    );
  }

  // A pipe in the store's place would hold a read open forever; it is refused at once, as not a file.
  const piped = join(tempDir(), 'container');
  mkdirSync(piped);
  const pipe = join(piped, STORE_FILE);
  execFileSync('mkfifo', [pipe]);
  try {
    const started = Date.now();
    for (const attempt of [
      () => snapshotStore(pipe, tempDir(), { handoffs: HANDOFFS, timeoutMs: 3000 }),
      () => probeStore(pipe, { handoffs: HANDOFFS, timeoutMs: 3000 }),
    ]) {
      await assert.rejects(
        attempt,
        (error: unknown) => isCommsError(error) && error.code === 'USAGE' && /not a regular file/.test(error.message),
      );
    }
    assert.ok(Date.now() - started < 2000, 'without waiting on it');
  } finally {
    // Frees a reader a broken build left blocked, so the test process can end.
    try {
      closeSync(openSync(pipe, constants.O_WRONLY | constants.O_NONBLOCK));
    } catch {
      // No reader was waiting.
    }
  }
});

test('a store that keeps changing while it is copied is copied again, then refused rather than read half-written', async () => {
  const dir = tempDir();
  const fixture = await buildFixtureStore(dir, { wal: true });
  try {
    let copies = 0;
    // WhatsApp writes between the fingerprint and the second look, every time.
    const racing = readingIo(() => {
      copies += 1;
      fixture.write(`UPDATE ZWACHATSESSION SET ZUNREADCOUNT = ${copies} WHERE Z_PK = 1`);
    });
    const work = tempDir();
    await assert.rejects(
      snapshotStore(fixture.path, work, { handoffs: HANDOFFS, io: racing, attempts: 3, sleep: async () => undefined }),
      (error: unknown) => isCommsError(error) && error.code === 'TRANSIENT' && error.details?.reason === 'STORE_BUSY',
    );
    assert.deepEqual(readdirSync(work), [], 'every abandoned copy was deleted');

    // Once it settles, the next attempt succeeds.
    let calls = 0;
    const settling = readingIo(() => {
      calls += 1;
      if (calls === 1) fixture.write('UPDATE ZWACHATSESSION SET ZUNREADCOUNT = 99 WHERE Z_PK = 1');
    });
    const snapshot = await snapshotStore(fixture.path, work, {
      handoffs: HANDOFFS,
      io: settling,
      sleep: async () => undefined,
    });
    assert.equal(snapshot.attempts, 2);
    await snapshot.dispose();
  } finally {
    fixture.close();
  }
});

test('macOS refusing access says exactly what to allow, and to which app — and writes nothing', async () => {
  const harness = await newHarness({ env: { __CFBundleIdentifier: 'com.apple.Terminal' } });
  const denied: SourceIo = {
    lstat: async () => {
      throw Object.assign(new Error('EPERM: operation not permitted'), { code: 'EPERM' });
    },
    open: async () => {
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
    open: () => new Promise(() => undefined),
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
