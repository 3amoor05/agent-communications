import type { ChannelManifest, NarrowingOption } from './channel-manifest.ts';
import { CHANNEL_SNAPSHOT } from './channels.generated.ts';

/**
 * How the core names the channels to a person, read from their manifests (design 2026-09-26).
 *
 * The core used to write "Gmail and Slack", "`agent-gmail approve` or `agent-slack approve`", "the mailbox", "the
 * workspace" into its sentences by hand, so a third channel would have been missing from every one of them — or, worse,
 * described in another channel's words. These build the same sentences from each manifest's `label`, `accounts.noun`,
 * `approve` and `narrowing`. For Gmail and Slack every sentence is byte for byte what it was
 * (`test/wording-identity.test.ts`): previews and effects are inside approval digests.
 *
 * Only the snapshot is imported here, so the approval store, the name lookups and the change flow can use it without
 * depending on the installer.
 */

const MANIFESTS: readonly ChannelManifest[] = CHANNEL_SNAPSHOT.map((entry) => entry.manifest);

/** A channel's manifest by its word, or undefined for a word that is not a channel of this release. */
export function manifestOf(channel: string): ChannelManifest | undefined {
  return MANIFESTS.find((manifest) => manifest.channel === channel);
}

/** Every channel that connects accounts — every one but the core — in the snapshot's order. */
export function accountChannels(): readonly ChannelManifest[] {
  return MANIFESTS.filter((manifest) => manifest.accounts !== undefined);
}

/**
 * Words as a list a person reads: `a`, `a or b`, `a, b or c` — with `oxford`, `a, b, or c` once there are three.
 */
export function listed(words: readonly string[], conjunction: string, options: { oxford?: boolean } = {}): string {
  if (words.length <= 1) return words.join('');
  const last = words.at(-1) as string;
  const rest = words.slice(0, -1);
  return `${rest.join(', ')}${options.oxford && rest.length > 1 ? ',' : ''} ${conjunction} ${last}`;
}

/** The noun for one account on `channel` — `mailbox`, `workspace` — or `account` for a channel that names none. */
export function accountNoun(channel: string): string {
  return manifestOf(channel)?.accounts?.noun ?? 'account';
}

/** The install option that pins a server of `channel` to one account — `inbox`, `workspace`, `account` — or undefined. */
export function pinOption(channel: string): NarrowingOption | undefined {
  return manifestOf(channel)?.narrowing?.find((narrowing) => narrowing.kind === 'pin')?.option;
}

/** Whether a server of `channel` has the narrowing `option`. */
export function hasNarrowing(channel: string, option: NarrowingOption): boolean {
  return manifestOf(channel)?.narrowing?.some((narrowing) => narrowing.option === option) === true;
}

/** The first channel whose server has the narrowing `option`: whose option it is, for a refusal. */
export function narrowingOwner(option: NarrowingOption): ChannelManifest | undefined {
  return MANIFESTS.find((manifest) => manifest.narrowing?.some((narrowing) => narrowing.option === option));
}

/**
 * How a mailbox is connected, for a hint about there being none: the `inbox add` of the channel whose accounts are
 * mailboxes, in the `inboxes` map — named in words, "Gmail's inbox add", never as a command. Core does not have that
 * channel's CLI, and finds it only among this machine's registrations (CUE-403); a hint made where none were read must
 * not invent the command from the manifest's binary.
 */
export function connectMailboxWords(): string | undefined {
  const mail = accountChannels().find((manifest) => manifest.accounts?.map === 'inboxes');
  return mail ? `${mail.label}'s inbox add` : undefined;
}
