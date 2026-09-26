import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseChannelEntries } from '../src/channel-manifest.ts';
import {
  CHANNEL_LABELS,
  CHANNEL_SERVERS,
  CHANNELS,
  channelManifest,
  narrowingArgs,
  narrowingFromArgs,
} from '../src/channel-servers.ts';
import { CHANNEL_SNAPSHOT } from '../src/channels.generated.ts';
import type { RegisteredServer } from '../src/mcp-clients.ts';
import { type InstallOptions, isProductServer, managedRuntimeEntry, type SupportedClient } from '../src/mcp-install.ts';
import {
  describeOtherSlackServer,
  findOtherSlackServers,
  findUngatedGmailServers,
  gmailServerWarnings,
  otherSlackServerRemoval,
  slackServerWarnings,
} from '../src/other-servers.ts';
import * as golden from './fixtures/channel-servers-0.6.0.ts';

/*
 * The channel table is derived from each channel's manifest now (design 2026-09-26), and nothing a person sees may
 * change because of it: the flags a registration writes, what `--force` keeps, what a registration warns about and
 * which entries count as ours. So the derived table is held here to 0.6.0's hand-written one, kept verbatim in
 * `fixtures/channel-servers-0.6.0.ts`, over every combination the installer can be asked for.
 */

const CHANNEL_NAMES = ['core', 'gmail', 'slack'] as const;

test('the channels, their labels and their static facts are exactly the hand-written table’s', () => {
  assert.deepEqual([...CHANNELS], [...golden.GOLDEN_CHANNELS]);
  assert.deepEqual({ ...CHANNEL_LABELS }, { ...golden.GOLDEN_CHANNEL_LABELS });
  for (const channel of CHANNEL_NAMES) {
    const { serverArgs: _a, narrowingOf: _n, warnAbout: derivedWarn, ...derived } = CHANNEL_SERVERS[channel];
    const {
      serverArgs: _b,
      narrowingOf: _m,
      warnAbout: goldenWarn,
      ...expected
    } = golden.GOLDEN_CHANNEL_SERVERS[channel];
    assert.deepEqual(derived, expected, channel);
    assert.equal(typeof derivedWarn, typeof goldenWarn, `${channel} warns, or does not, as before`);
  }
});

/** Every value each narrowing option can take, including the ones that must write nothing. */
const PINS = [undefined, '', 'acme/gmail', 'acme/slack', 'wf/gmail-tech', 'odd value with spaces'];
const SWITCHES = [undefined, false, true];
const CLIENTS: SupportedClient[] = ['claude-code', 'json'];

function* everyOption(): Generator<InstallOptions> {
  for (const client of CLIENTS)
    for (const inbox of PINS)
      for (const workspace of PINS)
        for (const readOnly of SWITCHES) {
          yield {
            client,
            ...(inbox === undefined ? {} : { inbox }),
            ...(workspace === undefined ? {} : { workspace }),
            ...(readOnly === undefined ? {} : { readOnly }),
          };
        }
}

test('serverArgs: every flag combination writes the arguments it always wrote', () => {
  let checked = 0;
  for (const channel of CHANNEL_NAMES) {
    for (const options of everyOption()) {
      assert.deepEqual(
        CHANNEL_SERVERS[channel].serverArgs(options),
        golden.GOLDEN_CHANNEL_SERVERS[channel].serverArgs(options),
        `${channel} ${JSON.stringify(options)}`,
      );
      checked += 1;
    }
  }
  assert.equal(checked, CHANNEL_NAMES.length * CLIENTS.length * PINS.length * PINS.length * SWITCHES.length);
});

test('narrowingOf: what an entry’s arguments carry reads back as before, and round-trips through serverArgs', () => {
  for (const channel of CHANNEL_NAMES) {
    const derived = CHANNEL_SERVERS[channel];
    const expected = golden.GOLDEN_CHANNEL_SERVERS[channel];
    for (const options of everyOption()) {
      const args = expected.serverArgs(options);
      assert.deepEqual(derived.narrowingOf(args), expected.narrowingOf(args), `${channel} ${JSON.stringify(args)}`);
      // Round trip: what is read back from an entry writes that entry's flags again.
      assert.deepEqual(derived.serverArgs({ client: 'json', ...derived.narrowingOf(args) }), args);
    }
    // Entries nobody wrote with this installer: a trailing flag, a repeated one, flags mixed with other words.
    for (const args of [
      [],
      ['mcp'],
      ['--inbox'],
      ['--workspace'],
      ['--inbox', 'a/gmail', '--inbox', 'b/gmail'],
      ['--workspace', 'a/slack', '--workspace', 'b/slack'],
      ['/opt/cli.mjs', 'mcp', '--read-only', '--inbox', 'x/gmail'],
      ['--inbox', '--read-only'],
      ['--workspace', '', '--read-only'],
      ['-y', '@agentcomms/slack@0.6.0', 'mcp', '--workspace', 'acme/slack'],
      ['--read-only=true', '--inbox=x/gmail'],
    ]) {
      assert.deepEqual(derived.narrowingOf(args), expected.narrowingOf(args), `${channel} ${JSON.stringify(args)}`);
    }
  }
});

/** A registered entry, as a client scan reports one. */
function entry(over: Partial<RegisteredServer> & Pick<RegisteredServer, 'name'>): RegisteredServer {
  return { client: 'cursor', path: '/cfg/.cursor/mcp.json', command: 'npx', args: [], scope: 'user', ...over };
}

/**
 * The entries the existing suites register, and the near misses around them: every rival package, scoped and bare;
 * other Slack servers found by name, command, argument or URL; and our own servers, which are never a rival.
 */
const FIXTURES: RegisteredServer[] = [
  entry({ name: 'old-gmail', args: ['-y', '@artymclabin/gmail-mcp'] }),
  entry({ name: 'gmail-old', client: 'claude-desktop', args: ['-y', '@artymclabin/gmail-mcp@1.2.3'] }),
  entry({ name: 'autoauth', args: ['@gongrzhe/server-gmail-autoauth-mcp'] }),
  entry({ name: 'bare-autoauth', client: 'claude-code', args: ['-y', 'server-gmail-autoauth-mcp'] }),
  entry({ name: 'bare-autoauth-command', client: 'codex', command: 'server-gmail-autoauth-mcp', args: [] }),
  entry({ name: 'not-autoauth', args: ['-y', '@someone/server-gmail-autoauth-mcp'] }),
  entry({ name: 'not-autoauth-either', args: ['-y', 'my-server-gmail-autoauth-mcp'] }),
  entry({ name: 'gmail', client: 'codex', args: ['-y', '@shinzolabs/gmail-mcp'], scope: 'project' }),
  entry({ name: 'unscoped-shinzo', args: ['-y', 'gmail-mcp'] }),
  entry({ name: 'notagentcomms', args: ['-y', '@notagentcomms/gmail-mcp'] }),
  entry({
    name: 'team-slack',
    args: ['-y', '@modelcontextprotocol/server-slack'],
    packageName: '@modelcontextprotocol/server-slack',
    env: { SLACK_BOT_TOKEN: 'fake-bot-token-2' },
  }),
  entry({ name: 'official', command: '', args: [], url: 'https://mcp.slack.com/mcp', type: 'http' }),
  entry({ name: 'chat', command: '/usr/local/bin/SLACK-bridge', args: [] }),
  entry({ name: 'Slack Helper', command: 'node', args: ['/opt/helper.js'] }),
  entry({ name: 'relay', command: 'node', args: ['/opt/relay.js', '--to', 'slack'], scope: 'project' }),
  entry({ name: 'hermes-remote', command: 'node', args: ['/opt/hermes/bridge.js'] }),
  entry({ name: 'slack', client: 'claude-code', command: 'agent-slack', args: ['mcp', '--workspace', 'acme/slack'] }),
  entry({
    name: 'slack-managed',
    command: '/usr/bin/node',
    args: [managedRuntimeEntry('/data', '@agentcomms/slack', '0.6.0'), 'mcp'],
  }),
  entry({ name: 'slack-npx', args: ['-y', '@agentcomms/slack@0.6.0', 'mcp'], packageName: '@agentcomms/slack' }),
  entry({ name: 'slack-checkout', command: 'node', args: ['/src/agent-communications/packages/slack/src/cli.ts'] }),
  entry({ name: 'gmail-ours', command: 'agent-gmail-mcp', args: ['--inbox', 'acme/gmail'] }),
  entry({ name: 'agentcomms', args: ['-y', '@agentcomms/core@0.6.0', 'mcp'], packageName: '@agentcomms/core' }),
];

test('rival warnings: every channel warns about exactly the servers it warned about, in the same words', () => {
  for (const channel of CHANNEL_NAMES) {
    const derived = CHANNEL_SERVERS[channel].warnAbout?.(FIXTURES);
    const expected = golden.GOLDEN_CHANNEL_SERVERS[channel].warnAbout?.(FIXTURES);
    assert.deepEqual(derived, expected, channel);
    // One at a time as well, so an empty list on both sides cannot hide a fixture that matches nothing.
    for (const fixture of FIXTURES) {
      assert.deepEqual(
        CHANNEL_SERVERS[channel].warnAbout?.([fixture]),
        golden.GOLDEN_CHANNEL_SERVERS[channel].warnAbout?.([fixture]),
        `${channel}: ${fixture.name}`,
      );
    }
  }
  // The fixtures exercise both detectors: several rivals each, and several that are not.
  assert.equal(golden.gmailServerWarnings(FIXTURES).length, 6);
  assert.ok(golden.findOtherSlackServers(FIXTURES, golden.GOLDEN_CHANNEL_SERVERS.slack).length >= 5);
});

test('the doctors’ detectors, now read from the manifests, find and describe what they found before', () => {
  assert.deepEqual(findUngatedGmailServers(FIXTURES), golden.findUngatedGmailServers(FIXTURES));
  assert.deepEqual(gmailServerWarnings(FIXTURES), golden.gmailServerWarnings(FIXTURES));
  const product = golden.GOLDEN_CHANNEL_SERVERS.slack;
  assert.deepEqual(findOtherSlackServers(FIXTURES, product), golden.findOtherSlackServers(FIXTURES, product));
  assert.deepEqual(slackServerWarnings(FIXTURES, product), golden.slackServerWarnings(FIXTURES, product));
  for (const fixture of FIXTURES) {
    assert.equal(describeOtherSlackServer(fixture), golden.describeOtherSlackServer(fixture));
    assert.equal(otherSlackServerRemoval(fixture), golden.otherSlackServerRemoval(fixture));
  }
});

test('isProductServer: the same entries are ours, for every channel', () => {
  const near: RegisteredServer[] = [
    ...FIXTURES,
    entry({ name: 'evil', command: 'node', args: ['/opt/node_modules/@agentcomms/slack-evil/dist/cli.mjs'] }),
    entry({ name: 'evil-bin', command: 'agent-slack-evil', args: ['mcp'] }),
    entry({ name: 'npx-bare', args: ['-y', 'agent-slack', 'mcp'] }),
    entry({ name: 'win', command: 'C:\\tools\\npm\\agent-slack.cmd', args: ['mcp'] }),
    entry({ name: 'gmail-lib', command: 'node', args: ['/opt/node_modules/@agentcomms/gmail/dist/index.mjs'] }),
    entry({
      name: 'gmail-mcp-entry',
      command: 'node',
      args: ['/opt/node_modules/@agentcomms/gmail-mcp/dist/server.mjs'],
    }),
    entry({ name: 'gmail-cli', command: 'node', args: ['/r/packages/gmail/src/cli.ts'] }),
    entry({ name: 'gmail-nested', command: 'node', args: ['/r/packages/gmail/src/nested/cli.ts'] }),
    entry({ name: 'core-cli', command: 'node', args: ['/r/packages/core/dist/cli.mjs', 'mcp'] }),
    entry({ name: 'url-only', command: '', args: [] }),
  ];
  for (const channel of CHANNEL_NAMES) {
    for (const server of near) {
      assert.equal(
        isProductServer(server, CHANNEL_SERVERS[channel]),
        isProductServer(server, golden.GOLDEN_CHANNEL_SERVERS[channel]),
        `${channel}: ${server.name}`,
      );
    }
  }
});

// ── The manifests themselves ─────────────────────────────────────────────────────────────────────────────────────

const valid = () => structuredClone(CHANNEL_SNAPSHOT.map(({ packageName, manifest }) => ({ packageName, manifest })));

test('the snapshot is a valid set of manifests, and narrowing is read off its data', () => {
  assert.deepEqual(parseChannelEntries(valid()), CHANNEL_SNAPSHOT);
  const gmail = channelManifest('gmail');
  assert.ok(gmail);
  assert.deepEqual(narrowingArgs(gmail, { client: 'json', inbox: 'a/gmail', readOnly: true }), [
    '--inbox',
    'a/gmail',
    '--read-only',
  ]);
  assert.deepEqual(narrowingFromArgs(gmail, ['--read-only']), { readOnly: true });
  assert.equal(channelManifest('discord'), undefined);
});

/** The problems `parseChannelEntries` reports after `edit` is applied to the committed manifests. */
function problemsAfter(edit: (entries: ReturnType<typeof valid>) => void): string {
  const entries = valid();
  edit(entries);
  try {
    parseChannelEntries(entries);
    return '';
  } catch (error) {
    return (error as Error).message;
  }
}

/** A manifest by channel, writable. */
type Writable = Record<string, unknown> &
  Record<'server' | 'rivals' | 'skills', Record<string, unknown>> & {
    accounts?: Record<string, unknown>;
    narrowing: unknown[];
  };
const at = (entries: ReturnType<typeof valid>, channel: string): Writable =>
  entries.find((e) => e.manifest.channel === channel)?.manifest as unknown as Writable;

test('a manifest is refused for what would make a server, a pin or a skill mean something else', () => {
  const cases: [string, (entries: ReturnType<typeof valid>) => void, RegExp][] = [
    [
      'an unknown key',
      (e) => {
        at(e, 'slack').extra = 1;
      },
      /agentcomms: .*extra|Unrecognized key/,
    ],
    [
      'a mode outside the vocabulary',
      (e) => {
        (at(e, 'slack').accounts as Record<string, unknown>).modes = ['read', 'post'];
      },
      /modes/,
    ],
    [
      'modes out of order',
      (e) => {
        (at(e, 'slack').accounts as Record<string, unknown>).modes = ['send', 'read'];
      },
      /narrow to wide/,
    ],
    [
      'a channel with no pin',
      (e) => {
        at(e, 'slack').narrowing = [];
      },
      /exactly one pin/,
    ],
    [
      'a channel with two pins',
      (e) => void at(e, 'slack').narrowing.push({ option: 'account', flag: '--account', kind: 'pin' }),
      /exactly one pin/,
    ],
    [
      'readOnly as a pin',
      (e) => {
        at(e, 'gmail').narrowing = [{ option: 'readOnly', flag: '--read-only', kind: 'pin' }];
      },
      /one switch/,
    ],
    [
      'a word rival with nothing it can do',
      (e) => {
        delete at(e, 'slack').rivals.can;
      },
      /come together/,
    ],
    [
      'a channel with no accounts',
      (e) => {
        delete at(e, 'slack').accounts;
      },
      /accounts: every channel says this/,
    ],
    [
      'a core with accounts',
      (e) => {
        at(e, 'core').accounts = at(e, 'slack').accounts ?? {};
      },
      /core connects no account/,
    ],
    [
      'an approve that is not its own',
      (e) => {
        at(e, 'slack').approve = 'agent-gmail approve';
      },
      /own command/,
    ],
    [
      'a contract its prefix does not choose',
      (e) => {
        at(e, 'slack').skills.contract = 'skills/_shared/contract-gmail.md';
      },
      /chosen by its prefix/,
    ],
    [
      'another suite’s package',
      (e) => {
        at(e, 'slack').server.npxPackage = 'slack-mcp';
      },
      /this suite/,
    ],
    [
      'a channel word that is not a platform word',
      (e) => {
        at(e, 'slack').channel = 'Slack';
      },
      /platform word/,
    ],
    [
      'a second slack',
      (e) => {
        at(e, 'gmail').channel = 'slack';
      },
      /channel "slack" is @agentcomms\/gmail's too/,
    ],
    [
      'a shared binary',
      (e) => {
        at(e, 'slack').binary = 'agent-gmail';
        at(e, 'slack').approve = 'agent-gmail approve';
      },
      /binary "agent-gmail"/,
    ],
    [
      'a shared server name',
      (e) => {
        at(e, 'slack').server.defaultName = 'gmail';
      },
      /server name "gmail"/,
    ],
    [
      'a shared skill prefix',
      (e) => {
        at(e, 'slack').skills = { prefix: 'gmail-', contract: 'skills/_shared/contract-gmail.md' };
      },
      /skill prefix "gmail-"/,
    ],
    ['no core', (e) => void e.splice(0, 1), /core's manifest appears 0 times/],
    [
      'a contract version this release does not read',
      (e) => {
        at(e, 'slack').contract = 2;
      },
      /contract/,
    ],
  ];
  for (const [what, edit, expected] of cases) assert.match(problemsAfter(edit), expected, what);
});
