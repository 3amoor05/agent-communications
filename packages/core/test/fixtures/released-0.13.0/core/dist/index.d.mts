import { $ as TaintExclusions, $n as ConfigUpdateResult, $r as updateCheckSetting, $t as CreateApprovalInput, A as agentMarker, An as isInertName, Ar as comparablePath, At as ResolvedPaths, B as requirePerson, Bn as ErrorCode, Br as effectiveChangePolicy, Bt as AuditLog, C as renderChangePreview, Cn as INERT_EXTENSIONS, Cr as StoreKind, Ct as PLAN_TTL_MS, D as PersonGate, Dn as WarnedFile, Dr as changedSettings, Dt as paramsDigest, E as OutputOptions, En as SavedName, Er as canonicalLoosening, Et as idsDigest, F as commandText, Fn as savedName, Fr as connectedAccounts, Ft as resolvePaths, G as writeResult, Gn as ACCOUNT_MODES, Gr as isInsideDirectory, Gt as ApprovalChannel, H as shellCommand, Hn as isCommsError, Hr as emptyConfig, Ht as CondensedIds, I as defaultStreams, In as CommsError, Ir as defaultChangePolicy, It as shortenHome, J as openCore, Jn as AccountMode, Jr as newInboxId, Jt as ApprovalState, K as Core, Kn as ALIAS_PATTERN, Kr as isValidAlias, Kt as ApprovalKind, L as inlineCommand, Ln as CommsErrorOptions, Lr as defaultInternalDomains, Lt as CapStatus, M as canPrompt, Mn as readsOnItsOwn, Mr as configFingerprint, Mt as expandHome, N as colorEnabled, Nn as renameWords, Nr as configV1Schema, Nt as homeDirectory, O as ShellCommand, On as fileRisks, Or as classifyChange, Ot as APP_DIR_NAME, P as commandAsJson, Pn as savedFileName, Pr as configV2Schema, Pt as homeOf, Q as TaintCollector, Qn as ConfigStore, Qr as secretsStoreOf, Qt as ClaimOptions, R as paint, Rn as ERROR_REGISTRY, Rr as duplicateInbox, Rt as Caps, S as recordChangeApprovalRefused, Sn as DOWNLOAD_SUFFIX, Sr as SettingValue, St as probeKeychain, T as ChallengeOptions, Tn as SAVED_NAME_BYTES, Tr as aliasConflicts, Tt as PlanStore, U as withWords, Un as toCommsError, Ur as findConnectedAccount, Ut as recipientDomains, V as runCommand, Vn as ErrorSpec, Vr as effectiveSendPolicy, Vt as AuditRecord, W as writeError, Wn as ACCOUNT_ID_PATTERN, Wr as findInboxById, Wt as APPROVAL_TTL_MS, X as TAINT_WINDOW_MS, Xn as ClientConfig, Xr as sameLoosening, Xt as ChangeBinding, Y as PUBLIC_MAILBOX_DOMAINS, Yn as ChangePolicy, Yr as parseConfig, Yt as ApprovalStore, Z as TaintCheck, Zn as Config, Zr as secretsStoreFor, Zt as ChangeTarget, _ as changeApprovalCommand, _n as downloadDigest, _r as READABLE_CONFIG_VERSIONS, _t as SecretStore, a as changeToolResult, an as DownloadRequest, ar as FormerNames, at as canonicalAddress, b as governingChangePolicy, bn as sameExpectation, br as SendPolicy, bt as loadKeyringModule, c as refuseUnclaimedApproval, cn as LiveChange, cr as Loosening, ct as extractAddresses, d as ChangeRequest, dn as RecordedSaveAnswer, dr as OrganisationRecord, dt as FileSecretStore, ei as ConfigVersion, en as CreateChangeApprovalInput, er as ConfigV1, et as TaintHandle, f as ChangeSpec, fn as SENDING_STALE_MS, fr as OrganisationServes, ft as KEYCHAIN_SERVICE, g as beginChangeApproval, gn as downloadClaimRefusal, gr as PendingRevocationTokenState, gt as ProbeResult, h as approveCommandOf, hn as changeDrift, hr as PendingRevocationStatus, ht as KeyringModule, i as approveChangeAtTerminal, in as DownloadBinding, ir as FormerName, it as TaintStore, j as askChallenge, jn as isPlainFileName, jr as configCommittedBeforeAbort, jt as accountHome, k as Streams, kn as fileWarnings, kr as committedSecretsStore, kt as PathEnvironment, l as ChangeApprovalPrompt, ln as LiveDraft, lr as LooseningConsent, lt as InboxRuntimeState, m as PreparedChange, mn as changeDigest, mr as PendingRevocation, mt as KeychainSecretStore, n as GatedOutcome, nn as DOWNLOAD_ANSWER_HINT, nr as ConnectedAccount, nt as TaintObservation, o as gatedChange, on as Expectation, or as INBOX_ID_PATTERN, ot as canonicalHandle, p as ChangeSurface, pn as approvalKind, pr as OrganisationSlackApp, pt as KEYCHAIN_TIMEOUT_MS, q as OpenCoreOptions, qn as AccountConfig, qr as newAccountId, qt as ApprovalRecord, r as approvalHint, rn as DOWNLOAD_QUESTION_TTL_MS, rr as Defaults, rt as TaintSource, s as gatedChangeAtTerminal, sn as ListedFile, sr as InboxConfig, st as domainOf, t as GatedChange, ti as NEW_CONFIG_VERSION, tn as DIGEST_VERSION, tr as ConfigV2, tt as TaintHandleObservation, u as ChangeOptions, un as MAX_CHALLENGE_ATTEMPTS, ur as OrganisationGeneration, ut as InboxStateStore, v as claimChange, vn as downloadDrift, vr as RESERVED_ALIASES, vt as SecretStoreKind, w as revokeChange, wn as RenameReason, wr as UpdateCheckSetting, wt as PlanRecord, x as prepareChange, xn as stricterPolicy, xr as SettingChange, xt as openSecretStore, y as finishChangeApproval, yn as publicView, yr as RenamedAccount, yt as keychainNamespace, z as refuseUnlessPerson, zn as EXIT_CODES, zr as effectiveAccountSendPolicy, zt as SendLedger } from "./change-flow-DxZfblwU.mjs";
import { FileHandle } from "node:fs/promises";
import { z } from "zod";
//#region src/addresses.d.ts
/**
 * Decodes RFC 2047 encoded-words (`=?UTF-8?Q?Caf=C3=A9?=`) in a header value.
 *
 * Gmail's REST API returns header values exactly as they appear in the MIME source, still encoded — and this package
 * encodes them itself on the way out, because any em dash, curly quote or accent forces it. Nothing decoded them
 * back, so the send-approval preview showed the approver `=?UTF-8?Q?Caf=C3=A9_plan?=` while the recipient's mail
 * client showed `Café plan`. A human cannot approve a message they cannot read, so that broke the send gate for
 * entirely ordinary text rather than for some crafted edge case.
 *
 * **Decode before neutralising, never after.** `=?utf-8?B?PC91bnRydXN0ZWQtZW1haWwtY29udGVudD4=?=` decodes to a
 * literal closing envelope tag; a `neutralise()` run on the encoded form sees nothing to defuse and the decode that
 * happens later hands the tag straight to whatever reads it. Every inbound caller pairs the two in that order.
 *
 * A malformed encoded-word is returned unchanged rather than thrown on: a header that cannot be decoded is still a
 * header, and refusing to show it would hide mail rather than protect anyone.
 */
export declare function decodeHeaderWords(value: string): string;
export interface ParsedAddress {
  name: string;
  address: string;
}
/**
 * Parses an address-list header (To, Cc, From, Reply-To…) into flat `{name, address}` pairs: groups are expanded,
 * entries without an address are dropped, addresses are canonicalised (lower-cased, IDN domains in punycode) and
 * de-duplicated in their original order.
 */
export declare function parseAddressList(header: string | undefined | null): ParsedAddress[];
//#endregion
//#region src/channel-manifest.d.ts
/**
 * What a channel says about itself: the `"agentcomms"` field of its `package.json`.
 *
 * Pure data, so it can be read without running any of the channel's code — by this repository's tooling, by the build
 * that snapshots it into core (`channels.generated.ts`), and later by anything that has to decide about a package
 * before installing it. Everything core used to know about Gmail and Slack by name — the package to install, the
 * flags that pin a server to one account, which other servers to warn about, what a person approves with — is here,
 * and core derives its behaviour from it rather than from a table written beside the code.
 *
 * First-party only (design 2026-09-26). A channel in this repository ships in lockstep with core, and the manifest is
 * the shape a reviewed registry would read later; nothing here loads a channel from anywhere else.
 */
/** The version of this contract a manifest is written against. A manifest names it so a later one can differ. */
export declare const CHANNEL_CONTRACT = 1;
/** What keeps a mode within bounds: the grant the platform issued, or only this suite's code. */
export type GuaranteeSource = "grant" | "code";
/** How a server is narrowed: a `pin` to one account, which takes its name, or a `switch`, which takes nothing. */
export interface ChannelNarrowing {
  /** The install option it sets. `account` is the generic pin; `inbox` and `workspace` are Gmail's and Slack's. */
  readonly option: NarrowingOption;
  /** The flag it is on the server's command line, and on `mcp install`: `--inbox`, `--read-only`. */
  readonly flag: string;
  readonly kind: "pin" | "switch";
}
export type NarrowingOption = "account" | "inbox" | "workspace" | "readOnly";
/** A published package that serves the same platform with no approval step. */
export interface ChannelRivalPackage {
  /** `@shinzolabs/gmail-mcp`. Matched anywhere on a registered server's command line. */
  readonly name: string;
  /** Also match the name without its scope, as its own word: `npx server-gmail-autoauth-mcp`. */
  readonly unscoped?: boolean | undefined;
}
export interface ChannelManifest {
  readonly contract: typeof CHANNEL_CONTRACT;
  /**
   * The platform word: the second half of every account's name (`cue/<channel>`), the prefix of the server's tools
   * (`<channel>_…`) and of its secret references. `core` is the core package's own, and no channel's.
   */
  readonly channel: string;
  /** How a person is shown it: `Gmail`, `Slack`. */
  readonly label: string;
  /** The command a person types. */
  readonly binary: string;
  readonly server: {
    /** The name a client shows for it when none is given. */
    readonly defaultName: string;
    /** What `npx` runs: the package itself, or a thin `-mcp` wrapper that is nothing but the server. */
    readonly npxPackage: string;
    /** What `npx` runs that package with, before the server's own flags: `["mcp"]` for a whole CLI. */
    readonly npxArgs?: readonly string[] | undefined;
    /** Trailing path segments, beyond `dist/cli.mjs`, that also start this server. */
    readonly entryFiles?: readonly (readonly string[])[] | undefined;
    /** Other published commands that start this server. */
    readonly bins?: readonly string[] | undefined;
  };
  /** The accounts it connects. Absent only for core, which connects none. */
  readonly accounts?: {
    /** The config map they live in. Gmail's are `inboxes`; every channel after it uses `accounts`. */
    readonly map: "inboxes" | "accounts";
    /** What one is called in a sentence: `mailbox`, `workspace`, `account`. */
    readonly noun: string;
    /** The modes it offers, narrow to wide, from the closed vocabulary `read`, `send`. */
    readonly modes: readonly AccountMode[];
    /**
     * What holds each end, honestly: `floor` is what stops the narrowest mode from reaching anyone, `ceiling`
     * what bounds the widest. `grant` when the platform's own credential enforces it; `code` when only this
     * suite does — Resend has no read-only key, so its `read` is code.
     */
    readonly guarantee: {
      readonly ceiling: GuaranteeSource;
      readonly floor: GuaranteeSource;
      readonly why: string;
    };
  } | undefined;
  /** The flags that narrow its server, in the order they are written. */
  readonly narrowing?: readonly ChannelNarrowing[] | undefined;
  /**
   * Other servers for the same service, which a registration warns about: by package name, or — where there are too
   * many to list — by the platform's word anywhere in an entry, with what such a server `can` do unapproved.
   */
  readonly rivals?: {
    readonly word?: string | undefined;
    readonly can?: string | undefined;
    readonly packages?: readonly ChannelRivalPackage[] | undefined;
  } | undefined;
  /**
   * The hosts its code talks to. Declared, not yet enforced.
   *
   * Every channel says it, and `[]` is an answer: a channel that reaches no host at all — WhatsApp, which reads a file
   * on this Mac — says so rather than naming one it never talks to. What a list names is a promise a later transport
   * can hold it to; an empty list is the strictest such promise.
   */
  readonly hosts?: readonly string[] | undefined;
  /** The command a person runs at a terminal to approve under `confirm`: `agent-gmail approve`. */
  readonly approve?: string | undefined;
  /** Its skills: their name prefix, and the contract every one of them carries. */
  readonly skills?: {
    readonly prefix: string;
    readonly contract: string;
  } | undefined;
}
/** A manifest, and the package that declares it. */
export interface ChannelEntry {
  readonly packageName: string;
  readonly manifest: ChannelManifest;
}
/** The schema of one manifest. */
export declare const channelManifestSchema: z.ZodType<ChannelManifest, unknown>;
/**
 * Every first-party manifest, checked one by one and against each other.
 *
 * What no single manifest can promise: the core is there exactly once, and no two channels share a word, a binary,
 * a server name, a package or a skill prefix — any of which would make a registration, a tool or a skill mean two
 * things. Throws with every problem named.
 */
export declare function parseChannelEntries(entries: readonly {
  packageName: string;
  manifest: unknown;
}[]): ChannelEntry[];
//#endregion
//#region src/channels.generated.d.ts
/** The channels built into this release, by their word: a channel is a string, and these are the known ones. */
type BuiltInChannel = "core" | "gmail" | "resend" | "slack" | "whatsapp";
//#endregion
//#region src/mcp-clients.d.ts
/**
 * Where the MCP clients on this machine keep their server lists. Read to answer two questions: is our own server
 * registered in a way that will actually start, and **is another server for the same service registered that can
 * act with no approval step?**
 *
 * The second question matters more than it looks. Every promise these packages make about sending or posting
 * assumes they own the only route to it; a second server with an ungated `send_email` or `post_message` tool makes
 * those promises false, and the agent will happily use whichever tool it finds.
 */
export interface ClientConfigFile {
  client: string;
  path: string;
  /**
   * How the client itself reads the file.
   *
   * VS Code's `mcp.json` is JSON with comments and trailing commas, and Gemini CLI strips comments from its
   * settings before parsing them. A file of either with one `// note` in it is a working config to its client,
   * and it read here as nothing registered at all — which `mcp prune` took as licence to delete what it named.
   */
  format: "json" | "jsonc" | "toml";
}
export interface RegisteredServer {
  client: string;
  path: string;
  name: string;
  command: string;
  args: string[];
  /**
   * The address of a remote server, for an entry that has one instead of a command.
   *
   * Read because the official Slack server is exactly such an entry — `https://mcp.slack.com/mcp` — and a scan
   * that looked only at `command` and `args` could not see the one other Slack server most people will have.
   */
  url?: string | undefined;
  /** The entry's own `type` (`stdio`, `http`, `sse`), when it declares one. */
  type?: string | undefined;
  /** The npm package the entry launches, when one can be read from the command line. */
  packageName?: string | undefined;
  /**
   * The entry's own environment, when it declares one.
   *
   * Carried because an entry cannot be put back without it: ours sets `AGENT_COMMS_CONFIG_DIR`, and a server
   * restored without that looks in the wrong directory and reports no mailboxes — a silent wrong answer where the
   * missing entry it replaced was at least an obvious one.
   */
  env?: Record<string, string> | undefined;
  /**
   * `project` for an entry Claude Code keeps under `projects`, `user` otherwise.
   *
   * Every command this package issues targets user scope. Without knowing the difference, a repair aimed at a
   * project-scoped entry removes nothing, adds a second entry at user scope, and reports success — leaving the
   * stale one still in force for that project.
   */
  scope?: "user" | "project" | undefined;
}
/**
 * The config file each supported client keeps its servers in, whether or not it exists.
 *
 * Where the client itself would look, which is not always the default: codex keeps everything under `CODEX_HOME`
 * and Claude Code its `.claude.json` under `CLAUDE_CONFIG_DIR`, when either is set. Reading `~/.codex` regardless
 * found nothing on a machine that had moved it, so an install wrote over somebody's server there and `prune`
 * deleted runtimes it still named.
 */
export declare function knownClientConfigs(env?: NodeJS.ProcessEnv, platform?: NodeJS.Platform): ClientConfigFile[];
/**
 * Another server's address, as far as it is safe to print: scheme and host.
 *
 * For a remote server the URL is often the credential, and it was printed whole in `mcp install`'s warnings, in
 * its refusals and in `doctor`, which agents are told to run with `--json` and so copy into their transcripts.
 * Some vendors put the key in the query; others put it in the path — a per-user id that is the only thing standing
 * between anyone holding the URL and that person's connected accounts. So the path goes as well as the userinfo,
 * the query and the fragment: the entry's name and client, printed beside this, say which server is meant. What
 * cannot be parsed as a URL is not printed at all.
 */
export declare function displayUrl(url: string): string | undefined;
/**
 * JSON with comments and trailing commas, read the way VS Code reads its own settings.
 *
 * Comments become spaces and a comma before a closing bracket is dropped, both only outside strings — a URL in
 * an argument is full of `//`. What is left has to be plain JSON, or it throws like `JSON.parse`.
 */
export declare function parseJsonc(text: string): unknown;
/**
 * What `codex mcp get <name> --json` says is registered, as an entry the rest of this reads.
 *
 * Codex's own answer, because codex is what `codex mcp add` would overwrite: its config can live where no scan
 * looks, and in shapes a scan could misread. The entry is under `transport` in the codex versions this was
 * written against; the top level is read too, so a flatter answer is not mistaken for no command at all. An
 * answer with neither a command nor a URL throws, and the caller treats that as not knowing.
 */
export declare function codexServerFromGet(name: string, stdout: string, path: string): RegisteredServer;
/** A client config that is there and could not be read — so what it registers is not known. */
export interface UnreadableConfig {
  client: string;
  path: string;
  /** Why, in words that never quote the file: a line of somebody's config can hold a token. */
  reason: string;
}
export interface ServerScan {
  servers: RegisteredServer[];
  unreadable: UnreadableConfig[];
}
/**
 * Every MCP server registered with the clients on this machine, and every client config that could not be read.
 *
 * The second list is the point. A file this skipped used to look exactly like a file with nothing in it, and
 * `mcp prune` deletes what nothing registers: a VS Code `mcp.json` with one comment in it was enough to lose a
 * runtime a client still started. A caller that decides something from absence has to be able to tell the two
 * apart. The reasons never quote the file — JSON's own parse errors do, and a line of a config can hold a token.
 *
 * Claude Code's project servers are read too: those it keeps under `projects` in its own file, and the
 * `.mcp.json` at the root of each project it lists there. A project that no longer exists is not a file that
 * cannot be read. What stays out of sight is any other file a client might be pointed at — a workspace
 * `.vscode/mcp.json` or `.cursor/mcp.json`, a config passed on a command line — and an entry pasted from
 * `--client json`, which is why `prune` also keeps what the installer printed.
 *
 * `also` names further configs to read as the client named would: `prune` passes every one the installer recorded
 * writing to, which a shell with another `CLAUDE_CONFIG_DIR` or `CODEX_HOME` would not otherwise find. One for a
 * client this does not know is read as JSON with comments, which reads every JSON config and calls anything else
 * unreadable — a reason for `prune` to stop, rather than a file skipped in silence.
 */
export declare function scanRegisteredServers(env?: NodeJS.ProcessEnv, platform?: NodeJS.Platform, also?: readonly Pick<ClientConfigFile, "client" | "path">[]): Promise<ServerScan>;
/**
 * Every MCP server registered with the clients on this machine. Files that are missing or cannot be read are
 * skipped: for a list of what is there that is the right answer, and for a decision made from what is *not*
 * there it is the wrong one — use `scanRegisteredServers`, which says which files those were.
 */
export declare function listRegisteredServers(env?: NodeJS.ProcessEnv, platform?: NodeJS.Platform): Promise<RegisteredServer[]>;
//#endregion
//#region src/mcp-install.d.ts
/**
 * What is being registered.
 *
 * The client-config machinery below is the same for every product — where each client keeps its servers, how a
 * minimal PATH breaks a bare `node`, which npm binary works on Windows. Only these few facts differ, so they are
 * a parameter rather than a second copy of four hundred lines. `@agentcomms/slack` had no `mcp install` at all
 * for exactly as long as this file lived inside the Gmail package.
 */
export interface McpProduct {
  /** `@agentcomms/gmail`. Installed into the managed runtime, and pinned in the entry. */
  readonly packageName: string;
  /** The binary a person types, for hints: `agent-gmail`. An entry that starts it is this product's. */
  readonly binary: string;
  /**
   * Other published commands that start this server, beside `binary`: Gmail's `agent-gmail-mcp`.
   *
   * A hand-written entry may start the server by any of them — the Slack README says `agent-slack mcp` runs it —
   * and such an entry is ours. Read only from an entry's command, never its arguments: `npx -y agent-slack` would
   * fetch whatever the registry holds under that name.
   */
  readonly bins?: readonly string[] | undefined;
  /** The default name the client shows: `gmail`. */
  readonly defaultServerName: string;
  /** The package `npx` runs, when that launcher is chosen. Often a thin `-mcp` wrapper. */
  readonly npxPackage: string;
  /**
   * What `npx` runs that package with, before the server's own flags.
   *
   * `@agentcomms/gmail-mcp` is nothing but the server, so it takes the flags directly and this is empty.
   * `@agentcomms/slack` is the whole CLI. The shared code used to drop `mcp` for every product, so a Slack entry
   * started `agent-slack --workspace acme` with no command — "unknown option", or the usage text when unpinned —
   * and exited at once, which a client reports only as a server that failed to start.
   */
  readonly npxArgs?: readonly string[] | undefined;
  /**
   * Trailing path segments, beyond the ones every product has, that also start this server.
   *
   * Every product is started by its own `dist/cli.mjs`, from a runtime or a checkout. Gmail also publishes a
   * separate `agent-gmail-mcp` bin, which a hand-written entry may use and which is still ours.
   */
  readonly entryFiles?: readonly (readonly string[])[] | undefined;
  /** The version being installed; the entry pins it exactly. */
  readonly version: string;
  /**
   * `import.meta.url` of a module inside the calling package.
   *
   * Only used by the `local` launcher, and it has to come from the caller: resolving it here would find core.
   */
  readonly moduleUrl: string;
  /**
   * Extra arguments after `mcp`, from the caller's options — `--inbox work`, `--workspace acme/slack`.
   *
   * These are also the `mcp install` command's own flags for the same thing, which is what lets a refusal's hint
   * repeat them: see `installCommand`.
   */
  serverArgs(options: InstallOptions): string[];
  /**
   * The pin and `--read-only` an entry's arguments carry, read back as the options `serverArgs` takes.
   *
   * `--force` builds the replacement from the caller's options alone, so an upgrade that left the pin out turned
   * an entry pinned to one mailbox, and `--read-only`, into one that reached every mailbox with every tool — and
   * said nothing. What the entry being replaced narrowed is read back here and kept: see `keepNarrowing`.
   */
  narrowingOf(args: readonly string[]): Narrowing;
  /**
   * Anything already registered with the client being installed that is worth warning about.
   *
   * Gmail warns about third-party servers whose send tools no approval gates; Slack about other Slack servers,
   * which post with their own token and none of this package's approval steps.
   */
  warnAbout?(servers: readonly RegisteredServer[], platform?: NodeJS.Platform | undefined): string[];
}
export type Launcher = "managed" | "npx" | "local";
export type SupportedClient = "claude-code" | "claude-desktop" | "codex" | "cursor" | "gemini" | "vscode" | "json";
export interface InstallOptions {
  client: SupportedClient;
  name?: string | undefined;
  /** The pin of every channel after Gmail and Slack: `--account <organisation/channel>` (design 2026-09-26). */
  account?: string | undefined;
  /** Gmail's pin. */
  inbox?: string | undefined;
  /** Slack's pin. */
  workspace?: string | undefined;
  readOnly?: boolean | undefined;
  launcher?: Launcher | undefined;
  /** Skip starting the server to prove the entry works (used when a network install is not possible). */
  noVerify?: boolean | undefined;
  /** Write the file or run the client's CLI; false only prints what would be done. */
  apply?: boolean | undefined;
  /**
   * Replace an existing entry of the same name. Needed to upgrade, because the entry pins an exact version.
   *
   * Only ever an entry this product wrote: see `claimName`.
   */
  force?: boolean | undefined;
}
/** What narrows what a server may reach: its pin to one account, and `--read-only`. */
export type Narrowing = Pick<InstallOptions, "account" | "inbox" | "workspace" | "readOnly">;
/** The install options that pin a server to one account: the generic one, and Gmail's and Slack's own names. */
export declare const PIN_OPTIONS: readonly ("account" | "inbox" | "workspace")[];
export interface ServerEntry {
  command: string;
  args: string[];
  env: Record<string, string>;
}
export interface InstallResult {
  client: SupportedClient;
  name: string;
  entry: ServerEntry;
  launcher: Launcher;
  /** The file the entry belongs in, when the client keeps one. */
  configPath?: string | undefined;
  /** What was actually done. */
  applied: boolean;
  /** How it was applied, or why it was only printed. */
  method: "cli" | "file" | "printed";
  /** What to paste, in the client's own format: TOML for codex, `servers` for VS Code, `mcpServers` elsewhere. */
  snippet: string;
  /** Why nothing was written although writing was asked for — the client's CLI is not on PATH. */
  notApplied?: string | undefined;
  /** Where the entry that was replaced was saved first, owner-only. */
  backupPath?: string | undefined;
  verified: boolean;
  /**
   * Whether the entry was started, and how that went: `failed` is a check that ran and did not complete a
   * handshake, `skipped` one that did not run (`--no-verify`, or a `--print` with no runtime to start).
   *
   * `verified: false` meant both, and both were printed as "Not checked" and ended the command with 0. So
   * `--force` could replace a working entry with one that exits at once, say it had not checked, and report
   * success to every script that looks at the exit status.
   */
  verification: "passed" | "failed" | "skipped";
  verifyDetail?: string | undefined;
  /** What the product thought worth saying about other servers this client already has registered. */
  warnings: string[];
}
/** Looks for an executable on PATH, the way a shell would. */
export declare function whichExecutable(name: string, env: NodeJS.ProcessEnv): Promise<string | null>;
/**
 * Where a client's own command is usually installed, looked in after PATH: `~/.local/bin`, where Anthropic's native
 * installer puts `claude`, then `/opt/homebrew/bin` and `/usr/local/bin`, where Homebrew puts `claude` and `codex` on
 * Apple Silicon and on Intel.
 *
 * An install run from inside an MCP server has the PATH written into that server's entry at registration —
 * `node`'s own directory, `/usr/local/bin`, `/usr/bin`, `/bin` — and nothing of the person's shell. `claude` from
 * Homebrew on an Apple Silicon Mac, or from the native installer anywhere, is on none of those, so a registration
 * asked for from chat found no `claude`, registered nothing, and printed the entry instead. That PATH is left as it
 * is: it is in every entry already registered, and changing it would rewrite them all.
 *
 * The home is the environment's own `HOME`, never `os.homedir()`, so a test's temporary home is the only home looked
 * in. `AGENT_COMMS_CLIENT_CLI_DIRS` replaces the two system directories — a list, separated as PATH is, and empty for
 * none — which is how the tests keep every lookup inside their own directories: a `claude` or `codex` really
 * installed on the machine running them would otherwise be found, and run, by a test that meant to have none.
 *
 * Only absolute directories are looked in. A relative one would be read against whatever directory the server was
 * started from, so the command found — and run — would depend on where that was. And none on Windows: a client there
 * is a `.cmd` shim, which this cannot start without a shell, so a fallback could only find something it cannot run.
 */
export declare function clientCliDirectories(env: NodeJS.ProcessEnv): string[];
/**
 * A client's own command — `claude`, `codex` — on PATH, or else where it is usually installed: see
 * `clientCliDirectories`. Every place that looks for a client's command looks through here, so the one that plans a
 * registration and the one that makes it cannot disagree about whether it is there.
 */
export declare function findClientCli(name: string, env: NodeJS.ProcessEnv): Promise<string | null>;
/** Where `findClientCli` looked, as a sentence ends: "on PATH or in ~/.local/bin, /opt/homebrew/bin or /usr/local/bin". */
export declare function clientCliSearch(env: NodeJS.ProcessEnv): string;
/** The interpreter to register: the one on PATH when there is one, otherwise this process's. */
export declare function resolveNode(env: NodeJS.ProcessEnv): Promise<string>;
/** What this needs from whichever package is calling: its environment and where its data lives. */
export interface InstallContext {
  env: NodeJS.ProcessEnv;
  core: {
    paths: {
      dataDir: string;
      configDir: string;
    };
  };
  /** The shell the commands it prints are quoted for: this machine's, unless a test asks for another by name. */
  platform?: NodeJS.Platform | undefined;
}
/**
 * The directory the managed launcher installs one product's exact version into: `<data>/runtime/<version>-<name>`.
 *
 * Exported so that everything which reads these paths back — both doctors, `prune`, the tests — builds them here
 * rather than with its own `join`. The layout changed once already, from `runtime/<version>` when Gmail was the
 * only product, and the Gmail doctor went on parsing the old one: every install made after the change was
 * reported as stale, with a fix that re-created the same path, for ever. A test written with a hand-made `join`
 * of the old layout kept passing throughout.
 */
export declare function managedRuntimeDir(dataDir: string, packageName: string, version: string): string;
/** The CLI inside a managed runtime, which is what a managed entry registers. */
export declare function managedRuntimeEntry(dataDir: string, packageName: string, version: string): string;
/**
 * The version a managed-runtime path pins, in either layout, or null when the path is not one.
 *
 * Both `runtime/0.4.0/…` (every Gmail install before the move) and `runtime/0.4.0-gmail/…` (every install
 * since) are read, and a prerelease keeps its own hyphen: `0.5.0-rc.1-gmail` is `0.5.0-rc.1`. Either separator,
 * and allowed to start the string, so a Windows or a relative path is not missed.
 */
export declare function managedRuntimeVersion(path: string, packageName: string): string | null;
/**
 * The version one argument of a registered entry pins, or null when it pins none.
 *
 * Two launchers pin, and they look nothing alike: `managed` writes a runtime path, `npx` a package spec. Reading
 * only the first reported an `npx`-pinned install as current for ever. `local` pins nothing and is ignored.
 */
export declare function pinnedVersion(argument: string, product: Pick<McpProduct, "packageName" | "npxPackage">): string | null;
/**
 * Whether a registered entry starts this product's server.
 *
 * Decides what `--force` may replace, so it errs towards "not ours". An npm package read off the command line
 * settles it when there is one; otherwise an argument has to *end* in one of the paths this product is started
 * by, compared as whole runs of segments — `@agentcomms/gmail-evil/dist/cli.mjs`, `@agentcomms/gmail/dist/
 * index.mjs` and `packages/gmail/src/nested/cli.ts` are all near misses, and each was once accepted by a looser
 * match somewhere in this repository.
 */
export declare function isProductServer(server: Pick<RegisteredServer, "command" | "args" | "packageName">, product: Pick<McpProduct, "packageName" | "npxPackage" | "entryFiles" | "binary" | "bins">): boolean;
/**
 * The first file a registered entry starts that is no longer there, or null.
 *
 * The interpreter, when the entry names it by path, and the script it runs. A runtime deleted by hand, or a
 * Node removed by a version manager, leaves an entry that looks right and a client that says only "failed".
 */
export declare function missingEntryFile(server: Pick<RegisteredServer, "command" | "args">): Promise<string | null>;
/**
 * The managed runtime for exactly this version, when one is already in place and can be reused.
 *
 * Its own manifest has to pin the exact version, and the package inside has to *be* that version. Finding
 * `cli.mjs` was the whole test before, and a runtime directory made by hand — pinned `^0.4.0`, and so free to hold
 * any 0.4.x — was reused as if this installer had made it: an entry "pinned" to a version it did not contain.
 */
export declare function reusableRuntime(dataDir: string, packageName: string, version: string): Promise<string | null>;
/**
 * Installs one exact version into its own directory, so an upgrade elsewhere cannot change what clients run; a runtime
 * already there for exactly that version is reused. Exported for `agentcomms update`, which installs each runtime a
 * registration will need as a step of its own before it registers anything.
 */
export declare function installManagedRuntime(context: InstallContext, product: McpProduct, version: string): Promise<string>;
/** npm's own JS entry, run through this Node: spawning `npm.cmd` without a shell throws on current Node on Windows. */
export declare function findNpmCli(): Promise<string>;
/**
 * The calling package's own CLI entry: `src/cli.ts` from source, `dist/cli.mjs` when bundled.
 *
 * `moduleUrl` comes from the product, not from this file. While this code lived inside the Gmail package,
 * `import.meta.url` was the Gmail package and resolving from it was right; the moment it moved to core the same
 * line started registering **core's** CLI as the Gmail server — a `local` install that pointed at the wrong
 * program entirely. The product knows where it lives; this does not.
 */
export declare function localCliEntry(moduleUrl: string): Promise<string>;
/**
 * Where the installer records each managed runtime it registered or handed out, and the config it went into.
 *
 * `--client json`, `--print`, and a client whose own CLI was not on PATH all end with an entry a person puts
 * wherever they keep one, and nothing reads that place back. `mcp prune` keeps every runtime handed out that way,
 * so a pasted entry is not left pointing at a directory that has been deleted. It also reads every config
 * recorded here, written or not, beside the ones its own environment names: see `HandedOut.config`.
 */
export declare function handedOutRuntimesPath(dataDir: string): string;
/**
 * Where an install with these options goes: the client's own CLI and the file it keeps its servers in, and whether
 * anything will be written there at all — `--print`, `--client json` and a client whose CLI cannot be found all end
 * with an entry printed rather than registered. The CLI is looked for on PATH and then where it is usually installed:
 * see `findClientCli`.
 *
 * Exported because a registration is a change a person approves, and what they are shown has to be what then
 * happens. The core server plans an install with this before asking, and the install itself decides with it, so the
 * preview cannot say "registers" for an install that only prints, or say nothing for one that writes.
 */
export declare function installTarget(context: InstallContext, options: Pick<InstallOptions, "client" | "apply">): Promise<{
  cliName: "claude" | "codex" | null;
  binary: string | null;
  own: string | undefined;
  configPath: string | undefined;
  writes: boolean;
}>;
/**
 * What a server may be called: 1 to 64 letters, digits, dots, underscores and hyphens.
 *
 * The name goes into the preview a person approves — `registers the Gmail MCP server with cursor as "gmail"` — and
 * into a client's config. Unchecked, it was text the caller chose inside a sentence the person trusts: a name of
 * `gmail", pinned to the mailbox work, read-only, "` made the preview say the server was pinned and read-only while
 * the entry written was neither, and a name of a few hundred characters pushed the rest of the preview past where it
 * is cut off. Every client accepts this much, and it is enough for any name worth choosing.
 */
export declare const SERVER_NAME_PATTERN: RegExp;
export declare const SERVER_NAME_MESSAGE = "a server name is 1 to 64 letters, digits, dots, underscores or hyphens";
/** Refuses a server name outside `SERVER_NAME_PATTERN`, without repeating it: it may be built to mislead. */
export declare function checkServerName(name: string): void;
/** What an install found before it wrote anything: see `preflightInstall`. */
export interface InstallPreflight {
  scan: Awaited<ReturnType<typeof scanRegisteredServers>>;
  target: Awaited<ReturnType<typeof installTarget>>;
  /** This product's own entries under the name, which the install replaces. Empty when it adds. */
  previous: RegisteredServer[];
  /** The options the install goes ahead with: the caller's, plus what the entry it replaces narrowed. */
  effective: InstallOptions;
  /** The server flags kept from that entry, as `serverArgs` writes them. */
  kept: string[];
  /**
   * The node the entry runs under — the one on this environment's PATH, or this process's — whose folder its own PATH
   * starts with. Resolved here, once: the plan names it, and the install writes exactly it.
   */
  node: string;
  /** What the entry starts: that node, or for the npx launcher the npx on this environment's PATH. */
  command: string;
}
/**
 * Everything an install checks before it writes, and what it would then do — writing nothing.
 *
 * An unreadable client config, a name held by somebody else's server, and a name this product already holds without
 * `--force` are each refused here. The install itself runs this first; the core server also runs it while planning a
 * registration, so a registration that is going to be refused is refused before a person is asked to approve it,
 * and what they are shown — replacing an entry, keeping its pin — is what the install then does.
 */
export declare function preflightInstall(context: InstallContext, product: McpProduct, options: InstallOptions): Promise<InstallPreflight>;
/**
 * Where an install puts the entry and what the entry starts, as one sentence of the preview a person approves: the
 * client's own config file and the command, each with the home written `~`. In the approval's digest with the rest, so
 * a claim from an environment that resolves another file or another command — `CLAUDE_CONFIG_DIR` set to another
 * account's, a PATH that finds another node — is another change, and refused.
 */
export declare function entryDestination(client: string, target: Pick<InstallPreflight["target"], "own" | "configPath">, command: string, env: NodeJS.ProcessEnv): string;
/**
 * What a preflight found an install would do — everything that decides it — carried from the plan a person was shown
 * into the install itself.
 *
 * A registration is planned, agreed to (or found to need nobody's agreement), and applied a moment later, and the
 * machine can move in between: a client's CLI turns up on PATH, and an install planned to print — which asks nobody —
 * would register; an entry the plan replaced, keeping its pin, is removed by somebody else, and the install would
 * register the server unpinned under an approval that said it was pinned. So the install is handed what was planned,
 * checks that its own preflight arrives at exactly that, and refuses when it does not: see `mcpInstall`.
 */
export interface PlannedInstall {
  /** Whether it registers the server, or only prints the entry. */
  readonly writes: boolean;
  /** Where it goes: the client's CLI it registers through, by path, and the client's own file. */
  readonly cliName: "claude" | "codex" | null;
  readonly binary: string | null;
  readonly configPath: string | null;
  readonly own: string | null;
  /** This product's own entries under the name that it replaces, each whole. Empty when it adds. */
  readonly replaces: readonly string[];
  /** The pin and `--read-only` the server is started with: the caller's, and what it keeps from what it replaces. */
  readonly narrowing: Required<Pick<Narrowing, "readOnly">> & Record<"account" | "inbox" | "workspace", string | null>;
  /** The node the entry runs under, and what it starts: see `InstallPreflight`. */
  readonly node: string;
  readonly command: string;
}
/** The plan a preflight arrived at, in the form `mcpInstall` compares: see `PlannedInstall`. */
export declare function plannedInstall(preflight: InstallPreflight): PlannedInstall;
/**
 * Writes (or prints) the entry for one client, then starts the server through exactly that entry and completes an
 * `initialize` and `tools/list`. An entry that looks right but does not start is the failure people actually hit.
 *
 * `planned` is what a plan shown to a person — or one that asked nobody — said this install does: see
 * `PlannedInstall`. When it is given, the install's own preflight has to arrive at exactly that, or it is refused with
 * nothing written; and the server is started with the pins the plan named, given outright, as `agentcomms update`
 * gives them.
 */
export declare function mcpInstall(context: InstallContext, product: McpProduct, options: InstallOptions, planned?: PlannedInstall): Promise<InstallResult>;
/**
 * The exit status an install ends with, the same in both CLIs: non-zero when nothing was registered although that
 * was asked for, and when the entry was started and did not work.
 *
 * A registration that does not start is the failure people actually hit, and it used to end with 0 — after
 * `--force` had already removed the working entry it replaced.
 */
export declare function installExitStatus(result: Pick<InstallResult, "notApplied" | "verification">): number;
/**
 * The same verdict for a surface that has no exit status to end with — the core server's `comms_server_install`: the
 * error an install is wherever `installExitStatus` is not 0, and null wherever it is.
 *
 * Its code, `PROVIDER_UNAVAILABLE`, is the one that exits with `installExitStatus`'s status, so the tool and the
 * command say one thing. The whole result goes in its details, as the command prints it: the entry to add by hand is
 * `snippet`, and a `--print` of an entry that starts — or was not started — is no error at all.
 */
export declare function installFailure(result: InstallResult): CommsError | null;
/** Starts the server exactly as a client would, and completes the handshake. */
export declare function verifyEntry(entry: ServerEntry, product: Pick<McpProduct, "binary" | "version">): Promise<{
  ok: boolean;
  detail: string;
}>;
export interface PruneResult {
  /** The only directory anything is ever removed from. */
  runtimeDir: string;
  dryRun: boolean;
  /** Removed — or, with `dryRun`, what would be. */
  removed: {
    path: string;
    version: string;
  }[];
  kept: {
    path: string;
    version: string;
    reason: string;
  }[];
  /** Why nothing was removed at all, when something stopped the whole run. */
  refused?: string | undefined;
}
/**
 * Every running process's command line, or null when they cannot be listed.
 *
 * `ps` is started by its full path, `/bin/ps` or else `/usr/bin/ps`, never by its bare name: a name is looked up, and
 * a lookup can reach the folder this was started from — where a download may have saved a stranger's `ps`, which would
 * then run, and whose answer would decide what is deleted. With neither there, the processes cannot be listed.
 *
 * `directories` and `list` are for tests: where to look for `ps`, and what runs the one found.
 */
export declare function runningCommandLines(options?: {
  directories?: readonly string[] | undefined;
  list?: ((ps: string) => Promise<string[] | null>) | undefined;
}): Promise<string[] | null>;
/**
 * This product's managed runtimes on disk, oldest name first: every directory directly inside `<data>/runtime`,
 * named like a version, that holds this product's package — never a symbolic link, never another product's runtime,
 * never anything else in that directory.
 *
 * One reading, shared by `pruneManagedRuntimes`, which deletes from it, and the core server's list of what is
 * installed, which only reports it. Two readings of one directory would be two answers to "is this installed", and
 * the one prune acted on need not be the one a person was shown.
 */
export declare function listManagedRuntimes(dataDir: string, packageName: string): Promise<{
  path: string;
  version: string;
}[]>;
/**
 * Removes this product's managed runtimes that no client config it can read names, that it never printed an
 * entry for, and that no process is running.
 *
 * Every upgrade installs a new `runtime/<version>-<name>` and leaves the old one where it was — a machine that had
 * been through six releases held five orphans at 4–5 MB each. Deleting a runtime a client still starts turns a
 * working server into one that fails with nothing in the client to say why, so everything that could mean "in
 * use" keeps it:
 *
 *  - only directories directly inside `<data>/runtime`, named like a version, that hold this product's package —
 *    never a symbolic link, never another product's runtime, never anything else in that directory;
 *  - never this release's own;
 *  - never one an entry names in a client config `scanRegisteredServers` reads, in any scope — the ones this
 *    environment names, and every one an install recorded registering into, wherever `CLAUDE_CONFIG_DIR` or
 *    `CODEX_HOME` pointed then. When one of those files is there and cannot be read, nothing is removed at all: a
 *    file skipped in silence looked exactly like one that registered nothing, and one comment in a VS Code
 *    `mcp.json` was enough to lose a runtime. A recorded file that is gone keeps nothing;
 *  - never one it handed out as an entry to paste (`--client json`, `--print`), which no scan can follow — unless
 *    `includePrinted` says those entries are gone, which only the person who pasted them can know. What that
 *    removes leaves the record with it. When the record cannot be read, nothing is removed;
 *  - never one a running process names. When the processes cannot be listed, nothing is removed at all.
 *
 * What it cannot see is an entry in a file it does not read — a workspace `.vscode/mcp.json`, a config a client
 * was pointed at on its command line — put there by hand, or pasted from a `--print` that warned its record could
 * not be written. The documents say so rather than promise more.
 *
 * `only`, when given, is the most it may remove: the runtimes a person approved removing, from a dry run shown to
 * them. Anything else it would have removed is kept, and says why. Removal is approved as a list of paths, and a
 * runtime that became unused after that list was shown is not on it.
 */
export declare function pruneManagedRuntimes(context: InstallContext, product: Pick<McpProduct, "packageName" | "version">, options?: {
  dryRun?: boolean;
  includePrinted?: boolean;
  processes?: () => Promise<readonly string[] | null>;
  only?: readonly string[] | undefined;
}): Promise<PruneResult>;
//#endregion
//#region src/channel-servers.d.ts
/**
 * The MCP servers this suite ships, and what the shared installer needs to know to register each one.
 *
 * One list, read by every installer. `agent-gmail mcp install` and `agent-slack mcp install` register their own
 * server; the core server's `comms_server_install` registers any of them. Each package used to keep these facts
 * beside its own installer, and a second installer holding a copy would have been a second place for a package name,
 * a flag or an npx argument to drift — the Slack entry once started `agent-slack --workspace acme` with no command at
 * all, because a shared default was wrong for one product. So the channel packages spread these, and add only what
 * is theirs: the version they are, and where their own code lives.
 *
 * What each warns about is here too: the other servers for the same service that send with no approval step. It was
 * the one fact the channels kept to themselves, so registering Gmail from chat warned about nothing while
 * `agent-gmail mcp install` warned about exactly those servers — the same registration, telling a person less on one
 * surface.
 *
 * **Derived, not written.** Every fact here comes from a channel's manifest — the `"agentcomms"` field of its
 * `package.json` — through core's build-time snapshot of them (`channels.generated.ts`). This table used to be written
 * out by hand, with a function per channel for its flags; those functions are now read off the manifest's
 * `narrowing` and `rivals`, so a new channel is a manifest rather than an edit here, and a golden test holds the
 * derived behaviour to what the hand-written table did.
 */
/**
 * A channel's word: `core`, `gmail`, `slack` — a string, checked against core's snapshot of the manifests
 * (`isChannel`, `channelServer`) wherever one arrives from outside, rather than a union a new channel has to be
 * added to by hand. `BuiltInChannel` is the union of this release's, generated with the snapshot.
 */
export type Channel = string;
/** Every channel in core's snapshot, the core first. */
export declare const CHANNELS: readonly Channel[];
/** Everything about a server except the version being installed and where its code lives. */
export type ServerFacts = Omit<McpProduct, "version" | "moduleUrl">;
/**
 * The flags a server is started with, from the options `mcp install` was given: each of the manifest's `narrowing`
 * entries in order — a pin's flag and its value when it has one, a switch's flag when it is on.
 */
export declare function narrowingArgs(manifest: ChannelManifest, options: InstallOptions): string[];
/**
 * The pin and switches a registered entry's arguments carry, read back as the options `narrowingArgs` takes — as the
 * doctor's repair reads them, so `--force` keeps what a registered entry narrowed.
 */
export declare function narrowingFromArgs(manifest: ChannelManifest, args: readonly string[]): Narrowing;
/** A channel's server facts, from its manifest. */
export declare function serverFactsOf({ packageName, manifest }: ChannelEntry): ServerFacts;
export declare const CHANNEL_SERVERS: Readonly<Record<BuiltInChannel, ServerFacts>>;
/** How each server is named to a person: in a preview, and in what a tool returns. */
export declare const CHANNEL_LABELS: Readonly<Record<BuiltInChannel, string>>;
/** A channel's manifest, from core's snapshot. */
export declare function channelManifest(channel: string): ChannelManifest | undefined;
export declare function isChannel(value: unknown): value is Channel;
/** A channel's server facts, by its word; refused for a word that is not a channel. */
export declare function channelServer(channel: Channel): ServerFacts;
/** How a channel's server is named to a person, by its word; refused for a word that is not a channel. */
export declare function channelLabel(channel: Channel): string;
/** A channel's manifest, by its word; refused for a word that is not a channel. */
export declare function requireChannelManifest(channel: Channel): ChannelManifest;
//#endregion
//#region src/chars.d.ts
export declare function isInvisible(codePoint: number): boolean;
/**
 * C0 controls except tab and newline (ESC, and so every ANSI/OSC sequence, starts here), DEL, and C1 controls (CSI
 * among them). A lone carriage return counts: it moves a terminal cursor back over text already printed.
 */
export declare function isControl(codePoint: number): boolean;
export declare function isDangerous(codePoint: number): boolean;
/**
 * Strips control characters (ESC, CSI, OSC and the rest), DEL, lone carriage returns, zero-width, bidi-control and tag
 * characters from sender-controlled text; returns the text and how many were removed. CRLF becomes LF first.
 *
 * This lives beside the table rather than in the sanitiser because `neutralise` needs it too, and the two must not
 * drift: a pattern that looks for `</untrusted-content` cannot see it through a zero-width space, so stripping
 * has to happen before any such pattern runs, on every path, not only on the ones that render a body.
 */
export declare function stripInvisible(text: string): {
  text: string;
  removed: number;
};
//#endregion
//#region src/compose-profile.d.ts
/**
 * How messages should be written.
 *
 * A person's writing has a shape — how they greet, how long a message runs, how they sign off — and an agent that
 * ignores it produces mail that reads as written by somebody else. That shape belongs in one place, not scattered
 * through skills, and it has layers: what is true of every message, what is true of this platform (a Gmail thread
 * has a subject and a signature; a chat message has neither), and what is true of one mailbox (work is not home).
 *
 * The layers are plain Markdown files the user can edit. They are **instructions to whoever writes the message**,
 * never content, and never anything this package sends on its own.
 */
export declare const PROFILE_LAYERS: readonly ["default", "user", "platform", "inbox"];
export type ProfileLayer = (typeof PROFILE_LAYERS)[number];
export interface ProfileSection {
  layer: ProfileLayer;
  /** The file it came from, or `built-in`. */
  source: string;
  text: string;
}
export interface ComposeProfile {
  /** The layers in the order they apply: later ones refine, and may contradict, earlier ones. */
  sections: ProfileSection[];
  /** Everything joined, ready to hand to whoever is writing. */
  text: string;
  /** Files that would be read if they existed, so a caller can say where to put them. */
  candidates: string[];
}
/**
 * The starting point: what holds for any message to a person, whatever the platform. Deliberately short — a profile
 * nobody reads changes nothing — and deliberately about shape rather than content.
 */
export declare const BUILT_IN_PROFILE = "# Writing a message\n\n- Say the thing. The first sentence should carry the point, not set it up.\n- One subject per message. A second topic is a second message, or a conversation.\n- Ask for what you want explicitly, and number the asks when there is more than one.\n- Match the length to the content. Most replies are shorter than they feel they should be.\n- Write as the person would speak: contractions, ordinary words, no performed enthusiasm.\n- No em dashes, no bolded inline headers, no three-part lists written for rhythm rather than meaning.\n- Never apologise for timing unless something was actually promised.\n- Quote what you are answering only when the reply would otherwise be unclear.\n";
export interface ProfileOptions {
  /** `gmail`, or another provider later. */
  platform?: string | undefined;
  /** The mailbox name, for per-inbox rules. */
  inbox?: string | undefined;
  /**
   * Names this mailbox used to have, newest first.
   *
   * A profile is a file named after the mailbox, so a rename would leave the rules a person wrote behind under the
   * old name. The current name wins; a former one is read when nothing has been written under the new one.
   */
  formerInboxes?: readonly string[] | undefined;
}
/**
 * A mailbox's profile file name, with `/` encoded.
 *
 * `acme/gmail` would otherwise name a file in an `inbox-acme` directory nobody created, and the rules written for
 * that mailbox would silently stop applying. `_` cannot appear in a name, so `__` can only mean the separator.
 */
export declare function inboxProfileFile(inbox: string): string;
/**
 * Reads the profile for one message. Missing layers are simply absent: a user who has written nothing gets the
 * built-in shape, and a user who has written everything never sees it.
 */
export declare function readComposeProfile(directory: string, options?: ProfileOptions): Promise<ComposeProfile>;
/** Writes the built-in profile into the directory so a user has something to edit rather than a blank page. */
export declare function initialiseComposeProfile(directory: string): Promise<string>;
/** The profile files that exist, for `doctor` and for a "where do I put this?" answer. */
export declare function listComposeProfiles(directory: string): Promise<string[]>;
//#endregion
//#region src/digest.d.ts
/**
 * The canonical form of an outgoing message that an approval is bound to.
 *
 * It covers what a recipient sees and where the message goes, and leaves out what a provider regenerates on its own
 * — Message-ID, Date, MIME boundaries, transfer encodings — so re-serialising an unchanged draft does not change the
 * digest while any visible change does.
 *
 * Two shapes, because a channel message is not a mail-shaped thing with different field names. Mail goes to a list
 * of addresses and carries a subject; a chat message goes to one channel and its blast radius is *who gets
 * notified*, which has no mail equivalent. Forcing one into the other would mean a digest that covers a recipient
 * list nobody has and omits the thing a person most needs to approve.
 */
export type CanonicalMessage = CanonicalMailMessage | CanonicalChannelMessage;
/** A message with addressed recipients and a subject. `kind` is optional so mail callers need not state the obvious. */
export interface CanonicalMailMessage {
  kind?: "mail" | undefined;
  from: string;
  to: readonly string[];
  cc: readonly string[];
  bcc: readonly string[];
  replyTo: readonly string[];
  subject: string;
  threadId?: string | undefined;
  inReplyTo?: string | undefined;
  references?: readonly string[] | undefined;
  /** The whitespace-collapsed text a reader sees (from the HTML part when there is one). */
  visibleText: string;
  /** SHA-256 of the exact HTML part, so any HTML change — visible or not — changes the digest. */
  htmlSha256?: string | undefined;
  /** SHA-256 of the exact text part. */
  textSha256?: string | undefined;
  attachments: readonly {
    filename: string;
    mimeType: string;
    size: number;
    sha256: string;
  }[];
}
/**
 * A message posted into a channel or thread.
 *
 * `notifies` is the part with no mail equivalent and the reason this is a separate shape. A message naming
 * `@channel` in a 400-person room is a different act from the same words in a two-person thread, and the person
 * approving it is approving the blast radius as much as the words. It is therefore inside the digest: change who
 * gets notified and the approval is void, exactly as adding a recipient voids a mail approval.
 */
export interface CanonicalChannelMessage {
  kind: "channel";
  /** The workspace by its stable id, not the alias a person chose, which they can move. */
  workspace: string;
  /**
   * The user id this will be posted as — the channel equivalent of `from`, and in the digest for the same reason.
   *
   * Every reader sees who spoke, and two accounts connected to one workspace are two different people saying the
   * same words. Without this, a post approved for the bot and a post from the person who owns the workspace were
   * the same message to the approval, and an agent holding both could spend one on the other.
   *
   * The id, not the display name: a name can be changed between the approval and the post, and the account behind
   * it cannot.
   */
  postingAs: string;
  /** The channel or conversation id. */
  channel: string;
  /** The name at the time, for the preview to show. Not part of the digest: a rename is not a different message. */
  channelName?: string | undefined;
  /** The parent message's timestamp when this is a threaded reply. */
  threadTs?: string | undefined;
  /** The text a reader sees, after the composer has rendered it. */
  visibleText: string;
  /** SHA-256 of the exact payload that will be posted, so a block change the text does not show still counts. */
  payloadSha256: string;
  notifies: {
    /** `@here` — everyone currently online in the channel. */
    here: boolean;
    /** `@channel` — every member, online or not. */
    channel: boolean;
    /** Individually mentioned user ids, sorted and de-duplicated by the digest. */
    users: readonly string[];
    /**
     * How many people the above actually reaches, resolved at preview time.
     *
     * Inside the digest because it is what a person is really approving. If the channel grew between the preview
     * and the post, the message now reaches people nobody agreed to reach, and that deserves a fresh look rather
     * than a silent send.
     */
    estimated: number;
    /**
     * Set when `estimated` is not a count: the room's size could not be read, so nobody measured who this reaches.
     *
     * Inside the digest because an unmeasured reach and a room measured at nobody are both `0`, and a person who
     * agreed to one has not agreed to the other. Hashed only when set, so every digest taken before this existed is
     * the digest it was, and an approval outstanding across an upgrade is not voided for it.
     */
    unmeasured?: boolean | undefined;
  };
  attachments: readonly {
    filename: string;
    mimeType: string;
    size: number;
    sha256: string;
  }[];
}
export declare function sha256Hex(data: string | Uint8Array): string;
/** Lower-cases the address part of `Name <addr>` or a bare address; display names are dropped. */
export declare function normaliseAddress(value: string): string;
export declare function collapseWhitespace(text: string): string;
/** Deterministic JSON: keys sorted at every level, undefined members dropped. */
export declare function canonicalJson(value: unknown): string;
/**
 * The approval digest.
 *
 * For mail: the From header keeps its display name (a recipient sees it); recipients are compared by address only,
 * sorted and de-duplicated, so reordering them does not force a new approval but adding one does.
 *
 * **The mail form is byte-identical to what it produced before channels existed**, `kind` deliberately absent from
 * the canonical object. An approval is a record on disk bound to a digest; changing how mail hashes would have
 * voided every approval anybody had outstanding at the moment they upgraded, for no reason a user could see.
 */
export declare function messageDigest(message: CanonicalMessage): string;
//#endregion
//#region src/fs.d.ts
export declare const DIR_MODE = 448;
export declare const FILE_MODE = 384;
/** Creates a directory (and parents) readable only by the current user. Tightens an existing one. */
export declare function ensurePrivateDir(path: string): Promise<void>;
/**
 * Writes a file atomically with owner-only permissions: a temp file in the same directory, fsync, rename. A reader
 * never sees a half-written file, and a crash leaves either the old content or the new.
 */
export declare function writeFileAtomic(path: string, data: string | Uint8Array, mode?: number, signal?: AbortSignal): Promise<void>;
/**
 * Replaces a file that belongs to another program, leaving everything around it as that program had it.
 *
 * `writeFileAtomic` is for this package's own files: it makes the directory owner-only and the file 0600, and it
 * renames over whatever is at the path. Pointed at an MCP client's config it did three things nobody asked for.
 * A config kept in a dotfiles repository and linked into place became a plain file, so the repository never saw
 * the new entry and the next sync undid it; the client's own directory went from 755 to 700; and the file lost
 * its mode. So this writes to the file a link names (following each link in turn, which also reaches the target
 * of a link whose file does not exist yet), keeps that file's mode, and creates only the directories that are
 * missing. Still a temporary file and a rename, so a reader sees the old content or the new and never half.
 */
export declare function replaceFileInPlace(path: string, data: string | Uint8Array): Promise<void>;
/**
 * Appends one line to a file created with owner-only permissions. Used for append-only logs.
 *
 * `durable` flushes it to disk before returning, for a line that has to survive whatever is written next: a record
 * made before a change is only a record of it if a power cut cannot keep the change and lose the line.
 */
export declare function appendPrivateLine(path: string, line: string, options?: {
  durable?: boolean;
}): Promise<void>;
/**
 * Flushes a directory's entries to disk, so a file just created or renamed in it survives a crash.
 *
 * POSIX only: Windows cannot open a directory for this, and NTFS journals its metadata instead.
 */
export declare function syncDirectory(path: string): Promise<void>;
/** True when a path exists and is readable or writable by someone other than its owner (POSIX only). */
export declare function isGroupOrWorldAccessible(path: string): Promise<boolean>;
//#endregion
//#region src/ids.d.ts
/** `ap_` + 26 characters: 130 random bits. Validated before an id ever names a file. */
export declare const APPROVAL_ID_PATTERN: RegExp;
export declare const PLAN_TOKEN_PATTERN: RegExp;
export declare function newApprovalId(): string;
export declare function newPlanToken(): string;
/** A short challenge a human types back to approve: letters only, no look-alikes. */
export declare function newChallenge(length?: number): string;
/** Challenges are stored only as hashes, so no listing or tool result can reveal one. */
export declare function hashChallenge(challenge: string): string;
/** Case-insensitive, constant-time comparison of an answer with a stored challenge hash. */
export declare function challengeMatches(answer: string, storedHash: string): boolean;
//#endregion
//#region src/internet-mark.d.ts
/**
 * Every file a download saves is marked, as a browser marks what it downloads, as having come from the internet — the
 * moment it is made, empty, before a byte of it is written, so that nothing watching the folder finds it unmarked.
 *
 * The mark is what the system itself goes by. On macOS, Gatekeeper asks before a quarantined app or script runs for
 * the first time, and says where it came from; on Windows, SmartScreen asks before a program runs, and Office opens a
 * document in Protected View with its macros blocked. A stranger's file saved without it is one the system treats as
 * the person's own. The file's name already keeps it from being run by accident (`saved-files.ts`); the mark is for the
 * moment a person renames it, or opens it on purpose, and the system should still ask.
 *
 * - macOS: the `com.apple.quarantine` extended attribute, written by `/usr/bin/xattr` — by its full path, so that no
 *   folder the command was run in can stand in for it — with flags `0081` (downloaded, not yet approved), the time in
 *   hex, and this package as the agent that saved it.
 * - Windows: the `Zone.Identifier` alternate data stream, `ZoneId=3`, the Internet zone.
 * - Elsewhere there is no such mark to write, and none is claimed.
 *
 * Failing to mark a file is not failing to save it: the file is there, and the person asked for it. It is said in the
 * result instead, file by file, so that nobody takes an unmarked file for a marked one.
 */
/** Which mark a saved file carries: the macOS attribute, the Windows stream, or none. */
export type InternetMarkKind = "com.apple.quarantine" | "Zone.Identifier";
/** What marking a file came to: the mark written, or none and — when one should have been — why not. */
export interface InternetMark {
  mark: InternetMarkKind | null;
  /** Why no mark was written, on a system that has one. */
  failure?: string | undefined;
}
/** The ways a mark is written, each replaced by a test: a program run, and a stream written. */
export interface InternetMarkDeps {
  platform?: NodeJS.Platform | undefined;
  now?: (() => Date) | undefined;
  /** Runs a program by its full path with its arguments, as `execFile` does; rejects when it fails. */
  run?: ((command: string, args: readonly string[], env: NodeJS.ProcessEnv) => Promise<void>) | undefined;
  /** Writes a file's alternate data stream, as `writeFile` does with `<file>:<stream>`. */
  writeStream?: ((path: string, text: string) => Promise<void>) | undefined;
}
/** `xattr`, by its full path: every Mac has it there, and nothing in a folder a download was saved to can replace it. */
export declare const XATTR = "/usr/bin/xattr";
/** The Windows stream's text: the Internet zone, as a browser writes it for what it downloads. */
export declare const ZONE_IDENTIFIER = "[ZoneTransfer]\r\nZoneId=3\r\n";
/** The quarantine attribute's value: downloaded and not yet approved, when, and by whom. */
export declare function quarantineValue(at: Date): string;
/**
 * Marks a saved file as downloaded from the internet — see above — and says what became of it. Never throws: a file
 * that could not be marked is still saved, and the caller reports the failure.
 */
export declare function markFromInternet(file: string, deps?: InternetMarkDeps): Promise<InternetMark>;
//#endregion
//#region src/jail.d.ts
/**
 * A file name that is safe to create on macOS, Linux and Windows: NFC-normalised, no separators or control
 * characters, no leading or trailing dots and spaces, not a Windows reserved device name, at most `maxBytes` UTF-8
 * bytes with the extension kept. Never empty.
 */
export declare function safeFilename(name: string, maxBytes?: number, fallback?: string): string;
/** A short lowercase slug for directory names: letters and digits joined by single hyphens. */
export declare function slug(text: string, maxLength?: number, fallback?: string): string;
/** True when `candidate` is `root` itself or strictly inside it (lexically). */
export declare function isInside(candidate: string, root: string): boolean;
/**
 * Resolves `target` for writing and proves it stays inside `root` after symlinks in its existing ancestors are
 * followed. Throws BAD_DATA otherwise. The root must already exist.
 */
export declare function resolveInsideRoot(root: string, target: string): Promise<string>;
/**
 * Creates a new file for writing without following a symlink at the final component and without overwriting an
 * existing file. Picks `name-2.ext`, `name-3.ext`… when the name is taken.
 */
export declare function createUniqueFile(directory: string, filename: string): Promise<{
  path: string;
  handle: FileHandle;
}>;
/**
 * Default places attachments may never be read from, whatever the allowed roots say. `~/.*` means every dot-entry
 * directly under home — SSH, cloud, npm, git and shell credentials, agent configs; `**∕.git/**` any repository's git
 * directory; `**∕.env*` dotenv files anywhere.
 */
export declare function defaultAttachDeny(configDir: string, env?: NodeJS.ProcessEnv): string[];
export interface AttachPolicy {
  roots: string[];
  deny: string[];
  home?: string;
}
/**
 * Whether a folder, as written, says where it is on its own: from the home (`~`), or absolute — and on Windows with its
 * drive (`C:\…`) or share (`\\server\share\…`). Windows calls `\outgoing` absolute, but it is on whichever drive is
 * current when it is read, and `C:outgoing` is relative to that drive's current folder; either would move with the
 * process that reads it. A folder in the configuration that does not name its place — written by hand before 0.12.0,
 * say — allows nothing, and `agentcomms attach` takes none (#45).
 */
export declare function namesItsPlace(path: string, platform?: NodeJS.Platform): boolean;
/**
 * Proves a local file may be attached to a draft: it resolves (following links) to a regular file inside one of the
 * allowed roots and inside none of the deny entries. A deny entry of the form `**` + `/name*` matches by file name
 * prefix (so `.env*` matches `.env` and `.env.local`). Returns the real path.
 */
export declare function checkAttachable(path: string, policy: AttachPolicy): Promise<string>;
/**
 * A caller-supplied subdirectory, checked before it is joined to anything.
 *
 * `path.join` is not a boundary, and it was being used as one. `join('work', '../personal')` is `'personal'`: the
 * alias segment is cancelled, the result still resolves inside the downloads root, so `resolveInsideRoot` allows it
 * — and one mailbox's files are written into another mailbox's folder, over the `manifest.json` that is that
 * mailbox's own record of where its attachments came from. `join('work', '/etc/cron.d')` is `'work/etc/cron.d'`:
 * the leading separator is simply dropped, so an absolute path that every document describes as refused is quietly
 * accepted under a name the caller never asked for.
 *
 * Neither is an escape from the root, which is why neither showed up as a jail failure. In one respect they are
 * worse than an escape: they succeed, and report a path the caller was never told about.
 *
 * So the check happens here, on the caller's own string, before any join — absolute paths and `..` are refused
 * rather than normalised away. A nested `reports/august` is fine; that is what the option is for.
 */
export declare function relativeSubpath(out: string | undefined, field?: string): string;
//#endregion
//#region src/keys.d.ts
/** Secret-store reference of the key that seals MCP elicitation state and other server-minted handles. */
export declare const APPROVAL_KEY_REF = "agent-communications:approval-key";
/**
 * Returns the 32-byte approval key, creating it on first use. The key never leaves the secret store except into the
 * memory of the process that uses it.
 */
export declare function getOrCreateApprovalKey(store: SecretStore): Promise<Buffer>;
//#endregion
//#region src/known-folders.d.ts
/**
 * Where Windows keeps a person's own folders — Downloads, Documents — which a person or a domain can move to another
 * drive, or into OneDrive. The profile's `Downloads` and `Documents` are only where they start out.
 *
 * Read from `User Shell Folders` in the registry, with `reg.exe` by its full path under the Windows folder — never the
 * bare `reg`, which Windows would look for in the current folder first, and the current folder is one a download may
 * have saved a stranger's `reg.exe` into — and with the child told not to look in its own current folder either. Read
 * only for the profile of the user running this, since the registry says nothing about any other, and never for longer
 * than two seconds.
 */
/** The Downloads known folder's own id, under which `User Shell Folders` keeps where it is. */
export declare const DOWNLOADS_KNOWN_FOLDER = "{374DE290-123F-4565-9164-39C4925E467B}";
/** The Documents known folder's name there: `Personal`, for historical reasons. */
export declare const DOCUMENTS_KNOWN_FOLDER = "Personal";
/** How a program is run to read the registry: `execFileSync`'s shape, so a test can stand in for it. */
export type RegistryRunner = (command: string, args: readonly string[], options: {
  env: NodeJS.ProcessEnv;
  timeout: number;
}) => string;
export interface KnownFolderDeps {
  /** The platform this runs on: Windows alone has the registry. */
  platform?: NodeJS.Platform | undefined;
  /** The environment of the running process: its own profile and its Windows folder. */
  processEnv?: NodeJS.ProcessEnv | undefined;
  run?: RegistryRunner | undefined;
}
/**
 * Where the registry says one of the running user's known folders is — `valueName` under `User Shell Folders` — with
 * `%USERPROFILE%` and the like expanded from `env`; or undefined: not on Windows, not this user's own profile, not
 * answered in time, or not an absolute path on a drive.
 */
export declare function registryShellFolder(env: NodeJS.ProcessEnv, valueName: string, deps?: KnownFolderDeps): string | undefined;
/** `registryShellFolder`, asked once per process for each folder and profile when no test stands in for the registry. */
export declare function knownFolder(env: NodeJS.ProcessEnv, valueName: string, deps?: KnownFolderDeps): string | undefined;
//#endregion
//#region src/lock.d.ts
interface LockTimings {
  /** Give up after this long. */
  timeoutMs?: number;
  /** A lock whose recorded time is older than this is assumed abandoned by a crashed process. */
  staleMs?: number;
  /**
   * Renew the lock this often while `fn` runs, so a holder that is still working is never judged abandoned.
   *
   * Opt-in, for locks held across work of unbounded length. Staleness was judged from a time written once, at
   * acquisition, so a live holder that ran past `staleMs` could be taken over mid-operation — for the credentials
   * lock, a migration with enough credentials and a slow enough keychain, recreating the very race the lock
   * exists to prevent.
   */
  renewMs?: number;
  /**
   * Give up after waiting this long in all, however often the lock has changed hands meanwhile.
   *
   * Counted from when this caller began to wait, and never restarted. It is what bounds `timeoutPerHolder`, which
   * restarts the timeout at every hand-over and so, alone, bounds nothing: the lock is not a queue that serves its
   * callers in turn. Every waiter polls, and whoever looks first after a release takes it, so a waiter that keeps
   * looking at the wrong moment can watch caller after caller arrive later and go first — for as long as callers
   * keep arriving.
   */
  maxWaitMs?: number;
}
/**
 * How `withFileLock` takes its lock: how long it waits, when a lock counts as abandoned, and how a holder keeps one.
 *
 * `timeoutPerHolder` comes only with `maxWaitMs`, so that no caller can ask for a wait with no end.
 */
export type LockOptions = LockTimings & ({
  timeoutPerHolder?: false;
} | {
  /**
   * Count `timeoutMs` from the last time the lock changed hands, rather than from when this caller began to
   * wait.
   *
   * Opt-in, for a lock that is a queue: many callers arriving at the same moment, each holding it for a moment.
   * Counted from the start, the timeout is a budget for the whole queue ahead, so on a machine slow enough the
   * last caller in line gives up — "another process is holding" — while the lock is being handed on exactly as
   * it should be. Counted per holder, a waiter gives up only once one holder has kept the lock for the whole
   * timeout, which is the stuck lock the timeout is there to catch. A waiter sees a hand-over as a different
   * token in the lock file.
   *
   * Not the default, and never without `maxWaitMs`: on its own it lets a waiter wait for as long as the lock
   * keeps changing hands, and a lock that is polled rather than queued can keep changing hands past one waiter
   * for ever.
   */
  timeoutPerHolder: true;
  maxWaitMs: number;
});
/**
 * Runs `fn` while holding an exclusive lock file. The CLI and several MCP server processes share config, approvals and
 * counters; every read-modify-write of those goes through here so no update is lost. Keep critical sections to file
 * I/O: do network work first, then re-check preconditions under the lock. (Single-use sends do not rely on this lock
 * alone: see the O_EXCL claim marker in the approval store.)
 */
export declare function withFileLock<T>(lockPath: string, fn: () => Promise<T>, options?: LockOptions): Promise<T>;
/**
 * The lock every operation that rewrites stored credentials in bulk must hold.
 *
 * Next to the configuration rather than in the state directory, because it guards the same thing the config lock
 * does from a different angle: which backend holds which credential. The config lock serialises writes to the
 * file; this serialises the operations that move secrets *between* backends around those writes, which take far
 * longer than a config write and must not interleave with each other.
 *
 * Two opposite migrations were the case that forced it. One copied into a backend while the other was cleaning
 * the same backend out, and the result was a credential in neither — the active backend empty, and the one it
 * had been copied from emptied too.
 *
 * **S3's token refresh must take this lock too**, before it is wired to anything. A refresh rewrites a credential
 * under the same reference, which a migration's own checks cannot see; holding this lock is what serialises the
 * two. Recorded in the Slack design spec next to the phase table.
 */
export declare function credentialsLockPath(configDir: string): string;
/**
 * Runs `fn` holding the credentials lock, renewed for as long as `fn` runs.
 *
 * Renewed rather than given a long stale window. What runs under this has no upper bound on its length — a
 * migration of many credentials, each waiting on the keychain — so any fixed window is one a live holder can
 * outlast. With renewal the window only has to cover a holder that has actually died, which is also why it can be
 * short: a crashed migration stops blocking the next one in two minutes rather than ten.
 *
 * A short timeout by default, because a second caller arriving while one is running should be told so promptly
 * rather than queue behind a prompt nobody is answering. A caller that is not a person — a token refresh behind
 * another workspace's refresh, whose holder is waiting on a network call rather than on anybody — may wait longer.
 */
export declare function withCredentialsLock<T>(configDir: string, fn: () => Promise<T>, options?: {
  timeoutMs?: number;
}): Promise<T>;
//#endregion
//#region src/name-grammar.d.ts
/**
 * The whole grammar as one expression, so a record key can be checked by the schema without a second pass.
 *
 * Segments never start or end with a hyphen, and the character set is `[a-z0-9/-]` and nothing else: no `.`, so no
 * `..`; no whitespace, no controls, no upper case, nothing that looks like something else.
 */
export declare const NAME_PATTERN: RegExp;
/** An organisation word on its own — `cue`, `rgc` — exactly as it would begin an account name. */
export declare const ORGANISATION_PATTERN: RegExp;
/** A platform word on its own — `gmail`, `slack` — which is also a channel's word in its manifest. */
export declare const PLATFORM_PATTERN: RegExp;
export declare const NAME_MESSAGE = "names look like organisation/platform, optionally with a qualifier: cue/gmail, wf/gmail-tech, cue/slack";
export interface ParsedName {
  org: string;
  platform: string;
  qualifier?: string | undefined;
}
/** The three parts of a valid name, or null for anything the grammar refuses. */
export declare function parseName(name: string): ParsedName | null;
export declare function isValidName(name: string): boolean;
/**
 * The organisation word, or null for anything the grammar refuses — the same rule as a name's first half, from the same
 * expression. `max` cuts it shorter where a word has to leave room for something after it: an organisation profile's
 * word becomes client names `<organisation>-<n>`, which have 32 characters between them (design 2026-10-02 §D2).
 */
export declare function parseOrganisation(word: string, options?: {
  max?: number;
}): string | null;
/**
 * Why an organisation word is refused, in words a person can act on — or null when it is fine.
 *
 * Shared with `nameShapeProblem`, so the reason a profile's organisation is refused is the reason a name with it would
 * be: Windows' reserved words say so, and anything else says what the word may hold.
 */
export declare function organisationProblem(word: string, options?: {
  max?: number;
}): string | null;
/**
 * Why a name is refused, in words a person can act on — or null when it is fine.
 *
 * `platform` is what the account actually is. Checked here as well as in the schema, so the error arrives when the
 * name is proposed rather than as a refused config write after a sign-in has already been spent.
 */
export declare function nameShapeProblem(name: string, platform: string): string | null;
//#endregion
//#region src/names.d.ts
/**
 * Every lookup of an account by name, and every check that a name may be taken, goes through here.
 *
 * Two versions of the config name accounts differently (see `name-grammar.ts`), and version 2 remembers the names it
 * replaced. A caller that indexed `config.inboxes[name]` itself would know neither: it would apply version 1's rules
 * to a version-2 file, and answer "no such inbox" to somebody using a name that was renamed an hour ago, instead of
 * telling them what it is called now.
 */
export type NameKind = "inbox" | "account";
type NotFound = () => CommsError;
/**
 * The account a name refers to, or a refusal that says why there is none.
 *
 * A name that was replaced is refused with its replacement — `NOT_FOUND`, the current name in the hint and in
 * `details`. It is never followed: D3 chose refusal over aliases, so nothing runs under a name that no longer exists,
 * and whoever typed it learns the new one.
 *
 * `notFound` supplies the plain "no such thing" error, so each package keeps its own wording and hint.
 */
export declare function resolveName(config: Config, kind: "inbox", name: string, notFound?: NotFound): {
  alias: string;
  inbox: InboxConfig;
};
export declare function resolveName(config: Config, kind: "account", name: string, notFound?: NotFound): {
  alias: string;
  account: AccountConfig;
};
/**
 * The live account under exactly this name, or undefined — no former names, no refusal.
 *
 * For callers that only ask "is this name connected right now": a policy preflight, a startup hint. Anything that
 * acts on the answer for a person who typed the name should use `resolveName`, which tells them what an old name is
 * called now.
 */
export declare function lookupName(config: Config, kind: "inbox", name: string): InboxConfig | undefined;
export declare function lookupName(config: Config, kind: "account", name: string): AccountConfig | undefined;
/** The name an account has now, found by its immutable id. */
export declare function findById(config: Config, kind: "inbox", id: string): {
  alias: string;
  inbox: InboxConfig;
} | null;
export declare function findById(config: Config, kind: "account", id: string): {
  alias: string;
  account: AccountConfig;
} | null;
/**
 * The refusal for a former name, or null when `name` is not one.
 *
 * The replacement is looked up by id rather than read from the record, so a chain of renames ends at the name the
 * account has today — and an account removed since its rename is said to be gone, rather than pointing somebody at a
 * name that now belongs to nothing.
 */
export declare function formerNameRefusal(config: Config, kind: NameKind, name: string): CommsError | null;
/**
 * The names this account used to have, most recently recorded first.
 *
 * For the few places a name is more than a lookup — a file named after the mailbox, say — so what was written under
 * the old name can still be found after a rename.
 */
export declare function formerNamesOf(config: Config, kind: NameKind, name: string): string[];
/** Looks up an inbox by name, or fails with the list of known names — or with what a former name is called now. */
export declare function requireInbox(config: Config, alias: string): InboxConfig;
export type NameCheck = {
  ok: true;
} | {
  ok: false;
  error: CommsError;
};
/**
 * Whether `name` may be given to a new or renamed account of this kind and platform.
 *
 * Each version keeps its own rule, because version 1's differ by kind today and must not change under a file an
 * older release also writes: a mailbox name need only be free among mailboxes, a workspace name among both. Version
 * 2 is stricter and the same for both: the grammar, the platform, free in both maps, and never a former name of
 * either kind.
 *
 * A check, not a reservation. Callers repeat it inside the config write, where the schema enforces the same rules
 * again for version 2, because anything can happen between asking and writing.
 */
export declare function nameAvailable(config: Config, kind: NameKind, name: string, platform: string): NameCheck;
/**
 * `config` with one account renamed — and, in version 2, the old name recorded for good.
 *
 * Earlier records for the same account are pointed at the new name too, so `cue` → `cue/gmail` → `cue/gmail-main`
 * leaves `cue` naming `cue/gmail-main`, never another former name. The caller has checked `to` with
 * `nameAvailable`; the schema checks it again when this is written.
 */
export declare function renameEntry<C extends Config>(config: C, kind: NameKind, from: string, to: string): C;
/**
 * `config` with every former name that pointed at `fromId` pointed at `toId` instead.
 *
 * For a re-authorisation that mints a new id for the same account — Slack's did before it kept the id, and a release
 * of that age still does. Without this, the account's old names would point at an id that no longer exists and be
 * reported as belonging to a removed account while it is still connected. Called in the same config write that
 * replaces the id; `ConfigStore.update` allows exactly this change and no other to a former name's id.
 */
export declare function retargetFormerNames<C extends Config>(config: C, kind: NameKind, fromId: string, toId: string): C;
export interface NamesMigrationRow {
  kind: NameKind;
  from: string;
  to: string;
  id: string;
  platform: string;
}
/** A `--rename` for a name this configuration does not have, so it changes nothing here. */
export interface NotApplicableRename {
  rename: string;
  source: string;
  to: string;
}
export type NamesMigrationPlan = {
  status: "already-migrated";
} | {
  status: "ready";
  fingerprint: string;
  rows: NamesMigrationRow[];
  notApplicable: NotApplicableRename[];
};
/**
 * What the migration would do to `config`, or a refusal listing every problem at once.
 *
 * Each account's default is `<old name>/<platform>`; `renames` overrides one, as `source=name`, where the source may
 * be qualified — `inbox:work=…`, `account:work=…` — and must be when version 1 has the same word in both maps. Every
 * problem is collected before anything is refused, so a person fixes them in one pass instead of one per run; and a
 * plan with a problem is never partly applied.
 *
 * A rename for a name this configuration does not have is not a problem: it is reported in `notApplicable` and
 * changes nothing. One person's accounts are spread over several computers, and each has only some of them; when an
 * absent name refused the whole plan, one mapping could not be run everywhere, and whoever trimmed it by hand for
 * each machine was one slip away from dropping a rename — after which that account takes its default for good. What
 * is skipped is shown beside the mapping, so a misspelt source is seen before anything is written.
 *
 * The fingerprint is of the whole configuration this was computed from. `migrateNames` refuses to apply the plan to
 * anything else, and refuses to call it already done unless this plan's own rows are the ones in place — two people
 * mapping the same names differently are not each other's retry.
 */
export declare function planNamesMigration(config: Config, renames?: readonly string[]): NamesMigrationPlan;
/** Version 2 from version 1 and a plan made from it: every key renamed, every old name recorded. Nothing else. */
export declare function applyNamesMigration(config: ConfigV1, rows: readonly NamesMigrationRow[]): ConfigV2;
/**
 * Applies a plan, under both locks, to exactly the configuration it was made from.
 *
 * See `ConfigStore.migrateNames` for what is checked inside the locks.
 */
export declare function migrateNames(store: ConfigStore, plan: Extract<NamesMigrationPlan, {
  status: "ready";
}>): Promise<{
  status: "migrated" | "already-migrated";
  config: ConfigV2;
  backup?: string;
}>;
//#endregion
//#region src/numbers.d.ts
/**
 * A whole number as it was given: a string of digits and nothing else (surrounding spaces aside), or a number that is
 * whole — and `NaN` for anything else.
 *
 * `Number.parseInt` read `abc` as NaN, `12abc` as 12 and `1e2` as 1; `Number` reads `1e2` as 100, `0x10` as 16 and an
 * empty string as 0. Each of those is a number nobody typed, so none of them is read as one here. A value too large to
 * hold exactly is not one either: it would be used as some other number.
 */
export declare function readWholeNumber(raw: unknown): number;
/** The range a number option takes, and what it is called where it was given. */
export interface WholeNumberRule {
  /** The option as its caller spells it: `--limit` on a command line, `limit` in a tool call. */
  name: string;
  min: number;
  /** The most it may be. Left out, any whole number from `min` up. */
  max?: number | undefined;
  /** What the number means where the range alone does not say — that 0 picks a free port, say. */
  hint?: string | undefined;
}
/**
 * A number option, checked rather than coerced: the number, `undefined` when none was given, or a USAGE refusal that
 * names the option and its range.
 *
 * One check for every command line's number options — `agentcomms`, `agent-gmail` and `agent-slack` — and for the
 * operations those commands share with their tools, so a number the command refuses is refused by the tool in the
 * same words, and nothing reads `--limit 1e2` as 1 or `--port abc` as no port at all.
 */
export declare function wholeNumber(raw: unknown, rule: WholeNumberRule): number | undefined;
//#endregion
//#region src/oauth-client-records.d.ts
/**
 * The records of a Google OAuth client on this machine: its row in `config.clients`, and its secret in the store.
 *
 * These lived in the Gmail package, beside `client add`, which was the only thing that wrote them. An organisation
 * profile writes them too (design 2026-10-02 §D5), and the core owns that operation — and the core does not depend on
 * the Gmail package, Gmail depends on the core. So the pieces both need are here, and `client add` imports them: one
 * client-id check, one way to name a client's secret, one shape of row, and one procedure for writing a secret beside
 * the configuration that names it. Two copies of the last one would be two answers to "what if the write fails".
 *
 * Nothing here talks to Google: probing a client's credentials stays in the Gmail package, which owns the endpoints.
 */
/** What every Google OAuth client id ends with. */
export declare const GOOGLE_CLIENT_ID_SUFFIX = ".apps.googleusercontent.com";
/**
 * A Google client id as an organisation profile has to write it (design 2026-10-02 §D2): the project number, a hyphen,
 * the client's own part, and Google's suffix — and nothing else.
 *
 * Stricter than `isGoogleClientId`, which `client add` has always used and still does: a downloaded client file comes
 * from Google, while a profile is written by a person, and every field of it has a grammar and a bound.
 */
export declare const GOOGLE_CLIENT_ID_PATTERN: RegExp;
/**
 * Whether a value from a downloaded client file is a Google client id at all — the check `client add` makes, unchanged:
 * the suffix, which every client id Google issues carries.
 */
export declare function isGoogleClientId(value: unknown): value is string;
/**
 * Where a client's secret is kept: derived from the client's name, so the Gmail session finds it from `inbox.client`
 * alone. A client re-registered under the same name — a rotation, a repair — writes the same reference.
 */
export declare function clientSecretRef(name: string): string;
/** A Gmail client's row as the configuration holds it, its secret named by `clientSecretRef(name)`. */
export declare function gmailClientRow(input: {
  name: string;
  clientId: string;
  projectId?: string | undefined;
  addedAt: string;
  /** The organisation profile that owns the row (design 2026-10-02 §D4); absent on a row a person registered. */
  organisation?: string | undefined;
}): ClientConfig;
/**
 * The store a command that writes a secret keeps it in: the one the configuration already uses — recorded, or the
 * keychain a Slack token already sits in — or, when nothing is stored yet, the one asked for, after proving the
 * keychain works when that is the one. A different one is refused before anybody is asked to approve it
 * (`secretsStoreFor`): switching here would record a store and move nothing.
 *
 * `keyring` is for a test: the real module writes, reads and deletes an item in the login keychain, and a test must
 * never touch it. Left out, the real one is loaded.
 */
export declare function chooseSecretStore(config: Config, requested: StoreKind | undefined, options?: {
  keyring?: KeyringModule | null | undefined;
  platform?: NodeJS.Platform | undefined;
}): Promise<{
  store: StoreKind;
  choosing: boolean;
}>;
export interface SecretWriteOptions {
  secrets: SecretStore;
  secretRef: string;
  secret: string;
  /**
   * Writes the configuration that names the secret — one `ConfigStore.update`. Call `refuse(true)` as the mutator
   * starts and `refuse(false)` as it accepts: a write that refused itself is told apart from one that failed around
   * itself, because re-writing a row identical to the one there changes nothing, and a refusal would otherwise look
   * exactly like a write that landed.
   */
  commit: (refuse: (refused: boolean) => void) => Promise<void>;
  /**
   * Whether the configuration this call meant to write is the one there now, read fresh — asked only after the write
   * rejected, which does not prove it did not land (see `writeOutcome`). The secret is checked separately, after.
   */
  landed: () => Promise<boolean>;
  /** How a person checks whether it was saved, for a write whose outcome cannot be read: "Run `agent-gmail client list`." */
  howToCheck: string;
  /** How a person puts things right when the store cannot be put back as it was. */
  restoreHint: string;
}
/**
 * Writes a client secret and the configuration that names it, and on failure leaves the reference exactly as it was.
 *
 * The procedure `client add` has used since a failed registration left a secret under a name nothing used (design
 * 2026-10-02 §D4 makes it every client write's, an organisation's included):
 *
 * 1. **Keep what the reference holds now.** A name free in the configuration does not prove its reference is empty —
 *    an older registration, a removal whose deletion failed — so the earlier value is read first, and is what a
 *    failure puts back: the previous secret, or nothing.
 * 2. **Write the secret, read it back**, inside the boundary that puts it back: a keychain write can land after it has
 *    reported a timeout, so even a failed write is reconciled rather than assumed not to have happened.
 * 3. **Write the configuration.**
 * 4. **On any failure, ask whether it landed** (`writeOutcome`): the configuration as meant *and* the store holding the
 *    new secret, read fresh. Rotating a secret writes a row identical to the one there, so a row check alone answers
 *    "yes" before anything happened. Landed: keep it. Not landed: put the reference back. Cannot tell: keep it, and
 *    name the reference that may be left behind, because the cost of a wrong guess is a live secret deleted.
 *
 * The caller holds the credentials lock around this, and checks under it whatever its own change depends on.
 */
export declare function writeSecretWithRestore(options: SecretWriteOptions): Promise<void>;
//#endregion
//#region src/organisations.d.ts
/**
 * Organisation profiles (design 2026-10-02): an organisation makes its apps once — a Google OAuth client, a Slack app
 * for reading and one for posting — and writes them into one small document; every member adds that document here,
 * alongside whatever they already have, and their accounts can then use the organisation's apps.
 *
 * This module is what the profile *is* and what the configuration records of it: the strict schema a document has to
 * pass (§D1, §D2), how it is read from a file (§D3), how it is shown (§D2), and — over the `organisations` record and
 * the client rows — the generations of its Google client, which of them a profile resolves to, and how far the
 * configuration has drifted from what was approved (§D4, §D8). It writes nothing: `operations/organisations.ts` is the
 * one place a profile changes the configuration, each change approved first.
 *
 * **A profile is data, never code, and none of it is trusted.** Every field comes from whoever wrote the document, so
 * each has a grammar and a bound, an unknown key is an error, and the two free-text fields are neutralised and put on
 * one line wherever they are shown. The client secret is never shown anywhere — not in a preview, an effect, an error,
 * the audit log, a command's output or a tool's result.
 */
/** What a profile says it is, in its first key. */
declare const PROFILE_KIND: "organisation-profile";
/**
 * The longest organisation word a profile may have: its clients are named `<organisation>-<n>`, `n` up to
 * `GENERATION_LIMIT`, and a client name has 32 characters (`ALIAS_PATTERN`).
 */
export declare const PROFILE_ORGANISATION_MAX = 28;
/** The most generations — owned client names `<organisation>-1` … — one organisation can have here. */
export declare const GENERATION_LIMIT = 999;
interface ProfileSlackApp {
  clientId: string;
  appId?: string | undefined;
}
interface ProfileGmail {
  clientId: string;
  clientSecret: string;
  projectId?: string | undefined;
  serves: OrganisationServes;
}
interface ProfileSlack {
  workspace: string;
  workspaceName: string;
  redirectPort: number;
  apps: {
    read?: ProfileSlackApp | undefined;
    send?: ProfileSlackApp | undefined;
  };
}
/** An organisation profile, as the schema has checked it. */
interface OrganisationProfile {
  agentcomms: typeof PROFILE_KIND;
  version: 1;
  organisation: string;
  label: string;
  gmail?: ProfileGmail | undefined;
  slack?: ProfileSlack | undefined;
}
export declare const organisationProfileSchema: z.ZodType<OrganisationProfile, unknown>;
/**
 * A string that came from a profile, as it is shown anywhere: chat-template tokens, role markers and envelope look-alikes
 * neutralised (`neutralise`), every control and invisible character made visible, tabs and line breaks flattened to a
 * space, and cut to `width`. `neutralise` keeps line feeds and tabs on purpose — they are legitimate in a message body —
 * so the flattening is what keeps a label from printing a second line of a preview.
 */
export declare function shownText(value: unknown, width?: number): string;
/**
 * Parses a profile's text, or refuses it — naming each problem by where it is and what it should be, never by the value
 * found there. A key the schema does not know is named, neutralised and cut short: it came from the document too.
 */
export declare function parseProfile(text: string): OrganisationProfile;
/**
 * The absolute, normalised path a profile is read from — and read again from on every `org update`, whatever the
 * working directory is then (§D3).
 *
 * A URL is refused: version 1 reads files only. A URL's path, not only its query, can be a bearer credential, so one
 * kept or shown would leak it, and fetching one is an outbound request the core does not make. The refusal names the
 * scheme and nothing else of it, for the same reason.
 */
export declare function profileSourcePath(given: unknown, env: NodeJS.ProcessEnv, cwd: string | undefined, platform: NodeJS.Platform): string;
/**
 * A profile's path as it is shown — in a preview, an error, a command's output: neutralised and on one line, as every
 * other string a person did not write themselves. The path is chosen by whoever named the file — a repository, a
 * message with an attachment — and its name is text like any other.
 */
export declare function shownPath(path: string): string;
/** A profile as it was read: from where, the SHA-256 of the exact bytes, and what they say. Never the bytes. */
interface ProfileFile {
  path: string;
  sha256: string;
  profile: OrganisationProfile;
}
/**
 * Reads a profile from an absolute path, in one bounded read: open once, check it is a regular file, read at most one
 * byte more than `PROFILE_MAX_BYTES` from the same handle. A path somebody typed can name a FIFO that never ends, a
 * device, a directory; none of them is a profile, and none may be how a command hangs. A symlink is followed: the path
 * is one the person chose.
 */
export declare function readProfileFile(path: string): Promise<ProfileFile>;
/** The organisation profiles this configuration records — none on version 1, which cannot hold them. */
export declare function organisationsOf(config: Config): Record<string, OrganisationRecord>;
export declare function recordOf(config: Config, organisation: string): OrganisationRecord | undefined;
/** The organisation a client row says owns it, if that organisation has a record here; otherwise none. */
export declare function managingOrganisation(config: Config, client: ClientConfig | undefined): string | null;
/**
 * How a generation's client row stands against the generation (§D4, §D8):
 *
 * - `ok` — the row is the generation's: for an owned one, marked with this organisation, the same client id, project
 *   and the canonical secret reference; for an adopted one, the same client id and held by no other organisation.
 * - `missing` — no row under its name.
 * - `unmarked` — owned, and its name holds a row of the same client with no organisation's mark: what an older release's
 *   `client add --replace` leaves, since it writes the row afresh and knows nothing of the mark. The same client, so it
 *   is marked again rather than counted as a reused name — which would make the organisation a second client of the
 *   one it already has.
 * - `name-reused` — owned, and its name now holds a row that is not this organisation's: another client with no mark,
 *   or a row another organisation has marked.
 * - `replaced` — owned, marked with this organisation, but holding another client id: row (c).
 * - `altered` — owned, marked, the same client id, but another project, provider or secret reference: rows (b), (e).
 * - `gone` — adopted, and the row now holds another client: the person replaced it.
 * - `held` — adopted, and another organisation has claimed the row since.
 */
type GenerationState = "ok" | "missing" | "unmarked" | "name-reused" | "replaced" | "altered" | "gone" | "held";
export declare function generationState(config: Config, organisation: string, generation: OrganisationGeneration): GenerationState;
/** The generation `gmail.active` names, if any. */
export declare function activeGeneration(record: OrganisationRecord | undefined): OrganisationGeneration | undefined;
/**
 * Returns the live client row for one organisation generation, or refuses the route (design 2026-10-02 §D6).
 *
 * A consent flow must never repair drift as it goes. The organisation operation is the one place that can restore a
 * missing owned row, its marker or its canonical secret reference, and can decide whether an adopted row is still
 * safe to use. Gmail therefore calls this one guard for every organisation generation it selects, both before
 * consent and when the flow completes.
 */
export declare function requireLiveOrganisationGeneration(config: Config, organisation: string, generation: OrganisationGeneration, platform?: NodeJS.Platform): ClientConfig;
/**
 * One way the configuration differs from what a profile approved, with what puts it right.
 *
 * `repair` — `org update <organisation>` brings it back to what was approved, at once and without asking (§D8: rows
 * (a), (b), (c), (e), and a stray mark). `report` — nothing here can rebuild it (row (d): a missing earlier generation,
 * whose secret only its old client file holds), or it is the person's own client and is theirs to change.
 */
interface OrganisationDrift {
  kind: "repair" | "report";
  /** The client name it is about. */
  client: string;
  /** Whether that is the generation new mailboxes get. */
  active: boolean;
  state: GenerationState | "stray-mark";
  detail: string;
  fix: string;
}
interface ProfileSlackTarget {
  organisation: string;
  role: "read" | "send";
  label: string;
  workspace: string;
  workspaceName: string;
  redirectPort: number;
  clientId: string;
  appId?: string | undefined;
  sha256: string;
}
/** Resolve one profile app to the exact, validated values a Slack sign-in snapshots. */
export declare function resolveProfileSlackTarget(config: Config, organisation: string, role: "read" | "send", platform?: NodeJS.Platform): ProfileSlackTarget;
/**
 * Learn the app id Slack returned only while the whole target still names the sign-in that produced it.
 *
 * The function is pure so the caller can put this change in the same locked config update as the account. A target
 * which already carries an id is never overwritten: whether the id came from the profile or an earlier sign-in, it
 * is the one this flow was required to reach.
 */
export declare function learnProfileSlackAppId(config: Config, expected: ProfileSlackTarget, appId: string, platform?: NodeJS.Platform): Config;
//#endregion
//#region src/operations/organisations.d.ts
/**
 * `agentcomms org add | list | show | update | remove` and `comms_org_add`, `comms_orgs_list`, `comms_org_show`,
 * `comms_org_update`, `comms_org_remove` — one operation each, both surfaces (design 2026-10-02 §D5, §D8, §D9).
 *
 * Adding, updating and removing a profile are changes through the one change flow (`gatedChange`): the first call
 * returns a preview whose effects are deterministic lines derived from the normalised profile — every value a person
 * should check, and never the client secret ("client secret: included", "secret changed") — and the call that brings
 * the approval back plans again from the file read again, so a profile that changed in between is another change and
 * refused. What applies is one transaction under the credentials lock: at most one secret, written by the
 * snapshot-and-restore procedure (`writeSecretWithRestore`), and one configuration update holding the client rows and
 * the `organisations` record, made only if nothing it was planned from moved meanwhile.
 *
 * An update that only repairs drift — bringing the configuration back to what was already approved — applies at once
 * and asks nobody, as does turning `--for-other-addresses` off; any change to the profile's contents, a new source, or
 * turning it on is approved first (§D8).
 */
interface OrgOptions {
  env: NodeJS.ProcessEnv;
  /** The shell every command in a result or refusal is quoted for. */
  platform: NodeJS.Platform;
  surface: ChangeSurface;
  /** Where a relative path is resolved from: the working directory of the command, by default. */
  cwd?: string | undefined;
  /** For a test: the keychain module probed when the keychain is chosen, so a test never touches the real one. */
  keyring?: KeyringModule | null | undefined;
  now?: (() => Date) | undefined;
}
interface OrgAddRequest {
  /** The profile file, as typed: absolute, relative to the working directory, or from `~`. */
  file: string;
  /**
   * The exact file a delegating channel already classified. Internal to that delegation: it prevents a path or
   * symlink swap from making the channel validate one profile and this operation plan another.
   */
  loadedProfile?: ProfileFile | undefined;
  /** Let the organisation's client serve the member's addresses outside it too (§D6). Off unless asked. */
  forOtherAddresses?: boolean | undefined;
  /** The client row to adopt when this profile's client id is registered here more than once. */
  adopt?: string | undefined;
  /** Where secrets go, the first time any is stored: `keychain` or `file`. */
  store?: string | undefined;
  /** The approval this call claims, when it claims one: read only to say so plainly when the profile changed since. */
  approvalId?: string | undefined;
}
interface GenerationView {
  name: string;
  clientId: string;
  projectId: string | null;
  ownership: "owned" | "adopted";
  serves: string;
  addedAt: string;
  active: boolean;
  state: GenerationState;
  mailboxes: string[];
}
/** One profile as `org list`, `org show` and every change's result show it: never its secret, never its bytes. */
interface OrganisationView {
  organisation: string;
  label: string;
  source: {
    kind: string;
    path: string;
  };
  sha256: string;
  readAt: string;
  addedAt: string;
  forOtherAddresses: boolean;
  /** False while `forOtherAddresses` is on with no active generation: it routes nothing until there is one. */
  routesOtherAddresses: boolean;
  gmail: {
    active: string | null;
    generations: GenerationView[];
  } | null;
  slack: {
    workspace: string;
    workspaceName: string;
    redirectPort: number;
    apps: {
      read: SlackAppView | null;
      send: SlackAppView | null;
    };
  } | null;
  /** Accounts connected through this organisation's apps. */
  accounts: string[];
  drift: OrganisationDrift[];
  notes: string[];
}
interface SlackAppView {
  clientId: string;
  appId: string | null;
}
interface OrgChangeResult {
  organisation: string;
  /** False when nothing needed writing. */
  changed: boolean;
  /** What was done, one line each: what changed, what was repaired. */
  applied: string[];
  /** What was found and not changed: earlier clients that cannot be rebuilt, clients that are the person's own. */
  reported: string[];
  gmail: {
    action: GmailAction | null;
    client: string | null;
  };
  /** The store a client secret was written to, when one was. */
  store: StoreKind | null;
  profile: OrganisationView;
}
type GmailAction = "created" | "adopted" | "reactivated" | "kept" | "removed";
/**
 * `agentcomms org add <file>` and `comms_org_add`: adding an organisation's profile, as one approved change (§D5).
 *
 * Refused on a version-1 configuration, for a profile that is not valid, for an organisation already added (`org
 * update` is the way), and for an ambiguous adoption. An account of the organisation already connected to its Slack
 * workspace through an app of the person's own is reported, and left exactly as it is.
 */
export declare function orgAddChange(core: Core, request: OrgAddRequest, options: OrgOptions): GatedChange<OrgChangeResult>;
//#endregion
//#region src/operations/servers.d.ts
interface ServerInstallRequest {
  channel: Channel;
  client: SupportedClient;
  name?: string | undefined;
  /**
   * The pin, for any channel: serve one account, by its name `organisation/<channel>` (design 2026-09-26). Every
   * channel after Gmail and Slack is pinned this way; for those two it is the same as `inbox` and `workspace`, which
   * stay, so their entries, tools and skills work as they did.
   */
  account?: string | undefined;
  /** Gmail's pin: serve one mailbox. The same as `account` for Gmail. */
  inbox?: string | undefined;
  /** Slack's pin: serve one workspace. The same as `account` for Slack. */
  workspace?: string | undefined;
  /** Gmail only: leave out every tool that changes a mailbox. */
  readOnly?: boolean | undefined;
  launcher?: Launcher | undefined;
  force?: boolean | undefined;
  /** Only print the entry: nothing is written, and nothing is asked. */
  print?: boolean | undefined;
  noVerify?: boolean | undefined;
}
type ServerInstallResult = InstallResult & {
  /** What the person has to do before the server's tools appear, or null when nothing was registered. */
  restart: string | null;
};
/**
 * Registering one channel's server with one client, as a change.
 *
 * The effects are what a person is agreeing to, one sentence each, and everything that decides what the server may
 * reach is in them — which server, which client, under which name, pinned to what, replacing what, started how. The
 * approval is bound to those sentences, so a second call that differs in any of them is a different change and is
 * refused. What `installTarget` says will only be printed has no effect and asks nobody; a managed runtime not yet on
 * this machine is fetched from npm, which is said too.
 *
 * `own` is the calling channel's product, from its own `mcp install`: see `ownProduct`. The sentences depend on the
 * request and the machine, not on which surface prepared them, so an approval prepared by one is claimed by the
 * other. The sentences that name code name it as this environment resolves it: the client's config file and the node
 * or npx the entry starts (#46), and for `--launcher local` the checkout's file. A claim from an environment that
 * resolves another — `CLAUDE_CONFIG_DIR` set to another account's, a PATH that finds another node, a core running
 * from another build of the checkout — is another registration, refused as one.
 */
export declare function serverInstallChange(core: Core, env: NodeJS.ProcessEnv, request: ServerInstallRequest, own?: McpProduct): GatedChange<ServerInstallResult>;
interface ServerPruneRequest {
  channel: Channel;
  dryRun?: boolean | undefined;
  includePrinted?: boolean | undefined;
  /** For a test: the command lines of the running processes, or null when they cannot be listed. */
  processes?: (() => Promise<readonly string[] | null>) | undefined;
}
/**
 * Removing a channel's unused managed runtimes, as a change.
 *
 * A dry run is free: it removes nothing. Otherwise the plan is that same dry run, and each runtime it would remove is
 * one effect — the removal cannot be taken back — so the approval is bound to exactly that list; and the removal is
 * then restricted to it (`only`), so a runtime that became unused after the list was shown stays.
 *
 * `own` is the calling channel's product, from its own `mcp prune`, so the runtime kept as "this release" is the
 * release of the command that was run; checked to be that channel's, as for an install.
 */
export declare function serverPruneChange(core: Core, env: NodeJS.ProcessEnv, request: ServerPruneRequest, own?: Pick<McpProduct, "packageName" | "version">): GatedChange<PruneResult>;
//#endregion
//#region src/update-state.d.ts
/**
 * The daily update check, as every server and command reads it (design 2026-09-28): one file per machine,
 * `update-check.json` in the state directory, saying when the registry was last asked, the latest release it named,
 * whether this machine's registrations were behind it, and any "not now" with when it runs out.
 *
 * This is the reader, and it has **no network code at all**: it reads and writes that file, and says what it means.
 * Asking the registry is the checker's (`update-check.ts`), which every server and command but WhatsApp's also
 * imports. WhatsApp's package promises it reaches no network — `packages/whatsapp/test/no-network.test.ts` holds it to
 * that — so it imports only this, and learns of an update once any other server or command on the machine has asked.
 */
/** The file, in the state directory: one per machine, shared by every server and command on it. */
export declare const UPDATE_CHECK_FILE = "update-check.json";
/**
 * The switch that turns the whole thing off for one process — no check, no stop — whatever the setting says. Every
 * test harness and every script here that runs a command or a server sets it, so no test and no verify step asks the
 * real registry.
 */
export declare const UPDATE_CHECK_ENV: "AGENT_COMMS_UPDATE_CHECK";
/**
 * Set by what starts a server from a release it pins itself — the Claude Code plugin's launcher, the Gemini
 * extension's manifest — to say so: `claude-code-plugin`, `gemini-extension`. No registration here names that server,
 * and `comms_update` never moves it; it changes when the plugin or the extension is updated. So its stop always says
 * "update", whatever the channel's registrations say: restarting would start the release the plugin pins.
 */
export declare const UPDATE_STARTED_BY_ENV: "AGENT_COMMS_STARTED_BY";
/** How long a check is good for: the registry is asked at most once in this long, by the whole machine. */
export declare const UPDATE_CHECK_INTERVAL_MS: number;
/** What the stop says first, word for word: the owner's words. */
export declare const UPDATE_FIRST = "Hang on a minute, there's an update. Let's update first.";
export interface UpdateCheckRecord {
  /**
   * When the registry was last asked, as an ISO time, written once the ask is over — whether or not it answered. A
   * failed ask counts: a machine that is offline would otherwise ask again on every command, and a command at a
   * terminal waits for it.
   */
  lastChecked: string | null;
  /** The latest release the registry last named: the `latest` dist-tag of `@agentcomms/core`. */
  latest: string | null;
  /**
   * Whether anything on this machine — a registration, a runtime, a global package — was behind `latest` at that
   * check, as `comms_update` with `check` finds it: the machine as a whole. `null` when it is not known — a client's
   * configuration or the global packages could not be read, or a registration pins no release to compare.
   */
  behind: boolean | null;
  /**
   * Where this machine is known to run `latest`, channel by channel, as that check found it: what tells "updated but
   * not restarted" apart from "not updated" (§1). Null when that check found out neither.
   */
  current: UpdateCurrent | null;
  /** Why the last ask got no answer, when it got none. Kept for the doctor; nothing is stopped on its account. */
  lastError: string | null;
  /** A person's "not now": nothing stops until this ISO time, the local midnight after they said it. */
  snoozedUntil: string | null;
  /**
   * A check under way: when a process claimed it. Nobody else asks while it is younger than `UPDATE_CHECK_LEASE_MS`.
   * `lastChecked` is written only once the ask is over, so an ask that never finished — a command the person
   * interrupted, a server whose client closed it part-way — does not use up the day: its claim runs out, and the next
   * process asks.
   */
  checking: string | null;
}
/**
 * The channels whose `latest` this machine runs, by the way each is started. Each is a positive finding: a channel
 * the scan could not see, or saw registered with no release pinned, is in neither.
 */
export interface UpdateCurrent {
  /**
   * Every registration of the channel's server pins `latest` — at least one does, none pins an older release or none
   * at all, and every client's configuration was read. A server of one of these that is older was started before it
   * was registered again, and restarting the client starts `latest`.
   */
  registered: string[];
  /** The channel's package is installed globally at `latest`: its command, run again from there, is `latest`. */
  global: string[];
}
export declare const EMPTY_UPDATE_CHECK: Readonly<UpdateCheckRecord>;
export declare function updateCheckPath(stateDir: string): string;
/**
 * The record as the file holds it, each field checked on its own: one that is missing or not what it should be reads
 * as not known. A file that is missing, unreadable or not JSON is an empty record — never a reason to stop anything.
 */
export declare function readUpdateCheck(stateDir: string): Promise<UpdateCheckRecord>;
/**
 * Reads the record, changes it and writes it back, under a lock beside it, atomically — so a server recording a check
 * and a person's "not now" arriving at the same moment each keep what the other wrote. Returns what `change` returned
 * alongside the record written; `change` returning `null` writes nothing.
 */
export declare function changeUpdateCheck<T = void>(stateDir: string, change: (record: UpdateCheckRecord) => {
  record: UpdateCheckRecord;
  result?: T;
} | null): Promise<{
  record: UpdateCheckRecord;
  result: T | undefined;
  written: boolean;
}>;
/**
 * Whether the check is due: never asked, asked a day or more ago, or — a clock that went back — asked more than a few
 * minutes in the future. A few minutes are allowed for, because two processes' clocks are read at slightly different
 * moments, and a check just claimed by one must not look due to the other.
 */
export declare function updateCheckDue(record: UpdateCheckRecord, now: Date): boolean;
/**
 * How long a claimed check keeps others from asking: longer than the longest a check takes — the registry's ten
 * seconds, `npm ls`'s minute — so two processes never ask at once, and short enough that one whose process ended
 * part-way holds nobody up for long.
 */
export declare const UPDATE_CHECK_LEASE_MS: number;
/** Whether another process is asking the registry now: it claimed the check less than a lease ago. */
export declare function updateCheckUnderway(record: UpdateCheckRecord, now: Date): boolean;
/** What turned the check off for this process, from its environment: `CI`, or the switch. Null when neither did. */
export declare function updateCheckSwitchedOff(env: NodeJS.ProcessEnv): "CI" | typeof UPDATE_CHECK_ENV | null;
/** Whether a check may run at all, and if not, what turned it off: the environment first, then the machine's setting. */
export declare function updateCheckEnabled(core: Core, env: NodeJS.ProcessEnv): Promise<{
  on: true;
} | {
  on: false;
  by: "CI" | typeof UPDATE_CHECK_ENV | "setting";
}>;
/** The start of the next local day: when a "not now" runs out. */
export declare function nextLocalMidnight(now: Date): Date;
/** A local time as a person reads it in a preview: `2026-09-29 00:00`. */
export declare function localStamp(at: Date): string;
/** Whether a person's "not now" still holds. */
export declare function updateSnoozed(record: UpdateCheckRecord, now: Date): boolean;
/**
 * The latest release as the check counts it: a version, and not a prerelease — 0.8.0-rc.1 is never an update anybody
 * is stopped for. Null when the file names none.
 */
export declare function countedLatest(record: UpdateCheckRecord): string | null;
/** What a process is, for the verdict: a channel's server, which a client starts, or its command, which a person runs. */
export interface UpdateSurface {
  /** Whose server or command it is: `core`, `gmail`, `whatsapp`. */
  channel: string;
  /** `server`: an MCP server, started from its registrations. `command`: a CLI, started from wherever it is installed. */
  surface: "server" | "command";
}
/** An update that stops a server or a command running `running`. */
export interface PendingUpdate {
  /**
   * `update`: a newer release is out, and this process is not known to have it anywhere to restart into. `restart`:
   * the check found it installed where this process starts from — every registration of this server, or this
   * command's global package, is at `latest` — and this process simply started before it was.
   */
  kind: "update" | "restart";
  running: string;
  latest: string;
}
/**
 * What the record means for a process running `running`, ignoring any "not now": null when there is nothing newer.
 *
 * `restart` only on the check's positive finding about this very server or command (`current`): a server whose every
 * registration names `latest`, or a command whose package is installed globally at `latest`. Anything else — no
 * registration the scan could see (a plugin's, an extension's, one written by hand), one that pins no release, a
 * configuration it could not read, a check that found out nothing — is `update`: restarting would start the same old
 * code, and a reply that said to restart would stop every call with advice that cannot work.
 */
export declare function updateVerdict(record: UpdateCheckRecord, running: string, where: UpdateSurface): PendingUpdate | null;
/**
 * The update that stops this process now, from the file as it is — or null: switched off, snoozed, or nothing newer.
 * Reads two files and asks nobody.
 *
 * "Restart" is decided per channel, from its registrations, and a server a plugin or an extension started is not one
 * of them (`UPDATE_STARTED_BY_ENV`): beside a registration the update moved, it was told to restart every day, and
 * restarting started the release the plugin pins. It is told to update.
 */
export declare function pendingUpdate(options: UpdateSurface & {
  core: Core;
  env: NodeJS.ProcessEnv;
  running: string;
  now?: (() => Date) | undefined;
}): Promise<PendingUpdate | null>;
/**
 * The two ways on, as a tool call and as a command — and the command through npx, for a machine with no `agentcomms`
 * installed: one that runs only a plugin's server, say, has neither the core server nor the command.
 */
export declare const UPDATE_WAYS: {
  readonly update: {
    readonly tool: "comms_update";
    readonly command: string;
    readonly npx: string;
  };
  readonly later: {
    readonly tool: "comms_update";
    readonly arguments: {
      readonly later: true;
    };
    readonly command: string;
    readonly npx: string;
  };
};
/**
 * What a stopped tool call says, in words an agent passes on: the owner's sentence first, then the versions, then the
 * two ways on — the update, from chat or a terminal, or "not now", which the person approves like any other change.
 */
export declare function updateStopMessage(pending: PendingUpdate, where: {
  server: string;
  tool: string;
}): string;
//#endregion
//#region src/operations/update.d.ts
/**
 * What an update does outside this process, each replaceable: a test hands in stand-ins, and nothing it runs reads
 * the real registry, lists the machine's global packages, or installs anything.
 */
interface UpdateDeps {
  /** The version the registry's `latest` dist-tag names. Defaults to npm's registry, with a timeout. */
  latestVersion?: ((packageName: string) => Promise<string>) | undefined;
  /** This suite's packages installed globally, by name. Defaults to `npm ls --global --depth=0 --json`. */
  globalPackages?: (() => Promise<Record<string, string>>) | undefined;
  /** `npm install --global <spec>`. */
  installGlobal?: ((spec: string) => Promise<void>) | undefined;
  /** Installs a managed runtime of exactly this version, as the managed launcher would. */
  installRuntime?: ((packageName: string, version: string) => Promise<void>) | undefined;
  /** The clock a check or an update is recorded by in the daily check's file. */
  now?: (() => Date) | undefined;
  /** The shell the commands it prints are quoted for: this machine's, unless a test asks for another by name. */
  platform?: NodeJS.Platform | undefined;
}
interface UpdateRequest {
  /** Do not start each server registered again to check that it answers. */
  noVerify?: boolean | undefined;
}
/** One client's registration of one channel's server. */
interface RegistrationItem {
  kind: "registration";
  channel: Channel;
  /** The package the entry starts: the channel's, or for Gmail started through npx, `@agentcomms/gmail-mcp`. */
  package: string;
  client: string;
  name: string;
  scope: "user" | "project";
  /** The config file it is in. */
  path: string;
  launcher: Launcher | "other";
  /** The version the entry pins; null for one that pins none. */
  version: string | null;
  latest: string;
  /** Its pin and `--read-only`, as `mcp install` writes them. An update keeps exactly these. */
  narrowing: string[];
  /** On an entry that is behind: whether the update can register it again from here. */
  updatable?: boolean | undefined;
  /** Why not, and what a person can do instead; or, for one that pins nothing, why it is not compared. */
  reason?: string | undefined;
}
/** The managed runtime of one package at the latest release: behind when a registration the update moves needs it. */
interface RuntimeItem {
  kind: "runtime";
  channel: Channel;
  package: string;
  /** The newest runtime of this package on disk, or null when there is none. */
  version: string | null;
  latest: string;
  /** Where the latest release's runtime is, or will be installed. */
  path: string;
}
/** A package of this suite installed globally with npm. */
interface GlobalItem {
  kind: "global";
  package: string;
  version: string;
  latest: string;
}
type UpdateItem = RegistrationItem | RuntimeItem | GlobalItem;
interface UpdateReport {
  /** The version of the core answering. */
  core: string;
  /** The latest release of each package, as the registry names it. */
  latest: Record<string, string>;
  behind: UpdateItem[];
  upToDate: UpdateItem[];
  /** Registrations that pin no version — a checkout's own code, or an entry written by hand — so are not compared. */
  unpinned: RegistrationItem[];
  /** Client configs, and the global package list, that could not be read: what they hold is not known. */
  unreadable: UnreadableConfig[];
}
type UpdateStep = {
  kind: "runtime";
  channel: Channel;
  package: string;
  version: string;
  path: string;
  outcome: "installed" | "failed";
  detail?: string | undefined;
} | {
  kind: "registration";
  channel: Channel;
  client: string;
  name: string;
  scope: "user";
  path: string;
  launcher: Launcher;
  from: string;
  to: string;
  narrowing: string[];
  outcome: "registered" | "failed" | "skipped";
  /** Whether the new entry was started and answered, as `mcp install` checks it. */
  verification?: InstallResult["verification"] | undefined;
  detail?: string | undefined;
  /** Where the entry it replaced was saved. */
  backupPath?: string | undefined;
  warnings?: string[] | undefined;
} | {
  kind: "global";
  package: string;
  from: string;
  to: string;
  outcome: "updated" | "failed";
  detail?: string | undefined;
};
interface UpdateResult {
  /**
   * `up-to-date`: nothing was behind. `updated`: every step worked. `failed`: at least one did not — each step says
   * which. `manual`: something is behind that only a person can bring up to date; `manual` says what and how.
   */
  status: "up-to-date" | "updated" | "failed" | "manual";
  latest: Record<string, string>;
  /** What was done, in the order it was done, each with how it went. */
  steps: UpdateStep[];
  /** Behind, and left for a person, each with why. */
  manual: RegistrationItem[];
  /** No step failed. */
  ok: boolean;
  /** What the person does next: restart the clients, then prune the old runtimes. Null when nothing was registered. */
  next: string | null;
}
/**
 * The update, as a change: one approval for every step, applied in order on the second call.
 *
 * `plan` reads everything again on both calls — the registry, the clients, the runtimes, the global packages — so the
 * steps claimed are the steps as they would be taken at that moment, and a claim for any other list is refused.
 */
export declare function updateChange(core: Core, env: NodeJS.ProcessEnv, request?: UpdateRequest, deps?: UpdateDeps): GatedChange<UpdateResult>;
//#endregion
//#region src/operations/update-settings.d.ts
/**
 * The daily update check's two settings, from a terminal (`agentcomms update --later`, `--auto on|off`) or a chat
 * (`comms_update` with `later` or `auto`): "not now", and the check itself on or off (design 2026-09-28 §2, §4).
 *
 * Both are changes a person approves, through the one flow every change goes through. "Not now" is the person's
 * decision, not the agent's: were it a free switch, an agent could clear the stop without asking and the stop would
 * do nothing. It is an effect — it writes the state file, not the configuration — so the approval binds its sentence,
 * the release and the midnight included. Turning the check off is a loosening of `defaults.updateCheck`, which
 * `ConfigStore.update` refuses without the person's consent; turning it on tightens, and applies at once.
 *
 * Neither reads the registry: they are the reader's, so WhatsApp's command can offer "later" with no network code.
 */
interface UpdateLaterResult {
  /** When the stop comes back: the local midnight after the person said not now. Null when there was nothing to do. */
  snoozedUntil: string | null;
  /** The release put off, as the last check named it; null when no check has named one. */
  latest: string | null;
  /** False when it was already put off until then, and nothing was written. */
  changed: boolean;
}
/**
 * "Not now": no server or command on this machine stops for the update until the next local midnight.
 *
 * `plan` reads the file on both calls, so a claim made after midnight — a different midnight in the sentence — or
 * for a newer release is a different change, and refused.
 */
export declare function updateLaterChange(core: Core, options?: {
  now?: (() => Date) | undefined;
}): GatedChange<UpdateLaterResult>;
interface UpdateAutoResult {
  /** The machine's setting now. */
  updateCheck: UpdateCheckSetting;
  /** False when it already was, and nothing was written. */
  changed: boolean;
}
/** The daily update check on or off for this machine, in `config.json`: off is a loosening, on applies at once. */
export declare function updateAutoChange(core: Core, setting: UpdateCheckSetting): GatedChange<UpdateAutoResult>;
//#endregion
//#region src/other-servers.d.ts
/**
 * Other MCP servers for the same service, registered on this machine, which send with no approval step.
 *
 * Everything this suite does about approval assumes it is the only route to Gmail's send endpoints and to Slack's
 * posting methods. Another server with its own send tools does not break that so much as stand beside it: an agent
 * uses whichever tool it finds. So registering a server says what else is there, and `doctor` does too.
 *
 * These lived in the Gmail and Slack packages, and only their own `mcp install` warned; registering the same server
 * from chat — the core server's `comms_server_install`, which builds the product from `CHANNEL_SERVERS` and cannot
 * import a channel package — said nothing about the very servers the warning exists for. They are facts about
 * the services rather than about either package's code, so each channel declares them in its manifest (`rivals`),
 * and the detectors here read them from core's snapshot: every surface that registers a server warns the same way,
 * and a new channel warns about its own rivals by declaring them.
 */
export interface LegacyServerFinding extends RegisteredServer {
  /** The npm package that makes this a finding; `name` stays the client's own name for the entry. */
  packageName: string;
  /** Why it is a problem, in one sentence. */
  reason: string;
  removal: string;
}
/**
 * Registered servers that are one of `packages` — another server for the same service whose send tools no approval
 * step gates — each with why it matters and how to remove it. `platform` is the shell the removal is quoted for.
 */
export declare function findRivalPackageServers(servers: readonly RegisteredServer[], packages: readonly ChannelRivalPackage[], platform?: NodeJS.Platform): LegacyServerFinding[];
/** What registering a server says about the rival packages its manifest names: one line each. */
export declare function rivalPackageWarnings(servers: readonly RegisteredServer[], packages: readonly ChannelRivalPackage[], platform?: NodeJS.Platform): string[];
/** Registered servers known to send mail with no approval step, each with why it matters and how to remove it. */
export declare function findUngatedGmailServers(servers: readonly RegisteredServer[], platform?: NodeJS.Platform): LegacyServerFinding[];
/** What registering the Gmail server says about them: one line each. */
export declare function gmailServerWarnings(servers: readonly RegisteredServer[]): string[];
/**
 * Other Slack MCP servers registered on this machine.
 *
 * A `read` token of ours cannot post whatever else is installed — but that was never the point. Another Slack server
 * posts with its own token — `@modelcontextprotocol/server-slack` with a bot token in its env, the official one at
 * `mcp.slack.com` — and an agent uses whichever tool it finds.
 *
 * Matched on the word rather than on a list of packages. There are at least half a dozen such servers and more
 * each month, and a list is out of date the day it is written; a false "also registered" costs a glance, a
 * missed one costs the guarantee. The client's own `url` is read too, because the official server has nothing
 * else to match. What stays invisible is anything that does not say "slack" at all — a bridge that relays to
 * several services — and anything a client gets from somewhere other than its config file.
 */
export declare function findOtherSlackServers(servers: readonly RegisteredServer[], product: Pick<McpProduct, "packageName" | "npxPackage" | "entryFiles" | "binary" | "bins">): RegisteredServer[];
/**
 * Registered servers that name the service's `word` anywhere — their name, command, arguments or URL — and are not
 * `product` itself: a channel's `rivals.word`, for a service with too many other servers to list.
 */
export declare function findRivalWordServers(servers: readonly RegisteredServer[], word: string, product: Pick<McpProduct, "packageName" | "npxPackage" | "entryFiles" | "binary" | "bins">): RegisteredServer[];
/**
 * One line naming a server: its name, client and what it runs — never its arguments or env, which may carry a
 * token, and of a URL only its host and path. A remote server's URL is often the credential itself, and this
 * line goes into `doctor --json`, which the skills tell agents to run.
 */
export declare function describeOtherSlackServer(server: RegisteredServer): string;
/** How to remove another Slack server, in the client's own terms. `platform` is the shell it is quoted for. */
export declare function otherSlackServerRemoval(server: RegisteredServer, platform?: NodeJS.Platform): string;
/** What registering the Slack server says about them: one line each. */
export declare function slackServerWarnings(servers: readonly RegisteredServer[], product: Pick<McpProduct, "packageName" | "npxPackage" | "entryFiles" | "binary" | "bins">): string[];
/** What registering a server says about the servers its manifest's `rivals.word` finds: one line each. */
export declare function rivalWordWarnings(servers: readonly RegisteredServer[], word: string, can: string, product: Pick<McpProduct, "packageName" | "npxPackage" | "entryFiles" | "binary" | "bins">): string[];
//#endregion
//#region src/output.d.ts
/** Version of the JSON envelope shape. Bump only on a breaking change to `ok`, `data` or `error`. */
export declare const SCHEMA_VERSION = 1;
export interface OkEnvelope<T> {
  ok: true;
  schemaVersion: typeof SCHEMA_VERSION;
  data: T;
}
export interface ErrorEnvelope {
  ok: false;
  schemaVersion: typeof SCHEMA_VERSION;
  error: {
    code: string;
    message: string;
    hint?: string;
    details?: Record<string, unknown>;
  };
}
export type Envelope<T> = OkEnvelope<T> | ErrorEnvelope;
export declare function okEnvelope<T>(data: T): OkEnvelope<T>;
export declare function errorEnvelope(error: CommsError): ErrorEnvelope;
//#endregion
//#region src/reconcile.d.ts
/**
 * What to do with a credential after the config write that should have named it was rejected.
 *
 * A rejection does not mean nothing was written. `ConfigStore.update` commits atomically and *then* releases its lock
 * in a `finally`, and if that release throws the call rejects with the write already in. Deleting the credential
 * then deletes the one the configuration now names — a sign-in that worked, turned into an account with no token.
 * So every caller reads the configuration again first and asks one question: does it name this credential?
 *
 * - `present`: the write landed. Keep the credential; the operation succeeded.
 * - `absent`: it did not. Withdraw the credential, and say so if that fails.
 * - `unknown`: the configuration cannot be read. Keep the credential and say which one may be left behind — never
 *   treat an unreadable file as proof of absence, because the cost of being wrong is a live credential deleted.
 *
 * The Slack package reasoned this through first; these are its rules, shared.
 */
export type WriteOutcome = "present" | "absent" | "unknown";
export declare function writeOutcome(check: () => Promise<boolean>): Promise<WriteOutcome>;
/** The original error, with the credential it may have left behind named — and deliberately not deleted. */
export declare function keepAndReport(original: unknown, ref: string, howToCheck: string): CommsError;
/**
 * Takes back a credential stored for an attempt that then failed, and says so if it cannot.
 *
 * One retry, because a keychain prompt dismissed by accident is common and a second chance is cheap; if that fails
 * too, the original error comes back **with the stranded reference attached**, so the leak is something a person is
 * told about rather than something they would have to know to look for. A `false` from `delete` is not a failure:
 * nothing was stored, so there is nothing to take back.
 */
export declare function withdrawStaged(secrets: SecretStore, ref: string, original: unknown): Promise<unknown>;
//#endregion
//#region src/operations/maintenance.d.ts
interface DoctorCheck {
  name: string;
  ok: boolean;
  /**
   * Something to look at rather than a failure: a channel with accounts that no client starts, a client config that
   * cannot be read. `ok` stays true, and so does the report's — a doctor that failed on a machine used only from a
   * terminal would be failing on nothing. Present only on such a check, so every other reads as it always did.
   */
  warn?: true;
  detail: string;
  fix?: string;
}
interface DoctorReport {
  checks: DoctorCheck[];
  ok: boolean;
}
//#endregion
//#region src/render.d.ts
/** Makes every control and invisible character visible as `<U+XXXX>`. Newlines and tabs are kept; CRLF becomes LF. */
export declare function escapeForDisplay(text: string): string;
/** Escapes, flattens to one line, and cuts to `width` characters — for names and file names in fixed columns. */
export declare function truncateDisplay(text: string, width: number): string;
/** A Markdown code fence longer than any backtick run inside `body`, so the body cannot close it. */
export declare function fenceFor(body: string): string;
/** The body as it goes into a chat preview: escaped and fenced. */
export declare function renderFencedBody(body: string, info?: string): string;
export interface PreviewRecipients {
  from: string;
  to: string[];
  cc: string[];
  bcc: string[];
  /**
   * Where replies would go, when that is not the From address.
   *
   * Bound by the digest and previously invisible: a draft carrying `Reply-To: someone@else.test` previewed exactly
   * like one without, so a person could approve a message every answer to which goes somewhere they were never
   * told about.
   */
  replyTo?: string[] | undefined;
}
export interface PreviewAttachment {
  filename: string;
  size: number;
  mimeType: string;
  /**
   * The SHA-256 of the bytes that will leave, when the approval is bound to it. A channel preview sets it for every
   * file: the hash is what makes "these files" one set of bytes rather than whatever carries these names at send time.
   */
  sha256?: string | undefined;
  /** Where the file is read from on this machine, when it is a local file, so the person can see which one it is. */
  path?: string | undefined;
}
export interface MessagePreview {
  recipients: PreviewRecipients;
  subject: string;
  body: string;
  attachments?: PreviewAttachment[] | undefined;
  /** Shown above the preview: the mailbox, the draft, whether anything has been sent. */
  context?: {
    inbox?: string | undefined;
    draftId?: string | undefined;
    approvalId?: string | undefined;
    note?: string | undefined;
  } | undefined;
  /**
   * What is known about each recipient, keyed by the address as it appears in the list — "EXTERNAL · FIRST-TIME",
   * "14 earlier messages". The reader is deciding who this goes to, and an address alone rarely says enough.
   */
  recipientNotes?: Record<string, string> | undefined;
  /** Where the conversation stands: "reply-all to Sam, 17 Sep 16:02 (6 messages)". */
  thread?: string | undefined;
  /** Every link in the message, with its full query string: a shortener or a tracker is only visible in full. */
  links?: string[] | undefined;
  /** The last line: what has to happen before this can be sent, in the reader's own terms. */
  policy?: string | undefined;
  /** Facts worth seeing before approving: a first-time recipient, an external domain, a link. */
  warnings?: string[] | undefined;
}
/**
 * The preview of a message about to be written or sent, rendered the same way everywhere: chat, terminal, an
 * approval form.
 *
 * Three things it does deliberately. The body is **fenced with a fence longer than any backtick run inside it**, so
 * a message containing ``` cannot break out and impersonate the lines around it. Every control and invisible
 * character is shown as `<U+XXXX>`, so an ESC sequence cannot repaint a terminal and a bidi override cannot reverse
 * an address. And the recipients are **repeated after the body**, because a long message pushes the To line off the
 * screen, and the recipients are the one thing the reader is actually approving.
 */
export declare function renderMessagePreview(preview: MessagePreview): string;
/** Who a channel message will notify, resolved to real people rather than left as syntax. */
export interface PreviewNotifies {
  /** `@here` — members currently online. */
  here: boolean;
  /** `@channel` — every member, online or not. */
  channel: boolean;
  /** Individually mentioned people, already resolved to display names. */
  users: string[];
  /**
   * How many people the above actually reaches.
   *
   * The number is the point. "@channel" is four characters whether the room holds three people or four hundred, and
   * a person approving the four-hundred case is agreeing to something quite different. A mail preview lists its
   * recipients and the reader counts them; a channel preview has to do the counting.
   */
  estimated: number;
  /** Set when the count could not be resolved — an unreadable member list, a rate limit. Never guessed at. */
  unknown?: string | undefined;
}
export interface ChannelPreview {
  workspace: string;
  /**
   * Who this will be posted as, as a person should read it: `Acme Bot (U024BE7LH)`.
   *
   * The channel counterpart of the `From:` line, and shown for the same reason — it is recipient-visible, and an
   * approver who is not told which of their connected accounts is speaking has not been shown the message.
   */
  postingAs: string;
  /** `#engineering`, or a person's name for a direct message. */
  channel: string;
  /** Set when this is a reply inside a thread: "in reply to Sam, 17 Sep 16:02 (6 replies)". */
  thread?: string | undefined;
  /** The text as the client will render it, not the payload that produces it. */
  body: string;
  notifies: PreviewNotifies;
  attachments?: PreviewAttachment[] | undefined;
  context?: {
    workspace?: string | undefined;
    draftId?: string | undefined;
    approvalId?: string | undefined;
    note?: string | undefined;
  } | undefined;
  /** Every link, with its query string: a shortener or a tracker is only visible in full. */
  links?: string[] | undefined;
  /** The last line: what has to happen before this can be posted. */
  policy?: string | undefined;
  warnings?: string[] | undefined;
}
export declare function describeNotifies(notifies: PreviewNotifies): string;
/**
 * A byte count as a person reads it.
 *
 * Here, beside the rest of what formats a value for a person, since the channel preview wants it as well as the
 * download question — and `save-destination.ts` already imports from here.
 */
export declare function sizeOf(bytes: number): string;
/**
 * A file's size as a person checks it against a file they know: `sizeOf`'s figure, with the exact count beside it
 * above a kilobyte — `47 bytes`, `10.0 MB (10,485,761 bytes)`. Grouped the same way on every machine, whatever its
 * locale.
 */
export declare function describeSize(bytes: number): string;
/**
 * The channel equivalent of `renderMessagePreview`, and deliberately the same shape: a person approving a post
 * should not have to learn a second layout.
 *
 * The difference is what sits where the recipients do. Mail names the people it goes to; a channel message names
 * one room, and the question a person actually needs answered is how far it carries. So the notification line takes
 * the position the recipient list occupies for mail — including the repeat below the body, for the same reason a
 * long message scrolls the header out of view.
 */
export declare function renderChannelPreview(preview: ChannelPreview): string;
/**
 * What an MCP install did, or would do.
 *
 * Here rather than in either package: the result shape is `@agentcomms/core`'s, so a second renderer would be a
 * second place for the same words to drift. Gmail re-exports it under its old name so nothing that imported it
 * has to change.
 */
export declare function renderInstall(result: InstallResult, color: boolean): string;
/**
 * What `agentcomms doctor` prints: one line a check — `ok`, `warn` or `FAIL` — and the fix under any that has one.
 *
 * Here rather than inside the command, so a test can read the lines a person reads: the command itself probes the
 * login keychain, which no test may touch.
 */
export declare function renderDoctor(report: DoctorReport): string;
/** What `mcp prune` removed and kept, and why each one it kept is still needed. */
export declare function renderPrune(result: PruneResult, color: boolean): string;
export declare function renderUpdateCheck(report: UpdateReport): string;
export declare function renderUpdate(result: UpdateResult, color: boolean): string;
//#endregion
//#region src/sanitize.d.ts
export type LinkFlag = "text-domain-mismatch" | "punycode" | "ip-literal" | "shortener" | "non-http" | "unparseable";
export interface SanitizedLink {
  text: string;
  domain: string | null;
  flags: LinkFlag[];
}
export interface SanitizeReport {
  /** Elements removed because a reader would not see them (hidden by style, attribute or stylesheet). */
  hiddenElements: number;
  /** Characters of text inside those elements. */
  hiddenChars: number;
  /** Elements whose text colour matches their background colour — flagged, not removed. */
  sameColorElements: number;
  /** Zero-width, bidi-control and Unicode tag characters stripped from the text. */
  invisibleCharsRemoved: number;
  /**
   * Chat-template control tokens and role markers that were defused.
   *
   * Computed and then thrown away, which was the opposite of how hidden text and unreadable CSS rules are handled
   * two functions over: a message that tried a template injection was quietly disarmed and nobody was told. Not
   * zero means somebody was trying.
   */
  tokensNeutralised: number;
  links: SanitizedLink[];
  imagesNotLoaded: number;
  /**
   * Hiding rules in a stylesheet that this parser could not apply to any element.
   *
   * Not zero means some text a mail client would have hidden is still in `text`. It is reported rather than guessed
   * at, because the two ways of guessing are both bad: applying such a rule to every element of a tag would gut a
   * legitimate message, and ignoring it silently is how hidden text reaches a model unannounced.
   */
  unreadableHidingRules: number;
}
export interface SanitizedText {
  text: string;
  report: SanitizeReport;
}
/**
 * An alpha or opacity value as a number in 0–1: `0`, `0%`, `.04`, or a `calc()` this can evaluate.
 *
 * `Number('0%')` is `NaN`, which read as "not transparent" and let `opacity: 0%` — valid in every Chromium-based
 * mail client — hide text the sanitiser then handed to the model. `calc()` was the same gap wearing an expression:
 * anything unevaluated defaulted to opaque, so `calc(0 * 1)` hid text invisibly. Simple arithmetic is evaluated
 * here; anything more complicated still reads as opaque, because guessing the other way removes text a reader can
 * see.
 */
export declare function alphaValue(raw: string | undefined): number | null;
/**
 * Whether a declaration hides the element through a custom property this cannot resolve.
 *
 * `<style>:root{--h:none}</style><div style="display:var(--h)">…</div>` renders as hidden in Gmail, Outlook 365 and
 * Apple Mail, and read as a plain string `display: var(--h)` is simply not `none` — so the element was kept and the
 * text inside it reached the model with nothing said. Resolving custom properties would mean implementing the
 * cascade; counting them does not, and it turns a silent miss into a number the reader can see.
 */
export declare function usesUnresolvedVariable(style: Map<string, string>): boolean;
/** True when a set of declarations hides the element from a human reader. */
export declare function hidesContent(style: Map<string, string>): boolean;
/** The alpha of a colour, or 1 when it carries none. Anything unparseable reads as opaque rather than as hidden. */
export declare function colorAlpha(value: string | undefined): number;
/**
 * A rule that hides whatever it matches. `classes` must all be present, which is what makes `.a.b` different from
 * `.a` — the first hides only elements carrying both.
 */
interface HidingRule {
  tag: string | null;
  id: string | null;
  classes: string[];
  /** `[data-x]`, `[data-x="y"]`, `[class~="y"]` and the other comparisons CSS allows. */
  attributes: Array<{
    name: string;
    operator: string;
    value: string;
  }>;
}
/**
 * The part of a selector that says which element is hidden: the last compound, after any combinator. In
 * `.wrapper > .secret`, `.wrapper` is context and `.secret` is what disappears — marking both would remove content
 * the reader can see.
 */
export declare function parseHidingSelector(selector: string): HidingRule | null;
/**
 * Walks a stylesheet rule by rule, descending into `@media` and friends.
 *
 * Splitting on `}` and skipping anything containing `@` — which is what this did — means every rule inside a
 * `@media screen` or `@supports` block is ignored, and text hidden by one of them reaches the reader. Only a
 * print-only block is genuinely irrelevant: what it hides is still visible on screen, which is where mail is read.
 */
export declare function eachStyleRule(css: string, visit: (selectors: string, declarations: string) => void, unreadable?: {
  count: number;
}): void;
/** Analyses one link as a human would see it: its visible text versus where it really goes. */
export declare function analyseLink(text: string, href: string): SanitizedLink;
/**
 * Converts email HTML to plain text for a model to read: hidden content removed, links rendered as
 * `text [domain]`, images never loaded, invisible characters stripped — with a report of everything removed.
 */
export declare function sanitizeHtmlToText(html: string, options?: {
  wordwrap?: number | false;
  /**
   * Leave out the `[domain]` after a link and the `[image not loaded]` placeholder.
   *
   * Those annotations exist for a reader: they say where a link really goes. They are wrong when the output is
   * being *compared* with the plain-text twin of the same message, because the plain part has no such
   * annotations — and comparing the two then reports a mismatch on every message containing a link, which is
   * how a check meant to catch a mismatched message ends up refusing ordinary ones.
   */
  plain?: boolean;
}): SanitizedText;
/** Plain-text bodies get the same invisible-character treatment as HTML ones. */
export declare function sanitizePlainText(text: string): SanitizedText;
export interface OutboundHtmlReport {
  /** What a recipient sees, as text (hidden content removed) — compared with the draft's text part. */
  visibleText: string;
  /** The same text with link and image annotations left out, for comparing against a plain-text part. */
  comparableText: string;
  /** Content a recipient would not see, with why; shown to the approver, never silently dropped. */
  hidden: {
    reason: string;
    text: string;
  }[];
  /** Every URL in the HTML with its full query string, and where it appears. */
  urls: {
    where: string;
    url: string;
  }[];
  /** URLs a mail client fetches on open — each one a potential beacon carrying data out. */
  remoteResources: string[];
  /** `<form>` elements. Mail clients do not submit them, but their presence says the message is trying. */
  forms: number;
  /** Interactive fields — input, button, select, textarea — whether or not they sit inside a form. */
  formFields: number;
  scripts: number;
  /**
   * Every picture or piece of media a mail client would draw, whatever its source: `data:`, `cid:` and relative as
   * well as remote, and an `<img>` with no source at all, whose alt text a client shows in its place.
   *
   * None of them is in the text a preview shows. Remote ones are in `remoteResources` as well: that list is about
   * what is fetched, this one about what is drawn, and a `data:` image is drawn without being fetched.
   */
  images: {
    where: string;
    url: string;
  }[];
  /**
   * Markup that makes a mail client show text other than `comparableText`, or the same text in another order.
   *
   * `comparableText` is the HTML's text in source order, and a sender compares it with the text part. Each entry is a
   * way for the two to agree while the recipient reads something else: a stylesheet that adds or moves text, inline
   * CSS that does the same, bidi markup and characters that reorder it, drawings and embedded documents with text of
   * their own, elements that show their markup as text, and table and list markup a client draws out of source order.
   * `reason` is a phrase a refusal can quote as it is.
   */
  alterations: {
    where: string;
    reason: string;
  }[];
}
/**
 * Analyses HTML an agent is about to send. The opposite of the inbound sanitiser: it shows hidden content instead of
 * dropping it, and lists every URL and every resource a mail client would load on open, every image it would draw,
 * and everything that would make it show text other than the text compared — so a preview cannot look clean while
 * the HTML carries a beacon, a picture, hidden text or rearranged text to the recipient.
 */
export declare function analyseOutboundHtml(html: string): OutboundHtmlReport;
//#endregion
//#region src/save-deny.d.ts
/**
 * Where a download may never be written, whoever answers the question — a person in the chat, a person at a terminal,
 * or an agent relaying either.
 *
 * A download saves a stranger's file under the name the stranger gave it, and a name alone can be made harmless: it
 * keeps its extension only when that is one nothing runs or loads (`saved-files.ts`), and anything else is saved with
 * `.download` after it. What a name cannot be made is harmless in every folder. Some folders are read, whole, by a
 * program that runs what it finds, whatever each file is called — a hooks folder, a package folder, a folder of
 * approvals — and some hold what the person's own tools trust. The person asked for a file to read, not for any of
 * that, and no answer — least of all one an agent passed on — should be able to turn a download into it. So these are
 * refused, whatever the question was answered with. They are the folders every machine of their kind has, or that a
 * file in them makes plain; a folder a program was told to load whole — a zsh completions folder, an application's
 * plugin or startup folder — is one no rule here can know, and saving into it stays the person's choice:
 *
 * - this package's own folders: its configuration, its state (approvals, the audit log, the download records), its
 *   data, and the file secret store;
 * - any hidden folder, anywhere, at any depth — `~/.ssh`, `~/.config`, a project's `.git`, `.github`, `.husky`,
 *   `.vscode` or `.claude`, `/srv/app/.github/workflows` — since a folder whose name starts with a dot is one kept for
 *   programs, not for a person's files. The one exception is a checkout under `.claude/worktrees/<name>`, which is a
 *   project like any other: a folder inside it is allowed, unless it is itself inside a hidden folder there;
 * - a folder programs load packages from, wherever it is: `node_modules`, `site-packages`, `dist-packages`,
 *   `__pycache__`, and any folder inside a Python virtual environment — one with `pyvenv.cfg` in it or above it — whose
 *   interpreter runs what is put in its package folders at every start;
 * - any folder inside a Python installation — one with `conda-meta`, `Lib/os.py` or `lib/python3.<minor>/os.py` in it
 *   or above it, such as `~/miniconda3` or `C:\Python312` — whose interpreter loads what it finds in its own folders by
 *   name: `python312.zip` ahead of the standard library, a `._pth` that rewrites where it looks;
 * - `~/Library`, where macOS and its apps keep what they load on their own;
 * - on Windows, the profile's `AppData` (`%APPDATA%`, `%LOCALAPPDATA%`), `%PROGRAMDATA%`, the Windows folder and
 *   Program Files, the PowerShell profile folders (`Documents\PowerShell`, `Documents\WindowsPowerShell`, wherever
 *   Documents is), and the root of a drive; and a network share (`\\host\share`), a device path (`\\.\`, `\\?\`) or a
 *   path relative to a drive (`\folder`, `C:folder`), each of which is not the folder it looks like;
 * - on Linux, the same Windows folders reached through WSL's `/mnt/<letter>`: the drive itself, `Windows`,
 *   `Program Files`, `ProgramData`, a profile's `AppData` and PowerShell profile folders, in any case;
 * - the system's own folders: the root, `/etc`, `/usr`, `/bin`, `/sbin`, `/var`, `/System`, `/private/etc` and the
 *   like — except macOS's per-user temporary folder under `/var`, and a home that is inside one (`/root`, a service
 *   account's `/var/lib/<name>`), which is the person's own.
 *
 * The home folder itself is allowed: a folder of the person's own, whose hidden folders stay refused.
 *
 * Checked on the path as given and again after its links are followed, so a folder that is a link to `~/.ssh`, or a
 * `hooks` link to `.husky`, is refused as what it points to; and case-blind on macOS and Windows, whose disks open
 * `~/library` as `~/Library`.
 */
/** This package's own folders, which a download is never written into. */
export type OwnFolders = Pick<ResolvedPaths, "configDir" | "stateDir" | "dataDir" | "secretsDir">;
export interface SaveDenyInput {
  paths: OwnFolders;
  env: NodeJS.ProcessEnv;
  platform?: NodeJS.Platform | undefined;
  /**
   * Where Windows says the person's Documents folder is, for the PowerShell profile folders inside it. Read from the
   * registry when left out — on Windows, and only for the profile of the user running this (`known-folders.ts`).
   */
  knownDocuments?: (() => string | undefined) | undefined;
  /**
   * This Linux's mounts, for finding Windows's drives under WSL wherever and however they are mounted. Read from the
   * kernel's mount table when left out, never from the environment: see {@link parseMounts}.
   */
  mounts?: (() => readonly Mount[]) | undefined;
}
/** One place a download is never written, and why, in words the person reads. */
export interface DeniedFolder {
  folder: string;
  why: string;
  /** Only the folder itself, not what is inside it: the root of the disk. */
  exact?: boolean;
  /** A system folder, which the per-user temporary folders and a home inside it are let out of. */
  system?: boolean;
}
/** A mount on this Linux, and the Windows folder it shows when it is one of Windows's drives. */
export interface Mount {
  /** The kernel's id for it, and the id of the mount it sits on. */
  id: string;
  parent: string;
  /** Where it is mounted, as this Linux sees it. */
  point: string;
  /**
   * The Windows folder at its mount point — `C:\`, `D:\Projects\acme` — or `''` when it is Windows's but which folder
   * cannot be read, or null when it is not Windows's.
   */
  windows: string | null;
}
export declare function parseMounts(mountinfo: string, link?: (tag: string) => string | null): Mount[];
/** This process's mounts, from the kernel — none where there is no `/proc`. */
export declare function mountTable(): Mount[];
/**
 * Every folder a download is refused, as data: this package's, the home's, the platform's. The hidden folders, the
 * package folders, the Python environments and installations, and Windows's folders seen from WSL are rules rather
 * than folders, and `refusedSaveFolder` and `saveFolderRefusal` apply them beside this list.
 */
export declare function saveDenyList(input: SaveDenyInput): DeniedFolder[];
/**
 * What is wrong with a Windows path as it was written, before anything resolves it — or null.
 *
 * Each of these resolves to *something*, which is the trouble: `\\host\share` is another machine, `\\.\` and `\\?\`
 * reach devices and skip the checks Windows makes on a name, `\folder` is on whichever drive the process happens to be
 * on, and `C:folder` is relative to that drive's current folder. None is the folder a person reading it would expect.
 */
export declare function windowsPathProblem(text: string): string | null;
/**
 * Why a folder may never be saved into, judged on the path as written and resolved — or null. No file is looked at:
 * see {@link saveFolderRefusal} for the check that also follows links and finds Python environments and installations.
 */
export declare function refusedSaveFolder(folder: string, input: SaveDenyInput): string | null;
/** The real path of `target`, through whatever part of it exists; the rest kept as written. */
export declare function realpathOfExisting(target: string): Promise<string>;
/**
 * Why a folder may never be saved into, after its links are followed — or null.
 *
 * The path as written, and its real path through whatever part of it exists, each against the list as written and as
 * its own links resolve: a folder that is a link to `~/.ssh` is refused as `~/.ssh` is, a `hooks` link to `.husky` as
 * `.husky` is, and so is a home or a state folder reached through a link (`/var` → `/private/var` on macOS). Then
 * each, and every folder above it, is looked in for what makes it a Python virtual environment or installation. Links
 * are followed, and folders looked in, only on the platform this runs on; a path for another is judged as written.
 */
export declare function saveFolderRefusal(folder: string, input: SaveDenyInput): Promise<string | null>;
/**
 * Refuses a folder a download may never be saved into, as `BAD_DATA` naming the folder and why. `hint` says what
 * became of the question: still open when this runs before it is claimed, spent when it runs after.
 */
export declare function checkSaveFolder(folder: string, input: SaveDenyInput, hint?: string): Promise<void>;
export declare function refusedFolder(folder: string, why: string, hint: string): CommsError;
//#endregion
//#region src/save-destination.d.ts
/**
 * Where a download is saved: the person's to say, every time.
 *
 * A Gmail attachment or a Slack file is a stranger's file, and where it lands on this machine is not a thing a tool
 * should decide for the person — nor an agent, which is who calls the tool. So a download asks first. The first call
 * reads what the request names and saves nothing: it lists the files, by name and size, and offers three places — the
 * person's Downloads folder (or the one they set as `defaults.downloadsDir`), the folder the command or the server
 * was started in, or a folder they name — each of the first two by its exact path, or as unavailable, with the
 * reason, when it is a folder no download may be written into (`save-deny.ts`). The question is kept in the approval
 * store as a `download` record, so it expires, is claimed once, and is bound to the account, the request and the files
 * it listed. The second call carries the person's answer and the question's id, and only then is anything written.
 *
 * The question is held to the change policy of the mailbox or workspace the files come from. Under `chat` the answer
 * an agent relays from the conversation is the person's, as every other approval here is under `chat`. Under
 * `confirm` it has to come from where an agent cannot answer: the person at their own terminal — the channel's
 * `approve` with the question's id, or the download command itself asking them there — or a form a trusted client
 * shows them. An answer passed as a tool argument or a flag is then refused, and the question left open.
 *
 * At a terminal with a person at it the command asks there and then (`downloadAtTerminal`); a person at a terminal
 * may also answer by flag, `--to`, with nobody to ask; an agent, a pipe or `--json` gets the question and the id, as
 * over MCP, and runs the command again with the answer.
 *
 * Nothing here is an operation: the channels' `downloadAttachments` and `downloadFiles` are, and both surfaces reach
 * them. This is what they share of the asking.
 */
/** The three answers: the two folders the question shows by path, and one the person names. */
export type SaveChoice = "downloads" | "current" | "other";
/** The two folders a question offers, as absolute paths. */
export interface SaveFolders {
  /** The person's Downloads folder (see `downloadsFolder`), or `defaults.downloadsDir` when they set one. */
  downloads: string;
  /** The folder the process was started in: the client's for a server, the shell's for a command. */
  current: string;
}
/** The two folders, with anything their paths alone say is wrong with them. */
export interface OfferedFolders extends SaveFolders {
  /** Why either could never be saved into, known from the path as it was written: a Windows share, say. */
  unusable?: Partial<Record<"downloads" | "current", string>> | undefined;
}
/** An answer, checked for its form: a word, or a folder that is absolute or starts with `~`. */
export type SaveAnswer = {
  choice: "downloads";
} | {
  choice: "current";
} | {
  choice: "other";
  folder: string;
};
/** What a download is called with, beside its request: the person's answer, the question's id, or neither. */
export interface DownloadAnswer {
  /** `downloads`, `current`, or a folder: the person's answer to the question. */
  saveTo?: unknown;
  /** The id the question came with. */
  choiceId?: unknown;
  /**
   * The person decided by a flag at their own terminal — `--to` without `--choice`, with stdin and stdout both a
   * terminal and no agent marker set. Only the CLI says so; a tool call never does, so an agent over MCP cannot.
   */
  personChose?: boolean | undefined;
}
/**
 * A download's answer, once its form is checked: none yet; one to a question — the person's own words relayed, or
 * `null` when they answered it where it was asked, at a terminal or in a form, and the question carries it; or one a
 * person gave by flag at their terminal.
 */
export type CheckedAnswer = {
  readonly kind: "none";
} | {
  readonly kind: "choice";
  readonly answer: SaveAnswer | null;
  readonly choiceId: string;
} | {
  readonly kind: "person";
  readonly answer: SaveAnswer;
};
/** Which surface asked, so a refusal names the argument as that surface spells it. */
export type DownloadSurface = "cli" | "mcp";
export interface SaveFoldersInput {
  /** `defaults.downloadsDir`, when the person set it. */
  configured?: string | undefined;
  env: NodeJS.ProcessEnv;
  /** The working directory of the process: a server's, a command's. */
  cwd: string;
  platform?: NodeJS.Platform | undefined;
  /**
   * Where Windows says the person's Downloads folder is. Read from the registry when left out — on Windows, and only
   * for the profile of the user running this: see {@link downloadsFolder}.
   */
  knownDownloads?: (() => string | undefined) | undefined;
}
/**
 * The two folders a question offers, by their absolute paths.
 *
 * Downloads is the person's own Downloads folder ({@link downloadsFolder}), not a folder of this package's inside it:
 * a file the person asked for belongs where they look for downloads. A `defaults.downloadsDir` they set is that folder
 * instead, since setting it is how they said where their downloads go. Either may turn out to be one no download is
 * written into; the question says so rather than offering it.
 */
export declare function saveFolders(input: SaveFoldersInput): OfferedFolders;
/**
 * The person's Downloads folder, where their system keeps it — the home read from the environment as every other
 * path here is (`HOME`, `USERPROFILE` on Windows), never the real one of whoever runs a test.
 *
 * - On Linux and the other Unixes, the XDG user directories: `XDG_DOWNLOAD_DIR` in the environment, then the line of
 *   that name in `user-dirs.dirs` under `XDG_CONFIG_HOME` (or `~/.config`). A desktop in another language names the
 *   folder in it — `~/Téléchargements`, `~/Descargas` — and `~/Downloads` is then a folder nobody looks in. A value of
 *   `$HOME` alone means the person turned it off, and is not taken.
 * - On Windows, the Downloads known folder, which a person or a domain can move to another drive: its entry under
 *   `User Shell Folders` in the registry (`known-folders.ts`), read only when the home named is the running user's own
 *   profile, since the registry says nothing about any other.
 * - Anywhere else, and whenever those say nothing usable, `<home>/Downloads`.
 */
export declare function downloadsFolder(env: NodeJS.ProcessEnv, platform?: NodeJS.Platform, knownDownloads?: (() => string | undefined) | undefined): string;
/**
 * The person's answer, held to its form: `downloads`, `current`, or a folder — absolute, or from `~`.
 *
 * A relative folder is refused rather than resolved. It would mean one folder where the server runs and another where
 * the command does, and neither need be the one the person meant; asking them costs a sentence. So is `~user/…`,
 * which names another account's home, and — for Windows — a network share, a device path, or a path that names no
 * drive or only a drive's current folder (`save-deny.ts`, `windowsPathProblem`).
 */
export declare function parseSaveAnswer(value: unknown, surface: DownloadSurface, platform?: NodeJS.Platform): SaveAnswer;
/**
 * The answer and the question's id, checked before anything is read.
 *
 * An answer without an id is refused unless a person gave it by flag at their terminal (`personChose`, which only the
 * CLI sets): where a stranger's files land is the person's to say, and an agent that picks a folder itself has not
 * asked them. An id alone is taken: the person may have answered where the question was put to them — at a terminal,
 * or in a form — and the question then carries the answer; a question that carries none is refused before it is
 * spent (`settleDestination`).
 */
export declare function checkDownloadAnswer(given: DownloadAnswer, surface: DownloadSurface, platform?: NodeJS.Platform): CheckedAnswer;
/**
 * Refuses `out` / `--out`, which named a folder inside the old downloads root. The person chooses the folder now, so
 * it is refused with what replaced it rather than dropped, and nothing is read or saved.
 */
export declare function refuseRetiredOut(out: unknown, surface: DownloadSurface): void;
/** What replaced `out`, in the words of the surface that was given it: the hint `strictToolArguments` gives too. */
export declare function retiredOutHint(surface: DownloadSurface): string;
/**
 * Whether a bare `--to` is a person's own answer: stdin and stdout both a terminal — a person who could as well be
 * asked — nothing that forbids asking (`--json`, `--no-input`, CI), and no agent marker set. The marker is a second
 * refusal, never the only one: it is absent from an agent that does not set it, and from one that unsets it.
 */
export declare function personAtTerminal(env: NodeJS.ProcessEnv, streams: Streams, output: {
  json?: boolean | undefined;
  noInput?: boolean | undefined;
}): boolean;
/** The folder an answer names, as an absolute path: one of the two the question showed, or the person's own. */
export declare function folderFor(answer: SaveAnswer | RecordedSaveAnswer, folders: SaveFolders, env: NodeJS.ProcessEnv, platform?: NodeJS.Platform): string;
/** An answer as a question records it: the person's folder resolved where they typed it, so it means what they read. */
export declare function recordedAnswer(answer: SaveAnswer, env: NodeJS.ProcessEnv, platform?: NodeJS.Platform): RecordedSaveAnswer;
/**
 * Refuses a folder that is something else — a file, or a path through one — before the question is spent on it. A
 * folder that is not there yet is fine: it is made when the files are saved. What is not there is followed up to the
 * nearest part that is, as {@link checkWritable} does: Windows says a path through a file is not there (`ENOENT`),
 * where Unix says `ENOTDIR`.
 */
export declare function checkFolder(folder: string): Promise<void>;
/**
 * Refuses a folder the files could not be written into, before the question is spent on it.
 *
 * `checkFolder` said only that the folder was not a file, so a read-only folder — a mounted image, a folder of
 * another user's, the root a client started the server in — passed, the question was spent, and the first file then
 * failed with a bare `EACCES` naming the sender's file. A folder that is there is proved by making a file in it, with
 * the same exclusive, link-refusing create a download uses, and removing it again: nothing else says as surely that a
 * file can be made there. One that is not there yet has to be made in the nearest folder that is, so that one is asked
 * whether it can be written into; nothing is made before the question is claimed.
 */
export declare function checkWritable(folder: string): Promise<void>;
/** Which folder on which disk: the two numbers that stay with a folder whatever its path is made to point to. */
export interface FolderIdentity {
  readonly dev: bigint;
  readonly ino: bigint;
}
/**
 * The folder to save into, made when it is missing — private, as every folder this package makes is — and resolved.
 *
 * Resolved through its links: the person named it, so a link in it goes where they meant. What is not followed is
 * anything at a file's own name inside it, which `createUniqueFile` refuses to open through. What comes back is the
 * real path, which is where each file is then created — and which the deny list is held to again, by the caller — and
 * the folder's identity, which each file created is held to (`createSavedFile`).
 */
export declare function openFolder(folder: string): Promise<string>;
/**
 * What the file system said, in words and its code, and never its message: a message from `open` or `write` carries
 * the path it failed on, and a path in a download's folder ends in the sender's words.
 */
export declare function fileSystemReason(error: unknown): string;
/**
 * A file that could not be saved, as an error that names only the folder and the file's id — the platform's, never
 * the name its sender gave it. A refusal of this package's own is passed on as it is.
 */
export declare function saveFailure(error: unknown, where: {
  folder: string;
  fileId: string;
}): CommsError;
/**
 * One of the three places a question offers. The first two carry their path, and `unavailable` with the reason when
 * no download may be saved there; the third is the person's to name.
 */
export interface SaveOption {
  choice: SaveChoice;
  path?: string;
  default?: boolean;
  /** Why this folder is not offered: it is one no download is written into (`save-deny.ts`). */
  unavailable?: string;
}
/** What a download answers with before anything is saved: the question to put to the person, and its id. */
export interface DestinationQuestion {
  /** Always true here: nothing was saved, and the person has to say where. */
  destinationRequired: true;
  /** Pass back as `choiceId` (`--choice`), beside the person's answer. */
  choiceId: string;
  /** The question, in words to show the person as they are. The files are listed beside it. */
  question: string;
  options: SaveOption[];
  /**
   * The change policy the answer is held to: `chat`, and the person's answer relayed from the conversation saves;
   * `confirm`, and the person answers it themselves, at their own terminal or in a trusted client's form.
   */
  policy: ChangePolicy;
  expiresAt: string;
  /** What to do next, in words an agent can follow. */
  next: string;
}
export interface AskInput {
  /** The download the question is about, as it will be claimed. */
  request: DownloadRequest;
  folders: OfferedFolders;
  /** Whether the Downloads option is a folder the person set, rather than their Downloads folder. */
  configured: boolean;
  /** How many files, and how many bytes they declare, for the question's first line. */
  count: number;
  bytes: number;
  /**
   * The files by the names they would be saved under, their sizes, why a name has `.download` after it, and their
   * risk flags — kept for a terminal or a form to show again, and each rename and flag said in the question.
   */
  listing: ListedFile[];
  /** The change policy of the mailbox or workspace the files come from, as it stands now. */
  policy: ChangePolicy;
  /** The channel's command that answers the question at a terminal: `agent-gmail approve`. */
  approveCommand: string;
  surface: DownloadSurface;
  /** The tool to call again, over MCP. */
  tool: string;
  env: NodeJS.ProcessEnv;
  platform?: NodeJS.Platform | undefined;
}
/** The deny list's view of this machine: this package's own folders, and the home the environment names. */
export declare function denyInputOf(core: Core, env: NodeJS.ProcessEnv, platform?: NodeJS.Platform): SaveDenyInput;
/**
 * What a question warns about the files it lists: each one saved with `.download` after its name, and why, and each
 * other one with a risk flag — see core's `fileWarnings`. Said in the question itself, before the person answers, and
 * again in what the agent is told to do, so that a person who is shown only the question still reads them.
 */
export declare function listingWarnings(listing: readonly ListedFile[]): string[];
/**
 * Asks where to save, and keeps the question: a `download` record in the approval store, bound to the request and the
 * files, held to the account's change policy, that expires as an approval does and is claimed once. Nothing is written
 * anywhere else.
 */
export declare function askWhereToSave(core: Core, input: AskInput): Promise<DestinationQuestion>;
/** Where an answered download saves: the folder, made and resolved, and how it was chosen. */
export interface SaveDestination {
  /** The real path of the folder, where every file is created. */
  folder: string;
  /** The folder as it was opened and checked: every file created is held to it (`createSavedFile`). */
  identity: FolderIdentity;
  choice: SaveChoice;
  /** The question the answer was to, or null when a person decided by flag. */
  choiceId: string | null;
  /**
   * Where the answer came from: the conversation (`chat`), the person's own terminal, a trusted client's form, or a
   * flag a person gave at their terminal.
   */
  answeredVia: "chat" | "terminal" | "elicitation" | "flag";
}
export interface SettleInput {
  answer: Exclude<CheckedAnswer, {
    kind: "none";
  }>;
  /** The download as it would be claimed now: the same account, request and files the question listed. */
  request: DownloadRequest;
  /** The two folders as they are now, for an answer given by flag, which no question offered. */
  folders: () => OfferedFolders;
  /** The change policy of the mailbox or workspace now; the stricter of it and the question's decides. */
  policy: ChangePolicy;
  /** The channel's command that answers a question at a terminal, for the refusal under `confirm`. */
  approveCommand: string;
  surface: DownloadSurface;
  env: NodeJS.ProcessEnv;
  platform?: NodeJS.Platform | undefined;
  /**
   * The download's cancellation, for the claim to ask under the approval store's lock: a call cancelled while the claim
   * waits for it saves nothing and leaves the question unused (see `ClaimOptions.signal`). Absent from a command line.
   */
  signal?: AbortSignal | undefined;
}
/**
 * The folder an answer saves into, the question claimed on the way.
 *
 * An answer to a question, in this order, each before the question is spent: the change policy — under `confirm` only
 * an answer the person recorded at a terminal or in a trusted form will do, and one passed in arguments is refused
 * with the command that answers it; then which answer — the recorded one, which a relayed answer must match, or the
 * relayed one; then the folder — never one on the deny list (`save-deny.ts`), never a file, and one a file can be
 * made in. Then the question is claimed, once, and only for the request and the files it listed, and the folder made;
 * the folder as made and resolved is held to the deny list again, so a link put in its place meanwhile is refused.
 *
 * An answer a person gave by flag at their terminal has no question to claim, names today's folders, and is held to
 * the same checks of the folder.
 */
export declare function settleDestination(core: Core, input: SettleInput): Promise<SaveDestination>;
/**
 * A file created for a download in the folder it was answered with — and proved, once created, to be in that folder.
 *
 * The folder was checked against the deny list as it was opened, by its real path; each file is then created by that
 * path, exclusively and never through a link at its own name. What that cannot see is the folder itself being swapped
 * for a link to another — `~/.ssh` — between the check and a create, which takes a process on this machine working in
 * that folder, but no more. So once each file is made, the folder at that path is looked at again, without following
 * a link, and has to be the very folder that was opened and checked — the same disk, the same inode — and the file at
 * the new path has to be the one just opened. A file made anywhere else is removed, when it is still the file this
 * made, and the download stops: nothing more is written until the folder is asked about again.
 */
export declare function createSavedFile(destination: Pick<SaveDestination, "folder" | "identity">, name: string, where: {
  fileId: string;
}): Promise<{
  path: string;
  handle: FileHandle;
}>;
/**
 * Where a download's own record goes: this package's state directory, `downloads/<time>_<question id>.json` — never
 * the folder the person chose, where nothing is written but the files.
 */
export declare function downloadRecordPath(core: Core, at: Date, choiceId: string | null): string;
/** A question, told from a result by its one field that is always `true`. */
export declare function isDestinationQuestion(value: unknown): value is DestinationQuestion;
export interface DownloadAtTerminalOptions<Q extends DestinationQuestion> {
  core: Core;
  /** The command's operation, with an answer or without: it asks without one, and saves with one. */
  download: (answer: DownloadAnswer) => Promise<unknown>;
  /** `--to`, as given. */
  to?: string | undefined;
  /** `--choice`, as given. */
  choice?: string | undefined;
  env: NodeJS.ProcessEnv;
  output: {
    json?: boolean | undefined;
    color: boolean;
    platform?: NodeJS.Platform | undefined;
  };
  noInput?: boolean | undefined;
  /** The command to run again, for the hint an agent gets: `agent-gmail attachments download … --inbox acme/gmail`. */
  command: string | ShellCommand;
  /** The channel's command that answers a question at a terminal: `agent-gmail approve`. */
  approveCommand: string;
  /** The question with its files, as a person reads it. */
  render: (question: Q) => string;
  streams?: Streams | undefined;
}
/**
 * A download at the command line.
 *
 * With `--choice` it is an answer to that question: with `--to`, the answer relayed; alone, the answer the person
 * gave at their terminal. With `--to` alone it is a person's own decision, taken only from a person at a terminal
 * ({@link personAtTerminal}); from anything else — an agent, a pipe, `--json` — the operation refuses it for want of
 * a question. Without either it asks: a person at a terminal is shown the files and the three places and answers 1,
 * 2 or 3 (3 asks for the folder), their answer is recorded on the question as given at a terminal, and the files are
 * saved; an agent, or anything without a terminal, gets the question and its choice id and exits 10, as a change
 * waiting for a person does, and runs the command again with the answer.
 *
 * Returns what the operation saved, or what it answered without asking — a request with nothing in it to save.
 */
export declare function downloadAtTerminal<Q extends DestinationQuestion>(options: DownloadAtTerminalOptions<Q>): Promise<unknown>;
export interface AnswerAtTerminalOptions {
  env: NodeJS.ProcessEnv;
  color: boolean;
  /** The shell syntax used if the stored record is another kind of approval. */
  platform?: NodeJS.Platform | undefined;
  /** The channel's `approve`, for the words the question is shown with: `agent-gmail approve`. */
  approveCommand: string;
  streams?: Streams | undefined;
}
/**
 * A download's question answered by the person at their own terminal: `agent-gmail approve <choiceId>`, `agent-slack
 * approve <choiceId>` — the channel through which a question under `confirm` is answered, since an agent cannot type
 * into it.
 *
 * The caller has already refused agents and anything without a terminal, as it does for a send or a change. This shows
 * the question again from what the record keeps — the account, the files by the names they would be saved under, and
 * the two folders, each checked against the deny list now — asks 1, 2 or 3, and records the answer on the question as
 * given at a terminal. The download that asked is then made again with the choice id alone, and saves where this
 * says. Anything else cancels, and revokes the question.
 */
export declare function answerDownloadAtTerminal(core: Core, choiceId: string, options: AnswerAtTerminalOptions): Promise<{
  state: "approved" | "revoked";
  answer?: RecordedSaveAnswer;
}>;
/**
 * A download's question as a form puts it to the person: the message — the files and the three places, as `approve`
 * shows them at a terminal — and the choices they may pick, an option shown as unavailable left out.
 *
 * For a channel whose MCP server raises forms only for clients trusted to show them to a person
 * (`defaults.confirm.elicitationClients`): under `confirm`, that form is the other place a question can be answered
 * where an agent cannot answer it.
 */
export declare function downloadQuestionForm(core: Core, choiceId: string, env: NodeJS.ProcessEnv): Promise<{
  message: string;
  choices: SaveChoice[];
}>;
/**
 * Records the answer a person gave in a trusted client's form, checked as an answer typed at a terminal is — an option
 * shown as unavailable, a folder on the deny list, a file, a folder nothing can be written in, each refused before
 * anything is recorded, and the question left open for another answer.
 */
export declare function answerDownloadInForm(core: Core, choiceId: string, content: {
  choice?: unknown;
  folder?: unknown;
}, env: NodeJS.ProcessEnv, platform?: NodeJS.Platform): Promise<RecordedSaveAnswer>;
//#endregion
//#region src/system-programs.d.ts
/**
 * The Windows folder: `%SystemRoot%` (or `%windir%`) when it names a folder on a drive, and `C:\Windows` otherwise.
 * A value that is not a drive's absolute path — relative, a share, a device path — is not taken: it would be looked up
 * against the current folder, or on another machine, which is what naming the program in full is to avoid.
 */
export declare function windowsFolder(env?: NodeJS.ProcessEnv): string;
/** A program of Windows's own by its full path: `%SystemRoot%\System32\<name>`, never a bare name to look up. */
export declare function windowsSystemProgram(name: string, env?: NodeJS.ProcessEnv): string;
/**
 * The environment a child process is started with: `env` as it is, and on Windows also
 * `NoDefaultCurrentDirectoryInExePath=1`, so that the child — `rundll32.exe`, a Node started again — never takes a
 * program from its current folder either. Elsewhere nothing is added: a Unix shell looks in the current folder only
 * when `PATH` says to.
 */
export declare function childEnvironment(env?: NodeJS.ProcessEnv, platform?: NodeJS.Platform): NodeJS.ProcessEnv;
/**
 * The directories of a search path that name a folder on their own: absolute, and on Windows on a drive. An empty
 * entry means the current folder to a Unix shell, and a relative one is read against it; either would make the program
 * found — and run — depend on where this was started, which is where a download may have saved a stranger's file.
 */
export declare function absoluteSearchPath(entries: readonly string[], platform?: NodeJS.Platform): string[];
//#endregion
//#region src/update-gate.d.ts
/**
 * The daily update check's stop, where every server and every command meets it (design 2026-09-28 §2, §3).
 *
 * Reader only, like `update-state.ts`: what asks the registry is handed in — `refresh` to a server's gate, `check` and
 * `update` to a command's — by every package but WhatsApp, which has no network code and hands in nothing.
 */
/**
 * What the approval id a call carries is to that call: what the stop holds it to before letting the call through.
 */
export interface ApprovalClaim {
  /**
   * The kind of approval the call takes — a send, or a change — where the surface knows it. Left out, either: the
   * tool's own claim refuses the other kind, and the stop holds the id to its state alone.
   */
  kind?: ApprovalKind | undefined;
  /**
   * The call looks the approval up rather than claiming it: Resend's send status, asked about a send by the approval
   * it went under — used, failed, or with an outcome nobody knows. Held to its kind only, because what the call reads
   * is that very send, the tail of something the person already said yes to, and nothing it can do is anything more.
   */
  lookup?: boolean | undefined;
  /**
   * The tool argument that carries the id, when it is not `approvalId`: a download carries its question's as
   * `choiceId`, beside the person's answer. Over MCP only; a command's ids are read by `approvalsOf`.
   */
  argument?: string | undefined;
}
/** A call that looks a send up by its approval: Resend's `resend_send_status`, and `agent-resend send status`. */
export declare const SEND_LOOKUP: Readonly<ApprovalClaim>;
/** A call that claims a change: every core command and tool that takes an approval. */
export declare const CHANGE_CLAIM: Readonly<ApprovalClaim>;
/**
 * A call that answers a download's question: `gmail_attachment_download` and `slack_file_download` with `choiceId`,
 * `agent-gmail attachments download` and `agent-slack files download` with `--choice`. The person answered where to
 * save moments ago, so the call goes past the stop as a claimed approval does (§2). The answer alone — `saveTo`,
 * `--to` — claims nothing, and is stopped like any new request.
 */
export declare const DOWNLOAD_CLAIM: Readonly<ApprovalClaim>;
/**
 * Whether a call claims an approval the person already gave (§2): an approval this machine's approval store holds —
 * every channel keeps its approvals there — that is still waiting to be used, pending or approved, and of the kind the
 * call takes where the surface says which. Only then does the call go past the stop.
 *
 * The key alone is not a claim. An empty `approvalId`, or an id nobody prepared, claims nothing, and let past it
 * would run the tool's first-call path with an update out — a preview, or a tightening applied at once. Each tool
 * refuses an approval it does not know anyway; the stop must not be what an unknown one walks around. The store
 * refuses anything that is not an approval id before it looks, so that is not checked twice.
 *
 * Nor is every id the store holds. Records stay in it after they are used, revoked or expired, and one of those let
 * any call past the stop for as long as it was kept: an old "not now" the person turned down walked `agentcomms
 * channels` straight through. Such a record claims nothing any more — there is nothing left of it for the person to
 * lose by waiting — except to a look-up (`lookup`), which only reads it.
 *
 * What is not checked here is that the approval was prepared for this very call. The store binds a change to its
 * digest, and a send to its draft, which only the tool can compute; it does, when it claims the approval, and refuses
 * any other. A change that needs no approval claims none, and refuses one it is handed (`gatedChange`), so an approval
 * prepared for another change gets a call past the stop only to that refusal.
 */
export declare function claimsApproval(core: Core, id: unknown, claim?: ApprovalClaim): Promise<boolean>;
/**
 * What `strictToolArguments` asks before a tool runs, with the call's checked arguments: null to let it run, or the
 * result to answer with instead.
 */
export type ToolGate = (tool: string, args: Readonly<Record<string, unknown>>) => Promise<object | null>;
export interface UpdateToolGateOptions {
  core: Core;
  env: NodeJS.ProcessEnv;
  /** The server, as the reply names it: `agent-gmail`, `agentcomms`. */
  server: string;
  /** Its channel, `gmail`, `core`: whose registrations say whether restarting the client would start `latest`. */
  channel: string;
  /** The version this server is. */
  running: string;
  /** Tools never stopped: the update's own, and what a person needs to see what is wrong — each doctor, the paths. */
  exempt: readonly string[];
  /**
   * What each tool's `approvalId` is to it, where the server knows: the kind it claims, or a look-up. A tool not named
   * here is held to the approval's state alone, and its own claim checks the kind.
   */
  approvals?: Readonly<Record<string, Readonly<ApprovalClaim>>> | undefined;
  /**
   * The check, run in the background — never awaited by a call — whenever a call arrives and none is running. Absent
   * for WhatsApp, which reads the file as whatever else on the machine last left it.
   */
  refresh?: (() => Promise<unknown>) | undefined;
  now?: (() => Date) | undefined;
}
/**
 * A server's gate. Before a tool runs: if a newer release is out, this machine has not put it off today, the check is
 * on — the setting, `CI` and `AGENT_COMMS_UPDATE_CHECK` — the tool is not exempt, and the call claims no approval the
 * person already gave, the tool does not run and the call is answered with the stop.
 *
 * The file is read as it is: the check itself never delays a call. A call carrying the id of an approval this machine
 * holds goes ahead — the person said yes to exactly it, perhaps moments before the check landed — and the stop applies
 * from the next new request (§2, as agreed).
 */
export declare function updateToolGate(options: UpdateToolGateOptions): ToolGate;
/**
 * The answer to a stopped call. Its text opens with the owner's sentence, word for word, and says the rest in prose:
 * a client that shows the model only text blocks (Cursor) reads it there. Claude Code and Codex show only
 * `structuredContent`, so the same words are its `message`, with the versions and the two ways on beside them.
 */
export declare function stoppedCall(pending: PendingUpdate, where: {
  server: string;
  tool: string;
}): object;
/**
 * Whether a command is left alone by the update gate: `update` in every form, `doctor`, `paths`, `approve`,
 * `approvals`, help, and `mcp` alone — the server, which gates every call itself. `mcp install` and `mcp prune` are
 * not: they register and prune at this command's release. `also` adds a channel's own — WhatsApp's `status`, its
 * doctor. `--help` and `--version` never reach a command.
 */
export declare function exemptFromUpdateGate(path: readonly string[], also?: readonly string[]): boolean;
/** The shape of a Commander command this needs: its name, and the command it is under (null for the program). */
export interface CommandLike {
  name(): string;
  readonly parent: CommandLike | null;
}
/** A Commander command's path below the program, `['mcp', 'install']`: what `exemptFromUpdateGate` reads. */
export declare function commandPathOf(command: CommandLike): string[];
/**
 * The approvals a Commander command claims: its `--approval`, the `--mcp-approval` Gmail's `setup` carries beside it,
 * the `--choice` a download carries its question's id in, and an argument named `approvalId` — `agent-gmail send
 * cancel <approvalId>`, `agent-resend send execute <approvalId>`, the commands whose tools take it as `approvalId`.
 * What the gate hands `claimsApproval`, as a tool call's `approvalId` is handed it. Commander has read the arguments
 * by the time a `preAction` hook runs.
 */
export declare function approvalsOf(command: {
  opts(): Record<string, unknown>;
  readonly registeredArguments?: readonly {
    name(): string;
  }[];
  readonly processedArgs?: readonly unknown[];
}): unknown[];
/**
 * How the update a person asked for at the terminal went: `updated`, every step worked and nothing was left for a
 * person; `short`, it could do nothing, or left something for a person; `failed`, a step failed. Each has been
 * reported by then.
 */
export type TerminalUpdateOutcome = "updated" | "short" | "failed";
/** What asks the registry for a command: handed in by every CLI but WhatsApp's — see `terminalUpdateHooks`. */
export interface TerminalUpdateHooks {
  /**
   * The check, when the file is a day old. It never throws, and it is never cut short: the gate stops waiting for it
   * after about three seconds, and it carries on beside the command — in a detached child of its own, which holds none
   * of the command's output, so the command's process ends when the command does (#48).
   */
  check?: (() => Promise<void>) | undefined;
  /** The update, at this terminal, with its own preview and yes. */
  update?: (() => Promise<TerminalUpdateOutcome>) | undefined;
}
export interface TerminalGateOptions extends TerminalUpdateHooks {
  core: Core;
  env: NodeJS.ProcessEnv;
  /** The command a person typed, `agent-gmail`: what the prompt and the messages name. */
  binary: string;
  /** Its channel, `gmail`, `core`: whose global package says whether running the command again would run `latest`. */
  channel: string;
  /** The version this command is. */
  running: string;
  output: OutputOptions;
  noInput?: boolean | undefined;
  streams: Streams;
  /** The command that approves a change beside this CLI, for "later" under the `confirm` change policy. */
  approveCommand?: string | undefined;
  /**
   * The approval ids the command carries — `--approval`, `--mcp-approval` (`approvalsOf`). One this machine holds lets
   * the command run, as a tool call carrying it does over MCP (§2): the person said yes to exactly that.
   */
  approvals?: readonly unknown[] | undefined;
  /** What those ids are to the command, as a tool's `approvals` entry says it over MCP: the kind, or a look-up. */
  approvalClaim?: Readonly<ApprovalClaim> | undefined;
  now?: (() => Date) | undefined;
  /** How long the command waits for the check before it goes on without it. About three seconds. */
  waitMs?: number | undefined;
}
export declare const TERMINAL_CHECK_WAIT_MS = 3e3;
/**
 * The update gate at a terminal, before a command runs. Resolves to null to run the command, or to the exit status to
 * end with instead; throws `UPDATE_REQUIRED` (exit 11) where nobody can be asked.
 *
 * It reads the file first. If the file is a day old it asks the registry — through `check` — waiting at most about
 * three seconds and going on without it after that. Then, when a newer release is out, nothing puts it off, and the
 * command claims no approval the person already gave:
 *
 * - a person at a terminal (stdin and stdout a terminal, no `--json`, not `CI`, not an agent) is asked "Update now,
 *   later today, or cancel?". Now runs the update, with its own preview and yes, and ends asking them to run the
 *   command again; later records "not now" — their answer is the approval — and runs the command; cancel ends, having
 *   done nothing;
 * - anything else — a script, cron, an agent, `--json` — gets `UPDATE_REQUIRED`, naming `agentcomms update` and
 *   `agentcomms update --later`, and the command does not run.
 *
 * An update installed and not yet run by this command — this command's package is installed globally at the latest
 * release, and what is running is an older copy from somewhere else — stops it the same way, as the servers stop for
 * a client not yet restarted (§3: the terminal stops as chat does). Its "now" says to run the command again from the
 * installed one: there is nothing to update.
 */
export declare function updateGateAtTerminal(options: TerminalGateOptions): Promise<number | null>;
//#endregion
//#region src/tool-arguments.d.ts
/**
 * Tool arguments, held to the tool's schema — every key declared, every value what it says — and refused as `USAGE`
 * in the server's own error envelope when they are not (design 2026-09-18 §11: "unknown fields are rejected").
 *
 * Why the SDK's own check is not enough. It wraps a raw shape in a plain `z.object`, which *strips* a key it does not
 * declare, and a `z.object` passed whole does the same: the call runs without the key and says nothing. That is how
 * `gmail_inbox_add {client: 'other', contacts: false}` signed in through the default client and asked for the address
 * book, back when neither was declared — and how a misspelt `readOnly`, `cc` or `threadTs` would register a server
 * that can change every mailbox, leave a copy off a draft, or put a reply in the channel instead of its thread. And
 * what it does refuse — a wrong type, a fraction, a word outside an enum, a missing argument — comes back as its
 * uncoded "Input validation error", where every other refusal a tool makes carries a code an agent can act on.
 *
 * So each tool is registered with its schema made strict, and the SDK is handed a schema that publishes exactly that
 * — the same properties, descriptions, enums and `required`, plus `additionalProperties: false`, so a client knows
 * up front — but lets every call through to a check made here, before the tool's handler, which refuses in the
 * server's own envelope. A refused call reaches nothing: no handler, no pin check, no configuration, no provider.
 *
 * The arguments themselves, not what is inside them: an object passed as one argument — `gmail_draft_send`'s
 * `expect`, `gmail_organise_undo`'s records — is handed back from another tool's answer, and every key it declares is
 * required already, so a misspelt one is refused as missing. That refusal names where it is — "`expect.to` is
 * required", "`undo[0]` does not take `messageID`" — rather than the argument, which was an object all along.
 */
/** What a server answers a refused call with: its own error envelope, the same as for every other refusal. */
export type RefuseToolCall = (error: CommsError) => unknown;
/**
 * Arguments a tool took once and takes no longer, by tool and then by argument, each with what to do instead:
 * `{ gmail_attachment_download: { out: 'Leave out `out` …' } }`.
 *
 * Such a key is refused as any key the schema does not declare is — it is not in the published schema, and it reaches
 * nothing — but the refusal says it was removed and gives this hint, rather than the list of what the tool takes: an
 * agent that learned the old argument is told what replaced it, not left to guess from a list.
 */
export type RetiredArguments = Readonly<Record<string, Readonly<Record<string, string>>>>;
/**
 * Makes every tool registered on `server` from now on refuse a key its schema does not declare, and refuse arguments
 * its schema rejects, with `refuse` — before the tool's handler runs.
 *
 * Call it once, straight after the server is constructed and before any tool is registered: it wraps the server's
 * `registerTool`, so a tool added later gets the check by being registered at all, and nobody has to remember it.
 * `refuse` is handed a `USAGE` `CommsError` and returns the tool result, so the refusal is in the same envelope as
 * every other refusal that server makes.
 *
 * `gate` is asked next, with the checked arguments, before the handler: the daily update check's stop (design
 * 2026-09-28), which every server builds with `updateToolGate`. Here because this is the one place every tool of every
 * server already passes through, so no tool can be registered without it; given to the wrapper rather than built
 * in, because what it asks the registry with is each server's own — and WhatsApp's is nothing at all. A call it
 * answers reaches nothing, as a refused one does.
 */
export declare function strictToolArguments(server: object, refuse: RefuseToolCall, gate?: ToolGate, retired?: RetiredArguments): void;
//#endregion
//#region src/untrusted.d.ts
/**
 * Everything a sender controls — body, subject, snippet, display name, attachment file name, extracted text — reaches
 * a model only inside this envelope. The boundary is random per call, so text inside cannot forge a closing tag; the
 * opening tag carries only values the sender does not control (the inbox alias, ids, the field name). Chat-template
 * control tokens are neutralised, because some models treat them as structure even inside quoted data.
 */
/**
 * The envelope tag, which names no platform.
 *
 * It said `untrusted-email-content` while mail was the only thing this repository read. Slack content went into
 * the same envelope and was announced to the model as email, which is both untrue and the kind of untrue that
 * matters: the notice tells a model what the content *is* so it knows what weight to give it, and a chat message
 * described as an email is a message whose provenance the model has been misinformed about.
 */
export declare const UNTRUSTED_TAG: string;
export declare const UNTRUSTED_NOTICE: string;
export interface EnvelopeAttributes {
  /** The inbox alias the content came from. */
  inbox?: string | undefined;
  /** Provider message or thread id. */
  id?: string | undefined;
  /** Which field this is: body, subject, snippet, from-name, filename, attachment-text… */
  field: string;
}
export interface NeutraliseResult {
  text: string;
  tokensNeutralised: number;
}
/**
 * Neutralises chat-template control tokens, role markers, and anything shaped like our own envelope tag.
 *
 * **Strips invisible characters first, and that ordering is the whole point.** Every pattern below is written in
 * visible characters, and none of them can see through a zero-width space: `\s` in `TAG_LIKE` does not match U+200B,
 * so `<​/untrusted-email-content>` passed straight through while rendering, to a model, as a closing tag on the
 * line. The same trick splits `<|im_start|>` and `Human:`. Bodies were safe because `buildBody` happened to strip
 * before calling here; every header-derived field — subject, display name, attachment filename, the quote attribution
 * in a reply — went the other way round and was not. Stripping inside `neutralise` means a caller cannot get the
 * order wrong, and the fields that never called `stripInvisible` at all are covered by the same change.
 */
export declare function neutralise(text: string): NeutraliseResult;
export declare function newBoundary(): string;
/**
 * Wraps sender-controlled text. Pass one boundary for every field of a single response so the model sees a consistent
 * marker; a fresh one per response. When a collector is given, every address in the text is recorded as tainted — so
 * any read path that wraps content records taint without doing anything else.
 */
export declare function wrapUntrusted(text: string, attributes: EnvelopeAttributes, boundary?: string, collector?: TaintCollector): string;
//#endregion
//#region src/update-check.d.ts
export interface UpdateCheckOptions {
  /** The registry and `npm ls`, for a test — nothing a test runs reads the real ones. */
  deps?: UpdateDeps | undefined;
  now?: (() => Date) | undefined;
}
export interface UpdateCheckOutcome {
  /** Whether this call asked the registry: false when the check is off, not due, or another process is asking. */
  asked: boolean;
  record: UpdateCheckRecord;
}
/** The check, when it is on and due: once in 24 hours per machine, recorded in `update-check.json`. */
export declare function checkForUpdates(core: Core, env: NodeJS.ProcessEnv, options?: UpdateCheckOptions): Promise<UpdateCheckOutcome>;
/**
 * The day's claim, when the check is due and nobody else is asking: the claim's time, written to the file as
 * `checking`, or null — not due, claimed by another process, or the file could not be written. Whoever is handed the
 * time asks under it (`askUnderClaim`). Whether the check is on at all is the caller's to decide first.
 *
 * Under the lock, due or not — and claimed by another process or not — is decided on the file as it is now, and the
 * claim written before anyone asks, so of two processes that both found it a day old, one asks. The time is read under
 * the lock too: read before it, the second process's time could be earlier than the first's claim, which reads as a
 * clock gone back.
 */
export declare function claimUpdateCheck(core: Core, options?: {
  now?: (() => Date) | undefined;
}): Promise<string | null>;
/**
 * The ask, under a claim already taken (`claimUpdateCheck`): the registry, then `comms_update`'s own check. What it
 * found is written — the day's check recorded, and the claim given up — only while the claim in the file is still
 * `claimedAt`. It claims nothing itself.
 */
export declare function askUnderClaim(core: Core, env: NodeJS.ProcessEnv, claimedAt: string, options?: UpdateCheckOptions): Promise<void>;
/**
 * The hidden command every CLI that asks the registry answers to — `agentcomms`, `agent-gmail`, `agent-slack`,
 * `agent-resend` — with the claim's time after it: the ask a command handed on (`terminalUpdateHooks`). Not in any
 * help, never stopped by the update gate, and nothing a person or an agent runs.
 */
export declare const UPDATE_CHECK_CHILD_COMMAND = "update-check-child";
/** How to start this CLI again: a program and the arguments before the hidden command. */
export interface UpdateCheckChildEntry {
  readonly command: string;
  readonly args: readonly string[];
}
/**
 * How to start the CLI this process is running: this Node, the flags it was started with, and the script it runs —
 * when that script is a CLI's entry, `cli.mjs` built or `cli.ts` from a checkout. Links are followed first: npm's
 * `agentcomms` is a link to `dist/cli.mjs`, and on Windows its `.cmd` shim has already started Node on the `.mjs`, so
 * no shim is ever started here. Every package that answers the hidden command bundles this function into its own
 * build, so the entry is the running script, not this module's neighbour — core's own CLI, next to a bundled copy of
 * core, is not the command the person ran.
 *
 * Null when the script is not a CLI's entry: a CLI's `run()` called from something else, a test runner for one. The
 * check is then asked in this process, as it always was.
 */
export declare function updateCheckChildEntry(script?: string | undefined, execArgv?: readonly string[]): UpdateCheckChildEntry | null;
/**
 * The child's environment: the command's, with a debugger's flags taken out of `NODE_OPTIONS` too. Node reads
 * `NODE_OPTIONS` before any flag, so a command debugged through it — `NODE_OPTIONS=--inspect-brk` — would start a child
 * that waits for a debugger, holds its claim until the lease runs out, and outlives the command. Every other option in
 * it is kept as written; with none left, `NODE_OPTIONS` is left out. On Windows a variable's name is the same in any
 * case, so `node_options` is read, and taken out, as `NODE_OPTIONS` is.
 */
export declare function updateCheckChildEnvironment(env: NodeJS.ProcessEnv, platform?: NodeJS.Platform): NodeJS.ProcessEnv;
/**
 * The hidden command's work, in the child a command started (`UPDATE_CHECK_CHILD_COMMAND`): the ask, under the claim
 * the command took and handed over. It claims nothing itself, and asks only while the file still holds that claim —
 * a claim that ran out, and that another process took since, is that process's to ask under. It says `settled` to the
 * command if the command is still listening, lets go of the channel, and ends; a command that stopped listening has
 * already gone on, and the ask is finished all the same. Results are written only while the claim is this child's.
 */
export declare function runUpdateCheckChild(core: Core, env: NodeJS.ProcessEnv, claimedAt: string | undefined): Promise<void>;
/**
 * What a command at a terminal hands the update gate (`updateGateAtTerminal`): the check, and the update itself for
 * the person's "now" — its own preview and yes.
 *
 * Every command but WhatsApp's is given these. WhatsApp's is given neither, and reads the file as it is.
 */
export declare function terminalUpdateHooks(core: Core, env: NodeJS.ProcessEnv, options: {
  output: OutputOptions;
  streams: Streams;
  /** The command that approves a change beside this CLI — see `gatedChangeAtTerminal`. */
  approveCommand?: string | undefined;
  /** Stand-ins for the registry and `npm ls`, for a test: the check is then asked in this process. */
  deps?: UpdateDeps | undefined;
  now?: (() => Date) | undefined;
  /**
   * How to start the child the check is handed to: this CLI, found from the running script, when left out. For a
   * test, one that cannot be started, or null for none, and the check is asked in this process instead.
   */
  childEntry?: UpdateCheckChildEntry | null | undefined;
}): TerminalUpdateHooks;
//#endregion
//#region src/version.d.ts
/** The package version, read from package.json at build time. */
export declare const VERSION: string;
//#endregion
//#region src/versions.d.ts
/**
 * Versions as semver writes and orders them — what an update compares, and what the daily update check's reader needs
 * to decide whether the release it last heard of is newer than the one running.
 *
 * Here rather than in `npm.ts`, which also talks to the registry: the reader of `update-check.json` is imported by
 * every server, WhatsApp's included, and must carry no network code at all (design 2026-09-28 §1). `npm.ts` re-exports
 * all of it, so nothing that imported these from there changes.
 */
/**
 * A version, exactly as semver writes one: `1.2.3`, `1.2.3-rc.1`, `1.2.3+build`.
 *
 * Anything the registry answers is checked against this before it is used, because a version goes into a directory
 * name (`runtime/<version>-gmail`), a sentence a person approves, and an argument to `npm install`. A registry — or a
 * mirror somebody configured — that answered `../x` or `1.0.0 && …` would otherwise put that in all three.
 */
export declare const VERSION_PATTERN: RegExp;
export declare function isVersion(value: unknown): value is string;
/**
 * Semver precedence: -1, 0 or 1, or null when either is not a version.
 *
 * Numbers compare as numbers (`0.10.0` is after `0.9.9`), a prerelease comes before its release, and build metadata
 * counts for nothing. Written out rather than taken from a dependency: it is twenty lines, and the core installs as
 * few packages as it can.
 */
export declare function compareVersions(a: string, b: string): -1 | 0 | 1 | null;
/** Whether `version` is older than `latest`: by semver when both are versions, and otherwise whenever they differ. */
export declare function isBehind(version: string, latest: string): boolean;
/**
 * Whether a version is a prerelease — `0.8.0-rc.1` — which the daily update check never counts as an update: a
 * machine is not told to "update" to a release candidate, nor a candidate told to go back to the last release.
 */
export declare function isPrerelease(version: string): boolean;
//#endregion
//#region src/index.d.ts
export declare const PACKAGE_NAME = "@agentcomms/core";
//#endregion
export { ACCOUNT_ID_PATTERN, ACCOUNT_MODES, ALIAS_PATTERN, APPROVAL_TTL_MS, APP_DIR_NAME, AccountConfig, AccountMode, ApprovalChannel, ApprovalKind, ApprovalRecord, ApprovalState, ApprovalStore, AuditLog, AuditRecord, type BuiltInChannel, CapStatus, Caps, ChallengeOptions, ChangeApprovalPrompt, ChangeBinding, ChangeOptions, ChangePolicy, ChangeRequest, ChangeSpec, ChangeSurface, ChangeTarget, ClaimOptions, ClientConfig, CommsError, CommsErrorOptions, CondensedIds, Config, ConfigStore, ConfigUpdateResult, ConfigV1, ConfigV2, type ConfigVersion, ConnectedAccount, Core, CreateApprovalInput, CreateChangeApprovalInput, DIGEST_VERSION, DOWNLOAD_ANSWER_HINT, DOWNLOAD_QUESTION_TTL_MS, DOWNLOAD_SUFFIX, Defaults, DownloadBinding, DownloadRequest, ERROR_REGISTRY, EXIT_CODES, ErrorCode, ErrorSpec, Expectation, FileSecretStore, FormerName, FormerNames, GatedChange, GatedOutcome, type GenerationState, INBOX_ID_PATTERN, INERT_EXTENSIONS, InboxConfig, InboxRuntimeState, InboxStateStore, KEYCHAIN_SERVICE, KEYCHAIN_TIMEOUT_MS, KeychainSecretStore, KeyringModule, ListedFile, LiveChange, LiveDraft, Loosening, LooseningConsent, MAX_CHALLENGE_ATTEMPTS, NEW_CONFIG_VERSION, OpenCoreOptions, type OrgAddRequest, type OrgChangeResult, type OrgOptions, OrganisationGeneration, type OrganisationProfile, OrganisationRecord, OrganisationServes, OrganisationSlackApp, OutputOptions, PLAN_TTL_MS, PUBLIC_MAILBOX_DOMAINS, PathEnvironment, PendingRevocation, PendingRevocationStatus, PendingRevocationTokenState, PersonGate, PlanRecord, PlanStore, PreparedChange, ProbeResult, type ProfileFile, type ProfileSlackTarget, READABLE_CONFIG_VERSIONS, RESERVED_ALIASES, RecordedSaveAnswer, RenameReason, RenamedAccount, ResolvedPaths, SAVED_NAME_BYTES, SENDING_STALE_MS, SavedName, SecretStore, SecretStoreKind, SendLedger, SendPolicy, type ServerInstallRequest, type ServerInstallResult, type ServerPruneRequest, SettingChange, SettingValue, ShellCommand, StoreKind, Streams, TAINT_WINDOW_MS, TaintCheck, TaintCollector, TaintExclusions, TaintHandle, TaintHandleObservation, TaintObservation, TaintSource, TaintStore, type UpdateAutoResult, UpdateCheckSetting, type UpdateDeps, type UpdateLaterResult, WarnedFile, accountHome, agentMarker, aliasConflicts, approvalHint, approvalKind, approveChangeAtTerminal, approveCommandOf, askChallenge, beginChangeApproval, canPrompt, canonicalAddress, canonicalHandle, canonicalLoosening, changeApprovalCommand, changeDigest, changeDrift, changeToolResult, changedSettings, claimChange, classifyChange, colorEnabled, commandAsJson, commandText, committedSecretsStore, comparablePath, configCommittedBeforeAbort, configFingerprint, configV1Schema, configV2Schema, connectedAccounts, defaultChangePolicy, defaultInternalDomains, defaultStreams, domainOf, downloadClaimRefusal, downloadDigest, downloadDrift, duplicateInbox, effectiveAccountSendPolicy, effectiveChangePolicy, effectiveSendPolicy, emptyConfig, expandHome, extractAddresses, fileRisks, fileWarnings, findConnectedAccount, findInboxById, finishChangeApproval, gatedChange, gatedChangeAtTerminal, governingChangePolicy, homeDirectory, homeOf, idsDigest, inlineCommand, isCommsError, isInertName, isInsideDirectory, isPlainFileName, isValidAlias, keychainNamespace, loadKeyringModule, newAccountId, newInboxId, openCore, openSecretStore, paint, paramsDigest, parseConfig, prepareChange, probeKeychain, publicView, readsOnItsOwn, recipientDomains, recordChangeApprovalRefused, refuseUnclaimedApproval, refuseUnlessPerson, renameWords, renderChangePreview, requirePerson, resolvePaths, revokeChange, runCommand, sameExpectation, sameLoosening, savedFileName, savedName, secretsStoreFor, secretsStoreOf, shellCommand, shortenHome, stricterPolicy, toCommsError, updateCheckSetting, withWords, writeError, writeResult };