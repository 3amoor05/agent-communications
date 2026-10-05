# CUE-404 — approving a send without fighting the clock — design

Status: **revised after round 4 (7 P1, 5 P2, 1 P3, all addressed)**, 2026-10-05, from Linear CUE-404 (High; the
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
expired before or after approval, used and sent with its message id); **a draft whose approvals all expired is reported
as not sent through agentcomms**, with its live Gmail Drafts state checked rather than guessed; and a proposed short
preview when identical content is prepared again. D8 and D9 implement the first two. The short repeat preview is
dropped for this release and listed as a departure in §4.

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
| A new mailbox's `internalDomains` defaults to its own non-public domain, and widening it is a gated loosening. With static configuration, an exact internal address can enter the shared taint store only through a mailbox where it is external. An address recorded while external can nevertheless remain for the seven-day window after `internalDomains` is widened, because reads prune stored entries by time and `check()` does not reapply the recording exclusions. | `packages/core/src/config.ts:1293-1297, 1425-1446`; `packages/core/src/taint.ts:260-270, 296-325, 341-349` |
| Send time currently escalates on `seen.address \|\| seen.domain` unless this mailbox has written to the exact address. The sent-history check currently asks only for five fuzzy `in:sent to:<address>` hits, then comma-splits To/Cc/Bcc header strings and strips display-name wrappers with a regex before exact canonical-address comparison; it is not RFC mailbox-list parsing and does not paginate. | `packages/gmail/src/operations/send.ts:202-221, 240-275` |
| Terminal send approval currently re-renders the shared preview, asks for the challenge, and only approves; it does not send. The shared renderer truncates addresses, subject, attachment filenames, thread and URLs, so this is not proof that every digest-bound byte was displayed. | `packages/gmail/src/cli/program.ts:1345-1356`; `packages/core/src/render.ts:154-192` |
| Approval records currently carry `digestVersion: 1`; every locked transition refuses another version with “prepared by a different version of agent-communications,” after persisting any derived state it observed. | `packages/core/src/approvals.ts:292-306, 570-588` |
| The existing update gate stops a non-exempt tool on an older server after a newer release is known, while deliberately allowing a call that carries a matching `pending` **or `approved` record** this machine already holds; the approval store's digest-version check remains the backstop for that allowed call. | `packages/core/src/update-gate.ts:64-91, 126-154`; `packages/core/src/approvals.ts:570-588` |
| Core stores `sentMessageId` only when the `used` transition is written. After a provider succeeds, Gmail, Slack and Resend each preserve the successful outward result if that write fails and say the approval will read as `unknown`; none may invent `used`. Gmail currently converts a missing API id to `""`, and Slack does the same for a missing message `ts`, so provider acceptance does not currently guarantee a reportable id. | `packages/core/src/approvals.ts:1068-1075`; `packages/gmail/src/operations/send.ts:691-728`; `packages/slack/src/operations/send.ts:771-775, 883-910, 1114-1133`; `packages/resend/src/operations/send.ts:685-715`; `packages/gmail/src/gmail-api/transport.ts:533-546`; `packages/slack/src/operations/send.ts:771-775` |
| Ambiguous provider responses currently leave the approval in `sending` and return retryable `TRANSIENT` (or preserve another retryable provider code): Gmail and Resend do this for email, and Slack does it for messages, file shares and reactions. | `packages/gmail/src/operations/send.ts:652-688`; `packages/resend/src/operations/send.ts:628-675`; `packages/slack/src/operations/send.ts:753-768, 831-862, 1079-1108, 1349-1384, 1468-1472` |
| Approval records currently have only generic `createdAt`, `expiresAt` and `updatedAt`; stale `sending` is derived from `updatedAt`, so state-specific transition times are not recoverable. | `packages/core/src/approvals.ts:302-330, 512-530` |
| Core's current `list()` reads every approval file sequentially and catches a failed `get()` as `null`, silently omitting that record. | `packages/core/src/approvals.ts:1085-1103` |
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
canonical approval binding includes the content/change digest plus the immutable route and its lifetime profile:
`{route, pendingMs, approvedMs}` for sends and changes, and the fixed creation-relative download profile for downloads.
That makes the bump a real change in what an approval authorises, not an advisory field an older binary can ignore.

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
- for an outward send, entering `used` requires a non-empty provider `sentMessageId` and persists `sentAt`, with
  `sendingAt <= sentAt`. Entering `failed` persists `failedAt`, with `sendingAt <= failedAt`. `sentAt` exists only on
  a used send, and `failedAt` only on a failed send. Change and download records may use their existing `used` state
  without send timestamps or a provider id;
- entering `revoked` persists `revokedAt`, with `createdAt <= revokedAt` and, when the record had been approved,
  `approvedAt <= revokedAt`. The locked transition first derives expiry, so `revokedAt` must be before the pending
  or approved deadline that applied; a revoke at the boundary produces `expired` instead;
- only active `pending` and `approved` records derive expiry. A pending record expires at `now >= expiresAt`; an
  approved send/change expires at `now >= usableUntil`, while an answered-but-unused download expires at
  `now >= expiresAt`. The transition persists `expiredAt` as that derived boundary, not as the later observation time.
  An expired-after-approval send/change retains `approvedAt` and `usableUntil`;
- `unknownAt` is not persisted: it is exactly `sendingAt + SENDING_STALE_MS`. A `sending` record reads and is
  persisted as final `unknown` at `now >= unknownAt`; equality is stale. There is no reconciliation transition out of
  `unknown`. The stale limit remains the current five minutes (`packages/core/src/approvals.ts:409, 512-530`);
- `now < createdAt` and, for an active approved record, `now < approvedAt` fail closed as expired. Boundary equality
  is expired everywhere. The final states `used`, `failed`, `unknown`, `revoked` and `expired` never change because of
  the observation clock, so a later clock rollback cannot turn one into `expired` or revive it;
- send-specific timestamps are finite and appear exactly where that state or its retained history requires them:
  `sendingAt` on `sending`/`used`/`failed`/`unknown`, `sentAt` only on `used`, `failedAt` only on `failed`,
  while all kinds put `revokedAt` only on `revoked` and `expiredAt` only on `expired`. `approvedAt` and `usableUntil`
  remain together on every later send/change state reached from approval. A contradictory field or any violation of
  the ordering above is corrupt;
- a missing, unknown or non-integer digest version, or a missing, non-finite or inconsistent timestamp, is a distinct
  public integrity state, `corrupt`. It is never claimable, never described as unsent and never silently omitted.
  This includes an on-disk approved record with `approvedAt == expiresAt`: the transition should have expired at that
  boundary, so the impossible stored combination is corrupt. A corrupt classification does not rewrite the raw state.

Expiry and stale-send classification are monotonic. A locked read persists `expired` with `expiredAt`, or `unknown`
when a valid active record crosses its boundary; this extends the locked transition's existing write-back rule
(`packages/core/src/approvals.ts:570-588`) to `get`, list, status and wait. Valid final records are returned unchanged.
A wait is therefore read-only except that it may persist one of those derived final states.

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

The outcome keeps storage and actionability separate. For sends and changes, `state` is the persisted state (`pending`,
`approved`, `sending`, `used`, `failed`, `unknown`, `expired` or `revoked`), except that an integrity failure is
reported as `corrupt`; `claimable` is a boolean. It is true only for an `approved` send/change before `usableUntil`
while the effective live policy is not `never`, or a pending chat-route send/change while the effective live policy
is still `chat`. `claimable` is never a stored state and a wait does not change the state merely because the record can
be claimed. Downloads retain their public `answered` classification for stored `approved`/`used` records.

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
| pending or approved send/change, live policy `never` | its real state, `claimable: false`; an execute/claim returns `POLICY_NEVER` |
| expired before approval | `state: expired`, `claimable: false`; `APPROVAL_EXPIRED`: prepared at …, expired at …; prepare again |
| approved, then expired unused | `state: expired`, `claimable: false`; `APPROVAL_EXPIRED`: approved at …, expired unused at …; prepare again |
| provider response leaves this call's outcome uncertain | immediately return non-retryable `SEND_OUTCOME_UNKNOWN` with `approval.state: sending`, `claimable: false`, `sendingAt` and derived `unknownAt`; the send may have happened |
| `sending`, inside the stale limit, observed by another call | `APPROVAL_VOID`: being used by another call since `sendingAt` |
| `unknown` at or after the stale-send limit | `SEND_OUTCOME_UNKNOWN`: final; the send may have happened; check Sent/the channel before doing anything else |
| used send | `APPROVAL_VOID`: already used at `sentAt`, with its non-empty provider message id |
| used change | `APPROVAL_VOID`: the approved change was already claimed; no provider-id or “sent” wording |
| `failed` | `APPROVAL_VOID` with channel-specific truth. Gmail/Resend certain failures say nothing was sent. A Slack file failure says **“nothing was posted”** and preserves `uploaded` and `possiblyUploaded` ids/names because bytes may already have reached Slack (`packages/slack/src/operations/send.ts:1016-1018, 1032-1035, 1088-1111, 1137-1172`) |
| `revoked` | `APPROVAL_VOID` with its reason; an explicit decline is “declined”, while cancellation is not a revoke |
| download pending | `pending` until answered, expired or a wait times out; under `chat` the answer may be relayed, under `confirm` it comes from the terminal or trusted form |
| download `approved` or `used` | `answered`, with the recorded destination choice and original creation-relative expiry; never `approved` with a `usableUntil` |
| download `expired` | `expired` / `APPROVAL_EXPIRED`: the question expired before it was answered or used; current download state handling is separate already (`packages/core/src/approvals.ts:591-607, 972-1004`) |

`SEND_OUTCOME_UNKNOWN` is added to the one registry with exit **10**, `retryable: false`, and summary **“the send
outcome is unknown; check before sending again”**. Exit 10 is the existing approval/send-refusal class, while the
distinct code prevents consumers from following `APPROVAL_VOID`'s global “prepare again” summary
(`packages/core/src/errors.ts:6-24, 58-115`). The current Gmail, Resend and Slack ambiguous paths cited in §2 switch
to this code as soon as they know the response is uncertain. `unknown` is final and has no reconciliation command.
Neither a `sending` record from an ambiguous response nor its later `unknown` state blocks an explicit new prepare;
the skills first tell the person to check Sent or the Slack channel and prepare again only after they establish that
the outward action did not happen. No skill or machine consumer prepares automatically.

The classifier runs **inside each locked transition**. Approve, claim, revoke and form resolution read, derive,
validate, classify and write beneath the same record lock. Inspect/status/wait use the same locked read so that expiry
write-back is atomic. There is no pre-lock state classification that a concurrent claim can contradict.

### D3. Waiting for an approval: short, bounded and on every surface

`waitForApproval(approvalId, { waitSeconds, signal, owner })` never claims, revokes or executes. It checks ownership
and kind first and polls one small approval file at most once a second through D2's locked read. `waitSeconds` defaults
to 30, has a maximum of **300**, and `0` is status now and always returns the current classified outcome. For a nonzero
wait it keeps polling while the outcome is `pending` and not claimable. It stops on the first claimable, terminal or
expired outcome, and on every non-pending outcome (including approved-but-not-claimable and `sending`), caller
cancellation or timeout. It never polls beyond the record's pending/usable deadline. A pending, directly claimable
chat-route send/change returns immediately as `{ state: "pending", claimable: true }`; a terminal approval ends the
wait as `{ state: "approved", claimable: true, usableUntil }`. The persisted state stays `approved`. A download
returns `state: answered` when approved/used and `state: expired` when expired, with no `usableUntil`.

The result carries `state` plus `claimable`; its states are `pending`, `approved`, `sending`, `expired`, `revoked`,
`used`, `failed`, `unknown`, `corrupt`, `answered` (downloads) and, when it can be delivered, `cancelled` (the wait,
not the approval, with `claimable: false`). A nonexistent, foreign, wrong-kind or pinned-away id is D2's `NOT_FOUND`
error with `approval: null`, not another state. A timeout is `state: pending` with the same id and the correct
`claimable` value. Progress is sent every 15 seconds only when the caller supplied a progress token.

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

**Previously mailed means exactly checked within the bound.** `hasWrittenTo` uses
`in:sent {to:<canonical-address> cc:<canonical-address> bcc:<canonical-address>}` and paginates until it has checked
exactly 50 hits or Gmail has no next page. Each hit still has its To/Cc/Bcc header strings comma-split and display-name
wrappers regex-stripped before exact canonical-address comparison because Gmail search is fuzzy; this is deliberately
not described as RFC address parsing (`packages/gmail/src/operations/send.ts:209-221`). This replaces the current
five-hit, unpaginated check. The cap deliberately accepts one false negative: if 50 fuzzy hits contain no exact
address and the exact hit would be 51st, the result is “not written” and the send keeps the warning. That is
conservative; provider doubt, exhaustion at 50 or no exact hit never suppresses escalation.

Two limits remain explicit. First, an internal address read in the sending mailbox is discarded before it reaches the
store (`packages/core/src/taint.ts:296-305`), so a compromised colleague who writes only to that mailbox leaves no
exact-address tripwire. That protection is narrower than previously claimed and is pre-existing, not weakened here.
Second, an address recorded while external remains until the seven-day prune even if an approved config change later
adds its domain to `internalDomains` (`packages/core/src/taint.ts:260-270, 307-325, 341-349`). In that transition the
exact stored address can still escalate; the explanation says why.

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
  `approvedAt` and `usableUntil`; `sending` has `sendingAt` and derived `unknownAt`; `expired` has persisted
  `expiredAt` and `approvedAt` when approval happened first; `used` has `sendingAt`, `sentAt` and a non-empty
  `sentMessageId`; `failed` has `sendingAt` and `failedAt`; `unknown` has `sendingAt` and derived `unknownAt`; and
  `revoked` has `revokedAt`. These states carry their honest reasons. `corrupt` carries an integrity reason and is
  never claimable. A download uses `pending`, `answered`, `expired`, `revoked` and `corrupt`, with no `usableUntil`.
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
- A provider success response with no non-empty id is reported exactly as **“sent; the provider returned no id”**,
  never `used` and never “sent, message id …”. The record remains `sending` and becomes final `unknown` at its stale
  boundary. This closes the current empty-string paths in Gmail and Slack
  (`packages/gmail/src/gmail-api/transport.ts:533-546`; `packages/slack/src/operations/send.ts:771-775`).
- Every sender-controlled string in an approval, status or list object uses the channel's untrusted-field envelope.
  In Gmail that means `wrapField` for prose, `addressField` for strict addresses and `filenameField` for attachment
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
  or “sent, message id …” without a non-empty provider id; the only no-id success wording is “sent; the provider
  returned no id”. They never turn `SEND_OUTCOME_UNKNOWN` into an automatic new preparation, tell the person to check
  Sent/the channel first, and surface `corrupt` instead of treating it as absent.

### D9. An expired draft is reported as not sent through agentcomms

A Gmail draft belongs in the `unsent` section when the bounded scan below finds at least one send approval from the
last seven days for the same mailbox and draft, none in that group is an `approved` record with `claimable: true` or
is `sending`, `used` or `unknown`, and the newest relevant record is `expired`. Expiry is stored directly as
`expired`; no revoke reason stands in for it. Declined, cancelled, otherwise revoked, parseable-corrupt and unreadable
records never masquerade as expiry.

The claim is deliberately local: **“not sent through agentcomms (its approvals expired)”**. Approval records cannot
prove what another Gmail client did. At report time the operation performs a live `drafts.get` for that mailbox and
draft — the existing transport operation is a provider read (`packages/gmail/src/gmail-api/transport.ts:509-513`):

- if the lookup finds it, the result may add **“still in Drafts”**;
- if Gmail returns no draft, it says **“no longer in Drafts — it may have been sent or deleted elsewhere”**;
- if the lookup fails, it reports the lookup failure and keeps only the local “not sent through agentcomms” claim.

`agent-gmail send list` / `gmail_send_list` gains the `unsent` section, with recipients, subject and attachment names
through D8's untrusted-field rules, the last preparation and expiry, the live Drafts result, and the one prepare call.
The existing `agent-gmail draft show` / `gmail_draft_get` → `getDraft` and `agent-gmail draft list` /
`gmail_draft_list` → `listDrafts` use the same wording; `agent-gmail doctor` / `gmail_doctor` → `doctor` counts
the bounded last-seven-days result and points to the list (`capabilities.json:501-514, 550-555, 755-760`). A truncated
doctor count is labelled as a lower bound. Reporting creates, sends and deletes nothing.

Slack's local draft inference is keyed by **workspace/account id, draft id, exact revision, and exact digest**, not
draft id alone and not revision or digest. Both must match. A `used` revision A never hides an expired revision B, and
an expired A never hides a `used` B; different revisions with identical content remain separate. Every saved revision
is new and the post approval already binds revision plus digest
(`packages/slack/src/operations/drafts.ts:151-190`; `packages/slack/src/operations/send.ts:446-469, 728-746`). The
existing `agent-slack draft list` / `slack_draft_list` may annotate the current revision; Resend and every historical
Slack approval remain visible through core `approvals list`. No Resend or Slack list surface is added
(`capabilities.json:29-34, 1199-1204`).

**Bounded scan, with no index or migration.** The report enumerates approval filenames and filesystem metadata, sorts
them by modification time descending with approval id as the stable tie-breaker, and opens at most the **500 most
recently modified approval files**. It then validates/classifies them, filters to the requested mailbox/account and
the last seven days, and groups matching records by draft so repeated approvals produce one result. Gmail's group key
is mailbox id plus draft id; Slack's is the exact four-part key above. Existing v1 records participate directly from
their files through a read-only legacy decoder, so there is no index to backfill and no record migration. They remain
unclaimable under D1's version rule, are interpreted only with their original creation-relative lifetime, and never
gain v2 timestamps; a structurally valid expired v1 record may still support the historical local “not sent through
agentcomms” inference. Invalid or truncated files follow D2's corrupt contract and are not unsent candidates.

Eligible draft groups are ordered by their newest relevant approval, newest first. A report returns at most **20**
such drafts and performs no more than one live draft lookup for each: at most 20 provider reads total, with concurrency
**2**. The result sets an explicit `truncated` reason when more than 500 approval files existed, when qualifying
records may have fallen outside that window, or when more than 20 eligible draft groups were found. It says that the
report was cut short and that older unsent drafts may be absent; it never presents a capped result or doctor count as
complete. Provider lookup failures stay attached to their draft and do not raise the concurrency or call limit.

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
   therefore gets the full ordinary preview, and prior `sending`/`unknown` records do not block preparation.
5. **“Previously mailed” is bounded to 50 search hits.** Gmail's fuzzy search can put the exact match after 50 false
   hits. D4 then conservatively keeps the warning rather than claiming the recipient was found. This is a deliberate
   false negative and qualifies the ticket outcome stated in §1.

## 5. Tests owed

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
  Missing, non-finite, misordered, state-inappropriate or contradictory `sendingAt`, `sentAt`, `failedAt`, `revokedAt`
  and `expiredAt` are exercised in every applicable state. Tests prove pending and approved expiry persist the exact
  boundary as `expiredAt`, `unknownAt` is exactly `sendingAt + SENDING_STALE_MS` and is not stored, and equality at
  every boundary takes the later state. A read that persists expiry or final `unknown`, followed by clock rollback,
  process restart and another read, stays final; clock rollback after valid `used` and `failed` records also leaves
  their states unchanged.
- **D1 — content and concurrency:** two simultaneous claims after the former ten-minute boundary of a confirm route
  have one winner; a changed draft, changed expected recipients/account or drifted plan voids at claim; old-server tool
  calls stopped by the update gate and its pending-or-approved exception both end closed on the digest version.
- **D2:** every table row on every named surface, Slack files and reactions included; ownership is checked before
  routing; nonexistent, foreign, wrong-kind and pinned-away ids have byte-identical `NOT_FOUND` envelopes with
  `approval: null`, and a spy proves no foreign record was classified or rendered. Prepare-time `POLICY_NEVER`,
  invalid recipients, unsendable HTML and every other pre-creation failure also have no approval object. Confirm
  changes never form-elicit.
  Wrong codes one/two remain pending and three revokes with `APPROVAL_VOID`; decline revokes, cancel/dismiss does not.
  `APPROVAL_REQUIRED` never describes approved, expired, used, failed, sending, unknown, corrupt or revoked. Dedicated
  JSON/CLI/skill consumers branch on `SEND_OUTCOME_UNKNOWN`, exit 10/non-retryable, and prove they never prepare
  automatically. An approved send whose live policy becomes `never` reports `claimable: false` and claim refuses with
  `POLICY_NEVER`; the same policy check is applied consistently to approved changes where that policy exists.
- **D2 — provider truth:** inject a Slack failure before upload, during upload, after known upload and at the share
  call. Before a successful share each error says “nothing was posted”, and details preserve exact `uploaded` and
  `possiblyUploaded` disclosure. Ambiguous responses from Gmail, Resend, Slack messages, Slack file shares and Slack
  reactions immediately return non-retryable `SEND_OUTCOME_UNKNOWN` with `approval.state: sending`; zero-wait/list
  reports `sending` before the stale boundary and final `unknown` at equality. Gmail/Resend certain failures continue
  to say nothing was sent. For Gmail, Slack and Resend, provider success followed by a failed approval-store `used`
  write still returns outward success, and zero-wait/list later reports `sending` then `unknown`, never invented
  `used`. A new prepare is permitted during both states, but skill evaluations require checking Sent/the channel first
  and forbid an automatic prepare.
- **D3:** every result shape; `waitSeconds: 0`; default 30 and maximum 300; no poll beyond a pending or approved
  record's deadline; immediate `{state: pending, claimable: true}` for pending/chat; download `answered`/`expired`
  without `usableUntil`; timeout returns pending with the same id and actionability. A nonzero pending-confirm wait is
  proved to perform later polls instead of returning its first classified pending result. It stops as soon as approval
  becomes claimable, policy makes an approved record non-claimable, a terminal/expired outcome appears, cancellation
  arrives or time runs out. The only permitted byte changes are valid derived expiry or stale-send finalisation. A
  terminal approval ends a wait `{state: approved, claimable: true}` without changing the stored state again. State
  change versus timeout/cancellation is classified by the final locked read.
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
  match at 51 returns “not written”, explicitly locking in the accepted conservative false negative.
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
  final `unknown`; ordinary success cannot enter `used` with an empty id.
- **D8 — integrity and untrusted data:** malformed timestamps and unknown versions are `corrupt` through direct get,
  core list, channel list, zero-wait status and a nonzero wait — never skipped, claimable or called unsent. Separate
  fixtures cover invalid JSON, every truncated-JSON boundary, missing ownership/kind and wrong-shaped scalars/arrays.
  Unpinned core and channel lists/status/waits expose only `{ approvalId, state: "corrupt", reason }`; pinned lists omit
  them, pinned status/wait returns owner-hidden `NOT_FOUND`, and doctor reports the count. Hostile subjects, addresses,
  display prose and attachment filenames remain inside their untrusted envelopes in D8 and D9 list objects.
- **D9:** expired pending and expired-after-approval records say “not sent through agentcomms”; a later claimable
  approved, sending, used or unknown record prevents the inference; decline/cancel/revoke/corrupt is not relabelled
  expiry. A live Gmail draft adds “still in Drafts”; an external Gmail-UI send and an external deletion after approval
  expiry both produce “no longer in Drafts — it may have been sent or deleted elsewhere”, never “unsent” or “still in
  Drafts”. Provider lookup failure stays local-only. Send list, draft show/list and doctor create, send and delete
  nothing. Slack revision A `used` plus revision B `expired` still reports B; the inverse still reports A as used.
  Identical digests at different revisions remain separate in both directions because Slack requires exact revision
  **and** digest.
- **D9 — bounds and compatibility:** fixtures exceed 500 approval files across several mailboxes with controlled
  mtimes and repeated records per draft. The scan opens only the newest 500, filters after opening, groups each Gmail
  draft and exact Slack revision/digest once, orders newest groups first, returns at most 20, performs at most 20 live
  lookups with observed concurrency never above two, and reports every applicable cut-short reason. Existing on-disk
  v1 records are found through the read-only historical decoder without an index or migration, remain unclaimable and
  can support an expired inference. More than 20 qualifying drafts, more than 500 files, provider failures, unreadable
  records and a mailbox whose records fall outside the global 500-file window all preserve the stated
  lower-bound/truncation wording.
- **Acceptance, end to end with fake Gmail:** an internal colleague recorded in another mailbox, from an untrusted
  client, produces `recipient-tainted`, one chat prepare/preview, one standard terminal rendering and **one person
  decision**. The agent's `gmail_send_wait` returns `{state: approved, claimable: true}`; execute uses that record,
  with no second prepare and no second **chat** preview, and returns `sentMessageId`. Repeat with approval at minute 25
  and claim two hours later. An internal domain-only recipient does not taint and a chat route sends on the person's yes
  inside ten minutes. Replay the ticket's 22:42:46 prepare and 22:48:22 approval: wait learns it, the send succeeds, and
  no error asks again. With no claim, it says “not sent through agentcomms” 24 hours after approval and “still in
  Drafts” only after the live lookup. Preparing identical content again gets the full ordinary preview and is not
  blocked by the expired record or by a prior final `unknown` record.

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
   until pruned (`packages/core/src/taint.ts:260-270, 307-325, 341-349`). That conservative transition is explained.
5. **Eight waits is per process** — several CLI/server processes can exceed eight in aggregate. Each wait is bounded to
   one small read per second and at most its record's own lifetime; a global semaphore is out of scope.
6. **Fresh Claude Code has no in-chat confirmation** — terminal approval plus a wait is the honest path until the
   authenticated URL-mode design exists.
7. **`requiresUserInteraction` stays policy-derived** — a chat mailbox's escalated send reaches a person through the
   confirm route; making it unconditional would prompt every chat send
   (`packages/gmail/src/mcp/server.ts:2366-2374`).
8. **The unsent report is deliberately incomplete at scale** — the 500-file and 20-draft caps keep disk reads and
   provider calls bounded, but a busy shared store can push a mailbox's older records out of the scan. Every affected
   result and doctor count says it was cut short rather than claiming completeness.
