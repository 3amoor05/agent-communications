import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import {
  type ChangePolicy,
  CommsError,
  type Loosening,
  type LooseningConsent,
  NAME_PATTERN,
  nameShapeProblem,
  newAccountId,
  type SendPolicy,
  withFileLock,
  writeFileAtomic,
} from '@agentcomms/core';
import { z } from 'zod';

/**
 * Where Resend accounts are kept — the one module that knows.
 *
 * **For now, a file of their own**, `resend-accounts.json` beside core's `config.json`. The channel contract gives
 * every new channel a generic record in core's `accounts` map; until core can hold one, this module holds exactly
 * that record, field for field (`id`, `platform`, `workspace`, `workspaceName?`, `userId`, `tier`, `mode`,
 * `grantedScopes`, `secretRef?`, `sendPolicy?`, `changePolicy?`, `createdAt`, plus Resend's own `domainLock?`), so
 * moving it is a change to this file and nothing else: every caller reaches accounts through `AccountStore`.
 *
 * It behaves the way core's `ConfigStore` does, because it holds the same kind of thing:
 *
 * - read-modify-write under a lock, the new file validated before it is written, atomically;
 * - **a loosening is refused unless the caller passes consent for exactly it** — connecting an account in `send`
 *   mode, moving `read → send`, a send policy towards `chat`, a change policy `confirm → chat`, and any mode word
 *   outside `read`/`send` (the contract's closed vocabulary: an unknown word is a loosening). Tightening never needs
 *   consent. The consent comes from a claimed change approval, as core's does.
 */

export const ACCOUNTS_FILE = 'resend-accounts.json';
export const PLATFORM = 'resend';

export const MODES = ['read', 'send'] as const;
export type Mode = (typeof MODES)[number];
export const KEY_PERMISSIONS = ['full_access', 'sending_access'] as const;
export type KeyPermission = (typeof KEY_PERMISSIONS)[number];
export const SEND_POLICIES = ['chat', 'confirm', 'never'] as const;

/** The generic account record, as the contract defines it, with Resend's one extra key. */
export interface ResendAccount {
  /** `acc_` + 16 characters, core's account id. Secrets, approvals, audit lines and state are keyed by it. */
  id: string;
  platform: 'resend';
  /**
   * The container the account acts in. Resend's API does not expose the team, and one key belongs to one team, so
   * the key's fingerprint (`key_` + 8 hex characters of its SHA-256 — nothing of the key itself) stands in for it.
   */
  workspace: string;
  workspaceName?: string | undefined;
  /** Who it acts as: the key, by the same fingerprint. */
  userId: string;
  /** The key's permission: `full_access` or `sending_access`, detected when it was added. */
  tier: KeyPermission;
  mode: Mode;
  grantedScopes: string[];
  secretRef: string;
  sendPolicy?: SendPolicy | undefined;
  /** Kept for the record shape; this package refuses changes to an account that sets it (see `changePolicyOf`). */
  changePolicy?: ChangePolicy | undefined;
  createdAt: string;
  /** For a `sending_access` key: the one domain the person said it is restricted to. Declared, not detected. */
  domainLock?: string | undefined;
}

export interface AccountsFile {
  version: 1;
  accounts: Record<string, ResendAccount>;
}

export interface NamedAccount {
  name: string;
  account: ResendAccount;
}

const accountSchema = z.looseObject({
  id: z.string().regex(/^acc_[A-Z0-9]{16}$/, 'account ids look like acc_ followed by 16 characters'),
  platform: z.literal('resend'),
  workspace: z.string().min(1),
  workspaceName: z.string().optional(),
  userId: z.string().min(1),
  tier: z.enum(KEY_PERMISSIONS),
  // Closed: an unknown mode word is refused outright, never read as something narrower.
  mode: z.enum(MODES),
  grantedScopes: z.array(z.string()).default([]),
  secretRef: z.string().regex(/^resend:key:acc_[A-Z0-9]{16}$/),
  sendPolicy: z.enum(SEND_POLICIES).optional(),
  changePolicy: z.enum(['chat', 'confirm']).optional(),
  createdAt: z.string(),
  domainLock: z
    .string()
    .regex(/^[a-z0-9.-]+\.[a-z]{2,}$/)
    .optional(),
});

const fileSchema = z
  .looseObject({
    version: z.literal(1),
    accounts: z.record(z.string().regex(NAME_PATTERN), accountSchema).default({}),
  })
  .superRefine((file, ctx) => {
    const ids = new Map<string, string>();
    for (const [name, account] of Object.entries(file.accounts)) {
      const problem = nameShapeProblem(name, PLATFORM);
      if (problem) ctx.addIssue({ code: 'custom', path: ['accounts', name], message: problem });
      if (account.secretRef !== secretRefFor(account.id)) {
        ctx.addIssue({ code: 'custom', path: ['accounts', name, 'secretRef'], message: 'does not match the id' });
      }
      const other = ids.get(account.id);
      if (other) ctx.addIssue({ code: 'custom', path: ['accounts', name, 'id'], message: `duplicates "${other}"` });
      ids.set(account.id, name);
    }
  });

/** Where an account's key is kept in core's secret store: prefixed by the platform, as the contract says. */
export function secretRefFor(id: string): string {
  return `resend:key:${id}`;
}

export function newResendAccountId(): string {
  return newAccountId();
}

/** An own property only: a name is user input, and `map.constructor` is a function on every plain object. */
function own<T>(map: Record<string, T>, key: string): T | undefined {
  return Object.hasOwn(map, key) ? map[key] : undefined;
}

const POLICY_RANK: Record<SendPolicy, number> = { chat: 0, confirm: 1, never: 2 };

/**
 * Every loosening between two files, with the values compared — core's `classifyChange`, for this record.
 *
 * `defaultSendPolicy` is the machine's, from core's config: an account without a send policy of its own inherits it,
 * so dropping an account's `confirm` when the default is `chat` loosens it, and a new account is measured against it.
 */
export function classifyAccountChange(
  before: AccountsFile,
  after: AccountsFile,
  defaultSendPolicy: SendPolicy,
): Loosening[] {
  const changes: Loosening[] = [];
  for (const [name, account] of Object.entries(after.accounts)) {
    const previous = Object.values(before.accounts).find((candidate) => candidate.id === account.id);
    const id = previous?.id;
    const at = (field: string) => `accounts.${name}.${field}`;
    const push = (field: string, was: string | null, now: string | null) =>
      changes.push({ path: at(field), before: was, after: now, ...(id === undefined ? {} : { id }) });

    // A mode outside the closed vocabulary is a loosening whatever it came from; `send` is one unless it was already.
    const wasMode = previous?.mode ?? null;
    const nowMode: string = account.mode;
    if (!(MODES as readonly string[]).includes(nowMode) || (nowMode === 'send' && wasMode !== 'send')) {
      push('mode', wasMode, nowMode);
    }
    const wasPolicy = previous ? (previous.sendPolicy ?? defaultSendPolicy) : defaultSendPolicy;
    const nowPolicy = account.sendPolicy ?? defaultSendPolicy;
    if (POLICY_RANK[nowPolicy] < POLICY_RANK[wasPolicy]) push('sendPolicy', wasPolicy, nowPolicy);
    if (previous?.changePolicy === 'confirm' && account.changePolicy !== 'confirm') {
      push('changePolicy', 'confirm', account.changePolicy ?? null);
    }
  }
  return changes;
}

function sameLoosening(a: Loosening, b: Loosening): boolean {
  return a.path === b.path && a.before === b.before && a.after === b.after && (a.id ?? null) === (b.id ?? null);
}

export class AccountStore {
  readonly path: string;
  readonly #lockPath: string;

  constructor(configDir: string) {
    this.path = join(configDir, ACCOUNTS_FILE);
    this.#lockPath = join(configDir, '.resend-accounts.lock');
  }

  async load(): Promise<AccountsFile> {
    let raw: string;
    try {
      raw = await readFile(this.path, 'utf8');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { version: 1, accounts: {} };
      throw error;
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      throw new CommsError('CONFIG', `${this.path} is not valid JSON`, {
        hint: 'Fix or remove the file; the keys it points at stay in the secret store.',
      });
    }
    const result = fileSchema.safeParse(parsed);
    if (!result.success) {
      const issue = result.error.issues[0];
      throw new CommsError(
        'CONFIG',
        `${this.path} is not a Resend accounts file this release can read: ${issue?.path.join('.') || '(root)'}: ${issue?.message ?? 'invalid'}`,
      );
    }
    return result.data as AccountsFile;
  }

  async list(): Promise<NamedAccount[]> {
    const file = await this.load();
    return Object.entries(file.accounts)
      .map(([name, account]) => ({ name, account }))
      .sort((a, b) => (a.name < b.name ? -1 : 1));
  }

  async find(name: string): Promise<NamedAccount | null> {
    const account = own((await this.load()).accounts, name);
    return account ? { name, account } : null;
  }

  async findById(id: string): Promise<NamedAccount | null> {
    const file = await this.load();
    const found = Object.entries(file.accounts).find(([, account]) => account.id === id);
    return found ? { name: found[0], account: found[1] } : null;
  }

  /** The account by name, or a refusal that says what to do. */
  async require(name: string): Promise<NamedAccount> {
    const problem = nameShapeProblem(name, PLATFORM);
    if (problem) throw new CommsError('USAGE', problem);
    const found = await this.find(name);
    if (!found) {
      throw new CommsError('NOT_FOUND', `there is no Resend account called "${name}"`, {
        hint: 'List them with `agent-resend account list`; a person adds one with `agent-resend account add <org/resend>`.',
      });
    }
    return found;
  }

  /**
   * Read-modify-write under the lock. Refuses a file that does not validate, and any loosening the consent does not
   * cover exactly — the same value on the same account, not just the same path.
   */
  async update(
    mutator: (file: AccountsFile) => AccountsFile | Promise<AccountsFile>,
    options: { defaultSendPolicy: SendPolicy; consent?: LooseningConsent | undefined },
  ): Promise<AccountsFile> {
    return withFileLock(this.#lockPath, async () => {
      const current = await this.load();
      const next = await mutator(structuredClone(current));
      const parsed = fileSchema.safeParse(next);
      if (!parsed.success) {
        const issue = parsed.error.issues[0];
        throw new CommsError(
          'CONFIG',
          `refusing to write an invalid Resend accounts file: ${issue?.path.join('.') || '(root)'}: ${issue?.message ?? 'invalid'}`,
        );
      }
      const written = parsed.data as AccountsFile;
      const loosened = classifyAccountChange(current, written, options.defaultSendPolicy);
      const allowed = options.consent?.changes;
      const paths = new Set(options.consent?.paths ?? []);
      const unconsented = loosened.filter((loosening) =>
        allowed ? !allowed.some((ok) => sameLoosening(ok, loosening)) : !paths.has(loosening.path),
      );
      if (unconsented.length > 0) {
        throw new CommsError(
          'LOOSENING_REFUSED',
          `refusing to loosen ${unconsented.map((loosening) => loosening.path).join(', ')} without a person's approval`,
          {
            hint: 'Prepare the change and have a person approve it: a yes in chat under the `chat` change policy, `agent-resend approve <id>` under `confirm`.',
          },
        );
      }
      await writeFileAtomic(this.path, `${JSON.stringify(written, null, 2)}\n`);
      return written;
    });
  }
}

/**
 * Refuses a change to an account that carries its own change policy.
 *
 * Core's change approvals read the policy that governs a change from core's configuration, where this account is not
 * yet. An account-level `changePolicy: confirm` here would be invisible to them and a change would be approved under
 * the default — so, until accounts move into core, such an account is refused rather than approved the looser way.
 * Nothing in this package writes the field; a hand edit is the only way it gets here.
 */
export function refuseOwnChangePolicy(named: NamedAccount): void {
  if (named.account.changePolicy !== undefined) {
    throw new CommsError('CONFIG', `"${named.name}" sets its own change policy, which this release cannot honour yet`, {
      hint: `Remove changePolicy from "${named.name}" in ${ACCOUNTS_FILE}, and set the machine's with \`agentcomms policy --change confirm\` if that is what you want.`,
    });
  }
}
