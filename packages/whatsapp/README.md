# @agentcomms/whatsapp — a spike, not a release

> **Experimental and unpublished.** `"private": true`. It is not in `scripts/packages.mjs`, the release workflow,
> core's channel table, `capabilities.json` or the plugin manifests, and no skill mentions it. It exists to answer one
> question before anyone decides anything: can an agent read someone's WhatsApp, safely, without WhatsApp ever
> seeing a thing?

`agent-whatsapp` reads the messages **WhatsApp for Mac already keeps on the Mac**, through a private copy, into a
local index. An agent can list chats, read one, and search — and draft a reply, which comes back as a link that opens
WhatsApp with the text filled in. **The person presses send.** The package has no network client, no WhatsApp
session and no way to send anything.

## What it never does

- **Connect to WhatsApp, or to anything.** No socket, no HTTP, no DNS. A test builds the bundle — this package with
  core, commander, zod and the MCP SDK inlined — and checks that no network module is anywhere in its module graph;
  another runs every command and every tool with sockets, DNS, TLS, `fetch` and `WebSocket` cut off.
- **Send, mark as read, react, show you as online or typing.** There is no code that could. `draft` returns a link.
- **Write to WhatsApp's files.** It copies two of them and reads the copy (below). A test checks the WhatsApp folder
  is byte-for-byte and mtime-for-mtime unchanged after a sync.
- **Read anything but the message store.** WhatsApp's folder also holds `Axolotl.sqlite` — the encryption keys that
  make the Mac a linked device — and contacts, settings and media. Only `ChatStorage.sqlite` and its write-ahead log
  are ever opened, by exact name; `--source` refuses any other file name before reading a byte.
- **Download or open media.** Photos, voice notes and documents are listed by type, size and file name only.

## WhatsApp's terms, in plain words

WhatsApp's Terms of Service forbid using its service through unofficial clients and automated means, and WhatsApp
bans numbers it catches doing so — including low-volume, reply-only use. The obvious way to build this — a library
such as Baileys that logs in as a linked device — is exactly that kind of client, and a malicious copy of Baileys
(`lotusbail`, 56,000 downloads, December 2025) stole the sessions of the people who installed it. So this spike does
not do it. It never talks to WhatsApp: it reads a file the official app has already written to the Mac, and nothing
it does reaches WhatsApp's servers. That is a design choice, not legal advice.

## How the real store is opened

WhatsApp for Mac keeps the store at `~/Library/Group Containers/group.net.whatsapp.WhatsApp.shared/ChatStorage.sqlite`,
unencrypted on disk, and holds it open in SQLite's WAL mode while it runs: recent messages sit in
`ChatStorage.sqlite-wal` until the app folds them into the main file.

1. **Copy, don't open.** The store and its log are copied (on APFS, cloned — instant, no extra space) into a private
   folder under core's state directory. The source files are only `lstat`ed and read. Nothing opens them with
   SQLite, takes a lock on them, or touches the app's `-shm` file.
   - SQLite's `mode=ro` was rejected: a read-only connection still takes locks and writes read-marks into the app's
     `-shm` file.
   - `immutable=1` was rejected: it ignores the log, so it misses the newest messages (a test shows it returning none
     of the rows a live writer holds), and it can read torn pages while the app writes.
2. **Consistent, or not at all.** Each source file is fingerprinted (inode, size, nanosecond mtime) before and after
   the copy; if WhatsApp wrote in between, the copy is discarded and taken again, up to five times, then refused.
   SQLite then checks the copy (`quick_check`).
3. **Check the layout before reading.** A missing required table or column refuses the whole sync by name, and the
   previous index is kept as it was. A missing optional part turns off one named feature and is reported.
4. **Index, then delete the copy.** The index is rebuilt in a new file and renamed into place, owner-only (0600 in a
   0700 folder). The copy is deleted whatever happens; one a crash left behind is removed by the next sync.

`chats`, `read` and `search` open only the index, never WhatsApp's files — so they cannot trigger a macOS dialog,
and they keep working, on what was last synced, if WhatsApp is closed, updating or gone.

## Where the schema comes from

Nobody opened a real store to write this — not the owner's, not even for its layout. Every table and column the
reader uses is one that public, open-source readers of `ChatStorage.sqlite` query by name (commits pinned in
`src/source/schema.ts`):

| Source | What it establishes |
|---|---|
| [kenn-io/msgvault](https://github.com/kenn-io/msgvault) `internal/whatsapp/apple.go` | the **macOS** app: `ZWACHATSESSION` (`ZCONTACTJID`, `ZPARTNERNAME`, `ZSESSIONTYPE`, `ZLASTMESSAGEDATE`), `ZWAGROUPMEMBER` (`ZMEMBERJID`, `ZCONTACTNAME`, `ZFIRSTNAME`), `@lid` chats, Core Data seconds since 2001-01-01 |
| [raycast/extensions](https://github.com/raycast/extensions) `extensions/whatsapp/src/services/readLocalDatabase.ts` | the **macOS** path; `ZSESSIONTYPE = 0` for one-to-one chats |
| [KnugiHK/WhatsApp-Chat-Exporter](https://github.com/KnugiHK/WhatsApp-Chat-Exporter) `ios_handler.py` | `ZWAMESSAGE` (`ZISFROMME`, `ZMESSAGEDATE`, `ZTEXT`, `ZMESSAGETYPE`, `ZSTANZAID`, `ZGROUPMEMBER`), `ZWAMEDIAITEM`, `ZWAPROFILEPUSHNAME`; epoch 978307200 |
| [abrignoni/iLEAPP](https://github.com/abrignoni/iLEAPP) `scripts/artifacts/whatsApp.py` | `ZFROMJID`, `ZTOJID`, `ZMEDIAITEM`, `ZGROUPEVENTTYPE`; type 5 is a location |
| [sepinf-inc/IPED](https://github.com/sepinf-inc/IPED) `ExtractorIOS.java` | `ZWAMEDIAITEM.ZFILESIZE`; `ZTITLE` is missing from older stores |
| [ForensicWace](https://github.com/Alessiop01/ForensicWace-ServerEdition) `globalConstants.py`, [wa-explorer](https://github.com/ludufre/wa-explorer) `docs/IOS_STORAGE.md` | the `ZMESSAGETYPE` values; `ZVCARDSTRING` holding a media item's MIME type |

The macOS app is the iOS app built for the Mac, which is why the iOS readers apply; the first two read the Mac file
itself. Facts were taken from these projects, not code. Where the sources say nothing — most `ZMESSAGETYPE` numbers
— the reader reports `unknown:<n>` rather than guess.

**What counts as media.** WhatsApp keeps a `ZWAMEDIAITEM` row for much more than media: a reply's quoted message lives
in it (KnugiHK reads replies from its `ZMETADATA`; iLEAPP counts 1,350 such rows), and the first run against a real
store found one on most text messages and on every call, with no type, no size and no file. So a row alone is not
media. A message is media when its type is one ForensicWace and wa-explorer name as media — a photo not yet downloaded
has no file and is still a photo — or when its row names a stored file (`ZMEDIALOCALPATH`, the test KnugiHK and
iLEAPP use). Anything else — text, a call, a location — shows no media line and is not counted as media. A call is
shown as a call, without a duration: both KnugiHK and iLEAPP read call durations from `CallHistory.sqlite`, a separate
file this reader never opens.

## macOS permission

macOS protects other apps' data. On recent versions (reported for group containers from macOS 15.2), the first
time a process reads WhatsApp's folder macOS asks **"<app> would like to access data from other apps"** — where
`<app>` is the one responsible for the process: the terminal you run `agent-whatsapp` in, or the MCP client that
started the server, not `node`. Until someone answers, the read waits. Older versions may not ask at all, and either
allow the read or refuse it outright; the command reports whichever happened.

- **Allow** fixes it for that app's session. A background MCP server cannot click it, and the answer does not always
  persist for background processes.
- **Full Disk Access** makes it stick: System Settings → Privacy & Security → Full Disk Access, add the terminal (or
  the MCP client), then quit and reopen it.

The package says which: a refusal (`EPERM`) comes back as exit 77 / `AUTH_REQUIRED` with the steps and, when the
environment says which app it is, its name; a dialog nobody answers fails after 12 seconds as exit 75 with "look for
the dialog" instead of hanging; a missing store says WhatsApp for Mac may not be installed.

## Trying it for real

On the Mac with WhatsApp for Mac installed and signed in, from a checkout of this branch:

```bash
pnpm install && pnpm build                                      # builds core, then this package
node packages/whatsapp/dist/cli.mjs add personal/whatsapp      # macOS may ask: choose Allow
node packages/whatsapp/dist/cli.mjs sync --account personal/whatsapp
node packages/whatsapp/dist/cli.mjs status
node packages/whatsapp/dist/cli.mjs chats --account personal/whatsapp
node packages/whatsapp/dist/cli.mjs search "dinner" --account personal/whatsapp
```

If `add` or `sync` exits 77, grant **Full Disk Access to the terminal app** as above and run it again. If `sync`
exits 65, WhatsApp's layout has drifted from what the public readers describe: nothing was indexed, and the message
names what is missing — that is the reader working, and it needs updating before it can be trusted. For WhatsApp
Business, pass `--source ~/Library/Group\ Containers/group.net.whatsapp.WhatsAppSMB.shared/ChatStorage.sqlite`.
`remove personal/whatsapp` deletes the index; WhatsApp's own files are never touched.

## Commands and tools

| Command | MCP tool | What it does |
|---|---|---|
| `add <org/whatsapp> [--source]` | — | a person names the store; the first read, when macOS asks |
| `remove <org/whatsapp>` | — | forget it and delete its index |
| `status [--account] [--no-check]` | `whatsapp_status` | what is set up, whether it can be read, what the index holds |
| `sync --account` | `whatsapp_sync` | copy, check, index, delete the copy |
| `chats --account [--kind] [--limit]` | `whatsapp_chats` | chats, newest first |
| `read <chat> --account [--before] [--limit]` | `whatsapp_read` | one chat, newest first |
| `search <words> --account [--chat] [--sender] [--limit]` | `whatsapp_search` | full-text: text, captions, file names, sender and chat names |
| `draft <to> <text> [--open]` | `whatsapp_draft` | a `whatsapp://send` and a `https://wa.me/` link; the person sends |
| `mcp` | — | the MCP server on stdio |

Each command and its tool call the same function in `src/operations/`; `test/mcp.test.ts` runs both and compares the
results. `add` and `remove` have no tool on purpose: which file an agent may read is a person's choice, and the first
read is when macOS asks that person. `draft --open` is refused to an agent — a filled-in message box landing on the
screen of someone typing elsewhere is one Enter away from sent — so an agent hands over the link. A group has no
number, so its draft comes back as text to paste; so does a chat with someone who hides their number (`@lid`).

Every message body, caption, sender name, group name and file name comes back inside core's untrusted-content
envelope; bidi and zero-width characters are removed and counted (`hidden: { characters, bidi }`); links are
reported by domain with core's flags. Accounts are named `organisation/whatsapp`, checked by core's name grammar.

## What core would need to host a third channel

The spike keeps its accounts in its own file, `whatsapp-spike.json` beside core's `config.json`, because core
hard-codes the two channels it has:

- **`AccountConfig` is Slack-shaped.** `workspace`, `userId`, `tier` and `grantedScopes` are required; none means
  anything for a local store. A channel-neutral record (id, platform, created, plus a per-platform block) is needed,
  in a new config version, with the readers-first rollout the name migration used.
- **`Channel = 'core' | 'gmail' | 'slack'`** and `CHANNEL_SERVERS` in `channel-servers.ts`; the server install and
  pin checks in `operations/servers.ts` (`request.workspace` must be a `slack` account); the core MCP server's tool
  descriptions name Gmail and Slack; `scripts/packages.mjs`, `third-party-licenses.mjs` (its own list of four) and
  `capabilities.json` would each need the package.
- **Name lookups** — `resolveName`, `nameAvailable` and former-name tombstones — work only on core's `Config`, so the
  spike cannot use them for its own file and has no rename or tombstone story.
- **`secrets migrate` and `uninstall --purge`** walk only the references in `config.json`. This spike stores no
  secret, so nothing is stranded — but a channel that did, outside `config.json`, would be left behind by both.
- **Core has no "local store" notion**: state directories are per-inbox JSON; a per-account data directory with an
  index, a sync lock and brief snapshots is new, and `doctor` knows nothing of it.
- `core.secrets()` and the approval engine were not needed at all — worth keeping possible: a channel with no
  credentials and no send path should not have to carry them.

## Risks to accept before pointing it at a real store

| Risk | What would lower it |
|---|---|
| WhatsApp changes the layout; the reader refuses (safe) or, if a column keeps its name and changes its meaning, misreads (unsafe). | Run against the real store once, read-only, and compare a handful of chats by eye; pin the WhatsApp version it was checked against; keep refusing on unknown `ZMESSAGETYPE` values. |
| The index is a second plaintext copy of every message, owner-only on disk. | Encrypt it at rest with a key in core's secret store; index only chosen chats; let `remove` also shred. |
| Full Disk Access is far broader than WhatsApp's folder, and it is granted to the whole terminal or MCP client. | Grant "Allow" per session instead where possible; run the MCP server from a dedicated signed binary and grant only that; revoke when done. |
| An agent sees everything in every chat, including other people's messages sent to the owner. | Allow- or deny-lists of chats in the account config; exclude `status@broadcast` and groups by default. |
| Message content is untrusted and reaches a model. | Already enveloped and defused; the residual risk is a model following instructions anyway — keep the send step with a person, as `draft` does. |
| A draft link could be made to a number the person did not intend. | The person sees the number and text in WhatsApp before sending; `--open` is refused to agents. |
| `node:sqlite` is marked experimental in Node 22 (the warning is filtered). | Pin Node; revisit when it is stable. |
