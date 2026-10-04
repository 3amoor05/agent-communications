import { z } from 'zod';

/**
 * The version-2 configuration as 0.12.1 reads and writes it (`git show 62c13e3:packages/core/src/config.ts`, the
 * schemas from line 223 and line 379), frozen — and what that release's `client add --replace` and `client remove`
 * write — so a test can hold this release's `organisations` record against the release before it.
 *
 * Published releases cannot change, and an older release sharing the configuration with this one is exactly the case
 * the design accepts rather than moving to a version 3 (design 2026-10-02 §D4): it keeps the record through its writes,
 * because its root is loose, and it knows nothing of the record's rules. Copied rather than imported: CI checks out
 * without tags, and the behaviour pinned here must not drift with the source. The superRefine checks are left out —
 * they decide whether a file is valid, not which keys a write keeps.
 */

const ALIAS_PATTERN = /^[a-z0-9][a-z0-9-]{0,31}$/;
const NAME_PATTERN =
  /^(?!(?:con|prn|aux|nul|com[1-9]|lpt[1-9])\/)([a-z0-9](?:[a-z0-9-]{0,30}[a-z0-9])?)\/([a-z][a-z0-9]{0,15})(?:-([a-z0-9](?:[a-z0-9-]{0,14}[a-z0-9])?))?$/;
const aliasSchema = z.string().regex(ALIAS_PATTERN);
const nameSchema = z.string().regex(NAME_PATTERN);
const sendPolicySchema = z.enum(['chat', 'confirm', 'never']);
const changePolicySchema = z.enum(['chat', 'confirm']);

const clientSchema = z.looseObject({
  provider: z.string().min(1),
  clientId: z.string().min(1),
  projectId: z.string().optional(),
  secretRef: z.string().min(1),
  addedAt: z.string(),
});

const inboxSchema = z.looseObject({
  id: z.string().regex(/^ibx_[A-Z0-9]{16}$/),
  provider: z.string().min(1),
  email: z.string().min(3),
  sub: z.string().optional(),
  identity: z.enum(['oidc', 'legacy']),
  client: aliasSchema,
  tier: z.string().min(1),
  contacts: z.boolean().default(false),
  grantedScopes: z.array(z.string()).default([]),
  secretRef: z.string().min(1),
  sendPolicy: sendPolicySchema.optional(),
  changePolicy: changePolicySchema.optional(),
  internalDomains: z.array(z.string().transform((domain) => domain.trim().toLowerCase())).default([]),
  createdAt: z.string(),
});

const accountSchema = z.looseObject({
  id: z.string().regex(/^acc_[A-Z0-9]{16}$/),
  platform: z.string().min(1),
  workspace: z.string().min(1),
  workspaceName: z.string().optional(),
  userId: z.string().min(1),
  tier: z.string().min(1),
  grantedScopes: z.array(z.string()).default([]),
  secretRef: z.string().min(1),
  sendPolicy: sendPolicySchema.optional(),
  changePolicy: changePolicySchema.optional(),
  createdAt: z.string(),
  oauthClientId: z.string().min(1).optional(),
  appId: z.string().min(1).optional(),
  mode: z.string().min(1).optional(),
  redirectPort: z.number().int().min(1).max(65535).optional(),
});

const defaultsSchema = z.looseObject({
  sendPolicy: sendPolicySchema.default('chat'),
  changePolicy: changePolicySchema.optional(),
  riskEscalation: z.boolean().default(true),
  sendCaps: z
    .looseObject({ perHour: z.number().int().min(0).default(20), perDay: z.number().int().min(0).default(100) })
    .default({ perHour: 20, perDay: 100 }),
  attachRoots: z.array(z.string()).default(['~']),
  attachDeny: z.array(z.string()).default([]),
  downloadsDir: z.string().optional(),
  timezone: z.string().default('system'),
  confirm: z.looseObject({ elicitationClients: z.array(z.string()).default([]) }).default({ elicitationClients: [] }),
  updateCheck: z.enum(['on', 'off']).optional(),
});

const formerNameSchema = z.looseObject({ name: nameSchema, id: z.string().min(1) });
const formerKeySchema = z.string().refine((key) => ALIAS_PATTERN.test(key) || NAME_PATTERN.test(key));

const configV2Schema0121 = z.looseObject({
  version: z.literal(2),
  secrets: z.looseObject({ store: z.enum(['keychain', 'file']) }).optional(),
  clients: z.record(aliasSchema, clientSchema).default({}),
  inboxes: z.record(nameSchema, inboxSchema).default({}),
  accounts: z.record(nameSchema, accountSchema).default({}),
  defaults: defaultsSchema.default(defaultsSchema.parse({})),
  formerNames: z
    .looseObject({
      inboxes: z.record(formerKeySchema, formerNameSchema).default({}),
      accounts: z.record(formerKeySchema, formerNameSchema).default({}),
    })
    .default({ inboxes: {}, accounts: {} }),
});

type Raw = Record<string, unknown> & { clients: Record<string, Record<string, unknown>> };

/** One write by 0.12.1: parse the file as it does, change it as `mutate` says, and print it as `ConfigStore` does. */
export function writeAsReleased0121(text: string, mutate: (config: Raw) => void): string {
  const config = configV2Schema0121.parse(JSON.parse(text)) as Raw;
  mutate(config);
  return `${JSON.stringify(configV2Schema0121.parse(config), null, 2)}\n`;
}

/** 0.12.1's `client add --name <name> --replace`: a fresh row, written whole — with no key it does not know. */
export function clientAddReplaceAsReleased0121(
  config: Raw,
  name: string,
  row: { clientId: string; projectId?: string; addedAt: string },
): void {
  config.clients[name] = {
    provider: 'gmail',
    clientId: row.clientId,
    projectId: row.projectId,
    secretRef: `client:${name}:secret`,
    addedAt: row.addedAt,
  };
}

/** 0.12.1's `client remove <name>`: the row deleted, whatever it carries. */
export function clientRemoveAsReleased0121(config: Raw, name: string): void {
  delete config.clients[name];
}

/** 0.12.1's secret migration knew only the root store, so an unknown ledger survives but is not rewritten. */
export function secretsStoreSwitchAsReleased0121(config: Raw, store: 'keychain' | 'file'): void {
  config.secrets = { store };
}
