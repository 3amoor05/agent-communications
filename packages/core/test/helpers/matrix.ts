import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
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
import { asV2 } from '../../src/approval-stored.ts';
import { beginChangeApproval, finishChangeApproval } from '../../src/changes.ts';
import { type Core, openCore } from '../../src/core.ts';
import { CORE_CALLER } from '../../src/handoffs.ts';
import * as lib from '../../src/index.ts';
import { createCoreMcpServer } from '../../src/mcp/server.ts';
import { tempDir } from './temp.ts';

/*
 * Core's surfaces in the D2 matrix (CUE-404 Task 24): `test/approval-matrix.test.mjs` runs this as its own program and
 * holds what each must say.
 *
 * Changes: a loosening prepared by core itself — `comms_attach` letting a folder's files be attached — on the route its
 * change policy gives, then claimed by the same tool with the approval, approved at the terminal (`agentcomms approve`:
 * its begin, then its finish), waited for (`comms_approval_wait`) and listed (`comms_approvals_list`). And core's own
 * look and list over every channel's send: a Gmail, a Slack and a Resend send each written as that channel's prepare
 * writes one, put into each row's state, and seen through `comms_approval_wait` and `comms_approvals_list`.
 */

interface ToolResult {
  isError?: boolean;
  structuredContent?: Record<string, unknown>;
}

interface World {
  core: Core;
  clock: MatrixClock;
  approvalId: string;
  folder: string;
  call(name: string, args: Record<string, unknown>): Promise<ToolResult>;
  notFound(action: string): Promise<ReadonlyArray<readonly [string, string]>>;
}

const CREATED = '2026-09-20T00:00:00.000Z';
const INBOX = 'ibx_AAAAAAAAAAAAAAAA';
const SLACK = 'acc_SSSSSSSSSSSSSSSS';
const RESEND = 'acc_RRRRRRRRRRRRRRRR';

/** A machine with a mailbox, a Slack workspace and a Resend account, its approvals on a clock of the test's own. */
async function machine(changePolicy: 'chat' | 'confirm') {
  const home = tempDir('comms-matrix-');
  const configDir = join(home, 'config');
  mkdirSync(configDir);
  const owner = (id: string, platform: string) => ({
    id,
    platform,
    workspace: `T_${platform}`,
    userId: `U_${platform}`,
    tier: 'send',
    mode: 'send',
    grantedScopes: [],
    secretRef: `${platform}:none:${id}`,
    sendPolicy: 'chat',
    createdAt: CREATED,
  });
  writeFileSync(
    join(configDir, 'config.json'),
    `${JSON.stringify(
      {
        version: 2,
        // Files may be attached from one folder of the home only, so another is a loosening to approve.
        defaults: { changePolicy, attachRoots: ['~/attachable'] },
        inboxes: {
          'acme/gmail': {
            id: INBOX,
            provider: 'gmail',
            email: 'jo@acme.test',
            identity: 'oidc',
            client: 'desktop',
            tier: 'send',
            contacts: false,
            grantedScopes: [],
            secretRef: `gmail:refresh:${INBOX}`,
            internalDomains: ['acme.test'],
            sendPolicy: 'chat',
            createdAt: CREATED,
          },
        },
        accounts: { 'acme/slack': owner(SLACK, 'slack'), 'acme/resend': owner(RESEND, 'resend') },
      },
      null,
      2,
    )}\n`,
  );
  const env = {
    HOME: home,
    USERPROFILE: home,
    APPDATA: join(home, 'AppData'),
    AGENT_COMMS_CONFIG_DIR: configDir,
    AGENT_COMMS_CLIENT_CLI_DIRS: '',
    AGENT_COMMS_UPDATE_CHECK: 'off',
    NO_COLOR: '1',
  };
  const clock = matrixClock();
  const core = openCore({ env, caller: CORE_CALLER, now: clock.now });
  const { server } = await createCoreMcpServer({ core, env, keyring: null, platform: 'darwin' });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 'test-client', version: '0' });
  await Promise.all([client.connect(clientTransport), server.connect(serverTransport)]);
  const call = async (name: string, args: Record<string, unknown>) =>
    (await client.callTool({ name, arguments: args })) as ToolResult;
  return { home, core, clock, call };
}

/** A send, as a channel's prepare writes one: Gmail's for the mailbox, Slack's or Resend's for its account. */
function sendOf(core: Core, channel: 'gmail' | 'slack' | 'resend', policy: 'chat' | 'confirm') {
  const owner = channel === 'gmail' ? INBOX : channel === 'slack' ? SLACK : RESEND;
  return core.approvals.create({
    channel,
    inboxId: owner,
    inboxSub: channel === 'gmail' ? 'sub-1' : `U_${channel}`,
    draftId: `${channel}-draft`,
    draftMessageId: `${channel}-revision`,
    contentDigest: 'c'.repeat(64),
    sendEpoch: 0,
    policy: 'chat',
    requiredPolicy: policy,
    riskFlags: policy === 'confirm' ? ['recipient-tainted'] : [],
    expect: { to: ['sam@partner.test'], cc: [], bcc: [], subject: 'Tuesday' },
  });
}

async function changeWorld(row: string): Promise<World> {
  const m = await machine(routeOf(row));
  // A folder in the home files may not be attached from yet, named from it as a person names it on every platform.
  mkdirSync(join(m.home, 'outgoing'));
  const folder = join('~', 'outgoing');
  const asked = (await m.call('comms_attach', { rootsAdd: folder })).structuredContent ?? {};
  if (asked.approvalRequired !== true) throw new Error(`the change asked nothing: ${JSON.stringify(asked)}`);
  return {
    ...m,
    folder,
    approvalId: String(asked.approvalId),
    // A claim or an approval of a change finds no other kind; a wait answers for every kind, so only nobody's.
    notFound: async (action) =>
      action === 'look'
        ? [['nobody', NOBODY]]
        : [
            ['nobody', NOBODY],
            ['another kind', (await sendOf(m.core, 'gmail', 'chat')).approvalId],
          ],
  };
}

function sendWorld(channel: 'gmail' | 'slack' | 'resend') {
  return async (row: string): Promise<World> => {
    const m = await machine('chat');
    // Version 3 first, as every channel's prepare makes it: the send epoch is what a `never` raises.
    await lib.ensureSendEpochConfig(m.core, { now: m.clock.now });
    const record = await sendOf(m.core, channel, routeOf(row));
    return { ...m, folder: '', approvalId: record.approvalId, notFound: async () => [['nobody', NOBODY]] };
  };
}

async function look(w: World, approvalId: string): Promise<Observation> {
  return observeTool(await w.call('comms_approval_wait', { approvalId, waitSeconds: 0 }), 0, { look: true });
}

async function list(w: World, approvalId: string): Promise<Observation> {
  const result = await w.call('comms_approvals_list', {});
  if (result.isError) return observeTool(result, 0);
  const approvals = (result.structuredContent?.approvals ?? []) as Array<Record<string, unknown>>;
  return { ok: true, approval: approvals.find((each) => each.approvalId === approvalId) ?? null, sends: 0 };
}

/**
 * The change, applied with its approval: the claim. `sends` counts what it applied — the change made, here — and an
 * applied result, which carries no approval object of its own, is reported with the record's as it stands after.
 */
async function claim(w: World, approvalId: string): Promise<Observation> {
  const result = await w.call('comms_attach', { rootsAdd: w.folder, approvalId });
  if (result.isError) return observeTool(result, 0);
  const applied = result.structuredContent?.applied === true;
  const record = asV2(await w.core.approvals.get(approvalId));
  return {
    ok: true,
    approval: record ? { ...(await w.core.approvals.approvalOf(record)) } : null,
    sends: applied ? 1 : 0,
    extra: { applied },
  };
}

/** `agentcomms approve`: its begin, then its finish with the code it showed — or a wrong one, as the row says. */
async function approve(w: World, approvalId: string, row: string): Promise<Observation> {
  const options = { surface: 'cli' as const, platform: 'darwin' as const };
  let challenge: string;
  try {
    challenge = (await beginChangeApproval(w.core, approvalId, options)).challenge;
  } catch (error) {
    return { ...observeError(error, 0), extra: { step: 'begin' } };
  }
  const wrong = wrongCodesOf(row);
  if (wrong === 0) {
    try {
      const approved = await finishChangeApproval(w.core, approvalId, challenge, options);
      return { ok: true, approval: { ...(await w.core.approvals.approvalOf(approved)) }, sends: 0 };
    } catch (error) {
      return { ...observeError(error, 0), extra: { step: 'finish' } };
    }
  }
  let last: Observation = { ok: true, sends: 0 };
  for (let attempt = 1; attempt <= wrong; attempt += 1) {
    try {
      await finishChangeApproval(w.core, approvalId, WRONG_CODE, options);
    } catch (error) {
      last = { ...observeError(error, 0), extra: { step: 'finish', attempt } };
    }
  }
  const stored = asV2(await w.core.approvals.get(approvalId));
  return { ...last, extra: { ...last.extra, stored: stored?.state } };
}

const looks: ReadonlyArray<MatrixSurface<World>> = [
  { name: 'comms_approval_wait', action: 'look', act: (w, id) => look(w, id) },
  { name: 'comms_approvals_list', action: 'list', act: (w, id) => list(w, id) },
];

await drive('change', {
  world: changeWorld,
  surfaces: [
    ...looks,
    { name: 'comms_attach', action: 'claim', act: (w, id) => claim(w, id) },
    { name: 'agentcomms approve', action: 'approve', act: (w, id, row) => approve(w, id, row) },
  ],
  emit: emitter('change', 'core'),
  lib,
});

for (const channel of ['gmail', 'slack', 'resend'] as const) {
  await drive('send', {
    world: sendWorld(channel),
    surfaces: looks.map((surface) => ({ ...surface, name: `${surface.name} (a ${channel} send)` })),
    emit: emitter('send', 'core'),
    lib,
  });
}

process.exit(0);
