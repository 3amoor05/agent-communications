import { basename } from 'node:path';
import type { ClientCandidate } from '../operations/setup.ts';
import { CLIENT_KIND_LABEL } from './render.ts';
import type { Choice } from './tui.ts';

/**
 * The setup's client step: which downloaded client JSON to register.
 *
 * **It looks for the file when the step is reached, and again whenever it is asked to.** It used to be handed the
 * scan the command made as it started — before the Google Cloud walk, and so before the one file this step exists to
 * find had been downloaded. A first run therefore always found nothing and fell through to a typed path, with no
 * way to look again; the second run found the file at once, which is how a person reported it (CUE-298): "it did
 * not discover the file … then, the second time, the file was found."
 *
 * Both prompts lead back to the scan. The list carries **Look again**, for a download that finished after the list
 * was drawn; the typed path takes an empty answer as the same request, because Enter on an empty field is what a
 * person who is still waiting for the file does.
 */

/** What the step needs from the terminal. Passed in, so the flow can be driven by a test as well as by a person. */
export interface ClientStepPrompts {
  choose(options: { message: string; choices: Choice<string>[]; initial?: string | undefined }): Promise<string>;
  type(options: { message: string; placeholder?: string | undefined }): Promise<string>;
}

/** The two list entries that are not files. A path cannot contain a NUL, so neither can be mistaken for one. */
const LOOK_AGAIN = '\0look-again';
const ELSEWHERE = '\0elsewhere';

export const CLIENT_PATH_PLACEHOLDER = '~/Downloads/client_secret_….json';

/** A directory as a person would type it: `~/Downloads` rather than the whole home path. */
export function asTyped(directory: string, home: string): string {
  if (directory === home) return '~';
  for (const separator of ['/', '\\']) {
    if (home && directory.startsWith(home + separator)) return `~${separator}${directory.slice(home.length + 1)}`;
  }
  return directory;
}

export async function chooseClientFile(
  prompts: ClientStepPrompts,
  scan: () => Promise<ClientCandidate[]>,
  /** Where the scan looks, as the person would write it — named in the prompts, because "not found" needs a "where". */
  where: string,
): Promise<string> {
  for (;;) {
    const candidates = await scan();
    if (candidates.length > 0) {
      const usable = candidates.find((candidate) => candidate.kind === 'desktop');
      const picked = await prompts.choose({
        message: 'Which client file?',
        choices: [
          ...candidates.map((candidate) => ({
            value: candidate.path,
            label: basename(candidate.path),
            hint: `${CLIENT_KIND_LABEL[candidate.kind] ?? candidate.kind} · downloaded ${new Date(candidate.modifiedAt).toLocaleString()}`,
          })),
          { value: LOOK_AGAIN, label: 'Look again', hint: `not listed yet? check ${where} again` },
          { value: ELSEWHERE, label: 'Somewhere else…', hint: 'type a path' },
        ],
        initial: usable?.path,
      });
      if (picked === LOOK_AGAIN) continue;
      if (picked !== ELSEWHERE) return picked;
      const typed = await prompts.type({
        message: `Path to the downloaded client JSON (Enter to look in ${where} again)`,
        placeholder: CLIENT_PATH_PLACEHOLDER,
      });
      if (typed) return typed;
      continue;
    }
    const typed = await prompts.type({
      message: `No client file in ${where} yet. Path to it, or Enter to look again`,
      placeholder: CLIENT_PATH_PLACEHOLDER,
    });
    if (typed) return typed;
  }
}
