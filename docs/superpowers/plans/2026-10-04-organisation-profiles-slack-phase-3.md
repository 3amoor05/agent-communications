# Organisation Profiles Slack Phase 3 Implementation Plan

> **For Codex:** Execute this plan test-first. Use the `test-driven-development` skill for every behaviour task and `requesting-code-review` before the final verification task. The source of truth is `docs/superpowers/specs/2026-10-02-organisation-profiles-design.md`, especially §D2, §D4's Slack provenance, §D5, all of §D7, the Slack rows of §D8, §D9, phase 3 in §4, and the Slack cases in §5.

**Goal:** Make Slack accounts use an organisation profile's read or send app, move safely between those apps, and durably revoke superseded rotating tokens without changing the existing bring-your-own-app path.

**Architecture:** Land the additive core schema and migration support first. Resolve a profile app into one immutable sign-in snapshot, re-check that snapshot before and inside the committing config update, and use the existing credential lock for the token/config hand-off. Put superseded profile-app bundles in a top-level revocation ledger and drain that ledger only through a dedicated one-shot `auth.revoke` grant. Keep CLI and MCP as two adapters over the same operations, then regenerate their references and rewrite the setup skill.

**Tech Stack:** TypeScript executed by Node's type stripper, `node:test`, pnpm workspaces, Zod, Commander, Model Context Protocol, Biome, injected fetch and loopback Slack fakes.

## Global constraints

- Never contact Slack. Every exchange remains injected and every Web API call uses `packages/slack/test/support/fake-slack.ts` or an injected `fetch` that has already passed through the real guard.
- Do not add another way to post. `auth.revoke` is cleanup, has its own closed one-shot grant, and must not become `read`, `auth`, `prepare`, `configure`, or `write` in the ordinary method allowlist.
- Treat the profile label, workspace name, Slack error, and Slack error description as untrusted. Snapshot only flattened, neutralised display strings; escape them again where the listener renders HTML.
- Keep `workspace add --client-id ... --port ...`, own-app reauthentication, own-app mode instructions, flow expiry, and CLI signal exit behaviour unchanged unless §D7 explicitly distinguishes a profile flow.
- Keep `packages/slack/src/operations/session.ts` implementation unchanged unless Task 8's regression exposes a defect: it already follows the account's current `secretRef`, which is the desired side of the atomic switch, and must never be taught to fall back to a pending old ref.
- No profile operation may say that token revocation uninstalls the Slack app. `apps.uninstall` stays refused.
- Every capability continues to have one operation used by both CLI and MCP and one matching `capabilities.json` row. Do not add a second surface-only implementation.
- Each task below starts from green, adds a failing test, implements only that slice, runs its focused tests plus the affected package suite, performs the named guard mutations, restores them, and is independently committable.

---

### Task 1: Add the core ledger, provenance, and profile-app CAS primitives

**Files:**
- Modify: `packages/core/src/config.ts`
- Modify: `packages/core/src/organisations.ts`
- Modify: `packages/core/src/operations/organisations.ts`
- Modify: `packages/core/src/index.ts`
- Modify: `packages/core/test/config-secrets.test.ts`
- Modify: `packages/core/test/organisations.test.ts`
- Modify: `packages/core/test/org-operations.test.ts`

1. Write schema round-trip tests for additive account `organisation` and `profileApp: "read" | "send"` provenance and a top-level optional `pendingRevocations` list. Pin the ledger shape to `ref`, recorded `store`, `platform`, `workspace`, `createdAt`, required access state, optional refresh state, and per-token `status: pending | revoked | expired` plus absolute `deadline`. Watch the current parser return untyped/unknown fields and the current secret-store detection ignore a pending-only config.
2. Write pure organisation tests for resolving an exact Slack target by organisation and role, including label, workspace id/name, port, client id, optional app id, and record SHA-256. Cover absent organisation/Slack/role and a hand-edited invalid record. Watch the current core expose no single validated target.
3. Write compare-and-set tests for learning an app id: unchanged SHA/workspace/role/client with no id learns once; the same id is idempotent; a different already-learned id, changed SHA, workspace, role, or client refuses; a profile-stated id wins. Extend the §D8 tests so typed provenance still refuses a workspace change, reports a replaced/removed role, preserves a learned id only for the same workspace/role/client, and clears it on a new client id.
4. Add exported `PendingRevocation`, token-state, and typed provenance fields to the schemas used by both config versions without introducing version 3. Include the ledger in `ConfigBody`, in config serialisation, and in `holdsSecrets`.
5. Add and export one profile Slack target resolver and one pure app-id learner that returns the next config only after all expected values still match. Replace phase 1's provenance casts with the typed fields; keep `slackRecordFrom` as the only profile-update rule for retaining or clearing learned ids.
6. Run:
   - `pnpm --filter @agentcomms/core exec node --experimental-strip-types --test test/config-secrets.test.ts test/organisations.test.ts test/org-operations.test.ts`
   - `pnpm --filter @agentcomms/core test`
7. Guard mutations, one at a time: remove each provenance field from `accountSchema`; omit `pendingRevocations` from either version schema and from `holdsSecrets`; resolve the wrong role; ignore the record SHA; let learning overwrite a different app id; keep a learned id after a workspace/client change. Each mutation must fail the focused tests before it is restored.
8. Commit this task as a standalone core-schema prerequisite.

### Task 2: Teach secret discovery and migration about recorded pending stores

**Files:**
- Modify: `packages/core/src/operations/secrets-migrate.ts`
- Modify: `packages/core/test/cli.test.ts`
- Modify: `packages/core/test/fixtures/config-v2-0.12.1.ts`

1. Add tests showing `secretRefsOf` includes and deduplicates ledger refs beside clients, inboxes, accounts, and the approval key. Watch the current list omit the only reference to a superseded Slack bundle.
2. Add a current-release migration matrix: a pending bundle is read from the `store` on its entry, copied and verified in the target, the root `secrets.store` and every moved entry's `store` change in the same config update, and the source is deleted only after that switch. Include a pending bundle whose recorded store differs from the root store, rollback after a failed switch, and conflict after a concurrent ledger mutation.
3. Extend the frozen 0.12.1 fixture with the minimum helper needed to model the older release switching the root store while preserving an unknown `pendingRevocations` key and not copying its bundle. Do not import current schemas into the fixture. The later Slack test in Task 9 will prove that the bundle is still read from the entry's old store.
4. Refactor migration's source lookup to select the root store for ordinary refs and the entry's recorded store for pending refs. Keep one target copy per deduplicated ref, include the entry/store mapping in `migrationConflict`, and rewrite ledger stores together with the root switch under the credentials lock.
5. Run:
   - `pnpm --filter @agentcomms/core exec node --experimental-strip-types --test test/cli.test.ts`
   - `pnpm --filter @agentcomms/core test`
6. Guard mutations: omit pending refs from `secretRefsOf`; read them from the root store; switch the root without rewriting the entry; rewrite the entry in a second update; exclude its location from the conflict snapshot; delete the old bundle before the atomic switch. Restore every mutation after its focused case fails.
7. Commit this task before any Slack code can create ledger entries.

### Task 3: Add a dedicated one-shot transport grant for `auth.revoke`

**Files:**
- Modify: `packages/slack/src/api/methods.ts`
- Modify: `packages/slack/src/api/guard.ts`
- Modify: `packages/slack/test/guard.test.ts`
- Modify: `packages/slack/test/consumer-check.mjs`

1. Add guard tests that first show unclassified `auth.revoke` is refused. Specify a new `revoke` method class which is still refused unless a dedicated grant names the pending ref, token kind, and SHA-256 of the bearer token.
2. Add a matrix proving the transport refuses no grant, a wrong method, a bearer token whose digest is not the grant's, nesting with every existing grant, and a second call after consumption. Assert refusals happen before the fake sees a request and that the raw token/digest never appears in an error. Pin `ref` and token kind as immutable grant fields here; Task 5 proves that the operation which creates the grant refuses a wrong ref, another bundle, and an access/refresh swap.
3. Add the `revoke` rule and a `revoking` slot to `WritePermit`. Implement an internal `revokeWith` helper which validates the class, opens no posting/configuration/download/upload permission, compares the exact bearer token digest at request time, consumes the grant before the request leaves, and closes it in `finally`.
4. Keep `revokeWith` out of the package root. Extend the static caller/export tests to allow no caller yet and, once Task 5 lands, only `operations/revocations.ts`; external consumers cannot construct the grant.
5. Run:
   - `pnpm --filter @agentcomms/slack exec node --experimental-strip-types --test --test-timeout=600000 test/guard.test.ts`
   - `pnpm --filter @agentcomms/slack test`
6. Guard mutations: classify `auth.revoke` as ordinary `auth` or `read`; skip the bearer digest comparison; drop ref/kind from the grant identity or accept an empty binding; consume after the response rather than before dispatch; leave the grant open in `finally`; allow any existing permit to nest. The matrix must catch each mutation.
7. Commit this gate before adding a production caller.

### Task 4: Specify revocation deadlines and answer classification as pure logic

**Files:**
- Create: `packages/slack/src/operations/revocations.ts`
- Create: `packages/slack/test/revocations.test.ts`
- Modify: `packages/slack/src/auth/bundle.ts` only if a read-only expiry helper belongs beside the bundle type

1. Add table tests for ledger creation from an old bundle. Valid access/refresh expiry strings become fixed absolute deadlines; absent or unreadable values become exactly `createdAt + 30 days`; no refresh token produces no refresh row. Watch the current code have no durable deadline representation.
2. Add pure classification tests for the complete §D7 matrix: `ok:true, revoked:true` and Slack errors `token_revoked`/`token_expired` become `revoked`; `ok:true` with `revoked:false` or absent, `invalid_auth`, `account_inactive`, `ratelimited`, 5xx, dropped connection, unreadable/unnamed errors, and anything else stay `pending`; a pending token at or past its fixed deadline becomes `expired` without a call.
3. Implement immutable helpers to create an entry, enumerate access and refresh independently, classify one answer, and render a plain state carrying its deadline. Do not infer a cascade and do not let a later retry move `revoked` or `expired` back to `pending`.
4. Run `pnpm --filter @agentcomms/slack exec node --experimental-strip-types --test --test-timeout=600000 test/revocations.test.ts`.
5. Guard mutations: treat `ok:true` alone as revoked; treat `invalid_auth` or `account_inactive` as revoked; use the refresh deadline for access; use the current time rather than `createdAt` for fallback; drop the refresh row; use `>` instead of the tested expiry boundary. Restore each after the table catches it.
6. Commit the pure state machine independently of sign-in.

### Task 5: Drain ledger entries safely and independently token by token

**Files:**
- Modify: `packages/slack/src/operations/revocations.ts`
- Modify: `packages/slack/src/context.ts`
- Modify: `packages/slack/src/api/call.ts` only to preserve structured evidence needed by the classifier
- Modify: `packages/slack/test/revocations.test.ts`
- Modify: `packages/slack/test/guard.test.ts`
- Modify: `packages/slack/test/consumer-check.mjs`
- Modify: `packages/slack/test/support/fake-slack.ts`
- Modify: `packages/slack/test/support/harness.ts`

1. Extend the fake so tests can script ordinary JSON, a 5xx, a dropped connection, and a hook after Slack has received the request. It must still only be reachable through the production guard.
2. Write executor tests for every answer from Task 4 through a real guarded `auth.revoke` call. Assert the refresh token is called with its own bearer token even when access already answered `token_revoked`, `token_expired`, `invalid_auth`, or any other cascade-like answer, and assert the no-cascade case calls both exactly once.
3. Add cases for a wrong entry ref, another bundle, access/refresh swap, already-final status, missing/corrupt bundle, failed secret-store read, and a caller trying to supply a token. Watch each refuse before a request or leave the correct state pending.
4. Add a crash hook after the fake records Slack's action but before the status update. After a fresh `SlackContext`, prove the token is still pending and retried; the lost answer never becomes an invented success.
5. Implement `revokePendingEntry`/`retryPendingRevocations` in three fenced phases per token: under the credentials lock re-read the exact entry, open `core.secrets(entry.store)`, and load the token from the named bundle; release the lock and make one bounded guarded call; reacquire the lock and compare-and-set the same `ref`/store/kind/deadline with status still `pending`. The network call must not hold the machine-wide lock. Continue to the other kind whatever the first answered.
6. When every token is `revoked` or `expired`, delete the bundle first and remove the exact entry only after deletion succeeds. Leave both entry and bundle for every unfinished state or cleanup failure. Return plain per-entry/per-token states and deadlines; never claim an uninstall.
7. Run:
   - `pnpm --filter @agentcomms/slack exec node --experimental-strip-types --test --test-timeout=600000 test/revocations.test.ts test/guard.test.ts`
   - `pnpm --filter @agentcomms/slack test`
8. Guard mutations: read from the root store; accept a token parameter; hold the credentials lock across the network call; skip the live ref/store/kind/deadline/pending CAS; update a different entry with the same workspace; skip the second token after any first answer; delete a bundle with one pending token; remove the entry before bundle deletion; treat a network exception as final. Each focused test must watch one fail.
9. Commit the durable revocation engine before sign-in can enqueue work.

### Task 6: Resolve profile-driven adds and snapshot the exact target

**Files:**
- Create: `packages/slack/test/support/organisation.ts`
- Create: `packages/slack/test/organisation-profiles.test.ts`
- Modify: `packages/slack/test/support/harness.ts`
- Modify: `packages/slack/src/auth/flow.ts`
- Modify: `packages/slack/src/operations/changes.ts`
- Modify: `packages/slack/src/operations/signin.ts`

1. Add a version-2 organisation harness without changing the version-1 default used by existing Slack tests. Give it read/send roles, optional app ids, hostile-but-schema-preserving display fixtures, and direct config/profile update helpers.
2. Add start-only tests for `workspace add rgc/slack` without `--client-id`: default read app, send app with the existing widening approval, profile port, and exact profile organisation/role/workspace/client/app/SHA snapshot. Assert no exchange or secret write occurs during start.
3. Add refusals for no matching organisation, no Slack section, no app for the requested role, an invalid stored record, and a caller trying to override the profile port without taking the explicit-client path.
4. Preserve the explicit path: `--client-id` takes precedence even if its value equals the profile's client id, requires `--port`, snapshots no profile provenance, and keeps today's own-app approval and flow shape.
5. Add a typed `profile` block to `SlackFlow` containing only stable validation fields plus already-neutralised display fields. Centralise target selection in `connectWorkspace`; pass the resolved target to `startSignIn` rather than re-resolving it after approval.
6. Run:
   - `pnpm --filter @agentcomms/slack exec node --experimental-strip-types --test --test-timeout=600000 test/organisation-profiles.test.ts test/flow.test.ts test/changes.test.ts`
   - `pnpm --filter @agentcomms/slack test`
7. Guard mutations: let explicit client id acquire provenance; use an argument/default port instead of the profile port; choose read for `--mode send`; fall back to an own-app flow when the role is absent; omit workspace/client/app/role/SHA from the flow; store raw display fields. Restore after the focused tests fail.
8. Commit profile target selection and flow persistence with all old flows still readable.

### Task 7: Validate profile exchanges, record provenance, and learn the app id atomically

**Files:**
- Modify: `packages/slack/src/auth/authorize.ts`
- Modify: `packages/slack/src/operations/workspaces.ts`
- Modify: `packages/slack/src/operations/signin.ts`
- Modify: `packages/slack/src/operations/changes.ts`
- Modify: `packages/slack/test/authorize.test.ts`
- Modify: `packages/slack/test/organisation-profiles.test.ts`
- Modify: `packages/slack/test/signin.test.ts`

1. Add exchange tests showing a profile flow refuses another workspace, another client/app, missing `app_id`, and app ids outside `^A[A-Z0-9]{2,20}$` before `secrets.set`. Keep own-app exchange replies without `app_id` accepted.
2. Add success tests showing an account created through a profile carries both `organisation` and `profileApp`; an explicit client remains unmanaged even when ids happen to match; `workspace list/show` data can distinguish the two without deriving provenance from ids.
3. Add app-learning tests. The first successful profile sign-in with no stated app id writes the returned id in the same config update as the account. Two simultaneous first sign-ins returning different ids produce one winner; the loser is refused and its staged secret is removed. A stated or learned id mismatch never lands.
4. Extend `readExchange` to preserve a valid raw app id and structured Slack refusal details without weakening own-app parsing. Make `validateExchange` require and grammar-check app ids only for profile flows and enforce their exact target before staging.
5. Extend `accountFrom` with explicit provenance input. In the committing callback, re-run the profile target/SHA CAS and call core's learner before returning one config containing both the account and learned app id. Preserve all existing account fields on reauth and use the existing uncertain-commit cleanup rules for the staged secret.
6. Run:
   - `pnpm --filter @agentcomms/slack exec node --experimental-strip-types --test --test-timeout=600000 test/authorize.test.ts test/organisation-profiles.test.ts test/signin.test.ts`
   - `pnpm --filter @agentcomms/slack test`
7. Guard mutations: accept missing/invalid `app_id`; compare only workspace or only app; skip the pre-stage validation; attach provenance from matching ids rather than the flow; learn in a second config update; ignore a newly learned conflicting id; keep the loser's staged bundle. Each mutation must fail a focused race/order assertion.
8. Commit complete profile add, including §D5's regression that a pre-existing own-app account remains unmanaged and unchanged when its organisation profile is added.

### Task 8: Make provenance mode changes and replacement reauths switch apps atomically

**Files:**
- Create: `packages/slack/test/organisation-mode.test.ts`
- Modify: `packages/slack/src/auth/flow.ts`
- Modify: `packages/slack/src/operations/changes.ts`
- Modify: `packages/slack/src/operations/mode.ts`
- Modify: `packages/slack/src/operations/signin.ts`
- Modify: `packages/slack/src/operations/workspaces.ts`
- Modify: `packages/slack/src/operations/revocations.ts`
- Modify: `packages/slack/test/changes.test.ts`
- Modify: `packages/slack/test/signin.test.ts`
- Modify: `packages/slack/test/refresh-session.test.ts`

1. Add mode tests proving a provenance account moves to the other profile role, not a rewritten manifest: read→send uses the send app and existing change approval; send→read starts immediately; a removed target role is refused; own-app accounts keep today's manifest/uninstall instructions and `--app-updated` path.
2. Pin the flow snapshot to source account id and `secretRef` plus target role, workspace, client/app ids, port, and profile SHA. Race profile update/removal, account renewal/rename/removal, target-role replacement, and two finishers. Watch each stale flow store nothing and withdraw its staged bundle.
3. Add exact-transition validation: a profile mode move may return the target client/app while requiring the same source person and target workspace; no other reauth may relax today's same-client/app checks. Add same-role reauth after a profile app replacement: it uses the profile's current role app and the same snapshot/revoke path. A later profile port is used by later sign-ins.
4. Add an event-journal test for the mandated order: new bundle staged; one config update under the credential lock switches `secretRef`, client/app, mode/tier, and `profileApp` and appends an old-ref ledger entry; old bundle remains; only then do access and refresh revokes run. The live session must follow only the new account ref and never a pending old ref.
5. Add a second move while the first ledger entry is pending. It stages another unique ref and appends another entry without replacing or merging the first.
6. Refactor `reauthTarget`/`planModeSet`: provenance selects the recorded role for a renewal and the opposite requested role for a move; own-app selection remains current. Carry a transition discriminator in the flow so `validateExchange` relaxes client/app equality only for that exact profile target.
7. In profile app switches, replace the current post-write best-effort delete with `PendingRevocation` creation from the old bundle. Build the new account and ledger append in the same `writeWithConsent` mutation under `withCredentialsLock`; after commit, call the revocation engine and return its plain cleanup state. Leave ordinary same-app/own-app renewal behaviour unchanged.
8. Cover every Slack §D8 row: core still refuses a workspace-id change while provenance accounts exist; a changed client id is reported and same-role reauth uses the replacement; a removed role is reported and cannot be selected; a changed port affects only later starts; removing Slack from the profile leaves the account usable but removes profile mode moves. Confirm a stated app id replaces a learned one and mismatch is reported.
9. Run:
   - `pnpm --filter @agentcomms/slack exec node --experimental-strip-types --test --test-timeout=600000 test/organisation-mode.test.ts test/changes.test.ts test/signin.test.ts test/refresh-session.test.ts test/revocations.test.ts`
   - `pnpm --filter @agentcomms/slack test`
10. Guard mutations: select the source role for a move; require approval for send→read; skip source `secretRef`; permit any client/app change; ignore profile SHA/update/removal; switch config before staging; omit one switched field; append the ledger in a second write; delete old before revoking; overwrite an existing pending entry. Restore each after its focused test fails.
11. Commit profile moves and replacement reauth as one atomic hand-off slice.

### Task 9: Recover pending revocations through doctor, migration, and remove

**Files:**
- Modify: `packages/slack/src/operations/revocations.ts`
- Modify: `packages/slack/src/operations/doctor.ts`
- Modify: `packages/slack/src/operations/workspaces.ts`
- Modify: `packages/slack/src/operations/changes.ts`
- Modify: `packages/slack/src/cli/render.ts`
- Modify: `packages/slack/test/revocations.test.ts`
- Modify: `packages/slack/test/doctor.test.ts`
- Modify: `packages/slack/test/doctor-cli.test.ts`
- Modify: `packages/slack/test/workspaces.test.ts`

1. Add restart tests in which the immediate revoke fails, a new context runs `doctor`, and both token kinds are retried from the retained bundle. Cover already-invalid tokens, every still-pending answer, access/refresh expiry ending retries, missing/corrupt bundles, and clear result text with each state and deadline.
2. Add `workspace remove` tests: matching pending entries are attempted before the account's current credential is removed; successful entries disappear; failed entries and bundles survive outside accounts; removal still succeeds and reports what remains for `doctor`. A second move's older entry must survive removing the account.
3. Add current-release migration integration using Task 2's store rewrite, then the frozen prior-release switch: after the old release changes only root `secrets.store`, `doctor`/remove still load the pending bundle from `entry.store` and never from the current root store.
4. Make online `runDoctor` drain the selected workspace's pending entries before its ordinary credential/identity checks; unfiltered doctor drains all Slack entries. `--offline` makes no revocation call but still reports ledger states/deadlines. Include ledger refs in any orphan/reference scan so they are never described as unowned secrets.
5. Make removal call the same retry operation for entries matching `platform: slack` and the account's workspace id, then perform today's current-secret-first account removal. Extend `RemovedWorkspace`, doctor results, and terminal rendering with cleanup states without saying the installation was removed.
6. Run:
   - `pnpm --filter @agentcomms/slack exec node --experimental-strip-types --test --test-timeout=600000 test/revocations.test.ts test/doctor.test.ts test/doctor-cli.test.ts test/workspaces.test.ts`
   - `pnpm --filter @agentcomms/slack test`
7. Guard mutations: make doctor read the current store; skip retry after restart; let offline doctor call Slack; remove the account before pending retry; delete failed ledger rows; omit refresh from reporting; hide deadlines; describe revoke as uninstall. Restore each after its test fails.
8. Commit recovery and removal integration.

### Task 10: Give every pre-storage profile failure the approved cautious wording

**Files:**
- Create: `packages/slack/test/profile-signin-failures.test.ts`
- Modify: `packages/slack/src/auth/authorize.ts`
- Modify: `packages/slack/src/auth/flow.ts`
- Modify: `packages/slack/src/auth/listener.ts`
- Modify: `packages/slack/src/operations/signin.ts`
- Modify: `packages/slack/test/flow.test.ts`
- Modify: `packages/slack/test/signin.test.ts`

1. Test the detached listener's real expiry with a short injected listener timeout, not `--wait`; a foreground profile timeout; callback errors `access_denied`, an approval-like code, and an unknown code; and exchange refusals with the same three. Each must store no token/account, include any Slack code/description only flattened and neutralised, name the snapshotted organisation label/workspace name+id/role/client id, say the sign-in did not complete and “may have declined or the workspace may require an administrator to approve the app,” and never assert that the person declined.
2. Add redaction snapshots for CLI JSON/text, MCP envelopes, listener HTML/log output, and thrown errors using control tokens, bidi/invisible characters, newlines, overlong descriptions, bearer-token-looking text, and app/client identifiers. The stored flow may contain only bounded safe display strings, never raw hostile text or a client secret/token.
3. Add a finish already waiting when a profile flow expires; it uses the snapshot it already read and returns the special profile timeout. A finish which begins after the flow is gone keeps today's NOT_FOUND answer and adds the cautious admin-approval line only when `expectAlias` names an organisation whose current record has Slack, using that current safe label/workspace.
4. Add profile update and removal during a wait. Re-check the live target before exchange, after exchange before staging, and in the committing CAS; report invalidation rather than a decline. Add a browser-abandon case and prove there is no timeout tombstone or other new stored state.
5. Preserve the flow store's current expiry semantics for `peek`, `get`, `claim`, `pending`, outcome files, and detached listener cleanup. Preserve the foreground own-app timeout's existing special case and generic no-flow wording for own-app/unknown names.
6. Extend Slack refusal details from `readExchange` only enough to feed one profile-failure formatter. Keep the formatter operation-level; all surfaces receive the same `CommsError`, and listener HTML uses escaped display strings.
7. Run:
   - `pnpm --filter @agentcomms/slack exec node --experimental-strip-types --test --test-timeout=600000 test/profile-signin-failures.test.ts test/flow.test.ts test/signin.test.ts test/authorize.test.ts`
   - `pnpm --filter @agentcomms/slack test`
8. Guard mutations: emit “declined”; omit the admin-approval alternative; read display fields from the current profile; bypass flattening/neutralisation/HTML escaping; persist a timed-out marker; turn expired wait into generic pending; add the no-flow line unconditionally; skip any live-profile re-check. Restore after the snapshot/matrix catches each.
9. Commit failure semantics separately from cancellation.

### Task 11: Honour cancellation without consuming a detached sign-in

**Files:**
- Create: `packages/slack/test/profile-cancellation.test.ts`
- Modify: `packages/slack/src/operations/signin.ts`
- Modify: `packages/slack/src/mcp/server.ts`
- Modify: `packages/slack/test/mcp-changes.test.ts`
- Modify: `packages/slack/test/cli.test.ts`
- Modify: `packages/slack/test/signin.test.ts`

1. Add an optional `AbortSignal` to `FinishOptions` and tests for abort before polling, during polling, and racing an outcome. A cancelled detached wait must return an `APPROVAL_PENDING`-class answer saying the sign-in is still open and exactly how to finish it, while leaving flow, outcome ownership, and detached listener untouched.
2. Pass `ctx.mcpReq.signal` from the `slack_workspace_finish` handler, mirroring Gmail. Add an MCP cancellation test which completes the browser flow after cancellation and collects it with a later finish.
3. Add a child-process CLI test: interrupt detached `workspace add --finish`/`reauth --finish`, assert today's signal exit and no command-authored cancellation message, complete the browser callback, then finish successfully. Add the foreground interruption regression: its in-process listener ends with the command and no account/token/timeout state is stored.
4. Ensure an abort is checked without claiming/discarding the flow. If an outcome and cancellation race, only a finisher that already owns the outcome may proceed; cancellation itself is never recorded as sign-in failure.
5. Run:
   - `pnpm --filter @agentcomms/slack exec node --experimental-strip-types --test --test-timeout=600000 test/profile-cancellation.test.ts test/mcp-changes.test.ts test/cli.test.ts test/signin.test.ts`
   - `pnpm --filter @agentcomms/slack test`
6. Guard mutations: omit the MCP signal; discard or claim on abort; stop the detached listener; convert abort to the profile-failure wording; print a CLI cancellation line; let foreground interruption leave a flow/token. Restore each after the focused test fails.
7. Commit cancellation propagation.

### Task 12: Put the changed operations in CLI/MCP parity and regenerate references

**Files:**
- Modify: `packages/slack/src/mcp/server.ts`
- Modify: `packages/slack/src/cli/program.ts`
- Modify: `packages/slack/src/cli/render.ts`
- Modify: `packages/slack/src/operations/workspaces.ts`
- Modify: `packages/slack/src/operations/mode.ts`
- Modify: `packages/slack/test/mcp.test.ts`
- Modify: `packages/slack/test/mcp-changes.test.ts`
- Modify: `packages/slack/test/mcp-parity.test.ts`
- Modify: `packages/slack/test/strict-arguments.test.ts`
- Modify: `packages/slack/test/cli.test.ts`
- Modify: `packages/slack/test/render.test.ts`
- Modify: `packages/slack/test/consumer-check.mjs`
- Modify: `capabilities.json`
- Regenerate: `docs/reference/slack-cli.md`
- Regenerate: `docs/reference/slack-mcp-tools.md`

1. Add surface tests first: `workspace add`/`slack_workspace_add` accept omitted client id and port only on the profile path; explicit client id still requires port; list/show/connected results expose provenance and app role; profile mode reports a direct app move rather than `appUpdateNeeded`; removal and doctor expose pending cleanup states; all strict unknown-argument checks remain.
2. Update CLI help/command reconstruction so it never prints `--client-id undefined`, and distinguish “through Really Good Culture's read/send app” from own-app wording. Keep exit codes, JSON envelope, and untrusted-content wrapping unchanged.
3. Update MCP schemas/descriptions and handlers over the same `connectWorkspace`, `reauthWorkspace`, `planModeSet`, `finishSignIn`, `removeWorkspaceChange`, and `runDoctor` functions. Make `clientId`/`port` optional in the add tool schema, not in a duplicate MCP selector.
4. Change only the existing `capabilities.json` row descriptions required by §D9: `slack.workspace.add` explains profile selection versus explicit own-app arguments; the mode rows explain a profile app-to-app move while retaining own-app instructions. Keep their existing `operation` values and cover the changed optional argv/args in strict parity fixtures.
5. Run `pnpm sync:reference`; inspect only generated Slack CLI/MCP changes and never edit those pages by hand.
6. Run:
   - the focused surface files above;
   - `pnpm verify:parity -- --strict`;
   - `pnpm verify:reference`;
   - `pnpm --filter @agentcomms/slack test`.
7. Guard mutations: make `clientId` required on only one surface; route CLI or MCP through a different function; restore own-app mode text for a provenance account; omit provenance/pending state from one renderer; change/remove a capability `operation`; skip regeneration. The surface/parity/reference tests must catch each.
8. Commit the surface and generated-reference slice together.

### Task 13: Rewrite the Slack setup skill for organisation apps

**Files:**
- Modify: `skills/slack-setup/SKILL.md`
- Regenerate if changed by the repository script: `skills/slack-setup/references/contract.md`
- Regenerate if changed by the repository script: `skills/slack-setup/references/fit.json`
- Regenerate if its generated row changes: `README.md`

1. Rewrite the profile-first setup path: after `agentcomms org add`, `agent-slack workspace add rgc/slack` automatically chooses the read app, or the send app for `--mode send`; no client id or port is repeated. Keep explicit `--client-id --port` as the person's own-app path.
2. Rewrite mode instructions: provenance accounts move directly between the two profile apps; read→send still needs the change approval and Slack consent; send→read is immediate apart from Slack consent; neither asks to edit/uninstall an organisation app. Keep the existing manifest/update/uninstall procedure only for own-app accounts.
3. Explain same-role reauth after an organisation replaces a role's app, durable pending revocation, `doctor` retry/status/deadlines, and that revocation does not uninstall an app. Include the cautious admin-approval failure wording and cancellation/finish retry guidance.
4. Run `pnpm sync:skills`, inspect every generated difference, then run `pnpm verify:skills`. Do not hand-edit generated contract/fit/README content.
5. This task introduces no runtime decision guard, so there is no code mutation to run. Its mechanical guards are `sync:skills --check` and the skill verifier's command/tool validation; semantic coverage is reviewed against the §D7/§D9 traceability rows below rather than encoded as a brittle sentence assertion.
6. Commit the skill source and generator-owned outputs together.

### Task 14: Mutation-audit every new guard and close static escape hatches

**Files:** all implementation and test files changed in Tasks 1–12

1. Re-run every mutation named in Tasks 1–12 as a one-line local change, run the smallest named focused test, record the failing test name, and restore the line immediately. A mutation that stays green means the guard needs a new test before continuing.
2. Add/retain static scans for: one production caller of `revokeWith`; no root export; no ordinary `auth.revoke` call; no direct Slack endpoint outside the guarded transport; no caller-supplied revoke token; CLI and MCP using the same operations; no new `apps.uninstall` path.
3. Re-run the core and Slack package suites after all mutations are restored. `git diff` must contain no mutation residue.
4. Commit only any tests needed to make a previously surviving mutation fail.

### Task 15: Verify in risk order and hand off

**Files:** none; this task verifies the accumulated implementation and records results.

1. Run the focused files in task order, then the package suites:
   - `pnpm --filter @agentcomms/core test`
   - `pnpm --filter @agentcomms/slack test`
2. Run root compile/style guards before generated/parity guards:
   - `pnpm lint`
   - `pnpm verify:channels`
   - `pnpm build`
   - `pnpm typecheck`
   - `pnpm test`
3. Run the root drift, packaging, and parity guards:
   - `pnpm verify:skills`
   - `pnpm verify:versions`
   - `pnpm verify:licenses`
   - `pnpm verify:reference`
   - `pnpm verify:parity -- --strict`
   - `pnpm verify:packages`
4. Run `pnpm verify` last and report the exact pass/fail result. It is the final authority even when all constituent commands passed separately.
5. Inspect the final diff for real Slack origins, secrets/tokens in fixtures or snapshots, manual generated-file edits, untrusted strings outside the envelope/sanitiser, and changes to own-app semantics.
6. Handoff with: changed files; the traceability rows below; every mutation and catching test; deliberate generated/wording fixture changes; remaining risks/judgement calls; package-suite, root-guard, and `pnpm verify` results.

## Traceability to the design rules

| Spec rule | Implementation task(s) | Proof owned by the task |
|---|---:|---|
| §D2 Slack profile grammar and app-id grammar | 1, 6, 7 | Core target validation; exchange `app_id` grammar; safe profile display snapshot |
| §D4 additive Slack provenance and learned app ids | 1, 7, 8 | Typed `organisation`/`profileApp`; atomic learn; retain/clear/replace rules |
| §D5 own-app account beside a new profile | 7 | Matching ids never imply provenance; existing own-app account stays unchanged |
| §D7.1 profile add/default-send selection, snapshot, mismatch, explicit path | 6, 7, 12 | Start matrix, exchange matrix, surface parity |
| §D7.2 provenance is additive and explicit ids are unmanaged | 1, 7 | Schema round-trip and add-result assertions |
| §D7.3 mode is a move, exact source/target snapshot, update invalidation, approval direction | 8 | Mode/race matrix and exact-transition validation |
| §D7.4 ordered stage/switch+enqueue/revoke/delete and restart retry | 4, 5, 8, 9 | Event journal, executor, doctor restart |
| §D7.5 top-level ledger, scans/migrations/recorded store/second move/remove | 1, 2, 8, 9 | Core migration matrix and Slack recovery/removal matrix |
| §D7.6 app-id learning CAS and profile update retention/clearing | 1, 7, 8 | Core CAS and simultaneous sign-in race |
| §D7.7 exchange app id required only for profile flows | 7 | Pre-stage missing/invalid/own-app matrix |
| §D7.8 every revocation answer, independent tokens, fixed deadlines | 4, 5, 9 | Pure and guarded response tables; expiry/restart tests |
| §D7.9 dedicated one-shot grant and status CAS | 3, 5, 14 | Transport matrix, operation binding, static caller scans |
| §D7.10 cautious pre-storage failure wording, safe snapshots, unchanged expiry | 10 | Timeout/callback/exchange/redaction/expiry matrices |
| §D7.11 MCP/CLI/foreground cancellation semantics | 11 | Abort, child-process signal, later-finish tests |
| §D7.12 own-app path unchanged | 6, 7, 8, 10, 11, 12 | Explicit add/exchange/mode/timeout/signal regressions |
| §D8 Slack row: workspace changed | 1, 8 | Core refusal remains; Slack stale target cannot finish |
| §D8 Slack row: role client changed | 1, 8 | Report plus same-role replacement reauth/revocation |
| §D8 Slack row: role removed | 1, 8 | Report plus target-role refusal |
| §D8 Slack row: redirect port changed | 6, 8 | Existing flows keep snapshot; later starts use new port |
| §D8 Slack row: Slack removed | 8 | Existing account works; profile move unavailable/reported |
| §D9 capability descriptions, generated reference, setup skill | 12, 13 | Strict parity/reference/skill guards |
| §4 phase 3 delivery boundary | 1–15 | Core prerequisites precede Slack; using-it surfaces and skill finish the phase |

## Traceability to the §5 Slack test debt

| Required Slack test | Task(s) |
|---|---:|
| Profile Slack add; explicit own-app add unchanged | 6, 7, 12 |
| Workspace/client/app mismatch before storage | 7 |
| Mode move races and exact snapshot | 8 |
| Revocation order | 8 |
| Failed revoke retained and retried after restart | 5, 9 |
| Already-invalid token | 4, 5, 9 |
| Pending entry survives `workspace remove` | 9 |
| Second move adds another entry | 8, 9 |
| `ok:true, revoked:true` | 4, 5 |
| `ok:true, revoked:false` | 4, 5 |
| `ok:true` with `revoked` absent | 4, 5 |
| `token_revoked` | 4, 5 |
| `token_expired` | 4, 5 |
| `invalid_auth` | 4, 5 |
| `account_inactive` | 4, 5 |
| `ratelimited` | 4, 5 |
| 5xx | 4, 5 |
| Dropped connection | 4, 5 |
| Unnamed/unknown Slack error | 4, 5 |
| Refresh token revoked on its own | 5 |
| Cascade: second token sees every answer; no-cascade path | 5 |
| Crash after Slack acted, before status write | 5 |
| Expiry ends pending access, refresh, and no-expiry refresh bundle | 4, 9 |
| One-shot grant: wrong ref, another bundle, access/refresh swap, consumed | 3, 5 |
| Missing/invalid exchange `app_id` refused pre-stage; own-app absence accepted | 7 |
| Real detached timeout with short listener timeout, not `--wait` | 10 |
| Callback `access_denied`, approval-like, unknown | 10 |
| Exchange refusal `access_denied`, approval-like, unknown | 10 |
| All profile failures use §D7 wording, never “declined,” store nothing | 10 |
| Finish already waiting sees profile expiry special case | 10 |
| Finish with no flow adds cautious line only for a named Slack profile | 10 |
| MCP cancel and CLI detached interrupt leave flow; later finish succeeds | 11 |
| Foreground interrupt stores nothing | 11 |
| Deadlines from valid, absent, unreadable expiry fields | 4 |
| Existing flow expiry paths remain unchanged | 10 |
| Profile update/remove during wait | 8, 10 |
| Secrets migration by this release and prior release recorded-store recovery | 2, 9 |
| Same-role reauth after app replacement | 8 |
| App id learned once under simultaneous first signs; cleared for new client | 1, 7, 8 |
| Redaction snapshots on every surface | 10, 12 |
| CLI/MCP parity | 12 |
| Full verification guards and `pnpm verify` | 15 |

## Risks and review focus

- **Credential-store split brain:** an older binary may move the root store without the ledger bundle. Review every pending read for `entry.store`, every current-account read for the root store, and the current-release migration's single atomic rewrite.
- **Lock scope and lost answers:** token selection and the status CAS use the machine-wide credential lock, but the external call must not hold it. Bound the request; re-check the exact entry after the call; ensure a timeout/drop leaves `pending`; confirm refresh/sign-in/migration tests show no deadlock or stranded bundle.
- **Concurrent first sign-ins:** app-id learning and account creation share one config update. Review uncertain config commits and staged-secret withdrawal so the losing token is neither referenced nor silently leaked.
- **Over-broad transition relaxation:** only a provenance mode move or documented same-role replacement may change app/client. Own-app reauth must still require the same person/workspace/app.
- **Ledger cleanup ordering:** deleting the entry before the bundle, or the bundle before all token states are final, can strand a live token or lose the only reference to it. The event journal and restart tests are release blockers.
- **Expiry parsing:** unreadable and absent fields use a fixed fallback from entry creation, never a sliding retry deadline. The result must expose the fixed value.
- **Timeout/cancellation races:** a wait may end because its caller cancelled, its own wait elapsed, the flow expired, the profile changed, or an outcome arrived. Review ownership/claim/discard paths separately; no new timeout state is allowed.
- **Untrusted wording:** errors and profile display fields cross CLI, MCP, logs, and HTML. Snapshot safe strings once, keep the envelope, and inspect redaction fixtures for bearer-like values and control-token injection.
- **Generated drift:** edit CLI/MCP descriptions and skill source, then use `sync:reference`/`sync:skills`. Never repair generated pages by hand.
- **Regression surface:** version-1 Slack fixtures and explicit own-app commands dominate the existing suite. Run the full Slack package after every profile slice, not only at Task 15.

## Planned task list

1. Core ledger, provenance, and profile-app CAS primitives.
2. Secret discovery and migration across recorded pending stores.
3. Dedicated one-shot `auth.revoke` transport grant.
4. Pure revocation deadlines and answer classification.
5. Durable independent-token ledger executor.
6. Profile add selection and exact flow snapshot.
7. Exchange validation, provenance, and atomic app-id learning.
8. Atomic profile app moves and replacement reauth.
9. Doctor/remove/migration recovery of pending revocations.
10. Cautious, sanitised profile sign-in failure semantics.
11. Detached-wait cancellation without flow consumption.
12. CLI/MCP parity, capabilities, and generated references.
13. `slack-setup` skill rewrite and generated skill outputs.
14. Full guard mutation audit and static escape-hatch scan.
15. Package suites, root guards, final `pnpm verify`, and handoff.
