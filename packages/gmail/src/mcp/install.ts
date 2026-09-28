import {
  CHANNEL_SERVERS,
  type InstallOptions,
  type InstallResult,
  mcpInstall as install,
  isProductServer,
  type Launcher,
  listRegisteredServers,
  type McpProduct,
  missingEntryFile,
  type PruneResult,
  pruneManagedRuntimes,
  type RegisteredServer,
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
 * What `setup` counts as its agent step done: some entry of ours, for any mailbox. Not what a finish decides by —
 * that is whether the entry serves the mailbox it has just connected, `clientServesInbox`. A config that cannot be
 * read is left out rather than failing: for "which clients have it" the answer is the ones that could be read.
 */
export async function clientsRegisteredWith(env: NodeJS.ProcessEnv): Promise<string[]> {
  try {
    const servers = await listRegisteredServers(env);
    return [...new Set(servers.filter((server) => isProductServer(server, GMAIL_MCP)).map((server) => server.client))];
  } catch {
    return [];
  }
}

/**
 * Whether `client` already has an entry of this server that serves `inbox` — what a finish checks before it makes
 * the registration `setup` asked for, and what `gmail_inbox_finish` checks before it hands one back.
 *
 * Only the entry that registration would find in its place counts: of ours, by core's one rule for that; at user
 * scope, the only one it writes; under the name it would use; unpinned, or pinned to exactly this mailbox; and still
 * able to start, by the doctor's own check (`missingEntryFile`). The client's name alone used to decide it, so an
 * entry pinned to another mailbox, a project's entry, one under another name, or one whose runtime had been deleted
 * made the finish say "already registered" — for a mailbox connected a moment ago that no server reached, in a
 * report that read as success. In every other case the registration goes ahead, and its own preflight refuses what
 * it must not replace: somebody else's server under that name, or ours without `--replace-server`.
 *
 * A config that cannot be read counts as not serving it: the registration is then made, and the installer refuses
 * it if the unread file is the one it would write.
 */
export async function clientServesInbox(
  env: NodeJS.ProcessEnv,
  request: { client: string; inbox: string; name?: string | undefined },
): Promise<boolean> {
  let servers: RegisteredServer[];
  try {
    servers = await listRegisteredServers(env);
  } catch {
    return false;
  }
  const name = request.name ?? GMAIL_MCP.defaultServerName;
  for (const server of servers) {
    if (server.client !== request.client || server.name !== name || server.scope === 'project') continue;
    if (!isProductServer(server, GMAIL_MCP)) continue;
    // Read as the installer reads a pin back, in either form: `--inbox work` and `--inbox=work`.
    const pin = GMAIL_MCP.narrowingOf(server.args).inbox;
    if (pin !== undefined && pin !== request.inbox) continue;
    if ((await missingEntryFile(server)) === null) return true;
  }
  return false;
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
