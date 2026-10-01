import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { PassThrough } from 'node:stream';
import { test } from 'node:test';
import { run } from '../src/cli/program.ts';
import { GmailContext } from '../src/context.ts';
import { clientAdd } from '../src/operations/clients.ts';
import { importLegacy } from '../src/operations/import-legacy.ts';
import { CONSOLE_STEPS } from '../src/operations/setup.ts';
import { type Harness, newHarness, TEST_CLIENT_ID, TEST_CLIENT_SECRET } from './support/harness.ts';

/**
 * `agent-gmail setup` at a terminal, from the client file's point of view (CUE-298).
 *
 * A person reported two things. The client JSON they had just downloaded was not found — the step asked for a typed
 * path and could not look again — and after stopping, the next run walked the five Google Cloud steps from 1/5. Both
 * are about what the command does between prompts, so these drive the whole command with streams that are a
 * terminal, answer each prompt as it appears, and put files into the download directory at the moment a person would.
 *
 * Each run ends at the client registration's approval, by pressing Enter to cancel it: the case is decided by then,
 * and the project the preview names is the one in the file the step settled on.
 */

/** Each fixture names its own project, which is what the registration's preview shows: it says which file was read. */
const client = (kind: 'installed' | 'web', project: string) => ({
  [kind]: { client_id: TEST_CLIENT_ID, client_secret: TEST_CLIENT_SECRET, project_id: project },
});
const DESKTOP = client('installed', 'proj-desktop');
const WEB = client('web', 'proj-web');
const ELSEWHERE = client('installed', 'proj-elsewhere');
/** The registration's preview, naming the project of the client file the step settled on. */
const registers = (dialog: Dialog, project: string) =>
  assert.ok(
    dialog.stdout.includes(`from the Google Cloud project ${project} `),
    `the registration is not for ${project}:\n${dialog.stdout}`,
  );
const DESKTOP_FILE = 'client_secret_desktop.apps.googleusercontent.com.json';

const downloadsOf = (harness: Harness) => join(String(harness.env.HOME), 'Downloads');
const progressOf = (harness: Harness) => join(harness.core.paths.stateDir, 'gmail-setup-progress.json');

async function drop(harness: Harness, name: string, body: unknown): Promise<string> {
  await mkdir(downloadsOf(harness), { recursive: true });
  const path = join(downloadsOf(harness), name);
  await writeFile(path, JSON.stringify(body));
  return path;
}

/** The prompts a plain terminal run asks, in order. Each ends where the person types. */
const PROMPT_END = /(?:— |\] |: )$/;

interface Dialog {
  code: number;
  stdout: string;
  stderr: string;
  /** Every prompt answered, in order, as it read when it was answered. */
  asked: string[];
}

/**
 * Runs setup as a person at a plain terminal, answering each prompt with what `answer` returns for it. `answer` sees
 * the text since the last answer, so it can tell a step's header from the prompt under it.
 */
async function setupAtTerminal(
  harness: Harness,
  argv: string[],
  answer: (prompt: string, index: number) => string | Promise<string>,
): Promise<Dialog> {
  const input = new PassThrough();
  const err = new PassThrough();
  const out = new PassThrough();
  let stdout = '';
  let stderr = '';
  let pending = '';
  const asked: string[] = [];
  out.on('data', (chunk) => {
    stdout += String(chunk);
  });
  let answering = Promise.resolve();
  err.on('data', (chunk) => {
    const text = String(chunk);
    stderr += text;
    pending += text;
    if (!PROMPT_END.test(pending)) return;
    const prompt = pending;
    pending = '';
    asked.push(prompt);
    const index = asked.length - 1;
    // In order, and one at a time: an answer may write a file before it types.
    answering = answering.then(async () => {
      if (asked.length > 40) throw new Error(`setup kept asking:\n${asked.slice(-3).join('\n---\n')}`);
      input.write(`${await answer(prompt, index)}\n`);
    });
  });
  const code = await run(['setup', '--no-tui', '--no-browser', ...argv], {
    env: harness.env,
    streams: {
      stdout: Object.assign(out, { isTTY: true }),
      stderr: Object.assign(err, { isTTY: true }),
      stdin: Object.assign(input, { isTTY: true }),
    },
  });
  await answering;
  return { code, stdout, stderr, asked };
}

/** The number a plain list gives the entry whose label contains `label`. */
function pick(prompt: string, label: string): string {
  const line = prompt.split('\n').find((entry) => /^\s+\d+\) /.test(entry) && entry.includes(label));
  assert.ok(line, `no entry "${label}" in:\n${prompt}`);
  return String(/(\d+)\)/.exec(line)?.[1]);
}

const walked = (dialog: Dialog) =>
  CONSOLE_STEPS.flatMap((step, index) =>
    dialog.stderr.includes(`${index + 1}/${CONSOLE_STEPS.length}  ${step.title}`) ? [index + 1] : [],
  );

/** A typed path that does not exist ends a run that went wrong, instead of leaving it asking for ever. */
const NOWHERE = '/nonexistent/client_secret_nowhere.json';

test('a client file downloaded during the walk is offered at the client step', async () => {
  const harness = await newHarness();
  let path = '';
  const dialog = await setupAtTerminal(harness, [], async (prompt) => {
    // The last console step is the download. The file arrives while it is on screen, as it does for a person.
    if (prompt.includes(`${CONSOLE_STEPS.length}/${CONSOLE_STEPS.length}  `))
      path = await drop(harness, DESKTOP_FILE, DESKTOP);
    if (/No client file in/.test(prompt)) return NOWHERE;
    if (/which one\?/.test(prompt)) return pick(prompt, DESKTOP_FILE);
    return '';
  });
  assert.deepEqual(walked(dialog), [1, 2, 3, 4, 5]);
  assert.match(dialog.stderr, /Which client file\?/);
  assert.doesNotMatch(dialog.stderr, /No client file in/);
  assert.ok(path, 'the walk never reached its last step');
  registers(dialog, 'proj-desktop');
});

test('an empty answer to the path looks again, and a file found then is offered', async () => {
  const harness = await newHarness();
  let looked = 0;
  const dialog = await setupAtTerminal(harness, [], async (prompt) => {
    if (/No client file in ~[\\/]Downloads yet/.test(prompt)) {
      looked++;
      if (looked > 1) return NOWHERE;
      // Still downloading when the step asked. Enter, once it has arrived.
      await drop(harness, DESKTOP_FILE, DESKTOP);
      return '';
    }
    if (/which one\?/.test(prompt)) return pick(prompt, DESKTOP_FILE);
    return '';
  });
  assert.equal(looked, 1, 'the empty answer did not look again');
  registers(dialog, 'proj-desktop');
});

test('"Look again" in the list finds a file that arrived after the list was drawn', async () => {
  const harness = await newHarness();
  let lists = 0;
  const dialog = await setupAtTerminal(harness, [], async (prompt) => {
    if (prompt.includes(`${CONSOLE_STEPS.length}/${CONSOLE_STEPS.length}  `))
      await drop(harness, 'client_secret_web.json', WEB);
    if (/No client file in/.test(prompt)) return NOWHERE;
    if (/which one\?/.test(prompt)) {
      lists++;
      if (lists === 1) {
        // Only the Web client so far — the wrong kind. The Desktop one lands, and the person asks to look again.
        assert.ok(!prompt.includes(DESKTOP_FILE));
        await drop(harness, DESKTOP_FILE, DESKTOP);
        return pick(prompt, 'Look again');
      }
      return pick(prompt, DESKTOP_FILE);
    }
    return '';
  });
  assert.equal(lists, 2);
  registers(dialog, 'proj-desktop');
});

test('a run stopped partway resumes from the step after the last one confirmed', async () => {
  const harness = await newHarness();
  // The first run: three steps confirmed, then the step-4 prompt is where it stops.
  const first = await setupAtTerminal(harness, [], (prompt) => {
    if (prompt.includes(`4/${CONSOLE_STEPS.length}  `)) {
      assert.equal(JSON.parse(readFileSync(progressOf(harness), 'utf8')).consoleStep, 3);
    }
    if (/No client file in/.test(prompt)) return NOWHERE;
    return '';
  });
  assert.notEqual(first.code, 0);

  // The record says how far the walk got; the next run offers to carry on from there, and does when told to.
  await writeFile(progressOf(harness), JSON.stringify({ consoleStep: 3, at: new Date().toISOString() }));
  const second = await setupAtTerminal(harness, [], (prompt) => {
    if (/You confirmed Google Cloud step 3\/5/.test(prompt)) return pick(prompt, 'Continue from step 4/5');
    if (/No client file in/.test(prompt)) return NOWHERE;
    return '';
  });
  assert.deepEqual(walked(second), [4, 5]);
  assert.match(second.stderr, /You confirmed Google Cloud step 3\/5 \(Branding\)/);
});

test('starting over from a recorded step walks every step again', async () => {
  const harness = await newHarness();
  await mkdir(harness.core.paths.stateDir, { recursive: true });
  await writeFile(progressOf(harness), JSON.stringify({ consoleStep: 2, at: new Date().toISOString() }));
  const dialog = await setupAtTerminal(harness, [], (prompt) => {
    if (/You confirmed Google Cloud step 2\/5/.test(prompt)) return pick(prompt, 'Start over from 1/5');
    if (/No client file in/.test(prompt)) return NOWHERE;
    return '';
  });
  assert.deepEqual(walked(dialog), [1, 2, 3, 4, 5]);
});

test('a record that does not describe a step is no record: the walk starts at 1/5 without asking', async () => {
  for (const record of [
    '{not json',
    JSON.stringify({ consoleStep: 9, at: new Date().toISOString() }),
    JSON.stringify({ consoleStep: 2, at: 'yesterday' }),
  ]) {
    const harness = await newHarness();
    await mkdir(harness.core.paths.stateDir, { recursive: true });
    await writeFile(progressOf(harness), record);
    const dialog = await setupAtTerminal(harness, [], (prompt) => (/No client file in/.test(prompt) ? NOWHERE : ''));
    assert.doesNotMatch(dialog.stderr, /You confirmed Google Cloud step/, `offered to resume from ${record}`);
    assert.deepEqual(walked(dialog), [1, 2, 3, 4, 5]);
  }
});

test('a state directory that cannot be written costs the resume, not the setup', async () => {
  const harness = await newHarness();
  // A file where the state directory should be: every write under it fails.
  await mkdir(join(harness.core.paths.stateDir, '..'), { recursive: true });
  await writeFile(harness.core.paths.stateDir, 'not a directory');
  const dialog = await setupAtTerminal(harness, [], (prompt) => (/No client file in/.test(prompt) ? NOWHERE : ''));
  assert.deepEqual(walked(dialog), [1, 2, 3, 4, 5]);
  assert.match(dialog.stderr, /No client file in/, 'the walk did not reach the client step');
});

test('a Desktop client file already downloaded is offered in place of the walk', async () => {
  const harness = await newHarness();
  await drop(harness, DESKTOP_FILE, DESKTOP);
  const dialog = await setupAtTerminal(harness, [], (prompt) => {
    if (/Downloading it is the last Google Cloud step/.test(prompt))
      return pick(prompt, 'Use it, and skip the Google Cloud steps');
    if (/No client file in/.test(prompt)) return NOWHERE;
    return '';
  });
  assert.deepEqual(walked(dialog), []);
  assert.doesNotMatch(dialog.stderr, /Which client file\?/, 'the file it offered was asked about a second time');
  registers(dialog, 'proj-desktop');
});

test('a downloaded file and a recorded step are offered together, and either way on can be taken', async () => {
  const harness = await newHarness();
  await drop(harness, DESKTOP_FILE, DESKTOP);
  await mkdir(harness.core.paths.stateDir, { recursive: true });
  await writeFile(progressOf(harness), JSON.stringify({ consoleStep: 3, at: new Date().toISOString() }));
  let offer = '';
  const dialog = await setupAtTerminal(harness, [], (prompt) => {
    if (/Downloading it is the last Google Cloud step/.test(prompt)) {
      offer = prompt;
      // An old file lying around, perhaps: the person carries on with the walk where they left it instead.
      return pick(prompt, 'Continue from step 4/5');
    }
    if (/which one\?/.test(prompt)) return pick(prompt, DESKTOP_FILE);
    if (/No client file in/.test(prompt)) return NOWHERE;
    return '';
  });
  assert.match(offer, /You confirmed Google Cloud step 3\/5/);
  for (const label of ['Use it, and skip', 'choose a file', 'Continue from step 4/5', 'Start over from 1/5'])
    assert.ok(offer.includes(label), `"${label}" is not offered:\n${offer}`);
  assert.deepEqual(walked(dialog), [4, 5]);
});

test('a single downloaded file can be passed over for another, without walking the steps', async () => {
  const harness = await newHarness();
  await drop(harness, DESKTOP_FILE, DESKTOP);
  let lists = 0;
  const dialog = await setupAtTerminal(harness, [], async (prompt) => {
    if (/Downloading it is the last Google Cloud step/.test(prompt)) {
      // The one they meant is still downloading.
      await drop(harness, 'client_secret_newer.apps.googleusercontent.com.json', ELSEWHERE);
      return pick(prompt, 'choose a file');
    }
    if (/which one\?/.test(prompt)) {
      lists++;
      return pick(prompt, 'client_secret_newer');
    }
    if (/No client file in/.test(prompt)) return NOWHERE;
    return '';
  });
  assert.equal(lists, 1);
  assert.deepEqual(walked(dialog), []);
  registers(dialog, 'proj-elsewhere');
});

test('registering a client any other way removes the walk record too', async () => {
  const harness = await newHarness();
  await mkdir(harness.core.paths.stateDir, { recursive: true });
  await writeFile(progressOf(harness), JSON.stringify({ consoleStep: 4, at: new Date().toISOString() }));
  const path = await drop(harness, 'elsewhere.json', ELSEWHERE);
  // `client add`, `gmail_client_add` and a headless `setup --client-json` all register through this one operation.
  await clientAdd(new GmailContext({ core: harness.core, env: harness.env }), { path, noProbe: true });
  assert.equal(existsSync(progressOf(harness)), false, 'the walk record outlived a registration made outside setup');
});

test("importing another server's client removes the walk record as well", async () => {
  const harness = await newHarness();
  await mkdir(harness.core.paths.stateDir, { recursive: true });
  await writeFile(progressOf(harness), JSON.stringify({ consoleStep: 2, at: new Date().toISOString() }));
  // `inbox import` registers the other server's client without going through `client add`.
  const directory = join(String(harness.env.HOME), '.gmail-mcp');
  await mkdir(directory, { recursive: true });
  await writeFile(join(directory, 'gcp-oauth.keys.json'), JSON.stringify(DESKTOP));
  await importLegacy(new GmailContext({ core: harness.core, env: harness.env }), { dir: directory, store: 'file' });
  assert.ok(Object.keys((await harness.core.config.load()).clients).length > 0, 'the import registered no client');
  assert.equal(existsSync(progressOf(harness)), false, 'the walk record outlived the import');
});

test('--client-json puts the file in hand, so the walk is not shown', async () => {
  const harness = await newHarness();
  const path = await drop(harness, 'elsewhere.json', ELSEWHERE);
  const dialog = await setupAtTerminal(harness, ['--client-json', path], () => '');
  assert.deepEqual(walked(dialog), []);
  registers(dialog, 'proj-elsewhere');
});

test('the walk record is removed once a client is registered', async () => {
  const harness = await newHarness();
  await mkdir(harness.core.paths.stateDir, { recursive: true });
  await writeFile(progressOf(harness), JSON.stringify({ consoleStep: 5, at: new Date().toISOString() }));
  const path = await drop(harness, 'elsewhere.json', ELSEWHERE);
  // Registered for real this time — the approval answered with its code — and stopped at the mailbox step by a
  // name that version 1 refuses.
  await setupAtTerminal(harness, ['--client-json', path, '--inbox', 'not a name'], (prompt) => {
    const code = /Type (\S+) to (?:apply|approve) this change/.exec(prompt);
    return code ? String(code[1]) : '';
  });
  assert.ok((await harness.core.config.load()).clients.desktop, 'the client was not registered');
  assert.equal(existsSync(progressOf(harness)), false, 'the walk record outlived the registration');
});
