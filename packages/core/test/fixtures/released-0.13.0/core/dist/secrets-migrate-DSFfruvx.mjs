import { $t as openSecretStore, Ai as classifyChange, Ca as homeDirectory, Co as isGroupOrWorldAccessible, G as updateVerdict, J as channelsAvailable, K as CLIENTS, L as readUpdateCheck, La as commandText, Mi as comparablePath, Mo as CommsError, N as countedLatest, Qt as loadKeyringModule, Ri as defaultChangePolicy, Sa as expandHome, T as UPDATE_CHECK_ENV, Tt as shownText, U as updateSnoozed, Ut as APPROVAL_KEY_REF, Vn as channelServer, Wa as shellCommand, Wi as emptyConfig, Yr as migrateNames, Z as VERSION, Zr as planNamesMigration, Zt as keychainNamespace, _i as publicView, _o as withCredentialsLock, _t as orphanMarkedRows, ao as listed$1, di as approvalKind, ea as secretsStoreOf, ei as resolveName, en as probeKeychain, gt as organisationsOf, ha as namesItsPlace, mt as organisationDrift, oo as manifestOf, pa as defaultAttachDeny, qi as isInsideDirectory, xn as revokeChange, z as updateCheckEnabled, za as inlineCommand } from "./update-check-C8sNjCez.mjs";
import { access, constants, realpath, stat } from "node:fs/promises";
import { basename, dirname, isAbsolute, join, resolve } from "node:path";
import { randomBytes } from "node:crypto";
//#region src/operations/attach-settings.ts
const ATTACH_CHANGE_KINDS = Object.freeze([
	"rootsAdd",
	"rootsRemove",
	"denyAdd",
	"denyRemove"
]);
/** The lists as they stand. */
async function attachReport(core, env) {
	return reportOf(await core.config.load(), core, env);
}
/**
* One change to the lists, as a change the flow asks for or applies: see the top of this file.
*
* `plan` reads the lists and the disk again on both calls, so a claim for a list that moved meanwhile — or a link that
* now leads somewhere else — is another change, and refused.
*/
function attachChange(core, env, change, surface) {
	if (!ATTACH_CHANGE_KINDS.includes(change?.kind)) throw new CommsError("USAGE", `"${String(change?.kind)}" is not a change to the attachment lists`, { hint: `One of: ${ATTACH_CHANGE_KINDS.join(", ")}.` });
	const path = change.kind === "rootsRemove" || change.kind === "denyRemove" ? listedPath(change.path) : checkedPath(change.path);
	const { kind } = change;
	const home = homeDirectory(env);
	const edit = editOf(kind, path, home);
	let planned = null;
	return {
		plan: async (config) => {
			const outcome = await planChange(config, kind, path, {
				core,
				env,
				home
			});
			planned = {
				changes: outcome.changes,
				note: outcome.note
			};
			return {
				before: config,
				after: outcome.changes ? edit(config) : config,
				effects: outcome.effects,
				summary: SUMMARIES[kind](path)
			};
		},
		apply: async (consent) => {
			if (planned === null) throw new CommsError("UNEXPECTED", "the attachment lists were changed before planned");
			const { note } = planned;
			if (!planned.changes) return {
				kind,
				path,
				changed: false,
				note,
				...await reportOf(await core.config.load(), core, env)
			};
			const written = await core.config.update(edit, consent ? { consent } : {});
			await core.audit.append({
				inboxId: "",
				operation: AUDIT_OPERATIONS[kind],
				outcome: "ok",
				surface,
				reason: path
			});
			return {
				kind,
				path,
				changed: true,
				note,
				...await reportOf(written, core, env)
			};
		}
	};
}
/** The configuration with this one change made to it, and nothing else. */
function editOf(kind, path, home) {
	return (config) => {
		const { attachRoots: roots, attachDeny: deny } = config.defaults;
		const has = (list) => list.some((entry) => samePath(entry, path, home));
		const lists = kind === "rootsAdd" ? { attachRoots: has(roots) ? [...roots] : [...roots, path] } : kind === "rootsRemove" ? { attachRoots: roots.filter((root) => !samePath(root, path, home)) } : kind === "denyAdd" ? { attachDeny: has(deny) ? [...deny] : [...deny, path] } : { attachDeny: deny.filter((entry) => !samePath(entry, path, home)) };
		return {
			...config,
			defaults: {
				...config.defaults,
				...lists
			}
		};
	};
}
const SUMMARIES = {
	rootsAdd: (path) => `Let files under ${path} be attached`,
	rootsRemove: (path) => `Stop attaching files from under ${path}`,
	denyAdd: (path) => `Never attach files from ${path}`,
	denyRemove: (path) => `Let files from ${path} be attached again`
};
const AUDIT_OPERATIONS = {
	rootsAdd: "attach.roots.add",
	rootsRemove: "attach.roots.remove",
	denyAdd: "attach.deny.add",
	denyRemove: "attach.deny.remove"
};
/** The command that allows another folder, as every refusal and every document names it. */
const ATTACH_ROOTS_ADD = "agentcomms attach roots add <folder>";
/**
* The path as written, refused unless it says where it is on its own: absolute, or from the home folder. A relative
* path means whatever folder the command or the server happened to start in, which is not something a person reads
* in a preview and knows.
*/
function checkedPath(path, platform = process.platform) {
	const value = typeof path === "string" ? path : "";
	if (value.trim() === "") throw new CommsError("USAGE", "name the folder or path", { hint: `For example: \`${ATTACH_ROOTS_ADD.replace("<folder>", "~/Documents/outgoing")}\`.` });
	if (namesItsPlace(value, platform)) return value;
	if (platform === "win32" && isAbsolute(value)) throw new CommsError("USAGE", `"${value}" does not name its drive: give it in full, like C:\\outgoing, or starting with ~`, { hint: "A path with no drive is on whichever drive is current when it is read, which is not something a person approves once." });
	throw new CommsError("USAGE", `"${value}" is a relative path: give it absolute, or starting with ~`, { hint: "A relative path means whatever folder this happened to start in. Write it in full, or from your home folder: `~/Documents/outgoing`." });
}
/**
* An entry to take out, as it is listed. Not held to `checkedPath`: an entry written by hand before 0.12.0 may name no
* place — `\outgoing` on Windows — and the one way to be rid of it must not be to edit the file again. An entry that is
* not listed is refused when the change is planned.
*/
function listedPath(path) {
	if (typeof path !== "string") throw new CommsError("USAGE", "name the folder or path to take out, as `agentcomms attach` lists it");
	return path;
}
/** A deny entry that names no one place: the jail matches it by name, anywhere (`**∕…`), or every hidden folder in the home. */
function isPattern(entry) {
	return entry.startsWith("**/") || entry === "~/.*";
}
/** Where a path leads on this disk: every link in the part of it that exists followed, the rest as written. */
async function realOf(path, home) {
	let current = resolve(expandHome(path, home));
	const tail = [];
	for (;;) try {
		const real = await realpath(current);
		return tail.length > 0 ? join(real, ...tail.reverse()) : real;
	} catch {
		const parent = dirname(current);
		if (parent === current) return resolve(expandHome(path, home));
		tail.push(basename(current));
		current = parent;
	}
}
async function entryOf(path, home) {
	return {
		path,
		real: isPattern(path) ? null : await realOf(path, home)
	};
}
async function reportOf(config, core, env) {
	const home = homeDirectory(env);
	const entries = (list) => Promise.all(list.map((path) => entryOf(path, home)));
	const listed = config.defaults.attachRoots;
	return {
		roots: await entries(listed.filter((root) => namesItsPlace(root))),
		ignored: listed.filter((root) => !namesItsPlace(root)),
		deny: await entries(config.defaults.attachDeny),
		builtIn: await entries(defaultAttachDeny(core.paths.configDir, env))
	};
}
/** Whether two entries are the same path as written — the one the person named — once `~` and `..` are read. */
function samePath(a, b, home) {
	if (a === b) return true;
	if (isPattern(a) || isPattern(b)) return false;
	if (!namesItsPlace(a) || !namesItsPlace(b)) return false;
	return comparablePath(resolve(expandHome(a, home))) === comparablePath(resolve(expandHome(b, home)));
}
/** "~, ~/work", or "none". */
function listed(list) {
	return list.length > 0 ? list.join(", ") : "none";
}
async function planChange(config, kind, path, context) {
	const { home } = context;
	const roots = config.defaults.attachRoots;
	const deny = config.defaults.attachDeny;
	switch (kind) {
		case "rootsAdd": {
			const real = await realOf(path, home);
			for (const root of roots.filter((listed) => namesItsPlace(listed))) if (isInsideDirectory(comparablePath(real), comparablePath(await realOf(root, home)))) return {
				changes: false,
				effects: [],
				note: `${path} is already allowed: it is ${samePath(path, root, home) ? "listed as" : "inside"} ${root}, which files may already be attached from. Nothing was changed.`
			};
			const lexical = resolve(expandHome(path, home));
			return {
				changes: true,
				effects: comparablePath(real) === comparablePath(lexical) ? [] : [`${path} leads to ${real} through a link, so files anywhere under ${real} could be attached`],
				note: null
			};
		}
		case "rootsRemove": {
			const kept = roots.filter((root) => !samePath(root, path, home));
			if (kept.length === roots.length) throw new CommsError("NOT_FOUND", `${JSON.stringify(path)} is not one of the folders files may be attached from`, { hint: `They are: ${listed(roots)}. \`agentcomms attach\` lists them.` });
			return {
				changes: true,
				effects: [],
				note: kept.length === 0 ? `No folder is left, so nothing can be attached until one is added with \`${ATTACH_ROOTS_ADD}\`.` : null
			};
		}
		case "denyAdd": {
			const builtIn = defaultAttachDeny(context.core.paths.configDir, context.env);
			const real = comparablePath(await realOf(path, home));
			for (const entry of [...builtIn, ...deny]) {
				if (isPattern(entry)) continue;
				if (isInsideDirectory(real, comparablePath(await realOf(entry, home)))) return {
					changes: false,
					effects: [],
					note: `${path} is already never attached from: it is ${samePath(path, entry, home) ? "listed as" : "inside"} ${entry}${builtIn.includes(entry) ? ", on the built-in list" : ""}. Nothing was changed.`
				};
			}
			return {
				changes: true,
				effects: [],
				note: null
			};
		}
		case "denyRemove": {
			if (deny.filter((entry) => !samePath(entry, path, home)).length < deny.length) return {
				changes: true,
				effects: [],
				note: null
			};
			const own = defaultAttachDeny(context.core.paths.configDir, context.env).find((entry) => samePath(entry, path, home));
			if (own !== void 0) throw new CommsError("USAGE", `${own} is on the built-in list, which cannot be removed`, { hint: "The built-in list is what is never attached whatever the configuration says: the configuration folder, every hidden folder in your home, ~/Library, any .git folder and any .env file. `agentcomms attach` lists it." });
			throw new CommsError("NOT_FOUND", `${JSON.stringify(path)} is not one of your own entries that files may never come from`, { hint: `Yours are: ${listed(deny)}. \`agentcomms attach\` lists them, and the built-in list beside them.` });
		}
	}
}
//#endregion
//#region src/operations/change-policy.ts
/**
* The change policy — how a loosening is approved: `chat`, a yes in the conversation, or `confirm`, a code typed at
* a terminal — reported and set: `agentcomms policy` and `comms_change_policy`, one operation.
*
* It is a safety setting itself (design §3.3). Tightening, `chat → confirm`, is applied at once. Loosening,
* `confirm → chat`, is a change like any other, and the policy that decides how it is approved is the one in force
* before it — `confirm` — so it always needs a code typed at a terminal, whichever surface asked. `classifyChange`
* and `governingChangePolicy` already say both; this only builds the change they judge.
*/
const CHANGE_POLICIES = Object.freeze(["chat", "confirm"]);
function isChangePolicy(value) {
	return typeof value === "string" && CHANGE_POLICIES.includes(value);
}
/**
* The scope named, by its current name, with the entry it names in `config`; a former name is refused with the one
* it has now. Through `resolveName`, the one place a name is looked up, so an old name is never read as "not there".
*/
function resolveScope(config, scope) {
	if (scope.inbox !== void 0 && scope.account !== void 0) throw new CommsError("USAGE", "name one mailbox or one workspace, not both");
	if (scope.inbox !== void 0) return {
		kind: "inbox",
		name: scope.inbox,
		entry: resolveName(config, "inbox", scope.inbox).inbox
	};
	if (scope.account !== void 0) return {
		kind: "account",
		name: scope.account,
		entry: resolveName(config, "account", scope.account).account
	};
	return null;
}
function changePolicyReport(config, scope = {}, platform = process.platform) {
	const target = resolveScope(config, scope);
	if (target === null) {
		const overrides = [...Object.entries(config.inboxes).flatMap(([name, inbox]) => inbox.changePolicy ? [{
			kind: "inbox",
			name,
			changePolicy: inbox.changePolicy
		}] : []), ...Object.entries(config.accounts).flatMap(([name, account]) => account.changePolicy ? [{
			kind: "account",
			name,
			changePolicy: account.changePolicy
		}] : [])];
		const changePolicy = defaultChangePolicy(config);
		const looser = changePolicy === "confirm" ? overrides.flatMap((override) => stillChat(override, platform)) : [];
		return {
			scope: "defaults",
			name: null,
			changePolicy,
			setHere: config.defaults.changePolicy ?? null,
			overrides,
			...looser.length > 0 ? {
				looser,
				warning: looserWarning(looser)
			} : {}
		};
	}
	const own = target.entry.changePolicy ?? null;
	return {
		scope: target.kind,
		name: target.name,
		changePolicy: own ?? defaultChangePolicy(config),
		setHere: own
	};
}
/** An override that approves in chat, with how to tighten it; nothing for one that does not. */
function stillChat(override, platform) {
	if (override.changePolicy !== "chat") return [];
	const flag = override.kind === "inbox" ? "--inbox" : "--account";
	return [{
		kind: override.kind,
		name: override.name,
		changePolicy: "chat",
		tighten: {
			command: commandText(shellCommand([
				"agentcomms",
				"policy",
				flag,
				override.name,
				"confirm"
			], platform)),
			tool: "comms_change_policy",
			arguments: override.kind === "inbox" ? {
				inbox: override.name,
				set: "confirm"
			} : {
				account: override.name,
				set: "confirm"
			}
		}
	}];
}
function looserWarning(looser) {
	const named = looser.map((entry) => `${entry.kind === "inbox" ? "mailbox" : "workspace"} ${entry.name}`);
	return looser.length === 1 ? `The default is confirm, but ${named[0]} still approves a loosening with a yes in the chat: it sets chat itself, and a default never overrides that.` : `The default is confirm, but ${looser.length} still approve a loosening with a yes in the chat — ${named.join(", ")}: each sets chat itself, and a default never overrides that.`;
}
/**
* An approval id with nothing to set is refused rather than ignored: a caller who passed one believed a change was
* being applied, and a report in reply would read as though it had been.
*/
function refuseApprovalWithoutChange(approvalId) {
	if (approvalId !== void 0) throw new CommsError("USAGE", "an approval goes with a policy to set; without one this only reports", { hint: "Pass the policy the approval was prepared for — `chat` or `confirm` — with it." });
}
/** `config` with the change policy of `scope` set to `to`, and nothing else touched. */
function withPolicy(config, scope, to) {
	const next = structuredClone(config);
	const target = resolveScope(next, scope);
	if (target === null) next.defaults.changePolicy = to;
	else target.entry.changePolicy = to;
	return next;
}
/**
* Setting the policy of `scope` to `to`, as a change.
*
* Its own write is made through `ConfigStore.update` with whatever consent the flow hands over, and is computed from
* the configuration read inside that lock — so the refusal a loosening meets there, without an approval or with one
* for a different change, is the store's, not this function's.
*/
function changePolicyChange(core, scope, to, platform = process.platform) {
	if (!isChangePolicy(to)) throw new CommsError("USAGE", `"${String(to)}" is not a change policy`, { hint: "Use `chat` or `confirm`." });
	return {
		plan: (config) => {
			const before = changePolicyReport(config, scope, platform);
			const where = before.name === null ? "the default change policy" : `the change policy of ${before.name}`;
			return {
				...before.scope === "inbox" ? { inbox: before.name ?? void 0 } : {},
				...before.scope === "account" ? { account: before.name ?? void 0 } : {},
				before: config,
				after: withPolicy(config, scope, to),
				summary: `Set ${where} to ${to}${to === "chat" ? ": a yes in the chat will approve a loosening" : ""}`
			};
		},
		apply: async (consent) => {
			return changePolicyReport(await core.config.update((config) => withPolicy(config, scope, to), consent ? { consent } : {}), scope, platform);
		}
	};
}
//#endregion
//#region src/operations/maintenance.ts
/**
* The core's own read-only and housekeeping operations: where things live, whether this machine is healthy, what the
* audit log says, and which approvals exist.
*
* Each is one function that `agentcomms` and the core MCP server both call, so a command and its tool cannot drift in
* what they return or what they refuse. They lived inside the CLI until the server needed them, and the CLI is the one
* module a library may never import: it starts `main()` when the running script is called `cli.mjs`, which is also
* what every product's CLI is called.
*/
function corePaths(core) {
	return core.paths;
}
/**
* Whether this machine is healthy. `env` is where the MCP clients' configs are found — the one `agentcomms` runs with,
* or the core server's — as `agentcomms channels` finds them.
*/
async function doctor(core, env, options = {}) {
	const checks = [];
	const platform = options.platform ?? process.platform;
	const [major = 0, minor = 0] = process.versions.node.split(".").map(Number);
	const nodeOk = major > 22 || major === 22 && minor >= 12;
	checks.push({
		name: "node",
		ok: nodeOk,
		detail: `Node ${process.versions.node} at ${process.execPath}`,
		...nodeOk ? {} : { fix: "Install Node 22.12 or newer." }
	});
	for (const [name, dir] of [["config dir", core.paths.configDir], ["state dir", core.paths.stateDir]]) try {
		await access(dir, constants.R_OK | constants.W_OK);
		const loose = await isGroupOrWorldAccessible(dir);
		checks.push({
			name,
			ok: !loose,
			detail: dir,
			...loose ? { fix: commandText(shellCommand([
				"chmod",
				"700",
				dir
			], platform)) } : {}
		});
	} catch {
		checks.push({
			name,
			ok: true,
			detail: `${dir} (not created yet — created on first use)`
		});
	}
	let config = emptyConfig();
	let readable = true;
	try {
		config = await core.config.load();
		const exists = await stat(core.config.path).then(() => true, () => false);
		checks.push({
			name: "config",
			ok: true,
			detail: exists ? core.config.path : "no config yet"
		});
	} catch (error) {
		readable = false;
		checks.push({
			name: "config",
			ok: false,
			detail: error instanceof Error ? error.message : String(error),
			fix: "Fix or restore config.json."
		});
	}
	const toMigrate = readable && config.version === 1;
	checks.push({
		name: "account names",
		ok: true,
		detail: !readable ? "unknown — the configuration could not be read" : toMigrate ? "the old flat names, which still work" : "organisation/platform",
		...toMigrate ? { fix: "See what they would become with `agentcomms names migrate --dry-run`, once everything sharing this config is on 0.2.0 or later." } : {}
	});
	if (readable) checks.push(...organisationChecks(config, platform));
	const keyring = options.keyring !== void 0 ? options.keyring : await loadKeyringModule();
	const probe = keyring ? await probeKeychain(keyring, keychainNamespace(core.paths.configDir)) : {
		ok: false,
		reason: "the optional @napi-rs/keyring package is not installed for this platform"
	};
	const usesKeychain = secretsStoreOf(config) === "keychain";
	checks.push({
		name: "system keychain",
		ok: probe.ok || !usesKeychain,
		detail: probe.ok ? "readable and writable" : `unavailable: ${probe.reason}`,
		...probe.ok || !usesKeychain ? {} : { fix: "Unlock the keychain, or move secrets to files: `agentcomms secrets migrate --to file`." }
	});
	checks.push({
		name: "secret backend",
		ok: true,
		detail: config.secrets?.store ?? "not chosen yet (keychain by default)"
	});
	checks.push(await updateCheckLine(core, env));
	checks.push(...await registrationChecks(core, env, readable ? config : null, platform));
	return {
		checks,
		ok: checks.every((c) => c.ok)
	};
}
/**
* Organisation profiles against the configuration (design 2026-10-02 §D4): one line per profile, and one per drift
* with the command that puts it right.
*
* Older releases share this file and know nothing of a profile's rules — one can `client remove` a row a profile owns
* — and the daily update check that keeps mixed releases short-lived can be turned off, so nothing here assumes the
* record is intact. What `org update` repairs fails the check: it is a configuration that has drifted from what was
* approved, and new mailboxes are refused the organisation's client until it is repaired. What nothing here can rebuild
* — an earlier client gone with its secret — is something to look at, with the way to move its mailboxes. A mark naming
* an organisation with no record is something to look at too: the row is an ordinary client again.
*
* Nothing at all is said on a machine with no profile, so every other doctor reads as it always did.
*/
function organisationChecks(config, platform) {
	const checks = [];
	for (const organisation of Object.keys(organisationsOf(config)).sort()) {
		const drift = organisationDrift(config, organisation, platform);
		const record = organisationsOf(config)[organisation];
		const active = record?.gmail?.active ?? null;
		if (drift.length === 0) {
			checks.push({
				name: `organisation ${organisation}`,
				ok: true,
				detail: `${shownText(record?.label ?? "", 64)}: ${active === null ? "no Google client" : `new mailboxes get "${active}"`}${record?.slack ? `; Slack workspace ${shownText(record.slack.workspace, 40)}` : ""}`
			});
			continue;
		}
		for (const item of drift) checks.push({
			name: `organisation ${organisation}`,
			ok: item.kind === "report",
			...item.kind === "report" ? { warn: true } : {},
			detail: item.detail,
			fix: item.fix
		});
	}
	for (const { client, organisation } of orphanMarkedRows(config)) checks.push({
		name: "organisation mark",
		ok: true,
		warn: true,
		detail: `the OAuth client "${client}" is marked as belonging to "${shownText(organisation, 40)}", which has no profile here`,
		fix: `It is treated as a client of your own: ${inlineCommand(shellCommand([
			"agent-gmail",
			"client",
			"--help"
		], platform))} shows commands that can change or remove it. To give it back to the organisation, add its profile with ${inlineCommand(shellCommand([
			"agentcomms",
			"org",
			"add",
			"--help"
		], platform))}.`
	});
	return checks;
}
/**
* The daily update check, in one line (design 2026-09-28 §4): on or off — and what turned it off — when the registry
* was last asked, the latest release it named, and the release running here. Never a failure: an update that is out
* is something to look at, with the two ways on, and the rest is information.
*/
async function updateCheckLine(core, env) {
	const enabled = await updateCheckEnabled(core, env);
	const record = await readUpdateCheck(core.paths.stateDir);
	const now = /* @__PURE__ */ new Date();
	const off = enabled.on ? "on" : `off (${enabled.by === "setting" ? "agentcomms update --auto off" : enabled.by === "CI" ? "CI is set" : `${UPDATE_CHECK_ENV} is set`})`;
	const latest = record.latest === null ? "unknown" : countedLatest(record) === null ? `${record.latest} (a prerelease, not counted)` : record.latest;
	const snoozed = updateSnoozed(record, now);
	const parts = [
		off,
		`last checked ${record.lastChecked ?? "never"}`,
		`latest ${latest}`,
		`running ${VERSION}`
	];
	if (snoozed && record.snoozedUntil !== null) parts.push(`put off until ${record.snoozedUntil}`);
	if (record.lastError !== null) parts.push(`the last check got no answer: ${record.lastError}`);
	const verdict = (surface) => enabled.on && !snoozed ? updateVerdict(record, VERSION, {
		channel: "core",
		surface
	}) : null;
	const [asServer, asCommand] = [verdict("server"), verdict("command")];
	const pending = asServer ?? asCommand;
	return {
		name: "update check",
		ok: true,
		...pending ? { warn: true } : {},
		detail: parts.join(" · "),
		...pending === null ? {} : { fix: asServer?.kind === "restart" && asCommand?.kind === "restart" ? `${pending.latest} is installed on this machine: restart the MCP clients, and run commands from it.` : "Run `agentcomms update` (comms_update from a chat), or `agentcomms update --later` to put it off until tomorrow." }
	};
}
/**
* Which MCP clients start each server, read the way `agentcomms channels` reads it.
*
* Every check above passed on a machine where an install had registered nothing: the only symptom was a client with
* none of the tools, and the doctor said all was well. So every client config is read for every server:
*
*  - an entry whose command or script has gone fails, with the command that registers it again — the client starts
*    it, it exits, and the client says only that it failed;
*  - a channel with accounts here that no client starts is something to look at, not a failure: it may be used only
*    from a terminal, but somebody who connected a mailbox and sees no Gmail tools has usually hit exactly this;
*  - a client config that cannot be read is said to be unreadable, and nothing is concluded from its silence.
*
* `config` is null when it could not be read: the check above says so, and no channel is said to have accounts.
*/
async function registrationChecks(core, env, config, platform) {
	const report = await channelsAvailable(core, env);
	const checks = report.unreadable.map((file) => ({
		name: "client config",
		ok: true,
		warn: true,
		detail: `${file.path} could not be read (${file.reason}), so which servers ${file.client} starts is not known`,
		fix: `Look at ${file.path}: until it can be read, nothing here can say what it registers.`
	}));
	const blind = report.unreadable.map((file) => file.path);
	const where = (entry) => `${entry.client} as "${entry.name}" in ${entry.path}${entry.scope === "project" ? " (for one project)" : ""}`;
	for (const channel of report.channels) {
		const name = `${channel.channel} server`;
		for (const entry of channel.registered) {
			if (entry.missing === null) continue;
			checks.push({
				name,
				ok: false,
				detail: `registered with ${where(entry)}, but ${entry.missing} is no longer there, so ${entry.client} cannot start it`,
				fix: registerAgain(channel.channel, entry, platform)
			});
		}
		const working = channel.registered.filter((entry) => entry.missing === null);
		if (working.length > 0) {
			checks.push({
				name,
				ok: true,
				detail: `registered with ${working.map(where).join("; ")}`
			});
			continue;
		}
		if (channel.registered.length > 0) continue;
		const accounts = config === null ? [] : accountsOf(config, channel.channel);
		if (accounts.length === 0) continue;
		const clients = CLIENTS.filter((client) => client !== "json").join(", ");
		checks.push({
			name,
			ok: true,
			warn: true,
			detail: `${listed$1(accounts, "and")} ${accounts.length === 1 ? "is" : "are"} set up here, but no MCP client${blind.length > 0 ? " this could read" : ""} starts the ${channel.label} server${blind.length > 0 ? ` — ${listed$1(blind, "and")} could not be read` : ""}`,
			fix: `Register it with the client you use: ${inlineCommand(shellCommand([
				channel.binary,
				"mcp",
				"install",
				"--help"
			], platform))} (${clients}), or comms_server_install with channel "${channel.channel}" from a chat. Used only from a terminal, it needs nothing.`
		});
	}
	return checks;
}
/** The names of a channel's accounts on this machine, from the map its manifest keeps them in; none for the core. */
function accountsOf(config, channel) {
	const accounts = manifestOf(channel)?.accounts;
	if (accounts === void 0) return [];
	if (accounts.map === "inboxes") return Object.keys(config.inboxes).sort();
	return Object.entries(config.accounts).filter(([, account]) => account.platform === channel).map(([name]) => name).sort();
}
/**
* What registers a broken entry again as it was: its client, its name, its pin and `--read-only`, and its launcher —
* the flags `mcp install`'s own hint repeats when it refuses to replace an entry without `--force`, so following it
* narrows or widens nothing. A project's entry is not one `mcp install` writes, and is said to be where it is instead.
*/
function registerAgain(channel, entry, platform) {
	if (entry.scope === "project") return `It is registered for one project, in ${entry.path}, and \`mcp install\` registers at user scope only: remove it or register it again there, with ${entry.client}'s own command.`;
	const facts = channelServer(channel);
	const words = [
		facts.binary,
		"mcp",
		"install",
		"--client",
		entry.client
	];
	if (entry.name !== facts.defaultServerName) words.push("--name", entry.name);
	words.push(...entry.narrowing);
	if (entry.launcher === "npx" || entry.launcher === "local") words.push("--launcher", entry.launcher);
	words.push("--force");
	return `Register it again: ${inlineCommand(shellCommand(words, platform))}.`;
}
/** An inbox's id from its name — the current one, so a former name is answered with what it is called now. */
function inboxIdFor(config, alias) {
	if (!alias) return void 0;
	return resolveName(config, "inbox", alias, () => new CommsError("NOT_FOUND", `no inbox called "${alias}"`)).inbox.id;
}
async function auditTail(core, options = {}) {
	const limit = options.limit ?? 50;
	if (!Number.isInteger(limit) || limit < 1) throw new CommsError("USAGE", "the limit must be a positive whole number");
	const inboxId = inboxIdFor(await core.config.load(), options.inbox);
	return core.audit.tail({
		limit,
		...inboxId ? { inbox: inboxId } : {},
		...options.since ? { since: options.since } : {}
	});
}
const APPROVAL_STATES = Object.freeze([
	"pending",
	"approved",
	"sending",
	"used",
	"failed",
	"unknown",
	"expired",
	"revoked"
]);
async function listApprovals(core, options = {}) {
	if (options.state !== void 0 && !APPROVAL_STATES.includes(options.state)) throw new CommsError("USAGE", `"${options.state}" is not an approval state`, { hint: `One of: ${APPROVAL_STATES.join(", ")}.` });
	const inboxId = inboxIdFor(await core.config.load(), options.inbox);
	return (await core.approvals.list({
		...inboxId ? { inboxId } : {},
		...options.state ? { states: [options.state] } : {}
	})).map(publicView);
}
/**
* Revokes an approval of either kind. Refusing is never the dangerous direction, so this asks nobody.
*
* A change approval is revoked through `revokeChange`, which records it in the audit log as every other step of a
* change approval is; a send approval as it always was.
*/
async function revokeApproval(core, approvalId, surface) {
	const existing = await core.approvals.get(approvalId);
	const reason = "revoked by the user";
	const record = existing && approvalKind(existing) === "change" ? await revokeChange(core, approvalId, reason, { surface }) : await core.approvals.revoke(approvalId, reason);
	return publicView(record);
}
//#endregion
//#region src/operations/names-migrate.ts
/** What the migration would do, from the configuration as it is: the mapping, and the renames that match nothing. */
function namesDryRun(config, renames = []) {
	const plan = planNamesMigration(config, renames);
	if (plan.status === "already-migrated") return { status: "already-migrated" };
	return {
		status: "dry-run",
		rows: plan.rows,
		notApplicable: plan.notApplicable
	};
}
const kindWord = (row) => row.kind === "inbox" ? "mailbox" : "workspace";
/**
* The migration as a change: every rename is one effect, so the approval is bound to exactly this mapping.
*
* It loosens nothing — the classifier matches accounts by their immutable ids, so renaming every key grants nothing —
* but the old names stop working the moment it is done, which is why the design lists it with the changes that cannot
* be taken back (§3.1). A mapping that differs when it is claimed — a `--rename` left off the second call, an account
* added in between — is a different list of effects, and the claim refuses it.
*
* The plan is made again from the configuration on every call, and the one the approval was claimed against is the
* one applied: `migrateNames` then refuses it too if the file moves before its locks are taken.
*/
function namesMigration(core, renames = []) {
	let planned;
	return {
		plan: (config) => {
			planned = planNamesMigration(config, renames);
			if (planned.status === "already-migrated") return {
				before: config,
				after: config,
				summary: "Names are already organisation/platform"
			};
			const { rows, notApplicable } = planned;
			return {
				before: config,
				after: config,
				effects: [
					...rows.map((row) => `renames ${kindWord(row)} "${row.from}" to "${row.to}"`),
					...notApplicable.length > 0 ? [`leaves out ${notApplicable.map((skipped) => `--rename ${skipped.rename}`).join(", ")}, which name${notApplicable.length === 1 ? "s" : ""} nothing on this computer`] : [],
					"the old names stop working; anything that uses one is told what it is called now",
					"saves the configuration as it was beside it first"
				],
				summary: `Rename ${rows.length} account${rows.length === 1 ? "" : "s"} to organisation/platform names`
			};
		},
		apply: async () => {
			if (!planned || planned.status === "already-migrated") return { status: "already-migrated" };
			const result = await migrateNames(core.config, planned);
			return {
				status: result.status,
				rows: planned.rows,
				notApplicable: planned.notApplicable,
				backup: result.backup ?? null
			};
		}
	};
}
//#endregion
//#region src/operations/secrets-migrate.ts
/**
* One stable location snapshot for conflict detection.
*
* Ordinary credentials follow the root store. Pending bundles do not: their ledger entry remains authoritative when
* an older release moves only the root. The pair is deduplicated because more than one record may name one bundle.
*/
function secretLocationsOf(config) {
	const root = secretsStoreOf(config);
	const locations = [
		...Object.values(config.clients).map((client) => ({
			ref: client.secretRef,
			store: root
		})),
		...Object.values(config.inboxes).map((inbox) => ({
			ref: inbox.secretRef,
			store: root
		})),
		...Object.values(config.accounts).map((account) => ({
			ref: account.secretRef,
			store: root
		})),
		{
			ref: APPROVAL_KEY_REF,
			store: root
		},
		...(config.pendingRevocations ?? []).map((entry) => ({
			ref: entry.ref,
			store: entry.store
		}))
	];
	return [...new Map(locations.map((location) => [`${location.store}\0${location.ref}`, location])).values()];
}
/** Partitions physical locations before any store is touched. */
function physicalMigrationPlan(config, to) {
	const from = secretsStoreOf(config);
	const snapshot = secretLocationsOf(config);
	const byRef = /* @__PURE__ */ new Map();
	for (const location of snapshot) {
		const stores = byRef.get(location.ref) ?? /* @__PURE__ */ new Set();
		stores.add(location.store);
		byRef.set(location.ref, stores);
	}
	const ambiguous = [...byRef].find(([, stores]) => stores.size > 1);
	if (ambiguous) throw new CommsError("CONFIG", `secret ${ambiguous[0]} is recorded in more than one backend; no migration was started`);
	const requiredSource = new Set((config.pendingRevocations ?? []).filter((entry) => entry.store === from).map((entry) => entry.ref));
	return {
		from,
		to,
		snapshot,
		copy: [...byRef].filter(([, stores]) => stores.has(from)).map(([ref]) => ref),
		verifyInPlace: [...byRef].filter(([, stores]) => stores.has(to)).map(([ref]) => ref),
		requiredSource
	};
}
/**
* A migration that switched backends but left originals behind, as the error both surfaces report it; `null` when it
* left nothing.
*
* Switched but not tidy is an error, not a success with a footnote: a credential still sitting in a backend nothing
* reads from is one the person believes is gone. The CLI exits with it and the tool returns it, so an agent does not
* read `applied: true` and tell the person their credentials were moved cleanly.
*/
function migrationLeftoversError(result) {
	if (result.leftovers.length === 0) return null;
	return new CommsError("CONFIG", `moved ${result.moved} secrets from ${result.from} to ${result.to}, but ${result.leftovers.length} original(s) could not be removed from ${result.from}`, {
		hint: `The new backend is in use. Delete these references from ${result.from}: ${result.leftovers.map((l) => l.ref).join(", ")}.`,
		details: { ...result }
	});
}
/**
* Deletes each reference from `store`, once more on failure, and returns the ones that would not go.
*
* A `false` from `delete` means nothing was there, which is the outcome wanted.
*/
async function takeBack(store, locations) {
	const leftovers = [];
	for (const { store: backend, ref } of locations) {
		let gone = false;
		for (let attempt = 0; attempt < 2 && !gone; attempt++) gone = await store.delete(ref).then(() => true, () => false);
		if (!gone) leftovers.push({
			backend,
			ref
		});
	}
	return leftovers;
}
/**
* Copies every credential to another backend, verifies each, switches, then removes the originals.
*
* Every copy is tracked **before** it is written, not after. A keychain write can report a timeout and land
* anyway, so "the write threw" does not mean "nothing was written", and a copy tracked only once `set` returned
* was a copy nobody would ever clean up. Everything up to and including the switch sits inside one boundary that
* takes those copies back; and anything that will not go — a copy after a failed switch, an original after a
* successful one — is **reported**, rather than swallowed by a `catch(() => false)` under a result that said the
* migration had simply worked.
*
* `stores` exists for the tests. The only other backend is the real keychain, and a test must never write to it.
*
* Moving out of the keychain is a loosening — the credentials go from the operating system's store to files — so
* the switch needs `consent` for `secrets.store`, which comes from a change approval (`secretsMigration`). Without
* it the switch is refused and the copies are taken back, as for any other failure before the switch.
*/
async function migrateSecrets(core, to, stores = {}, consent, options = {}) {
	return withCredentialsLock(core.paths.configDir, () => migrateUnderLock(core, to, stores, consent, options.surface ?? "cli", options.platform ?? process.platform));
}
/**
* One line in the audit log for a credential migration.
*
* Machine-wide, so no inbox, as `confirm-clients` records its changes. Where every credential lives is a safety
* setting, and out of the keychain is a loosening the design says leaves an audit entry.
*/
function recordMigration(core, surface, migration, outcome, reason, options = {}) {
	return core.audit.append({
		inboxId: "",
		operation: "secrets.migrate",
		outcome,
		surface,
		reason,
		ids: { migration }
	}, options);
}
async function migrateUnderLock(core, to, stores, consent, surface, platform) {
	const config = await core.config.load();
	const from = secretsStoreOf(config);
	if (from === to) return {
		from,
		to,
		moved: 0,
		leftovers: []
	};
	const plan = physicalMigrationPlan(config, to);
	if (classifyChange(config, {
		...config,
		secrets: { store: to }
	}).loosened.includes("secrets.store") && !consent?.paths.includes("secrets.store")) throw new CommsError("LOOSENING_REFUSED", "moving credentials out of the system keychain needs a person to approve it", { hint: `Run ${inlineCommand(shellCommand([
		"agentcomms",
		"secrets",
		"migrate",
		"--to",
		to
	], platform))}, or call comms_secrets_migrate, and approve the change it shows.` });
	const source = stores.source ?? await core.secrets(from);
	const target = stores.target ?? await openSecretStore(to, {
		secretsDir: core.paths.secretsDir,
		namespace: keychainNamespace(core.paths.configDir)
	});
	const attemptedTargets = [];
	const sourceCleanup = [];
	let moved = 0;
	let announced = false;
	const migration = `mg_${randomBytes(8).toString("hex")}`;
	const finished = async (leftovers) => {
		const left = leftovers.length;
		await recordMigration(core, surface, migration, left === 0 ? "ok" : "failed", `${from} → ${to}: ${moved} moved${left === 0 ? "" : `, ${left} left behind in a backend nothing reads`}`).catch(() => void 0);
		return {
			from,
			to,
			moved,
			leftovers
		};
	};
	try {
		for (const ref of plan.verifyInPlace) if (await target.get(ref) === null) throw new CommsError("CONFIG", `pending secret ${ref} is missing from its recorded ${to} store`);
		for (const ref of plan.copy) {
			const value = await source.get(ref);
			if (value === null) {
				if (plan.requiredSource.has(ref)) throw new CommsError("CONFIG", `pending secret ${ref} is missing from its recorded ${from} store`);
				continue;
			}
			attemptedTargets.push({
				store: to,
				ref
			});
			sourceCleanup.push({
				store: from,
				ref
			});
			await target.set(ref, value);
			if (await target.get(ref) !== value) throw new CommsError("CONFIG", `could not verify a migrated secret (${ref})`);
			moved += 1;
		}
		await recordMigration(core, surface, migration, "started", `${from} → ${to}: switching, ${moved} copied`, { durable: true });
		announced = true;
		await core.config.update((current) => {
			const conflict = migrationConflict(current, from, plan.snapshot);
			if (conflict) throw new CommsError("TRANSIENT", conflict, { hint: "Nothing was switched. Run it again." });
			return {
				...current,
				secrets: { store: to },
				pendingRevocations: current.pendingRevocations?.map((entry) => entry.store === from ? {
					...entry,
					store: to
				} : entry)
			};
		}, consent ? { consent } : {});
	} catch (error) {
		let switched;
		try {
			switched = secretsStoreOf(await core.config.load()) === to;
		} catch {
			switched = void 0;
		}
		if (switched === true) return finished(await takeBack(source, sourceCleanup));
		if (switched === void 0) {
			await recordMigration(core, surface, migration, "failed", `${from} → ${to}: whether the switch happened could not be confirmed`).catch(() => void 0);
			const base = error instanceof CommsError ? error : new CommsError("UNEXPECTED", String(error));
			throw new CommsError(base.code, base.message, {
				hint: `${base.hint ? `${base.hint} ` : ""}Whether the backend was switched could not be confirmed, so nothing was deleted from either. Run ${inlineCommand(shellCommand([
					"agentcomms",
					"secrets",
					"migrate",
					"--to",
					to
				], platform))} again once the configuration is readable.`,
				details: {
					unconfirmed: true,
					copiedToTarget: attemptedTargets.map((location) => ({
						backend: location.store,
						ref: location.ref
					}))
				},
				cause: error
			});
		}
		const leftovers = await takeBack(target, attemptedTargets);
		if (announced || leftovers.length > 0) await recordMigration(core, surface, migration, "failed", `${from} → ${to}: not switched${leftovers.length > 0 ? `, ${leftovers.length} copies left in ${to}` : ""}`).catch(() => void 0);
		if (leftovers.length === 0) throw error;
		const base = error instanceof CommsError ? error : new CommsError("UNEXPECTED", String(error));
		throw new CommsError(base.code, base.message, {
			hint: `${base.hint ? `${base.hint} ` : ""}Copies were left in ${to}: ${leftovers.map((l) => l.ref).join(", ")}.`,
			details: { leftovers },
			cause: error
		});
	}
	return finished(await takeBack(source, sourceCleanup));
}
/**
* Why a secret-store migration can no longer switch backends, or `null` when it still can.
*
* The copy runs outside the config lock, because it can take as long as the keychain takes. So by the time the
* switch happens, the configuration may not be the one that was copied from: a sign-in may have stored a new
* credential in the *old* backend, or a removal may have deleted one the copy already duplicated. Switching then
* points the runtime at a backend missing the new credential, or holding one nothing names.
*
* Checked against the configuration read inside the lock: the backend must still be the one copied from, and the
* set of credentials the configuration names must still be exactly the set that was copied.
*/
function migrationConflict(current, from, copiedLocations) {
	if (secretsStoreOf(current) !== from) return "the secret store was changed by something else while migrating";
	const nowLocations = secretLocationsOf(current);
	const nowRefs = new Set(nowLocations.map((location) => location.ref));
	const thenRefs = new Set(copiedLocations.map((location) => location.ref));
	if (nowRefs.size !== thenRefs.size || [...nowRefs].some((ref) => !thenRefs.has(ref))) return "a credential was added or removed while migrating";
	const canonical = (locations) => locations.map((location) => `${location.store}\0${location.ref}`).sort();
	if (canonical(nowLocations).join("\n") !== canonical(copiedLocations).join("\n")) return "a pending credential location changed while migrating";
	return null;
}
const STORE_WORDS = {
	keychain: "the system keychain",
	file: "files on this disk"
};
/**
* The migration as a change a person approves: `agentcomms secrets migrate` and `comms_secrets_migrate` both run it
* through the change flow.
*
* Out of the keychain loosens `secrets.store`, which `classifyChange` already finds. In either direction it also
* deletes the originals once they are copied, which cannot be taken back, so it is an effect of its own and needs an
* approval even into the keychain (design §3.1, "destructive"). A configuration that names no credential moves
* nothing of anybody's, and choosing its backend loosens nothing either — the same judgement `ConfigStore.update`
* makes — so that is applied at once, as it always was.
*/
function secretsMigration(core, to, options) {
	return {
		plan: (config) => {
			const from = secretsStoreOf(config);
			const after = from === to ? config : {
				...config,
				secrets: { store: to },
				pendingRevocations: config.pendingRevocations?.map((entry) => entry.store === from ? {
					...entry,
					store: to
				} : entry)
			};
			let effects = [];
			if (from !== to) {
				const physical = physicalMigrationPlan(config, to);
				const copied = physical.copy.filter((ref) => ref !== APPROVAL_KEY_REF).length;
				const kept = physical.verifyInPlace.filter((ref) => ref !== APPROVAL_KEY_REF).length;
				const clauses = [];
				if (copied > 0) clauses.push(`copies the ${copied} credential${copied === 1 ? "" : "s"} this configuration names from ${STORE_WORDS[from]} to ${STORE_WORDS[to]}, and then deletes the originals from ${STORE_WORDS[from]}`);
				if (kept > 0) clauses.push(`verifies the ${kept} pending credential${kept === 1 ? "" : "s"} already in ${STORE_WORDS[to]} and keeps ${kept === 1 ? "it" : "them"} there`);
				if (clauses.length > 0) effects = [clauses.join("; ")];
			}
			return {
				before: config,
				after,
				effects,
				summary: from === to ? `Credentials already use ${STORE_WORDS[to]}` : `Keep credentials in ${STORE_WORDS[to]}`
			};
		},
		apply: (consent) => migrateSecrets(core, to, options.stores ?? {}, consent, {
			surface: options.surface,
			platform: options.platform
		})
	};
}
//#endregion
export { attachReport as _, auditTail as a, listApprovals as c, changePolicyChange as d, changePolicyReport as f, attachChange as g, ATTACH_CHANGE_KINDS as h, namesMigration as i, revokeApproval as l, refuseApprovalWithoutChange as m, secretsMigration as n, corePaths as o, isChangePolicy as p, namesDryRun as r, doctor as s, migrationLeftoversError as t, CHANGE_POLICIES as u };
