import {
  agentMarker,
  CommsError,
  colorEnabled,
  type OutputOptions,
  paint,
  runCommand,
  type Streams,
  writeResult,
} from '@agentcomms/core';
import { Command, CommanderError, Option } from 'commander';
import { WhatsAppContext, type WhatsAppContextOptions } from '../context.ts';
import { addAccount, removeAccount } from '../operations/accounts.ts';
import { allowChat, clearChats, denyChat } from '../operations/chat-lists.ts';
import { draftMessage } from '../operations/draft.ts';
import { CHAT_KINDS, listChats, readChat, searchMessages } from '../operations/read.ts';
import { whatsappStatus } from '../operations/status.ts';
import { syncAccount } from '../operations/sync.ts';
import { VERSION } from '../version.ts';
import { type Opener, openLink } from './opener.ts';
import {
  renderAdded,
  renderChatLists,
  renderChats,
  renderDraft,
  renderHistory,
  renderRemoved,
  renderSearch,
  renderStatus,
  renderSync,
} from './render.ts';

/**
 * The `agent-whatsapp` command — a spike, unpublished.
 *
 * Reads WhatsApp for Mac's own message store on this Mac, through a private copy, into a local index; lists, reads and
 * searches that index; and drafts messages as links the person opens and sends. It has no network client, no session
 * and no way to send. Every command prints a readable summary, or the whole result under `--json`, with the exit codes
 * the other agent-communications CLIs use.
 */

export interface CliDeps extends WhatsAppContextOptions {
  streams?: Streams | undefined;
  /** Opens a draft's link. Injected so a test does not start WhatsApp. */
  open?: Opener | undefined;
}

type Options = Record<string, unknown>;

export async function run(argv: readonly string[], deps: CliDeps = {}): Promise<number> {
  const streams: Streams = deps.streams ?? { stdout: process.stdout, stderr: process.stderr, stdin: process.stdin };
  const env = deps.env ?? process.env;
  const open = deps.open ?? openLink;
  const program = new Command();
  let exitCode = 0;
  let ran = false;

  program
    .name('agent-whatsapp')
    .description(
      'WhatsApp for coding agents — a spike: read, list and search the chats WhatsApp for Mac keeps on this Mac, and draft replies the person sends. No network, no sending.',
    )
    .version(VERSION, '-v, --version')
    .option('--json', 'print the result as {"ok":true,"schemaVersion":1,"data":…}', false)
    .option('--no-color', 'never colour the output')
    .configureOutput({
      writeOut: (text) => streams.stdout.write(text),
      writeErr: (text) => streams.stderr.write(text),
    })
    .addHelpText(
      'after',
      `
Getting started (a person, in a terminal):
  agent-whatsapp add personal/whatsapp         reads WhatsApp for Mac's store; macOS may ask to allow access
  agent-whatsapp sync --account personal/whatsapp
  agent-whatsapp chats --account personal/whatsapp
  agent-whatsapp search "invoice" --account personal/whatsapp
  agent-whatsapp draft +15555550101 "On my way"   a link; you press send in WhatsApp
  agent-whatsapp deny +15555550102 --account personal/whatsapp   agents never see that chat

Nothing here connects to WhatsApp or any other server, and nothing here can send.

Exit codes: 0 ok · 1 unexpected · 10 only a person may do that · 64 usage · 65 bad data (a store
whose layout changed) · 66 not found · 69 unavailable · 75 temporary (retry; a macOS dialog may
be waiting) · 77 permission needed (macOS privacy) · 78 configuration problem.`,
    )
    .exitOverride();

  const output = (): OutputOptions => {
    const options = program.opts();
    return {
      json: Boolean(options.json),
      color: colorEnabled(env, streams.stdout, options.color as boolean | undefined),
    };
  };

  const act =
    <A extends unknown[]>(body: (context: WhatsAppContext, options: OutputOptions, ...args: A) => Promise<void>) =>
    async (...args: A): Promise<void> => {
      ran = true;
      const context = new WhatsAppContext({ ...deps, env, surface: 'cli' });
      exitCode = await runCommand(output(), () => body(context, output(), ...args), streams);
    };

  const accountOption = (command: Command): Command =>
    command.requiredOption('--account <name>', 'which WhatsApp account, as `organisation/whatsapp`');

  program
    .command('add <name>')
    .description("give WhatsApp for Mac's message store a name, as organisation/whatsapp — a person does this")
    .option(
      '--source <path>',
      'a ChatStorage.sqlite elsewhere, e.g. WhatsApp Business’s; the default is WhatsApp for Mac’s',
    )
    .action(
      act(async (context, options, name: string, flags: Options) => {
        const result = await addAccount(context, {
          name,
          source: flags.source === undefined ? undefined : String(flags.source),
        });
        writeResult(result, options, () => renderAdded(result, options.color), streams);
      }),
    );

  program
    .command('remove <name>')
    .description("forget an account and delete its local index; WhatsApp's own store is not touched")
    .action(
      act(async (context, options, name: string) => {
        const result = await removeAccount(context, { name });
        writeResult(result, options, () => renderRemoved(result, options.color), streams);
      }),
    );

  accountOption(program.command('allow <chat>'))
    .description(
      'let agents see this chat; once any chat is allowed, agents see only allowed chats — a person does this',
    )
    .action(
      act(async (context, options, chat: string, flags: Options) => {
        const result = await allowChat(context, { account: String(flags.account), chat });
        writeResult(result, options, () => renderChatLists(result, options.color), streams);
      }),
    );

  accountOption(program.command('deny <chat>'))
    .description('hide this chat from agents entirely: not listed, searched, read or drafted to — a person does this')
    .action(
      act(async (context, options, chat: string, flags: Options) => {
        const result = await denyChat(context, { account: String(flags.account), chat });
        writeResult(result, options, () => renderChatLists(result, options.color), streams);
      }),
    );

  accountOption(program.command('clear [chat]'))
    .description('take a chat off both lists, or with no chat, empty them — a person does this')
    .action(
      act(async (context, options, chat: string | undefined, flags: Options) => {
        const result = await clearChats(context, { account: String(flags.account), chat });
        writeResult(result, options, () => renderChatLists(result, options.color), streams);
      }),
    );

  program
    .command('status')
    .description('what is set up, whether each store can be read, and what the index holds')
    .option('--account <name>', 'only this account')
    .option('--no-check', 'do not open the WhatsApp store to test access; report only what is recorded')
    .action(
      act(async (context, options, flags: Options) => {
        const result = await whatsappStatus(context, {
          account: flags.account === undefined ? undefined : String(flags.account),
          check: flags.check !== false,
        });
        writeResult(result, options, () => renderStatus(result, options.color), streams);
      }),
    );

  accountOption(program.command('sync'))
    .description("copy WhatsApp's store privately, check it, and rebuild the local index from the copy")
    .action(
      act(async (context, options, flags: Options) => {
        const result = await syncAccount(context, { account: String(flags.account) });
        writeResult(result, options, () => renderSync(result, options.color), streams);
      }),
    );

  accountOption(program.command('chats'))
    .description('chats, most recent first, as of the last sync; status updates only with --kind status')
    .option('--limit <n>', 'how many: 1 to 500', '50')
    .addOption(new Option('--kind <kind>', 'only one kind of chat').choices([...CHAT_KINDS]))
    .action(
      act(async (context, options, flags: Options) => {
        const result = await listChats(context, {
          account: String(flags.account),
          limit: flags.limit,
          kind: flags.kind === undefined ? undefined : String(flags.kind),
        });
        writeResult(result, options, () => renderChats(result, options.color), streams);
      }),
    );

  accountOption(program.command('read <chat>'))
    .description('one chat, newest first: by the id `chats` shows, or by phone number')
    .option('--limit <n>', 'how many messages: 1 to 200', '50')
    .option('--before <id>', 'older than this message: the `next` value of an earlier read')
    .action(
      act(async (context, options, chat: string, flags: Options) => {
        const result = await readChat(context, {
          account: String(flags.account),
          chat,
          limit: flags.limit,
          before: flags.before === undefined ? undefined : String(flags.before),
        });
        writeResult(result, options, () => renderHistory(result, options.color), streams);
      }),
    );

  accountOption(program.command('search <query>'))
    .description('words, in text, captions, file names, sender names and chat names, as of the last sync')
    .option('--chat <chat>', 'only in this chat')
    .option('--sender <name>', 'only from senders whose name contains this')
    .addOption(
      new Option('--kind <kind>', 'only in one kind of chat; status updates are searched only when asked for').choices([
        ...CHAT_KINDS,
      ]),
    )
    .option('--limit <n>', 'how many: 1 to 100', '20')
    .action(
      act(async (context, options, query: string, flags: Options) => {
        const result = await searchMessages(context, {
          account: String(flags.account),
          query,
          chat: flags.chat === undefined ? undefined : String(flags.chat),
          sender: flags.sender === undefined ? undefined : String(flags.sender),
          kind: flags.kind === undefined ? undefined : String(flags.kind),
          limit: flags.limit,
        });
        writeResult(result, options, () => renderSearch(result, options.color), streams);
      }),
    );

  program
    .command('draft <to> <text>')
    .description(
      'a message as a link that opens WhatsApp with it filled in — you press send; nothing is sent here. <to> is a phone number or an id `chats` shows',
    )
    .option(
      '--account <name>',
      'the account the chat belongs to, as `organisation/whatsapp`; its allow and deny lists apply (without it, every account’s do)',
    )
    .option('--open', 'open the link in WhatsApp now (a person only; an agent gives the link to the person)', false)
    .action(
      act(async (context, options, to: string, text: string, flags: Options) => {
        const result = await draftMessage(context, {
          account: flags.account === undefined ? undefined : String(flags.account),
          to,
          text,
        });
        let opened = false;
        if (flags.open === true) {
          /*
           * Opening puts a filled-in message in front of whoever is at the keyboard, one keypress from sent. A person
           * choosing to open their own draft is fine; an agent doing it lands a message box on the screen of someone
           * who may be typing elsewhere. So an agent gets the link, which the person clicks when they are ready.
           */
          const marker = agentMarker(env);
          if (marker) {
            throw new CommsError('APPROVAL_REQUIRED', 'only a person opens a draft in WhatsApp', {
              hint: 'Give the person the link from this draft (without --open); they click it and press send.',
              details: { marker },
            });
          }
          if (!result.links) {
            throw new CommsError('USAGE', result.reason ?? 'no link can open this chat', {
              hint: 'Copy the text and paste it into WhatsApp.',
            });
          }
          opened = open(result.links.app);
        }
        writeResult({ ...result, opened }, options, () => renderDraft(result, options.color, opened), streams);
      }),
    );

  program
    .command('mcp')
    .description('run the MCP server on stdio, for a coding agent to connect to')
    .action(async () => {
      ran = true;
      const { startWhatsAppStdioServer } = await import('../mcp/stdio-entry.ts');
      await startWhatsAppStdioServer({ env });
    });

  try {
    await program.parseAsync([...argv], { from: 'user' });
  } catch (error) {
    if (error instanceof CommanderError) {
      if (['commander.helpDisplayed', 'commander.help', 'commander.version'].includes(error.code)) return 0;
      const message = error.message.replace(/^error: /, '');
      return runCommand(
        output(),
        async () => {
          throw new CommsError('USAGE', message, { hint: 'Run `agent-whatsapp --help` to see the commands.' });
        },
        streams,
      );
    }
    throw error;
  }
  if (!ran) {
    streams.stderr.write(`${paint(output().color, 'dim', 'Nothing to do. Try `agent-whatsapp --help`.')}\n`);
    return 64;
  }
  return exitCode;
}
