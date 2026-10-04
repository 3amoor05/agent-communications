import { commandText, escapeForDisplay, paint, shellCommand, truncateDisplay } from '@agentcomms/core';
import type { AddedAccount, RemovedAccount } from '../operations/accounts.ts';
import type { ChatListsResult } from '../operations/chat-lists.ts';
import type { DraftResult } from '../operations/draft.ts';
import type { ChatsResult, ReadResult, SearchResult } from '../operations/read.ts';
import type { StatusResult } from '../operations/status.ts';
import type { SyncResult } from '../operations/sync.ts';
import { innerText, type MessageView, type UntrustedField } from '../present.ts';

/**
 * What a person sees without `--json`. Every contact-controlled string passes core's display escaper on its way to
 * the terminal, so no byte in a message can move the cursor, write the clipboard or reorder a line.
 */

function name(field: UntrustedField | null, fallback: string, width = 32): string {
  const text = innerText(field);
  // The fallback is an id — from WhatsApp's store, so escaped too, whatever the sync let through.
  return text === '' ? escapeForDisplay(fallback) : truncateDisplay(text, width);
}

function size(bytes: number | null): string {
  if (bytes === null) return 'size unknown';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

export function renderAdded(result: AddedAccount, color: boolean): string {
  return [
    `${paint(color, 'green', 'Added')} ${result.account} → ${escapeForDisplay(result.store.path)}${result.store.default ? ' (WhatsApp for Mac)' : ''}`,
    `Next: ${result.next}`,
  ].join('\n');
}

export function renderRemoved(result: RemovedAccount, color: boolean): string {
  return `${paint(color, 'green', 'Removed')} ${result.account}, and its local index. WhatsApp's own store was not touched.`;
}

export function renderStatus(
  result: StatusResult,
  color: boolean,
  platform: NodeJS.Platform = process.platform,
): string {
  const lines: string[] = [];
  if (result.accounts.length === 0) lines.push(`No WhatsApp account yet. ${result.setup ?? ''}`);
  for (const account of result.accounts) {
    lines.push(paint(color, 'bold', account.account));
    lines.push(
      `  store   ${escapeForDisplay(account.store.path)}${account.store.default ? ' (WhatsApp for Mac)' : ''}`,
    );
    const access =
      account.access.state === 'readable'
        ? paint(color, 'green', 'readable')
        : paint(color, account.access.state === 'not-checked' ? 'dim' : 'yellow', account.access.state);
    lines.push(`  access  ${access}${account.access.message ? ` — ${account.access.message}` : ''}`);
    if (account.chatLists.allow > 0 || account.chatLists.deny > 0) {
      lines.push(`  lists   ${account.chatLists.allow} allowed, ${account.chatLists.deny} denied`);
    }
    if (account.access.hint) lines.push(`          ${account.access.hint}`);
    if (account.index.synced) {
      lines.push(
        `  index   ${account.index.chats} chats, ${account.index.messages} messages, ${account.index.media} with media, ${account.index.statusChats} status-update chat(s) · synced ${account.index.indexedAt}`,
      );
      if (account.index.unattributedStatus > 0) {
        lines.push(`          ${unattributed(account.index.unattributedStatus)}`);
      }
      for (const entry of account.index.degraded) {
        lines.push(paint(color, 'dim', `          without ${entry.part}: ${entry.costs}`));
      }
    } else {
      lines.push(
        `  index   not synced yet — ${commandText(
          shellCommand(['agent-whatsapp', 'sync', '--account', account.account], platform),
        )}`,
      );
    }
  }
  lines.push('', paint(color, 'dim', `Reads: ${result.reads}.`), paint(color, 'dim', `Sends: ${result.sends}.`));
  return lines.join('\n');
}

export function renderSync(result: SyncResult, color: boolean): string {
  const lines = [
    `${paint(color, 'green', 'Synced')} ${result.account}: ${result.chats} chats, ${result.messages} messages, ${result.media} with media.`,
    paint(
      color,
      'dim',
      `${result.statusChats} status-update chat(s) are indexed too, and listed or searched only with --kind status.`,
    ),
    paint(
      color,
      'dim',
      `Copied ${result.copied.join(' and ')} (attempt ${result.snapshot.attempts}); the copy is deleted. WhatsApp's files were only read.`,
    ),
  ];
  if (result.unattributedStatus > 0) lines.push(paint(color, 'dim', unattributed(result.unattributedStatus)));
  for (const entry of result.degraded) lines.push(paint(color, 'yellow', `Without ${entry.part}: ${entry.costs}.`));
  return lines.join('\n');
}

/** Status updates the lists hid because nobody could be named as their author. */
function unattributed(count: number): string {
  return `${count} status update(s) hidden: WhatsApp recorded no author for them, and while the lists hide anyone, a post that could be theirs is not shown.`;
}

export function renderChatLists(result: ChatListsResult, color: boolean): string {
  const list = (entries: string[]) => (entries.length === 0 ? paint(color, 'dim', '(none)') : entries.join(', '));
  const chat = result.chat
    ? [
        `  chat   ${name(result.chat.name, result.chat.phone ? `+${result.chat.phone}` : result.chat.id, 60)} · ${result.chat.kind} · ${escapeForDisplay(result.chat.id)}`,
      ]
    : [];
  return [
    `${paint(color, 'green', result.changed ? 'Updated' : 'Unchanged')} ${result.account}. ${result.effect}`,
    ...chat,
    ...(result.warning ? [paint(color, 'yellow', result.warning)] : []),
    `  allow  ${list(result.allow)}`,
    `  deny   ${list(result.deny)}`,
    paint(
      color,
      'dim',
      `Every read and draft applies this now. What is hidden leaves the index, and what the last sync left out comes back, at the next sync: ${result.next}`,
    ),
  ].join('\n');
}

export function renderChats(result: ChatsResult, color: boolean): string {
  const lines = [paint(color, 'bold', `${'CHAT'.padEnd(34)} ${'KIND'.padEnd(13)} ${'MSGS'.padStart(6)}  LAST`)];
  for (const chat of result.chats) {
    lines.push(
      `${name(chat.name, chat.phone ? `+${chat.phone}` : chat.id, 34).padEnd(34)} ${chat.kind.padEnd(13)} ${String(chat.messages).padStart(6)}  ${chat.lastMessageAt ?? ''}`,
    );
    lines.push(paint(color, 'dim', `  ${escapeForDisplay(chat.id)}`));
  }
  if (!result.complete) lines.push('', paint(color, 'dim', 'More chats remain: ask for a larger --limit.'));
  lines.push(paint(color, 'dim', `As of the last sync, ${result.indexedAt}.`));
  return lines.join('\n');
}

function renderMessage(message: MessageView, color: boolean, chatLabel?: string): string {
  const who = message.fromMe ? 'me' : name(message.sender?.name ?? null, message.sender?.jid ?? 'unknown', 28);
  const marks: string[] = [];
  if (message.kind !== 'text' && message.kind !== 'link') marks.push(message.kind);
  if (message.viewOnce) marks.push('view once');
  if (message.hidden.characters > 0) {
    marks.push(
      paint(color, 'yellow', `${message.hidden.characters} hidden character(s)${message.hidden.bidi ? ', bidi' : ''}`),
    );
  }
  if (message.tokensNeutralised > 0)
    marks.push(paint(color, 'yellow', `${message.tokensNeutralised} token(s) defused`));
  for (const link of message.links) {
    if (link.flags.length > 0)
      marks.push(paint(color, 'yellow', `link ${link.domain ?? '?'}: ${link.flags.join(', ')}`));
  }
  const head = [
    chatLabel ? paint(color, 'dim', chatLabel) : null,
    paint(color, 'bold', who),
    paint(color, 'dim', `${message.at ?? '?'} · #${message.id}`),
    marks.length ? marks.join(' · ') : null,
  ]
    .filter(Boolean)
    .join('  ');
  const parts = [head];
  const body = innerText(message.content);
  if (body) parts.push(escapeForDisplay(body).replace(/^/gm, '  '));
  if (message.media) {
    parts.push(
      paint(
        color,
        'dim',
        `  [${message.media.type}${message.media.mime ? ` ${message.media.mime}` : ''}, ${size(message.media.size)}${message.media.name ? `, ${name(message.media.name, '', 60)}` : ''} — not downloaded]`,
      ),
    );
  }
  return parts.join('\n');
}

export function renderHistory(result: ReadResult, color: boolean): string {
  const title = name(result.chat.name, result.chat.phone ? `+${result.chat.phone}` : result.chat.id, 60);
  const lines = [paint(color, 'bold', `${title} · ${result.chat.kind} · newest ${result.messages.length}`), ''];
  if (result.messages.length === 0) lines.push(paint(color, 'dim', 'No messages.'));
  for (const message of result.messages) lines.push(renderMessage(message, color), '');
  if (!result.complete) lines.push(paint(color, 'dim', `Older messages remain: --before ${result.next}`));
  lines.push(paint(color, 'dim', `As of the last sync, ${result.indexedAt}.`));
  return lines.join('\n');
}

export function renderSearch(result: SearchResult, color: boolean): string {
  const lines = [paint(color, 'bold', `${result.results.length} match(es) for ${result.words.join(' ')}`), ''];
  for (const hit of result.results) {
    lines.push(renderMessage(hit.message, color, name(hit.chat.name, hit.chat.id, 30)), '');
  }
  if (!result.complete) lines.push(paint(color, 'dim', 'More matches remain: ask for a larger --limit.'));
  lines.push(paint(color, 'dim', `As of the last sync, ${result.indexedAt}.`));
  return lines.join('\n');
}

export function renderDraft(result: DraftResult, color: boolean, opened: boolean): string {
  const lines = [
    paint(color, 'bold', `Draft to ${result.to.phone ? `+${result.to.phone}` : (result.to.chat ?? '?')}`),
    escapeForDisplay(result.text).replace(/^/gm, '  '),
    '',
  ];
  if (result.links) {
    lines.push(`Open in WhatsApp: ${result.links.app}`, `Or in a browser:  ${result.links.web}`);
    if (opened)
      lines.push(paint(color, 'green', 'Opened WhatsApp with the text filled in. Check it, then press send.'));
  } else {
    lines.push(paint(color, 'yellow', result.reason ?? 'Paste the text into WhatsApp.'));
  }
  lines.push('', paint(color, 'dim', result.note));
  return lines.join('\n');
}
