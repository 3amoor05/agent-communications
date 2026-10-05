import type { CliCommandCaller } from '@agentcomms/core';

/** This package's name, as its manifest has it. */
export const PACKAGE_NAME = '@agentcomms/whatsapp';

/**
 * This package as core locates its commands from (CONTRIBUTING.md, "Telling a person what to run"; design 2026-10-04,
 * D1): a module of its own, whose nearest manifest is this package's. Run from a checkout's source it is this file, and
 * a command runs `src/cli.ts`; built, it is a file of `dist`, and a command runs the manifest's bin. Either way the
 * program is this process's Node, which has to be in this package's own `engines.node` range — narrower than core's —
 * or there is no command, and the reason names the range.
 */
export const CALLER: CliCommandCaller = Object.freeze({ url: import.meta.url, packageName: PACKAGE_NAME });
