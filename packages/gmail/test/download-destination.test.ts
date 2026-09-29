import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { test } from 'node:test';
import { gatedChange, updateCheckPath, updateLaterChange } from '@agentcomms/core';
import type { FakeMessage } from './support/fake-google.ts';
import { type Harness, newHarness, tempDir } from './support/harness.ts';
import { cli, connect, type ToolResult, toolError, wire } from './support/surfaces.ts';

/*
 * `gmail_attachment_download` and `agent-gmail attachments download` ask the person where to save before they save
 * anything: Downloads, the current folder, or a folder they name. The tool answers the first call with the question
 * and a choice id; the command asks a person at a terminal there and then, answers an agent as the tool does (exit 10),
 * and takes a person's own `--to` in a script. Every folder here is a temporary one: the harness's home stands for the
 * person's, and each server and command is started "in" a temporary folder of its own.
 */

function base64url(text: string): string {
  return Buffer.from(text, 'utf8').toString('base64url');
}

const MESSAGE: FakeMessage = {
  id: 'm1',
  threadId: 'm1',
  labelIds: ['INBOX'],
  internalDate: String(Date.parse('2026-09-15T09:00:00Z')),
  payload: {
    partId: '',
    mimeType: 'multipart/mixed',
    headers: [
      { name: 'From', value: 'Sam Lee <sam@partner.test>' },
      { name: 'Subject', value: 'Invoice for August' },
    ],
    parts: [
      { partId: '0', mimeType: 'text/plain', body: { size: 2, data: base64url('hi') } },
      {
        partId: '1',
        mimeType: 'application/pdf',
        filename: 'invoice.pdf',
        headers: [{ name: 'Content-Disposition', value: 'attachment; filename="invoice.pdf"' }],
        body: { size: 13, attachmentId: 'a1' },
      },
    ],
  },
};

async function mailbox(): Promise<{ harness: Harness; home: string; downloads: string; cwd: string }> {
  const harness = await newHarness({
    accounts: [
      { sub: 'sub-1', email: 'jo@example.test', messages: { m1: MESSAGE }, attachments: { a1: 'invoice bytes' } },
    ],
  });
  await harness.connectInbox({ alias: 'work', email: 'jo@example.test', sub: 'sub-1' });
  return {
    harness,
    home: harness.configDir,
    downloads: join(harness.configDir, 'Downloads'),
    cwd: tempDir('agent-gmail-cwd-'),
  };
}

async function listing(folder: string): Promise<string[]> {
  try {
    return (await readdir(folder)).sort();
  } catch {
    return [];
  }
}

const code = (result: ToolResult) =>
  (result.structuredContent as { error?: { code?: string } } | undefined)?.error?.code;

// ── Over MCP ────────────────────────────────────────────────────────────────────────────────────────────────────

test('gmail_attachment_download asks first, with both folders by path, and saves where the answer says', async () => {
  const { harness, downloads, cwd, home } = await mailbox();
  const { call, close } = await connect({ core: harness.core, env: harness.env, cwd });
  try {
    for (const [saveTo, folder] of [
      ['downloads', downloads],
      ['current', cwd],
      [join(tempDir('agent-gmail-other-'), 'made'), undefined],
      ['~/Invoices', join(home, 'Invoices')],
    ] as const) {
      const asked = wire(await call('gmail_attachment_download', { inbox: 'work', messageIds: ['m1'] }));
      assert.equal(asked.destinationRequired, true);
      assert.deepEqual(asked.options, [
        { choice: 'downloads', path: downloads, default: true },
        { choice: 'current', path: cwd },
        { choice: 'other' },
      ]);
      assert.match(String(asked.question), /Where should the 1 file \(13 bytes\) from work be saved\?/);
      assert.equal((asked.files as Array<{ size: number }>)[0]?.size, 13);
      assert.match(String(asked.next), /call gmail_attachment_download again/);

      const saved = wire(
        await call('gmail_attachment_download', {
          inbox: 'work',
          messageIds: ['m1'],
          saveTo,
          choiceId: asked.choiceId,
        }),
      );
      assert.equal(saved.destinationRequired, false);
      const expected = folder ?? saveTo;
      assert.equal(saved.folder, expected, saveTo);
      const [file] = saved.files as Array<{ path: string; savedAs: string; size: number; from: string }>;
      assert.equal(file?.path, join(expected, file?.savedAs ?? ''), saveTo);
      assert.equal(file?.from, 'sam@partner.test');
      assert.equal(await readFile(file?.path ?? '', 'utf8'), 'invoice bytes', saveTo);
    }
    // Downloads got one file, the current folder one: each answer went where it said, and nowhere else.
    assert.deepEqual(await listing(downloads), ['invoice.pdf']);
    assert.deepEqual(await listing(cwd), ['invoice.pdf']);
  } finally {
    await close();
  }
});

test('gmail_attachment_download refuses `out` with what replaced it, and an answer the person was not asked for', async () => {
  const { harness, downloads, cwd } = await mailbox();
  const { call, close } = await connect({ core: harness.core, env: harness.env, cwd });
  try {
    const out = toolError(await call('gmail_attachment_download', { inbox: 'work', messageIds: ['m1'], out: 'x' }));
    assert.equal(out.code, 'USAGE');
    assert.equal(out.message, 'gmail_attachment_download no longer takes `out`');
    assert.match(out.hint ?? '', /`saveTo`/);
    const bare = toolError(
      await call('gmail_attachment_download', { inbox: 'work', messageIds: ['m1'], saveTo: 'downloads' }),
    );
    assert.equal(bare.code, 'USAGE');
    assert.match(bare.message, /`saveTo` answers the download’s question, and needs its `choiceId`/);
    const asked = wire(await call('gmail_attachment_download', { inbox: 'work', messageIds: ['m1'] }));
    const relative = toolError(
      await call('gmail_attachment_download', {
        inbox: 'work',
        messageIds: ['m1'],
        saveTo: 'Invoices',
        choiceId: asked.choiceId,
      }),
    );
    assert.match(relative.message, /is a relative path/);
    assert.deepEqual(await listing(downloads), []);
    assert.deepEqual(await listing(cwd), []);
  } finally {
    await close();
  }
});

// ── At the command line ──────────────────────────────────────────────────────────────────────────────────────────

test('agent-gmail attachments download asks a person at a terminal — 1, 2 or 3 — and saves where they said', async () => {
  const { harness, downloads, cwd } = await mailbox();
  const argv = ['attachments', 'download', 'm1', '--inbox', 'work'];
  const other = join(tempDir('agent-gmail-other-'), 'Invoices');
  for (const [replies, folder] of [
    [[[/Save them to/, '1']], downloads],
    [[[/Save them to/, '2']], cwd],
    [
      [
        [/Save them to/, '3'],
        [/Which folder\?/, other],
      ],
      other,
    ],
  ] as const) {
    const run = await cli(harness, argv, { tty: true, cwd, replies });
    assert.equal(run.code, 0, run.stderr);
    // The question first: the file, and both folders by path.
    assert.match(run.stdout, /13 bytes · message m1 · part 1 · from sam@partner\.test/);
    assert.ok(run.stdout.includes(`1. Downloads — ${downloads} (the default)`), run.stdout);
    assert.ok(run.stdout.includes(`2. The current folder — ${cwd}`), run.stdout);
    assert.ok(run.stdout.includes(` ${join(folder, 'invoice.pdf')} · 13 bytes · from sam@partner.test`), run.stdout);
    assert.ok(run.stdout.includes(`1 file(s), 13 bytes, saved in ${folder}.`), run.stdout);
    assert.equal(await readFile(join(folder, 'invoice.pdf'), 'utf8'), 'invoice bytes');
  }
  // Anything else cancels: nothing saved, and the question is spent on nothing.
  const cancelled = await cli(harness, argv, { tty: true, cwd, replies: [[/Save them to/, 'no']] });
  assert.equal(cancelled.code, 64, cancelled.stderr);
  assert.match(cancelled.stderr, /cancelled: nothing was saved/);
  assert.deepEqual(await listing(downloads), ['invoice.pdf']);
});

test('agent-gmail attachments download: an agent gets the question and a choice id (exit 10), and saves on its rerun', async () => {
  const { harness, downloads, cwd } = await mailbox();
  const argv = ['attachments', 'download', 'm1', '--inbox', 'work'];
  const agent = { AGENT_COMMS_AGENT: '1' };
  const asked = await cli(harness, [...argv, '--json'], { cwd, env: agent });
  assert.equal(asked.code, 10, asked.stdout);
  const error = asked.envelope().error;
  assert.equal(error?.code, 'APPROVAL_PENDING');
  const choiceId = String(error?.details?.choiceId);
  assert.match(choiceId, /^ap_/);
  assert.deepEqual(error?.details?.options, [
    { choice: 'downloads', path: downloads, default: true },
    { choice: 'current', path: cwd },
    { choice: 'other' },
  ]);
  assert.match(error?.hint ?? '', new RegExp(`--to <downloads\\|current\\|folder> --choice ${choiceId}`));
  assert.deepEqual(await listing(downloads), [], 'saved before anybody answered');

  // Printed for an agent reading plain output, as a change's preview is.
  const printed = await cli(harness, argv, { cwd, env: agent });
  assert.equal(printed.code, 10);
  assert.ok(printed.stdout.includes(`1. Downloads — ${downloads} (the default)`), printed.stdout);

  // `--to` alone, from an agent: refused, for want of the question it would answer.
  const alone = await cli(harness, [...argv, '--to', 'downloads', '--json'], { cwd, env: agent });
  assert.equal(alone.code, 64, alone.stdout);
  assert.match(
    alone.envelope().error?.message ?? '',
    /`--to` answers the download’s question, and needs its `--choice`/,
  );
  assert.deepEqual(await listing(downloads), []);

  // The rerun with the person's answer saves, where they said.
  const saved = await cli(harness, [...argv, '--to', 'current', '--choice', choiceId, '--json'], { cwd, env: agent });
  assert.equal(saved.code, 0, saved.stdout);
  const data = saved.envelope<{ folder: string; files: Array<{ path: string }> }>().data;
  assert.equal(data?.folder, cwd);
  assert.deepEqual(await listing(cwd), ['invoice.pdf']);
  // Once: the same choice again is refused.
  const again = await cli(harness, [...argv, '--to', 'current', '--choice', choiceId, '--json'], { cwd, env: agent });
  assert.equal(again.code, 10, again.stdout);
  assert.match(again.envelope().error?.message ?? '', /answered already/);
});

test('agent-gmail attachments download --to: a person’s script decides by flag, with nobody to ask', async () => {
  const { harness, downloads, cwd } = await mailbox();
  const run = await cli(harness, ['attachments', 'download', 'm1', '--inbox', 'work', '--to', 'downloads', '--json'], {
    cwd,
  });
  assert.equal(run.code, 0, run.stdout);
  assert.equal(run.envelope<{ folder: string }>().data?.folder, downloads);
  assert.deepEqual(await listing(downloads), ['invoice.pdf']);
  assert.deepEqual(await harness.core.approvals.list(), [], 'a question was kept that nobody was asked');
});

test('agent-gmail attachments download --out is refused with what replaced it', async () => {
  const { harness, downloads } = await mailbox();
  const run = await cli(harness, ['attachments', 'download', 'm1', '--inbox', 'work', '--out', 'reports', '--json']);
  assert.equal(run.code, 64, run.stdout);
  const error = run.envelope().error;
  assert.match(error?.message ?? '', /`--out` is no longer taken/);
  assert.match(error?.hint ?? '', /--to downloads, --to current, or --to <folder>/);
  assert.deepEqual(await listing(downloads), []);
  // And `--help` no longer offers it.
  const help = await cli(harness, ['attachments', 'download', '--help']);
  assert.doesNotMatch(help.stdout, /--out/);
  assert.match(help.stdout, /--to <where>/);
});

test('the command and the tool answer with the same question and the same saved result', async () => {
  const { harness, cwd } = await mailbox();
  const { call, close } = await connect({ core: harness.core, env: harness.env, cwd });
  try {
    const tool = wire(await call('gmail_attachment_download', { inbox: 'work', messageIds: ['m1'] }));
    const command = await cli(harness, ['attachments', 'download', 'm1', '--inbox', 'work', '--json'], {
      cwd,
      env: { AGENT_COMMS_AGENT: '1' },
    });
    const details = command.envelope().error?.details ?? {};
    // Each answer wraps with a boundary of its own, and names its own id and next step; the rest is the same.
    const unbound = (value: unknown): unknown =>
      typeof value === 'string'
        ? value.replace(/boundary="[^"]+"/g, 'boundary=""')
        : Array.isArray(value)
          ? value.map(unbound)
          : value !== null && typeof value === 'object'
            ? Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, unbound(entry)]))
            : value;
    const same = (value: Record<string, unknown>) => {
      const { choiceId: _id, expiresAt: _at, next: _next, ...rest } = value;
      return unbound(rest);
    };
    assert.deepEqual(same(details), same(tool));

    const savedTool = wire(
      await call('gmail_attachment_download', {
        inbox: 'work',
        messageIds: ['m1'],
        saveTo: 'current',
        choiceId: tool.choiceId,
      }),
    );
    const savedCommand = await cli(
      harness,
      [
        'attachments',
        'download',
        'm1',
        '--inbox',
        'work',
        '--to',
        'current',
        '--choice',
        String(details.choiceId),
        '--json',
      ],
      { cwd, env: { AGENT_COMMS_AGENT: '1' } },
    );
    const data = savedCommand.envelope<Record<string, unknown>>().data ?? {};
    assert.deepEqual(Object.keys(data).sort(), Object.keys(savedTool).sort());
    assert.equal(data.folder, savedTool.folder);
    assert.equal(data.chosen, savedTool.chosen);
  } finally {
    await close();
  }
});

// ── The update check's stop ───────────────────────────────────────────────────────────────────────────────────

function updateOut(harness: Harness): void {
  harness.env.AGENT_COMMS_UPDATE_CHECK = 'on';
  harness.env.npm_config_registry = 'http://127.0.0.1:9/';
  const stateDir = harness.core.paths.stateDir;
  mkdirSync(stateDir, { recursive: true });
  writeFileSync(
    updateCheckPath(stateDir),
    JSON.stringify({ lastChecked: new Date().toISOString(), latest: '99.0.0', behind: true, current: null }),
  );
}

test('the update stop lets the person’s answer through by its choice id, and stops a bare saveTo or --to', async () => {
  const { harness, downloads, cwd } = await mailbox();
  const { call, close } = await connect({ core: harness.core, env: harness.env, cwd });
  let choiceId: string;
  try {
    // Asked before the update was found, as a question answered moments before the check landed.
    choiceId = String(wire(await call('gmail_attachment_download', { inbox: 'work', messageIds: ['m1'] })).choiceId);
  } finally {
    await close();
  }
  updateOut(harness);
  const stopped = await connect({ core: harness.core, env: harness.env, cwd });
  try {
    const args = { inbox: 'work', messageIds: ['m1'] };
    assert.equal(code(await stopped.call('gmail_attachment_download', args)), 'UPDATE_REQUIRED', 'a new request');
    assert.equal(
      code(await stopped.call('gmail_attachment_download', { ...args, saveTo: 'downloads' })),
      'UPDATE_REQUIRED',
      'a bare saveTo',
    );
    const answered = await stopped.call('gmail_attachment_download', { ...args, saveTo: 'downloads', choiceId });
    assert.equal(answered.isError, undefined, JSON.stringify(answered.structuredContent));
    assert.deepEqual(await listing(downloads), ['invoice.pdf']);
  } finally {
    await stopped.close();
  }

  // The command the same way: `--to` alone is stopped, and so is another kind's approval passed as `--choice`;
  // `--choice` of a question still waiting goes through.
  const bare = await cli(harness, ['attachments', 'download', 'm1', '--inbox', 'work', '--to', 'current', '--json'], {
    cwd,
  });
  assert.equal(bare.code, 11, bare.stdout);
  const prepared = await gatedChange(harness.core, updateLaterChange(harness.core), { surface: 'mcp' });
  const change = (prepared as { prepared: { approvalId: string } }).prepared.approvalId;
  const borrowed = await cli(
    harness,
    ['attachments', 'download', 'm1', '--inbox', 'work', '--to', 'current', '--choice', change, '--json'],
    { cwd },
  );
  assert.equal(borrowed.code, 11, borrowed.stdout);
  assert.equal((await harness.core.approvals.get(change))?.state, 'pending', 'the change’s approval was spent');
  updateOut(harness);
  const { call: ask, close: closeAsk } = await connect({
    core: harness.core,
    env: { ...harness.env, AGENT_COMMS_UPDATE_CHECK: 'off' },
    cwd,
  });
  let second: string;
  try {
    second = String(wire(await ask('gmail_attachment_download', { inbox: 'work', messageIds: ['m1'] })).choiceId);
  } finally {
    await closeAsk();
  }
  const claimed = await cli(
    harness,
    ['attachments', 'download', 'm1', '--inbox', 'work', '--to', 'current', '--choice', second, '--json'],
    { cwd },
  );
  assert.equal(claimed.code, 0, claimed.stdout);
  assert.deepEqual(await listing(cwd), ['invoice.pdf']);
});
