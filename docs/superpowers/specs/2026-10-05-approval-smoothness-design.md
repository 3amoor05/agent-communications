# CUE-404 — approving a send without fighting the clock — design

Status: **revised after round 23 (4 P2, all addressed)**, 2026-10-05, from Linear CUE-404 (High; the
owner: "this is very not smooth") and a cited research pass over this repository, the MCP specification and the
clients' documentation. Depends on CUE-403 (the CLIs on PATH,
[its spec](2026-10-04-cli-path-shims-design.md)) for every printed terminal command to work; ships after it.

## 1. What was asked

Sending one email to an internal colleague from Claude Code in VS Code took four attempts and about twenty minutes:
the update approval expired while it was being read; the send escalated to `confirm` on `recipient-tainted` for a
colleague on the owner's own domain who had written to him; the client was "not on the list" so only a terminal could
approve; the terminal command did not exist (CUE-403); once approved at the terminal, nothing told the agent; four
minutes later the approved record expired unused and the send answered `APPROVAL_REQUIRED`, asking for the approval
just given. The ticket asks for: approved approvals not racing the clock; the agent learning about an approval without
being told; an accurate `APPROVAL_EXPIRED`; no escalation for an own-domain recipient on a domain-only taint match or
for a previously-mailed recipient found by the bounded exact-history check, explained when exact-address taint still
fires; an in-chat approval route for Claude Code; the same for update approvals; and every printed command runnable.

**Acceptance, made exact:** one internal email that triggers `confirm` has one prepare and one person decision. The
terminal approval prints the standard shared preview as the approval ceremony itself; there is no second preview in
the chat. The agent learns that the approval happened by waiting, sends with the same record, and no result asks for
an approval that was already given.

**The outcome, recorded on the ticket 2026-10-05:** the email was never sent. The first approval was approved at the
terminal at 22:48:22 and expired unused at 22:52:46 — ten minutes after it was *created*, four and a half after it was
approved — because the agent did not know it had been approved. The second expired pending. The draft stayed in
Drafts, and the owner, unable to see his approval's state from the chat, ended by asking whether it had gone. Three
acceptance criteria were added: **every send and status call returns the approval's real state** (pending, approved,
expired before or after approval, used and sent with its message id); **the report says only what the approval history
it actually read proves** — one expired approval definitively says “this approval expired; nothing was sent with it”,
while a draft summary is qualified when the history scan is capped or unreadable — and checks the live Gmail Drafts
state rather than guessing; and a proposed short preview when identical content is prepared again. D8 and D9
implement the first two. The short repeat preview is dropped for this release and listed as a departure in §4.

## 2. What is true, and was checked

| Fact | Source |
|---|---|
| Send and change approvals currently live `APPROVAL_TTL_MS` = 10 minutes; download questions (`kind: download`) live 30 minutes from creation. | `packages/core/src/approvals.ts:401-407, 535-562, 823-857, 921-969` |
| Expiry is currently derived for `pending` **and `approved`** records. An ordinary `get` returns the derived record without writing it; a locked transition writes a derived state before deciding the transition. | `packages/core/src/approvals.ts:512-533, 565-588` |
| Under an effective `chat` policy a pending send or change is directly claimable; `confirm` needs an `approved` record first, and a `confirm` change accepts terminal approval only. | `packages/core/src/approvals.ts:725-798, 860-910` |
| Core's current send/change state error maps `expired` to `APPROVAL_EXPIRED`, `revoked` to `APPROVAL_VOID`, and other finished states to `APPROVAL_REQUIRED`. Downloads are different: `expired` is `APPROVAL_EXPIRED`, while `approved`, `used` and other non-revoked states that reach the state error are `APPROVAL_VOID`, not `APPROVAL_REQUIRED`. | `packages/core/src/approvals.ts:591-614` |
| Gmail execute currently turns every state other than `pending`/`approved` into `APPROVAL_VOID` before claiming. Gmail's send form currently leaves both decline and cancel pending; its download form currently revokes both. | `packages/gmail/src/operations/send.ts:569-582`; `packages/gmail/src/mcp/server.ts:1001-1009, 2411-2418` |
| A wrong challenge returns `APPROVAL_REQUIRED` on attempts one and two; attempt three atomically revokes and returns `APPROVAL_VOID`. | `packages/core/src/approvals.ts:682-717` |
| The shipped Gmail skill documents the current inconsistent outcomes, and already tells the agent to cancel a record when the person says no. | `skills/gmail-send/SKILL.md:126-154` |
| Trusted send forms are an empty-by-default list of MCP `clientInfo.name` values. A probe record becomes complete only when `completeProbe` is called; the send test does that directly at lines 144–145, while the later callback at lines 168–172 automatically answers the **send approval form**, not the probe. | `packages/core/src/config.ts:103-108, 420-432`; `packages/gmail/src/operations/confirm-clients.ts:67-95`; `packages/gmail/test/mcp-send.test.ts:138-172` |
| `clientInfo` is self-reported and elicitation defines a client/server exchange, not proof that a person answered. The Gmail server reads the reported client name before trusting a form. Only URL-mode elicitation keeps the person's answer from the client and model. | MCP elicitation specification 2026-07-28; [TypeScript SDK migration note](https://ts.sdk.modelcontextprotocol.io/v2/migration/support-2026-07-28); `packages/gmail/src/mcp/server.ts:2385-2395`; `SECURITY.md:67-68` |
| The taint store is shared across mailboxes. It records canonical addresses and non-public domains from mail read in the last seven days, excluding the reading mailbox's own addresses and current `internalDomains`. An entry aggregates the newest timestamp, the strongest source ever seen (`header` over `body`) and the union of mailbox ids; it does not retain one coherent sighting. | `packages/core/src/taint.ts:260-270, 277-325, 341-349`; `packages/gmail/src/operations/read.ts:243-250` |
| A new mailbox's `internalDomains` defaults to its own non-public domain, and widening it is a gated loosening. With static configuration, an exact internal address can enter the shared taint store only through a mailbox where it is external. An address recorded while external can nevertheless remain effective for the seven-day window after `internalDomains` is widened, because `check()` reapplies the time window but not the recording exclusions. After expiry, `check()` removes it only from that in-memory result; the file removes it physically on the next locked `record()` rewrite. | `packages/core/src/config.ts:1293-1297, 1425-1446`; `packages/core/src/taint.ts:253-264, 296-327, 341-349` |
| Send time currently escalates on `seen.address \|\| seen.domain` unless this mailbox has written to the exact address. The sent-history check currently asks only for five fuzzy `in:sent to:<address>` hits, then comma-splits To/Cc/Bcc header strings and strips display-name wrappers with a regex before exact canonical-address comparison; it is not RFC mailbox-list parsing and does not paginate. | `packages/gmail/src/operations/send.ts:202-221, 240-275` |
| Terminal send approval currently re-renders the shared preview, asks for the challenge, and only approves; it does not send. The shared renderer truncates addresses, subject, attachment filenames, thread and URLs, so this is not proof that every digest-bound byte was displayed. | `packages/gmail/src/cli/program.ts:1345-1356`; `packages/core/src/render.ts:154-192` |
| Approval records currently carry `digestVersion: 1`; every locked transition refuses another version with “prepared by a different version of agent-communications,” after persisting any derived state it observed. | `packages/core/src/approvals.ts:292-306, 570-588` |
| The existing update gate stops a non-exempt tool on an older server after a newer release is known, while deliberately allowing a call that carries a matching `pending` **or `approved` record** this machine already holds; the approval store's digest-version check remains the backstop for that allowed call. | `packages/core/src/update-gate.ts:64-91, 126-154`; `packages/core/src/approvals.ts:570-588` |
| Core stores `sentMessageId` only when the `used` transition is written. Its current `complete()` deliberately accepts both `sending` and `unknown` and moves either to `used` or `failed`. After a provider succeeds, Gmail, Slack and Resend each preserve the successful outward result if that write fails and say the approval will read as `unknown`; none may invent `used`. Gmail currently converts a missing API id to `""`, and Slack does the same for a missing message `ts`, so provider acceptance does not currently guarantee a reportable id. | `packages/core/src/approvals.ts:1068-1075`; `packages/gmail/src/operations/send.ts:691-728`; `packages/slack/src/operations/send.ts:771-775, 883-910, 1114-1133`; `packages/resend/src/operations/send.ts:685-715`; `packages/gmail/src/gmail-api/transport.ts:533-546`; `packages/slack/src/operations/send.ts:771-775` |
| Ambiguous provider responses currently leave the approval in `sending` and return retryable `TRANSIENT` (or preserve another retryable provider code): Gmail and Resend do this for email, and Slack does it for messages, file shares and reactions. | `packages/gmail/src/operations/send.ts:652-688`; `packages/resend/src/operations/send.ts:628-675`; `packages/slack/src/operations/send.ts:753-768, 831-862, 1079-1108, 1349-1384, 1468-1472` |
| A Slack file upload may run for 1,600 seconds at the 100 MiB limit, and one post may contain ten files. A five-minute age by itself therefore does not show that its sending process died. | `packages/slack/src/api/upload.ts:30-41`; `packages/slack/src/compose/files.ts:34-38` |
| Approval records currently have only generic `createdAt`, `expiresAt` and `updatedAt`; stale `sending` is derived from `updatedAt`, so state-specific transition times are not recoverable. | `packages/core/src/approvals.ts:302-330, 512-530` |
| Current change and download claims enter `used` without a state-specific terminal timestamp; they receive only the transition's generic `updatedAt`. | `packages/core/src/approvals.ts:905, 1060` |
| Every successful claim creates `<approvalId>.claim` with `O_EXCL` beside the JSON record; the marker is the cross-process single-use guarantee. | `packages/core/src/approvals.ts:797-813` |
| Recipient analysis separately calls `correspondentDomains`, which lists up to 200 sent messages and reads their metadata before the per-address `hasWrittenTo` checks. Terminal approval runs recipient analysis again. | `packages/gmail/src/operations/send.ts:175-200, 240-265, 471-495` |
| Core's current `list()` reads every approval file sequentially and catches a failed `get()` as `null`, silently omitting that record. | `packages/core/src/approvals.ts:1085-1103` |
| `openCore` constructs one `ApprovalStore`, and each Gmail, Slack and Resend MCP server constructs one context when the server starts. Maintenance tied only to store construction therefore does not recur in a long-lived server. | `packages/core/src/core.ts:29-42`; `packages/gmail/src/mcp/server.ts:200-207`; `packages/slack/src/mcp/server.ts:187-194`; `packages/resend/src/mcp/server.ts:118-121` |
| The audit append API accepts a `durable` option. Its filesystem helper fsyncs the file everywhere; on POSIX it then fsyncs the containing directory and its parent, while on Windows directory sync is skipped and NTFS metadata journaling is relied on. | `packages/core/src/audit.ts:75-85`; `packages/core/src/fs.ts:107-145`, especially `fs.ts:129` |
| The file lock becomes stale after 30 seconds by default and waits up to five seconds by default. Renewal is explicitly opt-in; when enabled, it touches the lock while the callback runs, and the final cleanup removes the lock only if its token is still the holder's. A long maintenance callback therefore has to enable renewal and check ownership before its writes; that separate check is not an atomic commit fence. | `packages/core/src/lock.ts:14-21, 157-164, 219-232` |
| The existing taint store caps retained entries. Its locked `record()` path prunes then rewrites the file, so that is when expired entries are physically removed; `check()` prunes only the in-memory value it returns and does not rewrite the file. | `packages/core/src/taint.ts:253-264, 317-327, 341-349` |
| Gmail draft edits and message organisation already use `APPROVAL_PENDING` with “being sent right now” and “wait for the send to finish” when a send is in flight. | `packages/gmail/src/operations/drafts.ts:561-567`; `packages/gmail/src/operations/organise.ts:128-141` |
| Slack gives every saved draft a revision, binds an approval to that revision as `draftMessageId`, and also binds the composed post digest. | `packages/slack/src/operations/drafts.ts:151-190`; `packages/slack/src/operations/send.ts:446-469, 728-746` |
| The existing list surfaces are core `agentcomms approvals list` / `comms_approvals_list` → `listApprovals`, and Gmail `agent-gmail send list` / `gmail_send_list` → its `listApprovals`. Resend has `send status`, not a list; Slack has `draft list`, not an approval list. | `capabilities.json:29-34, 550-555, 897-902, 1199-1204` |
| The base design treats a hostile process running as the same OS user as out of scope: it can read the tokens and call the providers directly. | `docs/superpowers/specs/2026-09-18-agent-communications-design.md:547-555`; `SECURITY.md:53-59` |
| Some MCP clients move long calls into the background or impose their own time limits, depending on client, version, configuration and call context. This design therefore does not use a client-specific timeout as a protocol rule; skills use repeated short waits. | Product constraint, not a claim about repository code |

## 3. Decisions

### D1. Route-bound lifetimes: chat 10 minutes, confirm 30 minutes, approved 24 hours

- **The route is fixed at creation and stored.** A send's route is the stricter of the live send policy and any risk
  escalation at prepare; a change's route is its live change policy. A `chat` route means this record can be claimed on
  a conversational yes. A `confirm` route means it needs a person outside the chat: the policy was `confirm`, or a send
  was escalated to it. The route never changes when configuration later changes.
- **Pending is route-bound.** A `chat`-route send or change expires ten minutes after creation. A `confirm`-route send
  or change expires thirty minutes after creation. A `confirm`-route pending record is never directly claimable, even
  if the policy later becomes `chat`. A `chat`-route record is directly claimable only while the effective live policy
  is still `chat`; tightening to `confirm` makes that record wait for a terminal approval (or, for a send, a trusted
  form) inside its original ten-minute window. Tightening to `never` still refuses it.
- **Approval starts a new, bounded window.** A send or change approved through its permitted channel stores
  `approvedAt` and `usableUntil = approvedAt + 24 h`. It remains single-use and content-bound: a changed draft,
  account, expected recipients or subject, or a drifted change plan still voids it at claim. Boundary equality is
  expired. It is claimable only while the effective live policy is not `never`; tightening to `never` makes even an
  unexpired approved record non-claimable and claim returns `POLICY_NEVER`.
- **Downloads do not adopt the new approval lifetime.** A download question expires thirty minutes after creation,
  including after it is answered, and has no `usableUntil`; this is the existing model
  (`packages/core/src/approvals.ts:921-1004`).
- **A refusal has one stored meaning.** An explicit form `decline` revokes under the record lock with the exact reason
  `declined`. A cancelled or dismissed form makes no decision and leaves the record pending. A conversational “no” is
  invisible to the server: every send/change skill will tell the agent to call the revoke tool immediately. If it does
  not, a chat-route record can remain claimable only for the same ten-minute window the store uses today
  (`packages/core/src/approvals.ts:401-407, 535-562, 823-857`); that risk is explicit in §7.

**Version and mixed releases.** There is no `lifetimeVersion`. `DIGEST_VERSION` moves from 1 to **2**. The version-2
canonical approval binding is `bindingDigest`, defined exactly once, under **Digest integrity** below; it covers the
content/change digest, the immutable route and lifetime profile and the record's grouping identity. That makes the bump a real change in what an approval authorises, not an advisory field an older binary can ignore.

**Two digests, two jobs.** A version-2 record stores `contentDigest` — the outward content or change identity, computed
exactly as today's message/change digest (`packages/core/src/digest.ts:130`) — and `bindingDigest` (defined under
**Digest integrity**). Claims and approvals check
`bindingDigest`; D9 groups records by each channel's declared `approvalGrouping` (D9) — Gmail and Resend by draft,
Slack by draft, exact revision and `contentDigest` — so a route or lifetime difference never splits one outward post. A legacy record's single `digest` decodes as its
`contentDigest` with no `bindingDigest`; such records are refused for claims by the digest-version gate and are only
ever read for reporting.

**Digest integrity.** Both fields are required on every version-2 record, each a lowercase hex SHA-256 (64
characters). This is the **only** definition: one core helper, `bindingDigestOf(record)`, returns the SHA-256 of the
canonical JSON (the existing `canonicalJson`) of `{ "v": 2, "kind", "contentDigest", "route", "pendingMs",
"approvedMs", "identity" }`, where `identity` is the record's **own top-level operational fields** that ownership and
execution already use — `{ approvalId, inboxId, inboxSub, draftId, draftMessageId, expect }` (`packages/core/src/approvals.ts:302`,
used by claim at `approvals.ts:725` and by Gmail at `packages/gmail/src/operations/send.ts:472`). There is no second
copy: no stored `groupKey`. For a download the object is `{ "v": 2, "kind": "download", "contentDigest", "profile":
{ "pendingMs": 1800000, "policy", "requiredPolicy" }, "identity", "offered", "listing" }` — `policy` and
`requiredPolicy` being the immutable asked-under values stored at creation (`approvals.ts:946`) — `requiredPolicy` is the
one that decides, with the live policy, whether an answer may be relayed through chat (`approvals.ts:204`); `policy` is
descriptive and bound only so it cannot be rewritten — and `listing` the stored listing array in its stored order,
each entry exactly the stored `ListedFile` `{ "name": string, "size": number | null, "renamed"?: RenameReason,
"flags"?: string[] }` with absent optional members omitted; the record's own `listing` is optional
(`approvals.ts:126`), and when it is absent the `listing` key is omitted from the binding object too —, where `offered` is the canonical list of folder meanings and paths
offered when the question was created (today excluded from `downloadDigest`, `approvals.ts:95`), exactly the stored
folders object `{ "downloads": "<absolute path>", "current": "<absolute path>" }` — both always strings, as typed and
written at creation (`approvals.ts:120, 933`) — not the rendered options, canonicalised by `canonicalJson`. The download
binding also covers the exact stored `listing` (each entry's displayed name, size, rename reason and flags — today
excluded from `downloadDigest`, `approvals.ts:150`, though terminal and form approval render it and derive warnings
from it, `save-destination.ts:1260`), and every read on which a `listing` is stored requires `download.names` to equal the listing's names in order (no
comparison when the record has no `listing`);
a mismatch or any altered listing field is `corrupt` before anything is rendered. Every read also requires the stored
`approvalId` to equal the id in the record's file name; a mismatch is `corrupt` before any lock, write or claim marker
touches another id (`approvals.ts:494, 570, 801`). Any stored identity field or offered folder altered after creation therefore fails recomputation, and every
read
recomputes it from the record's own fields before classifying: a missing, malformed, non-canonical or mismatching value
makes the record `corrupt` (never claimable). `contentDigest` is an opaque identity on reads that cannot reach the
provider (status, wait, lists, D9): for **sends** they validate only its encoding and the `bindingDigest` coherence,
because a send's canonical input (addresses, subject, body, attachments — `packages/core/src/digest.ts:139`) is not
stored; change and download records do store their canonical input, so every read recomputes their `contentDigest` too; approve and
claim compare it against the live content, exactly as today. **Confirmation evidence**, version 2, by provenance: a
record reaches `approved` only through the terminal or a trusted form — a chat-route record is claimed straight from
`pending` and never becomes `approved`. Evidence is defined **per kind**, keeping today's persisted literals
(`packages/core/src/approvals.ts:212, 713, 901, 999`):

| Kind | Approved lineage (`approvedAt` set, any later state) | Direct-chat lineage |
|---|---|---|
| send | `approvedVia` ∈ {`terminal`, `elicitation`}; `approvedBindingDigest` = `bindingDigest` | neither field |
| change | `approvedVia` = `terminal` only (confirm changes are terminal-only, `approvals.ts:901`); `approvedBindingDigest` = `bindingDigest` | neither field |
| download | `approvedVia` as today, **no** `approvedAt`, and `approvedDigest` = SHA-256 of canonical `{ bindingDigest, answer }`, binding the recorded answer (`downloads`, `current`, `other` and its path) when it is accepted (`approvals.ts:979`); the save path re-verifies it before writing (`save-destination.ts:864`) | a chat-policy answer claimed straight from `pending` to `used` (`approvals.ts:1017`) carries no `approvedAt`, `approvedVia` or `approvedDigest`, in `used`, `revoked` or `expired` alike; a stored `download.answer` may exist **only** with valid terminal or `elicitation` evidence, so a pending or direct-chat record carrying one is `corrupt` and saves nothing; the chat answer itself is never persisted (`approvals.ts:1060`, `save-destination.ts:903`), so status for a direct-chat `used` download says **`answered` (in chat)** with no destination |

`approvedVia: chat` does not exist; "form" in prose means the stored `elicitation`. Any violation makes the record
`corrupt`. Legacy (version-1) records,
which have no `bindingDigest`, have their stored revision and draft id trusted as stored, and the spec states that limit.
A `bindingDigest` mismatch cannot say which hashed field changed, so the record's attribution fields cannot be trusted:
D9 treats any such record as it treats an unreadable one — the **whole** report is indeterminate (every row says
"indeterminate (an approval record failed its integrity check)"), never a single draft's group. A record whose digest is
merely missing or malformed but whose other fields recompute nothing is treated the same way.

Released 0.13.0 code already refuses any record whose `digestVersion` differs from its own constant, with “the approval
was prepared by a different version of agent-communications” (`packages/core/src/approvals.ts:292-293, 570-588`). An
old binary therefore fails closed on v2, and new code refuses v1, an absent version and every unknown future version by
the same path. Pending records from before the update must be prepared again; an old approved record cannot be claimed
by new code either. The update gate also stops non-exempt calls once it knows a newer release is installed; its
approval-carrying exception admits a locally held `pending` **or `approved` record**, then the digest-version refusal
remains the backstop (`packages/core/src/update-gate.ts:64-91, 126-154`;
`packages/core/src/approvals.ts:570-588`). Because released 0.13.0 derives expiry before checking the version, an
excepted call through old code after the v2 pending deadline may conservatively persist `expired` and then refuse; it
can destroy usability, but cannot send or extend the record
(`packages/core/src/approvals.ts:512-530, 570-588`). Restarting into the installed release avoids that fail-closed
mixed-process casualty.

**Version-2 timestamps fail closed.** Every read validates these exact invariants before classifying the record:

- `createdAt` and `expiresAt` are finite, and `expiresAt` equals `createdAt + 10 min` for a chat route,
  `createdAt + 30 min` for a confirm route, or `createdAt + 30 min` for a download;
- an approved send/change has finite `approvedAt`, with `createdAt <= approvedAt < expiresAt`, and finite
  `usableUntil` exactly 24 hours after `approvedAt`. The strict inequality matters: an approval attempt at
  `approvedAt == expiresAt` observes the boundary as expired and never writes an approved record;
- for an outward send, entering `sending` persists `sendingAt`. A send claimed directly from pending has
  `createdAt <= sendingAt < expiresAt` and no `approvedAt`; one claimed after approval has
  `approvedAt <= sendingAt < usableUntil`. `sendingAt` remains on `used`, `failed` and `unknown`;
- the send claim also creates an opaque random claim token, stores it only in the private `O_EXCL` claim marker and
  returns it only to the internal sender path. It never appears in a public approval, error, audit row or tool/CLI
  result. While provider work is outstanding, that process renews the sending lease every 30 seconds: under the
  record lock it presents the token and writes `sendingHeartbeatAt` only if the same claim still owns a `sending`
  record. A heartbeat is finite and ordered `sendingAt <= sendingHeartbeatAt`; the latest successfully persisted
  value remains on a later `unknown`, `used` or `failed` record. A missed or failed heartbeat does not revive or
  otherwise transition the record;
- entering `used` always persists a finite `usedAt`. For an outward send it also requires a non-empty provider
  `sentMessageId` and persists `sentAt` — the time the provider **accepted** the send, which for a scheduled Resend send
  is not delivery — with `sendingAt <= sentAt` and `usedAt == sentAt`. A change claimed directly
  from pending has `createdAt <= usedAt < expiresAt`; one claimed after approval has
  `approvedAt <= usedAt < usableUntil`. A download has `createdAt <= usedAt < expiresAt`. `usedAt` exists only on a
  `used` record. Entering `failed` persists `failedAt`, with `sendingAt <= failedAt`; `sentAt` exists only on a used
  send, and `failedAt` only on a failed send. Changes and downloads still have no send timestamp or provider id;
- entering `revoked` persists `revokedAt`, with `createdAt <= revokedAt` and, when the record had been approved,
  `approvedAt <= revokedAt`. The locked transition first derives expiry, so `revokedAt` must be before the pending
  or approved deadline that applied; a revoke at the boundary produces `expired` instead;
- only active `pending` and `approved` records derive expiry. A pending record expires at `now >= expiresAt`; an
  approved send/change expires at `now >= usableUntil`, while an answered-but-unused download expires at
  `now >= expiresAt`. An ordinary deadline transition persists `expiredAt` as that derived boundary, not as the later
  observation time. An expired-after-approval send/change retains `approvedAt` and `usableUntil`;
- `unknownAt` is not persisted: it is exactly `(sendingHeartbeatAt ?? sendingAt) + 2 min`. A `sending` record reads
  and is persisted as `unknown` at `now >= unknownAt`; equality is stale. A live claimant normally advances that
  boundary every 30 seconds, so legitimate long provider work stays `sending`. The two-minute lease replaces the
  current five-minute age check (`packages/core/src/approvals.ts:409, 512-530`). Slack needs renewal rather than a
  longer fixed age: one permitted 100 MiB upload can take 1,600 seconds and one post can carry ten files
  (`packages/slack/src/api/upload.ts:30-41`; `packages/slack/src/compose/files.ts:34-38`);
- `unknown` is final for every transition except completion by the process that made the original send claim. Both
  `heartbeat(approvalId, claimToken)` and `complete(approvalId, claimToken, outcome)` validate that token against the
  private claim marker under the record lock. A matching holder may complete `sending` **or `unknown`** to `used` or
  `failed` when the provider result arrives, preserving the current recovery that accepts `unknown`
  (`packages/core/src/approvals.ts:1068-1075`). Before **every provider mutation** (Gmail `sendDraft`, Resend's send,
  and each of Slack's steps — `files.getUploadURLExternal`, each upload, `files.completeUploadExternal`, the post or
  reaction, `packages/slack/src/operations/send.ts:1048`; Gmail's first after the ledger reservation and draft re-read,
  `packages/gmail/src/operations/send.ts:596-652`) the claimant runs a token-checked `fence(approvalId, claimToken)`
  under the record lock: if the record is still `sending` with its token, the heartbeat is refreshed and the step may
  start; if it already reads `unknown`, the claimant starts no further step. If no step had started it completes the
  record `failed` with reason `lease-lost-before-send` (nothing was sent); if earlier Slack steps ran, it completes
  `failed` with the existing "nothing was posted" wording and the uploaded/possibly-uploaded file disclosure. **Stated
  limit:** a fence narrows the window but cannot close it — a claimant suspended after a successful fence and before its
  network call can still start that one step after another caller has persisted `unknown`. That is exactly why
  `unknown` means "may have gone out": the skills never prepare again automatically after it, and the person checks
  Sent or the channel first. A missing or different token cannot complete it; approve, claim,
  revoke, expiry, status, wait, maintenance and every other path leave `unknown` final. Heartbeat never changes
  `unknown` back to `sending`. Late completion clears the stale-lease reason: `used` carries the provider id and no
  failure reason, while `failed` carries the known provider failure;
- `now < createdAt` and, for an active approved record, `now < approvedAt` fail closed as expired. This clock-anomaly
  transition persists `expiredAt` as the observation time and `reason: "clock-anomaly"`; status says that the clock
  moved backwards and the approval was expired safely. It deliberately does **not** pretend that a future normal
  deadline was reached. The timestamp-ordering invariants exempt only an `expired` record with this exact reason:
  its `expiredAt` may precede `createdAt` or `approvedAt`; every other timestamp and state invariant still applies.
  Boundary equality is expired everywhere. The states `used`, `failed`, `revoked` and `expired`, plus `unknown`
  except for its one claim-token completion above, never change because of the observation clock, so a later clock
  rollback cannot turn one into `expired` or revive it;
- state-specific timestamps are finite and appear exactly where that state or its retained history requires them:
  every kind has `usedAt` only on `used`; a used send has `usedAt == sentAt`; sends have `sendingAt` on
  `sending`/`used`/`failed`/`unknown`, optional `sendingHeartbeatAt` only on those same states and never before
  `sendingAt` or after a present `usedAt`/`failedAt`, `sentAt` only on `used`, and `failedAt` only on `failed`, while
  all kinds put `revokedAt` only on `revoked` and `expiredAt` only on `expired`. `reason: "clock-anomaly"`
  appears only on the anomaly expiry above. `approvedAt` and `usableUntil` remain together on every later
  send/change state reached from approval. A contradictory field or any violation of the ordering above, other than
  that single stated anomaly exemption, is corrupt;
- a missing, unknown or non-integer digest version, or a missing, non-finite or inconsistent timestamp, is a distinct
  public integrity state, `corrupt`. It is never claimable, never described as unsent and never silently omitted.
  This includes an on-disk approved record with `approvedAt == expiresAt`: the transition should have expired at that
  boundary, so the impossible stored combination is corrupt. A corrupt classification does not rewrite the raw state.

Expiry is monotonic. Stale-send classification is monotonic for every caller except the original claim holder's
token-authenticated completion: a locked read persists `expired` with `expiredAt`, or `unknown` when a valid active
record crosses its lease boundary; this extends the locked transition's existing write-back rule
(`packages/core/src/approvals.ts:570-588`) to `get`, list, status and wait. A valid `unknown` is returned unchanged by
every other path, while the matching holder may still record the provider's known result as `used` or `failed`. A wait
is therefore read-only except that it may persist one of those derived states.

**Accepted risk:** an approved record can be claimed by any process sharing the store for up to 24 hours. Approvals
are not bound to the preparing process. A hostile same-user process is outside the existing threat model
(`docs/superpowers/specs/2026-09-18-agent-communications-design.md:547-555`; `SECURITY.md:53-59`); inside it, the v2
binding means whoever claims can perform exactly the approved send or change, once. The terminal `approve` still does
not send (`packages/gmail/src/cli/program.ts:1345-1356`): making it send would put a second sending process outside
the server that prepared the draft.

### D2. One locked classification of every record into an outcome

Core exports `approvalOutcome(record, context)`, where `context` is the action (approve, claim, wait, revoke,
inspect), the caller's expected kind and ownership (account/workspace/inbox pin), the stored route, the effective live
policy, whether a send client is trusted, and any challenge. Every surface uses it — Gmail terminal begin/finish,
Gmail execute and both draft rechecks, Gmail MCP routing, Resend, Slack posts/files/reactions, changes, downloads,
lists and waits. Ownership and kind are checked before state or routing. A nonexistent id and an existing id that is
foreign, wrong-kind or pinned away all return the identical `NOT_FOUND` code, message and details, with
`approval: null` and without reading a foreign record far enough to classify or render it.

**Legacy version-1 records, one rule everywhere.** A structurally valid v1 record (no `bindingDigest` by design) is
not `corrupt`: every surface shows it as `{ approvalId, kind, state: <its stored state>, legacy: true, createdAt,
expiresAt }` plus the same untrusted-wrapped summary fields a v2 record shows; ownership is its stored `inboxId`,
trusted as the stated legacy limit (a pinned server shows it only to that owner); it is never claimable (D1's version
gate); D9 reads it only through its isolated legacy decoder; and the v2 missing-`bindingDigest` rules — the
attribution-unverifiable class and D9's whole-report indeterminacy — never apply to it. Only an unreadable or
structurally invalid v1 file takes the unreadable-file path below.

There are two corrupt paths. A parseable, structurally owned record with bad version, state or timestamps reaches
`approvalOutcome` and returns its ordinary safe approval fields plus `state: corrupt`, `claimable: false` and an
integrity reason. Invalid or truncated JSON, missing ownership or kind, and wrong-shaped fields cannot safely reach
that classifier. Version 2 requires explicit ownership and kind even for a send; the only exception is D9's isolated,
read-only decoder for structurally valid legacy v1 send records, where an absent kind meant send
(`packages/core/src/approvals.ts:302-306`). For unreadable files, the store takes `approvalId` only from a filename
that passes the id grammar. Every unpinned approval list, including the core CLI/server and unpinned channel lists,
shows exactly `{ approvalId, state: "corrupt", reason }` and nothing from the file. `reason` is a fixed parser/schema
category and never echoes file bytes. Unpinned zero-wait status and nonzero wait by that id return the same stub. A
pinned server cannot verify ownership and therefore omits the file from lists and returns the same owner-hidden
`NOT_FOUND` as any pinned-away id on status/wait. `doctor` reports the unreadable-record count without contents. Such a
record is never claimable, never included in D9's unsent inference and never rewritten. This replaces the current
catch-and-skip behavior (`packages/core/src/approvals.ts:1085-1103`).

**Two classes of parseable `corrupt` record.** *Attribution verified*: its `bindingDigest` recomputes correctly, so its
owner (`inboxId`) and identity are trustworthy and it is corrupt for another reason (state, timestamps, evidence); it
is shown to its owner like any other record, with `state: "corrupt"` and its safe fields. These two classes apply to
**version-2** records only; a legacy version-1 record has no `bindingDigest` by design and keeps D9's isolated legacy
decoder with its stored attribution trusted (the stated limit), shown in ordinary status and lists as legacy and never
claimable. *Attribution unverifiable* (version 2):
its `bindingDigest` is missing, malformed or mismatched, so its owner cannot be trusted; it is treated exactly as an
unreadable file above — the unpinned stub `{ approvalId, state: "corrupt", reason }`, and on pinned surfaces omission
from lists and the owner-hidden `NOT_FOUND`.

The outcome keeps storage and actionability separate. For sends and changes, `state` is the persisted state (`pending`,
`approved`, `sending`, `used`, `failed`, `unknown`, `expired` or `revoked`), except that an integrity failure is
reported as `corrupt`; `claimable` is a boolean. It is true only for an `approved` send/change before `usableUntil`
while the effective live policy is not `never`, or a pending chat-route send/change while the effective live policy
is still `chat`. `claimable` is never a stored state and a wait does not change the state merely because the record can
be claimed. Downloads retain their public `answered` classification for stored `approved`/`used` records, and their
`claimable` is exactly: **pending** with live change policy `chat` and `requiredPolicy` `chat` → `true` (it can be answered
in chat now); **pending** otherwise → `false` (waiting for the terminal or a form); **answered** at the terminal or in a
form (`approved`) and unexpired → `true` (the save may proceed); **used**, **expired**, **revoked** or **corrupt** →
`false`. A nonzero wait therefore stops at once for a chat-answerable pending question and keeps polling for one that
needs the terminal.

| Record and context | Outcome |
|---|---|
| nonexistent, foreign, wrong-kind or pinned-away id | `NOT_FOUND`, identically; `approval: null`, no record detail |
| parseable, attributable record with an inconsistent state, timestamps or digest version | `state: corrupt`, `claimable: false`; an integrity refusal, never expiry or “unsent” |
| pending send/change, `chat` route, effective live policy still `chat` | `state: pending`, `claimable: true`; a wait returns that immediately |
| pending send, `confirm` route (or a chat route tightened to `confirm`), trusted client | show the form; accepted correct code approves; explicit decline atomically revokes with reason `declined`; cancel/dismiss leaves pending and returns `APPROVAL_PENDING` |
| pending send that needs `confirm`, untrusted client | `APPROVAL_REQUIRED`, with the resolved terminal command and matching wait tool |
| pending `confirm` change | `APPROVAL_PENDING`, with the terminal command and wait tool; changes are terminal-only and never raise a form, as the current claim already enforces (`packages/core/src/approvals.ts:889-903`) |
| wrong code, attempts one or two | record remains pending; `APPROVAL_REQUIRED` |
| wrong code, attempt three | atomically revoked; `APPROVAL_VOID`, “too many wrong codes” (the existing transition has the same boundary at `packages/core/src/approvals.ts:704-716`) |
| approved send/change, before `usableUntil`, live policy not `never` | `state: approved`, `claimable: true` |
| pending or approved send/change, live policy `never` | its real state, `claimable: false`; an execute/claim returns `POLICY_NEVER`; an approved Gmail record says “approved, but the mailbox's policy is now never” |
| expired before approval | `state: expired`, `claimable: false`; `APPROVAL_EXPIRED`: “this approval expired; nothing was sent with it”, followed by prepared at …, expired at … and prepare-again guidance |
| approved, then expired unused | `state: expired`, `claimable: false`; `APPROVAL_EXPIRED`: “this approval expired; nothing was sent with it”, followed by approved at …, expired unused at … and prepare-again guidance |
| expiry forced because the observation clock is before `createdAt` or `approvedAt` | `state: expired`, `claimable: false`; `APPROVAL_EXPIRED`: “the clock moved backwards; this approval was expired safely at …; nothing was sent with it”, with `reason: clock-anomaly` and no false normal-deadline claim |
| provider response leaves this call's outcome uncertain | immediately return non-retryable `SEND_OUTCOME_UNKNOWN` with `approval.state: sending`, `claimable: false`, `sendingAt`, any `sendingHeartbeatAt` and derived `unknownAt`; the send may have happened |
| `sending`, inside its renewed lease, observed by another call | retryable `APPROVAL_PENDING`: “being sent by another call since …; wait for it”; include `sendingAt`, any `sendingHeartbeatAt` and derived `unknownAt`; never “prepare again” |
| `unknown` at or after the sending-lease limit | `SEND_OUTCOME_UNKNOWN`: final to every caller except the original claim token's `used`/`failed` completion; the send may have happened and its claimant may still record a late provider result; check Sent/the channel before doing anything else |
| used send | `APPROVAL_VOID`: already used at `usedAt`, with its non-empty provider message id. `used` means the provider **accepted** the send; the approval record stores nothing more and no transition follows it. Wording: core's generic surfaces say "accepted by <provider> at <time>"; Gmail and Slack, where acceptance is sending, say "sent"; Resend's own surfaces say "accepted by Resend, scheduled for <time>" for a scheduled send (from the request's `scheduledAt`, `packages/resend/src/operations/send.ts:581, 717`) and "cancelled before sending" only when this machine's cancel operation recorded a successful provider cancellation (`packages/resend/src/operations/scheduled.ts:83-111`); a **current outcome** (delivered, bounced, cancelled elsewhere, still scheduled) is reported only from Resend's own `last_event`, read with a full-access key (`send.ts:765`), and otherwise as "current outcome unavailable" — never "sent" inferred from the local `sent` event (written at acceptance, `send.ts:694`) or from the scheduled time having passed. The approval record is never rewritten by cancellation |
| used change | `APPROVAL_VOID`: the approved change was already claimed at `usedAt`; no provider-id or “sent” wording |
| `failed` | `APPROVAL_VOID` with channel-specific truth. Gmail/Resend certain failures say nothing was sent. A Slack file failure says **“nothing was posted”** and preserves `uploaded` and `possiblyUploaded` ids/names because bytes may already have reached Slack (`packages/slack/src/operations/send.ts:1016-1018, 1032-1035, 1088-1111, 1137-1172`) |
| `revoked` | `APPROVAL_VOID` with its reason; an explicit decline is “declined”, while cancellation is not a revoke |
| download pending | `pending` until answered, expired or a wait times out; under `chat` the answer may be relayed, under `confirm` it comes from the terminal or trusted form |
| download `approved` or `used` | `answered`, with the recorded destination choice when the answer came from the terminal or a form; a direct-chat `used` download says `answered (in chat)` with no destination and original creation-relative expiry; never `approved` with a `usableUntil` |
| download `expired` | `expired` / `APPROVAL_EXPIRED`: a question with no recorded answer says it **expired before it was answered**; one answered at the terminal or in a form that then expired unused says it **was answered and expired before it was used** (no answer time is stored, so none is reported); current download state handling is separate already (`packages/core/src/approvals.ts:591-607, 972-1004`) |

`SEND_OUTCOME_UNKNOWN` is added to the one registry with exit **10**, `retryable: false`, and summary **“the send
outcome is unknown; check before sending again”**. Exit 10 is the existing approval/send-refusal class, while the
distinct code prevents consumers from following `APPROVAL_VOID`'s global “prepare again” summary
(`packages/core/src/errors.ts:6-24, 58-115`). The current Gmail, Resend and Slack ambiguous paths cited in §2 switch
to this code as soon as they know the response is uncertain. A later caller that sees the still-fresh `sending`
record gets the state-specific `APPROVAL_PENDING` result above, consistent with the existing edit/organise guard's
“being sent right now; wait” behavior (`packages/gmail/src/operations/drafts.ts:561-567`;
`packages/gmail/src/operations/organise.ts:128-141`). `unknown` has no public reconciliation command and is final to
every path except the original claimant's token-authenticated `used`/`failed` completion. Skills and machine consumers
**must not prepare again while the record is `sending`**; they wait until `used`, `failed` or `unknown`. After
`unknown`, they first tell the person that the claimant may still record a late provider result, check Sent or the
Slack channel, and prepare again only after they establish that the outward action did not happen. No skill or machine
consumer prepares automatically.

The classifier runs **inside each locked transition**. Approve, claim, revoke and form resolution read, derive,
validate, classify and write beneath the same record lock. Inspect/status/wait use the same locked read so that expiry
write-back is atomic. There is no pre-lock state classification that a concurrent claim can contradict.

### D3. Waiting for an approval: short, bounded and on every surface

`waitForApproval(approvalId, { waitSeconds, signal, owner })` never claims, revokes or executes. It checks ownership
and kind first and polls one small approval file at most once a second through D2's locked read. `waitSeconds` defaults
to 30, has a maximum of **300**, and `0` is status now and always returns the current classified outcome. For a
nonzero wait it keeps polling while the outcome is `pending` and not claimable, **and while it is `sending`**. A fresh
`sending` record is an in-progress action, not a terminal refusal: the wait continues until the record becomes `used`,
`failed` or `unknown`. It otherwise stops on the first claimable, non-sending terminal or expired outcome, on an
approved record made non-claimable by live policy, caller cancellation or timeout. It never polls beyond the record's
pending/usable deadline or a sending record's current derived `unknownAt`, which moves forward after every persisted
heartbeat. A pending, directly claimable chat-route send/change returns immediately as
`{ state: "pending", claimable: true }`; a terminal approval ends the wait as
`{ state: "approved", claimable: true, usableUntil }`. The persisted state stays `approved`. A download returns
`state: answered` when approved/used and `state: expired` when expired, with no `usableUntil`.

The result carries `state` plus `claimable`; its states are `pending`, `approved`, `sending`, `expired`, `revoked`,
`used`, `failed`, `unknown`, `corrupt`, `answered` (downloads) and, when it can be delivered, `cancelled` (the wait,
not the approval, with `claimable: false`). A nonexistent, foreign, wrong-kind or pinned-away id is D2's `NOT_FOUND`
error with `approval: null`, not another state. A timeout is `state: pending` with the same id and the correct
`claimable` value when it was waiting for approval, or the current `state: sending` with `sendingAt`, any
`sendingHeartbeatAt` and `unknownAt` when it was waiting for an in-flight send. Neither timeout carries prepare-again
guidance. Progress is sent every 15 seconds only when the caller supplied a progress token.

At most **8 waits per server or CLI process** run at once; a ninth gets `TRANSIENT` “too many waits”. This bounds one
process's resources, not all processes sharing the store: each slot costs one small file read per second. Every exit
path — success, timeout, cancellation, exception and client disconnect — releases its slot in `finally`. Cancellation
guarantees only that the waiter is released and the record is untouched apart from expiry or stale-send finalisation
that the final locked read observed and persisted. Delivery of a `cancelled` result to a client that disconnected is
best effort.

The implementation adds these exact `capabilities.json` rows; each pair calls the listed operation, and the parity
test exercises the row in both directions (`capabilities.json:1-2`):

| Capability row | Command | Tool | Operation |
|---|---|---|---|
| `core.approval.wait` | `agentcomms approval wait <id>` | `comms_approval_wait` | `waitForApproval` |
| `gmail.send.wait` | `agent-gmail send wait <id>` | `gmail_send_wait` | `waitForApproval` |
| `resend.send.wait` | `agent-resend send wait <id>` | `resend_send_wait` | `waitForApproval` |
| `slack.approval.wait` | `agent-slack approval wait <id>` | `slack_approval_wait` | `waitForApproval` |

For any approval kind, **status is this pair with `waitSeconds: 0`** (CLI: `--wait-seconds 0`); there is no separate
status operation. Every refusal that sends a person to a terminal names the matching command and wait tool. Because
clients may background or limit long calls, the skills recommend repeated default-length waits rather than one
maximum-length call.

### D4. `recipient-tainted`: exact still escalates, own-domain alone does not, and the explanation is honest

The attack this flag stops is an instruction hidden in mail that names an address to send something to. The decision
becomes:

```
tainted = (seen.address || (seen.domain && external)) && !hasWrittenTo(exact address)
```

that is:

- an **exact address** already in the store escalates, internal or external, unless the sending mailbox has written to
  it. At a fixed configuration an internal address can have entered only through a mailbox where it was external
  (`packages/core/src/taint.ts:277-305`; `packages/gmail/src/operations/read.ts:243-250`);
- a **domain-only** match escalates only when the recipient is external to the sending mailbox. The sending mailbox's
  own `internalDomains` do not escalate on a domain match.

The ticket's “no escalation for internal recipients on taint alone” is met for domain-only matches and deliberately
not for an exact stored address. That narrower departure is listed in §4.

**Saying why without trusting sender text.** The explanation describes each stored aggregate separately:

- “seen in mail read in these mailboxes within the last seven days” — the union of mailbox ids;
- “most recently on `<date>`” — the entry's latest timestamp;
- “seen at least once in a header” only when its strongest stored source is `header`.

It never says those facts came from one message or one sighting: `touch()` unions ids, retains `header` forever once
seen, and replaces the timestamp independently (`packages/core/src/taint.ts:307-313`). Mailbox ids are software data;
a removed one is “a mailbox no longer connected”. The displayed address and domain are sender-controlled. They are
strictly IDNA/case canonicalised, returned as structured untrusted fields, and never interpolated as trusted prose.
The address goes through the existing `addressField`; the domain gets a sibling strict `domainField` with the same
wrap-on-grammar-failure rule (`packages/gmail/src/domain/untrusted-fields.ts:39-42, 60-63`). Subject, display name,
sender and message id are not added.

**Previously mailed means exactly checked within both bounds.** `hasWrittenTo` uses
`in:sent {to:<canonical-address> cc:<canonical-address> bcc:<canonical-address>}` and paginates until it has checked
50 hits or Gmail has no next page. Each hit still has its To/Cc/Bcc header strings comma-split and display-name
wrappers regex-stripped before exact canonical-address comparison because Gmail search is fuzzy; this is deliberately
not described as RFC address parsing (`packages/gmail/src/operations/send.ts:209-221`). This replaces the current
five-hit, unpaginated check.

The per-address `hasWrittenTo` work in one recipient-analysis operation has **one budget of 200 Gmail history
requests across all recipients**, not 200 per recipient. The budget includes both kinds of provider work: every
`listMessages` search/page call and every `getMessageMetadata` read consumes one unit before it starts. Cached answers
cost no budget. Pagination and recipients proceed in deterministic To/Cc/Bcc canonical-address order, and no 201st
history request is started. If the budget runs out before either kind of call, the current recipient and every
still-unchecked recipient are conservatively `not written` with `historyCheck: budget-exhausted`; their taint
escalation remains and the preview says **“prior-send history was not fully checked (the 200-read budget was reached);
treated as not previously written.”** A search/list or metadata provider error similarly yields
`historyCheck: provider-error`, keeps the escalation and says **“prior-send history could not be checked; treated as
not previously written.”** It does not turn provider doubt into a correspondence exemption.

Those per-address results are cached for ten minutes by `(immutable mailbox id, canonical address)` in shared state,
under the same cross-process locking and atomic-write rules as other runtime state. The value includes `written`,
`not-written`, `budget-exhausted` or `provider-error`, its observation time and expiry; no sender-controlled prose is
stored. Prepare populates it, so the separate terminal-approval process reuses the same answers while they are fresh
instead of repeating either searches or metadata reads. Each operation still owns a 200-request budget for cache
misses; for an unchanged draft, prepare followed by terminal approval within the cache window therefore starts at
most 200 `hasWrittenTo` history requests in total. At ten minutes a cache entry is stale at equality and the next
operation may check again.

This per-address cache is capped at **5,000 entries per state directory**. Every locked mutation first discards all
entries whose expiry is at or before the current time, applies the current observations, then evicts the oldest
remaining observations (observation time, with the canonical key as the stable tie-breaker) until at most 5,000 remain
before the atomic write. A malformed file is read as an empty cache and is replaced only by a valid locked write; for
that operation its affected history answers are conservatively `not-written` with `historyCheck: cache-malformed`,
never `written`, so corruption cannot suppress escalation. If an atomic write reports failure, the operation does not
use an observation that it could not commit to suppress escalation; it reports `cache-write-failed` and treats the
affected address as not written. A following process must see either the complete old file or the complete new file,
never a partial cache.

The correspondent-domain scan used for lookalikes is separate from that budget and keeps its existing cap: one
`listMessages({ query: "in:sent", maxResults: 200 })` call and metadata reads for at most those 200 messages
(`packages/gmail/src/operations/send.ts:175-200, 240-252`). Its domain set, observation time and expiry get a distinct
shared cache keyed only by immutable mailbox id, with the same cross-process lock, atomic write and ten-minute
stale-at-equality rule. Prepare populates it and terminal approval reuses it, so there is at most one 201-call
correspondent scan across those two passes while the entry is fresh. The current best-effort provider-error behavior,
the addition of the mailbox's own and internal domains, and lookalike escalation are unchanged. Therefore a prepare
and terminal approval of one unchanged draft can make at most 401 combined `listMessages` and
`getMessageMetadata` calls for these two history checks: at most 200 for all `hasWrittenTo` work plus at most 201 for
the one correspondent-domain scan. The 500-recipient test counts every one of those calls across both passes rather
than counting metadata alone, and proves a lookalike found through the cached domain set still escalates.

The correspondent-domain cache is independently capped at **5,000 mailbox entries per state directory** and uses the
same locked-write order: remove expired entries first, apply the current observation, then evict the oldest by
observation time and immutable mailbox id until the file is at the cap. A malformed file reads as empty and forces a
fresh correspondent scan rather than treating an empty domain set as authoritative. If that recovery scan fails, the
result carries `correspondentHistory: cache-malformed` and conservatively keeps the confirm escalation instead of
silently concluding that there is no lookalike. A reported atomic-write failure similarly yields
`correspondentHistory: cache-write-failed` and keeps the confirm escalation; the next reader sees either the complete
old cache or the complete new one. Thus malformed state or a failed write in either cache never suppresses escalation.

The 50-hit cap deliberately accepts one false negative: if 50 fuzzy hits contain no exact address and the exact hit
would be 51st, the result is `not-written` and the send keeps the warning. That is conservative; provider errors,
the operation-wide budget, exhaustion at 50 or no exact hit never suppress escalation.

Two limits remain explicit. First, an internal address read in the sending mailbox is discarded before it reaches the
store (`packages/core/src/taint.ts:296-305`), so a compromised colleague who writes only to that mailbox leaves no
exact-address tripwire. That protection is narrower than previously claimed and is pre-existing, not weakened here.
Second, an address recorded while external remains effective until the seven-day cutoff even if an approved config
change later adds its domain to `internalDomains`. At and after the cutoff, `check()` excludes it from its in-memory
result; the expired entry is removed physically only by the next locked `record()` rewrite
(`packages/core/src/taint.ts:253-264, 317-327, 341-349`). During that transition the exact stored address can still
escalate; the explanation says why.

### D5. The confirmation route: one decision, and honest about where it happens

- No MCP mechanism proves a person answered a form, so no client becomes “known to reach a person”. The existing list
  is described as clients **the person chose to trust**, and the probe proves only that the client can return a form
  answer. It is mentioned only when the person asks about trusting a client
  (`packages/core/src/config.ts:103-108, 420-432`; `skills/gmail-send/SKILL.md:165-186`).
- An untrusted client's refusal is complete: “this needs your approval outside the chat: run `<resolved terminal
  command>` in a terminal, and I will wait with `<wait tool>`.” CUE-403 makes the command runnable; D3 lets the agent
  learn the result without asking the person to relay it.
- The terminal approval prints the standard shared preview once and asks for the challenge: that rendering **is the
  approval**, not a second chat preview. It includes the body but truncates addresses, subject, attachment filenames,
  thread and URLs at the renderer's fixed limits (`packages/core/src/render.ts:154-192`). The current terminal already
  renders and then approves without sending (`packages/gmail/src/cli/program.ts:1345-1356`). The agent does not prepare
  again or show the preview again in chat.
- Therefore the acceptance is exactly: **one prepare; one person decision; no second chat preview; the agent learns of
  approval by waiting; and no error asks for an approval already given.** A test counts all renderings and decisions
  rather than pretending the terminal did not show the content.
- A fresh, untrusted Claude Code still has no in-chat confirmation in this release. URL-mode elicitation to an
  authenticated local page is the safe future route (§4 and §6). `requiresUserInteraction` remains policy-derived as
  it is now (`packages/gmail/src/mcp/server.ts:2366-2374`).

### D6. Update and change approvals

Changes use D1's stored route: ten minutes pending on `chat`, thirty on `confirm`, and 24 hours after terminal
approval. They use D2's outcomes and D3's `agentcomms approval wait` / `comms_approval_wait`. `confirm` changes remain
terminal-only; no change form is added.

### D7. Printed commands

Every command these messages print goes through CUE-403's terminal-command locator and `shellCommand`. This release
requires 0.13.1 (CUE-403).

### D8. Every send and status call says where the approval stands

Core stores `sentMessageId` only when its `used` transition succeeds
(`packages/core/src/approvals.ts:1068-1075`). This design makes the stored truth consistently visible without
inventing a state:

- Every send-path result — success and refusal, on every surface D2 lists — has nullable
  `approval: { id, state, claimable, route, … }`. `pending` has `expiresAt` and the next step; `approved` has
  `approvedAt` and `usableUntil`; `sending` has `sendingAt`, any `sendingHeartbeatAt` and derived `unknownAt`;
  `expired` has persisted `expiredAt` and `approvedAt` when approval happened first; `used` has `sendingAt`, `sentAt`
  and a non-empty
  `sentMessageId`, with `usedAt == sentAt`; a used change or download has `usedAt`; `failed` has `sendingAt` and
  `failedAt`; `unknown` has `sendingAt`, any `sendingHeartbeatAt` and derived `unknownAt`; and `revoked` has
  `revokedAt`. A `used` or `failed` send also retains any last `sendingHeartbeatAt`. These states carry
  their honest reasons. `corrupt` carries an integrity reason and is never claimable. A download uses `pending`,
  `answered`, `expired`, `revoked` and `corrupt`, with no `usableUntil`.
- `approval` is null (or omitted on a surface whose schema omits nulls) for `NOT_FOUND` and every failure before an
  approval exists: `POLICY_NEVER` at prepare, invalid recipients, unsendable HTML and equivalent validation failures.
  A claim refused because a live policy became `never` carries the existing record's real, non-claimable approval
  object. The `NOT_FOUND` path does not inspect, classify or leak a foreign, wrong-kind or pinned-away record.
- A successful provider call with a non-empty provider id may say “sent, message id …”, but `state: used` appears only
  after the used write succeeds. If that bookkeeping write fails, the success result reports the gap and the provider
  id; the record remains `sending` and later reads `unknown`, never fabricated `used`. Gmail, Slack and Resend already
  preserve provider success across this failure in exactly that direction
  (`packages/gmail/src/operations/send.ts:691-728`; `packages/slack/src/operations/send.ts:883-910`;
  `packages/resend/src/operations/send.ts:685-715`).
- **A Resend cancellation that the provider confirmed stays a success.** After Resend cancels a scheduled send
  (`packages/resend/src/operations/scheduled.ts:83`), the send-record append and the audit append (`scheduled.ts:104,
  111`) are attempted independently; a failure of either is reported as a bookkeeping gap in the hint of a successful
  result, never as a failed cancellation — the 0.12.3 no-send bookkeeping pattern.
- A provider success response with no non-empty id is reported exactly as **“sent; the provider returned no id”** —
  or, for a Resend request carrying a schedule (`packages/resend/src/operations/send.ts:616`), **“accepted (scheduled);
  the provider returned no id”** —
  never `used` and never “sent, message id …”. The record remains `sending` and becomes `unknown` at its lease
  boundary. This closes the current empty-string paths in Gmail and Slack
  (`packages/gmail/src/gmail-api/transport.ts:533-546`; `packages/slack/src/operations/send.ts:771-775`). `undefined`,
  `null`, `""` and a provider value rejected as empty are represented as **absence**, never as an empty string. No
  completion record, approval transition, audit `ids` field or provider readback call receives an empty provider id.
  The no-id path writes an audit outcome that says the provider accepted without an id and omits that id field; it
  also skips every readback that would require the id. A non-empty id is validated before the `used` transition,
  durable audit data or readback arguments are built.
- Every sender-controlled string in an approval, status or list object is enveloped. Channel surfaces use the
  channel's untrusted-field helpers; **core's own surfaces** (the core approvals list, status and wait, which must not
  import channel packages — cite the channel-plugins design) apply core's channel-neutral `wrapUntrusted`
  (`packages/core/src/untrusted.ts:108-120`) to every string field of a record's public view that a sender could
  control (subjects, addresses, display names, file names, previews), identified by a fixed core list of field paths
  that covers removed-account and legacy records too. In Gmail that means `wrapField` for prose, `addressField` for strict addresses and `filenameField` for attachment
  names; escaping or truncation alone is not enough (`packages/gmail/src/domain/untrusted-fields.ts:3-15, 39-62`).
- **Status at any time** is the matching D3 wait pair with `waitSeconds: 0`; it returns the same approval object and
  never calls a provider. The existing Resend `send status` remains its send-record lookup, not the approval-status
  contract; it may ask Resend when resolving an unknown or scheduled send
  (`capabilities.json:897-902`; `packages/resend/src/operations/send.ts:744-827`).
- **List surfaces are explicit.** Gmail `agent-gmail send list` / `gmail_send_list` → `listApprovals` gains the approval objects
  and D9's `unsent` section (`capabilities.json:550-555`). Every approval kind remains visible through the existing
  core `agentcomms approvals list` / `comms_approvals_list` → `listApprovals`
  (`capabilities.json:29-34`). There is no new Resend or Slack approval-list command or tool.
- Skills call status or wait before saying anything about a send they did not just complete. They never report `used`
  or “sent, message id …” without a non-empty provider id; the only no-id success wordings are “sent; the provider
  returned no id” and, for a scheduled Resend send, “accepted (scheduled); the provider returned no id”; and they never
  call a scheduled Resend send sent unless Resend's own current outcome says delivered. They never turn `SEND_OUTCOME_UNKNOWN` into an automatic new preparation, tell the person to check
  Sent/the channel first, and surface `corrupt` instead of treating it as absent.

### D9. Draft send history says only what the records read can prove

**Grouping comes from the channel's manifest, as data.** Each channel declares `approvalGrouping` in its `"agentcomms"`
manifest field: `"draft"` — group by `(inboxId, draftId)`, used by Gmail and by Resend's prepared sends — or
`"draft-revision-digest"` — group by `(inboxId, draftId, draftMessageId, contentDigest)`, used by Slack posts and files.
Reactions and channels without the field take no part in D9. Core applies the declared rule to the generic fields it
already stores, so a new channel chooses a rule without any core edit; the manifest schema and the generated snapshot
gain the field (`packages/core/src/channel-manifest.ts`). Gmail grouping never includes `contentDigest`: every approval
for the same mailbox and draft counts, however the draft's content changed between preparations.

The status of **one identified approval** is definitive about that approval. An expired record says **“this approval
expired; nothing was sent with it”**, whether it expired pending or after approval. A `failed` record says the
channel-specific equivalent only when the provider failure is known not to have sent. A `used` record says the provider
accepted it, with its non-empty provider id, in the channel wording above (Gmail and Slack "sent"). None of those record-local facts claims what a different approval, another client or
the provider did.

A Gmail draft becomes a candidate row when the scan below finds at least one send approval from the last seven days
for the same mailbox and draft and the newest relevant record is `expired`. The group is then classified using **all
matching records that the scan read**, not only the newest one:

- any `sending`, `used` or `unknown` record blocks expired/unsent wording;
- **any `approved` record blocks “its approvals expired”, whether claimable or not**. A claimable one is “approved and
  ready to send”. If the live policy is `never`, the exact description is **“approved, but the mailbox's policy is now
  never”**. Any other non-claimable approved state names its actual reason rather than calling it expired;
- a v2 `corrupt` record whose `bindingDigest` recomputes correctly (it is corrupt for another reason — an inconsistent
  state, timestamp or evidence) is attributable by its now-verified group key and makes exactly that group
  indeterminate; a **v2** record whose `bindingDigest` is missing, malformed or mismatched has untrustworthy attribution fields
  and makes the **whole report** indeterminate (Digest integrity, above). Declined, cancelled, otherwise
  revoked and failed records do not masquerade as expiry.

When the complete **retained** approval directory fits inside the 500-file read window and every selected record is
readable, lockable without waiting and processed before the report deadline, an otherwise eligible group may say
exactly **“not sent with any approval in the last 90 days”**. That is
the strongest permitted draft-level claim: records at or beyond the 90-day retention boundary may already have been
pruned, and the retained audit row does not carry the Gmail or Slack grouping key. The report therefore never makes an
all-time claim from the approval directory. It is also still a local claim: approval records cannot prove what
another Gmail client did. When the directory holds more approval files than the scan reads, **every returned candidate
row instead says “not sent with any of the 500 most recently changed approval records”**. Persisting a derived transition (to `expired` or `unknown`) rewrites a record and so changes its modification time; the wording therefore names
what was scanned — the 500 most recently *changed* records, not the 500 newest approvals — and makes no claim about
older ones. A matching `used`, `sending`, `unknown` or
`approved` record inside the window still blocks the candidate; one outside it is exactly why the remaining wording
is bounded.

If any file selected inside the scan window is unreadable, its ownership and key cannot be proved. Every candidate
row for every mailbox/account covered by that scan therefore says **“indeterminate (an approval record could not be
read)”** and makes no unsent or approvals-expired claim. A selected record whose lock is busy is likewise indeterminate
evidence for its key: when the key cannot be established without the locked read, every candidate covered by the scan
says **“indeterminate (an approval record was busy)”**; when the operation already has a safe attributable key, only
that group does. A deadline that leaves selected approval evidence unread uses **“indeterminate (the report deadline
left approval records unread)”** for every key that omitted evidence could affect. The unreadable file still appears
as D2's safe corrupt stub on the unpinned approval surfaces; pinned surfaces keep hiding it. An unreadable or busy file
outside a capped window is covered by the last-500 wording, because its contents were not among the evidence the
operation attempted to read.

At report time the Gmail operation performs a live `drafts.get` for each returned draft — the existing transport
operation is a provider read (`packages/gmail/src/gmail-api/transport.ts:509-513`). This is an independent observation,
not a repair for incomplete approval history:

- if the lookup finds it, the result may add **“still in Drafts”**;
- if Gmail returns no draft, it says **“no longer in Drafts — it may have been sent or deleted elsewhere”**;
- if the lookup fails, it reports the lookup failure and keeps only the correctly scoped local history wording above.

`agent-gmail send list` / `gmail_send_list` gains the `unsent` section, with recipients, subject and attachment names
through D8's untrusted-field rules, the last preparation and expiry, the evidence scope (`complete-90-days`,
`last-500` or `indeterminate`), the live Drafts result, and the one prepare call. The existing `agent-gmail draft show` /
`gmail_draft_get` → `getDraft` and `agent-gmail draft list` / `gmail_draft_list` → `listDrafts` use the same wording;
`agent-gmail doctor` / `gmail_doctor` → `doctor` counts the bounded last-seven-days result and points to the list
(`capabilities.json:501-514, 550-555, 755-760`). A last-500 or 20-row doctor count is a lower bound; a scan with an
unreadable or busy selected record, or one cut short by its deadline, reports an indeterminate count instead of a
number presented as complete. Reporting creates, sends and deletes nothing.

Slack's local draft inference is keyed by **workspace/account id, draft id, exact revision, and exact digest**, not
draft id alone and not revision or digest. Both must match. A `used` revision A never hides an expired revision B, and
an expired A never hides a `used` B; different revisions with identical content remain separate. Every saved revision
is new and the post approval already binds revision plus digest
(`packages/slack/src/operations/drafts.ts:151-190`; `packages/slack/src/operations/send.ts:446-469, 728-746`). The
same `complete-90-days`/`last-500`/`indeterminate` evidence labels and approved-state blocker apply to Slack's
annotation of the current exact revision. The existing `agent-slack draft list` / `slack_draft_list` may annotate that
revision; Resend and every historical Slack approval remain visible through core `approvals list`. No Resend or Slack
list surface is added (`capabilities.json:29-34, 1199-1204`).

**Rate-limited retention before enumeration.** `ApprovalStore.ensurePruned()` is awaited before every approval
creation and before every approval list, D3 status/wait operation, and D9 report, doctor or draft-annotation operation.
It is deliberately a store-use hook, not constructor work: one MCP context and its one `ApprovalStore` can remain
alive across any number of daily boundaries and still run maintenance. Calls in several processes coordinate per
state directory. A non-report hook gives `ensurePruned()` one five-second elapsed deadline. A D9 report creates that
deadline once, before calling `ensurePruned()`, and passes the same deadline through maintenance, report enumeration,
metadata and record reads, grouping and live draft lookups. Thus maintenance plus report have one **end-to-end
five-second work-start budget**, not five seconds each. Neither phase starts another step after the deadline, and
maintenance still starts no 201st record slot. An already-started filesystem or provider operation cannot necessarily
be cancelled, so wall time is about five seconds rather than a hard real-time cutoff; the implementation never adds
another ordinary lock timeout after the shared deadline.

The pruner holds the approval store's maintenance lock for the entire attempt with `staleMs: 30_000` and renewal
explicitly enabled at `renewMs: 10_000`. Renewal is not a default: `withFileLock` makes it opt-in and starts the
renewal timer only when `renewMs` is supplied (`packages/core/src/lock.ts:14-21, 157-164, 219-225`). The
maintenance callback captures its acquisition token and re-reads the lock to verify that token **before each record
prune and again immediately before writing the cursor**. A missing or different token stops the former holder from
starting more work or intentionally writing the cursor and reports the maintenance error. This check is not a
transactional fence: lock ownership can change after the read and before the atomic cursor rename, so a stale holder
can still overwrite a newer cursor. Safety does not depend on preventing that write. Every prune decision re-reads,
classifies and changes its record under that record's own lock, so a cursor overwrite can never make either holder
prune a record wrongly.

The persisted prune-state schema is exactly
`{ version: 1, lastAttemptAt: <finite ISO timestamp>, cursor: null | { mtimeMs: <finite non-negative number>, approvalId: <valid approval id> } }`.
It is validated field by field under the maintenance lock, following the update-state pattern
(`packages/core/src/update-state.ts:106-173`). A missing, unreadable or truncated file, or one whose outer object,
version or `lastAttemptAt` is schema-invalid, is treated as **never attempted**, with a null cursor; because maintenance
is then due, the run durably writes a fresh valid state before doing record work. The cursor is validated independently:
a valid timestamp with a malformed cursor retains the timestamp but restarts the next due pass from the oldest record.
A `lastAttemptAt` no more than five minutes in the future is tolerated as clock skew; one more than five minutes in the
future is treated as **now** and durably normalised to now, so a backward clock movement can suppress maintenance for
at most one ordinary 24-hour interval rather than indefinitely.

When fewer than 24 hours have elapsed since the validated or normalised `lastAttemptAt`, the method returns
`attempted: false`. Otherwise it durably writes the new attempt timestamp under the lock **before** processing records,
so a crash or failed batch cannot cause a retry storm and no state directory starts pruning more than once in any
24-hour window. A crash after this timestamp commit but before record work therefore leaves the old cursor and defers
the safe retry until the next interval.

One attempt enumerates the approval JSON and claim-marker directory once, stats retained candidates while budget
remains, pairs artifacts by approval id into one record slot, and orders the slots by oldest modification time with
approval id as the stable tie-breaker. Each selected slot counts against the **200-slot** limit before work begins.
Its record lock is a non-blocking try using the same stale-lock and token rules: it performs no polling sleep and does
not wait through the ordinary five-second lock timeout. A busy record is not opened or changed; it is counted, reported
as skipped and left for the next run. Under an acquired record lock the pruner opens the JSON at most once, classifies
it and applies the protocol below; a stray claim marker with no JSON also consumes one slot.

The persisted cursor is advisory. It normally resumes strictly after the last attempted slot. If a record lock was
busy and the run stops before the end, the cursor commit stays immediately before the earliest busy slot, so the next
daily run considers that record again; work done after it may repeat safely. Every run that reaches the end of the
directory clears the cursor, even if it skipped a busy record, so the next maintenance cycle starts another
oldest-first pass. Hitting either 200 slots or the five-second deadline returns `complete: false`; the cursor
records only safe progress reached inside those bounds. The cursor is atomically persisted after the final
best-effort ownership check, with the TOCTOU window above accepted. If a stale holder overwrites a newer cursor with
an earlier position, the next run merely rescans; if it writes a later position, the next run may skip ahead. Every
run that reaches the end clears the cursor, so any skipped range is reached within one full oldest-first cycle. A crash
before a cursor commit safely repeats work after the daily interval; a crash after it resumes from whichever advisory
position won the last atomic rename. Per-record failures are reported in maintenance status, leave uncertain artifacts
in place and do not extend either bound.

Valid finished records in `used`, `failed`, `unknown`, `revoked` or `expired` are deleted at
`now >= finishedAt + 90 days`, where `finishedAt` is the validated state-specific terminal time (`usedAt`, `failedAt`,
derived `unknownAt`, `revokedAt` or `expiredAt`). For a used send, `usedAt == sentAt`; changes and downloads set
`usedAt` when their claim enters `used`. A structurally valid legacy used record without `usedAt` uses its finite
`updatedAt` as `finishedAt` **for retention only** when `createdAt <= updatedAt` and every present `approvedAt`,
`sendingAt` or `sentAt` is also `<= updatedAt`: the fallback is not surfaced as `usedAt`, does not make the record
v2-valid and supports no send-time claim. A legacy record with no safe fallback remains unpruned. `pending`,
`approved` and `sending` records are never pruned; if locked classification first derives `expired` or `unknown`, that
now-finished record becomes eligible by its derived terminal time. Safe corrupt stubs and raw unreadable files are
deliberately excluded from automatic deletion so evidence is not destroyed under uncertainty.

Before deleting a finished record, the pruner follows this exact crash-safe order while holding the record lock:

1. append an `approval.retained` audit row with the approval id, kind, owner, final state, terminal time and any
   validated non-empty provider id, but no body or full recipient address, using
   `AuditLog.append(row, { durable: true })` (`packages/core/src/audit.ts:75-85`); durability fsyncs the file on every
   platform and the containing directories on POSIX. Windows skips directory sync and relies on NTFS metadata
   journaling (`packages/core/src/fs.ts:107-145`, especially `fs.ts:129`);
2. unlink `<approvalId>.claim` if it exists, treating `ENOENT` as success; this is the single-use marker currently
   created for every successful claim at `packages/core/src/approvals.ts:801-813`;
3. unlink `<approvalId>.json`.

No unlink starts until the durable append completes. An append failure leaves both artifacts. A claim-unlink failure
leaves the JSON record. A crash or JSON-unlink failure after the claim marker was removed leaves the JSON record for a
later retry; that retry may append a duplicate retention row before treating the already-absent marker as success and
removing the JSON. Duplicate audit rows are preferable to deleting the only durable terminal history. A stray
`<approvalId>.claim` whose JSON record is absent is unlinked when its record slot reaches a batch; a marker beside any
extant JSON record is handled only through the locked record protocol above. Eligible artifacts are therefore drained
in bounded daily batches rather than promised to disappear at store construction. Active records, preserved corrupt
or unreadable records, and a backlog when more than 200 slots per day age into eligibility are explicit retained
exceptions. The audit log remains durable terminal history, but D9 deliberately does not use its keyless retention
rows to make draft-level claims beyond 90 days.

`ensurePruned()` is bounded housekeeping, not an availability gate. Approval creation continues after its awaited
attempt, whose five-second elapsed budget includes lock and metadata work; a contended record adds no lock wait. Lists
and status proceed whether the attempt skipped, completed, hit 200, hit the time budget or encountered a maintenance
error. Reports do too, but use only the time remaining on their single shared deadline. Reporting returns
`{ attempted, processed, skippedBusy, complete, errors }` maintenance status instead of waiting for the whole backlog.
The ordinary list/report read can still fail on its own storage error. The evidence wording below remains governed by
the files the report actually selected and read, never by a claim that maintenance finished.

**Bounded content scan, with no index or migration.** After the awaited bounded prune attempt, the report uses the
remaining portion of the same five-second deadline to enumerate the retained approval filenames and filesystem
metadata, sort them by modification time descending with
approval id as the stable tie-breaker, and opens at most the **500 most recently modified approval files**. That
500-file cap bounds only the report's record-content reads; it does not bound the preceding prune batch or either
pass's directory enumeration and `stat` work. Enumeration/stat cost is bounded by the retained directory size: one
`readdir` and at most one `stat` per retained artifact on each pass, or two such passes when daily maintenance is due.
The 90-day rule bounds normal valid finished history only after the 200-per-day drain catches up. Active records,
preserved corrupt/unreadable files and an over-capacity maintenance backlog are explicit exceptions, so this design
does not claim a fixed metadata-work bound or lifetime-constant directory size.

Every selected report record uses the same non-blocking record-lock try as pruning: no polling sleep and no ordinary
five-second per-record timeout. The report opens and classifies the JSON only after acquiring that lock. A busy record
is indeterminate evidence under D9's existing rules. When its already established owner/group key is safe to use, it
makes that key's candidate indeterminate; when the lock prevents safe attribution of its owner or key, it has the same
effect as an unreadable selected file and makes every candidate covered by that scan indeterminate. The result reports
the approval id as busy without exposing record contents. If the shared deadline leaves any selected filename, lock
try, record read or grouping step unstarted, the report sets `truncated: deadline`, never claims `complete-90-days` or
`last-500` for evidence it did not read, and applies the same indeterminate wording to every key the omitted evidence
could affect. A live draft lookup omitted at the later provider phase does not weaken already completed local-history
evidence; it leaves only that independent live observation unknown.

For one report on which maintenance is due, the following are maxima under the one end-to-end five-second elapsed
ceiling; the deadline may stop either phase below them. The semantic I/O ceilings are two approval-directory
`readdir` calls;
at most `entries-before + entries-after` metadata stats; at most 200 prune record-content opens plus 500 report
record-content opens; one renewed maintenance/store lock plus at most 700 non-blocking record-lock attempts; at most
200 durable retention appends;
and at most 400 approval-artifact unlink attempts (claim marker plus JSON per processed slot). Lock-file cleanup adds
at most 701 unlink attempts, for at most 1,101 total unlink attempts in an uncontended run. When maintenance is not
due, the report has one enumeration/stat pass, at most 500 record-content opens and lock attempts, and no retention append or
artifact unlink. These are logical filesystem-operation bounds; the test file adapter counts every directory read,
record open, lock acquisition or try, renewal/ownership check, durable append and unlink, including lock-file unlinks,
so none is hidden behind a helper.

A `complete-90-days` scan means complete only
for the retained horizon, never for the installation's lifetime, and requires every selected record lock and read plus
the grouping work to finish inside the shared deadline. The operation validates/classifies the
selected files and groups the requested mailbox/account's matching records by draft so repeated approvals produce one
result. The last-seven-days rule selects candidate expiries; it does **not** discard an older matching `approved`,
`sending`, `used`, `unknown` or corrupt blocker from the opened retained history. Gmail's group key is mailbox id plus
draft id; Slack's is the exact
four-part key above. Existing v1 records participate directly from their files through a read-only legacy decoder, so
there is no index to backfill and no record migration. They remain unclaimable under D1's version rule, are
interpreted only with their original creation-relative lifetime, and never gain v2 timestamps; a structurally valid
expired v1 record may support only the evidence-scoped wording above. Invalid or truncated files follow D2's corrupt
contract and never support an unsent claim.

Eligible draft groups are ordered by their newest relevant approval, newest first. A report returns at most **20**
such drafts and, while time remains on the same deadline, performs no more than one live draft lookup for each: at most
20 provider reads total, with concurrency **2**. The result sets an explicit `truncated` reason when the retained
directory had more files than the 500-file window, when qualifying records may therefore have fallen outside it, when
more than 20 eligible draft groups were found, or when the deadline stopped either local or provider work. The first
case changes every row to the exact last-500 wording above; the second result cap says that older rows may be absent;
deadline-omitted evidence is indeterminate as specified above, and a draft lookup not started before the deadline is
reported as not observed rather than guessed. It never presents a capped result or doctor count as complete. Provider
lookup failures stay attached to their draft and do not raise the concurrency or call limit.

## 4. Departures from the ticket

1. **No in-chat approval for a fresh, untrusted Claude Code yet.** It is deferred to a URL-mode design because no MCP
   mechanism proves that a person, rather than the client or model, answered. The terminal-plus-wait route is honest
   and testable now.
2. **Exact-address escalation remains for internal recipients.** A stored exact address is a stronger signal than an
   own-domain match and still catches cross-mailbox sightings and the `internalDomains`-widening transition. The
   same-mailbox compromised-colleague gap is acknowledged, not used to claim broader protection.
3. **Chat-route pending remains ten minutes.** A conversational refusal cannot be observed, so tripling that bearer
   window would let a stale “no” be claimed. Confirm-route records get thirty minutes because they cannot be claimed
   without the outside decision.
4. **No short repeat preview.** With approved sends usable for 24 hours (D1), an identical re-prepare after an unused
   approval expires happens only after a day. Proving that a person saw every digest-bound byte would require a
   full-content terminal renderer; today's shared renderer truncates addresses, subject, attachment filenames, thread
   and URLs (`packages/core/src/render.ts:154-192`). That renderer is its own design. Identical content prepared again
   therefore gets the full ordinary preview. An `unknown` record does not mechanically block a later explicit
   preparation after the person checks the provider; an active `sending` record instead produces wait guidance, and
   every skill forbids preparing again until it becomes `used`, `failed` or `unknown`.
5. **“Previously mailed” is bounded to 50 hits per recipient and 200 history requests per operation.** Both Gmail
   search/list calls and metadata reads consume that shared `hasWrittenTo` budget. The separate correspondent-domain
   scan remains capped at 200 sent messages and is cached per mailbox for ten minutes. Gmail's fuzzy search can put
   the exact match after 50 false hits, and a large recipient list can exhaust the shared operation budget first. D4
   then conservatively keeps the warning and says the check was incomplete rather than claiming the recipient was
   found. These deliberate false negatives qualify the ticket outcome stated in §1.

## 5. Tests owed

- **Round-23 cases:** a scheduled Resend send with a sending-only key → "accepted by Resend, scheduled for <time>" and
  "current outcome unavailable", never "sent", also after its time; with a full-access key, `last_event` scheduled,
  delivered and cancelled-elsewhere each reported as such; a provider lookup failure → "current outcome unavailable";
  a successful provider cancellation followed independently by send-record and audit failures → success with a
  bookkeeping-gap hint; the exact CLI, MCP and skill wording for a scheduled acceptance without an id; one scan mixing
  valid v1 records (shown `legacy: true` with their stored state, never `corrupt`, never triggering the v2
  missing-binding rule) with v2 records.
- **Round-22 cases:** a Resend scheduled send: core status says "accepted by Resend", Resend's status says "scheduled,
  not yet sent" before its time, "cancelled before sending" after a cancel (approval record unchanged), "sent" after;
  a scheduled acceptance without an id → "accepted (scheduled); the provider returned no id", record stays `sending`
  then `unknown`; a legacy v1 record without `bindingDigest` shown as legacy in status and lists and used by D9's legacy
  decoder, while a v2 record missing it is an unpinned stub;
- **Round-21 cases:** an attribution-verified corrupt record shown to its owner versus a missing/mismatched-binding record
  as an unpinned stub and a pinned `NOT_FOUND`, across status, wait and lists; the download `claimable` matrix for
  pending chat, pending confirm, answered-unused, used, expired, revoked and corrupt records, including a live-policy
  change mid-wait.
- **Round-20 cases:** distinct answer, deadline and observation times, then restart: status, wait and list say
  "answered and expired before it was used" with no answer time; golden and round-trip cases for an absent `listing`
  (no `listing` key, no name comparison), an empty `listing` and a populated one.
- **Round-19 cases:** golden canonical-JSON and SHA-256 vectors for the download object with and without the optional
  listing members; tampering with any listing field before a direct-chat claim and before a save → `corrupt`, nothing
  saved; a confirm question followed by live-policy loosening stays confirm, and a valid-value mutation of the stored
  `policy` or `requiredPolicy` → `corrupt`; terminal/form answer → deadline → status, wait and list report "answered …
  and expired before it was used", never "before it was answered".
- **Round-18 cases:** a direct-chat `pending → used` download then status, wait and list report `answered (in chat)`
  with no destination; mutating every `listing` field (especially `renamed` and `flags`) and a `names`/`listing`
  disagreement → `corrupt` before any terminal or form rendering; `offered` with both paths through creation, canonical
  JSON and SHA-256 vectors; change and download `contentDigest` recomputed on status reads.
- **Round-17 cases:** file name A with stored `approvalId` B (B existing and not) → `corrupt`, no write or claim marker
  touches B; a pending or direct-chat download with an injected stored answer → `corrupt`, nothing saved; golden
  `offered` vectors for both folder choices (both paths always present); the committed manifest values (Gmail and Resend
  `draft`, Slack `draft-revision-digest`) and a Slack reaction producing no D9 group.
- **Round-16 cases:** independently mutating each identity field (`inboxId`, `inboxSub`, `draftId`, `draftMessageId`,
  `expect`) makes the record `corrupt` before approval, claim, provider access or reporting; mutating a confirm
  download's recorded answer or offered folder paths after approval saves no file and makes it `corrupt`; one Gmail
  draft prepared with different content digests, where an approved, sending, used or unknown record for either blocks
  the expired-draft wording; a malformed `approvalGrouping` in a manifest is refused by the manifest schema.
- **Round-15 cases:** a chat-policy download claimed `pending → used` with no evidence stays valid through status,
  listing and retention; create-path v2 round trips for every subtype prove the exact `identity` hashed; golden vectors
  for the download profile, `offered` and every kind; removed-account provider-free classification of Slack post,
  file, reaction and Resend records; a synthetic new channel declares its `approvalGrouping` with no core edit; any
  binding mismatch makes the whole report indeterminate across several drafts and accounts.
- **Round-14 cases:** the per-kind evidence table, every row valid and invalid (a form-approved confirm change →
  `corrupt`); valid confirm downloads in `approved` and `used` without `approvedAt`; approved-then-revoked descendants
  keep valid evidence while direct-chat `failed`/`unknown` descendants carry none; golden canonical-JSON and SHA-256
  vectors for every kind including Slack reactions; a provider-free Slack round trip from the stored `inboxId`; valid-value mutation of every attribution field → integrity failure → whole-report indeterminate; a used
  blocker's draft id moved from A to B gives no unsent wording for A, B or any other group.
- **Round-13 cases:** every `kind × route × approvedVia × state` combination, valid and invalid; an approved-lineage
  record in every descendant state with missing, malformed or contradictory evidence → `corrupt`; direct-chat `sending`
  and `used` records with no evidence stay valid; a record claiming `approvedVia: chat` → `corrupt`; a Slack revision
  changed to another syntactically valid value with every digest left unchanged → `bindingDigest` mismatch → `corrupt`,
  and the whole D9 report is indeterminate.
- **Round-12 cases:** approved send, change and download records with absent, malformed or contradictory
  confirmation evidence → `corrupt`; a claimant suspended immediately after a successful fence starts its one step (the
  stated limit) but no later step; lease expiry between each Slack step stops further steps with the right failure
  wording; D9 with Gmail and Slack records in every missing/malformed/mismatched digest combination makes the whole
  report indeterminate.
- **Round-11 cases:** missing, malformed, non-canonical and `bindingDigest`-mismatched records (structure and coherence
  only for `contentDigest` on provider-free reads; live comparison at approve and claim) → `corrupt`; a claimant suspended after claim and before each channel's
  first provider mutation, with another caller persisting `unknown`, makes no provider request and records
  `lease-lost-before-send`; hostile subjects, addresses and file names through core list, status and wait — including
  removed-account and legacy records — stay inside the envelope.
- **Round-10 cases:** more than 500 old records rewritten by `list`/`status` just before a report, displacing a newer
  used blocker — the report's wording names the 500 most recently changed records and claims nothing more; identical Slack
  content and revision prepared under `chat` and `confirm` groups as one by `contentDigest` while each claim checks its own
  `bindingDigest`; a production-shaped fake Gmail `sendDraft` held across several heartbeat intervals keeps `sending` and
  then records success, and again records failure.

Each guard is watched failing under a mutation, then restored.

- **D1 — routes and time:** chat-route sends and changes expire at ten minutes; confirm-route sends/changes (including
  escalated sends) at thirty; equality is expired. Route is stored and digest-bound. A confirm route never directly
  claims after policy loosens; a chat route claims only while the effective policy stays chat and waits when tightened.
  Approved sends/changes survive their pending deadline and expire exactly 24 hours after approval. An approval at
  `approvedAt == expiresAt` is refused as expired; every stored approved fixture requires `approvedAt < expiresAt`.
  Downloads expire thirty minutes from creation before or after answer and never gain `usableUntil`.
- **D1 — refusal races:** a conversational “no” that the server never receives, followed by claims at 11 and 29
  minutes, is expired at both for a chat route; a skill evaluation requires the agent to call revoke on “no”. An
  explicit form decline is atomically `revoked/declined` before claims at 11 or 29 minutes; cancel/dismiss stays pending
  (and a confirm route remains so at minute 29). Revoke-versus-claim under two processes has one locked winner. A
  cross-process list followed by claim, a claim across the hourly cap rollover (the current Gmail path reserves after
  claim at `packages/gmail/src/operations/send.ts:596-633`), and pending chat change claims are exercised.
- **D1 — versions and timestamps:** the new release's real create path writes a v2 fixture. A test imports a
  **checked-in frozen unpacking of the published `@agentcomms/core@0.13.0` tarball**, records its npm integrity, opens
  that v2 record with its exported `ApprovalStore` (`packages/core/src/index.ts:1-2`), attempts a real transition, and
  asserts the exact “prepared by a different version” refusal. The reverse test writes v1 through that same released
  module and has the new module refuse it. A v2 approved record presented to 0.13.0 after its pending deadline proves
  the old module may persist `expired` before returning the same version refusal, and never claims it. Absent and
  unknown versions; non-finite `createdAt`/`expiresAt`; wrong exact pending lifetime; missing/non-finite `approvedAt`;
  approval before creation or at/after pending expiry; and inconsistent `usableUntil` all report `corrupt`. An
  otherwise structurally valid active record observed before `createdAt` or `approvedAt` expires fail-closed.
  Missing, non-finite, misordered, state-inappropriate or contradictory `sendingAt`, `usedAt`, `sentAt`, `failedAt`,
  `revokedAt` and `expiredAt` are exercised in every applicable state. A used send requires `usedAt == sentAt`; a
  directly claimed change, an approved change and a download each exercise the exact `usedAt` ordering rules. Tests
  prove pending and approved deadline expiry persist the exact boundary as `expiredAt`. Separate rollbacks before
  `createdAt` and before `approvedAt` persist the
  observation time as `expiredAt`, persist exactly `reason: clock-anomaly`, use the “clock moved backwards” status
  prose, accept only that reason's ordering exemption, and stay expired after process restart and a corrected clock.
  `sendingHeartbeatAt` is absent before a send claim, optional thereafter, finite and ordered after `sendingAt` and
  before any terminal result. `unknownAt` is exactly `(sendingHeartbeatAt ?? sendingAt) + 2 min` and is not stored;
  equality at every boundary takes the later state. A read that persists ordinary expiry or `unknown`, followed by
  clock rollback, process restart and another ordinary read, stays final; clock rollback after valid `used` and
  `failed` records also leaves their states unchanged.
- **D1 — content and concurrency:** two simultaneous claims after the former ten-minute boundary of a confirm route
  have one winner; a changed draft, changed expected recipients/account or drifted plan voids at claim; old-server tool
  calls stopped by the update gate and its pending-or-approved exception both end closed on the digest version.
- **D1 — sending lease:** the claim creates one private random token and no public/audit rendering exposes it. The
  claimant writes `sendingHeartbeatAt` under the record lock every 30 seconds while provider work remains outstanding;
  each write requires the matching token. A full Slack file-post operation against the loopback fake holds real
  provider work open beyond five minutes, emits heartbeats, remains `sending` through status/wait, then separately
  succeeds and fails and records the known `used`/`failed` result. This exercises the production post/upload/share
  path rather than calling the approval store alone. A second process suspends the claimant's heartbeat for more than
  two minutes: status persists `unknown`; when the original provider promise later settles, its matching token still
  records `unknown → used` or `unknown → failed`, matching the recovery current `complete()` permits
  (`packages/core/src/approvals.ts:1068-1075`). A missing, stale or different token cannot heartbeat or complete, and
  approve, revoke, claim, status, wait and maintenance cannot move `unknown`. A resumed heartbeat cannot move it back
  to `sending`. Late success clears the stale-lease reason; late failure replaces it with the provider failure.
  Heartbeat-write failure and process suspension both exercise the same lease-expiry path.
- **D2:** every table row on every named surface, Slack files and reactions included; ownership is checked before
  routing; nonexistent, foreign, wrong-kind and pinned-away ids have byte-identical `NOT_FOUND` envelopes with
  `approval: null`, and a spy proves no foreign record was classified or rendered. Prepare-time `POLICY_NEVER`,
  invalid recipients, unsendable HTML and every other pre-creation failure also have no approval object. Confirm
  changes never form-elicit.
  Wrong codes one/two remain pending and three revokes with `APPROVAL_VOID`; decline revokes, cancel/dismiss does not.
  `APPROVAL_REQUIRED` never describes approved, expired, used, failed, sending, unknown, corrupt or revoked. Dedicated
  JSON/CLI/skill consumers branch on `SEND_OUTCOME_UNKNOWN`, exit 10/non-retryable, and prove they never prepare
  automatically. A different caller observing fresh `sending` gets retryable `APPROVAL_PENDING` with “being sent by
  another call since …; wait for it”, never `APPROVAL_VOID` or prepare-again guidance. An approved send whose live
  policy becomes `never` reports `claimable: false` and claim refuses with `POLICY_NEVER`; the same policy check is
  applied consistently to approved changes where that policy exists.
- **D2 — provider truth:** inject a Slack failure before upload, during upload, after known upload and at the share
  call. Before a successful share each error says “nothing was posted”, and details preserve exact `uploaded` and
  `possiblyUploaded` disclosure. Ambiguous responses from Gmail, Resend, Slack messages, Slack file shares and Slack
  reactions immediately return non-retryable `SEND_OUTCOME_UNKNOWN` with `approval.state: sending`; zero-wait/list
  reports `sending` before the current lease boundary and `unknown` at equality. Gmail/Resend certain failures continue
  to say nothing was sent. For Gmail, Slack and Resend, provider success followed by a failed approval-store `used`
  write still returns outward success, and zero-wait/list later reports `sending` then `unknown`, never invented
  `used`. Skill evaluations forbid preparing while `sending`; after `unknown`, they state that the original claimant
  may still record a late result, require checking Sent/the channel first and forbid an automatic prepare.
- **D3:** every result shape; `waitSeconds: 0`; default 30 and maximum 300; no poll beyond a pending or approved
  record's deadline or a sending record's current heartbeat-derived `unknownAt`; immediate
  `{state: pending, claimable: true}` for pending/chat;
  download `answered`/`expired` without `usableUntil`; timeout returns pending or sending with the same id and current
  actionability. A nonzero pending-confirm wait is proved to perform later polls instead of returning its first
  classified pending result. A wait that first sees `sending` continues polling and is separately driven to `used`,
  `failed` and stale-boundary `unknown`; it never returns prepare-again guidance while in progress. It otherwise stops
  as soon as approval becomes claimable, policy makes an approved record non-claimable, a terminal/expired outcome
  appears, cancellation arrives or time runs out. The wait's only permitted byte changes are valid derived expiry or
  stale-send finalisation; concurrent claimant heartbeats may advance `sendingHeartbeatAt` beneath the same record
  lock. A terminal approval ends a wait `{state: approved, claimable: true}` without changing the
  stored state again. State change versus timeout/cancellation is classified by the final locked read.
- **D3 — resources and cancellation:** the ninth simultaneous wait in one process is refused. Success, timeout,
  caller cancellation, thrown read/classification error and MCP disconnect each release the slot, proven by an eighth
  replacement wait. Cancellation leaves the record untouched apart from valid persisted expiry or stale-send
  finalisation; the disconnect test expects no result delivery while still proving waiter cleanup. A supplied progress
  token receives the 15-second cadence; no token means no progress. A read spy proves at most one approval-file read
  per second and a provider spy proves wait, including zero-wait status, never calls Gmail, Slack or Resend.
  Foreign/pinned ids are not found. Every CLI/MCP pair passes parity against `waitForApproval`.
- **D3 — client smoke matrix (manual, informational):** Claude Code main conversation, subagent, IDE, noninteractive
  and a configured background threshold, recording whether calls foreground, background or limit. No observed timing
  becomes a protocol constant; each scenario completes through repeated short waits.
- **D4:** exact internal address from another mailbox (header and body), exact external, domain-only internal,
  domain-only external, and both exact/domain present — exact wins the explanation; written-before suppresses each;
  public-provider domains never match by domain. `hasWrittenTo` finds an exact address on hit 6 and hit 50 across
  pages, stops at exactly 50, rejects fuzzy hits, and uses To/Cc/Bcc query terms. Fifty fuzzy false hits with the exact
  match at 51 returns “not written”, explicitly locking in the accepted conservative false negative. A 500-recipient
  draft and mixed multi-recipient fixtures prove one operation starts at most 200 total `hasWrittenTo`
  `listMessages` plus `getMessageMetadata` calls, never 200 per recipient; unchecked recipients are
  `budget-exhausted`, treated as not written, keep escalation and show the explicit preview qualification. Search/list
  and metadata failures produce `provider-error`, keep escalation and show their qualification. Prepare followed by
  terminal approval within ten minutes reuses both shared caches: the per-mailbox, per-canonical-address cache limits
  `hasWrittenTo` work to 200 calls across both passes, and the separate per-mailbox correspondent-domain cache limits
  its work to one list plus at most 200 metadata reads across both passes. A provider spy counts **all** of those
  calls, asserts the combined maximum of 401 rather than counting metadata alone, and proves a cached correspondent
  domain still causes lookalike escalation. After either cache expires, each new operation independently obeys the
  applicable cap. More than 5,000 distinct address keys and more than 5,000 mailbox-domain keys prove each cache stays
  at its independent cap; after the clock reaches the ten-minute expiry, the next locked write physically removes the
  stale entries before applying updates and evicting the oldest live entries. Malformed JSON and schema-invalid cache
  files both read as empty: address history becomes conservative `not-written/cache-malformed`, while correspondent
  domains are scanned again; a failed recovery scan keeps escalation. Neither corruption case can produce a cached
  `written` answer or silently suppress a lookalike warning. Separate child processes concurrently mutate each cache;
  their disjoint entries are all retained, the same observation-time/key tie-break produces stable eviction regardless
  of writer order, and no read-modify-write update is lost. Atomic-write failures before and around rename leave the
  next process with either the complete old file or complete new file, never partial JSON; the failing operation reports
  `cache-write-failed` and cannot use the uncommitted observation to suppress recipient-taint or lookalike escalation.
- **D4 — provenance and gaps:** same-mailbox internal addresses are omitted; another mailbox can record the same
  address; widening `internalDomains` leaves an already-recorded exact address until day seven. An old header in
  mailbox A plus a recent body sighting in mailbox B is described only as separate aggregate facts, never one
  sighting. Address/domain payloads that look like instructions are canonicalised or wrapped as untrusted; mailbox
  ids/date/template stay trusted. Removed mailbox, exact/domain precedence, public-domain behavior, lookalike and
  attachment flags are covered.
- **D5:** the untrusted refusal names the resolved terminal command and wait tool and does not advertise the trust
  list. No surface says “known to reach a person”. The terminal test asserts the standard shared rendering appears
  once there, its body and fixed truncation behavior match `renderMessagePreview`, approval does not send, and the
  agent's wait observes `{state: approved, claimable: true}`. Long hostile addresses, subjects, filenames, thread text
  and URLs prove truncation and display escaping rather than being treated as a full-content proof.
- **D7:** every newly printed terminal approval command and matching wait hint is executed through the Gmail, Resend
  and Slack refusal paths under POSIX and Windows rendering. Core change-approval refusals and Gmail/Slack
  download-approval refusals are covered on both platforms too: a core change names `agentcomms approve` plus
  `comms_approval_wait`/`agentcomms approval wait`, while Gmail and Slack downloads name their channel's `approve`
  command plus matching channel wait tool/command. Each named command parses, each tool exists, and the capability row
  reaches the same operation.
- **D8 — objects and privacy:** every send-path success/refusal carries either the state object or the specified null;
  “expired after approval” appears when `approvedAt` exists; `state: approved` and `claimable` remain separate;
  downloads use their own state fields; all four zero-wait CLI/MCP pairs agree. Nonexistent/foreign ids and every
  failure before creation are covered as in D2. Provider success with a missing Gmail id or Slack `ts` says exactly
  “sent; the provider returned no id”, never reports `used` or invents “message id”, and later classifies the record as
  `unknown`; ordinary success cannot enter `used` with an empty id. Spies assert that missing Gmail ids and
  Slack message/file/reaction ids never write `""` into a completion or audit record and never issue a provider
  readback call with an empty id; the audit outcome omits the id and records accepted-without-id instead.
- **D8 — integrity and untrusted data:** malformed timestamps and unknown versions are `corrupt` through direct get,
  core list, channel list, zero-wait status and a nonzero wait — never skipped, claimable or called unsent. Separate
  fixtures cover invalid JSON, every truncated-JSON boundary, missing ownership/kind and wrong-shaped scalars/arrays.
  Unpinned core and channel lists/status/waits expose only `{ approvalId, state: "corrupt", reason }`; pinned lists omit
  them, pinned status/wait returns owner-hidden `NOT_FOUND`, and doctor reports the count. Hostile subjects, addresses,
  display prose and attachment filenames remain inside their untrusted envelopes in D8 and D9 list objects.
- **D9 — evidence:** a directly inspected pending-expired and approved-then-expired record says exactly “this approval
  expired; nothing was sent with it”. With a complete readable, uncontended retained directory processed before the
  shared deadline, an otherwise eligible draft group
  may say exactly “not sent with any approval in the last 90 days” and reports evidence scope `complete-90-days`.
  Any matching `approved` record blocks “approvals expired”, whether claimable or not; an approved record plus a newer
  expired record is exercised, and live policy `never` produces exactly “approved, but the mailbox's policy is now
  never”. Matching `sending`, `used`, `unknown` and attributable corrupt records also prevent the inference;
  decline/cancel/revoke/corrupt is never relabelled expiry. A matching used record older than the seven-day candidate
  window but still inside retained history also blocks it. A live Gmail draft adds “still in Drafts”; an external
  Gmail-UI send and an external deletion after approval expiry both produce “no longer in Drafts — it may have been
  sent or deleted elsewhere”, never “unsent” or “still in Drafts”. Provider lookup failure stays local-only. Send
  list, draft show/list and doctor create, send and delete nothing. Slack revision A `used` plus revision B `expired`
  still reports B; the inverse still reports A as used. Identical digests at different revisions remain separate in
  both directions because Slack requires exact revision **and** digest. A used Slack record for exact revision/digest
  R is pruned at its 90-day boundary, then an unchanged R gets a newer expired approval; even with a complete readable
  retained directory, the row says only “not sent with any approval in the last 90 days”, never an all-time claim.
- **D9 — capped, bounded, busy and unreadable evidence:** fixtures contain far more than 500 approval files across
  several mailboxes with controlled mtimes and repeated records per draft. A same-key `used`, `sending` and `unknown`
  record is placed at file 501 in turn while a newer matching expiry remains inside the window; every row says only
  “not sent with any of the 500 most recently changed approval records”, never an all-time claim or the unqualified “its approvals expired”.
  An unreadable file at each
  position inside the selected window makes every candidate row for the scan exactly “indeterminate (an
  approval record could not be read)”; its unknown ownership is never guessed. An unreadable file outside a capped
  window retains last-500 wording. An attributable parseable-corrupt record makes only its matching group
  indeterminate. Every report record lock is a single non-blocking try. A safely attributable busy record makes its
  exact key indeterminate; a busy record whose key cannot be learned without opening it makes all candidates in that
  scan exactly “indeterminate (an approval record was busy)”. With all 500 selected record locks held by separate
  processes, the report tries each once without polling, completes in about five seconds or less under the single
  maintenance-plus-report deadline, opens none of them, and returns only indeterminate evidence. A separate fake-clock
  case spends the shared deadline in maintenance and proves report enumeration, reads, grouping and provider lookups
  start only while time remains; omitted approval evidence is indeterminate and an omitted live lookup is merely not
  observed. The scan opens only the newest 500, filters after opening, groups each Gmail draft and exact Slack
  revision/digest once, orders newest groups first, returns at most 20, performs at most 20 live lookups with observed
  concurrency never above two, and reports every applicable evidence scope and cut-short reason. Existing on-disk v1
  records are found through the read-only historical decoder without an index or migration, remain unclaimable and
  support only the same evidence-scoped wording. With maintenance due, an instrumented filesystem counts every
  `readdir`, retained-artifact `stat`, approval-record content open, maintenance renewal/ownership check,
  maintenance/record lock attempt, durable audit append and unlink across prune plus report. On a fast uncontended
  fixture it enforces the
  stated two-enumeration, `entries-before + entries-after` stat, 700-content-open,
  one-maintenance-plus-700-record-lock, 200-append, 400-artifact-unlink and 1,101-total-unlink maxima; the five-second
  end-to-end deadline can only lower those counts, and the 500 cap is asserted only for the report half. The same
  fixture with maintenance not due enforces the one-pass/500-open bounds.
- **D9 — retention:** one fake-clock MCP context and its one store stay alive across several 24-hour boundaries;
  approval creation and list/report/status calls trigger `ensurePruned()` without reconstructing either object. The
  persisted timestamp and concurrent callers prove each state directory starts at most one batch per 24 hours. Missing,
  truncated and schema-invalid prune-state files each act as never attempted and are replaced by a fresh valid state
  even when the batch later fails. A valid timestamp plus each malformed cursor shape restarts from the oldest record.
  A `lastAttemptAt` just inside the five-minute future-skew allowance remains valid; one beyond it, and a process whose
  clock moves backwards past that threshold, are normalised durably to now and become due after one ordinary interval,
  never after the untrusted future timestamp.

  With filesystem work kept below the elapsed deadline, more than 200 oldest slots prove the first run stops exactly
  at 200, reporting still completes with `complete: false`, and later daily runs resume after the persisted
  `(mtime, approvalId)` cursor until a full pass clears it. A fake clock advanced during metadata and record work proves
  no new step starts after five seconds and the cursor reflects only completed progress. All 200 record locks contended
  by separate processes are tried once without polling; approval creation and status return in about five seconds or
  less, every busy record remains, and the next daily run considers the earliest one again. Old active/corrupt records
  do not starve later slots.

  A process holds one batch inside an already-started filesystem operation beyond the 30-second stale interval while a
  second process calls maintenance: renewal keeps the original token live, the second process never steals the lock,
  only the first batch prunes, and only it commits the cursor. A forced token replacement before a per-record
  ownership check proves the stale holder starts no next record once it observes the replacement. A second forced
  replacement lands **after** the stale holder's final ownership check but before its atomic cursor rename and proves
  the stale cursor may overwrite: an earlier overwrite causes only a rescan, a later overwrite causes only a skip, no
  record is pruned without its own
  locked re-read, and the end-of-directory reset reaches the skipped range within one full cycle. Crash tests
  immediately after the durable attempt-timestamp commit prove restart does not retry until 24 hours and retains the
  old cursor. Crashes immediately before and after the atomic cursor commit prove the next due run respectively
  repeats safe work or resumes after the committed slot;
  a truncated cursor write follows the schema-invalid recovery rule.

  Each valid `used`,
  `failed`, `unknown`, `revoked` and `expired` record survives before 90 days and is deleted at equality after a
  locked re-read; pending, approved and fresh sending records are never deleted, while sending made stale by the
  locked classification becomes `unknown` before eligibility is judged. Safe corrupt stubs and unreadable files are
  retained. Used sends persist `usedAt == sentAt`; used changes and downloads persist `usedAt` at their transition and
  are retained immediately before `usedAt + 90 days` and pruned at equality. A structurally valid legacy used record
  without `usedAt` gets the same boundary test using finite `updatedAt` with `createdAt` and every present
  `approvedAt`/`sendingAt`/`sentAt` at or before it, for retention only; an unsafe fallback is retained. A spy proves
  the exact order durable audit append → `<id>.claim` unlink → `<id>.json` unlink, including
  the marker created by the current claim path (`packages/core/src/approvals.ts:801-813`). Restart tests inject a crash
  immediately before and after each of those three steps: no unlink precedes a completed durable append, every surviving
  JSON record is safely retried, an already-removed marker is tolerated, and duplicate audit rows are allowed. Separate
  fixtures cover append/fsync failure, claim-unlink failure, JSON-unlink failure, and a stray `.claim` without its
  `.json`, which is removed when its bounded record slot is reached. A maintenance failure is surfaced while the
  report still returns evidence-scoped results. Repeated operations, including reopening, do not start another batch
  within the daily interval.
- **Acceptance, end to end with fake Gmail:** an internal colleague recorded in another mailbox, from an untrusted
  client, produces `recipient-tainted`, one chat prepare/preview, one standard terminal rendering and **one person
  decision**. The agent's `gmail_send_wait` returns `{state: approved, claimable: true}`; execute uses that record,
  with no second prepare and no second **chat** preview, and returns `sentMessageId`. Repeat with approval at minute 25
  and claim two hours later. An internal domain-only recipient does not taint and a chat route sends on the person's yes
  inside ten minutes. Replay the ticket's 22:42:46 prepare and 22:48:22 approval: wait learns it, the send succeeds, and
  no error asks again. With no claim and a complete readable retained approval scan, it says “not sent with any
  approval in the last 90 days” 24 hours after approval and “still in Drafts” only after the live lookup. Preparing
  identical content again gets the full ordinary preview and is not blocked by the expired record or by a prior final
  `unknown` record.

## 6. Out of scope

URL-mode elicitation to an authenticated local approval page; OS-notification approval; making terminal `approve`
send; observing a natural-language “no” without the agent calling revoke; a cross-process/global wait semaphore;
per-sighting taint provenance; changing download lifetimes; changing `requiresUserInteraction`; MCP Tasks; binding
approvals to the preparing process.

## 7. Risks

1. **Approved records live for 24 hours** — accepted, bounded by a person decision, v2 content/route/lifetime binding,
   single use, revocation and the same-user threat model.
2. **Conversational “no” is not observable** — the skills tell the agent to call revoke, but a failing or hostile
   agent may not. The remaining bearer window is the current ten minutes, not thirty
   (`packages/core/src/approvals.ts:401-407`).
3. **Same-mailbox internal mail leaves no exact taint tripwire** — the recorder excludes current internal domains
   before storage (`packages/core/src/taint.ts:296-305`). A compromised colleague writing only there is caught by
   neither exact nor domain taint. This is pre-existing and unchanged; preview review and `confirm` remain the cover.
4. **An `internalDomains` widening has a seven-day tail** — an address recorded while external remains exact-tainted
   until the cutoff. `check()` then excludes it in memory, but physical removal waits for the next locked `record()`
   rewrite (`packages/core/src/taint.ts:253-264, 317-327, 341-349`). That conservative transition is explained.
5. **Eight waits is per process** — several CLI/server processes can exceed eight in aggregate. Each wait is bounded to
   one small read per second and at most its record's own lifetime; a global semaphore is out of scope.
6. **Fresh Claude Code has no in-chat confirmation** — terminal approval plus a wait is the honest path until the
   authenticated URL-mode design exists.
7. **`requiresUserInteraction` stays policy-derived** — a chat mailbox's escalated send reaches a person through the
   confirm route; making it unconditional would prompt every chat send
   (`packages/gmail/src/mcp/server.ts:2366-2374`).
8. **The draft-history report is deliberately evidence-scoped at scale** — retention attempts at most 200 oldest
   record slots and stops starting work at five seconds per day. A report shares one end-to-end five-second deadline
   across that maintenance and its own scan and provider lookups. Directory enumeration and `stat` remain linear in
   the retained artifacts within that elapsed budget: normal finished history is bounded by 90 days only when that
   drain keeps pace, while active records, busy locks, preserved corrupt stubs and maintenance backlog are explicit
   exceptions. The report's 500-file cap bounds only its own opened record contents; a due prune can open up to 200
   more first. Report record locks are non-blocking, but a busy retained window can still push a mailbox's record
   outside the scan. Even an uncapped readable scan says only “not sent with any approval in the last 90 days”; every
   fully read capped row says “not sent with any of the 500 most recently changed approval records”. An unreadable or busy selected record, or
   approval evidence omitted at the deadline, makes the affected key/scan indeterminate under D9's rules, and doctor
   never presents either count as complete.
9. **`unknown` can receive one late claimant result** — process suspension or a failed heartbeat can exhaust the
   two-minute lease while provider work still exists. Every public and maintenance transition treats `unknown` as
   final, but the original private claim token may still record the eventual provider result as `used` or `failed`.
   Status and skills therefore say that possibility plainly and never prepare automatically.
