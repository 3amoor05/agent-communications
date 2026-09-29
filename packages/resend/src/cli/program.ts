import {
  agentMarker,
  approvalKind,
  approvalsOf,
  approveChangeAtTerminal,
  CommsError,
  canPrompt,
  colorEnabled,
  commandPathOf,
  EXIT_CODES,
  exemptFromUpdateGate,
  type GatedChange,
  gatedChangeAtTerminal,
  installExitStatus,
  type OutputOptions,
  openCore,
  paint,
  refuseUnclaimedApproval,
  renderInstall,
  renderPrune,
  runCommand,
  SEND_LOOKUP,
  type Streams,
  type SupportedClient,
  serverInstallChange,
  serverPruneChange,
  terminalUpdateHooks,
  updateGateAtTerminal,
  writeResult,
} from '@agentcomms/core';
import { Command, CommanderError, Option } from 'commander';
import { checkNewName } from '../accounts.ts';
import { ResendContext, type ResendContextOptions } from '../context.ts';
import { RESEND_MCP } from '../mcp/install.ts';
import {
  addAccountChange,
  inspectKey,
  listAccounts,
  modeOf,
  policyApprovalRefusal,
  policyChange,
  policyReport,
  policyWanted,
  removeAccountChange,
  sendPolicyOf,
  showAccount,
} from '../operations/accounts.ts';
import { runDoctor } from '../operations/doctor.ts';
import {
  downloadReceived,
  getMetrics,
  listDomains,
  listReceived,
  listScheduled,
  listSentEmails,
  listSuppressions,
  showReceived,
  showSentEmail,
} from '../operations/read.ts';
import { cancelScheduledChange } from '../operations/scheduled.ts';
import {
  beginSendApproval,
  executeSend,
  finishSendApproval,
  prepareSend,
  revokeSendApproval,
  sendStatus,
} from '../operations/send.ts';
import { VERSION } from '../version.ts';
import { askFor, readApiKey } from './prompt.ts';
import {
  renderAccount,
  renderAccounts,
  renderAdded,
  renderCancelled,
  renderDoctor,
  renderPolicy,
  renderPrepared,
  renderRead,
  renderRemoved,
  renderSent,
  renderStatus,
} from './render.ts';

/**
 * The `agent-resend` command.
 *
 * Connect a Resend account (a person, at a terminal), see what it can do, read domains, sent and received mail,
 * metrics and suppressions, and send an email — prepared, previewed, approved by a person, and sent once. Every
 * command prints a readable summary by default and the whole result under `--json`, with the same exit codes.
 *
 * Every command but three runs the same operation as its MCP tool. The three: `account add` (a key is typed at a
 * terminal, never into a chat), `approve` (under `confirm`, approving is a person at a terminal) and `mcp` (it starts
 * the server a tool would need already running).
 */

export interface CliDeps extends ResendContextOptions {
  streams?: Streams | undefined;
}

type Options = Record<string, unknown>;

interface GlobalOptions {
  json: boolean;
  color: boolean;
}

/** Commander quotes an unknown `--option=value` back whole; the value is taken out, in case it was a key. */
function withoutOptionValues(text: string): string {
  return text.replace(/'(-{1,2}[^'=\s]+)=[^']*'/g, "'$1=…'").replace(/\bre_[A-Za-z0-9_]{4,}/g, 're_…');
}

const collect = (value: string, previous: string[] = []): string[] => [...previous, value];

/** `--expect-to a@x.test,b@x.test`, or `none`: a list is always written out, so a permission prompt shows it. */
function expectList(raw: unknown, flag: string): string[] {
  const value = String(raw ?? '').trim();
  if (value === '') throw new CommsError('USAGE', `${flag} is required; write none for an empty list`);
  if (value.toLowerCase() === 'none') return [];
  return value
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean);
}

export async function run(argv: readonly string[], deps: CliDeps = {}): Promise<number> {
  const streams: Streams = deps.streams ?? { stdout: process.stdout, stderr: process.stderr, stdin: process.stdin };
  const env = deps.env ?? process.env;
  const program = new Command();
  let exitCode = 0;
  let ran = false;
  let softExit: number | null = null;

  program
    .name('agent-resend')
    .description(
      'Resend for coding agents: read domains, sent and received mail, and send email that goes out only when a person approves exactly what it says.',
    )
    .version(VERSION, '-v, --version')
    .option('--json', 'print the result as {"ok":true,"schemaVersion":1,"data":…}', false)
    .option('--no-color', 'never colour the output')
    .configureOutput({
      writeOut: (text) => streams.stdout.write(text),
      writeErr: (text) => streams.stderr.write(text),
      outputError: (text, write) => write(withoutOptionValues(text)),
    })
    .addHelpText(
      'after',
      `
Getting started:
  agent-resend account add acme/resend            a person types the key; it goes into the keychain
  agent-resend doctor                              what works, and who enforces what
  agent-resend domains --account acme/resend
  agent-resend received list --account acme/resend
  agent-resend mcp install --client claude-code   register the server with an agent, once a person approves it

Exit codes: 0 ok · 1 unexpected · 10 a send or a change was refused or needs approval · 11 an update
is out: update first, or put it off (agentcomms update, agentcomms update --later) · 64 usage ·
65 bad data · 66 not found · 69 provider or secret store unavailable · 75 temporary (retry later) ·
77 key or permission needed · 78 configuration problem.`,
    )
    .exitOverride();

  const globals = (): GlobalOptions => {
    const options = program.opts();
    return {
      json: Boolean(options.json),
      color: colorEnabled(env, streams.stdout, options.color as boolean | undefined),
    };
  };
  const output = (): OutputOptions => ({ json: globals().json, color: globals().color });

  /*
   * The daily update check (design 2026-09-28 §3), before any command but the exempt ones: an update that is out
   * stops it — a person at a terminal is asked "Update now, later today, or cancel?", anything else ends with
   * UPDATE_REQUIRED (exit 11). A hook on the program, so a command added later is gated by being a command at all;
   * `act` ends with the exit status it decided, when it decided one.
   */
  let gated: number | null = null;
  program.hook('preAction', async (_program, command) => {
    const path = commandPathOf(command);
    if (exemptFromUpdateGate(path)) return;
    const core = openCore({ env });
    let ended: number | null = null;
    const code = await runCommand(
      output(),
      async () => {
        ended = await updateGateAtTerminal({
          core,
          env,
          binary: 'agent-resend',
          channel: 'resend',
          running: VERSION,
          output: output(),
          noInput: false,
          streams,
          approveCommand: 'agent-resend approve',
          approvals: approvalsOf(command),
          // `send status` looks a send up by its approval, as `resend_send_status` does over MCP.
          approvalClaim: path.join(' ') === 'send status' ? SEND_LOOKUP : undefined,
          ...terminalUpdateHooks(core, env, { output: output(), streams, approveCommand: 'agent-resend approve' }),
        });
      },
      streams,
    );
    gated = code !== 0 ? code : ended;
  });

  const act =
    <A extends unknown[]>(body: (context: ResendContext, options: GlobalOptions, ...args: A) => Promise<void>) =>
    async (...args: A): Promise<void> => {
      ran = true;
      softExit = null;
      if (gated !== null) {
        exitCode = gated;
        return;
      }
      const context = new ResendContext({ ...deps, env, surface: 'cli' });
      exitCode = await runCommand(output(), () => body(context, globals(), ...args), streams);
      if (exitCode === 0 && softExit !== null) exitCode = softExit;
    };

  /** A change the way every changing command runs one: core's `gatedChangeAtTerminal`. */
  const changeAt = <T>(context: ResendContext, change: GatedChange<T>, flags: Options, command: string): Promise<T> =>
    gatedChangeAtTerminal(context.core, change, {
      approvalId: flags.approval === undefined ? undefined : String(flags.approval),
      env,
      output: output(),
      command,
      approveCommand: 'agent-resend approve',
      streams,
    });

  const approvalOption = (command: Command): Command =>
    command.option(
      '--approval <approvalId>',
      'apply a change a person approved: said yes to in chat, or approved with `agent-resend approve`',
    );
  const accountOption = (command: Command): Command =>
    command.requiredOption('--account <name>', 'which account, as `organisation/resend`');

  // ── account ────────────────────────────────────────────────────────────────────────────────────────────────────

  const account = program.command('account').description('connect, inspect, re-police and remove Resend accounts');

  approvalOption(
    account
      .command('add <name>')
      .description(
        'connect a Resend API key, typed by a person at this terminal (or RESEND_API_KEY); never from a chat',
      )
      .addOption(
        new Option('--mode <mode>', 'read (the default for a full-access key) or send').choices(['read', 'send']),
      )
      .addOption(
        new Option('--send <policy>', 'how its sends are approved; the machine default if left out').choices([
          'chat',
          'confirm',
          'never',
        ]),
      )
      .option('--domain <domain>', 'for a sending-only key restricted to one domain: that domain'),
  ).action(
    act(async (context, options, name: string, flags: Options) => {
      const mode = modeOf(flags.mode);
      const command = `agent-resend account add ${name}${mode ? ` --mode ${mode}` : ''}${
        flags.send ? ` --send ${String(flags.send)}` : ''
      }${flags.domain ? ` --domain ${String(flags.domain)}` : ''}`;
      // The name first: a name that cannot be taken is refused before anybody types a key for it.
      checkNewName(await context.config(), name);
      const key = await readApiKey(env, streams, { json: options.json, command });
      // Through the machine's one throttle, like every other request: the key is on some team's budget already.
      const inspection = await inspectKey(context, key);
      const added = await changeAt(
        context,
        addAccountChange(
          context,
          {
            name,
            key,
            mode,
            sendPolicy: sendPolicyOf(flags.send),
            domain: flags.domain === undefined ? undefined : String(flags.domain),
          },
          inspection,
        ),
        flags,
        command,
      );
      writeResult(added, output(), (data) => renderAdded(data, options.color), streams);
    }),
  );

  account
    .command('list')
    .description('the Resend accounts this machine can use, and what each may do')
    .action(
      act(async (context, options) => {
        const result = await listAccounts(context);
        writeResult(result, output(), (data) => renderAccounts(data, options.color), streams);
      }),
    );

  account
    .command('show <name>')
    .description('one account: its key’s permission, its mode, its send policy, and who enforces what')
    .action(
      act(async (context, options, name: string) => {
        const result = await showAccount(context, name);
        writeResult(result, output(), (data) => renderAccount(data, options.color), streams);
      }),
    );

  approvalOption(
    account.command('remove <name>').description('forget an account and delete its key, once a person approves it'),
  ).action(
    act(async (context, _options, name: string, flags: Options) => {
      const removed = await changeAt(
        context,
        removeAccountChange(context, name),
        flags,
        `agent-resend account remove ${name}`,
      );
      writeResult(removed, output(), renderRemoved, streams);
    }),
  );

  approvalOption(
    account
      .command('policy <name>')
      .description(
        'report how its sends and changes are approved, or set --send, --mode and --change; loosening is approved by a person',
      )
      .option('--send <policy>', 'chat, confirm or never')
      .option('--mode <mode>', 'read or send')
      .option('--change <policy>', 'how a loosening of this account is approved: chat or confirm'),
  ).action(
    act(async (context, _options, name: string, flags: Options) => {
      const wanted = policyWanted({ send: flags.send, mode: flags.mode, change: flags.change });
      const reporting = wanted.send === undefined && wanted.mode === undefined && wanted.change === undefined;
      if (reporting) refuseUnclaimedApproval(flags.approval, policyApprovalRefusal('cli'));
      const result = reporting
        ? await policyReport(context, name)
        : await changeAt(
            context,
            policyChange(context, name, wanted),
            flags,
            `agent-resend account policy ${name}${wanted.send ? ` --send ${wanted.send}` : ''}${
              wanted.mode ? ` --mode ${wanted.mode}` : ''
            }${wanted.change ? ` --change ${wanted.change}` : ''}`,
          );
      writeResult(result, output(), renderPolicy, streams);
    }),
  );

  // ── doctor ─────────────────────────────────────────────────────────────────────────────────────────────────────

  program
    .command('doctor')
    .description(
      'check what has to work, and say who enforces what — read-only is this package’s promise, not the key’s',
    )
    .option('--account <name>', 'check only this account')
    .option('--offline', 'do not ask Resend anything', false)
    .action(
      act(async (context, options, flags: Options) => {
        const result = await runDoctor(context, {
          account: flags.account === undefined ? undefined : String(flags.account),
          offline: flags.offline === true,
        });
        if (!result.healthy) softExit = 78;
        writeResult(result, output(), (data) => renderDoctor(data, options.color), streams);
      }),
    );

  // ── reading ────────────────────────────────────────────────────────────────────────────────────────────────────

  accountOption(program.command('domains'))
    .description('the team’s domains and their status; with --domain, the DNS records one needs')
    .option('--domain <domain>', 'one domain, by name or id')
    .action(
      act(async (context, options, flags: Options) => {
        const result = await listDomains(context, String(flags.account), {
          domain: flags.domain === undefined ? undefined : String(flags.domain),
        });
        writeResult(result, output(), (data) => renderRead(data, options.color), streams);
      }),
    );

  const emails = program.command('emails').description('sent emails: what went, and what happened to it');

  accountOption(emails.command('list'))
    .description('recent sent emails, newest first, with their last event')
    .option('--limit <n>', 'how many: 1 to 100', '20')
    .option('--after <id>', 'continue after this email id, from an earlier page')
    .action(
      act(async (context, options, flags: Options) => {
        const result = await listSentEmails(context, String(flags.account), { limit: flags.limit, after: flags.after });
        writeResult(result, output(), (data) => renderRead(data, options.color), streams);
      }),
    );

  accountOption(emails.command('show <id>'))
    .description('one sent email: its last event, its Message-ID, and what it said')
    .action(
      act(async (context, options, id: string, flags: Options) => {
        const result = await showSentEmail(context, String(flags.account), id);
        writeResult(result, output(), (data) => renderRead(data, options.color), streams);
      }),
    );

  const received = program
    .command('received')
    .description('received emails — untrusted content, shown with Resend’s SPF, DKIM and DMARC results');

  accountOption(received.command('list'))
    .description('recent received emails, newest first')
    .option('--limit <n>', 'how many: 1 to 100', '20')
    .option('--after <id>', 'continue after this email id, from an earlier page')
    .action(
      act(async (context, options, flags: Options) => {
        const result = await listReceived(context, String(flags.account), { limit: flags.limit, after: flags.after });
        writeResult(result, output(), (data) => renderRead(data, options.color), streams);
      }),
    );

  accountOption(received.command('show <id>'))
    .description('one received email: its body, its authentication, and its attachments listed, not downloaded')
    .action(
      act(async (context, options, id: string, flags: Options) => {
        const result = await showReceived(context, String(flags.account), id);
        writeResult(result, output(), (data) => renderRead(data, options.color), streams);
      }),
    );

  accountOption(received.command('download <id>'))
    .description(
      'save a received email’s attachments under the downloads folder, each under its attachment id; nothing is opened',
    )
    .option('--attachment <attachmentId>', 'only this attachment')
    .option('--out <subpath>', 'a folder inside the account’s downloads folder')
    .action(
      act(async (context, options, id: string, flags: Options) => {
        const result = await downloadReceived(context, String(flags.account), id, {
          attachmentId: flags.attachment,
          out: flags.out === undefined ? undefined : String(flags.out),
        });
        writeResult(result, output(), (data) => renderRead(data, options.color), streams);
      }),
    );

  accountOption(program.command('metrics'))
    .description('delivery, bounce and complaint counts; the last 7 days unless --start and --end say otherwise')
    .option('--start <date>', 'the first day, like 2026-09-01')
    .option('--end <date>', 'the last day')
    .action(
      act(async (context, options, flags: Options) => {
        const result = await getMetrics(context, String(flags.account), { start: flags.start, end: flags.end });
        writeResult(result, output(), (data) => renderRead(data, options.color), streams);
      }),
    );

  accountOption(program.command('suppressions'))
    .description('addresses Resend will not send to, and why')
    .option('--origin <origin>', 'bounce, complaint or manual')
    .option('--limit <n>', 'how many: 1 to 100', '20')
    .option('--after <id>', 'continue after this id, from an earlier page')
    .action(
      act(async (context, options, flags: Options) => {
        const result = await listSuppressions(context, String(flags.account), {
          origin: flags.origin,
          limit: flags.limit,
          after: flags.after,
        });
        writeResult(result, output(), (data) => renderRead(data, options.color), streams);
      }),
    );

  // ── sending ────────────────────────────────────────────────────────────────────────────────────────────────────

  const send = program.command('send').description('prepare an email, and send it once a person has approved it');

  accountOption(send.command('prepare'))
    .description('build an email and show exactly what would go, to whom. Sends nothing')
    .requiredOption('--from <address>', 'the sender, at a verified domain: `Name <you@example.com>` or a bare address')
    .requiredOption('--to <address>', 'a recipient; repeat for more', collect, [])
    .option('--cc <address>', 'a copy recipient; repeat for more', collect, [])
    .option('--bcc <address>', 'a blind recipient; repeat for more — the preview lists every one', collect, [])
    .requiredOption('--subject <subject>', 'the subject')
    .option('--text <text>', 'the plain-text body')
    .option('--html <html>', 'an HTML body whose visible text is the text body; no images, forms or hidden parts')
    .option('--attach <path>', 'a file to attach, from an allowed folder; repeat for more', collect, [])
    .option('--reply-to <address>', 'where replies go; repeat for more', collect, [])
    .option('--in-reply-to <messageId>', 'the Message-ID this replies to, to keep the thread')
    .option('--references <messageId>', 'an earlier Message-ID in the thread; repeat for more', collect, [])
    .option('--scheduled-at <time>', 'send later: an ISO 8601 time with a zone, at most 30 days ahead')
    .action(
      act(async (context, _options, flags: Options) => {
        const prepared = await prepareSend(context, String(flags.account), {
          from: String(flags.from),
          to: flags.to as string[],
          cc: flags.cc as string[],
          bcc: flags.bcc as string[],
          subject: String(flags.subject),
          text: flags.text === undefined ? undefined : String(flags.text),
          html: flags.html === undefined ? undefined : String(flags.html),
          attachments: flags.attach as string[],
          replyTo: flags.replyTo as string[],
          inReplyTo: flags.inReplyTo === undefined ? undefined : String(flags.inReplyTo),
          references: flags.references as string[],
          scheduledAt: flags.scheduledAt === undefined ? undefined : String(flags.scheduledAt),
        });
        writeResult(prepared, output(), renderPrepared, streams);
      }),
    );

  accountOption(send.command('execute <approvalId>'))
    .description('send a prepared email, once. Refuses unless the approval, the content and the recipients all match')
    .requiredOption('--expect-to <addresses>', 'the To list you believe it goes to, comma-separated, or none')
    .requiredOption('--expect-cc <addresses>', 'the Cc list, or none')
    .requiredOption('--expect-bcc <addresses>', 'the Bcc list, or none')
    .requiredOption('--expect-subject <subject>', 'the subject')
    .action(
      act(async (context, _options, approvalId: string, flags: Options) => {
        const sent = await executeSend(context, String(flags.account), {
          approvalId,
          expect: {
            to: expectList(flags.expectTo, '--expect-to'),
            cc: expectList(flags.expectCc, '--expect-cc'),
            bcc: expectList(flags.expectBcc, '--expect-bcc'),
            subject: String(flags.expectSubject),
          },
        });
        writeResult(sent, output(), renderSent, streams);
      }),
    );

  accountOption(send.command('status <approvalId>'))
    .description('what happened to a send — the local record, and Resend’s last event. Never sends again')
    .action(
      act(async (context, _options, approvalId: string, flags: Options) => {
        const status = await sendStatus(context, String(flags.account), approvalId);
        writeResult(status, output(), renderStatus, streams);
      }),
    );

  const scheduled = program.command('scheduled').description('emails waiting to be sent at a later time');

  accountOption(scheduled.command('list'))
    .description('scheduled emails among the most recent 300 sent')
    .action(
      act(async (context, options, flags: Options) => {
        const result = await listScheduled(context, String(flags.account));
        writeResult(result, output(), (data) => renderRead(data, options.color), streams);
      }),
    );

  approvalOption(
    accountOption(scheduled.command('cancel <id>')).description(
      'cancel a scheduled email; one this machine did not schedule is approved by a person first',
    ),
  ).action(
    act(async (context, _options, id: string, flags: Options) => {
      const cancelled = await changeAt(
        context,
        cancelScheduledChange(context, String(flags.account), id),
        flags,
        `agent-resend scheduled cancel ${id} --account ${String(flags.account)}`,
      );
      writeResult(cancelled, output(), renderCancelled, streams);
    }),
  );

  program
    .command('approve <approvalId>')
    .description('approve a send or a change at this terminal: read it, then type the code back')
    .action(
      act(async (context, options, approvalId: string) => {
        // Checked before the id is looked up, so an agent is told to hand this to a person whatever it passed. A
        // speed bump against the ordinary case, not a boundary: `script -q /dev/null` gives any command a terminal.
        const marker = agentMarker(env);
        if (marker) {
          throw new CommsError('APPROVAL_REQUIRED', 'only a person can approve a send or a change, not an agent', {
            hint: `Ask the user to run \`agent-resend approve ${approvalId}\` in their own terminal.`,
            details: { marker },
          });
        }
        if (!canPrompt(env, streams, { json: options.json })) {
          throw new CommsError('APPROVAL_REQUIRED', 'approving needs an interactive terminal', {
            hint: `Run \`agent-resend approve ${approvalId}\` directly in a terminal.`,
          });
        }
        const pending = await context.core.approvals.get(approvalId);
        if (pending && approvalKind(pending) === 'change') {
          const outcome = await approveChangeAtTerminal(
            context.core,
            approvalId,
            env,
            { json: options.json, color: options.color },
            streams,
          );
          streams.stdout.write(
            outcome.state === 'approved'
              ? 'Approved. This command approves; the change is applied by the command that prepared it.\n'
              : 'Cancelled. Nothing was changed.\n',
          );
          return;
        }
        const prompt = await beginSendApproval(context, approvalId);
        streams.stdout.write(`${prompt.preview}\n\n`);
        const answer = await askFor(
          streams,
          `Type ${paint(options.color, 'bold', prompt.challenge)} to approve this email, or press Enter to cancel: `,
        );
        if (!answer.trim()) {
          await revokeSendApproval(context, approvalId);
          streams.stdout.write('Cancelled. Nothing was sent.\n');
          return;
        }
        await finishSendApproval(context, approvalId, answer);
        streams.stdout.write('Approved. This command approves; it does not send.\n');
      }),
    );

  const mcp = program
    .command('mcp')
    .description('run the MCP server on stdio, for a coding agent to connect to')
    .option('--account <name>', 'pin the server to one account; every tool then acts on it and no other')
    .action(async (flags: Options) => {
      ran = true;
      const { startResendStdioServer } = await import('../mcp/stdio-entry.ts');
      await startResendStdioServer({ ...deps, env, ...(flags.account ? { account: String(flags.account) } : {}) });
    });

  mcp
    .command('install')
    .description('register this server with an MCP client, and prove it starts')
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
      'resend',
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
            hint: 'For example: `agent-resend mcp install --client claude-code`.',
          });
        }
        // `mcp` and `mcp install` both take `--account`, and Commander gives a repeated name to the parent.
        const pinned = (flags.account ?? mcp.opts().account) as string | undefined;
        const launcher = flags.launcher as 'managed' | 'npx' | 'local' | undefined;
        const name = flags.name as string | undefined;
        /*
         * The change `comms_server_install` makes, with this package's own product for its version and its code: an
         * approval from the tool is claimed here with `--approval`, and one from here by the tool. The command to run
         * again is word for word, nothing quoted: every word is fixed, a choice Commander checked, a server name the
         * change refuses unless it is plain, or an account it refuses unless it is connected.
         */
        const again = [
          'agent-resend',
          'mcp',
          'install',
          '--client',
          String(flags.client),
          ...(name !== undefined && name !== 'resend' ? ['--name', name] : []),
          ...(pinned !== undefined ? ['--account', pinned] : []),
          ...(launcher !== undefined ? ['--launcher', launcher] : []),
          ...(flags.verify === false ? ['--no-verify'] : []),
          ...(flags.force === true ? ['--force'] : []),
        ].join(' ');
        const result = await changeAt(
          context,
          serverInstallChange(
            context.core,
            env,
            {
              channel: 'resend',
              client: flags.client as SupportedClient,
              name,
              account: pinned,
              launcher,
              noVerify: flags.verify === false,
              print: flags.print === true,
              force: flags.force === true,
            },
            RESEND_MCP,
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
            { channel: 'resend', dryRun: flags.dryRun === true, includePrinted: flags.includePrinted === true },
            RESEND_MCP,
          ),
          flags,
          `agent-resend mcp prune${flags.includePrinted === true ? ' --include-printed' : ''}`,
        );
        writeResult(result, output(), () => renderPrune(result, options.color), streams);
      }),
    );

  try {
    await program.parseAsync([...argv], { from: 'user' });
  } catch (error) {
    if (error instanceof CommanderError) {
      if (['commander.helpDisplayed', 'commander.help', 'commander.version'].includes(error.code)) return 0;
      const message = withoutOptionValues(error.message.replace(/^error: /, ''));
      return runCommand(
        output(),
        async () => {
          throw new CommsError('USAGE', message, { hint: 'Run `agent-resend --help` to see the commands.' });
        },
        streams,
      );
    }
    throw error;
  }
  if (!ran) {
    streams.stderr.write(`${paint(globals().color, 'dim', 'Nothing to do. Try `agent-resend --help`.')}\n`);
    return 64;
  }
  return exitCode;
}
