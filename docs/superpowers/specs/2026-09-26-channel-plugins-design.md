# Channels declared by manifest — design

Status: decided 2026-09-26 by the owner, and implemented for 0.7.0 as the foundation the Resend channel, and after it
WhatsApp, are built on. It builds the platform registry the [skills design](2026-09-20-skills-architecture.md) §5
promised and never got. The [parity design](2026-09-25-cli-mcp-parity-design.md) is unchanged: every capability is
still a command and a tool running one operation.

## 1. What was asked, and what was decided

The owner asked for channels to be plugins: a new platform should be a package, not a round of edits through the core
and the tooling. A code study found the channels were written down by hand in about eleven places in the core, the
scripts and the tests — each one a place a new channel had to be added, or was silently not checked — and one fail-open
bug in the loosening classifier. Four decisions:

1. **First-party only.** A channel lives in this monorepo and is released in lockstep with the core
   (`scripts/packages.mjs`). Nothing is loaded from anywhere else in 0.7.0. The manifest is the shape a reviewed
   registry of third-party channels would read later (§8).
2. **A channel says what it is in its `package.json`**, as pure data, validated by a schema in the core. The core
   builds in a snapshot of the first-party manifests; everything it knew about Gmail and Slack by name is derived
   from that snapshot.
3. **One registry for the tooling**, derived from the same manifests, which every script and test reads.
4. **Account modes are a closed vocabulary**, `read` and `send`, and anything else is a loosening that needs consent.

## 2. The manifest

The `"agentcomms"` field of a channel package's `package.json`. It is data, so it can be read without running any of
the channel's code — by the tooling, by the build that snapshots it, and later by anything that has to decide about a
package before installing it. The schema is `channelManifestSchema` in `packages/core/src/channel-manifest.ts`; it is
strict, so an unknown key is an error rather than something quietly ignored.

| Field | What it is | Rules |
|---|---|---|
| `contract` | The version of this contract the manifest is written against | `1` |
| `channel` | The platform word: the second half of every account name (`acme/<channel>`), the prefix of the server's tools (`<channel>_…`) and of its secret references | A platform word (`[a-z][a-z0-9]{0,15}`), equal to the package's directory name; `core` is the core's |
| `label` | How a person is shown it: `Gmail`, `Slack` | One line |
| `binary` | The command a person types | `agent-<something>` (the core's is `agentcomms`), and so is every one of `server.bins`; the approve command starts with it |
| `server.defaultName` | The name a client shows for its server | Unique across channels |
| `server.npxPackage` | What `npx` runs: the package itself, or a thin server-only package | A package of this suite |
| `server.npxArgs` | What `npx` runs it with before the server's flags: `["mcp"]` for a whole CLI | Optional |
| `server.entryFiles`, `server.bins` | Other files and commands that start the same server (Gmail's `agent-gmail-mcp`) | Optional |
| `accounts.map` | The config map its accounts live in | `inboxes` is Gmail's, and only Gmail's; every other channel uses `accounts` |
| `accounts.noun` | What one is called in a sentence: `mailbox`, `workspace`, `account` | Used in every preview |
| `accounts.modes` | The modes it offers, narrow to wide | From `read`, `send`, each once, in that order |
| `accounts.guarantee` | What holds each end: `floor` (what stops `read` from reaching anyone) and `ceiling`, each `grant` (the platform's credential enforces it) or `code` (only this suite does), and `why` in a sentence | Resend has no read-only key, so its floor is `code` and its `doctor` says so |
| `narrowing` | The flags that narrow its server: `{ option, flag, kind }`, in the order they are written | Exactly one `pin`; `readOnly` is the one `switch`. Gmail's is `inbox` / `--inbox` and the `readOnly` / `--read-only` switch, Slack's `workspace` / `--workspace`, as their entries were written before the manifest; every other channel's is `account` / `--account` and nothing else |
| `rivals` | Other servers for the same service, which a registration warns about: `packages` (by name; `unscoped` also matches the bare name), or `word` with `can` (what such a server can do unapproved) | Optional; `word` and `can` come together |
| `hosts` | The hosts its code talks to | Declared, not yet enforced (§9). `[]` for a channel that talks to none — WhatsApp reads a file on the Mac — which must still say so |
| `approve` | The command that approves under `confirm`: `agent-gmail approve` | The channel's own binary |
| `skills` | `prefix` (`gmail-`) and `contract` (`skills/_shared/contract-gmail.md`) | The contract is chosen by the prefix |

The core's own manifest has a channel word, label, binary, server, approve command and skills, and no accounts,
narrowing, rivals or hosts: it reaches no account. Every other channel must say all of them.

Across the set (`parseChannelEntries`): the core exactly once, and no two channels sharing a word, a binary, a server
name, a package or a skill prefix — any of which would make a registration, a tool or a skill mean two things.

Gmail's, as shipped:

```jsonc
"agentcomms": {
  "contract": 1,
  "channel": "gmail",
  "label": "Gmail",
  "binary": "agent-gmail",
  "server": {
    "defaultName": "gmail",
    "npxPackage": "@agentcomms/gmail-mcp",
    "entryFiles": [["node_modules", "@agentcomms", "gmail-mcp", "dist", "server.mjs"]],
    "bins": ["agent-gmail-mcp"]
  },
  "accounts": { "map": "inboxes", "noun": "mailbox", "modes": ["read", "send"], "guarantee": { "ceiling": "grant", "floor": "grant", "why": "…" } },
  "narrowing": [
    { "option": "inbox", "flag": "--inbox", "kind": "pin" },
    { "option": "readOnly", "flag": "--read-only", "kind": "switch" }
  ],
  "rivals": { "packages": [{ "name": "@artymclabin/gmail-mcp" }, { "name": "@gongrzhe/server-gmail-autoauth-mcp", "unscoped": true }, { "name": "@shinzolabs/gmail-mcp" }] },
  "hosts": ["accounts.google.com", "oauth2.googleapis.com", "gmail.googleapis.com", "people.googleapis.com"],
  "approve": "agent-gmail approve",
  "skills": { "prefix": "gmail-", "contract": "skills/_shared/contract-gmail.md" }
}
```

A channel after Gmail and Slack is pinned by the generic flag:

```jsonc
"narrowing": [{ "option": "account", "flag": "--account", "kind": "pin" }],
"rivals": { "word": "resend", "can": "send mail through Resend" }
```

## 3. The core's snapshot, and what is derived from it

The core cannot read a channel's `package.json` when it runs — the Gmail package is not installed beside the core
server that registers it — so the manifests are built in. `scripts/sync-channels.mjs` validates every manifest against
the schema and writes `packages/core/src/channels.generated.ts`: `CHANNEL_SNAPSHOT` and the `BuiltInChannel` union.
`pnpm sync:channels` writes it; `pnpm verify:channels`, in `pnpm verify`, fails when it is out of date — the same
arrangement as the reference pages.

Derived from it, where these used to be written by hand:

- `CHANNELS`, `CHANNEL_SERVERS` and `CHANNEL_LABELS` (`channel-servers.ts`). Each server's `serverArgs` and
  `narrowingOf` are read off `narrowing`, and `warnAbout` off `rivals` (`other-servers.ts`'s detectors are generic
  over package names and a word). `test/channel-manifest.test.ts` holds all of it to the 0.6.0 table, kept verbatim
  as a fixture: every flag combination, the read-back and its round trip, every warning over the suites' fixtures and
  near misses, and which entries count as ours.
- `Channel` is a string. `isChannel`, `channelServer`, `channelLabel` and `requireChannelManifest` refuse any word the
  snapshot does not have. The core server's `channel` enum is built from the snapshot when it starts.
- Which account modes the classifier can judge, per platform (§5).
- Every sentence the core builds about a channel (§7).

## 4. The registry the tooling reads

`scripts/channels.mjs` reads every `packages/*/package.json` that has the field, with no dependencies — the release job
runs it in a job that installs nothing — and derives one registry:

| View | What reads it |
|---|---|
| `channels` | everything below |
| `packages` — every channel and every server-only package it names, in an order computed from their dependencies | `scripts/packages.mjs`, and through it the release workflow, `release.mjs`, `release-ci.mjs`, `sync-versions.mjs`, `verify-package.mjs`, `third-party-licenses.mjs` |
| `wrappers` — server-only packages and the channel each wraps | `registries.mjs` `WRAPPERS` |
| `surfaces` — each CLI and how its commands are read | `registries.mjs` `SURFACES`, `sync-reference.mjs`, `test/skill-commands.test.mjs` |
| `drivers` — each CLI's entry and each server's factory | `operations.mjs` `DRIVERS` (the parity drive) |
| `reference` — each channel's generated pages | `sync-reference.mjs` |
| `products` — tool prefix, binary, server, reference | `test/tool-drift.test.mjs` |
| `skillFamilies` — prefix, contract, README, and the words of every *other* channel its skills must not use | `sync-skills.mjs`, `test/skill-contracts.test.mjs`, `test/skill-commands.test.mjs`, the skills index |
| `platforms` — the words accounts are named with | `verify-skills.mjs`, the parity drive's placeholder names |

`test/channel-registry.test.mjs` drops a channel package nobody has told any of them about into a copy of the
repository and shows every one finds it, and checks as text that each reads its view and keeps no list of its own.

The registry assumes the layout the existing channels have, so a new one follows it: the package at `packages/<channel>`
named `@agentcomms/<channel>`; its CLI's entry at `src/cli.ts` and its Commander program at `src/cli/program.ts`
exporting `run(argv, deps)`; its server at `src/mcp/server.ts` exporting `create<Label>McpServer`; its README at
`packages/<channel>/README.md`; its reference at `docs/reference/<channel>-cli.md` and `<channel>-mcp-tools.md`
(Gmail's keep the names they were linked by).

## 5. Accounts

Gmail keeps its `inboxes` map. Every channel after it puts its accounts in `accounts`, as one generic record: `id`,
`platform` (the channel word), `workspace` (the container — a Slack team, a Resend team, a WhatsApp store),
`workspaceName?`, `userId` (who it acts as, which may be a key's or a team's label), `tier`, `mode`, `grantedScopes`,
`secretRef`, `sendPolicy?`, `changePolicy?`, `createdAt`. A channel may keep keys of its own beside these — Slack's
`appId` and `redirectPort` — and every write keeps them. It may not add a safety setting: only `sendPolicy`,
`changePolicy` and `mode` are judged by `classifyChange`, so a key of its own that loosened something would loosen it
with nobody asked. `effectiveAccountSendPolicy` in the core is the send policy of one of these accounts; Slack's gate
uses it.

**The mode vocabulary is closed.** `mode` is `read` or `send`, narrow to wide (`ACCOUNT_MODES`). The classifier used to
flag exactly one move, `read` → `send`, so a channel that stored `post` or `full`, or an account on a platform nothing
here describes, widened with nobody's consent. Now a word it does not know — or any mode on a platform with no manifest
saying its accounts live in `accounts` — is judged as the widest thing it could mean on the side it arrives on and as
the narrowest on the side it leaves: it can cost a person a question, never skip one. Its preview says the release
cannot tell what that mode allows. The schema still reads any word, so one account with a strange mode cannot make the
whole file unreadable; Slack refuses to act on one (`parseMode`), and a new channel must too.

**Secrets** are stored only through the core's secret store, with references prefixed by the platform:
`resend:key:<accountId>`.

**`secretRef` stays required.** The contract made it optional, for a channel that holds no credential. Every earlier
release requires it, and they share this file with this one — an MCP server started last week reads what a CLI
installed today writes — so an account without one would make the whole configuration unreadable to them. A channel
with no credential records a reference that names no secret, `<platform>:none:<accountId>`, until a config version can
say otherwise. `secrets migrate` moves nothing for it (there is nothing stored under it), and it counts as a stored
secret when a secret store is first chosen — which errs towards asking.

## 6. Pinning a server to one account

Every channel's server can be narrowed to one account, and `--force` never widens it (the keep-the-pin rule). The
generic pin is `account`, the account's name `organisation/<channel>`; a new channel's server takes `--account`. Gmail's
`inbox` and Slack's `workspace` stay as the names of their pins, so their entries, tools and skills are unchanged, and
`account` is accepted for them as an alias: `comms_server_install` with `account: "acme/slack"` registers exactly what
`workspace: "acme/slack"` does, writes Slack's own `--workspace`, and an approval prepared one way is claimed the other.

Refused: `account` on the core, which reaches no account; `account` and a channel's own pin naming different accounts;
a channel's own option on another channel's server (`inbox` on Slack); and a pin naming an account that is not there,
or is another platform's.

## 7. Wording

What the core says about a channel — who to register, what the server reaches, which command approves, what to run to
connect a mailbox — is built from the manifest's `label`, `accounts.noun`, `narrowing` and `approve`
(`channel-words.ts`). Previews and effects are inside approval digests: an approval is bound to exactly those words, so
one changed character is a different change. Every Gmail and Slack sentence is therefore held byte for byte to 0.6.0 by
`test/wording-identity.test.ts`, 141 sentences captured from the released code before any of this changed. A new
channel gets the same sentences in its own words: "registers the Resend MCP server with cursor as "resend", pinned to
the account acme/resend".

## 8. Trust

**Only first-party channels, and this is why.** A channel is a separate process, and the core never imports one; but
every safety check — the approval store, the consent `ConfigStore.update` demands, each send guard — is library code
running *inside* that process, and the process can skip it or write the configuration directly. And every channel
shares one secret namespace: keychain service `agent-communications`, account `<hash of the config directory>:<ref>`,
with predictable references and the ids in `config.json`, all read by the same `node` binary. **Any channel process can
read any secret in that namespace** — a Resend process could read every Gmail refresh token and every Slack token.
Package install scripts also run when a managed runtime is installed.

So a channel is trusted exactly as far as its code is reviewed, and in 0.7.0 that means one written in this repository,
reviewed here and released with the core. A later registry of third-party channels would pin an exact version, an
integrity hash and a provenance repository per entry, refuse anything unlisted, install with `--ignore-scripts`, and say
plainly that a channel runs with every channel's credentials. Isolating credentials for real — a broker in the core that
holds the tokens and makes the requests — is a larger change and is not planned.

## 9. Adding a channel

A new channel is its package, plus the rows and skills that describe it. Nothing in the core or the tooling is edited.

1. **The package**, `packages/<channel>`: `@agentcomms/<channel>`, the same version as the rest, `@agentcomms/core` as a
   runtime dependency, in `dependencies`, as `workspace:*` — which packs to the exact version, so a published channel
   installs the core of its own release — and in no other dependency field, and the `"agentcomms"` field (§2) with
   `channel` equal to the directory name. The bundle still inlines core, as Gmail's and Slack's do; the installed
   package is how the channel finds core's own command. *(Amended 2026-10-05 by the
   [CLI path design](2026-10-04-cli-path-shims-design.md), D4: this was a `workspace:*` development dependency, and
   `test/channel-registry.test.mjs` now refuses a channel that declares core any other way.)* Its CLI at `src/cli.ts` / `src/cli/program.ts` (`run`), its server at
   `src/mcp/server.ts` (`create<Label>McpServer`), a README, the layout in §4, and `test/consumer-check.mjs` — the
   check `pnpm verify:packages` runs inside a throwaway project that installed the packed tarball, and the only test
   of what is actually published.
2. **Its accounts** in `accounts`, `platform` its word, `mode` `read` or `send` and nothing else, secrets through the
   core's store with `<channel>:` references. Its `mcp install` passes `account` to the core's `serverInstallChange`.
3. `pnpm sync:channels` — the core's snapshot now has it, and `CHANNELS`, the core server's `channel` enum, the
   installer, the update and every sentence know it.
4. **Its rows** in `capabilities.json`, one per command and tool (see "Adding a capability" in `CONTRIBUTING.md`).
5. **Its skills**: `skills/<prefix>*/` and `skills/_shared/contract-<family>.md`; then `pnpm sync:skills`.
6. `pnpm sync:reference` (its reference pages), `pnpm build && pnpm licenses` (its `THIRD_PARTY_LICENSES`, read from
   the bundler's module graph, so it lists what the bundle contains — core and what core inlines included), and
   `pnpm verify`.
7. **Its first publish, by hand.** npm keeps trusted publishers per package and cannot hold one for a package that
   does not exist, so no workflow can send a new package's first version. The release's OIDC preflight finds such a
   package by the registry's 404, publishes nothing, and prints the command to run from the tagged commit —
   `pnpm --config.pnpmfile=scripts/record-git-head.cjs --filter @agentcomms/<channel> publish --access public
   --no-git-checks --tag latest`, which records the commit as the version's `gitHead`. The owner runs it, adds the
   package's trusted publisher, and re-runs the job, which skips that version as already out from its commit
   (`docs/RELEASING.md`, "A new package's first version").

The release publishes it, the version sync bumps it, the parity check drives it, the tool-drift and skill tests check
its names, and every other channel's skills are checked for its words — all from the manifest.

## 10. Not in this release

- **A guarded transport in the core** — Slack's origin check, closed method table and one-shot permit, generalised — so
  a channel's send path is the core's rather than its own. `hosts` is declared for it and not enforced yet.
- **A conformance kit** that runs every channel, Gmail and Slack first, against a fake platform: no write without a
  claimed approval, untrusted content always wrapped, no secret in any output.
- **One plugin per platform** in `.claude-plugin/marketplace.json`, Gemini entries from the registry, and a per-plugin
  budget for skill descriptions.

## 11. Where this differs from the contract as first written

- `secretRef` is required, not optional (§5), for the file's readers from earlier releases.
- `rivals` has `can`, the words for what a server matched by `word` can do unapproved ("post to Slack"), and a rival
  package can be `unscoped`: both are what the existing warnings say, which a derivation has to reproduce exactly.
- A channel's word is its directory's name and its package is `@agentcomms/<word>`, so the registry and the manifests
  cannot disagree about which is which.
- `hosts` may be empty (added with WhatsApp, the first channel with no network client). It stays required of every
  channel, so "reaches no host" is said rather than left out; a list with a host in it would have been a promise the
  code does not make.
- A send approval's hints name only the approve commands of channels whose accounts can `send`
  (`channelApproveCommands({ sending: true })`). WhatsApp's `approve` approves the changes its `mcp install` and
  `mcp prune` make, never a send, so naming it beside a send approval would send a person to the wrong command.
- The command that connects a mailbox, which one hint names, is derived (`<binary> inbox add`) rather than declared:
  only Gmail's accounts are mailboxes, and a manifest field for one sentence was not worth a contract change.
