import { type AccountConfig, type CliHandoffs, handoffSentence } from '@agentcomms/core';
import { handoffsSentence } from '../handoffs.ts';
import { appManifestUrl, type InstallMode, parseMode, scopesForMode } from '../manifest.ts';

/**
 * What a workspace can do, and what changing that takes.
 *
 * One place for the facts and the two procedures, so `workspace mode`, the refusal a narrowing sign-in meets, and —
 * when Slack has an MCP server — the agent tools all say the same thing. The procedures are text a person follows:
 * one step of each is in a browser, and nothing here can take it for them.
 */

/**
 * Every scope `send` adds to `read`: the ones that let a token act outward — post, upload, react.
 *
 * Derived from the two lists rather than written out, so the day a scope joins `send` it is counted here too.
 */
export const OUTWARD_SCOPES: readonly string[] = scopesForMode('send').filter(
  (scope) => !scopesForMode('read').includes(scope),
);

export interface ModeReport {
  readonly alias: string;
  /** What the configuration records. */
  readonly mode: InstallMode;
  /**
   * The outward scopes in the grant recorded at sign-in. From the record, not from Slack: a token revoked since, or
   * narrowed by removing the app, would still show here until the next sign-in or `doctor`.
   */
  readonly outwardScopes: readonly string[];
  readonly canActOutward: boolean;
  readonly toSend: readonly string[];
  readonly toRead: readonly string[];
}

/**
 * What a workspace can do, and the steps each way. `handoffs` make the commands the steps name, located from the
 * installation printing them, or say why there are none here.
 */
export function modeReport(
  alias: string,
  account: AccountConfig,
  handoffs: CliHandoffs,
  requested?: number,
): ModeReport {
  // The port asked for, else the one the workspace was signed in with; neither, and the steps say `<port>`.
  const port = requested ?? account.redirectPort;
  const mode = parseMode(account.mode ?? account.tier, `"${alias}"`);
  const granted = new Set(account.grantedScopes ?? []);
  const outwardScopes = OUTWARD_SCOPES.filter((scope) => granted.has(scope));
  return {
    alias,
    mode,
    outwardScopes,
    canActOutward: outwardScopes.length > 0,
    toSend:
      mode === 'send'
        ? []
        : account.organisation
          ? profileMoveSteps(alias, 'send', handoffs)
          : wideningSteps(alias, handoffs, port, account.appId),
    toRead:
      mode === 'read' && outwardScopes.length === 0
        ? []
        : account.organisation
          ? profileMoveSteps(alias, 'read', handoffs)
          : narrowingSteps(alias, handoffs, port, { knowsItsApp: account.oauthClientId !== undefined }),
  };
}

export function profileMoveSteps(alias: string, mode: InstallMode, handoffs: CliHandoffs): string[] {
  return [
    handoffSentence(
      handoffs.own(['workspace', 'mode', alias, mode]),
      (command) => `Sign in through the organisation's ${mode} app with ${command}.`,
      { instead: `Sign in through the organisation's ${mode} app with slack_mode_set from a chat.` },
    ),
  ];
}

const portText = (port: number | undefined): string => (port === undefined ? '<port>' : String(port));

/**
 * `read` → `send`: the app first, because a token can only be granted what its app declares, and changing the app
 * changes no token already issued.
 *
 * With the app's id recorded, the first step links straight to that app's manifest page and names `app update`, which
 * edits exactly that app from a terminal. Without it there is no telling which of the person's apps this workspace
 * uses, so the step says how to find it rather than guessing — and does not offer `app update`, which would refuse.
 *
 * The second step is the change itself, from either surface. `--app-updated` is part of it because the recorded grant
 * of a `read` workspace cannot show that the app was widened, and without the person's word that it was, the command
 * hands back this first step instead of starting a sign-in that Slack would answer with `read` again.
 */
export function wideningSteps(
  alias: string,
  handoffs: CliHandoffs,
  port?: number,
  appId?: string | undefined,
): string[] {
  const p = portText(port);
  const manifest = handoffs.own(['manifest', '--mode', 'send', '--port', p]);
  const appUpdate = handoffs.own(['app', 'update', alias, '--mode', 'send', '--port', p]);
  const move = handoffs.own(['workspace', 'mode', alias, 'send', '--app-updated', '--port', p]);
  // With no command here, the manifest slack_manifest prints, and the move from a chat.
  const fromChat = 'the send manifest slack_manifest prints';
  return [
    appId
      ? handoffsSentence(
          [manifest, appUpdate],
          ([shown, update]) =>
            `Open ${appManifestUrl(appId)} — the manifest of the app "${alias}" signed in through — replace it with ${shown}, and save: the same app, not a new one. With an app configuration token, ${update} does this at a terminal instead.`,
          `Open ${appManifestUrl(appId)} — the manifest of the app "${alias}" signed in through — replace it with ${fromChat}, and save: the same app, not a new one.`,
        )
      : handoffSentence(
          manifest,
          (shown) =>
            `Open the workspace's existing app at https://api.slack.com/apps → App Manifest, and replace it with ${shown} — the same app, not a new one.`,
          {
            instead: `Open the workspace's existing app at https://api.slack.com/apps → App Manifest, and replace it with ${fromChat} — the same app, not a new one.`,
          },
        ),
    handoffSentence(
      move,
      (shown) =>
        `Then move it: ${shown} at a terminal, or slack_mode_set with appUpdated from a chat. Either asks for the change to be approved first, then for the sign-in to be approved in Slack.`,
      {
        instead:
          'Then move it: slack_mode_set with appUpdated from a chat. It asks for the change to be approved first, then for the sign-in to be approved in Slack.',
      },
    ),
  ];
}

/**
 * `send` → `read`, which this package cannot do by itself.
 *
 * Slack adds scopes to what a person has granted before and never takes one away from a token; revoking a rotating
 * token leaves the installation and its scopes in place; and only `apps.uninstall` resets an installation, with a
 * client secret this package deliberately never stores. So the installation is removed in Slack's own settings, and
 * the workspace signs in again asking for less — as a reauth, which keeps its name, its app and its former names.
 */
export function narrowingSteps(
  alias: string,
  handoffs: CliHandoffs,
  port?: number,
  options: { knowsItsApp?: boolean } = {},
): string[] {
  const p = portText(port);
  const manifest = handoffs.own(['manifest', '--mode', 'read', '--port', p]);
  const remove = handoffs.own(['workspace', 'remove', alias]);
  const add = handoffs.own(['workspace', 'add', alias, '--client-id', "<the app's Client ID>", '--port', p]);
  const reauth = handoffs.own(['workspace', 'reauth', alias, '--mode', 'read', '--port', p]);
  return [
    handoffSentence(
      manifest,
      (shown) =>
        `(Recommended) Open the workspace's existing app at https://api.slack.com/apps → App Manifest, and replace it with ${shown}, so the app itself can no longer offer posting.`,
      {
        instead:
          "(Recommended) Open the workspace's existing app at https://api.slack.com/apps → App Manifest, and replace it with the read manifest slack_manifest prints, so the app itself can no longer offer posting.",
      },
    ),
    'In Slack, remove the app from the workspace: Workspace settings → Manage apps → the app → Remove app. That revokes every token it holds, which is the only way Slack takes a scope back.',
    options.knowsItsApp === false
      ? handoffsSentence(
          [remove, add],
          ([removing, adding]) =>
            `Then ${removing}, and ${adding}. This record predates the one that remembers its app, so it cannot be re-authorised in place.`,
          'Then slack_workspace_remove, and slack_workspace_add with its Client ID, from a chat. This record predates the one that remembers its app, so it cannot be re-authorised in place.',
        )
      : handoffSentence(
          reauth,
          (shown) => `Then: ${shown} — a reauth, which keeps the name, the app and every former name.`,
          {
            instead:
              'Then: slack_workspace_reauth with mode read, from a chat — a reauth, which keeps the name, the app and every former name.',
          },
        ),
  ];
}
