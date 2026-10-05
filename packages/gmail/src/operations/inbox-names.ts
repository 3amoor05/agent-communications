import {
  type CliHandoffs,
  CommsError,
  type Config,
  handoffSentence,
  lookupName,
  nameAvailable,
} from '@agentcomms/core';

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
  whenTaken: string | undefined,
  handoffs: CliHandoffs,
): void {
  const check = nameAvailable(config, 'inbox', alias, 'gmail');
  if (check.ok) return;
  if (lookupName(config, 'inbox', alias)) {
    throw new CommsError('CONFIG', `an inbox called "${alias}" already exists`, {
      hint:
        whenTaken ??
        handoffSentence(
          handoffs.own(['inbox', 'reauth', alias]),
          (command) => `Re-authorise it with ${command}, or choose another name.`,
          { instead: 'Choose another name, or re-authorise that mailbox.' },
        ),
    });
  }
  throw check.error;
}
