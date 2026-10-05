import { createHash } from 'node:crypto';
import { basename, dirname } from 'node:path';
import {
  type AccountConfig,
  CommsError,
  type Config,
  type HandoffMaker,
  handoffSentence,
  handoffSentenceToFill,
  newAccountId,
  resolveName,
} from '@agentcomms/core';
import { STORE_FILE, WHATSAPP_BUSINESS_CONTAINER, WHATSAPP_GROUP_CONTAINER } from './source/location.ts';

/**
 * A WhatsApp account, as core keeps it: one record in the configuration's generic `accounts` map (design
 * 2026-09-26 §5), named `organisation/whatsapp`, beside the Slack workspaces and whatever comes after them.
 *
 * Every field is core's, filled in as honestly as a local message store allows:
 *
 * - `platform` is `whatsapp`, and `mode` is `read` — the only mode this channel has. It reads a file on this Mac and
 *   has no way to send; a draft is a link the person opens and sends themselves. `tier` says the same, as Slack's
 *   does, for readers that look there.
 * - `workspace` is a stable id for the store: WhatsApp's own container name when the store is where WhatsApp for Mac
 *   (or WhatsApp Business) keeps it, else `file:` and a digest of its path. It is what "the same account" means to
 *   core's classifier, together with `platform` and `userId`.
 * - `userId` is `store-owner`. The store is one person's, but no column the public readers document names that
 *   person's own id: WhatsApp keeps it in files beside the store that this package refuses to open. A label that
 *   says so is better than a guess.
 * - `grantedScopes` is `["local-store:read"]`: what the person granted, which is reading this one file.
 * - `secretRef` is `whatsapp:none:<id>`. There is no credential; the reference names no secret, and core's
 *   `secretRef` stays required for the releases that share this file (design §5). `secrets migrate` finds nothing
 *   stored under it and moves nothing.
 *
 * One key of this channel's own rides along, and core keeps it through every write:
 *
 * - `source`: the store's path, when it is not WhatsApp for Mac's default. Absent means the default, resolved from
 *   the home directory at run time, so the record stays true if the home directory moves.
 *
 * **The person's allow and deny lists are not here.** Only `sendPolicy`, `changePolicy` and `mode` are judged when a
 * change loosens something, so a list kept in this record could be emptied by any write to the configuration, from
 * any release, with nobody asked — a safety setting the classifier cannot see. They live in a file of this package's
 * own (`lists.ts`), which only the person's own commands write, keyed by the account's id.
 */

export const PLATFORM = 'whatsapp';

/** The one mode this channel has. Anything else in a record is refused, never acted on (design §5). */
export const READ_MODE = 'read';

/** What the person granted: reading one local file. */
export const GRANTED_SCOPES: readonly string[] = Object.freeze(['local-store:read']);

/** The label `userId` carries: the store's owner, whom the store does not name. */
export const STORE_OWNER = 'store-owner';

/** A secret reference that names no secret: the channel holds none. */
export function noSecretRef(id: string): string {
  return `${PLATFORM}:none:${id}`;
}

export interface WhatsAppAccount extends AccountConfig {
  /** The store, when it is not WhatsApp for Mac's default. Absent means the default. */
  source?: string | undefined;
}

/** The stable id and the display name of a store, from where it is. */
export function storeIdentity(path: string, isDefault: boolean): { workspace: string; workspaceName?: string } {
  if (isDefault) return { workspace: WHATSAPP_GROUP_CONTAINER, workspaceName: 'WhatsApp for Mac' };
  const container = basename(dirname(path));
  if (basename(path) === STORE_FILE && container === WHATSAPP_GROUP_CONTAINER) {
    return { workspace: WHATSAPP_GROUP_CONTAINER, workspaceName: 'WhatsApp for Mac' };
  }
  if (basename(path) === STORE_FILE && container === WHATSAPP_BUSINESS_CONTAINER) {
    return { workspace: WHATSAPP_BUSINESS_CONTAINER, workspaceName: 'WhatsApp Business' };
  }
  return { workspace: `file:${createHash('sha256').update(path).digest('hex').slice(0, 16)}` };
}

/** A new account record: its id minted here unless one is given (the spike's, carried over). */
export function newWhatsAppAccount(options: {
  now: Date;
  store: { path: string; isDefault: boolean };
  id?: string | undefined;
  createdAt?: string | undefined;
}): WhatsAppAccount {
  const id = options.id ?? newAccountId();
  return {
    id,
    platform: PLATFORM,
    ...storeIdentity(options.store.path, options.store.isDefault),
    userId: STORE_OWNER,
    tier: READ_MODE,
    mode: READ_MODE,
    grantedScopes: [...GRANTED_SCOPES],
    secretRef: noSecretRef(id),
    createdAt: options.createdAt ?? options.now.toISOString(),
    ...(options.store.isDefault ? {} : { source: options.store.path }),
  };
}

/**
 * The configuration has names this channel can use.
 *
 * WhatsApp accounts are `organisation/whatsapp`, which only version 2 of the configuration names. A version-1 file is
 * one an older release on this machine may still share; core's `names migrate` moves it on, and until then this
 * channel adds and reads nothing rather than invent a flat name for a platform that never had one. The refusal names
 * core's command as `handoffs` find it: the core this package installs.
 */
export function requireNamedConfig(config: Config, handoffs: HandoffMaker): void {
  if (config.version !== 2) {
    throw new CommsError(
      'CONFIG',
      'WhatsApp accounts need the organisation/platform names, and this configuration still has the old flat ones',
      {
        hint: handoffSentence(
          handoffs.core(['names', 'migrate', '--dry-run']),
          (dryRun) =>
            handoffSentence(
              handoffs.core(['names', 'migrate']),
              (migrate) => `Run ${dryRun} to see what everything would be called, then ${migrate}.`,
            ),
          { instead: 'Call comms_names_migrate from a chat.' },
        ),
      },
    );
  }
}

/** Every WhatsApp account's name, sorted. Other platforms' accounts in the same map are not this channel's. */
export function whatsappAccountNames(config: Config): string[] {
  return Object.entries(config.accounts)
    .filter(([, account]) => account.platform === PLATFORM)
    .map(([name]) => name)
    .sort();
}

function notFound(config: Config, name: string, handoffs: HandoffMaker): () => CommsError {
  return () => {
    const known = whatsappAccountNames(config);
    return new CommsError('NOT_FOUND', `no WhatsApp account called "${name}"`, {
      hint: known.length
        ? `Known accounts: ${known.join(', ')}.`
        : handoffSentenceToFill(
            handoffs.own(['add']),
            ['<organisation>/whatsapp'],
            (command) => `None yet: a person adds one with ${command}.`,
          ),
    });
  };
}

/**
 * The account under this name, checked to be one this channel can act on.
 *
 * Through core's `resolveName`, so a former name is refused with the name the account has now. Another platform's
 * account under the name is "not found", as a missing one is. A record whose mode is not `read`, or whose `source`
 * is not a store path this package would read, is refused rather than acted on: nothing here would know what it
 * means, and the vocabulary is closed (design §5). A refusal names this package's commands as `handoffs` find them.
 */
export function requireAccount(
  config: Config,
  name: string | undefined,
  handoffs: HandoffMaker,
): { name: string; account: WhatsAppAccount } {
  if (name === undefined || name === '') {
    throw new CommsError('USAGE', 'which WhatsApp account? there is no default', {
      hint: 'Pass the account, as `organisation/whatsapp`.',
    });
  }
  requireNamedConfig(config, handoffs);
  const { account } = resolveName(config, 'account', name, notFound(config, name, handoffs));
  if (account.platform !== PLATFORM) throw notFound(config, name, handoffs)();
  const mode = account.mode ?? account.tier;
  if (mode !== READ_MODE) {
    throw new CommsError('CONFIG', `"${name}" is recorded in mode "${String(mode)}", and WhatsApp accounts only read`, {
      hint: `Nothing was read. ${handoffSentence(handoffs.own(['remove', name]), (command) => `Remove it with ${command} and add it again.`)}`,
    });
  }
  const source = (account as WhatsAppAccount).source;
  if (source !== undefined && (typeof source !== 'string' || basename(source) !== STORE_FILE)) {
    throw new CommsError('CONFIG', `"${name}" names a store this package does not read`, {
      hint: `Only a file called ${STORE_FILE} is read. Remove the account and add it again.`,
    });
  }
  return { name, account: account as WhatsAppAccount };
}
