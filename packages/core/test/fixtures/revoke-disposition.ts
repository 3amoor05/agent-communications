import type { ApprovalStore } from '../../src/approvals.ts';
import { revokeChange } from '../../src/changes.ts';
import type { Core } from '../../src/core.ts';

/*
 * Compile-only (run by `pnpm typecheck`, never by the test runner): a revoke has to say whose decision it is.
 *
 * `disposition` has no default and no optional form, so every direct call of `ApprovalStore.revoke` and every call of
 * `revokeChange` chooses one — and with it what may happen to a record from an earlier release (`RevokeDisposition`).
 * If either signature ever gives it a default or makes it optional, the `@ts-expect-error` lines below find no error
 * and the typecheck fails.
 */

export async function twoArgumentRevoke(store: ApprovalStore): Promise<void> {
  // @ts-expect-error a revoke without a disposition does not compile
  await store.revoke('ap_00000000000000000000000000', 'reason');
  // @ts-expect-error nor one whose options leave it out
  await store.revoke('ap_00000000000000000000000000', 'reason', {});
}

export async function revokeChangeWithoutDisposition(core: Core): Promise<void> {
  // @ts-expect-error a change's revoke without a disposition does not compile
  await revokeChange(core, 'ap_00000000000000000000000000', 'reason', { surface: 'cli' });
}
