# Daily update check — design

Status: **agreed 2026-09-28, being implemented.** The intent, the three decisions, the approach and sections 1–4 are
agreed with the owner. Section 2's open question is resolved: a call that claims an approval the person already gave is
not stopped (below).

## Intent

The owner's words: when a request reaches the agent through an MCP server, the server should check at least once a
day whether there is an update, and if there is, stop doing everything and reply "Hang on a minute, there's an update.
Let's update first."

Why: a second Mac sat on 0.7.1 with a bug that made installs from chat register nothing while reporting success, and
nobody knew the machine was behind. Success is that a machine never quietly falls behind a release again.

Assumptions written back to the owner, and not corrected:

- Only the packages this machine uses are asked about, as `comms_update` already does.
- One check a day for the machine, shared by every server, not one per server.
- The update tools themselves are never blocked, so a reply saying "update first" can always be acted on.
- WhatsApp keeps its no-network guarantee.
- When npm cannot be reached, nothing is blocked.

## Decisions (asked, answered)

1. **When the person cannot or will not update now — stop once a day.** The first request after an update is found
   gets the "update first" reply instead of being done. If the person says not now, work carries on for the rest of
   the day, and the next day it asks again. The "not now" is recorded once for the machine, so every server and every
   chat respects it. (Rejected: once per new version; a hard stop until updated.)
2. **The terminal stops too, the same as chat** (the CLI/MCP parity rule). Every command of `agentcomms`,
   `agent-gmail`, `agent-slack`, `agent-resend` and `agent-whatsapp` checks and stops as the servers do. (Rejected: a
   notice that lets the command run; silence in the terminal.)
3. **A per-machine setting, on by default.** `agentcomms update --auto off` turns the check off for this machine and
   `--auto on` turns it back on; doctor always shows which. The check is skipped when the `CI` environment variable
   is set, and tests switch it off the same way. (Rejected: only CI skips it; never skipped.)

## Approach (agreed): A — one check, in the wrapper every server already has

Every server passes its tools through core's `strictToolArguments` (`packages/core/src/tool-arguments.ts`, used by
core, Gmail, Slack, Resend and WhatsApp), and core already reads the registry (`packages/core/src/npm.ts`). The gate
goes there, and in each CLI's entry, so every surface stops the same way.

Rejected:

- **B — a scheduled background job (launchd) that checks daily; servers only read.** One more thing to install and
  keep alive on every Mac, and not portable to Linux or Windows as it stands. Worth it only if the servers must make
  no network request at all.
- **C — only the core server checks, and tells the agent to update.** Gmail, Slack, Resend and WhatsApp would keep
  running an old version, which misses the point of the request.

## 1. What counts as an update, and how a machine learns of one (agreed)

- **One number.** Every `@agentcomms` package is released together under one version, so an update exists when the
  registry's `latest` dist-tag for `@agentcomms/core` is newer than the version of the running server or command.
  Prereleases do not count: 0.8.0-rc.1 is not told to "update" to 0.7.2.
- **One file per machine**, `update-check.json` in the state directory: when the registry was last asked, the latest
  it reported, whether this machine's registrations are behind it, and any "not now" with when it runs out (local
  midnight).
- **At most once every 24 hours** for the machine, a server or command asks the registry for that one version and
  runs the same "what is behind" check `comms_update` uses (`check: true`). If the registry cannot be reached, the file
  keeps its last result and nothing is blocked on that account.
- **Two pieces.** A reader that only reads the file, with no network code, and a checker that talks to the registry.
  WhatsApp imports only the reader, so `packages/whatsapp/test/no-network.test.ts` keeps passing; it learns of an
  update once any other server or command has checked.
- **"Updated but not restarted" is told apart from "not updated".** When the running server is old but its
  registration already names the latest version, the reply says to restart the client rather than to update, which
  covers the gap between applying an update and restarting.

## 2. The reply, and what is never stopped (agreed)

- When the file says an update is available, it is not snoozed, and the tool is not exempt, the tool does not run.
  It returns a result that opens "Hang on a minute, there's an update. Let's update first.", then the versions (running,
  latest), and the two ways on: `comms_update` on the core server (or `agentcomms update` at a terminal), or "not now".
- **Not now is the person's decision, not the agent's.** It is a change like any other here: `comms_update` with
  `later: true` returns a preview ("Skip the update to X until tomorrow") and an approval id, applied on the person's
  yes under `chat` or their typed code under `confirm`. Otherwise the agent could clear the stop without asking, and
  the feature would do nothing.
- **Never stopped:** `comms_update` (all forms), `comms_doctor`, `comms_paths`, and, per channel, its doctor.
- **A call that claims an approval the person already gave is not stopped.** When its arguments carry `approvalId` —
  a send approved moments before the check landed, say — it goes ahead: the person has already said yes to exactly
  that, and stopping it would only let the approval expire. The stop applies from the next new request.
- If the core server is not registered in a client, the reply still names `agentcomms update` at a terminal.

## 3. The terminal (agreed)

- Every command except the exempt ones (`update` in every form, `doctor`, `paths`, `approve`, `approvals`, `mcp` —
  the server gates each call itself — `--help`, `--version`) reads the file first; if it is older than 24 hours it
  asks the registry, waiting at most about three seconds before going on without it.
- **At a terminal with a person:** it asks "Update now, later today, or cancel?". Now runs the update (its own preview
  and yes) and ends, telling them to run the command again; later records the snooze (the person answering is the
  approval) and runs the command; cancel ends without doing anything.
- **Without a terminal** (scripts, cron, `--json`): the command does nothing and exits with a new error code and its
  own exit status (to be chosen against `packages/core/src/errors.ts`), naming `agentcomms update` and
  `agentcomms update --later`.

## 4. Setting, CI and tests (agreed)

- `agentcomms update --auto off|on`, and the same as a `comms_update` argument. Turning it off is a change with a
  preview and an approval; turning it on applies at once, as tightening does elsewhere. Stored in core's
  `config.json`. Doctor adds a line: on or off, when last checked, latest, running.
- Skipped whenever `CI` is set. Every test harness sets the off switch (an environment variable, named in the plan),
  so no test reaches the real registry; the gate's own tests use a fake registry and a fake clock.
- Tests to write: stale file triggers one check and never two in a day; offline never blocks; each exempt tool
  passes; snooze lasts until local midnight; "updated but not restarted" reply; WhatsApp reads without network; the
  terminal's three answers and its non-terminal exit; parity rows for the new `comms_update` arguments.
- A behaviour change that can stop calls: released as a minor version (0.8.0) with a changelog entry.

## Implementing

Sections 1–4 are implemented as written, on the branch `feat/daily-update-check`. What the implementation had to
settle beyond them, after review:

- **"Restart" only on a positive finding (§1).** The file records, channel by channel, where this machine is known to
  run the latest release (`current`): a server whose every registration the check read names it — at least one, none
  pinning nothing, no client configuration left unread — or a command whose package is installed globally at it. Only
  then does a stop say "restart" rather than "update". A server of a channel with a registration that pins nothing —
  a checkout's own, an entry written by hand with no version — is told to update: restarting may start the same old
  code. "Restart" is decided per channel, so a server beside the registrations, one they do not start, would be told to
  restart with them: the Claude Code plugin's launcher and the Gemini extension's manifest set
  `AGENT_COMMS_STARTED_BY` for the servers they start, and such a server is always told to update.
- **The terminal stops for "installed, not yet running" too** (Decision 2): an older copy of a command whose release is
  installed globally is stopped, and its "now" says to run the command from the installed release.
- **A claimed approval is one this machine's approval store holds and that is still waiting to be used — pending or
  approved — of the kind the call takes where the surface knows it (§2)**; an empty or unknown `approvalId` claims
  nothing, and nor does one already used, revoked or expired, which the store keeps. The one exception is a look-up:
  Resend's send status is asked by the approval a send went under, used or not, and is let through with a send's.
  That the approval was prepared for this very call is not checked at the stop — only the tool can compute the digest
  it is bound to — but by the tool's own claim, and a change that needs no approval refuses one rather than dropping
  it. The terminal follows the same rule, for parity: a command carrying such an id — `--approval`, Gmail's
  `--mcp-approval` — is not stopped, and a core command that takes no approval refuses `--approval` as usage.
- **Exempt at a terminal besides §3's list:** `mcp` on its own only (the server; `mcp install` and `mcp prune` are
  stopped), the listeners a sign-in starts (`agent-gmail oauth-listen`, `agent-slack sign-in-listen` — children of a
  command already let through, which a stop would break part-way), and WhatsApp's `status`, its doctor. Over MCP the
  list stays §2's: `comms_approvals_list` is stopped, while at a terminal `approve` and `approvals` are a person's own
  acts on a change already in flight.
- **The terminal's three seconds bound the wait, not the check**: the ask finishes beside the command. A check is
  claimed with a short lease (`checking`) and the day's `lastChecked` written when the ask is over, so an ask cut
  short does not use up the day.
- **"Updated. Run your command again." only when the update brought this command to the latest release**; otherwise
  the terminal says what is left, and ends non-zero. Both ways on are also named in their npx form, for a machine with
  no `agentcomms` installed.
