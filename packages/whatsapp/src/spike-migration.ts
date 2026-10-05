import { chmod, readFile, rename, stat } from 'node:fs/promises';
import { isAbsolute, join } from 'node:path';
import {
  ACCOUNT_ID_PATTERN,
  type Config,
  type Core,
  type HandoffMaker,
  handoffSentence,
  nameAvailable,
  nameShapeProblem,
  withFileLock,
} from '@agentcomms/core';
import { z } from 'zod';
import { CHAT_ID } from './chat-ref.ts';
import { newWhatsAppAccount, PLATFORM } from './config.ts';
import { accountStateDir } from './index-db.ts';
import type { ChatListStore } from './lists.ts';
import { checkStorePath, defaultStorePath } from './source/location.ts';

/**
 * The one-time move of the spike's accounts into core's configuration.
 *
 * The spike kept its accounts in `whatsapp-spike.json` beside `config.json`, because core then had nowhere generic to
 * put them. It does now (design 2026-09-26 §5), so the first run of this release on a machine that has the spike's
 * file moves what is in it and puts the file aside. It never opens WhatsApp's store, or the spike's index of it: what
 * it moves is names, ids, an optional store path and the person's lists, all of them in that one file.
 *
 * - **The id is kept.** The spike's index lives under the account's id (`<state>/whatsapp/<id>`), so the account
 *   reads the same index it did, and nothing has to be synced again.
 * - **The lists go first.** They are written to this package's own lists file before the accounts reach
 *   `config.json`, so there is no moment at which an account is visible without the chats its person hid.
 * - **A name that is taken is not forced.** One that is already another account's, or was one's, or is not an
 *   `organisation/whatsapp` name, is not moved, and the log says which and why; the rest move.
 * - **Once.** The file is renamed to `whatsapp-spike.json.migrated-<time>` afterwards — kept, not deleted, so what did
 *   not move is still there to read — and an account already in the configuration under its id is not moved twice,
 *   so a run that stopped before the rename finishes on the next one.
 * - **Logged.** A line in core's audit log, and a line on stderr for the person when a command did it.
 *
 * A version-1 configuration has no `organisation/whatsapp` names, so nothing moves until core's `names migrate` has
 * run — named as the context's handoffs find core's command — and the file stays where it is for the next run.
 */

export const SPIKE_CONFIG_FILE = 'whatsapp-spike.json';

const spikeAccountSchema = z.looseObject({
  id: z.string().regex(ACCOUNT_ID_PATTERN),
  source: z.string().min(1).optional(),
  createdAt: z.string().min(1),
  chats: z
    .looseObject({ allow: z.array(z.string().regex(CHAT_ID)), deny: z.array(z.string().regex(CHAT_ID)) })
    .optional(),
});

const spikeSchema = z.looseObject({
  version: z.literal(1),
  accounts: z.record(z.string(), z.unknown()),
});

export interface SpikeMigration {
  /** Moved into `config.json` by this run. */
  migrated: string[];
  /** Already there, by id, from an earlier run that stopped before it could put the file aside. */
  alreadyThere: string[];
  /**
   * Left in the old file, with why — and, when the spike built one for it, where its index still is: a plaintext copy
   * of its messages that no account reads now and no command deletes.
   */
  skipped: { name: string; reason: string; index?: string | undefined }[];
  /** Where the old file went, or null when it stayed because nothing could be moved yet (`deferred`). */
  keptAs: string | null;
  /** Why nothing moved at all, when nothing could. */
  deferred?: string | undefined;
}

export interface MigrationContext {
  core: Core;
  /** What the log names to run: core's `names migrate`, located. */
  handoffs: HandoffMaker;
  lists: ChatListStore;
  env: NodeJS.ProcessEnv;
  now: () => Date;
  surface: 'cli' | 'mcp';
}

function stamp(now: Date): string {
  return now
    .toISOString()
    .replace(/[-:]/g, '')
    .replace(/\.\d+Z$/, 'Z');
}

/** Null when there is no spike file here — every machine but the few that ran the spike. */
export async function migrateSpikeAccounts(context: MigrationContext): Promise<SpikeMigration | null> {
  const configDir = context.core.paths.configDir;
  const path = join(configDir, SPIKE_CONFIG_FILE);
  // The spike's own lock, so a spike binary still running on this machine cannot write the file while it moves.
  return withFileLock(join(configDir, '.whatsapp-spike.lock'), async () => {
    let text: string;
    try {
      text = await readFile(path, 'utf8');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw error;
    }
    const result: SpikeMigration = { migrated: [], alreadyThere: [], skipped: [], keptAs: null };
    let raw: unknown;
    try {
      raw = JSON.parse(text);
    } catch {
      return { ...result, deferred: `${SPIKE_CONFIG_FILE} is not valid JSON, so nothing was moved from it` };
    }
    const spike = spikeSchema.safeParse(raw);
    if (!spike.success) {
      return { ...result, deferred: `${SPIKE_CONFIG_FILE} is not a spike configuration this release reads` };
    }
    const config = await context.core.config.load();
    if (config.version !== 2) {
      return {
        ...result,
        deferred: `the configuration still has the old flat names; ${handoffSentence(
          context.handoffs.core(['names', 'migrate']),
          (command) => `after ${command}, the spike’s accounts move on the next run`,
          { instead: 'after comms_names_migrate, the spike’s accounts move on the next run.' },
        ).replace(/\.$/, '')}`,
      };
    }

    const moving: {
      name: string;
      account: ReturnType<typeof newWhatsAppAccount>;
      lists?: { allow: string[]; deny: string[] };
    }[] = [];
    const records = Object.entries(spike.data.accounts).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    for (const [name, record] of records) {
      const entry = spikeAccountSchema.safeParse(record);
      if (!entry.success) {
        result.skipped.push({ name, reason: 'its record is not one the spike wrote' });
        continue;
      }
      const { id, source, createdAt, chats } = entry.data;
      const held = Object.entries(config.accounts).find(([, account]) => account.id === id);
      if (held) {
        if (held[1].platform === PLATFORM) result.alreadyThere.push(held[0]);
        else result.skipped.push({ name, reason: `its id is already a ${held[1].platform} account's` });
        continue;
      }
      const problem = nameShapeProblem(name, PLATFORM);
      if (problem) {
        result.skipped.push({ name, reason: problem });
        continue;
      }
      const free = nameAvailable(config, 'account', name, PLATFORM);
      if (!free.ok) {
        result.skipped.push({ name, reason: free.error.message });
        continue;
      }
      let store: { path: string; isDefault: boolean };
      try {
        store =
          source === undefined
            ? { path: defaultStorePath(context.env), isDefault: true }
            : { path: checkStorePath(source), isDefault: false };
      } catch (error) {
        result.skipped.push({ name, reason: error instanceof Error ? error.message : String(error) });
        continue;
      }
      if (!store.isDefault && !isAbsolute(store.path)) {
        result.skipped.push({ name, reason: 'its store is not an absolute path' });
        continue;
      }
      const account = newWhatsAppAccount({ now: context.now(), store, id, createdAt });
      const lists =
        chats && (chats.allow.length > 0 || chats.deny.length > 0)
          ? { allow: [...chats.allow], deny: [...chats.deny] }
          : undefined;
      moving.push({ name, account, ...(lists ? { lists } : {}) });
    }

    // The lists first: an account never reaches `config.json` before the chats its person hid are hidden.
    for (const { account, lists } of moving) {
      if (lists) await context.lists.update(account.id, () => lists);
    }
    if (moving.length > 0) {
      await context.core.config.update((current: Config) => {
        const accounts = { ...current.accounts };
        for (const { name, account } of moving) {
          // Checked again inside the lock: anything could have taken the name since it was read.
          if (Object.hasOwn(accounts, name) || !nameAvailable(current, 'account', name, PLATFORM).ok) continue;
          accounts[name] = account;
          result.migrated.push(name);
        }
        return { ...current, accounts };
      });
    }
    for (const { name } of moving) {
      if (!result.migrated.includes(name)) result.skipped.push({ name, reason: 'the name was taken while it moved' });
    }
    // Where a skipped account's index was left: said, not deleted — deleting is the person's call.
    const idOf = new Map(records.map(([name, record]) => [name, spikeAccountSchema.safeParse(record).data?.id]));
    for (const entry of result.skipped) {
      const id = idOf.get(entry.name);
      if (id === undefined) continue;
      const folder = accountStateDir(context.core.paths.stateDir, id);
      if (
        await stat(folder).then(
          (info) => info.isDirectory(),
          () => false,
        )
      ) {
        entry.index = folder;
      }
    }

    // Put aside, so this happens once: what did not move is still in the renamed file, and the log says why.
    const keptAs = `${path}.migrated-${stamp(context.now())}`;
    await rename(path, keptAs);
    if (process.platform !== 'win32') await chmod(keptAs, 0o600).catch(() => undefined);
    result.keptAs = keptAs;
    await context.core.audit
      .append({
        inboxId: '',
        operation: 'whatsapp.accounts.migrate',
        outcome: result.skipped.length === 0 ? 'ok' : 'failed',
        surface: context.surface,
        reason: describeMigration(result),
        ids: { accounts: moving.filter(({ name }) => result.migrated.includes(name)).map(({ account }) => account.id) },
      })
      .catch(() => undefined);
    return result;
  });
}

/** One sentence for the audit log and for stderr. */
export function describeMigration(result: SpikeMigration): string {
  if (result.deferred) return `The WhatsApp spike's accounts were not moved: ${result.deferred}.`;
  const parts: string[] = [];
  if (result.migrated.length > 0) {
    parts.push(
      `Moved the WhatsApp spike's account${result.migrated.length === 1 ? '' : 's'} ${result.migrated.join(', ')} from ${SPIKE_CONFIG_FILE} into config.json, with ${result.migrated.length === 1 ? 'its' : 'their'} index and chat lists as they were.`,
    );
  }
  if (result.alreadyThere.length > 0) parts.push(`${result.alreadyThere.join(', ')} had already moved.`);
  for (const { name, reason, index } of result.skipped) {
    parts.push(`${name} was not moved: ${reason}.`);
    if (index) {
      parts.push(
        `Its index, a plaintext copy of its messages, is still at ${index}; no account reads it now, so delete that folder unless you move the account by hand.`,
      );
    }
  }
  if (result.keptAs) parts.push(`The old file is kept as ${result.keptAs}.`);
  return parts.join(' ');
}
