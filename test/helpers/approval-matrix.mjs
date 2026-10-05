/**
 * The D2 outcome matrix's rows, as each channel's driver arranges them (CUE-404 Task 24; design 2026-10-05 §D2 and §5
 * D2-a): `test/approval-matrix.test.mjs` holds what every row must say on every surface; each package's
 * `test/support/matrix.ts` prepares a real approval through its own surface, hands it here to be put into the row's
 * state, acts on it through each of its surfaces, and prints what it saw. This file is the one place the states are
 * made, so every surface meets the same record in the same state.
 *
 * Every step goes through the approval store and the configuration as a running program would — a person's approval
 * with the challenge the store issued, a claim with the record's own binding, a completion with the claim's token, a
 * policy write through `ConfigStore.update` — with the clock the driver's store runs on moved where a row needs time.
 * The one exception is `corrupt`, made by writing a field into the file that the record's state does not allow: what a
 * damaged or hand-edited file is, and what no program would write.
 *
 * Plain JavaScript, with the channel's core passed in (`lib`), so it shares the driver's one copy of
 * `@agentcomms/core` rather than loading another.
 */

import { appendFileSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

/** The rows, by the kind of approval they are about, in the order of the D2 table. */
export const ROWS = Object.freeze({
  send: Object.freeze([
    'not-found',
    'corrupt',
    'pending-chat',
    'pending-confirm',
    'wrong-code-1',
    'wrong-code-2',
    'wrong-code-3',
    'approved',
    'live-never',
    'revoked-by-never',
    'expired-pending',
    'expired-approved',
    'clock-anomaly',
    'provider-uncertain',
    'sending',
    'unknown',
    'used',
    'failed',
    'revoked',
  ]),
  change: Object.freeze([
    'not-found',
    'corrupt',
    'pending-chat',
    'pending-confirm',
    'wrong-code-1',
    'wrong-code-2',
    'wrong-code-3',
    'approved',
    'expired-pending',
    'expired-approved',
    'clock-anomaly',
    'used',
    'revoked',
  ]),
  download: Object.freeze([
    'not-found',
    'corrupt',
    'pending-chat',
    'pending-confirm',
    'answered',
    'used',
    'expired-unanswered',
    'expired-answered',
  ]),
});

/** The route a row's approval is prepared on: `confirm` where a person's approval is part of the row. */
export function routeOf(row) {
  return [
    'pending-confirm',
    'wrong-code-1',
    'wrong-code-2',
    'wrong-code-3',
    'approved',
    'expired-approved',
    'answered',
    'expired-answered',
  ].includes(row)
    ? 'confirm'
    : 'chat';
}

/** How many wrong codes a row types at the terminal. */
export function wrongCodesOf(row) {
  const match = /^wrong-code-(\d)$/.exec(row);
  return match ? Number(match[1]) : 0;
}

/** A clock a store runs on: set, or moved on. */
export function matrixClock(start = Math.floor(Date.now() / 1000) * 1000) {
  let at = start;
  return {
    now: () => new Date(at),
    at: () => at,
    set: (ms) => {
      at = ms;
    },
    advance: (ms) => {
      at += ms;
    },
  };
}

/** The record as stored: what the arrangement reads its binding from. */
function stored(core, approvalId) {
  return JSON.parse(readFileSync(join(core.approvals.directory, `${approvalId}.json`), 'utf8'));
}

/** A person's approval at the terminal: the challenge the store issued, typed back, against the record's own binding. */
export async function approveAsPerson(core, approvalId) {
  const record = stored(core, approvalId);
  const challenge = await core.approvals.issueChallenge(approvalId, record.kind);
  return core.approvals.approve(
    approvalId,
    'terminal',
    { draftMessageId: record.draftMessageId, contentDigest: record.contentDigest },
    challenge,
    record.kind,
  );
}

/** A download's question answered at the terminal: its default folder. */
async function answerAsPerson(core, approvalId) {
  return core.approvals.answerDownload(approvalId, 'terminal', { choice: 'downloads' });
}

/** Another call's claim of a send, with the record's own binding: what a concurrent `execute` would make. */
async function claimElsewhere(core, approvalId) {
  const record = stored(core, approvalId);
  return core.approvals.claimForSend(approvalId, {
    inboxId: record.inboxId,
    inboxSub: record.inboxSub,
    draftMessageId: record.draftMessageId,
    contentDigest: record.contentDigest,
    expect: record.expect,
  });
}

/** A change's claim, as the command that prepared it makes when it applies it. */
async function claimChange(core, approvalId) {
  const record = stored(core, approvalId);
  return core.approvals.claimForChange(approvalId, { change: record.change, policy: record.policy });
}

/** A download's claim: the save the question was asked for. */
async function claimDownload(core, approvalId) {
  const record = stored(core, approvalId);
  const { answer: _answer, ...download } = record.download;
  return core.approvals.claimForDownload(approvalId, download);
}

/** The owner's send policy, written as `ConfigStore.update` writes it on version 3: a `never` raises its epoch. */
function sendPolicyWrite(ownerId, policy) {
  return (config) => {
    const next = structuredClone(config);
    for (const map of [next.inboxes, next.accounts]) {
      for (const owner of Object.values(map ?? {})) if (owner.id === ownerId) owner.sendPolicy = policy;
    }
    return next;
  };
}

function ownerPaths(config, ownerId) {
  const paths = [];
  for (const [kind, map] of [
    ['inboxes', config.inboxes],
    ['accounts', config.accounts],
  ]) {
    for (const [name, owner] of Object.entries(map ?? {}))
      if (owner.id === ownerId) paths.push(`${kind}.${name}.sendPolicy`);
  }
  return paths;
}

/**
 * Puts the approval `approvalId` — prepared by the driver's surface on `routeOf(row)` — into `row`'s state, on
 * `clock`. `lib` is the driver's `@agentcomms/core`. Rows the driver arranges itself (`not-found`, `provider-uncertain`,
 * the wrong codes, which are typed at the terminal) are left as prepared.
 */
export async function arrange(row, { core, lib, clock, approvalId }) {
  const record = stored(core, approvalId);
  switch (row) {
    case 'not-found':
    case 'pending-chat':
    case 'pending-confirm':
    case 'provider-uncertain':
    case 'wrong-code-1':
    case 'wrong-code-2':
    case 'wrong-code-3':
      return;
    case 'corrupt': {
      // An expiry time on a record still pending: its binding verifies, its timestamps do not (attribution verified).
      const file = join(core.approvals.directory, `${approvalId}.json`);
      writeFileSync(file, `${JSON.stringify({ ...record, expiredAt: record.expiresAt }, null, 2)}\n`);
      return;
    }
    case 'approved':
      await approveAsPerson(core, approvalId);
      return;
    case 'answered':
      await answerAsPerson(core, approvalId);
      return;
    case 'expired-pending':
    case 'expired-unanswered':
      clock.advance(record.pendingMs + 1000);
      return;
    case 'expired-approved':
      await approveAsPerson(core, approvalId);
      clock.advance(lib.APPROVAL_LIFETIMES.approved + 1000);
      return;
    case 'expired-answered':
      await answerAsPerson(core, approvalId);
      clock.advance(record.pendingMs + 1000);
      return;
    case 'clock-anomaly':
      clock.set(Date.parse(record.createdAt) - 60_000);
      return;
    case 'live-never':
      // Turned off, and the sweep that revokes it not yet there: the window D2's `never` row is about.
      await core.config.update(sendPolicyWrite(record.inboxId, 'never'));
      return;
    case 'revoked-by-never': {
      // Turned off — the sweep revokes it — and on again, with a person's consent to the loosening.
      await lib.applySendPolicyChange(core, sendPolicyWrite(record.inboxId, 'never'), { now: clock.now });
      const config = await core.config.load();
      await core.config.update(sendPolicyWrite(record.inboxId, 'chat'), {
        consent: { kind: 'loosening-consent', paths: ownerPaths(config, record.inboxId) },
      });
      return;
    }
    case 'sending':
      await claimElsewhere(core, approvalId);
      return;
    case 'unknown':
      await claimElsewhere(core, approvalId);
      clock.advance(lib.SENDING_LEASE_MS + 1000);
      return;
    case 'used':
      if (record.kind === 'send') {
        const claim = await claimElsewhere(core, approvalId);
        await core.approvals.complete(approvalId, claim.claimToken, { sentMessageId: 'matrix-sent-1' });
      } else if (record.kind === 'change') {
        await claimChange(core, approvalId);
      } else {
        await answerAsPerson(core, approvalId);
        await claimDownload(core, approvalId);
      }
      return;
    case 'failed': {
      const claim = await claimElsewhere(core, approvalId);
      await core.approvals.complete(approvalId, claim.claimToken, { error: 'backendError' });
      return;
    }
    case 'revoked':
      await core.approvals.revoke(approvalId, 'cancelled', { disposition: 'person' });
      return;
    default:
      throw new Error(`no arrangement for the row "${row}"`);
  }
}

/** A wrong code: never one the store issues, which are four letters or digits. */
export const WRONG_CODE = 'ZZZZ';

/** An approval id nobody prepared, in the store's grammar. */
export const NOBODY = `ap_${'0'.repeat(25)}N`;

/** Which rows each kind of action meets: a claim types no code, and a look or a list never reaches a provider. */
function applies(action, row) {
  if (action === 'claim') return wrongCodesOf(row) === 0;
  if (action === 'approve') return row !== 'provider-uncertain';
  if (action === 'list') return row !== 'not-found' && row !== 'provider-uncertain';
  return row !== 'provider-uncertain';
}

/**
 * Drives every row of `kind` through every surface, and hands each observation to `emit(row, surface, observation)`.
 *
 * `world(row)` makes a fresh home with an approval its surfaces prepared on `routeOf(row)`, and returns at least
 * `{ core, clock, approvalId }`, `notFound(action)` — the ids that must be the one `NOT_FOUND` there, each with its
 * variant's name — and, for a send, `fault()`, which makes the provider's next answer to a claim uncertain. Each surface
 * is `{ name, action, act(world, approvalId, row) }`: `look` and `list` never change anything, so the looks and lists
 * of a row share one world; every claim and approval has a world of its own, arranged the same way.
 */
export async function drive(kind, { world, surfaces, emit, lib }) {
  const arranged = async (row) => {
    const made = await world(row);
    await arrange(row, { core: made.core, lib, clock: made.clock, approvalId: made.approvalId });
    return made;
  };
  for (const row of ROWS[kind]) {
    if (row === 'not-found') {
      for (const surface of surfaces.filter((each) => applies(each.action, row))) {
        const made = await world(row);
        for (const [variant, approvalId] of await made.notFound(surface.action, surface)) {
          const seen = await surface.act(made, approvalId, row);
          emit(row, surface, { ...seen, extra: { ...seen.extra, variant, id: approvalId } });
        }
      }
      continue;
    }
    const lookers = surfaces.filter(
      (each) => (each.action === 'look' || each.action === 'list') && applies(each.action, row),
    );
    if (lookers.length > 0) {
      const made = await arranged(row);
      for (const surface of lookers) emit(row, surface, await surface.act(made, made.approvalId, row));
    }
    for (const surface of surfaces.filter(
      (each) => (each.action === 'claim' || each.action === 'approve') && applies(each.action, row),
    )) {
      const made = await arranged(row);
      if (row === 'provider-uncertain') await made.fault();
      emit(row, surface, await surface.act(made, made.approvalId, row));
    }
  }
}

/** A refusal's approval object as a surface handed it over: `null` kept as null, a missing one as undefined. */
function approvalIn(details) {
  return details !== null && typeof details === 'object' && 'approval' in details ? details.approval : undefined;
}

/**
 * What an MCP tool said, made comparable: a refusal's code, message, hint, approval object and any other detail; or a
 * result's approval object — for a look, the approval it reports. `sends` is how many times the provider was asked to
 * send, post, react or save during the call.
 */
export function observeTool(result, sends, options = {}) {
  const body = result.structuredContent ?? {};
  if (result.isError) {
    const { code, message, hint, details } = body.error ?? {};
    const { approval: _approval, ...rest } = details ?? {};
    return {
      ok: false,
      code,
      message,
      ...(hint ? { hint } : {}),
      approval: approvalIn(details),
      sends,
      ...(Object.keys(rest).length > 0 ? { details: rest } : {}),
    };
  }
  return { ok: true, approval: options.look ? (body.approval ?? body) : body.approval, sends };
}

/** What an operation threw, made comparable as `observeTool` makes a refusal; anything but a `CommsError` is thrown. */
export function observeError(error, sends) {
  if (error === null || typeof error !== 'object' || typeof error.code !== 'string' || !('exitCode' in error)) {
    throw error;
  }
  const { approval: _approval, ...rest } = error.details ?? {};
  return {
    ok: false,
    code: error.code,
    message: error.message,
    ...(error.hint ? { hint: error.hint } : {}),
    approval: approvalIn(error.details),
    sends,
    ...(Object.keys(rest).length > 0 ? { details: rest } : {}),
  };
}

/** Appends one observation to the file `AGENTCOMMS_MATRIX_OUT` names: the driver's report, one JSON line each. */
export function emitter(kind, channel) {
  const out = process.env.AGENTCOMMS_MATRIX_OUT;
  if (!out) throw new Error('AGENTCOMMS_MATRIX_OUT names the file the observations go to');
  return (row, surface, observation, role) =>
    appendFileSync(
      out,
      `${JSON.stringify({ kind, channel, row, surface: surface.name, action: surface.action, ...(role ? { role } : {}), observation })}\n`,
    );
}
