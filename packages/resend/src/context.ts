import {
  CommsError,
  type Config,
  type Core,
  openCore,
  type SecretStore,
  type SendPolicy,
  secretsStoreOf,
} from '@agentcomms/core';
import { AccountStore, type NamedAccount } from './accounts.ts';
import type { ResendTransport } from './api/client.ts';
import type { FetchLike, WritePermit } from './api/guard.ts';
import { Throttle, type ThrottleOptions } from './api/throttle.ts';

/**
 * What every Resend operation needs, assembled once — the same shape as the Gmail and Slack contexts.
 *
 * The key is read from core's secret store here and nowhere else, handed to one transport, and never put in a result.
 */

export interface ResendContextOptions {
  core?: Core | undefined;
  env?: NodeJS.ProcessEnv | undefined;
  now?: (() => Date) | undefined;
  surface?: 'cli' | 'mcp' | undefined;
  /** The inner fetch every request goes through, always inside the guard. Injected so a test never reaches Resend. */
  fetch?: FetchLike | undefined;
  /** The throttle's clock and pause. Tests shorten the pause; nothing a person or an agent passes can. */
  throttle?: ThrottleOptions | undefined;
}

export class ResendContext {
  readonly core: Core;
  readonly env: NodeJS.ProcessEnv;
  readonly now: () => Date;
  readonly surface: 'cli' | 'mcp';
  readonly accounts: AccountStore;
  readonly #fetch: FetchLike | undefined;
  readonly #throttle: ThrottleOptions | undefined;

  constructor(options: ResendContextOptions = {}) {
    this.env = options.env ?? process.env;
    this.core = options.core ?? openCore({ env: this.env });
    this.now = options.now ?? (() => new Date());
    this.surface = options.surface ?? 'cli';
    this.accounts = new AccountStore(() => this.core.config.load());
    this.#fetch = options.fetch;
    this.#throttle = options.throttle;
  }

  config(): Promise<Config> {
    return this.core.config.load();
  }

  /** The secret store this configuration chose, or the keychain before anything has been stored. */
  async secrets(): Promise<SecretStore> {
    return this.core.secrets(secretsStoreOf(await this.config()));
  }

  /** The machine's default send policy, which an account without one of its own inherits. */
  async defaultSendPolicy(): Promise<SendPolicy> {
    return (await this.config()).defaults.sendPolicy;
  }

  throttleFor(accountId: string): Throttle {
    return new Throttle(this.core.paths.stateDir, accountId, this.#throttle);
  }

  /** A transport for a key that is not stored yet — `account add` checking what it was given. */
  transportForKey(key: string, accountId: string): ResendTransport {
    return { fetch: this.#fetch, key, throttle: this.throttleFor(accountId) };
  }

  /** A transport for a connected account: its key from the secret store, its throttle, and a permit if one is open. */
  async transport(named: NamedAccount, permit?: WritePermit): Promise<ResendTransport> {
    const key = await (await this.secrets()).get(named.account.secretRef);
    if (key === null || key.trim() === '') {
      throw new CommsError('AUTH_REQUIRED', `the key for "${named.name}" is not in the secret store`, {
        hint: `A person removes the account and adds it again: \`agent-resend account add ${named.name}\`.`,
      });
    }
    return { fetch: this.#fetch, key, throttle: this.throttleFor(named.account.id), permit };
  }
}
