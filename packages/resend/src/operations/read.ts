import { createHash } from 'node:crypto';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import {
  CommsError,
  createUniqueFile,
  domainOf,
  ensurePrivateDir,
  expandHome,
  homeDirectory,
  newBoundary,
  relativeSubpath,
  resolveInsideRoot,
  safeFilename,
  slug,
  stripInvisible,
  TaintCollector,
  UNTRUSTED_NOTICE,
  wholeNumber,
} from '@agentcomms/core';
import { keyPermissionOf, type NamedAccount } from '../accounts.ts';
import { type ResendTransport, resendDownload, resendRequest } from '../api/client.ts';
import { addressesOf, attachmentRisks, type Envelope, personOf, readBody, wrapField } from '../compose/inbound.ts';
import { SendRecords } from '../compose/store.ts';
import type { ResendContext } from '../context.ts';

/**
 * Everything that reads: domains, sent mail, received mail, metrics, suppressions, scheduled mail.
 *
 * **A sending-only key's reads are reported as unavailable, not as errors.** Resend refuses every non-send call with
 * such a key (`401 restricted_api_key`), so asking would only spend the team's shared rate limit on a refusal. An
 * account known to hold one is answered without a request: `available: false`, and why. A full-access key that is
 * refused the same way — replaced in the dashboard, say — is reported the same way.
 *
 * Received mail is untrusted content: every sender-controlled string is wrapped, hidden text is removed and counted,
 * addresses are recorded in core's taint store before the result is returned (a read whose taint cannot be recorded
 * fails), and attachments are listed, not fetched, unless asked for.
 */

export interface Unavailable {
  account: string;
  available: false;
  reason: string;
}

export type Readable<T> = ({ account: string; available: true } & T) | Unavailable;

const SENDING_ONLY =
  'this account’s key can only send email: Resend refuses every read with it, so nothing was asked. Reading needs a full-access key under another account name.';

/** Runs a read for an account that can read, or says plainly that it cannot. */
async function whenReadable<T extends object>(
  context: ResendContext,
  name: string,
  read: (named: NamedAccount, transport: ResendTransport) => Promise<T>,
): Promise<Readable<T>> {
  const named = await context.accounts.require(name);
  if (keyPermissionOf(named.account) === 'sending_access')
    return { account: name, available: false, reason: SENDING_ONLY };
  const transport = await context.transport(named);
  try {
    return { account: name, available: true, ...(await read(named, transport)) };
  } catch (error) {
    if (
      error instanceof CommsError &&
      error.details?.resendError === 'restricted_api_key' &&
      error.code === 'SCOPE_MISSING'
    ) {
      return { account: name, available: false, reason: SENDING_ONLY };
    }
    throw error;
  }
}

const LIMIT = { name: 'limit', min: 1, max: 100 } as const;
const RESEND_ID = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

/** A Resend id, checked before it is put in a path. */
export function resendId(raw: unknown, what = 'id'): string {
  const value = typeof raw === 'string' ? raw.trim() : '';
  if (!RESEND_ID.test(value)) throw new CommsError('USAGE', `"${String(raw)}" is not a Resend ${what}`);
  return value.toLowerCase();
}

function cursorOf(raw: unknown): string | undefined {
  if (raw === undefined || raw === '') return undefined;
  return resendId(raw, 'cursor (an id from an earlier page)');
}

const text = (value: unknown): string | null => (typeof value === 'string' ? value : null);
const strings = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
/** A header-like value a sender controls but that is not prose: stripped of invisible characters, bounded. */
const plain = (value: unknown, max = 200): string | null =>
  typeof value === 'string' ? stripInvisible(value).text.slice(0, max) : null;

interface Page<T> {
  data?: T[];
  has_more?: boolean;
}

// ── Domains ──────────────────────────────────────────────────────────────────────────────────────────────────────

export interface DomainRow {
  id: string;
  name: string;
  status: string;
  region: string | null;
  sending: string | null;
  receiving: string | null;
  createdAt: string | null;
}

export interface DomainRecord {
  record: string | null;
  name: string | null;
  type: string | null;
  value: string | null;
  status: string | null;
  ttl: string | null;
  priority: number | null;
}

function domainRow(entry: Record<string, unknown>): DomainRow {
  const capabilities = (entry.capabilities ?? {}) as Record<string, unknown>;
  return {
    id: String(entry.id ?? ''),
    name: String(entry.name ?? ''),
    status: String(entry.status ?? 'unknown'),
    region: text(entry.region),
    sending: text(capabilities.sending),
    receiving: text(capabilities.receiving),
    createdAt: text(entry.created_at),
  };
}

/** The team's domains; with `domain`, that one with the DNS records it needs. */
export async function listDomains(
  context: ResendContext,
  name: string,
  options: { domain?: string | undefined } = {},
): Promise<Readable<{ domains: DomainRow[]; records?: DomainRecord[] | undefined }>> {
  return whenReadable(context, name, async (_named, transport) => {
    const page = await resendRequest<Page<Record<string, unknown>>>(transport, 'GET', '/domains');
    const domains = (page.data ?? []).map(domainRow);
    if (options.domain === undefined) return { domains };
    const wanted = options.domain.trim().toLowerCase();
    const found = domains.find((domain) => domain.name.toLowerCase() === wanted || domain.id === wanted);
    if (!found) {
      throw new CommsError('NOT_FOUND', `"${options.domain}" is not one of this team’s domains`, {
        hint: 'List them with `agent-resend domains --account <org/resend>`.',
      });
    }
    const detail = await resendRequest<Record<string, unknown>>(
      transport,
      'GET',
      `/domains/${resendId(found.id, 'domain id')}`,
    );
    const records = (Array.isArray(detail.records) ? (detail.records as Record<string, unknown>[]) : []).map(
      (record) => ({
        record: text(record.record),
        name: text(record.name),
        type: text(record.type),
        value: text(record.value),
        status: text(record.status),
        ttl: record.ttl === undefined ? null : String(record.ttl),
        priority: typeof record.priority === 'number' ? record.priority : null,
      }),
    );
    return { domains: [domainRow(detail)], records };
  });
}

// ── Sent emails ──────────────────────────────────────────────────────────────────────────────────────────────────

export interface SentRow {
  id: string;
  from: string | null;
  to: string[];
  cc: string[];
  bcc: string[];
  /** Wrapped: what the team sent can carry text somebody else wrote. */
  subject: string;
  createdAt: string | null;
  lastEvent: string | null;
  scheduledAt: string | null;
  messageId: string | null;
}

function sentRow(entry: Record<string, unknown>, envelope: Omit<Envelope, 'id'>): SentRow {
  const id = String(entry.id ?? '');
  return {
    id,
    from: plain(entry.from),
    to: strings(entry.to),
    cc: strings(entry.cc),
    bcc: strings(entry.bcc),
    subject: wrapField(String(entry.subject ?? ''), 'subject', {
      ...envelope,
      id: RESEND_ID.test(id) ? id : 'unknown',
    }),
    createdAt: text(entry.created_at),
    lastEvent: text(entry.last_event),
    scheduledAt: text(entry.scheduled_at),
    messageId: plain(entry.message_id),
  };
}

export interface Paging {
  limit?: unknown;
  after?: unknown;
}

function pageQuery(paging: Paging, fallback: number): { limit: number; after?: string | undefined } {
  return { limit: wholeNumber(paging.limit, LIMIT) ?? fallback, after: cursorOf(paging.after) };
}

export async function listSentEmails(
  context: ResendContext,
  name: string,
  paging: Paging = {},
): Promise<Readable<{ emails: SentRow[]; hasMore: boolean; next: string | null; notice: string }>> {
  const query = pageQuery(paging, 20);
  return whenReadable(context, name, async (_named, transport) => {
    const page = await resendRequest<Page<Record<string, unknown>>>(transport, 'GET', '/emails', { query });
    const envelope = { boundary: newBoundary(), account: name };
    const emails = (page.data ?? []).map((entry) => sentRow(entry, envelope));
    const hasMore = page.has_more === true;
    return { emails, hasMore, next: hasMore ? (emails.at(-1)?.id ?? null) : null, notice: UNTRUSTED_NOTICE };
  });
}

export async function showSentEmail(
  context: ResendContext,
  name: string,
  id: unknown,
): Promise<Readable<{ email: SentRow & Record<string, unknown>; notice: string }>> {
  const emailId = resendId(id, 'email id');
  return whenReadable(context, name, async (_named, transport) => {
    const entry = await resendRequest<Record<string, unknown>>(transport, 'GET', `/emails/${emailId}`);
    const envelope = { boundary: newBoundary(), account: name, id: emailId };
    const body = readBody(text(entry.html), text(entry.text), envelope);
    const tags = (Array.isArray(entry.tags) ? (entry.tags as Record<string, unknown>[]) : []).map((tag) => ({
      name: plain(tag.name, 256),
      value: plain(tag.value, 256),
    }));
    return {
      email: {
        ...sentRow(entry, envelope),
        replyTo: strings(entry.reply_to),
        tags,
        ...body,
      },
      notice: UNTRUSTED_NOTICE,
    };
  });
}

// ── Received emails ──────────────────────────────────────────────────────────────────────────────────────────────

export interface ReceivedAttachment {
  id: string;
  /** Wrapped: the sender named it. */
  filename: string;
  contentType: string | null;
  size: number | null;
  inline: boolean;
  riskFlags: string[];
}

function attachmentsOf(value: unknown, envelope: Envelope): ReceivedAttachment[] {
  return (Array.isArray(value) ? (value as Record<string, unknown>[]) : []).map((entry) => {
    const filename = String(entry.filename ?? '');
    return {
      id: String(entry.id ?? ''),
      filename: wrapField(filename, 'filename', envelope),
      contentType: plain(entry.content_type, 100),
      size: typeof entry.size === 'number' ? entry.size : null,
      inline: entry.content_disposition === 'inline',
      riskFlags: attachmentRisks(filename),
    };
  });
}

/**
 * Records every address the emails name, before their content is returned. Fails the read if it cannot: content whose
 * taint was not recorded is content a later send could be steered by without the escalation that exists to catch it.
 */
async function recordTaint(
  context: ResendContext,
  collector: TaintCollector,
  entries: readonly Record<string, unknown>[],
): Promise<void> {
  const own: string[] = [];
  for (const entry of entries) {
    own.push(...[...addressesOf(entry.to), ...addressesOf(entry.received_for)].map((person) => person.address));
    collector.observeHeaders(
      [...addressesOf(entry.from), ...addressesOf(entry.reply_to), ...addressesOf(entry.cc)].map(
        (person) => person.address,
      ),
    );
  }
  const internal = [
    ...new Set(own.map((address) => domainOf(address)).filter((domain): domain is string => domain !== null)),
  ];
  await collector.flush(context.core.taint, { ownAddresses: own, internalDomains: internal });
}

export interface ReceivedRow {
  id: string;
  receivedAt: string | null;
  from: { address: string; name: string | null } | null;
  to: string[];
  subject: string;
  messageId: string | null;
  attachments: number;
}

export async function listReceived(
  context: ResendContext,
  name: string,
  paging: Paging = {},
): Promise<Readable<{ emails: ReceivedRow[]; hasMore: boolean; next: string | null; notice: string }>> {
  const query = pageQuery(paging, 20);
  return whenReadable(context, name, async (named, transport) => {
    const page = await resendRequest<Page<Record<string, unknown>>>(transport, 'GET', '/emails/receiving', { query });
    const boundary = newBoundary();
    const collector = new TaintCollector(named.account.id);
    const emails: ReceivedRow[] = [];
    for (const entry of page.data ?? []) {
      const id = String(entry.id ?? '');
      const envelope: Envelope = { boundary, account: name, id: RESEND_ID.test(id) ? id : 'unknown', collector };
      const sender = addressesOf(entry.from)[0];
      emails.push({
        id,
        receivedAt: text(entry.created_at),
        from: sender ? personOf(sender, 'from-name', envelope) : null,
        to: addressesOf(entry.to).map((person) => person.address),
        subject: wrapField(String(entry.subject ?? ''), 'subject', envelope),
        messageId: plain(entry.message_id),
        attachments: Array.isArray(entry.attachments) ? entry.attachments.length : 0,
      });
    }
    await recordTaint(context, collector, page.data ?? []);
    const hasMore = page.has_more === true;
    return { emails, hasMore, next: hasMore ? (emails.at(-1)?.id ?? null) : null, notice: UNTRUSTED_NOTICE };
  });
}

export interface Authentication {
  spf: string | null;
  dkim: string | null;
  dmarc: string | null;
  /** Always Resend's receiving server: a sender cannot forge it, unlike a header in the message. */
  evaluatedBy: 'resend' | null;
}

export async function showReceived(
  context: ResendContext,
  name: string,
  id: unknown,
): Promise<Readable<{ email: Record<string, unknown>; notice: string }>> {
  const emailId = resendId(id, 'email id');
  return whenReadable(context, name, async (named, transport) => {
    const entry = await resendRequest<Record<string, unknown>>(transport, 'GET', `/emails/receiving/${emailId}`);
    const collector = new TaintCollector(named.account.id, emailId);
    const envelope: Envelope = { boundary: newBoundary(), account: name, id: emailId, collector };
    const auth = (entry.authentication ?? null) as Record<string, unknown> | null;
    const authentication: Authentication = auth
      ? { spf: text(auth.spf), dkim: text(auth.dkim), dmarc: text(auth.dmarc), evaluatedBy: 'resend' }
      : { spf: null, dkim: null, dmarc: null, evaluatedBy: null };
    const body = readBody(text(entry.html), text(entry.text), envelope);
    const warnings = [...body.warnings];
    for (const check of ['spf', 'dkim', 'dmarc'] as const) {
      const verdict = authentication[check];
      if (verdict !== null && verdict !== 'pass') warnings.push(`${check.toUpperCase()}: ${verdict}`);
    }
    if (authentication.evaluatedBy === null)
      warnings.push('no SPF/DKIM/DMARC result: received before Resend recorded one');
    const sender = addressesOf(entry.from)[0];
    const replyTo = addressesOf(entry.reply_to);
    if (sender && replyTo.some((person) => domainOf(person.address) !== domainOf(sender.address))) {
      warnings.push('replies go to a different domain from the sender’s');
    }
    const email = {
      id: emailId,
      receivedAt: text(entry.created_at),
      from: sender ? personOf(sender, 'from-name', envelope) : null,
      replyTo: replyTo.map((person) => personOf(person, 'reply-to-name', envelope)),
      to: addressesOf(entry.to).map((person) => person.address),
      cc: addressesOf(entry.cc).map((person) => person.address),
      receivedFor: strings(entry.received_for),
      messageId: plain(entry.message_id),
      subject: wrapField(String(entry.subject ?? ''), 'subject', envelope),
      authentication,
      ...body,
      warnings,
      attachments: attachmentsOf(entry.attachments, envelope),
    };
    // The raw message's signed link is never passed on: it is a credential for the whole message, attachments and all.
    await recordTaint(context, collector, [entry]);
    return { email, notice: UNTRUSTED_NOTICE };
  });
}

export interface DownloadedFile {
  attachmentId: string;
  path: string;
  size: number;
  sha256: string;
  contentType: string | null;
  riskFlags: string[];
}

export const MAX_DOWNLOAD_BYTES: number = 40 * 1024 * 1024;

/** The downloads root: `~/Downloads/agent-communications` unless core's config says otherwise. */
export async function downloadsRoot(context: ResendContext): Promise<string> {
  const configured = (await context.config()).defaults.downloadsDir;
  const root = configured ? expandHome(configured, homeDirectory(context.env)) : context.core.paths.downloadsDir;
  await ensurePrivateDir(root);
  return root;
}

/**
 * Saves a received email's attachments — one, or all of them — inside core's downloads jail:
 * `<downloads>/<org>/resend/<date>_<sender>_<email>/<safe name>`. Nothing is opened or run.
 */
export async function downloadReceived(
  context: ResendContext,
  name: string,
  id: unknown,
  options: { attachmentId?: unknown; out?: string | undefined } = {},
): Promise<Readable<{ emailId: string; files: DownloadedFile[] }>> {
  const emailId = resendId(id, 'email id');
  const only = options.attachmentId === undefined ? undefined : resendId(options.attachmentId, 'attachment id');
  const subpath = relativeSubpath(options.out);
  return whenReadable(context, name, async (named, transport) => {
    const entry = await resendRequest<Record<string, unknown>>(transport, 'GET', `/emails/receiving/${emailId}`);
    const listed = (Array.isArray(entry.attachments) ? (entry.attachments as Record<string, unknown>[]) : []).filter(
      (attachment) => only === undefined || String(attachment.id ?? '').toLowerCase() === only,
    );
    if (listed.length === 0) {
      throw new CommsError('NOT_FOUND', only ? `the email has no attachment ${only}` : 'the email has no attachments');
    }
    const root = await downloadsRoot(context);
    const date = (text(entry.created_at) ?? '').slice(0, 10) || 'undated';
    const sender = slug(addressesOf(entry.from)[0]?.address ?? 'unknown', 30, 'unknown');
    const folder = await resolveInsideRoot(root, join(name, subpath, `${date}_${sender}_${emailId.slice(0, 8)}`));
    await mkdir(folder, { recursive: true, mode: 0o700 });
    const files: DownloadedFile[] = [];
    for (const attachment of listed) {
      const attachmentId = resendId(attachment.id, 'attachment id');
      const meta = await resendRequest<Record<string, unknown>>(
        transport,
        'GET',
        `/emails/receiving/${emailId}/attachments/${attachmentId}`,
      );
      const link = text(meta.download_url);
      if (link === null) throw new CommsError('PROVIDER_UNAVAILABLE', 'Resend returned no download link');
      const bytes = await resendDownload(transport, link, MAX_DOWNLOAD_BYTES);
      const filename = String(attachment.filename ?? meta.filename ?? 'attachment');
      const { path, handle } = await createUniqueFile(folder, safeFilename(filename));
      try {
        await handle.writeFile(bytes);
      } finally {
        await handle.close();
      }
      files.push({
        attachmentId,
        path,
        size: bytes.byteLength,
        sha256: createHash('sha256').update(bytes).digest('hex'),
        contentType: plain(attachment.content_type, 100),
        riskFlags: attachmentRisks(filename),
      });
    }
    await context.core.audit.append({
      inboxId: named.account.id,
      alias: name,
      operation: 'resend.received.download',
      outcome: 'ok',
      surface: context.surface,
      ids: { emailIds: [emailId], attachmentIds: files.map((file) => file.attachmentId) },
    });
    return { emailId, files };
  });
}

// ── Metrics and suppressions ─────────────────────────────────────────────────────────────────────────────────────

const DATE = /^\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,9})?)?(?:Z|[+-]\d{2}:\d{2}))?$/;

function dateOf(raw: unknown, name: string): string | undefined {
  if (raw === undefined || raw === '') return undefined;
  if (typeof raw !== 'string' || !DATE.test(raw.trim())) {
    throw new CommsError('USAGE', `${name} must be a date like 2026-09-01, or an ISO 8601 time with a zone`);
  }
  return raw.trim();
}

export async function getMetrics(
  context: ResendContext,
  name: string,
  range: { start?: unknown; end?: unknown } = {},
): Promise<Readable<{ start: string | null; end: string | null; totals: Record<string, number>; note: string }>> {
  const start = dateOf(range.start, 'start');
  const end = dateOf(range.end, 'end');
  return whenReadable(context, name, async (_named, transport) => {
    const result = await resendRequest<Record<string, unknown>>(transport, 'GET', '/emails/metrics', {
      query: { start_date: start, end_date: end },
    });
    const totals: Record<string, number> = {};
    for (const [key, value] of Object.entries((result.totals ?? {}) as Record<string, unknown>)) {
      if (typeof value === 'number' && /^[a-z_]{1,40}$/.test(key)) totals[key] = value;
    }
    return {
      start: text(result.start_date),
      end: text(result.end_date),
      totals,
      note: 'Resend caches these for up to 15 minutes, and keeps 30 days of data on most plans.',
    };
  });
}

export interface SuppressionRow {
  id: string;
  email: string;
  origin: string | null;
  sourceId: string | null;
  createdAt: string | null;
}

const ORIGINS = ['bounce', 'complaint', 'manual'];

export async function listSuppressions(
  context: ResendContext,
  name: string,
  options: Paging & { origin?: unknown } = {},
): Promise<Readable<{ suppressions: SuppressionRow[]; hasMore: boolean; next: string | null }>> {
  const query = pageQuery(options, 20);
  if (options.origin !== undefined && !ORIGINS.includes(String(options.origin))) {
    throw new CommsError('USAGE', `"${String(options.origin)}" is not an origin: use bounce, complaint or manual`);
  }
  return whenReadable(context, name, async (_named, transport) => {
    const page = await resendRequest<Page<Record<string, unknown>>>(transport, 'GET', '/suppressions', {
      query: { ...query, ...(options.origin === undefined ? {} : { origin: String(options.origin) }) },
    });
    const suppressions = (page.data ?? []).map((entry) => ({
      id: String(entry.id ?? ''),
      email: plain(entry.email, 320) ?? '',
      origin: text(entry.origin),
      sourceId: text(entry.source_id),
      createdAt: text(entry.created_at),
    }));
    const hasMore = page.has_more === true;
    return { suppressions, hasMore, next: hasMore ? (suppressions.at(-1)?.id ?? null) : null };
  });
}

// ── Scheduled emails ─────────────────────────────────────────────────────────────────────────────────────────────

const SCHEDULED_PAGES = 3;

export async function listScheduled(
  context: ResendContext,
  name: string,
): Promise<Readable<{ scheduled: (SentRow & { fromThisMachine: boolean })[]; complete: boolean; scanned: number }>> {
  return whenReadable(context, name, async (named, transport) => {
    const records = new SendRecords(context.core.paths.stateDir, context.now);
    const envelope = { boundary: newBoundary(), account: name };
    const scheduled: (SentRow & { fromThisMachine: boolean })[] = [];
    let after: string | undefined;
    let scanned = 0;
    let complete = true;
    for (let page = 0; page < SCHEDULED_PAGES; page += 1) {
      const result = await resendRequest<Page<Record<string, unknown>>>(transport, 'GET', '/emails', {
        query: { limit: 100, after },
      });
      const rows = (result.data ?? []).map((entry) => sentRow(entry, envelope));
      scanned += rows.length;
      for (const row of rows) {
        if (row.lastEvent !== 'scheduled') continue;
        scheduled.push({ ...row, fromThisMachine: (await records.byResendId(named.account.id, row.id)) !== null });
      }
      if (result.has_more !== true || rows.length === 0) break;
      after = rows.at(-1)?.id;
      if (page === SCHEDULED_PAGES - 1) complete = false;
    }
    return { scheduled, complete, scanned };
  });
}
