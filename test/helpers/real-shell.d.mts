/**
 * Types for `real-shell.mjs`: the shared fixtures for pasting a printed command into a real shell (CUE-403), as the
 * packages' TypeScript tests import them. What each one does is said where it is written.
 */
import type { SpawnSyncReturns } from 'node:child_process';

export type Folder = 'configDir' | 'stateDir' | 'dataDir' | 'secretsDir' | 'downloadsDir';
export type Folders = Partial<Record<Folder, string>>;

export interface Shell {
  env: NodeJS.ProcessEnv;
  cwd: string;
  decoys: string;
  sealLog: string;
}

export interface SealAttempt {
  what: 'keychain' | 'connection' | 'name lookup' | 'datagram';
  target: string;
  pid: number;
}

export interface WindowsShell {
  name: string;
  run(line: string, options: { env: NodeJS.ProcessEnv; cwd: string }): SpawnSyncReturns<string>;
}

export interface McpServerProcess {
  call(name: string, args: Record<string, unknown>): Promise<Record<string, unknown>>;
  close(): Promise<void>;
}

export interface TestSkip {
  skip?: string;
}

export const ROOT: string;
export const PATH_OPTIONS: Readonly<Record<Folder, string>>;
export const FOUR_FOLDERS: readonly Folder[];
export const SUITE_COMMANDS: readonly string[];
export function suiteCommandsOn(pathValue: string | undefined, platform?: NodeJS.Platform): string[];
export function strippedPath(platform?: NodeJS.Platform): string;
export function baseEnvironment(options: {
  home: string;
  tmp?: string;
  sealLog: string;
  platform?: NodeJS.Platform;
}): NodeJS.ProcessEnv;
export interface FixtureWrites {
  mkdir(path: string, options?: unknown): unknown;
  writeFile(path: string, data: string | Uint8Array, options?: unknown): unknown;
  open(path: string, flags?: string | number, mode?: number): unknown;
  rename(from: string, to: string): unknown;
  rm(path: string, options?: unknown): unknown;
}
export function refuseRealHome(path: string, where?: { home?: string; temp?: string }): void;
export function fixtureWrites(options?: { fs?: FixtureWrites; home?: string; temp?: string }): FixtureWrites;
export const WRITES: FixtureWrites;
export function freshShell(
  root: string,
  options?: { platform?: NodeJS.Platform; extra?: NodeJS.ProcessEnv; writes?: FixtureWrites },
): Shell;
export function filesUnder(dir: string): string[];
export function suiteTraces(shell: Shell, expected?: readonly string[]): string[];
export function sealAttempts(sealLog: string): SealAttempt[];
export function runNode(
  args: readonly string[],
  options: { env: NodeJS.ProcessEnv; cwd: string; input?: string },
): SpawnSyncReturns<string>;
export function posixShell(line: string, options: { env: NodeJS.ProcessEnv; cwd: string }): SpawnSyncReturns<string>;
export interface Finished {
  status: number | null;
  signal: NodeJS.Signals | null;
  stdout: string;
  stderr: string;
}
export function spawnAsync(
  program: string,
  args: readonly string[],
  options: { env: NodeJS.ProcessEnv; cwd: string; input?: string },
): Promise<Finished>;
export function runNodeAsync(
  args: readonly string[],
  options: { env: NodeJS.ProcessEnv; cwd: string; input?: string },
): Promise<Finished>;
export function posixShellAsync(line: string, options: { env: NodeJS.ProcessEnv; cwd: string }): Promise<Finished>;
export const TERMINAL_PYTHON: string | null;
export const NEEDS_TERMINAL: TestSkip;
export function posixTerminal(
  line: string,
  options: { env: NodeJS.ProcessEnv; cwd: string; answer?: 'challenge' | 'enter' },
): SpawnSyncReturns<string>;
export function posixTerminalAsync(
  line: string,
  options: { env: NodeJS.ProcessEnv; cwd: string; answer?: 'challenge' | 'enter' },
): Promise<Finished>;
export const ON_WINDOWS: TestSkip;
export const ON_POSIX: TestSkip;
export function windowsShells(): WindowsShell[];
export function startMcpServer(
  command: string,
  args: readonly string[],
  options: { env: NodeJS.ProcessEnv; cwd: string },
): McpServerProcess;
export function commandsIn(text: string): string[];
export function commandEndingWith(text: string, tail: readonly string[], platform?: NodeJS.Platform): string;
export function wordsOf(line: string, platform?: NodeJS.Platform): string[] | null;
export function argvOf(command: string, platform?: NodeJS.Platform): string[] | null;
export function refusesWithoutATerminal(approve: string, shell: Shell, tail: readonly string[]): void;
export function inWindowsShells(
  command: string,
  shell: Shell,
  check: (result: SpawnSyncReturns<string>, name: string) => void,
  shells?: readonly WindowsShell[],
): void;
export function pinsOf(words: readonly string[]): Folders;
export function environmentAssignments(text: string): string[];
export function real(path: string): string;
export function builtCli(directory: string): string;
export function isCanonical(path: string): boolean;
