import { createInterface } from 'node:readline/promises';
import { styleText } from 'node:util';
import { CommsError, EXIT_CODES, toCommsError } from './errors.ts';
import { challengeMatches, hashChallenge, newChallenge } from './ids.ts';
import { errorEnvelope, okEnvelope } from './output.ts';

/**
 * Output rules shared by every agent-communications CLI, so humans and agents get the same behaviour everywhere:
 * data on stdout, messages on stderr; `--json` prints the versioned envelope; colour only on a TTY and never with
 * NO_COLOR, TERM=dumb or --no-color; prompts only when stdin and stdout are both TTYs and nothing forbids them.
 */

export interface OutputOptions {
  json: boolean;
  color: boolean;
}

export interface Streams {
  stdout: NodeJS.WritableStream & { isTTY?: boolean };
  stderr: NodeJS.WritableStream & { isTTY?: boolean };
  stdin?: NodeJS.ReadableStream & { isTTY?: boolean };
}

export const defaultStreams: Streams = { stdout: process.stdout, stderr: process.stderr, stdin: process.stdin };

export function colorEnabled(env: NodeJS.ProcessEnv, stream: { isTTY?: boolean }, flag?: boolean): boolean {
  if (flag === false) return false;
  if (env.NO_COLOR !== undefined && env.NO_COLOR !== '') return false;
  if (env.TERM === 'dumb') return false;
  if (env.FORCE_COLOR !== undefined && env.FORCE_COLOR !== '0') return true;
  return Boolean(stream.isTTY);
}

/** True when a human could answer a prompt: both ends are terminals, no --json/--no-input, not CI. */
export function canPrompt(
  env: NodeJS.ProcessEnv,
  streams: Streams,
  options: { json?: boolean; noInput?: boolean },
): boolean {
  if (options.json || options.noInput) return false;
  if (env.CI && env.CI !== '0' && env.CI !== 'false') return false;
  return Boolean(streams.stdin?.isTTY && streams.stdout.isTTY);
}

/** Environment variables well-known coding agents set. Used only as a speed bump, never as a security boundary. */
const AGENT_MARKERS = [
  'CLAUDECODE',
  'CLAUDE_CODE_ENTRYPOINT',
  'CODEX_SANDBOX',
  'CODEX_HOME',
  'CURSOR_AGENT',
  'GEMINI_CLI',
  'AGENT_COMMS_AGENT',
];

export function agentMarker(env: NodeJS.ProcessEnv): string | null {
  for (const name of AGENT_MARKERS) if (env[name] !== undefined && env[name] !== '') return name;
  return null;
}

export function paint(color: boolean, format: Parameters<typeof styleText>[0], text: string): string {
  return color ? styleText(format, text, { validateStream: false }) : text;
}

/**
 * One word of a command to print. A plain string is a word of the command itself, or a value that may as well be
 * called after the option before it; a value with a `label` is called that — `NAME`, `PATH` — if it has to be
 * typed by hand (see `shellCommand`).
 */
export type ShellWord = string | { readonly value: string; readonly label: string };

/** A word no quoting could make safe to paste, and the placeholder printed in its place. */
export interface TypedByHand {
  /** `NAME`, `PATH`, `WORKSPACE`: what stands for the word in `ShellCommand.line`. */
  readonly placeholder: string;
  readonly value: string;
}

/**
 * A command for a person to copy and run, as `shellCommand` prints it.
 *
 * Never a bare string, so that no printer can show `line` and forget `byHand`: a line with a placeholder in it is not
 * the command, and whoever reads it has to be told what goes in the gap — `inlineCommand` and `commandText` say it.
 */
export interface ShellCommand {
  /** The words as the shell will read them, or a capitalised placeholder for each that no quoting makes safe. */
  readonly line: string;
  /** The words a person has to type in themselves, one per placeholder in `line`; empty when `line` runs as it is. */
  readonly byHand: readonly TypedByHand[];
}

/**
 * A command line for a person to copy and run, each word quoted only where the shell it is pasted into would need it.
 * Every command this package prints to be run — a change to run again with its approval, a folder to take out, an
 * entry to register again or remove — is quoted here, so no printer quotes for a shell of its own.
 *
 * Everywhere but Windows that shell is a POSIX one, and a word goes in single quotes, inside which nothing is special
 * but the quote itself. Windows has two shells, and neither reads single quotes that way: cmd.exe does not take them
 * as quotes at all, so `'C:\Profiles\First Last\outgoing'` reached the command as two words, quote marks and all, and
 * PowerShell does, but escapes a quote inside them by doubling it rather than as `'\''`. A command printed on Windows
 * has to be safe in both, because nothing says which one it will be pasted into (CUE-306):
 *
 * - A word of letters, digits and `_ + = : . / \ -`, with `@` anywhere but first, is left as it is: neither shell
 *   reads anything in it, and a backslash is an ordinary character to both. A first `@` is splatting to PowerShell, a
 *   `,` its array operator — two words — so a word with either is quoted.
 * - A word that double quotes keep whole and unexpanded in both shells goes in double quotes. Inside them cmd.exe
 *   reads `& | < > ^ ( )` and spaces as ordinary characters, and PowerShell reads everything as ordinary but `$`, the
 *   backtick and a double quote. What is left special in one or the other is kept out: a double quote, which ends the
 *   quoting in both — and PowerShell takes the curly ones, `“ ” „`, for one too; `$` and the backtick, PowerShell's
 *   expansion and escape; `%`, which cmd.exe expands as `%NAME%` before it looks at quotes at all; `!`, which it
 *   expands as `!NAME!` inside quotes too wherever delayed expansion is on, and which then makes a `^` inside quotes an
 *   escape; and any control or formatting character — a line break ends the command in cmd.exe even inside quotes, a
 *   tab pasted into cmd.exe can complete a file name, and a right-to-left override shows a line other than the one
 *   that runs. Backslashes at the word's end are doubled: before a closing quote, a program's own argument parser
 *   (Node's, the C runtime's) takes them as escapes, and `"C:\First Last\"` would end in a quote mark rather than the
 *   folder. (Windows PowerShell 5.1 drops an empty `""` rather than pass it on; it keeps every other such word.)
 * - Any other word has no quoting both shells read alike, so no command is printed with it in. It was quoted for
 *   PowerShell in its single quotes, which cmd.exe takes as ordinary characters: a server named `$x&whoami&` printed
 *   as `'$x&whoami&'`, and in cmd.exe that ran `whoami`. Such a word is printed as a placeholder — named after its
 *   `label`, or the option before it, or `VALUE` — in capitals: `NAME`, `PATH`, `NAME-2` — listed in `byHand` with the
 *   word it stands for, for the printer to give separately as data. A plain word, because it has to be inert in both
 *   shells: an earlier `<name>` was refused by PowerShell, but cmd.exe read `<` and `>` as redirections — input from a
 *   file called `name`, output to a file named after the next word — so a line pasted in a folder that had such a file
 *   ran, and wrote a file. A capitalised word runs nothing it should not; at worst it names a thing that is not there.
 *
 * Everywhere else `byHand` is empty: single quotes make any word safe.
 */
export function shellCommand(words: readonly ShellWord[], platform: NodeJS.Platform = process.platform): ShellCommand {
  const byHand: TypedByHand[] = [];
  /** The words given each label so far: one word twice is one placeholder, and two words are `NAME`, `NAME-2`. */
  const labelled = new Map<string, string[]>();
  const printed = words.map((word, index) => {
    const value = typeof word === 'string' ? word : word.value;
    if (platform !== 'win32') return posixShellWord(value);
    const quoted = windowsShellWord(value);
    if (quoted !== null) return quoted;
    const before = words[index - 1];
    const option = typeof before === 'string' ? /^--([a-z][a-z-]*)$/.exec(before)?.[1] : undefined;
    const label = typeof word === 'string' ? (option ?? 'value') : word.label;
    const values = labelled.get(label) ?? [];
    labelled.set(label, values);
    const seen = values.indexOf(value);
    const position = seen === -1 ? values.push(value) : seen + 1;
    const capitals = label.toUpperCase();
    const placeholder = position === 1 ? capitals : `${capitals}-${position}`;
    if (seen === -1) byHand.push({ placeholder, value });
    return placeholder;
  });
  return { line: printed.join(' '), byHand };
}

function posixShellWord(word: string): string {
  return /^[\w@%+=:,./-]+$/.test(word) ? word : `'${word.replace(/'/g, `'\\''`)}'`;
}

/** The word as both Windows shells read it, or null when no quoting makes it so. */
function windowsShellWord(word: string): string | null {
  if (/^[\w+=:./\\-][\w@+=:./\\-]*$/.test(word)) return word;
  if (/["$`%!\u201C-\u201E]|[\p{C}\p{Zl}\p{Zp}]/u.test(word)) return null;
  return `"${word.replace(/\\+$/, (slashes) => slashes + slashes)}"`;
}

/**
 * What to type in place of each placeholder in `commands`, as a clause; empty when every word was printed.
 *
 * The word itself is given as JSON — in quotes, with a line break or a quote mark inside written as an escape — and
 * named as JSON, so that nobody takes it for something to paste: pasted into cmd.exe as it is, `$x&whoami&` runs
 * `whoami`. How to quote it is left to the person, who knows which shell they are in.
 */
export function typeByHand(...commands: readonly ShellCommand[]): string {
  const words = new Map<string, TypedByHand>();
  for (const word of commands.flatMap((command) => command.byHand))
    words.set(`${word.placeholder}\n${word.value}`, word);
  if (words.size === 0) return '';
  const each = [...words.values()].map((word) => `${word.placeholder} is ${JSON.stringify(word.value)}`);
  const list = each.length === 1 ? each[0] : `${each.slice(0, -1).join(', ')} and ${each.at(-1)}`;
  return `${list}, written as JSON: type ${each.length === 1 ? 'it' : 'them'} in yourself, quoted for your shell — no quoting reads the same in cmd.exe and PowerShell`;
}

/** A command in backticks, for a sentence — and after it, when a word could not be printed, what to type in its place. */
export function inlineCommand(command: ShellCommand): string {
  const byHand = typeByHand(command);
  return byHand === '' ? `\`${command.line}\`` : `\`${command.line}\` (${byHand})`;
}

/** A command as text of its own — a list's line, a field's value — with what to type in place of any placeholder. */
export function commandText(command: ShellCommand): string {
  const byHand = typeByHand(command);
  return byHand === '' ? command.line : `${command.line} (${byHand})`;
}

/** Writes a successful result: the envelope with --json, otherwise the human rendering. */
export function writeResult<T>(
  data: T,
  options: OutputOptions,
  human: (data: T) => string,
  streams: Streams = defaultStreams,
): void {
  if (options.json) {
    streams.stdout.write(`${JSON.stringify(okEnvelope(data))}\n`);
    return;
  }
  const text = human(data);
  if (text) streams.stdout.write(text.endsWith('\n') ? text : `${text}\n`);
}

/** Writes an error and returns the exit code to use. */
export function writeError(error: unknown, options: OutputOptions, streams: Streams = defaultStreams): number {
  const commsError: CommsError = toCommsError(error);
  if (options.json) {
    streams.stdout.write(`${JSON.stringify(errorEnvelope(commsError))}\n`);
  } else {
    streams.stderr.write(`${paint(options.color, 'red', 'error')}: ${commsError.message}\n`);
    if (commsError.hint) streams.stderr.write(`${paint(options.color, 'dim', 'hint')}: ${commsError.hint}\n`);
  }
  return commsError.exitCode;
}

/** Runs a command body and exits with the documented code. Unexpected errors keep only their message. */
export async function runCommand(
  options: OutputOptions,
  body: () => Promise<void>,
  streams: Streams = defaultStreams,
): Promise<number> {
  try {
    await body();
    return EXIT_CODES.OK;
  } catch (error) {
    return writeError(error, options, streams);
  }
}

export interface ChallengeOptions {
  /** One line saying what is about to change. */
  prompt: string;
  color: boolean;
  /** Attempts before giving up. */
  attempts?: number;
}

/**
 * Asks a person at the terminal to type a short code back. It exists to make a change deliberate: an agent that can
 * run commands can also type an answer, so this is a speed bump against an accidental or hasty change, never a
 * security boundary — the real boundary is that agents are refused outright (see the agent-marker check).
 *
 * Here rather than in one package because two need it now, and a second copy of a consent prompt is a second set
 * of wording, a second attempt count, and eventually two different ideas of what confirming something means.
 */
export async function askChallenge(streams: Streams, options: ChallengeOptions): Promise<void> {
  const challenge = newChallenge();
  // Only the hash is compared, in constant time, exactly as an approval challenge is.
  const expected = hashChallenge(challenge);
  const attempts = options.attempts ?? 3;
  const rl = createInterface({
    input: streams.stdin as NodeJS.ReadableStream,
    output: streams.stderr as NodeJS.WritableStream,
  });
  try {
    streams.stderr.write(`${options.prompt}\n`);
    for (let attempt = 1; attempt <= attempts; attempt++) {
      const answer = await rl.question(
        `Type ${paint(options.color, 'bold', challenge)} to confirm (or press Enter to cancel): `,
      );
      if (answer.trim() === '') break;
      if (challengeMatches(answer, expected)) return;
      streams.stderr.write(`That did not match${attempt < attempts ? ', try again' : ''}.\n`);
    }
  } finally {
    rl.close();
  }
  throw new CommsError('LOOSENING_REFUSED', 'the change was not confirmed, so nothing was changed');
}

/** What a loosening says when it has to be refused, and what it asks when it does not. */
export interface PersonGate {
  /** The refusal when an agent runs it, e.g. "only a person can decide which clients they trust". */
  refusedToAgent: string;
  /** The refusal when there is no terminal to ask at. */
  refusedWithoutTerminal: string;
  /** The command the person should run themselves, named in both refusals. */
  command: string;
  /** The one line said before the challenge. */
  prompt: string;
  color: boolean;
  json?: boolean | undefined;
  noInput?: boolean | undefined;
}

/**
 * The gate every loosening goes through: an agent is refused, anything without a terminal is refused, and a person
 * types the challenge back.
 *
 * One function because it was four copies — two in Gmail, one in Slack, one in the core CLI — each with the same
 * three steps and its own wording, and a security gate kept in four places is one that will eventually differ in
 * one of them. The callers keep their own messages and build their own consent; the order of the checks, the hint
 * wording and the challenge are here.
 */
export async function requirePerson(env: NodeJS.ProcessEnv, streams: Streams, gate: PersonGate): Promise<void> {
  refuseUnlessPerson(env, streams, gate);
  await askChallenge(streams, { prompt: gate.prompt, color: gate.color });
}

/**
 * The first two steps of `requirePerson` — an agent is refused, then anything without a terminal — for a command
 * whose code is not its own to make up.
 *
 * `agentcomms approve` asks for a code the approval store issued and will check, so it cannot use `askChallenge`;
 * but it refuses in exactly the same order and words, because it is the same gate.
 */
export function refuseUnlessPerson(env: NodeJS.ProcessEnv, streams: Streams, gate: Omit<PersonGate, 'prompt'>): void {
  const marker = agentMarker(env);
  if (marker) {
    throw new CommsError('LOOSENING_REFUSED', gate.refusedToAgent, {
      hint: `Ask the user to run \`${gate.command}\` in their own terminal.`,
      details: { marker },
    });
  }
  const prompting: { json?: boolean; noInput?: boolean } = {};
  if (gate.json !== undefined) prompting.json = gate.json;
  if (gate.noInput !== undefined) prompting.noInput = gate.noInput;
  if (!canPrompt(env, streams, prompting)) {
    throw new CommsError('LOOSENING_REFUSED', gate.refusedWithoutTerminal, {
      hint: `Run \`${gate.command}\` directly in a terminal.`,
    });
  }
}
