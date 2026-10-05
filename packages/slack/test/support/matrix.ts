import { mkdirSync, realpathSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import * as lib from '@agentcomms/core';
import { ApprovalStore, type ChangeBinding } from '@agentcomms/core';
import { Client } from '@modelcontextprotocol/client';
import { InMemoryTransport } from '@modelcontextprotocol/server';
import {
  drive,
  emitter,
  type MatrixClock,
  type MatrixSurface,
  matrixClock,
  NOBODY,
  type Observation,
  observeError,
  observeTool,
  routeOf,
  WRONG_CODE,
  wrongCodesOf,
} from '../../../../test/helpers/approval-matrix.mjs';
import { SlackContext } from '../../src/context.ts';
import { createSlackMcpServer } from '../../src/mcp/server.ts';
import { beginApproval, finishApproval } from '../../src/operations/approve.ts';
import { gateDepsFor } from '../../src/operations/gate.ts';
import { prepareDraftPost } from '../../src/operations/post.ts';
import { prepareReaction } from '../../src/operations/send.ts';
import { DROP, type FakeSlack, startFakeSlack } from './fake-slack.ts';
import { type Harness, newHarness } from './harness.ts';

/*
 * Slack's posts, posts with files and reactions in the D2 matrix (CUE-404 Task 24): `test/approval-matrix.test.mjs`
 * runs this as its own program and holds what each must say. Each row starts from a post, a post with a file or a
 * reaction this package prepared itself, on a fresh home and a loopback Slack, with the approval store on a clock of
 * its own; `test/helpers/approval-matrix.mjs` puts it into the row's state.
 *
 * The surfaces: `slack_post_send` (a post, and a post with a file), `slack_react_send`, the terminal approval of a post
 * and of a reaction (`approve`: its begin, then its finish), and `slack_approval_wait`.
 */

type What = 'post' | 'files' | 'reaction';

interface ToolResult {
  isError?: boolean;
  structuredContent?: Record<string, unknown>;
}

interface World {
  what: What;
  harness: Harness;
  core: lib.Core;
  context: SlackContext;
  fake: FakeSlack;
  clock: MatrixClock;
  draftId: string;
  approvalId: string;
  notFound(action: string): Promise<ReadonlyArray<readonly [string, string]>>;
  fault(): void;
  sends(): number;
}

const TS = '1700000000.000100';
const REACTION = { channel: 'C1', ts: '1.1', emoji: 'tada' };
const emit = emitter('send', 'slack');

/** The provider call that is the outward act of each kind: the post, the files' share, the reaction. */
const ACT: Record<What, string> = {
  post: 'chat.postMessage',
  files: 'files.completeUploadExternal',
  reaction: 'reactions.add',
};

async function prepare(context: SlackContext, fake: FakeSlack, what: What, alias: string, file: string) {
  if (what === 'reaction') {
    // As `react` prepares one: version 3 first, an earlier release's records retired.
    await lib.ensureSendEpochConfig(context.core, { now: context.now });
    const gate = await gateDepsFor(context, alias, { fetch: fake.fetch });
    const prepared = await prepareReaction(gate, { channel: REACTION.channel, ts: REACTION.ts, name: REACTION.emoji });
    return { draftId: '', approvalId: prepared.approvalId };
  }
  const prepared = await prepareDraftPost(
    context,
    alias,
    { channel: 'C1', text: 'shipping now', ...(what === 'files' ? { files: [file] } : {}) },
    { fetch: fake.fetch },
  );
  return { draftId: prepared.draftId, approvalId: prepared.approvalId };
}

function worldOf(what: What) {
  return async (row: string): Promise<World> => {
    const harness = await newHarness();
    await harness.addWorkspace({ alias: 'acme', mode: 'send', sendPolicy: routeOf(row) });
    await harness.addWorkspace({ alias: 'zeta', workspaceId: 'T0002', mode: 'send', sendPolicy: 'chat' });
    const fake = await startFakeSlack({
      'conversations.info': () => ({ ok: true, channel: { id: 'C1', name: 'eng', num_members: 4, is_member: true } }),
      'chat.postMessage': () => ({ ok: true, ts: TS }),
      'reactions.add': () => ({ ok: true }),
    });
    fake.acceptUploads({ ts: TS });
    const docs = join(harness.home, 'docs');
    mkdirSync(docs);
    writeFileSync(join(docs, 'report.pdf'), '%PDF-1.7 the report');
    const file = realpathSync.native(join(docs, 'report.pdf'));
    const clock = matrixClock();
    harness.core.approvals = new ApprovalStore(harness.core.paths.stateDir, {
      now: clock.now,
      handoffs: harness.core.handoffs,
      loadConfig: () => harness.core.config.load(),
      audit: harness.core.audit,
    });
    const context = new SlackContext({ core: harness.core, env: harness.env, platform: 'darwin', surface: 'mcp' });
    const prepared = await prepare(context, fake, what, 'acme', file);

    const foreign = async () => (await prepare(context, fake, what, 'zeta', file)).approvalId;
    const change = async () => {
      const binding: ChangeBinding = {
        summary: 'Let the default send policy be chat',
        target: null,
        loosened: [{ path: 'defaults.sendPolicy', before: 'confirm', after: 'chat' }],
        settings: [],
        effects: [],
      };
      return (await harness.core.approvals.createChange({ channel: 'slack', change: binding, policy: 'chat' }))
        .approvalId;
    };
    /** Another channel's send, as Gmail's prepare writes one for a mailbox on this machine: not Slack's. */
    const otherChannel = async () => {
      const inboxId = lib.newInboxId();
      await harness.core.config.update((config) => ({
        ...config,
        inboxes: {
          ...config.inboxes,
          work: {
            id: inboxId,
            provider: 'gmail',
            email: 'jo@example.test',
            identity: 'oidc',
            client: 'desktop',
            tier: 'send',
            grantedScopes: [],
            contacts: false,
            secretRef: `gmail:refresh:${inboxId}`,
            internalDomains: ['example.test'],
            createdAt: '2026-09-01T00:00:00.000Z',
          },
        },
      }));
      return (
        await harness.core.approvals.create({
          channel: 'gmail',
          inboxId,
          inboxSub: 'sub-9',
          draftId: 'r-other',
          draftMessageId: 'm-other',
          contentDigest: 'b'.repeat(64),
          sendEpoch: 0,
          policy: 'chat',
          requiredPolicy: 'chat',
          riskFlags: [],
          expect: { to: ['sam@partner.test'], cc: [], bcc: [], subject: 'Other' },
        })
      ).approvalId;
    };

    return {
      what,
      harness,
      core: harness.core,
      context,
      fake,
      clock,
      draftId: prepared.draftId,
      approvalId: prepared.approvalId,
      notFound: async (action) => {
        if (action === 'claim') {
          return [
            ['nobody', NOBODY],
            ['another workspace', await foreign()],
            ['another kind', await change()],
          ];
        }
        if (action === 'approve') {
          return [
            ['nobody', NOBODY],
            ['another channel', await otherChannel()],
            ['another kind', await change()],
          ];
        }
        return [['nobody', NOBODY]];
      },
      fault: () => {
        const answer = fake.script[ACT[what]];
        fake.script[ACT[what]] = (request) => {
          answer?.(request);
          return DROP;
        };
      },
      sends: () => fake.requests.filter((request) => request.method === ACT[what]).length,
    };
  };
}

async function mcp(w: World, pinned?: string) {
  const { server } = await createSlackMcpServer({
    core: w.harness.core,
    env: w.harness.env,
    fetch: w.fake.fetch,
    platform: 'darwin',
    ...(pinned ? { workspace: pinned } : {}),
  });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 'test-client', version: '0' });
  await Promise.all([client.connect(clientTransport), server.connect(serverTransport)]);
  return {
    call: async (name: string, args: Record<string, unknown>) =>
      (await client.callTool({ name, arguments: args })) as ToolResult,
    close: async () => void (await Promise.all([client.close(), server.close()])),
  };
}

/** The claim: `slack_post_send` for a post (with its file or not), `slack_react_send` for a reaction. */
async function claim(w: World, approvalId: string, pinned?: string): Promise<Observation> {
  const client = await mcp(w, pinned);
  try {
    const before = w.sends();
    const where = pinned ? {} : { workspace: 'acme' };
    const result =
      w.what === 'reaction'
        ? await client.call('slack_react_send', { ...where, ...REACTION, approvalId })
        : await client.call('slack_post_send', { ...where, draftId: w.draftId, approvalId, expectChannel: 'C1' });
    return observeTool(result, w.sends() - before);
  } finally {
    await client.close();
  }
}

/** The terminal approval: its begin, then its finish with the code it showed — or a wrong one, as the row says. */
async function approve(w: World, approvalId: string, row: string): Promise<Observation> {
  const deps = { fetch: w.fake.fetch };
  const before = w.sends();
  let challenge: string;
  try {
    challenge = (await beginApproval(w.context, approvalId, deps)).challenge;
  } catch (error) {
    return { ...observeError(error, w.sends() - before), extra: { step: 'begin' } };
  }
  const wrong = wrongCodesOf(row);
  if (wrong === 0) {
    try {
      await finishApproval(w.context, approvalId, challenge, deps);
      const record = lib.asV2(await w.core.approvals.get(approvalId));
      return {
        ok: true,
        approval: record ? { ...(await w.core.approvals.approvalOf(record)) } : null,
        sends: w.sends() - before,
      };
    } catch (error) {
      return { ...observeError(error, w.sends() - before), extra: { step: 'finish' } };
    }
  }
  let last: Observation = { ok: true, sends: 0 };
  for (let attempt = 1; attempt <= wrong; attempt += 1) {
    try {
      await finishApproval(w.context, approvalId, WRONG_CODE, deps);
    } catch (error) {
      last = { ...observeError(error, w.sends() - before), extra: { step: 'finish', attempt } };
    }
  }
  const stored = lib.asV2(await w.core.approvals.get(approvalId));
  return { ...last, extra: { ...last.extra, stored: stored?.state } };
}

async function look(w: World, approvalId: string, pinned?: string): Promise<Observation> {
  const client = await mcp(w, pinned);
  try {
    return observeTool(await client.call('slack_approval_wait', { approvalId, waitSeconds: 0 }), 0, { look: true });
  } finally {
    await client.close();
  }
}

const NAMES: Record<What, { claim: string; approve: string; look: string }> = {
  post: { claim: 'slack_post_send', approve: 'approve (terminal, a post)', look: 'slack_approval_wait (a post)' },
  files: {
    claim: 'slack_post_send (a post with a file)',
    approve: 'approve (terminal, a post with a file)',
    look: 'slack_approval_wait (a post with a file)',
  },
  reaction: {
    claim: 'slack_react_send',
    approve: 'approve (terminal, a reaction)',
    look: 'slack_approval_wait (a reaction)',
  },
};

for (const what of ['post', 'files', 'reaction'] as const) {
  const surfaces: ReadonlyArray<MatrixSurface<World>> = [
    { name: NAMES[what].look, action: 'look', act: (w, id) => look(w, id) },
    { name: NAMES[what].claim, action: 'claim', act: (w, id) => claim(w, id) },
    { name: NAMES[what].approve, action: 'approve', act: (w, id, row) => approve(w, id, row) },
  ];
  await drive('send', { world: worldOf(what), surfaces, emit, lib });

  // A server pinned to the workspace, given another's id.
  const w = await worldOf(what)('not-found');
  const theirs = (await w.notFound('claim'))[1]?.[1] as string;
  const pinnedClaim = await claim(w, theirs, 'acme');
  emit(
    'not-found',
    { name: `${NAMES[what].claim} (pinned)`, action: 'claim', act: async () => pinnedClaim },
    {
      ...pinnedClaim,
      extra: { variant: 'pinned away', id: theirs },
    },
  );
  const pinnedLook = await look(w, theirs, 'acme');
  emit(
    'not-found',
    { name: `${NAMES[what].look} (pinned)`, action: 'look', act: async () => pinnedLook },
    {
      ...pinnedLook,
      extra: { variant: 'pinned away', id: theirs },
    },
  );
}

// A post with a file that Slack refused to share after the upload (D2, `failed`: "nothing was posted", and what was
// uploaded said). Then the same approval, claimed again: the send it was claimed for failed.
{
  const w = await worldOf('files')('provider-refused');
  const share = w.fake.script['files.completeUploadExternal'];
  w.fake.script['files.completeUploadExternal'] = (request) => {
    share?.(request);
    return { ok: false, error: 'posting_to_channel_denied' };
  };
  const refused = await claim(w, w.approvalId);
  const stored = lib.asV2(await w.core.approvals.get(w.approvalId));
  const surface = { name: NAMES.files.claim, action: 'claim' as const, act: async () => refused };
  emit('failed', surface, { ...refused, extra: { stored: stored?.state } }, 'provider-refused');
}

// Every fake Slack this run started is still listening; the observations are written, so the run is over.
process.exit(0);
