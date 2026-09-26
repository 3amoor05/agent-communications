/**
 * Every request this package may make to Resend, and nothing else.
 *
 * A closed table: a request that matches no row is refused by the guard before it leaves, so a route added anywhere
 * in the package — or reached for by a dependency — has to be written down here first, with what it does. That is
 * the one moment anyone reliably asks whether it sends.
 *
 * Three kinds:
 *
 * - `read` goes out with the key and needs nothing else. None of them changes anything at Resend.
 * - `write` changes something at Resend. It needs a one-shot permit, opened by the operation that owns it for exactly
 *   one request: `emails.send` only by the send gate's execute, `emails.cancel` only by the scheduled-cancel
 *   operation. A permit for one does not open the other.
 * - `download` fetches an attachment's bytes from Resend's inbound CDN, through the signed URL Resend returned. It
 *   never carries the key: the URL is its own credential, and the key belongs to `api.resend.com` alone.
 *
 * Deliberately absent, so refused: batch sends (`POST /emails/batch` — reach is a whole batch, and attachments are not
 * supported there), rescheduling (`PATCH /emails/{id}` — a new time is a new approval), share links, broadcasts,
 * contacts, segments, topics, automations, events, templates, webhooks, domain changes and API keys. The refused list
 * below names the ones someone is most likely to reach for, so the refusal says why rather than only that.
 */

export const RESEND_API_ORIGIN = 'https://api.resend.com';
/** Where Resend serves a received attachment's bytes, from the signed `download_url` it returns. */
export const RESEND_DOWNLOAD_ORIGIN = 'https://inbound-cdn.resend.com';

export type RouteKind = 'read' | 'write' | 'download';

export interface Route {
  /** A stable name, used by permits and in refusals. */
  readonly name: string;
  readonly method: 'GET' | 'POST';
  readonly origin: typeof RESEND_API_ORIGIN | typeof RESEND_DOWNLOAD_ORIGIN;
  /** The whole path, anchored. Ids are Resend's UUIDs. */
  readonly path: RegExp;
  readonly kind: RouteKind;
  /** What it does, in words — shown in a refusal and read by whoever adds the next one. */
  readonly note: string;
}

const ID = '[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}';

export const ROUTES: readonly Route[] = Object.freeze([
  {
    name: 'domains.list',
    method: 'GET',
    origin: RESEND_API_ORIGIN,
    path: /^\/domains$/,
    kind: 'read',
    note: 'list the team’s domains',
  },
  {
    name: 'domains.get',
    method: 'GET',
    origin: RESEND_API_ORIGIN,
    path: new RegExp(`^/domains/${ID}$`),
    kind: 'read',
    note: 'one domain, with its DNS records',
  },
  {
    name: 'emails.list',
    method: 'GET',
    origin: RESEND_API_ORIGIN,
    path: /^\/emails$/,
    kind: 'read',
    note: 'list sent emails',
  },
  {
    name: 'emails.metrics',
    method: 'GET',
    origin: RESEND_API_ORIGIN,
    path: /^\/emails\/metrics$/,
    kind: 'read',
    note: 'delivery, bounce and complaint counts',
  },
  {
    name: 'emails.get',
    method: 'GET',
    origin: RESEND_API_ORIGIN,
    path: new RegExp(`^/emails/${ID}$`),
    kind: 'read',
    note: 'one sent email and its last event',
  },
  {
    name: 'received.list',
    method: 'GET',
    origin: RESEND_API_ORIGIN,
    path: /^\/emails\/receiving$/,
    kind: 'read',
    note: 'list received emails',
  },
  {
    name: 'received.get',
    method: 'GET',
    origin: RESEND_API_ORIGIN,
    path: new RegExp(`^/emails/receiving/${ID}$`),
    kind: 'read',
    note: 'one received email',
  },
  {
    name: 'received.attachment',
    method: 'GET',
    origin: RESEND_API_ORIGIN,
    path: new RegExp(`^/emails/receiving/${ID}/attachments/${ID}$`),
    kind: 'read',
    note: 'one received attachment’s metadata and signed download link',
  },
  {
    name: 'suppressions.list',
    method: 'GET',
    origin: RESEND_API_ORIGIN,
    path: /^\/suppressions$/,
    kind: 'read',
    note: 'list suppressed addresses',
  },
  {
    name: 'emails.send',
    method: 'POST',
    origin: RESEND_API_ORIGIN,
    path: /^\/emails$/,
    kind: 'write',
    note: 'send one email — only through `send execute`, after an approval',
  },
  {
    name: 'emails.cancel',
    method: 'POST',
    origin: RESEND_API_ORIGIN,
    path: new RegExp(`^/emails/${ID}/cancel$`),
    kind: 'write',
    note: 'cancel a scheduled email — only through `scheduled cancel`',
  },
  {
    name: 'received.download',
    method: 'GET',
    origin: RESEND_DOWNLOAD_ORIGIN,
    path: new RegExp(`^/${ID}/attachments/${ID}$`),
    kind: 'download',
    note: 'a received attachment’s bytes, from the signed link, without the key',
  },
]);

/** Routes someone will reach for, refused on purpose, with the reason. Everything else unlisted is refused too. */
export const REFUSED: readonly { method: string; path: RegExp; why: string }[] = Object.freeze([
  {
    method: 'POST',
    path: /^\/emails\/batch$/,
    why: 'batch sending is not available: each email is prepared, previewed and approved on its own',
  },
  {
    method: 'PATCH',
    path: /^\/emails\/[^/]+$/,
    why: 'rescheduling is not available: cancel the email and prepare it again, which is a new approval',
  },
  { method: 'POST', path: /^\/emails\/[^/]+\/share$/, why: 'public share links are never made by an agent' },
  { method: '*', path: /^\/broadcasts(\/|$)/, why: 'broadcasts are out of scope in this release' },
  { method: '*', path: /^\/api-keys(\/|$)/, why: 'API keys are managed by a person in the Resend dashboard' },
  { method: '*', path: /^\/events(\/|$)/, why: 'events start automations, an indirect way to send' },
  { method: '*', path: /^\/webhooks(\/|$)/, why: 'webhooks are managed by a person in the Resend dashboard' },
]);

/** The row a request matches, or null. `pathname` must already be decoded and free of a query. */
export function routeOf(method: string, origin: string, pathname: string): Route | null {
  for (const route of ROUTES) {
    if (route.method === method && route.origin === origin && route.path.test(pathname)) return route;
  }
  return null;
}

/** Why a request is refused on purpose, when it is one of the listed ones. */
export function refusedBecause(method: string, pathname: string): string | null {
  for (const entry of REFUSED) {
    if ((entry.method === '*' || entry.method === method) && entry.path.test(pathname)) return entry.why;
  }
  return null;
}

/** The names of every route of a kind, for tests and for the doctor. */
export function routesOfKind(kind: RouteKind): string[] {
  return ROUTES.filter((route) => route.kind === kind).map((route) => route.name);
}
