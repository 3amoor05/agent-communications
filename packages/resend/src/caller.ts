import type { CliCommandCaller } from '@agentcomms/core';

/** This package's name, as its manifest has it: what core checks a caller against. */
export const PACKAGE_NAME = '@agentcomms/resend';

/**
 * This package as core's caller (CUE-403; CONTRIBUTING.md, "Telling a person what to run"): one of its own modules and
 * its name, so every command it prints for a person runs this installation, with its folders pinned. Its CLI and its
 * server open core with it, and nothing else does. Bundled, this module is part of the bundle's file — still inside
 * this package — so the check that the caller is this package holds in the published build as in a checkout.
 */
export const RESEND_CALLER: CliCommandCaller = Object.freeze({ url: import.meta.url, packageName: PACKAGE_NAME });
