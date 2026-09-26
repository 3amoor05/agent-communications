import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';
import { CommsError } from '@agentcomms/core';
import { redact } from '../src/api/client.ts';
import { Throttle } from '../src/api/throttle.ts';
import { ResendContext } from '../src/context.ts';
import { listDomains, listSentEmails } from '../src/operations/read.ts';
import { FULL, type Harness, newHarness, tempDir } from './support/harness.ts';

/**
 * The team's production mail shares Resend's 10 requests a second with this tool. So: at most two a second from this
 * machine, counted across processes; and a 429 stops everything until Resend says, with nothing retried.
 */

let harness: Harness | undefined;
afterEach(async () => {
  await harness?.close();
  harness = undefined;
});

const ACCOUNT = 'acc_THROTTLE00000001';

test('requests are spaced at least 500 ms apart, across every throttle sharing the state directory', async () => {
  const state = tempDir('agent-resend-throttle-');
  let now = 1_000_000;
  const waits: number[] = [];
  const clock = { now: () => now, sleep: async (ms: number) => void waits.push(ms) };
  const one = new Throttle(state, ACCOUNT, clock);
  const two = new Throttle(state, ACCOUNT, clock);
  await one.before();
  await two.before();
  await one.before();
  assert.deepEqual(waits, [500, 1000], 'the second waits 500 ms, the third 1000 — whichever process asks');
  now += 5000;
  await two.before();
  assert.equal(waits.length, 2, 'after a quiet spell, no wait');
});

test('a 429 stops every request until retry-after has passed, and nothing is retried', async () => {
  harness = await newHarness();
  await harness.addAccount({ name: 'acme/resend' });
  let now = Date.now();
  const context = new ResendContext({
    core: harness.core,
    env: harness.env,
    fetch: harness.fake.fetch,
    throttle: { intervalMs: 0, now: () => now, sleep: async () => undefined },
  });
  harness.fake.intercept = () => ({
    status: 429,
    body: { name: 'rate_limit_exceeded', message: 'Too many requests' },
    headers: { 'retry-after': '7' },
  });
  await assert.rejects(listDomains(context, 'acme/resend'), (error: unknown) => {
    assert.ok(error instanceof CommsError);
    assert.equal(error.code, 'TRANSIENT');
    assert.equal(error.details?.retryAfterSeconds, 7);
    return true;
  });
  assert.equal(harness.fake.requests.length, 1, 'no retry');
  harness.fake.intercept = null;
  // Stopped: refused here, without asking Resend.
  await assert.rejects(listSentEmails(context, 'acme/resend'), /asked this machine to stop/);
  assert.equal(harness.fake.requests.length, 1);
  // Another process sharing the state directory is stopped too.
  const other = new ResendContext({
    core: harness.core,
    env: harness.env,
    fetch: harness.fake.fetch,
    throttle: { intervalMs: 0, now: () => now, sleep: async () => undefined },
  });
  await assert.rejects(listDomains(other, 'acme/resend'), /asked this machine to stop/);
  now += 8000;
  const result = await listDomains(context, 'acme/resend');
  assert.equal(result.available, true);
  assert.equal(harness.fake.requests.length, 2);
});

test('without retry-after, ratelimit-reset decides; and a reply saying none are left stops the next one', async () => {
  const state = tempDir('agent-resend-throttle-');
  let now = 5_000_000;
  const throttle = new Throttle(state, ACCOUNT, { now: () => now, sleep: async () => undefined, intervalMs: 0 });
  assert.equal(await throttle.after(429, new Headers({ 'ratelimit-reset': '3' })), 3);
  await assert.rejects(throttle.before(), /stop for now/);
  now += 3500;
  await throttle.before();
  assert.equal(await throttle.after(200, new Headers({ 'ratelimit-remaining': '0', 'ratelimit-reset': '2' })), 2);
  await assert.rejects(throttle.before(), /stop for now/);
  assert.equal(await throttle.after(200, new Headers({ 'ratelimit-remaining': '4', 'ratelimit-reset': '1' })), null);
});

test('a key is taken out of anything that could be printed', () => {
  const said = `Invalid key ${FULL}; the part after re_ is ${FULL.slice(3)}; someone else's re_abcdefgh12345678`;
  const clean = redact(said, FULL);
  assert.ok(!clean.includes(FULL.slice(3)));
  assert.ok(!clean.includes('abcdefgh12345678'));
  assert.match(clean, /\[redacted key\]/);
});
