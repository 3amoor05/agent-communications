import { type ApprovalIo, NODE_APPROVAL_IO } from '../../src/approval-io.ts';
import { AuditLog, type AuditRecord } from '../../src/audit.ts';
import type { LockIo } from '../../src/lock.ts';

/**
 * An instrumented file system for approval maintenance and the unsent report (design 2026-10-05 §D9): every directory
 * read, stat, record open, write, unlink, lock create, lock read (an ownership check, or a holder's body), renewal and
 * lock-file removal — and every durable audit append — is logged at its start and its end, with the clock's time, and
 * a test's hook runs before each one: to advance a fake clock, hold an operation open, fail it, or crash the process.
 *
 * A crash is a process that stops dead: the operation it struck throws, and so does every one after it — so nothing
 * a `finally` would have done (a lock released) happens, exactly as when a process is killed.
 */

export type IoKind =
  | 'readdir'
  | 'stat'
  | 'read'
  | 'write'
  | 'unlink'
  | 'append'
  | 'lock.create'
  | 'lock.read'
  | 'lock.mtime'
  | 'lock.touch'
  | 'lock.rename'
  | 'lock.link'
  | 'lock.remove';

export interface IoOp {
  readonly seq: number;
  readonly kind: IoKind;
  readonly path: string;
  readonly phase: 'start' | 'end' | 'error';
  /** The test clock's time at that moment. */
  readonly at: number;
}

export class Crash extends Error {
  constructor() {
    super('the process stopped here');
  }
}

export interface Instrumented {
  readonly io: ApprovalIo;
  readonly audit: Pick<AuditLog, 'append'>;
  readonly log: IoOp[];
  /** Runs before each operation; may advance the clock, wait, or throw. */
  before: ((op: IoOp) => void | Promise<void>) | undefined;
  /** Whether a crash has struck: from then on every operation throws. */
  dead: boolean;
  /** The operations started, of `kind`, whose path passes `filter`. */
  started(kind: IoKind, filter?: (path: string) => boolean): IoOp[];
  /** Crashes the process at the first operation `when` matches (before it runs, or just after it when `after`). */
  crashAt(when: (op: IoOp) => boolean, options?: { after?: boolean }): void;
  /** The rows appended through `audit`. */
  readonly rows: AuditRecord[];
}

/** An errno-shaped error, as the file system would throw it. */
export function errno(code: string): NodeJS.ErrnoException {
  const error = new Error(`${code}: injected`) as NodeJS.ErrnoException;
  error.code = code;
  return error;
}

export function instrumentedIo(options: { stateDir: string; now: () => number; real?: ApprovalIo }): Instrumented {
  const real = options.real ?? NODE_APPROVAL_IO;
  const realAudit = new AuditLog(options.stateDir, () => new Date(options.now()));
  let seq = 0;
  const nextSeq = () => {
    seq += 1;
    return seq;
  };
  let crashWhen: { when: (op: IoOp) => boolean; after: boolean } | undefined;
  const state: Instrumented = {
    io: undefined as unknown as ApprovalIo,
    audit: undefined as unknown as Pick<AuditLog, 'append'>,
    log: [],
    before: undefined,
    dead: false,
    rows: [],
    started: (kind, filter) =>
      state.log.filter((op) => op.phase === 'start' && op.kind === kind && (filter === undefined || filter(op.path))),
    crashAt: (when, crashOptions = {}) => {
      crashWhen = { when, after: crashOptions.after === true };
    },
  };
  async function run<T>(kind: IoKind, path: string, work: () => Promise<T>): Promise<T> {
    const start: IoOp = { seq: nextSeq(), kind, path, phase: 'start', at: options.now() };
    if (state.dead) throw new Crash();
    state.log.push(start);
    if (crashWhen?.after === false && crashWhen.when(start)) {
      state.dead = true;
      throw new Crash();
    }
    await state.before?.(start);
    if (state.dead) throw new Crash();
    try {
      const value = await work();
      state.log.push({ seq: nextSeq(), kind, path, phase: 'end', at: options.now() });
      if (crashWhen?.after === true && crashWhen.when(start)) {
        state.dead = true;
        throw new Crash();
      }
      return value;
    } catch (error) {
      if (!(error instanceof Crash)) state.log.push({ seq: nextSeq(), kind, path, phase: 'error', at: options.now() });
      throw error;
    }
  }
  const lock: LockIo = {
    create: (path, body) => run('lock.create', path, () => real.lock.create(path, body)),
    read: (path) => run('lock.read', path, () => real.lock.read(path)),
    mtime: (path) => run('lock.mtime', path, () => real.lock.mtime(path)),
    touch: (path) => run('lock.touch', path, () => real.lock.touch(path)),
    rename: (from, to) => run('lock.rename', from, () => real.lock.rename(from, to)),
    link: (from, to) => run('lock.link', from, () => real.lock.link(from, to)),
    remove: (path) => run('lock.remove', path, () => real.lock.remove(path)),
  };
  (state as { io: ApprovalIo }).io = {
    readdir: (directory) => run('readdir', directory, () => real.readdir(directory)),
    stat: (path) => run('stat', path, () => real.stat(path)),
    readText: (path) => run('read', path, () => real.readText(path)),
    writeAtomic: (path, text, writeOptions) => run('write', path, () => real.writeAtomic(path, text, writeOptions)),
    unlink: (path) => run('unlink', path, () => real.unlink(path)),
    lock,
  };
  (state as { audit: Pick<AuditLog, 'append'> }).audit = {
    append: (record, appendOptions) =>
      run('append', `audit:${appendOptions?.durable ? 'durable' : 'plain'}:${record.approvalId ?? ''}`, async () => {
        const written = await realAudit.append(record, appendOptions);
        state.rows.push(written);
        return written;
      }),
  };
  return state;
}

/** A path's approval record id and artifact: `ap_…`, and `json`, `claim` or `lock`; null for anything else. */
export function artifactOf(path: string): { approvalId: string; artifact: 'json' | 'claim' | 'lock' } | null {
  const found = /(ap_[0-9A-HJKMNP-TV-Z]{26})\.(json\.lock|json|claim)$/.exec(path);
  if (found === null) return null;
  const suffix = found[2];
  return {
    approvalId: found[1] as string,
    artifact: suffix === 'json.lock' ? 'lock' : suffix === 'json' ? 'json' : 'claim',
  };
}

/** Whether `path` is an approval record's own file (not its lock, its marker, or the maintenance state). */
export const isRecordFile = (path: string): boolean => artifactOf(path)?.artifact === 'json';
/** Whether `path` is an approval record's lock. */
export const isRecordLock = (path: string): boolean => artifactOf(path)?.artifact === 'lock';
/** Whether `path` is the maintenance lock. */
export const isMaintenanceLock = (path: string): boolean => path.endsWith('.maintenance.lock');
