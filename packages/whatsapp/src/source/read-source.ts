import type { DatabaseSync } from 'node:sqlite';
import { has, type SchemaReport } from './schema.ts';
import {
  type ChatKind,
  chatKindOf,
  coreDataToIso,
  kindOf,
  MEDIA_KINDS,
  type MessageKind,
  numeric,
  text,
} from './types.ts';

/**
 * Reading the private copy of the store into plain records.
 *
 * Only ever the copy — `snapshot.ts` made it, and this is handed its database. Every query is a `SELECT` against the
 * tables `schema.ts` checked, and a column the check found missing is read as `NULL` rather than named, so a store
 * without `ZTITLE` (older ones, per IPED) still reads.
 */

export interface SourceChat {
  readonly pk: number;
  readonly jid: string;
  readonly kind: ChatKind;
  /** The chat's display name: a contact's address-book name, or a group's subject — which any member may change. */
  readonly name: string | null;
  readonly lastMessageAt: string | null;
}

export interface SourceMedia {
  readonly mime: string | null;
  readonly size: number | null;
  /** A document's file name or a photo's caption — written by the sender. */
  readonly title: string | null;
  /** The last part of WhatsApp's local path: a name, never the path, so nothing here points into the container. */
  readonly fileName: string | null;
}

export interface SourceMessage {
  readonly pk: number;
  readonly chatPk: number;
  readonly stanzaId: string | null;
  readonly fromMe: boolean;
  readonly at: string | null;
  readonly atSeconds: number | null;
  readonly typeCode: number | null;
  readonly kind: MessageKind;
  readonly viewOnce: boolean;
  readonly groupEvent: number | null;
  readonly body: string | null;
  readonly fromJid: string | null;
  readonly memberJid: string | null;
  readonly memberName: string | null;
  readonly media: SourceMedia | null;
}

function column(report: SchemaReport, alias: string, table: string, name: string): string {
  return has(report, table, name) ? `${alias}.${name}` : 'NULL';
}

export function readChats(db: DatabaseSync): SourceChat[] {
  const rows = db
    .prepare(
      `SELECT Z_PK AS pk, ZCONTACTJID AS jid, ZPARTNERNAME AS name, ZLASTMESSAGEDATE AS last
       FROM ZWACHATSESSION
       WHERE TRIM(COALESCE(ZCONTACTJID, '')) <> ''`,
    )
    .all() as { pk: unknown; jid: unknown; name: unknown; last: unknown }[];
  const chats: SourceChat[] = [];
  for (const row of rows) {
    const pk = numeric(row.pk);
    const jid = text(row.jid)?.trim();
    if (pk === null || !jid) continue;
    chats.push({
      pk,
      jid,
      kind: chatKindOf(jid),
      name: text(row.name),
      lastMessageAt: coreDataToIso(numeric(row.last)),
    });
  }
  return chats;
}

/** The names people chose for themselves, by JID. Empty when the store has no such table. */
export function readPushNames(db: DatabaseSync, report: SchemaReport): Map<string, string> {
  const names = new Map<string, string>();
  if (!has(report, 'ZWAPROFILEPUSHNAME')) return names;
  for (const row of db.prepare('SELECT ZJID AS jid, ZPUSHNAME AS name FROM ZWAPROFILEPUSHNAME').iterate()) {
    const jid = text((row as { jid: unknown }).jid);
    const name = text((row as { name: unknown }).name);
    if (jid && name) names.set(jid, name);
  }
  return names;
}

const MIME = /^[a-z]+\/[a-z0-9][a-z0-9.+-]{0,99}$/i;

/**
 * Whether a message carries media — never merely because it has a `ZWAMEDIAITEM` row.
 *
 * WhatsApp keeps a media item row for far more than media: the same row holds a reply's quoted message in
 * `ZMETADATA` ([K] reads replies from it; [I] counts 1,350 such rows across its test images), and a real store had one
 * on most text messages and on every call, with no media type, no size and no file. So the row's existence says
 * nothing. What the sources treat as media:
 *
 * - [K] exports a media item only `WHERE ZMEDIALOCALPATH IS NOT NULL`, and [I] shows an attachment only when
 *   `ZMEDIALOCALPATH` is set: a row that names a stored file is media, whatever the message's type.
 * - [F] and [W] name the media types (`MEDIA_KINDS`): a photo not yet downloaded has no file, and is a photo all the
 *   same — listed with whatever size and type its row has.
 *
 * A message is media when either holds, and otherwise not: a text message, a call or a location with an empty row
 * shows no media line and is not counted as media.
 */
export function carriesMedia(kind: MessageKind, storedPath: string | null): boolean {
  return MEDIA_KINDS.has(kind) || (storedPath !== null && storedPath.trim() !== '');
}

export function* readMessages(db: DatabaseSync, report: SchemaReport): Generator<SourceMessage> {
  const members = has(report, 'ZWAGROUPMEMBER');
  const media = has(report, 'ZWAMEDIAITEM');
  const memberName = members
    ? `COALESCE(${column(report, 'gm', 'ZWAGROUPMEMBER', 'ZCONTACTNAME')}, ${column(report, 'gm', 'ZWAGROUPMEMBER', 'ZFIRSTNAME')})`
    : 'NULL';
  const sql = `
    SELECT m.Z_PK AS pk, m.ZCHATSESSION AS chat, m.ZSTANZAID AS stanza, m.ZISFROMME AS fromMe,
           m.ZMESSAGEDATE AS at, m.ZMESSAGETYPE AS type, m.ZTEXT AS body, m.ZFROMJID AS fromJid,
           ${column(report, 'm', 'ZWAMESSAGE', 'ZGROUPEVENTTYPE')} AS groupEvent,
           ${members ? 'gm.ZMEMBERJID' : 'NULL'} AS memberJid,
           ${memberName} AS memberName,
           ${column(report, 'mi', 'ZWAMEDIAITEM', 'ZVCARDSTRING')} AS mediaMime,
           ${column(report, 'mi', 'ZWAMEDIAITEM', 'ZFILESIZE')} AS mediaSize,
           ${column(report, 'mi', 'ZWAMEDIAITEM', 'ZTITLE')} AS mediaTitle,
           ${column(report, 'mi', 'ZWAMEDIAITEM', 'ZMEDIALOCALPATH')} AS mediaPath
    FROM ZWAMESSAGE m
    ${members ? 'LEFT JOIN ZWAGROUPMEMBER gm ON gm.Z_PK = m.ZGROUPMEMBER' : ''}
    ${media ? 'LEFT JOIN ZWAMEDIAITEM mi ON mi.ZMESSAGE = m.Z_PK' : ''}
    ORDER BY m.Z_PK`;
  for (const raw of db.prepare(sql).iterate()) {
    const row = raw as Record<string, unknown>;
    const pk = numeric(row.pk);
    const chatPk = numeric(row.chat);
    if (pk === null || chatPk === null) continue;
    const typeCode = numeric(row.type);
    const { kind, viewOnce } = kindOf(typeCode);
    const atSeconds = numeric(row.at);
    const mime = text(row.mediaMime);
    const path = text(row.mediaPath);
    const hasMedia = carriesMedia(kind, path);
    yield {
      pk,
      chatPk,
      stanzaId: text(row.stanza),
      fromMe: numeric(row.fromMe) === 1,
      at: coreDataToIso(atSeconds),
      atSeconds,
      typeCode,
      kind,
      viewOnce,
      groupEvent: numeric(row.groupEvent),
      body: text(row.body),
      fromJid: text(row.fromJid),
      memberJid: text(row.memberJid),
      memberName: text(row.memberName),
      media: hasMedia
        ? {
            // A contact card keeps the vCard itself in this column; only a MIME type is ever passed on.
            mime: kind !== 'contact' && mime !== null && MIME.test(mime) ? mime.toLowerCase() : null,
            size: numeric(row.mediaSize),
            title: text(row.mediaTitle),
            fileName: path === null ? null : (path.split('/').pop() ?? null) || null,
          }
        : null,
    };
  }
}
