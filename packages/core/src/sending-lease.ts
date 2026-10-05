import { SENDING_HEARTBEAT_MS } from './approval-binding.ts';
import type { ApprovalRecord, SendOutcome } from './approvals.ts';
import { CommsError } from './errors.ts';

/**
 * The sending lease, held by the call that claimed a send (design 2026-10-05 §D1, "Version-2 timestamps fail closed").
 *
 * A claim moves a record to `sending` and hands its claimant a private token. While the claimant's provider work is
 * outstanding it renews the lease every thirty seconds (`withSendingLease`), and before each provider step it asks
 * whether it still holds the send (`fenceOrStop`). A claimant that stops — a dead process, a suspended one, a renewal
 * that cannot be written — lets the lease run out, and the record then reads `unknown` to everyone; only the claimant's
 * own completion may still record what the provider said.
 */

/** What a lease needs of the approval store: the claimant's token-checked calls, and nothing else. */
export interface SendingLeaseStore {
  heartbeat(approvalId: string, claimToken: string): Promise<'renewed' | 'lost'>;
  fence(approvalId: string, claimToken: string): Promise<'go' | 'stop'>;
  complete(approvalId: string, claimToken: string, outcome: SendOutcome): Promise<ApprovalRecord>;
}

/** The reason a send is recorded `failed` when its lease was lost before any provider step began. */
export const LEASE_LOST_BEFORE_SEND = 'lease-lost-before-send';

/**
 * Runs `work` — the provider work of one claimed send — renewing the claim's lease every `SENDING_HEARTBEAT_MS` until it
 * settles, and stops renewing however it ends.
 *
 * A renewal that fails, or finds the record no longer `sending`, is not an error here: it only lets the lease run out,
 * which is the truth by then — the outcome can no longer be known from the record. One renewal at a time.
 */
export async function withSendingLease<T>(
  store: Pick<SendingLeaseStore, 'heartbeat'>,
  approvalId: string,
  claimToken: string,
  work: () => Promise<T>,
): Promise<T> {
  let renewing = false;
  const timer = setInterval(() => {
    if (renewing) return;
    renewing = true;
    store
      .heartbeat(approvalId, claimToken)
      .catch(() => undefined)
      .finally(() => {
        renewing = false;
      });
  }, SENDING_HEARTBEAT_MS);
  try {
    return await work();
  } finally {
    clearInterval(timer);
  }
}

/** What `fenceOrStop` decided: go on, or stop — with the error to report when nothing was sent. */
export type FenceVerdict =
  | { readonly proceed: true }
  | {
      readonly proceed: false;
      /**
       * When no provider step had started: the send recorded `failed` (`lease-lost-before-send`), and this is the
       * refusal that says nothing was sent. When steps had started: null — what they did is the caller's to say.
       */
      readonly error: CommsError | null;
    };

/**
 * The fence before a provider step: `proceed` while this claim still holds a `sending` record (its lease renewed by
 * the look), and stop once the record reads `unknown`.
 *
 * Stopped before any step began (`stepsStarted` 0), nothing was sent: the record is completed `failed` with reason
 * `lease-lost-before-send`, and the refusal says so. Stopped after steps had run, control goes back to the caller,
 * whose own failure says what those steps did. A fence that cannot be asked — the store unreadable — stops as well.
 */
export async function fenceOrStop(
  store: SendingLeaseStore,
  approvalId: string,
  claimToken: string,
  progress: { readonly stepsStarted: number },
): Promise<FenceVerdict> {
  let verdict: 'go' | 'stop';
  try {
    verdict = await store.fence(approvalId, claimToken);
  } catch {
    verdict = 'stop';
  }
  if (verdict === 'go') return { proceed: true };
  if (progress.stepsStarted > 0) return { proceed: false, error: null };
  let unrecorded = '';
  try {
    await store.complete(approvalId, claimToken, { error: LEASE_LOST_BEFORE_SEND });
  } catch (failure) {
    unrecorded = ` Its approval could not be marked failed (${failure instanceof Error ? failure.message : String(failure)}), so it reads unknown.`;
  }
  return {
    proceed: false,
    error: new CommsError('APPROVAL_VOID', 'nothing was sent: the sending lease ran out before anything was sent', {
      hint: `Nothing reached the provider. Prepare it again and show the new preview to the user.${unrecorded}`,
      details: { approvalId, reason: LEASE_LOST_BEFORE_SEND },
    }),
  };
}
