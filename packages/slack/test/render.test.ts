import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { externalCommand, remedy } from '@agentcomms/core';
import {
  renderConnected,
  renderCreatedDraft,
  renderDoctor,
  renderManifestHelp,
  renderPosted,
  renderRemoved,
  renderSignInStarted,
  renderWorkspace,
  renderWorkspaces,
} from '../src/cli/render.ts';
import type { SlackDraft } from '../src/compose/drafts.ts';
import type { WorkspaceView } from '../src/operations/workspaces.ts';
import { assertNoBareCommand, slackCommand, slackHandoffs, TEST_PATHS } from './support/handoffs.ts';

/** Slack's own commands, located from this checkout, for the renderers that name one. */
const HANDOFFS = slackHandoffs();

test('removal retry commands are constructed instead of embedded as shell text', () => {
  const source = readFileSync(new URL('../src/cli/render.ts', import.meta.url), 'utf8');
  const removal = source.slice(source.indexOf('export function renderRemoved('), source.indexOf('function draftCell('));
  assert.doesNotMatch(removal, /agent-slack doctor/, 'printed commands must be located, never written as text');
  // Located from the handoffs it is given, which carry the shell the output is for (CUE-403).
  assert.match(removal, /handoffs\.own\(\['doctor'\]\)/, 'the renderer must locate the command it names');
});

for (const platform of ['darwin', 'win32'] as const) {
  test(`removal renders the exact retry command for ${platform}`, () => {
    for (const issue of [
      undefined,
      { code: 'CONFIG', message: 'the old credential bundle is missing from its recorded store' },
    ]) {
      const text = renderRemoved(
        {
          alias: 'acme',
          accountId: 'acc_0000000000000000',
          removed: true,
          cleanup: [
            {
              ref: 'slack/token/old',
              platform: 'slack',
              workspace: 'T0001',
              cleaned: false,
              tokens: [{ kind: 'access', status: 'pending', deadline: '2026-10-05T12:00:00.000Z' }],
              ...(issue ? { issue } : {}),
            },
          ],
        },
        slackHandoffs(TEST_PATHS, platform),
      );
      const doctor = slackCommand(TEST_PATHS, ['doctor'], platform);
      assert.equal(
        text,
        [
          'Disconnected "acme" from this machine. The stored credential is gone.',
          'Old credential for T0001: access pending (deadline 2026-10-05T12:00:00.000Z).',
          issue
            ? `The pending revocation ledger entry remains for ${doctor} to retry: the old credential bundle is missing from its recorded store.`
            : `The old credential bundle remains for ${doctor} to retry.`,
          '',
          'The Slack app is still installed in your workspace. Remove it there through Slack’s own app settings —',
          'nothing here will do that for you.',
        ].join('\n'),
      );
    }
  });
}

/**
 * What reaches a terminal.
 *
 * The operations already neutralise anything a workspace controls. This layer adds the one thing a terminal
 * needs on top, and it is not theoretical: a workspace named with a carriage return can overwrite the line above
 * it, so a list of two workspaces can be made to show one — or to show a line nobody wrote.
 */

function view(over: Partial<WorkspaceView> = {}): WorkspaceView {
  return {
    alias: 'acme',
    accountId: 'acc_0000000000000000',
    workspaceId: 'T0001',
    workspaceName: 'Acme',
    userId: 'U0001',
    mode: 'read',
    grantedScopes: ['channels:history', 'users:read'],
    createdAt: '2026-09-22T12:00:00.000Z',
    ...over,
  };
}

test('a newline in a workspace name cannot forge the row beneath it', () => {
  /*
   * This is what this layer adds, and the only thing it adds.
   *
   * `stripInvisible` removes escape sequences and lone carriage returns already, but keeps tab and newline on
   * purpose — they are legitimate in a message body, which is what it was written for. In a list whose job is to
   * say what each workspace may do, a name carrying a newline prints a second line that looks exactly like the
   * scopes row under it.
   */
  const printed = renderWorkspaces([view({ workspaceName: 'Acme\n  read · T0002 · 14 scopes' })], false, HANDOFFS);
  const lines = printed.split('\n');
  assert.equal(lines.length, 2, `a name added a line:\n${printed}`);
  // Flattened onto the alias row, not dropped: the name is still readable, it just cannot be a row of its own.
  assert.match(lines[0] ?? '', /Acme\s+read · T0002 · 14 scopes/, 'the text was dropped rather than flattened');
  assert.match(lines[1] ?? '', /read · T0001 · 2 scopes/, 'the real row is gone');
});

test('a tab in a workspace name cannot pad it into a neighbouring column', () => {
  const printed = renderWorkspaces([view({ workspaceName: 'Acme\t\tread' })], false, HANDOFFS);
  assert.doesNotMatch(printed, /\t/, 'a tab reached the terminal');
});

test('the escape sequences stripInvisible handles do not reach the terminal either', () => {
  // Not this layer's work, but it is what a reader of a workspace list would assume, so it is held here too.
  const nasty = `Acme${String.fromCharCode(27)}[2J${String.fromCharCode(13)}overwritten${String.fromCharCode(7)}`;
  for (const printed of [
    renderWorkspaces([view({ workspaceName: nasty })], false, HANDOFFS),
    renderWorkspace(view({ workspaceName: nasty }), false),
  ]) {
    for (const code of [27, 13, 7]) {
      assert.doesNotMatch(printed, new RegExp(String.fromCharCode(code)), `character ${code} reached the terminal`);
    }
  }
});

test('a very long workspace name is bounded rather than allowed to push the row apart', () => {
  const printed = renderWorkspaces([view({ workspaceName: 'A'.repeat(500) })], false, HANDOFFS);
  for (const line of printed.split('\n')) assert.ok(line.length < 120, `a line ran to ${line.length} characters`);
});

test('a workspace with no name shows its id rather than an empty gap', () => {
  const printed = renderWorkspaces([view({ workspaceName: undefined })], false, HANDOFFS);
  assert.match(printed, /T0001/);
  assert.doesNotMatch(printed, / — \n/);
});

test('empty workspace guidance builds its command for the selected shell', () => {
  const expected = slackCommand(TEST_PATHS, ['workspace', 'add', '<organisation>/slack'], 'win32');
  const printed = renderWorkspaces([], false, slackHandoffs(TEST_PATHS, 'win32'));
  assert.ok(printed.includes(`With an organisation profile: ${expected}`), printed);
  assertNoBareCommand(printed);
});

test('list, show and connected output name the organisation app role', () => {
  for (const mode of ['read', 'send'] as const) {
    const profile = view({
      alias: 'rgc/slack',
      organisation: 'rgc',
      organisationLabel: 'North Culture',
      profileApp: mode,
    });
    for (const rendered of [
      renderWorkspaces([profile], false, HANDOFFS),
      renderWorkspace(profile, false),
      renderConnected(profile, false, false, HANDOFFS),
    ]) {
      assert.match(rendered, new RegExp(`North Culture's ${mode} app`));
      assert.doesNotMatch(rendered, /Really Good Culture|your own app/);
    }
  }
  const missingProfile = view({ alias: 'rgc/slack', organisation: 'rgc', profileApp: 'read' });
  assert.match(renderWorkspace(missingProfile, false), /the rgc organisation's read app/);
  const own = renderWorkspace(view({ oauthClientId: '1111.2222' }), false);
  assert.match(own, /your own app/);
  assert.match(renderWorkspaces([view({ oauthClientId: '1111.2222' })], false, HANDOFFS), /your own app/);
});

test('renderer commands use the explicitly selected shell platform', () => {
  const draft = { draftId: 'draft one' } as SlackDraft;
  const windows = slackHandoffs(TEST_PATHS, 'win32');
  const created = renderCreatedDraft(draft, 'two words', windows);
  assert.ok(
    created.endsWith(
      `Preview it with: ${slackCommand(TEST_PATHS, ['post', 'prepare', '--workspace', 'two words', '--draft', 'draft one'], 'win32')}`,
    ),
    created,
  );
  assertNoBareCommand(created);
  const started = renderSignInStarted(
    {
      flowId: 'flow one',
      alias: 'two words',
      mode: 'read',
      authUrl: 'https://example.test',
      redirectUrl: 'http://localhost',
      expiresAt: '2026-10-04T12:00:00.000Z',
    },
    true,
    false,
    windows,
  );
  assert.ok(
    started.includes(slackCommand(TEST_PATHS, ['workspace', 'reauth', 'two words', '--finish', 'flow one'], 'win32')),
    started,
  );
  assert.match(started, /workspace reauth "two words" --finish "flow one"$/m);
  assertNoBareCommand(started);
  const help = renderManifestHelp('read', 60426, false, undefined, windows);
  assert.match(help, /--port "60426"/);
  assertNoBareCommand(help);
});

test('doctor prefixes every command in a multi-line repair', () => {
  const rendered = renderDoctor(
    {
      healthy: false,
      summary: { ok: 0, unknown: 0, warn: 0, fail: 1 },
      checks: [
        {
          id: 'rivals',
          title: 'Other servers',
          status: 'fail',
          detail: 'two unsafe entries are registered',
          // Each client's own command, as the doctor makes them: external commands, a line each.
          fix: remedy(
            externalCommand(['claude', 'mcp', 'remove', 'first'], 'the client removes its own entry', 'linux'),
            externalCommand(['codex', 'mcp', 'remove', 'second'], 'the client removes its own entry', 'linux'),
          ),
          workspace: null,
        },
      ],
    },
    false,
  );
  assert.match(
    rendered,
    /fail {2}Other servers: two unsafe entries are registered\n {6}fix: claude mcp remove first\n {6}fix: codex mcp remove second/,
  );
});

test('a post reads as it always did, and a note about its record is said after it rather than dropped', () => {
  // `post send` prints this: a post whose approval could not be marked used afterwards has to say so at a terminal too.
  const approval = { id: 'ap_1', kind: 'send' as const, channel: 'slack', state: 'used' as const, claimable: false };
  assert.equal(
    renderPosted({ approvalId: 'ap_1', channel: 'C1', ts: '1700000000.000100', approval }),
    'Posted to C1 at 1700000000.000100.',
  );
  const note = 'the approval could not be marked used (the store was busy), so it will read as unknown';
  assert.equal(
    renderPosted({ approvalId: 'ap_1', channel: 'C1', ts: '1700000000.000100', note, approval }),
    `Posted to C1 at 1700000000.000100. The approval could not be marked used (the store was busy), so it will read as unknown.`,
  );
  const file = { id: 'F1', name: 'a.txt', size: 1, sha256: 'ab' };
  assert.match(
    renderPosted({ approvalId: 'ap_1', channel: 'C1', ts: '1700000000.000200', files: [file], note, approval }).split(
      '\n',
    )[0] ?? '',
    /^Posted 1 file to C1 at 1700000000\.000200\. The approval could not be marked used/,
  );
});
