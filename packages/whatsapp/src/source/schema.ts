import type { DatabaseSync } from 'node:sqlite';
import { CommsError } from '@agentcomms/core';

/**
 * The layout of WhatsApp's `ChatStorage.sqlite`, as far as this reader depends on it — and where each part is known
 * from. Nothing here was read off a real store: the owner's own database was never opened, not even for its schema.
 * Every table and column is one that public, open-source readers of this file query by name (commits pinned, so the
 * citation stays checkable):
 *
 * - [K] KnugiHK/WhatsApp-Chat-Exporter @ 9537b4c0, `Whatsapp_Chat_Exporter/ios_handler.py` (MIT): chats, messages,
 *       group members, media items, push names; `APPLE_TIME = 978307200` in `utility.py`.
 * - [I] abrignoni/iLEAPP @ d36b794e, `scripts/artifacts/whatsApp.py` and `whatsAppExtended.py` (MIT): `ZFROMJID`,
 *       `ZTOJID`, `ZMEDIAITEM`, `ZGROUPEVENTTYPE`; type 5 is a location.
 * - [M] kenn-io/msgvault @ ac15d62c, `internal/whatsapp/apple.go` (MIT): the macOS app specifically — `ZSESSIONTYPE`,
 *       `ZLASTMESSAGEDATE`, `ZCONTACTNAME`, `ZFIRSTNAME`, `@lid` chats; Core Data seconds since 2001-01-01.
 * - [R] raycast/extensions @ 9d0b6019, `extensions/whatsapp/src/services/readLocalDatabase.ts` (MIT): the macOS path
 *       under `Group Containers/group.net.whatsapp.WhatsApp.shared`, `ZSESSIONTYPE = 0` for one-to-one chats.
 * - [P] sepinf-inc/IPED @ c37e019f, `iped/parsers/whatsapp/ExtractorIOS.java`: `ZWAMEDIAITEM.ZFILESIZE`, and that
 *       `ZTITLE` is missing from older stores (IPED checks for it) — the reason optional columns exist below.
 * - [F] Alessiop01/ForensicWace-ServerEdition @ d59583ce, `globalConstants.py`: the `ZMESSAGETYPE` values for media,
 *       and `ZVCARDSTRING` holding a media item's MIME type.
 * - [W] ludufre/wa-explorer @ b36d494b, `docs/IOS_STORAGE.md`: the fuller `ZMESSAGETYPE` table.
 *
 * The iOS and macOS apps share this Core Data model (the macOS app is the iOS one, built for the Mac), which is why
 * the iOS readers apply; [M] and [R] are the two that read the Mac file itself.
 *
 * **Drift.** WhatsApp changes this model without notice, so the reader checks before it reads: a missing *required*
 * table or column refuses the whole import by name, rather than guessing what moved; a missing *optional* one turns
 * off the one thing it feeds (sender names, media sizes) and is reported as such.
 */

export const REQUIRED: Readonly<Record<string, readonly string[]>> = Object.freeze({
  // [K][M][R]
  ZWACHATSESSION: ['Z_PK', 'ZCONTACTJID', 'ZPARTNERNAME', 'ZSESSIONTYPE', 'ZLASTMESSAGEDATE'],
  // [K][I][M]
  ZWAMESSAGE: [
    'Z_PK',
    'ZCHATSESSION',
    'ZISFROMME',
    'ZMESSAGEDATE',
    'ZTEXT',
    'ZMESSAGETYPE',
    'ZFROMJID',
    'ZGROUPMEMBER',
    'ZSTANZAID',
  ],
});

/** Tables and columns that improve a result when present, and cost one named feature when absent. */
export const OPTIONAL: Readonly<Record<string, readonly string[]>> = Object.freeze({
  ZWAMESSAGE: ['ZGROUPEVENTTYPE'], // [I]
  ZWAGROUPMEMBER: ['Z_PK', 'ZCHATSESSION', 'ZMEMBERJID', 'ZCONTACTNAME', 'ZFIRSTNAME'], // [K][M]
  ZWAMEDIAITEM: ['ZMESSAGE', 'ZFILESIZE', 'ZTITLE', 'ZMEDIALOCALPATH', 'ZVCARDSTRING'], // [K][P][F]
  ZWAPROFILEPUSHNAME: ['ZJID', 'ZPUSHNAME'], // [K][M]
});

/** The columns without which an optional table is no use at all. */
const KEYS: Readonly<Record<string, readonly string[]>> = Object.freeze({
  ZWAGROUPMEMBER: ['Z_PK', 'ZMEMBERJID'],
  ZWAMEDIAITEM: ['ZMESSAGE'],
  ZWAPROFILEPUSHNAME: ['ZJID', 'ZPUSHNAME'],
});

/** What each optional part is for, said when it is missing. */
const FEATURE: Readonly<Record<string, string>> = Object.freeze({
  'ZWAMESSAGE.ZGROUPEVENTTYPE': 'which kind of group event a system message is',
  ZWAGROUPMEMBER: 'who sent each message in a group',
  'ZWAGROUPMEMBER.ZCONTACTNAME': 'group members’ names from the address book',
  'ZWAGROUPMEMBER.ZFIRSTNAME': 'group members’ first names',
  ZWAMEDIAITEM: 'media: every photo, video, voice note and document is listed without type, size or name',
  'ZWAMEDIAITEM.ZFILESIZE': 'media sizes',
  'ZWAMEDIAITEM.ZTITLE': 'captions and document names',
  'ZWAMEDIAITEM.ZMEDIALOCALPATH': 'media file names',
  'ZWAMEDIAITEM.ZVCARDSTRING': 'media MIME types',
  ZWAPROFILEPUSHNAME: 'the names people chose for themselves, for senders not in the address book',
});

export interface SchemaReport {
  /** Columns present, per table — only for the tables this reader knows. */
  readonly columns: ReadonlyMap<string, ReadonlySet<string>>;
  /** `TABLE` or `TABLE.COLUMN` for each optional part absent, and what that costs. */
  readonly degraded: readonly { part: string; costs: string }[];
}

function columnsOf(db: DatabaseSync, table: string): Set<string> | null {
  const exists = db.prepare("SELECT 1 AS found FROM sqlite_master WHERE type = 'table' AND name = ?").get(table);
  if (!exists) return null;
  // The name is one of ours, from the constants above, never input — so it can be interpolated into the pragma.
  const rows = db.prepare(`PRAGMA table_info("${table}")`).all() as { name: string }[];
  return new Set(rows.map((row) => row.name));
}

/**
 * Checks the store before anything is read from it. Refuses on a missing required part; reports missing optional
 * ones. The refusal names every missing part at once, so one report is enough to fix the reader.
 */
export function inspectSchema(db: DatabaseSync): SchemaReport {
  const columns = new Map<string, Set<string>>();
  const missing: string[] = [];
  for (const [table, required] of Object.entries(REQUIRED)) {
    const present = columnsOf(db, table);
    if (!present) {
      missing.push(table);
      continue;
    }
    columns.set(table, present);
    for (const column of required) if (!present.has(column)) missing.push(`${table}.${column}`);
  }
  if (missing.length > 0) {
    throw new CommsError(
      'BAD_DATA',
      `WhatsApp's message store no longer has the layout this reader knows: ${missing.join(', ')} ${missing.length === 1 ? 'is' : 'are'} missing`,
      {
        hint: 'Nothing was read or indexed. WhatsApp changed its storage; this reader needs updating before it can be trusted with the new layout.',
        details: { reason: 'SCHEMA_DRIFT', missing },
      },
    );
  }
  const degraded: { part: string; costs: string }[] = [];
  for (const [table, optional] of Object.entries(OPTIONAL)) {
    const present = columns.get(table) ?? columnsOf(db, table);
    if (!present) {
      if (!Object.hasOwn(REQUIRED, table)) degraded.push({ part: table, costs: FEATURE[table] ?? table });
      continue;
    }
    columns.set(table, present);
    const absent = optional.filter((column) => !present.has(column));
    // A table whose key columns are gone is as good as absent: report the table, not each column.
    if (absent.some((column) => (KEYS[table] ?? []).includes(column))) {
      columns.delete(table);
      degraded.push({ part: table, costs: FEATURE[table] ?? table });
      continue;
    }
    for (const column of absent) {
      const part = `${table}.${column}`;
      degraded.push({ part, costs: FEATURE[part] ?? part });
    }
  }
  return { columns, degraded };
}

/** True when the report has `table` and, if given, `column` in it. */
export function has(report: SchemaReport, table: string, column?: string): boolean {
  const present = report.columns.get(table);
  return present !== undefined && (column === undefined || present.has(column));
}
