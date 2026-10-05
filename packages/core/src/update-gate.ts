import { asV2, kindOf } from './approval-stored.ts';
import type { ApprovalKind } from './approvals.ts';
import { gatedChangeAtTerminal } from './change-flow.ts';
import { CHANNEL_SNAPSHOT } from './channels.generated.ts';
import { agentMarker, canPrompt, type OutputOptions, paint, type Streams } from './cli-runtime.ts';
import type { Core } from './core.ts';
import { CommsError, EXIT_CODES } from './errors.ts';
import { handoffSentence } from './handoffs.ts';
import { updateLaterChange } from './operations/update-settings.ts';
import {
  type PendingUpdate,
  pendingUpdate,
  readUpdateCheck,
  UPDATE_FIRST,
  type UpdateCommands,
  updateCheckDue,
  updateCheckEnabled,
  updateCheckSwitchedOff,
  updateCommandSaid,
  updateCommands,
  updateStopMessage,
  updateVerdict,
  updateWaysOf,
} from './update-state.ts';

/**
 * The daily update check's stop, where every server and every command meets it (design 2026-09-28 §2, §3).
 *
 * Reader only, like `update-state.ts`: what asks the registry is handed in — `refresh` to a server's gate, `check` and
 * `update` to a command's — by every package but WhatsApp, which has no network code and hands in nothing.
 */

/**
 * What the approval id a call carries is to that call: what the stop holds it to before letting the call through.
 */
export interface ApprovalClaim {
  /**
   * The kind of approval the call takes — a send, or a change — where the surface knows it. Left out, either: the
   * tool's own claim refuses the other kind, and the stop holds the id to its state alone.
   */
  kind?: ApprovalKind | undefined;
  /**
   * The call looks the approval up rather than claiming it: Resend's send status, asked about a send by the approval
   * it went under — used, failed, or with an outcome nobody knows. Held to its kind only, because what the call reads
   * is that very send, the tail of something the person already said yes to, and nothing it can do is anything more.
   */
  lookup?: boolean | undefined;
  /**
   * The tool argument that carries the id, when it is not `approvalId`: a download carries its question's as
   * `choiceId`, beside the person's answer. Over MCP only; a command's ids are read by `approvalsOf`.
   */
  argument?: string | undefined;
}

/** A call that looks a send up by its approval: Resend's `resend_send_status`, and `agent-resend send status`. */
export const SEND_LOOKUP: Readonly<ApprovalClaim> = Object.freeze({ kind: 'send', lookup: true });

/** A call that claims a change: every core command and tool that takes an approval. */
export const CHANGE_CLAIM: Readonly<ApprovalClaim> = Object.freeze({ kind: 'change' });

/**
 * A call that answers a download's question: `gmail_attachment_download` and `slack_file_download` with `choiceId`,
 * `agent-gmail attachments download` and `agent-slack files download` with `--choice`. The person answered where to
 * save moments ago, so the call goes past the stop as a claimed approval does (§2). The answer alone — `saveTo`,
 * `--to` — claims nothing, and is stopped like any new request.
 */
export const DOWNLOAD_CLAIM: Readonly<ApprovalClaim> = Object.freeze({ kind: 'download', argument: 'choiceId' });

/**
 * Whether a call claims an approval the person already gave (§2): an approval this machine's approval store holds —
 * every channel keeps its approvals there — that is still waiting to be used, pending or approved, and of the kind the
 * call takes where the surface says which. Only then does the call go past the stop.
 *
 * The key alone is not a claim. An empty `approvalId`, or an id nobody prepared, claims nothing, and let past it
 * would run the tool's first-call path with an update out — a preview, or a tightening applied at once. Each tool
 * refuses an approval it does not know anyway; the stop must not be what an unknown one walks around. The store
 * refuses anything that is not an approval id before it looks, so that is not checked twice.
 *
 * Nor is every id the store holds. Records stay in it after they are used, revoked or expired, and one of those let
 * any call past the stop for as long as it was kept: an old "not now" the person turned down walked `agentcomms
 * channels` straight through. Such a record claims nothing any more — there is nothing left of it for the person to
 * lose by waiting — except to a look-up (`lookup`), which only reads it.
 *
 * What is not checked here is that the approval was prepared for this very call. The store binds a change to its
 * digest, and a send to its draft, which only the tool can compute; it does, when it claims the approval, and refuses
 * any other. A change that needs no approval claims none, and refuses one it is handed (`gatedChange`), so an approval
 * prepared for another change gets a call past the stop only to that refusal.
 */
export async function claimsApproval(core: Core, id: unknown, claim: ApprovalClaim = {}): Promise<boolean> {
  // No id at all, the usual call: nothing to look up.
  if (typeof id !== 'string') return false;
  const stored = await core.approvals.get(id).catch(() => null);
  if (stored === null) return false;
  // A kind that cannot be known matches no kind asked for.
  if (claim.kind !== undefined && kindOf(stored) !== claim.kind) return false;
  // A look-up only reads: any record of the kind it asks about, an earlier release's included.
  if (claim.lookup === true) return true;
  // A claim, only for a valid version-2 record still waiting to be used. The store reads one past its deadline as
  // `expired`, so a pending one here is one that can still be used.
  const record = asV2(stored);
  return record !== null && (record.state === 'pending' || record.state === 'approved');
}

// ── A server: every tool call ─────────────────────────────────────────────────────────────────────────────────

/**
 * What `strictToolArguments` asks before a tool runs, with the call's checked arguments: null to let it run, or the
 * result to answer with instead.
 */
export type ToolGate = (tool: string, args: Readonly<Record<string, unknown>>) => Promise<object | null>;

export interface UpdateToolGateOptions {
  core: Core;
  env: NodeJS.ProcessEnv;
  /** The server, as the reply names it: `agent-gmail`, `agentcomms`. */
  server: string;
  /** Its channel, `gmail`, `core`: whose registrations say whether restarting the client would start `latest`. */
  channel: string;
  /** The version this server is. */
  running: string;
  /** Tools never stopped: the update's own, and what a person needs to see what is wrong — each doctor, the paths. */
  exempt: readonly string[];
  /**
   * What each tool's `approvalId` is to it, where the server knows: the kind it claims, or a look-up. A tool not named
   * here is held to the approval's state alone, and its own claim checks the kind.
   */
  approvals?: Readonly<Record<string, Readonly<ApprovalClaim>>> | undefined;
  /**
   * The check, run in the background — never awaited by a call — whenever a call arrives and none is running. Absent
   * for WhatsApp, which reads the file as whatever else on the machine last left it.
   */
  refresh?: (() => Promise<unknown>) | undefined;
  now?: (() => Date) | undefined;
}

/**
 * A server's gate. Before a tool runs: if a newer release is out, this machine has not put it off today, the check is
 * on — the setting, `CI` and `AGENT_COMMS_UPDATE_CHECK` — the tool is not exempt, and the call claims no approval the
 * person already gave, the tool does not run and the call is answered with the stop.
 *
 * The file is read as it is: the check itself never delays a call. A call carrying the id of an approval this machine
 * holds goes ahead — the person said yes to exactly it, perhaps moments before the check landed — and the stop applies
 * from the next new request (§2, as agreed).
 */
export function updateToolGate(options: UpdateToolGateOptions): ToolGate {
  const exempt = new Set(options.exempt);
  let running: Promise<unknown> | null = null;
  return async (tool, args) => {
    // Switched off by the environment: nothing — no check, no stop.
    if (updateCheckSwitchedOff(options.env) !== null) return null;
    if (options.refresh && running === null) {
      running = options
        .refresh()
        .catch(() => undefined)
        .finally(() => {
          running = null;
        });
    }
    if (exempt.has(tool)) return null;
    const pending = await pendingUpdate({ ...options, surface: 'server' });
    if (pending === null) return null;
    const claim = options.approvals?.[tool];
    if (await claimsApproval(options.core, args[claim?.argument ?? 'approvalId'], claim)) return null;
    return stoppedCall(
      pending,
      { server: options.server, channel: options.channel, tool },
      updateCommands(options.core),
    );
  };
}

/**
 * The answer to a stopped call. Its text opens with the owner's sentence, word for word, and says the rest in prose:
 * a client that shows the model only text blocks (Cursor) reads it there. Claude Code and Codex show only
 * `structuredContent`, so the same words are its `message`, with the versions and the two ways on beside them.
 */
export function stoppedCall(
  pending: PendingUpdate,
  where: { server: string; channel: string; tool: string },
  commands: UpdateCommands,
): object {
  const message = updateStopMessage(pending, where, commands);
  const ways = updateWaysOf(commands);
  /*
   * Written out here, where it leaves for the client: the two commands become the text they always were (their line, or
   * their words as JSON with what to do, or why there is none — `PrintedCommand.toJSON`), whatever the transport does.
   */
  const leaving = (value: object): Record<string, unknown> => JSON.parse(JSON.stringify(value));
  return {
    isError: true,
    content: [{ type: 'text' as const, text: message }],
    structuredContent: leaving({
      error: {
        code: 'UPDATE_REQUIRED',
        message,
        hint:
          pending.kind === 'restart'
            ? 'Restart the MCP client, or put the stop off until midnight with comms_update `later: true` once the person agrees.'
            : 'Update with comms_update (the person approves its preview), or put it off until midnight with comms_update `later: true` once the person agrees.',
        details: {
          tool: where.tool,
          server: where.server,
          running: pending.running,
          latest: pending.latest,
          installed: pending.kind === 'restart',
          update: ways.update,
          later: ways.later,
        },
      },
    }),
  };
}

// ── A command at a terminal ──────────────────────────────────────────────────────────────────────────────────────

/** The commands never stopped, by their first word; `mcp` alone runs a server, which stops each call itself. */
const EXEMPT_COMMANDS: readonly string[] = Object.freeze(['update', 'doctor', 'paths', 'approve', 'approvals', 'help']);

/**
 * Whether a command is left alone by the update gate: `update` in every form, `doctor`, `paths`, `approve`,
 * `approvals`, help, and `mcp` alone — the server, which gates every call itself. `mcp install` and `mcp prune` are
 * not: they register and prune at this command's release. `also` adds a channel's own — WhatsApp's `status`, its
 * doctor. `--help` and `--version` never reach a command.
 */
export function exemptFromUpdateGate(path: readonly string[], also: readonly string[] = []): boolean {
  const [first] = path;
  if (first === undefined) return true;
  if (EXEMPT_COMMANDS.includes(first) || also.includes(first)) return true;
  return first === 'mcp' && path.length === 1;
}

/** The shape of a Commander command this needs: its name, and the command it is under (null for the program). */
export interface CommandLike {
  name(): string;
  readonly parent: CommandLike | null;
}

/** A Commander command's path below the program, `['mcp', 'install']`: what `exemptFromUpdateGate` reads. */
export function commandPathOf(command: CommandLike): string[] {
  const path: string[] = [];
  for (let at: CommandLike | null = command; at?.parent; at = at.parent) path.unshift(at.name());
  return path;
}

/**
 * The approvals a Commander command claims: its `--approval`, the `--mcp-approval` Gmail's `setup` carries beside it,
 * the `--choice` a download carries its question's id in, and an argument named `approvalId` — `agent-gmail send
 * cancel <approvalId>`, `agent-resend send execute <approvalId>`, the commands whose tools take it as `approvalId`.
 * What the gate hands `claimsApproval`, as a tool call's `approvalId` is handed it. Commander has read the arguments
 * by the time a `preAction` hook runs.
 */
export function approvalsOf(command: {
  opts(): Record<string, unknown>;
  readonly registeredArguments?: readonly { name(): string }[];
  readonly processedArgs?: readonly unknown[];
}): unknown[] {
  const options = command.opts();
  const named = (command.registeredArguments ?? []).flatMap((argument, index) =>
    argument.name() === 'approvalId' ? [command.processedArgs?.[index]] : [],
  );
  return [options.approval, options.mcpApproval, options.choice, ...named];
}

/**
 * How the update a person asked for at the terminal went: `updated`, every step worked and nothing was left for a
 * person; `short`, it could do nothing, or left something for a person; `failed`, a step failed. Each has been
 * reported by then.
 */
export type TerminalUpdateOutcome = 'updated' | 'short' | 'failed';

/** What asks the registry for a command: handed in by every CLI but WhatsApp's — see `terminalUpdateHooks`. */
export interface TerminalUpdateHooks {
  /**
   * The check, when the file is a day old. It never throws, and it is never cut short: the gate stops waiting for it
   * after about three seconds, and it carries on beside the command — in a detached child of its own, which holds none
   * of the command's output, so the command's process ends when the command does (#48).
   */
  check?: (() => Promise<void>) | undefined;
  /** The update, at this terminal, with its own preview and yes. */
  update?: (() => Promise<TerminalUpdateOutcome>) | undefined;
}

export interface TerminalGateOptions extends TerminalUpdateHooks {
  core: Core;
  env: NodeJS.ProcessEnv;
  /**
   * The program a person typed, `agent-gmail`: an identity, kept with the gate and never said. The messages name the
   * CLI by its product — "this Gmail CLI" — since a binary's bare name is no command most people can run (CUE-403).
   */
  binary: string;
  /** Its channel, `gmail`, `core`: whose global package says whether running the command again would run `latest`. */
  channel: string;
  /** The version this command is. */
  running: string;
  output: OutputOptions;
  noInput?: boolean | undefined;
  streams: Streams;
  /**
   * The approval ids the command carries — `--approval`, `--mcp-approval` (`approvalsOf`). One this machine holds lets
   * the command run, as a tool call carrying it does over MCP (§2): the person said yes to exactly that.
   */
  approvals?: readonly unknown[] | undefined;
  /** What those ids are to the command, as a tool's `approvals` entry says it over MCP: the kind, or a look-up. */
  approvalClaim?: Readonly<ApprovalClaim> | undefined;
  now?: (() => Date) | undefined;
  /** How long the command waits for the check before it goes on without it. About three seconds. */
  waitMs?: number | undefined;
}

export const TERMINAL_CHECK_WAIT_MS = 3_000;

/**
 * The update gate at a terminal, before a command runs. Resolves to null to run the command, or to the exit status to
 * end with instead; throws `UPDATE_REQUIRED` (exit 11) where nobody can be asked.
 *
 * It reads the file first. If the file is a day old it asks the registry — through `check` — waiting at most about
 * three seconds and going on without it after that. Then, when a newer release is out, nothing puts it off, and the
 * command claims no approval the person already gave:
 *
 * - a person at a terminal (stdin and stdout a terminal, no `--json`, not `CI`, not an agent) is asked "Update now,
 *   later today, or cancel?". Now runs the update, with its own preview and yes, and ends asking them to run the
 *   command again; later records "not now" — their answer is the approval — and runs the command; cancel ends, having
 *   done nothing;
 * - anything else — a script, cron, an agent, `--json` — gets `UPDATE_REQUIRED`, naming `agentcomms update` and
 *   `agentcomms update --later`, and the command does not run.
 *
 * An update installed and not yet run by this command — this command's package is installed globally at the latest
 * release, and what is running is an older copy from somewhere else — stops it the same way, as the servers stop for
 * a client not yet restarted (§3: the terminal stops as chat does). Its "now" says to run the command again from the
 * installed one: there is nothing to update.
 */
export async function updateGateAtTerminal(options: TerminalGateOptions): Promise<number | null> {
  const { core, env, streams, output } = options;
  const now = options.now ?? (() => new Date());
  if (!(await updateCheckEnabled(core, env)).on) return null;
  // The day's check first, and only then the approvals a command claims: a command that goes ahead on one is still a
  // command the day's check would have started from. Over MCP the server starts it before it looks at the call.
  if (options.check && updateCheckDue(await readUpdateCheck(core.paths.stateDir), now())) {
    // Stops waiting, and goes on: the check itself is not cut short, and finishes beside the command. A timer that
    // keeps the process alive, so the wait is the wait, whatever the check is waiting on.
    let timer: NodeJS.Timeout | undefined;
    const gaveUp = new Promise<void>((resolve) => {
      timer = setTimeout(resolve, options.waitMs ?? TERMINAL_CHECK_WAIT_MS);
    });
    try {
      await Promise.race([options.check().catch(() => undefined), gaveUp]);
    } finally {
      clearTimeout(timer);
    }
  }
  for (const id of options.approvals ?? []) if (await claimsApproval(core, id, options.approvalClaim)) return null;
  const where = { channel: options.channel, surface: 'command' as const };
  const pending = await pendingUpdate({ core, env, running: options.running, now, ...where });
  if (pending === null) return null;

  const person =
    agentMarker(env) === null && canPrompt(env, streams, { json: output.json, noInput: options.noInput === true });
  const commands = updateCommands(core, output.platform);
  if (!person) throw updateRequired(pending, cliOf(options.channel), commands);

  const bold = (word: string) => paint(output.color, 'bold', word);
  const answer = (
    await askLine(
      streams,
      pending.kind === 'restart'
        ? `${pending.latest} is installed (this is ${pending.running}). Switch ${bold('now')}, ${bold('later')} today, or ${bold('cancel')}? `
        : `${pending.latest} is out (you have ${pending.running}). Update ${bold('now')}, ${bold('later')} today, or ${bold('cancel')}? `,
    )
  )
    .trim()
    .toLowerCase();
  if (answer === 'now' || answer === 'update') {
    if (pending.kind === 'restart') {
      streams.stdout.write(
        `${pending.latest} is installed globally; this ${cliOf(options.channel)} is ${pending.running}, started from somewhere else — npx's cache, a project's own install, a checkout. Run your command again from the installed one. The command did not run.\n`,
      );
      return EXIT_CODES.UPDATE;
    }
    if (!options.update) {
      // WhatsApp: it has no network code, so it cannot fetch an update itself; `agentcomms update` does it for all.
      streams.stdout.write(
        `This ${cliOf(options.channel)} reads only this machine and cannot fetch the update itself. ${updateCommandSaid(commands, 'update', (command) => `Run ${command}, then run your command again.`)}\n`,
      );
      return EXIT_CODES.UPDATE;
    }
    return afterUpdate(await options.update(), options, pending);
  }
  if (answer === 'later' || answer === 'l') {
    // The person's answer is the approval, as for `setup`'s "Connect this to an agent?": under `chat` nothing more is
    // asked; under `confirm` the typed code still is, because that is what the policy means.
    const result = await gatedChangeAtTerminal(core, updateLaterChange(core, { now }), {
      channel: options.channel,
      env,
      output,
      rerun: ['update', '--later'],
      rerunOn: 'core',
      answered: true,
      streams,
    });
    streams.stderr.write(
      `Put off until midnight${result.latest ? `: ${result.latest} will be asked about again tomorrow` : ''}.\n`,
    );
    return null;
  }
  throw new CommsError('USAGE', 'cancelled: the command did not run, and nothing was changed', {
    hint: bothSaid(commands, (update, later) => `Update with ${update}, or put it off until tomorrow with ${later}.`),
  });
}

/**
 * The CLI a gate stops, in product words — "Gmail CLI", "core CLI" — for its sentences: never its binary, which is no
 * command most people can run, and which a sentence would read as one (CUE-403).
 */
function cliOf(channel: string): string {
  if (channel === 'core') return 'core CLI';
  return `${CHANNEL_SNAPSHOT.find((entry) => entry.manifest.channel === channel)?.manifest.label ?? channel} CLI`;
}

/**
 * The stop where nobody can be asked: the command does not run. "Update" names the update and "not now"; "restart"
 * — the update installed, and an older copy running — says to run the command from the installed one.
 */
function updateRequired(pending: PendingUpdate, cli: string, commands: UpdateCommands): CommsError {
  const ways = updateWaysOf(commands);
  const details = {
    running: pending.running,
    latest: pending.latest,
    installed: pending.kind === 'restart',
    update: ways.update,
    later: ways.later,
  };
  if (pending.kind === 'restart') {
    return new CommsError(
      'UPDATE_REQUIRED',
      `Hang on a minute, the update is installed, but this command isn't running it yet. ${pending.latest} is installed globally, and this ${cli} is ${pending.running}: ${handoffSentence(commands.later, (later) => `run the command again from the installed one, or ${later} to put it off until tomorrow`)}`,
      {
        hint: `Nothing was done. An older copy is running — npx's cache, a project's own install, a checkout. "Not now" is a change a person approves: an agent gets the preview and an approval id (exit 10), and runs the same command again with --approval <id> once the person agrees.`,
        details,
      },
    );
  }
  return new CommsError(
    'UPDATE_REQUIRED',
    `${UPDATE_FIRST} ${pending.latest} is out (you have ${pending.running}): ${bothSaid(commands, (update, later) => `run ${update} first, or ${later} to put it off until tomorrow`)}`,
    {
      hint: `Nothing was done. Both are changes a person approves: an agent gets the preview and an approval id (exit 10), and runs the same command again with --approval <id> once the person agrees.`,
      details,
    },
  );
}

/** The update and "not now" in one sentence; with no command here — the same core gives both or neither — why not. */
function bothSaid(commands: UpdateCommands, say: (update: string, later: string) => string): string {
  return handoffSentence(commands.update, (update) => handoffSentence(commands.later, (later) => say(update, later)));
}

/**
 * What the terminal says after the person's "now", and the exit status. "Updated. Run your command again." only when
 * the update did everything and this command's release is now installed where it runs from — its global package at
 * the latest. Anything short of that says what, and ends with a status that is not 0: the command has not run, and a
 * script that goes on after `cmd && next` must not take it for the command's success.
 */
async function afterUpdate(
  outcome: TerminalUpdateOutcome,
  options: TerminalGateOptions,
  before: PendingUpdate,
): Promise<number> {
  const { streams } = options;
  const cli = cliOf(options.channel);
  const notRun = 'The command did not run';
  const commands = updateCommands(options.core, options.output.platform);
  if (outcome === 'failed') {
    streams.stdout.write(`${notRun}: the update did not finish — each step says how it went, above.\n`);
    return EXIT_CODES.UNAVAILABLE;
  }
  const after = updateVerdict(await readUpdateCheck(options.core.paths.stateDir), options.running, {
    channel: options.channel,
    surface: 'command',
  });
  if (after === null || after.kind === 'restart') {
    if (outcome === 'updated') {
      streams.stdout.write('Updated. Run your command again.\n');
      return EXIT_CODES.OK;
    }
    streams.stdout.write(`${before.latest} is installed here: run your command again from it. It did not run.\n`);
    return EXIT_CODES.UPDATE;
  }
  // Nothing the update reaches runs this command: `agentcomms update` moves registrations and global packages, and
  // this copy is neither. Saying "Updated" here would send the person round the same question again.
  streams.stdout.write(
    `${notRun}: the update did not bring it to ${before.latest}. The update moves what this machine registers and has installed globally — what it found is said above — and this ${cli}, ${before.running}, is started from somewhere else: npx's cache, a project's own install, a checkout. ${handoffSentence(commands.later, (later) => `Run it from ${before.latest}, or put this off until tomorrow with ${later}.`)}\n`,
  );
  return EXIT_CODES.UPDATE;
}

async function askLine(streams: Streams, question: string): Promise<string> {
  const { createInterface } = await import('node:readline/promises');
  const rl = createInterface({
    input: streams.stdin as NodeJS.ReadableStream,
    output: streams.stderr as NodeJS.WritableStream,
  });
  try {
    return await rl.question(question);
  } finally {
    rl.close();
  }
}
