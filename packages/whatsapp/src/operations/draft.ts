import { CommsError, escapeForDisplay, isDangerous } from '@agentcomms/core';
import { phoneOf } from '../present.ts';
import { type ChatKind, chatKindOf } from '../source/types.ts';

/**
 * A draft: the text, and a link that opens WhatsApp with it filled in. **The person presses send.**
 *
 * This is the whole of sending in this package, and it sends nothing. There is no WhatsApp client here to send with —
 * no session, no socket, no network module — so "may draft, may not send" is not a policy this code enforces; it is
 * the only thing the code can do. The link is WhatsApp's own click-to-chat: `https://wa.me/<number>?text=…` in a
 * browser, `whatsapp://send?phone=<number>&text=…` straight into the app. Either one fills the message box and stops.
 *
 * A group has no number, so no link can open it with text filled in; the draft then comes back as text to paste. So
 * does a chat with someone who hides their number (`@lid`).
 */

/** Long enough for any real message; short enough that the link stays a link. */
export const DRAFT_LIMIT = 4_096;

export interface DraftResult {
  to: { chat: string | null; phone: string | null; kind: ChatKind | 'phone' };
  text: string;
  /** Null when no link can target the chat: paste `text` into WhatsApp instead. */
  links: { app: string; web: string } | null;
  pasteInstead: boolean;
  reason?: string | undefined;
  /** Always false. Nothing in this package can send. */
  sent: false;
  note: string;
}

const NOTE = 'Nothing was sent. Open the link: WhatsApp shows the message with the text filled in, and you press send.';

function recipientOf(to: string): DraftResult['to'] {
  const trimmed = to.trim();
  if (trimmed.includes('@')) {
    if (!/^[A-Za-z0-9._:-]{1,128}@[a-z.]{1,32}$/.test(trimmed)) {
      throw new CommsError('USAGE', 'that is not a chat id', { hint: 'Use an id `chats` shows, or a phone number.' });
    }
    return { chat: trimmed, phone: phoneOf(trimmed), kind: chatKindOf(trimmed) };
  }
  const digits = trimmed.replace(/[\s()+.-]/g, '');
  if (!/^\d{7,15}$/.test(digits)) {
    throw new CommsError('USAGE', `"${escapeForDisplay(trimmed)}" is not a phone number`, {
      hint: 'The full international number, with the country code: +1 555 555 0101.',
    });
  }
  return { chat: `${digits}@s.whatsapp.net`, phone: digits, kind: 'phone' };
}

export function composeDraft(request: { to: string; text: string }): DraftResult {
  const text = request.text.replace(/\r\n/g, '\n');
  if (text.trim() === '') throw new CommsError('USAGE', 'the draft is empty');
  if ([...text].length > DRAFT_LIMIT) {
    throw new CommsError('USAGE', `the draft is longer than ${DRAFT_LIMIT} characters`, {
      hint: 'Shorten it, or paste it into WhatsApp directly.',
    });
  }
  /*
   * What the person reads in WhatsApp's message box must be what goes out. A bidi override, a zero-width character
   * or a Unicode tag character can make those differ — tag characters are invisible and can carry a whole hidden
   * sentence to whatever reads the message on the other side. So a draft with any of them is refused, and the
   * refusal shows where they are.
   */
  const hidden = [...text].filter((char) => isDangerous(char.codePointAt(0) ?? 0));
  if (hidden.length > 0) {
    throw new CommsError('BAD_DATA', `the draft contains ${hidden.length} hidden or control character(s)`, {
      hint: `Remove them; here they are made visible: ${escapeForDisplay(text).slice(0, 300)}`,
      details: { reason: 'HIDDEN_CHARACTERS', count: hidden.length },
    });
  }
  const to = recipientOf(request.to);
  if (to.phone === null) {
    return {
      to,
      text,
      links: null,
      pasteInstead: true,
      reason:
        to.kind === 'group'
          ? 'A group has no number, so no link can open it with the text filled in. Copy the text into the group.'
          : 'This chat has no phone number a link can use. Copy the text into the chat.',
      sent: false,
      note: 'Nothing was sent. Paste the text into the chat in WhatsApp and press send yourself.',
    };
  }
  const encoded = encodeURIComponent(text);
  return {
    to,
    text,
    links: {
      app: `whatsapp://send?phone=${to.phone}&text=${encoded}`,
      web: `https://wa.me/${to.phone}?text=${encoded}`,
    },
    pasteInstead: false,
    sent: false,
    note: NOTE,
  };
}
