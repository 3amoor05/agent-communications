import {
  CommsError,
  type Handoff,
  isCommand,
  type Remedy,
  remedy,
  secretsStoreOf,
  toCommsError,
} from '@agentcomms/core';
import { keyPermissionOf, type NamedAccount } from '../accounts.ts';
import { resendRequest } from '../api/client.ts';
import type { ResendContext } from '../context.ts';
import { guaranteeOf } from './accounts.ts';

/**
 * What works, what does not, and — stated plainly on every run — who enforces what.
 *
 * Resend has no read-only key. So the doctor says, first and whatever else it finds, that read mode is this package's
 * own promise rather than the key's: a person deciding how much to trust an agent with a full-access key should not
 * have to find that out from the source.
 */

export const READ_ONLY_STATEMENT =
  'Read-only is enforced by agent-resend’s own code, not by the key: Resend has no read-only API key, and a full-access key can also send, delete domains and create keys. A sending-only key can only send; Resend enforces that one.';

export interface DoctorCheck {
  name: string;
  ok: boolean;
  detail: string;
  /**
   * What to run: this installation's commands, or core's — each located, or why there is none here — and the words
   * around them (`remedy`).
   */
  fix?: Remedy | undefined;
}

/** Two commands to run one after the other, as a fix: both located, or the reason there is none — said once. */
function thenFix(first: Handoff, second: Handoff): Remedy {
  if (!isCommand(first)) return remedy(first);
  if (!isCommand(second)) return remedy(second);
  return remedy([first, ', then ', second]);
}

export interface AccountDoctor {
  name: string;
  key: string;
  mode: string;
  guarantee: string;
  checks: DoctorCheck[];
}

export interface DoctorResult {
  healthy: boolean;
  readOnly: string;
  checks: DoctorCheck[];
  accounts: AccountDoctor[];
}

async function checkAccount(context: ResendContext, named: NamedAccount, offline: boolean): Promise<AccountDoctor> {
  const checks: DoctorCheck[] = [];
  let key: string | null = null;
  try {
    key = await (await context.secrets()).get(named.account.secretRef);
    checks.push(
      key
        ? { name: 'key stored', ok: true, detail: 'the key is in the secret store' }
        : {
            name: 'key stored',
            ok: false,
            detail: 'the key is missing from the secret store',
            fix: thenFix(
              context.handoffs.own(['account', 'remove', named.name]),
              context.handoffs.own(['account', 'add', named.name]),
            ),
          },
    );
  } catch (error) {
    checks.push({
      name: 'key stored',
      ok: false,
      detail: toCommsError(error).message,
      fix: remedy(context.handoffs.core(['doctor'])),
    });
  }
  const blocked = await context.throttle().blockedUntil();
  checks.push(
    blocked
      ? {
          name: 'rate limit',
          ok: true,
          detail: `Resend asked for no requests until ${blocked}; nothing is asked until then`,
        }
      : {
          name: 'rate limit',
          ok: true,
          detail: 'not held off; at most 2 requests a second from this machine, across every account',
        },
  );
  if (!offline && key && !blocked) {
    try {
      const page = await resendRequest<{ data?: { status?: unknown }[] }>(
        await context.transport(named),
        'GET',
        '/domains',
      );
      const domains = page.data ?? [];
      const verified = domains.filter((domain) => domain.status === 'verified').length;
      if (keyPermissionOf(named.account) === 'sending_access') {
        checks.push({
          name: 'key permission',
          ok: false,
          detail: 'recorded as sending-only, but Resend let it read — it has full access',
          fix: remedy(`remove and add ${named.name} again so its permission is recorded as it is`),
        });
      } else {
        checks.push({ name: 'key works', ok: true, detail: `${domains.length} domain(s), ${verified} verified` });
      }
    } catch (error) {
      const comms = toCommsError(error);
      if (comms.details?.resendError === 'restricted_api_key' && comms.code === 'SCOPE_MISSING') {
        checks.push(
          keyPermissionOf(named.account) === 'sending_access'
            ? { name: 'key works', ok: true, detail: 'a sending-only key: reads are unavailable by design' }
            : {
                name: 'key permission',
                ok: false,
                detail: 'recorded as full access, but Resend now refuses it every read',
                fix: remedy(`remove and add ${named.name} again with the key you mean`),
              },
        );
      } else {
        checks.push({
          name: 'key works',
          ok: false,
          detail: comms.message,
          ...(comms.hint ? { fix: remedy(comms.hint) } : {}),
        });
      }
    }
  }
  return {
    name: named.name,
    key: keyPermissionOf(named.account),
    mode: named.account.mode,
    guarantee: guaranteeOf(named.account),
    checks,
  };
}

export async function runDoctor(
  context: ResendContext,
  options: { account?: string | undefined; offline?: boolean | undefined } = {},
): Promise<DoctorResult> {
  const checks: DoctorCheck[] = [];
  const major = Number(process.versions.node.split('.')[0]);
  const minor = Number(process.versions.node.split('.')[1]);
  const nodeOk = major > 22 || (major === 22 && minor >= 12);
  checks.push({
    name: 'node',
    ok: nodeOk,
    detail: `Node ${process.versions.node}`,
    ...(nodeOk ? {} : { fix: remedy('Install Node 22.12 or newer.') }),
  });
  let store = 'unknown';
  try {
    store = secretsStoreOf(await context.config());
    checks.push({ name: 'config', ok: true, detail: `secrets are kept in the ${store} store` });
  } catch (error) {
    checks.push({
      name: 'config',
      ok: false,
      detail: toCommsError(error).message,
      fix: remedy(context.handoffs.core(['doctor'])),
    });
  }
  let named: NamedAccount[] = [];
  try {
    named = options.account ? [await context.accounts.require(options.account)] : await context.accounts.list();
    checks.push({ name: 'accounts', ok: true, detail: `${named.length} Resend account(s)` });
  } catch (error) {
    if (error instanceof CommsError && error.code === 'NOT_FOUND') throw error;
    checks.push({ name: 'accounts', ok: false, detail: toCommsError(error).message });
  }
  const accounts: AccountDoctor[] = [];
  for (const account of named) accounts.push(await checkAccount(context, account, options.offline === true));
  const healthy = checks.every((check) => check.ok) && accounts.every((account) => account.checks.every((c) => c.ok));
  return { healthy, readOnly: READ_ONLY_STATEMENT, checks, accounts };
}
