# CUE-404 — approving a send without fighting the clock — design

Status: **written 2026-10-05**, from Linear CUE-404 (High; the owner: "this is very not smooth") and a cited research
pass over this repository, the MCP specification and the clients' documentation. **Revised after Codex design review
round 2** (NEEDS-REVISION: 6 P1, 3 P2, 1 P3 — all addressed below). Depends on CUE-403 (the CLIs on PATH,
[its spec](2026-10-04-cli-path-shims-design.md)) for every printed terminal command to work; ships after it.

## 1. What was asked

Sending one email to an internal colleague from Claude Code in VS Code took four attempts and about twenty minutes:
the update approval expired while it was being read; the send escalated to `confirm` on `recipient-tainted` for a
colleague on the owner's own domain who had written to him; the client was "not on the list" so only a terminal could
approve; the terminal command did not exist (CUE-403); once approved at the terminal, nothing told the agent; four
minutes later the approved record expired unused and the send answered `APPROVAL_REQUIRED`, asking for the approval
just given. The ticket asks for: approved approvals not racing the clock; the agent learning about an approval without
being told; an accurate `APPROVAL_EXPIRED`; no escalation for internal or previously-mailed recipients on taint alone,
explained when it does fire; an in-chat approval route for Claude Code; the same for update approvals; and every
printed command runnable.

**Acceptance, made exact:** one internal email that triggers `confirm` has one prepare and one person decision. The
terminal approval prints the full content as the approval ceremony itself; there is no second preview in the chat.
The agent learns that the approval happened by waiting, sends with the same record, and no result asks for an approval
that was already given.

**The outcome, recorded on the ticket 2026-10-05:** the email was never sent. The first approval was approved at the
terminal at 22:48:22 and expired unused at 22:52:46 — ten minutes after it was *created*, four and a half after it was
approved — because the agent did not know it had been approved. The second expired pending. The draft stayed in
Drafts, and the owner, unable to see his approval's state from the chat, ended by asking whether it had gone. Three
acceptance criteria were added (D8–D10): **every send and status call returns the approval's real state** (pending,
approved, expired before or after approval, used and sent with its message id); **a draft whose approvals all expired
is reported as unsent**, not left silently in Drafts; **re-preparing an identical digest does not require showing the
full preview again**.

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
| `clientInfo` is self-reported and elicitation defines a client/server exchange, not a proof that a person answered. Only URL-mode elicitation keeps the person's answer from the client and model. | MCP elicitation specification 2026-07-28; TypeScript SDK migration notes; `SECURITY.md:67-68` |
| The taint store is shared across mailboxes. It records canonical addresses and non-public domains from mail read in the last seven days, excluding the reading mailbox's own addresses and current `internalDomains`. An entry aggregates the newest timestamp, the strongest source ever seen (`header` over `body`) and the union of mailbox ids; it does not retain one coherent sighting. | `packages/core/src/taint.ts:260-270, 277-325, 341-349`; `packages/gmail/src/operations/read.ts:243-250` |
| A new mailbox's `internalDomains` defaults to its own non-public domain, and widening it is a gated loosening. With static configuration, an exact internal address can enter the shared taint store only through a mailbox where it is external. An address recorded while external can nevertheless remain for the seven-day window after `internalDomains` is widened, because reads prune stored entries by time and `check()` does not reapply the recording exclusions. | `packages/core/src/config.ts:1293-1297, 1425-1446`; `packages/core/src/taint.ts:260-270, 296-325, 341-349` |
| Send time currently escalates on `seen.address \|\| seen.domain` unless this mailbox has written to the exact address. The sent-history check currently asks only for five fuzzy `in:sent to:<address>` hits, then verifies their parsed To/Cc/Bcc fields exactly; it does not paginate. | `packages/gmail/src/operations/send.ts:202-221, 240-275` |
| Terminal send approval currently re-renders the full preview, asks for the challenge, and only approves; it does not send. | `packages/gmail/src/cli/program.ts:1345-1356` |
| Approval records currently carry `digestVersion: 1`; every locked transition refuses another version with “prepared by a different version of agent-communications,” after persisting any derived state it observed. | `packages/core/src/approvals.ts:292-306, 570-588` |
| The existing update gate stops a non-exempt tool on an older server after a newer release is known, while deliberately allowing a call that carries an approval this machine already holds; the approval store's digest-version check remains the backstop for that allowed call. | `packages/core/src/update-gate.ts:126-154`; `packages/core/src/update-state.ts:273-302` |
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
  expired.
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
by new code either. The update gate also stops non-exempt calls once it knows a newer release is installed; its narrow
already-approved-call exception is safe because the digest-version refusal still runs
(`packages/core/src/update-gate.ts:126-154`; `packages/core/src/update-state.ts:273-302`).
Because released 0.13.0 derives expiry before checking the version, an already-approved-call exception made through
old code after the v2 pending deadline may conservatively persist `expired` and then refuse; it can destroy usability,
but cannot send or extend the record (`packages/core/src/approvals.ts:512-530, 570-588`). Restarting into the installed
release avoids that fail-closed mixed-process casualty.

**Version-2 timestamps fail closed.** Every read validates these exact invariants before classifying the record:

- `createdAt` and `expiresAt` are finite, and `expiresAt` equals `createdAt + 10 min` for a chat route,
  `createdAt + 30 min` for a confirm route, or `createdAt + 30 min` for a download;
- an approved send/change has finite `approvedAt`, with
  `createdAt <= approvedAt <= expiresAt` and `approvedAt <= now`, and finite `usableUntil` exactly 24 hours after
  `approvedAt`;
- `now < createdAt` and, for an approved record, `now < approvedAt` are expired, as is any missing, unparseable or
  inconsistent timestamp; a pending record expires at `now >= expiresAt`, and an approved send/change at
  `now >= usableUntil`.

Expiry is monotonic. Any read that derives `expired` takes the record lock and persists that state before returning;
this extends the locked transition's existing write-back rule (`packages/core/src/approvals.ts:570-588`) to `get`,
list, status and wait. A later clock correction cannot revive it. A wait is therefore read-only except that it persists
an expiry it observes.

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
foreign, wrong-kind or pinned away all return the identical `NOT_FOUND` code, message and details.

| Record and context | Outcome |
|---|---|
| nonexistent, foreign, wrong-kind or pinned-away id | `NOT_FOUND`, identically; no record detail |
| pending send/change, `chat` route, effective live policy still `chat` | `claimable`; a wait returns that immediately |
| pending send, `confirm` route (or a chat route tightened to `confirm`), trusted client | show the form; accepted correct code approves; explicit decline atomically revokes with reason `declined`; cancel/dismiss leaves pending and returns `APPROVAL_PENDING` |
| pending send that needs `confirm`, untrusted client | `APPROVAL_REQUIRED`, with the resolved terminal command and matching wait tool |
| pending `confirm` change | `APPROVAL_PENDING`, with the terminal command and wait tool; changes are terminal-only and never raise a form, as the current claim already enforces (`packages/core/src/approvals.ts:889-903`) |
| wrong code, attempts one or two | record remains pending; `APPROVAL_REQUIRED` |
| wrong code, attempt three | atomically revoked; `APPROVAL_VOID`, “too many wrong codes” (the existing transition has the same boundary at `packages/core/src/approvals.ts:704-716`) |
| approved send/change, before `usableUntil` | `claimable` |
| expired before approval | `APPROVAL_EXPIRED`: prepared at …, expired at …; prepare again |
| approved, then expired unused | `APPROVAL_EXPIRED`: approved at …, expired unused at …; prepare again |
| `sending`, inside the stale limit | `APPROVAL_VOID`: being used by another call since … |
| `unknown` after the stale-send limit | `SEND_OUTCOME_UNKNOWN`: the send may have happened; check Sent/the channel before doing anything else |
| `used` | `APPROVAL_VOID`: already used at …, with the sent message id where there is one |
| `failed` | `APPROVAL_VOID` with channel-specific truth. Gmail/Resend certain failures say nothing was sent. A Slack file failure says **“nothing was posted”** and preserves `uploaded` and `possiblyUploaded` ids/names because bytes may already have reached Slack (`packages/slack/src/operations/send.ts:1016-1018, 1032-1035, 1088-1111, 1137-1172`) |
| `revoked` | `APPROVAL_VOID` with its reason; an explicit decline is “declined”, while cancellation is not a revoke |
| download pending | `pending` until answered, expired or a wait times out; under `chat` the answer may be relayed, under `confirm` it comes from the terminal or trusted form |
| download `approved` or `used` | `answered`, with the recorded destination choice and original creation-relative expiry; never `approved` with a `usableUntil` |
| download `expired` | `expired` / `APPROVAL_EXPIRED`: the question expired before it was answered or used; current download state handling is separate already (`packages/core/src/approvals.ts:591-607, 972-1004`) |

`SEND_OUTCOME_UNKNOWN` is added to the one registry with exit **10**, `retryable: false`, and summary **“the send
outcome is unknown; check before sending again”**. Exit 10 is the existing approval/send-refusal class, while the
distinct code prevents consumers from following `APPROVAL_VOID`'s global “prepare again” summary
(`packages/core/src/errors.ts:6-24, 58-115`). No skill or machine consumer may automatically prepare after it.

The classifier runs **inside each locked transition**. Approve, claim, revoke and form resolution read, derive,
validate, classify and write beneath the same record lock. Inspect/status/wait use the same locked read so that expiry
write-back is atomic. There is no pre-lock state classification that a concurrent claim can contradict.

### D3. Waiting for an approval: short, bounded and on every surface

`waitForApproval(approvalId, { waitSeconds, signal, owner })` never claims, revokes or executes. It checks ownership
and kind first, polls one small approval file at most once a second through D2's locked read, and stops at the earliest
of a classified result, the requested duration, or the record's own pending/usable expiry. `waitSeconds` defaults to
30, has a maximum of **300**, and `0` is status now. A pending, directly claimable chat-route send/change returns
`claimable` immediately. A download returns `answered` when approved/used and `expired` when expired, not the
send/change `approved` shape.

The result set is: `claimable`, `approved` (with `usableUntil`), `expired`, `revoked`, `used`, `failed`, `unknown`,
`answered` (downloads), `not-found`, `pending` (timed out, with the same id) and, when it can be delivered,
`cancelled` (the wait, not the approval). Progress is sent every 15 seconds when the caller supplied a progress token.

At most **8 waits per server or CLI process** run at once; a ninth gets `TRANSIENT` “too many waits”. This bounds one
process's resources, not all processes sharing the store: each slot costs one small file read per second. Every exit
path — success, timeout, cancellation, exception and client disconnect — releases its slot in `finally`. Cancellation
guarantees only that the waiter is released and the record is untouched apart from an expiry that the final locked
read observed and persisted. Delivery of a `cancelled` result to a client that disconnected is best effort.

Surfaces, each a CLI and MCP pair calling that same operation, with `capabilities.json` rows naming it as their
`operation`: `agentcomms approval wait <id>` / `comms_approval_wait` (changes and every kind);
`agent-gmail send wait <id>` / `gmail_send_wait`; `agent-resend send wait <id>` / `resend_send_wait`;
`agent-slack approval wait <id>` / `slack_approval_wait` (posts, files and reactions). Every refusal that sends a
person to a terminal names the matching wait tool. Because clients may background or limit long calls, the skills
recommend repeated default-length waits rather than one maximum-length call.

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

**Previously mailed means exactly checked.** `hasWrittenTo` uses
`in:sent {to:<canonical-address> cc:<canonical-address> bcc:<canonical-address>}` and paginates until it has checked
exactly 50 hits or Gmail has no next page. Each hit still has its parsed To/Cc/Bcc compared to the exact canonical
address because Gmail search is fuzzy. This replaces the current five-hit, unpaginated check
(`packages/gmail/src/operations/send.ts:202-221`) and stays conservative: provider doubt or no exact hit means
“not written”.

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
- The terminal approval prints the full content once and asks for the challenge: that rendering **is the approval**,
  not a second chat preview. The current terminal already renders and then approves without sending
  (`packages/gmail/src/cli/program.ts:1345-1356`). The agent does not prepare again or show the preview again in chat.
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

The current record stores `sentMessageId` when a send completes and its list reads the stored JSON records
(`packages/core/src/approvals.ts:1068-1075, 1085-1103`). This design makes that state consistently visible:

- Every send-path result — success and refusal, on every surface D2 lists — carries
  `approval: { id, state, route, … }`: `pending` (with `expiresAt` and what is needed), `claimable`, `approved`
  (`approvedAt`, `usableUntil`), `expired` (`expiredAt` and `approvedAt` if it had been approved), `used` (`sentAt`,
  `sentMessageId`), `failed`, `unknown` (with where to check), or `revoked` (reason). A success says “sent, message id
  …”. A download uses `pending`, `answered`, `expired` and `revoked`, with no `usableUntil`.
- **Status at any time:** a wait with `waitSeconds: 0` answers immediately with the same object. `send list` /
  `gmail_send_list` and each channel's list return that object per approval, with the draft/prepared message it belongs
  to.
- Skills call status or wait before saying anything about a send they did not just complete. They never say “sent”
  without a `sentMessageId`, and never turn `SEND_OUTCOME_UNKNOWN` into a new preparation.

### D9. A draft whose approvals all expired is reported as unsent

A draft is **unsent** when it has at least one send approval, none is usable `approved`, `sending`, `used` or
`unknown`, and its newest relevant record is `expired` (or was revoked only to persist an expiry reason). A declined,
cancelled or otherwise revoked record does not masquerade as expiry. This is derived from retained records, keyed by
mailbox and draft id.

- `send list` / `gmail_send_list` gain an `unsent` section: each such draft with its recipients and subject through the
  existing untrusted-field mechanism (`packages/gmail/src/domain/untrusted-fields.ts:39-63`), last preparation, last
  expiry, and the one call that prepares again. `draft get` / `draft list` mark it “prepared to send, not sent —
  approval expired at …”.
- Every reported send expiry says “not sent; the draft is still in Drafts” and gives the same one call. `doctor`
  counts unsent drafts from the last seven days, per mailbox, with the list command.
- Reporting creates, sends and deletes nothing.
- Resend and Slack have no Gmail draft in this sense; their expired prepared sends appear in their send lists, and
  Slack drafts in `slack_draft_list`.

### D10. A short repeat preview requires proof that a person saw the full content

When `send prepare` produces a v2 digest equal to an earlier approval for the same mailbox and draft, prepared in the
last 24 hours, a short chat preview is allowed **only if** that earlier record:

1. reached `approved` through a channel that rendered its full content to a person — terminal or a trusted send form;
2. then expired unused, or was revoked solely to persist an expiry reason; and
3. was never `used`, `sending` or `unknown`.

The new approval is still created normally, with its own route and lifetimes and freshly computed policy/risk checks.
Its result adds `unchangedSince: { approvalId, preparedAt, approvedAt }` and a short preview: recipients, subject
(untrusted fields), attachment names and sizes, the digest's first 12 characters, and “the same content you approved
at `<approvedAt>`”. The full preview remains in the result and is offered.

A record that merely expired pending is never a baseline: neither is one that was created but never displayed, was
declined, came from a cancelled/dismissed form, or was revoked for any non-expiry reason. The digest proves sameness;
the prior `approved` transition proves that a full terminal/form rendering was acted on. Exclusions keep their full
preview and reason:

- an earlier identical digest that was **used** sets `duplicateOf`, says when and with which message id it was already
  sent, and shows the full preview;
- `sending` or `unknown` is refused until its outcome is known;
- older than 24 hours, another draft/mailbox, v1/unknown version, or any ineligible end state gets the full preview.

Terminal approval always prints the full content, even when the chat was allowed the short repeat preview. The skill
may show the short preview only for the eligible case above, says which prior approval it repeats, and offers the full
one.

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

## 5. Tests owed

Each guard is watched failing under a mutation, then restored.

- **D1 — routes and time:** chat-route sends and changes expire at ten minutes; confirm-route sends/changes (including
  escalated sends) at thirty; equality is expired. Route is stored and digest-bound. A confirm route never directly
  claims after policy loosens; a chat route claims only while the effective policy stays chat and waits when tightened.
  Approved sends/changes survive their pending deadline and expire exactly 24 hours after approval. Downloads expire
  thirty minutes from creation before or after answer and never gain `usableUntil`.
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
  unknown versions; non-finite
  `createdAt`/`expiresAt`; wrong exact pending lifetime; missing/non-finite `approvedAt`; approval before creation,
  after pending expiry or in the future; inconsistent `usableUntil`; and boundary equality all fail closed. A read
  that expires and persists a record followed by clock rollback, process restart and another read stays expired.
- **D1 — content and concurrency:** two simultaneous claims after the former ten-minute boundary of a confirm route
  have one winner; a changed draft, changed expected recipients/account or drifted plan voids at claim; old-server tool
  calls stopped by the update gate and its already-approved exception both end closed on the digest version.
- **D2:** every table row on every named surface, Slack files and reactions included; ownership is checked before
  routing; nonexistent, foreign, wrong-kind and pinned-away ids have byte-identical `NOT_FOUND` envelopes. Confirm
  changes never form-elicit. Wrong codes one/two remain pending and three revokes with `APPROVAL_VOID`; decline revokes,
  cancel/dismiss does not. `APPROVAL_REQUIRED` never describes approved, expired, used, failed, sending, unknown or
  revoked. Dedicated JSON/CLI/skill consumers branch on `SEND_OUTCOME_UNKNOWN`, exit 10/non-retryable, and prove they
  never prepare automatically.
- **D2 — provider truth:** inject a Slack failure before upload, during upload, after known upload and at the share
  call. Before a successful share each error says “nothing was posted”, and details preserve exact `uploaded` and
  `possiblyUploaded` disclosure; an ambiguous share is `unknown`, not failed. Gmail/Resend certain failures continue
  to say nothing was sent.
- **D3:** every result shape; `waitSeconds: 0`; default 30 and maximum 300; no poll beyond a pending or approved
  record's deadline; immediate `claimable` for pending/chat; download `answered`/`expired` without `usableUntil`;
  timeout returns pending with the same id. The only permitted byte change is persisted expiry. A terminal approval
  ends a wait `approved`. State change versus timeout/cancellation is classified by the final locked read.
- **D3 — resources and cancellation:** the ninth simultaneous wait in one process is refused. Success, timeout,
  caller cancellation, thrown read/classification error and MCP disconnect each release the slot, proven by an eighth
  replacement wait. Cancellation leaves the record untouched apart from persisted expiry; the disconnect test expects
  no result delivery while still proving waiter cleanup. No progress token means no progress. Foreign/pinned ids are
  not found. Every CLI/MCP pair passes parity against the same operation.
- **D3 — client smoke matrix (manual, informational):** Claude Code main conversation, subagent, IDE, noninteractive
  and a configured background threshold, recording whether calls foreground, background or limit. No observed timing
  becomes a protocol constant; each scenario completes through repeated short waits.
- **D4:** exact internal address from another mailbox (header and body), exact external, domain-only internal,
  domain-only external, and both exact/domain present — exact wins the explanation; written-before suppresses each;
  public-provider domains never match by domain. `hasWrittenTo` finds an exact address on hit 6 and hit 50 across
  pages, stops at exactly 50, rejects fuzzy hits, and uses To/Cc/Bcc query terms.
- **D4 — provenance and gaps:** same-mailbox internal addresses are omitted; another mailbox can record the same
  address; widening `internalDomains` leaves an already-recorded exact address until day seven. An old header in
  mailbox A plus a recent body sighting in mailbox B is described only as separate aggregate facts, never one
  sighting. Address/domain payloads that look like instructions are canonicalised or wrapped as untrusted; mailbox
  ids/date/template stay trusted. Removed mailbox, exact/domain precedence, public-domain behavior, lookalike and
  attachment flags are covered.
- **D5:** the untrusted refusal names the resolved terminal command and wait tool and does not advertise the trust
  list. No surface says “known to reach a person”. The terminal test asserts the full preview bytes appear once there,
  approval does not send, and the agent's wait observes `approved`.
- **D8:** every send-path success/refusal carries the state object; “expired after approval” when `approvedAt` exists;
  success carries `sentMessageId`; wait/status/list agree; downloads use their own state fields; CLI/MCP status pairs
  have parity.
- **D9:** only expired pending is unsent; expired after approval is unsent; a later usable approved, sending, used or
  unknown approval prevents it; decline/cancel/non-expiry revoke is not relabelled expiry. Lists, draft get/list and
  doctor report it without creating, sending or deleting; Resend prepared sends and Slack drafts match their design.
- **D10:** eligible terminal and trusted-form baselines produce `unchangedSince` and the short chat preview after
  expiring unused or an expiry-only revoke. A baseline merely created but never displayed, expired pending, declined,
  cancelled/dismissed or otherwise revoked always gets the full preview. One-character body change, Bcc change, or
  renamed/changed attachment gets full preview. Used sets `duplicateOf` and full preview; sending/unknown refuses;
  24 hours and one second, another draft/mailbox and v1/unknown versions get full preview. Fresh risk/policy checks can
  escalate the new record. Terminal approval always prints the full content.
- **Acceptance, end to end with fake Gmail:** an internal colleague recorded in another mailbox, from an untrusted
  client, produces `recipient-tainted`, one chat prepare/preview, one full terminal rendering and **one person
  decision**. The agent's `gmail_send_wait` returns `approved`; execute uses that record, with no second prepare and no
  second **chat** preview, and returns `sentMessageId`. Repeat with approval at minute 25 and claim two hours later. An
  internal domain-only recipient does not taint and a chat route sends on the person's yes inside ten minutes.
  Replay the ticket's 22:42:46 prepare and 22:48:22 approval: wait learns it, the send succeeds, and no error asks again.
  With no claim, it becomes unsent 24 hours after approval; reprepare then gets D10's short preview only because that
  prior terminal approval rendered the full content.

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
