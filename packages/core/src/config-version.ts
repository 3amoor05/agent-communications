/** The versions of the config file a release can know about. See `READABLE_CONFIG_VERSIONS` in `config.ts`. */
export type ConfigVersion = 1 | 2 | 3;

/**
 * The version a brand-new config is created at.
 *
 * **2, from this release.** Version 2 names every account `organisation/platform`. The release before this one could
 * read version 2 and deliberately could not create it, so that every program sharing a config file — an MCP server
 * started last week, a CLI updated today — could read what the next one writes. That release is out; this is the one
 * that writes. Moving this constant also opens the gate in `release-gate.ts` that lets `ConfigStore.migrateNames`
 * run, because the two must never disagree.
 *
 * **Version 3 is the deliberate exception to that rule** (design 2026-10-05 §4, departure 0). It carries the per-owner
 * send epoch and the legacy drain, and its whole point is that 0.13 — which reads only versions 1 and 2 — refuses it:
 * an older process that kept claiming its own approvals, or wrote `never → chat` without raising an epoch, is exactly
 * what the epoch exists to stop. So no release read version 3 before one wrote it. The cost is stated: an MCP server
 * still running 0.13 fails every call it starts with the upgrade hint until its client restarts it. A brand-new config
 * is still created at version 2; `ConfigStore.convertToVersion3` is the one door to version 3, opened by the first
 * operation that relies on the epoch.
 */
export const NEW_CONFIG_VERSION: ConfigVersion = 2;
