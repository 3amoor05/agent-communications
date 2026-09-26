import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';
import { type Harness, newHarness, ok, refused, type ToolResult } from './support/harness.ts';

/**
 * Both surfaces of every paired command and tool, run against the same fake Resend, return the same thing.
 *
 * Which command pairs with which tool, and that both reach the one operation, is `capabilities.json`'s: the
 * repository's parity check (`scripts/parity.mjs`, and `test/parity.test.mjs`) reads the command tree from this CLI's
 * help and the tools from a running server, and drives both sides of every row to its operation. What it cannot see is
 * that they then give the same answer — the same data, the same preview, the same refusal — which is what this adds.
 */

let harness: Harness;
afterEach(async () => {
  await harness?.close();
});

// ── Both sides, compared ─────────────────────────────────────────────────────────────────────────────────────────

const RECEIVED = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const ATTACHMENT = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';

/** What differs between two calls of the same operation and says nothing about parity. */
function normalise(value: unknown): unknown {
  return JSON.parse(
    JSON.stringify(value)
      .replace(/boundary=\\"[^\\"]+\\"/g, 'boundary=\\"B\\"')
      .replace(/ap_[0-9A-Z]{26}/g, 'ap_X')
      .replace(/rp_[0-9A-Z]{26}/g, 'rp_X')
      .replace(/"expiresAt":"[^"]+"/g, '"expiresAt":"T"')
      .replace(/"(createdAt|updatedAt|attemptedAt|finishedAt|at)":"[^"]+"/g, '"$1":"T"'),
  );
}

async function cliData(argv: string[]): Promise<{ code: number; data: unknown; error?: Record<string, unknown> }> {
  const result = await harness.cli(['--json', ...argv], { env: { CLAUDECODE: '1' } });
  const envelope = result.json<unknown>();
  return { code: result.code, data: envelope.data, ...(envelope.error ? { error: envelope.error } : {}) };
}

async function seed(): Promise<void> {
  await harness.addAccount({ name: 'acme/resend', mode: 'send' });
  harness.fake.received = [
    {
      id: RECEIVED,
      from: 'Sam Lee <sam@partner.test>',
      to: ['hello@acme.test'],
      subject: 'Plan',
      text: 'Hello team.',
      attachments: [
        { id: ATTACHMENT, filename: 'plan.txt', content_type: 'text/plain', bytes: new TextEncoder().encode('plan') },
      ],
    },
  ];
  harness.fake.suppressions = [
    {
      id: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
      email: 'gone@partner.test',
      origin: 'bounce',
      source_id: null,
      created_at: '2026-09-20',
    },
  ];
}

const SEND = {
  from: 'hello@acme.test',
  to: ['sam@partner.test'],
  cc: ['ana@partner.test'],
  bcc: ['audit@acme.test'],
  subject: 'Phase 2',
  text: 'Hi Sam',
};
const sendArgv = [
  '--account',
  'acme/resend',
  '--from',
  SEND.from,
  '--to',
  'sam@partner.test',
  '--cc',
  'ana@partner.test',
  '--bcc',
  'audit@acme.test',
  '--subject',
  SEND.subject,
  '--text',
  SEND.text,
];

test('reads: the command and the tool return the same data', async () => {
  harness = await newHarness();
  await seed();
  const { call, close } = await harness.mcp();
  try {
    const pairs: [string[], string, Record<string, unknown>][] = [
      [['account', 'list'], 'resend_accounts_list', {}],
      [['account', 'show', 'acme/resend'], 'resend_account_show', { account: 'acme/resend' }],
      [['account', 'policy', 'acme/resend'], 'resend_account_policy', { account: 'acme/resend' }],
      [['doctor'], 'resend_doctor', {}],
      [
        ['domains', '--account', 'acme/resend', '--domain', 'acme.test'],
        'resend_domains',
        { account: 'acme/resend', domain: 'acme.test' },
      ],
      [
        ['emails', 'list', '--account', 'acme/resend', '--limit', '5'],
        'resend_emails_list',
        { account: 'acme/resend', limit: 5 },
      ],
      [['received', 'list', '--account', 'acme/resend'], 'resend_received_list', { account: 'acme/resend' }],
      [
        ['received', 'show', RECEIVED, '--account', 'acme/resend'],
        'resend_received_show',
        { account: 'acme/resend', id: RECEIVED },
      ],
      [
        ['metrics', '--account', 'acme/resend', '--start', '2026-09-01'],
        'resend_metrics',
        { account: 'acme/resend', start: '2026-09-01' },
      ],
      [
        ['suppressions', '--account', 'acme/resend', '--origin', 'bounce'],
        'resend_suppressions',
        { account: 'acme/resend', origin: 'bounce' },
      ],
      [['scheduled', 'list', '--account', 'acme/resend'], 'resend_scheduled_list', { account: 'acme/resend' }],
    ];
    for (const [argv, tool, args] of pairs) {
      const cli = await cliData(argv);
      assert.equal(cli.code, 0, `${argv.join(' ')}: ${JSON.stringify(cli.error)}`);
      assert.deepEqual(normalise(cli.data), normalise(ok(await call(tool, args))), `${argv.join(' ')} ≠ ${tool}`);
    }
    // The same refusal, in the same words, from both.
    const cli = await cliData(['emails', 'list', '--account', 'acme/resend', '--limit', '0']);
    const tool = refused(await call('resend_emails_list', { account: 'acme/resend', limit: 0 }));
    assert.equal(cli.error?.code, tool.code);
    assert.equal(cli.error?.message, tool.message);
  } finally {
    await close();
  }
});

test('downloads: both save the same bytes, inside the same jail', async () => {
  harness = await newHarness();
  await seed();
  const { call, close } = await harness.mcp();
  try {
    const cli = (await cliData(['received', 'download', RECEIVED, '--account', 'acme/resend'])).data as {
      files: { sha256: string; size: number; path: string }[];
    };
    const tool = ok<{ files: { sha256: string; size: number; path: string }[] }>(
      await call('resend_received_download', { account: 'acme/resend', id: RECEIVED }),
    );
    assert.equal(cli.files[0]?.sha256, tool.files[0]?.sha256);
    assert.equal(cli.files[0]?.size, tool.files[0]?.size);
    assert.ok(cli.files[0]?.path.startsWith(harness.core.paths.downloadsDir));
    assert.ok(tool.files[0]?.path.startsWith(harness.core.paths.downloadsDir));
  } finally {
    await close();
  }
});

test('sending: the same preview, the same execute, the same status from both surfaces', async () => {
  harness = await newHarness();
  await seed();
  const { call, close } = await harness.mcp();
  try {
    const fromCli = (await cliData(['send', 'prepare', ...sendArgv])).data as Record<string, unknown>;
    const fromTool = ok(await call('resend_send_prepare', { account: 'acme/resend', ...SEND }));
    assert.deepEqual(normalise(fromCli), normalise(fromTool));

    const cliSent = await cliData([
      'send',
      'execute',
      String(fromCli.approvalId),
      '--account',
      'acme/resend',
      '--expect-to',
      'sam@partner.test',
      '--expect-cc',
      'ana@partner.test',
      '--expect-bcc',
      'audit@acme.test',
      '--expect-subject',
      SEND.subject,
    ]);
    assert.equal(cliSent.code, 0, JSON.stringify(cliSent.error));
    const toolSent = ok(
      await call('resend_send_execute', {
        account: 'acme/resend',
        approvalId: fromTool.approvalId,
        expect: fromTool.expect,
      }),
    );
    const strip = (value: unknown) => ({ ...(value as Record<string, unknown>), resendId: 'R', approvalId: 'A' });
    assert.deepEqual(strip(cliSent.data), strip(toolSent));
    assert.equal(harness.fake.sends().length, 2);

    const cliStatus = (await cliData(['send', 'status', String(fromCli.approvalId), '--account', 'acme/resend'])).data;
    const toolStatus = ok(
      await call('resend_send_status', { account: 'acme/resend', approvalId: fromTool.approvalId }),
    );
    const uuid = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g;
    const loose = (value: unknown) =>
      JSON.parse(
        JSON.stringify(normalise(value))
          .replace(uuid, 'U')
          .replace(/<[^>"]+@example\.test>/g, 'M'),
      );
    assert.deepEqual(loose(cliStatus), loose(toolStatus));
  } finally {
    await close();
  }
});

test('changes: the command and the tool prepare the same approval, and either can claim the other’s', async () => {
  harness = await newHarness();
  await seed();
  const { call, close } = await harness.mcp();
  try {
    // A loosening, prepared from the CLI and claimed by the tool.
    const cli = await cliData(['account', 'policy', 'acme/resend', '--send', 'chat']);
    await harness.cli(['account', 'policy', 'acme/resend', '--send', 'confirm'], { env: { CLAUDECODE: '1' } });
    const fromCli = await cliData(['account', 'policy', 'acme/resend', '--send', 'chat']);
    assert.equal(fromCli.code, 10);
    const fromTool = ok<{ preview: string; approvalId: string }>(
      await call('resend_account_policy', { account: 'acme/resend', sendPolicy: 'chat' }),
    );
    assert.equal(cli.code, 0, 'chat → chat loosens nothing and applies');
    const details = fromCli.error?.details as { preview: string; approvalId: string };
    assert.deepEqual(normalise(details.preview), normalise(fromTool.preview));
    const claimed = ok<{ applied: boolean }>(
      await call('resend_account_policy', {
        account: 'acme/resend',
        sendPolicy: 'chat',
        approvalId: details.approvalId,
      }),
    );
    assert.equal(claimed.applied, true);

    // Removing, prepared by the tool and claimed by the command.
    const remove = ok<{ approvalId: string; preview: string }>(
      await call('resend_account_remove', { account: 'acme/resend' }),
    );
    const removeCli = await cliData(['account', 'remove', 'acme/resend']);
    const removePreview = (removeCli.error?.details as { preview?: string } | undefined)?.preview;
    assert.deepEqual(normalise(removePreview), normalise(remove.preview));
    const removed = await cliData(['account', 'remove', 'acme/resend', '--approval', remove.approvalId]);
    assert.equal(removed.code, 0, JSON.stringify(removed.error));
  } finally {
    await close();
  }
});

test('cancelling a scheduled email: the same from both, including the approval for one scheduled elsewhere', async () => {
  harness = await newHarness();
  await seed();
  const at = new Date(Date.now() + 3600 * 1000).toISOString();
  const { call, close } = await harness.mcp();
  try {
    const scheduled = async () => {
      const prepared = ok<{ approvalId: string; expect: Record<string, unknown> }>(
        await call('resend_send_prepare', { account: 'acme/resend', ...SEND, scheduledAt: at }),
      );
      return ok<{ resendId: string }>(
        await call('resend_send_execute', {
          account: 'acme/resend',
          approvalId: prepared.approvalId,
          expect: prepared.expect,
        }),
      ).resendId;
    };
    const first = await scheduled();
    const second = await scheduled();
    const cli = await cliData(['scheduled', 'cancel', first, '--account', 'acme/resend']);
    const tool = ok(await call('resend_scheduled_cancel', { account: 'acme/resend', id: second }));
    assert.deepEqual({ ...(cli.data as object), id: 'X' }, { ...(tool.result as object), id: 'X' });
    assert.equal((tool as { applied: boolean }).applied, true);
  } finally {
    await close();
  }
});

/** Keeps `ToolResult` in use for readers of this file: every call above is one. */
export type { ToolResult };
