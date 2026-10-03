import { CommsError } from '@agentcomms/core';

/**
 * One attachment's bytes, in a time that has an end. CUE-304.
 *
 * `users.messages.attachments.get` went out with no timeout and no signal — the Google libraries set neither unless
 * asked — so a connection Google accepted and then stopped answering held the download for as long as the socket
 * stayed open: `gmail_attachment_download`, `agent-gmail attachments download`, and the agent waiting on either. Two
 * limits end it now, as two end Slack's file downloads, whose `api/download.ts` this follows: one on silence, and one
 * on the whole answer, measured against the size of the file.
 *
 * Gmail's answer is JSON with the file inside it as base64, not the file's bytes. It is still read here as it arrives,
 * a piece at a time, rather than left to the library to read in one go: silence can only be measured by something
 * that sees each piece arrive.
 *
 * A limit reached is a `TRANSIENT` `CommsError` naming the attachment by its message and part ids — never by the name
 * its sender gave it, and never by a byte of it — and its `details.why` says which:
 *
 * - `stalled` — Gmail sent nothing for {@link DOWNLOAD_IDLE_MS}, before the answer or between two pieces of it.
 * - `too-slow` — the whole answer took longer than a file of its size is allowed: {@link attachmentCeilingMs}.
 * - `cancelled` — the caller's own signal gave up on it.
 *
 * None is tried again, here or by the transport's retry policy, which repeats only an answer that says "later" or a
 * connection that failed outright. Waiting out the same limit again on the same connection is the caller's to decide:
 * a person told after thirty seconds can do more about it than one told after five tries of thirty.
 */

/**
 * How long Gmail may go without sending anything: before the answer, and between any two pieces of it.
 *
 * Silence is what is limited, because silence is the sign of a stall. Slack learned it the hard way (its issue #49): a
 * single limit on the whole download could not tell a host that had stopped from a large file on a slow link, so it
 * either gave up on large files or waited minutes on a host that had sent nothing. `TransportOptions.download` sets it
 * instead, which tests use; production leaves it unset.
 */
export const DOWNLOAD_IDLE_MS = 30_000;

/**
 * How long a whole download may take, for its size: the least it is allowed, and the slowest average it may arrive at.
 *
 * The second limit, beside the one on silence: a host that sends a byte every few seconds is never silent for long, and
 * without this would hold a download open for as long as it cared to. Slack's values: 128 KiB a second is a slow link,
 * and a file is allowed its size at that rate, or two minutes if that is longer.
 */
export interface DownloadPace {
  readonly floorMs: number;
  readonly bytesPerSecond: number;
}

export const DOWNLOAD_PACE: DownloadPace = { floorMs: 120_000, bytesPerSecond: 128 * 1024 };

/** Both limits together, as a transport is given them. */
export interface DownloadLimits {
  readonly idleMs: number;
  readonly pace: DownloadPace;
}

/**
 * The largest an attachment can be: Gmail takes a message of 50 MB at most, everything in it included.
 *
 * Two uses. A download whose size is not known is allowed the time this is worth — the most it could need, so that a
 * large file is never cut off for a size nobody gave. And a size Gmail does give is believed only up to this: it is
 * used for nothing but time, and a size of terabytes would be no limit at all.
 */
export const LARGEST_ATTACHMENT: number = 50 * 1024 * 1024;

/**
 * How long a whole download of an attachment of `size` bytes may take at `pace`: see {@link DownloadPace}.
 *
 * Measured on the answer rather than on the file. The answer carries the file as base64 — four bytes for every three —
 * and an allowance worked out on the file alone would cut off a file arriving at exactly the slowest pace allowed.
 */
export function attachmentCeilingMs(size: number | undefined, pace: DownloadPace = DOWNLOAD_PACE): number {
  // Not a finite positive number is not known. Gmail's own part metadata reads as 0 when it gave the part no size.
  const known = size !== undefined && Number.isFinite(size) && size > 0;
  const bytes = known ? Math.min(size, LARGEST_ATTACHMENT) : LARGEST_ATTACHMENT;
  const answered = Math.ceil((bytes * 4) / 3);
  return Math.max(pace.floorMs, Math.ceil((answered / pace.bytesPerSecond) * 1000));
}

/** A length of time as a person says it: `0.4 seconds`, `30 seconds`, `2 minutes`, `8 minutes 53 seconds`. Slack's. */
export function spokenDuration(ms: number): string {
  const unit = (count: number, name: string): string => `${count} ${name}${count === 1 ? '' : 's'}`;
  if (ms < 60_000) return unit(Math.round(ms / 100) / 10, 'second');
  const minutes = Math.floor(ms / 60_000);
  const seconds = Math.round((ms % 60_000) / 1000);
  return seconds === 0 ? unit(minutes, 'minute') : `${unit(minutes, 'minute')} ${unit(seconds, 'second')}`;
}

/** Which of the three ended a download: Gmail went silent, the answer was too slow for its size, or the caller quit. */
type Ended = 'stalled' | 'too-slow' | 'cancelled';

interface Deadline {
  /** Handed to the request, so the connection is closed when the time is up — when the library is still listening. */
  readonly signal: AbortSignal;
  /** `work`, or a rejection the moment either limit is reached or the caller gives up, whichever comes first. */
  within<T>(work: Promise<T>): Promise<T>;
  /** Gmail sent something — the answer, or a piece of it — so the limit on silence starts again. */
  heard(): void;
  /** Which of the three ended it, or undefined while none has. */
  ended(): Ended | undefined;
  /** Lets both timers, and the caller's signal, go. Called however the download ends. */
  end(): void;
}

/**
 * Two limits — one on silence, one on the whole answer — and the caller's own signal, rejecting one promise, so that
 * whichever comes first wakes the download.
 *
 * Slack's design, and for Slack's measured reason. Its first version handed an `AbortSignal.timeout` to `fetch` and
 * trusted `fetch` to fail the read when it fired; with the body stalled and garbage collection forced while it waited,
 * the abort no longer reached the waiting read, and a three-second limit was still waiting ten seconds later. So every
 * wait here — for the answer, and for each piece of it — is raced against a promise the deadline itself rejects, and
 * the code waiting is woken by the deadline rather than by whatever the HTTP library still holds. The signal still goes
 * to the request as well, so that when the library is listening the connection is closed too. The timers are plain
 * `setTimeout`s, each cleared when the download ends, so nothing is left to keep a finished process alive.
 *
 * The limit on silence starts again each time Gmail is heard from (`heard`). The one on the whole answer runs from the
 * start, the wait for the answer included, so a slow answer does not buy its body more time.
 */
function deadline(idleMs: number, wholeMs: number, outer: AbortSignal | undefined): Deadline {
  const controller = new AbortController();
  let ended: Ended | undefined;
  let give: (reason: unknown) => void = () => undefined;
  const up = new Promise<never>((_, reject) => {
    give = reject;
  });
  // Marked handled once, here: it may be rejected before any race has subscribed to it, or after the last one.
  up.catch(() => undefined);
  const end = (which: Ended) => (): void => {
    // The first to come is the one reported; the promise is rejected once, whichever it was.
    if (ended !== undefined) return;
    ended = which;
    const reason =
      which === 'cancelled'
        ? outer?.reason
        : new DOMException(`the download ran out of time (${which})`, 'TimeoutError');
    controller.abort(reason);
    give(reason);
  };
  const idle = setTimeout(end('stalled'), idleMs);
  const ceiling = setTimeout(end('too-slow'), wholeMs);
  const cancel = end('cancelled');
  if (outer?.aborted) cancel();
  else outer?.addEventListener('abort', cancel, { once: true });
  return {
    signal: controller.signal,
    within: (work) => Promise.race([work, up]),
    heard: () => {
      idle.refresh();
    },
    ended: () => ended,
    end: () => {
      clearTimeout(idle);
      clearTimeout(ceiling);
      outer?.removeEventListener('abort', cancel);
    },
  };
}

/** What the caller knows of the attachment besides its ids: what names it, how long it may take, and when to stop. */
export interface AttachmentAbout {
  /** The part the attachment is, when the caller knows it: what an error names it by, beside its message. */
  readonly partId?: string | undefined;
  /** The size Gmail's metadata gives the part: what the whole download's time is measured against. */
  readonly size?: number | undefined;
  /** The caller's own, for giving up on the download: an MCP request cancelled, a person who stopped waiting. */
  readonly signal?: AbortSignal | undefined;
}

/** Gmail's answer as the library hands it over when asked for a stream: its status and headers, and its body unread. */
export interface StreamedAnswer {
  readonly status: number;
  readonly headers: unknown;
  readonly data: unknown;
}

/** Reads a streamed body to the end, each piece raced against the deadline, which hears every one. */
async function readBody(data: unknown, clock: Deadline): Promise<string> {
  if (data === null || data === undefined) return '';
  if (typeof data === 'string') return data;
  const pieces = (data as AsyncIterable<Uint8Array | string>)[Symbol.asyncIterator]();
  const chunks: Buffer[] = [];
  try {
    for (;;) {
      const next = await clock.within(pieces.next());
      if (next.done) break;
      clock.heard();
      chunks.push(typeof next.value === 'string' ? Buffer.from(next.value) : Buffer.from(next.value));
    }
  } catch (error) {
    // Whatever stopped the reading, the rest is not wanted, and the connection is not left open holding it.
    (data as { destroy?: () => void }).destroy?.();
    Promise.resolve(pieces.return?.()).catch(() => undefined);
    throw error;
  }
  return Buffer.concat(chunks).toString('utf8');
}

/** The JSON in an answer, or undefined when it holds none. */
function parsed(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

/**
 * Downloads one attachment through `send`, within both limits and the caller's signal, and returns its bytes.
 *
 * `send` makes the request with the signal it is given and returns the answer unread, whatever its status — the
 * transport asks the library for exactly that. A refusal from Google is thrown in the shape the transport's retry
 * policy and `mapGoogleError` read from any Google error, so a rate limit is still retried and a missing attachment
 * is still not found; a limit reached is thrown as a `CommsError` of its own, described at the top of this file.
 */
export async function downloadAttachment(
  send: (signal: AbortSignal) => Promise<StreamedAnswer>,
  request: AttachmentAbout & { readonly messageId: string },
  limits: DownloadLimits,
): Promise<Buffer> {
  const named =
    request.partId === undefined
      ? `an attachment of message ${request.messageId}`
      : `attachment ${request.messageId}/${request.partId}`;
  const which = { messageId: request.messageId, partId: request.partId ?? null };
  const wholeMs = attachmentCeilingMs(request.size, limits.pace);
  const clock = deadline(limits.idleMs, wholeMs, request.signal);
  try {
    let answer: StreamedAnswer;
    let text: string;
    try {
      answer = await clock.within(send(clock.signal));
      clock.heard();
      text = await readBody(answer.data, clock);
    } catch (error) {
      /*
       * Which it was is worth saying, because each has its own fix: Gmail going silent is the network or Google; an
       * answer arriving too slowly for its size needs a faster connection, not the same one again; and a download the
       * caller gave up on needs nothing. Anything else — a connection that failed outright — goes on as it was thrown,
       * to the retry policy and the error mapping that already know what it means.
       */
      const why = clock.ended();
      if (why === 'stalled') {
        throw new CommsError('TRANSIENT', `Gmail stopped sending ${named} for ${spokenDuration(limits.idleMs)}`, {
          hint: 'Check the network, then try again.',
          details: { why, ...which },
        });
      }
      if (why === 'too-slow') {
        throw new CommsError(
          'TRANSIENT',
          `${named} took longer to arrive than a file of its size is allowed (${spokenDuration(wholeMs)})`,
          {
            hint: 'It kept arriving, but too slowly to finish in time. Download it again on a faster connection, or open it in Gmail and save it from there.',
            details: { why, ...which },
          },
        );
      }
      if (why === 'cancelled') {
        throw new CommsError('TRANSIENT', `the download of ${named} was cancelled`, { details: { why, ...which } });
      }
      throw error;
    }

    const body = parsed(text);
    if (answer.status < 200 || answer.status >= 300) {
      throw Object.assign(new Error(`Gmail answered ${answer.status}`), {
        response: { status: answer.status, headers: answer.headers, data: body ?? text },
      });
    }
    /*
     * Anything but a JSON object is not Gmail's answer: a proxy's sign-in page, or an answer cut short. Read by the
     * library, such an answer became an attachment of no bytes, and the download said it had saved it. An object with
     * no `data` is still an empty attachment, as it always was.
     */
    if (typeof body !== 'object' || body === null || Array.isArray(body)) {
      throw new CommsError('PROVIDER_UNAVAILABLE', `Gmail’s answer for ${named} was not the attachment`, {
        hint: 'Nothing of it was kept. Try again shortly.',
        details: which,
      });
    }
    const data = (body as { data?: unknown }).data;
    return Buffer.from(typeof data === 'string' ? data : '', 'base64url');
  } finally {
    // However it ended, the deadline is let go: a finished download leaves no timer behind.
    clock.end();
  }
}
