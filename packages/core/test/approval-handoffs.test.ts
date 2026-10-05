import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { PassThrough } from 'node:stream';
import { test } from 'node:test';
import { APPROVAL_WAITS, approvalWaitOf } from '../src/approval-handoffs.ts';
import { asV2 } from '../src/approval-stored.ts';
import { approveChangeAtTerminal, type GatedChange, gatedChangeAtTerminal } from '../src/change-flow.ts';
import { type ChangeRequest, claimChange, prepareChange } from '../src/changes.ts';
import { inlineCommand, type Streams } from '../src/cli-runtime.ts';
import type { AccountConfig } from '../src/config.ts';
import { type Core, openCore } from '../src/core.ts';
import { CommsError } from '../src/errors.ts';
import { CORE_CALLER, type Handoff, isCommand } from '../src/handoffs.ts';
import { askWhereToSave, downloadAtTerminal, settleDestination } from '../src/save-destination.ts';
import { assertNoBareCommand, coreHandoffs } from './helpers/handoffs.ts';
import { tempDir } from './helpers/temp.ts';

/*
 * Every approval core hands to a person names the person's command and the agent's wait (design 2026-10-05 §D3 and
 * §D7, §5 D7-b): its own `approve`, located, and `comms_approval_wait` over MCP or its own `approval wait`, located, at
 * the command line — for a change on either surface and a download's question, quoted for POSIX and for Windows. The
 * code under test is given the platform the expectation is rendered for, and nothing here runs a shell: the real-shell
 * tests paste them (`test/real-shell-handoffs.test.mjs`).
 */

const PLATFORMS = ['darwin', 'win32'] as const;
const ACME = 'acc_AAAAAAAAAAAAAAAA';
const FOUR = ['--config-dir', '--state-dir', '--data-dir', '--secrets-dir'];

function account(over: Partial<AccountConfig> = {}): AccountConfig {
  return {
    id: ACME,
    platform: 'slack',
    workspace: 'T_ACME',
    userId: 'U_AAAA',
    tier: 'read',
    mode: 'read',
    grantedScopes: [],
    secretRef: `slack/token/${ACME}`,
    createdAt: '2026-09-20T00:00:00.000Z',
    ...over,
  };
}

/** A core whose changes are approved at a terminal: the change policy is confirm. */
function confirmCore(): { core: Core; dir: string } {
  const dir = tempDir();
  const body = { version: 2, defaults: { changePolicy: 'confirm' }, accounts: { 'acme/slack': account() } };
  writeFileSync(join(dir, 'config.json'), `${JSON.stringify(body, null, 2)}\n`);
  const env = { AGENT_COMMS_CONFIG_DIR: dir, HOME: dir, USERPROFILE: dir };
  return { core: openCore({ env, caller: CORE_CALLER }), dir };
}

/** `acme/slack` widened from read to send: a loosening, so a change a person approves. */
async function widening(core: Core): Promise<ChangeRequest> {
  const before = await core.config.load();
  const after = structuredClone(before);
  after.accounts['acme/slack'] = { ...(after.accounts['acme/slack'] as AccountConfig), mode: 'send', tier: 'send' };
  return { account: 'acme/slack', before, after, summary: 'Let acme/slack post' };
}

function inline(handoff: Handoff): string {
  assert.ok(isCommand(handoff), 'message' in handoff ? handoff.message : '');
  return inlineCommand(handoff);
}

/** Core's own `approve` and its wait for `id`, as the surface takes the wait, rendered for `platform`. */
function expected(core: Core, id: string, surface: 'cli' | 'mcp', platform: NodeJS.Platform) {
  const maker = coreHandoffs(core.paths, platform);
  return {
    approve: inline(maker.own(['approve', id])),
    wait: surface === 'mcp' ? 'comms_approval_wait' : inline(maker.own(['approval', 'wait', id])),
  };
}

test("core's wait is its own: comms_approval_wait, and `approval wait <id>` located and pinned as its approve is (D7-b)", () => {
  assert.deepEqual(APPROVAL_WAITS.core, { words: ['approval', 'wait'], tool: 'comms_approval_wait' });
  const { core } = confirmCore();
  for (const platform of PLATFORMS) {
    const maker = coreHandoffs(core.paths, platform);
    const wait = approvalWaitOf(maker, 'ap_1');
    assert.equal(wait.tool, 'comms_approval_wait');
    assert.ok(isCommand(wait.command), platform);
    if (!isCommand(wait.command)) continue;
    assert.deepEqual(wait.command.words.slice(-3), ['approval', 'wait', 'ap_1'], platform);
    // The same program and the same four folders as the approve it is named beside.
    const approve = maker.own(['approve', 'ap_1']);
    assert.ok(isCommand(approve));
    assert.deepEqual(wait.command.words.slice(0, -3), approve.words.slice(0, -2), platform);
    for (const flag of FOUR) assert.ok(wait.command.words.includes(flag), `${platform}: ${flag}`);
  }
});

for (const platform of PLATFORMS) {
  test(`a core change waiting for a person names its approve with comms_approval_wait over MCP and the located \`approval wait\` at the command line — prepared, and claimed too soon — quoted for ${platform} (D7-b)`, async () => {
    const { core } = confirmCore();
    const spec = await widening(core);
    for (const surface of ['mcp', 'cli'] as const) {
      const prepared = await prepareChange(core, spec, { channel: 'core', surface, platform });
      const id = prepared.approvalId;
      const { approve, wait } = expected(core, id, surface, platform);
      assert.equal(
        prepared.next,
        `The change policy is confirm: ask the user to run ${approve} in their own terminal and type the code it shows; learn when they have with ${wait}. Then claim approval ${id} and apply the change.`,
        surface,
      );
      await assert.rejects(claimChange(core, id, spec, { surface, platform }), (error: unknown) => {
        assert.ok(error instanceof CommsError && error.code === 'APPROVAL_PENDING', String(error));
        assert.equal(
          error.hint,
          `Ask the user to run ${approve} in their own terminal; learn when they have with ${wait}, then try again with the same approval.`,
          surface,
        );
        assertNoBareCommand(error.hint ?? '');
        return true;
      });
      assertNoBareCommand(prepared.next);
      // The store's own words, for a claim made with none of a surface's: the command line's.
      const fallback = expected(core, id, 'cli', platform);
      const binding = asV2(await core.approvals.get(id))?.change;
      assert.ok(binding !== undefined);
      await assert.rejects(
        core.approvals.claimForChange(id, { change: binding, policy: 'confirm' }, { platform }),
        (error: unknown) => {
          assert.ok(error instanceof CommsError && error.code === 'APPROVAL_PENDING', String(error));
          assert.equal(
            error.hint,
            `Ask the user to run ${fallback.approve} in their own terminal; learn when they have with ${fallback.wait}, then try again with the same approval.`,
          );
          return true;
        },
      );
    }
  });

  test(`a change at the command line tells the agent the person's approve, the wait and the command to run again; approve refused to an agent names the wait too — quoted for ${platform} (D7-b)`, async () => {
    const { core } = confirmCore();
    const change: GatedChange<string> = {
      plan: async (config) => {
        const spec = await widening(core);
        return { ...spec, before: config };
      },
      apply: async () => 'applied',
    };
    const rerun = ['policy', '--account', 'acme/slack', 'chat'];
    let id = '';
    await assert.rejects(
      gatedChangeAtTerminal(core, change, {
        channel: 'core',
        env: { CLAUDECODE: '1' },
        output: { json: true, color: false, platform },
        rerun,
      }),
      (error: unknown) => {
        assert.ok(error instanceof CommsError && error.code === 'APPROVAL_PENDING', String(error));
        id = String(error.details?.approvalId);
        const { approve, wait } = expected(core, id, 'cli', platform);
        const again = inline(coreHandoffs(core.paths, platform).own([...rerun, '--approval', id]));
        assert.equal(
          error.hint,
          `Show the person the preview. They run ${approve}; learn when they have with ${wait}, then run ${again}.`,
        );
        return true;
      },
    );
    await assert.rejects(
      approveChangeAtTerminal(core, id, { CLAUDECODE: '1' }, { color: false, platform }),
      (error: unknown) => {
        assert.ok(error instanceof CommsError, String(error));
        const { approve, wait } = expected(core, id, 'cli', platform);
        assert.equal(
          error.hint,
          `Ask the user to run ${approve} in their own terminal; learn when they have with ${wait}.`,
        );
        return true;
      },
    );
  });

  test(`a download's question under confirm names its approve and the wait for the answer, on both surfaces and at the terminal — quoted for ${platform} (D7-b)`, async () => {
    const { core, dir } = confirmCore();
    const env = { AGENT_COMMS_CONFIG_DIR: dir, HOME: dir, USERPROFILE: dir };
    const listing = [{ name: 'invoice.pdf', size: 1024 }];
    const request = {
      target: { kind: 'account' as const, name: 'acme/slack', id: ACME },
      operation: 'files.download',
      request: { files: ['F1'] },
      files: ['F1'],
      names: ['invoice.pdf'],
    };
    for (const surface of ['mcp', 'cli'] as const) {
      const question = await askWhereToSave(core, {
        channel: 'slack',
        request,
        folders: { downloads: join(dir, 'Downloads'), current: join(dir, 'here') },
        configured: false,
        count: 1,
        bytes: 1024,
        listing,
        policy: 'confirm',
        surface,
        tool: 'slack_file_download',
        env,
        platform,
      });
      const id = question.choiceId;
      const { approve, wait } = expected(core, id, surface, platform);
      assert.ok(
        question.next.includes(
          `ask them to run ${approve} in their own terminal and answer there; wait for their answer with ${wait}.`,
        ),
        `${surface}: ${question.next}`,
      );
      assertNoBareCommand(question.next);
      // The answer passed along anyway: refused, with the same two, and the question left for the person.
      const refused = await settleDestination(core, {
        answer: { kind: 'choice', answer: { choice: 'downloads' }, choiceId: id },
        request,
        folders: () => ({ downloads: join(dir, 'Downloads'), current: join(dir, 'here') }),
        policy: 'confirm',
        surface,
        env,
        platform,
      }).catch((error: unknown) => error);
      assert.ok(refused instanceof CommsError && refused.code === 'APPROVAL_PENDING', String(refused));
      assert.ok(
        refused.hint?.includes(
          `Ask the person to run ${approve} in their own terminal and answer there; wait for their answer with ${wait}, then `,
        ),
        `${surface}: ${refused.hint}`,
      );
      assertNoBareCommand(refused.hint ?? '');
    }

    // At the command line, a question nobody at a terminal can answer goes to the agent: the same two, then the rerun.
    const stdin = Object.assign(new PassThrough(), { isTTY: false });
    const quiet = Object.assign(new PassThrough(), { isTTY: false });
    const thrown = await downloadAtTerminal({
      core,
      env: { ...env, CLAUDECODE: '1' },
      output: { json: true, color: false, platform },
      rerun: ['file', 'download', 'F1', '--workspace', 'acme/slack'],
      render: (asked) => asked.question,
      streams: { stdin, stdout: quiet, stderr: quiet } as unknown as Streams,
      download: async () =>
        askWhereToSave(core, {
          channel: 'slack',
          request,
          folders: { downloads: join(dir, 'Downloads'), current: join(dir, 'here') },
          configured: false,
          count: 1,
          bytes: 1024,
          listing,
          policy: 'confirm',
          surface: 'cli',
          tool: 'slack_file_download',
          env,
          platform,
        }),
    }).catch((error: unknown) => error);
    assert.ok(thrown instanceof CommsError && thrown.code === 'APPROVAL_PENDING', String(thrown));
    const id = String(thrown.details?.choiceId);
    const { approve, wait } = expected(core, id, 'cli', platform);
    assert.ok(
      thrown.hint?.startsWith(
        `The change policy is confirm: ask the person to run ${approve} in their own terminal and answer there; wait for their answer with ${wait}. Then run `,
      ),
      thrown.hint,
    );
    assertNoBareCommand(thrown.hint ?? '');
  });
}
