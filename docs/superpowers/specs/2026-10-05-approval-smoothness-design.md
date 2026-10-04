# CUE-404 — approving a send without fighting the clock — design

Status: **written 2026-10-05**, from Linear CUE-404 (High; the owner: "this is very not smooth") and a cited research
pass over this repository, the MCP specification and the clients' documentation. Depends on CUE-403 (the CLIs on
PATH, [its spec](2026-10-04-cli-path-shims-design.md)) for every printed terminal command to work; ships after it.

## 1. What was asked

Sending one email to an internal colleague from Claude Code in VS Code took four attempts and about twenty minutes:
the update approval expired while it was being read; the send escalated to `confirm` on `recipient-tainted` for a
colleague on the owner's own domain; the client was "not on the list" so only a terminal could approve; the terminal
command did not exist (CUE-403); once approved at the terminal, nothing told the agent; four minutes later the
approved record expired unused and the send answered `APPROVAL_REQUIRED`, asking for the approval just given. The
ticket asks for: approved approvals not racing the clock; the agent learning about an approval without being told; an
accurate `APPROVAL_EXPIRED`; no escalation for internal or previously-mailed recipients on taint alone, explained
when it does fire; an in-chat approval route for Claude Code; the same for update approvals; and every printed
command runnable. **Acceptance:** one internal email that triggers `confirm` takes one approval, with no re-prepare,
no second preview, the agent learning of the approval itself, and no error asking for an approval already given.

## 2. What is true, and was checked

| Fact | Source |
|---|---|
| Every approval lives `APPROVAL_TTL_MS` = 10 minutes. | `packages/core/src/approvals.ts:401` |
| Expiry is derived for `pending` **and `approved`** records, so an approved record expires unused. | `approvals.ts:512` ("expiry for pending/approved") |
| Core maps an expired record to `APPROVAL_EXPIRED`, but Gmail's execute turns every state other than pending/approved into `APPROVAL_VOID`, and the MCP send path's `needsConfirmation` routes an expired record to confirmation, so an untrusted client gets `APPROVAL_REQUIRED`. | `approvals.ts:591`; `packages/gmail/src/operations/send.ts:569`; `packages/gmail/src/mcp/server.ts:2274` |
| The shipped Gmail skill documents those wrong outcomes. | `skills/gmail-send/SKILL.md:129` |
| "Clients whose approval forms are known to reach a person" is `defaults.confirm.elicitationClients`: an empty-by-default list of MCP `clientInfo.name`s the person adds, by an approved change, after a four-character probe. Only the name is checked at send time. | `packages/core/src/config.ts:103, 431`; `packages/gmail/src/mcp/server.ts:2285, 2388`; `packages/gmail/src/operations/confirm-clients.ts:27, 89, 111` |
| `clientInfo` is self-reported; the MCP SDK says not to use it for security decisions. Elicitation is answered by the client: the protocol mandates no interaction model, Claude Code has `Elicitation` hooks that can answer without a dialog, and the repository's own test answers the probe automatically. Only URL-mode elicitation keeps the person's input from the client and model. | MCP spec 2025-06-18 and 2026-07-28 (client/elicitation); ts.sdk.modelcontextprotocol.io migration notes; code.claude.com/docs/en/mcp; `packages/gmail/test/mcp-send.test.ts:168`; `skills/gmail-send/SKILL.md:180`; `SECURITY.md:67` |
| `recipient-tainted` records addresses and non-public domains seen in mail read in the last seven days (one store for all mailboxes) and escalates `chat` to `confirm` when the recipient was seen and the sending mailbox has not written to that exact address. The "previously mailed" exemption exists (`in:sent to:` then an exact To/Cc/Bcc check). Send time does **not** apply `external`: an address on the mailbox's own `internalDomains` still escalates. | `packages/core/src/taint.ts:9-10, 296`; `packages/gmail/src/operations/send.ts:202, 246, 263, 268, 302, 410`; `packages/core/src/config.ts:1293, 1440` |
| Claude Code idles out a stdio MCP call after 30 minutes without progress (5 for HTTP); progress resets the idle timer but not the hard per-call timeout; after two minutes a main-conversation call moves to a background task. | code.claude.com/docs/en/mcp (read 2026-10-05) |
| `_meta["anthropic/requiresUserInteraction"]` on the Gmail send tool is computed at server start from configured policies only, so a `chat` mailbox's send escalated to `confirm` by a risk flag does not carry it. | `packages/gmail/src/mcp/server.ts:212, 2373` |

## 3. Decisions

### D1. An approval's clock runs while it is pending; once approved, it is held for the send

- **Pending** approvals of every kind — sends (Gmail, Resend, Slack posts and reactions), configuration changes and
  updates — expire after **30 minutes** (was 10): long enough to read a long preview and find a terminal, short enough
  that an unanswered approval does not linger. Downloads' questions keep their own 30 minutes.
- An **approved** record no longer expires on that clock. It stays usable for **24 hours after it was approved**
  (`usableUntil` = `approvedAt` + 24 h), then expires unused. It stays single-use, and it is still checked when it is
  claimed against everything it is bound to — the draft's message id and digest, the inbox and account, the recipients
  and subject expected, the change plan's effects — so an edited draft or a drifted plan still voids it.
- Records gain `approvedAt` and `usableUntil`; a record from an earlier release without them keeps its old
  `expiresAt`, so nothing already armed lives longer than it did.
- Why not have the terminal `approve` send the draft itself: the agent then cannot report the outcome, the send runs
  in a second process outside the server that prepared it, and "only `send.execute` sends" would gain a second caller
  shape. Holding the approval for the agent keeps one sending path.

### D2. One classification of a record's state into an error, used by every surface

Core exports one function from an approval record (and what the caller asked) to its outcome, and every claim path —
Gmail, Resend, Slack, the change flow, the MCP confirmation routing — uses it, **checking expiry and finished states
before any confirmation routing**:

| Record | Error | Says |
|---|---|---|
| expired, never approved | `APPROVAL_EXPIRED` | when it was prepared and when it expired; prepare it again |
| approved, then expired unused | `APPROVAL_EXPIRED` | approved at …, expired unused at …; prepare it again |
| used | `APPROVAL_USED` (existing code if present, else `APPROVAL_VOID` with that reason) | it was already used, and when |
| revoked / voided | `APPROVAL_VOID` | the recorded reason (draft changed, cancelled, plan drifted) |
| pending, confirm, untrusted client | `APPROVAL_REQUIRED` | only here — with the terminal command (CUE-403) and the wait tool |

`APPROVAL_REQUIRED` is never returned for a record that is approved, expired, used or revoked. The Gmail skill's
outcome table is corrected to match.

### D3. The agent can wait for an approval instead of being told

A core operation `waitForApproval(approvalId, { waitSeconds, signal })` — read-only, never claims, revokes or
executes — returns as soon as the record leaves `pending` (approved, expired, revoked, used, failed, unknown), or after
`waitSeconds` (default 60, at most 120) with `state: "pending"` and the same id. It reads the record through the
approval store (a filesystem watch as a hint, a poll every second as the truth), sends an MCP progress notification
every 15 seconds while waiting, and on cancellation stops waiting only.

Surfaces, all calling that one operation (parity rows in `capabilities.json`): `comms_approval_wait` on the core
server and `agentcomms approval wait <id>`; and on each channel server the send-shaped name agents look for —
`gmail_send_wait`, `resend_send_wait`, `slack_post_wait` — so an agent holding a channel's approval need not know the
core server exists. Every `APPROVAL_REQUIRED` and terminal-approval hint names the wait tool next to the terminal
command: "run this in a terminal; then I'll wait for it with `gmail_send_wait`".

### D4. `recipient-tainted` escalates only for an external address not written to before, and says why

- Send-time taint becomes `(seen.address || seen.domain) && external && !hasWrittenTo(exact address)`, where
  `external` is the existing computation from the sending mailbox's own addresses and `internalDomains`
  (`send.ts:246`). An address on the mailbox's own domain(s) no longer escalates on taint alone; the existing
  exact-address "written to before" exemption stays.
- The taint store records, from now on, where each address was seen: the mailbox, the message id, the date, and the
  sender (not the body). When the flag fires, the preview and result say, in plain words and inside the untrusted
  envelope: "this address appeared in mail you read on <date> in <mailbox> (from <sender>); an instruction hidden in a
  message can ask an agent to send to an address it contains, so this send needs your confirmation". Entries written
  by earlier releases, without a source, say "in mail you read in the last seven days".
- What is not changed: lookalike-domain, new-external-domain and every other risk flag keep escalating; `internalDomains`
  is still loosened only by an approved change (`config.ts:1440`).

### D5. An in-chat approval route for Claude Code: the existing trust list, offered honestly

No MCP mechanism proves a person answered: a form's answer comes from the client, the client's name is
self-reported, and Claude Code can answer forms through hooks. So this design does **not** add a list of clients
"known to reach a person". The existing mechanism — a list of client names **the person chooses to trust** to show
approval forms to them, added by an approved change — is kept, and made reachable:

- Every refusal for an untrusted client, instead of only "not on the list", says plainly what trusting means ("your
  approval would then be asked in a form this client shows you; a client that answers its own forms, for example
  through a hook, could approve on your behalf") and gives the exact one-time command or tool to trust this client
  (`agent-gmail confirm client add <name>` / `gmail_confirm_client_add`, itself an approved change), next to the
  terminal route.
- The words "known to reach a person" are replaced everywhere (code, results, skills, `SECURITY.md`) by "you have
  chosen to trust", and the probe is described as a check that the client can show a form, not that a person saw it.
- URL-mode elicitation to a local, authenticated approval page — the one standard route that keeps the answer from the
  model — is recorded in §5 as the next step, not built here.
- The `requiresUserInteraction` annotation is unchanged: making it unconditional would add a Claude Code prompt to
  every `chat`-policy send, the opposite of what was asked. An escalated send from a `chat` mailbox still reaches a
  person only through the `confirm` route (a trusted client's form or the terminal); §6 records the trade.

### D6. Update and change approvals follow D1–D3

`comms_update`, `comms_change_policy`, and every gated change get the 30-minute pending window, the 24-hour usable
window once approved, the D2 errors, and `comms_approval_wait`. A preview being read no longer expires under the
person at ten minutes; an approval given at the terminal is picked up by the waiting agent.

### D7. Printed commands

Every command these messages print is built through `shellCommand` and resolved by CUE-403's terminal-command locator
(the shim when it resolves, else the absolute runtime entry). This release requires 0.13.1 (CUE-403).

## 4. Tests owed

Each guard is watched failing under a mutation, then restored.

- D1: pending expires at 30 minutes; approved does not expire at 30 minutes and does at 24 hours after approval; a
  record from the previous release keeps its old expiry; an approved send whose draft changed is voided at claim; an
  approved change whose plan drifted is refused at claim; single use holds (a second claim fails).
- D2: every row of the table on every surface (Gmail and Resend send, Slack post and reaction, core change flow, the
  MCP confirm routing for trusted and untrusted clients); `APPROVAL_REQUIRED` never for approved/expired/used/revoked;
  approved-then-expired names both times.
- D3: wait returns on each terminal state, times out pending with the same id, never claims or executes (the record is
  unchanged), honours cancellation by stopping only, caps `waitSeconds`, sends progress; CLI/MCP parity for every
  surface; a terminal approve while an agent waits ends the wait as `approved`.
- D4: internal address seen in mail → no `recipient-tainted`; external seen and never written → flagged with the
  source text; external written before → not flagged; an earlier-release taint entry without a source → generic text;
  every other risk flag unchanged; the source text is enveloped and neutralised.
- D5: the untrusted-client refusal carries the honest wording and the exact trust command; no surface says "known to
  reach a person".
- Acceptance, end to end with the fake Gmail: an internal colleague → `chat`, sent on the person's yes; an external
  recipient that triggers `confirm` from an untrusted client → one terminal approval, the agent's wait returns
  `approved`, the send goes out with no second prepare or preview.

## 5. Out of scope

URL-mode elicitation to an authenticated local approval page (the next step for an in-chat route that does not trust
the client); an OS-notification approval; making the terminal `approve` send; changing `requiresUserInteraction`;
MCP Tasks.

## 6. Risks

1. **An approval held for 24 hours** is a longer-armed single send. Bounded by: the person explicitly approved it;
   it is bound to the exact draft and recipients and voided by any change; it is single-use; `send cancel` revokes it.
2. **Trusting a client** remains a person's choice with a stated consequence (a hook can answer forms); it is a
   loosening and needs an approved change, as today.
3. **Fewer `recipient-tainted` escalations**: an injected instruction to mail a colleague on the owner's own domain no
   longer escalates. The preview still shows every recipient and the `chat` policy still needs the person's yes; an
   organisation that wants every internal send confirmed sets the mailbox to `confirm`.
4. **A `chat` mailbox's escalated send** without the `requiresUserInteraction` annotation reaches a person only through
   the confirm route; the annotation is not made unconditional, to avoid a prompt on every `chat` send.
