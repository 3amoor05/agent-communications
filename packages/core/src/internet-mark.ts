import { execFile } from 'node:child_process';
import { writeFile } from 'node:fs/promises';
import { childEnvironment } from './system-programs.ts';

/**
 * Every file a download saves is marked, as a browser marks what it downloads, as having come from the internet.
 *
 * The mark is what the system itself goes by. On macOS, Gatekeeper asks before a quarantined app or script runs for
 * the first time, and says where it came from; on Windows, SmartScreen asks before a program runs, and Office opens a
 * document in Protected View with its macros blocked. A stranger's file saved without it is one the system treats as
 * the person's own. The file's name already keeps it from being run by accident (`saved-files.ts`); the mark is for the
 * moment a person renames it, or opens it on purpose, and the system should still ask.
 *
 * - macOS: the `com.apple.quarantine` extended attribute, written by `/usr/bin/xattr` — by its full path, so that no
 *   folder the command was run in can stand in for it — with flags `0081` (downloaded, not yet approved), the time in
 *   hex, and this package as the agent that saved it.
 * - Windows: the `Zone.Identifier` alternate data stream, `ZoneId=3`, the Internet zone.
 * - Elsewhere there is no such mark to write, and none is claimed.
 *
 * Failing to mark a file is not failing to save it: the file is there, and the person asked for it. It is said in the
 * result instead, file by file, so that nobody takes an unmarked file for a marked one.
 */

/** Which mark a saved file carries: the macOS attribute, the Windows stream, or none. */
export type InternetMarkKind = 'com.apple.quarantine' | 'Zone.Identifier';

/** What marking a file came to: the mark written, or none and — when one should have been — why not. */
export interface InternetMark {
  mark: InternetMarkKind | null;
  /** Why no mark was written, on a system that has one. */
  failure?: string | undefined;
}

/** The ways a mark is written, each replaced by a test: a program run, and a stream written. */
export interface InternetMarkDeps {
  platform?: NodeJS.Platform | undefined;
  now?: (() => Date) | undefined;
  /** Runs a program by its full path with its arguments, as `execFile` does; rejects when it fails. */
  run?: ((command: string, args: readonly string[], env: NodeJS.ProcessEnv) => Promise<void>) | undefined;
  /** Writes a file's alternate data stream, as `writeFile` does with `<file>:<stream>`. */
  writeStream?: ((path: string, text: string) => Promise<void>) | undefined;
}

/** `xattr`, by its full path: every Mac has it there, and nothing in a folder a download was saved to can replace it. */
export const XATTR = '/usr/bin/xattr';

/** The Windows stream's text: the Internet zone, as a browser writes it for what it downloads. */
export const ZONE_IDENTIFIER = '[ZoneTransfer]\r\nZoneId=3\r\n';

/** The quarantine attribute's value: downloaded and not yet approved, when, and by whom. */
export function quarantineValue(at: Date): string {
  return `0081;${Math.floor(at.getTime() / 1000).toString(16)};agentcomms;`;
}

function runProgram(command: string, args: readonly string[], env: NodeJS.ProcessEnv): Promise<void> {
  return new Promise((resolve, reject) => {
    try {
      execFile(command, [...args], { env, timeout: 5000, windowsHide: true }, (error) =>
        error ? reject(error) : resolve(),
      );
    } catch (error) {
      // Thrown rather than passed to the callback: a program that could not be started at all.
      reject(error);
    }
  });
}

/** What went wrong, in a few words and never a path: a path here ends in the sender's name for the file. */
function reasonOf(error: unknown): string {
  const failure = error as { code?: unknown; signal?: unknown } | null;
  if (typeof failure?.code === 'number') return `it ended with status ${failure.code}`;
  if (typeof failure?.code === 'string') return `it failed (${failure.code})`;
  if (typeof failure?.signal === 'string') return `it was stopped (${failure.signal})`;
  return 'it failed';
}

/**
 * Marks a saved file as downloaded from the internet — see above — and says what became of it. Never throws: a file
 * that could not be marked is still saved, and the caller reports the failure.
 */
export async function markFromInternet(file: string, deps: InternetMarkDeps = {}): Promise<InternetMark> {
  const platform = deps.platform ?? process.platform;
  if (platform === 'darwin') {
    const at = (deps.now ?? (() => new Date()))();
    try {
      // `-s`: the file itself, never what a link put at its name would point to.
      await (deps.run ?? runProgram)(
        XATTR,
        ['-s', '-w', 'com.apple.quarantine', quarantineValue(at), file],
        childEnvironment(process.env, platform),
      );
      return { mark: 'com.apple.quarantine' };
    } catch (error) {
      return { mark: null, failure: `${XATTR} could not mark it as downloaded: ${reasonOf(error)}` };
    }
  }
  if (platform === 'win32') {
    try {
      await (deps.writeStream ?? ((path, text) => writeFile(path, text, { flag: 'w' })))(
        `${file}:Zone.Identifier`,
        ZONE_IDENTIFIER,
      );
      return { mark: 'Zone.Identifier' };
    } catch (error) {
      return { mark: null, failure: `its Zone.Identifier could not be written: ${reasonOf(error)}` };
    }
  }
  return { mark: null };
}
