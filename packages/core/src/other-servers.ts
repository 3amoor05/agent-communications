import type { ChannelManifest, ChannelRivalPackage } from './channel-manifest.ts';
import { CHANNEL_SNAPSHOT } from './channels.generated.ts';
import { displayUrl, type RegisteredServer } from './mcp-clients.ts';
import { isProductServer, type McpProduct } from './mcp-install.ts';

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
 * the services rather than about either package's code, so each channel declares them in its manifest (`rivals`),
 * and the detectors here read them from core's snapshot: every surface that registers a server warns the same way,
 * and a new channel warns about its own rivals by declaring them.
 */

// ── Gmail ───────────────────────────────────────────────────────────────────────────────────────────────────────

export interface LegacyServerFinding extends RegisteredServer {
  /** The npm package that makes this a finding; `name` stays the client's own name for the entry. */
  packageName: string;
  /** Why it is a problem, in one sentence. */
  reason: string;
  removal: string;
}

/**
 * A pattern for each package a channel's manifest names as a rival (`rivals.packages`).
 *
 * A scoped name matches anywhere on the command line — `npx -y @shinzolabs/gmail-mcp@1.2.3` — and, with `unscoped`,
 * so does the bare name, as a word of its own: `npx server-gmail-autoauth-mcp`, but not `@someone/server-gmail-…`.
 */
function rivalPatterns(packages: readonly ChannelRivalPackage[]): ReadonlyArray<{ pattern: RegExp; name: string }> {
  return packages.map(({ name, unscoped }) => {
    const bare = name.includes('/') ? name.slice(name.indexOf('/') + 1) : name;
    const whole = name.startsWith('@') ? escapeRegExp(name) : `(?<![\\w@/-])${escapeRegExp(name)}`;
    const alone = unscoped && name.startsWith('@') ? `|(?<![\\w@/-])${escapeRegExp(bare)}` : '';
    return { pattern: new RegExp(`${whole}${alone}`), name };
  });
}

function escapeRegExp(text: string): string {
  return text.replace(/[\\^$.*+?()[\]{}|/]/g, '\\$&');
}

/** The rivals a channel's manifest declares, read from core's snapshot. */
function rivalsOf(channel: string): NonNullable<ChannelManifest['rivals']> {
  return CHANNEL_SNAPSHOT.find((entry) => entry.manifest.channel === channel)?.manifest.rivals ?? {};
}

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

/**
 * Registered servers that are one of `packages` — another server for the same service whose send tools no approval
 * step gates — each with why it matters and how to remove it.
 */
export function findRivalPackageServers(
  servers: readonly RegisteredServer[],
  packages: readonly ChannelRivalPackage[],
): LegacyServerFinding[] {
  const patterns = rivalPatterns(packages);
  const findings: LegacyServerFinding[] = [];
  for (const server of servers) {
    const line = [server.command, ...server.args].join(' ');
    const known = patterns.find((candidate) => candidate.pattern.test(line));
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

/** What registering a server says about the rival packages its manifest names: one line each. */
export function rivalPackageWarnings(
  servers: readonly RegisteredServer[],
  packages: readonly ChannelRivalPackage[],
): string[] {
  return findRivalPackageServers(servers, packages).map(
    (finding) =>
      `${finding.packageName} is registered with ${finding.client} as "${finding.name}": ${finding.reason}. Remove it: ${finding.removal}`,
  );
}

/** Registered servers known to send mail with no approval step, each with why it matters and how to remove it. */
export function findUngatedGmailServers(servers: readonly RegisteredServer[]): LegacyServerFinding[] {
  return findRivalPackageServers(servers, rivalsOf('gmail').packages ?? []);
}

/** What registering the Gmail server says about them: one line each. */
export function gmailServerWarnings(servers: readonly RegisteredServer[]): string[] {
  return rivalPackageWarnings(servers, rivalsOf('gmail').packages ?? []);
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
  return findRivalWordServers(servers, rivalsOf('slack').word ?? 'slack', product);
}

/**
 * Registered servers that name the service's `word` anywhere — their name, command, arguments or URL — and are not
 * `product` itself: a channel's `rivals.word`, for a service with too many other servers to list.
 */
export function findRivalWordServers(
  servers: readonly RegisteredServer[],
  word: string,
  product: Pick<McpProduct, 'packageName' | 'npxPackage' | 'entryFiles' | 'binary' | 'bins'>,
): RegisteredServer[] {
  const pattern = new RegExp(escapeRegExp(word), 'i');
  return servers.filter(
    (server) =>
      !isProductServer(server, product) &&
      pattern.test([server.name, server.command, ...server.args, server.url ?? ''].join(' ')),
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
  const rivals = rivalsOf('slack');
  return rivalWordWarnings(servers, rivals.word ?? 'slack', rivals.can ?? 'post to Slack', product);
}

/** What registering a server says about the servers its manifest's `rivals.word` finds: one line each. */
export function rivalWordWarnings(
  servers: readonly RegisteredServer[],
  word: string,
  can: string,
  product: Pick<McpProduct, 'packageName' | 'npxPackage' | 'entryFiles' | 'binary' | 'bins'>,
): string[] {
  return findRivalWordServers(servers, word, product).map(
    (server) =>
      `${describeOtherSlackServer(server)} can ${can} with no approval step from this package. Remove it if this is meant to be the only route.`,
  );
}
