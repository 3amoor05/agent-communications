import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  CommsError,
  type ConfigV2,
  type Core,
  clientSecretRef,
  emptyConfig,
  inlineCommand,
  type OrganisationGeneration,
  type OrganisationRecord,
  openCore,
  shellCommand,
  withCredentialsLock,
} from '@agentcomms/core';
import { SCOPES } from '../src/auth/scopes.ts';
import { GmailContext } from '../src/context.ts';
import { chooseClientForNewInbox } from '../src/operations/client-choice.ts';
import { completeConsent } from '../src/operations/consent.ts';
import { inboxList } from '../src/operations/inboxes.ts';
import { startSignIn } from '../src/operations/signin.ts';
import { TEST_CLIENT_ID, TEST_CLIENT_SECRET, tempDir } from './support/harness.ts';

const CLIENT_ID = '123456789012-acme.apps.googleusercontent.com';
const OTHER_ID = '234567890123-personal.apps.googleusercontent.com';
const WHEN = '2026-10-02T12:00:00.000Z';
const NOOP_LISTENER = {
  command: process.execPath,
  args: ['-e', 'process.send?.({type:"ready"}); setTimeout(() => {}, 1000)'],
};

function generation(over: Partial<OrganisationGeneration> = {}): OrganisationGeneration {
  return {
    name: 'acme-1',
    clientId: CLIENT_ID,
    ownership: 'owned',
    serves: { domains: ['acme.test'] },
    addedAt: WHEN,
    ...over,
  };
}

function record(generations: OrganisationGeneration[], over: Partial<OrganisationRecord> = {}): OrganisationRecord {
  return {
    label: 'Acme Test Org',
    source: { kind: 'file', path: '/profiles/acme.json' },
    sha256: 'a'.repeat(64),
    readAt: WHEN,
    addedAt: WHEN,
    forOtherAddresses: false,
    gmail: { active: generations.at(-1)?.name ?? null, generations },
    ...over,
  };
}

function routingConfig(
  options: { generations?: OrganisationGeneration[]; forOtherAddresses?: boolean; ordinary?: boolean } = {},
): ConfigV2 {
  const config = emptyConfig();
  if (config.version !== 2) throw new Error('the current empty config is not version 2');
  const generations = options.generations ?? [generation()];
  return {
    ...config,
    clients: {
      ...Object.fromEntries(
        generations.map((item) => [
          item.name,
          {
            provider: 'gmail',
            clientId: item.clientId,
            secretRef: clientSecretRef(item.name),
            ...(item.projectId ? { projectId: item.projectId } : {}),
            addedAt: item.addedAt,
            ...(item.ownership === 'owned' ? { organisation: 'acme' } : {}),
          },
        ]),
      ),
      ...(options.ordinary
        ? {
            personal: {
              provider: 'gmail',
              clientId: OTHER_ID,
              secretRef: clientSecretRef('personal'),
              addedAt: WHEN,
            },
          }
        : {}),
    },
    organisations: {
      acme: record(generations, { forOtherAddresses: options.forOtherAddresses ?? false }),
    },
  };
}

interface OfflineHarness {
  core: Core;
  context: GmailContext;
  requests: string[];
  email: string;
  revokeFails: boolean;
}

async function offlineProfileClient(
  email: string,
  options: { serves?: OrganisationGeneration['serves']; forOtherAddresses?: boolean } = {},
): Promise<OfflineHarness> {
  const configDir = tempDir('agent-gmail-org-routing-');
  const env: NodeJS.ProcessEnv = {
    AGENT_COMMS_CONFIG_DIR: configDir,
    AGENT_COMMS_GOOGLE_ROOT_URL: 'http://127.0.0.1:9',
    HOME: configDir,
    USERPROFILE: configDir,
    NO_COLOR: '1',
    AGENT_COMMS_UPDATE_CHECK: 'off',
  };
  const core = openCore({ env });
  const gen = generation({ clientId: TEST_CLIENT_ID, serves: options.serves ?? { domains: ['acme.test'] } });
  await (await core.secrets('file')).set(clientSecretRef(gen.name), TEST_CLIENT_SECRET);
  await core.config.update((config) => {
    if (config.version !== 2) throw new Error('a new config is version 2');
    return {
      ...config,
      secrets: { store: 'file' },
      clients: {
        ...config.clients,
        [gen.name]: {
          provider: 'gmail',
          clientId: gen.clientId,
          secretRef: clientSecretRef(gen.name),
          organisation: 'acme',
          addedAt: WHEN,
        },
      },
      organisations: {
        ...(config.organisations ?? {}),
        acme: record([gen], { forOtherAddresses: options.forOtherAddresses ?? false }),
      },
    };
  });
  const context = new GmailContext({ core, env });
  return { core, context, requests: [], email, revokeFails: false };
}

async function routedConsent(harness: OfflineHarness, options: { email?: string; alias?: string } = {}) {
  const { context } = harness;
  const alias = options.alias ?? 'acme/gmail';
  const started = await startSignIn(context, {
    mode: 'add',
    alias,
    email: options.email,
    contacts: false,
    listenerCommand: NOOP_LISTENER,
  });
  const flow = await context.flows.get(started.flowId);
  return { code: 'offline-code', flow };
}

function offlineGoogle(harness: OfflineHarness): typeof fetch {
  return (async (input: string | URL | Request) => {
    const url = new URL(typeof input === 'string' || input instanceof URL ? input : input.url);
    harness.requests.push(url.pathname);
    if (url.pathname === '/token') {
      const claims = Buffer.from(JSON.stringify({ email: harness.email })).toString('base64url');
      return Response.json({
        access_token: 'test-access-token',
        refresh_token: 'test-refresh-token',
        expires_in: 3600,
        scope: [SCOPES.openid, SCOPES.email, SCOPES.gmailModify].join(' '),
        id_token: `x.${claims}.x`,
      });
    }
    if (url.pathname === '/gmail/v1/users/me/profile') return Response.json({ emailAddress: harness.email });
    if (url.pathname === '/revoke') {
      return harness.revokeFails ? Response.json({ error: 'unavailable' }, { status: 503 }) : Response.json({});
    }
    return Response.json({ error: 'not_found' }, { status: 404 });
  }) as typeof fetch;
}

test('§D6 row 1: an explicit ordinary client wins over the name organisation and email', () => {
  const config = routingConfig({ ordinary: true });
  const choice = chooseClientForNewInbox(config, {
    alias: 'acme/gmail',
    email: 'jo@somewhere.test',
    client: 'personal',
  });
  assert.equal(choice?.name, 'personal');
  assert.equal(choice?.organisation, undefined);
});

test('§D6 row 1: an explicit client that is not registered is refused before consent', () => {
  assert.throws(
    () => chooseClientForNewInbox(routingConfig(), { alias: 'acme/gmail', client: 'missing' }),
    (error: unknown) => error instanceof CommsError && error.code === 'CONFIG' && /no OAuth client/.test(error.message),
  );
});

test('§D6 row 1: an explicit client must be a Gmail client', () => {
  const config = routingConfig();
  config.clients.slack = {
    provider: 'slack',
    clientId: '1111.2222',
    secretRef: clientSecretRef('slack'),
    addedAt: WHEN,
  };
  assert.throws(
    () => chooseClientForNewInbox(config, { alias: 'personal/gmail', client: 'slack' }),
    (error: unknown) => error instanceof CommsError && error.code === 'CONFIG' && /Google/.test(error.message),
  );
});

test('an explicit client marked for an organisation must still be one of its live generations', () => {
  const config = routingConfig({ ordinary: true });
  config.clients.stray = {
    provider: 'gmail',
    clientId: '345678901234-stray.apps.googleusercontent.com',
    secretRef: clientSecretRef('stray'),
    organisation: 'acme',
    addedAt: WHEN,
  };
  assert.throws(
    () => chooseClientForNewInbox(config, { alias: 'personal/gmail', client: 'stray' }),
    (error: unknown) =>
      error instanceof CommsError && error.code === 'CONFIG' && /org update acme/.test(error.hint ?? ''),
  );
});

test('an active owned generation whose marker disappeared is refused, never borrowed as an ordinary client', () => {
  const config = routingConfig();
  const row = config.clients['acme-1'];
  if (!row) throw new Error('the fixture has an acme-1 client');
  config.clients['acme-1'] = { ...row, organisation: undefined };

  assert.throws(
    () => chooseClientForNewInbox(config, { alias: 'personal/gmail', client: 'acme-1' }),
    (error: unknown) => error instanceof CommsError && /org update acme/.test(error.hint ?? ''),
  );
  assert.throws(
    () => chooseClientForNewInbox(config, { alias: 'personal/gmail' }),
    (error: unknown) => error instanceof CommsError && /no Google client is available/.test(error.message),
  );
});

test('an inactive canonical owned generation whose marker disappeared is refused until reconciliation', () => {
  const retained = generation();
  const active = generation({ name: 'acme-2', clientId: OTHER_ID });
  const config = routingConfig({ generations: [retained, active] });
  const row = config.clients['acme-1'];
  if (!row) throw new Error('the fixture has an acme-1 client');
  config.clients['acme-1'] = { ...row, organisation: undefined };

  assert.throws(
    () => chooseClientForNewInbox(config, { alias: 'personal/gmail', client: 'acme-1' }),
    (error: unknown) => error instanceof CommsError && /org update acme/.test(error.hint ?? ''),
  );
  assert.throws(
    () => chooseClientForNewInbox(config, { alias: 'personal/gmail' }),
    (error: unknown) => error instanceof CommsError && /no Google client is available/.test(error.message),
  );
});

test('a reconciled historical name with another id and no marker is an ordinary client again', () => {
  const retained = generation();
  const active = generation({ name: 'acme-2', clientId: OTHER_ID });
  const config = routingConfig({ generations: [retained, active] });
  const row = config.clients['acme-1'];
  if (!row) throw new Error('the fixture has an acme-1 client');
  config.clients['acme-1'] = { ...row, clientId: OTHER_ID, organisation: undefined };

  const explicit = chooseClientForNewInbox(config, { alias: 'personal/gmail', client: 'acme-1' });
  assert.deepEqual(explicit, { name: 'acme-1', clientId: OTHER_ID });
  const fallback = chooseClientForNewInbox(config, { alias: 'personal/gmail' });
  assert.deepEqual(fallback, { name: 'acme-1', clientId: OTHER_ID });
});

test('an unmarked altered owned row with the historical id is an ordinary client again', () => {
  const retained = generation();
  const active = generation({ name: 'acme-2', clientId: OTHER_ID });
  const config = routingConfig({ generations: [retained, active] });
  const row = config.clients['acme-1'];
  if (!row) throw new Error('the fixture has an acme-1 client');
  config.clients['acme-1'] = { ...row, secretRef: 'oauth-client/personal', organisation: undefined };

  assert.deepEqual(chooseClientForNewInbox(config, { alias: 'personal/gmail', client: 'acme-1' }), {
    name: 'acme-1',
    clientId: CLIENT_ID,
  });
  assert.deepEqual(chooseClientForNewInbox(config, { alias: 'personal/gmail' }), {
    name: 'acme-1',
    clientId: CLIENT_ID,
  });
});

test('an unmarked historical row with another project id stays an ordinary client after D8(e)', () => {
  const retained = generation({ projectId: 'acme-agent-comms' });
  const active = generation({ name: 'acme-2', clientId: OTHER_ID });
  const config = routingConfig({ generations: [retained, active] });
  const row = config.clients['acme-1'];
  if (!row) throw new Error('the fixture has an acme-1 client');
  config.clients['acme-1'] = { ...row, projectId: 'personal-agent-comms', organisation: undefined };

  assert.deepEqual(chooseClientForNewInbox(config, { alias: 'personal/gmail', client: 'acme-1' }), {
    name: 'acme-1',
    clientId: CLIENT_ID,
  });
  assert.deepEqual(chooseClientForNewInbox(config, { alias: 'personal/gmail' }), {
    name: 'acme-1',
    clientId: CLIENT_ID,
  });
});

test('an adopted historical name follows the live row client id before it stays associated', () => {
  const config = routingConfig({ generations: [generation({ ownership: 'adopted' })] });
  const row = config.clients['acme-1'];
  if (!row) throw new Error('the fixture has an acme-1 client');
  config.clients['acme-1'] = { ...row, clientId: OTHER_ID };

  assert.deepEqual(chooseClientForNewInbox(config, { alias: 'personal/gmail', client: 'acme-1' }), {
    name: 'acme-1',
    clientId: OTHER_ID,
  });
  assert.deepEqual(chooseClientForNewInbox(config, { alias: 'personal/gmail' }), {
    name: 'acme-1',
    clientId: OTHER_ID,
  });
});

test('§D6 row 1: an explicit retained generation uses that generation’s serves, not the active one’s', () => {
  const retained = generation({ name: 'acme-1', serves: { domains: ['old.acme.test'] } });
  const active = generation({ name: 'acme-2', clientId: '123456789012-new.apps.googleusercontent.com', serves: 'any' });
  const config = routingConfig({ generations: [retained, active] });

  const choice = chooseClientForNewInbox(config, {
    alias: 'personal/gmail',
    email: 'jo@old.acme.test',
    client: 'acme-1',
  });
  assert.equal(choice?.name, 'acme-1');
  assert.equal(choice?.organisation, 'acme');
  assert.equal(choice?.generation?.name, 'acme-1');
  assert.throws(
    () =>
      chooseClientForNewInbox(config, {
        alias: 'personal/gmail',
        email: 'jo@new.acme.test',
        client: 'acme-1',
      }),
    (error: unknown) => error instanceof CommsError && error.code === 'CONFIG' && /--client/.test(error.hint ?? ''),
  );
});

test('§D6 row 2: the name organisation routes with no email, and accepts an email in serves', () => {
  const config = routingConfig({ ordinary: true });
  const withoutEmail = chooseClientForNewInbox(config, { alias: 'acme/gmail' });
  const withEmail = chooseClientForNewInbox(config, { alias: 'acme/gmail', email: 'Jo@ACME.TEST' });
  assert.equal(withoutEmail?.name, 'acme-1');
  assert.equal(withEmail?.name, 'acme-1');
  assert.equal(withEmail?.organisationLabel, 'Acme Test Org');
});

test('§D6 row 2: an address outside the name organisation’s domains is refused before consent', () => {
  assert.throws(
    () => chooseClientForNewInbox(routingConfig(), { alias: 'acme/gmail', email: 'jo@outside.test' }),
    (error: unknown) =>
      error instanceof CommsError &&
      error.code === 'CONFIG' &&
      /does not serve/.test(error.message) &&
      /--client/.test(error.hint ?? ''),
  );
});

test('§D6 row 2: serves any accepts an address outside the organisation’s domains', () => {
  const config = routingConfig({ generations: [generation({ serves: 'any' })] });
  assert.equal(chooseClientForNewInbox(config, { alias: 'acme/gmail', email: 'jo@outside.test' })?.name, 'acme-1');
});

test('§D6 row 3: exactly one opted-in profile supplies other addresses', () => {
  const choice = chooseClientForNewInbox(routingConfig({ forOtherAddresses: true, ordinary: true }), {
    alias: 'personal/gmail',
  });
  assert.equal(choice?.name, 'acme-1');
  assert.equal(choice?.organisation, 'acme');
});

test('§D6 row 3: an opted-in profile still applies its serves domains when email is known', () => {
  const config = routingConfig({ forOtherAddresses: true });
  assert.equal(chooseClientForNewInbox(config, { alias: 'personal/gmail', email: 'jo@acme.test' })?.name, 'acme-1');
  assert.throws(
    () => chooseClientForNewInbox(config, { alias: 'personal/gmail', email: 'jo@outside.test' }),
    (error: unknown) => error instanceof CommsError && /does not serve/.test(error.message),
  );
});

test('§D6 row 3: two opted-in active profiles are ambiguous and ask for --client', () => {
  const config = routingConfig({ forOtherAddresses: true });
  if (!config.organisations) throw new Error('the fixture has organisations');
  config.organisations.other = {
    ...record([generation({ name: 'other-1', clientId: '345678901234-other.apps.googleusercontent.com' })]),
    label: 'Other Test Org',
    forOtherAddresses: true,
  };
  config.clients['other-1'] = {
    provider: 'gmail',
    clientId: '345678901234-other.apps.googleusercontent.com',
    secretRef: clientSecretRef('other-1'),
    organisation: 'other',
    addedAt: WHEN,
  };
  assert.throws(
    () => chooseClientForNewInbox(config, { alias: 'personal/gmail' }),
    (error: unknown) => error instanceof CommsError && error.code === 'CONFIG' && /--client/.test(error.hint ?? ''),
  );
});

test('§D6 row 3: forOtherAddresses without an active generation routes nothing', () => {
  const config = routingConfig({ forOtherAddresses: true, ordinary: true });
  const acme = config.organisations?.acme;
  if (!acme?.gmail) throw new Error('fixture has Gmail generations');
  acme.gmail.active = null;
  const choice = chooseClientForNewInbox(config, { alias: 'personal/gmail' });
  assert.equal(choice?.name, 'personal');
});

test('§D6 row 4: legacy fallback chooses only an organisation-free client, with or without email', () => {
  const config = routingConfig({ ordinary: true });
  config.clients.orphaned = {
    provider: 'gmail',
    clientId: '456789012345-orphaned.apps.googleusercontent.com',
    secretRef: clientSecretRef('orphaned'),
    organisation: 'removed-org',
    addedAt: WHEN,
  };
  config.clients.notGmail = {
    provider: 'slack',
    clientId: '1111.2222',
    secretRef: clientSecretRef('notGmail'),
    addedAt: WHEN,
  };
  config.clients = {
    notGmail: config.clients.notGmail,
    orphaned: config.clients.orphaned,
    ...config.clients,
  };
  const choice = chooseClientForNewInbox(config, { alias: 'personal/gmail' });
  assert.equal(choice?.name, 'personal');
  assert.equal(choice?.organisation, undefined);
  assert.equal(
    chooseClientForNewInbox(config, { alias: 'personal/gmail', email: 'jo@outside.test' })?.name,
    'personal',
  );
});

test('§D6 row 4: a marker naming no installed profile is an ordinary fallback client', () => {
  const config = routingConfig();
  config.clients = {
    orphaned: {
      provider: 'gmail',
      clientId: OTHER_ID,
      secretRef: clientSecretRef('orphaned'),
      organisation: 'removed-org',
      addedAt: WHEN,
    },
  };

  assert.deepEqual(chooseClientForNewInbox(config, { alias: 'personal/gmail' }), {
    name: 'orphaned',
    clientId: OTHER_ID,
  });
});

test('§D6 row 1: an explicit client whose marker names no installed profile is ordinary', () => {
  const config = routingConfig();
  config.clients.orphaned = {
    provider: 'gmail',
    clientId: OTHER_ID,
    secretRef: clientSecretRef('orphaned'),
    organisation: 'removed-org',
    addedAt: WHEN,
  };

  assert.deepEqual(
    chooseClientForNewInbox(config, { alias: 'personal/gmail', client: 'orphaned' }),
    { name: 'orphaned', clientId: OTHER_ID },
    'an orphan marker must not produce an impossible org update removed-org refusal',
  );
});

test('§D6 row 4: inbox add with only profile clients refuses with all three routes', () => {
  assert.throws(
    () => chooseClientForNewInbox(routingConfig(), { alias: 'personal/gmail' }),
    (error: unknown) => {
      assert.ok(error instanceof CommsError);
      assert.equal(error.code, 'CONFIG');
      assert.match(error.hint ?? '', /--client acme-1/);
      assert.match(error.hint ?? '', /org update acme --for-other-addresses on/);
      assert.match(error.hint ?? '', /setup/);
      return true;
    },
  );
});

test('§D6 row 4: setup with only profile clients asks to make a client of one’s own', () => {
  const choice = chooseClientForNewInbox(routingConfig(), { alias: 'personal/gmail', allowOwnClient: true });
  assert.equal(choice, null);
});

test('every §D6 refusal prints only shell-built concrete commands for darwin and win32', () => {
  for (const platform of ['darwin', 'win32'] as const) {
    const profileOnly = routingConfig({ generations: [generation({ name: '7-1' })] });
    const acme = profileOnly.organisations?.acme;
    const row = profileOnly.clients['7-1'];
    if (!acme || !row) throw new Error('the fixture has an organisation generation');
    profileOnly.organisations = { '7': acme };
    profileOnly.clients['7-1'] = { ...row, organisation: '7' };

    const add = inlineCommand(
      shellCommand(
        ['agent-gmail', 'inbox', 'add', 'personal/gmail', '--client', '7-1', '--email', 'jo@elsewhere.test', '--start'],
        platform,
      ),
    );
    const offer = inlineCommand(
      shellCommand(['agentcomms', 'org', 'update', '7', '--for-other-addresses', 'on'], platform),
    );
    const setup = inlineCommand(
      shellCommand(['agent-gmail', 'setup', '--inbox', 'personal/gmail', '--email', 'jo@elsewhere.test'], platform),
    );
    assert.throws(
      () =>
        chooseClientForNewInbox(profileOnly, {
          alias: 'personal/gmail',
          email: 'jo@elsewhere.test',
          platform,
        }),
      (error: unknown) => {
        assert.ok(error instanceof CommsError);
        assert.ok(error.hint?.includes(add), platform);
        assert.ok(error.hint?.includes(offer), platform);
        assert.ok(error.hint?.includes(setup), platform);
        assert.doesNotMatch(error.hint ?? '', /<[^>]+>/, platform);
        return true;
      },
      platform,
    );

    const clientHelp = inlineCommand(shellCommand(['agent-gmail', 'client', 'add', '--help'], platform));
    assert.throws(
      () =>
        chooseClientForNewInbox(routingConfig(), {
          alias: 'personal/gmail',
          client: 'missing',
          platform,
        }),
      (error: unknown) => error instanceof CommsError && error.hint?.includes(clientHelp) === true,
      platform,
    );

    const inboxHelp = inlineCommand(shellCommand(['agent-gmail', 'inbox', 'add', '--help'], platform));
    assert.throws(
      () =>
        chooseClientForNewInbox(routingConfig(), {
          alias: 'acme/gmail',
          email: 'jo@outside.test',
          platform,
        }),
      (error: unknown) =>
        error instanceof CommsError && error.hint?.includes(inboxHelp) === true && !error.hint.includes('<name>'),
      platform,
    );
  }
});

test('organisation-name routing refuses a missing or reused active row with org update', () => {
  for (const drift of ['missing', 'reused'] as const) {
    const config = routingConfig();
    if (drift === 'missing') delete config.clients['acme-1'];
    else {
      const row = config.clients['acme-1'];
      if (!row) throw new Error('the fixture has an acme-1 client');
      config.clients['acme-1'] = { ...row, clientId: OTHER_ID, organisation: undefined };
    }
    assert.throws(
      () => chooseClientForNewInbox(config, { alias: 'acme/gmail' }),
      (error: unknown) => {
        assert.ok(error instanceof CommsError, drift);
        assert.match(error.hint ?? '', /org update acme/, drift);
        return true;
      },
    );
  }
});

test('forOtherAddresses routing refuses a missing or reused active row with org update', () => {
  for (const drift of ['missing', 'reused'] as const) {
    const config = routingConfig({ forOtherAddresses: true });
    if (drift === 'missing') delete config.clients['acme-1'];
    else {
      const row = config.clients['acme-1'];
      if (!row) throw new Error('the fixture has an acme-1 client');
      config.clients['acme-1'] = { ...row, clientId: OTHER_ID, organisation: undefined };
    }
    assert.throws(
      () => chooseClientForNewInbox(config, { alias: 'personal/gmail' }),
      (error: unknown) => {
        assert.ok(error instanceof CommsError, drift);
        assert.match(error.hint ?? '', /org update acme/, drift);
        return true;
      },
    );
  }
});

test('inbox add records the expected organisation client id and generation in its flow', async () => {
  const harness = await offlineProfileClient('jo@acme.test');
  const { context } = harness;
  const started = await startSignIn(context, {
    mode: 'add',
    alias: 'acme/gmail',
    email: 'jo@acme.test',
    listenerCommand: NOOP_LISTENER,
  });
  const flow = await context.flows.get(started.flowId);
  assert.equal(flow.clientName, 'acme-1');
  assert.equal(flow.expect.clientId, TEST_CLIENT_ID);
  assert.deepEqual(flow.expect.generation, {
    organisation: 'acme',
    name: 'acme-1',
    active: true,
    forOtherAddresses: false,
  });
  await context.flows.discard(started.flowId);
});

test('inbox add refuses when the reloaded row no longer has the client id §D6 chose', async (t) => {
  const harness = await offlineProfileClient('jo@acme.test');
  const original = harness.context.client.bind(harness.context);
  t.mock.method(harness.context, 'client', async (name: string) => {
    await harness.core.config.update((config) => {
      const row = config.clients[name];
      if (!row) throw new Error('the fixture has the chosen client');
      return { ...config, clients: { ...config.clients, [name]: { ...row, clientId: OTHER_ID } } };
    });
    return original(name);
  });

  await assert.rejects(
    startSignIn(harness.context, {
      mode: 'add',
      alias: 'acme/gmail',
      email: 'jo@acme.test',
      listenerCommand: NOOP_LISTENER,
    }),
    (error: unknown) => error instanceof CommsError && /changed/.test(error.message),
  );
});

test('completion rechecks the expected organisation client id before exchanging or saving', async (t) => {
  const harness = await offlineProfileClient('jo@acme.test');
  const { context } = harness;
  t.mock.method(globalThis, 'fetch', offlineGoogle(harness));
  const { flow, code } = await routedConsent(harness);
  await harness.core.config.update((config) => {
    if (config.version !== 2) throw new Error('the fixture is version 2');
    const row = config.clients['acme-1'];
    const organisation = config.organisations?.acme;
    const generation = organisation?.gmail?.generations[0];
    if (!row || !organisation?.gmail || !generation) throw new Error('the fixture has an acme-1 generation');
    return {
      ...config,
      clients: { ...config.clients, 'acme-1': { ...row, clientId: OTHER_ID } },
      organisations: {
        ...config.organisations,
        acme: {
          ...organisation,
          gmail: {
            ...organisation.gmail,
            generations: [{ ...generation, clientId: OTHER_ID }],
          },
        },
      },
    };
  });
  await assert.rejects(
    completeConsent(context, flow, code),
    (error: unknown) => error instanceof CommsError && /org update acme/.test(error.hint ?? ''),
  );
  assert.equal(harness.requests.includes('/token'), false);
  assert.deepEqual(await inboxList(context), []);
});

test('completion rechecks that the expected generation is still present, live and active', async (t) => {
  for (const drift of ['missing-generation', 'altered-secret', 'inactive'] as const) {
    await t.test(drift, async (child) => {
      const harness = await offlineProfileClient('jo@acme.test');
      child.mock.method(globalThis, 'fetch', offlineGoogle(harness));
      const { flow, code } = await routedConsent(harness);
      await harness.core.config.update((config) => {
        if (config.version !== 2) throw new Error('the fixture is version 2');
        const organisation = config.organisations?.acme;
        if (!organisation?.gmail) throw new Error('the fixture has an acme generation');
        if (drift === 'altered-secret') {
          const row = config.clients['acme-1'];
          if (!row) throw new Error('the fixture has an acme-1 client');
          return {
            ...config,
            clients: { ...config.clients, 'acme-1': { ...row, secretRef: 'oauth-client/other' } },
          };
        }
        return {
          ...config,
          organisations: {
            ...config.organisations,
            acme: {
              ...organisation,
              gmail: {
                ...organisation.gmail,
                ...(drift === 'missing-generation' ? { generations: [] } : { active: null }),
              },
            },
          },
        };
      });
      await assert.rejects(
        completeConsent(harness.context, flow, code),
        (error: unknown) => error instanceof CommsError && /org update acme/.test(error.hint ?? ''),
      );
      assert.equal(harness.requests.includes('/token'), false);
      assert.deepEqual(await inboxList(harness.context), []);
    });
  }
});

test('completion rechecks every organisation route predicate under the credentials lock', async (t) => {
  for (const drift of ['client-id', 'serves', 'for-other-addresses'] as const) {
    await t.test(drift, async (child) => {
      const forOtherAddresses = drift === 'for-other-addresses';
      const harness = await offlineProfileClient('jo@acme.test', { forOtherAddresses });
      child.mock.method(globalThis, 'fetch', offlineGoogle(harness));
      const { flow, code } = await routedConsent(harness, {
        alias: forOtherAddresses ? 'personal/gmail' : 'acme/gmail',
      });
      assert.equal(flow.expect.generation?.forOtherAddresses, forOtherAddresses);
      const secrets = await harness.core.secrets('file');
      const set = secrets.set.bind(secrets);
      let stagedRef: string | undefined;
      secrets.set = async (ref, value) => {
        await set(ref, value);
        if (!ref.startsWith('gmail:refresh:') || stagedRef !== undefined) return;
        stagedRef = ref;
        await harness.core.config.update((config) => {
          if (config.version !== 2) throw new Error('the fixture is version 2');
          const row = config.clients['acme-1'];
          const organisation = config.organisations?.acme;
          const first = organisation?.gmail?.generations[0];
          if (!row || !organisation?.gmail || !first) throw new Error('the fixture has an acme generation');
          if (drift === 'client-id') {
            return { ...config, clients: { ...config.clients, 'acme-1': { ...row, clientId: OTHER_ID } } };
          }
          if (drift === 'serves') {
            return {
              ...config,
              organisations: {
                ...config.organisations,
                acme: {
                  ...organisation,
                  gmail: {
                    ...organisation.gmail,
                    generations: [{ ...first, serves: { domains: ['narrowed.test'] } }],
                  },
                },
              },
            };
          }
          return {
            ...config,
            organisations: { ...config.organisations, acme: { ...organisation, forOtherAddresses: false } },
          };
        });
      };

      await assert.rejects(
        completeConsent(harness.context, flow, code),
        (error: unknown) =>
          error instanceof CommsError && /nothing was saved|org update acme/.test(error.message + error.hint),
      );
      assert.ok(stagedRef, 'the refresh token reached the staging boundary');
      assert.equal(await secrets.get(stagedRef), null, 'the refused token was not withdrawn');
      assert.equal(harness.requests.includes('/revoke'), true, 'the new grant was not revoked');
      assert.deepEqual(await inboxList(harness.context), []);
    });
  }
});

test('completion takes the credentials lock before it stores a routed grant', async (t) => {
  const harness = await offlineProfileClient('jo@acme.test');
  let sawProfile: (() => void) | undefined;
  const profileRead = new Promise<void>((resolve) => {
    sawProfile = resolve;
  });
  const google = offlineGoogle(harness);
  t.mock.method(globalThis, 'fetch', (async (input: string | URL | Request) => {
    const response = await google(input);
    const url = new URL(typeof input === 'string' || input instanceof URL ? input : input.url);
    if (url.pathname === '/gmail/v1/users/me/profile') sawProfile?.();
    return response;
  }) as typeof fetch);
  const { flow, code } = await routedConsent(harness);
  let release: (() => void) | undefined;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  let locked: (() => void) | undefined;
  const lockTaken = new Promise<void>((resolve) => {
    locked = resolve;
  });
  const holder = withCredentialsLock(harness.core.paths.configDir, async () => {
    locked?.();
    await held;
  });
  await lockTaken;

  const completing = completeConsent(harness.context, flow, code);
  await profileRead;
  const whileLocked = await Promise.race([
    completing.then(() => 'completed' as const),
    new Promise<'waiting'>((resolve) => setTimeout(() => resolve('waiting'), 50)),
  ]);
  release?.();
  await holder;
  await completing;
  assert.equal(whileLocked, 'waiting', 'the grant was stored without taking the credentials lock');
});

test('a credentials-lock timeout revokes the unstored grant best effort', async (t) => {
  for (const revokeFails of [false, true]) {
    await t.test(revokeFails ? 'a revoke failure does not hide the timeout' : 'the grant is revoked', async (child) => {
      const harness = await offlineProfileClient('jo@acme.test');
      harness.revokeFails = revokeFails;
      child.mock.method(globalThis, 'fetch', offlineGoogle(harness));
      const { flow, code } = await routedConsent(harness);
      let release: (() => void) | undefined;
      let locked: (() => void) | undefined;
      const held = new Promise<void>((resolve) => {
        release = resolve;
      });
      const lockTaken = new Promise<void>((resolve) => {
        locked = resolve;
      });
      const holder = withCredentialsLock(harness.core.paths.configDir, async () => {
        locked?.();
        await held;
      });
      await lockTaken;

      await assert.rejects(
        completeConsent(harness.context, flow, code),
        (error: unknown) =>
          error instanceof CommsError && error.code === 'TRANSIENT' && /nothing was saved/.test(error.message),
      );
      release?.();
      await holder;
      assert.equal(harness.requests.includes('/revoke'), true, 'the unstored grant was not revoked');
      assert.deepEqual(await inboxList(harness.context), []);
    });
  }
});

test('a post-consent serves mismatch revokes the new grant best effort and saves nothing', async (t) => {
  for (const revokeFails of [false, true]) {
    await t.test(revokeFails ? 'a revoke failure does not hide the refusal' : 'the grant is revoked', async (child) => {
      const harness = await offlineProfileClient('jo@outside.test');
      const { context } = harness;
      harness.revokeFails = revokeFails;
      child.mock.method(globalThis, 'fetch', offlineGoogle(harness));
      const { flow, code } = await routedConsent(harness);
      await assert.rejects(
        completeConsent(context, flow, code),
        (error: unknown) =>
          error instanceof CommsError && /does not serve/.test(error.message) && /--client/.test(error.hint ?? ''),
      );
      assert.equal(harness.requests.includes('/revoke'), true);
      assert.deepEqual(await inboxList(context), []);
    });
  }
});

test('a post-consent serves mismatch prints a shell-built help command for darwin and win32', async (t) => {
  for (const platform of ['darwin', 'win32'] as const) {
    await t.test(platform, async (child) => {
      const harness = await offlineProfileClient('jo@outside.test');
      const context = new GmailContext({ core: harness.core, env: harness.context.env, platform });
      child.mock.method(globalThis, 'fetch', offlineGoogle(harness));
      const { flow, code } = await routedConsent({ ...harness, context });
      const help = inlineCommand(shellCommand(['agent-gmail', 'inbox', 'add', '--help'], platform));
      await assert.rejects(
        completeConsent(context, flow, code),
        (error: unknown) =>
          error instanceof CommsError && error.hint?.includes(help) === true && !error.hint.includes('<name>'),
      );
    });
  }
});

test('completed results and inbox list name the organisation client and organisation', async (t) => {
  const harness = await offlineProfileClient('jo@acme.test');
  const { context } = harness;
  t.mock.method(globalThis, 'fetch', offlineGoogle(harness));
  const { flow, code } = await routedConsent(harness);
  const result = await completeConsent(context, flow, code);
  assert.equal(result.client, 'acme-1');
  assert.equal(result.organisation, 'acme');
  const [listed] = await inboxList(context);
  assert.equal(listed?.client, 'acme-1');
  assert.equal(listed?.organisation, 'acme');
});
