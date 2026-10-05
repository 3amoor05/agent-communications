import type {
  ApprovalChannel,
  ApprovalKind,
  ApprovalState,
  ChangeBinding,
  DownloadBinding,
  Expectation,
} from './approvals.ts';
import type { SendPolicy } from './config.ts';

/**
 * Approval records written by an earlier release: version 1 of the digest (0.13 and before).
 *
 * This release never claims, approves, answers or completes one — the digest-version gate refuses them all — but it
 * still has to read them, to report them and to retire them. It reads them by their own release's rules and nothing
 * newer, so a record means here exactly what it meant to the release that wrote it.
 */

/** The digest version every earlier release wrote. */
export const LEGACY_DIGEST_VERSION = 1;

/** A version-1 record, as 0.13.0 wrote it: a send has no `kind`, and one `digest` stands for the content. */
export interface LegacyApprovalRecord {
  approvalId: string;
  /** Absent on a send. */
  kind?: ApprovalKind | undefined;
  digestVersion: 1;
  inboxId: string;
  inboxSub?: string | undefined;
  draftId: string;
  draftMessageId: string;
  digest: string;
  approvedDigest?: string | undefined;
  approvedVia?: ApprovalChannel | undefined;
  policy: SendPolicy;
  requiredPolicy: SendPolicy;
  riskFlags: string[];
  expect: Expectation;
  challengeHash?: string | undefined;
  challengeAttempts: number;
  state: ApprovalState;
  createdAt: string;
  expiresAt: string;
  updatedAt: string;
  sentMessageId?: string | undefined;
  reason?: string | undefined;
  change?: ChangeBinding | undefined;
  download?: DownloadBinding | undefined;
}

/** How long 0.13.0 let a record sit in `sending` before it read as `unknown`. Frozen with the rules below. */
const LEGACY_SENDING_STALE_MS = 5 * 60 * 1000;

/**
 * The state a version-1 record has, derived exactly as 0.13.0's `#derive` derived it — and nothing written.
 *
 * Expiry is creation-relative: a `pending` or `approved` record expires at its stored `expiresAt`, and so does one
 * whose expiry does not parse or whose clock has moved behind its creation. A `sending` record turns `unknown` five
 * minutes after its `updatedAt`. Every other state is as stored. Frozen: a later release changing how its own records
 * age must not change what an earlier release's record means.
 */
export function deriveLegacyV1State(
  raw: Pick<LegacyApprovalRecord, 'state' | 'createdAt' | 'expiresAt' | 'updatedAt' | 'reason'>,
  now: Date,
): { state: ApprovalState; reason: string | undefined } {
  const at = now.getTime();
  const expiresAt = new Date(raw.expiresAt).getTime();
  const createdAt = new Date(raw.createdAt).getTime();
  const unusable = !Number.isFinite(expiresAt) || (Number.isFinite(createdAt) && at < createdAt);
  if ((raw.state === 'pending' || raw.state === 'approved') && (unusable || at >= expiresAt)) {
    return {
      state: 'expired',
      reason: raw.reason ?? (unusable ? 'the approval window cannot be read' : 'the approval window passed'),
    };
  }
  if (raw.state === 'sending' && at - new Date(raw.updatedAt).getTime() >= LEGACY_SENDING_STALE_MS) {
    return { state: 'unknown', reason: 'the sending process stopped before recording an outcome' };
  }
  return { state: raw.state, reason: raw.reason };
}
