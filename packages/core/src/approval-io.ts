import { readdir, readFile, stat, unlink } from 'node:fs/promises';
import { dirname } from 'node:path';
import { syncDirectory, writeFileAtomic } from './fs.ts';
import { type LockIo, NODE_LOCK_IO } from './lock.ts';

/**
 * The file operations approval maintenance and the unsent report are made of (design 2026-10-05 §D9), one method
 * each, so that a test can count every one of them — every directory read, metadata stat, record open, lock try,
 * renewal, ownership check and unlink — and none is hidden behind a helper. The store passes the real ones unless it
 * was opened with others.
 *
 * Only these two passes go through it: every other read and write of the store is as it was.
 */
export interface ApprovalIo {
  /** One enumeration of a directory: its entries' names. */
  readdir(directory: string): Promise<string[]>;
  /** One metadata stat: the modification time, in milliseconds. */
  stat(path: string): Promise<{ readonly mtimeMs: number }>;
  /** One open of a file's content, as text. */
  readText(path: string): Promise<string>;
  /** Replaces a file atomically — a temporary file, flushed, renamed — and, when `durable`, syncs its directory too. */
  writeAtomic(path: string, text: string, options?: { durable?: boolean }): Promise<void>;
  /** One unlink of an approval artifact: a record or its claim marker. A missing one rejects with `ENOENT`. */
  unlink(path: string): Promise<void>;
  /** The lock files' own operations (`tryFileLock`). */
  readonly lock: LockIo;
}

/** The real file system. */
export const NODE_APPROVAL_IO: ApprovalIo = Object.freeze({
  readdir: (directory: string) => readdir(directory),
  stat: async (path: string) => ({ mtimeMs: (await stat(path)).mtimeMs }),
  readText: (path: string) => readFile(path, 'utf8'),
  async writeAtomic(path: string, text: string, options: { durable?: boolean } = {}): Promise<void> {
    await writeFileAtomic(path, text);
    // The rename is the commit; on POSIX it outlives a power cut only once the directory holding it is synced.
    if (options.durable) await syncDirectory(dirname(path));
  },
  unlink: (path: string) => unlink(path),
  lock: NODE_LOCK_IO,
});
