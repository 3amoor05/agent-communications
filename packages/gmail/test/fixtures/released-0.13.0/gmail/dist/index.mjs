import { r as createGmailMcpServer$1, t as redirectConsoleToStderr } from "./stdio-entry-Bq_pMhxH.mjs";
import { a as VERSION } from "./install-CAhyfCot.mjs";
//#region src/index.ts
/**
* The library entry of `@agentcomms/gmail`.
*
* It is deliberately small. Everything else in this package is reached through the `agent-gmail` command or through
* the MCP server, and both are shipped as a bundle with no runtime dependencies — so the public API here stays a
* contract we can keep, rather than the whole internal surface.
*/
const PACKAGE_NAME = "@agentcomms/gmail";
/**
* Builds the Gmail MCP server. The `@agentcomms/gmail-mcp` package is one call to this, and a host embedding the
* server should use it the same way:
*
* ```js
* const server = await createGmailMcpServer();
* await server.connectStdio();
* ```
*/
async function createGmailMcpServer(options = {}) {
	redirectConsoleToStderr();
	const built = await createGmailMcpServer$1(options);
	return {
		connectStdio: () => built.connectStdio(),
		close: () => built.close()
	};
}
//#endregion
export { PACKAGE_NAME, VERSION, createGmailMcpServer };
