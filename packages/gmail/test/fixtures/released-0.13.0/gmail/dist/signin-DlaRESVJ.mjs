import { A as PUBLIC_MAILBOX_DOMAINS, D as CommsError, Dn as withCredentialsLock, Dt as keepAndReport, F as activeGeneration, It as newInboxId, Jt as readWholeNumber, Mn as writeOutcome, Nt as nameAvailable, Tn as wholeNumber, Xt as recordOf, Y as clientSecretRef, dn as secretsStoreOf, ft as findById, hn as shellCommand, in as requireLiveOrganisationGeneration, it as defaultInternalDomains, jn as writeFileAtomic, kn as withdrawStaged, kt as lookupName, lt as ensurePrivateDir, ot as duplicateInbox, q as childEnvironment, rn as requireInbox, xt as inlineCommand } from "./dist-CBfqDru2.mjs";
import { C as scopesFor, S as parseGrantedScopes, b as capabilitiesOf, c as chooseClientForNewInbox, d as buildAuthUrl, f as exchangeCode, h as oauthError, l as generationServes, m as newState, o as setupClientChoiceNeedsMailbox, p as newPkce, u as organisationForClient, v as revokeToken, w as tierOf, y as TIERS } from "./setup-DWh5j-sH.mjs";
import { access, mkdir, open, readFile, readdir, rm } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { randomInt, timingSafeEqual } from "node:crypto";
import { constants as constants$1 } from "node:fs";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
//#region src/auth/flows.ts
const FLOW_ID_PATTERN = /^fl_[A-Za-z0-9]{22}$/;
const FLOW_TTL_MS = 6e5;
const BASE62 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
/**
* `fl_` + 22 base62 characters: 130 bits, and no characters that could confuse a file name.
*
* `randomInt`, not `byte % 62`: 256 is not a multiple of 62, so a reduced byte gives the first eight characters 5
* chances in 256 and the rest 4 — a quarter likelier. The Slack package's flow ids already do it this way.
*/
function newFlowId() {
	let out = "fl_";
	for (let i = 0; i < 22; i += 1) out += BASE62[randomInt(62)];
	return out;
}
/**
* How to start a sign-in like this one again, in the words of the surface asking.
*
* Every refusal of a sign-in that had run out said "Start again with `agent-gmail inbox add <alias> --start`" —
* to somebody re-authorising a mailbox, which would connect it as a new one and is refused because the name is taken,
* and to an agent over MCP, sending it to a command it may have no shell for, for a step its own tools take. The
* flow knows which kind it was and for which mailbox, and the store knows who is asking, so the step is named here.
*/
function startAgain(flow, surface, platform) {
	if (surface === "mcp") return flow.mode === "reauth" ? `call gmail_inbox_reauth with inbox "${flow.alias}"` : `call gmail_inbox_add with alias "${flow.alias}"`;
	return `run ${inlineCommand(shellCommand([
		"agent-gmail",
		"inbox",
		flow.mode === "reauth" ? "reauth" : "add",
		flow.alias,
		"--start"
	], platform))}`;
}
/** Flow files, each usable exactly once. The claim is an `O_EXCL` marker, so two `--finish` calls cannot both win. */
var FlowStore = class {
	directory;
	#now;
	/** Who is asking, so a refusal names the next step as that surface takes it. */
	#surface;
	#platform;
	constructor(stateDir, now = () => /* @__PURE__ */ new Date(), surface = "cli", platform = process.platform) {
		this.directory = join(stateDir, "flows");
		this.#now = now;
		this.#surface = surface;
		this.#platform = platform;
	}
	#path(flowId, suffix = ".json") {
		if (!FLOW_ID_PATTERN.test(flowId)) throw new CommsError("USAGE", `${flowId} is not a flow id`, { hint: "Flow ids look like fl_ followed by 22 letters and digits, and are printed by `inbox add --start`." });
		return join(this.directory, `${flowId}${suffix}`);
	}
	async create(flow) {
		const now = this.#now();
		const record = {
			...flow,
			flowId: newFlowId(),
			createdAt: now.toISOString(),
			expiresAt: new Date(now.getTime() + FLOW_TTL_MS).toISOString()
		};
		await ensurePrivateDir(this.directory);
		await this.#sweep();
		await writeFileAtomic(this.#path(record.flowId), `${JSON.stringify(record, null, 2)}\n`);
		return record;
	}
	/**
	* Discards flows whose window has passed.
	*
	* Nothing swept before, so an abandoned `inbox add --start` left its PKCE verifier, its `state` and — if consent
	* happened but `--finish` never ran — the **authorization code** on disk for ever. All of it is 0600 inside a
	* 0700 directory, so no other user can read it; the exposure is to whatever else reads the user's own files, a
	* backup or a `~/.config` tarball attached to a bug report. Swept here rather than on a timer because this is
	* the moment somebody is already writing to the directory.
	*/
	async #sweep() {
		let names;
		try {
			names = await readdir(this.directory);
		} catch {
			return;
		}
		const now = this.#now().getTime();
		for (const name of names) {
			const flowId = name.replace(/\.(outcome\.)?json$/, "");
			if (!FLOW_ID_PATTERN.test(flowId)) continue;
			try {
				const record = JSON.parse(await readFile(this.#path(flowId), "utf8"));
				const expiresAt = new Date(record.expiresAt).getTime();
				if (Number.isFinite(expiresAt) && now < expiresAt) continue;
			} catch {}
			await this.discard(flowId);
		}
	}
	/** Merges fields into a flow that has not been claimed (used to record the listener's port and pid). */
	async patch(flowId, patch) {
		const flow = {
			...await this.get(flowId),
			...patch
		};
		await writeFileAtomic(this.#path(flowId), `${JSON.stringify(flow, null, 2)}\n`);
		return flow;
	}
	async get(flowId) {
		let text;
		try {
			text = await readFile(this.#path(flowId), "utf8");
		} catch (error) {
			if (error.code !== "ENOENT") throw error;
			throw new CommsError("NOT_FOUND", `no sign-in is waiting under ${flowId}`, { hint: `A sign-in lasts ten minutes and can be finished once. ${this.#surface === "mcp" ? "Start again with gmail_inbox_add, or gmail_inbox_reauth for a mailbox already connected." : "Start again with `agent-gmail inbox add <alias> --start`, or `agent-gmail inbox reauth <alias> --start` for a mailbox already connected."}` });
		}
		const flow = JSON.parse(text);
		if (Date.parse(flow.expiresAt) <= this.#now().getTime()) {
			await this.discard(flowId);
			throw new CommsError("AUTH_REQUIRED", "that sign-in took longer than ten minutes and has expired", { hint: `Start again: ${startAgain(flow, this.#surface, this.#platform)}.` });
		}
		return flow;
	}
	/** The browser's answer, written by whichever process received the redirect. */
	async recordOutcome(flowId, outcome) {
		await ensurePrivateDir(this.directory);
		await writeFileAtomic(this.#path(flowId, ".outcome.json"), `${JSON.stringify({
			...outcome,
			at: this.#now().toISOString()
		}, null, 2)}\n`);
	}
	async readOutcome(flowId) {
		try {
			return JSON.parse(await readFile(this.#path(flowId, ".outcome.json"), "utf8"));
		} catch (error) {
			if (error.code === "ENOENT") return null;
			throw error;
		}
	}
	/**
	* Claims the flow for completion. `O_EXCL` on a marker file is the single-use guarantee: the file system decides,
	* not a lock we hold, so two processes racing to finish one sign-in cannot both exchange the code.
	*/
	async claim(flowId) {
		const flow = await this.get(flowId);
		await ensurePrivateDir(this.directory);
		try {
			const handle = await open(this.#path(flowId, ".claim"), "wx", 384);
			await handle.writeFile(`${JSON.stringify({
				pid: process.pid,
				at: this.#now().toISOString()
			})}\n`);
			await handle.close();
		} catch (error) {
			if (error.code !== "EEXIST") throw error;
			throw new CommsError("AUTH_REQUIRED", "that sign-in has already been finished", { hint: `Each sign-in completes once. To start another, ${startAgain(flow, this.#surface, this.#platform)}.` });
		}
		return flow;
	}
	/**
	* Removes every trace of a flow: the record with its verifier, the outcome, the claim marker and the detached
	* listener's log. Every one of them, or the state directory accumulates a file per sign-in that nothing reads.
	*/
	async discard(flowId) {
		for (const suffix of [
			".json",
			".outcome.json",
			".claim",
			".log"
		]) await rm(this.#path(flowId, suffix), { force: true });
	}
};
/**
* What the loopback page may say about a flow.
*
* Derived here rather than assembled at each call site, so the two listeners — the detached one and the one the
* interactive flow keeps in-process — cannot describe the same sign-in differently.
*/
function aboutFlow(flow) {
	return {
		alias: flow.alias,
		mode: flow.mode,
		tier: flow.tier,
		...flow.expect.email ? { expectEmail: flow.expect.email } : {}
	};
}
//#endregion
//#region src/auth/session.ts
function refreshTokenRef(inboxId) {
	return `gmail:refresh:${inboxId}`;
}
/**
* Turns the stored refresh token into short-lived access tokens, and keeps the one failure that matters legible:
* `invalid_grant` means the grant is gone (revoked, expired after 7 days of an unpublished app, or 6 months unused),
* which no retry fixes — but it also happens when another process has just replaced the token, so the stored value is
* re-read once before giving up.
*/
var TokenSource = class {
	alias;
	inbox;
	#core;
	#client;
	#endpoints;
	#now;
	#fetch;
	#platform;
	#cached = null;
	#inFlight = null;
	constructor(options) {
		this.alias = options.alias;
		this.inbox = options.inbox;
		this.#core = options.core;
		this.#client = options.client;
		this.#endpoints = options.endpoints;
		this.#now = options.now ?? (() => Date.now());
		this.#fetch = options.fetchImpl ?? fetch;
		this.#platform = options.platform ?? process.platform;
	}
	/** A valid access token, refreshed when the cached one is within a minute of expiry. */
	async accessToken() {
		if (this.#cached && this.#cached.expiresAt - this.#now() > 6e4) return this.#cached;
		this.#inFlight ??= this.#refresh().finally(() => {
			this.#inFlight = null;
		});
		return this.#inFlight;
	}
	/** Drops the cached access token, so the next call refreshes. */
	invalidate() {
		this.#cached = null;
	}
	async #secrets() {
		return this.#core.secrets();
	}
	async #storedSecret(ref, what) {
		const value = await (await this.#secrets()).get(ref);
		if (value) return value;
		throw new CommsError("AUTH_REQUIRED", `the ${what} for ${this.alias} is not in the secret store`, { hint: what === "client secret" ? "Add the client again: `agent-gmail client add <client_secret.json>`." : `Sign in again: ${inlineCommand(shellCommand([
			"agent-gmail",
			"inbox",
			"reauth",
			this.alias
		], this.#platform))}.` });
	}
	async #refresh() {
		const clientSecret = await this.#storedSecret(clientSecretRef(this.inbox.client), "client secret");
		const tokenRef = refreshTokenRef(this.inbox.id);
		let refreshToken = await this.#storedSecret(tokenRef, "refresh token");
		try {
			return await this.#exchange(refreshToken, clientSecret);
		} catch (error) {
			if (!(error instanceof CommsError) || error.code !== "AUTH_REQUIRED") throw error;
			const store = await this.#secrets();
			store.invalidate(tokenRef);
			const current = await store.get(tokenRef);
			if (!current || current === refreshToken) {
				await this.#core.states.update(this.inbox.id, { lastError: {
					code: error.code,
					message: error.message,
					at: new Date(this.#now()).toISOString()
				} });
				throw error;
			}
			refreshToken = current;
			return this.#exchange(refreshToken, clientSecret);
		}
	}
	async #exchange(refreshToken, clientSecret) {
		let response;
		try {
			response = await this.#fetch(this.#endpoints.tokenUrl, {
				method: "POST",
				headers: { "content-type": "application/x-www-form-urlencoded" },
				body: new URLSearchParams({
					grant_type: "refresh_token",
					refresh_token: refreshToken,
					client_id: this.#client.clientId,
					client_secret: clientSecret
				})
			});
		} catch (error) {
			throw new CommsError("PROVIDER_UNAVAILABLE", "could not reach Google to refresh the access token", { cause: error });
		}
		const body = await response.json().catch(() => ({}));
		if (!response.ok || !body.access_token) {
			const error = oauthError(body.error ?? `http_${response.status}`, body.error_description);
			throw body.error === "invalid_grant" ? this.#explainInvalidGrant(error) : error;
		}
		const scopes = parseGrantedScopes(body.scope);
		const token = {
			token: body.access_token,
			expiresAt: this.#now() + (body.expires_in ?? 3600) * 1e3,
			scopes: scopes.length > 0 ? scopes : [...this.inbox.grantedScopes]
		};
		this.#cached = token;
		await this.#core.states.update(this.inbox.id, { lastRefreshOkAt: new Date(this.#now()).toISOString() });
		return token;
	}
	#explainInvalidGrant(error) {
		const created = Date.parse(this.inbox.createdAt);
		const days = Number.isFinite(created) ? (this.#now() - created) / 864e5 : NaN;
		const hint = days >= 6 && days <= 9 ? `This is about a week after consent, which is how long a Testing app's tokens last: publish the app (Google Auth Platform → Audience → Publish app), then ${inlineCommand(shellCommand([
			"agent-gmail",
			"inbox",
			"reauth",
			this.alias
		], this.#platform))}.` : `The grant is gone — revoked, or unused for six months. Sign in again: ${inlineCommand(shellCommand([
			"agent-gmail",
			"inbox",
			"reauth",
			this.alias
		], this.#platform))}.`;
		return new CommsError("AUTH_REQUIRED", `Google will not refresh the token for ${this.alias}`, {
			hint,
			cause: error
		});
	}
};
//#endregion
//#region src/gmail-api/errors.ts
function headerValue(headers, name) {
	if (!headers) return void 0;
	if (typeof headers.get === "function") return headers.get(name) ?? void 0;
	const record = headers;
	const key = Object.keys(record).find((k) => k.toLowerCase() === name);
	const value = key === void 0 ? void 0 : record[key];
	return Array.isArray(value) ? String(value[0]) : value === void 0 ? void 0 : String(value);
}
/** `Retry-After` is either seconds or an HTTP date; both are capped so a bad header cannot park a command for hours. */
function parseRetryAfter(value, nowMs = Date.now()) {
	if (!value) return void 0;
	const seconds = Number(value.trim());
	const ms = Number.isFinite(seconds) ? seconds * 1e3 : new Date(value).getTime() - nowMs;
	if (!Number.isFinite(ms) || ms < 0) return void 0;
	return Math.min(ms, 6e4);
}
/** Reads what matters out of a gaxios error, a fetch Response-like error, or anything else that was thrown. */
function describeGoogleError(error, nowMs = Date.now()) {
	const anyError = error;
	const response = anyError?.response;
	const inner = (response?.data)?.error;
	const numericCode = typeof anyError?.code === "number" ? anyError.code : void 0;
	const status = response?.status ?? anyError?.status ?? inner?.code ?? numericCode;
	const reasons = [
		...(inner?.errors ?? []).map((e) => e.reason),
		...(anyError?.errors ?? []).map((e) => e.reason),
		inner?.status,
		typeof anyError?.code === "string" ? anyError.code : void 0
	].filter((reason) => typeof reason === "string" && reason.length > 0);
	const message = inner?.message ?? anyError?.message ?? String(error);
	return {
		status: typeof status === "number" ? status : void 0,
		reasons,
		message,
		retryAfterMs: parseRetryAfter(headerValue(response?.headers, "retry-after"), nowMs),
		activationUrl: /https:\/\/console\.(?:developers|cloud)\.google\.com\/\S+/.exec(message)?.[0]?.replace(/[.,)]+$/, "")
	};
}
const RATE_LIMIT_REASONS = /* @__PURE__ */ new Set([
	"rateLimitExceeded",
	"userRateLimitExceeded",
	"quotaExceeded",
	"backendError",
	"RESOURCE_EXHAUSTED",
	"UNAVAILABLE"
]);
const SEND_REFUSED_BEFORE_ACTING = /* @__PURE__ */ new Set([
	400,
	401,
	403,
	404,
	429
]);
/** Whether a failed send request certainly did nothing at Gmail. */
function sendCertainlyRefused(error) {
	if (error instanceof CommsError && error.code === "SEND_REFUSED") return true;
	const status = describeGoogleError((error instanceof Error ? error.cause : void 0) ?? error).status;
	return status !== void 0 && SEND_REFUSED_BEFORE_ACTING.has(status);
}
/** True when the same request may be sent again (the caller still decides whether the operation is safe to repeat). */
function isRetryable(shape) {
	if (shape.status === 429) return true;
	if (shape.status !== void 0 && shape.status >= 500) return true;
	if (shape.status === 403 && shape.reasons.some((reason) => RATE_LIMIT_REASONS.has(reason))) return true;
	if (shape.status === void 0) return /ECONNRESET|ETIMEDOUT|EAI_AGAIN|ENOTFOUND|ECONNREFUSED|EPIPE|socket hang up|network|fetch failed/i.test(shape.message);
	return false;
}
/**
* Turns a Google failure into the error a user or agent can act on. Every branch names the fix, because the same HTTP
* status means very different things here: 403 is a quota pause, a missing scope, an admin policy or a disabled API.
*/
function mapGoogleError(error, context = {}) {
	if (error instanceof CommsError) return error;
	const shape = describeGoogleError(error);
	const alias = context.alias ?? "<alias>";
	const platform = context.platform ?? process.platform;
	const where = context.operation ? ` while trying to ${context.operation}` : "";
	const reasons = new Set(shape.reasons);
	if (shape.status === 401) return new CommsError("AUTH_REQUIRED", `Google rejected the credentials for ${alias}${where}`, {
		hint: `Sign in again: ${inlineCommand(shellCommand([
			"agent-gmail",
			"inbox",
			"reauth",
			alias
		], platform))}.`,
		cause: error
	});
	if (shape.status === 403) {
		if (reasons.has("accessNotConfigured") || reasons.has("SERVICE_DISABLED")) {
			const api = context.api === "people" ? "People API" : "Gmail API";
			return new CommsError("CONFIG", `the ${api} is not enabled for this Google Cloud project`, {
				hint: shape.activationUrl ? `Enable it here, then retry: ${shape.activationUrl}` : `Enable the ${api} in the Google Cloud project that owns the OAuth client.`,
				cause: error
			});
		}
		if (reasons.has("ACCESS_TOKEN_SCOPE_INSUFFICIENT") || reasons.has("insufficientPermissions")) return new CommsError("SCOPE_MISSING", `${alias} was not granted the permission this needs${where}`, {
			hint: `Grant it: ${inlineCommand(shellCommand([
				"agent-gmail",
				"inbox",
				"reauth",
				alias,
				"--tier",
				"organize"
			], platform))}.`,
			cause: error
		});
		if (reasons.has("domainPolicy")) return new CommsError("AUTH_REQUIRED", `a Google Workspace policy blocks this app for ${alias}${where}`, {
			hint: "An administrator can allow the OAuth client under Security → API controls → Manage third-party app access.",
			cause: error
		});
		if ([...reasons].some((reason) => RATE_LIMIT_REASONS.has(reason))) return new CommsError("TRANSIENT", `Google is rate-limiting this account${where}`, {
			hint: "Wait a minute and retry.",
			cause: error
		});
		return new CommsError("AUTH_REQUIRED", `Google refused the request for ${alias}${where}: ${shape.message}`, { cause: error });
	}
	if (shape.status === 404) return new CommsError("NOT_FOUND", shape.message || `not found${where}`, { cause: error });
	if (shape.status === 429) return new CommsError("TRANSIENT", `Google is rate-limiting this account${where}`, {
		hint: "Wait a minute and retry.",
		cause: error
	});
	if (shape.status !== void 0 && shape.status >= 500) return new CommsError("TRANSIENT", `Google returned ${shape.status}${where}`, {
		hint: "A Google-side error. Retry shortly.",
		cause: error
	});
	if (shape.status === 400 && reasons.has("failedPrecondition")) return new CommsError("BAD_DATA", shape.message, { cause: error });
	if (shape.status === void 0) return new CommsError("PROVIDER_UNAVAILABLE", `could not reach Google${where}: ${shape.message}`, { cause: error });
	return new CommsError("BAD_DATA", `Google rejected the request${where}: ${shape.message}`, { cause: error });
}
//#endregion
//#region src/operations/inbox-names.ts
/**
* Refuses a name a new mailbox cannot take, under whichever version the config is.
*
* Version 1 keeps Gmail's rule — any valid plain name not already a mailbox. Version 2 is the organisation/platform
* grammar ending in `/gmail`, free across mailboxes and workspaces, and never a former name. Both come from core's
* `nameAvailable`; only the wording for a name that is already a mailbox is Gmail's own, because the fix for it —
* re-authorise that mailbox — is something only this package can suggest.
*/
function requireNewInboxName(config, alias, whenTaken, platform = process.platform) {
	const check = nameAvailable(config, "inbox", alias, "gmail");
	if (check.ok) return;
	if (lookupName(config, "inbox", alias)) throw new CommsError("CONFIG", `an inbox called "${alias}" already exists`, { hint: whenTaken ?? `Re-authorise it with ${inlineCommand(shellCommand([
		"agent-gmail",
		"inbox",
		"reauth",
		alias
	], platform))}, or choose another name.` });
	throw check.error;
}
//#endregion
//#region src/gmail-api/profile.ts
/**
* `users.getProfile` with an access token in hand, before any inbox exists to build a transport for. Used by the
* post-consent identity check, where Gmail — not the ID token, and not what the user typed — is the authority on
* which mailbox was just authorised.
*/
async function getProfileWithToken(endpoints, accessToken) {
	let response;
	const url = new URL("gmail/v1/users/me/profile", endpoints.gmailRoot);
	try {
		response = await fetch(url, { headers: { authorization: `Bearer ${accessToken}` } });
	} catch (error) {
		throw new CommsError("PROVIDER_UNAVAILABLE", "could not reach Gmail to confirm which account this is", { cause: error });
	}
	const body = await response.json().catch(() => ({}));
	if (!response.ok) throw mapGoogleError({ response: {
		status: response.status,
		data: body
	} }, {
		operation: "confirm which account signed in",
		api: "gmail"
	});
	if (!body.emailAddress) throw new CommsError("PROVIDER_UNAVAILABLE", "Gmail did not say which address this is", { details: { status: describeGoogleError(body).status } });
	return { emailAddress: body.emailAddress };
}
//#endregion
//#region src/auth/loopback.ts
/** Values here come from a CLI argument or an MCP call, so they are escaped rather than trusted. */
function escapeHtml(value) {
	return value.replace(/[&<>"']/g, (char) => ({
		"&": "&amp;",
		"<": "&lt;",
		">": "&gt;",
		"\"": "&quot;",
		"'": "&#39;"
	})[char] ?? char);
}
const STYLE = `<style>
:root{color-scheme:light dark;--fg:#111;--dim:#666;--line:#e3e3e3;--bg:#fff;--accent:#1a7f5a}
@media (prefers-color-scheme:dark){:root{--fg:#ededed;--dim:#9a9a9a;--line:#2a2a2a;--bg:#141414;--accent:#4ade80}}
body{font-family:ui-sans-serif,system-ui,-apple-system,sans-serif;background:var(--bg);color:var(--fg);
margin:0;min-height:100vh;display:grid;place-items:center;padding:2rem;line-height:1.5}
main{max-width:30rem;width:100%}
.brand{font-size:.8rem;letter-spacing:.08em;text-transform:uppercase;color:var(--dim);margin:0 0 1.5rem}
h1{font-size:1.5rem;margin:0 0 .25rem;letter-spacing:-.01em}
h1 .tick{color:var(--accent)}
.lede{color:var(--dim);margin:0 0 1.75rem}
dl{display:grid;grid-template-columns:auto 1fr;gap:.4rem 1.25rem;margin:0 0 1.75rem;
padding:1rem 0;border-top:1px solid var(--line);border-bottom:1px solid var(--line);font-size:.95rem}
dt{color:var(--dim)}
dd{margin:0;font-variant-numeric:tabular-nums;word-break:break-all}
.note{font-size:.9rem;color:var(--dim);margin:0}
</style>`;
const BRAND = "<p class=\"brand\">agent-gmail</p>";
function pageOk(about) {
	const rows = [];
	if (about) {
		const what = about.mode === "reauth" ? "Re-authorising" : "Connecting";
		rows.push(`<dt>${what}</dt><dd>${escapeHtml(about.alias)}</dd>`);
		if (about.expectEmail) rows.push(`<dt>Asked for</dt><dd>${escapeHtml(about.expectEmail)}</dd>`);
		if (about.tier) rows.push(`<dt>Access</dt><dd>${escapeHtml(about.tier)}</dd>`);
	}
	const detail = rows.length > 0 ? `<dl>${rows.join("")}</dl>` : "";
	const check = about?.expectEmail ? `The address is checked against <strong>${escapeHtml(about.expectEmail)}</strong> before anything is stored, and a different account is refused.` : "The account is checked before anything is stored.";
	return `<!doctype html><meta charset="utf-8"><title>Signed in — agent-gmail</title>
<meta name="viewport" content="width=device-width,initial-scale=1">${STYLE}
<body><main>${BRAND}
<h1><span class="tick">&check;</span> Google returned the grant</h1>
<p class="lede">Nothing is stored yet.</p>
${detail}
<p class="note">${check} Close this tab — the terminal or the agent that started this will finish it and name the account.</p>
</main>`;
}
function pageError(about) {
	const who = about ? ` for <strong>${escapeHtml(about.alias)}</strong>` : "";
	return `<!doctype html><meta charset="utf-8"><title>Not signed in — agent-gmail</title>
<meta name="viewport" content="width=device-width,initial-scale=1">${STYLE}
<body><main>${BRAND}
<h1>Not signed in</h1>
<p class="lede">The sign-in${who} did not complete.</p>
<p class="note">Nothing was changed. Go back to your terminal or your agent: it will say what happened and how to start again.</p>
</main>`;
}
/**
* Serves exactly one OAuth redirect. A request without the expected `state` — a stray browser tab, a probe from
* another process on this machine — is answered and ignored, so it cannot cancel the sign-in the user is doing.
*/
async function startLoopback(options) {
	let settle = () => void 0;
	const result = new Promise((resolve) => {
		settle = resolve;
	});
	/** Constant-time comparison of two values that may be absent. */
	const sameSecret = (given, expected) => {
		if (given === null) return false;
		const a = Buffer.from(given, "utf8");
		const b = Buffer.from(expected, "utf8");
		return a.length === b.length && timingSafeEqual(a, b);
	};
	const server = createServer((request, response) => {
		const url = new URL(request.url ?? "/", "http://127.0.0.1");
		if (url.pathname === "/favicon.ico") {
			response.writeHead(404).end();
			return;
		}
		if (request.method !== "GET") {
			response.writeHead(405).end();
			return;
		}
		const state = url.searchParams.get("state");
		const code = url.searchParams.get("code");
		const error = url.searchParams.get("error");
		if (!sameSecret(state, options.state) || !code && !error) {
			response.writeHead(400, { "content-type": "text/html; charset=utf-8" }).end(pageError(void 0));
			return;
		}
		response.writeHead(200, {
			"content-type": "text/html; charset=utf-8",
			"cache-control": "no-store"
		}).end(code ? pageOk(options.about) : pageError(options.about));
		settle(code ? { code } : {
			error: error ?? "unknown_error",
			description: url.searchParams.get("error_description") ?? void 0
		});
	});
	await new Promise((resolve, reject) => {
		server.once("error", reject);
		server.listen(options.port ?? 0, "127.0.0.1", () => {
			server.removeListener("error", reject);
			resolve();
		});
	});
	const { port } = server.address();
	const timeoutMs = options.timeoutMs ?? 6e5;
	const timer = setTimeout(() => settle({ timeout: true }), timeoutMs);
	timer.unref?.();
	result.finally(() => clearTimeout(timer));
	return {
		port,
		redirectUri: `http://127.0.0.1:${port}/`,
		result,
		close: () => new Promise((resolve) => {
			server.close(() => resolve());
			server.closeAllConnections?.();
		})
	};
}
//#endregion
//#region src/operations/consent.ts
/**
* Everything between "the browser came back with a code" and "the inbox is usable", in the order that keeps a wrong
* account from ever being written:
*
*   1. exchange the code (PKCE verifier from the flow file);
*   2. read what was actually granted — a user can untick scopes — and stop if the tier's read scope is missing;
*   3. confirm which account this is, from the ID token and then from Gmail itself;
*   4. refuse a mismatch with what was asked for, or a second inbox for an account already connected;
*   5. only then store the refresh token, and only then write the registry row.
*/
async function completeConsent(context, flow, code) {
	const starting = await context.config();
	const expectedClientId = requireSameClient(starting, flow, void 0, context.platform);
	const client = await context.client(flow.clientName);
	const tokens = await exchangeCode({
		client: {
			clientId: client.clientId,
			clientSecret: await clientSecret(context, client, flow.clientName)
		},
		endpoints: context.endpoints,
		code,
		codeVerifier: flow.codeVerifier,
		redirectUri: flow.redirectUri
	});
	const granted = tokens.grantedScopes;
	if (!capabilitiesOf(granted).has("read")) throw new CommsError("SCOPE_MISSING", "permission to read the mailbox was not granted, so nothing was saved", {
		hint: "Sign in again and leave every box ticked on the consent screen.",
		details: { granted }
	});
	const missingScopes = flow.scopes.filter((scope) => !granted.includes(scope));
	const identity = await verifyIdentity(context, tokens);
	const expectedGeneration = flow.expect.generation;
	if (expectedGeneration) {
		const generation = recordOf(starting, expectedGeneration.organisation)?.gmail?.generations.find((candidate) => candidate.name === expectedGeneration.name);
		if (!generation || !generationServes(generation, identity.email)) {
			try {
				await revokeToken(context.endpoints, tokens.refreshToken);
			} catch {}
			throw new CommsError("CONFIG", `the organisation ${expectedGeneration.organisation} says its Google client "${flow.clientName}" does not serve ${identity.email}; nothing was saved`, {
				hint: `Start the sign-in again through a client that serves this address; ${inlineCommand(shellCommand([
					"agent-gmail",
					"inbox",
					"add",
					"--help"
				], context.platform))} describes the --client option.`,
				details: {
					alias: flow.alias,
					client: flow.clientName,
					organisation: expectedGeneration.organisation,
					actual: identity.email
				}
			});
		}
	}
	const config = await context.config();
	const completed = await (flow.mode === "reauth" ? reauthorise(context, flow, config, tokens, identity, granted, missingScopes, expectedClientId) : addInbox(context, flow, config, tokens, identity, granted, missingScopes, expectedClientId));
	const organisation = completed.organisation ?? organisationForClient(config, flow.clientName);
	return organisation ? {
		...completed,
		organisation
	} : completed;
}
async function clientSecret(context, client, name) {
	const secret = await (await context.core.secrets()).get(client.secretRef);
	if (secret) return secret;
	throw new CommsError("CONFIG", `the secret for OAuth client "${name}" is not in the secret store`, { hint: "Add the client again: `agent-gmail client add <client_secret.json>`." });
}
/**
* Who signed in. The ID token comes from our own token-endpoint response over TLS, so its claims are read without a
* signature check; Gmail's own `getProfile` is then the authority on the address, because the account chooser can
* hand back an account the user did not mean to pick.
*/
async function verifyIdentity(context, tokens) {
	const email = (await getProfileWithToken(context.endpoints, tokens.accessToken)).emailAddress || tokens.idClaims.email || "";
	if (!email) throw new CommsError("AUTH_REQUIRED", "Google did not say which address this is, so nothing was saved");
	return {
		sub: tokens.idClaims.sub,
		email
	};
}
function refuseWrongAccount(expected, actual, alias) {
	throw new CommsError("AUTH_REQUIRED", `that sign-in was ${actual}, not ${expected}; nothing was saved`, {
		hint: `The account chooser picks whoever is already signed in. Run it again and choose ${expected}, or sign in to Google as ${expected} first.`,
		details: {
			alias,
			expected,
			actual
		}
	});
}
async function addInbox(context, flow, config, tokens, identity, granted, missingScopes, clientId) {
	if (flow.expect.email && flow.expect.email.toLowerCase() !== identity.email.toLowerCase()) refuseWrongAccount(flow.expect.email, identity.email, flow.alias);
	const duplicate = duplicateInbox(config, {
		client: flow.clientName,
		sub: identity.sub,
		email: identity.email
	});
	if (duplicate) throw new CommsError("CONFIG", `${identity.email} is already connected as "${duplicate}"`, { hint: `Use it as "${duplicate}", rename it (${inlineCommand(shellCommand([
		"agent-gmail",
		"inbox",
		"rename",
		duplicate,
		flow.alias
	], context.platform))}), or remove it first.` });
	requireNewInboxName(config, flow.alias, void 0, context.platform);
	const id = newInboxId();
	const inbox = {
		id,
		provider: "gmail",
		email: identity.email,
		sub: identity.sub,
		identity: identity.sub ? "oidc" : "legacy",
		client: flow.clientName,
		tier: tierOf(granted) ?? flow.tier,
		contacts: capabilitiesOf(granted).has("contacts"),
		grantedScopes: granted,
		secretRef: refreshTokenRef(id),
		internalDomains: defaultInternalDomains(identity.email, PUBLIC_MAILBOX_DOMAINS),
		createdAt: context.now().toISOString()
	};
	const secrets = await context.core.secrets();
	let refused = false;
	let entered = false;
	try {
		await withCredentialsLock(context.core.paths.configDir, async () => {
			entered = true;
			await secrets.set(inbox.secretRef, tokens.refreshToken);
			await context.core.config.update((current) => {
				refused = true;
				requireNewInboxName(current, flow.alias, void 0, context.platform);
				requireSameClient(current, flow, clientId, context.platform, identity.email);
				if (secretsStoreOf(current) !== secrets.kind) throw new CommsError("TRANSIENT", "the secret store was changed while this sign-in was completing", { hint: "Nothing was saved. Sign in again." });
				const raced = duplicateInbox(current, {
					client: flow.clientName,
					sub: identity.sub,
					email: identity.email
				});
				if (raced) throw new CommsError("CONFIG", `${identity.email} was connected as "${raced}" while this finished`);
				refused = false;
				return {
					...current,
					inboxes: {
						...current.inboxes,
						[flow.alias]: inbox
					}
				};
			});
		});
	} catch (error) {
		if (!entered && error instanceof CommsError && error.code === "LOCK_TIMEOUT") {
			await revokeGrantBestEffort(context, tokens.refreshToken);
			throw new CommsError("TRANSIENT", "another operation on stored credentials is running, so nothing was saved", {
				hint: "Start the sign-in again in a moment.",
				cause: error
			});
		}
		if (refused) {
			const withdrawn = await withdrawStaged(secrets, inbox.secretRef, error);
			await revokeGrantBestEffort(context, tokens.refreshToken);
			throw withdrawn;
		}
		const landed = await writeOutcome(async () => findById(await context.config(), "inbox", id)?.inbox.secretRef === inbox.secretRef);
		if (landed === "unknown") throw keepAndReport(error, inbox.secretRef, "Run `agent-gmail inbox list`.");
		if (landed === "absent") {
			const withdrawn = await withdrawStaged(secrets, inbox.secretRef, error);
			await revokeGrantBestEffort(context, tokens.refreshToken);
			throw withdrawn;
		}
	}
	await context.core.states.update(id, {
		lastRefreshOkAt: context.now().toISOString(),
		grantedScopes: granted,
		refreshTokenExpiresAt: tokens.refreshTokenExpiresAt ? new Date(tokens.refreshTokenExpiresAt).toISOString() : void 0
	});
	await context.core.audit.append({
		inboxId: id,
		alias: flow.alias,
		operation: "inbox.add",
		outcome: "ok",
		surface: context.surface
	});
	context.forgetTransports();
	return {
		alias: flow.alias,
		inbox,
		missingScopes,
		reauthorised: false,
		client: flow.clientName,
		...flow.expect.generation ? { organisation: flow.expect.generation.organisation } : {}
	};
}
async function reauthorise(context, flow, config, tokens, identity, granted, missingScopes, clientId) {
	const inboxId = flow.expect.inboxId;
	if (!inboxId) throw inboxGone();
	let result;
	let entered = false;
	try {
		result = await withCredentialsLock(context.core.paths.configDir, () => {
			entered = true;
			return writeReauth(context, flow, inboxId, tokens, identity, granted, clientId);
		});
	} catch (error) {
		if (!entered && error instanceof CommsError && error.code === "LOCK_TIMEOUT") {
			await revokeGrantBestEffort(context, tokens.refreshToken);
			throw new CommsError("TRANSIENT", "another operation on stored credentials is running, so nothing was saved", {
				hint: `Run ${inlineCommand(shellCommand([
					"agent-gmail",
					"inbox",
					"reauth",
					flow.alias
				], context.platform))} again in a moment.`,
				cause: error
			});
		}
		throw error;
	}
	await context.core.states.update(inboxId, {
		lastRefreshOkAt: context.now().toISOString(),
		grantedScopes: granted,
		lastError: void 0
	});
	await context.core.audit.append({
		inboxId,
		alias: result.alias,
		operation: "inbox.reauth",
		outcome: "ok",
		surface: context.surface
	});
	context.forgetTransports();
	return {
		alias: result.alias,
		inbox: result.inbox,
		missingScopes,
		reauthorised: true,
		client: flow.clientName,
		...flow.expect.generation ? { organisation: flow.expect.generation.organisation } : {}
	};
}
function inboxGone() {
	return new CommsError("NOT_FOUND", "the inbox this sign-in was for no longer exists", { hint: "Add it again with `agent-gmail inbox add <alias>`." });
}
/** What a grant sets on an inbox row. Everything else — the send policy, the internal domains — carries over. */
function grantFields(flow, identity, granted, previous) {
	return {
		email: identity.email,
		sub: identity.sub ?? previous.sub,
		identity: identity.sub ? "oidc" : previous.identity,
		client: flow.clientName,
		tier: tierOf(granted) ?? previous.tier,
		contacts: capabilitiesOf(granted).has("contacts"),
		grantedScopes: granted
	};
}
/** The part of a reauth that must run under the credentials lock: read the row, write the token, write the row. */
async function writeReauth(context, flow, inboxId, tokens, identity, granted, clientId) {
	const config = await context.config();
	const existing = findById(config, "inbox", inboxId);
	if (!existing) throw inboxGone();
	if (existing.inbox.sub && identity.sub !== existing.inbox.sub) refuseWrongAccount(existing.inbox.email, identity.email, existing.alias);
	if (existing.inbox.email.toLowerCase() !== identity.email.toLowerCase()) refuseWrongAccount(existing.inbox.email, identity.email, existing.alias);
	const clash = Object.entries(config.inboxes).find(([, inbox]) => inbox.id !== inboxId && identity.sub !== void 0 && inbox.sub === identity.sub);
	if (clash) throw new CommsError("CONFIG", `that account is already connected as "${clash[0]}"`, { hint: `Remove "${clash[0]}" first if you want it under another name.` });
	const secrets = await context.core.secrets();
	const previous = await secrets.get(existing.inbox.secretRef);
	let written = {
		alias: existing.alias,
		inbox: {
			...existing.inbox,
			...grantFields(flow, identity, granted, existing.inbox)
		}
	};
	let refused = false;
	try {
		await secrets.set(existing.inbox.secretRef, tokens.refreshToken);
		await context.core.config.update((current) => {
			const now = findById(current, "inbox", inboxId);
			refused = true;
			if (!now) throw inboxGone();
			requireSameClient(current, flow, clientId, context.platform, identity.email);
			const twin = Object.entries(current.inboxes).find(([, row]) => row.id !== inboxId && row.client === flow.clientName && (identity.sub !== void 0 && row.sub === identity.sub || row.sub === void 0 && row.email.toLowerCase() === identity.email.toLowerCase()));
			if (twin) throw new CommsError("CONFIG", `${identity.email} was connected as "${twin[0]}" while this ran`, { hint: `Remove "${twin[0]}" first if you want it under this name.` });
			refused = false;
			written = {
				alias: now.alias,
				inbox: {
					...now.inbox,
					...grantFields(flow, identity, granted, now.inbox)
				}
			};
			return {
				...current,
				inboxes: {
					...current.inboxes,
					[now.alias]: written.inbox
				}
			};
		});
	} catch (error) {
		if (refused) {
			const restored = await restorePrevious(secrets, existing.inbox.secretRef, previous, error);
			await revokeGrantBestEffort(context, tokens.refreshToken);
			throw restored;
		}
		const landed = await writeOutcome(async () => findById(await context.config(), "inbox", inboxId) !== null);
		if (landed === "unknown") throw keepAndReport(error, existing.inbox.secretRef, "Run `agent-gmail inbox list`.");
		if (landed === "absent") throw await withdrawStaged(secrets, existing.inbox.secretRef, error);
		const after = findById(await context.config(), "inbox", inboxId);
		let holdsNewToken;
		try {
			secrets.invalidate(existing.inbox.secretRef);
			holdsNewToken = await secrets.get(existing.inbox.secretRef) === tokens.refreshToken;
		} catch (unreadable) {
			const settingsUpdated = Boolean(after && sameRow(after.inbox, written.inbox));
			const base = error instanceof CommsError ? error : new CommsError("UNEXPECTED", String(error));
			throw new CommsError(base.code, base.message, {
				hint: `${base.hint ? `${base.hint} ` : ""}Whether the new token reached the secret store could not be confirmed. This mailbox's settings ${settingsUpdated ? "were updated" : "were not changed"}. Run ${inlineCommand(shellCommand([
					"agent-gmail",
					"inbox",
					"reauth",
					after?.alias ?? existing.alias
				], context.platform))} again when the store is available; \`agent-gmail doctor\` says whether the mailbox still works.`,
				details: {
					tokenStateUnknown: existing.inbox.secretRef,
					settingsUpdated,
					storeError: unreadable.message
				},
				cause: error
			});
		}
		if (!after || !sameRow(after.inbox, written.inbox) || !holdsNewToken) throw await restorePrevious(secrets, existing.inbox.secretRef, previous, error);
	}
	return written;
}
/**
* Puts the reference back as it was before a reauth whose row was not written — and says so if that fails.
*
* As it was means the previous token, or no token when there was none: the row still describes the old client and
* grant, and a new token left under it — issued to another client, after `--client` — would be one it cannot use.
*/
async function restorePrevious(secrets, ref, previous, original) {
	try {
		if (previous === null) await secrets.delete(ref);
		else await secrets.set(ref, previous);
		return original;
	} catch (error) {
		const base = original instanceof CommsError ? original : new CommsError("UNEXPECTED", String(original));
		return new CommsError(base.code, base.message, {
			hint: `${base.hint ? `${base.hint} ` : ""}The previous token could not be put back, so the mailbox may not renew: run \`agent-gmail inbox reauth\` for it again.`,
			details: {
				tokenNotRestored: ref,
				restoreError: error.message
			},
			cause: original
		});
	}
}
/**
* Refuses a row whose OAuth client is no longer the one this sign-in exchanged its code with.
*
* The row records a client by name, and the token it names belongs to whichever client actually issued it — so a
* `client add --replace` or a `client remove` landing in between would leave a mailbox pointing at a client that
* cannot renew its token.
*/
function requireSameClient(config, flow, exchangedClientId, platform = process.platform, actualEmail) {
	const name = flow.clientName;
	const held = config.clients[name];
	const expectedClientId = flow.expect.clientId ?? exchangedClientId ?? held?.clientId;
	const expectedGeneration = flow.expect.generation;
	if (expectedGeneration) {
		const record = recordOf(config, expectedGeneration.organisation);
		const generation = record?.gmail?.generations.find((candidate) => candidate.name === expectedGeneration.name);
		if (!generation || generation.clientId !== expectedClientId) throw new CommsError("CONFIG", `the organisation ${expectedGeneration.organisation}'s Google client generation changed while this sign-in was being completed`, { hint: `Run ${inlineCommand(shellCommand([
			"agentcomms",
			"org",
			"update",
			expectedGeneration.organisation
		], platform))}, then start the sign-in again.` });
		requireLiveOrganisationGeneration(config, expectedGeneration.organisation, generation, platform);
		if (expectedGeneration.active && activeGeneration(record)?.name !== generation.name) throw new CommsError("CONFIG", `the organisation ${expectedGeneration.organisation}'s active Google client changed while this sign-in was being completed`, { hint: `Run ${inlineCommand(shellCommand([
			"agentcomms",
			"org",
			"update",
			expectedGeneration.organisation
		], platform))}, then start the sign-in again.` });
		if (expectedGeneration.forOtherAddresses && record?.forOtherAddresses !== true) throw new CommsError("CONFIG", `the organisation ${expectedGeneration.organisation} no longer offers its Google client for other addresses; nothing was saved`, { hint: `Choose another client, or run ${inlineCommand(shellCommand([
			"agentcomms",
			"org",
			"update",
			expectedGeneration.organisation,
			"--for-other-addresses",
			"on"
		], platform))} and start the sign-in again.` });
		if (actualEmail !== void 0 && !generationServes(generation, actualEmail)) throw new CommsError("CONFIG", `the organisation ${expectedGeneration.organisation} says its Google client "${flow.clientName}" does not serve ${actualEmail}; nothing was saved`, {
			hint: `Start the sign-in again through a client that serves this address; ${inlineCommand(shellCommand([
				"agent-gmail",
				"inbox",
				"add",
				"--help"
			], platform))} describes the --client option.`,
			details: {
				alias: flow.alias,
				client: flow.clientName,
				organisation: expectedGeneration.organisation,
				actual: actualEmail
			}
		});
	}
	if (held && expectedClientId && held.clientId === expectedClientId && (exchangedClientId === void 0 || exchangedClientId === expectedClientId)) return expectedClientId;
	throw new CommsError("CONFIG", `the OAuth client "${name}" changed while this sign-in was being completed`, { hint: held ? `Run \`agent-gmail inbox reauth\` for this mailbox again, through the client it should use.` : `Register it again with \`agent-gmail client add\`, then run the sign-in again.` });
}
async function revokeGrantBestEffort(context, refreshToken) {
	try {
		await revokeToken(context.endpoints, refreshToken);
	} catch {}
}
/** Whether two rows are the same, field for field, whatever order their keys were written in. */
function sameRow(a, b) {
	const canonical = (value) => Array.isArray(value) ? `[${value.map(canonical).join(",")}]` : value !== null && typeof value === "object" ? `{${Object.entries(value).filter(([, entry]) => entry !== void 0).sort(([x], [y]) => x < y ? -1 : x > y ? 1 : 0).map(([key, entry]) => `${JSON.stringify(key)}:${canonical(entry)}`).join(",")}}` : JSON.stringify(value);
	return canonical(a) === canonical(b);
}
//#endregion
//#region src/operations/signin.ts
/**
* How long a detached sign-in waits for its listener to say it is ready. Thirty seconds, not ten: starting a process on
* a busy machine, or a slow Windows one, took longer than ten, and a listener that was merely slow was killed and its
* sign-in thrown away. It bounds only how long a listener that will never report is waited for. Slack's is the same.
*/
const LISTENER_START_MS = 3e4;
function parseTier(value, fallback = "organize") {
	if (value === void 0) return fallback;
	if (TIERS.includes(value)) return value;
	throw new CommsError("USAGE", `"${value}" is not a permission tier`, { hint: `Use one of: ${TIERS.join(", ")}.` });
}
const TIER_RANK = {
	read: 0,
	draft: 1,
	organize: 2
};
/** What each tier lets an agent do to a mailbox, in the words a person approving a wider one reads. */
const TIER_ABILITY = {
	read: "read its mail",
	draft: "read its mail and write drafts",
	organize: "read its mail, write drafts, and label, archive and bin messages"
};
/**
* Re-authorising a mailbox, as one change both surfaces run through core's flow.
*
* Renewing a grant, or narrowing one, gives an agent nothing it did not have, and starts at once. Asking Google for
* more than the mailbox holds now — a wider tier, or the address book it does not have — is a widening: the person
* approves it before the sign-in link exists, because once Google's consent screen is clicked through the token
* can do it, and nothing afterwards takes that back. The config store does not measure a tier, so the widening is
* stated as the change's effect, and the preview says what the mailbox will be able to do.
*
* Measured against what the grant actually holds (`grantedScopes`), not the tier recorded beside it: somebody who
* unticked a box on the consent screen has a narrower mailbox than its label, and asking for the box again asks for
* something it does not have.
*/
function inboxReauthChange(context, options) {
	checkedPort(options.port, context.surface);
	return {
		plan: (config) => {
			const inbox = requireInbox(config, options.alias);
			const recorded = TIERS.includes(inbox.tier) ? inbox.tier : void 0;
			const has = tierOf(inbox.grantedScopes) ?? recorded ?? "read";
			const asks = parseTier(options.tier, recorded ?? "organize");
			const hadContacts = capabilitiesOf(inbox.grantedScopes).has("contacts");
			const addsContacts = (options.contacts ?? inbox.contacts) && !hadContacts;
			const widens = TIER_RANK[asks] > TIER_RANK[has] || addsContacts;
			const client = options.client ?? inbox.client;
			return {
				inbox: options.alias,
				before: config,
				after: config,
				summary: widens ? `Let ${options.alias} do more: ${has}${hadContacts ? " and contacts" : ""} → ${asks}${addsContacts || hadContacts ? " and contacts" : ""}` : `Sign in to ${options.alias} again`,
				effects: widens ? [`signs in to Google again as ${inbox.email}, through the OAuth client "${client}", and asks for ${asks} access${addsContacts ? " and the address book" : ""}: an agent will be able to ${TIER_ABILITY[asks]}${addsContacts || hadContacts ? ", and search the address book" : ""}`] : []
			};
		},
		apply: () => startSignIn(context, {
			...options,
			mode: "reauth"
		})
	};
}
/**
* Starts a sign-in and returns the link to open. The listener that catches Google's redirect runs in a **detached**
* child process, because the agent that runs this command usually cannot wait: its shell is killed long before a
* person has read a consent screen. `--finish` then collects the result.
*/
async function startSignIn(context, options) {
	const port = checkedPort(options.port, context.surface);
	const config = await context.config();
	let clientName = options.client ?? Object.keys(config.clients)[0] ?? "default";
	let choice;
	let tier = parseTier(options.tier);
	let contacts = options.contacts ?? true;
	let expect = { email: options.email };
	if (options.mode === "reauth") {
		const inbox = requireInbox(config, options.alias);
		clientName = options.client ?? inbox.client;
		tier = parseTier(options.tier, TIERS.includes(inbox.tier) ? inbox.tier : "organize");
		contacts = options.contacts ?? inbox.contacts;
		expect = {
			email: options.email ?? inbox.email,
			sub: inbox.sub,
			inboxId: inbox.id
		};
		choice = chooseClientForNewInbox(config, {
			alias: options.alias,
			email: expect.email,
			client: clientName,
			platform: context.platform
		}) ?? void 0;
	} else {
		requireNewInboxName(config, options.alias, void 0, context.platform);
		if (!(options.setupWithoutGmailProfile !== void 0 && !setupClientChoiceNeedsMailbox(config))) {
			choice = chooseClientForNewInbox(config, {
				alias: options.alias,
				email: options.email,
				client: options.client,
				platform: context.platform
			}) ?? void 0;
			if (!choice) throw new CommsError("UNEXPECTED", "inbox add did not choose a Google client");
			clientName = choice.name;
		}
	}
	const client = await context.client(clientName);
	if (choice && client.clientId !== choice.clientId) throw new CommsError("CONFIG", `the OAuth client "${clientName}" changed after it was selected for this sign-in`, { hint: choice.organisation ? `Run ${inlineCommand(shellCommand([
		"agentcomms",
		"org",
		"update",
		choice.organisation
	], context.platform))}, then start the sign-in again.` : "Choose the client again, then start the sign-in again." });
	expect = {
		...expect,
		clientId: choice?.clientId ?? client.clientId,
		...choice?.organisation && choice.generation ? { generation: {
			organisation: choice.organisation,
			name: choice.generation.name,
			active: choice.activeGeneration === true,
			forOtherAddresses: choice.forOtherAddresses === true
		} } : {}
	};
	const pkce = newPkce();
	const scopes = scopesFor(tier, contacts);
	const flow = await context.flows.create({
		mode: options.mode,
		alias: options.alias,
		clientName,
		tier,
		contacts,
		scopes,
		state: newState(),
		codeVerifier: pkce.verifier,
		redirectUri: "",
		port: 0,
		expect,
		...options.registerWith ? { registerWith: options.registerWith } : {}
	});
	const started = options.detached === false ? await startInProcess(context, flow, port) : await startDetached(context, flow, options, port);
	const authUrl = buildAuthUrl({
		client: {
			clientId: client.clientId,
			clientSecret: ""
		},
		endpoints: context.endpoints,
		redirectUri: started.redirectUri,
		scopes,
		state: flow.state,
		codeChallenge: pkce.challenge,
		loginHint: expect.email,
		hostedDomain: options.hostedDomain
	});
	return {
		flowId: flow.flowId,
		expectedEmail: expect.email,
		authUrl,
		redirectUri: started.redirectUri,
		expiresAt: flow.expiresAt,
		listener: started.listener
	};
}
async function startInProcess(context, flow, port) {
	const listener = await startLoopback({
		state: flow.state,
		port,
		timeoutMs: Date.parse(flow.expiresAt) - context.now().getTime(),
		about: aboutFlow(flow)
	});
	await context.flows.patch(flow.flowId, {
		redirectUri: listener.redirectUri,
		port: listener.port
	});
	const result = (async () => {
		const outcome = await listener.result;
		await listener.close();
		if ("timeout" in outcome) {
			await context.flows.discard(flow.flowId);
			throw new CommsError("AUTH_REQUIRED", "nobody finished signing in within ten minutes");
		}
		if ("error" in outcome) {
			await context.flows.discard(flow.flowId);
			throw oauthError(outcome.error, outcome.description);
		}
		const claimed = await context.flows.claim(flow.flowId);
		try {
			return await completeConsent(context, claimed, outcome.code);
		} finally {
			await context.flows.discard(flow.flowId);
		}
	})();
	return {
		redirectUri: listener.redirectUri,
		listener: {
			result,
			close: () => listener.close()
		}
	};
}
/** Starts the listener in a detached child and waits only for it to report the port it bound. */
async function startDetached(context, flow, options, port) {
	const entry = options.listenerCommand ?? await defaultListenerCommand();
	const logPath = join(context.core.paths.stateDir, "flows", `${flow.flowId}.log`);
	let child;
	let spawnFailure = null;
	try {
		await mkdir(dirname(logPath), { recursive: true });
		const log = await open(logPath, "a");
		try {
			child = spawn(entry.command, [
				...entry.args,
				"oauth-listen",
				flow.flowId
			], {
				detached: true,
				stdio: [
					"ignore",
					"ignore",
					log.fd,
					"ipc"
				],
				env: childEnvironment({
					...process.env,
					...listenerEnv(context, port)
				})
			});
			child.once("error", (error) => {
				spawnFailure = error;
			});
		} finally {
			await log.close();
		}
		if (spawnFailure) throw spawnFailure;
	} catch (error) {
		await context.flows.discard(flow.flowId);
		throw new CommsError("UNEXPECTED", `the sign-in listener could not be started: ${error.message}`, {
			hint: "Run the sign-in on a terminal instead: `agent-gmail inbox add <alias>`.",
			cause: error
		});
	}
	try {
		await new Promise((resolve, reject) => {
			const timer = setTimeout(() => reject(/* @__PURE__ */ new Error("the sign-in listener did not start within thirty seconds")), LISTENER_START_MS);
			child.once("message", (message) => {
				clearTimeout(timer);
				if (message?.type === "ready") resolve();
				else reject(new Error(message?.error ?? "the sign-in listener could not start"));
			});
			child.once("error", (error) => {
				clearTimeout(timer);
				reject(error);
			});
			child.once("exit", (code) => {
				clearTimeout(timer);
				reject(/* @__PURE__ */ new Error(`the sign-in listener stopped before it was ready (exit ${code})`));
			});
		});
	} catch (error) {
		child.kill();
		await context.flows.discard(flow.flowId);
		throw new CommsError("UNEXPECTED", String(error.message), {
			hint: "Run the sign-in on a terminal instead: `agent-gmail inbox add <alias>`.",
			cause: error
		});
	}
	detachListener(child);
	return {
		redirectUri: (await context.flows.get(flow.flowId)).redirectUri,
		listener: void 0
	};
}
/**
* Lets the listener outlive this process, whoever closed the channel first.
*
* The listener disconnects itself straight after saying it is ready, so by the time this runs the channel may
* already be closed from the other end — and `disconnect()` on a closed channel throws. It did, on a busy machine:
* a pause of a few tens of milliseconds between "ready" and here was enough, every time, and a sign-in whose
* listener was alive and waiting for the browser was reported as an unexpected failure.
*/
function detachListener(child) {
	if (child.connected) child.disconnect();
	child.unref();
}
function listenerEnv(context, port) {
	const env = {
		AGENT_COMMS_CONFIG_DIR: context.core.paths.configDir,
		AGENT_COMMS_STATE_DIR: context.core.paths.stateDir
	};
	if (context.env.AGENT_COMMS_GOOGLE_ROOT_URL) env.AGENT_COMMS_GOOGLE_ROOT_URL = context.env.AGENT_COMMS_GOOGLE_ROOT_URL;
	if (port !== void 0) env.AGENT_COMMS_LOOPBACK_PORT = String(port);
	return env;
}
/**
* The command that can run `oauth-listen`, resolved from this module rather than from `process.argv[1]`.
*
* `process.argv[1]` is whatever binary happens to be running, and only one of them understands the hidden
* listener mode. Started as `agent-gmail` it is the CLI, which does. Started as `agent-gmail-mcp` — the packaged
* standalone server, and how most people run it — it is a different entry with no `oauth-listen` command at all,
* so the sign-in failed before it could return a URL. Under a test runner it is the test file.
*
* This package's own CLI is the thing that answers, wherever it is. The same reasoning, and nearly the same code,
* is in `mcp/install.ts`; the lesson had been learned once already and not carried here.
*
* The search is separated from where it searches *from* so a test can put it in a layout that does not exist on
* this machine — the packed one, `node_modules/@agentcomms/gmail/dist/`, being the layout this got wrong.
*/
async function resolveListenerEntry(here) {
	const candidates = [
		join(here, "..", "cli.ts"),
		join(here, "..", "..", "cli.mjs"),
		join(here, "cli.mjs"),
		join(here, "..", "cli.mjs")
	];
	for (const candidate of candidates) try {
		await access(candidate, constants$1.R_OK);
		const path = resolve(candidate);
		const flags = path.endsWith(".ts") ? ["--experimental-strip-types", "--disable-warning=ExperimentalWarning"] : [];
		return {
			command: process.execPath,
			args: [...flags, path]
		};
	} catch {}
	return null;
}
async function defaultListenerCommand() {
	const found = await resolveListenerEntry(dirname(fileURLToPath(import.meta.url)));
	if (found) return found;
	const entry = process.argv[1];
	if (!entry) throw new CommsError("UNEXPECTED", "cannot work out how to start the sign-in listener");
	return {
		command: process.execPath,
		args: [entry]
	};
}
/**
* The loopback port a sign-in listens on, checked rather than coerced: a whole number from 0 to 65535, where 0 — as
* leaving it out — is any free port.
*
* `--port` was `Number.parseInt`, so `--port abc` was NaN: the detached listener read that as no port and took any
* free one, and a person who had opened one port in a firewall got a link to another. `--port 70000` reached the
* listener and failed there as an unexpected error. The tool's schema took any whole number. One check for both
* surfaces now, naming the option as each spells it.
*/
function checkedPort(raw, surface) {
	return wholeNumber(raw, {
		name: surface === "mcp" ? "port" : "--port",
		min: 0,
		max: 65535,
		hint: "A loopback port, from 1 to 65535; 0, or leaving it out, lets the system pick a free one."
	});
}
/** The longest a finish waits for the browser: the sign-in's own life, since nothing can arrive after it ends. */
const MAX_WAIT_SECONDS = FLOW_TTL_MS / 1e3;
/**
* How long `--finish` or `gmail_inbox_finish` waits for the browser, checked rather than coerced.
*
* `--wait` was `Number.parseInt`, so `--wait abc` was NaN — a deadline no clock reaches, and a finish that waited for
* ever on a sign-in that lasts ten minutes — and `--wait 12abc` was twelve. The tool's schema held its wait to 0–600
* and the command held nothing. One check for both surfaces now: whole seconds, from 0 (look once and report) to the
* sign-in's own life, and anything else refused as USAGE with the range named, before anything is read.
*/
function checkedWait(raw, surface) {
	const given = raw ?? 60;
	const seconds = readWholeNumber(given);
	if (Number.isNaN(seconds) || seconds < 0 || seconds > MAX_WAIT_SECONDS) throw new CommsError("USAGE", `"${String(given)}" is not a wait`, { hint: surface === "mcp" ? `A whole number of seconds from 0 to ${MAX_WAIT_SECONDS}: a sign-in lasts ten minutes, so there is nothing to wait for after that. A client that gives up on a call sooner can call gmail_inbox_finish again.` : `A whole number of seconds from 0 to ${MAX_WAIT_SECONDS}. A sign-in lasts ten minutes, so there is nothing to wait for after that.` });
	return seconds;
}
/**
* Completes a sign-in exactly once. A wait that times out leaves the flow alone, so the user can run `--finish`
* again; only an answer from the browser claims it.
*/
async function finishSignIn(context, options) {
	const waitSeconds = checkedWait(options.waitSeconds, context.surface);
	const flow = await context.flows.get(options.flowId);
	if (options.onlyMode && flow.mode !== options.onlyMode) {
		const wanted = options.onlyMode === "add" ? "a new mailbox" : "re-authorising an existing mailbox";
		throw new CommsError("USAGE", `that sign-in is ${flow.mode === "reauth" ? "re-authorising an existing mailbox" : "a new mailbox"}, and this can only finish ${wanted}`, { hint: `Finish it where it was started: ${inlineCommand(shellCommand([
			"agent-gmail",
			"inbox",
			flow.mode,
			"--finish",
			options.flowId
		], context.platform))}.` });
	}
	if (options.onlyAlias !== void 0) {
		const expected = flow.mode === "reauth" ? flow.expect.inboxId : void 0;
		const config = expected === void 0 ? null : await context.config();
		const named = config ? lookupName(config, "inbox", options.onlyAlias) : void 0;
		if (!(expected === void 0 ? flow.alias === options.onlyAlias : named?.id === expected)) {
			const current = config && expected ? findById(config, "inbox", expected)?.alias ?? flow.alias : flow.alias;
			throw new CommsError("USAGE", `that sign-in is for "${current}", not "${options.onlyAlias}"`, { hint: `Finish it without a name — ${inlineCommand(shellCommand([
				"agent-gmail",
				"inbox",
				flow.mode,
				"--finish",
				options.flowId
			], context.platform))} — or start a sign-in for "${options.onlyAlias}".` });
		}
	}
	let code;
	if (options.url) code = codeFromUrl(options.url, flow);
	else {
		const outcome = await waitForOutcome(context, {
			...options,
			waitSeconds
		}, flow);
		if ("error" in outcome) {
			await context.flows.discard(flow.flowId);
			throw oauthError(outcome.error, outcome.description);
		}
		code = outcome.code;
	}
	const claimed = await context.flows.claim(flow.flowId);
	try {
		const connected = await completeConsent(context, claimed, code);
		return claimed.registerWith ? {
			...connected,
			registerWith: claimed.registerWith
		} : connected;
	} finally {
		stopListener(claimed);
		await context.flows.discard(flow.flowId);
	}
}
async function waitForOutcome(context, options, flow) {
	const deadline = context.now().getTime() + options.waitSeconds * 1e3;
	const expiresAt = Date.parse(flow.expiresAt);
	const pollMs = options.pollMs ?? 500;
	for (;;) {
		const abandoned = options.signal?.aborted === true;
		const outcome = abandoned ? null : await context.flows.readOutcome(flow.flowId);
		if (outcome) return outcome;
		if (!abandoned && context.now().getTime() >= expiresAt) await context.flows.get(flow.flowId);
		if (abandoned || context.now().getTime() >= deadline) throw new CommsError("APPROVAL_PENDING", "nobody has finished signing in yet", {
			hint: context.surface === "mcp" ? `Open the link, choose the account, then call gmail_inbox_finish with flowId ${flow.flowId} again.` : `Open the link, choose the account, then run ${inlineCommand(shellCommand([
				"agent-gmail",
				"inbox",
				flow.mode === "reauth" ? "reauth" : "add",
				"--finish",
				flow.flowId,
				"--wait",
				String(60)
			], context.platform))} again.`,
			details: {
				flowId: flow.flowId,
				expiresAt: flow.expiresAt
			}
		});
		await new Promise((resolve) => setTimeout(resolve, pollMs));
	}
}
function codeFromUrl(pasted, flow) {
	let url;
	try {
		url = new URL(pasted.trim());
	} catch {
		throw new CommsError("USAGE", "that does not look like the address the browser ended up at", { hint: "Copy the whole address, including everything after the question mark." });
	}
	const error = url.searchParams.get("error");
	if (error) throw oauthError(error, url.searchParams.get("error_description") ?? void 0);
	const state = url.searchParams.get("state");
	const code = url.searchParams.get("code");
	if (!code) throw new CommsError("USAGE", "that address carries no sign-in code", { hint: "It should contain `code=` — copy the address the browser ended up at after the consent screen." });
	if (state !== flow.state) throw new CommsError("AUTH_REQUIRED", "that address belongs to a different sign-in", { hint: "Use the address from the link this flow printed, or start again." });
	return code;
}
/** Best effort: the detached listener has done its job and would otherwise sit until the flow expires. */
function stopListener(flow) {
	if (!flow.listenerPid || flow.listenerPid === process.pid) return;
	const expiresAt = new Date(flow.expiresAt).getTime();
	if (!Number.isFinite(expiresAt) || Date.now() >= expiresAt) return;
	try {
		process.kill(flow.listenerPid, "SIGTERM");
	} catch {}
}
//#endregion
export { aboutFlow as _, inboxReauthChange as a, getProfileWithToken as c, isRetryable as d, mapGoogleError as f, FlowStore as g, refreshTokenRef as h, finishSignIn as i, requireNewInboxName as l, TokenSource as m, checkedPort as n, startSignIn as o, sendCertainlyRefused as p, checkedWait as r, startLoopback as s, MAX_WAIT_SECONDS as t, describeGoogleError as u };
