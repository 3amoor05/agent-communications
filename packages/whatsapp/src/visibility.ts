import type { ChatKind } from './source/types.ts';

/**
 * Which chats an agent may see in an account: the person's allow and deny lists.
 *
 * - **deny**: chats an agent must never see. A denied chat is not listed, searched, read, counted or drafted to, and
 *   asking for it by id gets the answer a chat that does not exist gets.
 * - **allow**: when it has anything on it, the only chats an agent may see.
 * - Denied wins over allowed. With neither list, every chat is visible — status updates are still left out of
 *   listings and searches unless asked for, which is a default, not a list.
 *
 * An entry is a chat id, or a phone number kept as its `…@s.whatsapp.net` id. A number names a person rather than one
 * chat: their one-to-one chat and their own status posts (`<number>@status`) — and, in a status feed, where each post
 * is its author's, the posts they wrote. A group is a chat: denying someone does not remove what they wrote in a group
 * the agent may see.
 *
 * Every read applies this — `WhatsAppIndex` cannot be opened without one — and so does `sync`, which leaves what it
 * hides out of the index, so a hidden chat's messages are not kept in a second copy on disk either.
 */

export interface ChatLists {
  readonly allow: readonly string[];
  readonly deny: readonly string[];
}

/** One entry per person or chat: a phone number and the ids that carry it compare equal. */
export function listKey(jid: string): string {
  const id = jid.trim().toLowerCase();
  const person = /^(\d{7,15})@(?:s\.whatsapp\.net|status)$/.exec(id);
  return person ? `+${person[1]}` : id;
}

export class Visibility {
  readonly #allow: ReadonlySet<string>;
  readonly #deny: ReadonlySet<string>;

  constructor(lists: ChatLists | undefined) {
    this.#allow = new Set((lists?.allow ?? []).map(listKey));
    this.#deny = new Set((lists?.deny ?? []).map(listKey));
  }

  /** Whether an agent may see this chat at all. */
  seesChat(chatId: string): boolean {
    const key = listKey(chatId);
    if (this.#deny.has(key)) return false;
    return this.#allow.size === 0 || this.#allow.has(key);
  }

  /** Whether an agent may see this message: its chat must be visible, and in a status feed, its author. */
  seesMessage(chatId: string, chatKind: ChatKind | string, senderJid: string | null): boolean {
    if (!this.seesChat(chatId)) return false;
    return chatKind !== 'status' || senderJid === null || this.seesChat(senderJid);
  }
}
