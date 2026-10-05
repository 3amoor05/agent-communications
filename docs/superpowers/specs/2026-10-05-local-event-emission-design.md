# Local event emission — design

Status: **revised after design review round 1, 2026-10-05 — 10 P1 and 6 P2, all addressed**; specification only,
not an implementation. Written from the cited research pass (§2) and a checked read of this repository at
`fc9c5cc`. This design adds a new **standing disclosure authorisation**; it does not treat recurring event delivery
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

### In this repository (at `fc9c5cc`)

| Fact | Source |
|---|---|
| There is no event daemon or source scheduler. Existing long-lived work is bounded: a lock-renewal interval, sign-in polling, detached OAuth listeners and a detached update-check child. | `packages/core/src/lock.ts:219-229`; `packages/gmail/src/operations/signin.ts:330-349,653-695`; `packages/core/src/update-check.ts:329-358` |
| Gmail's transport has no `history.list` or `watch`; `getProfile` returns `historyId`. Its request guard refuses `/batch` and unpermitted `/send`, and a read-only history request would not match either refusal. The base design made push/watch a 0.1 non-goal and put `history.list` watch on the roadmap. | `packages/gmail/src/gmail-api/transport.ts:25-82,185-235,334-341`; `docs/superpowers/specs/2026-09-18-agent-communications-design.md:56-64,1154-1160` |
| Slack uses a closed method table; `conversations.history` and `conversations.replies` are allowed reads, while `apps.connections.open` is explicitly refused. Generated manifests disable Socket Mode. Calls obtain a live user token through `openWorkspace`; refresh is single-use-aware and serialised by an in-process map plus a file lock. History reads are inclusive and 429s expose `Retry-After`. | `packages/slack/src/api/methods.ts:116-228`; `packages/slack/src/manifest.ts:135-150`; `packages/slack/src/operations/session.ts:131-145`; `packages/slack/src/auth/refresh.ts:172-184,210-273`; `packages/slack/src/operations/read.ts:135-151`; `packages/slack/src/api/call.ts:431-442` |
| Resend deliberately refuses `/events` and `/webhooks`. `last_event` is exposed by the on-demand, cursor-paginated sent-email read; nothing polls it today. A sending-only key returns unavailable without making a read request. All processes and accounts share the one-request-per-500-ms throttle. | `packages/resend/src/api/routes.ts:17-20,142-159`; `packages/resend/src/operations/read.ts:59-84,184-245`; `packages/resend/src/api/throttle.ts:6-29` |
| WhatsApp `sync` snapshots the store, checks it and fully rebuilds the index by atomic replacement. Message rows expose both `Z_PK` and nullable `ZSTANZAID`; the current read identity is the numeric `Z_PK`. A source file operation waits at most 12 seconds for the macOS privacy prompt. | `packages/whatsapp/src/operations/sync.ts:45-113`; `packages/whatsapp/src/index-db.ts:117-139,162-167,203-222,242-277`; `packages/whatsapp/src/source/read-source.ts:120-165`; `packages/whatsapp/src/source/snapshot.ts:85-99,120-125` |
| Core's envelope uses `node:crypto`; Gmail and Resend-received reads flush taint before returning. Slack, WhatsApp and Resend-sent reads have no corresponding taint collector, although core already supports scoped handles. | `packages/core/src/untrusted.ts:1-3,99-120`; `packages/gmail/src/operations/read.ts:300-315,339-361`; `packages/resend/src/operations/read.ts:335-357,371-399`; `packages/core/src/taint.ts:95-120,401-429` |
| Per-inbox runtime state accepts only `ibx_` ids, so it cannot hold cursors for the generic `acc_` accounts. | `packages/core/src/state.ts:20-29` |
| Audit records and provider contexts currently type their surface as only `'cli' | 'mcp'`. | `packages/core/src/audit.ts:20-35`; `packages/gmail/src/context.ts:28-42` |
| `classifyChange` already judges mailbox/account send and change policies, internal domains, account mode, risk escalation, update checks, send caps, attachment roots and denies, downloads, elicitation clients and secret-store downgrades. It does not know events configuration yet. | `packages/core/src/config.ts:1375-1483,1487-1548` |
| The channel manifest is a strict object, so an unknown `events` key is refused; its `hosts` field is expressly declared but not enforced. | `packages/core/src/channel-manifest.ts:43-112,170-224` |
| The publish list is derived from packages with channel manifests and the server wrappers those manifests name. A non-channel library or service has no declaration that puts it in that list. | `scripts/packages.mjs:1-37`; `docs/superpowers/specs/2026-09-26-channel-plugins-design.md:110-125` |
| WhatsApp already uses `node:sqlite`, and its package requires Node 22.16 or newer. Core itself requires Node 22.12 and its untrusted envelope imports `node:crypto`, so neither is an isomorphic dependency for a browser-safe package. | `packages/whatsapp/src/index-db.ts:1-18`; `packages/whatsapp/package.json:1-10`; `packages/core/package.json:1-10`; `packages/core/src/untrusted.ts:1-3` |
| Credentials in model context are already a security-policy violation, and terminal-only approval is already an explicit parity exception. | `SECURITY.md:28-33`; `capabilities.json:241-254,566-571` |

### Outside it (checked 2026-10-05; first-party or primary sources)

| Fact | Source |
|---|---|
| Gmail `history.list` is cursor-paginated, history IDs are non-contiguous, an expired cursor normally returns 404, and the final `historyId` is stored only when no `nextPageToken` remains. Specific change lists can duplicate the generic `messages` list. | [Gmail `users.history.list`](https://developers.google.com/workspace/gmail/api/reference/rest/v1/users.history/list) |
| Slack has separate paginated history and replies methods. Its rate-limit notice establishes a conservative regime of one call per minute and 15 results for affected new non-Marketplace apps; newly created internal apps must be assumed subject to it unless Slack grants an increase. | [Slack rate-limit notice](https://api.slack.com/changelog/2025-05-terms-rate-limit-update-and-faq), [`conversations.replies`](https://docs.slack.dev/reference/methods/conversations.replies/) |
| Resend's received and sent lists are cursor-paginated, and the sent list exposes only the current `last_event`. | [Resend received list](https://resend.com/docs/api-reference/emails/list-received-emails), [Resend sent list](https://resend.com/docs/api-reference/emails/list-emails) |
| CloudEvents 1.0 requires `id`, `source`, `specversion` and `type`; extension values use the CloudEvents scalar type system. Standard Webhooks signs `id.timestamp.payload`, serialises symmetric secrets with `whsec_`, serialises a signature as `v1,<base64>`, and supports overlapping signatures for rotation. | [CloudEvents 1.0.2](https://github.com/cloudevents/spec/blob/v1.0.2/cloudevents/spec.md), [Standard Webhooks specification](https://github.com/standard-webhooks/standard-webhooks/blob/main/spec/standard-webhooks.md) |
| JSON Pointer has no wildcard; tokens escape `~` as `~0` and `/` as `~1`. Native `EventSource` accepts a URL and `withCredentials`, not an arbitrary Authorization header. | [RFC 6901](https://www.rfc-editor.org/rfc/rfc6901), [HTML Standard: server-sent events](https://html.spec.whatwg.org/multipage/server-sent-events.html) |
| TypeSafe documents Jev through its hosted System One API, Noul as a 0–1 yes/no probability, and current model limits, but the reviewed published artefacts and terms provide no local weights or self-hosting contract. Ollama also returns a 0–1 probability for Noul. | [TypeSafe quick start](https://docs.typesafe.ai/introduction/quickstart), [TypeSafe models](https://docs.typesafe.ai/models), [Ollama decisions](https://docs.ollama.com/capabilities/decision) |
| The documented near-name is Laya, from a different publisher. Its published usage is a Transformers-style decision head and it offers an ONNX Runtime extra. | [Laya model page](https://huggingface.co/convaiinnovations/laya) |
| Tauri registers custom commands for all windows/webviews by default unless the application constrains them with `AppManifest::commands`; capability files alone are not that command declaration. | [Tauri capabilities](https://v2.tauri.app/security/capabilities/) |

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

**Approval rule.** Enabling or loosening any rule, target, subscriber or hosted judge always needs approval outside
the chat, regardless of `changePolicy`: either `agent-events approve <id>` at the human terminal, or the desktop app's
typed-challenge flow (D13). `chat` may prepare and explain a proposal, but can never claim this authorisation. This is
deliberately stricter than ordinary changes because it authorises later disclosures the person has not seen.
Loopback SSE subscribers and hosted-judge inputs count as disclosures.

The daemon creates an immutable pending version and a deterministic preview. Its digest binds all of:

- the **rule version**: event type and version, every deterministic and agentic condition, and the mapping with every
  output field and the source pointer from which it comes;
- the **target version**: kind, scheme, host, port, resolved-address policy (including `localNetwork`) and
  `untrustedRepresentation`;
- the **subscriber version**, when present: stream identity, accepted Origin set and replay retention;
- the **judge version**, when present: provider, model, endpoint, prompt-template version and the exact input fields;
- all content, decision, stream and dead-letter **retention** values; and
- the rule's **delivery rate cap**, default 60 deliveries per rolling hour. Raising it is a loosening.

Every active authorisation, its versions, digest, approval time, retention and remaining rate-cap window appears in
`agent-events doctor` and the app. Nothing is enabled by install, update or import.

**Version rule.** Rules, targets, subscribers and judges are immutable versioned objects. A decision and every
delivery bind `(ruleId, ruleVersion, targetId, targetVersion[, subscriberId, subscriberVersion])`; an agentic
decision also binds `(judgeId, judgeVersion)`. Delivery uses exactly those versions and never follows a mutable id to
a different endpoint.

- A loosening edit creates a pending version. The approved active version keeps running until the pending version
  receives a new standing disclosure authorisation.
- A tightening edit — disabling or removing an object, narrowing conditions or mapping, reducing retention or the
  rate cap, removing a target, changing `plain` to `enveloped`, or turning off `localNetwork` — atomically replaces
  the active version with the narrowed version or an immutable disabled/tombstone version. In the same transaction,
  every queued or retryable delivery made under the superseded version becomes `cancelled` with an audit record. It
  is never sent and never re-mapped.
- Revocation is immediate at the committed disable/remove transaction. A worker must move a delivery to
  `disclosing` under the same record lock immediately before I/O; after revocation commits, no worker can cross that
  boundary. An I/O that crossed it before revocation is recorded as already in flight and cannot be recalled.

**Secrets never enter model context.** Creating, entering, revealing or rotating a webhook signing secret, subscriber
token or judge API key is a human-only action in the terminal or app. Terminal entry requires the existing TTY and
agent-marker checks (`packages/core/src/change-flow.ts:208-210,291-320`;
`packages/core/src/cli-runtime.ts:36-60`); any key typed by the person uses hidden input. MCP tools never accept or
return secret material. An MCP-proposed
target, subscriber or hosted judge is created incomplete and disabled; the person completes its secret slot in the
terminal or app. Signing-secret and token rotation changes generations inside a referenced secret slot, not the
authorised disclosure fields: two signing generations may overlap (D7), but secret bytes and generations are absent
from the preview and audit.

These human-only secret commands and app operations receive `status: "exception"` rows in `capabilities.json`, with
the reason: "secret material must never enter model input or output; the person completes this operation at the
terminal or app." This follows the existing terminal-only `approve` exception (`capabilities.json:241-254`) and the
rule that a token is never accepted through chat because the transcript retains it
(`docs/superpowers/specs/2026-09-25-cli-mcp-parity-design.md:81-90`). Credential exposure to model context is already
in scope as a vulnerability (`SECURITY.md:32-33`).

**Required `SECURITY.md` amendment.** Phase B1 adds the following exact bullets; this specification does not edit
`SECURITY.md` itself:

> - **Disclosure without a standing authorisation** — any webhook, subscriber stream or hosted judge receiving
>   event-derived content without an active, digest-bound standing disclosure authorisation for the exact rule,
>   target, subscriber and judge versions; after that authorisation is revoked; outside its approved mapping,
>   retention or delivery rate cap; or without successful taint recording before disclosure.

and, under "What the safety model does not claim":

> - **A standing disclosure authorisation is not approval of each event.** Once a person enables one at the terminal
>   or in the app, future unseen content that matches its approved rule may leave automatically through its approved
>   target or hosted judge. `agent-events doctor` and the app list every active authorisation. Disabling or removing
>   any bound rule, target, subscriber or judge revokes it immediately; content already in a network operation cannot
>   be recalled.

### D3. The event catalogue: typed, versioned, and explicit about trust

Every event type is a definition in `@agentcomms/events`:

```ts
type PointerPatternToken = string | { readonly any: true };
type PointerPattern = readonly PointerPatternToken[];

interface EventDefinition<T> {
  type: string;                         // 'gmail.message.received'
  version: number;                      // a breaking change creates another retained version
  channel: 'gmail' | 'slack' | 'resend' | 'whatsapp' | 'agentcomms';
  schema: z.ZodType<T>;                 // JSON values only; ISO strings, no Date or transforms
  untrusted: readonly PointerPattern[]; // sender-controlled prose
  content: readonly PointerPattern[];   // fields that can make an agentic prefilter selective
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

Every event carries `{ id, type, version, occurredAt, observedAt, account: { name, id, channel }, hop }` and its own
body. `hop` is zero for provider events and is bounded as D12 specifies. Version 1 includes:

| Type | Body (abridged) | Sender-controlled patterns |
|---|---|---|
| `gmail.message.received` | `messageId, threadId, labels[], from{address,name}, to[], cc[], subject, snippet, date, hasAttachments, attachments[{name,type,size}], body?` | `["from","name"]`, `["subject"]`, `["snippet"]`, `["attachments",{"any":true},"name"]`, `["body"]` |
| `gmail.message.sent` | as received, from the sending mailbox | subject, body, display and attachment names |
| `gmail.message.labelled` | `messageId, threadId, added[], removed[]` | — |
| `slack.message.posted` / `.edited` | `ts, editedTs?, channel{id,name,kind}, user{id,name}, text, threadTs?, files[]` | text and names |
| `resend.email.received` | `id, from, to[], subject, receivedAt, attachments[]` | sender, subject and attachment names |
| `resend.email.status_changed` | `id, to[], subject, previous, current, at` | subject |
| `whatsapp.message.received` | `id, chat{id,name,kind}, sender{id,name}, text, at, media?` | text and names |
| `agentcomms.source.degraded` / `.gap` / `.recovered` | `source, account, reasonCode, since` | — |
| `agentcomms.delivery.dead_lettered` | `target, eventId, attempts, errorCode` | — |

Bodies or file metadata are fetched only when an enabled rule version's condition, judge input or mapping references
them. Sender-controlled prose always passes through the existing HTML/plain-text sanitiser before either
representation below (`packages/core/src/sanitize.ts:1037-1122`); the catalogue stores paths, not already enveloped
values.

Three independent mechanisms must not be conflated:

1. **Prose representation.** Each target version chooses `untrustedRepresentation: "enveloped" | "plain"`.
   `enveloped` is the default and replaces each sender-controlled string with the existing
   `<untrusted-content>` envelope (`packages/core/src/untrusted.ts:99-120`). `plain` delivers the sanitised value as
   is — the owner's "value as is" — and is a loosening whose approval preview warns: "A consumer that feeds this
   value to a model must envelope it first." Local SSE subscribers default to `enveloped`.
2. **Address and handle taint.** This is always computed from the exact final target payload or judge input and
   flushed before disclosure, regardless of prose representation (D7).
3. **Other untrusted text.** Provider and target error messages are sanitised, bounded and rendered as untrusted in
   logs and the app; audit rows keep only stable codes and hashes. A judge's optional `reasonCode` must match
   `^[a-z0-9_]{1,40}$` and is labelled **model-produced**, never presented as provider fact or configuration.

For each mapping, a sender-controlled source value intersects when its concrete pointer equals, is an ancestor of, or
is a descendant of an expanded untrusted pointer. Copying a parent object therefore transforms each untrusted string
descendant separately and lists the corresponding output pointer; copying an untrusted subtree recursively transforms
its string leaves. The generated JSON Schema for each rule/target version describes the actual delivered
representation, including envelope strings when selected.

### D4. Sources: polling first, with complete cursors and reset detection

| Source | Version 1 | Later |
|---|---|---|
| Gmail | Poll `users.history.list` from the stored `historyId`. Follow every `nextPageToken` before committing the final response's `historyId`. An occurrence key is `(historyRecordId, messageId, changeType)`; use the specific change arrays, not duplicate generic entries. `messageAdded` with `DRAFT` is ignored; with `SENT` and not `DRAFT` it is sent; without either it is received. `SPAM` and `TRASH` are excluded unless the rule opts in. Label changes are emitted separately. A 404 re-baselines at `getProfile().historyId` and emits `agentcomms.source.gap`, with no silent backfill. These rules implement Gmail's pagination and change model ([Gmail `history.list`](https://developers.google.com/workspace/gmail/api/reference/rest/v1/users.history/list)). | `watch` plus Pub/Sub pull may wake the same reconciliation path; it never replaces `history.list`. |
| Slack | Poll only conversations named by active rule versions. Dedupe posts on `(channelId, ts)` and edits, when enabled, on `(channelId, ts, edited.ts)`. When a thread's `latest_reply` advances, call `conversations.replies` and ingest its new replies; `conversations.history` alone is not a reply source. One round-robin scheduler per workspace owns a request budget derived from the configured tier and revised downward from observed 429/`Retry-After`. It must support the conservative one-call/minute, 15-result regime for affected new non-Marketplace and newly created internal apps unless Slack grants an increase ([Slack notice](https://api.slack.com/changelog/2025-05-terms-rate-limit-update-and-faq)). The app shows expected worst-case latency from named-conversation count, pending reply pages and that budget. | Socket Mode remains phase F's real-time path. |
| Resend | `received.list` is paged newest-first until the stored last-seen received id appears, then that id advances only with committed ingest. The sent list is paged newest-first through every id from the most recent seven days. Those ids have rows in a state table for seven days; each read compares `last_event` with the stored value and emits only a change. The UI says these are observed states, not every intermediate transition. The daemon may consume at most half the machine-wide throttle and an interactive CLI/MCP call always takes the next available slot. | A signed hosted relay for Resend webhooks is a separate product. |
| WhatsApp | Run the existing snapshot-and-rebuild sync (`packages/whatsapp/src/operations/sync.ts:45-113`), then diff indexes. Identity is `ZSTANZAID` when present, otherwise `(chatId, timestamp, sender, SHA-256(text))`. Exact duplicate fallback rows coalesce; if two non-identical rows share that fallback key, emit `agentcomms.source.gap` with `fallback_key_collision`, do not advance that chat's baseline, and surface the collision for repair. A decrease in maximum `Z_PK`, an index-format change, or disappearance of a previously retained non-empty stanza-id set is a store reset: re-baseline and emit a gap rather than treating old high-water marks as current. macOS privacy control identifies an app or binary by bundle id/file path plus its code-signing requirement ([Apple Platform Deployment](https://support.apple.com/en-gb/guide/deployment/dep38df53c2a/web)); the grant must therefore be made by the same executable identity that later reads the store. An app-launched daemon and a service-launched one require separate grants. A phase-D spike verifies that identity behaviour before background collection ships. | A file-system notification may wake the same safe snapshot path; it never reads the live store. |

Slack opens a fresh `openWorkspace` session for every poll and never caches credentials across polls, matching the
current token boundary (`packages/slack/src/operations/session.ts:131-145`;
`packages/slack/src/auth/refresh.ts:172-184`). Its workspace scheduler is shared by daemon jobs. Resend goes through
the existing shared machine throttle (`packages/resend/src/api/throttle.ts:6-29`), with the new priority and half-share
rules above. Both fairness rules have deterministic scheduler tests.

In one SQLite transaction, a source writes every normalised occurrence to encrypted `ingest` and advances its cursor.
The durable evaluation contract is D8; a cursor never advances over an event that exists only in memory. Polling does
not update the interactive `lastUsedAt` field that current Gmail reads update
(`packages/gmail/src/operations/read.ts:314-315,359-360`); sources record `lastPolledAt`.

Each source is an operation in `packages/<channel>/src/operations/events.ts`, tested against that channel's existing
fake (`packages/gmail/test/support/fake-google.ts:1-20`; `packages/slack/test/support/fake-slack.ts:7-12`;
`packages/resend/test/support/fake-resend.ts:8-12`; `packages/whatsapp/test/support/harness.ts:1-20`). A channel
manifest gains an optional `events` declaration describing types, minimum interval and required scopes/key kind; the
current strict schema has no such key (`packages/core/src/channel-manifest.ts:170-224`), so this is an intentional
versioned extension of the channel contract, not a free-form field.

### D5. Conditions

**Deterministic** — a tree that can always be rendered back as a sentence:

```ts
type Condition =
  | { all: [Condition, ...Condition[]] }
  | { any: [Condition, ...Condition[]] }
  | { not: Condition }
  | { path: string; op: 'exists' }
  | { path: string; op: 'equals' | 'notEquals'; value: Scalar; caseSensitive?: boolean }
  | { path: string; op: 'contains'; value: Scalar; caseSensitive?: boolean }
  | { path: string; op: 'startsWith' | 'endsWith'; value: string; caseSensitive?: boolean }
  | { path: string; op: 'in'; values: [Scalar, ...Scalar[]] }
  | { path: string; op: 'gt' | 'gte' | 'lt' | 'lte'; value: number | string }
  | { path: string; op: 'domainIs'; value: string; includeSubdomains: boolean };
```

- `path` is a concrete JSON Pointer validated against the selected event schema. Empty `all`, `any` and `in` arrays
  are refused at save; values must have the schema's exact type.
- A missing path is false for every leaf except a negated `exists`. `in` means the path's scalar value is one of
  `values`. `contains` means substring for strings and element membership for arrays, with `value` having the array
  schema's element type. `startsWith`, `endsWith` and case sensitivity are string-only.
- String comparison applies NFC and then Unicode Default Case Folding when case-insensitive; it never uses locale
  casing. Numbers do not coerce. Date operands are valid RFC 3339 instants checked at save and compared as instants;
  invalid dates are refused.
- `domainIs` is legal only for an address/domain field. Its value is normalised and saved as an exact IDNA-ASCII
  domain; it matches that domain only unless `includeSubdomains` is true.
- No regular expressions in version 1. Limits: depth 8, 64 nodes, scalar value 1 KB, `in` 256 values. The tree is
  saved; its sentence is generated.

**Agentic** — a question put to a judge after a real deterministic prefilter:

- `{ judgeId, judgeVersion, question, inputs: JsonPointer[], threshold, onUncertain }`. At least one deterministic
  leaf must reference a catalogue `content` field; account/type checks alone do not qualify.
- The judge sees only `inputs`, sanitised and enveloped in a fixed versioned prompt. Hosted input is taint-flushed
  before the call (D7). It has no tools, secrets or authority.
- An adapter returns one provider-native probability `p`, clamped to `[0,1]`; it never accepts a provider-supplied
  `match`. The daemon clamps `threshold` to `[0,1]` and derives match as `p >= threshold`. The uncertain band is
  `max(0, threshold - 0.1) <= p < threshold`. `onUncertain` is `no-match` by default or `hold`; only the terminal or
  app can resolve a hold.
- TypeSafe/Ollama Noul values are labelled **probability**. A generic JSON-output model's number is labelled
  **uncalibrated score**, never Noul probability. `reasonCode`, if any, follows D3.
- A timeout, malformed response or exhausted budget is no-match and degrades the judge. The stored decision records
  provider, model and judge versions, prompt-template version, threshold, value/label and reason code. Retries never
  re-ask.
- Before a call, one transaction durably reserves against per-rule, per-provider and global call/token caps and a
  global concurrency limit of 2. The reservation is settled to reported usage afterward. A call that times out after
  it may have been billed consumes its call and the reserved maximum tokens; it is never refunded on uncertainty.

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
including whole objects and arrays. `missing` is `reject` (default), `omit` or `null`. There are no transforms,
expressions or array projections. Limits are 256 KB per mapped event, 200 leaves and 4 KB per constant.

Trust propagation uses D3's expanded paths in both directions. With `enveloped`, every intersecting string is replaced
by D3's envelope; with `plain`, it is the sanitised string. The mapping preview shows both representations and every
resulting untrusted output pointer.

The delivered envelope is CloudEvents structured JSON:

- `specversion` is exactly `"1.0"`;
- `id` is the decision id, stable across retries; `type`, `subject`, `time` and `datacontenttype` follow the selected
  event; and `source` is `urn:agentcomms:<installation>:<account>`, with installation and account components
  percent-encoded as UTF-8 RFC 3986 components;
- `dataschema` identifies the generated schema for the exact `(ruleVersion, targetVersion)`, and that schema describes
  the representation actually delivered in `data`;
- `agentcommsrule` is a string `<percent-encoded-rule-id>@<version>`;
- `agentcommsuntrusted` is a CloudEvents **string** extension: unique concrete JSON Pointers into `data`, sorted by
  raw UTF-8 bytes, each RFC 3986 percent-encoded with uppercase hex, then joined by commas. It is omitted when there
  are none. The empty string means the one root pointer `""`; a root pointer subsumes descendants. This is the
  canonical scalar encoding, not a JSON array.

Standard Webhooks removes `whsec_`, base64-decodes the suffix, and uses it as the HMAC-SHA256 key over the exact
transmitted bytes `webhook-id + "." + webhook-timestamp + "." + body`. The symmetric secret shown to a human is
`whsec_<base64>` and the signature is
`webhook-signature: v1,<base64>`. Rotation keeps two active secret generations for a bounded overlap and sends both
space-separated `v1` signatures. Consumer documentation and examples require raw-body verification, constant-time
comparison, the stable id as an idempotency key and a five-minute timestamp tolerance
([Standard Webhooks](https://github.com/standard-webhooks/standard-webhooks/blob/main/spec/standard-webhooks.md)).

### D7. Targets, network boundaries, taint and delivery promises

| Target | Version 1 contract |
|---|---|
| **Webhook** | HTTPS `POST` of the exact CloudEvent bytes, Standard Webhooks signed. Success is 2xx. Retry with capped exponential backoff and jitter until success, but no later than 24 hours and no more than 20 attempts; then `dead-lettered`. Promise: **bounded at-least-once attempts**, not unconditional receipt. |
| **Local SSE stream** | `GET /v1/streams/<subscriber>` on 127.0.0.1/::1. Each subscriber has an encrypted retained stream log, default 24 hours and maximum 7 days, bound into its standing authorisation. `Last-Event-ID` replays entries still in that window. There is no acknowledgement, so the promise is only **available for replay within the approved window**, never receipt or processing. |
| Socket.IO, JetStream, Redis Streams, Pub/Sub, EventBridge/SQS, QStash, Trigger.dev | Later, first-party delivery code inside the daemon. Each future target needs its own reviewed guarantee, authorisation fields and network boundary. |

Webhook payloads are deleted after a 2xx; SSE payloads are deleted after their subscriber window expires. A
dead-lettered webhook payload remains encrypted only for its approved dead-letter retention, default seven days, then
is deleted; dropping it deletes it immediately. When one decision has both target kinds, each target's copy follows
its own rule.

**Taint before any disclosure.** Before webhook network I/O, before appending an SSE event to a subscriber-readable
log, and before a hosted-judge call, the daemon scans the exact target-specific bytes/value that will be disclosed
for addresses and platform handles. It records them in core's taint store under the originating source
(`gmail-event`, `slack-event`, `resend-event`, `whatsapp-event`) and proceeds only after `flush` succeeds. On failure,
nothing is posted, appended or called; the step remains retryable. This preserves the current fail-closed collector
contract (`packages/core/src/taint.ts:273-285,426-429`) while making event taint per source from phase B1 onward,
instead of deferring the mechanism to phase D.

**Webhook resolution.** On every connection, not only at approval, the daemon resolves the target host itself and
refuses if any answer is loopback, RFC 1918 private, IPv6 ULA, link-local, multicast, unspecified, CGNAT
`100.64.0.0/10`, a known cloud-metadata address, or an IPv4-mapped/compatible encoding of any refused address.
`localNetwork: true` in the approved target version permits those listed address classes, including an otherwise
refused metadata address. The connector selects only a vetted resolved IP and pins the connection to it while
retaining the original hostname for TLS SNI and `Host`. Redirects are never followed. The approval preview shows
scheme, original host, port, policy and whether HTTP is permitted; plain HTTP is accepted only for an approved
`localNetwork` target.

`target test` runs only for an already approved target version, or from the terminal/app against a pending version as
part of its approval. MCP cannot test an unapproved target, so it cannot turn proposals into SSRF probes.

**SSE authentication.** A fetch-streaming client sends `Authorization: Bearer <subscriber token>`. Native browser
`EventSource` is unsupported in version 1 because its constructor supplies no arbitrary Authorization header
([HTML Standard](https://html.spec.whatwg.org/multipage/server-sent-events.html)). Tokens never appear in query
strings or cookies. Requests with `Origin` are refused unless that exact origin is in the approved subscriber
version; preflight is not enabled. `Host` is checked against the listener's fixed local authority.

### D8. Durable ingest, decisions and outboxes

One SQLite database, `<stateDir>/events/events.sqlite`, is owned only by `agent-events run`:

- `cursors(source, account, cursor, updatedAt)`;
- `ingest(eventId, type, version, account, dedupeKey, occurredAt, observedAt, ciphertext, nonce, tag, enabledRules)`;
- `decisions(id, eventId, ruleId, ruleVersion, outcome, judge…, UNIQUE(eventId, ruleId, ruleVersion))`;
- `deliveries(decisionId, ruleVersion, targetId, targetVersion, subscriberId?, subscriberVersion?, ciphertext,
  attempts, nextAt, state, leaseUntil, lastError,
  UNIQUE(decisionId, targetId, targetVersion, subscriberId, subscriberVersion))`;
- `stream_log(subscriberId, subscriberVersion, eventId, ciphertext, expiresAt)`;
- source-specific cursor/state tables, judge-budget reservations and worker leases.

The source transaction inserts each encrypted normalised event and advances its cursor together. An ingest row is
kept until every rule version that was enabled at ingest has a terminal decision and every held decision is resolved;
then it is purged. A crash before or after cursor commit, decision insert, judge response or delivery creation
re-evaluates from ingest, with the uniqueness constraint absorbing repeats. Delivery retries use the stored payload
and exact versions; they never re-evaluate, re-map or re-ask a judge.

All content-bearing blobs — ingest, deliveries and stream entries — are encrypted in the application with AES-256-GCM
under one random per-installation key held only in the secret store. Every write uses a unique 96-bit nonce and AAD
binding table, row id and version. SQLite receives ciphertext, nonce and tag, never plaintext payloads, so WAL and
free-page residue contain ciphertext too. Metadata needed to schedule and audit remains plaintext. Key loss makes
retained content unrecoverable and is reported by `doctor`; there is no plaintext fallback.

While evaluation is paused by the required-update gate, source polling pauses as well: the daemon never advances
cursors while it cannot decide retained events. `rule test` uses still-retained ingest rows for recent events; if no
suitable row remains, it performs a fresh provider read without advancing the source cursor and delivers nothing.

Workers claim rows with expiring leases. On restart an expired lease returns to its prior retryable state. Ordering,
when enabled, is only by `(rule, account, target)`, so one failing destination does not block another. The rule's
approved rolling-hour rate cap is reserved transactionally before a delivery claim.

Decision metadata defaults to 30 days; dead-letter payload retention defaults to seven days; SSE defaults to 24
hours. The person may lower retention immediately. Raising it or changing any disclosure-bound retention needs a new
standing authorisation.

### D9. Where configuration lives

`config.json` gains `events: { enabled, sources{}, rules{}, targets{}, judges{}, subscribers{} }`, containing immutable
version records, active/pending pointers and secret references only. Payloads, cursors, decisions and leases are
runtime state in D8; secret bytes remain in the secret store.

`classifyChange` learns the events key, but its ordinary `chat|confirm` result does not grant standing disclosure.
It classifies tightening so it can apply immediately and identifies a proposed loosening for the preview; D2 then
requires the dedicated out-of-chat authorisation whatever the ordinary policy. The current classifier's existing
safety fields remain unchanged (`packages/core/src/config.ts:1375-1483,1487-1548`).

There is no mutable "current target" behind a delivery. Active pointers move only in the atomic transitions in D2,
and queued rows hold exact versions. This resolves the old contradiction: **loosening keeps the approved version
running; tightening replaces it and cancels superseded queued work**.

Supported older releases preserve the unknown top-level `events` value without acting on it because their config
roots are loose and writes serialise the parsed value (`packages/core/src/config.ts:468-485,545-568,949-951`). The
events release must include a compatibility fixture proving each still-supported older reader does not erase it.

### D10. Control surfaces and parity

Every non-exception capability is one operation in `packages/events-daemon/src/operations`, exposed by the
`agent-events` CLI and MCP server, and represented by a `capabilities.json` row:

| Area | Operations |
|---|---|
| Catalogue | `catalogue list`, `catalogue show <type>` |
| Sources | `sources list`, `source enable|disable`, `source show` |
| Rules | `rules list`, `rule show`, `rule create|update|enable|disable|remove`, `rule test` |
| Targets | `targets list`, `target add|update|remove`, `target test` |
| Subscribers | `subscribers list`, `subscriber add|remove` |
| Judges | `judges list`, `judge add|remove`, `judge test` |
| Deliveries | `deliveries list`, `delivery retry|drop`, `held list|decide` |
| Daemon | `status`, `run`, `stop`, `pause|resume`, `approve <id>`, `doctor` |

MCP can read, test rules, and propose disabled, secretless versions. It cannot approve a standing authorisation,
resolve a held model decision, test an unapproved target, or accept/return/reveal/rotate a secret. The paired terminal
commands and app operations exist, but each gets a `status: "exception"` capability row naming its human-only reason.
`run` is also an exception because a tool cannot start the server in which it runs. The precedent for visible
exceptions and same-operation parity is `docs/superpowers/specs/2026-09-25-cli-mcp-parity-design.md:164-168` and
`capabilities.json:241-254`.

The first call that enables or loosens a disclosure returns `standingApprovalRequired`, an id, digest and complete
preview. A repeated MCP call cannot claim it. The terminal/app approval operation re-plans under the record lock and
refuses digest drift. `doctor` reports daemon/protocol health, active authorisations, source lag, leases, held
decisions, dead letters, retention and missing secrets.

The `agentcomms-events` skill teaches an agent to propose and test a disabled rule, explain both untrusted
representations, and hand the approval id to the person. It never instructs the agent to type or request a secret.

### D11. Judges: hosted Jev, local endpoints, and an optional bundled model

| Kind | Contract | Disclosure |
|---|---|---|
| `typesafe` | Jev through `POST https://api.typesafe.ai/v1/systemone`, using provider-native Noul output. It is **treated as hosted-only under currently published artefacts and terms**; this is not a claim that local Jev is impossible. | Exact approved input fields leave for the approved host. |
| `local-endpoint` | An approved loopback Ollama/System One endpoint or a generic JSON-output model. Generic numbers are uncalibrated scores. | Local network only, still subject to target resolution and taint-before-call. |
| `bundled` | A separately downloaded model run locally. | None. |

Models are never in the installer. An opt-in download shows name, exact version, publisher, licence, checksum and
size; a signed manifest and SHA-256 are verified before atomic installation. "Leia" remains unidentified. Laya is a
separate publisher's candidate and, if evaluated, runs through its published Transformers-style decision head with
an explicit export to ONNX and the ONNX Runtime path — not `llama.cpp`
([Laya](https://huggingface.co/convaiinnovations/laya)).
Redistribution requires a licence that permits it and a labelled Gmail/Slack quality evaluation.

Every judge is immutable and versioned. A hosted judge cannot be enabled until its exact input fields and retention
are approved under D2 and its key is completed by a person under D2. "Never use hosted judges" is an immediate
tightening. Prompt injection can change only the model's bounded score/reason code; it cannot change rules, mappings,
targets or authority.

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
service remains phase F.

A normal available update does not stop the daemon. A required update pauses polling and evaluation together; already
`disclosing` I/O may finish and everything else waits. The global pause stops polling, judge calls and delivery
claims; it does not erase state.

Operational events increment `hop`; the daemon refuses to emit one past hop 3. A delivery of
`agentcomms.delivery.dead_lettered` that itself dead-letters is audited but never emits another dead-letter event.

### D13. The desktop app

**Shape:** Tauri v2, React, Vite, `@cueplusplus/ui` with `@cueplusplus/tokens` and
`@cueplusplus/theme-cue`, a tray icon and one settings window.

**Screens:**

1. **Overview** — global state, daemon/protocol health, source lag, active authorisations, recent delivery outcomes,
   held decisions and pending approvals.
2. **Sources** — accounts, event types, interval/budget, expected latency, cursor and health.
3. **Rules** — deterministic tree, optional judge, exact input fields and budgets, mapping builder, target-specific
   representation/schema, delivery rate cap, preview and dry-run test.
4. **Targets and subscribers** — webhook network policy, SSE retention/origins, human-only secret completion and
   rotation, approved/pending versions and tests.
5. **Deliveries** — filters, cancelled/retry/dead-letter states, retry/drop and held decisions.
6. **Judges** — exact inputs, hosted warning, human-only keys, local and bundled models.
7. **Approvals** — complete standing-authorisation preview and typed challenge.
8. **Settings** — autostart, keep collecting after quit, retention, data location and about.

**Approval is equivalent to the terminal.** The webview supplies only an approval id, digest and typed response. The
Rust layer fetches the authoritative preview from the daemon by id and digest; it never renders preview fields
supplied by the webview. Rust uses the same text-only renderer as the terminal: no HTML interpretation, bidi/C0/C1,
zero-width and control characters neutralised, links displayed as inert text and never clickable, and
envelope-looking text unable to close or forge a section. It shows the daemon-issued challenge, then calls the
daemon's approve operation. Under the approval record lock, the daemon re-plans, re-checks the digest and challenge,
and only then activates the versions.

The webview has no shell, file-system or direct network permissions. Rust alone holds the control session. Secret
entry/reveal is a deliberately narrow Rust command invoked only from the secret screen and never copied to logs,
audit or app telemetry. Capability files are scoped to the settings window, and the build also restricts registered
custom commands per window with `tauri_build::AppManifest::commands`, because Tauri otherwise exposes registered
commands to every window/webview ([Tauri capabilities](https://v2.tauri.app/security/capabilities/)).

Tests cover HTML tags, bidi/control characters, OSC/CSI, fake headers and envelope-looking preview text; inert links;
digest drift; wrong or missing challenge; a webview-supplied fake preview; and generated command-manifest access from
every window.

### D14. Repository structure, packaging and versions

```text
apps/
  desktop/                # Tauri + React + @cueplusplus/ui
packages/
  core/                   # gains events config/classification, app/daemon surfaces, acc_ state
  events/                 # NEW @agentcomms/events — isomorphic catalogue, conditions, mapping, schemas
  events-daemon/          # NEW @agentcomms/events-daemon — I/O, ingest, approval, delivery, CLI, MCP
  gmail/ slack/ resend/ whatsapp/  # each gains operations/events.ts and manifest events
```

The top-level `"agentcomms"` field continues to mean **channel**, exactly as the channel design specifies
(`docs/superpowers/specs/2026-09-26-channel-plugins-design.md:24-29`). Non-channel packages declare a separate field:

```json
{ "agentcommsPackage": { "kind": "library" } }
{ "agentcommsPackage": { "kind": "service" } }
```

`@agentcomms/events` is the library and `@agentcomms/events-daemon` the service. `scripts/packages.mjs`, its registry
source and release tests read both declarations, compute dependency order and prove every publishable package is
included. They do not widen the channel-manifest union.

Delivery adapters remain reviewed first-party modules inside the daemon until a separate isolation design exists.
There is no `kind: "delivery"` manifest: a manifest cannot stop an adapter from reading the shared secret store or
outbox.

All npm packages remain lockstep. The desktop has its own version but declares a tested daemon-protocol support
matrix. If the app stays in this monorepo, root `pnpm verify` runs its TypeScript typecheck and unit tests; the signed
Tauri build remains in the app's own platform workflow.

The private/public `@cueplusplus` distribution choice and signing identities remain owner decisions (§8). If those
UI packages remain unpublished and private, unauthenticated fork CI cannot install them; phase C must then either
publish the packages or place the app and its credentialed builds in a private repository.

## 4. Phases

Each phase is specified, reviewed, planned and built separately. The order is by safety invariant, not by screen.

| Phase | Delivers | Depends on |
|---|---|---|
| A | Isomorphic `@agentcomms/events`: catalogue and pointer patterns, conditions, mapping, generated source/delivery schemas; no I/O or `node:` imports | — |
| B1 | Daemon skeleton: authenticated/versioned control protocol, stale recovery, owner-only state, AES-GCM durable ingest, Gmail source, rule evaluation, immutable standing authorisations and the `SECURITY.md` amendment, per-source taint-before-disclosure, outbox/leases/cancellation; **only** a local `dry-run` target that records what would have been sent | A |
| B2 | Network hardening, pinned resolution, Standard Webhooks/signing/rotation, webhook delivery, authenticated SSE and replay retention | B1 |
| B3 | CLI/MCP parity and exception rows, human-only secret completion, `doctor`, event skill | B2 |
| C | Desktop app and tray lifecycle, Rust approval/secret surfaces, supervision and protocol compatibility | B3; CUE++ distribution decision |
| D | Slack, Resend and WhatsApp sources, each shipping with its own per-source taint and reset/fairness tests | B1 |
| E | Hosted/local judges, holds, durable budgets, adversarial corpus | B2 (C for app hold resolution) |
| F | Evaluated bundled judge, OS service, future first-party targets, Gmail Pub/Sub and Slack Socket Mode | D, E |

No phase before B2 can make network disclosures. No new source ships without taint-before-disclosure.

## 5. Tests the phases owe

- **Catalogue and pointer grammar:** every schema/example; pattern validation and expansion; `~0`, `~1`, root `""`,
  empty keys, numeric array indices, refused leading zeroes and `-`, literal `*`, copied parents, ancestors and
  descendants, and own-property handling of `__proto__`, `constructor` and `prototype`.
- **Conditions and judges:** every operator × legal schema type; empty `all`/`any`/`in`; NFC plus Unicode default
  case fold; invalid dates; IDNA and subdomains; exact uncertain boundaries including threshold 0 and 1; provider
  probability vs uncalibrated score; content-field prefilter; durable per-rule/provider/global reservations,
  concurrency 2, timeouts counted and malformed output fail-closed.
- **Mapping and wire:** constants, objects/arrays, every missing policy, both representations and their generated
  schemas, parent-copy representation, canonical `agentcommsuntrusted` including root, URI-escaped source
  components, exact CloudEvents 1.0 shape, exact transmitted-byte signatures, `whsec_`, overlapping signatures,
  raw-body consumer verification and five-minute replay tolerance.
- **Crash injection:** before and after cursor/ingest commit, decision insert, judge response persistence, webhook
  2xx recording and SSE append. Every restart reaches one terminal decision per
  `(eventId, ruleId, ruleVersion)` and never advances over memory-only content.
- **Version races:** concurrent disable, remove, tightening and loosening versus claim, retry and SSE append. A
  disclosure either crosses `disclosing` before revocation or becomes audited `cancelled`; it never follows a
  mutable target, remaps old work or sends after the revocation transaction.
- **Taint:** forced taint-store failure proves no hosted-judge call, webhook request or readable SSE append occurred;
  final plain/enveloped payloads discover addresses and Slack handles under their source; error strings remain
  untrusted and reason codes constrained.
- **Secrets:** scan CLI/MCP inputs and outputs, structured content, logs, audit, database metadata and app IPC.
  MCP proposals contain no secret; terminal hidden input and app reveal-once work; rotation sends two signatures
  without exposing either secret.
- **Sources:** Gmail multiple pages, duplicated generic/specific records, add/remove/add occurrences, DRAFT/SENT and
  spam/trash classification, 404 gap; Slack posts, edits, replies, round-robin budget, learned 429s and expected
  latency; Resend received pagination, seven-day sent state, half-share and interactive priority; WhatsApp stanza and
  fallback identities, exact/non-identical collisions, all three reset signals and executable-identity spike.
- **Network:** DNS rebinding between approval and every attempt; mixed good/refused answers; all named IPv4/IPv6
  special ranges and mapped forms; SNI/Host preservation; redirects; unapproved MCP target tests; SSE wrong/missing
  bearer, query/cookie refusal, Origin/CORS/preflight, Host and browser `EventSource` unsupported.
- **Control and storage:** Unix `0700` parent, same-uid peer and second token; Windows pipe/state ACLs; hello version
  negotiation, request authentication, complete error shape, stale pid/socket recovery, worker lease expiry,
  encrypted DB/WAL/free-page inspection, ordering by `(rule, account, target)` and protocol compatibility matrix.
- **Approvals and app:** every digest-bound field, default 60/hour, `chat` unable to claim, doctor/app active list,
  hostile text-only rendering, inert links, webview-forged data, digest drift, missing/wrong challenge, daemon record
  lock and per-window `AppManifest::commands`.
- **Delivery promises:** webhook 2xx/retry/24-hour/20-attempt boundary and id stability; SSE replay inside and refusal
  outside the window; independent payload deletion; dead-letter retention/drop; operational hop cap and no
  dead-letter recursion.
- **Parity and packaging:** every capability row driven on CLI and MCP, every exception reason checked, no
  `"agentcomms"` non-channel kind, both `agentcommsPackage` kinds published in dependency order, events package
  browser import with no `node:` edge, and root verify covering app typecheck/unit tests when present.

## 6. Out of scope

Mapping transforms and expressions (JSONata, JMESPath), array projection, regular-expression conditions and CEL
expert mode; backfilling history when a source is enabled; a hosted Resend relay; sending to any provider; native
browser `EventSource`; third-party delivery adapters before an isolation design; and approving Gmail/Slack/Resend
sends from the desktop app. Plain **sanitised** target values are in scope only through the approved
`untrustedRepresentation: "plain"` contract; unsanitised sender content is never in scope.

## 7. Risks

1. **Future unseen content leaves automatically.** This is the defining risk of a standing disclosure
   authorisation, why chat cannot approve one, why its digest binds every disclosure dimension, and why every active
   grant is visible and immediately revocable.
2. **A same-user hostile process can drive terminal or app.** That remains threat tier T2, as the existing security
   policy states (`SECURITY.md:51-63`). Typed challenges and peer/token checks are meaningful against accidental and
   model-only action, not a hostile process with the user's full authority.
3. **Agentic decisions can be wrong or injected.** Their maximum effect is the approved decision path; prefilters,
   exact inputs, no tools, durable caps, uncertainty handling and fail-closed validation limit cost and action, not
   semantic error.
4. **Content exists at rest.** Ingest, outbox and stream replay require retained content. Application-level
   AES-256-GCM keeps plaintext out of SQLite pages, WAL and free-page residue, while approval-bound retention and
   prompt purge bound duration. A process that can use the installation key is within T2.
5. **Provider limits can make polling slow.** Slack may be one call/minute, Gmail can invalidate cursors, and Resend
   shares its budget with interactive work. The schedulers prefer correctness and interactive use over low latency,
   and the app states expected lag rather than promising real time.
6. **The app is a high-value approval surface.** The authoritative record and digest stay in the daemon; Rust
   re-fetches and text-renders them, custom commands are per-window, and hostile-preview/digest-drift tests are release
   gates.
7. **Private CUE++ packages and signing identities can block distribution.** They do not weaken the daemon design,
   but must be resolved before phase C ships.

## 8. Open questions for the owner

1. **"Leia"** — which model is meant? Nothing by that name was documented in the research; Laya is a different
   publisher and only a candidate for phase F.
2. **`@cueplusplus/ui` public, or the app in its own private repository?**
3. **Signing identities** — who holds the Apple Developer ID and Windows signing certificate?
4. **Hosted judges** — should the product expose TypeSafe at all, or ship with hosted judges hidden by default?
5. **Retention defaults** — this revision specifies 30 days for decision metadata, seven days for dead-letter
   payloads, and 24 hours for SSE replay. Should any default be lower before implementation planning?
