export * from './addresses.ts';
export * from './approvals.ts';
export * from './audit.ts';
export * from './change-flow.ts';
export * from './changes.ts';
export * from './channel-manifest.ts';
export * from './channel-servers.ts';
export * from './chars.ts';
export * from './cli-runtime.ts';
export * from './compose-profile.ts';
export * from './config.ts';
export * from './core.ts';
export * from './digest.ts';
export * from './errors.ts';
export * from './fs.ts';
export * from './ids.ts';
export * from './internet-mark.ts';
export * from './jail.ts';
export * from './keys.ts';
export * from './known-folders.ts';
export * from './ledger.ts';
export * from './lock.ts';
export * from './mcp-clients.ts';
export * from './mcp-install.ts';
export * from './name-grammar.ts';
export * from './names.ts';
export * from './numbers.ts';
export * from './oauth-client-records.ts';
export {
  type OrgAddRequest,
  type OrgChangeResult,
  type OrgOptions,
  orgAddChange,
} from './operations/organisations.ts';
/*
 * The registration and pruning changes, for the channels' own `mcp install` and `mcp prune`: the one change the core
 * server's `comms_server_install` and `comms_server_prune` make, so an approval for either is the other's too.
 */
export {
  type ServerInstallRequest,
  type ServerInstallResult,
  type ServerPruneRequest,
  serverInstallChange,
  serverPruneChange,
} from './operations/servers.ts';
export { type UpdateDeps, updateChange } from './operations/update.ts';
export {
  type UpdateAutoResult,
  type UpdateLaterResult,
  updateAutoChange,
  updateLaterChange,
} from './operations/update-settings.ts';
/*
 * Organisation profiles (design 2026-10-02): what a channel needs to read the record — whether a client row is an
 * organisation's, and the generations of its client. The core writes the record; nothing else does.
 */
export {
  activeGeneration,
  GENERATION_LIMIT,
  type GenerationState,
  generationState,
  learnProfileSlackAppId,
  managingOrganisation,
  type OrganisationProfile,
  organisationProfileSchema,
  organisationsOf,
  PROFILE_ORGANISATION_MAX,
  type ProfileFile,
  type ProfileSlackTarget,
  parseProfile,
  profileSourcePath,
  readProfileFile,
  recordOf,
  requireLiveOrganisationGeneration,
  resolveProfileSlackTarget,
  shownPath,
  shownText,
} from './organisations.ts';
export * from './other-servers.ts';
export * from './output.ts';
export * from './paths.ts';
export * from './plans.ts';
export * from './reconcile.ts';
export * from './render.ts';
export * from './sanitize.ts';
export * from './save-deny.ts';
export * from './save-destination.ts';
export * from './saved-files.ts';
export * from './secrets.ts';
export * from './state.ts';
export * from './system-programs.ts';
export * from './taint.ts';
export * from './tool-arguments.ts';
export * from './untrusted.ts';
/*
 * The daily update check (design 2026-09-28). The reader and the gate carry no network code, and are all WhatsApp
 * imports; the checker and the update asks the registry, and every other package imports them for its servers' and
 * commands' gates.
 */
export * from './update-check.ts';
export * from './update-gate.ts';
export * from './update-state.ts';
export { VERSION } from './version.ts';
export * from './versions.ts';

export const PACKAGE_NAME = '@agentcomms/core';
