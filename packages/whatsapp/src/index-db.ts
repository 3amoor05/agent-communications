import { randomBytes } from 'node:crypto';
import { chmod, rename, rm, stat } from 'node:fs/promises';
import { join } from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import { CommsError, DIR_MODE, ensurePrivateDir, FILE_MODE, isGroupOrWorldAccessible } from '@agentcomms/core';
import { CHAT_ID } from './chat-ref.ts';
import { readChats, readMessages, readPushNames } from './source/read-source.ts';
import type { SchemaReport } from './source/schema.ts';
import { type ChatKind, chatKindOf } from './source/types.ts';
import { openDatabase } from './sqlite.ts';
import type { Visibility } from './visibility.ts';

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
 * **It holds message text in the clear**, as WhatsApp's own store does, owner-only (0600 in a 0700 directory) under
 * core's state directory — and re-tightened every time it is opened, so a copy a backup tool or a `chmod` loosened
 * does not stay loose. It is not encrypted, and that is a decision rather than an omission:
 *
 * - Node's SQLite cannot open an encrypted database (no SQLCipher), and cannot load one from memory (no
 *   `deserialize`). Encrypting the file would mean decrypting it to disk for every read — a plaintext copy anyway,
 *   only a fresher one — or encrypting each column, which leaves nothing for full-text search to search.
 * - The key would sit in core's secret store, which every process of this suite, and anything else that runs `node`
 *   as this user, can read (design 2026-09-26 §8). It would stop a stray file copy, not a program running as you.
 * - What the index does lose is the protection WhatsApp's own folder has: macOS asks before an app reads another app's
 *   container, and it does not ask about this file. So the index keeps only what agents may see (the person's lists
 *   leave the rest out), `remove` deletes it, and the README says plainly where it is and what it holds.
 *
 * The person's allow and deny lists (`visibility.ts`) apply twice: a sync leaves what they hide out of the file, and
 * every query applies them again — so a list changed since the last sync takes effect at once.
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
  /**
   * Status updates someone else posted with no author the lists can be checked against, hidden because the lists hide
   * someone (`Visibility.unattributed`). A count, never which: the sync's, left out of the index, and those the index
   * holds that the lists hide now.
   */
  unattributedStatus: number;
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
 * A chat or message the account's lists hide is not written at all.
 *
 * `stillCurrent` is asked once the new index is complete and just before it replaces the old: false — the lists it
 * was built with have changed since — deletes it, replaces nothing, and returns null; a throw does the same, and
 * throws.
 */
export async function rebuildIndex(
  directory: string,
  snapshot: DatabaseSync,
  report: SchemaReport,
  info: { indexedAt: string; copied: readonly string[] },
  visibility: Visibility,
  stillCurrent: () => Promise<boolean> = async () => true,
): Promise<IndexStats | null> {
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
    let malformed = 0;
    for (const chat of chats) {
      // An id is a key everywhere after this, and printed as it is: one not in WhatsApp's own form is left out.
      if (!CHAT_ID.test(chat.jid)) {
        malformed += 1;
        continue;
      }
      if (!visibility.seesChat(chat.jid)) continue;
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
    // By chat, so a count is reported only while its chat may be seen.
    const unattributed: Record<string, number> = {};
    for (const message of readMessages(snapshot, report)) {
      const chat = byPk.get(message.chatPk);
      if (!chat) continue;
      let senderJid: string | null = null;
      let senderName: string | null = null;
      if (!message.fromMe) {
        // A sender id not in WhatsApp's form names nobody: the message is kept, from no one that can be named.
        const memberJid = message.memberJid !== null && CHAT_ID.test(message.memberJid) ? message.memberJid : null;
        const fromJid = message.fromJid !== null && CHAT_ID.test(message.fromJid) ? message.fromJid : null;
        if (memberJid) {
          senderJid = memberJid;
          senderName = message.memberName ?? pushNames.get(memberJid) ?? null;
        } else {
          /*
           * In a one-to-one chat the other person is the chat, and its name is theirs. Anywhere else — a group
           * message with no member row, a status update, a broadcast — the chat's name belongs to the chat, so it
           * is never lent to the sender; and a `ZFROMJID` that is the chat's own id names no person at all.
           */
          const oneToOne = chat.kind === 'direct' || chat.kind === 'hidden-number';
          const from = fromJid && fromJid !== chat.id ? fromJid : null;
          senderJid = from ?? (oneToOne ? chat.id : null);
          const pushed = senderJid ? (pushNames.get(senderJid) ?? null) : null;
          senderName = oneToOne ? (chat.name ?? pushed) : pushed;
        }
      }
      if (!visibility.seesMessage(chat.id, chat.kind, senderJid, message.fromMe)) {
        if (visibility.unattributed(chat.id, chat.kind, senderJid, message.fromMe)) {
          unattributed[chat.id] = (unattributed[chat.id] ?? 0) + 1;
        }
        continue;
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
    if (malformed > 0) {
      degraded.push({
        part: 'well-formed chat ids',
        costs: `${malformed} chat(s) whose id in WhatsApp's store is not in WhatsApp's form were left out, with their messages`,
      });
    }
    const setMeta = db.prepare('INSERT INTO meta (key, value) VALUES (?, ?)');
    setMeta.run('format', String(INDEX_FORMAT));
    setMeta.run('indexedAt', info.indexedAt);
    setMeta.run('degraded', JSON.stringify(degraded));
    setMeta.run('copied', JSON.stringify(info.copied));
    setMeta.run('unattributed', JSON.stringify(unattributed));
    db.exec('COMMIT');
    const statusChats = [...byPk.values()].filter((chat) => chat.kind === 'status').length;
    stats = {
      indexedAt: info.indexedAt,
      chats: byPk.size - statusChats,
      statusChats,
      messages,
      media,
      unattributedStatus: Object.values(unattributed).reduce((sum, n) => sum + n, 0),
      degraded,
      copied: [...info.copied],
    };
  } catch (error) {
    db.close();
    await rm(building, { force: true });
    throw error;
  }
  db.close();
  try {
    if (!(await stillCurrent())) {
      await rm(building, { force: true });
      return null;
    }
  } catch (error) {
    await rm(building, { force: true });
    throw error;
  }
  if (process.platform !== 'win32') await chmod(building, FILE_MODE);
  await rename(building, target);
  return stats;
}

/**
 * The index and its folder back to owner-only when anything loosened them: a plaintext copy of messages is nobody
 * else's to read. POSIX permissions only; on Windows the folder under the user's profile is what keeps it private.
 */
async function keepOwnerOnly(directory: string, path: string): Promise<void> {
  if (process.platform === 'win32') return;
  if (await isGroupOrWorldAccessible(directory)) await chmod(directory, DIR_MODE);
  if (await isGroupOrWorldAccessible(path)) await chmod(path, FILE_MODE);
}

/** An open index, or a refusal that says to sync first. */
export class WhatsAppIndex {
  readonly #db: DatabaseSync;

  private constructor(db: DatabaseSync) {
    this.#db = db;
  }

  /** Every read opens the index through here, and cannot without the account's lists. */
  static async open(directory: string, accountName: string, visibility: Visibility): Promise<WhatsAppIndex> {
    const path = join(directory, INDEX_FILE);
    try {
      await stat(path);
    } catch {
      throw new CommsError('NOT_FOUND', `"${accountName}" has not been synced yet, so there is nothing to read`, {
        hint: `Run \`agent-whatsapp sync --account ${accountName}\` (or the whatsapp_sync tool) first.`,
        details: { reason: 'NOT_SYNCED' },
      });
    }
    await keepOwnerOnly(directory, path);
    // Read-only: a read command never changes the index, and cannot by accident.
    const db = await openDatabase(path, { readOnly: true });
    const format = (db.prepare("SELECT value FROM meta WHERE key = 'format'").get() as { value?: string } | undefined)
      ?.value;
    if (format !== String(INDEX_FORMAT)) {
      db.close();
      throw new CommsError('CONFIG', `the index for "${accountName}" was written by another version of this package`, {
        hint: `Run \`agent-whatsapp sync --account ${accountName}\` to rebuild it.`,
      });
    }
    // The lists, as SQL can ask them: every query below filters with these, so none can forget to.
    db.function('agent_sees_chat', { deterministic: true }, (id) => (visibility.seesChat(String(id)) ? 1 : 0));
    /*
     * A chat's kind, from its id, every time — never the one stored beside it. The id is WhatsApp's and fixed; the
     * stored kind is whatever the version that wrote the index thought, and the spike, under this same format,
     * thought a contact's `<number>@status` posts were `unknown`: listed and searched as conversations.
     */
    db.function('agent_kind', { deterministic: true }, (id) => chatKindOf(String(id)));
    const row = (chatId: unknown, kind: unknown, sender: unknown, fromMe: unknown) =>
      [String(chatId), String(kind), typeof sender === 'string' ? sender : null, Number(fromMe) === 1] as const;
    db.function('agent_sees_message', { deterministic: true }, (chatId, kind, sender, fromMe) =>
      visibility.seesMessage(...row(chatId, kind, sender, fromMe)) ? 1 : 0,
    );
    db.function('agent_unattributed', { deterministic: true }, (chatId, kind, sender, fromMe) =>
      visibility.unattributed(...row(chatId, kind, sender, fromMe)) ? 1 : 0,
    );
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
      chats: count("SELECT COUNT(*) AS n FROM chats WHERE agent_kind(id) <> 'status' AND agent_sees_chat(id)"),
      statusChats: count("SELECT COUNT(*) AS n FROM chats WHERE agent_kind(id) = 'status' AND agent_sees_chat(id)"),
      messages: count(`SELECT COUNT(*) AS n ${MESSAGES_SEEN}`),
      media: count(`SELECT COUNT(*) AS n ${MESSAGES_SEEN} AND m.has_media = 1`),
      unattributedStatus:
        count(
          `SELECT COALESCE(SUM(j.value), 0) AS n
           FROM json_each((SELECT value FROM meta WHERE key = 'unattributed' AND json_valid(value))) j
           WHERE agent_sees_chat(j.key)`,
        ) +
        count(
          `SELECT COUNT(*) AS n FROM messages m JOIN chats c ON c.id = m.chat_id
           WHERE agent_sees_chat(c.id) AND ${UNATTRIBUTED} AND NOT ${SEES_MESSAGE}`,
        ),
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
        `${CHAT_SELECT} WHERE agent_sees_chat(c.id) AND ${KIND} IN (${kinds.map(() => '?').join(', ')})
         ORDER BY c.last_message_at IS NULL, c.last_message_at DESC, c.id LIMIT ?`,
      )
      .all(...kinds, options.limit) as Record<string, unknown>[];
    return rows.map(chatOf);
  }

  /** One chat by its id — or null, as for a chat that does not exist, when the lists hide it. */
  chat(id: string): IndexedChat | null {
    const row = this.#db.prepare(`${CHAT_SELECT} WHERE c.id = ? AND agent_sees_chat(c.id)`).get(id) as
      | Record<string, unknown>
      | undefined;
    return row ? chatOf(row) : null;
  }

  message(id: string): IndexedMessage | null {
    if (!/^\d{1,15}$/.test(id)) return null;
    const row = this.#db.prepare(`${MESSAGE_SELECT} WHERE m.id = ? AND ${SEES_MESSAGE}`).get(Number(id)) as
      | Record<string, unknown>
      | undefined;
    return row ? messageOf(row) : null;
  }

  /** A chat's messages, newest first, strictly older than `before` when it is given. */
  history(chatId: string, options: { limit: number; before?: IndexedMessage | undefined }): IndexedMessage[] {
    const before = options.before;
    const rows = this.#db
      .prepare(
        `${MESSAGE_SELECT} WHERE m.chat_id = ? AND ${SEES_MESSAGE}
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
         WHERE messages_fts MATCH ? AND ${SEES_MESSAGE}
         ${options.chatId ? 'AND m.chat_id = ?' : ''}
         ${kinds ? `AND ${KIND} IN (${kinds.map(() => '?').join(', ')})` : ''}
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

/** Chat `c`'s kind, from its id (see `agent_kind`). */
const KIND = 'agent_kind(c.id)';

/** Whether the account's lists let an agent see `m`, in chat `c`. */
const SEES_MESSAGE = `agent_sees_message(m.chat_id, ${KIND}, m.sender_jid, m.from_me)`;

/** Whether `m` is a status post by someone else whose author is unknown. */
const UNATTRIBUTED = `agent_unattributed(m.chat_id, ${KIND}, m.sender_jid, m.from_me)`;

/** Every message the lists let an agent see, for counting. */
const MESSAGES_SEEN = `FROM messages m JOIN chats c ON c.id = m.chat_id WHERE ${SEES_MESSAGE}`;

/*
 * A chat's message count, as the lists leave it. Counted when read only for status chats — the one kind whose messages
 * the lists can hide one by one, by author — and taken from the sync's count for the rest.
 */
const CHAT_SELECT = `
  SELECT c.id, ${KIND} AS kind, c.name, c.last_message_at,
         CASE WHEN ${KIND} = 'status'
              THEN (SELECT COUNT(*) FROM messages m WHERE m.chat_id = c.id AND ${SEES_MESSAGE})
              ELSE c.message_count END AS message_count
  FROM chats c`;

function chatOf(row: Record<string, unknown>): IndexedChat {
  return {
    id: String(row.id),
    kind: row.kind as ChatKind,
    name: (row.name as string | null) ?? null,
    lastMessageAt: (row.last_message_at as string | null) ?? null,
    messages: Number(row.message_count),
  };
}

const MESSAGE_SELECT = `
  SELECT m.id, m.chat_id, ${KIND} AS chat_kind, c.name AS chat_name, m.stanza_id, m.from_me, m.sender_jid,
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
