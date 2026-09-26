import { type ResolvedPaths, resolvePaths } from '@agentcomms/core';
import { SpikeConfigStore, type WhatsAppAccount } from './config.ts';
import { accountStateDir } from './index-db.ts';
import { defaultStorePath } from './source/location.ts';
import type { SourceIo, SourceOptions } from './source/snapshot.ts';

/**
 * What every operation needs, assembled once — the same shape as the Slack and Gmail contexts, minus what this
 * package does not have: no secret store (there is no session and no token), no approvals (nothing is ever sent),
 * no network client of any kind.
 */

export interface WhatsAppContextOptions {
  env?: NodeJS.ProcessEnv | undefined;
  now?: (() => Date) | undefined;
  surface?: 'cli' | 'mcp' | undefined;
  /** The file operations on WhatsApp's store. Injected so a test can deny, hang or race them. */
  sourceIo?: SourceIo | undefined;
  sourceTimeoutMs?: number | undefined;
  platform?: NodeJS.Platform | undefined;
}

export class WhatsAppContext {
  readonly env: NodeJS.ProcessEnv;
  readonly now: () => Date;
  readonly surface: 'cli' | 'mcp';
  readonly paths: ResolvedPaths;
  readonly config: SpikeConfigStore;
  readonly #source: {
    io?: SourceIo | undefined;
    timeoutMs?: number | undefined;
    platform?: NodeJS.Platform | undefined;
  };

  constructor(options: WhatsAppContextOptions = {}) {
    this.env = options.env ?? process.env;
    this.now = options.now ?? (() => new Date());
    this.surface = options.surface ?? 'cli';
    this.paths = resolvePaths({ env: this.env });
    this.config = new SpikeConfigStore(this.paths.configDir);
    this.#source = { io: options.sourceIo, timeoutMs: options.sourceTimeoutMs, platform: options.platform };
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

  /** The account's own directory under core's state directory: its index, its sync lock, its brief snapshots. */
  accountDir(account: WhatsAppAccount): string {
    return accountStateDir(this.paths.stateDir, account.id);
  }
}
