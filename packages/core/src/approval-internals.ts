import type { ApprovalIo } from './approval-io.ts';
import type { ApprovalRecord, ApprovalStore } from './approvals.ts';
import type { AuditLog } from './audit.ts';
import type { Config } from './config.ts';

/**
 * What approval maintenance and the unsent report reach of an `ApprovalStore` that nobody else may (design 2026-10-05
 * §D9): the directory, the store's clock, its configuration loader, its own derivation of expiry and `unknown`, and the
 * file operations both passes are counted through.
 *
 * Kept off the store's public surface, and this module is not exported from the package: a channel reads approvals
 * through the store's methods, and only core's own maintenance and report act on its files from outside a transition.
 */
export interface StoreInternals {
  readonly directory: string;
  now(): Date;
  /** The store's configuration loader: null without one. Its errors propagate. */
  loadConfig(): Promise<Config | null>;
  /** The store's derivation (`#derive`): expiry for an active record, `unknown` for a send whose lease ran out. */
  derive(record: ApprovalRecord): ApprovalRecord;
  readonly io: ApprovalIo;
  readonly audit: Pick<AuditLog, 'append'>;
  /**
   * The maintenance lock's and the record locks' timings: the design's (30 s stale, renewed every 10 s) unless a test
   * shortened them to watch a renewal or a takeover happen in real time.
   */
  timings: { staleMs: number; renewMs: number; recordStaleMs: number };
}

const REGISTRY = new WeakMap<ApprovalStore, StoreInternals>();

/** Registers a store's internals: called once, by its constructor. */
export function registerStoreInternals(store: ApprovalStore, internals: StoreInternals): void {
  REGISTRY.set(store, internals);
}

/** A store's internals. Every `ApprovalStore` has them. */
export function storeInternals(store: ApprovalStore): StoreInternals {
  const found = REGISTRY.get(store);
  if (found === undefined) throw new Error('an approval store without its internals: this is a bug');
  return found;
}
