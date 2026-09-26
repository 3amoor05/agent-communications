# Contributing

Thanks for helping make email safe to hand to an agent.

## Ground rules

- **Never commit real mail.** No real addresses, message bodies, subjects, attachment names, tokens, client secrets
  or `client_secret_*.json` files — not in code, fixtures, docs, issues or screenshots. Fixtures are synthetic and use
  `example.com`, `example.org` or `*.test` addresses. `scripts/verify-skills.mjs` scans the whole tree for likely
  secrets and machine-specific paths, and `pnpm verify` fails on either.
- **Sending is gated in one place.** Only `send.execute` in `packages/gmail` may call Gmail's `drafts.send` or
  `messages.send`, and only `executeSend` in `packages/resend` may call Resend's send endpoint; a test enforces
  each. A change that adds another path, or weakens the approval checks, needs a
  design discussion in an issue first.
- **Email content is untrusted.** Anything a sender controls reaches the model only inside the untrusted-content
  envelope, after the HTML sanitiser. Keep it that way.

## Layout

```text
packages/core         @agentcomms/core         provider-neutral core (config, secrets, approvals, envelopes), the
                                               agentcomms CLI and the core MCP server
packages/gmail        @agentcomms/gmail        Gmail channel: CLI (agent-gmail) and MCP server factory
packages/gmail-mcp    @agentcomms/gmail-mcp    the Gmail MCP server as its own package (agent-gmail-mcp)
packages/slack        @agentcomms/slack        Slack channel: CLI (agent-slack) and MCP server
packages/resend       @agentcomms/resend       Resend channel: CLI (agent-resend) and MCP server
skills/<name>/        Agent Skills (SKILL.md + references/)
docs/                 user and design documentation
scripts/              repository checks
```

The design lives in `docs/superpowers/specs/`, and the implementation plan in `docs/superpowers/plans/`.

## Local setup

Use Node.js 22.18 or newer and pnpm 11 (`npm install -g pnpm@11`, or `corepack enable` on Node 22/24). The build tool
needs 22.18; the published packages themselves run on Node 22.12 or newer.

```bash
pnpm install
pnpm verify
```

`pnpm verify` runs Biome, the type checks, every test suite, the builds and the skill verifier. It must pass before you
push: nothing runs it for you on GitHub, because this repository has no CI for pushes or pull requests. `pnpm install`
sets up a pre-push hook (`.githooks/pre-push`) that runs it. The one workflow is the release: a `v*` tag runs
`pnpm verify` on Linux, macOS and Windows and publishes only if all pass, so a failure only Windows shows turns up
there — see [Releasing](docs/RELEASING.md).

## Skill contract

A skill lives at exactly `skills/<name>/SKILL.md` (no root `SKILL.md`). The directory name equals the frontmatter
`name`: lowercase letters, digits and single hyphens. Frontmatter carries `name`, a quoted `description`,
`license: MIT`, `compatibility`, `metadata` **as a map** (Codex refuses the single-string form) and `allowed-tools`.
Every skill carries `references/fit.json` and follows the section structure described in the design. Keep links
relative and inside the skill directory; the README must list each skill's exact description.

## Adding a capability

Everything the packages do can be done from a terminal and from a chat
([design](docs/superpowers/specs/2026-09-25-cli-mcp-parity-design.md)). A new capability is four things, in one pull
request:

1. **One operation** in `packages/<package>/src/operations/` that does the work: an exported function both surfaces
   call. Neither re-implements it.
2. **The command**, in the package's CLI (`src/cli/program.ts`; for the core, the usage table in `src/cli.ts`).
3. **The tool**, in the package's MCP server (`src/mcp/server.ts`).
4. **The row**, in `capabilities.json` at the root. `cli` is the command path without the binary, `mcp` the tool, and
   `operation` the function from step 1:

   ```json
   { "id": "gmail.label.create", "package": "gmail", "cli": "label", "mcp": "gmail_label_create", "status": "both", "operation": "createLabel" }
   ```

Then `pnpm sync:reference` and `pnpm test`. `test/parity.test.mjs` reads every command from the CLI's own help and
every tool from a running server, and fails — naming what is missing — when either is in no row, when a row names
something that does not exist, or when a row's status and its sides disagree.

It also runs both sides of every `both` row to their end, and fails unless each reaches the row's `operation` before
any operation another row names, reaches nothing after it that the row does not name, and passes it the arguments the
row's `expect` gives. Nothing real happens: in a process of its own
(`scripts/operations.mjs`), with a temporary home, the file secret store and no network, keychain, child processes or
worker threads, every function a command or a server imports from an `operations/` module is a stand-in that records
the call and what it was given, and does nothing. So a row whose command and tool run
different operations fails, and so does a row that names a helper everything calls; the message says what each side
reached instead. A command and a tool that share a step on their way and part after it fail too, each naming what it
went on to: naming the shared step as the row's operation hides nothing. A row may add:

- a list for `operation`, when the command is several operations; each side has to reach all of them. A name is
  looked up in the row's own package, then in the core's — a channel's `mcp install` runs the core's
  `serverInstallChange`.
- `argv` and `args` — words added to the command, arguments given to the tool — when the smallest call does not reach
  the operation. The check already supplies whatever Commander or the tool's schema requires; `argv` is for the rest,
  such as `["--finish", "parity"]` for the half of `inbox add` that finishes a sign-in, or
  `["--client", "claude-code"]` for `mcp install`.
- `via`, naming another row's operation that a side passes through on its way, when the command really does that:
  `setup` reads the state (`setupState`) before it starts a sign-in.
- `after`, naming each operation a side goes on to after the row's own, with why — `{ "showWorkspace": "reads back
  what it changed, to say so" }` — when the command really does that. The check fails an `after` that neither side
  reaches after the operation.
- `expect`, when another row runs the same operation through another command and another tool: the four Slack mode
  rows all run `planModeSet`, and reaching it cannot tell them apart. `expect` says what the operation receives from
  both sides, by the name of its parameter or a path into one — `{ "wanted": "read" }`,
  `{ "request.channel": "gmail" }` — with `null` for an argument not given. The check records what each side passed
  and fails a side that passed anything else. It also fails two such rows unless their `expect` gives some argument a
  different value in each, so a tool moved from one row to the other brings its own value along and is caught. Rows
  that share a whole side need none: `gmail_inbox_finish` is behind both `inbox add --finish` and
  `inbox reauth --finish`, and exchanging their commands pairs nothing new. Leave `expect` out and the check says which
  arguments both of the row's sides pass that the other rows' do not.
- `unchecked` instead of `operation`, saying why, when the check cannot reach the operation cheaply or the two sides
  are knowingly not one operation yet. `pnpm verify:parity` lists every such row on every run; each is a debt, not a
  pass.

Leave `operation` out while writing a new row, and the check tells you which operations its two sides both reach.

When one side is missing, the row says why:

- `"status": "pending", "phase": "P4"` — the other side is still to be written. `pnpm verify` runs
  `pnpm verify:parity --strict`, which refuses any pending row, so a capability lands with both sides or with a
  stated exception — never half of one.
- `"status": "exception", "reason": "…"` — one side on purpose: `approve`, because under `confirm` approving is a
  person at a terminal; `mcp`, because it starts the server a tool would need already running. The reason is what a
  reviewer reads, so it says why rather than what.

A command that only groups others (`agent-gmail inbox`) has no row; one that groups and also acts (`agent-gmail mcp`)
does, and the test tells them apart from the CLI itself. One command can be several rows when its arguments choose
between operations (`agent-gmail inbox add` starts a sign-in, and with `--finish` completes one), and one tool can
back several commands (`comms_server_install` is `mcp install` in every package); `reason` on such a row says how the
two meet.

## Adding a channel

A channel is a package that says what it is; nothing in the core or the tooling is edited to add one
([design](docs/superpowers/specs/2026-09-26-channel-plugins-design.md)). Channels are first-party only: they live in
this repository and are released with the core, because a channel's process can read every channel's credentials in
the shared keychain namespace, so it is trusted exactly as far as it is reviewed here.

1. **The package**, `packages/<channel>`, named `@agentcomms/<channel>` and at the same version as the rest, with
   `@agentcomms/core` as a `workspace:*` dev dependency. Its CLI at `src/cli.ts` with a Commander program at
   `src/cli/program.ts` exporting `run`, its MCP server at `src/mcp/server.ts` exporting `create<Label>McpServer`, a
   README, and `THIRD_PARTY_LICENSES` in its `"files"`. And **`test/consumer-check.mjs`**: `pnpm verify:packages`
   packs the package, installs the tarball into a throwaway project and runs that file there, so it is the only test
   of what is actually published — the bin starting, the exports resolving, nothing missing from `"files"`. A package
   without one fails the verify.
2. **Its manifest**, the `"agentcomms"` field of that `package.json`: `contract: 1`, `channel` (the directory's name;
   also the platform word in account names and the tool prefix), `label`, `binary` (`agent-<something>`), `server`,
   `accounts` (`map: "accounts"`, `noun`, `modes` from `read` and `send`, and an honest `guarantee`), `narrowing`
   (exactly `[{ "option": "account", "flag": "--account", "kind": "pin" }]`), `rivals`, `hosts` (`[]` when it talks to
   no host), `approve` and `skills`. The schema is `channelManifestSchema` in `packages/core/src/channel-manifest.ts`,
   and it refuses Gmail's `inboxes`, `--inbox` and `--read-only`, and Slack's `--workspace`, to any other channel.
3. `pnpm sync:channels`, which validates every manifest and writes the core's snapshot of them. From it the core knows
   the channel: the installer, `comms_server_install`'s `channel`, the update, and the words of every preview.
4. **Its accounts** in the config's `accounts` map: `platform` is the channel word, `mode` is `read` or `send` and
   nothing else, and credentials go through the core's secret store under `<channel>:` references. It adds no safety
   setting of its own: only `sendPolicy`, `changePolicy` and `mode` are judged when a change loosens something.
5. **Its capabilities**, a row per command and tool in `capabilities.json` (above), and **its skills**,
   `skills/<prefix>*/` with `skills/_shared/contract-<family>.md`.
6. `pnpm sync:skills`, `pnpm sync:reference`, and `pnpm build && pnpm licenses` — the notices are read from what the
   bundle actually contains, core and everything core inlines included — then `pnpm verify`.
7. **Its first release.** npm cannot hold a trusted publisher for a package that does not exist, so a new channel's
   first version is published by hand, once, from the tagged commit; the release's preflight stops the run with
   nothing sent and prints the exact command. See
   [a new package's first version](docs/RELEASING.md#a-new-packages-first-version).

Everything else reads the channel registry (`scripts/channels.mjs`), so the release, the version sync, the parity
check, the reference pages and the skill and name tests pick the channel up from its manifest.
`test/channel-registry.test.mjs` fails if one of them stops doing so.

## Pull requests

- Keep each pull request focused, and say what changes for the person using it.
- Add tests with the change. The send gate, path jails and untrusted-content handling always need them.
- Update docs and skills when a command, tool or behaviour changes; a test fails when a skill names a tool or command
  that does not exist.
- Follow the [Code of Conduct](CODE_OF_CONDUCT.md). Report vulnerabilities through [SECURITY.md](SECURITY.md), never
  in a public issue.

## Releasing

See [`docs/RELEASING.md`](docs/RELEASING.md) — the order, the one-time npm setup, and what the dry run is for.
