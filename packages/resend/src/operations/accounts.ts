import { createHash } from 'node:crypto';
import {
  type ChangePolicy,
  CommsError,
  type Config,
  classifyChange,
  type GatedChange,
  type SendPolicy,
  secretsStoreFor,
  secretsStoreOf,
  withCredentialsLock,
} from '@agentcomms/core';
import {
  accountById,
  CHANGE_POLICIES,
  changePolicyIn,
  checkNewName,
  type KeyPermission,
  keyPermissionOf,
  MODES,
  type Mode,
  type NamedAccount,
  newResendAccountId,
  PLATFORM,
  type ResendAccount,
  requireAccount,
  resendAccounts,
  SEND_POLICIES,
  secretRefFor,
  sendPolicyIn,
  withAccount,
  withoutAccount,
} from '../accounts.ts';
import { resendRequest } from '../api/client.ts';
import { REACH_CONFIRM_THRESHOLD } from '../compose/message.ts';
import type { ResendContext } from '../context.ts';

/**
 * Connecting, inspecting, re-policing and removing Resend accounts.
 *
 * An account is one Resend API key for one team, named `org/resend`, kept in core's configuration (see
 * `accounts.ts`). The key is typed into a terminal by a person (`account add`, CLI only — a key typed into a chat
 * stays in the transcript) and goes straight into core's secret store. Everything else here is reachable from both
 * surfaces. Each change is a `GatedChange` over the configuration as it stands, so core's flow decides who has to
 * agree: `classifyChange` says what loosens, and the account's own change policy — or the machine's — says how it is
 * approved. A change that cannot be taken back, removing an account, asks too.
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
export async function inspectKey(context: ResendContext, key: string): Promise<KeyInspection> {
  try {
    const page = await resendRequest<{ data?: { name?: unknown; status?: unknown }[] }>(
      context.transportForKey(key),
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
  /** How a change that loosens this account is approved: in the chat, or by a code typed at a terminal. */
  changePolicy: ChangePolicy;
  changePolicyFrom: 'account' | 'default';
  domainLock?: string | undefined;
  canRead: boolean;
  canSend: boolean;
  createdAt: string;
  /** Who enforces what, in words. Read mode is this package's own promise, never the key's. */
  guarantee: string;
}

/** The plain statement `account show` and `doctor` make about who enforces what. */
export function guaranteeOf(account: ResendAccount): string {
  if (keyPermissionOf(account) === 'sending_access') {
    const lock = account.domainLock
      ? ` It was declared restricted to ${account.domainLock} when it was added; that is not something agent-resend can check without sending, so Resend enforces it, not this package.`
      : '';
    return `This key can only send: Resend enforces that, and refuses it every read.${lock} agent-resend still sends only after a person approves each email.`;
  }
  return account.mode === 'read'
    ? 'Read-only is enforced by agent-resend’s own code, not by the key. Resend has no read-only key: this full-access key could send mail, delete domains and create API keys in anything else that held it. agent-resend refuses every send from this account while it is in read mode.'
    : 'This full-access key can do anything at Resend. agent-resend sends only after a person approves each email, and never manages domains, keys or webhooks — but the key itself would not stop anything else that held it.';
}

export function viewOf(named: NamedAccount, config: Config): AccountView {
  const { account } = named;
  const sendPolicy = sendPolicyIn(config, account);
  return {
    name: named.name,
    id: account.id,
    key: keyPermissionOf(account),
    mode: account.mode,
    sendPolicy,
    sendPolicyFrom: account.sendPolicy === undefined ? 'default' : 'account',
    changePolicy: changePolicyIn(config, account),
    changePolicyFrom: account.changePolicy === undefined ? 'default' : 'account',
    ...(account.domainLock ? { domainLock: account.domainLock } : {}),
    canRead: keyPermissionOf(account) === 'full_access',
    canSend: account.mode === 'send' && sendPolicy !== 'never',
    createdAt: account.createdAt,
    guarantee: guaranteeOf(account),
  };
}

export async function listAccounts(context: ResendContext): Promise<{ accounts: AccountView[] }> {
  const config = await context.config();
  return { accounts: resendAccounts(config).map((named) => viewOf(named, config)) };
}

export async function showAccount(context: ResendContext, name: string): Promise<AccountView> {
  const config = await context.config();
  return viewOf(requireAccount(config, name), config);
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

export function changePolicyOf(raw: unknown): ChangePolicy | undefined {
  if (raw === undefined) return undefined;
  if (typeof raw === 'string' && (CHANGE_POLICIES as readonly string[]).includes(raw)) return raw as ChangePolicy;
  throw new CommsError('USAGE', `"${String(raw)}" is not a change policy: use chat or confirm`);
}

/** Refuses a key that is already connected, under any name: one key, one account. */
function refuseConnectedKey(config: Config, fingerprint: string): void {
  const same = resendAccounts(config).find((named) => named.account.workspace === fingerprint);
  if (same) {
    throw new CommsError('USAGE', `this key is already connected as "${same.name}"`, {
      hint: 'One key, one account. Change that one with `agent-resend account policy`.',
    });
  }
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
 * Connects an account, once the key has been inspected — a `GatedChange`, so connecting one in `send` mode, or with
 * a send policy looser than the machine's, is a change a person approves, as connecting a Slack workspace in `send`
 * is. In `read` mode it loosens nothing and is applied at once.
 *
 * `inspection` is passed in rather than made here, because it is a network call and `plan` runs twice.
 */
export function addAccountChange(
  context: ResendContext,
  request: AddRequest,
  inspection: KeyInspection,
): GatedChange<AddedAccount> {
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
  // Built once: `plan` runs on both calls of an approved change, and the account approved is the one written.
  const account: ResendAccount = {
    id,
    platform: PLATFORM,
    workspace: fingerprint,
    userId: fingerprint,
    tier: mode,
    mode,
    grantedScopes: [inspection.permission],
    secretRef: secretRefFor(id),
    ...(request.sendPolicy === undefined ? {} : { sendPolicy: request.sendPolicy }),
    createdAt: context.now().toISOString(),
    ...(domainLock ? { domainLock } : {}),
  };
  const connect = (config: Config): Config => {
    checkNewName(config, request.name);
    refuseConnectedKey(config, fingerprint);
    return withAccount(config, request.name, account);
  };

  return {
    plan: (config) => {
      const after = connect(config);
      const loosens = classifyChange(config, after).loosened.length > 0;
      return {
        account: request.name,
        before: config,
        after,
        summary: `Connect ${request.name} to Resend with a ${inspection.permission === 'full_access' ? 'full-access' : 'sending-only'} key in ${mode} mode`,
        // The key is stored either way; said when a person is asked, so what they agree to is the whole of it.
        effects: loosens ? [`stores the key for ${request.name} in this machine's secret store`] : [],
      };
    },
    apply: async (consent) => {
      const config = await context.config();
      const { store, choosing } = secretsStoreFor(config, undefined);
      const secrets = await context.core.secrets(store);
      await secrets.set(account.secretRef, request.key.trim());
      let written: Config;
      try {
        written = await context.core.config.update(
          (current) => {
            const next = connect(current);
            // The first secret this configuration stores chooses its store, in the same write.
            return choosing && current.secrets === undefined ? { ...next, secrets: { store } } : next;
          },
          consent ? { consent } : {},
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
        reason: `${inspection.permission} key, ${account.mode} mode`,
      });
      return { ...viewOf({ name: request.name, account }, written), domains: inspection.domains };
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

/**
 * Removing an account: a change approval, because a deleted key cannot be taken back — and bound to the account that
 * was shown, so a remove and an add in between, under the same name, removes nothing.
 */
export function removeAccountChange(context: ResendContext, name: string): GatedChange<RemovedAccount> {
  return {
    plan: (config) => {
      const found = requireAccount(config, name);
      return {
        account: found.name,
        before: config,
        after: withoutAccount(config, found.name),
        summary: `Remove the Resend account ${found.name}`,
        effects: [
          `deletes the key for ${found.name} (${found.account.id}) from this machine's secret store, and forgets the account; adding it back needs the key again`,
        ],
      };
    },
    apply: async (_consent, request) => {
      const approved = requireAccount(request.before, name).account;
      /*
       * Under the credentials lock, from reading the configuration to the last write, as Slack's removal is: a
       * `secrets migrate` running in between would copy a key this is deleting into a store nothing then names.
       */
      const removed = await withCredentialsLock(context.core.paths.configDir, async () => {
        const found = requireAccount(await context.config(), name);
        if (found.account.id !== approved.id) {
          throw new CommsError('CONFIG', `"${name}" changed after its removal was approved, so nothing was removed`, {
            hint: `Look at it with \`agent-resend account show ${name}\`, and remove it again if you still want it gone.`,
          });
        }
        // The key first: an entry whose key is gone is reported by `doctor`; a key nothing names is never found.
        const secrets = await context.secrets();
        await secrets.delete(found.account.secretRef).catch(() => false);
        await context.core.config.update((current) => {
          if (secretsStoreOf(current) !== secrets.kind) {
            throw new CommsError('TRANSIENT', `the secret store changed while "${name}" was being removed`, {
              hint: `Run \`agent-resend account remove ${name}\` again.`,
            });
          }
          const held = accountById(current, found.account.id);
          if (!held) return current;
          return withoutAccount(current, held.name);
        });
        return found;
      });
      const voided: string[] = [];
      for (const record of await context.core.approvals.list({
        inboxId: removed.account.id,
        states: ['pending', 'approved'],
      })) {
        await context.core.approvals.revoke(record.approvalId, 'the account was removed');
        voided.push(record.approvalId);
      }
      await context.core.audit.append({
        inboxId: removed.account.id,
        alias: removed.name,
        operation: 'resend.account.remove',
        outcome: 'ok',
        surface: context.surface,
        ...(voided.length > 0 ? { ids: { approvalIds: voided } } : {}),
      });
      return { name: removed.name, id: removed.account.id, removed: true, approvalsVoided: voided };
    },
  };
}

// ── account policy ───────────────────────────────────────────────────────────────────────────────────────────────

export interface PolicyWanted {
  send?: SendPolicy | undefined;
  mode?: Mode | undefined;
  change?: ChangePolicy | undefined;
}

export function policyWanted(raw: { send?: unknown; mode?: unknown; change?: unknown }): PolicyWanted {
  return { send: sendPolicyOf(raw.send), mode: modeOf(raw.mode), change: changePolicyOf(raw.change) };
}

export interface PolicyReport {
  name: string;
  mode: Mode;
  sendPolicy: SendPolicy;
  sendPolicyFrom: 'account' | 'default';
  /** The change policy that decides how a loosening of this account is approved: its own, or the machine's. */
  changePolicy: ChangePolicy;
  changePolicyFrom: 'account' | 'default';
  /** Reach above which a send needs a person at a terminal whatever the send policy says. */
  confirmAboveRecipients: number;
}

function reportOf(named: NamedAccount, config: Config): PolicyReport {
  const { account } = named;
  return {
    name: named.name,
    mode: account.mode,
    sendPolicy: sendPolicyIn(config, account),
    sendPolicyFrom: account.sendPolicy === undefined ? 'default' : 'account',
    changePolicy: changePolicyIn(config, account),
    changePolicyFrom: account.changePolicy === undefined ? 'default' : 'account',
    confirmAboveRecipients: REACH_CONFIRM_THRESHOLD,
  };
}

export async function policyReport(context: ResendContext, name: string): Promise<PolicyReport> {
  const config = await context.config();
  return reportOf(requireAccount(config, name), config);
}

/**
 * Setting an account's send policy, mode or change policy. Tightening applies at once; loosening — a send policy
 * towards `chat`, `read → send`, a change policy `confirm → chat` — is a change approval, bound to the exact values
 * and decided by the change policy in force before it, so a policy cannot be used to approve its own relaxation.
 */
export function policyChange(context: ResendContext, name: string, wanted: PolicyWanted): GatedChange<PolicyReport> {
  const next = (account: ResendAccount): ResendAccount => ({
    ...account,
    ...(wanted.send === undefined ? {} : { sendPolicy: wanted.send }),
    ...(wanted.mode === undefined ? {} : { mode: wanted.mode, tier: wanted.mode }),
    ...(wanted.change === undefined ? {} : { changePolicy: wanted.change }),
  });
  const checked = (named: NamedAccount): NamedAccount => {
    if (wanted.mode === 'read' && keyPermissionOf(named.account) === 'sending_access') {
      throw new CommsError('USAGE', 'this account’s key can only send, so it cannot be put in read mode', {
        hint: 'To stop it sending, set --send never.',
      });
    }
    return named;
  };
  const said = [
    wanted.send === undefined ? '' : `send policy ${wanted.send}`,
    wanted.mode === undefined ? '' : `${wanted.mode} mode`,
    wanted.change === undefined ? '' : `change policy ${wanted.change}`,
  ]
    .filter(Boolean)
    .join(', ');
  return {
    plan: (config) => {
      const found = checked(requireAccount(config, name));
      return {
        account: found.name,
        before: config,
        after: withAccount(config, found.name, next(found.account)),
        summary: `Set ${found.name} to ${said}`,
      };
    },
    apply: async (consent, request) => {
      const approved = requireAccount(request.before, name).account;
      let written: NamedAccount | undefined;
      /*
       * By id, under whatever name it has at the write: a rename in between must not set the policy on an account
       * that took the old name, and an account that is gone is refused rather than recreated from the snapshot.
       */
      const config = await context.core.config.update(
        (current) => {
          const held = accountById(current, approved.id);
          if (!held) {
            throw new CommsError('CONFIG', `"${name}" changed while its policy was being set, so nothing was set`, {
              hint: 'Check it with `agent-resend account list`, then set the policy again.',
            });
          }
          written = { name: held.name, account: next(checked(held).account) };
          return withAccount(current, held.name, written.account);
        },
        consent ? { consent } : {},
      );
      const now = written ?? { name, account: next(approved) };
      await context.core.audit.append({
        inboxId: approved.id,
        alias: now.name,
        operation: 'resend.account.policy',
        outcome: 'ok',
        surface: context.surface,
        reason: said,
      });
      return reportOf(now, config);
    },
  };
}
