import {
  CHANNEL_SERVERS,
  type InstallOptions,
  type InstallResult,
  mcpInstall as install,
  isProductServer,
  type Launcher,
  listRegisteredServers,
  type McpProduct,
  type PruneResult,
  pruneManagedRuntimes,
  type ServerEntry,
  type SupportedClient,
  verifyEntry as verify,
} from '@agentcomms/core';
import type { GmailContext } from '../context.ts';
import { VERSION } from '../version.ts';

/**
 * Registering the Gmail server with an MCP client.
 *
 * The machinery moved to `@agentcomms/core` when Slack needed the same thing — where each client keeps its
 * servers, how a minimal PATH breaks a bare `node`, which npm binary works on Windows. What stayed here is what
 * is actually about Gmail: the package to install, the flags it takes, and the warning about third-party servers
 * whose send tools no approval gates.
 */
export type { InstallOptions, InstallResult, Launcher, PruneResult, ServerEntry, SupportedClient };

/**
 * Exported for the doctor, which reads registered entries back with the same facts that wrote them.
 *
 * The facts themselves — the package, its flags, how an entry is read back, and the warning about other Gmail
 * servers whose send tools nothing gates — are core's `CHANNEL_SERVERS.gmail`, which the core server's
 * `comms_server_install` registers from too, so both surfaces warn alike. What is added here is what only this
 * package knows: its own version, and where its code is.
 */
export const GMAIL_MCP: McpProduct = {
  ...CHANNEL_SERVERS.gmail,
  version: VERSION,
  moduleUrl: import.meta.url,
};

/**
 * The MCP clients whose config files register this server, by core's one rule for what is ours.
 *
 * What `setup` counts as its agent step done, and what a finish checks before it registers the server `setup` asked
 * for — so the two cannot disagree about whether a client already has it. A config that cannot be read is left out
 * rather than failing: for "which clients have it" the answer is the ones that could be read, and a registration
 * made on the strength of that is refused by the installer if the unread file turns out to hold one.
 */
export async function clientsRegisteredWith(env: NodeJS.ProcessEnv): Promise<string[]> {
  try {
    const servers = await listRegisteredServers(env);
    return [...new Set(servers.filter((server) => isProductServer(server, GMAIL_MCP)).map((server) => server.client))];
  } catch {
    return [];
  }
}

export async function mcpInstall(context: GmailContext, options: InstallOptions): Promise<InstallResult> {
  /*
   * The pin is resolved before anything is written.
   *
   * A server pinned to a mailbox that does not exist — or to one renamed since — starts, fails, and says so only
   * in a client's log. This is the one part of the install that needs a Gmail context, which is why it is here
   * rather than in the shared code.
   */
  if (options.inbox) await context.inbox(options.inbox);
  return install(context, GMAIL_MCP, options);
}

export function verifyEntry(entry: ServerEntry): Promise<{ ok: boolean; detail: string }> {
  return verify(entry, { binary: GMAIL_MCP.binary, version: GMAIL_MCP.version });
}

/** Removes Gmail's managed runtimes that nothing registers and nothing runs. */
export function mcpPrune(
  context: GmailContext,
  options: { dryRun?: boolean; includePrinted?: boolean } = {},
): Promise<PruneResult> {
  return pruneManagedRuntimes(context, GMAIL_MCP, options);
}
