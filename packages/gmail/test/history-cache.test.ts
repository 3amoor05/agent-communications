import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { TaintCollector, writeFileAtomic } from '@agentcomms/core';
import { GmailContext } from '../src/context.ts';
import type { ListOptions } from '../src/gmail-api/transport.ts';
import { createDraft } from '../src/operations/drafts.ts';
import { HISTORY_CACHE_CAP, HISTORY_CACHE_MS, HistoryCache } from '../src/operations/history-cache.ts';
import { taintExclusions } from '../src/operations/read.ts';
import { beginApproval, HISTORY_BUDGET, prepareSend } from '../src/operations/send.ts';
import type { FakeMessage } from './support/fake-google.ts';
import { type Harness, newHarness, tempDir } from './support/harness.ts';

/*
 * The shared history caches (CUE-404 Task 15; design 2026-10-05 §D4): what a prepare learned from Sent — each address's
 * prior-send answer, and the mailbox's correspondent domains — reused for ten minutes by the separate terminal-approval
 * process, under a lock and an atomic write, capped at 5,000 entries each; and never a reason to quiet a warning when a
 * file cannot be trusted or an observation could not be committed.
 */

const CHILD = fileURLToPath(new URL('./support/history-cache-child.ts', import.meta.url));
const MINUTE = 60_000;

/** A message in `work`'s Sent, newest first by `order`. */
function sentMessage(id: string, to: string, order: number): [string, FakeMessage] {
  return [
    id,
    {
      id,
      threadId: id,
      labelIds: ['SENT'],
      internalDate: String(1_790_000_000_000 - order * 1000),
      payload: { headers: [{ name: 'To', value: to }] },
    },
  ];
}

/** `work`, with `sent` in its Sent folder, and every context made here on one clock. */
async function world(sent: Array<[string, FakeMessage]> = []) {
  const harness: Harness = await newHarness({
    accounts: [
      {
        sub: 'sub-1',
        email: 'jo@example.test',
        sendAs: [{ sendAsEmail: 'jo@example.test', displayName: 'Jo', isDefault: true, isPrimary: true }],
        messages: Object.fromEntries(sent),
      },
      { sub: 'sub-2', email: 'kim@home.test' },
    ],
  });
  await harness.connectInbox({ alias: 'work', email: 'jo@example.test', sub: 'sub-1', sendPolicy: 'chat' });
  await harness.connectInbox({ alias: 'home', email: 'kim@home.test', sub: 'sub-2', sendPolicy: 'chat' });
  let at = Date.now();
  const now = () => new Date(at);
  /** A context of its own — its own transports and cache handle, as another process has: only the files are shared. */
  const process = () => new GmailContext({ core: harness.core, env: harness.env, now });
  const context = process();
  const workId = (await context.inbox('work')).inbox.id;
  return {
    harness,
    context,
    process,
    workId,
    clock: {
      advance: (ms: number) => {
        at += ms;
      },
      now,
    },
  };
}
type World = Awaited<ReturnType<typeof world>>;

/** Mail read in `home` naming these addresses, recorded as a read records it: tainted for a send from `work`. */
async function readInHome(setup: World, headers: string[]): Promise<void> {
  const { inbox } = await setup.context.inbox('home');
  const collector = new TaintCollector(inbox.id, 'm-home');
  collector.observeHeaders(headers);
  await collector.flush(setup.harness.core.taint, await taintExclusions(setup.context, 'home'));
}

async function draft(context: GmailContext, to: string[]): Promise<string> {
  return (await createDraft(context, 'work', { to, subject: 'Hello', text: 'Hi.', signature: false })).draftId;
}

/** Counts every Gmail history request — listings and metadata reads — a context's transport makes. */
async function counted(context: GmailContext, options: { failCorrespondentScan?: boolean } = {}) {
  const transport = await context.transport('work');
  const calls = { total: 0, history: 0, correspondents: 0 };
  let history = false;
  const list = transport.listMessages.bind(transport);
  transport.listMessages = async (request: ListOptions) => {
    calls.total += 1;
    history = request.query.startsWith('in:sent {');
    if (history) calls.history += 1;
    else {
      calls.correspondents += 1;
      if (options.failCorrespondentScan) throw new Error('the scan failed');
    }
    return list(request);
  };
  const metadata = transport.getMessageMetadata.bind(transport);
  transport.getMessageMetadata = async (messageId: string) => {
    calls.total += 1;
    if (history) calls.history += 1;
    else calls.correspondents += 1;
    return metadata(messageId);
  };
  return calls;
}

/** 250 sent messages to partner.test, so its correspondent scan is the full one: a listing and 200 reads. */
const PARTNER_SENT = Array.from({ length: 250 }, (_, index) =>
  sentMessage(`p${index}`, `c${index}@partner.test`, index),
);

/** 499 tainted recipients at vendor.test and one at a lookalike of partner.test: every cap is reached. */
const RECIPIENTS = [...Array.from({ length: 499 }, (_, index) => `r${index}@vendor.test`), 'sam@partners.test'];

// ── Prepare and terminal approval share their history work ──────────────────────────────────────────────────────

test('a prepare and the terminal approval of one draft within ten minutes make at most 401 history requests between them, and the cached domains still find the lookalike (D4-f)', async () => {
  const setup = await world(PARTNER_SENT);
  await readInHome(setup, ['someone@vendor.test']);
  const id = await draft(setup.context, RECIPIENTS);
  const preparing = await counted(setup.context);
  const prepared = await prepareSend(setup.context, 'work', id);
  assert.deepEqual([preparing.correspondents, preparing.history], [201, HISTORY_BUDGET]);
  assert.ok(prepared.riskFlags.includes('lookalike-domain'));

  // The terminal is another process: its own transport and its own handle on the cache files.
  setup.clock.advance(10 * MINUTE - 1);
  const terminal = setup.process();
  const approving = await counted(terminal);
  const prompt = await beginApproval(terminal, prepared.approvalId);
  assert.equal(approving.total, 0, 'everything the prepare observed was reused');
  assert.ok(preparing.total + approving.total <= 401);
  assert.match(prompt.preview, /LOOKS LIKE partner\.test/, 'the cached correspondent domains still find the lookalike');
  assert.match(prompt.preview, /prior-send history was not fully checked \(the 200-read budget was reached\)/);
});

test('a cached answer costs no budget: a second draft checks its new recipients with the whole of its own (D4-f)', async () => {
  const setup = await world();
  await readInHome(setup, ['someone@vendor.test']);
  const first = Array.from({ length: 150 }, (_, index) => `r${index}@vendor.test`);
  await prepareSend(setup.context, 'work', await draft(setup.context, first));
  const more = Array.from({ length: 150 }, (_, index) => `s${index}@vendor.test`);
  const second = setup.process();
  const calls = await counted(second);
  const prepared = await prepareSend(second, 'work', await draft(second, [...first, ...more]));
  assert.equal(calls.history, 150, 'one search for each new recipient, none for the 150 cached');
  assert.ok(prepared.taint.every((entry) => entry.historyCheck === 'not-written'));
});

test('once either cache has expired, at its ten-minute boundary, the next operation obeys that cap again on its own (D4-g)', async (t) => {
  for (const expired of ['both', 'correspondents', 'addresses'] as const) {
    await t.test(expired, async () => {
      const setup = await world(PARTNER_SENT);
      await readInHome(setup, ['someone@vendor.test']);
      const prepared = await prepareSend(setup.context, 'work', await draft(setup.context, RECIPIENTS));
      const cache = setup.context.historyCache;
      if (expired === 'both') setup.clock.advance(HISTORY_CACHE_MS);
      else {
        // One file's entries made stale at this moment — equality is stale — the other left fresh.
        setup.clock.advance(MINUTE);
        const path = expired === 'correspondents' ? cache.correspondentsPath : cache.addressesPath;
        const file = JSON.parse(readFileSync(path, 'utf8'));
        const field = expired === 'correspondents' ? 'mailboxes' : 'entries';
        for (const entry of Object.values(file[field]) as Array<{ expiresAt: string }>) {
          entry.expiresAt = setup.clock.now().toISOString();
        }
        writeFileSync(path, JSON.stringify(file));
      }
      const terminal = setup.process();
      const calls = await counted(terminal);
      await beginApproval(terminal, prepared.approvalId);
      assert.deepEqual(
        [calls.correspondents, calls.history],
        [expired === 'addresses' ? 0 : 201, expired === 'correspondents' ? 0 : HISTORY_BUDGET],
      );
    });
  }
});

// ── Capped, stale first ──────────────────────────────────────────────────────────────────────────────────────────

test('above 5,000 keys each cache stays at its cap, evicting the oldest by time and then key, after removing what has expired (D4-h)', async () => {
  const dir = tempDir('agent-gmail-history-');
  let at = Date.parse('2026-10-05T09:00:00.000Z');
  const cache = new HistoryCache(dir, { now: () => new Date(at) });
  const key = (index: number) => `k${String(index).padStart(5, '0')}@vendor.test`;
  const mailbox = (index: number) => `ibx_${String(index).padStart(16, '0')}`;
  const addressKeys = () =>
    Object.keys(JSON.parse(readFileSync(cache.addressesPath, 'utf8')).entries).map((entry) => entry.split(' ')[1]);
  const mailboxKeys = () => Object.keys(JSON.parse(readFileSync(cache.correspondentsPath, 'utf8')).mailboxes);

  await cache.recordAddresses(
    'ibx_AAAAAAAAAAAAAAAA',
    new Map(Array.from({ length: HISTORY_CACHE_CAP }, (_, index) => [key(index), 'not-written'] as const)),
  );
  // A full correspondent cache, as 5,000 mailboxes' scans at this moment would leave it.
  const observedAt = new Date(at).toISOString();
  const expiresAt = new Date(at + HISTORY_CACHE_MS).toISOString();
  writeFileSync(
    cache.correspondentsPath,
    JSON.stringify({
      version: 1,
      mailboxes: Object.fromEntries(
        Array.from({ length: HISTORY_CACHE_CAP }, (_, index) => [
          mailbox(index),
          { domains: ['a.test'], observedAt, expiresAt },
        ]),
      ),
    }),
  );
  assert.equal(addressKeys().length, HISTORY_CACHE_CAP);
  assert.equal(mailboxKeys().length, HISTORY_CACHE_CAP);

  // A minute on, three more: the three oldest go — all observed together, so the smallest keys.
  at += MINUTE;
  await cache.recordAddresses(
    'ibx_AAAAAAAAAAAAAAAA',
    new Map([90_001, 90_002, 90_003].map((index) => [key(index), 'written'] as const)),
  );
  for (const index of [90_001, 90_002, 90_003]) await cache.recordCorrespondents(mailbox(index), ['b.test']);
  const addresses = addressKeys();
  assert.equal(addresses.length, HISTORY_CACHE_CAP);
  for (const gone of [key(0), key(1), key(2)]) assert.ok(!addresses.includes(gone), `${gone} was kept`);
  assert.ok(addresses.includes(key(3)) && addresses.includes(key(90_003)));
  const mailboxes = mailboxKeys();
  assert.equal(mailboxes.length, HISTORY_CACHE_CAP);
  for (const gone of [mailbox(0), mailbox(1), mailbox(2)]) assert.ok(!mailboxes.includes(gone), `${gone} was kept`);

  // At the first batch's expiry, the next change removes all of it before anything else.
  at += HISTORY_CACHE_MS - MINUTE;
  await cache.recordAddresses('ibx_AAAAAAAAAAAAAAAA', new Map([[key(99_999), 'not-written']]));
  await cache.recordCorrespondents(mailbox(99_999), ['c.test']);
  assert.deepEqual(addressKeys().sort(), [key(90_001), key(90_002), key(90_003), key(99_999)]);
  assert.deepEqual(mailboxKeys().sort(), [mailbox(90_001), mailbox(90_002), mailbox(90_003), mailbox(99_999)]);
});

test('an expired entry is removed before anything is evicted, so a live one is never evicted in its place (D4-h)', async () => {
  const dir = tempDir('agent-gmail-history-');
  const t0 = Date.parse('2026-10-05T09:00:00.000Z');
  let at = t0;
  const cache = new HistoryCache(dir, { now: () => new Date(at), cap: 3 });
  // A long-lived entry observed first, and three later ones that have already expired: a file another writer left.
  const entry = (observed: number, expires: number) => ({
    result: 'not-written',
    observedAt: new Date(observed).toISOString(),
    expiresAt: new Date(expires).toISOString(),
  });
  mkdirSync(dirname(cache.addressesPath), { recursive: true });
  writeFileSync(
    cache.addressesPath,
    JSON.stringify({
      version: 1,
      entries: {
        'ibx_AAAAAAAAAAAAAAAA a@vendor.test': entry(t0, t0 + 60 * MINUTE),
        'ibx_AAAAAAAAAAAAAAAA b@vendor.test': entry(t0 + 5 * MINUTE, t0 + 6 * MINUTE),
        'ibx_AAAAAAAAAAAAAAAA c@vendor.test': entry(t0 + 5 * MINUTE, t0 + 6 * MINUTE),
        'ibx_AAAAAAAAAAAAAAAA d@vendor.test': entry(t0 + 5 * MINUTE, t0 + 6 * MINUTE),
      },
    }),
  );
  at = t0 + 20 * MINUTE;
  await cache.recordAddresses('ibx_AAAAAAAAAAAAAAAA', new Map([['e@vendor.test', 'written']]));
  assert.deepEqual(Object.keys(JSON.parse(readFileSync(cache.addressesPath, 'utf8')).entries).sort(), [
    'ibx_AAAAAAAAAAAAAAAA a@vendor.test',
    'ibx_AAAAAAAAAAAAAAAA e@vendor.test',
  ]);
});

// ── Never trusted when it cannot be ──────────────────────────────────────────────────────────────────────────────

test('a malformed or schema-invalid cache reads as empty: no cached written answer, a fresh correspondent scan, and a failed one keeps the escalation (D4-i)', async (t) => {
  const malformed: ReadonlyArray<[string, (workId: string) => string]> = [
    ['not JSON', () => '{"version":1,"entries":{'],
    // Saying `written` for this very address, beside an entry no release writes: none of it is believed.
    [
      'schema-invalid',
      (workId) =>
        JSON.stringify({
          version: 1,
          entries: {
            [`${workId} pay@vendor.test`]: {
              result: 'written',
              observedAt: new Date().toISOString(),
              expiresAt: new Date(Date.now() + HISTORY_CACHE_MS).toISOString(),
            },
            [`${workId} other@vendor.test`]: { result: 'written' },
          },
        }),
    ],
  ];
  for (const [name, contents] of malformed) {
    await t.test(`addresses: ${name}`, async () => {
      // Written to before, really — which a cache that cannot be trusted is no evidence of.
      const setup = await world([sentMessage('s-1', 'pay@vendor.test', 1)]);
      await readInHome(setup, ['pay@vendor.test']);
      mkdirSync(dirname(setup.context.historyCache.addressesPath), { recursive: true });
      writeFileSync(setup.context.historyCache.addressesPath, contents(setup.workId));
      const calls = await counted(setup.context);
      const prepared = await prepareSend(setup.context, 'work', await draft(setup.context, ['pay@vendor.test']));
      assert.equal(prepared.taint[0]?.historyCheck, 'cache-malformed');
      assert.ok(prepared.riskFlags.includes('recipient-tainted'), 'the escalation stays');
      assert.equal(calls.history, 0);
      assert.match(
        prepared.preview,
        /prior-send history could not be read from its cache; treated as not previously written\./,
      );
      // Replaced by a valid write, so the next operation checks for itself.
      assert.deepEqual(JSON.parse(readFileSync(setup.context.historyCache.addressesPath, 'utf8')), {
        version: 1,
        entries: {},
      });
      const next = await prepareSend(setup.context, 'work', await draft(setup.context, ['pay@vendor.test']));
      assert.deepEqual(next.taint, [], 'checked afresh, and written to before');
    });

    await t.test(`correspondents: ${name}`, async () => {
      const setup = await world(PARTNER_SENT);
      mkdirSync(dirname(setup.context.historyCache.correspondentsPath), { recursive: true });
      writeFileSync(
        setup.context.historyCache.correspondentsPath,
        contents(setup.workId).replace('entries', 'mailboxes'),
      );
      const calls = await counted(setup.context);
      const prepared = await prepareSend(setup.context, 'work', await draft(setup.context, ['sam@partners.test']));
      assert.equal(calls.correspondents, 201, 'scanned again');
      assert.ok(prepared.riskFlags.includes('lookalike-domain'));
      assert.equal(prepared.correspondentHistory, undefined);

      // And when the scan that would replace it fails too: no conclusion that there is no lookalike.
      writeFileSync(
        setup.context.historyCache.correspondentsPath,
        contents(setup.workId).replace('entries', 'mailboxes'),
      );
      const failing = setup.process();
      await counted(failing, { failCorrespondentScan: true });
      const doubtful = await prepareSend(failing, 'work', await draft(failing, ['sam@partners.test']));
      assert.equal(doubtful.correspondentHistory, 'cache-malformed');
      assert.ok(doubtful.riskFlags.includes('lookalike-unchecked'));
      assert.equal(doubtful.effectivePolicy, 'confirm');
      assert.match(doubtful.preview, /a lookalike recipient domain could not be ruled out/);
    });
  }
});

test('separate processes writing at once keep every entry, and evict in the same order whoever wrote first (D4-j)', async (t) => {
  const run = (dir: string, kind: string, from: number, count: number, at: string, cap: number) =>
    new Promise<void>((resolve, reject) => {
      const child = spawn(
        process.execPath,
        [
          '--experimental-strip-types',
          '--disable-warning=ExperimentalWarning',
          CHILD,
          dir,
          kind,
          String(from),
          String(count),
          at,
          String(cap),
        ],
        { stdio: ['ignore', 'ignore', 'pipe'] },
      );
      let errors = '';
      child.stderr.on('data', (chunk) => {
        errors += String(chunk);
      });
      child.on('error', reject);
      child.on('exit', (code) => (code === 0 ? resolve() : reject(new Error(`writer exited ${code}: ${errors}`))));
    });
  const at = '2026-10-05T09:00:00.000Z';
  const keysOf = (dir: string, kind: string) => {
    const cache = new HistoryCache(dir, { now: () => new Date(at) });
    const file = JSON.parse(
      readFileSync(kind === 'addresses' ? cache.addressesPath : cache.correspondentsPath, 'utf8'),
    );
    return Object.keys(kind === 'addresses' ? file.entries : file.mailboxes).sort();
  };
  for (const kind of ['addresses', 'correspondents'] as const) {
    await t.test(`${kind}: no update is lost`, async () => {
      const dir = tempDir('agent-gmail-history-');
      await Promise.all([0, 1, 2, 3].map((writer) => run(dir, kind, writer * 25, 25, at, HISTORY_CACHE_CAP)));
      assert.equal(keysOf(dir, kind).length, 100);
    });
    await t.test(`${kind}: the same survivors, in either order`, async () => {
      const survivors: string[][] = [];
      for (const order of [
        [0, 1, 2, 3],
        [3, 2, 1, 0],
      ]) {
        const dir = tempDir('agent-gmail-history-');
        await Promise.all(order.map((writer) => run(dir, kind, writer * 25, 25, at, 40)));
        survivors.push(keysOf(dir, kind));
      }
      assert.deepEqual(survivors[0], survivors[1]);
      // All observed at one time: the largest keys survive, entries 60 to 99.
      const expected = Array.from({ length: 40 }, (_, index) => {
        const name = `k${String(60 + index).padStart(5, '0')}`;
        return kind === 'addresses'
          ? `ibx_CHILDCHILDCHILD0 ${name}@vendor.test`
          : `ibx_${name.toUpperCase().padEnd(16, 'X')}`;
      });
      assert.deepEqual(survivors[0], expected.sort());
    });
  }
});

test('a write that fails before or around its rename leaves the old file or the new, never part of one, and its observation suppresses nothing (D4-k)', async (t) => {
  for (const when of ['before the rename', 'after the rename'] as const) {
    await t.test(when, async () => {
      // Written to before, and tainted: only a committed observation may suppress the escalation.
      const setup = await world([...PARTNER_SENT.slice(0, 3), sentMessage('s-1', 'pay@vendor.test', 9)]);
      await readInHome(setup, ['pay@vendor.test']);
      const before = await prepareSend(setup.context, 'work', await draft(setup.context, ['old@other.test']));
      assert.equal(before.taint.length, 0, 'old@other.test is not tainted');
      const cache = setup.context.historyCache;
      const old = readFileSync(cache.addressesPath, 'utf8');
      setup.clock.advance(HISTORY_CACHE_MS);
      const writer = setup.process();
      writer.historyCache = new HistoryCache(writer.core.paths.stateDir, {
        now: setup.clock.now,
        write: async (path, data) => {
          if (when === 'after the rename') await writeFileAtomic(path, data);
          throw new Error('the disk is full');
        },
      });
      const prepared = await prepareSend(writer, 'work', await draft(writer, ['pay@vendor.test', 'sam@partners.test']));
      assert.equal(prepared.taint[0]?.historyCheck, 'cache-write-failed');
      assert.ok(prepared.riskFlags.includes('recipient-tainted'), 'the uncommitted written suppressed nothing');
      assert.match(prepared.preview, /prior-send history was checked but could not be recorded/);
      assert.equal(prepared.correspondentHistory, 'cache-write-failed');
      assert.ok(prepared.riskFlags.includes('lookalike-unchecked'));
      // The next reader finds a whole file: the old one, or the new one.
      const now = readFileSync(cache.addressesPath, 'utf8');
      const parsed = JSON.parse(now) as { entries: Record<string, { result: string }> };
      if (when === 'before the rename') assert.equal(now, old);
      else assert.equal(parsed.entries[`${setup.workId} pay@vendor.test`]?.result, 'written');
    });
  }
});

test('a cache lock handed from holder to holder keeps a change waiting; one holder keeping it, or the overall limit, ends the wait (D4-j)', async (t) => {
  const at = '2026-10-05T09:00:00.000Z';
  // A holder of the lock as another process would be: alive, fresh, and known by its token.
  const hold = (lockPath: string, token: string) =>
    writeFileSync(lockPath, JSON.stringify({ pid: process.pid, at: new Date().toISOString(), token }));
  const record = (cache: HistoryCache) =>
    cache.recordAddresses('ibx_LOCKLOCKLOCKLOCK', new Map([['kept@vendor.test', 'not-written']]));
  const setup = (lockTimeoutMs: number, lockMaxWaitMs: number) => {
    const cache = new HistoryCache(tempDir('agent-gmail-history-'), {
      now: () => new Date(at),
      lockTimeoutMs,
      lockMaxWaitMs,
    });
    mkdirSync(cache.directory, { recursive: true });
    return { cache, lockPath: `${cache.addressesPath}.lock` };
  };

  await t.test(
    'handed on every 100 ms for three seconds, past a one-second timeout: the change waits, and lands',
    async () => {
      const { cache, lockPath } = setup(1000, 20_000);
      let turn = 0;
      hold(lockPath, `holder-${turn}`);
      const handing = setInterval(() => hold(lockPath, `holder-${++turn}`), 100);
      const change = record(cache);
      await new Promise((resolve) => setTimeout(resolve, 3000));
      clearInterval(handing);
      unlinkSync(lockPath);
      await change;
      const file = JSON.parse(readFileSync(cache.addressesPath, 'utf8'));
      assert.equal(Object.keys(file.entries).length, 1, 'the change landed once the lock was free');
      assert.ok(turn >= 20, `the lock changed hands ${turn} times while the change waited`);
    },
  );

  await t.test('kept by one holder past the timeout: the change gives up as a held lock', async () => {
    const { cache, lockPath } = setup(1000, 20_000);
    hold(lockPath, 'the-only-holder');
    try {
      await assert.rejects(record(cache), (error: unknown) => {
        assert.equal((error as { code?: unknown }).code, 'LOCK_TIMEOUT');
        assert.match(String((error as Error).message), /another agent-communications process is holding/);
        return true;
      });
    } finally {
      unlinkSync(lockPath);
    }
  });

  await t.test('handed on for ever: the overall limit ends the wait, busy rather than stuck', async () => {
    const { cache, lockPath } = setup(1000, 2000);
    let turn = 0;
    hold(lockPath, `holder-${turn}`);
    const handing = setInterval(() => hold(lockPath, `holder-${++turn}`), 100);
    try {
      await assert.rejects(record(cache), (error: unknown) => {
        assert.equal((error as { code?: unknown }).code, 'LOCK_TIMEOUT');
        assert.match(String((error as Error).message), /overall limit of 2 s/);
        return true;
      });
    } finally {
      clearInterval(handing);
      unlinkSync(lockPath);
    }
  });
});
