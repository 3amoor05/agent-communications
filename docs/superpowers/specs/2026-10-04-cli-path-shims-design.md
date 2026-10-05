# CUE-403 — runnable CLI handoffs from the running installation — design

Status: **proposed for 0.13.1; revised after round 5 (2 P1, 2 P2), 2026-10-05. No implementation is in
this change.**

## 1. What is being fixed

A runtime result can require a person to approve or repair something at a terminal, then print `agentcomms` or an
`agent-*` binary which is not on that person's `PATH`. Gmail send preparation and the shared change flow do that now
(`packages/gmail/src/operations/send.ts:386-455`, `packages/core/src/changes.ts:73-98`,
`packages/core/src/changes.ts:265-283`). Terminal approval deliberately has no MCP capability under `confirm`
(`docs/superpowers/specs/2026-09-25-cli-mcp-parity-design.md:148-152`).

The 0.13.1 acceptance criterion is:

> Every new terminal handoff either prints a pasteable command which does not require an agent-communications binary
> on `PATH` and fixes the config, state and required data directories to those resolved by the printing process, or
> prints no command and names the package to install plus the MCP action to use. It never prints a bare suite binary.

This fixes approvals, reruns and repairs. It does not publish shims, edit `PATH` or profiles, or change approval,
sending or change-policy semantics.

## 2. Facts the design relies on

- Managed registrations use an absolute Node command and a versioned runtime entry
  (`packages/core/src/mcp-install.ts:299-320`, `packages/core/src/mcp-install.ts:566-580`). Registered-server scans
  retain command, arguments, package and environment, and distinguish unreadable client configs
  (`packages/core/src/mcp-clients.ts:30-63`, `packages/core/src/mcp-clients.ts:376-450`). Product and pinned-version
  recognition already derive from package, binary and entry facts (`packages/core/src/mcp-install.ts:338-390`).
- A checkout launcher currently searches source and built entries, which permits a stale `dist` fallback
  (`packages/core/src/mcp-install.ts:523-559`, `packages/core/src/mcp-install.ts:583-603`). Each published manifest maps
  its primary binary to `dist/cli.mjs`, for example Gmail (`packages/gmail/package.json:24-25`).
- `resolvePaths` makes relative overrides absolute and otherwise consults XDG, `HOME`/`USERPROFILE`, `APPDATA` and
  `LOCALAPPDATA` while deriving config, state and data (`packages/core/src/paths.ts:37-66`). A registered server's
  minimal environment currently fixes only the config directory (`packages/core/src/mcp-install.ts:266-280`).
- Every channel declares its binary and package facts in `package.json`; the tooling discovers that data rather than
  keeping a channel list (`docs/superpowers/specs/2026-09-26-channel-plugins-design.md:24-52`,
  `scripts/channels.mjs:27-59`, `scripts/channels.mjs:114-150`).
- The current Windows renderer accepts only the intersection safely understood by cmd.exe and both PowerShell eras,
  and otherwise emits inert JSON (`packages/core/src/cli-runtime.ts:67-129`,
  `packages/core/src/cli-runtime.ts:136-191`).

## 3. Decisions

### D1. One structured locator; lockstep resolution in every direction

Core owns `locateCliCommand`. A request supplies the calling package's resolver URL, the target manifest, argument
words, whether the command needs the data directory, and the output platform. Success is a `PrintedCommand` (D5);
failure names the reason, package and equivalent MCP tool. Callers never supply word zero or quote a line.

The interpreter rule is one rule: the running package's own CLI and channel→core use `process.execPath`; a command
resolved from a registration uses that registration's recorded interpreter when it has one, otherwise
`process.execPath`. The only retained `process.execArgv` flags are `--experimental-strip-types`, and
`--experimental-transform-types` when the running source invocation used it. Debug, test, eval, preload/loader,
condition, warning, source-map, title and memory flags are not CLI requirements. The existing local launcher shows why
source needs type stripping (`packages/core/src/mcp-install.ts:546-556`).

Resolution is directional:

1. **The calling product's own CLI.** Walk from the resolver URL to the package manifest and verify its name. If the
   resolver URL itself ends in `.ts`, select exactly `<package-root>/src/cli.ts`; do not inspect `dist`. Otherwise
   select the manifest's `bin[agentcomms.binary]`. This makes a checkout with no build and one with a stale build both
   run source.
2. **Channel to core.** Resolve the channel's installed `@agentcomms/core` runtime dependency from the caller, verify
   the channel and core versions are equal, then resolve core by rule 1. Every channel moves `@agentcomms/core` from
   `devDependencies` to `dependencies`; those edges are currently development-only
   (`packages/gmail/package.json:44-45`, `packages/slack/package.json:41-42`,
   `packages/resend/package.json:41-42`, `packages/whatsapp/package.json:41-42`). Gmail's server-only wrapper still
   supplies a resolver URL from its Gmail dependency (`packages/gmail-mcp/package.json:41-43`).
3. **Any product to another product.** Core and every channel use the same core registration scanner; a channel can do
   so because it has the D4 runtime dependency on core. The scanner filters with the existing product recogniser and
   resolves the registration's version. It may print that product's command **only when that version equals the
   printing package's own version**. A different or unknown version is unusable: in particular 0.13.0 rejects the new
   path options in core's strict parser and Gmail's program (`packages/core/src/cli.ts:157-168`,
   `packages/gmail/src/cli/program.ts:159-173`). Among matching registrations the priority is managed, then global,
   then npx; within a class sort by client, config path, server name, command and arguments.

   A managed registration supplies its checked runtime CLI entry; a global registration supplies the checked package
   CLI entry resolved from its absolute launcher; both drop server-only `mcp` and narrowing arguments. An npx
   registration supplies the registered absolute npx executable and the target CLI package pinned to the same version
   (`@agentcomms/gmail`, not its server-only wrapper). An absent entry, unpinned spec, unreadable command, unrecognised
   launcher or version mismatch is never used. If none matches, the hint uses an absolute, own/channel→core
   `agentcomms update` command when that can be located; otherwise it prints no command and names the target package
   and MCP tool. Managed and npx registrations already expose version shapes (`packages/core/src/mcp-install.ts:338-350`,
   `packages/core/src/operations/servers.ts:575-612`).

Before any file entry is returned, the locator `realpath`s both package root and entry, requires a readable regular
file, and checks containment by path segments after realpath. A missing manifest binary, a mismatch between
`agentcomms.binary` and `bin`, a symlink escape, a directory or unreadable target, a non-absolute interpreter, or a
version mismatch returns no command. Only the interpreter and a file entry are necessarily absolute; subcommands,
flags, ids and an npx package spec are ordinary argument words.

The same scan defines channel→another-channel approval-kind corrections. Each channel manifest gets one alternative:
its absolute approve command when a same-version registration resolves, otherwise its product name and a generic
instruction to use that product's MCP tool. The fallback does not claim to know the originating tool, because send
approval records carry no origin channel (`packages/core/src/approvals.ts:302-316`). The current corrections instead
concatenate every manifest's bare approve string (`packages/core/src/channel-words.ts:39-52`,
`packages/core/src/changes.ts:314-332`, `packages/core/src/approvals.ts:644-655`).

### D2. Resolved paths travel as global options, never environment assignments

Every CLI gains these global options in the shared CLI runtime:

```
--config-dir <dir>  --state-dir <dir>  --data-dir <dir>
```

They are parsed before a core/channel context is opened. Each has exactly the precedence, empty-value treatment and
absolute `resolve()` behaviour of `AGENT_COMMS_CONFIG_DIR`, `AGENT_COMMS_STATE_DIR` and
`AGENT_COMMS_DATA_DIR` respectively (`packages/core/src/paths.ts:37-66`). Directly entered relative values therefore
resolve in the invoked CLI's working directory, just as the environment overrides do.

The locator does not reproduce the printing environment. Between the entry/package word and the subcommand, it
always inserts the printing process's already-resolved, absolute `--config-dir` and `--state-dir`, plus `--data-dir`
for a command that reads or changes managed runtimes.
Those option values override conflicting variables in the target shell. Consequently a different working directory,
relative source override, XDG setting, `HOME`, `USERPROFILE`, `APPDATA` or `LOCALAPPDATA` cannot redirect the pasted
handoff. No environment assignment is printed on any platform, so the command cannot leave a changed session
environment behind.

These options are flags, not capabilities. They add no row to `capabilities.json`, whose rows describe a CLI command,
MCP tool and shared operation (`capabilities.json:1-2`). The parity check continues to enumerate command paths and
tool names, not global flags (`scripts/parity.mjs:317-333`); its CLI driver must exercise every row once with the path
flags to prove parsing precedes operation dispatch.

### D3. Keep the existing tested Windows rendering contract

POSIX keeps its single-quote renderer. Windows uses the existing `shellCommand` rules: emit one line only when the
same line delivers the same words through cmd.exe, Windows PowerShell 5.1, PowerShell 7 and `.cmd` re-parsing;
otherwise emit the inert JSON word array plus the instruction to type it with quoting for the person's shell. That
contract already models legacy empty-argument/trailing-backslash behaviour and cmd delayed expansion
(`packages/core/src/cli-runtime.ts:93-121`, `packages/core/test/cli.test.ts:1342-1419`). There are no new
PowerShell- or cmd-specific renderers.

Resolved directory option values have redundant trailing separators removed before rendering (a filesystem root
keeps its root separator). A legal Windows path can still have no common-shell line when it contains `$`, `%`, `!`,
a backtick, a curly double quote, a Unicode control/format character, or an unspaced `&`, `^`, `(` or `)`; the same
refusal covers argument words containing `|`, `<` or `>` in that position. Empty words, words ending in `\`, and
words containing a straight double quote are also refused. The person sees the exact argv as non-runnable JSON and
the manual-typing instruction, not a partial command
(`packages/core/src/cli-runtime.ts:136-191`). An npx registration, including an absolute `npx.cmd` on Windows, goes
through these same rules (`packages/core/src/mcp-install.ts:1017-1024`).

### D4. Packaging follows the runtime edge

All four channel packages publish exact-lockstep `@agentcomms/core` runtime dependencies. Their bundles may still
inline core for startup, but comments may no longer claim that installing a channel has no dependency tree; those
claims exist in every channel bundler config (`packages/gmail/tsdown.config.ts:3-5`,
`packages/slack/tsdown.config.ts:3-5`, `packages/resend/tsdown.config.ts:3-5`,
`packages/whatsapp/tsdown.config.ts:3-6`).

`scripts/verify-package.mjs` recursively packs the candidate's transitive workspace `dependencies` and
`optionalDependencies`, deduplicates them, and gives every tarball to the isolated npm install in dependency order.
It currently packs only direct workspace edges (`scripts/verify-package.mjs:96-108`) before the consumer install
(`scripts/verify-package.mjs:135-150`). Thus verifying `gmail-mcp` packs Gmail and Gmail's local core tarball rather
than asking the registry for an unpublished core.

### D5. Every runtime handoff migrates; command-bearing output is branded

The implementation keeps a checked, table-driven inventory with one row per runtime handoff and an assertion for the
row's command or no-command fallback. The audited groups are:

- **Core:** approvals, change flow, save-destination questions, update, policy, attachment, organisation, secrets,
  registration and doctor handoffs (`packages/core/src/changes.ts:73-98`,
  `packages/core/src/changes.ts:265-332`, `packages/core/src/changes.ts:461-465`,
  `packages/core/src/approvals.ts:635-655`, `packages/core/src/approvals.ts:889-897`,
  `packages/core/src/change-flow.ts:272-302`, `packages/core/src/save-destination.ts:648-676`,
  `packages/core/src/save-destination.ts:744-756`, `packages/core/src/update-state.ts:305-347`,
  `packages/core/src/update-gate.ts:340-414`, `packages/core/src/update-check.ts:382-445`,
  `packages/core/src/render.ts:432-479`, `packages/core/src/config.ts:722`,
  `packages/core/src/organisations.ts:243-244`, `packages/core/src/organisations.ts:506`,
  `packages/core/src/organisations.ts:698-718`, `packages/core/src/organisations.ts:870`,
  `packages/core/src/operations/attach-settings.ts:304-348`,
  `packages/core/src/operations/maintenance.ts:143-162`,
  `packages/core/src/operations/maintenance.ts:217-220`,
  `packages/core/src/operations/maintenance.ts:238-265`,
  `packages/core/src/operations/maintenance.ts:327-360`,
  `packages/core/src/operations/organisations.ts:205-407`,
  `packages/core/src/operations/organisations.ts:578-730`,
  `packages/core/src/operations/organisations.ts:1152-1376`,
  `packages/core/src/operations/secrets-migrate.ts:250-376`,
  `packages/core/src/operations/change-policy.ts:135-145`, `packages/core/src/jail.ts:199-205`,
  `packages/core/src/secrets.ts:73-74`, `packages/core/src/channel-words.ts:39-52`,
  `packages/core/src/cli.ts:285-290`, `packages/core/src/cli.ts:456-787`,
  `packages/core/src/cli.ts:863-900`, `packages/core/src/cli.ts:948-950`).
- **Gmail:** send, sign-in, client/inbox/consent repair, setup, doctor and rendering handoffs
  (`packages/gmail/src/operations/send.ts:386-612`, `packages/gmail/src/operations/attachments.ts:374-375`,
  `packages/gmail/src/operations/inboxes.ts:350-370`, `packages/gmail/src/operations/client-choice.ts:95-254`,
  `packages/gmail/src/operations/clients.ts:134-511`, `packages/gmail/src/operations/consent.ts:91-610`,
  `packages/gmail/src/operations/signin.ts:213-681`, `packages/gmail/src/operations/doctor.ts:269-565`,
  `packages/gmail/src/operations/import-legacy.ts:505-512`,
  `packages/gmail/src/operations/inbox-names.ts:23`, `packages/gmail/src/auth/flows.ts:117`,
  `packages/gmail/src/auth/scopes.ts:85-88`, `packages/gmail/src/auth/session.ts:104-176`,
  `packages/gmail/src/gmail-api/errors.ts:140-156`, `packages/gmail/src/context.ts:89`,
  `packages/gmail/src/cli/tui.ts:64`, `packages/gmail/src/cli/render.ts:48-211`,
  `packages/gmail/src/cli/render.ts:661-927`, `packages/gmail/src/cli/program.ts:388-693`,
  `packages/gmail/src/cli/program.ts:1033-1046`, `packages/gmail/src/cli/program.ts:1281-1302`,
  `packages/gmail/src/cli/program.ts:1823-2422`, `packages/gmail/src/mcp/server.ts:160-162`,
  `packages/gmail/src/mcp/server.ts:997`, `packages/gmail/src/mcp/server.ts:1388`,
  `packages/gmail/src/mcp/server.ts:2381-2393`, `packages/gmail/src/mcp/server.ts:2481-2487`).
- **Slack:** post/reaction, workspace, app, manifest, draft, destination, file, auth and doctor handoffs
  (`packages/slack/src/auth/bundle.ts:109-125`, `packages/slack/src/auth/refresh.ts:168-170`,
  `packages/slack/src/operations/send.ts:169-410`, `packages/slack/src/operations/send.ts:573-605`,
  `packages/slack/src/operations/send.ts:1256`, `packages/slack/src/operations/changes.ts:70-494`,
  `packages/slack/src/operations/changes.ts:692`, `packages/slack/src/operations/workspaces.ts:105-542`,
  `packages/slack/src/operations/signin.ts:120-1064`, `packages/slack/src/operations/mode.ts:68-132`,
  `packages/slack/src/operations/app.ts:266-441`, `packages/slack/src/operations/doctor.ts:138-760`,
  `packages/slack/src/compose/drafts.ts:206`, `packages/slack/src/operations/drafts.ts:222`,
  `packages/slack/src/operations/destination.ts:20`, `packages/slack/src/operations/files.ts:100`,
  `packages/slack/src/operations/files.ts:428`, `packages/slack/src/operations/session.ts:144`,
  `packages/slack/src/mcp/server.ts:1136-1151`, `packages/slack/src/cli/render.ts:63-598`,
  `packages/slack/src/cli/program.ts:464-1541`).
- **Resend:** account, send/status, domain/read, scheduled and doctor handoffs
  (`packages/resend/src/accounts.ts:101-167`, `packages/resend/src/api/client.ts:61`,
  `packages/resend/src/context.ts:106`, `packages/resend/src/operations/accounts.ts:178-483`,
  `packages/resend/src/operations/send.ts:100-365`, `packages/resend/src/operations/send.ts:516-565`,
  `packages/resend/src/operations/send.ts:669-675`, `packages/resend/src/operations/read.ts:145-160`,
  `packages/resend/src/operations/doctor.ts:53-58`, `packages/resend/src/operations/doctor.ts:144`,
  `packages/resend/src/cli/render.ts:29`, `packages/resend/src/cli/program.ts:279-770`,
  `packages/resend/src/mcp/server.ts:98`, `packages/resend/src/mcp/server.ts:514`).
- **WhatsApp:** account, sync/index, config, chat-list, approval and permission handoffs
  (`packages/whatsapp/src/operations/accounts.ts:39-133`, `packages/whatsapp/src/config.ts:114-163`,
  `packages/whatsapp/src/index-db.ts:310-322`, `packages/whatsapp/src/operations/chat-lists.ts:99-119`,
  `packages/whatsapp/src/operations/status.ts:144`, `packages/whatsapp/src/operations/sync.ts:25-28`,
  `packages/whatsapp/src/source/snapshot.ts:120-125`, `packages/whatsapp/src/cli/render.ts:73`,
  `packages/whatsapp/src/cli/program.ts:416-604`, `packages/whatsapp/src/mcp/server.ts:70`).

The inventory also includes the core MCP instructions (`packages/core/src/mcp/server.ts:114`) and every MCP tool
description that tells a person what to run. Instructions and descriptions say this generically — for example, "run
the approve command each result gives" — rather than naming a bare CLI.

The search also found incomplete argument-only `shellCommand` values. The fragments at
`packages/core/src/operations/organisations.ts:394`, `packages/core/src/operations/organisations.ts:578-582`,
`packages/gmail/src/operations/clients.ts:353-356` and `packages/core/src/cli.ts:896-903` become prose about options
or words appended to a complete located command; they are never rendered as commands themselves.

`PrintedCommand` is an opaque branded type whose constructor and brand stay private to the locator module.
`inlineCommand` accepts one and returns branded command text. Every result or error field that tells a person what to
run — including `hint`, `fix`, `nextStep` and `command` variants — accepts only `PrintedCommand` or text built by
`inlineCommand` from one. The type checker therefore rejects a literal binary and a command assembled dynamically
from `manifest.binary`; a compile-time inventory enumerates those fields from the exported result/error types and
constructs every fixture through the locator.

Protocol identities are outside those types: MCP server names and `package.json` bin names remain ordinary identity
fields and cannot flow into a command-bearing result field without the brand. The literal-string lint and its file
allowlist are dropped; identity is excluded by construction, not by filename.

### D6. The guarantee is time-of-print identity, not immutability

For a file launch, the printed command names the installation found at print time and the entry has passed the
realpath/file/containment checks then. It does not make that path durable. If an npx cache is evicted, the pinned npx
command fetches/runs that exact release or fails non-zero. If a global installation or checkout is changed in place,
the command fails cleanly or runs the code then at that path. Approval is data-only, so a newer compatible CLI
approving the stored id is harmless; all normal digest, kind, expiry and policy checks still run.

The command does not neutralise `NODE_OPTIONS`, preloaders, shell functions or later same-user replacement. Those are
inside the person's ambient shell and the documented same-OS-user boundary (`SECURITY.md:51-59`).

No secondary bare-name command is printed. The result may say that an installation changed or disappeared, but it
never silently resolves a different suite binary from `PATH`.

### D7. The 0.13.0 fallback remains explicitly best effort

0.13.0 and affected earlier releases still print bare names and cannot be changed in place. `comms_paths` and
`agentcomms paths` return resolved directories, not the environment or relative values which produced them
(`packages/core/src/operations/maintenance.ts:27-39`). The 0.13.1 troubleshooting guide gives two limited routes:

1. For a **managed** registration, read its absolute Node command and runtime entry and run that entry. The managed
   layout is derived centrally (`packages/core/src/mcp-install.ts:299-320`,
   `packages/core/src/mcp-install.ts:566-580`). This route does not cover global or checkout 0.13.0 installs; those
   users must locate their own Node and package entry.
2. Where npx exists, run the exact package and release which printed the result, never `latest`:
   `npx -y @agentcomms/<product>@0.13.0 …`.

Neither route can reconstruct the original path environment from `comms_paths`. A custom-path user must supply the
known old-release `AGENT_COMMS_*` overrides and quote them for their shell. Skills are installed separately from the
runtime (`docs/superpowers/specs/2026-09-18-agent-communications-design.md:979-984`), npx may be absent, and an old
result may not identify Node. New 0.13.1 results use D1-D3 instead.

### D8. PATH shims stay a follow-up

0.13.1 creates, changes and diagnoses no shim, profile, registry entry or durable shim preference. A later design must
cover ownership/modes/ACLs (including macOS extended ACLs), receipts and startup validation, prune and opt-out,
authoritative data roots, and CLI-MCP parity for the preference.

## 4. Tests

1. **Own locator matrix:** managed, npx, global and checkout installations on POSIX and Windows; only the two allowed
   Node flags survive. Checkout fixtures have no `dist`, then a stale `dist`, and both select `src/cli.ts`. Gmail's
   wrapper resolves Gmail. Manifest/bin mismatch, missing, unreadable and non-file targets fail with no bare fallback.
2. **Direction and version matrix:** channel→core selects the exact runtime dependency with core `dist` absent and
   stale, always choosing source, and rejects version drift. Core→channel and channel→another-channel cover only a
   0.13.0 registration, mixed old/current registrations, every matching launcher class and deterministic tie-breaks.
   Approval-kind corrections include send records with no origin metadata and assert the generic per-product MCP
   fallback.
3. **Paths:** every CLI accepts the three global options before dispatch. Execute a handoff in a fresh shell with
   conflicting `AGENT_COMMS_*`, XDG, home/AppData values and another cwd; it reports the printing process's same
   config/state/data directories. Relative source overrides are printed as resolved absolutes. Commands which do not
   use data omit `--data-dir`; runtime/install/prune/update plus `doctor`, `channels`, setup and repair handoffs are
   classified explicitly. No output contains an environment assignment.
4. **Rendering:** exercise the existing Windows contract through Windows PowerShell 5.1 and PowerShell 7 against both
   `node.exe` and absolute `npx.cmd`, and through cmd.exe with delayed expansion enabled. Cover empty arguments,
   trailing backslashes, `%`, `!`, directory-separator normalisation, safe lines and the inert-JSON/manual-instruction
   fallback byte for byte. POSIX quoting remains byte-exact. Shell runs leave sentinel parent/session environment
   variables unchanged, including on failure.
5. **Containment and mutation:** lexical and realpath symlink escapes, root-prefix siblings and post-print replacement.
   Delete an npx cache before execution and assert an exact-version run or clean non-zero failure. Upgrade a fake global
   install in place and assert the newer fixture runs. A hostile test `NODE_OPTIONS` preloader demonstrates the
   documented same-user boundary without changing path selection.
6. **Packaging:** the verifier's transitive closure is deduplicated and ordered. The packed `gmail-mcp` consumer is
   installed with local Gmail and core tarballs in an isolated cache and performs its existing handshake without a
   registry copy of the candidate release.
7. **Types and inventory:** compile-time fixtures enumerate every command-bearing field from result/error types and
   reject literals, option fragments and dynamically manifest-derived bare commands. Runtime fixtures cover every D5
   row without sampling, including MCP instructions and tool descriptions. Separate fixtures prove MCP server names
   and package bin names remain legal protocol identities while never satisfying `PrintedCommand`.
8. **End to end:** prepare harmless change approvals through CLI and MCP, execute each printed command in a real shell
   with no suite binary on `PATH`, and observe the same temporary approval store. Run POSIX on POSIX and PowerShell plus
   the available cmd alternative on Windows. No provider transport is called.
9. Run full `pnpm verify`. No test sends email, posts to Slack, calls Resend, uses a real key, writes the real home, or
   contains a real address, token or client secret.

## 5. Departure from the ticket

CUE-403's title asks for CLIs on `PATH`. 0.13.1 instead fixes the blocking handoff with commands tied to the
installation available at print time and with explicit path options. PATH convenience remains the separately scoped
follow-up in D8.
