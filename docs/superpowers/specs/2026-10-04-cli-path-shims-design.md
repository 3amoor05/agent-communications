# CUE-403 — runnable CLI handoffs from the running installation — design

Status: **proposed for 0.13.1; revised after round 6 (2 P1, 3 P2), 2026-10-05. No implementation is in
this change.**

## 1. What is being fixed

A runtime result can require a person to approve or repair something at a terminal, then print `agentcomms` or an
`agent-*` binary which is not on that person's `PATH`. Gmail send preparation and the shared change flow do that now
(`packages/gmail/src/operations/send.ts:386-455`, `packages/core/src/changes.ts:73-98`,
`packages/core/src/changes.ts:265-283`). Terminal approval deliberately has no MCP capability under `confirm`
(`docs/superpowers/specs/2026-09-25-cli-mcp-parity-design.md:148-152`).

The 0.13.1 acceptance criterion is:

> Every new terminal handoff has one of three accepted outcomes: a pasteable command which does not require an
> agent-communications binary on `PATH` and pins every resolved directory it uses; no target command, but the product
> name and an absolute core command which repairs its registration; or, on the rare Windows path which the safe
> renderer refuses, the exact argv as inert JSON with an instruction to enter those words manually. It never prints a
> bare suite binary or sends a person to an MCP tool for terminal approval.

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
  `LOCALAPPDATA` while deriving config, state, secrets, data and default downloads directories
  (`packages/core/src/paths.ts:37-66`). A registered server's minimal environment currently fixes only the config
  directory (`packages/core/src/mcp-install.ts:266-280`).
- Every channel declares its binary and package facts in `package.json`; the tooling discovers that data rather than
  keeping a channel list (`docs/superpowers/specs/2026-09-26-channel-plugins-design.md:24-52`,
  `scripts/channels.mjs:27-59`, `scripts/channels.mjs:114-150`).
- The current Windows renderer accepts only the intersection safely understood by cmd.exe and both PowerShell eras,
  and otherwise emits inert JSON (`packages/core/src/cli-runtime.ts:67-129`,
  `packages/core/src/cli-runtime.ts:136-191`).

## 3. Decisions

### D1. One structured locator; lockstep resolution in every direction

Core owns `locateCliCommand`. A request supplies the calling package's resolver URL, the target manifest, argument
words, the resolved-directory uses of the target command, and the output platform. Success is a `PrintedCommand`
(D5); failure names the reason, product and package. Callers never supply word zero or quote a line.

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
2. **Channel to core.** Resolve the channel's installed `@agentcomms/core` runtime dependency from the caller and
   verify the channel and core versions are equal. Select core's `src/cli.ts` only when **both** the caller's module URL
   ends in `.ts` and the resolved core package root, after `realpath`, is a workspace package inside the same realpath
   repository checkout as the caller. Otherwise select core's manifest bin. The decision is made from the caller's
   source status, the two real package roots, workspace membership and repository identity — not from core's exported
   module URL, which points at `dist/index.mjs`, or merely from the final candidate path
   (`packages/core/package.json:16-25`). Every channel moves `@agentcomms/core` from `devDependencies` to
   `dependencies`; those edges are currently development-only
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
   launcher or version mismatch is never used. When no same-version registration resolves, the result is
   terminal-only and names the product: if a recognised older registration exists it gives the absolute core
   `update` command; if none exists it gives the absolute core `server install <product>` command. Both repairs are
   approved changes, not shortcuts around the change policy. `server install` is the CLI peer of
   `comms_server_install`, calls the existing `serverInstallChange`, and gets its own parity row
   (`packages/core/src/operations/servers.ts:50-66`,
   `docs/superpowers/specs/2026-09-25-cli-mcp-parity-design.md:160-166`). It never suggests that an MCP tool can
   approve under `confirm`. Managed and npx registrations already expose version shapes
   (`packages/core/src/mcp-install.ts:338-350`, `packages/core/src/operations/servers.ts:575-612`).

Before any file entry is returned, the locator `realpath`s both package root and entry, requires a readable regular
file, and checks containment by path segments after realpath. A missing manifest binary, a mismatch between
`agentcomms.binary` and `bin`, a symlink escape, a directory or unreadable target, a non-absolute interpreter, or a
version mismatch returns no command. Only the interpreter and a file entry are necessarily absolute; subcommands,
flags, ids and an npx package spec are ordinary argument words.

The same scan defines channel→another-channel approval-kind corrections. Each channel manifest gets one alternative:
its absolute approve command when a same-version registration resolves, otherwise its product name and the applicable
absolute core repair command above. After that approved repair the person retries and receives the target product's
terminal approve command. The fallback does not claim to know an originating or approving MCP tool: send approval
records carry no origin channel, and approval under `confirm` is deliberately terminal-only
(`packages/core/src/approvals.ts:302-316`,
`docs/superpowers/specs/2026-09-25-cli-mcp-parity-design.md:148-152`). The current corrections instead concatenate
every manifest's bare approve string (`packages/core/src/channel-words.ts:39-52`,
`packages/core/src/changes.ts:314-332`, `packages/core/src/approvals.ts:644-655`).

### D2. Resolved paths travel as global options, never environment assignments

Every CLI gains these global options in the shared CLI runtime:

```
--config-dir <dir>  --state-dir <dir>  --data-dir <dir>  --secrets-dir <dir>  --downloads-dir <dir>
```

They are parsed before a core/channel context is opened. Each non-empty option is made absolute with `resolve()` and
pins exactly its named effective directory after normal environment, configuration and default resolution; it neither
sets an environment variable nor changes how another directory is derived. In particular, `--downloads-dir` wins over
the configured downloads root without changing `config.json` (`packages/gmail/src/operations/attachments.ts:352-356`,
`packages/resend/src/operations/read.ts:514-517`). This independence is essential on Windows: setting
`AGENT_COMMS_CONFIG_DIR` makes `localRoot` equal the config directory and therefore moves `secretsDir`, while
`--config-dir` fixes only `configDir` and `--secrets-dir` fixes only `secretsDir`
(`packages/core/src/paths.ts:42-56`).

The locator does not reproduce the printing environment. Between the entry/package word and the subcommand it inserts
the printing process's already-resolved absolute option for **every** directory the target command uses: config,
state, data, secrets and, for a handoff which reads or writes downloads, downloads. It omits only directories that
the target does not use. Those independent pins override conflicting variables and defaults in the target shell, so a
different cwd, relative source override, XDG setting, `HOME`, `USERPROFILE`, `APPDATA` or `LOCALAPPDATA` cannot
redirect a directory the handoff uses. No environment assignment is printed on any platform.

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

This inert-JSON/manual-entry result is the acceptance criterion's third outcome. It is deliberately preferred to a
wrong-but-runnable line, which could approve, overwrite or remove the wrong thing. It is rare: only Windows handoffs
with one of the refused word shapes take it; ordinary paths remain pasteable.

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

The implementation keeps the following table-driven inventory as migration documentation and a review checklist, not
as the completeness mechanism. The audited groups are:

- **Core:** approvals, change flow, save-destination questions, update, policy, attachment, organisation, secrets,
  registration and doctor handoffs (`packages/core/src/changes.ts:73-98`,
  `packages/core/src/changes.ts:265-332`, `packages/core/src/changes.ts:461-465`,
  `packages/core/src/approvals.ts:635-655`, `packages/core/src/approvals.ts:889-897`,
  `packages/core/src/change-flow.ts:272-302`, `packages/core/src/save-destination.ts:648-676`,
  `packages/core/src/save-destination.ts:744-756`, `packages/core/src/update-state.ts:305-347`,
  `packages/core/src/update-gate.ts:340-414`, `packages/core/src/update-check.ts:382-445`,
  `packages/core/src/operations/update.ts:843-900`, `packages/core/src/render.ts:432-479`,
  `packages/core/src/config.ts:722-1074`,
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
  `packages/core/src/cli.ts:153-154`, `packages/core/src/cli.ts:285-290`,
  `packages/core/src/cli.ts:456-787`,
  `packages/core/src/cli.ts:863-900`, `packages/core/src/cli.ts:948-950`).
- **Gmail:** send, sign-in, client/inbox/consent repair, setup, doctor and rendering handoffs
  (`packages/gmail/src/operations/send.ts:325-612`, `packages/gmail/src/operations/attachments.ts:374-375`,
  `packages/gmail/src/operations/inboxes.ts:350-370`, `packages/gmail/src/operations/client-choice.ts:95-254`,
  `packages/gmail/src/operations/clients.ts:134-511`, `packages/gmail/src/operations/consent.ts:91-610`,
  `packages/gmail/src/operations/signin.ts:213-681`, `packages/gmail/src/operations/doctor.ts:269-565`,
  `packages/gmail/src/operations/import-legacy.ts:505-539`, `packages/gmail/src/operations/search.ts:296-302`,
  `packages/gmail/src/operations/inbox-names.ts:23`, `packages/gmail/src/auth/flows.ts:101-215`,
  `packages/gmail/src/auth/oauth.ts:101-104`,
  `packages/gmail/src/auth/scopes.ts:85-88`, `packages/gmail/src/auth/session.ts:104-176`,
  `packages/gmail/src/gmail-api/errors.ts:140-156`, `packages/gmail/src/context.ts:89`,
  `packages/gmail/src/cli/tui.ts:64`, `packages/gmail/src/cli/render.ts:48-211`,
  `packages/gmail/src/cli/render.ts:661-927`, `packages/gmail/src/cli/program.ts:388-2422`,
  `packages/gmail/src/mcp/server.ts:160-162`,
  `packages/gmail/src/mcp/server.ts:997`, `packages/gmail/src/mcp/server.ts:1388`,
  `packages/gmail/src/mcp/server.ts:2381-2393`, `packages/gmail/src/mcp/server.ts:2481-2487`).
- **Slack:** post/reaction, workspace, app, manifest, draft, destination, file, auth and doctor handoffs
  (`packages/slack/src/auth/authorize.ts:252-255`, `packages/slack/src/auth/bundle.ts:109-125`,
  `packages/slack/src/auth/flow.ts:208-303`, `packages/slack/src/auth/refresh.ts:168-773`,
  `packages/slack/src/operations/send.ts:169-410`, `packages/slack/src/operations/send.ts:573-605`,
  `packages/slack/src/operations/send.ts:1256`, `packages/slack/src/operations/changes.ts:70-494`,
  `packages/slack/src/operations/changes.ts:692`, `packages/slack/src/operations/workspaces.ts:105-542`,
  `packages/slack/src/operations/signin.ts:120-1064`, `packages/slack/src/operations/mode.ts:68-132`,
  `packages/slack/src/operations/app.ts:266-441`, `packages/slack/src/operations/doctor.ts:138-760`,
  `packages/slack/src/compose/drafts.ts:185-274`, `packages/slack/src/operations/drafts.ts:222`,
  `packages/slack/src/operations/destination.ts:20`, `packages/slack/src/operations/files.ts:100`,
  `packages/slack/src/operations/files.ts:428`, `packages/slack/src/operations/session.ts:144`,
  `packages/slack/src/mcp/server.ts:1136-1151`, `packages/slack/src/mcp/server.ts:1318`,
  `packages/slack/src/cli/render.ts:63-598`, `packages/slack/src/cli/program.ts:464-1622`).
- **Resend:** account, send/status, domain/read, scheduled and doctor handoffs
  (`packages/resend/src/accounts.ts:101-167`, `packages/resend/src/api/client.ts:61`,
  `packages/resend/src/context.ts:106`, `packages/resend/src/operations/accounts.ts:178-483`,
  `packages/resend/src/operations/send.ts:100-365`, `packages/resend/src/operations/send.ts:516-565`,
  `packages/resend/src/operations/send.ts:669-675`, `packages/resend/src/operations/read.ts:145-160`,
  `packages/resend/src/operations/doctor.ts:53-58`, `packages/resend/src/operations/doctor.ts:144`,
  `packages/resend/src/cli/render.ts:29`, `packages/resend/src/cli/program.ts:279-770`,
  `packages/resend/src/mcp/server.ts:98`, `packages/resend/src/mcp/server.ts:514`).
- **WhatsApp:** account, sync/index, config, chat-list, approval and permission handoffs
  (`packages/whatsapp/src/operations/accounts.ts:39-133`, `packages/whatsapp/src/config.ts:114-169`,
  `packages/whatsapp/src/index-db.ts:310-322`, `packages/whatsapp/src/operations/chat-lists.ts:99-119`,
  `packages/whatsapp/src/operations/status.ts:144`, `packages/whatsapp/src/operations/sync.ts:25-28`,
  `packages/whatsapp/src/source/snapshot.ts:120-125`, `packages/whatsapp/src/cli/render.ts:73`,
  `packages/whatsapp/src/cli/program.ts:416-621`, `packages/whatsapp/src/mcp/server.ts:70`).

The inventory also includes the core MCP instructions (`packages/core/src/mcp/server.ts:114`) and every MCP tool
description that tells a person what to run. Instructions and descriptions say this generically — for example, "run
the approve command each result gives" — rather than naming a bare CLI.

The search also found incomplete argument-only `shellCommand` values. The fragments at
`packages/core/src/operations/organisations.ts:394`, `packages/core/src/operations/organisations.ts:578-582`,
`packages/gmail/src/operations/clients.ts:353-356` and `packages/core/src/cli.ts:896-903` become prose about options
or words appended to a complete located command; they are never rendered as commands themselves.

`PrintedCommand` is an opaque branded type whose constructor and brand stay private to the locator module. The only
other command type is opaque `ExternalCommand`, made by the reviewed `externalCommand(words, reason)` constructor for
non-suite programs. Its present sites are `chmod`, `claude mcp` and `codex mcp`
(`packages/gmail/src/operations/doctor.ts:221-227`,
`packages/core/src/operations/maintenance.ts:82-96`, `packages/core/src/mcp-install.ts:808-817`,
`packages/core/src/mcp-install.ts:1215-1222`). The required reason records why that external executable is legitimate;
the constructor refuses every manifest binary, so suite commands can come only from the locator.

Every output variant which tells a person what to run types its command-bearing field — `hint`, `fix`, `nextStep`,
`command`, or any other name found during migration — as `PrintedCommand | ExternalCommand`, never `string`. Prose
around it is a separate prose field or a fixed renderer. `inlineCommand` and `commandText` accept that union. Thus a
literal, template, argument fragment or command assembled from `manifest.binary` cannot enter such a field.

A type-aware syntax-tree test scans all runtime source, resolves those field symbols, and fails on any string or
template literal assigned to one, including through a newly added result type. It also fails when any `CommsError`
hint contains a binary word derived from the channel manifests outside a branded command value. The type checker
catches non-literal strings; negative fixtures prove a new error hint and a new result field cannot bypass either
guard. This construction is the completeness check; the inventory above documents the migration and helps reviewers,
but adding a handoff only to the table proves nothing.

Protocol identities are outside those types: MCP server names and `package.json` bin names remain ordinary identity
fields and cannot flow into a command-bearing result field without the brand. There is no file allowlist; identity is
excluded by construction, not by filename.

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
2. **Direction, source and version matrix:** channel→core asserts the decision inputs — caller module suffix, real
   caller and core roots, workspace membership, same-checkout identity and versions — as well as the selected path.
   A source caller with sibling workspace core selects `src/cli.ts` with core `dist` absent and stale; a built caller,
   an external installed core and a core in another checkout select the manifest bin. Core→channel and
   channel→another-channel cover only an old registration, mixed old/current registrations, every launcher class and
   deterministic tie-breaks. Windows includes an absolute npm `.cmd` global registration with matching, mismatched and
   unreadable package/version entries. With no same-version target, an older registration yields the absolute core
   `update`; none yields absolute core `server install <product>`. Both go through change approval, and an unlocatable
   `confirm` approval names no MCP approval route.
3. **Paths:** every CLI accepts all five independent global options before dispatch. Execute a handoff in a fresh shell
   with conflicting `AGENT_COMMS_*`, XDG, home/AppData values and another cwd; it reports every printing-process
   directory the target uses and no other option. Relative option values become resolved absolutes. On Windows set
   `APPDATA` and `LOCALAPPDATA` to different roots and use the file secret store; a pasted secret-reading handoff must
   use exactly the printing process's `secretsDir`, even with `--config-dir` present. Download handoffs preserve
   `downloadsDir`; non-download handoffs omit it. Runtime/install/prune/update, doctor, channels, setup and repair
   handoffs have explicit directory-use fixtures. No output contains an environment assignment.
4. **Rendering:** exercise the existing Windows contract through Windows PowerShell 5.1 and PowerShell 7 against both
   `node.exe` and absolute `npx.cmd`, and through cmd.exe with delayed expansion enabled. Cover empty arguments,
   trailing backslashes, `%`, `!`, directory-separator normalisation and safe lines. A valid Windows path that the
   renderer refuses must produce the exact inert JSON words and manual-entry instruction and satisfy the third
   accepted outcome byte for byte. POSIX quoting remains byte-exact. Shell runs leave sentinel parent/session
   environment variables unchanged, including on failure.
5. **Containment and mutation:** lexical and realpath symlink escapes, root-prefix siblings and post-print replacement.
   Delete an npx cache before execution and assert an exact-version run or clean non-zero failure. Upgrade a fake global
   install in place and assert the newer fixture runs. A hostile test `NODE_OPTIONS` preloader demonstrates the
   documented same-user boundary without changing path selection.
6. **Packaging:** the verifier's transitive closure is deduplicated and ordered. The packed `gmail-mcp` consumer is
   installed with local Gmail and core tarballs in an isolated cache and performs its existing handshake without a
   registry copy of the candidate release.
7. **Types and construction:** compile-time and syntax-tree fixtures reject a string or template in every
   command-bearing result/error field, a newly added `CommsError` hint containing a manifest binary outside a brand,
   option fragments and dynamically manifest-derived bare commands. Positive fixtures preserve reviewed
   `externalCommand` uses for `chmod 700`, `claude mcp remove` and `codex mcp get/remove`. MCP instructions and tool
   descriptions are scanned too. Separate fixtures prove MCP server names and package bin names remain legal protocol
   identities while satisfying neither command brand.
8. **End to end:** prepare harmless change approvals through CLI and MCP, execute each printed command in a real shell
   with no suite binary on `PATH`, and observe the same temporary approval store. Run POSIX on POSIX and PowerShell plus
   the available cmd alternative on Windows. No provider transport is called.
9. Run full `pnpm verify`. No test sends email, posts to Slack, calls Resend, uses a real key, writes the real home, or
   contains a real address, token or client secret.

## 5. Departure from the ticket

CUE-403's title asks for CLIs on `PATH`. 0.13.1 instead fixes the blocking handoff with commands tied to the
installation available at print time and with explicit path options. PATH convenience remains the separately scoped
follow-up in D8.
