import { CommsError } from '@agentcomms/core';
import { RESEND_API_ORIGIN, RESEND_DOWNLOAD_ORIGIN, refusedBecause, routeOf } from './routes.ts';

/**
 * The one door every Resend request goes through.
 *
 * The Slack package's guard, for Resend: it sits under every operation, on the `fetch` the transport actually calls,
 * so a request added anywhere in this package meets it whether or not its author knew this file existed. It fails
 * closed in every direction:
 *
 * - **Two origins, hardcoded, and no argument for either.** `https://api.resend.com` for the API and
 *   `https://inbound-cdn.resend.com` for a received attachment's bytes. A test reaches a fake Resend by rewriting an
 *   already-approved URL in the *inner* fetch, after this has approved it, so there is no mode in which the check is
 *   off.
 * - **A closed route table** (`routes.ts`). Anything not in it is refused, the most tempting ones with a reason.
 * - **Writes need a one-shot permit**, opened by the one operation that owns the route, for exactly one request.
 *   `emails.send` must also carry the approval id as its `Idempotency-Key` and as the `agentcomms_approval` tag, so
 *   a send that somehow reached here without going through the gate's own request builder is refused too.
 * - **The key never goes to the CDN.** A download carrying an `Authorization` header is refused: the signed link is
 *   its own credential, and the API key belongs to `api.resend.com` alone.
 * - **No redirects.** A 30x is a second request nothing here checked, and Resend's API does not redirect.
 */

export interface WritePermit {
  /**
   * What the open permit is for, or null when no write is allowed — which is almost always.
   *
   * For `emails.send` the approval id; for `emails.cancel` the id of the one email it may cancel.
   */
  grant: string | null;
  /** The route the permit opens. A permit to cancel does not open the door to send, nor the other way round. */
  route: string | null;
}

export function closedPermit(): WritePermit {
  return { grant: null, route: null };
}

export type FetchLike = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

/** The tag every send carries, so the email can be found at Resend by the approval that sent it. */
export const APPROVAL_TAG = 'agentcomms_approval';

function refuse(message: string, hint = 'This is a bug — please report it.'): CommsError {
  return new CommsError('SEND_REFUSED', message, { hint });
}

/** The approval tag in a send's JSON body, or null when the body is not what the gate builds. */
function approvalTagOf(body: unknown): string | null {
  if (typeof body !== 'string') return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    return null;
  }
  const tags = (parsed as { tags?: unknown } | null)?.tags;
  if (!Array.isArray(tags)) return null;
  const found = tags.filter(
    (tag): tag is { name: string; value: string } =>
      typeof tag === 'object' && tag !== null && (tag as { name?: unknown }).name === APPROVAL_TAG,
  );
  return found.length === 1 && typeof found[0]?.value === 'string' ? found[0].value : null;
}

/**
 * Wraps `fetch` so every Resend request is classified before it leaves.
 *
 * `permit` is read at call time rather than captured, so opening and closing it around a single request is enough to
 * scope what that request may do.
 */
export function guardResendRequests(inner: FetchLike, permit: WritePermit): FetchLike {
  return async (input, init) => {
    const raw = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    let url: URL;
    try {
      url = new URL(raw);
    } catch {
      throw refuse('that is not a URL this package can call');
    }
    // A parsed origin, never a prefix: `https://api.resend.com.attacker.test` starts with the right characters.
    const origin = url.origin;
    if (origin !== RESEND_API_ORIGIN && origin !== RESEND_DOWNLOAD_ORIGIN) {
      // The origin is named and nothing else: a query or a path can carry something that should not be printed.
      throw refuse(`this package only calls ${RESEND_API_ORIGIN}, and that request went to ${origin}`);
    }
    if (url.username !== '' || url.password !== '') throw refuse('a URL carrying credentials is never called');

    const method = (init?.method ?? (input instanceof Request ? input.method : 'GET')).toUpperCase();
    const route = routeOf(method, origin, url.pathname);
    if (route === null) {
      const why = origin === RESEND_API_ORIGIN ? refusedBecause(method, url.pathname) : null;
      throw refuse(
        why === null
          ? `${method} ${url.pathname} is not a request this package is allowed to make`
          : `${method} ${url.pathname} is deliberately not available: ${why}`,
        why === null ? 'Add it to api/routes.ts, saying what it does. This is a bug — please report it.' : undefined,
      );
    }

    const headers = new Headers(init?.headers ?? (input instanceof Request ? input.headers : undefined));
    if (route.kind === 'download') {
      if (headers.has('authorization') || headers.has('cookie')) {
        throw refuse('a download from the attachment CDN must not carry the API key');
      }
      if (url.search === '') throw refuse('an attachment is only downloaded through the signed link Resend returned');
    }

    if (route.kind === 'write') {
      if (permit.grant === null) {
        throw refuse(`${route.name} changes something at Resend, and no permit is open`, route.note);
      }
      if (permit.route !== route.name) {
        throw refuse(`the open permit is for ${permit.route ?? 'nothing'}, not ${route.name}`);
      }
      if (url.search !== '') throw refuse(`${route.name} takes no query`);
      if (route.name === 'emails.send') {
        if (headers.get('idempotency-key') !== permit.grant) {
          throw refuse('a send must carry its approval id as the Idempotency-Key');
        }
        if (approvalTagOf(init?.body) !== permit.grant) {
          throw refuse(`a send must carry exactly one ${APPROVAL_TAG} tag naming its approval`);
        }
      }
      if (route.name === 'emails.cancel' && url.pathname !== `/emails/${permit.grant}/cancel`) {
        throw refuse('the open permit cancels a different email');
      }
      // One permit, one request: a retry inside the same permit finds the door shut.
      permit.grant = null;
      permit.route = null;
    }

    return inner(url, { ...init, method, headers, redirect: 'error' });
  };
}

/**
 * Opens a permit for exactly one request to `route`, and closes it however `body` ends.
 *
 * Closed in a `finally` rather than after a successful call, because the failure case is the one that matters: a
 * write that threw halfway must not leave a door open behind it for whatever runs next.
 */
export async function spendOn<T>(
  permit: WritePermit,
  grant: string,
  route: 'emails.send' | 'emails.cancel',
  body: () => Promise<T>,
): Promise<T> {
  if (permit.grant !== null) throw refuse('a permit is already open; they do not nest');
  if (grant.trim() === '') throw refuse('a permit has to name what it is for');
  permit.grant = grant;
  permit.route = route;
  try {
    return await body();
  } finally {
    permit.grant = null;
    permit.route = null;
  }
}
