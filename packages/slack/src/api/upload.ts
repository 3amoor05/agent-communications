import { CommsError, type ErrorCode } from '@agentcomms/core';
import type { SlackCall } from './call.ts';
import { spokenDuration } from './download.ts';
import { type FetchLike, guardSlackRequests, uploadWith } from './guard.ts';
import { SLACK_FILES_ORIGIN } from './methods.ts';

/**
 * One file's bytes to the URL Slack gave for them, through the guard, inside the post they belong to — and nowhere else.
 *
 * The second request in the package that is not a Web API call, and the only one that sends something of the person's
 * out of the machine besides a message's text. So it goes out only inside the permit of the post the person approved:
 * the gate opens that permit once the approval has been claimed and every file has been read again and matched to what
 * was shown, and this opens an upload grant inside it for the one URL `files.getUploadURLExternal` returned. The guard
 * compares the request with that URL exactly, asks again that the post is still open, and follows no redirect.
 *
 * The URL is used as Slack returned it, not rebuilt: it is an opaque, signed address for one upload, and the grant is
 * what checks it — on the files origin, under `/upload/`, with no credentials in it.
 *
 * The workspace's token goes in the `Authorization` header, as Slack's own clients send it to the upload URL. It goes
 * to `files.slack.com`, which already receives it for a download, and to nothing else.
 */

export interface SlackFileUploadRequest {
  /** `upload_url` exactly as `files.getUploadURLExternal` returned it. Checked by the grant; never followed elsewhere. */
  readonly url: string;
  /** The bytes, as they were read and hashed immediately before this — never a copy kept from an earlier reading. */
  readonly bytes: Uint8Array;
}

/**
 * How long one upload of `bytes` may take to be answered: five minutes at least, and 64 KiB a second beyond that.
 *
 * Issue #49. It was five minutes for every file, which gave up on a 100 MiB file on any uplink slower than about
 * 340 KiB a second — and an upload goes out over the slower direction of most connections. Now a file is allowed its
 * size at 64 KiB a second, so 100 MiB gets 1600 seconds, or five minutes if that is longer. An upload cannot be
 * watched for silence as a download is: `fetch` says nothing until the answer comes, so this one limit is all there is.
 * `SlackCall.timeoutMs` sets it instead, which tests use.
 */
export function uploadDeadlineMs(bytes: number): number {
  const size = Number.isFinite(bytes) && bytes > 0 ? bytes : 0;
  return Math.max(UPLOAD_FLOOR_MS, Math.ceil((size / UPLOAD_BYTES_PER_SECOND) * 1000));
}

const UPLOAD_FLOOR_MS = 300_000;
const UPLOAD_BYTES_PER_SECOND = 64 * 1024;

/**
 * The upload's deadline, raced against the wait rather than trusted to `fetch` alone — the download's design (see
 * `deadline` in `download.ts`), for the same reason.
 *
 * The download's first version handed `fetch` an `AbortSignal.timeout` and trusted it to wake the wait, and with garbage
 * collection forced over a stalled body the wait outlived its limit. That was measured on a body read; the upload's own
 * wait, for the answer, did not hang the same way when it was tried here. It is raced all the same: one mechanism for
 * both transfers, and a limit that is kept whatever the runtime does with a signal. The signal still goes to `fetch`,
 * so the connection is closed when `fetch` is listening, and a caller's own signal is forwarded into the same place.
 */
function uploadClock(ms: number, outer: AbortSignal | undefined) {
  const controller = new AbortController();
  let expired = false;
  let give: (reason: unknown) => void = () => undefined;
  const up = new Promise<never>((_, reject) => {
    give = reject;
  });
  // Marked handled once, here: it may be rejected before the race has subscribed to it, or after it has settled.
  up.catch(() => undefined);
  const stop = (reason: unknown): void => {
    controller.abort(reason);
    give(reason);
  };
  const timer = setTimeout(() => {
    expired = true;
    stop(new DOMException('the upload took longer than it is allowed', 'TimeoutError'));
  }, ms);
  const forward = (): void => stop(outer?.reason);
  if (outer?.aborted) forward();
  else outer?.addEventListener('abort', forward, { once: true });
  return {
    signal: controller.signal,
    within: <T>(work: Promise<T>): Promise<T> => Promise.race([work, up]),
    timedOut: (): boolean => expired,
    end: (): void => {
      clearTimeout(timer);
      outer?.removeEventListener('abort', forward);
    },
  };
}

/** Whether a failed `fetch` failed because it met a redirect, which the guard told it to treat as an error. */
function isRefusedRedirect(error: unknown): boolean {
  const cause = (error as { cause?: { message?: unknown } } | null)?.cause;
  return typeof cause?.message === 'string' && /redirect/i.test(cause.message);
}

/** The code an HTTP failure from the upload host maps to: what a person or agent would do about it. */
function codeForStatus(status: number): ErrorCode {
  if (status === 401 || status === 403) return 'SCOPE_MISSING';
  if (status === 404 || status === 410) return 'NOT_FOUND';
  if (status === 429 || status >= 500) return 'TRANSIENT';
  return 'PROVIDER_UNAVAILABLE';
}

function redirected(): CommsError {
  return new CommsError(
    'PROVIDER_UNAVAILABLE',
    `${SLACK_FILES_ORIGIN} answered the upload with a redirect, which is never followed`,
    {
      hint: 'The file went nowhere else. Try the post again; if it persists, check https://status.slack.com.',
    },
  );
}

/**
 * Uploads one file's bytes, or throws a `CommsError`.
 *
 * `context` is the one `callSlack` takes, and its `permit` must be the post's own, open for
 * `files.completeUploadExternal`: an upload has no permit of its own to open, because it is not an act of its own.
 * Without one it is refused before a request exists.
 *
 * The answer's body is not read. What Slack sends back is a short acknowledgement, and waiting on a host to finish
 * sending one would be a second way for an upload to hang; the status says whether the bytes were taken.
 */
export async function slackFileUpload(context: SlackCall, request: SlackFileUploadRequest): Promise<void> {
  const permit = context.permit;
  if (permit === undefined) {
    throw new CommsError('SEND_REFUSED', 'a file is uploaded only inside an approved post, and none is open', {
      hint: 'This is a bug — please report it.',
    });
  }
  const send = guardSlackRequests(context.fetch ?? (fetch as FetchLike), permit);
  const allowed = context.timeoutMs ?? uploadDeadlineMs(request.bytes.byteLength);
  const clock = uploadClock(allowed, context.signal);

  try {
    await uploadWith(permit, request.url, () =>
      answered(clock, allowed, () =>
        send(request.url, {
          method: 'POST',
          headers: {
            authorization: `Bearer ${context.token}`,
            'content-type': 'application/octet-stream',
          },
          body: request.bytes,
          signal: clock.signal,
        }),
      ),
    );
  } finally {
    // However it ended, the deadline is let go: a finished upload leaves no timer behind.
    clock.end();
  }
}

/** The upload's answer, judged by its status: nothing, or a `CommsError` saying what went wrong. */
async function answered(
  clock: ReturnType<typeof uploadClock>,
  allowed: number,
  post: () => Promise<Response>,
): Promise<void> {
  let response: Response;
  try {
    response = await clock.within(post());
  } catch (error) {
    // The guard's own refusal, as it is: it already says what it means.
    if (error instanceof CommsError) throw error;
    if (isRefusedRedirect(error)) throw redirected();
    throw new CommsError(
      'TRANSIENT',
      clock.timedOut()
        ? `the upload to ${SLACK_FILES_ORIGIN} was not answered within ${spokenDuration(allowed)}, the time a file of this size is allowed`
        : `could not reach ${SLACK_FILES_ORIGIN} to upload the file`,
      { hint: 'Check the network, then try again.' },
    );
  }
  // Not awaited: the answer is decided by its status, and a host that stops sending must not hold the post.
  response.body?.cancel().catch(() => undefined);
  if (response.redirected || (response.status >= 300 && response.status < 400)) throw redirected();
  if (!response.ok) {
    throw new CommsError(
      codeForStatus(response.status),
      `${SLACK_FILES_ORIGIN} answered ${response.status} to the upload`,
      {
        hint: response.status === 429 || response.status >= 500 ? 'Try again shortly.' : 'Nothing was posted.',
        details: { status: response.status },
      },
    );
  }
}
