# CUE-403 — runnable CLI handoffs from the running installation — design

Status: **proposed for 0.13.1; re-scoped 2026-10-05 after adversarial review round 3. No implementation is in this
change.**

## 1. What is being fixed

CUE-403's harm is not that a bare command is inconvenient. It is that a result can require a person to approve or
repair something at a terminal, then print `agentcomms` or `agent-*` even though that CLI is not on the person's
`PATH`. Gmail's send preparation does that for `agent-gmail approve`, for example
(`packages/gmail/src/operations/send.ts:386-455`), and change approval does the same for the channel's approval
command (`packages/core/src/changes.ts:73-98`, `packages/core/src/changes.ts:265-283`). Under `confirm`, terminal
approval is deliberately not an MCP capability (`docs/superpowers/specs/2026-09-25-cli-mcp-parity-design.md:143-151`).

The 0.13.1 acceptance criterion is:

> **Every agent-communications CLI command printed for a person to run is runnable without an
> `agentcomms` or `agent-*` command on `PATH`, and reaches the same installation and paths as the process that
> printed it.**

This covers approvals, handoffs, reruns and fixes in CLI and MCP results. It does not put commands on `PATH`, edit a
shell profile or change the approval, send or change-policy models.

## 2. What is true now

- A managed runtime entry is
  `<data>/runtime/<version>-<package>/node_modules/<package>/dist/cli.mjs`; the registered server starts an absolute
  Node with that absolute entry (`packages/core/src/mcp-install.ts:299-321`,
  `packages/core/src/mcp-install.ts:566-580`). Nothing there publishes a terminal command.
- Local registrations already find the package's own `src/cli.ts` or built `dist/cli.mjs` and add
  `--experimental-strip-types --disable-warning=ExperimentalWarning` for a TypeScript entry
  (`packages/core/src/mcp-install.ts:523-559`, `packages/core/src/mcp-install.ts:583-603`). The hidden update-check
  child likewise restarts the running CLI with `process.execPath`, `process.execArgv` and the real CLI entry rather
  than an npm shim (`packages/core/src/update-check.ts:174-209`).
- The path overrides this design must preserve are exactly `AGENT_COMMS_CONFIG_DIR`, `AGENT_COMMS_STATE_DIR`,
  `AGENT_COMMS_DATA_DIR`, `XDG_CONFIG_HOME` and `XDG_DATA_HOME`; `resolvePaths` reads them when selecting config,
  state and data (`packages/core/src/paths.ts:37-66`).
- `shellCommand` renders argument words with POSIX single-quote escaping, or the subset that cmd.exe, Windows
  PowerShell and PowerShell 7 pass alike; for an unsafe Windows word it emits no line, and `inlineCommand` /
  `commandText` show inert JSON words instead (`packages/core/src/cli-runtime.ts:67-129`,
  `packages/core/src/cli-runtime.ts:136-191`). It does not locate the first word or carry an environment.
- Core and every channel declare their terminal binary in `package.json` (`packages/core/package.json:24-25`,
  `packages/gmail/package.json:24-25`, `packages/slack/package.json:24-25`,
  `packages/resend/package.json:24-25`, `packages/whatsapp/package.json:24-25`). Each channel currently names
  `@agentcomms/core` as a workspace development dependency (`packages/gmail/package.json:44-45`,
  `packages/slack/package.json:41-42`, `packages/resend/package.json:41-42`,
  `packages/whatsapp/package.json:41-42`); the Gmail server-only package reaches Gmail through its own runtime
  dependency (`packages/gmail-mcp/package.json:41-43`).
- The present printed-command lint finds direct interpolation and concatenation but deliberately accepts a bare CLI
  passed to `shellCommand` (`test/printed-command-construction.test.mjs:7-16`,
  `test/printed-command-construction.test.mjs:61-99`). The channel registry already derives package and binary facts
  from each package's `agentcomms` manifest (`scripts/channels.mjs:27-59`, `scripts/channels.mjs:114-150`).

## 3. Decisions

### D1. One core locator prints the exact running installation

Core owns one function, `locateCliCommand`, used wherever runtime output tells a person to run an
agent-communications CLI. Its input names the calling package and resolver URL, the target manifest, argument words,
the process environment and the requested shell. Its result is a structured command: absolute Node, retained Node
flags, absolute CLI entry, arguments, carried environment and the runnable rendering or an explicit reason no line
can be rendered. A caller never supplies a CLI name as the executable and never quotes a line itself.

The executable is `process.execPath`. The retained `process.execArgv` allowlist is:

- `--experimental-strip-types`, because Node 22.12–22.17 needs it to execute this repository's `.ts` CLI entries;
- `--experimental-transform-types`, only when the running checkout used it, because a TypeScript entry using
  transform-only syntax needs the same transform.

Every other Node flag is dropped: debugger and profiler listeners, test/eval/input mode, preloaders and loaders,
conditions, source-map and warning preferences, titles and memory tuning are properties of the parent invocation,
not requirements of these CLIs. In particular, the checkout launcher's `--disable-warning=ExperimentalWarning` is
cosmetic and is not copied. The existing launcher establishes why type stripping is needed here
(`packages/core/src/mcp-install.ts:546-556`, `scripts/registries.mjs:21-22`). Flag spellings are kept as passed; the
filter never copies a following word for an option it does not retain.

The entry is resolved from package data, never from `PATH`:

1. For the calling product's own CLI, the caller's module URL locates that package root; its top-level `bin` entry
   for `agentcomms.binary` is resolved, contained under that root and made absolute. This also handles
   `@agentcomms/gmail-mcp`: Gmail supplies a resolver URL from the Gmail package reached through the wrapper's
   dependency, rather than treating the wrapper's server entry as `agent-gmail`.
2. For another suite package — today, a channel printing core's `agentcomms` — resolution starts at the calling
   package and follows its own `@agentcomms/core` dependency. In 0.13.1 every channel moves that existing workspace
   edge into `dependencies`, published at the same exact lockstep version. The locator reads both package versions
   and refuses a mismatch. It then resolves core's own `bin.agentcomms`, not a sibling path guessed by the channel.
3. A missing package, missing or escaping bin entry, non-absolute `process.execPath`, or version mismatch produces no
   substitute bare command. It is an installation error reported in the result.

The resulting shapes are installation-independent:

| Launcher that started the result | Command shape |
|---|---|
| managed | `/absolute/node <data>/runtime/0.13.1-gmail/node_modules/@agentcomms/gmail/dist/cli.mjs …` |
| npx | `/absolute/node <npx-cache>/node_modules/@agentcomms/gmail/dist/cli.mjs …` |
| global | `/absolute/node <global-prefix>/node_modules/@agentcomms/gmail/dist/cli.mjs …` |
| checkout | `/absolute/node --experimental-strip-types <repo>/packages/gmail/src/cli.ts …` |

Thus npx output does not require `npx` to remain on `PATH`, a global output does not depend on the global bin
directory, a managed output uses that managed runtime, and a checkout output keeps the flag which makes its source
entry executable. POSIX and Windows differ only in rendering; all stored words are absolute.

### D2. Carry the server's path overrides into the command

The locator copies the five variables in §2 when they are present in the printing process's environment, including
an explicitly empty value, in this fixed order:

```
AGENT_COMMS_CONFIG_DIR AGENT_COMMS_STATE_DIR AGENT_COMMS_DATA_DIR XDG_CONFIG_HOME XDG_DATA_HOME
```

It does not replace them with resolved directories: preserving the original environment preserves precedence and
lets the invoked CLI resolve paths by the same rules. An unset variable is omitted.

Argument words still go through `shellCommand`, and prose still embeds the result through `inlineCommand` or
`commandText`. The environment-aware renderer uses the same quote-or-refuse rules for values. POSIX gets assignment
prefixes. Windows gets separate, labelled PowerShell and cmd.exe forms because their assignment and invocation
syntax is not interchangeable. A Windows result never calls one line universal.

For a config directory containing a space, an apostrophe and a non-ASCII character, the exact forms are:

```sh
AGENT_COMMS_CONFIG_DIR='/opt/Agent'\''s café files/config' '/opt/Agent'\''s café files/node' '/opt/Agent'\''s café files/core/dist/cli.mjs' approve ap_example
```

```powershell
$env:AGENT_COMMS_CONFIG_DIR = "C:\Agent's café files\config"; & "C:\Agent's café files\node.exe" "C:\Agent's café files\core\dist\cli.mjs" approve ap_example
```

```bat
set "AGENT_COMMS_CONFIG_DIR=C:\Agent's café files\config" && "C:\Agent's café files\node.exe" "C:\Agent's café files\core\dist\cli.mjs" approve ap_example
```

Additional variables repeat the assignment segment in the fixed order. If an existing Windows safety rule cannot
render a value or argument, the result contains the inert JSON words and names the shell-specific manual action; it
does not print a partial line or call JSON a runnable command (`packages/core/src/cli-runtime.ts:117-121`,
`packages/core/src/cli-runtime.ts:152-191`).

### D3. Every runtime handoff uses the locator, and a manifest-derived lint enforces it

The migration inventory is below. “Handoff” means runtime result, error, hint, fix, command or `nextStep` text that
asks a person to run a suite CLI; static help syntax and prose explaining a command's grammar are not machine-specific
handoffs.

- **Core:** change approval and rerun, approval-kind correction, save-destination approval, daily update and
  `update --later`, policy/attachment/organisation/secrets reruns and repairs, install/update registration repair and
  doctor fixes (`packages/core/src/changes.ts:73-98`, `packages/core/src/changes.ts:265-283`,
  `packages/core/src/changes.ts:461-465`, `packages/core/src/approvals.ts:635-655`,
  `packages/core/src/approvals.ts:889-897`, `packages/core/src/change-flow.ts:272-302`,
  `packages/core/src/save-destination.ts:648-676`, `packages/core/src/save-destination.ts:744-756`,
  `packages/core/src/update-state.ts:305-347`, `packages/core/src/update-gate.ts:375-414`,
  `packages/core/src/operations/update.ts:298-307`, `packages/core/src/operations/update.ts:740-750`,
  `packages/core/src/config.ts:722`, `packages/core/src/organisations.ts:243-244`,
  `packages/core/src/organisations.ts:506`, `packages/core/src/organisations.ts:698-718`,
  `packages/core/src/organisations.ts:870`, `packages/core/src/operations/organisations.ts:205-407`,
  `packages/core/src/operations/organisations.ts:578-730`,
  `packages/core/src/operations/organisations.ts:1152-1376`,
  `packages/core/src/operations/secrets-migrate.ts:250-376`,
  `packages/core/src/operations/change-policy.ts:135-145`,
  `packages/core/src/operations/maintenance.ts:217-220`,
  `packages/core/src/operations/maintenance.ts:327-360`, `packages/core/src/channel-words.ts:39-52`,
  `packages/core/src/channel-words.ts:75-82`, `packages/core/src/cli.ts:285-290`,
  `packages/core/src/cli.ts:456-787`, `packages/core/src/cli.ts:863-900`,
  `packages/core/src/cli.ts:948-950`).
- **Gmail:** send approval and refusal, save-destination and confirm-client completion, sign-in/finish/reauth, client,
  inbox, organisation and scope repair, setup/import, doctor and retry handoffs
  (`packages/gmail/src/operations/send.ts:386-455`, `packages/gmail/src/operations/send.ts:585-612`,
  `packages/gmail/src/operations/attachments.ts:374-375`, `packages/gmail/src/mcp/server.ts:160-162`,
  `packages/gmail/src/mcp/server.ts:997`, `packages/gmail/src/mcp/server.ts:1388`,
  `packages/gmail/src/mcp/server.ts:2381-2393`, `packages/gmail/src/mcp/server.ts:2481-2487`,
  `packages/gmail/src/cli/program.ts:388-693`, `packages/gmail/src/cli/program.ts:1033-1046`,
  `packages/gmail/src/cli/program.ts:1281-1302`, `packages/gmail/src/cli/program.ts:1823-2422`,
  `packages/gmail/src/auth/flows.ts:117`,
  `packages/gmail/src/auth/scopes.ts:85-88`, `packages/gmail/src/auth/session.ts:104-176`,
  `packages/gmail/src/gmail-api/errors.ts:140-156`, `packages/gmail/src/operations/client-choice.ts:95-254`,
  `packages/gmail/src/operations/clients.ts:134-511`, `packages/gmail/src/operations/consent.ts:91-610`,
  `packages/gmail/src/operations/signin.ts:213-681`, `packages/gmail/src/operations/doctor.ts:269-565`,
  `packages/gmail/src/operations/import-legacy.ts:505-512`, `packages/gmail/src/operations/inbox-names.ts:23`,
  `packages/gmail/src/cli/render.ts:83-204`, `packages/gmail/src/cli/render.ts:661-916`).
- **Slack:** post/reaction approval and refusal, workspace sign-in/finish/reauth/mode/removal, app/manifest, draft,
  destination, file and doctor handoffs (`packages/slack/src/operations/send.ts:573-605`,
  `packages/slack/src/auth/refresh.ts:168-170`, `packages/slack/src/operations/changes.ts:70-494`,
  `packages/slack/src/operations/workspaces.ts:235-542`, `packages/slack/src/operations/signin.ts:120-1064`,
  `packages/slack/src/operations/mode.ts:68-132`, `packages/slack/src/operations/app.ts:283-441`,
  `packages/slack/src/operations/doctor.ts:152-760`, `packages/slack/src/compose/drafts.ts:206`,
  `packages/slack/src/operations/destination.ts:20`, `packages/slack/src/operations/files.ts:100`,
  `packages/slack/src/operations/session.ts:144`, `packages/slack/src/mcp/server.ts:1136-1151`,
  `packages/slack/src/cli/render.ts:63-505`, `packages/slack/src/cli/program.ts:464-1541`).
- **Resend:** send approval/refusal/status recovery, account/policy/key repair, scheduled cancellation, doctor and
  rerun handoffs (`packages/resend/src/operations/send.ts:100-365`,
  `packages/resend/src/operations/send.ts:516-565`, `packages/resend/src/operations/send.ts:669-675`,
  `packages/resend/src/accounts.ts:101-167`, `packages/resend/src/context.ts:106`,
  `packages/resend/src/operations/accounts.ts:335-344`, `packages/resend/src/operations/doctor.ts:53-54`,
  `packages/resend/src/api/client.ts:115`, `packages/resend/src/cli/program.ts:279-770`).
- **WhatsApp:** add/remove/sync, index/config repair, chat-list, approval refusal and rerun handoffs
  (`packages/whatsapp/src/operations/accounts.ts:39-133`, `packages/whatsapp/src/config.ts:163`,
  `packages/whatsapp/src/index-db.ts:310-322`, `packages/whatsapp/src/operations/chat-lists.ts:99-119`,
  `packages/whatsapp/src/operations/status.ts:144`, `packages/whatsapp/src/cli/render.ts:73`,
  `packages/whatsapp/src/cli/program.ts:416-604`).

The expanded lint reads every manifest binary through the existing channel registry. It rejects a runtime
`shellCommand` whose first word is a bare manifest binary, a raw/template command beginning with one, and any
handoff renderer that did not receive the locator's structured result. Its narrow allowlist contains individual
help/usage-only sites with a reason. Adding a channel automatically adds its binary to the rule. This tightens the
existing lint rather than adding a hand-maintained list (`test/printed-command-construction.test.mjs:18-27`,
`test/printed-command-construction.test.mjs:77-99`).

### D4. Do not print a bare-name alternative

0.13.1 prints no secondary “also works if it is on PATH” hint. It adds no correctness and makes a long absolute
handoff easier to mistake for optional detail. A person may still type a bare command they already know works; the
product does not recommend or verify it. If PATH shims are designed later, that release may add a secondary hint,
never ahead of the absolute command.

### D5. Old released binaries get a documented best-effort escape hatch

Already released 0.13.x binaries still print bare names and cannot be changed in place
(`packages/core/src/changes.ts:91-98`, `packages/core/src/approvals.ts:889-897`,
`packages/gmail/src/operations/send.ts:449-453`). `comms_paths` and `agentcomms paths` return the resolved data
directory (`packages/core/src/operations/maintenance.ts:27-39`), and a
managed registration contains the absolute Node command and runtime entry
(`packages/core/src/mcp-install.ts:566-580`). The 0.13.1 changelog and the troubleshooting guide linked by the README
(`README.md:328-343`) give two recovery routes:

1. Read `dataDir` from `comms_paths` (or `agentcomms paths` where that CLI can already be started), read the registered
   server's absolute Node command from the MCP client entry, and run the matching entry:
   `<dataDir>/runtime/<version>-<package>/node_modules/<package>/dist/cli.mjs approve <id>`. For core 0.13.0 that is
   `<dataDir>/runtime/0.13.0-core/node_modules/@agentcomms/core/dist/cli.mjs`; the path is derived by the managed
   runtime helpers (`packages/core/src/mcp-install.ts:299-321`). Carry the same path environment as in D2.
2. Where `npx` is on the person's `PATH`, run the package and version which printed the approval, never `latest`:
   `npx -y @agentcomms/core@<version> approve <id>`, or the corresponding Gmail, Slack, Resend or WhatsApp package,
   with the same path environment.

The release's approval, update, onboarding, setup, attachment and sending skills teach the same fallback and never
run a terminal approval for the person. This is explicitly best effort: skills are installed separately from the
runtime (`docs/superpowers/specs/2026-09-18-agent-communications-design.md:979-984`), the current update skill still
names bare `agentcomms approve` (`skills/comms-update/SKILL.md:80-86`), an old result may not identify its Node path,
and `npx` may itself be absent. New 0.13.1 results do not depend on this bridge.

### D6. PATH shims move to a follow-up design

Publishing `agentcomms` and `agent-*` into a user bin directory is out of scope for 0.13.1. It is a convenience, not
the fix: the absolute command already makes every new handoff runnable. Three reviews kept finding lifecycle and
security work unrelated to the approval deadlock.

The follow-up starts with these known requirements:

- safe bin-directory ownership, modes and ACLs on Linux, macOS and Windows, including macOS extended ACLs;
- receipts, startup validation and recovery for installed runtimes and their published commands;
- one rule for prune while shim publication is opted out, so no dangling command survives;
- one authoritative data root across CLI and stripped MCP environments; and
- CLI–MCP parity for any durable shim preference, plus migration from an unsafe or obsolete choice.

No part of 0.13.1 creates, repoints, removes or diagnoses a shim, edits `PATH`, writes a profile or the Windows
registry, adds a shim preference, or changes install/prune approval effects.

## 4. Tests

1. **Locator matrix.** On POSIX and Windows, fixtures for a managed runtime, an npx cache path, a global install and a
   checkout resolve `process.execPath` plus the exact package entry. The checkout keeps only the two D1 flags under
   their stated conditions; debugger, test, eval, preload, loader and unrelated flags are absent. Symlinked npm bins
   and the Gmail server-only wrapper still resolve the owning channel package.
2. **Same package graph.** A channel result which prints core's command resolves `@agentcomms/core` from that channel's
   dependency. The fixture places another core elsewhere and proves it is not selected; caller and target versions
   must be equal, and a mismatch returns no bare fallback.
3. **Environment carriage.** Each of the five variables, all together, absent values and explicitly empty values are
   covered. Executing the result reports the same config, state and data directories as the printing process.
4. **Rendering.** Assert the exact POSIX, PowerShell and cmd.exe forms in D2 for paths containing spaces, an
   apostrophe and non-ASCII text. Existing unsafe-Windows cases remain inert JSON, never a partial runnable line.
5. **Lint.** A fixture channel added only by manifest makes its binary subject to the rule. Bare names in
   `shellCommand`, template strings, errors, hints, fixes and `nextStep` fail; a locator result passes; each documented
   help-only allowlist entry passes for its stated reason.
6. **End to end.** Prepare a harmless change approval through the CLI and through MCP, take the printed command, and
   execute it in a fresh real shell whose `PATH` contains Node and system tools but no agent-communications CLI. The
   command approves the record in the same temporary state directory. Run the POSIX shell test on POSIX and the two
   labelled Windows forms on Windows. No provider transport is called.
7. **Inventory.** Exercise at least one CLI and one MCP result from every D3 inventory group, plus every approval
   producer, and assert its primary runnable form begins with the absolute Node/entry command and carries the path
   environment.
8. Run full `pnpm verify`. No test contacts Gmail, Slack or Resend, posts to Slack, uses a real Resend key, writes the
   real home, or contains a real address, token or client secret.

## 5. Departures from the ticket

CUE-403's title asks for the CLIs on `PATH`. Version 0.13.1 instead fixes the user-visible failure the ticket exposed:
every new terminal approval, handoff and fix is runnable from the exact installation that printed it, even when no
suite CLI is on `PATH`. PATH convenience is a separate follow-up with the lifecycle, ownership and parity work in D6.
