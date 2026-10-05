/**
 * The library entry of `@agentcomms/whatsapp`.
 *
 * Small on purpose, as the Slack package's is: the server, the draft composer and the version. Everything else is
 * reached through the `agent-whatsapp` command.
 */
import { VERSION } from './version.ts';

export { PACKAGE_NAME } from './caller.ts';
export { createWhatsAppMcpServer, type WhatsAppMcpOptions, type WhatsAppMcpServer } from './mcp/server.ts';
export { composeDraft, type DraftResult } from './operations/draft.ts';
export { VERSION };
