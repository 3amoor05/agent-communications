import { open, readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import {
  APPROVAL_LIFETIMES,
  type ApprovalRoute,
  bindingDigestOf,
  type OwnerScope,
  pendingMsOf,
  requireKnownChannel,
} from './approval-binding.ts';
import { deriveLegacyV1State, LEGACY_DIGEST_VERSION, type LegacyApprovalRecord } from './approval-legacy.ts';
import { accountChannels } from './channel-words.ts';
import {
  type ChangePolicy,
  canonicalLoosening,
  type Loosening,
  type SendPolicy,
  type SettingChange,
  sameLoosening,
} from './config.ts';
import { canonicalJson, normaliseAddress, sha256Hex } from './digest.ts';
import { CommsError, type ErrorCode } from './errors.ts';
import { ensurePrivateDir, writeFileAtomic } from './fs.ts';
import { type CliHandoffs, handoffChoices, handoffSentence, requiredHandoffs } from './handoff-text.ts';
import { APPROVAL_ID_PATTERN, challengeMatches, hashChallenge, newApprovalId, newChallenge } from './ids.ts';
import { withFileLock } from './lock.ts';
import type { RenameReason } from './saved-files.ts';

/**
 * Approval records bind a send to exactly one draft version. States:
 *
 *   pending ──approve──▶ approved ──claim──▶ sending ──▶ used | failed
 *      └──claim (effective policy chat)──────┘      └──▶ unknown (the process died mid-send)
 *   pending | approved ──▶ revoked ("voided": content changed, wrong inbox, too many wrong challenges, user revoked)
 *   expired is derived: a pending or approved record past its deadline reads as expired.
 *
 * Every transition is a compare-and-swap under a per-record lock. Single use does not rest on the lock alone: a claim
 * also creates `<id>.claim` with O_EXCL, which the file system guarantees only one process can do.
 *
 * A change approval (`kind: 'change'`) lives in the same store and goes through the same states, except that its
 * claim goes straight to `used`: what it permits is a write to the configuration, which the claimant makes itself.
 *
 * So does a download's question (`kind: 'download'`): where to save the files a Gmail or Slack download names. It is
 * held to the change policy of the mailbox or workspace it is about, as every other change there is. Under `chat` the
 * person's answer, relayed from the chat, claims it straight from `pending`. Under `confirm` it has to be answered
 * where an agent cannot answer for them — at their own terminal, or in a form a trusted client shows them — which
 * records the answer and moves it to `approved`; only then is it claimed, straight to `used`, and the recorded answer
 * is the one that saves. It gets the store's expiry, its single use and its binding for the reason a change does: an
 * answer given for three invoices must not save the next conversation's files, nor be spent twice.
 */

export type ApprovalState = 'pending' | 'approved' | 'sending' | 'used' | 'failed' | 'unknown' | 'expired' | 'revoked';
export type ApprovalChannel = 'elicitation' | 'terminal';

/**
 * What an approval permits: a send (a mail, a post, a reaction), a change to the configuration, or a download saved
 * where the person said.
 *
 * One store for all three, so a change gets the machinery a send already has — expiry, single use, the typed code —
 * and a kind on every record, so that none can be spent as another. Without it, a person who approved a post at a
 * terminal would also have approved whatever change an agent claimed under the same id.
 */
export type ApprovalKind = 'send' | 'change' | 'download';

/** The inbox or account a change is about. `id` is absent when the change connects it, and it does not exist yet. */
export interface ChangeTarget {
  kind: 'inbox' | 'account';
  name: string;
  id?: string | undefined;
}

/**
 * Exactly what a change approval permits, stored on the record so a terminal can show it again and prove it is what
 * was prepared.
 */
export interface ChangeBinding {
  /** The caller's one line about the change, shown to the person. Not part of the digest: the lines below are. */
  summary: string;
  /** What it is about, or `null` for a change to the whole configuration. */
  target: ChangeTarget | null;
  /** Every safety setting it loosens, with the values `classifyChange` compared. Empty for a destructive change. */
  loosened: Loosening[];
  /**
   * Every setting it writes, loosened or tightened, with the values in the file before and after (`changedSettings`).
   *
   * Bound as well as the loosenings, because a preview shows the whole change: a claim that loosened the same thing
   * while dropping a tightening the person read would otherwise digest the same. Absent reads as none.
   */
  settings?: SettingChange[] | undefined;
  /** What it does outside the configuration, in words: a sign-in, a registration, files removed. */
  effects: string[];
  /**
   * What the call that prepared it already did at once, because it never waits for an approval — a narrowing beside
   * the change (design 2026-10-02 §D8). Not what approving does: the preview lists these apart, and its header says
   * the rest is what waits. A field of its own rather than words in `effects`, so no text a change carries — a label
   * a profile chose, say — can make a preview claim something was done.
   *
   * Bound when present, so a record cannot gain one it was not prepared with; absent reads as none, and leaves the
   * digest of every other change exactly what it was.
   */
  doneAtOnce?: string[] | undefined;
}

/**
 * Exactly which download a question was asked for, stored on the record so the answer can be held to it.
 *
 * The files are the ones the question listed, by the platform's own ids — `<message id>/<part id>` for Gmail, the file
 * id for Slack — in the order they were listed: a claim for any other set is a claim for a download the person was
 * not asked about. So are the names they would be saved under, in the same order: a Slack file renamed between the
 * question and the answer would otherwise be saved under a name the person was never shown. The folders are the two
 * the question showed, as absolute paths. They are not part of the digest, because they are what the answer *means*
 * rather than what it is for: `downloads` in the answer is the path the person read, even when an agent runs the
 * download again from another folder.
 */
export interface DownloadBinding {
  /** One line about the download, for a listing: "where to save 2 files from acme/gmail". Not part of the digest. */
  summary: string;
  /** The mailbox or workspace the files come from, by the id it has now. */
  target: { kind: 'inbox' | 'account'; name: string; id: string };
  /** Which download asked: `attachments.download`, `files.download`. */
  operation: string;
  /** The request as the caller made it, in the words of its own arguments: the selection, and how many at most. */
  request: Record<string, unknown>;
  /** The files the question listed, by the platform's ids, in order. */
  files: string[];
  /** The names those files would be saved under, as the question listed them, in the same order. */
  names: string[];
  /** The two folders the question offered, as absolute paths. */
  folders: { downloads: string; current: string };
  /**
   * The files as the question listed them to the person — the names they would be saved under, their sizes, why a
   * name has `.download` after it, and their risk flags — so a terminal or a form can show the question, and its
   * warnings, again. Not part of the digest: the ids and names above are.
   */
  listing?: ListedFile[] | undefined;
  /** The person's answer, when they gave it where an agent cannot: at a terminal, or in a trusted client's form. */
  answer?: RecordedSaveAnswer | undefined;
}

/** One file as a question lists it. */
export interface ListedFile {
  /** The name it would be saved under: the sender's made safe, with `.download` after it unless it is inert. */
  name: string;
  size: number | null;
  /** Why `.download` is after its name; absent when the name is the sender's, made safe. */
  renamed?: RenameReason | undefined;
  /** Its risk flags, as the file's own listing gives them. */
  flags?: string[] | undefined;
}

/**
 * An answer recorded on a question: one of the two folders it offered, or the folder the person named, as an absolute
 * path — resolved where they typed it, so it means the folder they read.
 */
export type RecordedSaveAnswer =
  | { readonly choice: 'downloads' | 'current' }
  | { readonly choice: 'other'; readonly folder: string };

/** What a claim of a download's question is held to: all of the binding but its summary and the folders it offered. */
export type DownloadRequest = Pick<DownloadBinding, 'target' | 'operation' | 'request' | 'files' | 'names'>;

/**
 * The digest a download's question is bound to: the account, the download, the request, the files it listed and the
 * names it showed them under.
 *
 * The files and names keep their order, since the question showed them in it; the request is canonical JSON, so the
 * same arguments digest the same however an object happened to list its keys.
 */
export function downloadDigest(download: DownloadRequest): string {
  return sha256Hex(
    canonicalJson({
      kind: 'download',
      target: { kind: download.target.kind, name: download.target.name, id: download.target.id },
      operation: download.operation,
      request: download.request,
      files: [...download.files],
      names: [...download.names],
    }),
  );
}

/**
 * Why a download claimed is not the one its question was asked for, in a sentence — the first difference found. Only
 * the words; what refuses is the digest.
 */
export function downloadDrift(asked: DownloadRequest, now: DownloadRequest): string {
  if (asked.target.id !== now.target.id || asked.target.kind !== now.target.kind) {
    return `the question was about ${asked.target.name}, not ${now.target.name}`;
  }
  if (asked.operation !== now.operation) return 'the question was asked for another kind of download';
  if (canonicalJson(asked.request) !== canonicalJson(now.request)) {
    return 'the question was asked about a different request: other messages, other files or another limit';
  }
  if (canonicalJson(asked.files) !== canonicalJson(now.files)) return 'the files are not the ones the question listed';
  // By its id, never by either name: a name is the sender's words, and this is the tool's sentence.
  const renamed = asked.files.find((_, index) => asked.names[index] !== now.names[index]);
  if (renamed !== undefined) {
    return `${renamed} would now be saved under another name than the one the question showed: it was renamed since`;
  }
  return 'the download is not the one the question was asked for';
}

/**
 * Why a download's question cannot be claimed under this change policy — the stricter of `livePolicy` and the one it
 * was asked under — or null. Changes nothing, so a download can ask before it looks at a folder, and the store asks
 * again as it claims.
 *
 * Under `chat` nothing stops it: the person's answer, relayed from the conversation, is the answer. Anything stricter
 * needs the answer recorded on the question by a channel an agent cannot answer — the person's own terminal, or a
 * form a trusted client showed them. An answer carried in a tool's arguments or a command's flags is refused however
 * it was worded, with the command that answers it named, and the question left open for the person.
 */
export function downloadClaimRefusal(
  record: ApprovalRecord,
  livePolicy: ChangePolicy,
  pendingHint?: string,
): CommsError | null {
  if (stricterPolicy(livePolicy, record.requiredPolicy) === 'chat') return null;
  const answered =
    record.state === 'approved' &&
    (record.approvedVia === 'terminal' || record.approvedVia === 'elicitation') &&
    record.download?.answer !== undefined;
  if (answered) return null;
  return refuseDownload(
    'APPROVAL_PENDING',
    'the change policy here is confirm, so the person answers where to save themselves — at their own terminal, not through an agent',
    record,
    pendingHint ??
      'Ask the person to answer it at their own terminal, with the approve command of the channel the files come from and this choice id; then make the download again with the choice id alone.',
  );
}

/** The kind of a record. Absent is a send: every version-1 send record was written without one. */
export function approvalKind(record: { kind?: ApprovalKind | undefined }): ApprovalKind {
  return record.kind ?? 'send';
}

/**
 * The digest a change approval is bound to: its target, every loosened path with its before and after values, every
 * setting it writes with its before and after values, and its effects.
 *
 * The loosenings and the settings are sorted, because their order is an implementation detail and the same change must
 * digest the same however it is listed. The effects are not: they are what the person read, in the order they read it.
 */
export function changeDigest(
  change: Pick<ChangeBinding, 'target' | 'loosened' | 'settings' | 'effects' | 'doneAtOnce'>,
): string {
  const target = change.target;
  return sha256Hex(
    canonicalJson({
      kind: 'change',
      target: target === null ? null : { kind: target.kind, name: target.name, id: target.id ?? null },
      loosened: change.loosened.map(canonicalLoosening).sort(),
      // The same four fields a loosening has, in the same canonical form.
      settings: (change.settings ?? []).map(canonicalLoosening).sort(),
      effects: [...change.effects],
      // Only when there is something: every change without one digests exactly as it did before the field existed.
      ...(change.doneAtOnce !== undefined && change.doneAtOnce.length > 0
        ? { doneAtOnce: [...change.doneAtOnce] }
        : {}),
    }),
  );
}

/**
 * Why `now` is not the change that was approved, in a sentence — the first difference found.
 *
 * Only the words of a refusal. What refuses is the digest; this says to the person, or the agent, which part moved,
 * because "prepare it again" with no reason reads as a fault rather than as the safety check it is.
 */
export function changeDrift(approved: ChangeBinding, now: ChangeBinding): string {
  const target = ({ target: of }: ChangeBinding) =>
    of === null ? null : canonicalJson({ kind: of.kind, name: of.name, id: of.id ?? null });
  if (target(approved) !== target(now)) {
    return approved.target !== null && now.target !== null && approved.target.name === now.target.name
      ? `"${now.target.name}" is not the ${now.target.kind} it was when this was approved`
      : 'it is about something other than what was approved';
  }
  const paths = (binding: ChangeBinding) =>
    binding.loosened
      .map((loosening) => loosening.path)
      .sort()
      .join('\n');
  if (paths(approved) !== paths(now)) return 'it loosens different settings from the ones approved';
  const moved = now.loosened.find((loosening) => !approved.loosened.some((ok) => sameLoosening(ok, loosening)));
  if (moved) return `${moved.path} would not move between the values that were approved`;
  // Either way round: a setting the person was shown and the claim leaves out, or one the claim adds.
  const unlike = (one: SettingChange[] | undefined, other: SettingChange[] | undefined) =>
    (one ?? []).find((setting) => !(other ?? []).some((ok) => sameLoosening(ok, setting)));
  const unset = unlike(approved.settings, now.settings) ?? unlike(now.settings, approved.settings);
  if (unset) return `it would not set ${unset.path} the way that was approved`;
  if (canonicalJson(approved.effects) !== canonicalJson(now.effects)) {
    return 'what it does outside the configuration is not what was approved';
  }
  if (canonicalJson(approved.doneAtOnce ?? []) !== canonicalJson(now.doneAtOnce ?? [])) {
    return 'what was done at once when it was prepared is not what this call says';
  }
  return 'the change is not the one that was approved';
}

/**
 * Bumped whenever what an approval binds changes; a record prepared under another version is refused.
 *
 * 2 from 0.14: a record binds its route, its lifetimes and its identity as well as its content (`bindingDigest`,
 * `approval-binding.ts`), so a record an earlier release wrote cannot be claimed here, nor one written here there.
 */
export const DIGEST_VERSION = 2;

export interface Expectation {
  to: string[];
  cc: string[];
  bcc: string[];
  subject: string;
}

export interface ApprovalRecord {
  approvalId: string;
  /** What it permits. Every version-2 record says, a send included; only a version-1 send was written without one. */
  kind: ApprovalKind;
  digestVersion: number;
  /** The manifest channel that made it (`gmail`, `slack`, `resend`, `whatsapp`, `core`), checked at creation. Bound. */
  channel: string;
  /** What `inboxId` names: an owner that existed, one the change creates, or none at all. Bound. */
  ownerScope: OwnerScope;
  /** A send's or a change's route, fixed at creation: a yes in the chat, or a person outside it. Bound. */
  route?: ApprovalRoute | undefined;
  /** How long it stays pending, from creation. Bound. */
  pendingMs: number;
  /** A send's or a change's lifetime once approved. Bound. */
  approvedMs?: number | undefined;
  /** For a change: the id of the inbox or account it is about, or empty for one to the whole configuration. */
  inboxId: string;
  inboxSub?: string | undefined;
  draftId: string;
  /** Changes on every save of the draft; binding to it detects any edit, even one that restores identical content. */
  draftMessageId: string;
  /** The outward content or change: the message, change or download digest. */
  contentDigest: string;
  /** The SHA-256 of everything the record binds (`bindingDigestOf`), recomputed from its own fields on every read. */
  bindingDigest: string;
  /** On a send: the owner's send epoch as it was read at prepare. Bound. */
  sendEpoch?: number | undefined;
  /**
   * A download's answer, bound: SHA-256 of canonical `{ bindingDigest, answer }`, written when a person answered at a
   * terminal or in a trusted form. Never on a send or a change, which carry `approvedBindingDigest` instead.
   */
  approvedDigest?: string | undefined;
  /** Where a person approved, or answered: the terminal, or a trusted client's form. Absent on a chat-route claim. */
  approvedVia?: ApprovalChannel | undefined;
  /** A send's or a change's approval: when, and the binding the person approved, which must still be the record's. */
  approvedAt?: string | undefined;
  /** `approvedAt + approvedMs`: until when an approved send or change may be claimed. */
  usableUntil?: string | undefined;
  approvedBindingDigest?: string | undefined;
  /** When a send was claimed for sending. Kept on every state after it. */
  sendingAt?: string | undefined;
  /** The sending claimant's latest lease renewal, when it has made one. */
  sendingHeartbeatAt?: string | undefined;
  /** When a record was used: for a send, the moment the provider accepted it, and equal to `sentAt`. */
  usedAt?: string | undefined;
  sentAt?: string | undefined;
  failedAt?: string | undefined;
  revokedAt?: string | undefined;
  /** The boundary that applied when it expired — or, on a `clock-anomaly` expiry, the time the clock was seen. */
  expiredAt?: string | undefined;
  /** Live policy at prepare time, for display and audit. */
  policy: SendPolicy;
  /** `confirm` when risk escalation raised this send. The effective policy is the stricter of this and the live one. */
  requiredPolicy: SendPolicy;
  riskFlags: string[];
  expect: Expectation;
  /** Hash of the challenge currently issued to a human; the challenge itself is never stored or returned. */
  challengeHash?: string | undefined;
  challengeAttempts: number;
  state: ApprovalState;
  createdAt: string;
  expiresAt: string;
  updatedAt: string;
  sentMessageId?: string | undefined;
  reason?: string | undefined;
  /** For a change: exactly what it permits. `contentDigest` is `changeDigest` of this. */
  change?: ChangeBinding | undefined;
  /** For a download's question: what it asked about, and the folders it offered. `contentDigest` is `downloadDigest`. */
  download?: DownloadBinding | undefined;
}

export interface CreateApprovalInput {
  /** The manifest channel preparing the send. A channel this release does not know is refused. */
  channel: string;
  inboxId: string;
  inboxSub?: string | undefined;
  draftId: string;
  draftMessageId: string;
  contentDigest: string;
  /** The owner's send epoch, read from the configuration at prepare (`sendEpochOf`). */
  sendEpoch: number;
  policy: SendPolicy;
  requiredPolicy: SendPolicy;
  riskFlags: string[];
  expect: Expectation;
}

export interface CreateChangeApprovalInput {
  /** The manifest channel of the surface preparing the change: `core` for core's own. */
  channel: string;
  change: ChangeBinding;
  /** The change policy in force before the change: it decides how the change is approved. */
  policy: ChangePolicy;
}

/** What a claimant of a change is about to write, and the change policy in force as it does. */
export interface LiveChange {
  change: ChangeBinding;
  policy: ChangePolicy;
}

/** What the caller observed in the live draft at the moment of a transition. */
export interface LiveDraft {
  draftMessageId: string;
  contentDigest: string;
}

/** What the product making a claim tells the store about itself. */
export interface ClaimOptions {
  /** The shell syntax used by any approval command this refusal prints. */
  platform?: NodeJS.Platform | undefined;
  /**
   * The commands the printing package gives a person (`core.handoffs`), for a refusal that names one: the store's own
   * when left out. With neither, a refusal that has to name one is a programming error (`requiredHandoffs`).
   */
  handoffs?: CliHandoffs | undefined;
  /**
   * What the caller is told when the send is waiting for a person: which command approves it, and what to run after.
   *
   * The product's to say, because the store is shared and the command that approves is not. The store used to say
   * it itself, in Gmail's words, so a Slack post held for approval told the agent to hand the person
   * `agent-gmail approve` — which cannot approve a Slack record — or to "send it from Gmail". Left out, the hint
   * names no product at all rather than the wrong one.
   */
  pendingHint?: string | undefined;
  /**
   * The caller's cancellation — an MCP request's signal — asked under the record's lock, immediately before the claim
   * would change the record.
   *
   * A claim can wait: for the lock, while another process holds it. A caller that looked at its signal before calling
   * and found it clear could be cancelled during that wait, and the claim then went through all the same, spending an
   * approval on a call nobody was waiting for any more — whose outcome its caller then had to record as a failure,
   * since a claim cannot be put back. Asked here, a cancellation that lands before the record changes leaves it exactly
   * as it was, for the same call made again; one that lands after is the caller's to handle, as it always was.
   */
  signal?: AbortSignal | undefined;
}

/**
 * What to do with a download's question, for a caller that took it for something else: it is answered, not approved
 * with a code — in the chat, or at the person's own terminal with the command of the channel that asked.
 */
export const DOWNLOAD_ANSWER_HINT =
  'It is answered, not approved with a code: the person says where in the chat, or — under a confirm change policy — at their own terminal, with the `approve` command of the channel the files come from and this id. The download that asked is then made again with this id.';

/** How long a pending send or change on the `chat` route stays open: the lifetime profile's (`APPROVAL_LIFETIMES`). */
export const APPROVAL_TTL_MS: number = APPROVAL_LIFETIMES.chat;
/**
 * How long a download's question stays open: longer than an approval, because it waits on a person to decide where
 * files go — look in a folder, ask somebody — rather than to read a preview and say yes, and a question that has
 * expired is asked again from the start.
 */
export const DOWNLOAD_QUESTION_TTL_MS: number = APPROVAL_LIFETIMES.download;
/** A record left in `sending` this long belongs to a process that died mid-send: the outcome is unknown. */
export const SENDING_STALE_MS: number = 5 * 60 * 1000;
export const MAX_CHALLENGE_ATTEMPTS = 3;
const POLICY_RANK: Record<SendPolicy, number> = { chat: 0, confirm: 1, never: 2 };

/** The stricter of two policies. */
export function stricterPolicy(a: SendPolicy, b: SendPolicy): SendPolicy {
  return POLICY_RANK[a] >= POLICY_RANK[b] ? a : b;
}

/** What a refusal repeats of the record it refuses: its id and its state. */
type Refused = Pick<ApprovalRecord, 'approvalId' | 'state'>;

function refuse(code: ErrorCode, reason: string, record?: Refused, hint?: string): CommsError {
  return new CommsError(code, `nothing was sent: ${reason}`, {
    hint: hint ?? 'Prepare the send again and show the new preview to the user.',
    details: record ? { approvalId: record.approvalId, state: record.state } : {},
  });
}

/** The same refusal for a change, which sends nothing and so must not say that it did not. */
function refuseChange(code: ErrorCode, reason: string, record?: Refused, hint?: string): CommsError {
  return new CommsError(code, `nothing was changed: ${reason}`, {
    hint: hint ?? 'Prepare the change again and show the new preview to the user.',
    details: record ? { approvalId: record.approvalId, state: record.state } : {},
  });
}

/**
 * The same refusal for a download's question, which saves nothing until it is claimed.
 *
 * Its hint says to ask again rather than to prepare anything: what the person is shown again is the question, and it
 * is the download itself that asks it.
 */
function refuseDownload(code: ErrorCode, reason: string, record?: Refused, hint?: string): CommsError {
  return new CommsError(code, `nothing was saved: ${reason}`, {
    hint: hint ?? 'Make the download again without an answer, and show the person the new question.',
    details: record ? { choiceId: record.approvalId, state: record.state } : {},
  });
}

/** The refusal in the words of the record's own kind. */
function refusalFor(record: { kind?: ApprovalKind | undefined }): typeof refuse {
  const kind = approvalKind(record);
  return kind === 'change' ? refuseChange : kind === 'download' ? refuseDownload : refuse;
}

/** Whether a record was prepared under this release's digest version: only such a record is ever claimed or approved. */
export function isCurrentDigestVersion(record: { digestVersion?: unknown }): boolean {
  return record.digestVersion === DIGEST_VERSION;
}

/**
 * The refusal of a record prepared under another digest version, in the words of its own kind: the one every locked
 * transition gives, for a caller that has to refuse it before it reads anything else — a draft, a room, a message.
 */
export function otherVersionRefusal(record: Refused & { kind?: ApprovalKind | undefined }): CommsError {
  return refusalFor(record)(
    'APPROVAL_VOID',
    'the approval was prepared by a different version of agent-communications',
    record,
  );
}

/**
 * Whose decision a revoke carries, which decides what it may do to a record from an earlier release (version 1).
 *
 * `person` — a person cancelled it, from a tool, a command or a terminal. `lifecycle` — the owner it belongs to is being
 * removed, which a person approved. Either retires a version-1 record in its own shape (`revokeLegacy`), so a running
 * earlier release can no longer claim it. `integrity` — this release found the record does not match what it binds:
 * that never rewrites a version-1 record, which this release cannot judge by its own rules, and gets the version
 * refusal instead. For a version-2 record all three revoke alike.
 */
export type RevokeDisposition = 'person' | 'lifecycle' | 'integrity';

/**
 * A claim whose caller was cancelled before it changed anything (`ClaimOptions.signal`).
 *
 * `USAGE` and `cancelled:`, the words every cancellation in this repository is reported in, with `details.reason`
 * saying so for a caller that branches on it — and in the record's own kind: a question is not an approval, and
 * nothing is sent by answering one. The record is as it was, and the hint says so.
 */
function cancelledClaim(record: ApprovalRecord): CommsError {
  const kind = approvalKind(record);
  if (kind === 'download') {
    return new CommsError('USAGE', 'cancelled: nothing was saved', {
      hint: 'The question was not used: the same call, made again with the same answer, can still use it until it expires.',
      details: { choiceId: record.approvalId, state: record.state, reason: 'cancelled' },
    });
  }
  return new CommsError('USAGE', `cancelled: ${kind === 'change' ? 'nothing was changed' : 'nothing was sent'}`, {
    hint: 'The approval was not used: the same call, made again, can still use it until it expires.',
    details: { approvalId: record.approvalId, state: record.state, reason: 'cancelled' },
  });
}

/** The record as it may be shown to anyone, agents included: never the challenge hash. */
export function publicView(record: ApprovalRecord): Omit<ApprovalRecord, 'challengeHash'> {
  const { challengeHash: _hidden, ...rest } = record;
  return rest;
}

type Failure = { code: ErrorCode; reason: string };

/**
 * The refusals of a send's approval offered to a change. They name each sending channel's `approve`; another product's
 * is found only among the registrations read for it, which the store does not read under its lock — so a caller that
 * can read them says it again with them (`sendApprovesHint`).
 */
const MISDIRECTED_SENDS = new WeakSet<CommsError>();

/**
 * What an agent is told when a change waits for a person at a terminal: the printing package's own `approve` with this
 * id, located, or why there is none here.
 */
function approvePendingHint(
  handoffs: CliHandoffs | undefined,
  approvalId: string,
  platform: NodeJS.Platform | undefined,
): string {
  const located = requiredHandoffs(handoffs);
  return handoffSentence(
    located.on(platform ?? located.platform).own(['approve', approvalId]),
    (command) => `Ask the user to run ${command} in their own terminal, then try again with the same approval.`,
  );
}

/** Whether `error` is the refusal of a send's approval offered as a change's. */
export function isMisdirectedSend(error: unknown): error is CommsError {
  return error instanceof CommsError && MISDIRECTED_SENDS.has(error);
}

/**
 * What approves the send `approvalId`: the `approve` of every channel that sends, one of which prepared it — a send
 * record does not say which (D1). Each is a located command, or why it has none here.
 */
export function sendApprovesHint(maker: CliHandoffs, approvalId: string): string {
  const sending = accountChannels().filter((manifest) => manifest.accounts?.modes.includes('send') === true);
  return `It is approved with the command that prepared it — ${handoffChoices(
    sending.map((manifest) => maker.of(manifest.channel, ['approve', approvalId])),
    'and none is locatable here:',
  )} — and permits only that send.`;
}

export class ApprovalStore {
  readonly directory: string;
  readonly #now: () => Date;
  readonly #handoffs: CliHandoffs | undefined;

  constructor(stateDir: string, options: { now?: () => Date; handoffs?: CliHandoffs | undefined } = {}) {
    this.directory = join(stateDir, 'approvals');
    this.#handoffs = options.handoffs;
    this.#now = options.now ?? (() => new Date());
  }

  #path(approvalId: string, suffix = '.json'): string {
    if (!APPROVAL_ID_PATTERN.test(approvalId)) throw refuse('USAGE', `"${approvalId}" is not an approval id`);
    return join(this.directory, `${approvalId}${suffix}`);
  }

  async #read(approvalId: string): Promise<ApprovalRecord | null> {
    try {
      return JSON.parse(await readFile(this.#path(approvalId), 'utf8')) as ApprovalRecord;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw error;
    }
  }

  async #write(record: ApprovalRecord | LegacyApprovalRecord): Promise<void> {
    await writeFileAtomic(this.#path(record.approvalId), `${JSON.stringify(record, null, 2)}\n`);
  }

  /** Derived states: expiry for pending/approved, `unknown` for a send whose process died. */
  #derive(record: ApprovalRecord): ApprovalRecord {
    const observed = this.#now();
    const now = observed.getTime();
    const expiresAt = new Date(record.expiresAt).getTime();
    const createdAt = new Date(record.createdAt).getTime();
    // Expired, and also: an expiry that does not parse, and a clock that has moved behind the record's own
    // creation. `now >= NaN` is false, so a record with a nonsense `expiresAt` never expired at all; and a clock
    // stepped backwards — an NTP correction, a resumed VM, a user changing the date — put an expired record back
    // into `pending`. Neither should be the difference between a send and no send.
    const anomaly = Number.isFinite(createdAt) && now < createdAt;
    const unusable = !Number.isFinite(expiresAt);
    if ((record.state === 'pending' || record.state === 'approved') && (anomaly || unusable || now >= expiresAt)) {
      // A clock seen before the record was made expires it at the time it was seen, and says so: it never claims a
      // deadline it did not reach.
      if (anomaly) return { ...record, state: 'expired', reason: 'clock-anomaly', expiredAt: observed.toISOString() };
      return {
        ...record,
        state: 'expired',
        reason: record.reason ?? (unusable ? 'the approval window cannot be read' : 'the approval window passed'),
        // The boundary that applied, not the moment it was noticed.
        ...(unusable ? {} : { expiredAt: record.expiresAt }),
      };
    }
    if (record.state === 'sending' && now - new Date(record.updatedAt).getTime() >= SENDING_STALE_MS) {
      return { ...record, state: 'unknown', reason: 'the sending process stopped before recording an outcome' };
    }
    return record;
  }

  /** A version-1 record as its own release derived it: the state only, nothing written (`deriveLegacyV1State`). */
  #deriveLegacy(record: LegacyApprovalRecord): LegacyApprovalRecord {
    const derived = deriveLegacyV1State(record, this.#now());
    if (derived.state === record.state) return record;
    return { ...record, state: derived.state, ...(derived.reason === undefined ? {} : { reason: derived.reason }) };
  }

  /**
   * A record's binding, recomputed from its own fields, written as the last field set — and `kind`, `channel` and the
   * profile checked first, so nothing is written that names a channel this release does not know.
   */
  #bound(record: Omit<ApprovalRecord, 'bindingDigest'>): ApprovalRecord {
    requireKnownChannel(record.channel);
    return { ...record, bindingDigest: bindingDigestOf(record) };
  }

  async create(input: CreateApprovalInput): Promise<ApprovalRecord> {
    const now = this.#now();
    const requiredPolicy = stricterPolicy(input.policy, input.requiredPolicy);
    // The route is fixed here, and never moves: a person outside the chat when the policy or an escalation says so.
    const route: ApprovalRoute = requiredPolicy === 'confirm' ? 'confirm' : 'chat';
    const pendingMs = pendingMsOf(route);
    // Built field by field: nothing a caller passes can set the id, the state or a challenge.
    const record = this.#bound({
      approvalId: newApprovalId(),
      kind: 'send',
      digestVersion: DIGEST_VERSION,
      channel: input.channel,
      ownerScope: 'owner',
      route,
      pendingMs,
      approvedMs: APPROVAL_LIFETIMES.approved,
      inboxId: input.inboxId,
      inboxSub: input.inboxSub,
      draftId: input.draftId,
      draftMessageId: input.draftMessageId,
      contentDigest: input.contentDigest,
      sendEpoch: input.sendEpoch,
      policy: input.policy,
      requiredPolicy,
      riskFlags: [...input.riskFlags],
      expect: {
        to: [...input.expect.to],
        cc: [...input.expect.cc],
        bcc: [...input.expect.bcc],
        subject: input.expect.subject,
      },
      challengeAttempts: 0,
      state: 'pending',
      createdAt: now.toISOString(),
      expiresAt: new Date(now.getTime() + pendingMs).toISOString(),
      updatedAt: now.toISOString(),
    });
    await this.#write(record);
    return record;
  }

  async get(approvalId: string): Promise<ApprovalRecord | null> {
    const record = await this.#read(approvalId);
    if (record === null) return null;
    // A record from an earlier release is read by its own release's rules (Task 3 types this read; until then the
    // shape is the caller's to check, as it always was).
    if (record.digestVersion === LEGACY_DIGEST_VERSION) {
      return this.#deriveLegacy(record as unknown as LegacyApprovalRecord) as unknown as ApprovalRecord;
    }
    return this.#derive(record);
  }

  /**
   * Compare-and-swap under the record's lock. `decide` returns the next record (written) or throws (nothing written).
   *
   * A record of another digest version is refused before anything is derived or written: the derived state of a record
   * this release cannot claim is not this release's to persist, and 0.13.0 persisted `expired` here first.
   */
  async #transition(approvalId: string, decide: (current: ApprovalRecord) => ApprovalRecord): Promise<ApprovalRecord> {
    const path = this.#path(approvalId);
    return withFileLock(`${path}.lock`, async () => {
      const stored = await this.#read(approvalId);
      if (!stored) throw refuse('NOT_FOUND', `no approval ${approvalId}`);
      if (!isCurrentDigestVersion(stored)) throw otherVersionRefusal(stored);
      const current = this.#derive(stored);
      if (current.state !== stored.state) await this.#write({ ...current, updatedAt: this.#now().toISOString() });
      const next = decide(current);
      if (next !== current) await this.#write({ ...next, updatedAt: this.#now().toISOString() });
      return next;
    });
  }

  #stateError(record: ApprovalRecord): CommsError {
    const refusal = refusalFor(record);
    // A question is answered, not approved, and said so: "the approval is used" sends nobody anywhere useful.
    if (approvalKind(record) === 'download') {
      if (record.state === 'expired')
        return refusal('APPROVAL_EXPIRED', 'the question expired before it was answered', record);
      if (record.state === 'revoked') {
        return refusal('APPROVAL_VOID', `the question was voided (${record.reason ?? 'revoked'})`, record);
      }
      return refusal(
        'APPROVAL_VOID',
        record.state === 'used'
          ? 'the question was answered already, and an answer is used once'
          : `the question is ${record.state}`,
        record,
      );
    }
    if (record.state === 'expired')
      return refusal('APPROVAL_EXPIRED', 'the approval expired before it was used', record);
    if (record.state === 'revoked') {
      return refusal('APPROVAL_VOID', `the approval was voided (${record.reason ?? 'revoked'})`, record);
    }
    return refusal('APPROVAL_REQUIRED', `the approval is ${record.state}`, record);
  }

  /**
   * Refuses a record of the other kind, writing nothing to it.
   *
   * Nothing written, because the caller made a mistake about an approval that may be perfectly good: voiding a post
   * somebody is about to approve, because an agent passed its id to a change, would punish the wrong party.
   */
  #requireKind(
    record: ApprovalRecord,
    kind: ApprovalKind,
    platform: NodeJS.Platform,
    handoffs: CliHandoffs | undefined = this.#handoffs,
  ): void {
    // Only the refusals that name a command need the printing package's handoffs; asked for one without them is a
    // programming error (`requiredHandoffs`).
    const maker = () => requiredHandoffs(handoffs).on(platform);
    const actual = approvalKind(record);
    if (actual === kind) return;
    const id = record.approvalId;
    // A question about where to save files, and anything claimed as one, in words of their own: neither the send's
    // refusal nor the change's describes it, and each would send the caller to a command that cannot help.
    if (actual === 'download') {
      throw (kind === 'change' ? refuseChange : refuse)(
        'USAGE',
        `${id} is a question about where to save files, not ${kind === 'send' ? 'a send' : 'a configuration change'}`,
        record,
        DOWNLOAD_ANSWER_HINT,
      );
    }
    if (kind === 'download') {
      throw refuseDownload(
        'USAGE',
        `${id} is ${actual === 'change' ? 'a configuration change' : 'a send'}, not a question about where to save files`,
        record,
        'Pass the choice id the download’s question came with, and the person’s answer beside it.',
      );
    }
    if (kind === 'send') {
      throw refuse(
        'USAGE',
        `approval ${id} is for a configuration change, not a send`,
        record,
        // A change is approved by any of the suite's `approve` commands, so the printing package's own does it.
        handoffSentence(
          maker().own(['approve', id]),
          (command) => `A person approves it with ${command}, and it permits only the change it was prepared for.`,
        ),
      );
    }
    const misdirected = refuseChange(
      'USAGE',
      `approval ${id} is for a send, not a configuration change`,
      record,
      sendApprovesHint(maker(), id),
    );
    MISDIRECTED_SENDS.add(misdirected);
    throw misdirected;
  }

  /** Issues a new challenge to show a human; only its hash is kept. */
  async issueChallenge(
    approvalId: string,
    kind: ApprovalKind = 'send',
    platform: NodeJS.Platform = process.platform,
  ): Promise<string> {
    const challenge = newChallenge();
    await this.#transition(approvalId, (current) => {
      this.#requireKind(current, kind, platform);
      if (current.state !== 'pending') throw this.#stateError(current);
      return { ...current, challengeHash: hashChallenge(challenge) };
    });
    return challenge;
  }

  /**
   * A human approved through a confirm channel by typing the issued challenge. The draft must still be exactly what the
   * record was prepared for; otherwise the record is voided, because the human would be approving content the record
   * does not describe. Three wrong answers void it too.
   *
   * A change is approved the same way, with `kind: 'change'` and its digest standing in for the draft (see
   * `createChange`), so a person's typed code means one thing whichever kind of approval it is typed for.
   */
  async approve(
    approvalId: string,
    via: ApprovalChannel,
    live: LiveDraft,
    answer: string,
    kind: ApprovalKind = 'send',
    platform: NodeJS.Platform = process.platform,
  ): Promise<ApprovalRecord> {
    let failure: Failure | null = null;
    const result = await this.#transition(approvalId, (current) => {
      this.#requireKind(current, kind, platform);
      if (current.state !== 'pending') throw this.#stateError(current);
      if (!current.challengeHash)
        throw refusalFor(current)('APPROVAL_REQUIRED', 'no challenge was issued for this approval', current);
      const at = this.#now();
      if (live.draftMessageId !== current.draftMessageId || live.contentDigest !== current.contentDigest) {
        const reason =
          kind === 'change'
            ? 'the change shown is not the one the approval was prepared for'
            : 'the draft changed after the preview was prepared';
        failure = { code: 'APPROVAL_VOID', reason };
        return { ...current, state: 'revoked', reason: failure.reason, revokedAt: at.toISOString() };
      }
      if (!challengeMatches(answer, current.challengeHash)) {
        const attempts = current.challengeAttempts + 1;
        if (attempts >= MAX_CHALLENGE_ATTEMPTS) {
          failure = { code: 'APPROVAL_VOID', reason: 'too many wrong answers to the challenge' };
          return {
            ...current,
            challengeAttempts: attempts,
            state: 'revoked',
            reason: failure.reason,
            revokedAt: at.toISOString(),
          };
        }
        failure = { code: 'APPROVAL_REQUIRED', reason: 'the challenge did not match' };
        return { ...current, challengeAttempts: attempts };
      }
      // Approval starts a window of its own, and records the binding the person approved.
      return {
        ...current,
        state: 'approved',
        approvedVia: via,
        approvedAt: at.toISOString(),
        usableUntil: new Date(at.getTime() + (current.approvedMs ?? APPROVAL_LIFETIMES.approved)).toISOString(),
        approvedBindingDigest: current.bindingDigest,
        challengeHash: undefined,
      };
    });
    const failed = failure as Failure | null;
    if (failed) throw refusalFor(result)(failed.code, failed.reason, result);
    return result;
  }

  /**
   * Claims the record for sending, once. Non-consuming refusals (not yet approved) leave the record untouched so the
   * human can still approve it; integrity failures (other inbox or account, edited or changed draft, different
   * recipients or subject) void it. Success creates the O_EXCL claim marker.
   */
  async claimForSend(
    approvalId: string,
    live: LiveDraft & { inboxId: string; inboxSub?: string | undefined; policy: SendPolicy; expect: Expectation },
    options: ClaimOptions = {},
  ): Promise<ApprovalRecord> {
    let failure: Failure | null = null;
    const result = await this.#transition(approvalId, (current) => {
      // Before anything else: a change approval names an account in the same field, and a send claimed against it
      // would otherwise be judged — and voided — as a send that went wrong.
      this.#requireKind(current, 'send', options.platform ?? process.platform, options.handoffs ?? this.#handoffs);
      if (current.state !== 'pending' && current.state !== 'approved') throw this.#stateError(current);
      /*
       * Cancelled while the claim waited for the lock: nothing written, the record as it was. Here, before every branch
       * below that writes, and with nothing awaited between this look and the write that changes the record — so no
       * cancellation can land in between.
       */
      if (options.signal?.aborted) throw cancelledClaim(current);
      const at = this.#now().toISOString();
      const voidWith = (code: ErrorCode, reason: string): ApprovalRecord => {
        failure = { code, reason };
        return { ...current, state: 'revoked', reason, revokedAt: at };
      };
      if (live.inboxId !== current.inboxId)
        return voidWith('APPROVAL_VOID', 'the approval belongs to a different inbox');
      // Fail closed: an approval prepared against a known account may only be claimed by a caller that names the same
      // account. A caller that passes none is refused rather than trusted, whatever the reason it has none.
      if (current.inboxSub && current.inboxSub !== live.inboxSub) {
        return voidWith(
          'APPROVAL_VOID',
          live.inboxSub
            ? 'the inbox is now connected to a different account'
            : 'the account this was prepared for could not be confirmed',
        );
      }
      if (live.policy === 'never')
        return voidWith('POLICY_NEVER', 'sending is turned off for this inbox (policy: never)');
      if (live.draftMessageId !== current.draftMessageId) {
        return voidWith('APPROVAL_VOID', 'the draft was edited after the preview');
      }
      if (live.contentDigest !== current.contentDigest)
        return voidWith('APPROVAL_VOID', 'the draft content changed after the preview');
      if (!sameExpectation(live.expect, current.expect)) {
        return voidWith('APPROVAL_VOID', 'the recipients or subject given do not match the prepared draft');
      }
      // A switch over the effective policy, so a policy value nobody thought about here cannot fall through to
      // "send it". `never` reached this way is not only the live setting: a record can carry
      // `requiredPolicy: never`, and reading only for `confirm` let that one straight through.
      const effective = stricterPolicy(live.policy, current.requiredPolicy);
      switch (effective) {
        case 'never':
          return voidWith('POLICY_NEVER', 'sending is turned off for this approval (policy: never)');
        case 'confirm': {
          if (current.state !== 'approved') {
            throw refuse(
              'APPROVAL_PENDING',
              'this send needs approval outside the chat first',
              current,
              options.pendingHint ??
                'Ask the user to approve it outside the chat, then try again with the same approval.',
            );
          }
          // The binding the person approved must be the record's own: content, route and identity alike.
          if (current.approvedBindingDigest !== current.bindingDigest) {
            return voidWith('APPROVAL_VOID', 'the approved content is not the content now in the draft');
          }
          break;
        }
        case 'chat':
          break;
      }
      return { ...current, state: 'sending', sendingAt: at };
    });
    const failed = failure as Failure | null;
    if (failed) throw refuse(failed.code, failed.reason, result);
    await this.#markClaimed(result);
    return result;
  }

  /** The file system's O_EXCL is the single-use guarantee, independent of the lock. */
  async #markClaimed(record: ApprovalRecord): Promise<void> {
    await ensurePrivateDir(this.directory);
    try {
      const marker = await open(this.#path(record.approvalId, '.claim'), 'wx', 0o600);
      await marker.writeFile(JSON.stringify({ pid: process.pid, at: this.#now().toISOString() }));
      await marker.close();
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'EEXIST') {
        throw refusalFor(record)('APPROVAL_VOID', 'this approval was already claimed by another process', record);
      }
      throw error;
    }
  }

  /**
   * A change approval, pending, bound to `changeDigest(input.change)`.
   *
   * The digest is computed here, never taken from the caller, so a record cannot claim to be bound to one change while
   * describing another. It stands in for the draft revision too, as a reaction's does: a change has no draft, and the
   * same value means the same change.
   */
  async createChange(input: CreateChangeApprovalInput): Promise<ApprovalRecord> {
    const now = this.#now();
    const change: ChangeBinding = {
      summary: input.change.summary,
      target: input.change.target === null ? null : { ...input.change.target },
      loosened: input.change.loosened.map((loosening) => ({ ...loosening })),
      settings: (input.change.settings ?? []).map((setting) => ({ ...setting })),
      effects: [...input.change.effects],
      ...(input.change.doneAtOnce !== undefined && input.change.doneAtOnce.length > 0
        ? { doneAtOnce: [...input.change.doneAtOnce] }
        : {}),
    };
    const digest = changeDigest(change);
    // What `inboxId` names, from the shape `targetOf` gives a change: nothing, an owner this change creates, or one
    // that exists. Only the last is ever "an owner that was removed".
    const ownerScope: OwnerScope =
      change.target === null ? 'global' : change.target.id === undefined ? 'prospective' : 'owner';
    // The route is the live change policy, fixed now.
    const route: ApprovalRoute = input.policy === 'confirm' ? 'confirm' : 'chat';
    const pendingMs = pendingMsOf(route);
    const record = this.#bound({
      approvalId: newApprovalId(),
      kind: 'change',
      digestVersion: DIGEST_VERSION,
      channel: input.channel,
      ownerScope,
      route,
      pendingMs,
      approvedMs: APPROVAL_LIFETIMES.approved,
      inboxId: change.target?.id ?? '',
      draftId: 'change',
      draftMessageId: digest,
      contentDigest: digest,
      policy: input.policy,
      requiredPolicy: input.policy,
      riskFlags: [],
      // Not an expectation of recipients — a change has none — but it is the field every listing already shows.
      expect: { to: [], cc: [], bcc: [], subject: change.summary },
      challengeAttempts: 0,
      state: 'pending',
      createdAt: now.toISOString(),
      expiresAt: new Date(now.getTime() + pendingMs).toISOString(),
      updatedAt: now.toISOString(),
      change,
    });
    await this.#write(record);
    return record;
  }

  /**
   * Claims a change approval, once, for the change the caller is about to write.
   *
   * `live.change` is the change as the caller computes it now, and it has to digest to what was prepared: a different
   * path, a different value, a different account or a different effect voids the approval, because the person agreed
   * to something else. `live.policy` is the change policy in force now, and the stricter of it and the one at prepare
   * decides — so tightening the policy after an agent prepared a change takes effect on that change, and loosening it
   * does not release one prepared under `confirm`.
   *
   * Under `chat` a pending approval is claimable: the yes was given in the conversation. Anything stricter needs a
   * person to have typed the code at a terminal first; until then the refusal leaves the record as it is.
   */
  async claimForChange(approvalId: string, live: LiveChange, options: ClaimOptions = {}): Promise<ApprovalRecord> {
    const digest = changeDigest(live.change);
    let failure: Failure | null = null;
    const result = await this.#transition(approvalId, (current) => {
      this.#requireKind(current, 'change', options.platform ?? process.platform, options.handoffs ?? this.#handoffs);
      if (current.state !== 'pending' && current.state !== 'approved') throw this.#stateError(current);
      // As for a send: a cancellation that landed while this waited for the lock writes nothing.
      if (options.signal?.aborted) throw cancelledClaim(current);
      const at = this.#now().toISOString();
      const voidWith = (reason: string): ApprovalRecord => {
        failure = { code: 'APPROVAL_VOID', reason };
        return { ...current, state: 'revoked', reason, revokedAt: at };
      };
      if (digest !== current.contentDigest) {
        return voidWith(
          current.change ? changeDrift(current.change, live.change) : 'the change is not the one that was approved',
        );
      }
      if (stricterPolicy(live.policy, current.requiredPolicy) !== 'chat') {
        if (current.state !== 'approved') {
          throw refuseChange(
            'APPROVAL_PENDING',
            'this change needs a person to approve it at a terminal first',
            current,
            options.pendingHint ?? approvePendingHint(options.handoffs ?? this.#handoffs, approvalId, options.platform),
          );
        }
        // `confirm` means a person at a terminal. An approval given any other way — a form in a client window, which
        // is how a send may be approved — is not what the policy asked for.
        if (current.approvedVia !== 'terminal') {
          return voidWith('the change policy is confirm, and this was not approved at a terminal');
        }
      }
      return { ...current, state: 'used', usedAt: at };
    });
    const failed = failure as Failure | null;
    if (failed) throw refuseChange(failed.code, failed.reason, result);
    await this.#markClaimed(result);
    return result;
  }

  /**
   * A download's question, pending, bound to `downloadDigest(input.download)` — computed here, never taken from the
   * caller, as a change's digest is. It stands in for the draft revision too.
   *
   * `policy` is the change policy of the mailbox or workspace the files come from, as it stands when the question is
   * asked: where a stranger's files land on this machine is a change to it, and is answered the way that account's
   * other changes are approved. A claim holds the question to the stricter of this and the policy then.
   */
  async createDownload(input: {
    /** The manifest channel the files come from. */
    channel: string;
    download: DownloadBinding;
    policy: ChangePolicy;
  }): Promise<ApprovalRecord & { download: DownloadBinding }> {
    const now = this.#now();
    const download: DownloadBinding = {
      summary: input.download.summary,
      target: { ...input.download.target },
      operation: input.download.operation,
      request: JSON.parse(canonicalJson(input.download.request)) as Record<string, unknown>,
      files: [...input.download.files],
      names: [...input.download.names],
      folders: { downloads: input.download.folders.downloads, current: input.download.folders.current },
      ...(input.download.listing === undefined
        ? {}
        : {
            listing: input.download.listing.map((file) => ({
              name: file.name,
              size: file.size,
              ...(file.renamed === undefined ? {} : { renamed: file.renamed }),
              ...(file.flags === undefined || file.flags.length === 0 ? {} : { flags: [...file.flags] }),
            })),
          }),
    };
    const digest = downloadDigest(download);
    // Anything but `chat` is `confirm`: a policy word this release does not know is not a reason to ask less.
    const policy: ChangePolicy = input.policy === 'chat' ? 'chat' : 'confirm';
    const record = this.#bound({
      approvalId: newApprovalId(),
      kind: 'download',
      digestVersion: DIGEST_VERSION,
      channel: input.channel,
      ownerScope: 'owner',
      pendingMs: APPROVAL_LIFETIMES.download,
      inboxId: download.target.id,
      draftId: 'download',
      draftMessageId: digest,
      contentDigest: digest,
      policy,
      requiredPolicy: policy,
      riskFlags: [],
      // Not an expectation of recipients, as for a change: the field every listing already shows.
      expect: { to: [], cc: [], bcc: [], subject: download.summary },
      challengeAttempts: 0,
      state: 'pending',
      createdAt: now.toISOString(),
      expiresAt: new Date(now.getTime() + APPROVAL_LIFETIMES.download).toISOString(),
      updatedAt: now.toISOString(),
      download,
    });
    await this.#write(record);
    return record as ApprovalRecord & { download: DownloadBinding };
  }

  /**
   * Records the person's answer to a download's question, given where an agent cannot give it: at their own terminal,
   * or in a form a trusted client showed them. The question moves to `approved`, carrying the answer, and waits for
   * the download to claim it — which it may then do under `confirm`, and which saves where this answer says.
   *
   * Only a pending question can be answered, and only once: a second answer is refused, not taken over the first.
   */
  async answerDownload(
    approvalId: string,
    via: ApprovalChannel,
    answer: RecordedSaveAnswer,
    platform: NodeJS.Platform = process.platform,
  ): Promise<ApprovalRecord & { download: DownloadBinding }> {
    const recorded: RecordedSaveAnswer =
      answer.choice === 'other' ? { choice: 'other', folder: answer.folder } : { choice: answer.choice };
    const result = await this.#transition(approvalId, (current) => {
      this.#requireKind(current, 'download', platform);
      if (current.state === 'approved') {
        throw refuseDownload('APPROVAL_VOID', 'the question was answered already, and it is answered once', current);
      }
      if (current.state !== 'pending') throw this.#stateError(current);
      if (!current.download || downloadDigest(current.download) !== current.contentDigest) {
        throw refuseDownload('APPROVAL_VOID', 'the question does not describe the download it is bound to', current);
      }
      // No `approvedAt`: a question is answered, not approved into a window of its own. The answer is bound to it.
      return {
        ...current,
        state: 'approved',
        approvedVia: via,
        approvedDigest: sha256Hex(canonicalJson({ bindingDigest: current.bindingDigest, answer: recorded })),
        download: { ...current.download, answer: recorded },
      };
    });
    return result as ApprovalRecord & { download: DownloadBinding };
  }

  /**
   * Claims a download's question, once, for the download the caller is about to make — and returns it, with the
   * folders it offered, so that `downloads` and `current` in the answer mean the paths the person read, and with the
   * answer the person recorded, when they recorded one.
   *
   * `live` is the download as the caller computes it now: the same account, the same request, the same files under
   * the same names — the person answered for those files and no others. Any other is refused, and the question left
   * open, as it was: a second call that got an argument wrong is the agent's slip, not the person's, and voiding the
   * question for it would make the person answer again for nothing. It still expires, and is claimed once.
   *
   * `options.policy` is the change policy of that account now, and the stricter of it and the one the question was
   * asked under decides. Under `chat`, a pending question is claimed with the answer the caller carries: the person
   * gave it in the conversation. Under `confirm`, only a question the person answered at a terminal or in a trusted
   * form can be claimed; a pending one is refused, and left as it is, so they can still answer it. One used, voided or
   * expired is refused as an approval in that state is.
   *
   * `options.signal` is the download's cancellation, asked under the lock as a send's is (`ClaimOptions.signal`): a
   * download cancelled while this waited saves nothing and leaves the question open, the answer still unused.
   */
  async claimForDownload(
    approvalId: string,
    live: DownloadRequest,
    options: {
      policy?: ChangePolicy | undefined;
      pendingHint?: string | undefined;
      signal?: AbortSignal | undefined;
      platform?: NodeJS.Platform | undefined;
      handoffs?: CliHandoffs | undefined;
    } = {},
  ): Promise<ApprovalRecord & { download: DownloadBinding }> {
    const digest = downloadDigest(live);
    let failure: Failure | null = null;
    const result = await this.#transition(approvalId, (current) => {
      this.#requireKind(current, 'download', options.platform ?? process.platform, options.handoffs ?? this.#handoffs);
      if (current.state !== 'pending' && current.state !== 'approved') throw this.#stateError(current);
      if (options.signal?.aborted) throw cancelledClaim(current);
      const at = this.#now().toISOString();
      const voidWith = (reason: string): ApprovalRecord => {
        failure = { code: 'APPROVAL_VOID', reason };
        return { ...current, state: 'revoked', reason, revokedAt: at };
      };
      // What the record says it asked about has to be what its digest binds, or it describes nothing at all.
      if (!current.download || downloadDigest(current.download) !== current.contentDigest) {
        return voidWith('the question does not describe the download it is bound to');
      }
      if (digest !== current.contentDigest) {
        throw refuseDownload(
          'USAGE',
          `${downloadDrift(current.download, live)}; the question is still open`,
          current,
          'Call again with the same arguments the question was asked with, and its choice id. If the files themselves changed, make the download again without an answer, and show the person the new question.',
        );
      }
      const refusal = downloadClaimRefusal(current, options.policy ?? 'chat', options.pendingHint);
      if (refusal !== null) throw refusal;
      return { ...current, state: 'used', usedAt: at };
    });
    const failed = failure as Failure | null;
    if (failed) throw refuseDownload(failed.code, failed.reason, result);
    await this.#markClaimed(result);
    return result as ApprovalRecord & { download: DownloadBinding };
  }

  /**
   * Records the outcome of the one send attempt: `used` with the provider's id for it, when the provider accepted it,
   * or `failed`.
   *
   * `used` needs a non-empty id. A provider that accepted a send without one has not given anything to record it by,
   * so the record is left as it is — `sending`, and then `unknown` — rather than made `used` with an empty id that
   * every later reader would take for one.
   */
  async complete(approvalId: string, outcome: { sentMessageId: string } | { error: string }): Promise<ApprovalRecord> {
    if ('sentMessageId' in outcome && outcome.sentMessageId === '') {
      throw new CommsError('BAD_DATA', 'the provider returned no id for the send, so it is not recorded as used', {
        hint: 'The send may have happened: check before sending again.',
        details: { approvalId },
      });
    }
    return this.#transition(approvalId, (current) => {
      if (current.state !== 'sending' && current.state !== 'unknown') throw this.#stateError(current);
      const at = this.#now().toISOString();
      // `usedAt` is the moment the provider accepted it, and so equal to `sentAt`.
      return 'sentMessageId' in outcome
        ? { ...current, state: 'used', sentMessageId: outcome.sentMessageId, sentAt: at, usedAt: at }
        : { ...current, state: 'failed', reason: outcome.error, failedAt: at };
    });
  }

  /**
   * Voids a pending or approved record. Other records are left as they are.
   *
   * `disposition` says whose decision this is, and has no default: every caller chooses (`RevokeDisposition`). A
   * version-1 record is retired in its own shape when a person or an owner's removal revokes it (`revokeLegacy`), and
   * refused with the version refusal, nothing written, when this release's integrity check would have voided it.
   */
  async revoke(
    approvalId: string,
    reason: string,
    options: { disposition: RevokeDisposition },
  ): Promise<ApprovalRecord> {
    if (options.disposition !== 'integrity') {
      const raw = await this.#read(approvalId);
      if (raw !== null && raw.digestVersion === LEGACY_DIGEST_VERSION) {
        return (await this.revokeLegacy(approvalId, reason)) as unknown as ApprovalRecord;
      }
    }
    return this.#transition(approvalId, (current) =>
      current.state === 'pending' || current.state === 'approved'
        ? { ...current, state: 'revoked', reason, revokedAt: this.#now().toISOString() }
        : current,
    );
  }

  /**
   * Retires a record from an earlier release (version 1) in that release's own shape, so a process still running it
   * can no longer claim the record — and nothing more.
   *
   * Under the record's own lock, `<id>.json.lock`, the one 0.13.0's transitions take, so the two serialise. The file
   * is read again there and its state derived by its own release's rules (`deriveLegacyV1State`). Only a `pending` or
   * `approved` record is rewritten, as itself plus `state: 'revoked'`, the reason and `updatedAt`: its digest version
   * stays 1, a send stays without a `kind`, and no field of this release's is added — no claim marker either. Any other
   * derived state is returned as it reads and written nothing: an expired record is never rewritten, as `revoke`
   * leaves every finished record as it is.
   *
   * It reads no configuration and needs no owner, so it works on a record whose account is already gone. Its only
   * callers are a person's revoke, the removal of the record's owner, and the legacy drain.
   */
  async revokeLegacy(approvalId: string, reason: string): Promise<LegacyApprovalRecord> {
    const path = this.#path(approvalId);
    return withFileLock(`${path}.lock`, async () => {
      const stored = await this.#read(approvalId);
      if (!stored) throw refuse('NOT_FOUND', `no approval ${approvalId}`);
      if (stored.digestVersion !== LEGACY_DIGEST_VERSION) {
        throw refusalFor(stored)(
          'APPROVAL_VOID',
          'the approval is not one an earlier release prepared, so it is not retired as one',
          stored,
        );
      }
      const raw = stored as unknown as LegacyApprovalRecord;
      const derived = this.#deriveLegacy(raw);
      if (derived.state !== 'pending' && derived.state !== 'approved') return derived;
      const revoked: LegacyApprovalRecord = { ...raw, state: 'revoked', reason, updatedAt: this.#now().toISOString() };
      await this.#write(revoked);
      return revoked;
    });
  }

  async list(filter: { inboxId?: string; states?: ApprovalState[] } = {}): Promise<ApprovalRecord[]> {
    let names: string[];
    try {
      // The same pattern the store validates an id against, so a file this listing shows is a file it can open.
      // A looser one here silently skipped records whose names it had itself accepted as plausible.
      names = (await readdir(this.directory)).filter((name) => APPROVAL_ID_PATTERN.test(name.replace(/\.json$/, '')));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
      throw error;
    }
    const records: ApprovalRecord[] = [];
    for (const name of names) {
      const record = await this.get(name.slice(0, -5)).catch(() => null);
      if (!record) continue;
      if (filter.inboxId && record.inboxId !== filter.inboxId) continue;
      if (filter.states && !filter.states.includes(record.state)) continue;
      records.push(record);
    }
    return records.sort((a, b) => (a.createdAt < b.createdAt ? -1 : 1));
  }
}

/**
 * Compares recipient lists by address alone. A provider may return `Name <addr>` where the caller gave `addr`, and
 * a difference in display name is not a difference in who receives the mail — while a spurious mismatch voids an
 * approval the user already gave, and sends them round the loop again.
 */
/**
 * The address inside an entry, read the same way every other part of this package reads it.
 *
 * This took the **first** `<…>` while `normaliseAddress` takes the **last**, so
 * `"<attacker@evil.test> Sam <sam@partner.test>"` satisfied an expectation check against one address while every
 * other reader saw the other. Two parsers for one idea is how a check ends up guarding something different from
 * what it appears to guard.
 */
function bareAddress(entry: string): string {
  return normaliseAddress(entry);
}

function sameList(a: readonly string[], b: readonly string[]): boolean {
  const norm = (list: readonly string[]) => [...new Set(list.map(bareAddress))].sort().join('\n');
  return norm(a) === norm(b);
}

export function sameExpectation(a: Expectation, b: Expectation): boolean {
  return (
    sameList(a.to, b.to) && sameList(a.cc, b.cc) && sameList(a.bcc, b.bcc) && a.subject.trim() === b.subject.trim()
  );
}
