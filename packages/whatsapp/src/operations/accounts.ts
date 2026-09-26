import { rm } from 'node:fs/promises';
import { agentMarker, CommsError, nameAvailable, nameShapeProblem } from '@agentcomms/core';
import {
  newWhatsAppAccount,
  PLATFORM,
  requireAccount,
  requireNamedConfig,
  storeIdentity,
  type WhatsAppAccount,
} from '../config.ts';
import type { WhatsAppContext } from '../context.ts';
import { checkStorePath, defaultStorePath, expandSource } from '../source/location.ts';
import { probeStore } from '../source/snapshot.ts';

/**
 * Adding and removing an account: which message store a name reads.
 *
 * Both are commands only, with no tool, and both refuse an agent. Choosing which file on this Mac an agent may read is
 * a person's decision, made at their own terminal — and the first read of WhatsApp's container is also the moment
 * macOS asks that person for permission, which a background server could not answer anyway. The refusal is core's
 * agent marker, a speed bump rather than a boundary; the boundary is that no tool offers either.
 *
 * The account itself is core's generic record in `config.json` (`config.ts`). Adding one loosens no setting core's
 * classifier judges — a new account in `read` on a platform whose only mode is `read` — so nothing is approved here:
 * the person typing the command is the one deciding.
 */

/** Refuses a command that is the person's to run, when an agent is running it — or when it is not at a terminal. */
export function refuseAnAgent(context: WhatsAppContext, command: string, what: string): void {
  const marker = agentMarker(context.env);
  if (marker !== null || context.surface !== 'cli') {
    throw new CommsError('LOOSENING_REFUSED', `only a person ${what}`, {
      hint: `Ask the person to run \`agent-whatsapp ${command}\` in their own terminal.`,
      ...(marker === null ? {} : { details: { marker } }),
    });
  }
}

export interface AddedAccount {
  account: string;
  id: string;
  store: { path: string; default: boolean; id: string };
  next: string;
}

export async function addAccount(
  context: WhatsAppContext,
  request: { name: string; source?: string | undefined },
): Promise<AddedAccount> {
  refuseAnAgent(context, `add ${request.name}`, 'chooses which WhatsApp store an agent may read');
  const problem = nameShapeProblem(request.name, PLATFORM);
  if (problem) throw new CommsError('USAGE', problem);
  const isDefault = request.source === undefined;
  const path = isDefault
    ? defaultStorePath(context.env)
    : checkStorePath(expandSource(request.source as string, context.env));
  const store = { path, isDefault };
  const identity = storeIdentity(path, isDefault);

  /** The same checks, before the store is opened and again inside the write: anything can happen in between. */
  const refuseTaken = (config: Awaited<ReturnType<WhatsAppContext['config']>>): void => {
    requireNamedConfig(config);
    const free = nameAvailable(config, 'account', request.name, PLATFORM);
    if (!free.ok) {
      const held = Object.hasOwn(config.accounts, request.name);
      throw held && config.accounts[request.name]?.platform === PLATFORM
        ? new CommsError('USAGE', `"${request.name}" is already added`, {
            hint: `Remove it first with \`agent-whatsapp remove ${request.name}\` to point it at another store.`,
          })
        : free.error;
    }
    for (const [name, other] of Object.entries(config.accounts)) {
      if (other.platform !== PLATFORM) continue;
      const theirs = context.storeOf(other as WhatsAppAccount);
      if (theirs.path === path || other.workspace === identity.workspace) {
        throw new CommsError('USAGE', `that store is already added, as "${name}"`, {
          hint: 'One name per message store.',
        });
      }
    }
  };
  refuseTaken(await context.config());
  // Before anything is written: a store this process cannot read is reported now, with what to grant.
  await probeStore(path, context.sourceOptions(isDefault));
  const account = newWhatsAppAccount({ now: context.now(), store });
  await context.core.config.update((config) => {
    refuseTaken(config);
    return { ...config, accounts: { ...config.accounts, [request.name]: account } };
  });
  return {
    account: request.name,
    id: account.id,
    store: { path, default: isDefault, id: account.workspace },
    next: `agent-whatsapp sync --account ${request.name}`,
  };
}

export interface RemovedAccount {
  account: string;
  removed: true;
  /** The local index and anything else this package kept for the account. WhatsApp's own store is never touched. */
  indexDeleted: boolean;
  /** The person's lists for it are gone too: a new account under this name starts with none. */
  listsForgotten: true;
}

export async function removeAccount(context: WhatsAppContext, request: { name: string }): Promise<RemovedAccount> {
  refuseAnAgent(context, `remove ${request.name}`, 'removes a WhatsApp account');
  const { account } = requireAccount(await context.config(), request.name);
  await context.core.config.update((config) => {
    const held = Object.hasOwn(config.accounts, request.name) ? config.accounts[request.name] : undefined;
    if (!held || held.id !== account.id) {
      throw new CommsError('TRANSIENT', `"${request.name}" changed while it was being removed`, {
        hint: 'Nothing was removed. Run it again.',
      });
    }
    const { [request.name]: _removed, ...rest } = config.accounts;
    return { ...config, accounts: rest };
  });
  // The account is gone before its index and lists, so nothing can read the index without the lists in between.
  await rm(context.accountDir(account), { recursive: true, force: true });
  await context.lists.forget(account.id);
  return { account: request.name, removed: true, indexDeleted: true, listsForgotten: true };
}
