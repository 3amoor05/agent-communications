import assert from 'node:assert/strict';
import syncFs from 'node:fs';
import fs from 'node:fs/promises';
import { syncBuiltinESMExports } from 'node:module';
import { join } from 'node:path';
import { test } from 'node:test';
import type { Config } from '../src/config.ts';
import { ConfigStore } from '../src/config.ts';
import { tempDir } from './helpers/temp.ts';

type CancellableUpdateResult = Config & { readonly committedBeforeAbort?: true };

function wasCommittedBeforeAbort(result: CancellableUpdateResult): boolean {
  const marker = Object.getOwnPropertyDescriptor(result, 'committedBeforeAbort');
  return marker?.value === true && marker.enumerable === false;
}

for (const boundary of ['after mutator', 'before rename'] as const) {
  test(`a cancellable config update keeps its original bytes on abort ${boundary}`, async (t) => {
    const directory = tempDir();
    const store = new ConfigStore(directory);
    await store.update((current) => current);
    const before = await fs.readFile(store.path, 'utf8');
    const controller = new AbortController();
    const reason = new Error('cancelled update');
    const rename = fs.rename;
    const open = fs.open;
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
      if (String(args[1]) === store.path) writes++;
      await rename(...args);
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
    assert.equal(writes, 0, 'the aborted transaction reached its atomic commit point');
    assert.equal(await fs.readFile(store.path, 'utf8'), before);
    assert.equal((await store.load()).defaults.timezone, 'system', 'the cache retained an aborted write');
    assert.deepEqual(await fs.readdir(directory), ['config.json']);
  });
}

for (const boundary of ['after rename', 'lock release'] as const) {
  test(`an abort ${boundary} leaves the config committed and marks the result`, async (t) => {
    const directory = tempDir();
    const store = new ConfigStore(directory);
    await store.update((current) => current);
    const controller = new AbortController();
    const rename = fs.rename;
    const rm = fs.rm;
    let writes = 0;
    t.mock.method(fs, 'rename', async (...args: Parameters<typeof rename>) => {
      await rename(...args);
      if (String(args[1]) !== store.path) return;
      writes++;
      if (boundary === 'after rename') controller.abort();
    });
    t.mock.method(fs, 'rm', async (...args: Parameters<typeof rm>) => {
      await rm(...args);
      if (boundary === 'lock release' && String(args[0]) === join(directory, '.config.lock')) controller.abort();
    });
    syncBuiltinESMExports();
    t.after(() => {
      t.mock.restoreAll();
      syncBuiltinESMExports();
    });
    const result = (await store.update(
      (current) => ({
        ...current,
        defaults: { ...current.defaults, timezone: 'Europe/London' },
      }),
      { signal: controller.signal },
    )) as CancellableUpdateResult;
    assert.equal(wasCommittedBeforeAbort(result), true);
    assert.equal(result.defaults.timezone, 'Europe/London');
    assert.equal(JSON.stringify(result).includes('committedBeforeAbort'), false, 'the marker changed config data');
    assert.equal(writes, 1, 'the committed transaction attempted a rollback write');
    assert.equal((await store.load()).defaults.timezone, 'Europe/London');
    assert.deepEqual(await fs.readdir(directory), ['config.json']);
  });
}

test('abort after a config transaction resolves does not mark or roll back the committed change', async () => {
  const store = new ConfigStore(tempDir());
  const controller = new AbortController();
  const result = (await store.update(
    (current) => ({
      ...current,
      defaults: { ...current.defaults, timezone: 'Europe/London' },
    }),
    { signal: controller.signal },
  )) as CancellableUpdateResult;
  controller.abort();
  assert.equal(wasCommittedBeforeAbort(result), false);
  assert.equal((await store.load()).defaults.timezone, 'Europe/London');
});

test('abort before the first config rename leaves no config or staged file', async (t) => {
  const directory = tempDir();
  const store = new ConfigStore(directory);
  const controller = new AbortController();
  const open = fs.open;
  t.mock.method(fs, 'open', async (...args: Parameters<typeof open>) => {
    const handle = await open(...args);
    if (String(args[0]).endsWith('.tmp')) {
      const sync = handle.sync.bind(handle);
      t.mock.method(handle, 'sync', async () => {
        await sync();
        controller.abort();
      });
    }
    return handle;
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

test('an abort during lock release never touches an intervening writer', async (t) => {
  const directory = tempDir();
  const first = new ConfigStore(directory);
  const second = new ConfigStore(directory);
  await first.update((current) => current);
  const controller = new AbortController();
  const rm = fs.rm;
  const rename = fs.rename;
  let intercepted = false;
  let writes = 0;
  t.mock.method(fs, 'rename', async (...args: Parameters<typeof rename>) => {
    await rename(...args);
    if (String(args[1]) === first.path) writes++;
  });
  t.mock.method(fs, 'rm', async (...args: Parameters<typeof rm>) => {
    await rm(...args);
    if (String(args[0]) !== join(directory, '.config.lock') || intercepted) return;
    intercepted = true;
    await second.update((current) => ({
      ...current,
      defaults: { ...current.defaults, timezone: 'Asia/Tokyo' },
    }));
    controller.abort();
  });
  syncBuiltinESMExports();
  t.after(() => {
    t.mock.restoreAll();
    syncBuiltinESMExports();
  });
  const result = (await first.update(
    (current) => ({
      ...current,
      defaults: { ...current.defaults, timezone: 'Europe/London' },
    }),
    { signal: controller.signal },
  )) as CancellableUpdateResult;
  assert.equal(wasCommittedBeforeAbort(result), true);
  assert.equal(writes, 2, 'the interrupted transaction wrote after the intervening commit');
  assert.equal((await second.load()).defaults.timezone, 'Asia/Tokyo');
  assert.deepEqual(await fs.readdir(directory), ['config.json']);
});

test('a Windows-style rename-over failure proves no config descriptor spans the commit', async (t) => {
  const directory = tempDir();
  const store = new ConfigStore(directory);
  await store.update((current) => current);
  const controller = new AbortController();
  const openSync = syncFs.openSync;
  const closeSync = syncFs.closeSync;
  const rename = fs.rename;
  const openDescriptors = new Set<number>();
  let writes = 0;
  t.mock.method(syncFs, 'openSync', (...args: Parameters<typeof openSync>) => {
    const descriptor = openSync(...args);
    if (String(args[0]) === store.path) openDescriptors.add(descriptor);
    return descriptor;
  });
  t.mock.method(syncFs, 'closeSync', (...args: Parameters<typeof closeSync>) => {
    openDescriptors.delete(args[0]);
    return closeSync(...args);
  });
  t.mock.method(fs, 'rename', async (...args: Parameters<typeof rename>) => {
    if (String(args[1]) === store.path && openDescriptors.size > 0) {
      const error = new Error('Windows refused rename-over while the destination handle was open');
      Object.assign(error, { code: 'EPERM' });
      throw error;
    }
    await rename(...args);
    if (String(args[1]) === store.path) {
      writes++;
      controller.abort();
    }
  });
  syncBuiltinESMExports();
  t.after(() => {
    t.mock.restoreAll();
    syncBuiltinESMExports();
  });
  const result = (await store.update(
    (current) => ({
      ...current,
      defaults: { ...current.defaults, timezone: 'Europe/London' },
    }),
    { signal: controller.signal },
  )) as CancellableUpdateResult;
  assert.equal(wasCommittedBeforeAbort(result), true);
  assert.equal(writes, 1);
  assert.equal(openDescriptors.size, 0);
  assert.equal((await store.load()).defaults.timezone, 'Europe/London');
});
