import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { before, test } from 'node:test';
import { ROWS } from './helpers/approval-matrix.mjs';
import { ROOT } from './helpers/real-shell.mjs';
import { tempDir } from './helpers/temp-dir.mjs';

/**
 * The D2 outcome matrix, every row on every surface (CUE-404 Task 24; design 2026-10-05 §D2 and §5 D2-a).
 *
 * D2 is one locked classification of every approval record into an outcome, which every surface reports as it is:
 * Gmail's tools, command and terminal approval, Slack's posts, posts with files and reactions, Resend's sends, core's
 * changes, the download questions, and every status, wait and list. Each package's driver (`test/support/matrix.ts`,
 * listed below) prepares a real approval through its own surface on a fresh home with its fake provider, puts it into
 * each row's state through `test/helpers/approval-matrix.mjs` — the one place states are made — acts on it through each
 * of its surfaces, and writes down what each said, one JSON line each. This file holds what D2 says each must be, and
 * holds every line to it.
 *
 * What a row is, here:
 *
 * | row | the record |
 * |---|---|
 * | not-found | an id nobody prepared, another owner's, another kind's, another channel's, or pinned away |
 * | corrupt | a parseable, attributable record whose timestamps its state does not allow |
 * | pending-chat | pending on the chat route, the live policy still chat |
 * | pending-confirm | pending on the confirm route: waiting for a person outside the chat |
 * | wrong-code-1/2/3 | a confirm approval the person typed a wrong code for, once, twice, three times |
 * | approved | approved at the terminal, inside its day |
 * | live-never | pending, the owner's policy turned to never and the revocation not there yet |
 * | revoked-by-never | revoked by a never, the policy back to chat |
 * | expired-pending, expired-approved | expired before approval; approved, then a day unused |
 * | clock-anomaly | observed with the clock before its creation |
 * | provider-uncertain | claimed, and the provider's answer leaves the outcome uncertain |
 * | sending, unknown | another call's claim inside its lease; past it |
 * | used, failed, revoked | sent (or the change claimed); failed; cancelled by a person |
 * | answered, expired-unanswered, expired-answered | a download question answered; expired before; answered, then expired |
 *
 * A surface that departs from D2 where a decision for the coordinator is still open is listed in `KNOWN` with what it
 * does instead: its case runs, and is reported as a TODO rather than passed or failed.
 */

/** The drivers: each a package's own program, run with its own fakes. */
const DRIVERS = ['gmail', 'slack'].map((channel) => ({
  channel,
  dir: join(ROOT, 'packages', channel),
  entry: join('test', 'support', 'matrix.ts'),
}));

/** Every surface each driver must report on, by the action it takes: nothing named here may go missing. */
const SURFACES = {
  gmail: {
    send: {
      look: ['gmail_send_wait'],
      list: ['gmail_send_list'],
      claim: ['gmail_draft_send', 'gmail_draft_send (a client trusted with forms)', 'send execute'],
      approve: ['approve (terminal)'],
    },
  },
  slack: {
    send: {
      look: [
        'slack_approval_wait (a post)',
        'slack_approval_wait (a post with a file)',
        'slack_approval_wait (a reaction)',
      ],
      claim: ['slack_post_send', 'slack_post_send (a post with a file)', 'slack_react_send'],
      approve: [
        'approve (terminal, a post)',
        'approve (terminal, a post with a file)',
        'approve (terminal, a reaction)',
      ],
    },
  },
};

/**
 * Where a surface does not do what D2 says, and the decision is not this task's: the observation's case is reported as
 * a TODO naming what it does instead.
 */
const KNOWN = [
  {
    channel: 'gmail',
    surface: 'approve (terminal)',
    variant: 'another channel',
    todo: 'Gmail’s terminal approval looks for any send, not only a Gmail one: another channel’s id is classified, then refused as “the mailbox this approval belongs to is no longer connected” — not D2’s one NOT_FOUND',
  },
  ...['a post', 'a post with a file', 'a reaction'].map((what) => ({
    channel: 'slack',
    surface: `approve (terminal, ${what})`,
    variant: 'another channel',
    todo: 'Slack’s terminal approval looks for any send, not only a Slack one: another channel’s id is classified, then refused as “the workspace this approval belongs to is no longer connected” — not D2’s one NOT_FOUND',
  })),
];

const NOT_FOUND_APPROVAL_NULL = true;

/** Every observation, by driver. */
let seen = [];

function run(driver, out) {
  return new Promise((settle, fail) => {
    const child = spawn(
      process.execPath,
      ['--experimental-strip-types', '--disable-warning=ExperimentalWarning', driver.entry],
      {
        cwd: driver.dir,
        env: { ...process.env, AGENTCOMMS_MATRIX_OUT: out, NO_COLOR: '1' },
        stdio: ['ignore', 'ignore', 'pipe'],
      },
    );
    let stderr = '';
    child.stderr.on('data', (chunk) => {
      stderr += chunk;
    });
    child.once('error', fail);
    child.once('close', (code) => settle({ code, stderr }));
  });
}

before(async () => {
  const dir = await tempDir('approval-matrix-');
  const runs = await Promise.all(
    DRIVERS.map(async (driver) => {
      const out = join(dir, `${driver.channel}.jsonl`);
      const finished = await run(driver, out);
      assert.equal(finished.code, 0, `the ${driver.channel} driver failed:\n${finished.stderr}`);
      return readFileSync(out, 'utf8')
        .split('\n')
        .filter(Boolean)
        .map((line) => JSON.parse(line));
    }),
  );
  seen = runs.flat();
});

// ── What each row must say ─────────────────────────────────────────────────────────────────────────────────────────

/** A look or a list: the approval's state and whether it can be claimed now. */
function shows(state, claimable, extra = () => {}) {
  return (o) => {
    assert.equal(o.ok, true, JSON.stringify(o));
    assert.ok(o.approval, 'the record is shown');
    assert.equal(o.approval.state, state);
    if (o.approval.claimable !== undefined || claimable !== undefined) assert.equal(o.approval.claimable, claimable);
    extra(o);
  };
}

/** A refusal: its code, its words, and where the approval stands — and nothing asked of the provider. */
function refused(code, pattern, state, extra = () => {}) {
  return (o) => {
    assert.equal(o.ok, false, `refused, not done: ${JSON.stringify(o)}`);
    assert.equal(o.code, code, o.message);
    assert.match(o.message, pattern);
    assert.equal(o.sends, 0, 'nothing was sent, posted, reacted or saved');
    if (state !== null) {
      assert.ok(o.approval, `the refusal says where the approval stands: ${JSON.stringify(o)}`);
      assert.equal(o.approval.state, state);
      // A corrupt record's object is its stub, `{ approvalId, state, reason }`: nothing else of it is shown (D2).
      if (state === 'corrupt') assert.deepEqual(Object.keys(o.approval).sort(), ['approvalId', 'reason', 'state']);
      else assert.equal(o.approval.claimable, false);
    }
    // D2: APPROVAL_REQUIRED never describes a record that is approved, finished, unusable or being sent.
    if (['approved', 'expired', 'used', 'failed', 'sending', 'unknown', 'corrupt', 'revoked'].includes(state)) {
      assert.notEqual(o.code, 'APPROVAL_REQUIRED');
    }
    extra(o);
  };
}

/** Sent, once, with the approval spent. */
function sent(o) {
  assert.equal(o.ok, true, `sent: ${JSON.stringify(o)}`);
  assert.equal(o.sends, 1, 'exactly one send');
  assert.equal(o.approval?.state, 'used');
  assert.equal(o.approval?.claimable, false);
}

/** Approved at the terminal: a day to use it. */
function approvedNow(o) {
  assert.equal(o.ok, true, JSON.stringify(o));
  assert.equal(o.approval?.state, 'approved');
  assert.equal(o.approval?.claimable, true);
  assert.equal(o.sends, 0);
}

/** Waiting for a person outside the chat: the person's command and the wait that learns it, named. */
function waitingForPerson(code) {
  return refused(code, /needs approval outside the chat/, 'pending', (o) => {
    assert.ok(o.hint?.includes(o.approval.id), `the hint names this approval: ${o.hint}`);
    assert.match(o.hint ?? '', /wait/, 'and the wait that learns when they have');
  });
}

const VOIDED_BY_NEVER = /the approval was voided \(sending was turned off since this was prepared \(policy: never\)\)$/;
const TIME = '\\d{4}-\\d{2}-\\d{2}T[\\d:.]+Z';

/** D2 for a send: by row, then by action. A surface with its own words is named. */
const SEND = {
  corrupt: {
    look: shows('corrupt', false),
    list: shows('corrupt', false),
    claim: refused('APPROVAL_VOID', /^nothing was done: approval \S+ is corrupt \(timestamp-misplaced\)$/, 'corrupt'),
    approve: refused('APPROVAL_VOID', /^nothing was done: approval \S+ is corrupt \(timestamp-misplaced\)$/, 'corrupt'),
  },
  'pending-chat': {
    look: shows('pending', true),
    list: shows('pending', true),
    claim: sent,
    // Not a D2 row: a person may still approve a chat-route send at the terminal, and nothing is sent by it.
    approve: approvedNow,
  },
  'pending-confirm': {
    look: shows('pending', false),
    list: shows('pending', false),
    claim: (o, { surface, role }) => {
      // D2: a trusted client shows the form — the code accepted approves (and the send goes), a decline revokes as
      // declined, a cancel decides nothing. An untrusted client is APPROVAL_REQUIRED with the command and the wait;
      // a surface with no forms at all (a command, Slack, Resend) says the approval is pending, with the same two.
      if (role === 'decline') {
        return refused('APPROVAL_VOID', /^nothing was sent: the approval was declined$/, 'revoked', (r) => {
          assert.equal(r.approval.reason, 'declined');
          assert.equal(r.extra?.stored, 'revoked', 'revoked as the person’s decision');
        })(o);
      }
      if (role === 'cancel') {
        return refused(
          'APPROVAL_PENDING',
          /the form was cancelled, and the approval is still waiting/,
          'pending',
          (r) => assert.equal(r.extra?.stored, 'pending'),
        )(o);
      }
      if (surface.includes('trusted with forms')) return sent(o);
      return waitingForPerson(surface === 'gmail_draft_send' ? 'APPROVAL_REQUIRED' : 'APPROVAL_PENDING')(o);
    },
    approve: approvedNow,
  },
  'wrong-code-1': {
    look: shows('pending', false),
    list: shows('pending', false),
    approve: refused('APPROVAL_REQUIRED', /the challenge did not match$/, 'pending', (o) =>
      assert.equal(o.extra?.stored, 'pending'),
    ),
  },
  'wrong-code-2': {
    look: shows('pending', false),
    list: shows('pending', false),
    approve: refused('APPROVAL_REQUIRED', /the challenge did not match$/, 'pending', (o) =>
      assert.equal(o.extra?.stored, 'pending'),
    ),
  },
  'wrong-code-3': {
    look: shows('pending', false),
    list: shows('pending', false),
    approve: refused('APPROVAL_VOID', /too many wrong answers to the challenge$/, 'revoked', (o) =>
      assert.equal(o.extra?.stored, 'revoked'),
    ),
  },
  approved: {
    look: shows('approved', true),
    list: shows('approved', true),
    claim: sent,
    // Not a D2 row: approved once, it is not approved again — and stays approved.
    approve: (o) => {
      assert.equal(o.ok, false);
      assert.equal(o.approval?.state, 'approved');
      assert.equal(o.sends, 0);
    },
  },
  'live-never': {
    look: shows('pending', false, (o) => {
      if (o.approval.reason !== undefined) {
        assert.equal(o.approval.reason, 'sending is turned off (policy: never); any use revokes it');
      }
    }),
    list: shows('pending', false, (o) =>
      assert.equal(o.approval.reason, 'sending is turned off (policy: never); any use revokes it'),
    ),
    claim: refused('POLICY_NEVER', /sending is turned off for this \w+ \(policy: never\)$/, 'revoked'),
    approve: refused('POLICY_NEVER', /sending is turned off for this \w+ \(policy: never\)$/, 'revoked'),
  },
  'revoked-by-never': {
    look: shows('revoked', false),
    list: shows('revoked', false),
    claim: refused('APPROVAL_VOID', VOIDED_BY_NEVER, 'revoked'),
    approve: refused('APPROVAL_VOID', VOIDED_BY_NEVER, 'revoked'),
  },
  'expired-pending': {
    look: shows('expired', false),
    list: shows('expired', false),
    claim: refused(
      'APPROVAL_EXPIRED',
      new RegExp(`^this approval expired; nothing was sent with it: prepared at ${TIME}, expired at ${TIME}$`),
      'expired',
    ),
    approve: refused(
      'APPROVAL_EXPIRED',
      new RegExp(`^this approval expired; nothing was sent with it: prepared at ${TIME}, expired at ${TIME}$`),
      'expired',
    ),
  },
  'expired-approved': {
    look: shows('expired', false),
    list: shows('expired', false),
    claim: refused(
      'APPROVAL_EXPIRED',
      new RegExp(`^this approval expired; nothing was sent with it: approved at ${TIME}, expired unused at ${TIME}$`),
      'expired',
    ),
    approve: refused(
      'APPROVAL_EXPIRED',
      new RegExp(`^this approval expired; nothing was sent with it: approved at ${TIME}, expired unused at ${TIME}$`),
      'expired',
    ),
  },
  'clock-anomaly': {
    look: shows('expired', false),
    list: shows('expired', false, (o) => assert.equal(o.approval.reason, 'clock-anomaly')),
    claim: refused(
      'APPROVAL_EXPIRED',
      new RegExp(`^the clock moved backwards; this approval was expired safely at ${TIME}; nothing was sent with it$`),
      'expired',
      (o) => assert.equal(o.approval.reason, 'clock-anomaly'),
    ),
    approve: refused(
      'APPROVAL_EXPIRED',
      new RegExp(`^the clock moved backwards; this approval was expired safely at ${TIME}; nothing was sent with it$`),
      'expired',
      (o) => assert.equal(o.approval.reason, 'clock-anomaly'),
    ),
  },
  'provider-uncertain': {
    claim: (o) => {
      assert.equal(o.ok, false, JSON.stringify(o));
      assert.equal(o.code, 'SEND_OUTCOME_UNKNOWN', o.message);
      assert.match(o.message, /is not known/);
      assert.equal(o.sends, 1, 'the provider was asked once, and its answer was uncertain');
      assert.equal(o.approval?.state, 'sending');
      assert.equal(o.approval?.claimable, false);
      assert.ok(o.approval?.sendingAt, 'when it was claimed');
      assert.ok(o.approval?.unknownAt, 'when it reads unknown');
    },
  },
  sending: {
    look: shows('sending', false, (o) => assert.ok(o.approval.unknownAt)),
    list: shows('sending', false),
    claim: refused(
      'APPROVAL_PENDING',
      new RegExp(`being sent by another call since ${TIME}; wait for it$`),
      'sending',
      (o) => assert.doesNotMatch(o.hint ?? '', /prepare (it|the send) again and/i),
    ),
    approve: refused(
      'APPROVAL_PENDING',
      new RegExp(`being sent by another call since ${TIME}; wait for it$`),
      'sending',
    ),
  },
  unknown: {
    look: shows('unknown', false),
    list: shows('unknown', false),
    claim: refused('SEND_OUTCOME_UNKNOWN', /the outcome of its send is unknown: it may have gone out$/, 'unknown'),
    approve: refused('SEND_OUTCOME_UNKNOWN', /the outcome of its send is unknown: it may have gone out$/, 'unknown'),
  },
  used: {
    look: shows('used', false),
    list: shows('used', false),
    claim: refused(
      'APPROVAL_VOID',
      new RegExp(`the approval was used already: it was sent at ${TIME}, message id matrix-sent-1$`),
      'used',
    ),
    approve: refused(
      'APPROVAL_VOID',
      new RegExp(`the approval was used already: it was sent at ${TIME}, message id matrix-sent-1$`),
      'used',
    ),
  },
  failed: {
    look: shows('failed', false),
    list: shows('failed', false),
    claim: (o, { role }) => {
      // The failure itself, as Slack's post with a file meets it: the upload done, the share refused. Nothing was
      // posted, and what was uploaded is said (D2, `failed`).
      if (role === 'provider-refused') {
        assert.equal(o.ok, false);
        assert.match(o.message, /^nothing was posted: Slack refused the request: posting_to_channel_denied$/);
        assert.notEqual(o.code, 'SEND_OUTCOME_UNKNOWN');
        assert.equal(o.sends, 1, 'the share was asked, and refused');
        assert.equal(o.details?.uploaded?.length, 1);
        assert.equal(o.details.uploaded[0].name, 'report.pdf');
        assert.ok(o.details.uploaded[0].id, 'by its id in Slack');
        assert.equal(o.approval?.state, 'failed');
        assert.equal(o.extra?.stored, 'failed');
        return;
      }
      refused('APPROVAL_VOID', /^nothing was sent: the send it was claimed for failed \(backendError\)$/, 'failed')(o);
    },
    approve: refused(
      'APPROVAL_VOID',
      /^nothing was sent: the send it was claimed for failed \(backendError\)$/,
      'failed',
    ),
  },
  revoked: {
    look: shows('revoked', false),
    list: shows('revoked', false),
    claim: refused('APPROVAL_VOID', /^nothing was sent: the approval was voided \(cancelled\)$/, 'revoked'),
    approve: refused('APPROVAL_VOID', /^nothing was sent: the approval was voided \(cancelled\)$/, 'revoked'),
  },
};

const EXPECT = { send: SEND };

/** D2's one NOT_FOUND: no record detail, `approval: null`, nothing asked of the provider. */
function notFound(o) {
  assert.equal(o.ok, false, JSON.stringify(o));
  assert.equal(o.code, 'NOT_FOUND', o.message);
  assert.match(o.message, /: no approval ap_\w+$/);
  if (NOT_FOUND_APPROVAL_NULL) assert.equal(o.approval, null, 'approval: null');
  assert.equal(o.sends, 0);
}

function known(line) {
  return KNOWN.find(
    (each) =>
      each.channel === line.channel &&
      each.surface === line.surface &&
      (each.variant === undefined || each.variant === line.observation.extra?.variant) &&
      (each.row === undefined || each.row === line.row),
  );
}

const labelOf = (line) =>
  `${line.channel} · ${line.surface} (${line.action})${line.role ? ` · ${line.role}` : ''}${
    line.observation.extra?.variant ? ` · ${line.observation.extra.variant}` : ''
  }`;

for (const kind of ['send']) {
  test(`${kind}: every surface reported every row its actions meet`, () => {
    for (const [channel, kinds] of Object.entries(SURFACES)) {
      for (const [action, surfaces] of Object.entries(kinds[kind] ?? {})) {
        for (const surface of surfaces) {
          const rows = new Set(
            seen
              .filter((line) => line.channel === channel && line.surface === surface && line.kind === kind)
              .map((line) => line.row),
          );
          for (const row of ROWS[kind]) {
            const meets =
              (action !== 'claim' || !/^wrong-code-/.test(row)) &&
              (action === 'claim' || row !== 'provider-uncertain') &&
              (action !== 'list' || row !== 'not-found');
            if (meets) assert.ok(rows.has(row), `${channel} · ${surface} (${action}) never met the row ${row}`);
          }
        }
      }
    }
  });

  for (const row of ROWS[kind]) {
    test(`${kind}: ${row}`, async (t) => {
      const lines = seen.filter((line) => line.kind === kind && line.row === row);
      assert.ok(lines.length > 0, 'no surface met this row');
      for (const line of lines) {
        const todo = known(line);
        await t.test(labelOf(line), todo ? { todo: todo.todo } : {}, () => {
          if (row === 'not-found') return notFound(line.observation);
          const expect = EXPECT[kind][row]?.[line.action];
          assert.ok(expect, `D2 says nothing here for ${row} on ${line.action}`);
          return expect(line.observation, line);
        });
      }
      if (row === 'not-found') {
        // One NOT_FOUND, byte for byte: every id a surface must not find is refused in the same words, but its id.
        const bySurface = Map.groupBy(
          lines.filter((line) => !known(line)),
          (line) => `${line.channel} · ${line.surface}`,
        );
        for (const [surface, refusals] of bySurface) {
          const words = new Set(
            refusals.map((line) =>
              JSON.stringify({ ...line.observation, extra: undefined }).replaceAll(line.observation.extra.id, '<id>'),
            ),
          );
          assert.equal(words.size, 1, `${surface}: ${[...words].join('\n')}`);
        }
      }
    });
  }
}
