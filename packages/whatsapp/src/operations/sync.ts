import { join } from 'node:path';
import { CommsError, ensurePrivateDir, withFileLock } from '@agentcomms/core';
import { requireAccount } from '../config.ts';
import type { WhatsAppContext } from '../context.ts';
import { type IndexStats, rebuildIndex } from '../index-db.ts';
import { inspectSchema } from '../source/schema.ts';
import { removeStaleSnapshots, snapshotStore } from '../source/snapshot.ts';
import { openDatabase } from '../sqlite.ts';
import { Visibility } from '../visibility.ts';

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

export async function syncAccount(
  context: WhatsAppContext,
  request: { account?: string | undefined },
): Promise<SyncResult> {
  const { name, account } = requireAccount(await context.config.load(), request.account);
  const store = context.storeOf(account);
  const directory = context.accountDir(account);
  await ensurePrivateDir(directory);
  return withFileLock(
    join(directory, '.sync.lock'),
    async () => {
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
          // What the person's lists hide is never written to the index.
          const stats = await rebuildIndex(
            directory,
            db,
            report,
            { indexedAt: context.now().toISOString(), copied: snapshot.copied },
            new Visibility(account.chats),
          );
          return {
            account: name,
            store: { path: store.path, default: store.isDefault },
            ...stats,
            snapshot: { attempts: snapshot.attempts, deleted: true as const, staleRemoved },
          };
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
