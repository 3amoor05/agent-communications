import { analyseLink, isDangerous, type LinkFlag, neutralise, newBoundary, wrapUntrusted } from '@agentcomms/core';
import type { IndexedChat, IndexedMessage } from './index-db.ts';
import type { ChatKind } from './source/types.ts';

/**
 * The one door every string a WhatsApp contact controls leaves through.
 *
 * WhatsApp has fewer such strings than Slack and more than it looks: the body, a photo's caption, a document's file
 * name, the name a person set for themselves, a group's subject — which any member may be allowed to change — and a
 * contact's address-book name, which the owner typed but which usually repeats what the contact called themselves.
 * Every one of them goes out inside core's untrusted-content envelope, one boundary per response, and the envelope's
 * attributes carry only values WhatsApp or this package assigned: the account name, a message id, a chat's JID.
 *
 * Hidden characters are flagged, not just removed. Core's `neutralise` strips zero-width, bidi-control and tag
 * characters before it looks for envelope-shaped runs — that ordering is what stops a closing tag with a zero-width
 * space inside it — and this counts what was stripped, and says whether any of it was a bidi control, because text
 * that reads one way to a person and another way to a model is itself the signal.
 */

export const BODY_LIMIT = 16_000;
export const FIELD_LIMIT = 512;

const BIDI = new Set([0x061c, 0x200e, 0x200f, 0x202a, 0x202b, 0x202c, 0x202d, 0x202e, 0x2066, 0x2067, 0x2068, 0x2069]);

export interface Hidden {
  /** Control, zero-width, bidi and tag characters removed from the text. */
  readonly characters: number;
  /** True when any of them was a bidi control, which can make text display in a different order than it reads. */
  readonly bidi: boolean;
}

export interface UntrustedField {
  /** The text, inside the envelope. Never anywhere else. */
  readonly enveloped: string;
  readonly truncated: boolean;
  readonly hidden: Hidden;
  /** Control tokens, role markers and envelope-shaped runs defused. */
  readonly tokensNeutralised: number;
}

export interface ChatView {
  readonly id: string;
  readonly kind: ChatKind;
  /** The number a one-to-one chat is with, as digits — null for groups and for people who hide their number. */
  readonly phone: string | null;
  readonly name: UntrustedField | null;
  readonly lastMessageAt: string | null;
  readonly messages: number;
}

export interface MediaView {
  readonly type: string;
  readonly mime: string | null;
  readonly size: number | null;
  /** The stored file's name. The file itself is never opened, and its path is never returned. */
  readonly name: UntrustedField | null;
}

export interface MessageView {
  readonly id: string;
  readonly chatId: string;
  readonly at: string | null;
  readonly fromMe: boolean;
  readonly kind: string;
  readonly viewOnce: boolean;
  readonly groupEvent?: number | undefined;
  /** Who sent it: null when it was the owner. The JID is WhatsApp's; the name is the sender's or the address book's. */
  readonly sender: { readonly jid: string | null; readonly name: UntrustedField | null } | null;
  /** The body and any caption or document title, in one envelope. Null for a message with no text. */
  readonly content: UntrustedField | null;
  readonly media: MediaView | null;
  /** Every link in the content, by domain, with core's flags. The URL itself stays inside the envelope. */
  readonly links: readonly { domain: string | null; flags: readonly LinkFlag[] }[];
  /** Hidden characters across every field of this message. */
  readonly hidden: Hidden;
  readonly tokensNeutralised: number;
}

const ATTRIBUTE_SAFE = /^[A-Za-z0-9._:@/-]{1,128}$/;

function hiddenIn(text: string): Hidden {
  let characters = 0;
  let bidi = false;
  for (const char of text.replace(/\r\n/g, '\n')) {
    const code = char.codePointAt(0) ?? 0;
    if (isDangerous(code)) {
      characters += 1;
      if (BIDI.has(code)) bidi = true;
    }
  }
  return { characters, bidi };
}

function merge(...all: (Hidden | undefined)[]): Hidden {
  let characters = 0;
  let bidi = false;
  for (const hidden of all) {
    if (!hidden) continue;
    characters += hidden.characters;
    bidi ||= hidden.bidi;
  }
  return { characters, bidi };
}

/** One response's worth of wrapping: one boundary, one account name. */
export class Presenter {
  readonly boundary: string;
  readonly account: string;

  constructor(account: string, boundary: string = newBoundary()) {
    this.account = account;
    this.boundary = boundary;
  }

  field(raw: string | null, field: string, id: string, limit: number = FIELD_LIMIT): UntrustedField | null {
    if (raw === null || raw === '') return null;
    const hidden = hiddenIn(raw);
    const chars = [...raw];
    const truncated = chars.length > limit;
    const cut = truncated ? chars.slice(0, limit).join('') : raw;
    // Counted on text already stripped of hidden characters, so a zero-width space is counted once, as hidden.
    const { tokensNeutralised: all } = neutralise(cut);
    const tokensNeutralised = Math.max(0, all - hiddenIn(cut).characters);
    const enveloped = wrapUntrusted(
      cut,
      { field, inbox: this.account, ...(ATTRIBUTE_SAFE.test(id) ? { id } : {}) },
      this.boundary,
    );
    return { enveloped, truncated, hidden, tokensNeutralised };
  }

  chat(chat: IndexedChat): ChatView {
    return {
      id: chat.id,
      kind: chat.kind,
      phone: phoneOf(chat.id),
      name: this.field(chat.name, chat.kind === 'group' ? 'group-name' : 'chat-name', chat.id),
      lastMessageAt: chat.lastMessageAt,
      messages: chat.messages,
    };
  }

  message(message: IndexedMessage): MessageView {
    const text = [message.body, message.media?.title].filter((part): part is string => Boolean(part)).join('\n\n');
    const content = this.field(text === '' ? null : text, 'message', message.id, BODY_LIMIT);
    const senderName = message.fromMe ? null : this.field(message.senderName, 'sender-name', message.id);
    const mediaName = message.media ? this.field(message.media.fileName, 'file-name', message.id) : null;
    const links = [...text.matchAll(/\bhttps?:\/\/[^\s<>"'`]+/gi)].slice(0, 20).map((match) => {
      const { domain, flags } = analyseLink(match[0], match[0]);
      return { domain, flags };
    });
    const kind = message.kind === 'unknown' && message.typeCode !== null ? `unknown:${message.typeCode}` : message.kind;
    return {
      id: message.id,
      chatId: message.chatId,
      at: message.at,
      fromMe: message.fromMe,
      kind,
      viewOnce: message.viewOnce,
      ...(message.groupEvent === null || message.groupEvent === 0 ? {} : { groupEvent: message.groupEvent }),
      sender: message.fromMe ? null : { jid: message.senderJid, name: senderName },
      content,
      media: message.media ? { type: kind, mime: message.media.mime, size: message.media.size, name: mediaName } : null,
      links,
      hidden: merge(content?.hidden, senderName?.hidden, mediaName?.hidden),
      tokensNeutralised:
        (content?.tokensNeutralised ?? 0) + (senderName?.tokensNeutralised ?? 0) + (mediaName?.tokensNeutralised ?? 0),
    };
  }
}

/** The digits of a one-to-one chat's number, from its JID. Null for anything that is not a phone number. */
export function phoneOf(jid: string): string | null {
  const match = /^(\d{7,15})@s\.whatsapp\.net$/.exec(jid);
  return match?.[1] ?? null;
}

/** The text inside an envelope, for a person's terminal: the first and last lines are the tags. */
export function innerText(field: UntrustedField | null): string {
  if (!field) return '';
  const lines = field.enveloped.split('\n');
  return lines.slice(1, -1).join('\n');
}
