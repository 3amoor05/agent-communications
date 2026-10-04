import { CommsError, inlineCommand, shellCommand } from '@agentcomms/core';
import { USER_ID } from '../compose/blocks.ts';

/**
 * Refuses a user id as the place a post goes — issue #43. Only the destination: a mention takes a user id, as ever.
 *
 * A post goes to a conversation. A person is not one: a direct message with them has an id of its own, `D…`, and it is
 * that conversation the gate reads, counts and shows in the preview. Whatever Slack would do with a user id there, it
 * is not a room the preview could have described. Checked before anything is written, read or asked of Slack, by the
 * three operations that take a destination — `createDraft`, `updateDraft`, and `prepareDraftPost` given a new message —
 * and again by `viewPost`, so a draft stored before 0.12.0, or written by hand, is refused at prepare and at send.
 */
export function requireConversation(
  channel: string,
  alias: string,
  platform: NodeJS.Platform = process.platform,
): void {
  if (!USER_ID.test(channel)) return;
  throw new CommsError('USAGE', `"${channel}" is a user id: a post goes to a conversation id`, {
    hint: `For a direct message use the DM’s id (D…), which ${inlineCommand(shellCommand(['agent-slack', 'channels', '--workspace', alias], platform))} and slack_channels list.`,
    details: { channel, reason: 'user-id' },
  });
}
