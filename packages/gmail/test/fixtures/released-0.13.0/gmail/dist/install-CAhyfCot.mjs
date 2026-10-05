import { E as CHANNEL_SERVERS, Mt as missingEntryFile, Ot as listRegisteredServers, Tt as isProductServer } from "./dist-CBfqDru2.mjs";
//#endregion
//#region src/version.ts
/** The package version, read from package.json at build time. */
const VERSION = "0.13.0";
//#endregion
//#region src/mcp/install.ts
/**
* Exported for the doctor, which reads registered entries back with the same facts that wrote them.
*
* The facts themselves — the package, its flags, how an entry is read back, and the warning about other Gmail
* servers whose send tools nothing gates — are core's `CHANNEL_SERVERS.gmail`, which the core server's
* `comms_server_install` registers from too, so both surfaces warn alike. What is added here is what only this
* package knows: its own version, and where its code is.
*/
const GMAIL_MCP = {
	...CHANNEL_SERVERS.gmail,
	version: VERSION,
	moduleUrl: import.meta.url
};
/**
* The MCP clients whose config files register this server, by core's one rule for what is ours.
*
* What `setup` counts as its agent step done: some entry of ours, for any mailbox. Not what a finish decides by —
* that is whether the entry serves the mailbox it has just connected, `clientServesInbox`. A config that cannot be
* read is left out rather than failing: for "which clients have it" the answer is the ones that could be read.
*/
async function clientsRegisteredWith(env) {
	try {
		const servers = await listRegisteredServers(env);
		return [...new Set(servers.filter((server) => isProductServer(server, GMAIL_MCP)).map((server) => server.client))];
	} catch {
		return [];
	}
}
/**
* Whether `client` already has an entry of this server that serves `inbox` — what a finish checks before it makes
* the registration `setup` asked for, and what `gmail_inbox_finish` checks before it hands one back.
*
* Only the entry that registration would find in its place counts: of ours, by core's one rule for that; at user
* scope, the only one it writes; under the name it would use; unpinned, or pinned to exactly this mailbox; and still
* able to start, by the doctor's own check (`missingEntryFile`). The client's name alone used to decide it, so an
* entry pinned to another mailbox, a project's entry, one under another name, or one whose runtime had been deleted
* made the finish say "already registered" — for a mailbox connected a moment ago that no server reached, in a
* report that read as success. In every other case the registration goes ahead, and its own preflight refuses what
* it must not replace: somebody else's server under that name, or ours without `--replace-server`.
*
* A config that cannot be read counts as not serving it: the registration is then made, and the installer refuses
* it if the unread file is the one it would write.
*/
async function clientServesInbox(env, request) {
	let servers;
	try {
		servers = await listRegisteredServers(env);
	} catch {
		return false;
	}
	const name = request.name ?? GMAIL_MCP.defaultServerName;
	for (const server of servers) {
		if (server.client !== request.client || server.name !== name || server.scope === "project") continue;
		if (!isProductServer(server, GMAIL_MCP)) continue;
		const pin = GMAIL_MCP.narrowingOf(server.args).inbox;
		if (pin !== void 0 && pin !== request.inbox) continue;
		if (await missingEntryFile(server) === null) return true;
	}
	return false;
}
/**
* The mailbox `client`'s entry of ours under the name serves, when that is another than `inbox` — the entry a
* registration for `inbox` would find in its place, pinned elsewhere — or null.
*
* A finish that registers the server for the mailbox it has just connected pins it to that mailbox when this is not
* null (#47). Left to the installer, a replacement keeps the pin of the entry it replaces, so `setup --replace-server`
* for `home` over an entry for `other` registered `other` again, and `home` was reached by nothing; and without
* `--replace-server` the refusal's hint was that same command. With the pin given, the replacement serves `home`, and
* the refusal names a second entry instead. Read as `clientServesInbox` reads: of ours, at user scope, under the name.
*/
async function mailboxServedElsewhere(env, request) {
	let servers;
	try {
		servers = await listRegisteredServers(env);
	} catch {
		return null;
	}
	const name = request.name ?? GMAIL_MCP.defaultServerName;
	for (const server of servers) {
		if (server.client !== request.client || server.name !== name || server.scope === "project") continue;
		if (!isProductServer(server, GMAIL_MCP)) continue;
		const pin = GMAIL_MCP.narrowingOf(server.args).inbox;
		if (pin !== void 0 && pin !== request.inbox) return pin;
	}
	return null;
}
//#endregion
export { VERSION as a, mailboxServedElsewhere as i, clientServesInbox as n, clientsRegisteredWith as r, GMAIL_MCP as t };
