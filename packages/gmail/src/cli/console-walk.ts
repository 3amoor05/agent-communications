import { basename } from 'node:path';
import type { ClientCandidate } from '../operations/setup.ts';
import type { SetupProgress } from '../operations/setup-progress.ts';
import type { Choice } from './tui.ts';

/**
 * Where the Google Cloud walk starts, and the walk itself.
 *
 * The walk is five steps in a browser, and the machine keeps no trace of them. So without help a run that was
 * stopped halfway — or stopped after the client JSON was downloaded, at the prompt that asks for it — started again
 * at 1/5 (CUE-298). Two things can tell it otherwise, and this asks about both rather than acting on either, because
 * neither is proof:
 *
 *  - **a Desktop client file already in the download directory.** Downloading it is the last console step, so it is
 *    the best evidence there is that the walk is behind the person. Offered as "use it and skip the steps".
 *  - **the last step the person confirmed** (`setup-progress.ts`). Offered as "continue from the next one".
 *
 * "Start over" is always one of the answers, and nothing is removed whichever is chosen.
 */

export interface WalkPlan {
  /** The first console step to show, counting from 0. Equal to the number of steps when the walk is skipped. */
  from: number;
  /** A client file the person chose to use, when they skipped the walk for it. */
  path?: string;
}

export interface PlanInput {
  steps: readonly { title: string }[];
  progress: SetupProgress | null;
  /** The client files found as the command started. */
  candidates: readonly ClientCandidate[];
  /** Where those were looked for, as the person would write it. */
  where: string;
  choose(options: { message: string; choices: Choice<string>[]; initial?: string | undefined }): Promise<string>;
}

export async function planConsoleWalk(input: PlanInput): Promise<WalkPlan> {
  const total = input.steps.length;
  const usable = input.candidates.find((candidate) => candidate.kind === 'desktop');
  const progress = input.progress;
  if (!usable && !progress) return { from: 0 };

  /*
   * One question with every way on, not one per piece of evidence. A file in the downloads directory used to be
   * asked about on its own, and its question had no "continue" in it: somebody with an old client file lying around
   * and three steps confirmed could only use that file or walk all five again (CUE-298 review). And with a single
   * file found there was no way to pass it over for another — the one still downloading, say.
   */
  const said: string[] = [];
  const choices: Choice<string>[] = [];
  if (usable) {
    const when = new Date(usable.modifiedAt).toLocaleString();
    said.push(
      `${basename(usable.path)} is in ${input.where} (Desktop app, downloaded ${when}). Downloading it is the last Google Cloud step.`,
    );
    choices.push(
      { value: 'use', label: 'Use it, and skip the Google Cloud steps' },
      {
        value: 'list',
        label: 'Skip the Google Cloud steps, and choose a file',
        hint: `another one in ${input.where}, or one still downloading`,
      },
    );
  }
  if (progress) {
    const when = new Date(progress.at).toLocaleString();
    const done = progress.consoleStep;
    const last = input.steps[done - 1]?.title ?? `step ${done}`;
    const next = input.steps[done]?.title;
    said.push(`You confirmed Google Cloud step ${done}/${total} (${last}) on ${when}.`);
    choices.push(
      next
        ? { value: 'continue', label: `Continue from step ${done + 1}/${total}: ${next}` }
        : { value: 'continue', label: 'Continue to the client file', hint: `all ${total} steps were confirmed` },
    );
  }
  choices.push({
    value: 'restart',
    label: progress ? `Start over from 1/${total}` : `Walk the Google Cloud steps from 1/${total}`,
    hint: 'changes nothing on this machine',
  });

  const answer = await input.choose({ message: said.join(' '), choices, initial: usable ? 'use' : 'continue' });
  if (answer === 'use' && usable) return { from: total, path: usable.path };
  if (answer === 'list') return { from: total };
  if (answer === 'continue' && progress) return { from: progress.consoleStep };
  return { from: 0 };
}

export interface WalkInput<Step> {
  steps: readonly Step[];
  from: number;
  /** Shows one step, waits for the person to say it is done. */
  show(step: Step, index: number): Promise<void>;
  /** Called after each confirmation with the step's number counting from 1, so a stop afterwards resumes past it. */
  record(consoleStep: number): Promise<void>;
}

export async function runConsoleWalk<Step>(input: WalkInput<Step>): Promise<void> {
  for (let index = input.from; index < input.steps.length; index++) {
    await input.show(input.steps[index] as Step, index);
    await input.record(index + 1);
  }
}
