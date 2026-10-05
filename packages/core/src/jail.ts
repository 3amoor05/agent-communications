import { constants } from 'node:fs';
import { type FileHandle, open, realpath, stat } from 'node:fs/promises';
import { basename, dirname, extname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { isDangerous } from './chars.ts';
import { CommsError } from './errors.ts';
import { asHandoffMaker, type HandoffMaker, handoffSentenceToFill } from './handoff-text.ts';
import { expandHome } from './paths.ts';

/*
 * The device names Windows opens instead of a file of that name: the old four, the numbered ports — the superscript
 * digits too, which Windows reads as `1`, `2` and `3` — and the two console handles. A file saved as `con.pdf` or
 * `COM¹.txt` is a write to a device there, not a file.
 */
const WINDOWS_RESERVED = /^(con|prn|aux|nul|conin\$|conout\$|com[0-9¹²³]|lpt[0-9¹²³])$/i;
// Path separators, C0 control characters, DEL, and characters Windows refuses in file names.
// biome-ignore lint/suspicious/noControlCharactersInRegex: control characters are exactly what this strips
const UNSAFE_FILENAME_CHARS = /[/\\\u0000-\u001f\u007f<>:"|?*]/g;

/** Truncates a string to at most `maxBytes` UTF-8 bytes without splitting a code point. */
function truncateBytes(value: string, maxBytes: number): string {
  let out = '';
  let bytes = 0;
  for (const char of value) {
    const size = Buffer.byteLength(char, 'utf8');
    if (bytes + size > maxBytes) break;
    out += char;
    bytes += size;
  }
  return out;
}

/**
 * A file name that is safe to create on macOS, Linux and Windows: NFC-normalised, no separators or control
 * characters, no leading or trailing dots and spaces, not a Windows reserved device name, at most `maxBytes` UTF-8
 * bytes with the extension kept. Never empty.
 */
export function safeFilename(name: string, maxBytes = 255, fallback = 'attachment'): string {
  // Invisible and bidi characters go first: `invoice<RLO>fdp.exe` is displayed as `invoiceexe.pdf` by file managers
  // and mail clients, which is how an executable is opened by someone who thought they were opening a PDF.
  const visible = [...name.normalize('NFC')]
    .filter((character) => !isDangerous(character.codePointAt(0) ?? 0))
    .join('');
  let cleaned = visible.replace(UNSAFE_FILENAME_CHARS, '_').replace(/\s+/g, ' ');
  cleaned = cleaned.replace(/^[.\s]+/, '').replace(/[.\s]+$/, '');
  if (cleaned === '') cleaned = fallback;
  const extension = extname(cleaned);
  // Windows resolves the segment before the **first** dot, not the last: `con.tar.gz` is still `CON`, and
  // `extname` only strips `.gz`. Checked against the first segment for that reason — without the spaces that end it,
  // which Windows drops before it compares: `con .txt` is `CON` too.
  if (WINDOWS_RESERVED.test((cleaned.split('.')[0] ?? cleaned).trimEnd())) cleaned = `_${cleaned}`;
  if (Buffer.byteLength(cleaned, 'utf8') <= maxBytes) return cleaned;
  const keptExtension = Buffer.byteLength(extension, 'utf8') < maxBytes / 2 ? extension : '';
  const keptStem = keptExtension ? cleaned.slice(0, -keptExtension.length) : cleaned;
  return truncateBytes(keptStem, maxBytes - Buffer.byteLength(keptExtension, 'utf8')) + keptExtension;
}

/** A short lowercase slug for directory names: letters and digits joined by single hyphens. */
export function slug(text: string, maxLength = 40, fallback = 'untitled'): string {
  const value = text
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, maxLength)
    .replace(/-+$/g, '');
  return value || fallback;
}

/** True when `candidate` is `root` itself or strictly inside it (lexically). */
export function isInside(candidate: string, root: string): boolean {
  const path = relative(resolve(root), resolve(candidate));
  return path === '' || (!path.startsWith(`..${sep}`) && path !== '..' && !isAbsolute(path));
}

async function realpathOfExistingAncestor(path: string): Promise<string> {
  let current = resolve(path);
  const tail: string[] = [];
  for (;;) {
    try {
      const real = await realpath(current);
      return tail.length ? join(real, ...tail.reverse()) : real;
    } catch (error) {
      const parent = dirname(current);
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT' || parent === current) throw error;
      tail.push(basename(current));
      current = parent;
    }
  }
}

/**
 * Resolves `target` for writing and proves it stays inside `root` after symlinks in its existing ancestors are
 * followed. Throws BAD_DATA otherwise. The root must already exist.
 */
export async function resolveInsideRoot(root: string, target: string): Promise<string> {
  const realRoot = await realpath(root);
  const lexical = resolve(root, target);
  if (!isInside(lexical, root)) {
    throw new CommsError('BAD_DATA', `refusing to write outside ${root}`, { details: { target } });
  }
  const real = await realpathOfExistingAncestor(lexical);
  if (!isInside(real, realRoot)) {
    throw new CommsError('BAD_DATA', `refusing to write through a link that leaves ${root}`, { details: { target } });
  }
  return lexical;
}

/**
 * Creates a new file for writing without following a symlink at the final component and without overwriting an
 * existing file. Picks `name-2.ext`, `name-3.ext`… when the name is taken.
 */
export async function createUniqueFile(
  directory: string,
  filename: string,
): Promise<{ path: string; handle: FileHandle }> {
  const extension = extname(filename);
  const stem = extension ? filename.slice(0, -extension.length) : filename;
  const noFollow = process.platform === 'win32' ? 0 : constants.O_NOFOLLOW;
  for (let attempt = 1; attempt < 1000; attempt += 1) {
    const name = attempt === 1 ? filename : `${stem}-${attempt}${extension}`;
    const path = join(directory, name);
    try {
      const handle = await open(path, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | noFollow, 0o600);
      return { path, handle };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'EEXIST') continue;
      throw error;
    }
  }
  // The folder, and not the name: a download's name is its sender's words, and this message reaches a result bare.
  throw new CommsError(
    'BAD_DATA',
    `could not find a free file name in ${directory}: the name and every numbered one after it are taken`,
  );
}

/**
 * Default places attachments may never be read from, whatever the allowed roots say. `~/.*` means every dot-entry
 * directly under home — SSH, cloud, npm, git and shell credentials, agent configs; `**∕.git/**` any repository's git
 * directory; `**∕.env*` dotenv files anywhere.
 */
export function defaultAttachDeny(configDir: string, env: NodeJS.ProcessEnv = process.env): string[] {
  const deny = [configDir, '~/.*', '~/Library', '**/.git/**', '**/.env*'];
  if (env.APPDATA) deny.push(env.APPDATA);
  if (env.LOCALAPPDATA) deny.push(env.LOCALAPPDATA);
  return deny;
}

export interface AttachPolicy {
  roots: string[];
  deny: string[];
  home?: string;
  /**
   * The printing package's handoffs, for the command a refusal names (`core.handoffs`, CUE-403). Left out, it names the
   * bare command it always has — the deprecated bridge, until every package gives core its caller.
   */
  handoffs?: HandoffMaker | undefined;
}

async function realOrResolved(path: string): Promise<string> {
  try {
    return await realpath(path);
  } catch {
    return resolve(path);
  }
}

/**
 * Whether a folder, as written, says where it is on its own: from the home (`~`), or absolute — and on Windows with its
 * drive (`C:\…`) or share (`\\server\share\…`). Windows calls `\outgoing` absolute, but it is on whichever drive is
 * current when it is read, and `C:outgoing` is relative to that drive's current folder; either would move with the
 * process that reads it. A folder in the configuration that does not name its place — written by hand before 0.12.0,
 * say — allows nothing, and `agentcomms attach` takes none (#45).
 */
export function namesItsPlace(path: string, platform: NodeJS.Platform = process.platform): boolean {
  if (path === '~' || path.startsWith('~/') || path.startsWith('~\\')) return true;
  if (platform === 'win32') return /^[A-Za-z]:[\\/]/.test(path) || /^[\\/]{2}[^\\/?.][^\\/]*[\\/][^\\/]+/.test(path);
  return isAbsolute(path);
}

/**
 * Proves a local file may be attached to a draft: it resolves (following links) to a regular file inside one of the
 * allowed roots and inside none of the deny entries. A deny entry of the form `**` + `/name*` matches by file name
 * prefix (so `.env*` matches `.env` and `.env.local`). Returns the real path.
 */
export async function checkAttachable(path: string, policy: AttachPolicy): Promise<string> {
  const home = policy.home;
  const requested = resolve(expandHome(path, home));
  let real: string;
  try {
    real = await realpath(requested);
  } catch {
    throw new CommsError('NOT_FOUND', `attachment not found: ${path}`);
  }
  const info = await stat(real);
  if (!info.isFile()) throw new CommsError('BAD_DATA', `not a regular file: ${path}`);

  // A configured folder that does not name its own place allows nothing: see `namesItsPlace`.
  const roots = await Promise.all(
    policy.roots.filter((root) => namesItsPlace(root)).map((root) => realOrResolved(expandHome(root, home))),
  );
  if (!roots.some((root) => isInside(real, root))) {
    /*
     * What a person can do about it, and nothing they cannot. This once named a CLI command for widening the allowed
     * folders when there was none. There is one now, core's `attach roots add` (#45), and it is a change the person
     * approves, so it is named with that said; the copy under the home folder is still the step that needs nobody. The
     * same words for a Gmail attachment, a Resend attachment and a Slack file, the command located from whichever is
     * printing (CUE-403) — or, where none is, the tool that does it from a chat, and why there is no command.
     */
    const allow = handoffSentenceToFill(
      asHandoffMaker(policy.handoffs).core(['attach', 'roots', 'add']),
      ['<folder>'],
      (command) => `allow its folder with ${command} (needs your approval).`,
      { instead: 'allow its folder with comms_attach from a chat (needs your approval).' },
    );
    throw new CommsError('BAD_DATA', `attachments must come from an allowed folder; ${path} is outside them`, {
      hint: `Copy the file under your home folder — not into one of its hidden folders — and name the copy instead, or ${allow}`,
    });
  }
  const name = basename(real);
  const homeDir = await realOrResolved(home ?? (await import('node:os')).homedir());
  for (const entry of policy.deny) {
    if (entry === '~/.*') {
      if (isInside(real, homeDir)) {
        const first = relative(homeDir, real).split(sep)[0] ?? '';
        if (first.startsWith('.')) {
          throw new CommsError(
            'BAD_DATA',
            `refusing to attach a file from ~/${first}: hidden folders in your home are never attached`,
          );
        }
      }
      continue;
    }
    if (entry === '**/.git/**') {
      if (real.split(sep).some((segment) => segment.toLowerCase() === '.git'))
        throw new CommsError('BAD_DATA', 'refusing to attach a file from a .git folder');
      continue;
    }
    if (entry.startsWith('**/')) {
      // Compared case-insensitively, like the `.git` rule above and like the filesystems this runs on: macOS and
      // Windows both open `~/project/.ENV` when asked for `.env`, so a case-sensitive deny list refuses one
      // spelling of a file and hands over the other.
      const pattern = entry.slice(3).toLowerCase();
      const candidate = name.toLowerCase();
      const prefix = pattern.endsWith('*') ? pattern.slice(0, -1) : pattern;
      if (pattern.endsWith('*') ? candidate.startsWith(prefix) : candidate === prefix) {
        throw new CommsError('BAD_DATA', `refusing to attach ${name}: files matching ${entry} are never attached`);
      }
      continue;
    }
    const denied = await realOrResolved(expandHome(entry, home));
    if (isInside(real, denied)) {
      throw new CommsError('BAD_DATA', `refusing to attach a file from ${entry}`);
    }
  }
  return real;
}

/**
 * A caller-supplied subdirectory, checked before it is joined to anything.
 *
 * `path.join` is not a boundary, and it was being used as one. `join('work', '../personal')` is `'personal'`: the
 * alias segment is cancelled, the result still resolves inside the downloads root, so `resolveInsideRoot` allows it
 * — and one mailbox's files are written into another mailbox's folder, over the `manifest.json` that is that
 * mailbox's own record of where its attachments came from. `join('work', '/etc/cron.d')` is `'work/etc/cron.d'`:
 * the leading separator is simply dropped, so an absolute path that every document describes as refused is quietly
 * accepted under a name the caller never asked for.
 *
 * Neither is an escape from the root, which is why neither showed up as a jail failure. In one respect they are
 * worse than an escape: they succeed, and report a path the caller was never told about.
 *
 * So the check happens here, on the caller's own string, before any join — absolute paths and `..` are refused
 * rather than normalised away. A nested `reports/august` is fine; that is what the option is for.
 */
export function relativeSubpath(out: string | undefined, field = 'out'): string {
  const value = (out ?? '').trim();
  if (!value) return '';
  const refuse = (why: string): never => {
    throw new CommsError('BAD_DATA', `${field} must be a relative subpath: ${why}`, {
      // Gmail, Resend and Slack all pass their `out` through here, so the hint names no one channel's kind of account.
      hint: 'Pass something like "reports/august". It is always placed inside this account’s own folder.',
      details: { value },
    });
  };
  if (isAbsolute(value) || /^[A-Za-z]:/.test(value) || value.startsWith('/') || value.startsWith('\\')) {
    refuse('it is an absolute path');
  }
  const segments = value.split(/[/\\]+/);
  if (segments.includes('..')) refuse('it climbs out with ".."');
  return segments.filter((segment) => segment && segment !== '.').join('/');
}
