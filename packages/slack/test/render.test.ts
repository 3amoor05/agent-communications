import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { commandText, shellCommand } from '@agentcomms/core';
import {
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

test('removal retry commands are constructed instead of embedded as shell text', () => {
  const source = readFileSync(new URL('../src/cli/render.ts', import.meta.url), 'utf8');
  const removal = source.slice(source.indexOf('export function renderRemoved('), source.indexOf('function draftCell('));
  assert.doesNotMatch(removal, /agent-slack doctor/, 'printed commands must be built with shellCommand');
  assert.match(removal, /shellCommand\([\s\S]*?, platform\)/, 'the renderer must pass its selected platform');
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
        platform,
      );
      assert.equal(
        text,
        [
          'Disconnected "acme" from this machine. The stored credential is gone.',
          'Old credential for T0001: access pending (deadline 2026-10-05T12:00:00.000Z).',
          issue
            ? 'The pending revocation ledger entry remains for agent-slack doctor to retry: the old credential bundle is missing from its recorded store.'
            : 'The old credential bundle remains for agent-slack doctor to retry.',
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
  const printed = renderWorkspaces([view({ workspaceName: 'Acme\n  read · T0002 · 14 scopes' })], false);
  const lines = printed.split('\n');
  assert.equal(lines.length, 2, `a name added a line:\n${printed}`);
  // Flattened onto the alias row, not dropped: the name is still readable, it just cannot be a row of its own.
  assert.match(lines[0] ?? '', /Acme\s+read · T0002 · 14 scopes/, 'the text was dropped rather than flattened');
  assert.match(lines[1] ?? '', /read · T0001 · 2 scopes/, 'the real row is gone');
});

test('a tab in a workspace name cannot pad it into a neighbouring column', () => {
  const printed = renderWorkspaces([view({ workspaceName: 'Acme\t\tread' })], false);
  assert.doesNotMatch(printed, /\t/, 'a tab reached the terminal');
});

test('the escape sequences stripInvisible handles do not reach the terminal either', () => {
  // Not this layer's work, but it is what a reader of a workspace list would assume, so it is held here too.
  const nasty = `Acme${String.fromCharCode(27)}[2J${String.fromCharCode(13)}overwritten${String.fromCharCode(7)}`;
  for (const printed of [
    renderWorkspaces([view({ workspaceName: nasty })], false),
    renderWorkspace(view({ workspaceName: nasty }), false),
  ]) {
    for (const code of [27, 13, 7]) {
      assert.doesNotMatch(printed, new RegExp(String.fromCharCode(code)), `character ${code} reached the terminal`);
    }
  }
});

test('a very long workspace name is bounded rather than allowed to push the row apart', () => {
  const printed = renderWorkspaces([view({ workspaceName: 'A'.repeat(500) })], false);
  for (const line of printed.split('\n')) assert.ok(line.length < 120, `a line ran to ${line.length} characters`);
});

test('a workspace with no name shows its id rather than an empty gap', () => {
  const printed = renderWorkspaces([view({ workspaceName: undefined })], false);
  assert.match(printed, /T0001/);
  assert.doesNotMatch(printed, / — \n/);
});

test('renderer commands use the explicitly selected shell platform', () => {
  const draft = { draftId: 'draft one' } as SlackDraft;
  assert.match(
    renderCreatedDraft(draft, 'two words', 'win32'),
    new RegExp(
      commandText(
        shellCommand(['agent-slack', 'post', 'prepare', '--workspace', 'two words', '--draft', 'draft one'], 'win32'),
      ).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'),
    ),
  );
  assert.match(
    renderSignInStarted(
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
      'win32',
    ),
    /agent-slack workspace reauth "two words" --finish "flow one"/,
  );
  assert.match(renderManifestHelp('read', 60426, false, undefined, 'win32'), /--port "60426"/);
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
          fix: 'claude mcp remove first\ncodex mcp remove second',
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
  assert.equal(
    renderPosted({ approvalId: 'ap_1', channel: 'C1', ts: '1700000000.000100' }),
    'Posted to C1 at 1700000000.000100.',
  );
  const note = 'the approval could not be marked used (the store was busy), so it will read as unknown';
  assert.equal(
    renderPosted({ approvalId: 'ap_1', channel: 'C1', ts: '1700000000.000100', note }),
    `Posted to C1 at 1700000000.000100. The approval could not be marked used (the store was busy), so it will read as unknown.`,
  );
  const file = { id: 'F1', name: 'a.txt', size: 1, sha256: 'ab' };
  assert.match(
    renderPosted({ approvalId: 'ap_1', channel: 'C1', ts: '1700000000.000200', files: [file], note }).split('\n')[0] ??
      '',
    /^Posted 1 file to C1 at 1700000000\.000200\. The approval could not be marked used/,
  );
});
