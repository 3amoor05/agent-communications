import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { after, test } from 'node:test';
import { setFlagsFromString } from 'node:v8';
import { runInNewContext } from 'node:vm';
import { CommsError } from '@agentcomms/core';
import { TokenSource } from '../src/auth/session.ts';
import { GmailContext } from '../src/context.ts';
import { attachmentCeilingMs, type DownloadLimits, type DownloadPace } from '../src/gmail-api/download.ts';
import { GoogleGmailTransport } from '../src/gmail-api/transport.ts';
import { type DownloadQuestion, downloadAttachments } from '../src/operations/attachments.ts';
import type { FakeMessage } from './support/fake-google.ts';
import { type Harness, newHarness, tempDir } from './support/harness.ts';

/**
 * How long an attachment download may take: CUE-304.
 *
 * Nothing bounded it. `users.messages.attachments.get` went out with no timeout and no signal, so a connection Google
 * accepted and then stopped answering held the download — `gmail_attachment_download`, `agent-gmail attachments
 * download`, and the agent waiting on either — for as long as the socket stayed open. These run the real transport,
 * through the bundled Google libraries, against the fake Google made to go silent, or to answer a piece at a time;
 * every limit is made short, so each test takes a second or so rather than the half-minute a real one allows.
 */

const MIB = 1024 * 1024;
/** The attachment's own id, which Gmail makes long and which no error here needs: the part is named by its ids. */
const ATTACHMENT_ID = 'ANGjdJ8-attachment-id-that-gmail-makes-long';
const ATTACHMENT_PATH = `/gmail/v1/users/me/messages/m1/attachments/${ATTACHMENT_ID}`;
/** 1500 bytes of a file: its answer, base64 inside JSON, is a little over 2000 bytes, sent in twenty pieces. */
const CONTENT = 'invoice line\n'.repeat(116).slice(0, 1500);

function message(id: string, attachmentId: string, size: number): FakeMessage {
  return {
    id,
    threadId: id,
    labelIds: ['INBOX'],
    internalDate: String(Date.parse('2026-09-15T09:00:00Z')),
    payload: {
      partId: '',
      mimeType: 'multipart/mixed',
      headers: [
        { name: 'From', value: 'sam@partner.test' },
        { name: 'Subject', value: 'The invoice' },
      ],
      parts: [
        { partId: '0', mimeType: 'text/plain', body: { size: 2, data: Buffer.from('hi').toString('base64url') } },
        {
          partId: '1',
          mimeType: 'application/pdf',
          filename: `${id}.pdf`,
          headers: [{ name: 'Content-Disposition', value: `attachment; filename="${id}.pdf"` }],
          body: { size, attachmentId },
        },
      ],
    },
  };
}

/** A mailbox holding one attachment, signed in through the fake Google, as a transport would see it. */
async function mailbox(
  messages: Record<string, FakeMessage> = { m1: message('m1', ATTACHMENT_ID, CONTENT.length) },
  attachments: Record<string, string> = { [ATTACHMENT_ID]: CONTENT },
): Promise<Harness> {
  const harness = await newHarness({ accounts: [{ sub: 'sub-1', email: 'jo@example.test', messages, attachments }] });
  await harness.connectInbox({ alias: 'work', email: 'jo@example.test', sub: 'sub-1' });
  return harness;
}

/** The real transport for that mailbox, with the download limits a test gives it. */
async function transportOf(harness: Harness, download: Partial<DownloadLimits>): Promise<GoogleGmailTransport> {
  const config = await harness.core.config.load();
  const inbox = config.inboxes.work;
  const client = config.clients.default;
  if (!inbox || !client) throw new Error('the harness did not connect the mailbox');
  return new GoogleGmailTransport({
    tokens: new TokenSource({ core: harness.core, endpoints: harness.endpoints, inbox, client, alias: 'work' }),
    endpoints: harness.endpoints,
    retry: { sleep: async () => undefined },
    download,
  });
}

/** Asserts a download that ran out of time, saying which limit, and naming the part by its ids and nothing else. */
async function outOfTime(
  promise: Promise<unknown>,
  why: 'stalled' | 'too-slow' | 'cancelled',
  also: (error: CommsError) => void = () => undefined,
): Promise<void> {
  await assert.rejects(promise, (error: unknown) => {
    assert.ok(error instanceof CommsError, `not a CommsError: ${String(error)}`);
    assert.equal(error.code, 'TRANSIENT', error.message);
    assert.equal(error.details?.why, why, error.message);
    const printed = JSON.stringify({ message: error.message, hint: error.hint, details: error.details });
    // Not the attachment's long id, and not a byte of what it holds.
    for (const unwanted of [ATTACHMENT_ID, 'invoice line', Buffer.from(CONTENT).toString('base64url').slice(0, 24)]) {
      assert.ok(!printed.includes(unwanted), `the error quoted ${unwanted}`);
    }
    also(error);
    return true;
  });
}

/** How many times the attachment was asked for. */
function asked(harness: Harness, path = ATTACHMENT_PATH): number {
  return harness.google.requests.filter((request) => request.path === path).length;
}

/** No limit on the whole download that a test about silence could reach first. */
const UNHURRIED: DownloadPace = { floorMs: 60_000, bytesPerSecond: 128 * 1024 };
/** A pace that allows a file of a few bytes a fifth of a second, and one of 12,000 bytes over five. */
const TIGHT: DownloadPace = { floorMs: 200, bytesPerSecond: 3000 };

// ── Silence ────────────────────────────────────────────────────────────────────────────────────────────────────

test('an attachment Gmail never answers for is given up on once it has been silent for the limit', {
  timeout: 30_000,
}, async () => {
  const harness = await mailbox();
  const transport = await transportOf(harness, { idleMs: 500, pace: UNHURRIED });
  harness.google.slowNext(ATTACHMENT_PATH, { kind: 'silent' });
  const started = Date.now();
  await outOfTime(
    transport.getAttachment('m1', ATTACHMENT_ID, { partId: '1', size: CONTENT.length }),
    'stalled',
    (error) => {
      assert.equal(error.message, 'Gmail stopped sending attachment m1/1 for 0.5 seconds');
      assert.equal(error.hint, 'Check the network, then try again.');
      assert.deepEqual(error.details, { why: 'stalled', messageId: 'm1', partId: '1' });
    },
  );
  assert.ok(Date.now() - started < 20_000, 'the limit on silence did not bound the wait');
  // Not tried again: a second attempt would be another wait as long, and the person is told instead.
  assert.equal(asked(harness), 1);
});

test('an answer that stops part-way is given up on once it has been silent for the limit', {
  timeout: 30_000,
}, async () => {
  const harness = await mailbox();
  const transport = await transportOf(harness, { idleMs: 500, pace: UNHURRIED });
  harness.google.slowNext(ATTACHMENT_PATH, { kind: 'paced', pieces: 20, everyMs: 20, stallAfter: 3 });
  await outOfTime(
    transport.getAttachment('m1', ATTACHMENT_ID, { partId: '1', size: CONTENT.length }),
    'stalled',
    (error) => {
      assert.equal(error.message, 'Gmail stopped sending attachment m1/1 for 0.5 seconds');
    },
  );
  assert.equal(asked(harness), 1);
});

test('the limit on silence holds when garbage is collected while the answer stalls', { timeout: 30_000 }, async () => {
  /*
   * Slack's download found that a timeout handed to `fetch` alone could be lost when garbage was collected mid-stall,
   * and the read then waited for ever. Collection is forced here while the answer stalls, so a deadline that wakes the
   * download only through what `fetch` still holds fails this by name instead of hanging the file.
   */
  setFlagsFromString('--expose-gc');
  const collect = runInNewContext('gc') as () => void;
  const harness = await mailbox();
  const transport = await transportOf(harness, { idleMs: 500, pace: UNHURRIED });
  harness.google.slowNext(ATTACHMENT_PATH, { kind: 'paced', pieces: 20, everyMs: 20, stallAfter: 1 });
  const every = setInterval(collect, 50);
  try {
    await outOfTime(transport.getAttachment('m1', ATTACHMENT_ID, { partId: '1' }), 'stalled');
  } finally {
    clearInterval(every);
  }
});

test('a slow answer that keeps arriving is waited for, long past the limit on silence', {
  timeout: 30_000,
}, async () => {
  /*
   * Twenty pieces, three fortieths of a second apart: a second and a half in all, three times the silence allowed.
   * Silence is what is limited, and there never is any — every piece that arrives starts the limit again.
   */
  const harness = await mailbox();
  const transport = await transportOf(harness, { idleMs: 500, pace: UNHURRIED });
  harness.google.slowNext(ATTACHMENT_PATH, { kind: 'paced', pieces: 20, everyMs: 75 });
  const bytes = await transport.getAttachment('m1', ATTACHMENT_ID, { partId: '1', size: CONTENT.length });
  assert.equal(bytes.toString('utf8'), CONTENT);
});

test('a token being refreshed is not counted as Gmail going silent', { timeout: 30_000 }, async () => {
  /*
   * The first call on a transport refreshes its access token, and that can take a while: a secret store to read, a
   * keychain prompt a person is still answering, Google's token endpoint. None of it is Gmail going silent. Here the
   * token arrives in two pieces six tenths of a second apart, twice the silence the download allows, and the download
   * still arrives whole — the token is in hand before either limit starts.
   */
  const harness = await mailbox();
  const transport = await transportOf(harness, { idleMs: 300, pace: UNHURRIED });
  harness.google.slowNext('/token', { kind: 'paced', pieces: 2, everyMs: 600 });
  const bytes = await transport.getAttachment('m1', ATTACHMENT_ID, { partId: '1', size: CONTENT.length });
  assert.equal(bytes.toString('utf8'), CONTENT);
});

// ── The whole download, for its size ───────────────────────────────────────────────────────────────────────────

test('the time a whole attachment is allowed grows with its size: two minutes at least, 128 KiB a second on', () => {
  // Measured on the answer, which carries the file as base64: four bytes for every three of the file.
  assert.equal(attachmentCeilingMs(1 * MIB), 120_000);
  assert.equal(attachmentCeilingMs(15 * MIB), 160_000, 'fifteen MiB is twenty on the wire: 160 seconds');
  assert.equal(attachmentCeilingMs(25 * MIB), 266_667);
  // A size not known is the largest an attachment can be — Gmail takes a message of 50 MB at most — and never more.
  const largest = 533_334;
  for (const unknown of [undefined, 0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
    assert.equal(attachmentCeilingMs(unknown), largest, String(unknown));
  }
  assert.equal(attachmentCeilingMs(50 * MIB), largest);
  assert.equal(attachmentCeilingMs(1024 * MIB), largest, 'a size past the largest is the largest');
  // The pace is the caller's, so a test can make it short.
  assert.equal(attachmentCeilingMs(3, TIGHT), 200);
  assert.equal(attachmentCeilingMs(12_000, TIGHT), 5334);
});

test('an attachment that trickles is given up on once it has taken longer than its size allows', {
  timeout: 30_000,
}, async () => {
  /*
   * Twenty pieces, a twentieth of a second apart: never silent for long, and a second in all — five times the fifth of
   * a second a file Gmail says is ten bytes is allowed at this pace. The refusal says which limit it was, and what to
   * do that is not only trying again on the same connection.
   */
  const harness = await mailbox();
  const transport = await transportOf(harness, { idleMs: 400, pace: TIGHT });
  harness.google.slowNext(ATTACHMENT_PATH, { kind: 'paced', pieces: 20, everyMs: 50 });
  await outOfTime(transport.getAttachment('m1', ATTACHMENT_ID, { partId: '1', size: 10 }), 'too-slow', (error) => {
    assert.equal(
      error.message,
      'attachment m1/1 took longer to arrive than a file of its size is allowed (0.2 seconds)',
    );
    assert.match(error.hint ?? '', /faster connection|save it from there/);
    assert.deepEqual(error.details, { why: 'too-slow', messageId: 'm1', partId: '1' });
  });
});

test('the same trickle arrives whole when the attachment’s size allows it the time, or its size is not known', {
  timeout: 30_000,
}, async () => {
  const harness = await mailbox();
  const transport = await transportOf(harness, { idleMs: 400, pace: TIGHT });
  // 12,000 bytes are allowed over five seconds at this pace; the second the trickle takes is well inside it.
  harness.google.slowNext(ATTACHMENT_PATH, { kind: 'paced', pieces: 20, everyMs: 50 });
  const sized = await transport.getAttachment('m1', ATTACHMENT_ID, { partId: '1', size: 12_000 });
  assert.equal(sized.toString('utf8'), CONTENT);
  // With no size at all, the largest an attachment can be: never the floor, which would refuse a large file.
  harness.google.slowNext(ATTACHMENT_PATH, { kind: 'paced', pieces: 20, everyMs: 50 });
  const unsized = await transport.getAttachment('m1', ATTACHMENT_ID);
  assert.equal(unsized.toString('utf8'), CONTENT);
});

test('an attachment named by its message alone says so, when the caller had no part to name', {
  timeout: 30_000,
}, async () => {
  const harness = await mailbox();
  const transport = await transportOf(harness, { idleMs: 500, pace: UNHURRIED });
  harness.google.slowNext(ATTACHMENT_PATH, { kind: 'silent' });
  await outOfTime(transport.getAttachment('m1', ATTACHMENT_ID), 'stalled', (error) => {
    assert.equal(error.message, 'Gmail stopped sending an attachment of message m1 for 0.5 seconds');
    assert.deepEqual(error.details, { why: 'stalled', messageId: 'm1', partId: null });
  });
});

// ── The caller giving up ───────────────────────────────────────────────────────────────────────────────────────

test('a caller’s signal stops an attachment download, before it starts or while it waits', {
  timeout: 30_000,
}, async () => {
  const harness = await mailbox();
  const transport = await transportOf(harness, { idleMs: 60_000, pace: UNHURRIED });

  const early = new AbortController();
  early.abort();
  await outOfTime(
    transport.getAttachment('m1', ATTACHMENT_ID, { partId: '1', signal: early.signal }),
    'cancelled',
    (error) => {
      assert.equal(error.message, 'the download of attachment m1/1 was cancelled');
    },
  );

  harness.google.slowNext(ATTACHMENT_PATH, { kind: 'silent' });
  const late = new AbortController();
  setTimeout(() => late.abort(), 100);
  const started = Date.now();
  await outOfTime(transport.getAttachment('m1', ATTACHMENT_ID, { partId: '1', signal: late.signal }), 'cancelled');
  assert.ok(Date.now() - started < 20_000, 'the signal did not stop the wait');
});

// ── What else a streamed answer has to keep ────────────────────────────────────────────────────────────────────

test('Google’s refusals of an attachment keep their meaning: a rate limit is retried, a missing one is not found', {
  timeout: 30_000,
}, async () => {
  /*
   * The answer is read here, a piece at a time, rather than by the library — so a refusal is too, and it has to reach
   * the retry policy and the error mapping in the shape they read: its status, its `Retry-After`, and Google's reasons.
   * A 403 is retried only for the reason that says it is a rate limit.
   */
  const harness = await mailbox();
  const transport = await transportOf(harness, {});
  harness.google.failNext(ATTACHMENT_PATH, 1, 403, 'userRateLimitExceeded');
  harness.google.failNext(ATTACHMENT_PATH, 1, 429, 'rateLimitExceeded', '1');
  assert.equal((await transport.getAttachment('m1', ATTACHMENT_ID, { partId: '1' })).toString('utf8'), CONTENT);
  assert.equal(asked(harness), 3);

  const missing = '/gmail/v1/users/me/messages/m1/attachments/gone';
  await assert.rejects(transport.getAttachment('m1', 'gone', { partId: '1' }), (error: unknown) => {
    assert.ok(error instanceof CommsError);
    assert.equal(error.code, 'NOT_FOUND');
    assert.equal(error.message, 'Not Found');
    return true;
  });
  assert.equal(asked(harness, missing), 1);
});

test('an answer that is not the attachment is refused by name, never saved as an empty file', {
  timeout: 30_000,
}, async () => {
  // Read by the library, an answer that was not JSON became an attachment of no bytes, and the download said it saved.
  const garbage = createServer((_request, response) => {
    response.writeHead(200, { 'content-type': 'text/html' });
    response.end('<html>a proxy’s sign-in page</html>');
  });
  await new Promise<void>((resolve) => garbage.listen(0, '127.0.0.1', resolve));
  try {
    const harness = await mailbox();
    const real = await transportOf(harness, {});
    await real.getProfile();
    const config = await harness.core.config.load();
    const inbox = config.inboxes.work;
    const client = config.clients.default;
    if (!inbox || !client) throw new Error('the harness did not connect the mailbox');
    const transport = new GoogleGmailTransport({
      tokens: new TokenSource({ core: harness.core, endpoints: harness.endpoints, inbox, client, alias: 'work' }),
      endpoints: { ...harness.endpoints, gmailRoot: `http://127.0.0.1:${(garbage.address() as AddressInfo).port}` },
      retry: { sleep: async () => undefined },
    });
    await assert.rejects(transport.getAttachment('m1', ATTACHMENT_ID, { partId: '1' }), (error: unknown) => {
      assert.ok(error instanceof CommsError);
      assert.equal(error.code, 'PROVIDER_UNAVAILABLE');
      assert.equal(error.message, 'Gmail’s answer for attachment m1/1 was not the attachment');
      assert.ok(!JSON.stringify(error.details ?? {}).includes('sign-in'), 'the answer was quoted');
      return true;
    });
  } finally {
    garbage.closeAllConnections();
    await new Promise<void>((resolve) => garbage.close(() => resolve()));
  }
});

test('a finished download leaves no timer behind', { timeout: 30_000 }, async () => {
  /*
   * Both limits are timers that would keep a process alive for as long as they had left to run: thirty seconds after
   * a download from the terminal had finished, or two minutes and more. However a download ends, both are let go.
   */
  const harness = await mailbox();
  const transport = await transportOf(harness, {});
  const timers = (): number => process.getActiveResourcesInfo().filter((kind) => kind === 'Timeout').length;
  // Once first, so whatever the connection itself keeps is there before the count is taken.
  await transport.getAttachment('m1', ATTACHMENT_ID, { partId: '1' });
  const before = timers();
  await transport.getAttachment('m1', ATTACHMENT_ID, { partId: '1' });
  await assert.rejects(transport.getAttachment('m1', 'gone', { partId: '1' }));
  assert.ok(timers() <= before, `${timers() - before} timer(s) left running`);
});

// ── Through the download operation ─────────────────────────────────────────────────────────────────────────────

/** Two messages, one attachment each: a1 on m1, a2 on m2. What the second's metadata says it weighs is the test's. */
async function twoAttachments(download: Partial<DownloadLimits>, secondSize = CONTENT.length) {
  const harness = await mailbox(
    { m1: message('m1', 'a1', 5), m2: message('m2', 'a2', secondSize) },
    { a1: 'first', a2: CONTENT },
  );
  const cwd = tempDir('agent-gmail-cwd-');
  const home = tempDir('agent-gmail-home-');
  const context = new GmailContext({
    core: harness.core,
    env: { ...harness.env, HOME: home, USERPROFILE: home },
    cwd,
    createTransport: ({ resolved, client, context: own }) =>
      new GoogleGmailTransport({
        tokens: new TokenSource({
          core: own.core,
          endpoints: own.endpoints,
          inbox: resolved.inbox,
          client,
          alias: resolved.alias,
        }),
        endpoints: own.endpoints,
        retry: { sleep: async () => undefined },
        download,
      }),
  });
  const targets = [{ messageId: 'm1' }, { messageId: 'm2' }];
  const save = async (signal?: AbortSignal) => {
    const question = (await downloadAttachments(context, 'work', targets)) as DownloadQuestion;
    assert.equal(question.destinationRequired, true);
    return downloadAttachments(context, 'work', targets, { saveTo: 'current', choiceId: question.choiceId, signal });
  };
  return { harness, cwd, save };
}

test('a download that runs out of time stops there, keeps what it saved, and names the part and the limit', {
  timeout: 30_000,
}, async () => {
  const { harness, save } = await twoAttachments({ idleMs: 500, pace: UNHURRIED });
  harness.google.slowNext('/gmail/v1/users/me/messages/m2/attachments/a2', { kind: 'silent' });
  await assert.rejects(save(), (error: unknown) => {
    assert.ok(error instanceof CommsError);
    assert.equal(error.code, 'TRANSIENT');
    assert.equal(error.message, 'the download stopped part-way: Gmail stopped sending attachment m2/1 for 0.5 seconds');
    assert.match(error.hint ?? '', /^Check the network, then try again\. 1 file was saved before it stopped/);
    assert.equal(error.details?.why, 'stalled');
    assert.equal(error.details?.saved, 1);
    assert.deepEqual(error.details?.stoppedBefore, ['m2/1']);
    return true;
  });
});

test('a download allows each attachment the time the size Gmail gives it is worth', { timeout: 30_000 }, async () => {
  // Gmail says the second weighs ten bytes; it arrives as a second's trickle, five times what ten bytes are allowed.
  const { harness, save } = await twoAttachments({ idleMs: 400, pace: TIGHT }, 10);
  harness.google.slowNext('/gmail/v1/users/me/messages/m2/attachments/a2', { kind: 'paced', pieces: 20, everyMs: 50 });
  await assert.rejects(save(), (error: unknown) => {
    assert.ok(error instanceof CommsError);
    assert.equal(error.details?.why, 'too-slow', error.message);
    assert.match(error.message, /attachment m2\/1 took longer to arrive than a file of its size is allowed/);
    return true;
  });
});

test('a download stops when its caller gives up on it', { timeout: 30_000 }, async () => {
  const { harness, save } = await twoAttachments({ idleMs: 60_000, pace: UNHURRIED });
  const second = '/gmail/v1/users/me/messages/m2/attachments/a2';
  harness.google.slowNext(second, { kind: 'silent' });
  // The caller gives up once the second attachment has been asked for, and is waiting on a Gmail that says nothing.
  const caller = new AbortController();
  const watching = setInterval(() => {
    if (asked(harness, second) > 0) caller.abort();
  }, 20);
  after(() => clearInterval(watching));
  await assert.rejects(save(caller.signal), (error: unknown) => {
    assert.ok(error instanceof CommsError);
    assert.equal(error.details?.why, 'cancelled', error.message);
    assert.deepEqual(error.details?.stoppedBefore, ['m2/1']);
    return true;
  });
});
