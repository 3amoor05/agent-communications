/**
 * The library entry of `@agentcomms/gmail`.
 *
 * It is deliberately small. Everything else in this package is reached through the `agent-gmail` command or through
 * the MCP server, and both are shipped as a bundle whose internals no caller can import — so the public API here
 * stays a contract we can keep, rather than the whole internal surface.
 */

import type { PathOverrides } from '@agentcomms/core';
import { createGmailMcpServer as createServer, type GmailMcpOptions } from './mcp/server.ts';
import { redirectConsoleToStderr } from './mcp/stdio-entry.ts';
import { VERSION } from './version.ts';

export { VERSION };
export const PACKAGE_NAME = '@agentcomms/gmail';

/**
 * A module of this package, for locating the Gmail CLI from code that is not in it: the `@agentcomms/gmail-mcp`
 * wrapper, whose own modules belong to the wrapper and would locate it instead (CUE-403). With `PACKAGE_NAME`, it is
 * the caller a command for Gmail is located from.
 */
export const RESOLVER_URL: string = import.meta.url;

/** What a host gets back: enough to serve the tools and to stop again, and nothing that ties it to an SDK version. */
export interface GmailMcpHandle {
  /** Serves MCP on this process's stdin and stdout, and resolves when the client disconnects. */
  connectStdio(): Promise<void>;
  close(): Promise<void>;
}

export interface CreateGmailMcpServerOptions {
  /** Where the configuration lives; defaults to the usual per-user location. */
  env?: NodeJS.ProcessEnv | undefined;
  /** Canonical suite directories supplied by a CLI or installer-written server entry. */
  pathOverrides?: PathOverrides | undefined;
  /** Serve only this mailbox. */
  inbox?: string | undefined;
  /** Register only the tools that cannot change anything. */
  readOnly?: boolean | undefined;
}

/**
 * Builds the Gmail MCP server. The `@agentcomms/gmail-mcp` package is one call to this, and a host embedding the
 * server should use it the same way:
 *
 * ```js
 * const server = await createGmailMcpServer();
 * await server.connectStdio();
 * ```
 */
export async function createGmailMcpServer(options: CreateGmailMcpServerOptions = {}): Promise<GmailMcpHandle> {
  // On stdio, stdout carries the protocol: anything else printed there breaks the connection.
  redirectConsoleToStderr();
  const built = await createServer(options as GmailMcpOptions);
  return {
    connectStdio: () => built.connectStdio(),
    close: () => built.close(),
  };
}
