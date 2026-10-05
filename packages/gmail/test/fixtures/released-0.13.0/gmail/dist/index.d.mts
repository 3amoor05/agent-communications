//#region src/version.d.ts
/** The package version, read from package.json at build time. */
export declare const VERSION: string;
//#endregion
//#region src/index.d.ts
export declare const PACKAGE_NAME = "@agentcomms/gmail";
/** What a host gets back: enough to serve the tools and to stop again, and nothing that ties it to an SDK version. */
export interface GmailMcpHandle {
  /** Serves MCP on this process's stdin and stdout, and resolves when the client disconnects. */
  connectStdio(): Promise<void>;
  close(): Promise<void>;
}
export interface CreateGmailMcpServerOptions {
  /** Where the configuration lives; defaults to the usual per-user location. */
  env?: NodeJS.ProcessEnv | undefined;
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
export declare function createGmailMcpServer(options?: CreateGmailMcpServerOptions): Promise<GmailMcpHandle>;
//#endregion