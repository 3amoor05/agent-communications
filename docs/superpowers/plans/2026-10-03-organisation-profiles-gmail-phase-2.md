# Organisation Profiles Gmail Phase 2 Implementation Plan

> **For Codex:** Execute this plan test-first. The source of truth is `docs/superpowers/specs/2026-10-02-organisation-profiles-design.md`, especially §D6 and the phase-2 cases in §5.

**Goal:** Route Gmail consent through organisation-owned or adopted OAuth clients, validate those generations through one shared core guard, carry and recheck the routing decision through completion, and expose the same setup behavior through CLI and MCP.

**Architecture:** Add a single core validator for a live organisation Gmail generation. Put Gmail's ordered §D6 selection in one operation-level module used by inbox add and setup. Persist the selected client id and generation in the OAuth flow, then extend the existing completion-time client check to validate both before saving. Keep import and reauth semantics independent except for documented explicit-client migration.

**Tech Stack:** TypeScript executed by Node's type stripper, `node:test`, pnpm workspaces, Biome, MCP/CLI capability parity.

---

### Task 1: Specify and implement the core live-generation validator

**Files:**
- Modify: `packages/core/test/organisations.test.ts`
- Modify: `packages/core/src/organisations.ts`
- Modify: `packages/core/src/index.ts`

1. Add tests for a valid owned generation, valid adopted generation, missing client row, mismatched provider/id/secret reference, wrong ownership marker, and an adopted row marked for another organisation.
2. Run the focused core test and confirm the new cases fail.
3. Add and export one validator that enforces the §D6 live-row contract and gives `org update <organisation>` as the repair.
4. Re-run the focused test.

### Task 2: Specify every §D6 client-selection row

**Files:**
- Create: `packages/gmail/test/organisation-routing.test.ts`
- Create: `packages/gmail/src/operations/client-choice.ts`
- Modify: `packages/gmail/src/operations/signin.ts`

1. Add surface tests for explicit-client precedence, organisation-name routing with and without `--email`, the single `forOtherAddresses` route, ambiguous profile refusal, legacy fallback restricted to unassociated clients, and the profile-only refusal with all three remedies.
2. Add cases for a profile with no active generation, retained-generation `serves` on explicit `--client`, and missing/reused active rows reached by both organisation-name and `forOtherAddresses` routing.
3. Run the focused Gmail test and confirm the cases fail.
4. Implement the ordered choice table once and call it from inbox-add sign-in.
5. Re-run the focused test.

### Task 3: Carry and enforce the routing decision through consent

**Files:**
- Modify: `packages/gmail/test/organisation-routing.test.ts`
- Modify: `packages/gmail/src/auth/flows.ts`
- Modify: `packages/gmail/src/operations/consent.ts`
- Modify: `packages/gmail/src/operations/inboxes.ts`
- Modify: `packages/gmail/src/auth/session.ts`
- Modify: Gmail MCP result schemas and renderers as required

1. Add tests proving completion rejects a changed expected client id/generation, post-consent `serves` mismatch revokes best-effort and stores nothing, results/list identify client and organisation, and inbox import remains unchanged.
2. Run the focused tests and confirm failure.
3. Record expected client id and selected generation in the flow, extend the existing same-client guard, perform post-consent address validation and best-effort revocation, and expose client/organisation in results.
4. Re-run the focused tests.

### Task 4: Make setup use the same client choice

**Files:**
- Modify: `packages/gmail/test/setup.test.ts`
- Modify: `packages/gmail/test/cli.test.ts`
- Modify: `packages/gmail/src/operations/setup.ts`
- Modify: `packages/gmail/src/operations/setup-progress.ts`
- Modify: `packages/gmail/src/cli/program.ts`
- Modify: `packages/gmail/src/cli/client-step.ts`
- Modify: `packages/gmail/src/cli/console-walk.ts`

1. Add tests for profile-selected setup, profile-only fallback, skipped Cloud walk and explanatory wording, and updated no-shared-client wording.
2. Run the focused setup/CLI tests and confirm failure.
3. Compute setup's client-step status from the shared §D6 selector for the target mailbox, and update the interactive/headless rendering.
4. Re-run the focused tests.

### Task 5: Add setup profile import with separate approval and CLI/MCP parity

**Files:**
- Modify: `packages/gmail/test/cli.test.ts`
- Modify: Gmail MCP tests
- Modify: `packages/gmail/src/cli/program.ts`
- Modify: Gmail MCP tool registration and schemas
- Modify: `capabilities.json`
- Modify: core exports if required

1. Add CLI and MCP tests for `--profile`, the separate organisation approval, headless exit 10, and `--org-approval` claiming it before setup continues.
2. Run focused tests and confirm failure.
3. Invoke core's organisation-add operation through the normal approval gate, add matching CLI/MCP arguments, and record capability parity.
4. Re-run focused tests and strict parity.

### Task 6: Document explicit reauthentication onto an organisation client

**Files:**
- Modify: Gmail setup skills and their source references
- Modify: Gmail README/reference/troubleshooting documentation selected by the repository generators

1. Add `inbox reauth <name> --client <org>-1` where reauthentication is documented.
2. Regenerate derived skill/reference files only through repository scripts and inspect any pinned wording changes.
3. Run `verify:skills` and `verify:reference`.

### Task 7: Mutation-check every new guard

**Files:** all implementation guards introduced above

1. For each guard, make a one-line mutation that disables or reverses it.
2. Run the smallest focused test expected to catch it and record the failing test.
3. Restore the guard before continuing. A guard without a catching test must receive another test.

### Task 8: Full verification and handoff

1. Run all focused files.
2. Run the complete core and Gmail package suites.
3. Run `pnpm exec biome check .`.
4. Run the repository typecheck script if present.
5. Run `pnpm verify:parity -- --strict`, `pnpm verify:skills`, and `pnpm verify:reference`.
6. Run `pnpm verify` and report its pass/fail result.
7. Inspect the final diff and list every changed file, §D6/test mapping, mutation result, deliberate wording-fixture change, and judgement call.
