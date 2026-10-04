import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { access, readdir } from 'node:fs/promises';
import { createServer } from 'node:net';
import { join } from 'node:path';
import { PassThrough } from 'node:stream';
import { test } from 'node:test';
import { setTimeout as sleep } from 'node:timers/promises';
import type { SecretStore } from '@agentcomms/core';
import { run } from '../src/cli/program.ts';
import { slackOk, TEST_CLIENT_ID } from './support/harness.ts';
import { fetchListener } from './support/listener.ts';
import { newOrganisationHarness } from './support/organisation.ts';

function deferred<T = void>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}

for (const account of ['profile', 'own-app'] as const) {
  for (const boundary of ['before secret', 'after secret'] as const) {
    test(`foreground ${account} interruption ${boundary} settles the accepted callback before exit`, {
      timeout: 10000,
    }, async (t) => {
      const probe = createServer();
      await new Promise<void>((done) => probe.listen(0, 'localhost', done));
      const port = (probe.address() as { port: number }).port;
      await new Promise<void>((done) => probe.close(() => done()));
      const harness = await newOrganisationHarness({ port });
      const before = await harness.core.config.load();
      const secrets = await harness.core.secrets('file');
      const host = new EventEmitter();
      const ready = deferred<string>();
      const interrupted = deferred();
      const redelivered = deferred();
      const releaseWrite = deferred();
      const completion = deferred();
      const events: string[] = [];
      let exchanges = 0;
      let writes = 0;
      let locked = false;
      let armed = false;
      const stdout = new PassThrough();
      const stderr = new PassThrough();
      let output = '';
      stdout.on('data', (chunk) => {
        output += String(chunk);
      });
      const interrupt = () => {
        events.push('interrupt');
        host.emit('SIGINT');
        interrupted.resolve();
      };
      const wrapped: SecretStore = {
        ...secrets,
        get: (ref) => secrets.get(ref),
        invalidate: (ref) => secrets.invalidate(ref),
        async set(ref, value) {
          writes++;
          // Both app paths must stage while holding the machine-wide credentials lock.
          locked = await access(join(harness.configDir, '.credentials.lock')).then(
            () => true,
            () => false,
          );
          await secrets.set(ref, value);
          if (boundary === 'after secret') {
            interrupt();
            await releaseWrite.promise;
          }
        },
        async delete(ref) {
          const result = await secrets.delete(ref);
          events.push('withdrawn');
          completion.resolve();
          return result;
        },
      };
      t.mock.method(harness.core, 'secrets', async () => {
        if (armed && boundary === 'before secret') {
          armed = false;
          interrupt();
        }
        return wrapped;
      });
      const action = run(
        [
          'workspace',
          'add',
          'rgc/slack',
          ...(account === 'own-app' ? ['--client-id', TEST_CLIENT_ID, '--port', String(port)] : []),
        ],
        {
          core: harness.core,
          env: harness.env,
          platform: 'darwin',
          streams: { stdout, stderr, stdin: new PassThrough() },
          openBrowser: (url) => ready.resolve(url),
          exchange: async () => {
            exchanges++;
            armed = true;
            return slackOk({ team: { id: 'TRGC0001', name: 'RGC' }, app_id: 'A0READ' });
          },
          signals: {
            host: Object.assign(host, {
              pid: process.pid,
              kill() {
                events.push('exit');
                redelivered.resolve();
              },
            }),
            exit: () => undefined,
          },
        },
      );
      // The injected signal host records redelivery without killing the test process. The interrupted CLI
      // deliberately stays pending until that signal would end it; only real operation state is asserted below.
      void action.catch((error) => ready.reject(error));
      void action.then(
        () => completion.resolve(),
        () => completion.resolve(),
      );
      t.after(() => releaseWrite.resolve());
      const auth = new URL(await ready.promise);
      const callback = new URL(`http://localhost:${port}/slack/callback`);
      callback.searchParams.set('state', auth.searchParams.get('state') ?? '');
      callback.searchParams.set('code', 'fake-code');
      await fetchListener(callback);
      await interrupted.promise;
      if (boundary === 'after secret') {
        // A broken exit wait wins this race; the correct one stays held until the staged write can settle.
        await Promise.race([redelivered.promise, sleep(100)]);
        releaseWrite.resolve();
        await completion.promise;
      }
      await redelivered.promise;
      await completion.promise;
      assert.equal(exchanges, 1, 'the callback must already have reached the exchange');
      assert.equal(writes, boundary === 'before secret' ? 0 : 1, 'interruption allowed a new secret write');
      if (boundary === 'after secret') {
        assert.equal(locked, true, 'the secret was staged outside the credentials lock');
        assert.ok(events.indexOf('withdrawn') < events.indexOf('exit'), 'exit raced staged-secret withdrawal');
      }
      assert.deepEqual(await harness.core.config.load(), before, 'interruption wrote account or learned app id');
      assert.deepEqual(await readdir(join(harness.configDir, 'secrets')).catch(() => []), []);
      assert.deepEqual(await readdir(join(harness.core.paths.stateDir, 'slack', 'flows')), []);
      assert.equal(output, '', 'interrupted sign-in printed a successful result');
      await assert.rejects(fetchListener(callback));
    });
  }
}
