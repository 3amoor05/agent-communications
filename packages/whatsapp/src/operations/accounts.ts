import { rm } from 'node:fs/promises';
import { CommsError, nameShapeProblem } from '@agentcomms/core';
import { accountNamed, newWhatsAppAccount, PLATFORM, requireAccount } from '../config.ts';
import type { WhatsAppContext } from '../context.ts';
import { checkStorePath, defaultStorePath, expandSource } from '../source/location.ts';
import { probeStore } from '../source/snapshot.ts';

/**
 * Adding and removing an account: which message store a name reads.
 *
 * Both are commands only, with no tool, and that is deliberate. Choosing which file on this Mac an agent may read is a
 * person's decision, made at their own terminal — and the first read of WhatsApp's container is also the moment macOS
 * asks that person for permission, which a background server could not answer anyway.
 */

export interface AddedAccount {
  account: string;
  id: string;
  store: { path: string; default: boolean };
  next: string;
}

export async function addAccount(
  context: WhatsAppContext,
  request: { name: string; source?: string | undefined },
): Promise<AddedAccount> {
  const problem = nameShapeProblem(request.name, PLATFORM);
  if (problem) throw new CommsError('USAGE', problem);
  const isDefault = request.source === undefined;
  const path = isDefault
    ? defaultStorePath(context.env)
    : checkStorePath(expandSource(request.source as string, context.env));
  if (accountNamed(await context.config.load(), request.name)) {
    throw new CommsError('USAGE', `"${request.name}" is already added`, {
      hint: `Remove it first with \`agent-whatsapp remove ${request.name}\` to point it at another store.`,
    });
  }
  // Before anything is written: a store this process cannot read is reported now, with what to grant.
  await probeStore(path, context.sourceOptions(isDefault));
  const account = newWhatsAppAccount(context.now(), isDefault ? undefined : path);
  await context.config.update((config) => {
    if (accountNamed(config, request.name)) {
      throw new CommsError('USAGE', `"${request.name}" is already added`);
    }
    for (const [name, other] of Object.entries(config.accounts)) {
      if (context.storeOf(other).path === path) {
        throw new CommsError('USAGE', `that store is already added, as "${name}"`, {
          hint: 'One name per message store.',
        });
      }
    }
    return { ...config, accounts: { ...config.accounts, [request.name]: account } };
  });
  return {
    account: request.name,
    id: account.id,
    store: { path, default: isDefault },
    next: `agent-whatsapp sync --account ${request.name}`,
  };
}

export interface RemovedAccount {
  account: string;
  removed: true;
  /** The local index and anything else this package kept for the account. WhatsApp's own store is never touched. */
  indexDeleted: boolean;
}

export async function removeAccount(context: WhatsAppContext, request: { name: string }): Promise<RemovedAccount> {
  const { account } = requireAccount(await context.config.load(), request.name);
  await context.config.update((config) => ({
    ...config,
    accounts: Object.fromEntries(Object.entries(config.accounts).filter(([name]) => name !== request.name)),
  }));
  await rm(context.accountDir(account), { recursive: true, force: true });
  return { account: request.name, removed: true, indexDeleted: true };
}
