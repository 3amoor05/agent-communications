import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { syncBuiltinESMExports } from 'node:module';
import { join } from 'node:path';
import { test } from 'node:test';
import { ConfigStore } from '../src/config.ts';
import { CommsError } from '../src/errors.ts';
import { tempDir } from './helpers/temp.ts';

for (const boundary of [
  'after mutator',
  'before rename',
  'after rename',
  'uncertain rename',
  'lock release',
] as const) {
  test(`a cancellable config update restores its original bytes on abort ${boundary}`, async (t) => {
    const directory = tempDir();
    const store = new ConfigStore(directory);
    await store.update((current) => current);
    const before = await fs.readFile(store.path, 'utf8');
    const controller = new AbortController();
    const reason = new Error('cancelled update');
    const rename = fs.rename;
    const open = fs.open;
    const rm = fs.rm;
    let writes = 0;
    let intercepted = false;
    t.mock.method(fs, 'open', async (...args: Parameters<typeof open>) => {
      const handle = await open(...args);
      if (boundary === 'before rename' && String(args[0]).endsWith('.tmp')) {
        const sync = handle.sync.bind(handle);
        t.mock.method(handle, 'sync', async () => {
          await sync();
          intercepted = true;
          controller.abort(reason);
        });
      }
      return handle;
    });
    t.mock.method(fs, 'rename', async (...args: Parameters<typeof rename>) => {
      await rename(...args);
      if (String(args[1]) !== store.path) return;
      writes++;
      await fs.access(join(directory, '.config.lock'));
      if (writes === 1 && (boundary === 'after rename' || boundary === 'uncertain rename')) {
        intercepted = true;
        controller.abort(reason);
        if (boundary === 'uncertain rename') throw new Error('rename landed but its completion failed');
      }
    });
    t.mock.method(fs, 'rm', async (...args: Parameters<typeof rm>) => {
      await rm(...args);
      if (boundary === 'lock release' && String(args[0]) === join(directory, '.config.lock') && !intercepted) {
        intercepted = true;
        controller.abort(reason);
      }
    });
    syncBuiltinESMExports();
    t.after(() => {
      t.mock.restoreAll();
      syncBuiltinESMExports();
    });
    await assert.rejects(
      store.update(
        (current) => {
          if (boundary === 'after mutator') {
            intercepted = true;
            queueMicrotask(() => controller.abort(reason));
          }
          return { ...current, defaults: { ...current.defaults, timezone: 'Europe/London' } };
        },
        { signal: controller.signal },
      ),
      (error) => error === reason,
    );
    assert.equal(intercepted, true);
    assert.equal(await fs.readFile(store.path, 'utf8'), before);
    assert.equal((await store.load()).defaults.timezone, 'system', 'the cache retained an aborted write');
    assert.deepEqual(await fs.readdir(directory), ['config.json']);
    if (boundary === 'before rename') assert.equal(writes, 0, 'abort was checked only after the atomic commit');
  });
}

test('a cancellation rollback failure is explicit and does not claim that the original config was restored', async (t) => {
  const store = new ConfigStore(tempDir());
  await store.update((current) => current);
  const controller = new AbortController();
  const rename = fs.rename;
  let writes = 0;
  t.mock.method(fs, 'rename', async (...args: Parameters<typeof rename>) => {
    if (String(args[1]) === store.path && ++writes === 2) throw new Error('rollback storage unavailable');
    await rename(...args);
    if (String(args[1]) === store.path) controller.abort();
  });
  syncBuiltinESMExports();
  t.after(() => {
    t.mock.restoreAll();
    syncBuiltinESMExports();
  });
  await assert.rejects(
    store.update(
      (current) => ({
        ...current,
        defaults: { ...current.defaults, timezone: 'Europe/London' },
      }),
      { signal: controller.signal },
    ),
    (error) => {
      assert.ok(error instanceof CommsError);
      assert.equal(error.details?.configRollbackFailed, true);
      assert.match(error.message, /could not.*restor/i);
      return true;
    },
  );
  assert.equal((await store.load()).defaults.timezone, 'Europe/London');
});

test('abort after a config transaction resolves does not roll back a committed change', async () => {
  const store = new ConfigStore(tempDir());
  const controller = new AbortController();
  await store.update(
    (current) => ({
      ...current,
      defaults: { ...current.defaults, timezone: 'Europe/London' },
    }),
    { signal: controller.signal },
  );
  controller.abort();
  assert.equal((await store.load()).defaults.timezone, 'Europe/London');
});

test('abort restores an absent config rather than creating a defaults file', async (t) => {
  const directory = tempDir();
  const store = new ConfigStore(directory);
  const controller = new AbortController();
  const rename = fs.rename;
  t.mock.method(fs, 'rename', async (...args: Parameters<typeof rename>) => {
    await rename(...args);
    if (String(args[1]) === store.path) controller.abort();
  });
  syncBuiltinESMExports();
  t.after(() => {
    t.mock.restoreAll();
    syncBuiltinESMExports();
  });
  await assert.rejects(
    store.update((current) => current, { signal: controller.signal }),
    { name: 'AbortError' },
  );
  assert.deepEqual(await fs.readdir(directory), []);
});

test('cancellation during lock release never restores over an intervening writer', async (t) => {
  const directory = tempDir();
  const store = new ConfigStore(directory);
  const other = new ConfigStore(directory);
  await store.update((current) => current);
  const controller = new AbortController();
  const rm = fs.rm;
  let intercepted = false;
  t.mock.method(fs, 'rm', async (...args: Parameters<typeof rm>) => {
    await rm(...args);
    if (String(args[0]) === join(directory, '.config.lock') && !intercepted) {
      intercepted = true;
      await other.update((current) => ({ ...current, defaults: { ...current.defaults, timezone: 'Asia/Tokyo' } }));
      controller.abort();
    }
  });
  syncBuiltinESMExports();
  t.after(() => {
    t.mock.restoreAll();
    syncBuiltinESMExports();
  });
  await assert.rejects(
    store.update(
      (current) => ({
        ...current,
        defaults: { ...current.defaults, timezone: 'Europe/London' },
      }),
      { signal: controller.signal },
    ),
    (error) => {
      assert.ok(error instanceof CommsError);
      assert.equal(error.details?.configRollbackFailed, true);
      return true;
    },
  );
  assert.equal((await store.load()).defaults.timezone, 'Asia/Tokyo');
});

test('cancellation cannot erase an acknowledged identical-byte intervening writer', async (t) => {
  const directory = tempDir();
  const first = new ConfigStore(directory);
  const second = new ConfigStore(directory);
  await first.update((current) => current);
  const controller = new AbortController();
  const rm = fs.rm;
  let intercepted = false;
  let secondResolved = false;
  t.mock.method(fs, 'rm', async (...args: Parameters<typeof rm>) => {
    await rm(...args);
    if (String(args[0]) !== join(directory, '.config.lock') || intercepted) return;
    intercepted = true;
    // A's lock is gone, but its release has not resolved. B independently commits and acknowledges precisely
    // the same bytes. A must not confuse B's file with its own merely because their contents are identical.
    const firstBytes = await fs.readFile(first.path, 'utf8');
    const acknowledged = await second.update((current) => ({
      ...current,
      defaults: { ...current.defaults, timezone: 'Europe/London' },
    }));
    assert.equal(acknowledged.defaults.timezone, 'Europe/London');
    secondResolved = true;
    assert.equal(await fs.readFile(second.path, 'utf8'), firstBytes);
    controller.abort();
  });
  syncBuiltinESMExports();
  t.after(() => {
    t.mock.restoreAll();
    syncBuiltinESMExports();
  });
  const error = await first
    .update(
      (current) => ({
        ...current,
        defaults: { ...current.defaults, timezone: 'Europe/London' },
      }),
      { signal: controller.signal },
    )
    .then(
      () => assert.fail('the interrupted transaction must reject'),
      (reason: unknown) => reason,
    );
  assert.equal(secondResolved, true);
  assert.equal(
    (await second.load()).defaults.timezone,
    'Europe/London',
    'A erased the acknowledged identical-byte commit from B',
  );
  assert.ok(error instanceof CommsError);
  assert.equal(error.details?.configRollbackFailed, true, 'lost ownership must be explicit, not a claimed rollback');
  assert.deepEqual(await fs.readdir(directory), ['config.json']);
});
