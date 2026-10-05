import { readFile } from 'node:fs/promises';
import {
  type ApprovalRecord,
  type CliHandoffs,
  CommsError,
  canonicalAddress,
  type Expectation,
  ensureSendEpochConfig,
  handoffSentence,
  handoffSentenceToFill,
  integrityRefusal,
  kindOf,
  type LegacyDrainReport,
  type MessagePreview,
  otherVersionRefusal,
  ownerOf,
  type PublicApproval,
  publicStored,
  renderMessagePreview,
  type SendPolicy,
  type StoredApproval,
  sendEpochOf,
  sha256Hex,
  stateOf,
  stricterPolicy,
} from '@agentcomms/core';
import { keyPermissionOf, type NamedAccount } from '../accounts.ts';
import { resendRequest, type WriteOutcome } from '../api/client.ts';
import { APPROVAL_TAG, closedPermit, type FetchLike, spendOn } from '../api/guard.ts';
import {
  type BuiltMessage,
  buildMessage,
  digestOf,
  newPreparedId,
  type OutboundMessage,
  REACH_CONFIRM_THRESHOLD,
  type SendInput,
  uniqueRecipients,
} from '../compose/message.ts';
import { type PreparedMessage, PreparedStore, SendRecords, type SendSummary } from '../compose/store.ts';
import type { ResendContext } from '../context.ts';

/**
 * The send gate: prepare → preview → approval → execute, once.
 *
 * The Gmail gate's shape, for an API that has no drafts. **`executeSend` is the only function in this package that
 * sends mail**: it alone opens the `emails.send` permit, and a test fails if anything else names that route or calls
 * the request builder. Everything before it exists to make one promise true — nothing leaves that a person has not
 * seen in the form it will arrive in:
 *
 * 1. **Prepare** builds the message (`compose/message.ts`), refuses a From on a domain that is not verified for sending
 *    before any approval exists, stores the message, and records an approval bound to its digest. The preview lists
 *    every recipient, BCC included, and the reach — unique recipients. Above `REACH_CONFIRM_THRESHOLD`, or to an
 *    address that arrived in mail read in the last seven days and never written to from here, the send needs a
 *    person at a terminal whatever the policy says.
 * 2. **Approval** is the account's send policy: under `chat` the person's yes in the conversation; under `confirm`
 *    this CLI's `approve <id>` and a typed code; under `never` nothing.
 * 3. **Execute** re-reads the stored message and its attachments, claims the approval once (a lock and an O_EXCL
 *    marker), reserves a slot under the rate caps, records the attempt **before** the request leaves, and sends with
 *    `Idempotency-Key` = the approval id and the tag `agentcomms_approval=<id>`. It never retries. An outcome it cannot
 *    know — a dropped connection, a 5xx, a timeout — is recorded as unknown and reported with how to check
 *    (`send status`), never sent again.
 */

export interface SendPreparation {
  approvalId: string;
  account: string;
  /** Show it verbatim; do not summarise it. */
  preview: string;
  policy: SendPolicy;
  effectivePolicy: SendPolicy;
  riskFlags: string[];
  /** Unique recipients, BCC included. */
  reach: number;
  expect: Expectation;
  expiresAt: string;
  nextStep: string;
  /**
   * What became of the approvals an earlier release prepared, by id, when this call was one that retired them
   * (`ensureSendEpochConfig`). Absent otherwise.
   */
  legacyDrain?: LegacyDrainReport | undefined;
}

export interface SendResult {
  account: string;
  approvalId: string;
  /** Resend's id for the email. */
  resendId: string;
  state: 'sent' | 'scheduled';
  scheduledAt: string | null;
  to: string[];
  cc: string[];
  bcc: string[];
  subject: string;
  /** Bookkeeping that could not be written after Resend confirmed the send. */
  note?: string | undefined;
  /**
   * What became of the approvals an earlier release prepared, by id, when this call was one that retired them
   * (`ensureSendEpochConfig`). Absent otherwise.
   */
  legacyDrain?: LegacyDrainReport | undefined;
}

/**
 * A send's approval as the one account that may use it, or a refusal that does not touch it.
 *
 * Whose it is comes from a record that can be trusted to say (`ownerOf`): any other — an unreadable file, a corrupt
 * record whose binding does not verify — is not this account's, and is not found, as an id nobody prepared is not.
 * Then only a valid version-2 send is used: this account's corrupt record is refused as that, and one an earlier
 * release prepared by its version.
 */
async function ownRecord(context: ResendContext, named: NamedAccount, approvalId: string): Promise<ApprovalRecord> {
  const stored = await context.core.approvals.get(approvalId);
  if (stored === null || ownerOf(stored) !== named.account.id || kindOf(stored) !== 'send') {
    throw new CommsError('NOT_FOUND', `there is no send approval ${approvalId} for "${named.name}"`, {
      hint: 'Approvals last ten minutes. Prepare the send again.',
    });
  }
  if (stored.form === 'legacy') throw otherVersionRefusal(stored.view);
  if (stored.form !== 'v2') throw integrityRefusal(stored);
  return stored.record;
}

function requireSendMode(named: NamedAccount, handoffs: CliHandoffs): void {
  if (named.account.mode !== 'send') {
    throw new CommsError('SCOPE_MISSING', `"${named.name}" is in read mode, so it sends nothing`, {
      hint: handoffSentence(
        handoffs.own(['account', 'policy', named.name, '--mode', 'send']),
        (command) => `A person can allow sending with ${command}, which is a change they approve.`,
      ),
    });
  }
}

/** Resend's own `approve` for this send, located: what a person runs at their own terminal under `confirm`. */
function approveCommand(handoffs: CliHandoffs, approvalId: string) {
  return handoffs.own(['approve', approvalId]);
}

/** Resend's own `send status` for this send, located: how a send whose outcome is not known is checked. */
function statusCommand(handoffs: CliHandoffs, approvalId: string, name: string) {
  return handoffs.own(['send', 'status', approvalId, '--account', name]);
}

/**
 * Whether the From domain may send, checked before an approval exists.
 *
 * With a full-access key: the domain must be in the team's list, `verified`, and able to send. A sending-only key
 * cannot read the list; its declared domain, when there is one, must be the From domain, and the preview says the
 * verification could not be checked here — Resend refuses an unverified domain itself.
 */
async function checkFromDomain(context: ResendContext, named: NamedAccount, domain: string): Promise<string> {
  if (keyPermissionOf(named.account) === 'sending_access') {
    if (named.account.domainLock && named.account.domainLock !== domain) {
      throw new CommsError('BAD_DATA', `this key was declared to send only from ${named.account.domainLock}`, {
        hint: `Send from an address at ${named.account.domainLock}.`,
      });
    }
    return `From domain ${domain}: not checked — a sending-only key cannot read the domain list; Resend refuses an unverified domain`;
  }
  const page = await resendRequest<{
    data?: { name?: unknown; status?: unknown; capabilities?: { sending?: unknown } }[];
  }>(await context.transport(named), 'GET', '/domains');
  const found = (page.data ?? []).find((entry) => String(entry.name ?? '').toLowerCase() === domain);
  if (!found) {
    throw new CommsError(
      'BAD_DATA',
      `${domain} is not one of this Resend team's domains, so nothing can be sent from it`,
      {
        // With the account: `domains` without `--account` is a command commander refuses.
        hint: handoffSentence(
          context.handoffs.own(['domains', '--account', named.name]),
          (command) => `Send from an address at a verified domain: see ${command}.`,
        ),
      },
    );
  }
  if (found.status !== 'verified') {
    throw new CommsError('BAD_DATA', `${domain} is not verified at Resend (status: ${String(found.status)})`, {
      hint: handoffSentence(
        context.handoffs.own(['domains', '--account', named.name, '--domain', domain]),
        (command) => `A person finishes the DNS records for it first: ${command} lists them.`,
      ),
    });
  }
  const sending = found.capabilities?.sending;
  if (sending !== undefined && sending !== 'enabled') {
    throw new CommsError('BAD_DATA', `${domain} is verified, but sending from it is ${String(sending)}`);
  }
  return `From domain ${domain}: verified for sending at Resend`;
}

interface RecipientStudy {
  notes: Record<string, string>;
  flags: string[];
  /** For the preview's warnings: what is known about a Reply-To, which has no note of its own on its line. */
  warnings: string[];
}

/**
 * Who the email reaches, and what that means for the policy.
 *
 * The Reply-To is studied as a recipient is. It receives nothing itself, but every answer the recipients send goes
 * there: mail that says "reply to me at drop@evil.test" steers the replies as surely as a recipient steers the mail.
 */
async function studyRecipients(
  context: ResendContext,
  named: NamedAccount,
  message: OutboundMessage,
  riskEscalation: boolean,
): Promise<RecipientStudy> {
  const records = new SendRecords(context.core.paths.stateDir, context.now);
  const reach = uniqueRecipients(message);
  const notes: Record<string, string> = {};
  const flags: string[] = [];
  const warnings: string[] = [];
  const seenInMail = async (address: string): Promise<boolean> => {
    const seen = await context.core.taint.check(address);
    return (seen.address || seen.domain) && !(await records.hasSentTo(named.account.id, address));
  };
  let tainted = false;
  let replyToTainted = false;
  if (riskEscalation) {
    for (const address of reach) {
      if (await seenInMail(address)) {
        tainted = true;
        notes[address] = 'ADDRESS SEEN IN MAIL YOU READ · never written to from here';
      }
    }
    for (const address of message.replyTo.filter((candidate) => candidate !== message.fromAddress)) {
      if (await seenInMail(address)) {
        replyToTainted = true;
        warnings.push(
          `Reply-To ${address}: seen in mail you read, never written to from here — the recipients' replies go there`,
        );
      }
    }
  }
  if (tainted) flags.push('recipient-tainted');
  if (replyToTainted) flags.push('reply-to-tainted');
  if (reach.length > REACH_CONFIRM_THRESHOLD) flags.push(`reach-above-${REACH_CONFIRM_THRESHOLD}`);
  for (const address of message.bcc) notes[address] = notes[address] ? `BCC · ${notes[address]}` : 'BCC';
  return { notes, flags, warnings };
}

function expectationOf(message: OutboundMessage): Expectation {
  return { to: [...message.to], cc: [...message.cc], bcc: [...message.bcc], subject: message.subject };
}

/**
 * The preview's policy line. Under `confirm` it names Resend's own `approve`, located by the process that renders it —
 * the preparing one, then the approving one: a send's approval is bound to the message's digest, not to this line.
 */
function describePolicy(
  effective: SendPolicy,
  approvalId: string,
  flags: readonly string[],
  handoffs: CliHandoffs,
): string {
  if (effective === 'confirm') {
    const why = flags.length > 0 ? ` (${flags.join(', ')})` : '';
    return `Policy: confirm${why} — ${handoffSentence(
      approveCommand(handoffs, approvalId),
      (command) => `a person runs ${command} at their own terminal before this can go.`,
      { instead: 'a person approves it at their own terminal before this can go.' },
    )}`;
  }
  return 'Policy: chat — send only after the user approves this exact preview.';
}

function previewOf(options: {
  name: string;
  approvalId: string;
  built: Pick<BuiltMessage, 'message' | 'links' | 'warnings'>;
  study: RecipientStudy;
  domainNote: string;
  effective: SendPolicy;
  flags: readonly string[];
  handoffs: CliHandoffs;
}): string {
  const { message } = options.built;
  const reach = uniqueRecipients(message);
  const warnings = [
    `Reach: ${reach.length} unique recipient(s) — To ${message.to.length} · Cc ${message.cc.length} · Bcc ${message.bcc.length}${
      reach.length > REACH_CONFIRM_THRESHOLD
        ? ` — more than ${REACH_CONFIRM_THRESHOLD}, so a person approves it at a terminal`
        : ''
    }`,
    options.domainNote,
    ...(message.bcc.length > 0 ? [`${message.bcc.length} blind recipient(s) — the others will not see them`] : []),
    ...(message.scheduledAt
      ? [
          // The id is Resend's, known once it is sent: a word to fill in, after the account, which is known now.
          handoffSentenceToFill(
            options.handoffs.own(['scheduled', 'cancel', '--account', options.name]),
            ['<id>'],
            (command) => `Scheduled for ${message.scheduledAt}; until then it can be cancelled with ${command}`,
            {
              instead: `Scheduled for ${message.scheduledAt}; until then it can be cancelled with resend_scheduled_cancel.`,
            },
          ),
        ]
      : ['Sends as soon as it is approved and executed']),
    ...options.study.warnings,
    ...options.built.warnings,
  ];
  const preview: MessagePreview = {
    recipients: {
      from: message.from,
      to: message.to,
      cc: message.cc,
      bcc: message.bcc,
      replyTo: message.replyTo.filter((address) => address !== message.fromAddress),
    },
    subject: message.subject,
    body: message.text,
    attachments: message.attachments.map(({ filename, size, contentType }) => ({
      filename,
      size,
      mimeType: contentType,
    })),
    context: {
      inbox: options.name,
      approvalId: options.approvalId,
      note: `nothing has been sent · reaches ${reach.length}`,
    },
    recipientNotes: options.study.notes,
    thread: message.inReplyTo
      ? `reply to ${message.inReplyTo}${message.references.length > 1 ? ` (${message.references.length} references)` : ''}`
      : undefined,
    links: options.built.links,
    warnings,
    policy: describePolicy(options.effective, options.approvalId, options.flags, options.handoffs),
  };
  return renderMessagePreview(preview);
}

async function attachPolicy(context: ResendContext) {
  const config = await context.config();
  return {
    configDir: context.core.paths.configDir,
    env: context.env,
    roots: config.defaults.attachRoots,
    deny: config.defaults.attachDeny,
    // For the command the jail's refusal names, core's `attach roots add`: located from here.
    handoffs: context.handoffs,
  };
}

/**
 * Step one. Builds and checks the message, refuses a From on an unverified domain, and records an approval bound to
 * this exact content. Nothing is sent; preparing twice is free.
 */
export async function prepareSend(context: ResendContext, name: string, input: SendInput): Promise<SendPreparation> {
  // First: the configuration this send's epoch is read from is version 3, and an earlier release's records are retired.
  const { legacyDrain } = await ensureSendEpochConfig(context.core, { now: context.now });
  const named = await context.accounts.require(name);
  requireSendMode(named, context.handoffs);
  const config = await context.config();
  const livePolicy = named.account.sendPolicy ?? config.defaults.sendPolicy;
  if (livePolicy === 'never') {
    throw new CommsError('POLICY_NEVER', `sending from ${name} is turned off (policy: never)`, {
      hint: handoffSentence(
        context.handoffs.own(['account', 'policy', name, '--send', 'confirm']),
        (command) => `A person can change it with ${command}.`,
      ),
    });
  }
  const built = await buildMessage(input, { now: context.now(), attach: await attachPolicy(context) });
  const domainNote = await checkFromDomain(context, named, built.message.fromDomain);
  const study = await studyRecipients(context, named, built.message, config.defaults.riskEscalation);
  const requiredPolicy: SendPolicy = study.flags.length > 0 ? 'confirm' : 'chat';
  const effective = stricterPolicy(livePolicy, requiredPolicy);
  const digest = digestOf(built.message);
  const preparedId = newPreparedId();

  const record = await context.core.approvals.create({
    channel: 'resend',
    inboxId: named.account.id,
    inboxSub: named.account.userId,
    draftId: preparedId,
    // A prepared message has no revision of its own: the same bytes are the same message, so the digest stands in.
    draftMessageId: digest,
    contentDigest: digest,
    sendEpoch: sendEpochOf(config, named.account.id),
    policy: livePolicy,
    requiredPolicy,
    riskFlags: study.flags,
    expect: expectationOf(built.message),
  });
  const prepared: PreparedMessage = {
    preparedId,
    accountId: named.account.id,
    message: built.message,
    digest,
    links: built.links,
    warnings: [domainNote, ...built.warnings],
    createdAt: context.now().toISOString(),
  };
  await new PreparedStore(context.core.paths.stateDir).put(prepared);
  await context.core.audit.append({
    inboxId: named.account.id,
    alias: name,
    operation: 'resend.send.prepare',
    outcome: 'ok',
    surface: context.surface,
    approvalId: record.approvalId,
    reason: study.flags.length > 0 ? `escalated: ${study.flags.join(', ')}` : `policy ${effective}`,
  });

  const reach = uniqueRecipients(built.message).length;
  return {
    approvalId: record.approvalId,
    account: name,
    preview: previewOf({
      name,
      approvalId: record.approvalId,
      built,
      study,
      domainNote,
      effective,
      flags: study.flags,
      handoffs: context.handoffs,
    }),
    policy: livePolicy,
    effectivePolicy: effective,
    riskFlags: study.flags,
    reach,
    expect: record.expect,
    expiresAt: record.expiresAt,
    nextStep:
      effective === 'confirm'
        ? `${handoffSentence(
            approveCommand(context.handoffs, record.approvalId),
            (command) => `Show the preview to the user, then have them run ${command} in their own terminal.`,
            { instead: 'Show the preview to the user; they approve it at their own terminal.' },
          )} You cannot approve this yourself. Then execute it with the same approval id and the recipients and subject shown.`
        : 'Show the preview to the user verbatim and wait for an explicit yes. Then execute it with the same approval id and the recipients and subject shown above.',
    ...(legacyDrain === undefined ? {} : { legacyDrain }),
  };
}

/** The stored message and its attachments' bytes, checked again: a file changed since the preview voids the send. */
async function reload(
  context: ResendContext,
  record: ApprovalRecord,
): Promise<{ prepared: PreparedMessage; digest: string; contents: Uint8Array[] }> {
  const prepared = await new PreparedStore(context.core.paths.stateDir).get(record.draftId);
  if (!prepared || prepared.accountId !== record.inboxId) {
    throw new CommsError('NOT_FOUND', 'the message this approval was prepared for is no longer on this machine', {
      hint: 'Prepare the send again.',
    });
  }
  const contents: Uint8Array[] = [];
  const attachments = [];
  for (const attachment of prepared.message.attachments) {
    let bytes: Uint8Array;
    try {
      bytes = new Uint8Array(await readFile(attachment.path));
    } catch {
      bytes = new Uint8Array();
    }
    contents.push(bytes);
    attachments.push({ ...attachment, size: bytes.byteLength, sha256: sha256Hex(bytes) });
  }
  return { prepared, digest: digestOf({ ...prepared.message, attachments }), contents };
}

/** The request body, built from the stored message and nothing else. */
function payloadOf(
  message: OutboundMessage,
  approvalId: string,
  contents: readonly Uint8Array[],
): Record<string, unknown> {
  const headers: Record<string, string> = {};
  if (message.inReplyTo) headers['In-Reply-To'] = message.inReplyTo;
  if (message.references.length > 0) headers.References = message.references.join(' ');
  return {
    from: message.from,
    to: message.to,
    ...(message.cc.length > 0 ? { cc: message.cc } : {}),
    ...(message.bcc.length > 0 ? { bcc: message.bcc } : {}),
    ...(message.replyTo.length > 0 ? { reply_to: message.replyTo } : {}),
    subject: message.subject,
    // Always given, so Resend never derives a text part the preview did not show.
    text: message.text,
    ...(message.html === null ? {} : { html: message.html }),
    ...(message.attachments.length > 0
      ? {
          attachments: message.attachments.map((attachment, index) => ({
            filename: attachment.filename,
            content_type: attachment.contentType,
            content: Buffer.from(contents[index] ?? new Uint8Array()).toString('base64'),
          })),
        }
      : {}),
    ...(Object.keys(headers).length > 0 ? { headers } : {}),
    ...(message.scheduledAt ? { scheduled_at: message.scheduledAt } : {}),
    tags: [{ name: APPROVAL_TAG, value: approvalId }],
  };
}

function describeState(state: ApprovalRecord['state']): string {
  switch (state) {
    case 'used':
      return 'this approval has already been used — the email was sent once, and is not sent again';
    case 'sending':
      return 'this approval is being sent by another process right now';
    case 'failed':
      return 'the send under this approval was refused; nothing was sent';
    case 'unknown':
      return 'a process stopped mid-send under this approval; whether the email went is not known';
    case 'expired':
      return 'this approval has expired';
    case 'revoked':
      return 'this approval was cancelled or voided';
    default:
      return `this approval is ${state}`;
  }
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Keeps the failure that stopped the send visible, adding only what could not be settled afterwards. */
function noSendError(error: unknown, unrecorded: readonly string[]): CommsError {
  const original =
    error instanceof CommsError ? error : new CommsError('UNEXPECTED', messageOf(error), { cause: error });
  const hint = [original.hint, ...unrecorded].filter((part) => part !== undefined);
  return new CommsError(original.code, original.message, {
    ...(hint.length === 0 ? {} : { hint: hint.join(' ') }),
    ...(original.details === undefined ? {} : { details: original.details }),
    cause: error,
  });
}

/** Settles a failure known to have happened before Resend sent anything, without one failed write skipping another. */
async function recordNoSend(
  context: ResendContext,
  records: SendRecords,
  options: { name: string; accountId: string; approvalId: string },
  error: unknown,
): Promise<CommsError> {
  const unrecorded: string[] = [];
  const said = messageOf(error);
  try {
    await records.release(options.accountId, options.approvalId);
  } catch (failure) {
    unrecorded.push(`the capacity slot could not be released (${messageOf(failure)})`);
  }
  try {
    await context.core.approvals.complete(options.approvalId, { error: said });
  } catch (failure) {
    unrecorded.push(`the approval could not be marked failed (${messageOf(failure)})`);
  }
  try {
    await records.record(options.accountId, {
      approvalId: options.approvalId,
      event: 'failed',
      error: said.slice(0, 300),
    });
  } catch (failure) {
    unrecorded.push(`the send record could not record the failure (${messageOf(failure)})`);
  }
  try {
    await context.core.audit.append({
      inboxId: options.accountId,
      alias: options.name,
      operation: 'resend.send.execute',
      outcome: 'failed',
      surface: context.surface,
      approvalId: options.approvalId,
      reason: [said.slice(0, 200), ...unrecorded].join('; '),
    });
  } catch (failure) {
    unrecorded.push(`the audit log could not record the failure (${messageOf(failure)})`);
  }
  return noSendError(error, unrecorded);
}

/**
 * Step three, and the only place mail leaves.
 *
 * The order is the guarantee: claim the approval once, reserve a slot, record the attempt, open a permit for one
 * request, send — never retried, because a retried send may deliver twice.
 */
export async function executeSend(
  context: ResendContext,
  name: string,
  options: { approvalId: string; expect: Expectation },
): Promise<SendResult> {
  // First, as every claim does: version 3, and an earlier release's records retired.
  const { legacyDrain } = await ensureSendEpochConfig(context.core, { now: context.now });
  const named = await context.accounts.require(name);
  requireSendMode(named, context.handoffs);
  // Before anything else, as the claim would: only a valid version-2 record is ever claimed here.
  const known = await ownRecord(context, named, options.approvalId);
  if (known.state !== 'pending' && known.state !== 'approved') {
    throw new CommsError('APPROVAL_VOID', `nothing was sent: ${describeState(known.state)}`, {
      hint:
        known.state === 'unknown'
          ? handoffSentence(
              statusCommand(context.handoffs, options.approvalId, name),
              (command) => `Check what happened with ${command} before anything else.`,
              { instead: 'Check what happened with resend_send_status before anything else.' },
            )
          : 'Prepare the send again if it should still go.',
      details: { approvalId: options.approvalId, state: known.state },
    });
  }
  const config = await context.config();
  const livePolicy = named.account.sendPolicy ?? config.defaults.sendPolicy;
  const { prepared, digest, contents } = await reload(context, known);
  // Everything that can refuse without sending does so before the approval is spent: the key, and a stop Resend asked for.
  const permit = closedPermit();
  const transport = await context.transport(named, permit);
  const blocked = await transport.throttle.blockedUntil();
  if (blocked !== null) {
    throw new CommsError('TRANSIENT', 'Resend asked this machine to stop for now (rate limit); nothing was sent', {
      hint: `The approval is untouched. Try again after ${blocked}.`,
      details: { blockedUntil: blocked },
    });
  }

  const claimed = await context.core.approvals.claimForSend(
    options.approvalId,
    {
      draftMessageId: digest,
      contentDigest: digest,
      inboxId: named.account.id,
      inboxSub: named.account.userId,
      expect: options.expect,
    },
    {
      pendingHint: `${handoffSentence(
        approveCommand(context.handoffs, options.approvalId),
        (command) =>
          `Ask the user to run ${command} in their own terminal, then execute it again with the same approval.`,
        { instead: 'Ask the user to approve it at their own terminal, then execute it again with the same approval.' },
      )} You cannot approve it yourself.`,
      platform: context.platform,
    },
  );

  const records = new SendRecords(context.core.paths.stateDir, context.now);
  const message = prepared.message;
  const recipients = uniqueRecipients(message);
  const bookkeeping = {
    name,
    accountId: named.account.id,
    approvalId: options.approvalId,
  };
  try {
    await records.reserve(named.account.id, options.approvalId, config.defaults.sendCaps);
  } catch (error) {
    throw await recordNoSend(context, records, bookkeeping, error);
  }
  try {
    await records.record(named.account.id, {
      approvalId: options.approvalId,
      event: 'attempt',
      recipients,
      subject: message.subject,
      scheduledAt: message.scheduledAt,
    });
    await context.core.audit.append(
      {
        inboxId: named.account.id,
        alias: name,
        operation: 'resend.send.execute',
        outcome: 'started',
        surface: context.surface,
        approvalId: options.approvalId,
        recipients: recipients.map(canonicalAddress),
      },
      { durable: true },
    );
  } catch (error) {
    throw await recordNoSend(context, records, bookkeeping, error);
  }

  let resendId: string;
  let requestIssued = false;
  const innerFetch = transport.fetch ?? (fetch as FetchLike);
  // Mark the inner fetch, after the throttle and request guard: before this runs, Resend certainly saw nothing.
  const trackedTransport = {
    ...transport,
    fetch: async (...args: Parameters<FetchLike>) => {
      requestIssued = true;
      return innerFetch(...args);
    },
  };
  try {
    const response = await spendOn(permit, options.approvalId, 'emails.send', () =>
      resendRequest<{ id?: unknown }>(trackedTransport, 'POST', '/emails', {
        body: payloadOf(message, options.approvalId, contents),
        idempotencyKey: options.approvalId,
      }),
    );
    if (typeof response.id !== 'string' || response.id === '') {
      throw new CommsError('PROVIDER_UNAVAILABLE', 'Resend accepted the send but returned no email id', {
        details: { outcome: 'unknown' },
      });
    }
    resendId = response.id;
  } catch (error) {
    if (!requestIssued) {
      throw await recordNoSend(context, records, bookkeeping, error);
    }
    const outcome: WriteOutcome =
      error instanceof CommsError && error.details?.outcome === 'not-sent'
        ? 'not-sent'
        : error instanceof CommsError && error.code === 'SEND_REFUSED'
          ? 'not-sent'
          : 'unknown';
    const said = error instanceof Error ? error.message : String(error);
    if (outcome === 'not-sent') {
      throw await recordNoSend(context, records, bookkeeping, error);
    }
    const unrecorded: string[] = [];
    try {
      await records.record(named.account.id, {
        approvalId: options.approvalId,
        event: 'unknown',
        error: said.slice(0, 300),
      });
    } catch (failure) {
      unrecorded.push(
        `the send record could not record this (${failure instanceof Error ? failure.message : String(failure)})`,
      );
    }
    try {
      await context.core.audit.append({
        inboxId: named.account.id,
        alias: name,
        operation: 'resend.send.execute',
        outcome: 'failed',
        surface: context.surface,
        approvalId: options.approvalId,
        reason: `outcome unknown: ${said.slice(0, 200)}`,
      });
    } catch (failure) {
      unrecorded.push(
        `the audit log could not record this (${failure instanceof Error ? failure.message : String(failure)})`,
      );
    }
    throw new CommsError('TRANSIENT', `whether the email was sent is not known: ${said}`, {
      hint: [
        `Do not send it again. ${handoffSentence(
          statusCommand(context.handoffs, options.approvalId, name),
          (command) =>
            `Check the Resend dashboard or ask the recipient, and check with ${command}; this approval is not used again.`,
          {
            instead:
              'Check the Resend dashboard or ask the recipient, and check with resend_send_status; this approval is not used again.',
          },
        )}`,
        ...unrecorded,
      ].join(' '),
      details: {
        ...(error instanceof CommsError ? error.details : {}),
        approvalId: options.approvalId,
        outcome: 'unknown',
      },
      cause: error,
    });
  }

  const unrecorded: string[] = [];
  try {
    await context.core.approvals.complete(options.approvalId, { sentMessageId: resendId });
  } catch (error) {
    unrecorded.push(
      `the approval could not be marked used (${error instanceof Error ? error.message : String(error)}), so it will read as unknown`,
    );
  }
  try {
    await records.record(named.account.id, { approvalId: options.approvalId, event: 'sent', resendId });
  } catch (error) {
    unrecorded.push(`the send record could not record it (${error instanceof Error ? error.message : String(error)})`);
  }
  try {
    await context.core.audit.append({
      inboxId: named.account.id,
      alias: name,
      operation: 'resend.send.execute',
      outcome: 'ok',
      surface: context.surface,
      approvalId: options.approvalId,
      ids: { resendIds: [resendId] },
      // From the record a person approved, not from what the caller restated: the two are checked equal.
      recipients: [...claimed.expect.to, ...claimed.expect.cc, ...claimed.expect.bcc].map(canonicalAddress),
      reason: [
        `digest ${digest.slice(0, 12)} · policy ${livePolicy} · ${claimed.approvedVia ?? 'chat'}`,
        ...unrecorded,
      ].join(' · '),
    });
  } catch (error) {
    unrecorded.push(`the audit log could not record it (${error instanceof Error ? error.message : String(error)})`);
  }
  return {
    account: name,
    approvalId: options.approvalId,
    resendId,
    state: message.scheduledAt ? 'scheduled' : 'sent',
    scheduledAt: message.scheduledAt,
    to: claimed.expect.to,
    cc: claimed.expect.cc,
    bcc: claimed.expect.bcc,
    subject: claimed.expect.subject,
    ...(unrecorded.length > 0 ? { note: unrecorded.join('; ') } : {}),
    ...(legacyDrain === undefined ? {} : { legacyDrain }),
  };
}

// ── What happened to a send ──────────────────────────────────────────────────────────────────────────────────────

export interface SendStatus {
  account: string;
  approvalId: string;
  /** The approval in its public shape — every form, an earlier release's and a corrupt one's included — or none. */
  approval: PublicApproval | null;
  local: SendSummary | null;
  /** What Resend says now, when it could be asked. */
  resend: { id: string; lastEvent: string | null; messageId: string | null; scheduledAt: string | null } | null;
  /** The answer, in words. */
  verdict: string;
}

/**
 * What is known about a send: the approval, the local record, and — when the outcome was unknown or the email is
 * scheduled — what Resend says now. Read only. It never sends, and never repeats a send to find out.
 */
export async function sendStatus(context: ResendContext, name: string, approvalId: string): Promise<SendStatus> {
  const named = await context.accounts.require(name);
  // Held, and not this account's send — or whose it is cannot be trusted: not found, as an id nobody prepared.
  const stored = await context.core.approvals.get(approvalId);
  if (stored !== null && (kindOf(stored) !== 'send' || ownerOf(stored) !== named.account.id)) {
    throw new CommsError('NOT_FOUND', `there is no send approval ${approvalId} for "${name}"`);
  }
  const local = await new SendRecords(context.core.paths.stateDir, context.now).summary(named.account.id, approvalId);
  const base = { account: name, approvalId, approval: stored ? publicStored(stored) : null, local };
  if (!local) {
    return {
      ...base,
      resend: null,
      verdict: stored
        ? `not sent: the approval is ${stateOf(stored)} and no send was attempted`
        : 'nothing is known about this approval',
    };
  }
  const readable = keyPermissionOf(named.account) === 'full_access';
  const lookUp = async (id: string) => {
    const email = await resendRequest<{
      id?: unknown;
      last_event?: unknown;
      message_id?: unknown;
      scheduled_at?: unknown;
    }>(await context.transport(named), 'GET', `/emails/${id}`);
    return {
      id,
      lastEvent: typeof email.last_event === 'string' ? email.last_event : null,
      messageId: typeof email.message_id === 'string' ? email.message_id : null,
      scheduledAt: typeof email.scheduled_at === 'string' ? email.scheduled_at : null,
    };
  };
  if (local.resendId) {
    if (!readable) {
      return { ...base, resend: null, verdict: `sent as ${local.resendId}; this key cannot read what happened after` };
    }
    const resend = await lookUp(local.resendId);
    return {
      ...base,
      resend,
      verdict: `sent as ${local.resendId}; Resend's last event: ${resend.lastEvent ?? 'none'}`,
    };
  }
  if (local.state === 'failed') {
    return { ...base, resend: null, verdict: `not sent: Resend refused it (${local.error ?? 'no reason recorded'})` };
  }
  if (!readable) {
    return {
      ...base,
      resend: null,
      verdict: `unknown, and this key cannot read sent mail. Look in the Resend dashboard for an email tagged ${APPROVAL_TAG}=${approvalId}; do not send it again`,
    };
  }
  // Unknown outcome and no id: look for the tag among recent sends with the same subject. Bounded, and read only.
  const page = await resendRequest<{ data?: { id?: unknown; subject?: unknown; created_at?: unknown }[] }>(
    await context.transport(named),
    'GET',
    '/emails',
    { query: { limit: 100 } },
  );
  const candidates = (page.data ?? [])
    .filter((email) => typeof email.id === 'string' && email.subject === local.subject)
    .slice(0, 5);
  for (const candidate of candidates) {
    const email = await resendRequest<{ tags?: { name?: unknown; value?: unknown }[] }>(
      await context.transport(named),
      'GET',
      `/emails/${String(candidate.id)}`,
    );
    if ((email.tags ?? []).some((tag) => tag.name === APPROVAL_TAG && tag.value === approvalId)) {
      const resend = await lookUp(String(candidate.id));
      return { ...base, resend, verdict: `it was sent, as ${String(candidate.id)}: found by its approval tag` };
    }
  }
  return {
    ...base,
    resend: null,
    verdict: `not found among the 100 most recent sent emails — probably not sent, but do not send it again under this approval; prepare a new one if it should go`,
  };
}

// ── Approval at a terminal ───────────────────────────────────────────────────────────────────────────────────────

export interface SendApprovalPrompt {
  approvalId: string;
  account: string;
  preview: string;
  /** Printed to the person, never returned to an agent. */
  challenge: string;
}

/**
 * An approval at the terminal, and the account it belongs to: one that cannot be used is refused for what it is, and
 * says only that — this command is no account's in particular — and whose it is comes from `ownerOf`.
 */
async function recordAndAccount(
  context: ResendContext,
  approvalId: string,
): Promise<{ stored: StoredApproval; named: NamedAccount }> {
  const stored = await context.core.approvals.get(approvalId);
  if (stored !== null && (stored.form === 'corrupt' || stored.form === 'unreadable')) throw integrityRefusal(stored);
  const owner = ownerOf(stored);
  if (stored === null || owner === null || kindOf(stored) !== 'send') {
    throw new CommsError('NOT_FOUND', `there is no send approval ${approvalId}`, {
      hint: 'Approvals last ten minutes. Prepare the send again.',
    });
  }
  const named = await context.accounts.findById(owner);
  if (!named) throw new CommsError('NOT_FOUND', 'the Resend account this approval belongs to is no longer connected');
  return { stored, named };
}

/** Only a valid version-2 send is approved at the terminal: one an earlier release prepared, by its version. */
function sendRecordOf(stored: StoredApproval): ApprovalRecord {
  if (stored.form === 'legacy') throw otherVersionRefusal(stored.view);
  if (stored.form !== 'v2') throw integrityRefusal(stored);
  return stored.record;
}

/**
 * Re-reads the stored message, renders the preview a person is about to approve, and issues the code they type back.
 * A message or attachment that changed since the preview voids the approval: the person would be approving something
 * the record does not describe.
 */
export async function beginSendApproval(context: ResendContext, approvalId: string): Promise<SendApprovalPrompt> {
  const { stored, named } = await recordAndAccount(context, approvalId);
  // Refused before the message is read again: the integrity check below would judge any other form by rules it was
  // not written under.
  const record = sendRecordOf(stored);
  const { prepared, digest } = await reload(context, record);
  if (digest !== record.contentDigest) {
    await context.core.approvals.revoke(approvalId, 'the message or an attachment changed after the preview', {
      disposition: 'integrity',
    });
    throw new CommsError('APPROVAL_VOID', 'nothing was sent: the message or an attachment changed after the preview', {
      hint: 'Prepare the send again to see what it says now.',
    });
  }
  const config = await context.config();
  const study = await studyRecipients(context, named, prepared.message, config.defaults.riskEscalation);
  const live = named.account.sendPolicy ?? config.defaults.sendPolicy;
  const effective = stricterPolicy(live, record.requiredPolicy);
  const challenge = await context.core.approvals.issueChallenge(approvalId, 'send', context.platform);
  return {
    approvalId,
    account: named.name,
    preview: previewOf({
      name: named.name,
      approvalId,
      built: { message: prepared.message, links: prepared.links, warnings: prepared.warnings.slice(1) },
      study,
      domainNote: prepared.warnings[0] ?? '',
      effective,
      flags: record.riskFlags,
      handoffs: context.handoffs,
    }),
    challenge,
  };
}

export async function finishSendApproval(
  context: ResendContext,
  approvalId: string,
  answer: string,
): Promise<ApprovalRecord> {
  // First, as every approval does: version 3, and an earlier release's records retired.
  await ensureSendEpochConfig(context.core, { now: context.now });
  const { stored, named } = await recordAndAccount(context, approvalId);
  const record = sendRecordOf(stored);
  const { digest } = await reload(context, record);
  const approved = await context.core.approvals.approve(
    approvalId,
    'terminal',
    { draftMessageId: digest, contentDigest: digest },
    answer,
    'send',
    context.platform,
  );
  await context.core.audit.append({
    inboxId: named.account.id,
    alias: named.name,
    operation: 'resend.send.approve',
    outcome: 'ok',
    surface: context.surface,
    approvalId,
    reason: 'approved at a terminal',
  });
  return approved;
}

/** Cancels an approval. Anyone may: refusing to send is never the dangerous direction. */
export async function revokeSendApproval(context: ResendContext, approvalId: string): Promise<void> {
  const { named } = await recordAndAccount(context, approvalId);
  await context.core.approvals.revoke(approvalId, 'cancelled at the terminal', { disposition: 'person' });
  await context.core.audit.append({
    inboxId: named.account.id,
    alias: named.name,
    operation: 'resend.send.revoke',
    outcome: 'ok',
    surface: context.surface,
    approvalId,
  });
}
