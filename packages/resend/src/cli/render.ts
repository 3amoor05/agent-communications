import { escapeForDisplay, paint, truncateDisplay } from '@agentcomms/core';
import type { AccountView, AddedAccount, PolicyReport, RemovedAccount } from '../operations/accounts.ts';
import type { DoctorResult } from '../operations/doctor.ts';
import type { Readable } from '../operations/read.ts';
import type { CancelledEmail } from '../operations/scheduled.ts';
import type { SendPreparation, SendResult, SendStatus } from '../operations/send.ts';

/**
 * What a person reads at the terminal. `--json` prints the whole result instead; nothing here is the only place a
 * fact is shown. Everything that came from Resend or from a sender passes through core's escaper, so no byte of it
 * can move a cursor or repaint a line.
 */

const show = (value: unknown): string => escapeForDisplay(value === null || value === undefined ? '—' : String(value));

export function renderAccount(view: AccountView, color: boolean): string {
  return [
    paint(color, 'bold', view.name),
    `  id          ${view.id}`,
    `  key         ${view.key === 'full_access' ? 'full access' : 'sending only'}${view.domainLock ? ` (declared: ${view.domainLock})` : ''}`,
    `  mode        ${view.mode}${view.canSend ? '' : ' — cannot send'}`,
    `  send policy ${view.sendPolicy}${view.sendPolicyFrom === 'default' ? ' (the machine default)' : ''}`,
    `  ${view.guarantee}`,
  ].join('\n');
}

export function renderAccounts(result: { accounts: AccountView[] }, color: boolean): string {
  if (result.accounts.length === 0)
    return 'No Resend account yet. A person adds one with `agent-resend account add <org/resend>`.';
  return result.accounts.map((view) => renderAccount(view, color)).join('\n\n');
}

export function renderAdded(view: AddedAccount, color: boolean): string {
  const domains = view.domains.map((domain) => `  ${show(domain.name)}  ${show(domain.status)}`);
  return [
    paint(color, 'green', `Connected ${view.name}.`),
    renderAccount(view, color),
    ...(domains.length > 0 ? ['Domains:', ...domains] : []),
  ].join('\n');
}

export function renderRemoved(result: RemovedAccount): string {
  return `Removed ${result.name}; its key is gone from this machine.${
    result.approvalsVoided.length > 0 ? ` ${result.approvalsVoided.length} waiting approval(s) voided.` : ''
  }`;
}

export function renderPolicy(report: PolicyReport): string {
  return [
    `${report.name}: ${report.mode} mode, send policy ${report.sendPolicy}${report.sendPolicyFrom === 'default' ? ' (the machine default)' : ''}`,
    `Changes to it are approved under the machine's change policy: ${report.changePolicy}.`,
    `A send to more than ${report.confirmAboveRecipients} people needs a person at a terminal, whatever the policy.`,
  ].join('\n');
}

export function renderDoctor(result: DoctorResult, color: boolean): string {
  const line = (check: { ok: boolean; name: string; detail: string; fix?: string | undefined }) =>
    `${check.ok ? paint(color, 'green', 'ok ') : paint(color, 'red', 'no ')} ${check.name}: ${show(check.detail)}${
      check.fix ? `\n     fix: ${show(check.fix)}` : ''
    }`;
  return [
    paint(color, 'bold', result.readOnly),
    '',
    ...result.checks.map(line),
    ...result.accounts.flatMap((account) => [
      '',
      paint(color, 'bold', `${account.name} (${account.key}, ${account.mode})`),
      `  ${account.guarantee}`,
      ...account.checks.map((check) => `  ${line(check)}`),
    ]),
  ].join('\n');
}

/** Any read result: unavailable said plainly, otherwise the data as indented JSON-ish lines. */
export function renderRead(result: Readable<object>, color: boolean): string {
  if (!result.available) return `${paint(color, 'yellow', 'Not available')} for ${result.account}: ${result.reason}`;
  const { account: _account, available: _available, ...data } = result as Record<string, unknown>;
  return escapeForDisplay(JSON.stringify(data, null, 2));
}

export function renderPrepared(result: SendPreparation): string {
  return `${result.preview}\n\nNext: ${escapeForDisplay(result.nextStep)}`;
}

export function renderSent(result: SendResult): string {
  return result.state === 'scheduled'
    ? `Scheduled for ${result.scheduledAt ?? '?'} as ${result.resendId}, to ${truncateDisplay(result.to.join(', '), 200)}.`
    : `Sent as ${result.resendId}, to ${truncateDisplay(result.to.join(', '), 200)}.`;
}

export function renderStatus(result: SendStatus): string {
  return `${result.approvalId}: ${escapeForDisplay(result.verdict)}`;
}

export function renderCancelled(result: CancelledEmail): string {
  return `Cancelled ${result.id} (${result.recipients} recipient(s)). It cannot be rescheduled.`;
}
