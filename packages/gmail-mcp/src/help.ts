import { type Handoff, handoffSentence } from '@agentcomms/gmail';

/**
 * What `agent-gmail-mcp --help` prints, around the one command it hands a person: Gmail's own `setup`, as the Gmail
 * dependency locates it (`gmailCommand`, from Gmail's `RESOLVER_URL`) — never this wrapper, whose modules belong to a
 * package with no CLI, and never a bare name that may not be on the person's PATH (CUE-403). With no command here, the
 * sentence says why, and nothing stands in its place.
 */
export function serverHelp(setup: Handoff): string {
  return [
    'agent-gmail-mcp — the Gmail MCP server (stdio)',
    '',
    'Options:',
    '  --inbox <alias>       serve only this mailbox',
    '  --read-only           register only the tools that cannot change anything',
    '  --config-dir <dir>    pin the suite configuration directory',
    '  --state-dir <dir>     pin the suite state directory',
    '  --data-dir <dir>      pin the suite data directory',
    '  --secrets-dir <dir>   pin the suite file-secrets directory',
    '',
    handoffSentence(setup, (command) => `Set up mailboxes with Gmail's own CLI, from @agentcomms/gmail: ${command}`, {
      instead: 'Set up mailboxes with the Gmail CLI from @agentcomms/gmail.',
    }),
    '',
  ].join('\n');
}
