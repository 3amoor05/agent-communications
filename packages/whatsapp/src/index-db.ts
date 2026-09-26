import { randomBytes } from 'node:crypto';
import { chmod, rename, rm, stat } from 'node:fs/promises';
import { join } from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import { CommsError, ensurePrivateDir, FILE_MODE } from '@agentcomms/core';
import { readChats, readMessages, readPushNames } from './source/read-source.ts';
import type { SchemaReport } from './source/schema.ts';
import type { ChatKind } from './source/types.ts';
import { openDatabase } from './sqlite.ts';

/**
 * The local index: this package's own SQLite file, which every read command queries.
 *
 * Why an index rather than reading the snapshot on every call: the snapshot is a copy of *everything*, taken by a
 * process that has to be allowed into another app's container, and it may wait on a macOS permission dialog. Reads
 * should do neither. So `sync` is the one step that touches WhatsApp's files; `chats`, `read` and `search` open only
 * this file, and keep working — on what was last synced — when WhatsApp's store is gone or unreadable.
 *
 * SQLite (Node's own) over JSONL because the index needs three things JSONL does not give: full-text search (FTS5,
 * ranked), paging a chat by time without reading the whole file, and an all-or-nothing rebuild. The rebuild writes a
 * new file and renames it over the old, so a sync that fails half-way leaves the previous index exactly as it was.
 *
 * It holds message text in the clear, as WhatsApp's own store does, owner-only (0600 in a 0700 directory) under
 * core's state directory. Encrypting it at rest is on the list of things to do before this is more than a spike.
 */

export const INDEX_FILE = 'index.sqlite';
export const INDEX_FORMAT = 2;

export function accountStateDir(stateDir: string, accountId: string): string {
  return join(stateDir, 'whatsapp', accountId);
}

export interface IndexedChat {
  id: string;
  kind: ChatKind;
  name: string | null;
  lastMessageAt: string | null;
  messages: number;
}

export interface IndexedMessage {
  id: string;
  chatId: string;
  chatKind: ChatKind;
  chatName: string | null;
  stanzaId: string | null;
  fromMe: boolean;
  senderJid: string | null;
  senderName: string | null;
  at: string | null;
  kind: string;
  typeCode: number | null;
  viewOnce: boolean;
  groupEvent: number | null;
  body: string | null;
  media: { mime: string | null; size: number | null; title: string | null; fileName: string | null } | null;
}

export interface IndexStats {
  indexedAt: string;
  /** Conversations: every chat but status updates. */
  chats: number;
  /** Status-update sessions — each contact's posts, and WhatsApp's status feed — which are not conversations. */
  statusChats: number;
  messages: number;
  media: number;
  degraded: { part: string; costs: string }[];
  copied: string[];
}

const SCHEMA = `
  CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
  CREATE TABLE chats (
    id TEXT PRIMARY KEY, source_pk INTEGER NOT NULL, kind TEXT NOT NULL, name TEXT,
    last_message_at TEXT, message_count INTEGER NOT NULL DEFAULT 0
  );
  CREATE TABLE messages (
    id INTEGER PRIMARY KEY, chat_id TEXT NOT NULL, stanza_id TEXT, from_me INTEGER NOT NULL,
    sender_jid TEXT, sender_name TEXT, at TEXT, at_seconds REAL, kind TEXT NOT NULL, type_code INTEGER,
    view_once INTEGER NOT NULL DEFAULT 0, group_event INTEGER, body TEXT,
    has_media INTEGER NOT NULL DEFAULT 0, media_mime TEXT, media_size INTEGER, media_title TEXT, media_name TEXT
  );
  CREATE INDEX messages_by_chat ON messages (chat_id, at_seconds DESC, id DESC);
  CREATE VIRTUAL TABLE messages_fts USING fts5 (body, sender, chat, media, tokenize = 'unicode61 remove_diacritics 2');
`;

/**
 * Builds a fresh index from the snapshot and puts it in place of the old one in a single rename.
 *
 * Streams messages rather than loading them, so a store of a few hundred thousand messages costs one row at a time.
 */
export async function rebuildIndex(
  directory: string,
  snapshot: DatabaseSync,
  report: SchemaReport,
  info: { indexedAt: string; copied: readonly string[] },
): Promise<IndexStats> {
  await ensurePrivateDir(directory);
  const target = join(directory, INDEX_FILE);
  const building = join(directory, `${INDEX_FILE}.building-${randomBytes(4).toString('hex')}`);
  const db = await openDatabase(building);
  let stats: IndexStats;
  try {
    db.exec(SCHEMA);
    db.exec('BEGIN');
    const pushNames = readPushNames(snapshot, report);
    const chats = readChats(snapshot);
    const byPk = new Map<number, { id: string; kind: ChatKind; name: string | null }>();
    const insertChat = db.prepare(
      'INSERT OR IGNORE INTO chats (id, source_pk, kind, name, last_message_at) VALUES (?, ?, ?, ?, ?)',
    );
    for (const chat of chats) {
      // A one-to-one chat with no saved name shows the name the person chose for themselves, as WhatsApp does.
      const name = chat.name ?? (chat.kind === 'group' ? null : (pushNames.get(chat.jid) ?? null));
      insertChat.run(chat.jid, chat.pk, chat.kind, name, chat.lastMessageAt);
      byPk.set(chat.pk, { id: chat.jid, kind: chat.kind, name });
    }
    const insertMessage = db.prepare(
      `INSERT OR IGNORE INTO messages (id, chat_id, stanza_id, from_me, sender_jid, sender_name, at, at_seconds, kind,
         type_code, view_once, group_event, body, has_media, media_mime, media_size, media_title, media_name)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    const insertText = db.prepare('INSERT INTO messages_fts (rowid, body, sender, chat, media) VALUES (?, ?, ?, ?, ?)');
    let messages = 0;
    let media = 0;
    for (const message of readMessages(snapshot, report)) {
      const chat = byPk.get(message.chatPk);
      if (!chat) continue;
      let senderJid: string | null = null;
      let senderName: string | null = null;
      if (!message.fromMe) {
        if (message.memberJid) {
          senderJid = message.memberJid;
          senderName = message.memberName ?? pushNames.get(message.memberJid) ?? null;
        } else {
          /*
           * In a one-to-one chat the other person is the chat, and its name is theirs. Anywhere else — a group
           * message with no member row, a status update, a broadcast — the chat's name belongs to the chat, so it
           * is never lent to the sender; and a `ZFROMJID` that is the chat's own id names no person at all.
           */
          const oneToOne = chat.kind === 'direct' || chat.kind === 'hidden-number';
          const from = message.fromJid && message.fromJid !== chat.id ? message.fromJid : null;
          senderJid = from ?? (oneToOne ? chat.id : null);
          const pushed = senderJid ? (pushNames.get(senderJid) ?? null) : null;
          senderName = oneToOne ? (chat.name ?? pushed) : pushed;
        }
      }
      const result = insertMessage.run(
        message.pk,
        chat.id,
        message.stanzaId,
        message.fromMe ? 1 : 0,
        senderJid,
        senderName,
        message.at,
        message.atSeconds,
        message.kind,
        message.typeCode,
        message.viewOnce ? 1 : 0,
        message.groupEvent,
        message.body,
        message.media ? 1 : 0,
        message.media?.mime ?? null,
        message.media?.size ?? null,
        message.media?.title ?? null,
        message.media?.fileName ?? null,
      );
      if (Number(result.changes) === 0) continue;
      messages += 1;
      if (message.media) media += 1;
      insertText.run(
        message.pk,
        [message.body, message.media?.title].filter(Boolean).join('\n'),
        senderName ?? '',
        chat.name ?? '',
        message.media?.fileName ?? '',
      );
    }
    db.exec('UPDATE chats SET message_count = (SELECT COUNT(*) FROM messages WHERE messages.chat_id = chats.id)');
    const degraded = report.degraded.map((entry) => ({ ...entry }));
    const setMeta = db.prepare('INSERT INTO meta (key, value) VALUES (?, ?)');
    setMeta.run('format', String(INDEX_FORMAT));
    setMeta.run('indexedAt', info.indexedAt);
    setMeta.run('degraded', JSON.stringify(degraded));
    setMeta.run('copied', JSON.stringify(info.copied));
    db.exec('COMMIT');
    const statusChats = [...byPk.values()].filter((chat) => chat.kind === 'status').length;
    stats = {
      indexedAt: info.indexedAt,
      chats: byPk.size - statusChats,
      statusChats,
      messages,
      media,
      degraded,
      copied: [...info.copied],
    };
  } catch (error) {
    db.close();
    await rm(building, { force: true });
    throw error;
  }
  db.close();
  if (process.platform !== 'win32') await chmod(building, FILE_MODE);
  await rename(building, target);
  return stats;
}

/** An open index, or a refusal that says to sync first. */
export class WhatsAppIndex {
  readonly #db: DatabaseSync;

  private constructor(db: DatabaseSync) {
    this.#db = db;
  }

  static async open(directory: string, accountName: string): Promise<WhatsAppIndex> {
    const path = join(directory, INDEX_FILE);
    try {
      await stat(path);
    } catch {
      throw new CommsError('NOT_FOUND', `"${accountName}" has not been synced yet, so there is nothing to read`, {
        hint: `Run \`agent-whatsapp sync --account ${accountName}\` (or the whatsapp_sync tool) first.`,
        details: { reason: 'NOT_SYNCED' },
      });
    }
    // Read-only: a read command never changes the index, and cannot by accident.
    const db = await openDatabase(path, { readOnly: true });
    const format = (db.prepare("SELECT value FROM meta WHERE key = 'format'").get() as { value?: string } | undefined)
      ?.value;
    if (format !== String(INDEX_FORMAT)) {
      db.close();
      throw new CommsError('CONFIG', `the index for "${accountName}" was written by another version of this spike`, {
        hint: `Run \`agent-whatsapp sync --account ${accountName}\` to rebuild it.`,
      });
    }
    return new WhatsAppIndex(db);
  }

  close(): void {
    this.#db.close();
  }

  stats(): IndexStats {
    const meta = new Map(
      (this.#db.prepare('SELECT key, value FROM meta').all() as { key: string; value: string }[]).map((row) => [
        row.key,
        row.value,
      ]),
    );
    const count = (sql: string): number => Number((this.#db.prepare(sql).get() as { n: number | bigint }).n);
    return {
      indexedAt: meta.get('indexedAt') ?? '',
      chats: count("SELECT COUNT(*) AS n FROM chats WHERE kind <> 'status'"),
      statusChats: count("SELECT COUNT(*) AS n FROM chats WHERE kind = 'status'"),
      messages: count('SELECT COUNT(*) AS n FROM messages'),
      media: count('SELECT COUNT(*) AS n FROM messages WHERE has_media = 1'),
      degraded: JSON.parse(meta.get('degraded') ?? '[]'),
      copied: JSON.parse(meta.get('copied') ?? '[]'),
    };
  }

  /** Chats of the given kinds, most recent first. The caller says which kinds: there is no "all" by omission. */
  chats(options: { limit: number; kinds: readonly ChatKind[] }): IndexedChat[] {
    const kinds = options.kinds;
    if (kinds.length === 0) return [];
    const rows = this.#db
      .prepare(
        `SELECT id, kind, name, last_message_at, message_count FROM chats
         WHERE kind IN (${kinds.map(() => '?').join(', ')})
         ORDER BY last_message_at IS NULL, last_message_at DESC, id LIMIT ?`,
      )
      .all(...kinds, options.limit) as Record<string, unknown>[];
    return rows.map((row) => ({
      id: String(row.id),
      kind: row.kind as ChatKind,
      name: (row.name as string | null) ?? null,
      lastMessageAt: (row.last_message_at as string | null) ?? null,
      messages: Number(row.message_count),
    }));
  }

  chat(id: string): IndexedChat | null {
    const row = this.#db
      .prepare('SELECT id, kind, name, last_message_at, message_count FROM chats WHERE id = ?')
      .get(id) as Record<string, unknown> | undefined;
    if (!row) return null;
    return {
      id: String(row.id),
      kind: row.kind as ChatKind,
      name: (row.name as string | null) ?? null,
      lastMessageAt: (row.last_message_at as string | null) ?? null,
      messages: Number(row.message_count),
    };
  }

  message(id: string): IndexedMessage | null {
    if (!/^\d{1,15}$/.test(id)) return null;
    const row = this.#db.prepare(`${MESSAGE_SELECT} WHERE m.id = ?`).get(Number(id)) as
      | Record<string, unknown>
      | undefined;
    return row ? messageOf(row) : null;
  }

  /** A chat's messages, newest first, strictly older than `before` when it is given. */
  history(chatId: string, options: { limit: number; before?: IndexedMessage | undefined }): IndexedMessage[] {
    const before = options.before;
    const rows = this.#db
      .prepare(
        `${MESSAGE_SELECT} WHERE m.chat_id = ?
         ${before ? 'AND (COALESCE(m.at_seconds, 0), m.id) < (?, ?)' : ''}
         ORDER BY COALESCE(m.at_seconds, 0) DESC, m.id DESC LIMIT ?`,
      )
      .all(chatId, ...(before ? [atSecondsOf(this.#db, before.id), Number(before.id)] : []), options.limit) as Record<
      string,
      unknown
    >[];
    return rows.map(messageOf);
  }

  /**
   * Full-text search. `words` are matched as words — each quoted, so nothing typed is ever FTS5 syntax — across the
   * body and caption, the sender's name, the chat's name and a file's name. `kinds`, when given, keeps only chats of
   * those kinds.
   */
  search(
    words: readonly string[],
    options: {
      limit: number;
      chatId?: string | undefined;
      sender?: string | undefined;
      kinds?: readonly ChatKind[] | undefined;
    },
  ): IndexedMessage[] {
    const match = words.map((word) => `"${word.replace(/"/g, '""')}"*`).join(' ');
    const kinds = options.kinds;
    if (kinds && kinds.length === 0) return [];
    const rows = this.#db
      .prepare(
        `${MESSAGE_SELECT}
         JOIN messages_fts f ON f.rowid = m.id
         WHERE messages_fts MATCH ?
         ${options.chatId ? 'AND m.chat_id = ?' : ''}
         ${kinds ? `AND c.kind IN (${kinds.map(() => '?').join(', ')})` : ''}
         ${options.sender ? "AND m.sender_name LIKE ? ESCAPE '\\'" : ''}
         ORDER BY bm25(messages_fts), COALESCE(m.at_seconds, 0) DESC LIMIT ?`,
      )
      .all(
        match,
        ...(options.chatId ? [options.chatId] : []),
        ...(kinds ?? []),
        ...(options.sender ? [`%${options.sender.replace(/[\\%_]/g, (c) => `\\${c}`)}%`] : []),
        options.limit,
      ) as Record<string, unknown>[];
    return rows.map(messageOf);
  }
}

const MESSAGE_SELECT = `
  SELECT m.id, m.chat_id, c.kind AS chat_kind, c.name AS chat_name, m.stanza_id, m.from_me, m.sender_jid,
         m.sender_name, m.at, m.kind, m.type_code, m.view_once, m.group_event, m.body, m.has_media, m.media_mime,
         m.media_size, m.media_title, m.media_name
  FROM messages m JOIN chats c ON c.id = m.chat_id`;

function atSecondsOf(db: DatabaseSync, id: string): number {
  const row = db.prepare('SELECT COALESCE(at_seconds, 0) AS s FROM messages WHERE id = ?').get(Number(id)) as
    | { s: number }
    | undefined;
  return row?.s ?? 0;
}

function nullableNumber(value: unknown): number | null {
  return value === null || value === undefined ? null : Number(value);
}

function messageOf(row: Record<string, unknown>): IndexedMessage {
  return {
    id: String(row.id),
    chatId: String(row.chat_id),
    chatKind: row.chat_kind as ChatKind,
    chatName: (row.chat_name as string | null) ?? null,
    stanzaId: (row.stanza_id as string | null) ?? null,
    fromMe: Number(row.from_me) === 1,
    senderJid: (row.sender_jid as string | null) ?? null,
    senderName: (row.sender_name as string | null) ?? null,
    at: (row.at as string | null) ?? null,
    kind: String(row.kind),
    typeCode: nullableNumber(row.type_code),
    viewOnce: Number(row.view_once) === 1,
    groupEvent: nullableNumber(row.group_event),
    body: (row.body as string | null) ?? null,
    media:
      Number(row.has_media) === 1
        ? {
            mime: (row.media_mime as string | null) ?? null,
            size: nullableNumber(row.media_size),
            title: (row.media_title as string | null) ?? null,
            fileName: (row.media_name as string | null) ?? null,
          }
        : null,
  };
}
