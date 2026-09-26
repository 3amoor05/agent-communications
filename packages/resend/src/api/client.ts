import { CommsError, type ErrorCode } from '@agentcomms/core';
import { closedPermit, type FetchLike, guardResendRequests, type WritePermit } from './guard.ts';
import { RESEND_API_ORIGIN, RESEND_DOWNLOAD_ORIGIN } from './routes.ts';
import type { Throttle } from './throttle.ts';

/**
 * One Resend call: through the throttle, through the guard, with Resend's failures turned into this repository's codes
 * — and with the key taken out of anything that could be printed.
 *
 * The key appears in exactly one place in this package's requests, the `Authorization` header built below, and in
 * no message, detail or hint: every text that came back from Resend or from the network passes through `redact` on
 * its way into an error, in case either ever echoes it.
 */

export interface ResendTransport {
  /** The inner fetch: the real one in production, a loopback fake in tests. Always wrapped by the guard. */
  readonly fetch?: FetchLike | undefined;
  readonly key: string;
  readonly throttle: Throttle;
  /** Closed except inside the one operation that opens it for one request. */
  readonly permit?: WritePermit | undefined;
  readonly timeoutMs?: number | undefined;
}

/** What a write's failure says about whether anything happened at Resend. */
export type WriteOutcome = 'not-sent' | 'unknown';

export interface ResendErrorDetails {
  status?: number | undefined;
  resendError?: string | undefined;
  /** For a write: whether the request can have had an effect. */
  outcome?: WriteOutcome | undefined;
  retryAfterSeconds?: number | undefined;
  stage?: 'network' | 'http' | 'unreadable' | undefined;
}

/** Takes a key, and anything that looks like one, out of a text that may be printed. */
export function redact(text: string, key: string): string {
  let out = text;
  const trimmed = key.trim();
  if (trimmed.length >= 6) {
    out = out.split(trimmed).join('[redacted key]');
    const tail = trimmed.startsWith('re_') ? trimmed.slice(3) : '';
    if (tail.length >= 6) out = out.split(tail).join('[redacted key]');
  }
  // Anything else shaped like a Resend key, whoever's it is.
  return out.replace(/\bre_[A-Za-z0-9_]{8,}/g, 're_[redacted]');
}

interface ResendErrorBody {
  name?: unknown;
  message?: unknown;
  statusCode?: unknown;
}

function codeFor(status: number, name: string): { code: ErrorCode; message: string; hint?: string } {
  if (name === 'restricted_api_key' && status === 401) {
    return {
      code: 'SCOPE_MISSING',
      message: 'this account’s key can only send email; Resend refuses everything else with it',
      hint: 'Reads need a full-access key. Add one under another name with `agent-resend account add`.',
    };
  }
  if (status === 401 || name === 'restricted_api_key' || name === 'suspended_api_key') {
    return {
      code: 'AUTH_REQUIRED',
      message: 'Resend refused the API key (it may have been deleted, disabled or suspended)',
      hint: 'Create a new key in the Resend dashboard, then remove this account and add it again with the new key.',
    };
  }
  if (status === 404) return { code: 'NOT_FOUND', message: 'Resend has no such thing' };
  if (status === 429) {
    return { code: 'TRANSIENT', message: 'Resend is rate-limiting this team, or its sending quota is used up' };
  }
  if (status >= 500) return { code: 'TRANSIENT', message: `Resend returned ${status}` };
  if (status === 409) return { code: 'PROVIDER_UNAVAILABLE', message: 'Resend refused the request as a conflict' };
  return { code: 'BAD_DATA', message: 'Resend refused the request' };
}

/**
 * Whether a failed write can have taken effect.
 *
 * A 4xx is Resend refusing to act — except 409, which means another request with this idempotency key exists or is
 * in flight, so something may already have gone. A 5xx, a timeout or a dropped connection says nothing either way.
 */
function outcomeOf(status: number | undefined): WriteOutcome {
  if (status === undefined) return 'unknown';
  return status >= 400 && status < 500 && status !== 409 && status !== 408 ? 'not-sent' : 'unknown';
}

export interface RequestOptions {
  query?: Record<string, string | number | undefined> | undefined;
  body?: unknown;
  /** Only for the send: the approval id. */
  idempotencyKey?: string | undefined;
}

/** One API request. Resolves to the parsed JSON body of a 2xx, or throws a `CommsError` whose text holds no key. */
export async function resendRequest<T>(
  transport: ResendTransport,
  method: 'GET' | 'POST',
  path: string,
  options: RequestOptions = {},
): Promise<T> {
  const writing = method !== 'GET';
  const url = new URL(path, RESEND_API_ORIGIN);
  for (const [name, value] of Object.entries(options.query ?? {})) {
    if (value !== undefined) url.searchParams.set(name, String(value));
  }
  const headers: Record<string, string> = {
    authorization: `Bearer ${transport.key}`,
    accept: 'application/json',
    'user-agent': 'agent-resend',
  };
  if (options.body !== undefined) headers['content-type'] = 'application/json';
  if (options.idempotencyKey !== undefined) headers['idempotency-key'] = options.idempotencyKey;

  try {
    await transport.throttle.before();
  } catch (error) {
    // Refused before anything left: for a write, that is certainly not sent.
    if (writing && error instanceof CommsError) {
      throw new CommsError(error.code, error.message, {
        ...(error.hint === undefined ? {} : { hint: error.hint }),
        details: { ...error.details, outcome: 'not-sent' },
      });
    }
    throw error;
  }
  const send = guardResendRequests(transport.fetch ?? (fetch as FetchLike), transport.permit ?? closedPermit());

  let response: Response;
  try {
    response = await send(url, {
      method,
      headers,
      ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
      signal: AbortSignal.timeout(transport.timeoutMs ?? 30_000),
    });
  } catch (error) {
    // A guard refusal is this package's own decision and already says what it means.
    if (error instanceof CommsError) throw error;
    const text = redact(error instanceof Error ? error.message : String(error), transport.key);
    throw new CommsError('TRANSIENT', `could not reach Resend: ${text}`, {
      hint: writing
        ? 'Whether Resend acted on it is not known. Do not repeat it: check first.'
        : 'Check the network, then try again.',
      details: { stage: 'network', ...(writing ? { outcome: 'unknown' } : {}) } satisfies ResendErrorDetails,
    });
  }

  const stopFor = await transport.throttle.after(response.status, response.headers);

  if (response.status >= 200 && response.status < 300) {
    try {
      return (await response.json()) as T;
    } catch {
      throw new CommsError('PROVIDER_UNAVAILABLE', 'Resend’s reply was not readable', {
        hint: writing ? 'Resend accepted the request; whether it acted is not known from here.' : 'Try again.',
        details: {
          status: response.status,
          stage: 'unreadable',
          ...(writing ? { outcome: 'unknown' } : {}),
        } satisfies ResendErrorDetails,
      });
    }
  }

  let body: ResendErrorBody = {};
  try {
    body = (await response.json()) as ResendErrorBody;
  } catch {
    // An empty or non-JSON error body: the status says enough.
  }
  // Both of Resend's texts are redacted: `name` is meant to be a code, but it is Resend's to fill, and it reaches
  // `details.resendError`, which every surface prints.
  const name =
    typeof body.name === 'string' ? redact(body.name, transport.key).slice(0, 64) : `http_${response.status}`;
  const said = typeof body.message === 'string' ? redact(body.message, transport.key).slice(0, 300) : '';
  const known = codeFor(response.status, name);
  const hint =
    stopFor !== null
      ? `Nothing more is asked of Resend for ${stopFor} second(s). The team’s own mail shares this limit.`
      : known.hint;
  throw new CommsError(known.code, said ? `${known.message}: ${said}` : known.message, {
    ...(hint ? { hint } : {}),
    details: {
      status: response.status,
      resendError: name,
      stage: 'http',
      ...(stopFor !== null ? { retryAfterSeconds: stopFor } : {}),
      ...(writing ? { outcome: outcomeOf(response.status) } : {}),
    } satisfies ResendErrorDetails,
  });
}

/**
 * A received attachment's bytes, from the signed link Resend returned — without the key, and up to `maxBytes`.
 *
 * The link must be on Resend's CDN; the guard checks that too, and refuses one carrying an `Authorization` header.
 */
export async function resendDownload(transport: ResendTransport, link: string, maxBytes: number): Promise<Uint8Array> {
  let url: URL;
  try {
    url = new URL(link);
  } catch {
    throw new CommsError('BAD_DATA', 'Resend returned a download link that is not a URL');
  }
  if (url.origin !== RESEND_DOWNLOAD_ORIGIN) {
    throw new CommsError('BAD_DATA', `Resend returned a download link on ${url.origin}, which is not its CDN`, {
      hint: 'Nothing was downloaded.',
    });
  }
  await transport.throttle.before();
  const send = guardResendRequests(transport.fetch ?? (fetch as FetchLike), closedPermit());
  let response: Response;
  try {
    response = await send(url, { method: 'GET', signal: AbortSignal.timeout(transport.timeoutMs ?? 120_000) });
  } catch (error) {
    if (error instanceof CommsError) throw error;
    throw new CommsError('TRANSIENT', 'could not download the attachment from Resend', {
      hint: 'Try again; the link lasts an hour and a fresh one is fetched each time.',
    });
  }
  if (!response.ok) {
    throw new CommsError(
      response.status === 404 ? 'NOT_FOUND' : 'TRANSIENT',
      `the download returned ${response.status}`,
    );
  }
  const declared = Number(response.headers.get('content-length') ?? '');
  if (Number.isFinite(declared) && declared > maxBytes) {
    throw new CommsError('BAD_DATA', `the attachment is larger than ${maxBytes} bytes`, { hint: 'Nothing was saved.' });
  }
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.byteLength > maxBytes) {
    throw new CommsError('BAD_DATA', `the attachment is larger than ${maxBytes} bytes`, { hint: 'Nothing was saved.' });
  }
  return bytes;
}
