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
 * - `sign-in-page` — the host answered with a web page rather than the file: the token cannot read it. A file that is
 *   itself a web page — an uploaded `.html` — arrives exactly as that page does, and nothing in the answer tells the
 *   two apart, so it is refused too, always. It is never let through on the type its record declares: the uploader
 *   chose that, and trusting it would save the sign-in page as the file, and report success, whenever the token could
 *   not read an HTML file. The caller reports such a file as indistinguishable from the sign-in page.
 * - `too-large` — more bytes than the cap, whether declared up front or counted as they arrived.
 * - `http-error` — any other status that is not success, with `details.status`.
 * - `network` — the connection failed or the time ran out, before or during the body. When the time ran out,
 *   `details.why` says which limit: `stalled`, the host went silent for too long, or `too-slow`, the whole file took
 *   longer than its size allows.
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
  /**
   * The size the file's record gives, when it gives one: what the time the download is allowed is measured against
   * until the answer declares a length of its own. Slack's claim, used only for time — never for how much is read.
   */
  size?: number | undefined;
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
 * How long the host may go without sending anything: before the answer, and between any two pieces of the body.
 *
 * Issue #49. A single limit on the whole download — two minutes, once — could not tell a host that had stopped from a
 * large file on a slow link: it gave up on a 100 MiB file at any speed under about 850 KiB a second, and waited the full
 * two minutes on a host that had sent nothing for all of them. Silence is the sign of a stall, so silence is what this
 * limits. `SlackCall.timeoutMs` sets it instead, which tests use; production leaves it unset.
 */
const DOWNLOAD_IDLE_MS = 30_000;

/**
 * How long a whole download may take, for its size: the least it is allowed, and the slowest average it may arrive at.
 *
 * The second limit, beside the one on silence: a host that sends a byte every few seconds is never silent for long, and
 * without this would hold a download open for as long as it cared to. 128 KiB a second is a slow link, and a file is
 * allowed its size at that rate — 100 MiB, the most one file may be, gets 800 seconds — or two minutes, if longer.
 */
export interface DownloadPace {
  readonly floorMs: number;
  readonly bytesPerSecond: number;
}

export const DOWNLOAD_PACE: DownloadPace = { floorMs: 120_000, bytesPerSecond: 128 * 1024 };

/** How long a whole download of `expectedBytes` may take at `pace`: see {@link DownloadPace}. */
export function downloadCeilingMs(expectedBytes: number, pace: DownloadPace = DOWNLOAD_PACE): number {
  // A size that is not a number, or not a finite positive one, counts as nothing: the floor, never an unbounded wait.
  const bytes = Number.isFinite(expectedBytes) && expectedBytes > 0 ? expectedBytes : 0;
  return Math.max(pace.floorMs, Math.ceil((bytes / pace.bytesPerSecond) * 1000));
}

/**
 * A length of time as a person says it: `0.4 seconds`, `30 seconds`, `2 minutes`, `13 minutes 20 seconds`.
 *
 * Shared with the upload, whose refusal says its own limit the same way.
 */
export function spokenDuration(ms: number): string {
  const unit = (count: number, name: string): string => `${count} ${name}${count === 1 ? '' : 's'}`;
  if (ms < 60_000) return unit(Math.round(ms / 100) / 10, 'second');
  const minutes = Math.floor(ms / 60_000);
  const seconds = Math.round((ms % 60_000) / 1000);
  return seconds === 0 ? unit(minutes, 'minute') : `${unit(minutes, 'minute')} ${unit(seconds, 'second')}`;
}

/** Which limit ended a download: the host went silent, or the whole file took longer than its size allows. */
type OutOfTime = 'stalled' | 'too-slow';

interface Deadline {
  /** Handed to `fetch`, so the connection is closed when the time is up — when `fetch` is still listening. */
  readonly signal: AbortSignal;
  /** `work`, or a rejection the moment either limit is reached or the caller gives up, whichever comes first. */
  within<T>(work: Promise<T>): Promise<T>;
  /** The host sent something — the answer, or a piece of the body — so the limit on silence starts again. */
  heard(): void;
  /** The whole download's limit, measured from its start, now that the answer has said how long the file is. */
  allow(ms: number): void;
  /** How long the whole download is allowed, as it stands. */
  allowed(): number;
  /** Which limit was reached, or undefined when neither was. */
  outOfTime(): OutOfTime | undefined;
  /** Lets both timers go. Called however the download ends. */
  end(): void;
}

/**
 * Two limits that are kept even after garbage collection has run over a stalled download — one on silence, one on the
 * whole file — rejecting the same promise, so whichever is reached first wakes the download.
 *
 * Measured, not argued. The first version handed an `AbortSignal.timeout` to `fetch` and trusted `fetch` to fail the
 * read when it fired — Resend's download has the same shape. With a body stalled and garbage collection forced while
 * it waited, a three-second limit was still waiting ten seconds later, and inside the test runner the same stall held a
 * test for the full two minutes the runner allows: the abort handed to `fetch` no longer reached the waiting read. A
 * stronger timer alone did not help; it was tried, and it hung the same way.
 *
 * What fixed it is here: every wait — for the answer, and for each piece of the body — is raced against a promise the
 * deadline itself rejects, so the code waiting is woken by the deadline rather than by whatever `fetch` still holds.
 * The signal still goes to `fetch` as well, so that when `fetch` is listening the connection is closed too. The timer
 * is a plain `setTimeout` — two of them, each cleared when the download ends — and a caller's own signal is forwarded
 * into the same place, so what keeps the limits alive is explicit rather than a matter of how the runtime holds
 * `AbortSignal.timeout` or `AbortSignal.any`.
 *
 * The limit on silence is started again each time the host is heard from (`heard`): when the answer arrives, and after
 * every piece of the body. The one on the whole file runs from the start, and is set again (`allow`) once the answer
 * declares a length — still measured from the start, so a late answer does not buy the body more time.
 */
function deadline(idleMs: number, wholeMs: number, outer: AbortSignal | undefined): Deadline {
  const controller = new AbortController();
  const started = Date.now();
  let whole = wholeMs;
  let ran: OutOfTime | undefined;
  let give: (reason: unknown) => void = () => undefined;
  const up = new Promise<never>((_, reject) => {
    give = reject;
  });
  // Marked handled once, here: it may be rejected before any race has subscribed to it, or after the last one.
  up.catch(() => undefined);
  const stop = (reason: unknown): void => {
    controller.abort(reason);
    give(reason);
  };
  const outOf = (which: OutOfTime) => (): void => {
    // The first limit reached is the one reported; the promise is rejected once whichever it was.
    if (ran !== undefined || controller.signal.aborted) return;
    ran = which;
    stop(new DOMException(`the download ran out of time (${which})`, 'TimeoutError'));
  };
  const idle = setTimeout(outOf('stalled'), idleMs);
  let ceiling = setTimeout(outOf('too-slow'), whole);
  const forward = (): void => stop(outer?.reason);
  if (outer?.aborted) forward();
  else outer?.addEventListener('abort', forward, { once: true });
  return {
    signal: controller.signal,
    within: (work) => Promise.race([work, up]),
    heard: () => {
      idle.refresh();
    },
    allow: (ms) => {
      whole = ms;
      clearTimeout(ceiling);
      ceiling = setTimeout(outOf('too-slow'), Math.max(0, started + ms - Date.now()));
    },
    allowed: () => whole,
    outOfTime: () => ran,
    end: () => {
      clearTimeout(idle);
      clearTimeout(ceiling);
      outer?.removeEventListener('abort', forward);
    },
  };
}

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
 * of its file links, and its injected `fetch` is the inner one the guard wraps. Its permit is not used. The grant is
 * opened on a permit of this call's own, because the context's may be open for something else — a post the gate is
 * about to send — and a download, which is a read, must neither be refused for that nor touch it.
 */
export async function slackFileDownload(
  context: SlackCall,
  request: SlackFileRequest,
  pace: DownloadPace = DOWNLOAD_PACE,
): Promise<SlackFileBody> {
  // A cap that is not a number allows nothing, rather than everything.
  const asked = Number.isFinite(request.maxBytes) ? Math.max(0, Math.floor(request.maxBytes)) : 0;
  const cap = Math.min(asked, FILE_CEILING);
  const url = checkedFileUrl(request);
  /*
   * What the whole download is allowed to take is measured against the file's size as best it is known: the length the
   * answer declares, once it has; the size the file's record gave until then; and, with neither, the most it may be.
   * Never more than the cap: a length declared past it is refused before a byte of the body is read.
   */
  const expectedFor = (known: number | undefined): number =>
    Math.min(known !== undefined && Number.isFinite(known) && known >= 0 ? known : cap, cap);

  const permit = closedPermit();
  const send = guardSlackRequests(context.fetch ?? (fetch as FetchLike), permit);
  const idleMs = context.timeoutMs ?? DOWNLOAD_IDLE_MS;
  const clock = deadline(idleMs, downloadCeilingMs(expectedFor(request.size), pace), context.signal);
  /*
   * Which of the three it was is worth saying, because each has its own fix: a host that went silent is the network or
   * Slack; a file that arrived too slowly for its size needs a faster connection, not the same one again; and a
   * connection that failed outright is the network.
   */
  const lost = (message: string): CommsError => {
    const why = clock.outOfTime();
    if (why === 'stalled') {
      return refusal(
        'network',
        'TRANSIENT',
        `${SLACK_FILES_ORIGIN} stopped sending for ${spokenDuration(idleMs)}`,
        'Check the network, then try again.',
        { why },
      );
    }
    if (why === 'too-slow') {
      return refusal(
        'network',
        'TRANSIENT',
        `the download from ${SLACK_FILES_ORIGIN} took longer than a file of this size is allowed (${spokenDuration(clock.allowed())})`,
        'It kept arriving, but too slowly to finish in time. Download it again on a faster connection, or open it in Slack and save it from there.',
        { why },
      );
    }
    return refusal('network', 'TRANSIENT', message, 'Check the network, then try again.');
  };
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

  try {
    return await downloadWith(permit, { teamId: request.teamId, fileId: request.fileId }, async () => {
      let response: Response;
      try {
        response = await clock.within(
          send(url, {
            method: 'GET',
            headers: { authorization: `Bearer ${context.token}` },
            signal: clock.signal,
          }),
        );
      } catch (error) {
        /*
         * The guard's own refusal, as it is. It cannot happen for a URL `checkedFileUrl` built — the two read the
         * path with the same function — and if the two ever disagree, the guard's files-host refusals carry a reason
         * of their own, so what reaches the caller still says which.
         */
        if (error instanceof CommsError) throw error;
        if (isRefusedRedirect(error)) throw redirected();
        throw lost(`could not reach ${SLACK_FILES_ORIGIN}`);
      }
      clock.heard();

      /*
       * Everything that refuses an answer cancels its body first, so a refused file is not read — and a connection
       * is not left holding one open. Not awaited: a refusal is already decided, and it must not wait on a host that
       * has stopped answering.
       */
      const discard = (): void => {
        response.body?.cancel().catch(() => undefined);
      };

      // A runtime that followed a redirect regardless, or an answer that is one: either way, not the file asked for.
      if (response.redirected || (response.status >= 300 && response.status < 400)) {
        discard();
        throw redirected();
      }
      if (!response.ok) {
        discard();
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
       * What the host sends a token it will not serve this file to is a web page, and saving that as the file would
       * put a login form on disk under the file's name and report success. Checked before the size, because the page
       * is small and the question it answers is the one the person needs.
       *
       * An HTML file is refused here as well, by design and not by oversight: it comes back as a web page, which is
       * all the page above is, and no status, header or path tells one from the other.
       */
      if (contentType === 'text/html') {
        discard();
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
        discard();
        throw tooLarge();
      }
      // And the time the whole file is allowed, now measured against the length the answer declares.
      if (declared !== null && declared.trim() !== '') {
        clock.allow(downloadCeilingMs(expectedFor(Number(declared)), pace));
      }

      /*
       * Then what actually arrives, counted as it arrives.
       *
       * A declared length is the host's claim, and not always present: a chunked answer has none, and a compressed
       * one declares the compressed size while the body decodes to more. The running total is the only count that is
       * about the bytes this would keep, and it stops reading the moment they pass the cap.
       */
      const chunks: Uint8Array[] = [];
      let total = 0;
      const reader = response.body?.getReader();
      if (reader !== undefined) {
        try {
          for (;;) {
            const { done, value } = await clock.within(reader.read());
            if (done) break;
            clock.heard();
            total += value.byteLength;
            if (total > cap) throw tooLarge();
            chunks.push(value);
          }
        } catch (error) {
          // Whatever stopped the reading, the rest of the body is not wanted.
          reader.cancel().catch(() => undefined);
          if (error instanceof CommsError) throw error;
          throw lost(`the connection to ${SLACK_FILES_ORIGIN} failed while the file was arriving`);
        }
      }
      return { bytes: Buffer.concat(chunks, total), contentType };
    });
  } finally {
    // However it ended, the deadline is let go: a finished download leaves no timer behind.
    clock.end();
  }
}
