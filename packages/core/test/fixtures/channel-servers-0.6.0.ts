/*
 * The channel table exactly as 0.6.0 wrote it by hand (e092fa9: `src/channel-servers.ts` and the detectors in
 * `src/other-servers.ts`), kept verbatim as the golden reference the manifest-derived table is held to. Do not edit:
 * a change here is a change to what "the same behaviour" means.
 */
import { displayUrl, type RegisteredServer } from '../../src/mcp-clients.ts';
import { isProductServer, type McpProduct } from '../../src/mcp-install.ts';

/**
 * Other MCP servers for the same service, registered on this machine, which send with no approval step.
 *
 * Everything this suite does about approval assumes it is the only route to Gmail's send endpoints and to Slack's
 * posting methods. Another server with its own send tools does not break that so much as stand beside it: an agent
 * uses whichever tool it finds. So registering a server says what else is there, and `doctor` does too.
 *
 * These lived in the Gmail and Slack packages, and only their own `mcp install` warned; registering the same server
 * from chat — the core server's `comms_server_install`, which builds the product from `CHANNEL_SERVERS` and cannot
 * import a channel package — said nothing about the very servers the warning exists for. They are facts about
 * the services rather than about either package's code, so they are here, beside the rest of each channel's facts,
 * and every surface that registers a server warns the same way.
 */

// ── Gmail ───────────────────────────────────────────────────────────────────────────────────────────────────────

interface LegacyServerFinding extends RegisteredServer {
  /** The npm package that makes this a finding; `name` stays the client's own name for the entry. */
  packageName: string;
  /** Why it is a problem, in one sentence. */
  reason: string;
  removal: string;
}

/** Third-party Gmail servers known to send mail with no approval step. */
const UNGATED_GMAIL_SERVERS: ReadonlyArray<{ pattern: RegExp; name: string }> = [
  { pattern: /@artymclabin\/gmail-mcp/, name: '@artymclabin/gmail-mcp' },
  {
    pattern: /@gongrzhe\/server-gmail-autoauth-mcp|(?<![\w@/-])server-gmail-autoauth-mcp/,
    name: '@gongrzhe/server-gmail-autoauth-mcp',
  },
  { pattern: /@shinzolabs\/gmail-mcp/, name: '@shinzolabs/gmail-mcp' },
];

function gmailRemoval({ client, name: server, path, scope }: RegisteredServer): string {
  // A project's entry is out of reach of the user-scope commands below, run from wherever `doctor` was.
  if (scope === 'project') return `remove "${server}" from the project entry in ${path} by hand`;
  switch (client) {
    case 'claude-code':
      return `claude mcp remove ${server}`;
    case 'codex':
      return `codex mcp remove ${server}`;
    default:
      // The file named, not "the file above": this is printed under a different client's install, and by
      // `doctor` in a list of several, where the file above is somebody else's.
      return `remove the "${server}" entry from ${path}, then restart ${client}`;
  }
}

/** Registered servers known to send mail with no approval step, each with why it matters and how to remove it. */
export function findUngatedGmailServers(servers: readonly RegisteredServer[]): LegacyServerFinding[] {
  const findings: LegacyServerFinding[] = [];
  for (const server of servers) {
    const line = [server.command, ...server.args].join(' ');
    const known = UNGATED_GMAIL_SERVERS.find((candidate) => candidate.pattern.test(line));
    if (!known) continue;
    findings.push({
      ...server,
      packageName: known.name,
      reason: `${known.name} exposes send tools that no approval step gates`,
      removal: gmailRemoval(server),
    });
  }
  return findings;
}

/** What registering the Gmail server says about them: one line each. */
export function gmailServerWarnings(servers: readonly RegisteredServer[]): string[] {
  return findUngatedGmailServers(servers).map(
    (finding) =>
      `${finding.packageName} is registered with ${finding.client} as "${finding.name}": ${finding.reason}. Remove it: ${finding.removal}`,
  );
}

// ── Slack ───────────────────────────────────────────────────────────────────────────────────────────────────────

/**
 * Other Slack MCP servers registered on this machine.
 *
 * A `read` token of ours cannot post whatever else is installed — but that was never the point. Another Slack server
 * posts with its own token — `@modelcontextprotocol/server-slack` with a bot token in its env, the official one at
 * `mcp.slack.com` — and an agent uses whichever tool it finds.
 *
 * Matched on the word rather than on a list of packages. There are at least half a dozen such servers and more
 * each month, and a list is out of date the day it is written; a false "also registered" costs a glance, a
 * missed one costs the guarantee. The client's own `url` is read too, because the official server has nothing
 * else to match. What stays invisible is anything that does not say "slack" at all — a bridge that relays to
 * several services — and anything a client gets from somewhere other than its config file.
 */
export function findOtherSlackServers(
  servers: readonly RegisteredServer[],
  product: Pick<McpProduct, 'packageName' | 'npxPackage' | 'entryFiles' | 'binary' | 'bins'>,
): RegisteredServer[] {
  return servers.filter(
    (server) =>
      !isProductServer(server, product) &&
      /slack/i.test([server.name, server.command, ...server.args, server.url ?? ''].join(' ')),
  );
}

/**
 * One line naming a server: its name, client and what it runs — never its arguments or env, which may carry a
 * token, and of a URL only its host and path. A remote server's URL is often the credential itself, and this
 * line goes into `doctor --json`, which the skills tell agents to run.
 */
export function describeOtherSlackServer(server: RegisteredServer): string {
  const what = (server.url ? displayUrl(server.url) : undefined) ?? server.packageName;
  return `"${server.name}" in ${server.client}${what ? ` (${what})` : ''}`;
}

/** How to remove another Slack server, in the client's own terms. */
export function otherSlackServerRemoval(server: RegisteredServer): string {
  // A project's entry is out of reach of the user-scope commands below, run from wherever `doctor` was.
  if (server.scope === 'project') return `remove "${server.name}" from the project entry in ${server.path} by hand`;
  switch (server.client) {
    case 'claude-code':
      return `claude mcp remove ${server.name}`;
    case 'codex':
      return `codex mcp remove ${server.name}`;
    default:
      return `remove "${server.name}" from ${server.path}, then restart ${server.client}`;
  }
}

/** What registering the Slack server says about them: one line each. */
export function slackServerWarnings(
  servers: readonly RegisteredServer[],
  product: Pick<McpProduct, 'packageName' | 'npxPackage' | 'entryFiles' | 'binary' | 'bins'>,
): string[] {
  return findOtherSlackServers(servers, product).map(
    (server) =>
      `${describeOtherSlackServer(server)} can post to Slack with no approval step from this package. Remove it if this is meant to be the only route.`,
  );
}

/**
 * The MCP servers this suite ships, and what the shared installer needs to know to register each one.
 *
 * One list, read by every installer. `agent-gmail mcp install` and `agent-slack mcp install` register their own
 * server; the core server's `comms_server_install` registers any of the three. Each package used to keep these facts
 * beside its own installer, and a second installer holding a copy would have been a second place for a package name,
 * a flag or an npx argument to drift — the Slack entry once started `agent-slack --workspace acme` with no command at
 * all, because a shared default was wrong for one product. So the channel packages spread these, and add only what
 * is theirs: the version they are, and where their own code lives.
 *
 * What each warns about is here too: the other servers for the same service that send with no approval step. It was
 * the one fact the channels kept to themselves, so registering Gmail from chat warned about nothing while
 * `agent-gmail mcp install` warned about exactly those servers — the same registration, telling a person less on one
 * surface. The detectors are data about the services (`other-servers.ts`), not code from the channel packages.
 */
type Channel = 'core' | 'gmail' | 'slack';

export const GOLDEN_CHANNELS: readonly Channel[] = Object.freeze(['core', 'gmail', 'slack']);

/** Everything about a server except the version being installed and where its code lives. */
type ServerFacts = Omit<McpProduct, 'version' | 'moduleUrl'>;

const flagValue = (args: readonly string[], flag: string): string | undefined =>
  args.includes(flag) ? args[args.indexOf(flag) + 1] : undefined;

export const GOLDEN_CHANNEL_SERVERS: Readonly<Record<Channel, ServerFacts>> = Object.freeze({
  /*
   * The core server, which installs and manages the others. It is the whole CLI, like Slack's, so `npx` runs it with
   * `mcp`; and it reaches no account, so there is nothing to pin and nothing to narrow.
   */
  core: {
    packageName: '@agentcomms/core',
    binary: 'agentcomms',
    defaultServerName: 'agentcomms',
    npxPackage: '@agentcomms/core',
    npxArgs: ['mcp'],
    serverArgs: () => [],
    narrowingOf: () => ({}),
  },
  gmail: {
    packageName: '@agentcomms/gmail',
    binary: 'agent-gmail',
    defaultServerName: 'gmail',
    npxPackage: '@agentcomms/gmail-mcp',
    // The published `agent-gmail-mcp` bin: not what the installer writes, but a real way to run this server —
    // by its path inside a package, or by its name when installed globally.
    entryFiles: [['node_modules', '@agentcomms', 'gmail-mcp', 'dist', 'server.mjs']],
    bins: ['agent-gmail-mcp'],
    serverArgs: (options) => {
      const args: string[] = [];
      if (options.inbox) args.push('--inbox', options.inbox);
      if (options.readOnly) args.push('--read-only');
      return args;
    },
    // Read back as the doctor's repair reads them, so `--force` keeps what a registered entry narrowed.
    narrowingOf: (args) => {
      const inbox = flagValue(args, '--inbox');
      return { ...(inbox ? { inbox } : {}), ...(args.includes('--read-only') ? { readOnly: true } : {}) };
    },
    // Third-party Gmail servers whose send tools no approval gates.
    warnAbout: gmailServerWarnings,
  },
  slack: {
    packageName: '@agentcomms/slack',
    binary: 'agent-slack',
    defaultServerName: 'slack',
    /*
     * The package itself, not a thin `-mcp` wrapper.
     *
     * Gmail ships `@agentcomms/gmail-mcp` so an `npx` launcher downloads a small package rather than the whole CLI.
     * Slack has no such package, so `npx` fetches this one; saying so here is better than pointing at a name that
     * does not exist on the registry, which is a launcher that fails only on the machine that chose it.
     */
    npxPackage: '@agentcomms/slack',
    // …and because it is the whole CLI, the server is its `mcp` command.
    npxArgs: ['mcp'],
    serverArgs: (options) => (options.workspace ? ['--workspace', options.workspace] : []),
    // Read back as the doctor's repair reads it, so `--force` keeps the workspace a registered entry was pinned to.
    narrowingOf: (args) => {
      const workspace = flagValue(args, '--workspace');
      return workspace ? { workspace } : {};
    },
    /*
     * Our own `read` token cannot post, whatever else is installed — but that was never the point. Another Slack
     * server posts with *its* token, and an agent uses whichever tool it finds; every approval step here stands
     * beside that route rather than in front of it. Told apart from this server by these same facts, read when a
     * registration asks rather than while this table is being built.
     */
    warnAbout: (servers) => slackServerWarnings(servers, GOLDEN_CHANNEL_SERVERS.slack),
  },
});

/** How each server is named to a person: in a preview, and in what a tool returns. */
export const GOLDEN_CHANNEL_LABELS: Readonly<Record<Channel, string>> = Object.freeze({
  core: 'agentcomms (core)',
  gmail: 'Gmail',
  slack: 'Slack',
});
