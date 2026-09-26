import assert from 'node:assert/strict';
import { test } from 'node:test';
import { CommsError } from '@agentcomms/core';
import { APPROVAL_TAG, closedPermit, guardResendRequests, spendOn } from '../src/api/guard.ts';
import { REFUSED, ROUTES, routesOfKind } from '../src/api/routes.ts';

/**
 * The one door every Resend request goes through: two fixed origins, a closed route table, writes behind a one-shot
 * permit, the key never sent to the CDN, and no redirects.
 */

const API = 'https://api.resend.com';
const CDN = 'https://inbound-cdn.resend.com';
const ID = '4ef9a417-02e9-4d39-ad75-9611e0fcc33c';
const OTHER = '3a9f8c2b-1e5d-4f8a-9c7b-2d6e5f8a9c7b';
const APPROVAL = 'ap_0123456789ABCDEFGHJKMNPQRS';

/** A fetch that records what reached it, so "was it refused" and "did it go out" are different questions. */
function recorder() {
  const calls: { url: string; init: RequestInit | undefined }[] = [];
  const inner = async (input: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: typeof input === 'string' ? input : input instanceof URL ? input.href : input.url, init });
    return new Response('{}');
  };
  return { calls, inner };
}

const sendBody = (approvalId: string) => JSON.stringify({ tags: [{ name: APPROVAL_TAG, value: approvalId }] });
const sendInit = (approvalId: string): RequestInit => ({
  method: 'POST',
  headers: { 'idempotency-key': approvalId },
  body: sendBody(approvalId),
});

function refusedWith(pattern: RegExp) {
  return (error: unknown) => {
    assert.ok(error instanceof CommsError, String(error));
    assert.equal(error.code, 'SEND_REFUSED');
    assert.match(error.message, pattern);
    return true;
  };
}

test('a read goes out; a write without a permit does not', async () => {
  const { calls, inner } = recorder();
  const fetch = guardResendRequests(inner, closedPermit());
  await fetch(`${API}/domains`);
  assert.equal(calls.length, 1);
  await assert.rejects(fetch(`${API}/emails`, sendInit(APPROVAL)), refusedWith(/no permit is open/));
  await assert.rejects(fetch(`${API}/emails/${ID}/cancel`, { method: 'POST' }), refusedWith(/no permit is open/));
  assert.equal(calls.length, 1, 'the refused writes never reached fetch');
});

test('only the two Resend origins are reachable — not a look-alike, another scheme, another port, or credentials', async () => {
  const { calls, inner } = recorder();
  const fetch = guardResendRequests(inner, closedPermit());
  for (const url of [
    'https://api.resend.com.attacker.test/domains',
    'https://attacker.test/domains',
    'http://api.resend.com/domains',
    'https://api.resend.com:8443/domains',
    'https://user:pass@api.resend.com/domains',
    'https://resend.com/api/domains',
    'https://outbound-cdn.resend.com/x/attachments/y',
    'not a url',
  ]) {
    await assert.rejects(
      fetch(url),
      (error: unknown) => error instanceof CommsError && error.code === 'SEND_REFUSED',
      url,
    );
  }
  assert.equal(calls.length, 0);
});

test('no route outside the table is reachable, and the tempting ones say why', async () => {
  const { calls, inner } = recorder();
  const permit = closedPermit();
  const fetch = guardResendRequests(inner, permit);
  const attempts: [string, string][] = [
    ['POST', '/emails/batch'],
    ['PATCH', `/emails/${ID}`],
    ['POST', `/emails/${ID}/share`],
    ['POST', '/broadcasts'],
    ['POST', `/broadcasts/${ID}/send`],
    ['GET', '/api-keys'],
    ['POST', '/api-keys'],
    ['DELETE', `/api-keys/${ID}`],
    ['POST', '/events/send'],
    ['POST', '/webhooks'],
    ['DELETE', `/domains/${ID}`],
    ['POST', '/domains'],
    ['POST', `/domains/${ID}/verify`],
    ['GET', '/contacts'],
    ['POST', '/contacts'],
    ['POST', '/suppressions'],
    ['DELETE', `/suppressions/${ID}`],
    ['GET', '/logs'],
    ['GET', `/emails/${ID}/attachments`],
    ['GET', '/emails/not-an-id'],
    ['GET', `/emails/${ID}/../../api-keys`],
    ['GET', '/emails/receiving/%2e%2e/api-keys'],
    ['DELETE', `/emails/${ID}`],
    ['PUT', '/emails'],
  ];
  for (const [method, path] of attempts) {
    await assert.rejects(
      fetch(`${API}${path}`, { method }),
      (error: unknown) => error instanceof CommsError && error.code === 'SEND_REFUSED',
      `${method} ${path}`,
    );
  }
  // Even with a send permit open, nothing else passes on it.
  await spendOn(permit, APPROVAL, 'emails.send', async () => {
    await assert.rejects(
      fetch(`${API}/emails/batch`, sendInit(APPROVAL)),
      refusedWith(/batch sending is not available/),
    );
  });
  await assert.rejects(fetch(`${API}/api-keys`), refusedWith(/managed by a person/));
  assert.equal(calls.length, 0);
});

test('the route table holds exactly two writes and one download, and every refused entry has a reason', () => {
  assert.deepEqual(routesOfKind('write').sort(), ['emails.cancel', 'emails.send']);
  assert.deepEqual(routesOfKind('download'), ['received.download']);
  for (const route of ROUTES) {
    assert.ok(route.note.length > 5, route.name);
    if (route.kind !== 'write') assert.equal(route.method, 'GET', `${route.name} reads with GET only`);
  }
  for (const entry of REFUSED) assert.ok(entry.why.length > 10);
});

test('a permit opens one request of one route: a second send in the same permit is refused', async () => {
  const { calls, inner } = recorder();
  const permit = closedPermit();
  const fetch = guardResendRequests(inner, permit);
  await spendOn(permit, APPROVAL, 'emails.send', async () => {
    await fetch(`${API}/emails`, sendInit(APPROVAL));
    // Spent. A retry inside the same permit finds the door shut — a retried send may deliver twice.
    await assert.rejects(fetch(`${API}/emails`, sendInit(APPROVAL)), refusedWith(/no permit is open/));
  });
  assert.equal(calls.length, 1);
  assert.deepEqual(permit, closedPermit());
});

test('a send permit does not open cancel, and a cancel permit cancels only its own email', async () => {
  const { calls, inner } = recorder();
  const permit = closedPermit();
  const fetch = guardResendRequests(inner, permit);
  await spendOn(permit, APPROVAL, 'emails.send', async () => {
    await assert.rejects(
      fetch(`${API}/emails/${ID}/cancel`, { method: 'POST' }),
      refusedWith(/permit is for emails.send/),
    );
  });
  await spendOn(permit, ID, 'emails.cancel', async () => {
    await assert.rejects(fetch(`${API}/emails`, sendInit(ID)), refusedWith(/permit is for emails.cancel/));
  });
  await spendOn(permit, ID, 'emails.cancel', async () => {
    await assert.rejects(
      fetch(`${API}/emails/${OTHER}/cancel`, { method: 'POST' }),
      refusedWith(/cancels a different email/),
    );
  });
  await spendOn(permit, ID, 'emails.cancel', async () => {
    await fetch(`${API}/emails/${ID}/cancel`, { method: 'POST' });
  });
  assert.equal(calls.length, 1);
});

test('a send must carry its approval as the Idempotency-Key and as exactly one tag', async () => {
  const { calls, inner } = recorder();
  const permit = closedPermit();
  const fetch = guardResendRequests(inner, permit);
  const other = 'ap_ZZZZZZZZZZZZZZZZZZZZZZZZZZ';
  const cases: RequestInit[] = [
    { method: 'POST', body: sendBody(APPROVAL) },
    { method: 'POST', headers: { 'idempotency-key': other }, body: sendBody(APPROVAL) },
    { method: 'POST', headers: { 'idempotency-key': APPROVAL }, body: sendBody(other) },
    { method: 'POST', headers: { 'idempotency-key': APPROVAL }, body: JSON.stringify({ tags: [] }) },
    {
      method: 'POST',
      headers: { 'idempotency-key': APPROVAL },
      body: JSON.stringify({
        tags: [
          { name: APPROVAL_TAG, value: APPROVAL },
          { name: APPROVAL_TAG, value: other },
        ],
      }),
    },
    { method: 'POST', headers: { 'idempotency-key': APPROVAL }, body: 'not json' },
  ];
  for (const init of cases) {
    await spendOn(permit, APPROVAL, 'emails.send', async () => {
      await assert.rejects(fetch(`${API}/emails`, init), (error: unknown) => error instanceof CommsError);
    });
  }
  assert.equal(calls.length, 0);
});

test('the key never goes to the attachment CDN, and only a signed link is fetched there', async () => {
  const { calls, inner } = recorder();
  const fetch = guardResendRequests(inner, closedPermit());
  const link = `${CDN}/${ID}/attachments/${OTHER}?signature=abc`;
  await assert.rejects(
    fetch(link, { headers: { authorization: 'Bearer re_fakefull_0123456789abcdef' } }),
    refusedWith(/must not carry the API key/),
  );
  await assert.rejects(fetch(`${CDN}/${ID}/attachments/${OTHER}`), refusedWith(/signed link/));
  await assert.rejects(fetch(`${CDN}/domains`), refusedWith(/not a request/));
  await fetch(link);
  assert.equal(calls.length, 1);
});

test('a redirect is refused rather than followed to an address nothing checked', async () => {
  const { calls, inner } = recorder();
  const fetch = guardResendRequests(inner, closedPermit());
  await fetch(`${API}/domains`, { redirect: 'follow' });
  assert.equal(calls[0]?.init?.redirect, 'error');
});

test('a permit closes when the write throws, and permits do not nest', async () => {
  const permit = closedPermit();
  await assert.rejects(
    spendOn(permit, APPROVAL, 'emails.send', async () => {
      throw new Error('boom');
    }),
    /boom/,
  );
  assert.deepEqual(permit, closedPermit());
  await spendOn(permit, APPROVAL, 'emails.send', async () => {
    await assert.rejects(
      spendOn(permit, ID, 'emails.cancel', async () => undefined),
      refusedWith(/do not nest/),
    );
  });
});

test('the package root does not hand out the key to its own door', async () => {
  const root = (await import('../src/index.ts')) as Record<string, unknown>;
  for (const name of ['spendOn', 'closedPermit', 'guardResendRequests', 'resendRequest']) {
    assert.equal(root[name], undefined, `${name} is exported from the package root`);
  }
});
