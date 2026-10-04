import {
  commandText,
  type InstallResult,
  inlineCommand,
  paint,
  renderInstall,
  type ServerInstallResult,
  shellCommand,
  sizeOf,
} from '@agentcomms/core';
import type { RegistrationIntent } from '../auth/flows.ts';
import type { LabelSummary, SendAsSummary } from '../operations/analyse.ts';
import type { DownloadQuestion, DownloadResult, FindAttachmentsResult } from '../operations/attachments.ts';
import type { ClientAddResult, ClientView } from '../operations/clients.ts';
import type { ConsentResult } from '../operations/consent.ts';
import type { ContactsResult, FollowUpsResult } from '../operations/contacts.ts';
import type { DoctorResult } from '../operations/doctor.ts';
import type { DraftResult, DraftSummary } from '../operations/drafts.ts';
import type { ImportResult } from '../operations/import-legacy.ts';
import type { InboxView, WhoamiResult } from '../operations/inboxes.ts';
import type { ModifyResult, TrashResult } from '../operations/organise.ts';
import type { ReadMessageResult, ReadThreadResult } from '../operations/read.ts';
import type { SearchResult } from '../operations/search.ts';
import type { listApprovals, SendPreparation, SendResult } from '../operations/send.ts';
import { FINISH_WAIT_SECONDS, type StartedSignIn } from '../operations/signin.ts';

type ApprovalView = Awaited<ReturnType<typeof listApprovals>>[number];

/** Human renderings. `--json` prints the data itself; these exist so a person is not made to read JSON. */

function table(rows: string[][], color: boolean): string {
  const header = rows[0];
  if (!header) return '';
  const widths = header.map((_, column) => Math.max(...rows.map((row) => (row[column] ?? '').length)));
  return rows
    .map((row, index) => {
      const line = row
        .map((cell, column) => (cell ?? '').padEnd(widths[column] ?? 0))
        .join('  ')
        .trimEnd();
      return index === 0 ? paint(color, 'dim', line) : line;
    })
    .join('\n');
}

export function renderClients(clients: ClientView[], color: boolean): string {
  if (clients.length === 0) {
    return 'No OAuth client registered yet. Add one with `agent-gmail client add <client_secret.json>`.';
  }
  return table(
    [
      ['NAME', 'CLIENT ID', 'PROJECT', 'INBOXES'],
      ...clients.map((client) => [
        client.name,
        client.clientId,
        client.projectId ?? '—',
        client.inboxes.length ? client.inboxes.join(', ') : '—',
      ]),
    ],
    color,
  );
}

export function renderClientAdd(result: ClientAddResult, color: boolean): string {
  const lines = [
    `Registered the OAuth client "${result.name}".`,
    `  client id: ${result.clientId}`,
    `  secrets:   ${result.store === 'keychain' ? 'the system keychain' : 'owner-only files in the config directory'}`,
  ];
  if (result.probeSkippedReason) lines.push(paint(color, 'yellow', `  note: ${result.probeSkippedReason}`));
  if (result.sourceRemoved) lines.push('  the downloaded file was deleted');
  lines.push('', 'Next: connect a mailbox with `agent-gmail inbox add <name> --start`.');
  return lines.join('\n');
}

export function renderSignInStarted(
  started: StartedSignIn,
  mode: 'add' | 'reauth',
  color: boolean,
  platform: NodeJS.Platform = process.platform,
): string {
  const finish = commandText(
    shellCommand(
      ['agent-gmail', 'inbox', mode, '--finish', started.flowId, '--wait', String(FINISH_WAIT_SECONDS)],
      platform,
    ),
  );
  return [
    paint(
      color,
      'bold',
      mode === 'add' ? 'Open this link to connect the mailbox:' : 'Open this link to sign in again:',
    ),
    started.authUrl,
    '',
    'Google will warn that the app is not verified — that is expected for a client you made yourself:',
    'choose Advanced, then "Go to … (unsafe)", and leave every permission ticked.',
    '',
    `Then run: ${finish}`,
    paint(color, 'dim', `The link works for ten minutes (until ${started.expiresAt}).`),
    // The link is a one-time capability and it has just been printed — into a terminal, a transcript, a log. Whoever
    // opens it decides which Google account gets connected, and without `--email` nothing checks that afterwards.
    ...(started.expectedEmail
      ? []
      : [
          paint(
            color,
            'yellow',
            'This link connects whichever Google account opens it. Keep it to yourself, and check the address ' +
              'reported when it finishes — or pass --email <address> next time, which refuses anything else.',
          ),
        ]),
  ].join('\n');
}

/**
 * What became of the registration a finished sign-in carried from `setup --mcp-client`, reported beside the mailbox.
 *
 * Beside it, never instead of it: the mailbox is connected whatever happens here, and a registration waiting for a
 * person, or refused, is not a sign-in that failed. Nor is one that did not happen reported as one that did — each
 * outcome says which it is, and only `registered` carries an install that wrote an entry.
 */
export type FinishRegistration =
  /** The client's entry of ours under the name `setup` registers already serves this mailbox: `clientServesInbox`. */
  | { client: string; status: 'already-registered' }
  | { client: string; status: 'registered'; install: ServerInstallResult }
  | {
      client: string;
      status: 'approval-required';
      approvalId: string;
      policy: string;
      summary: string;
      /** What the person reads before agreeing. */
      preview: string;
      expiresAt: string;
      /** The command that claims the approval once the person has agreed: `mcp install`, the same change. */
      claim: string;
      hint: string;
    }
  | {
      client: string;
      status: 'not-registered';
      reason: string;
      hint?: string | undefined;
      /** Present when the install ran and only printed the entry: what to paste instead. */
      install?: InstallResult | undefined;
    };

function renderFinishRegistration(registration: FinishRegistration, color: boolean): string {
  const { client } = registration;
  switch (registration.status) {
    case 'already-registered':
      return `Setup asked for the Gmail server to be registered with ${client}; its entry there already serves this mailbox, so nothing was changed.`;
    case 'registered':
      return [
        `Setup asked for the Gmail server to be registered with ${client}:`,
        renderInstall(registration.install, color),
      ].join('\n');
    case 'approval-required':
      return [
        paint(
          color,
          'bold',
          `Setup also asked to register the Gmail server with ${client}. That waits for the person's approval:`,
        ),
        '',
        registration.preview,
        '',
        registration.hint,
      ].join('\n');
    case 'not-registered':
      return [
        paint(color, 'yellow', `The Gmail server was not registered with ${client}: ${registration.reason}`),
        ...(registration.hint ? [registration.hint] : []),
        ...(registration.install ? [renderInstall(registration.install, color)] : []),
      ].join('\n');
  }
}

export function renderSignedIn(
  result: ConsentResult & { registration?: FinishRegistration | undefined },
  color: boolean,
  platform: NodeJS.Platform = process.platform,
): string {
  const lines = [
    paint(
      color,
      'green',
      result.reauthorised
        ? `Signed in again as ${result.inbox.email}.`
        : `Connected ${result.inbox.email} as "${result.alias}".`,
    ),
    `  access: ${result.inbox.tier}${result.inbox.contacts ? ' + contacts' : ''}`,
    `  client: ${result.client}${result.organisation ? ` (organisation ${result.organisation})` : ''}`,
  ];
  if (result.missingScopes.length > 0) {
    lines.push(
      paint(color, 'yellow', `  not granted: ${result.missingScopes.join(', ')}`),
      `  to grant it: ${inlineCommand(shellCommand(['agent-gmail', 'inbox', 'reauth', result.alias], platform))}`,
    );
  }
  lines.push(
    '',
    `Check it: ${inlineCommand(shellCommand(['agent-gmail', 'whoami', '--inbox', result.alias], platform))}`,
  );
  if (result.registration) lines.push('', renderFinishRegistration(result.registration, color));
  return lines.join('\n');
}

export function renderInboxList(inboxes: InboxView[], color: boolean): string {
  if (inboxes.length === 0) return 'No mailbox connected yet. Connect one with `agent-gmail inbox add <name>`.';
  return table(
    [
      ['NAME', 'ADDRESS', 'ACCESS', 'CLIENT', 'SENDING', 'HEALTH'],
      ...inboxes.map((inbox) => [
        inbox.alias,
        inbox.email,
        inbox.tier + (inbox.contacts ? '+contacts' : ''),
        inbox.client + (inbox.organisation ? ` (${inbox.organisation})` : ''),
        inbox.sendPolicy + (inbox.sendPolicyInherited ? ' (default)' : ''),
        inbox.health === 'ok' ? 'ok' : inbox.health === 'unknown' ? 'not used yet' : 'needs attention',
      ]),
    ],
    color,
  );
}

export function renderInboxShow(
  inbox: InboxView & { grantedScopes: string[]; internalDomains: string[] },
  color: boolean,
): string {
  const lines = [
    paint(color, 'bold', `${inbox.alias} — ${inbox.email}`),
    `  id:          ${inbox.id}`,
    `  access:      ${inbox.tier} (${inbox.capabilities.join(', ')})`,
    `  sending:     ${inbox.sendPolicy}${inbox.sendPolicyInherited ? ' (from defaults)' : ''}`,
    `  changes:     ${inbox.changePolicy}${inbox.changePolicyInherited ? ' (from defaults)' : ''}`,
    `  client:      ${inbox.client}`,
    ...(inbox.organisation ? [`  organisation: ${inbox.organisation}`] : []),
    `  account id:  ${inbox.identity === 'oidc' ? 'known' : 'not known (imported)'}`,
    `  connected:   ${inbox.createdAt}`,
    `  last refresh:${inbox.lastRefreshOkAt ? ` ${inbox.lastRefreshOkAt}` : ' never'}`,
    `  internal domains: ${inbox.internalDomains.length ? inbox.internalDomains.join(', ') : '—'}`,
  ];
  if (inbox.lastError) {
    lines.push(paint(color, 'yellow', `  last error:  ${inbox.lastError.code} — ${inbox.lastError.message}`));
  }
  return lines.join('\n');
}

export function renderWhoami(result: WhoamiResult, color: boolean): string {
  const lines = [
    paint(color, 'bold', `${result.alias} — ${result.profileEmail}`),
    `  access:   ${result.tier} (${result.capabilities.join(', ')})`,
    `  sending:  ${result.sendPolicy}`,
    `  messages: ${result.messagesTotal} in ${result.threadsTotal} threads`,
  ];
  if (!result.matches) {
    lines.push(
      paint(
        color,
        'yellow',
        `  warning: this inbox is recorded as ${result.email}, but Google says ${result.profileEmail}`,
      ),
    );
  }
  return lines.join('\n');
}

export function renderDoctor(result: DoctorResult, color: boolean): string {
  const mark: Record<string, string> = { ok: 'ok  ', warn: 'warn', fail: 'FAIL', skipped: '--  ' };
  const tint: Record<string, Parameters<typeof paint>[1]> = {
    ok: 'green',
    warn: 'yellow',
    fail: 'red',
    skipped: 'dim',
  };
  const lines = result.checks.map((check) => {
    const head = `${paint(color, tint[check.status] ?? 'dim', mark[check.status] ?? '?')}  ${check.title}: ${check.detail}`;
    const fix = check.fix
      ? `\n${check.fix
          .split('\n')
          .map((line) => `      ${paint(color, 'dim', `fix: ${line}`)}`)
          .join('\n')}`
      : '';
    return `${head}${fix}`;
  });
  lines.push('', `${result.summary.ok} ok · ${result.summary.warn} to look at · ${result.summary.fail} broken`);
  return lines.join('\n');
}

export function renderImport(result: ImportResult, color: boolean): string {
  const lines: string[] = [];
  lines.push(
    paint(
      color,
      'bold',
      result.dryRun ? 'Nothing was changed. This is what would be imported:' : 'Imported from the other Gmail server:',
    ),
  );
  if (result.imported.length === 0) lines.push('  (nothing)');
  for (const candidate of result.imported) {
    lines.push(`  ${candidate.alias}: ${candidate.email ?? 'unknown address'} — ${candidate.tier}`);
  }
  for (const candidate of result.skipped) {
    lines.push(paint(color, 'yellow', `  skipped ${candidate.alias}: ${candidate.problem ?? 'not usable'}`));
  }
  if (result.ungatedServers.length > 0) {
    lines.push(
      '',
      paint(color, 'red', 'The other Gmail server is still connected to an agent client.'),
      'Its send tools are not gated by anything here: while it is registered, an agent can send mail without',
      'the approval steps this package adds.',
    );
    for (const finding of result.ungatedServers) {
      lines.push(`  ${finding.packageName} as "${finding.name}" in ${finding.path} (${finding.client})`);
    }
  }
  if (result.nextSteps.length > 0) {
    lines.push('', paint(color, 'bold', 'Next:'));
    for (const step of result.nextSteps) lines.push(`  ${step}`);
  }
  return lines.join('\n');
}

export function renderSearch(result: SearchResult, color: boolean): string {
  const lines: string[] = [];
  if (result.query.rewrites.length > 0) {
    lines.push(paint(color, 'dim', `query: ${result.query.compiled}  (dates read in ${result.query.timezone})`));
  }
  if (result.rows.length === 0) {
    lines.push('Nothing matched.');
  } else {
    for (const [index, row] of result.rows.entries()) {
      const marks = [row.unread ? 'unread' : '', row.attachmentCount > 0 ? `${row.attachmentCount} attached` : '']
        .filter(Boolean)
        .join(' · ');
      lines.push(
        `${paint(color, 'dim', String(index + 1).padStart(2))} ${row.date?.slice(0, 16).replace('T', ' ') ?? '—'}  ${paint(color, 'bold', row.inbox)}  ${row.from?.address ?? 'unknown'}`,
        `   ${row.subject || '(no subject)'}${marks ? paint(color, 'dim', `  [${marks}]`) : ''}`,
        `   ${paint(color, 'dim', `${row.threadId}${row.messageId === row.threadId ? '' : ` · message ${row.messageId}`}`)}`,
      );
    }
  }
  lines.push('');
  lines.push(
    `${result.returned} shown${result.hasMore ? '; more available' : '; that is all of them'}${
      result.hasMore ? ` (continue with --cursor ${result.nextCursor})` : ''
    }`,
  );
  for (const error of result.errors) {
    lines.push(paint(color, 'yellow', `${error.inbox} could not be searched: ${error.message}`));
  }
  return lines.join('\n');
}

export function renderMessage(message: ReadMessageResult, color: boolean): string {
  const lines = [
    paint(color, 'bold', message.subject || '(no subject)'),
    `from: ${message.from?.address ?? 'unknown'}${message.from?.name ? ` (${message.from.name})` : ''}`,
    `to:   ${message.to.map((entry) => entry.address).join(', ') || '—'}`,
  ];
  if (message.cc.length > 0) lines.push(`cc:   ${message.cc.map((entry) => entry.address).join(', ')}`);
  lines.push(`date: ${message.date ?? 'unknown'}   ${paint(color, 'dim', `[${message.inbox}] ${message.messageId}`)}`);

  const warnings: string[] = [];
  if (message.sender.replyToDiffers) warnings.push(`replies would go to ${message.sender.replyToDomains.join(', ')}`);
  if (message.sender.displayNameContainsOtherAddress) warnings.push('the display name contains another address');
  if (message.auth.evaluatedBy === null) warnings.push('Google published no authentication result for this message');
  else if (message.auth.dmarc !== 'pass') warnings.push(`DMARC: ${message.auth.dmarc ?? 'none'}`);
  if (message.sanitisation.hiddenElements > 0) {
    warnings.push(`${message.sanitisation.hiddenElements} hidden element(s) removed`);
  }
  if (message.sanitisation.plainHtmlMismatch) {
    warnings.push(
      `the plain-text part carries ${message.sanitisation.plainHtmlMismatch.extraChars} characters the reader never sees`,
    );
  }
  for (const warning of warnings) lines.push(paint(color, 'yellow', `!     ${warning}`));

  if (message.attachments.length > 0) {
    lines.push('', paint(color, 'bold', 'Attachments'));
    // The name the sender gave is wrapped, several lines long, and so is a type that is more than a type: each is
    // printed as it came, never folded into a line of the tool's own.
    for (const attachment of message.attachments) {
      lines.push(
        `  part ${attachment.partId} · ${Math.round(attachment.size / 1024)} KB${
          attachment.riskFlags.length ? paint(color, 'yellow', `  [${attachment.riskFlags.join(', ')}]`) : ''
        }`,
        `  type ${attachment.mimeType}`,
        attachment.filename,
      );
    }
  }

  lines.push('', message.body.enveloped);
  if (message.body.truncated) {
    lines.push(paint(color, 'dim', `(truncated; continue with --offset ${message.body.nextOffset})`));
  }
  return lines.join('\n');
}

export function renderThread(thread: ReadThreadResult, color: boolean): string {
  const lines = [
    paint(color, 'bold', `${thread.subject || '(no subject)'} — ${thread.messageCount} messages`),
    paint(color, 'dim', `${thread.inbox} · ${thread.threadId} · ${thread.participants.join(', ')}`),
  ];
  for (const message of thread.messages) {
    lines.push(
      '',
      paint(color, 'dim', `── ${message.date ?? 'unknown'} · ${message.from?.address ?? 'unknown'}`),
      message.body.enveloped,
    );
  }
  if (thread.truncated)
    lines.push('', paint(color, 'dim', '(the thread was cut short; read single messages for more)'));
  return lines.join('\n');
}

export function renderLabels(labels: LabelSummary[], color: boolean): string {
  if (labels.length === 0) return 'No labels.';
  return table(
    [
      ['NAME', 'ID', 'TYPE', 'TOTAL', 'UNREAD'],
      ...labels.map((label) => [
        label.name,
        label.id,
        label.type,
        String(label.messagesTotal ?? '—'),
        String(label.messagesUnread ?? '—'),
      ]),
    ],
    color,
  );
}

export function renderSendAs(addresses: SendAsSummary[], color: boolean): string {
  if (addresses.length === 0) return 'No send-as addresses.';
  return table(
    [
      ['ADDRESS', 'NAME', 'DEFAULT', 'VERIFIED', 'SIGNATURE'],
      ...addresses.map((entry) => [
        entry.email,
        entry.displayName || '—',
        entry.isDefault ? 'yes' : '',
        entry.verificationStatus ?? '—',
        entry.hasSignature ? 'yes' : '',
      ]),
    ],
    color,
  );
}

export function renderAttachments(result: FindAttachmentsResult, color: boolean): string {
  if (result.rows.length === 0) return 'No attachments matched.';
  // A block per attachment rather than a table: the file name, and an address or a type that is more than one, come
  // wrapped, several lines each — they cannot sit in a cell, and printed bare they would read as the tool's own words.
  const lines: string[] = [];
  for (const [index, row] of result.rows.entries()) {
    lines.push(
      `${paint(color, 'dim', String(index + 1).padStart(2))} ${row.date?.slice(0, 10) ?? '—'}  ${paint(color, 'bold', row.inbox)}  ` +
        `message ${row.messageId} · part ${row.partId} · ${Math.round(row.size / 1024)} KB${
          row.riskFlags.length ? paint(color, 'yellow', `  [${row.riskFlags.join(', ')}]`) : ''
        }`,
      `   from ${row.from ?? 'unknown'}`,
      `   type ${row.mimeType}`,
      row.filename,
    );
  }
  lines.push(
    '',
    `${result.rows.length} attachment(s). Download with \`agent-gmail attachments download <messageId> --inbox <name> --part <partId>\`.`,
  );
  if (result.driveLinks > 0) {
    lines.push(
      paint(color, 'dim', `${result.driveLinks} Drive link(s) were skipped: they are links, not files in the message.`),
    );
  }
  for (const error of result.errors) lines.push(paint(color, 'yellow', `${error.inbox}: ${error.message}`));
  return lines.join('\n');
}

/**
 * The question a download asks before it saves anything: each file — its size, where it came from, and the name the
 * sender gave it, wrapped — and then the three places, the first two by their paths.
 */
export function renderDownloadQuestion(question: DownloadQuestion, color: boolean): string {
  const lines: string[] = [];
  for (const [index, file] of question.files.entries()) {
    lines.push(
      `${paint(color, 'dim', String(index + 1).padStart(2))} ${sizeOf(file.size)} · message ${file.messageId} · part ${file.partId} · from ${file.from ?? 'unknown'}${
        file.riskFlags.length ? paint(color, 'yellow', `  [${file.riskFlags.join(', ')}]`) : ''
      }`,
      file.filename,
    );
  }
  for (const skip of question.skipped) {
    lines.push(paint(color, 'yellow', `not saved ${skip.messageId}: ${skip.reason}`));
  }
  lines.push('', question.question);
  return lines.join('\n');
}

/** A field a result carries inside the untrusted-content envelope, rather than bare. */
function isWrapped(value: string): boolean {
  return value.startsWith('<untrusted-content');
}

export function renderDownloads(result: DownloadResult, color: boolean): string {
  const lines: string[] = [];
  for (const file of result.files) {
    // Where it went, and how big it is; then the name the sender gave it, wrapped. A path that ends in the sender's
    // words is wrapped too, and gets lines of its own rather than sitting inside one of the tool's.
    const wrapped = isWrapped(file.path);
    lines.push(
      `${file.duplicate ? paint(color, 'dim', 'same as') : 'saved '} ${wrapped ? `in ${result.folder}` : file.path} · ${sizeOf(file.size)} · from ${file.from ?? 'unknown'}` +
        (file.riskFlags.length ? paint(color, 'yellow', `  [${file.riskFlags.join(', ')}]`) : ''),
      ...(wrapped ? [file.path] : []),
      file.filename,
    );
  }
  for (const skip of result.skipped) lines.push(paint(color, 'yellow', `skipped ${skip.messageId}: ${skip.reason}`));
  // What the person should know before opening any of them: a rename, a flag, a mark that could not be made.
  for (const warning of result.warnings) lines.push(paint(color, 'yellow', `! ${warning}`));
  const saved = result.files.filter((file) => !file.duplicate).length;
  lines.push(
    '',
    result.folder === null
      ? 'Nothing was saved.'
      : `${saved} file(s), ${sizeOf(result.totalBytes)}, saved in ${result.folder}.`,
    paint(color, 'dim', 'Nothing was opened or run.'),
  );
  return lines.join('\n');
}

export function renderContacts(result: ContactsResult, color: boolean): string {
  if (result.contacts.length === 0) return `Nobody matched "${result.query}".`;
  const lines = [
    table(
      [
        ['ADDRESS', 'NAME', 'INBOX', 'WHERE FROM', 'MESSAGES', 'LAST SEEN'],
        ...result.contacts.map((contact) => [
          contact.email,
          contact.name || '—',
          contact.inbox,
          contact.sources.join('+'),
          contact.messages ? String(contact.messages) : '—',
          contact.lastSeen?.slice(0, 10) ?? '—',
        ]),
      ],
      color,
    ),
    '',
    paint(
      color,
      'dim',
      'Similar addresses are shown, not filtered: a lookalike domain matches a name as readily as the real one.',
    ),
  ];
  for (const error of result.errors) lines.push(paint(color, 'yellow', `${error.inbox}: ${error.message}`));
  return lines.join('\n');
}

export function renderFollowUps(result: FollowUpsResult, color: boolean): string {
  if (result.rows.length === 0) return 'Nothing is waiting.';
  const lines = [
    table(
      [
        ['DAYS', 'INBOX', 'WITH', 'SUBJECT', 'THREAD'],
        ...result.rows.map((row) => [
          String(row.ageDays),
          row.inbox,
          row.with,
          row.subject || '(no subject)',
          row.threadId,
        ]),
      ],
      color,
    ),
    '',
    result.rows[0]?.direction === 'awaiting-them'
      ? 'These are conversations where you spoke last.'
      : 'These arrived and have not been answered.',
  ];
  for (const error of result.errors) lines.push(paint(color, 'yellow', `${error.inbox}: ${error.message}`));
  return lines.join('\n');
}

export function renderDraft(result: DraftResult, color: boolean): string {
  // The preview is the point of the command, so it is printed as it is: it is what the user approves or rejects, and
  // reformatting it here would mean the thing approved is not the thing shown.
  const lines = [result.preview];
  if (result.attachments.length > 0) {
    lines.push(
      '',
      table(
        [
          ['ATTACHED', 'SIZE', 'TYPE', 'FROM'],
          ...result.attachments.map((attachment) => [
            attachment.filename,
            `${Math.max(1, Math.round(attachment.size / 1024))} KB`,
            attachment.mimeType,
            attachment.source,
          ]),
        ],
        color,
      ),
    );
  }
  for (const warning of result.warnings) lines.push(paint(color, 'yellow', `! ${warning}`));
  lines.push(
    '',
    paint(color, 'dim', `Saved as a draft in ${result.inbox} (${result.draftId}). Nothing has been sent.`),
    paint(color, 'dim', 'Open it in Gmail to send it, or ask for it to be sent and approve the send when prompted.'),
  );
  if (result.profile) lines.push('', paint(color, 'dim', '— writing profile —'), result.profile);
  return lines.join('\n');
}

export function renderDrafts(drafts: DraftSummary[], color: boolean): string {
  if (drafts.length === 0) return 'No drafts.';
  return table(
    [
      ['DRAFT', 'TO', 'SUBJECT', 'UPDATED'],
      ...drafts.map((draft) => [
        draft.draftId,
        draft.to.join(', ') || '—',
        draft.subject || '(no subject)',
        draft.updatedAt?.slice(0, 16).replace('T', ' ') ?? '—',
      ]),
    ],
    color,
  );
}

export function renderModify(
  result: ModifyResult,
  color: boolean,
  platform: NodeJS.Platform = process.platform,
): string {
  const what = [
    result.addLabelIds.length > 0 ? `+${result.addLabelIds.join(' +')}` : '',
    result.removeLabelIds.length > 0 ? `-${result.removeLabelIds.join(' -')}` : '',
  ]
    .filter(Boolean)
    .join(' ');
  const scope = `${result.messages} message${result.messages === 1 ? '' : 's'}`;
  if (result.dryRun) {
    const lines = [`Would change ${scope} in ${result.inbox}: ${what}.`, paint(color, 'dim', 'Nothing was changed.')];
    return lines.join('\n');
  }
  const lines = [`Changed ${scope} in ${result.inbox}: ${what}.`];
  if (result.undo && result.undo.length > 0) {
    // The undo differs per message, so it is not a command line to retype — it is the `undo` array from `--json`.
    lines.push(
      paint(
        color,
        'dim',
        `${result.undo.length} message(s) can be put back exactly as they were: ` +
          `re-run with --json, then pipe its \`undo\` into ${inlineCommand(
            shellCommand(['agent-gmail', 'organise-undo', '--inbox', result.inbox], platform),
          )}.`,
      ),
    );
  } else {
    lines.push(paint(color, 'dim', 'Nothing to put back: every message already had these labels.'));
  }
  return lines.join('\n');
}

export function renderTrash(result: TrashResult, color: boolean): string {
  const count = `${result.messages.length} message${result.messages.length === 1 ? '' : 's'}`;
  const verb = result.action === 'trash' ? 'Moved' : 'Restored';
  const where = result.action === 'trash' ? 'to the bin' : 'from the bin';
  // The preview has to name the operation it is previewing. This branch hard-coded "to the bin" while `result.action`
  // already said `untrash`, so someone recovering from a bad bulk bin — exactly the person who runs a dry run first —
  // was told their restore would bin forty more messages. The preview is the one place that claim gets checked.
  if (result.dryRun) {
    const would = result.action === 'trash' ? 'move' : 'restore';
    return `Would ${would} ${count} ${where} in ${result.inbox}.\n${paint(color, 'dim', 'Nothing was changed.')}`;
  }
  return [
    `${verb} ${count} ${where} in ${result.inbox}.`,
    paint(color, 'dim', 'Gmail keeps a binned message for thirty days; nothing is deleted outright.'),
  ].join('\n');
}

export function renderSendPreparation(
  result: SendPreparation,
  color: boolean,
  platform: NodeJS.Platform = process.platform,
): string {
  // The preview verbatim, then what has to happen: reformatting the preview would mean the thing shown is not the
  // thing the digest was taken over.
  const lines = [result.preview, ''];
  if (result.riskFlags.length > 0) {
    lines.push(paint(color, 'yellow', `! raised to "confirm": ${result.riskFlags.join(', ')}`));
  }
  lines.push(
    paint(color, 'dim', `Approval ${result.approvalId}, good until ${result.expiresAt.slice(11, 16)} UTC.`),
    result.nextStep,
    paint(color, 'dim', `Then: ${commandText(sendExecuteCommand(result, platform))}`),
  );
  return lines.join('\n');
}

function sendExecuteCommand(result: SendPreparation, platform: NodeJS.Platform) {
  const recipients = (flag: string, values: readonly string[]) => [flag, ...(values.length > 0 ? values : ['none'])];
  return shellCommand(
    [
      'agent-gmail',
      'send',
      'execute',
      result.draftId,
      '--inbox',
      result.inbox,
      '--approval',
      result.approvalId,
      ...recipients('--expect-to', result.expect.to),
      ...recipients('--expect-cc', result.expect.cc),
      ...recipients('--expect-bcc', result.expect.bcc),
      '--expect-subject',
      result.expect.subject || 'none',
    ],
    platform,
  );
}

export function renderSent(result: SendResult, color: boolean): string {
  const lines = [
    `Sent to ${result.to.join(', ') || '(nobody in To)'}${result.cc.length > 0 ? ` · cc ${result.cc.join(', ')}` : ''}.`,
    paint(color, 'dim', `Message ${result.sentMessageId} in ${result.inbox}, approval ${result.approvalId}.`),
  ];
  if (result.verified) {
    lines.push(
      paint(
        color,
        'dim',
        `Read back from the mailbox: ${result.verified.labelIds.join(', ') || 'no labels'}${
          result.verified.threadId ? ` · conversation ${result.verified.threadId}` : ''
        }.`,
      ),
    );
  } else {
    lines.push(paint(color, 'yellow', 'The message was sent but could not be read back to confirm where it landed.'));
  }
  if (result.note) lines.push(paint(color, 'yellow', `Note: ${result.note}.`));
  return lines.join('\n');
}

export function renderApprovals(records: ApprovalView[], color: boolean): string {
  if (records.length === 0) return 'No approvals waiting.';
  return table(
    [
      ['APPROVAL', 'INBOX', 'STATE', 'DRAFT', 'TO', 'EXPIRES'],
      ...records.map((record) => [
        record.approvalId,
        record.inbox,
        record.state,
        record.draftId,
        record.expect.to.join(', ') || '—',
        record.expiresAt.slice(11, 16),
      ]),
    ],
    color,
  );
}

/**
 * How each kind of downloaded client file is named to a person.
 *
 * Shared, because two surfaces show it and they had drifted: the list you choose from called a web client "will
 * be refused" while the plan printed beside it called the same file "not usable" — two wordings for one problem,
 * reading like two problems with two different fixes. Keyed loosely because the renderer takes a plain shape and
 * an unknown kind is better described than dropped.
 */
export const CLIENT_KIND_LABEL: Record<string, string> = {
  desktop: 'Desktop app',
  web: 'Web application — will be refused',
  unreadable: 'Not a client JSON — will be refused',
};

/**
 * The setup, written out for somebody who cannot be prompted — an agent, a pipe, `--json`.
 *
 * Every step here needs a browser this code does not drive: the console, and Google's consent screen. So the answer for a
 * non-interactive caller is the instructions rather than a refusal, and rather than half-running something that
 * will stop at the first question.
 */
export function renderSetupPlan(
  state: {
    next: string;
    done: readonly string[];
    clients: string[];
    inboxes: string[];
    registeredWith: string[];
    clientChoice?: {
      name: string;
      organisation?: string | undefined;
      organisationLabel?: string | undefined;
    } | null;
    candidates: { path: string; kind: string; modifiedAt: string }[];
    /** What this run changed, when it was driven by flags rather than by questions. */
    did?: readonly string[] | undefined;
    /** What a step it ran had to warn about: a pin the MCP install kept, another Gmail server. */
    warnings?: readonly string[] | undefined;
    /** Why it stopped, if it did — with the preview, when what it waits for is a person approving a change. */
    blocked?:
      | { step: string; needs: string; hint?: string | undefined; preview?: string | undefined }
      | null
      | undefined;
    /**
     * The link and the command, when the only thing left is a person approving it — and the registration the finish
     * will go on to ask for, when `--mcp-client` came with the mailbox.
     */
    handoff?: { authUrl: string; finish: string; registerWith?: RegistrationIntent | undefined } | null | undefined;
    /** A name the config accepts, for the examples: `acme/gmail` once names are organisation/platform. */
    nameExample?: string | undefined;
  },
  steps: readonly { title: string; url: string; why: string; actions: readonly string[]; avoid: readonly string[] }[],
  color: boolean,
  platform: NodeJS.Platform = process.platform,
): string {
  const lines: string[] = [];

  // What this run actually changed, before anything about what is left. A caller that supplied flags did not ask
  // for a plan and needs to know what happened first.
  for (const action of state.did ?? []) lines.push(`${paint(color, 'green', 'done')} ${action}`);
  for (const warning of state.warnings ?? []) lines.push(paint(color, 'red', warning));
  if ((state.did ?? []).length + (state.warnings ?? []).length > 0) lines.push('');

  if (state.handoff) {
    lines.push(paint(color, 'bold', 'This step needs a browser.'));
    lines.push("Consent happens on Google's own screen, and this command cannot grant it. Show them this link:");
    lines.push('');
    lines.push(`  ${state.handoff.authUrl}`);
    lines.push('');
    lines.push('Then, once the browser flow has returned a grant:');
    lines.push(`  ${state.handoff.finish}`);
    // Said here because this is the step that stops before it: `--mcp-client` is not forgotten, it moves to the finish.
    if (state.handoff.registerWith) {
      lines.push(
        `Finishing it will also register the Gmail server with ${state.handoff.registerWith.client}, after the person approves the registration.`,
      );
    }
    return lines.join('\n');
  }

  /*
   * A registration waiting for a person, before "Already set up": a machine registered with one client and asked to
   * register with another is `done` by the state's count, and the one thing to say is what the person must read.
   */
  if (state.blocked?.preview) {
    lines.push(paint(color, 'bold', `Stopped at: ${state.blocked.step}`));
    lines.push(`Needs ${state.blocked.needs}.`);
    lines.push('');
    lines.push(state.blocked.preview);
    if (state.blocked.hint) lines.push('', state.blocked.hint);
    return lines.join('\n');
  }

  if (state.next === 'done') {
    lines.push('Already set up.');
    lines.push(`  mailboxes: ${state.inboxes.join(', ')}`);
    lines.push(`  registered with: ${state.registeredWith.join(', ')}`);
    return lines.join('\n').trimStart();
  }

  if (state.blocked) {
    lines.push(`${paint(color, 'bold', `Stopped at: ${state.blocked.step}`)}`);
    lines.push(`Needs ${state.blocked.needs}.`);
    if (state.blocked.hint) lines.push(paint(color, 'dim', state.blocked.hint));
    lines.push('');
  }

  lines.push(paint(color, 'bold', 'Setup, for a terminal with a person at it'));
  lines.push('');
  lines.push('Run `agent-gmail setup` where you can answer questions and open a browser — or supply the answers');
  lines.push('as flags and it will run without one, as far as the consent screen.');
  lines.push('');
  if (state.done.length > 0) lines.push(`Already done: ${state.done.join(', ')}.`);

  if (state.clientChoice?.organisation && state.clientChoice.organisationLabel) {
    lines.push('');
    lines.push(`Your organisation, ${state.clientChoice.organisationLabel}, provides the Google client.`);
  }

  if (state.next === 'client') {
    lines.push('');
    lines.push(paint(color, 'bold', 'A Google OAuth client — once per person, covers every mailbox'));
    for (const [index, step] of steps.entries()) {
      lines.push('');
      lines.push(`  ${index + 1}. ${step.title}`);
      lines.push(`     ${paint(color, 'dim', step.why)}`);
      lines.push(`     ${paint(color, 'dim', step.url)}`);
      for (const action of step.actions) lines.push(`       • ${action}`);
      for (const warning of step.avoid) lines.push(`       ! ${warning}`);
    }
    lines.push('');
    lines.push('  Then: agent-gmail setup --client-json <the downloaded JSON>');
    for (const candidate of state.candidates) {
      const note = CLIENT_KIND_LABEL[candidate.kind] ?? candidate.kind;
      lines.push(`  ${paint(color, 'dim', `found: ${candidate.path} (${note}, ${candidate.modifiedAt})`)}`);
    }
  }

  if (state.inboxes.length === 0) {
    lines.push('');
    lines.push(paint(color, 'bold', 'A mailbox'));
    // `setup`'s own flags, because this is `setup`'s own output. It named `inbox add … --start` — a real command,
    // but a different one, so the text told you to leave the thing you were running while `blocked.needs` beside
    // it correctly said `--inbox <alias>`. Two answers to one question, in the same document.
    lines.push(
      `  ${commandText(
        shellCommand(
          ['agent-gmail', 'setup', '--inbox', state.nameExample ?? 'work', '--email', 'you@example.com'],
          platform,
        ),
      )}`,
    );
    lines.push('  then run the --finish command it prints, after signing in.');
  }

  if (state.registeredWith.length === 0) {
    lines.push('');
    lines.push(paint(color, 'bold', 'The agent connection'));
    lines.push('  agent-gmail mcp install --client claude-code');
  }

  return lines.join('\n').trimEnd();
}

// Moved to `@agentcomms/core` when Slack needed the same renderer; re-exported so callers here are unchanged.
export { renderInstall, renderPrune } from '@agentcomms/core';
