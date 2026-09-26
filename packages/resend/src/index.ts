/**
 * The library entry of `@agentcomms/resend`.
 *
 * Deliberately small. Everything else is reached through the `agent-resend` command, which ships as a bundle with no
 * runtime dependencies — so what is exported here stays a contract that can be kept.
 *
 * The guard and its permits are **not** exported: a package root that handed out `spendOn` would hand every caller
 * the key to the door the guard exists to keep shut. The route table is exported — knowing what this package may
 * call grants nothing.
 */
import { VERSION } from './version.ts';

export { VERSION };
export const PACKAGE_NAME = '@agentcomms/resend';

export {
  REFUSED,
  RESEND_API_ORIGIN,
  RESEND_DOWNLOAD_ORIGIN,
  ROUTES,
  type Route,
  type RouteKind,
} from './api/routes.ts';
export { createResendMcpServer, type ResendMcpOptions, type ResendMcpServer } from './mcp/server.ts';
