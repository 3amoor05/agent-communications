import { CommsError, type ErrorCode } from '@agentcomms/core';
import type { SlackCall } from './call.ts';
import { closedPermit, downloadWith, type FetchLike, guardSlackRequests } from './guard.ts';
import { fileOfPath, SLACK_FILES_ORIGIN } from './methods.ts';

/**
 * One file's bytes from `files.slack.com`, through the guard, with the workspace's token — and to nowhere else.
 *
 * This is the only request in the package that is not a Web API call, and the only one whose URL comes out of a
 * reply rather than out of this package. So the link is never followed as given. It is parsed, its host and path are
 * checked against the file just looked up, and a fresh URL is built from the files origin and that checked path: a
 * link on any other host, or naming any other file, is refused before a request exists to carry the token.
 *
 * Every failure is a `CommsError` whose `details.reason` says which of eight things went wrong, because the caller
 * does not stop on one: a file that cannot be fetched is set aside with its reason, and the rest of the batch goes on.
 * The reasons are a contract with that caller, and they are:
 *
 * - `external` — the link is not on Slack at all. The file lives somewhere else and the token never goes there.
 *   (A file Slack marks `is_external` is the caller's to set aside before it gets here; this judges the link alone.)
 * - `wrong-host` — the link is on a Slack host, but not exactly `https://files.slack.com`: another subdomain, plain
 *   `http:`, a port, credentials in the URL, or not a URL at all.
 * - `wrong-path` — the right host, but not the path of this team's copy of this file.
 * - `redirect` — the host answered with a redirect. It is never followed.
 * - `sign-in-page` — the host answered with a web page rather than the file: the token cannot read it.
 * - `too-large` — more bytes than the cap, whether declared up front or counted as they arrived.
 * - `http-error` — any other status that is not success, with `details.status`.
 * - `network` — the connection failed or the time ran out, before or during the body.
 */

export interface SlackFileRequest {
  /** `url_private_download`, else `url_private`, exactly as Slack returned it. Checked here; never trusted. */
  url: string;
  /** The team the file was looked up in, which its path must name. */
  teamId: string;
  /** The file that was looked up, which its path must name. */
  fileId: string;
  /** The smaller of the per-file cap and what is left of the run's. Never more than {@link FILE_CEILING}. */
  maxBytes: number;
}

export interface SlackFileBody {
  bytes: Buffer;
  /** The response's media type, lower-cased and without parameters, or null when it sent none. Slack's claim. */
  contentType: string | null;
}

export type SlackFileRefusal =
  | 'external'
  | 'wrong-host'
  | 'wrong-path'
  | 'redirect'
  | 'sign-in-page'
  | 'too-large'
  | 'http-error'
  | 'network';

/**
 * No single file is read past this, whatever the caller passes.
 *
 * The caller works out the real cap — its per-file limit, or what is left of the run's — and this is the same
 * per-file limit again, held where the bytes arrive, so a caller that got its arithmetic wrong still cannot make one
 * download unbounded.
 */
const FILE_CEILING = 100 * 1024 * 1024;

/**
 * How long one file may take, headers and body together — Resend's download bound.
 *
 * `SlackCall.timeoutMs` overrides it, which tests use; production leaves it unset, so a file gets two minutes where an
 * API call gets thirty seconds.
 */
const DOWNLOAD_TIMEOUT_MS = 120_000;

/** The hosts that are Slack's own, for telling a link to the wrong part of Slack from a link away from Slack. */
function isSlackHost(hostname: string): boolean {
  return hostname === 'slack.com' || hostname.endsWith('.slack.com');
}

function refusal(
  reason: SlackFileRefusal,
  code: ErrorCode,
  message: string,
  hint: string,
  extra: Record<string, unknown> = {},
): CommsError {
  return new CommsError(code, message, { hint, details: { reason, ...extra } });
}

/**
 * The link Slack returned, checked and rebuilt, or a refusal.
 *
 * Rebuilt from {@link SLACK_FILES_ORIGIN} and the checked path, so the query, the fragment and anything else about
 * the link Slack sent does not travel — only what was checked. Exported for its tests; the guard checks the same path
 * again when the request goes out, against the grant rather than against this.
 */
export function checkedFileUrl(request: Pick<SlackFileRequest, 'url' | 'teamId' | 'fileId'>): URL {
  let link: URL;
  try {
    link = new URL(request.url);
  } catch {
    throw refusal('wrong-host', 'BAD_DATA', 'Slack’s link to the file is not a URL', 'Nothing was downloaded.');
  }
  /*
   * The origin before the path, and nothing about the link is printed: its host can be anybody's, when the file is a
   * link to somewhere else, and its last segment is a name somebody in the workspace chose.
   */
  if (link.origin !== SLACK_FILES_ORIGIN) {
    if (!isSlackHost(link.hostname)) {
      throw refusal(
        'external',
        'BAD_DATA',
        'the file is kept outside Slack, and the workspace’s token is never sent there',
        'Open it from Slack; nothing was downloaded.',
      );
    }
    throw refusal(
      'wrong-host',
      'BAD_DATA',
      `Slack’s link to the file is not on ${SLACK_FILES_ORIGIN}`,
      'Nothing was downloaded.',
    );
  }
  if (link.username !== '' || link.password !== '') {
    throw refusal('wrong-host', 'BAD_DATA', 'Slack’s link to the file carries credentials', 'Nothing was downloaded.');
  }
  const named = fileOfPath(link.pathname);
  if (named === null || named.teamId !== request.teamId || named.fileId !== request.fileId) {
    throw refusal(
      'wrong-path',
      'BAD_DATA',
      'Slack’s link does not name the file that was looked up',
      'Nothing was downloaded.',
    );
  }
  return new URL(link.pathname, SLACK_FILES_ORIGIN);
}

/** Whether a failed `fetch` failed because it met a redirect, which the guard told it to treat as an error. */
function isRefusedRedirect(error: unknown): boolean {
  const cause = (error as { cause?: { message?: unknown } } | null)?.cause;
  return typeof cause?.message === 'string' && /redirect/i.test(cause.message);
}

/** The code an HTTP failure from the files host maps to: what a person or agent would do about it. */
function codeForStatus(status: number): ErrorCode {
  if (status === 404 || status === 410) return 'NOT_FOUND';
  if (status === 401 || status === 403) return 'SCOPE_MISSING';
  if (status === 429 || status >= 500) return 'TRANSIENT';
  return 'PROVIDER_UNAVAILABLE';
}

function mediaTypeOf(header: string | null): string | null {
  const type = header?.split(';')[0]?.trim().toLowerCase();
  return type ? type : null;
}

/**
 * Downloads one file's bytes, or throws a `CommsError` carrying `details.reason`.
 *
 * `context` is the one `callSlack` takes: its token goes in the `Authorization` header, as Slack requires for both
 * of its file links, and its injected `fetch` is the inner one the guard wraps. Its permit is not used — the grant
 * is opened on a permit of this call's own, so two downloads at once never share one.
 */
export async function slackFileDownload(context: SlackCall, request: SlackFileRequest): Promise<SlackFileBody> {
  // A cap that is not a number allows nothing, rather than everything.
  const asked = Number.isFinite(request.maxBytes) ? Math.max(0, Math.floor(request.maxBytes)) : 0;
  const cap = Math.min(asked, FILE_CEILING);
  const url = checkedFileUrl(request);

  const permit = closedPermit();
  const send = guardSlackRequests(context.fetch ?? (fetch as FetchLike), permit);
  const timeout = AbortSignal.timeout(context.timeoutMs ?? DOWNLOAD_TIMEOUT_MS);
  const signal = context.signal ? AbortSignal.any([context.signal, timeout]) : timeout;
  // Which of the two it was is worth saying: a timeout on a large file is a different fix from a dropped network.
  const lost = (message: string): CommsError =>
    refusal(
      'network',
      'TRANSIENT',
      timeout.aborted ? `the download from ${SLACK_FILES_ORIGIN} took longer than it is allowed` : message,
      'Check the network, then try again.',
    );
  const redirected = (): CommsError =>
    refusal(
      'redirect',
      'PROVIDER_UNAVAILABLE',
      `${SLACK_FILES_ORIGIN} answered with a redirect, which is never followed`,
      'The token went nowhere else. Check that this account can open the file in Slack.',
    );
  const tooLarge = (): CommsError =>
    refusal('too-large', 'BAD_DATA', `the file is larger than ${cap} bytes`, 'Nothing of it was saved.', {
      maxBytes: cap,
    });

  return downloadWith(permit, { teamId: request.teamId, fileId: request.fileId }, async () => {
    let response: Response;
    try {
      response = await send(url, {
        method: 'GET',
        headers: { authorization: `Bearer ${context.token}` },
        signal,
      });
    } catch (error) {
      /*
       * The guard's own refusal, as it is. It cannot happen for a URL `checkedFileUrl` built — the two read the path
       * with the same function — and if the two ever disagree, the guard's files-host refusals carry a reason of
       * their own, so what reaches the caller still says which.
       */
      if (error instanceof CommsError) throw error;
      if (isRefusedRedirect(error)) throw redirected();
      throw lost(`could not reach ${SLACK_FILES_ORIGIN}`);
    }

    /*
     * Everything that refuses an answer cancels its body first, so a refused file is not read — and a connection is
     * not left holding one open.
     */
    const discard = async (): Promise<void> => {
      await response.body?.cancel().catch(() => undefined);
    };

    // A runtime that followed a redirect regardless, or an answer that is one: either way, not the file asked for.
    if (response.redirected || (response.status >= 300 && response.status < 400)) {
      await discard();
      throw redirected();
    }
    if (!response.ok) {
      await discard();
      throw refusal(
        'http-error',
        codeForStatus(response.status),
        `${SLACK_FILES_ORIGIN} answered ${response.status}`,
        response.status === 429 || response.status >= 500 ? 'Try again shortly.' : 'Nothing was downloaded.',
        { status: response.status },
      );
    }
    const contentType = mediaTypeOf(response.headers.get('content-type'));
    /*
     * Slack's sign-in page, not the file.
     *
     * What the host sends a token it will not serve this file to is a web page, and saving that as the file would put
     * a login form on disk under the file's name and report success. Checked before the size, because the page is
     * small and the question it answers is the one the person needs.
     */
    if (contentType === 'text/html') {
      await discard();
      throw refusal(
        'sign-in-page',
        'SCOPE_MISSING',
        `${SLACK_FILES_ORIGIN} answered with a web page rather than the file: the token cannot read it`,
        'Check that this account can open the file in Slack, and that the workspace was granted files:read.',
      );
    }

    // What the host declares first, so a file plainly too large is not read at all.
    const declared = response.headers.get('content-length');
    if (declared !== null && Number(declared) > cap) {
      await discard();
      throw tooLarge();
    }

    /*
     * Then what actually arrives, counted as it arrives.
     *
     * A declared length is the host's claim, and not always present: a chunked answer has none, and a compressed one
     * declares the compressed size while the body decodes to more. The running total is the only count that is about
     * the bytes this would keep, and it stops reading the moment they pass the cap.
     */
    const chunks: Uint8Array[] = [];
    let total = 0;
    const reader = response.body?.getReader();
    if (reader !== undefined) {
      try {
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          total += value.byteLength;
          if (total > cap) {
            await reader.cancel().catch(() => undefined);
            throw tooLarge();
          }
          chunks.push(value);
        }
      } catch (error) {
        if (error instanceof CommsError) throw error;
        throw lost(`the connection to ${SLACK_FILES_ORIGIN} failed while the file was arriving`);
      }
    }
    return { bytes: Buffer.concat(chunks, total), contentType };
  });
}
