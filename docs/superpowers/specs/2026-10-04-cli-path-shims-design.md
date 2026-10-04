# CUE-403 — the CLIs on PATH after install and update — design

Status: **proposed 2026-10-04 against the 0.13.0 release (`6d4694e`), revised 2026-10-05 after adversarial review
round 1. No implementation is in this change.**

## 1. What was asked

The owner reproduced CUE-403 after a managed install. `agentcomms`, `agent-gmail`, `agent-slack`, `agent-resend` and
`agent-whatsapp` existed only below their versioned runtimes, not on `PATH`. A result that said “run
`agent-gmail approve <id>` in a terminal” therefore handed the person a command their terminal answered with
`command not found`. Under `confirm`, and for some escalated sends, that terminal is the only approval route.

Managed install and `comms_update` must publish the core CLI and each installed channel CLI in a per-user bin
directory, repoint them on update, and remove them safely when prune removes their runtime. The installer must check
command discovery afterwards and explain exactly how to add the directory for zsh, bash, fish or Windows when this
process does not see it. CLI and MCP doctor must diagnose missing, stale, shadowed, malformed and foreign shims.

The acceptance criterion is:

> **Every terminal command a result prints works on this machine.**

It is not “every bare CLI name works immediately after install.” The program never edits a shell profile or the
Windows user PATH. A CLI result may use a verified bare command; an MCP result always leads with a validated absolute
Node-plus-entry command because the server process cannot prove what the person's terminal resolves.

## 2. What is true, and was checked

### 2.1 The managed runtime contains the CLI, but no user command is published

- The default data directory is `~/.local/share/agent-communications` on macOS and Linux and
  `%LOCALAPPDATA%\agent-communications` on Windows. `ResolvedPaths` has config, state, secrets, data and downloads,
  but no bin directory (`packages/core/src/paths.ts:12-26`, `packages/core/src/paths.ts:37-66`). Its home resolution
  deliberately honours supplied `HOME` and `USERPROFILE` values, after real-home writes escaped earlier tests
  (`packages/core/src/paths.ts:69-101`, `packages/core/src/paths.ts:139-153`).
- A managed runtime is `<data>/runtime/<version>-<package>/`, and its CLI entry is
  `node_modules/<package>/dist/cli.mjs` (`packages/core/src/mcp-install.ts:299-321`). The 0.13.0 installer creates that
  final directory, writes its manifest and runs exact `npm install` directly in it; a failed install can therefore
  leave a partial final-path runtime (`packages/core/src/mcp-install.ts:413-475`). A managed MCP entry runs an
  absolute Node with the runtime entry and `mcp` (`packages/core/src/mcp-install.ts:518-580`).
- Managed install also writes outside the runtime and client configuration: replacement backups and the
  handed-out-runtime ledger are deliberate examples (`packages/core/src/mcp-install.ts:1247-1275`,
  `packages/core/src/mcp-install.ts:1383-1399`). A per-user shim and installation receipt are therefore a new kind of
  managed bookkeeping, not the first durable installer state outside those two locations.
- npm creates a package-local `node_modules/.bin/<binary>`, but that directory is not on the person's PATH. Each
  package repeats its user command in top-level `bin` and `agentcomms.binary`, for example core
  (`packages/core/package.json:24-25`, `packages/core/package.json:57-63`) and Gmail
  (`packages/gmail/package.json:24-25`, `packages/gmail/package.json:60-79`). The manifest schema checks the binary's
  grammar but does not prove it equals the top-level `bin` key (`packages/core/src/channel-manifest.ts:166-181`,
  `packages/core/src/channel-manifest.ts:254-261`). The implementation must validate that equality before publishing.
  Server-only bins such as `agent-gmail-mcp` are not terminal CLIs.
- The install result reports the MCP entry, registration and handshake, but no CLI or PATH result
  (`packages/core/src/mcp-install.ts:1383-1430`). Registration can pass while every printed bare command fails.

### 2.2 Update and prune know runtimes, not terminal shims

- `comms_update` derives channel packages from the manifest-backed registry rather than a hand-written channel list
  (`packages/core/src/operations/update.ts:55-67`). It installs a runtime only when a registration needs it and the
  exact runtime is absent (`packages/core/src/operations/update.ts:334-360`), then re-registers clients and updates
  global packages (`packages/core/src/operations/update.ts:906-988`). There is no shim step, and a reusable latest
  runtime causes no install step.
- Prune lists version-shaped directories containing the package, keeps current, registered, handed-out and running
  runtimes, then calls recursive `rm` directly on the rest (`packages/core/src/mcp-install.ts:1591-1627`,
  `packages/core/src/mcp-install.ts:1629-1750`). Recursive deletion is not atomic. Adding a symlink or wrapper without
  a quarantine protocol would leave it dangling or pointing into a partially deleted runtime.
- Managed MCP registrations intentionally receive a minimal PATH containing the selected Node directory and system
  locations, not `~/.local/bin` (`packages/core/src/mcp-install.ts:261-280`). A healthy login terminal and its MCP
  server can therefore report different command discovery.
- Existing file locking treats a holder as stale after 30 seconds unless renewal is requested; renewal is already a
  supported option (`packages/core/src/lock.ts:157-163`, `packages/core/src/lock.ts:219-229`). npm can exceed that
  interval. The filesystem layer also has a POSIX directory-fsync helper, even though its ordinary atomic writer does
  not sync the directory after rename (`packages/core/src/fs.ts:66-89`, `packages/core/src/fs.ts:135-147`).

### 2.3 Doctor and terminal handoffs expose the gap

- Core doctor checks Node, directories, config, secret storage, update state and registrations
  (`packages/core/src/operations/maintenance.ts:69-171`). Registration health checks the absolute Node and entry, but
  no check asks whether a person can run a CLI (`packages/core/src/operations/maintenance.ts:270-330`,
  `packages/core/src/mcp-install.ts:392-410`). The same `doctor` operation backs `agentcomms doctor` and
  `comms_doctor` (`capabilities.json:13-18`).
- `shellCommand(words, platform)` safely prints POSIX words. On Windows it prints only the subset that cmd.exe and
  PowerShell pass alike; unsafe words become inert JSON plus instructions rather than a runnable line
  (`packages/core/src/cli-runtime.ts:67-129`, `packages/core/src/cli-runtime.ts:145-191`). This command rendering has
  existed since 0.12.3. It does not resolve its first word: a safely rendered missing command is still missing.
- Change approvals construct bare channel commands and repeat them in pending/next-step results
  (`packages/core/src/changes.ts:73-98`, `packages/core/src/changes.ts:265-283`,
  `packages/core/src/changes.ts:461-465`). The shared approval store and daily-update stop also print bare
  `agentcomms approve`, `agentcomms update` and `agentcomms update --later`
  (`packages/core/src/approvals.ts:889-897`, `packages/core/src/update-state.ts:305-347`,
  `packages/core/src/update-gate.ts:383-414`).
- Gmail, Slack and Resend send prepare/claim paths print bare approval commands
  (`packages/gmail/src/operations/send.ts:386-455`, `packages/gmail/src/operations/send.ts:585-612`,
  `packages/slack/src/operations/send.ts:573-605`, `packages/slack/src/operations/send.ts:640-671`,
  `packages/resend/src/operations/send.ts:342-368`, `packages/resend/src/operations/send.ts:549-565`). Their CLI
  refusal paths repeat them (`packages/gmail/src/cli/program.ts:1281-1302`,
  `packages/slack/src/cli/program.ts:1315-1342`, `packages/resend/src/cli/program.ts:605-622`), as does Gmail's
  untrusted-client MCP fallback (`packages/gmail/src/mcp/server.ts:2381-2393`).
- The inventory is wider than send approvals. It includes Gmail confirm-client completion
  (`packages/gmail/src/mcp/server.ts:2481-2487`), WhatsApp post-add sync
  (`packages/whatsapp/src/operations/accounts.ts:107-112`), Slack reauthentication failures
  (`packages/slack/src/auth/refresh.ts:168-170`), Resend unknown-outcome status
  (`packages/resend/src/operations/send.ts:524-530`), save-destination approvals
  (`packages/core/src/save-destination.ts:648-676`, `packages/core/src/save-destination.ts:744-756`), account,
  sign-in, policy, doctor-fix, retry and post-install next steps, and every other runtime result/error/hint/`nextStep`
  that currently passes an `agentcomms` or `agent-*` first word directly to `shellCommand`. Static help and usage
  examples are grammar, not immediate machine-specific handoffs.

### 2.4 The governing contracts and the 0.13.0 rollout constraint

- A capability is one shared operation reached by CLI and MCP, with its row in `capabilities.json`
  (`CONTRIBUTING.md:59-88`). Update, install and prune have both-surface rows at `capabilities.json:208-277`; doctor is
  at `capabilities.json:13-18`. Terminal approval remains a deliberate CLI-only exception
  (`capabilities.json:241-246`).
- A channel is derived from the `agentcomms` field of its package manifest
  (`docs/superpowers/specs/2026-09-26-channel-plugins-design.md:24-55`,
  `docs/superpowers/specs/2026-09-26-channel-plugins-design.md:90-128`). A new channel must inherit shim and locator
  behaviour without a core binary list.
- The change policy binds an operation's approved effects into its preview and digest; destructive prune needs an
  approval (`docs/superpowers/specs/2026-09-25-cli-mcp-parity-design.md:29-61`). Shim reconciliation is not a new
  discretionary effect: it is bookkeeping that makes an already-approved managed runtime usable and keeps its moving
  pointer honest. D7 defines why it is deliberately outside that digest.
- The 0.13.0 updater cannot execute code that exists only in the release it is installing. It can publish and register
  a new runtime, then exit with no shim. The first new process must therefore reconcile the installed base without a
  second approval; putting shim effects into the old update plan cannot solve this rollout.

## 3. Decisions

### D1. Use one durable per-user bin directory, with an explicit opt-out

The default bin directory is:

| Platform | Default |
|---|---|
| macOS | `$HOME/.local/bin` |
| Linux | `$HOME/.local/bin` |
| Windows | `%LOCALAPPDATA%\agent-communications\bin`, falling back to `%USERPROFILE%\AppData\Local\agent-communications\bin` |

Windows has no `~/.local/bin` convention. The chosen location is per-user, non-roaming and beside the application's
existing local data. The program never writes `/usr/local/bin`, `/etc/paths`, a shell profile, the registry, or the
Windows user PATH.

`AGENT_COMMS_BIN_DIR` may seed an absolute override for locked-down hosts and tests. The resolved directory is then
stored in `<dataDir>/managed-install.json`, written atomically and owner-only, so a CLI and an MCP server with different
environments still use the same directory. Once stored, that value is authoritative. A different later environment
override is reported as `bin-directory-conflict` and does not create a second set of shims; relocation requires an
explicit future migration, not ambient environment drift. The metadata also records the shim schema and completion of
the one-time rollout reconciliation.

Shims default on. Either `defaults.cliShims: false` or `AGENT_COMMS_CLI_SHIMS=off` opts the process out; the environment
value is the emergency/per-process override and only the ASCII case-insensitive word `off` has that meaning. With
either opt-out, create, repoint, remove and startup reconciliation are skipped. Existing owned shims are left untouched
rather than silently deleted, and doctor reports `disabled` without calling their absence a failure. The config field
is the durable machine preference; the environment override is intentionally not persisted.

The directory is created only when enabled bookkeeping applies to an existing managed runtime. `--print`, `--check`,
`--dry-run`, npx and local launchers do not create it. POSIX creation is owner-only; an existing directory's mode is
reported but not changed. Windows inherits the user's ACL.

Every installed runtime also carries an owner-only `<runtime>/.agentcomms-runtime.json` receipt. It records receipt
version, package, manifest binary, package version, entry relative to the runtime, the absolute Node path and the Node
version observed at install. An entry is never recovered from untrusted receipt text without revalidating that it
stays under the runtime and matches the installed package.

### D2. Publish owned wrappers, not symlinks

The shared managed-runtime layer validates that `agentcomms.binary` names an executable top-level package `bin`, then
publishes that one user CLI. Server-only aliases are excluded. Current manifests therefore produce the five commands
in §1; future channels inherit the rule.

On macOS and Linux, `<binDir>/<binary>` is an executable `/bin/sh` wrapper which `exec`s the absolute Node and absolute
runtime entry with `"$@"`. That preserves the argv the POSIX shell already produced and replaces the wrapper process.

On Windows the owned unit has two files:

- `<binDir>\<binary>.cmd`, an npm-style batch shim for cmd.exe, Windows PowerShell and PowerShell 7; and
- extensionless `<binDir>\<binary>`, a POSIX shell wrapper for Git Bash/MSYS.

The `.cmd` invokes the managed Node and entry followed by `%*`. It accepts cmd.exe's argument handling exactly as npm's
global CLI shims do; it does **not** promise exact arbitrary argv preservation on Windows. In particular, `%*` is
reparsed by cmd.exe, and callers must not use the shim for programmatic untrusted arguments. Commands this project
prints already avoid that trap: `shellCommand` prints a line only for the cross-shell-safe subset and emits inert JSON
for unsafe words. Internal programmatic execution uses absolute Node plus entry, never `.cmd`.

The batch renderer begins with delayed expansion disabled and safely represents literal Node/entry paths, including
spaces, `%`, `!`, `&`, `^` and parentheses. It uses no parenthesised command block: each path is assigned with
`SET "_agentcomms_node=…"` / `SET "_agentcomms_entry=…"`, with each literal `%` doubled in the batch source, then the
last line is `"%_agentcomms_node%" "%_agentcomms_entry%" %*`. Windows forbids a literal `"` in either path; delayed
expansion is off for `!`, and the quoted assignment/invocation keeps the remaining metacharacters data. Ownership
data never appears as raw JSON in batch syntax. The second line has this fixed prefix followed only by base64url
characters encoding canonical JSON:

```
REM agent-communications managed-cli-shim v1 <base64url-json>
```

The extensionless/POSIX wrapper uses the same fixed marker in a shell comment; base64url is used there too so one
parser and one canonical payload define ownership. The payload names binary, package, version, absolute Node, relative
entry, data directory and a transaction generation. The complete bytes must equal the deterministic renderer.

No `.ps1` is created. PowerShell can prefer it over `.cmd`, after which execution policy may refuse it while ignoring
the usable `.cmd`; it would also introduce a third sibling and another non-atomic recovery case without improving the
npm-compatible command contract.

Ownership fails closed:

1. `lstat`, never `stat`, examines the expected path and both Windows siblings. A symlink, directory or device is not
   ours.
2. A regular file is ours only when the marker decodes, names the exact manifest binary/package and this `dataDir`,
   its runtime/entry is valid, and all bytes equal the deterministic renderer.
3. An existing path that is not ours is never overwritten, moved, chmodded or deleted. The result names the collision
   and asks the person to inspect and move it; it never prints an `rm` or `del` command.
4. Creation is exclusive. Replacement rechecks ownership while holding the shim lock, renames only the proved-owned
   old file to its journalled backup, then publishes the flushed stage with a same-directory no-replace link. A file
   arriving at the public name makes publication fail and is left untouched; the old owned file is restored only when
   the name remains vacant. A filesystem without that atomic no-replace primitive is reported and refused rather than
   weakened to an overwrite rename. One foreign Windows sibling blocks both.

The marker prevents accidental ownership mistakes; it is not a boundary against the same hostile OS user, which the
base threat model already excludes.

### D3. Install, repoint and prune are recoverable transactions

There is one renewing shim/runtime lock per managed installation, not separate unsynchronised locks per adapter. Every
acquisition first reconciles owned transaction journals, stage files, quarantine directories and half-updated Windows
pairs. Names contain an unguessable token and an owned journal; an unrecognised similarly named path is foreign and is
not touched. Each file is flushed before publication, and the containing directory is fsynced after every rename,
link or unlink on platforms that support directory fsync.

**Install and reuse.** A missing runtime is built in a private temporary directory under the final runtime's parent,
on the same filesystem. The installer holds and renews the lock while npm runs. It verifies the exact dependency,
installed version, manifest binary, entry, Node executable/version and minimum Node 22.12 contract, writes and flushes
the runtime receipt, then publishes the complete directory with one atomic rename and fsyncs the runtime parent. Node
22.12 is the repository runtime floor (`docs/superpowers/specs/2026-09-18-agent-communications-design.md:76`,
`packages/core/src/operations/maintenance.ts:82`). The final path must be absent; rename-across-filesystems is refused.
A failed install never leaves a final-path runtime;
the next lock acquisition removes a recognised abandoned stage. An existing exact runtime is reused only after the
same validations; pre-0.13 receipts are handled by D4's rollout migration.

After a runtime is published or proved reusable, reconciliation creates or repoints its shim. POSIX uses one staged
wrapper. Windows stages and flushes both siblings and records the intended generation before changing either; recovery
finishes both to that generation or restores both old owned files. It never treats a mixed pair as healthy. A crash can
make a command briefly absent, but a fresh process deterministically repairs it before other shim work.

**Update.** Runtime install remains an update step; shim reconciliation follows as bookkeeping even when the latest
runtime was already reusable and no runtime step ran. For each manifest binary, it points to the highest compatible
exact reusable runtime, preferring the version of the running release. Registrations follow. A runtime failure cannot
repoint its shim; a shim collision does not undo a sound runtime or registration, and the result reports the collision
plus an absolute command. Other products continue independently.

**Prune.** Under the same lock, prune revalidates the approved runtime and any owned shim that still targets it. Apply
then performs this order:

1. atomically rename the whole runtime into a unique quarantine beneath the same runtime parent, refusing `EXDEV` or
   any layout that cannot guarantee a same-filesystem rename; fsync the parent;
2. remove only owned shim files which still target that runtime, transactionally remove both Windows siblings, and
   fsync the bin directory;
3. recursively delete the quarantined directory.

If shim removal cannot complete, recovery restores the owned pair and atomically renames the intact quarantine back
before any recursive deletion. Once recursive deletion begins, the shim is already gone and is never restored. A
partial or failed recursive delete leaves reported debris only in quarantine, never a shim pointing into a partially
deleted final runtime. A crash after quarantine can leave the old command temporarily missing; the next fresh process
recovers that journal before doing anything else. Recognised quarantine is either restored when the shim transaction
never committed or deletion is resumed after it did. No foreign path is removed.

This transaction protocol, not the current 0.13.0 implementation, makes published versioned runtimes immutable and
prevents a completed operation from exposing a half-installed or half-deleted target.

### D4. The first new core reconciles the 0.13.0 installed base once

Before dispatching **any** `agentcomms` command, and before the core MCP server starts accepting tools, the new core
checks the durable bootstrap marker. If shims are enabled and the marker is absent, it takes the lock, recovers
transactions, inventories every managed runtime, and reconciles one shim for every installed manifest product. This
applies immediately and needs no approval. It performs no npm or network work and never creates a shim for a runtime
that does not already exist.

For each pre-receipt 0.13.0 runtime, migration validates the exact package and entry, then obtains Node from a matching
managed registration when possible, otherwise from the validated current Node. It writes a receipt only after the
Node exists, is executable, reports its version, and meets Node 22.12. If neither source is valid, it leaves that shim
missing and records the reason. One shim per binary selects the running release's exact runtime when present, otherwise
the highest reusable version; all runtimes are examined so obsolete and malformed ones are not mistaken for targets.

The atomic bootstrap marker is written only after every product has a recorded outcome, including foreign collision
or no valid Node. A crash before it commits retries from transaction recovery; a completed-but-blocked outcome is not
retried on every command, but install/update can reconcile again and doctor keeps reporting it. Pending 0.13.0
approvals remain valid because shim bookkeeping is outside their effect digest.

Startup reconciliation is distinct from the doctor operation. Thus a first `agentcomms doctor` may trigger the one-time
upgrade bookkeeping before doctor runs, but doctor itself remains read-only.

### D5. Verify only this process's PATH and give shell-specific instructions

After create or repoint, POSIX verification invokes a fixed `/bin/sh` with the binary in a positional parameter and
runs `command -v` without `-l`, `-i` or interpolation. Windows applies normal filesystem/PATH/PATHEXT discovery with
case-insensitive `Path`/`PATHEXT` handling and compares the canonical result with the owned `.cmd`. The result status is
one of:

- `process-path-ready`: this process resolves the expected owned shim;
- `process-path-missing`: the persisted bin directory is absent from this process's PATH;
- `process-path-shadowed`: a different external command is found first;
- `shim-blocked`, `shim-stale`, `shim-partial` or `bin-directory-conflict`; and
- `disabled`.

The object carries `pathScope: "process"`, bin directory, expected and resolved paths, runtime, Node and entry. It never
calls this proof of the person's terminal. An MCP process commonly has the minimal registration PATH; `/bin/sh` also
cannot observe a zsh/bash/fish function or alias, and filesystem search cannot observe a PowerShell alias/function.

The program does not launch a login or interactive shell and does not parse startup files. Doing so could prompt,
hang, mutate state or expose output from arbitrary user code. It may inspect `SHELL` and the existence of conventional
profile files only to label instructions. When the bin directory is missing from the process PATH, install, update and
doctor return the exact applicable instruction:

- zsh: add `export PATH="$HOME/.local/bin:$PATH"` to `~/.zprofile`;
- bash: add the same line to the first login file bash will use (`~/.bash_profile`, `~/.bash_login` or `~/.profile`),
  naming that exact file; if none exists, name `~/.bash_profile` on macOS and `~/.profile` on Linux;
- fish: run `fish_add_path "$HOME/.local/bin"` once; and
- Windows: Environment Variables → User variables → `Path` → New → the exact persisted bin directory, then open a
  new terminal. It may also show safely rendered one-session `set "PATH=<binDir>;%PATH%"` and
  `$env:Path = '<binDir>;' + $env:Path` forms, but never runs them.

An overridden POSIX path is shell-quoted as a literal rather than substituted into the `$HOME` example. The result
also gives `command -v <binary>` for POSIX shells, `Get-Command <binary>` for PowerShell and `where <binary>` for
cmd.exe as person-run checks. It says explicitly that these were not run in the person's terminal.

### D6. Every runtime handoff goes through one terminal-command locator

Core provides one asynchronous locator, shared by every package. It takes the manifest product, argument words,
surface (`cli` or `mcp`) and platform, and returns structured primary/alternative commands. Every runnable form is
constructed as words and passed through `shellCommand(words, platform)`; no caller quotes or concatenates a line.

The locator validates a receipt's Node on every absolute fallback: the path must still be an executable regular file,
`--version` must identify Node at least 22.12, and the entry must still be the exact reusable runtime entry. If the
receipt's Node is invalid, it tries the current resolved Node and subjects it to the same checks. A non-Node
`process.execPath` is not accepted. If neither Node is valid, the result says that no runnable terminal command is
available and prints no pretend command.

Surface rules are intentionally different:

- **MCP handoff:** always print the validated absolute `<node> <entry> ...` command as the command to run, followed by
  the short form: “or `agent-gmail approve <id>` if `<binDir>` is on your PATH.” The same pattern applies to every
  product/argument set. The server's own PATH status never promotes the short form.
- **CLI handoff:** print the bare manifest binary only when this process resolves it to the current owned shim.
  Otherwise print the validated absolute Node-plus-entry form.

On Windows, if `shellCommand` returns no cross-shell-safe line, the existing JSON-word rendering explains that the
person must type it for their shell. The JSON is not described as a runnable line. This keeps the acceptance statement
literal: every line identified as a terminal command is safe and resolves; otherwise the result truthfully reports
words or reports that no command is available.

The migration inventory is grouped below; the lint, rather than this prose list, is the guard against a missed or new
site:

- core change approval/rerun, daily update and `update --later`, save-destination approval, organisation/secrets
  repair and doctor fixes;
- Gmail send approval/refusal, confirm-client completion, sign-in/reauth, client and inbox repair, and retry commands;
- Slack post approval/refusal, workspace sign-in/reauth/mode, app/manifest, draft and doctor commands;
- Resend send approval/refusal/status recovery, account/policy/key repair and doctor commands; and
- WhatsApp add/remove/sync, index/config repair, chat-list and approval commands.

That includes the four review-found sites cited in §2.3 and every runtime `hint`, `fix`, `next`, `nextStep` or error
that tells a person to run a CLI. Static help/usage grammar with placeholders may remain bare, but must not be
presented as the command that will work on this machine.

The source lint rejects a `shellCommand([...])` whose statically known first word is a manifest CLI binary outside the
locator. A short, commented allowlist names individual help/usage-only call sites and why each is non-runnable; there
is no directory-wide or package-wide exemption. The lint also rejects a raw template/string handoff such as
`agent-gmail approve ${id}`. Adding a new manifest binary automatically adds it to the rule.

### D7. Shim lifecycle is audited bookkeeping, not an approved effect

Creating, repointing or removing an owned shim for a managed runtime that already exists is bookkeeping of that
managed installation. It applies at once, is skipped under D1's opt-out, and never touches a foreign file. It is
**not** an approved effect and neither the persisted bin directory, shim bytes nor process PATH status participates in
an install, update or prune approval digest. A PATH difference between CLI and MCP therefore cannot invalidate an
otherwise identical plan, and a pending pre-shim approval remains claimable.

Install, update and prune invoke this bookkeeping during their apply phase. Startup performs D4's one-time repair;
doctor only reports. Shim failure does not rewrite the approved outcome: the operation returns its applied runtime or
registration result plus a non-healthy shim result and a valid absolute handoff where one exists.

Every create, repoint, remove, recovery, skip and refusal appends a core audit record naming operation, surface,
binary, package, runtime, bin path, old/new generation, outcome and reason, never command arguments or secrets. The
durable transaction journal records intent before filesystem mutation. If intent/audit cannot be recorded, the shim
mutation is skipped; after-effect audit failure leaves the owned journal for fresh-process recovery to append the
outcome before cleanup. `agentcomms audit tail` can therefore account for startup repairs as well as requested applies.

There is no new command, MCP tool or approval. Existing CLI and MCP adapters continue to call the same shared
operations:

- `mcp install` / `comms_server_install` → `serverInstallChange`;
- `update` / `comms_update` → `updateChange`;
- `mcp prune` / `comms_server_prune` → `serverPruneChange`; and
- `doctor` / `comms_doctor` → `doctor`.

Their typed results gain the same installation/shim facts, and `pnpm verify:parity` compares them. The CLI-only
terminal approval exception is unchanged.

### D8. Core doctor reports shim, receipt and recovery health

Core doctor enumerates manifest products, durable installation metadata and exact reusable runtimes. Channel doctors
do not duplicate this. For each managed product, CLI and MCP doctor report:

- enabled/disabled state, persisted bin directory, selected runtime and receipt;
- missing, foreign, malformed, stale or half-paired shim, including a target older than the selected runtime;
- missing/non-executable/non-Node/too-old recorded Node, invalid entry containment, missing entry or receipt mismatch;
- unresolved owned transaction stages, quarantine debris or an incomplete bootstrap marker;
- `process-path-missing`, `process-path-shadowed` or `process-path-ready`; and
- the absolute runnable command, or the exact reason none can be produced, plus the shell-specific PATH instruction.

Missing, malformed, stale, partial, foreign and invalid-receipt states are failed checks. Quarantine debris after a
completed prune is a failed cleanup check without a dangling-shim claim. A valid shim absent or shadowed only in this
process is a warning because it says nothing conclusive about the person's terminal. Disabled is informational.

After D4's startup hook has run, doctor is read-only: it does not repair, delete debris, edit PATH or claim an
approval. Its normal fix is the locator-produced `agentcomms update`; a foreign collision is for the person to inspect
and move, never for doctor to delete.

## 4. Tests owed

Every new guard is watched failing under a named mutation, then restored.

1. **Paths, metadata and opt-out.** Table-test macOS, Linux and Windows with `HOME`, `USERPROFILE`, `LOCALAPPDATA`,
   `XDG_DATA_HOME` and `AGENT_COMMS_BIN_DIR` pinned/cleared in a temporary root. Prove the persisted bin directory wins
   across different CLI/MCP environments, conflict is reported, config false and env `off` skip every mutation, and
   unknown env values do not opt out. Mutation: fall back to `homedir()` or re-resolve the override per process; the
   sandbox or cross-surface test fails.
2. **POSIX wrapper.** Golden bytes/marker, mode and execution from zsh, bash and fish. Preserve empty arguments,
   embedded quotes, `$`, `%NAME%`, `!NAME!`, `^`, metacharacters, trailing backslashes and CR/LF exactly as the invoking
   POSIX shell delivers them; propagate signal/exit status. Exercise Node/data/bin paths with spaces, `%`, `!`, `&`,
   `^` and parentheses. Mutation: use `env node`, omit `exec`/`"$@"`, or use a symlink; a test fails.
3. **Windows wrapper contract.** Golden `.cmd` and Git Bash bytes, base64url metadata and no `.ps1`. Run from cmd.exe
   with delayed expansion both on and off, Windows PowerShell 5.1, PowerShell 7 and Git Bash/MSYS. Compare `.cmd`
   argument behaviour for empty strings, quotes, `%NAME%`, `!NAME!`, `^`, metacharacters, trailing slashes and CR/LF
   to an npm-generated control shim; do not assert impossible exact argv. Prove `shellCommand` emits no runnable line
   for unsafe cases. Cover Node/data/bin paths containing spaces, `%`, `!`, `&`, `^` and parentheses without executing
   marker data. Node `spawn`/`execFile` tests document that direct `.cmd` execution is rejected/unsupported and prove
   internal execution instead uses absolute Node plus entry. Mutation: raw JSON after `REM`, enabled delayed expansion,
   unescaped path text, a `.ps1`, or a false exact-argv assertion fails.
4. **Ownership.** Foreign regular files, symlinks, directories, devices, malformed markers, wrong package/runtime/data
   markers and one foreign Windows sibling remain byte-for-byte untouched by install, update, startup, doctor and
   prune. Race an exclusive create. Mutation: trust a marker without canonical bytes or overwrite a foreign target;
   the test fails.
5. **Atomic install.** Kill the process after every temp creation, npm completion, receipt write/fsync, rename and
   directory-fsync boundary; start a fresh process and prove recovery. npm failure leaves no final runtime. Hold npm
   beyond the stale interval and prove lock renewal prevents takeover. Refuse cross-filesystem publish. Mutation: run
   npm in the final directory, omit receipt verification/fsync or omit renewal; a test fails.
6. **Sandboxed install, every CLI.** With both `HOME` and `USERPROFILE` pinned, install core, Gmail, Slack, Resend and
   WhatsApp from the manifest registry, prepend only the sandbox bin directory to PATH, and prove `command -v` (plus
   Windows `where`/`Get-Command`) resolves every binary through its owned shim and `<binary> --version` runs. Assert no
   real-home file changed. `--print`, npx and local launchers create nothing.
7. **Update, pair recovery and repair.** Start every CLI at A, update to B and prove the same names report B before A
   is pruned. Cover absent B, reusable B with missing/stale shim, removed A Node, foreign collision and independent
   product failure. Terminate after every journal, stage, file fsync, rename, Windows first-sibling, second-sibling and
   directory-fsync step; a fresh process must produce one generation, never accept a mixed pair. Mutation: couple shim
   work only to runtime install or leave the A entry; a test fails. `--check` is read-only but reports drift.
8. **Prune and partial deletion.** Dry run/approval continue to bind runtime deletion, not shim bookkeeping. Apply
   quarantines by same-filesystem rename, fsyncs, removes an owned target only if it still names that runtime, then
   deletes quarantine. Inject termination after every quarantine, shim and fsync step and after each recursive-delete
   child; fresh recovery either restores the intact runtime before deletion or leaves/retries reported quarantine
   debris with no shim. Mutation: recursively delete the final path, restore a shim after partial deletion, omit
   directory fsync or remove by filename without ownership; a test fails.
9. **0.13.0 rollout and old approvals.** Have 0.13.0 update install the new runtimes with no receipts/shims; start the
   new `agentcomms` and core MCP server separately and prove each one-time path reconciles all products without a second
   approval. Cover Node recovered from registration, validated current Node, no valid Node, collision, opt-out, crash
   before bootstrap commit and an already-pending 0.13 install/update/prune approval whose digest remains valid.
   Mutation: require a shim-only approved update or mark bootstrap before all outcomes are durable; a test fails.
10. **Receipt and absolute fallback.** Cover recorded Node healthy, removed, replaced by a non-Node executable, below
    minimum or reporting another version; current Node healthy/invalid; orphan runtime; non-Node `process.execPath`;
    escaped relative entry; and no available command. Mutation: trust receipt text or executable bit alone; a test
    fails.
11. **Process PATH and guidance.** Cover ready, missing directory, earlier executable, alias/function shadowing and
    stale/foreign states with an MCP minimal PATH and a different simulated terminal PATH. Cover `Path`/`PATHEXT`
    casing on Windows. Assert exact zsh, bash-file-selection, fish `fish_add_path`, PowerShell and cmd.exe instructions,
    and that no profile/registry is edited. Startup fixtures that prompt, write a sentinel or print a fake token prove
    no login/interactive shell is run. Mutation: call the status `ready`, launch `-l`/`-i`, or use the POSIX export line
    for fish; a test fails without printing the fixture token.
12. **Every handoff and the locator lint.** Exercise CLI and MCP forms for approvals, update/`--later`, save
    destinations, Gmail/Slack/Resend sends and refusals, Gmail confirm-client completion, WhatsApp sync, Slack reauth,
    Resend status recovery, account/sign-in/policy/doctor/retry results and every call site found by the lint. MCP always
    leads with executable absolute Node+entry and conditional short form; CLI uses bare only for the resolved owned
    shim. Execute safe printed lines against harmless fake entries and verify their words. Lint fixtures reject direct
    `shellCommand(['agent-…'])`, raw template handoffs and a new manifest binary; documented help/usage allowlist entries
    pass. Mutation: bypass locator at any inventoried site; lint or its site test fails.
13. **Audit, doctor and parity.** Prove each bookkeeping outcome is durable/audited, an audit failure prevents or leaves
    a recoverable journal around the mutation, and no shim/PATH fact changes an approval digest. CLI and MCP return the
    same missing/stale/malformed/foreign/partial/receipt/quarantine/process-PATH checks and shared-operation results.
    Mutation: do shim work in an adapter, omit an audit outcome or include PATH in the digest; parity/state tests fail.
14. Run full `pnpm verify`. No test contacts Gmail, Slack, Resend or a real npm registry, reads/writes the real home,
    edits a profile/registry/keychain, or contains a real address, token or client secret.

## 5. Out of scope

- Installing a managed runtime solely to provide a CLI for an npx, global or checkout-only product.
- Publishing `agent-gmail-mcp` or another server-only bin.
- Editing shell profiles, macOS path-helper configuration, `/usr/local/bin`, `/etc/paths`, the Windows registry or
  user PATH.
- Executing or parsing login-shell configuration, or proving how aliases/functions in an unseen terminal resolve.
- Exact arbitrary argv preservation through Windows `.cmd`, a native Windows launcher, or programmatic `.cmd` spawn.
- Relocating an already persisted bin directory; that needs an explicit migration with ownership checks.
- A general package manager/uninstaller redesign, system-wide install, shell completions or Windows installer.
- Changing send policy, change policy, approval meaning, the send gate or terminal-only approval exception.

## 6. Risks and handling

| Risk | Handling |
|---|---|
| The MCP PATH differs from the person's terminal | Status is explicitly `process-path-*`; MCP always leads with validated absolute Node+entry and labels the bare form conditional |
| `~/.local/bin` is not initially on PATH | Acceptance attaches to returned commands, not bare discovery; give exact zsh/bash/fish instructions without editing profiles |
| A pre-existing command is destroyed | Canonical ownership, `lstat`, exclusive creation and recheck under the lock; foreign files and symlinks are never changed |
| Windows metadata or target paths become batch syntax | Base64url marker, delayed expansion disabled and a tested literal-path renderer; no raw metadata is interpreted by cmd.exe |
| Windows `.cmd` changes arbitrary arguments | Promise npm-compatible `%*` behaviour only; print just the existing safe subset and use absolute Node+entry for programmatic execution |
| Install dies during npm | Build/verify/receipt in a private same-filesystem stage, renew the lock, atomically publish and recover owned stages |
| Update dies between Windows siblings | Durable generation journal and recovery on every lock acquisition converge both siblings or restore both old owned files |
| Prune partially deletes a runtime | Atomic quarantine comes first and shim removal precedes recursive deletion; failed deletion leaves reported quarantine debris, never a restored shim |
| A power loss forgets a rename | Flush files and fsync the containing directory after each rename where supported; fresh-process crash tests cover each boundary |
| The 0.13.0 updater cannot create shims | First new CLI command/core MCP start reconciles existing runtimes once, immediately and outside approval |
| CLI and MCP choose different custom bin directories | Persist the first resolved directory in installation metadata; later conflicting environment is diagnosed, not followed |
| Recorded Node disappears or is replaced | Receipt records path/version, locator revalidates executable identity and minimum version, then validates current Node or prints no command |
| A same-user hostile process forges ownership | Not a security boundary; exact bytes/target checks prevent accidents while retaining the base design's same-user threat boundary |
