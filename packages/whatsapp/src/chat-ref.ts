import { CommsError, escapeForDisplay } from '@agentcomms/core';
import { type ChatKind, chatKindOf, phoneOf } from './source/types.ts';

/**
 * A chat as a person or an agent names it: by the id `chats` and `read` print, or by a phone number.
 *
 * One parser for every command that takes a chat — `read`, `search --chat`, `draft` — so no two of them can disagree
 * about what a chat id is. Whatever `chats` prints under a chat's name, each of them accepts.
 */
export interface ChatRef {
  /** The chat's id, as the index keys it: a phone number becomes its `…@s.whatsapp.net` id. */
  readonly id: string;
  readonly kind: ChatKind;
  /** The number behind a one-to-one chat, as digits; null for anything that has none a link could use. */
  readonly phone: string | null;
  /** True when it was named by a phone number rather than an id. */
  readonly byPhone: boolean;
}

/** The shape of a chat id: WhatsApp's own, never input a person could make into anything else. */
export const CHAT_ID: RegExp = /^[A-Za-z0-9._:-]{1,128}@[a-z.]{1,32}$/;

/**
 * A chat id, or a phone number: `+1 555 555 0101`, `00 1 555 555 0101` or the bare `15555550101`, spaces, brackets,
 * dots and dashes allowed.
 *
 * `00` is the international prefix most of the world dials, and means what `+` means. A single leading `0` is a
 * national trunk prefix — `07700 900123` — which no international number starts with, so it is refused rather than
 * kept as a number that matches no chat. `international`, for the person's lists, also refuses the bare form: written
 * without `+` or `00`, `5555550102` could be a national number of any country, and a list entry that matches nothing
 * would hide nothing while saying it did.
 */
export function chatRefOf(input: string, options: { international?: boolean } = {}): ChatRef {
  const trimmed = input.trim();
  if (trimmed.includes('@')) {
    if (!CHAT_ID.test(trimmed)) {
      throw new CommsError('USAGE', 'that is not a chat id', {
        hint: 'Use an id `chats` shows — 15555550101@s.whatsapp.net, 120363000000000001@g.us — or a phone number.',
      });
    }
    return { id: trimmed, kind: chatKindOf(trimmed), phone: phoneOf(trimmed), byPhone: false };
  }
  const withCode =
    'The full international number, with the country code — +1 555 555 0101 or 00 1 555 555 0101 — or an id `chats` shows.';
  const number = /^(\+|00)?(\d{7,15})$/.exec(trimmed.replace(/[\s().-]/g, ''));
  if (!number) {
    throw new CommsError('USAGE', `"${escapeForDisplay(trimmed)}" is not a phone number or a chat id`, {
      hint: withCode,
    });
  }
  const digits = number[2] as string;
  if (digits.startsWith('0')) {
    throw new CommsError('USAGE', `"${escapeForDisplay(trimmed)}" is a number without its country code`, {
      hint: `No international number starts with 0. ${withCode}`,
    });
  }
  if (options.international && number[1] === undefined) {
    throw new CommsError('USAGE', `"${escapeForDisplay(trimmed)}" needs its country code, written with + or 00`, {
      hint: `Without one it could be a number in any country, and would hide nothing. ${withCode}`,
    });
  }
  return { id: `${digits}@s.whatsapp.net`, kind: 'direct', phone: digits, byPhone: true };
}

/**
 * The answer for a chat that is not there — and for one the person has hidden from agents, word for word, so that
 * asking cannot tell the two apart.
 */
export function noSuchChat(chatId: string, account: string): CommsError {
  return new CommsError('NOT_FOUND', `no chat ${chatId} in "${account}"`, {
    hint: 'List them with `chats`. A chat that started after the last sync appears after the next one.',
  });
}
