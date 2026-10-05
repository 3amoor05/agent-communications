import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { deriveLegacyV1State } from '../src/approval-legacy.ts';
import { asLegacy, asV2, stateOf } from '../src/approval-stored.ts';
import { ApprovalStore, type ChangeBinding, type Expectation } from '../src/approvals.ts';
import { CommsError } from '../src/errors.ts';
import { coreHandoffs } from './helpers/handoffs.ts';
import { liveConfig } from './helpers/live-config.ts';
import { tempDir } from './helpers/temp.ts';

/*
 * The released 0.13.0 approval store, as published, against this release's records (CUE-404 Task 24; design
 * 2026-10-05 §5 "D1 — versions and timestamps", D1vt-b to D1vt-d).
 *
 * `fixtures/released-0.13.0/core` is `@agentcomms/core@0.13.0` unpacked from npm — its `package.json` and `dist/`,
 * nothing edited — with `FROZEN.json` recording the tarball's integrity and every file's SHA-256. Its runtime
 * dependencies resolve from this package's own `node_modules`. Each version must fail closed against the other's
 * records: the old one refuses a version-2 record with its own "prepared by a different version" words, and this one
 * refuses what the old one writes.
 */

const HERE = fileURLToPath(new URL('.', import.meta.url));
const FROZEN_DIR = join(HERE, 'fixtures', 'released-0.13.0', 'core');
const FROZEN_INTEGRITY =
  'sha512-DkmpeDffTiwjfbqymDb6e00S9uEqL3jYFFjJm+Gwu0XP5u2AoyPpAwoFLR366/LbHofs/Gervl5QrBV76uoPYg==';
const FROZEN_TARBALL = 'https://registry.npmjs.org/@agentcomms/core/-/core-0.13.0.tgz';

/** What these tests use of the released store: its 0.13.0 signatures, untyped by this release's. */
interface FrozenRecord {
  approvalId: string;
  digestVersion: number;
  state: string;
  kind?: string;
  reason?: string;
  [field: string]: unknown;
}
interface FrozenStore {
  create(input: Record<string, unknown>): Promise<FrozenRecord>;
  createChange(input: Record<string, unknown>): Promise<FrozenRecord>;
  createDownload(input: Record<string, unknown>): Promise<FrozenRecord>;
  get(approvalId: string): Promise<FrozenRecord | null>;
  issueChallenge(approvalId: string, kind?: string, platform?: string): Promise<string>;
  approve(
    approvalId: string,
    via: string,
    live: Record<string, unknown>,
    answer: string,
    kind?: string,
    platform?: string,
  ): Promise<FrozenRecord>;
  claimForSend(
    approvalId: string,
    live: Record<string, unknown>,
    options?: Record<string, unknown>,
  ): Promise<FrozenRecord>;
  claimForChange(
    approvalId: string,
    live: Record<string, unknown>,
    options?: Record<string, unknown>,
  ): Promise<FrozenRecord>;
  answerDownload(
    approvalId: string,
    via: string,
    answer: Record<string, unknown>,
    platform?: string,
  ): Promise<FrozenRecord>;
  claimForDownload(
    approvalId: string,
    live: Record<string, unknown>,
    options?: Record<string, unknown>,
  ): Promise<FrozenRecord>;
}
interface FrozenCore {
  ApprovalStore: new (stateDir: string, options?: { now?: () => Date }) => FrozenStore;
  DIGEST_VERSION: number;
  changeDigest(change: unknown): string;
}

async function frozenCore(): Promise<FrozenCore> {
  return (await import(pathToFileURL(join(FROZEN_DIR, 'dist', 'index.mjs')).href)) as FrozenCore;
}

const INBOX = 'ibx_AAAAAAAAAAAAAAAA';
const EXPECT: Expectation = { to: ['sam@partner.test'], cc: [], bcc: [], subject: 'Re: plan' };
const DIGEST = 'a'.repeat(64);
const MIN = 60_000;

function clock(start = Date.now()) {
  let t = start;
  return { now: () => new Date(t), set: (ms: number) => (t = ms), at: () => t };
}

/** One state directory, this release's store over it, and the released store over the same files. */
async function shared(time = clock()) {
  const dir = tempDir('comms-released-');
  const config = liveConfig(dir, { inboxes: { 'acme/gmail': { id: INBOX, sendPolicy: 'chat' } } });
  const handoffs = coreHandoffs({ configDir: dir, stateDir: dir, dataDir: dir, secretsDir: dir, downloadsDir: dir });
  const store = new ApprovalStore(dir, { now: time.now, handoffs, loadConfig: config.loadConfig });
  const released = await frozenCore();
  const frozen = new released.ApprovalStore(dir, { now: time.now });
  const file = (approvalId: string, suffix = '.json') => join(dir, 'approvals', `${approvalId}${suffix}`);
  return { dir, time, store, frozen, released, file, bytes: (id: string) => readFileSync(file(id), 'utf8') };
}

/** A version-2 send, prepared by this release under the chat route. */
async function v2Send(store: ApprovalStore, requiredPolicy: 'chat' | 'confirm' = 'chat') {
  return store.create({
    channel: 'gmail',
    inboxId: INBOX,
    inboxSub: 'sub-1',
    draftId: 'r-draft-1',
    draftMessageId: 'msg-1',
    contentDigest: DIGEST,
    sendEpoch: 0,
    policy: 'chat',
    requiredPolicy,
    riskFlags: requiredPolicy === 'confirm' ? ['tainted-recipient'] : [],
    expect: EXPECT,
  });
}

const FROZEN_LIVE = {
  draftMessageId: 'msg-1',
  digest: DIGEST,
  inboxId: INBOX,
  inboxSub: 'sub-1',
  policy: 'chat',
  expect: EXPECT,
};

const CHANGE: ChangeBinding = {
  summary: 'acme/gmail: let a send go on a yes in the chat',
  target: { kind: 'inbox', name: 'acme/gmail', id: INBOX },
  loosened: [{ path: 'inboxes.acme/gmail.sendPolicy', before: 'confirm', after: 'chat', id: INBOX }],
  settings: [],
  effects: [],
};

/** 0.13.0's own refusal of another digest version, word for word, in the words of the record's kind. */
function releasedVersionRefusal(kind: 'sent' | 'changed' | 'saved') {
  return (e: unknown) => {
    const error = e as { name?: string; code?: string; message?: string; exitCode?: number };
    assert.equal(error.code, 'APPROVAL_VOID', String(error.message));
    assert.equal(
      error.message,
      `nothing was ${kind}: the approval was prepared by a different version of agent-communications`,
    );
    return true;
  };
}

/** This release's refusal of a record an earlier release prepared. */
function versionRefusal(e: unknown): boolean {
  return (
    e instanceof CommsError &&
    e.code === 'APPROVAL_VOID' &&
    /prepared by a different version of agent-communications/.test(e.message)
  );
}

function walk(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory() ? walk(join(dir, entry.name)) : [join(dir, entry.name)],
  );
}

// ── The fixture is what npm published ──────────────────────────────────────────────────────────────────────────

test('the released 0.13.0 core is the published tarball, unedited: its integrity, its version and every file', () => {
  const frozen = JSON.parse(readFileSync(join(FROZEN_DIR, 'FROZEN.json'), 'utf8')) as {
    name: string;
    version: string;
    integrity: string;
    tarball: string;
    files: Record<string, string>;
  };
  assert.equal(frozen.name, '@agentcomms/core');
  assert.equal(frozen.version, '0.13.0');
  assert.equal(frozen.integrity, FROZEN_INTEGRITY, 'npm’s dist.integrity for @agentcomms/core@0.13.0');
  assert.equal(frozen.tarball, FROZEN_TARBALL);
  const manifest = JSON.parse(readFileSync(join(FROZEN_DIR, 'package.json'), 'utf8')) as Record<string, unknown>;
  assert.equal(manifest.name, '@agentcomms/core');
  assert.equal(manifest.version, '0.13.0');
  const onDisk = walk(FROZEN_DIR)
    .map((path) => relative(FROZEN_DIR, path).split(sep).join('/'))
    .filter((path) => path !== 'FROZEN.json')
    .sort();
  assert.deepEqual(onDisk, Object.keys(frozen.files).sort(), 'exactly the files recorded, no more and no fewer');
  for (const [path, sha256] of Object.entries(frozen.files)) {
    const actual = createHash('sha256')
      .update(readFileSync(join(FROZEN_DIR, ...path.split('/'))))
      .digest('hex');
    assert.equal(actual, sha256, `${path} is as published`);
  }
});

test('the released module is 0.13.0’s: digest version 1', async () => {
  assert.equal((await frozenCore()).DIGEST_VERSION, 1);
});

// ── D1vt-b: 0.13.0 refuses what this release writes ───────────────────────────────────────────────────────────

test('the released 0.13.0 store refuses a version-2 send, change and question with its own words, and writes nothing (D1vt-b)', async () => {
  const { store, frozen, released, file, bytes } = await shared();
  const send = await v2Send(store);
  const sendBytes = bytes(send.approvalId);
  await assert.rejects(frozen.claimForSend(send.approvalId, FROZEN_LIVE), releasedVersionRefusal('sent'));
  await assert.rejects(frozen.issueChallenge(send.approvalId, 'send'), releasedVersionRefusal('sent'));
  await assert.rejects(
    frozen.approve(send.approvalId, 'terminal', { draftMessageId: 'msg-1', digest: DIGEST }, 'ABCD'),
    releasedVersionRefusal('sent'),
  );
  assert.equal(bytes(send.approvalId), sendBytes, 'byte-identical');
  assert.equal(existsSync(file(send.approvalId, '.claim')), false, 'no claim marker');

  const change = await store.createChange({ channel: 'core', change: CHANGE, policy: 'chat' });
  const changeBytes = bytes(change.approvalId);
  await assert.rejects(
    frozen.claimForChange(change.approvalId, { change: CHANGE, policy: 'chat' }),
    releasedVersionRefusal('changed'),
  );
  assert.equal(bytes(change.approvalId), changeBytes);
  assert.equal(existsSync(file(change.approvalId, '.claim')), false);
  // The same change, as 0.13.0 digests it: what refused it was the version, not a different change.
  assert.equal(released.changeDigest(CHANGE), change.contentDigest);

  const question = await store.createDownload({
    channel: 'gmail',
    policy: 'chat',
    download: {
      summary: '2 files from jo@partner.test',
      target: { kind: 'inbox', name: 'acme/gmail', id: INBOX },
      operation: 'gmail.attachments.download',
      request: { messageId: 'm-1' },
      files: ['a.pdf', 'b.pdf'],
      names: ['a.pdf', 'b.pdf'],
      folders: { downloads: '/tmp/downloads', current: '/tmp/work' },
    },
  });
  const questionBytes = bytes(question.approvalId);
  await assert.rejects(
    frozen.answerDownload(question.approvalId, 'terminal', { choice: 'downloads' }),
    releasedVersionRefusal('saved'),
  );
  assert.equal(bytes(question.approvalId), questionBytes);
});

// ── D1vt-c: this release refuses what 0.13.0 writes ───────────────────────────────────────────────────────────

test('a send, change and question the released store writes are version 1, and this release refuses each with nothing written (D1vt-c)', async () => {
  const { store, frozen, released, file, bytes } = await shared();
  const send = await frozen.create({
    inboxId: INBOX,
    inboxSub: 'sub-1',
    draftId: 'r-draft-1',
    draftMessageId: 'msg-1',
    digest: DIGEST,
    policy: 'chat',
    requiredPolicy: 'chat',
    riskFlags: [],
    expect: EXPECT,
  });
  assert.equal(send.digestVersion, 1);
  assert.equal('kind' in send, false, '0.13.0 wrote a send without a kind');
  const sendBytes = bytes(send.approvalId);
  // Read by the one legacy decoder: a pending send, legacy, never this release's to claim.
  const read = await store.get(send.approvalId);
  assert.equal(read?.form, 'legacy');
  assert.equal(asLegacy(read)?.state, 'pending');
  await assert.rejects(
    store.claimForSend(send.approvalId, {
      inboxId: INBOX,
      inboxSub: 'sub-1',
      draftMessageId: 'msg-1',
      contentDigest: DIGEST,
      expect: EXPECT,
    }),
    versionRefusal,
  );
  await assert.rejects(store.issueChallenge(send.approvalId, 'send'), versionRefusal);
  await assert.rejects(
    store.approve(send.approvalId, 'terminal', { draftMessageId: 'msg-1', contentDigest: DIGEST }, 'ABCD'),
    versionRefusal,
  );
  assert.equal(bytes(send.approvalId), sendBytes, 'byte-identical');
  assert.equal(existsSync(file(send.approvalId, '.claim')), false, 'no claim marker');

  const change = await frozen.createChange({ change: CHANGE, policy: 'chat' });
  assert.equal(change.digestVersion, 1);
  assert.equal(change.digest, released.changeDigest(CHANGE));
  const changeBytes = bytes(change.approvalId);
  await assert.rejects(store.claimForChange(change.approvalId, { change: CHANGE, policy: 'chat' }), versionRefusal);
  assert.equal(bytes(change.approvalId), changeBytes);
  assert.equal(existsSync(file(change.approvalId, '.claim')), false);

  const question = await frozen.createDownload({
    policy: 'chat',
    download: {
      summary: '2 files from jo@partner.test',
      target: { kind: 'inbox', name: 'acme/gmail', id: INBOX },
      operation: 'gmail.attachments.download',
      request: { messageId: 'm-1' },
      files: ['a.pdf', 'b.pdf'],
      names: ['a.pdf', 'b.pdf'],
      folders: { downloads: '/tmp/downloads', current: '/tmp/work' },
    },
  });
  assert.equal(question.digestVersion, 1);
  const questionBytes = bytes(question.approvalId);
  await assert.rejects(store.answerDownload(question.approvalId, 'terminal', { choice: 'downloads' }), versionRefusal);
  assert.equal(bytes(question.approvalId), questionBytes);
});

// ── D1vt-d: an approved version-2 record past its pending deadline, given to 0.13.0 ───────────────────────────

test('an approved version-2 send given to 0.13.0 after its pending deadline may be persisted expired, and is never claimed by either release (D1vt-d)', async () => {
  const time = clock();
  const { store, frozen, file } = await shared(time);
  const send = await v2Send(store, 'confirm');
  const challenge = await store.issueChallenge(send.approvalId, 'send');
  const approved = await store.approve(
    send.approvalId,
    'terminal',
    { draftMessageId: 'msg-1', contentDigest: DIGEST },
    challenge,
  );
  assert.equal(approved.state, 'approved');
  // Past the pending deadline (its `expiresAt`, thirty minutes on the confirm route), well inside its day.
  time.set(Date.parse(send.expiresAt) + MIN);
  assert.ok(time.at() < Date.parse(approved.usableUntil ?? ''), 'still usable by this release’s rules');

  await assert.rejects(
    frozen.claimForSend(send.approvalId, { ...FROZEN_LIVE, policy: 'confirm' }),
    releasedVersionRefusal('sent'),
  );
  // 0.13.0 derives expiry from `expiresAt` and writes it back before it checks the version: that is allowed.
  const after = JSON.parse(readFileSync(file(send.approvalId), 'utf8')) as Record<string, unknown>;
  assert.equal(after.state, 'expired');
  assert.equal(after.digestVersion, 2);
  assert.equal(existsSync(file(send.approvalId, '.claim')), false, '0.13.0 never claimed it');
  const frozenRead = await frozen.get(send.approvalId);
  assert.equal(frozenRead?.state, 'expired');

  // And this release does not claim what 0.13.0 wrote either: the record no longer validates, and is refused as such.
  const read = await store.get(send.approvalId);
  assert.equal(read === null ? null : stateOf(read), 'corrupt');
  await assert.rejects(
    store.claimForSend(send.approvalId, {
      inboxId: INBOX,
      inboxSub: 'sub-1',
      draftMessageId: 'msg-1',
      contentDigest: DIGEST,
      expect: EXPECT,
    }),
    (e: unknown) => e instanceof CommsError && e.exitCode === 10,
  );
  assert.equal(existsSync(file(send.approvalId, '.claim')), false, 'and neither did this release');
});

// ── Task 1, against the real 0.13.0: a person's revoke retires a v1 record so 0.13.0 reads it revoked ──────────

test('a person’s revoke of a v1 send the released store prepared is read as revoked by 0.13.0, which then refuses to claim it', async () => {
  const { store, frozen, file, bytes } = await shared();
  const make = () =>
    frozen.create({
      inboxId: INBOX,
      inboxSub: 'sub-1',
      draftId: 'r-draft-1',
      draftMessageId: 'msg-1',
      digest: DIGEST,
      policy: 'chat',
      requiredPolicy: 'chat',
      riskFlags: [],
      expect: EXPECT,
    });
  const pending = await make();
  const original = JSON.parse(bytes(pending.approvalId)) as Record<string, unknown>;
  const revoked = await store.revoke(pending.approvalId, 'cancelled', { disposition: 'person' });
  assert.equal(stateOf(revoked), 'revoked');
  const written = JSON.parse(bytes(pending.approvalId)) as Record<string, unknown>;
  assert.deepStrictEqual(written, {
    ...original,
    state: 'revoked',
    reason: 'cancelled',
    updatedAt: written.updatedAt,
  });
  assert.equal(deriveLegacyV1State(written as never, new Date()).state, 'revoked');

  // 0.13.0 itself reads it revoked, and refuses the claim with its own words, writing nothing more.
  const seen = await frozen.get(pending.approvalId);
  assert.equal(seen?.state, 'revoked');
  await assert.rejects(frozen.claimForSend(pending.approvalId, FROZEN_LIVE), (e: unknown) => {
    const error = e as { code?: string; message?: string };
    assert.equal(error.code, 'APPROVAL_VOID');
    assert.equal(error.message, 'nothing was sent: the approval was voided (cancelled)');
    return true;
  });
  assert.equal(JSON.stringify(JSON.parse(bytes(pending.approvalId))), JSON.stringify(written));
  assert.equal(existsSync(file(pending.approvalId, '.claim')), false);
  // Nothing of version 2 reached the file for this release to misread either.
  assert.equal(asV2(await store.get(pending.approvalId)), null);
});

test('a person’s revoke of a v1 send past its original expiry writes nothing, and 0.13.0 reads it expired', async () => {
  const time = clock();
  const { store, frozen, bytes } = await shared(time);
  const pending = await frozen.create({
    inboxId: INBOX,
    inboxSub: 'sub-1',
    draftId: 'r-draft-1',
    draftMessageId: 'msg-1',
    digest: DIGEST,
    policy: 'chat',
    requiredPolicy: 'chat',
    riskFlags: [],
    expect: EXPECT,
  });
  const original = bytes(pending.approvalId);
  time.set(time.at() + 11 * MIN);
  const result = await store.revoke(pending.approvalId, 'cancelled', { disposition: 'person' });
  assert.equal(stateOf(result), 'expired');
  assert.equal(bytes(pending.approvalId), original, 'byte-identical');
  assert.equal((await frozen.get(pending.approvalId))?.state, 'expired');
});
