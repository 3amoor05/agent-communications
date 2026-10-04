# CUE-404 — approving a send without fighting the clock — design

Status: **written 2026-10-05**, from Linear CUE-404 (High; the owner: "this is very not smooth") and a cited research
pass over this repository, the MCP specification and the clients' documentation. **Revised after Codex design review
round 1** (NEEDS-REVISION: 5 P1, 5 P2, 1 P3 — all addressed below). Depends on CUE-403 (the CLIs on PATH,
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
printed command runnable. **Acceptance:** one internal email that triggers `confirm` takes one approval, with no
re-prepare, no second preview, the agent learning of the approval itself, and no error asking for an approval already
given.

## 2. What is true, and was checked

| Fact | Source |
|---|---|
| Send and change approvals live `APPROVAL_TTL_MS` = 10 minutes; download questions (`kind: download`) already live 30. | `packages/core/src/approvals.ts:54, 401, 407, 921` |
| Expiry is derived for `pending` **and `approved`** records, so an approved record expires unused. | `approvals.ts:512` |
| Under the `chat` policy a pending send or change is claimable directly by the presenting process; under `confirm` it needs `approved` first. | `approvals.ts:725, 872` |
| Core's state error maps an expired record to `APPROVAL_EXPIRED` and a revoked one to `APPROVAL_VOID`, but answers `APPROVAL_REQUIRED` ("the approval is <state>") for `used`, `sending`, `failed` and `unknown`; changes waiting for a person answer `APPROVAL_PENDING` (`change-flow.ts:219`). Gmail's execute turns every state other than pending/approved into `APPROVAL_VOID`, and the MCP send path's `needsConfirmation` routes an expired record to confirmation, so an untrusted client gets `APPROVAL_REQUIRED`. Other legitimate `APPROVAL_REQUIRED` cases: a missing or wrong confirmation code, a declined or cancelled form. There is no `APPROVAL_USED` code. | `approvals.ts:591, 682`; `packages/gmail/src/operations/send.ts:569`; `packages/gmail/src/mcp/server.ts:2274, 2411`; `packages/core/src/errors.ts:32` |
| The shipped Gmail skill documents those wrong outcomes, and says to mention the trust list only when the person asks. | `skills/gmail-send/SKILL.md:129, 180` |
| "Clients whose approval forms are known to reach a person" is `defaults.confirm.elicitationClients`: an empty-by-default list of MCP `clientInfo.name`s the person adds by an approved change after a four-character probe; only the name is checked at send time. | `packages/core/src/config.ts:103, 431`; `packages/gmail/src/mcp/server.ts:2285, 2388`; `packages/gmail/src/operations/confirm-clients.ts:27, 89, 111` |
| `clientInfo` is self-reported (the SDK says not to use it for security); elicitation is answered by the client (no interaction model is mandated; Claude Code hooks can answer forms; this repository's own test answers the probe automatically). Only URL-mode elicitation keeps the person's input from the client and model. | MCP spec 2025-06-18 and 2026-07-28 (client/elicitation); ts.sdk.modelcontextprotocol.io migration notes; code.claude.com/docs/en/mcp; `packages/gmail/test/mcp-send.test.ts:168`; `SECURITY.md:67` |
| The taint store is one store for every mailbox. It records the addresses (and non-public domains) in the headers and bodies of mail read in the last seven days, **leaving out the reading mailbox's own address and every address on that mailbox's `internalDomains`**, with per-message and total caps. Each entry keeps the last time seen, the strongest source (`header` over `body`) and the ids of the mailboxes that read it — no message id. `check()` answers two booleans. | `packages/core/src/taint.ts:11, 170, 203, 277, 299, 342` |
| A new mailbox's `internalDomains` defaults to its own domain unless that is a public provider; widening it is a gated loosening. So an internal colleague is escalated today only through a sighting **in another mailbox** (where that domain is external) or a domain-only match — never through mail read in the sending mailbox itself. | `packages/core/src/config.ts:1293, 1443`; `packages/gmail/src/operations/read.ts:244` |
| Send time escalates on `seen.address \|\| seen.domain` unless the sending mailbox has written to that exact address (`in:sent to:`, then an exact To/Cc/Bcc check); `external` (not own, not on the sending mailbox's `internalDomains`) is computed but not applied to taint. | `packages/gmail/src/operations/send.ts:209, 240, 263, 268, 274` |
| Claude Code idles out a stdio MCP call after 30 minutes without progress, and moves a main-conversation call over two minutes into a background task. | code.claude.com/docs/en/mcp (read 2026-10-05) |
| The base design treats a hostile process running as the same OS user as out of scope (it can read the tokens). | `docs/superpowers/specs/2026-09-18-agent-communications-design.md` (threat model); `SECURITY.md:55` |

## 3. Decisions

### D1. Lifetimes: pending for 30 minutes, approved held for 24 hours, by record version

- **New records carry `lifetimeVersion: 2`** from creation. Only version-2 records get the new rules; a record
  without it keeps exactly its old `expiresAt` semantics, whatever its state, so a mixed-release store or an
  older record never gains time.
- **Pending: 30 minutes**, for sends (Gmail, Resend, Slack posts, files and reactions) and changes (`comms_update`,
  `comms_change_policy`, every gated change). The threat argument: under `chat`, the presenting process can already
  prepare a fresh record and claim it at once, so a longer pending lifetime grants no capability the agent lacks; it
  only stops a preview expiring while a person reads it. Under `confirm`, a pending record is useless to the agent
  until a person approves it. Download questions keep 30 minutes.
- **Approved: usable for 24 hours after approval** (`usableUntil = approvedAt + 24 h`), then expired unused. Still
  single-use (state transition plus the exclusive claim marker), and still checked at claim against everything it is
  bound to — the draft's message id and digest, the claimed-draft and final-draft rechecks, the inbox/account/workspace,
  the expected recipients and subject, the change plan's effects — so an edit or a drifted plan voids it.
- **Timestamps fail closed:** a version-2 record is expired when `approvedAt` is missing for an approved state,
  unparseable, before `createdAt`, after now (clock moved back), or when `usableUntil` is not exactly `approvedAt` +
  24 h; boundary equality counts as expired; `now < createdAt` stays expired as today.
- **Accepted risk, stated:** an approved record can be claimed by any process sharing the store for up to 24 hours;
  approvals are not bound to the process that prepared them. A hostile same-user process is out of the threat model
  (it can read the tokens directly); within it, the content binding means whoever claims sends exactly what was
  approved, once. `send cancel` revokes. The final Gmail read-to-send micro-race is pre-existing and unchanged.
- **Not done:** the terminal `approve` does not send. That would put a second sending process outside the server that
  prepared the draft, and the agent could not report the outcome.

### D2. One classification of a record into an outcome, complete

Core exports `approvalOutcome(record, context)`, where `context` is the action (approve, claim, wait, revoke,
inspect), the caller's kind and ownership (account/workspace/inbox pin), the effective policy, whether the client is
trusted, and any challenge given. Every surface uses it — Gmail terminal begin/finish, Gmail execute's precheck and
`claimForSend`, the claimed-draft and final-draft rechecks, Gmail MCP routing (pin check, confirmation routing,
untrusted refusal, form decline/cancel, finish, execute), Resend (ownership, precheck, claim, terminal), Slack post,
file and reaction (precheck, claim), changes (`claimForChange`, every gated change, terminal begin/finish), and
downloads — and checks ownership first, then finished and expired states, and only then confirmation routing:

| Record state | Outcome (existing codes only) |
|---|---|
| not found, or another account's/kind's | `APPROVAL_VOID` "no such approval here" (pinned callers learn nothing about other mailboxes' records) |
| `pending`, `chat` | claimable |
| `pending`, `confirm`, trusted client | form; declined/cancelled/wrong code → `APPROVAL_REQUIRED` with what to do |
| `pending`, `confirm`, untrusted client | sends: `APPROVAL_REQUIRED`; changes: `APPROVAL_PENDING` (each as today) — with the resolved terminal command (CUE-403) and the wait tool (D3) |
| `approved`, within `usableUntil` | claimable |
| expired, never approved | `APPROVAL_EXPIRED`: prepared at …, expired at …; prepare it again |
| approved, then expired unused | `APPROVAL_EXPIRED`: approved at …, expired unused at …; prepare it again |
| `sending` (fresh) | `APPROVAL_VOID` "being used by another call since …" |
| `unknown` (a `sending` record past the stale limit, `approvals.ts:530`) | `APPROVAL_VOID` "the send it approved may have gone out at …; check <Sent / the channel> before preparing it again" — never a retryable code, because a retry could send twice |
| `used` | `APPROVAL_VOID` "already used at …" |
| `failed` | `APPROVAL_VOID` "the send failed at … and nothing went out; prepare it again" |
| `revoked` | `APPROVAL_VOID` with the recorded reason (draft changed, cancelled, plan drifted) |

`APPROVAL_REQUIRED` never answers an approved, expired, used, failed, sending, unknown or revoked record. The Gmail
skill's outcome table and every channel's skill are corrected to match.

### D3. Waiting for an approval: one read-only operation, a CLI and MCP pair on every surface

`waitForApproval(approvalId, { waitSeconds, signal, owner })`: read-only — never claims, revokes or executes. It checks
ownership first (the caller's account/workspace/inbox pin and kind; an id that is not the caller's is reported exactly
as "not found"), then polls the record every second with an atomic read, and returns as soon as the record leaves
`pending`, or after `waitSeconds` (default 30, maximum 110 — below Claude Code's two-minute move to the background).
No file watchers. At most 8 concurrent waits per server process; a ninth is refused with `TRANSIENT` "too many
waits". Progress is sent every 15 seconds when the caller gave a progress token. Cancellation stops the wait only;
a final read decides a race between a state change and cancellation or timeout.

The result is one of: `approved` (with `usableUntil`), `expired`, `revoked`, `used`, `failed`, `unknown`,
`not-found`, `pending` (timed out; same id), `cancelled` (the wait, not the approval).

Surfaces, each a CLI and MCP pair calling that operation, with `capabilities.json` rows: `agentcomms approval wait
<id>` / `comms_approval_wait` (changes and every kind); `agent-gmail send wait <id>` / `gmail_send_wait`;
`agent-resend send wait <id>` / `resend_send_wait`; `agent-slack approval wait <id>` / `slack_approval_wait` (posts,
files and reactions). Every `APPROVAL_REQUIRED` that sends the person to a terminal names the matching wait tool.

### D4. `recipient-tainted`: an exact sighting still escalates; an own-domain match alone does not; it says why

The attack this flag stops is an instruction hidden in mail that names an address to send something to. The decision
becomes:

```
tainted = (seen.address || (seen.domain && external)) && !hasWrittenTo(exact address)
```

that is:

- an **exact address seen in mail read in any mailbox** still escalates, internal or not, unless the sending mailbox
  has written to it before. A compromised, attacker-created or wrong internal address that reached the store — which,
  by the recording rule, means it was read in a mailbox where that domain is not internal — is still caught. Whether
  the address appeared as a sender or inside a message is not used: a colleague who wrote to you and a compromised
  colleague account that wrote to you leave the same trace, and exempting senders would also remove today's
  escalation of a first-time reply to an external sender on a public provider;
- a **domain-only** match (another address at the same non-public domain was seen) escalates only when the recipient
  is external to the sending mailbox. The sending mailbox's own `internalDomains` no longer escalate on a domain
  match — consistent with the recording rule, which never records internal addresses read in that mailbox at all.

The ticket's ask ("no escalation for internal recipients on taint alone") is met for domain-only matches and stays
deliberately unmet for an exact cross-mailbox sighting; that case is explained and made smooth (D1–D3, D5) instead —
which is what the acceptance requires: when `confirm` triggers, it takes one approval.

**Saying why, from trusted data only.** `TaintStore.check()` also returns, for whichever sighting matched, the
entry's last-seen time, its source (`header` | `body`) and the reading mailboxes' ids — all already stored, all
written by this software, none sender-controlled. No store schema change. The preview and result then say, in
trusted words: "<address> appeared in <a header | the body> of mail read in <mailbox names>, last on <date>. An
instruction hidden in a message can ask an agent to send to an address it contains, so this send needs your
confirmation. Sending to it once from this mailbox means later sends to it are not flagged." For a domain-only match:
"other addresses at <domain> appeared in mail read in …". A mailbox id that no longer resolves is named "a mailbox no
longer connected". No message id, sender, subject or display name is shown, so nothing in the explanation needs the
untrusted envelope. Every other risk flag (lookalike domain, attachment to a first-time recipient) is unchanged.

### D5. The in-chat route: honest about what exists; no new trust is advertised

- No MCP mechanism proves a person answered a form, so no client becomes "known to reach a person". The existing list
  of client names **the person chooses to trust** stays exactly as it is, still a loosening that needs an approved
  change, and is still mentioned only when the person asks (the Gmail skill's rule, kept).
- The refusal for an untrusted client becomes clear and complete: "this needs your approval outside the chat: run
  <resolved terminal command> in a terminal, and I will wait for it with <wait tool>". With CUE-403's working command
  and D3's wait, that is one approval, no re-prepare, no second preview, and the agent learns of it itself — the
  ticket's acceptance.
- Wording: "known to reach a person" is replaced everywhere (code, results, skills, `SECURITY.md`) by "you have chosen
  to trust", and the probe is described as a check that the client can show a form, not that a person saw it.
- A fresh, untrusted Claude Code gets no in-chat confirmation in this release. The route that would be safe —
  URL-mode elicitation to an authenticated local approval page the model cannot read — is a separate design (§5).
- `requiresUserInteraction` is unchanged (§6).

### D6. Update and change approvals

Changes follow D1 (version 2, 30 minutes pending, 24 hours once approved), D2 (the same outcomes) and D3
(`agentcomms approval wait` / `comms_approval_wait`).

### D7. Printed commands

Every command these messages print goes through CUE-403's terminal-command locator and `shellCommand`. This release
requires 0.13.1 (CUE-403).

## 4. Tests owed

Each guard is watched failing under a mutation, then restored.

- **D1:** version-2 pending expires at 30 minutes (boundary equality expired); approved does not expire at 30 minutes
  and does at exactly 24 hours after approval; a version-1 record pending or approved keeps its old expiry after the
  upgrade, including one approved after the upgrade; a mixed-release store; clock moved back, unparseable
  `approvedAt`, `approvedAt` before `createdAt`, inconsistent `usableUntil` — each expired; two simultaneous claims
  after the old 10-minute boundary — one wins; a changed draft or drifted plan voids at claim; downloads unchanged.
- **D2:** every row of the table on every surface listed, Slack files included; `sending`, `failed`, `unknown`;
  wrong-kind and foreign-account ids answered as not found, including on a pinned server before any confirmation
  routing; declined/cancelled forms and wrong codes; `APPROVAL_REQUIRED` never for the excluded states.
- **D3:** each result value; timeout returns pending with the same id; the record is byte-identical after any wait;
  cancellation stops only the wait; a state change racing cancellation or timeout resolved by the final read; the
  ninth concurrent wait refused; no progress token → no progress; foreign/pinned ids → not found; CLI/MCP parity on
  every pair; a terminal approval while an agent waits ends the wait `approved`.
- **D4:** an exact internal address seen in another mailbox escalates (header and body sightings); an exact
  external address escalates; a domain-only internal match does not; a domain-only external match does;
  written-before suppresses each; a public-provider domain never matches on domain; the explanation names the
  mailboxes, source and date and contains no sender-controlled text (a sighting from a message with a hostile display
  name and subject produces the same explanation as a plain one); a removed mailbox is named as no longer connected;
  lookalike and attachment flags unchanged.
- **D5:** the untrusted refusal names the resolved terminal command and the wait tool, and does not mention the trust
  list; no surface says "known to reach a person".
- **Acceptance, end to end with the fake Gmail:** an internal colleague whose address was read in another mailbox,
  from an untrusted client → `recipient-tainted` with its explanation, one terminal approval, the agent's
  `gmail_send_wait` returns `approved`, the send goes out with no second prepare or preview, and the count of person
  decisions is one; the same with the approval given 25 minutes after the preview and the claim 2 hours after the
  approval; an internal recipient matched only by domain → no `recipient-tainted`, a `chat` send on the person's yes.

## 5. Out of scope

URL-mode elicitation to an authenticated local approval page (the next step for a safe in-chat route on a fresh
client); an OS-notification approval; making the terminal `approve` send; changing `requiresUserInteraction`; MCP
Tasks; binding approvals to the preparing process.

## 6. Risks

1. **Approved records held 24 hours** — accepted as stated in D1; bounded by explicit approval, content binding,
   single use, `send cancel`, and the same-user threat model.
2. **An internal colleague whose address was read in another mailbox is still flagged until you first write to them**
   — kept on purpose (a compromised internal account is the case it catches); the flag now says where it was seen,
   and the confirmation it needs is one terminal approval the agent waits for.
3. **Fresh Claude Code has no in-chat confirmation** — the terminal route with a working command and a wait is the
   honest path until an authenticated page exists.
4. **`requiresUserInteraction`** stays computed from configured policies; a `chat` mailbox's escalated send reaches a
   person through the `confirm` route; making it unconditional would add a prompt to every `chat` send.
