import { handoffSentenceToFill, isCommsError, toCommsError } from '@agentcomms/core';
import type { WhatsAppContext } from '../context.ts';
import { WhatsAppIndex } from '../index-db.ts';
import { probeStore } from '../source/snapshot.ts';
import { describeMigration } from '../spike-migration.ts';
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
        /**
         * Status updates hidden because WhatsApp recorded no author for them and the lists hide someone: such a post
         * could be anyone's. A count, never which.
         */
        unattributedStatus: number;
        degraded: { part: string; costs: string }[];
      };
}

export interface StatusResult {
  accounts: AccountStatus[];
  reads: string;
  sends: string;
  /** What to run first, when nothing is set up: this installation's own `add`, located, with the name to fill in. */
  setup?: string | undefined;
  /**
   * What happened to the spike's accounts, when this process found its file: moved into `config.json`, or why not.
   * Never which chats its lists hide.
   */
  spike?: string | undefined;
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

async function statusOf(context: WhatsAppContext, named: string, check: boolean): Promise<AccountStatus> {
  const { name, account, lists } = await context.account(named);
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
    const opened = await WhatsAppIndex.open(context.accountDir(account), name, new Visibility(lists), context.handoffs);
    try {
      const stats = opened.stats();
      index = {
        synced: true,
        indexedAt: stats.indexedAt,
        chats: stats.chats,
        statusChats: stats.statusChats,
        messages: stats.messages,
        media: stats.media,
        unattributedStatus: stats.unattributedStatus,
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
    chatLists: { allow: lists.allow.length, deny: lists.deny.length },
    access,
    index,
  };
}

export async function whatsappStatus(
  context: WhatsAppContext,
  request: { account?: string | undefined; check?: boolean | undefined },
): Promise<StatusResult> {
  const names = request.account === undefined ? await context.accountNames() : [request.account];
  const accounts: AccountStatus[] = [];
  for (const name of names) accounts.push(await statusOf(context, name, request.check !== false));
  const spike = await context.migration();
  return {
    accounts,
    reads: READS,
    sends: SENDS,
    ...(accounts.length === 0
      ? {
          setup: handoffSentenceToFill(
            context.handoffs.own(['add']),
            ['<organisation>/whatsapp'],
            (command) => `${command} — run by a person, in a terminal`,
          ),
        }
      : {}),
    ...(spike ? { spike: describeMigration(spike) } : {}),
  };
}
