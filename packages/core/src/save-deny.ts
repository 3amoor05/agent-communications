import { readFileSync, readlinkSync } from 'node:fs';
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
 * refused, whatever the question was answered with. They are the folders every machine of their kind has, or that a
 * file in them makes plain; a folder a program was told to load whole — a zsh completions folder, an application's
 * plugin or startup folder — is one no rule here can know, and saving into it stays the person's choice:
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
 * - on Linux, the same Windows folders reached through WSL's `/mnt/<letter>`: the drive itself, `Windows`,
 *   `Program Files`, `ProgramData`, a profile's `AppData` and PowerShell profile folders, in any case;
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
  /**
   * This Linux's mounts, for finding Windows's drives under WSL wherever and however they are mounted. Read from the
   * kernel's mount table when left out, never from the environment: see {@link parseMounts}.
   */
  mounts?: (() => readonly Mount[]) | undefined;
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

/*
 * Windows's own folders, as a Linux under WSL reaches them. A process there is a Linux one, so none of the Windows
 * rules above applies to it, and it writes into `%USERPROFILE%\AppData` as readily as into its own home — where Excel
 * opens what is in `XLSTART` at every start, and Windows runs what is in `Startup` at every sign-in.
 *
 * Which Windows folder a Linux path is comes from the kernel's mount table, never from the environment, which an agent
 * can set: the mount that holds the path, whatever its type, and — when that is one of Windows's drives — the Windows
 * folder it shows (see {@link parseMounts}). So a drive is found wherever `wsl.conf` puts it, a bind of
 * `/mnt/c/Profiles/sam` at `/win/profile` is still `C:\Profiles\sam`, and a Linux disk mounted inside `/mnt/c` is
 * Linux's.
 *
 * The folders are then refused by name at any depth, not only where Windows usually puts them, since a profile, a
 * program or a redirected Documents can sit anywhere: a folder of the person's named `Windows` or `AppData` on a
 * Windows drive is refused with them, and the reason says why. Names are compared in any case, as the drive does.
 */
const WINDOWS_FOLDER_NAMES = new Map([
  ['windows', 'it is inside a folder named Windows — the Windows folder, or one this cannot tell from it'],
  ['programdata', 'it is inside ProgramData, where programs keep what they load for every user'],
  ['appdata', 'it is inside an AppData folder, where Windows and its programs keep what they load on their own'],
]);
const PROGRAM_FILES = /^program files(?: \((?:x86|arm)\))?$/;
const POWERSHELL_FOLDERS = new Map([
  ['powershell', 'PowerShell'],
  ['windowspowershell', 'WindowsPowerShell'],
]);

/*
 * A folder named by its Windows short name — `PROGRA~1` for `Program Files`, `APPDAT~1` for `AppData`. NTFS answers to
 * both names, and neither Linux under WSL nor a check on the path as written turns the short one back into the long
 * one, so `/mnt/c/PROGRA~1/App` would be let through as a folder of the person's. Every segment of that shape is
 * refused on a Windows drive: a real folder named like `Photos~2` is refused with it, and the reason says why.
 */
const SHORT_NAME = /^(?=[^.]{3,8}(?:\.|$))[^\\/~.\s]{1,6}~\d{1,6}(?:\.[^.\\/\s]{1,3})?$/;

/** Why a segment of a path on a Windows drive is a short name that could stand for a refused folder — or null. */
function shortNameIn(segments: readonly string[]): string | null {
  const short = segments.find((segment) => SHORT_NAME.test(segment));
  return short === undefined
    ? null
    : `it names a folder by its Windows short name (${short}), which can stand for a folder that is refused`;
}

/** A mount on this Linux, and the Windows folder it shows when it is one of Windows's drives. */
export interface Mount {
  /** The kernel's id for it, and the id of the mount it sits on. */
  id: string;
  parent: string;
  /** Where it is mounted, as this Linux sees it. */
  point: string;
  /**
   * The Windows folder at its mount point — `C:\`, `D:\Projects\acme` — or `''` when it is Windows's but which folder
   * cannot be read, or null when it is not Windows's.
   */
  windows: string | null;
}

/** A path as the kernel writes it in the mount table, with a space, a tab or a backslash as an octal escape. */
function unescapeMountPath(text: string): string {
  return text.replace(/\\([0-7]{3})/g, (_, octal: string) => String.fromCharCode(Number.parseInt(octal, 8)));
}

const VIRTIOFS_LINKS = '/run/wsl/virtiofs';
const GUID = /^\{?[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\}?$/i;

/** Where WSL links a `virtiofs` tag to the Windows folder it shares — or null when it keeps no such link. */
function virtiofsLink(tag: string): string | null {
  try {
    return readlinkSync(`${VIRTIOFS_LINKS}/${tag}`);
  } catch {
    return null;
  }
}

/** A Windows folder with a Linux mount's root added to it: `D:\` and `/Projects/acme` are `D:\Projects\acme`. */
function windowsBelow(folder: string, root: string): string {
  const below = root.split('/').filter((segment) => segment !== '');
  return below.length === 0 ? folder : `${folder.replace(/[\\/]+$/, '')}\\${below.join('\\')}`;
}

/*
 * `path=` as 9p writes it: as it was given, so a space, a comma or a semicolon in the folder is left in it.
 *
 * WSL builds the aname as `drvfs;path=<folder>`, then its own options — `;metadata`, `;uid=1000`, `;case=off` — and
 * always, last, `;symlinkroot=<automount root>`, whose value is `wsl.conf`'s and can hold anything but a semicolon; 9p's
 * own options (`,cache=mmap`, `,trans=fd`) follow. So the folder ends at the first semicolon from which what is left
 * reads as options ending in that `;symlinkroot=`. No other option's value has a backslash, so what that leaves off is
 * at most the end of the last folder's name — and no name refused here has a comma or a semicolon in it. A folder whose
 * own name reads like options, `;symlinkroot=` included, could end at more than one such place: where a backslash lies
 * between them, which one is the folder cannot be told, and it is not read.
 *
 * An aname WSL did not build, with no `;symlinkroot=`, is read only when it is plain: the folder has no comma or
 * semicolon, and what follows it reads as options. Anything else is a Windows folder that cannot be read (`''`), and
 * everything under the mount is refused rather than guessed at.
 */
const WSL_ANAME_TAIL = /^(?:;[\w.-]+(?:=[^;\\]*)?)*;symlinkroot=/;
const REST_OF_OPTIONS = /^(?:;[\w.-]+(?:=[^;,\\]*)?)*(?:,[\w.-]+(?:=[^,\\]*)?)*$/;

/** The folder in a 9p mount's `path=` option — `''` when it cannot be read, undefined when there is none. */
function pathOption(options: string): string | undefined {
  const start = /(?:^|[,;])path=/.exec(options);
  if (start === null) return undefined;
  const rest = options.slice(start.index + start[0].length);
  if (rest.includes(';symlinkroot=')) {
    const ends: number[] = [];
    for (let end = 0; end < rest.length; end++) {
      if (rest[end] === ';' && WSL_ANAME_TAIL.test(rest.slice(end))) ends.push(end);
    }
    const [first] = ends;
    const last = ends.at(-1);
    if (first !== undefined && last !== undefined) {
      return rest.slice(first, last).includes('\\') ? '' : rest.slice(0, first);
    }
  }
  const end = rest.search(/[;,]/);
  if (end < 0) return rest;
  return REST_OF_OPTIONS.test(rest.slice(end)) ? rest.slice(0, end) : '';
}

/*
 * The Windows folder a mount shows, read the way WSL itself writes it:
 * - `drvfs` (WSL 1), and `9p` with `aname=drvfs` (WSL 2): the source is the Windows folder — `C:\`, or the folder a
 *   drive was mounted from — or, over virtio-9p, only `drvfs` or `drvfsa`, and then `path=` in the options names it;
 * - `virtiofs` (newer WSL 2): the source is a tag, or a shared tag with the folder's own as the first part of the root,
 *   and WSL links each to its Windows folder in `/run/wsl/virtiofs`. A share with no link there is not Windows's — a
 *   virtual machine's shared folder, say — and is left alone.
 * The root is the part of that folder the mount shows, as a bind of a subfolder has, and is added to it.
 */
function windowsFolder(
  fstype: string,
  source: string,
  root: string,
  options: string,
  link: (tag: string) => string | null,
): string | null {
  if (fstype === 'drvfs') return windowsBelow(source, root);
  if (fstype === '9p' || fstype === 'v9fs') {
    if (!/(?:^|[,;])aname=drvfs(?:[,;]|$)/.test(options)) return null;
    const named = /^(?:[A-Za-z]:|\\\\|unc\\)/i.test(source) ? source : pathOption(options);
    return named === '' ? '' : windowsBelow(named ?? source, root);
  }
  if (fstype !== 'virtiofs') return null;
  const [first = '', ...rest] = root.split('/').filter((segment) => segment !== '');
  const shared = GUID.test(source) ? link(source) : null;
  if (shared !== null) return windowsBelow(shared, root);
  const own = GUID.test(first) ? link(first) : null;
  return own === null ? null : windowsBelow(own, rest.join('/'));
}

/*
 * Every mount in a `/proc/<pid>/mountinfo` text. Before ` - ` the kernel escapes a space in a path, so those fields
 * split on spaces: the mount's id, its parent's, the device, the root and the mount point. After it come the type and
 * the source, escaped the same way, and then the options — which 9p writes as they were given, spaces and all, so
 * everything after the source is the options.
 */
export function parseMounts(mountinfo: string, link: (tag: string) => string | null = virtiofsLink): Mount[] {
  const mounts: Mount[] = [];
  for (const line of mountinfo.split('\n')) {
    const split = line.indexOf(' - ');
    if (split < 0) continue;
    const [id, parent, , root, point] = line.slice(0, split).split(' ');
    const [, fstype = '', source = '', options = ''] = /^(\S*) (\S*)(?: (.*))?$/.exec(line.slice(split + 3)) ?? [];
    if (id === undefined || parent === undefined || root === undefined || point === undefined) continue;
    mounts.push({
      id,
      parent,
      point: unescapeMountPath(point),
      windows: windowsFolder(fstype, unescapeMountPath(source), unescapeMountPath(root), options, link),
    });
  }
  return mounts;
}

/** This process's mounts, from the kernel — none where there is no `/proc`. */
export function mountTable(): Mount[] {
  try {
    return parseMounts(readFileSync('/proc/self/mountinfo', 'utf8'));
  } catch {
    return [];
  }
}

/** The mounts the WSL rules read: only on Linux — or what a test says. */
function mountsFor(input: SaveDenyInput, platform: NodeJS.Platform): readonly Mount[] {
  if (platform !== 'linux') return [];
  if (input.mounts) return input.mounts();
  return process.platform === 'linux' ? mountTable() : [];
}

/** A mount point without a trailing slash, so that `/` stays `/`. */
function trimmed(point: string): string {
  return point === '/' ? '/' : point.replace(/\/+$/, '');
}

/** Whether a mount point holds a folder: is it, or is one of its parents — `/mnt/c` holds `/mnt/c/x`, not `/mnt/cx`. */
function holds(point: string, folder: string): boolean {
  return point === '/' || folder === point || folder.startsWith(`${point}/`);
}

/*
 * The mount a folder is on, found the way the kernel finds it: from the root mount, down into the first mount met on
 * the way to the folder — of those sitting on the current one, the one with the shortest mount point — until none
 * holds it. A mount stacked on another at the same place sits on it, so the top of a stack is the one reached; and a
 * mount the kernel still lists but a later one covers — a disk at `/win/sub` before a drive was mounted at `/win` — is
 * never reached, here as there.
 */
function owningMount(folder: string, mounts: readonly Mount[]): Mount | undefined {
  const ids = new Set(mounts.map((mount) => mount.id));
  const roots = mounts.filter(
    (mount) => trimmed(mount.point) === '/' && (mount.parent === mount.id || !ids.has(mount.parent)),
  );
  let owner = roots.at(-1) ?? mounts.find((mount) => trimmed(mount.point) === '/');
  const passed = new Set<Mount>();
  while (owner !== undefined && !passed.has(owner)) {
    passed.add(owner);
    let next: Mount | undefined;
    for (const mount of mounts) {
      if (mount === owner || mount.parent !== owner.id || !holds(trimmed(mount.point), folder)) continue;
      if (next === undefined || trimmed(mount.point).length <= trimmed(next.point).length) next = mount;
    }
    if (next === undefined) break;
    owner = next;
  }
  return owner;
}

/** Why a Linux path is one of Windows's own folders, on a Windows drive WSL mounted — or null. */
function windowsThroughWsl(folder: string, mounts: readonly Mount[]): string | null {
  const mount = owningMount(folder, mounts);
  if (mount === undefined || mount.windows === null) return null;
  const through = `reached through ${trimmed(mount.point)}`;
  if (mount.windows === '') return `it is on a Windows drive whose folder its mount does not say plainly, ${through}`;
  const drive = /^([A-Za-z]):(?:[\\/]|$)/.exec(mount.windows);
  if (drive === null) return `it is on a network share or a Windows device with no drive letter, ${through}`;
  const below = folder.slice(trimmed(mount.point).length);
  const segments = [...mount.windows.slice(2).split(/[\\/]/), ...below.split('/')].filter((segment) => segment !== '');
  if (segments.length === 0) return `it is the root of a Windows drive (${drive[1]?.toUpperCase()}:), ${through}`;
  const short = shortNameIn(segments);
  if (short !== null) return `${short}, ${through}`;
  const lower = segments.map((segment) => segment.toLowerCase());
  for (const [index, name] of lower.entries()) {
    const known = WINDOWS_FOLDER_NAMES.get(name);
    if (known !== undefined) return `${known}, ${through}`;
    if (PROGRAM_FILES.test(name)) return `it is inside Program Files, where programs are installed, ${through}`;
    const shell = name === 'documents' ? POWERSHELL_FOLDERS.get(lower[index + 1] ?? '') : undefined;
    if (shell !== undefined) {
      return `it is inside Documents\\${shell}, whose profile scripts PowerShell runs at every start, ${through}`;
    }
  }
  return null;
}

/**
 * Every folder a download is refused, as data: this package's, the home's, the platform's. The hidden folders, the
 * package folders, the Python environments and installations, and Windows's folders seen from WSL are rules rather
 * than folders, and `refusedSaveFolder` and `saveFolderRefusal` apply them beside this list.
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
    const programs = ['ProgramFiles', 'ProgramFiles(x86)', 'ProgramFiles(Arm)', 'ProgramW6432']
      .map((name) => envValue(input.env, name))
      .filter((folder): folder is string => folder !== undefined);
    const standard = ['Program Files', 'Program Files (x86)', 'Program Files (Arm)'].map((name) =>
      paths.join(drive, name),
    );
    for (const folder of [...programs, ...standard]) {
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
  mounts: readonly Mount[],
): string | null {
  const paths = pathsFor(platform);
  const blind = caseBlind(platform);
  if (platform === 'win32') {
    const short = shortNameIn(folder.split(/[\\/]/).slice(1));
    if (short !== null) return short;
    if (/^\\\\/.test(folder))
      return windowsPathProblem(folder) ?? 'it is a network share, not a folder on this computer';
    // The root of any drive, not only the one the home is on: `D:\` is as much a disk's top level as `C:\`.
    if (paths.parse(folder).root === folder) return 'it is the root of a drive';
  }
  if (platform === 'linux') {
    const windows = windowsThroughWsl(folder, mounts);
    if (windows !== null) return windows;
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
  return breaks(paths.resolve(folder), saveDenyList(input), [home], platform, mountsFor(input, platform));
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
    const why = breaks(candidate, [...list, ...real], homes, platform, mountsFor(input, platform));
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
    hint: `${hint} A download is never saved into a hidden folder, a package folder, a Python installation or virtual environment, ~/Library, a system folder — Windows’s too, seen from WSL — or agent-communications’ own.`,
    details: { folder, refused: why },
  });
}
