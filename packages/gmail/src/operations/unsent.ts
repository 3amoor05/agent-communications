import {
  type Config,
  type EvidenceScope,
  type Handoff,
  type MaintenanceStatus,
  newBoundary,
  type UnsentFieldWrapper,
  type UnsentReport,
  type UnsentRow,
  type UnsentStatus,
  type UnsentTruncation,
  unsentDeadline,
  unsentReport,
} from '@agentcomms/core';
import type { GmailContext } from '../context.ts';
import { readParts } from '../domain/mime.ts';
import { addressField, type FieldEnvelope, filenameField, wrapField } from '../domain/untrusted-fields.ts';
import type { RawMessage } from '../gmail-api/transport.ts';

/**
 * Gmail's unsent section (design 2026-10-05 §D9): core's unsent report for this channel, each row in this package's
 * words — recipients, subject and attachment names through its untrusted-field helpers — with what Gmail's Drafts says
 * of the draft now, observed separately, and the one call that prepares it again.
 *
 * The report and the look-ups share one five-second deadline, set once before the report starts: the report spends
 * what it needs of it on the day's retention and its scan, and a look-up starts only while time remains. A look-up is a
 * provider read (`drafts.get`) — never a send — of at most the 20 drafts returned, two at a time. It is an independent
 * observation, not a repair of the local history: what Drafts says never changes what the approval records said.
 */

/** What Drafts says of a draft, in its exact words. */
export const DRAFTS_WORDS: Readonly<{ found: string; gone: string; failed: string; late: string; removed: string }> =
  Object.freeze({
    found: 'still in Drafts',
    gone: 'no longer in Drafts — it may have been sent or deleted elsewhere',
    failed: 'the look-up in Drafts failed',
    late: 'not observed: the report deadline came before the look-up',
    removed: 'not observed: its mailbox is no longer connected',
  });

/** How many Drafts look-ups run at once, at most. */
export const LOOKUP_CONCURRENCY = 2;

/**
 * What Drafts said when the draft was looked for: `found`, `gone` (Gmail has no such draft), `failed` (the look-up
 * failed, and says why), or `not-observed` (no look-up was started).
 */
export interface DraftsObservation {
  readonly state: 'found' | 'gone' | 'failed' | 'not-observed';
  readonly said: string;
}

/** A draft seen in Drafts: looked up, or read by the call that asks. */
const found: DraftsObservation = Object.freeze({ state: 'found', said: DRAFTS_WORDS.found });

/** The one call that prepares a draft again: the tool, from a chat, or the command, at a terminal. */
export interface PrepareCall {
  readonly tool: 'gmail_send_prepare';
  readonly arguments: { readonly inbox: string; readonly draftId: string };
  readonly command: Handoff;
}

/** One draft of the unsent section. */
export interface UnsentDraft {
  /** The mailbox by its name now; `(removed)` for one no longer connected. */
  readonly inbox: string;
  readonly draftId: string;
  /** Where it stands, by the approval records read (core's `UnsentStatus`). */
  readonly status: UnsentStatus;
  /** The finding, in its exact words — scoped to what was read. */
  readonly said: string;
  readonly evidence: EvidenceScope;
  /** Who the last preparation was to, and its subject: each inside <untrusted-content> unless plainly an address. */
  readonly to: string[];
  readonly cc: string[];
  readonly bcc: string[];
  readonly subject: string;
  /** The names of the files on the draft as Drafts has it now, each inside <untrusted-content>; null when not found. */
  readonly attachments: string[] | null;
  /** The last preparation, and when it expired. */
  readonly last: UnsentRow['last'];
  /** The approval that decided a status other than `unsent` or `indeterminate`. */
  readonly decidedBy?: string | undefined;
  /** What Drafts says of it now: an observation of its own, beside the history. */
  readonly drafts: DraftsObservation;
  /**
   * The one call that prepares it again, for a draft found unsent that Drafts did not say is gone; null for every
   * other — one an approval decided, one whose history is indeterminate, one gone from Drafts, one whose mailbox is
   * gone.
   */
  readonly prepare: PrepareCall | null;
}

/** The section as `send list` and `gmail_send_list` give it. */
export interface UnsentSection {
  /** At most 20, newest preparation first. */
  readonly rows: UnsentDraft[];
  /** What the scan as a whole can support. */
  readonly evidence: EvidenceScope;
  /**
   * Why it is not the whole picture: more files than the window (`window`), more drafts than the rows (`rows`), or
   * the deadline stopping the scan or a look-up (`deadline`).
   */
  readonly truncated: UnsentTruncation[];
  /** What the scan read: counts, and the ids of the records that were busy or could not be read — never contents. */
  readonly scanned: UnsentReport['scanned'];
  /** The day's retention, run first on the same deadline. */
  readonly maintenance: MaintenanceStatus;
}

export interface UnsentSectionOptions {
  /** Only this mailbox's drafts, by its id. */
  readonly inboxId?: string | undefined;
  /**
   * Drafts already read from Gmail, by id — a draft list, a draft shown — and only those: each is `found` as read, and
   * nothing is looked up again. Left out, every returned draft is looked up.
   */
  readonly observed?: ReadonlyMap<string, RawMessage | undefined> | undefined;
}

/**
 * The unsent section for one mailbox or every one (design 2026-10-05 §D9). Creates, sends and deletes nothing: the
 * report reads approval records, and each look-up is a read of Drafts.
 */
export async function unsentSection(context: GmailContext, options: UnsentSectionOptions = {}): Promise<UnsentSection> {
  // One deadline, made once on the approval store's clock, for the report and every look-up after it.
  const deadline = unsentDeadline(context.core);
  const config = await context.config();
  const aliases = new Map(Object.entries(config.inboxes).map(([alias, inbox]) => [inbox.id, alias]));
  const boundary = newBoundary();
  // Gmail's own helpers, each envelope naming the mailbox and the approval the field came from.
  const wrap: UnsentFieldWrapper = (text, field, owner) => {
    const envelope: FieldEnvelope = {
      boundary,
      inbox: aliases.get(owner.inboxId) ?? owner.inboxId,
      id: owner.approvalId,
    };
    return field === 'subject'
      ? wrapField(text, 'subject', envelope)
      : field === 'filename'
        ? filenameField(text, envelope)
        : addressField(text, field, envelope);
  };
  const observed = options.observed;
  const report = await unsentReport(context.core, {
    channel: 'gmail',
    ...(options.inboxId === undefined ? {} : { owner: options.inboxId }),
    ...(observed === undefined ? {} : { drafts: [...observed.keys()].map((draftId) => ({ draftId })) }),
    deadline: deadline.at,
    wrap,
  });

  // What Drafts says of each: as already read, or looked up now — two at a time, each started only before the deadline.
  const sightings: Array<{ observation: DraftsObservation; message: RawMessage | undefined }> = report.rows.map(() => ({
    observation: { state: 'not-observed', said: DRAFTS_WORDS.late },
    message: undefined,
  }));
  if (observed !== undefined) {
    report.rows.forEach((row, index) => {
      sightings[index] = { observation: found, message: observed.get(row.key.draftId) };
    });
  } else {
    let next = 0;
    const worker = async (): Promise<void> => {
      while (next < report.rows.length) {
        const index = next;
        next += 1;
        if (deadline.late()) continue;
        sightings[index] = await lookUp(context, config, report.rows[index] as UnsentRow);
      }
    };
    await Promise.all(Array.from({ length: LOOKUP_CONCURRENCY }, worker));
  }

  const rows = report.rows.map((row, index) =>
    draftRow(context, row, sightings[index] as (typeof sightings)[number], { aliases, boundary }),
  );
  const unobserved = sightings.some((sighting) => sighting.observation.said === DRAFTS_WORDS.late);
  return {
    rows,
    evidence: report.evidence,
    truncated:
      unobserved && !report.truncated.includes('deadline') ? [...report.truncated, 'deadline'] : [...report.truncated],
    scanned: report.scanned,
    maintenance: report.maintenance,
  };
}

/** One draft looked for in Drafts: found, gone, or the look-up's failure — never guessed. */
async function lookUp(
  context: GmailContext,
  config: Config,
  row: UnsentRow,
): Promise<{ observation: DraftsObservation; message: RawMessage | undefined }> {
  const alias = Object.entries(config.inboxes).find(([, inbox]) => inbox.id === row.key.inboxId)?.[0];
  if (alias === undefined) {
    return { observation: { state: 'not-observed', said: DRAFTS_WORDS.removed }, message: undefined };
  }
  try {
    const transport = await context.transport(alias);
    const draft = await transport.getDraft(row.key.draftId);
    // A draft with no message is no draft: preparing it would be refused as not there.
    if (!draft.message?.id) return { observation: { state: 'gone', said: DRAFTS_WORDS.gone }, message: undefined };
    return { observation: found, message: draft.message };
  } catch (error) {
    if ((error as { code?: unknown }).code === 'NOT_FOUND') {
      return { observation: { state: 'gone', said: DRAFTS_WORDS.gone }, message: undefined };
    }
    const message = error instanceof Error ? error.message : String(error);
    return { observation: { state: 'failed', said: `${DRAFTS_WORDS.failed}: ${message}` }, message: undefined };
  }
}

/** A row of core's report in this package's words. */
function draftRow(
  context: GmailContext,
  row: UnsentRow,
  sighting: { observation: DraftsObservation; message: RawMessage | undefined },
  shared: { aliases: ReadonlyMap<string, string>; boundary: string },
): UnsentDraft {
  const alias = shared.aliases.get(row.key.inboxId);
  // The last preparation's recipients and subject, as core enveloped them with this package's helpers.
  const expect = row.approvals[0]?.expect ?? { to: [], cc: [], bcc: [], subject: '' };
  const message = sighting.observation.state === 'found' ? sighting.message : undefined;
  const envelope: FieldEnvelope = {
    boundary: shared.boundary,
    inbox: alias ?? row.key.inboxId,
    id: message?.id ?? undefined,
  };
  const attachments =
    sighting.observation.state === 'found'
      ? readParts(message?.payload).attachments.map((part) => filenameField(part.filename, envelope))
      : null;
  const prepare: PrepareCall | null =
    alias !== undefined && row.status === 'unsent' && sighting.observation.state !== 'gone'
      ? {
          tool: 'gmail_send_prepare',
          arguments: { inbox: alias, draftId: row.key.draftId },
          command: context.handoffs.own(['send', 'prepare', row.key.draftId, '--inbox', alias]),
        }
      : null;
  return {
    inbox: alias ?? '(removed)',
    draftId: row.key.draftId,
    status: row.status,
    said: row.said,
    evidence: row.evidence,
    to: [...expect.to],
    cc: [...expect.cc],
    bcc: [...expect.bcc],
    subject: expect.subject,
    attachments,
    last: row.last,
    ...(row.decidedBy === undefined ? {} : { decidedBy: row.decidedBy }),
    drafts: sighting.observation,
    prepare,
  };
}
