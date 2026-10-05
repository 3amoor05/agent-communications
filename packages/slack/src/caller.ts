import type { CliCommandCaller } from '@agentcomms/core';
import pkg from '../package.json' with { type: 'json' };

/**
 * This package as the caller core locates its commands from (design 2026-10-04, D1; CONTRIBUTING.md, "Telling a person
 * what to run"): a module of its own and its name. Every place this package opens core gives it this, so each command
 * Slack tells a person to run — its own, core's — names this Node and a checked file of this installation, with its
 * folders pinned, or says why there is none here. Bundled, the module is this package's own build, and still in it.
 */
export const SLACK_CALLER: CliCommandCaller = Object.freeze({ url: import.meta.url, packageName: pkg.name });
