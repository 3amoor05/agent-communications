import assert from 'node:assert/strict';
import { mkdirSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { afterEach, test } from 'node:test';
import { CommsError } from '@agentcomms/core';
import { redact } from '../src/api/client.ts';
import { Throttle } from '../src/api/throttle.ts';
import { ResendContext } from '../src/context.ts';
import { listDomains, listSentEmails } from '../src/operations/read.ts';
import { FULL, type Harness, newHarness, tempDir } from './support/harness.ts';

/**
 * The team's production mail shares Resend's 10 requests a second with this tool. So: at most two a second from this
 * machine, counted across processes and accounts; and a 429 stops everything until Resend says, with nothing retried.
 */

let harness: Harness | undefined;
afterEach(async () => {
  await harness?.close();
  harness = undefined;
});

test('requests are spaced at least 500 ms apart, across every throttle sharing the state directory', async () => {
  const state = tempDir('agent-resend-throttle-');
  let now = 1_000_000;
  const waits: number[] = [];
  const clock = { now: () => now, sleep: async (ms: number) => void waits.push(ms) };
  const one = new Throttle(state, clock);
  const two = new Throttle(state, clock);
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

/**
 * Resend's budget belongs to the team, and its API names no team: six keys of one team, connected under six account
 * names, are six accounts here and one budget there. So there is one budget on this machine, whichever account asks.
 */
const TEAM = ['alpha', 'bravo', 'charlie', 'delta', 'echo', 'foxtrot'].map((org, index) => ({
  name: `${org}/resend`,
  key: `re_fake${org}_${index}0123456789abcdef`,
}));

async function sixAccounts(): Promise<Harness> {
  const opened = await newHarness();
  for (const { name, key } of TEAM) {
    opened.fake.keys.set(key, { permission: 'full_access' });
    await opened.addAccount({ name, key });
  }
  return opened;
}

test('six accounts asking at once share one budget: two requests a second from this machine, in all', async () => {
  harness = await sixAccounts();
  const now = 3_000_000;
  const slots: number[] = [];
  // One context per account, as six servers each pinned to one would be, all on this machine's state directory. The
  // clock stands still, so each request's wait is exactly how far after the first its slot was reserved.
  const contexts = TEAM.map(
    () =>
      new ResendContext({
        core: harness?.core,
        env: harness?.env,
        fetch: harness?.fake.fetch,
        throttle: { now: () => now, sleep: async (ms: number) => void slots.push(ms) },
      }),
  );
  const results = await Promise.all(TEAM.map(({ name }, index) => listDomains(contexts[index] as ResendContext, name)));
  assert.ok(results.every((result) => result.available));
  assert.equal(harness.fake.requests.length, 6);
  const reserved = [0, ...slots].sort((a, b) => a - b);
  assert.deepEqual(reserved, [0, 500, 1000, 1500, 2000, 2500], 'one queue, 500 ms apart, whichever account asked');
  for (const start of reserved) {
    const inOneSecond = reserved.filter((slot) => slot >= start && slot < start + 1000).length;
    assert.ok(inOneSecond <= 2, `${inOneSecond} requests in the second from ${start} ms`);
  }
});

/**
 * Stands in for other callers ahead in line on the throttle's lock: a new holder's token in it every 50 ms, never
 * leaving it free in between, until `stop`. Renamed into place, so a waiter never reads half a body.
 */
function lineAhead(throttle: Throttle): { stop: () => void } {
  const lock = `${throttle.path}.lock`;
  mkdirSync(dirname(lock), { recursive: true, mode: 0o700 });
  let holders = 0;
  const handOn = () => {
    holders += 1;
    writeFileSync(`${lock}.next`, JSON.stringify({ pid: 1, at: new Date().toISOString(), token: `holder-${holders}` }));
    renameSync(`${lock}.next`, lock);
  };
  handOn();
  const timer = setInterval(handOn, 50);
  return {
    stop: () => {
      clearInterval(timer);
      rmSync(lock, { force: true });
    },
  };
}

test('a reservation, and a stop Resend asked for, wait out a line on the lock for as long as it keeps moving', async () => {
  /*
   * Every Resend request on this machine takes the throttle's one lock, so six accounts asking at once are a line of
   * six on it. The lock's timeout used to count from when each caller began to wait, so the test above, on a machine
   * at a load of 97, refused the last of the six with "another process is holding" while the lock was being handed
   * on as it should be. Scaled down: a line lasting a second and a half, against one second for each holder.
   */
  const now = 7_000_000;
  const waits: number[] = [];
  const options = { now: () => now, sleep: async (ms: number) => void waits.push(ms), lockTimeoutMs: 1_000 };
  const reserving = new Throttle(tempDir('agent-resend-throttle-'), options);
  const stopping = new Throttle(tempDir('agent-resend-throttle-'), options);
  const lines = [lineAhead(reserving), lineAhead(stopping)];
  const ended = setTimeout(() => {
    for (const line of lines) line.stop();
  }, 1_500);
  try {
    const [reserved, stopped] = await Promise.allSettled([
      reserving.before(),
      stopping.after(429, new Headers({ 'retry-after': '60' })),
    ]);
    assert.equal(
      reserved.status,
      'fulfilled',
      `refused in the line: ${String((reserved as PromiseRejectedResult).reason)}`,
    );
    assert.equal(
      stopped.status,
      'fulfilled',
      `refused in the line: ${String((stopped as PromiseRejectedResult).reason)}`,
    );
    assert.equal(stopped.value, 60);
    assert.ok(await stopping.blockedUntil(), 'the stop was recorded, so every other account is held by it too');
    await reserving.before();
    assert.deepEqual(waits, [500], 'and the reservation was recorded: the next request waits its 500 ms');
  } finally {
    clearTimeout(ended);
    for (const line of lines) line.stop();
  }
});

test('a 429 through one account holds every account until the time Resend gave', async () => {
  harness = await sixAccounts();
  let now = Date.now();
  // One context per account again: the hold has to reach servers that never saw the 429.
  const contextFor = () =>
    new ResendContext({
      core: harness?.core,
      env: harness?.env,
      fetch: harness?.fake.fetch,
      throttle: { intervalMs: 0, now: () => now, sleep: async () => undefined },
    });
  const [first, ...others] = TEAM;
  harness.fake.intercept = () => ({
    status: 429,
    body: { name: 'rate_limit_exceeded', message: 'Too many requests' },
    headers: { 'retry-after': '7' },
  });
  await assert.rejects(listDomains(contextFor(), String(first?.name)), /rate-limiting/);
  harness.fake.intercept = null;
  for (const { name } of others) {
    await assert.rejects(listSentEmails(contextFor(), name), /asked this machine to stop/, name);
  }
  assert.equal(harness.fake.requests.length, 1, 'no other account reached Resend while it was held');
  now += 8000;
  for (const { name } of others) assert.equal((await listDomains(contextFor(), name)).available, true);
  assert.equal(harness.fake.requests.length, 6);
});

test('a request waiting for its slot does not leave once a 429 has arrived while it waited', async () => {
  const state = tempDir('agent-resend-throttle-');
  let now = 1_000_000;
  // The first request goes at once and is answered 429, retry-after 60 — while the second sleeps 500 ms behind it.
  const first = new Throttle(state, { now: () => now, sleep: async () => undefined });
  const second = new Throttle(state, {
    now: () => now,
    sleep: async (ms) => {
      await first.after(429, new Headers({ 'retry-after': '60' }));
      now += ms;
    },
  });
  await first.before();
  await assert.rejects(second.before(), (error: unknown) => {
    assert.ok(error instanceof CommsError);
    assert.equal(error.code, 'TRANSIENT');
    assert.equal(error.details?.retryAfterSeconds, 60);
    return true;
  });
  now += 61_000;
  await second.before();
});

test('without retry-after, ratelimit-reset decides; and a reply saying none are left stops the next one', async () => {
  const state = tempDir('agent-resend-throttle-');
  let now = 5_000_000;
  const throttle = new Throttle(state, { now: () => now, sleep: async () => undefined, intervalMs: 0 });
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

test('a key Resend echoes in an error’s `name` is taken out too, not only in its `message`', async () => {
  harness = await newHarness();
  await harness.addAccount({ name: 'acme/resend' });
  harness.fake.intercept = (request) =>
    request.path === '/domains'
      ? { status: 400, body: { name: `bad_${FULL}`, message: `the key ${FULL} is odd` } }
      : undefined;
  const failure = await listDomains(harness.context(), 'acme/resend').then(
    () => assert.fail('it should have failed'),
    (error: unknown) => error,
  );
  assert.ok(failure instanceof CommsError);
  const printed = JSON.stringify({ message: failure.message, hint: failure.hint, details: failure.details });
  assert.ok(!printed.includes(FULL.slice(3)), printed);
  const { call, close } = await harness.mcp();
  try {
    const tool = await call('resend_domains', { account: 'acme/resend' });
    assert.equal(tool.isError, true);
    assert.ok(!JSON.stringify(tool).includes(FULL.slice(3)), 'nor over MCP');
  } finally {
    await close();
  }
});
