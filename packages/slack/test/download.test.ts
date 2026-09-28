import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';
import { setFlagsFromString } from 'node:v8';
import { runInNewContext } from 'node:vm';
import { gzipSync } from 'node:zlib';
import { CommsError } from '@agentcomms/core';
import { callSlack, type SlackCall } from '../src/api/call.ts';
import { checkedFileUrl, type SlackFileRequest, slackFileDownload } from '../src/api/download.ts';
import { closedPermit } from '../src/api/guard.ts';
import { type FakeSlack, type FileReply, startFakeSlack } from './support/fake-slack.ts';

/**
 * One file's bytes from `files.slack.com`: the transport under the download operation.
 *
 * Every request goes through the real guard to a loopback fake of both of Slack's hosts; nothing here reaches Slack.
 * What is tested is mostly about where the token goes. It rides to the files host, in the `Authorization` header,
 * for the one path of the file that was looked up — and to nowhere else: not to a link off Slack, not to another
 * part of Slack, not through a redirect, and not into any error.
 */

/** A placeholder-shaped value, so the repository's secret scan reads it as the fixture it is. */
const TOKEN = 'fake-user-token-3c9e07';
const TEAM = 'T0AAA1';
const FILE = 'F0BBB2';
/** The name somebody in the workspace gave the file. It must never appear in an error: it is theirs to choose. */
const NAME = 'quarterly-report.pdf';
const LINK = `https://files.slack.com/files-pri/${TEAM}-${FILE}/download/${NAME}`;
const PDF = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x37]);

let fakes: FakeSlack[] = [];
afterEach(async () => {
  const started = fakes;
  fakes = [];
  await Promise.all(started.map((fake) => fake.close()));
});

async function slack(reply?: FileReply): Promise<FakeSlack> {
  const fake = await startFakeSlack();
  fakes.push(fake);
  if (reply) fake.files[`${TEAM}-${FILE}`] = () => reply;
  return fake;
}

function context(fake: FakeSlack, extra: Partial<SlackCall> = {}): SlackCall {
  return { token: TOKEN, fetch: fake.fetch, ...extra };
}

function request(extra: Partial<SlackFileRequest> = {}): SlackFileRequest {
  return { url: LINK, teamId: TEAM, fileId: FILE, maxBytes: 1024 * 1024, ...extra };
}

/**
 * Asserts a refusal with the reason the download operation reports, and that it says nothing it should not: not the
 * token, and not the name of the file or the host of a link somebody else chose.
 */
async function refused(
  promise: Promise<unknown>,
  reason: string,
  also: (error: CommsError) => void = () => undefined,
): Promise<void> {
  await assert.rejects(promise, (error: unknown) => {
    assert.ok(error instanceof CommsError, `not a CommsError: ${String(error)}`);
    assert.equal(error.details?.reason, reason, error.message);
    const printed = JSON.stringify({ message: error.message, hint: error.hint, details: error.details });
    for (const secret of [TOKEN, NAME, 'attacker', 'docs.google']) {
      assert.doesNotMatch(printed, new RegExp(secret), `the refusal quoted ${secret}`);
    }
    also(error);
    return true;
  });
}

// ── What goes out, and where ──────────────────────────────────────────────────────────────────────────────────

test('a file comes back with its bytes and type, fetched with the token from the files host alone', async () => {
  const fake = await slack({ body: PDF, headers: { 'content-type': 'Application/PDF; charset=binary' } });
  fake.script['files.info'] = () => ({
    ok: true,
    file: { id: FILE, name: NAME, url_private_download: `${LINK}?origin_team=${TEAM}` },
  });

  // As the operation will: look the file up, then fetch the link Slack gave.
  const call = context(fake);
  const info = (await callSlack(call, 'files.info', { file: FILE })).file as { url_private_download: string };
  const body = await slackFileDownload(call, request({ url: info.url_private_download }));

  assert.deepEqual([...body.bytes], [...PDF]);
  assert.equal(body.contentType, 'application/pdf', 'the media type alone, lower-cased');
  assert.deepEqual(
    fake.requests.map((seen) => [seen.host, seen.verb, seen.method || seen.path]),
    [
      ['api', 'POST', 'files.info'],
      ['files', 'GET', `/files-pri/${TEAM}-${FILE}/download/${NAME}`],
    ],
  );
  // The token rode on both, in the header Slack documents, and on nothing else that arrived.
  for (const seen of fake.requests) assert.equal(seen.authorization, `Bearer ${TOKEN}`, seen.host);
  const download = fake.requests[1];
  // Rebuilt from the checked path: the query in Slack's link did not travel.
  assert.equal(download?.url, `/files/files-pri/${TEAM}-${FILE}/download/${NAME}`);
  assert.doesNotMatch(download?.raw ?? '', /cookie/i);
});

test('url_private is fetched as well as url_private_download', async () => {
  const fake = await slack({ body: PDF });
  const body = await slackFileDownload(
    context(fake),
    request({ url: `https://files.slack.com/files-pri/${TEAM}-${FILE}/${NAME}` }),
  );
  assert.equal(body.bytes.byteLength, PDF.byteLength);
  assert.equal(body.contentType, 'application/octet-stream');
  assert.deepEqual(
    fake.requests.map((seen) => seen.path),
    [`/files-pri/${TEAM}-${FILE}/${NAME}`],
  );
});

test('the link is rebuilt from the checked path: no query, no fragment, the files origin', () => {
  const url = checkedFileUrl({ url: `${LINK}?pub_secret=abc&t=xyz#page=2`, teamId: TEAM, fileId: FILE });
  assert.equal(url.href, LINK);
  assert.equal(url.origin, 'https://files.slack.com');
});

// ── Links that are refused before any request exists ─────────────────────────────────────────────────────────

test('a link off Slack is refused as external, and the token goes nowhere', async () => {
  const fake = await slack({ body: PDF });
  for (const url of [
    'https://docs.google.com/document/d/abc/edit',
    `https://evil.example/files-pri/${TEAM}-${FILE}/download/${NAME}`,
    // Starts with the right characters, and is somebody else's site.
    `https://files.slack.com.attacker.net/files-pri/${TEAM}-${FILE}/download/${NAME}`,
    `http://127.0.0.1:9/files-pri/${TEAM}-${FILE}/download/${NAME}`,
  ]) {
    await refused(slackFileDownload(context(fake), request({ url })), 'external', (error) => {
      assert.match(error.message, /kept outside Slack/, url);
    });
  }
  assert.deepEqual(fake.requests, []);
});

test('a link to the wrong part of Slack is refused as wrong-host', async () => {
  const fake = await slack({ body: PDF });
  for (const url of [
    `http://files.slack.com/files-pri/${TEAM}-${FILE}/download/${NAME}`,
    `https://files.slack.com:8443/files-pri/${TEAM}-${FILE}/download/${NAME}`,
    `https://slack.com/files-pri/${TEAM}-${FILE}/download/${NAME}`,
    `https://files-edge.slack.com/files-pri/${TEAM}-${FILE}/download/${NAME}`,
    `https://someone@files.slack.com/files-pri/${TEAM}-${FILE}/download/${NAME}`,
    `https://someone:pw@files.slack.com/files-pri/${TEAM}-${FILE}/download/${NAME}`,
    'not a link at all',
  ]) {
    await refused(slackFileDownload(context(fake), request({ url })), 'wrong-host');
  }
  assert.deepEqual(fake.requests, []);
});

test('a link that names another file, or no file, is refused as wrong-path', async () => {
  const fake = await slack({ body: PDF });
  const at = (path: string): string => `https://files.slack.com${path}`;
  for (const url of [
    at(`/files-pri/T0ZZZ9-${FILE}/download/${NAME}`),
    at(`/files-pri/${TEAM}-F0ZZZ9/download/${NAME}`),
    at(`/files-tmb/${TEAM}-${FILE}-abc123/${NAME}`),
    at(`/files-pri/${TEAM}-${FILE}/download/..%2F..%2Fapi%2Fauth.test`),
    at(`/files-pri/${TEAM}-${FILE}/`),
    at('/api/auth.test'),
  ]) {
    /*
     * Refused here, by the check on Slack's link, and not left to the guard — which would refuse it too, but as a
     * request that should never have been built. The message says which of the two did it.
     */
    await refused(slackFileDownload(context(fake), request({ url })), 'wrong-path', (error) => {
      assert.match(error.message, /does not name the file that was looked up/, url);
    });
  }
  // The right link, for a request that names another file.
  await refused(slackFileDownload(context(fake), request({ fileId: 'F0CCC3' })), 'wrong-path');
  await refused(slackFileDownload(context(fake), request({ teamId: 'T0ZZZ9' })), 'wrong-path');
  assert.deepEqual(fake.requests, []);
});

// ── Answers that are refused ──────────────────────────────────────────────────────────────────────────────────

test('a redirect is refused, and the token never reaches where it pointed', async () => {
  const fake = await slack();
  fake.files[`${TEAM}-${FILE}`] = () => ({ status: 302, headers: { location: `${fake.local}/elsewhere` } });
  await refused(slackFileDownload(context(fake), request()), 'redirect', (error) => {
    assert.match(error.message, /never followed/);
  });
  assert.deepEqual(
    fake.requests.map((seen) => seen.host),
    ['files'],
    'the redirect was followed',
  );
});

test('an inner fetch that hands back a redirect, or followed one, is refused all the same', async () => {
  /*
   * The guard tells `fetch` to treat a redirect as an error, and the real one does. An inner fetch that answers the
   * 30x instead, or one that followed it regardless, still does not get its answer taken as the file.
   */
  const answers: (() => Response)[] = [
    () => new Response(null, { status: 302, headers: { location: 'http://127.0.0.1:9/elsewhere' } }),
    () => new Response(null, { status: 307, headers: { location: 'http://127.0.0.1:9/elsewhere' } }),
    () => Object.defineProperty(new Response(PDF), 'redirected', { value: true }),
  ];
  for (const answer of answers) {
    await refused(slackFileDownload({ token: TOKEN, fetch: async () => answer() }, request()), 'redirect');
  }
});

test('Slack’s sign-in page is refused as one: the token cannot read this file', async () => {
  for (const type of ['text/html; charset=utf-8', 'TEXT/HTML', 'text/html']) {
    const fake = await slack({ body: '<!DOCTYPE html><title>Sign in</title>', headers: { 'content-type': type } });
    await refused(slackFileDownload(context(fake), request()), 'sign-in-page', (error) => {
      assert.equal(error.code, 'SCOPE_MISSING');
      assert.match(error.message, /the token cannot read it/);
    });
  }
});

test('an HTTP failure says its status, and is coded by what can be done about it', async () => {
  const cases: [number, string][] = [
    [404, 'NOT_FOUND'],
    [403, 'SCOPE_MISSING'],
    [429, 'TRANSIENT'],
    [503, 'TRANSIENT'],
    [418, 'PROVIDER_UNAVAILABLE'],
  ];
  for (const [status, code] of cases) {
    const fake = await slack({ status, body: 'no' });
    await refused(slackFileDownload(context(fake), request()), 'http-error', (error) => {
      assert.equal(error.details?.status, status);
      assert.equal(error.code, code, String(status));
    });
  }
  // A file the host has no answer for at all.
  const fake = await slack();
  await refused(slackFileDownload(context(fake), request()), 'http-error', (error) => {
    assert.equal(error.details?.status, 404);
  });
});

// ── Size ──────────────────────────────────────────────────────────────────────────────────────────────────────

test('a declared length over the cap is refused before any of the body is read', async () => {
  // The host declares a gigabyte and sends one byte. Waiting for the rest would time out; the declaration is enough.
  const fake = await slack({ stall: true, headers: { 'content-length': String(1024 * 1024 * 1024) } });
  await refused(
    slackFileDownload(context(fake, { timeoutMs: 5_000 }), request({ maxBytes: 1000 })),
    'too-large',
    (error) => {
      assert.equal(error.details?.maxBytes, 1000);
    },
  );
});

test('an answer with no declared length is counted as it arrives, and stopped at the cap', async () => {
  const chunk = new Uint8Array(64 * 1024);
  const fake = await slack({ chunks: Array.from({ length: 16 }, () => chunk) });
  await refused(slackFileDownload(context(fake), request({ maxBytes: 100_000 })), 'too-large');

  // Exactly the cap is not over it.
  const exact = await slack({ chunks: [chunk, chunk] });
  const body = await slackFileDownload(context(exact), request({ maxBytes: 2 * chunk.byteLength }));
  assert.equal(body.bytes.byteLength, 2 * chunk.byteLength);
});

test('a compressed answer is counted by what it decodes to, not by what it declared', async () => {
  // Two megabytes of zeros compress to a couple of kilobytes, so the declared length passes and the bytes do not.
  const packed = gzipSync(new Uint8Array(2 * 1024 * 1024));
  assert.ok(packed.byteLength < 64 * 1024);
  const fake = await slack({ body: packed, headers: { 'content-encoding': 'gzip' } });
  await refused(slackFileDownload(context(fake), request({ maxBytes: 1024 * 1024 })), 'too-large');
});

test('no single file is read past 100 MiB, whatever cap is passed in', async () => {
  const ceiling = 100 * 1024 * 1024;
  const fake = await slack({ stall: true, headers: { 'content-length': String(ceiling + 1) } });
  await refused(
    slackFileDownload(context(fake, { timeoutMs: 5_000 }), request({ maxBytes: 10 * ceiling })),
    'too-large',
    (error) => assert.equal(error.details?.maxBytes, ceiling),
  );
});

test('a cap that is not a number allows nothing, rather than everything', async () => {
  for (const maxBytes of [Number.NaN, -1, Number.NEGATIVE_INFINITY, Number.POSITIVE_INFINITY]) {
    const fake = await slack({ body: PDF });
    await refused(slackFileDownload(context(fake), request({ maxBytes })), 'too-large', (error) => {
      assert.equal(error.details?.maxBytes, 0, String(maxBytes));
    });
  }
  // And an empty file fits a cap of nothing.
  const empty = await slack({ body: new Uint8Array() });
  assert.equal((await slackFileDownload(context(empty), request({ maxBytes: 0 }))).bytes.byteLength, 0);
});

// ── The network ───────────────────────────────────────────────────────────────────────────────────────────────

test('a dropped connection is a network failure', async () => {
  const fake = await slack({ drop: true });
  await refused(slackFileDownload(context(fake), request()), 'network', (error) => {
    assert.equal(error.code, 'TRANSIENT');
  });
});

test('a host that stops sending is given up on when the time runs out', { timeout: 30_000 }, async () => {
  const fake = await slack({ stall: true });
  const started = Date.now();
  await refused(slackFileDownload(context(fake, { timeoutMs: 300 }), request()), 'network', (error) => {
    assert.match(error.message, /took longer than it is allowed/);
  });
  assert.ok(Date.now() - started < 20_000, 'the timeout did not bound the body');
});

test('the time limit holds even when garbage is collected while the body stalls', { timeout: 30_000 }, async () => {
  /*
   * The first version handed a timeout signal to `fetch` and trusted `fetch` to fail the read — Resend's shape. With
   * garbage collection running mid-stall the abort no longer reached the waiting read, and the download waited until
   * the test runner gave up two minutes later. Collection is forced here while the body stalls, so a deadline that
   * wakes the download only through `fetch` fails this by name instead of hanging the file.
   */
  setFlagsFromString('--expose-gc');
  const collect = runInNewContext('gc') as () => void;
  const fake = await slack({ stall: true, headers: { 'content-length': '1000' } });
  const every = setInterval(collect, 50);
  try {
    await refused(slackFileDownload(context(fake, { timeoutMs: 1_000 }), request()), 'network', (error) => {
      assert.match(error.message, /took longer than it is allowed/);
    });
  } finally {
    clearInterval(every);
  }
});

test('a caller’s signal stops a download too', async () => {
  const fake = await slack({ body: PDF });
  const controller = new AbortController();
  controller.abort();
  await refused(slackFileDownload(context(fake, { signal: controller.signal }), request()), 'network');
});

test('a download opens its grant on a permit of its own, and leaves the context’s alone', async () => {
  /*
   * The context is the one reads go out on, and its permit can be open for something else — a post the gate is about
   * to send. A download is a read: it is not refused because that permit is open, and it neither spends nor closes
   * it. Opened on the context's permit, the grant would be refused as nesting inside the post's.
   */
  const fake = await slack({ body: PDF });
  const open = { ...closedPermit(), approvalId: 'ap_1', method: 'chat.postMessage' };
  const shared = context(fake, { permit: open });
  const both = await Promise.all([slackFileDownload(shared, request()), slackFileDownload(shared, request())]);
  assert.deepEqual(
    both.map((body) => body.bytes.byteLength),
    [PDF.byteLength, PDF.byteLength],
  );
  assert.deepEqual(
    open,
    { ...closedPermit(), approvalId: 'ap_1', method: 'chat.postMessage' },
    'the post’s permit moved',
  );
});
