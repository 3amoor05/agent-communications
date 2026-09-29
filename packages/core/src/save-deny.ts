import { lstat, readdir, realpath } from 'node:fs/promises';
import path from 'node:path';
import { CommsError } from './errors.ts';
import { DOCUMENTS_KNOWN_FOLDER, knownFolder } from './known-folders.ts';
import { homeOf, type ResolvedPaths } from './paths.ts';

/**
 * Where a download may never be written, whoever answers the question — a person in the chat, a person at a terminal,
 * or an agent relaying either.
 *
 * A download saves a stranger's file under the name the stranger gave it, and a name alone can be made harmless: it
 * keeps its extension only when that is one nothing runs or loads (`saved-files.ts`), and anything else is saved with
 * `.download` after it. What a name cannot be made is harmless in every folder. Some folders are read, whole, by a
 * program that runs what it finds, whatever each file is called — a hooks folder, a package folder, a folder of
 * approvals — and some hold what the person's own tools trust. The person asked for a file to read, not for any of
 * that, and no answer — least of all one an agent passed on — should be able to turn a download into it. So these are
 * refused, whatever the question was answered with:
 *
 * - this package's own folders: its configuration, its state (approvals, the audit log, the download records), its
 *   data, and the file secret store;
 * - any hidden folder, anywhere, at any depth — `~/.ssh`, `~/.config`, a project's `.git`, `.github`, `.husky`,
 *   `.vscode` or `.claude`, `/srv/app/.github/workflows` — since a folder whose name starts with a dot is one kept for
 *   programs, not for a person's files. The one exception is a checkout under `.claude/worktrees/<name>`, which is a
 *   project like any other: a folder inside it is allowed, unless it is itself inside a hidden folder there;
 * - a folder programs load packages from, wherever it is: `node_modules`, `site-packages`, `dist-packages`,
 *   `__pycache__`, and any folder inside a Python virtual environment — one with `pyvenv.cfg` in it or above it — whose
 *   interpreter runs what is put in its package folders at every start;
 * - any folder inside a Python installation — one with `conda-meta`, `Lib/os.py` or `lib/python3.<minor>/os.py` in it
 *   or above it, such as `~/miniconda3` or `C:\Python312` — whose interpreter loads what it finds in its own folders by
 *   name: `python312.zip` ahead of the standard library, a `._pth` that rewrites where it looks;
 * - `~/Library`, where macOS and its apps keep what they load on their own;
 * - on Windows, the profile's `AppData` (`%APPDATA%`, `%LOCALAPPDATA%`), `%PROGRAMDATA%`, the Windows folder and
 *   Program Files, the PowerShell profile folders (`Documents\PowerShell`, `Documents\WindowsPowerShell`, wherever
 *   Documents is), and the root of a drive; and a network share (`\\host\share`), a device path (`\\.\`, `\\?\`) or a
 *   path relative to a drive (`\folder`, `C:folder`), each of which is not the folder it looks like;
 * - the system's own folders: the root, `/etc`, `/usr`, `/bin`, `/sbin`, `/var`, `/System`, `/private/etc` and the
 *   like — except macOS's per-user temporary folder under `/var`, and a home that is inside one (`/root`, a service
 *   account's `/var/lib/<name>`), which is the person's own.
 *
 * The home folder itself is allowed: a folder of the person's own, whose hidden folders stay refused.
 *
 * Checked on the path as given and again after its links are followed, so a folder that is a link to `~/.ssh`, or a
 * `hooks` link to `.husky`, is refused as what it points to; and case-blind on macOS and Windows, whose disks open
 * `~/library` as `~/Library`.
 */

/** This package's own folders, which a download is never written into. */
export type OwnFolders = Pick<ResolvedPaths, 'configDir' | 'stateDir' | 'dataDir' | 'secretsDir'>;

export interface SaveDenyInput {
  paths: OwnFolders;
  env: NodeJS.ProcessEnv;
  platform?: NodeJS.Platform | undefined;
  /**
   * Where Windows says the person's Documents folder is, for the PowerShell profile folders inside it. Read from the
   * registry when left out — on Windows, and only for the profile of the user running this (`known-folders.ts`).
   */
  knownDocuments?: (() => string | undefined) | undefined;
}

/** One place a download is never written, and why, in words the person reads. */
export interface DeniedFolder {
  folder: string;
  why: string;
  /** Only the folder itself, not what is inside it: the root of the disk. */
  exact?: boolean;
  /** A system folder, which the per-user temporary folders and a home inside it are let out of. */
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
 * temporary folder at `/var/folders/<xx>/<id>/T` — so that folder is let out of it; nothing else in `/var` is, but a
 * home inside it. The pattern is fixed, never read from `TMPDIR`: an environment an agent sets would otherwise decide
 * what is a system folder.
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
const PER_USER_TEMPORARY = /^\/(?:private\/)?var\/folders\/[^/]+\/[^/]+\/T(?:\/|$)/;

/*
 * The system folders a home may be inside and still be the person's: `/root` is root's, `/var/root` is root's on
 * macOS, and a service account's home is often `/var/lib/<name>` or `/opt/<name>`. A home anywhere else among the
 * system folders — `/usr`, `/etc`, `/` — is not taken as a reason to let a download into it.
 */
const HOMES_MAY_BE_IN = ['/root', '/var', '/opt', '/private/var'];

/** Folder names programs load packages from, wherever they are: whatever is put in them is loaded by name. */
const PACKAGE_FOLDERS = new Set(['node_modules', 'site-packages', 'dist-packages', '__pycache__']);

/**
 * Every folder a download is refused, as data: this package's, the home's, the platform's. The hidden folders, the
 * package folders, and the Python environments and installations are rules rather than folders, and
 * `refusedSaveFolder` and `saveFolderRefusal` apply them beside this list.
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
    // PowerShell runs `profile.ps1` from these at every start. Documents is where Windows says, and the profile's too.
    const known = (input.knownDocuments ?? (() => knownFolder(input.env, DOCUMENTS_KNOWN_FOLDER)))();
    const documents = [
      paths.join(home, 'Documents'),
      ...(known !== undefined && /^[A-Za-z]:[\\/]/.test(known) ? [known] : []),
    ];
    for (const folder of documents) {
      for (const shell of ['PowerShell', 'WindowsPowerShell']) {
        list.push({
          folder: paths.join(folder, shell),
          why: `it is inside Documents\\${shell}, whose profile scripts PowerShell runs at every start`,
        });
      }
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

/**
 * Whether `folder` is inside a home that is itself inside a system folder and still the person's: see
 * {@link HOMES_MAY_BE_IN}. Only on the Unixes: a Windows home under the Windows folder is a service's, not a person's.
 */
function inOwnHome(folder: string, homes: readonly string[], platform: NodeJS.Platform): boolean {
  if (platform === 'win32') return false;
  const blind = caseBlind(platform);
  return homes.some(
    (home) =>
      home !== '/' &&
      HOMES_MAY_BE_IN.some(
        (root) => within(path.posix, blind, home, root) && !(root !== '/root' && same(path.posix, blind, home, root)),
      ) &&
      within(path.posix, blind, folder, home),
  );
}

/**
 * The first hidden segment of a path — one whose name starts with a dot — by its index, or -1.
 *
 * `.claude/worktrees/<name>` is passed over: a checkout the owner's agents work in, and a project like any other. What
 * is inside it is judged as any folder is, so its own `.git`, `.husky` or `.claude` is still hidden.
 */
function hiddenSegment(segments: readonly string[], blind: boolean): number {
  const fold = (value: string) => (blind ? value.toLowerCase() : value);
  for (let index = 0; index < segments.length; index += 1) {
    const segment = segments[index] as string;
    if (!segment.startsWith('.')) continue;
    const name = segments[index + 2];
    if (
      fold(segment) === '.claude' &&
      fold(segments[index + 1] ?? '') === 'worktrees' &&
      name !== undefined &&
      name !== '' &&
      !name.startsWith('.')
    ) {
      index += 2;
      continue;
    }
    return index;
  }
  return -1;
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
    if (entry.system && platform !== 'win32') {
      // Let out by a pattern no environment can move, or by being inside a home that is the person's.
      if (new RegExp(PER_USER_TEMPORARY.source, blind ? 'i' : '').test(folder)) continue;
      if (inOwnHome(folder, homes, platform)) continue;
    }
    return entry.why;
  }
  const segments = folder.split(/[\\/]+/);
  const hidden = hiddenSegment(segments, blind);
  if (hidden >= 0) {
    const shown = segments.slice(0, hidden + 1).join(paths.sep);
    // Below a home it is said from `~`, in the case it was written in: `~/.ssh`, not the whole path.
    const home = homes.find((candidate) => below(paths, blind, shown, candidate) !== null);
    const relative = home === undefined ? null : paths.relative(home, shown);
    const where =
      relative === null || relative === '' || relative.startsWith('..') || paths.isAbsolute(relative)
        ? shown
        : paths.join('~', relative);
    return `it is inside ${where}, a hidden folder: hidden folders hold settings, hooks and keys that programs read on their own`;
  }
  const loaded = segments.find((segment) => PACKAGE_FOLDERS.has(blind ? segment.toLowerCase() : segment));
  if (loaded !== undefined) {
    return `it is inside a ${loaded} folder, whose files programs load by name`;
  }
  return null;
}

/**
 * Why a folder may never be saved into, judged on the path as written and resolved — or null. No file is looked at:
 * see {@link saveFolderRefusal} for the check that also follows links and finds Python environments and installations.
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

/** Whether anything is at `file`, without following a link at its own name. */
async function present(file: string): Promise<boolean> {
  try {
    await lstat(file);
    return true;
  } catch {
    return false;
  }
}

/**
 * Whether `folder` is the top of a Python installation, known by what every one of them has, not by its name:
 * `conda-meta` in a conda installation or environment (`~/miniconda3`, `~/anaconda3/envs/tool`), `Lib/os.py` in one
 * for Windows (`C:\Python312`, a Scoop or an Anaconda one), and `lib/python3.<minor>/os.py` in any other.
 *
 * Its interpreter loads what it finds in its own folders by name, at every start, before anything the person asked
 * for: `lib/python312.zip` is on its import path ahead of the standard library, a `._pth` beside it rewrites that path,
 * and each module folder is searched for the modules every program imports. None of those folders is one a person
 * reads their files in.
 */
async function pythonInstallation(folder: string): Promise<boolean> {
  if ((await present(path.join(folder, 'conda-meta'))) || (await present(path.join(folder, 'Lib', 'os.py')))) {
    return true;
  }
  let names: string[];
  try {
    names = await readdir(path.join(folder, 'lib'));
  } catch {
    return false;
  }
  for (const name of names) {
    if (name.startsWith('python3.') && (await present(path.join(folder, 'lib', name, 'os.py')))) return true;
  }
  return false;
}

/** The Python a folder is inside, and which kind: the nearest folder at or above it that is one — see below. */
interface PythonOwner {
  folder: string;
  kind: 'virtual environment' | 'installation';
}

/**
 * The Python a folder is inside — a virtual environment, the nearest folder at or above it with a `pyvenv.cfg` in it,
 * or an installation ({@link pythonInstallation}) — or null. Whatever is saved in a virtual environment's
 * `site-packages` runs at every start of its interpreter, and a `bin` or `Scripts` folder in it is on the `PATH` of
 * whoever activates it; either can be called anything, so each is known by what every one of them has.
 *
 * Two folders are never taken for an installation, though they can look like one. The root of a disk: on a Linux whose
 * `/lib` is a link to `/usr/lib`, as every current one's is, `/lib/python3.12/os.py` is the system's Python, and taking
 * `/` for an installation would refuse every folder there is — while `/lib` and `/usr` are refused already, as system
 * folders. And the home, which the person may have installed a Python into (`--prefix=$HOME`): refusing it would
 * refuse the person's own folders, Downloads among them, and the files that Python loads by name — its `python312.zip`,
 * its modules, what is in `site-packages` — are each saved with `.download` after them, or refused, anyway.
 */
async function pythonOwner(folder: string, homes: readonly string[], blind: boolean): Promise<PythonOwner | null> {
  const home = (candidate: string) => homes.some((one) => same(path, blind, one, candidate));
  let current = path.resolve(folder);
  for (;;) {
    if (await present(path.join(current, 'pyvenv.cfg'))) return { folder: current, kind: 'virtual environment' };
    const parent = path.dirname(current);
    if (parent === current) return null;
    if (!home(current) && (await pythonInstallation(current))) return { folder: current, kind: 'installation' };
    current = parent;
  }
}

/**
 * Why a folder may never be saved into, after its links are followed — or null.
 *
 * The path as written, and its real path through whatever part of it exists, each against the list as written and as
 * its own links resolve: a folder that is a link to `~/.ssh` is refused as `~/.ssh` is, a `hooks` link to `.husky` as
 * `.husky` is, and so is a home or a state folder reached through a link (`/var` → `/private/var` on macOS). Then
 * each, and every folder above it, is looked in for what makes it a Python virtual environment or installation. Links
 * are followed, and folders looked in, only on the platform this runs on; a path for another is judged as written.
 */
export async function saveFolderRefusal(folder: string, input: SaveDenyInput): Promise<string | null> {
  const platform = input.platform ?? process.platform;
  if (platform !== process.platform) return refusedSaveFolder(folder, input);
  if (platform === 'win32') {
    const form = windowsPathProblem(folder);
    if (form) return form;
  }
  // Everything `refusedSaveFolder` judges is judged here too, with the real paths beside the written ones — so that a
  // reason is given in the words of the home however it was reached.
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
  for (const candidate of candidates) {
    const owner = await pythonOwner(candidate, homes, caseBlind(platform));
    if (owner?.kind === 'virtual environment') {
      return `it is inside ${owner.folder}, a Python virtual environment, whose interpreter runs what is put in its package folders at every start`;
    }
    if (owner?.kind === 'installation') {
      return `it is inside ${owner.folder}, a Python installation, whose interpreter loads what it finds in its own folders by name at every start`;
    }
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
    hint: `${hint} A download is never saved into a hidden folder, a package folder, a Python installation or virtual environment, ~/Library, a system folder or agent-communications’ own.`,
    details: { folder, refused: why },
  });
}
