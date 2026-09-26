/**
 * What a `ZWAMESSAGE.ZMESSAGETYPE` number means.
 *
 * From [F] and [W] in `schema.ts` — two independent public tables that agree where they overlap — with [I] for 5 and
 * [K] for 6, 14 and 15. iLEAPP says plainly that it has no source for the rest; neither has this. A number not listed
 * is reported as `unknown` with the number, never guessed at.
 */

export type MessageKind =
  | 'text'
  | 'image'
  | 'video'
  | 'audio'
  | 'contact'
  | 'location'
  | 'group-event'
  | 'link'
  | 'document'
  | 'system'
  | 'gif'
  | 'waiting'
  | 'deleted'
  | 'sticker'
  | 'poll'
  | 'video-note'
  | 'call'
  | 'album'
  | 'unknown';

const KINDS: ReadonlyMap<number, { kind: MessageKind; viewOnce?: boolean }> = new Map([
  [0, { kind: 'text' }],
  [1, { kind: 'image' }],
  [2, { kind: 'video' }],
  [3, { kind: 'audio' }],
  [4, { kind: 'contact' }],
  [5, { kind: 'location' }],
  [6, { kind: 'group-event' }],
  [7, { kind: 'link' }],
  [8, { kind: 'document' }],
  [10, { kind: 'system' }],
  [11, { kind: 'gif' }],
  [12, { kind: 'waiting' }],
  [14, { kind: 'deleted' }],
  [15, { kind: 'sticker' }],
  [38, { kind: 'image', viewOnce: true }],
  [39, { kind: 'video', viewOnce: true }],
  [46, { kind: 'poll' }],
  [53, { kind: 'audio', viewOnce: true }],
  [54, { kind: 'video-note' }],
  [59, { kind: 'call' }],
  [66, { kind: 'album' }],
]);

/** Kinds whose content is a file WhatsApp stored beside the database. Listed by type, size and name, never opened. */
export const MEDIA_KINDS: ReadonlySet<MessageKind> = new Set<MessageKind>([
  'image',
  'video',
  'audio',
  'document',
  'gif',
  'sticker',
  'video-note',
  'contact',
]);

export function kindOf(code: number | null): { kind: MessageKind; viewOnce: boolean } {
  const known = code === null ? undefined : KINDS.get(code);
  return known ? { kind: known.kind, viewOnce: known.viewOnce === true } : { kind: 'unknown', viewOnce: false };
}

/** What a chat is, from its JID — the one part of a chat WhatsApp assigns and nobody in it can choose. */
export type ChatKind = 'direct' | 'hidden-number' | 'group' | 'status' | 'broadcast' | 'channel' | 'unknown';

/**
 * [M] imports exactly three kinds of conversation — `@s.whatsapp.net`, `@lid` and `@g.us` — and skips every other
 * session, comparing JIDs lower-cased; [I] names `@newsletter` chats as channels. The rest were seen rather than
 * sourced: a real store kept each contact's status posts in a session of its own, `<number>@status`, and WhatsApp's
 * own status feed and broadcast lists use `status@broadcast` and `<id>@broadcast`. A JID none of these match is
 * `unknown`, never guessed at.
 */
export function chatKindOf(jid: string): ChatKind {
  const id = jid.trim().toLowerCase();
  // Status updates: posts, not a conversation. Listed and searched only when asked for by kind.
  if (id === 'status@broadcast' || id.endsWith('@status')) return 'status';
  if (id.endsWith('@s.whatsapp.net')) return 'direct';
  // WhatsApp's "LID" addresses stand in for a phone number the other person has hidden. [M]
  if (id.endsWith('@lid')) return 'hidden-number';
  if (id.endsWith('@g.us')) return 'group';
  // A broadcast list: the owner's one message, delivered to each recipient separately.
  if (id.endsWith('@broadcast')) return 'broadcast';
  if (id.endsWith('@newsletter')) return 'channel';
  return 'unknown';
}

/** Core Data counts seconds from 2001-01-01T00:00:00Z. [K][M] */
export const CORE_DATA_EPOCH_SECONDS = 978_307_200;

export function coreDataToIso(seconds: number | null): string | null {
  if (seconds === null || !Number.isFinite(seconds) || seconds <= 0) return null;
  return new Date((seconds + CORE_DATA_EPOCH_SECONDS) * 1000).toISOString();
}

/** A number from a column that may hold it as an integer, a real or text, as Core Data columns do. [M] */
export function numeric(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'bigint') return Number(value);
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

/** A text column's value. Anything else — a blob, a number where text was expected — is not text, and reads as none. */
export function text(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}
