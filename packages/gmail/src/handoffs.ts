import { type CliHandoffs, type Handoff, handoffSentence, inlineCommand, isCommand } from '@agentcomms/core';

/*
 * Sentences several of Gmail's refusals share, each naming a command of this installation located from Gmail's caller
 * (CUE-403; CONTRIBUTING.md, "Telling a person what to run") — or, with none here, saying why, never a bare name.
 */

/** "How the --client option works": this installation's own help for `inbox add`, which reads no folder. */
export function inboxAddHelp(handoffs: CliHandoffs): ReturnType<CliHandoffs['own']> {
  return handoffs.own(['inbox', 'add', '--help'], { uses: [] });
}

/** `lead` — "Choose a client that serves this address" — then where the `--client` option is described. */
export function clientOptionHint(handoffs: CliHandoffs, lead: string): string {
  return handoffSentence(inboxAddHelp(handoffs), (command) => `${lead}; ${command} describes the --client option.`);
}

/** How to see whether a write that could not be read back landed: this installation's own `inbox list`. */
export function runInboxList(handoffs: CliHandoffs): string {
  return handoffSentence(handoffs.own(['inbox', 'list']), (command) => `Run ${command}.`);
}

/**
 * "Reconcile the profile, then start again": core's own `org update`, located through Gmail's runtime dependency on
 * core — or, with none here, the tool that does it from a chat, and why there is no command.
 */
export function orgUpdateHint(handoffs: CliHandoffs, organisation: string, then: string): string {
  return handoffSentence(handoffs.core(['org', 'update', organisation]), (command) => `Run ${command}${then}`, {
    instead: `Call comms_org_update for ${organisation} from a chat${then}`,
  });
}

/**
 * A command as one clause of a sentence that names several ways: `say` with it in backticks; with none here, `instead`
 * — the same thing done another way — and why there is no command, in brackets, so that the other clauses still stand.
 */
export function handoffClause(handoff: Handoff, say: (command: string) => string, instead: string): string {
  return isCommand(handoff) ? say(inlineCommand(handoff)) : `${instead} (${handoff.message.replace(/\.$/, '')})`;
}
