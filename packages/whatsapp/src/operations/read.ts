import { CommsError, wholeNumber } from '@agentcomms/core';
import { requireAccount } from '../config.ts';
import type { WhatsAppContext } from '../context.ts';
import { WhatsAppIndex } from '../index-db.ts';
import { type ChatView, type MessageView, Presenter } from '../present.ts';
import type { ChatKind } from '../source/types.ts';

/**
 * Reading: chats, one chat, search. Each opens only the local index — never WhatsApp's own files — so none of them
 * can wait on a macOS dialog, and each works on what the last `sync` saw.
 */

export const CHAT_KINDS: readonly ChatKind[] = Object.freeze([
  'direct',
  'hidden-number',
  'group',
  'status',
  'broadcast',
  'channel',
  'unknown',
]);

async function openIndex(context: WhatsAppContext, accountName: string | undefined) {
  const { name, account } = requireAccount(await context.config.load(), accountName);
  const index = await WhatsAppIndex.open(context.accountDir(account), name);
  return { name, index };
}

/** A chat by the id `chats` shows (`15555550101@s.whatsapp.net`, `…@g.us`), or by a phone number. */
export function chatIdOf(input: string): string {
  const trimmed = input.trim();
  if (/^[A-Za-z0-9._:-]{1,128}@[a-z.]{1,32}$/.test(trimmed)) return trimmed;
  const digits = trimmed.replace(/[\s()+.-]/g, '');
  if (/^\d{7,15}$/.test(digits)) return `${digits}@s.whatsapp.net`;
  throw new CommsError('USAGE', 'name a chat by the id `chats` shows, or by a phone number', {
    hint: 'For example 15555550101@s.whatsapp.net, 120363000000000001@g.us, or +1 555 555 0101.',
  });
}

export interface ChatsResult {
  account: string;
  indexedAt: string;
  chats: ChatView[];
  /** False when more chats exist beyond `limit`. */
  complete: boolean;
}

export async function listChats(
  context: WhatsAppContext,
  request: { account?: string | undefined; limit?: unknown; kind?: string | undefined },
): Promise<ChatsResult> {
  const limit = wholeNumber(request.limit ?? 50, { name: 'limit', min: 1, max: 500 }) as number;
  if (request.kind !== undefined && !(CHAT_KINDS as readonly string[]).includes(request.kind)) {
    throw new CommsError('USAGE', `"${request.kind}" is not a kind of chat`, {
      hint: `One of ${CHAT_KINDS.join(', ')}.`,
    });
  }
  const { name, index } = await openIndex(context, request.account);
  try {
    const rows = index.chats({ limit: limit + 1, kinds: request.kind ? [request.kind as ChatKind] : undefined });
    const present = new Presenter(name);
    return {
      account: name,
      indexedAt: index.stats().indexedAt,
      chats: rows.slice(0, limit).map((chat) => present.chat(chat)),
      complete: rows.length <= limit,
    };
  } finally {
    index.close();
  }
}

export interface ReadResult {
  account: string;
  indexedAt: string;
  chat: ChatView;
  /** Newest first. */
  messages: MessageView[];
  complete: boolean;
  /** Pass as `before` to read the next, older page. */
  next?: string | undefined;
}

export async function readChat(
  context: WhatsAppContext,
  request: { account?: string | undefined; chat: string; limit?: unknown; before?: string | undefined },
): Promise<ReadResult> {
  const limit = wholeNumber(request.limit ?? 50, { name: 'limit', min: 1, max: 200 }) as number;
  const chatId = chatIdOf(request.chat);
  const { name, index } = await openIndex(context, request.account);
  try {
    const chat = index.chat(chatId);
    if (!chat) {
      throw new CommsError('NOT_FOUND', `no chat ${chatId} in "${name}"`, {
        hint: 'List them with `chats`. A chat that started after the last sync appears after the next one.',
      });
    }
    let before: ReturnType<WhatsAppIndex['message']> | undefined;
    if (request.before !== undefined) {
      before = index.message(request.before);
      if (!before || before.chatId !== chatId) {
        throw new CommsError('USAGE', `"${request.before}" is not a message in this chat`, {
          hint: 'Pass the `next` value an earlier read returned.',
        });
      }
    }
    const rows = index.history(chatId, { limit: limit + 1, before: before ?? undefined });
    const present = new Presenter(name);
    const page = rows.slice(0, limit);
    const complete = rows.length <= limit;
    return {
      account: name,
      indexedAt: index.stats().indexedAt,
      chat: present.chat(chat),
      messages: page.map((message) => present.message(message)),
      complete,
      ...(complete ? {} : { next: page.at(-1)?.id }),
    };
  } finally {
    index.close();
  }
}

export interface SearchHit {
  chat: { id: string; kind: ChatKind; name: ChatView['name'] };
  message: MessageView;
}

export interface SearchResult {
  account: string;
  indexedAt: string;
  /** The words searched for, as they were matched: each a word, never search syntax. */
  words: string[];
  results: SearchHit[];
  complete: boolean;
}

/** The words of a query. Anything that is not a letter or a digit only separates them, so nothing typed is syntax. */
export function wordsOf(query: string): string[] {
  return query
    .normalize('NFKC')
    .split(/[^\p{L}\p{N}]+/u)
    .filter((word) => word.length > 0)
    .slice(0, 16);
}

export async function searchMessages(
  context: WhatsAppContext,
  request: {
    account?: string | undefined;
    query: string;
    chat?: string | undefined;
    sender?: string | undefined;
    limit?: unknown;
  },
): Promise<SearchResult> {
  const limit = wholeNumber(request.limit ?? 20, { name: 'limit', min: 1, max: 100 }) as number;
  const words = wordsOf(request.query);
  if (words.length === 0) {
    throw new CommsError('USAGE', 'search for at least one word', {
      hint: 'Words match the text, a caption or file name, the sender’s name and the chat’s name.',
    });
  }
  const chatId = request.chat === undefined ? undefined : chatIdOf(request.chat);
  const { name, index } = await openIndex(context, request.account);
  try {
    const rows = index.search(words, { limit: limit + 1, chatId, sender: request.sender?.trim() || undefined });
    const present = new Presenter(name);
    const chats = new Map<string, SearchHit['chat']>();
    const results = rows.slice(0, limit).map((message) => {
      let chat = chats.get(message.chatId);
      if (!chat) {
        const view = present.chat({
          id: message.chatId,
          kind: message.chatKind,
          name: message.chatName,
          lastMessageAt: null,
          messages: 0,
        });
        chat = { id: view.id, kind: view.kind, name: view.name };
        chats.set(message.chatId, chat);
      }
      return { chat, message: present.message(message) };
    });
    return {
      account: name,
      indexedAt: index.stats().indexedAt,
      words,
      results,
      complete: rows.length <= limit,
    };
  } finally {
    index.close();
  }
}
