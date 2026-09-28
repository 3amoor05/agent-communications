import { gatedChangeAtTerminal } from './change-flow.ts';
import { agentMarker, canPrompt, type OutputOptions, paint, type Streams } from './cli-runtime.ts';
import type { Core } from './core.ts';
import { CommsError, EXIT_CODES } from './errors.ts';
import { updateLaterChange } from './operations/update-settings.ts';
import {
  type PendingUpdate,
  pendingUpdate,
  readUpdateCheck,
  UPDATE_FIRST,
  UPDATE_WAYS,
  updateCheckDue,
  updateCheckEnabled,
  updateCheckSwitchedOff,
  updateStopMessage,
} from './update-state.ts';

/**
 * The daily update check's stop, where every server and every command meets it (design 2026-09-28 §2, §3).
 *
 * Reader only, like `update-state.ts`: what asks the registry is handed in — `refresh` to a server's gate, `check` and
 * `update` to a command's — by every package but WhatsApp, which has no network code and hands in nothing.
 */

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
  /** The version this server is. */
  running: string;
  /** Tools never stopped: the update's own, and what a person needs to see what is wrong — each doctor, the paths. */
  exempt: readonly string[];
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
 * The file is read as it is: the check itself never delays a call. A call carrying `approvalId` goes ahead — the
 * person said yes to exactly it, perhaps moments before the check landed — and the stop applies from the next new
 * request (§2, as agreed).
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
    if (exempt.has(tool) || args.approvalId !== undefined) return null;
    const pending = await pendingUpdate(options);
    return pending === null ? null : stoppedCall(pending, { server: options.server, tool });
  };
}

/**
 * The answer to a stopped call. Its text opens with the owner's sentence, word for word, and says the rest in prose:
 * a client that shows the model only text blocks (Cursor) reads it there. Claude Code and Codex show only
 * `structuredContent`, so the same words are its `message`, with the versions and the two ways on beside them.
 */
export function stoppedCall(pending: PendingUpdate, where: { server: string; tool: string }): object {
  const message = updateStopMessage(pending, where);
  return {
    isError: true,
    content: [{ type: 'text' as const, text: message }],
    structuredContent: {
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
          update: UPDATE_WAYS.update,
          later: UPDATE_WAYS.later,
        },
      },
    },
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

/** What asks the registry for a command: handed in by every CLI but WhatsApp's — see `terminalUpdateHooks`. */
export interface TerminalUpdateHooks {
  /** The check, when the file is a day old; it gives up when `signal` aborts, and never throws. */
  check?: ((signal: AbortSignal) => Promise<void>) | undefined;
  /** The update, at this terminal, with its own preview and yes. Resolves to the exit status to end with. */
  update?: (() => Promise<number>) | undefined;
}

export interface TerminalGateOptions extends TerminalUpdateHooks {
  core: Core;
  env: NodeJS.ProcessEnv;
  /** The command a person typed, `agent-gmail`: what the prompt and the messages name. */
  binary: string;
  /** The version this command is. */
  running: string;
  output: OutputOptions;
  noInput?: boolean | undefined;
  streams: Streams;
  /** The command that approves a change beside this CLI, for "later" under the `confirm` change policy. */
  approveCommand?: string | undefined;
  now?: (() => Date) | undefined;
  /** How long the check may take before the command goes on without it. About three seconds. */
  waitMs?: number | undefined;
}

export const TERMINAL_CHECK_WAIT_MS = 3_000;

/**
 * The update gate at a terminal, before a command runs. Resolves to null to run the command, or to the exit status to
 * end with instead; throws `UPDATE_REQUIRED` (exit 11) where nobody can be asked.
 *
 * It reads the file first. If the file is a day old it asks the registry — through `check` — waiting at most about
 * three seconds and going on without it after that. Then, when a newer release is out and nothing puts it off:
 *
 * - a person at a terminal (stdin and stdout a terminal, no `--json`, not `CI`, not an agent) is asked "Update now,
 *   later today, or cancel?". Now runs the update, with its own preview and yes, and ends asking them to run the
 *   command again; later records "not now" — their answer is the approval — and runs the command; cancel ends, having
 *   done nothing;
 * - anything else — a script, cron, an agent, `--json` — gets `UPDATE_REQUIRED`, naming `agentcomms update` and
 *   `agentcomms update --later`, and the command does not run.
 *
 * An update installed but not yet run by this command — nothing on the machine behind — stops nothing: there is no
 * client to restart and nothing to update, so it is said on stderr and the command runs.
 */
export async function updateGateAtTerminal(options: TerminalGateOptions): Promise<number | null> {
  const { core, env, streams, output } = options;
  const now = options.now ?? (() => new Date());
  if (!(await updateCheckEnabled(core, env)).on) return null;
  if (options.check && updateCheckDue(await readUpdateCheck(core.paths.stateDir), now())) {
    // A timer of its own rather than `AbortSignal.timeout`, whose timer does not keep the process alive: a check
    // waiting on something that does not either would let the command end mid-wait, having run nothing.
    const wait = new AbortController();
    const timer = setTimeout(() => wait.abort(), options.waitMs ?? TERMINAL_CHECK_WAIT_MS);
    const gaveUp = new Promise<void>((resolve) =>
      wait.signal.addEventListener('abort', () => resolve(), { once: true }),
    );
    try {
      await Promise.race([options.check(wait.signal).catch(() => undefined), gaveUp]);
    } finally {
      clearTimeout(timer);
    }
  }
  const pending = await pendingUpdate({ core, env, running: options.running, now });
  if (pending === null) return null;
  if (pending.kind === 'restart') {
    streams.stderr.write(
      `${paint(output.color, 'dim', 'note')}: this is ${options.binary} ${pending.running}; ${pending.latest} is installed on this machine. Run the command from it to use it.\n`,
    );
    return null;
  }

  const person =
    agentMarker(env) === null && canPrompt(env, streams, { json: output.json, noInput: options.noInput === true });
  if (!person) {
    throw new CommsError(
      'UPDATE_REQUIRED',
      `${UPDATE_FIRST} ${pending.latest} is out (you have ${pending.running}): run \`${UPDATE_WAYS.update.command}\` first, or \`${UPDATE_WAYS.later.command}\` to put it off until tomorrow`,
      {
        hint: `Nothing was done. Both are changes a person approves: an agent gets the preview and an approval id (exit 10), and runs the same command again with --approval <id> once the person agrees. Where agentcomms is not installed: \`${UPDATE_WAYS.update.npx}\`.`,
        details: {
          running: pending.running,
          latest: pending.latest,
          update: UPDATE_WAYS.update,
          later: UPDATE_WAYS.later,
        },
      },
    );
  }

  const answer = (
    await askLine(
      streams,
      `${pending.latest} is out (you have ${pending.running}). Update ${paint(output.color, 'bold', 'now')}, ${paint(output.color, 'bold', 'later')} today, or ${paint(output.color, 'bold', 'cancel')}? `,
    )
  )
    .trim()
    .toLowerCase();
  if (answer === 'now' || answer === 'update') {
    if (options.update) return options.update();
    // WhatsApp: it has no network code, so it cannot fetch an update itself; `agentcomms update` does it for all.
    streams.stdout.write(
      `${options.binary} reads only this machine and cannot fetch the update itself. Run \`${UPDATE_WAYS.update.command}\` (\`${UPDATE_WAYS.update.npx}\` where agentcomms is not installed), then run your command again.\n`,
    );
    return EXIT_CODES.UPDATE;
  }
  if (answer === 'later' || answer === 'l') {
    // The person's answer is the approval, as for `setup`'s "Connect this to an agent?": under `chat` nothing more is
    // asked; under `confirm` the typed code still is, because that is what the policy means.
    const result = await gatedChangeAtTerminal(core, updateLaterChange(core, { now }), {
      env,
      output,
      command: UPDATE_WAYS.later.command,
      approveCommand: options.approveCommand,
      answered: true,
      streams,
    });
    streams.stderr.write(
      `Put off until midnight${result.latest ? `: ${result.latest} will be asked about again tomorrow` : ''}.\n`,
    );
    return null;
  }
  throw new CommsError('USAGE', `cancelled: ${options.binary} did not run, and nothing was changed`, {
    hint: `Update with \`${UPDATE_WAYS.update.command}\`, or put it off until tomorrow with \`${UPDATE_WAYS.later.command}\`.`,
  });
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
