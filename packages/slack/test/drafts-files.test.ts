import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, realpathSync, symlinkSync, truncateSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { CommsError } from '@agentcomms/core';
import { compose } from '../src/compose/blocks.ts';
import { openDraftStore, type SlackDraft } from '../src/compose/drafts.ts';
import { MAX_FILE_BYTES, MAX_FILES } from '../src/compose/files.ts';
import { SlackContext } from '../src/context.ts';
import { createDraft, updateDraft } from '../src/operations/drafts.ts';
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
  assert.deepEqual(await openDraftStore(harness.core.paths.stateDir, NOW).list(), [], 'a draft was written anyway');

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
  assert.deepEqual(await openDraftStore(harness.core.paths.stateDir, NOW).list(), []);

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
  assert.deepEqual(await openDraftStore(harness.core.paths.stateDir, NOW).list(), [], 'a refused file left a draft');
});

test('a file outside the allowed folders is refused with the rule and what to do, not with a command that is not there', async () => {
  const { context } = await world();
  const outside = file(tempDir(), 'from-tmp.pdf', 'pdf');
  const error = await refusal(createDraft(context, 'acme', { channel: 'C1', text: 'x', files: [outside] }));
  assert.equal(error.code, 'BAD_DATA');
  assert.match(error.message, /must come from an allowed folder/);
  assert.match(error.hint ?? '', /Copy the file under your home folder/);
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

  const store = openDraftStore(context.core.paths.stateDir, NOW);
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
  const store = openDraftStore(harness.core.paths.stateDir, NOW);
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
