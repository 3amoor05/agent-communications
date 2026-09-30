import { realpath } from 'node:fs/promises';
import { basename, dirname, isAbsolute, join, resolve } from 'node:path';
import type { GatedChange } from '../change-flow.ts';
import type { ChangeSurface } from '../changes.ts';
import { type Config, comparablePath, isInsideDirectory } from '../config.ts';
import type { Core } from '../core.ts';
import { CommsError } from '../errors.ts';
import { defaultAttachDeny, namesItsPlace } from '../jail.ts';
import { expandHome, homeDirectory } from '../paths.ts';

/**
 * Which local files may be attached — to a Gmail draft, a Resend email, a Slack post: the folders they may come from
 * (`defaults.attachRoots`), the paths they never may (`defaults.attachDeny`, on top of the built-in list the jail always
 * applies), reported and changed from a terminal (`agentcomms attach`) or a chat (`comms_attach`), one operation.
 *
 * Nothing did this before (issue #45). The jail's refusal said to copy the file under the home folder, because the only
 * other way was editing the configuration by hand. Changing the lists is a change like any other, through the one flow:
 * a folder added, or a deny entry taken away, widens what an agent can read off this disk and send to somebody, so
 * `classifyChange` counts it as a loosening and a person approves it first; a folder taken away, or a deny entry added,
 * narrows it and applies at once.
 *
 * A path is taken as the person wrote it — `~/work`, or absolute — and stored that way, so a configuration that moves to
 * another machine keeps meaning the same home. What it leads to on this disk, links followed, is what the jail checks a
 * file against, so the preview says so whenever the two differ: `~/link` that leads to `/` lets everything be attached,
 * and a preview that said only `~/link` would have hidden that.
 */

/** One entry of a list: as written, and where it leads on this disk. */
export interface AttachEntry {
  /** As the configuration holds it — or, for the built-in list, as the jail reads it. */
  path: string;
  /** Where it leads on this disk, links followed; null for a pattern (`**∕.git/**`, `~/.*`), which names no one place. */
  real: string | null;
}

export interface AttachReport {
  /** The folders files may be attached from. None: nothing can be attached. */
  roots: AttachEntry[];
  /**
   * Folders the configuration lists that name no place — relative, or on Windows without a drive — as written. They
   * allow nothing (see `namesItsPlace`), so they are shown apart from `roots`, with no place to lead to.
   */
  ignored: string[];
  /** The person's own entries that files may never come from, on top of the built-in list. */
  deny: AttachEntry[];
  /** What the jail never attaches from, whatever the configuration says: it cannot be removed. */
  builtIn: AttachEntry[];
}

export type AttachChangeKind = 'rootsAdd' | 'rootsRemove' | 'denyAdd' | 'denyRemove';

export const ATTACH_CHANGE_KINDS: readonly AttachChangeKind[] = Object.freeze([
  'rootsAdd',
  'rootsRemove',
  'denyAdd',
  'denyRemove',
]);

/** One change to one list: `rootsAdd` is `agentcomms attach roots add <path>` and `comms_attach` with `rootsAdd`. */
export interface AttachChangeRequest {
  kind: AttachChangeKind;
  path: string;
}

export interface AttachChangeResult extends AttachReport {
  kind: AttachChangeKind;
  path: string;
  /** False when the lists already said this, and nothing was written. */
  changed: boolean;
  /** Why nothing was written, or what the lists now leave — no folder at all, say. Null when there is nothing to add. */
  note: string | null;
}

/** The lists as they stand. */
export async function attachReport(core: Core, env: NodeJS.ProcessEnv): Promise<AttachReport> {
  return reportOf(await core.config.load(), core, env);
}

/**
 * One change to the lists, as a change the flow asks for or applies: see the top of this file.
 *
 * `plan` reads the lists and the disk again on both calls, so a claim for a list that moved meanwhile — or a link that
 * now leads somewhere else — is another change, and refused.
 */
export function attachChange(
  core: Core,
  env: NodeJS.ProcessEnv,
  change: AttachChangeRequest,
  surface: ChangeSurface,
): GatedChange<AttachChangeResult> {
  if (!ATTACH_CHANGE_KINDS.includes(change?.kind)) {
    throw new CommsError('USAGE', `"${String(change?.kind)}" is not a change to the attachment lists`, {
      hint: `One of: ${ATTACH_CHANGE_KINDS.join(', ')}.`,
    });
  }
  const removing = change.kind === 'rootsRemove' || change.kind === 'denyRemove';
  const path = removing ? listedPath(change.path) : checkedPath(change.path);
  const { kind } = change;
  const home = homeDirectory(env);
  const edit = editOf(kind, path, home);
  let planned: { changes: boolean; note: string | null } | null = null;
  return {
    plan: async (config) => {
      const outcome = await planChange(config, kind, path, { core, env, home });
      planned = { changes: outcome.changes, note: outcome.note };
      return {
        before: config,
        after: outcome.changes ? edit(config) : config,
        effects: outcome.effects,
        summary: SUMMARIES[kind](path),
      };
    },
    apply: async (consent) => {
      if (planned === null) throw new CommsError('UNEXPECTED', 'the attachment lists were changed before planned');
      const { note } = planned;
      if (!planned.changes) {
        return { kind, path, changed: false, note, ...(await reportOf(await core.config.load(), core, env)) };
      }
      // Made again from the configuration read inside the store's lock: whatever else moved meanwhile stays as it is,
      // and a loosening that is no longer the one approved is the store's to refuse.
      const written = await core.config.update(edit, consent ? { consent } : {});
      await core.audit.append({
        inboxId: '',
        operation: AUDIT_OPERATIONS[kind],
        outcome: 'ok',
        surface,
        reason: path,
      });
      return { kind, path, changed: true, note, ...(await reportOf(written, core, env)) };
    },
  };
}

/** The configuration with this one change made to it, and nothing else. */
function editOf(kind: AttachChangeKind, path: string, home: string): (config: Config) => Config {
  return (config) => {
    const { attachRoots: roots, attachDeny: deny } = config.defaults;
    const has = (list: readonly string[]) => list.some((entry) => samePath(entry, path, home));
    const lists =
      kind === 'rootsAdd'
        ? { attachRoots: has(roots) ? [...roots] : [...roots, path] }
        : kind === 'rootsRemove'
          ? { attachRoots: roots.filter((root) => !samePath(root, path, home)) }
          : kind === 'denyAdd'
            ? { attachDeny: has(deny) ? [...deny] : [...deny, path] }
            : { attachDeny: deny.filter((entry) => !samePath(entry, path, home)) };
    return { ...config, defaults: { ...config.defaults, ...lists } };
  };
}

const SUMMARIES: Readonly<Record<AttachChangeKind, (path: string) => string>> = {
  rootsAdd: (path) => `Let files under ${path} be attached`,
  rootsRemove: (path) => `Stop attaching files from under ${path}`,
  denyAdd: (path) => `Never attach files from ${path}`,
  denyRemove: (path) => `Let files from ${path} be attached again`,
};

const AUDIT_OPERATIONS: Readonly<Record<AttachChangeKind, string>> = {
  rootsAdd: 'attach.roots.add',
  rootsRemove: 'attach.roots.remove',
  denyAdd: 'attach.deny.add',
  denyRemove: 'attach.deny.remove',
};

/** The command that allows another folder, as every refusal and every document names it. */
export const ATTACH_ROOTS_ADD = 'agentcomms attach roots add <folder>';

/**
 * The path as written, refused unless it says where it is on its own: absolute, or from the home folder. A relative
 * path means whatever folder the command or the server happened to start in, which is not something a person reads
 * in a preview and knows.
 */
export function checkedPath(path: unknown, platform: NodeJS.Platform = process.platform): string {
  const value = typeof path === 'string' ? path.trim() : '';
  if (value === '') {
    throw new CommsError('USAGE', 'name the folder or path', {
      hint: `For example: \`${ATTACH_ROOTS_ADD.replace('<folder>', '~/Documents/outgoing')}\`.`,
    });
  }
  // The jail's own rule, so what this takes is what the jail allows (see `namesItsPlace`).
  if (namesItsPlace(value, platform)) return value;
  if (platform === 'win32' && isAbsolute(value)) {
    throw new CommsError(
      'USAGE',
      `"${value}" does not name its drive: give it in full, like C:\\outgoing, or starting with ~`,
      {
        hint: 'A path with no drive is on whichever drive is current when it is read, which is not something a person approves once.',
      },
    );
  }
  throw new CommsError('USAGE', `"${value}" is a relative path: give it absolute, or starting with ~`, {
    hint: 'A relative path means whatever folder this happened to start in. Write it in full, or from your home folder: `~/Documents/outgoing`.',
  });
}

/**
 * An entry to take out, as it is listed. Not held to `checkedPath`: an entry written by hand before 0.12.0 may name no
 * place — `\outgoing` on Windows — and the one way to be rid of it must not be to edit the file again. An entry that is
 * not listed is refused when the change is planned.
 */
function listedPath(path: unknown): string {
  const value = typeof path === 'string' ? path.trim() : '';
  if (value === '')
    throw new CommsError('USAGE', 'name the folder or path to take out, as `agentcomms attach` lists it');
  return value;
}

/** A deny entry that names no one place: the jail matches it by name, anywhere (`**∕…`), or every hidden folder in the home. */
function isPattern(entry: string): boolean {
  return entry.startsWith('**/') || entry === '~/.*';
}

/** Where a path leads on this disk: every link in the part of it that exists followed, the rest as written. */
async function realOf(path: string, home: string): Promise<string> {
  let current = resolve(expandHome(path, home));
  const tail: string[] = [];
  for (;;) {
    try {
      const real = await realpath(current);
      return tail.length > 0 ? join(real, ...tail.reverse()) : real;
    } catch {
      const parent = dirname(current);
      if (parent === current) return resolve(expandHome(path, home));
      tail.push(basename(current));
      current = parent;
    }
  }
}

async function entryOf(path: string, home: string): Promise<AttachEntry> {
  return { path, real: isPattern(path) ? null : await realOf(path, home) };
}

async function reportOf(config: Config, core: Core, env: NodeJS.ProcessEnv): Promise<AttachReport> {
  const home = homeDirectory(env);
  const entries = (list: readonly string[]) => Promise.all(list.map((path) => entryOf(path, home)));
  const listed = config.defaults.attachRoots;
  return {
    roots: await entries(listed.filter((root) => namesItsPlace(root))),
    ignored: listed.filter((root) => !namesItsPlace(root)),
    deny: await entries(config.defaults.attachDeny),
    builtIn: await entries(defaultAttachDeny(core.paths.configDir, env)),
  };
}

/** Whether two entries are the same path as written — the one the person named — once `~` and `..` are read. */
function samePath(a: string, b: string, home: string): boolean {
  if (a === b) return true;
  if (isPattern(a) || isPattern(b)) return false;
  // An entry that names no place is only ever itself: resolved, it would be whichever folder this happened to start
  // in, and the folder written in full would count as already listed, and never be added.
  if (!namesItsPlace(a) || !namesItsPlace(b)) return false;
  return comparablePath(resolve(expandHome(a, home))) === comparablePath(resolve(expandHome(b, home)));
}

/** "~, ~/work", or "none". */
function listed(list: readonly string[]): string {
  return list.length > 0 ? list.join(', ') : 'none';
}

async function planChange(
  config: Config,
  kind: AttachChangeKind,
  path: string,
  context: { core: Core; env: NodeJS.ProcessEnv; home: string },
): Promise<{ changes: boolean; effects: string[]; note: string | null }> {
  const { home } = context;
  const roots = config.defaults.attachRoots;
  const deny = config.defaults.attachDeny;
  switch (kind) {
    case 'rootsAdd': {
      // Judged by where each leads, as the jail judges a file: `~/link` inside `~` that leads to `/` is not inside it.
      const real = await realOf(path, home);
      // Only the folders the jail reads: one that names no place allows nothing, so it covers nothing either.
      for (const root of roots.filter((listed) => namesItsPlace(listed))) {
        if (isInsideDirectory(comparablePath(real), comparablePath(await realOf(root, home)))) {
          return {
            changes: false,
            effects: [],
            note: `${path} is already allowed: it is ${samePath(path, root, home) ? 'listed as' : 'inside'} ${root}, which files may already be attached from. Nothing was changed.`,
          };
        }
      }
      const lexical = resolve(expandHome(path, home));
      return {
        changes: true,
        // What the jail will check files against, when it is not what the path says: a link on the way.
        effects:
          comparablePath(real) === comparablePath(lexical)
            ? []
            : [`${path} leads to ${real} through a link, so files anywhere under ${real} could be attached`],
        note: null,
      };
    }
    case 'rootsRemove': {
      const kept = roots.filter((root) => !samePath(root, path, home));
      if (kept.length === roots.length) {
        throw new CommsError('NOT_FOUND', `${path} is not one of the folders files may be attached from`, {
          hint: `They are: ${listed(roots)}. \`agentcomms attach\` lists them.`,
        });
      }
      return {
        changes: true,
        effects: [],
        note:
          kept.length === 0
            ? `No folder is left, so nothing can be attached until one is added with \`${ATTACH_ROOTS_ADD}\`.`
            : null,
      };
    }
    case 'denyAdd': {
      const builtIn = defaultAttachDeny(context.core.paths.configDir, context.env);
      const real = comparablePath(await realOf(path, home));
      for (const entry of [...builtIn, ...deny]) {
        if (isPattern(entry)) continue;
        if (isInsideDirectory(real, comparablePath(await realOf(entry, home)))) {
          return {
            changes: false,
            effects: [],
            note: `${path} is already never attached from: it is ${samePath(path, entry, home) ? 'listed as' : 'inside'} ${entry}${builtIn.includes(entry) ? ', on the built-in list' : ''}. Nothing was changed.`,
          };
        }
      }
      return { changes: true, effects: [], note: null };
    }
    case 'denyRemove': {
      const kept = deny.filter((entry) => !samePath(entry, path, home));
      if (kept.length < deny.length) {
        return { changes: true, effects: [], note: null };
      }
      const builtIn = defaultAttachDeny(context.core.paths.configDir, context.env);
      const own = builtIn.find((entry) => samePath(entry, path, home));
      if (own !== undefined) {
        throw new CommsError('USAGE', `${own} is on the built-in list, which cannot be removed`, {
          hint: 'The built-in list is what is never attached whatever the configuration says: the configuration folder, every hidden folder in your home, ~/Library, any .git folder and any .env file. `agentcomms attach` lists it.',
        });
      }
      throw new CommsError('NOT_FOUND', `${path} is not one of your own entries that files may never come from`, {
        hint: `Yours are: ${listed(deny)}. \`agentcomms attach\` lists them, and the built-in list beside them.`,
      });
    }
  }
}
