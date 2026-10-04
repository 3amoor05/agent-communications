# CUE-403 — the CLIs on PATH after install and update — design

Status: **proposed 2026-10-04 against the 0.13.0 release (`6d4694e`). No implementation is in this change.** This
design adds the terminal half that the managed installer has never installed: one owned command shim for the core and
for each managed channel runtime, kept in step with update and prune.

## 1. What was asked

The owner reproduced CUE-403 after a managed install. `agentcomms`, `agent-gmail`, `agent-slack`, `agent-resend` and
`agent-whatsapp` existed only below their versioned runtimes, not on `PATH`. A result that said “run
`agent-gmail approve <id>` in a terminal” therefore handed the person a command their terminal answered with
`command not found`. Under `confirm`, and for escalated sends, that terminal can be the only approval route.

The fix is to make a managed install and `comms_update` publish the core CLI and every installed channel CLI into a
per-user bin directory, repoint them on update, and remove them safely with the runtime they name. The result must
check whether the command actually resolves on the current `PATH`, explain when it does not, and give the exact PATH
addition. `agentcomms doctor` and `comms_doctor` must find missing, stale, shadowed and foreign shims. Until PATH is
fixed, every runtime message asking a person to run a terminal command must give a command that works on this machine,
using the absolute managed Node and CLI entry rather than a bare binary.

The program never edits a shell startup file or the Windows user PATH. It tells the person what to add.

## 2. What is true, and was checked

### 2.1 The managed runtime has the CLI, but the installer publishes no user command

- The default data directory is `~/.local/share/agent-communications` on macOS and Linux and
  `%LOCALAPPDATA%\agent-communications` on Windows. `ResolvedPaths` has config, state, secrets, data and downloads,
  but no bin directory (`packages/core/src/paths.ts:12-26`, `packages/core/src/paths.ts:37-66`). Its home resolution
  deliberately honours a supplied `HOME` or `USERPROFILE`, after real-home writes escaped earlier tests
  (`packages/core/src/paths.ts:69-101`, `packages/core/src/paths.ts:139-153`).
- A managed runtime is `<data>/runtime/<version>-<package>/`, and its CLI entry is
  `node_modules/<package>/dist/cli.mjs` (`packages/core/src/mcp-install.ts:299-321`). The installer writes a small
  package and runs an exact `npm install` there, then returns only that entry
  (`packages/core/src/mcp-install.ts:413-475`). A managed MCP entry runs the absolute Node with that entry and `mcp`;
  nothing writes outside the runtime or the MCP client configuration (`packages/core/src/mcp-install.ts:518-580`).
- npm also makes a package-local `node_modules/.bin/<binary>`, but that directory is not added to the person's PATH.
  The user-facing binaries are declared once by each package: `agentcomms` (`packages/core/package.json:24-25`),
  `agent-gmail` (`packages/gmail/package.json:24-25`), `agent-slack` (`packages/slack/package.json:24-25`),
  `agent-resend` (`packages/resend/package.json:24-25`) and `agent-whatsapp`
  (`packages/whatsapp/package.json:24-25`). The channel manifest repeats the user CLI as `agentcomms.binary`; Gmail's
  separate `agent-gmail-mcp` is a server bin, not the terminal CLI (`packages/gmail/package.json:60-79`).
- The install result reports the MCP entry, registration and handshake, but has no CLI/PATH result
  (`packages/core/src/mcp-install.ts:138-174`, `packages/core/src/mcp-install.ts:1401-1430`). A registration can
  therefore verify perfectly while the command printed for the person does not exist.

### 2.2 Update and prune know runtimes, not terminal shims

- `comms_update` derives every channel package from the manifest-backed registry rather than a hand-written channel
  list (`packages/core/src/operations/update.ts:55-67`). It installs a latest runtime only when a managed registration
  needs one and the exact runtime is absent (`packages/core/src/operations/update.ts:334-360`), then re-registers the
  clients and finally updates global packages (`packages/core/src/operations/update.ts:906-988`). There is no step
  that creates or repairs a CLI command. If the newest runtime already exists, no runtime step runs at all.
- Prune lists only version-shaped directories containing the channel package
  (`packages/core/src/mcp-install.ts:1591-1627`). It keeps current, registered, handed-out and running runtimes, and
  removes the rest (`packages/core/src/mcp-install.ts:1629-1750`). It neither treats a terminal command as a reference
  nor removes one, so adding a symlink without changing prune would eventually leave it dangling.
- Install, update and prune already run as shared operations from CLI and MCP. Registering a server is an approved
  change even when its effects are outside `config.json` (`packages/core/src/operations/servers.ts:50-65`); its preview
  already binds the runtime install and the client entry (`packages/core/src/operations/servers.ts:313-433`). Prune's
  dry run becomes the deletion effects bound into its approval (`packages/core/src/operations/servers.ts:447-500`).
  Update likewise binds every runtime, registration and global-package effect
  (`packages/core/src/operations/update.ts:689-699`, `packages/core/src/operations/update.ts:765-824`).

### 2.3 Doctor and command rendering expose the gap

- Core doctor checks Node, config/state directories, config, secret storage, the update check and MCP registrations
  (`packages/core/src/operations/maintenance.ts:69-171`). Registration health asks whether the absolute Node and entry
  still exist, but no check asks whether a person can run a CLI (`packages/core/src/operations/maintenance.ts:270-330`,
  `packages/core/src/mcp-install.ts:392-410`). The same `doctor` operation backs `agentcomms doctor` and
  `comms_doctor` (`capabilities.json:13-18`).
- `shellCommand(words, platform)` safely quotes words for POSIX shells or for the common subset of cmd.exe and
  PowerShell, and refuses to print a Windows line it cannot preserve. `inlineCommand` and `commandText` render that
  result (`packages/core/src/cli-runtime.ts:67-129`, `packages/core/src/cli-runtime.ts:152-191`). It does not resolve
  the first word; a safely quoted missing command is still missing.
- Change approvals construct bare channel approval commands (`packages/core/src/changes.ts:73-98`), put them in the
  pending and next-step messages (`packages/core/src/changes.ts:265-283`, `packages/core/src/changes.ts:461-465`),
  and the shared approval store still has a bare `agentcomms approve` fallback
  (`packages/core/src/approvals.ts:889-897`). The daily update stop holds bare `agentcomms update` and
  `agentcomms update --later` as constants (`packages/core/src/update-state.ts:305-347`) and repeats them in
  non-interactive terminal errors (`packages/core/src/update-gate.ts:383-414`).
- The three outward-send paths all hand over bare approval commands: Gmail prepare and claim
  (`packages/gmail/src/operations/send.ts:386-455`, `packages/gmail/src/operations/send.ts:585-612`), Slack's shared
  send handoff (`packages/slack/src/operations/send.ts:573-605`, `packages/slack/src/operations/send.ts:640-671`),
  and Resend prepare and claim (`packages/resend/src/operations/send.ts:342-368`,
  `packages/resend/src/operations/send.ts:549-565`). Their `approve` commands' own refusals repeat the same bare
  command (`packages/gmail/src/cli/program.ts:1281-1302`, `packages/slack/src/cli/program.ts:1315-1342`,
  `packages/resend/src/cli/program.ts:605-622`). Gmail's untrusted-client fallback does too
  (`packages/gmail/src/mcp/server.ts:2381-2393`). Download-location approvals go through the same change-command
  builder (`packages/core/src/save-destination.ts:648-676`, `packages/core/src/save-destination.ts:744-756`).
- This inventory was made across `packages/core|gmail|slack|resend|whatsapp` for “terminal”, `approve` and
  `update --later`. Static help, README examples and MCP descriptions that show a grammar such as
  `agent-gmail approve <id>` are syntax, not an immediate command with an id. Runtime results, errors, hints and
  `nextStep` fields that tell the person to act are the sites governed below. Static descriptions must direct the
  caller to the exact command in the result instead of presenting a bare example as the handoff.

### 2.4 The governing contracts

- A capability must be one operation called by its CLI and MCP adapters, with the row in `capabilities.json`
  (`CONTRIBUTING.md:59-88`). Core install, prune, update and doctor already have both-surface rows
  (`capabilities.json:208-277`); terminal approval is the deliberate exception because a tool cannot be the person at
  a terminal (`capabilities.json:241-246`).
- A channel's binary comes from its `package.json` manifest; the core snapshot and tooling derive the channel set from
  those manifests (`docs/superpowers/specs/2026-09-26-channel-plugins-design.md:24-55`,
  `docs/superpowers/specs/2026-09-26-channel-plugins-design.md:90-128`). A new channel must acquire PATH behaviour
  without another core list.
- The change policy binds anything outside config that an operation will do into the preview, and destructive prune
  needs an approval (`docs/superpowers/specs/2026-09-25-cli-mcp-parity-design.md:29-61`). Writing or removing a shim is
  therefore part of the existing install, update or prune change, not an unapproved side effect and not a new approval.

## 3. Decisions

### D1. One resolved per-user bin directory; the program never changes PATH

`ResolvedPaths` gains `binDir`, and `corePaths` exposes it on both surfaces.

| Platform | Default `binDir` | Persistent PATH instruction when absent |
|---|---|---|
| macOS | `$HOME/.local/bin` | Add `export PATH="$HOME/.local/bin:$PATH"` to the login shell's startup file, then open a new terminal |
| Linux | `$HOME/.local/bin` | Add the same line to the login shell's startup file, then open a new terminal |
| Windows | `%LOCALAPPDATA%\agent-communications\bin` (falling back to `%USERPROFILE%\AppData\Local\agent-communications\bin`) | Environment Variables → User variables → `Path` → New → the exact directory; open a new terminal |

There is no cross-desktop Windows equivalent of `~/.local/bin`; putting commands in the application's existing local
root keeps them per-user and non-roaming. `AGENT_COMMS_BIN_DIR` may override the default with an absolute path, for a
locked-down machine or an isolated test. It does not change `dataDir`, and `AGENT_COMMS_DATA_DIR` does not silently
move commands to a directory the person's PATH has never named.

The directory is created only for an applied managed install/update, not for `--print`, `--check`, `--dry-run`, npx or
local launchers. On POSIX it is created owner-only if absent and an existing directory's mode is not changed; on
Windows its inherited user ACL is used. The program never appends to `.profile`, `.zprofile`, `.bash_profile`, a
PowerShell profile, or the Windows environment registry. The result gives the profile line or the Windows UI steps.
For the current Windows session it may additionally show, but never run,
`$env:Path = '<binDir>;' + $env:Path` and `set "PATH=<binDir>;%PATH%"` with the directory escaped for that shell.

### D2. An owned wrapper executes the managed Node and CLI entry; it is not a symlink

Each applied managed runtime publishes only its manifest's user CLI `binary`. Server-only aliases such as
`agent-gmail-mcp` are not published. Thus the current manifests produce exactly the five commands named in §1, and a
future channel gets its CLI without a core edit.

On macOS and Linux, `<binDir>/<binary>` is an executable `/bin/sh` wrapper. On Windows, the owned set is
`<binDir>\<binary>.cmd` for cmd.exe and PowerShell plus an extensionless `<binDir>\<binary>` shell wrapper for Git
Bash/MSYS. Both forms invoke:

```
<absolute managed Node> <absolute runtime package>/dist/cli.mjs <the person's arguments unchanged>
```

The design deliberately does **not** create `<binary>.ps1`. npm creates `.cmd`, `.ps1` and extensionless siblings,
but a `.ps1` of the same name wins command discovery in common PowerShell setups and can then be refused by execution
policy while the usable `.cmd` beside it is ignored. A `.cmd` is directly runnable from both cmd.exe and PowerShell;
the extensionless wrapper covers POSIX-like Windows shells. Windows CI must prove both named-shell cases rather than
assuming npm's triplet is harmless.

A wrapper is chosen over a symlink for three reasons: it can carry ownership metadata, it fixes the same absolute Node
the MCP registration uses instead of rediscovering `node` from a terminal PATH, and it has one equivalent form on all
three platforms. The first comment after the shebang/`@ECHO off` is a fixed
`agent-communications managed-cli-shim v1` marker followed by one-line JSON metadata: binary, package, version,
absolute Node, absolute entry and data directory. JSON escaping keeps the marker one line. The rest of the file must
equal the deterministic rendering of that metadata. A marker pasted onto different content is malformed, not owned.

Ownership is fail closed:

1. `lstat`, never `stat`, examines the expected path and every Windows sibling. A symlink is not ours.
2. A regular file is ours only when the marker parses, names this exact manifest binary and package, its entry is a
   valid versioned runtime under this `dataDir`, and its complete bytes equal the renderer.
3. A path that exists and is not ours is never replaced, renamed, chmodded or deleted. The result names the collision
   and says to inspect and move it if the person wants this shim; it never prints `rm`/`del` advice.
4. New files use exclusive creation. Replacing an owned file uses same-directory staging and rename under a per-user
   shim lock, with the ownership check repeated after the lock is held. The apply step never uses an overwrite rename
   against a path it has not just proved and moved aside; a file arriving in that gap makes the write fail rather than
   get clobbered. On Windows the two siblings are one ownership unit: a foreign one blocks changes to both.

This marker is an ownership protocol, not a same-user security boundary. The base design already treats a hostile
same-OS-user process as out of scope.

### D3. Install writes, update repoints, and prune removes without a dangling interval at completion

The shared managed-runtime lifecycle owns the shim; channel adapters do not.

- **Install.** After npm has proved the exact runtime reusable, `mcp install --launcher managed` writes or repairs the
  wrapper even when the runtime was already present. The install preflight records the exact bin path, Node, entry,
  existing ownership state and planned action. Those facts and the effect (“writes/repoints the owned
  `<binary>` shim at …”) are in the change digest. If any changes before apply, the install refuses before writing the
  client entry or shim and asks to plan again. `--print`, npx and local launchers write no shim.
- **Update.** Shim work is an explicit update item and step, separate from a runtime step. That lets
  `comms_update --check` report a missing/stale shim even when the latest runtime already exists. Apply orders a
  product's work as runtime → shim → registrations; a failed runtime skips its shim, while a registration failure does
  not roll a successfully installed terminal CLI back. Every installed managed product is derived from `CHANNELS`,
  deduplicated by manifest binary. A core managed runtime produces `agentcomms`; managed channel runtimes produce their
  channel binaries. A global-only, npx-only or local-only product is left to its own installer and is not described as
  managed.
- **Prune.** A dry run reports an owned shim whose target is among the proposed runtime deletions; the change preview
  binds the shim path and its exact old target as a deletion effect. On apply, the marker and target are rechecked. If
  update already points the shim elsewhere, prune leaves it. Otherwise prune stages the owned wrapper set aside,
  removes the approved runtime, then removes the staged wrappers. If staging fails, it keeps the runtime. If runtime
  removal fails, it restores the wrappers when their paths are still free and reports both outcomes. It never returns
  with an owned wrapper pointing at a path it removed. A foreign file is never removed.

Install, update and prune serialize the same binary through the shim lock. Versioned runtimes remain immutable; the
only moving pointer is the small owned wrapper. Update therefore cannot expose a half-installed target, and prune
cannot race it into a dangling one.

### D4. PATH verification checks this process, never an unevaluated guess about the login shell

After each write/repoint, verification resolves the binary without modifying `PATH` and requires it to resolve to the
owned wrapper just written. On POSIX, a fixed `/bin/sh` runs `command -v "$1"` with the manifest binary as a positional
argument, no interpolation, and neither `-l` nor `-i`. On Windows, the check searches the supplied `PATH` and
`PATHEXT` as `where.exe` would and compares canonical paths to the owned `.cmd`. It distinguishes:

- `ready`: this process resolves the exact owned shim;
- `path-missing`: the bin directory is not on this process's PATH;
- `shadowed`: PATH resolves another file before the owned shim;
- `blocked`: an unowned file prevented the shim from being written; and
- `stale`: an owned wrapper exists but its Node/entry is missing, malformed or not the selected runtime.

The result carries the directory, wrapper paths, Node, entry, resolved command (if any), status, and
`pathScope: "process"`. `path-missing` and `shadowed` are applied installs with an action required, not claims of
failure to register the MCP server. `blocked` is a partial install/update and makes that surface return non-success
with the full result: the server may be registered, but its promised terminal route was not installed. Update has the
same rule. Doctor keeps reporting the condition until it is fixed.

The program does not start the account's login shell to discover another PATH. `zsh -lc`, `bash -lc` and equivalents
execute user startup files: arbitrary commands may prompt, hang, mutate files or print secrets, especially when called
from VS Code or Claude Code. Parsing those files is neither safe nor correct shell evaluation. A CLI normally inherits
the terminal's PATH, so its result says “this terminal process”. An MCP result says “the MCP server process; your login
terminal may differ”, shows the exact `command -v <binary>` (Windows: `Get-Command <binary>`) for the person to run,
and gives the expected path. It never says the login shell was checked.

### D5. Immediate terminal handoffs resolve the command first, with an absolute runtime fallback

Core gains one asynchronous terminal-command locator used by every package. It takes a manifest product and argument
words, chooses the executable prefix, then always calls `shellCommand(words, platform)`; callers continue to render
only with `inlineCommand`/`commandText`. No result or error assembles a runnable line in a template literal.

For a managed product it chooses, in order:

1. the bare manifest binary, only when this process's PATH resolves it to the current owned shim;
2. otherwise the absolute Node and absolute `dist/cli.mjs` recorded by the valid owned shim; or
3. if the shim is missing/blocked, the absolute Node and entry of the newest exact reusable managed runtime for that
   product.

The absolute form is deliberately `node + dist/cli.mjs`, not `node_modules/.bin/<binary>`: it avoids that second
shim's `env node` lookup on POSIX and its `.cmd`/`.ps1` split on Windows. For a non-managed process with no managed
runtime, the surface supplies its own absolute CLI entry and current absolute Node; an npx-only core update may retain
the already documented pinned npx alternative, but it must be built as words and resolved to an absolute `npx` when
one is present. If none of those exists, the result says no terminal command is available instead of printing a bare
one and pretending it will work.

This applies to:

- generic change approval, rerun and approval-store hints;
- update-now and `update --later` stops, doctor fixes and terminal prompts;
- Gmail, Slack and Resend send prepare/claim handoffs and each channel's own `approve` refusal;
- save-destination approvals and WhatsApp/configuration change approvals; and
- any other runtime result, error, hint or `nextStep` that says “run … in a terminal”.

In particular, Gmail's literal ``agent-gmail approve <id>`` claim hint becomes the exact generated id and the resolved
command. Static tool descriptions say “use the exact terminal command returned with the approval” rather than
offering the bare syntax as the actionable handoff. CLI usage and documentation may still show canonical bare syntax:
the person is already invoking that CLI, and those are grammar references rather than a machine-specific instruction.

### D6. Shim writes are part of the existing approved operations, with CLI/MCP parity

Writing outside the config directory does not make the operation unapproved. The exact wrapper path, Node, runtime
entry and whether it creates or repoints are effects of `serverInstallChange` and `updateChange`. Removing it is an
effect of `serverPruneChange`. Each is recomputed at claim time; different `HOME`, `USERPROFILE`, `LOCALAPPDATA`,
`AGENT_COMMS_BIN_DIR`, PATH resolution, runtime, Node or ownership state is plan drift and refuses the old approval.
PATH/profile instructions are output only: since the program changes neither, they are not effects.

There is no new command, tool or approval. The existing operation rows remain the parity boundary:

- every channel's `mcp install` and `comms_server_install` call `serverInstallChange`;
- `agentcomms update` and `comms_update` call `updateChange`;
- every channel's `mcp prune` and `comms_server_prune` call `serverPruneChange`; and
- `agentcomms doctor` and `comms_doctor` call `doctor`.

Their shared typed results gain the shim/PATH facts. `pnpm verify:parity` must drive and compare them. The deliberate
terminal-only `approve` exception is unchanged.

### D7. Core doctor owns shim diagnosis for every managed product

`agentcomms doctor` / `comms_doctor` enumerate the manifest registry and exact reusable managed runtimes. Channel
doctors do not duplicate the check. For each product with a managed runtime, core doctor reports:

- the expected bin path and selected runtime (the newest exact reusable managed runtime by the repository's version
  comparison);
- missing wrapper;
- foreign collision or symlink;
- malformed marker/content, wrong binary/package/data directory, missing/non-executable Node, missing entry, or a
  target older than the selected reusable runtime;
- current-process PATH missing the directory; and
- PATH shadowing the wrapper with another command.

Missing, foreign, malformed and stale wrappers are failed checks. A valid wrapper absent or shadowed only in this
process is a warning, because an MCP server's PATH is not evidence about the person's terminal; the detail says that
plainly and prints the PATH instruction and the absolute working command. A machine with only global, npx or local
installs gets no false “missing managed shim” failure. The fix for an owned missing/stale shim is the resolved
`agentcomms update` command; a foreign collision is for the person to inspect and move, never for doctor to delete.

Doctor remains read-only. It does not repair a shim, edit PATH or claim an approval.

## 4. Tests owed

Every new guard is watched failing under the named mutation, then restored.

1. **Paths.** Table tests for Darwin, Linux and Windows; `HOME`, `USERPROFILE`, `LOCALAPPDATA`, `XDG_DATA_HOME` and
   `AGENT_COMMS_BIN_DIR` pinned or cleared inside a temporary root. Defaults and override are absolute and
   `comms_paths` equals `agentcomms paths`. Mutation: replace environment-derived home with `homedir()`; the sandbox
   test must catch a path outside the temporary root.
2. **Wrapper bytes and execution.** POSIX wrapper and Windows extensionless/`.cmd` golden bytes, marker parse and exact
   render, owner-only/executable POSIX mode, paths containing spaces and quotes, all arguments and exit status preserved.
   On Windows CI, bare commands execute from cmd.exe and PowerShell with no `.ps1` present. Mutations: rediscover
   `node` from PATH, omit `"$@"`/`%*`, or create a symlink; each test fails.
3. **Ownership.** A foreign regular file, symlink, directory, malformed marker, marker with another package/entry and
   one foreign member of the Windows pair are byte-for-byte untouched by install, update, doctor and prune. A raced
   exclusive create is refused. Mutation: accept the marker without exact-content/target validation, or use an
   overwrite rename; the ownership test fails.
4. **Managed install, all products.** From the manifest registry, install core, Gmail, Slack, Resend and WhatsApp
   managed runtimes under a sandboxed home, prepend `binDir` to the test PATH, and prove `command -v` (Windows:
   `where`/PowerShell command discovery) resolves every manifest binary to its owned wrapper and `<binary> --version`
   runs. `--print`, npx and local install create nothing. The harness pins both `HOME` and `USERPROFILE` even on the
   opposite host and asserts no file under the real home changed.
5. **Update and repair.** Start every CLI at release A, update to B, and prove the same PATH names now report B before
   old runtimes are pruned. Cover: B runtime absent; B already reusable but shim missing; shim still at A; Node at A
   gone; foreign collision; one runtime or shim step failing while other products continue. Mutations: skip shim work
   when the runtime is reusable, or leave the old entry in the wrapper; the tests fail. `update --check` is read-only
   and reports shim-only drift.
6. **Prune.** Dry run and approval preview name each wrapper that will be removed. Apply removes an owned wrapper only
   when it still points at the approved runtime; a wrapper repointed meanwhile stays. Fail staging and runtime removal
   separately and assert the runtime is kept or the wrapper restored, never dangling. Foreign files stay. Mutation:
   delete the runtime before handling its wrapper, or delete by filename without checking the marker; the tests fail.
7. **PATH result.** Exact cases for ready, directory absent from PATH, shadowed by an earlier executable, foreign
   collision and stale target, on POSIX and Windows. The result contains `pathScope: process`, expected/resolved paths
   and the exact profile/UI instruction. No test mutates `process.env.PATH` to make its own verification pass.
   Mutation: treat any same-named command as ready; the shadowing test fails.
8. **No login-shell execution.** Put startup files in the sandbox that would write a sentinel, print a fake token and
   wait for input. Install, update and doctor create no sentinel, capture no token and do not wait. A process-spawn
   stand-in asserts no `-l` or `-i`. Mutation: launch the detected login shell; the test fails without exposing the
   fixture token in test output.
9. **Absolute handoffs.** With `binDir` on PATH, immediate hints use the canonical bare binary. With the server PATH
   stripped, the same Gmail, Slack and Resend send preparations/claims, core and channel change approvals,
   save-destination approvals, approve-command refusals, update stops and `update --later` messages use absolute Node +
   runtime entry, carrying the real id. Run the printed POSIX lines and the printable Windows lines against harmless
   fake CLI entries and assert the exact argument vector. Mutation: return the bare binary without resolving it; every
   package has at least one failing handoff test.
10. **Doctor and parity.** The CLI and `comms_doctor` return the same checks for missing, stale, malformed, foreign,
    shadowed and healthy shims. The install/update/prune command and tool return the same shim result and call the same
    operation in the existing capability row. Mutation: remove a doctor condition or do shim work in a CLI adapter;
    the result/parity tests fail.
11. **Printed-command lint.** Extend the existing best-effort source lint so a runtime terminal handoff cannot add a
    raw ``agent… ${…}`` or hard-coded `agentcomms update --later` line outside an explicit documentation allowlist.
    Its fixtures prove the mutation is rejected and a resolver → `shellCommand(words, platform)` call passes.
12. Run the full `pnpm verify`. No test reaches Gmail, Slack, Resend or a real npm registry, and no test reads or writes
    the real home, shell profiles, registry or keychain.

## 5. Out of scope

- Installing a managed runtime solely to provide a CLI when the product is used only through npx, a global install or
  a checkout. Those launchers keep their own command lifecycle.
- Adding `agent-gmail-mcp` or any other server-only bin to the person's PATH.
- Editing shell profiles, the macOS path helper configuration, `/usr/local/bin`, `/etc/paths`, the Windows registry or
  the Windows user PATH.
- Inferring or executing a person's login-shell configuration from an MCP process.
- A general package manager, uninstall command redesign, system-wide install, shell completions, or Windows installer.
- Changing send policy, change policy, approval meaning, the send gate, or the terminal-only approval exception.

## 6. Risks and handling

| Risk | Handling |
|---|---|
| The MCP process PATH differs from the login terminal | Report only `pathScope: process`; never claim the login shell was checked; give a person-run verification and an absolute working command |
| A pre-existing command would be destroyed | Marker + exact-content ownership, `lstat`, exclusive creation, recheck under the shim lock; foreign files and symlinks are never changed |
| Update or prune crashes between two filesystem changes | Install the immutable target first and atomically swap the small wrapper; prune stages wrappers and keeps/restores them on runtime-removal failure |
| Two clients update/prune together | One per-user lock serializes a binary, and plan/apply rechecks target and ownership; a drifted approval is refused |
| PowerShell chooses or refuses a script shim | Publish `.cmd`, not `.ps1`, and prove bare invocation from both PowerShell and cmd.exe in Windows CI |
| An old/global command shadows the managed one | PATH verification compares the resolved path, reports `shadowed`, and immediate handoffs use absolute Node + runtime entry |
| A custom home or data directory makes profile advice wrong | `binDir` is separately resolved and reported; the default profile line uses literal `$HOME/.local/bin`, while an override is printed as the exact safely escaped directory |
| A same-user hostile process forges the marker | Not a security boundary; validate marker, target and bytes to prevent accidents, while retaining the base design's T2 boundary |
