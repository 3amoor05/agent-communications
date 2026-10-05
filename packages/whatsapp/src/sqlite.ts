import type { DatabaseSync } from 'node:sqlite';
import { CommsError } from '@agentcomms/core';

/**
 * Node's built-in SQLite, loaded once.
 *
 * `node:sqlite` rather than a package: it is part of Node (unflagged since 22.13, complete since 22.16), it ships
 * FTS5, it needs no native build — so the workspace's `allowBuilds: {}` stays empty — and it adds nothing to the
 * supply chain. Its cost is the word "experimental": Node prints an ExperimentalWarning the first time it loads. That
 * one warning is swallowed here, by its text, and only while this import runs, so a command's stderr says nothing
 * about a module the person never chose and every other warning still prints.
 */

type SqliteModule = typeof import('node:sqlite');

/**
 * The oldest Node this package runs on: `node:sqlite` without a flag, with `StatementSync.iterate()` (which a sync
 * streams messages through) and `DatabaseSync.function()` (which every read filters the person's lists through).
 * Stated in `engines`, and checked when a command starts rather than discovered half way through one.
 */
export const MIN_NODE = '22.16.0';

function parts(version: string): number[] {
  return version
    .replace(/^v/, '')
    .split(/[.-]/)
    .slice(0, 3)
    .map((part) => Number.parseInt(part, 10) || 0);
}

/** Whether `version` (default: this Node's) is `MIN_NODE` or newer. */
export function nodeSupportsSqlite(version: string = process.versions.node): boolean {
  const have = parts(version);
  const need = parts(MIN_NODE);
  for (let index = 0; index < 3; index += 1) {
    if ((have[index] ?? 0) !== (need[index] ?? 0)) return (have[index] ?? 0) > (need[index] ?? 0);
  }
  return true;
}

/** Refuses to start on a Node too old for `node:sqlite`, saying which Node it is and what it needs. */
export function requireSupportedNode(version: string = process.versions.node): void {
  if (nodeSupportsSqlite(version)) return;
  throw new CommsError('CONFIG', `the WhatsApp channel needs Node ${MIN_NODE} or newer, and this is Node ${version}`, {
    hint: `It reads WhatsApp's store with Node's own SQLite (node:sqlite), which Node ${MIN_NODE} is the first to have complete. Install a newer Node — the current 22 or 24 release — and run it again.`,
    details: { reason: 'NODE_TOO_OLD', node: version, needs: MIN_NODE },
  });
}

let loaded: Promise<SqliteModule> | null = null;

export function loadSqlite(): Promise<SqliteModule> {
  requireSupportedNode();
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
      } catch (error) {
        throw new CommsError('CONFIG', `this Node (${process.versions.node}) has no usable node:sqlite`, {
          hint: `The WhatsApp channel needs Node ${MIN_NODE} or newer, run without flags that turn built-in modules off.`,
          cause: error,
        });
      } finally {
        process.emitWarning = original;
      }
    })();
    // A failed load is not remembered: the next call says the same thing again rather than a stale rejection.
    loaded.catch(() => {
      loaded = null;
    });
  }
  return loaded;
}

export async function openDatabase(path: string, options: { readOnly?: boolean } = {}): Promise<DatabaseSync> {
  const { DatabaseSync } = await loadSqlite();
  return new DatabaseSync(path, { readOnly: options.readOnly ?? false });
}
