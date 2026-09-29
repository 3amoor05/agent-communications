import assert from 'node:assert/strict';
import { existsSync, mkdirSync, readFileSync, realpathSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { join, posix, win32 } from 'node:path';
import { PassThrough } from 'node:stream';
import { test } from 'node:test';
import { ApprovalStore, type DownloadBinding, type DownloadRequest, downloadDigest } from '../src/approvals.ts';
import { beginChangeApproval } from '../src/changes.ts';
import type { Streams } from '../src/cli-runtime.ts';
import { type Core, openCore } from '../src/core.ts';
import { CommsError } from '../src/errors.ts';
import {
  askWhereToSave,
  checkDownloadAnswer,
  checkFolder,
  type DestinationQuestion,
  type DownloadAnswer,
  downloadAtTerminal,
  folderFor,
  openFolder,
  parseSaveAnswer,
  refuseRetiredOut,
  saveFolders,
  settleDestination,
} from '../src/save-destination.ts';
import { tempDir } from './helpers/temp.ts';

/*
 * Where a download is saved is the person's to say (core's `save-destination.ts`). These are the parts every channel
 * shares: the two folders a question offers, the form an answer must have, the question kept in the approval store
 * and claimed once for the files it listed, and the command line's way of asking a person at a terminal.
 */

const INBOX = 'ibx_AAAAAAAAAAAAAAAA';

function clock(start = Date.parse('2026-09-29T10:00:00.000Z')) {
  let t = start;
  return { now: () => new Date(t), advance: (ms: number) => (t += ms) };
}

const REQUEST: DownloadRequest = {
  target: { kind: 'inbox', name: 'acme/gmail', id: INBOX },
  operation: 'attachments.download',
  request: { targets: [{ messageId: 'm1', partId: null, filename: null }], maxFiles: 50 },
  files: ['m1/1', 'm1/2'],
};

function binding(folders = { downloads: '/srv/sam/Downloads', current: '/work/project' }): DownloadBinding {
  return { ...REQUEST, summary: 'where to save 2 files from acme/gmail', folders };
}

function refusal(pattern: RegExp, code: string) {
  return (error: unknown) => error instanceof CommsError && error.code === code && pattern.test(error.message);
}

/** A home and a core of their own, the home under both names core reads it by. */
function machine(): { home: string; env: NodeJS.ProcessEnv; core: Core } {
  const home = realpathSync(tempDir('comms-save-'));
  const env: NodeJS.ProcessEnv = {
    HOME: home,
    USERPROFILE: home,
    AGENT_COMMS_CONFIG_DIR: join(home, 'config'),
    AGENT_COMMS_UPDATE_CHECK: 'off',
    NO_COLOR: '1',
  };
  return { home, env, core: openCore({ env }) };
}

// ── The question in the approval store ─────────────────────────────────────────────────────────────────────────

test('a download’s question is kept pending, bound to a digest the store computes, and expires as an approval does', async () => {
  const time = clock();
  const store = new ApprovalStore(tempDir(), { now: time.now });
  const record = await store.createDownload({ download: binding() });
  assert.equal(record.kind, 'download');
  assert.equal(record.state, 'pending');
  assert.equal(record.digest, downloadDigest(REQUEST));
  assert.equal(record.inboxId, INBOX);
  assert.deepEqual(record.download?.folders, { downloads: '/srv/sam/Downloads', current: '/work/project' });
  // The summary and the folders are what the question says and what the answer means; neither is what it is for.
  assert.equal(downloadDigest({ ...REQUEST }), downloadDigest(binding({ downloads: '/x', current: '/y' })));
  time.advance(10 * 60 * 1000);
  assert.equal((await store.get(record.approvalId))?.state, 'expired');
  await assert.rejects(
    store.claimForDownload(record.approvalId, REQUEST),
    refusal(/^nothing was saved: the question expired before it was answered/, 'APPROVAL_EXPIRED'),
  );
});

test('a question is claimed once, for the request and the files it listed, and returns the folders it offered', async () => {
  const store = new ApprovalStore(tempDir(), { now: clock().now });
  const { approvalId } = await store.createDownload({ download: binding() });
  const claimed = await store.claimForDownload(approvalId, REQUEST);
  assert.equal(claimed.state, 'used');
  assert.deepEqual(claimed.download.folders, { downloads: '/srv/sam/Downloads', current: '/work/project' });
  await assert.rejects(
    store.claimForDownload(approvalId, REQUEST),
    refusal(/answered already, and an answer is used once/, 'APPROVAL_VOID'),
  );
});

test('a question claimed for another account, request or set of files is voided, and says which', async () => {
  const cases: Array<[string, DownloadRequest, RegExp]> = [
    ['account', { ...REQUEST, target: { ...REQUEST.target, id: 'ibx_BBBBBBBBBBBBBBBB' } }, /was about acme\/gmail/],
    ['operation', { ...REQUEST, operation: 'files.download' }, /another kind of download/],
    ['request', { ...REQUEST, request: { ...REQUEST.request, maxFiles: 5 } }, /a different request/],
    ['files', { ...REQUEST, files: ['m1/1', 'm1/2', 'm1/3'] }, /the files are not the ones the question listed/],
    ['order', { ...REQUEST, files: ['m1/2', 'm1/1'] }, /the files are not the ones the question listed/],
  ];
  for (const [what, live, reason] of cases) {
    const store = new ApprovalStore(tempDir(), { now: clock().now });
    const { approvalId } = await store.createDownload({ download: binding() });
    await assert.rejects(store.claimForDownload(approvalId, live), refusal(reason, 'APPROVAL_VOID'), what);
    // Voided for good: the right request cannot use it either, and the person is asked again.
    assert.equal((await store.get(approvalId))?.state, 'revoked', what);
    await assert.rejects(store.claimForDownload(approvalId, REQUEST), refusal(/was voided/, 'APPROVAL_VOID'), what);
  }
});

test('a question is never spent as a send or a change, nor either of those as a question — and trying harms none', async () => {
  const store = new ApprovalStore(tempDir(), { now: clock().now });
  const question = await store.createDownload({ download: binding() });
  const change = await store.createChange({
    change: { summary: 'Let it post', target: null, loosened: [], effects: ['removes a thing'] },
    policy: 'chat',
  });
  await assert.rejects(
    store.claimForSend(question.approvalId, {
      inboxId: INBOX,
      draftMessageId: question.digest,
      digest: question.digest,
      policy: 'chat',
      expect: { to: [], cc: [], bcc: [], subject: '' },
    }),
    refusal(/is a question about where to save files, not a send/, 'USAGE'),
  );
  await assert.rejects(
    store.claimForChange(question.approvalId, {
      change: { summary: '', target: null, loosened: [], effects: [] },
      policy: 'chat',
    }),
    refusal(/is a question about where to save files, not a configuration change/, 'USAGE'),
  );
  await assert.rejects(store.issueChallenge(question.approvalId), refusal(/question about where to save/, 'USAGE'));
  await assert.rejects(
    store.claimForDownload(change.approvalId, REQUEST),
    refusal(/is a configuration change, not a question about where to save files/, 'USAGE'),
  );
  assert.equal((await store.get(question.approvalId))?.state, 'pending');
  assert.equal((await store.get(change.approvalId))?.state, 'pending');
});

test('a question is never approved at a terminal: `approve` says what it is, and leaves it waiting', async () => {
  const { core } = machine();
  const question = await core.approvals.createDownload({ download: binding() });
  await assert.rejects(
    beginChangeApproval(core, question.approvalId, { surface: 'cli' }),
    refusal(/is a question about where to save files, not a configuration change/, 'USAGE'),
  );
  assert.equal((await core.approvals.get(question.approvalId))?.state, 'pending');
});

test('a question whose record no longer describes what its digest binds is voided, not believed', async () => {
  const store = new ApprovalStore(tempDir(), { now: clock().now });
  const record = await store.createDownload({ download: binding() });
  const path = join(store.directory, `${record.approvalId}.json`);
  const stored = JSON.parse(readFileSync(path, 'utf8'));
  // The files it describes, changed where it is kept, to the ones a claim then asks for: the digest still binds the old.
  stored.download.files = ['m9/1'];
  writeFileSync(path, JSON.stringify(stored));
  await assert.rejects(
    store.claimForDownload(record.approvalId, { ...REQUEST, files: ['m9/1'] }),
    refusal(/does not describe the download it is bound to/, 'APPROVAL_VOID'),
  );
});

// ── The folders, and the answer ────────────────────────────────────────────────────────────────────────────────

test('the two folders are the person’s own Downloads — or the one they set — and the folder the process runs in', () => {
  const posixFolders = saveFolders({ env: { HOME: '/srv/sam' }, cwd: '/work/project', platform: 'linux' });
  assert.deepEqual(posixFolders, { downloads: '/srv/sam/Downloads', current: '/work/project' });
  // Not a folder of this package's inside it: the person's Downloads folder itself.
  assert.equal(posixFolders.downloads.includes('agent-communications'), false);
  const configured = saveFolders({
    configured: '~/Inbox files',
    env: { HOME: '/srv/sam' },
    cwd: '/work/project',
    platform: 'linux',
  });
  assert.equal(configured.downloads, posix.join('/srv/sam', 'Inbox files'));
});

test('on Windows the Downloads folder is under USERPROFILE, whatever a Unix-style shell set HOME to', () => {
  const folders = saveFolders({
    env: { USERPROFILE: 'C:\\Users\\sam', HOME: '/c/elsewhere' },
    cwd: 'C:\\work\\project',
    platform: 'win32',
  });
  assert.deepEqual(folders, { downloads: 'C:\\Users\\sam\\Downloads', current: 'C:\\work\\project' });
  const answer = parseSaveAnswer('~\\Invoices', 'mcp', 'win32');
  assert.equal(
    folderFor(answer, folders, { USERPROFILE: 'C:\\Users\\sam' }, 'win32'),
    win32.join('C:\\Users\\sam', 'Invoices'),
  );
  assert.deepEqual(parseSaveAnswer('D:\\Invoices', 'mcp', 'win32'), { choice: 'other', folder: 'D:\\Invoices' });
  assert.throws(() => parseSaveAnswer('Invoices\\2026', 'mcp', 'win32'), refusal(/relative path/, 'USAGE'));
});

test('an answer is a word, or a folder that is absolute or starts with ~; a relative one is refused', () => {
  assert.deepEqual(parseSaveAnswer('downloads', 'mcp', 'linux'), { choice: 'downloads' });
  assert.deepEqual(parseSaveAnswer(' current ', 'mcp', 'linux'), { choice: 'current' });
  assert.deepEqual(parseSaveAnswer('/srv/files', 'mcp', 'linux'), { choice: 'other', folder: '/srv/files' });
  assert.deepEqual(parseSaveAnswer('~/Invoices', 'mcp', 'linux'), { choice: 'other', folder: '~/Invoices' });
  assert.deepEqual(parseSaveAnswer('~', 'mcp', 'linux'), { choice: 'other', folder: '~' });
  for (const relative of ['Invoices', './Invoices', '../Invoices', 'Downloads', '~sam/Invoices']) {
    assert.throws(
      () => parseSaveAnswer(relative, 'mcp', 'linux'),
      refusal(/is a relative path: a folder the person names is absolute, or starts with ~/, 'USAGE'),
      relative,
    );
  }
  assert.throws(() => parseSaveAnswer('', 'cli', 'linux'), refusal(/`--to` takes the person’s answer/, 'USAGE'));
  assert.throws(() => parseSaveAnswer(7, 'mcp', 'linux'), refusal(/`saveTo` takes the person’s answer/, 'USAGE'));
  assert.throws(
    () => parseSaveAnswer(`/srv/in${String.fromCharCode(0)}voices`, 'mcp', 'linux'),
    refusal(/is not a folder: it holds a NUL/, 'USAGE'),
  );
});

test('`~/x` is expanded from the home the environment names', () => {
  const folders = { downloads: '/d', current: '/c' };
  assert.equal(
    folderFor({ choice: 'other', folder: '~/Invoices' }, folders, { HOME: '/srv/sam' }, 'linux'),
    '/srv/sam/Invoices',
  );
  assert.equal(folderFor({ choice: 'downloads' }, folders, {}, 'linux'), '/d');
  assert.equal(folderFor({ choice: 'current' }, folders, {}, 'linux'), '/c');
});

test('an answer needs the question it answers, and a question’s id needs its answer — unless a person chose by flag', () => {
  const choiceId = 'ap_0000000000000000000000000A';
  assert.deepEqual(checkDownloadAnswer({}, 'mcp'), { kind: 'none' });
  assert.throws(
    () => checkDownloadAnswer({ saveTo: 'downloads' }, 'mcp'),
    refusal(/`saveTo` answers the download’s question, and needs its `choiceId`/, 'USAGE'),
  );
  assert.throws(
    () => checkDownloadAnswer({ saveTo: 'downloads', personChose: false }, 'cli'),
    refusal(/`--to` answers the download’s question, and needs its `--choice`/, 'USAGE'),
  );
  assert.throws(
    () => checkDownloadAnswer({ choiceId }, 'mcp'),
    refusal(/`choiceId` needs the person’s answer/, 'USAGE'),
  );
  assert.throws(
    () => checkDownloadAnswer({ choiceId: 'not-one', saveTo: 'current' }, 'mcp'),
    refusal(/is not a choice id/, 'USAGE'),
  );
  assert.deepEqual(checkDownloadAnswer({ saveTo: 'current', choiceId }, 'mcp'), {
    kind: 'choice',
    answer: { choice: 'current' },
    choiceId,
  });
  assert.deepEqual(checkDownloadAnswer({ saveTo: 'current', personChose: true }, 'cli'), {
    kind: 'person',
    answer: { choice: 'current' },
  });
});

test('`out` and `--out` are refused with what replaced them', () => {
  assert.doesNotThrow(() => refuseRetiredOut(undefined, 'mcp'));
  assert.throws(
    () => refuseRetiredOut('reports', 'mcp'),
    (error: unknown) =>
      error instanceof CommsError &&
      error.code === 'USAGE' &&
      /`out` is no longer taken/.test(error.message) &&
      /`saveTo`/.test(error.hint ?? ''),
  );
  assert.throws(
    () => refuseRetiredOut('', 'cli'),
    (error: unknown) => error instanceof CommsError && /--to/.test(error.hint ?? '') && /`--out`/.test(error.message),
  );
});

test('a folder is made when missing, private, and resolved through its links; a file where it should be is refused', async () => {
  const root = realpathSync(tempDir());
  const made = join(root, 'new', 'deeper');
  await checkFolder(made);
  assert.equal(existsSync(made), false, 'checking made the folder');
  assert.equal(await openFolder(made), made);
  if (process.platform !== 'win32') assert.equal(statSync(made).mode & 0o777, 0o700);
  const file = join(root, 'a-file');
  writeFileSync(file, 'x');
  await assert.rejects(checkFolder(file), refusal(/cannot save into .*: it is a file/, 'BAD_DATA'));
  await assert.rejects(checkFolder(join(file, 'below')), refusal(/part of the path is a file/, 'BAD_DATA'));
  await assert.rejects(openFolder(file), refusal(/it is a file/, 'BAD_DATA'));
  // A link the person named goes where they meant: the folder saved into is the one it points at.
  const target = join(root, 'target');
  mkdirSync(target);
  symlinkSync(target, join(root, 'link'));
  assert.equal(await openFolder(join(root, 'link')), target);
});

// ── Asked, and claimed ─────────────────────────────────────────────────────────────────────────────────────────

test('the question shows both folders by their exact paths, and names the files by count and size', async () => {
  const { core } = machine();
  const question = await askWhereToSave(core, {
    request: REQUEST,
    folders: { downloads: '/srv/sam/Downloads', current: '/work/project' },
    configured: false,
    count: 2,
    bytes: 2048,
    surface: 'mcp',
    tool: 'gmail_attachment_download',
  });
  assert.equal(question.destinationRequired, true);
  assert.match(question.question, /^Where should the 2 files \(2\.0 KB\) from acme\/gmail be saved\?/);
  assert.match(question.question, /1\. Downloads — \/srv\/sam\/Downloads \(the default\)/);
  assert.match(question.question, /2\. The current folder — \/work\/project/);
  assert.match(question.question, /3\. Another folder/);
  assert.deepEqual(question.options, [
    { choice: 'downloads', path: '/srv/sam/Downloads', default: true },
    { choice: 'current', path: '/work/project' },
    { choice: 'other' },
  ]);
  assert.match(question.next, /never choose for them/);
  assert.match(question.next, new RegExp(`choiceId "${question.choiceId}"`));
  const record = await core.approvals.get(question.choiceId);
  assert.equal(record?.kind, 'download');
  assert.equal(record?.expect.subject, 'where to save 2 files from acme/gmail');
});

test('an answer is saved where the question said, even when the download is made again from another folder', async () => {
  const { core, env, home } = machine();
  const offered = { downloads: join(home, 'Downloads'), current: join(home, 'where-it-was-asked') };
  const { approvalId } = await core.approvals.createDownload({ download: binding(offered) });
  const settled = await settleDestination(core, {
    answer: { kind: 'choice', answer: { choice: 'current' }, choiceId: approvalId },
    request: REQUEST,
    folders: () => ({ downloads: join(home, 'Downloads'), current: join(home, 'somewhere-else') }),
    env,
  });
  assert.deepEqual(settled, { folder: offered.current, choice: 'current', choiceId: approvalId });
  assert.equal(existsSync(join(home, 'somewhere-else')), false);
});

test('a folder that is a file is refused before the question is spent on it', async () => {
  const { core, env, home } = machine();
  writeFileSync(join(home, 'not-a-folder'), 'x');
  const { approvalId } = await core.approvals.createDownload({ download: binding() });
  await assert.rejects(
    settleDestination(core, {
      answer: { kind: 'choice', answer: { choice: 'other', folder: join(home, 'not-a-folder') }, choiceId: approvalId },
      request: REQUEST,
      folders: () => ({ downloads: '/d', current: '/c' }),
      env,
    }),
    refusal(/it is a file/, 'BAD_DATA'),
  );
  assert.equal((await core.approvals.get(approvalId))?.state, 'pending', 'the question was spent');
});

// ── At a terminal ──────────────────────────────────────────────────────────────────────────────────────────────

/** Streams a person answers: each prompt on stderr gets the next answer. */
function terminal(answers: string[], tty = true) {
  const stdin = Object.assign(new PassThrough(), { isTTY: tty });
  const stdout = Object.assign(new PassThrough(), { isTTY: tty });
  const stderr = new PassThrough();
  let out = '';
  let err = '';
  const queue = [...answers];
  stdout.on('data', (chunk) => {
    out += String(chunk);
  });
  stderr.on('data', (chunk) => {
    err += String(chunk);
    if (/\) $/.test(String(chunk)) && queue.length > 0) {
      const answer = queue.shift() as string;
      setImmediate(() => stdin.write(`${answer}\n`));
    }
  });
  return { streams: { stdin, stdout, stderr } as unknown as Streams, out: () => out, err: () => err };
}

/** A download that records what it was called with, and asks until it is answered. */
function recorder(core: Core) {
  const calls: DownloadAnswer[] = [];
  const download = async (answer: DownloadAnswer): Promise<unknown> => {
    calls.push(answer);
    if (answer.saveTo !== undefined) return { destinationRequired: false, saved: answer.saveTo };
    return {
      ...(await askWhereToSave(core, {
        request: REQUEST,
        folders: { downloads: '/srv/sam/Downloads', current: '/work/project' },
        configured: false,
        count: 2,
        bytes: 10,
        surface: 'cli',
        tool: 'gmail_attachment_download',
      })),
      files: [],
    };
  };
  return { calls, download };
}

const render = (question: DestinationQuestion) => `FILES\n${question.question}`;

test('a person at a terminal is shown the question and answers 1, 2 or 3 — Enter is 1, and 3 asks for the folder', async () => {
  const { core, env } = machine();
  for (const [answers, saveTo] of [
    [['1'], 'downloads'],
    [[''], 'downloads'],
    [['2'], 'current'],
    [['3', 'Invoices', '~/Invoices'], '~/Invoices'],
  ] as const) {
    const { calls, download } = recorder(core);
    const term = terminal([...answers]);
    const result = await downloadAtTerminal({
      core,
      download,
      env,
      output: { color: false },
      command: 'agent-gmail attachments download m1 --inbox acme/gmail',
      render,
      streams: term.streams,
    });
    assert.deepEqual(result, { destinationRequired: false, saved: saveTo }, answers.join('/'));
    assert.match(term.out(), /FILES\nWhere should the 2 files/);
    assert.equal(calls.length, 2);
    assert.deepEqual(calls[0], {});
    assert.equal(calls[1]?.saveTo, saveTo);
    assert.match(String(calls[1]?.choiceId), /^ap_/);
    if (answers[0] === '3') assert.match(term.err(), /relative path/, 'the relative folder was not refused');
  }
});

test('anything else at the terminal cancels, saves nothing, and revokes the question', async () => {
  const { core, env } = machine();
  const { calls, download } = recorder(core);
  const term = terminal(['n']);
  await assert.rejects(
    downloadAtTerminal({ core, download, env, output: { color: false }, command: 'x', render, streams: term.streams }),
    refusal(/cancelled: nothing was saved/, 'USAGE'),
  );
  assert.equal(calls.length, 1);
  const [question] = await core.approvals.list();
  assert.equal(question?.state, 'revoked');
});

test('an agent, or no terminal, gets the question and its choice id, exit 10, and nothing is saved', async () => {
  const { core, env } = machine();
  for (const [label, extraEnv, tty, json] of [
    ['an agent at a terminal', { CLAUDECODE: '1' }, true, false],
    ['no terminal', {}, false, false],
    ['--json', {}, true, true],
  ] as const) {
    const { calls, download } = recorder(core);
    const term = terminal([], tty);
    let thrown: unknown;
    try {
      await downloadAtTerminal({
        core,
        download,
        env: { ...env, ...extraEnv },
        output: { color: false, json },
        command: 'agent-gmail attachments download m1 --inbox acme/gmail',
        render,
        streams: term.streams,
      });
    } catch (error) {
      thrown = error;
    }
    assert.ok(thrown instanceof CommsError, label);
    assert.equal(thrown.code, 'APPROVAL_PENDING', label);
    assert.equal(thrown.exitCode, 10, label);
    const choiceId = String(thrown.details?.choiceId);
    assert.match(choiceId, /^ap_/, label);
    assert.match(
      thrown.hint ?? '',
      new RegExp(
        `agent-gmail attachments download m1 --inbox acme/gmail --to <downloads\\|current\\|folder> --choice ${choiceId}`,
      ),
      label,
    );
    assert.equal(calls.length, 1, `${label}: it saved without an answer`);
    // Printed for an agent reading plain output; with --json it is in the envelope's details instead.
    assert.equal(/Where should the 2 files/.test(term.out()), !json, label);
  }
});

test('`--to` saves as a person’s own answer unless an agent gave it; `--choice` makes it an answer to that question', async () => {
  const { core, env } = machine();
  const choice = 'ap_0000000000000000000000000A';
  for (const [label, extraEnv, to, given, personChose] of [
    ['a person’s script', {}, 'current', undefined, true],
    ['an agent', { CODEX_HOME: '/x' }, 'current', undefined, false],
    ['an agent with the question’s id', { CODEX_HOME: '/x' }, 'downloads', choice, false],
  ] as const) {
    const { calls, download } = recorder(core);
    await downloadAtTerminal({
      core,
      download,
      to,
      choice: given,
      env: { ...env, ...extraEnv },
      output: { color: false },
      command: 'x',
      render,
      streams: terminal([], false).streams,
    });
    assert.deepEqual(calls, [{ saveTo: to, choiceId: given, personChose }], label);
  }
  assert.equal(existsSync(join(core.paths.stateDir, 'approvals')), false, 'a question was asked');
});
