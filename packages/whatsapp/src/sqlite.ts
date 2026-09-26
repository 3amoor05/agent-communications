import type { DatabaseSync } from 'node:sqlite';

/**
 * Node's built-in SQLite, loaded once.
 *
 * `node:sqlite` rather than a package: it is part of Node (unflagged since 22.13, `iterate()` since 22.16), it ships
 * FTS5, it needs no native build — so the workspace's `allowBuilds: {}` stays empty — and it adds nothing to the
 * supply chain. Its cost is the word "experimental": Node prints an ExperimentalWarning the first time it loads. That
 * one warning is swallowed here, by its text, and only while this import runs, so a command's stderr says nothing
 * about a module the person never chose and every other warning still prints.
 */

type SqliteModule = typeof import('node:sqlite');

let loaded: Promise<SqliteModule> | null = null;

export function loadSqlite(): Promise<SqliteModule> {
  if (!loaded) {
    loaded = (async () => {
      const original = process.emitWarning;
      process.emitWarning = function filtered(this: NodeJS.Process, warning: string | Error, ...rest: unknown[]) {
        const text = typeof warning === 'string' ? warning : warning.message;
        if (text.includes('SQLite is an experimental feature')) return;
        return (original as (...args: unknown[]) => void).call(process, warning, ...rest);
      } as typeof process.emitWarning;
      try {
        return await import('node:sqlite');
      } finally {
        process.emitWarning = original;
      }
    })();
  }
  return loaded;
}

export async function openDatabase(path: string, options: { readOnly?: boolean } = {}): Promise<DatabaseSync> {
  const { DatabaseSync } = await loadSqlite();
  return new DatabaseSync(path, { readOnly: options.readOnly ?? false });
}
