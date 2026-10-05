import {
  APPROVAL_LIFETIMES,
  type ApprovalRoute,
  bindingDigestOf,
  type OwnerScope,
} from '../../src/approval-binding.ts';
import {
  type ApprovalRecord,
  type ApprovalState,
  type ChangeBinding,
  changeDigest,
  type DownloadBinding,
  downloadDigest,
} from '../../src/approvals.ts';
import { canonicalJson, sha256Hex } from '../../src/digest.ts';

/**
 * A version-2 approval record built by hand, consistent in every field the validator reads — for tests that need a
 * record in a given kind, route, lineage and state without walking the store through each transition, and then break
 * one thing about it.
 *
 * Times are fixed: created at 09:00, approved (when it was) a minute later, claimed a minute after that, finished
 * thirty seconds later. Every value is one the store itself would write.
 */

export const T0: number = Date.parse('2026-10-05T09:00:00.000Z');
const iso = (ms: number) => new Date(ms).toISOString();

export const OWNER: string = 'ibx_AAAAAAAAAAAAAAAA';
export const ACCOUNT: string = 'acc_AAAAAAAAAAAAAAAA';

export const CHANGE_BINDING: ChangeBinding = {
  summary: 'Let acme/slack post',
  target: { kind: 'account', name: 'acme/slack', id: ACCOUNT },
  loosened: [{ path: 'accounts.acme/slack.mode', before: 'read', after: 'send', id: ACCOUNT }],
  settings: [],
  effects: ['signs in to Slack again'],
};

export function downloadBinding(over: Partial<DownloadBinding> = {}): DownloadBinding {
  return {
    summary: 'where to save 2 files from acme/gmail',
    target: { kind: 'inbox', name: 'acme/gmail', id: OWNER },
    operation: 'attachments.download',
    request: { selection: { kind: 'messages', ids: ['m1'] }, maxFiles: 50 },
    files: ['m1/1', 'm1/2'],
    names: ['invoice.pdf', 'budget.xlsm.download'],
    folders: { downloads: '/srv/sam/Downloads', current: '/srv/sam/work' },
    listing: [
      { name: 'invoice.pdf', size: 1200 },
      { name: 'budget.xlsm.download', size: 5120, renamed: 'type', flags: ['macro-capable'] },
    ],
    ...over,
  };
}

export interface V2Spec {
  kind: 'send' | 'change' | 'download';
  state: ApprovalState;
  /** A send's or a change's route; a download has none. */
  route?: ApprovalRoute;
  /** Who approved (a send or a change) or answered (a download); absent for a record claimed straight from pending. */
  via?: 'terminal' | 'elicitation' | undefined;
  /** For a change: whose it is. */
  scope?: OwnerScope;
  heartbeat?: boolean;
}

/** A record of `spec`, valid by every rule in `approval-validate.ts`. */
export function v2Record(spec: V2Spec): ApprovalRecord {
  const { kind, state } = spec;
  const route: ApprovalRoute | undefined = kind === 'download' ? undefined : (spec.route ?? 'chat');
  const pendingMs = kind === 'download' ? APPROVAL_LIFETIMES.download : route === 'confirm' ? 1_800_000 : 600_000;
  const approvalId = `ap_${'0'.repeat(25)}V`;
  const scope = spec.scope ?? 'owner';
  const change: ChangeBinding | undefined =
    kind === 'change'
      ? {
          ...CHANGE_BINDING,
          target:
            scope === 'global'
              ? null
              : scope === 'prospective'
                ? { kind: 'account', name: 'acme/slack' }
                : CHANGE_BINDING.target,
        }
      : undefined;
  const download = kind === 'download' ? downloadBinding() : undefined;
  const contentDigest =
    kind === 'change'
      ? changeDigest(change as ChangeBinding)
      : kind === 'download'
        ? downloadDigest(download as DownloadBinding)
        : 'a'.repeat(64);
  const base: Omit<ApprovalRecord, 'bindingDigest'> = {
    approvalId,
    kind,
    digestVersion: 2,
    channel: kind === 'change' ? 'slack' : 'gmail',
    ownerScope: kind === 'change' ? scope : 'owner',
    ...(route === undefined ? {} : { route, approvedMs: APPROVAL_LIFETIMES.approved }),
    pendingMs,
    inboxId: kind === 'change' ? (scope === 'owner' ? ACCOUNT : '') : OWNER,
    ...(kind === 'send' ? { inboxSub: 'sub-1' } : {}),
    draftId: kind === 'change' ? 'change' : kind === 'download' ? 'download' : 'r-draft-1',
    draftMessageId: kind === 'send' ? 'msg-v1' : contentDigest,
    contentDigest,
    ...(kind === 'send' ? { sendEpoch: 0 } : {}),
    policy: route === 'confirm' || (kind === 'download' && spec.via !== undefined) ? 'confirm' : 'chat',
    requiredPolicy: route === 'confirm' || (kind === 'download' && spec.via !== undefined) ? 'confirm' : 'chat',
    riskFlags: [],
    expect:
      kind === 'send'
        ? { to: ['sam@partner.test'], cc: [], bcc: [], subject: 'Re: plan' }
        : { to: [], cc: [], bcc: [], subject: (change?.summary ?? download?.summary) as string },
    challengeAttempts: 0,
    state,
    createdAt: iso(T0),
    expiresAt: iso(T0 + pendingMs),
    updatedAt: iso(T0),
    ...(change === undefined ? {} : { change }),
    ...(download === undefined ? {} : { download }),
  };
  const record: ApprovalRecord = { ...base, bindingDigest: bindingDigestOf(base) };
  const at: Record<string, string> = {};
  const approvedLineage = spec.via !== undefined && kind !== 'download';
  const since = approvedLineage ? T0 + 60_000 : T0;
  if (approvedLineage) {
    at.approvedAt = iso(T0 + 60_000);
    at.usableUntil = iso(T0 + 60_000 + APPROVAL_LIFETIMES.approved);
  }
  const claimed = since + 60_000;
  if (kind === 'send' && ['sending', 'used', 'failed', 'unknown'].includes(state)) {
    at.sendingAt = iso(claimed);
    if (spec.heartbeat) at.sendingHeartbeatAt = iso(claimed + 15_000);
  }
  if (state === 'used') {
    at.usedAt = iso(claimed + 30_000);
    if (kind === 'send') at.sentAt = at.usedAt;
  }
  if (state === 'failed') at.failedAt = iso(claimed + 30_000);
  if (state === 'revoked') at.revokedAt = iso(since + 30_000);
  if (state === 'expired') at.expiredAt = record.expiresAt;
  const evidence: Partial<ApprovalRecord> = {};
  if (spec.via !== undefined) {
    if (kind === 'download') {
      const answer = { choice: 'downloads' as const };
      evidence.approvedVia = spec.via;
      evidence.approvedDigest = sha256Hex(canonicalJson({ bindingDigest: record.bindingDigest, answer }));
      evidence.download = { ...(record.download as DownloadBinding), answer };
    } else {
      evidence.approvedVia = spec.via;
      evidence.approvedBindingDigest = record.bindingDigest;
    }
  }
  return {
    ...record,
    ...at,
    ...evidence,
    ...(kind === 'send' && state === 'used' ? { sentMessageId: 'sent-1' } : {}),
    ...(state === 'failed' ? { reason: 'backendError' } : {}),
    ...(state === 'revoked' ? { reason: 'cancelled' } : {}),
    ...(state === 'expired' ? { reason: 'the approval window passed' } : {}),
  };
}

/** `record` with `fields` changed, a field set to `undefined` removed, and the binding left exactly as it was. */
export function edited(record: ApprovalRecord, fields: Record<string, unknown>): ApprovalRecord {
  const next: Record<string, unknown> = { ...record };
  for (const [key, value] of Object.entries(fields)) {
    if (value === undefined) delete next[key];
    else next[key] = value;
  }
  return next as unknown as ApprovalRecord;
}
