import { $ as commandText, At as managingOrganisation, Bt as organisationsOf, Ct as isGoogleClientId, D as CommsError, F as activeGeneration, Ht as parseName, Nt as nameAvailable, _n as shownText, hn as shellCommand, in as requireLiveOrganisationGeneration, kt as lookupName, qt as readProfileFile, vt as generationState, xt as inlineCommand } from "./dist-CBfqDru2.mjs";
import { r as readSmallFile } from "./small-file-ahBxLatE.mjs";
import { r as clientsRegisteredWith } from "./install-CAhyfCot.mjs";
import { lstat, readdir } from "node:fs/promises";
import { join } from "node:path";
import { createHash, randomBytes } from "node:crypto";
import { homedir } from "node:os";
//#region src/auth/scopes.ts
/**
* Permission tiers and what the granted scopes allow. Every tier also asks for `openid email`, which are non-sensitive
* and give the stable account id (`sub`) used to key inboxes and to catch sign-ins with the wrong account.
*
* No scope separates drafting from sending: `gmail.compose` and `gmail.modify` both allow `drafts.send`. The send gate
* is therefore enforced in code (see the approval engine), never by the grant.
*/
const SCOPES = {
	openid: "openid",
	email: "https://www.googleapis.com/auth/userinfo.email",
	gmailReadonly: "https://www.googleapis.com/auth/gmail.readonly",
	gmailCompose: "https://www.googleapis.com/auth/gmail.compose",
	gmailModify: "https://www.googleapis.com/auth/gmail.modify",
	contacts: "https://www.googleapis.com/auth/contacts.readonly",
	otherContacts: "https://www.googleapis.com/auth/contacts.other.readonly"
};
const TIERS = [
	"read",
	"draft",
	"organize"
];
/** The scopes to request for a tier (plus the contacts add-on). */
function scopesFor(tier, contacts) {
	const scopes = [SCOPES.openid, SCOPES.email];
	if (tier === "read") scopes.push(SCOPES.gmailReadonly);
	if (tier === "draft") scopes.push(SCOPES.gmailReadonly, SCOPES.gmailCompose);
	if (tier === "organize") scopes.push(SCOPES.gmailModify);
	if (contacts) scopes.push(SCOPES.contacts, SCOPES.otherContacts);
	return scopes;
}
/**
* Normalises a space-separated `scope` value into the full scope URLs the rest of this package compares against.
*
* Google's own token responses use full URLs, but not everything that writes a credentials file does. The legacy
* `@artymclabin/gmail-mcp` server records the shorthand — `gmail.readonly gmail.compose` — and `inbox import` reads
* exactly those files. Comparing shorthand against `https://www.googleapis.com/auth/gmail.readonly` matches nothing,
* so every mailbox in a real six-account migration was skipped as "this grant cannot read the mailbox" when all six
* could read perfectly well. Anything without a scheme is expanded to the `auth/` URL it is shorthand for.
*
* `openid` is left alone: it is a bare token by specification, not shorthand for a URL. `email` and `profile` are
* aliases Google itself accepts for the `userinfo.*` URLs, so they are mapped rather than expanded.
*/
function parseGrantedScopes(scope) {
	const ALIASES = {
		email: SCOPES.email,
		profile: "https://www.googleapis.com/auth/userinfo.profile"
	};
	const expand = (value) => {
		if (value === SCOPES.openid) return value;
		if (ALIASES[value]) return ALIASES[value];
		if (value.includes("://")) return value;
		return `https://www.googleapis.com/auth/${value}`;
	};
	return [...new Set((scope ?? "").split(/\s+/).filter(Boolean).map(expand))];
}
/** What an inbox can do with the scopes it was actually granted (users can untick boxes on the consent screen). */
function capabilitiesOf(granted) {
	const has = (scope) => granted.includes(scope);
	const caps = /* @__PURE__ */ new Set();
	if (has(SCOPES.gmailReadonly) || has(SCOPES.gmailModify)) caps.add("read");
	if (has(SCOPES.gmailCompose) || has(SCOPES.gmailModify)) caps.add("draft");
	if (has(SCOPES.gmailModify)) caps.add("organize");
	if (has(SCOPES.contacts) || has(SCOPES.otherContacts)) caps.add("contacts");
	return caps;
}
/** The highest tier the granted scopes support, or null when even reading is missing. */
function tierOf(granted) {
	const caps = capabilitiesOf(granted);
	if (caps.has("organize")) return "organize";
	if (caps.has("draft") && caps.has("read")) return "draft";
	if (caps.has("read")) return "read";
	return null;
}
/** The command that grants a missing capability, for SCOPE_MISSING hints. */
function grantHint(alias, needed, platform = process.platform) {
	if (needed === "contacts") return commandText(shellCommand([
		"agent-gmail",
		"inbox",
		"reauth",
		alias,
		"--contacts"
	], platform));
	return commandText(shellCommand([
		"agent-gmail",
		"inbox",
		"reauth",
		alias,
		"--tier",
		needed === "read" ? "read" : needed === "draft" ? "draft" : "organize"
	], platform));
}
//#endregion
//#region src/auth/oauth.ts
/** PKCE with S256 (Google defaults to `plain` if the method is omitted, so it never is). */
function newPkce() {
	const verifier = randomBytes(48).toString("base64url");
	return {
		verifier,
		challenge: createHash("sha256").update(verifier).digest("base64url")
	};
}
function newState() {
	return randomBytes(24).toString("base64url");
}
/** The consent URL. `select_account` forces the account chooser, so the wrong signed-in account is not picked silently. */
function buildAuthUrl(options) {
	const url = new URL(options.endpoints.authUrl);
	const params = {
		client_id: options.client.clientId,
		redirect_uri: options.redirectUri,
		response_type: "code",
		scope: options.scopes.join(" "),
		state: options.state,
		code_challenge: options.codeChallenge,
		code_challenge_method: "S256",
		access_type: "offline",
		prompt: "consent select_account"
	};
	if (options.loginHint) params.login_hint = options.loginHint;
	if (options.hostedDomain) params.hd = options.hostedDomain;
	for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
	return url.toString();
}
function decodeIdToken(idToken) {
	if (!idToken) return {};
	const payload = idToken.split(".")[1];
	if (!payload) return {};
	try {
		return JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
	} catch {
		return {};
	}
}
/** Maps an OAuth error to a CommsError with the fix the setup guide gives for it. */
function oauthError(error, description) {
	const detail = description ? ` (${description})` : "";
	switch (error) {
		case "access_denied": return new CommsError("AUTH_REQUIRED", `access was not granted${detail}`, { hint: "If the screen said \"Access blocked\", publish the app (Google Auth Platform → Audience → Publish app) and try again." });
		case "admin_policy_enforced": return new CommsError("AUTH_REQUIRED", `a Google Workspace administrator blocks this app${detail}`, { hint: "An admin can trust the client ID under Security → API controls → Manage third-party app access." });
		case "org_internal": return new CommsError("AUTH_REQUIRED", `the OAuth client is limited to its own organisation${detail}`, { hint: "Set the audience to External in Google Auth Platform → Audience." });
		case "redirect_uri_mismatch": return new CommsError("CONFIG", `the OAuth client is not a Desktop app${detail}`, { hint: "Create a client of type \"Desktop app\" and add it with `agent-gmail client add`." });
		case "invalid_client":
		case "deleted_client":
		case "unauthorized_client": return new CommsError("CONFIG", `Google does not accept this OAuth client (${error})${detail}`, { hint: "The client may have been deleted or its secret rotated: create a new Desktop client, add it, and re-authorise." });
		case "invalid_grant": return new CommsError("AUTH_REQUIRED", `Google refused the grant${detail}`, { hint: "Sign in again. If this happens about 7 days after the last sign-in, the app is still in Testing: publish it." });
		default: return new CommsError("AUTH_REQUIRED", `authorisation failed: ${error}${detail}`);
	}
}
async function postForm(url, body) {
	let response;
	try {
		response = await fetch(url, {
			method: "POST",
			headers: { "content-type": "application/x-www-form-urlencoded" },
			body: new URLSearchParams(body)
		});
	} catch (error) {
		throw new CommsError("PROVIDER_UNAVAILABLE", "could not reach Google", { cause: error });
	}
	const json = await response.json().catch(() => ({}));
	if (!response.ok) throw oauthError(String(json.error ?? `http_${response.status}`), json.error_description);
	return json;
}
/** Exchanges an authorisation code (with its PKCE verifier) for tokens. */
async function exchangeCode(options) {
	const json = await postForm(options.endpoints.tokenUrl, {
		grant_type: "authorization_code",
		code: options.code,
		code_verifier: options.codeVerifier,
		redirect_uri: options.redirectUri,
		client_id: options.client.clientId,
		client_secret: options.client.clientSecret
	});
	const refreshToken = json.refresh_token;
	if (typeof refreshToken !== "string" || !refreshToken) throw new CommsError("AUTH_REQUIRED", "Google returned no refresh token", { hint: "Remove the app at https://myaccount.google.com/connections and sign in again." });
	const now = Date.now();
	return {
		accessToken: String(json.access_token ?? ""),
		refreshToken,
		expiresAt: now + Number(json.expires_in ?? 3600) * 1e3,
		grantedScopes: parseGrantedScopes(json.scope),
		idClaims: decodeIdToken(json.id_token),
		refreshTokenExpiresAt: json.refresh_token_expires_in === void 0 ? void 0 : now + Number(json.refresh_token_expires_in) * 1e3
	};
}
/** Revokes a token (and, for an access token, its refresh token). Best effort: Google may take a while to apply it. */
async function revokeToken(endpoints, token) {
	await postForm(endpoints.revokeUrl, { token });
}
/**
* Checks credentials with Google before they are stored, by redeeming a code that cannot work. A live client answers
* `invalid_grant` ("the code is bad"); a deleted client or a wrong secret answers `invalid_client`. Worth the one
* request: the alternative is a confusing failure much later, after the user has deleted the downloaded JSON.
*/
async function probeClientCredentials(endpoints, client) {
	try {
		await postForm(endpoints.tokenUrl, {
			grant_type: "authorization_code",
			code: "agent-communications-probe",
			redirect_uri: "http://127.0.0.1:1/",
			client_id: client.clientId,
			client_secret: client.clientSecret
		});
		return { ok: true };
	} catch (error) {
		if (!(error instanceof CommsError)) return {
			ok: false,
			fatal: false,
			reason: "the check could not be made"
		};
		if (error.code === "PROVIDER_UNAVAILABLE") return {
			ok: false,
			fatal: false,
			reason: "Google could not be reached, so the client was not checked"
		};
		if (error.code === "AUTH_REQUIRED") return { ok: true };
		return {
			ok: false,
			fatal: true,
			error
		};
	}
}
/** Reads and validates a client JSON file's content: only Desktop (`installed`) clients are accepted. */
function parseClientJson(text) {
	let json;
	try {
		json = JSON.parse(text);
	} catch {
		throw new CommsError("BAD_DATA", "the client file is not valid JSON");
	}
	if (json.web && !json.installed) throw new CommsError("BAD_DATA", "this is a \"Web application\" client; a \"Desktop app\" client is needed", { hint: "In Google Auth Platform → Clients, create a client of type \"Desktop app\" and download its JSON." });
	const installed = json.installed;
	const clientId = installed?.client_id;
	const clientSecret = installed?.client_secret;
	if (!isGoogleClientId(clientId)) throw new CommsError("BAD_DATA", "the client file has no Desktop client id");
	if (typeof clientSecret !== "string" || !clientSecret) throw new CommsError("BAD_DATA", "the client file has no client secret", { hint: "Google shows the secret only when a client is created: download the JSON from the creation dialog, or add a new secret to the client." });
	return {
		clientId,
		clientSecret,
		projectId: typeof installed?.project_id === "string" ? installed.project_id : void 0
	};
}
//#endregion
//#region src/operations/client-choice.ts
function generationForLiveRow(config, name, row = config.clients[name]) {
	if (!row) return void 0;
	for (const [organisation, record] of Object.entries(organisationsOf(config)).sort(([left], [right]) => left.localeCompare(right))) {
		const generation = record.gmail?.generations.find((candidate) => candidate.name === name);
		if (!generation || generation.clientId !== row.clientId) continue;
		const ownedWithoutMarker = generation.ownership === "owned" && generationState(config, organisation, generation) === "unmarked";
		if (generation.ownership === "owned" && row.organisation !== organisation && !ownedWithoutMarker) continue;
		if (generation.ownership === "adopted" && row.organisation && row.organisation !== organisation) continue;
		return {
			organisation,
			label: record.label,
			generation
		};
	}
}
/** The organisation whose owned or adopted generation names this live client row, if there is one. */
function organisationForClient(config, name) {
	const row = config.clients[name];
	return generationForLiveRow(config, name, row)?.organisation;
}
function isAssociated(config, name, row) {
	if (managingOrganisation(config, row) !== null) return true;
	return generationForLiveRow(config, name, row) !== void 0;
}
/** Whether an address is one this generation says its Google client serves. */
function generationServes(generation, email) {
	if (generation.serves === "any") return true;
	const at = email.lastIndexOf("@");
	if (at < 1 || at === email.length - 1) return false;
	const domain = email.slice(at + 1).toLowerCase();
	return generation.serves.domains.includes(domain);
}
function refuseOutsideDomains(organisation, generation, email, platform) {
	if (email === void 0 || generationServes(generation, email)) return;
	throw new CommsError("CONFIG", `the organisation ${organisation} says its Google client "${generation.name}" does not serve ${email}`, {
		hint: `Choose a client that serves this address; ${inlineCommand(shellCommand([
			"agent-gmail",
			"inbox",
			"add",
			"--help"
		], platform))} describes the --client option.`,
		details: {
			organisation,
			client: generation.name
		}
	});
}
function organisationChoice(config, organisation, label, generation, email, active, forOtherAddresses, platform) {
	const row = requireLiveOrganisationGeneration(config, organisation, generation, platform);
	refuseOutsideDomains(organisation, generation, email, platform);
	return {
		name: generation.name,
		clientId: row.clientId,
		organisation,
		organisationLabel: shownText(label, 64),
		generation,
		activeGeneration: active,
		forOtherAddresses
	};
}
/**
* Chooses a client before a new-mailbox consent link is built, in the exact order of design 2026-10-02 §D6.
* Import never calls this function: an imported refresh token remains bound to the client it arrived with.
*/
function chooseClientForNewInbox(config, options) {
	const platform = options.platform ?? process.platform;
	if (options.client !== void 0) {
		const row = config.clients[options.client];
		const managed = generationForLiveRow(config, options.client, row);
		if (managed) return organisationChoice(config, managed.organisation, managed.label, managed.generation, options.email, false, false, platform);
		if (!row) throw new CommsError("CONFIG", `no OAuth client called "${options.client}" is registered`, { hint: `Register one as described by ${inlineCommand(shellCommand([
			"agent-gmail",
			"client",
			"add",
			"--help"
		], platform))}.` });
		if (row.provider !== "gmail") throw new CommsError("CONFIG", `"${options.client}" is not a Google OAuth client`, { hint: `Choose a client listed by ${inlineCommand(shellCommand([
			"agent-gmail",
			"client",
			"list"
		], platform))}.` });
		const markedFor = managingOrganisation(config, row);
		if (markedFor !== null) throw new CommsError("CONFIG", `the OAuth client "${options.client}" is marked for organisation ${markedFor}, but no matching live generation claims it`, { hint: `Run ${inlineCommand(shellCommand([
			"agentcomms",
			"org",
			"update",
			markedFor
		], platform))} (or comms_org_update from a chat) before signing in through it.` });
		return {
			name: options.client,
			clientId: row.clientId
		};
	}
	const parsed = parseName(options.alias);
	if (parsed) {
		const record = organisationsOf(config)[parsed.org];
		const active = activeGeneration(record);
		if (record && active) return organisationChoice(config, parsed.org, record.label, active, options.email, true, false, platform);
	}
	const optedIn = Object.entries(organisationsOf(config)).map(([organisation, record]) => ({
		organisation,
		record,
		generation: activeGeneration(record)
	})).filter((candidate) => candidate.record.forOtherAddresses && candidate.generation !== void 0).sort((left, right) => left.organisation.localeCompare(right.organisation));
	if (optedIn.length > 1) throw new CommsError("CONFIG", `more than one organisation offers its Google client for other addresses: ${optedIn.map((item) => item.organisation).join(", ")}`, { hint: `Choose one explicitly; ${inlineCommand(shellCommand([
		"agent-gmail",
		"inbox",
		"add",
		"--help"
	], platform))} describes the --client option.` });
	const offered = optedIn[0];
	if (offered) return organisationChoice(config, offered.organisation, offered.record.label, offered.generation, options.email, true, true, platform);
	const ordinary = Object.entries(config.clients).find(([name, row]) => row.provider === "gmail" && !isAssociated(config, name, row));
	if (ordinary) return {
		name: ordinary[0],
		clientId: ordinary[1].clientId
	};
	if (options.allowOwnClient) return null;
	const organisation = Object.entries(organisationsOf(config)).map(([name, record]) => ({
		name,
		record,
		generation: activeGeneration(record)
	})).find(({ name, generation }) => {
		if (!generation) return false;
		if (options.email !== void 0 && !generationServes(generation, options.email)) return false;
		try {
			requireLiveOrganisationGeneration(config, name, generation, platform);
			return true;
		} catch {
			return false;
		}
	});
	if (organisation?.generation) {
		const { name, generation } = organisation;
		const client = generation.name;
		const emailWords = options.email === void 0 ? [] : ["--email", options.email];
		const add = inlineCommand(shellCommand([
			"agent-gmail",
			"inbox",
			"add",
			options.alias,
			"--client",
			client,
			...emailWords,
			"--start"
		], platform));
		const offer = inlineCommand(shellCommand([
			"agentcomms",
			"org",
			"update",
			name,
			"--for-other-addresses",
			"on"
		], platform));
		const setup = inlineCommand(shellCommand([
			"agent-gmail",
			"setup",
			"--inbox",
			options.alias,
			...emailWords
		], platform));
		throw new CommsError("CONFIG", "no Google client is available for this new mailbox", { hint: `Choose this organisation explicitly with ${add}; let it serve other addresses with ${offer}; or make a client of your own with ${setup}.` });
	}
	const emailWords = options.email === void 0 ? [] : ["--email", options.email];
	const setup = inlineCommand(shellCommand([
		"agent-gmail",
		"setup",
		"--inbox",
		options.alias,
		...emailWords
	], platform));
	if (Object.values(organisationsOf(config)).some((record) => (record.gmail?.generations.length ?? 0) > 0)) {
		const unavailable = options.email === void 0 ? "no active, live organisation generation can be named explicitly" : "no active, live organisation generation that serves this address can be named explicitly";
		throw new CommsError("CONFIG", "no Google client is available for this new mailbox", { hint: `Make a client of your own with ${setup}; ${unavailable}.` });
	}
	throw new CommsError("CONFIG", "no Google client is registered for this new mailbox", { hint: `Run ${setup} to make a client of your own, or add an organisation profile first.` });
}
//#endregion
//#region src/operations/setup.ts
/**
* Google reorganised these screens in 2025; the old `APIs & Services → OAuth consent screen` paths are gone.
*
* The detail is deliberately field-by-field. Every one of these screens has inputs whose right answer is not
* obvious, and two of them have a wrong answer that looks more correct than the right one — a "Web application"
* client reads as the modern choice, and leaving an app in Testing reads as the cautious one. Both break things,
* one of them a week later.
*/
const CONSOLE_STEPS = [
	{
		id: "project",
		title: "Create a project",
		url: "https://console.cloud.google.com/projectcreate",
		why: "Credentials belong to a project. This one holds nothing else.",
		actions: [
			"Project name: anything you will recognise later — \"gmail-agent\" is fine.",
			"Location / organisation: leave as it is.",
			"Press Create, then wait for it to become the selected project at the top of the page."
		],
		avoid: []
	},
	{
		id: "api",
		title: "Enable the Gmail API",
		url: "https://console.cloud.google.com/apis/library/gmail.googleapis.com",
		why: "A project can reach no Google API until you turn that one on.",
		actions: [
			"Check the project named at the top is the one you just made.",
			"Press Enable, and wait for it to say the API is enabled.",
			"For contact search, do the same at the People API: https://console.cloud.google.com/apis/library/people.googleapis.com"
		],
		avoid: []
	},
	{
		id: "branding",
		title: "Branding",
		url: "https://console.cloud.google.com/auth/branding",
		why: "The name and address here are what your own sign-in screen will show you later.",
		actions: [
			"App name: anything. You are the only person who will see it.",
			"User support email: your own address, from the dropdown.",
			"Developer contact information: your own address again.",
			"Leave the logo, authorised domains and links empty. Press Save."
		],
		avoid: ["Do not upload a logo. It triggers a verification review you do not need."]
	},
	{
		id: "audience",
		title: "Audience — the step people get wrong",
		url: "https://console.cloud.google.com/auth/audience",
		why: "This decides whether your sign-in lasts, or stops working in seven days.",
		actions: [
			"User type: External.",
			"Find Publishing status, press PUBLISH APP, and confirm.",
			"When it is right, the status reads \"In production\"."
		],
		avoid: ["Do NOT add yourself under \"Test users\" and stop there. Testing mode has two consequences, and you will meet one of them: only the project owner and accounts listed as test users can sign in at all — every other address is refused with \"Access blocked … has not completed the Google verification process\" — and any sign-in that does work expires seven days later, because Google expires a test user's authorization and its refresh token with it.", "Publishing submits nothing for review and asks nothing of you. Verification only matters past 100 accounts."]
	},
	{
		id: "client",
		title: "Create the client",
		url: "https://console.cloud.google.com/auth/clients",
		why: "This is the credential itself — the file this tool reads.",
		actions: [
			"Press Create client.",
			"Application type: Desktop app.",
			"Name: anything. \"Desktop client 1\" is the default and is fine.",
			"Press Create, then download the JSON from the dialog that appears."
		],
		avoid: ["Application type must be Desktop app, NOT Web application. A Web client requires a registered redirect URI, and this signs in on a loopback address, so it is refused.", "Download the JSON from that dialog. Google shows the secret only when the client is created."]
	}
];
/** How many files the scan will open and read. A download directory can hold thousands; the answer is in the newest few. */
const MAX_CANDIDATES = 40;
/**
* How many it will take a date from first.
*
* `lstat` is cheap and reads no content, so a wider net here costs little and is what makes "the newest forty"
* mean anything. Past this the directory is pathological and the newest file is somebody else's problem.
*/
const MAX_NAMES_DATED = 500;
/**
* Desktop, web, or neither — decided by running the real parser, not by a check that resembles it.
*
* Saying "usable" about a file that is about to be rejected is worse than saying nothing, and this got there
* twice. First `{"installed": true}` passed a truthiness test. Then a rewrite required a non-empty `client_id`
* and still called a file usable when it had no `client_secret`, or an id without the
* `.apps.googleusercontent.com` suffix — because it was a second implementation of the same rules, and a second
* implementation drifts by definition.
*
* So it calls `parseClientJson` and reads the answer from whether it threw. There is nothing left to drift.
*/
function classifyClient(text) {
	let json;
	try {
		const parsed = JSON.parse(text);
		if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) return "unreadable";
		json = parsed;
	} catch {
		return "unreadable";
	}
	if (json.web && !json.installed) return "web";
	try {
		parseClientJson(text);
		return "desktop";
	} catch {
		return "unreadable";
	}
}
/** The directory the scan reads, so a person told "nothing found" is also told where nothing was found. */
function downloadDirectory(env = process.env) {
	const home = env.HOME || env.USERPROFILE || homedir();
	return env.XDG_DOWNLOAD_DIR || join(home, "Downloads");
}
async function findClientJson(env = process.env, options = {}) {
	const maxDated = options.maxDated ?? MAX_NAMES_DATED;
	const maxOpened = options.maxOpened ?? MAX_CANDIDATES;
	const directory = downloadDirectory(env);
	let names;
	try {
		names = await readdir(directory);
	} catch {
		return [];
	}
	const matches = names.filter((name) => /^client_secret.*\.json$/i.test(name)).slice(0, maxDated);
	const newest = (await Promise.all(matches.map(async (name) => {
		try {
			return {
				name,
				at: (await lstat(join(directory, name))).mtimeMs
			};
		} catch {
			return null;
		}
	}))).filter((entry) => entry !== null).sort((a, b) => b.at - a.at).slice(0, maxOpened);
	const found = await Promise.all(newest.map(async ({ name }) => {
		const path = join(directory, name);
		const file = await readSmallFile(path, { follow: false });
		if (!file.ok) {
			if (file.problem !== "too-large") return null;
			return {
				path,
				kind: "unreadable",
				modifiedAt: file.modifiedAt.toISOString(),
				at: file.modifiedMs
			};
		}
		const modifiedAt = file.modifiedAt.toISOString();
		return {
			path,
			kind: classifyClient(file.text),
			modifiedAt,
			at: file.modifiedMs
		};
	}));
	const rank = (kind) => kind === "desktop" ? 0 : kind === "web" ? 1 : 2;
	return found.filter((entry) => entry !== null).sort((a, b) => rank(a.kind) - rank(b.kind) || b.at - a.at).map(({ at: _at, ...candidate }) => candidate);
}
/**
* Refuses a setup target before a profile approval can mutate this machine.
*
* An exact existing Gmail inbox is a valid target to resume. A new name must pass core's complete versioned name
* rules: grammar, Gmail platform, both account maps, and former-name reservations. Keeping this beside `setupState`
* gives the CLI and MCP one trust boundary instead of two approximations that can drift.
*/
function requireSetupTarget(config, alias) {
	const existing = lookupName(config, "inbox", alias);
	if (existing) {
		if (existing.provider !== "gmail") throw new CommsError("CONFIG", `"${alias}" is not a Gmail mailbox`, { hint: "Choose a Gmail mailbox name." });
		return;
	}
	const available = nameAvailable(config, "inbox", alias, "gmail");
	if (!available.ok) throw available.error;
}
/** Whether an installed profile makes OAuth-client choice depend on the mailbox being added. */
function setupClientChoiceNeedsMailbox(config) {
	return Object.values(organisationsOf(config)).some((organisation) => activeGeneration(organisation) !== void 0);
}
/** The exact profile setup classifies and hands to core, so a path swap cannot change what the approval applies. */
async function loadSetupProfile(path) {
	return readProfileFile(path);
}
/** Where this machine is in the setup, what is already behind it, and the single next thing to do. */
async function setupState(context, options = {}) {
	const config = await context.core.config.load();
	const clients = Object.keys(config.clients);
	const inboxes = Object.keys(config.inboxes);
	const gmailProfileApplies = setupClientChoiceNeedsMailbox(config);
	const registeredWith = await clientsRegisteredWith(context.env);
	const target = gmailProfileApplies && options.alias ? lookupName(config, "inbox", options.alias) : void 0;
	const selected = gmailProfileApplies && options.alias && !target ? chooseClientForNewInbox(config, {
		alias: options.alias,
		email: options.email,
		client: options.client,
		allowOwnClient: true,
		platform: context.platform
	}) : void 0;
	const clientDone = !gmailProfileApplies ? clients.length > 0 : target ? config.clients[target.client]?.provider === "gmail" : options.alias ? selected !== null : false;
	const inboxDone = gmailProfileApplies ? target !== void 0 : inboxes.length > 0;
	const done = [];
	if (clientDone) done.push("client");
	if (inboxDone) done.push("inbox");
	if (registeredWith.length > 0) done.push("mcp");
	const next = !clientDone ? "client" : !inboxDone ? "inbox" : registeredWith.length === 0 ? "mcp" : "done";
	const candidates = options.scanDownloads === false ? [] : await findClientJson(context.env);
	const clientOf = Object.fromEntries(Object.entries(config.inboxes).map(([alias, inbox]) => [alias, inbox.client]));
	const targetOrganisation = target ? organisationForClient(config, target.client) : void 0;
	const clientChoice = target ? {
		name: target.client,
		...targetOrganisation ? { organisation: targetOrganisation } : {},
		...targetOrganisation ? { organisationLabel: shownText(organisationsOf(config)[targetOrganisation]?.label ?? targetOrganisation, 64) } : {}
	} : selected ? {
		name: selected.name,
		...selected.organisation ? { organisation: selected.organisation } : {},
		...selected.organisationLabel ? { organisationLabel: selected.organisationLabel } : {}
	} : null;
	const state = {
		next,
		done,
		clients,
		inboxes,
		clientOf,
		registeredWith,
		candidates
	};
	return gmailProfileApplies ? {
		...state,
		clientChoice
	} : state;
}
//#endregion
export { scopesFor as C, parseGrantedScopes as S, probeClientCredentials as _, requireSetupTarget as a, capabilitiesOf as b, chooseClientForNewInbox as c, buildAuthUrl as d, exchangeCode as f, parseClientJson as g, oauthError as h, loadSetupProfile as i, generationServes as l, newState as m, downloadDirectory as n, setupClientChoiceNeedsMailbox as o, newPkce as p, findClientJson as r, setupState as s, CONSOLE_STEPS as t, organisationForClient as u, revokeToken as v, tierOf as w, grantHint as x, TIERS as y };
