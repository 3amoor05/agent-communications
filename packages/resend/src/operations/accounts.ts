import { createHash } from 'node:crypto';
import {
  type ChangeRequest,
  CommsError,
  type Config,
  type GatedChange,
  type Loosening,
  type LooseningConsent,
  nameShapeProblem,
  type SendPolicy,
  secretsStoreFor,
} from '@agentcomms/core';
import {
  type AccountsFile,
  classifyAccountChange,
  type KeyPermission,
  MODES,
  type Mode,
  type NamedAccount,
  newResendAccountId,
  PLATFORM,
  type ResendAccount,
  refuseOwnChangePolicy,
  SEND_POLICIES,
  secretRefFor,
} from '../accounts.ts';
import { resendRequest } from '../api/client.ts';
import { REACH_CONFIRM_THRESHOLD } from '../compose/message.ts';
import type { ResendContext } from '../context.ts';

/**
 * Connecting, inspecting, re-policing and removing Resend accounts.
 *
 * An account is one Resend API key for one team, named `org/resend`. The key is typed into a terminal by a person
 * (`account add`, CLI only — a key typed into a chat stays in the transcript) and goes straight into core's secret
 * store. Everything else here is reachable from both surfaces, and everything that loosens or cannot be taken back is
 * a change approval through core's change flow.
 */

export interface KeyInspection {
  permission: KeyPermission;
  /** The team's domains, when the key could read them. */
  domains: { name: string; status: string }[];
}

/**
 * What a key can do, found by asking Resend for the team's domains.
 *
 * A `full_access` key answers. A `sending_access` key is refused with `401 restricted_api_key`, Resend's documented
 * answer for every non-send call. Anything else — an unknown, disabled or suspended key — is refused here, before
 * anything is stored. No send endpoint is ever touched to find out.
 */
export async function inspectKey(context: ResendContext, key: string, accountId: string): Promise<KeyInspection> {
  try {
    const page = await resendRequest<{ data?: { name?: unknown; status?: unknown }[] }>(
      context.transportForKey(key, accountId),
      'GET',
      '/domains',
    );
    return {
      permission: 'full_access',
      domains: (page.data ?? []).map((domain) => ({ name: String(domain.name ?? ''), status: String(domain.status) })),
    };
  } catch (error) {
    if (
      error instanceof CommsError &&
      error.details?.resendError === 'restricted_api_key' &&
      error.code === 'SCOPE_MISSING'
    ) {
      return { permission: 'sending_access', domains: [] };
    }
    throw error;
  }
}

/** A fingerprint of a key that says which key it is and nothing about it: 32 bits of its SHA-256. */
export function keyFingerprint(key: string): string {
  return `key_${createHash('sha256').update(key.trim()).digest('hex').slice(0, 8)}`;
}

export interface AccountView {
  name: string;
  id: string;
  /** What the key itself can do, as Resend detected it. */
  key: KeyPermission;
  mode: Mode;
  sendPolicy: SendPolicy;
  sendPolicyFrom: 'account' | 'default';
  domainLock?: string | undefined;
  canRead: boolean;
  canSend: boolean;
  createdAt: string;
  /** Who enforces what, in words. Read mode is this package's own promise, never the key's. */
  guarantee: string;
}

/** The plain statement `account show` and `doctor` make about who enforces what. */
export function guaranteeOf(account: ResendAccount): string {
  if (account.tier === 'sending_access') {
    const lock = account.domainLock
      ? ` It was declared restricted to ${account.domainLock} when it was added; that is not something agent-resend can check without sending, so Resend enforces it, not this package.`
      : '';
    return `This key can only send: Resend enforces that, and refuses it every read.${lock} agent-resend still sends only after a person approves each email.`;
  }
  return account.mode === 'read'
    ? 'Read-only is enforced by agent-resend’s own code, not by the key. Resend has no read-only key: this full-access key could send mail, delete domains and create API keys in anything else that held it. agent-resend refuses every send from this account while it is in read mode.'
    : 'This full-access key can do anything at Resend. agent-resend sends only after a person approves each email, and never manages domains, keys or webhooks — but the key itself would not stop anything else that held it.';
}

export function viewOf(named: NamedAccount, defaultPolicy: SendPolicy): AccountView {
  const { account } = named;
  return {
    name: named.name,
    id: account.id,
    key: account.tier,
    mode: account.mode,
    sendPolicy: account.sendPolicy ?? defaultPolicy,
    sendPolicyFrom: account.sendPolicy === undefined ? 'default' : 'account',
    ...(account.domainLock ? { domainLock: account.domainLock } : {}),
    canRead: account.tier === 'full_access',
    canSend: account.mode === 'send' && (account.sendPolicy ?? defaultPolicy) !== 'never',
    createdAt: account.createdAt,
    guarantee: guaranteeOf(account),
  };
}

export async function listAccounts(context: ResendContext): Promise<{ accounts: AccountView[] }> {
  const policy = await context.defaultSendPolicy();
  return { accounts: (await context.accounts.list()).map((named) => viewOf(named, policy)) };
}

export async function showAccount(context: ResendContext, name: string): Promise<AccountView> {
  return viewOf(await context.accounts.require(name), await context.defaultSendPolicy());
}

/** A mode word checked by the operation, so both surfaces refuse it in the same words. */
export function modeOf(raw: unknown): Mode | undefined {
  if (raw === undefined) return undefined;
  if (typeof raw === 'string' && (MODES as readonly string[]).includes(raw)) return raw as Mode;
  throw new CommsError('USAGE', `"${String(raw)}" is not a mode: use read or send`);
}

export function sendPolicyOf(raw: unknown): SendPolicy | undefined {
  if (raw === undefined) return undefined;
  if (typeof raw === 'string' && (SEND_POLICIES as readonly string[]).includes(raw)) return raw as SendPolicy;
  throw new CommsError('USAGE', `"${String(raw)}" is not a send policy: use chat, confirm or never`);
}

/** What a loosening means, in the words a preview uses. Bound into the approval, so it is deterministic. */
function describe(name: string, id: string | undefined, loosening: Loosening): string {
  const field = loosening.path.slice(`accounts.${name}.`.length);
  const who = id === undefined ? `${name} (connected by this change)` : `${name} (${id})`;
  const was = loosening.before ?? 'not set';
  const words =
    field === 'mode'
      ? 'it will be able to send mail, each email still previewed and approved'
      : field === 'sendPolicy'
        ? loosening.after === 'chat'
          ? 'a yes in the chat will be enough to send'
          : 'sending will be possible, with a code typed at a terminal'
        : 'a yes in the chat will be enough to loosen it';
  return `${who} ${field}: ${String(was)} → ${String(loosening.after)} — ${words}`;
}

/** The consent `AccountStore.update` asks for, for exactly these loosenings. Built only after a claim. */
function consentFor(loosened: readonly Loosening[]): LooseningConsent {
  return { kind: 'loosening-consent', paths: loosened.map((loosening) => loosening.path), changes: [...loosened] };
}

function unchanged(config: Config): Pick<ChangeRequest, 'before' | 'after'> {
  return { before: config, after: config };
}

// ── account add (CLI only) ───────────────────────────────────────────────────────────────────────────────────────

export interface AddRequest {
  name: string;
  key: string;
  mode?: Mode | undefined;
  sendPolicy?: SendPolicy | undefined;
  /** For a sending-only key: the domain it was restricted to in the dashboard, if it was. */
  domain?: string | undefined;
}

export interface AddedAccount extends AccountView {
  /** The team's domains the key could see, when it could see them. */
  domains: { name: string; status: string }[];
}

/**
 * Connects an account, once the key has been inspected — a `GatedChange`, so connecting one in `send` mode is a
 * change a person approves, as connecting a Slack workspace in `send` is. In `read` mode it loosens nothing and is
 * applied at once.
 *
 * `inspection` is passed in rather than made here, because it is a network call and `plan` runs twice.
 */
export function addAccountChange(
  context: ResendContext,
  request: AddRequest,
  inspection: KeyInspection,
): GatedChange<AddedAccount> {
  const problem = nameShapeProblem(request.name, PLATFORM);
  if (problem) throw new CommsError('USAGE', problem);
  const mode: Mode = request.mode ?? (inspection.permission === 'sending_access' ? 'send' : 'read');
  if (inspection.permission === 'sending_access' && mode === 'read') {
    throw new CommsError('USAGE', 'this key can only send, so an account with it cannot be in read mode', {
      hint: 'Leave out --mode, or use a full-access key for reading.',
    });
  }
  let domainLock: string | undefined;
  if (request.domain !== undefined) {
    if (inspection.permission !== 'sending_access') {
      throw new CommsError('USAGE', '--domain is only for a sending-only key restricted to one domain', {
        hint: 'A full-access key is not restricted to a domain; leave --domain out.',
      });
    }
    domainLock = request.domain.trim().toLowerCase();
    if (!/^[a-z0-9.-]+\.[a-z]{2,}$/.test(domainLock)) {
      throw new CommsError('USAGE', `"${request.domain}" is not a domain name`);
    }
  }
  const fingerprint = keyFingerprint(request.key);
  const id = newResendAccountId();

  const build = (): ResendAccount => ({
    id,
    platform: 'resend',
    workspace: fingerprint,
    userId: fingerprint,
    tier: inspection.permission,
    mode,
    grantedScopes: [domainLock ? `${inspection.permission}:${domainLock}` : inspection.permission],
    secretRef: secretRefFor(id),
    ...(request.sendPolicy === undefined ? {} : { sendPolicy: request.sendPolicy }),
    createdAt: context.now().toISOString(),
    ...(domainLock ? { domainLock } : {}),
  });

  const loosenedBy = async (file: AccountsFile, policy: SendPolicy): Promise<Loosening[]> => {
    return classifyAccountChange(file, { ...file, accounts: { ...file.accounts, [request.name]: build() } }, policy);
  };

  return {
    plan: async (config) => {
      const file = await context.accounts.load();
      if (Object.hasOwn(file.accounts, request.name)) {
        throw new CommsError('USAGE', `there is already a Resend account called "${request.name}"`, {
          hint: `Remove it first with \`agent-resend account remove ${request.name}\`, or choose another name.`,
        });
      }
      const same = Object.entries(file.accounts).find(([, account]) => account.workspace === fingerprint);
      if (same) {
        throw new CommsError('USAGE', `this key is already connected as "${same[0]}"`, {
          hint: 'One key, one account. Change that one with `agent-resend account policy`.',
        });
      }
      const loosened = await loosenedBy(file, config.defaults.sendPolicy);
      return {
        summary: `Connect ${request.name} to Resend with a ${inspection.permission === 'full_access' ? 'full-access' : 'sending-only'} key in ${mode} mode`,
        ...unchanged(config),
        effects: [
          ...loosened.map((loosening) => describe(request.name, undefined, loosening)),
          ...(loosened.length > 0 ? [`stores the key for ${request.name} in this machine's secret store`] : []),
        ],
      };
    },
    apply: async () => {
      const config = await context.config();
      const { store, choosing } = secretsStoreFor(config, undefined);
      const secrets = await context.core.secrets(store);
      const account = build();
      await secrets.set(account.secretRef, request.key.trim());
      if (choosing) await context.core.config.update((current) => ({ ...current, secrets: { store } }));
      try {
        const loosened = await loosenedBy(await context.accounts.load(), config.defaults.sendPolicy);
        await context.accounts.update(
          (file) => ({ ...file, accounts: { ...file.accounts, [request.name]: account } }),
          {
            defaultSendPolicy: config.defaults.sendPolicy,
            consent: consentFor(loosened),
          },
        );
      } catch (error) {
        // Nothing half-connected: a key with no account pointing at it is a key nothing can remove.
        await secrets.delete(account.secretRef).catch(() => undefined);
        throw error;
      }
      await context.core.audit.append({
        inboxId: account.id,
        alias: request.name,
        operation: 'resend.account.add',
        outcome: 'ok',
        surface: context.surface,
        reason: `${account.tier} key, ${account.mode} mode`,
      });
      return {
        ...viewOf({ name: request.name, account }, config.defaults.sendPolicy),
        domains: inspection.domains,
      };
    },
  };
}

// ── account remove ───────────────────────────────────────────────────────────────────────────────────────────────

export interface RemovedAccount {
  name: string;
  id: string;
  removed: true;
  /** Send approvals that were waiting on this account, now voided. */
  approvalsVoided: string[];
}

/** Removing an account: a change approval, because a deleted key cannot be taken back. */
export function removeAccountChange(context: ResendContext, name: string): GatedChange<RemovedAccount> {
  return {
    plan: async (config) => {
      const named = await context.accounts.require(name);
      refuseOwnChangePolicy(named);
      return {
        summary: `Remove the Resend account ${name}`,
        ...unchanged(config),
        effects: [
          `deletes the key for ${name} (${named.account.id}) from this machine's secret store, and forgets the account; adding it back needs the key again`,
        ],
      };
    },
    apply: async () => {
      const named = await context.accounts.require(name);
      const policy = await context.defaultSendPolicy();
      await context.accounts.update(
        (file) => {
          const accounts = { ...file.accounts };
          delete accounts[name];
          return { ...file, accounts };
        },
        { defaultSendPolicy: policy },
      );
      await (await context.secrets()).delete(named.account.secretRef).catch(() => false);
      const voided: string[] = [];
      for (const record of await context.core.approvals.list({
        inboxId: named.account.id,
        states: ['pending', 'approved'],
      })) {
        await context.core.approvals.revoke(record.approvalId, 'the account was removed');
        voided.push(record.approvalId);
      }
      await context.core.audit.append({
        inboxId: named.account.id,
        alias: name,
        operation: 'resend.account.remove',
        outcome: 'ok',
        surface: context.surface,
        ...(voided.length > 0 ? { ids: { approvalIds: voided } } : {}),
      });
      return { name, id: named.account.id, removed: true, approvalsVoided: voided };
    },
  };
}

// ── account policy ───────────────────────────────────────────────────────────────────────────────────────────────

export interface PolicyWanted {
  send?: SendPolicy | undefined;
  mode?: Mode | undefined;
}

export function policyWanted(raw: { send?: unknown; mode?: unknown }): PolicyWanted {
  return { send: sendPolicyOf(raw.send), mode: modeOf(raw.mode) };
}

export interface PolicyReport {
  name: string;
  mode: Mode;
  sendPolicy: SendPolicy;
  sendPolicyFrom: 'account' | 'default';
  /** The change policy that decides how a loosening of this account is approved: the machine's. */
  changePolicy: 'chat' | 'confirm';
  /** Reach above which a send needs a person at a terminal whatever the send policy says. */
  confirmAboveRecipients: number;
}

export async function policyReport(context: ResendContext, name: string): Promise<PolicyReport> {
  const named = await context.accounts.require(name);
  const config = await context.config();
  return {
    name,
    mode: named.account.mode,
    sendPolicy: named.account.sendPolicy ?? config.defaults.sendPolicy,
    sendPolicyFrom: named.account.sendPolicy === undefined ? 'default' : 'account',
    changePolicy: config.defaults.changePolicy ?? 'chat',
    confirmAboveRecipients: REACH_CONFIRM_THRESHOLD,
  };
}

/**
 * Setting an account's send policy or mode. Tightening applies at once; loosening — a send policy towards `chat`,
 * `read → send` — is a change approval, bound to the exact values.
 */
export function policyChange(context: ResendContext, name: string, wanted: PolicyWanted): GatedChange<PolicyReport> {
  const next = (account: ResendAccount): ResendAccount => ({
    ...account,
    ...(wanted.send === undefined ? {} : { sendPolicy: wanted.send }),
    ...(wanted.mode === undefined ? {} : { mode: wanted.mode }),
  });
  const measure = async (policy: SendPolicy) => {
    const file = await context.accounts.load();
    const named = await context.accounts.require(name);
    refuseOwnChangePolicy(named);
    if (wanted.mode === 'read' && named.account.tier === 'sending_access') {
      throw new CommsError('USAGE', 'this account’s key can only send, so it cannot be put in read mode', {
        hint: 'To stop it sending, set --send never.',
      });
    }
    const after = { ...file, accounts: { ...file.accounts, [name]: next(named.account) } };
    return { named, loosened: classifyAccountChange(file, after, policy) };
  };
  return {
    plan: async (config) => {
      const { named, loosened } = await measure(config.defaults.sendPolicy);
      const parts = [
        wanted.send === undefined ? '' : `send policy ${wanted.send}`,
        wanted.mode === undefined ? '' : `${wanted.mode} mode`,
      ].filter(Boolean);
      return {
        summary: `Set ${name} to ${parts.join(' and ')}`,
        ...unchanged(config),
        effects: loosened.map((loosening) => describe(name, named.account.id, loosening)),
      };
    },
    apply: async () => {
      const policy = await context.defaultSendPolicy();
      const { named, loosened } = await measure(policy);
      await context.accounts.update(
        (file) => ({ ...file, accounts: { ...file.accounts, [name]: next(named.account) } }),
        { defaultSendPolicy: policy, consent: consentFor(loosened) },
      );
      await context.core.audit.append({
        inboxId: named.account.id,
        alias: name,
        operation: 'resend.account.policy',
        outcome: 'ok',
        surface: context.surface,
        reason: [wanted.send ? `send ${wanted.send}` : '', wanted.mode ? `mode ${wanted.mode}` : '']
          .filter(Boolean)
          .join(', '),
      });
      return policyReport(context, name);
    },
  };
}
