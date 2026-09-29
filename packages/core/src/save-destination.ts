import { randomBytes } from 'node:crypto';
import { mkdir, realpath, stat } from 'node:fs/promises';
import path from 'node:path';
import type { DownloadBinding, DownloadRequest } from './approvals.ts';
import { agentMarker, canPrompt, defaultStreams, paint, type Streams } from './cli-runtime.ts';
import type { Core } from './core.ts';
import { CommsError } from './errors.ts';
import { APPROVAL_ID_PATTERN } from './ids.ts';
import { expandHome, homeOf } from './paths.ts';

/**
 * Where a download is saved: the person's to say, every time.
 *
 * A Gmail attachment or a Slack file is a stranger's file, and where it lands on this machine is not a thing a tool
 * should decide for the person — nor an agent, which is who calls the tool. So a download asks first. The first call
 * reads what the request names and saves nothing: it lists the files, by name and size, and offers three places — the
 * person's Downloads folder (or the one they set as `defaults.downloadsDir`), the folder the command or the server
 * was started in, or a folder they name — each of the first two by its exact path. The question is kept in the
 * approval store as a `download` record, so it expires, is claimed once, and is bound to the account, the request and
 * the files it listed. The second call carries the person's answer and the question's id, and only then is anything
 * written.
 *
 * At a terminal with a person at it the command asks there and then (`downloadAtTerminal`); a person's own script
 * answers by flag, `--to`, with nobody to ask; an agent gets the question and the id, as over MCP, and runs the
 * command again with the answer.
 *
 * Nothing here is an operation: the channels' `downloadAttachments` and `downloadFiles` are, and both surfaces reach
 * them. This is what they share of the asking.
 */

/** The three answers: the two folders the question shows by path, and one the person names. */
export type SaveChoice = 'downloads' | 'current' | 'other';

/** The two folders a question offers, as absolute paths. */
export interface SaveFolders {
  /** `<home>/Downloads`, or `defaults.downloadsDir` when the person set one. */
  downloads: string;
  /** The folder the process was started in: the client's for a server, the shell's for a command. */
  current: string;
}

/** An answer, checked for its form: a word, or a folder that is absolute or starts with `~`. */
export type SaveAnswer = { choice: 'downloads' } | { choice: 'current' } | { choice: 'other'; folder: string };

/** What a download is called with, beside its request: the person's answer, the question's id, or neither. */
export interface DownloadAnswer {
  /** `downloads`, `current`, or a folder: the person's answer to the question. */
  saveTo?: unknown;
  /** The id the question came with. */
  choiceId?: unknown;
  /**
   * The person decided by a flag at their own command line — `--to` without `--choice`, in a script or at a terminal,
   * with no agent marker set. Only the CLI says so; a tool call never does, so an agent over MCP cannot.
   */
  personChose?: boolean | undefined;
}

/** A download's answer, once its form is checked: none yet, one to a question, or one a person gave by flag. */
export type CheckedAnswer =
  | { readonly kind: 'none' }
  | { readonly kind: 'choice'; readonly answer: SaveAnswer; readonly choiceId: string }
  | { readonly kind: 'person'; readonly answer: SaveAnswer };

/** Which surface asked, so a refusal names the argument as that surface spells it. */
export type DownloadSurface = 'cli' | 'mcp';

function words(surface: DownloadSurface) {
  return surface === 'mcp'
    ? { saveTo: '`saveTo`', choiceId: '`choiceId`', out: '`out`' }
    : { saveTo: '`--to`', choiceId: '`--choice`', out: '`--out`' };
}

/** A value a caller gave, quoted and cut, for a refusal that has to say which one it was. */
function quoted(value: string): string {
  return JSON.stringify(value.length > 64 ? `${value.slice(0, 64)}…` : value);
}

/** The path functions of the platform the folders are for: the host's, unless a test names another. */
function pathsFor(platform: NodeJS.Platform): path.PlatformPath {
  return platform === 'win32' ? path.win32 : path.posix;
}

// ── The folders ────────────────────────────────────────────────────────────────────────────────────────────────

export interface SaveFoldersInput {
  /** `defaults.downloadsDir`, when the person set it. */
  configured?: string | undefined;
  env: NodeJS.ProcessEnv;
  /** The working directory of the process: a server's, a command's. */
  cwd: string;
  platform?: NodeJS.Platform | undefined;
}

/**
 * The two folders a question offers, by their absolute paths.
 *
 * Downloads is the person's own Downloads folder — `<home>/Downloads`, the home read from the environment as every
 * other path here is (`HOME`, `USERPROFILE` on Windows) — not a folder of this package's inside it: a file the person
 * asked for belongs where they look for downloads. A `defaults.downloadsDir` they set is that folder instead, since
 * setting it is how they said where their downloads go.
 */
export function saveFolders(input: SaveFoldersInput): SaveFolders {
  const platform = input.platform ?? process.platform;
  const paths = pathsFor(platform);
  const home = homeOf(input.env, platform);
  return {
    downloads: input.configured ? paths.resolve(expandHome(input.configured, home)) : paths.resolve(home, 'Downloads'),
    current: paths.resolve(input.cwd),
  };
}

// ── The answer ─────────────────────────────────────────────────────────────────────────────────────────────────

/**
 * The person's answer, held to its form: `downloads`, `current`, or a folder — absolute, or from `~`.
 *
 * A relative folder is refused rather than resolved. It would mean one folder where the server runs and another where
 * the command does, and neither need be the one the person meant; asking them costs a sentence. So is `~user/…`,
 * which names another account's home.
 */
export function parseSaveAnswer(
  value: unknown,
  surface: DownloadSurface,
  platform: NodeJS.Platform = process.platform,
): SaveAnswer {
  const { saveTo } = words(surface);
  const hint =
    'Pass `downloads`, `current`, or the folder the person named — absolute (/srv/invoices, D:\\Invoices) or starting with ~ (~/Invoices).';
  if (typeof value !== 'string' || value.trim() === '') {
    throw new CommsError('USAGE', `${saveTo} takes the person’s answer: downloads, current, or a folder`, { hint });
  }
  const text = value.trim();
  if (text === 'downloads' || text === 'current') return { choice: text };
  if (text.includes('\u0000')) throw new CommsError('USAGE', `${saveTo} is not a folder: it holds a NUL`, { hint });
  const fromHome = text === '~' || text.startsWith('~/') || text.startsWith('~\\');
  if (fromHome || pathsFor(platform).isAbsolute(text)) return { choice: 'other', folder: text };
  throw new CommsError(
    'USAGE',
    `${quoted(text)} is a relative path: a folder the person names is absolute, or starts with ~`,
    {
      hint: `A relative folder means a different place wherever this runs, so it is never guessed at. Ask the person which folder they meant. ${hint}`,
      details: { saveTo: text },
    },
  );
}

/**
 * The answer and the question's id, checked before anything is read: an answer needs the question it answers, and a
 * question's id needs its answer.
 *
 * An answer without an id is refused unless a person gave it by flag (`personChose`, which only the CLI sets): where a
 * stranger's files land is the person's to say, and an agent that picks a folder itself has not asked them. An id
 * without an answer is refused too — it would be spent on nothing.
 */
export function checkDownloadAnswer(
  given: DownloadAnswer,
  surface: DownloadSurface,
  platform: NodeJS.Platform = process.platform,
): CheckedAnswer {
  const { saveTo, choiceId } = words(surface);
  if (given.choiceId !== undefined) {
    if (typeof given.choiceId !== 'string' || !APPROVAL_ID_PATTERN.test(given.choiceId)) {
      throw new CommsError('USAGE', `${quoted(String(given.choiceId))} is not a choice id`, {
        hint: `Pass the ${choiceId} the download’s question came with: ap_ and 26 letters and digits.`,
      });
    }
    if (given.saveTo === undefined) {
      throw new CommsError('USAGE', `${choiceId} needs the person’s answer beside it`, {
        hint: `Pass ${saveTo} too: downloads, current, or the folder they named.`,
      });
    }
    return { kind: 'choice', answer: parseSaveAnswer(given.saveTo, surface, platform), choiceId: given.choiceId };
  }
  if (given.saveTo === undefined) return { kind: 'none' };
  if (given.personChose === true) return { kind: 'person', answer: parseSaveAnswer(given.saveTo, surface, platform) };
  throw new CommsError(
    'USAGE',
    `${saveTo} answers the download’s question, and needs its ${choiceId}: where the files go is the person’s to say, not an agent’s`,
    {
      hint:
        surface === 'mcp'
          ? 'Call without `saveTo` first: nothing is saved, and the answer carries a question and a `choiceId`. Show the person the question, then call again with their answer as `saveTo` and that `choiceId`.'
          : 'Run it without --to first: it saves nothing, and prints the question and a choice id (exit 10). Show the person the question, then run it again with --to <their answer> --choice <id>.',
    },
  );
}

/**
 * Refuses `out` / `--out`, which named a folder inside the old downloads root. The person chooses the folder now, so
 * it is refused with what replaced it rather than dropped, and nothing is read or saved.
 */
export function refuseRetiredOut(out: unknown, surface: DownloadSurface): void {
  if (out === undefined) return;
  throw new CommsError('USAGE', `${words(surface).out} is no longer taken: the person chooses where the files go`, {
    hint: retiredOutHint(surface),
  });
}

/** What replaced `out`, in the words of the surface that was given it: the hint `strictToolArguments` gives too. */
export function retiredOutHint(surface: DownloadSurface): string {
  return surface === 'mcp'
    ? 'Leave out `out`. The first call asks where to save — Downloads, the current folder, or a folder the person names — and saves nothing; call again with their answer as `saveTo` and the `choiceId` it came with.'
    : 'Leave out --out. At a terminal the command asks where to save; a script answers with --to downloads, --to current, or --to <folder>.';
}

// ── The folder the answer names ────────────────────────────────────────────────────────────────────────────────

/** The folder an answer names, as an absolute path: one of the two the question showed, or the person's own. */
export function folderFor(
  answer: SaveAnswer,
  folders: SaveFolders,
  env: NodeJS.ProcessEnv,
  platform: NodeJS.Platform = process.platform,
): string {
  if (answer.choice === 'downloads') return folders.downloads;
  if (answer.choice === 'current') return folders.current;
  return pathsFor(platform).resolve(expandHome(answer.folder, homeOf(env, platform)));
}

/**
 * Refuses a folder that is something else — a file, or a path through one — before the question is spent on it. A
 * folder that is not there yet is fine: it is made when the files are saved.
 */
export async function checkFolder(folder: string): Promise<void> {
  try {
    const info = await stat(folder);
    if (!info.isDirectory()) throw notAFolder(folder, 'it is a file');
  } catch (error) {
    if (error instanceof CommsError) throw error;
    const code = (error as NodeJS.ErrnoException).code;
    if (code === 'ENOENT') return;
    throw notAFolder(folder, code === 'ENOTDIR' ? 'part of the path is a file' : messageOf(error));
  }
}

/**
 * The folder to save into, made when it is missing — private, as every folder this package makes is — and resolved.
 *
 * Resolved through its links: the person named it, so a link in it goes where they meant. What is not followed is
 * anything at a file's own name inside it, which `createUniqueFile` refuses to open through. What comes back is the
 * real path, which is where each file is then created.
 */
export async function openFolder(folder: string): Promise<string> {
  try {
    await mkdir(folder, { recursive: true, mode: 0o700 });
    const real = await realpath(folder);
    if (!(await stat(real)).isDirectory()) throw notAFolder(folder, 'it is a file');
    return real;
  } catch (error) {
    if (error instanceof CommsError) throw error;
    const code = (error as NodeJS.ErrnoException).code;
    throw notAFolder(
      folder,
      code === 'EEXIST' ? 'it is a file' : code === 'ENOTDIR' ? 'part of the path is a file' : messageOf(error),
    );
  }
}

function notAFolder(folder: string, why: string): CommsError {
  return new CommsError('BAD_DATA', `cannot save into ${folder}: ${why}`, {
    hint: 'Nothing was saved. Ask the person for another folder.',
    details: { folder },
  });
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

// ── The question, and its answer ───────────────────────────────────────────────────────────────────────────────

/** One of the three places a question offers. The first two carry their path; the third is the person's to name. */
export interface SaveOption {
  choice: SaveChoice;
  path?: string;
  default?: boolean;
}

/** What a download answers with before anything is saved: the question to put to the person, and its id. */
export interface DestinationQuestion {
  /** Always true here: nothing was saved, and the person has to say where. */
  destinationRequired: true;
  /** Pass back as `choiceId` (`--choice`), beside the person's answer. */
  choiceId: string;
  /** The question, in words to show the person as they are. The files are listed beside it. */
  question: string;
  options: SaveOption[];
  expiresAt: string;
  /** What to do next, in words an agent can follow. */
  next: string;
}

export interface AskInput {
  /** The download the question is about, as it will be claimed. */
  request: DownloadRequest;
  folders: SaveFolders;
  /** Whether the Downloads option is a folder the person set, rather than their Downloads folder. */
  configured: boolean;
  /** How many files, and how many bytes they declare, for the question's first line. */
  count: number;
  bytes: number;
  surface: DownloadSurface;
  /** The tool to call again, over MCP. */
  tool: string;
}

/**
 * Asks where to save, and keeps the question: a `download` record in the approval store, bound to the request and the
 * files, that expires as an approval does and is claimed once. Nothing is written anywhere else.
 */
export async function askWhereToSave(core: Core, input: AskInput): Promise<DestinationQuestion> {
  const account = input.request.target.name;
  const files = `${input.count} ${input.count === 1 ? 'file' : 'files'}`;
  const binding: DownloadBinding = {
    ...input.request,
    summary: `where to save ${files} from ${account}`,
    folders: { ...input.folders },
  };
  const record = await core.approvals.createDownload({ download: binding });
  const choiceId = record.approvalId;
  const question = [
    `Where should the ${files} (${sizeOf(input.bytes)}) from ${account} be saved?`,
    `  1. ${input.configured ? 'Your downloads folder' : 'Downloads'} — ${input.folders.downloads} (the default)`,
    `  2. The current folder — ${input.folders.current}`,
    '  3. Another folder — one you name, absolute or starting with ~',
  ].join('\n');
  const next =
    input.surface === 'mcp'
      ? `Nothing has been saved. Show the person this question and the files — each name and size — and wait for their answer; never choose for them. Then call ${input.tool} again with the same arguments, choiceId "${choiceId}", and saveTo: "downloads", "current", or the folder they name (absolute, or starting with ~).`
      : `Nothing has been saved. Show the person this question and the files, and wait for their answer; never choose for them. Then run the same command again with --choice ${choiceId} and --to downloads, --to current, or --to <the folder they name>.`;
  return {
    destinationRequired: true,
    choiceId,
    question,
    options: [
      { choice: 'downloads', path: input.folders.downloads, default: true },
      { choice: 'current', path: input.folders.current },
      { choice: 'other' },
    ],
    expiresAt: record.expiresAt,
    next,
  };
}

/** A byte count as a person reads it. */
export function sizeOf(bytes: number): string {
  if (bytes < 1024) return `${bytes} ${bytes === 1 ? 'byte' : 'bytes'}`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** Where an answered download saves: the folder, made and resolved, and how it was chosen. */
export interface SaveDestination {
  /** The real path of the folder, where every file is created. */
  folder: string;
  choice: SaveChoice;
  /** The question the answer was to, or null when a person decided by flag. */
  choiceId: string | null;
}

export interface SettleInput {
  answer: Exclude<CheckedAnswer, { kind: 'none' }>;
  /** The download as it would be claimed now: the same account, request and files the question listed. */
  request: DownloadRequest;
  /** The two folders as they are now, for an answer given by flag, which no question offered. */
  folders: () => SaveFolders;
  env: NodeJS.ProcessEnv;
  platform?: NodeJS.Platform | undefined;
}

/**
 * The folder an answer saves into, the question claimed on the way.
 *
 * An answer to a question: the folder is checked first against the folders the question showed, so a file where a
 * folder should be is refused before the question is spent; then the question is claimed — once, and only for the
 * request and the files it listed — and the folder made. An answer a person gave by flag has no question to claim,
 * and names today's folders.
 */
export async function settleDestination(core: Core, input: SettleInput): Promise<SaveDestination> {
  const { answer, env } = input;
  const platform = input.platform ?? process.platform;
  if (answer.kind === 'person') {
    const folder = folderFor(answer.answer, input.folders(), env, platform);
    await checkFolder(folder);
    return { folder: await openFolder(folder), choice: answer.answer.choice, choiceId: null };
  }
  const asked = await core.approvals.get(answer.choiceId).catch(() => null);
  if (asked?.kind === 'download' && asked.download && asked.state === 'pending') {
    await checkFolder(folderFor(answer.answer, asked.download.folders, env, platform));
  }
  const claimed = await core.approvals.claimForDownload(answer.choiceId, input.request);
  const folder = folderFor(answer.answer, claimed.download.folders, env, platform);
  return { folder: await openFolder(folder), choice: answer.answer.choice, choiceId: answer.choiceId };
}

// ── At a terminal ──────────────────────────────────────────────────────────────────────────────────────────────

/**
 * Where a download's own record goes: this package's state directory, `downloads/<time>_<question id>.json` — never
 * the folder the person chose, where nothing is written but the files.
 */
export function downloadRecordPath(core: Core, at: Date, choiceId: string | null): string {
  const stamp = at.toISOString().replace(/[:.]/g, '-');
  return path.join(
    core.paths.stateDir,
    'downloads',
    `${stamp}_${choiceId ?? `by-flag-${randomBytes(6).toString('hex')}`}.json`,
  );
}

/** A question, told from a result by its one field that is always `true`. */
export function isDestinationQuestion(value: unknown): value is DestinationQuestion {
  return (
    typeof value === 'object' &&
    value !== null &&
    (value as { destinationRequired?: unknown }).destinationRequired === true
  );
}

export interface DownloadAtTerminalOptions<Q extends DestinationQuestion> {
  core: Core;
  /** The command's operation, with an answer or without: it asks without one, and saves with one. */
  download: (answer: DownloadAnswer) => Promise<unknown>;
  /** `--to`, as given. */
  to?: string | undefined;
  /** `--choice`, as given. */
  choice?: string | undefined;
  env: NodeJS.ProcessEnv;
  output: { json?: boolean | undefined; color: boolean };
  noInput?: boolean | undefined;
  /** The command to run again, for the hint an agent gets: `agent-gmail attachments download … --inbox acme/gmail`. */
  command: string;
  /** The question with its files, as a person reads it. */
  render: (question: Q) => string;
  streams?: Streams | undefined;
}

/**
 * A download at the command line.
 *
 * With `--to` it saves where that says: with `--choice`, as the answer to that question; without, as a person's own
 * decision — a script's, or theirs at the terminal — unless an agent runs the command, whose `--to` is refused by the
 * operation for want of a question. Without `--to` it asks: a person at a terminal is shown the files and the three
 * places and answers 1, 2 or 3 (3 asks for the folder), and the files are saved; an agent, or anything without a
 * terminal, gets the question and its choice id and exits 10, as a change waiting for a person does, and runs the
 * command again with `--to <answer> --choice <id>`.
 *
 * Returns what the operation saved, or what it answered without asking — a request with nothing in it to save.
 */
export async function downloadAtTerminal<Q extends DestinationQuestion>(
  options: DownloadAtTerminalOptions<Q>,
): Promise<unknown> {
  const streams = options.streams ?? defaultStreams;
  const { env } = options;
  if (options.to !== undefined || options.choice !== undefined) {
    return options.download({
      saveTo: options.to,
      choiceId: options.choice,
      personChose: options.choice === undefined && agentMarker(env) === null,
    });
  }
  const asked = await options.download({});
  if (!isDestinationQuestion(asked)) return asked;
  const question = asked as Q;
  const person =
    agentMarker(env) === null &&
    canPrompt(env, streams, { json: options.output.json === true, noInput: options.noInput === true });
  if (!person) {
    // The question is what the agent has to show the person, so it is printed, not only tucked into the envelope.
    if (options.output.json !== true) streams.stdout.write(`${options.render(question)}\n\n`);
    throw new CommsError('APPROVAL_PENDING', 'nothing was saved: where to save the files is the person’s to say', {
      hint: `Show the person the question and the files. Once they answer, run \`${options.command} --to <downloads|current|folder> --choice ${question.choiceId}\`.`,
      details: { ...(question as unknown as Record<string, unknown>) },
    });
  }
  streams.stdout.write(`${options.render(question)}\n\n`);
  const answer = await askSaveAnswer(streams, options.output.color);
  if (answer === null) {
    await options.core.approvals.revoke(question.choiceId, 'cancelled at the terminal');
    throw new CommsError('USAGE', 'cancelled: nothing was saved');
  }
  return options.download({ saveTo: answer, choiceId: question.choiceId });
}

/**
 * The person's answer at the terminal: `downloads` for 1 or Enter, `current` for 2, and for 3 the folder they type —
 * asked again, up to three times, while it is not one a download takes. Anything else cancels, and so does a folder
 * refused three times: null.
 */
async function askSaveAnswer(streams: Streams, color: boolean): Promise<string | null> {
  const bold = (text: string) => paint(color, 'bold', text);
  const choice = (
    await askLine(
      streams,
      `Save them to ${bold('1')}, ${bold('2')} or ${bold('3')}? (Enter for 1; anything else cancels) `,
    )
  ).trim();
  if (choice === '' || choice === '1') return 'downloads';
  if (choice === '2') return 'current';
  if (choice !== '3') return null;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    const folder = (await askLine(streams, 'Which folder? (absolute, or starting with ~) ')).trim();
    if (folder === '') return null;
    try {
      const parsed = parseSaveAnswer(folder, 'cli');
      // A word is an answer of its own; typed here it names a folder called that, which is relative.
      if (parsed.choice === 'other') return folder;
      streams.stderr.write(
        `That is option ${parsed.choice === 'downloads' ? '1' : '2'}; type a folder, or press Enter to cancel.\n`,
      );
    } catch (error) {
      streams.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    }
  }
  return null;
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
