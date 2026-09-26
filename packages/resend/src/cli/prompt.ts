import { createInterface } from 'node:readline/promises';
import { Writable } from 'node:stream';
import { agentMarker, CommsError, canPrompt, type Streams } from '@agentcomms/core';

/**
 * Asking a person at the terminal: a question, and a key that is not shown as it is typed.
 *
 * Copies of the Slack package's `askFor` and `askHidden`, kept here because core has no terminal prompt yet (a
 * candidate to move there: three packages now carry one).
 */

export async function askFor(streams: Streams, question: string): Promise<string> {
  const rl = createInterface({
    input: streams.stdin as NodeJS.ReadableStream,
    output: streams.stderr as NodeJS.WritableStream,
  });
  try {
    return await rl.question(question);
  } finally {
    rl.close();
  }
}

/**
 * Reads one line without showing it. readline in terminal mode puts a TTY into raw mode, so the terminal echoes
 * nothing, and echoes each keystroke to its `output` — here a stream that throws everything away. `historySize: 0`
 * keeps the line out of readline's own history. Ctrl-C cancels the question rather than leaving it waiting.
 */
export async function askHidden(streams: Streams, question: string): Promise<string> {
  streams.stderr.write(question);
  const muted = new Writable({
    write(_chunk, _encoding, done) {
      done();
    },
  });
  const rl = createInterface({
    input: streams.stdin as NodeJS.ReadableStream,
    output: muted,
    terminal: true,
    historySize: 0,
  });
  const cancel = new AbortController();
  rl.on('SIGINT', () => cancel.abort());
  try {
    return await rl.question('', { signal: cancel.signal });
  } catch {
    throw new CommsError('USAGE', 'cancelled, so nothing was changed');
  } finally {
    rl.close();
    streams.stderr.write('\n');
  }
}

/** The environment variable a person may set, in their own terminal, instead of typing the key. */
export const KEY_ENV = 'RESEND_API_KEY';

const KEY_SHAPE = /^re_[A-Za-z0-9_]{8,200}$/;

/**
 * A Resend API key, from a person at a terminal — and from nowhere else.
 *
 * Two ways in, and deliberately no third: a hidden prompt, or `RESEND_API_KEY` in that terminal's environment. Never
 * an option (it would land in shell history and the process list), never an MCP tool (a key typed into a chat stays
 * in the transcript), and never from an agent: a command run under an agent's marker is refused before anything is
 * read. That last is a speed bump, not a boundary — an agent with a shell can hide its marker — and the docs say so.
 *
 * Whatever was given is never echoed back, even when it is refused.
 */
export async function readApiKey(
  env: NodeJS.ProcessEnv,
  streams: Streams,
  options: { json: boolean; command: string },
): Promise<string> {
  const marker = agentMarker(env);
  if (marker) {
    throw new CommsError(
      'AUTH_REQUIRED',
      'a Resend API key is added by a person at their own terminal, not by an agent',
      {
        hint: `Ask the user to run \`${options.command}\` in their own terminal. Never paste a key into a chat: the transcript keeps it.`,
        details: { marker },
      },
    );
  }
  let key = env[KEY_ENV]?.trim() ?? '';
  if (key === '') {
    if (!canPrompt(env, streams, { json: options.json })) {
      throw new CommsError('AUTH_REQUIRED', 'a Resend API key is needed, and there is no terminal to ask for it', {
        hint: `A person runs \`${options.command}\` in a terminal, which asks for the key without showing it, or sets ${KEY_ENV} for that one command.`,
      });
    }
    key = (
      await askHidden(streams, 'Resend API key (https://resend.com/api-keys; it is not shown as you type): ')
    ).trim();
  }
  if (!KEY_SHAPE.test(key)) {
    throw new CommsError('BAD_DATA', 'that does not look like a Resend API key (they start with re_)', {
      hint: 'Nothing was stored. Copy the key again from the Resend dashboard.',
    });
  }
  return key;
}
