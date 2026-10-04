import {
  type AccountConfig,
  type ChangePolicy,
  CommsError,
  type Config,
  findById,
  inlineCommand,
  lookupName,
  nameAvailable,
  newAccountId,
  resolveName,
  type SendPolicy,
  shellCommand,
} from '@agentcomms/core';

/**
 * Where Resend accounts are kept — the one module that knows.
 *
 * **In core's configuration**, in its `accounts` map, as the generic record every channel after Gmail keeps (design
 * 2026-09-26 §5): `id`, `platform` (`resend`), `workspace` and `userId` (both the key's fingerprint, `key_` + 8 hex
 * characters of its SHA-256 — Resend's API does not expose the team, and one key belongs to one team), `tier` and
 * `mode` (`read` or `send`), `grantedScopes` (what the key itself can do: `full_access` or `sending_access`),
 * `secretRef` (`resend:key:<id>`), the two policies, `createdAt` — and one key of Resend's own, `domainLock`, the
 * domain a person said a sending-only key is restricted to. It is a record of what was declared, never a safety
 * setting: only `sendPolicy`, `changePolicy` and `mode` are judged when a change loosens something, and they are
 * core's to judge.
 *
 * So everything core does with an account now sees these: a name is looked up through `resolveName`, which refuses a
 * former name with the one it has now; `names migrate` renames them; `secrets migrate` moves their keys; a loosening
 * is classified by `classifyChange` and approved under the account's own `changePolicy` when it sets one; and a
 * server pinned with `--account` is checked against them.
 *
 * What stays here is what core cannot say about a Resend account: that its mode is one of the two words (a record
 * with any other is refused, never read as something narrower), what its key can do, and that its secret reference
 * is its own.
 */

export const PLATFORM = 'resend';

export const MODES = ['read', 'send'] as const;
export type Mode = (typeof MODES)[number];
export const KEY_PERMISSIONS = ['full_access', 'sending_access'] as const;
export type KeyPermission = (typeof KEY_PERMISSIONS)[number];
export const SEND_POLICIES = ['chat', 'confirm', 'never'] as const;
export const CHANGE_POLICIES = ['chat', 'confirm'] as const;

/** A Resend account: core's generic record, checked, with Resend's one key of its own. */
export interface ResendAccount extends AccountConfig {
  platform: 'resend';
  /** `read` or `send`, and nothing else: a record with another word is refused. `tier` says the same. */
  mode: Mode;
  /** For a `sending_access` key: the one domain the person said it is restricted to. Declared, not detected. */
  domainLock?: string | undefined;
}

export interface NamedAccount {
  name: string;
  account: ResendAccount;
}

/** Where an account's key is kept in core's secret store: prefixed by the platform, as the contract says. */
export function secretRefFor(id: string): string {
  return `resend:key:${id}`;
}

export function newResendAccountId(): string {
  return newAccountId();
}

const DOMAIN = /^[a-z0-9.-]+\.[a-z]{2,}$/;

/** What the key itself can do, as it was detected when the account was added: recorded in `grantedScopes`. */
export function keyPermissionOf(account: Pick<AccountConfig, 'grantedScopes'>): KeyPermission {
  return account.grantedScopes.includes('full_access') ? 'full_access' : 'sending_access';
}

/**
 * The record under `name`, checked to be a Resend account this release can act on — or a refusal naming what is
 * wrong. Core's schema reads any mode word so that one odd account cannot make the whole file unreadable; acting on
 * one is refused here, as Slack refuses its own.
 */
export function checkedAccount(
  name: string,
  account: AccountConfig,
  platform: NodeJS.Platform = process.platform,
): ResendAccount {
  const problem = (() => {
    if (account.platform !== PLATFORM) return `it is a ${account.platform} account`;
    if (!(MODES as readonly string[]).includes(String(account.mode))) {
      return `its mode is "${String(account.mode)}", and a Resend account is in read or send mode`;
    }
    const permissions = account.grantedScopes.filter((scope) => (KEY_PERMISSIONS as readonly string[]).includes(scope));
    if (permissions.length !== 1) return 'it does not record whether its key has full or sending-only access';
    if (account.secretRef !== secretRefFor(account.id)) return 'its secret reference is not its own';
    const lock = (account as { domainLock?: unknown }).domainLock;
    if (lock !== undefined && (typeof lock !== 'string' || !DOMAIN.test(lock))) return 'its domainLock is not a domain';
    return null;
  })();
  if (problem !== null) {
    throw new CommsError('CONFIG', `"${name}" is not a Resend account this release can act on: ${problem}`, {
      hint: `Remove it with ${inlineCommand(shellCommand(['agent-resend', 'account', 'remove', name], platform))} and add it again, or fix it in the configuration file.`,
    });
  }
  return account as ResendAccount;
}

function notFound(name: string): () => CommsError {
  return () =>
    new CommsError('NOT_FOUND', `there is no Resend account called "${name}"`, {
      hint: 'List them with `agent-resend account list`; a person adds one with `agent-resend account add <org/resend>`.',
    });
}

/** Every Resend account in `config`, checked, by name. */
export function resendAccounts(config: Config, platform: NodeJS.Platform = process.platform): NamedAccount[] {
  return Object.entries(config.accounts)
    .filter(([, account]) => account.platform === PLATFORM)
    .map(([name, account]) => ({ name, account: checkedAccount(name, account, platform) }))
    .sort((a, b) => (a.name < b.name ? -1 : 1));
}

/**
 * The account by name, or a refusal that says what to do — through core's `resolveName`, so a name that was replaced
 * is refused with the one it has now rather than reported as unknown.
 */
export function requireAccount(
  config: Config,
  name: string,
  platform: NodeJS.Platform = process.platform,
): NamedAccount {
  const { alias, account } = resolveName(config, 'account', name, notFound(name));
  if (account.platform !== PLATFORM) throw notFound(name)();
  return { name: alias, account: checkedAccount(alias, account, platform) };
}

/** The account under exactly this name, or null: no former names, no refusal. */
export function lookupAccount(
  config: Config,
  name: string,
  platform: NodeJS.Platform = process.platform,
): NamedAccount | null {
  const account = lookupName(config, 'account', name);
  if (!account || account.platform !== PLATFORM) return null;
  return { name, account: checkedAccount(name, account, platform) };
}

/** The account by its immutable id, under whatever name it has now. */
export function accountById(
  config: Config,
  id: string,
  platform: NodeJS.Platform = process.platform,
): NamedAccount | null {
  const found = findById(config, 'account', id);
  if (!found || found.account.platform !== PLATFORM) return null;
  return { name: found.alias, account: checkedAccount(found.alias, found.account, platform) };
}

/**
 * Refuses a name a new account cannot take — core's rule, for either config version: the grammar and the platform,
 * free in both maps, and never a former name — with this package's own hint for one already connected.
 */
export function checkNewName(config: Config, name: string, platform: NodeJS.Platform = process.platform): void {
  const check = nameAvailable(config, 'account', name, PLATFORM);
  if (check.ok) return;
  if (lookupName(config, 'account', name) || lookupName(config, 'inbox', name)) {
    throw new CommsError('USAGE', `there is already an account called "${name}"`, {
      hint: `Choose another name, or remove that one first with ${inlineCommand(shellCommand(['agent-resend', 'account', 'remove', name], platform))}.`,
    });
  }
  throw check.error;
}

/** `config` with `account` under `name`. */
export function withAccount(config: Config, name: string, account: ResendAccount): Config {
  return { ...config, accounts: { ...config.accounts, [name]: account } };
}

/** `config` without the account under `name`. */
export function withoutAccount(config: Config, name: string): Config {
  const accounts: Config['accounts'] = {};
  for (const [key, value] of Object.entries(config.accounts)) if (key !== name) accounts[key] = value;
  return { ...config, accounts };
}

/** The send policy in force for an account: its own, else the machine's default. */
export function sendPolicyIn(config: Config, account: ResendAccount): SendPolicy {
  return account.sendPolicy ?? config.defaults.sendPolicy;
}

/** The change policy in force for an account: its own, else the machine's default, `chat` when none is set. */
export function changePolicyIn(config: Config, account: ResendAccount): ChangePolicy {
  return account.changePolicy ?? config.defaults.changePolicy ?? 'chat';
}

/**
 * Reading accounts from core's configuration as it is now. Writes go through `core.config.update`, which validates
 * the file and refuses any loosening the caller holds no consent for.
 */
export class AccountStore {
  readonly #load: () => Promise<Config>;
  readonly #platform: NodeJS.Platform;

  constructor(load: () => Promise<Config>, platform: NodeJS.Platform = process.platform) {
    this.#load = load;
    this.#platform = platform;
  }

  async list(): Promise<NamedAccount[]> {
    return resendAccounts(await this.#load(), this.#platform);
  }

  async find(name: string): Promise<NamedAccount | null> {
    return lookupAccount(await this.#load(), name, this.#platform);
  }

  async findById(id: string): Promise<NamedAccount | null> {
    return accountById(await this.#load(), id, this.#platform);
  }

  async require(name: string): Promise<NamedAccount> {
    return requireAccount(await this.#load(), name, this.#platform);
  }
}
