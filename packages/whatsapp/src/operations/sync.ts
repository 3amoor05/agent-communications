import { CommsError, ensurePrivateDir, withFileLock } from '@agentcomms/core';
import type { WhatsAppContext } from '../context.ts';
import { type IndexStats, rebuildIndex } from '../index-db.ts';
import { inspectSchema } from '../source/schema.ts';
import { removeStaleSnapshots, snapshotStore } from '../source/snapshot.ts';
import { openDatabase } from '../sqlite.ts';
import { type ChatLists, Visibility } from '../visibility.ts';

/**
 * The one operation that reads WhatsApp's files: copy the store, check the copy, rebuild the index, delete the copy.
 *
 * In that order, and all of it or none of it: a copy that fails SQLite's check, or a store whose layout has drifted,
 * leaves the previous index exactly as it was, and the copy is deleted whatever happens.
 */

export interface SyncResult extends IndexStats {
  account: string;
  store: { path: string; default: boolean };
  snapshot: { attempts: number; deleted: true; staleRemoved: number };
}

/** Builds tried before a sync whose lists keep changing under it gives up. */
const LIST_ROUNDS = 3;

function removedWhileSyncing(name: string): CommsError {
  return new CommsError('NOT_FOUND', `"${name}" was removed while it was being synced, so nothing was indexed`, {
    hint: 'Add it again with `agent-whatsapp add` to read it.',
  });
}

function sameLists(a: ChatLists, b: ChatLists): boolean {
  return JSON.stringify([a.allow, a.deny]) === JSON.stringify([b.allow, b.deny]);
}

/**
 * Held against a person's commands that land while it runs:
 *
 * - **`remove`** holds the same lock (`WhatsAppContext.syncLock`), so it waits for a running sync and then deletes
 *   everything, the new index with it; and a sync that waited behind a remove looks its account up again once it
 *   holds the lock, finds it gone, and writes nothing.
 * - **`allow`, `deny`, `clear`**: the lists are read again just before the new index replaces the old. If they
 *   changed while it was built, it is built again, from the same copy, with the lists as they are now — so what a
 *   deny hides is never written, not merely filtered out when read.
 */
export async function syncAccount(
  context: WhatsAppContext,
  request: { account?: string | undefined },
): Promise<SyncResult> {
  const { name, account } = await context.account(request.account);
  const store = context.storeOf(account);
  const directory = context.accountDir(account);
  return withFileLock(
    context.syncLock(account),
    async () => {
      let current = await context.accountById(account.id);
      if (!current) throw removedWhileSyncing(name);
      await ensurePrivateDir(directory);
      const staleRemoved = await removeStaleSnapshots(directory);
      const snapshot = await snapshotStore(store.path, directory, context.sourceOptions(store.isDefault));
      try {
        // The copy is ours, so it is opened read-write: SQLite folds the copied log into it as it opens.
        const db = await openDatabase(snapshot.database);
        try {
          const check = db.prepare('PRAGMA quick_check').get() as Record<string, unknown> | undefined;
          const verdict = check ? String(Object.values(check)[0]) : 'no answer';
          if (verdict !== 'ok') {
            throw new CommsError('TRANSIENT', 'the copy of WhatsApp’s message store did not pass SQLite’s check', {
              hint: 'Nothing was indexed. Try again; if it keeps failing, quit WhatsApp for a moment and sync.',
              details: { reason: 'COPY_INCONSISTENT', verdict },
            });
          }
          const report = inspectSchema(db);
          for (let round = 1; ; round++) {
            const built = current;
            // What the person's lists hide is never written to the index.
            const stats = await rebuildIndex(
              directory,
              db,
              report,
              { indexedAt: context.now().toISOString(), copied: snapshot.copied },
              new Visibility(built.lists),
              async () => {
                const now = await context.accountById(account.id);
                if (!now) throw removedWhileSyncing(built.name);
                current = now;
                return sameLists(now.lists, built.lists);
              },
            );
            if (stats) {
              return {
                account: built.name,
                store: { path: store.path, default: store.isDefault },
                ...stats,
                snapshot: { attempts: snapshot.attempts, deleted: true as const, staleRemoved },
              };
            }
            if (round === LIST_ROUNDS) {
              throw new CommsError('TRANSIENT', 'the chat lists kept changing while the index was built', {
                hint: 'The previous index is kept as it was. Run the sync again.',
                details: { reason: 'LISTS_CHANGED' },
              });
            }
          }
        } finally {
          db.close();
        }
      } finally {
        await snapshot.dispose();
      }
    },
    { timeoutMs: 5000, renewMs: 5000 },
  );
}
