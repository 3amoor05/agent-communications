import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { gatedChange } from '../src/change-flow.ts';
import type { ChannelManifest } from '../src/channel-manifest.ts';
import {
  CHANNELS,
  channelLabel,
  channelServer,
  isChannel,
  requireChannelManifest,
  serverFactsOf,
} from '../src/channel-servers.ts';
import {
  accountNoun,
  channelApproveCommands,
  connectMailboxCommand,
  hasNarrowing,
  listed,
  narrowingOwner,
  pinOption,
} from '../src/channel-words.ts';
import { type Config, effectiveAccountSendPolicy, parseConfig } from '../src/config.ts';
import { type Core, openCore } from '../src/core.ts';
import { CommsError } from '../src/errors.ts';
import { type McpProduct, preflightInstall } from '../src/mcp-install.ts';
import { type ServerInstallRequest, serverInstallChange } from '../src/operations/servers.ts';
import { tempDir } from './helpers/temp.ts';

/*
 * The core's operations, channel-neutral (design 2026-09-26): a channel is a word checked against the manifests; every
 * channel after Gmail and Slack is pinned with the generic `account`, and Gmail's `inbox` and Slack's `workspace` stay
 * as its aliases; and what the core says about a channel comes from its manifest. The sentences themselves are held to
 * 0.6.0 by `wording-identity.test.ts`; this is about the rules.
 */

const CREATED = '2026-09-20T00:00:00.000Z';
const inbox = {
  id: 'ibx_AAAAAAAAAAAAAAAA',
  provider: 'gmail',
  email: 'jo@acme.test',
  identity: 'oidc',
  client: 'desktop',
  tier: 'read',
  contacts: false,
  grantedScopes: [],
  secretRef: 'gmail:refresh:ibx_AAAAAAAAAAAAAAAA',
  internalDomains: ['acme.test'],
  createdAt: CREATED,
};
const account = {
  id: 'acc_AAAAAAAAAAAAAAAA',
  platform: 'slack',
  workspace: 'T_ACME',
  userId: 'U_AAAA',
  tier: 'read',
  mode: 'read',
  grantedScopes: [],
  secretRef: 'slack:token:acc_AAAAAAAAAAAAAAAA',
  createdAt: CREATED,
};

interface Machine {
  home: string;
  env: Record<string, string>;
  core: Core;
}

function machine(
  body: Record<string, unknown> = { inboxes: { 'acme/gmail': inbox }, accounts: { 'acme/slack': account } },
): Machine {
  const home = tempDir('comms-neutral-');
  mkdirSync(join(home, 'bin'));
  mkdirSync(join(home, 'config'));
  writeFileSync(join(home, 'config', 'config.json'), `${JSON.stringify({ version: 2, ...body }, null, 2)}\n`);
  const env = {
    HOME: home,
    USERPROFILE: home,
    APPDATA: join(home, 'AppData'),
    LOCALAPPDATA: join(home, 'AppData', 'Local'),
    PATH: join(home, 'bin'),
    AGENT_COMMS_CONFIG_DIR: join(home, 'config'),
    AGENT_COMMS_DATA_DIR: join(home, 'data'),
    NO_COLOR: '1',
    npm_config_offline: 'true',
  };
  return { home, env, core: openCore({ env }) };
}

const refused = (code: string, pattern: RegExp) => (error: unknown) => {
  assert.ok(error instanceof CommsError, String(error));
  assert.equal(error.code, code, error.message);
  assert.match(error.message, pattern);
  return true;
};

async function effectsOf(m: Machine, request: Omit<ServerInstallRequest, 'client'>): Promise<readonly string[]> {
  const config = await m.core.config.load();
  return (
    (await serverInstallChange(m.core, m.env, { client: 'cursor', launcher: 'npx', ...request }).plan(config))
      .effects ?? []
  );
}

// ── A channel is a word, checked against the manifests ─────────────────────────────────────────────────────────

test('a channel is any word the manifests declare, and nothing else', () => {
  assert.deepEqual([...CHANNELS], ['core', 'gmail', 'resend', 'slack']);
  for (const channel of CHANNELS) {
    assert.equal(isChannel(channel), true);
    assert.equal(channelServer(channel).binary, requireChannelManifest(channel).binary);
    assert.equal(channelLabel(channel), requireChannelManifest(channel).label);
  }
  for (const word of ['discord', 'Gmail', '', 'constructor', '__proto__']) {
    assert.equal(isChannel(word), false, word);
    assert.throws(() => channelServer(word), refused('USAGE', /is not a channel/), word);
    assert.throws(() => channelLabel(word), refused('USAGE', /is not a channel/), word);
    assert.throws(() => requireChannelManifest(word), refused('USAGE', /is not a channel/), word);
  }
});

test('what the core says about a channel is read from its manifest', () => {
  assert.equal(pinOption('gmail'), 'inbox');
  assert.equal(pinOption('slack'), 'workspace');
  assert.equal(pinOption('core'), undefined);
  assert.equal(hasNarrowing('gmail', 'readOnly'), true);
  assert.equal(hasNarrowing('slack', 'readOnly'), false);
  assert.equal(narrowingOwner('workspace')?.channel, 'slack');
  assert.equal(narrowingOwner('account')?.channel, 'resend', 'Resend is the first channel pinned by `account`');
  assert.equal(pinOption('resend'), 'account');
  assert.equal(accountNoun('resend'), 'account');
  assert.equal(accountNoun('gmail'), 'mailbox');
  assert.equal(accountNoun('slack'), 'workspace');
  assert.equal(accountNoun('discord'), 'account');
  assert.equal(channelApproveCommands(), '`agent-gmail approve`, `agent-resend approve` or `agent-slack approve`');
  // Only the channels whose accounts can send name their command where the approval in hand is a send.
  assert.equal(
    channelApproveCommands({ sending: true }),
    '`agent-gmail approve`, `agent-resend approve` or `agent-slack approve`',
  );
  assert.equal(connectMailboxCommand(), 'agent-gmail inbox add');
  assert.equal(listed([], 'or'), '');
  assert.equal(listed(['a'], 'or'), 'a');
  assert.equal(listed(['a', 'b'], 'or'), 'a or b');
  assert.equal(listed(['a', 'b', 'c'], 'and'), 'a, b and c');
  assert.equal(listed(['a', 'b', 'c'], 'or', { oxford: true }), 'a, b, or c');
  assert.equal(listed(['a', 'b'], 'or', { oxford: true }), 'a or b');
});

// ── The generic pin ─────────────────────────────────────────────────────────────────────────────────────────────

test('`account` pins any channel’s server, as the channel’s own name for its pin does', async () => {
  const m = machine();
  assert.deepEqual(
    await effectsOf(m, { channel: 'gmail', account: 'acme/gmail' }),
    await effectsOf(m, { channel: 'gmail', inbox: 'acme/gmail' }),
  );
  assert.deepEqual(
    await effectsOf(m, { channel: 'gmail', account: 'acme/gmail', readOnly: true }),
    await effectsOf(m, { channel: 'gmail', inbox: 'acme/gmail', readOnly: true }),
  );
  assert.deepEqual(
    await effectsOf(m, { channel: 'slack', account: 'acme/slack' }),
    await effectsOf(m, { channel: 'slack', workspace: 'acme/slack' }),
  );
  // Given both ways, saying the same thing, it is the same request.
  assert.deepEqual(
    await effectsOf(m, { channel: 'slack', account: 'acme/slack', workspace: 'acme/slack' }),
    await effectsOf(m, { channel: 'slack', workspace: 'acme/slack' }),
  );
  assert.ok((await effectsOf(m, { channel: 'slack', account: 'acme/slack' }))[0]?.includes('pinned to the workspace'));
});

test('an approval asked for with `account` is claimed with the channel’s own pin, and writes the channel’s flag', async () => {
  const m = machine();
  const byAccount = {
    client: 'cursor',
    channel: 'slack',
    account: 'acme/slack',
    launcher: 'npx',
    noVerify: true,
  } as const;
  const asked = await gatedChange(m.core, serverInstallChange(m.core, m.env, byAccount), { surface: 'mcp' });
  assert.equal(asked.status, 'approval-required');
  const approvalId = asked.status === 'approval-required' ? asked.prepared.approvalId : '';
  const byWorkspace = {
    client: 'cursor',
    channel: 'slack',
    workspace: 'acme/slack',
    launcher: 'npx',
    noVerify: true,
  } as const;
  const done = await gatedChange(m.core, serverInstallChange(m.core, m.env, byWorkspace), {
    surface: 'cli',
    approvalId,
  });
  assert.equal(done.status, 'applied');
  const entry = JSON.parse(readFileSync(join(m.home, '.cursor', 'mcp.json'), 'utf8')).mcpServers.slack;
  assert.deepEqual(entry.args.slice(-2), ['--workspace', 'acme/slack'], 'Slack’s server reads --workspace');
});

test('`account` is refused where it cannot mean one thing', async () => {
  const m = machine();
  const plan = (request: Omit<ServerInstallRequest, 'client'>) => async () =>
    serverInstallChange(m.core, m.env, { client: 'cursor', ...request }).plan(await m.core.config.load());
  // The core reaches no account.
  await assert.rejects(
    plan({ channel: 'core', account: 'acme/gmail' }),
    refused('USAGE', /`account` is not an option of the agentcomms \(core\) server/),
  );
  // Two pins that disagree.
  await assert.rejects(
    plan({ channel: 'slack', account: 'acme/slack', workspace: 'other/slack' }),
    refused('USAGE', /`account` and `workspace` both pin the Slack server, to different accounts/),
  );
  await assert.rejects(
    plan({ channel: 'gmail', account: 'acme/gmail', inbox: 'other/gmail' }),
    refused('USAGE', /`account` and `inbox` both pin the Gmail server/),
  );
  // An account that is not there, or not this channel's.
  await assert.rejects(
    plan({ channel: 'gmail', account: 'nobody/gmail' }),
    refused('NOT_FOUND', /no inbox called "nobody\/gmail"/),
  );
  await assert.rejects(
    plan({ channel: 'slack', account: 'nobody/slack' }),
    refused('NOT_FOUND', /no account called "nobody\/slack"/),
  );
  await assert.rejects(
    plan({ channel: 'gmail', account: 'acme/slack' }),
    refused('NOT_FOUND', /no inbox called "acme\/slack"/),
  );
});

test('a pin naming another platform’s account is refused, in the channel’s words', async () => {
  const m = machine();
  // Version 1 names are plain words, so the name alone cannot say which platform an account is on.
  const v1 = parseConfig(
    JSON.stringify({
      version: 1,
      accounts: { team: { ...account, id: 'acc_TTTTTTTTTTTTTTTT', platform: 'teams' }, acme: account },
    }),
  ) as Config;
  for (const request of [{ workspace: 'team' }, { account: 'team' }]) {
    await assert.rejects(
      async () => serverInstallChange(m.core, m.env, { client: 'cursor', channel: 'slack', ...request }).plan(v1),
      refused('USAGE', /^"team" is not a Slack workspace$/),
    );
  }
  await serverInstallChange(m.core, m.env, {
    client: 'cursor',
    channel: 'slack',
    account: 'acme',
    launcher: 'npx',
  }).plan(v1);
});

/** A channel pinned by the generic flag, as Resend and WhatsApp are: its manifest, and its server's facts. */
const NEWCOMER: ChannelManifest = {
  contract: 1,
  channel: 'newcomer',
  label: 'Newcomer',
  binary: 'agent-newcomer',
  server: { defaultName: 'newcomer', npxPackage: '@agentcomms/newcomer', npxArgs: ['mcp'] },
  accounts: {
    map: 'accounts',
    noun: 'account',
    modes: ['read', 'send'],
    guarantee: { ceiling: 'grant', floor: 'code', why: 'no read-only key' },
  },
  narrowing: [{ option: 'account', flag: '--account', kind: 'pin' }],
  rivals: { word: 'newcomer', can: 'send through Newcomer' },
  hosts: ['api.newcomer.test'],
  approve: 'agent-newcomer approve',
  skills: { prefix: 'newcomer-', contract: 'skills/_shared/contract-newcomer.md' },
};

test('a channel pinned by `--account` writes it, reads it back, and keeps it through a replacement', async () => {
  const facts = serverFactsOf({ packageName: '@agentcomms/newcomer', manifest: NEWCOMER });
  assert.deepEqual(facts.serverArgs({ client: 'json', account: 'acme/newcomer' }), ['--account', 'acme/newcomer']);
  // Another channel's names for its pin are not this one's.
  assert.deepEqual(
    facts.serverArgs({ client: 'json', inbox: 'acme/gmail', workspace: 'acme/slack', readOnly: true }),
    [],
  );
  assert.deepEqual(facts.narrowingOf(['mcp', '--account', 'acme/newcomer']), { account: 'acme/newcomer' });

  const m = machine();
  mkdirSync(join(m.home, '.cursor'), { recursive: true });
  writeFileSync(
    join(m.home, '.cursor', 'mcp.json'),
    JSON.stringify({
      mcpServers: {
        newcomer: { command: 'npx', args: ['-y', '@agentcomms/newcomer@0.0.1', 'mcp', '--account', 'acme/newcomer'] },
      },
    }),
  );
  const product: McpProduct = { ...facts, version: '0.0.2', moduleUrl: '' };
  const preflight = await preflightInstall({ env: m.env, core: m.core }, product, {
    client: 'cursor',
    launcher: 'npx',
    force: true,
  });
  assert.deepEqual(preflight.kept, ['--account', 'acme/newcomer'], 'the upgrade keeps the pin it replaces');
  assert.equal(preflight.effective.account, 'acme/newcomer');
});

// ── The send policy of an account ───────────────────────────────────────────────────────────────────────────────

test('effectiveAccountSendPolicy: the account’s own, else the default — by name, and never through the prototype', () => {
  const config: Config = parseConfig(
    JSON.stringify({
      version: 2,
      defaults: { sendPolicy: 'confirm' },
      accounts: {
        'acme/slack': { ...account, sendPolicy: 'never' },
        'zed/slack': { ...account, id: 'acc_ZZZZZZZZZZZZZZZZ' },
      },
    }),
  );
  assert.equal(effectiveAccountSendPolicy(config, 'acme/slack'), 'never');
  assert.equal(effectiveAccountSendPolicy(config, 'zed/slack'), 'confirm');
  assert.equal(effectiveAccountSendPolicy(config, 'nobody/slack'), 'confirm');
  assert.equal(effectiveAccountSendPolicy(config, 'constructor'), 'confirm');
});
