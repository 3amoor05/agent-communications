import { agentMarker, CommsError } from '@agentcomms/core';
import { chatRefOf } from '../chat-ref.ts';
import { accountNamed, requireAccount, type WhatsAppAccount } from '../config.ts';
import type { WhatsAppContext } from '../context.ts';
import { type ChatLists, listKey } from '../visibility.ts';

/**
 * The person's allow and deny lists of chats: `allow`, `deny` and `clear`.
 *
 * Commands only, with no tool, and refused to an agent at the command line too. The lists decide what an agent sees,
 * so an agent does not set them — not to see more, and not to see less either, since `allow` on an empty list and
 * `clear` both change what every later session sees, and neither is the agent's call. The refusal is the one
 * `draft --open` makes: core's agent marker, a speed bump rather than a boundary; the boundary is that no tool offers
 * these at all.
 */

export interface ChatListsResult {
  account: string;
  allow: string[];
  deny: string[];
  /** False when the lists were already so. */
  changed: boolean;
  /** What agents see now, in words. */
  effect: string;
  /** What the index holds was decided at the last sync: chats it left out come back only with the next one. */
  next: string;
}

function refuseAnAgent(context: WhatsAppContext, command: string): void {
  const marker = agentMarker(context.env);
  if (marker !== null || context.surface !== 'cli') {
    throw new CommsError('LOOSENING_REFUSED', 'only a person changes which chats an agent may see', {
      hint: `Ask the person to run \`agent-whatsapp ${command}\` in their own terminal.`,
      ...(marker === null ? {} : { details: { marker } }),
    });
  }
}

function without(list: readonly string[], chatId: string): string[] {
  const key = listKey(chatId);
  return list.filter((entry) => listKey(entry) !== key);
}

function withEntry(list: readonly string[], chatId: string): string[] {
  return list.some((entry) => listKey(entry) === listKey(chatId)) ? [...list] : [...list, chatId];
}

function effectOf(lists: ChatLists): string {
  const denied = lists.deny.length > 0 ? `, except the ${lists.deny.length} denied` : '';
  if (lists.allow.length > 0) {
    return `An agent sees only the ${lists.allow.length} allowed chat(s)${denied}.`;
  }
  return `An agent sees every chat${denied}; status updates only when it asks for them.`;
}

/** The one path every list change takes: the person check first, before any input is read. */
async function change(
  context: WhatsAppContext,
  command: string,
  request: { account?: string | undefined; chat?: string | undefined },
  next: (lists: ChatLists, chatId: string | undefined) => ChatLists,
): Promise<ChatListsResult> {
  refuseAnAgent(context, command);
  const chatId = request.chat === undefined ? undefined : chatRefOf(request.chat).id;
  const { name } = requireAccount(await context.config.load(), request.account);
  let before: ChatLists = { allow: [], deny: [] };
  let after: ChatLists = before;
  await context.config.update((config) => {
    const account = accountNamed(config, name);
    if (!account) throw new CommsError('NOT_FOUND', `no WhatsApp account called "${name}"`);
    before = { allow: [...(account.chats?.allow ?? [])], deny: [...(account.chats?.deny ?? [])] };
    after = next(before, chatId);
    const { chats: _previous, ...rest } = account;
    const updated: WhatsAppAccount =
      after.allow.length === 0 && after.deny.length === 0
        ? rest
        : { ...rest, chats: { allow: [...after.allow], deny: [...after.deny] } };
    return { ...config, accounts: { ...config.accounts, [name]: updated } };
  });
  return {
    account: name,
    allow: [...after.allow],
    deny: [...after.deny],
    changed: JSON.stringify(before) !== JSON.stringify(after),
    effect: effectOf(after),
    next: `agent-whatsapp sync --account ${name}`,
  };
}

/** Lets an agent see this chat. Once anything is allowed, only allowed chats are visible. Takes it off the deny list. */
export function allowChat(
  context: WhatsAppContext,
  request: { account?: string | undefined; chat: string },
): Promise<ChatListsResult> {
  return change(context, 'allow', request, (lists, chatId) => ({
    allow: withEntry(lists.allow, chatId as string),
    deny: without(lists.deny, chatId as string),
  }));
}

/**
 * Hides this chat from agents entirely. The allow list is left as it is: taking the chat off it could empty it, and
 * an empty allow list shows everything.
 */
export function denyChat(
  context: WhatsAppContext,
  request: { account?: string | undefined; chat: string },
): Promise<ChatListsResult> {
  return change(context, 'deny', request, (lists, chatId) => ({
    allow: [...lists.allow],
    deny: withEntry(lists.deny, chatId as string),
  }));
}

/** Takes one chat off both lists, or with no chat, empties both. */
export function clearChats(
  context: WhatsAppContext,
  request: { account?: string | undefined; chat?: string | undefined },
): Promise<ChatListsResult> {
  return change(context, 'clear', request, (lists, chatId) =>
    chatId === undefined
      ? { allow: [], deny: [] }
      : { allow: without(lists.allow, chatId), deny: without(lists.deny, chatId) },
  );
}
