import { resolve } from 'node:path';
import { createInterface } from 'node:readline/promises';
import { styleText } from 'node:util';
import { CommsError, EXIT_CODES, toCommsError } from './errors.ts';
import { challengeMatches, hashChallenge, newChallenge } from './ids.ts';
import { errorEnvelope, okEnvelope } from './output.ts';
import { PATH_OPTIONS, type PathOptionName, type PathOverrides } from './paths.ts';

/**
 * Output rules shared by every agent-communications CLI, so humans and agents get the same behaviour everywhere:
 * data on stdout, messages on stderr; `--json` prints the versioned envelope; colour only on a TTY and never with
 * NO_COLOR, TERM=dumb or --no-color; prompts only when stdin and stdout are both TTYs and nothing forbids them.
 */

export interface OutputOptions {
  json: boolean;
  color: boolean;
  /** The shell syntax used for commands returned alongside this output. */
  platform?: NodeJS.Platform | undefined;
}

export interface Streams {
  stdout: NodeJS.WritableStream & { isTTY?: boolean };
  stderr: NodeJS.WritableStream & { isTTY?: boolean };
  stdin?: NodeJS.ReadableStream & { isTTY?: boolean };
}

export const defaultStreams: Streams = { stdout: process.stdout, stderr: process.stderr, stdin: process.stdin };

/** Converts the shared parser's five global option values into independently applied core path pins. */
export function pathOverridesFromCliOptions(
  values: Partial<Record<PathOptionName, string | undefined>>,
): PathOverrides {
  const overrides: PathOverrides = {};
  for (const { key, option, flag } of PATH_OPTIONS) {
    const value = values[option];
    if (value === undefined) continue;
    if (value.length === 0) throw new CommsError('USAGE', `${flag} needs a non-empty directory`);
    overrides[key] = value;
  }
  return overrides;
}

/** Inserts generated option words immediately before the first end-of-options sentinel. */
export function insertWordsBeforeSentinel(words: readonly string[], ...inserted: readonly string[]): string[] {
  const sentinel = words.indexOf('--');
  const at = sentinel < 0 ? words.length : sentinel;
  return [...words.slice(0, at), ...inserted, ...words.slice(at)];
}

/**
 * Removes the named options only where the CLI parser can see them: before the first `--`. Both `--x value` and
 * `--x=value` are removed. The sentinel and every positional word after it are byte-for-byte data.
 */
export function withoutOptionsBeforeSentinel(words: readonly string[], flags: readonly string[]): string[] {
  const kept: string[] = [];
  for (let index = 0; index < words.length; index += 1) {
    const word = words[index] as string;
    if (word === '--') {
      kept.push(...words.slice(index));
      break;
    }
    const spaced = flags.find((flag) => word === flag);
    if (spaced !== undefined) {
      const value = words[index + 1];
      if (value === undefined || value === '--') {
        throw new CommsError('USAGE', `${spaced} needs a value before --`);
      }
      index += 1;
      continue;
    }
    if (flags.some((flag) => word.startsWith(`${flag}=`))) continue;
    kept.push(word);
  }
  return kept;
}

/**
 * Replaces every pre-sentinel suite path option with one canonical pin per supplied directory. `insertAt` counts
 * words after the old pins are removed: zero puts global options after the executable held elsewhere, one puts them
 * after an entry/package word. Downloads are included only when the caller supplies that pin.
 */
export function normalizePathOptionWords(words: readonly string[], pins: PathOverrides, insertAt: number): string[] {
  const stripped = withoutOptionsBeforeSentinel(
    words,
    PATH_OPTIONS.map(({ flag }) => flag),
  );
  const sentinel = stripped.indexOf('--');
  const optionsEnd = sentinel < 0 ? stripped.length : sentinel;
  if (!Number.isSafeInteger(insertAt) || insertAt < 0 || insertAt > optionsEnd) {
    throw new TypeError(`path-option insertion point ${insertAt} is outside the option words`);
  }
  const pathWords = PATH_OPTIONS.flatMap(({ key, flag }) => {
    const value = pins[key];
    if (value === undefined) return [];
    if (value.length === 0) throw new CommsError('USAGE', `${flag} needs a non-empty directory`);
    // `resolve` removes redundant separators and a non-root trailing separator while retaining filesystem roots.
    return [flag, resolve(value)];
  });
  return [...stripped.slice(0, insertAt), ...pathWords, ...stripped.slice(insertAt)];
}

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
 * A command for a person to copy and run, as `shellCommand` prints it — or, on Windows, cannot.
 *
 * Never a bare string, so that no printer can show a line where there must be none: `inlineCommand` and `commandText`
 * render it, as the line to paste, or as its words in JSON with what to do instead. The two branded commands — a
 * `PrintedCommand` from `locateCliCommand` and an `ExternalCommand` from `externalCommand` — have exactly these
 * fields, quoted by the same rules, so both render here too.
 */
export interface ShellCommand {
  /** The words, as the program is to receive them. */
  readonly words: readonly string[];
  /** The line to paste; null when one of `words` has no printing that every Windows shell passes on alike. */
  readonly line: string | null;
  readonly platform: NodeJS.Platform;
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
 * has to be safe in both, because nothing says which one it will be pasted into (CUE-306) — and safe is not enough:
 * the program has to receive the same words from either. Three readers stand between the line and the program. cmd.exe
 * hands the program the line as it is, and the program's own parser (the C runtime's, Node's) splits it. PowerShell
 * reads the line itself, a double-quoted word with its backslashes as plain characters, and then writes a new command
 * line for the program: Windows PowerShell 5.1 the old way ("Legacy" in about_Parsing, "Passing arguments to native
 * applications") — a word quoted only when it holds whitespace, as it is, and an empty word dropped — and PowerShell
 * 7.3 and later its own way ("Standard") — quoted when it must be, with every backslash before a quote doubled. For a
 * `.cmd` script, which is how npm installs `agentcomms`, `claude` and `codex` on Windows, PowerShell 7 goes back to the
 * old way, and cmd.exe then reads that new line. So on Windows:
 *
 * - A word of letters, digits and `_ + = : . / \`, with `@` and `-` anywhere but first, is left as it is: no reader
 *   does anything with it, and a backslash is an ordinary character to all of them, at the end too. A first `@` is
 *   splatting to PowerShell, and a `,` its array operator — two words — so a word with either is quoted. So is a word
 *   that starts with a digit, which PowerShell may read as a number (`1kb`, `0x10`), and one that starts with `-` but
 *   is not a plain option, which PowerShell may read as a parameter of its own and split (`-name.x`).
 * - A word that double quotes bring through all three readers whole goes in double quotes. Inside them cmd.exe reads
 *   `& | < > ^ ( )` and spaces as ordinary characters, and PowerShell reads everything as ordinary but `$`, the
 *   backtick and a double quote. What is left special in one or the other is kept out: a double quote, which ends the
 *   quoting in both — and PowerShell takes the curly ones, `“ ” „`, for one too; `$` and the backtick, PowerShell's
 *   expansion and escape; `%`, which cmd.exe expands as `%NAME%` before it looks at quotes at all; `!`, which it
 *   expands as `!NAME!` inside quotes too wherever delayed expansion is on, and which then makes a `^` inside quotes an
 *   escape; and any control or formatting character — a line break ends the command in cmd.exe even inside quotes, a
 *   tab pasted into cmd.exe can complete a file name, and a right-to-left override shows a line other than the one
 *   that runs. Three more cannot come through: an empty word, which Windows PowerShell drops; a word ending in a
 *   backslash, which the C runtime reads with the closing quote as `\"` — and doubled for it, PowerShell 7 passes both
 *   backslashes on where cmd.exe and Windows PowerShell pass one; and a word with `& | < > ^ ( )` but no whitespace,
 *   which PowerShell passes to a `.cmd` script unquoted, for cmd.exe to run `&whoami` from or to split at `|`.
 * - With any other word in it, no line is printed at all (`line` is null), and the printers show the command's words
 *   as JSON instead, saying it has to be typed. Not a line with the word left out: a placeholder in its place was
 *   still a command that ran — `claude mcp remove NAME` removed whatever entry was called `NAME`, and an install
 *   hint's `--force` replaced it — and before that, a word quoted for PowerShell's single quotes, which cmd.exe reads
 *   as characters, ran `whoami` from a server named `$x&whoami&`. See `commandAsJson` for why the JSON runs nothing.
 *
 * - The program itself has to be left as it is. Quoted, it is a string to PowerShell rather than a command — PowerShell
 *   runs a quoted program only after `&`, which cmd.exe reads as the end of a command — so a program whose path needs
 *   quotes, as `C:\Program Files\nodejs\node.exe` does, leaves the command with no line either (CUE-403).
 *
 * Everywhere else there is always a line: single quotes make any word safe.
 *
 * @deprecated As a way to make a command for a person (CUE-403). One of this suite's own commands comes from
 * `locateCliCommand`, which names this Node and a checked file of the product rather than a binary that may not be on
 * the person's PATH, and any other program's from `externalCommand`; both quote by the rules above. This stays only
 * while the remaining handoffs move to them, and goes when none is left.
 */
export function shellCommand(words: readonly string[], platform: NodeJS.Platform = process.platform): ShellCommand {
  if (platform !== 'win32') return { words, line: words.map(posixShellWord).join(' '), platform };
  const printed = words.map(windowsShellWord);
  const programBare = words.length === 0 || printed[0] === words[0];
  return { words, line: printed.includes(null) || !programBare ? null : printed.join(' '), platform };
}

/**
 * A printed command's line with words the agent is to fill in — a placeholder such as `<folder>`, printed as written,
 * never quoted as a word — before the command's first `--`, where the CLI still reads them as options. Null when the
 * command has no line.
 */
export function lineWithWordsToFill(command: ShellCommand, ...toFill: readonly string[]): string | null {
  if (command.line === null) return null;
  const sentinel = command.words.indexOf('--');
  if (sentinel < 0) return [command.line, ...toFill].join(' ');
  const word = command.platform === 'win32' ? windowsShellWord : posixShellWord;
  // The command has a line, so every word in it has a printed form.
  const printed = command.words.map((each) => word(each) as string);
  return [...printed.slice(0, sentinel), ...toFill, ...printed.slice(sentinel)].join(' ');
}

/** Whether a Windows command has no line because its program's path needs quotes, which PowerShell would not run. */
function programNeedsQuotes(command: ShellCommand): boolean {
  const [program] = command.words;
  return command.platform === 'win32' && program !== undefined && windowsShellWord(program) !== program;
}

/** The same command with generated options before positional data — the approval it is run again with. */
export function withWords(command: ShellCommand, ...more: readonly string[]): ShellCommand {
  return shellCommand(insertWordsBeforeSentinel(command.words, ...more), command.platform);
}

function posixShellWord(word: string): string {
  return /^[\w@%+=:,./-]+$/.test(word) ? word : `'${word.replace(/'/g, `'\\''`)}'`;
}

/**
 * The word as cmd.exe, Windows PowerShell and PowerShell 7 all hand it to a program, or null when no printing of it
 * does (see `shellCommand`). Bare: a plain option, or ordinary characters that do not start like a number.
 */
function windowsShellWord(word: string): string | null {
  if (/^(?:--?[A-Za-z][A-Za-z0-9-]*|(?!\+?\.?\d)[\w+=:./\\][\w@+=:./\\-]*)$/.test(word)) return word;
  if (word === '' || word.endsWith('\\')) return null;
  if (/["$`%!\u201C-\u201E]|[\p{C}\p{Zl}\p{Zp}]/u.test(word)) return null;
  if (/[&|<>^()]/.test(word) && !/\s/.test(word)) return null;
  return `"${word}"`;
}

/**
 * The words of a command as a JSON array, for a command that cannot be printed as a line: something to read, and to
 * parse, and nothing to run.
 *
 * Pasted into either Windows shell by mistake, it runs nothing. PowerShell refuses it before running anything: a `[`
 * opens a type name, and a quoted string is none. cmd.exe looks for a program called `["agentcomms"` or the like, and
 * finds none — and nothing in the line is anything else to it: every character it acts on, inside quotes or out (`%`,
 * `!`), is written as a `\u` escape, and so is every double quote inside a word, so the quotes cmd.exe sees are the
 * JSON's own, in pairs, and `&`, `|`, `<`, `>`, `^` and the parentheses are only ever inside them, where it reads them
 * as characters. `$` and the backtick are escaped too, so that PowerShell would expand nothing even if it read on, and
 * so is everything outside printable ASCII — a line break, a curly quote, a right-to-left override. A backslash is
 * doubled, as JSON has it.
 */
export function commandAsJson(words: readonly string[]): string {
  const word = (text: string) => {
    let json = '';
    for (let index = 0; index < text.length; index++) {
      const code = text.charCodeAt(index);
      const char = text[index] as string;
      if (char === '\\') json += '\\\\';
      else if (code >= 0x20 && code <= 0x7e && !'"%!$`'.includes(char)) json += char;
      else json += `\\u${code.toString(16).padStart(4, '0')}`;
    }
    return `"${json}"`;
  };
  return `[${words.map(word).join(',')}]`;
}

/** What is said beside a command shown as JSON. */
const TO_TYPE =
  "the command's words, written as JSON: one of them cannot be quoted the same way for cmd.exe and for PowerShell, so type the command yourself, with that word quoted for the shell you use";

/** What is said beside a command shown as JSON because its program's path needs quotes. */
const TO_TYPE_PROGRAM =
  "the command's words, written as JSON: the program's path needs quotes, and PowerShell runs a quoted program only after `&`, which cmd.exe does not accept, so type the command yourself, with each word quoted for the shell you use and, in PowerShell, `&` before the program";

function toType(command: ShellCommand): string {
  return programNeedsQuotes(command) ? TO_TYPE_PROGRAM : TO_TYPE;
}

/** A command in backticks, for a sentence — as its words in JSON, saying it has to be typed, when it has no line. */
export function inlineCommand(command: ShellCommand): string {
  return command.line === null ? `\`${commandAsJson(command.words)}\` (${toType(command)})` : `\`${command.line}\``;
}

/** A command as text of its own — a list's line, a field's value — or its words in JSON, saying it has to be typed. */
export function commandText(command: ShellCommand): string {
  return command.line === null ? `${commandAsJson(command.words)} (${toType(command)})` : command.line;
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
  /**
   * The command the person should run themselves, named in both refusals: a located command, or why there is none here
   * (anything with a `message`), or — before its package locates its commands — the bare text it always was.
   */
  command: string | ShellCommand | { readonly message: string };
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
      hint: gateSentence(gate.command, (command) => `Ask the user to run ${command} in their own terminal.`),
      details: { marker },
    });
  }
  const prompting: { json?: boolean; noInput?: boolean } = {};
  if (gate.json !== undefined) prompting.json = gate.json;
  if (gate.noInput !== undefined) prompting.noInput = gate.noInput;
  if (!canPrompt(env, streams, prompting)) {
    throw new CommsError('LOOSENING_REFUSED', gate.refusedWithoutTerminal, {
      hint: gateSentence(gate.command, (command) => `Run ${command} directly in a terminal.`),
    });
  }
}

/** A gate's command in a sentence: in backticks, or the sentence saying why there is none in its place. */
function gateSentence(command: PersonGate['command'], say: (command: string) => string): string {
  if (typeof command === 'string') return say(`\`${command}\``);
  return 'message' in command ? command.message : say(inlineCommand(command));
}
