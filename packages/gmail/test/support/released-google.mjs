/**
 * Google, for the released 0.13.0 `agent-gmail` the mixed-version tests run (CUE-404 Task 24): every request it makes
 * to a Google host goes to the test's fake Google instead, loaded before anything else runs in that process
 * (`node --import=<seal> --import=<this file> …/released-0.13.0/gmail/dist/cli.mjs`).
 *
 * A released build ignores `AGENT_COMMS_GOOGLE_ROOT_URL` entirely — on purpose: anyone who can set an environment
 * variable could otherwise collect refresh tokens with a server of their own (`resolveEndpoints`, `auth/endpoints.ts`)
 * — so the frozen package cannot be pointed at `fake-google.ts` the way this package's source is. This does it from
 * outside, without touching a byte of the release: the two ways that build reaches Google — the global `fetch` (its
 * token refresh) and `https.request` (the bundled Google libraries, through their own `node-fetch`) — are given the
 * fake's origin, `AGENTCOMMS_TEST_GOOGLE_ORIGIN`, in place of a Google one. Paths stay as they are: the fake serves
 * Google's own (`/token`, `/gmail/v1/…`).
 *
 * It is always loaded after `test/helpers/seal-process.mjs`, which refuses every connection that is not to loopback:
 * a Google host this file does not know is refused and written to the seal's log rather than reached, and the tests
 * assert that log stays empty.
 */

import http from 'node:http';
import https from 'node:https';
import { syncBuiltinESMExports } from 'node:module';

const ORIGIN = process.env.AGENTCOMMS_TEST_GOOGLE_ORIGIN;
if (!ORIGIN) throw new Error('released-google.mjs needs AGENTCOMMS_TEST_GOOGLE_ORIGIN: the fake Google’s origin');
const FAKE = new URL(ORIGIN);
if (FAKE.protocol !== 'http:' || !/^(?:127(?:\.\d{1,3}){3}|localhost|\[::1\])$/.test(FAKE.hostname)) {
  throw new Error(`released-google.mjs redirects only to a loopback fake, not ${FAKE.origin}`);
}

/** The Google hosts the released build's endpoints name (`GOOGLE_ENDPOINTS`). */
const GOOGLE = new Set([
  'oauth2.googleapis.com',
  'gmail.googleapis.com',
  'people.googleapis.com',
  'accounts.google.com',
]);

/** The fake's URL for a Google one, or null for any other host. */
function redirected(url) {
  const parsed = new URL(String(url));
  if (!GOOGLE.has(parsed.hostname)) return null;
  return new URL(`${parsed.pathname}${parsed.search}`, FAKE.origin);
}

const fetch = globalThis.fetch;
globalThis.fetch = function redirectedFetch(input, init) {
  if (input instanceof Request) {
    const to = redirected(input.url);
    return fetch(to ? new Request(to, input) : input, init);
  }
  const to = redirected(input instanceof URL ? input.href : String(input));
  return fetch(to ?? input, init);
};

/** `https.request(url[, options][, callback])` or `https.request(options[, callback])`, to a Google host, over http. */
function overHttp(original) {
  return function redirectedRequest(first, second, third) {
    if (typeof first === 'string' || first instanceof URL) {
      const to = redirected(first);
      if (to) {
        const options = typeof second === 'function' || second === undefined ? {} : second;
        const callback = typeof second === 'function' ? second : third;
        // An agent made for https cannot carry plain http: the fake's connection is the default one.
        return http.request(to, { ...options, agent: undefined }, callback);
      }
    } else if (first !== null && typeof first === 'object') {
      const host = first.hostname ?? first.host;
      if (typeof host === 'string' && GOOGLE.has(host.replace(/:\d+$/, ''))) {
        return http.request(
          {
            ...first,
            protocol: 'http:',
            hostname: FAKE.hostname,
            host: FAKE.hostname,
            port: FAKE.port,
            agent: undefined,
          },
          second,
        );
      }
    }
    return original.call(this, first, second, third);
  };
}

https.request = overHttp(https.request);
https.get = function redirectedGet(...args) {
  const request = https.request(...args);
  request.end();
  return request;
};
syncBuiltinESMExports();
