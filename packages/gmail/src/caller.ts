import type { CliCommandCaller } from '@agentcomms/core';

/**
 * Gmail as the package printing a command: a module of its own, and its name (CUE-403; CONTRIBUTING.md, "Telling a
 * person what to run"). Its CLI, its server and every context open core with it, so each command Gmail tells a person to
 * run — its own, core's — is located from this installation, for its folders, rather than named by a bare binary that
 * is not on most people's PATH.
 *
 * Bundled, this module is a file of Gmail's own `dist`, so the locator still finds Gmail's manifest above it; run from
 * source it is TypeScript, and Gmail's own `src/cli.ts` is the command. The `@agentcomms/gmail-mcp` wrapper never uses
 * a module of its own for this: a command for Gmail is located from Gmail's exported `RESOLVER_URL`.
 */
export const GMAIL_CALLER: CliCommandCaller = Object.freeze({
  url: import.meta.url,
  packageName: '@agentcomms/gmail',
});
