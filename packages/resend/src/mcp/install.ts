import { CHANNEL_SERVERS, type McpProduct } from '@agentcomms/core';
import { VERSION } from '../version.ts';

/**
 * Registering the Resend server with an MCP client.
 *
 * The machinery is `@agentcomms/core`'s, shared with every channel: where each client keeps its servers, how a
 * minimal PATH breaks a bare `node`, which npm binary works on Windows. The facts about this server — the package,
 * the `mcp` argument `npx` needs, the `--account` pin, the warning about other Resend servers — are core's
 * `CHANNEL_SERVERS.resend`, derived from this package's manifest, which `comms_server_install` registers from too. What
 * is added here is what only this package knows: its own version, and where its code is for `--launcher local`.
 */
export const RESEND_MCP: McpProduct = {
  ...CHANNEL_SERVERS.resend,
  version: VERSION,
  moduleUrl: import.meta.url,
};
