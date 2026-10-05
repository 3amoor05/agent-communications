#!/usr/bin/env node
import { C as updateCheck, Dn as renderDoctor, Fa as colorEnabled, Gt as openCore, Ht as wholeNumber, J as channelsAvailable, Ka as writeError, La as commandText, Mn as renderUpdate, Mo as CommsError, Nn as renderUpdateCheck, Po as EXIT_CODES, Ra as defaultStreams, S as updateChange, Ua as runCommand, Wa as shellCommand, X as serverPruneChange, Y as serverInstallChange, Z as VERSION, a as runUpdateCheckChild, at as orgRemoveChange, b as updateAutoChange, dn as refuseUnclaimedApproval, g as exemptFromUpdateGate, it as orgList, jn as renderPrune, kn as renderInstall, l as CHANGE_CLAIM, mn as changeApprovalCommand, o as terminalUpdateHooks, ot as orgShow, pr as installExitStatus, qa as writeResult, rt as orgAddChange, sn as approveChangeAtTerminal, st as orgUpdateChange, un as gatedChangeAtTerminal, v as updateGateAtTerminal, wt as shownPath, x as updateLaterChange, yt as profileSourcePath, za as inlineCommand } from "./update-check-C8sNjCez.mjs";
import { _ as attachReport, a as auditTail, c as listApprovals, d as changePolicyChange, f as changePolicyReport, g as attachChange, i as namesMigration, l as revokeApproval, m as refuseApprovalWithoutChange, n as secretsMigration, o as corePaths, p as isChangePolicy, r as namesDryRun, s as doctor, t as migrationLeftoversError } from "./secrets-migrate-DSFfruvx.mjs";
import { parseArgs } from "node:util";
//#region src/cli.ts
/**
* `agentcomms` — the provider-neutral command: where things live, whether this machine is healthy, what was written
* to mailboxes, which approvals exist, moving secrets between backends, the change policy, and registering the MCP
* servers of every channel. A channel's own commands live in its own binary (`agent-gmail`, `agent-slack`, …).
*
* Every command here is an operation in `src/operations/` that the core MCP server's tool calls too, and every one
* that changes something goes through `gatedChangeAtTerminal`: a person at a terminal approves there and then, and an
* agent gets the preview and an approval id (exit 10) and runs the command again with `--approval <id>`.
*
* Nothing a library imports may import this file: it starts `main()` when the running script is called `cli.mjs`,
* which is what every product's CLI is called.
*/
const HELP = `agentcomms ${VERSION} — agent-communications core

Usage:
  agentcomms paths                         where config, state, data and downloads live
  agentcomms doctor                        check this machine: Node, directories, secret store, and which MCP
                                           clients start each server
  agentcomms audit tail [--inbox <alias>] [--since <ISO time>] [--limit <n>]
  agentcomms approvals list [--inbox <alias>] [--state <state>]
  agentcomms approvals revoke <approvalId>
  agentcomms approve <approvalId>          approve a configuration change at this terminal: read it, type the code
  agentcomms policy [--account <name> | --inbox <name>] [chat|confirm] [--approval <id>]
                                           report or set the change policy: how a loosening is approved;
                                           confirm applies at once, chat is approved first
  agentcomms attach                        which files may be attached: the folders they may come from, the
                                           paths they never may, and the built-in list
  agentcomms attach roots add <folder> [--approval <id>]
                                           let files under a folder be attached: approved first
  agentcomms attach roots remove <folder>  stop attaching files from under a folder: applies at once
  agentcomms attach deny add <path>        never attach files from a path: applies at once
  agentcomms attach deny remove <path> [--approval <id>]
                                           take one of your own deny entries away: approved first
  agentcomms channels                      which channel servers exist, which are installed, and where they are registered
  agentcomms org add <file> [--for-other-addresses] [--adopt <client>] [--store keychain|file] [--approval <id>]
                                           add an organisation's profile — its Google client and Slack apps,
                                           beside what is here: approved first
  agentcomms org list                      the organisation profiles added here
  agentcomms org show <organisation>       one profile: its clients, which mailboxes use them, and any drift
  agentcomms org update <organisation> [--source <file>] [--for-other-addresses on|off] [--adopt <client>]
                                           [--store keychain|file] [--approval <id>]
                                           read a profile again and repair drift: a changed profile, a new
                                           source and --for-other-addresses on are approved first
  agentcomms org remove <organisation> [--approval <id>]
                                           forget a profile and the clients it made: approved first
  agentcomms mcp                           run the core MCP server on stdio (what an MCP client starts)
  agentcomms mcp install --client <client> [--name <name>] [--launcher managed|npx|local] [--force]
                                           [--print] [--no-verify] [--approval <id>]
                                           register the core MCP server with a client, and prove it starts
  agentcomms mcp prune [--dry-run] [--include-printed] [--approval <id>]
                                           remove the core's managed runtimes that nothing uses
  agentcomms update [--check] [--no-verify] [--approval <id>]
                                           bring every registration, runtime and global package to the latest
                                           release; --check only says what is behind
  agentcomms update --later [--approval <id>]
                                           not now: nothing stops for the update until midnight
  agentcomms update --auto on|off [--approval <id>]
                                           turn the daily update check on or off for this machine
  agentcomms secrets migrate --to keychain|file [--approval <id>]
  agentcomms names migrate [--rename <old>=<new>] [--dry-run] [--approval <id>]

A change that loosens something or cannot be taken back — policy chat, attach roots add, attach deny remove, mcp
install and prune, update, secrets and names migrate, org add, update and remove — is shown before it happens. At a
terminal you approve it there; anything else gets the preview and an approval id (exit 10), and runs the command again
with --approval <id> once the person has agreed: in the chat under the \`chat\` change policy, with \`agentcomms
approve\` under \`confirm\`. A tightening — policy confirm, attach roots remove, attach deny add — applies at once and
asks nobody, and a --dry-run changes nothing.

Once a day this machine asks npm whether a newer release is out. When one is, every command but update, doctor,
paths, approve and approvals stops first: at a terminal it asks "Update now, later today, or cancel?"; anywhere else
it exits 11 and names \`agentcomms update\` and \`agentcomms update --later\`. Putting it off (--later) and turning the
check off (--auto off) are changes a person approves. CI, and AGENT_COMMS_UPDATE_CHECK=off, skip it.

Options:
  --json        print the versioned JSON envelope
  --no-color    disable colour (also NO_COLOR, TERM=dumb)
  -h, --help    show this help
  -v, --version show the version

Exit codes: 0 ok · 1 unexpected · 10 approval required · 11 an update is out: update first, or put it off
            64 usage · 65 bad data · 66 not found · 69 provider unavailable · 75 transient
            77 auth or scope missing · 78 config error
`;
function usage(message) {
	return new CommsError("USAGE", message, { hint: "Run `agentcomms --help`." });
}
function parse(argv) {
	return parseArgs({
		args: argv,
		allowPositionals: true,
		strict: true,
		tokens: true,
		options: {
			json: {
				type: "boolean",
				default: false
			},
			"no-color": {
				type: "boolean",
				default: false
			},
			help: {
				type: "boolean",
				short: "h",
				default: false
			},
			version: {
				type: "boolean",
				short: "v",
				default: false
			},
			inbox: { type: "string" },
			account: { type: "string" },
			since: { type: "string" },
			limit: { type: "string" },
			state: { type: "string" },
			to: { type: "string" },
			rename: {
				type: "string",
				multiple: true
			},
			"dry-run": {
				type: "boolean",
				default: false
			},
			yes: {
				type: "boolean",
				default: false
			},
			approval: { type: "string" },
			client: { type: "string" },
			name: { type: "string" },
			launcher: { type: "string" },
			force: {
				type: "boolean",
				default: false
			},
			print: {
				type: "boolean",
				default: false
			},
			"no-verify": {
				type: "boolean",
				default: false
			},
			"include-printed": {
				type: "boolean",
				default: false
			},
			check: {
				type: "boolean",
				default: false
			},
			later: {
				type: "boolean",
				default: false
			},
			auto: { type: "string" },
			"for-other-addresses": {
				type: "boolean",
				default: false
			},
			adopt: { type: "string" },
			store: { type: "string" },
			source: { type: "string" }
		}
	});
}
/**
* The words of the command line with the one after `--for-other-addresses` taken out, and that word.
*
* `org add` takes the flag alone; `org update` takes `on` or `off` after it. One option cannot be both a flag and a
* string to `parseArgs`, and a string option would swallow the file in `org add --for-other-addresses ./rgc.json`. So it
* is a flag, and the word right after it, where there is one, is read from the tokens.
*/
function forOtherAddressesWord(parsed) {
	const tokens = parsed.tokens ?? [];
	const at = tokens.findIndex((token) => token.kind === "option" && token.name === "for-other-addresses");
	const next = at === -1 ? void 0 : tokens[at + 1];
	if (next?.kind !== "positional" || next.value !== "on" && next.value !== "off") return {
		positionals: parsed.positionals,
		word: void 0
	};
	return {
		positionals: tokens.flatMap((token) => token.kind === "positional" && token !== next ? [token.value] : []),
		word: next.value
	};
}
const CLIENT_NAMES = [
	"claude-code",
	"claude-desktop",
	"codex",
	"cursor",
	"gemini",
	"vscode",
	"json"
];
/**
* Whether a command takes `--approval`: one that makes a change a person approves — `policy` with a policy to set,
* `mcp install`, `mcp prune`, `names migrate`, `secrets migrate` and `update` — where it is how the second run claims
* that change. Every one of them is a change, so what it claims is a change approval.
*/
function takesApproval(command, sub) {
	switch (command) {
		case "policy":
		case "attach": return sub !== void 0;
		case "mcp": return sub === "install" || sub === "prune";
		case "names":
		case "secrets": return sub === "migrate";
		case "update": return true;
		case "org": return sub === "add" || sub === "update" || sub === "remove";
		default: return false;
	}
}
/**
* Refuses `--approval` on a command that takes none, as USAGE.
*
* Parsed as one option for every command, it was carried to the update check's stop whatever the command, and the
* stop lets a command claiming an approval through (§2): `agentcomms channels --approval <id>`, with an old "not now"
* the person had turned down, ran past it. Over MCP the same calls are refused an `approvalId` their tools do not
* declare, and every channel's command is refused an option it does not take, before anything runs. So is this one.
*/
function refuseApprovalNotTaken(command, sub, approvalId) {
	if (approvalId === void 0 || takesApproval(command, sub)) return;
	if (command === "policy") refuseApprovalWithoutChange(String(approvalId));
	const typed = [
		"agentcomms",
		command,
		sub
	].filter((word) => word !== void 0).join(" ");
	throw new CommsError("USAGE", `\`${typed}\` takes no --approval: it makes no change a person approves`, { hint: "An approval goes with the change it was prepared for — policy chat|confirm, attach roots|deny add|remove, org add|update|remove, mcp install, mcp prune, names migrate, secrets migrate or update — run again exactly as the preview named it. Nothing was run." });
}
/**
* Refuses `org`'s own options on any other command, as USAGE, before anything runs.
*
* One parser reads every command's options, so `--store` was known to `secrets migrate` too, and taken there without
* a word — beside `--to`, which is what that command reads. An option a command does not read is refused, as every
* channel's command refuses one, rather than quietly doing nothing.
*/
function refuseOrgOptionsElsewhere(command, values, platform) {
	if (command === "org") return;
	const given = [
		...values["for-other-addresses"] ? ["--for-other-addresses"] : [],
		...values.adopt !== void 0 ? ["--adopt"] : [],
		...values.store !== void 0 ? ["--store"] : [],
		...values.source !== void 0 ? ["--source"] : []
	];
	if (given.length === 0) return;
	throw new CommsError("USAGE", `${given.join(", ")} ${given.length === 1 ? "is an option" : "are options"} of ${inlineCommand(shellCommand(["agentcomms", "org"], platform))} only`, { hint: `Run ${inlineCommand(shellCommand(["agentcomms", "--help"], platform))} for what each command takes. Nothing was run.` });
}
async function main(argv = process.argv.slice(2), env = process.env, platform = process.platform, deps = {}) {
	let parsed;
	try {
		parsed = parse(argv);
	} catch (error) {
		const json = argv.includes("--json");
		return writeError(usage(error instanceof Error ? error.message : String(error)), {
			json,
			color: false
		});
	}
	const { values, positionals } = parsed;
	const output = {
		json: values.json,
		color: colorEnabled(env, process.stdout, values["no-color"] ? false : void 0),
		platform
	};
	if (values.version) {
		process.stdout.write(`${VERSION}\n`);
		return 0;
	}
	if (values.help || positionals.length === 0) {
		process.stdout.write(HELP);
		return 0;
	}
	const [command, sub, arg] = positionals;
	try {
		refuseApprovalNotTaken(command, sub, values.approval);
		refuseOrgOptionsElsewhere(command, values, platform);
	} catch (error) {
		return writeError(error, output);
	}
	const core = openCore({ env });
	const approval = {
		approvalId: values.approval,
		env,
		output
	};
	/** An exit status for a command that printed its result and still did not do what was asked. */
	let softExit = EXIT_CODES.OK;
	if (command === "mcp" && sub === void 0) {
		if (values.json) return writeError(usage("`agentcomms mcp` runs the server; it prints no result"), output);
		await (deps.startMcp ?? (await import("./server-Csk0qF0q.mjs")).startCoreStdioServer)({
			core,
			env,
			platform
		});
		return EXIT_CODES.OK;
	}
	if (command === "update-check-child") return runCommand(output, () => runUpdateCheckChild(core, env, sub));
	if (!exemptFromUpdateGate(positionals.slice(0, 2))) {
		let ended = null;
		const gated = await runCommand(output, async () => {
			ended = await updateGateAtTerminal({
				core,
				env,
				binary: "agentcomms",
				channel: "core",
				running: VERSION,
				output,
				streams: defaultStreams,
				approvals: takesApproval(command, sub) ? [values.approval] : [],
				approvalClaim: CHANGE_CLAIM,
				...terminalUpdateHooks(core, env, {
					output,
					streams: defaultStreams
				})
			});
		});
		if (gated !== EXIT_CODES.OK) return gated;
		if (ended !== null) return ended;
	}
	const code = await runCommand(output, async () => {
		switch (command) {
			case "paths":
				writeResult(corePaths(core), output, (p) => Object.entries(p).map(([k, v]) => `${k.padEnd(13)} ${v}`).join("\n"));
				return;
			case "doctor": {
				const report = await doctor(core, env, { platform });
				writeResult(report, output, renderDoctor);
				if (!report.ok) throw new CommsError("CONFIG", "doctor found problems", { hint: "Apply the fixes listed above." });
				return;
			}
			case "audit": {
				if (sub !== "tail") throw usage("usage: agentcomms audit tail");
				const limit = wholeNumber(values.limit, {
					name: "--limit",
					min: 1
				});
				const records = await auditTail(core, {
					inbox: values.inbox,
					since: values.since,
					limit
				});
				writeResult(records, output, (rs) => rs.length ? rs.map((r) => `${r.at}  ${r.alias ?? r.inboxId}  ${r.operation}  ${r.outcome}${r.reason ? `  (${r.reason})` : ""}`).join("\n") : "no audit records");
				return;
			}
			case "approvals":
				if (sub === "list") {
					const records = await listApprovals(core, {
						inbox: values.inbox,
						state: values.state
					});
					writeResult(records, output, (rs) => rs.length ? rs.map((r) => `${r.approvalId}  ${r.state.padEnd(8)}  ${r.policy}  expires ${r.expiresAt}`).join("\n") : "no approvals");
					return;
				}
				if (sub === "revoke") {
					if (!arg) throw usage("usage: agentcomms approvals revoke <approvalId>");
					const record = await revokeApproval(core, arg, "cli");
					writeResult(record, output, (r) => `${r.approvalId} is ${r.state}`);
					return;
				}
				throw usage("usage: agentcomms approvals list|revoke");
			case "approve": {
				if (!sub || arg !== void 0) throw usage("usage: agentcomms approve <approvalId>");
				const result = await approveChangeAtTerminal(core, sub, env, output);
				writeResult(result, output, (r) => r.state === "approved" ? "Approved. The agent can make the change now — this command approves; it changes nothing itself." : "Cancelled. Nothing was changed.");
				return;
			}
			case "policy": {
				if (arg !== void 0) throw usage("usage: agentcomms policy [--account <name> | --inbox <name>] [chat|confirm]");
				const scope = {
					inbox: values.inbox,
					account: values.account
				};
				if (sub === void 0) {
					writeResult(changePolicyReport(await core.config.load(), scope, platform), output, renderPolicy);
					return;
				}
				if (!isChangePolicy(sub)) throw usage(`"${sub}" is not a change policy; use chat or confirm`);
				const where = values.account ? ["--account", values.account] : values.inbox ? ["--inbox", values.inbox] : [];
				const report = await gatedChangeAtTerminal(core, changePolicyChange(core, scope, sub, platform), {
					...approval,
					command: shellCommand([
						"agentcomms",
						"policy",
						...where,
						sub
					], platform)
				});
				writeResult(report, output, renderPolicy);
				return;
			}
			case "attach": {
				const [, list, action, path, ...extra] = positionals;
				if (list === void 0) {
					writeResult(await attachReport(core, env), output, (report) => renderAttach(report, platform));
					return;
				}
				const kind = ATTACH_KINDS[`${list} ${action ?? ""}`];
				if (kind === void 0 || path === void 0 || extra.length > 0) throw usage("usage: agentcomms attach [roots|deny add|remove <path>] [--approval <id>]");
				const result = await gatedChangeAtTerminal(core, attachChange(core, env, {
					kind,
					path
				}, "cli"), {
					...approval,
					command: shellCommand([
						"agentcomms",
						"attach",
						list,
						action,
						path
					], platform)
				});
				writeResult(result, output, (change) => renderAttachChange(change, platform));
				return;
			}
			case "org": {
				const { positionals: words, word } = forOtherAddressesWord(parsed);
				const [, , target, ...extra] = words;
				const orgOptions = {
					env,
					platform,
					surface: "cli"
				};
				const flagsOf = (taken) => {
					const wrong = [
						["for-other-addresses", values["for-other-addresses"]],
						["adopt", values.adopt !== void 0],
						["store", values.store !== void 0],
						["source", values.source !== void 0]
					].filter(([, on]) => on).map(([flag]) => flag).filter((flag) => !taken.includes(flag));
					if (wrong.length > 0) throw usage(`${inlineCommand(shellCommand([
						"agentcomms",
						"org",
						...sub === void 0 ? [] : [sub]
					], platform))} takes no --${wrong.join(", --")}`);
				};
				if (sub === "list") {
					if (target !== void 0) throw usage("usage: agentcomms org list");
					flagsOf([]);
					writeResult(await orgList(core, platform), output, (views) => renderOrgList(views, platform));
					return;
				}
				if (sub === "show") {
					if (target === void 0 || extra.length > 0) throw usage("usage: agentcomms org show <organisation>");
					flagsOf([]);
					writeResult(await orgShow(core, target, platform), output, renderOrg);
					return;
				}
				if (sub === "add") {
					if (target === void 0 || extra.length > 0 || word !== void 0) throw usage("usage: agentcomms org add <file> [--for-other-addresses] [--adopt <client>] [--store keychain|file]");
					flagsOf([
						"for-other-addresses",
						"adopt",
						"store"
					]);
					const repeated = rerunPath(profileSourcePath(target, env, void 0, platform));
					const command = repeated === null ? [
						"agentcomms",
						"org",
						"add",
						"--help"
					] : [
						"agentcomms",
						"org",
						"add",
						repeated
					];
					if (values["for-other-addresses"]) command.push("--for-other-addresses");
					if (values.adopt !== void 0) command.push("--adopt", values.adopt);
					if (values.store !== void 0) command.push("--store", values.store);
					const result = await gatedChangeAtTerminal(core, orgAddChange(core, {
						file: target,
						forOtherAddresses: values["for-other-addresses"],
						adopt: values.adopt,
						store: values.store,
						approvalId: values.approval
					}, orgOptions), {
						...approval,
						command: shellCommand(command, platform),
						...repeated === null ? { pendingHint: (prepared) => hiddenPathApprovalHint(prepared, platform) } : {}
					});
					writeResult(result, output, renderOrgChange);
					return;
				}
				if (sub === "update") {
					if (target === void 0 || extra.length > 0 || values["for-other-addresses"] && word === void 0) throw usage("usage: agentcomms org update <organisation> [--source <file>] [--for-other-addresses on|off] [--adopt <client>] [--store keychain|file]");
					flagsOf([
						"for-other-addresses",
						"adopt",
						"store",
						"source"
					]);
					const command = [
						"agentcomms",
						"org",
						"update",
						target
					];
					let repeatedSource = true;
					if (values.source !== void 0) {
						const source = rerunPath(profileSourcePath(values.source, env, void 0, platform));
						repeatedSource = source !== null;
						if (source !== null) command.push("--source", source);
					}
					if (word !== void 0) command.push("--for-other-addresses", word);
					if (values.adopt !== void 0) command.push("--adopt", values.adopt);
					if (values.store !== void 0) command.push("--store", values.store);
					const result = await gatedChangeAtTerminal(core, orgUpdateChange(core, {
						organisation: target,
						source: values.source,
						forOtherAddresses: word,
						adopt: values.adopt,
						store: values.store,
						approvalId: values.approval
					}, orgOptions), {
						...approval,
						command: shellCommand(repeatedSource ? command : [
							"agentcomms",
							"org",
							"update",
							"--help"
						], platform),
						...!repeatedSource ? { pendingHint: (prepared) => hiddenPathApprovalHint(prepared, platform) } : {}
					});
					writeResult(result, output, renderOrgChange);
					return;
				}
				if (sub === "remove") {
					if (target === void 0 || extra.length > 0) throw usage("usage: agentcomms org remove <organisation>");
					flagsOf([]);
					const result = await gatedChangeAtTerminal(core, orgRemoveChange(core, { organisation: target }, orgOptions), {
						...approval,
						command: shellCommand([
							"agentcomms",
							"org",
							"remove",
							target
						], platform)
					});
					writeResult(result, output, renderOrgRemove);
					return;
				}
				throw usage("usage: agentcomms org add|list|show|update|remove");
			}
			case "channels":
				if (sub !== void 0) throw usage("usage: agentcomms channels");
				writeResult(await channelsAvailable(core, env), output, renderChannels);
				return;
			case "mcp":
				if (sub === "install") {
					if (!values.client) throw new CommsError("USAGE", "name the client with --client", { hint: "For example: `agentcomms mcp install --client claude-code`." });
					if (!CLIENT_NAMES.includes(values.client)) throw usage(`--client must be one of: ${CLIENT_NAMES.join(", ")}`);
					const words = [
						"agentcomms",
						"mcp",
						"install",
						"--client",
						values.client
					];
					if (values.name) words.push("--name", values.name);
					if (values.launcher) words.push("--launcher", values.launcher);
					if (values.force) words.push("--force");
					if (values["no-verify"]) words.push("--no-verify");
					const result = await gatedChangeAtTerminal(core, serverInstallChange(core, env, {
						channel: "core",
						client: values.client,
						name: values.name,
						launcher: values.launcher,
						force: values.force,
						print: values.print,
						noVerify: values["no-verify"]
					}), {
						...approval,
						command: shellCommand(words, platform)
					});
					softExit = installExitStatus(result);
					writeResult(result, output, (r) => renderInstall(r, output.color));
					return;
				}
				if (sub === "prune") {
					const words = [
						"agentcomms",
						"mcp",
						"prune"
					];
					if (values["include-printed"]) words.push("--include-printed");
					const result = await gatedChangeAtTerminal(core, serverPruneChange(core, env, {
						channel: "core",
						dryRun: values["dry-run"],
						includePrinted: values["include-printed"]
					}), {
						...approval,
						command: shellCommand(words, platform)
					});
					writeResult(result, output, (r) => renderPrune(r, output.color));
					return;
				}
				throw usage("usage: agentcomms mcp [install|prune]");
			case "update": {
				if (sub !== void 0) throw usage("usage: agentcomms update [--check | --later | --auto on|off] [--no-verify] [--approval <id>]");
				if ([
					values.check,
					values.later,
					values.auto !== void 0
				].filter(Boolean).length > 1 || values["no-verify"] && (values.later || values.auto !== void 0)) throw usage("--check, --later and --auto are one at a time, and --no-verify is for the update itself");
				if (values.later) {
					const result = await gatedChangeAtTerminal(core, updateLaterChange(core), {
						...approval,
						command: "agentcomms update --later"
					});
					writeResult(result, output, renderLater);
					return;
				}
				if (values.auto !== void 0) {
					if (values.auto !== "on" && values.auto !== "off") throw usage("--auto takes on or off");
					const result = await gatedChangeAtTerminal(core, updateAutoChange(core, values.auto), {
						...approval,
						command: shellCommand([
							"agentcomms",
							"update",
							"--auto",
							values.auto
						], platform)
					});
					writeResult(result, output, renderAuto);
					return;
				}
				if (values.check) {
					if (values.approval !== void 0) throw usage("--check only reads, so it takes no --approval; leave out --check to update");
					writeResult(await updateCheck(core, env), output, renderUpdateCheck);
					return;
				}
				const words = ["agentcomms", "update"];
				if (values["no-verify"]) words.push("--no-verify");
				const result = await gatedChangeAtTerminal(core, updateChange(core, env, { noVerify: values["no-verify"] }), {
					...approval,
					command: shellCommand(words, platform)
				});
				softExit = result.ok ? EXIT_CODES.OK : EXIT_CODES.UNAVAILABLE;
				writeResult(result, output, (r) => renderUpdate(r, output.color));
				return;
			}
			case "names": {
				if (sub !== "migrate") throw usage("usage: agentcomms names migrate [--rename <old>=<new>] [--dry-run] [--approval <id>]");
				if (values.yes) throw new CommsError("USAGE", "--yes no longer skips the question: renaming every account is a change a person approves", { hint: "Run it without --yes. At a terminal you approve it there; anything else gets the preview and an approval id, and runs it again with --approval <id> once the person has agreed." });
				const renames = values.rename ?? [];
				if (values["dry-run"]) refuseUnclaimedApproval(values.approval, {
					message: "--dry-run only shows the mapping, so it takes no --approval",
					hint: "Leave out --dry-run to rename; anything without a terminal gets the preview and the approval id to run it again with."
				});
				const dry = namesDryRun(await core.config.load(), renames);
				if (dry.status === "already-migrated") {
					if (values.approval === void 0) {
						writeResult(dry, output, () => "Names are already organisation/platform.");
						return;
					}
				} else if (values["dry-run"]) {
					writeResult(dry, output, (data) => `${renderMapping(data.rows, data.notApplicable)}\n\nNothing was changed. Run the same command without --dry-run to apply it.`);
					return;
				} else defaultStreams.stderr.write(`${renderMapping(dry.rows, dry.notApplicable)}\n`);
				const result = await gatedChangeAtTerminal(core, namesMigration(core, renames), {
					...approval,
					command: shellCommand([
						"agentcomms",
						"names",
						"migrate",
						...renames.flatMap((rename) => ["--rename", rename])
					], platform)
				});
				writeResult(result, output, (data) => data.status === "already-migrated" || !("rows" in data) ? "Names are already organisation/platform." : [`Renamed ${data.rows.length} account(s). The old names no longer work; anything that uses one is told what it is called now.`, ...data.backup ? [`The configuration as it was is saved at ${data.backup}.`] : []].join("\n"));
				return;
			}
			case "secrets": {
				if (sub !== "migrate" || values.to !== "keychain" && values.to !== "file") throw usage("usage: agentcomms secrets migrate --to keychain|file");
				const result = await gatedChangeAtTerminal(core, secretsMigration(core, values.to, {
					surface: "cli",
					platform
				}), {
					...approval,
					command: shellCommand([
						"agentcomms",
						"secrets",
						"migrate",
						"--to",
						values.to
					], platform)
				});
				const leftovers = migrationLeftoversError(result);
				if (leftovers) throw leftovers;
				writeResult(result, output, (r) => r.moved === 0 && r.from === r.to ? `secrets already use ${r.to}` : `moved ${r.moved} secrets from ${r.from} to ${r.to}`);
				return;
			}
			default: throw usage(`unknown command "${command}"`);
		}
	});
	return code === EXIT_CODES.OK ? softExit : code;
}
function renderPolicy(report) {
	const where = report.name === null ? "Default change policy" : `Change policy of ${report.name}`;
	const how = report.changePolicy === "chat" ? "a yes in the chat approves a loosening" : "a loosening needs a code typed at a terminal";
	const lines = [`${where}: ${report.changePolicy} — ${how}${report.setHere === null ? " (not set here; the default)" : ""}.`];
	for (const override of report.overrides ?? []) lines.push(`  ${override.kind === "inbox" ? "mailbox  " : "workspace"}  ${override.name}: ${override.changePolicy}`);
	if (report.warning && report.looser && report.looser.length > 0) {
		lines.push("", `Warning: ${report.warning} To tighten ${report.looser.length === 1 ? "it" : "them"}:`);
		for (const entry of report.looser) lines.push(`  ${entry.tighten.command}`);
	}
	return lines.join("\n");
}
/** `attach roots add` and the rest, by their words. */
const ATTACH_KINDS = {
	"roots add": "rootsAdd",
	"roots remove": "rootsRemove",
	"deny add": "denyAdd",
	"deny remove": "denyRemove"
};
function renderAttachEntries(entries) {
	if (entries.length === 0) return ["  (none)"];
	return entries.map((entry) => entry.real === null || entry.real === entry.path ? `  ${entry.path}` : `  ${entry.path}  (${entry.real})`);
}
/** Exported for its test, which asks for Windows' quoting by name. */
function renderAttach(report, platform = process.platform) {
	return [
		"Files may be attached from under:",
		...renderAttachEntries(report.roots),
		...report.roots.length === 0 ? ["  — so nothing can be attached."] : [],
		...report.ignored.length === 0 ? [] : [
			"",
			"Listed, but allowing nothing — they do not say which drive or folder they are on. To take one out, run the",
			"command shown for it:",
			...report.ignored.map((root) => `  ${commandText(shellCommand([
				"agentcomms",
				"attach",
				"roots",
				"remove",
				root
			], platform))}`)
		],
		"",
		"Never from, by your own entries:",
		...renderAttachEntries(report.deny),
		"",
		"Never from, whatever the configuration says:",
		...renderAttachEntries(report.builtIn),
		"",
		"To allow another folder: agentcomms attach roots add <folder> (you approve it first).",
		"To stop attaching from one: agentcomms attach roots remove <folder>; to deny a path: agentcomms attach deny add <path>."
	].join("\n");
}
function renderAttachChange(result, platform) {
	const done = result.changed ? "Done." : "Nothing was changed.";
	return [
		result.note ?? done,
		"",
		renderAttach(result, platform)
	].join("\n");
}
/**
* A profile's path in the command an agent is told to run again: as it is, or absent when showing it would change it
* because its name holds text that looks like a chat-template token. The hint then names only the approval option and
* says why the path is not repeated; a made-up path or placeholder must never be presented as a command word.
*/
function rerunPath(path) {
	return shownPath(path) === path ? path : null;
}
function hiddenPathApprovalHint(prepared, platform) {
	const carrying = inlineCommand(shellCommand(["--approval", prepared.approvalId], platform));
	const hidden = " Its file path is not repeated here because it contains text this output neutralises.";
	return prepared.policy === "confirm" ? `Show the person the preview. They run ${inlineCommand(changeApprovalCommand(void 0, prepared.approvalId, platform))}; then run the same command again with ${carrying}.${hidden}` : `Show the person the preview. Once they say yes, run the same command again with ${carrying}.${hidden}`;
}
/** One profile at a terminal. Every string in a view that came from a profile is already neutralised and on one line. */
function renderOrg(view) {
	const lines = [
		`${view.organisation} — ${view.label}`,
		`  source       ${view.source.path}`,
		`  SHA-256      ${view.sha256} (read ${view.readAt})`,
		`  other addresses  ${view.forOtherAddresses ? view.routesOtherAddresses ? "on" : "on, but there is no Google client to route them to" : "off"}`
	];
	if (view.gmail === null) lines.push("  Google       none");
	else {
		lines.push(`  Google       ${view.gmail.active === null ? "no active client" : `new mailboxes get "${view.gmail.active}"`}`);
		for (const generation of view.gmail.generations) {
			const flags = [
				generation.ownership,
				...generation.active ? ["active"] : [],
				...generation.state === "ok" ? [] : [generation.state]
			];
			lines.push(`    ${generation.name.padEnd(12)} ${generation.clientId}  (${flags.join(", ")}; serves ${generation.serves})${generation.mailboxes.length > 0 ? ` — ${generation.mailboxes.join(", ")}` : ""}`);
		}
	}
	if (view.slack === null) lines.push("  Slack        none");
	else {
		lines.push(`  Slack        ${view.slack.workspace} (${view.slack.workspaceName}), port ${view.slack.redirectPort}`);
		for (const role of ["read", "send"]) {
			const app = view.slack.apps[role];
			lines.push(`    ${role.padEnd(12)} ${app ? `client id ${app.clientId}${app.appId ? `, app id ${app.appId}` : ""}` : "none"}`);
		}
	}
	if (view.accounts.length > 0) lines.push(`  accounts     ${view.accounts.join(", ")}`);
	for (const drift of view.drift) lines.push(`  ! ${drift.detail}. ${drift.fix}`);
	for (const note of view.notes) lines.push(`  ${note}`);
	return lines.join("\n");
}
function renderOrgList(views, platform) {
	if (views.length === 0) return `No organisation profiles have been added here. Add one with ${inlineCommand(shellCommand([
		"agentcomms",
		"org",
		"add",
		"--help"
	], platform))}.`;
	return views.map(renderOrg).join("\n\n");
}
function renderOrgChange(result) {
	const lines = [result.changed ? "Done." : `Nothing to change: ${result.organisation} matches its profile.`];
	for (const line of result.applied) lines.push(`  - ${line}`);
	if (result.reported.length > 0) lines.push("", "Left as it is:", ...result.reported.map((line) => `  - ${line}`));
	lines.push("", renderOrg(result.profile));
	return lines.join("\n");
}
function renderOrgRemove(result) {
	const lines = [`Removed the organisation profile ${result.organisation}.`];
	if (result.removed.length > 0) lines.push(`Removed its clients, with their secrets: ${result.removed.join(", ")}.`);
	if (result.kept.length > 0) lines.push(`Left as they are, as clients of your own: ${result.kept.join(", ")}.`);
	if (result.secretsLeft.length > 0) lines.push(`These secrets could not be deleted: delete them from your secret store: ${result.secretsLeft.join(", ")}.`);
	return lines.join("\n");
}
function renderLater(result) {
	if (result.snoozedUntil === null) return "Nothing was put off: no update has been found on this machine.";
	return `${result.latest ? `The update to ${result.latest} is` : "The daily update check is"} put off until ${new Date(result.snoozedUntil).toString()}${result.changed ? "" : " (it already was)"}: nothing stops for it until then, and the first command after asks again.`;
}
function renderAuto(result) {
	return `The daily update check is ${result.updateCheck === "on" ? "on: once a day this machine asks npm for a newer release, and stops until it is updated or put off" : "off: nothing on this machine asks npm for a newer release, and nothing stops for one"}${result.changed ? "" : " (it already was)"}.`;
}
function renderChannels(report) {
	const lines = [];
	for (const channel of report.channels) {
		const where = [...channel.runtimes.map((runtime) => `runtime ${runtime.version}`), ...channel.onPath ? [`${channel.binary} ${channel.onPath.version ?? "(version unknown)"} on PATH`] : []];
		lines.push(`${channel.label.padEnd(18)} ${channel.package}  ${channel.installed ? where.length > 0 ? where.join(", ") : `this process, ${report.core}` : "not installed"}`);
		for (const entry of channel.registered) lines.push(`  registered with ${entry.client} as "${entry.name}" (${entry.launcher}${entry.version ? ` ${entry.version}` : ""}${entry.behindCore ? `, older than this core's ${report.core}` : ""})${entry.missing ? ` — ${entry.missing} is missing` : ""}`);
	}
	for (const file of report.unreadable) lines.push(`Could not read ${file.path}: ${file.reason}.`);
	return lines.join("\n");
}
/**
* The mapping, one line per account, old name on the left — then any `--rename` that matched nothing here.
*
* Those are listed rather than dropped silently: one mapping is meant to run on every computer, so a source this one
* lacks is normal, but a misspelt source looks exactly the same, and the account it meant would take its default.
*/
function renderMapping(rows, notApplicable = []) {
	const width = Math.max(...rows.map((row) => row.from.length), 0);
	const kind = (row) => row.kind === "inbox" ? "mailbox  " : "workspace";
	return [
		`${rows.length} account(s) will be renamed:`,
		"",
		...rows.map((row) => `  ${kind(row)}  ${row.from.padEnd(width)}  →  ${row.to}`),
		...notApplicable.length > 0 ? [
			"",
			`Not applicable here — nothing on this computer is called that, so ${notApplicable.length === 1 ? "this rename changes" : "these renames change"} nothing:`,
			"",
			...notApplicable.map((skipped) => `  --rename ${skipped.rename}`)
		] : []
	].join("\n");
}
if (process.argv[1] !== void 0 && /(?:^|[/\\])(?:cli\.(?:mjs|ts)|agentcomms)$/.test(process.argv[1])) main().then((code) => {
	process.exitCode = code;
}, (error) => {
	process.stderr.write(`agentcomms: ${error instanceof Error ? error.message : String(error)}\n`);
	process.exitCode = 64;
});
//#endregion
export { main, renderAttach };
