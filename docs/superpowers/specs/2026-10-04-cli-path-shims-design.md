# CUE-403 — runnable CLI handoffs from the running installation — design

Status: **proposed for 0.13.1; revised after round 4 (6 P1, 4 P2, 1 P3), 2026-10-05. No implementation is in
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

### D1. One structured locator; three resolution directions

Core owns `locateCliCommand`. A request supplies the calling package's resolver URL, the target channel manifest,
argument words, whether the command needs the data directory, and the output platform. A successful result contains
launcher words and their shell renderings; a failure contains a reason, the package to install and the equivalent MCP
tool or action. Callers never supply a binary as word zero and never quote a line themselves.

For an absolute Node-and-entry launch, the interpreter is `process.execPath`. The only retained `process.execArgv`
flags are `--experimental-strip-types`, and `--experimental-transform-types` when the running source invocation used
it. Debug, test, eval, preload/loader, condition, warning, source-map, title and memory flags are not CLI requirements.
The existing local launcher shows why source needs type stripping (`packages/core/src/mcp-install.ts:546-556`).

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
3. **Core to a channel.** Core scans the client registrations it can read, filters registrations belonging to the
   manifest product with the existing product recogniser, and sorts usable matches by client, config path and server
   name for a deterministic choice. For a managed registration it reuses the registration's interpreter and checked
   runtime CLI entry, dropping the server-only `mcp` and narrowing arguments. For an npx registration it uses the
   registered npx executable and emits `npx -y @agentcomms/<channel>@<registered-version> …`; Gmail uses
   `@agentcomms/gmail`, not its server-only wrapper. A registration with an absent entry, an unpinned npx spec, an
   unreadable command, or an unrecognised launcher is not usable. With no usable registration, the result contains no
   shell line: it names `@agentcomms/<channel>` and the channel MCP tool/action instead. Core has no channel dependency
   to follow (`packages/core/src/operations/servers.ts:107-123`), while managed and npx registrations already expose
   their version shapes (`packages/core/src/mcp-install.ts:338-350`,
   `packages/core/src/operations/servers.ts:575-608`).

Before any file entry is returned, the locator `realpath`s both package root and entry, requires a readable regular
file, and checks containment by path segments after realpath. A missing manifest binary, a mismatch between
`agentcomms.binary` and `bin`, a symlink escape, a directory or unreadable target, a non-absolute interpreter, or a
version mismatch returns no command. Only the interpreter and a file entry are necessarily absolute; subcommands,
flags, ids and an npx package spec are ordinary argument words.

The same resolver handles manifest-generated approval-kind corrections. The current corrections concatenate every
manifest's approve string (`packages/core/src/channel-words.ts:39-52`, `packages/core/src/changes.ts:314-332`,
`packages/core/src/approvals.ts:644-655`); after this change each alternative is located separately. An unavailable
alternative names its package and tells the person to return to the originating channel MCP action, never to type a
bare approve command.

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

### D3. Render for one Windows shell at a time

POSIX keeps its single-quote renderer. Windows returns a primary **PowerShell** line and, when possible, a labelled
**cmd.exe alternative**:

- PowerShell is `& '<word>' '<word>' …`. Every word is single-quoted and an apostrophe is doubled. `$`, `%`, `!`, a
  backtick, an empty word and trailing backslashes are literal in this form.
- cmd.exe double-quotes every word. The run of backslashes before the closing quote is doubled. A word containing `%`
  or `"` has no safe form under this contract, so the cmd.exe alternative is omitted and the result says which word
  made it unavailable. PowerShell remains present.

For all hostile characters together, the exact primary result is:

```powershell
& 'C:\Agent$Data\node.exe' 'C:\Agent''s suite\core\dist\cli.mjs' '--config-dir' 'C:\100%!`store\' '--state-dir' 'C:\Agent''s café state\' 'approve' 'ap_example'
```

The cmd.exe alternative is omitted with: `cmd.exe alternative unavailable: the --config-dir value contains %`.
Without `%` or a double quote, trailing backslashes are doubled exactly:

```bat
"C:\Agent$Data\node.exe" "C:\Suite\core\dist\cli.mjs" "--config-dir" "C:\Agent!`store\\" "--state-dir" "C:\Café State\\" "approve" "ap_example"
```

The equivalent POSIX shape remains:

```sh
'/opt/Agent'\''s/node' '/opt/Agent'\''s/core/dist/cli.mjs' --config-dir '/opt/Agent'\''s/config' --state-dir '/opt/Agent'\''s/state' approve ap_example
```

`ShellCommand`, `inlineCommand` and `commandText` carry the labelled renderings rather than pretending one Windows
line is universal. They never fall back to runnable-looking JSON for a legal Windows path.

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

### D5. Every runtime handoff migrates; a manifest-derived lint keeps it migrated

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
  `packages/resend/src/cli/render.ts:29`, `packages/resend/src/cli/program.ts:279-770`).
- **WhatsApp:** account, sync/index, config, chat-list, approval and permission handoffs
  (`packages/whatsapp/src/operations/accounts.ts:39-133`, `packages/whatsapp/src/config.ts:114-163`,
  `packages/whatsapp/src/index-db.ts:310-322`, `packages/whatsapp/src/operations/chat-lists.ts:99-119`,
  `packages/whatsapp/src/operations/status.ts:144`, `packages/whatsapp/src/operations/sync.ts:25-28`,
  `packages/whatsapp/src/source/snapshot.ts:120-125`, `packages/whatsapp/src/cli/render.ts:73`,
  `packages/whatsapp/src/cli/program.ts:416-604`).

The search also found incomplete argument-only `shellCommand` values. The fragments at
`packages/core/src/operations/organisations.ts:394`, `packages/core/src/operations/organisations.ts:578-582`,
`packages/gmail/src/operations/clients.ts:353-356` and `packages/core/src/cli.ts:896-903` become prose about options
or words appended to a complete located command; they are never rendered as commands themselves.

The lint reads manifest binaries through the channel registry. Using a syntax tree, it rejects any manifest binary
which appears as a word anywhere inside a string or template literal in runtime source, not merely at the beginning,
and rejects every `shellCommand` list that is empty or whose first word is an option/fragment. Its explicit allowlist
contains only reviewed help/usage/grammar files and a reason per file; operation results, errors, hints, fixes and
`nextStep` strings are never allowlisted. A fixture-only manifest proves a new channel's binary is covered. This
replaces the current regex lint, which accepts bare names passed to `shellCommand`
(`test/printed-command-construction.test.mjs:7-16`, `test/printed-command-construction.test.mjs:61-99`).

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
2. **Direction matrix:** channel-to-core selects the channel's exact runtime dependency and rejects version drift.
   Standalone core prints Gmail and Slack handoffs from managed and npx registrations; with no usable registration,
   and with only an unreadable registration, it names the package and MCP action and prints no command. Include
   manifest-generated approval-kind corrections.
3. **Paths:** every CLI accepts the three global options before dispatch. Execute a handoff in a fresh shell with
   conflicting `AGENT_COMMS_*`, XDG, home/AppData values and another cwd; it reports the printing process's same
   config/state/data directories. Relative source overrides are printed as resolved absolutes. Commands which do not
   use data omit `--data-dir`; runtime/install/prune/update commands include it. No output contains an environment
   assignment.
4. **Rendering:** byte-exact POSIX and PowerShell output for spaces, apostrophes, non-ASCII, `$`, `%`, `!`, backticks,
   empty words and trailing backslashes. cmd.exe output doubles trailing backslashes; `%` and `"` each omit only the
   cmd alternative with the stated reason. Running the PowerShell form and every available cmd form leaves sentinel
   parent/session environment variables unchanged, including on failure.
5. **Containment and mutation:** lexical and realpath symlink escapes, root-prefix siblings and post-print replacement.
   Delete an npx cache before execution and assert an exact-version run or clean non-zero failure. Upgrade a fake global
   install in place and assert the newer fixture runs. A hostile test `NODE_OPTIONS` preloader demonstrates the
   documented same-user boundary without changing path selection.
6. **Packaging:** the verifier's transitive closure is deduplicated and ordered. The packed `gmail-mcp` consumer is
   installed with local Gmail and core tarballs in an isolated cache and performs its existing handshake without a
   registry copy of the candidate release.
7. **Lint and inventory:** a fixture manifest adds a binary automatically; binary words embedded at the beginning or
   middle of strings/templates fail outside the reasoned help/grammar allowlist; incomplete `shellCommand` word lists
   fail. A table-driven migration test iterates every D5 row—no sampling—and asserts a located runnable result or its
   specified package/MCP fallback for both CLI and MCP surfaces where the site serves both.
8. **End to end:** prepare harmless change approvals through CLI and MCP, execute each printed command in a real shell
   with no suite binary on `PATH`, and observe the same temporary approval store. Run POSIX on POSIX and PowerShell plus
   the available cmd alternative on Windows. No provider transport is called.
9. Run full `pnpm verify`. No test sends email, posts to Slack, calls Resend, uses a real key, writes the real home, or
   contains a real address, token or client secret.

## 5. Departure from the ticket

CUE-403's title asks for CLIs on `PATH`. 0.13.1 instead fixes the blocking handoff with commands tied to the
installation available at print time and with explicit path options. PATH convenience remains the separately scoped
follow-up in D8.
