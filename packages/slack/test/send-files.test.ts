import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdirSync, realpathSync, truncateSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { type TestContext, test } from 'node:test';
import { CommsError, renderChannelPreview } from '@agentcomms/core';
import { SlackContext } from '../src/context.ts';
import { scopesForMode } from '../src/manifest.ts';
import { createDraft } from '../src/operations/drafts.ts';
import { prepareDraftPost } from '../src/operations/post.ts';
import { type FakeSlack, type FakeUploads, startFakeSlack } from './support/fake-slack.ts';
import { type Harness, newHarness } from './support/harness.ts';

/**
 * Posting files, through the gate a message goes through.
 *
 * What a person approves for a file post is the files as the preview lists them — name, size, type, hash, and where
 * each is read from — and the room they go to. These tests prepare and post against a loopback Slack of both hosts,
 * through the real guard, so what they check is what would leave the machine: which bytes, to which URL, in which
 * one call, and nothing at all when a file is no longer the one that was shown.
 */

interface World {
  harness: Harness;
  context: SlackContext;
  fake: FakeSlack;
  uploads: FakeUploads;
  docs: string;
  slack: { fetch: FakeSlack['fetch'] };
}

async function world(
  t: TestContext,
  options: {
    mode?: 'read' | 'send';
    grantedScopes?: readonly string[];
    sendPolicy?: 'chat' | 'confirm' | 'never';
    members?: number;
  } = {},
): Promise<World> {
  const harness = await newHarness();
  await harness.addWorkspace({
    alias: 'acme',
    mode: options.mode ?? 'send',
    ...(options.grantedScopes === undefined ? {} : { grantedScopes: options.grantedScopes }),
    ...(options.sendPolicy === undefined ? {} : { sendPolicy: options.sendPolicy }),
  });
  const context = new SlackContext({ core: harness.core, env: harness.env });
  const fake = await startFakeSlack({
    'conversations.info': () => ({ ok: true, channel: { id: 'C1', name: 'eng', num_members: options.members ?? 4 } }),
  });
  t.after(() => fake.close());
  const uploads = fake.acceptUploads();
  const docs = join(harness.home, 'docs');
  mkdirSync(docs);
  return { harness, context, fake, uploads, docs, slack: { fetch: fake.fetch } };
}

function sha256(bytes: string | Buffer): string {
  return createHash('sha256').update(bytes).digest('hex');
}

/** A file under the harness's home, by its real path — which is what a draft records and the preview shows. */
function file(dir: string, name: string, content: string | Buffer): string {
  const path = join(dir, name);
  writeFileSync(path, content);
  return realpathSync.native(path);
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

/** The methods Slack was asked, in order: what a test holds "nothing went out" against. */
function asked(fake: FakeSlack): string[] {
  return fake.requests.map((request) => (request.host === 'api' ? request.method : `${request.host}:${request.path}`));
}

// ── Preparing: what the person is shown, and what the approval is bound to ─────────────────────────────────────

test('the preview lists a file as it will leave: its name in Slack, size, type, hash and real path', async (t) => {
  const { context, fake, docs, slack } = await world(t);
  const content = 'the quarterly report, which nobody has read yet';
  const real = file(docs, 'report.pdf', content);
  const draft = await createDraft(context, 'acme', { channel: 'C1', text: 'the report', files: [real] });

  const prepared = await prepareDraftPost(context, 'acme', { draftId: draft.draftId }, slack);

  assert.deepEqual(prepared.preview.attachments, [
    { filename: 'report.pdf', size: 47, mimeType: 'application/pdf', sha256: sha256(content), path: real },
  ]);
  assert.ok(prepared.riskFlags.includes('contains-files'));
  // A PDF is shown in the channel itself, not only offered to download.
  assert.deepEqual(prepared.preview.warnings, [
    'Slack shows report.pdf in the channel itself: everyone who reads the channel sees what is in it, not only its name',
  ]);
  // The channel and the reach as for any post, after the files.
  assert.equal(prepared.preview.channel, '#eng');
  assert.equal(prepared.preview.notifies.estimated, 0);

  const rendered = renderChannelPreview(prepared.preview);
  assert.ok(rendered.includes('Attach:   report.pdf · 47 bytes · application/pdf'), rendered);
  assert.ok(rendered.includes(`          sha256 ${sha256(content)}`), rendered);
  assert.ok(rendered.includes(`          from ${real}`), rendered);
  assert.ok(rendered.includes('! Slack shows report.pdf in the channel itself'), rendered);
  assert.ok(rendered.indexOf('Attach:') > rendered.indexOf('Channel:'), 'the files come after the channel');

  // Preparing read the room, and nothing else: no upload URL was asked for, and nothing reached the files host.
  assert.deepEqual(asked(fake), ['conversations.info']);
});

test('the preview lists several files in order, and warns about a large one and one the channel shows', async (t) => {
  const { context, docs, slack } = await world(t);
  const chart = file(docs, 'chart.png', Buffer.from([0x89, 0x50, 0x4e, 0x47, 9, 9]));
  const big = join(docs, 'dump.bin');
  writeFileSync(big, '');
  truncateSync(big, 10 * 1024 * 1024 + 1);
  const archive = file(docs, 'logs.zip', 'PK zipped');
  const draft = await createDraft(context, 'acme', {
    channel: 'C1',
    files: [chart, realpathSync.native(big), archive],
  });

  const prepared = await prepareDraftPost(context, 'acme', { draftId: draft.draftId }, slack);
  assert.deepEqual(
    prepared.preview.attachments?.map((a) => [a.filename, a.size, a.mimeType, a.sha256, a.path]),
    [
      ['chart.png', 6, 'image/png', sha256(Buffer.from([0x89, 0x50, 0x4e, 0x47, 9, 9])), chart],
      [
        'dump.bin',
        10 * 1024 * 1024 + 1,
        'application/octet-stream',
        sha256(Buffer.alloc(10 * 1024 * 1024 + 1)),
        realpathSync.native(big),
      ],
      ['logs.zip', 9, 'application/zip', sha256('PK zipped'), archive],
    ],
  );
  assert.deepEqual(prepared.preview.warnings, [
    'Slack shows chart.png in the channel itself: everyone who reads the channel sees what is in it, not only its name',
    'dump.bin is over 10 MiB (10,485,761 bytes): check that it is the file you mean to share with the whole channel',
  ]);
  const rendered = renderChannelPreview(prepared.preview);
  for (const line of [
    'Attach:   chart.png · 6 bytes · image/png',
    'Attach:   dump.bin · 10.0 MiB (10,485,761 bytes) · application/octet-stream',
    'Attach:   logs.zip · 9 bytes · application/zip',
  ]) {
    assert.ok(rendered.includes(line), `${line}\n${rendered}`);
  }
  // No words: the body is empty, and says so rather than inventing any.
  assert.equal(prepared.preview.body, '');
});

test('the approval is bound to each file’s hash: the same file with other bytes is another post', async (t) => {
  const { context, docs, slack } = await world(t);
  const digestOf = async (files: string[] | undefined): Promise<string> => {
    const draft = await createDraft(context, 'acme', { channel: 'C1', text: 'the numbers', files });
    const prepared = await prepareDraftPost(context, 'acme', { draftId: draft.draftId }, slack);
    return (await context.core.approvals.get(prepared.approvalId))?.digest ?? '';
  };
  mkdirSync(join(docs, 'b'));
  // Same name, same size, same type, other bytes: only the hash tells them apart.
  const one = await digestOf([file(docs, 'numbers.csv', 'a,b\n1,2\n')]);
  const other = await digestOf([file(join(docs, 'b'), 'numbers.csv', 'a,b\n1,3\n')]);
  const again = await digestOf([join(docs, 'numbers.csv')]);
  const none = await digestOf(undefined);
  assert.notEqual(one, other, 'a file with other bytes was bound to the same approval');
  assert.equal(one, again, 'the same file gave two different approvals');
  assert.notEqual(one, none, 'a post with a file was bound as the same words without it');
});

test('a file that changed after the draft was written is refused at prepare, and nothing is approved', async (t) => {
  const { context, fake, docs, slack } = await world(t);
  const real = file(docs, 'notes.md', '# notes');
  const draft = await createDraft(context, 'acme', { channel: 'C1', text: 'notes', files: [real] });
  writeFileSync(real, '# notes, edited after');

  const error = await refusal(prepareDraftPost(context, 'acme', { draftId: draft.draftId }, slack));
  assert.equal(error.code, 'BAD_DATA');
  assert.match(error.message, /notes\.md is not the file the draft recorded/);
  assert.equal(error.details?.file, 'notes.md');
  assert.match(error.hint ?? '', new RegExp(`agent-slack draft update ${draft.draftId} --file`));
  assert.deepEqual(await context.core.approvals.list(), [], 'an approval was made for bytes nobody was shown');
  assert.deepEqual(asked(fake), [], 'Slack was asked something about a post that was refused');
});

test('a workspace connected to read cannot prepare a file post', async (t) => {
  const { context, fake, docs, slack } = await world(t, { mode: 'read' });
  const draft = await createDraft(context, 'acme', { channel: 'C1', text: 'x', files: [file(docs, 'a.txt', 'a')] });

  const error = await refusal(prepareDraftPost(context, 'acme', { draftId: draft.draftId }, slack));
  assert.equal(error.code, 'SCOPE_MISSING');
  assert.match(error.message, /connected to read, and cannot send files/);
  assert.match(error.hint ?? '', /agent-slack workspace mode acme/);
  assert.deepEqual(await context.core.approvals.list(), []);
  assert.deepEqual(asked(fake), []);
});

test('a grant without files:write cannot prepare a file post, and is told the command that fixes it', async (t) => {
  const withoutFiles = scopesForMode('send').filter((scope) => scope !== 'files:write');
  const { context, fake, docs, slack } = await world(t, { grantedScopes: withoutFiles });
  const draft = await createDraft(context, 'acme', { channel: 'C1', text: 'x', files: [file(docs, 'a.txt', 'a')] });

  const error = await refusal(prepareDraftPost(context, 'acme', { draftId: draft.draftId }, slack));
  assert.equal(error.code, 'SCOPE_MISSING');
  assert.match(error.message, /was not granted files:write/);
  assert.match(error.hint ?? '', /`agent-slack workspace reauth acme --mode send`/);
  assert.equal(error.details?.scope, 'files:write');
  assert.equal(error.details?.command, 'agent-slack workspace reauth acme --mode send');
  assert.deepEqual(await context.core.approvals.list(), []);
  assert.deepEqual(asked(fake), []);

  // A post of text alone goes on exactly as it did: the check is for files.
  const text = await createDraft(context, 'acme', { channel: 'C1', text: 'just words' });
  const prepared = await prepareDraftPost(context, 'acme', { draftId: text.draftId }, slack);
  assert.match(prepared.approvalId, /^ap_/);
});

test('a post of text alone is previewed and bound exactly as it was before files existed', async (t) => {
  /*
   * Golden, captured from 0.10.0's code before any of this was written: the preview a person reads, the structured one
   * a tool returns, and the digest the approval is bound to. A text post that previewed or hashed differently would
   * void every approval outstanding across the upgrade — and would mean the file path had leaked into the text one.
   */
  const { context, slack } = await world(t);
  const draft = await createDraft(context, 'acme', {
    channel: 'C1',
    text: 'shipping at 5 — see <https://example.com/notes?utm=x|the notes> & say hi',
    threadTs: '1700000000.000100',
    mentionUsers: ['U024BE7LH'],
  });
  const prepared = await prepareDraftPost(context, 'acme', { draftId: draft.draftId }, slack);
  const scrub = (text: string): string =>
    text.replaceAll(draft.draftId, '<draft>').replaceAll(prepared.approvalId, '<approval>');

  assert.equal(
    (await context.core.approvals.get(prepared.approvalId))?.digest,
    '03a877c2f1836d22301eba26b2916dfaa6bb9b02eef5c4982d4e3ca0029f25d0',
  );
  assert.deepEqual(prepared.riskFlags, []);
  assert.equal(prepared.requiredPolicy, 'chat');
  assert.equal(
    scrub(JSON.stringify(prepared.preview)),
    '{"workspace":"acme","postingAs":"U0001","channel":"#eng","thread":"a reply in the thread at 1700000000.000100","body":"@U024BE7LH shipping at 5 — see <https://example.com/notes?utm=x|the notes> & say hi","notifies":{"here":false,"channel":false,"users":["U024BE7LH"],"estimated":1},"context":{"workspace":"acme","draftId":"<draft>","note":"nothing has been posted","approvalId":"<approval>"},"links":[],"warnings":[],"policy":"say yes and it posts"}',
  );
  assert.equal(
    scrub(renderChannelPreview(prepared.preview)),
    [
      'POST PREVIEW · workspace acme · approval <approval> · draft <draft> · nothing has been posted',
      'From:     U0001',
      'Channel:  #eng',
      'Thread:   a reply in the thread at 1700000000.000100',
      'Notifies: U024BE7LH — about 1 person',
      '',
      'Body (11 words, 83 characters):',
      '```text',
      '@U024BE7LH shipping at 5 — see <https://example.com/notes?utm=x|the notes> & say hi',
      '```',
      '',
      '── #eng · U024BE7LH — about 1 person',
      'say yes and it posts',
    ].join('\n'),
  );
});
