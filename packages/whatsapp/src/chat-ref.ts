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

const CHAT_ID = /^[A-Za-z0-9._:-]{1,128}@[a-z.]{1,32}$/;

export function chatRefOf(input: string): ChatRef {
  const trimmed = input.trim();
  if (trimmed.includes('@')) {
    if (!CHAT_ID.test(trimmed)) {
      throw new CommsError('USAGE', 'that is not a chat id', {
        hint: 'Use an id `chats` shows — 15555550101@s.whatsapp.net, 120363000000000001@g.us — or a phone number.',
      });
    }
    return { id: trimmed, kind: chatKindOf(trimmed), phone: phoneOf(trimmed), byPhone: false };
  }
  const digits = trimmed.replace(/[\s()+.-]/g, '');
  if (!/^\d{7,15}$/.test(digits)) {
    throw new CommsError('USAGE', `"${escapeForDisplay(trimmed)}" is not a phone number or a chat id`, {
      hint: 'The full international number, with the country code — +1 555 555 0101 — or an id `chats` shows.',
    });
  }
  return { id: `${digits}@s.whatsapp.net`, kind: 'direct', phone: digits, byPhone: true };
}
