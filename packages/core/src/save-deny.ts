import { realpath } from 'node:fs/promises';
import path from 'node:path';
import { CommsError } from './errors.ts';
import { homeOf, type ResolvedPaths } from './paths.ts';

/**
 * Where a download may never be written, whoever answers the question — a person in the chat, a person at a terminal,
 * or an agent relaying either.
 *
 * A download saves a stranger's file under the name the stranger gave it. Into the right folder that name is a piece
 * of configuration: `authorized_keys` in `~/.ssh` lets someone log in, a `.plist` in `~/Library/LaunchAgents` runs at
 * the next login, an `ap_….json` in this package's own approvals folder is an approval nobody gave. The person asked
 * for a file to read, not for any of that, and no answer — least of all one an agent passed on — should be able to
 * turn a download into it. So these folders are refused as the attach deny list (`defaultAttachDeny`) refuses them
 * as a source, and for the same reasons, whatever the question was answered with:
 *
 * - this package's own folders: its configuration, its state (approvals, the audit log, the download records), its
 *   data, and the file secret store;
 * - the home folder itself, whose top level is where programs look for their settings — a folder inside it is fine;
 * - any hidden folder anywhere below the home, at any depth: `~/.ssh`, `~/.config`, `~/.aws`, `~/.local`, a
 *   project's `.git` or `.github` — and a `.git` folder wherever it is;
 * - `~/Library`, where macOS and its apps keep what they load on their own;
 * - on Windows, the profile's `AppData` (`%APPDATA%`, `%LOCALAPPDATA%`), `%PROGRAMDATA%`, the Windows folder and
 *   Program Files, and the root of a drive; and a network share (`\\host\share`), a device path (`\\.\`, `\\?\`) or a
 *   path relative to a drive (`\folder`, `C:folder`), each of which is not the folder it looks like;
 * - the system's own folders: the root, `/etc`, `/usr`, `/bin`, `/sbin`, `/var`, `/System`, `/private/etc` and the
 *   like — the per-user temporary folders under `/var` excepted, since they are the person's own.
 *
 * Checked on the path as given and again after its links are followed, so a folder that is a link to `~/.ssh` is
 * `~/.ssh`; and case-blind on macOS and Windows, whose disks open `~/library` as `~/Library`.
 */

/** This package's own folders, which a download is never written into. */
export type OwnFolders = Pick<ResolvedPaths, 'configDir' | 'stateDir' | 'dataDir' | 'secretsDir'>;

export interface SaveDenyInput {
  paths: OwnFolders;
  env: NodeJS.ProcessEnv;
  platform?: NodeJS.Platform | undefined;
}

/** One place a download is never written, and why, in words the person reads. */
export interface DeniedFolder {
  folder: string;
  why: string;
  /** Only the folder itself, not what is inside it: the home, the root of the disk. */
  exact?: boolean;
  /** A system folder, which the per-user temporary folders inside `/var` are let out of. */
  system?: boolean;
}

function pathsFor(platform: NodeJS.Platform): path.PlatformPath {
  return platform === 'win32' ? path.win32 : path.posix;
}

/** Whether the disks of this platform open a name whatever its case: macOS's and Windows's do. */
function caseBlind(platform: NodeJS.Platform): boolean {
  return platform === 'darwin' || platform === 'win32';
}

/** An environment variable by name, whatever its case: Windows's are case-blind, an object passed in is not. */
function envValue(env: NodeJS.ProcessEnv, name: string): string | undefined {
  const wanted = name.toLowerCase();
  for (const [key, value] of Object.entries(env)) {
    if (key.toLowerCase() === wanted && value) return value;
  }
  return undefined;
}

/*
 * The system's own folders. `/var` is the one a person is ever asked to save into — macOS keeps each user's
 * temporary folder at `/var/folders/<xx>/<id>/T` — so that folder and `/var/tmp` are let out of it; nothing else in
 * `/var` is. The pattern is fixed, never read from `TMPDIR`: an environment an agent sets would otherwise decide what
 * is a system folder.
 */
const POSIX_SYSTEM = [
  '/etc',
  '/usr',
  '/bin',
  '/sbin',
  '/lib',
  '/lib32',
  '/lib64',
  '/libx32',
  '/boot',
  '/dev',
  '/proc',
  '/sys',
  '/run',
  '/var',
  '/opt',
  '/root',
  '/snap',
  '/System',
  '/Library',
  '/Applications',
  '/private/etc',
  '/private/var',
  '/cores',
];
const PER_USER_TEMPORARY = /^\/(?:private\/)?var\/(?:tmp|folders\/[^/]+\/[^/]+\/T)(?:\/|$)/;

/**
 * Every folder a download is refused, as data: this package's, the home's, the platform's. The hidden folders below
 * the home and a `.git` folder anywhere are rules rather than folders, and `refusedSaveFolder` applies them beside
 * this list.
 */
export function saveDenyList(input: SaveDenyInput): DeniedFolder[] {
  const platform = input.platform ?? process.platform;
  const paths = pathsFor(platform);
  const home = paths.resolve(homeOf(input.env, platform));
  const own = input.paths;
  const list: DeniedFolder[] = [
    {
      folder: paths.join(own.stateDir, 'downloads'),
      why: 'it is where agent-communications keeps its records of downloads',
    },
    {
      folder: own.stateDir,
      why: 'it is agent-communications’ own state folder, where its approvals and audit log are kept',
    },
    { folder: own.secretsDir, why: 'it is where agent-communications keeps credentials' },
    { folder: own.configDir, why: 'it is agent-communications’ own configuration folder' },
    { folder: own.dataDir, why: 'it is agent-communications’ own data folder' },
    {
      folder: home,
      exact: true,
      why: 'it is your home folder itself, whose top level is where programs look for their settings — choose a folder inside it',
    },
  ];
  if (platform === 'win32') {
    const drive = paths.parse(home).root || 'C:\\';
    const windows = envValue(input.env, 'SystemRoot') ?? envValue(input.env, 'windir') ?? paths.join(drive, 'Windows');
    list.push(
      {
        folder: paths.join(home, 'AppData'),
        why: 'it is inside your AppData folder, where Windows and its programs keep what they load on their own',
      },
      { folder: windows, why: 'it is the Windows folder', system: true },
    );
    for (const name of ['APPDATA', 'LOCALAPPDATA']) {
      const folder = envValue(input.env, name);
      if (folder) {
        list.push({ folder, why: `it is inside %${name}%, where programs keep what they load on their own` });
      }
    }
    const programData = envValue(input.env, 'ProgramData') ?? envValue(input.env, 'ALLUSERSPROFILE');
    list.push({
      folder: programData ?? paths.join(drive, 'ProgramData'),
      why: 'it is inside %PROGRAMDATA%, where programs keep what they load for every user',
      system: true,
    });
    const programs = ['ProgramFiles', 'ProgramFiles(x86)', 'ProgramW6432']
      .map((name) => envValue(input.env, name))
      .filter((folder): folder is string => folder !== undefined);
    for (const folder of [...programs, paths.join(drive, 'Program Files'), paths.join(drive, 'Program Files (x86)')]) {
      list.push({ folder, why: 'it is inside Program Files, where programs are installed', system: true });
    }
    return list;
  }
  list.push({
    folder: paths.join(home, 'Library'),
    why: 'it is inside ~/Library, where macOS and its apps keep what they load on their own',
  });
  list.push({ folder: '/', exact: true, system: true, why: 'it is the root of the disk' });
  for (const folder of POSIX_SYSTEM)
    list.push({ folder, system: true, why: `it is inside ${folder}, a system folder` });
  return list;
}

/**
 * What is wrong with a Windows path as it was written, before anything resolves it — or null.
 *
 * Each of these resolves to *something*, which is the trouble: `\\host\share` is another machine, `\\.\` and `\\?\`
 * reach devices and skip the checks Windows makes on a name, `\folder` is on whichever drive the process happens to be
 * on, and `C:folder` is relative to that drive's current folder. None is the folder a person reading it would expect.
 */
export function windowsPathProblem(text: string): string | null {
  if (/^[\\/]{2}[.?][\\/]/.test(text)) return 'it is a Windows device path (\\\\.\\ or \\\\?\\), not a folder';
  if (/^[\\/]{2}/.test(text)) return 'it is a network share (\\\\host\\share), not a folder on this computer';
  if (/^[\\/]/.test(text)) return 'it names no drive: \\folder is a different folder on each drive';
  if (/^[A-Za-z]:(?![\\/])/.test(text)) return 'it is relative to a drive’s current folder (C:folder)';
  return null;
}

/** `candidate` below `root`, on this platform's terms — case-blind where its disks are — or null when it is not. */
function below(paths: path.PlatformPath, blind: boolean, candidate: string, root: string): string | null {
  const fold = (value: string) => (blind ? value.toLowerCase() : value);
  const relative = paths.relative(fold(root), fold(candidate));
  const inside =
    relative === '' || (!relative.startsWith(`..${paths.sep}`) && relative !== '..' && !paths.isAbsolute(relative));
  return inside ? relative : null;
}

/** True when `candidate` is `root` or inside it. */
function within(paths: path.PlatformPath, blind: boolean, candidate: string, root: string): boolean {
  return below(paths, blind, candidate, root) !== null;
}

function same(paths: path.PlatformPath, blind: boolean, one: string, other: string): boolean {
  const fold = (value: string) => (blind ? value.toLowerCase() : value);
  return fold(paths.resolve(one)) === fold(paths.resolve(other));
}

/** The first rule a resolved folder breaks, against these forms of the list and of the home — or null. */
function breaks(
  folder: string,
  list: readonly DeniedFolder[],
  homes: readonly string[],
  platform: NodeJS.Platform,
): string | null {
  const paths = pathsFor(platform);
  const blind = caseBlind(platform);
  if (platform === 'win32') {
    if (/^\\\\/.test(folder))
      return windowsPathProblem(folder) ?? 'it is a network share, not a folder on this computer';
    // The root of any drive, not only the one the home is on: `D:\` is as much a disk's top level as `C:\`.
    if (paths.parse(folder).root === folder) return 'it is the root of a drive';
  }
  for (const entry of list) {
    const hit = entry.exact ? same(paths, blind, folder, entry.folder) : within(paths, blind, folder, entry.folder);
    if (!hit) continue;
    // Only a system folder lets the per-user temporary folders out, and only by a pattern no environment can move.
    if (entry.system && platform !== 'win32' && new RegExp(PER_USER_TEMPORARY.source, blind ? 'i' : '').test(folder)) {
      continue;
    }
    return entry.why;
  }
  for (const home of homes) {
    const relative = below(paths, blind, folder, home);
    if (relative === null) continue;
    const segments = relative.split(/[\\/]+/);
    const hidden = segments.findIndex((segment) => segment.startsWith('.'));
    if (hidden >= 0) {
      const shown = ['~', ...segments.slice(0, hidden + 1)].join(paths.sep);
      return `it is inside ${shown}, a hidden folder: hidden folders hold settings and keys that programs read on their own`;
    }
  }
  if (folder.split(/[\\/]+/).some((segment) => segment.toLowerCase() === '.git')) {
    return 'it is inside a .git folder, whose files git reads and runs on its own';
  }
  return null;
}

/**
 * Why a folder may never be saved into, judged on the path as written and resolved — or null. No file is looked at:
 * see {@link checkSaveFolder} for the check that also follows links.
 */
export function refusedSaveFolder(folder: string, input: SaveDenyInput): string | null {
  const platform = input.platform ?? process.platform;
  const paths = pathsFor(platform);
  if (platform === 'win32') {
    const form = windowsPathProblem(folder);
    if (form) return form;
  }
  const home = paths.resolve(homeOf(input.env, platform));
  return breaks(paths.resolve(folder), saveDenyList(input), [home], platform);
}

/** The real path of `target`, through whatever part of it exists; the rest kept as written. */
export async function realpathOfExisting(target: string): Promise<string> {
  let current = path.resolve(target);
  const tail: string[] = [];
  for (;;) {
    try {
      const real = await realpath(current);
      return tail.length ? path.join(real, ...tail.reverse()) : real;
    } catch (error) {
      const parent = path.dirname(current);
      const code = (error as NodeJS.ErrnoException).code;
      if ((code !== 'ENOENT' && code !== 'ENOTDIR') || parent === current) return path.resolve(target);
      tail.push(path.basename(current));
      current = parent;
    }
  }
}

/**
 * Why a folder may never be saved into, after its links are followed — or null.
 *
 * The path as written, and its real path through whatever part of it exists, each against the list as written and as
 * its own links resolve: a folder that is a link to `~/.ssh` is refused as `~/.ssh` is, and so is a home or a state
 * folder reached through a link (`/var` → `/private/var` on macOS). Links are followed only on the platform this runs
 * on; a path for another is judged as written.
 */
export async function saveFolderRefusal(folder: string, input: SaveDenyInput): Promise<string | null> {
  const platform = input.platform ?? process.platform;
  const lexical = refusedSaveFolder(folder, input);
  if (lexical !== null || platform !== process.platform) return lexical;
  const paths = pathsFor(platform);
  const list = saveDenyList(input);
  const real = await Promise.all(
    list.map(async (entry) => ({ ...entry, folder: await realpathOfExisting(entry.folder) })),
  );
  const home = paths.resolve(homeOf(input.env, platform));
  const homes = [home, await realpathOfExisting(home)];
  const candidates = [paths.resolve(folder), await realpathOfExisting(folder)];
  for (const candidate of candidates) {
    const why = breaks(candidate, [...list, ...real], homes, platform);
    if (why !== null) return why;
  }
  return null;
}

/**
 * Refuses a folder a download may never be saved into, as `BAD_DATA` naming the folder and why. `hint` says what
 * became of the question: still open when this runs before it is claimed, spent when it runs after.
 */
export async function checkSaveFolder(
  folder: string,
  input: SaveDenyInput,
  hint = 'Nothing was saved, and the question is still open: ask the person for another folder.',
): Promise<void> {
  const why = await saveFolderRefusal(folder, input);
  if (why !== null) throw refusedFolder(folder, why, hint);
}

export function refusedFolder(folder: string, why: string, hint: string): CommsError {
  return new CommsError('BAD_DATA', `cannot save into ${folder}: ${why}`, {
    hint: `${hint} A download is never saved into a hidden folder, ~/Library, a system folder or agent-communications’ own.`,
    details: { folder, refused: why },
  });
}
