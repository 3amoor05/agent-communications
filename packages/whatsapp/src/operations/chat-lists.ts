import { chatRefOf } from '../chat-ref.ts';
import type { WhatsAppContext } from '../context.ts';
import { type ChatLists, listKey } from '../visibility.ts';
import { refuseAnAgent } from './accounts.ts';

/**
 * The person's allow and deny lists of chats: `allow`, `deny` and `clear`.
 *
 * Commands only, with no tool, and refused to an agent at the command line too. The lists decide what an agent sees,
 * so an agent does not set them — not to see more, and not to see less either, since `allow` on an empty list and
 * `clear` both change what every later session sees, and neither is the agent's call. The refusal is the one `add`
 * and `draft --open` make: core's agent marker, a speed bump rather than a boundary; the boundary is that no tool
 * offers these at all.
 *
 * They live in this package's own file, keyed by the account's id (`lists.ts`), not in `config.json`: see there for
 * why a list the person keeps is not a setting core's classifier could judge.
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
  refuseAnAgent(context, command, 'changes which chats an agent may see');
  const chatId = request.chat === undefined ? undefined : chatRefOf(request.chat).id;
  const { name, account } = await context.account(request.account);
  const { before, after } = await context.lists.update(account.id, (lists) => next(lists, chatId));
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
