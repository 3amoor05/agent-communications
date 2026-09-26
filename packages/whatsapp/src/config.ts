import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import {
  ACCOUNT_ID_PATTERN,
  CommsError,
  nameShapeProblem,
  newAccountId,
  withFileLock,
  writeFileAtomic,
} from '@agentcomms/core';
import { z } from 'zod';
import { CHAT_ID } from './chat-ref.ts';
import type { ChatLists } from './visibility.ts';

/**
 * The spike's own configuration, in its own file beside core's `config.json`.
 *
 * Not in `config.json`, on purpose. Core's `accounts` map is Slack-shaped — `workspace`, `userId`, `tier` and
 * `grantedScopes` are required, and none means anything for a message store on this Mac — and every released server
 * (0.6.0) reads that file. An unreleased spike writing a record of a platform those servers have never seen into the
 * file they all share is the one thing a spike must not do. So the names follow core's grammar
 * (`organisation/whatsapp`, checked by core's own `nameShapeProblem`), and the records live here. What core would need
 * to host a third channel properly is written up in the package README.
 */

export const SPIKE_CONFIG_FILE = 'whatsapp-spike.json';
export const PLATFORM = 'whatsapp';

export interface WhatsAppAccount {
  /** Immutable, as core's account ids are: the index lives under it, so a rename would not move any data. */
  id: string;
  /**
   * The message store, when it is not the default WhatsApp for Mac location. Absent means the default, resolved from
   * the home directory at run time, so the file stays true if the home directory moves.
   */
  source?: string | undefined;
  createdAt: string;
  /**
   * Which chats an agent may see: the person's allow and deny lists (see `visibility.ts`), set with `allow`, `deny`
   * and `clear` at their terminal. Absent means neither list: every chat is visible.
   */
  chats?: ChatLists | undefined;
}

/** Long enough for any real list, short enough that a hand-edited file cannot make every read slow. */
export const CHAT_LIST_LIMIT = 1000;

export interface SpikeConfig {
  version: 1;
  accounts: Record<string, WhatsAppAccount>;
}

const chatList = z
  .array(z.string().regex(CHAT_ID, 'a chat list holds chat ids, such as 15555550101@s.whatsapp.net'))
  .max(CHAT_LIST_LIMIT);

const accountSchema = z.strictObject({
  id: z.string().regex(ACCOUNT_ID_PATTERN, 'account ids look like acc_ followed by 16 characters'),
  source: z.string().min(1).optional(),
  createdAt: z.string().min(1),
  chats: z.strictObject({ allow: chatList, deny: chatList }).optional(),
});

const configSchema = z
  .strictObject({
    version: z.literal(1),
    accounts: z.record(z.string(), accountSchema),
  })
  .superRefine((config, ctx) => {
    for (const name of Object.keys(config.accounts)) {
      const problem = nameShapeProblem(name, PLATFORM);
      if (problem) ctx.addIssue({ code: 'custom', path: ['accounts', name], message: problem });
    }
  });

export function emptySpikeConfig(): SpikeConfig {
  return { version: 1, accounts: {} };
}

/**
 * The account under exactly this name, or undefined.
 *
 * An own property only, and never `accounts[name]`: a name is user input and the map is a plain object, so
 * `constructor` would otherwise find a function. Core's `resolveName` does this for `config.json`; it cannot be used
 * here because this file is not a core `Config` — one of the things the README lists for core to change.
 */
export function accountNamed(config: SpikeConfig, name: string): WhatsAppAccount | undefined {
  if (!Object.hasOwn(config.accounts, name)) return undefined;
  return new Map(Object.entries(config.accounts)).get(name);
}

export function requireAccount(
  config: SpikeConfig,
  name: string | undefined,
): { name: string; account: WhatsAppAccount } {
  if (name === undefined || name === '') {
    throw new CommsError('USAGE', 'which WhatsApp account? there is no default', {
      hint: 'Pass the account, as `organisation/whatsapp`.',
    });
  }
  const account = accountNamed(config, name);
  if (!account) {
    const known = Object.keys(config.accounts);
    throw new CommsError('NOT_FOUND', `no WhatsApp account called "${name}"`, {
      hint: known.length
        ? `Known accounts: ${known.join(', ')}.`
        : 'None yet: a person adds one with `agent-whatsapp add <organisation/whatsapp>`.',
    });
  }
  return { name, account };
}

export function newWhatsAppAccount(now: Date, source?: string): WhatsAppAccount {
  return { id: newAccountId(), ...(source === undefined ? {} : { source }), createdAt: now.toISOString() };
}

export class SpikeConfigStore {
  readonly path: string;
  readonly #lockPath: string;

  constructor(configDir: string) {
    this.path = join(configDir, SPIKE_CONFIG_FILE);
    this.#lockPath = join(configDir, '.whatsapp-spike.lock');
  }

  async load(): Promise<SpikeConfig> {
    let text: string;
    try {
      text = await readFile(this.path, 'utf8');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return emptySpikeConfig();
      throw error;
    }
    let raw: unknown;
    try {
      raw = JSON.parse(text);
    } catch {
      throw new CommsError('CONFIG', `${this.path} is not valid JSON`, { hint: 'Fix or remove the file.' });
    }
    const parsed = configSchema.safeParse(raw);
    if (!parsed.success) {
      const first = parsed.error.issues[0];
      throw new CommsError(
        'CONFIG',
        `${this.path} is not a valid WhatsApp spike config: ${first?.message ?? 'invalid'}`,
      );
    }
    return parsed.data as SpikeConfig;
  }

  /** Read-modify-write under a lock, validated before it is written, as core's `ConfigStore.update` does. */
  async update(mutator: (config: SpikeConfig) => SpikeConfig): Promise<SpikeConfig> {
    return withFileLock(this.#lockPath, async () => {
      const next = mutator(structuredClone(await this.load()));
      const parsed = configSchema.safeParse(next);
      if (!parsed.success) {
        throw new CommsError('CONFIG', `refusing to write an invalid config: ${parsed.error.issues[0]?.message}`);
      }
      await writeFileAtomic(this.path, `${JSON.stringify(parsed.data, null, 2)}\n`);
      return parsed.data as SpikeConfig;
    });
  }
}
