import { join } from 'node:path';
import { storeInternals } from './approval-internals.ts';
import { type MaintenanceStatus, runMaintenance } from './approval-maintenance.ts';
import {
  type ApprovalOutcome,
  approvalOutcome,
  liveGateOf,
  NEVER_NOTICE,
  type PublicApprovalView,
  publicApproval,
  type SenderField,
} from './approval-outcome.ts';
import { decodeStored, type StoredApproval } from './approval-stored.ts';
import type { ApprovalGrouping } from './channel-manifest.ts';
import { channelLabel, isChannel } from './channel-servers.ts';
import { CHANNEL_SNAPSHOT } from './channels.generated.ts';
import type { Config } from './config.ts';
import type { Core } from './core.ts';
import { APPROVAL_ID_PATTERN } from './ids.ts';
import { type TryLockResult, tryFileLock } from './lock.ts';

/**
 * The unsent report (design 2026-10-05 §D9, "Draft send history says only what the records read can prove"): which of
 * a channel's drafts had a send approval prepared in the last seven days whose newest preparation expired — and what
 * the approval records the report actually read can say about whether anything went out.
 *
 * A draft is grouped by the rule its channel declares in its manifest (`approvalGrouping`), applied to the generic
 * fields every record stores, so a new channel chooses a rule without any edit here. One shared deadline bounds the
 * whole report — the day's retention first, then the scan — and every gap in what was read is said, never filled in:
 * a capped scan says so, and anything unreadable, unverifiable, busy or left unread by the deadline makes the claims
 * it could affect indeterminate.
 *
 * A surface showing its own drafts may ask for just those (`drafts`), and — to annotate one exact draft — for a row
 * where a claimed or standing approval decides it even though its newest preparation did not expire (`decided`).
 *
 * Reporting creates, sends and deletes nothing, and writes no record: what it derives (an expiry, an `unknown`), it
 * derives in memory.
 */

/** How many approval files the report opens at most: the most recently changed. */
export const UNSENT_WINDOW = 500;
/** How many draft rows it returns at most. */
export const UNSENT_ROWS = 20;
/** How recent a send approval has to be for its draft to be a candidate. */
export const UNSENT_CANDIDATE_MS: number = 7 * 24 * 60 * 60 * 1000;
/** The report's shared elapsed budget, when its caller gives it no deadline. */
export const UNSENT_BUDGET_MS = 5_000;

/** What the records read can support: everything retained, the newest 500, or not enough to say. */
export type EvidenceScope = 'complete-90-days' | 'last-500' | 'indeterminate';
/**
 * Why a report is not the whole picture: the directory held more files than the window (`window`), more draft groups
 * qualified than are returned (`rows`), or the deadline stopped local work (`deadline`).
 */
export type UnsentTruncation = 'window' | 'rows' | 'deadline';

/** The exact words of each finding (design 2026-10-05 §D9). */
export const UNSENT_WORDS: Readonly<{
  complete: string;
  window: string;
  unreadable: string;
  busy: string;
  deadline: string;
  corrupt: string;
  ready: string;
}> = Object.freeze({
  complete: 'not sent with any approval in the last 90 days',
  window: 'not sent with any of the 500 most recently changed approval records',
  unreadable: 'indeterminate (an approval record could not be read)',
  busy: 'indeterminate (an approval record was busy)',
  deadline: 'indeterminate (the report deadline left approval records unread)',
  corrupt: 'indeterminate (an approval record for it failed its integrity check)',
  ready: 'approved and ready to send',
});

/**
 * Where a draft stands, by the records read: `unsent` (by the scope's words), `approved` (an approval is still there),
 * `sending`, `used` or `unknown` (an approval was claimed), or `indeterminate`.
 */
export type UnsentStatus = 'unsent' | 'approved' | 'sending' | 'used' | 'unknown' | 'indeterminate';

/** A draft, as its channel's rule groups its approvals: the mailbox or account and draft, and for Slack the revision. */
export interface UnsentKey {
  readonly channel: string;
  readonly inboxId: string;
  readonly draftId: string;
  /** `draft-revision-digest` only: the exact revision and content digest. */
  readonly draftMessageId?: string | undefined;
  readonly contentDigest?: string | undefined;
}

export interface UnsentRow {
  readonly key: UnsentKey;
  readonly status: UnsentStatus;
  /** The finding, in its exact words. */
  readonly said: string;
  readonly evidence: EvidenceScope;
  /** The last preparation: the newest matching approval read, and when it expired (always, but in a `decided` row). */
  readonly last: {
    readonly approvalId: string;
    readonly createdAt: string;
    readonly expiresAt: string;
    readonly expiredAt?: string | undefined;
  };
  /** The approval that decided a status other than `unsent` or `indeterminate`. */
  readonly decidedBy?: string | undefined;
  /** Every matching approval read, newest first, as status and lists show it: each sender-written field enveloped. */
  readonly approvals: readonly PublicApprovalView[];
}

export interface UnsentReport {
  readonly channel: string;
  /** The rule the channel declares; null for a channel that takes no part. */
  readonly grouping: ApprovalGrouping | null;
  /** At most 20, newest preparation first. */
  readonly rows: readonly UnsentRow[];
  /** What the scan as a whole can support. */
  readonly evidence: EvidenceScope;
  readonly truncated: readonly UnsentTruncation[];
  /** What the scan read: never a record's contents, only ids. */
  readonly scanned: {
    /** Approval files in the directory when it was listed. */
    readonly files: number;
    /** Selected for reading: the newest `UNSENT_WINDOW` by modification time. */
    readonly window: number;
    readonly opened: number;
    /** Busy when tried: another process held its lock. */
    readonly busy: readonly string[];
    /** Could not be read, or its ownership could not be verified. */
    readonly unreadable: readonly string[];
    /** Selected, and left unread when the deadline came. */
    readonly unread: number;
  };
  /** The day's retention, run first on the same deadline. */
  readonly maintenance: MaintenanceStatus;
}

/**
 * One draft a surface asks about (`UnsentOptions.drafts`): its id, and — for a channel that groups by revision — the
 * exact revision, under whichever content digests it was prepared with.
 */
export interface UnsentDraftFilter {
  readonly draftId: string;
  /** `draft-revision-digest` only: this revision and no other. Left out, every revision of the draft. */
  readonly revision?: string | undefined;
}

/** Which approval a sender-written field belongs to, for a wrapper that names it in its envelope. */
export interface UnsentFieldOwner {
  readonly approvalId: string;
  /** The mailbox or account it was prepared for, by id: the group's own. */
  readonly inboxId: string;
}

/**
 * How each sender-written field of a row's approvals is wrapped: as `SenderFieldWrapper`, told whose approval the field
 * is — so a channel's envelope can name the mailbox and the approval each one came from.
 */
export type UnsentFieldWrapper = (text: string, field: SenderField, owner: UnsentFieldOwner) => string;

export interface UnsentOptions {
  /** The manifest channel whose drafts to report. */
  readonly channel: string;
  /** Only this mailbox's or account's drafts. Everything any record says still counts toward the scan's evidence. */
  readonly owner?: string | undefined;
  /**
   * Only these drafts — what a surface showing its own drafts asks for, so that others cannot crowd them out of the 20
   * rows. Applied to the groups, after every record in the window was opened and grouped: everything any record says
   * still counts toward the scan's evidence, exactly as with `owner`.
   */
  readonly drafts?: readonly UnsentDraftFilter[] | undefined;
  /**
   * Also a row for a draft whose newest record did not expire, when a used, sending, unknown or approved record of it
   * decides where it stands: what an annotation of one exact draft says (design 2026-10-05 §D9 — an expired revision
   * never hides a used one). A draft with nothing deciding it still has no row, and the seven-day rule still applies.
   */
  readonly decided?: boolean | undefined;
  /** The shared deadline, on the store's clock, in milliseconds: five seconds from the call when left out. */
  readonly deadline?: number | undefined;
  /** How each sender-written field of an approval is wrapped: core's envelope when left out. */
  readonly wrap?: UnsentFieldWrapper | undefined;
}

/** What decides a draft whose newest record did not expire, for `decided`: an approval claimed, or one still standing. */
const DECIDING: ReadonlySet<string> = new Set(['used', 'sending', 'unknown', 'approved']);

/** The report's shared deadline: when it falls, and whether a step may still start. */
export interface UnsentDeadline {
  /** On the approval store's clock, in milliseconds: what `UnsentOptions.deadline` takes. */
  readonly at: number;
  /** Whether the deadline has come, by the same clock: a step starts only while this is false. */
  late(): boolean;
}

/**
 * One deadline for a whole report and whatever a channel does after it — its live look-ups (design 2026-10-05 §D9:
 * maintenance, the scan and the provider reads share one five-second work-start budget) — made once, before the
 * report, on the approval store's own clock, so the report and the channel keep to the same time.
 */
export function unsentDeadline(core: Core, budgetMs: number = UNSENT_BUDGET_MS): UnsentDeadline {
  const internals = storeInternals(core.approvals);
  const at = internals.now().getTime() + budgetMs;
  return { at, late: () => internals.now().getTime() >= at };
}

/** The grouping rule `channel` declares in its manifest, or null. */
export function approvalGroupingOf(channel: string): ApprovalGrouping | null {
  const entry = CHANNEL_SNAPSHOT.find((each) => each.manifest.channel === channel);
  return entry?.manifest.approvalGrouping ?? null;
}

/** What a channel calls one account in a sentence: `mailbox`, `workspace`, `account`. */
function nounOf(channel: string): string {
  return CHANNEL_SNAPSHOT.find((each) => each.manifest.channel === channel)?.manifest.accounts?.noun ?? 'account';
}

const labelOf = (channel: string) => (isChannel(channel) ? channelLabel(channel) : channel);

/** A send record's grouping fields, from whichever form could be attributed. */
interface Attributed {
  readonly channel: string;
  readonly inboxId: string;
  readonly draftId: string;
  readonly draftMessageId: string;
  readonly contentDigest: unknown;
}

/**
 * The group a record belongs to under its channel's rule, or null when it belongs to none: not a send, a channel that
 * declares no rule, or — under `draft-revision-digest` — no draft revision at all (a reaction, whose revision is its own
 * digest).
 */
function keyOf(fields: Attributed): UnsentKey | null {
  const grouping = approvalGroupingOf(fields.channel);
  if (grouping === null) return null;
  if (grouping === 'draft') return { channel: fields.channel, inboxId: fields.inboxId, draftId: fields.draftId };
  if (typeof fields.contentDigest !== 'string' || fields.draftMessageId === fields.contentDigest) return null;
  return {
    channel: fields.channel,
    inboxId: fields.inboxId,
    draftId: fields.draftId,
    draftMessageId: fields.draftMessageId,
    contentDigest: fields.contentDigest,
  };
}

const keyString = (key: UnsentKey) =>
  JSON.stringify([key.channel, key.inboxId, key.draftId, key.draftMessageId ?? null, key.contentDigest ?? null]);

/**
 * Whose a record is, as far as it can be trusted — `attributable: false` for a file whose owner cannot be (unreadable,
 * or a version-2 record whose binding does not verify) — and the group it is in, when it is in one.
 */
function attribution(stored: StoredApproval, text: string): { attributable: boolean; key: UnsentKey | null } {
  switch (stored.form) {
    case 'v2':
      return {
        attributable: true,
        key:
          stored.record.kind === 'send'
            ? keyOf({
                channel: stored.record.channel,
                inboxId: stored.record.inboxId,
                draftId: stored.record.draftId,
                draftMessageId: stored.record.draftMessageId,
                contentDigest: stored.record.contentDigest,
              })
            : null,
      };
    case 'legacy':
      // An earlier release's record, read by its own rules: attributed only where nothing else could have made it.
      return {
        attributable: true,
        key:
          stored.view.kind === 'send' && stored.view.channel !== null
            ? keyOf({
                channel: stored.view.channel,
                inboxId: stored.record.inboxId,
                draftId: stored.record.draftId,
                draftMessageId: stored.record.draftMessageId,
                contentDigest: stored.record.digest,
              })
            : null,
      };
    case 'corrupt': {
      if (stored.safe === null) return { attributable: false, key: null };
      // Its binding verified, so every identity field it holds — its content digest among them — is the one bound.
      let contentDigest: unknown;
      try {
        contentDigest = (JSON.parse(text) as { contentDigest?: unknown }).contentDigest;
      } catch {
        contentDigest = undefined;
      }
      return {
        attributable: true,
        key:
          stored.safe.kind === 'send'
            ? keyOf({
                channel: stored.safe.channel,
                inboxId: stored.safe.inboxId,
                draftId: stored.safe.draftId,
                draftMessageId: stored.safe.draftMessageId,
                contentDigest,
              })
            : null,
      };
    }
    case 'unreadable':
      return { attributable: false, key: null };
  }
}

/** One record read under its lock: as stored, as it reads now, classified. */
interface Read {
  readonly approvalId: string;
  readonly stored: StoredApproval;
  readonly outcome: ApprovalOutcome;
  readonly createdAt: string | null;
  readonly expiresAt: string | null;
}

interface Group {
  readonly key: UnsentKey;
  readonly reads: Read[];
  corrupt: boolean;
  busy: boolean;
}

/** One file's metadata, for the window. */
interface Listed {
  readonly approvalId: string;
  readonly mtimeMs: number;
}

/**
 * The unsent report for `options.channel` (design 2026-10-05 §D9): the day's retention, then one scan of the newest 500
 * approval files under one shared deadline, each opened only under its lock, taken with one non-blocking try.
 */
export async function unsentReport(core: Core, options: UnsentOptions): Promise<UnsentReport> {
  const internals = storeInternals(core.approvals);
  const { io, directory } = internals;
  const deadline = options.deadline ?? internals.now().getTime() + UNSENT_BUDGET_MS;
  const late = () => internals.now().getTime() >= deadline;
  const grouping = approvalGroupingOf(options.channel);
  // One configuration read, for every record's live gate and an earlier release's attribution. Its errors propagate.
  const config: Config | null = await internals.loadConfig();

  // Keys a locked read in this same operation already established: a busy record later is attributable by them.
  const established = new Map<string, { attributable: boolean; key: UnsentKey | null }>();
  const maintenance = await runMaintenance(internals, {
    deadline,
    observe: (approvalId, text) => {
      established.set(approvalId, attribution(decodeStored(approvalId, text, config, internals.now()), text));
    },
  });

  const busy: string[] = [];
  const unreadable: string[] = [];
  // The deadline came before the scan could say anything of any draft: no rows, and nothing claimed.
  const cutShort = (files: number, window: number, opened: number, unread: number): UnsentReport => ({
    channel: options.channel,
    grouping,
    rows: [],
    evidence: 'indeterminate',
    truncated: [...(files > UNSENT_WINDOW ? (['window'] as const) : []), 'deadline'],
    scanned: { files, window, opened, busy, unreadable, unread },
    maintenance,
  });

  // One enumeration, and one stat a file, while time remains.
  if (late()) return cutShort(0, 0, 0, 0);
  let names: string[];
  try {
    names = await io.readdir(directory);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    names = [];
  }
  const ids = names
    .filter((name) => name.endsWith('.json'))
    .map((name) => name.slice(0, -'.json'.length))
    .filter((approvalId) => APPROVAL_ID_PATTERN.test(approvalId));
  const listed: Listed[] = [];
  for (const approvalId of ids) {
    // Without every file's time there is no knowing which 500 are the newest: none of them is read.
    if (late()) return cutShort(ids.length, 0, 0, Math.min(ids.length, UNSENT_WINDOW));
    try {
      listed.push({ approvalId, mtimeMs: (await io.stat(join(directory, `${approvalId}.json`))).mtimeMs });
    } catch (error) {
      // Gone since the listing: deleted by retention, which keeps nothing a report could need.
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
  }
  // Newest first by modification time, the id breaking ties; the window is what the report opens.
  listed.sort((a, b) =>
    a.mtimeMs !== b.mtimeMs
      ? b.mtimeMs - a.mtimeMs
      : a.approvalId < b.approvalId
        ? 1
        : a.approvalId > b.approvalId
          ? -1
          : 0,
  );
  const capped = listed.length > UNSENT_WINDOW;
  const window = listed.slice(0, UNSENT_WINDOW);

  // Each record is grouped as soon as it is read — under its stored channel's rule — so every step, the grouping of a
  // record included, starts only while time remains, and what was read in time is never thrown away.
  const groups = new Map<string, Group>();
  const groupOf = (key: UnsentKey): Group => {
    const name = keyString(key);
    const found = groups.get(name);
    if (found !== undefined) return found;
    const made: Group = { key, reads: [], corrupt: false, busy: false };
    groups.set(name, made);
    return made;
  };
  // Anything whose ownership cannot be known taints the whole scan: it could be any draft's.
  let anyUnreadable = false;
  let anyBusy = false;
  let opened = 0;
  let unread = 0;
  for (let index = 0; index < window.length; index += 1) {
    const { approvalId } = window[index] as Listed;
    if (late()) {
      unread = window.length - index;
      break;
    }
    const jsonPath = join(directory, `${approvalId}.json`);
    let tried: TryLockResult<{ read: Read; text: string } | 'gone' | 'unreadable' | 'deadline'>;
    try {
      tried = await tryFileLock(
        `${jsonPath}.lock`,
        async () => {
          if (late()) return 'deadline';
          let text: string;
          try {
            text = await io.readText(jsonPath);
          } catch (error) {
            return (error as NodeJS.ErrnoException).code === 'ENOENT' ? 'gone' : 'unreadable';
          }
          const now = internals.now();
          const decoded = decodeStored(approvalId, text, config, now);
          // As it reads now — a lapsed approval expired, a dead send unknown — derived, and not written.
          const stored: StoredApproval =
            decoded.form === 'v2' ? { form: 'v2', record: internals.derive(decoded.record) } : decoded;
          const live = config === null || stored.form !== 'v2' ? null : liveGateOf(config, stored.record);
          const outcome = approvalOutcome(stored, { action: 'inspect', live, now });
          const times =
            stored.form === 'v2'
              ? { createdAt: stored.record.createdAt, expiresAt: stored.record.expiresAt }
              : stored.form === 'legacy'
                ? { createdAt: stored.view.createdAt, expiresAt: stored.view.expiresAt }
                : { createdAt: null, expiresAt: null };
          return { read: { approvalId, stored, outcome, ...times }, text };
        },
        { staleMs: internals.timings.recordStaleMs, io: io.lock },
      );
    } catch {
      tried = { acquired: true, value: 'unreadable' };
    }
    if (!tried.acquired) {
      // Busy: never opened. Its draft is known only if a locked read earlier in this operation established it.
      busy.push(approvalId);
      const known = established.get(approvalId);
      if (known === undefined || !known.attributable) anyBusy = true;
      else if (known.key !== null) groupOf(known.key).busy = true;
      continue;
    }
    const value = tried.value;
    if (value === 'deadline') {
      unread = window.length - index;
      break;
    }
    if (value === 'gone') continue;
    if (value === 'unreadable') {
      unreadable.push(approvalId);
      anyUnreadable = true;
      continue;
    }
    opened += 1;
    const { attributable, key } = attribution(value.read.stored, value.text);
    if (!attributable) {
      unreadable.push(approvalId);
      anyUnreadable = true;
    } else if (key !== null) {
      if (value.read.stored.form === 'corrupt') groupOf(key).corrupt = true;
      else groupOf(key).reads.push(value.read);
    }
  }
  const anyUnread = unread > 0;
  const tainted = anyUnreadable
    ? UNSENT_WORDS.unreadable
    : anyBusy
      ? UNSENT_WORDS.busy
      : anyUnread
        ? UNSENT_WORDS.deadline
        : null;
  const scope: EvidenceScope = tainted !== null ? 'indeterminate' : capped ? 'last-500' : 'complete-90-days';

  const now = internals.now().getTime();
  const wrap = options.wrap;
  const asked = options.drafts;
  const candidates: Array<{ row: UnsentRow; newest: Read }> = [];
  for (const group of groups.values()) {
    if (group.key.channel !== options.channel) continue;
    if (options.owner !== undefined && group.key.inboxId !== options.owner) continue;
    // Only the drafts asked for, when some were: by id, and by the exact revision where one is named.
    if (
      asked !== undefined &&
      !asked.some(
        (wanted) =>
          wanted.draftId === group.key.draftId &&
          (wanted.revision === undefined || wanted.revision === group.key.draftMessageId),
      )
    ) {
      continue;
    }
    const ordered = [...group.reads].sort(newestFirst);
    const newest = ordered[0];
    if (newest === undefined) continue;
    // A candidate's newest preparation expired; with `decided`, so may a draft that a claimed or standing approval
    // decides — and nothing else.
    if (
      newest.outcome.state !== 'expired' &&
      !(options.decided === true && ordered.some((read) => DECIDING.has(read.outcome.state)))
    ) {
      continue;
    }
    if (!ordered.some((read) => read.createdAt !== null && Date.parse(read.createdAt) >= now - UNSENT_CANDIDATE_MS)) {
      continue;
    }
    const decided = statusOf(group, ordered, { tainted, capped });
    candidates.push({
      newest,
      row: {
        key: group.key,
        status: decided.status,
        said: decided.said,
        evidence: decided.status === 'indeterminate' ? 'indeterminate' : scope,
        last: {
          approvalId: newest.approvalId,
          createdAt: newest.createdAt as string,
          expiresAt: newest.expiresAt as string,
          ...(newest.outcome.approval.expiredAt === undefined ? {} : { expiredAt: newest.outcome.approval.expiredAt }),
        },
        ...(decided.decidedBy === undefined ? {} : { decidedBy: decided.decidedBy }),
        approvals: ordered.map((read) =>
          publicApproval(
            read.stored,
            read.outcome,
            wrap === undefined
              ? {}
              : {
                  wrap: (text, field) => wrap(text, field, { approvalId: read.approvalId, inboxId: group.key.inboxId }),
                },
          ),
        ),
      },
    });
  }
  candidates.sort((a, b) => newestFirst(a.newest, b.newest));
  const truncated: UnsentTruncation[] = [];
  if (capped) truncated.push('window');
  if (candidates.length > UNSENT_ROWS) truncated.push('rows');
  if (anyUnread) truncated.push('deadline');
  return {
    channel: options.channel,
    grouping,
    rows: candidates.slice(0, UNSENT_ROWS).map((candidate) => candidate.row),
    evidence: scope,
    truncated,
    scanned: { files: listed.length, window: window.length, opened, busy, unreadable, unread },
    maintenance,
  };
}

/** Newest preparation first: by creation, then by id. */
function newestFirst(a: Read, b: Read): number {
  const [x, y] = [a.createdAt ?? '', b.createdAt ?? ''];
  if (x !== y) return x < y ? 1 : -1;
  return a.approvalId < b.approvalId ? 1 : a.approvalId > b.approvalId ? -1 : 0;
}

/**
 * What a candidate draft's records say, in order of what outweighs what: a gap anywhere in the scan; a gap in this
 * group (a corrupt or busy record of it); an approval claimed — used, being sent, or with an unknown outcome; an
 * approval still standing; and only then that it was not sent, in the scope's own words. A decline, a cancellation, a
 * revocation or a failure is never read as an expiry, and never blocks either: nothing was sent with it.
 */
function statusOf(
  group: Group,
  ordered: readonly Read[],
  scan: { tainted: string | null; capped: boolean },
): { status: UnsentStatus; said: string; decidedBy?: string | undefined } {
  if (scan.tainted !== null) return { status: 'indeterminate', said: scan.tainted };
  if (group.corrupt) return { status: 'indeterminate', said: UNSENT_WORDS.corrupt };
  if (group.busy) return { status: 'indeterminate', said: UNSENT_WORDS.busy };
  const label = labelOf(group.key.channel);
  for (const state of ['used', 'sending', 'unknown'] as const) {
    const found = ordered.find((read) => read.outcome.state === state);
    if (found === undefined) continue;
    const approval = found.outcome.approval;
    const legacy = found.stored.form === 'legacy';
    const said =
      state === 'used'
        ? legacy
          ? `used with approval ${found.approvalId}, which an earlier release prepared`
          : `used with approval ${found.approvalId}: accepted by ${label} at ${approval.usedAt}`
        : state === 'sending'
          ? `being sent with approval ${found.approvalId} by another call${legacy ? '' : ` since ${approval.sendingAt}`}`
          : `the outcome of the send with approval ${found.approvalId} is unknown: it may have gone out`;
    return { status: state, said, decidedBy: found.approvalId };
  }
  const approved = ordered.find((read) => read.outcome.state === 'approved');
  if (approved !== undefined) {
    const said =
      approved.stored.form === 'legacy'
        ? 'approved, but only the earlier release that prepared it can use it'
        : approved.outcome.claimable
          ? UNSENT_WORDS.ready
          : approved.outcome.reason === NEVER_NOTICE
            ? `approved, but the ${nounOf(group.key.channel)}'s policy is now never`
            : `approved, but it cannot be used now (${approved.outcome.reason ?? 'not claimable'})`;
    return { status: 'approved', said, decidedBy: approved.approvalId };
  }
  return { status: 'unsent', said: scan.capped ? UNSENT_WORDS.window : UNSENT_WORDS.complete };
}
