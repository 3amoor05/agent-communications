import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdirSync, realpathSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { PassThrough } from 'node:stream';
import { type TestContext, test } from 'node:test';
import { run } from '../src/cli/program.ts';
import { type FakeSlack, startFakeSlack } from './support/fake-slack.ts';
import { type Harness, newHarness } from './support/harness.ts';

/**
 * Files from a terminal: `draft create --file`, `draft update`, `post prepare` and `post send`.
 *
 * The commands run the operations the tools run (see `mcp-files.test.ts`), against a loopback Slack of both hosts
 * through the real guard, so what is checked here is what a person at a terminal reads and what the command hands a
 * script with `--json`: the files on the draft, the files in the preview, and the files and the ts once posted.
 */

interface Envelope<T> {
  ok: boolean;
  data?: T;
  error?: { code: string; message: string; hint?: string; details?: Record<string, unknown> };
}

interface DraftFile {
  path: string;
  name: string;
  size: number;
  sha256: string;
  mimeType: string;
}

interface Drafted {
  draftId: string;
  revision: string;
  payload: { text: string; channel: string };
  files?: DraftFile[];
}

async function world(t: TestContext, options: { ts?: string | null } = {}) {
  const harness = await newHarness();
  await harness.addWorkspace({ alias: 'acme', mode: 'send' });
  const fake = await startFakeSlack({
    'conversations.info': () => ({ ok: true, channel: { id: 'C1', name: 'eng', num_members: 4, is_member: true } }),
  });
  t.after(() => fake.close());
  const uploads = fake.acceptUploads(options.ts === undefined ? {} : { ts: options.ts });
  const docs = join(harness.home, 'docs');
  mkdirSync(docs);
  return { harness, fake, uploads, docs };
}

async function cli(harness: Harness, fake: FakeSlack, argv: string[]) {
  let stdout = '';
  let stderr = '';
  const out = new PassThrough();
  const err = new PassThrough();
  out.on('data', (chunk) => {
    stdout += String(chunk);
  });
  err.on('data', (chunk) => {
    stderr += String(chunk);
  });
  const code = await run(argv, {
    core: harness.core,
    env: harness.env,
    streams: {
      stdout: Object.assign(out, { isTTY: false }),
      stderr: Object.assign(err, { isTTY: false }),
      stdin: Object.assign(new PassThrough(), { isTTY: false }),
    },
    openBrowser: () => undefined,
    probe: (input, init) => harness.probe(input, init),
    // Always the loopback Slack: a test that forgot it would reach the real one.
    read: fake.fetch,
  });
  return { code, stdout, stderr };
}

/** A command run with `--json`, and what it returned; fails the test when it did not succeed. */
async function data<T>(harness: Harness, fake: FakeSlack, argv: string[]): Promise<T> {
  const ran = await cli(harness, fake, ['--json', ...argv]);
  const envelope = JSON.parse(ran.stdout) as Envelope<T>;
  assert.equal(ran.code, 0, `${argv.join(' ')}: ${ran.stdout}${ran.stderr}`);
  assert.ok(envelope.ok && envelope.data !== undefined, ran.stdout);
  return envelope.data;
}

function file(dir: string, name: string, content: string | Buffer): string {
  const path = join(dir, name);
  writeFileSync(path, content);
  return realpathSync.native(path);
}

function sha256(bytes: string | Buffer): string {
  return createHash('sha256').update(bytes).digest('hex');
}

const W = ['--workspace', 'acme'];

test('draft create --file records each file, and needs no --text when it has files', async (t) => {
  const { harness, fake, docs } = await world(t);
  const chart = file(docs, 'chart.png', Buffer.from([0x89, 0x50, 0x4e, 0x47]));
  const notes = file(docs, 'notes.md', '# notes');

  const created = await data<Drafted>(harness, fake, [
    'draft',
    'create',
    ...W,
    '--channel',
    'C1',
    '--file',
    chart,
    notes,
  ]);
  assert.deepEqual(created.files, [
    {
      path: chart,
      name: 'chart.png',
      size: 4,
      sha256: sha256(Buffer.from([0x89, 0x50, 0x4e, 0x47])),
      mimeType: 'image/png',
    },
    { path: notes, name: 'notes.md', size: 7, sha256: sha256('# notes'), mimeType: 'text/markdown' },
  ]);
  assert.equal(created.payload.text, '');

  // What a person reads says what is on it, and that nothing has gone anywhere.
  const said = await cli(harness, fake, ['draft', 'create', ...W, '--channel', 'C1', '--text', 'hi', '--file', chart]);
  assert.equal(said.code, 0, said.stderr);
  assert.match(said.stdout, /^Draft dft_\w+ with 1 file\. Nothing has reached Slack\./);

  // Neither words nor files is nothing to post.
  const empty = await cli(harness, fake, ['--json', 'draft', 'create', ...W, '--channel', 'C1']);
  assert.notEqual(empty.code, 0);
  assert.equal((JSON.parse(empty.stdout) as Envelope<never>).error?.code, 'USAGE');
  assert.deepEqual(fake.requests, [], 'writing a draft reached Slack');
});

test('draft update replaces the files with --file, adds with --add-file, and every update is a new revision', async (t) => {
  const { harness, fake, docs } = await world(t);
  const a = file(docs, 'a.txt', 'a');
  const b = file(docs, 'b.txt', 'bb');
  const c = file(docs, 'c.txt', 'ccc');
  const created = await data<Drafted>(harness, fake, [
    'draft',
    'create',
    ...W,
    '--channel',
    'C1',
    '--text',
    'files',
    '--file',
    a,
  ]);

  const added = await data<Drafted>(harness, fake, ['draft', 'update', created.draftId, ...W, '--add-file', b, c]);
  assert.deepEqual(
    added.files?.map((recorded) => recorded.path),
    [a, b, c],
  );
  assert.notEqual(added.revision, created.revision);

  const replaced = await data<Drafted>(harness, fake, ['draft', 'update', created.draftId, ...W, '--file', c]);
  assert.deepEqual(
    replaced.files?.map((recorded) => recorded.path),
    [c],
  );
  assert.notEqual(replaced.revision, added.revision);

  const reworded = await cli(harness, fake, [
    'draft',
    'update',
    created.draftId,
    ...W,
    '--text',
    'one file',
    '--channel',
    'C2',
  ]);
  assert.equal(reworded.code, 0, reworded.stderr);
  assert.match(reworded.stdout, /any approval it had no longer holds/);

  // `draft show` lists the files, as the gate would post them.
  const shown = await cli(harness, fake, ['draft', 'show', created.draftId, ...W]);
  assert.equal(shown.code, 0, shown.stderr);
  assert.match(shown.stdout, /one file/);
  assert.ok(shown.stdout.includes(`file: c.txt · 3 bytes · from ${c}`), shown.stdout);
});

test('post prepare lists the files; post send posts them and prints their ids and the message’s ts', async (t) => {
  const { harness, fake, uploads, docs } = await world(t);
  const chart = file(docs, 'chart.png', Buffer.from([1, 2, 3]));
  const csv = file(docs, 'totals.csv', 'a,b\n');
  const created = await data<Drafted>(harness, fake, [
    'draft',
    'create',
    ...W,
    '--channel',
    'C1',
    '--text',
    'the numbers',
    '--file',
    chart,
    csv,
  ]);

  const prepared = await cli(harness, fake, ['post', 'prepare', ...W, '--draft', created.draftId]);
  assert.equal(prepared.code, 0, prepared.stderr);
  assert.ok(prepared.stdout.includes('Attach:   chart.png · 3 bytes · image/png'), prepared.stdout);
  assert.ok(prepared.stdout.includes(`sha256 ${sha256('a,b\n')}`), prepared.stdout);
  assert.ok(prepared.stdout.includes(`from ${csv}`), prepared.stdout);
  const approvalId = /approval (ap_\w+)/.exec(prepared.stdout)?.[1];
  assert.ok(approvalId, prepared.stdout);

  const sent = await cli(harness, fake, [
    'post',
    'send',
    ...W,
    '--draft',
    created.draftId,
    '--approval',
    approvalId,
    '--expect-channel',
    'C1',
  ]);
  assert.equal(sent.code, 0, sent.stderr);
  const [first, second] = uploads.issued;
  assert.equal(
    sent.stdout.trim(),
    [
      'Posted 2 files to C1 at 1700000000.000200.',
      `  ${first?.fileId}  chart.png · 3 bytes · sha256 ${sha256(Buffer.from([1, 2, 3]))}`,
      `  ${second?.fileId}  totals.csv · 4 bytes · sha256 ${sha256('a,b\n')}`,
    ].join('\n'),
  );
  assert.equal(uploads.completed.length, 1);
});

test('post send --json returns the files, and a ts of null with the reason when Slack has not attached one', async (t) => {
  const { harness, fake, uploads, docs } = await world(t, { ts: null });
  const created = await data<Drafted>(harness, fake, [
    'draft',
    'create',
    ...W,
    '--channel',
    'C1',
    '--file',
    file(docs, 'a.pdf', '%PDF-1'),
  ]);
  const prepared = await data<{ approvalId: string }>(harness, fake, [
    'post',
    'prepare',
    ...W,
    '--draft',
    created.draftId,
  ]);

  const argv = [
    'post',
    'send',
    ...W,
    '--draft',
    created.draftId,
    '--approval',
    prepared.approvalId,
    '--expect-channel',
    'C1',
  ];
  const posted = await data<{ ts: string | null; note?: string; files: { id: string; name: string }[] }>(
    harness,
    fake,
    argv,
  );
  assert.equal(posted.ts, null);
  assert.match(posted.note ?? '', /Slack had not attached the files to a message yet/);
  assert.deepEqual(
    posted.files.map((f) => [f.id, f.name]),
    [[uploads.issued[0]?.fileId, 'a.pdf']],
  );
});

test('post send says so in words when Slack has not attached the files to a message yet', async (t) => {
  const { harness, fake, docs } = await world(t, { ts: null });
  const created = await data<Drafted>(harness, fake, [
    'draft',
    'create',
    ...W,
    '--channel',
    'C1',
    '--file',
    file(docs, 'a.pdf', '%PDF-1'),
  ]);
  const prepared = await data<{ approvalId: string }>(harness, fake, [
    'post',
    'prepare',
    ...W,
    '--draft',
    created.draftId,
  ]);
  const sent = await cli(harness, fake, [
    'post',
    'send',
    ...W,
    '--draft',
    created.draftId,
    '--approval',
    prepared.approvalId,
    '--expect-channel',
    'C1',
  ]);
  assert.equal(sent.code, 0, sent.stderr);
  assert.match(
    sent.stdout,
    /^Posted 1 file to C1\. Slack had not attached the files to a message yet, so the message's ts is not known/,
  );
});

test('draft update --no-files takes every file off, as slack_draft_update with files: [] does, and not with --file', async (t) => {
  const { harness, fake, docs } = await world(t);
  const a = file(docs, 'a.txt', 'a');
  const b = file(docs, 'b.txt', 'bb');
  const created = await data<Drafted>(harness, fake, [
    'draft',
    'create',
    ...W,
    '--channel',
    'C1',
    '--text',
    'files',
    '--file',
    a,
    b,
  ]);

  // Together with a flag that names files, it is a contradiction, refused before anything changes.
  for (const flag of ['--file', '--add-file']) {
    const both = await cli(harness, fake, ['--json', 'draft', 'update', created.draftId, ...W, '--no-files', flag, a]);
    assert.equal(both.code, 64, both.stdout);
    const error = (JSON.parse(both.stdout) as Envelope<never>).error;
    assert.equal(error?.code, 'USAGE');
    assert.match(
      error?.message ?? '',
      new RegExp(`--no-files takes every file off, and ${flag} names files to put on it`),
    );
  }
  const unchanged = await data<Drafted & { files?: DraftFile[] }>(harness, fake, [
    'draft',
    'show',
    created.draftId,
    ...W,
  ]);
  assert.equal(unchanged.files?.length, 2, 'a refused update changed the draft');

  const bare = await data<Drafted>(harness, fake, ['draft', 'update', created.draftId, ...W, '--no-files']);
  assert.equal('files' in bare, false, 'the files were left on');
  assert.equal(bare.payload.text, 'files');
  assert.notEqual(bare.revision, created.revision);

  // A draft with no words has nothing left to post without its files: the operation refuses it, as the tool's would.
  const quiet = await data<Drafted>(harness, fake, ['draft', 'create', ...W, '--channel', 'C1', '--file', a]);
  const empty = await cli(harness, fake, ['--json', 'draft', 'update', quiet.draftId, ...W, '--no-files']);
  assert.equal((JSON.parse(empty.stdout) as Envelope<never>).error?.code, 'USAGE');
});

test('the command a changed-file refusal names can be run as it is written, at prepare and at send', async (t) => {
  /*
   * It named `agent-slack draft update <draftId> --file …` without `--workspace`, which the command requires — so the
   * one step it offered failed. The command now carries the draft's id and the workspace's own name; only the paths
   * are left to fill in, and a person runs it as written.
   */
  const { harness, fake, docs } = await world(t);
  const real = file(docs, 'totals.csv', 'a,b\n1,2\n');
  const created = await data<Drafted>(harness, fake, ['draft', 'create', ...W, '--channel', 'C1', '--file', real]);
  const expected = `agent-slack draft update ${created.draftId} --workspace acme --file <path…>`;
  const runAsWritten = async (command: string): Promise<void> => {
    const argv = command.replace('<path…>', real).split(' ').slice(1);
    const ran = await cli(harness, fake, argv);
    assert.equal(ran.code, 0, `${command}: ${ran.stdout}${ran.stderr}`);
  };

  // At prepare.
  writeFileSync(real, 'a,b\n9,9\n');
  const atPrepare = await cli(harness, fake, ['--json', 'post', 'prepare', ...W, '--draft', created.draftId]);
  const prepareError = (JSON.parse(atPrepare.stdout) as Envelope<never>).error;
  assert.equal(prepareError?.code, 'BAD_DATA');
  assert.equal(prepareError?.details?.command, expected);
  assert.ok(prepareError?.hint?.includes(`\`${expected}\``), prepareError?.hint);
  await runAsWritten(String(prepareError?.details?.command));

  // At send: prepared with the file as it is now, then changed again before the send.
  const prepared = await data<{ approvalId: string }>(harness, fake, [
    'post',
    'prepare',
    ...W,
    '--draft',
    created.draftId,
  ]);
  writeFileSync(real, 'a,b\n7,7\n');
  const argv = [
    'post',
    'send',
    ...W,
    '--draft',
    created.draftId,
    '--approval',
    prepared.approvalId,
    '--expect-channel',
    'C1',
  ];
  const atSend = await cli(harness, fake, ['--json', ...argv]);
  const sendError = (JSON.parse(atSend.stdout) as Envelope<never>).error;
  assert.equal(sendError?.code, 'APPROVAL_VOID');
  assert.equal(sendError?.details?.command, expected);
  assert.ok(sendError?.hint?.includes(`\`${expected}\``), sendError?.hint);
  await runAsWritten(String(sendError?.details?.command));
  const again = await cli(harness, fake, ['post', 'prepare', ...W, '--draft', created.draftId]);
  assert.equal(again.code, 0, `${again.stdout}${again.stderr}`);
});
