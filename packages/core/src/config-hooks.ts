/**
 * Test-only pauses inside `ConfigStore.convertToVersion3`, for the tests that prove a write racing the conversion is
 * neither lost nor let in between its scan and its write.
 *
 * Deliberately not exported from the package root, as `enableNamesMigrationForTests` is not (`release-gate.ts`): a
 * store is given them through its constructor under this symbol, which only a test importing this file by path can
 * name. No consumer of the package can reach it.
 */
export const CONVERSION_HOOKS: unique symbol = Symbol('agentcomms.configConversionHooks');

export interface ConversionHooks {
  /** After the read before the lock, before the config lock is taken. */
  beforeLock?: (() => Promise<void> | void) | undefined;
  /** Under the lock, after the approvals were scanned and before the version-3 write is built. */
  afterScan?: (() => Promise<void> | void) | undefined;
  /** Under the lock, immediately before the version-3 write. */
  beforeWrite?: (() => Promise<void> | void) | undefined;
}
