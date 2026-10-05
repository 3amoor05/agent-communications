#!/usr/bin/env node
import { parseArgs } from 'node:util';
/**
 * The Gmail MCP server as its own command, so a client configuration can name it directly:
 *
 *     npx -y @agentcomms/gmail-mcp@<version>
 *
 * It is one call into `@agentcomms/gmail`; everything the server does lives there, and `agent-gmail mcp` starts the
 * same server. Options mirror that command: `--inbox <alias>` serves one mailbox, `--read-only` registers only the
 * tools that cannot change anything.
 */
import { createGmailMcpServer } from '@agentcomms/gmail';

const argv = process.argv.slice(2);

const help = [
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
  'Set up mailboxes with the `agent-gmail` command from @agentcomms/gmail.',
  '',
].join('\n');

let values:
  | {
      help?: boolean;
      inbox?: string;
      'read-only'?: boolean;
      'config-dir'?: string;
      'state-dir'?: string;
      'data-dir'?: string;
      'secrets-dir'?: string;
    }
  | undefined;
try {
  ({ values } = parseArgs({
    args: argv,
    strict: true,
    allowPositionals: false,
    options: {
      help: { type: 'boolean', short: 'h' },
      inbox: { type: 'string' },
      'read-only': { type: 'boolean' },
      'config-dir': { type: 'string' },
      'state-dir': { type: 'string' },
      'data-dir': { type: 'string' },
      'secrets-dir': { type: 'string' },
    },
  }));
  for (const name of ['config-dir', 'state-dir', 'data-dir', 'secrets-dir'] as const) {
    if (values[name] === '') throw new TypeError(`--${name} needs a non-empty directory`);
  }
} catch (error) {
  process.stderr.write(`agent-gmail-mcp: ${error instanceof Error ? error.message : String(error)}\n\n${help}`);
  values = undefined;
  process.exitCode = 64;
}

if (values?.help) {
  process.stderr.write(help);
} else if (values) {
  const server = await createGmailMcpServer({
    inbox: values.inbox,
    readOnly: values['read-only'],
    pathOverrides: {
      ...(values['config-dir'] === undefined ? {} : { configDir: values['config-dir'] }),
      ...(values['state-dir'] === undefined ? {} : { stateDir: values['state-dir'] }),
      ...(values['data-dir'] === undefined ? {} : { dataDir: values['data-dir'] }),
      ...(values['secrets-dir'] === undefined ? {} : { secretsDir: values['secrets-dir'] }),
    },
  });

  // Resolves when the client disconnects; nothing else keeps this process alive.
  await server.connectStdio();
}
