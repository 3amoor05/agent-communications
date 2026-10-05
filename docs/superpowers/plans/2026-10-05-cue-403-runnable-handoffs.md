# CUE-403 / 0.13.1 — runnable handoffs implementation plan

Spec: [2026-10-04-cli-path-shims-design.md](../specs/2026-10-04-cli-path-shims-design.md). Base: `main` at the
0.13.0 release (`afd195e`); implementation branch: `fix/cue-403-cli-path`. Every numbered task is one reviewable
commit, in the dependency order below. Every task writes its tests first and watches them fail. Every guard is
mutation-tested: break the guarded condition, watch the named test fail for that reason, restore it, and record the
mutation and failing test in the commit message or review notes. Tests use only temporary homes, fake provider
transports and fake credentials; they never send email, post to Slack, call Resend, use a real key or touch the real
home.

The risky tasks are marked **Risky**: Task 5 (argv/sentinel normalisation), Tasks 6–8 (brands, resolution trust and
time-of-print identity), Tasks 10–14 (the five package inventories), and Task 15 (the type/AST enforcement boundary).
For Tasks 5–8, review the rejected paths and argv boundaries, not only happy-path command text. For Tasks 10–14,
compare every changed output site with D5; the inventory is a review checklist, while Task 15's source guard is the
ongoing completeness check. In Task 15, inspect false-negative fixtures as closely as false positives.

## Foundation

1. **Resolve the five CLI path pins independently, and apply them in core before anything opens.**

   **Changes.** In `packages/core/src/paths.ts`, add the typed five-name path-option vocabulary, a `PathOverrides`
   shape, canonical absolute resolution (including root-preserving trailing-separator removal), and independent
   overlay onto the environment/default result. Preserve which directories were explicitly pinned so a downloads pin
   can beat `defaults.downloadsDir` without changing `config.json`. In `packages/core/src/core.ts`, extend
   `OpenCoreOptions` and `openCore` to carry the resolved paths and explicit pins. In
   `packages/core/src/cli-runtime.ts`, add the parser-facing conversion from the five option values to path overrides.
   Add `--config-dir`, `--state-dir`, `--data-dir`, `--secrets-dir` and `--downloads-dir` to
   `packages/core/src/cli.ts`; compute them before `openCore`, the hidden update child, the update gate or the MCP
   server branch. Pass the already-opened core into `packages/core/src/mcp/server.ts`. Update the download-root
   selection in `packages/core/src/save-destination.ts`, `packages/gmail/src/operations/attachments.ts`,
   `packages/slack/src/operations/files.ts` and `packages/resend/src/operations/read.ts` so an explicit downloads pin
   wins over configuration while an unpinned run is unchanged.

   **Tests first.** Extend `packages/core/test/paths.test.ts`, `packages/core/test/cli.test.ts` and
   `packages/core/test/core-server.test.ts` for §4 **3a-core** (the core CLI accepts all five before dispatch), **3b**
   (conflicting environment/XDG/home/AppData/cwd, independent relative-to-absolute pins and only used pins), **3c**
   (Windows split roaming/local roots with file secrets) and **3d** (downloads pins win only for download handoffs).
   Mutate each overlay back to environment-style derivation and mutate downloads precedence; the new tests must fail.

   **Done when.** `openCore` receives a fully resolved, independent directory identity before constructing any store;
   `--config-dir` cannot move state, data or secrets; an explicit downloads pin cannot persist configuration; and the
   focused core tests pass.

2. **Put the shared path options on every channel CLI and server entry, including the Gmail wrapper.**

   **Changes.** Add the five global Commander options and pre-context resolution to
   `packages/gmail/src/cli/program.ts`, `packages/slack/src/cli/program.ts`, `packages/resend/src/cli/program.ts` and
   `packages/whatsapp/src/cli/program.ts`. Carry the resolved overrides through `GmailContext`, `SlackContext`,
   `ResendContext` and `WhatsAppContext` in their `src/context.ts` files and through `createGmailMcpServer`,
   `createSlackMcpServer`, `createResendMcpServer` and `createWhatsAppMcpServer` in their `src/mcp/server.ts` files.
   Update `packages/gmail/src/index.ts` so the server-only package can supply the same path-aware Gmail factory. Replace
   the hand parser in `packages/gmail-mcp/src/server.ts` with strict parsing for its existing flags plus the four
   registration pins; apply those pins before `createGmailMcpServer`. `--downloads-dir` remains available on CLIs but
   is deliberately absent from installer-written server argv.

   **Tests first.** Extend each channel's CLI test (`packages/gmail/test/cli.test.ts`,
   `packages/slack/test/cli.test.ts`, `packages/resend/test/parity.test.ts`, `packages/whatsapp/test/cli.test.ts`) and
   MCP test, plus `packages/gmail-mcp/test/cli.test.ts`, for §4 **3a-channels** and **3k**: every
   CLI accepts all five before dispatch and every server entry, including `agent-gmail-mcp`, applies the four server
   pins before a context or store is opened. Mutate one entry to open its context first; its fixture must fail.

   **Done when.** All six executable entry shapes share the same effective path semantics, malformed or empty values
   fail as usage before I/O, and focused CLI/MCP/wrapper tests pass without adding capability rows.

3. **Write complete path identity into managed, npx and local registrations, and diagnose old entries.**

   **Changes.** In `packages/core/src/mcp-install.ts`, make `buildEntry` construct the canonical config/state/data/
   secrets argv once, place it after the selected entry or npx package and before `mcp`, and reuse it in the managed,
   npx and local branches. Narrow `minimalEnv` to the genuinely required environment; do not use
   `AGENT_COMMS_CONFIG_DIR` as the server's identity. Extend `InstallContext` to all four resolved roots. In
   `packages/core/src/operations/servers.ts`, retain and classify the four pins in scanned registrations. In
   `packages/core/src/operations/maintenance.ts`, add the doctor check for an incomplete suite pin set and make its
   approved update/install repair use the ordinary installer, preserving client/name/launcher/narrowing. Do not
   mutate an existing client file merely by scanning or running doctor.

   **Tests first.** Extend `packages/core/test/mcp-install.test.ts`,
   `packages/core/test/mcp-install-npx.test.ts`, `packages/core/test/mcp-scan.test.ts` and
   `packages/core/test/install-drift.test.ts` for §4 **3l**: a legacy registration is diagnosed, remains byte-identical
   after diagnosis, and its next approved install/update rewrites all four pins for each launcher. Also assert the
   option position and that downloads is absent. Mutate `buildEntry` so one launcher skips one pin and mutate doctor to
   rewrite eagerly; the tests must fail.

   **Done when.** Every newly written registration is cwd- and ambient-path-independent for its four suite stores,
   legacy entries get an honest repair, and the focused installer/doctor suites pass.

4. **Carry the resolved pins into the detached update-check child.**

   **Changes.** In `packages/core/src/update-check.ts`, extend the detached-entry/launch data so the parent appends its
   canonical resolved config/state/data/secrets/downloads options to `UPDATE_CHECK_CHILD_COMMAND`. Make
   `runUpdateCheckChild` consume those already parsed options through the normal CLI path flow; do not recreate them
   from inherited environment. Update the channel terminal-update hooks only to pass the same resolved path identity,
   not a second option implementation.

   **Tests first.** Extend `packages/core/test/update.test.ts` and every channel's `update-gate.test.ts` for §4 **3i**:
   a due child launched from a flag-pinned parent under conflicting ambient roots reads and writes only the parent's
   directories. Mutate the child spawn to omit one pin and mutate the child to resolve before applying pins; the
   tests must fail.

   **Done when.** The detached child has the same suite path identity as its parent on core and channel surfaces, no
   path identity depends on inherited `AGENT_COMMS_*`, and the focused update suites pass.

5. **Risky — make argv normalisation and approval insertion sentinel-safe, and preserve the renderer contract.**

   **Changes.** In `packages/core/src/cli-runtime.ts`, add shared word-level helpers that remove both forms of each
   path option only before the first `--`, reject a dangling spaced form, insert canonical pins between the entry/
   package and subcommand, and insert generated options immediately before an existing sentinel. Preserve every word
   at and after `--`. Normalise redundant directory separators before rendering while retaining filesystem roots.
   Make `withWords` use sentinel insertion rather than append. Route `gatedChangeAtTerminal` in
   `packages/core/src/change-flow.ts` through the helper for `--approval` and `--mcp-approval`; route Gmail's raw retry
   and approval stripping in `packages/gmail/src/cli/program.ts` through it too. Keep the existing single POSIX and
   common-Windows renderers; do not add shell-specific output.

   **Tests first.** Extend `packages/core/test/cli.test.ts`, `packages/core/test/change-flow.test.ts`,
   `packages/gmail/test/cli.test.ts` and `packages/gmail/test/cli-quote.test.ts` for §4 **000e**
   (`--mcp-approval` before `--`), **00b** (literal `--approval` positionals plus an end-to-end generated retry),
   **0b** (both raw post-sentinel path-option forms are untouched), **0c** (dangling pre-sentinel option refuses),
   **0d** (bare trailing-backslash Windows word versus refused quoted one), **3h-raw** (duplicates/order/relative/cwd
   normalisation through Gmail retry), and all of **4a–4d** (PowerShell 5/7, cmd delayed expansion, node.exe and
   absolute npx.cmd; empty/trailing/%/!/safe words; exact inert JSON/manual instruction; byte-exact POSIX; sentinel
   environment unchanged on success and failure). Mutate each `--` stop condition and make a refused Windows word
   runnable; the named tests must fail.

   **Done when.** Option-like positional data is byte-for-byte stable, generated approvals remain real options, unsafe
   Windows argv is inert rather than partial, shell runs do not assign environment, and the cross-platform renderer
   tests pass.

## Locator and command types

6. **Risky — introduce the branded command types and locate own-product and channel-to-core CLIs.**

   **Changes.** Add `packages/core/src/cli-command.ts`, exported from `packages/core/src/index.ts`. Define
   `PrintedCommand` with its brand and constructor private to this module; define the `PrintedCommand | ExternalCommand`
   renderable union consumed by `inlineCommand` and `commandText`. Add the opaque `ExternalCommand` and reviewed
   `externalCommand(words, reason)` constructor. It checks every word against all manifest binaries, all
   `@agentcomms/` specifiers and real/symlinked paths inside discovered suite roots, case-insensitively for Windows
   executable names. Migrate the legitimate external sites in `packages/gmail/src/operations/doctor.ts`,
   `packages/core/src/operations/maintenance.ts`, `packages/core/src/mcp-install.ts` and
   `packages/core/src/other-servers.ts` (`chmod`, `claude mcp`, `codex mcp`, and rival removal) with an explicit reason.
   Initially retain the old `ShellCommand` construction path only as a deprecated migration bridge; Task 15 removes
   it after every suite handoff is located.

   Implement `locateCliCommand`'s own-product and channel-to-core branches in that module: walk from the caller
   resolver URL and verify the manifest name; source callers select only `src/cli.ts`; built callers select the
   manifest's declared `agentcomms.binary` bin. For channel-to-core, resolve the runtime dependency from the channel,
   require equal package versions, and choose core source only when the caller URL is TypeScript and both real roots
   are workspace packages in the same real repository checkout. Before returning, check target `engines.node`, add
   strip flag for a TypeScript entry, add transform-types only when the source caller already used it, copy no other
   `process.execArgv`, resolve/check the entry and package root, add the requested used-directory pins through the
   shared normaliser, and construct the branded command under `process.execPath`. Gmail exposes a Gmail-owned resolver
   URL for `gmail-mcp`; the wrapper never resolves itself as the product.

   **Tests first.** Add `packages/core/test/cli-command.test.ts` and fixtures for §4 **1a–1d** (own managed/npx/local/
   global/direct source on POSIX and Windows; only allowed flags; absent/stale dist still selects source; Gmail wrapper;
   manifest/bin missing, mismatch, unreadable or non-file gives no fallback), §4 **2a** (all channel→core decision
   facts and source/built/external/other-checkout selections), §4 **7b** (every external-constructor negative), and
   §4 **7e-external** (the reviewed external positives). Mutate manifest-name, same-checkout, source-suffix,
   engine-range and every external-word check independently; the tests must fail.

   **Done when.** Own and channel→core success can only originate in `locateCliCommand`, failure carries no command,
   registrations are not involved in these two directions, external suite escapes are refused, and the new focused
   suite passes.

7. **Risky — add cross-product resolution without trusting or executing registrations.**

   **Changes.** Complete `locateCliCommand` in `packages/core/src/cli-command.ts` using
   `scanRegisteredServers`, the manifest-derived product recogniser and `launcherOf`. Strip all five pre-sentinel path
   options and their operands before recognition. Reject npx registrations. Require the registration's package
   version to equal the printing package version and `process.execPath` to satisfy the target engine. Rank managed
   entries before other checked file entries, then sort by client/config/server/command/args. For managed entries use
   the checked runtime CLI; for local/global file-backed entries resolve the package CLI from the absolute command or
   entry. Drop `mcp` and narrowing words, replace any registered interpreter with `process.execPath`, and never spawn
   or probe a configured command. Compare Windows executable stems and package-entry path segments without case;
   retain POSIX case. Use shared normalisation to add only the target command's used path pins. Return the specified
   product/package/required-version/reason failure with “not locatable here” and the usual-route instruction, never a
   repair or MCP route.

   **Tests first.** Extend `packages/core/test/cli-command.test.ts` and `packages/core/test/mcp-scan.test.ts` for §4
   **0000** (built caller, Node 22.12–22.17, local source-only cross-product command runs with strip-types),
   **000a–000d** (npx excluded with/without cache; path operands cannot spoof Gmail as Slack; fake/genuine managed
   interpreter is ignored and a no-spawn spy stays empty; below-engine failure), **00a** (only npx, three different
   Node environments, cache present/evicted), **0a** (WhatsApp global/managed on Node 22.12–22.15 names >=22.16),
   **2b–2e** (launcher/version/tie-break matrix, Windows absolute npm `.cmd`, exact no-location wording, Windows mixed
   case versus POSIX case, including non-absolute file-backed candidates), **3h-registered** (registered
   duplicate/reordered/equal/spaced relative pins and changed cwd) and **5a-containment** (lexical escape, realpath
   symlink escape and root-prefix sibling). Mutate version equality,
   npx rejection, ordering, case rules, path-operand removal, no-spawn behaviour and segment containment separately;
   the corresponding case must fail.

   **Done when.** A cross-product result is same-release, target-engine-compatible and backed by a checked contained
   file, or contains no executable command at all; configured interpreters are never run; and the complete locator
   matrix passes.

8. **Risky — prove and document the locator's time-of-print identity boundary.**

   **Changes.** Add purpose-built package/cache/global fixtures under `packages/core/test/fixtures/cli-command/` and
   any narrow test-only injection points needed by `locateCliCommand`; do not add fallback resolution or a second
   production command path. Add the time-of-print comments from D6 beside the entry verification and result types.

   **Tests first.** Extend `packages/core/test/cli-command.test.ts` for §4 **5b–5d**: deleting the cache behind an
   npx-launched process's own command fails cleanly at execution; replacing a fake global install makes the already
   printed absolute path run the newer fixture; and a hostile `NODE_OPTIONS` preloader demonstrates the same-user
   boundary without changing path choice. The §4 **5a-replacement** post-print replacement case lives here as well.
   Mutate the
   command to re-resolve from PATH or to copy preload/debug flags; the tests must fail.

   **Done when.** Tests distinguish “verified at print time” from immutability, a missing/replaced entry never falls
   back to a bare binary, and no ambient Node flag is copied into printed argv.

9. **Make channel packages carry core at runtime, and verify the transitive package graph.**

   **Changes.** Move `@agentcomms/core: workspace:*` from `devDependencies` to `dependencies` in
   `packages/gmail/package.json`, `packages/slack/package.json`, `packages/resend/package.json` and
   `packages/whatsapp/package.json`; update `pnpm-lock.yaml`. Correct the no-runtime-dependency comments in their
   `tsdown.config.ts` files and in `packages/gmail/src/index.ts`, `packages/slack/src/index.ts` and
   `packages/resend/src/index.ts`. Amend the runtime-edge rules in
   `docs/superpowers/specs/2026-09-26-channel-plugins-design.md` and `CONTRIBUTING.md`, and correct the obsolete npx/
   Gmail statements in `docs/superpowers/specs/2026-09-18-agent-communications-design.md`.

   Extend `test/channel-registry.test.mjs` to validate every manifest-discovered non-core channel, including its
   synthetic newcomer: core appears only in runtime `dependencies`, source resolves to the channel's version, and the
   packed edge is exact. Extend `scripts/verify-package.mjs` to recursively gather workspace `dependencies` and
   `optionalDependencies`, deduplicate them, topologically pack them, and pass all dependency tarballs to the isolated
   install. The `gmail-mcp` check must therefore install local Gmail and local core without consulting the registry
   for this release.

   **Tests first.** Own §4 **6a–6d** in `test/channel-registry.test.mjs`,
   `test/release-packages.test.mjs` and package-consumer fixtures: ordered/deduplicated closure; isolated gmail-mcp
   handshake; present/missing/dev-only/ranged/mismatched/synthetic dependency cases; and consistency of both designs,
   CONTRIBUTING, bundler comments and library comments. Mutate the recursion, deduplication, core exclusion, each
   dependency-field rejection and exact packed pin; a test must fail each time.

   **Done when.** A packed channel can resolve the core locator at runtime, publish order remains topological,
   gmail-mcp consumes candidate tarballs transitively, all policy fixtures pass, and no current/future channel is
   validated by a hand-written name list.

## Handoff migration

10. **Risky — migrate every core handoff and cross-channel approval alternative.**

   **Changes.** Thread a locator request (caller resolver, target manifest, argument words, used directories,
   platform) through core's result/render contexts. Replace the D5 core inventory in
   `packages/core/src/changes.ts`, `approvals.ts`, `change-flow.ts`, `save-destination.ts`, `update-state.ts`,
   `update-gate.ts`, `update-check.ts`, `render.ts`, `config.ts`, `organisations.ts`, `jail.ts`, `secrets.ts`,
   `channel-words.ts`, `cli.ts`, and the files under `packages/core/src/operations/` named by the spec
   (`update.ts`, `attach-settings.ts`, `maintenance.ts`, `organisations.ts`, `secrets-migrate.ts`,
   `change-policy.ts`). The principal functions are `approveCommandOf`, `changeApprovalCommand`, `nextStep`,
   `changeToolResult`, `approvalHint`, `gatedChangeAtTerminal`, `questionText`, `downloadAtTerminal`,
   `updateStopMessage`, `updateRequired`, `updateCheckChildEntry`, `renderInstall`, `renderDoctor`, `renderPrune`,
   `renderUpdate`, `installCommand`, `registrationChecks`, `registerAgain` and `main`. Every own/core/cross-product
   handoff becomes a `PrintedCommand` or the locator's no-command
   result. Channel approval corrections use the same scanner: one located own-channel approve command or one exact
   same-version no-command alternative. Make `packages/core/src/mcp/server.ts` instructions and every tool description
   say to run the command the result provides rather than naming a binary. Convert the incomplete fragments at
   `operations/organisations.ts`'s option-only sites and `cli.ts`'s argument-only site to prose/words appended to a
   complete located command.

   **Tests first.** Update the affected core operation, update, doctor, approval, change-flow and MCP tests. Add the
   core slice of §4 **7d**: core's bare/option-only/help/MCP-instruction fixtures and cross-channel corrections produce
   a located command or the exact no-command outcome, including mixed-case Windows executable input. Mutate one
   channel alternative back to `manifest.approve`, one MCP description back to `agentcomms …`, and one argument
   fragment back to a command; the package tests and later guard fixture must fail.

   **Done when.** Every file/line range in the spec's core inventory has been checked off in the review notes, core
   never invents a cross-product repair, approval alternatives preserve terminal-only semantics, and focused core
   tests pass.

11. **Risky — migrate every Gmail handoff, raw retry and the server-only wrapper.**

   **Changes.** Replace every Gmail site in the D5 inventory: `src/operations/send.ts`, `attachments.ts`,
   `inboxes.ts`, `client-choice.ts`, `clients.ts`, `consent.ts`, `signin.ts`, `doctor.ts`, `import-legacy.ts`,
   `search.ts`, `inbox-names.ts`; `src/auth/flows.ts`, `oauth.ts`, `scopes.ts`, `session.ts`; `src/gmail-api/errors.ts`;
   `src/context.ts`; `src/cli/tui.ts`, `render.ts`, `program.ts`; and `src/mcp/server.ts`. Replace the option-only
   `operations/clients.ts` fragment with prose. Convert the direct `agent-gmail --help` result to the own locator.
   Make `packages/gmail-mcp/src/server.ts` use the Gmail dependency's resolver context for its help handoff and return
   either a branded Gmail command or the no-command result. Preserve the raw retry's exact post-sentinel words and
   insert its claimed approval before `--`. The principal functions/classes are `prepareSend`, `beginApproval`,
   `finishApproval`, `grantHint`, `startAgain`, `TokenSource`, `mapGoogleError`, `nextSteps`, `repairCommand`,
   `renderClientAdd`, `renderSignInStarted`, `renderDoctor`, `renderSendPreparation`, `sendExecuteCommand`, `run`,
   `buildInstructions` and `createGmailMcpServer`.

   **Tests first.** Update Gmail's send-gate, auth, setup, doctor, render, strict-argument, CLI/MCP and wrapper tests.
   Own the Gmail slice of §4 **7d**: bare binary, option-only command, current `--help` site, wrapper site and
   mixed-case Windows name are rejected by the fixture unless they flow through the locator. Mutate one send retry,
   one setup/doctor hint and the wrapper help back to a bare command; a test must fail for each.

   **Done when.** Every spec-listed Gmail and gmail-mcp range is checked off, retry claims and expectations are
   unchanged, no fake Google transport records a send, and the focused Gmail/wrapper suites pass.

12. **Risky — migrate every Slack handoff.**

   **Changes.** Replace every Slack site in the D5 inventory: `src/auth/authorize.ts`, `bundle.ts`, `flow.ts`,
   `refresh.ts`; `src/operations/send.ts`, `changes.ts`, `workspaces.ts`, `signin.ts`, `mode.ts`, `app.ts`, `doctor.ts`,
   `drafts.ts`, `destination.ts`, `files.ts`, `session.ts`; `src/compose/drafts.ts`; `src/mcp/server.ts`; and
   `src/cli/render.ts`, `program.ts`. Convert the direct `agent-slack --help` handoff through the own locator. Keep
   post/reaction approval kinds and result wording intact except that command-bearing values are structured. The
   principal functions are `changedOutsideHint`, `refileCommand`, `preparePost`, `approveCommand`, `waitingHint`,
   `prepareReaction`, `signInStarted`, `postingSignIn`, `finishStep`, `listStep`, `reauthHint`, `profileMoveSteps`,
   `wideningSteps`, `narrowingSteps`, `stepsAfterUpdate`, `repairCommand`, the `render*` functions and `run`.

   **Tests first.** Update Slack's approval, change, workspace, sign-in, app, doctor, draft/file, render, CLI and MCP
   suites. Own the Slack slice of §4 **7d**: bare binary, option-only command and current `--help` site, including
   mixed-case Windows input. Mutate one post approval, one app/workspace repair and the help result back to a literal;
   each mutation must fail without any request reaching the loopback Slack transport.

   **Done when.** Every spec-listed Slack range is checked off, every command-bearing result is branded/no-command,
   no test posts to Slack, and the focused Slack suites pass.

13. **Risky — migrate every Resend handoff.**

   **Changes.** Replace every Resend site in the D5 inventory: `src/accounts.ts`, `src/api/client.ts`, `src/context.ts`,
   `src/operations/accounts.ts`, `send.ts`, `read.ts`, `doctor.ts`, `src/cli/render.ts`, `program.ts`, and
   `src/mcp/server.ts`. Convert the direct `agent-resend --help` handoff through the own locator. Preserve approval and
   send-status semantics while separating prose from command-bearing fields. The principal functions are the account
   lookup/change functions in `accounts.ts`, `prepareSend`, `executeSend`, `sendStatus`, `beginSendApproval`,
   `finishSendApproval`, `downloadsRoot`, `runDoctor`, the CLI renderers, `run` and `createResendMcpServer`.

   **Tests first.** Update Resend's accounts, send-gate/outcome/path, read, doctor, CLI and MCP suites. Own the Resend
   slice of §4 **7d**: bare binary, option-only command and existing `--help` site, including mixed-case Windows input.
   Mutate one account repair, one send/status handoff and the help result back to a string; each test must fail while
   the fake Resend server records no unapproved send.

   **Done when.** Every spec-listed Resend range is checked off, only `executeSend` can reach the fake transport,
   command fields are branded/no-command, and the focused Resend suites pass.

14. **Risky — migrate every WhatsApp handoff.**

   **Changes.** Replace every WhatsApp site in the D5 inventory: `src/operations/accounts.ts`, `chat-lists.ts`,
   `status.ts`, `sync.ts`; `src/config.ts`, `index-db.ts`, `source/snapshot.ts`, `src/cli/render.ts`, `program.ts`, and
   `src/mcp/server.ts`. Convert the direct `agent-whatsapp --help` handoff through the own locator. Ensure a core
   process on a supported-for-core but unsupported-for-WhatsApp Node gets the locator's Node-range failure before any
   WhatsApp action. The principal functions are `refuseAnAgent`, `addAccount`, `removeAccount`, `requireNamedConfig`,
   `requireAccount`, `pendingError`, `sourceError`, `allowChat`, `denyChat`, `clearChats`, `whatsappStatus`,
   `syncAccount`, `renderStatus`, `run`, `buildInstructions` and `createWhatsAppMcpServer`.

   **Tests first.** Update WhatsApp's account, chat-list, migration, status, snapshot, CLI and MCP suites. Own the
   WhatsApp slice of §4 **7d**: bare binary, option-only command and current `--help` site, including mixed-case
   Windows input. Mutate one account/permission repair and the help result back to a literal; the tests must fail.

   **Done when.** Every spec-listed WhatsApp range is checked off, no network path is introduced, all handoffs are
   branded/no-command, and the focused WhatsApp suites pass.

15. **Risky — close the type and source-construction escape hatches.**

   **Changes.** Replace `test/printed-command-construction.test.mjs`'s regex lint with a TypeScript syntax-tree scan.
   Derive runtime packages and surfaces from `capabilities.json` plus `scripts/channels.mjs` (including manifest bins
   and server-wrapper bins), not a hand-maintained product list. Scan user-visible result fields of any name,
   `CommsError` hints, MCP instructions/descriptions, stdout/stderr and injected-stream writes. At token boundaries,
   reject manifest binaries alone or followed by arguments/options, manifest-derived interpolation, `node` plus a
   suite entry, npx plus a suite package and wrapper payloads; compare executable names without case in Windows
   fixtures. Exclude locator structured inputs and manifest/protocol identities by syntax and data flow, not a file
   allowlist.

   Add compile-time rejection fixtures for every migrated `hint`/`fix`/`nextStep`/`command`-like result variant, and
   type those fields as `PrintedCommand | ExternalCommand` with prose in separate fields/fixed renderers. Change
   `inlineCommand` and `commandText` to accept only that union. Remove the deprecated `ShellCommand` export and public
   arbitrary constructor; only the locator can create `PrintedCommand`, and only `externalCommand` can create
   `ExternalCommand`.

   **Tests first.** Add fixtures under `test/fixtures/printed-commands/` and an isolated compile harness for §4
   **7a** (plain strings rejected in known command fields), **7c** (all named AST negative sinks and derived
   interpolation), and **7e-structure** (locator inputs and protocol identities remain allowed; all reviewed external
   sites remain allowed). The package migrations already own **7d**. Mutate every sink visitor, token-boundary rule,
   derived-binary rule, capability-derived package enumeration and branded field to accept a string; one fixture must
   fail for each mutation.

   **Done when.** There are exactly two renderable command brands, suite commands have no public constructor, the
   guard discovers current/future capability packages, all negative fixtures fail for their intended reason, and the
   repository typecheck plus root guard test pass.

## Integration and release

16. **Prove pinned registrations, parity and real-shell approval handoffs end to end.**

   **Changes.** Update the CLI driver in `scripts/parity.mjs` so every capability row is exercised once with all five
   global path flags before its command path; do not add a capability row for a flag. Add shared real-shell fixtures
   under `test/` and package test support to launch built/source commands with a stripped suite `PATH`, temporary
   stores and fake transports. Cover command-directory-use declarations for runtime/install/prune/update, doctor,
   channels, setup, approvals and downloads. Let client config discovery continue to read the executing shell's
   `CLAUDE_CONFIG_DIR`, `CODEX_HOME`, home and AppData while suite pins remain fixed.

   **Tests first.** Own §4 **3e–3g** (per-operation used directories, execution-time client configs, no environment
   assignments), **3j** (managed/npx/local registered servers with custom roots, Windows split roots/file secrets,
   harmless terminal approval on the same stores), and **8a–8d** (CLI- and MCP-prepared harmless approvals; own and
   same-version cross-product real-shell commands with no suite binary on PATH; unlocatable result has no executable;
   POSIX/PowerShell/available cmd; no provider transport). Extend `test/parity.test.mjs` to assert every eligible row
   was driven with pins. Mutate one command's declared path uses, let PATH resolve a suite binary, let an MCP-client
   config inherit a suite pin, remove a launcher pin and enable each fake send/post transport; the matching test must
   fail.

   **Done when.** The acceptance criterion's pasteable/no-command branches work in real shells, installer-written
   registrations share one path identity between server and approval CLI, parity remains operation-identical, all
   provider fakes report zero outbound calls, and the focused integration/parity suites pass.

17. **Write the 0.13.1 skills, fallback documentation and release entry last; then run the full gate.**

   **Changes.** First add documentation/skill assertions to `test/install-docs.test.mjs`,
   `test/skill-commands.test.mjs` and `test/skill-contracts.test.mjs`. Update `docs/troubleshooting.md` with D7's
   explicitly best-effort 0.13.0 fallback: for managed registrations, use the recorded absolute Node and runtime
   entry; otherwise, where available, use the exact package and release (`npx -y @agentcomms/<product>@0.13.0`), never
   `latest`; custom-path users must supply the known old `AGENT_COMMS_*` values because `comms_paths` cannot reconstruct
   their old environment; state the global/checkout/npx/old-result limitations. Update the approval/handoff wording in
   `skills/_shared/contract-{comms,gmail,slack,resend}.md` and the affected
   `skills/{comms-onboarding,comms-update,gmail-attachments,gmail-compose,gmail-send,gmail-setup,slack-posting,slack-reading,slack-setup,resend-sending}/SKILL.md`
   files to tell agents to relay the result-provided command/no-command outcome, never synthesize a bare fallback.
   Run `pnpm sync:skills` and `pnpm sync:reference` for generated copies/pages.

   Set root `package.json` to 0.13.1 and run `pnpm sync:versions` so all package/plugin/extension/launcher/skill pins
   move together. Write the `CHANGELOG.md` 0.13.1 section after all implementation and user guidance is final. Lead
   with the user-visible change: terminal approvals and repair/rerun handoffs now name the running installation and
   pin its suite directories, with safe inert argv or an honest same-version no-location result instead of a bare
   binary. Include the documented 0.13.0 managed/exact-npx fallback and its limitations; say no approval/send semantics
   changed and PATH shims remain out of scope.

   **Tests first.** Own §4 **9a–9b**. Watch the new doc/skill assertions fail before edits, run the generated-file and
   version checks, then run full `pnpm verify`. Mutation-check the skills by restoring one bare synthesized approval
   command, the fallback by changing the exact version to `latest`, and the safety harness by pointing a temp-home
   assertion at the real home; each relevant test must fail. Record the final `pnpm verify` result.

   **Done when.** Skills, generated references, manifests and changelog all say 0.13.1; the old-release workaround is
   precise about what it cannot recover; `git diff --check` and full `pnpm verify` pass; tests made no real provider
   call and touched no real home; and no release/publish/commit command has run.

## §4 coverage ownership

Each row below is owned by exactly one task. Compound spec bullets are split only to make ownership auditable.

| Spec test item | Case owned | Task |
|---|---|---:|
| 0000 | Built `.mjs` caller on Node 22.12–22.17 runs cross-product local source with strip-types | 7 |
| 000a | Same-version npx/absolute npx.cmd never cross-product candidates, cache present/absent | 7 |
| 000b | Pinned path operands ending in another package name cannot spoof product recognition, POSIX/Windows and both option forms | 7 |
| 000c | Hand-written managed shape and changed genuine interpreter use only `process.execPath`; no spawn/probe | 7 |
| 000d | `process.execPath` outside target `engines.node` yields no command | 7 |
| 000e | Generated `--mcp-approval` is inserted before `--` | 5 |
| 00a | Core with only npx channel registration returns no command across cache and three-Node-environment matrix | 7 |
| 00b | `client add -- --approval[=x]` remains positional while generated retry claims and applies the change | 5 |
| 0a | Core Node 22.12–22.15 refuses global/managed WhatsApp and names >=22.16 regardless of registered interpreter | 7 |
| 0b | Gmail raw retry preserves both post-sentinel path-option forms exactly | 5 |
| 0c | Dangling spaced path option before the sentinel yields no command | 5 |
| 0d | Bare-safe `C:\Profiles\` prints; quote-requiring trailing-backslash word is refused | 5 |
| 1a | Own locator managed/npx/local/global/direct matrix on POSIX and Windows | 6 |
| 1b | Only allowed Node flags; source with missing/stale dist selects `src/cli.ts` | 6 |
| 1c | Gmail wrapper resolves Gmail | 6 |
| 1d | Manifest/bin mismatch, missing, unreadable and non-file targets have no bare fallback | 6 |
| 2a | Channel→core caller suffix/real roots/workspace/repository/version decision matrix and selected source/built path | 6 |
| 2b | Cross-product old/current/launcher/tie-break matrix; only same version succeeds | 7 |
| 2c | Windows absolute npm `.cmd` global matching/mismatch/unreadable cases | 7 |
| 2d | Older/unknown/unreadable/absent exact “not locatable here” outcome, usual route, no repair/MCP route | 7 |
| 2e | Windows mixed-case recognition and POSIX case sensitivity | 7 |
| 3a-core | Core CLI accepts all five options before dispatch | 1 |
| 3a-channels | Every channel CLI accepts all five options before dispatch | 2 |
| 3b | Fresh-shell conflicting environment/defaults/cwd, only used pins, relative values become absolute | 1 |
| 3c | Windows split roaming/local roots and file secrets retain the printing process's secrets directory | 1 |
| 3d | Download handoffs carry downloads; non-download handoffs omit it | 1 |
| 3e | Runtime/install/prune/update, doctor, channels and setup have explicit directory-use fixtures | 16 |
| 3f | MCP-client config follows execution-time client variables while suite pins remain fixed | 16 |
| 3g | No output contains an environment assignment | 16 |
| 3h-raw | Raw Gmail retry normalises duplicates/forms/order/relative/cwd exactly once | 5 |
| 3h-registered | Registered argv normalises duplicates/forms/order/relative/cwd exactly once | 7 |
| 3i | Detached update child uses parent pins under conflicting ambient paths | 4 |
| 3j | Managed/npx/local registration E2E, custom/split roots and harmless approval share stores | 16 |
| 3k | Every server entry, including Gmail wrapper, parses/applies four pins before context | 2 |
| 3l | Doctor diagnoses unpinned old entry; approved update/install rewrites it | 3 |
| 4a | Windows PS5/PS7/cmd-delayed across node.exe/npx.cmd; empty/trailing/%/!/normalised/safe words | 5 |
| 4b | Refused Windows path emits exact inert JSON/manual instruction | 5 |
| 4c | POSIX quoting remains byte-exact | 5 |
| 4d | Shell runs leave sentinel environment unchanged on success/failure | 5 |
| 5a-containment | Lexical/real symlink escapes and prefix siblings | 7 |
| 5a-replacement | Post-print replacement | 8 |
| 5b | Npx-own command fails cleanly after cache deletion | 8 |
| 5c | Printed fake-global path runs the replacement fixture after in-place upgrade | 8 |
| 5d | Hostile `NODE_OPTIONS` demonstrates the documented boundary without changing selection | 8 |
| 6a | Transitive package closure is ordered and deduplicated | 9 |
| 6b | Isolated packed gmail-mcp installs local Gmail/core and handshakes without registry candidate | 9 |
| 6c | Discovered/synthetic channel validator plus missing/dev-only/ranged/mismatched failures | 9 |
| 6d | Governing docs, channel instructions, bundler/library comments remain consistent | 9 |
| 7a | Compile-time command-bearing fields reject strings | 15 |
| 7b | `externalCommand` rejects manifest/package/root/direct/symlink/node/npx/wrapper escapes | 6 |
| 7c | AST scan rejects all named output sinks and derived interpolation | 15 |
| 7d-core | Core literals/fragments/help/instructions and cross-channel alternatives | 10 |
| 7d-gmail | Gmail bare/option/help/wrapper/mixed-case fixtures | 11 |
| 7d-slack | Slack bare/option/help/mixed-case fixtures | 12 |
| 7d-resend | Resend bare/option/help/mixed-case fixtures | 13 |
| 7d-whatsapp | WhatsApp bare/option/help/mixed-case fixtures | 14 |
| 7e-external | Reviewed chmod/claude/codex/other-server commands remain accepted | 6 |
| 7e-structure | Locator inputs and protocol identities remain accepted | 15 |
| 8a | CLI/MCP harmless approvals execute own/same-version commands with no suite PATH and same temp store | 16 |
| 8b | Unlocatable cross-product returns no executable words | 16 |
| 8c | POSIX and Windows PowerShell/available cmd real-shell execution | 16 |
| 8d | No provider transport is called | 16 |
| 9a | Full `pnpm verify` | 17 |
| 9b | No real provider I/O, secret, address, token, key or real-home write | 17 |
