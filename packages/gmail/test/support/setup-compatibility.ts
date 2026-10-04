import { clientSecretRef } from '@agentcomms/core';
import { type Harness, migrateNamesForTest, newHarness, TEST_CLIENT_ID, TEST_CLIENT_SECRET } from './harness.ts';

const WHEN = '2026-10-04T12:00:00.000Z';

export type SetupCompatibilityCase =
  | 'no client'
  | 'one ordinary client and no inbox'
  | 'one client and one connected inbox'
  | 'two connected inboxes'
  | 'an inactive-only Gmail profile'
  | 'a Slack-only profile';

export interface MainSetupExpectation {
  next: 'client' | 'inbox' | 'mcp';
  done: ('client' | 'inbox')[];
  clients: string[];
  inboxes: string[];
  clientOf: Record<string, string>;
  registeredWith: string[];
  candidates: [];
}

export const SETUP_MAIN_EQUIVALENCE: ReadonlyArray<{
  name: SetupCompatibilityCase;
  expected: MainSetupExpectation;
}> = [
  // main setup.ts: no clients makes `next` client and contributes nothing to `done`.
  {
    name: 'no client',
    expected: {
      next: 'client',
      done: [],
      clients: [],
      inboxes: [],
      clientOf: {},
      registeredWith: [],
      candidates: [],
    },
  },
  // main setup.ts: any client completes client; an empty inbox map makes `next` inbox.
  {
    name: 'one ordinary client and no inbox',
    expected: {
      next: 'inbox',
      done: ['client'],
      clients: ['desktop'],
      inboxes: [],
      clientOf: {},
      registeredWith: [],
      candidates: [],
    },
  },
  // main setup.ts: non-empty client and inbox maps complete both steps, so MCP registration is next.
  {
    name: 'one client and one connected inbox',
    expected: {
      next: 'mcp',
      done: ['client', 'inbox'],
      clients: ['desktop'],
      inboxes: ['acme/gmail'],
      clientOf: { 'acme/gmail': 'desktop' },
      registeredWith: [],
      candidates: [],
    },
  },
  // main setup.ts tests only whether the inbox map is empty; a second mailbox does not change next or done.
  {
    name: 'two connected inboxes',
    expected: {
      next: 'mcp',
      done: ['client', 'inbox'],
      clients: ['desktop'],
      inboxes: ['acme/gmail', 'personal/gmail'],
      clientOf: { 'acme/gmail': 'desktop', 'personal/gmail': 'desktop' },
      registeredWith: [],
      candidates: [],
    },
  },
  // main predates Gmail routing and reads only clients/inboxes: the retained row completes client, with no inbox yet.
  {
    name: 'an inactive-only Gmail profile',
    expected: {
      next: 'inbox',
      done: ['client'],
      clients: ['acme-1'],
      inboxes: [],
      clientOf: {},
      registeredWith: [],
      candidates: [],
    },
  },
  // main ignores organisations entirely: a Slack-only record does not change the ordinary client's result.
  {
    name: 'a Slack-only profile',
    expected: {
      next: 'inbox',
      done: ['client'],
      clients: ['desktop'],
      inboxes: [],
      clientOf: {},
      registeredWith: [],
      candidates: [],
    },
  },
];

const client = (name: string, organisation?: string) => ({
  provider: 'gmail' as const,
  clientId: TEST_CLIENT_ID,
  secretRef: clientSecretRef(name),
  ...(organisation ? { organisation } : {}),
  addedAt: WHEN,
});

const inbox = (id: string) => ({
  id,
  provider: 'gmail' as const,
  email: 'jo@example.test',
  identity: 'legacy' as const,
  client: 'desktop',
  tier: 'read',
  contacts: false,
  grantedScopes: [],
  secretRef: `gmail:refresh:${id}`,
  internalDomains: ['example.test'],
  createdAt: WHEN,
});

/** A version-2 machine in one of the states whose setup result must remain byte-for-byte main-compatible. */
export async function setupCompatibilityHarness(name: SetupCompatibilityCase): Promise<Harness> {
  const harness = await newHarness();
  await migrateNamesForTest(harness);
  const clientName = name === 'an inactive-only Gmail profile' ? 'acme-1' : 'desktop';
  if (name !== 'no client')
    await (await harness.core.secrets('file')).set(clientSecretRef(clientName), TEST_CLIENT_SECRET);
  await harness.core.config.update((config) => {
    if (config.version !== 2) throw new Error('the compatibility fixture was migrated to version 2');
    const hasClient = name !== 'no client';
    const hasOneInbox = name === 'one client and one connected inbox' || name === 'two connected inboxes';
    return {
      ...config,
      clients: hasClient
        ? name === 'an inactive-only Gmail profile'
          ? { 'acme-1': client('acme-1', 'acme') }
          : { desktop: client('desktop') }
        : {},
      inboxes: hasOneInbox
        ? {
            'acme/gmail': inbox('ibx_AAAAAAAAAAAAAAAA'),
            ...(name === 'two connected inboxes' ? { 'personal/gmail': inbox('ibx_BBBBBBBBBBBBBBBB') } : {}),
          }
        : {},
      ...(name === 'an inactive-only Gmail profile'
        ? {
            organisations: {
              acme: {
                label: 'Acme Test Org',
                source: { kind: 'file', path: '/profiles/acme.json' },
                sha256: 'a'.repeat(64),
                readAt: WHEN,
                addedAt: WHEN,
                forOtherAddresses: true,
                gmail: {
                  active: null,
                  generations: [
                    {
                      name: 'acme-1',
                      clientId: TEST_CLIENT_ID,
                      ownership: 'owned' as const,
                      serves: 'any' as const,
                      addedAt: WHEN,
                    },
                  ],
                },
              },
            },
          }
        : name === 'a Slack-only profile'
          ? {
              organisations: {
                acme: {
                  label: 'Acme Test Org',
                  source: { kind: 'file', path: '/profiles/acme.json' },
                  sha256: 'a'.repeat(64),
                  readAt: WHEN,
                  addedAt: WHEN,
                  forOtherAddresses: false,
                  slack: {
                    workspace: 'TACME0001',
                    workspaceName: 'Acme Test Org',
                    redirectPort: 51234,
                    apps: { read: { clientId: '1111.2222' } },
                  },
                },
              },
            }
          : { organisations: undefined }),
    };
  });
  return harness;
}
