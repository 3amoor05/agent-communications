import { CommsError, type ErrorCode } from '@agentcomms/core';
import type { SlackCall } from './call.ts';
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
 * How long one upload may take to be answered.
 *
 * Longer than a download's two minutes, because a file of up to 100 MiB goes out over whatever uplink the person has,
 * which is usually the slower direction. `SlackCall.timeoutMs` overrides it, which tests use.
 */
const UPLOAD_TIMEOUT_MS = 300_000;

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
  const deadline = AbortSignal.timeout(context.timeoutMs ?? UPLOAD_TIMEOUT_MS);
  const signal = context.signal === undefined ? deadline : AbortSignal.any([context.signal, deadline]);

  await uploadWith(permit, request.url, async () => {
    let response: Response;
    try {
      response = await send(request.url, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${context.token}`,
          'content-type': 'application/octet-stream',
        },
        body: request.bytes,
        signal,
      });
    } catch (error) {
      // The guard's own refusal, as it is: it already says what it means.
      if (error instanceof CommsError) throw error;
      if (isRefusedRedirect(error)) throw redirected();
      throw new CommsError(
        'TRANSIENT',
        deadline.aborted
          ? `the upload to ${SLACK_FILES_ORIGIN} took longer than it is allowed`
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
  });
}
