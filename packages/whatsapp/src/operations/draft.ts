import { CommsError, escapeForDisplay, isDangerous } from '@agentcomms/core';
import { chatRefOf, noSuchChat } from '../chat-ref.ts';
import type { WhatsAppContext } from '../context.ts';
import type { ChatKind } from '../source/types.ts';
import { Visibility } from '../visibility.ts';

/**
 * A draft: the text, and a link that opens WhatsApp with it filled in. **The person presses send.**
 *
 * This is the whole of sending in this package, and it sends nothing. There is no WhatsApp client here to send with —
 * no session, no socket, no network module — so "may draft, may not send" is not a policy this code enforces; it is
 * the only thing the code can do. The link is WhatsApp's own click-to-chat: `https://wa.me/<number>?text=…` in a
 * browser, `whatsapp://send?phone=<number>&text=…` straight into the app. Either one fills the message box and stops.
 *
 * The recipient is a phone number or any chat id `chats` prints. A group has no number, so no link can open it with
 * text filled in; the draft then comes back as text to paste. So does a chat with someone who hides their number
 * (`@lid`), a broadcast list and a channel. A status update is refused: it is a post, not a chat anyone writes to.
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
  const chat = chatRefOf(to);
  if (chat.kind === 'status') {
    // `<number>@status` is that person's own posts: their chat is the one to write to.
    const author = /^(\d{7,15})@status$/i.exec(chat.id)?.[1];
    throw new CommsError('USAGE', 'a status update is not a chat anyone writes to, so there is nothing to draft to', {
      hint: author
        ? `To write to the person who posted it, draft to their number: +${author}.`
        : 'Draft to the person’s own chat instead.',
    });
  }
  return { chat: chat.id, phone: chat.phone, kind: chat.byPhone ? 'phone' : chat.kind };
}

/** Why no link can open this chat with the text filled in — said in the result, so the person knows to paste. */
function pasteReason(kind: DraftResult['to']['kind']): string {
  switch (kind) {
    case 'group':
      return 'A group has no number, so no link can open it with the text filled in. Copy the text into the group.';
    case 'broadcast':
      return 'A broadcast list has no number, so no link can open it with the text filled in. Copy the text into the list.';
    case 'channel':
      return 'A channel has no number, so no link can open it with the text filled in. Copy the text into the channel.';
    case 'hidden-number':
      return 'This person hides their number, so this chat has no phone number a link can use. Copy the text into the chat.';
    default:
      return 'This chat has no phone number a link can use. Copy the text into the chat.';
  }
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
      reason: pasteReason(to.kind),
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

/**
 * The draft as both surfaces offer it: `draft` and `whatsapp_draft` call this.
 *
 * `account` names the account the chat belongs to, and its allow and deny lists decide whether an agent may draft to
 * it; a pinned server's account is named whether the call names it or not. Without one, every account's lists must
 * allow it — the draft could be meant for any of them. A chat the lists hide is refused exactly as `read` refuses a
 * chat that does not exist.
 */
export async function draftMessage(
  context: WhatsAppContext,
  request: { account?: string | undefined; to: string; text: string },
): Promise<DraftResult> {
  // One account when it is named, or when the server is pinned to one; otherwise every WhatsApp account's lists.
  const names =
    request.account !== undefined || context.pinned !== undefined ? [request.account] : await context.accountNames();
  const chat = chatRefOf(request.to);
  for (const named of names) {
    const { name, lists } = await context.account(named);
    if (!new Visibility(lists).seesChat(chat.id)) throw noSuchChat(chat.id, name);
  }
  return composeDraft({ to: request.to, text: request.text });
}
