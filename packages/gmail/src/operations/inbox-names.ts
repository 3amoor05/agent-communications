import { CommsError, type Config, inlineCommand, lookupName, nameAvailable, shellCommand } from '@agentcomms/core';

/**
 * Refuses a name a new mailbox cannot take, under whichever version the config is.
 *
 * Version 1 keeps Gmail's rule — any valid plain name not already a mailbox. Version 2 is the organisation/platform
 * grammar ending in `/gmail`, free across mailboxes and workspaces, and never a former name. Both come from core's
 * `nameAvailable`; only the wording for a name that is already a mailbox is Gmail's own, because the fix for it —
 * re-authorise that mailbox — is something only this package can suggest.
 */
export function requireNewInboxName(
  config: Config,
  alias: string,
  whenTaken?: string,
  platform: NodeJS.Platform = process.platform,
): void {
  const check = nameAvailable(config, 'inbox', alias, 'gmail');
  if (check.ok) return;
  if (lookupName(config, 'inbox', alias)) {
    throw new CommsError('CONFIG', `an inbox called "${alias}" already exists`, {
      hint:
        whenTaken ??
        `Re-authorise it with ${inlineCommand(shellCommand(['agent-gmail', 'inbox', 'reauth', alias], platform))}, or choose another name.`,
    });
  }
  throw check.error;
}
