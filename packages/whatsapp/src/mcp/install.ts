import { CHANNEL_SERVERS, type McpProduct } from '@agentcomms/core';
import { VERSION } from '../version.ts';

/**
 * The WhatsApp server as the shared installer registers it.
 *
 * The facts — the package, the `mcp` argument `npx` needs, the `--account` pin, and the warning about other WhatsApp
 * servers — are core's `CHANNEL_SERVERS.whatsapp`, derived from this package's manifest, which the core server's
 * `comms_server_install` registers from too, so both surfaces say the same. What is added here is what only this
 * package knows: its own version, and where its code is (for `--launcher local`).
 */
export const WHATSAPP_MCP: McpProduct = {
  ...CHANNEL_SERVERS.whatsapp,
  version: VERSION,
  moduleUrl: import.meta.url,
};
