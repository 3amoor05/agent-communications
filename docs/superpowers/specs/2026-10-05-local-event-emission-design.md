# Local event emission — design

Status: **revised after round 13; five owner questions open (§8)**. Specification only, not an implementation.
Written from the cited research pass (§2) and a checked read of this repository at `90463e1`.
This design adds a new **standing disclosure authorisation**; it does not treat recurring event delivery
as the existing per-content send gate
(`docs/superpowers/specs/2026-09-25-cli-mcp-parity-design.md:18-19`). CLI–MCP parity still holds, with explicit
human-only exceptions for secrets and approval, and `"agentcomms"` still means a channel.

## 1. What was asked

The owner asked whether this local installation can **emit events** about what happens in the accounts it already
reads, and for a design of everything that takes:

- **A small desktop app** — Tauri, React, built on the CUE++ design system (`@cueplusplus/ui`) — in which the person
  defines, for each rule: a **source** (Slack, Gmail, …), an **event**, and **conditions**.
- **Conditions of two kinds:** *deterministic*, and *agentic* — a question in words, put to a model together with the
  event's information, whose answer decides whether the event matches. Models named: TypeSafe's **Jev**, and
  **"Leia"** — "could we pack Leia into this build, optionally?"
- **A target:** a webhook, a channel such as a Socket.IO server, or a hosted event queue — "maybe you need to
  investigate this".
- **Mapping:** every event fully typed, and the output shaped by taking **values as they are from any path** in the
  source event — a JSON builder, with transformers deliberately left for later.
- **Full control:** the person can enable and disable all of it from the app.
- **Structure:** this may mean the repository becomes a monorepo of separately published apps, with "very complex and
  clear separations of principles".

## 2. What is true, and was checked

### In this repository (at `90463e1`)

| Fact | Source |
|---|---|
| There is no event daemon or source scheduler. Existing long-lived work is bounded: a lock-renewal interval, sign-in polling, detached OAuth listeners and a detached update-check child. | `packages/core/src/lock.ts:219-229`; `packages/gmail/src/operations/signin.ts:330-349,653-695`; `packages/core/src/update-check.ts:329-358` |
| Gmail's transport has no `history.list` or `watch`; `getProfile` returns `historyId`. Its request guard refuses `/batch` and unpermitted `/send`, and a read-only history request would not match either refusal. The base design made push/watch a 0.1 non-goal and put `history.list` watch on the roadmap. | `packages/gmail/src/gmail-api/transport.ts:25-82,185-235,334-341`; `docs/superpowers/specs/2026-09-18-agent-communications-design.md:56-64,1154-1160` |
| Slack uses a closed method table; `conversations.history` and `conversations.replies` are allowed reads, while `apps.connections.open` is explicitly refused. Generated manifests disable Socket Mode. Calls obtain a live user token through `openWorkspace`; refresh is single-use-aware and serialised by an in-process map plus a file lock. History reads are inclusive and 429s expose `Retry-After`. | `packages/slack/src/api/methods.ts:116-228`; `packages/slack/src/manifest.ts:135-150`; `packages/slack/src/operations/session.ts:131-145`; `packages/slack/src/auth/refresh.ts:172-184,210-273`; `packages/slack/src/operations/read.ts:135-151`; `packages/slack/src/api/call.ts:431-442` |
| Resend deliberately refuses `/events` and `/webhooks`. `last_event` is exposed by the on-demand, cursor-paginated sent-email read; nothing polls it today. A sending-only key returns unavailable without making a read request. All processes and accounts share the one-request-per-500-ms throttle. Its current `readBody` cap uses JavaScript `content.length` and `slice(0, 20000)`, hence UTF-16 code units rather than JSON Schema characters. | `packages/resend/src/api/routes.ts:17-20,142-159`; `packages/resend/src/operations/read.ts:59-84,184-245`; `packages/resend/src/api/throttle.ts:6-29`; `packages/resend/src/compose/inbound.ts:104-112` |
| WhatsApp `sync` snapshots the store, checks it and fully rebuilds the index by atomic replacement. Message rows expose both `Z_PK` and nullable `ZSTANZAID`; the current read identity is the numeric `Z_PK`. A source file operation waits at most 12 seconds for the macOS privacy prompt. | `packages/whatsapp/src/operations/sync.ts:45-113`; `packages/whatsapp/src/index-db.ts:117-139,162-167,203-222,242-277`; `packages/whatsapp/src/source/read-source.ts:120-165`; `packages/whatsapp/src/source/snapshot.ts:85-99,120-125` |
| Core's envelope uses `node:crypto`; Gmail and Resend-received reads flush taint before returning. Slack, WhatsApp and Resend-sent reads have no corresponding taint collector, although core already supports scoped handles. | `packages/core/src/untrusted.ts:1-3,99-120`; `packages/gmail/src/operations/read.ts:300-315,339-361`; `packages/resend/src/operations/read.ts:335-357,371-399`; `packages/core/src/taint.ts:95-120,401-429` |
| Per-inbox runtime state accepts only `ibx_` ids, so it cannot hold cursors for the generic `acc_` accounts. | `packages/core/src/state.ts:20-29` |
| Audit records and provider contexts currently type their surface as only `'cli' | 'mcp'`. | `packages/core/src/audit.ts:20-35`; `packages/gmail/src/context.ts:28-42` |
| `ConfigStore.load()` detects each atomic config replacement through an `(inode, mtime, size)` cache key, reparses on identity change and returns a clone. That is the live account registry the daemon can repeatedly load; it must not keep a second account cache. | `packages/core/src/config.ts:845-870` |
| Core's approval-kind union is currently `send | change | download`, its approval-channel union is `elicitation | terminal`, and the flat record is send-shaped. Refusal selection and kind-mismatch messages enumerate those three kinds; an unknown kind currently falls through as a send. A trusted-client form is explicitly not terminal approval for a terminal-required change. Core's taint-source union is currently only the location `header | body`, and that location controls cap priority. | `packages/core/src/approvals.ts:43-54,302-335,446-450,622-640,899-903`; `packages/core/src/taint.ts:141-155,285-304` |
| Preserving unknown outer keys in `taint.json` cannot preserve a new field inside an entry: the existing `touch` reconstructs an address/domain/handle entry as only `{ at, source, inboxIds }`. Core already uses a separate `handles.json` specifically because a previously installed writer never opens that file and therefore cannot erase it. | `packages/core/src/taint.ts:189-197,307-313` |
| Core secret migration discovers references only from config clients, inboxes, accounts, the approval key and pending revocations. It has no event-database discovery path today. | `packages/core/src/operations/secrets-migrate.ts:30-39,54-63` |
| Core keychain entries use service `agent-communications` and a 12-hex namespace derived from the resolved config directory; file secrets are one owner-only file per hashed reference. A separate events namespace and events-local file directory can reuse those mechanics without sharing core's backend selector or migration. | `packages/core/src/secrets.ts:36-53,175-188,251-254`; `packages/core/src/config.ts:697-730` |
| `classifyChange` already judges mailbox/account send and change policies, internal domains, account mode, risk escalation, update checks, send caps, attachment roots and denies, downloads, elicitation clients and secret-store downgrades. It does not know events configuration yet. | `packages/core/src/config.ts:1375-1483,1487-1548` |
| The channel manifest is a strict object, so an unknown `events` key is refused; its `hosts` field is expressly declared but not enforced. | `packages/core/src/channel-manifest.ts:43-112,170-224` |
| The tooling registry currently discovers only packages with channel manifests: `readChannels` starts at `scripts/channels.mjs:35`, and `loadRegistry` derives publication, surfaces and drivers from that channel set at `scripts/channels.mjs:129`. The parity test then requires every published package to be a discovered surface or wrapper. A non-channel library or service therefore needs an explicit declaration and registry path rather than a release-only special case. | `scripts/channels.mjs:35-59,129-178`; `test/parity.test.mjs:99-113`; `docs/superpowers/specs/2026-09-26-channel-plugins-design.md:110-125` |
| WhatsApp already uses `node:sqlite`, and its package requires Node 22.16 or newer. Core itself requires Node 22.12 and its untrusted envelope imports `node:crypto`, so neither is an isomorphic dependency for a browser-safe package. | `packages/whatsapp/src/index-db.ts:1-18`; `packages/whatsapp/package.json:1-10`; `packages/core/package.json:1-10`; `packages/core/src/untrusted.ts:1-3` |
| Credentials in model context are already a security-policy violation, and terminal-only approval is already an explicit parity exception. | `SECURITY.md:28-33`; `capabilities.json:241-254,566-571` |
| Core approval records are kind-separated, compare-and-swap under a per-record lock and single-use through an `O_EXCL` claim marker; the present kind union is `send | change | download`. This design extends that machinery rather than treating an ordinary change approval as disclosure authority. | `packages/core/src/approvals.ts:20-54,801-813` |
| Core already provides lowercase SHA-256 and recursively key-sorted canonical JSON; the event and disclosure identities below reuse those exact primitives. | `packages/core/src/digest.ts:99-100,117-127` |

### Outside it (checked 2026-10-05; first-party or primary sources)

| Fact | Source |
|---|---|
| Gmail `history.list` is cursor-paginated, history IDs are non-contiguous, an expired cursor normally returns 404, and the final `historyId` is stored only when no `nextPageToken` remains. Specific change lists can duplicate the generic `messages` list. Its request filter is one singular `labelId: string`, not a set of labels. A `History` record has specific `messagesAdded`, `labelsAdded` and `labelsRemoved` arrays; the latter two carry the label ids changed by that record. The list method explicitly warns that messages in a history response will typically have only `id` and `threadId`, so `messagesAdded[].message.labelIds` is neither a dependable label source nor a documented historical label snapshot. `getProfile` returns the mailbox's current `historyId`. | [Gmail `users.history.list`](https://developers.google.com/workspace/gmail/api/reference/rest/v1/users.history/list), [Gmail `History` resource](https://developers.google.com/workspace/gmail/api/reference/rest/v1/users.history#History), [Gmail `Message` resource](https://developers.google.com/workspace/gmail/api/reference/rest/v1/users.messages#Message), [Gmail `users.getProfile`](https://developers.google.com/workspace/gmail/api/reference/rest/v1/users/getProfile) |
| Slack has separate cursor-paginated history and replies methods; callers must follow `next_cursor`, not infer completion from page size. Its rate-limit notice establishes a conservative regime of one call per minute and 15 results for affected new non-Marketplace apps. | [`conversations.history`](https://docs.slack.dev/reference/methods/conversations.history/), [`conversations.replies`](https://docs.slack.dev/reference/methods/conversations.replies/), [Slack rate-limit notice](https://docs.slack.dev/changelog/2025/05/29/rate-limit-changes-for-non-marketplace-apps/) |
| Resend's received and sent lists are cursor-paginated, and the sent list exposes only the current `last_event`. | [Resend received list](https://resend.com/docs/api-reference/emails/list-received-emails), [Resend sent list](https://resend.com/docs/api-reference/emails/list-emails) |
| CloudEvents 1.0 requires `id`, `source`, `specversion` and `type`; extension values use the CloudEvents scalar type system. Its JSON event format uses `application/cloudevents+json`, and the HTTP binding identifies that media type as structured content mode. Standard Webhooks signs `id.timestamp.payload`, serialises symmetric secrets with `whsec_`, serialises a signature as `v1,<base64>`, and supports overlapping signatures for rotation. | [CloudEvents 1.0.2](https://github.com/cloudevents/spec/blob/v1.0.2/cloudevents/spec.md), [CloudEvents JSON format](https://github.com/cloudevents/spec/blob/v1.0.2/cloudevents/formats/json-format.md), [CloudEvents HTTP binding](https://github.com/cloudevents/spec/blob/v1.0.2/cloudevents/bindings/http-protocol-binding.md), [Standard Webhooks specification](https://github.com/standard-webhooks/standard-webhooks/blob/main/spec/standard-webhooks.md) |
| JSON Pointer has no wildcard; tokens escape `~` as `~0` and `/` as `~1`. Native `EventSource` accepts a URL and `withCredentials`, not an arbitrary Authorization header. | [RFC 6901](https://www.rfc-editor.org/rfc/rfc6901), [HTML Standard: server-sent events](https://html.spec.whatwg.org/multipage/server-sent-events.html) |
| JSON Schema 2020-12 defines `maxLength` in JSON characters (Unicode code points), while ECMAScript string indexing, `length` and `slice` operate over UTF-16 code units; a non-BMP code point therefore occupies two ECMAScript string elements and a code-unit slice can split its surrogate pair. | [JSON Schema validation §6.3.1](https://json-schema.org/draft/2020-12/json-schema-validation#section-6.3.1), [ECMAScript 2024 string type](https://tc39.es/ecma262/2024/multipage/ecmascript-data-types-and-values.html#sec-ecmascript-language-types-string-type), [ECMAScript `String.prototype.slice`](https://tc39.es/ecma262/2024/multipage/text-processing.html#sec-string.prototype.slice) |
| TypeSafe documents Jev through its hosted System One API, Noul as a 0–1 yes/no probability, and current model limits, but the reviewed published artefacts and terms provide no local weights or self-hosting contract. Ollama also returns a 0–1 probability for Noul. | [TypeSafe quick start](https://docs.typesafe.ai/introduction/quickstart), [TypeSafe models](https://docs.typesafe.ai/models), [Ollama decisions](https://docs.ollama.com/capabilities/decision) |
| The documented near-name is Laya, from a different publisher. Its published usage is a Transformers-style decision head and it offers an ONNX Runtime extra. | [Laya model page](https://huggingface.co/convaiinnovations/laya) |
| Tauri capabilities grant permissions to named windows/webviews, and overlapping capabilities merge their authority. Registered custom commands are available to all windows/webviews unless the application declares them with `AppManifest::commands`; a React route is not a capability boundary. | [Tauri capabilities](https://v2.tauri.app/security/capabilities/) |
| Tauri's CSP protection is enabled only when `security.csp` is configured; the generated configuration shows `csp: null`. Its documented IPC origins are `ipc:` and `http://ipc.localhost`. Tauri normally keeps compile-time asset CSP modification on (`dangerousDisableAssetCspModification: false`) and adds hashes/nonces for bundled assets. | [Tauri CSP](https://v2.tauri.app/security/csp/), [Tauri security configuration](https://v2.tauri.app/reference/config/#securityconfig) |
| Frontend calls to Rust commands serialise arguments and return values across Tauri IPC. Secret entry and reveal-once therefore necessarily cross IPC when the app uses a frontend secret window; the enforceable boundary is which labelled window has that command capability and where those bytes may subsequently appear. | [Tauri commands](https://v2.tauri.app/develop/calling-rust/) |
| A fetch carrying `Authorization` needs CORS permission for that non-wildcard header; a preflight response names its allowed methods and headers, and exact-origin, credential-omitting responses need no `Access-Control-Allow-Credentials`. | [Fetch Standard: CORS protocol](https://fetch.spec.whatwg.org/#http-new-header-syntax) |
| Unicode publishes versioned CaseFolding data and a versioned UTS #46 IDNA algorithm; pinning both to 15.1 prevents the browser and Node evaluators from inheriting different host Unicode behaviour. | [Unicode 15.1 components](https://www.unicode.org/versions/components-15.1.0.html), [UTS #46 revision 31](https://www.unicode.org/reports/tr46/tr46-31.html) |
| Apple's PPPC deployment page documents managed-policy identity by bundle ID or file path plus a designated code requirement. It does not establish how an interactive TCC grant behaves for this daemon; that remains a phase-D hypothesis to test. | [Apple Platform Deployment](https://support.apple.com/en-gb/guide/deployment/dep38df53c2a/web) |
| AES-GCM recommends 96-bit IVs. For randomly generated IVs, NIST caps all authenticated-encryption invocations under one key at 2^32; this design applies that limit separately to each derived table subkey and rotates before reaching it. | [NIST SP 800-38D, §§5.2.1.1 and 8.3](https://nvlpubs.nist.gov/nistpubs/Legacy/SP/nistspecialpublication800-38d.pdf) |
| IANA's IPv4 and IPv6 special-purpose registries identify whether a range is globally reachable; `169.254.0.0/16` and `fe80::/10` are Link Local, while `fc00::/7` is Unique-Local. AWS documents EC2 metadata at `169.254.169.254` and `fd00:ec2::254`. | [IANA IPv4 registry](https://www.iana.org/assignments/iana-ipv4-special-registry), [IANA IPv6 registry](https://www.iana.org/assignments/iana-ipv6-special-registry), [AWS EC2 instance metadata](https://docs.aws.amazon.com/AWSEC2/latest/UserGuide/instancedata-data-retrieval.html) |
| Slack describes the Events API used by Socket Mode as best effort, with acknowledgement retries rather than a replay cursor. QStash deduplication IDs last ten minutes. EventBridge `PutEvents` can return HTTP 200 while individual entries fail, and callers must inspect every result entry. | [Slack Socket Mode](https://docs.slack.dev/apis/events-api/using-socket-mode/), [Slack Events API](https://docs.slack.dev/apis/events-api/), [QStash publish API](https://upstash.com/docs/qstash/api-reference/messages/publish-a-message), [EventBridge `PutEvents`](https://docs.aws.amazon.com/eventbridge/latest/userguide/eb-putevents.html) |

## 3. Decisions

### D1. What is being built: three things, each with one job

1. **Sources** live in the channel packages, beside the code that already reads each provider. A source turns "what
   changed since this cursor" into a typed, normalised event. Nothing outside a channel package talks to its provider,
   so Gmail's request guard, Slack's closed method table and `openWorkspace`, and Resend's route table and throttle
   remain the provider boundaries (`packages/gmail/src/gmail-api/transport.ts:185-235`;
   `packages/slack/src/api/methods.ts:116-228`; `packages/slack/src/operations/session.ts:131-145`;
   `packages/resend/src/api/routes.ts:41-159`; `packages/resend/src/api/throttle.ts:6-29`).
2. **`@agentcomms/events`** is an isomorphic, side-effect-free library with no `node:` imports: the event catalogue
   (Zod schemas per type and version, generated JSON Schema), pointer-pattern grammar, deterministic conditions,
   mapping templates and their evaluators, and wire-format types. The daemon, CLI, MCP server and app validate and
   preview with it. Sanitising, enveloping, signing, encryption and every other I/O operation remain in the daemon.
3. **`@agentcomms/events-daemon`** owns the only event database and the only provider sessions. It polls sources,
   evaluates rules, calls judges, holds ingest and outboxes, delivers, and serves a versioned authenticated control
   protocol. Its package carries the `agent-events` CLI and MCP server; except for `agent-events run`, both are
   clients of the running daemon and call the same operations through that protocol (D10, D12).

And a fourth, which only presents: the **desktop app** (D13), a control surface over the daemon rather than another
implementation of rules or delivery.

### D2. Standing disclosure authorisation, immutable versions, and human-only secrets

A rule that automatically forwards future messages is not the existing send gate. The send gate approves exact
content; event emission approves a bounded class of future, unseen content. This design names that new authority a
**standing disclosure authorisation**.

**Approval rule.** Enabling or loosening a rule, activating the judge budget, or enabling all collection always needs
approval outside the chat, regardless of `changePolicy`: either `agent-events approve <id>` at the human terminal,
or the desktop app's typed-challenge flow (D13). Creating or editing a target, subscriber or judge creates an inert
immutable version; it has no standalone activation or approval path. It gains disclosure authority only when an
approved rule activation names that exact version. Phase B1 adds a fourth core approval kind, `disclosure`; the
present core union has only `send | change | download` (`packages/core/src/approvals.ts:43-54`). A disclosure record
can be approved only through the trusted terminal or app control surface and can be claimed only from `approved`,
never directly from `pending`. `chat` and MCP may prepare and explain one, but can never approve or claim it. This is
deliberately stricter than an ordinary change because it authorises later disclosures the person has not seen.
Loopback SSE subscribers and **every** hosted or local judge input are within the standing authority.

Core stores approvals as a discriminated union rather than adding disclosure fields to the current flat,
send-shaped record (`packages/core/src/approvals.ts:302-335`). The disclosure member has the common approval id,
digest-version, challenge/state and timestamp fields, `kind: "disclosure"`, and exactly this binding:

```ts
interface DisclosureBinding {
  digest: string;
  activationIntentId: string;
  activationKind: 'rule' | 'judge-budget' | 'enable-all';
  versions: readonly {
    kind: 'rule' | 'target' | 'subscriber' | 'judge' | 'judge-budget';
    id: string;
    version: number;
  }[];
}
```

`versions` is sorted by `(kind, id, version)` and is derived from one of the three canonical activation documents
below; it cannot be supplied independently. It is non-empty for a rule or budget activation. An `enable-all`
document may have an empty rule-version list only when there are no active rule pointers, in which case enabling has
no source set and performs no provider baseline. The record has no `inboxId`, `inboxSub`, `draftId`,
`draftMessageId`, send/change policy, risk flags, recipient expectations, send outcome, `change` or `download`
fields. Its top-level approved digest, when present, must equal `binding.digest`.
Its common timestamp member `usedAt` is absent before claim and required exactly in state `used`; it is written once
by core's claim transition and never changed by a later read or recovery.
Strict parsing also checks that `activationKind`, document kind and derived version-list shape agree, so no rule
approval can be claimed as a budget or enable-all activation.

The store exposes three kind-specific methods. `createDisclosure(binding)` validates that canonical shape and creates
only `pending`; `approveDisclosure(id, liveBinding, challenge, via)` rechecks the complete binding and moves only
`pending → approved`; and `claimForDisclosure(id, liveBinding)` rechecks it again, accepts only `approved`, creates
the existing `O_EXCL` claim marker and moves it directly to `used`. That transition atomically stores an immutable
core `usedAt`, and the successful claim returns that exact value with the record. Recovery reads `usedAt` from the
core record; no daemon path may infer it from `updatedAt` or sample a replacement time. Any binding drift voids the
record. `via` is only
`terminal | app`: `approvedVia` gains `app`, meaning the desktop app's typed challenge submitted through D13's Rust
layer, **not** an MCP elicitation or other client form. Existing terminal approval semantics do not change. This
distinction is required because core currently says a trusted-client form is not terminal approval and refuses one
for a terminal-required change (`packages/core/src/approvals.ts:899-903`).

Disclosure gets its own `refuseDisclosure` wording and hint. `refusalFor`, cancelled-claim handling, state errors and
`requireKind` become exhaustive switches over all four kinds; none may use an unknown-kind-as-send default. The
current dispatcher and mismatch paths enumerate only the older kinds
(`packages/core/src/approvals.ts:446-450,622-640`). Claims never mutate a record of the wrong kind. Lifecycle tests
cover create, terminal/app challenge approval, claim, expiry, revoke, drift, crash recovery and concurrent single use,
plus every ordered cross-kind claim pair among `send`, `change`, `download` and `disclosure`.

**Three canonical activation documents.** The daemon creates immutable pending versions and one deterministic
preview. A disclosure digest is lowercase SHA-256 over core's recursively key-sorted canonical JSON
(`packages/core/src/digest.ts:99-100,117-127`) of exactly one version-1 document:

```ts
type ActivationDocumentV1 =
  | { documentVersion: 1; kind: 'rule'; rule: CanonicalFullRuleDocument }
  | { documentVersion: 1; kind: 'judge-budget'; budget: CanonicalJudgeBudgetDocument }
  | {
      documentVersion: 1;
      kind: 'enable-all';
      switchGeneration: number;
      ruleVersions: readonly { ruleId: string; ruleVersion: number }[];
    };
```

The three kinds have these exact version lists and effects:

1. A **rule activation** derives `versions` from the rule version plus every target, subscriber and judge version
   embedded in `rule`; it atomically replaces only that rule id's active pointer. The referenced object versions are
   authorised for that rule and no other. The new rule version permanently records this authorisation lineage, while
   the pointer's `currentCutoverId` selects this activation's point rows. It creates no global target, subscriber or
   judge pointer.
2. A **judge-budget activation** has exactly one `judge-budget` entry for the singleton version and atomically
   replaces only the singleton budget pointer. Its canonical budget document contains the singleton id/version and
   the complete daemon-wide and per-provider calls-per-rolling-hour, input-tokens-per-rolling-30-days and concurrency
   ceilings—no rule fields or defaults are implicit.
3. An **enable-all activation** has exactly the sorted, duplicate-free `rule` entries named by `ruleVersions`. Its
   final transaction requires the switch still to be disabled at `switchGeneration`, requires the active rule
   pointer set to equal that list, and makes exactly those pointers effective by setting `event_settings.enabled` to
   true. It replaces every listed pointer's `currentCutoverId` with the fresh enable-all point set and never mutates
   the rule versions' authorisation lineage. From the instant its approval is `used` until the intent is completed, failed or cancelled, D12's mutation
   fence refuses every rule-pointer mutation except `disable-all`. The switch is mutable state with a generation
   fence, not a versioned object and never a `versions` kind.

The canonical full rule document embeds the referenced immutable documents rather than hashing only their ids, and
contains all of:

- the rule id and version; source channel; event type and type version; and a canonical source consisting of a
  non-empty, sorted set of explicit stable account ids plus the channel-specific source options in D4. The UI
  presents account names, but ids are authoritative. Version 1 offers no “all accounts”, “all current accounts” or
  “all present and future accounts” selector: connecting another account cannot add it to an existing rule;
- the complete deterministic-condition AST and agentic condition, including operator options, literal operands,
  threshold and uncertainty policy; and the complete mapping AST, including every object/array position, constant
  value, source pointer and `reject | omit | null` missing policy, with `omit` permitted only for object properties;
  and the optional exact `cloudEventType` override whose D6 validation and wire value are part of the approval;
- the complete ordered target set and each target version: kind and id; for dry-run, its at-most-24-hour retention;
  for a webhook, D7's canonical plain URL or secret-URL descriptor, non-empty sorted canonical
  `approvedAddressSet`, signing mode, delivery ordering and retry limit; and for SSE, the subscriber id/version, exact
  allowed Origins and stream identity. Every kind embeds its untrusted representation.
  Every target preview also states that D6/D7's fixed installation-reset notice is delivered before ids under a new
  installation identity; it contains only reset metadata, no account or sender content, and cannot be disabled
  independently while an active rule references that target version. Secret
  bytes and secret generations are deliberately absent;
- each judge id/version, provider, model, full endpoint, prompt-template version, exact input pointers, output
  interpretation, maximum input/output tokens and the rule's own call/token/concurrency limits. Daemon-wide and
  per-provider ceilings live only in D5's separately approved singleton budget version, never in a rule. The rule
  fields are explicitly calls per rolling hour, input tokens per rolling 30 days and concurrency; and
- the delivery rate cap (default 60 deliveries per rolling hour) and **every** retention value: ingest content,
  hold, delivery, dry-run, SSE replay, dead-letter payload and decision metadata. The defaults are respectively 24
  hours, 24 hours, 24 hours, 24 hours, 24 hours, seven days and 30 days; dry-run is capped at 24 hours and SSE at
  seven days. Raising any cap or retention is a loosening. Saving refuses `hold retention > ingest retention`, so a
  hold can never extend the life of that rule version's own encrypted projection.

Golden digest vectors cover all three document kinds. Rule vectors change one field at a time, including an account
id, a newly connected but unselected account, each source option, an ordinary URL path, a secret-URL fingerprint,
mapping constant, missing policy, referenced object version and each per-rule judge limit. Budget vectors change
each daemon/provider ceiling and the singleton version. Enable-all vectors change the switch generation, add,
remove or reorder a rule-version id, and prove canonical sorting makes only reorder a no-op. Cross-kind vectors prove
the same nested JSON under another `kind` has another digest. Every active or superseded rule version is authorised
in exactly one of two mechanically checked ways: an activation whose disclosure approval names that exact version, or a
`derived_authorizations` row whose parent chain ends at such an exact activation and whose every edge is one of the
whitelisted tightenings below. Every active authorisation and every superseded authorisation with retained work, its
activation kind, full version list, digest, approval time, exact-or-derived status, complete parent lineage,
immutable authorisation-activation id, the active pointer's mutable current cut-over id where applicable, every
per-account/scope activation point, retention deadlines and remaining rate-cap window
appears in `agent-events doctor` and the app. Nothing is enabled by install, update or import.

**Version and activation rule.** Rules, targets, subscribers and judges are immutable versioned rows in the events
database. A decision and every delivery bind `(ruleId, ruleVersion, targetId, targetVersion[, subscriberId,
subscriberVersion][, judgeId, judgeVersion])`. Delivery uses exactly those versions and never follows a mutable id to
a different endpoint. Editing a target, subscriber or judge creates a new inert version. An existing active rule
continues to use its embedded old version; it uses the new version only after a new version of that rule references
it and that rule activation is approved. There is no command, tool or app action that approves an object version by
itself.

Activation crosses the daemon's SQLite database and the core approval store by one recoverable protocol, not by a
claimed cross-store transaction:

1. During prepare and under the daemon's activation lock, re-plan the exact activation document and verify its
   digest. A SQLite transaction inserts a unique pending activation intent with its kind, canonical document, digest,
   derived version list and the pointer or switch effect it expects. The daemon calls `createDisclosure` with that
   same intent id/kind/digest/version list, then
   attaches the returned approval id to the intent in a second transaction. It returns the preview only after both
   stores agree. A crash before attachment is safe: startup joins the one matching disclosure record by its bound
   intent id, or drops an intent for which no record exists; an orphan record was never returned and expires unused.
2. Terminal or app approval calls `approveDisclosure` with the re-planned live binding. The activation operation then
   calls `claimForDisclosure` on that exact approved record. Core's existing store uses a per-record transition and
   an `O_EXCL` marker for its single-use guarantee (`packages/core/src/approvals.ts:20-29,801-813`).
3. A judge-budget activation proceeds directly to a final SQLite transaction that re-checks the intent, expected
   pointer state and binding, applies only the budget effect, records the activation and marks the intent complete.
   **Every exact rule-version activation**, whether it is a first rule, a second rule for an already effective type,
   or a replacement of an active version, uses D12's staged-position protocol for every account it names. A
   replacement additionally uses D12's drain-before-swap branch over the union of the old and new versions' scopes.
   It does so while the global switch is disabled as well as while it is enabled; the claimed disclosure authorises only the
   adapter's baseline-only path until finalisation. `enable-all` uses the same protocol to record a fresh cut-over for
   every rule version it makes effective, so the disabled interval is never backfilled. Durable position rows are
   tied to the activation intent, rule version, account and adapter scope; every required row must exist before the
   pointer or switch effect commits, so a used approval is recoverable without inventing another authority and
   partial provider success can never make only part of a multi-account activation effective. A derived tightening
   makes no provider call: its pointer transaction copies its parent version's complete per-account activation-point
   set into rows for the derived version and records that inheritance beside the derivation edge.

Startup runs recovery before any source or worker. An intent paired with `used` first copies that core record's
`usedAt` unchanged into SQLite `claimedAt` when the crash happened before the original SQLite claim write, derives
the completion deadline as exactly `usedAt + 1 hour`, and then either finishes the direct final
transaction or, when its planned effect needs source positions, resumes D12's staged-position-and-finalise path from
the already committed per-account/scope rows before any scheduled poll. One paired with `approved` is re-planned and, only
if the binding and expected pointers still match, resumes the single claim and then follows that same planned path;
drift voids it. A still-pending approval leaves the intent pending until approval or expiry. Expired, revoked or
absent approvals drop the intent without moving an active pointer. Because the intent is durable before the claim,
every used disclosure approval has enough SQLite state either to finish directly or to resume its bounded position
stage until the common one-hour completion deadline. At that deadline any unfinished staged-position activation
becomes terminal `failed`, provider retries stop, a content-free audit row is written and a new approval is required;
it cannot remain stranded in `pending-completion`. `disable-all` cancels any such incomplete activation and wins the
race as D12 specifies. Recovery is crash-injected after every durable write, approval-store transition, baseline
response, staged-row commit and final transaction.

A loosening or any edit outside the whitelist below creates a pending rule version. The approved active rule version
keeps running until that pending version completes the protocol above. Only one nonterminal exact replacement intent
may exist for a rule; preparing or claiming a second returns `REPLACEMENT_PENDING` until the first completes, fails or
is cancelled.

**Replacement is drain, then swap.** After the new version's disclosure approval is claimed, D12 samples one baseline
point P for every adapter scope in the union of the old and new versions' scopes and installs those points as durable
upper drain fences while the old version remains the sole active pointer. The source continues ordinary acquisition
and projection with that old version until its committed cursor has reached P for every shared or old-only scope.
For Slack, “the conversation cursor has reached P” is the aggregate proof defined in D4/D12: both top-level history
and every eligible independently paginated reply scan have covered P; a budget- or 429-suspended reply scan keeps the
scope open.
New-only scopes do not backfill earlier occurrences: an absent acquisition cursor is baselined at P, while an
existing cursor shared by another rule advances to P without projecting those occurrences for either replacement
version. Once every scope is drained, one SQLite
transaction materialises P as the new version's activation points, swaps the active pointer to the new version, marks
the old version `superseded` and releases occurrences after P to the new version. Thus every occurrence eligible for
the old version at or before its scope's P is processed by the old version, every occurrence eligible for the new
version after P is processed by the new version, and an old-only scope ends at P. A per-scope source lock makes the
sample and upper-fence install indivisible from occurrence/projection commits, so an occurrence at the boundary cannot
reach both versions or neither. D12's one-hour deadline, terminal failure settlement, crash recovery and
`disable-all` cancellation apply to sampling **and** draining. A **tightening** is unchanged: it never drains; its one
transaction revokes the wider active version, installs the derived tighter version and pointer immediately, and
cancels affected work. Tests inject backlog and new occurrences before sampling, during the drain and at the swap,
for all four sources and across restart, proving each eligible occurrence is processed by exactly one version. A
target, subscriber or judge edit always requires a new referencing rule version and approval, even when the object
edit is narrower; this is what preserves
the exact object-version grant rather than inventing a standalone object activation. Removing one of those objects is
different: it records an immediate revocation of all of its versions and cancels their work, but activates no
replacement. The **entire no-approval tightening whitelist** is syntactic:

1. disable a rule, or revoke a target, subscriber or judge without replacing it;
2. remove a target from a rule;
3. remove an output field from a mapping;
4. lower a rate cap;
5. shorten any retention;
6. narrow source options by removing a Gmail label, changing Gmail `labels: "any"` to `inbox` or an explicit set,
   removing a Slack conversation, Resend kind or WhatsApp chat, or changing Gmail `includeSpamTrash` from `true` to
   `false`; changing WhatsApp `all-allowed` to an explicit subset is also a narrowing.

Every other edit—including any condition edit, constant change, source-pointer substitution, target/subscriber/judge
pointer substitution, any edit that produces a new target/subscriber/judge version (including `plain` to `enveloped`
or a smaller approved address set), new account or output field, any source-option addition (including an explicit
WhatsApp chat set to `all-allowed`) or inverse transition—needs a fresh standing authorisation. A no-approval
tightening is SQLite-only. A whitelist edit that leaves a rule effective creates its new immutable rule version and,
in the **same transaction**, inserts exactly one durable
`derived_authorizations { versionId, parentApprovalId, parentVersionId, editKind, createdAt }` row, fixes the new
version's immutable authorisation lineage to the root approval and `authorizationActivationId = versionId`, moves
the rule pointer with `currentCutoverId = versionId`, copies every parent `rule_activation_points` row under that
cut-over id to the new version with `inheritedFromVersionId`, marks the displaced wider version `revoked` with
`revoked_at`, cancels affected work and performs the required purges. `versionId` and `parentVersionId` are canonical
`<ruleId>@<version>` ids for the same rule; `parentApprovalId` is the exact disclosure approval at the root of the
lineage, not a newly manufactured approval. The transaction first proves the parent version is currently effective
and authorised, and that `editKind` is exactly the one syntactic whitelist transformation being applied. A derived
version may parent another derived version, but following `parentVersionId` must be acyclic and must end at the
exact version named by `parentApprovalId`. A disable or object revocation creates no replacement effective version,
so it records only the revocation/cancellation effect and needs no derived row. No source treats a version as active,
and no worker, recovery path, dry-run read or SSE replay treats an active or superseded bound version as authorised,
unless this exact-or-derived lineage validates.

The copied positions are the derived version's authorisation fence: a tightening cannot reach an occurrence that its
parent was never authorised to see, and it does not introduce a gap by pretending the tightening was a new provider
cut-over. That same transaction marks every queued or retryable affected delivery `cancelled`, purges each cancelled encrypted
record, and purges retained dry-run and SSE entries made under the revoked version. Supersession alone performs none
of those cancellations or purges. A crash cannot
commit a new pointer without its derived row or vice versa. Each edit has one explicit post-commit invariant and test;
there is no generic “disclosure-set subset” proof:

1. disabled object — no new judge reservation, delivery claim, dry-run/SSE append or replay bound to it can cross;
2. removed target — no delivery to that target can cross;
3. removed output field — that pointer is absent from every newly created payload;
4. lower rate cap — no new cap charge can exceed the lower rolling-window limit;
5. shorter retention — every affected record already beyond the new deadline is terminal and purged in the same
   transaction, and no affected record survives its new deadline;
6. narrowed source options — no later provider request, projection or decision can include a removed label,
   conversation, kind or chat, any label outside a newly installed Gmail selector, or spam/trash after that opt-in
   is removed.

Mutations outside those six forms are always pending. The tests pause each worker at the relevant transaction
boundary and assert the invariant against already queued work as well as work created afterward.

Rule-version lifecycle has exactly three states once a version has been activated: `active`, `superseded` and
`revoked`. An inert version that has never activated has no lifecycle row/state; absence is not a fourth state. An
exact replacement makes the old version `superseded`, not revoked. Its already-created projections and decisions,
queued or retryable deliveries, retained dry-run rows and SSE replay entries remain authorised until their own
approved retention deadlines. They keep their exact bound versions and are never remapped to the new active pointer.
Only a revoking action cancels work: an immediate tightening replacement, rule disable or removal, bound-object
revocation/removal, account removal, or `disable-all` through its switch-generation revocation. Supersession by
itself is not a revoking action.

Revocation is immediate at its commit. Immediately before judge or delivery I/O, on retry, and on dry-run read or
SSE replay, the boundary transaction requires the bound rule version to be **not `revoked`**, every referenced
target/subscriber and judge version to be unrevoked, the bound rule's exact-or-derived authorisation lineage to
validate, the row's switch generation to equal the live enabled generation, and D9's account to be live. It never
requires the bound rule version to remain the active pointer: `superseded` work remains valid. After revocation
commits, no worker can cross that boundary. I/O
already in flight cannot be recalled and is recorded as such.

**Secrets never enter model context.** The complete human-only operation set is closed and named:

| Operation | Exact contract |
|---|---|
| `target secret create <targetId>` / `target secret rotate <targetId>` | `create` requires an empty signing slot; `rotate` requires a current generation. The daemon generates a Standard Webhooks signing secret, stores the new generation and reveals it exactly once. `rotate` keeps D6's bounded two-generation overlap; neither command accepts caller-supplied secret bytes. |
| `target url set <targetId>` | Hidden input accepts the complete secret URL for the new incomplete target version, canonicalises it, stores it in that version's new slot and returns only D7's authority tuple and fingerprint. It never replaces a URL in an existing slot. |
| `subscriber token create` / `subscriber token rotate` | The selected subscriber id is a structured non-secret argument; `create` requires an empty slot and `rotate` an existing generation. The daemon generates and stores the token and reveals it exactly once; `rotate` invalidates the prior generation and closes its streams. |
| `judge key set <judgeId>` / `judge key rotate <judgeId>` | `set` requires an empty hosted-judge slot; `rotate` requires an existing generation and atomically replaces it. Hidden input supplies the credential without changing the approved endpoint, provider or model. No key byte is echoed. |

Each operation is available only from the terminal—with the existing TTY and agent-marker checks
(`packages/core/src/change-flow.ts:208-210,291-320`; `packages/core/src/cli-runtime.ts:36-60`)—or D13's dedicated
`secrets` window. Hidden-input operations never accept a value on argv or stdin when it is not a TTY. Reveal-once
values are written only to the controlling TTY or returned only to that privileged window; `--json` is refused for
them. MCP tools neither register these operations nor accept, return, reveal or rotate their material. An
MCP-proposed target, subscriber or hosted judge is incomplete and disabled until one of these operations completes
its slot.

Signing-secret and subscriber-token rotation changes generations inside a referenced secret slot, not the authorised
destination. A hosted-judge key can likewise rotate in its human-only credential slot. A secret URL is different:
changing any byte creates a new target version with a new fingerprint, and every intended rule needs a new rule
activation. Every secret operation appends an audit row containing only the operation name, the target/subscriber/
judge id and version where applicable, outcome and time—never input, generated bytes, a URL component, fingerprinted
material or a secret reference that embeds it.

Every row above, plus `secrets migrate`, has its own `status: "exception"` entry in `capabilities.json`, with the
reason: "secret material must never enter model input or output; the person completes this operation at the terminal
or app." Tests enumerate this closed list and prove that none of its command names, argument schemas or results
appears in `tools/list`, any MCP schema, structured content or MCP text output. This follows the existing
terminal-only `approve` exception (`capabilities.json:241-254`) and the rule that a token is never accepted through
chat because the transcript retains it (`docs/superpowers/specs/2026-09-25-cli-mcp-parity-design.md:81-90`).
Credential exposure to model context is already in scope as a vulnerability (`SECURITY.md:32-33`).

**Required `SECURITY.md` amendment.** Phase B1 adds the following exact bullets; this specification does not edit
`SECURITY.md` itself:

> - **Disclosure without a standing authorisation** — any webhook or subscriber stream receiving event-derived
>   content, or any hosted or local judge being invoked with it, without an active, digest-bound standing
>   disclosure authorisation for exact approved versions, or versions derived from them by a whitelisted tightening,
>   including the complete validated derivation lineage for the exact effective rule, target, subscriber and judge
>   versions; after that authorisation is revoked; outside its approved mapping,
>   retention or delivery rate cap; or without successful taint recording before disclosure.

and, under "What the safety model does not claim":

> - **A standing disclosure authorisation is not approval of each event.** Once a person enables one at the terminal
>   or in the app, future unseen content that matches its approved rule may leave automatically through its approved
>   target or be evaluated by its approved judge. `agent-events doctor` and the app list every active authorisation.
>   Disabling or removing any bound rule, target, subscriber or judge revokes it immediately; content already in a
>   network operation cannot be recalled.

### D3. The event catalogue: typed, versioned, and explicit about trust

Every event type is a definition in `@agentcomms/events`:

```ts
type PointerPatternToken = string | { readonly any: true };
type PointerPattern = readonly PointerPatternToken[];

interface EventDefinition<T> {
  type: string;                         // 'gmail.message.received'
  version: number;                      // a breaking change creates another retained version
  channel: 'gmail' | 'slack' | 'resend' | 'whatsapp';
  schema: z.ZodType<T>;                 // JSON values only; ISO strings, no Date or transforms
  untrusted: readonly PointerPattern[]; // sender-controlled prose
  content: readonly PointerPattern[];   // fields that can make an agentic prefilter selective
  addresses: readonly PointerPattern[]; // structured address-valued fields
  handles: readonly {                   // platform ids carry their workspace scope
    pattern: PointerPattern;
    workspace: PointerPattern;
  }[];
  formats: readonly {
    pattern: PointerPattern;
    format: 'email' | 'domain' | 'date-time' | 'uri';
  }[];
  subject(event: T): string;            // the required CloudEvents subject in the table below
  dedupeKey(event: T): string;
  examples: readonly T[];
}
```

A string token is one exact object key; `{ "any": true }` is one arbitrary array index. The grammar never puts a
wildcard inside a string: `"*"` is the literal key `*`. Schema validation refuses an `any` token on an object and a
string token on an array. For an event instance, a pattern expands to concrete RFC 6901 pointers: string tokens are
escaped with `~0` and `~1`, and `any` expands to every present array index.

Concrete-pointer handling is schema-aware and canonical. `""` names the root; an empty object key is legal; `/0`
names array index zero; array indices with leading zeroes and `-` are refused. Object keys named `"0"`, `"01"` or
`"-"` remain ordinary keys. Access uses own properties only, so `__proto__`, `constructor` and `prototype` are data,
never prototype traversal.

`dedupeKey` is stable within an account and event type, never a database row number that changes on rebuild. The
normaliser computes `eventId` as lowercase hexadecimal SHA-256 over the UTF-8 bytes of core canonical JSON for the
tuple `["agentcomms-event-v1", installationId, accountId, eventType, typeVersion, dedupeKey]`, truncated to its first
32 hex characters. The literal domain separator and length-delimited JSON values make the encoding unambiguous;
core's hash and canonical encoder are at `packages/core/src/digest.ts:99-100,117-127`. Ingest has
`UNIQUE(eventId)`, so polling, crash recovery and a rebuilt provider index converge on the same row while identical
provider ids in two accounts have different preimages. D8 detects and stops on the theoretical truncated-hash
collision instead of merging unequal canonical identities. `installationId` is the database identity whose full
lifecycle and reset contract are specified in D8; it is not regenerated on an ordinary restart, migration or restore.

Every source event carries `{ id: eventId, type, version, occurredAt, observedAt, account: { name, id, channel } }`
plus its type-specific fields in one strict top-level object. Version 1 contains exactly the seven provider-source event types in the normative
**Version-1 event catalogue** (Appendix A). That appendix is the source of truth for every field's JSON type,
requiredness, nullability, enum and format; the complete `untrusted`, `content`, `addresses`, `handles` and `formats`
patterns; and each `subject` and `dedupeKey`. This section defines how catalogue definitions behave; it does not
abridge or widen Appendix A's wire schemas.

The field selections in Appendix A are derived from the repository's current read results rather than invented in
isolation: Gmail `ReadMessageResult` (`packages/gmail/src/operations/read.ts:41-68`), Slack `ReadMessage`
(`packages/slack/src/text/message.ts:75-135`), Resend `SentRow` and `ReceivedRow`
(`packages/resend/src/operations/read.ts:184-198,359-369`), and WhatsApp `MessageView`
(`packages/whatsapp/src/present.ts:59-77`). The appendix identifies every catalogue-only join, rename, computed
field and narrowing explicitly.

`observedAt` is sampled once when the daemon first accepts the provider occurrence into durable normalised-event
staging; provider page/scan staging that still lacks a required classification read is not yet that observation. A
response lost before the normalised stage commits has not been durably observed. When the provider supplies a
timestamp for the occurrence, `occurredAt` is that value: Gmail message `internalDate` for received/sent, Slack `ts`, Resend
`receivedAt`, and the WhatsApp message `at`. Version 1 has exactly two sources without a provider occurrence
timestamp: a Gmail label change and a Resend `last_event` state change. For `gmail.message.labelled`, `occurredAt`
is the observation time at which the daemon first read and durably staged that history record; for
`resend.email.status_changed`, it is the observation time of the first durably staged changed state. In both cases
`occurredAt === observedAt`; the Resend event body's `at` is that same stored value. Source staging carries the
sampled value until the same value is stored in the content-free `ingest` row. Normalisation retry, crash recovery,
decision replay and delivery retry always read the stored value and never sample a new clock value, so D6's
CloudEvent bytes remain identical.

Every version-1 catalogue event therefore has a non-empty subject; it is derived before mapping and cannot be
overridden by the mapping or a target. A later event type or breaking version must add its own explicit subject row
before it can enter the catalogue.

Operational records named `agentcomms.source.degraded`, `.gap`, `.recovered` and
`agentcomms.delivery.dead_lettered` are **not catalogue source events in version 1**. They are content-free daemon
health records shown only by `doctor` and the app. They never enter source selection, normalisation, ingest, rule
evaluation, mapping or a target outbox. Saving or testing a rule whose type begins `agentcomms.` is refused even if
the name matches one of those records. Dead-lettering such a record cannot create another record or delivery because
operational records are never event inputs. The target-level installation reset notice is separately fixed in D6/D7 and is
likewise neither selectable nor routed from an event.

The fixed synthetic test value is also not a catalogue source event. Judge tests receive only
`{ synthetic: true, message: "agentcomms test event" }`; target tests send the exact canonical CloudEvent bytes
`{ "specversion":"1.0", "id":"agentcomms-test-v1", "source":"urn:agentcomms:test", "type":"io.agentcomms.test.v1", "time":"2000-01-01T00:00:00Z", "datacontenttype":"application/json", "data":{ "synthetic":true, "message":"agentcomms test event" } }`.
No runtime id, timestamp, account value, mapping or caller field is inserted.

Bodies or file metadata are fetched only when at least one active, source-option-matching rule version's per-rule
projection requires them for a condition, judge input or mapping. The full normalised source event exists only in
memory while D8 builds those projections; it is never retained as a shared record. Sender-controlled prose always
passes through the existing HTML/plain-text sanitiser before either
representation below (`packages/core/src/sanitize.ts:1037-1122`); the catalogue stores paths, not already enveloped
values.

**Required lazy materialisation has a terminal protocol.** After an occurrence's list/metadata row has been accepted,
every Gmail body/attachment fetch and Resend detail/body/attachment fetch required by an otherwise eligible
projection is part of that projection's source transaction, not an unbounded prerequisite held only in memory. A
provider 404 resolves every projection that requires that missing material immediately as `vanished`: the daemon
writes only content-free resolution rows and counts/last-resolution health, creates no decision or delivery for
those affected projections, and does not emit a source-gap record. Any other transport, provider, decoding,
sanitisation or schema failure persists `firstFailedAt`, `attempts`, `nextAt` and a stable failure code in encrypted
source staging and retries with capped exponential backoff and jitter for at most 24 hours from the original
`firstFailedAt`. At the deadline it resolves each affected projection as `unresolvable`, writes one content-free
`agentcomms.source.gap` record for the source occurrence and stable failure code, and stops retrying. The record
contains no body, attachment metadata, detail response or provider error text.

Unaffected metadata-only projections over the same occurrence may still be inserted. The provider cursor may advance
only after every eligible projection is either committed, skipped by its rule/source filters, or has one of those
terminal materialisation resolutions; it then advances in the same transaction that makes the final outcome durable.
A terminal resolution is replay-stable and can never become a later event. Restart preserves the original
`firstFailedAt`, deadline and completed outcomes. This protocol applies equally when Gmail metadata classification
succeeds and the message is deleted before a later full read, and when a Resend list row exists but its detail, body
or attachment response is permanently missing or malformed.

Three independent mechanisms must not be conflated:

1. **Prose representation.** Each target version chooses `untrustedRepresentation: "enveloped" | "plain"`.
   `enveloped` is the default and replaces each sender-controlled string with the existing
   `<untrusted-content>` envelope (`packages/core/src/untrusted.ts:99-120`). `plain` delivers the sanitised value as
   typed by the source, with no mapping transform, and is a loosening whose approval preview warns: "This is a
   sanitised source value, not the provider's raw bytes. A consumer that feeds it to a model must envelope it first."
   Local SSE subscribers default to `enveloped`. Whether this is the accepted meaning of “values as they are” remains
   the explicit owner question in §8.
2. **Address and handle taint.** This is always computed from the exact final target payload or judge input and
   flushed before disclosure, regardless of prose representation (D7).
3. **Other untrusted text.** Provider and target error messages are sanitised, bounded and rendered as untrusted in
   logs and the app; audit rows keep only stable codes and hashes. A judge's optional `reasonCode` must match
   `^[a-z0-9_]{1,40}$` and is labelled **model-produced**, never presented as provider fact or configuration.

The mapping evaluator returns both the mapped value and provenance from each concrete output pointer to the concrete
source pointers it copied; constants have explicit `constant` provenance. A catalogue pattern intersects a copied
value when its concrete source pointer equals, is an ancestor of, or is a descendant of that value's provenance.
Copying a parent therefore propagates every matching untrusted, address and structured-handle descendant to its exact
output pointer; copying a subtree recursively preserves the same provenance. `handles` supplies the platform id and
its workspace id separately because core intentionally requires adapters to parse platform markup and hand over ids
rather than infer them from arbitrary strings (`packages/core/src/taint.ts:95-120,401-410`). Structured `addresses`
are recorded as headers; every mapped `untrusted` prose string is also scanned for free-text addresses through the
same `observeText` path the existing envelope uses (`packages/core/src/taint.ts:380-398`); constants do not inherit
source taint. The same provenance computation is applied to a judge's exact input projection.

The generated JSON Schema for each rule/target version describes the actual delivered representation, including
envelope strings when selected. Its exact `$id`, and therefore D6's `dataschema`, is
`urn:agentcomms:schema:delivery:<percent-encoded-rule-id>:v<ruleVersion>:<percent-encoded-target-id>:v<targetVersion>`;
the two ids use the same UTF-8 RFC 3986 component encoding and uppercase hexadecimal escapes as D6. Catalogue
validation proves every address, handle, workspace and semantic-format pattern is legal for the schema and expands
only to values of the declared type.

### D4. Sources: polling first, with resumable cursors and reset detection

Every rule stores one channel-specific `sourceOptions` value as part of D2's canonical full rule document:

```ts
type SourceOptions =
  | { channel: 'gmail'; labels: readonly string[] | 'inbox' | 'any'; includeSpamTrash: boolean }
  | { channel: 'slack'; conversations: readonly [string, ...string[]] }
  | { channel: 'resend'; kinds: readonly ('received' | 'status')[] }
  | { channel: 'whatsapp'; chats: readonly [string, ...string[]] | 'all-allowed' };
```

Arrays are non-empty, duplicate-free and sorted by raw UTF-8 bytes; ids are the provider's stable canonical ids,
not display names. Gmail `labels: "inbox"` is the canonical system-INBOX selector; an array is an explicit label-id
set; `labels: "any"` is the explicit canonical absence of a label selector. Resend kinds are emitted in the fixed
order `received`, `status`. WhatsApp `all-allowed` is a deliberate selector for every chat the connected source is
allowed to read now or later, and its preview says that explicitly. The canonical value—not an omitted field, UI
shorthand or provider default—is stored in the immutable rule version and bound into the disclosure digest. Empty
arrays, unknown ids/kinds and a source-options variant that does not match the source channel are refused at save.

Subset classification is field-by-field. Removing one Gmail label, Slack conversation, Resend kind or WhatsApp chat
is D2's source-option tightening; adding any one is a loosening. Gmail `true → false` for `includeSpamTrash` is a
tightening and `false → true` a loosening. WhatsApp explicit ids → `all-allowed` is always a loosening, while
`all-allowed` → explicit ids is a tightening. Gmail `inbox` participates as the singleton system-INBOX selector, so
a transition to or from an explicit label set is classified by the labels it removes and adds; a mixed edit with any
addition remains pending and needs approval. For Gmail, any explicit set or `inbox` → `any` is a loosening, while
`any` → an explicit set or `inbox` is a tightening. Golden vectors mutate exactly one label, selector mode, flag,
conversation, kind or chat at a time and prove both the digest and classification change.

| Source | Version 1 | Later |
|---|---|---|
| Gmail | Keep exactly one mailbox-level cursor per account and make one unfiltered `users.history.list` scan from its stored `historyId`; the request deliberately omits `labelId`, because Gmail accepts only one singular label filter rather than the union several rules require. Follow every `nextPageToken` before committing the final response's `historyId`, and use the specific change arrays rather than duplicate generic entries. Gmail explicitly warns that messages in a history response will typically contain only `id` and `threadId`, so received/sent classification and selection use the observation-time metadata read below rather than `messagesAdded[].message.labelIds`; labelled events alone use their own change arrays. A 404 re-baselines the one mailbox cursor at `getProfile().historyId` and records `agentcomms.source.gap` for the app/doctor, with no silent backfill. This broader acquisition is disclosed in the UI and follows Gmail's documented pagination and change resources ([`users.history.list`](https://developers.google.com/workspace/gmail/api/reference/rest/v1/users.history/list), [`History`](https://developers.google.com/workspace/gmail/api/reference/rest/v1/users.history#History), [`Message`](https://developers.google.com/workspace/gmail/api/reference/rest/v1/users.messages#Message), [`users.getProfile`](https://developers.google.com/workspace/gmail/api/reference/rest/v1/users/getProfile)). | `watch` plus Pub/Sub pull may wake the same reconciliation path; it never replaces `history.list`. |
| Slack | Poll only the non-empty conversation-id sets named by active rule versions, plus the union scopes held by a nonterminal D12 replacement drain, and promise **top-level posted messages only**, plus the bounded reply reconciliation below. Each conversation has a committed timestamp watermark and a durable scan `{oldest: watermark, latest: cycle-start, cursor}`. Follow every `response_metadata.next_cursor`, even after a short or empty page; a cycle may spend only its workspace request budget, so a cut-short scan persists that exact cursor and boundary and continues next cycle. It commits the new watermark only after the last page and committed ingest. A budget cut, ordinary empty page or `invalid_cursor` alone is never a gap. On `invalid_cursor`, restart the same bounded scan without a cursor; record `agentcomms.source.gap` only when Slack explicitly reports an `is_limited` or equivalent retained-history boundary that excludes the committed watermark. If coverage cannot be established, mark the source degraded and do not advance or record a gap. Posts dedupe on `(channelId, ts)`. The scheduler supports Slack's conservative affected-app limit and learns from 429/`Retry-After`; the UI shows worst-case latency ([`conversations.history`](https://docs.slack.dev/reference/methods/conversations.history/), [Slack rate-limit notice](https://docs.slack.dev/changelog/2025/05/29/rate-limit-changes-for-non-marketplace-apps/)). For a thread whose parent was observed within the previous seven days, maintain a separate reply watermark and fully cursor-page `conversations.replies` under the same resumable budget; Slack documents that method as independently cursor-paginated ([`conversations.replies`](https://docs.slack.dev/reference/methods/conversations.replies/)). A replacement drain row for one conversation is therefore an **aggregate barrier**: it is complete only when the conversation's top-level history cursor has covered P and every eligible thread discovered at or below P has a durable reply scan whose own cursor has covered P. The eligible-thread set grows as the bounded top-level drain discovers parents and is frozen only when top-level coverage reaches P; a reply scan deferred by the workspace budget or a 429/`Retry-After`, including one with a saved `next_cursor`, keeps the conversation drain open. Swap and restart may reuse completed child scans but cannot infer their completion from the top-level watermark. **Polling does not emit replies to older threads or any message edits.** Those are documented version-1 polling limits, not silent completeness claims. | Socket Mode needs its own future design (D15); this specification makes no completeness or replay-cursor claim for it. |
| Resend | `received.list` is paged newest-first toward the stored anchor. A durable scan keeps `{anchorId, cycleHeadId, after, pagesScanned}` between cycles; `cycleHeadId` is the first id seen, and `after` is the last id on the last completed page. Pages are staged encrypted and the anchor advances to `cycleHeadId` only when the old anchor is found and all staged rows commit to ingest or D3's terminal projection resolution. If the anchor is not found within ten pages—because retention or deletion made it unreachable—the daemon purges the stage, atomically re-baselines to `cycleHeadId` and records `agentcomms.source.gap`; it never scans an unbounded history. A required received-email detail/body/attachment 404 resolves affected projections as `vanished`; every other failure retains the anchor and retries for at most 24 hours before `unresolvable`, one content-free source-gap record and cursor progress. The sent list is paged newest-first through every id from the most recent seven days. Those ids have rows in a state table for seven days; each read compares `last_event` with the stored value and emits only a change. The UI says these are observed states, not every intermediate transition. The daemon may consume at most half the machine-wide throttle and an interactive CLI/MCP call always takes the next available slot ([Resend received list](https://resend.com/docs/api-reference/emails/list-received-emails)). | A signed hosted relay for Resend webhooks is a separate product. |
| WhatsApp | Change the existing snapshot-and-rebuild sync (`packages/whatsapp/src/operations/sync.ts:45-113`) so, under its index lock, it renames the current target to an owner-only sibling `index.previous.sqlite` **before** the existing atomic building-index replacement point (`packages/whatsapp/src/index-db.ts:266-277`), then renames the checked building index into place and fsyncs the directory. Startup restores the sibling if a crash landed between the renames. Diff old and new before deleting the sibling. The comparison is a multiset whose occurrence identity **never contains `Z_PK`**. For a row with `ZSTANZAID`, its identity is canonical JSON of `["stanza", stanzaId, timestampMs, tieIndex]`, where `timestampMs` is the exact normalised message timestamp in milliseconds. `tieIndex` considers only that chat's rows with the exact same stanza id and exact same timestamp. It ranks their distinct canonical normalised-message-field byte strings by SHA-256 digest and then by those bytes: those bytes are UTF-8 core canonical JSON of the exact fields used to build the event's WhatsApp-specific payload—`chat`, `sender`, `text`, `at`, fixed `fromMe: false`, `kind`, `viewOnce`, `groupEvent` and `media`—before any derived identity field. Rows with equal bytes are identical events with one identity; the multiset diff counts their copies rather than imposing an order. Thus a stanza id reused with the same timestamp and identical content is indistinguishable by design, while a later row with that stanza id and an earlier or later timestamp changes no prior event identity or position. Exact same-timestamp rows with different content receive the same identities irrespective of arrival order. Without a stanza id, group on `(chatId, timestamp, sender, SHA-256(text))` and assign zero-based slots within that identical group; its identity is canonical JSON of `["fallback", chatId, timestamp, sender, textSha256, occurrenceIndex]`. The text hash is lowercase SHA-256 over the UTF-8 bytes of core canonical JSON for the nullable sanitised text, so `null` and `""` differ. Equal rows and repeated stanza ids are never coalesced. That occurrence identity is the event `messageId`; A.7 derives `subject` and `dedupeKey` from it, and the per-chat high-water position is ordered by `(timestamp, occurrenceIdentity)`. The current `MessageView.id`, which is derived from `ZWAMESSAGE.Z_PK`, is not an event id or cut-over component. A decrease in maximum `Z_PK`, an index-format change, or disappearance of a previously retained non-empty stanza-id set is still a store-reset signal only: re-baseline and record a gap rather than treating old high-water marks as current. Apple's PPPC page establishes only the identifiers available to a managed privacy payload ([Apple Platform Deployment](https://support.apple.com/en-gb/guide/deployment/dep38df53c2a/web)). **Hypotheses for the phase-D spike**, not current claims, are that interactive TCC follows the same executable identity and that app-launched and service-launched copies may need separate grants; background collection does not ship until the spike establishes the actual behaviour and the app explains it. | A file-system notification may wake the same safe snapshot path; it never reads the live store. |

**Gmail observation-time classification and selection.** An occurrence key is
`(historyRecordId, messageId, changeType)` for `received`/`sent`, and
`(historyRecordId, messageId, "labelled")` for the one labelled occurrence formed by combining that record's
additions and removals for the message. Before the daemon accepts a `messagesAdded` occurrence as observed, it
performs one `messages.get(format=metadata)` for that message with `labelIds` requested. On the first successful read
it samples D3's `observedAt` once and durably stages that timestamp with the resulting label set. A successful
response with no `labelIds` member is the observed empty set. Any observed `DRAFT` label skips the occurrence
completely; otherwise observed `SENT` classifies it as `gmail.message.sent`; otherwise it is
`gmail.message.received`. `labels: "any"` does not bypass this classification read. A message-level
`messages.get` response of HTTP 404 (`NOT_FOUND`) resolves that staged occurrence terminally as **`vanished`**: the
daemon records a content-free count and last-resolution time for `doctor`, creates no normalised event, projection,
decision or delivery, and no longer lets that occurrence block the mailbox cursor. This is distinct from the
`history.list` cursor 404 that re-baselines the mailbox. Gmail documents 404 as “the requested resource couldn't be
found”, and permanent message deletion makes that a final answer rather than a retryable metadata state
([Gmail error handling](https://developers.google.com/workspace/gmail/api/guides/handle-errors),
[`users.messages.delete`](https://developers.google.com/workspace/gmail/api/reference/rest/v1/users.messages/delete)).

Every other failed, unavailable or undecodable metadata read leaves only the raw history occurrence in encrypted
source-scan staging, with `firstFailedAt`, `attempts`, `nextAt` and a stable error code. It retries with capped
exponential backoff and jitter for **at most 24 hours from `firstFailedAt`**, preventing the mailbox cursor from
advancing over it and making no received/sent projection, body fetch or delivery. At that deadline it resolves
terminally as **`unresolvable`**, writes one content-free `agentcomms.source.gap` record naming the account, source,
occurrence key and stable failure code (never message content or provider error text), increments the corresponding
`doctor` count, and stops blocking the cursor. A later replay cannot turn either terminal resolution into an event.
Until either terminal resolution or one successful read, the occurrence has not acquired an observation-time label
set and there is no default-to-received path.

After that metadata read succeeds, any rule-required Gmail full/body/attachment materialisation follows D3's
projection-scoped protocol independently. Deletion between metadata and the full read yields immediate `vanished`
for the affected projections; non-404 or malformed responses retry from their original `firstFailedAt` for at most
24 hours and then yield `unresolvable` plus one content-free gap. Metadata-only projections remain eligible, and the
single mailbox cursor advances only when every affected projection has committed or terminally resolved.

The same observed label set is the received/sent event body's required `labels` value, filters `inbox` and explicit
label selectors, and evaluates `includeSpamTrash`: observed `SPAM` or `TRASH` excludes the occurrence when the rule
binds `false`. One metadata read serves every rule over that occurrence. The approval preview for a received/sent
rule restricted to an explicit label says **“messages carrying <label> when agentcomms observes them”** (substituting
the displayed label name, and listing each label for a set); the `inbox` preview uses the same sentence with
`INBOX`. This is deliberately observation-time semantics, not a historical-label claim. In healthy operation the
gap from the mailbox change to observation is at most one configured polling interval; it can be longer after daemon
downtime or while collection is disabled. A label changed during that gap is judged in its observed state. Thus a
label added after arrival but before observation can make the received/sent occurrence match, while an add after
observation cannot change that occurrence's classification, body or matched rules and is visible only through its
own labelled occurrence. Disabled intervals are still not backfilled under D12.

`gmail.message.labelled` remains occurrence-specific. It uses only the union of its own
`labelsAdded[].labelIds` and `labelsRemoved[].labelIds` for selector matching and `includeSpamTrash`, while its body
preserves the two arrays separately. A selected-label removal therefore matches, as do the corresponding add and a
later re-add. An entry with no label id in either change array produces no labelled occurrence. It never consults
the received/sent observation-time metadata snapshot or a later metadata read. Its `occurredAt` is D3's durably
stored observation time for the first read of that history record because Gmail supplies no label-change timestamp.

**Per-rule-version cut-over and replacement drain; one Gmail scan cursor.** The one acquisition cursor remains keyed only by Gmail account,
never by event type or rule. It exists to scan the mailbox efficiently and is **not** a disclosure-authorisation
fence. A first exact rule-version activation records, for every Gmail account named by that version, the mailbox
`historyId` returned by `users.getProfile` during that activation. An exact replacement records it for every account
in the union of the old and new versions, including an old-only account whose scope ends at that P. This is required
for a second same-type rule and for every replacement version—including a looser replacement—just as it is for a
first rule or a different type.
D12 stages one profile result per affected account and may reuse that response for several rule versions in one
`enable-all`, but finalisation writes a distinct immutable activation-point row for each
`(activationId, ruleId, ruleVersion, accountId)`. A derived tightening copies its parent's points and records the
inheritance; it never samples “now”. For an exact replacement, the profile result is P for that mailbox in the
old/new scope union. The old pointer remains active and its projections are capped at P until the mailbox cursor has
committed through P; only then does D12's transaction swap the pointer and install P as the new version's lower
activation point. There is no per-`(account,eventType)` epoch in the authorisation model.

Gmail history ids are compared as unsigned decimal integers, never lexicographically. A history occurrence may be
projected for a rule version only when its history-record id is **strictly greater than the account point selected
by that active pointer's `currentCutoverId`**. The rule version's immutable authorisation-activation id proves its
lineage but does not select a later enable-all cut-over. The comparison is made before fetching any rule-only body/file data and again in the
transaction that creates the projection. An occurrence at or below the point creates no projection for that new
version, even if it is still present in a lagged or multi-page mailbox scan. During replacement, the old active
version may project its eligible occurrence only through the staged P; occurrences after P remain staged for the new
version and are released only after the swap. The mailbox lock and D12's durable activation-completion scope fence
serialise point acquisition with raw-page staging, occurrence resolution, projection insertion and final-cursor
commit. For a first activation, claim waits for any in-flight commit and pauses further commits before `getProfile`;
finalisation installs the point before releasing the fence. For a replacement, the lock instead atomically installs
the durable P upper fence and then permits the old version to drain through it. Neither path moves or replaces an
existing mailbox cursor or continuation. A failed or cancelled replacement removes its upper fence and lets the
still-active old version consume any deferred later occurrence; no new point or pointer is installed. The single
scan fans each eligible occurrence through the active rule-version/activation-point/drain snapshot; it is never
restarted or duplicated merely because a rule activates.

Slack opens a fresh `openWorkspace` session for every poll and never caches credentials across polls, matching the
current token boundary (`packages/slack/src/operations/session.ts:131-145`;
`packages/slack/src/auth/refresh.ts:172-184`). Its workspace scheduler is shared by daemon jobs. Resend goes through
the existing shared machine throttle (`packages/resend/src/api/throttle.ts:6-29`), with the new priority and half-share
rules above; it runs only the `received` and/or `status` acquisition named by active rules or a pending replacement's
union scopes. WhatsApp diffs and builds
projections only for each rule's explicit chat ids, or for every readable chat under its deliberately broad
`all-allowed` selector. Both fairness rules have deterministic scheduler tests.

In one SQLite transaction, a source writes the content-free event identity plus D8's separately encrypted per-rule
projections and advances its cursor. The durable evaluation contract is D8; a cursor never advances over an event or
required rule projection that exists only in memory. Polling does
not update the interactive `lastUsedAt` field that current Gmail reads update
(`packages/gmail/src/operations/read.ts:314-315,359-360`); sources record `lastPolledAt`.

There is no independently enabled source. A source/account/event-type tuple polls exactly while at least one active
rule version names that live account and event type, or while D12 is draining a replacement union that names it, but
**projection authority is always per active rule pointer and its current cut-over**, never inferred from the tuple's
polling state. Every source occurrence carries an
adapter position, and D12 records these activation points per named account and finer scope where required:

- Gmail: the mailbox `historyId` from `getProfile`, compared as an unsigned decimal integer;
- Slack: one timestamp watermark for every conversation named by the rule, compared using Slack's exact decimal
  timestamp ordering;
- Resend: the newest received-email id present at activation (or a canonical empty-head marker) for `received`, and
  a durable status-tracking start time for `status`; a received row is after the point only when the newest-first
  scan encounters it before the saved id, while a status transition is after only when its first durable observation
  time is later than the start time; and
- WhatsApp: one per-chat high-water key ordered by `(message timestamp, occurrenceIdentity)` from the checked
  snapshot, where the complete stanza-or-fallback occurrence identity already includes its multiset index and never
  includes `Z_PK`.

An occurrence creates a projection for an active rule version only when it matches that rule's account/source options
**and its adapter position is strictly after every applicable lower point selected by the active pointer's
`currentCutoverId`**. While a
replacement drains, that same old version also has the staged P as an inclusive upper point; the new version cannot
project until the atomic swap, after which its lower point is P. A new-only scope is not backfilled: an absent shared
cursor is initialised at P, while an existing cursor needed by other rules advances to P without projecting that
occurrence for either replacement version. An old-only scope is drained through P and then removed. Each exact activation uses D12's claimed,
staged, all-accounts-or-none protocol whenever obtaining a point calls a provider or the
WhatsApp snapshot adapter. A local value such as Resend's status start time is still stored in the same staged set so
finalisation remains atomic. A derived tightening copies its parent's points. An exact replacement samples the union
of old and new scopes and finishes only after every old/shared cursor reaches its staged P. `enable-all` obtains fresh
points for every active rule version so disabled-time occurrences remain ineligible. Acquisition cursors and polling may be
shared—Gmail keeps one mailbox cursor, Slack one conversation scan, and Resend one account scan—but those cursors
never substitute for a rule's cut-over. When the last tuple for a provider scope disappears, polling stops. D9
defines live-account removal, and D12 defines the stronger disabled-interval cut-over.

Each source is an operation in `packages/<channel>/src/operations/events.ts`, tested against that channel's existing
fake (`packages/gmail/test/support/fake-google.ts:1-20`; `packages/slack/test/support/fake-slack.ts:7-12`;
`packages/resend/test/support/fake-resend.ts:8-12`; `packages/whatsapp/test/support/harness.ts:1-20`). A channel
manifest gains an optional `events` declaration describing types, minimum interval and required scopes/key kind; the
current strict schema has no such key (`packages/core/src/channel-manifest.ts:170-224`), so this is an intentional
versioned extension of the channel contract, not a free-form field.

### D5. Conditions

**Deterministic** — a tree that can always be rendered back as a sentence:

```ts
type CanonicalCondition =
  | { all: [CanonicalCondition, ...CanonicalCondition[]] }
  | { any: [CanonicalCondition, ...CanonicalCondition[]] }
  | { not: CanonicalCondition }
  | { path: string; op: 'exists' }
  | { path: string; op: 'equals' | 'notEquals'; value: Scalar; caseSensitive: boolean }
  | { path: string; op: 'contains'; value: Scalar; caseSensitive: boolean }
  | { path: string; op: 'startsWith' | 'endsWith'; value: string; caseSensitive: boolean }
  | { path: string; op: 'in'; values: [Scalar, ...Scalar[]] }
  | { path: string; op: 'gt' | 'gte' | 'lt' | 'lte'; value: number | string }
  | { path: string; op: 'domainIs'; value: string; includeSubdomains: boolean };
```

- `path` is a concrete JSON Pointer validated against the selected event schema. Empty `all`, `any` and `in` arrays
  are refused at save; values must have the schema's exact type.
- Every leaf whose path is missing evaluates Boolean `false`, including `equals`, `notEquals`, comparisons and
  `domainIs`. `not` is ordinary Boolean negation of its child, with no missing-value propagation, so
  `not(equals(missing, x))` is `true`; `exists` alone tests presence and is `false` for a missing path. `in` means the
  path's scalar value is one of `values`. `contains` means substring for strings and element membership for arrays,
  with `value` having the array schema's element type. `startsWith`, `endsWith` and case sensitivity are string-only.
- The authoring schema may omit `caseSensitive`; omission canonicalises to `false` before validation, preview,
  digesting or storage. The stored AST always contains the Boolean explicitly for every operator that supports it,
  so omitted and explicit `false` have byte-identical canonical JSON. `true` is the only case-sensitive form and is
  refused when the compared schema value/array element is not a string; the explicit stored value is then `false`.
- The catalogue's D3 `formats` metadata is authoritative. `domainIs` is legal only on `email` or `domain` fields;
  date operands and `gt | gte | lt | lte` date comparison are legal only on `date-time` fields. Numeric comparison
  remains legal only on numbers. URI fields receive no implicit domain or date semantics. Invalid or mismatched
  operator/type combinations are refused when the rule is saved.
- Case-insensitive string comparison applies NFC and then **full Unicode 15.1 Default Case Folding** using the
  `C`/`F` mappings from the bundled 15.1 `CaseFolding.txt`, excluding Turkic-only mappings; it never calls a host
  locale or runtime case conversion ([Unicode 15.1 components](https://www.unicode.org/versions/components-15.1.0.html)).
  Numbers do not coerce. Date operands are valid RFC 3339 instants checked at save and compared as instants.
- `domainIs` normalises and saves an exact IDNA-ASCII domain with a bundled, pinned implementation of UTS #46
  revision 31 / Unicode 15.1, non-transitional processing, STD3 rules, hyphen/Bidi/joiner checks and DNS-length
  verification ([UTS #46 revision 31](https://www.unicode.org/reports/tr46/tr46-31.html)). It matches that domain
  only unless `includeSubdomains` is true. The implementation and its data ship inside `@agentcomms/events`; Node and
  browser builds cannot fall through to different platform IDNA libraries.
- No regular expressions in version 1. Limits: depth 8, 64 nodes, scalar value 1 KB, `in` 256 values. The canonical
  tree is saved; its sentence is generated. Repository JSON conformance vectors cover omitted versus explicit-false
  `caseSensitive`, missing/negation, every legal format, Unicode 15.1 folding and UTS #46, and the same vectors run
  against Node and a real browser build.

**Agentic** — a question put to a judge after a real deterministic prefilter:

- `{ judgeId, judgeVersion, question, inputs: JsonPointer[], threshold, onUncertain }`. At least one deterministic
  leaf must reference a catalogue `content` field; account/type checks alone do not qualify.
- The judge sees only `inputs`, sanitised and enveloped in a fixed versioned prompt. Input to every implemented judge
  is taint-flushed before the call (D7). It has no tools, secrets or authority.
- An adapter must return one provider-native numeric probability `p`. A value of the wrong type, a non-finite number
  or a number outside `[0,1]` is malformed: the daemon records the malformed outcome and fails closed to no-match;
  it never accepts a provider-supplied `match`. Rule validation likewise refuses a threshold of the wrong type,
  non-finite or outside `[0,1]` before a version can be saved. Execution derives match as `p >= threshold` without
  clamping or otherwise normalising either value. The uncertain band begins at `threshold - 0.1` when the threshold
  is at least `0.1`, otherwise at `0`, and ends immediately below `threshold`. `onUncertain` is `no-match` by default
  or `hold`; only the terminal or app can resolve a hold.
- TypeSafe/Ollama Noul values are labelled **probability**. A generic JSON-output model's number is labelled
  **uncalibrated score**, never Noul probability. `reasonCode`, if any, follows D3.
- A timeout, malformed response or exhausted budget is no-match and degrades the judge. The stored decision records
  provider, model and judge versions, prompt-template version, threshold, value/label and reason code. Retries never
  re-ask.
- A rule's three budget dimensions are **calls per rolling hour**, **input tokens per rolling 30 days** and
  **concurrent calls**. Usage is keyed by stable `ruleId`, not `ruleVersion`: activating a new version inherits every
  charge still inside those windows and every live reservation from the preceding versions. Daemon-wide global and
  per-provider ceilings use the same three dimensions and windows in one singleton `judge_budget` object with
  immutable versions, one active pointer and a default global concurrency ceiling of 2. Global usage is keyed to the
  installation and provider usage to the provider id, so activating a new singleton version cannot reset an in-window
  charge. Every budget version activation—including a lower ceiling—requires terminal/app-only `disclosure`
  approval over its full global and provider values; rules cannot override or copy them.
- Before a production call, one transaction reads the active singleton version and reserves against the calling
  `ruleId`, the provider and the global ledgers. A durable reservation records the rule id/version, immutable budget
  version, provider, one call, an `estimatedInputTokens` upper bound, concurrency ownership and state `reserved`.
  Immediately before transport I/O, a transaction moves `reserved → in-flight`; after the response it moves
  `in-flight → settled`, charging the actual provider-reported input tokens when known or the estimate when they are
  not and freeing the concurrency slots in the same transaction. A pre-I/O refusal moves `reserved → released`,
  frees its slots and charges nothing. Those are the only transitions:
  `reserved → in-flight → settled` or `reserved → released`.
- Startup recovery releases every `reserved` row that never reached `in-flight`. It pessimistically settles every
  `in-flight` row with no settlement by charging its one call and token estimate because the provider may have billed
  it; in either case it frees the concurrency slots in the same recovery transaction. Recovery is idempotent and
  cannot charge a settled row twice. Timeout and transport-unknown outcomes settle with the estimate, never refund.
  No active singleton means no judge call.
- `judge test` has no synthetic rule limits. Its transaction instead enforces a durable rolling ceiling of ten tests
  per hour for the exact `(judgeId, judgeVersion)` and reserves the call, maximum tokens and concurrency against the
  active singleton's **global** rolling-hour, rolling-30-day and concurrency ceilings. It charges neither a rule nor
  a per-provider ceiling. The per-version test charge is not refunded on failure, and the global reservation uses
  the same durable state machine and crash settlement as production usage. No active
  singleton, an exhausted global ceiling or the eleventh per-version test refuses before network I/O.

### D6. Mapping and the external wire contract

The output of a rule is a JSON template whose leaves are constants or path references:

```json
{
  "kind": "invoice",
  "from": { "$path": "/from/address" },
  "subject": { "$path": "/subject", "missing": "null" },
  "labels": { "$path": "/labels" }
}
```

`$path` is a concrete RFC 6901 pointer validated against the event schema. It copies the value and type exactly,
including whole objects and arrays. `missing` is `reject` (default), `omit` or `null`, but `omit` is legal only when
the path node is the value of an object property: it removes that property. A path node at the template root or at an
array element must use `reject` or `null`; save refuses `omit` there, so evaluation never invents an absent root or a
sparse/shifted array. There are no transforms, expressions or array projections. Limits are 256 KB per mapped event,
200 leaves and 4 KB per constant.

Trust propagation uses D3's expanded paths in both directions. With `enveloped`, every intersecting string is replaced
by D3's envelope; with `plain`, it is the sanitised string. The mapping preview shows both representations and every
resulting untrusted output pointer.

The delivered envelope is CloudEvents structured JSON:

- `specversion` is exactly `"1.0"`;
- `id` is the delivery's immutable stable event id. It is the same on every attempt or replay of that delivery; two
  targets for one decision have different ids;
- `source` is exactly `urn:agentcomms:<installation>:<account>`, with installation and account components
  percent-encoded as UTF-8 RFC 3986 components using uppercase hexadecimal escapes;
- `type` is exactly `com.agentcomms.<catalogue-type>.v<catalogue-version>` by default—for example,
  `com.agentcomms.gmail.message.received.v1`. When the approved canonical rule contains `cloudEventType`, its exact
  non-empty value is used instead, without a prefix or version suffix. The value is part of the rule digest; mapping
  and target configuration cannot change it;
- `time` is exactly the source event's `occurredAt` RFC 3339 string, not `observedAt`, an attempt time or a delivery
  creation time;
- `datacontenttype` is exactly `"application/json"`;
- `dataschema` is exactly the generated delivery schema `$id` defined in D3 for the bound
  `(ruleId, ruleVersion, targetId, targetVersion)`;
- `subject` is present for every version-1 catalogue type and is exactly the value in Appendix A: Gmail's
  message id, `<channelId>/<ts>` for Slack, Resend's email id, or `<chatId>/<messageId>` for WhatsApp. It is derived
  from the source occurrence before mapping and cannot be omitted or overridden; and
- `agentcommsrule` is a string `<percent-encoded-rule-id>@<version>`;
- `agentcommsuntrusted` is a CloudEvents **string** extension: unique concrete JSON Pointers into `data`, sorted by
  raw UTF-8 bytes, each RFC 3986 percent-encoded with uppercase hex, then joined by commas. It is omitted when there
  are none. The empty string means the one root pointer `""`; a root pointer subsumes descendants. This is the
  canonical scalar encoding, not a JSON array.

`data` is the mapped JSON value. The exact transmitted body is the UTF-8 encoding of the same recursively key-sorted,
whitespace-free canonical JSON used by D2/D3; array order is preserved. D3 supplies one exact full-envelope byte
vector for every catalogue type, so every required attribute, subject derivation, default type/version mapping,
schema id and extension omission has one implementation-independent oracle. A separate vector exercises an approved
rule-defined `cloudEventType`.

For webhook delivery this JSON object is the CloudEvents JSON event format carried in HTTP **structured content
mode**, not binary mode. Every POST therefore has the exact header
`Content-Type: application/cloudevents+json; charset=utf-8`; `datacontenttype: "application/json"` still describes
the event's `data` member and does not replace that HTTP envelope media type. This follows the
[CloudEvents JSON format](https://github.com/cloudevents/spec/blob/v1.0.2/cloudevents/formats/json-format.md) and its
[HTTP binding](https://github.com/cloudevents/spec/blob/v1.0.2/cloudevents/bindings/http-protocol-binding.md).

The D7 installation-reset notice is a target-level control delivery, not a mapped catalogue event. It uses the same
CloudEvents structured envelope and signing/retention machinery with a reset-notification id stable across its
attempts, type `io.agentcomms.control.installation-reset.v1`, source
`urn:agentcomms:<new-installation-id>`, the fixed reset `dataschema`, no `subject`, `agentcommsrule` or
`agentcommsuntrusted`, and exactly
`data: { resetEpoch, newInstallationId, previousInstallationId?, reasonCode, eventIdsRestart: true }`. Those are the
only bytes of reset metadata: it contains no account, sender, event, rule, mapping, judge, payload or error text.

Standard Webhooks removes `whsec_`, base64-decodes the suffix, and uses it as the HMAC-SHA256 key over the exact
transmitted bytes `webhook-id + "." + webhook-timestamp + "." + body`. `webhook-id` is the immutable delivery id and
is constant across every attempt of that delivery. `webhook-timestamp` is the integer Unix time at the start of
**each attempt**, not the event time or first-attempt time; every retry recomputes all active-generation signatures
over that new timestamp and the unchanged body. The symmetric secret shown to a human is `whsec_<base64>` and the
signature is `webhook-signature: v1,<base64>`. Rotation keeps two active secret generations for a bounded overlap and
sends both space-separated `v1` signatures. Consumer documentation and examples require raw-body verification,
constant-time comparison, the stable webhook id as an idempotency key and a five-minute timestamp tolerance; this
follows Standard Webhooks' distinction between event time and the timestamp of each attempt
([Standard Webhooks](https://github.com/standard-webhooks/standard-webhooks/blob/main/spec/standard-webhooks.md#webhook-metadata)).
An injected-clock test advances between attempts and proves the id and body are identical while the timestamp and
signature change.

### D7. Targets, network boundaries, taint and delivery promises

**Webhook URL forms.** A webhook target is exactly one of these canonical forms:

- A **plain URL** stores and previews its full canonical URL. It must have no username/password userinfo, query or
  fragment; any of those components is refused. Its path is permitted and is treated as non-secret configuration.
- A **secret URL** is required when the URL is itself a credential, including a bearer token embedded in its path or
  query. The person enters the full URL only through D2's human-only hidden terminal/app path. The full canonical URL
  lives only in D9's daemon-owned secret store. The immutable target row, canonical rule document, every preview,
  CLI/MCP/app response, log and audit row carry only `{ scheme, host, port, sha256 }`, where `port` is explicit after
  default-port normalisation and `sha256` is lowercase SHA-256 of the UTF-8 canonical full URL. They never carry its
  path, query or userinfo. D2's disclosure digest therefore binds the fingerprint, scheme, host and port. A different
  full URL is a new target version and cannot overwrite the existing version's secret slot; each rule moves to it
  only through a new rule activation.

Both forms use one URL canonicaliser: lowercase scheme and IDNA-ASCII host, explicit normalised port, exact
percent-encoded path/query bytes and no fragment. Before a secret-URL connection, the daemon reads the referenced
secret, canonicalises it again, recomputes the fingerprint and authority tuple, and refuses any mismatch or missing
secret before DNS or network I/O. A path containing credential material
must never be offered as a plain target; the terminal/app labels the two forms and requires the person to choose the
secret form for such URLs. Tests refuse userinfo and queries on plain URLs; refuse an attempted in-slot URL change;
prove a changed path or query produces a different target version and digest that no existing rule follows; and scan
every CLI, MCP, app, preview, audit and diagnostic output to prove the full secret URL never appears.

| Target | Version 1 contract |
|---|---|
| **Dry-run** | No network I/O. At the delivery boundary, append the exact would-be CloudEvent bytes to the encrypted `dryrun_log` table using D8's packed-record format. The target version binds a retention no longer than 24 hours. `targetKey` is `dryrun:<targetId>:<targetVersion>`. The append charges the rule's ordinary delivery cap and completes the delivery atomically. Only a person at the terminal or in the app may read it, through D3's untrusted text renderer; no MCP result, structured content, log or audit row contains its payload. |
| **Webhook** | `POST` of the exact CloudEvent bytes in CloudEvents structured mode with exactly `Content-Type: application/cloudevents+json; charset=utf-8`, plus the Standard Webhooks headers and signatures below. The scheme is `https` except that `http` is allowed only when the URL host itself is the literal IP `127.0.0.1` or `::1` and that same address is covered by `approvedAddressSet`; a hostname that resolves to loopback is not a literal and is refused. Success is 2xx. Retry with capped exponential backoff and jitter until success, the approved delivery-retention deadline or 20 attempts. Exhausting attempts before the deadline is `dead-lettered`; reaching the deadline first is `retention-expired`. Promise: **bounded at-least-once attempts**, not unconditional receipt. |
| **Local SSE stream** | `GET /v1/streams/<subscriber>` on 127.0.0.1/::1. Each subscriber has an encrypted retained stream log, default 24 hours and maximum 7 days, bound into its standing authorisation. `Last-Event-ID` replays entries still in that window only while the recorded rule version is not revoked, its target/subscriber/judge versions are unrevoked, the entry's switch generation is the live enabled generation and D9's account is live. A superseded rule version remains replay-authorised through the entry's own retention deadline. There is no acknowledgement, so the promise is only **available for replay within the approved window**, never receipt or processing. |

Dry-run, webhook and SSE are the only delivery adapters specified here; phase B1 implements dry-run and phase B2
adds the network adapters. Broker and hosted-queue adapters require the separate
future design in D15; this specification does not define their schemas, credentials, acceptance boundaries or
delivery guarantees.

Every matched target creates one delivery, and the rule's rolling cap counts **deliveries**, not attempts or reads.
For a webhook the first attempt transaction charges the slot once and records `capChargedAt`; every retry is another
attempt of that same delivery and never consumes another slot. For dry-run and SSE, the append transaction charges
one slot, appends the encrypted log row and finishes that delivery atomically. Reading an already appended dry-run
row or replaying an already appended SSE row consumes no slot—it is the same delivery—and is possible only through
its approved retention deadline. A cap-exhausted delivery waits without an attempt or append until a slot opens or
its retention deadline makes it terminal.

**Retention is terminal.** Rule validation refuses a hold window longer than that rule's ingest window. A held
decision receives `holdExpiresAt` from the approved hold window, default 24 hours; if no person resolves it by then,
one transaction records terminal outcome `hold-expired` and purges that rule version's encrypted event projection,
creating no delivery and retaining nothing on behalf of another rule. Every delivery has an approved
absolute retention deadline independent of its retry
or rate-cap schedule. If it has not crossed to `disclosing` before that deadline—including because it waited behind a
rate cap—it becomes terminal `retention-expired` and its encrypted record is purged. Cancelling a delivery records
`cancelled` and purges its encrypted record in the **same** transaction. Webhook payloads are purged after a 2xx; SSE
payloads after their window or any bound-version revocation; dry-run payloads after their at-most-24-hour window.
Every rule, target, subscriber or judge revocation that purges deliveries or SSE entries also purges matching
`dryrun_log` rows in the same transaction. A webhook that exhausts attempts before its delivery
deadline becomes `dead-lettered`; its encrypted payload remains only for the separately approved dead-letter
retention, default seven days, then is purged, and `delivery drop` purges it immediately. When one decision has
multiple targets, each target copy reaches its own terminal outcome and deadline.

`delivery retry` is only a scheduling operation over a webhook delivery whose current state is `retryable`. In one
transaction it rechecks the original attempt limit, absolute delivery deadline, that the bound rule version is not
revoked, unrevoked target/subscriber/judge versions, live account and the delivery's live switch generation, then
moves only `nextAt` to now. A bound `superseded` rule version passes this fence. It
does not decrement or reset `attempts`, extend any deadline, remap content, re-run a judge, change a bound version or
move work across a disable/enable generation. Attempt 20, an expired deadline, a revoked version, a stale switch
generation and every terminal state are refused without mutation. In particular, `dead-lettered` is terminal and
cannot be redriven; only `delivery drop` can remove its retained payload. `disable-all` purges encrypted payloads for
dead-lettered deliveries as well as queued, retryable and already-disclosing work.

**Installation-reset barrier.** A reset creates one durable barrier for each exact target version referenced by an
active rule. The reset notice is the fixed, content-free target-level control delivery in D6, not work owned by any
one rule. Its design limits are always **20 attempts and a 24-hour absolute deadline from creation**. Those limits are
not read from a referencing rule; the reset is exempt from every rule delivery-rate cap and neither consumes nor
waits for a rule cap slot. It carries only D6's reset metadata. Rules with different ordinary caps or retentions can
therefore share the target without changing the reset contract.

The reset delivery is ahead of every ordinary delivery under the new installation id: webhook targets open the
barrier only after a 2xx, and dry-run/SSE targets only after their encrypted append commits. Ordinary rows may be
created behind the barrier, but they cannot move to `disclosing` or append while it is closed; their original
absolute retention deadlines continue to run and expiry purges them normally. The barrier is keyed by
`(resetEpoch, targetId, targetVersion)` and survives restart. It remains required while an active rule references that
exact target version **or** authorised retained work bound to a non-revoked superseded rule version still needs it. If
neither exists, one transaction cancels the queued/degraded reset notice, purges its retained bytes and barrier, and
never sends it merely because an old rule once referred to the target. Removing one of several references does not
cancel it while another active rule or authorised retained row remains.

If the reset delivery exhausts 20 attempts before its 24-hour deadline, it becomes terminal `dead-lettered`; if the
deadline arrives first it becomes terminal `retention-expired`. Either way the target version becomes `degraded` and
the barrier stays closed. No automatic or manual
`delivery retry` can redrive it. A person may run `target resume` at a terminal or use the app; if the target version
is still referenced by an active rule or authorised retained superseded-version work and is unrevoked, that creates a
**new** reset-delivery id for the same reset epoch with a fresh
20-attempt counter and 24-hour absolute deadline, while leaving the barrier closed until it succeeds. It never
turns the old dead letter retryable. MCP cannot resume a target. Revoking the target purges the barrier and all
waiting payloads instead of releasing them. Tests dead-letter a reset, restart the daemon, let later deliveries
expire behind the durable barrier, resume from the terminal/app, and prove no later CloudEvent crosses before the
new reset delivery. A shared-target test gives two rules different ordinary caps and retentions, removes them one at
a time, and proves the fixed reset charge is cap-exempt and is cancelled only after the final active reference ends.

Decision metadata has `metadataExpiresAt`, default 30 days or the approved shorter value, and `metadataState`.
At expiry one transaction appends a non-content purge tombstone, clears judge values/reasons and other expiring
metadata, and moves `metadataState` to `purged`; the minimal ids and uniqueness tuple remain so the event cannot be
evaluated again. No deadline ordering—hold, ingest, delivery, dead-letter or decision metadata—extends any other.

**Taint before every judge and disclosure.** Before **every** implemented judge call, before webhook network I/O,
and before appending a dry-run or SSE event to a readable log, the daemon takes the structured addresses, scoped
platform handles and prose-extracted addresses derived through D3 mapping provenance from the exact target-specific
value. It records structured values with location `source: "header"` and prose-extracted values with location
`source: "body"`; this existing `header | body` dimension remains the cap-priority signal
(`packages/core/src/taint.ts:141-155,285-304`). Each observation also has the orthogonal origin `"event"`.

Origins do **not** become fields inside the existing entries. They live in the owner-only sidecar
`<stateDir>/taint/origins.json`, whose `addresses`, `domains` and `handles` maps use exactly the canonical keys of
`taint.json` and `handles.json`; a sidecar value is `{ at, origins }`, with `origins` a sorted, duplicate-free subset
of `read | event`. This is required for mixed releases: core already explains that only a separate file survives a
writer that predates new entry data (`packages/core/src/taint.ts:189-197`), and the current `touch` reconstructs an
entry without unknown inner fields (`packages/core/src/taint.ts:307-313`). An older Gmail server can therefore
rewrite `taint.json` but never opens `origins.json`.

Every new event/read writer acquires the sidecar lock first and then the existing base taint lock, in that fixed
order, and holds **both locks through both atomic commits**: merge and commit `origins.json`, then merge and commit the
base taint files, then release the base lock and finally the sidecar lock. Only a writer that currently holds both
locks may identify and prune sidecar-only crash residue. A released older writer takes only the base lock, never
opens or prunes the sidecar, and therefore cannot deadlock with this order or erase an event origin. `flush` returns
only after both commits succeed while both locks are still held. Readers merge by canonical key: no sidecar entry means `origins: ["read"]`;
an entry returns its stored set; and a base `at` later than the sidecar `at` adds `"read"`, proving a legacy read
writer touched it without erasing `"event"`. Sidecar pruning follows the base store's same seven-day window and
per-map cap, retaining only keys that survive the corresponding base map or are about to be touched by this
transaction; a sidecar-only key from a crash is ignored and pruned on the next pass. Header-over-body priority and
account-id sets remain in the base entries. Event identity and channel are
deliberately **not persisted**. New ordinary collectors record `"read"`; existing stores with no sidecar decode as
read-only.

The daemon proceeds only after `flush` succeeds. On failure, nothing is posted, appended or called; the step remains
retryable. This preserves the current fail-closed collector contract (`packages/core/src/taint.ts:273-285,426-429`).
Migration tests cover old entries, mixed read/event merges and round trips, plus a published-old-writer `touch` over
an address with an event origin and prove the merged result retains `event`. Cap tests mix structured and prose
observations from both origins and prove header priority remains unchanged and neither an event id nor channel is
written. A deterministic two-new-writer test pauses writer A after its sidecar commit and before its base commit,
starts writer B, proves B cannot acquire the sidecar or prune A's row, then resumes both and observes the merged
`event` origin.

**Network resolution.** Every webhook or local-judge version carries an explicit, non-empty
`approvedAddressSet`: sorted literal IPs and CIDRs bound into its digest. On every connection—not only at approval—the
daemon resolves the original host itself, normalises every answer and refuses the whole attempt unless every resolved
address it could select falls inside that exact set. A literal-IP host still has a singleton set. Classification then
follows the current IANA IPv4 and IPv6 special-purpose registries, whose `Globally Reachable` field is the default
decision ([IPv4](https://www.iana.org/assignments/iana-ipv4-special-registry),
[IPv6](https://www.iana.org/assignments/iana-ipv6-special-registry)): a non-globally-routable address is refused unless
it is explicitly covered by the approved set and is not a metadata exception below. The daemon recursively unwraps
IPv4-mapped and IPv4-compatible IPv6, the active NAT64 prefix, 6to4 and Teredo forms and applies both membership and
reachability rules to every outer and embedded address; an unrecognised or ambiguous transition form is refused.
Public-to-private DNS rebinding therefore fails on the next attempt, and the set authorises addresses rather than a
hostname that may later resolve elsewhere.

Cloud metadata is the unconditional exception: `169.254.169.254`, `fd00:ec2::254`, and the IANA Link Local ranges
`169.254.0.0/16` and `fe80::/10` are refused even if present in an approved set; other IPv6 ULA
addresses remain non-globally-routable and require explicit inclusion, but the exact `fd00:ec2::254` metadata endpoint
can never be approved ([AWS EC2 metadata endpoints](https://docs.aws.amazon.com/AWSEC2/latest/UserGuide/instancedata-data-retrieval.html)).
The connector selects only a vetted resolved IP and pins the connection to it while retaining the original hostname
for TLS SNI and `Host`; redirects are never followed. The preview shows the scheme, original host, port, every
approved IP/CIDR and whether HTTP is permitted. Scheme is then checked independently of address-set membership:
webhooks use `https` for public and explicitly approved private destinations, while `http` is allowed only for a
literal `127.0.0.1` or `::1` webhook host that is itself in the approved set. `http://localhost`, any other hostname
that resolves to loopback, and every literal or resolved non-loopback private address over HTTP are refused even when
their addresses are approved. A `local-endpoint` judge is narrower: its URL must use `http`, its host must be the
literal `127.0.0.1` or `::1`, and that literal must be in its approved set; HTTPS, hostnames and non-loopback
addresses are refused for this judge kind. The hosted TypeSafe judge remains its fixed HTTPS endpoint. Tests include
the explicit webhook vectors: HTTPS public in its set accepts; HTTPS private in its set accepts; HTTP literal
loopback in its set accepts; HTTP hostname resolving to loopback refuses; and HTTP private literal/address refuses.

`target test` runs only for a target version referenced by an active rule, or from the terminal/app against a pending
version from the approval screen of a rule activation that references it. It sends exactly the catalogue's fixed
`io.agentcomms.test.v1` synthetic CloudEvent defined in D3, accepts no caller-supplied
content or field override, and runs the ordinary taint pipeline; the synthetic event has no taint declarations, so
there is nothing to record. A durable cap allows at most ten test attempts per rolling hour per target id across all
of its versions, charged before the attempt and not refunded on failure. It is separate from a rule's delivery cap and
creates no normal decision or delivery. MCP cannot test an unapproved target, so it cannot turn proposals into SSRF
probes.

**SSE authentication and CORS.** A fetch-streaming client sends `Authorization: Bearer <subscriber token>`. Native browser
`EventSource` is unsupported in version 1 because its constructor supplies no arbitrary Authorization header
([HTML Standard](https://html.spec.whatwg.org/multipage/server-sent-events.html)). Tokens never appear in query
strings or cookies. Requests with `Origin` are refused unless that exact origin is in the approved subscriber
version. For an approved exact Origin, `OPTIONS /v1/streams/<subscriber>` answers only a requested `GET` with
`Access-Control-Allow-Origin: <that exact origin>`, `Access-Control-Allow-Methods: GET`,
`Access-Control-Allow-Headers: Authorization, Last-Event-ID` and `Vary: Origin`; it never emits
`Access-Control-Allow-Credentials`, never uses `*`, and refuses any other requested method/header or unapproved
Origin. The GET repeats the exact allow-origin response and browser clients use `credentials: "omit"`. This narrow
preflight is required because `Authorization` is not CORS-safelisted ([Fetch Standard](https://fetch.spec.whatwg.org/#http-new-header-syntax)).
`Host` is checked against the listener's fixed local authority. Every accepted stream is bound to the exact token
generation with which it authenticated. Under the subscriber-rotation mutex, one transaction installs the new
generation, invalidates the old and marks every registered older-generation live stream closed; its commit aborts
those sockets before rotation returns. The stream append/send path holds the same serialisation point and checks the
bound generation immediately before every frame, so no old-generation client receives a post-rotation event. Token
rotation does **not** purge retained entries or create a new subscriber version; a client authenticated with the new
generation may replay them. Revoking the subscriber version denies access, closes all of its live streams and purges
its entries in the revocation transaction.

### D8. Durable ingest, decisions and outboxes

One SQLite database, `<stateDir>/events/events.sqlite`, is owned only by `agent-events run`:

- `meta(key PRIMARY KEY, value)` holds the schema version, reset epoch and D3 `installationId`;
- `event_settings(singleton, enabled, switchGeneration, changedAt, activationId?)` — the authoritative global
  switch and generation fence, not an immutable versioned object;
- immutable `rule_versions`, `target_versions`, `subscriber_versions`, `judge_versions` and
  `judge_budget_versions`, each holding its full canonical document and digest. `rule_versions` additionally has
  nullable lifecycle columns `state`, `approval_id`, `authorization_activation_id`, `activated_at`, `superseded_at` and
  `revoked_at`: `state`, when present, is constrained to the exact enum `active | superseded | revoked`; an inert
  never-activated version has all six null and therefore no lifecycle state. Activation fixes the approval and
  authorisation-activation ids on that version permanently, so superseded workers can validate its lineage without an
  active-pointer lookup. Exactly the version named by a rule row in
  `active_versions(kind, objectId, version, currentCutoverId?, activatedAt)` is `active`; an exact replacement's swap changes its predecessor to
  `superseded`, while a tightening, disable or remove changes the displaced version to `revoked`. `superseded_at` is
  set only on the transition to `superseded`; `revoked_at` is set only on the transition to `revoked`, including a
  later explicit revocation of a superseded version. `active_versions` permits only rule pointers and the singleton
  judge-budget pointer. A rule version's `authorizationActivationId` is immutable lineage: the exact activation
  intent id, or its canonical version id for a derived tightening. Every active rule pointer separately has one
  mutable `currentCutoverId` selecting the `rule_activation_points` rows workers must use now. First activation and
  exact replacement initialise it, a derived tightening replaces it with the copied version-id set, and every
  `enable-all` replaces it with that enable intent's fresh points without changing the rule version's immutable
  authorisation lineage;
  `derived_authorizations(versionId PRIMARY KEY, parentApprovalId, parentVersionId, editKind, createdAt)` stores each
  no-approval rule-tightening edge created atomically with its new version and pointer; a derived rule uses its
  canonical `versionId` as `authorizationActivationId`, while an exact activation uses its intent id; exact activations
  and derived rows together must form D2's complete acyclic lineage to the approval named by the bound
  `rule_versions.approval_id`. The pointer does not copy either immutable lineage id, and `currentCutoverId` may
  differ from `authorizationActivationId` after any enable-all cycle;
  `object_revocations(kind, objectId, version, revokedAt)` carries immediate target/subscriber/judge revocations;
  durable `activation_intents` store the canonical activation kind/document/effect, an optional exact
  `replacementOfVersion`, its exact required rule points and deduplicated acquisition-call scopes, closed status
  `pending | pending-completion | completed | failed | cancelled`, nullable
  `claimedAt`/`completionDeadline`, stable terminal failure code and timestamps, and `activations`/`revocations` are
  append-only. A unique partial index permits at most one `pending | pending-completion` replacement per rule; a
  second is refused as `REPLACEMENT_PENDING` until the first is completed, failed or cancelled. `claimedAt` is
  byte-for-byte core's disclosure `usedAt`, and `completionDeadline` is always that instant plus one hour;
- `cursors(source, accountId, cursorScope, cursor, updatedAt, PRIMARY KEY(source, accountId, cursorScope))` and
  `source_scan_state(id PRIMARY KEY, source, accountId, cursorScope, encryptedRecord, updatedAt)` hold encrypted source-specific
  acquisition continuation, raw pages/occurrences, Gmail metadata-read retry state and staging. Gmail has exactly one
  `cursorScope = "mailbox"` row per account and never an event-type or rule cursor. Content-free
  `source_occurrence_resolutions(source, accountId, occurrenceKey, outcome, resolvedAt, errorCode?,
  PRIMARY KEY(source, accountId, occurrenceKey))` permits only Gmail's terminal `vanished | unresolvable` outcomes;
  the latter has one matching source-gap record. Content-free
  `source_projection_resolutions(source, accountId, occurrenceKey, ruleId, ruleVersion, materializationKey, outcome,
  resolvedAt, errorCode?, PRIMARY KEY(source, accountId, occurrenceKey, ruleId, ruleVersion,
  materializationKey))` holds D3's Gmail/Resend required-lazy-field terminal `vanished | unresolvable` outcomes;
  `materializationKey` is the lowercase SHA-256 of the sorted required lazy-field names, never fetched content.
  Retry state including the original `firstFailedAt` remains encrypted in `source_scan_state`; one unresolvable
  source occurrence has one matching content-free source-gap record even when several affected projections resolve.
  Page/final cursor commit requires every staged occurrence before it to be ingested, skipped by classification, or
  for every otherwise eligible projection to be present in the applicable terminal-resolution table;
- append-only `rule_activation_points(activationId, ruleId, ruleVersion, source, accountId, positionScope,
  encryptedPosition, inheritedFromVersionId?, createdAt,
  PRIMARY KEY(activationId, ruleId, ruleVersion, accountId, positionScope))` holds D4's immutable per-rule-version
  authorisation fences. `positionScope` is `mailbox` for Gmail, a Slack conversation id, `received` or `status` for
  Resend, and a WhatsApp chat id. A derived version's rows copy the parent's positions and name that parent; exact
  activations and `enable-all` rows name no parent. A source worker reads the rule pointer and its
  `currentCutoverId`, then selects only rows with `activationId = currentCutoverId` in the same snapshot; it never
  substitutes the version's immutable `authorization_activation_id`. No account/type epoch table exists;
- `activation_baselines(intentId, source, accountId, positionScope, encryptedPosition, responseAt,
  PRIMARY KEY(intentId, source, accountId, positionScope))` holds D12's staged cut-over positions for every exact
  rule activation or `enable-all`, and is deleted only by successful finalisation, terminal failure or cancellation.
  A Gmail response is staged once by `(intentId, "gmail", accountId, "mailbox")` and may populate several
  per-rule-version rows in finalisation without replacing the mailbox acquisition cursor. For a replacement these
  rows are the P vector over the union of old and new scopes. Durable
  `replacement_drains(intentId, source, accountId, positionScope, oldInScope, newInScope, drainedAt?,
  PRIMARY KEY(intentId, source, accountId, positionScope))` installs P as the old version's inclusive upper fence,
  records when the complete scope barrier reaches P and keeps after-P occurrences staged until the atomic swap.
  For Slack, `slack_reply_drains(intentId, accountId, conversationId, threadTs, cursor, coveredThrough,
  drainedAt?, PRIMARY KEY(intentId, accountId, conversationId, threadTs))` durably enumerates every seven-day-eligible
  thread found at or below P. The parent conversation row's `drainedAt` is null until its top-level cursor and every
  such independently paginated reply row have covered P; budget deferral or 429 leaves the relevant child and the
  aggregate parent open;
- content-free `ingest(eventId UNIQUE, installationId, type, version, accountId, dedupeKey, occurredAt, observedAt)`
  plus `ingest_rules(eventId, ruleId, ruleVersion, decisionDeadline, encryptedProjection,
  PRIMARY KEY(eventId, ruleId, ruleVersion))`. Each projection contains
  only the concrete fields referenced by that rule version's deterministic conditions, judge inputs and mapping;
- `decisions(id PRIMARY KEY, eventId, accountId, ruleId, ruleVersion, outcome, holdExpiresAt?, metadataExpiresAt, metadataState,
  purgedAt?, encryptedRecord?, UNIQUE(eventId, ruleId, ruleVersion))`, where the optional record holds the expiring
  judge result and reason rather than placing them in plaintext columns;
- `deliveries(id PRIMARY KEY, decisionId, accountId, ruleId, ruleVersion, targetKey NOT NULL, targetId, targetVersion,
  subscriberId?, subscriberVersion?, judgeId?, judgeVersion?, encryptedRecord, attempts, capChargedAt?, nextAt,
  expiresAt, state, switchGeneration, leaseUntil, lastErrorCode?, lastStatus?, UNIQUE(decisionId, targetKey))`, where
  `lastErrorCode` is a closed stable enum and `lastStatus` is an integer HTTP/provider status; `targetKey` is exactly
  `dryrun:<targetId>:<targetVersion>`, `webhook:<targetId>:<targetVersion>` or
  `sse:<targetId>:<targetVersion>:<subscriberId>:<subscriberVersion>`. `state` is the closed enum `queued |
  retryable | disclosing | delivered | dead-lettered | retention-expired | cancelled | content-unreadable |
  in-flight-at-disable | in-flight-at-account-removal`; waiting behind a cap or reset barrier remains `queued` with
  its original deadline;
- `dryrun_log(deliveryId PRIMARY KEY, ruleId, ruleVersion, targetId, targetVersion, judgeId?, judgeVersion?, eventId, accountId,
  encryptedRecord, deliveredAt, expiresAt)` uses the same packed encrypted-record format and has a hard validated
  maximum lifetime of 24 hours;
- `stream_log(id PRIMARY KEY, ruleId, ruleVersion, targetId, targetVersion, subscriberId, subscriberVersion, judgeId?,
  judgeVersion?, eventId, accountId, encryptedRecord, deliveredAt, expiresAt)`;
- `judge_budget_reservations` with D5's closed `reserved | in-flight | settled | released` state, stable rule-id,
  provider/global ledger keys, exact rule/budget versions, estimated/actual input tokens and concurrency ownership;
  durable rolling `judge_test_charges(judgeId, judgeVersion, chargedAt)`, `delivery_cap_charges`, worker leases and
  content-free `work_attempts`, each binding the switch generation under which asynchronous work began. Any
  provider/target error text—including text that reflects a request payload—lives only inside the owning encrypted
  record; every similarly named plaintext status/error column is restricted to a closed code and numeric status; and
- `reset_barriers(resetEpoch, targetId, targetVersion, state, resetDeliveryId, degradedAt?)`, reset-delivery attempts,
  target health, target-level reset notices and account-revocation tombstones needed to enforce D7's ordering
  barrier; and content-free `operational_records` for the `agentcomms.*` health names D3 exposes only through the app
  and `doctor`. No operational record has an ingest, decision or delivery foreign key.

`eventId` is D3's deterministic id and `UNIQUE(eventId)` is the ingest idempotency boundary. On a conflict, the
transaction compares the stored `(installationId, accountId, type, version, dedupeKey)` with the canonical identity:
an equal tuple is a repeat; a different tuple is a fatal `event_id_collision`, leaves the source cursor unchanged and
degrades that source rather than merging events. Cross-account and forced-hash-collision tests cover both branches.

For one provider occurrence, the full normalised source event exists only in process memory. The source computes the
exact active-rule snapshot plus any old active version bounded by a nonterminal replacement drain, then applies
source-option and lower/upper-point filtering. It takes the union of fields those eligible rules require and fetches a
body or file metadata only when at least one such rule requires it. It then builds one minimal projection per eligible
rule version by retaining only that rule's condition paths, judge-input paths and mapping paths; parent references
retain the referenced subtree, never unrelated siblings. A required lazy fetch that has not succeeded or reached
D3's terminal protocol keeps the cursor in place. Once every eligible projection is ready or terminally resolved,
one transaction inserts the content-free identity, every successful encrypted projection, every new content-free
projection resolution and the cursor advance together. A metadata-only projection can therefore succeed beside a
body-dependent projection that resolves `vanished` or `unresolvable`, without either losing cursor atomicity or
retaining the unavailable body. No shared encrypted full event is written. A superseded version
is never selected for a new projection after the swap, but work already bound to it remains authorised.

The `ingest.occurredAt` and `ingest.observedAt` values are immutable parts of that identity tombstone. For D3's
Gmail-label and Resend-status occurrences without provider timestamps, source staging supplies the one sampled
observation time as both values; replay, re-evaluation and every regenerated CloudEvent read it from `ingest` rather
than the clock. A retry before ingest commit reuses the staged value. A crash after ingest commit therefore cannot
change `occurredAt`, the canonical envelope body or its Standard Webhooks signature input.

Each `ingest_rules` projection has only that rule's approved `decisionDeadline`. Evaluation first computes the
terminal outcome and, for a match, the **complete delivery set for every matched target** in memory from that retained
projection: mapping, provenance, CloudEvent bytes, target keys, exact bound versions, deadlines and encrypted payloads
are all ready before the write transaction begins. One SQLite transaction then (1) inserts the one terminal
decision, (2) inserts every delivery in that complete set, and only then (3) purges that rule projection. A no-match,
`retention-expired` or resolved `hold-expired` terminal outcome uses the same transaction with an empty delivery set.
A nonterminal held decision retains its projection until the later resolution transaction can perform this sequence.
There is no committed state in which a terminal matched decision exists without all of its target deliveries, or in
which the projection is gone before their creation.

This atomic boundary is per `(eventId, ruleId, ruleVersion)` and independent of every other rule over the event. The
content-free `ingest` identity remains only as the uniqueness tombstone while any projection or decision needs it.
Thus a one-hour body rule cannot cause a 24-hour metadata-only rule to retain the body, and the latter cannot extend
the former. A crash before the transaction commits—including after the decision insert, after any individual
delivery insert or after the projection delete inside the uncommitted transaction—rolls the whole transaction back
and re-evaluates from the retained projection. A crash after commit finds the decision, complete unique delivery set
and purge together. Delivery retries use the stored payload and exact versions; they never re-evaluate, re-map or
re-ask a judge.

**One encrypted-record format.** Every encrypted column in every table—including source scan staging—contains one
packed byte string and no sibling nonce/tag columns:

```text
u8 formatVersion (= 1) | u8 keyIdLength | keyId UTF-8 | 12-byte random nonce | ciphertext | 16-byte GCM tag
```

`keyId` is non-empty ASCII and at most 255 bytes. **Every encrypted column uses one canonical, injective AAD
encoding:**

```text
AAD = "aec-v1" || lp(tableName) || lp(columnName) || u8(componentCount) ||
      for each primary-key component in that table's declared key order:
        u8(typeTag) || value
```

`"aec-v1"` is its ASCII byte sequence and `lp(x)` is the four-byte big-endian unsigned length of `x`, followed by
`x`. `tableName` and `columnName` are their UTF-8 bytes. `componentCount` is the number of declared primary-key
components and is refused if it cannot fit in `u8`. The component encoding is: `0x01` SQLite `INTEGER`, followed by
its eight-byte big-endian two's-complement value; `0x02` `TEXT`, followed by `lp(UTF-8 bytes)`; `0x03` `BLOB`,
followed by `lp(bytes)`; or `0x04` `NULL`, with no value. A `NULL` primary-key component is otherwise refused for an
encrypted row, so `0x04` is never emitted or accepted for the encrypted tables below. SQLite storage class, not a
coerced display value, chooses the tag: INTEGER `1` and TEXT `"1"` are different AAD inputs.

The declared primary-key order for each encrypted column is:

| Encrypted column | Table primary-key components, in AAD order |
|---|---|
| `source_scan_state.encryptedRecord` | `id` |
| `rule_activation_points.encryptedPosition` | `activationId`, `ruleId`, `ruleVersion`, `accountId`, `positionScope` |
| `activation_baselines.encryptedPosition` | `intentId`, `source`, `accountId`, `positionScope` |
| `ingest_rules.encryptedProjection` | `eventId`, `ruleId`, `ruleVersion` |
| `decisions.encryptedRecord` | `id` |
| `deliveries.encryptedRecord` | `id` (including a reset-delivery row) |
| `dryrun_log.encryptedRecord` | `deliveryId` |
| `stream_log.encryptedRecord` | `id` |

`source_occurrence_resolutions` and `source_projection_resolutions` are explicitly content-free: neither has an
encrypted column and neither receives AAD. Their declared key orders are respectively `(source, accountId,
occurrenceKey)` and `(source, accountId, occurrenceKey, ruleId, ruleVersion, materializationKey)`; those composite
keys therefore cannot be silently substituted for an encrypted row key. The secret store holds versioned random
256-bit installation master keys. Each table subkey is 32 bytes derived with
HKDF-SHA256 from the named master key, an empty salt and info exactly `agentcomms-events/<table>/v1`; a record's key id
selects the master version, never appears in the HKDF info, and secrets never enter SQLite.

Nonces are 96 random bits from the OS CSPRNG. A durable counter per `(keyId, table)` refuses the 2^32nd encryption and
forces rotation beforehand; NIST's limit is 2^32 authenticated-encryption invocations for an RBG IV construction,
not a claim that random IVs can never collide ([NIST SP 800-38D §8.3](https://nvlpubs.nist.gov/nistpubs/Legacy/SP/nistspecialpublication800-38d.pdf)).
Rotation creates a new random master key and id, makes its derived subkeys current for new records, rewrites old
records transactionally in bounded batches and retains old key versions until no record names them. Authentication
failure makes exactly that record unreadable and records terminal `content-unreadable` for its owning work in the
same transaction: ingest and decision failures terminalise and purge all derived payloads, delivery failures purge
that delivery, dry-run/stream-log failures purge that readable row, reset-delivery failures degrade and keep the
barrier closed, and source-scan failures abandon and purge the staged cycle before re-baselining with a gap. None is
retried from unreadable bytes. An unknown key id or loss of a master key
invokes the installation reset below. SQLite, WAL and free-page scans must never find fixture plaintext.

**Installation identity and reset.** On the first daemon start for a database, it generates a random 128-bit
`installationId`, writes it to `meta` before polling, and keeps it across ordinary restarts, schema migrations and a
database backup/restore. A newly created database always gets a new id. If the database is recreated or any referenced
master key is lost, the daemon performs a reset rather than falling back to plaintext or reusing the old id: it
installs a new master key and 128-bit id, terminalises and purges unreadable work, re-baselines every live source
cursor to provider “now” and records a fresh point for every active rule version/account/scope (while retaining one
cursor per Gmail mailbox), and creates D6's fixed target-level reset notice while recording the reset for the app and
`doctor`.
It creates D7's durable per-target reset barriers before ordinary delivery creation resumes. A failed reset never
permits later content to overtake it: dead-lettering marks that target version degraded, and later rows wait behind
the barrier and retain their original expiry until a person runs `target resume` and a new reset delivery succeeds.
If database recreation removed all targets, the reset epoch remains in `meta`; each subsequently authorised target
receives a barrier and reset notice before its first provider-event delivery. No provider event from before the new
baselines is backfilled.

While evaluation is paused by the required-update gate, source polling pauses as well: the daemon never advances
cursors while it cannot decide retained events. `rule test` has the zero-network contract in D10 and never performs a
fresh provider read.

Workers claim rows with expiring leases. On restart an expired lease returns to its prior retryable state only when
its switch generation is still current and its bound rule version is not revoked; older-generation or revoked work is
terminal. Ordering, when enabled, is only by `(rule, account, target)`, so one failing destination does not block
another. Immediately before judge or delivery I/O, one SQLite transaction re-reads `event_settings`, the bound rule
version's `state` and complete exact-or-derived authorisation lineage, every referenced object's revocation state and
D9's live account, checks the reset barrier and deadline, and moves the row to its boundary
state. For a webhook's first attempt it also writes the one cap charge and `capChargedAt`; retries reuse it. A failed
fence reaches `cancelled` or `retention-expired` and purges the encrypted record in that transaction; both `active`
and `superseded` pass the rule-version fence, and only `revoked` fails it. The current active pointer is not consulted
for already-bound work. A closed reset
barrier leaves non-expired ordinary work waiting without crossing the boundary.

A dry-run or SSE append is the delivery boundary: one transaction repeats the
switch-generation/bound-version/object-revocation/live-account/barrier checks, charges the cap if not already
charged, appends the encrypted row and marks the delivery delivered. Reading a dry-run row or replaying an SSE row
checks those same fences and retention but creates no delivery and consumes no cap. Each row stores all rule,
target/subscriber and optional judge versions under which it was made; supersession retains matching rows, while
revoking any one bound version purges matching rows in the same transaction.
Subscriber-token rotation changes only the secret generation, invalidates the old token, closes every live stream
bound to an older generation under D7's fence and retains those rows for a newly authenticated client.

Every provider poll, judge request, webhook attempt and dry-run/SSE append starts under a recorded switch generation.
Every commit after the provider/judge/webhook network operation, and each append commit itself, compares it with the
current generation. A mismatch records terminal `cancelled`, or preserves `in-flight-at-disable` when the row had
already crossed `disclosing`; it releases reservations, purges payloads and can never create retryable work. The
disable and re-enable protocol that advances this fence is D12.

Decision metadata defaults to 30 days; ingest content, holds, delivery, dry-run and SSE replay default to 24 hours;
dead-letter payload retention defaults to seven days. The person may shorten any retention through D2's whitelist;
validation still enforces `hold <= ingest`. Raising one needs a new standing authorisation. Expiry workers use
database time/deadlines, D7's decision-metadata purge transition and terminal payload transitions, not best-effort
deletion jobs.

### D9. Authoritative event state and the config boundary

`config.json` gains **no `events` key and carries no event state**. Rules, targets, subscribers, judges, every
immutable version, rule-version lifecycle state, rule/budget active pointer and object revocation, source cursors, the global switch, activation
intents, activations and revocations live only in D8's daemon-owned SQLite database. Event secret references live in
the relevant SQLite version/generation/meta rows; secret bytes live in the daemon's independent event secret store
below.

The existing config remains necessary for connected inbox/account identity and provider credentials, the chosen
secret-store backend, and ordinary send/change policies—but core's `config.secrets.store` applies only to core and
channel credentials. Event sources refer to accounts by stable id and never copy credentials. The daemon watches that
registry by repeatedly calling the core `ConfigStore.load()`; its existing cache keys the file by inode, mtime and
size, reparses after an atomic replacement and returns a fresh clone (`packages/core/src/config.ts:845-870`). The
daemon must use that store directly rather than introduce an account identity cache of its own.

**An independent event secret store.** The events daemon owns one backend selection in SQLite `meta`, independent of
`config.secrets.store`. The default is `keychain`; its namespace is
`${keychainNamespace(resolvedConfigDir)}:events`, using the same service and 12-hex config-directory derivation as
core but an events suffix, so no core reference can collide (`packages/core/src/secrets.ts:175-188,251-254`). The
alternative `file` backend is `<stateDir>/events/secrets/`, an owner-only directory containing one 0600 file per
hashed reference on POSIX and an owner-only ACL equivalent on Windows. There is no fallback between them. A failed
first keychain round-trip stops and tells the person to choose the file backend; no core config value is read or
written when selecting it.

SQLite is the reference ledger: while holding `<stateDir>/events/secrets.lock`, the daemon derives the complete,
sorted reference set directly from immutable versions, pending operations and all retained master/signing/token/key/
URL generations. There is no `secret-refs.json`. Creating or rotating a rotatable event credential—or creating the
new slot for a new secret-URL target version—uses only this lock: write and verify the secret in the selected events
backend, then commit the SQLite row/generation that names it;
on failure restore the prior bytes or remove the unreferenced new value. Removal first commits that no SQLite row or
pending operation names the reference, then deletes it. Startup compares the database-derived set with the selected
backend, refuses collection for a missing referenced value and removes an extra value only when the database proves
it unreachable.

`agent-events secrets migrate --to keychain|file` and the paired app operation are terminal/app-only human
exceptions. Under the events lock they snapshot the database-derived reference set, copy and read-back-verify every
value, atomically change the `meta` backend selector, then remove the old copies; before the selector commit any
failure rolls back new copies, and after it any failed cleanup is reported as a harmless named leftover that a retry
cleans. Creation and rotation cannot interleave with the snapshot. The command never takes core's credentials lock,
changes `config.secrets.store` or opens core's namespace/directory. Conversely, core's `agentcomms secrets migrate`
and `comms_secrets_migrate` never enumerate, copy, delete or select the events backend. A compatibility test creates
every event-secret kind, runs the prior released core binary to migrate core in both directions, restarts the new
daemon and proves all event secrets are still readable; separate tests cover both event migration directions,
concurrent event creation/rotation, rollback and leftover cleanup.

On a stable account id's disappearance, the daemon takes the account-revocation lock and runs one SQLite transaction
that records the revocation; cancels and purges every queued/retryable delivery for that account; marks held decisions
`cancelled`; marks an already `disclosing` delivery terminal `in-flight-at-account-removal` and purges its retained
record; purges retained dead-letter payloads; releases its judge reservations; purges its dry-run and stream rows,
source staging, cursors, source occurrence/projection resolutions, rule activation points for that account and ingest
records; and
revokes every active rule version whose source scope names only that account. A multi-account rule remains active
for its other live ids but can no longer poll, judge or disclose the missing one. An in-flight completion that lands
after this transaction must re-read the live config: it records terminal `cancelled` (or the delivery's already
crossed `in-flight-at-account-removal` outcome), creates no replacement payload and is never re-queued.

Live account existence is also a mandatory fence in every transition to `disclosing`, every dry-run/SSE append
transaction and every dry-run read or SSE replay request. Source commits and judge-result commits load the live
registry too. The race is
linearised at that final load: work that crossed its boundary while the id was still present is recorded in flight and
cannot be recalled; work whose fence observes the disappearance terminalises itself. Once the watcher has observed
the removal and committed its revocation transaction, no cached identity can let later work cross.

The required core changes are exactly:

1. Add `disclosure` to `ApprovalKind` and replace the flat send-shaped `ApprovalRecord` with the discriminated union
   in D2, including `DisclosureBinding`, strict persistence parsing, public views, list/revoke support and
   old-record compatibility (`packages/core/src/approvals.ts:43-54,302-335`).
2. Add `app` to `ApprovalChannel`/`approvedVia`; implement `createDisclosure`, `approveDisclosure` and
   `claimForDisclosure`; add disclosure-specific challenge, state, cancellation and refusal paths; atomically write
   immutable `usedAt` on the disclosure claim and return it from that claim; and make all kind checks exhaustive.
   Existing terminal approvals are unchanged, and `app` is only the Rust-mediated typed challenge—not a
   trusted-client/MCP form (`packages/core/src/approvals.ts:446-450,622-640,899-903`).
3. Add `app` and `daemon` to `AuditRecord.surface`, whose current union is `cli | mcp`, and add `origin` naming the
   requesting client surface from the same `cli | mcp | app | daemon` union. A synchronous client-boundary record uses
   that client's `surface` and `origin`; autonomous work uses `surface: "daemon", origin: "daemon"`; later daemon
   execution requested by a CLI, MCP or app client uses `surface: "daemon"` with that client in `origin`
   (`packages/core/src/audit.ts:20-35`).
4. Keep the existing taint location `source: "header" | "body"` and add observations plus D7's `taint/origins.json`
   sidecar and merged reader. A new writer takes the sidecar lock, then the base lock, and holds both through both
   commits; only that dual-lock writer prunes sidecar-only residue, while an old writer takes only the base lock.
   Decode a missing sidecar entry as `["read"]`, preserve an event origin across an old writer's reconstructed entry,
   and preserve header priority and current account-id behavior (`packages/core/src/taint.ts:189-197,285-313`).

That is the complete core integration; it is not merely a set of union edits. No `event` member is added to `TaintSource`, and
no existing form is reclassified as terminal approval. Core's secret migration is deliberately unchanged: the events
daemon owns its separate store, selector, lock and migration.

`classifyChange` does not learn an events field and its existing safety fields stay unchanged
(`packages/core/src/config.ts:1375-1483,1487-1548`). This keeps standing authority out of a file whose current commit
primitive is an atomic rename (`packages/core/src/config.ts:949-951`) and makes every event tightening, cancellation
and dry-run/SSE purge one SQLite transaction.

There is no mutable "current target" behind a delivery. SQLite has active pointers only for rules and the singleton
budget; queued rows hold an exact rule version plus exact target/subscriber/judge versions and consult lifecycle state,
object revocations and the switch generation rather than following the active pointer. **A new object version does
nothing until each intended rule is re-approved with it; superseding a rule retains its already-bound work, while a
no-approval revocation cancels affected work and purges its encrypted dry-run/SSE content in one store.** No older-release config compatibility fixture is needed for
event configuration, but the explicit prior-core secret-migration fixture above is required because core and events
must remain independent under mixed installed versions.

### D10. Control surfaces and parity

Every capability is one operation in `packages/events-daemon/src/operations` and has a `capabilities.json` row.
Non-exceptions are exposed by both the `agent-events` CLI and MCP server; the table also includes the human-only
exceptions identified below:

| Area | Operations |
|---|---|
| Catalogue | `catalogue list`, `catalogue show <type>` |
| Sources | `sources list`, `source show` |
| Rules | `rules list`, `rule show`, `rule create|update|enable|disable|remove`, `rule test` |
| Targets | `targets list`, `target add|update|remove`, `target test`, `target resume` |
| Subscribers | `subscribers list`, `subscriber add|update|remove` |
| Judges | `judges list`, `judge add|update|remove`, `judge test`, `budget show|update` |
| Deliveries | `deliveries list`, `delivery retry|drop`, `held list|decide` |
| Dry-run log | `dryrun list|show` |
| Secrets | `target secret create|rotate <targetId>`, `target url set <targetId>`, `subscriber token create|rotate`, `judge key set|rotate <judgeId>`, `secrets migrate --to keychain|file` |
| Daemon | `status`, `run`, `stop`, `pause|resume`, `disable-all|enable-all`, `approve <id>`, `doctor` |

The parity `rule test` operation accepts only catalogue examples, including from MCP, and may evaluate a disabled or
unapproved rule because it has a strictly local contract. It evaluates only deterministic conditions and the mapping;
an agentic node is reported `not-evaluated`. It never accepts an event/account id, reads ingest, calls a judge,
provider or target, advances a cursor or creates a decision/delivery. Returned example and mapped values are
sanitised and enveloped regardless of the pending target's representation.

`rule create`, `rule update` and both test forms accept only provider-source definitions from D3. Any type beginning
`agentcomms.`—including every known operational record name and an unknown future one—is rejected as
`EVENT_TYPE_NOT_SELECTABLE`; it cannot be smuggled through a target test or a saved older document.

Testing a rule against retained ingest is a separate `rule test-retained <eventId>` operation available only from a
human terminal or the app. Its `capabilities.json` row is `status: "exception"` with the reason “retained sender
content may be selected only by a person outside model context”; it is absent from MCP and refuses a non-TTY or agent
marker. It checks D9's live account before reading, renders sender content with the safe terminal/app renderer, takes
no account argument and does no provider, judge or target I/O.

`judge test` may call only a judge version referenced by an active rule. The terminal or app may test a pending judge
from the approval screen only as part of a pending **rule activation that references that exact judge version**; MCP
and ordinary CLI calls cannot. The same rule applies to **every** real implemented judge call. It sends only D3's
fixed `io.agentcomms.test.v1` synthetic value, accepts no caller content or field override, runs the ordinary taint path
(with no observations for this synthetic event), consumes one of the durable ten-per-hour charges for that exact
judge version and reserves against the active singleton budget's global call/token/concurrency ceilings as D5
specifies. It has no rule or per-judge limits to invent, and does not charge a per-provider ceiling. The call and
actual/reserved tokens are charged and never receive a testing exemption. `target test` keeps the equivalent
rule-activation restriction and fixed event, taint behavior and ten-per-hour per-target cap in D7.
Automated tests inject every provider/judge/target transport and fail on any real socket; they prove an unapproved
`rule test` or `judge test` makes zero network calls. An approved `judge test` and permitted `target test` make only
the one bounded synthetic call specified above.

MCP can otherwise read and propose disabled, secretless versions. It cannot approve or claim a disclosure
authorisation, resolve a held model decision, test an unapproved target/judge, or accept/return/reveal/rotate a
secret. It also cannot read `dryrun_log`, run `target resume` or migrate the event secret backend. Each D2 secret
operation is a distinct `status: "exception"` capability row, not a grouped undocumented escape hatch; the parity
checker asserts that its CLI operation exists and that its MCP field is deliberately absent with the stated reason.
The paired terminal commands and dedicated-secret-window operations use the same daemon operation, but no secret
operation is registered in the MCP server. The other human-only operations each get a `status: "exception"` row;
dry-run reads specifically say that retained sender content must pass through the terminal/app untrusted renderer,
and secret migration says it moves daemon credentials under the daemon's own lock. `run` is also an exception because
a tool cannot start the server in which it runs. The
precedent for visible exceptions and same-operation parity is
`docs/superpowers/specs/2026-09-25-cli-mcp-parity-design.md:164-168` and `capabilities.json:241-254`.

`budget update` creates a pending immutable singleton version and preview from either surface, but only the terminal
or app can approve and activate it. Its digest contains all daemon-wide and per-provider ceilings. Rule operations
reject any attempted provider/global budget field; a rule carries only D5's per-rule limits.

The first call that activates a rule or budget, or enables all, returns `standingApprovalRequired`, its activation
kind, a `disclosure` approval id, digest and complete preview. A repeated MCP call cannot claim it. The terminal/app
approval operation re-plans under the daemon activation lock, refuses kind/version-list/digest drift and runs D2's
intent → core claim → SQLite activation protocol.
`doctor` reports daemon/protocol health, global switch, every active exact approval or complete derived lineage with
its immutable authorisation-activation id, the active pointer's `currentCutoverId` and exactly the per-account/scope
points selected by that current id, every superseded version that still owns retained work, pending activation and
pending-completion intents (including any claimed rule replacement draining to P or `enable-all` activation awaiting
source positions), terminal failed activations and their audit code, Gmail metadata-read and Gmail/Resend lazy-
materialisation retry age plus `vanished`/`unresolvable` counts and last resolutions, and source lag,
leases, held decisions, dead letters, retention deadlines and missing secrets.

The `agentcomms-events` skill teaches an agent to propose and test a disabled rule, explain both untrusted
representations, and hand the approval id to the person. It never instructs the agent to type or request a secret.

### D11. Judges: hosted Jev and local endpoints

| Kind | Contract | Disclosure |
|---|---|---|
| `typesafe` | Jev through `POST https://api.typesafe.ai/v1/systemone`, using provider-native Noul output. It is **treated as hosted-only under currently published artefacts and terms**; this is not a claim that local Jev is impossible. | Exact approved input fields leave for the approved host. |
| `local-endpoint` | An approved `http` Ollama/System One endpoint or generic JSON-output model whose URL host is the literal `127.0.0.1` or `::1`; hostnames, HTTPS and non-loopback addresses are refused. Generic numbers are uncalibrated scores. The endpoint gets D7's per-connection resolution, address-set binding and redirect refusal; pending endpoints cannot be reached from MCP tests. | Only the explicitly approved literal loopback address; D7 taint still flushes before every call. |

Every judge is immutable and versioned. No hosted or local judge may first acquire work until an active rule
activation references that exact judge version, except for one terminal/app call made inside that pending rule
activation's approval screen as D10 defines. Already-created work bound to a superseded, non-revoked rule version may
still make its judge call under D8's version-and-generation fence. A hosted judge additionally needs its key
completed by a person. "Never use judges"
and revoking a judge are immediate whitelist tightenings: the transaction records the revocation, cancels and purges
queued work, and purges dry-run/SSE rows whose decisions used it. Prompt injection can change only the model's
bounded score/reason code; it cannot change rules, mappings, targets or authority. A bundled judge is deliberately
deferred to D15.

### D12. The daemon: one owner, one authenticated protocol

Only `agent-events run` opens the events database or provider sessions. Every other CLI command, the MCP server and
the Rust app are clients of a local versioned control protocol.

On Unix the socket is inside a `0700` directory, the socket/token files are owner-only, and the daemon verifies peer
credentials have the same uid. On Windows it uses a named pipe whose ACL grants only the current user's SID. The
random token is a second check on both platforms and is never logged or returned to a model. Event database, lock,
token and state files receive an owner-only Windows ACL rather than relying on POSIX mode numbers.

Protocol frames are length-prefixed JSON. A client first sends `hello { supportedVersions, token, client }`; the
daemon selects one mutually supported version or returns `PROTOCOL_UNSUPPORTED`, then issues an in-memory session id.
Every request carries `{ version, requestId, session, operation, args }`; an unknown/expired session is
`AUTH_REQUIRED`. Replies are `{ ok: true, requestId, data }` or
`{ ok: false, requestId, error: { code, message, hint?, retryable, details? } }`. Error text controlled by a provider
or target is separately marked untrusted as D3 requires.

The instance record contains pid, process-start identity, socket/pipe name and a token fingerprint. A new `run`
probes the socket with the stored token: a successful hello means another daemon owns it; a dead pid plus failed
authenticated probe permits same-user stale lock/socket recovery; a live pid or ownership mismatch refuses recovery
and `doctor` explains it.

Closing the settings window leaves the tray app and daemon running. Quitting the tray app stops the daemon unless
**keep collecting after quit** is enabled; then Rust detaches it before exit and the CLI manages it. A later OS
service needs the future design in D15.

A normal available update does not stop the daemon. A required update pauses polling and evaluation together; already
`disclosing` I/O may finish and everything else waits. The global pause stops polling, judge calls and delivery
claims; it does not erase state.

The owner's **global switch** is separate from operational pause and is the `event_settings.enabled` row in D8.
`agent-events disable-all`, its MCP peer and the app switch are one immediate tightening: a single SQLite transaction
sets it false and increments `switchGeneration`; purges all source staging and ingest rows; marks every nonterminal
pre-delivery decision, including held and judging work, `cancelled`; releases judge reservations; cancels every queued
or retryable delivery and purges its encrypted record; marks a delivery already past `disclosing` terminal
`in-flight-at-disable` and purges its retained record; purges every retained dead-letter payload; and purges every
retained dry-run and SSE row. This terminalises all pre-disable work in that transaction. The generation increment is
the switch-wide revocation fence: it cancels bound work without inventing a fourth rule-version state, and it leaves
the immutable standing authorisations inactive but intact for a later separately approved `enable-all`. It needs no
approval. It also cancels any incomplete
staged-position activation, whether a rule activation or `enable-all`, purges its staged positions and marks its
already-used approval as cancelled-for-completion; that approval can never mutate a later generation.

Scheduled source polling never runs while disabled. The only disabled-state provider exceptions are an approved
exact rule activation and approved `enable-all`, each after its disclosure claim and only for D4's staged-position
work. While enabled, a claimed exact rule activation has that same narrow exception. Each source adapter exposes a
separate baseline-only path limited to its cursor/profile/list-head or checked-snapshot-high-water endpoint, with no
body/file fetch, normalisation, projection or ingest. No judge, target or ordinary poll call is allowed through that
path. A provider, judge or webhook result that returns after `disable-all`, and a
dry-run/SSE append that began before it, is fenced by D8's generation check: older-generation work becomes terminal
`cancelled`, or remains `in-flight-at-disable` if it had crossed `disclosing`; reservations are released, payloads are
purged and nothing is re-queued. The external operation may already have happened and is audited as such, but it can
never recreate work for a later enable.

`enable-all` is a disclosure loosening and requires a new terminal/app-only `disclosure` approval. Its canonical D2
document contains exactly the current disabled `switchGeneration` and the sorted ids of the active rule versions that
will become effective; its derived version list contains exactly those rules. The preview may show their stored
digests and derived live source/account/event-type set, but those are not extra document fields. Generation or active
rule-pointer drift refuses it.

**Staged per-rule-position activation and replacement-drain protocol.** Every exact rule-version activation and
`enable-all` uses this recoverable order. The activation plan fixes the complete set of
`(ruleId, ruleVersion, source, accountId, positionScope)` points before approval and separately derives the
duplicate-free acquisition calls `(source, accountId, positionScope)` that can supply them; neither set is recomputed
after claim. A replacement plan uses the union of the old and new versions' scopes and records `oldInScope` and
`newInScope` for every member. Gmail may therefore make one `getProfile` call for an account and write that value as
the point for several rule versions, but those versions do not share one authorisation row. The unique nonterminal
replacement constraint in D8 is checked at prepare, claim and finalisation.

1. **Claim authority.** After terminal/app approval, the daemon claims the disclosure approval and durably observes
   core state `used`. The claim returns core's immutable `usedAt`. Under the same activation lock the daemon changes
   the SQLite intent to `pending-completion`, copies that value unchanged into `claimedAt`, records an exact
   `completionDeadline = usedAt + 1 hour` and both fixed point/call sets. It never samples another deadline origin.
   For a first
   activation it takes the required source locks in sorted order, waits for any in-flight cursor commit and makes the
   intent a durable scheduler fence against page-stage, occurrence-resolution, projection and cursor-commit work on
   those scopes until their points are staged. `enable-all` already has every scope fenced by the disabled switch. A
   replacement instead leaves the old version as the active pointer and installs a durable drain intent that makes
   the scheduler acquire the scope union; it does not globally pause ordinary old-version processing. No provider
   position call occurs before this claim and durable observation.
2. **Sample P per account/scope.** For each required acquisition call that has no committed row, take that scope's
   source lock, wait for its in-flight commit, call only the adapter's baseline-only path and store the successful
   response as an encrypted `activation_baselines` row tied to the intent, account and scope. A local value such as a
   Resend status start time is staged by the same path without network I/O. There is no body/file fetch,
   normalisation, projection, ingest, decision or delivery in the baseline call. For a replacement, the same
   transaction creates its `replacement_drains` row and makes P the old version's inclusive upper projection fence
   before releasing the scope lock. For a new-only scope, an absent acquisition cursor is initialised at P and marked
   drained; an existing shared cursor behind P remains in place for the other rules that use it and must reach P, but
   occurrences through P create no projection for either replacement version. If the global switch is disabled,
   every union scope is re-baselined to P and
   marked drained in that transaction because `disable-all` already terminalised its old work. Gmail is deduplicated
   to one `getProfile` result per account, keyed as mailbox
   scope even when several rule versions or Gmail event types are being made effective. A failed call leaves the
   intent visibly `pending-completion`; successful rows for other scopes remain committed and are never made
   effective on their own. Retries and restart skip those rows and call only missing scopes.
3. **Drain the old version to P.** This step exists only for an enabled exact replacement. Ordinary source work
   continues with the old version, still the active pointer. On each shared or old-only scope, occurrence and cursor
   commits may process that version only through inclusive P; occurrences after P remain encrypted in source staging
   and cannot create a projection until the swap. The commit that reaches P records `drainedAt` in the same
   transaction. A new-only scope either started at P or advances its shared cursor to P without a replacement-version
   projection. For a Slack conversation, reaching P in `conversations.history` marks only its top-level component:
   the aggregate row stays open until every seven-day-eligible thread parent discovered at or below P has its own
   fully paged `conversations.replies` cursor covering P. The eligible set is not frozen until the top-level cursor
   reaches P. A child scan suspended by the workspace budget or 429 remains open across cycles and restart, so
   neither finalisation nor a swap can overtake a reply at or below P. The replacement cannot finalise until every
   union row, including every Slack aggregate barrier, is drained. If the global switch is disabled, there is no ordinary old-version work to drain: step 2 initialises
   each union scope at P, and the later `enable-all` will sample fresh points again before collection resumes.
4. **Finalise atomically.** Under the activation lock and required source locks in sorted order, one final SQLite
   transaction rechecks the switch generation, exact expected pointer set, complete authorisation lineages, fixed
   point/call sets, completion deadline, one staged P for every acquisition call and, for a replacement, every
   `drainedAt`. A first activation installs the rule pointer with `currentCutoverId = intentId`, marks that rule
   version `active` and permanently fixes its `approval_id`/`authorization_activation_id = intentId`/`activated_at`, materialises its planned
   `rule_activation_points` and creates an absent acquisition cursor
   without moving an existing one. A replacement materialises P as the new version's activation points, changes the
   old rule version `active → superseded` with `superseded_at`, changes the new version to `active` with its fixed
   immutable approval/authorisation ids and timestamp, swaps the sole active pointer with
   `currentCutoverId = intentId` and releases after-P staged occurrences to that new version; scopes with `newInScope = false` end
   at P. A tightening does not enter this protocol: its immediate transaction changes the old version to `revoked`
   and installs the derived active version. For `enable-all`, finalisation re-baselines the acquisition cursors,
   writes fresh point rows for every listed active rule version/account/scope with that enable activation id, updates
   each active pointer's `currentCutoverId` to that fresh id without changing any rule version's
   `authorization_activation_id`, records one content-free `agentcomms.source.gap` operational record per source
   for the omitted disabled interval and sets `enabled = true`. Every branch completes the intent and deletes its
   staged baseline/drain rows in the same transaction; the source locks remain held until completion releases every
   scheduler fence.

**Used-intent mutation and revocation fence.** Every operation that can create, replace or remove an active rule
pointer takes the activation lock and, before writing, joins every unfinished staged-position intent to core approval
state. A non-revoking pointer mutation that finds a `used` intent makes no mutation and returns
`ACTIVATION_COMPLETING` with `retryable: true`; a second replacement of the same rule returns
`REPLACEMENT_PENDING`. The check is repeated in the pointer transaction, so a request admitted just before the claim
cannot commit after it. The activation operation holds the same lock across core's `used` transition and SQLite's
`pending-completion` write; after a crash, startup reconstructs that fence before accepting control requests. If the
crash happened after core stored `used` but before SQLite stored `claimedAt`, recovery reads core `usedAt`, copies it
unchanged and settles a deadline that has already elapsed before making any provider call.

Revoking actions always win rather than wait: an immediate tightening replacement, rule disable or removal,
bound-object revocation/removal, live-account removal or `disable-all` atomically settles every affected replacement
intent `cancelled`, deletes its staged positions and drain fences, records the used approval as
cancelled-for-completion and then applies that action's revocation/cancellation/purge transaction. `disable-all`
additionally purges any after-P source staging under its kill-switch transaction; a narrower revocation releases
unaffected staged occurrences only to a still-live, non-revoked rule and purges the rest. A concurrent mutation is
therefore either committed before the claim and makes the claim binding fail, observes the completion fence and
receives retry-later, or is one of these explicit revocations and cancels the drain. It can never land silently
between a successful claim and finalisation.

Startup recovery sees a used staged-position approval with no completed step 4, keeps every valid committed P and
drain row, resumes only the missing account/scopes, resumes old-version draining from the committed source cursor and
then attempts step 4, but only while the persisted completion deadline has not passed. When SQLite lacks the claim
write, recovery reconstructs it only from core `usedAt`; daemon downtime counts against the same hour. It never reclaims or
reapproves the used record. A crash after a provider response but before its stage-row commit repeats only that
uncommitted call; a crash after the commit reuses the exact stored cursor and `responseAt`. A crash during drain
reuses each `drainedAt` and the ordinary committed cursor, so no at-or-before-P occurrence is projected twice. At or
after one hour from `claimedAt`, an unfinished intent is settled `failed` before another provider call or drain
commit: `enable-all` leaves the switch disabled; a first activation installs no pointer; and a replacement leaves the
old version `active`, removes every P upper fence and makes deferred after-P occurrences eligible for that old version
again. All staged positions and drain rows are deleted, every activation-completion source fence is released under its
source lock, and provider retries stop. A content-free audit row records the intent id,
activation kind, `failed`, `completion-timeout`, claim/deadline/failure times and stable failing source codes—never
provider error text or content. The used approval remains single-use and cannot be resumed; the operation requires a
newly prepared and approved intent. `doctor` and the app show the terminal outcome and new-approval action. Continued
failure across restart cannot extend the deadline. A finalisation invariant failure such as impossible pointer drift
also settles `failed` immediately with its stable code instead of retrying providers. The explicit revoking actions
above are the pre-deadline cancellation paths; `disable-all` wins globally for first rule, replacement and
`enable-all` activations. A failed or cancelled replacement is terminal for the unique-pending-replacement constraint,
so another replacement may then be prepared; two nonterminal replacements are never chained.

The cut-over is intentionally per rule version/account/source, not globally atomic with the providers: each P is the
instant its successful staged response represents, even when another account is staged later or after restart.
For a first activation, events before P are not backfilled and events after P are collected after step 4. For a
replacement, every old-eligible occurrence at or before P is committed under the old version before step 4, every
new-eligible occurrence after P is committed under the new version after step 4, and an old-only scope ends at P;
after-P rows may be acquired into encrypted staging during the drain but cannot be projected early. For `enable-all`,
the baseline-to-finalisation interval is the only disabled-time window collected. A derived tightening inherits its
parent's points instead of entering this protocol and revokes its predecessor immediately.
Cancelled deliveries, purged ingest and purged replay rows never return.

Tests stop each worker before and after the generation and disclosure boundaries. `pause|resume` remains an
operational control that retains queues and replay and therefore grants no disclosure authority; it cannot stand in
for `enable-all`.

The `agentcomms.*` operational records in D3 are displayed by the app and `doctor` only. They are not normalised
source events and can never create ingest, decisions or deliveries; dead-letter recording therefore has
no recursive delivery case.

### D13. The desktop app

**Shape:** Tauri v2, React, Vite, `@cueplusplus/ui` with `@cueplusplus/tokens` and
`@cueplusplus/theme-cue`, a tray icon, the ordinary `settings` window and a separately labelled privileged
`secrets` window. `secrets` is a distinct Tauri window/webview and entry document, never a React route inside
`settings`.

**Screens:**

1. **Overview** — the authoritative global enable/disable switch, daemon/protocol health, source lag, active
   exact/derived authorisation lineages with immutable authorisation ids and mutable current cut-over ids,
   superseded versions with retained work, recent delivery outcomes, held
   decisions, pending approvals and every staged-position rule/replacement-drain/`enable-all` pending-completion or terminal-failed state with its
   deadline/new-approval action. Disable applies immediately; enable opens the D12 out-of-chat approval flow.
2. **Sources** — accounts, event types, interval/budget, expected latency, shared acquisition cursors and per-rule
   activation points selected by each active pointer's current cut-over id, open Slack aggregate reply drains,
   Gmail metadata and Gmail/Resend lazy-materialisation retry/degraded health, and the observation-time label
   limitation.
3. **Rules** — deterministic tree, optional judge, exact input fields and budgets, mapping builder, target-specific
   representation/schema, delivery rate cap, preview and dry-run test.
4. **Targets and subscribers** — dry-run retention, webhook URL form/network policy, SSE retention/origins,
   rule-bound approved/pending versions and tests; secret completion/rotation opens the separate `secrets` window,
   and a changed secret URL still follows the new-version flow.
5. **Deliveries** — filters, cancelled/retry/dead-letter states, retry only for `retryable`, drop, safely rendered
   dry-run rows, degraded reset barriers with `target resume`, and held decisions.
6. **Judges** — exact inputs, hosted warning, human-only keys and local endpoints; bundled models are labelled as a
   future design, not an installable option; key entry/rotation opens `secrets`.
7. **Approvals** — complete standing-authorisation preview and typed challenge.
8. **Settings** — autostart, keep collecting after quit, event secret backend/migration, retention, data location and
   about.

**Approval is equivalent to the terminal.** The webview supplies only an approval id, digest and typed response. The
Rust layer fetches the authoritative preview from the daemon by id and digest; it never renders preview fields
supplied by the webview. The TypeScript terminal renderer and Rust app renderer are separate implementations of one
text-only contract: no HTML interpretation, bidi/C0/C1, zero-width and control characters neutralised, links
displayed as inert text and never clickable, and envelope-looking text unable to close or forge a section. They run
the same repository JSON fixtures in `test/fixtures/disclosure-preview/*.json`; each fixture contains the structured
preview input and exact expected UTF-8 bytes, and either renderer drifting fails CI. Rust shows the daemon-issued
challenge, then calls the daemon's approve operation. Under the daemon activation lock, it re-plans and re-checks the
digest/challenge, calls core `approveDisclosure(..., "app")`, and runs D2's recoverable activation protocol. This is
the only meaning of `approvedVia: "app"`; the webview never answers an MCP form and cannot call core directly.

**No webview egress.** The production `security.csp` value is exactly:

```text
default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src ipc: http://ipc.localhost; frame-src 'none'; object-src 'none'; form-action 'none'; base-uri 'none'
```

`ipc:` and `http://ipc.localhost` are the only `connect-src` values because they are Tauri's documented IPC origins.
The build keeps `dangerousDisableAssetCspModification: false`, so Tauri still adds its hashes/nonces to bundled
assets; it never accepts the generated/default `csp: null`. No window loads a remote script, style, font, image,
frame or other content. This follows Tauri's warning that CSP is enabled only when configured and its security config,
whose example default is null ([Tauri CSP](https://v2.tauri.app/security/csp/),
[Tauri security configuration](https://v2.tauri.app/reference/config/#securityconfig)). The `secrets` entry document
adds a second, tightening meta-policy with `default-src 'none'`, only bundled `script-src 'self'` and
`style-src 'self'`, the same two IPC `connect-src` origins, and `img-src`, `frame-src`, `object-src`, `form-action`
and `base-uri` all `'none'`.

Rust installs navigation and new-window handlers before either window loads. Navigation is permitted only within the
compiled application's own origin; every non-app URL, download, custom external protocol and new-window request is
refused. Links are inert text, no opener/HTTP/WebSocket plugin is enabled, and frontend code has no shell or
file-system capability. Rust alone holds the daemon control session.

**A real secret-window boundary.** Tauri capabilities grant permissions to labelled windows/webviews, not React
screens, and overlapping capabilities merge authority ([Tauri capabilities](https://v2.tauri.app/security/capabilities/)).
The `settings` capability grants no D2 secret command. The `secrets` window has its own non-overlapping capability
whose only application commands are the complete D2 secret-operation set; it receives no approval, general daemon,
file, shell, dialog, HTTP, opener, clipboard or window-creation command. The build declares those custom commands
with `tauri_build::AppManifest::commands` and binds their permissions only to window label `secrets`; every other
window is denied even if it invokes the raw command name.

Secret bytes necessarily cross Tauri IPC **only between the `secrets` webview and Rust** for hidden entry and the
one reveal-once response—Tauri commands serialise frontend arguments and return values over IPC
([Tauri commands](https://v2.tauri.app/develop/calling-rust/)). The window clears its input and result on submission,
close, blur and navigation failure. Rust passes input directly to the daemon operation and returns generated material
once; neither layer logs, caches, telemeters or audits bytes. The audit record contains only D2's operation and ids.
A scan/trace test proves secret bytes never appear in any other window's IPC, daemon/control replies to another
surface, logs, audit or SQLite outside the independent event secret store. The test explicitly allows only the one
expected `secrets`-window IPC argument/result pair.

Tests cover the cross-language JSON vectors; HTML tags, bidi/control characters, OSC/CSI, fake headers and
envelope-looking preview text; inert links; digest drift; wrong or missing challenge; a webview-supplied fake preview;
and generated command-manifest/capability access from every window. A built production app on macOS, Windows and
Linux serves a loopback exfiltration trap and, from **every** window including `secrets`, attempts `fetch`, XHR,
WebSocket, EventSource, `sendBeacon`, remote image/CSS URL, form submission, top-level navigation, remote script and
frame loads. The trap receives zero requests, navigation remains on the app origin, no new window opens, Tauri IPC
still works, and direct invocation of every secret command from every non-`secrets` window is denied.

### D14. Repository structure, packaging and versions

```text
apps/
  desktop/                # Tauri + React + @cueplusplus/ui
packages/
  core/                   # gains D9's approval/audit/taint support; no event configuration or event-secret migration
  events/                 # NEW @agentcomms/events — isomorphic catalogue, pinned Unicode, conditions, mapping
  events-daemon/          # NEW @agentcomms/events-daemon — I/O, ingest, approval, delivery, CLI, MCP
  gmail/ slack/ resend/ whatsapp/  # each gains operations/events.ts and manifest events
```

The top-level `"agentcomms"` field continues to mean **channel**, exactly as the channel design specifies
(`docs/superpowers/specs/2026-09-26-channel-plugins-design.md:24-29`). Non-channel packages declare a separate field:

```json
{ "agentcommsPackage": { "kind": "library" } }
{
  "agentcommsPackage": {
    "kind": "service",
    "binary": "agent-events",
    "server": {
      "defaultName": "events",
      "entry": "src/mcp/server.ts",
      "factory": "createEventsMcpServer"
    },
    "operations": "src/operations"
  }
}
```

`kind` is the closed discriminator: `library` has no CLI/MCP parity surface, while `service` must have both. For a
service, `binary` is the exact key in `package.json.bin` and the command used to read its CLI; `server.defaultName`
is its registration/reference name, `server.entry` is the package-relative MCP module and `server.factory` its
exported factory; `operations` is the package-relative directory whose exported functions every capability row must
name. A service follows the Commander conventions `src/cli.ts`, `src/cli/program.ts` and exported `run`; changing
those conventions requires new manifest fields rather than a package-name special case.

`@agentcomms/events` is the library and `@agentcomms/events-daemon` the service. The existing registry begins channel
discovery in `readChannels` and derives `SURFACES`/`DRIVERS` in `loadRegistry`
(`scripts/channels.mjs:35,129`). It is extended to read strict `agentcommsPackage` declarations in the same package
walk and produce `libraries` and `services` beside `channels`. Libraries feed publication and dependency ordering but
are explicitly surface-free and import-tested. Every service automatically feeds:

- `packages`, hence `scripts/packages.mjs` publication and version/licence checks;
- `surfaces`, hence `scripts/registries.mjs` `SURFACES` and CLI/tool discovery;
- `drivers`, using the declared server entry/factory and operation directory, hence `scripts/operations.mjs`
  `DRIVERS` and stand-in operation driving;
- generated CLI/MCP reference paths `docs/reference/<package>-cli.md` and
  `docs/reference/<package>-mcp-tools.md`; and
- the parity runner and its requirement that every published surface be discovered
  (`test/parity.test.mjs:99-113`).

The parity test is made declaration-aware: every published service must be a surface and driver, every wrapper must
wrap one, and only an explicitly declared library may be surface-free. A fixture drops an otherwise unknown service
package with this declaration into a repository copy and, without editing any registry list, proves it appears in
publication order, `SURFACES`, `DRIVERS`, both generated references and an executed parity row. A companion malformed
fixture refuses missing/unknown fields. Neither declaration widens the channel-manifest union or makes the service a
channel.

This registry work lands with the first package that depends on it, not afterward. **Phase A** adds strict
`kind: "library"` discovery to `scripts/channels.mjs`, feeds that declaration through `scripts/packages.mjs` and the
release/version/licence consumers, and extends the release tests before `@agentcomms/events` becomes publishable.
That order is required because the existing release test enumerates every non-private `packages/*/package.json` and
fails any publishable package absent from the shared publication list
(`test/release-packages.test.mjs:47-75`). **Phase B1** adds `kind: "service"` discovery, `SURFACES`/`DRIVERS`,
generated-reference routing and the declaration-aware parity scaffolding before
`@agentcomms/events-daemon` becomes publishable; every operation that exists in B1 already has matching CLI/MCP
adapters and a capability row. **Phase B3** then adds the full D10 CLI/MCP operation set and human-only exception
rows. Neither package is staged as private, and every phase remains able to run the repository's normal verification.

Webhook and SSE remain reviewed first-party modules inside the daemon. There is no `kind: "delivery"` manifest: a
manifest cannot stop an adapter from reading the daemon's event secret store or outbox. Any later broker or hosted-queue
adapter waits for D15's separate security and acceptance design.

All npm packages remain lockstep. The desktop has its own version but declares a tested daemon-protocol support
matrix. Root `pnpm verify` runs the desktop TypeScript typecheck, unit tests and the TypeScript side of the shared
renderer vectors. The desktop workflow runs on macOS, Windows and Linux and, on **each** platform, runs
`cargo fmt --all -- --check`, `cargo clippy --all-targets --all-features -- -D warnings`,
`cargo test --all-targets --all-features`, the Rust side of the renderer/command/secret tests, and an unsigned Tauri
build. Signing/notarisation is a later credentialed release job, not a substitute for this cross-platform build gate.

If the CUE++ packages are not publicly installable when phase C is planned, that phase puts the app and its builds in
a private repository; it does not weaken or skip fork CI here. Signing and notarisation remain a separate credentialed
release design.

### D15. Future designs, not contracts in this specification

- **Slack Socket Mode:** a future source design must be explicitly best effort because Slack exposes no replay cursor;
  user-perspective delivery remains unverified, so no feature may depend on it
  (`docs/superpowers/specs/2026-09-19-slack-design.md:225-233,448-456`; [Slack Events API](https://docs.slack.dev/apis/events-api/)).
  Its `xapp-` credential is completed by a person only.
- **Gmail Pub/Sub:** a future design may use notifications only to wake the existing `history.list` reconciliation;
  it cannot replace that cursor, and cloud project/topic credentials and consent remain human-only.
- **Broker and hosted-queue adapters:** network/security contracts and credentials remain for a future design, with
  every credential human-only. That design must account for QStash's ten-minute dedupe window and inspect
  EventBridge's per-entry failures even on HTTP 200 ([QStash](https://upstash.com/docs/qstash/api-reference/messages/publish-a-message),
  [EventBridge](https://docs.aws.amazon.com/eventbridge/latest/userguide/eb-putevents.html)).
- **Bundled judge:** a future design must identify the model, licence, signed/checksummed download, runtime isolation
  and labelled Gmail/Slack quality evaluation; nothing is bundled in the installer under this specification.
- **OS service:** a future design must cover per-platform identity, owner-only state, autostart/update recovery and the
  human-only installation credentials or privileges each operating system requires.

## 4. Phases

Each phase is specified, reviewed, planned and built separately. The order is by safety invariant, not by screen.

| Phase | Delivers | Depends on |
|---|---|---|
| A | Strict `agentcommsPackage.kind: "library"` discovery and release support in `scripts/channels.mjs` / `scripts/packages.mjs` plus the release tests; then isomorphic, publishable `@agentcomms/events`: Appendix A's exact catalogue, pointer/provenance patterns, semantic formats, bundled Unicode 15.1 case folding and UTS #46, conditions, mapping, generated source/delivery schemas and shared Node/browser conformance vectors; no I/O or `node:` imports | — |
| B1 | Strict `agentcommsPackage.kind: "service"` discovery, publication, `SURFACES`/`DRIVERS`, generated-reference routing and parity scaffolding; then the publishable daemon skeleton: authenticated/versioned control protocol, stale recovery, owner-only authoritative SQLite state and global switch, AES-GCM per-rule projections, deterministic event ids, canonical Gmail source options, observation-time received/sent classification and required lazy-materialisation with terminal `vanished`/`unresolvable` resolution, one Gmail mailbox acquisition cursor plus per-rule-version/account activation points for every source, immutable rule-version authorisation lineage plus mutable active-pointer `currentCutoverId`, rule evaluation, core `disclosure` records/create-approve-claim/refusals with authoritative `usedAt` plus the three canonical activation documents and recoverable intents, bounded staged positions plus replacement drain-before-swap with mutation fences/failure settlement for every exact rule activation and `enable-all`, `active | superseded | revoked` rule-version lifecycle, inherited positions for derived tightenings, exact and derived standing-authorisation lineages and the `SECURITY.md` amendment, two-lock taint-origin sidecar and taint-before-every-judge/disclosure, independent daemon secret store/migration, atomic terminal-decision/complete-outbox/projection-purge transactions, terminal retention, outbox/leases/cancellation; every B1 operation already has a parity row, but **only** a local `dry-run` target with encrypted at-most-24-hour log and human-only safe reads | A |
| B2 | Network hardening, plain/secret webhook URLs with URL changes creating new target versions, pinned resolution, HTTPS webhooks with only the literal-loopback HTTP exception, HTTP-only literal-loopback local judges, Standard Webhooks per-attempt signing/rotation, webhook delivery/manual-retry state fences, durable reset barriers/degraded resume, authenticated generation-bound SSE with rotation close, exact-origin CORS, replay retention and version-bound purge | B1 |
| B3 | The full D10 CLI/MCP surface on B1's service/parity scaffolding and all exception rows, the complete named human-only secret-operation set and migration, dry-run reads and target resume, lineage/pending-completion `doctor`, event skill | B2 |
| C | Desktop app and tray lifecycle, separate privileged `secrets` window, per-window capabilities, production no-egress CSP/navigation policy, Rust approval/secret surfaces, supervision and protocol compatibility | B3 |
| D | Slack, Resend and WhatsApp sources, including resumable Slack pagination and aggregate top-level/reply drain barriers, Resend required-detail terminal resolution and Unicode-code-point normalisation, and WhatsApp old-index multiset diff with timestamp-scoped, content-ranked, `Z_PK`-free occurrence identity; each ships with per-source taint and reset/fairness tests | B1 |
| E | Hosted/local judges, holds, rolling durable budgets with crash-settled reservations, adversarial corpus; refuses to build or ship unless B3's secret-completion and human-only capability surfaces are present | B3 (C for app hold resolution) |
| F | Reserved for the five separate future designs in D15; this specification supplies no implementation or acceptance contract for them | D, E |

No phase before B2 can make network disclosures. No new source ships without taint-before-disclosure.

## 5. Tests the phases owe

- **Catalogue, identity and pointer grammar:** Phase A generates JSON Schema for all seven definitions and compares
  the canonical, key-sorted result field-for-field with Appendix A's normative schemas—required lists, null unions,
  enums, formats, `additionalProperties: false` and every metadata pattern—so implementation and fixtures cannot
  bless an invented contract. It also checks every example and semantic-format/address/handle declaration;
  pattern validation and expansion; `~0`, `~1`, root `""`, empty keys, numeric array indices, refused leading zeroes
  and `-`, literal `*`, copied parents/ancestors/descendants, and own-property handling of `__proto__`, `constructor`
  and `prototype`. Event-id vectors cover stable repeats, the same dedupe key in different accounts, every tuple
  component and an injected SHA collision that stops without advancing the cursor.
  Every known and unknown `agentcomms.*` type is refused by rule create/update/test; source gap/recovery/degradation
  and dead-letter records remain visible in the app/doctor but create no ingest, decision or delivery, and a dead
  letter cannot recurse. The fixed reset notice and `io.agentcomms.test.v1` remain nonselectable control inputs.
  Phase A has named Resend schema fixtures: `safe.svg` accepts exactly `riskFlags: ["html-or-svg"]`;
  `safe\u200B.svg` retains `hidden-characters-in-name` and canonicalises the exact order to
  `["hidden-characters-in-name", "html-or-svg"]`; `maxLength: 20000` is asserted in Unicode code points; an
  over-20,000-code-point BMP body is capped with `bodyTruncated: true`; an exactly-20,000-code-point body has
  `bodyTruncated: false`; astral-only input proves two UTF-16 code units still count as one schema character; and a
  surrogate pair straddling `readBody`'s code-unit limit loses the trailing lone high surrogate, retains
  `bodyTruncated` from `readBody`, satisfies the code-point limit and emits no unpaired surrogate. An absent body has
  an absent flag, and either orphan `body` or orphan `bodyTruncated` is rejected by the generated schema.
- **Conditions and local tests:** every operator × legal schema type and every refused format/type pairing; empty
  `all`/`any`/`in`; every missing leaf false, plain `not`, and `exists`; Unicode 15.1 folding and UTS #46 vectors run
  in Node and a browser; invalid dates and subdomains. Golden Node/browser vectors prove omitted `caseSensitive`
  canonicalises to explicit `false`, equals explicit `false` byte-for-byte and differs from `true`. CLI and MCP
  `rule test` accept catalogue examples only, reject
  retained ids/account arguments, mark agentic nodes not evaluated and make zero provider/judge/target requests.
  `rule test-retained` refuses MCP, non-TTY/agent-marked CLI and removed accounts; terminal/app rendering uses the
  hostile-content vectors. Unapproved `judge test` also makes zero network requests. `judge test` and `target test`
  reject every caller-supplied content field and send the exact `io.agentcomms.test.v1` synthetic bytes; their taint pass
  completes with no observation.
- **Judges and budgets:** exact uncertain boundaries including threshold 0 and 1; provider probability vs
  uncalibrated score; content-field prefilter; approved-version enforcement for hosted/local calls; terminal/app
  pending-version exception; no active singleton; immutable budget activation and drift; calls-per-rolling-hour,
  input-tokens-per-rolling-30-days and concurrency boundaries for each rule id, provider and global ledger. A new
  rule version inherits the prior version's in-window usage and live reservations; a new singleton version inherits
  global/provider usage. Injected-clock tests cover exactly-before/at/after the one-hour and 30-day edges. Durable
  reservations cover `reserved → released` and `reserved → in-flight → settled`; crash injection after reserve,
  immediately before transport, immediately after transport and before/after settlement proves recovery releases
  pre-I/O reservations, pessimistically charges an unsettled in-flight estimate, frees concurrency, and is idempotent
  without double charge. Timeouts count the estimate and malformed output fails closed. Wrong-typed, `NaN`,
  positive/negative infinity, negative and greater-than-one provider scores are recorded as malformed no-match;
  the same invalid threshold classes are refused at save, and execution proves neither value is clamped. An approved
  `judge test` consumes one durable charge for its exact judge version and the active singleton's global call,
  reserved/actual tokens and concurrency exactly once; it consumes no invented rule/judge limit and no provider
  ceiling. Ten tests in a rolling hour pass, the eleventh refuses before the injected transport, and another judge
  version has its own ten. Concurrent rules with different per-rule limits share one daemon/per-provider ceiling,
  and any provider/global field in a rule is refused.
  All automated transports are loopback fakes or injected functions.
- **Mapping and wire:** constants, objects/arrays, every missing policy, both representations and generated schemas;
  golden Node/browser vectors prove `omit` removes an object property and is refused at an array element and at the
  root, while `reject` and `null` have identical defined behavior at all three positions;
  provenance through parent/object/array copies; canonical `agentcommsuntrusted` including root; URI-escaped source
  components; exactly one full-envelope byte vector for each of the seven catalogue event types, asserting
  `specversion`, delivery id, source, default `com.agentcomms.<catalogue-type>.v<version>` type, `occurredAt` time,
  `application/json`, D3 schema id, the required per-type subject and exact extension omission/value; plus a separate
  rule-defined-type vector. Exact non-null dry-run, webhook and SSE `targetKey` values. Two distinct
  target versions referencing the same subscriber version produce two deliveries with different SSE keys. Exact-byte
  Standard Webhooks tests cover `whsec_`, overlapping signatures, raw-body verification and five-minute tolerance;
  an injected clock proves retries keep `webhook-id`/body and change `webhook-timestamp`/signature. Every webhook
  delivery vector also asserts the exact outbound header
  `Content-Type: application/cloudevents+json; charset=utf-8` beside those body and signature bytes; no binary-mode
  `ce-*` header is required or substituted.
- **Digest, approvals and activation recovery:** golden vectors for the three canonical activation documents. Rule
  vectors mutate source/account scope, a newly connected but unselected account, every Gmail label, `any`/`inbox`
  selector transition and `includeSpamTrash`, every Slack conversation id, every Resend kind, every WhatsApp
  chat/select-all transition, the optional rule-defined CloudEvents type,
  ordinary URL path, secret-URL fingerprint, conditions, constants, pointers, missing policies, every bound object
  version id, all caps/retentions and every per-rule judge limit/address-set entry. A different secret-URL path or
  query is a new target version and rule digest; in-slot replacement is refused. Budget vectors mutate each
  daemon/provider ceiling. Enable-all vectors mutate generation and add/remove/reorder rule ids, proving only reorder
  canonicalises equal. A target, subscriber or judge cannot produce or claim a standalone activation; editing one
  leaves every old rule bound to its old object version until separate rule activations complete. Core tests the
  complete disclosure create/challenge/terminal-or-app approve/claim lifecycle, binding drift, concurrent single use
  and every ordered
  wrong-kind claim among all four kinds. Crash injection before/after activation-intent insert, disclosure-record
  create/attachment, approval, claim-marker creation, core `used`/`usedAt`, active-pointer commit and completed-intent mark
  proves pending remains pending, approved resumes safely, `intent + used` finishes and expired/revoked/absent drops.
  A crash after core persists `used` but before SQLite copies `claimedAt`, followed by daemon downtime longer than one
  hour, restarts to terminal `failed` using the original core `usedAt` and makes zero provider calls.
  For an exact first activation, failure immediately after claim installs no pointer and leaves the intent
  recoverable. For an exact replacement, failure immediately after claim leaves the old pointer active; the fixed
  scope set is the union of old and new; P is durably installed per scope; old processing drains through inclusive P;
  and one final transaction swaps the pointer, marks the old version `superseded` and the new version `active`. A
  crash after a Gmail profile response but before its stage-row commit repeats only that
  account; partial success across a multi-account rule persists successful rows but activates no account; restart
  resumes only missing rows; continued provider failure reaches the one-hour terminal `failed` audit outcome and
  requires a new approval. The same matrix runs for `enable-all`.
  A second replacement for the same rule is refused while the first is pending or draining and is accepted only
  after the first completes, fails or is cancelled. After each whitelist tightening that leaves a rule effective—and with a crash injected on both sides of version,
  `derived_authorizations` and pointer writes—the new version and derivation edge are all committed or none are.
  Restart, `doctor`, the app and an attempted disclosure must each validate the full acyclic chain to the exact parent
  approval; a missing, cyclic, wrong-rule, wrong-edit-kind or digest-mismatched edge blocks effectiveness.
- **Ingest and worker crash recovery:** before/after cursor/ingest commit, decision insert, judge response persistence,
  delivery creation, `disclosing`, dry-run append, webhook 2xx recording and SSE append. Every restart reaches one
  terminal decision per `(eventId, ruleId, ruleVersion)`, one delivery per `(decisionId, targetKey)`, and never advances over memory-only
  content. A matched rule with at least three targets has failpoints after in-memory mapping of each target and,
  inside the one SQLite transaction, after the terminal decision insert, after **each** individual delivery insert,
  after projection purge and immediately before commit. Every pre-commit crash rolls back to a retained projection
  and re-evaluates; every committed result has exactly the complete target set and no projection. Equivalent empty-set
  cases cover no-match, retention expiry and hold expiry. One provider event is evaluated by a one-hour body-referencing rule and a 24-hour metadata-only rule: only
  the first projection contains the body, it is purged at one hour, the metadata projection remains to 24 hours and
  no shared full event is recoverable at rest. A body is not fetched when no active projection requires it, and is
  fetched once when either rule does. Gmail and Resend each cover a successful list/metadata read followed by
  deletion, a permanent required-lazy-fetch 404 (`vanished`), repeated transport failure, malformed detail/body/
  attachment responses and the tick immediately before/at/after the 24-hour deadline (`unresolvable` plus one
  content-free source-gap). Restart before and after each terminal write preserves `firstFailedAt`, never fetches or
  projects again after resolution, lets unaffected metadata-only projections succeed and advances the cursor only
  after every affected projection is terminal.
- **Tightening and account revocation:** generated old/new documents exercise D2's six no-approval edits and assert
  that edit's stated invariant and exact-or-derived authorisation lineage. Every condition/constant/pointer edit and every new target/subscriber/judge version is
  pending even when `plain → enveloped` or an approved address set narrows; revoking an object immediately blocks its
  old versions without activating a replacement. Config removal races provider polling/commit, judging/result commit,
  webhook claim/outcome, dry-run/SSE append and safe read/replay. The single revocation transaction cancels/purges
  account-bound work, retained dead-letter payloads, dry-run/SSE rows and only-account rules, while multi-account
  rules continue solely for live ids; the live-account fence closes every post-transaction race.
  Every immediate tightening replacement proves the displaced version becomes `revoked`, not `superseded`, and
  takes no baseline or drain call. Disable, remove, account removal and object revocation cancel bound work; ordinary
  exact replacement does not.
- **Kill switch generations:** `disable-all` races provider reads, retained ingest, holds, judge reservations and
  completions, queued/retryable/disclosing webhooks, retained dead letters, and dry-run/SSE append/read/replay at both
  sides of every boundary. Its one transaction purges/cancels all pre-disable work—including dead-letter payloads and
  dry-run rows—and increments the generation; every late commit is terminal
  `cancelled` or `in-flight-at-disable`, never retryable. Outside an in-progress, explicitly approved `enable-all`,
  the disabled state permits no **scheduled poll** or other provider call. An explicitly approved exact rule
  activation or `enable-all` calls only each adapter's baseline cursor/profile/list-head/checked-snapshot allowlist
  while the switch is false and creates no ingest or projection; any poll/body/judge/target call fails the test. The
  common staged-position protocol is exercised for `enable-all` and **every** exact rule activation, including a
  second same-type rule, with the drain-before-swap branch for an exact replacement: crash injection runs immediately
  before and after intent creation,
  terminal/app approval, claim, core `used`, every individual position response/stage-row commit, the final
  transaction and completed-intent mark. Provider failure immediately after claim leaves no partial effect. A crash
  after a Gmail profile response but before commit repeats that account, while a crash after commit reuses its exact
  row. Partial success across several accounts persists only the successful rows and activates none; restart calls
  only the missing accounts. After core records `used`, after **each** individual position write, during each drain
  and immediately before finalisation, non-revoking activation/enable mutations receive retryable
  `ACTIVATION_COMPLETING` with no drift and a second same-rule replacement receives `REPLACEMENT_PENDING`; restart
  repeats the refusal or completes the original intent. At each same point, an immediate tightening, rule
  disable/remove, bound-object revocation, account removal and `disable-all` each cancel the affected drain, delete its
  stages and apply their revocation; `disable-all` cancels either activation kind globally and wins. Injected time at one
  tick before, exactly at and after `claimedAt + 1 hour` proves persistent or continued-after-restart provider failure
  is visible only before the deadline; at the deadline it settles `failed`, emits the content-free audit row, deletes
  stages, makes no further provider call and requires a new approval. Golden binding checks refuse chat/MCP approval
  plus pre-claim generation/rule-pointer drift. Two complete `disable-all`/approved-`enable-all` cycles span a daemon
  restart: the immutable `rule_versions.authorization_activation_id` and approval lineage never change, each enable
  installs a fresh `active_versions.currentCutoverId`, `doctor` reports both values, and every source worker selects
  only the point rows named by the latest `currentCutoverId`. One event injected after an account's position response but before
  the final transaction is collected on the first poll; one immediately before that point is not. No other
  disabled-interval event is backfilled, and no cancelled ingest, delivery, dry-run or stream row is resurrected.
- **Delivery state, caps, dry-run and SSE:** a webhook charges once at its first attempt and every retry reuses that
  charge; a cap-blocked webhook makes no attempt. The manual-retry matrix permits only `retryable` with attempts below
  the original limit, an unexpired deadline, current switch generation, live account, a non-revoked bound rule
  version and unrevoked bound objects, and changes only `nextAt`. Both `active` and `superseded` versions pass; the
  active pointer is not consulted. It refuses `queued` (including cap- or barrier-blocked), `disclosing`,
  delivered, cancelled, retention-expired, dead-lettered, content-unreadable and both in-flight terminal states;
  separately it refuses a
  corrupt retryable row at attempt 20, after its deadline, after revocation or after disable/re-enable. Disable purges
  a retained dead-letter payload. A delivery queued under the old version before an exact replacement swap is still
  delivered afterward while that version is `superseded`; its retry, retained dry-run read and SSE replay likewise
  pass until their own deadlines. The same rows are cancelled and purged after explicit revocation, proving no fence
  substitutes “is active pointer” for “bound version is not revoked”. Dry-run/SSE append and cap charge are atomic; dry-run uses the exact key, one
  primary-keyed log row per delivery, encrypted packed record, at-most-24-hour retention and terminal/app safe
  renderer, while SSE replay inside retention consumes no additional slot. Expiry and every matching revocation purge
  dry-run/SSE rows. `target test` permits ten charged
  attempts per rolling hour for each target id across version changes and refuses the eleventh. A reset-delivery
  has exactly 20 attempts and a 24-hour deadline, carries only D6 reset metadata and consumes no rule cap. A target
  version shared by rules with different caps/retentions gets one such reset: removing one rule keeps it, and an exact
  replacement also keeps it while non-revoked superseded work remains. Revoking/removing the final active or retained
  reference cancels and purges the queued/degraded notice and barrier. A reset dead letter leaves a
  durable degraded barrier across restart; later ordinary rows make no attempt/append and expire at their original
  deadlines until terminal/app `target resume` creates a new fixed-limit reset delivery, whose success opens the
  barrier before any survivor. Token rotation rejects the old token, actively closes a connected old-generation
  client and proves it receives no later frame, while preserving replay under a newly authenticated generation. A
  real-browser test completes the approved exact-Origin OPTIONS preflight and fetch-streams with
  `credentials: "omit"`; unapproved Origin, method/header, query/cookie token and wrong Host/bearer are refused;
  native `EventSource` remains unsupported.
- **Taint:** structured address and Slack-handle provenance through scalar, parent and object mappings and judge input;
  free-text address extraction; workspace scope retained; absent `origins.json`/entry decodes as `["read"]`; read and
  event observations merge their sidecar origin set; and structured `header` still outranks prose `body` before the
  cap across both origins. A fixture writes an event origin, runs the prior released `TaintStore.touch` over that
  address, then proves the new reader returns `event` (and inferred `read`) and the same-window/same-cap pruning keeps
  the sidecar aligned. A deterministic two-new-writer test pauses A after the sidecar commit and before the base
  commit, proves B is blocked on the sidecar lock and cannot prune A's residue, then completes both with the event
  origin intact; lock-order assertions require sidecar-before-base and both held through both commits. Persisted files
  contain neither event id nor channel. Forced base or sidecar write failure
  proves no hosted/local judge call, webhook or readable dry-run/SSE append occurs; errors stay untrusted and reason
  codes constrained.
- **Retention:** held-decision expiry produces `hold-expired` with no delivery; unevaluated ingest and rate-cap backlog
  reach `retention-expired`; save refuses `hold > ingest`; cancellation purges payload in its pointer-change
  transaction; webhook success, dead-letter expiry/drop and independent multi-target deadlines purge exactly their
  encrypted records. Dry-run retention above 24 hours is refused, its expiry purges the encrypted row, and safe reads
  after expiry fail without recovering bytes. Every ordering of ingest, hold, delivery, dry-run, dead-letter and
  decision-metadata deadlines proves no deadline extends another; at 30 days or the approved shorter value the
  decision purge clears expiring metadata, retains only the uniqueness tombstone and cannot trigger re-evaluation.
- **Encryption and installation reset:** packed-record round trips for every encrypted column in per-rule ingest
  projections, source staging, decisions, deliveries, dry-run log, reset delivery and stream log;
  record-version/key-id parsing; exact AAD golden vectors for a single-key `decisions` row and a composite-key
  `ingest_rules` row; and direct typed-component vectors proving INTEGER `1` and TEXT `"1"` do not collide. The
  format tests must prove decryption fails when ciphertext is moved to another row, to another encrypted column of
  the same primary-key row (a two-encrypted-column test fixture), to `ingest_rules` rows whose first two components
  are swapped (`("a", "b", "v")` versus `("b", "a", "v")`), and across a component boundary
  (`("ab", "c", "v")` versus `("a", "bc", "v")`). They also cover per-table HKDF separation (including
  equal nonces in different tables); random-nonce counters and rotation before 2^32; old-key re-encryption;
  ciphertext, tag, AAD, table, column and typed-primary-key tampering; single-record `content-unreadable`;
  missing-key reset; and plaintext scans of
  the DB, WAL and free pages. A fake target/provider returns an error containing the exact event payload; only its
  closed error code and numeric status appear in plaintext columns, and scans find none of the reflected text in the
  DB, WAL or free pages. The 128-bit installation id persists across restart, schema migration and backup/restore;
  database recreation and master-key loss produce a new id, fresh baselines and documented event-id restart. Reset
  success opens each target barrier; reset dead-letter marks only that target degraded and proves later delivery stays
  blocked across restart until terminal/app resume.
- **Secrets:** enumerate `target secret create|rotate`, `target url set`, `subscriber token create|rotate`,
  `judge key set|rotate` and migration as separate exception capabilities. Prove none of their names, input fields or
  output shapes appears in `tools/list`, any MCP schema, structured content or text output. Scan CLI/MCP inputs and
  outputs, logs, audit, database metadata and per-window app IPC. MCP proposals contain no secret; terminal hidden
  input and `secrets`-window reveal-once work; the only permitted secret-bearing IPC is the expected transient pair
  between that labelled window and Rust, while every other window trace is clean. Audit contains operation and ids
  only. Signing rotation sends two signatures;
  subscriber rotation invalidates the old token without purging; plain webhook URL userinfo/query are refused; and
  no path ever exposes a secret URL. An attempted secret-URL slot replacement is refused; a changed URL creates a new
  target version while signing/subscriber generations still rotate in-slot. Daemon-owned file→keychain and
  keychain→file migration derives and carries master keys, signing keys, subscriber tokens, judge keys and URL
  secrets from SQLite under the events lock. Tests pause concurrent event creation and rotation on both sides of its
  migration snapshot, exercise rollback/leftover cleanup, then restart and resolve every reference. A prior released
  core binary migrates core's backend in both directions after event secrets exist; the events selector, namespace,
  files and readability remain unchanged. No secret is exposed.
- **Sources:** Gmail makes one unfiltered, fully paged mailbox `history.list` scan with one mailbox cursor and no
  `labelId`; it dedupes generic/specific occurrences and treats history messages as identifier-only, matching Gmail's
  documented warning. Every `messagesAdded` occurrence gets one observation-time metadata read before classification
  or source-option filtering. Fixtures with `messagesAdded[].message.labelIds` omitted cover received, sent and draft
  messages: sent and draft cases under `labels: "any"` with `includeSpamTrash` both `false` and `true` never produce a
  received projection, body fetch or delivery. Any `DRAFT` skips; otherwise observed `SENT` emits sent; otherwise
  received. A non-404 metadata failure retries with the mailbox cursor held and never defaults to received; injected
  time immediately before, at and after 24 hours proves it becomes one terminal `unresolvable` resolution and one
  source-gap record at the deadline, then cursor progress resumes. A message-level 404 becomes terminal `vanished`
  immediately, with no source-gap record, event, projection, body fetch or delivery and with the doctor count updated.
  Same-page and cross-page `messagesAdded`→permanent-`messagesDeleted` fixtures crash before/after raw-page staging,
  terminal-resolution insertion and final cursor commit; restart preserves exactly one `vanished` result and later
  records progress. Parallel cases crash during the 24-hour retry and after `unresolvable`, proving the original
  `firstFailedAt` and terminal outcome survive restart. Exact
  fixtures add a selected label after arrival but before first observation (the received/sent occurrence matches) and
  after observation (that occurrence and its bytes remain unchanged; only the labelled occurrence can match).
  Labelled selection uses only that history record's `labelsAdded`/`labelsRemoved` ids, including selected-label
  removal; add/remove/add is split across page and crash boundaries against disjoint and overlapping rule sets.
  Delayed polling fixes a labelled event's `occurredAt` to its first durable observation time, and crashes after
  staging, ingest, decision creation and delivery creation prove replay emits the same `occurredAt` and exact
  CloudEvent envelope bytes. The equivalent crash vectors cover Resend status changes, the other version-1 source
  without a provider timestamp. Simultaneous disjoint label rules, overlapping selectors and one occurrence matching
  several rules prove the right projections are created once each. During lagged and multi-page Gmail scans, activate
  (a) a second rule for the **same event type**, (b) a looser replacement of an existing rule, and (c) a second event
  type. Run each activation before and after raw-page staging, occurrence-resolution/projection commit and final
  mailbox-cursor commit, and crash/restart at every activation/fence/scan write. There remains exactly one provider
  scan and mailbox cursor; each exact version has its own account point; and no occurrence at or below a newly active
  version's point is projected for that version. A derived tightened version records byte-identical inherited points,
  revokes its predecessor and requires no provider call. A first or separate-rule position intent pauses affected
  commits until its point is installed; a replacement does not. Instead, after claim it samples P over the old/new
  scope union, keeps the old version as the active pointer, drains every old/shared cursor through P, holds after-P
  occurrences, and atomically swaps to the new version. Backlog and new occurrences are injected before the sample,
  during the drain and at the swap; restart is injected at each boundary. Every eligible occurrence is projected by
  exactly one version, old-only scopes end at P, and new-only scopes begin after P without backfill. Timeout failure
  removes the upper fences and lets the unchanged old pointer catch up; a revocation or `disable-all` during the
  drain cancels and purges it; and a second replacement is refused while the first is pending or draining. The same
  replacement matrix runs against Slack per-conversation, Resend received/status and WhatsApp per-chat points,
  including `enable-all` fresh points across restart. Additional
  cursor restart/crash cases, multiple pages, DRAFT/SENT, `includeSpamTrash` false/true, message-level terminal 404
  and a history-cursor 404 gap preserve the same contract. Slack tests each non-empty conversation-id set,
  short/empty pages with `next_cursor`, bounded cycle continuation, watermark
  commit, history-loss-only gap, seven-day reply pagination and refusal to promise old-thread replies or edits. A
  replacement fixture suspends one eligible thread's reply scan first by workspace budget and then by 429 while a
  reply with `ts <= P` exists: the top-level history cursor reaches P, but swap and restart attempts leave the
  aggregate conversation drain open until that saved reply cursor covers P; the reply then creates exactly one old-
  version projection and never a new-version projection. Phase
  D's named Resend normalisation fixtures prove `safe.svg` yields exactly `html-or-svg`; `safe\u200B.svg` retains
  `hidden-characters-in-name` with exact canonical order
  `["hidden-characters-in-name", "html-or-svg"]`; BMP, astral and surrogate-boundary bodies reproduce A.1/A.5's
  Unicode-code-point contract, preserve `bodyTruncated` from `readBody` and emit no unpaired surrogate; absent body
  omits both fields; and the
  existing untrusted wrapper is removed before catalogue validation and exactly one target-specific wrapper is added
  later, with no old boundary/tag leakage. Resend also covers each `received | status` subset, continuation across
  cycles, a missing anchor at page ten with staged rows purged/re-baselined plus a gap, sustained high-volume
  pagination, seven-day sent state, half-share and interactive priority. WhatsApp covers
  explicit chat sets and `all-allowed`, old-index rename/crash restore, stanza and fallback multisets with identical
  duplicates and occurrence indices, and a rebuild in which every `Z_PK` changes but every event id, messageId,
  subject, dedupe key and per-chat position remains the same. Two snapshot diffs for a reused stanza id—one adding a
  row with an earlier timestamp and one adding a row with a later timestamp—each leave every prior event id and
  position unchanged and emit exactly the new occurrence. Exact timestamp ties with different normalised content receive the
  same identities in both arrival orders. An exact timestamp tie with identical normalised content is
  indistinguishable by design and emits once for each newly added multiset copy. Repeated stanza ids and identical
  fallback occurrences remain distinct before and after rebuild. It also covers all
  reset signals and the executable-identity spike. A source polls iff an active rule names its live account/type or
  a nonterminal replacement drain temporarily names that scope union; removing the last rule and completing or
  failing the last such drain stops it, and there are no source enable/disable operations.
- **Network:** DNS rebinding on every attempt; all-answer set membership; approved and unapproved globally routable
  and non-globally-routable answers; every non-globally-routable entry in the current IANA IPv4/IPv6 registries;
  IPv4 mapped/compatible, active NAT64, 6to4 and
  Teredo forms; ambiguous transition refusal; unconditional denial of `169.254.169.254`, `fd00:ec2::254` and their
  IPv4/IPv6 Link Local ranges even when listed; approved-set digest drift; SNI/Host preservation; redirects; and the
  exact scheme matrix: HTTPS public in set accepted, HTTPS private in set accepted, HTTP literal `127.0.0.1`/`::1`
  in set accepted for a webhook, HTTP hostname resolving to loopback refused, HTTP private address refused, and a
  local judge accepting only HTTP to one of those literal loopback hosts;
  plain-URL userinfo/query refusal; secret-URL authority/fingerprint mismatch; output scans for the full secret URL;
  and unapproved webhook/local-judge tests. All transports are injected fakes—never Slack, Gmail, Resend or a queue.
- **Control, storage and app:** Unix `0700` parent, same-uid peer/token; Windows pipe/state ACLs; protocol negotiation,
  authentication/error shape, stale recovery, leases, encrypted DB/WAL/free pages, SQLite as the sole event authority,
  and protocol compatibility. Core integration tests cover the disclosure record/method/refusal changes, `app`
  approval channel, audit `app|daemon` plus `origin`, and taint-origin sidecar/old-writer compatibility; daemon tests
  cover its independent secret selector/lock/store and prove core migrations never touch them. Audit vectors
  distinguish requesting origin from daemon execution. Hostile preview fixtures produce
  byte-identical TypeScript/Rust output; fake webview data, digest drift, wrong challenge and per-window commands fail.
  A production-build test from every window, including `secrets`, proves CSP plus navigation/new-window handlers block
  fetch, XHR, WebSocket, EventSource, beacon, remote/passive image and CSS loads, form, navigation, script and frame
  egress while Tauri IPC still works; every non-`secrets` window is denied every secret command and secret bytes occur
  only in the one allowed IPC pair.
  On macOS, Windows and Linux the desktop workflow runs Rust fmt, clippy with warnings denied, tests and an unsigned
  Tauri build.
- **Parity, phases and packaging:** every capability row is driven on CLI and MCP and every exception reason checked;
  dry-run reads, target resume, every named secret operation and event-secret migration have explicit
  terminal/app-only rows and no MCP exposure; no `"agentcomms"` non-channel kind. Both `agentcommsPackage` kinds
  publish in dependency order; an otherwise unknown fixture service appears automatically in publication,
  `SURFACES`, `DRIVERS`, generated CLI/MCP references and executed parity, while an explicit library is the only
  surface-free published kind. Browser import has no `node:` edge; root verify runs the TypeScript desktop/vector
  side. A phase-E gate deliberately removes or stubs B3 secret completion and human-only operations and proves judges
  then refuse to build or ship.

## 6. Out of scope

Mapping transforms and expressions (JSONata, JMESPath), array projection, regular-expression conditions and CEL
expert mode; backfilling history when a source first becomes active or after `enable-all`; a hosted Resend relay;
sending to any provider; native browser `EventSource`; every D15 future design; third-party delivery adapters before
an isolation design; and approving Gmail/Slack/Resend sends from the desktop app. Plain **sanitised** target values
are in scope only through the approved
`untrustedRepresentation: "plain"` contract; unsanitised sender content is never in scope.

## 7. Risks

1. **Future unseen content leaves automatically.** This is the defining risk of a standing disclosure
   authorisation, why chat cannot approve one, why its digest binds every disclosure dimension, and why every active
   grant is visible and immediately revocable.
2. **A same-user hostile process can drive terminal or app.** The existing security policy describes that boundary
   without assigning it a tier (`SECURITY.md:51-63`). Typed challenges and peer/token checks are meaningful against
   accidental and model-only action, not a hostile process with the user's full authority.
3. **Agentic decisions can be wrong or injected.** Their maximum effect is the approved decision path; prefilters,
   exact inputs, no tools, durable caps, uncertainty handling and fail-closed validation limit cost and action, not
   semantic error.
4. **Content exists at rest.** Ingest, outbox and stream replay require retained content. Application-level
   AES-256-GCM keeps plaintext out of SQLite pages, WAL and free-page residue, while approval-bound retention and
   prompt purge bound duration. A same-user process that can use a current installation master key is outside this design's
   protection, as `SECURITY.md:51-63` states.
5. **Provider limits can make polling slow.** Slack may be one call/minute, Gmail can invalidate cursors, and Resend
   shares its budget with interactive work. The schedulers prefer correctness and interactive use over low latency,
   and the app states expected lag rather than promising real time. Gmail received/sent classification and label
   selectors deliberately use the message labels observed by the daemon, not a label snapshot at the mailbox-change
   instant: for an occurrence that remains eligible to be observed, a change during the normal
   at-most-one-poll-interval gap—or the longer gap after downtime or while source collection is disabled—is judged as
   observed. D12's no-backfill rule still means an occurrence skipped wholly inside the global disabled interval
   creates no event. Approval previews therefore say “messages carrying <label> when agentcomms observes them”;
   Gmail-labelled events remain tied to their own history record's additions/removals.
6. **The app is a high-value approval surface.** The authoritative record and digest stay in the daemon; Rust
   re-fetches and text-renders them, custom commands are per-window, and hostile-preview/digest-drift tests are release
   gates.
7. **Desktop distribution can lag the daemon.** Private CUE++ dependencies move the app/build into a private
   repository, and signing/notarisation waits for its separate credentialed release design; neither weakens or delays
   the daemon's safety gates.

## 8. Open questions for the owner

1. **"Leia"** — which model is meant? Nothing by that name was documented in the research; Laya is a different
   publisher and only a candidate for D15's future bundled-judge design.
2. **“Values as they are”** — this design means typed, sanitised source values with no transforms, not provider raw
   bytes. Is that the accepted product meaning?
3. **`@cueplusplus/ui` public, or the app in a private repository?** The packages are MIT but their npm scope is
   private (§2). D14's default, if nothing changes by phase C, is a private repository for the app; publishing
   `@cueplusplus/ui`, `@cueplusplus/tokens` and `@cueplusplus/theme-cue` would let it live in `apps/desktop` here.
4. **Signing identities** — an Apple Developer ID and a Windows code-signing certificate for the app's later release
   job: who holds them?
5. **Defaults** — hosted judges (event fields sent to TypeSafe) are available but every use needs its own standing
   authorisation; should they instead be off unless enabled? And are the default retention values above (24 hours for
   content, 30 days for decision metadata) right for your accounts?

## Appendix A. Version-1 event catalogue (normative)

This appendix is the complete version-1 source-event contract. D3's `EventDefinition` objects, generated JSON Schema,
examples, condition/mapping validation and delivery-schema generation must match it exactly. No implementation may
add a field, make a required field optional, accept `null` where it is not listed, widen an enum or infer another
trust pointer without a new catalogue version.

### A.1 Schema notation and shared definitions

The notation below maps mechanically to JSON Schema 2020-12:

- every listed object is strict (`additionalProperties: false`) at every nesting level;
- every property is required unless its name ends in `?`; an optional property, when present, is never implicitly
  nullable;
- `T | null` is the only nullable form; arrays and their elements are non-null unless shown otherwise;
- `integer(minimum: 0)` is a JSON number with `multipleOf: 1` and the stated minimum;
- `date-time`, `email`, `uri` and `uuid` use their JSON Schema named string formats; `domain` is the catalogue's
  custom semantic-format annotation for an IDNA domain string. Email and domain values also obey D5's
  canonicalisation rules; and
- every JSON Schema `minLength`/`maxLength`, including A.5's body limit, counts Unicode code points as JSON Schema
  2020-12 requires, not ECMAScript UTF-16 code units
  ([JSON Schema validation §6.3.1](https://json-schema.org/draft/2020-12/json-schema-validation#section-6.3.1)); and
- `NonEmptyString` is a JSON string with `minLength: 1`; plain `string` may be empty. Array order is retained unless
  this appendix says the array is canonical-sorted.

Every generated source schema has `$schema: "https://json-schema.org/draft/2020-12/schema"` and exact
`$id: "urn:agentcomms:schema:source:<catalogue-type>:v1"` (for example
`urn:agentcomms:schema:source:gmail.message.received:v1`). It has one closed top-level object, flattens the common
fields and type body into that object, and lists every non-optional property in `required`.

```ts
type EventIdV1 = string;       // pattern ^[0-9a-f]{32}$
type InboxIdV1 = string;       // pattern ^ibx_[A-Z0-9]{16}$
type AccountIdV1 = string;     // pattern ^acc_[A-Z0-9]{16}$
type DateTimeV1 = string;      // format date-time: a valid RFC 3339 instant
type EmailV1 = string;         // format email: canonical address, lower-case IDNA-ASCII domain
type DomainV1 = string;        // format domain: lower-case IDNA-ASCII
type SlackTsV1 = string;       // pattern ^[0-9]+\.[0-9]{6}$

type AddressV1 = {
  address: EmailV1;
  name: string | null;
};

type RiskFlagV1 =
  | 'executable' | 'script' | 'macro-enabled' | 'macro-capable' | 'markup'
  | 'archive' | 'disk-image' | 'double-extension' | 'bidi-filename'
  | 'auto-read' | 'saved-as-download'
  | 'html-or-svg' | 'hidden-characters-in-name';   // emitted as-is by Resend's attachmentRisks
                                                   // (packages/resend/src/compose/inbound.ts:253)

type CommonEventV1<TType extends string, TChannel extends string, TAccountId extends string> = {
  id: EventIdV1;
  type: TType;                 // exact literal for the definition
  version: 1;                 // JSON integer const 1
  occurredAt: DateTimeV1;
  observedAt: DateTimeV1;
  account: {
    name: NonEmptyString;
    id: TAccountId;
    channel: TChannel;         // exact channel literal for the definition
  };
};
```

For Gmail label and Resend status events `observedAt` and `occurredAt` are identical as D3 requires. Gmail message,
Resend received and WhatsApp events are accepted only when the source
timestamp needed for `occurredAt` is present and decodes to a valid instant; Slack `ts` must decode to the same
instant stored in `occurredAt`. A failure to establish those required values is a source-resolution failure, not a
nullable catalogue field.

Gmail `body?` and `hasAttachments?`/`attachments?`, Resend `body?`/`bodyTruncated?` and Resend `attachments?` are the
only lazy catalogue fields. The two Resend body fields are one lazy pair: a reference to either fetches and populates
both. Lazy fields are absent only when no active rule projection asks for them. If a rule condition, judge input or
mapping references one, the adapter must fetch and populate it before schema validation and projection; a real empty
body is `""` with `bodyTruncated: false`, an email with no attachments has
`hasAttachments: false, attachments: []`, and a requested Resend attachment list may be `[]`. Thus “not fetched” is
never represented as `null` and cannot be disclosed accidentally as provider data. A required Gmail or Resend lazy
fetch returning 404 resolves only its affected projections as `vanished`; every other failure follows D3's persisted
backoff for at most 24 hours and then resolves them `unresolvable` with one content-free source-gap record. Either
terminal outcome lets the source cursor advance once every other eligible projection is committed, skipped or
terminally resolved; restart never resets the deadline.
For metadata patterns, an optional property or nullable parent contributes no concrete pointer when absent or null;
when present, the terminal values named by every pattern below have the declared non-null scalar type.

For all seven definitions the first two `formats` entries are exactly
`{pattern:["occurredAt"],format:"date-time"}` and
`{pattern:["observedAt"],format:"date-time"}`. The per-type lists below are complete and include those entries so
there is no implicit metadata.

### A.2 Gmail message received and sent

The two types have the same strict body and differ only in their `type` literal and observation-time classification.

```ts
type GmailAttachmentV1 = {
  name: string;
  type: string;
  size: integer(minimum: 0);
  inline: boolean;
  riskFlags: RiskFlagV1[];     // duplicate-free, canonical-sorted
};

type GmailMessageEventV1<T extends 'gmail.message.received' | 'gmail.message.sent'> =
  CommonEventV1<T, 'gmail', InboxIdV1> & {
    messageId: NonEmptyString;
    threadId: NonEmptyString;
    labels: NonEmptyString[];  // duplicate-free, raw-UTF-8 sorted; [] is allowed
    from: AddressV1 | null;
    replyTo: AddressV1[];
    to: AddressV1[];
    cc: AddressV1[];
    subject: string;
    snippet: string;
    date: DateTimeV1;          // the same Gmail internalDate instant used for occurredAt
    unread: boolean;
    authentication: {
      evaluatedBy: string | null;
      spf: string | null;
      dkim: string | null;
      dkimDomain: DomainV1 | null;
      dmarc: string | null;
      aligned: boolean | null;
      ignoredHeaders: integer(minimum: 0);
    };
    warnings: {
      replyToDiffers: boolean;
      replyToDomains: DomainV1[]; // duplicate-free, raw-UTF-8 sorted
      displayNameContainsOtherAddress: boolean;
      fromDomain: DomainV1 | null;
    };
    hasAttachments?: boolean;
    attachments?: GmailAttachmentV1[];
    body?: string;             // complete sanitised visible text, never an untrusted envelope
  };
```

For each of `gmail.message.received` and `gmail.message.sent`:

```ts
untrusted = [
  ['from','name'], ['replyTo',{any:true},'name'], ['to',{any:true},'name'],
  ['cc',{any:true},'name'], ['subject'], ['snippet'],
  ['attachments',{any:true},'name'], ['attachments',{any:true},'type'], ['body']
];
content = [
  ['from','name'], ['replyTo',{any:true},'name'], ['subject'], ['snippet'],
  ['attachments',{any:true},'name'], ['body']
];
addresses = [
  ['from','address'], ['replyTo',{any:true},'address'], ['to',{any:true},'address'],
  ['cc',{any:true},'address']
];
handles = [];
formats = [
  {pattern:['occurredAt'],format:'date-time'}, {pattern:['observedAt'],format:'date-time'},
  {pattern:['date'],format:'date-time'},
  {pattern:['from','address'],format:'email'},
  {pattern:['replyTo',{any:true},'address'],format:'email'},
  {pattern:['to',{any:true},'address'],format:'email'},
  {pattern:['cc',{any:true},'address'],format:'email'},
  {pattern:['authentication','dkimDomain'],format:'domain'},
  {pattern:['warnings','replyToDomains',{any:true}],format:'domain'},
  {pattern:['warnings','fromDomain'],format:'domain'}
];
```

`subject(event) = event.messageId`. The received dedupe key is canonical JSON of
`[historyRecordId,messageId,"received"]`; the sent key replaces the last literal with `"sent"`. `historyRecordId`
is source-staging identity and is deliberately not a disclosed field.

### A.3 Gmail message labelled

```ts
type GmailMessageLabelledV1 = CommonEventV1<'gmail.message.labelled', 'gmail', InboxIdV1> & {
  messageId: NonEmptyString;
  threadId: NonEmptyString;
  added: NonEmptyString[];     // duplicate-free, raw-UTF-8 sorted
  removed: NonEmptyString[];   // duplicate-free, raw-UTF-8 sorted
};
```

At least one of `added` or `removed` is non-empty, and the same label id may not occur in both arrays for one history
record. `untrusted = []`, `content = []`, `addresses = []`, `handles = []`, and:

```ts
formats = [
  {pattern:['occurredAt'],format:'date-time'},
  {pattern:['observedAt'],format:'date-time'}
];
```

`subject(event) = event.messageId`; `dedupeKey` is canonical JSON of
`[historyRecordId,messageId,"labelled"]`.

### A.4 Slack message posted

```ts
type SlackMessagePostedV1 = CommonEventV1<'slack.message.posted', 'slack', AccountIdV1> & {
  workspaceId: NonEmptyString; // Slack's stable team/workspace id
  ts: SlackTsV1;
  threadTs: SlackTsV1 | null;
  channel: {
    id: NonEmptyString;
    name: string | null;
    kind: 'public_channel' | 'private_channel' | 'im' | 'mpim';
  };
  author: {
    userId?: NonEmptyString;
    botId?: NonEmptyString;
    name: string | null;
    app: boolean;
    external: boolean;
  };
  text: string;
  truncated: boolean;
  mismatch: boolean;
  unrenderable: boolean;
  editedTs: SlackTsV1 | null;
  mentions: {
    kind: 'user' | 'channel' | 'usergroup';
    id: NonEmptyString;
    label: string | null;
  }[];
  files: {
    id: NonEmptyString;
    name: string | null;
    mimeType: string | null;
  }[];
};
```

`author` may omit both ids only when Slack supplied neither; otherwise each present id is non-empty. `mentions`
preserves first appearance across `references` then `fallbackReferences` and removes exact duplicate
`(kind,id,label)` tuples. The metadata is exactly:

```ts
untrusted = [
  ['channel','name'], ['author','name'], ['text'],
  ['mentions',{any:true},'label'], ['files',{any:true},'name'], ['files',{any:true},'mimeType']
];
content = [
  ['channel','name'], ['author','name'], ['text'],
  ['mentions',{any:true},'label'], ['files',{any:true},'name']
];
addresses = [];
handles = [
  {pattern:['channel','id'],workspace:['workspaceId']},
  {pattern:['author','userId'],workspace:['workspaceId']},
  {pattern:['author','botId'],workspace:['workspaceId']},
  {pattern:['mentions',{any:true},'id'],workspace:['workspaceId']},
  {pattern:['files',{any:true},'id'],workspace:['workspaceId']}
];
formats = [
  {pattern:['occurredAt'],format:'date-time'},
  {pattern:['observedAt'],format:'date-time'}
];
```

`subject(event) = event.channel.id + "/" + event.ts`; `dedupeKey` is the same string.

### A.5 Resend email received

```ts
type ResendReceivedAttachmentV1 = {
  id: NonEmptyString;
  filename: string;
  contentType: string | null;
  size: integer(minimum: 0) | null;
  inline: boolean;
  riskFlags: RiskFlagV1[];     // duplicate-free, canonical-sorted
};

type ResendEmailReceivedV1 = CommonEventV1<'resend.email.received', 'resend', AccountIdV1> & {
  emailId: string;            // format uuid
  receivedAt: DateTimeV1;     // same instant as occurredAt
  from: AddressV1 | null;
  replyTo: AddressV1[];
  to: EmailV1[];
  cc: EmailV1[];
  receivedFor: EmailV1[];
  subject: string;
  messageId: string | null;
  attachmentCount: integer(minimum: 0);
  authentication: {
    spf: string | null;
    dkim: string | null;
    dmarc: string | null;
    evaluatedBy: 'resend' | null;
  };
  attachments?: ResendReceivedAttachmentV1[];
  body?: string;              // sanitised visible text; schema maxLength: 20000 Unicode code points, never an untrusted envelope
  bodyTruncated?: boolean;    // present exactly when body is present; true when the source text was longer
};
```

In addition to A.1's ordinary optional-property translation, the generated A.5 JSON Schema contains these exact
keywords (shown as the relevant fragments):

```json
{
  "properties": {
    "body": { "type": "string", "maxLength": 20000 },
    "bodyTruncated": { "type": "boolean" }
  },
  "dependentRequired": {
    "body": ["bodyTruncated"],
    "bodyTruncated": ["body"]
  }
}
```

The bidirectional `dependentRequired` makes the fields mutually required: either both are absent or both are
present. It is not a prose-only validation rule.

When `attachments` is present its length equals `attachmentCount`. **Normalisation from the existing read:** the
source is `showReceived` (`packages/resend/src/operations/read.ts:410`), whose body comes from `readBody`
(`packages/resend/src/operations/read.ts:424`; its plain-text path is
`packages/resend/src/compose/inbound.ts:104` and its cap is at lines 110-112), which already truncates at 20,000
ECMAScript UTF-16 code units and wraps the text in the untrusted envelope. Normalisation unwraps that envelope back
to its sanitised text (the envelope is re-applied at delivery according to the target's representation, D3), removes
a trailing lone surrogate (necessarily a high surrogate) when `slice(0, 20000)` split an astral character, and then validates the result
against the 20,000-Unicode-code-point schema limit and as a well-formed Unicode scalar sequence. Any other unpaired
surrogate is a malformed materialisation response under D3, so no event emits one. `bodyTruncated` remains exactly
`readBody.truncated`; normalisation does not recompute it from the shorter repaired string. It omits
`readBody.totalChars`. This reconciles JSON Schema's character count with ECMAScript's code-unit slicing
([JSON Schema validation §6.3.1](https://json-schema.org/draft/2020-12/json-schema-validation#section-6.3.1),
[ECMAScript `String.prototype.slice`](https://tc39.es/ecma262/2024/multipage/text-processing.html#sec-string.prototype.slice)).
Attachment `riskFlags` are Resend's `attachmentRisks` values unchanged, de-duplicated and sorted. The metadata is:

```ts
untrusted = [
  ['from','name'], ['replyTo',{any:true},'name'], ['subject'],
  ['attachments',{any:true},'filename'], ['attachments',{any:true},'contentType'], ['body']
];
content = [
  ['from','name'], ['replyTo',{any:true},'name'], ['subject'],
  ['attachments',{any:true},'filename'], ['body']
];
addresses = [
  ['from','address'], ['replyTo',{any:true},'address'], ['to',{any:true}],
  ['cc',{any:true}], ['receivedFor',{any:true}]
];
handles = [];
formats = [
  {pattern:['occurredAt'],format:'date-time'}, {pattern:['observedAt'],format:'date-time'},
  {pattern:['receivedAt'],format:'date-time'}, {pattern:['emailId'],format:'uuid'},
  {pattern:['from','address'],format:'email'},
  {pattern:['replyTo',{any:true},'address'],format:'email'},
  {pattern:['to',{any:true}],format:'email'}, {pattern:['cc',{any:true}],format:'email'},
  {pattern:['receivedFor',{any:true}],format:'email'}
];
```

`subject(event) = event.emailId`; `dedupeKey(event) = event.emailId`.

### A.6 Resend email status changed

Version 1 recognises the closed status vocabulary exposed by the current sent-list/event surface; a newly observed
provider status is an adapter/schema failure and requires an explicit catalogue-version decision rather than being
silently accepted as prose. The provider's official OpenAPI `Email.last_event` enum supplies the complete spelling
set ([Resend OpenAPI](https://github.com/resend/resend-openapi/blob/main/resend.yaml)); `scheduled` is also the current
package's pre-cancel state (`packages/resend/src/operations/scheduled.ts:42-50`) and its API fake records the
resulting spelling `canceled` (`packages/resend/test/support/fake-resend.ts:372-377`).

```ts
type ResendStatusV1 =
  | 'scheduled' | 'sent' | 'delivered' | 'delivery_delayed' | 'bounced'
  | 'complained' | 'opened' | 'clicked' | 'failed' | 'suppressed' | 'canceled' | 'queued';

type ResendEmailStatusChangedV1 =
  CommonEventV1<'resend.email.status_changed', 'resend', AccountIdV1> & {
    emailId: string;          // format uuid
    from: AddressV1 | null;
    to: EmailV1[];
    cc: EmailV1[];
    bcc: EmailV1[];
    subject: string;
    createdAt: DateTimeV1 | null;
    scheduledAt: DateTimeV1 | null;
    messageId: string | null;
    previous: ResendStatusV1;
    current: ResendStatusV1;
    at: DateTimeV1;           // first durable observation; equals occurredAt and observedAt
  };
```

`previous !== current`; the first state seen after a status-tracking activation seeds state and emits no event. The
metadata is:

```ts
untrusted = [['from','name'], ['subject']];
content = [['from','name'], ['subject']];
addresses = [
  ['from','address'], ['to',{any:true}], ['cc',{any:true}], ['bcc',{any:true}]
];
handles = [];
formats = [
  {pattern:['occurredAt'],format:'date-time'}, {pattern:['observedAt'],format:'date-time'},
  {pattern:['emailId'],format:'uuid'}, {pattern:['from','address'],format:'email'},
  {pattern:['to',{any:true}],format:'email'}, {pattern:['cc',{any:true}],format:'email'},
  {pattern:['bcc',{any:true}],format:'email'},
  {pattern:['createdAt'],format:'date-time'}, {pattern:['scheduledAt'],format:'date-time'},
  {pattern:['at'],format:'date-time'}
];
```

`subject(event) = event.emailId`; `dedupeKey` is canonical JSON of
`[event.emailId,event.previous,event.current,event.at]`. The staged `at` makes that identity stable across retry/restart.

### A.7 WhatsApp message received

```ts
type WhatsAppChatKindV1 =
  | 'direct' | 'hidden-number' | 'group' | 'status' | 'broadcast' | 'channel' | 'unknown';
type UnknownWhatsAppMessageKindV1 = string; // pattern ^unknown:[0-9]+$
type WhatsAppMessageKindV1 =
  | 'text' | 'image' | 'video' | 'audio' | 'contact' | 'location' | 'group-event'
  | 'link' | 'document' | 'system' | 'gif' | 'waiting' | 'deleted' | 'sticker'
  | 'poll' | 'video-note' | 'call' | 'album' | 'unknown'
  | UnknownWhatsAppMessageKindV1;

type WhatsAppMessageReceivedV1 =
  CommonEventV1<'whatsapp.message.received', 'whatsapp', AccountIdV1> & {
    workspaceId: AccountIdV1;  // exactly account.id; the local account is the handle scope
    messageId: NonEmptyString;  // D4's stanza-or-fallback occurrence identity; never MessageView.id/Z_PK
    chat: {
      id: NonEmptyString;
      name: string | null;
      kind: WhatsAppChatKindV1;
    };
    sender: {
      id: NonEmptyString;
      name: string | null;
    } | null;
    text: string | null;
    at: DateTimeV1;           // same instant as occurredAt
    fromMe: false;            // JSON boolean const false
    kind: WhatsAppMessageKindV1;
    viewOnce: boolean;
    groupEvent: integer(minimum: 0) | null;
    media: {
      type: WhatsAppMessageKindV1;
      mime: string | null;
      size: integer(minimum: 0) | null;
      name: string | null;
    } | null;
  };
```

The `WhatsAppMessageKindV1` JSON Schema is `anyOf` the listed 19-value enum and the
`^unknown:[0-9]+$` pattern; arbitrary strings do not satisfy the final notation branch. The metadata is:

```ts
untrusted = [
  ['chat','name'], ['sender','name'], ['text'], ['media','mime'], ['media','name']
];
content = [['chat','name'], ['sender','name'], ['text'], ['media','name']];
addresses = [];
handles = [
  {pattern:['chat','id'],workspace:['workspaceId']},
  {pattern:['sender','id'],workspace:['workspaceId']}
];
formats = [
  {pattern:['occurredAt'],format:'date-time'},
  {pattern:['observedAt'],format:'date-time'},
  {pattern:['at'],format:'date-time'}
];
```

The event `messageId` is exactly D4's canonical occurrence identity. With a stanza id it is canonical JSON of
`["stanza", stanzaId, timestampMs, tieIndex]`. `timestampMs` is the exact normalised message timestamp in
milliseconds used to construct `at` and `occurredAt`. `tieIndex` is scoped only to rows in that chat with that exact
stanza id and exact `timestampMs`: it is the zero-based rank of the row's distinct canonical normalised-message-field
bytes after sorting first by their SHA-256 digest and then by those bytes. Those bytes are UTF-8 core canonical JSON
of the exact fields used to build this event's message payload—`chat`, `sender`, `text`, `at`, fixed `fromMe: false`,
`kind`, `viewOnce`, `groupEvent` and `media`—before derived `messageId`, `subject` or `dedupeKey` is added. Equal
bytes have one rank and one identity; their multiplicity is counted by the snapshot multiset rather than ordered.
Thus a stanza id reused with the identical timestamp and identical normalised content is indistinguishable by design,
while a row with the same stanza id at an earlier or later timestamp cannot change any other row's identity. Without
a stanza id the identity is canonical JSON of `["fallback", chatId, timestamp, sender, textSha256,
occurrenceIndex]`, where the index is the zero-based multiset slot among identical four-field fallback records.
Rebuilding the index may change every `Z_PK` without changing this identity set. `subject(event) = event.chat.id + "/" +
event.messageId`; `dedupeKey` is the same string.

### A.8 Field provenance and deliberate catalogue changes

The catalogue is a normalised extraction, not a serialization of an existing CLI/MCP result. These are all of the
deliberate differences from the cited result types:

1. The common `id/type/version/occurredAt/observedAt/account` envelope, Slack/WhatsApp `workspaceId`, source
   occurrence keys and all cut-over positions are new event machinery. Slack `workspaceId` is the provider's stable
   team/workspace id; WhatsApp has no provider workspace, so its value is exactly the local `account.id`. Positions
   and Gmail history ids remain internal; they are not event fields. Across mail events, an absent or empty address
   display name normalises to `null`; it is never synthesized.
2. Gmail starts from `ReadMessageResult` (`packages/gmail/src/operations/read.ts:41-68`): `auth` is renamed
   `authentication`, `sender` is renamed `warnings`, attachment `filename/mimeType` become `name/type`, and render,
   retrieval or pagination fields (`inbox`, attachment `partId`/`attachmentId`, envelope, truncation/offset,
   `webLink`, sanitisation diagnostics) are omitted.
   `snippet` is newly selected directly from Gmail's `Message.snippet`; `hasAttachments` is computed; `body` is the
   complete sanitised text before wrapping. Nullable result `date` is narrowed to required because it supplies
   `occurredAt`. `gmail.message.labelled` is wholly new and comes from one Gmail history record's change arrays.
3. Slack starts from `ReadMessage` (`packages/slack/src/text/message.ts:75-135`). `text` is the sanitised inner value
   that produced `enveloped`; it is not an unwrapped result field. `threadTs`/`editedTs` normalise absence to `null`;
   `mentions` filters and merges structured user/channel/usergroup references; `files` normalises absent metadata to
   `[]` and `mimetype` to `mimeType`. `channel` is joined from the current read's channel result, `kind` is computed
   from its Slack flags, and `author.name` is resolved in order: person's display name, person's real name, app
   registered name, chosen message name, else `null`. Reactions, reply counts, raw link URLs and already folded
   attachment/unfurl substructures are omitted; their visible prose is already in `text`.
4. Resend received starts from `ReceivedRow` (`packages/resend/src/operations/read.ts:359-369`): provider `id` is
   renamed `emailId` to avoid colliding with the common event id, numeric `attachments` is renamed
   `attachmentCount`; `replyTo`, `cc`, `receivedFor`, authentication, optional detailed
   attachments and the optional capped sanitised `body` pair come from the same operation's detailed read. Its
   `showReceived` call invokes `readBody` at `packages/resend/src/operations/read.ts:424`; the plain-text branch is at
   `packages/resend/src/compose/inbound.ts:104`, and lines 110-112 compute the 20,000-UTF-16-code-unit cap and
   truncation result. Appendix A's schema limit is instead 20,000 Unicode code points. Normalisation removes the
   read-time untrusted envelope and any trailing lone surrogate (necessarily a high surrogate) created by that slice, rejects any other
   unpaired surrogate, maps `truncated` unchanged to `bodyTruncated`, deliberately omits `totalChars`, and leaves
   target delivery to apply exactly one representation-specific envelope. Nullable
   `receivedAt` is narrowed to required. Resend status
   starts from `SentRow` (`packages/resend/src/operations/read.ts:184-198`): provider `id` becomes `emailId`,
   `lastEvent` becomes closed-enum `current`,
   while `previous` and the durable observation `at` are new state-delta fields; the provider address string is
   parsed into `AddressV1`.
5. WhatsApp starts from `MessageView` (`packages/whatsapp/src/present.ts:59-77`): `content` becomes sanitised `text`,
   but `MessageView.id` is deliberately omitted because it is the rebuild-sensitive `ZWAMESSAGE.Z_PK` and is **not**
   the event `messageId`. The source instead computes A.7's stanza-or-fallback occurrence identity before
   normalisation; a stanza identity is timestamp-scoped and ranks only different canonical bytes of the normalised
   message fields that build this payload, while identical bytes remain one multiset identity. That identity supplies
   `messageId`, `subject`, `dedupeKey` and the per-chat high-water ordering.
   `sender.jid` becomes `sender.id` (a sender with no usable JID normalises the whole
   `sender` value to `null`), each `UntrustedField` becomes its safe inner text, and absent `groupEvent` normalises
   to `null`. `chat` is joined from `ChatView`; read-only rendering diagnostics and analysed links are omitted.
   `fromMe` is narrowed to literal `false`, and nullable `at` is narrowed to required, because this event is only an
   inbound message with a usable occurrence time.

Phase A keeps a canonical machine-readable transcription of A.1–A.7 as a test fixture. The test generates JSON
Schema and metadata from each `EventDefinition`, recursively key-sorts them and compares exact bytes with that
fixture, then checks the fixture's field/pointer inventory against the appendix headings. Changing either side
without the other fails `pnpm verify`.
