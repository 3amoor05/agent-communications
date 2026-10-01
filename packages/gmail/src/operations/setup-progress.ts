import { readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { writeFileAtomic } from '@agentcomms/core';

/**
 * How far through the Google Cloud steps a person has said they are.
 *
 * Everything else setup knows about where it stands it reads from the machine: a registered client, a connected
 * mailbox, a server entry. The five console steps leave nothing on the machine — they happen in a browser — so until
 * a client was registered, every run started them again from 1/5, however far the last one had got (CUE-298: "it was
 * taken from the absolute beginning, not the last step where he was"). This is the one thing the walk now writes
 * down: the last step the person pressed Enter on, and when.
 *
 * It records an answer, not a fact. Nothing here can see the Cloud console, so a resumed run offers to continue
 * rather than continuing, and always offers to start over. Once a client is registered the record has done its job
 * and is removed.
 */

const PROGRESS_FILE = 'gmail-setup-progress.json';

export interface SetupProgress {
  /** The last console step confirmed, counting from 1. */
  consoleStep: number;
  /** When it was confirmed, so a person resuming can tell a minute ago from last month. */
  at: string;
}

function progressPath(stateDir: string): string {
  return join(stateDir, PROGRESS_FILE);
}

/** The recorded progress, or null for none — and for anything unreadable, which is the same as none. */
export async function readSetupProgress(stateDir: string, steps: number): Promise<SetupProgress | null> {
  try {
    const parsed = JSON.parse(await readFile(progressPath(stateDir), 'utf8')) as Partial<SetupProgress> | null;
    const step = parsed?.consoleStep;
    const at = parsed?.at;
    if (!Number.isInteger(step) || (step as number) < 1 || (step as number) > steps) return null;
    if (typeof at !== 'string' || Number.isNaN(Date.parse(at))) return null;
    return { consoleStep: step as number, at };
  } catch {
    return null;
  }
}

export async function recordConsoleStep(stateDir: string, consoleStep: number, now: Date): Promise<void> {
  const record: SetupProgress = { consoleStep, at: now.toISOString() };
  await writeFileAtomic(progressPath(stateDir), `${JSON.stringify(record, null, 2)}\n`);
}

export async function clearSetupProgress(stateDir: string): Promise<void> {
  await rm(progressPath(stateDir), { force: true });
}
