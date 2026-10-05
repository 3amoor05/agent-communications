/**
 * Types for `approval-matrix.mjs`: the D2 matrix's rows, as the packages' drivers import them. What each one does is
 * said where it is written.
 */

export const ROWS: Readonly<{
  send: readonly string[];
  change: readonly string[];
  download: readonly string[];
}>;

export function routeOf(row: string): 'chat' | 'confirm';
export function wrongCodesOf(row: string): number;

export interface MatrixClock {
  now(): Date;
  at(): number;
  set(ms: number): void;
  advance(ms: number): void;
}
export function matrixClock(start?: number): MatrixClock;

export function approveAsPerson(core: unknown, approvalId: string): Promise<unknown>;

export function arrange(
  row: string,
  context: {
    core: unknown;
    lib: unknown;
    clock: MatrixClock;
    approvalId: string;
  },
): Promise<void>;

export const WRONG_CODE: string;
export const NOBODY: string;

export interface Observation {
  ok: boolean;
  code?: string;
  message?: string;
  hint?: string;
  approval?: Record<string, unknown> | null;
  sends: number;
  details?: Record<string, unknown>;
  extra?: Record<string, unknown>;
}

export type MatrixAction = 'claim' | 'approve' | 'look' | 'list';

export interface MatrixSurface<W> {
  name: string;
  action: MatrixAction;
  act(world: W, approvalId: string, row: string): Promise<Observation>;
}

export interface MatrixWorld {
  core: unknown;
  clock: MatrixClock;
  approvalId: string;
  notFound(action: MatrixAction, surface: MatrixSurface<never>): Promise<ReadonlyArray<readonly [string, string]>>;
  fault?(): Promise<void> | void;
}

export function drive<W extends MatrixWorld>(
  kind: 'send' | 'change' | 'download',
  options: {
    world(row: string): Promise<W>;
    surfaces: ReadonlyArray<MatrixSurface<W>>;
    emit(row: string, surface: MatrixSurface<W>, observation: Observation, role?: string): void;
    lib: unknown;
  },
): Promise<void>;

export function observeTool(
  result: { isError?: boolean; structuredContent?: Record<string, unknown> },
  sends: number,
  options?: { look?: boolean },
): Observation;
export function observeError(error: unknown, sends: number): Observation;
export function emitter(
  kind: 'send' | 'change' | 'download',
  channel: string,
): <W>(row: string, surface: MatrixSurface<W>, observation: Observation, role?: string) => void;
