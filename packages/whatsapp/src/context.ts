import { CommsError, type Config, type Core, openCore } from '@agentcomms/core';
import { PLATFORM, requireAccount, type WhatsAppAccount, whatsappAccountNames } from './config.ts';
import { accountStateDir } from './index-db.ts';
import { ChatListStore } from './lists.ts';
import { defaultStorePath } from './source/location.ts';
import type { SourceIo, SourceOptions } from './source/snapshot.ts';
import { describeMigration, migrateSpikeAccounts, type SpikeMigration } from './spike-migration.ts';
import type { ChatLists } from './visibility.ts';

/**
 * What every operation needs, assembled once — the same shape as the Slack and Gmail contexts, minus what this
 * package does not have: no secret store is ever opened (there is no session and no token), nothing is sent, and there
 * is no network client of any kind.
 *
 * Accounts are core's (`config.json`'s `accounts`), read through core's `ConfigStore`; the person's chat lists are this
 * package's own file (`lists.ts`). The first read of the configuration in a process moves the spike's accounts in, when
 * there are any (`spike-migration.ts`).
 */

export interface WhatsAppContextOptions {
  env?: NodeJS.ProcessEnv | undefined;
  now?: (() => Date) | undefined;
  surface?: 'cli' | 'mcp' | undefined;
  /**
   * The one account a pinned server serves (`agent-whatsapp mcp --account`): every call acts on it and no other, and
   * nothing about any other account is said.
   */
  account?: string | undefined;
  /** Where a line for the person goes — the spike migration's. The command line passes stderr. */
  log?: ((line: string) => void) | undefined;
  /** The file operations on WhatsApp's store. Injected so a test can deny, hang or race them. */
  sourceIo?: SourceIo | undefined;
  sourceTimeoutMs?: number | undefined;
  platform?: NodeJS.Platform | undefined;
}

export interface ResolvedAccount {
  name: string;
  account: WhatsAppAccount;
  lists: ChatLists;
}

export class WhatsAppContext {
  readonly env: NodeJS.ProcessEnv;
  readonly now: () => Date;
  readonly surface: 'cli' | 'mcp';
  readonly platform: NodeJS.Platform;
  readonly core: Core;
  readonly lists: ChatListStore;
  /** The name a pinned server was started for, as given. */
  readonly pinned: string | undefined;
  readonly #log: ((line: string) => void) | undefined;
  #migration: Promise<SpikeMigration | null> | null = null;
  #pinnedId: string | undefined;
  readonly #source: {
    io?: SourceIo | undefined;
    timeoutMs?: number | undefined;
    platform?: NodeJS.Platform | undefined;
  };

  constructor(options: WhatsAppContextOptions = {}) {
    this.env = options.env ?? process.env;
    this.now = options.now ?? (() => new Date());
    this.surface = options.surface ?? 'cli';
    this.platform = options.platform ?? process.platform;
    this.core = openCore({ env: this.env, now: this.now });
    this.lists = new ChatListStore(this.core.paths.configDir);
    this.pinned = options.account;
    this.#log = options.log;
    this.#source = { io: options.sourceIo, timeoutMs: options.sourceTimeoutMs, platform: this.platform };
  }

  /** The spike's accounts moved in, once per process; what happened, when there was a spike file to move. */
  migration(): Promise<SpikeMigration | null> {
    this.#migration ??= migrateSpikeAccounts({
      core: this.core,
      lists: this.lists,
      env: this.env,
      now: this.now,
      surface: this.surface,
    }).then((result) => {
      if (result) this.#log?.(`agent-whatsapp: ${describeMigration(result)}`);
      return result;
    });
    return this.#migration;
  }

  /** core's configuration, after the spike's accounts have moved into it. */
  async config(): Promise<Config> {
    await this.migration();
    return this.core.config.load();
  }

  /**
   * The server's pin, checked to name a WhatsApp account, and remembered by its id.
   *
   * By id, as Slack's server does, because a rename can move the name under a running server: the pin follows the
   * account, and a new account that took the name afterwards is not one anybody pinned this server to.
   */
  async checkPin(): Promise<void> {
    if (this.pinned === undefined) return;
    this.#pinnedId = requireAccount(await this.config(), this.pinned, this.platform).account.id;
  }

  /** The name a call acts on: the one it gave, checked against the pin when there is one. */
  async #nameFor(config: Config, named: string | undefined): Promise<string | undefined> {
    if (this.pinned === undefined) return named;
    if (this.#pinnedId === undefined) await this.checkPin();
    const current = Object.entries(config.accounts).find(
      ([, account]) => account.id === this.#pinnedId && account.platform === PLATFORM,
    );
    const restart = 'Restart the client so the server starts again for the account it should serve.';
    if (!current) {
      throw new CommsError('NOT_FOUND', `the account this server was pinned to, "${this.pinned}", was removed`, {
        hint: restart,
      });
    }
    const [name] = current;
    if (named !== undefined && named !== name) {
      throw new CommsError('USAGE', `this server is pinned to "${name}" and cannot act on "${named}"`, {
        hint: `Call it without an account, or with "${name}".`,
      });
    }
    return name;
  }

  /** One account, resolved and checked, with the person's lists for it — which every read applies. */
  async account(named: string | undefined): Promise<ResolvedAccount> {
    const config = await this.config();
    const { name, account } = requireAccount(config, await this.#nameFor(config, named), this.platform);
    return { name, account, lists: await this.lists.of(account.id) };
  }

  /** The accounts a call without one covers: every WhatsApp account, or the pinned one alone. */
  async accountNames(): Promise<string[]> {
    const config = await this.config();
    if (this.pinned !== undefined) return [(await this.#nameFor(config, undefined)) as string];
    // A version-1 file holds no WhatsApp account — none can be added to one, and the spike's wait — so: none.
    return config.version === 2 ? whatsappAccountNames(config) : [];
  }

  /** Where an account's store is, and whether that is the WhatsApp for Mac default. */
  storeOf(account: WhatsAppAccount): { path: string; isDefault: boolean } {
    return account.source === undefined
      ? { path: defaultStorePath(this.env), isDefault: true }
      : { path: account.source, isDefault: false };
  }

  sourceOptions(isDefault: boolean): SourceOptions {
    return { ...this.#source, env: this.env, isDefault };
  }

  /** The account's own directory under core's state directory: its index and its brief snapshots. */
  accountDir(account: WhatsAppAccount): string {
    return accountStateDir(this.core.paths.stateDir, account.id);
  }

  /**
   * The lock a sync and a remove of this account both hold, so neither runs while the other does. Beside the
   * account's directory rather than in it, because a remove deletes the directory while it holds the lock.
   */
  syncLock(account: WhatsAppAccount): string {
    return `${this.accountDir(account)}.sync.lock`;
  }

  /**
   * The account with this id as it is now, under whatever name it has now, with its lists as they are now — or null
   * when it is gone. For a sync to look again, under its lock, at what it started with.
   */
  async accountById(id: string): Promise<ResolvedAccount | null> {
    const config = await this.config();
    const found = Object.entries(config.accounts).find(
      ([, account]) => account.id === id && account.platform === PLATFORM,
    );
    if (!found) return null;
    const [name, account] = found;
    return { name, account: account as WhatsAppAccount, lists: await this.lists.of(id) };
  }
}
