import { isCommsError, toCommsError } from '@agentcomms/core';
import { requireAccount, type SpikeConfig } from '../config.ts';
import type { WhatsAppContext } from '../context.ts';
import { WhatsAppIndex } from '../index-db.ts';
import { probeStore } from '../source/snapshot.ts';
import { Visibility } from '../visibility.ts';

/**
 * What is set up, whether each store can be read, and what the index holds — and, in plain words, the two promises
 * this package makes: it reaches no network, and it sends nothing.
 */

export const READS = 'local files only: this package has no network client and never connects to WhatsApp';
export const SENDS =
  'never: `draft` returns a link that opens WhatsApp with the text filled in, and the person sends it';

export type AccessState = 'readable' | 'missing' | 'denied' | 'waiting' | 'unreadable' | 'not-checked';

export interface AccountStatus {
  account: string;
  id: string;
  store: { path: string; default: boolean };
  /**
   * How many chats are on the person's allow and deny lists — counts only: which chats are hidden is not something
   * status tells an agent.
   */
  chatLists: { allow: number; deny: number };
  access: {
    state: AccessState;
    message?: string | undefined;
    hint?: string | undefined;
    grant?: string | undefined;
    responsibleApp?: string | undefined;
  };
  index:
    | { synced: false }
    | {
        synced: true;
        indexedAt: string;
        chats: number;
        statusChats: number;
        messages: number;
        media: number;
        degraded: { part: string; costs: string }[];
      };
}

export interface StatusResult {
  accounts: AccountStatus[];
  reads: string;
  sends: string;
  /** What to run first, when nothing is set up. */
  setup?: string | undefined;
}

function stateOf(reason: unknown): AccessState {
  switch (reason) {
    case 'NO_STORE':
      return 'missing';
    case 'MACOS_PRIVACY':
    case 'FILE_PERMISSIONS':
      return 'denied';
    case 'MACOS_PROMPT_PENDING':
      return 'waiting';
    default:
      return 'unreadable';
  }
}

async function statusOf(
  context: WhatsAppContext,
  name: string,
  config: SpikeConfig,
  check: boolean,
): Promise<AccountStatus> {
  const { account } = requireAccount(config, name);
  const store = context.storeOf(account);
  let access: AccountStatus['access'] = { state: 'not-checked' };
  if (check) {
    try {
      await probeStore(store.path, context.sourceOptions(store.isDefault));
      access = { state: 'readable' };
    } catch (error) {
      const failure = toCommsError(error);
      const details = failure.details ?? {};
      access = {
        state: stateOf(details.reason),
        message: failure.message,
        ...(failure.hint === undefined ? {} : { hint: failure.hint }),
        ...(typeof details.grant === 'string' ? { grant: details.grant } : {}),
        ...(typeof details.responsibleApp === 'string' ? { responsibleApp: details.responsibleApp } : {}),
      };
    }
  }
  let index: AccountStatus['index'] = { synced: false };
  try {
    const opened = await WhatsAppIndex.open(context.accountDir(account), name, new Visibility(account.chats));
    try {
      const stats = opened.stats();
      index = {
        synced: true,
        indexedAt: stats.indexedAt,
        chats: stats.chats,
        statusChats: stats.statusChats,
        messages: stats.messages,
        media: stats.media,
        degraded: stats.degraded,
      };
    } finally {
      opened.close();
    }
  } catch (error) {
    if (!isCommsError(error) || error.details?.reason !== 'NOT_SYNCED') throw error;
  }
  return {
    account: name,
    id: account.id,
    store: { path: store.path, default: store.isDefault },
    chatLists: { allow: account.chats?.allow.length ?? 0, deny: account.chats?.deny.length ?? 0 },
    access,
    index,
  };
}

export async function whatsappStatus(
  context: WhatsAppContext,
  request: { account?: string | undefined; check?: boolean | undefined },
): Promise<StatusResult> {
  const config = await context.config.load();
  const names = request.account === undefined ? Object.keys(config.accounts).sort() : [request.account];
  const accounts: AccountStatus[] = [];
  for (const name of names) accounts.push(await statusOf(context, name, config, request.check !== false));
  return {
    accounts,
    reads: READS,
    sends: SENDS,
    ...(accounts.length === 0
      ? { setup: 'agent-whatsapp add <organisation>/whatsapp — run by a person, in a terminal' }
      : {}),
  };
}
