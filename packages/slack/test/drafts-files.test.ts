import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  linkSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  renameSync,
  symlinkSync,
  truncateSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import { type TestContext, test } from 'node:test';
import { ApprovalStore, asV2, CommsError, UNSENT_WORDS } from '@agentcomms/core';
import { compose } from '../src/compose/blocks.ts';
import { openDraftStore, type SlackDraft } from '../src/compose/drafts.ts';
import { MAX_FILE_BYTES, MAX_FILES, TEST_ONLY_HOOKS } from '../src/compose/files.ts';
import { SlackContext } from '../src/context.ts';
import { createDraft, type DraftView, listDrafts, updateDraft } from '../src/operations/drafts.ts';
import { prepareDraftPost, sendPost } from '../src/operations/post.ts';
import { startFakeSlack } from './support/fake-slack.ts';
import { assertNoBareCommand, coreInlineToFill, slackHandoffs } from './support/handoffs.ts';
import { type Harness, newHarness, tempDir } from './support/harness.ts';

/**
 * Files on a draft: named by a local path, recorded by what they are, and never carried as their bytes.
 *
 * A draft names each file by its real path and records the name it will have in Slack, its size, its SHA-256 and its
 * type — what the preview shows and the approval is bound to, and what is read again and matched before anything is
 * uploaded. Which files may be named at all is the rule Gmail's attachments follow: under the home folder, outside its
 * hidden folders and the rest of the deny list, a regular file named by itself rather than through a link. These are
 * the files it refuses, and the draft it writes when it does not.
 */

const NOW = () => new Date('2026-09-30T12:00:00.000Z');
const posix = process.platform !== 'win32';

async function world(): Promise<{ harness: Harness; context: SlackContext; docs: string }> {
  const harness = await newHarness();
  await harness.addWorkspace({ alias: 'acme', mode: 'send' });
  const context = new SlackContext({ core: harness.core, env: harness.env, now: NOW });
  const docs = join(harness.home, 'docs');
  mkdirSync(docs);
  return { harness, context, docs };
}

function sha256(bytes: string | Buffer): string {
  return createHash('sha256').update(bytes).digest('hex');
}

/** A file under the harness's home, with its real path — which is what a draft records. */
function file(dir: string, name: string, content: string | Buffer): string {
  const path = join(dir, name);
  writeFileSync(path, content);
  return realpathSync.native(path);
}

/** What the draft store holds for a draft, read from disk rather than from what the operation returned. */
function onDisk(harness: Harness, draft: SlackDraft): string {
  return readFileSync(join(harness.core.paths.stateDir, 'slack', 'drafts', `${draft.draftId}.json`), 'utf8');
}

async function refusal(work: Promise<unknown>): Promise<CommsError> {
  try {
    await work;
  } catch (error) {
    assert.ok(error instanceof CommsError, `not a CommsError: ${String(error)}`);
    return error;
  }
  assert.fail('it was not refused');
}

test('one file is recorded by its real path, the name Slack will show, its size, hash and type — never its bytes', async () => {
  const { harness, context, docs } = await world();
  const content = 'the quarterly report, which nobody has read yet';
  const real = file(docs, 'report.pdf', content);

  // Named as a person would name it: from the home folder.
  const draft = await createDraft(context, 'acme', { channel: 'C1', text: 'the report', files: ['~/docs/report.pdf'] });

  assert.deepEqual(draft.files, [
    { path: real, name: 'report.pdf', size: content.length, sha256: sha256(content), mimeType: 'application/pdf' },
  ]);
  // The payload is still exactly what `chat.postMessage` takes: the files sit beside it, not in it.
  assert.deepEqual(draft.payload, compose({ channel: 'C1', text: 'the report' }));
  const stored = onDisk(harness, draft);
  assert.deepEqual(JSON.parse(stored).files, draft.files, 'the draft file holds what the operation returned');
  assert.equal(stored.includes(content), false, 'the file’s bytes were written into the draft');
});

test('several files are recorded in the order given, each typed by its name', async () => {
  const { context, docs } = await world();
  const chart = file(docs, 'chart.PNG', Buffer.from([0x89, 0x50, 0x4e, 0x47, 1, 2, 3]));
  const table = file(docs, 'numbers.csv', 'a,b\n1,2\n');
  const blob = file(docs, 'archive.bin', Buffer.from([0, 0, 0, 1]));
  const notes = file(docs, 'notes', 'no extension at all');

  const draft = await createDraft(context, 'acme', {
    channel: 'C1',
    text: 'the numbers',
    files: [chart, table, blob, notes],
  });
  assert.deepEqual(
    draft.files?.map((recorded) => [recorded.path, recorded.name, recorded.size, recorded.mimeType]),
    [
      [chart, 'chart.PNG', 7, 'image/png'],
      [table, 'numbers.csv', 8, 'text/csv'],
      [blob, 'archive.bin', 4, 'application/octet-stream'],
      [notes, 'notes', 19, 'application/octet-stream'],
    ],
  );
  assert.equal(draft.files?.[1]?.sha256, sha256('a,b\n1,2\n'));
});

test('with files, the text is optional; without them it is not', async () => {
  const { context, docs } = await world();
  const real = file(docs, 'photo.jpg', 'jpeg bytes');

  const quiet = await createDraft(context, 'acme', { channel: 'C1', files: [real] });
  assert.equal(quiet.payload.text, '', 'a file needs no words to go with it');
  assert.equal(quiet.files?.length, 1);

  const nothing = await refusal(createDraft(context, 'acme', { channel: 'C1' }));
  assert.equal(nothing.code, 'USAGE');
  assert.match(nothing.message, /text, files or both/);
  const empty = await refusal(createDraft(context, 'acme', { channel: 'C1', files: [] }));
  assert.equal(empty.code, 'USAGE');

  // A text post is written exactly as it always was: no `files` on it at all.
  const text = await createDraft(context, 'acme', { channel: 'C1', text: 'just words' });
  assert.equal('files' in text, false);
});

test('at most ten files go on one draft, and the eleventh is refused before any is read', async () => {
  const { harness, context, docs } = await world();
  const paths = Array.from({ length: MAX_FILES + 1 }, (_, i) => file(docs, `page-${i}.txt`, `page ${i}`));
  assert.equal(MAX_FILES, 10);

  const eleven = await refusal(createDraft(context, 'acme', { channel: 'C1', text: 'pages', files: paths }));
  assert.equal(eleven.code, 'USAGE');
  assert.match(eleven.message, /at most 10 files/);
  assert.deepEqual(
    await openDraftStore(harness.core.paths.stateDir, NOW, slackHandoffs(harness.core.paths)).list(),
    [],
    'a draft was written anyway',
  );

  const ten = await createDraft(context, 'acme', { channel: 'C1', text: 'pages', files: paths.slice(0, 10) });
  assert.equal(ten.files?.length, 10);
});

test('a file over 100 MiB is refused by its size, without being read', async () => {
  const { harness, context, docs } = await world();
  assert.equal(MAX_FILE_BYTES, 104_857_600);
  // Sparse: the size is the file system's claim, and the refusal comes before a byte of it is read.
  const huge = join(docs, 'huge.mov');
  writeFileSync(huge, '');
  truncateSync(huge, MAX_FILE_BYTES + 1);

  const over = await refusal(createDraft(context, 'acme', { channel: 'C1', text: 'the video', files: [huge] }));
  assert.equal(over.code, 'BAD_DATA');
  assert.match(over.message, /huge\.mov is larger than 100 MiB/);
  assert.deepEqual(
    await openDraftStore(harness.core.paths.stateDir, NOW, slackHandoffs(harness.core.paths)).list(),
    [],
  );

  // The limit itself is allowed.
  truncateSync(huge, MAX_FILE_BYTES);
  const at = await createDraft(context, 'acme', { channel: 'C1', text: 'the video', files: [huge] });
  assert.equal(at.files?.[0]?.size, MAX_FILE_BYTES);
});

test('anything but a regular file under the home folder is refused, and nothing is written', async () => {
  const { harness, context, docs } = await world();
  const ok = file(docs, 'fine.txt', 'fine');
  const refusals: [string, string, RegExp][] = [];

  // A folder.
  refusals.push(['a folder', docs, /not a regular file/]);
  // An empty file: there is nothing to send, and Slack refuses one.
  refusals.push(['an empty file', file(docs, 'empty.txt', ''), /empty\.txt is empty/]);
  // A file that is not there.
  refusals.push(['a missing file', join(docs, 'missing.txt'), /no file at/]);
  // The temp folder, outside every allowed root: `/tmp` on Linux, and on macOS the per-user folder `/tmp` stands for.
  refusals.push(['the temp folder', file(tempDir(), 'scratch.txt', 'scratch'), /outside them/]);
  // A hidden folder in the home: where keys and tokens live.
  mkdirSync(join(harness.home, '.ssh'));
  refusals.push(['~/.ssh', file(join(harness.home, '.ssh'), 'id_ed25519', 'KEY'), /hidden folders in your home/]);

  let linked = false;
  try {
    // A link at the file's own name — even to a file that could be sent — is refused: name the file itself.
    symlinkSync(ok, join(docs, 'alias.txt'));
    linked = true;
  } catch (error) {
    // Windows without the privilege to make links: nothing to test there.
    if ((error as NodeJS.ErrnoException).code !== 'EPERM') throw error;
  }
  if (linked) refusals.push(['a link', join(docs, 'alias.txt'), /is a link/]);
  if (posix) {
    // A FIFO: opening one to read it would wait for a writer that never comes.
    const fifo = join(docs, 'pipe');
    assert.equal(spawnSync('mkfifo', [fifo]).status, 0, 'mkfifo failed');
    refusals.push(['a FIFO', fifo, /not a regular file/]);
  }

  for (const [what, path, message] of refusals) {
    const error = await refusal(createDraft(context, 'acme', { channel: 'C1', text: 'x', files: [ok, path] }));
    assert.match(error.message, message, what);
    assert.notEqual(error.code, 'UNEXPECTED', what);
  }
  assert.deepEqual(
    await openDraftStore(harness.core.paths.stateDir, NOW, slackHandoffs(harness.core.paths)).list(),
    [],
    'a refused file left a draft',
  );
});

test('a file outside the allowed folders is refused with the rule and what to do: copy it, or allow its folder', async () => {
  const { context } = await world();
  const outside = file(tempDir(), 'from-tmp.pdf', 'pdf');
  const error = await refusal(createDraft(context, 'acme', { channel: 'C1', text: 'x', files: [outside] }));
  assert.equal(error.code, 'BAD_DATA');
  assert.match(error.message, /must come from an allowed folder/);
  assert.match(error.hint ?? '', /Copy the file under your home folder/);
  // The command that exists, and that it is the person's to approve — not a setting to edit by hand.
  // Core's command, found through the core Slack has installed, located: never a bare `agentcomms` (CUE-403).
  assert.ok(
    error.hint?.includes(
      `allow its folder with ${coreInlineToFill(context.core.paths, ['attach', 'roots', 'add'], ['<folder>'])} (needs your approval)`,
    ),
    error.hint,
  );
  assertNoBareCommand(error.hint ?? '');
  assert.doesNotMatch(error.hint ?? '', /with the CLI|attachRoots/);
});

test('an update replaces the files or adds to them, and every update is a new revision', async () => {
  const { harness, context, docs } = await world();
  const a = file(docs, 'a.txt', 'a');
  const b = file(docs, 'b.txt', 'bb');
  const c = file(docs, 'c.txt', 'ccc');
  const first = await createDraft(context, 'acme', { channel: 'C1', text: 'files', files: [a] });

  const replaced = await updateDraft(context, 'acme', first.draftId, { files: [b] });
  assert.deepEqual(
    replaced.files?.map((recorded) => recorded.path),
    [b],
  );
  assert.notEqual(replaced.revision, first.revision, 'replacing the files kept the revision an approval is bound to');

  const added = await updateDraft(context, 'acme', first.draftId, { addFiles: [c, a] });
  assert.deepEqual(
    added.files?.map((recorded) => recorded.path),
    [b, c, a],
  );
  assert.notEqual(added.revision, replaced.revision);

  // An update that touches only the words keeps the files as they were recorded — and is a new revision all the same.
  const worded = await updateDraft(context, 'acme', first.draftId, { text: 'the three files' });
  assert.deepEqual(worded.files, added.files);
  assert.equal(worded.payload.text, 'the three files');
  assert.notEqual(worded.revision, added.revision);

  // Even an update that changes nothing is a new revision: an approval is bound to the revision, not to the content.
  const same = await updateDraft(context, 'acme', first.draftId, { text: 'the three files' });
  assert.notEqual(same.revision, worded.revision);

  // What is on disk is what came back.
  assert.equal(JSON.parse(onDisk(harness, same)).revision, same.revision);
});

test('an update that would go past a limit, or name a file that is refused, changes nothing', async () => {
  const { context, docs } = await world();
  const many = Array.from({ length: 9 }, (_, i) => file(docs, `n-${i}.txt`, `n${i}`));
  const draft = await createDraft(context, 'acme', { channel: 'C1', text: 'nine', files: many });

  const tooMany = await refusal(
    updateDraft(context, 'acme', draft.draftId, {
      addFiles: [file(docs, 'ten.txt', '10'), file(docs, 'eleven.txt', '11')],
    }),
  );
  assert.equal(tooMany.code, 'USAGE');
  assert.match(tooMany.message, /at most 10 files/);

  const hidden = join(docs, '.env');
  writeFileSync(hidden, 'SECRET=1');
  await refusal(updateDraft(context, 'acme', draft.draftId, { addFiles: [hidden] }));

  // Taking every file off a draft with no words would leave nothing to post.
  const bare = await createDraft(context, 'acme', { channel: 'C1', files: [many[0] as string] });
  const nothing = await refusal(updateDraft(context, 'acme', bare.draftId, { files: [] }));
  assert.equal(nothing.code, 'USAGE');

  const store = openDraftStore(context.core.paths.stateDir, NOW, context.handoffs);
  assert.equal((await store.get(draft.draftId)).revision, draft.revision, 'a refused update was saved');
  assert.equal((await store.get(bare.draftId)).revision, bare.revision, 'a refused update was saved');
});

test('an update changes the fields it is given and keeps the rest, mentions included', async () => {
  const { context, docs } = await world();
  const draft = await createDraft(context, 'acme', {
    channel: 'C1',
    text: 'deploy at 5',
    threadTs: '1700000000.000100',
    mentionUsers: ['U024BE7LH'],
    broadcast: 'here',
    files: [file(docs, 'plan.md', '# plan')],
  });

  const retexted = await updateDraft(context, 'acme', draft.draftId, { text: 'deploy at 6 & not before' });
  assert.deepEqual(
    retexted.payload,
    compose({
      channel: 'C1',
      text: 'deploy at 6 & not before',
      threadTs: '1700000000.000100',
      mentions: [
        { kind: 'user', id: 'U024BE7LH' },
        { kind: 'broadcast', who: 'here' },
      ],
    }),
  );
  assert.equal(retexted.source, 'deploy at 6 & not before');
  assert.deepEqual(retexted.files, draft.files);

  const moved = await updateDraft(context, 'acme', draft.draftId, {
    channel: 'C2',
    threadTs: '1700000000.000900',
    mentionUsers: [],
    broadcast: 'channel',
  });
  assert.deepEqual(
    moved.payload,
    compose({
      channel: 'C2',
      text: 'deploy at 6 & not before',
      threadTs: '1700000000.000900',
      mentions: [{ kind: 'broadcast', who: 'channel' }],
    }),
  );

  // Checked as creating is: a mention that is not a user id is refused, and nothing is saved.
  const bad = await refusal(updateDraft(context, 'acme', draft.draftId, { mentionUsers: ['@sam'] }));
  assert.equal(bad.code, 'USAGE');
});

test('an update reaches only this workspace’s drafts, and not one changed outside agent-slack', async () => {
  const { harness, context } = await world();
  await harness.addWorkspace({ alias: 'other', workspaceId: 'T0002' });
  const theirs = await createDraft(context, 'other', { channel: 'C9', text: 'theirs' });
  const absent = await refusal(updateDraft(context, 'acme', theirs.draftId, { text: 'mine now' }));
  assert.equal(absent.code, 'NOT_FOUND');

  // A draft whose blocks say something its text does not is refused here as the gate refuses it.
  const store = openDraftStore(harness.core.paths.stateDir, NOW, slackHandoffs(harness.core.paths));
  const mine = await createDraft(context, 'acme', { channel: 'C1', text: 'hello' });
  await store.update(
    mine.draftId,
    { ...mine.payload, blocks: [{ type: 'section', text: { type: 'mrkdwn', text: '<!channel>' } }] },
    'hello',
  );
  const edited = await refusal(updateDraft(context, 'acme', mine.draftId, { text: 'hello again' }));
  assert.equal(edited.code, 'BAD_DATA');
  assert.equal(edited.details?.reason, 'not-composed');
});

// ── A file that moves while it is read ────────────────────────────────────────────────────────────────────────

/**
 * Runs `hook` once, at `moment` of the next read of a file, and clears it however the test ends.
 *
 * The hooks sit between the steps of one read: `beforeOpen` after the name was looked at and judged and before it is
 * opened, `afterRead` after the bytes were read and before the name is looked at again. What a test does there is what
 * something racing the read could do.
 */
function once(t: TestContext, moment: 'beforeOpen' | 'afterRead', hook: (path: string) => void): void {
  TEST_ONLY_HOOKS[moment] = (path) => {
    delete TEST_ONLY_HOOKS[moment];
    hook(path);
  };
  t.after(() => {
    delete TEST_ONLY_HOOKS[moment];
  });
}

/** Puts another file with the same bytes where `path` is: the same contents, but not the file that was looked at. */
function replaceWithTwin(path: string): void {
  const twin = `${path}.twin`;
  writeFileSync(twin, readFileSync(path));
  renameSync(twin, path);
}

/** Moves `dir` aside and puts a link to `elsewhere` in its place, or says it cannot here. */
function swapForLink(dir: string, elsewhere: string): boolean {
  renameSync(dir, `${dir}.was`);
  try {
    symlinkSync(elsewhere, dir, process.platform === 'win32' ? 'junction' : 'dir');
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EPERM') throw error;
    renameSync(`${dir}.was`, dir);
    return false;
  }
}

test('a file replaced between being judged and being opened is refused: it moved while it was being read', async (t) => {
  const { context, docs } = await world();
  const real = file(docs, 'plan.md', '# plan');
  once(t, 'beforeOpen', replaceWithTwin);
  const error = await refusal(createDraft(context, 'acme', { channel: 'C1', files: [real] }));
  assert.equal(error.code, 'BAD_DATA');
  assert.match(error.message, /plan\.md moved while it was being read/);
});

test('a file replaced while it was being read is refused as well', async (t) => {
  const { context, docs } = await world();
  const real = file(docs, 'plan.md', '# plan');
  once(t, 'afterRead', replaceWithTwin);
  const error = await refusal(createDraft(context, 'acme', { channel: 'C1', files: [real] }));
  assert.match(error.message, /plan\.md moved while it was being read/);
});

test('a folder above the file swapped for a link to somewhere else, just before it is opened, is refused', async (t) => {
  /*
   * The jail judged the path through its real folders; `O_NOFOLLOW` guards only the file's own name, and Windows has
   * no such flag. So the folder is swapped for a link to another folder holding a file of the same name, after the
   * judging and before the opening — and what is opened is the other file.
   */
  const { context, docs, harness } = await world();
  const inner = join(docs, 'inner');
  mkdirSync(inner);
  const real = file(inner, 'plan.md', '# plan');
  const other = join(harness.home, 'other');
  mkdirSync(other);
  writeFileSync(join(other, 'plan.md'), '# plan');
  let swapped = true;
  once(t, 'beforeOpen', () => {
    swapped = swapForLink(inner, other);
  });
  const outcome = await createDraft(context, 'acme', { channel: 'C1', files: [real] }).then(
    () => 'recorded',
    (error: unknown) => error,
  );
  if (!swapped) return t.skip('links cannot be made here');
  assert.ok(outcome instanceof CommsError, `it was ${String(outcome)}`);
  assert.match(outcome.message, /plan\.md moved while it was being read/);
});

test('a folder above the file swapped while it was read, for a link to a hard link of the same file, is refused', async (t) => {
  /*
   * The same file, by its identity — a hard link is one file under two names — reached by another path. Only the real
   * path, looked up again after the read, tells it from the file that was judged.
   */
  const { context, docs, harness } = await world();
  const inner = join(docs, 'inner');
  mkdirSync(inner);
  const real = file(inner, 'plan.md', '# plan');
  const other = join(harness.home, 'other');
  mkdirSync(other);
  linkSync(real, join(other, 'plan.md'));
  let swapped = true;
  once(t, 'afterRead', () => {
    swapped = swapForLink(inner, other);
  });
  const outcome = await createDraft(context, 'acme', { channel: 'C1', files: [real] }).then(
    () => 'recorded',
    (error: unknown) => error,
  );
  if (!swapped) return t.skip('links cannot be made here');
  assert.ok(outcome instanceof CommsError, `it was ${String(outcome)}`);
  assert.match(outcome.message, /plan\.md moved while it was being read/);
});

test('a file nothing moves is recorded as before, with the hooks in place and doing nothing', async (t) => {
  const { context, docs } = await world();
  const real = file(docs, 'plan.md', '# plan');
  let seen = 0;
  once(t, 'beforeOpen', () => {
    seen += 1;
  });
  const draft = await createDraft(context, 'acme', { channel: 'C1', files: [real] });
  assert.equal(seen, 1);
  assert.equal(draft.files?.[0]?.path, real);
});

test('a file swapped for another just before it is opened, and put back once it is read, is refused', async (t) => {
  /*
   * Afterwards the name leads to the right file again, by its real path, so looking at it after the read sees nothing
   * wrong. Only the open file itself — which file the bytes came from — gives it away.
   */
  const { context, docs } = await world();
  const real = file(docs, 'plan.md', '# plan');
  once(t, 'beforeOpen', (path) => {
    renameSync(path, `${path}.aside`);
    writeFileSync(path, '# plan');
  });
  once(t, 'afterRead', (path) => {
    renameSync(`${path}.aside`, path);
  });
  const error = await refusal(createDraft(context, 'acme', { channel: 'C1', files: [real] }));
  assert.match(error.message, /plan\.md moved while it was being read/);
});

test('a stored draft with more files than a post may carry is refused when it is read, as a damaged draft is', async () => {
  /*
   * The limit is checked when files are named, and a draft file is JSON anything with a shell can edit. Eleven
   * well-formed records are no more sendable for having got there another way.
   */
  const { harness, context, docs } = await world();
  const paths = Array.from({ length: MAX_FILES }, (_, i) => file(docs, `page-${i}.txt`, `page ${i}`));
  const draft = await createDraft(context, 'acme', { channel: 'C1', text: 'pages', files: paths });
  const stored = JSON.parse(onDisk(harness, draft)) as { files: unknown[] };
  writeFileSync(
    join(harness.core.paths.stateDir, 'slack', 'drafts', `${draft.draftId}.json`),
    `${JSON.stringify({ ...stored, files: [...stored.files, stored.files[0]] }, null, 2)}\n`,
  );

  const store = openDraftStore(harness.core.paths.stateDir, NOW, slackHandoffs(harness.core.paths));
  const error = await refusal(store.get(draft.draftId));
  assert.equal(error.code, 'BAD_DATA');
  assert.equal(error.details?.reason, 'unreadable');
  assert.match(error.message, /could not be read/);
  // Preparing it, updating it or showing it meets the same refusal; deleting it still works.
  await refusal(updateDraft(context, 'acme', draft.draftId, { text: 'fewer pages' }));
  assert.deepEqual(await store.list(), [], 'a draft that cannot be read was listed');
});

// ── Where a draft's current revision stands (CUE-404 Task 22; design 2026-10-05 §D9) ──────────────────────────────

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const TS = '1700000000.000100';

/**
 * A workspace that posts under `chat` to a Slack that takes posts, with the approval store and the drafts on one clock
 * of the test's own: an approval lapses, and retention comes due, when the test says.
 */
async function posting(t: TestContext) {
  const harness = await newHarness();
  await harness.addWorkspace({ alias: 'acme', mode: 'send' });
  const fake = await startFakeSlack({
    'conversations.info': () => ({ ok: true, channel: { id: 'C1', name: 'eng', num_members: 4, is_member: true } }),
    'chat.postMessage': () => ({ ok: true, ts: TS }),
  });
  t.after(() => fake.close());
  const clock = { t: Math.floor(Date.now() / 1000) * 1000 };
  const now = () => new Date(clock.t);
  harness.core.approvals = new ApprovalStore(harness.core.paths.stateDir, {
    now,
    handoffs: harness.core.handoffs,
    loadConfig: () => harness.core.config.load(),
    audit: harness.core.audit,
  });
  const context = new SlackContext({ core: harness.core, env: harness.env, now, surface: 'mcp' });
  const prepare = (request: { draftId: string } | { channel: string; text: string }) =>
    prepareDraftPost(context, 'acme', request, { fetch: fake.fetch });
  const post = (draftId: string, approvalId: string) =>
    sendPost(context, 'acme', { draftId, approvalId, expectChannel: 'C1' }, { fetch: fake.fetch });
  const record = async (approvalId: string) => {
    const found = asV2(await harness.core.approvals.get(approvalId));
    assert.ok(found, `approval ${approvalId} is a version-2 record`);
    return found;
  };
  return { harness, context, clock, prepare, post, record };
}

/** What `draft list` says of each draft's current revision, by draft. */
async function annotated(context: SlackContext): Promise<Record<string, DraftView['unsent']>> {
  return Object.fromEntries((await listDrafts(context, 'acme')).map((view) => [view.draftId, view.unsent]));
}

test('revision A posted, then revision B — identical content — prepared and lapsed: the list reports B, which A never hides (D9e-i)', async (t) => {
  const { context, clock, prepare, post, record } = await posting(t);
  const a = await prepare({ channel: 'C1', text: 'the report' });
  await post(a.draftId, a.approvalId);
  clock.t += MINUTE;
  // Saved again with the same words: a new revision, which no approval made before it covers.
  const saved = await updateDraft(context, 'acme', a.draftId, { text: 'the report' });
  const b = await prepare({ draftId: a.draftId });
  clock.t += HOUR;
  const [first, second] = [await record(a.approvalId), await record(b.approvalId)];
  assert.equal(first.state, 'used');
  assert.equal(first.contentDigest, second.contentDigest, 'the two revisions post identical content');
  assert.notEqual(first.draftMessageId, second.draftMessageId);
  assert.equal(second.draftMessageId, saved.revision);

  const shown = (await annotated(context))[a.draftId];
  assert.deepEqual(
    shown?.map((entry) => [entry.status, entry.said, entry.evidence, entry.last.approvalId]),
    [['unsent', UNSENT_WORDS.complete, 'complete-90-days', b.approvalId]],
  );
  assert.doesNotMatch(JSON.stringify(shown), new RegExp(a.approvalId), 'revision A’s post is not this revision’s');
});

test('the inverse: revision B prepared and lapsed, then revision A — identical content — posted: the list reports A as used, which B never hides (D9e-i)', async (t) => {
  const { context, clock, prepare, post } = await posting(t);
  const b = await prepare({ channel: 'C1', text: 'the report' });
  clock.t += HOUR;
  await updateDraft(context, 'acme', b.draftId, { text: 'the report' });
  const a = await prepare({ draftId: b.draftId });
  await post(a.draftId, a.approvalId);
  clock.t += MINUTE;

  const shown = (await annotated(context))[b.draftId];
  assert.equal(shown?.length, 1);
  assert.equal(shown?.[0]?.status, 'used');
  assert.equal(shown?.[0]?.decidedBy, a.approvalId);
  assert.match(shown?.[0]?.said ?? '', new RegExp(`^used with approval ${a.approvalId}: accepted by Slack at `));
  assert.doesNotMatch(JSON.stringify(shown), new RegExp(`${b.approvalId}|${UNSENT_WORDS.complete}`));
  // A draft with nothing prepared says nothing.
  const quiet = await createDraft(context, 'acme', { channel: 'C1', text: 'not yet' });
  assert.equal((await annotated(context))[quiet.draftId], undefined);
});

test('a posted revision pruned at its 90-day boundary, then prepared again unchanged and lapsed: only the 90-day words, never an all-time claim (D9e-j)', async (t) => {
  const { harness, context, clock, prepare, post, record } = await posting(t);
  const r = await prepare({ channel: 'C1', text: 'the report' });
  await post(r.draftId, r.approvalId);
  const used = await record(r.approvalId);
  assert.equal(used.state, 'used');

  // Ninety days and more on, the same exact revision and digest is prepared again: the day's retention runs first.
  clock.t += 91 * DAY;
  const again = await harness.core.approvals.create({
    channel: 'slack',
    inboxId: used.inboxId,
    inboxSub: used.inboxSub,
    draftId: used.draftId,
    draftMessageId: used.draftMessageId,
    contentDigest: used.contentDigest,
    sendEpoch: used.sendEpoch ?? 0,
    policy: 'chat',
    requiredPolicy: 'chat',
    riskFlags: [],
    expect: used.expect,
  });
  assert.equal(await harness.core.approvals.get(r.approvalId), null, 'the used record was kept 90 days, then pruned');
  const retained = (await harness.core.audit.tail({ limit: 50 })).filter(
    (row) => row.operation === 'approval.retained',
  );
  assert.equal(retained.length, 1, 'its terminal history stays in the audit log');
  clock.t += HOUR;

  const shown = (await annotated(context))[r.draftId];
  assert.deepEqual(
    shown?.map((entry) => [entry.status, entry.said, entry.evidence, entry.last.approvalId]),
    [['unsent', 'not sent with any approval in the last 90 days', 'complete-90-days', again.approvalId]],
  );
  assert.doesNotMatch(JSON.stringify(shown), /\bnever\b|\bever\b|all-time/);
});
