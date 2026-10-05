# Local event emission — design

Status: **revised after round 2 (8 P1, 7 P2, 1 P3, all addressed), 2026-10-05**; specification only,
not an implementation. Written from the cited research pass (§2) and a checked read of this repository at
`ef1db77`. This design adds a new **standing disclosure authorisation**; it does not treat recurring event delivery
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

### In this repository (at `ef1db77`)

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
| Core approval records are kind-separated, compare-and-swap under a per-record lock and single-use through an `O_EXCL` claim marker; the present kind union is `send | change | download`. This design extends that machinery rather than treating an ordinary change approval as disclosure authority. | `packages/core/src/approvals.ts:20-54,801-813` |
| Core already provides lowercase SHA-256 and recursively key-sorted canonical JSON; the event and disclosure identities below reuse those exact primitives. | `packages/core/src/digest.ts:99-100,117-127` |

### Outside it (checked 2026-10-05; first-party or primary sources)

| Fact | Source |
|---|---|
| Gmail `history.list` is cursor-paginated, history IDs are non-contiguous, an expired cursor normally returns 404, and the final `historyId` is stored only when no `nextPageToken` remains. Specific change lists can duplicate the generic `messages` list. | [Gmail `users.history.list`](https://developers.google.com/workspace/gmail/api/reference/rest/v1/users.history/list) |
| Slack has separate cursor-paginated history and replies methods; callers must follow `next_cursor`, not infer completion from page size. Its rate-limit notice establishes a conservative regime of one call per minute and 15 results for affected new non-Marketplace apps. | [`conversations.history`](https://docs.slack.dev/reference/methods/conversations.history/), [`conversations.replies`](https://docs.slack.dev/reference/methods/conversations.replies/), [Slack rate-limit notice](https://docs.slack.dev/changelog/2025/05/29/rate-limit-changes-for-non-marketplace-apps/) |
| Resend's received and sent lists are cursor-paginated, and the sent list exposes only the current `last_event`. | [Resend received list](https://resend.com/docs/api-reference/emails/list-received-emails), [Resend sent list](https://resend.com/docs/api-reference/emails/list-emails) |
| CloudEvents 1.0 requires `id`, `source`, `specversion` and `type`; extension values use the CloudEvents scalar type system. Standard Webhooks signs `id.timestamp.payload`, serialises symmetric secrets with `whsec_`, serialises a signature as `v1,<base64>`, and supports overlapping signatures for rotation. | [CloudEvents 1.0.2](https://github.com/cloudevents/spec/blob/v1.0.2/cloudevents/spec.md), [Standard Webhooks specification](https://github.com/standard-webhooks/standard-webhooks/blob/main/spec/standard-webhooks.md) |
| JSON Pointer has no wildcard; tokens escape `~` as `~0` and `/` as `~1`. Native `EventSource` accepts a URL and `withCredentials`, not an arbitrary Authorization header. | [RFC 6901](https://www.rfc-editor.org/rfc/rfc6901), [HTML Standard: server-sent events](https://html.spec.whatwg.org/multipage/server-sent-events.html) |
| TypeSafe documents Jev through its hosted System One API, Noul as a 0–1 yes/no probability, and current model limits, but the reviewed published artefacts and terms provide no local weights or self-hosting contract. Ollama also returns a 0–1 probability for Noul. | [TypeSafe quick start](https://docs.typesafe.ai/introduction/quickstart), [TypeSafe models](https://docs.typesafe.ai/models), [Ollama decisions](https://docs.ollama.com/capabilities/decision) |
| The documented near-name is Laya, from a different publisher. Its published usage is a Transformers-style decision head and it offers an ONNX Runtime extra. | [Laya model page](https://huggingface.co/convaiinnovations/laya) |
| Tauri registers custom commands for all windows/webviews by default unless the application constrains them with `AppManifest::commands`; capability files alone are not that command declaration. | [Tauri capabilities](https://v2.tauri.app/security/capabilities/) |
| A fetch carrying `Authorization` needs CORS permission for that non-wildcard header; a preflight response names its allowed methods and headers, and exact-origin, credential-omitting responses need no `Access-Control-Allow-Credentials`. | [Fetch Standard: CORS protocol](https://fetch.spec.whatwg.org/#http-new-header-syntax) |
| Unicode publishes versioned CaseFolding data and a versioned UTS #46 IDNA algorithm; pinning both to 15.1 prevents the browser and Node evaluators from inheriting different host Unicode behaviour. | [Unicode 15.1 components](https://www.unicode.org/versions/components-15.1.0.html), [UTS #46 revision 31](https://www.unicode.org/reports/tr46/tr46-31.html) |
| Apple's PPPC deployment page documents managed-policy identity by bundle ID or file path plus a designated code requirement. It does not establish how an interactive TCC grant behaves for this daemon; that remains a phase-D hypothesis to test. | [Apple Platform Deployment](https://support.apple.com/en-gb/guide/deployment/dep38df53c2a/web) |

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

**Approval rule.** Enabling or loosening any rule, target, subscriber or judge always needs approval outside the
chat, regardless of `changePolicy`: either `agent-events approve <id>` at the human terminal, or the desktop app's
typed-challenge flow (D13). Phase B1 adds a fourth core approval kind, `disclosure`, and an `app` approval channel;
the present core union has only `send | change | download` (`packages/core/src/approvals.ts:43-54`). A disclosure
record can be approved only through `terminal` or `app` and can be claimed only from `approved`, never directly from
`pending`. `chat` and MCP may prepare and explain one, but can never approve or claim it. This is deliberately
stricter than an ordinary change because it authorises later disclosures the person has not seen. Loopback SSE
subscribers and **every** judge input, including input to a local or bundled judge, are within the standing authority.

**Complete digest.** The daemon creates immutable pending versions and one deterministic preview. The digest is
lowercase SHA-256 over core's recursively key-sorted canonical JSON (`packages/core/src/digest.ts:99-100,117-127`)
of a versioned **canonical full rule document**. That document embeds the referenced immutable documents rather than
hashing only their ids, and contains all of:

- the rule id and version; source channel; event type and type version; and a non-empty, sorted source scope of
  explicit stable account ids. The UI presents their current names, but ids are authoritative. Version 1 offers no
  “all accounts”, “all current accounts” or “all present and future accounts” selector: connecting another account
  cannot add it to an existing rule;
- the complete deterministic-condition AST and agentic condition, including operator options, literal operands,
  threshold and uncertainty policy; and the complete mapping AST, including every object/array position, constant
  value, source pointer and `reject | omit | null` missing policy;
- the complete ordered target set and each target version: kind and id; for a webhook, the canonical full URL
  including scheme, host, explicit/default port, path and query (fragments are refused); resolved-address and
  `localNetwork` policy; untrusted representation; signing mode; delivery ordering; and retry limit. For SSE it also
  embeds the subscriber id/version, exact allowed Origins and stream identity. Secret bytes and secret generations
  are deliberately absent;
- each judge id/version, provider, model, full endpoint, prompt-template version, exact input pointers, output
  interpretation, maximum input/output tokens and every per-rule, per-provider and global call/token/concurrency
  budget that constrains it; and
- the delivery rate cap (default 60 deliveries per rolling hour) and **every** retention value: ingest content,
  hold, delivery, SSE replay, dead-letter payload and decision metadata. The defaults are respectively 24 hours,
  24 hours, 24 hours, 24 hours, seven days and 30 days; SSE remains capped at seven days. Raising any cap or
  retention is a loosening.

Golden tests change one digest field at a time, including an account id, a newly connected but unselected account,
URL path and query, mapping constant, missing policy and each judge budget. Every active authorisation, its full set
of versions, digest, approval time, retention deadlines and remaining rate-cap window appears in
`agent-events doctor` and the app. Nothing is enabled by install, update or import.

**Version and activation rule.** Rules, targets, subscribers and judges are immutable versioned rows in the events
database. A decision and every delivery bind `(ruleId, ruleVersion, targetId, targetVersion[, subscriberId,
subscriberVersion][, judgeId, judgeVersion])`. Delivery uses exactly those versions and never follows a mutable id to
a different endpoint.

Activation crosses the daemon's SQLite database and the core approval store by one recoverable protocol, not by a
claimed cross-store transaction:

1. Under the daemon's activation lock, re-plan the full document and verify its digest. A SQLite transaction inserts
   a unique pending activation intent naming the disclosure approval id, digest, every version to activate and the
   active pointers it expects to replace.
2. Claim that exact `disclosure` approval once in the core store. Core's existing store uses a per-record transition
   and an `O_EXCL` marker for its single-use guarantee (`packages/core/src/approvals.ts:20-29,801-813`).
3. A second SQLite transaction re-checks the intent, expected pointers and digest, marks those versions active,
   records the activation and marks the intent complete.

Startup runs recovery before any source or worker. A pending intent paired with a `used` disclosure approval finishes
step 3; one paired with a pending, approved-but-unused, expired, revoked or absent approval is dropped without moving
an active pointer. Because the intent is durable before the claim, a used disclosure approval can never be stranded
without enough SQLite state to finish. Recovery is crash-injected after every durable write and approval-store
transition.

A loosening or any edit outside the whitelist below creates a pending version. The approved active version keeps
running until that pending version completes the protocol above. The **entire tightening whitelist** is syntactic:

1. disable an object (a remove command activates an immutable disabled/tombstone version);
2. remove a target from a rule;
3. remove an output field from a mapping;
4. lower a rate cap;
5. shorten any retention;
6. change `plain` to `enveloped`; or
7. turn `localNetwork` off.

Every other edit—including any condition edit, constant change, source-pointer substitution, target/subscriber/judge
pointer substitution, new account or output field, or inverse transition—needs a fresh standing authorisation. A
tightening is SQLite-only and commits in one transaction: it moves the active pointer, marks every queued or
retryable affected delivery `cancelled`, purges each cancelled ciphertext, and purges retained SSE entries made under
the superseded rule, target/subscriber or judge version. Property tests generate old/new documents for every
whitelisted edit and prove the new disclosure set is a subset; mutations outside the seven forms are always pending.

Revocation is immediate at that commit. Immediately before delivery I/O, a worker transaction moves a row to
`disclosing` only if the bound rule, target/subscriber and judge versions are still the active pointers and the
global switch is enabled. After revocation commits, no worker can cross that boundary. I/O already in flight cannot
be recalled and is recorded as such.

**Secrets never enter model context.** Creating, entering, revealing or rotating a webhook signing secret, subscriber
token or judge API key is a human-only action in the terminal or app. Terminal entry requires the existing TTY and
agent-marker checks (`packages/core/src/change-flow.ts:208-210,291-320`;
`packages/core/src/cli-runtime.ts:36-60`); any key typed by the person uses hidden input. MCP tools never accept or
return secret material. An MCP-proposed target, subscriber or hosted judge is created incomplete and disabled; the
person completes its secret slot in the terminal or app. Signing-secret and token rotation changes generations inside
a referenced secret slot, not the authorised disclosure fields: two signing generations may overlap (D7), but secret
bytes and generations are absent from the preview and audit.

These human-only secret commands and app operations receive `status: "exception"` rows in `capabilities.json`, with
the reason: "secret material must never enter model input or output; the person completes this operation at the
terminal or app." This follows the existing terminal-only `approve` exception (`capabilities.json:241-254`) and the
rule that a token is never accepted through chat because the transcript retains it
(`docs/superpowers/specs/2026-09-25-cli-mcp-parity-design.md:81-90`). Credential exposure to model context is already
in scope as a vulnerability (`SECURITY.md:32-33`).

**Required `SECURITY.md` amendment.** Phase B1 adds the following exact bullets; this specification does not edit
`SECURITY.md` itself:

> - **Disclosure without a standing authorisation** — any webhook or subscriber stream receiving event-derived
>   content, or any hosted, local or bundled judge being invoked with it, without an active, digest-bound standing
>   disclosure authorisation for the exact rule,
>   target, subscriber and judge versions; after that authorisation is revoked; outside its approved mapping,
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
  channel: 'gmail' | 'slack' | 'resend' | 'whatsapp' | 'agentcomms';
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
collision instead of merging unequal canonical identities.

Every event carries `{ id: eventId, type, version, occurredAt, observedAt, account: { name, id, channel }, hop }` and
its own body. `hop` is zero for provider events and is bounded as D12 specifies. Version 1 includes:

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
envelope strings when selected. Catalogue validation proves every address, handle, workspace and semantic-format
pattern is legal for the schema and expands only to values of the declared type.

### D4. Sources: polling first, with complete cursors and reset detection

| Source | Version 1 | Later |
|---|---|---|
| Gmail | Poll `users.history.list` from the stored `historyId`. Follow every `nextPageToken` before committing the final response's `historyId`. An occurrence key is `(historyRecordId, messageId, changeType)`; use the specific change arrays, not duplicate generic entries. `messageAdded` with `DRAFT` is ignored; with `SENT` and not `DRAFT` it is sent; without either it is received. `SPAM` and `TRASH` are excluded unless the rule opts in. Label changes are emitted separately. A 404 re-baselines at `getProfile().historyId` and emits `agentcomms.source.gap`, with no silent backfill. These rules implement Gmail's pagination and change model ([Gmail `history.list`](https://developers.google.com/workspace/gmail/api/reference/rest/v1/users.history/list)). | `watch` plus Pub/Sub pull may wake the same reconciliation path; it never replaces `history.list`. |
| Slack | Poll only conversations named by active rule versions and promise **top-level posted messages only**, plus the bounded reply reconciliation below. Each conversation has a committed timestamp watermark and a durable scan `{oldest: watermark, latest: cycle-start, cursor}`. Follow every `response_metadata.next_cursor`, even after a short or empty page; a cycle may spend only its workspace request budget, so a cut-short scan persists that exact cursor and boundary and continues next cycle. It commits the new watermark only after the last page and committed ingest. A budget cut, ordinary empty page or `invalid_cursor` alone is never a gap. On `invalid_cursor`, restart the same bounded scan without a cursor; emit `agentcomms.source.gap` only when Slack explicitly reports an `is_limited` or equivalent retained-history boundary that excludes the committed watermark. If coverage cannot be established, mark the source degraded and do not advance or emit a gap. Posts dedupe on `(channelId, ts)`. The scheduler supports Slack's conservative affected-app limit and learns from 429/`Retry-After`; the UI shows worst-case latency ([`conversations.history`](https://docs.slack.dev/reference/methods/conversations.history/), [Slack rate-limit notice](https://docs.slack.dev/changelog/2025/05/29/rate-limit-changes-for-non-marketplace-apps/)). For a thread whose parent was observed within the previous seven days, maintain a separate reply watermark and fully cursor-page `conversations.replies` under the same resumable budget ([`conversations.replies`](https://docs.slack.dev/reference/methods/conversations.replies/)). **Polling does not emit replies to older threads or any message edits.** Those are documented version-1 polling limits, not silent completeness claims. | Phase F's Socket Mode source is the complete path for posts, replies to threads of any age and edits; it reconciles reconnects before advancing its event cursor. |
| Resend | `received.list` is paged newest-first until the stored last-seen received id appears, then that id advances only with committed ingest. The sent list is paged newest-first through every id from the most recent seven days. Those ids have rows in a state table for seven days; each read compares `last_event` with the stored value and emits only a change. The UI says these are observed states, not every intermediate transition. The daemon may consume at most half the machine-wide throttle and an interactive CLI/MCP call always takes the next available slot. | A signed hosted relay for Resend webhooks is a separate product. |
| WhatsApp | Change the existing snapshot-and-rebuild sync (`packages/whatsapp/src/operations/sync.ts:45-113`) so, under its index lock, it renames the current target to an owner-only sibling `index.previous.sqlite` **before** the existing atomic building-index replacement point (`packages/whatsapp/src/index-db.ts:266-277`), then renames the checked building index into place and fsyncs the directory. Startup restores the sibling if a crash landed between the renames. Diff old and new before deleting the sibling. The comparison is a multiset: rows with `ZSTANZAID` are counted under that id; otherwise occurrences are keyed by `(chatId, timestamp, sender, SHA-256(text), occurrenceIndex)`, where the stable occurrence index is the row's order within that equal four-field group. Equal rows are never coalesced, and repeated stanza ids also retain their counts. A decrease in maximum `Z_PK`, an index-format change, or disappearance of a previously retained non-empty stanza-id set is a store reset: re-baseline and emit a gap rather than treating old high-water marks as current. Apple's PPPC page establishes only the identifiers available to a managed privacy payload ([Apple Platform Deployment](https://support.apple.com/en-gb/guide/deployment/dep38df53c2a/web)). **Hypotheses for the phase-D spike**, not current claims, are that interactive TCC follows the same executable identity and that app-launched and service-launched copies may need separate grants; background collection does not ship until the spike establishes the actual behaviour and the app explains it. | A file-system notification may wake the same safe snapshot path; it never reads the live store. |

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
- Every leaf whose path is missing evaluates Boolean `false`, including `equals`, `notEquals`, comparisons and
  `domainIs`. `not` is ordinary Boolean negation of its child, with no missing-value propagation, so
  `not(equals(missing, x))` is `true`; `exists` alone tests presence and is `false` for a missing path. `in` means the
  path's scalar value is one of `values`. `contains` means substring for strings and element membership for arrays,
  with `value` having the array schema's element type. `startsWith`, `endsWith` and case sensitivity are string-only.
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
- No regular expressions in version 1. Limits: depth 8, 64 nodes, scalar value 1 KB, `in` 256 values. The tree is
  saved; its sentence is generated. Repository JSON conformance vectors cover missing/negation, every legal format,
  Unicode 15.1 folding and UTS #46, and the same vectors run against Node and a real browser build.

**Agentic** — a question put to a judge after a real deterministic prefilter:

- `{ judgeId, judgeVersion, question, inputs: JsonPointer[], threshold, onUncertain }`. At least one deterministic
  leaf must reference a catalogue `content` field; account/type checks alone do not qualify.
- The judge sees only `inputs`, sanitised and enveloped in a fixed versioned prompt. Input to every hosted, local or
  bundled judge is taint-flushed before the call (D7). It has no tools, secrets or authority.
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

| Target | Version 1 contract |
|---|---|
| **Webhook** | HTTPS `POST` of the exact CloudEvent bytes, Standard Webhooks signed. Success is 2xx. Retry with capped exponential backoff and jitter until success, the approved delivery-retention deadline or 20 attempts. Exhausting attempts before the deadline is `dead-lettered`; reaching the deadline first is `retention-expired`. Promise: **bounded at-least-once attempts**, not unconditional receipt. |
| **Local SSE stream** | `GET /v1/streams/<subscriber>` on 127.0.0.1/::1. Each subscriber has an encrypted retained stream log, default 24 hours and maximum 7 days, bound into its standing authorisation. `Last-Event-ID` replays entries still in that window only while every recorded version is active and the global switch is enabled. There is no acknowledgement, so the promise is only **available for replay within the approved window**, never receipt or processing. |

Every phase-F adapter is reviewed first-party code inside the daemon and implements exactly
`deliver(payload, versions) -> delivered | retryable | permanent`. `versions` carries the exact rule, target,
subscriber and judge versions; `delivered` means acceptance at the boundary named below, never proof that an
eventual consumer processed the message. The target version declares that boundary, downstream guarantee, ordering
scope, idempotency key and error classification before it can be approved:

| Phase-F adapter | `delivered` boundary, guarantee and ordering declaration |
|---|---|
| Socket.IO | A named application acknowledgement. The daemon retries the same delivery id before later rows in its ordering key, giving bounded at-least-once attempts and duplicates on an ambiguous acknowledgement; receive order is serial within that key. Socket.IO itself guarantees message order but defaults to at-most-once arrival, so the acknowledgement/retry layer is part of this adapter, not an inferred platform promise ([Socket.IO delivery guarantees](https://socket.io/docs/v4/delivery-guarantees/)). |
| NATS JetStream | A server `PubAck`. Publication is retried with the delivery id as the message id; consumer redelivery and order are those of the approved stream/consumer configuration, recorded in the target version, not a blanket exactly-once claim ([NATS JetStream](https://docs.nats.io/nats-concepts/jetstream)). |
| Redis Streams | Successful `XADD` of the delivery id. Entries are append-ordered within the approved stream; consumer groups are at-least-once and consumers must deduplicate by delivery id ([Redis streaming](https://redis.io/docs/latest/develop/use-cases/streaming/)). |
| Google Pub/Sub | A successful publish acknowledgement. Default subscriptions are at-least-once and unordered; an approved target may promise within-key order only when ordering is enabled and the daemon ordering key is used ([Pub/Sub subscription properties](https://cloud.google.com/pubsub/docs/subscription-overview)). |
| EventBridge / SQS | Successful `PutEvents` entry or `SendMessage`. EventBridge and SQS Standard are at-least-once with no strict order; an SQS FIFO target alone promises order within its approved message-group key ([AWS decision guide](https://docs.aws.amazon.com/decision-guides/latest/decision-guides/sns-or-sqs-or-eventbridge.html)). |
| QStash | Accepted enqueue with delivery id as the deduplication key. Delivery is at least once; FIFO is promised only for an approved queue with parallelism one, which blocks later entries behind retries ([QStash use cases](https://upstash.com/docs/qstash/overall/usecases), [QStash queues](https://upstash.com/docs/qstash/features/queues)). |
| Trigger.dev | An accepted task run with the delivery id as its idempotency key. The adapter promises no execution order; a target that needs serial execution must name an approved queue/concurrency key and still documents only the ordering Trigger.dev actually guarantees ([Trigger.dev idempotency](https://trigger.dev/docs/idempotency), [concurrency and queues](https://trigger.dev/product/concurrency-and-queues)). |

**Retention is terminal.** A held decision receives `holdExpiresAt` from the approved hold window, default 24 hours;
if no person resolves it by then, one transaction records terminal outcome `hold-expired` and purges its retained
ciphertext, creating no delivery. Every delivery has an approved absolute retention deadline independent of its retry
or rate-cap schedule. If it has not crossed to `disclosing` before that deadline—including because it waited behind a
rate cap—it becomes terminal `retention-expired` and its ciphertext is purged. Cancelling a delivery records
`cancelled` and purges its ciphertext in the **same** transaction. Webhook payloads are purged after a 2xx; SSE
payloads after their window or any bound-version revocation. A webhook that exhausts attempts before its delivery
deadline becomes `dead-lettered`; its encrypted payload remains only for the separately approved dead-letter
retention, default seven days, then is purged, and `delivery drop` purges it immediately. When one decision has
multiple targets, each target copy reaches its own terminal outcome and deadline.

**Taint before every judge and disclosure.** Before **every** judge call—hosted, loopback/local or bundled—before
webhook or phase-F network I/O, and before appending an SSE event to a subscriber-readable log, the daemon takes the
structured addresses, scoped platform handles and prose-extracted addresses derived through D3 mapping provenance
from the exact target-specific value. It records them in core's taint store under the originating source
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
`Host` is checked against the listener's fixed local authority. Rotating a subscriber token atomically installs the
new generation and invalidates the old token immediately, but does **not** purge retained entries or create a new
subscriber version; revoking the subscriber version does both deny access and purge its entries in the revocation
transaction.

### D8. Durable ingest, decisions and outboxes

One SQLite database, `<stateDir>/events/events.sqlite`, is owned only by `agent-events run`:

- `event_settings(singleton, enabled, changedAt, activationId?)` — the authoritative global switch;
- immutable `rule_versions`, `target_versions`, `subscriber_versions` and `judge_versions`, each holding its full
  canonical document and digest; `active_versions(kind, objectId, version, approvalId, activatedAt)`; durable
  `activation_intents` and append-only `activations`/`revocations`;
- `cursors(source, account, cursor, updatedAt)`;
- `ingest(eventId UNIQUE, installationId, type, version, accountId, dedupeKey, occurredAt, observedAt, ciphertext,
  nonce, tag)` plus `ingest_rules(eventId, ruleId, ruleVersion, decisionDeadline)`;
- `decisions(id, eventId, ruleId, ruleVersion, outcome, judge…, UNIQUE(eventId, ruleId, ruleVersion))`;
- `deliveries(id, decisionId, ruleId, ruleVersion, targetKey NOT NULL, targetId, targetVersion, subscriberId?,
  subscriberVersion?, judgeId?, judgeVersion?, ciphertext, attempts, nextAt, expiresAt, state, leaseUntil,
  lastError, UNIQUE(decisionId, targetKey))`, where `targetKey` is exactly
  `webhook:<targetId>:<version>` or `sse:<subscriberId>:<version>`;
- `stream_log(id, ruleId, ruleVersion, targetId, targetVersion, subscriberId, subscriberVersion, judgeId?,
  judgeVersion?, eventId, ciphertext, expiresAt)`;
- source-specific cursor/state tables, judge-budget reservations and worker leases.

`eventId` is D3's deterministic id and `UNIQUE(eventId)` is the ingest idempotency boundary. On a conflict, the
transaction compares the stored `(installationId, accountId, type, version, dedupeKey)` with the canonical identity:
an equal tuple is a repeat; a different tuple is a fatal `event_id_collision`, leaves the source cursor unchanged and
degrades that source rather than merging events. Cross-account and forced-hash-collision tests cover both branches.

The source transaction inserts each encrypted normalised event, snapshots the exact enabled rule versions into
`ingest_rules` and advances its cursor together. An ingest row is kept until every snapshotted rule has a terminal
decision. A rule that has not reached a decision by its approved ingest-content deadline receives terminal
`retention-expired`; a held result reaches terminal `hold-expired` at its hold deadline. Neither creates a delivery,
and both permit immediate ciphertext purge once the other snapshotted rules are terminal. A crash before or after
cursor commit, decision insert, judge response or delivery creation re-evaluates from ingest, with the uniqueness
constraints absorbing repeats. Delivery retries use the stored payload and exact versions; they never re-evaluate,
re-map or re-ask a judge.

All content-bearing blobs — ingest, deliveries and stream entries — are encrypted in the application with AES-256-GCM
under one random per-installation key held only in the secret store. Every write uses a unique 96-bit nonce and AAD
binding table, row id and version. SQLite receives ciphertext, nonce and tag, never plaintext payloads, so WAL and
free-page residue contain ciphertext too. Metadata needed to schedule and audit remains plaintext. Key loss makes
retained content unrecoverable and is reported by `doctor`; there is no plaintext fallback.

While evaluation is paused by the required-update gate, source polling pauses as well: the daemon never advances
cursors while it cannot decide retained events. `rule test` has the zero-network contract in D10 and never performs a
fresh provider read.

Workers claim rows with expiring leases. On restart an expired lease returns to its prior retryable state. Ordering,
when enabled, is only by `(rule, account, target)`, so one failing destination does not block another. Immediately
before external I/O, one SQLite transaction re-reads `event_settings.enabled` and every bound active pointer, checks
the delivery deadline, reserves the approved rolling-hour rate-cap slot and moves the row to `disclosing`. A failed
check instead reaches `cancelled` or `retention-expired` and purges ciphertext in that transaction. SSE append and
replay transactions perform the same switch/pointer checks. Each appended stream row stores all of the rule,
target/subscriber and optional judge versions under which it was made; revoking any one purges matching rows in the
same pointer-change transaction. Subscriber-token rotation changes only the secret generation, invalidates the old
token and retains those rows.

Decision metadata defaults to 30 days; ingest content, holds, delivery and SSE replay default to 24 hours;
dead-letter payload retention defaults to seven days. The person may shorten any retention through D2's whitelist.
Raising one needs a new standing authorisation. Expiry workers use database time/deadlines and terminal transitions,
not best-effort deletion jobs.

### D9. Authoritative event state and the config boundary

`config.json` gains **no `events` key and carries no event state**. Rules, targets, subscribers, judges, every
immutable version and pending/active pointer, source cursors, the global switch, activation intents, activations and
revocations live only in D8's daemon-owned SQLite database. Event secret references live in the relevant immutable
SQLite version; secret bytes remain in core's secret store.

The existing config remains necessary only for core/channel concerns that predate events: connected inbox/account
identity and provider credentials, the chosen secret-store backend, and ordinary send/change policies. Event sources
refer to those accounts by stable id but do not copy or mutate them. Core changes only to add the `disclosure`
approval kind/channel and its terminal/app claim path; `classifyChange` does not learn an events field and its
existing safety fields stay unchanged (`packages/core/src/config.ts:1375-1483,1487-1548`). This keeps standing
authority out of a file whose current commit primitive is an atomic rename (`packages/core/src/config.ts:949-951`)
and makes every tightening, cancellation and SSE purge one SQLite transaction.

There is no mutable "current target" behind a delivery. SQLite active pointers move only through D2's activation or
tightening transactions, and queued rows hold exact versions. **Loosening keeps the approved version running;
tightening replaces it, cancels superseded work, purges its ciphertext and removes replayable SSE content in one
store.** No older-release config compatibility fixture is needed because there is no event config value for an old
reader to preserve.

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
| Daemon | `status`, `run`, `stop`, `pause|resume`, `disable-all|enable-all`, `approve <id>`, `doctor` |

`rule test` is the same operation from CLI and MCP and may evaluate a disabled or unapproved rule because it has a
strictly local contract. Its input is either catalogue `examples` or retained ingest rows from explicitly named
accounts the calling server is currently allowed to read (respecting its pin and live account access). It evaluates
only deterministic conditions and the mapping; an agentic node is reported `not-evaluated`. It never calls a judge,
provider or target, never advances a cursor and never creates a decision/delivery. Returned source and mapped values
are sanitised and enveloped regardless of the pending target's representation, and their D3-derived taint is flushed
before return exactly like any other read; a flush failure fails the test.

`judge test` may call only an already approved, active judge version. The terminal or app may test a pending judge
from the approval screen as part of approving that exact version; MCP and ordinary CLI calls cannot. The same rule
applies to **every** real judge call, hosted, local or bundled. `target test` keeps the equivalent restriction in D7.
Automated tests inject every provider/judge/target transport and fail on any real socket; they prove an unapproved
`rule test` or `judge test` makes zero network calls.

MCP can otherwise read and propose disabled, secretless versions. It cannot approve or claim a disclosure
authorisation, resolve a held model decision, test an unapproved target/judge, or accept/return/reveal/rotate a
secret. The paired terminal commands and app operations exist, but each gets a `status: "exception"` capability row
naming its human-only reason. `run` is also an exception because a tool cannot start the server in which it runs. The
precedent for visible exceptions and same-operation parity is
`docs/superpowers/specs/2026-09-25-cli-mcp-parity-design.md:164-168` and `capabilities.json:241-254`.

The first call that enables or loosens a disclosure returns `standingApprovalRequired`, a `disclosure` approval id,
digest and complete preview. A repeated MCP call cannot claim it. The terminal/app approval operation re-plans under
the daemon activation lock, refuses digest drift and runs D2's intent → core claim → SQLite activation protocol.
`doctor` reports daemon/protocol health, global switch, active authorisations, pending intents, source lag, leases,
held decisions, dead letters, retention deadlines and missing secrets.

The `agentcomms-events` skill teaches an agent to propose and test a disabled rule, explain both untrusted
representations, and hand the approval id to the person. It never instructs the agent to type or request a secret.

### D11. Judges: hosted Jev, local endpoints, and an optional bundled model

| Kind | Contract | Disclosure |
|---|---|---|
| `typesafe` | Jev through `POST https://api.typesafe.ai/v1/systemone`, using provider-native Noul output. It is **treated as hosted-only under currently published artefacts and terms**; this is not a claim that local Jev is impossible. | Exact approved input fields leave for the approved host. |
| `local-endpoint` | An approved loopback Ollama/System One endpoint or a generic JSON-output model. Generic numbers are uncalibrated scores. The endpoint gets the same per-connection resolution, pinning and redirect refusal as D7; pending endpoints cannot be reached from MCP tests. | Local network only; D7 taint still flushes before every call. |
| `bundled` | A separately downloaded model run locally. | No network disclosure, but D7 taint still flushes before invocation and the version still needs standing authority. |

Models are never in the installer. An opt-in download shows name, exact version, publisher, licence, checksum and
size; a signed manifest and SHA-256 are verified before atomic installation. "Leia" remains unidentified. Laya is a
separate publisher's candidate and, if evaluated, runs through its published Transformers-style decision head with
an explicit export to ONNX and the ONNX Runtime path — not `llama.cpp`
([Laya](https://huggingface.co/convaiinnovations/laya)).
Redistribution requires a licence that permits it and a labelled Gmail/Slack quality evaluation.

Every judge is immutable and versioned. No hosted, local or bundled judge may be called until that exact judge
version is active under D2, except for one terminal/app call made inside its own approval screen as D10 defines. A
hosted judge additionally needs its key completed by a person. "Never use judges" and disabling one judge are
immediate whitelist tightenings: the transaction moves its active pointer, cancels and purges queued work, and purges
SSE rows whose decisions used it. Prompt injection can change only the model's bounded score/reason code; it cannot
change rules, mappings, targets or authority.

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

The owner's **global switch** is separate from operational pause and is the `event_settings.enabled` row in D8.
`agent-events disable-all`, its MCP peer and the app switch are one immediate tightening: a single SQLite transaction
sets it false, cancels every queued/retryable delivery, purges those ciphertexts and purges every retained SSE entry.
It needs no approval. It does not revoke the underlying standing authorisations, so `enable-all` may resume the exact
still-active, unexpired versions, but enabling is a disclosure loosening and needs a new terminal/app-only
`disclosure` approval. Its canonical preview and digest enumerate the active authorisation digests it will resume;
pointer or digest drift refuses it. Enabling uses D2's activation-intent → core-claim → SQLite-commit protocol and
does not resurrect cancelled deliveries or purged replay entries.

Every boundary races safely with disable. A source transaction re-checks the switch before committing ingest/cursor;
a judge reservation moves to `judging` only in a transaction that checks the switch and active rule/judge pointers;
D8 performs that check before `disclosing`, SSE append and SSE replay. A provider read or external judge/delivery I/O
that crossed its boundary before disable is recorded as in flight and cannot be recalled, but no later operation can
cross. Tests stop each worker at both sides of every boundary. `pause|resume` remains an operational control that
retains queues and replay and therefore grants no disclosure authority; it cannot stand in for `enable-all`.

Operational events increment `hop`; the daemon refuses to emit one past hop 3. A delivery of
`agentcomms.delivery.dead_lettered` that itself dead-letters is audited but never emits another dead-letter event.

### D13. The desktop app

**Shape:** Tauri v2, React, Vite, `@cueplusplus/ui` with `@cueplusplus/tokens` and
`@cueplusplus/theme-cue`, a tray icon and one settings window.

**Screens:**

1. **Overview** — the authoritative global enable/disable switch, daemon/protocol health, source lag, active
   authorisations, recent delivery outcomes, held decisions and pending approvals. Disable applies immediately;
   enable opens the D12 out-of-chat approval flow.
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
supplied by the webview. The TypeScript terminal renderer and Rust app renderer are separate implementations of one
text-only contract: no HTML interpretation, bidi/C0/C1, zero-width and control characters neutralised, links
displayed as inert text and never clickable, and envelope-looking text unable to close or forge a section. They run
the same repository JSON fixtures in `test/fixtures/disclosure-preview/*.json`; each fixture contains the structured
preview input and exact expected UTF-8 bytes, and either renderer drifting fails CI. Rust shows the daemon-issued
challenge, then calls the daemon's approve operation. Under the daemon activation lock, it re-plans and re-checks the
digest/challenge, records approval through core, and runs D2's recoverable activation protocol.

The webview has no shell, file-system or direct network permissions. Rust alone holds the control session. Secret
entry/reveal is a deliberately narrow Rust command invoked only from the secret screen and never copied to logs,
audit or app telemetry. Capability files are scoped to the settings window, and the build also restricts registered
custom commands per window with `tauri_build::AppManifest::commands`, because Tauri otherwise exposes registered
commands to every window/webview ([Tauri capabilities](https://v2.tauri.app/security/capabilities/)).

Tests cover the cross-language JSON vectors; HTML tags, bidi/control characters, OSC/CSI, fake headers and
envelope-looking preview text; inert links; digest drift; wrong or missing challenge; a webview-supplied fake preview;
and generated command-manifest access from every window.

### D14. Repository structure, packaging and versions

```text
apps/
  desktop/                # Tauri + React + @cueplusplus/ui
packages/
  core/                   # gains disclosure approvals/app channel; no event configuration
  events/                 # NEW @agentcomms/events — isomorphic catalogue, pinned Unicode, conditions, mapping
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

Delivery adapters remain reviewed first-party modules inside the daemon, implement D7's three-result contract and
declare their guarantee/ordering in each target version. There is no `kind: "delivery"` manifest: a manifest cannot
stop an adapter from reading the shared secret store or outbox.

All npm packages remain lockstep. The desktop has its own version but declares a tested daemon-protocol support
matrix. Root `pnpm verify` runs the desktop TypeScript typecheck, unit tests and the TypeScript side of the shared
renderer vectors. The desktop workflow runs on macOS, Windows and Linux and, on **each** platform, runs
`cargo fmt --all -- --check`, `cargo clippy --all-targets --all-features -- -D warnings`,
`cargo test --all-targets --all-features`, the Rust side of the renderer/command/secret tests, and an unsigned Tauri
build. Signing/notarisation is a later credentialed release job, not a substitute for this cross-platform build gate.

The private/public `@cueplusplus` distribution choice and signing identities remain owner decisions (§8). If those
UI packages remain unpublished and private, unauthenticated fork CI cannot install them; phase C must then either
publish the packages or place the app and its credentialed builds in a private repository.

## 4. Phases

Each phase is specified, reviewed, planned and built separately. The order is by safety invariant, not by screen.

| Phase | Delivers | Depends on |
|---|---|---|
| A | Isomorphic `@agentcomms/events`: catalogue and pointer/provenance patterns, semantic formats, bundled Unicode 15.1 case folding and UTS #46, conditions, mapping, generated source/delivery schemas and shared Node/browser conformance vectors; no I/O or `node:` imports | — |
| B1 | Daemon skeleton: authenticated/versioned control protocol, stale recovery, owner-only authoritative SQLite state and global switch, AES-GCM durable ingest, deterministic event ids, Gmail source, rule evaluation, core `disclosure` approvals plus recoverable activation intents, immutable standing authorisations and the `SECURITY.md` amendment, per-source taint-before-every-judge/disclosure, terminal retention, outbox/leases/cancellation; **only** a local `dry-run` target that records what would have been sent | A |
| B2 | Network hardening, pinned resolution, Standard Webhooks per-attempt signing/rotation, webhook delivery, authenticated SSE, exact-origin CORS, replay retention and version-bound purge | B1 |
| B3 | CLI/MCP parity and exception rows, human-only secret completion, `doctor`, event skill | B2 |
| C | Desktop app and tray lifecycle, Rust approval/secret surfaces, supervision and protocol compatibility | B3; CUE++ distribution decision |
| D | Slack, Resend and WhatsApp sources, including resumable Slack pagination/documented polling limits and WhatsApp old-index multiset diff; each ships with per-source taint and reset/fairness tests | B1 |
| E | Hosted/local judges, holds, durable budgets, adversarial corpus; refuses to build or ship unless B3's secret-completion and human-only capability surfaces are present | B3 (C for app hold resolution) |
| F | Evaluated bundled judge, OS service, first-party adapters under D7's contract, Gmail Pub/Sub and the complete Slack Socket Mode source | D, E |

No phase before B2 can make network disclosures. No new source ships without taint-before-disclosure.

## 5. Tests the phases owe

- **Catalogue, identity and pointer grammar:** every schema/example and semantic-format/address/handle declaration;
  pattern validation and expansion; `~0`, `~1`, root `""`, empty keys, numeric array indices, refused leading zeroes
  and `-`, literal `*`, copied parents/ancestors/descendants, and own-property handling of `__proto__`, `constructor`
  and `prototype`. Event-id vectors cover stable repeats, the same dedupe key in different accounts, every tuple
  component and an injected SHA collision that stops without advancing the cursor.
- **Conditions and local tests:** every operator × legal schema type and every refused format/type pairing; empty
  `all`/`any`/`in`; every missing leaf false, plain `not`, and `exists`; Unicode 15.1 folding and UTS #46 vectors run
  in Node and a browser; invalid dates and subdomains. `rule test` runs catalogue and authorised retained-ingest
  cases, returns only sanitised/enveloped output, records taint, marks agentic nodes not evaluated and makes zero
  provider/judge/target requests. Unapproved `judge test` also makes zero network requests.
- **Judges and budgets:** exact uncertain boundaries including threshold 0 and 1; provider probability vs
  uncalibrated score; content-field prefilter; approved-version enforcement for hosted, local and bundled calls;
  terminal/app pending-version exception; durable per-rule/provider/global reservations, concurrency 2, timeouts
  counted and malformed output fail-closed. All automated transports are loopback fakes or injected functions.
- **Mapping and wire:** constants, objects/arrays, every missing policy, both representations and generated schemas;
  provenance through parent/object/array copies; canonical `agentcommsuntrusted` including root; URI-escaped source
  components; exact CloudEvents 1.0 shape; non-null webhook/SSE `targetKey` uniqueness. Exact-byte Standard Webhooks
  tests cover `whsec_`, overlapping signatures, raw-body verification and five-minute tolerance; an injected clock
  proves retries keep `webhook-id`/body and change `webhook-timestamp`/signature.
- **Digest and activation recovery:** one-at-a-time digest mutations for source/account scope, connecting a new
  unselected account, URL path/query, conditions, constants, pointers, missing policies, all caps/retentions and every
  judge budget. Crash injection before/after activation-intent insert, core claim-marker creation, core `used`, active
  pointer commit and completed-intent mark proves `intent + used` finishes and every unused/expired case drops.
- **Ingest and worker crash recovery:** before/after cursor/ingest commit, decision insert, judge response persistence,
  delivery creation, `disclosing`, webhook 2xx recording and SSE append. Every restart reaches one terminal decision
  per `(eventId, ruleId, ruleVersion)`, one delivery per `(decisionId, targetKey)`, and never advances over memory-only
  content.
- **Tightening, revocation and global races:** property tests generate each of D2's seven whitelisted edits and prove
  its disclosed set is a subset; every condition/constant/pointer or other edit is pending. Concurrent disable/remove
  and `disable-all` race polling commit, judge transition/call, webhook claim, SSE append and SSE replay. A disclosure
  crosses `judging`/`disclosing` before the transaction or is cancelled/refused with ciphertext purged; it never
  follows a mutable version. `enable-all` needs a disclosure approval and resurrects no old work.
- **SSE:** replay inside and refusal outside retention; rule, target, subscriber and judge revocation each purge only
  bound entries in the same transaction; global disable purges all entries; token rotation rejects the old token but
  preserves replay under the new one. A real-browser test completes the approved exact-Origin OPTIONS preflight and
  fetch-streams with `credentials: "omit"`; unapproved Origin, method/header, query/cookie token and wrong Host/bearer
  are refused; native `EventSource` remains unsupported.
- **Taint:** structured address and Slack-handle provenance through scalar, parent and object mappings and judge input;
  free-text address extraction; workspace scope retained. Forced taint-store failure proves no hosted, local or
  bundled judge call, webhook/phase-F request or readable SSE append occurs; errors stay untrusted and reason codes
  constrained.
- **Retention:** held-decision expiry produces `hold-expired` with no delivery; unevaluated ingest and rate-cap backlog
  reach `retention-expired`; cancellation purges payload in its pointer-change transaction; webhook success,
  dead-letter expiry/drop and independent multi-target deadlines purge exactly their ciphertext and leave metadata.
- **Secrets:** scan CLI/MCP inputs and outputs, structured content, logs, audit, database metadata and app IPC. MCP
  proposals contain no secret; terminal hidden input and app reveal-once work; signing rotation sends two signatures;
  subscriber rotation invalidates the old token without purging; no secret is exposed.
- **Sources:** Gmail multiple pages, duplicate generic/specific records, add/remove/add occurrences, DRAFT/SENT,
  spam/trash and 404 gap. Slack tests short/empty pages with `next_cursor`, bounded cycle continuation, watermark
  commit, history-loss-only gap, seven-day reply pagination, refusal to promise old-thread replies or edits, and phase-F
  Socket Mode coverage of both. Resend covers received pagination, seven-day sent state, half-share and interactive
  priority. WhatsApp covers old-index rename/crash restore, stanza and fallback multisets with identical duplicates,
  occurrence indices, all reset signals and the executable-identity spike.
- **Network and adapter contract:** DNS rebinding on every attempt; mixed good/refused answers; all named IPv4/IPv6
  special ranges and mapped forms; SNI/Host preservation; redirects; unapproved target/judge tests. Contract tests
  drive every first-party adapter through `delivered | retryable | permanent`, verify its acceptance boundary,
  idempotency key and declared order, and use only fakes—never Slack, Gmail, Resend or a real queue.
- **Control, storage and app:** Unix `0700` parent, same-uid peer/token; Windows pipe/state ACLs; protocol negotiation,
  authentication/error shape, stale recovery, leases, encrypted DB/WAL/free pages, SQLite as the sole event authority,
  and protocol compatibility. Hostile preview fixtures produce byte-identical TypeScript/Rust output; fake webview
  data, digest drift, wrong challenge and per-window commands fail. On macOS, Windows and Linux the desktop workflow
  runs Rust fmt, clippy with warnings denied, tests and an unsigned Tauri build.
- **Parity, phases and packaging:** every capability row is driven on CLI and MCP and every exception reason checked;
  no `"agentcomms"` non-channel kind; both `agentcommsPackage` kinds publish in dependency order; browser import has
  no `node:` edge; root verify runs the TypeScript desktop/vector side. A phase-E gate deliberately removes or stubs
  B3 secret completion and human-only operations and proves judges then refuse to build or ship.

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
2. **A same-user hostile process can drive terminal or app.** The existing security policy describes that boundary
   without assigning it a tier (`SECURITY.md:51-63`). Typed challenges and peer/token checks are meaningful against
   accidental and model-only action, not a hostile process with the user's full authority.
3. **Agentic decisions can be wrong or injected.** Their maximum effect is the approved decision path; prefilters,
   exact inputs, no tools, durable caps, uncertainty handling and fail-closed validation limit cost and action, not
   semantic error.
4. **Content exists at rest.** Ingest, outbox and stream replay require retained content. Application-level
   AES-256-GCM keeps plaintext out of SQLite pages, WAL and free-page residue, while approval-bound retention and
   prompt purge bound duration. A same-user process that can use the installation key is outside this design's
   protection, as `SECURITY.md:51-63` states.
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
   payloads, and 24 hours for ingest content, holds, delivery and SSE replay. Should any default be lower before
   implementation planning?
6. **“Values as they are”** — this design means typed, sanitised source values with no transforms, not provider raw
   bytes. Is that the accepted product meaning?
