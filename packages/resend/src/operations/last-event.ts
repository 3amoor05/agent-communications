import { newBoundary } from '@agentcomms/core';
import { wrapField } from '../compose/inbound.ts';

/**
 * What Resend says has become of an email it accepted — its own `last_event`, read with a full-access key — through
 * one fixed mapping (design 2026-10-05 §D2, the `used` send row).
 *
 * Every word is Resend's, attributed to it, and about the email as its single `last_event` describes it: never a claim
 * about every recipient. An email to two people can be delivered to one and bounce for the other, and this reads one
 * event, so nothing here says "not delivered" or "delivered to everyone". Nothing is "sent" because this machine
 * recorded Resend's acceptance, or because a scheduled time has passed: only the events below that say so say so.
 *
 * A value this version does not know is not guessed at. It is "accepted by Resend; its latest event is one this
 * version does not interpret", and the value itself appears only inside the untrusted-content envelope — Resend's to
 * fill, and so never read as an instruction or as an outcome.
 */

/** Every `last_event` this version interprets. */
export const LAST_EVENTS = [
  'scheduled',
  'queued',
  'sent',
  'delivered',
  'delivery_delayed',
  'opened',
  'clicked',
  'complained',
  'bounced',
  'suppressed',
  'failed',
  'canceled',
] as const;

export type LastEvent = (typeof LAST_EVENTS)[number];

/** The facts the words depend on, besides the event itself. */
interface Facts {
  /** When the request asked for it to go, for a scheduled send. */
  readonly scheduledAt: string | null;
  /** Whether this machine's own send record holds the cancellation Resend confirmed to it. */
  readonly cancelledHere: boolean;
}

/** The one mapping: each event, whether Resend's word is that the email was sent, and the words. */
const MAPPING: { readonly [event in LastEvent]: { readonly sent: boolean; said(facts: Facts): string } } = {
  scheduled: {
    sent: false,
    said: ({ scheduledAt }) => `scheduled for ${scheduledAt ?? 'a later time'}, not yet sent`,
  },
  queued: { sent: false, said: () => 'accepted by Resend, not yet sent' },
  sent: { sent: true, said: () => 'sent (Resend reports sent)' },
  delivered: { sent: true, said: () => 'sent (Resend reports delivered)' },
  delivery_delayed: { sent: true, said: () => 'sent (Resend reports delivery_delayed)' },
  opened: { sent: true, said: () => 'sent (Resend reports opened)' },
  clicked: { sent: true, said: () => 'sent (Resend reports clicked)' },
  complained: { sent: true, said: () => 'sent (Resend reports complained)' },
  bounced: { sent: false, said: () => 'Resend reports a bounce' },
  suppressed: { sent: false, said: () => 'Resend reports it suppressed' },
  failed: { sent: false, said: () => 'Resend reports a failure' },
  // Source-neutral: neither Resend's retrieve nor its cancel response says who cancelled it — unless this machine's
  // own record proves it was this machine.
  canceled: {
    sent: false,
    said: ({ cancelledHere }) =>
      cancelledHere ? 'cancelled from this machine before sending' : 'Resend reports it cancelled',
  },
};

/** The words for an event this version does not interpret. */
export const UNINTERPRETED = 'accepted by Resend; its latest event is one this version does not interpret';

/** The words when Resend's own word cannot be had: a sending-only key, or a look-up that failed. */
export const OUTCOME_UNAVAILABLE = 'current outcome unavailable';

/** What Resend says now of an email it accepted, or that it could not be asked. */
export type CurrentOutcome =
  | {
      /** Resend's own `last_event` for the email: one event, for the whole email. */
      readonly source: 'resend';
      /** The event, when this version interprets it; `uninterpreted` when it does not — its value only in `raw`. */
      readonly lastEvent: LastEvent | 'uninterpreted';
      /** An event this version does not interpret, as Resend gave it, inside the untrusted-content envelope. */
      readonly raw?: string | undefined;
      /** Whether Resend's word is that the email was sent. Never from a local record, never from a passed time. */
      readonly sent: boolean;
      readonly said: string;
    }
  | {
      readonly source: 'unavailable';
      readonly lastEvent: null;
      readonly sent: false;
      readonly said: typeof OUTCOME_UNAVAILABLE;
      /** Why: the key cannot read, or the look-up failed. */
      readonly why: string;
    };

function isLastEvent(value: unknown): value is LastEvent {
  // Own keys only: `constructor` or `__proto__` is not an event this version knows.
  return typeof value === 'string' && Object.hasOwn(MAPPING, value);
}

/**
 * Resend's `last_event` for one email, through the mapping. `envelope` names the account and the email the wrapped
 * value of an uninterpreted event belongs to.
 */
export function outcomeOf(
  lastEvent: unknown,
  facts: Facts,
  envelope: { account: string; id: string; boundary?: string | undefined },
): CurrentOutcome {
  if (isLastEvent(lastEvent)) {
    const entry = MAPPING[lastEvent];
    return { source: 'resend', lastEvent, sent: entry.sent, said: entry.said(facts) };
  }
  const value = typeof lastEvent === 'string' ? lastEvent : (JSON.stringify(lastEvent) ?? 'undefined');
  return {
    source: 'resend',
    lastEvent: 'uninterpreted',
    raw: wrapField(value.slice(0, 200), 'last-event', {
      boundary: envelope.boundary ?? newBoundary(),
      account: envelope.account,
      id: envelope.id,
    }),
    sent: false,
    said: UNINTERPRETED,
  };
}

/** No word from Resend, and why. */
export function outcomeUnavailable(why: string): CurrentOutcome {
  return { source: 'unavailable', lastEvent: null, sent: false, said: OUTCOME_UNAVAILABLE, why };
}
