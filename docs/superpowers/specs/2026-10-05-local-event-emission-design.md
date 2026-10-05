# Local event emission — design

Status: **proposed 2026-10-05**, specification only — the owner asked for research and a detailed design, **not an
implementation**. Written from a cited research pass (§2, sources in the research notes this design was written from)
and a read of this repository at `afd195e`. Not yet reviewed. Nothing here changes the
[parity design](2026-09-25-cli-mcp-parity-design.md): every capability is a command and a tool running one operation;
and nothing here loosens the [send gate](2026-09-18-agent-communications-design.md): emitting an event is a new way
for data to leave the machine, and it is gated like one.

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

### In this repository (at `afd195e`)

| Fact | Source |
|---|---|
| Nothing watches for change. There is no daemon, scheduler, file watcher or timer loop; the only things that outlive a command are bounded (lock renewal, sign-in polls, the detached Gmail OAuth listener, the detached update check). | `packages/core/src/lock.ts:220`; `packages/gmail/src/operations/signin.ts:338, 655`; `packages/core/src/update-check.ts:168, 341` |
| Gmail: the transport has no `history.list` or `watch`; `getProfile` returns a `historyId`. The send guard refuses `/batch` and unpermitted `/send`, and would pass `history.list`. The base design lists watch as a 0.1 non-goal and "history.list-based watch" on the roadmap. | `packages/gmail/src/gmail-api/transport.ts:25-82, 196-235, 335-340`; base design `:60-61, :1157` |
| Slack: a closed method allow-list; `apps.connections.open` (Socket Mode) is refused "reserved by the design but not built"; every manifest sets `socket_mode_enabled: false` (Slack design D13). Tokens are user tokens only, refreshed single-use under a lock through `openWorkspace`. `conversations.history` is called with `inclusive: true`. | `packages/slack/src/api/methods.ts:116-228, 220-223`; `packages/slack/src/manifest.ts:144-146`; `packages/slack/src/operations/session.ts:135`; `packages/slack/src/auth/refresh.ts:142-165`; `packages/slack/src/operations/read.ts:147-148` |
| Resend: `/webhooks` and `/events` are refused on purpose; sent mail's state is read by polling `last_event`; one request per 500 ms shared by every process on the machine; a sending-only key cannot list. | `packages/resend/src/api/routes.ts:17-19, 157-158`; `packages/resend/src/api/throttle.ts:6-29`; `packages/resend/src/operations/read.ts:59-84, 232-245` |
| WhatsApp: `sync` snapshots the store and **fully rebuilds** the index; there is no watcher and no high-water mark; a background process cannot answer the macOS privacy prompt (12 s timeout). Message ids are `Z_PK` as a numeric string. | `packages/whatsapp/src/operations/sync.ts:45-113`; `packages/whatsapp/src/index-db.ts:127-278`; `packages/whatsapp/src/source/snapshot.ts:86-99`; `packages/whatsapp/src/source/read-source.ts:127, 152` |
| Every read wraps sender-controlled text in the untrusted envelope. Gmail and Resend-received reads record **taint**; Slack, WhatsApp and Resend-sent reads record none. | `packages/core/src/untrusted.ts:108-120`; `packages/gmail/src/operations/read.ts:314, 359`; `packages/resend/src/operations/read.ts:341-357` |
| Per-account state accepts only Gmail inbox ids (`ibx_`), so there is nowhere to keep a cursor for any other account. | `packages/core/src/state.ts:24-29` |
| Every context and the audit record type their surface as `'cli' \| 'mcp'`. | `packages/core/src/audit.ts:29`; e.g. `packages/gmail/src/context.ts:35` |
| A configuration change that loosens something needs consent; `classifyChange` judges only send policy, change policy and mode. | `packages/core/src/config.ts:918-930, 1368` |
| The channel manifest is a strict object (an unknown `events` key is refused today); `hosts` is "declared, not yet enforced". | `packages/core/src/channel-manifest.ts:100-107, 170-301` |
| The published package list is **derived from channel manifests** (every channel package and every package a channel's server runs through); a non-channel package would not be published. | `scripts/packages.mjs:1-37` |
| Only Gmail declares MCP output schemas, and its message read returns a loose object; every other result is a TypeScript interface. | `packages/gmail/src/mcp/server.ts:678-728, 763, 792` |
| The repository already uses `node:sqlite` (WhatsApp, Node ≥ 22.16). | `packages/whatsapp/src/index-db.ts`; `packages/whatsapp/package.json` |
| `@cueplusplus/ui` (Base UI + Tailwind v4, with `@cueplusplus/tokens` and one `@cueplusplus/theme-*`) is MIT-licensed, but the `@cueplusplus` npm scope is **private**: every install authenticates. | `cueplusplus/cue-ui` `README.md` "Quick start", `LICENSE` |

### Outside it (research notes, 2026-10-04; each a first-party source)

| Fact | Source |
|---|---|
| Gmail `watch` publishes to a Cloud Pub/Sub topic in the **same project as the OAuth client**, must be renewed every 7 days, and Google still recommends polling for user-owned installed apps; a pull subscription needs no public URL. Notifications can be delayed or dropped, so `history.list` reconciliation is needed regardless. `history.list` costs 2 quota units; an expired cursor answers 404. | developers.google.com/workspace/gmail/api/guides/push; …/reference/rest/v1/users.history/list; …/reference/quota |
| Slack Socket Mode needs an app-level `xapp-` token (`connections:write`), no public URL, ≤ 10 connections per app, and is not allowed for Marketplace apps. New non-Marketplace *commercial* apps are limited to 1 `conversations.history` call per minute; internal customer-built apps keep Tier 3. | docs.slack.dev/apis/events-api/using-socket-mode; …/reference/methods/conversations.history; …/changelog/2025/05/29 |
| CloudEvents 1.0 structured JSON (`id`, `source`, `specversion`, `type`; `source`+`id` is the dedupe identity); Standard Webhooks headers `webhook-id`, `webhook-timestamp`, `webhook-signature`, signing `id.timestamp.payload`, backoff with jitter. | github.com/cloudevents/spec v1.0.2; github.com/standard-webhooks |
| Socket.IO default delivery is at-most-once; SSE carries `id`/`retry` and reconnects; JetStream and Redis Streams give acknowledged at-least-once; Redis Pub/Sub and core NATS are at-most-once. | socket.io/docs/v4/delivery-guarantees; MDN SSE; docs.nats.io; redis.io/docs |
| JSON Pointer (RFC 6901) addresses exactly one value. | rfc-editor.org/rfc/rfc6901 |
| Jev (TypeSafe, "System One") is **hosted only**: `POST https://api.typesafe.ai/v1/systemone`, typed outputs including `Noul` (a 0–1 yes/no probability), 64K context, $42 per billion input tokens, vendor-stated 70–500 ms. No downloadable weights or self-hosting licence is documented. | docs.typesafe.ai/introduction; …/models |
| **"Leia" is not documented** by TypeSafe or anyone found. The nearest name is **Laya** (convaiinnovations, Apache-2.0, 421M English / 322M multilingual, "typed decisions") — a different publisher. Ollama documents local System One-style decisions at `/v1/systemone` (Nimble, Tev1, Clef); Tev1's weights licence is "being finalized". | huggingface.co/convaiinnovations/laya; docs.ollama.com/capabilities/decision; huggingface.co/togethercomputer/Tev1-0.8B-experimental |
| Tauri v2: sidecars via `externalBin`, capabilities scoped per window, CSP must be configured, tray, opt-in autostart, single-instance, signed updater; macOS needs Developer ID + notarisation, Windows signing avoids SmartScreen. | v2.tauri.app (sidecar, capabilities, csp, system-tray, plugin/autostart, plugin/single-instance, plugin/updater, distribute/sign) |

## 3. Decisions

### D1. What is being built: three things, each with one job

1. **Sources** live in the channel packages, beside the code that already reads each provider. A source turns "what
   changed since this cursor" into typed, enveloped events. Nothing outside a channel package talks to its provider,
   so every guard that exists today (Gmail's send guard, Slack's method allow-list, Resend's route table and throttle)
   keeps applying.
2. **`@agentcomms/events`** — a pure library with no I/O, safe in a browser: the **event catalogue** (Zod schemas per
   type and version, generated JSON Schema), **conditions** (the deterministic tree and its evaluator), **mapping**
   (the output template and its evaluator), and the **envelope** (CloudEvents and Standard Webhooks signing). The
   daemon, the CLI, the MCP tools and the desktop app all validate and preview with the same code.
3. **`@agentcomms/events-daemon`** — the long-running process: runs sources on their schedules, evaluates rules,
   calls a judge for agentic conditions, keeps the outbox, delivers to targets, and serves a local control API. It
   carries the CLI (`agent-events`) and the MCP server, both calling `packages/events-daemon/src/operations` (parity).

And a fourth, which only presents: the **desktop app** (D13) — a control surface over the daemon, never a second
implementation of any of the above.

Why three: the catalogue and evaluators must be identical wherever a rule is edited, previewed or run — that is a pure
library; provider access must stay where its guards are — that is the channel packages; and something must stay
running — that is the only part with a lifecycle. Each can be tested without the others.

### D2. Emitting is a way for data to leave the machine, and is gated like sending

A rule that forwards a message's body to a webhook sends the person's mail to a third party. The base design's whole
send gate exists for that shape, and an agent with the MCP tools could otherwise configure a rule to exfiltrate every
message it will ever receive. So:

- **Creating or enabling** a rule, a target, or a judge that sends data off the machine is a **loosening**, handled as
  every gated change is: the call returns `approvalRequired` and a preview; under the `chat` change policy the person's
  yes in chat approves it, under `confirm` they approve it at a terminal (`agent-events approve <id>`) or in the
  desktop app (D13). The approval is bound to a digest of exactly what was shown.
- **The preview says what leaves and where**: for each target its scheme, host and port (never a secret); for each
  rule the event type, the conditions in words, and every output field with the source path it is taken from, the
  sender-controlled ones marked; for an agentic condition, the judge's provider and host and the fields it is sent.
- **Disabling** anything, the global switch, removing a target, narrowing a mapping — tightening — applies at once.
- **Editing an enabled rule or target** so that more leaves (a new field, a new target, a different host, an agentic
  condition on a hosted judge) is a loosening and needs approval; the rule keeps running on its approved version
  until then.
- **Audited**: every change, enable, disable and dead-lettered delivery is an audit record, with the surface `app` or
  `daemon` added to `'cli' | 'mcp'`.
- **Never automatic**: no rule, target or judge is enabled by installing, updating or importing anything.

### D3. The event catalogue: typed, versioned, and marked for what a sender controls

Every event type is a definition in `@agentcomms/events`:

```ts
interface EventDefinition<T> {
  type: string;                  // 'gmail.message.received'
  version: number;               // 1; a breaking change is a new version, both kept
  channel: 'gmail' | 'slack' | 'resend' | 'whatsapp' | 'agentcomms';
  schema: z.ZodType<T>;          // JSON-representable only: no transforms, no Date objects, ISO strings
  untrusted: readonly string[];  // JSON Pointers to sender-controlled values, checked against the schema
  dedupeKey(event: T): string;   // stable across re-reads
  examples: readonly T[];        // used by the app's preview and the tests
}
```

Every event carries a common head — `{ id, type, version, occurredAt, observedAt, account: { name, id, channel } }`
— and its own body. **Version 1 of the catalogue:**

| Type | Body (abridged) | Sender-controlled |
|---|---|---|
| `gmail.message.received` | `messageId, threadId, labels[], from{address,name}, to[], cc[], subject, snippet, date, hasAttachments, attachments[{name,type,size}], body?` | `from.name, subject, snippet, attachments[*].name, body` |
| `gmail.message.sent` | as received, from the sending mailbox | `subject, body, …` (written by the person, still content) |
| `gmail.message.labelled` | `messageId, threadId, added[], removed[]` | — |
| `slack.message.posted` | `ts, channel{id,name,kind}, user{id,name}, text, threadTs?, files[{id,name,type,size}], mentionsMe` | `text, user.name, channel.name, files[*].name` |
| `resend.email.received` | `id, from, to[], subject, receivedAt, attachments[]` | `from, subject, attachments[*].name` |
| `resend.email.status_changed` | `id, to[], subject, previous, current, at` | `subject` |
| `whatsapp.message.received` | `id, chat{id,name,kind}, sender{id,name}, text, at, media?` | `text, sender.name, chat.name, media.name` |
| `agentcomms.source.degraded` / `.gap` / `.recovered` | `source, account, reason, since` | — |
| `agentcomms.delivery.dead_lettered` | `target, eventId, attempts, lastError` | — |

- **Bodies are fetched only when needed**: a Gmail body (or Slack file metadata) is read only when an enabled rule's
  condition, judge input or mapping references it. Otherwise `body` is absent, and the schema says it is optional.
- **Sender-controlled values are sanitised and enveloped wherever they leave**: the existing HTML sanitiser and
  `wrapUntrusted` apply to each, exactly as a read result (AGENTS.md: "Anything a sender controls must pass through the
  HTML sanitiser and the untrusted-content envelope before it reaches a result"). A delivered event is a result. The
  CloudEvent also lists them (D6), so a consumer can unwrap them deliberately. Raw delivery of sender-controlled text
  is out of scope (§6) and would need its own security review.
- **Taint for what is delivered**: addresses a delivered event carries are recorded in the taint store (source
  `event`), because a consumer may be a model that later asks this machine to send. Scanning without delivering
  records nothing — reading every inbound sender into the store would escalate every reply.
- Schemas are generated to JSON Schema 2020-12 and shipped in the package; `dataschema` is
  `urn:agentcomms:schema:<type>:v<version>` (no hosted schema URL is assumed).

### D4. Sources: polling first, each provider's documented push later

| Source | Version 1 | Later |
|---|---|---|
| Gmail | `users.history.list` from a stored `historyId` (`messageAdded`, `labelAdded`, `labelRemoved`), every 60 s (minimum 30 s); then metadata (or full, D3) per added id. Start from `getProfile().historyId` when the source is enabled — no backfill. A 404 (expired cursor) re-baselines and emits `agentcomms.source.gap`; it does not backfill silently. | `watch` + Pub/Sub **pull** as an organisation-managed accelerator (needs the topic in the OAuth client's own project — a profile field), still reconciled by `history.list`. |
| Slack | `conversations.history` for **conversations the rule names**, never "all", through `openWorkspace` (single-use refresh, its lock); every 60 s per conversation (minimum 60 s); dedupe on `ts` because `oldest` is inclusive. `mentionsMe` from the text. 429 honours `Retry-After`. | Socket Mode: needs an app-level token stored as a secret, the manifest's `socket_mode_enabled`, lifting the `apps.connections.open` refusal, and an answer to the Slack design's open question on whether user-perspective subscriptions deliver the person's own DMs — its own design. |
| Resend | Poll `received.list` for new ids and `emails.list` for `last_event` changes on mail sent in the last 7 days, through the shared throttle; full-access key only (a sending-only key reports the source unavailable). Status changes are **observed states, not a full history** — said so in the UI. | A signed hosted relay for Resend webhooks — a separate product, never a hidden requirement. |
| WhatsApp | Run the existing `sync` on an interval (default 5 min) and diff the new index against a per-chat `Z_PK` high-water mark. Never read the live store. The first run happens with the app in front, so the person can answer the macOS prompt; a prompt that times out marks the source degraded. | A debounced file-system notification on the store's folder as a wake-up only, still followed by the same snapshot-and-rebuild. |

- **Cursors and events commit together**: the cursor advances in the same SQLite transaction that records the events
  derived from it (D8). A crash re-reads, and dedupe keys absorb the repeat.
- Each source declares, in its channel's manifest, the event types it emits, its minimum interval and what it needs
  (scopes, key kind). `channel-manifest.ts` gains an optional `events` field; the generated snapshot carries it; the
  strict schema keeps refusing anything else.
- Each source is a read operation in its channel package (`packages/<channel>/src/operations/events.ts`), testable
  against the existing fakes; the daemon only schedules it. Gmail's transport gains `listHistory` (and the fake its
  history); nothing else in any provider guard changes.
- **Background safety**: a source never triggers an OS prompt from the background. If a secret read would block on a
  keychain prompt (the existing 12 s timeout) or WhatsApp's privacy prompt, the source goes `degraded` with the reason
  and the app or `doctor` says how to fix it in front of the person.
- Reads by the daemon do not update `lastUsedAt` (which `doctor` uses to judge idleness); they record `lastPolledAt`.

### D5. Conditions

**Deterministic** — a tree that can always be read back as a sentence:

```ts
type Condition =
  | { all: Condition[] } | { any: Condition[] } | { not: Condition }
  | { path: string; op: 'exists' }
  | { path: string; op: 'equals' | 'notEquals'; value: Scalar; caseSensitive?: boolean }
  | { path: string; op: 'contains' | 'startsWith' | 'endsWith'; value: string; caseSensitive?: boolean }
  | { path: string; op: 'in'; values: Scalar[] }
  | { path: string; op: 'gt' | 'gte' | 'lt' | 'lte'; value: number | string /* ISO instant */ }
  | { path: string; op: 'domainIs'; value: string };   // for address fields
```

- `path` is a JSON Pointer validated against the event type's schema; `value` must have the type the schema gives
  that path. A rule that does not validate cannot be saved.
- Semantics fixed and tested: a missing path is false for every operator but `not exists`; strings are compared after
  Unicode NFC normalisation, case-insensitively unless `caseSensitive`; `contains` on an array tests membership;
  instants compare as instants; no coercion between types.
- **No regular expressions** in version 1 (catastrophic backtracking on sender-controlled text). Limits: depth 8,
  64 nodes, values 1 KB, `in` 256 items.
- Saved as the tree; the sentence is generated, never stored alone.

**Agentic** — a question, put to a judge, after a deterministic prefilter:

- An agentic condition is `{ judge, question, inputs: JsonPointer[], threshold, onUncertain }`. It runs **only when
  the rule's deterministic part has already matched** — every agentic rule must have one (at least the source and the
  event type), so a judge is never asked about everything.
- **The judge sees only `inputs`**, the paths the rule names, sanitised and enveloped, in a fixed prompt template
  (versioned) that states the question is the person's and the event is data. It has no tools, no secrets, no
  authority, and its answer is validated against `{ match: boolean, probability: number, reasonCode?: string }`;
  anything else is a failure.
- `probability >= threshold` matches. Between `threshold - 0.1` and `threshold` is **uncertain**: `onUncertain` is
  `no-match` (default) or `hold` (the app shows it for the person to decide; nothing is delivered until they do).
  A failure, timeout or exceeded budget is **no match**, recorded, and surfaced as a degraded judge — fail closed.
- What a judge can do under injection: flip its own answer. It cannot add a target, a field, a rule or a recipient;
  that is the boundary, and the threshold, the prefilter and the adversarial test corpus (§5) are what bound the rest.
- **Recorded with every decision**: judge provider, model and version, prompt-template version, threshold, the
  probability and reason code. Delivery retries never re-ask the judge (D8).
- **Budgets**: per rule, a maximum of judgments per hour and of input tokens per month; at the limit the condition
  fails closed and says so.

**Judges** (D11) are configured separately from rules, so one key or one local model serves many rules.

### D6. Mapping: a template of constants and paths

The output of a rule is a JSON template whose leaves are either constants or path references:

```json
{
  "kind": "invoice",
  "from": { "$path": "/from/address" },
  "subject": { "$path": "/subject", "missing": "null" },
  "labels": { "$path": "/labels" },
  "account": { "$path": "/account/name" }
}
```

- `$path` is a JSON Pointer into the event, validated against its schema at save; it copies the value **as it is**,
  whatever its type (a whole object or array included). `missing` is `reject` (default: the event is not delivered to
  this target and the decision says why), `omit` or `null`. No transforms, no expressions, no array projection
  (§6) — the owner's "value as is from any sub-object path".
- **Sender-controlled values** (D3's `untrusted` paths, or any path under them) arrive sanitised and enveloped; the
  CloudEvent lists the output pointers that hold them in an extension attribute, `agentcommsuntrusted`.
- **The envelope** is CloudEvents 1.0 structured JSON: `id` (the decision's id, stable across retries), `source`
  `urn:agentcomms:<installation id>:<account name>`, `type` (the catalogue type, or a rule-defined type matching
  `^[a-z0-9]+(\.[a-z0-9_]+)+$`), `subject` (the source item's id), `time`, `datacontenttype`, `dataschema` (D3), and
  `data` — the mapped object. Extension attributes: `agentcommsrule` (rule id and version), `agentcommsuntrusted`.
- Limits: 256 KB per mapped event; 200 leaves; constants 4 KB.
- The app's mapping builder shows the event's schema as a tree of legal paths (from the generated JSON Schema), the
  output as it will be, and which values are sender-controlled — against a catalogue example or a recent event.

### D7. Targets

| Target | Version 1 | Notes |
|---|---|---|
| **Webhook** | HTTPS `POST` of the CloudEvent (`application/cloudevents+json`), signed with Standard Webhooks headers (HMAC-SHA256, a per-target secret in the secret store, shown once when created). | `http:` only to a loopback address. No redirects followed. The approved scheme, host and port are pinned; a private-network address (RFC 1918, link-local, ULA) needs the target's `localNetwork: true`, which is part of the approved preview. 10 s timeout; 2xx is success; `Retry-After` honoured. |
| **Local stream (SSE)** | `GET /v1/streams/<subscriber>` on the daemon's subscriber listener, `text/event-stream`, each event's `id` the CloudEvent id; `Last-Event-ID` replays from the outbox's retention. | 127.0.0.1/::1 only; a bearer token per subscriber (created in the app or CLI, shown once); requests with an `Origin` header refused unless that origin was approved for the subscriber; `Host` checked (DNS rebinding). |
| Socket.IO, NATS JetStream, Redis Streams, Google Pub/Sub, AWS EventBridge/SQS, Upstash QStash, Trigger.dev | Later, as delivery adapters. | Each declares its delivery guarantee and ordering as data; at-most-once transports (Redis Pub/Sub, core NATS) are not offered as reliable. Socket.IO when rooms, acknowledgements or two-way control are actually needed. |

Delivery adapters are packages declaring themselves the way channels do — an `"agentcomms"` field with
`kind: "delivery"` — so the core and the tooling derive them; version 1 builds webhook and SSE into the daemon and the
contract is written so adapters can move out.

### D8. The outbox: at-least-once, and nothing re-decided on retry

One SQLite database, `<stateDir>/events/events.sqlite` (mode 0600, `node:sqlite`), owned by the daemon:

- `cursors(source, account, cursor, updatedAt)` — advanced in the same transaction as the events it produced.
- `events(id, type, account, dedupeKey UNIQUE per account+type, occurredAt, observedAt)` — **no content**: the
  source event's content is held in memory only while it is evaluated.
- `decisions(id, eventId, ruleId, ruleVersion, outcome, judge…)` — one per rule that saw the event.
- `deliveries(decisionId, targetId, UNIQUE(decisionId, targetId), payload, attempts, nextAt, state, lastError)` —
  `payload` is the mapped CloudEvent, the only content stored, and only until delivered (then dropped) or for the
  retention window if dead-lettered.
- Retries: capped exponential backoff with jitter (1 s … 1 h), for at most 24 hours or 20 attempts, then
  `dead-lettered`, an audit record, and an `agentcomms.delivery.dead_lettered` event. The app and CLI can retry or
  drop a dead letter; a retry never re-evaluates the rule or re-asks the judge.
- Ordering only per (rule, account), and only when the rule asks for it (a failing delivery then holds the ones behind
  it for that key); global ordering is never promised.
- Guarantee stated everywhere: **at least once**. Consumers dedupe on the CloudEvent `id` (= `webhook-id`).
- Retention: decisions and delivery metadata 30 days; dead-lettered payloads 7 days; configurable down, never up past
  30 days without a loosening.

### D9. Where configuration lives

- **`config.json`** gains `events`: `{ enabled, sources{}, rules{}, targets{}, judges{}, subscribers{} }` — data
  only. Secrets (webhook signing keys, subscriber tokens, judge API keys) live in the secret store, referenced by id.
- `classifyChange` learns the `events` key: everything D2 calls a loosening is classified so; the existing consent
  mechanism (digest-bound approvals, chat/confirm change policy) is reused, not copied.
- Rules are versioned: an edit creates version n+1; decisions record the version that made them; the approved version
  keeps running until a newer one is approved.
- Releases before this one keep the `events` key untouched (unknown keys are preserved) — as `organisations` was.

### D10. Control surfaces, in parity

Every capability is one operation in `packages/events-daemon/src/operations`, a command in `agent-events`, a tool in
its MCP server, and a row in `capabilities.json`:

| Area | Operations |
|---|---|
| Catalogue | `catalogue list`, `catalogue show <type>` (schema, untrusted paths, examples) |
| Sources | `sources list`, `source enable|disable <account> <type>`, `source show` (cursor, last poll, health) |
| Rules | `rules list`, `rule show`, `rule create` (disabled), `rule update`, `rule enable|disable`, `rule remove`, `rule test` (evaluates against an example or the source's recent items, read-only, delivers nothing) |
| Targets | `targets list`, `target add`, `target update`, `target remove`, `target test` (sends a fixed, signed `agentcomms.test` event with no account data) |
| Subscribers | `subscribers list`, `subscriber add` (prints the token once), `subscriber remove` |
| Judges | `judges list`, `judge add`, `judge remove`, `judge test` (a fixed question on an example) |
| Deliveries | `deliveries list`, `delivery retry|drop`, `held list`, `held decide` (the person's answer to an uncertain judgment) |
| Daemon | `status`, `run` (foreground), `stop`, `pause|resume` (all deliveries), `approve <id>` (terminal approval) |

- MCP: agents can read everything, test rules, and **propose** — create disabled rules and targets; enabling and every
  loosening returns `approvalRequired` (D2). `held decide` is refused from MCP: an uncertain judgment is the person's.
- `doctor` (core and `agent-events`) reports the daemon, each source's health, dead letters and held decisions.
- The skills gain an `agentcomms-events` skill on proposing a rule safely; it says that enabling is the person's.

### D11. Judges: hosted Jev, a local endpoint, and an optional bundled model

| Judge kind | What it is | Data leaves the machine |
|---|---|---|
| `typesafe` | Jev via `POST https://api.typesafe.ai/v1/systemone`, a `Noul` question; key in the secret store | Yes — to api.typesafe.ai; the approval preview says which fields |
| `local-endpoint` | An OpenAI- or Ollama-compatible endpoint on loopback the person runs (Ollama's `/v1/systemone` models, or any model with JSON-schema-constrained output) | No |
| `bundled` | A model downloaded **on the person's opt-in** into application data and run in-process | No |

- **Bundled models are never in the installer.** The app offers a download showing the model's name, version, source,
  licence and size; it is fetched with a resumable download, checked against a **signed manifest and SHA-256**,
  installed atomically, and removable. Only models whose licence permits redistribution and use are listed: today
  that excludes Tev1 (licence "being finalized"). **Which model "Leia" means is an open question (§8)**; the nearest
  documented candidate is Laya (Apache-2.0, built for typed decisions), which would be evaluated on a labelled corpus
  of real Gmail and Slack classifications before being offered. Runtime: ONNX Runtime or llama.cpp bindings,
  chosen by that evaluation.
- **Jev cannot be bundled**: no weights or self-hosting terms are published. If TypeSafe publishes them, it becomes a
  `bundled` option like any other.
- A "never use hosted judges" switch hides `typesafe` entirely.
- Every judge is versioned; a model update is a new judge version, and rules pinned to the old one keep it until the
  person moves them.

### D12. The daemon: one per machine, started by the person

- `agent-events run` runs the daemon in the foreground: a single instance per state directory (a lock and a local
  control socket — a Unix socket, a named pipe on Windows — with a token file, 0600). A second start finds it and exits.
- **It is not bundled into the desktop app.** It is a published package installed and updated by the existing managed
  install (`agentcomms server install`/`update`, with CUE-403's CLI shims), in lockstep with the channels it calls.
  The app starts it as a child process it supervises, from the managed install, and offers that install when it is
  missing — through the core's own approved-change flow.
- Quitting the app stops collection, unless the person chose **"keep running in the background"** — then the app
  leaves the daemon running and the tray icon shows it. An OS service (launchd user agent, systemd user unit, Windows
  scheduled task) without the app is `agent-events service install|remove` — phase F (§4).
- **The update gate**: when the core reports a pending update, the daemon finishes deliveries already decided and
  keeps polling; when the update is one the core marks required, it pauses evaluation and says so. After an update it
  restarts itself only when the person (or the app) asks.
- **The global switch** — `events.enabled: false`, `agent-events pause`, the app's switch — stops all sources and
  deliveries at once; outstanding deliveries wait, they are not dropped.
- Logs carry ids and outcomes, never content or secrets (the audit rule).

### D13. The desktop app

**Shape:** Tauri v2, React, Vite, `@cueplusplus/ui` with `@cueplusplus/tokens` and `@cueplusplus/theme-cue`
(`ThemeProvider` with `density="compact"`), a tray icon, one settings window.

**Screens:**

1. **Overview** — the global switch; the daemon's state; each source's health; deliveries and failures in the last
   24 hours; held decisions and pending approvals, each one click away.
2. **Sources** — every account agentcomms knows (from its configuration), per event type: on/off, interval, cursor
   and last poll, last error and its fix.
3. **Rules** — list with on/off; the **editor**: source and event type → conditions (a tree editor whose path picker is
   the event's schema tree; the sentence it reads as, live) → optional agentic condition (judge, question, the fields
   it sees, threshold, uncertainty handling, budget, an estimated cost for hosted judges) → mapping (the output tree,
   each leaf a constant or a path picked from the schema, the sender-controlled ones marked; the result shown against
   an example or a recent event) → targets. **Test** runs `rule test`. **Enable** shows the D2 preview and asks for
   approval.
4. **Targets** — webhooks (URL, the signing secret shown once, `localNetwork`, test) and local subscribers (tokens
   shown once).
5. **Deliveries** — log with filters; dead letters with retry and drop; held decisions with match / no match.
6. **Judges** — Jev key, local endpoints, bundled models (download, verify, remove), the hosted-judges switch.
7. **Approvals** — pending approvals for events changes, each with its full preview; approving here is the person's
   approval, like the terminal (§7 risk 2).
8. **Settings** — autostart (opt-in), keep running in the background, retention, data location, about.

**Security:**

- The webview has **no** shell, file-system or network permissions; it calls a narrow set of Rust commands
  (configuration reads and the operations of D10) and receives status over Tauri channels. Capabilities are scoped
  per window; CSP is self-only, no remote scripts, no CDN, `connect-src` limited to Tauri IPC.
- The Rust layer is the only thing that talks to the daemon's control socket (with its token). No secret ever reaches
  the webview except the reveal-once values the person asked to see.
- Single instance; signed updater (TLS, signed artefacts); macOS Developer ID and notarisation; Windows code signing;
  Linux AppImage and `.deb`.

### D14. Repository structure, packaging and versions

```text
apps/
  desktop/                # Tauri + React + @cueplusplus/ui — private, not on npm; installers on GitHub Releases
packages/
  core/                   # existing; gains the events config key, the 'app'/'daemon' surfaces, state for acc_ ids
  events/                 # NEW @agentcomms/events — pure: catalogue, conditions, mapping, envelope
  events-daemon/          # NEW @agentcomms/events-daemon — daemon, outbox, delivery, CLI agent-events, MCP server
  gmail/  slack/  resend/  whatsapp/   # existing; each gains src/operations/events.ts and a manifest `events` field
  gmail-mcp/              # existing
```

- **npm packages stay in lockstep** (one version, one tag, one release) — the base design's rule, which keeps channel
  sources, the catalogue and the daemon compatible by construction. `scripts/packages.mjs` today derives the list from
  channel manifests, so the derivation gains package kinds (`"agentcomms": { "kind": "library" | "service" }` for
  `events` and `events-daemon`), and `test/release-packages.test.mjs` proves both are published after `core` and
  before nothing that needs them. Their **first versions are published by hand** (the release skill: npm cannot hold a
  trusted publisher for a package that does not exist yet).
- **The desktop app is versioned on its own** (`desktop-v*` tags, its own workflow producing signed installers and
  the updater manifest). It declares the daemon control-protocol versions it speaks; the daemon reports its own; a
  mismatch shows "update agentcomms" or "update the app", never a broken screen.
- **`@cueplusplus/ui` is private on npm, and this repository is public** (provenance publishing refuses a private
  repository). A public CI cannot install a private scope for pull requests from forks, and every contributor would
  need a token. **Recommended:** publish `@cueplusplus/ui`, `@cueplusplus/tokens` and `@cueplusplus/theme-cue`
  publicly (they are MIT already) and keep the app in `apps/desktop` here. **If they stay private:** the app lives in
  its own private repository (`cueplusplus/agentcomms-desktop`), consuming the published `@agentcomms/*` packages and
  the daemon's control protocol, with nothing else changing. The owner decides (§8).
- `pnpm verify` gains the events packages; the app has its own checks (type-check, unit tests, a Tauri build) run in
  its workflow, not in the npm verify legs.

## 4. Phases

Each phase is specified, reviewed, planned and built separately, and ships in a release.

| Phase | Delivers | Depends on |
|---|---|---|
| A | `@agentcomms/events`: catalogue v1 schemas, conditions, mapping, envelope, signing — pure, fully tested | — |
| B | Daemon: Gmail `history.list` source, outbox, webhook and SSE targets, D2 approvals, `agent-events` CLI and MCP, `doctor`; core: `events` config key and classification, `acc_` state, surfaces | A |
| C | Desktop app: overview, sources, rules (deterministic), targets, deliveries, approvals; daemon supervision | B; the `@cueplusplus/ui` decision |
| D | Slack, Resend and WhatsApp sources; taint for Slack/WhatsApp deliveries | B |
| E | Judges: `typesafe` and `local-endpoint`; held decisions; budgets; adversarial corpus | B (C for held decisions in the app) |
| F | Bundled judge (after the "Leia" answer and a quality evaluation); OS service install; Socket.IO and broker adapters; Gmail Pub/Sub; Slack Socket Mode | E, D |

## 5. Tests the phases owe

- **Catalogue:** every type's schema round-trips through JSON Schema; every `untrusted` pointer exists in its schema;
  every example validates; dedupe keys are stable across re-reads of the same item.
- **Conditions:** each operator × each schema type; missing paths; NFC and case; instants across offsets; limits at
  and past the boundary; a rule with a wrong-typed value refused at save; the sentence for every operator.
- **Mapping:** constants; whole objects and arrays; each `missing` policy; untrusted values enveloped and listed in
  `agentcommsuntrusted`, including under a copied parent object; size limits; a hostile subject with envelope-closing
  text stays inside its envelope.
- **Sources:** Gmail history pages, a 404 re-baseline with a gap event and no backfill, a body fetched only when a rule
  needs it; Slack inclusive `oldest` dedupe, 429 with `Retry-After`, refresh through `openWorkspace` under its lock;
  Resend through the shared throttle, sending-only key unavailable; WhatsApp diff by `Z_PK`, a timed-out privacy
  prompt degrades the source; cursor and events in one transaction (crash between → re-read, deduped).
- **D2:** an MCP call creating and enabling a rule with a webhook returns `approvalRequired` with a preview listing
  host and fields; under `confirm` only the terminal or the app approves; an edit adding a field to an enabled rule
  needs approval and the old version keeps running; disabling applies at once; no install or update enables anything.
- **Delivery:** signatures verify with the Standard Webhooks reference algorithm; redirects not followed; private
  address refused without `localNetwork`; retries with jitter stop at 24 h or 20 attempts; dead letter audited and
  evented; retry never re-evaluates; SSE replay from `Last-Event-ID`; foreign `Origin` and wrong `Host` refused.
- **Judges:** output outside the schema fails closed; timeout fails closed; the uncertain band holds or drops as set;
  budget exhaustion fails closed and says so; the judge receives only `inputs`; an adversarial corpus (instructions
  to match, to add fields, to call tools) never yields anything but a boolean decision.
- **Parity:** every row of D10 in `capabilities.json`, run on both sides by `pnpm verify:parity`.
- **App:** the webview has no permission outside its capability file (a test reads the generated capability set);
  CSP present; the control token never reaches the webview; protocol mismatch shows the right message.

## 6. Out of scope

Transformers and expressions in mappings (JSONata, JMESPath) — and array projection — until a separate design with
resource limits and its own security review; raw (unenveloped) delivery of sender-controlled text; regular-expression
conditions; CEL "expert mode"; backfill of history when a source is enabled; a hosted relay for Resend webhooks;
sending anything to any provider (events only observe); approving sends from the desktop app (it approves events
changes only — sends keep their own gate, CUE-404).

## 7. Risks

1. **Exfiltration by configuration** — the main risk, and why D2 gates every outward change with a preview of the
   host and fields, under the change policy the person chose. Under `chat` an agent can still talk a person into
   approving a bad rule; `confirm` moves the decision to the terminal or the app.
2. **The app as an approval surface** — a same-user process could drive it, as it could the terminal; the threat model
   is unchanged (a hostile same-user process is out of scope; it can read the tokens).
3. **Agentic conditions are manipulable** — bounded to a wrong boolean by the output schema, with prefilters,
   thresholds, held decisions and fail-closed handling; stated in the app next to every agentic condition.
4. **Content at rest** — mapped payloads sit in the outbox until delivered, and dead letters for 7 days, in a 0600 file
   under the state directory; encryption at rest is a later option.
5. **Quota and rate limits** — Gmail per-user quota, Slack Tier limits and Resend's machine-wide throttle are shared
   with the person's interactive use; minimum intervals and backoff keep the daemon from starving them, and the app
   shows the polling cost.
6. **Private `@cueplusplus` scope** — blocks the app's public build until decided (§8).

## 8. Open questions for the owner

1. **"Leia"** — which model is meant? Nothing by that name is documented; the nearest is Laya (convaiinnovations,
   Apache-2.0). Until answered, phase F's bundled judge is not specified further.
2. **`@cueplusplus/ui` public, or the app in its own private repository?** (D14; the recommendation is public.)
3. **Signing identities** — an Apple Developer ID and a Windows code-signing certificate, and who holds them.
4. **Hosted judges** — is sending event fields to TypeSafe acceptable for your accounts, or should hosted judges be
   off by default?
5. **Retention** — 30 days of decision metadata and 7 days of dead-lettered payloads: right?
