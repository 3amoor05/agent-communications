import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Approval records as released 0.13.0 wrote them (digest version 1), field for field and in its key order, for the
 * tests that prove this release reads them, refuses to claim them, and retires them in their own shape.
 *
 * Hand-copied from 0.13.0's `ApprovalStore.create`, `createChange` and `createDownload` (`approvals.ts` at `afd195e`):
 * a send has no `kind`, one `digest` stands for the content, and nothing of version 2 — no `contentDigest`,
 * `bindingDigest`, `channel`, `ownerScope`, `route` or timestamp of its own — is there. Frozen: do not "update" it.
 */

export const V1_CREATED_AT: string = '2026-09-18T10:00:00.000Z';
/** 0.13.0's lifetime: ten minutes from creation for a send or a change, thirty for a download's question. */
export const V1_TTL_MS: number = 10 * 60 * 1000;
export const V1_DOWNLOAD_TTL_MS: number = 30 * 60 * 1000;

export interface V1Expectation {
  to: string[];
  cc: string[];
  bcc: string[];
  subject: string;
}

/** A version-1 send record, as 0.13.0's `create` built it. Pass `state` and the rest to describe a later moment. */
export function v1SendRecord(fields: {
  approvalId: string;
  inboxId: string;
  inboxSub?: string;
  draftId: string;
  draftMessageId: string;
  digest: string;
  policy?: 'chat' | 'confirm' | 'never';
  requiredPolicy?: 'chat' | 'confirm' | 'never';
  riskFlags?: string[];
  expect: V1Expectation;
  state?: string;
  createdAt?: string;
  updatedAt?: string;
  approvedDigest?: string;
  approvedVia?: 'terminal' | 'elicitation';
  sentMessageId?: string;
  reason?: string;
}): Record<string, unknown> {
  const createdAt = fields.createdAt ?? V1_CREATED_AT;
  const policy = fields.policy ?? 'chat';
  return {
    approvalId: fields.approvalId,
    digestVersion: 1,
    inboxId: fields.inboxId,
    ...(fields.inboxSub === undefined ? {} : { inboxSub: fields.inboxSub }),
    draftId: fields.draftId,
    draftMessageId: fields.draftMessageId,
    digest: fields.digest,
    policy,
    requiredPolicy: fields.requiredPolicy ?? policy,
    riskFlags: fields.riskFlags ?? [],
    expect: fields.expect,
    challengeAttempts: 0,
    state: fields.state ?? 'pending',
    createdAt,
    expiresAt: new Date(Date.parse(createdAt) + V1_TTL_MS).toISOString(),
    updatedAt: fields.updatedAt ?? createdAt,
    ...(fields.approvedDigest === undefined ? {} : { approvedDigest: fields.approvedDigest }),
    ...(fields.approvedVia === undefined ? {} : { approvedVia: fields.approvedVia }),
    ...(fields.sentMessageId === undefined ? {} : { sentMessageId: fields.sentMessageId }),
    ...(fields.reason === undefined ? {} : { reason: fields.reason }),
  };
}

/** A version-1 change record, as 0.13.0's `createChange` built it: `digest` is `changeDigest(change)`. */
export function v1ChangeRecord<
  Change extends { summary: string; target: { kind: string; name: string; id?: string | undefined } | null },
>(fields: {
  approvalId: string;
  digest: string;
  change: Change;
  policy?: 'chat' | 'confirm';
  state?: string;
  createdAt?: string;
}): Record<string, unknown> {
  const createdAt = fields.createdAt ?? V1_CREATED_AT;
  const policy = fields.policy ?? 'chat';
  return {
    approvalId: fields.approvalId,
    kind: 'change',
    digestVersion: 1,
    inboxId: fields.change.target?.id ?? '',
    draftId: 'change',
    draftMessageId: fields.digest,
    digest: fields.digest,
    policy,
    requiredPolicy: policy,
    riskFlags: [],
    expect: { to: [], cc: [], bcc: [], subject: fields.change.summary },
    challengeAttempts: 0,
    state: fields.state ?? 'pending',
    createdAt,
    expiresAt: new Date(Date.parse(createdAt) + V1_TTL_MS).toISOString(),
    updatedAt: createdAt,
    change: fields.change,
  };
}

/** A version-1 download question, as 0.13.0's `createDownload` built it: `digest` is `downloadDigest(download)`. */
export function v1DownloadRecord<
  Download extends { summary: string; target: { kind: string; name: string; id: string } },
>(fields: {
  approvalId: string;
  digest: string;
  download: Download;
  policy?: 'chat' | 'confirm';
  state?: string;
  createdAt?: string;
}): Record<string, unknown> {
  const createdAt = fields.createdAt ?? V1_CREATED_AT;
  const policy = fields.policy ?? 'chat';
  return {
    approvalId: fields.approvalId,
    kind: 'download',
    digestVersion: 1,
    inboxId: fields.download.target.id,
    draftId: 'download',
    draftMessageId: fields.digest,
    digest: fields.digest,
    policy,
    requiredPolicy: policy,
    riskFlags: [],
    expect: { to: [], cc: [], bcc: [], subject: fields.download.summary },
    challengeAttempts: 0,
    state: fields.state ?? 'pending',
    createdAt,
    expiresAt: new Date(Date.parse(createdAt) + V1_DOWNLOAD_TTL_MS).toISOString(),
    updatedAt: createdAt,
    download: fields.download,
  };
}

/** The path a record lives at under a state directory. */
export function v1RecordPath(stateDir: string, approvalId: string, suffix = '.json'): string {
  return join(stateDir, 'approvals', `${approvalId}${suffix}`);
}

/** Writes a record exactly as 0.13.0's store did — two-space JSON and a newline — and returns the bytes written. */
export function writeV1Record(stateDir: string, record: Record<string, unknown>): string {
  mkdirSync(join(stateDir, 'approvals'), { recursive: true, mode: 0o700 });
  const bytes = `${JSON.stringify(record, null, 2)}\n`;
  writeFileSync(v1RecordPath(stateDir, String(record.approvalId)), bytes, { mode: 0o600 });
  return bytes;
}

/** The record's file as it is now. */
export function readV1Record(stateDir: string, approvalId: string): string {
  return readFileSync(v1RecordPath(stateDir, approvalId), 'utf8');
}
