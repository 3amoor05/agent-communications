import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import {
  APPROVAL_LIFETIMES,
  type BindingFields,
  bindingDigestOf,
  bindingObjectOf,
  identityOf,
} from '../src/approval-binding.ts';
import {
  type ApprovalRecord,
  ApprovalStore,
  changeDigest,
  DIGEST_VERSION,
  downloadDigest,
  type ListedFile,
} from '../src/approvals.ts';
import { canonicalJson, sha256Hex } from '../src/digest.ts';
import { CommsError } from '../src/errors.ts';
import { tempDir } from './helpers/temp.ts';

/*
 * The one binding a version-2 record carries (design 2026-10-05 §D1, "Digest integrity"), frozen as golden vectors.
 *
 * Each expected canonical JSON below was written by hand from the spec's object — keys sorted at every level, absent
 * members left out — and its SHA-256 taken of that hand-written string, not of anything the code produced. A change
 * to what is bound, or to how it is serialised, fails here before it can strand a record written by another build.
 */

const A = 'a'.repeat(64);
const B = 'b'.repeat(64);
const C = 'c'.repeat(64);
const D = 'd'.repeat(64);
const E = 'e'.repeat(64);
const F = 'f'.repeat(64);
const N = '1'.repeat(64);
const id = (c: string) => `ap_${'0'.repeat(25)}${c}`;

const gmailSend: BindingFields = {
  approvalId: id('G'),
  kind: 'send',
  channel: 'gmail',
  ownerScope: 'owner',
  inboxId: 'ibx_AAAAAAAAAAAAAAAA',
  inboxSub: 'sub-1',
  draftId: 'r-draft-1',
  draftMessageId: 'msg-v1',
  expect: { to: ['sam@partner.test'], cc: ['kim@partner.test'], bcc: [], subject: 'Re: plan' },
  contentDigest: A,
  route: 'confirm',
  pendingMs: 1_800_000,
  approvedMs: 86_400_000,
  sendEpoch: 3,
  policy: 'chat',
  requiredPolicy: 'confirm',
};

const slackPost: BindingFields = {
  approvalId: id('S'),
  kind: 'send',
  channel: 'slack',
  ownerScope: 'owner',
  inboxId: 'acc_AAAAAAAAAAAAAAAA',
  inboxSub: 'U0POSTER',
  draftId: 'sd_post',
  draftMessageId: 'rev-3',
  expect: { to: ['C0ROOM'], cc: [], bcc: [], subject: 'reaches 12' },
  contentDigest: B,
  route: 'chat',
  pendingMs: 600_000,
  approvedMs: 86_400_000,
  sendEpoch: 0,
  policy: 'chat',
  requiredPolicy: 'chat',
};

const slackFiles: BindingFields = {
  ...slackPost,
  approvalId: id('F'),
  draftId: 'sd_files',
  draftMessageId: 'rev-7',
  expect: { to: ['C0ROOM'], cc: [], bcc: [], subject: 'reaches 412' },
  contentDigest: C,
  route: 'confirm',
  pendingMs: 1_800_000,
  sendEpoch: 2,
  requiredPolicy: 'confirm',
};

const slackReaction: BindingFields = {
  ...slackPost,
  approvalId: id('R'),
  draftId: 'reaction:C0ROOM:1700000000.000100',
  draftMessageId: D,
  expect: { to: ['C0ROOM'], cc: [], bcc: [], subject: ':thumbsup: on 1700000000.000100' },
  contentDigest: D,
};

const resendSend: BindingFields = {
  approvalId: id('E'),
  kind: 'send',
  channel: 'resend',
  ownerScope: 'owner',
  inboxId: 'acc_BBBBBBBBBBBBBBBB',
  inboxSub: 'team-user',
  draftId: 'pm_0000000000000000000000000E',
  draftMessageId: E,
  expect: { to: ['billing@partner.test'], cc: [], bcc: ['audit@acme.test'], subject: 'Invoice 42' },
  contentDigest: E,
  route: 'chat',
  pendingMs: 600_000,
  approvedMs: 86_400_000,
  sendEpoch: 1,
  policy: 'chat',
  requiredPolicy: 'chat',
};

const change = (fields: Partial<BindingFields>): BindingFields => ({
  approvalId: id('C'),
  kind: 'change',
  channel: 'slack',
  ownerScope: 'owner',
  inboxId: 'acc_AAAAAAAAAAAAAAAA',
  draftId: 'change',
  draftMessageId: F,
  expect: { to: [], cc: [], bcc: [], subject: 'Let acme/slack post' },
  contentDigest: F,
  route: 'chat',
  pendingMs: 600_000,
  approvedMs: 86_400_000,
  policy: 'chat',
  requiredPolicy: 'chat',
  ...fields,
});

const changeOwner = change({});
const changeProspective = change({
  approvalId: id('P'),
  channel: 'gmail',
  ownerScope: 'prospective',
  inboxId: '',
  expect: { to: [], cc: [], bcc: [], subject: 'Connect acme/gmail' },
  route: 'confirm',
  pendingMs: 1_800_000,
  policy: 'confirm',
  requiredPolicy: 'confirm',
});
const changeGlobal = change({
  approvalId: id('Q'),
  channel: 'core',
  ownerScope: 'global',
  inboxId: '',
  expect: { to: [], cc: [], bcc: [], subject: 'Let a yes in the chat change settings' },
});

const FOLDERS = { downloads: '/srv/sam/Downloads', current: '/srv/sam/work' };
const download = (fields: Partial<BindingFields>): BindingFields => ({
  approvalId: id('D'),
  kind: 'download',
  channel: 'gmail',
  ownerScope: 'owner',
  inboxId: 'ibx_AAAAAAAAAAAAAAAA',
  draftId: 'download',
  draftMessageId: N,
  expect: { to: [], cc: [], bcc: [], subject: 'where to save 2 files from acme/gmail' },
  contentDigest: N,
  pendingMs: 1_800_000,
  policy: 'confirm',
  requiredPolicy: 'confirm',
  download: { folders: FOLDERS },
  ...fields,
});

const downloadNoListing = download({});
const downloadEmptyListing = download({ download: { folders: FOLDERS, listing: [] } });
const downloadPlainListing = download({
  download: {
    folders: FOLDERS,
    listing: [
      { name: 'invoice.pdf', size: 1200 },
      { name: 'notes.txt', size: null },
    ],
  },
});
const downloadFullListing = download({
  channel: 'slack',
  inboxId: 'acc_AAAAAAAAAAAAAAAA',
  expect: { to: [], cc: [], bcc: [], subject: 'where to save 2 files from acme/slack' },
  policy: 'chat',
  requiredPolicy: 'chat',
  download: {
    folders: FOLDERS,
    listing: [
      { name: 'budget.xlsm.download', size: 5120, renamed: 'type', flags: ['macro-capable'] },
      { name: 'invoice.pdf', size: 1200 },
    ],
  },
});
const downloadOfferedSwapped = download({
  download: { folders: { downloads: FOLDERS.current, current: FOLDERS.downloads } },
});

const VECTORS: [string, BindingFields, string, string][] = [
  [
    'a Gmail send',
    gmailSend,
    `{"approvedMs":86400000,"contentDigest":"${A}","identity":{"approvalId":"${id('G')}","channel":"gmail","draftId":"r-draft-1","draftMessageId":"msg-v1","expect":{"bcc":[],"cc":["kim@partner.test"],"subject":"Re: plan","to":["sam@partner.test"]},"inboxId":"ibx_AAAAAAAAAAAAAAAA","inboxSub":"sub-1","ownerScope":"owner","sendEpoch":3},"kind":"send","pendingMs":1800000,"route":"confirm","v":2}`,
    'cc3d98535c129926f06d157d0821b6a7375892593b8eb57f5dde5e8e2c2fbfe5',
  ],
  [
    'a Slack post',
    slackPost,
    `{"approvedMs":86400000,"contentDigest":"${B}","identity":{"approvalId":"${id('S')}","channel":"slack","draftId":"sd_post","draftMessageId":"rev-3","expect":{"bcc":[],"cc":[],"subject":"reaches 12","to":["C0ROOM"]},"inboxId":"acc_AAAAAAAAAAAAAAAA","inboxSub":"U0POSTER","ownerScope":"owner","sendEpoch":0},"kind":"send","pendingMs":600000,"route":"chat","v":2}`,
    'cb24fad382f4b8dd1a31c71e4ebc8c2b1f7d9ecd51c81e84c52c224764441eb0',
  ],
  [
    'a Slack post with files',
    slackFiles,
    `{"approvedMs":86400000,"contentDigest":"${C}","identity":{"approvalId":"${id('F')}","channel":"slack","draftId":"sd_files","draftMessageId":"rev-7","expect":{"bcc":[],"cc":[],"subject":"reaches 412","to":["C0ROOM"]},"inboxId":"acc_AAAAAAAAAAAAAAAA","inboxSub":"U0POSTER","ownerScope":"owner","sendEpoch":2},"kind":"send","pendingMs":1800000,"route":"confirm","v":2}`,
    'ddcec905ba0e1ffd8a298d3289407e1d63fd5e1631e7f708c85b7b1e79594316',
  ],
  [
    'a Slack reaction',
    slackReaction,
    `{"approvedMs":86400000,"contentDigest":"${D}","identity":{"approvalId":"${id('R')}","channel":"slack","draftId":"reaction:C0ROOM:1700000000.000100","draftMessageId":"${D}","expect":{"bcc":[],"cc":[],"subject":":thumbsup: on 1700000000.000100","to":["C0ROOM"]},"inboxId":"acc_AAAAAAAAAAAAAAAA","inboxSub":"U0POSTER","ownerScope":"owner","sendEpoch":0},"kind":"send","pendingMs":600000,"route":"chat","v":2}`,
    '54e33fd10c1ad4b40dbc39f31991b98ffdc3f3faac13ab5752c71e07c0ef0075',
  ],
  [
    'a Resend send',
    resendSend,
    `{"approvedMs":86400000,"contentDigest":"${E}","identity":{"approvalId":"${id('E')}","channel":"resend","draftId":"pm_0000000000000000000000000E","draftMessageId":"${E}","expect":{"bcc":["audit@acme.test"],"cc":[],"subject":"Invoice 42","to":["billing@partner.test"]},"inboxId":"acc_BBBBBBBBBBBBBBBB","inboxSub":"team-user","ownerScope":"owner","sendEpoch":1},"kind":"send","pendingMs":600000,"route":"chat","v":2}`,
    'be4ecf41a8c6f2dc96e9c7a45d280c3a09c1e7dd2d01244d971673b7a7691c77',
  ],
  [
    'a change to an owner',
    changeOwner,
    `{"approvedMs":86400000,"contentDigest":"${F}","identity":{"approvalId":"${id('C')}","channel":"slack","draftId":"change","draftMessageId":"${F}","expect":{"bcc":[],"cc":[],"subject":"Let acme/slack post","to":[]},"inboxId":"acc_AAAAAAAAAAAAAAAA","ownerScope":"owner"},"kind":"change","pendingMs":600000,"route":"chat","v":2}`,
    '4f2775bb92638eec6171d7ef4df8224da06878c56f7d32b3a1420d9aef7a8dcf',
  ],
  [
    'a change that connects its owner',
    changeProspective,
    `{"approvedMs":86400000,"contentDigest":"${F}","identity":{"approvalId":"${id('P')}","channel":"gmail","draftId":"change","draftMessageId":"${F}","expect":{"bcc":[],"cc":[],"subject":"Connect acme/gmail","to":[]},"inboxId":"","ownerScope":"prospective"},"kind":"change","pendingMs":1800000,"route":"confirm","v":2}`,
    'aae5449c88738aa85c6519f7a8e4a6db207886ec0c42733a78ce344b76abd272',
  ],
  [
    'a change to the whole configuration',
    changeGlobal,
    `{"approvedMs":86400000,"contentDigest":"${F}","identity":{"approvalId":"${id('Q')}","channel":"core","draftId":"change","draftMessageId":"${F}","expect":{"bcc":[],"cc":[],"subject":"Let a yes in the chat change settings","to":[]},"inboxId":"","ownerScope":"global"},"kind":"change","pendingMs":600000,"route":"chat","v":2}`,
    'f21ee71089dc656eb6410dac37ce9fef39efc8b05214c9442f73936a122bce7e',
  ],
  [
    'a download with no listing',
    downloadNoListing,
    `{"contentDigest":"${N}","identity":{"approvalId":"${id('D')}","channel":"gmail","draftId":"download","draftMessageId":"${N}","expect":{"bcc":[],"cc":[],"subject":"where to save 2 files from acme/gmail","to":[]},"inboxId":"ibx_AAAAAAAAAAAAAAAA","ownerScope":"owner"},"kind":"download","offered":{"current":"/srv/sam/work","downloads":"/srv/sam/Downloads"},"profile":{"pendingMs":1800000,"policy":"confirm","requiredPolicy":"confirm"},"v":2}`,
    '8f021bf173ae36f6df25df5aa7cd3d15c0def0f7183a557631093ba9892170f7',
  ],
  [
    'a download with an empty listing',
    downloadEmptyListing,
    `{"contentDigest":"${N}","identity":{"approvalId":"${id('D')}","channel":"gmail","draftId":"download","draftMessageId":"${N}","expect":{"bcc":[],"cc":[],"subject":"where to save 2 files from acme/gmail","to":[]},"inboxId":"ibx_AAAAAAAAAAAAAAAA","ownerScope":"owner"},"kind":"download","listing":[],"offered":{"current":"/srv/sam/work","downloads":"/srv/sam/Downloads"},"profile":{"pendingMs":1800000,"policy":"confirm","requiredPolicy":"confirm"},"v":2}`,
    'e780ca32112ab3b804b1038c5123f1ecc60d7e03d6ab3dbf82a0a6feafff4530',
  ],
  [
    'a download listing files without the optional members',
    downloadPlainListing,
    `{"contentDigest":"${N}","identity":{"approvalId":"${id('D')}","channel":"gmail","draftId":"download","draftMessageId":"${N}","expect":{"bcc":[],"cc":[],"subject":"where to save 2 files from acme/gmail","to":[]},"inboxId":"ibx_AAAAAAAAAAAAAAAA","ownerScope":"owner"},"kind":"download","listing":[{"name":"invoice.pdf","size":1200},{"name":"notes.txt","size":null}],"offered":{"current":"/srv/sam/work","downloads":"/srv/sam/Downloads"},"profile":{"pendingMs":1800000,"policy":"confirm","requiredPolicy":"confirm"},"v":2}`,
    '888f4b91afaf6f4049b691d6c106840871fe4108b815b95fd87a37d6de89b8a4',
  ],
  [
    'a download listing a renamed, flagged file',
    downloadFullListing,
    `{"contentDigest":"${N}","identity":{"approvalId":"${id('D')}","channel":"slack","draftId":"download","draftMessageId":"${N}","expect":{"bcc":[],"cc":[],"subject":"where to save 2 files from acme/slack","to":[]},"inboxId":"acc_AAAAAAAAAAAAAAAA","ownerScope":"owner"},"kind":"download","listing":[{"flags":["macro-capable"],"name":"budget.xlsm.download","renamed":"type","size":5120},{"name":"invoice.pdf","size":1200}],"offered":{"current":"/srv/sam/work","downloads":"/srv/sam/Downloads"},"profile":{"pendingMs":1800000,"policy":"chat","requiredPolicy":"chat"},"v":2}`,
    'd1c92325421ea20544a453123928adb7b127c06d9d439a0995fb2dd210b50b94',
  ],
  [
    'a download whose two offered folders are the other way round',
    downloadOfferedSwapped,
    `{"contentDigest":"${N}","identity":{"approvalId":"${id('D')}","channel":"gmail","draftId":"download","draftMessageId":"${N}","expect":{"bcc":[],"cc":[],"subject":"where to save 2 files from acme/gmail","to":[]},"inboxId":"ibx_AAAAAAAAAAAAAAAA","ownerScope":"owner"},"kind":"download","offered":{"current":"/srv/sam/Downloads","downloads":"/srv/sam/work"},"profile":{"pendingMs":1800000,"policy":"confirm","requiredPolicy":"confirm"},"v":2}`,
    'e288788b79cd780b53de42d78eee7b360d3c9878b5d6a816911f33ee69dab6ba',
  ],
];

test('golden vectors: the canonical binding JSON and its SHA-256, for every kind and subtype', () => {
  for (const [name, fields, json, digest] of VECTORS) {
    assert.equal(canonicalJson(bindingObjectOf(fields)), json, `${name}: canonical JSON`);
    assert.equal(sha256Hex(json), digest, `${name}: the vector's own hash`);
    assert.equal(bindingDigestOf(fields), digest, `${name}: bindingDigestOf`);
  }
  // Every digest distinct: no two of these bind the same thing.
  assert.equal(new Set(VECTORS.map(([, , , digest]) => digest)).size, VECTORS.length);
});

test('a download’s binding object holds exactly its profile, identity, offered folders and listing', () => {
  // Compared as objects, not only as JSON: an absent optional member kept as `undefined`, or `listing: undefined` on a
  // record with none, would hash the same today and be one serialiser change away from not doing so.
  assert.deepStrictEqual(bindingObjectOf(downloadNoListing), {
    v: 2,
    kind: 'download',
    contentDigest: N,
    profile: { pendingMs: 1_800_000, policy: 'confirm', requiredPolicy: 'confirm' },
    identity: identityOf(downloadNoListing),
    offered: { downloads: FOLDERS.downloads, current: FOLDERS.current },
  });
  assert.equal('listing' in bindingObjectOf(downloadNoListing), false, 'no listing key when the record has none');
  assert.deepStrictEqual(bindingObjectOf(downloadEmptyListing).listing, []);
  assert.deepStrictEqual(bindingObjectOf(downloadPlainListing).listing, [
    { name: 'invoice.pdf', size: 1200 },
    { name: 'notes.txt', size: null },
  ]);
  const [first, second] = bindingObjectOf(downloadFullListing).listing as Record<string, unknown>[];
  assert.deepStrictEqual(first, {
    name: 'budget.xlsm.download',
    size: 5120,
    renamed: 'type',
    flags: ['macro-capable'],
  });
  assert.deepStrictEqual(second, { name: 'invoice.pdf', size: 1200 });
  assert.deepStrictEqual(Object.keys(second ?? {}), ['name', 'size'], 'absent optional members are left out');
});

test('offered: both folder choices are bound, by meaning — swapping the two paths is a different binding', () => {
  const offered = bindingObjectOf(downloadNoListing).offered;
  assert.deepStrictEqual(offered, { downloads: '/srv/sam/Downloads', current: '/srv/sam/work' });
  assert.notEqual(bindingDigestOf(downloadNoListing), bindingDigestOf(downloadOfferedSwapped));
  for (const folder of ['downloads', 'current'] as const) {
    const moved = download({ download: { folders: { ...FOLDERS, [folder]: '/tmp/elsewhere' } } });
    assert.notEqual(bindingDigestOf(moved), bindingDigestOf(downloadNoListing), `offered.${folder}`);
  }
});

test('identity is exactly the record’s own operational fields, with the epoch on a send and nowhere else', () => {
  assert.deepStrictEqual(identityOf(gmailSend), {
    approvalId: id('G'),
    channel: 'gmail',
    ownerScope: 'owner',
    inboxId: 'ibx_AAAAAAAAAAAAAAAA',
    inboxSub: 'sub-1',
    draftId: 'r-draft-1',
    draftMessageId: 'msg-v1',
    expect: { to: ['sam@partner.test'], cc: ['kim@partner.test'], bcc: [], subject: 'Re: plan' },
    sendEpoch: 3,
  });
  assert.deepStrictEqual(identityOf(changeGlobal), {
    approvalId: id('Q'),
    channel: 'core',
    ownerScope: 'global',
    inboxId: '',
    draftId: 'change',
    draftMessageId: F,
    expect: { to: [], cc: [], bcc: [], subject: 'Let a yes in the chat change settings' },
  });
  assert.equal('sendEpoch' in identityOf({ ...changeOwner, sendEpoch: 9 }), false, 'a change has no epoch');
});

test('editing any bound field — channel, ownerScope, sendEpoch, route, every identity field — changes bindingDigest', () => {
  const edits: [string, BindingFields, Partial<BindingFields>][] = [
    ['approvalId', gmailSend, { approvalId: id('H') }],
    ['channel', gmailSend, { channel: 'resend' }],
    ['ownerScope', changeOwner, { ownerScope: 'prospective' }],
    ['ownerScope global', changeGlobal, { ownerScope: 'prospective' }],
    ['inboxId', gmailSend, { inboxId: 'ibx_BBBBBBBBBBBBBBBB' }],
    ['inboxSub', gmailSend, { inboxSub: 'sub-2' }],
    ['inboxSub removed', gmailSend, { inboxSub: undefined }],
    ['draftId', gmailSend, { draftId: 'r-draft-2' }],
    ['draftMessageId', slackPost, { draftMessageId: 'rev-4' }],
    ['expect.to', gmailSend, { expect: { ...gmailSend.expect, to: ['x@evil.test'] } }],
    ['expect.cc', gmailSend, { expect: { ...gmailSend.expect, cc: [] } }],
    ['expect.bcc', gmailSend, { expect: { ...gmailSend.expect, bcc: ['x@evil.test'] } }],
    ['expect.subject', gmailSend, { expect: { ...gmailSend.expect, subject: 'Re: other' } }],
    ['sendEpoch', gmailSend, { sendEpoch: 4 }],
    ['route', gmailSend, { route: 'chat' }],
    ['pendingMs', gmailSend, { pendingMs: 600_000 }],
    ['approvedMs', changeOwner, { approvedMs: 1 }],
    ['contentDigest', resendSend, { contentDigest: B }],
    ['kind', changeOwner, { kind: 'send' }],
    ['download policy', downloadNoListing, { policy: 'chat' }],
    ['download requiredPolicy', downloadNoListing, { requiredPolicy: 'chat' }],
    ['download pendingMs', downloadNoListing, { pendingMs: 600_000 }],
    ['download channel', downloadNoListing, { channel: 'slack' }],
  ];
  for (const [name, base, edit] of edits) {
    assert.notEqual(bindingDigestOf({ ...base, ...edit }), bindingDigestOf(base), name);
  }
  const listed = (listing: NonNullable<BindingFields['download']>['listing']) =>
    bindingDigestOf(download({ download: { folders: FOLDERS, listing } }));
  const full = downloadFullListing.download?.listing ?? [];
  const [budget, invoice] = full;
  assert.ok(budget && invoice);
  const base = listed(full);
  const variants: [string, ListedFile[]][] = [
    ['a name', [{ ...budget, name: 'budget.xlsm' }, invoice]],
    ['a size', [{ ...budget, size: 1 }, invoice]],
    ['a rename reason', [{ ...budget, renamed: 'no-extension' }, invoice]],
    ['a rename reason removed', [{ name: budget.name, size: budget.size, flags: budget.flags }, invoice]],
    ['a flag', [{ ...budget, flags: [] }, invoice]],
    ['the order', [invoice, budget]],
  ];
  for (const [name, listing] of variants) {
    assert.notEqual(listed(listing), base, `listing: ${name}`);
  }
  assert.notEqual(listed(undefined), listed([]), 'no listing is not an empty one');
});

// ── The create paths ───────────────────────────────────────────────────────────────────────────────────────────

const CREATED = Date.parse('2026-10-05T09:00:00.000Z');

function storeAt() {
  const dir = tempDir();
  return { dir, store: new ApprovalStore(dir, { now: () => new Date(CREATED) }) };
}

function onDisk(store: ApprovalStore, approvalId: string): ApprovalRecord {
  return JSON.parse(readFileSync(join(store.directory, `${approvalId}.json`), 'utf8')) as ApprovalRecord;
}

/** What every create path must have written: version 2, both digests, the profile, and a binding that recomputes. */
function assertBound(record: ApprovalRecord, expected: { identity: Record<string, unknown>; pendingMs: number }) {
  assert.equal(record.digestVersion, DIGEST_VERSION);
  assert.equal(DIGEST_VERSION, 2);
  assert.match(record.contentDigest, /^[0-9a-f]{64}$/);
  assert.match(record.bindingDigest, /^[0-9a-f]{64}$/);
  assert.equal(record.bindingDigest, bindingDigestOf(record), 'the binding recomputes from the stored fields alone');
  assert.deepStrictEqual(identityOf(record), expected.identity, 'exactly this identity is hashed');
  assert.equal(record.pendingMs, expected.pendingMs);
  assert.equal(Date.parse(record.expiresAt) - Date.parse(record.createdAt), expected.pendingMs);
  assert.equal('digest' in record, false, 'a version-2 record has no single legacy digest');
}

const EXPECT = { to: ['sam@partner.test'], cc: [], bcc: [], subject: 'Re: plan' };

test('create-path round trips: every send subtype writes the identity it is bound to', async () => {
  const cases: [string, Parameters<ApprovalStore['create']>[0], 'chat' | 'confirm'][] = [
    [
      'Gmail send',
      {
        channel: 'gmail',
        inboxId: 'ibx_AAAAAAAAAAAAAAAA',
        inboxSub: 'sub-1',
        draftId: 'r-draft-1',
        draftMessageId: 'msg-v1',
        contentDigest: A,
        sendEpoch: 3,
        policy: 'chat',
        requiredPolicy: 'confirm',
        riskFlags: ['tainted-recipient'],
        expect: EXPECT,
      },
      'confirm',
    ],
    [
      'Slack post',
      {
        channel: 'slack',
        inboxId: 'acc_AAAAAAAAAAAAAAAA',
        inboxSub: 'U0POSTER',
        draftId: 'sd_post',
        draftMessageId: 'rev-3',
        contentDigest: B,
        sendEpoch: 0,
        policy: 'chat',
        requiredPolicy: 'chat',
        riskFlags: [],
        expect: { to: ['C0ROOM'], cc: [], bcc: [], subject: 'reaches 12' },
      },
      'chat',
    ],
    [
      'Slack post with files',
      {
        channel: 'slack',
        inboxId: 'acc_AAAAAAAAAAAAAAAA',
        inboxSub: 'U0POSTER',
        draftId: 'sd_files',
        draftMessageId: 'rev-7',
        contentDigest: C,
        sendEpoch: 2,
        policy: 'confirm',
        requiredPolicy: 'chat',
        riskFlags: ['contains-files'],
        expect: { to: ['C0ROOM'], cc: [], bcc: [], subject: 'reaches 412' },
      },
      'confirm',
    ],
    [
      'Slack reaction',
      {
        channel: 'slack',
        inboxId: 'acc_AAAAAAAAAAAAAAAA',
        inboxSub: 'U0POSTER',
        draftId: 'reaction:C0ROOM:1700000000.000100',
        draftMessageId: D,
        contentDigest: D,
        sendEpoch: 0,
        policy: 'chat',
        requiredPolicy: 'chat',
        riskFlags: [],
        expect: { to: ['C0ROOM'], cc: [], bcc: [], subject: ':thumbsup: on 1700000000.000100' },
      },
      'chat',
    ],
    [
      'Resend send',
      {
        channel: 'resend',
        inboxId: 'acc_BBBBBBBBBBBBBBBB',
        inboxSub: 'team-user',
        draftId: 'pm_0000000000000000000000000E',
        draftMessageId: E,
        contentDigest: E,
        sendEpoch: 1,
        policy: 'chat',
        requiredPolicy: 'chat',
        riskFlags: [],
        expect: { to: ['billing@partner.test'], cc: [], bcc: ['audit@acme.test'], subject: 'Invoice 42' },
      },
      'chat',
    ],
  ];
  for (const [name, input, route] of cases) {
    const { store } = storeAt();
    const created = await store.create(input);
    const stored = onDisk(store, created.approvalId);
    assert.deepStrictEqual(stored, created, `${name}: what is returned is what is on disk`);
    assert.equal(stored.kind, 'send', `${name}: a version-2 send says it is one`);
    assert.equal(stored.channel, input.channel, name);
    assert.equal(stored.ownerScope, 'owner', name);
    assert.equal(stored.route, route, `${name}: route`);
    assert.equal(stored.approvedMs, APPROVAL_LIFETIMES.approved, name);
    assert.equal(stored.contentDigest, input.contentDigest, name);
    assert.equal(stored.sendEpoch, input.sendEpoch, name);
    assertBound(stored, {
      pendingMs: route === 'confirm' ? 1_800_000 : 600_000,
      identity: {
        approvalId: created.approvalId,
        channel: input.channel,
        ownerScope: 'owner',
        inboxId: input.inboxId,
        inboxSub: input.inboxSub,
        draftId: input.draftId,
        draftMessageId: input.draftMessageId,
        expect: input.expect,
        sendEpoch: input.sendEpoch,
      },
    });
  }
});

const CHANGE = {
  summary: 'Let acme/slack post',
  loosened: [{ path: 'accounts.acme/slack.mode', before: 'read', after: 'send', id: 'acc_AAAAAAAAAAAAAAAA' }],
  effects: ['signs in to Slack again'],
};

test('create-path round trips: a change’s ownerScope comes from its target — owner, prospective, global', async () => {
  const cases = [
    {
      name: 'owner',
      channel: 'slack',
      target: { kind: 'account' as const, name: 'acme/slack', id: 'acc_AAAAAAAAAAAAAAAA' },
      inboxId: 'acc_AAAAAAAAAAAAAAAA',
      policy: 'chat' as const,
    },
    {
      name: 'prospective',
      channel: 'gmail',
      target: { kind: 'inbox' as const, name: 'acme/gmail' },
      inboxId: '',
      policy: 'confirm' as const,
    },
    { name: 'global', channel: 'core', target: null, inboxId: '', policy: 'chat' as const },
  ];
  for (const { name, channel, target, inboxId, policy } of cases) {
    const { store } = storeAt();
    const change = { ...CHANGE, target };
    const created = await store.createChange({ channel, change, policy });
    const stored = onDisk(store, created.approvalId);
    assert.deepStrictEqual(stored, created, name);
    assert.equal(stored.kind, 'change', name);
    assert.equal(stored.ownerScope, name, name);
    assert.equal(stored.route, policy, `${name}: the route is the live change policy`);
    assert.equal(stored.contentDigest, changeDigest(change), name);
    assert.equal('sendEpoch' in stored, false, `${name}: a change has no epoch`);
    assertBound(stored, {
      pendingMs: policy === 'confirm' ? 1_800_000 : 600_000,
      identity: {
        approvalId: created.approvalId,
        channel,
        ownerScope: name,
        inboxId,
        draftId: 'change',
        draftMessageId: changeDigest(change),
        expect: { to: [], cc: [], bcc: [], subject: CHANGE.summary },
      },
    });
  }
});

test('create-path round trips: a Gmail and a Slack download bind their offered folders and listing', async () => {
  const cases = [
    {
      channel: 'gmail',
      target: { kind: 'inbox' as const, name: 'acme/gmail', id: 'ibx_AAAAAAAAAAAAAAAA' },
      operation: 'attachments.download',
      listing: undefined,
    },
    {
      channel: 'slack',
      target: { kind: 'account' as const, name: 'acme/slack', id: 'acc_AAAAAAAAAAAAAAAA' },
      operation: 'files.download',
      listing: [
        { name: 'budget.xlsm.download', size: 5120, renamed: 'type' as const, flags: ['macro-capable'] },
        { name: 'invoice.pdf', size: 1200, renamed: undefined, flags: [] },
      ],
    },
  ];
  for (const { channel, target, operation, listing } of cases) {
    const { store } = storeAt();
    const binding = {
      summary: `where to save 2 files from ${target.name}`,
      target,
      operation,
      request: { selection: { kind: 'files', ids: ['F01', 'F02'] }, maxFiles: 50 },
      files: ['F01', 'F02'],
      names: ['budget.xlsm.download', 'invoice.pdf'],
      folders: FOLDERS,
      ...(listing === undefined ? {} : { listing }),
    };
    const created = await store.createDownload({ channel, download: binding, policy: 'confirm' });
    const stored = onDisk(store, created.approvalId);
    assert.deepStrictEqual(stored, created, channel);
    assert.equal(stored.kind, 'download');
    assert.equal(stored.channel, channel);
    assert.equal(stored.route, undefined, 'a download has no route: its profile is bound instead');
    assert.equal(stored.approvedMs, undefined);
    assert.equal(stored.contentDigest, downloadDigest(binding));
    assertBound(stored, {
      pendingMs: APPROVAL_LIFETIMES.download,
      identity: {
        approvalId: created.approvalId,
        channel,
        ownerScope: 'owner',
        inboxId: target.id,
        draftId: 'download',
        draftMessageId: downloadDigest(binding),
        expect: { to: [], cc: [], bcc: [], subject: binding.summary },
      },
    });
    const object = bindingObjectOf(stored);
    assert.deepStrictEqual(object.offered, { downloads: FOLDERS.downloads, current: FOLDERS.current });
    if (listing === undefined) assert.equal('listing' in object, false);
    else {
      // As stored: an empty flags list and an absent rename reason are left out, never carried as empty or undefined.
      assert.deepStrictEqual(object.listing, [
        { name: 'budget.xlsm.download', size: 5120, renamed: 'type', flags: ['macro-capable'] },
        { name: 'invoice.pdf', size: 1200 },
      ]);
    }
  }
});

test('the real create path writes the version-2 fixture, field for field', async () => {
  const { store } = storeAt();
  const created = await store.create({
    channel: 'gmail',
    inboxId: 'ibx_AAAAAAAAAAAAAAAA',
    inboxSub: 'sub-1',
    draftId: 'r-draft-1',
    draftMessageId: 'msg-v1',
    contentDigest: A,
    sendEpoch: 0,
    policy: 'chat',
    requiredPolicy: 'chat',
    riskFlags: [],
    expect: EXPECT,
  });
  const fixture = {
    approvalId: created.approvalId,
    kind: 'send',
    digestVersion: 2,
    channel: 'gmail',
    ownerScope: 'owner',
    route: 'chat',
    pendingMs: 600_000,
    approvedMs: 86_400_000,
    inboxId: 'ibx_AAAAAAAAAAAAAAAA',
    inboxSub: 'sub-1',
    draftId: 'r-draft-1',
    draftMessageId: 'msg-v1',
    contentDigest: A,
    sendEpoch: 0,
    policy: 'chat',
    requiredPolicy: 'chat',
    riskFlags: [],
    expect: EXPECT,
    challengeAttempts: 0,
    state: 'pending',
    createdAt: '2026-10-05T09:00:00.000Z',
    expiresAt: '2026-10-05T09:10:00.000Z',
    updatedAt: '2026-10-05T09:00:00.000Z',
  };
  const written = onDisk(store, created.approvalId);
  assert.deepStrictEqual(written, { ...fixture, bindingDigest: bindingDigestOf(fixture as unknown as BindingFields) });
});

test('a channel the snapshot does not know is refused at creation, and nothing is written', async () => {
  const { store, dir } = storeAt();
  const refused = (e: unknown) => e instanceof CommsError && e.code === 'UNEXPECTED' && /pigeon/.test(e.message);
  await assert.rejects(
    store.create({
      channel: 'pigeon',
      inboxId: 'ibx_AAAAAAAAAAAAAAAA',
      draftId: 'r-draft-1',
      draftMessageId: 'msg-v1',
      contentDigest: A,
      sendEpoch: 0,
      policy: 'chat',
      requiredPolicy: 'chat',
      riskFlags: [],
      expect: EXPECT,
    }),
    refused,
  );
  await assert.rejects(
    store.createChange({ channel: 'pigeon', change: { ...CHANGE, target: null }, policy: 'chat' }),
    refused,
  );
  await assert.rejects(
    store.createDownload({
      channel: 'pigeon',
      download: {
        summary: 'where to save 1 file',
        target: { kind: 'inbox', name: 'acme/gmail', id: 'ibx_AAAAAAAAAAAAAAAA' },
        operation: 'attachments.download',
        request: {},
        files: ['F01'],
        names: ['a.pdf'],
        folders: FOLDERS,
      },
      policy: 'chat',
    }),
    refused,
  );
  let files: string[] = [];
  try {
    files = readdirSync(join(dir, 'approvals'));
  } catch {
    files = [];
  }
  assert.deepEqual(files, [], 'no record names a channel this release does not know');
});
