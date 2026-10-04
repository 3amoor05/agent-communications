import {
  agentMarker,
  approvalKind,
  approvalsOf,
  approveChangeAtTerminal,
  CHANNELS,
  CommsError,
  canPrompt,
  channelManifest,
  colorEnabled,
  commandPathOf,
  EXIT_CODES,
  exemptFromUpdateGate,
  type GatedChange,
  gatedChangeAtTerminal,
  inlineCommand,
  installExitStatus,
  type OutputOptions,
  openCore,
  paint,
  renderInstall,
  renderPrune,
  runCommand,
  type ShellCommand,
  type Streams,
  type SupportedClient,
  serverInstallChange,
  serverPruneChange,
  shellCommand,
  updateGateAtTerminal,
  writeResult,
} from '@agentcomms/core';

/**
 * Every channel's approve command that can have prepared a send, from the manifests: the channels whose accounts can
 * be in `send`. WhatsApp's is not among them — it never sends — and a channel added later is, without an edit here.
 */
function sendApproveCommands(): string {
  const commands = CHANNELS.flatMap((channel) => {
    const manifest = channelManifest(channel);
    return manifest?.approve && manifest.accounts?.modes.includes('send') ? [`\`${manifest.approve}\``] : [];
  });
  return commands.length <= 1 ? commands.join('') : `${commands.slice(0, -1).join(', ')} or ${commands.at(-1)}`;
}

import { Command, CommanderError, Option } from 'commander';
import { WhatsAppContext, type WhatsAppContextOptions } from '../context.ts';
import { WHATSAPP_MCP } from '../mcp/install.ts';
import { addAccount, removeAccount } from '../operations/accounts.ts';
import { allowChat, clearChats, denyChat } from '../operations/chat-lists.ts';
import { draftMessage } from '../operations/draft.ts';
import { CHAT_KINDS, listChats, readChat, searchMessages } from '../operations/read.ts';
import { whatsappStatus } from '../operations/status.ts';
import { syncAccount } from '../operations/sync.ts';
import { requireSupportedNode } from '../sqlite.ts';
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
 * The `agent-whatsapp` command.
 *
 * Reads WhatsApp for Mac's own message store on this Mac, through a private copy, into a local index; lists, reads and
 * searches that index; and drafts messages as links the person opens and sends. It has no network client, no session
 * and no way to send. Every command prints a readable summary, or the whole result under `--json`, with the exit codes
 * the other agent-communications CLIs use.
 *
 * The accounts are core's (`config.json`); registering the server with an MCP client is core's change too, so
 * `mcp install` here and `comms_server_install` from a chat are one change and one approval.
 */

export interface CliDeps extends WhatsAppContextOptions {
  streams?: Streams | undefined;
  /** Opens a draft's link. Injected so a test does not start WhatsApp. */
  open?: Opener | undefined;
  /** Starts the stdio server. Injected so a test can inspect its inputs without opening stdio. */
  startMcp?:
    | ((options: { env: NodeJS.ProcessEnv; platform: NodeJS.Platform; account?: string }) => Promise<void>)
    | undefined;
}

type Options = Record<string, unknown>;

export async function run(argv: readonly string[], deps: CliDeps = {}): Promise<number> {
  const streams: Streams = deps.streams ?? { stdout: process.stdout, stderr: process.stderr, stdin: process.stdin };
  const env = deps.env ?? process.env;
  const platform = deps.platform ?? process.platform;
  const open = deps.open ?? openLink;
  const program = new Command();
  let exitCode = 0;
  let ran = false;

  program
    .name('agent-whatsapp')
    .description(
      'WhatsApp for coding agents, read-only: read, list and search the chats WhatsApp for Mac keeps on this Mac, and draft replies the person sends. No network, no sending.',
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
  agent-whatsapp mcp install --client claude-code --account personal/whatsapp

Nothing here connects to WhatsApp or any other server, and nothing here can send. Needs Node 22.16 or newer.

Exit codes: 0 ok · 1 unexpected · 10 only a person may do that, or a change needs approval · 11 an update
is out: update first, or put it off (agentcomms update, agentcomms update --later) · 64 usage
· 65 bad data (a store whose layout changed) · 66 not found · 69 unavailable · 75 temporary (retry;
a macOS dialog may be waiting) · 77 permission needed (macOS privacy) · 78 configuration problem.`,
    )
    .exitOverride();

  const output = (): OutputOptions => {
    const options = program.opts();
    return {
      json: Boolean(options.json),
      color: colorEnabled(env, streams.stdout, options.color as boolean | undefined),
      platform,
    };
  };

  /**
   * A command that succeeded but wants a non-zero exit code — `mcp install` that registered an entry which did not
   * start — where the result *is* the output and `--json` must still print one envelope.
   */
  let softExit: number | null = null;

  /*
   * The daily update check (design 2026-09-28 §3), before any command but the exempt ones: an update that is out
   * stops it — a person at a terminal is asked "Update now, later today, or cancel?", anything else ends with
   * UPDATE_REQUIRED (exit 11). A hook on the program, so a command added later is gated by being a command at all;
   * `act` ends with the exit status it decided, when it decided one.
   * WhatsApp's has no network code: it reads the file as the machine's other servers and commands left it, and its
   * "now" says what to run rather than fetching the update itself.
   *
   */
  let gated: number | null = null;
  program.hook('preAction', async (_program, command) => {
    const path = commandPathOf(command);
    if (exemptFromUpdateGate(path, ['status'])) return;
    const core = openCore({ env });
    let ended: number | null = null;
    const code = await runCommand(
      output(),
      async () => {
        ended = await updateGateAtTerminal({
          core,
          env,
          binary: 'agent-whatsapp',
          channel: 'whatsapp',
          running: VERSION,
          output: output(),
          noInput: false,
          streams,
          approveCommand: 'agent-whatsapp approve',
          approvals: approvalsOf(command),
        });
      },
      streams,
    );
    gated = code !== 0 ? code : ended;
  });

  const act =
    <A extends unknown[]>(body: (context: WhatsAppContext, options: OutputOptions, ...args: A) => Promise<void>) =>
    async (...args: A): Promise<void> => {
      ran = true;
      softExit = null;
      if (gated !== null) {
        exitCode = gated;
        return;
      }
      exitCode = await runCommand(
        output(),
        async () => {
          // Before anything else: a Node too old for node:sqlite is said here, not half way through a sync.
          requireSupportedNode();
          const context = new WhatsAppContext({
            ...deps,
            env,
            surface: 'cli',
            log: deps.log ?? ((line) => streams.stderr.write(`${line}\n`)),
          });
          await body(context, output(), ...args);
        },
        streams,
      );
      if (exitCode === 0 && softExit !== null) exitCode = softExit;
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
    .description(
      "forget an account, its chat lists and its local index — a person does this; WhatsApp's own store is not touched",
    )
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
        writeResult(result, options, () => renderStatus(result, options.color, context.platform), streams);
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
    .command('approve <approvalId>')
    .description(
      'approve a change at this terminal — registering or pruning this server — by reading it and typing the code back; WhatsApp never sends, so there is no message to approve',
    )
    .action(
      act(async (context, options, approvalId: string) => {
        /*
         * The one command an agent may not run for the person, checked before the id is even looked up. A shell
         * agent can get past it — `script -q /dev/null` makes any command see a terminal — so it is a speed bump
         * against the ordinary case, as it is for every approve command here, not a boundary.
         *
         * It approves only a change. `mcp install` and `mcp prune` are changes a person approves (core's), and under
         * the `confirm` change policy that is a code typed at a terminal; `agentcomms` may not be installed beside
         * this package, so its own command does it, through core's terminal approval. A send it cannot have
         * prepared — there is no send in this package — is refused and sent back to the command that did.
         */
        const marker = agentMarker(env);
        if (marker) {
          throw new CommsError('APPROVAL_REQUIRED', 'only a person can approve a change, not an agent', {
            hint: `Ask the person to run ${inlineCommand(shellCommand(['agent-whatsapp', 'approve', approvalId], context.platform))} in their own terminal.`,
            details: { marker },
          });
        }
        if (!canPrompt(env, streams, { json: options.json })) {
          throw new CommsError('APPROVAL_REQUIRED', 'approving a change needs an interactive terminal', {
            hint: `Run ${inlineCommand(shellCommand(['agent-whatsapp', 'approve', approvalId], context.platform))} directly in a terminal.`,
          });
        }
        const pending = await context.core.approvals.get(approvalId);
        if (!pending) {
          throw new CommsError('NOT_FOUND', `no approval ${approvalId}`, {
            hint: 'It may have expired, been used, or been cancelled. Prepare the change again.',
          });
        }
        if (approvalKind(pending) !== 'change') {
          throw new CommsError('USAGE', `approval ${approvalId} is for a send, and WhatsApp never sends`, {
            hint: `Approve it with the command that prepared it — ${sendApproveCommands()} — not this one.`,
          });
        }
        const outcome = await approveChangeAtTerminal(
          context.core,
          approvalId,
          env,
          { json: options.json, color: options.color, platform: context.platform },
          streams,
        );
        streams.stdout.write(
          outcome.state === 'approved'
            ? 'Approved. This command approves; the change is applied by the command that prepared it.\n'
            : 'Cancelled. Nothing was changed.\n',
        );
      }),
    );

  const changeAt = <T>(
    context: WhatsAppContext,
    change: GatedChange<T>,
    flags: Options,
    command: ShellCommand,
  ): Promise<T> =>
    gatedChangeAtTerminal(context.core, change, {
      approvalId: flags.approval === undefined ? undefined : String(flags.approval),
      env,
      output: output(),
      command,
      approveCommand: 'agent-whatsapp approve',
      streams,
    });

  const mcp = program
    .command('mcp')
    .description('run the MCP server on stdio, for a coding agent to connect to')
    .option('--account <name>', 'pin the server to one account; every tool then acts on it and no other')
    .action(async (flags: Options) => {
      ran = true;
      // A server that cannot start — a Node too old, a pin naming no account — says why on stderr and exits with the
      // status that means it, rather than a stack trace in a client's log. Once it is serving, it returns.
      exitCode = await runCommand(
        output(),
        async () => {
          requireSupportedNode();
          const startWhatsAppStdioServer =
            deps.startMcp ?? (await import('../mcp/stdio-entry.ts')).startWhatsAppStdioServer;
          await startWhatsAppStdioServer({
            env,
            platform,
            ...(flags.account ? { account: String(flags.account) } : {}),
          });
        },
        streams,
      );
    });

  mcp
    .command('install')
    .description('register this server with an MCP client, and prove it starts — a change the person approves')
    .addOption(
      new Option('--client <client>', 'which client to register with').choices([
        'claude-code',
        'claude-desktop',
        'codex',
        'cursor',
        'gemini',
        'vscode',
        'json',
      ]),
    )
    .option(
      '--name <name>',
      'the name the client will show: 1 to 64 letters, digits, dots, underscores or hyphens',
      'whatsapp',
    )
    .option('--account <name>', 'pin the server to one account')
    .addOption(new Option('--launcher <launcher>', 'how the server is started').choices(['managed', 'npx', 'local']))
    .option('--no-verify', 'do not start the server to check the entry works')
    .option('--force', "replace this server's own earlier entry — this is how you upgrade", false)
    .option('--print', 'only print what would be written', false)
    .option('--approval <approvalId>', 'register the server this approval was given for')
    .action(
      act(async (context, options, flags: Options) => {
        // Named, never assumed: writing into a client's configuration nobody named is the thing to ask about.
        if (!flags.client) {
          throw new CommsError('USAGE', 'name the client with --client', {
            hint: 'For example: `agent-whatsapp mcp install --client claude-code --account personal/whatsapp`.',
          });
        }
        /*
         * The parent's value counts too: `mcp` and `mcp install` both take `--account`, and Commander gives a repeated
         * name to the parent, so the subcommand's own is undefined and the pin would be silently dropped — the bug
         * the Gmail package shipped once.
         */
        const pinned = (flags.account ?? mcp.opts().account) as string | undefined;
        const launcher = flags.launcher as 'managed' | 'npx' | 'local' | undefined;
        const name = flags.name as string | undefined;
        /*
         * Registering a server is a change a person approves, and this is the change `comms_server_install` makes
         * with `channel: "whatsapp"`: one change, so an approval prepared by either is claimed by the other.
         */
        // The pin is checked against `config.json` by core, so the spike's accounts have to be there first.
        await context.migration();
        const again = shellCommand(
          [
            'agent-whatsapp',
            'mcp',
            'install',
            '--client',
            String(flags.client),
            ...(name !== undefined && name !== 'whatsapp' ? ['--name', name] : []),
            ...(pinned !== undefined ? ['--account', pinned] : []),
            ...(launcher !== undefined ? ['--launcher', launcher] : []),
            ...(flags.verify === false ? ['--no-verify'] : []),
            ...(flags.force === true ? ['--force'] : []),
          ],
          context.platform,
        );
        const result = await changeAt(
          context,
          serverInstallChange(
            context.core,
            env,
            {
              channel: 'whatsapp',
              client: flags.client as SupportedClient,
              name,
              account: pinned,
              launcher,
              noVerify: flags.verify === false,
              print: flags.print === true,
              force: flags.force === true,
            },
            WHATSAPP_MCP,
          ),
          flags,
          again,
        );
        // Asked to register and did not, or registered an entry that did not start: the exit status says so.
        const status = installExitStatus(result);
        if (status !== EXIT_CODES.OK) softExit = status;
        writeResult(result, output(), () => renderInstall(result, options.color), streams);
      }),
    );

  mcp
    .command('prune')
    .description(
      'remove managed runtimes that no client config it can read names, no printed entry names, and no process runs',
    )
    .option('--dry-run', 'only say what would be removed', false)
    .option(
      '--include-printed',
      'also remove runtimes kept only because an entry for them was printed (--client json, --print), once those entries are gone',
      false,
    )
    .option('--approval <approvalId>', 'remove the runtimes this approval was given for')
    .action(
      act(async (context, options, flags: Options) => {
        // The change `comms_server_prune` makes: a dry run is free; removing is approved as the list it shows.
        const result = await changeAt(
          context,
          serverPruneChange(
            context.core,
            env,
            { channel: 'whatsapp', dryRun: flags.dryRun === true, includePrinted: flags.includePrinted === true },
            WHATSAPP_MCP,
          ),
          flags,
          shellCommand(
            ['agent-whatsapp', 'mcp', 'prune', ...(flags.includePrinted === true ? ['--include-printed'] : [])],
            context.platform,
          ),
        );
        writeResult(result, output(), () => renderPrune(result, options.color), streams);
      }),
    );

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
