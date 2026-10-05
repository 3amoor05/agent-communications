# CUE-404 / 0.14.0 — approval smoothness implementation plan

Spec: [2026-10-05-approval-smoothness-design.md](../specs/2026-10-05-approval-smoothness-design.md), approved for
planning after its adversarial review rounds. It is the source of truth, and this plan re-decides nothing in it: where
a task says "as D1 says", the spec's words are what to build, and the task names where in the code they land. Base:
`fix/cue-404-approvals` at `b5f3875`, which is the 0.13.0 release (`afd195e`) plus the spec. Target: **0.14.0, a
minor release**. Approval records move to version 2 (`DIGEST_VERSION` 2, with a new binding). The shared config gains
version 3 (the send epoch and the legacy drain). Approvals behave differently: route-bound lifetimes, waits,
`SEND_OUTCOME_UNKNOWN` and the unsent report.

**Precondition.** D7 needs 0.13.1 (CUE-403). Every printed command goes through its locator (`locateCliCommand`,
`PrintedCommand`, `packages/core/src/cli-command.ts`), and that locator is not on this branch yet: CUE-403 is at its
task 10 on `fix/cue-403-cli-path`. Rebase this branch onto `main` after 0.13.1 merges and before Task 9. Tasks 1–8
only move wording that already exists, so they may start on the current base, but they are rebased too.

**How to use this plan.** Each numbered task is one reviewable commit, or the short named commit series its heading
gives. Tasks run in the dependency order below, and each one leaves `pnpm verify` green. Every task writes its tests
first and watches them fail. Every guard is mutation-tested (§5: "Each guard is watched failing under a mutation,
then restored"): break the guarded condition, watch the named test fail for that reason, restore it, and record the
mutation and the failing test in the commit message or the review notes. Line numbers are from `b5f3875` and drift as
tasks land; the function names are the anchor. The §5 case labels used in each task are defined in the ownership
table at the end, and each label is owned by exactly one task.

**AGENTS.md, as it applies here.**

- **Tests use fakes and fake credentials only. They never send email, post to Slack or call Resend.**
  - Gmail: `packages/gmail/test/support/fake-google.ts`, a loopback server whose only send route is `drafts/send`.
  - Slack: `packages/slack/test/support/fake-slack.ts`.
  - Resend: `packages/resend/test/support/fake-resend.ts`, with the fake keys in `support/harness.ts`.
  - Homes are temporary. No real address, token or key goes into any fixture, and none is ever printed.
- **Only `send.execute` (`executeSend` in `packages/gmail/src/operations/send.ts`) may call `transport.sendDraft`.
  Only `executeSend` in `packages/resend/src/operations/send.ts` may reach `emails.send`.**
  - `test/send-path.test.mjs` and `packages/resend/test/send-path.test.ts` enforce this; the second asserts there is
    exactly one `spendOn(` in `send.ts`, inside `executeSend`. Both stay green and unweakened in every task.
  - Fences, heartbeats and leases are approval-store calls. None of them adds a send path.
  - This rule matters most in Tasks 7, 12 and 17.
- **Sender-controlled strings reach a result only inside the untrusted-content envelope.**
  - Core surfaces use `wrapUntrusted` (`packages/core/src/untrusted.ts:108`). Core must not import channel packages
    (the channel-plugins design).
  - Gmail uses `wrapField`, `addressField` and `filenameField` from `packages/gmail/src/domain/untrusted-fields.ts`,
    plus a new `domainField`.
  - This rule matters most in Tasks 11, 14, 18, 21 and 22.
- **CLI–MCP parity.** Each new command and tool pair calls one function in `packages/*/src/operations`, and a
  `capabilities.json` row names that function as its `operation`. `pnpm verify:parity --strict` drives both sides.
  Task 10 adds the only new rows (the four waits). Tasks 11, 18 and 22 change the results of existing rows, not their
  operations.

**The risky tasks are marked Risky.**

- **Tasks 1–9** change what an approval binds, what can be claimed and when. Review the refusal paths and the
  lock-held windows, not only the happy path. In Tasks 4 and 8, review every config write and record-lock acquisition
  for lock order.
- **Tasks 12, 13, 16 and 17** are the three send gates and the confirmation route. Compare every provider call with
  the fence before it and with what the result claims happened.
- **Tasks 14 and 15** decide escalation. Review every path that could turn doubt into "previously written".
- **Task 19** is download claims.
- **Task 20** deletes records under concurrency. Review the crash windows step by step.

## Decisions the spec leaves to the plan

The spec is silent on each of these. Each is a choice a reviewer can veto before Task 1, and none changes a design
decision.

1. **A version-1 config converts to version 3 without renaming anything.** Version 3 carries `naming: 1 | 2`, and its
   body is validated by the version-1 or version-2 body rules. `ConfigStore.migrateNames` (`config.ts:1044`) also
   accepts a version-3 config with `naming: 1` and writes version 3 with `naming: 2`. Version 3 is never written back
   as version 2 (R28c). Renaming needs its own preview and approval (`agentcomms names migrate`), so the conversion
   cannot do it silently.
2. **`NEW_CONFIG_VERSION` stays 2.** The conversion door is the only writer of version 3, and it runs before the first
   operation that relies on the epoch, exactly as D1 says.
3. **The drain closes 10 minutes after `since`.** D1 says the drain stays open until "the longest v1 pending lifetime
   has passed". The drain tracks v1 *send* records only, and 0.13.0 gave those 10 minutes (`APPROVAL_TTL_MS`,
   `approvals.ts:401`). The 30-minute v1 download questions are never tracked.
4. **A claim or approval reads the effective policy, not only the epoch, from the same config read inside the record
   lock.** That read is the linearization point D1 names. The caller-supplied `live.policy` of `claimForSend`
   (`approvals.ts:727`) is removed, because a value read before the lock is exactly the 0.13 weakness.
5. **The send epoch is incremented inside `ConfigStore.update`** (`config.ts:868`), so every writer is covered. No
   command writes `defaults.sendPolicy` today (only `classifyChange` reads it, `config.ts:1537`), so the
   default-policy cases (R26c, R27g) drive `ConfigStore.update` directly. On a version-1 or version-2 config,
   `update` refuses (as a bug) any write that changes an existing owner's effective send policy, so no writer can skip
   the conversion.
6. **A change record's `channel` is the manifest channel of the surface that prepared it** (`core` for core's own
   surfaces). `ChangeOptions` carries the channel. A download's `channel` is the channel the files come from.
7. **The wait tools pass the update gate as look-ups** (`{ lookup: true }` in each server's `approvals` map, and
   `approvalsOf` for the commands), so status still answers while an update is pending.
8. **A refusal carries its approval object in `CommsError.details.approval`.** A success carries it as a top-level
   `approval` field. Both use the same object.
9. **The drain report goes on the result of whichever operation ran the conversion or a drain retry**, as a
   `legacyDrain` field (ids only). `agentcomms doctor` also reports an open drain.
10. **"Skill evaluation" in §5 becomes contract assertions over skill text.** The repository has no skill-evaluation
    harness, so the assertions go in `test/skill-contracts.test.mjs`: required instructions present, forbidden ones
    absent.
11. **The frozen 0.13.0 release is vendored by Task 24.** §5 Round-28 says "the frozen 0.13 tarball the release tests
    already use", but none exists. The newest frozen fixture is hand-copied 0.12.1 source
    (`packages/core/test/fixtures/config-v2-0.12.1.ts`).

Citations corrected against the code (the spec's other citations match):

- Spec line 116, `send.ts:518`, is `finishApproval`. Released `executeSend` reads policy at `send.ts:565-566`, reads
  the draft at `586` and claims at `596-605`.
- Gmail's last provider step before the send is `send.ts:630-654`: the reservation at 632, the re-read at 641 and
  `sendDraft` at 654.
- Slack's file steps are at `send.ts:1048-1087`. The message post is at `756-765`.
- Resend's send request is at `send.ts:616-620`. The schedule enters the payload at `426`, and the scheduled result
  fields are at `586` and `721-722`.
- Taint retention is at `taint.ts:253-264`.
- The claim's never-handling is at `approvals.ts:758-759` and `771-774`.

## Phase A — data-model foundations

1. **Risky — Version-2 approval records: two digests, one binding, a stored route and identity.**

   **Changes.**

   - **New module `packages/core/src/approval-binding.ts`.**
     - The lifetime profile: chat 600 000 ms, confirm 1 800 000 ms, approved 86 400 000 ms, download 1 800 000 ms.
     - The types `ApprovalRoute`, which is `chat` or `confirm`, and `OwnerScope`, which is `owner`, `prospective` or
       `global`.
     - `identityOf(record)`, which returns `{ approvalId, channel, ownerScope, inboxId, inboxSub, draftId,
       draftMessageId, expect }`, plus `sendEpoch` on a send.
     - `bindingDigestOf(record)`, which builds exactly the spec's objects under **Digest integrity**:
       - For a send or change: `{ v: 2, kind, contentDigest, route, pendingMs, approvedMs, identity }`.
       - For a download: `{ v: 2, kind: "download", contentDigest, profile: { pendingMs, policy, requiredPolicy },
         identity, offered, listing? }`. Optional listing members are omitted when absent, and `listing` itself is
         omitted when the record has none.
       - It hashes with `canonicalJson` and `sha256Hex` from `packages/core/src/digest.ts`.
   - **`packages/core/src/approvals.ts`.**
     - `DIGEST_VERSION = 2` (line 293).
     - `ApprovalRecord` (302-336) gains the fields below. `digest` survives only on the legacy shape, for Task 3's
       decoder, and `kind` becomes required on version 2.
       - `channel`, `ownerScope`, `route`, `pendingMs`, `approvedMs`.
       - `contentDigest`, `bindingDigest`, and `sendEpoch` on sends.
     - `create` (535-563) takes `channel` and `sendEpoch`. It stores `route` as `confirm` when the effective
       `requiredPolicy` is `confirm` (an escalation or a confirm policy) and `chat` otherwise, and it sets
       `expiresAt = createdAt + pendingMs(route)`.
     - `createChange` (823-858) derives `ownerScope` from `change.target`, the shape `targetOf` already produces
       (`changes.ts:157-180`). The route is the live change policy.
       - `null` target → `global`, with `inboxId: ''`.
       - A target without an id → `prospective`.
       - A target with an id → `owner`.
     - `createDownload` (921-970) takes `channel`.
     - Each create path validates `channel` against `CHANNEL_SNAPSHOT` (`channels.generated.ts`) and refuses an
       unknown one.
     - `LiveDraft.digest` becomes `contentDigest`. `approve` (682-718), `claimForSend` (725-799), `claimForChange`
       (872-911) and `claimForDownload` (1026-1066) compare against `contentDigest`.
     - The comment at 304 ("byte for byte what it was before change approvals") is replaced, because version-2
       sends write `kind: 'send'`.
   - **New module `packages/core/src/send-epoch.ts`** with `sendEpochOf(config, ownerId)`, which reads an absent value
     as 0. Version 3 does not exist until Task 4, so every epoch reads 0 until then.
   - **Callers.**
     - Gmail: `prepareSend` (`send.ts:390`) passes `channel: 'gmail'` and the epoch. `beginApproval` (486) and
       `executeSend` (645) compare `contentDigest`.
     - Slack: `preparePost` (`send.ts:435`) and `prepareReaction` (1263); `reactionOfApproval` (1244-1258) uses
       `contentDigest`.
     - Resend: `prepareSend` (`send.ts:290`), `reload` (372) and `beginSendApproval` (859).
     - Core: `prepareChange` (`changes.ts:204`) takes `channel` from `ChangeOptions`. Gmail, Slack, Resend, WhatsApp
       and core each pass their manifest channel wherever they call `gatedChange` or `gatedChangeAtTerminal`.
     - `askWhereToSave` (`save-destination.ts:709`).

   **Tests first.** Add `packages/core/test/approval-binding.test.ts` and extend `packages/core/test/approvals.test.ts`.
   Cover §5 R14d, R15c, R15d, R17c, R18c, R19a, R20b, R24h, R26e, R32i, R34c, D1rt-b and D1vt-a:

   - Golden canonical JSON and SHA-256 vectors for:
     - every kind, including a Slack reaction;
     - the download profile;
     - `offered` with both folder choices;
     - a download with an absent, an empty and a populated listing, and with and without optional listing members.
   - Create-path round trips for every subtype that prove the exact identity hashed: Gmail send, Slack post, Slack
     files, Slack reaction, Resend send, change (`owner`, `prospective` and `global`), Gmail download and Slack
     download.
   - Editing `channel`, `ownerScope`, `sendEpoch`, `route` or any other identity field changes `bindingDigest`.
   - An unknown channel is refused at creation.
   - The real create path writes the v2 fixture.
   - A v1 record is refused by the version gate on every claim, execute and approve: Gmail `executeSend` and terminal
     approve, Slack `sendPost`/`react`, and Resend `executeSend`/`finishSendApproval`.

   Mutations, each of which must fail a named vector or round-trip test:

   - drop a field from `identityOf`;
   - keep an absent optional listing member as `undefined`;
   - skip channel validation;
   - leave `DIGEST_VERSION` at 1.

   **Done when.** Every new record is version 2 with both digests. The binding recomputes from stored fields alone.
   Every caller compiles against `contentDigest`. The existing approval suites pass on version-2 fixtures.

2. **Risky — State-specific timestamps on every transition, and the version-2 integrity validator.**

   **Changes.**

   - **Transitions in `packages/core/src/approvals.ts`.**
     - `approve` (682-718) writes `approvedAt`, `usableUntil = approvedAt + approvedMs` and `approvedBindingDigest`.
     - `answerDownload` (979-1005) writes no `approvedAt`, and `approvedDigest = sha256(canonical { bindingDigest,
       answer })`.
     - `claimForSend` writes `sendingAt`. `claimForChange` and `claimForDownload` write `usedAt`.
     - `complete` (1069-1076) writes `usedAt = sentAt` with a non-empty `sentMessageId`, or `failedAt`. An empty id is
       refused.
     - Every revoke or void writes `revokedAt`.
     - `#derive` (513-533) persists `expiredAt` as the boundary that applied.
     - `updatedAt` stays, because the legacy decoder and the retention fallback still use it.
   - **New module `packages/core/src/approval-validate.ts`.** It exports `validateV2(record, fileId)`, which returns
     `ok`, or a fixed integrity reason plus `attribution: 'verified' | 'unverifiable'`. It checks:
     - **Digests.** Both are 64 lowercase hex characters. `bindingDigest` recomputes. For a change or download,
       `contentDigest` recomputes through `changeDigest` or `downloadDigest`; for a send only its encoding is checked.
     - **Identity.** The stored `approvalId` equals the file name's id. Where a listing is stored, `download.names`
       equals the listing names in order.
     - **Evidence.** The per-kind evidence table, row by row. `approvedVia: 'chat'` is corrupt. A stored download
       answer is allowed only with valid terminal or form evidence.
     - **Timestamps.** Every invariant under "Version-2 timestamps fail closed": exact pending lifetimes; approved
       fields with `createdAt <= approvedAt < expiresAt`; the placement and order of `sendingAt`,
       `sendingHeartbeatAt`, `usedAt`, `sentAt`, `failedAt`, `revokedAt` and `expiredAt`; and the single
       `clock-anomaly` ordering exemption.

     The validator is pure. Task 3 wires it into reads.

   **Tests first.** Add `packages/core/test/approval-validate.test.ts` and extend `approvals.test.ts` so each
   transition writes exactly its fields. Cover §5 R12a, R13a–R13d, R14a–R14c, D1vt-e, D1vt-g, D1vt-h and D1vt-k:

   - A table of kind × route × `approvedVia` × state, valid and invalid.
   - Every descendant of an approved lineage with missing, malformed or contradictory evidence.
   - Direct-chat `sending` and `used` records with no evidence stay valid.
   - Confirm downloads in `approved` and `used` with no `approvedAt` stay valid.
   - An approved-then-revoked record keeps its evidence; direct-chat `failed` and `unknown` records carry none.
   - Every timestamp missing, non-finite, misordered or in the wrong state.
   - `usedAt == sentAt`, and the `usedAt` orderings for changes and downloads.
   - The placement of the heartbeat field.
   - A stored approved record with `approvedAt == expiresAt` is corrupt.

   Mutations, each of which must fail its row: drop one evidence row, accept `approvedVia: 'chat'`, accept `approvedAt
   == expiresAt`, and widen the clock-anomaly exemption to another reason.

   **Done when.** Every record the store writes passes the validator, and every listed violation yields its fixed
   reason.

3. **Risky — One decoder for every read: version-2 validation, two corrupt classes, unreadable stubs and the shared
   legacy v1 decoder.**

   **Changes.**

   - **`approvals.ts` `#read` (499-506).** Returns a discriminated `StoredApproval`:
     - **v2**: a validated record.
     - **Corrupt v2**: carries its safe fields and its attribution class.
     - **Legacy**: the decoded v1 view.
     - **Unreadable**: the stub `{ approvalId, state: 'corrupt', reason }`. `reason` is a fixed category (invalid
       JSON, truncated, missing ownership, missing kind, wrong shape) and never echoes file bytes. The `approvalId` is
       taken only from a file name that passes `APPROVAL_ID_PATTERN`.
   - **New module `packages/core/src/approval-legacy.ts`.** `decodeLegacyV1(raw, config, now)` applies only v1's own
     rules:
     - An absent `kind` is a send.
     - State is derived exactly as 0.13.0 `#derive` derives it (creation-relative expiry; `sending` turns `unknown`
       after 5 minutes on `updatedAt`), and nothing is written back.
     - No v2 timestamp is ever added.
     - `ownerScope` is `global` when `inboxId` is `''`, else `owner`.
     - The channel: `ibx_` is Gmail. `acc_` is the stored `platform` of the account while it still exists. Anything
       else is unattributable.
     - The output is `{ approvalId, kind, state, legacy: true, createdAt, expiresAt }` plus the same summary fields a
       v2 record shows.
   - **`get` (565-568)** returns `StoredApproval`.
   - **`#transition` (571-589)** refuses before `decide`:
     - legacy records, with the existing "prepared by a different version" refusal;
     - corrupt records and unreadable stubs, which are never rewritten;
     - a stored `approvalId` that differs from the file name. That case is corrupt before `#path`, the lock or
       `#markClaimed` (802-814) touch the other id.
   - **`list` (1085-1104)** drops `.catch(() => null)`. It returns every file as one of the four forms.
   - **Callers adapt mechanically**, treating anything not v2 as unusable; Task 9 reworks them properly:
     - core: maintenance `listApprovals` (`maintenance.ts:405`) and `revokeApproval` (430); `claimsApproval`
       (`update-gate.ts:82-91`);
     - Gmail: `listApprovals` (`send.ts:747`), `refuseWhileSending` (`drafts.ts:561`, `organise.ts:128`);
     - Resend: `ownRecord` (`send.ts:86`) and `sendStatus` (748);
     - Slack: `approve.ts`;
     - `save-destination.ts`.

   **Tests first.** Add `packages/core/test/approval-store-read.test.ts`. Cover §5 R11a, R13e, R17a, R18d, R20c, R23g,
   R25f, R32g, R32j, R34d and D8i-b:

   - Invalid JSON, every truncation boundary, missing ownership or kind, and wrong-shaped scalars and arrays each
     become the stub, with no file bytes in it.
   - A missing, malformed, non-canonical or mismatched `bindingDigest` is attribution-unverifiable.
   - A send's `contentDigest` is checked for structure only; for changes and downloads it is recomputed on status
     reads.
   - File name A holding stored id B, with B existing and with B absent: corrupt, and no write or claim marker touches
     B.
   - Listing round trips (absent, empty, populated), with names compared only when a listing exists.
   - An edited `channel` falls into the stub class.
   - A Slack revision changed to another valid value while every digest is left unchanged is corrupt.
   - A released-shape v1 send with no `kind`.
   - v1 `pending` and `approved` records before and after their original expiry.
   - `ownerScope` derivation.
   - Attribution: `ibx_`; `acc_` while the account exists; the same `acc_` record unattributable after the account is
     removed.
   - One list mixing v1 and v2 records: the v1 ones are `legacy: true`, never `corrupt`, and the v2 missing-binding
     rule never applies to them.

   Mutations: restore the catch-and-skip; put a byte of the file in `reason`; let the decoder write; treat a v1 record
   with no binding as corrupt; drop the filename check.

   **Done when.** No read returns a record it has not validated or decoded, nothing is silently omitted, and v1 files
   are readable for reporting only.

4. **Risky — Config version 3: the send epoch, the conversion door and the legacy drain.**

   **Changes.**

   - **`packages/core/src/config-version.ts`.** `ConfigVersion = 1 | 2 | 3`. The module comment records the spec's
     deliberate departure from the two-step rule (§4 item 0). `NEW_CONFIG_VERSION` stays 2 (decision 2).
   - **`packages/core/src/config.ts`.**
     - `READABLE_CONFIG_VERSIONS = [1, 2, 3]` (line 30).
     - `ConfigV3` is `naming: 1 | 2` (decision 1) plus the matching body, `sendEpochs?: Record<ownerId, number>` and
       `legacyDrain?: { since, tracked: Record<approvalId, 'open' | outcome> }`.
     - `configV3Schema` is a `looseObject`, so unknown keys survive.
     - `parseConfig` (812-833) accepts version 3.
     - `ConfigStore.update` (868-1016) still refuses any version change. On version 3 it:
       - increments `sendEpochs` for every owner whose effective send policy becomes `never`, through
         `fencedOwners(before, after)` against `effectiveSendPolicy` and `effectiveAccountSendPolicy` (760-772);
       - never decrements an epoch;
       - refuses to loosen a send policy while `legacyDrain` exists ("records from an earlier release are still being
         retired");
       - and refuses a send-policy change on version 1 or 2 (decision 5).
     - New `ConfigStore.convertToVersion3(scan)`, the one door, modelled on `migrateNames` (1044-1116). It runs under
       the config lock: it re-reads the file, returns an existing version 3 unchanged (idempotent), runs `scan` under
       the lock, and writes version 3 atomically, with `legacyDrain` only when something was tracked.
   - **`approvals.ts`: new `revokeLegacy(id, reason)`.** This is the one write a v1 record ever receives. Under the
     record lock, it rewrites a record that is `pending` or `approved` by v1 derivation to `revoked` **in v1 shape**,
     so 0.13 still parses it, with the reason `prepared by an earlier release; prepare it again`. It reports each
     record's outcome.
   - **`send-epoch.ts`: `ensureSendEpochConfig(core)`.**
     - **Converting.** It scans v1 send records that are `pending` or `approved` by the legacy decoder and marks
       them `open`; historical `used`, `failed`, `revoked` and `expired` records are never tracked.
     - **While the drain is open, on every call:**
       - rescan and add any untracked active v1 record, through a locked config write;
       - retry each open revocation under its record lock;
       - record each record's outcome: `revoked`, `expired`, `used`, `failed`, `sending` or `unknown`;
       - and remove `legacyDrain` only when every tracked record has an outcome, a rescan finds nothing new, and
         `since + 10 min` has passed (decision 3).
     - It returns `{ config, legacyDrain: { couldNotRevoke, inFlight } }`, with ids only.
   - **Callers of `ensureSendEpochConfig`.** It runs first in each operation that relies on the epoch:

     | Kind | Gmail | Slack | Resend |
     |---|---|---|---|
     | Prepare | `prepareSend` (`send.ts:390`) | `preparePost` (435), `prepareReaction` (1263) | `prepareSend` (290) |
     | Claim | `executeSend` (552) | `postPrepared` (696), `reactPrepared` (1420) | `executeSend` (516) |
     | Approval | `finishApproval` (512) | `finishApproval` (`approve.ts:188`) | `finishSendApproval` (890) |
     | Send-policy write | `inboxPolicy` (`inboxes.ts:220`) | `policyChange` apply (`changes.ts:658`) | `policyChange` apply (`accounts.ts:439`) |

     The result carries the drain report (decision 9). `doctor` (`maintenance.ts:73`) names an open drain.

   **Tests first.** Add `packages/core/test/config-v3.test.ts` and extend `packages/core/test/config-secrets.test.ts`
   and `packages/core/test/release-gate.test.ts`. Cover §5 R26c, R26d, R27g, R28b, R28c, R29d–R29f and R32a–R32d:

   - Conversion happens in the same locked write before a 0.14 prepare, claim or approval on a version-2 config, and is
     idempotent.
   - Version 3 is never written back as version 2, and its unknown keys survive (including through `migrateNames`).
   - A crash after the version-3 write with one revocation failed, then a restart: the tracked set survives, the next
     operation retries it, and loosening is refused until the drain closes.
   - A v1 record written by a paused prepare after the scan joins on the next rescan.
   - The drain does not close before `since + 10 min`.
   - Historical `used` and `failed` v1 records are never tracked.
   - The drain clears with one case each for a tracked record that ends `used`, `failed`, `sending` or `unknown`, and
     each is listed.
   - A version-3 config with no v1 records never gains `legacyDrain`.
   - A default-policy change to `never` raises the epoch of every owner with no setting of its own, and of no other.
   - An owner's own change raises only its own epoch.
   - Loosening leaves every epoch as it is.

   The 0.13 process cases R28a and R29a–c are Task 24's.

   Mutations: decrement on loosening; skip owners that inherit the default; allow loosening while the drain is open;
   close the drain without the time check; let `update` change the version; write the revoked v1 record in v2 shape.

   **Done when.** Version 3 is reachable only through the door, epochs only grow, the drain is durable and retried, and
   0.14 cannot loosen a send policy while it is open.

## Phase B — the gate's semantics in core

5. **Risky — One locked classification: `approvalOutcome` inside every transition.**

   **Changes.**

   - **New module `packages/core/src/approval-outcome.ts`.**
     - `approvalOutcome(stored, context)`. The context is the action (approve, claim, wait, revoke, inspect), the
       expected kind and owner pin, a `LiveGate`, whether the send client is trusted, and any challenge.
     - It returns `{ state, claimable, ownerRemoved?, reason?, approval, error? }`. These implement D2's table and
       its `claimable` definition, including the download matrix.
     - A stale epoch is derived as `revoked` with reason `sending was turned off since this was prepared (policy:
       never)`.
     - An `owner`-scope record whose owner is gone is derived as `revoked` with reason `its mailbox or account was
       removed` and `ownerRemoved: true`. `prospective` and `global` records are never treated this way, and no
       default policy or epoch is assumed for a removed owner.
     - A pending or approved send under a live `never` keeps its real state, with `claimable: false` and D2's
       wording.
     - `APPROVAL_REQUIRED` describes only a pending record that needs a person.
     - `approval` is D8's public object, built by `publicApproval(outcome)`.
   - **`ApprovalStore` takes a `liveGate(record)` reader.** It returns owner existence, effective send and change
     policy, and the send epoch, all from one `config.load()`. `openCore` (`core.ts:29-42`) wires it from `ConfigStore`.
   - **`#transition` (571-589)** reads the file and then the live gate inside the record lock, classifies, and writes.
     - `#stateError` (591-614) gives way to the outcome's error.
     - `#requireKind` (622-657) and ownership move before state. A nonexistent, foreign, wrong-kind or pinned-away id
       throws one byte-identical `NOT_FOUND` with `approval: null`, before any classification.
   - **New `inspect(id, expect)`**, a locked read that persists only derived expiry and `unknown`. This extends the
     write-back rule to every read, as "Expiry is monotonic" requires.
   - `revoke` (1079-1083) goes through the classifier and persists a derived revocation.
   - The wrong-code path (704-716) keeps its boundary.
   - `claimForSend` loses `live.policy` (decision 4).

   **Tests first.** Add `packages/core/test/approval-outcome.test.ts` (every row of the D2 table that core alone can
   produce) and extend `approvals.test.ts`. Cover §5 R14e, R15e, R33a, R33f, D1rr-d, D1cc-b, D2-e and D2-g:

   - Provider-free classification of removed-account Slack post, file, reaction and Resend records, and of a Slack
     round trip from its stored `inboxId`.
   - `pending`, `approved` and `used` records whose owner is removed. No default policy or epoch is applied, the first
     locked action persists `revoked`, and re-adding an owner of the same name does not make the record claimable.
   - Wrong codes one and two stay pending; the third revokes.
   - `APPROVAL_REQUIRED` never describes `approved`, `expired`, `used`, `failed`, `sending`, `unknown`, `corrupt` or
     `revoked`.
   - Revoke against claim in two processes: one locked winner.
   - A changed draft, changed expected recipients or account, or a drifted plan voids at claim.

   Mutations: classify before checking ownership; let an unknown id produce a different envelope; apply the default
   policy to a removed owner; treat `prospective` as removed; read the live gate before taking the lock.

   **Done when.** Every transition classifies from one fresh config read under its own lock, and nothing classifies
   before the lock.

6. **Risky — Route-bound lifetimes (D1): ten minutes on chat, thirty on confirm, twenty-four hours once approved.**

   **Changes.**

   - **`#derive` (`approvals.ts:513-533`).**
     - Pending records expire at `expiresAt`. Approved sends and changes expire at `usableUntil`. Download questions
       expire at `expiresAt`, answered or not.
     - Equality counts as expired.
     - `expiredAt` is the boundary.
     - Clock anomaly: when `now < createdAt`, or `now < approvedAt` on an approved record, the record expires with
       `expiredAt` set to the observation time and `reason: 'clock-anomaly'`.
   - **Lifetimes.** `APPROVAL_TTL_MS` and `DOWNLOAD_QUESTION_TTL_MS` (401-407), and the store's `ttlMs` and
     `downloadTtlMs` options (487-492), give way to the Task 1 profile. Tests use the injected clock instead.
   - **Wording.** The outcome texts:
     - "this approval expired; nothing was sent with it", with "prepared at … / expired at …" or "approved at … /
       expired unused at …";
     - and "the clock moved backwards; this approval was expired safely at …".
   - **Changes.** `claimForChange` (872-911) can claim an approved change until `usableUntil`.

   **Tests first.** Extend `approvals.test.ts` and `packages/core/test/changes.test.ts`. Cover §5 D1rt-a, D1rt-c–f,
   D1rr-a, D1rr-g, D1cc-a, D1vt-f, D1vt-i and D1vt-j:

   - Chat-route records expire at 10 minutes and confirm-route records at 30, escalated sends included, with equality.
   - After the policy is loosened, a confirm-route record still cannot be claimed directly.
   - A chat-route record tightened to `confirm` returns `APPROVAL_PENDING` inside its original window.
   - An approved record survives its pending deadline and expires exactly 24 hours after approval.
   - Approval at `approvedAt == expiresAt` is refused as expired.
   - A download expires 30 minutes after creation, before or after its answer, and never has `usableUntil`.
   - A conversational "no" followed by claims at 11 and 29 minutes: expired on the chat route.
   - Two simultaneous claims after the old 10-minute boundary of a confirm route: one winner.
   - Expiry persists the exact boundary.
   - Clock rollbacks before `createdAt` and before `approvedAt` persist the observation time, use the clock-anomaly
     wording, accept only that exemption, and stay expired after a restart with the clock corrected.
   - Pending chat change claims.

   Mutations: derive approved expiry at `expiresAt`; compare with `>`; persist the observation time for an ordinary
   expiry; let a chat-route record be claimed under a live `confirm`.

   **Done when.** The four lifetimes hold at their exact boundaries, and an approved record waits a day for its one
   claim.

7. **Risky — The sending lease: claim token, heartbeat, fence and `SEND_OUTCOME_UNKNOWN`.**

   **Changes.**

   - **`packages/core/src/errors.ts`.** Add `SEND_OUTCOME_UNKNOWN` to `ErrorCode` (32-56) and `ERROR_REGISTRY`
     (58-115) with `exit: EXIT_CODES.APPROVAL` (10), `retryable: false` and the summary "the send outcome is unknown;
     check before sending again".
   - **The claim token.**
     - `claimForSend` returns `{ record, claimToken }`.
     - `#markClaimed` (802-814) writes the token, 16 random bytes in hex, into the `O_EXCL` marker.
     - The token never appears in `publicView`, `approval` objects, audit rows, `CommsError` details or results.
   - **Token-checked store operations.** Each validates the token against the marker under the record lock:
     - `heartbeat(id, token)` writes `sendingHeartbeatAt` only while the same claim owns a `sending` record.
     - `fence(id, token)` refreshes the heartbeat and returns `go` while the record is `sending`, and `stop` once it
       is `unknown`.
     - `complete(id, token, outcome)` (1069-1076) moves `sending` or `unknown` to `used` (with a validated non-empty
       id) or `failed`. A late completion replaces the stale-lease reason.
   - **The lease.** `SENDING_STALE_MS` (409) gives way to a 2-minute lease from `sendingHeartbeatAt ?? sendingAt`.
     `unknownAt` is derived, never stored.
   - **The classifier.** A fresh `sending` record seen by another caller is retryable `APPROVAL_PENDING`, "being sent
     by another call since …; wait for it", with `sendingAt`, the heartbeat and `unknownAt`. `unknown` is
     `SEND_OUTCOME_UNKNOWN`.
   - **New module `packages/core/src/sending-lease.ts`.**
     - `withSendingLease(store, id, token, work)` heartbeats every 30 s while `work` runs. A failed heartbeat only lets
       the lease run out. It always stops its timer.
     - `fenceOrStop(…)`: if no step has started, it completes `failed` with reason `lease-lost-before-send`. If steps
       have run, it hands control to the caller's own failure.
   - **Mechanical adoption, so verify stays green.**
     - Gmail `executeSend` (`send.ts:596-744`) and `recordNoSend` (127-158).
     - Slack `claimOrHandOver` (653-679) and `recordNotPosted`, `recordMaybePosted`, `recordPosted`,
       `recordReactionRefused`, `recordReactionUnknown` and `recordReactionChanged`.
     - Resend `executeSend` (549-…) and `recordNoSend` (467-…).
     - Each carries the token and wraps provider work in `withSendingLease`.
     - The per-step fences and the channel wording come in Tasks 12, 16 and 17.
     - AGENTS.md: no new call site of `sendDraft` and no second `spendOn(`, and both send-path tests are unchanged.

   **Tests first.** Add `packages/core/test/sending-lease.test.ts` and extend `approvals.test.ts` and
   `packages/core/test/errors-output.test.ts`. Cover §5 D1sl-a, D1sl-b, D1sl-d, D1sl-e, D1sl-h–j, D1vt-l, D1vt-m, D2-h
   and D2-j:

   - **The token is private.** It is random, and a spy over views, audit rows, errors and results never sees it.
   - **The heartbeat.** It writes every 30 s under the lock, with the token.
   - **The lease boundary.**
     - A heartbeat suspended for more than 2 minutes: status persists `unknown`. The original promise then settles
       and records `unknown → used` or `unknown → failed`.
     - A failed heartbeat write takes the same path.
     - `unknownAt` is exact, and equality is `unknown`.
   - **Who may move a record.**
     - A missing, stale or different token cannot heartbeat or complete.
     - Approve, revoke and claim leave `unknown` final.
     - A resumed heartbeat never revives `sending`.
   - **Late completion.** Late success clears the stale reason; late failure replaces it.
   - **Finality.** Persisted expiry or `unknown`, followed by a clock rollback and a restart, stays final. A rollback
     after `used` or `failed` changes nothing.
   - **The new code.** The registry entry is exit 10 and non-retryable, as JSON and CLI consumers branch on it. Fresh
     `sending` gets the `APPROVAL_PENDING` wording above.

   Mutations: compare tokens loosely; let a heartbeat write `unknown → sending`; base the lease on `updatedAt`; make the
   new code retryable.

   **Done when.** Only the original claimant can finish a send. Its lease survives long work and lapses when it stops.
   An uncertain outcome has its own non-retryable code.

8. **Risky — `never` fences every earlier approval: the epoch at claim and approval, the sweep, and the
   linearization.**

   **Changes.**

   - **`approvals.ts`.** `claimForSend` and send `approve` compare `record.sendEpoch` with the live epoch from the
     in-lock config read (Task 5).
     - **Epoch behind:** persist `revoked` with the reason `sending was turned off since this was prepared (policy:
       never)`, and return `APPROVAL_VOID`.
     - **Live effective `never`:** persist `revoked`, and return `POLICY_NEVER` (today's claim behaviour at 758-759
       and 771-774). This is new for `approve`, which never writes `approved` under `never`.
   - **`send-epoch.ts`: `sweepFencedOwners(core, owners)`.** It runs after the config commit, with the config lock
     released.
     - For each fenced owner it revokes `pending` and `approved` v2 sends under each record's lock.
     - It collects `sending` ids as "already being sent when sending was turned off", and any failures.
     - **Lock order.** The config lock is never held while a record lock is taken. A claim reads config without the
       config lock.
   - **The three send-policy writers** call `ensureSendEpochConfig` (Task 4), then the update that bumps epochs, then
     the sweep:
     - Gmail `inboxPolicy` (`inboxes.ts:220-260`);
     - Slack `policyChange` apply (`changes.ts:658-…`);
     - Resend `policyChange` apply (`accounts.ts:439-…`).

     Each returns `fenced: { revoked, alreadySending, couldNotRevoke }`, and the CLI renderers print it.

   **Tests first.** Add `packages/core/test/send-epoch-fence.test.ts`, with barrier hooks between taking the record
   lock and reading config, and between the commit and the sweep. Extend Gmail `send-gate.test.ts`, Slack
   `send.test.ts` and Resend `send-gate.test.ts` for the policy results. Cover §5 R25a–R25d, R26a, R26b, R27a–R27d and
   D2-k:

   - A claim that read epoch N, then a commit of N+1 before it writes `sending`: the claim proceeds, and the change
     lists the record as already being sent.
   - A commit of N+1 before the claim takes the lock: the claim revokes, and the provider stand-in records no call.
   - The same two orders for terminal approval and trusted-form approval. Neither writes `approved` in the second
     order.
   - A lock-order test: neither operation holds the other's lock.
   - A failed sweep followed by `never → chat` and `never → confirm`: claim, execute and approve each revoke on the
     stale epoch.
   - A prepare that read epoch N, then wrote its record after N+1 and its sweep.
   - `chat → never → chat` and `confirm → never → confirm` for `pending` and `approved` records.
   - A reported revocation failure: the next claim or approval revokes and returns `POLICY_NEVER`.
   - Terminal and form approval under `never` revoke.
   - `requiredPolicy: never` under a live `chat` revokes.
   - An approved send whose policy becomes `never` is not claimable, and its claim returns `POLICY_NEVER`.

   Mutations: read the epoch before the lock; skip the stale-epoch revoke when the live policy is `chat`; let approve
   write under `never`; sweep while holding the config lock; drop the sending report.

   **Done when.** No record prepared before a `never` can send after any loosening. An admitted claim is the only
   exception, and it is reported.

## Phase C — every surface

9. **Risky — Every surface classifies before it acts, and every send-path result says where its approval stands**
   (series: core 1/4, Gmail 2/4, Slack 3/4, Resend 4/4).

   **Changes.** Each package below goes through `inspect` and the classifier, with ownership and kind checked first.

   - **Core.**
     - `changes.ts`: `claimChange` (265), `beginChangeApproval` (352), `finishChangeApproval` (374),
       `recordChangeApprovalRefused` (421) and `revokeChange` (438).
     - `change-flow.ts`: `changeToolResult` (144) and `approvalHint` (265) carry `approval`.
     - `update-gate.ts`: `claimsApproval` (82-91) treats a v2 record of the right kind that is pending or claimable
       as a claim, and treats a look-up of any readable record as a look-up. Corrupt, legacy and unreadable records
       claim nothing.
     - `maintenance.ts`: `revokeApproval` (430-438).
   - **Gmail.**
     - `send.ts`: `beginApproval` (471-509), `finishApproval` (512-543), and `executeSend`, whose early state check
       (571-582) and recheck (645) become the outcome. Also `listApprovals` (747-760) and `revokeApproval` (763-774).
     - Both `refuseWhileSending` guards (`drafts.ts:561`, `organise.ts:128-141`).
     - `mcp/server.ts`: `checkApprovalPin` (389), `needsConfirmation` (2275-2283) and the `gmail_draft_send` handler
       (2339-2430), which checks ownership and kind before choosing a route.
   - **Slack.**
     - `approve.ts`: `beginApproval` (159), `finishApproval` (188), `revokeApproval` (221) and
       `workspaceForApproval` (226).
     - `send.ts`: `claimOrHandOver` and `reactionOfApproval`.
     - `post.ts`: `sendPost` (139) and `react` (160).
   - **Resend.** `send.ts`: `ownRecord` (86-95), `executeSend` (516-534), `beginSendApproval`, `finishSendApproval`,
     `revokeSendApproval` and the `sendStatus` look-up (748-753).
   - **D8 objects.** Every send-path result carries `approval: ApprovalObject | null` (decision 8):
     - **Gmail:** `SendPreparation` (`send.ts:37`), `SendResult` (54), the `gmail_send_prepare` and
       `gmail_draft_send` output schemas, and `renderSendPreparation` and `renderSent` (`cli/render.ts:688, 729`).
     - **Slack:** `PreparedPost`, `PostedMessage`, `PostedFiles`, `PreparedReaction`, `ReactionResult` and their
       tools.
     - **Resend:** `SendPreparation` and `SendResult`, and their tools.

     The object is `null` for `NOT_FOUND` and for every failure before an approval exists.
   - **Change approvals.** `ownerScope` comes through `prepareChange` unchanged.

   **Tests first.** Extend:

   - **Core:** `update-gate.test.ts`, `changes.test.ts` and `core-server.test.ts`.
   - **Gmail:** `send-gate.test.ts`, `mcp-send.test.ts`, and `tool-parity.test.ts:834-926` (pinned).
   - **Slack:** `send.test.ts`, `approve-cli.test.ts`, and `mcp-parity.test.ts:752` (pinned).
   - **Resend:** `send-gate.test.ts` and `mcp.test.ts`.

   Cover §5 R16a, R34a, R34b, D1cc-c, D2-b, D2-c, D8o-a, D8o-b and D8o-d:

   - Each identity field mutated in turn (`inboxId`, `inboxSub`, `draftId`, `draftMessageId`, `expect`) is corrupt
     before approval, claim, provider access or reporting. A provider spy stays empty.
   - A `global` default change-policy change (`confirm → chat`), a `global` installer or update change, and a
     `prospective` first connection, each under the `chat` and `confirm` change policies. Each is prepared, shown
     pending, claimable by its route, approved and applied, and is never `ownerRemoved`.
   - An `owner` change whose mailbox is then removed is `ownerRemoved`.
   - Calls on an old server, both the ones the update gate stops and the ones its exception admits, end closed on the
     digest version.
   - Nonexistent, foreign, wrong-kind and pinned-away ids get byte-identical envelopes with `approval: null`, and a
     spy proves no foreign record was classified or rendered.
   - Prepare-time `POLICY_NEVER`, invalid recipients, unsendable HTML and every other failure before creation carry no
     object.
   - Every success and refusal carries the object or the specified null.
   - "Expired after approval" appears when `approvedAt` exists, `state: approved` and `claimable` stay separate, and
     downloads use their own fields.

   Mutations: check state before ownership on one Gmail, one Slack and one Resend path; drop `approval` from one
   result; let a pinned server classify a foreign record.

   **Done when.** No surface acts on, renders or counts a record before ownership, kind and classification under the
   lock, and every send-path result says where its approval stands.

10. **Waits on every surface (D3): `waitForApproval` and its four capability rows.**

    **Changes.**

    - **New `packages/core/src/operations/approval-wait.ts`.**
      - Signature: `waitForApproval(core, approvalId, { waitSeconds, signal, onProgress, channel, owner })`. It is
        exported from `packages/core/src/index.ts`.
      - **Parameters.** `waitSeconds` defaults to 30 and is bounded 0–300; `0` is status now.
      - **Polling.** It calls `inspect` at most once a second. It keeps polling while the outcome is pending and not
        claimable, and while it is `sending`. It never polls past the pending or usable deadline, or the current
        `unknownAt`.
      - **Stopping.** It stops on a claimable outcome, a terminal or expired outcome, an approved record that the live
        policy makes non-claimable, cancellation or timeout. D3 gives the result shapes, including download
        `answered` and `expired`.
      - **Concurrency.** A module-level limit of 8 waits applies; the ninth gets `TRANSIENT` "too many waits". Each
        slot is released in `finally`.
      - **Progress.** It reports every 15 s, and only when the caller has a progress token.
    - **The four pairs.** Each pair reads the request's signal and progress token from the MCP handler context:
      - **Core:** `agentcomms approval wait <id> [--wait-seconds N]` in `packages/core/src/cli.ts`. It is a new
        `approval` group beside `approvals` (usage at 88, dispatch near 415), named exactly as D3 names it. The tool
        is `comms_approval_wait` in `packages/core/src/mcp/server.ts`, and the server instructions (104-120) name it.
      - **Gmail:** `agent-gmail send wait <id>` and `gmail_send_wait`, pinned through `checkApprovalPin`.
      - **Slack:** `agent-slack approval wait <id>` and `slack_approval_wait`, pinned by workspace.
      - **Resend:** `agent-resend send wait <id>` and `resend_send_wait`, pinned by account.
      - The Slack and Resend `buildInstructions` (`slack/mcp/server.ts:117`, `resend/mcp/server.ts:80`) and Gmail's
        instructions name their wait tool.
    - **Update-gate maps** (decision 7): core 179-186, Gmail 304, Slack 245 and Resend 165.
    - **`capabilities.json`.** Four rows: `core.approval.wait`, `gmail.send.wait`, `resend.send.wait` and
      `slack.approval.wait`. Each has `operation: "waitForApproval"` and an `expect` on `options.channel` with a
      distinct value per row (`null`, `"gmail"`, `"resend"`, `"slack"`), because rows that share an operation must
      differ there (CONTRIBUTING.md, "Adding a capability"). Then run `pnpm sync:reference`.

    **Tests first.** Add `packages/core/test/approval-wait.test.ts` and extend each package's MCP and CLI tests and
    `test/parity.test.mjs`. Cover §5 R33b, R33e, D1sl-f, D3-a–D3-k and D3r-a–D3r-g:

    - **Shapes and limits.**
      - Every result shape; `0`, the default 30 and the maximum 300.
      - No poll past a pending or approved record's deadline, or past a sending record's heartbeat-derived
        `unknownAt`.
    - **When a wait returns.**
      - At once for a chat-route pending record, and at once for a removed-owner record.
      - For a confirm-route pending record, the wait keeps polling.
      - A record first seen `sending` is driven to `used`, to `failed` and to a stale `unknown`, with no
        prepare-again guidance.
      - It stops on each condition D3 lists.
      - A terminal approval ends the wait as `{ approved, claimable: true }` without rewriting the record.
      - A state change against a timeout or cancellation is decided by the final locked read.
      - A timeout returns `pending` or `sending` with the same id and the current `claimable`.
    - **What a wait may write.** It changes bytes only for derived expiry or stale-send finalisation; heartbeats may
      advance underneath it. Status and wait never move `unknown`.
    - **Resources.**
      - A ninth wait is refused.
      - Success, timeout, cancellation, a thrown error and an MCP disconnect each free their slot, proved by an
        eighth replacement wait.
      - Progress arrives only with a token.
      - A read spy sees at most one read a second, and a provider spy sees nothing.
      - Foreign and pinned-away ids get `NOT_FOUND`, including on a server pinned to a removed owner.
      - All four pairs pass parity.

    Mutations: poll faster; return the first pending for a confirm route; skip the `finally` release; poll past
    `unknownAt`; send progress without a token; remove one row's `expect` (parity must fail).

    **Done when.** An agent can learn about an approval on every surface without being told, within bounded resources,
    and all four rows run one operation.

11. **Core status and lists: the approval object, the envelope, and integrity stubs wherever a record is shown.**

    **Changes.**

    - **`approval-outcome.ts` `publicApproval`.** D8's fields by state.
      - **Untrusted fields.** Every path on a fixed `SENDER_CONTROLLED_FIELDS` list is wrapped with core
        `wrapUntrusted`: the expected recipients and subject, download names and listing names, and every preview and
        display name. This covers legacy and removed-owner records too.
      - **Hidden fields.** A challenge hash or claim token never appears.
      - **Wording for a used record.** It reads "accepted by <label> at <time>", with the label taken from
        `CHANNEL_SNAPSHOT` by the stored channel.
    - **`maintenance.ts` `listApprovals` (405-423).**
      - **What it lists.** v2 outcomes, legacy views (`legacy: true`), attribution-verified corrupt records with their
        safe fields, and unreadable or unverifiable stubs. Each carries `ownerRemoved` and its stored channel.
      - **Filtering.** `APPROVAL_STATES` (392-401) gains `corrupt`. A pinned filter omits stubs.
      - **Rendering.** The CLI renderer (`cli.ts:417-420`) prints state, `claimable` and the reason.
    - **Doctor.** `doctor` (73) counts unreadable records without printing their contents.
    - **Gmail.** `listApprovals` (`send.ts:747-760`) builds the same objects with `addressField`, `wrapField` and
      `filenameField`. A removed mailbox stays `(removed)`. `gmail_send_list` (`mcp/server.ts:2602`) omits stubs when
      pinned. `renderApprovals` is at `cli/render.ts:751`.

    **Tests first.** Add `packages/core/test/approval-surfaces.test.ts` and extend `core-server.test.ts`, core
    `cli.test.ts` and Gmail `tool-parity.test.ts`. Cover §5 R11e, R21a, R22c, R24d, R24f, R27e, R33c, D1rr-e, D2pt-e,
    D8i-a, D8i-c, D8i-d, D8o-c and D9e-a:

    - **Untrusted data.** Hostile subjects, addresses and file names stay inside the envelope on removed-owner and
      legacy records too.
    - **Corrupt records.**
      - An attribution-verified corrupt record is shown to its owner. An unverifiable one is an unpinned stub, and on
        a pinned server it gives `NOT_FOUND` across status, wait and lists.
      - Malformed timestamps and unknown versions are corrupt through direct get, the core list, the channel list,
        zero-wait status and a nonzero wait.
      - A pinned list omits stubs, and doctor counts them.
    - **Legacy records.** A legacy v1 record is shown as legacy in status and lists, while a v2 record with no binding
      is a stub. A released-shape v1 send with no `kind` is a send, and past its original expiry it is `expired` with
      no v2 timestamp.
    - **Derived states.**
      - After a failed sweep and `never → chat`, a stale-epoch record shows as `revoked` without being written, and
        the next claim persists it.
      - A removed-owner record appears on the unpinned list.
      - A cross-process list followed by a claim.
      - Zero-wait and the list show `sending` before the lease boundary and `unknown` at it.
    - **Agreement between surfaces.**
      - All four zero-wait pairs agree.
      - A directly inspected pending-expired record and an approved-then-expired record each say exactly "this
        approval expired; nothing was sent with it".

    Mutations: drop a field from the wrap list; put file bytes in a stub; omit corrupt records from the list; show a
    stub on a pinned list.

    **Done when.** Every record in the store is either visible with honest state or an explicit stub. None is skipped.
    Nothing a sender wrote escapes the envelope.

12. **Risky — Gmail's send gate: a fence before `sendDraft`, an honest unknown, and no invented id.** AGENTS.md: only
    `executeSend` calls `sendDraft`, and `test/send-path.test.mjs` stays as it is.

    **Changes.**

    - **The fence.** In `send.ts` `executeSend` (552-744), call `fence` after the ledger reservation (632) and the
      draft re-read (641-650), immediately before `transport.sendDraft` (654). On `stop`, the record completes
      `failed` with `lease-lost-before-send` and the call returns `APPROVAL_VOID` ("nothing was sent").
    - **An ambiguous failure** (662-688) returns `SEND_OUTCOME_UNKNOWN` with the `sending` approval object and the hint
      "check Sent before anything else; this approval is not used again; do not prepare automatically". Certain
      failures keep "nothing was sent".
    - **A missing id.**
      - `gmail-api/transport.ts` `sendDraft` (533-546) returns `id: string | undefined`, never `''`.
      - The result says "sent; the provider returned no id", and the record is left `sending`.
      - The audit records accepted-without-id and omits `messageIds`.
      - The `getMessageMetadata` read-back (705) is skipped.
    - **A failed bookkeeping write.** If `complete` fails after a successful send, the result is still a success; its
      note says the record will read as `unknown`.
    - **Schemas.** `SendResult.sentMessageId` becomes optional, along with the `gmail_draft_send` output schema
      (2350-2365) and `renderSent`.

    **Tests first.** Extend `send-gate.test.ts`, `send-outcome.test.ts`, `mcp-send.test.ts` and `transport.test.ts`.
    Cover §5 R10c, R11b, D1rr-f, D2pt-b, D2pt-f, D2pt-h, D8o-e and D8o-g:

    - A production-shaped fake `sendDraft` held across several heartbeat intervals keeps `sending`, then records
      success; and again, failure.
    - A claimant suspended after the claim and before `sendDraft`, while another caller persists `unknown`: no request
      reaches the fake, and the record shows `lease-lost-before-send`.
    - A claim across the hourly cap rollover.
    - An ambiguous response gives `SEND_OUTCOME_UNKNOWN` at once.
    - A certain failure says nothing was sent.
    - Success followed by a failed `used` write is still success, and later reads show `sending`, then `unknown`.
    - A missing id gets the exact no-id wording and never `used`. Spies show no `''` in the completion or the audit,
      and no read-back.

    Mutations: move the fence before the reservation; map the ambiguous case to `TRANSIENT`; turn a missing id into
    `''`; call the read-back with no id; add a second `sendDraft` call site (`test/send-path.test.mjs` must fail).

    **Done when.** Gmail starts its one send only under a live lease. Every uncertainty is `SEND_OUTCOME_UNKNOWN`, and
    no id is ever invented.

13. **Risky — Gmail's confirmation route: one decision, decline revokes, cancel waits, and refusals say where to go
    (D5 and D1's refusal rule).**

    **Changes.**

    - **`mcp/server.ts` `gmail_draft_send` (2339-2430).**
      - **An untrusted client** gets `APPROVAL_REQUIRED`: "this needs your approval outside the chat: run <terminal
        command> in a terminal, and I will wait with gmail_send_wait". The command comes from CUE-403's locator, and
        Task 23 proves it.
      - **Removed wording.** "known to reach a person" goes from the hint at 2390, and the refusal stops advertising
        the trust list.
      - **A form `decline`** calls `approvals.revoke(id, 'declined')` under the record lock and returns `APPROVAL_VOID`
        with "declined".
      - **A cancelled, dismissed or unanswered form** leaves the record as it is and returns `APPROVAL_PENDING`
        (2411-2418).
    - **The download form** (975-1010) splits the same way.
    - **Trust-list wording.** The `gmail_confirm_probe` and `gmail_confirm_client_add` descriptions describe clients
      "the person chose to trust".
    - **Terminal approval** (`cli/program.ts:1345-1356`) prints the standard `renderMessagePreview` once, as the
      approval. It still approves without sending.
    - **The next step.** `prepareSend`'s `nextStep` (`send.ts:449-454`) names the terminal command and the wait tool.
    - **Unchanged.** `requiresUserInteraction` stays policy-derived (214, 2366-2374).

    **Tests first.** Extend `mcp-send.test.ts`, Gmail `cli.test.ts` and `download-destination.test.ts`. Cover §5
    D1rr-c, D2-d, D2-f and D5-a–D5-c:

    - An explicit decline is atomically `revoked`/`declined` before claims at 11 and 29 minutes. Cancel and dismiss
      stay pending, and a confirm route is still pending at minute 29.
    - A confirm change never raises a form.
    - The untrusted refusal names the command and the wait tool, and no surface says "known to reach a person".
    - The terminal renders once. Its body and truncation match `renderMessagePreview`, approving sends nothing, and
      the agent's wait sees `{ approved, claimable: true }`.
    - Long hostile addresses, subjects, file names, thread text and URLs show truncation and escaping, not a
      full-content proof.

    Mutations: revoke on cancel; leave a decline pending; restore "known to reach a person"; render the preview twice.

    **Done when.** One prepare and one person's decision suffice. A decline is stored as one, and a cancellation
    leaves the approval to be used.

14. **Risky — Gmail recipient taint (D4): an exact address still escalates, an own-domain match alone does not, and
    the explanation is honest.**

    **Changes.**

    - **`packages/core/src/taint.ts` `check`.** `TaintCheck` (203-206) also returns each stored aggregate (newest
      time, strongest source, mailbox ids). Nothing new is stored.
    - **`send.ts` `studyRecipients` (240-309).** It uses `tainted = (seen.address || (seen.domain && external)) &&
      !written`, and its facts carry D4's three separate aggregate statements. A removed mailbox is "a mailbox no
      longer connected".
    - **`hasWrittenTo` (209-222).**
      - **The query.** `in:sent {to:X cc:X bcc:X}`, paginated to 50 hits, keeping the comma-split and regex-strip
        exact comparison.
      - **The budget.** One budget of 200 history requests per operation. Every `listMessages` and
        `getMessageMetadata` call consumes one unit before it starts. Recipients are checked in a deterministic order
        of canonical To, Cc and Bcc addresses.
      - **Results.** `historyCheck` is `written`, `not-written`, `budget-exhausted` or `provider-error`. Each preview
        qualification is worded as D4 gives it.
    - **`packages/gmail/src/domain/untrusted-fields.ts`.** Add `domainField`, wrapped when it fails the grammar, as
      `addressField` (61) is.
    - **`previewFor` (338-384)** shows the explanation as structured untrusted fields. It never puts the address into
      trusted prose.

    **Tests first.** Add `packages/gmail/test/recipient-taint.test.ts` and extend `send-gate.test.ts` and core
    `gate-support.test.ts`. Cover §5 D4-a–D4-e and D4p-a–D4p-d:

    - Each of these escalates as D4 says, an exact match wins the explanation, and a previous send suppresses each one:
      - an exact internal address seen in another mailbox, in a header and in a body;
      - an exact external address;
      - a domain-only internal match and a domain-only external match;
      - both an exact and a domain match.
    - Public-provider domains never match on domain alone.
    - Pagination finds hits 6 and 50 and stops at 50. A match that would be the 51st reads as not written.
    - A 500-recipient draft and mixed fixtures make at most 200 calls in total. Budget exhaustion and provider errors
      keep the escalation, with their qualification.
    - **Provenance.**
      - The same-mailbox exclusion still applies.
      - After `internalDomains` is widened, an exact address stays tainted until day 7.
      - An old header in mailbox A and a recent body in mailbox B are reported as separate aggregate facts.
      - Address and domain payloads that read like instructions are canonicalised or wrapped.
      - The removed-mailbox, precedence, public-domain, lookalike and attachment flags all hold.

    Mutations: drop `external` from the domain clause; stop at 5 hits; budget per recipient; treat a provider error as
    written; interpolate the address into trusted prose.

    **Done when.** Escalation follows D4's formula. Every doubt keeps the warning, and the explanation says only what
    the store holds.

15. **Risky — Gmail's shared history caches: one budget across prepare and terminal approval.**

    **Changes.**

    - **New `packages/gmail/src/operations/history-cache.ts`.** Two caches under `core.paths.stateDir`, each guarded
      by `withFileLock` and written with `writeFileAtomic` (`packages/core/src/fs.ts`):
      - **The address cache.** Keyed by mailbox id and canonical address. Each entry is a 10-minute
        `{ result, observedAt, expiresAt }`.
      - **The correspondent cache.** Keyed by mailbox id. Each entry holds the set of correspondent domains.
    - **Each locked mutation**, in order: drop entries that have expired (at or before now), apply the new
      observations, then evict the oldest by `(observedAt, key)` until 5,000 remain.
    - **A malformed or schema-invalid file** reads as empty.
      - The address cache answers `not-written` with `cache-malformed`.
      - The correspondent cache forces a fresh scan. If that scan fails, the result is `correspondentHistory:
        cache-malformed` and the escalation stays.
    - **A failed write** gives `cache-write-failed`. The failing operation never uses an observation it could not
      commit to suppress anything.
    - **Who uses it.** `studyRecipients` and `correspondentDomains` (181-200) read through the caches, so
      `beginApproval` (471-509) reuses what `prepareSend` observed.

    **Tests first.** Add `packages/gmail/test/history-cache.test.ts`, with child-process writers. Cover §5 D4-f–D4-k:

    - Prepare followed by terminal approval within 10 minutes makes at most 401 counted calls in total. A cached
      correspondent domain still triggers the lookalike escalation.
    - After expiry, the caps apply again.
    - Above 5,000 keys, each cache stays at its cap, and stale entries are removed first.
    - Malformed files never yield a cached `written` answer.
    - Concurrent writers keep disjoint entries and evict in a stable order, and no update is lost.
    - A write failure before or around the rename leaves the old file or the new one, never a partial file.

    Mutations: count cache hits against the budget; evict before expiring; trust a malformed file; use an uncommitted
    observation.

    **Done when.** Prepare and terminal approval of one unchanged draft share their history work, and corrupt state
    never quiets a warning.

16. **Risky — Slack posts, files and reactions: a fence before every step, the lease across long uploads, and honest
    outcomes.** Tests use only the loopback fake `packages/slack/test/support/fake-slack.ts`.

    **Changes.**

    - **`postPrepared` (`send.ts:696-777`).**
      - A fence runs before `chat.postMessage` (756).
      - An ambiguous outcome makes `recordMaybePosted` (831-881) return `SEND_OUTCOME_UNKNOWN`, not `TRANSIENT`
        (856).
      - A missing `ts` (771) means the post has no id: the result says "sent; the provider returned no id", the record
        stays `sending`, the audit omits the id, and there is no read-back.
    - **`postFiles` (1024-1137).**
      - A fence runs before each provider step: `files.getUploadURLExternal` (1056), each `slackFileUpload` (1066) and
        `files.completeUploadExternal` (1080).
      - One lease covers every step. A single upload may run 1,600 s, and a post may carry ten files.
      - A fence that says stop after earlier steps completes the record `failed`, with "nothing was posted" and the
        `uploaded` and `possiblyUploaded` disclosure (`reportFailure` 1144-1180).
      - An ambiguous completion is `SEND_OUTCOME_UNKNOWN`.
    - **`reactPrepared` (1420-…).**
      - A fence runs before `reactions.add` or `reactions.remove`.
      - `recordReactionUnknown` (1350-1386) returns `SEND_OUTCOME_UNKNOWN`.
      - The id that `recordReactionChanged` records must be non-empty.

    **Tests first.** Extend `send-files.test.ts`, `post-outcome.test.ts`, `reaction-outcome.test.ts` and
    `mcp-send.test.ts`. Cover §5 R11c, R12b, R12c, D1sl-c, D2pt-a, D2pt-c, D2pt-i, D8o-f and D8o-h:

    - **Long work.** A full file post against the loopback fake holds real provider work for more than five minutes.
      It sends heartbeats, stays `sending` through status and wait, and then, run once each way, records success and
      failure.
    - **Fences.**
      - A claimant suspended before its first step makes no request, and the record shows `lease-lost-before-send`.
      - One suspended right after a successful fence starts that one step and no later step.
      - The lease expiring between any two steps stops further steps, with the right wording.
    - **Failures.**
      - Injected failures before an upload, during one, after a known upload and at the share call each say "nothing
        was posted", with exact disclosure.
      - Ambiguous messages, file shares and reactions return `SEND_OUTCOME_UNKNOWN` at once.
      - Success followed by a failed `used` write later reads as `unknown`.
    - **Missing ids.** A missing `ts` gets the no-id wording. Spies show no `''` in the completion or the audit, and no
      read-back, for message, file and reaction ids.

    Mutations: drop the fence before one step; map ambiguous outcomes back to `TRANSIENT`; record `''` for a missing
    `ts`.

    **Done when.** Every Slack step starts only under a live lease, long uploads stay `sending`, and no outcome is
    guessed.

17. **Risky — Resend's send gate: a fence before the send, an uncertain outcome reported as unknown, and a scheduled
    acceptance without an id.** AGENTS.md: only `executeSend` reaches `emails.send`. `send-path.test.ts` still finds
    exactly one `spendOn(`, inside it. Tests use only `fake-resend.ts` with fake keys.

    **Changes.**

    - **The fence.** In `send.ts` `executeSend` (516-731), call `fence` after the throttle check and the claim,
      immediately before the existing `spendOn(…, 'emails.send', …)` (616-620). It goes inside `executeSend`, and adds
      no second `spendOn(`.
    - **An ambiguous outcome** (the not-sent test at 645-685) is `SEND_OUTCOME_UNKNOWN`, replacing `TRANSIENT` at 669.
    - **A response with no id** (621-626) stops being an error. The result says "sent; the provider returned no id",
      or with `scheduledAt`, "accepted (scheduled); the provider returned no id". The record stays `sending`, and the
      audit omits `resendIds`.
    - **The scheduled wording.** A scheduled result says "accepted by Resend, scheduled for <time>", using the
      request's `scheduledAt`.
    - **Schemas.** `SendResult.resendId` (70-83) becomes optional, along with the `resend_send_execute` schema (510)
      and the CLI renderer.

    **Tests first.** Extend Resend `send-gate.test.ts`, `send-outcome.test.ts`, `send-path.test.ts`, `mcp.test.ts`
    and `parity.test.ts`. Cover §5 R11d, R22b, R23e, D2pt-d, D2pt-g and D2pt-j:

    - A claimant suspended before the send makes no request, and the record shows `lease-lost-before-send`.
    - A scheduled acceptance without an id gets its exact CLI and MCP wording. The record stays `sending`, then reads
      `unknown`.
    - An ambiguous response is `SEND_OUTCOME_UNKNOWN` at once.
    - A certain failure says nothing was sent.
    - Success followed by a failed `used` write later reads as `unknown`.

    Mutations: map ambiguous outcomes back to `TRANSIENT`; throw on a missing id; fence after `spendOn`; add a second
    `spendOn(` (the send-path test must fail).

    **Done when.** Resend sends only under a live lease. An uncertain outcome is never retryable, and a scheduled
    acceptance is never called sent.

18. **Resend status and scheduled cancellation: Resend's own `last_event`, attributed, and a cancellation that stays a
    success.**

    **Changes.**

    - **New `packages/resend/src/operations/last-event.ts`.** D2's fixed mapping, as a table.
      - **Unknown values.** An unknown value says "accepted by Resend; its latest event is one this version does not
        interpret", and the raw value appears only in an untrusted-wrapped field.
      - **No current outcome.** Without a full-access key, or when the look-up fails: "current outcome unavailable".
    - **`sendStatus` (`send.ts:748-827`)** stays the send-record look-up and gains `outcome` from that table.
      - **When Resend is asked.** It asks Resend whenever a full-access key can (780-789).
      - **What never counts as sent.** The local `sent` event (694) or a passed scheduled time.
      - **Cancellation wording.** "cancelled from this machine before sending" appears only when `SendRecords`
        (`compose/store.ts:91`, `summary` at 164) holds the cancellation. Otherwise it is "Resend reports it
        cancelled".
      - **Attribution.** Every outcome is attributed to Resend's single `last_event`.
    - **`scheduled.ts` `cancelScheduledChange` apply (83-121).** After the provider confirms, the send-record append
      (104) and the audit append (111) run independently. A failure of either becomes a bookkeeping-gap hint on a
      successful result.
    - **Core's status** of a Resend `used` record says "accepted by Resend at <time>" (Task 11).

    **Tests first.** Add `packages/resend/test/send-status.test.ts` and extend `mcp.test.ts`. Cover §5 R22a,
    R23a–R23d, R24a–R24c, R25e and R32f:

    - **The mapping.**
      - Every `last_event` value from `scheduled` to `canceled`, plus an unknown future value (wrapped, and never read
        as sent).
      - A scheduled send before and after its time with `last_event: scheduled`: "scheduled, not yet sent".
      - "Sent" only once the event is `sent` or `delivered`.
    - **Keys and look-ups.** A sending-only key gives "accepted by Resend, scheduled for …" and "current outcome
      unavailable", also after the scheduled time. A failed look-up says the same.
    - **Mixed recipients.** One recipient delivered and one bounced, in either order, produce only attributed wording.
    - **Cancellation.**
      - A cancellation whose send-record append fails (alone, and with the audit append) still succeeds with the hint.
        A later status says "Resend reports it cancelled", never "elsewhere" or "from this machine".
      - With the record written, it says "cancelled from this machine before sending", and the approval record is
        unchanged.
      - A provider cancellation followed by both bookkeeping failures still succeeds.
    - **A removed account.** A v2 Resend record whose account is removed keeps Resend's wording.
    - **Core status** says "accepted by Resend".

    Mutations: word `delivered` as delivered to everyone; call it sent after the scheduled time; say "cancelled
    elsewhere"; fail the cancel on a record-append error.

    **Done when.** Resend's status says only what Resend reported, attributed to it, and a confirmed cancellation is
    never reported as a failure.

19. **Risky — Download questions: answered, claimable, and bound to what was shown.**

    **Changes.**

    - **`approvals.ts`.**
      - `claimForDownload` (1026-1066) uses the outcome's `claimable` matrix.
      - `downloadClaimRefusal` (204-222) decides by the stored `requiredPolicy` and the live change policy.
      - `answerDownload` keeps Task 2's `approvedDigest`.
    - **`save-destination.ts`.**
      - `settleDestination` (835-937) recomputes `approvedDigest` before writing (864), and refuses a corrupt record
        (tampered listing, offered folders or answer) before saving anything.
      - `answerDownloadAtTerminal` (1208-1290), `downloadQuestionForm` (1293-…) and `downloadAtTerminal` (1034) refuse
        a corrupt record before rendering it.
    - **The wording.**
      - `answered`, and `answered (in chat)` with no destination.
      - "expired before it was answered", and "was answered and expired before it was used", with no answer time.
    - **Tool refusals.** `gmail_attachment_download` (`gmail/mcp/server.ts:889`) and `slack_file_download`
      (`slack/mcp/server.ts:622`) name their wait tool.

    **Tests first.** Extend core `save-destination.test.ts` and `approvals.test.ts`, Gmail
    `download-destination.test.ts`, and Slack `download.test.ts` and `download-surfaces.test.ts`. Cover §5 R15a, R16b,
    R17b, R18a, R18b, R19b–R19d, R20a and R21b:

    - **Valid records stay valid.** A chat-policy download claimed straight from `pending` to `used` with no evidence
      stays valid through status and listing.
    - **Tampering is corrupt, and nothing is saved.**
      - The recorded answer or offered paths mutated after approval.
      - An injected stored answer on a pending or direct-chat question.
      - Every listing field, or a disagreement between names and listing, mutated before any rendering.
      - Listing tampering before a direct-chat claim and before a save.
      - A valid-value mutation of `policy` or `requiredPolicy`.
    - **Policy.** A confirm question stays confirm after the policy is loosened.
    - **Answered.** A direct-chat question reports "answered (in chat)".
    - **Expiry.** Answered, then deadline, then a restart: status, wait and list say "answered and expired before it
      was used", never "before it was answered".
    - **The claimable matrix**, including a live-policy change during a wait.

    Mutations: skip the `approvedDigest` re-check; persist the chat answer; report an answer time; mark a
    pending-confirm question claimable.

    **Done when.** A download saves only what the person was shown, where they said, once, and its status never
    invents a destination or an answer time.

## Phase D — draft send history (D9)

20. **Risky — Bounded daily retention: `ApprovalStore.ensurePruned()`.**

    **Changes.**

    - **`packages/core/src/lock.ts`.** Add `tryFileLock(path, fn, options)`, a single non-blocking attempt with the
      same stale-lock and token rules as `withFileLock` (157-232). It returns `{ acquired: false }` or the value. Give
      the callback the holder's token and `stillHeld()`, so the holder can check ownership.
    - **New `packages/core/src/approval-maintenance.ts`: `ensurePruned(store, { deadline })`.** It returns
      `{ attempted, processed, skippedBusy, complete, errors }`.
      - **The lock.** It holds the approvals maintenance lock with `staleMs: 30_000` and `renewMs: 10_000`.
      - **The prune-state file.** The schema is exactly D9's, validated field by field on the pattern of
        `update-state.ts:106-173`. It tolerates up to 5 minutes of future skew and normalises anything beyond that.
        The run is due after 24 hours, and it durably writes the attempt time before doing any record work.
      - **The pass.** One enumeration and stat pass; `.json` and `.claim` paired into one slot per approval id, ordered
        by `(mtime, id)`; 200 slots at most; a 5 s deadline. Each record lock is taken with `tryFileLock`, and the
        record is re-read and classified under it. A stale `sending` record becomes `unknown` first.
      - **What it deletes.** Finished records at `finishedAt + 90 days`, plus the legacy `updatedAt` fallback, used
        for retention only.
      - **The delete order.** First `AuditLog.append(approval.retained, { durable: true })` (`audit.ts:75-85`,
        `fs.ts:107-145`), then unlink `.claim` (`ENOENT` counts as success), then unlink `.json`. A stray `.claim` is
        removed when its slot comes round.
      - **The cursor.** D9's rules. The token is checked before every prune and before the cursor is written.
    - **The hook.** `create`, `createChange`, `createDownload`, list, and status and wait (`waitForApproval`) await
      the hook, each with its own 5 s deadline. A report passes its own shared deadline.
    - **The audit row.** `AuditRecord` (`audit.ts:11`) gains the `approval.retained` operation.

    **Tests first.** Add `packages/core/test/approval-retention.test.ts`, with a fake clock, an instrumented filesystem
    adapter and child processes that hold locks. Cover §5 R15b, D1sl-g, D9r-a–D9r-u and D9r-w:

    - **When maintenance runs.**
      - One long-lived context crosses several daily boundaries.
      - Each state directory starts at most one batch a day, even with concurrent callers and after reopening.
      - Missing, truncated and schema-invalid state files count as never attempted.
      - Malformed cursors restart from the oldest record.
      - Skew inside the tolerance is kept; skew beyond it, and backwards clocks, are normalised.
    - **How much one run does.**
      - It stops at exactly 200 slots, and later runs resume.
      - No new step starts after 5 s.
      - Two hundred contended locks are each tried once; busy records remain, and nothing starves.
    - **Lock ownership.**
      - Renewal beyond the stale interval prevents a steal.
      - A token replaced before a per-record check stops the stale holder.
      - A replacement after the final check produces only a rescan or a skip, never a wrong prune.
    - **Crashes.** Crashes after the attempt commit, and around the cursor commit, behave as D9 says.
    - **What is kept and what is deleted.**
      - Every finished state is kept until it reaches its boundary, and deleted at equality after a locked re-read.
      - Active records, corrupt stubs and unreadable files are never deleted.
      - The `usedAt` rules for sends, changes and downloads, and the legacy fallback (unsafe cases kept).
      - A direct-chat download stays valid through retention.
      - Maintenance never moves `unknown`.
    - **Deletion steps.**
      - The append, `.claim` and `.json` order holds, including the marker today's claim path creates.
      - Crashes before and after each of the three steps.
      - Append or fsync failure, claim-unlink failure, JSON-unlink failure, and a stray `.claim`.

    Mutations: unlink before the durable append; wait on a busy record; skip renewal; write the cursor without checking
    the token; prune a `pending` record.

    **Done when.** Retention is bounded, safe across crashes, and never destroys the only terminal history or evidence
    held under uncertainty.

21. **The unsent report in core: grouping declared by each channel, and evidence that says only what was read.**

    **Changes.**

    - **`packages/core/src/channel-manifest.ts`.** Add an optional `approvalGrouping: 'draft' | 'draft-revision-digest'`
      to `ChannelManifest` (44-112) and `channelManifestSchema` (170-213). A malformed value is refused.
    - **The manifests.** `"draft"` in `packages/gmail/package.json` and `packages/resend/package.json`;
      `"draft-revision-digest"` in `packages/slack/package.json`. Then `pnpm sync:channels` regenerates
      `channels.generated.ts`.
    - **New `packages/core/src/unsent-report.ts`.** `unsentReport(core, { channel, owner?, deadline })`:
      - **Maintenance first.** It awaits `ensurePruned` on the shared deadline.
      - **The scan.** It enumerates and sorts by mtime, newest first, with the id as tie-break. It opens at most 500
        records, each only after a successful `tryFileLock`.
      - **Classification.** Records go through the outcome or the legacy decoder, and are grouped by the stored
        channel's declared rule; v1 records use Task 3's attribution.
      - **Rows.** A row needs an expired newest record and a send approval from the last 7 days. Blockers and the
        indeterminate rules are applied exactly as D9 states.
      - **Results.** Evidence scope is `complete-90-days`, `last-500` or `indeterminate`, with D9's exact wording.
        Removed-owner records are reported as revoked. Each `truncated` reason is given. At most 20 rows, newest
        first, together with the maintenance status.

    **Tests first.** Add `packages/core/test/unsent-report.test.ts` and extend `channel-manifest.test.ts` and
    `test/channel-registry.test.mjs`. Cover §5 R10a, R10b, R12d, R13f, R14f, R14g, R15f, R15g, R16c, R16d, R17d, R22d,
    R24e, R24g, R27f, R32e, R32h, R32k, R33d, D9e-b–D9e-e, D9c-a–D9c-f, D9c-i–D9c-k and D9r-v:

    - **Wording and scope.**
      - More than 500 old records, rewritten just before the report: the wording names "the 500 most recently changed
        approval records".
      - A complete readable scan: "not sent with any approval in the last 90 days".
      - A capped scan: "not sent with any of the 500 most recently changed approval records".
      - A `used`, `sending` or `unknown` blocker at position 501.
    - **Grouping.**
      - Identical Slack content under `chat` and `confirm` routes groups as one, while each claim checks its own
        binding.
      - One Gmail draft with different content digests.
      - The committed manifest values, and a Slack reaction that produces no group.
      - A malformed `approvalGrouping` is refused, and a synthetic channel works without any core edit.
      - Removed-account Slack and Resend records still group by their own rule.
      - A v1 record that cannot be attributed takes part in no group.
    - **What makes evidence indeterminate.**
      - Every missing, malformed or mismatched digest combination for Gmail and Slack, a changed Slack revision, an
        edited `channel`, and a valid-value mutation of any attribution field make the whole report indeterminate.
      - A blocker's draft id moved from A to B yields no unsent wording for any group.
      - An unreadable file at each position inside the window makes every row indeterminate. Outside a capped window,
        it leaves the last-500 wording.
      - An attributable corrupt record affects only its own group.
      - Busy records, attributable and not, are each tried once. All 500 locks held elsewhere still finish within
        about 5 s.
    - **Blockers.** Approved records, with the `never` wording; `sending`, `used` and `unknown`; and old blockers
      inside retained history. Declines and cancellations are never relabelled as expiry.
    - **Other inputs.** Legacy v1 records with no `kind`, and past their expiry, are read through the decoder. A
      stale-epoch record shows as revoked. A removed-owner record is never "ready".
    - **Bounds.** With maintenance due, the operation counts stay within their maxima. With maintenance not due, one
      pass opens at most 500 records.
    - **Maintenance failure** is surfaced, and the report still returns its evidence-scoped results.

    Mutations: claim `complete-90-days` with a capped window; guess the owner of an unreadable file; wait on a busy
    lock; use `contentDigest` in Gmail grouping.

    **Done when.** Each draft-level claim is bounded by the records actually read, and every gap in them is called
    indeterminate.

22. **D9 on the surfaces: Gmail's send list, drafts and doctor, and Slack's draft annotation.**

    **Changes.**

    - **Gmail `listApprovals` (`send.ts:747`)** returns `{ approvals, unsent }` for `agent-gmail send list`
      (`cli/program.ts:1256`) and `gmail_send_list` (`mcp/server.ts:2602`); `renderApprovals` is at
      `cli/render.ts:751`. Each unsent row has:
      - recipients, subject and attachment names through `addressField`, `wrapField` and `filenameField`;
      - the last preparation and its expiry;
      - the evidence scope;
      - the live Drafts result, from `transport.getDraft` (`gmail-api/transport.ts:509-513`), a read and never a send.
        There are at most 20 look-ups, run 2 at a time, within the shared deadline;
      - and the single prepare call.
    - **The same wording elsewhere.** `getDraft` (`drafts.ts:683`) and `listDrafts` (503) use it. `doctor`
      (`doctor.ts:92`) reports the bounded 7-day count, as a lower bound or as indeterminate.
    - **Slack.** `listDrafts` (`slack/operations/drafts.ts:388`) annotates the current exact revision.
    - **Rows.** No capability row changes operation. The parity check confirms it.

    **Tests first.** Add `packages/gmail/test/unsent.test.ts` and extend Gmail `drafts.test.ts` and Slack
    `drafts-files.test.ts`. Cover §5 D8i-e, D9e-f–D9e-j, D9c-g and D9c-h:

    - **The live Drafts look-up.**
      - A live draft adds "still in Drafts".
      - A send from the Gmail web app and a deletion made elsewhere both say "no longer in Drafts — it may have been
        sent or deleted elsewhere".
      - A failed look-up stays local-only.
    - **No side effects.** Send list, draft show, draft list and doctor create, send and delete nothing.
    - **Slack revisions.** Revision A `used` plus revision B `expired` still reports B; the inverse reports A as used;
      identical digests at different revisions stay separate.
    - **Retention.** A pruned `used` revision R, with a newer expired approval, says only "not sent with any approval
      in the last 90 days".
    - **The deadline.** When maintenance spends the shared deadline, a step starts only while time remains. Omitted
      evidence is indeterminate, and an omitted look-up is "not observed".
    - **Bounds.** Only the newest 500 records are opened; there are at most 20 rows and 20 look-ups, at concurrency
      2 or less.
    - **Untrusted data.** Hostile fields stay enveloped in the D9 rows.

    Mutations: run 3 look-ups at once; call a missing draft "unsent"; start a look-up after the deadline.

    **Done when.** A person can see from the chat whether a draft went out, worded to the evidence, with the live
    Drafts state observed separately.

## Phase E — commands and parity

23. **Every printed approve command and wait hint is located and runnable (D7).**

    **Changes.** These must be on the rebased branch (see the precondition). Each refusal that sends a person to a
    terminal names the command from `locateCliCommand`, plus the matching wait tool and wait command:

    | Package | Refusal sites |
    |---|---|
    | Gmail | `executeSend` pending hint (`send.ts:608-609`), `prepareSend` next step (449-454), MCP send (2385-2395), download (996) |
    | Slack | `approveCommand` (`send.ts:574`), `waitingHint` (587) |
    | Resend | the `executeSend` pending hint, the status hint (528) |
    | Core changes | `claimForChange` (`approvals.ts:896`), `change-flow.ts` `approvalHint` |
    | Downloads | `DOWNLOAD_ANSWER_HINT` (398), `downloadClaimRefusal` (220), Gmail and Slack download refusals |

    The parity driver (`scripts/parity.mjs`, `scripts/operations.mjs`) needs no special case, because operations are
    stand-ins. Confirm this and record it in the review notes.

    **Tests first.** Extend `test/parity.test.mjs`, `test/tool-drift.test.mjs` and CUE-403's real-shell harness. Cover
    §5 D7-a–D7-c:

    - Every newly printed approve command and wait hint, through the Gmail, Resend and Slack refusal paths, runs under
      POSIX and under PowerShell (and cmd, where available).
    - Core change refusals name `agentcomms approve` together with `comms_approval_wait` and `agentcomms approval
      wait`.
    - Gmail and Slack download refusals name their channel's approve command and wait.
    - Each command parses, each tool exists, and each row reaches `waitForApproval`.

    Mutations: print a bare `agent-gmail approve`; omit the wait tool; name a tool that does not exist.

    **Done when.** Every handoff the person or agent is given runs as printed, on both platforms.

## Phase F — integration and release

24. **Prove it end to end: the frozen 0.13.0 release, the D2 matrix on every surface, and the ticket's acceptance.**

    **Changes.**

    - **Vendor the published unpacked tarballs**, `package.json` and `dist/` only:
      - `@agentcomms/core@0.13.0` into `packages/core/test/fixtures/released-0.13.0/core/`;
      - `@agentcomms/gmail@0.13.0` into `packages/gmail/test/fixtures/released-0.13.0/gmail/`.

      Each gets a `FROZEN.json` with npm's `dist.integrity` and tarball URL. For core that is
      `sha512-DkmpeDffTiwjfbqymDb6e00S9uEqL3jYFFjJm+Gwu0XP5u2AoyPpAwoFLR366/LbHofs/Gervl5QrBV76uoPYg==`; read Gmail's
      the same way. Runtime dependencies resolve from the package's own `node_modules`: core's `html-to-text` family
      and `zod`, and Gmail's `@clack/prompts`.
    - **Keep the vendored files out of checks.** Exclude them from Biome in `biome.json`, and from any
      `scripts/verify-skills.mjs` path rule that would flag bundled code. Add a test that fails if `FROZEN.json` or
      the version changes.
    - **Add `packages/core/test/released-0.13.0.test.ts`.** It opens the frozen `ApprovalStore` from the vendored
      core `dist`.
    - **Add `packages/gmail/test/released-0.13.0.test.ts`.** It runs the frozen `agent-gmail` CLI as a separate
      process against one temporary home and `fake-google.ts`. Fake Google's `slowNext()` holds the frozen
      `executeSend` after its config read and before its claim. A slow `drafts/send` holds it after its claim.
    - **Add `test/approval-matrix.test.mjs`.** It drives every D2 table row through every named surface.
    - **Add `packages/gmail/test/acceptance-cue-404.test.ts`.**
    - **Run the D3 client smoke matrix by hand** and record it in the review notes. It is informational, and no timing
      from it becomes a constant.
    - Run the full `pnpm verify`.

    **Tests first.** Cover §5 R28a, R29a–R29c, D1vt-b–D1vt-d, D2-a, D3-smoke and ACC-a–ACC-f:

    - **The frozen core module.**
      - It refuses a v2 record with the exact "prepared by a different version" wording.
      - The new module refuses a v1 record written by the frozen one.
      - The frozen module may persist `expired` on a v2 approved record after its pending deadline, and still never
        claims it.
    - **The frozen process after a 0.14 conversion.**
      - After a 0.14 `never` change converts the config, the frozen prepare, claim, approve and send-policy commands
        each refuse with "this release reads versions 1 and 2". The provider stand-in records no call. This holds
        for a v1 approval the frozen process prepared itself before the conversion, and after `never → chat`
        following a forced failed sweep.
    - **The drain against a frozen claim.**
      - The drain revokes under a frozen claim, and the claim is refused.
      - A forced failed revocation: the record is named, the drain stays pending, loosening is refused, and the
        revocation is retried.
      - A claim that already holds its lock completes, and the conversion lists it.
    - **The D2 matrix on every surface**, Slack files and reactions included.
    - **The ticket's acceptance**, end to end with fake Gmail:
      - an internal colleague from another mailbox, through an untrusted client;
      - approval at minute 25, with the claim two hours later;
      - a domain-only internal recipient sent on a chat yes;
      - the 22:42:46 / 22:48:22 replay;
      - the 24-hour "not sent with any approval in the last 90 days" with "still in Drafts";
      - an identical re-preparation not blocked by an expired record or a final `unknown` one.

    Mutations: make 0.14 write version 2; let the drain skip a record whose lock is busy; let the acceptance flow
    re-prepare. The frozen tests must fail.

    **Done when.** The old release fails closed against everything 0.14 writes. Every D2 row holds on every surface.
    The ticket's four-attempt story is one prepare and one decision. `pnpm verify` passes.

25. **Skills, docs, the changelog, and the 0.14.0 release.**

    **Changes.**

    - **Assertions first.** Add the documentation and skill assertions to `test/skill-contracts.test.mjs`,
      `test/skill-commands.test.mjs` and `test/install-docs.test.mjs` (decision 10), and watch them fail.
    - **Skills.** Update `skills/gmail-send/SKILL.md` (126-154 outcomes, 165-186 trust) and its
      `references/policies.md` and `references/troubleshooting.md`; `skills/slack-posting`, `skills/resend-sending`,
      `skills/gmail-attachments`, `skills/comms-onboarding` and `skills/comms-update`; and
      `skills/_shared/contract-{comms,gmail,slack,resend}.md`. The rules they carry:
      - call the revoke tool on a "no";
      - learn of an approval with repeated default-length waits;
      - never prepare again while a send is `sending`;
      - after `SEND_OUTCOME_UNKNOWN` or `unknown`, say a late result is still possible, check Sent or the channel,
        and never prepare automatically;
      - use the two no-id wordings exactly, and never "sent, message id …" without an id;
      - never call a scheduled Resend send sent unless Resend says delivered;
      - surface `corrupt`.

      Then run `pnpm sync:skills`.
    - **Docs.**
      - `docs/sending.md`: lifetimes, waits, `unknown`, D9 and §7's risks.
      - `docs/upgrading.md`: config version 3 locks out 0.13. Restart clients still running 0.13 servers, and prepare
        old pending approvals again.
      - `docs/troubleshooting.md`.
      - `SECURITY.md`'s "does not claim" list gains the accepted 24-hour approved bearer window (§7.1).
      - `pnpm sync:reference` regenerates `docs/reference/*`.
    - **Version.** Set root `package.json` to 0.14.0, then run `pnpm sync:versions` and `pnpm build && pnpm
      licenses`.
    - **Changelog.** Write `CHANGELOG.md` `## 0.14.0`. Lead with "approving a send no longer races the clock" (CUE-404),
      then the config-v3 lockout and the restart instruction. Follow the 0.13.0 entry's shape.
    - **Release.** Follow `.claude/skills/release/SKILL.md` steps 1–6. Pushing the tag is the irreversible step and
      needs the owner's explicit go-ahead in the conversation.
    - **Linear.** Move CUE-404 to Done with a comment naming `v0.14.0` and its release page.

    **Tests first.** Cover §5 R23f, D1rr-b, D2-i and D2pt-k:

    - The skill and contract text requires revoke on a "no".
    - It forbids preparing while `sending`.
    - After `unknown`, it requires the late-result caveat and checking Sent or the channel, and forbids an automatic
      prepare. Consumers branch on `SEND_OUTCOME_UNKNOWN`.
    - It carries the exact scheduled no-id wording.

    Mutations: restore "known to reach a person" in a skill; delete the revoke-on-no rule; restore a ten-minute claim
    in a doc. Each assertion must fail. Then run the full `pnpm verify` and record the result.

    **Done when.**

    - Skills, references, manifests and the changelog all say 0.14.0.
    - `git diff --check` and the full `pnpm verify` pass.
    - No test made a real provider call.
    - The `v0.14.0` tag's run reports every package published from the tagged commit.
    - CUE-404 is Done with the release named.

## §5 coverage ownership

Each row is owned by exactly one task. A compound spec bullet is split only where its parts land in different tasks,
so ownership can be audited. The labels follow the spec's order within each item:

- `R<round><letter>` is a numbered review round's case.
- D-section prefixes:
  - `D1rt` routes and time;
  - `D1rr` refusal races;
  - `D1vt` versions and timestamps;
  - `D1cc` content and concurrency;
  - `D1sl` sending lease;
  - `D2pt` provider truth;
  - `D3r` resources and cancellation;
  - `D4p` provenance and gaps;
  - `D8o` objects and privacy;
  - `D8i` integrity and untrusted data;
  - `D9e` evidence;
  - `D9c` capped, bounded, busy and unreadable evidence;
  - `D9r` retention;
  - `ACC` the end-to-end acceptance.

| §5 item | Case owned | Task |
|---|---|---:|
| R34a | Global default change-policy change, global installer/update change and prospective first connection, under chat and confirm: prepared, pending, claimable by route, approved, applied, never `ownerRemoved` | 9 |
| R34b | An `owner` change whose mailbox is then removed is `ownerRemoved` | 9 |
| R34c | Editing a stored `ownerScope` breaks `bindingDigest` | 1 |
| R34d | v1 record decoded with `ownerScope` from its shape (`''` → global, else owner) | 3 |
| R33a | Pending/approved/used v2 Gmail, Slack and Resend records with a removed owner classify with `ownerRemoved` (revoked, revoked, used kept); no default policy or epoch applied | 5 |
| R33b | Core status, and a wait that returns at once, show the removed-owner outcome | 10 |
| R33c | The unpinned list shows it | 11 |
| R33d | D9 shows it as revoked, never ready | 21 |
| R33e | A server pinned to that owner returns the identical `NOT_FOUND` | 10 |
| R33f | First locked action persists `revoked`; re-adding a same-named owner makes nothing claimable | 5 |
| R32a | Crash after v3 write with one failed revocation, restart: set survives, retried, loosening refused until closed | 4 |
| R32b | v1 record written by a paused 0.13 prepare after the scan joins on the next rescan | 4 |
| R32c | Drain stays open until the v1 pending lifetime has passed, even with every tracked record finished | 4 |
| R32d | Historical used/failed v1 records are never tracked | 4 |
| R32e | Removed-account v2 Slack draft and Resend send records still group by their channel's rule | 21 |
| R32f | ...and the Resend one keeps Resend's status wording | 18 |
| R32g | Editing a stored `channel` makes an unpinned stub elsewhere | 3 |
| R32h | ...and makes the whole D9 report indeterminate | 21 |
| R32i | A v2 record naming a channel the snapshot does not know is refused at creation | 1 |
| R32j | v1 `ibx_` → Gmail; `acc_` → platform while the account exists; unattributable after removal | 3 |
| R32k | An unattributable v1 record takes part in no grouping | 21 |
| R29a | Frozen 0.13 `executeSend`/terminal approval held after config read: drain revokes, frozen op refused, no transition, no provider call | 24 |
| R29b | Same with revocation forced to fail: named, drain pending, `never → chat` refused, retried, then loosening allowed | 24 |
| R29c | A 0.13 claim already holding the lock completes and is listed | 24 |
| R29d | `legacyDrain` clears when every tracked record reached a final-for-drain state; v3 with no v1 records never sets it | 4 |
| R29e | Historical used/failed v1 records are not tracked and never set it | 4 |
| R29f | Tracked records finished by an admitted 0.13 sender as used, failed, sending or unknown clear and are listed (one case each) | 4 |
| R28a | After a 0.14 `never` conversion, frozen prepare/claim/approve/send-policy commands refuse with "this release reads versions 1 and 2"; no provider call; own v1 approval; after `never → chat` with a failed sweep | 24 |
| R28b | Conversion before a 0.14 send prepare, claim or approval on a v2 config, same locked write, idempotent | 4 |
| R28c | v3 never rewritten as v2; unknown keys survive | 4 |
| R27a | Claim read epoch N, `never` commits N+1 before `sending` is written: claim proceeds and is listed as already being sent | 8 |
| R27b | `never` commits before the claim takes its lock: claim revokes, no provider call | 8 |
| R27c | Both orders for terminal and trusted-form approval; neither writes `approved` in the second | 8 |
| R27d | Lock-order test: neither operation holds the other's lock | 8 |
| R27e | After a failed sweep and `never → chat`, zero-wait, wait and lists show the stale-epoch record as revoked without writing; next claim persists | 11 |
| R27f | ...and D9 shows it the same way | 21 |
| R27g | A default send-policy change to `never` raises the epoch of every inheriting owner and no other | 4 |
| R26a | Failed sweep, then `never → chat` and `never → confirm`: claim, execute and approval revoke on the stale epoch | 8 |
| R26b | Prepare that read chat at N and wrote after a completed `never` (N+1) and its sweep, then loosening: claim revokes | 8 |
| R26c | A default-policy change turning an owner's policy to `never` increments that owner's epoch only | 4 |
| R26d | Loosening leaves every epoch as it is | 4 |
| R26e | The epoch is in `identity`: editing it breaks `bindingDigest` | 1 |
| R25a | Pending and approved sends through `chat → never → chat` and `confirm → never → confirm`: revoked, unusable after loosening | 8 |
| R25b | A reported revocation failure: the next claim or approval revokes and returns `POLICY_NEVER` | 8 |
| R25c | Terminal and trusted-form approval under `never` revoke and never write `approved` | 8 |
| R25d | `requiredPolicy: never` under a live `chat` revokes at claim | 8 |
| R25e | Resend mixed-recipient fixtures (delivered + bounced, both orders) get attributed wording only | 18 |
| R25f | v1 decoder fixtures before and after the original expiry for pending and approved | 3 |
| R24a | Table-driven Resend status over every `last_event` value plus an unknown one, wrapped and never sent | 18 |
| R24b | Scheduled send before and after its time with `last_event: scheduled` stays "scheduled, not yet sent" | 18 |
| R24c | Cancellation whose send-record append fails (alone and with audit) succeeds with a hint; later "Resend reports it cancelled"; with the record, "cancelled from this machine" | 18 |
| R24d | A released-shape v1 send with no `kind` is shown as a send on status, wait and every list | 11 |
| R24e | ...and in D9 | 21 |
| R24f | A v1 record stored pending/approved past its original expiry is `expired` on status, wait and lists with no v2 timestamp | 11 |
| R24g | ...and in D9 | 21 |
| R24h | Every claim, execute and approve of a v1 record is refused by the version gate | 1 |
| R23a | Scheduled Resend send with a sending-only key: "accepted … scheduled for", "current outcome unavailable", never sent, also after its time | 18 |
| R23b | Full-access key: `scheduled`, `delivered`, `canceled` through the mapping (canceled source-neutral) | 18 |
| R23c | Provider look-up failure: "current outcome unavailable" | 18 |
| R23d | Provider cancellation followed by send-record and audit failures: success with a bookkeeping-gap hint | 18 |
| R23e | Exact CLI and MCP wording for a scheduled acceptance without an id | 17 |
| R23f | ...and the exact skill wording | 25 |
| R23g | One scan mixing valid v1 records (legacy, derived state, never corrupt, no missing-binding rule) with v2 | 3 |
| R22a | Resend scheduled send: core says "accepted by Resend"; Resend status scheduled / cancelled from this machine / sent only on `sent` or `delivered` | 18 |
| R22b | Scheduled acceptance without an id: exact wording, record `sending` then `unknown` | 17 |
| R22c | v1 without binding shown as legacy in status and lists; v2 missing it is an unpinned stub | 11 |
| R22d | ...and D9 reads the v1 record through the legacy decoder | 21 |
| R21a | Attribution-verified corrupt shown to its owner versus unverifiable stub and pinned `NOT_FOUND`, across status, wait, lists | 11 |
| R21b | Download `claimable` matrix, including a live-policy change mid-wait | 19 |
| R20a | Distinct answer, deadline and observation times, restart: "answered and expired before it was used", no answer time | 19 |
| R20b | Golden vectors for absent, empty and populated listings | 1 |
| R20c | Round trips for the same: no `listing` key and no name comparison when absent | 3 |
| R19a | Golden canonical-JSON and SHA-256 vectors for the download object with and without optional listing members | 1 |
| R19b | Listing tampering before a direct-chat claim and before a save → corrupt, nothing saved | 19 |
| R19c | Confirm question stays confirm after loosening; valid-value mutation of `policy`/`requiredPolicy` → corrupt | 19 |
| R19d | Terminal/form answer → deadline → "answered … expired before it was used", never "before it was answered" | 19 |
| R18a | Direct-chat `pending → used` download reports "answered (in chat)" with no destination | 19 |
| R18b | Mutating every listing field and a names/listing disagreement → corrupt before any rendering | 19 |
| R18c | `offered` with both paths through creation, canonical JSON and SHA-256 vectors | 1 |
| R18d | Change and download `contentDigest` recomputed on status reads | 3 |
| R17a | File name A with stored id B (B existing and not) → corrupt; nothing touches B | 3 |
| R17b | Pending or direct-chat download with an injected stored answer → corrupt, nothing saved | 19 |
| R17c | Golden `offered` vectors for both folder choices | 1 |
| R17d | Committed manifest values (Gmail/Resend `draft`, Slack `draft-revision-digest`); a Slack reaction makes no group | 21 |
| R16a | Mutating each identity field → corrupt before approval, claim, provider access or reporting | 9 |
| R16b | Mutating a confirm download's answer or offered paths after approval → no file, corrupt | 19 |
| R16c | One Gmail draft prepared with different digests: approved/sending/used/unknown on either blocks expired wording | 21 |
| R16d | A malformed `approvalGrouping` is refused by the manifest schema | 21 |
| R15a | A chat-policy download claimed `pending → used` with no evidence stays valid through status and listing | 19 |
| R15b | ...and through retention | 20 |
| R15c | Create-path v2 round trips for every subtype prove the exact identity hashed | 1 |
| R15d | Golden vectors for the download profile, `offered` and every kind | 1 |
| R15e | Removed-account provider-free classification of Slack post, file, reaction and Resend records | 5 |
| R15f | A synthetic channel declares `approvalGrouping` with no core edit | 21 |
| R15g | Any binding mismatch makes the whole report indeterminate across drafts and accounts | 21 |
| R14a | The per-kind evidence table, every row valid and invalid | 2 |
| R14b | Valid confirm downloads in approved and used without `approvedAt` | 2 |
| R14c | Approved-then-revoked keeps evidence; direct-chat failed/unknown carry none | 2 |
| R14d | Golden vectors for every kind, including Slack reactions | 1 |
| R14e | Provider-free Slack round trip from the stored `inboxId` | 5 |
| R14f | Valid-value mutation of every attribution field → whole-report indeterminate | 21 |
| R14g | A used blocker's draft id moved A → B gives no unsent wording for any group | 21 |
| R13a | Every kind × route × `approvedVia` × state, valid and invalid | 2 |
| R13b | Approved-lineage descendants with missing/malformed/contradictory evidence → corrupt | 2 |
| R13c | Direct-chat sending and used with no evidence stay valid | 2 |
| R13d | `approvedVia: chat` → corrupt | 2 |
| R13e | Slack revision changed to another valid value, digests unchanged → binding mismatch → corrupt | 3 |
| R13f | ...and the whole D9 report is indeterminate | 21 |
| R12a | Approved send, change and download with bad evidence → corrupt | 2 |
| R12b | A claimant suspended right after a successful fence starts that one step and no later step | 16 |
| R12c | Lease expiry between each Slack step stops further steps with the right wording | 16 |
| R12d | D9 with Gmail and Slack records in every digest combination → whole report indeterminate | 21 |
| R11a | Missing/malformed/non-canonical/mismatched → corrupt; send `contentDigest` structure-only on provider-free reads | 3 |
| R11b | Gmail claimant suspended before its first provider mutation: no request, `lease-lost-before-send` | 12 |
| R11c | Slack: the same | 16 |
| R11d | Resend: the same | 17 |
| R11e | Hostile subjects, addresses and file names through core list, status and wait, incl. removed and legacy, stay enveloped | 11 |
| R10a | More than 500 old records rewritten before a report displace a used blocker: wording names the 500 most recently changed | 21 |
| R10b | Identical Slack content and revision under chat and confirm group as one; each claim checks its own binding | 21 |
| R10c | Production-shaped fake Gmail `sendDraft` held across heartbeats: success, and again failure | 12 |
| D1rt-a | Chat-route records expire at 10 minutes, confirm-route (incl. escalated) at 30; equality is expired | 6 |
| D1rt-b | Route is stored and digest-bound | 1 |
| D1rt-c | Confirm route never directly claims after loosening; chat route claims only while chat and waits when tightened | 6 |
| D1rt-d | Approved sends/changes survive the pending deadline and expire 24 hours after approval | 6 |
| D1rt-e | Approval at `approvedAt == expiresAt` refused as expired; stored approved fixtures require `<` | 6 |
| D1rt-f | Downloads expire 30 minutes from creation before or after answer, never `usableUntil` | 6 |
| D1rr-a | A conversational "no" never received, claims at 11 and 29 minutes: expired on a chat route | 6 |
| D1rr-b | A skill evaluation requires the agent to call revoke on "no" | 25 |
| D1rr-c | Explicit form decline revoked before claims at 11 or 29 minutes; cancel/dismiss pending; confirm route pending at 29 | 13 |
| D1rr-d | Revoke versus claim in two processes: one locked winner | 5 |
| D1rr-e | A cross-process list followed by a claim | 11 |
| D1rr-f | A claim across the hourly cap rollover | 12 |
| D1rr-g | Pending chat change claims | 6 |
| D1vt-a | The real create path writes a v2 fixture | 1 |
| D1vt-b | Frozen `@agentcomms/core@0.13.0` (integrity recorded) refuses a v2 record with "prepared by a different version" | 24 |
| D1vt-c | v1 written by the frozen module is refused by the new one | 24 |
| D1vt-d | A v2 approved record given to 0.13.0 after its pending deadline may be persisted `expired`, never claimed | 24 |
| D1vt-e | Absent/unknown versions, non-finite times, wrong lifetime, bad `approvedAt`, inconsistent `usableUntil` → corrupt | 2 |
| D1vt-f | An active record observed before `createdAt` or `approvedAt` expires fail-closed | 6 |
| D1vt-g | Every state-specific timestamp missing/non-finite/misordered/misplaced/contradictory | 2 |
| D1vt-h | Used send `usedAt == sentAt`; change and download `usedAt` orderings | 2 |
| D1vt-i | Pending and approved deadline expiry persist the exact boundary as `expiredAt` | 6 |
| D1vt-j | Rollbacks before `createdAt` and `approvedAt`: observation time, `clock-anomaly`, prose, exemption, stays expired after restart | 6 |
| D1vt-k | `sendingHeartbeatAt` absent before claim, optional after, finite and ordered | 2 |
| D1vt-l | `unknownAt` is exactly heartbeat-or-sending + 2 min, not stored; equality takes the later state | 7 |
| D1vt-m | Persisted expiry or `unknown`, then rollback and restart, stays final; rollback after used/failed changes nothing | 7 |
| D1cc-a | Two simultaneous claims after the former 10-minute boundary of a confirm route: one winner | 6 |
| D1cc-b | Changed draft, expected recipients/account or drifted plan voids at claim | 5 |
| D1cc-c | Old-server calls stopped by the update gate and its pending-or-approved exception end closed on the digest version | 9 |
| D1sl-a | The claim creates one private random token; nothing public or audited shows it | 7 |
| D1sl-b | The claimant writes `sendingHeartbeatAt` under the lock every 30 s, each write token-checked | 7 |
| D1sl-c | A full Slack file post against the loopback fake beyond five minutes: heartbeats, `sending` through status/wait, success and failure | 16 |
| D1sl-d | Heartbeat suspended over 2 minutes: status persists `unknown`; the original token then records used or failed | 7 |
| D1sl-e | Missing/stale/different token cannot heartbeat or complete; approve, revoke and claim cannot move `unknown` | 7 |
| D1sl-f | Status and wait cannot move `unknown` | 10 |
| D1sl-g | Maintenance cannot move `unknown` | 20 |
| D1sl-h | A resumed heartbeat cannot move `unknown` back to `sending` | 7 |
| D1sl-i | Late success clears the stale-lease reason; late failure replaces it | 7 |
| D1sl-j | Heartbeat-write failure and process suspension take the same lease-expiry path | 7 |
| D2-a | Every D2 table row on every named surface, Slack files and reactions included | 24 |
| D2-b | Ownership before routing; byte-identical `NOT_FOUND` with `approval: null`; spy proves no foreign record classified or rendered | 9 |
| D2-c | Prepare-time `POLICY_NEVER`, invalid recipients, unsendable HTML and other pre-creation failures carry no approval object | 9 |
| D2-d | Confirm changes never form-elicit | 13 |
| D2-e | Wrong codes one/two stay pending; three revokes with `APPROVAL_VOID` | 5 |
| D2-f | Decline revokes; cancel/dismiss does not | 13 |
| D2-g | `APPROVAL_REQUIRED` never describes approved, expired, used, failed, sending, unknown, corrupt or revoked | 5 |
| D2-h | JSON/CLI consumers branch on `SEND_OUTCOME_UNKNOWN`, exit 10, non-retryable | 7 |
| D2-i | Skill consumers branch on it and never prepare automatically | 25 |
| D2-j | Another caller seeing fresh `sending` gets retryable `APPROVAL_PENDING` "being sent by another call since …; wait for it" | 7 |
| D2-k | An approved send whose live policy becomes `never` is not claimable and its claim returns `POLICY_NEVER`; same check for approved changes where it applies | 8 |
| D2pt-a | Slack failure before, during and after upload and at share: "nothing was posted" with exact disclosure | 16 |
| D2pt-b | Gmail ambiguous response → immediate `SEND_OUTCOME_UNKNOWN` with `approval.state: sending` | 12 |
| D2pt-c | Slack messages, file shares and reactions: the same | 16 |
| D2pt-d | Resend: the same | 17 |
| D2pt-e | Zero-wait and list show `sending` before the lease boundary and `unknown` at equality | 11 |
| D2pt-f | Gmail certain failures say nothing was sent | 12 |
| D2pt-g | Resend certain failures say nothing was sent | 17 |
| D2pt-h | Gmail provider success then a failed `used` write: outward success, later `sending` then `unknown` | 12 |
| D2pt-i | Slack: the same | 16 |
| D2pt-j | Resend: the same | 17 |
| D2pt-k | Skill evaluations forbid preparing while `sending`; after `unknown`, late-result caveat, check first, no automatic prepare | 25 |
| D3-a | Every result shape; `waitSeconds: 0`; default 30, maximum 300 | 10 |
| D3-b | No poll past a pending/approved deadline or a sending record's heartbeat-derived `unknownAt` | 10 |
| D3-c | Immediate `{ pending, claimable: true }` for a chat-route pending record | 10 |
| D3-d | Download `answered`/`expired` without `usableUntil` | 10 |
| D3-e | Timeout returns pending or sending with the same id and current actionability | 10 |
| D3-f | A nonzero pending-confirm wait performs later polls | 10 |
| D3-g | A wait that first sees `sending` continues to used, failed and stale `unknown`, with no prepare-again guidance | 10 |
| D3-h | Stops on claimable, policy-blocked approved, terminal or expired, cancellation and timeout | 10 |
| D3-i | Only valid derived expiry or stale-send finalisation change bytes; concurrent heartbeats may advance | 10 |
| D3-j | A terminal approval ends the wait as `{ approved, claimable: true }` without another write | 10 |
| D3-k | State change versus timeout or cancellation is decided by the final locked read | 10 |
| D3r-a | The ninth simultaneous wait in a process is refused | 10 |
| D3r-b | Success, timeout, cancellation, thrown error and MCP disconnect each free the slot (eighth replacement) | 10 |
| D3r-c | Cancellation leaves the record untouched apart from valid derived writes; disconnect expects no delivery | 10 |
| D3r-d | Progress every 15 s only with a progress token | 10 |
| D3r-e | At most one approval-file read per second; no provider call, zero-wait included | 10 |
| D3r-f | Foreign and pinned ids are not found | 10 |
| D3r-g | Every CLI/MCP pair passes parity against `waitForApproval` | 10 |
| D3-smoke | Client smoke matrix (manual, informational): main conversation, subagent, IDE, noninteractive, background threshold | 24 |
| D4-a | Exact internal (other mailbox, header and body), exact external, domain-only internal/external, both: exact wins; written-before suppresses; public domains never match | 14 |
| D4-b | `hasWrittenTo` finds hits 6 and 50 across pages, stops at 50, rejects fuzzy hits, uses To/Cc/Bcc terms | 14 |
| D4-c | 50 fuzzy false hits with the exact match at 51 → not written | 14 |
| D4-d | 500-recipient and mixed fixtures: at most 200 total history calls; `budget-exhausted` keeps escalation with the qualification | 14 |
| D4-e | Search/list and metadata failures → `provider-error`, escalation kept, qualification shown | 14 |
| D4-f | Prepare then terminal approval within 10 minutes reuse both caches: at most 401 counted calls; cached domain still escalates a lookalike | 15 |
| D4-g | After either cache expires, each operation obeys its own cap | 15 |
| D4-h | More than 5,000 keys: each cache stays at its cap; expired entries removed physically before eviction | 15 |
| D4-i | Malformed or schema-invalid cache files read as empty; conservative answers; failed recovery keeps escalation | 15 |
| D4-j | Concurrent child-process writers: disjoint entries kept, stable eviction, no lost update | 15 |
| D4-k | Atomic-write failures leave old or new, never partial; `cache-write-failed` never suppresses | 15 |
| D4p-a | Same-mailbox internal omitted; another mailbox can record it; widening `internalDomains` leaves the exact address until day 7 | 14 |
| D4p-b | Old header in A plus recent body in B described only as separate aggregate facts | 14 |
| D4p-c | Instruction-like address/domain payloads canonicalised or wrapped; mailbox ids, date, template trusted | 14 |
| D4p-d | Removed mailbox, exact/domain precedence, public-domain, lookalike and attachment flags | 14 |
| D5-a | Untrusted refusal names the terminal command and wait tool, no trust-list advertisement, never "known to reach a person" | 13 |
| D5-b | Terminal renders the standard preview once, matching `renderMessagePreview`; approval does not send; wait sees approved | 13 |
| D5-c | Long hostile addresses, subjects, file names, thread text and URLs show truncation and escaping | 13 |
| D7-a | Every newly printed approve command and wait hint executed through Gmail, Resend and Slack refusals, POSIX and Windows | 23 |
| D7-b | Core change and Gmail/Slack download refusals on both platforms name the right command and wait | 23 |
| D7-c | Each named command parses, each tool exists, each row reaches the same operation | 23 |
| D8o-a | Every send-path success/refusal carries the state object or the specified null | 9 |
| D8o-b | "Expired after approval" when `approvedAt` exists; `approved` and `claimable` separate; downloads use their own fields | 9 |
| D8o-c | All four zero-wait CLI/MCP pairs agree | 11 |
| D8o-d | Nonexistent/foreign ids and pre-creation failures, as in D2, carry no object | 9 |
| D8o-e | Gmail success with a missing id says exactly "sent; the provider returned no id", never `used`, later `unknown` | 12 |
| D8o-f | Slack success with a missing `ts`: the same | 16 |
| D8o-g | Spies: missing Gmail ids never write `""` to completion or audit and never trigger a read-back | 12 |
| D8o-h | Spies: missing Slack message, file and reaction ids, the same | 16 |
| D8i-a | Malformed timestamps and unknown versions are corrupt through direct get, core list, channel list, zero-wait and nonzero wait | 11 |
| D8i-b | Invalid JSON, every truncation boundary, missing ownership/kind, wrong-shaped values | 3 |
| D8i-c | Unpinned lists/status/waits show only the stub; pinned lists omit it, pinned status/wait `NOT_FOUND`; doctor counts | 11 |
| D8i-d | Hostile fields stay enveloped in D8 list objects | 11 |
| D8i-e | ...and in D9 list objects | 22 |
| D9e-a | Directly inspected pending-expired and approved-then-expired records say exactly "this approval expired; nothing was sent with it" | 11 |
| D9e-b | Complete readable uncontended scan: "not sent with any approval in the last 90 days", `complete-90-days` | 21 |
| D9e-c | Any matching approved record blocks; approved plus newer expired; live `never` wording | 21 |
| D9e-d | Sending, used, unknown and attributable corrupt block; decline/cancel/revoke/corrupt never relabelled expiry | 21 |
| D9e-e | A used record older than the 7-day window but retained still blocks | 21 |
| D9e-f | Live draft "still in Drafts"; external send and deletion → "no longer in Drafts — it may have been sent or deleted elsewhere" | 22 |
| D9e-g | A provider look-up failure stays local-only | 22 |
| D9e-h | Send list, draft show/list and doctor create, send and delete nothing | 22 |
| D9e-i | Slack revision A used + B expired reports B; the inverse reports A used; identical digests at different revisions separate | 22 |
| D9e-j | A used Slack revision pruned at 90 days, then a newer expired approval: only the 90-day wording | 22 |
| D9c-a | A same-key used, sending and unknown record placed at file 501 in turn: every row has the last-500 wording | 21 |
| D9c-b | An unreadable file at each position inside the window: every row "indeterminate (an approval record could not be read)" | 21 |
| D9c-c | An unreadable file outside a capped window keeps the last-500 wording | 21 |
| D9c-d | An attributable parseable-corrupt record makes only its group indeterminate | 21 |
| D9c-e | One non-blocking try per lock; attributable busy → its key; unattributable busy → all "indeterminate (an approval record was busy)" | 21 |
| D9c-f | All 500 locks held by other processes: tried once, about 5 s, none opened, only indeterminate evidence | 21 |
| D9c-g | Fake clock spends the deadline in maintenance: later steps start only while time remains; omitted evidence indeterminate; omitted look-up not observed | 22 |
| D9c-h | Newest 500 opened, filtered after opening, grouped once, newest first, at most 20 rows and 20 look-ups at concurrency 2 or less, scopes and cut reasons | 22 |
| D9c-i | Existing v1 records found through the read-only decoder with no index or migration, unclaimable, evidence-scoped | 21 |
| D9c-j | Maintenance due: the instrumented filesystem enforces every stated maximum across prune plus report | 21 |
| D9c-k | Maintenance not due: one pass and the 500-open bound | 21 |
| D9r-a | One long-lived context and store across several daily boundaries; creation, list, report and status trigger maintenance | 20 |
| D9r-b | At most one batch per state directory per 24 hours, with concurrent callers | 20 |
| D9r-c | Missing, truncated and schema-invalid prune-state act as never attempted and are replaced even when the batch fails | 20 |
| D9r-d | A valid timestamp with each malformed cursor restarts from the oldest record | 20 |
| D9r-e | Future skew inside 5 minutes kept; beyond it, and a backwards clock, normalised to now | 20 |
| D9r-f | More than 200 slots: stops at 200, `complete: false`, later runs resume, a full pass clears the cursor | 20 |
| D9r-g | Fake clock during work: no new step after 5 s; cursor reflects only completed progress | 20 |
| D9r-h | All 200 record locks contended: each tried once; creation and status return in about 5 s; the earliest busy is next | 20 |
| D9r-i | Old active and corrupt records do not starve later slots | 20 |
| D9r-j | A holder beyond the 30 s stale interval keeps its lock by renewal; only it prunes and commits the cursor | 20 |
| D9r-k | A token replaced before a per-record check stops the stale holder starting another record | 20 |
| D9r-l | A token replaced after the final check: stale cursor overwrite causes only a rescan or a skip; no unlocked prune; the end reset recovers | 20 |
| D9r-m | Crash after the attempt-timestamp commit: no retry until 24 hours, old cursor kept | 20 |
| D9r-n | Crashes before and after the cursor commit; truncated cursor write follows schema-invalid recovery | 20 |
| D9r-o | Finished states kept before 90 days and deleted at equality after a locked re-read; active never; stale sending becomes `unknown` first | 20 |
| D9r-p | Safe corrupt stubs and unreadable files are retained | 20 |
| D9r-q | `usedAt` boundaries for sends (`== sentAt`), changes and downloads | 20 |
| D9r-r | Legacy used record without `usedAt`: safe `updatedAt` fallback for retention only; unsafe fallback retained | 20 |
| D9r-s | Exact order durable append → `.claim` unlink → `.json` unlink, including the current claim marker | 20 |
| D9r-t | Crashes before and after each of the three steps | 20 |
| D9r-u | Append/fsync failure, claim-unlink failure, JSON-unlink failure, stray `.claim` without its `.json` | 20 |
| D9r-v | A maintenance failure is surfaced while the report still returns evidence-scoped results | 21 |
| D9r-w | Repeated operations, including reopening, start no second batch within the interval | 20 |
| ACC-a | Internal colleague recorded in another mailbox, untrusted client: one prepare, one terminal rendering, one decision; wait sees approved; execute returns `sentMessageId` | 24 |
| ACC-b | Approval at minute 25, claim two hours later | 24 |
| ACC-c | Internal domain-only recipient does not taint; a chat route sends on yes inside 10 minutes | 24 |
| ACC-d | Replay of the ticket's 22:42:46 prepare and 22:48:22 approval: wait learns it, send succeeds, nothing asks again | 24 |
| ACC-e | No claim, complete scan: "not sent with any approval in the last 90 days" after 24 hours, "still in Drafts" after the live look-up | 24 |
| ACC-f | Identical content prepared again gets the full preview and is not blocked by an expired or prior `unknown` record | 24 |
