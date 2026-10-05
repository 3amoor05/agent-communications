import { a as __toESM, i as __require, t as __commonJSMin } from "./rolldown-runtime-CbG-q-O0.mjs";
import { $ as commandText, $t as renameEntry, A as PUBLIC_MAILBOX_DOMAINS, An as wrapUntrusted, At as managingOrganisation, C as savedName, D as CommsError, Dn as withCredentialsLock, Dt as keepAndReport, Et as isValidAlias, Ft as newBoundary, G as checkAttachable, It as newInboxId, J as chooseSecretStore, Kt as publicView, L as appendPrivateLine, Lt as normaliseAddress, M as TaintCollector, Mn as writeOutcome, Mt as missingEntryFile, Nt as nameAvailable, Ot as listRegisteredServers, Pn as writeSecretWithRestore, Pt as neutralise, Qt as relativeSubpath, Rt as openCore, S as saveFolders, Tn as wholeNumber, Tt as isProductServer, U as canonicalAddress, Ut as pinnedVersion, Wt as probeKeychain, X as collapseWhitespace, Y as clientSecretRef, Yt as recipientDomains, a as checkDownloadAnswer, an as resolveInsideRoot, at as domainOf$1, b as sanitizePlainText, bn as stricterPolicy, bt as homeDirectory, ct as effectiveSendPolicy, d as fileRisks, dn as secretsStoreOf, dt as expandHome, et as committedSecretsStore, f as fileWarnings, ft as findById, g as readComposeProfile, h as parseAddressList, hn as shellCommand, ht as formerNamesOf, i as askWhereToSave, it as defaultInternalDomains, j as RESERVED_ALIASES, jn as writeFileAtomic, jt as messageDigest, kn as withdrawStaged, kt as lookupName, ln as safeFilename, lt as ensurePrivateDir, m as markFromInternet, mn as sha256Hex, mt as formerNameRefusal, nt as defaultAttachDeny, o as createSavedFile, on as resolveName, ot as duplicateInbox, p as isPlainFileName, pt as findUngatedGmailServers, rn as requireInbox, rt as defaultChangePolicy, s as decodeHeaderWords, st as effectiveChangePolicy, t as analyseOutboundHtml, tn as renderMessagePreview, tt as createUniqueFile, u as downloadRecordPath, un as secretsStoreFor, w as settleDestination, wt as isGroupOrWorldAccessible, x as saveFailure, xt as inlineCommand, y as sanitizeHtmlToText, yn as slug, yt as gmailClientRow } from "./dist-CBfqDru2.mjs";
import { c as getProfileWithToken, d as isRetryable, f as mapGoogleError, g as FlowStore, h as refreshTokenRef, l as requireNewInboxName, m as TokenSource, p as sendCertainlyRefused, u as describeGoogleError } from "./signin-DlaRESVJ.mjs";
import { C as scopesFor, S as parseGrantedScopes, _ as probeClientCredentials, b as capabilitiesOf, g as parseClientJson, u as organisationForClient, v as revokeToken, w as tierOf, x as grantHint, y as TIERS } from "./setup-DWh5j-sH.mjs";
import { t as clearSetupProgress } from "./setup-progress-eNrpwI7M.mjs";
import { r as readSmallFile, t as MAX_CLIENT_BYTES } from "./small-file-ahBxLatE.mjs";
import { a as VERSION, t as GMAIL_MCP } from "./install-CAhyfCot.mjs";
import { a as planReply, i as formatAddress, r as composeMessage } from "./compose-b6IfZDeO.mjs";
import { mkdir, readFile, readdir, rm, stat } from "node:fs/promises";
import { basename, join, resolve } from "node:path";
import { createHash, randomBytes } from "node:crypto";
import { setTimeout as setTimeout$1 } from "node:timers/promises";
//#region src/auth/endpoints.ts
const GOOGLE_ENDPOINTS = {
	authUrl: "https://accounts.google.com/o/oauth2/v2/auth",
	tokenUrl: "https://oauth2.googleapis.com/token",
	revokeUrl: "https://oauth2.googleapis.com/revoke",
	gmailRoot: "https://gmail.googleapis.com/",
	peopleRoot: "https://people.googleapis.com/"
};
/**
* True when this module was loaded from TypeScript source — which is to say, from a checkout, never from a release.
*
* The published packages are bundles: `dist/*.mjs`. So this is a distinction an attacker cannot flip without
* replacing the installed files, and at that point the endpoint override is the least of anybody's problems.
*/
const RUNNING_FROM_SOURCE = import.meta.url.endsWith(".ts");
/**
* `AGENT_COMMS_GOOGLE_ROOT_URL` replaces every Google endpoint with a local test server, so the tests exercise the
* real bundled Google libraries — token refresh included — instead of a test-only code path.
*
* **It is ignored entirely in a released build**, and that is not belt-and-braces. Anyone able to influence this
* process's environment — an `env` block added to an MCP server entry in a client's config file, a shell profile, a
* launchd unit — could otherwise point the token endpoint at a local server of their own and receive every inbox's
* refresh token and the OAuth client secret in cleartext, the moment a token was refreshed. That is precisely the
* actor this package designs against elsewhere: one with file-write access and no mailbox access. The loopback
* restriction below does not help, because a local attacker is already local.
*/
function resolveEndpoints(env) {
	const override = env.AGENT_COMMS_GOOGLE_ROOT_URL;
	if (!override || !RUNNING_FROM_SOURCE) return GOOGLE_ENDPOINTS;
	let url;
	try {
		url = new URL(override);
	} catch {
		throw new CommsError("CONFIG", "AGENT_COMMS_GOOGLE_ROOT_URL is not a URL");
	}
	if (url.protocol !== "http:" || !isLoopbackHost(url.hostname)) throw new CommsError("CONFIG", "AGENT_COMMS_GOOGLE_ROOT_URL may only point at a loopback test server", { details: { host: url.hostname } });
	const root = url.origin;
	return {
		authUrl: `${root}/o/oauth2/v2/auth`,
		tokenUrl: `${root}/token`,
		revokeUrl: `${root}/revoke`,
		gmailRoot: `${root}/`,
		peopleRoot: `${root}/`
	};
}
/** Loopback by address, never by name: only `localhost` is trusted as a name, and only because Node resolves it locally. */
function isLoopbackHost(hostname) {
	const host = hostname.replace(/^\[|\]$/g, "").toLowerCase();
	if (host === "localhost") return true;
	if (host === "::1") return true;
	return /^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(host);
}
//#endregion
//#region ../../node_modules/.pnpm/extend@3.0.2/node_modules/extend/index.js
var require_extend = /* @__PURE__ */ __commonJSMin(((exports, module) => {
	var hasOwn = Object.prototype.hasOwnProperty;
	var toStr = Object.prototype.toString;
	var defineProperty = Object.defineProperty;
	var gOPD = Object.getOwnPropertyDescriptor;
	var isArray = function isArray(arr) {
		if (typeof Array.isArray === "function") return Array.isArray(arr);
		return toStr.call(arr) === "[object Array]";
	};
	var isPlainObject = function isPlainObject(obj) {
		if (!obj || toStr.call(obj) !== "[object Object]") return false;
		var hasOwnConstructor = hasOwn.call(obj, "constructor");
		var hasIsPrototypeOf = obj.constructor && obj.constructor.prototype && hasOwn.call(obj.constructor.prototype, "isPrototypeOf");
		if (obj.constructor && !hasOwnConstructor && !hasIsPrototypeOf) return false;
		var key;
		for (key in obj);
		return typeof key === "undefined" || hasOwn.call(obj, key);
	};
	var setProperty = function setProperty(target, options) {
		if (defineProperty && options.name === "__proto__") defineProperty(target, options.name, {
			enumerable: true,
			configurable: true,
			value: options.newValue,
			writable: true
		});
		else target[options.name] = options.newValue;
	};
	var getProperty = function getProperty(obj, name) {
		if (name === "__proto__") {
			if (!hasOwn.call(obj, name)) return;
			else if (gOPD) return gOPD(obj, name).value;
		}
		return obj[name];
	};
	module.exports = function extend() {
		var options, name, src, copy, copyIsArray, clone;
		var target = arguments[0];
		var i = 1;
		var length = arguments.length;
		var deep = false;
		if (typeof target === "boolean") {
			deep = target;
			target = arguments[1] || {};
			i = 2;
		}
		if (target == null || typeof target !== "object" && typeof target !== "function") target = {};
		for (; i < length; ++i) {
			options = arguments[i];
			if (options != null) for (name in options) {
				src = getProperty(target, name);
				copy = getProperty(options, name);
				if (target !== copy) {
					if (deep && copy && (isPlainObject(copy) || (copyIsArray = isArray(copy)))) {
						if (copyIsArray) {
							copyIsArray = false;
							clone = src && isArray(src) ? src : [];
						} else clone = src && isPlainObject(src) ? src : {};
						setProperty(target, {
							name,
							newValue: extend(deep, clone, copy)
						});
					} else if (typeof copy !== "undefined") setProperty(target, {
						name,
						newValue: copy
					});
				}
			}
		}
		return target;
	};
}));
//#endregion
//#region ../../node_modules/.pnpm/gaxios@7.3.1/node_modules/gaxios/package.json
var require_package$2 = /* @__PURE__ */ __commonJSMin(((exports, module) => {
	module.exports = {
		"name": "gaxios",
		"version": "7.3.1",
		"description": "A simple common HTTP client specifically for Google APIs and services.",
		"main": "build/cjs/src/index.js",
		"types": "build/cjs/src/index.d.ts",
		"files": ["build/"],
		"exports": { ".": {
			"import": {
				"types": "./build/esm/src/index.d.ts",
				"default": "./build/esm/src/index.js"
			},
			"require": {
				"types": "./build/cjs/src/index.d.ts",
				"default": "./build/cjs/src/index.js"
			}
		} },
		"scripts": {
			"lint": "gts check --no-inline-config",
			"test": "c8 mocha build/esm/test",
			"presystem-test": "npm run compile",
			"system-test": "mocha build/esm/system-test --timeout 80000",
			"compile": "tsc -b ./tsconfig.json ./tsconfig.cjs.json && node utils/enable-esm.mjs",
			"fix": "gts fix",
			"prepare": "npm run compile",
			"pretest": "npm run compile",
			"webpack": "webpack",
			"prebrowser-test": "npm run compile",
			"browser-test": "node build/browser-test/browser-test-runner.js",
			"docs": "jsdoc -c .jsdoc.js",
			"samples-test": "cd samples/ && npm link ../ && npm test && cd ../",
			"prelint": "cd samples; npm link ../; npm install",
			"clean": "gts clean"
		},
		"repository": {
			"type": "git",
			"directory": "core/packages/gaxios",
			"url": "https://github.com/googleapis/google-cloud-node.git"
		},
		"keywords": ["google"],
		"engines": { "node": ">=18" },
		"author": "Google, LLC",
		"license": "Apache-2.0",
		"devDependencies": {
			"@babel/plugin-proposal-private-methods": "^7.18.6",
			"@types/cors": "^2.8.6",
			"@types/express": "^5.0.0",
			"@types/extend": "^3.0.1",
			"@types/mocha": "^10.0.10",
			"@types/multiparty": "4.2.1",
			"@types/mv": "^2.1.0",
			"@types/ncp": "^2.0.8",
			"@types/node": "^24.0.0",
			"@types/sinon": "^21.0.0",
			"@types/tmp": "^0.2.6",
			"assert": "^2.0.0",
			"browserify": "^17.0.0",
			"c8": "^10.1.3",
			"cors": "^2.8.5",
			"express": "^5.0.0",
			"gts": "^6.0.2",
			"is-docker": "^3.0.0",
			"jsdoc": "^4.0.4",
			"jsdoc-fresh": "^5.0.0",
			"jsdoc-region-tag": "^4.0.0",
			"karma": "^6.0.0",
			"karma-chrome-launcher": "^3.0.0",
			"karma-coverage": "^2.0.0",
			"karma-firefox-launcher": "^2.0.0",
			"karma-mocha": "^2.0.0",
			"karma-remap-coverage": "^0.1.5",
			"karma-sourcemap-loader": "^0.4.0",
			"karma-webpack": "^5.0.0",
			"mocha": "^11.1.0",
			"multiparty": "^4.2.1",
			"mv": "^2.1.1",
			"ncp": "^2.0.0",
			"nock": "14.0.5",
			"null-loader": "^4.0.1",
			"pack-n-play": "^4.0.0",
			"puppeteer": "^24.0.0",
			"sinon": "21.0.3",
			"stream-browserify": "^3.0.0",
			"tmp": "0.2.7",
			"ts-loader": "^9.5.2",
			"typescript": "5.8.3",
			"undici-types": "^7.24.1",
			"webpack": "^5.97.1",
			"webpack-cli": "^6.0.1"
		},
		"dependencies": {
			"extend": "^3.0.2",
			"https-proxy-agent": "^7.0.1",
			"node-fetch": "^3.3.2"
		},
		"homepage": "https://github.com/googleapis/google-cloud-node/tree/main/core/packages/gaxios"
	};
}));
//#endregion
//#region ../../node_modules/.pnpm/gaxios@7.3.1/node_modules/gaxios/build/cjs/src/util.cjs
var require_util$2 = /* @__PURE__ */ __commonJSMin(((exports, module) => {
	module.exports = { pkg: require_package$2() };
}));
//#endregion
//#region ../../node_modules/.pnpm/gaxios@7.3.1/node_modules/gaxios/build/cjs/src/common.js
var require_common = /* @__PURE__ */ __commonJSMin(((exports) => {
	var __importDefault = exports && exports.__importDefault || function(mod) {
		return mod && mod.__esModule ? mod : { "default": mod };
	};
	Object.defineProperty(exports, "__esModule", { value: true });
	exports.GaxiosError = exports.GAXIOS_ERROR_SYMBOL = void 0;
	exports.defaultErrorRedactor = defaultErrorRedactor;
	const extend_1 = __importDefault(require_extend());
	const pkg = __importDefault(require_util$2()).default.pkg;
	/**
	* Support `instanceof` operator for `GaxiosError`s in different versions of this library.
	*
	* @see {@link GaxiosError[Symbol.hasInstance]}
	*/
	exports.GAXIOS_ERROR_SYMBOL = Symbol.for(`${pkg.name}-gaxios-error`);
	exports.GaxiosError = class GaxiosError extends Error {
		config;
		response;
		/**
		* An error code.
		* Can be a system error code, DOMException error name, or any error's 'code' property where it is a `string`.
		*
		* It is only a `number` when the cause is sourced from an API-level error (AIP-193).
		*
		* @see {@link https://nodejs.org/api/errors.html#errorcode error.code}
		* @see {@link https://developer.mozilla.org/en-US/docs/Web/API/DOMException#error_names DOMException#error_names}
		* @see {@link https://google.aip.dev/193#http11json-representation AIP-193}
		*
		* @example
		* 'ECONNRESET'
		*
		* @example
		* 'TimeoutError'
		*
		* @example
		* 500
		*/
		code;
		/**
		* An HTTP Status code.
		* @see {@link https://developer.mozilla.org/en-US/docs/Web/API/Response/status Response#status}
		*
		* @example
		* 500
		*/
		status;
		/**
		* @deprecated use {@link GaxiosError.cause} instead.
		*
		* @see {@link https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Error/cause Error#cause}
		*
		* @privateRemarks
		*
		* We will want to remove this property later as the modern `cause` property is better suited
		* for displaying and relaying nested errors. Keeping this here makes the resulting
		* error log larger than it needs to be.
		*
		*/
		error;
		/**
		* Support `instanceof` operator for `GaxiosError` across builds/duplicated files.
		*
		* @see {@link GAXIOS_ERROR_SYMBOL}
		* @see {@link GaxiosError[Symbol.hasInstance]}
		* @see {@link https://github.com/microsoft/TypeScript/issues/13965#issuecomment-278570200}
		* @see {@link https://stackoverflow.com/questions/46618852/require-and-instanceof}
		* @see {@link https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Function/@@hasInstance#reverting_to_default_instanceof_behavior}
		*/
		[exports.GAXIOS_ERROR_SYMBOL] = pkg.version;
		/**
		* Support `instanceof` operator for `GaxiosError` across builds/duplicated files.
		*
		* @see {@link GAXIOS_ERROR_SYMBOL}
		* @see {@link GaxiosError[GAXIOS_ERROR_SYMBOL]}
		*/
		static [Symbol.hasInstance](instance) {
			if (instance && typeof instance === "object" && exports.GAXIOS_ERROR_SYMBOL in instance && instance[exports.GAXIOS_ERROR_SYMBOL] === pkg.version) return true;
			return Function.prototype[Symbol.hasInstance].call(GaxiosError, instance);
		}
		constructor(message, config, response, cause) {
			super(message, { cause });
			this.config = config;
			this.response = response;
			this.error = cause instanceof Error ? cause : void 0;
			this.config = (0, extend_1.default)(true, {}, config);
			if (this.response) this.response.config = (0, extend_1.default)(true, {}, this.response.config);
			if (this.response) {
				try {
					this.response.data = translateData(this.config.responseType, this.response?.bodyUsed ? this.response?.data : void 0);
				} catch {}
				this.status = this.response.status;
			}
			if (cause instanceof DOMException) this.code = cause.name;
			else if (cause && typeof cause === "object" && "code" in cause && (typeof cause.code === "string" || typeof cause.code === "number")) this.code = cause.code;
		}
		/**
		* An AIP-193 conforming error extractor.
		*
		* @see {@link https://google.aip.dev/193#http11json-representation AIP-193}
		*
		* @internal
		* @expiremental
		*
		* @param res the response object
		* @returns the extracted error information
		*/
		static extractAPIErrorFromResponse(res, defaultErrorMessage = "The request failed") {
			let message = defaultErrorMessage;
			if (typeof res.data === "string") message = res.data;
			if (res.data && typeof res.data === "object" && "error" in res.data && res.data.error && !res.ok) {
				if (typeof res.data.error === "string") return {
					message: res.data.error,
					code: res.status,
					status: res.statusText
				};
				if (typeof res.data.error === "object") {
					message = "message" in res.data.error && typeof res.data.error.message === "string" ? res.data.error.message : message;
					const status = "status" in res.data.error && typeof res.data.error.status === "string" ? res.data.error.status : res.statusText;
					const code = "code" in res.data.error && typeof res.data.error.code === "number" ? res.data.error.code : res.status;
					if ("errors" in res.data.error && Array.isArray(res.data.error.errors)) {
						const errorMessages = [];
						for (const e of res.data.error.errors) if (typeof e === "object" && "message" in e && typeof e.message === "string") errorMessages.push(e.message);
						return Object.assign({
							message: errorMessages.join("\n") || message,
							code,
							status
						}, res.data.error);
					}
					return Object.assign({
						message,
						code,
						status
					}, res.data.error);
				}
			}
			return {
				message,
				code: res.status,
				status: res.statusText
			};
		}
	};
	function translateData(responseType, data) {
		switch (responseType) {
			case "stream": return data;
			case "json": return JSON.parse(JSON.stringify(data));
			case "arraybuffer": return JSON.parse(Buffer.from(data).toString("utf8"));
			case "blob": return JSON.parse(data.text());
			default: return data;
		}
	}
	/**
	* An experimental error redactor.
	*
	* @param config Config to potentially redact properties of
	* @param response Config to potentially redact properties of
	*
	* @experimental
	*/
	function defaultErrorRedactor(data) {
		const REDACT = "<<REDACTED> - See `errorRedactor` option in `gaxios` for configuration>.";
		function redactHeaders(headers) {
			if (!headers) return;
			headers.forEach((_, key) => {
				if (/^authentication$/i.test(key) || /^authorization$/i.test(key) || /secret/i.test(key)) headers.set(key, REDACT);
			});
		}
		function redactString(obj, key) {
			if (typeof obj === "object" && obj !== null && typeof obj[key] === "string") {
				const text = obj[key];
				if (/grant_type=/i.test(text) || /assertion=/i.test(text) || /secret/i.test(text)) obj[key] = REDACT;
			}
		}
		function redactObject(obj) {
			if (!obj || typeof obj !== "object") return;
			else if (obj instanceof FormData || obj instanceof URLSearchParams || "forEach" in obj && "set" in obj) obj.forEach((_, key) => {
				if (["grant_type", "assertion"].includes(key) || /secret/.test(key)) obj.set(key, REDACT);
			});
			else {
				if ("grant_type" in obj) obj["grant_type"] = REDACT;
				if ("assertion" in obj) obj["assertion"] = REDACT;
				if ("client_secret" in obj) obj["client_secret"] = REDACT;
			}
		}
		if (data.config) {
			redactHeaders(data.config.headers);
			redactString(data.config, "data");
			redactObject(data.config.data);
			redactString(data.config, "body");
			redactObject(data.config.body);
			if (data.config.url.searchParams.has("token")) data.config.url.searchParams.set("token", REDACT);
			if (data.config.url.searchParams.has("client_secret")) data.config.url.searchParams.set("client_secret", REDACT);
		}
		if (data.response) {
			defaultErrorRedactor({ config: data.response.config });
			redactHeaders(data.response.headers);
			if (data.response.bodyUsed) {
				redactString(data.response, "data");
				redactObject(data.response.data);
			}
		}
		return data;
	}
}));
//#endregion
//#region ../../node_modules/.pnpm/gaxios@7.3.1/node_modules/gaxios/build/cjs/src/retry.js
var require_retry = /* @__PURE__ */ __commonJSMin(((exports) => {
	Object.defineProperty(exports, "__esModule", { value: true });
	exports.getRetryConfig = getRetryConfig;
	async function getRetryConfig(err) {
		let config = getConfig(err);
		if (!err || !err.config || !config && !err.config.retry) return { shouldRetry: false };
		config = config || {};
		config.currentRetryAttempt = config.currentRetryAttempt || 0;
		config.retry = config.retry === void 0 || config.retry === null ? 3 : config.retry;
		config.httpMethodsToRetry = config.httpMethodsToRetry || [
			"GET",
			"HEAD",
			"PUT",
			"OPTIONS",
			"DELETE"
		];
		config.noResponseRetries = config.noResponseRetries === void 0 || config.noResponseRetries === null ? 2 : config.noResponseRetries;
		config.retryDelayMultiplier = config.retryDelayMultiplier ? config.retryDelayMultiplier : 2;
		config.timeOfFirstRequest = config.timeOfFirstRequest ? config.timeOfFirstRequest : Date.now();
		config.totalTimeout = config.totalTimeout ? config.totalTimeout : Number.MAX_SAFE_INTEGER;
		config.maxRetryDelay = config.maxRetryDelay ? config.maxRetryDelay : Number.MAX_SAFE_INTEGER;
		config.statusCodesToRetry = config.statusCodesToRetry || [
			[100, 199],
			[408, 408],
			[429, 429],
			[500, 599]
		];
		err.config.retryConfig = config;
		if (!await (config.shouldRetry || shouldRetryRequest)(err)) return {
			shouldRetry: false,
			config: err.config
		};
		const delay = getNextRetryDelay(config);
		err.config.retryConfig.currentRetryAttempt += 1;
		const backoff = config.retryBackoff ? config.retryBackoff(err, delay) : new Promise((resolve) => {
			setTimeout(resolve, delay);
		});
		if (config.onRetryAttempt) await config.onRetryAttempt(err);
		await backoff;
		return {
			shouldRetry: true,
			config: err.config
		};
	}
	/**
	* Determine based on config if we should retry the request.
	* @param err The GaxiosError passed to the interceptor.
	*/
	function shouldRetryRequest(err) {
		const config = getConfig(err);
		if (err.config.signal?.aborted && err.code !== "TimeoutError" || err.code === "AbortError") return false;
		if (!config || config.retry === 0) return false;
		if (!err.response && (config.currentRetryAttempt || 0) >= config.noResponseRetries) return false;
		if (!config.httpMethodsToRetry || !config.httpMethodsToRetry.includes(err.config.method?.toUpperCase() || "GET")) return false;
		if (err.response && err.response.status) {
			let isInRange = false;
			for (const [min, max] of config.statusCodesToRetry) {
				const status = err.response.status;
				if (status >= min && status <= max) {
					isInRange = true;
					break;
				}
			}
			if (!isInRange) return false;
		}
		config.currentRetryAttempt = config.currentRetryAttempt || 0;
		if (config.currentRetryAttempt >= config.retry) return false;
		return true;
	}
	/**
	* Acquire the raxConfig object from an GaxiosError if available.
	* @param err The Gaxios error with a config object.
	*/
	function getConfig(err) {
		if (err && err.config && err.config.retryConfig) return err.config.retryConfig;
	}
	/**
	* Gets the delay to wait before the next retry.
	*
	* @param {RetryConfig} config The current set of retry options
	* @returns {number} the amount of ms to wait before the next retry attempt.
	*/
	function getNextRetryDelay(config) {
		const calculatedDelay = (config.currentRetryAttempt ? 0 : config.retryDelay ?? 100) + (Math.pow(config.retryDelayMultiplier, config.currentRetryAttempt) - 1) / 2 * 1e3;
		const maxAllowableDelay = config.totalTimeout - (Date.now() - config.timeOfFirstRequest);
		return Math.min(calculatedDelay, maxAllowableDelay, config.maxRetryDelay);
	}
}));
//#endregion
//#region ../../node_modules/.pnpm/gaxios@7.3.1/node_modules/gaxios/build/cjs/src/interceptor.js
var require_interceptor = /* @__PURE__ */ __commonJSMin(((exports) => {
	Object.defineProperty(exports, "__esModule", { value: true });
	exports.GaxiosInterceptorManager = void 0;
	/**
	* Class to manage collections of GaxiosInterceptors for both requests and responses.
	*/
	var GaxiosInterceptorManager = class extends Set {};
	exports.GaxiosInterceptorManager = GaxiosInterceptorManager;
}));
//#endregion
//#region ../../node_modules/.pnpm/gaxios@7.3.1/node_modules/gaxios/build/cjs/src/gaxios.js
var require_gaxios = /* @__PURE__ */ __commonJSMin(((exports) => {
	var __importDefault = exports && exports.__importDefault || function(mod) {
		return mod && mod.__esModule ? mod : { "default": mod };
	};
	var _a;
	Object.defineProperty(exports, "__esModule", { value: true });
	exports.Gaxios = void 0;
	const extend_1 = __importDefault(require_extend());
	const https_1 = __require("https");
	const common_js_1 = require_common();
	const retry_js_1 = require_retry();
	const stream_1$1 = __require("stream");
	const interceptor_js_1 = require_interceptor();
	const randomUUID$1 = async () => globalThis.crypto?.randomUUID() || (await import("crypto")).randomUUID();
	const HTTP_STATUS_NO_CONTENT = 204;
	var Gaxios = class {
		agentCache = /* @__PURE__ */ new Map();
		/**
		* Default HTTP options that will be used for every HTTP request.
		*/
		defaults;
		/**
		* Interceptors
		*/
		interceptors;
		/**
		* The Gaxios class is responsible for making HTTP requests.
		* @param defaults The default set of options to be used for this instance.
		*/
		constructor(defaults) {
			this.defaults = defaults || {};
			this.interceptors = {
				request: new interceptor_js_1.GaxiosInterceptorManager(),
				response: new interceptor_js_1.GaxiosInterceptorManager()
			};
		}
		/**
		* A {@link fetch `fetch`} compliant API for {@link Gaxios}.
		*
		* @remarks
		*
		* This is useful as a drop-in replacement for `fetch` API usage.
		*
		* @example
		*
		* ```ts
		* const gaxios = new Gaxios();
		* const myFetch: typeof fetch = (...args) => gaxios.fetch(...args);
		* await myFetch('https://example.com');
		* ```
		*
		* @param args `fetch` API or `Gaxios#request` parameters
		* @returns the {@link Response} with Gaxios-added properties
		*/
		fetch(...args) {
			const input = args[0];
			const init = args[1];
			let url = void 0;
			const headers = new Headers();
			if (typeof input === "string") url = new URL(input);
			else if (input instanceof URL) url = input;
			else if (input && input.url) url = new URL(input.url);
			if (input && typeof input === "object" && "headers" in input) _a.mergeHeaders(headers, input.headers);
			if (init) _a.mergeHeaders(headers, new Headers(init.headers));
			if (typeof input === "object" && !(input instanceof URL)) return this.request({
				...init,
				...input,
				headers,
				url
			});
			else return this.request({
				...init,
				headers,
				url
			});
		}
		/**
		* Perform an HTTP request with the given options.
		* @param opts Set of HTTP options that will be used for this HTTP request.
		*/
		async request(opts = {}) {
			let prepared = await this.#prepareRequest(opts);
			prepared = await this.#applyRequestInterceptors(prepared);
			return this.#applyResponseInterceptors(this._request(prepared));
		}
		async _defaultAdapter(config) {
			const fetchImpl = config.fetchImplementation || this.defaults.fetchImplementation || await _a.#getFetch();
			const preparedOpts = { ...config };
			delete preparedOpts.data;
			const res = await fetchImpl(config.url, preparedOpts);
			const data = await this.getResponseData(config, res);
			if (!Object.getOwnPropertyDescriptor(res, "data")?.configurable) Object.defineProperties(res, { data: {
				configurable: true,
				writable: true,
				enumerable: true,
				value: data
			} });
			return Object.assign(res, {
				config,
				data
			});
		}
		/**
		* Internal, retryable version of the `request` method.
		* @param opts Set of HTTP options that will be used for this HTTP request.
		*/
		async _request(opts) {
			try {
				let translatedResponse;
				if (opts.adapter) translatedResponse = await opts.adapter(opts, this._defaultAdapter.bind(this));
				else translatedResponse = await this._defaultAdapter(opts);
				if (!opts.validateStatus(translatedResponse.status)) {
					if (opts.responseType === "stream") {
						const response = [];
						for await (const chunk of translatedResponse.data) response.push(chunk);
						translatedResponse.data = Buffer.concat(response.map((c) => typeof c === "string" ? Buffer.from(c) : c)).toString("utf8");
					}
					const errorInfo = common_js_1.GaxiosError.extractAPIErrorFromResponse(translatedResponse, `Request failed with status code ${translatedResponse.status}`);
					throw new common_js_1.GaxiosError(errorInfo?.message, opts, translatedResponse, errorInfo);
				}
				return translatedResponse;
			} catch (e) {
				let err;
				if (e instanceof common_js_1.GaxiosError) err = e;
				else if (e instanceof Error) err = new common_js_1.GaxiosError(e.message, opts, void 0, e);
				else err = new common_js_1.GaxiosError("Unexpected Gaxios Error", opts, void 0, e);
				const { shouldRetry, config } = await (0, retry_js_1.getRetryConfig)(err);
				if (shouldRetry && config) {
					err.config.retryConfig.currentRetryAttempt = config.retryConfig.currentRetryAttempt;
					opts.retryConfig = err.config?.retryConfig;
					this.#appendTimeoutToSignal(opts);
					return this._request(opts);
				}
				if (opts.errorRedactor) opts.errorRedactor(err);
				throw err;
			}
		}
		async getResponseData(opts, res) {
			if (res.status === HTTP_STATUS_NO_CONTENT) return "";
			if (opts.maxContentLength && res.headers.has("content-length") && opts.maxContentLength < Number.parseInt(res.headers?.get("content-length") || "")) throw new common_js_1.GaxiosError("Response's `Content-Length` is over the limit.", opts, Object.assign(res, { config: opts }));
			switch (opts.responseType) {
				case "stream": return res.body;
				case "json": {
					const data = await res.text();
					try {
						return JSON.parse(data);
					} catch {
						return data;
					}
				}
				case "arraybuffer": return res.arrayBuffer();
				case "blob": return res.blob();
				case "text": return res.text();
				default: return this.getResponseDataFromContentType(res);
			}
		}
		#urlMayUseProxy(url, noProxy = []) {
			const candidate = new URL(url);
			const noProxyList = [...noProxy];
			const noProxyEnvList = (process.env.NO_PROXY ?? process.env.no_proxy)?.split(",") || [];
			for (const rule of noProxyEnvList) noProxyList.push(rule.trim());
			for (const rule of noProxyList) if (rule instanceof RegExp) {
				if (rule.test(candidate.toString())) return false;
			} else if (rule instanceof URL) {
				if (rule.origin === candidate.origin) return false;
			} else if (rule.startsWith("*.") || rule.startsWith(".")) {
				const cleanedRule = rule.replace(/^\*\./, ".");
				if (candidate.hostname.endsWith(cleanedRule)) return false;
			} else if (rule === candidate.origin || rule === candidate.hostname || rule === candidate.href) return false;
			return true;
		}
		/**
		* Applies the request interceptors. The request interceptors are applied after the
		* call to prepareRequest is completed.
		*
		* @param {GaxiosOptionsPrepared} options The current set of options.
		*
		* @returns {Promise<GaxiosOptionsPrepared>} Promise that resolves to the set of options or response after interceptors are applied.
		*/
		async #applyRequestInterceptors(options) {
			let promiseChain = Promise.resolve(options);
			for (const interceptor of this.interceptors.request.values()) if (interceptor) promiseChain = promiseChain.then(interceptor.resolved, interceptor.rejected);
			return promiseChain;
		}
		/**
		* Applies the response interceptors. The response interceptors are applied after the
		* call to request is made.
		*
		* @param {GaxiosOptionsPrepared} options The current set of options.
		*
		* @returns {Promise<GaxiosOptionsPrepared>} Promise that resolves to the set of options or response after interceptors are applied.
		*/
		async #applyResponseInterceptors(response) {
			let promiseChain = Promise.resolve(response);
			for (const interceptor of this.interceptors.response.values()) if (interceptor) promiseChain = promiseChain.then(interceptor.resolved, interceptor.rejected);
			return promiseChain;
		}
		/**
		* Validates the options, merges them with defaults, and prepare request.
		*
		* @param options The original options passed from the client.
		* @returns Prepared options, ready to make a request
		*/
		async #prepareRequest(options) {
			const preparedHeaders = new Headers(this.defaults.headers);
			_a.mergeHeaders(preparedHeaders, options.headers);
			const opts = (0, extend_1.default)(true, {}, this.defaults, options);
			if (!opts.url) throw new Error("URL is required.");
			if (opts.baseURL) opts.url = new URL(opts.url, opts.baseURL);
			opts.url = new URL(opts.url);
			if (opts.params) {
				if (opts.paramsSerializer) {
					let additionalQueryParams = opts.paramsSerializer(opts.params);
					if (additionalQueryParams.startsWith("?")) additionalQueryParams = additionalQueryParams.slice(1);
					const prefix = opts.url.toString().includes("?") ? "&" : "?";
					opts.url = opts.url + prefix + additionalQueryParams;
				} else {
					const url = opts.url instanceof URL ? opts.url : new URL(opts.url);
					for (const [key, value] of new URLSearchParams(opts.params)) url.searchParams.append(key, value);
					opts.url = url;
				}
			}
			if (typeof options.maxContentLength === "number") opts.size = options.maxContentLength;
			if (typeof options.maxRedirects === "number") opts.follow = options.maxRedirects;
			const shouldDirectlyPassData = typeof opts.data === "string" || opts.data instanceof ArrayBuffer || opts.data instanceof Blob || globalThis.File && opts.data instanceof File || opts.data instanceof FormData || opts.data instanceof stream_1$1.Readable || opts.data instanceof ReadableStream || opts.data instanceof String || opts.data instanceof URLSearchParams || ArrayBuffer.isView(opts.data) || [
				"Blob",
				"File",
				"FormData"
			].includes(opts.data?.constructor?.name || "");
			if (opts.multipart?.length) {
				const boundary = await randomUUID$1();
				preparedHeaders.set("content-type", `multipart/related; boundary=${boundary}`);
				opts.body = stream_1$1.Readable.from(this.getMultipartRequest(opts.multipart, boundary));
			} else if (shouldDirectlyPassData) opts.body = opts.data;
			else if (typeof opts.data === "object") {
				if (preparedHeaders.get("Content-Type") === "application/x-www-form-urlencoded") opts.body = opts.paramsSerializer ? opts.paramsSerializer(opts.data) : new URLSearchParams(opts.data);
				else {
					if (!preparedHeaders.has("content-type")) preparedHeaders.set("content-type", "application/json");
					opts.body = JSON.stringify(opts.data);
				}
			} else if (opts.data) opts.body = opts.data;
			opts.validateStatus = opts.validateStatus || this.validateStatus;
			opts.responseType = opts.responseType || "unknown";
			if (!preparedHeaders.has("accept") && opts.responseType === "json") preparedHeaders.set("accept", "application/json");
			const proxy = opts.proxy || process?.env?.HTTPS_PROXY || process?.env?.https_proxy || process?.env?.HTTP_PROXY || process?.env?.http_proxy;
			if (opts.agent) {} else if (proxy && this.#urlMayUseProxy(opts.url, opts.noProxy)) {
				const HttpsProxyAgent = await _a.#getProxyAgent();
				if (this.agentCache.has(proxy)) opts.agent = this.agentCache.get(proxy);
				else {
					opts.agent = new HttpsProxyAgent(proxy, {
						cert: opts.cert,
						key: opts.key
					});
					this.agentCache.set(proxy, opts.agent);
				}
			} else if (opts.cert && opts.key) {
				if (this.agentCache.has(opts.key)) opts.agent = this.agentCache.get(opts.key);
				else {
					opts.agent = new https_1.Agent({
						cert: opts.cert,
						key: opts.key
					});
					this.agentCache.set(opts.key, opts.agent);
				}
			}
			if (typeof opts.errorRedactor !== "function" && opts.errorRedactor !== false) opts.errorRedactor = common_js_1.defaultErrorRedactor;
			if (opts.body && !("duplex" in opts))
 /**
			* required for Node.js and the type isn't available today
			* @link https://github.com/nodejs/node/issues/46221
			* @link https://github.com/microsoft/TypeScript-DOM-lib-generator/issues/1483
			*/
			opts.duplex = "half";
			this.#appendTimeoutToSignal(opts);
			return Object.assign(opts, {
				headers: preparedHeaders,
				url: opts.url instanceof URL ? opts.url : new URL(opts.url)
			});
		}
		#appendTimeoutToSignal(opts) {
			if (opts.timeout) {
				const timeoutSignal = AbortSignal.timeout(opts.timeout);
				if (opts.signal && !opts.signal.aborted) opts.signal = AbortSignal.any([opts.signal, timeoutSignal]);
				else opts.signal = timeoutSignal;
			}
		}
		/**
		* By default, throw for any non-2xx status code
		* @param status status code from the HTTP response
		*/
		validateStatus(status) {
			return status >= 200 && status < 300;
		}
		/**
		* Attempts to parse a response by looking at the Content-Type header.
		* @param {Response} response the HTTP response.
		* @returns a promise that resolves to the response data.
		*/
		async getResponseDataFromContentType(response) {
			let contentType = response.headers.get("Content-Type");
			if (contentType === null) return response.text();
			contentType = contentType.toLowerCase();
			if (contentType.includes("application/json")) {
				let data = await response.text();
				try {
					data = JSON.parse(data);
				} catch {}
				return data;
			} else if (contentType.match(/^text\//)) return response.text();
			else return response.blob();
		}
		/**
		* Creates an async generator that yields the pieces of a multipart/related request body.
		* This implementation follows the spec: https://www.ietf.org/rfc/rfc2387.txt. However, recursive
		* multipart/related requests are not currently supported.
		*
		* @param {GaxiosMultipartOptions[]} multipartOptions the pieces to turn into a multipart/related body.
		* @param {string} boundary the boundary string to be placed between each part.
		*/
		async *getMultipartRequest(multipartOptions, boundary) {
			const finale = `--${boundary}--`;
			for (const currentPart of multipartOptions) {
				yield `--${boundary}\r\nContent-Type: ${currentPart.headers.get("Content-Type") || "application/octet-stream"}\r\n\r\n`;
				if (typeof currentPart.content === "string") yield currentPart.content;
				else yield* currentPart.content;
				yield "\r\n";
			}
			yield finale;
		}
		/**
		* A cache for the lazily-loaded proxy agent.
		*
		* Should use {@link Gaxios[#getProxyAgent]} to retrieve.
		*/
		static #proxyAgent;
		/**
		* A cache for the lazily-loaded fetch library.
		*
		* Should use {@link Gaxios[#getFetch]} to retrieve.
		*/
		static #fetch;
		/**
		* Imports, caches, and returns a proxy agent - if not already imported
		*
		* @returns A proxy agent
		*/
		static async #getProxyAgent() {
			this.#proxyAgent ||= (await import("./dist-VlxryiH2.mjs").then((m) => /* @__PURE__ */ __toESM(m.default))).HttpsProxyAgent;
			return this.#proxyAgent;
		}
		static async #getFetch() {
			const hasWindow = typeof window !== "undefined" && !!window;
			this.#fetch ||= hasWindow ? window.fetch : (await import("./src-Df2sJ9iB.mjs")).default;
			return this.#fetch;
		}
		/**
		* Merges headers.
		* If the base headers do not exist a new `Headers` object will be returned.
		*
		* @remarks
		*
		* Using this utility can be helpful when the headers are not known to exist:
		* - if they exist as `Headers`, that instance will be used
		*   - it improves performance and allows users to use their existing references to their `Headers`
		* - if they exist in another form (`HeadersInit`), they will be used to create a new `Headers` object
		* - if the base headers do not exist a new `Headers` object will be created
		*
		* @param base headers to append/overwrite to
		* @param append headers to append/overwrite with
		* @returns the base headers instance with merged `Headers`
		*/
		static mergeHeaders(base, ...append) {
			base = base instanceof Headers ? base : new Headers(base);
			for (const headers of append) (headers instanceof Headers ? headers : new Headers(headers)).forEach((value, key) => {
				key === "set-cookie" ? base.append(key, value) : base.set(key, value);
			});
			return base;
		}
	};
	exports.Gaxios = Gaxios;
	_a = Gaxios;
}));
//#endregion
//#region ../../node_modules/.pnpm/gaxios@7.3.1/node_modules/gaxios/build/cjs/src/index.js
var require_src$4 = /* @__PURE__ */ __commonJSMin(((exports) => {
	var __createBinding = exports && exports.__createBinding || (Object.create ? (function(o, m, k, k2) {
		if (k2 === void 0) k2 = k;
		var desc = Object.getOwnPropertyDescriptor(m, k);
		if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) desc = {
			enumerable: true,
			get: function() {
				return m[k];
			}
		};
		Object.defineProperty(o, k2, desc);
	}) : (function(o, m, k, k2) {
		if (k2 === void 0) k2 = k;
		o[k2] = m[k];
	}));
	var __exportStar = exports && exports.__exportStar || function(m, exports$6) {
		for (var p in m) if (p !== "default" && !Object.prototype.hasOwnProperty.call(exports$6, p)) __createBinding(exports$6, m, p);
	};
	Object.defineProperty(exports, "__esModule", { value: true });
	exports.instance = exports.Gaxios = exports.GaxiosError = void 0;
	exports.request = request;
	const gaxios_js_1 = require_gaxios();
	Object.defineProperty(exports, "Gaxios", {
		enumerable: true,
		get: function() {
			return gaxios_js_1.Gaxios;
		}
	});
	var common_js_1 = require_common();
	Object.defineProperty(exports, "GaxiosError", {
		enumerable: true,
		get: function() {
			return common_js_1.GaxiosError;
		}
	});
	__exportStar(require_interceptor(), exports);
	/**
	* The default instance used when the `request` method is directly
	* invoked.
	*/
	exports.instance = new gaxios_js_1.Gaxios();
	/**
	* Make an HTTP request using the given options.
	* @param opts Options for the request
	*/
	async function request(opts) {
		return exports.instance.request(opts);
	}
}));
//#endregion
//#region ../../node_modules/.pnpm/bignumber.js@9.3.1/node_modules/bignumber.js/bignumber.js
var require_bignumber = /* @__PURE__ */ __commonJSMin(((exports, module) => {
	(function(globalObject) {
		"use strict";
		var BigNumber, isNumeric = /^-?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i, mathceil = Math.ceil, mathfloor = Math.floor, bignumberError = "[BigNumber Error] ", tooManyDigits = bignumberError + "Number primitive has more than 15 significant digits: ", BASE = 0x5af3107a4000, LOG_BASE = 14, MAX_SAFE_INTEGER = 9007199254740991, POWS_TEN = [
			1,
			10,
			100,
			1e3,
			1e4,
			1e5,
			1e6,
			1e7,
			1e8,
			1e9,
			1e10,
			1e11,
			0xe8d4a51000,
			0x9184e72a000
		], SQRT_BASE = 1e7, MAX = 1e9;
		function clone(configObject) {
			var div, convertBase, parseNumeric, P = BigNumber.prototype = {
				constructor: BigNumber,
				toString: null,
				valueOf: null
			}, ONE = new BigNumber(1), DECIMAL_PLACES = 20, ROUNDING_MODE = 4, TO_EXP_NEG = -7, TO_EXP_POS = 21, MIN_EXP = -1e7, MAX_EXP = 1e7, CRYPTO = false, MODULO_MODE = 1, POW_PRECISION = 0, FORMAT = {
				prefix: "",
				groupSize: 3,
				secondaryGroupSize: 0,
				groupSeparator: ",",
				decimalSeparator: ".",
				fractionGroupSize: 0,
				fractionGroupSeparator: "\xA0",
				suffix: ""
			}, ALPHABET = "0123456789abcdefghijklmnopqrstuvwxyz", alphabetHasNormalDecimalDigits = true;
			function BigNumber(v, b) {
				var alphabet, c, caseChanged, e, i, isNum, len, str, x = this;
				if (!(x instanceof BigNumber)) return new BigNumber(v, b);
				if (b == null) {
					if (v && v._isBigNumber === true) {
						x.s = v.s;
						if (!v.c || v.e > MAX_EXP) x.c = x.e = null;
						else if (v.e < MIN_EXP) x.c = [x.e = 0];
						else {
							x.e = v.e;
							x.c = v.c.slice();
						}
						return;
					}
					if ((isNum = typeof v == "number") && v * 0 == 0) {
						x.s = 1 / v < 0 ? (v = -v, -1) : 1;
						if (v === ~~v) {
							for (e = 0, i = v; i >= 10; i /= 10, e++);
							if (e > MAX_EXP) x.c = x.e = null;
							else {
								x.e = e;
								x.c = [v];
							}
							return;
						}
						str = String(v);
					} else {
						if (!isNumeric.test(str = String(v))) return parseNumeric(x, str, isNum);
						x.s = str.charCodeAt(0) == 45 ? (str = str.slice(1), -1) : 1;
					}
					if ((e = str.indexOf(".")) > -1) str = str.replace(".", "");
					if ((i = str.search(/e/i)) > 0) {
						if (e < 0) e = i;
						e += +str.slice(i + 1);
						str = str.substring(0, i);
					} else if (e < 0) e = str.length;
				} else {
					intCheck(b, 2, ALPHABET.length, "Base");
					if (b == 10 && alphabetHasNormalDecimalDigits) {
						x = new BigNumber(v);
						return round(x, DECIMAL_PLACES + x.e + 1, ROUNDING_MODE);
					}
					str = String(v);
					if (isNum = typeof v == "number") {
						if (v * 0 != 0) return parseNumeric(x, str, isNum, b);
						x.s = 1 / v < 0 ? (str = str.slice(1), -1) : 1;
						if (BigNumber.DEBUG && str.replace(/^0\.0*|\./, "").length > 15) throw Error(tooManyDigits + v);
					} else x.s = str.charCodeAt(0) === 45 ? (str = str.slice(1), -1) : 1;
					alphabet = ALPHABET.slice(0, b);
					e = i = 0;
					for (len = str.length; i < len; i++) if (alphabet.indexOf(c = str.charAt(i)) < 0) {
						if (c == ".") {
							if (i > e) {
								e = len;
								continue;
							}
						} else if (!caseChanged) {
							if (str == str.toUpperCase() && (str = str.toLowerCase()) || str == str.toLowerCase() && (str = str.toUpperCase())) {
								caseChanged = true;
								i = -1;
								e = 0;
								continue;
							}
						}
						return parseNumeric(x, String(v), isNum, b);
					}
					isNum = false;
					str = convertBase(str, b, 10, x.s);
					if ((e = str.indexOf(".")) > -1) str = str.replace(".", "");
					else e = str.length;
				}
				for (i = 0; str.charCodeAt(i) === 48; i++);
				for (len = str.length; str.charCodeAt(--len) === 48;);
				if (str = str.slice(i, ++len)) {
					len -= i;
					if (isNum && BigNumber.DEBUG && len > 15 && (v > MAX_SAFE_INTEGER || v !== mathfloor(v))) throw Error(tooManyDigits + x.s * v);
					if ((e = e - i - 1) > MAX_EXP) x.c = x.e = null;
					else if (e < MIN_EXP) x.c = [x.e = 0];
					else {
						x.e = e;
						x.c = [];
						i = (e + 1) % LOG_BASE;
						if (e < 0) i += LOG_BASE;
						if (i < len) {
							if (i) x.c.push(+str.slice(0, i));
							for (len -= LOG_BASE; i < len;) x.c.push(+str.slice(i, i += LOG_BASE));
							i = LOG_BASE - (str = str.slice(i)).length;
						} else i -= len;
						for (; i--; str += "0");
						x.c.push(+str);
					}
				} else x.c = [x.e = 0];
			}
			BigNumber.clone = clone;
			BigNumber.ROUND_UP = 0;
			BigNumber.ROUND_DOWN = 1;
			BigNumber.ROUND_CEIL = 2;
			BigNumber.ROUND_FLOOR = 3;
			BigNumber.ROUND_HALF_UP = 4;
			BigNumber.ROUND_HALF_DOWN = 5;
			BigNumber.ROUND_HALF_EVEN = 6;
			BigNumber.ROUND_HALF_CEIL = 7;
			BigNumber.ROUND_HALF_FLOOR = 8;
			BigNumber.EUCLID = 9;
			BigNumber.config = BigNumber.set = function(obj) {
				var p, v;
				if (obj != null) {
					if (typeof obj == "object") {
						if (obj.hasOwnProperty(p = "DECIMAL_PLACES")) {
							v = obj[p];
							intCheck(v, 0, MAX, p);
							DECIMAL_PLACES = v;
						}
						if (obj.hasOwnProperty(p = "ROUNDING_MODE")) {
							v = obj[p];
							intCheck(v, 0, 8, p);
							ROUNDING_MODE = v;
						}
						if (obj.hasOwnProperty(p = "EXPONENTIAL_AT")) {
							v = obj[p];
							if (v && v.pop) {
								intCheck(v[0], -MAX, 0, p);
								intCheck(v[1], 0, MAX, p);
								TO_EXP_NEG = v[0];
								TO_EXP_POS = v[1];
							} else {
								intCheck(v, -MAX, MAX, p);
								TO_EXP_NEG = -(TO_EXP_POS = v < 0 ? -v : v);
							}
						}
						if (obj.hasOwnProperty(p = "RANGE")) {
							v = obj[p];
							if (v && v.pop) {
								intCheck(v[0], -MAX, -1, p);
								intCheck(v[1], 1, MAX, p);
								MIN_EXP = v[0];
								MAX_EXP = v[1];
							} else {
								intCheck(v, -MAX, MAX, p);
								if (v) MIN_EXP = -(MAX_EXP = v < 0 ? -v : v);
								else throw Error(bignumberError + p + " cannot be zero: " + v);
							}
						}
						if (obj.hasOwnProperty(p = "CRYPTO")) {
							v = obj[p];
							if (v === !!v) {
								if (v) {
									if (typeof crypto != "undefined" && crypto && (crypto.getRandomValues || crypto.randomBytes)) CRYPTO = v;
									else {
										CRYPTO = !v;
										throw Error(bignumberError + "crypto unavailable");
									}
								} else CRYPTO = v;
							} else throw Error(bignumberError + p + " not true or false: " + v);
						}
						if (obj.hasOwnProperty(p = "MODULO_MODE")) {
							v = obj[p];
							intCheck(v, 0, 9, p);
							MODULO_MODE = v;
						}
						if (obj.hasOwnProperty(p = "POW_PRECISION")) {
							v = obj[p];
							intCheck(v, 0, MAX, p);
							POW_PRECISION = v;
						}
						if (obj.hasOwnProperty(p = "FORMAT")) {
							v = obj[p];
							if (typeof v == "object") FORMAT = v;
							else throw Error(bignumberError + p + " not an object: " + v);
						}
						if (obj.hasOwnProperty(p = "ALPHABET")) {
							v = obj[p];
							if (typeof v == "string" && !/^.?$|[+\-.\s]|(.).*\1/.test(v)) {
								alphabetHasNormalDecimalDigits = v.slice(0, 10) == "0123456789";
								ALPHABET = v;
							} else throw Error(bignumberError + p + " invalid: " + v);
						}
					} else throw Error(bignumberError + "Object expected: " + obj);
				}
				return {
					DECIMAL_PLACES,
					ROUNDING_MODE,
					EXPONENTIAL_AT: [TO_EXP_NEG, TO_EXP_POS],
					RANGE: [MIN_EXP, MAX_EXP],
					CRYPTO,
					MODULO_MODE,
					POW_PRECISION,
					FORMAT,
					ALPHABET
				};
			};
			BigNumber.isBigNumber = function(v) {
				if (!v || v._isBigNumber !== true) return false;
				if (!BigNumber.DEBUG) return true;
				var i, n, c = v.c, e = v.e, s = v.s;
				out: if ({}.toString.call(c) == "[object Array]") {
					if ((s === 1 || s === -1) && e >= -MAX && e <= MAX && e === mathfloor(e)) {
						if (c[0] === 0) {
							if (e === 0 && c.length === 1) return true;
							break out;
						}
						i = (e + 1) % LOG_BASE;
						if (i < 1) i += LOG_BASE;
						if (String(c[0]).length == i) {
							for (i = 0; i < c.length; i++) {
								n = c[i];
								if (n < 0 || n >= BASE || n !== mathfloor(n)) break out;
							}
							if (n !== 0) return true;
						}
					}
				} else if (c === null && e === null && (s === null || s === 1 || s === -1)) return true;
				throw Error(bignumberError + "Invalid BigNumber: " + v);
			};
			BigNumber.maximum = BigNumber.max = function() {
				return maxOrMin(arguments, -1);
			};
			BigNumber.minimum = BigNumber.min = function() {
				return maxOrMin(arguments, 1);
			};
			BigNumber.random = (function() {
				var pow2_53 = 9007199254740992;
				var random53bitInt = Math.random() * pow2_53 & 2097151 ? function() {
					return mathfloor(Math.random() * pow2_53);
				} : function() {
					return (Math.random() * 1073741824 | 0) * 8388608 + (Math.random() * 8388608 | 0);
				};
				return function(dp) {
					var a, b, e, k, v, i = 0, c = [], rand = new BigNumber(ONE);
					if (dp == null) dp = DECIMAL_PLACES;
					else intCheck(dp, 0, MAX);
					k = mathceil(dp / LOG_BASE);
					if (CRYPTO) {
						if (crypto.getRandomValues) {
							a = crypto.getRandomValues(new Uint32Array(k *= 2));
							for (; i < k;) {
								v = a[i] * 131072 + (a[i + 1] >>> 11);
								if (v >= 9e15) {
									b = crypto.getRandomValues(/* @__PURE__ */ new Uint32Array(2));
									a[i] = b[0];
									a[i + 1] = b[1];
								} else {
									c.push(v % 0x5af3107a4000);
									i += 2;
								}
							}
							i = k / 2;
						} else if (crypto.randomBytes) {
							a = crypto.randomBytes(k *= 7);
							for (; i < k;) {
								v = (a[i] & 31) * 281474976710656 + a[i + 1] * 1099511627776 + a[i + 2] * 4294967296 + a[i + 3] * 16777216 + (a[i + 4] << 16) + (a[i + 5] << 8) + a[i + 6];
								if (v >= 9e15) crypto.randomBytes(7).copy(a, i);
								else {
									c.push(v % 0x5af3107a4000);
									i += 7;
								}
							}
							i = k / 7;
						} else {
							CRYPTO = false;
							throw Error(bignumberError + "crypto unavailable");
						}
					}
					if (!CRYPTO) for (; i < k;) {
						v = random53bitInt();
						if (v < 9e15) c[i++] = v % 0x5af3107a4000;
					}
					k = c[--i];
					dp %= LOG_BASE;
					if (k && dp) {
						v = POWS_TEN[LOG_BASE - dp];
						c[i] = mathfloor(k / v) * v;
					}
					for (; c[i] === 0; c.pop(), i--);
					if (i < 0) c = [e = 0];
					else {
						for (e = -1; c[0] === 0; c.splice(0, 1), e -= LOG_BASE);
						for (i = 1, v = c[0]; v >= 10; v /= 10, i++);
						if (i < LOG_BASE) e -= LOG_BASE - i;
					}
					rand.e = e;
					rand.c = c;
					return rand;
				};
			})();
			BigNumber.sum = function() {
				var i = 1, args = arguments, sum = new BigNumber(args[0]);
				for (; i < args.length;) sum = sum.plus(args[i++]);
				return sum;
			};
			convertBase = (function() {
				var decimal = "0123456789";
				function toBaseOut(str, baseIn, baseOut, alphabet) {
					var j, arr = [0], arrL, i = 0, len = str.length;
					for (; i < len;) {
						for (arrL = arr.length; arrL--; arr[arrL] *= baseIn);
						arr[0] += alphabet.indexOf(str.charAt(i++));
						for (j = 0; j < arr.length; j++) if (arr[j] > baseOut - 1) {
							if (arr[j + 1] == null) arr[j + 1] = 0;
							arr[j + 1] += arr[j] / baseOut | 0;
							arr[j] %= baseOut;
						}
					}
					return arr.reverse();
				}
				return function(str, baseIn, baseOut, sign, callerIsToString) {
					var alphabet, d, e, k, r, x, xc, y, i = str.indexOf("."), dp = DECIMAL_PLACES, rm = ROUNDING_MODE;
					if (i >= 0) {
						k = POW_PRECISION;
						POW_PRECISION = 0;
						str = str.replace(".", "");
						y = new BigNumber(baseIn);
						x = y.pow(str.length - i);
						POW_PRECISION = k;
						y.c = toBaseOut(toFixedPoint(coeffToString(x.c), x.e, "0"), 10, baseOut, decimal);
						y.e = y.c.length;
					}
					xc = toBaseOut(str, baseIn, baseOut, callerIsToString ? (alphabet = ALPHABET, decimal) : (alphabet = decimal, ALPHABET));
					e = k = xc.length;
					for (; xc[--k] == 0; xc.pop());
					if (!xc[0]) return alphabet.charAt(0);
					if (i < 0) --e;
					else {
						x.c = xc;
						x.e = e;
						x.s = sign;
						x = div(x, y, dp, rm, baseOut);
						xc = x.c;
						r = x.r;
						e = x.e;
					}
					d = e + dp + 1;
					i = xc[d];
					k = baseOut / 2;
					r = r || d < 0 || xc[d + 1] != null;
					r = rm < 4 ? (i != null || r) && (rm == 0 || rm == (x.s < 0 ? 3 : 2)) : i > k || i == k && (rm == 4 || r || rm == 6 && xc[d - 1] & 1 || rm == (x.s < 0 ? 8 : 7));
					if (d < 1 || !xc[0]) str = r ? toFixedPoint(alphabet.charAt(1), -dp, alphabet.charAt(0)) : alphabet.charAt(0);
					else {
						xc.length = d;
						if (r) for (--baseOut; ++xc[--d] > baseOut;) {
							xc[d] = 0;
							if (!d) {
								++e;
								xc = [1].concat(xc);
							}
						}
						for (k = xc.length; !xc[--k];);
						for (i = 0, str = ""; i <= k; str += alphabet.charAt(xc[i++]));
						str = toFixedPoint(str, e, alphabet.charAt(0));
					}
					return str;
				};
			})();
			div = (function() {
				function multiply(x, k, base) {
					var m, temp, xlo, xhi, carry = 0, i = x.length, klo = k % SQRT_BASE, khi = k / SQRT_BASE | 0;
					for (x = x.slice(); i--;) {
						xlo = x[i] % SQRT_BASE;
						xhi = x[i] / SQRT_BASE | 0;
						m = khi * xlo + xhi * klo;
						temp = klo * xlo + m % SQRT_BASE * SQRT_BASE + carry;
						carry = (temp / base | 0) + (m / SQRT_BASE | 0) + khi * xhi;
						x[i] = temp % base;
					}
					if (carry) x = [carry].concat(x);
					return x;
				}
				function compare(a, b, aL, bL) {
					var i, cmp;
					if (aL != bL) cmp = aL > bL ? 1 : -1;
					else for (i = cmp = 0; i < aL; i++) if (a[i] != b[i]) {
						cmp = a[i] > b[i] ? 1 : -1;
						break;
					}
					return cmp;
				}
				function subtract(a, b, aL, base) {
					var i = 0;
					for (; aL--;) {
						a[aL] -= i;
						i = a[aL] < b[aL] ? 1 : 0;
						a[aL] = i * base + a[aL] - b[aL];
					}
					for (; !a[0] && a.length > 1; a.splice(0, 1));
				}
				return function(x, y, dp, rm, base) {
					var cmp, e, i, more, n, prod, prodL, q, qc, rem, remL, rem0, xi, xL, yc0, yL, yz, s = x.s == y.s ? 1 : -1, xc = x.c, yc = y.c;
					if (!xc || !xc[0] || !yc || !yc[0]) return new BigNumber(!x.s || !y.s || (xc ? yc && xc[0] == yc[0] : !yc) ? NaN : xc && xc[0] == 0 || !yc ? s * 0 : s / 0);
					q = new BigNumber(s);
					qc = q.c = [];
					e = x.e - y.e;
					s = dp + e + 1;
					if (!base) {
						base = BASE;
						e = bitFloor(x.e / LOG_BASE) - bitFloor(y.e / LOG_BASE);
						s = s / LOG_BASE | 0;
					}
					for (i = 0; yc[i] == (xc[i] || 0); i++);
					if (yc[i] > (xc[i] || 0)) e--;
					if (s < 0) {
						qc.push(1);
						more = true;
					} else {
						xL = xc.length;
						yL = yc.length;
						i = 0;
						s += 2;
						n = mathfloor(base / (yc[0] + 1));
						if (n > 1) {
							yc = multiply(yc, n, base);
							xc = multiply(xc, n, base);
							yL = yc.length;
							xL = xc.length;
						}
						xi = yL;
						rem = xc.slice(0, yL);
						remL = rem.length;
						for (; remL < yL; rem[remL++] = 0);
						yz = yc.slice();
						yz = [0].concat(yz);
						yc0 = yc[0];
						if (yc[1] >= base / 2) yc0++;
						do {
							n = 0;
							cmp = compare(yc, rem, yL, remL);
							if (cmp < 0) {
								rem0 = rem[0];
								if (yL != remL) rem0 = rem0 * base + (rem[1] || 0);
								n = mathfloor(rem0 / yc0);
								if (n > 1) {
									if (n >= base) n = base - 1;
									prod = multiply(yc, n, base);
									prodL = prod.length;
									remL = rem.length;
									while (compare(prod, rem, prodL, remL) == 1) {
										n--;
										subtract(prod, yL < prodL ? yz : yc, prodL, base);
										prodL = prod.length;
										cmp = 1;
									}
								} else {
									if (n == 0) cmp = n = 1;
									prod = yc.slice();
									prodL = prod.length;
								}
								if (prodL < remL) prod = [0].concat(prod);
								subtract(rem, prod, remL, base);
								remL = rem.length;
								if (cmp == -1) while (compare(yc, rem, yL, remL) < 1) {
									n++;
									subtract(rem, yL < remL ? yz : yc, remL, base);
									remL = rem.length;
								}
							} else if (cmp === 0) {
								n++;
								rem = [0];
							}
							qc[i++] = n;
							if (rem[0]) rem[remL++] = xc[xi] || 0;
							else {
								rem = [xc[xi]];
								remL = 1;
							}
						} while ((xi++ < xL || rem[0] != null) && s--);
						more = rem[0] != null;
						if (!qc[0]) qc.splice(0, 1);
					}
					if (base == BASE) {
						for (i = 1, s = qc[0]; s >= 10; s /= 10, i++);
						round(q, dp + (q.e = i + e * LOG_BASE - 1) + 1, rm, more);
					} else {
						q.e = e;
						q.r = +more;
					}
					return q;
				};
			})();
			function format(n, i, rm, id) {
				var c0, e, ne, len, str;
				if (rm == null) rm = ROUNDING_MODE;
				else intCheck(rm, 0, 8);
				if (!n.c) return n.toString();
				c0 = n.c[0];
				ne = n.e;
				if (i == null) {
					str = coeffToString(n.c);
					str = id == 1 || id == 2 && (ne <= TO_EXP_NEG || ne >= TO_EXP_POS) ? toExponential(str, ne) : toFixedPoint(str, ne, "0");
				} else {
					n = round(new BigNumber(n), i, rm);
					e = n.e;
					str = coeffToString(n.c);
					len = str.length;
					if (id == 1 || id == 2 && (i <= e || e <= TO_EXP_NEG)) {
						for (; len < i; str += "0", len++);
						str = toExponential(str, e);
					} else {
						i -= ne + (id === 2 && e > ne);
						str = toFixedPoint(str, e, "0");
						if (e + 1 > len) {
							if (--i > 0) for (str += "."; i--; str += "0");
						} else {
							i += e - len;
							if (i > 0) {
								if (e + 1 == len) str += ".";
								for (; i--; str += "0");
							}
						}
					}
				}
				return n.s < 0 && c0 ? "-" + str : str;
			}
			function maxOrMin(args, n) {
				var k, y, i = 1, x = new BigNumber(args[0]);
				for (; i < args.length; i++) {
					y = new BigNumber(args[i]);
					if (!y.s || (k = compare(x, y)) === n || k === 0 && x.s === n) x = y;
				}
				return x;
			}
			function normalise(n, c, e) {
				var i = 1, j = c.length;
				for (; !c[--j]; c.pop());
				for (j = c[0]; j >= 10; j /= 10, i++);
				if ((e = i + e * LOG_BASE - 1) > MAX_EXP) n.c = n.e = null;
				else if (e < MIN_EXP) n.c = [n.e = 0];
				else {
					n.e = e;
					n.c = c;
				}
				return n;
			}
			parseNumeric = (function() {
				var basePrefix = /^(-?)0([xbo])(?=\w[\w.]*$)/i, dotAfter = /^([^.]+)\.$/, dotBefore = /^\.([^.]+)$/, isInfinityOrNaN = /^-?(Infinity|NaN)$/, whitespaceOrPlus = /^\s*\+(?=[\w.])|^\s+|\s+$/g;
				return function(x, str, isNum, b) {
					var base, s = isNum ? str : str.replace(whitespaceOrPlus, "");
					if (isInfinityOrNaN.test(s)) x.s = isNaN(s) ? null : s < 0 ? -1 : 1;
					else {
						if (!isNum) {
							s = s.replace(basePrefix, function(m, p1, p2) {
								base = (p2 = p2.toLowerCase()) == "x" ? 16 : p2 == "b" ? 2 : 8;
								return !b || b == base ? p1 : m;
							});
							if (b) {
								base = b;
								s = s.replace(dotAfter, "$1").replace(dotBefore, "0.$1");
							}
							if (str != s) return new BigNumber(s, base);
						}
						if (BigNumber.DEBUG) throw Error(bignumberError + "Not a" + (b ? " base " + b : "") + " number: " + str);
						x.s = null;
					}
					x.c = x.e = null;
				};
			})();
			function round(x, sd, rm, r) {
				var d, i, j, k, n, ni, rd, xc = x.c, pows10 = POWS_TEN;
				if (xc) {
					out: {
						for (d = 1, k = xc[0]; k >= 10; k /= 10, d++);
						i = sd - d;
						if (i < 0) {
							i += LOG_BASE;
							j = sd;
							n = xc[ni = 0];
							rd = mathfloor(n / pows10[d - j - 1] % 10);
						} else {
							ni = mathceil((i + 1) / LOG_BASE);
							if (ni >= xc.length) {
								if (r) {
									for (; xc.length <= ni; xc.push(0));
									n = rd = 0;
									d = 1;
									i %= LOG_BASE;
									j = i - LOG_BASE + 1;
								} else break out;
							} else {
								n = k = xc[ni];
								for (d = 1; k >= 10; k /= 10, d++);
								i %= LOG_BASE;
								j = i - LOG_BASE + d;
								rd = j < 0 ? 0 : mathfloor(n / pows10[d - j - 1] % 10);
							}
						}
						r = r || sd < 0 || xc[ni + 1] != null || (j < 0 ? n : n % pows10[d - j - 1]);
						r = rm < 4 ? (rd || r) && (rm == 0 || rm == (x.s < 0 ? 3 : 2)) : rd > 5 || rd == 5 && (rm == 4 || r || rm == 6 && (i > 0 ? j > 0 ? n / pows10[d - j] : 0 : xc[ni - 1]) % 10 & 1 || rm == (x.s < 0 ? 8 : 7));
						if (sd < 1 || !xc[0]) {
							xc.length = 0;
							if (r) {
								sd -= x.e + 1;
								xc[0] = pows10[(LOG_BASE - sd % LOG_BASE) % LOG_BASE];
								x.e = -sd || 0;
							} else xc[0] = x.e = 0;
							return x;
						}
						if (i == 0) {
							xc.length = ni;
							k = 1;
							ni--;
						} else {
							xc.length = ni + 1;
							k = pows10[LOG_BASE - i];
							xc[ni] = j > 0 ? mathfloor(n / pows10[d - j] % pows10[j]) * k : 0;
						}
						if (r) for (;;) if (ni == 0) {
							for (i = 1, j = xc[0]; j >= 10; j /= 10, i++);
							j = xc[0] += k;
							for (k = 1; j >= 10; j /= 10, k++);
							if (i != k) {
								x.e++;
								if (xc[0] == BASE) xc[0] = 1;
							}
							break;
						} else {
							xc[ni] += k;
							if (xc[ni] != BASE) break;
							xc[ni--] = 0;
							k = 1;
						}
						for (i = xc.length; xc[--i] === 0; xc.pop());
					}
					if (x.e > MAX_EXP) x.c = x.e = null;
					else if (x.e < MIN_EXP) x.c = [x.e = 0];
				}
				return x;
			}
			function valueOf(n) {
				var str, e = n.e;
				if (e === null) return n.toString();
				str = coeffToString(n.c);
				str = e <= TO_EXP_NEG || e >= TO_EXP_POS ? toExponential(str, e) : toFixedPoint(str, e, "0");
				return n.s < 0 ? "-" + str : str;
			}
			P.absoluteValue = P.abs = function() {
				var x = new BigNumber(this);
				if (x.s < 0) x.s = 1;
				return x;
			};
			P.comparedTo = function(y, b) {
				return compare(this, new BigNumber(y, b));
			};
			P.decimalPlaces = P.dp = function(dp, rm) {
				var c, n, v, x = this;
				if (dp != null) {
					intCheck(dp, 0, MAX);
					if (rm == null) rm = ROUNDING_MODE;
					else intCheck(rm, 0, 8);
					return round(new BigNumber(x), dp + x.e + 1, rm);
				}
				if (!(c = x.c)) return null;
				n = ((v = c.length - 1) - bitFloor(this.e / LOG_BASE)) * LOG_BASE;
				if (v = c[v]) for (; v % 10 == 0; v /= 10, n--);
				if (n < 0) n = 0;
				return n;
			};
			P.dividedBy = P.div = function(y, b) {
				return div(this, new BigNumber(y, b), DECIMAL_PLACES, ROUNDING_MODE);
			};
			P.dividedToIntegerBy = P.idiv = function(y, b) {
				return div(this, new BigNumber(y, b), 0, 1);
			};
			P.exponentiatedBy = P.pow = function(n, m) {
				var half, isModExp, i, k, more, nIsBig, nIsNeg, nIsOdd, y, x = this;
				n = new BigNumber(n);
				if (n.c && !n.isInteger()) throw Error(bignumberError + "Exponent not an integer: " + valueOf(n));
				if (m != null) m = new BigNumber(m);
				nIsBig = n.e > 14;
				if (!x.c || !x.c[0] || x.c[0] == 1 && !x.e && x.c.length == 1 || !n.c || !n.c[0]) {
					y = new BigNumber(Math.pow(+valueOf(x), nIsBig ? n.s * (2 - isOdd(n)) : +valueOf(n)));
					return m ? y.mod(m) : y;
				}
				nIsNeg = n.s < 0;
				if (m) {
					if (m.c ? !m.c[0] : !m.s) return new BigNumber(NaN);
					isModExp = !nIsNeg && x.isInteger() && m.isInteger();
					if (isModExp) x = x.mod(m);
				} else if (n.e > 9 && (x.e > 0 || x.e < -1 || (x.e == 0 ? x.c[0] > 1 || nIsBig && x.c[1] >= 24e7 : x.c[0] < 8e13 || nIsBig && x.c[0] <= 9999975e7))) {
					k = x.s < 0 && isOdd(n) ? -0 : 0;
					if (x.e > -1) k = 1 / k;
					return new BigNumber(nIsNeg ? 1 / k : k);
				} else if (POW_PRECISION) k = mathceil(POW_PRECISION / LOG_BASE + 2);
				if (nIsBig) {
					half = new BigNumber(.5);
					if (nIsNeg) n.s = 1;
					nIsOdd = isOdd(n);
				} else {
					i = Math.abs(+valueOf(n));
					nIsOdd = i % 2;
				}
				y = new BigNumber(ONE);
				for (;;) {
					if (nIsOdd) {
						y = y.times(x);
						if (!y.c) break;
						if (k) {
							if (y.c.length > k) y.c.length = k;
						} else if (isModExp) y = y.mod(m);
					}
					if (i) {
						i = mathfloor(i / 2);
						if (i === 0) break;
						nIsOdd = i % 2;
					} else {
						n = n.times(half);
						round(n, n.e + 1, 1);
						if (n.e > 14) nIsOdd = isOdd(n);
						else {
							i = +valueOf(n);
							if (i === 0) break;
							nIsOdd = i % 2;
						}
					}
					x = x.times(x);
					if (k) {
						if (x.c && x.c.length > k) x.c.length = k;
					} else if (isModExp) x = x.mod(m);
				}
				if (isModExp) return y;
				if (nIsNeg) y = ONE.div(y);
				return m ? y.mod(m) : k ? round(y, POW_PRECISION, ROUNDING_MODE, more) : y;
			};
			P.integerValue = function(rm) {
				var n = new BigNumber(this);
				if (rm == null) rm = ROUNDING_MODE;
				else intCheck(rm, 0, 8);
				return round(n, n.e + 1, rm);
			};
			P.isEqualTo = P.eq = function(y, b) {
				return compare(this, new BigNumber(y, b)) === 0;
			};
			P.isFinite = function() {
				return !!this.c;
			};
			P.isGreaterThan = P.gt = function(y, b) {
				return compare(this, new BigNumber(y, b)) > 0;
			};
			P.isGreaterThanOrEqualTo = P.gte = function(y, b) {
				return (b = compare(this, new BigNumber(y, b))) === 1 || b === 0;
			};
			P.isInteger = function() {
				return !!this.c && bitFloor(this.e / LOG_BASE) > this.c.length - 2;
			};
			P.isLessThan = P.lt = function(y, b) {
				return compare(this, new BigNumber(y, b)) < 0;
			};
			P.isLessThanOrEqualTo = P.lte = function(y, b) {
				return (b = compare(this, new BigNumber(y, b))) === -1 || b === 0;
			};
			P.isNaN = function() {
				return !this.s;
			};
			P.isNegative = function() {
				return this.s < 0;
			};
			P.isPositive = function() {
				return this.s > 0;
			};
			P.isZero = function() {
				return !!this.c && this.c[0] == 0;
			};
			P.minus = function(y, b) {
				var i, j, t, xLTy, x = this, a = x.s;
				y = new BigNumber(y, b);
				b = y.s;
				if (!a || !b) return new BigNumber(NaN);
				if (a != b) {
					y.s = -b;
					return x.plus(y);
				}
				var xe = x.e / LOG_BASE, ye = y.e / LOG_BASE, xc = x.c, yc = y.c;
				if (!xe || !ye) {
					if (!xc || !yc) return xc ? (y.s = -b, y) : new BigNumber(yc ? x : NaN);
					if (!xc[0] || !yc[0]) return yc[0] ? (y.s = -b, y) : new BigNumber(xc[0] ? x : ROUNDING_MODE == 3 ? -0 : 0);
				}
				xe = bitFloor(xe);
				ye = bitFloor(ye);
				xc = xc.slice();
				if (a = xe - ye) {
					if (xLTy = a < 0) {
						a = -a;
						t = xc;
					} else {
						ye = xe;
						t = yc;
					}
					t.reverse();
					for (b = a; b--; t.push(0));
					t.reverse();
				} else {
					j = (xLTy = (a = xc.length) < (b = yc.length)) ? a : b;
					for (a = b = 0; b < j; b++) if (xc[b] != yc[b]) {
						xLTy = xc[b] < yc[b];
						break;
					}
				}
				if (xLTy) {
					t = xc;
					xc = yc;
					yc = t;
					y.s = -y.s;
				}
				b = (j = yc.length) - (i = xc.length);
				if (b > 0) for (; b--; xc[i++] = 0);
				b = BASE - 1;
				for (; j > a;) {
					if (xc[--j] < yc[j]) {
						for (i = j; i && !xc[--i]; xc[i] = b);
						--xc[i];
						xc[j] += BASE;
					}
					xc[j] -= yc[j];
				}
				for (; xc[0] == 0; xc.splice(0, 1), --ye);
				if (!xc[0]) {
					y.s = ROUNDING_MODE == 3 ? -1 : 1;
					y.c = [y.e = 0];
					return y;
				}
				return normalise(y, xc, ye);
			};
			P.modulo = P.mod = function(y, b) {
				var q, s, x = this;
				y = new BigNumber(y, b);
				if (!x.c || !y.s || y.c && !y.c[0]) return new BigNumber(NaN);
				else if (!y.c || x.c && !x.c[0]) return new BigNumber(x);
				if (MODULO_MODE == 9) {
					s = y.s;
					y.s = 1;
					q = div(x, y, 0, 3);
					y.s = s;
					q.s *= s;
				} else q = div(x, y, 0, MODULO_MODE);
				y = x.minus(q.times(y));
				if (!y.c[0] && MODULO_MODE == 1) y.s = x.s;
				return y;
			};
			P.multipliedBy = P.times = function(y, b) {
				var c, e, i, j, k, m, xcL, xlo, xhi, ycL, ylo, yhi, zc, base, sqrtBase, x = this, xc = x.c, yc = (y = new BigNumber(y, b)).c;
				if (!xc || !yc || !xc[0] || !yc[0]) {
					if (!x.s || !y.s || xc && !xc[0] && !yc || yc && !yc[0] && !xc) y.c = y.e = y.s = null;
					else {
						y.s *= x.s;
						if (!xc || !yc) y.c = y.e = null;
						else {
							y.c = [0];
							y.e = 0;
						}
					}
					return y;
				}
				e = bitFloor(x.e / LOG_BASE) + bitFloor(y.e / LOG_BASE);
				y.s *= x.s;
				xcL = xc.length;
				ycL = yc.length;
				if (xcL < ycL) {
					zc = xc;
					xc = yc;
					yc = zc;
					i = xcL;
					xcL = ycL;
					ycL = i;
				}
				for (i = xcL + ycL, zc = []; i--; zc.push(0));
				base = BASE;
				sqrtBase = SQRT_BASE;
				for (i = ycL; --i >= 0;) {
					c = 0;
					ylo = yc[i] % sqrtBase;
					yhi = yc[i] / sqrtBase | 0;
					for (k = xcL, j = i + k; j > i;) {
						xlo = xc[--k] % sqrtBase;
						xhi = xc[k] / sqrtBase | 0;
						m = yhi * xlo + xhi * ylo;
						xlo = ylo * xlo + m % sqrtBase * sqrtBase + zc[j] + c;
						c = (xlo / base | 0) + (m / sqrtBase | 0) + yhi * xhi;
						zc[j--] = xlo % base;
					}
					zc[j] = c;
				}
				if (c) ++e;
				else zc.splice(0, 1);
				return normalise(y, zc, e);
			};
			P.negated = function() {
				var x = new BigNumber(this);
				x.s = -x.s || null;
				return x;
			};
			P.plus = function(y, b) {
				var t, x = this, a = x.s;
				y = new BigNumber(y, b);
				b = y.s;
				if (!a || !b) return new BigNumber(NaN);
				if (a != b) {
					y.s = -b;
					return x.minus(y);
				}
				var xe = x.e / LOG_BASE, ye = y.e / LOG_BASE, xc = x.c, yc = y.c;
				if (!xe || !ye) {
					if (!xc || !yc) return new BigNumber(a / 0);
					if (!xc[0] || !yc[0]) return yc[0] ? y : new BigNumber(xc[0] ? x : a * 0);
				}
				xe = bitFloor(xe);
				ye = bitFloor(ye);
				xc = xc.slice();
				if (a = xe - ye) {
					if (a > 0) {
						ye = xe;
						t = yc;
					} else {
						a = -a;
						t = xc;
					}
					t.reverse();
					for (; a--; t.push(0));
					t.reverse();
				}
				a = xc.length;
				b = yc.length;
				if (a - b < 0) {
					t = yc;
					yc = xc;
					xc = t;
					b = a;
				}
				for (a = 0; b;) {
					a = (xc[--b] = xc[b] + yc[b] + a) / BASE | 0;
					xc[b] = BASE === xc[b] ? 0 : xc[b] % BASE;
				}
				if (a) {
					xc = [a].concat(xc);
					++ye;
				}
				return normalise(y, xc, ye);
			};
			P.precision = P.sd = function(sd, rm) {
				var c, n, v, x = this;
				if (sd != null && sd !== !!sd) {
					intCheck(sd, 1, MAX);
					if (rm == null) rm = ROUNDING_MODE;
					else intCheck(rm, 0, 8);
					return round(new BigNumber(x), sd, rm);
				}
				if (!(c = x.c)) return null;
				v = c.length - 1;
				n = v * LOG_BASE + 1;
				if (v = c[v]) {
					for (; v % 10 == 0; v /= 10, n--);
					for (v = c[0]; v >= 10; v /= 10, n++);
				}
				if (sd && x.e + 1 > n) n = x.e + 1;
				return n;
			};
			P.shiftedBy = function(k) {
				intCheck(k, -MAX_SAFE_INTEGER, MAX_SAFE_INTEGER);
				return this.times("1e" + k);
			};
			P.squareRoot = P.sqrt = function() {
				var m, n, r, rep, t, x = this, c = x.c, s = x.s, e = x.e, dp = DECIMAL_PLACES + 4, half = new BigNumber("0.5");
				if (s !== 1 || !c || !c[0]) return new BigNumber(!s || s < 0 && (!c || c[0]) ? NaN : c ? x : 1 / 0);
				s = Math.sqrt(+valueOf(x));
				if (s == 0 || s == 1 / 0) {
					n = coeffToString(c);
					if ((n.length + e) % 2 == 0) n += "0";
					s = Math.sqrt(+n);
					e = bitFloor((e + 1) / 2) - (e < 0 || e % 2);
					if (s == 1 / 0) n = "5e" + e;
					else {
						n = s.toExponential();
						n = n.slice(0, n.indexOf("e") + 1) + e;
					}
					r = new BigNumber(n);
				} else r = new BigNumber(s + "");
				if (r.c[0]) {
					e = r.e;
					s = e + dp;
					if (s < 3) s = 0;
					for (;;) {
						t = r;
						r = half.times(t.plus(div(x, t, dp, 1)));
						if (coeffToString(t.c).slice(0, s) === (n = coeffToString(r.c)).slice(0, s)) {
							if (r.e < e) --s;
							n = n.slice(s - 3, s + 1);
							if (n == "9999" || !rep && n == "4999") {
								if (!rep) {
									round(t, t.e + DECIMAL_PLACES + 2, 0);
									if (t.times(t).eq(x)) {
										r = t;
										break;
									}
								}
								dp += 4;
								s += 4;
								rep = 1;
							} else {
								if (!+n || !+n.slice(1) && n.charAt(0) == "5") {
									round(r, r.e + DECIMAL_PLACES + 2, 1);
									m = !r.times(r).eq(x);
								}
								break;
							}
						}
					}
				}
				return round(r, r.e + DECIMAL_PLACES + 1, ROUNDING_MODE, m);
			};
			P.toExponential = function(dp, rm) {
				if (dp != null) {
					intCheck(dp, 0, MAX);
					dp++;
				}
				return format(this, dp, rm, 1);
			};
			P.toFixed = function(dp, rm) {
				if (dp != null) {
					intCheck(dp, 0, MAX);
					dp = dp + this.e + 1;
				}
				return format(this, dp, rm);
			};
			P.toFormat = function(dp, rm, format) {
				var str, x = this;
				if (format == null) {
					if (dp != null && rm && typeof rm == "object") {
						format = rm;
						rm = null;
					} else if (dp && typeof dp == "object") {
						format = dp;
						dp = rm = null;
					} else format = FORMAT;
				} else if (typeof format != "object") throw Error(bignumberError + "Argument not an object: " + format);
				str = x.toFixed(dp, rm);
				if (x.c) {
					var i, arr = str.split("."), g1 = +format.groupSize, g2 = +format.secondaryGroupSize, groupSeparator = format.groupSeparator || "", intPart = arr[0], fractionPart = arr[1], isNeg = x.s < 0, intDigits = isNeg ? intPart.slice(1) : intPart, len = intDigits.length;
					if (g2) {
						i = g1;
						g1 = g2;
						g2 = i;
						len -= i;
					}
					if (g1 > 0 && len > 0) {
						i = len % g1 || g1;
						intPart = intDigits.substr(0, i);
						for (; i < len; i += g1) intPart += groupSeparator + intDigits.substr(i, g1);
						if (g2 > 0) intPart += groupSeparator + intDigits.slice(i);
						if (isNeg) intPart = "-" + intPart;
					}
					str = fractionPart ? intPart + (format.decimalSeparator || "") + ((g2 = +format.fractionGroupSize) ? fractionPart.replace(new RegExp("\\d{" + g2 + "}\\B", "g"), "$&" + (format.fractionGroupSeparator || "")) : fractionPart) : intPart;
				}
				return (format.prefix || "") + str + (format.suffix || "");
			};
			P.toFraction = function(md) {
				var d, d0, d1, d2, e, exp, n, n0, n1, q, r, s, x = this, xc = x.c;
				if (md != null) {
					n = new BigNumber(md);
					if (!n.isInteger() && (n.c || n.s !== 1) || n.lt(ONE)) throw Error(bignumberError + "Argument " + (n.isInteger() ? "out of range: " : "not an integer: ") + valueOf(n));
				}
				if (!xc) return new BigNumber(x);
				d = new BigNumber(ONE);
				n1 = d0 = new BigNumber(ONE);
				d1 = n0 = new BigNumber(ONE);
				s = coeffToString(xc);
				e = d.e = s.length - x.e - 1;
				d.c[0] = POWS_TEN[(exp = e % LOG_BASE) < 0 ? LOG_BASE + exp : exp];
				md = !md || n.comparedTo(d) > 0 ? e > 0 ? d : n1 : n;
				exp = MAX_EXP;
				MAX_EXP = 1 / 0;
				n = new BigNumber(s);
				n0.c[0] = 0;
				for (;;) {
					q = div(n, d, 0, 1);
					d2 = d0.plus(q.times(d1));
					if (d2.comparedTo(md) == 1) break;
					d0 = d1;
					d1 = d2;
					n1 = n0.plus(q.times(d2 = n1));
					n0 = d2;
					d = n.minus(q.times(d2 = d));
					n = d2;
				}
				d2 = div(md.minus(d0), d1, 0, 1);
				n0 = n0.plus(d2.times(n1));
				d0 = d0.plus(d2.times(d1));
				n0.s = n1.s = x.s;
				e = e * 2;
				r = div(n1, d1, e, ROUNDING_MODE).minus(x).abs().comparedTo(div(n0, d0, e, ROUNDING_MODE).minus(x).abs()) < 1 ? [n1, d1] : [n0, d0];
				MAX_EXP = exp;
				return r;
			};
			P.toNumber = function() {
				return +valueOf(this);
			};
			P.toPrecision = function(sd, rm) {
				if (sd != null) intCheck(sd, 1, MAX);
				return format(this, sd, rm, 2);
			};
			P.toString = function(b) {
				var str, n = this, s = n.s, e = n.e;
				if (e === null) {
					if (s) {
						str = "Infinity";
						if (s < 0) str = "-" + str;
					} else str = "NaN";
				} else {
					if (b == null) str = e <= TO_EXP_NEG || e >= TO_EXP_POS ? toExponential(coeffToString(n.c), e) : toFixedPoint(coeffToString(n.c), e, "0");
					else if (b === 10 && alphabetHasNormalDecimalDigits) {
						n = round(new BigNumber(n), DECIMAL_PLACES + e + 1, ROUNDING_MODE);
						str = toFixedPoint(coeffToString(n.c), n.e, "0");
					} else {
						intCheck(b, 2, ALPHABET.length, "Base");
						str = convertBase(toFixedPoint(coeffToString(n.c), e, "0"), 10, b, s, true);
					}
					if (s < 0 && n.c[0]) str = "-" + str;
				}
				return str;
			};
			P.valueOf = P.toJSON = function() {
				return valueOf(this);
			};
			P._isBigNumber = true;
			if (configObject != null) BigNumber.set(configObject);
			return BigNumber;
		}
		function bitFloor(n) {
			var i = n | 0;
			return n > 0 || n === i ? i : i - 1;
		}
		function coeffToString(a) {
			var s, z, i = 1, j = a.length, r = a[0] + "";
			for (; i < j;) {
				s = a[i++] + "";
				z = LOG_BASE - s.length;
				for (; z--; s = "0" + s);
				r += s;
			}
			for (j = r.length; r.charCodeAt(--j) === 48;);
			return r.slice(0, j + 1 || 1);
		}
		function compare(x, y) {
			var a, b, xc = x.c, yc = y.c, i = x.s, j = y.s, k = x.e, l = y.e;
			if (!i || !j) return null;
			a = xc && !xc[0];
			b = yc && !yc[0];
			if (a || b) return a ? b ? 0 : -j : i;
			if (i != j) return i;
			a = i < 0;
			b = k == l;
			if (!xc || !yc) return b ? 0 : !xc ^ a ? 1 : -1;
			if (!b) return k > l ^ a ? 1 : -1;
			j = (k = xc.length) < (l = yc.length) ? k : l;
			for (i = 0; i < j; i++) if (xc[i] != yc[i]) return xc[i] > yc[i] ^ a ? 1 : -1;
			return k == l ? 0 : k > l ^ a ? 1 : -1;
		}
		function intCheck(n, min, max, name) {
			if (n < min || n > max || n !== mathfloor(n)) throw Error(bignumberError + (name || "Argument") + (typeof n == "number" ? n < min || n > max ? " out of range: " : " not an integer: " : " not a primitive number: ") + String(n));
		}
		function isOdd(n) {
			var k = n.c.length - 1;
			return bitFloor(n.e / LOG_BASE) == k && n.c[k] % 2 != 0;
		}
		function toExponential(str, e) {
			return (str.length > 1 ? str.charAt(0) + "." + str.slice(1) : str) + (e < 0 ? "e" : "e+") + e;
		}
		function toFixedPoint(str, e, z) {
			var len, zs;
			if (e < 0) {
				for (zs = z + "."; ++e; zs += z);
				str = zs + str;
			} else {
				len = str.length;
				if (++e > len) {
					for (zs = z, e -= len; --e; zs += z);
					str += zs;
				} else if (e < len) str = str.slice(0, e) + "." + str.slice(e);
			}
			return str;
		}
		BigNumber = clone();
		BigNumber["default"] = BigNumber.BigNumber = BigNumber;
		if (typeof define == "function" && define.amd) define(function() {
			return BigNumber;
		});
		else if (typeof module != "undefined" && module.exports) module.exports = BigNumber;
		else {
			if (!globalObject) globalObject = typeof self != "undefined" && self ? self : window;
			globalObject.BigNumber = BigNumber;
		}
	})(exports);
}));
//#endregion
//#region ../../node_modules/.pnpm/json-bigint@1.0.0/node_modules/json-bigint/lib/stringify.js
var require_stringify$1 = /* @__PURE__ */ __commonJSMin(((exports, module) => {
	var BigNumber = require_bignumber();
	var JSON = module.exports;
	(function() {
		"use strict";
		var escapable = /[\\\"\x00-\x1f\x7f-\x9f\u00ad\u0600-\u0604\u070f\u17b4\u17b5\u200c-\u200f\u2028-\u202f\u2060-\u206f\ufeff\ufff0-\uffff]/g, gap, indent, meta = {
			"\b": "\\b",
			"	": "\\t",
			"\n": "\\n",
			"\f": "\\f",
			"\r": "\\r",
			"\"": "\\\"",
			"\\": "\\\\"
		}, rep;
		function quote(string) {
			escapable.lastIndex = 0;
			return escapable.test(string) ? "\"" + string.replace(escapable, function(a) {
				var c = meta[a];
				return typeof c === "string" ? c : "\\u" + ("0000" + a.charCodeAt(0).toString(16)).slice(-4);
			}) + "\"" : "\"" + string + "\"";
		}
		function str(key, holder) {
			var i, k, v, length, mind = gap, partial, value = holder[key], isBigNumber = value != null && (value instanceof BigNumber || BigNumber.isBigNumber(value));
			if (value && typeof value === "object" && typeof value.toJSON === "function") value = value.toJSON(key);
			if (typeof rep === "function") value = rep.call(holder, key, value);
			switch (typeof value) {
				case "string": if (isBigNumber) return value;
				else return quote(value);
				case "number": return isFinite(value) ? String(value) : "null";
				case "boolean":
				case "null":
				case "bigint": return String(value);
				case "object":
					if (!value) return "null";
					gap += indent;
					partial = [];
					if (Object.prototype.toString.apply(value) === "[object Array]") {
						length = value.length;
						for (i = 0; i < length; i += 1) partial[i] = str(i, value) || "null";
						v = partial.length === 0 ? "[]" : gap ? "[\n" + gap + partial.join(",\n" + gap) + "\n" + mind + "]" : "[" + partial.join(",") + "]";
						gap = mind;
						return v;
					}
					if (rep && typeof rep === "object") {
						length = rep.length;
						for (i = 0; i < length; i += 1) if (typeof rep[i] === "string") {
							k = rep[i];
							v = str(k, value);
							if (v) partial.push(quote(k) + (gap ? ": " : ":") + v);
						}
					} else Object.keys(value).forEach(function(k) {
						var v = str(k, value);
						if (v) partial.push(quote(k) + (gap ? ": " : ":") + v);
					});
					v = partial.length === 0 ? "{}" : gap ? "{\n" + gap + partial.join(",\n" + gap) + "\n" + mind + "}" : "{" + partial.join(",") + "}";
					gap = mind;
					return v;
			}
		}
		if (typeof JSON.stringify !== "function") JSON.stringify = function(value, replacer, space) {
			var i;
			gap = "";
			indent = "";
			if (typeof space === "number") for (i = 0; i < space; i += 1) indent += " ";
			else if (typeof space === "string") indent = space;
			rep = replacer;
			if (replacer && typeof replacer !== "function" && (typeof replacer !== "object" || typeof replacer.length !== "number")) throw new Error("JSON.stringify");
			return str("", { "": value });
		};
	})();
}));
//#endregion
//#region ../../node_modules/.pnpm/json-bigint@1.0.0/node_modules/json-bigint/lib/parse.js
var require_parse$1 = /* @__PURE__ */ __commonJSMin(((exports, module) => {
	var BigNumber = null;
	const suspectProtoRx = /(?:_|\\u005[Ff])(?:_|\\u005[Ff])(?:p|\\u0070)(?:r|\\u0072)(?:o|\\u006[Ff])(?:t|\\u0074)(?:o|\\u006[Ff])(?:_|\\u005[Ff])(?:_|\\u005[Ff])/;
	const suspectConstructorRx = /(?:c|\\u0063)(?:o|\\u006[Ff])(?:n|\\u006[Ee])(?:s|\\u0073)(?:t|\\u0074)(?:r|\\u0072)(?:u|\\u0075)(?:c|\\u0063)(?:t|\\u0074)(?:o|\\u006[Ff])(?:r|\\u0072)/;
	var json_parse = function(options) {
		"use strict";
		var _options = {
			strict: false,
			storeAsString: false,
			alwaysParseAsBig: false,
			useNativeBigInt: false,
			protoAction: "error",
			constructorAction: "error"
		};
		if (options !== void 0 && options !== null) {
			if (options.strict === true) _options.strict = true;
			if (options.storeAsString === true) _options.storeAsString = true;
			_options.alwaysParseAsBig = options.alwaysParseAsBig === true ? options.alwaysParseAsBig : false;
			_options.useNativeBigInt = options.useNativeBigInt === true ? options.useNativeBigInt : false;
			if (typeof options.constructorAction !== "undefined") {
				if (options.constructorAction === "error" || options.constructorAction === "ignore" || options.constructorAction === "preserve") _options.constructorAction = options.constructorAction;
				else throw new Error(`Incorrect value for constructorAction option, must be "error", "ignore" or undefined but passed ${options.constructorAction}`);
			}
			if (typeof options.protoAction !== "undefined") {
				if (options.protoAction === "error" || options.protoAction === "ignore" || options.protoAction === "preserve") _options.protoAction = options.protoAction;
				else throw new Error(`Incorrect value for protoAction option, must be "error", "ignore" or undefined but passed ${options.protoAction}`);
			}
		}
		var at, ch, escapee = {
			"\"": "\"",
			"\\": "\\",
			"/": "/",
			b: "\b",
			f: "\f",
			n: "\n",
			r: "\r",
			t: "	"
		}, text, error = function(m) {
			throw {
				name: "SyntaxError",
				message: m,
				at,
				text
			};
		}, next = function(c) {
			if (c && c !== ch) error("Expected '" + c + "' instead of '" + ch + "'");
			ch = text.charAt(at);
			at += 1;
			return ch;
		}, number = function() {
			var number, string = "";
			if (ch === "-") {
				string = "-";
				next("-");
			}
			while (ch >= "0" && ch <= "9") {
				string += ch;
				next();
			}
			if (ch === ".") {
				string += ".";
				while (next() && ch >= "0" && ch <= "9") string += ch;
			}
			if (ch === "e" || ch === "E") {
				string += ch;
				next();
				if (ch === "-" || ch === "+") {
					string += ch;
					next();
				}
				while (ch >= "0" && ch <= "9") {
					string += ch;
					next();
				}
			}
			number = +string;
			if (!isFinite(number)) error("Bad number");
			else {
				if (BigNumber == null) BigNumber = require_bignumber();
				if (string.length > 15) return _options.storeAsString ? string : _options.useNativeBigInt ? BigInt(string) : new BigNumber(string);
				else return !_options.alwaysParseAsBig ? number : _options.useNativeBigInt ? BigInt(number) : new BigNumber(number);
			}
		}, string = function() {
			var hex, i, string = "", uffff;
			if (ch === "\"") {
				var startAt = at;
				while (next()) {
					if (ch === "\"") {
						if (at - 1 > startAt) string += text.substring(startAt, at - 1);
						next();
						return string;
					}
					if (ch === "\\") {
						if (at - 1 > startAt) string += text.substring(startAt, at - 1);
						next();
						if (ch === "u") {
							uffff = 0;
							for (i = 0; i < 4; i += 1) {
								hex = parseInt(next(), 16);
								if (!isFinite(hex)) break;
								uffff = uffff * 16 + hex;
							}
							string += String.fromCharCode(uffff);
						} else if (typeof escapee[ch] === "string") string += escapee[ch];
						else break;
						startAt = at;
					}
				}
			}
			error("Bad string");
		}, white = function() {
			while (ch && ch <= " ") next();
		}, word = function() {
			switch (ch) {
				case "t":
					next("t");
					next("r");
					next("u");
					next("e");
					return true;
				case "f":
					next("f");
					next("a");
					next("l");
					next("s");
					next("e");
					return false;
				case "n":
					next("n");
					next("u");
					next("l");
					next("l");
					return null;
			}
			error("Unexpected '" + ch + "'");
		}, value, array = function() {
			var array = [];
			if (ch === "[") {
				next("[");
				white();
				if (ch === "]") {
					next("]");
					return array;
				}
				while (ch) {
					array.push(value());
					white();
					if (ch === "]") {
						next("]");
						return array;
					}
					next(",");
					white();
				}
			}
			error("Bad array");
		}, object = function() {
			var key, object = Object.create(null);
			if (ch === "{") {
				next("{");
				white();
				if (ch === "}") {
					next("}");
					return object;
				}
				while (ch) {
					key = string();
					white();
					next(":");
					if (_options.strict === true && Object.hasOwnProperty.call(object, key)) error("Duplicate key \"" + key + "\"");
					if (suspectProtoRx.test(key) === true) {
						if (_options.protoAction === "error") error("Object contains forbidden prototype property");
						else if (_options.protoAction === "ignore") value();
						else object[key] = value();
					} else if (suspectConstructorRx.test(key) === true) {
						if (_options.constructorAction === "error") error("Object contains forbidden constructor property");
						else if (_options.constructorAction === "ignore") value();
						else object[key] = value();
					} else object[key] = value();
					white();
					if (ch === "}") {
						next("}");
						return object;
					}
					next(",");
					white();
				}
			}
			error("Bad object");
		};
		value = function() {
			white();
			switch (ch) {
				case "{": return object();
				case "[": return array();
				case "\"": return string();
				case "-": return number();
				default: return ch >= "0" && ch <= "9" ? number() : word();
			}
		};
		return function(source, reviver) {
			var result;
			text = source + "";
			at = 0;
			ch = " ";
			result = value();
			white();
			if (ch) error("Syntax error");
			return typeof reviver === "function" ? (function walk(holder, key) {
				var v, value = holder[key];
				if (value && typeof value === "object") Object.keys(value).forEach(function(k) {
					v = walk(value, k);
					if (v !== void 0) value[k] = v;
					else delete value[k];
				});
				return reviver.call(holder, key, value);
			})({ "": result }, "") : result;
		};
	};
	module.exports = json_parse;
}));
//#endregion
//#region ../../node_modules/.pnpm/json-bigint@1.0.0/node_modules/json-bigint/index.js
var require_json_bigint = /* @__PURE__ */ __commonJSMin(((exports, module) => {
	var json_stringify = require_stringify$1().stringify;
	var json_parse = require_parse$1();
	module.exports = function(options) {
		return {
			parse: json_parse(options),
			stringify: json_stringify
		};
	};
	module.exports.parse = json_parse();
	module.exports.stringify = json_stringify;
}));
//#endregion
//#region ../../node_modules/.pnpm/gcp-metadata@9.0.4/node_modules/gcp-metadata/build/src/gcp-residency.js
var require_gcp_residency = /* @__PURE__ */ __commonJSMin(((exports) => {
	/**
	* Copyright 2022 Google LLC
	*
	* Licensed under the Apache License, Version 2.0 (the "License");
	* you may not use this file except in compliance with the License.
	* You may obtain a copy of the License at
	*
	*      http://www.apache.org/licenses/LICENSE-2.0
	*
	* Unless required by applicable law or agreed to in writing, software
	* distributed under the License is distributed on an "AS IS" BASIS,
	* WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
	* See the License for the specific language governing permissions and
	* limitations under the License.
	*/
	Object.defineProperty(exports, "__esModule", { value: true });
	exports.GCE_LINUX_BIOS_PATHS = void 0;
	exports.isGoogleCloudServerless = isGoogleCloudServerless;
	exports.isGoogleComputeEngineLinux = isGoogleComputeEngineLinux;
	exports.isGoogleComputeEngineMACAddress = isGoogleComputeEngineMACAddress;
	exports.isGoogleComputeEngine = isGoogleComputeEngine;
	exports.detectGCPResidency = detectGCPResidency;
	const fs_1 = __require("fs");
	const os_1 = __require("os");
	/**
	* Known paths unique to Google Compute Engine Linux instances
	*/
	exports.GCE_LINUX_BIOS_PATHS = {
		BIOS_DATE: "/sys/class/dmi/id/bios_date",
		BIOS_VENDOR: "/sys/class/dmi/id/bios_vendor"
	};
	const GCE_MAC_ADDRESS_REGEX = /^42:01/;
	/**
	* Environment variables used to detect Google Cloud Serverless environments
	* (Cloud Run Services, Cloud Run Jobs, Cloud Run Worker Pools, and Cloud Functions).
	*/
	const SERVERLESS_ENV_VARS = [
		"CLOUD_RUN_JOB",
		"FUNCTION_NAME",
		"K_SERVICE",
		"CLOUD_RUN_WORKER_POOL"
	];
	/**
	* Determines if the process is running on a Google Cloud Serverless environment
	* (Cloud Run Services/Jobs/Worker Pools or Cloud Functions).
	*
	* Environment variables checked:
	* - `CLOUD_RUN_JOB` is used for Cloud Run Jobs:
	*   {@link https://cloud.google.com/run/docs/container-contract#env-vars Cloud Run environment variables}.
	* - `FUNCTION_NAME` is used in older Cloud Functions environments:
	*   {@link https://cloud.google.com/functions/docs/env-var Python 3.7 and Go 1.11}.
	* - `K_SERVICE` is used in Cloud Run and newer Cloud Functions environments:
	*   {@link https://cloud.google.com/run/docs/container-contract#env-vars Cloud Run environment variables},
	*   {@link https://cloud.google.com/functions/docs/env-var Cloud Functions newer runtimes}.
	* - `CLOUD_RUN_WORKER_POOL` is used in Cloud Run Worker Pools:
	*   {@link https://cloud.google.com/run/docs/container-contract#env-vars Cloud Run environment variables},
	*   {@link https://cloud.google.com/run/docs/deploy-worker-pools Deploy Worker Pools to Cloud Run}.
	*
	* @returns {boolean} `true` if the process is running on GCP serverless, `false` otherwise.
	*/
	function isGoogleCloudServerless() {
		return SERVERLESS_ENV_VARS.some((key) => Boolean(process.env[key]));
	}
	/**
	* Determines if the process is running on a Linux Google Compute Engine instance.
	*
	* @returns {boolean} `true` if the process is running on Linux GCE, `false` otherwise.
	*/
	function isGoogleComputeEngineLinux() {
		if ((0, os_1.platform)() !== "linux") return false;
		try {
			(0, fs_1.statSync)(exports.GCE_LINUX_BIOS_PATHS.BIOS_DATE);
			const biosVendor = (0, fs_1.readFileSync)(exports.GCE_LINUX_BIOS_PATHS.BIOS_VENDOR, "utf8");
			return /Google/.test(biosVendor);
		} catch {
			return false;
		}
	}
	/**
	* Determines if the process is running on a Google Compute Engine instance with a known
	* MAC address.
	*
	* @returns {boolean} `true` if the process is running on GCE (as determined by MAC address), `false` otherwise.
	*/
	function isGoogleComputeEngineMACAddress() {
		const interfaces = (0, os_1.networkInterfaces)();
		for (const item of Object.values(interfaces)) {
			if (!item) continue;
			for (const { mac } of item) if (GCE_MAC_ADDRESS_REGEX.test(mac)) return true;
		}
		return false;
	}
	/**
	* Determines if the process is running on a Google Compute Engine instance.
	*
	* @returns {boolean} `true` if the process is running on GCE, `false` otherwise.
	*/
	function isGoogleComputeEngine() {
		return isGoogleComputeEngineLinux() || isGoogleComputeEngineMACAddress();
	}
	/**
	* Determines if the process is running on Google Cloud Platform.
	*
	* @returns {boolean} `true` if the process is running on GCP, `false` otherwise.
	*/
	function detectGCPResidency() {
		return isGoogleCloudServerless() || isGoogleComputeEngine();
	}
}));
//#endregion
//#region ../../node_modules/.pnpm/google-logging-utils@2.0.1/node_modules/google-logging-utils/build/src/colours.js
var require_colours = /* @__PURE__ */ __commonJSMin(((exports) => {
	Object.defineProperty(exports, "__esModule", { value: true });
	exports.Colours = void 0;
	/**
	* Handles figuring out if we can use ANSI colours and handing out the escape codes.
	*
	* This is for package-internal use only, and may change at any time.
	*
	* @private
	* @internal
	*/
	var Colours = class Colours {
		static enabled = false;
		static reset = "";
		static bright = "";
		static dim = "";
		static red = "";
		static green = "";
		static yellow = "";
		static blue = "";
		static magenta = "";
		static cyan = "";
		static white = "";
		static grey = "";
		/**
		* @param stream The stream (e.g. process.stderr)
		* @returns true if the stream should have colourization enabled
		*/
		static isEnabled(stream) {
			return stream && stream.isTTY && (typeof stream.getColorDepth === "function" ? stream.getColorDepth() > 2 : true);
		}
		static refresh() {
			Colours.enabled = Colours.isEnabled(process?.stderr);
			if (!this.enabled) {
				Colours.reset = "";
				Colours.bright = "";
				Colours.dim = "";
				Colours.red = "";
				Colours.green = "";
				Colours.yellow = "";
				Colours.blue = "";
				Colours.magenta = "";
				Colours.cyan = "";
				Colours.white = "";
				Colours.grey = "";
			} else {
				Colours.reset = "\x1B[0m";
				Colours.bright = "\x1B[1m";
				Colours.dim = "\x1B[2m";
				Colours.red = "\x1B[31m";
				Colours.green = "\x1B[32m";
				Colours.yellow = "\x1B[33m";
				Colours.blue = "\x1B[34m";
				Colours.magenta = "\x1B[35m";
				Colours.cyan = "\x1B[36m";
				Colours.white = "\x1B[37m";
				Colours.grey = "\x1B[90m";
			}
		}
	};
	exports.Colours = Colours;
	Colours.refresh();
}));
//#endregion
//#region ../../node_modules/.pnpm/google-logging-utils@2.0.1/node_modules/google-logging-utils/build/src/types.js
var require_types = /* @__PURE__ */ __commonJSMin(((exports) => {
	Object.defineProperty(exports, "__esModule", { value: true });
	exports.LogSeverity = void 0;
	/**
	* Possible log levels. These are a subset of Cloud Observability levels.
	* https://cloud.google.com/logging/docs/reference/v2/rest/v2/LogEntry#LogSeverity
	*/
	var LogSeverity;
	(function(LogSeverity) {
		LogSeverity["DEFAULT"] = "DEFAULT";
		LogSeverity["DEBUG"] = "DEBUG";
		LogSeverity["INFO"] = "INFO";
		LogSeverity["WARNING"] = "WARNING";
		LogSeverity["ERROR"] = "ERROR";
	})(LogSeverity || (exports.LogSeverity = LogSeverity = {}));
}));
//#endregion
//#region ../../node_modules/.pnpm/google-logging-utils@2.0.1/node_modules/google-logging-utils/build/src/logging-utils.js
var require_logging_utils = /* @__PURE__ */ __commonJSMin(((exports) => {
	var __createBinding = exports && exports.__createBinding || (Object.create ? (function(o, m, k, k2) {
		if (k2 === void 0) k2 = k;
		var desc = Object.getOwnPropertyDescriptor(m, k);
		if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) desc = {
			enumerable: true,
			get: function() {
				return m[k];
			}
		};
		Object.defineProperty(o, k2, desc);
	}) : (function(o, m, k, k2) {
		if (k2 === void 0) k2 = k;
		o[k2] = m[k];
	}));
	var __setModuleDefault = exports && exports.__setModuleDefault || (Object.create ? (function(o, v) {
		Object.defineProperty(o, "default", {
			enumerable: true,
			value: v
		});
	}) : function(o, v) {
		o["default"] = v;
	});
	var __importStar = exports && exports.__importStar || (function() {
		var ownKeys = function(o) {
			ownKeys = Object.getOwnPropertyNames || function(o) {
				var ar = [];
				for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
				return ar;
			};
			return ownKeys(o);
		};
		return function(mod) {
			if (mod && mod.__esModule) return mod;
			var result = {};
			if (mod != null) {
				for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
			}
			__setModuleDefault(result, mod);
			return result;
		};
	})();
	Object.defineProperty(exports, "__esModule", { value: true });
	exports.env = exports.DebugLogBackendBase = exports.placeholder = exports.AdhocDebugLogger = void 0;
	exports.getNodeBackend = getNodeBackend;
	exports.getDebugBackend = getDebugBackend;
	exports.getStructuredBackend = getStructuredBackend;
	exports.setBackend = setBackend;
	exports.log = log;
	const events_1$1 = __require("events");
	const process$2 = __importStar(__require("process"));
	const util$6 = __importStar(__require("util"));
	const colours_1 = require_colours();
	const types_1 = require_types();
	/**
	* Our logger instance. This actually contains the meat of dealing
	* with log lines, including EventEmitter. This contains the function
	* that will be passed back to users of the package.
	*/
	var AdhocDebugLogger = class extends events_1$1.EventEmitter {
		namespace;
		upstream;
		func;
		/**
		* @param upstream The backend will pass a function that will be
		* called whenever our logger function is invoked.
		*/
		constructor(namespace, upstream) {
			super();
			this.namespace = namespace;
			this.upstream = upstream;
			this.func = Object.assign(this.invoke.bind(this), {
				instance: this,
				on: (event, listener) => this.on(event, listener)
			});
			this.func.debug = (...args) => this.invokeSeverity(types_1.LogSeverity.DEBUG, ...args);
			this.func.info = (...args) => this.invokeSeverity(types_1.LogSeverity.INFO, ...args);
			this.func.warn = (...args) => this.invokeSeverity(types_1.LogSeverity.WARNING, ...args);
			this.func.error = (...args) => this.invokeSeverity(types_1.LogSeverity.ERROR, ...args);
			this.func.sublog = (namespace) => log(namespace, this.func);
		}
		invoke(fields, ...args) {
			if (this.upstream) try {
				this.upstream(fields, ...args);
			} catch (e) {}
			try {
				this.emit("log", fields, args);
			} catch (e) {}
		}
		invokeSeverity(severity, ...args) {
			this.invoke({ severity }, ...args);
		}
	};
	exports.AdhocDebugLogger = AdhocDebugLogger;
	/**
	* This can be used in place of a real logger while waiting for Promises or disabling logging.
	*/
	exports.placeholder = new AdhocDebugLogger("", () => {}).func;
	/**
	* The base class for debug logging backends. It's possible to use this, but the
	* same non-guarantees above still apply (unstable interface, etc).
	*
	* @private
	* @internal
	*/
	var DebugLogBackendBase = class {
		cached = /* @__PURE__ */ new Map();
		filters = [];
		filtersSet = false;
		constructor() {
			let nodeFlag = process$2.env[exports.env.nodeEnables] ?? "*";
			if (nodeFlag === "all") nodeFlag = "*";
			this.filters = nodeFlag.split(",");
		}
		log(namespace, fields, ...args) {
			try {
				if (!this.filtersSet) {
					this.setFilters();
					this.filtersSet = true;
				}
				let logger = this.cached.get(namespace);
				if (!logger) {
					logger = this.makeLogger(namespace);
					this.cached.set(namespace, logger);
				}
				logger(fields, ...args);
			} catch (e) {
				console.error(e);
			}
		}
	};
	exports.DebugLogBackendBase = DebugLogBackendBase;
	var NodeBackend = class extends DebugLogBackendBase {
		enabledRegexp = /.*/g;
		isEnabled(namespace) {
			return this.enabledRegexp.test(namespace);
		}
		makeLogger(namespace) {
			if (!this.enabledRegexp.test(namespace)) return () => {};
			return (fields, ...args) => {
				const nscolour = `${colours_1.Colours.green}${namespace}${colours_1.Colours.reset}`;
				const pid = `${colours_1.Colours.yellow}${process$2.pid}${colours_1.Colours.reset}`;
				let level;
				switch (fields.severity) {
					case types_1.LogSeverity.ERROR:
						level = `${colours_1.Colours.red}${fields.severity}${colours_1.Colours.reset}`;
						break;
					case types_1.LogSeverity.INFO:
						level = `${colours_1.Colours.magenta}${fields.severity}${colours_1.Colours.reset}`;
						break;
					case types_1.LogSeverity.WARNING:
						level = `${colours_1.Colours.yellow}${fields.severity}${colours_1.Colours.reset}`;
						break;
					default: level = fields.severity ?? types_1.LogSeverity.DEFAULT;
				}
				const msg = util$6.formatWithOptions({ colors: colours_1.Colours.enabled }, ...args);
				const filteredFields = Object.assign({}, fields);
				delete filteredFields.severity;
				const fieldsJson = Object.getOwnPropertyNames(filteredFields).length ? JSON.stringify(filteredFields) : "";
				const fieldsColour = fieldsJson ? `${colours_1.Colours.grey}${fieldsJson}${colours_1.Colours.reset}` : "";
				console.error("%s [%s|%s] %s%s", pid, nscolour, level, msg, fieldsJson ? ` ${fieldsColour}` : "");
			};
		}
		setFilters() {
			const regexp = this.filters.join(",").replace(/[|\\{}()[\]^$+?.]/g, "\\$&").replace(/\*/g, ".*").replace(/,/g, "$|^");
			this.enabledRegexp = new RegExp(`^${regexp}$`, "i");
		}
	};
	/**
	* @returns A backend based on Node util.debuglog; this is the default.
	*/
	function getNodeBackend() {
		return new NodeBackend();
	}
	var DebugBackend = class extends DebugLogBackendBase {
		debugPkg;
		constructor(pkg) {
			super();
			this.debugPkg = pkg;
		}
		makeLogger(namespace) {
			const debugLogger = this.debugPkg(namespace);
			return (fields, ...args) => {
				debugLogger(args[0], ...args.slice(1));
			};
		}
		setFilters() {
			const existingFilters = process$2.env["NODE_DEBUG"] ?? "";
			process$2.env["NODE_DEBUG"] = `${existingFilters}${existingFilters ? "," : ""}${this.filters.join(",")}`;
		}
	};
	/**
	* Creates a "debug" package backend. The user must call require('debug') and pass
	* the resulting object to this function.
	*
	* ```
	*  setBackend(getDebugBackend(require('debug')))
	* ```
	*
	* https://www.npmjs.com/package/debug
	*
	* Note: Google does not explicitly endorse or recommend this package; it's just
	* being provided as an option.
	*
	* @returns A backend based on the npm "debug" package.
	*/
	function getDebugBackend(debugPkg) {
		return new DebugBackend(debugPkg);
	}
	/**
	* This pretty much works like the Node logger, but it outputs structured
	* logging JSON matching Google Cloud's ingestion specs. Rather than handling
	* its own output, it wraps another backend. The passed backend must be a subclass
	* of `DebugLogBackendBase` (any of the backends exposed by this package will work).
	*/
	var StructuredBackend = class extends DebugLogBackendBase {
		upstream;
		constructor(upstream) {
			super();
			this.upstream = upstream ?? void 0;
		}
		makeLogger(namespace) {
			const debugLogger = this.upstream?.makeLogger(namespace);
			return (fields, ...args) => {
				const severity = fields.severity ?? types_1.LogSeverity.INFO;
				const json = Object.assign({
					severity,
					message: util$6.format(...args)
				}, fields);
				const jsonString = JSON.stringify(json);
				if (debugLogger) debugLogger(fields, jsonString);
				else console.log("%s", jsonString);
			};
		}
		setFilters() {
			this.upstream?.setFilters();
		}
	};
	/**
	* Creates a "structured logging" backend. This pretty much works like the
	* Node logger, but it outputs structured logging JSON matching Google
	* Cloud's ingestion specs instead of plain text.
	*
	* ```
	*  setBackend(getStructuredBackend())
	* ```
	*
	* @param upstream If you want to use something besides the Node backend to
	*   write the actual log lines into, pass that here.
	* @returns A backend based on Google Cloud structured logging.
	*/
	function getStructuredBackend(upstream) {
		return new StructuredBackend(upstream);
	}
	/**
	* The environment variables that we standardized on, for all ad-hoc logging.
	*/
	exports.env = { 
	/**
	* Filter wildcards specific to the Node syntax, and similar to the built-in
	* utils.debuglog() environment variable. If missing, disables logging.
	*/
nodeEnables: "GOOGLE_SDK_NODE_LOGGING" };
	const loggerCache = /* @__PURE__ */ new Map();
	let cachedBackend = void 0;
	/**
	* Set the backend to use for our log output.
	* - A backend object
	* - null to disable logging
	* - undefined for "nothing yet", defaults to the Node backend
	*
	* @param backend Results from one of the get*Backend() functions.
	*/
	function setBackend(backend) {
		cachedBackend = backend;
		loggerCache.clear();
	}
	/**
	* Creates a logging function. Multiple calls to this with the same namespace
	* will produce the same logger, with the same event emitter hooks.
	*
	* Namespaces can be a simple string ("system" name), or a qualified string
	* (system:subsystem), which can be used for filtering, or for "system:*".
	*
	* @param namespace The namespace, a descriptive text string.
	* @returns A function you can call that works similar to console.log().
	*/
	function log(namespace, parent) {
		if (!cachedBackend) {
			if (!process$2.env[exports.env.nodeEnables]) return exports.placeholder;
		}
		if (!namespace) return exports.placeholder;
		if (parent) namespace = `${parent.instance.namespace}:${namespace}`;
		const existing = loggerCache.get(namespace);
		if (existing) return existing.func;
		if (cachedBackend === null) return exports.placeholder;
		else if (cachedBackend === void 0) cachedBackend = getNodeBackend();
		const logger = (() => {
			let previousBackend = void 0;
			return new AdhocDebugLogger(namespace, (fields, ...args) => {
				if (previousBackend !== cachedBackend) {
					if (cachedBackend === null) return;
					else if (cachedBackend === void 0) cachedBackend = getNodeBackend();
					previousBackend = cachedBackend;
				}
				cachedBackend?.log(namespace, fields, ...args);
			});
		})();
		loggerCache.set(namespace, logger);
		return logger.func;
	}
}));
//#endregion
//#region ../../node_modules/.pnpm/google-logging-utils@2.0.1/node_modules/google-logging-utils/build/src/index.js
var require_src$3 = /* @__PURE__ */ __commonJSMin(((exports) => {
	var __createBinding = exports && exports.__createBinding || (Object.create ? (function(o, m, k, k2) {
		if (k2 === void 0) k2 = k;
		var desc = Object.getOwnPropertyDescriptor(m, k);
		if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) desc = {
			enumerable: true,
			get: function() {
				return m[k];
			}
		};
		Object.defineProperty(o, k2, desc);
	}) : (function(o, m, k, k2) {
		if (k2 === void 0) k2 = k;
		o[k2] = m[k];
	}));
	var __exportStar = exports && exports.__exportStar || function(m, exports$5) {
		for (var p in m) if (p !== "default" && !Object.prototype.hasOwnProperty.call(exports$5, p)) __createBinding(exports$5, m, p);
	};
	Object.defineProperty(exports, "__esModule", { value: true });
	__exportStar(require_logging_utils(), exports);
}));
//#endregion
//#region ../../node_modules/.pnpm/gcp-metadata@9.0.4/node_modules/gcp-metadata/build/src/index.js
var require_src$2 = /* @__PURE__ */ __commonJSMin(((exports) => {
	var __createBinding = exports && exports.__createBinding || (Object.create ? (function(o, m, k, k2) {
		if (k2 === void 0) k2 = k;
		var desc = Object.getOwnPropertyDescriptor(m, k);
		if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) desc = {
			enumerable: true,
			get: function() {
				return m[k];
			}
		};
		Object.defineProperty(o, k2, desc);
	}) : (function(o, m, k, k2) {
		if (k2 === void 0) k2 = k;
		o[k2] = m[k];
	}));
	var __setModuleDefault = exports && exports.__setModuleDefault || (Object.create ? (function(o, v) {
		Object.defineProperty(o, "default", {
			enumerable: true,
			value: v
		});
	}) : function(o, v) {
		o["default"] = v;
	});
	var __importStar = exports && exports.__importStar || (function() {
		var ownKeys = function(o) {
			ownKeys = Object.getOwnPropertyNames || function(o) {
				var ar = [];
				for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
				return ar;
			};
			return ownKeys(o);
		};
		return function(mod) {
			if (mod && mod.__esModule) return mod;
			var result = {};
			if (mod != null) {
				for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
			}
			__setModuleDefault(result, mod);
			return result;
		};
	})();
	var __exportStar = exports && exports.__exportStar || function(m, exports$4) {
		for (var p in m) if (p !== "default" && !Object.prototype.hasOwnProperty.call(exports$4, p)) __createBinding(exports$4, m, p);
	};
	Object.defineProperty(exports, "__esModule", { value: true });
	exports.gcpResidencyCache = exports.METADATA_SERVER_DETECTION = exports.HEADERS = exports.HEADER_VALUE = exports.HEADER_NAME = exports.SECONDARY_HOST_ADDRESS = exports.HOST_ADDRESS = exports.BASE_PATH = void 0;
	exports.instance = instance;
	exports.project = project;
	exports.universe = universe;
	exports.bulk = bulk;
	exports.isAvailable = isAvailable;
	exports.resetIsAvailableCache = resetIsAvailableCache;
	exports.getGCPResidency = getGCPResidency;
	exports.setGCPResidency = setGCPResidency;
	exports.requestTimeout = requestTimeout;
	/**
	* Copyright 2018 Google LLC
	*
	* Licensed under the Apache License, Version 2.0 (the "License");
	* you may not use this file except in compliance with the License.
	* You may obtain a copy of the License at
	*
	*      http://www.apache.org/licenses/LICENSE-2.0
	*
	* Unless required by applicable law or agreed to in writing, software
	* distributed under the License is distributed on an "AS IS" BASIS,
	* WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
	* See the License for the specific language governing permissions and
	* limitations under the License.
	*/
	const gaxios_1 = require_src$4();
	const jsonBigint = require_json_bigint();
	const gcp_residency_1 = require_gcp_residency();
	const logger = __importStar(require_src$3());
	exports.BASE_PATH = "/computeMetadata/v1";
	exports.HOST_ADDRESS = "http://169.254.169.254";
	exports.SECONDARY_HOST_ADDRESS = "http://metadata.google.internal.";
	exports.HEADER_NAME = "Metadata-Flavor";
	exports.HEADER_VALUE = "Google";
	exports.HEADERS = Object.freeze({ [exports.HEADER_NAME]: exports.HEADER_VALUE });
	const log = logger.log("gcp-metadata");
	/**
	* Metadata server detection override options.
	*
	* Available via `process.env.METADATA_SERVER_DETECTION`.
	*/
	exports.METADATA_SERVER_DETECTION = Object.freeze({
		"assume-present": "don't try to ping the metadata server, but assume it's present",
		none: "don't try to ping the metadata server, but don't try to use it either",
		"bios-only": "treat the result of a BIOS probe as canonical (don't fall back to pinging)",
		"ping-only": "skip the BIOS probe, and go straight to pinging"
	});
	/**
	* Returns the base URL while taking into account the GCE_METADATA_HOST
	* environment variable if it exists.
	*
	* @returns The base URL, e.g., http://169.254.169.254/computeMetadata/v1.
	*/
	function getBaseUrl(baseUrl) {
		if (!baseUrl) baseUrl = process.env.GCE_METADATA_IP || process.env.GCE_METADATA_HOST || exports.HOST_ADDRESS;
		if (!/^https?:\/\//.test(baseUrl)) baseUrl = `http://${baseUrl}`;
		return new URL(exports.BASE_PATH, baseUrl).href;
	}
	function validate(options) {
		Object.keys(options).forEach((key) => {
			switch (key) {
				case "params":
				case "property":
				case "headers": break;
				case "qs": throw new Error("'qs' is not a valid configuration option. Please use 'params' instead.");
				default: throw new Error(`'${key}' is not a valid configuration option.`);
			}
		});
	}
	async function metadataAccessor(type, options = {}, noResponseRetries = 3, fastFail = false) {
		const headers = new Headers(exports.HEADERS);
		let metadataKey = "";
		let params = {};
		if (typeof type === "object") {
			const metadataAccessor = type;
			new Headers(metadataAccessor.headers).forEach((value, key) => headers.set(key, value));
			metadataKey = metadataAccessor.metadataKey;
			params = metadataAccessor.params || params;
			noResponseRetries = metadataAccessor.noResponseRetries || noResponseRetries;
			fastFail = metadataAccessor.fastFail || fastFail;
		} else metadataKey = type;
		if (typeof options === "string") metadataKey += `/${options}`;
		else {
			validate(options);
			if (options.property) metadataKey += `/${options.property}`;
			new Headers(options.headers).forEach((value, key) => headers.set(key, value));
			params = options.params || params;
		}
		const requestMethod = fastFail ? fastFailMetadataRequest : gaxios_1.request;
		const req = {
			url: `${getBaseUrl()}/${metadataKey}`,
			headers,
			retryConfig: { noResponseRetries },
			params,
			responseType: "text",
			timeout: requestTimeout()
		};
		log.info("instance request %j", req);
		const res = await requestMethod(req);
		log.info("instance metadata is %s", res.data);
		const metadataFlavor = res.headers.get(exports.HEADER_NAME);
		if (metadataFlavor !== exports.HEADER_VALUE) throw new RangeError(`Invalid response from metadata service: incorrect ${exports.HEADER_NAME} header. Expected '${exports.HEADER_VALUE}', got ${metadataFlavor ? `'${metadataFlavor}'` : "no header"}`);
		if (typeof res.data === "string") try {
			return jsonBigint.parse(res.data);
		} catch {}
		return res.data;
	}
	async function fastFailMetadataRequest(options) {
		const secondaryOptions = {
			...options,
			url: options.url?.toString().replace(getBaseUrl(), getBaseUrl(exports.SECONDARY_HOST_ADDRESS))
		};
		const r1 = (0, gaxios_1.request)(options);
		const r2 = (0, gaxios_1.request)(secondaryOptions);
		return Promise.any([r1, r2]);
	}
	/**
	* Obtain metadata for the current GCE instance.
	*
	* @see {@link https://cloud.google.com/compute/docs/metadata/predefined-metadata-keys}
	*
	* @example
	* ```
	* const serviceAccount: {} = await instance('service-accounts/');
	* const serviceAccountEmail: string = await instance('service-accounts/default/email');
	* ```
	*/
	function instance(options) {
		return metadataAccessor("instance", options);
	}
	/**
	* Obtain metadata for the current GCP project.
	*
	* @see {@link https://cloud.google.com/compute/docs/metadata/predefined-metadata-keys}
	*
	* @example
	* ```
	* const projectId: string = await project('project-id');
	* const numericProjectId: number = await project('numeric-project-id');
	* ```
	*/
	function project(options) {
		return metadataAccessor("project", options);
	}
	/**
	* Obtain metadata for the current universe.
	*
	* @see {@link https://cloud.google.com/compute/docs/metadata/predefined-metadata-keys}
	*
	* @example
	* ```
	* const universeDomain: string = await universe('universe-domain');
	* ```
	*/
	function universe(options) {
		return metadataAccessor("universe", options);
	}
	/**
	* Retrieve metadata items in parallel.
	*
	* @see {@link https://cloud.google.com/compute/docs/metadata/predefined-metadata-keys}
	*
	* @example
	* ```
	* const data = await bulk([
	*   {
	*     metadataKey: 'instance',
	*   },
	*   {
	*     metadataKey: 'project/project-id',
	*   },
	* ] as const);
	*
	* // data.instance;
	* // data['project/project-id'];
	* ```
	*
	* @param properties The metadata properties to retrieve
	* @returns The metadata in `metadatakey:value` format
	*/
	async function bulk(properties) {
		const r = {};
		await Promise.all(properties.map((item) => {
			return (async () => {
				const res = await metadataAccessor(item);
				const key = item.metadataKey;
				r[key] = res;
			})();
		}));
		return r;
	}
	function detectGCPAvailableRetries() {
		return process.env.DETECT_GCP_RETRIES ? Number(process.env.DETECT_GCP_RETRIES) : 0;
	}
	let cachedIsAvailableResponse;
	const EXPECTED_NETWORK_ERROR_CODES = /* @__PURE__ */ new Set([
		"EHOSTDOWN",
		"EHOSTUNREACH",
		"ENETUNREACH",
		"ENOENT",
		"ENOTFOUND",
		"ECONNREFUSED"
	]);
	const TIMEOUT_NAMES_AND_CODES = /* @__PURE__ */ new Set(["AbortError", "TimeoutError"]);
	const TIMEOUT_TYPES = /* @__PURE__ */ new Set(["aborted", "request-timeout"]);
	const MAX_ERROR_DEPTH = 20;
	function isErrorWithDetails(val) {
		return typeof val === "object" && val !== null;
	}
	/**
	* Recursively extracts and normalizes POSIX/network error codes from potentially
	* nested Error objects (`AggregateError.errors` from `Promise.any`, `.cause`, `.error`).
	* Guards against circular references and deep recursion.
	*/
	function getErrorCodes(err, visited = /* @__PURE__ */ new Set(), depth = 0) {
		if (!isErrorWithDetails(err) || visited.has(err) || depth > MAX_ERROR_DEPTH) return ["UNKNOWN"];
		visited.add(err);
		if (err.name === "AggregateError" && Array.isArray(err.errors)) {
			if (err.errors.length === 0) return ["UNKNOWN"];
			return err.errors.flatMap((subErr) => getErrorCodes(subErr, visited, depth + 1));
		}
		if (err.name !== void 0 && TIMEOUT_NAMES_AND_CODES.has(err.name) || err.code !== void 0 && TIMEOUT_NAMES_AND_CODES.has(err.code) || err.type !== void 0 && TIMEOUT_TYPES.has(err.type)) return ["ETIMEDOUT"];
		if ((typeof err.code === "string" || typeof err.code === "number") && err.code !== "") return [String(err.code)];
		const nested = err.cause ?? err.error;
		if (nested !== void 0) return getErrorCodes(nested, visited, depth + 1);
		return ["UNKNOWN"];
	}
	/**
	* Determine if the metadata server is currently available.
	*/
	async function isAvailable() {
		if (process.env.METADATA_SERVER_DETECTION) {
			const value = process.env.METADATA_SERVER_DETECTION.trim().toLocaleLowerCase();
			if (!(value in exports.METADATA_SERVER_DETECTION)) throw new RangeError(`Unknown \`METADATA_SERVER_DETECTION\` env variable. Got \`${value}\`, but it should be \`${Object.keys(exports.METADATA_SERVER_DETECTION).join("`, `")}\`, or unset`);
			switch (value) {
				case "assume-present": return true;
				case "none": return false;
				case "bios-only": return getGCPResidency();
			}
		}
		try {
			if (cachedIsAvailableResponse === void 0) cachedIsAvailableResponse = (async () => {
				try {
					await metadataAccessor("instance", void 0, detectGCPAvailableRetries(), !(process.env.GCE_METADATA_IP || process.env.GCE_METADATA_HOST));
					return true;
				} catch (e) {
					if (process.env.DEBUG_AUTH) console.info(e);
					if (!isErrorWithDetails(e)) {
						process.emitWarning(`received unexpected error = ${String(e)} code = UNKNOWN`, "MetadataLookupWarning");
						return false;
					}
					if (e.type === "request-timeout" || e.response?.status === 404) return false;
					const codes = getErrorCodes(e);
					if (!(codes.length > 0 && codes.every((code) => EXPECTED_NETWORK_ERROR_CODES.has(code)))) {
						const code = [...new Set(codes)].join(", ");
						process.emitWarning(`received unexpected error = ${e.message} code = ${code}`, "MetadataLookupWarning");
					}
					return false;
				}
			})();
			return await cachedIsAvailableResponse;
		} catch (e) {
			return false;
		}
	}
	/**
	* reset the memoized isAvailable() lookup.
	*/
	function resetIsAvailableCache() {
		cachedIsAvailableResponse = void 0;
	}
	/**
	* A cache for the detected GCP Residency.
	*/
	exports.gcpResidencyCache = null;
	/**
	* Detects GCP Residency.
	* Caches results to reduce costs for subsequent calls.
	*
	* @see setGCPResidency for setting
	*/
	function getGCPResidency() {
		if (exports.gcpResidencyCache === null) setGCPResidency();
		return exports.gcpResidencyCache;
	}
	/**
	* Sets the detected GCP Residency.
	* Useful for forcing metadata server detection behavior.
	*
	* Set `null` to autodetect the environment (default behavior).
	* @see getGCPResidency for getting
	*/
	function setGCPResidency(value = null) {
		exports.gcpResidencyCache = value !== null ? value : (0, gcp_residency_1.detectGCPResidency)();
	}
	/**
	* Obtain the timeout for requests to the metadata server.
	*
	* In certain environments and conditions requests can take longer than
	* the default timeout to complete. This function will determine the
	* appropriate timeout based on the environment.
	*
	* @returns {number} a request timeout duration in milliseconds.
	*/
	function requestTimeout() {
		return getGCPResidency() ? 0 : 3e3;
	}
	__exportStar(require_gcp_residency(), exports);
}));
//#endregion
//#region ../../node_modules/.pnpm/base64-js@1.5.1/node_modules/base64-js/index.js
var require_base64_js = /* @__PURE__ */ __commonJSMin(((exports) => {
	exports.byteLength = byteLength;
	exports.toByteArray = toByteArray;
	exports.fromByteArray = fromByteArray;
	var lookup = [];
	var revLookup = [];
	var Arr = typeof Uint8Array !== "undefined" ? Uint8Array : Array;
	var code = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
	for (var i = 0, len = code.length; i < len; ++i) {
		lookup[i] = code[i];
		revLookup[code.charCodeAt(i)] = i;
	}
	revLookup["-".charCodeAt(0)] = 62;
	revLookup["_".charCodeAt(0)] = 63;
	function getLens(b64) {
		var len = b64.length;
		if (len % 4 > 0) throw new Error("Invalid string. Length must be a multiple of 4");
		var validLen = b64.indexOf("=");
		if (validLen === -1) validLen = len;
		var placeHoldersLen = validLen === len ? 0 : 4 - validLen % 4;
		return [validLen, placeHoldersLen];
	}
	function byteLength(b64) {
		var lens = getLens(b64);
		var validLen = lens[0];
		var placeHoldersLen = lens[1];
		return (validLen + placeHoldersLen) * 3 / 4 - placeHoldersLen;
	}
	function _byteLength(b64, validLen, placeHoldersLen) {
		return (validLen + placeHoldersLen) * 3 / 4 - placeHoldersLen;
	}
	function toByteArray(b64) {
		var tmp;
		var lens = getLens(b64);
		var validLen = lens[0];
		var placeHoldersLen = lens[1];
		var arr = new Arr(_byteLength(b64, validLen, placeHoldersLen));
		var curByte = 0;
		var len = placeHoldersLen > 0 ? validLen - 4 : validLen;
		var i = 0;
		for (; i < len; i += 4) {
			tmp = revLookup[b64.charCodeAt(i)] << 18 | revLookup[b64.charCodeAt(i + 1)] << 12 | revLookup[b64.charCodeAt(i + 2)] << 6 | revLookup[b64.charCodeAt(i + 3)];
			arr[curByte++] = tmp >> 16 & 255;
			arr[curByte++] = tmp >> 8 & 255;
			arr[curByte++] = tmp & 255;
		}
		if (placeHoldersLen === 2) {
			tmp = revLookup[b64.charCodeAt(i)] << 2 | revLookup[b64.charCodeAt(i + 1)] >> 4;
			arr[curByte++] = tmp & 255;
		}
		if (placeHoldersLen === 1) {
			tmp = revLookup[b64.charCodeAt(i)] << 10 | revLookup[b64.charCodeAt(i + 1)] << 4 | revLookup[b64.charCodeAt(i + 2)] >> 2;
			arr[curByte++] = tmp >> 8 & 255;
			arr[curByte++] = tmp & 255;
		}
		return arr;
	}
	function tripletToBase64(num) {
		return lookup[num >> 18 & 63] + lookup[num >> 12 & 63] + lookup[num >> 6 & 63] + lookup[num & 63];
	}
	function encodeChunk(uint8, start, end) {
		var tmp;
		var output = [];
		for (var i = start; i < end; i += 3) {
			tmp = (uint8[i] << 16 & 16711680) + (uint8[i + 1] << 8 & 65280) + (uint8[i + 2] & 255);
			output.push(tripletToBase64(tmp));
		}
		return output.join("");
	}
	function fromByteArray(uint8) {
		var tmp;
		var len = uint8.length;
		var extraBytes = len % 3;
		var parts = [];
		var maxChunkLength = 16383;
		for (var i = 0, len2 = len - extraBytes; i < len2; i += maxChunkLength) parts.push(encodeChunk(uint8, i, i + maxChunkLength > len2 ? len2 : i + maxChunkLength));
		if (extraBytes === 1) {
			tmp = uint8[len - 1];
			parts.push(lookup[tmp >> 2] + lookup[tmp << 4 & 63] + "==");
		} else if (extraBytes === 2) {
			tmp = (uint8[len - 2] << 8) + uint8[len - 1];
			parts.push(lookup[tmp >> 10] + lookup[tmp >> 4 & 63] + lookup[tmp << 2 & 63] + "=");
		}
		return parts.join("");
	}
}));
//#endregion
//#region ../../node_modules/.pnpm/google-auth-library@11.1.0/node_modules/google-auth-library/build/src/crypto/shared.js
var require_shared$1 = /* @__PURE__ */ __commonJSMin(((exports) => {
	Object.defineProperty(exports, "__esModule", { value: true });
	exports.fromArrayBufferToHex = fromArrayBufferToHex;
	/**
	* Converts an ArrayBuffer to a hexadecimal string.
	* @param arrayBuffer The ArrayBuffer to convert to hexadecimal string.
	* @return The hexadecimal encoding of the ArrayBuffer.
	*/
	function fromArrayBufferToHex(arrayBuffer) {
		return Array.from(new Uint8Array(arrayBuffer)).map((byte) => {
			return byte.toString(16).padStart(2, "0");
		}).join("");
	}
}));
//#endregion
//#region ../../node_modules/.pnpm/google-auth-library@11.1.0/node_modules/google-auth-library/build/src/crypto/browser/crypto.js
var require_crypto$2 = /* @__PURE__ */ __commonJSMin(((exports) => {
	Object.defineProperty(exports, "__esModule", { value: true });
	exports.BrowserCrypto = void 0;
	const base64js = require_base64_js();
	const shared_1 = require_shared$1();
	exports.BrowserCrypto = class BrowserCrypto {
		constructor() {
			if (typeof window === "undefined" || window.crypto === void 0 || window.crypto.subtle === void 0) throw new Error("SubtleCrypto not found. Make sure it's an https:// website.");
		}
		async sha256DigestBase64(str) {
			const inputBuffer = new TextEncoder().encode(str);
			const outputBuffer = await window.crypto.subtle.digest("SHA-256", inputBuffer);
			return base64js.fromByteArray(new Uint8Array(outputBuffer));
		}
		randomBytesBase64(count) {
			const array = new Uint8Array(count);
			window.crypto.getRandomValues(array);
			return base64js.fromByteArray(array);
		}
		static padBase64(base64) {
			while (base64.length % 4 !== 0) base64 += "=";
			return base64;
		}
		async verify(pubkey, data, signature) {
			const algo = {
				name: "RSASSA-PKCS1-v1_5",
				hash: { name: "SHA-256" }
			};
			const dataArray = new TextEncoder().encode(data);
			const signatureArray = base64js.toByteArray(BrowserCrypto.padBase64(signature));
			const cryptoKey = await window.crypto.subtle.importKey("jwk", pubkey, algo, true, ["verify"]);
			return await window.crypto.subtle.verify(algo, cryptoKey, Buffer.from(signatureArray), dataArray);
		}
		async sign(privateKey, data) {
			const algo = {
				name: "RSASSA-PKCS1-v1_5",
				hash: { name: "SHA-256" }
			};
			const dataArray = new TextEncoder().encode(data);
			const cryptoKey = await window.crypto.subtle.importKey("jwk", privateKey, algo, true, ["sign"]);
			const result = await window.crypto.subtle.sign(algo, cryptoKey, dataArray);
			return base64js.fromByteArray(new Uint8Array(result));
		}
		decodeBase64StringUtf8(base64) {
			const uint8array = base64js.toByteArray(BrowserCrypto.padBase64(base64));
			return new TextDecoder().decode(uint8array);
		}
		encodeBase64StringUtf8(text) {
			const uint8array = new TextEncoder().encode(text);
			return base64js.fromByteArray(uint8array);
		}
		/**
		* Computes the SHA-256 hash of the provided string.
		* @param str The plain text string to hash.
		* @return A promise that resolves with the SHA-256 hash of the provided
		*   string in hexadecimal encoding.
		*/
		async sha256DigestHex(str) {
			const inputBuffer = new TextEncoder().encode(str);
			const outputBuffer = await window.crypto.subtle.digest("SHA-256", inputBuffer);
			return (0, shared_1.fromArrayBufferToHex)(outputBuffer);
		}
		/**
		* Computes the HMAC hash of a message using the provided crypto key and the
		* SHA-256 algorithm.
		* @param key The secret crypto key in utf-8 or ArrayBuffer format.
		* @param msg The plain text message.
		* @return A promise that resolves with the HMAC-SHA256 hash in ArrayBuffer
		*   format.
		*/
		async signWithHmacSha256(key, msg) {
			const rawKey = typeof key === "string" ? key : String.fromCharCode(...new Uint16Array(key));
			const enc = new TextEncoder();
			const cryptoKey = await window.crypto.subtle.importKey("raw", enc.encode(rawKey), {
				name: "HMAC",
				hash: { name: "SHA-256" }
			}, false, ["sign"]);
			return window.crypto.subtle.sign("HMAC", cryptoKey, enc.encode(msg));
		}
	};
}));
//#endregion
//#region ../../node_modules/.pnpm/google-auth-library@11.1.0/node_modules/google-auth-library/build/src/crypto/node/crypto.js
var require_crypto$1 = /* @__PURE__ */ __commonJSMin(((exports) => {
	Object.defineProperty(exports, "__esModule", { value: true });
	exports.NodeCrypto = void 0;
	const crypto$4 = __require("crypto");
	var NodeCrypto = class {
		async sha256DigestBase64(str) {
			return crypto$4.createHash("sha256").update(str).digest("base64");
		}
		randomBytesBase64(count) {
			return crypto$4.randomBytes(count).toString("base64");
		}
		async verify(pubkey, data, signature) {
			const verifier = crypto$4.createVerify("RSA-SHA256");
			verifier.update(data);
			verifier.end();
			return verifier.verify(pubkey, signature, "base64");
		}
		async sign(privateKey, data) {
			const signer = crypto$4.createSign("RSA-SHA256");
			signer.update(data);
			signer.end();
			return signer.sign(privateKey, "base64");
		}
		decodeBase64StringUtf8(base64) {
			return Buffer.from(base64, "base64").toString("utf-8");
		}
		encodeBase64StringUtf8(text) {
			return Buffer.from(text, "utf-8").toString("base64");
		}
		/**
		* Computes the SHA-256 hash of the provided string.
		* @param str The plain text string to hash.
		* @return A promise that resolves with the SHA-256 hash of the provided
		*   string in hexadecimal encoding.
		*/
		async sha256DigestHex(str) {
			return crypto$4.createHash("sha256").update(str).digest("hex");
		}
		/**
		* Computes the HMAC hash of a message using the provided crypto key and the
		* SHA-256 algorithm.
		* @param key The secret crypto key in utf-8 or ArrayBuffer format.
		* @param msg The plain text message.
		* @return A promise that resolves with the HMAC-SHA256 hash in ArrayBuffer
		*   format.
		*/
		async signWithHmacSha256(key, msg) {
			const cryptoKey = typeof key === "string" ? key : toBuffer(key);
			return toArrayBuffer(crypto$4.createHmac("sha256", cryptoKey).update(msg).digest());
		}
	};
	exports.NodeCrypto = NodeCrypto;
	/**
	* Converts a Node.js Buffer to an ArrayBuffer.
	* https://stackoverflow.com/questions/8609289/convert-a-binary-nodejs-buffer-to-javascript-arraybuffer
	* @param buffer The Buffer input to covert.
	* @return The ArrayBuffer representation of the input.
	*/
	function toArrayBuffer(buffer) {
		const ab = new ArrayBuffer(buffer.length);
		const view = new Uint8Array(ab);
		for (let i = 0; i < buffer.length; ++i) view[i] = buffer[i];
		return ab;
	}
	/**
	* Converts an ArrayBuffer to a Node.js Buffer.
	* @param arrayBuffer The ArrayBuffer input to covert.
	* @return The Buffer representation of the input.
	*/
	function toBuffer(arrayBuffer) {
		return Buffer.from(arrayBuffer);
	}
}));
//#endregion
//#region ../../node_modules/.pnpm/google-auth-library@11.1.0/node_modules/google-auth-library/build/src/crypto/crypto.js
var require_crypto = /* @__PURE__ */ __commonJSMin(((exports) => {
	var __createBinding = exports && exports.__createBinding || (Object.create ? (function(o, m, k, k2) {
		if (k2 === void 0) k2 = k;
		var desc = Object.getOwnPropertyDescriptor(m, k);
		if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) desc = {
			enumerable: true,
			get: function() {
				return m[k];
			}
		};
		Object.defineProperty(o, k2, desc);
	}) : (function(o, m, k, k2) {
		if (k2 === void 0) k2 = k;
		o[k2] = m[k];
	}));
	var __exportStar = exports && exports.__exportStar || function(m, exports$3) {
		for (var p in m) if (p !== "default" && !Object.prototype.hasOwnProperty.call(exports$3, p)) __createBinding(exports$3, m, p);
	};
	Object.defineProperty(exports, "__esModule", { value: true });
	exports.createCrypto = createCrypto;
	exports.hasBrowserCrypto = hasBrowserCrypto;
	const crypto_1 = require_crypto$2();
	const crypto_2 = require_crypto$1();
	__exportStar(require_shared$1(), exports);
	function createCrypto() {
		if (hasBrowserCrypto()) return new crypto_1.BrowserCrypto();
		return new crypto_2.NodeCrypto();
	}
	function hasBrowserCrypto() {
		return typeof window !== "undefined" && typeof window.crypto !== "undefined" && typeof window.crypto.subtle !== "undefined";
	}
}));
//#endregion
//#region ../../node_modules/.pnpm/safe-buffer@5.2.1/node_modules/safe-buffer/index.js
var require_safe_buffer = /* @__PURE__ */ __commonJSMin(((exports, module) => {
	/*! safe-buffer. MIT License. Feross Aboukhadijeh <https://feross.org/opensource> */
	var buffer = __require("buffer");
	var Buffer = buffer.Buffer;
	function copyProps(src, dst) {
		for (var key in src) dst[key] = src[key];
	}
	if (Buffer.from && Buffer.alloc && Buffer.allocUnsafe && Buffer.allocUnsafeSlow) module.exports = buffer;
	else {
		copyProps(buffer, exports);
		exports.Buffer = SafeBuffer;
	}
	function SafeBuffer(arg, encodingOrOffset, length) {
		return Buffer(arg, encodingOrOffset, length);
	}
	SafeBuffer.prototype = Object.create(Buffer.prototype);
	copyProps(Buffer, SafeBuffer);
	SafeBuffer.from = function(arg, encodingOrOffset, length) {
		if (typeof arg === "number") throw new TypeError("Argument must not be a number");
		return Buffer(arg, encodingOrOffset, length);
	};
	SafeBuffer.alloc = function(size, fill, encoding) {
		if (typeof size !== "number") throw new TypeError("Argument must be a number");
		var buf = Buffer(size);
		if (fill !== void 0) {
			if (typeof encoding === "string") buf.fill(fill, encoding);
			else buf.fill(fill);
		} else buf.fill(0);
		return buf;
	};
	SafeBuffer.allocUnsafe = function(size) {
		if (typeof size !== "number") throw new TypeError("Argument must be a number");
		return Buffer(size);
	};
	SafeBuffer.allocUnsafeSlow = function(size) {
		if (typeof size !== "number") throw new TypeError("Argument must be a number");
		return buffer.SlowBuffer(size);
	};
}));
//#endregion
//#region ../../node_modules/.pnpm/ecdsa-sig-formatter@1.0.11/node_modules/ecdsa-sig-formatter/src/param-bytes-for-alg.js
var require_param_bytes_for_alg = /* @__PURE__ */ __commonJSMin(((exports, module) => {
	function getParamSize(keySize) {
		return (keySize / 8 | 0) + (keySize % 8 === 0 ? 0 : 1);
	}
	var paramBytesForAlg = {
		ES256: getParamSize(256),
		ES384: getParamSize(384),
		ES512: getParamSize(521)
	};
	function getParamBytesForAlg(alg) {
		var paramBytes = paramBytesForAlg[alg];
		if (paramBytes) return paramBytes;
		throw new Error("Unknown algorithm \"" + alg + "\"");
	}
	module.exports = getParamBytesForAlg;
}));
//#endregion
//#region ../../node_modules/.pnpm/ecdsa-sig-formatter@1.0.11/node_modules/ecdsa-sig-formatter/src/ecdsa-sig-formatter.js
var require_ecdsa_sig_formatter = /* @__PURE__ */ __commonJSMin(((exports, module) => {
	var Buffer = require_safe_buffer().Buffer;
	var getParamBytesForAlg = require_param_bytes_for_alg();
	var MAX_OCTET = 128;
	var CLASS_UNIVERSAL = 0;
	var PRIMITIVE_BIT = 32;
	var TAG_SEQ = 16;
	var TAG_INT = 2;
	var ENCODED_TAG_SEQ = TAG_SEQ | PRIMITIVE_BIT | CLASS_UNIVERSAL << 6;
	var ENCODED_TAG_INT = TAG_INT | CLASS_UNIVERSAL << 6;
	function base64Url(base64) {
		return base64.replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
	}
	function signatureAsBuffer(signature) {
		if (Buffer.isBuffer(signature)) return signature;
		else if ("string" === typeof signature) return Buffer.from(signature, "base64");
		throw new TypeError("ECDSA signature must be a Base64 string or a Buffer");
	}
	function derToJose(signature, alg) {
		signature = signatureAsBuffer(signature);
		var paramBytes = getParamBytesForAlg(alg);
		var maxEncodedParamLength = paramBytes + 1;
		var inputLength = signature.length;
		var offset = 0;
		if (signature[offset++] !== ENCODED_TAG_SEQ) throw new Error("Could not find expected \"seq\"");
		var seqLength = signature[offset++];
		if (seqLength === (MAX_OCTET | 1)) seqLength = signature[offset++];
		if (inputLength - offset < seqLength) throw new Error("\"seq\" specified length of \"" + seqLength + "\", only \"" + (inputLength - offset) + "\" remaining");
		if (signature[offset++] !== ENCODED_TAG_INT) throw new Error("Could not find expected \"int\" for \"r\"");
		var rLength = signature[offset++];
		if (inputLength - offset - 2 < rLength) throw new Error("\"r\" specified length of \"" + rLength + "\", only \"" + (inputLength - offset - 2) + "\" available");
		if (maxEncodedParamLength < rLength) throw new Error("\"r\" specified length of \"" + rLength + "\", max of \"" + maxEncodedParamLength + "\" is acceptable");
		var rOffset = offset;
		offset += rLength;
		if (signature[offset++] !== ENCODED_TAG_INT) throw new Error("Could not find expected \"int\" for \"s\"");
		var sLength = signature[offset++];
		if (inputLength - offset !== sLength) throw new Error("\"s\" specified length of \"" + sLength + "\", expected \"" + (inputLength - offset) + "\"");
		if (maxEncodedParamLength < sLength) throw new Error("\"s\" specified length of \"" + sLength + "\", max of \"" + maxEncodedParamLength + "\" is acceptable");
		var sOffset = offset;
		offset += sLength;
		if (offset !== inputLength) throw new Error("Expected to consume entire buffer, but \"" + (inputLength - offset) + "\" bytes remain");
		var rPadding = paramBytes - rLength, sPadding = paramBytes - sLength;
		var dst = Buffer.allocUnsafe(rPadding + rLength + sPadding + sLength);
		for (offset = 0; offset < rPadding; ++offset) dst[offset] = 0;
		signature.copy(dst, offset, rOffset + Math.max(-rPadding, 0), rOffset + rLength);
		offset = paramBytes;
		for (var o = offset; offset < o + sPadding; ++offset) dst[offset] = 0;
		signature.copy(dst, offset, sOffset + Math.max(-sPadding, 0), sOffset + sLength);
		dst = dst.toString("base64");
		dst = base64Url(dst);
		return dst;
	}
	function countPadding(buf, start, stop) {
		var padding = 0;
		while (start + padding < stop && buf[start + padding] === 0) ++padding;
		if (buf[start + padding] >= MAX_OCTET) --padding;
		return padding;
	}
	function joseToDer(signature, alg) {
		signature = signatureAsBuffer(signature);
		var paramBytes = getParamBytesForAlg(alg);
		var signatureBytes = signature.length;
		if (signatureBytes !== paramBytes * 2) throw new TypeError("\"" + alg + "\" signatures must be \"" + paramBytes * 2 + "\" bytes, saw \"" + signatureBytes + "\"");
		var rPadding = countPadding(signature, 0, paramBytes);
		var sPadding = countPadding(signature, paramBytes, signature.length);
		var rLength = paramBytes - rPadding;
		var sLength = paramBytes - sPadding;
		var rsBytes = 2 + rLength + 1 + 1 + sLength;
		var shortLength = rsBytes < MAX_OCTET;
		var dst = Buffer.allocUnsafe((shortLength ? 2 : 3) + rsBytes);
		var offset = 0;
		dst[offset++] = ENCODED_TAG_SEQ;
		if (shortLength) dst[offset++] = rsBytes;
		else {
			dst[offset++] = MAX_OCTET | 1;
			dst[offset++] = rsBytes & 255;
		}
		dst[offset++] = ENCODED_TAG_INT;
		dst[offset++] = rLength;
		if (rPadding < 0) {
			dst[offset++] = 0;
			offset += signature.copy(dst, offset, 0, paramBytes);
		} else offset += signature.copy(dst, offset, rPadding, paramBytes);
		dst[offset++] = ENCODED_TAG_INT;
		dst[offset++] = sLength;
		if (sPadding < 0) {
			dst[offset++] = 0;
			signature.copy(dst, offset, paramBytes);
		} else signature.copy(dst, offset, paramBytes + sPadding);
		return dst;
	}
	module.exports = {
		derToJose,
		joseToDer
	};
}));
//#endregion
//#region ../../node_modules/.pnpm/google-auth-library@11.1.0/node_modules/google-auth-library/build/src/util.js
var require_util$1 = /* @__PURE__ */ __commonJSMin(((exports) => {
	Object.defineProperty(exports, "__esModule", { value: true });
	exports.LRUCache = void 0;
	exports.snakeToCamel = snakeToCamel;
	exports.originalOrCamelOptions = originalOrCamelOptions;
	exports.removeUndefinedValuesInObject = removeUndefinedValuesInObject;
	exports.isValidFile = isValidFile;
	exports.getWellKnownCertificateConfigFileLocation = getWellKnownCertificateConfigFileLocation;
	const fs$7 = __require("fs");
	const os$1 = __require("os");
	const path$3 = __require("path");
	const WELL_KNOWN_CERTIFICATE_CONFIG_FILE = "certificate_config.json";
	const CLOUDSDK_CONFIG_DIRECTORY = "gcloud";
	/**
	* Returns the camel case of a provided string.
	*
	* @remarks
	*
	* Match any `_` and not `_` pair, then return the uppercase of the not `_`
	* character.
	*
	* @param str the string to convert
	* @returns the camelCase'd string
	*/
	function snakeToCamel(str) {
		return str.replace(/([_][^_])/g, (match) => match.slice(1).toUpperCase());
	}
	/**
	* Get the value of `obj[key]` or `obj[camelCaseKey]`, with a preference
	* for original, non-camelCase key.
	*
	* @param obj object to lookup a value in
	* @returns a `get` function for getting `obj[key || snakeKey]`, if available
	*/
	function originalOrCamelOptions(obj) {
		/**
		*
		* @param key an index of object, preferably snake_case
		* @returns the value `obj[key || snakeKey]`, if available
		*/
		function get(key) {
			const o = obj || {};
			return o[key] ?? o[snakeToCamel(key)];
		}
		return { get };
	}
	/**
	* A simple LRU cache utility.
	* Not meant for external usage.
	*
	* @experimental
	*/
	var LRUCache = class {
		capacity;
		/**
		* Maps are in order. Thus, the older item is the first item.
		*
		* {@link https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Map}
		*/
		#cache = /* @__PURE__ */ new Map();
		maxAge;
		constructor(options) {
			this.capacity = options.capacity;
			this.maxAge = options.maxAge;
		}
		/**
		* Moves the key to the end of the cache.
		*
		* @param key the key to move
		* @param value the value of the key
		*/
		#moveToEnd(key, value) {
			this.#cache.delete(key);
			this.#cache.set(key, {
				value,
				lastAccessed: Date.now()
			});
		}
		/**
		* Add an item to the cache.
		*
		* @param key the key to upsert
		* @param value the value of the key
		*/
		set(key, value) {
			this.#moveToEnd(key, value);
			this.#evict();
		}
		/**
		* Get an item from the cache.
		*
		* @param key the key to retrieve
		*/
		get(key) {
			const item = this.#cache.get(key);
			if (!item) return;
			this.#moveToEnd(key, item.value);
			this.#evict();
			return item.value;
		}
		/**
		* Maintain the cache based on capacity and TTL.
		*/
		#evict() {
			const cutoffDate = this.maxAge ? Date.now() - this.maxAge : 0;
			/**
			* Because we know Maps are in order, this item is both the
			* last item in the list (capacity) and oldest (maxAge).
			*/
			let oldestItem = this.#cache.entries().next();
			while (!oldestItem.done && (this.#cache.size > this.capacity || oldestItem.value[1].lastAccessed < cutoffDate)) {
				this.#cache.delete(oldestItem.value[0]);
				oldestItem = this.#cache.entries().next();
			}
		}
	};
	exports.LRUCache = LRUCache;
	function removeUndefinedValuesInObject(object) {
		Object.entries(object).forEach(([key, value]) => {
			if (value === void 0 || value === "undefined") delete object[key];
		});
		return object;
	}
	/**
	* Helper to check if a path points to a valid file.
	*/
	async function isValidFile(filePath) {
		try {
			return (await fs$7.promises.lstat(filePath)).isFile();
		} catch (e) {
			return false;
		}
	}
	/**
	* Determines the well-known gcloud location for the certificate config file.
	* @returns The platform-specific path to the configuration file.
	* @internal
	*/
	function getWellKnownCertificateConfigFileLocation() {
		const configDir = process.env.CLOUDSDK_CONFIG || (_isWindows() ? path$3.join(process.env.APPDATA || "", CLOUDSDK_CONFIG_DIRECTORY) : path$3.join(process.env.HOME || "", ".config", CLOUDSDK_CONFIG_DIRECTORY));
		return path$3.join(configDir, WELL_KNOWN_CERTIFICATE_CONFIG_FILE);
	}
	/**
	* Checks if the current operating system is Windows.
	* @returns True if the OS is Windows, false otherwise.
	* @internal
	*/
	function _isWindows() {
		return os$1.platform().startsWith("win");
	}
}));
//#endregion
//#region ../../node_modules/.pnpm/google-auth-library@11.1.0/node_modules/google-auth-library/package.json
var require_package$1 = /* @__PURE__ */ __commonJSMin(((exports, module) => {
	module.exports = {
		"name": "google-auth-library",
		"version": "11.1.0",
		"author": "Google Inc.",
		"description": "Google APIs Authentication Client Library for Node.js",
		"engines": { "node": ">=22" },
		"main": "./build/src/index.js",
		"types": "./build/src/index.d.ts",
		"repository": {
			"type": "git",
			"directory": "core/packages/google-auth-library-nodejs",
			"url": "https://github.com/googleapis/google-cloud-node.git"
		},
		"keywords": [
			"google",
			"api",
			"google apis",
			"client",
			"client library"
		],
		"dependencies": {
			"base64-js": "^1.3.0",
			"ecdsa-sig-formatter": "^1.0.11",
			"gaxios": "^7.1.4",
			"gcp-metadata": "^9.0.0",
			"google-logging-utils": "^2.0.0",
			"jws": "^4.0.0"
		},
		"devDependencies": {
			"@types/base64-js": "^1.2.5",
			"@types/jws": "^3.1.0",
			"@types/mocha": "^10.0.10",
			"@types/mv": "^2.1.0",
			"@types/ncp": "^2.0.8",
			"@types/node": "^24.0.0",
			"@types/sinon": "^21.0.0",
			"assert-rejects": "^1.0.0",
			"c8": "^10.1.3",
			"codecov": "^3.8.3",
			"gts": "^6.0.2",
			"is-docker": "^3.0.0",
			"jsdoc": "^4.0.4",
			"jsdoc-fresh": "^6.0.0",
			"jsdoc-region-tag": "^5.0.0",
			"karma": "^6.0.0",
			"karma-chrome-launcher": "^3.0.0",
			"karma-coverage": "^2.0.0",
			"karma-firefox-launcher": "^2.0.0",
			"karma-mocha": "^2.0.0",
			"karma-sourcemap-loader": "^0.4.0",
			"karma-webpack": "^5.0.0",
			"keypair": "^1.0.4",
			"mocha": "^11.1.0",
			"mv": "^2.1.1",
			"ncp": "^2.0.0",
			"nock": "^14.0.5",
			"null-loader": "^4.0.1",
			"puppeteer": "^24.0.0",
			"sinon": "21.0.3",
			"ts-loader": "^9.5.2",
			"typescript": "5.8.3",
			"webpack": "^5.97.1",
			"webpack-cli": "^6.0.1"
		},
		"files": ["build/src", "!build/src/**/*.map"],
		"scripts": {
			"test": "c8 mocha build/test",
			"clean": "gts clean",
			"prepare": "npm run compile",
			"lint": "gts check --no-inline-config",
			"compile": "tsc -p .",
			"fix": "gts fix",
			"pretest": "pnpm run compile --sourceMap",
			"docs": "jsdoc -c .jsdoc.js",
			"samples-setup": "cd samples/ && pnpm link ../ && pnpm run setup && cd ../",
			"samples-test": "cd samples/ && pnpm link ../ && pnpm test && cd ../",
			"system-test": "mocha build/system-test --timeout 60000",
			"presystem-test": "pnpm run compile --sourceMap",
			"webpack": "webpack",
			"browser-test": "karma start",
			"prelint": "cd samples; pnpm link ../; pnpm install"
		},
		"license": "Apache-2.0",
		"homepage": "https://github.com/googleapis/google-cloud-node/tree/main/core/packages/google-auth-library-nodejs"
	};
}));
//#endregion
//#region ../../node_modules/.pnpm/google-auth-library@11.1.0/node_modules/google-auth-library/build/src/shared.cjs
var require_shared = /* @__PURE__ */ __commonJSMin(((exports) => {
	Object.defineProperty(exports, "__esModule", { value: true });
	exports.USER_AGENT = exports.PRODUCT_NAME = exports.pkg = void 0;
	const pkg = require_package$1();
	exports.pkg = pkg;
	const PRODUCT_NAME = "google-api-nodejs-client";
	exports.PRODUCT_NAME = PRODUCT_NAME;
	exports.USER_AGENT = `${PRODUCT_NAME}/${pkg.version}`;
}));
//#endregion
//#region ../../node_modules/.pnpm/google-auth-library@11.1.0/node_modules/google-auth-library/build/src/auth/authclient.js
var require_authclient = /* @__PURE__ */ __commonJSMin(((exports) => {
	Object.defineProperty(exports, "__esModule", { value: true });
	exports.AuthClient = exports.DEFAULT_EAGER_REFRESH_THRESHOLD_MILLIS = exports.DEFAULT_UNIVERSE = void 0;
	const events_1 = __require("events");
	const gaxios_1 = require_src$4();
	const util_1 = require_util$1();
	const google_logging_utils_1 = require_src$3();
	const shared_cjs_1 = require_shared();
	/**
	* The default cloud universe
	*
	* @see {@link AuthJSONOptions.universe_domain}
	*/
	exports.DEFAULT_UNIVERSE = "googleapis.com";
	/**
	* The default {@link AuthClientOptions.eagerRefreshThresholdMillis}
	*/
	exports.DEFAULT_EAGER_REFRESH_THRESHOLD_MILLIS = 3e5;
	exports.AuthClient = class AuthClient extends events_1.EventEmitter {
		apiKey;
		projectId;
		/**
		* The quota project ID. The quota project can be used by client libraries for the billing purpose.
		* See {@link https://cloud.google.com/docs/quota Working with quotas}
		*/
		quotaProjectId;
		/**
		* The {@link Gaxios `Gaxios`} instance used for making requests.
		*/
		transporter;
		credentials = {};
		eagerRefreshThresholdMillis = exports.DEFAULT_EAGER_REFRESH_THRESHOLD_MILLIS;
		forceRefreshOnFailure = false;
		universeDomain = exports.DEFAULT_UNIVERSE;
		/**
		* Symbols that can be added to GaxiosOptions to specify the method name that is
		* making an RPC call, for logging purposes, as well as a string ID that can be
		* used to correlate calls and responses.
		*/
		static RequestMethodNameSymbol = Symbol("request method name");
		static RequestLogIdSymbol = Symbol("request log id");
		constructor(opts = {}) {
			super();
			const options = (0, util_1.originalOrCamelOptions)(opts);
			this.apiKey = opts.apiKey;
			this.projectId = options.get("project_id") ?? null;
			this.quotaProjectId = options.get("quota_project_id");
			this.credentials = options.get("credentials") ?? {};
			this.universeDomain = options.get("universe_domain") ?? exports.DEFAULT_UNIVERSE;
			this.transporter = opts.transporter ?? new gaxios_1.Gaxios(opts.transporterOptions);
			if (options.get("useAuthRequestParameters") !== false) {
				this.transporter.interceptors.request.add(AuthClient.DEFAULT_REQUEST_INTERCEPTOR);
				this.transporter.interceptors.response.add(AuthClient.DEFAULT_RESPONSE_INTERCEPTOR);
			}
			if (opts.eagerRefreshThresholdMillis) this.eagerRefreshThresholdMillis = opts.eagerRefreshThresholdMillis;
			this.forceRefreshOnFailure = opts.forceRefreshOnFailure ?? false;
		}
		/**
		* A {@link fetch `fetch`} compliant API for {@link AuthClient}.
		*
		* @see {@link AuthClient.request} for the classic method.
		*
		* @remarks
		*
		* This is useful as a drop-in replacement for `fetch` API usage.
		*
		* @example
		*
		* ```ts
		* const authClient = new AuthClient();
		* const fetchWithAuthClient: typeof fetch = (...args) => authClient.fetch(...args);
		* await fetchWithAuthClient('https://example.com');
		* ```
		*
		* @param args `fetch` API or {@link Gaxios.fetch `Gaxios#fetch`} parameters
		* @returns the {@link GaxiosResponse} with Gaxios-added properties
		*/
		fetch(...args) {
			const input = args[0];
			const init = args[1];
			let url = void 0;
			const headers = new Headers();
			if (typeof input === "string") url = new URL(input);
			else if (input instanceof URL) url = input;
			else if (input && input.url) url = new URL(input.url);
			if (input && typeof input === "object" && "headers" in input) gaxios_1.Gaxios.mergeHeaders(headers, input.headers);
			if (init) gaxios_1.Gaxios.mergeHeaders(headers, new Headers(init.headers));
			if (typeof input === "object" && !(input instanceof URL)) return this.request({
				...init,
				...input,
				headers,
				url
			});
			else return this.request({
				...init,
				headers,
				url
			});
		}
		/**
		* Sets the auth credentials.
		*/
		setCredentials(credentials) {
			this.credentials = credentials;
		}
		/**
		* Append additional headers, e.g., x-goog-user-project, shared across the
		* classes inheriting AuthClient. This method should be used by any method
		* that overrides getRequestMetadataAsync(), which is a shared helper for
		* setting request information in both gRPC and HTTP API calls.
		*
		* @param headers object to append additional headers to.
		*/
		addSharedMetadataHeaders(headers) {
			if (!headers.has("x-goog-user-project") && this.quotaProjectId) headers.set("x-goog-user-project", this.quotaProjectId);
			return headers;
		}
		/**
		* Adds the `x-goog-user-project` and `authorization` headers to the target Headers
		* object, if they exist on the source.
		*
		* @param target the headers to target
		* @param source the headers to source from
		* @returns the target headers
		*/
		addUserProjectAndAuthHeaders(target, source) {
			const xGoogUserProject = source.get("x-goog-user-project");
			const authorizationHeader = source.get("authorization");
			if (xGoogUserProject) target.set("x-goog-user-project", xGoogUserProject);
			if (authorizationHeader) target.set("authorization", authorizationHeader);
			return target;
		}
		static log = (0, google_logging_utils_1.log)("auth");
		static DEFAULT_REQUEST_INTERCEPTOR = { resolved: async (config) => {
			if (!config.headers.has("x-goog-api-client")) {
				const nodeVersion = process.version.replace(/^v/, "");
				config.headers.set("x-goog-api-client", `gl-node/${nodeVersion}`);
			}
			const userAgent = config.headers.get("User-Agent");
			if (!userAgent) config.headers.set("User-Agent", shared_cjs_1.USER_AGENT);
			else if (!userAgent.includes(`${shared_cjs_1.PRODUCT_NAME}/`)) config.headers.set("User-Agent", `${userAgent} ${shared_cjs_1.USER_AGENT}`);
			try {
				const symbols = config;
				const methodName = symbols[AuthClient.RequestMethodNameSymbol];
				const logId = `${Math.floor(Math.random() * 1e3)}`;
				symbols[AuthClient.RequestLogIdSymbol] = logId;
				const logObject = {
					url: config.url,
					headers: config.headers
				};
				if (methodName) AuthClient.log.info("%s [%s] request %j", methodName, logId, logObject);
				else AuthClient.log.info("[%s] request %j", logId, logObject);
			} catch (e) {}
			return config;
		} };
		static DEFAULT_RESPONSE_INTERCEPTOR = {
			resolved: async (response) => {
				try {
					const symbols = response.config;
					const methodName = symbols[AuthClient.RequestMethodNameSymbol];
					const logId = symbols[AuthClient.RequestLogIdSymbol];
					if (methodName) AuthClient.log.info("%s [%s] response %j", methodName, logId, response.data);
					else AuthClient.log.info("[%s] response %j", logId, response.data);
				} catch (e) {}
				return response;
			},
			rejected: async (error) => {
				try {
					const symbols = error.config;
					const methodName = symbols[AuthClient.RequestMethodNameSymbol];
					const logId = symbols[AuthClient.RequestLogIdSymbol];
					if (methodName) AuthClient.log.info("%s [%s] error %j", methodName, logId, error.response?.data);
					else AuthClient.log.error("[%s] error %j", logId, error.response?.data);
				} catch (e) {}
				throw error;
			}
		};
		/**
		* Sets the method name that is making a Gaxios request, so that logging may tag
		* log lines with the operation.
		* @param config A Gaxios request config
		* @param methodName The method name making the call
		*/
		static setMethodName(config, methodName) {
			try {
				const symbols = config;
				symbols[AuthClient.RequestMethodNameSymbol] = methodName;
			} catch (e) {}
		}
		/**
		* Retry config for Auth-related requests.
		*
		* @remarks
		*
		* This is not a part of the default {@link AuthClient.transporter transporter/gaxios}
		* config as some downstream APIs would prefer if customers explicitly enable retries,
		* such as GCS.
		*/
		static get RETRY_CONFIG() {
			return {
				retry: true,
				retryConfig: { httpMethodsToRetry: [
					"GET",
					"PUT",
					"POST",
					"HEAD",
					"OPTIONS",
					"DELETE"
				] }
			};
		}
	};
}));
//#endregion
//#region ../../node_modules/.pnpm/google-auth-library@11.1.0/node_modules/google-auth-library/build/src/auth/loginticket.js
var require_loginticket = /* @__PURE__ */ __commonJSMin(((exports) => {
	Object.defineProperty(exports, "__esModule", { value: true });
	exports.LoginTicket = void 0;
	var LoginTicket = class {
		envelope;
		payload;
		/**
		* Create a simple class to extract user ID from an ID Token
		*
		* @param {string} env Envelope of the jwt
		* @param {TokenPayload} pay Payload of the jwt
		* @constructor
		*/
		constructor(env, pay) {
			this.envelope = env;
			this.payload = pay;
		}
		getEnvelope() {
			return this.envelope;
		}
		getPayload() {
			return this.payload;
		}
		/**
		* Create a simple class to extract user ID from an ID Token
		*
		* @return The user ID
		*/
		getUserId() {
			const payload = this.getPayload();
			if (payload && payload.sub) return payload.sub;
			return null;
		}
		/**
		* Returns attributes from the login ticket.  This can contain
		* various information about the user session.
		*
		* @return The envelope and payload
		*/
		getAttributes() {
			return {
				envelope: this.getEnvelope(),
				payload: this.getPayload()
			};
		}
	};
	exports.LoginTicket = LoginTicket;
}));
//#endregion
//#region ../../node_modules/.pnpm/google-auth-library@11.1.0/node_modules/google-auth-library/build/src/auth/oauth2client.js
var require_oauth2client = /* @__PURE__ */ __commonJSMin(((exports) => {
	Object.defineProperty(exports, "__esModule", { value: true });
	exports.OAuth2Client = exports.ClientAuthentication = exports.CertificateFormat = exports.CodeChallengeMethod = void 0;
	const gaxios_1 = require_src$4();
	const querystring = __require("querystring");
	const stream$4 = __require("stream");
	const formatEcdsa = require_ecdsa_sig_formatter();
	const util_1 = require_util$1();
	const crypto_1 = require_crypto();
	const authclient_1 = require_authclient();
	const loginticket_1 = require_loginticket();
	var CodeChallengeMethod;
	(function(CodeChallengeMethod) {
		CodeChallengeMethod["Plain"] = "plain";
		CodeChallengeMethod["S256"] = "S256";
	})(CodeChallengeMethod || (exports.CodeChallengeMethod = CodeChallengeMethod = {}));
	var CertificateFormat;
	(function(CertificateFormat) {
		CertificateFormat["PEM"] = "PEM";
		CertificateFormat["JWK"] = "JWK";
	})(CertificateFormat || (exports.CertificateFormat = CertificateFormat = {}));
	/**
	* The client authentication type. Supported values are basic, post, and none.
	* https://datatracker.ietf.org/doc/html/rfc7591#section-2
	*/
	var ClientAuthentication;
	(function(ClientAuthentication) {
		ClientAuthentication["ClientSecretPost"] = "ClientSecretPost";
		ClientAuthentication["ClientSecretBasic"] = "ClientSecretBasic";
		ClientAuthentication["None"] = "None";
	})(ClientAuthentication || (exports.ClientAuthentication = ClientAuthentication = {}));
	exports.OAuth2Client = class OAuth2Client extends authclient_1.AuthClient {
		redirectUri;
		certificateCache = {};
		certificateExpiry = null;
		certificateCacheFormat = CertificateFormat.PEM;
		refreshTokenPromises = /* @__PURE__ */ new Map();
		endpoints;
		issuers;
		clientAuthentication;
		_clientId;
		_clientSecret;
		refreshHandler;
		/**
		* An OAuth2 Client for Google APIs.
		*
		* @param options The OAuth2 Client Options. Passing an `clientId` directly is **@DEPRECATED**.
		* @param clientSecret **@DEPRECATED**. Provide a {@link OAuth2ClientOptions `OAuth2ClientOptions`} object in the first parameter instead.
		* @param redirectUri **@DEPRECATED**. Provide a {@link OAuth2ClientOptions `OAuth2ClientOptions`} object in the first parameter instead.
		*/
		constructor(options = {}, clientSecret, redirectUri) {
			super(typeof options === "object" ? options : {});
			if (typeof options !== "object") options = {
				clientId: options,
				clientSecret,
				redirectUri
			};
			this._clientId = options.clientId || options.client_id;
			this._clientSecret = options.clientSecret || options.client_secret;
			this.redirectUri = options.redirectUri || options.redirect_uris?.[0];
			this.endpoints = {
				tokenInfoUrl: "https://oauth2.googleapis.com/tokeninfo",
				oauth2AuthBaseUrl: "https://accounts.google.com/o/oauth2/v2/auth",
				oauth2TokenUrl: "https://oauth2.googleapis.com/token",
				oauth2RevokeUrl: "https://oauth2.googleapis.com/revoke",
				oauth2FederatedSignonPemCertsUrl: "https://www.googleapis.com/oauth2/v1/certs",
				oauth2FederatedSignonJwkCertsUrl: "https://www.googleapis.com/oauth2/v3/certs",
				oauth2IapPublicKeyUrl: "https://www.gstatic.com/iap/verify/public_key",
				...options.endpoints
			};
			this.clientAuthentication = options.clientAuthentication || ClientAuthentication.ClientSecretPost;
			this.issuers = options.issuers || [
				"accounts.google.com",
				"https://accounts.google.com",
				this.universeDomain
			];
		}
		/**
		* @deprecated use instance's {@link OAuth2Client.endpoints}
		*/
		static GOOGLE_TOKEN_INFO_URL = "https://oauth2.googleapis.com/tokeninfo";
		/**
		* Clock skew - five minutes in seconds
		*/
		static CLOCK_SKEW_SECS_ = 300;
		/**
		* The default max Token Lifetime is one day in seconds
		*/
		static DEFAULT_MAX_TOKEN_LIFETIME_SECS_ = 86400;
		/**
		* Generates URL for consent page landing.
		* @param opts Options.
		* @return URL to consent page.
		*/
		generateAuthUrl(opts = {}) {
			if (opts.code_challenge_method && !opts.code_challenge) throw new Error("If a code_challenge_method is provided, code_challenge must be included.");
			opts.response_type = opts.response_type || "code";
			opts.client_id = opts.client_id || this._clientId;
			opts.redirect_uri = opts.redirect_uri || this.redirectUri;
			if (Array.isArray(opts.scope)) opts.scope = opts.scope.join(" ");
			return this.endpoints.oauth2AuthBaseUrl.toString() + "?" + querystring.stringify(opts);
		}
		generateCodeVerifier() {
			throw new Error("generateCodeVerifier is removed, please use generateCodeVerifierAsync instead.");
		}
		/**
		* Convenience method to automatically generate a code_verifier, and its
		* resulting SHA256. If used, this must be paired with a S256
		* code_challenge_method.
		*
		* For a full example see:
		* https://github.com/googleapis/google-auth-library-nodejs/blob/main/samples/oauth2-codeVerifier.js
		*/
		async generateCodeVerifierAsync() {
			const crypto = (0, crypto_1.createCrypto)();
			const codeVerifier = crypto.randomBytesBase64(96).replace(/\+/g, "~").replace(/=/g, "_").replace(/\//g, "-");
			return {
				codeVerifier,
				codeChallenge: (await crypto.sha256DigestBase64(codeVerifier)).split("=")[0].replace(/\+/g, "-").replace(/\//g, "_")
			};
		}
		getToken(codeOrOptions, callback) {
			const options = typeof codeOrOptions === "string" ? { code: codeOrOptions } : codeOrOptions;
			if (callback) this.getTokenAsync(options).then((r) => callback(null, r.tokens, r.res), (e) => callback(e, null, e.response));
			else return this.getTokenAsync(options);
		}
		async getTokenAsync(options) {
			const url = this.endpoints.oauth2TokenUrl.toString();
			const headers = new Headers();
			const values = {
				client_id: options.client_id || this._clientId,
				code_verifier: options.codeVerifier,
				code: options.code,
				grant_type: "authorization_code",
				redirect_uri: options.redirect_uri || this.redirectUri
			};
			if (this.clientAuthentication === ClientAuthentication.ClientSecretBasic) {
				const basic = Buffer.from(`${this._clientId}:${this._clientSecret}`);
				headers.set("authorization", `Basic ${basic.toString("base64")}`);
			}
			if (this.clientAuthentication === ClientAuthentication.ClientSecretPost) values.client_secret = this._clientSecret;
			const opts = {
				...OAuth2Client.RETRY_CONFIG,
				method: "POST",
				url,
				data: new URLSearchParams((0, util_1.removeUndefinedValuesInObject)(values)),
				headers
			};
			authclient_1.AuthClient.setMethodName(opts, "getTokenAsync");
			const res = await this.transporter.request(opts);
			const tokens = res.data;
			if (res.data && res.data.expires_in) {
				tokens.expiry_date = (/* @__PURE__ */ new Date()).getTime() + res.data.expires_in * 1e3;
				delete tokens.expires_in;
			}
			this.emit("tokens", tokens);
			return {
				tokens,
				res
			};
		}
		/**
		* Refreshes the access token.
		* @param refresh_token Existing refresh token.
		* @private
		*/
		async refreshToken(refreshToken) {
			if (!refreshToken) return this.refreshTokenNoCache(refreshToken);
			if (this.refreshTokenPromises.has(refreshToken)) return this.refreshTokenPromises.get(refreshToken);
			const p = this.refreshTokenNoCache(refreshToken).then((r) => {
				this.refreshTokenPromises.delete(refreshToken);
				return r;
			}, (e) => {
				this.refreshTokenPromises.delete(refreshToken);
				throw e;
			});
			this.refreshTokenPromises.set(refreshToken, p);
			return p;
		}
		async refreshTokenNoCache(refreshToken) {
			if (!refreshToken) throw new Error("No refresh token is set.");
			const url = this.endpoints.oauth2TokenUrl.toString();
			const data = {
				refresh_token: refreshToken,
				client_id: this._clientId,
				client_secret: this._clientSecret,
				grant_type: "refresh_token"
			};
			let res;
			try {
				const opts = {
					...OAuth2Client.RETRY_CONFIG,
					method: "POST",
					url,
					data: new URLSearchParams((0, util_1.removeUndefinedValuesInObject)(data))
				};
				authclient_1.AuthClient.setMethodName(opts, "refreshTokenNoCache");
				res = await this.transporter.request(opts);
			} catch (e) {
				if (e instanceof gaxios_1.GaxiosError && e.message === "invalid_grant" && e.response?.data && /ReAuth/i.test(e.response.data.error_description)) e.message = JSON.stringify(e.response.data);
				throw e;
			}
			const tokens = res.data;
			if (res.data && res.data.expires_in) {
				tokens.expiry_date = (/* @__PURE__ */ new Date()).getTime() + res.data.expires_in * 1e3;
				delete tokens.expires_in;
			}
			this.emit("tokens", tokens);
			return {
				tokens,
				res
			};
		}
		refreshAccessToken(callback) {
			if (callback) this.refreshAccessTokenAsync().then((r) => callback(null, r.credentials, r.res), callback);
			else return this.refreshAccessTokenAsync();
		}
		async refreshAccessTokenAsync() {
			const r = await this.refreshToken(this.credentials.refresh_token);
			const tokens = r.tokens;
			tokens.refresh_token = this.credentials.refresh_token;
			this.credentials = tokens;
			return {
				credentials: this.credentials,
				res: r.res
			};
		}
		getAccessToken(callback) {
			if (callback) this.getAccessTokenAsync().then((r) => callback(null, r.token, r.res), callback);
			else return this.getAccessTokenAsync();
		}
		async getAccessTokenAsync() {
			if (!this.credentials.access_token || this.isTokenExpiring()) {
				if (!this.credentials.refresh_token) {
					if (this.refreshHandler) {
						const refreshedAccessToken = await this.processAndValidateRefreshHandler();
						if (refreshedAccessToken?.access_token) {
							this.setCredentials(refreshedAccessToken);
							return { token: this.credentials.access_token };
						}
					} else throw new Error("No refresh token or refresh handler callback is set.");
				}
				const r = await this.refreshAccessTokenAsync();
				if (!r.credentials || r.credentials && !r.credentials.access_token) throw new Error("Could not refresh access token.");
				return {
					token: r.credentials.access_token,
					res: r.res
				};
			} else return { token: this.credentials.access_token };
		}
		/**
		* The main authentication interface.  It takes an optional url which when
		* present is the endpoint being accessed, and returns a Promise which
		* resolves with authorization header fields.
		*
		* In OAuth2Client, the result has the form:
		* { authorization: 'Bearer <access_token_value>' }
		*/
		async getRequestHeaders(url) {
			return (await this.getRequestMetadataAsync(url)).headers;
		}
		async getRequestMetadataAsync(url) {
			const thisCreds = this.credentials;
			if (!thisCreds.access_token && !thisCreds.refresh_token && !this.apiKey && !this.refreshHandler) throw new Error("No access, refresh token, API key or refresh handler callback is set.");
			if (thisCreds.access_token && !this.isTokenExpiring()) {
				thisCreds.token_type = thisCreds.token_type || "Bearer";
				const headers = new Headers({ authorization: thisCreds.token_type + " " + thisCreds.access_token });
				return { headers: this.addSharedMetadataHeaders(headers) };
			}
			if (this.refreshHandler) {
				const refreshedAccessToken = await this.processAndValidateRefreshHandler();
				if (refreshedAccessToken?.access_token) {
					this.setCredentials(refreshedAccessToken);
					const headers = new Headers({ authorization: "Bearer " + this.credentials.access_token });
					return { headers: this.addSharedMetadataHeaders(headers) };
				}
			}
			if (this.apiKey) return { headers: new Headers({ "X-Goog-Api-Key": this.apiKey }) };
			let r = null;
			let tokens = null;
			try {
				r = await this.refreshToken(thisCreds.refresh_token);
				tokens = r.tokens;
			} catch (err) {
				const e = err;
				if (e.response && (e.response.status === 403 || e.response.status === 404)) e.message = `Could not refresh access token: ${e.message}`;
				throw e;
			}
			const credentials = this.credentials;
			credentials.token_type = credentials.token_type || "Bearer";
			tokens.refresh_token = credentials.refresh_token;
			this.credentials = tokens;
			const headers = new Headers({ authorization: credentials.token_type + " " + tokens.access_token });
			return {
				headers: this.addSharedMetadataHeaders(headers),
				res: r.res
			};
		}
		/**
		* Generates an URL to revoke the given token.
		* @param token The existing token to be revoked.
		*
		* @deprecated use instance method {@link OAuth2Client.getRevokeTokenURL}
		*/
		static getRevokeTokenUrl(token) {
			return new OAuth2Client().getRevokeTokenURL(token).toString();
		}
		/**
		* Generates a URL to revoke the given token.
		*
		* @param token The existing token to be revoked.
		*/
		getRevokeTokenURL(token) {
			const url = new URL(this.endpoints.oauth2RevokeUrl);
			url.searchParams.append("token", token);
			return url;
		}
		revokeToken(token, callback) {
			const opts = {
				...OAuth2Client.RETRY_CONFIG,
				url: this.getRevokeTokenURL(token).toString(),
				method: "POST"
			};
			authclient_1.AuthClient.setMethodName(opts, "revokeToken");
			if (callback) this.transporter.request(opts).then((r) => callback(null, r), callback);
			else return this.transporter.request(opts);
		}
		revokeCredentials(callback) {
			if (callback) this.revokeCredentialsAsync().then((res) => callback(null, res), callback);
			else return this.revokeCredentialsAsync();
		}
		async revokeCredentialsAsync() {
			const token = this.credentials.access_token;
			this.credentials = {};
			if (token) return this.revokeToken(token);
			else throw new Error("No access token to revoke.");
		}
		request(opts, callback) {
			if (callback) this.requestAsync(opts).then((r) => callback(null, r), (e) => {
				return callback(e, e.response);
			});
			else return this.requestAsync(opts);
		}
		async requestAsync(opts, reAuthRetried = false) {
			try {
				const r = await this.getRequestMetadataAsync();
				opts.headers = gaxios_1.Gaxios.mergeHeaders(opts.headers);
				this.addUserProjectAndAuthHeaders(opts.headers, r.headers);
				if (this.apiKey) opts.headers.set("X-Goog-Api-Key", this.apiKey);
				return await this.transporter.request(opts);
			} catch (e) {
				const res = e.response;
				if (res) {
					const statusCode = res.status;
					const mayRequireRefresh = this.credentials && this.credentials.access_token && this.credentials.refresh_token && (!this.credentials.expiry_date || this.forceRefreshOnFailure);
					const mayRequireRefreshWithNoRefreshToken = this.credentials && this.credentials.access_token && !this.credentials.refresh_token && (!this.credentials.expiry_date || this.forceRefreshOnFailure) && this.refreshHandler;
					const isReadableStream = res.config.data instanceof stream$4.Readable;
					const isAuthErr = statusCode === 401 || statusCode === 403;
					if (!reAuthRetried && isAuthErr && !isReadableStream && mayRequireRefresh) {
						await this.refreshAccessTokenAsync();
						return this.requestAsync(opts, true);
					} else if (!reAuthRetried && isAuthErr && !isReadableStream && mayRequireRefreshWithNoRefreshToken) {
						const refreshedAccessToken = await this.processAndValidateRefreshHandler();
						if (refreshedAccessToken?.access_token) this.setCredentials(refreshedAccessToken);
						return this.requestAsync(opts, true);
					}
				}
				throw e;
			}
		}
		verifyIdToken(options, callback) {
			if (callback && typeof callback !== "function") throw new Error("This method accepts an options object as the first parameter, which includes the idToken, audience, and maxExpiry.");
			if (callback) this.verifyIdTokenAsync(options).then((r) => callback(null, r), callback);
			else return this.verifyIdTokenAsync(options);
		}
		async verifyIdTokenAsync(options) {
			if (!options.idToken) throw new Error("The verifyIdToken method requires an ID Token");
			const response = await this.getFederatedSignonCertsAsync();
			return await this.verifySignedJwtWithCertsAsync(options.idToken, response.certs, options.audience, this.issuers, options.maxExpiry);
		}
		/**
		* Obtains information about the provisioned access token.  Especially useful
		* if you want to check the scopes that were provisioned to a given token.
		*
		* @param accessToken Required.  The Access Token for which you want to get
		* user info.
		*/
		async getTokenInfo(accessToken) {
			const { data } = await this.transporter.request({
				...OAuth2Client.RETRY_CONFIG,
				method: "POST",
				headers: {
					"content-type": "application/x-www-form-urlencoded;charset=UTF-8",
					authorization: `Bearer ${accessToken}`
				},
				url: this.endpoints.tokenInfoUrl.toString()
			});
			const info = Object.assign({
				expiry_date: (/* @__PURE__ */ new Date()).getTime() + data.expires_in * 1e3,
				scopes: data.scope.split(" ")
			}, data);
			delete info.expires_in;
			delete info.scope;
			return info;
		}
		getFederatedSignonCerts(callback) {
			if (callback) this.getFederatedSignonCertsAsync().then((r) => callback(null, r.certs, r.res), callback);
			else return this.getFederatedSignonCertsAsync();
		}
		async getFederatedSignonCertsAsync() {
			const nowTime = (/* @__PURE__ */ new Date()).getTime();
			const format = (0, crypto_1.hasBrowserCrypto)() ? CertificateFormat.JWK : CertificateFormat.PEM;
			if (this.certificateExpiry && nowTime < this.certificateExpiry.getTime() && this.certificateCacheFormat === format) return {
				certs: this.certificateCache,
				format
			};
			let res;
			let url;
			switch (format) {
				case CertificateFormat.PEM:
					url = this.endpoints.oauth2FederatedSignonPemCertsUrl.toString();
					break;
				case CertificateFormat.JWK:
					url = this.endpoints.oauth2FederatedSignonJwkCertsUrl.toString();
					break;
				default: throw new Error(`Unsupported certificate format ${format}`);
			}
			try {
				const opts = {
					...OAuth2Client.RETRY_CONFIG,
					url
				};
				authclient_1.AuthClient.setMethodName(opts, "getFederatedSignonCertsAsync");
				res = await this.transporter.request(opts);
			} catch (e) {
				if (e instanceof Error) e.message = `Failed to retrieve verification certificates: ${e.message}`;
				throw e;
			}
			const cacheControl = res?.headers.get("cache-control");
			let cacheAge = -1;
			if (cacheControl) {
				const maxAge = /max-age=(?<maxAge>[0-9]+)/.exec(cacheControl)?.groups?.maxAge;
				if (maxAge) cacheAge = Number(maxAge) * 1e3;
			}
			let certificates = {};
			switch (format) {
				case CertificateFormat.PEM:
					certificates = res.data;
					break;
				case CertificateFormat.JWK:
					for (const key of res.data.keys) certificates[key.kid] = key;
					break;
				default: throw new Error(`Unsupported certificate format ${format}`);
			}
			const now = /* @__PURE__ */ new Date();
			this.certificateExpiry = cacheAge === -1 ? null : new Date(now.getTime() + cacheAge);
			this.certificateCache = certificates;
			this.certificateCacheFormat = format;
			return {
				certs: certificates,
				format,
				res
			};
		}
		getIapPublicKeys(callback) {
			if (callback) this.getIapPublicKeysAsync().then((r) => callback(null, r.pubkeys, r.res), callback);
			else return this.getIapPublicKeysAsync();
		}
		async getIapPublicKeysAsync() {
			let res;
			const url = this.endpoints.oauth2IapPublicKeyUrl.toString();
			try {
				const opts = {
					...OAuth2Client.RETRY_CONFIG,
					url
				};
				authclient_1.AuthClient.setMethodName(opts, "getIapPublicKeysAsync");
				res = await this.transporter.request(opts);
			} catch (e) {
				if (e instanceof Error) e.message = `Failed to retrieve verification certificates: ${e.message}`;
				throw e;
			}
			return {
				pubkeys: res.data,
				res
			};
		}
		verifySignedJwtWithCerts() {
			throw new Error("verifySignedJwtWithCerts is removed, please use verifySignedJwtWithCertsAsync instead.");
		}
		/**
		* Verify the id token is signed with the correct certificate
		* and is from the correct audience.
		* @param jwt The jwt to verify (The ID Token in this case).
		* @param certs The array of certs to test the jwt against.
		* @param requiredAudience The audience to test the jwt against.
		* @param issuers The allowed issuers of the jwt (Optional).
		* @param maxExpiry The max expiry the certificate can be (Optional).
		* @return Returns a promise resolving to LoginTicket on verification.
		*/
		async verifySignedJwtWithCertsAsync(jwt, certs, requiredAudience, issuers, maxExpiry) {
			const crypto = (0, crypto_1.createCrypto)();
			if (!maxExpiry) maxExpiry = OAuth2Client.DEFAULT_MAX_TOKEN_LIFETIME_SECS_;
			const segments = jwt.split(".");
			if (segments.length !== 3) throw new Error("Wrong number of segments in token: " + jwt);
			const signed = segments[0] + "." + segments[1];
			let signature = segments[2];
			let envelope;
			let payload;
			try {
				envelope = JSON.parse(crypto.decodeBase64StringUtf8(segments[0]));
			} catch (err) {
				if (err instanceof Error) err.message = `Can't parse token envelope: ${segments[0]}': ${err.message}`;
				throw err;
			}
			if (!envelope) throw new Error("Can't parse token envelope: " + segments[0]);
			try {
				payload = JSON.parse(crypto.decodeBase64StringUtf8(segments[1]));
			} catch (err) {
				if (err instanceof Error) err.message = `Can't parse token payload '${segments[0]}`;
				throw err;
			}
			if (!payload) throw new Error("Can't parse token payload: " + segments[1]);
			if (!Object.prototype.hasOwnProperty.call(certs, envelope.kid)) throw new Error("No pem found for envelope: " + JSON.stringify(envelope));
			const cert = certs[envelope.kid];
			if (envelope.alg === "ES256") signature = formatEcdsa.joseToDer(signature, "ES256").toString("base64");
			if (!await crypto.verify(cert, signed, signature)) throw new Error("Invalid token signature: " + jwt);
			if (!payload.iat) throw new Error("No issue time in token: " + JSON.stringify(payload));
			if (!payload.exp) throw new Error("No expiration time in token: " + JSON.stringify(payload));
			const iat = Number(payload.iat);
			if (isNaN(iat)) throw new Error("iat field using invalid format");
			const exp = Number(payload.exp);
			if (isNaN(exp)) throw new Error("exp field using invalid format");
			const now = (/* @__PURE__ */ new Date()).getTime() / 1e3;
			if (exp >= now + maxExpiry) throw new Error("Expiration time too far in future: " + JSON.stringify(payload));
			const earliest = iat - OAuth2Client.CLOCK_SKEW_SECS_;
			const latest = exp + OAuth2Client.CLOCK_SKEW_SECS_;
			if (now < earliest) throw new Error("Token used too early, " + now + " < " + earliest + ": " + JSON.stringify(payload));
			if (now > latest) throw new Error("Token used too late, " + now + " > " + latest + ": " + JSON.stringify(payload));
			if (issuers && issuers.indexOf(payload.iss) < 0) throw new Error("Invalid issuer, expected one of [" + issuers + "], but got " + payload.iss);
			if (typeof requiredAudience !== "undefined" && requiredAudience !== null) {
				const aud = payload.aud;
				let audVerified = false;
				if (requiredAudience.constructor === Array) audVerified = requiredAudience.indexOf(aud) > -1;
				else audVerified = aud === requiredAudience;
				if (!audVerified) throw new Error("Wrong recipient, payload audience != requiredAudience");
			}
			return new loginticket_1.LoginTicket(envelope, payload);
		}
		/**
		* Returns a promise that resolves with AccessTokenResponse type if
		* refreshHandler is defined.
		* If not, nothing is returned.
		*/
		async processAndValidateRefreshHandler() {
			if (this.refreshHandler) {
				const accessTokenResponse = await this.refreshHandler();
				if (!accessTokenResponse.access_token) throw new Error("No access token is returned by the refreshHandler callback.");
				return accessTokenResponse;
			}
		}
		/**
		* Returns true if a token is expired or will expire within
		* eagerRefreshThresholdMillismilliseconds.
		* If there is no expiry time, assumes the token is not expired or expiring.
		*/
		isTokenExpiring() {
			const expiryDate = this.credentials.expiry_date;
			return expiryDate ? expiryDate <= (/* @__PURE__ */ new Date()).getTime() + this.eagerRefreshThresholdMillis : false;
		}
	};
}));
//#endregion
//#region ../../node_modules/.pnpm/google-auth-library@11.1.0/node_modules/google-auth-library/build/src/auth/computeclient.js
var require_computeclient = /* @__PURE__ */ __commonJSMin(((exports) => {
	Object.defineProperty(exports, "__esModule", { value: true });
	exports.Compute = void 0;
	const gaxios_1 = require_src$4();
	const gcpMetadata = require_src$2();
	const oauth2client_1 = require_oauth2client();
	var Compute = class extends oauth2client_1.OAuth2Client {
		serviceAccountEmail;
		scopes;
		/**
		* Google Compute Engine service account credentials.
		*
		* Retrieve access token from the metadata server.
		* See: https://cloud.google.com/compute/docs/access/authenticate-workloads#applications
		*/
		constructor(options = {}) {
			super(options);
			this.credentials = {
				expiry_date: 1,
				refresh_token: "compute-placeholder"
			};
			this.serviceAccountEmail = options.serviceAccountEmail || "default";
			this.scopes = Array.isArray(options.scopes) ? options.scopes : options.scopes ? [options.scopes] : [];
		}
		/**
		* Refreshes the access token.
		* @param refreshToken Unused parameter
		*/
		async refreshTokenNoCache() {
			const tokenPath = `service-accounts/${this.serviceAccountEmail}/token`;
			let data;
			try {
				const instanceOptions = { property: tokenPath };
				if (this.scopes.length > 0) instanceOptions.params = { scopes: this.scopes.join(",") };
				data = await gcpMetadata.instance(instanceOptions);
			} catch (e) {
				if (e instanceof gaxios_1.GaxiosError) {
					e.message = `Could not refresh access token: ${e.message}`;
					this.wrapError(e);
				}
				throw e;
			}
			const tokens = data;
			if (data && data.expires_in) {
				tokens.expiry_date = (/* @__PURE__ */ new Date()).getTime() + data.expires_in * 1e3;
				delete tokens.expires_in;
			}
			this.emit("tokens", tokens);
			return {
				tokens,
				res: null
			};
		}
		/**
		* Fetches an ID token.
		* @param targetAudience the audience for the fetched ID token.
		*/
		async fetchIdToken(targetAudience) {
			const idTokenPath = `service-accounts/${this.serviceAccountEmail}/identity?format=full&audience=${targetAudience}`;
			let idToken;
			try {
				const instanceOptions = { property: idTokenPath };
				idToken = await gcpMetadata.instance(instanceOptions);
			} catch (e) {
				if (e instanceof Error) e.message = `Could not fetch ID token: ${e.message}`;
				throw e;
			}
			return idToken;
		}
		wrapError(e) {
			const res = e.response;
			if (res && res.status) {
				e.status = res.status;
				if (res.status === 403) e.message = "A Forbidden error was returned while attempting to retrieve an access token for the Compute Engine built-in service account. This may be because the Compute Engine instance does not have the correct permission scopes specified: " + e.message;
				else if (res.status === 404) e.message = "A Not Found error was returned while attempting to retrieve an accesstoken for the Compute Engine built-in service account. This may be because the Compute Engine instance does not have any permission scopes specified: " + e.message;
			}
		}
	};
	exports.Compute = Compute;
}));
//#endregion
//#region ../../node_modules/.pnpm/google-auth-library@11.1.0/node_modules/google-auth-library/build/src/auth/idtokenclient.js
var require_idtokenclient = /* @__PURE__ */ __commonJSMin(((exports) => {
	Object.defineProperty(exports, "__esModule", { value: true });
	exports.IdTokenClient = void 0;
	const oauth2client_1 = require_oauth2client();
	var IdTokenClient = class extends oauth2client_1.OAuth2Client {
		targetAudience;
		idTokenProvider;
		/**
		* Google ID Token client
		*
		* Retrieve ID token from the metadata server.
		* See: https://cloud.google.com/docs/authentication/get-id-token#metadata-server
		*/
		constructor(options) {
			super(options);
			this.targetAudience = options.targetAudience;
			this.idTokenProvider = options.idTokenProvider;
		}
		async getRequestMetadataAsync() {
			if (!this.credentials.id_token || !this.credentials.expiry_date || this.isTokenExpiring()) {
				const idToken = await this.idTokenProvider.fetchIdToken(this.targetAudience);
				this.credentials = {
					id_token: idToken,
					expiry_date: this.getIdTokenExpiryDate(idToken)
				};
			}
			return { headers: new Headers({ authorization: "Bearer " + this.credentials.id_token }) };
		}
		getIdTokenExpiryDate(idToken) {
			const payloadB64 = idToken.split(".")[1];
			if (payloadB64) return JSON.parse(Buffer.from(payloadB64, "base64").toString("ascii")).exp * 1e3;
		}
	};
	exports.IdTokenClient = IdTokenClient;
}));
//#endregion
//#region ../../node_modules/.pnpm/google-auth-library@11.1.0/node_modules/google-auth-library/build/src/auth/envDetect.js
var require_envDetect = /* @__PURE__ */ __commonJSMin(((exports) => {
	Object.defineProperty(exports, "__esModule", { value: true });
	exports.GCPEnv = void 0;
	exports.clear = clear;
	exports.getEnv = getEnv;
	const gcpMetadata = require_src$2();
	var GCPEnv;
	(function(GCPEnv) {
		GCPEnv["APP_ENGINE"] = "APP_ENGINE";
		GCPEnv["KUBERNETES_ENGINE"] = "KUBERNETES_ENGINE";
		GCPEnv["CLOUD_FUNCTIONS"] = "CLOUD_FUNCTIONS";
		GCPEnv["COMPUTE_ENGINE"] = "COMPUTE_ENGINE";
		GCPEnv["CLOUD_RUN"] = "CLOUD_RUN";
		GCPEnv["CLOUD_RUN_JOBS"] = "CLOUD_RUN_JOBS";
		GCPEnv["NONE"] = "NONE";
	})(GCPEnv || (exports.GCPEnv = GCPEnv = {}));
	let envPromise;
	function clear() {
		envPromise = void 0;
	}
	async function getEnv() {
		if (envPromise) return envPromise;
		envPromise = getEnvMemoized();
		return envPromise;
	}
	async function getEnvMemoized() {
		let env = GCPEnv.NONE;
		if (isAppEngine()) env = GCPEnv.APP_ENGINE;
		else if (isCloudFunction()) env = GCPEnv.CLOUD_FUNCTIONS;
		else if (await isComputeEngine()) {
			if (await isKubernetesEngine()) env = GCPEnv.KUBERNETES_ENGINE;
			else if (isCloudRun()) env = GCPEnv.CLOUD_RUN;
			else if (isCloudRunJob()) env = GCPEnv.CLOUD_RUN_JOBS;
			else env = GCPEnv.COMPUTE_ENGINE;
		} else env = GCPEnv.NONE;
		return env;
	}
	function isAppEngine() {
		return !!(process.env.GAE_SERVICE || process.env.GAE_MODULE_NAME);
	}
	function isCloudFunction() {
		return !!(process.env.FUNCTION_NAME || process.env.FUNCTION_TARGET);
	}
	/**
	* This check only verifies that the environment is running knative.
	* This must be run *after* checking for Kubernetes, otherwise it will
	* return a false positive.
	*/
	function isCloudRun() {
		return !!process.env.K_CONFIGURATION;
	}
	function isCloudRunJob() {
		return !!process.env.CLOUD_RUN_JOB;
	}
	async function isKubernetesEngine() {
		try {
			await gcpMetadata.instance("attributes/cluster-name");
			return true;
		} catch (e) {
			return false;
		}
	}
	async function isComputeEngine() {
		return gcpMetadata.isAvailable();
	}
}));
//#endregion
//#region ../../node_modules/.pnpm/jws@4.0.1/node_modules/jws/lib/data-stream.js
var require_data_stream = /* @__PURE__ */ __commonJSMin(((exports, module) => {
	var Buffer = require_safe_buffer().Buffer;
	var Stream$2 = __require("stream");
	var util$5 = __require("util");
	function DataStream(data) {
		this.buffer = null;
		this.writable = true;
		this.readable = true;
		if (!data) {
			this.buffer = Buffer.alloc(0);
			return this;
		}
		if (typeof data.pipe === "function") {
			this.buffer = Buffer.alloc(0);
			data.pipe(this);
			return this;
		}
		if (data.length || typeof data === "object") {
			this.buffer = data;
			this.writable = false;
			process.nextTick(function() {
				this.emit("end", data);
				this.readable = false;
				this.emit("close");
			}.bind(this));
			return this;
		}
		throw new TypeError("Unexpected data type (" + typeof data + ")");
	}
	util$5.inherits(DataStream, Stream$2);
	DataStream.prototype.write = function write(data) {
		this.buffer = Buffer.concat([this.buffer, Buffer.from(data)]);
		this.emit("data", data);
	};
	DataStream.prototype.end = function end(data) {
		if (data) this.write(data);
		this.emit("end", data);
		this.emit("close");
		this.writable = false;
		this.readable = false;
	};
	module.exports = DataStream;
}));
//#endregion
//#region ../../node_modules/.pnpm/buffer-equal-constant-time@1.0.1/node_modules/buffer-equal-constant-time/index.js
var require_buffer_equal_constant_time = /* @__PURE__ */ __commonJSMin(((exports, module) => {
	var Buffer$2 = __require("buffer").Buffer;
	var SlowBuffer = __require("buffer").SlowBuffer;
	module.exports = bufferEq;
	function bufferEq(a, b) {
		if (!Buffer$2.isBuffer(a) || !Buffer$2.isBuffer(b)) return false;
		if (a.length !== b.length) return false;
		var c = 0;
		for (var i = 0; i < a.length; i++) c |= a[i] ^ b[i];
		return c === 0;
	}
	bufferEq.install = function() {
		Buffer$2.prototype.equal = SlowBuffer.prototype.equal = function equal(that) {
			return bufferEq(this, that);
		};
	};
	var origBufEqual = Buffer$2.prototype.equal;
	var origSlowBufEqual = SlowBuffer.prototype.equal;
	bufferEq.restore = function() {
		Buffer$2.prototype.equal = origBufEqual;
		SlowBuffer.prototype.equal = origSlowBufEqual;
	};
}));
//#endregion
//#region ../../node_modules/.pnpm/jwa@2.0.1/node_modules/jwa/index.js
var require_jwa = /* @__PURE__ */ __commonJSMin(((exports, module) => {
	var Buffer = require_safe_buffer().Buffer;
	var crypto$3 = __require("crypto");
	var formatEcdsa = require_ecdsa_sig_formatter();
	var util$4 = __require("util");
	var MSG_INVALID_ALGORITHM = "\"%s\" is not a valid algorithm.\n  Supported algorithms are:\n  \"HS256\", \"HS384\", \"HS512\", \"RS256\", \"RS384\", \"RS512\", \"PS256\", \"PS384\", \"PS512\", \"ES256\", \"ES384\", \"ES512\" and \"none\".";
	var MSG_INVALID_SECRET = "secret must be a string or buffer";
	var MSG_INVALID_VERIFIER_KEY = "key must be a string or a buffer";
	var MSG_INVALID_SIGNER_KEY = "key must be a string, a buffer or an object";
	var supportsKeyObjects = typeof crypto$3.createPublicKey === "function";
	if (supportsKeyObjects) {
		MSG_INVALID_VERIFIER_KEY += " or a KeyObject";
		MSG_INVALID_SECRET += "or a KeyObject";
	}
	function checkIsPublicKey(key) {
		if (Buffer.isBuffer(key)) return;
		if (typeof key === "string") return;
		if (!supportsKeyObjects) throw typeError(MSG_INVALID_VERIFIER_KEY);
		if (typeof key !== "object") throw typeError(MSG_INVALID_VERIFIER_KEY);
		if (typeof key.type !== "string") throw typeError(MSG_INVALID_VERIFIER_KEY);
		if (typeof key.asymmetricKeyType !== "string") throw typeError(MSG_INVALID_VERIFIER_KEY);
		if (typeof key.export !== "function") throw typeError(MSG_INVALID_VERIFIER_KEY);
	}
	function checkIsPrivateKey(key) {
		if (Buffer.isBuffer(key)) return;
		if (typeof key === "string") return;
		if (typeof key === "object") return;
		throw typeError(MSG_INVALID_SIGNER_KEY);
	}
	function checkIsSecretKey(key) {
		if (Buffer.isBuffer(key)) return;
		if (typeof key === "string") return key;
		if (!supportsKeyObjects) throw typeError(MSG_INVALID_SECRET);
		if (typeof key !== "object") throw typeError(MSG_INVALID_SECRET);
		if (key.type !== "secret") throw typeError(MSG_INVALID_SECRET);
		if (typeof key.export !== "function") throw typeError(MSG_INVALID_SECRET);
	}
	function fromBase64(base64) {
		return base64.replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
	}
	function toBase64(base64url) {
		base64url = base64url.toString();
		var padding = 4 - base64url.length % 4;
		if (padding !== 4) for (var i = 0; i < padding; ++i) base64url += "=";
		return base64url.replace(/\-/g, "+").replace(/_/g, "/");
	}
	function typeError(template) {
		var args = [].slice.call(arguments, 1);
		var errMsg = util$4.format.bind(util$4, template).apply(null, args);
		return new TypeError(errMsg);
	}
	function bufferOrString(obj) {
		return Buffer.isBuffer(obj) || typeof obj === "string";
	}
	function normalizeInput(thing) {
		if (!bufferOrString(thing)) thing = JSON.stringify(thing);
		return thing;
	}
	function createHmacSigner(bits) {
		return function sign(thing, secret) {
			checkIsSecretKey(secret);
			thing = normalizeInput(thing);
			var hmac = crypto$3.createHmac("sha" + bits, secret);
			return fromBase64((hmac.update(thing), hmac.digest("base64")));
		};
	}
	var bufferEqual;
	var timingSafeEqual = "timingSafeEqual" in crypto$3 ? function timingSafeEqual(a, b) {
		if (a.byteLength !== b.byteLength) return false;
		return crypto$3.timingSafeEqual(a, b);
	} : function timingSafeEqual(a, b) {
		if (!bufferEqual) bufferEqual = require_buffer_equal_constant_time();
		return bufferEqual(a, b);
	};
	function createHmacVerifier(bits) {
		return function verify(thing, signature, secret) {
			var computedSig = createHmacSigner(bits)(thing, secret);
			return timingSafeEqual(Buffer.from(signature), Buffer.from(computedSig));
		};
	}
	function createKeySigner(bits) {
		return function sign(thing, privateKey) {
			checkIsPrivateKey(privateKey);
			thing = normalizeInput(thing);
			var signer = crypto$3.createSign("RSA-SHA" + bits);
			return fromBase64((signer.update(thing), signer.sign(privateKey, "base64")));
		};
	}
	function createKeyVerifier(bits) {
		return function verify(thing, signature, publicKey) {
			checkIsPublicKey(publicKey);
			thing = normalizeInput(thing);
			signature = toBase64(signature);
			var verifier = crypto$3.createVerify("RSA-SHA" + bits);
			verifier.update(thing);
			return verifier.verify(publicKey, signature, "base64");
		};
	}
	function createPSSKeySigner(bits) {
		return function sign(thing, privateKey) {
			checkIsPrivateKey(privateKey);
			thing = normalizeInput(thing);
			var signer = crypto$3.createSign("RSA-SHA" + bits);
			return fromBase64((signer.update(thing), signer.sign({
				key: privateKey,
				padding: crypto$3.constants.RSA_PKCS1_PSS_PADDING,
				saltLength: crypto$3.constants.RSA_PSS_SALTLEN_DIGEST
			}, "base64")));
		};
	}
	function createPSSKeyVerifier(bits) {
		return function verify(thing, signature, publicKey) {
			checkIsPublicKey(publicKey);
			thing = normalizeInput(thing);
			signature = toBase64(signature);
			var verifier = crypto$3.createVerify("RSA-SHA" + bits);
			verifier.update(thing);
			return verifier.verify({
				key: publicKey,
				padding: crypto$3.constants.RSA_PKCS1_PSS_PADDING,
				saltLength: crypto$3.constants.RSA_PSS_SALTLEN_DIGEST
			}, signature, "base64");
		};
	}
	function createECDSASigner(bits) {
		var inner = createKeySigner(bits);
		return function sign() {
			var signature = inner.apply(null, arguments);
			signature = formatEcdsa.derToJose(signature, "ES" + bits);
			return signature;
		};
	}
	function createECDSAVerifer(bits) {
		var inner = createKeyVerifier(bits);
		return function verify(thing, signature, publicKey) {
			signature = formatEcdsa.joseToDer(signature, "ES" + bits).toString("base64");
			return inner(thing, signature, publicKey);
		};
	}
	function createNoneSigner() {
		return function sign() {
			return "";
		};
	}
	function createNoneVerifier() {
		return function verify(thing, signature) {
			return signature === "";
		};
	}
	module.exports = function jwa(algorithm) {
		var signerFactories = {
			hs: createHmacSigner,
			rs: createKeySigner,
			ps: createPSSKeySigner,
			es: createECDSASigner,
			none: createNoneSigner
		};
		var verifierFactories = {
			hs: createHmacVerifier,
			rs: createKeyVerifier,
			ps: createPSSKeyVerifier,
			es: createECDSAVerifer,
			none: createNoneVerifier
		};
		var match = algorithm.match(/^(RS|PS|ES|HS)(256|384|512)$|^(none)$/);
		if (!match) throw typeError(MSG_INVALID_ALGORITHM, algorithm);
		var algo = (match[1] || match[3]).toLowerCase();
		var bits = match[2];
		return {
			sign: signerFactories[algo](bits),
			verify: verifierFactories[algo](bits)
		};
	};
}));
//#endregion
//#region ../../node_modules/.pnpm/jws@4.0.1/node_modules/jws/lib/tostring.js
var require_tostring = /* @__PURE__ */ __commonJSMin(((exports, module) => {
	var Buffer$1 = __require("buffer").Buffer;
	module.exports = function toString(obj) {
		if (typeof obj === "string") return obj;
		if (typeof obj === "number" || Buffer$1.isBuffer(obj)) return obj.toString();
		return JSON.stringify(obj);
	};
}));
//#endregion
//#region ../../node_modules/.pnpm/jws@4.0.1/node_modules/jws/lib/sign-stream.js
var require_sign_stream = /* @__PURE__ */ __commonJSMin(((exports, module) => {
	var Buffer = require_safe_buffer().Buffer;
	var DataStream = require_data_stream();
	var jwa = require_jwa();
	var Stream$1 = __require("stream");
	var toString = require_tostring();
	var util$3 = __require("util");
	function base64url(string, encoding) {
		return Buffer.from(string, encoding).toString("base64").replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
	}
	function jwsSecuredInput(header, payload, encoding) {
		encoding = encoding || "utf8";
		var encodedHeader = base64url(toString(header), "binary");
		var encodedPayload = base64url(toString(payload), encoding);
		return util$3.format("%s.%s", encodedHeader, encodedPayload);
	}
	function jwsSign(opts) {
		var header = opts.header;
		var payload = opts.payload;
		var secretOrKey = opts.secret || opts.privateKey;
		var encoding = opts.encoding;
		var algo = jwa(header.alg);
		var securedInput = jwsSecuredInput(header, payload, encoding);
		var signature = algo.sign(securedInput, secretOrKey);
		return util$3.format("%s.%s", securedInput, signature);
	}
	function SignStream(opts) {
		var secret = opts.secret;
		secret = secret == null ? opts.privateKey : secret;
		secret = secret == null ? opts.key : secret;
		if (/^hs/i.test(opts.header.alg) === true && secret == null) throw new TypeError("secret must be a string or buffer or a KeyObject");
		var secretStream = new DataStream(secret);
		this.readable = true;
		this.header = opts.header;
		this.encoding = opts.encoding;
		this.secret = this.privateKey = this.key = secretStream;
		this.payload = new DataStream(opts.payload);
		this.secret.once("close", function() {
			if (!this.payload.writable && this.readable) this.sign();
		}.bind(this));
		this.payload.once("close", function() {
			if (!this.secret.writable && this.readable) this.sign();
		}.bind(this));
	}
	util$3.inherits(SignStream, Stream$1);
	SignStream.prototype.sign = function sign() {
		try {
			var signature = jwsSign({
				header: this.header,
				payload: this.payload.buffer,
				secret: this.secret.buffer,
				encoding: this.encoding
			});
			this.emit("done", signature);
			this.emit("data", signature);
			this.emit("end");
			this.readable = false;
			return signature;
		} catch (e) {
			this.readable = false;
			this.emit("error", e);
			this.emit("close");
		}
	};
	SignStream.sign = jwsSign;
	module.exports = SignStream;
}));
//#endregion
//#region ../../node_modules/.pnpm/jws@4.0.1/node_modules/jws/lib/verify-stream.js
var require_verify_stream = /* @__PURE__ */ __commonJSMin(((exports, module) => {
	var Buffer = require_safe_buffer().Buffer;
	var DataStream = require_data_stream();
	var jwa = require_jwa();
	var Stream = __require("stream");
	var toString = require_tostring();
	var util$2 = __require("util");
	var JWS_REGEX = /^[a-zA-Z0-9\-_]+?\.[a-zA-Z0-9\-_]+?\.([a-zA-Z0-9\-_]+)?$/;
	function isObject(thing) {
		return Object.prototype.toString.call(thing) === "[object Object]";
	}
	function safeJsonParse(thing) {
		if (isObject(thing)) return thing;
		try {
			return JSON.parse(thing);
		} catch (e) {
			return;
		}
	}
	function headerFromJWS(jwsSig) {
		var encodedHeader = jwsSig.split(".", 1)[0];
		return safeJsonParse(Buffer.from(encodedHeader, "base64").toString("binary"));
	}
	function securedInputFromJWS(jwsSig) {
		return jwsSig.split(".", 2).join(".");
	}
	function signatureFromJWS(jwsSig) {
		return jwsSig.split(".")[2];
	}
	function payloadFromJWS(jwsSig, encoding) {
		encoding = encoding || "utf8";
		var payload = jwsSig.split(".")[1];
		return Buffer.from(payload, "base64").toString(encoding);
	}
	function isValidJws(string) {
		return JWS_REGEX.test(string) && !!headerFromJWS(string);
	}
	function jwsVerify(jwsSig, algorithm, secretOrKey) {
		if (!algorithm) {
			var err = /* @__PURE__ */ new Error("Missing algorithm parameter for jws.verify");
			err.code = "MISSING_ALGORITHM";
			throw err;
		}
		jwsSig = toString(jwsSig);
		var signature = signatureFromJWS(jwsSig);
		var securedInput = securedInputFromJWS(jwsSig);
		return jwa(algorithm).verify(securedInput, signature, secretOrKey);
	}
	function jwsDecode(jwsSig, opts) {
		opts = opts || {};
		jwsSig = toString(jwsSig);
		if (!isValidJws(jwsSig)) return null;
		var header = headerFromJWS(jwsSig);
		if (!header) return null;
		var payload = payloadFromJWS(jwsSig);
		if (header.typ === "JWT" || opts.json) payload = JSON.parse(payload, opts.encoding);
		return {
			header,
			payload,
			signature: signatureFromJWS(jwsSig)
		};
	}
	function VerifyStream(opts) {
		opts = opts || {};
		var secretOrKey = opts.secret;
		secretOrKey = secretOrKey == null ? opts.publicKey : secretOrKey;
		secretOrKey = secretOrKey == null ? opts.key : secretOrKey;
		if (/^hs/i.test(opts.algorithm) === true && secretOrKey == null) throw new TypeError("secret must be a string or buffer or a KeyObject");
		var secretStream = new DataStream(secretOrKey);
		this.readable = true;
		this.algorithm = opts.algorithm;
		this.encoding = opts.encoding;
		this.secret = this.publicKey = this.key = secretStream;
		this.signature = new DataStream(opts.signature);
		this.secret.once("close", function() {
			if (!this.signature.writable && this.readable) this.verify();
		}.bind(this));
		this.signature.once("close", function() {
			if (!this.secret.writable && this.readable) this.verify();
		}.bind(this));
	}
	util$2.inherits(VerifyStream, Stream);
	VerifyStream.prototype.verify = function verify() {
		try {
			var valid = jwsVerify(this.signature.buffer, this.algorithm, this.key.buffer);
			var obj = jwsDecode(this.signature.buffer, this.encoding);
			this.emit("done", valid, obj);
			this.emit("data", valid);
			this.emit("end");
			this.readable = false;
			return valid;
		} catch (e) {
			this.readable = false;
			this.emit("error", e);
			this.emit("close");
		}
	};
	VerifyStream.decode = jwsDecode;
	VerifyStream.isValid = isValidJws;
	VerifyStream.verify = jwsVerify;
	module.exports = VerifyStream;
}));
//#endregion
//#region ../../node_modules/.pnpm/jws@4.0.1/node_modules/jws/index.js
var require_jws = /* @__PURE__ */ __commonJSMin(((exports) => {
	var SignStream = require_sign_stream();
	var VerifyStream = require_verify_stream();
	exports.ALGORITHMS = [
		"HS256",
		"HS384",
		"HS512",
		"RS256",
		"RS384",
		"RS512",
		"PS256",
		"PS384",
		"PS512",
		"ES256",
		"ES384",
		"ES512"
	];
	exports.sign = SignStream.sign;
	exports.verify = VerifyStream.verify;
	exports.decode = VerifyStream.decode;
	exports.isValid = VerifyStream.isValid;
	exports.createSign = function createSign(opts) {
		return new SignStream(opts);
	};
	exports.createVerify = function createVerify(opts) {
		return new VerifyStream(opts);
	};
}));
//#endregion
//#region ../../node_modules/.pnpm/google-auth-library@11.1.0/node_modules/google-auth-library/build/src/gtoken/jwsSign.js
var require_jwsSign = /* @__PURE__ */ __commonJSMin(((exports) => {
	Object.defineProperty(exports, "__esModule", { value: true });
	exports.buildPayloadForJwsSign = buildPayloadForJwsSign;
	exports.getJwsSign = getJwsSign;
	const jws_1 = require_jws();
	/** The default algorithm for signing JWTs. */
	const ALG_RS256 = "RS256";
	/** The URL for Google's OAuth 2.0 token endpoint. */
	const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
	/**
	* Builds the JWT payload for signing.
	* @param tokenOptions The options for the token.
	* @returns The JWT payload.
	*/
	function buildPayloadForJwsSign(tokenOptions) {
		const iat = Math.floor((/* @__PURE__ */ new Date()).getTime() / 1e3);
		return {
			iss: tokenOptions.iss,
			scope: tokenOptions.scope,
			aud: GOOGLE_TOKEN_URL,
			exp: iat + 3600,
			iat,
			sub: tokenOptions.sub,
			...tokenOptions.additionalClaims
		};
	}
	/**
	* Creates a signed JWS (JSON Web Signature).
	* @param tokenOptions The options for the token.
	* @returns The signed JWS.
	*/
	function getJwsSign(tokenOptions) {
		const payload = buildPayloadForJwsSign(tokenOptions);
		return (0, jws_1.sign)({
			header: { alg: ALG_RS256 },
			payload,
			secret: tokenOptions.key
		});
	}
}));
//#endregion
//#region ../../node_modules/.pnpm/google-auth-library@11.1.0/node_modules/google-auth-library/build/src/gtoken/getToken.js
var require_getToken = /* @__PURE__ */ __commonJSMin(((exports) => {
	Object.defineProperty(exports, "__esModule", { value: true });
	exports.getToken = getToken;
	const jwsSign_1 = require_jwsSign();
	/** The URL for Google's OAuth 2.0 token endpoint. */
	const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
	/** The grant type for JWT-based authorization. */
	const GOOGLE_GRANT_TYPE = "urn:ietf:params:oauth:grant-type:jwt-bearer";
	/**
	* Generates the request options for fetching a token.
	* @param tokenOptions The options for the token.
	* @returns The Gaxios options for the request.
	*/
	const generateRequestOptions = (tokenOptions) => {
		return {
			method: "POST",
			url: GOOGLE_TOKEN_URL,
			data: new URLSearchParams({
				grant_type: GOOGLE_GRANT_TYPE,
				assertion: (0, jwsSign_1.getJwsSign)(tokenOptions)
			}),
			responseType: "json",
			retryConfig: { httpMethodsToRetry: ["POST"] }
		};
	};
	/**
	* Fetches an access token.
	* @param tokenOptions The options for the token.
	* @returns A promise that resolves with the token data.
	*/
	async function getToken(tokenOptions) {
		if (!tokenOptions.transporter) throw new Error("No transporter set.");
		try {
			const gaxiosOptions = generateRequestOptions(tokenOptions);
			return (await tokenOptions.transporter.request(gaxiosOptions)).data;
		} catch (e) {
			const err = e;
			const errorData = err.response?.data;
			if (errorData?.error) err.message = `${errorData.error}: ${errorData.error_description}`;
			throw err;
		}
	}
}));
//#endregion
//#region ../../node_modules/.pnpm/google-auth-library@11.1.0/node_modules/google-auth-library/build/src/gtoken/errorWithCode.js
var require_errorWithCode = /* @__PURE__ */ __commonJSMin(((exports) => {
	Object.defineProperty(exports, "__esModule", { value: true });
	exports.ErrorWithCode = void 0;
	var ErrorWithCode = class extends Error {
		code;
		constructor(message, code) {
			super(message);
			this.code = code;
		}
	};
	exports.ErrorWithCode = ErrorWithCode;
}));
//#endregion
//#region ../../node_modules/.pnpm/google-auth-library@11.1.0/node_modules/google-auth-library/build/src/gtoken/getCredentials.js
var require_getCredentials = /* @__PURE__ */ __commonJSMin(((exports) => {
	Object.defineProperty(exports, "__esModule", { value: true });
	exports.getCredentials = getCredentials;
	const path$2 = __require("path");
	const fs$6 = __require("fs");
	const util_1$1 = __require("util");
	const errorWithCode_1 = require_errorWithCode();
	const readFile = fs$6.readFile ? (0, util_1$1.promisify)(fs$6.readFile) : async () => {
		throw new errorWithCode_1.ErrorWithCode("use key rather than keyFile.", "MISSING_CREDENTIALS");
	};
	var ExtensionFiles;
	(function(ExtensionFiles) {
		ExtensionFiles["JSON"] = ".json";
		ExtensionFiles["DER"] = ".der";
		ExtensionFiles["CRT"] = ".crt";
		ExtensionFiles["PEM"] = ".pem";
		ExtensionFiles["P12"] = ".p12";
		ExtensionFiles["PFX"] = ".pfx";
	})(ExtensionFiles || (ExtensionFiles = {}));
	/**
	* Provides credentials from a JSON key file.
	*/
	var JsonCredentialsProvider = class {
		keyFilePath;
		constructor(keyFilePath) {
			this.keyFilePath = keyFilePath;
		}
		/**
		* Reads a JSON key file and extracts the private key and client email.
		* @returns A promise that resolves with the credentials.
		*/
		async getCredentials() {
			const key = await readFile(this.keyFilePath, "utf8");
			let body;
			try {
				body = JSON.parse(key);
			} catch (error) {
				throw new Error(`Invalid JSON key file: ${error.message}`);
			}
			const privateKey = body.private_key;
			const clientEmail = body.client_email;
			if (!privateKey || !clientEmail) throw new errorWithCode_1.ErrorWithCode("private_key and client_email are required.", "MISSING_CREDENTIALS");
			return {
				privateKey,
				clientEmail
			};
		}
	};
	/**
	* Provides credentials from a PEM-like key file.
	*/
	var PemCredentialsProvider = class {
		keyFilePath;
		constructor(keyFilePath) {
			this.keyFilePath = keyFilePath;
		}
		/**
		* Reads a PEM-like key file.
		* @returns A promise that resolves with the private key.
		*/
		async getCredentials() {
			return { privateKey: await readFile(this.keyFilePath, "utf8") };
		}
	};
	/**
	* Handles unsupported P12/PFX certificate types.
	*/
	var P12CredentialsProvider = class {
		/**
		* Throws an error as P12/PFX certificates are not supported.
		* @returns A promise that rejects with an error.
		*/
		async getCredentials() {
			throw new errorWithCode_1.ErrorWithCode("*.p12 certificates are not supported after v6.1.2. Consider utilizing *.json format or converting *.p12 to *.pem using the OpenSSL CLI.", "UNKNOWN_CERTIFICATE_TYPE");
		}
	};
	/**
	* Factory class to create the appropriate credentials provider.
	*/
	var CredentialsProviderFactory = class {
		/**
		* Creates a credential provider based on the key file extension.
		* @param keyFilePath The path to the key file.
		* @returns An instance of a class that implements ICredentialsProvider.
		*/
		static create(keyFilePath) {
			switch (path$2.extname(keyFilePath)) {
				case ExtensionFiles.JSON: return new JsonCredentialsProvider(keyFilePath);
				case ExtensionFiles.DER:
				case ExtensionFiles.CRT:
				case ExtensionFiles.PEM: return new PemCredentialsProvider(keyFilePath);
				case ExtensionFiles.P12:
				case ExtensionFiles.PFX: return new P12CredentialsProvider();
				default: throw new errorWithCode_1.ErrorWithCode("Unknown certificate type. Type is determined based on file extension. Current supported extensions are *.json, and *.pem.", "UNKNOWN_CERTIFICATE_TYPE");
			}
		}
	};
	/**
	* Given a keyFile, extract the key and client email if available
	* @param keyFile Path to a json, pem, or p12 file that contains the key.
	* @returns an object with privateKey and clientEmail properties
	*/
	async function getCredentials(keyFilePath) {
		return CredentialsProviderFactory.create(keyFilePath).getCredentials();
	}
}));
//#endregion
//#region ../../node_modules/.pnpm/google-auth-library@11.1.0/node_modules/google-auth-library/build/src/gtoken/tokenHandler.js
var require_tokenHandler = /* @__PURE__ */ __commonJSMin(((exports) => {
	Object.defineProperty(exports, "__esModule", { value: true });
	exports.TokenHandler = void 0;
	const getToken_1 = require_getToken();
	const getCredentials_1 = require_getCredentials();
	/**
	* Manages the fetching and caching of access tokens.
	*/
	var TokenHandler = class {
		/** The cached access token. */
		token;
		/** The expiration time of the cached access token. */
		tokenExpiresAt;
		/** A promise for an in-flight token request. */
		inFlightRequest;
		tokenOptions;
		/**
		* Creates an instance of TokenHandler.
		* @param tokenOptions The options for fetching tokens.
		* @param transporter The transporter to use for making requests.
		*/
		constructor(tokenOptions) {
			this.tokenOptions = tokenOptions;
		}
		/**
		* Processes the credentials, loading them from a key file if necessary.
		* This method is called before any token request.
		*/
		async processCredentials() {
			if (!this.tokenOptions.key && !this.tokenOptions.keyFile) throw new Error("No key or keyFile set.");
			if (!this.tokenOptions.key && this.tokenOptions.keyFile) {
				const credentials = await (0, getCredentials_1.getCredentials)(this.tokenOptions.keyFile);
				this.tokenOptions.key = credentials.privateKey;
				this.tokenOptions.email = credentials.clientEmail;
			}
		}
		/**
		* Checks if the cached token is expired or close to expiring.
		* @returns True if the token is expiring, false otherwise.
		*/
		isTokenExpiring() {
			if (!this.token || !this.tokenExpiresAt) return true;
			const now = (/* @__PURE__ */ new Date()).getTime();
			const eagerRefreshThresholdMillis = this.tokenOptions.eagerRefreshThresholdMillis ?? 0;
			return this.tokenExpiresAt <= now + eagerRefreshThresholdMillis;
		}
		/**
		* Returns whether the token has completely expired.
		*
		* @returns true if the token has expired, false otherwise.
		*/
		hasExpired() {
			(/* @__PURE__ */ new Date()).getTime();
			if (this.token && this.tokenExpiresAt) return (/* @__PURE__ */ new Date()).getTime() >= this.tokenExpiresAt;
			return true;
		}
		/**
		* Fetches an access token, using a cached one if available and not expired.
		* @param forceRefresh If true, forces a new token to be fetched.
		* @returns A promise that resolves with the token data.
		*/
		async getToken(forceRefresh) {
			await this.processCredentials();
			if (this.inFlightRequest && !forceRefresh) return this.inFlightRequest;
			if (this.token && !this.isTokenExpiring() && !forceRefresh) return this.token;
			try {
				this.inFlightRequest = (0, getToken_1.getToken)(this.tokenOptions);
				const token = await this.inFlightRequest;
				this.token = token;
				this.tokenExpiresAt = (/* @__PURE__ */ new Date()).getTime() + (token.expires_in ?? 0) * 1e3;
				return token;
			} finally {
				this.inFlightRequest = void 0;
			}
		}
	};
	exports.TokenHandler = TokenHandler;
}));
//#endregion
//#region ../../node_modules/.pnpm/google-auth-library@11.1.0/node_modules/google-auth-library/build/src/gtoken/revokeToken.js
var require_revokeToken = /* @__PURE__ */ __commonJSMin(((exports) => {
	Object.defineProperty(exports, "__esModule", { value: true });
	exports.revokeToken = revokeToken;
	/** The URL for Google's OAuth 2.0 token revocation endpoint. */
	const GOOGLE_REVOKE_TOKEN_URL = "https://oauth2.googleapis.com/revoke?token=";
	/** The default retry behavior for the revoke token request. */
	const DEFAULT_RETRY_VALUE = true;
	/**
	* Revokes a given access token.
	* @param accessToken The access token to revoke.
	* @param transporter The transporter to make the request with.
	* @returns A promise that resolves with the revocation response.
	*/
	async function revokeToken(accessToken, transporter) {
		const url = GOOGLE_REVOKE_TOKEN_URL + accessToken;
		return await transporter.request({
			url,
			retry: DEFAULT_RETRY_VALUE
		});
	}
}));
//#endregion
//#region ../../node_modules/.pnpm/google-auth-library@11.1.0/node_modules/google-auth-library/build/src/gtoken/googleToken.js
var require_googleToken = /* @__PURE__ */ __commonJSMin(((exports) => {
	Object.defineProperty(exports, "__esModule", { value: true });
	exports.GoogleToken = void 0;
	const gaxios_1 = require_src$4();
	const tokenHandler_1 = require_tokenHandler();
	const revokeToken_1 = require_revokeToken();
	/**
	* The GoogleToken class is used to manage authentication with Google's OAuth 2.0 authorization server.
	* It handles fetching, caching, and refreshing of access tokens.
	*/
	var GoogleToken = class {
		/** The configuration options for this token instance. */
		tokenOptions;
		/** The handler for token fetching and caching logic. */
		tokenHandler;
		/**
		* Create a GoogleToken.
		*
		* @param options  Configuration object.
		*/
		constructor(options) {
			this.tokenOptions = options || {};
			this.tokenOptions.transporter = this.tokenOptions.transporter || { request: (opts) => (0, gaxios_1.request)(opts) };
			if (!this.tokenOptions.iss) this.tokenOptions.iss = this.tokenOptions.email;
			if (typeof this.tokenOptions.scope === "object") this.tokenOptions.scope = this.tokenOptions.scope.join(" ");
			this.tokenHandler = new tokenHandler_1.TokenHandler(this.tokenOptions);
		}
		get expiresAt() {
			return this.tokenHandler.tokenExpiresAt;
		}
		/**
		* The most recent access token obtained by this client.
		*/
		get accessToken() {
			return this.tokenHandler.token?.access_token;
		}
		/**
		* The most recent ID token obtained by this client.
		*/
		get idToken() {
			return this.tokenHandler.token?.id_token;
		}
		/**
		* The token type of the most recent access token.
		*/
		get tokenType() {
			return this.tokenHandler.token?.token_type;
		}
		/**
		* The refresh token for the current credentials.
		*/
		get refreshToken() {
			return this.tokenHandler.token?.refresh_token;
		}
		/**
		* A boolean indicating if the current token has expired.
		*/
		hasExpired() {
			return this.tokenHandler.hasExpired();
		}
		/**
		* A boolean indicating if the current token is expiring soon,
		* based on the `eagerRefreshThresholdMillis` option.
		*/
		isTokenExpiring() {
			return this.tokenHandler.isTokenExpiring();
		}
		getToken(callbackOrOptions, opts = { forceRefresh: false }) {
			let callback;
			if (typeof callbackOrOptions === "function") callback = callbackOrOptions;
			else if (typeof callbackOrOptions === "object") opts = callbackOrOptions;
			const promise = this.tokenHandler.getToken(opts.forceRefresh ?? false);
			if (callback) promise.then((token) => callback(null, token), callback);
			return promise;
		}
		revokeToken(callback) {
			if (!this.accessToken) return Promise.reject(/* @__PURE__ */ new Error("No token to revoke."));
			const promise = (0, revokeToken_1.revokeToken)(this.accessToken, this.tokenOptions.transporter);
			if (callback) promise.then(() => callback(), callback);
			this.tokenHandler = new tokenHandler_1.TokenHandler(this.tokenOptions);
		}
		/**
		* Returns the configuration options for this token instance.
		*/
		get googleTokenOptions() {
			return this.tokenOptions;
		}
	};
	exports.GoogleToken = GoogleToken;
}));
//#endregion
//#region ../../node_modules/.pnpm/google-auth-library@11.1.0/node_modules/google-auth-library/build/src/auth/jwtaccess.js
var require_jwtaccess = /* @__PURE__ */ __commonJSMin(((exports) => {
	Object.defineProperty(exports, "__esModule", { value: true });
	exports.JWTAccess = void 0;
	const jws = require_jws();
	const util_1 = require_util$1();
	const DEFAULT_HEADER = {
		alg: "RS256",
		typ: "JWT"
	};
	exports.JWTAccess = class JWTAccess {
		email;
		key;
		keyId;
		projectId;
		eagerRefreshThresholdMillis;
		cache = new util_1.LRUCache({
			capacity: 500,
			maxAge: 36e5
		});
		/**
		* JWTAccess service account credentials.
		*
		* Create a new access token by using the credential to create a new JWT token
		* that's recognized as the access token.
		*
		* @param email the service account email address.
		* @param key the private key that will be used to sign the token.
		* @param keyId the ID of the private key used to sign the token.
		*/
		constructor(email, key, keyId, eagerRefreshThresholdMillis) {
			this.email = email;
			this.key = key;
			this.keyId = keyId;
			this.eagerRefreshThresholdMillis = eagerRefreshThresholdMillis ?? 3e5;
		}
		/**
		* Ensures that we're caching a key appropriately, giving precedence to scopes vs. url
		*
		* @param url The URI being authorized.
		* @param scopes The scope or scopes being authorized
		* @returns A string that returns the cached key.
		*/
		getCachedKey(url, scopes) {
			let cacheKey = url;
			if (scopes && Array.isArray(scopes) && scopes.length) cacheKey = url ? `${url}_${scopes.join("_")}` : `${scopes.join("_")}`;
			else if (typeof scopes === "string") cacheKey = url ? `${url}_${scopes}` : scopes;
			if (!cacheKey) throw Error("Scopes or url must be provided");
			return cacheKey;
		}
		/**
		* Get a non-expired access token, after refreshing if necessary.
		*
		* @param url The URI being authorized.
		* @param additionalClaims An object with a set of additional claims to
		* include in the payload.
		* @returns An object that includes the authorization header.
		*/
		getRequestHeaders(url, additionalClaims, scopes) {
			const key = this.getCachedKey(url, scopes);
			const cachedToken = this.cache.get(key);
			const now = Date.now();
			if (cachedToken && cachedToken.expiration - now > this.eagerRefreshThresholdMillis) return new Headers(cachedToken.headers);
			const iat = Math.floor(Date.now() / 1e3);
			const exp = JWTAccess.getExpirationTime(iat);
			let defaultClaims;
			if (Array.isArray(scopes)) scopes = scopes.join(" ");
			if (scopes) defaultClaims = {
				iss: this.email,
				sub: this.email,
				scope: scopes,
				exp,
				iat
			};
			else defaultClaims = {
				iss: this.email,
				sub: this.email,
				aud: url,
				exp,
				iat
			};
			if (additionalClaims) {
				for (const claim in defaultClaims) if (additionalClaims[claim]) throw new Error(`The '${claim}' property is not allowed when passing additionalClaims. This claim is included in the JWT by default.`);
			}
			const header = this.keyId ? {
				...DEFAULT_HEADER,
				kid: this.keyId
			} : DEFAULT_HEADER;
			const payload = Object.assign(defaultClaims, additionalClaims);
			const signedJWT = jws.sign({
				header,
				payload,
				secret: this.key
			});
			const headers = new Headers({ authorization: `Bearer ${signedJWT}` });
			this.cache.set(key, {
				expiration: exp * 1e3,
				headers
			});
			return headers;
		}
		/**
		* Returns an expiration time for the JWT token.
		*
		* @param iat The issued at time for the JWT.
		* @returns An expiration time for the JWT.
		*/
		static getExpirationTime(iat) {
			return iat + 3600;
		}
		/**
		* Create a JWTAccess credentials instance using the given input options.
		* @param json The input object.
		*/
		fromJSON(json) {
			if (!json) throw new Error("Must pass in a JSON object containing the service account auth settings.");
			if (!json.client_email) throw new Error("The incoming JSON object does not contain a client_email field");
			if (!json.private_key) throw new Error("The incoming JSON object does not contain a private_key field");
			this.email = json.client_email;
			this.key = json.private_key;
			this.keyId = json.private_key_id;
			this.projectId = json.project_id;
		}
		fromStream(inputStream, callback) {
			if (callback) this.fromStreamAsync(inputStream).then(() => callback(), callback);
			else return this.fromStreamAsync(inputStream);
		}
		fromStreamAsync(inputStream) {
			return new Promise((resolve, reject) => {
				if (!inputStream) reject(/* @__PURE__ */ new Error("Must pass in a stream containing the service account auth settings."));
				let s = "";
				inputStream.setEncoding("utf8").on("data", (chunk) => s += chunk).on("error", reject).on("end", () => {
					try {
						const data = JSON.parse(s);
						this.fromJSON(data);
						resolve();
					} catch (err) {
						reject(err);
					}
				});
			});
		}
	};
}));
//#endregion
//#region ../../node_modules/.pnpm/google-auth-library@11.1.0/node_modules/google-auth-library/build/src/auth/jwtclient.js
var require_jwtclient = /* @__PURE__ */ __commonJSMin(((exports) => {
	Object.defineProperty(exports, "__esModule", { value: true });
	exports.JWT = void 0;
	const googleToken_1 = require_googleToken();
	const getCredentials_1 = require_getCredentials();
	const jwtaccess_1 = require_jwtaccess();
	const oauth2client_1 = require_oauth2client();
	const authclient_1 = require_authclient();
	exports.JWT = class JWT extends oauth2client_1.OAuth2Client {
		email;
		keyFile;
		key;
		keyId;
		defaultScopes;
		scopes;
		scope;
		subject;
		gtoken;
		additionalClaims;
		useJWTAccessWithScope;
		defaultServicePath;
		access;
		/**
		* JWT service account credentials.
		*
		* Retrieve access token using gtoken.
		*
		* @param options the
		*/
		constructor(options = {}) {
			super(options);
			this.email = options.email;
			this.keyFile = options.keyFile;
			this.key = options.key;
			this.keyId = options.keyId;
			this.scopes = options.scopes;
			this.subject = options.subject;
			this.additionalClaims = options.additionalClaims;
			this.credentials = {
				refresh_token: "jwt-placeholder",
				expiry_date: 1
			};
		}
		/**
		* Creates a copy of the credential with the specified scopes.
		* @param scopes List of requested scopes or a single scope.
		* @return The cloned instance.
		*/
		createScoped(scopes) {
			const jwt = new JWT(this);
			jwt.scopes = scopes;
			return jwt;
		}
		/**
		* Obtains the metadata to be sent with the request.
		*
		* @param url the URI being authorized.
		*/
		async getRequestMetadataAsync(url) {
			url = this.defaultServicePath ? `https://${this.defaultServicePath}/` : url;
			const useSelfSignedJWT = !this.hasUserScopes() && url || this.useJWTAccessWithScope && this.hasAnyScopes() || this.universeDomain !== authclient_1.DEFAULT_UNIVERSE;
			if (this.subject && this.universeDomain !== authclient_1.DEFAULT_UNIVERSE) throw new RangeError(`Service Account user is configured for the credential. Domain-wide delegation is not supported in universes other than ${authclient_1.DEFAULT_UNIVERSE}`);
			if (!this.apiKey && useSelfSignedJWT) {
				if (this.additionalClaims && this.additionalClaims.target_audience) {
					const { tokens } = await this.refreshToken();
					return { headers: this.addSharedMetadataHeaders(new Headers({ authorization: `Bearer ${tokens.id_token}` })) };
				} else {
					if (!this.access) this.access = new jwtaccess_1.JWTAccess(this.email, this.key, this.keyId, this.eagerRefreshThresholdMillis);
					let scopes;
					if (this.hasUserScopes()) scopes = this.scopes;
					else if (!url) scopes = this.defaultScopes;
					const useScopes = this.useJWTAccessWithScope || this.universeDomain !== authclient_1.DEFAULT_UNIVERSE;
					const headers = await this.access.getRequestHeaders(url ?? void 0, this.additionalClaims, useScopes ? scopes : void 0);
					return { headers: this.addSharedMetadataHeaders(headers) };
				}
			} else if (this.hasAnyScopes() || this.apiKey) return super.getRequestMetadataAsync(url);
			else return { headers: new Headers() };
		}
		/**
		* Fetches an ID token.
		* @param targetAudience the audience for the fetched ID token.
		*/
		async fetchIdToken(targetAudience) {
			const gtoken = new googleToken_1.GoogleToken({
				iss: this.email,
				sub: this.subject,
				scope: this.scopes || this.defaultScopes,
				keyFile: this.keyFile,
				key: this.key,
				additionalClaims: { target_audience: targetAudience },
				transporter: this.transporter
			});
			await gtoken.getToken({ forceRefresh: true });
			if (!gtoken.idToken) throw new Error("Unknown error: Failed to fetch ID token");
			return gtoken.idToken;
		}
		/**
		* Determine if there are currently scopes available.
		*/
		hasUserScopes() {
			if (!this.scopes) return false;
			return this.scopes.length > 0;
		}
		/**
		* Are there any default or user scopes defined.
		*/
		hasAnyScopes() {
			if (this.scopes && this.scopes.length > 0) return true;
			if (this.defaultScopes && this.defaultScopes.length > 0) return true;
			return false;
		}
		authorize(callback) {
			if (callback) this.authorizeAsync().then((r) => callback(null, r), callback);
			else return this.authorizeAsync();
		}
		async authorizeAsync() {
			const result = await this.refreshToken();
			if (!result) throw new Error("No result returned");
			this.credentials = result.tokens;
			this.credentials.refresh_token = "jwt-placeholder";
			this.key = this.gtoken.googleTokenOptions?.key;
			this.email = this.gtoken.googleTokenOptions?.iss;
			return result.tokens;
		}
		/**
		* Refreshes the access token.
		* @param refreshToken ignored
		* @private
		*/
		async refreshTokenNoCache() {
			const gtoken = this.createGToken();
			const tokens = {
				access_token: (await gtoken.getToken({ forceRefresh: this.isTokenExpiring() })).access_token,
				token_type: "Bearer",
				expiry_date: gtoken.expiresAt,
				id_token: gtoken.idToken
			};
			this.emit("tokens", tokens);
			return {
				res: null,
				tokens
			};
		}
		/**
		* Create a gToken if it doesn't already exist.
		*/
		createGToken() {
			if (!this.gtoken) this.gtoken = new googleToken_1.GoogleToken({
				iss: this.email,
				sub: this.subject,
				scope: this.scopes || this.defaultScopes,
				keyFile: this.keyFile,
				key: this.key,
				additionalClaims: this.additionalClaims,
				transporter: this.transporter
			});
			return this.gtoken;
		}
		/**
		* Create a JWT credentials instance using the given input options.
		* @param json The input object.
		*
		* @remarks
		*
		* **Important**: If you accept a credential configuration (credential JSON/File/Stream) from an external source for authentication to Google Cloud, you must validate it before providing it to any Google API or library. Providing an unvalidated credential configuration to Google APIs can compromise the security of your systems and data. For more information, refer to {@link https://cloud.google.com/docs/authentication/external/externally-sourced-credentials Validate credential configurations from external sources}.
		*/
		fromJSON(json) {
			if (!json) throw new Error("Must pass in a JSON object containing the service account auth settings.");
			if (!json.client_email) throw new Error("The incoming JSON object does not contain a client_email field");
			if (!json.private_key) throw new Error("The incoming JSON object does not contain a private_key field");
			this.email = json.client_email;
			this.key = json.private_key;
			this.keyId = json.private_key_id;
			this.projectId = json.project_id;
			this.quotaProjectId = json.quota_project_id;
			this.universeDomain = json.universe_domain || this.universeDomain;
		}
		fromStream(inputStream, callback) {
			if (callback) this.fromStreamAsync(inputStream).then(() => callback(), callback);
			else return this.fromStreamAsync(inputStream);
		}
		fromStreamAsync(inputStream) {
			return new Promise((resolve, reject) => {
				if (!inputStream) throw new Error("Must pass in a stream containing the service account auth settings.");
				let s = "";
				inputStream.setEncoding("utf8").on("error", reject).on("data", (chunk) => s += chunk).on("end", () => {
					try {
						const data = JSON.parse(s);
						this.fromJSON(data);
						resolve();
					} catch (e) {
						reject(e);
					}
				});
			});
		}
		/**
		* Creates a JWT credentials instance using an API Key for authentication.
		* @param apiKey The API Key in string form.
		*/
		fromAPIKey(apiKey) {
			if (typeof apiKey !== "string") throw new Error("Must provide an API Key string.");
			this.apiKey = apiKey;
		}
		/**
		* Using the key or keyFile on the JWT client, obtain an object that contains
		* the key and the client email.
		*/
		async getCredentials() {
			if (this.key) return {
				private_key: this.key,
				client_email: this.email
			};
			else if (this.keyFile) {
				this.createGToken();
				const creds = await (0, getCredentials_1.getCredentials)(this.keyFile);
				return {
					private_key: creds.privateKey,
					client_email: creds.clientEmail
				};
			}
			throw new Error("A key or a keyFile must be provided to getCredentials.");
		}
	};
}));
//#endregion
//#region ../../node_modules/.pnpm/google-auth-library@11.1.0/node_modules/google-auth-library/build/src/auth/refreshclient.js
var require_refreshclient = /* @__PURE__ */ __commonJSMin(((exports) => {
	Object.defineProperty(exports, "__esModule", { value: true });
	exports.UserRefreshClient = exports.USER_REFRESH_ACCOUNT_TYPE = void 0;
	const oauth2client_1 = require_oauth2client();
	const authclient_1 = require_authclient();
	exports.USER_REFRESH_ACCOUNT_TYPE = "authorized_user";
	exports.UserRefreshClient = class UserRefreshClient extends oauth2client_1.OAuth2Client {
		_refreshToken;
		/**
		* The User Refresh Token client.
		*
		* @param optionsOrClientId The User Refresh Token client options. Passing an `clientId` directly is **@DEPRECATED**.
		* @param clientSecret **@DEPRECATED**. Provide a {@link UserRefreshClientOptions `UserRefreshClientOptions`} object in the first parameter instead.
		* @param refreshToken **@DEPRECATED**. Provide a {@link UserRefreshClientOptions `UserRefreshClientOptions`} object in the first parameter instead.
		* @param eagerRefreshThresholdMillis **@DEPRECATED**. Provide a {@link UserRefreshClientOptions `UserRefreshClientOptions`} object in the first parameter instead.
		* @param forceRefreshOnFailure **@DEPRECATED**. Provide a {@link UserRefreshClientOptions `UserRefreshClientOptions`} object in the first parameter instead.
		*/
		constructor(optionsOrClientId, clientSecret, refreshToken, eagerRefreshThresholdMillis, forceRefreshOnFailure) {
			const opts = optionsOrClientId && typeof optionsOrClientId === "object" ? optionsOrClientId : {
				clientId: optionsOrClientId,
				clientSecret,
				refreshToken,
				eagerRefreshThresholdMillis,
				forceRefreshOnFailure
			};
			super(opts);
			this._refreshToken = opts.refreshToken;
			this.credentials.refresh_token = opts.refreshToken;
		}
		/**
		* Refreshes the access token.
		* @param refreshToken An ignored refreshToken..
		* @param callback Optional callback.
		*/
		async refreshTokenNoCache() {
			return super.refreshTokenNoCache(this._refreshToken);
		}
		async fetchIdToken(targetAudience) {
			const opts = {
				...UserRefreshClient.RETRY_CONFIG,
				url: this.endpoints.oauth2TokenUrl,
				method: "POST",
				data: new URLSearchParams({
					client_id: this._clientId,
					client_secret: this._clientSecret,
					grant_type: "refresh_token",
					refresh_token: this._refreshToken,
					target_audience: targetAudience
				}),
				responseType: "json"
			};
			authclient_1.AuthClient.setMethodName(opts, "fetchIdToken");
			return (await this.transporter.request(opts)).data.id_token;
		}
		/**
		* Create a UserRefreshClient credentials instance using the given input
		* options.
		* @param json The input object.
		*/
		fromJSON(json) {
			if (!json) throw new Error("Must pass in a JSON object containing the user refresh token");
			if (json.type !== "authorized_user") throw new Error("The incoming JSON object does not have the \"authorized_user\" type");
			if (!json.client_id) throw new Error("The incoming JSON object does not contain a client_id field");
			if (!json.client_secret) throw new Error("The incoming JSON object does not contain a client_secret field");
			if (!json.refresh_token) throw new Error("The incoming JSON object does not contain a refresh_token field");
			this._clientId = json.client_id;
			this._clientSecret = json.client_secret;
			this._refreshToken = json.refresh_token;
			this.credentials.refresh_token = json.refresh_token;
			this.quotaProjectId = json.quota_project_id;
			this.universeDomain = json.universe_domain || this.universeDomain;
		}
		fromStream(inputStream, callback) {
			if (callback) this.fromStreamAsync(inputStream).then(() => callback(), callback);
			else return this.fromStreamAsync(inputStream);
		}
		async fromStreamAsync(inputStream) {
			return new Promise((resolve, reject) => {
				if (!inputStream) return reject(/* @__PURE__ */ new Error("Must pass in a stream containing the user refresh token."));
				let s = "";
				inputStream.setEncoding("utf8").on("error", reject).on("data", (chunk) => s += chunk).on("end", () => {
					try {
						const data = JSON.parse(s);
						this.fromJSON(data);
						return resolve();
					} catch (err) {
						return reject(err);
					}
				});
			});
		}
		/**
		* Create a UserRefreshClient credentials instance using the given input
		* options.
		* @param json The input object.
		*/
		static fromJSON(json) {
			const client = new UserRefreshClient();
			client.fromJSON(json);
			return client;
		}
	};
}));
//#endregion
//#region ../../node_modules/.pnpm/google-auth-library@11.1.0/node_modules/google-auth-library/build/src/auth/impersonated.js
var require_impersonated = /* @__PURE__ */ __commonJSMin(((exports) => {
	/**
	* Copyright 2021 Google LLC
	*
	* Licensed under the Apache License, Version 2.0 (the "License");
	* you may not use this file except in compliance with the License.
	* You may obtain a copy of the License at
	*
	*      http://www.apache.org/licenses/LICENSE-2.0
	*
	* Unless required by applicable law or agreed to in writing, software
	* distributed under the License is distributed on an "AS IS" BASIS,
	* WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
	* See the License for the specific language governing permissions and
	* limitations under the License.
	*/
	Object.defineProperty(exports, "__esModule", { value: true });
	exports.Impersonated = exports.IMPERSONATED_ACCOUNT_TYPE = void 0;
	const oauth2client_1 = require_oauth2client();
	const gaxios_1 = require_src$4();
	const util_1 = require_util$1();
	exports.IMPERSONATED_ACCOUNT_TYPE = "impersonated_service_account";
	exports.Impersonated = class Impersonated extends oauth2client_1.OAuth2Client {
		sourceClient;
		targetPrincipal;
		targetScopes;
		delegates;
		lifetime;
		endpoint;
		/**
		* Impersonated service account credentials.
		*
		* Create a new access token by impersonating another service account.
		*
		* Impersonated Credentials allowing credentials issued to a user or
		* service account to impersonate another. The source project using
		* Impersonated Credentials must enable the "IAMCredentials" API.
		* Also, the target service account must grant the orginating principal
		* the "Service Account Token Creator" IAM role.
		*
		* **IMPORTANT**: This method does not validate the credential configuration.
		* A security risk occurs when a credential configuration configured with
		* malicious URLs is used. When the credential configuration is accepted from
		* an untrusted source, you should validate it before using it with this
		* method. For more details, see
		* https://cloud.google.com/docs/authentication/external/externally-sourced-credentials.
		*
		* @param {object} options - The configuration object.
		* @param {object} [options.sourceClient] the source credential used as to
		* acquire the impersonated credentials.
		* @param {string} [options.targetPrincipal] the service account to
		* impersonate.
		* @param {string[]} [options.delegates] the chained list of delegates
		* required to grant the final access_token. If set, the sequence of
		* identities must have "Service Account Token Creator" capability granted to
		* the preceding identity. For example, if set to [serviceAccountB,
		* serviceAccountC], the sourceCredential must have the Token Creator role on
		* serviceAccountB. serviceAccountB must have the Token Creator on
		* serviceAccountC. Finally, C must have Token Creator on target_principal.
		* If left unset, sourceCredential must have that role on targetPrincipal.
		* @param {string[]} [options.targetScopes] scopes to request during the
		* authorization grant.
		* @param {number} [options.lifetime] number of seconds the delegated
		* credential should be valid for up to 3600 seconds by default, or 43,200
		* seconds by extending the token's lifetime, see:
		* https://cloud.google.com/iam/docs/creating-short-lived-service-account-credentials#sa-credentials-oauth
		* @param {string} [options.endpoint] api endpoint override.
		*/
		constructor(options = {}) {
			super(options);
			this.credentials = {
				expiry_date: 1,
				refresh_token: "impersonated-placeholder"
			};
			this.sourceClient = options.sourceClient ?? new oauth2client_1.OAuth2Client();
			this.targetPrincipal = options.targetPrincipal ?? "";
			this.delegates = options.delegates ?? [];
			this.targetScopes = options.targetScopes ?? [];
			this.lifetime = options.lifetime ?? 3600;
			if (!!!(0, util_1.originalOrCamelOptions)(options).get("universe_domain")) this.universeDomain = this.sourceClient.universeDomain;
			else if (this.sourceClient.universeDomain !== this.universeDomain) throw new RangeError(`Universe domain ${this.sourceClient.universeDomain} in source credentials does not match ${this.universeDomain} universe domain set for impersonated credentials.`);
			this.endpoint = options.endpoint ?? `https://iamcredentials.${this.universeDomain}`;
		}
		/**
		* Signs some bytes.
		*
		* {@link https://cloud.google.com/iam/docs/reference/credentials/rest/v1/projects.serviceAccounts/signBlob Reference Documentation}
		* @param blobToSign String to sign.
		*
		* @returns A {@link SignBlobResponse} denoting the keyID and signedBlob in base64 string
		*/
		async sign(blobToSign) {
			await this.sourceClient.getAccessToken();
			const name = `projects/-/serviceAccounts/${this.targetPrincipal}`;
			const u = `${this.endpoint}/v1/${name}:signBlob`;
			const body = {
				delegates: this.delegates,
				payload: Buffer.from(blobToSign).toString("base64")
			};
			return (await this.sourceClient.request({
				...Impersonated.RETRY_CONFIG,
				url: u,
				data: body,
				method: "POST"
			})).data;
		}
		/** The service account email to be impersonated. */
		getTargetPrincipal() {
			return this.targetPrincipal;
		}
		/**
		* Refreshes the access token.
		*/
		async refreshToken() {
			try {
				await this.sourceClient.getAccessToken();
				const name = "projects/-/serviceAccounts/" + this.targetPrincipal;
				const u = `${this.endpoint}/v1/${name}:generateAccessToken`;
				const body = {
					delegates: this.delegates,
					scope: this.targetScopes,
					lifetime: this.lifetime + "s"
				};
				const res = await this.sourceClient.request({
					...Impersonated.RETRY_CONFIG,
					url: u,
					data: body,
					method: "POST"
				});
				const tokenResponse = res.data;
				this.credentials.access_token = tokenResponse.accessToken;
				this.credentials.expiry_date = Date.parse(tokenResponse.expireTime);
				return {
					tokens: this.credentials,
					res
				};
			} catch (error) {
				if (!(error instanceof Error)) throw error;
				let status = 0;
				let message = "";
				if (error instanceof gaxios_1.GaxiosError) {
					status = error?.response?.data?.error?.status;
					message = error?.response?.data?.error?.message;
				}
				if (status && message) {
					error.message = `${status}: unable to impersonate: ${message}`;
					throw error;
				} else {
					error.message = `unable to impersonate: ${error}`;
					throw error;
				}
			}
		}
		/**
		* Generates an OpenID Connect ID token for a service account.
		*
		* {@link https://cloud.google.com/iam/docs/reference/credentials/rest/v1/projects.serviceAccounts/generateIdToken Reference Documentation}
		*
		* @param targetAudience the audience for the fetched ID token.
		* @param options the for the request
		* @return an OpenID Connect ID token
		*/
		async fetchIdToken(targetAudience, options) {
			await this.sourceClient.getAccessToken();
			const name = `projects/-/serviceAccounts/${this.targetPrincipal}`;
			const u = `${this.endpoint}/v1/${name}:generateIdToken`;
			const body = {
				delegates: this.delegates,
				audience: targetAudience,
				includeEmail: options?.includeEmail ?? true,
				useEmailAzp: options?.includeEmail ?? true
			};
			return (await this.sourceClient.request({
				...Impersonated.RETRY_CONFIG,
				url: u,
				data: body,
				method: "POST"
			})).data.token;
		}
	};
}));
//#endregion
//#region ../../node_modules/.pnpm/google-auth-library@11.1.0/node_modules/google-auth-library/build/src/auth/oauth2common.js
var require_oauth2common = /* @__PURE__ */ __commonJSMin(((exports) => {
	Object.defineProperty(exports, "__esModule", { value: true });
	exports.OAuthClientAuthHandler = void 0;
	exports.getErrorFromOAuthErrorResponse = getErrorFromOAuthErrorResponse;
	const gaxios_1 = require_src$4();
	const crypto_1 = require_crypto();
	/** List of HTTP methods that accept request bodies. */
	const METHODS_SUPPORTING_REQUEST_BODY = [
		"PUT",
		"POST",
		"PATCH"
	];
	/**
	* Abstract class for handling client authentication in OAuth-based
	* operations.
	* When request-body client authentication is used, only application/json and
	* application/x-www-form-urlencoded content types for HTTP methods that support
	* request bodies are supported.
	*/
	var OAuthClientAuthHandler = class {
		#crypto = (0, crypto_1.createCrypto)();
		#clientAuthentication;
		transporter;
		/**
		* Instantiates an OAuth client authentication handler.
		* @param options The OAuth Client Auth Handler instance options. Passing an `ClientAuthentication` directly is **@DEPRECATED**.
		*/
		constructor(options) {
			if (options && "clientId" in options) {
				this.#clientAuthentication = options;
				this.transporter = new gaxios_1.Gaxios();
			} else {
				this.#clientAuthentication = options?.clientAuthentication;
				this.transporter = options?.transporter || new gaxios_1.Gaxios();
			}
		}
		/**
		* Applies client authentication on the OAuth request's headers or POST
		* body but does not process the request.
		* @param opts The GaxiosOptions whose headers or data are to be modified
		*   depending on the client authentication mechanism to be used.
		* @param bearerToken The optional bearer token to use for authentication.
		*   When this is used, no client authentication credentials are needed.
		*/
		applyClientAuthenticationOptions(opts, bearerToken) {
			opts.headers = gaxios_1.Gaxios.mergeHeaders(opts.headers);
			this.injectAuthenticatedHeaders(opts, bearerToken);
			if (!bearerToken) this.injectAuthenticatedRequestBody(opts);
		}
		/**
		* Applies client authentication on the request's header if either
		* basic authentication or bearer token authentication is selected.
		*
		* @param opts The GaxiosOptions whose headers or data are to be modified
		*   depending on the client authentication mechanism to be used.
		* @param bearerToken The optional bearer token to use for authentication.
		*   When this is used, no client authentication credentials are needed.
		*/
		injectAuthenticatedHeaders(opts, bearerToken) {
			if (bearerToken) opts.headers = gaxios_1.Gaxios.mergeHeaders(opts.headers, { authorization: `Bearer ${bearerToken}` });
			else if (this.#clientAuthentication?.confidentialClientType === "basic") {
				opts.headers = gaxios_1.Gaxios.mergeHeaders(opts.headers);
				const clientId = this.#clientAuthentication.clientId;
				const clientSecret = this.#clientAuthentication.clientSecret || "";
				const base64EncodedCreds = this.#crypto.encodeBase64StringUtf8(`${clientId}:${clientSecret}`);
				gaxios_1.Gaxios.mergeHeaders(opts.headers, { authorization: `Basic ${base64EncodedCreds}` });
			}
		}
		/**
		* Applies client authentication on the request's body if request-body
		* client authentication is selected.
		*
		* @param opts The GaxiosOptions whose headers or data are to be modified
		*   depending on the client authentication mechanism to be used.
		*/
		injectAuthenticatedRequestBody(opts) {
			if (this.#clientAuthentication?.confidentialClientType === "request-body") {
				const method = (opts.method || "GET").toUpperCase();
				if (!METHODS_SUPPORTING_REQUEST_BODY.includes(method)) throw new Error(`${method} HTTP method does not support ${this.#clientAuthentication.confidentialClientType} client authentication`);
				const contentType = new Headers(opts.headers).get("content-type");
				if (contentType?.startsWith("application/x-www-form-urlencoded") || opts.data instanceof URLSearchParams) {
					const data = new URLSearchParams(opts.data ?? "");
					data.append("client_id", this.#clientAuthentication.clientId);
					data.append("client_secret", this.#clientAuthentication.clientSecret || "");
					opts.data = data;
				} else if (contentType?.startsWith("application/json")) {
					opts.data = opts.data || {};
					Object.assign(opts.data, {
						client_id: this.#clientAuthentication.clientId,
						client_secret: this.#clientAuthentication.clientSecret || ""
					});
				} else throw new Error(`${contentType} content-types are not supported with ${this.#clientAuthentication.confidentialClientType} client authentication`);
			}
		}
		/**
		* Retry config for Auth-related requests.
		*
		* @remarks
		*
		* This is not a part of the default {@link AuthClient.transporter transporter/gaxios}
		* config as some downstream APIs would prefer if customers explicitly enable retries,
		* such as GCS.
		*/
		static get RETRY_CONFIG() {
			return {
				retry: true,
				retryConfig: { httpMethodsToRetry: [
					"GET",
					"PUT",
					"POST",
					"HEAD",
					"OPTIONS",
					"DELETE"
				] }
			};
		}
	};
	exports.OAuthClientAuthHandler = OAuthClientAuthHandler;
	/**
	* Converts an OAuth error response to a native JavaScript Error.
	* @param resp The OAuth error response to convert to a native Error object.
	* @param err The optional original error. If provided, the error properties
	*   will be copied to the new error.
	* @return The converted native Error object.
	*/
	function getErrorFromOAuthErrorResponse(resp, err) {
		const errorCode = resp.error;
		const errorDescription = resp.error_description;
		const errorUri = resp.error_uri;
		let message = `Error code ${errorCode}`;
		if (typeof errorDescription !== "undefined") message += `: ${errorDescription}`;
		if (typeof errorUri !== "undefined") message += ` - ${errorUri}`;
		const newError = new Error(message);
		if (err) {
			const keys = Object.keys(err);
			if (err.stack) keys.push("stack");
			keys.forEach((key) => {
				if (key !== "message") Object.defineProperty(newError, key, {
					value: err[key],
					writable: false,
					enumerable: true
				});
			});
		}
		return newError;
	}
}));
//#endregion
//#region ../../node_modules/.pnpm/google-auth-library@11.1.0/node_modules/google-auth-library/build/src/auth/stscredentials.js
var require_stscredentials = /* @__PURE__ */ __commonJSMin(((exports) => {
	Object.defineProperty(exports, "__esModule", { value: true });
	exports.StsCredentials = void 0;
	const gaxios_1 = require_src$4();
	const authclient_1 = require_authclient();
	const oauth2common_1 = require_oauth2common();
	const util_1 = require_util$1();
	exports.StsCredentials = class StsCredentials extends oauth2common_1.OAuthClientAuthHandler {
		#tokenExchangeEndpoint;
		/**
		* Initializes an STS credentials instance.
		*
		* @param options The STS credentials instance options. Passing an `tokenExchangeEndpoint` directly is **@DEPRECATED**.
		* @param clientAuthentication **@DEPRECATED**. Provide a {@link StsCredentialsConstructionOptions `StsCredentialsConstructionOptions`} object in the first parameter instead.
		*/
		constructor(options = { tokenExchangeEndpoint: "" }, clientAuthentication) {
			if (typeof options !== "object" || options instanceof URL) options = {
				tokenExchangeEndpoint: options,
				clientAuthentication
			};
			super(options);
			this.#tokenExchangeEndpoint = options.tokenExchangeEndpoint;
		}
		/**
		* Exchanges the provided token for another type of token based on the
		* rfc8693 spec.
		* @param stsCredentialsOptions The token exchange options used to populate
		*   the token exchange request.
		* @param additionalHeaders Optional additional headers to pass along the
		*   request.
		* @param options Optional additional GCP-specific non-spec defined options
		*   to send with the request.
		*   Example: `&options=${encodeUriComponent(JSON.stringified(options))}`
		* @return A promise that resolves with the token exchange response containing
		*   the requested token and its expiration time.
		*/
		async exchangeToken(stsCredentialsOptions, headers, options) {
			const values = {
				grant_type: stsCredentialsOptions.grantType,
				resource: stsCredentialsOptions.resource,
				audience: stsCredentialsOptions.audience,
				scope: stsCredentialsOptions.scope?.join(" "),
				requested_token_type: stsCredentialsOptions.requestedTokenType,
				subject_token: stsCredentialsOptions.subjectToken,
				subject_token_type: stsCredentialsOptions.subjectTokenType,
				actor_token: stsCredentialsOptions.actingParty?.actorToken,
				actor_token_type: stsCredentialsOptions.actingParty?.actorTokenType,
				options: options && JSON.stringify(options)
			};
			const opts = {
				...StsCredentials.RETRY_CONFIG,
				url: this.#tokenExchangeEndpoint.toString(),
				method: "POST",
				headers,
				data: new URLSearchParams((0, util_1.removeUndefinedValuesInObject)(values)),
				responseType: "json"
			};
			authclient_1.AuthClient.setMethodName(opts, "exchangeToken");
			this.applyClientAuthenticationOptions(opts);
			try {
				const response = await this.transporter.request(opts);
				const stsSuccessfulResponse = response.data;
				stsSuccessfulResponse.res = response;
				return stsSuccessfulResponse;
			} catch (error) {
				if (error instanceof gaxios_1.GaxiosError && error.response) throw (0, oauth2common_1.getErrorFromOAuthErrorResponse)(error.response.data, error);
				throw error;
			}
		}
	};
}));
//#endregion
//#region ../../node_modules/.pnpm/google-auth-library@11.1.0/node_modules/google-auth-library/build/src/auth/baseexternalclient.js
var require_baseexternalclient = /* @__PURE__ */ __commonJSMin(((exports) => {
	Object.defineProperty(exports, "__esModule", { value: true });
	exports.BaseExternalAccountClient = exports.CLOUD_RESOURCE_MANAGER = exports.EXTERNAL_ACCOUNT_TYPE = exports.EXPIRATION_TIME_OFFSET = void 0;
	const gaxios_1 = require_src$4();
	const stream$3 = __require("stream");
	const authclient_1 = require_authclient();
	const sts = require_stscredentials();
	const util_1 = require_util$1();
	const shared_cjs_1 = require_shared();
	/**
	* The required token exchange grant_type: rfc8693#section-2.1
	*/
	const STS_GRANT_TYPE = "urn:ietf:params:oauth:grant-type:token-exchange";
	/**
	* The requested token exchange requested_token_type: rfc8693#section-2.1
	*/
	const STS_REQUEST_TOKEN_TYPE = "urn:ietf:params:oauth:token-type:access_token";
	/** The default OAuth scope to request when none is provided. */
	const DEFAULT_OAUTH_SCOPE = "https://www.googleapis.com/auth/cloud-platform";
	/** Default impersonated token lifespan in seconds.*/
	const DEFAULT_TOKEN_LIFESPAN = 3600;
	/**
	* Offset to take into account network delays and server clock skews.
	*/
	exports.EXPIRATION_TIME_OFFSET = 3e5;
	/**
	* The credentials JSON file type for external account clients.
	* There are 3 types of JSON configs:
	* 1. authorized_user => Google end user credential
	* 2. service_account => Google service account credential
	* 3. external_Account => non-GCP service (eg. AWS, Azure, K8s)
	*/
	exports.EXTERNAL_ACCOUNT_TYPE = "external_account";
	/**
	* Cloud resource manager URL used to retrieve project information.
	*
	* @deprecated use {@link BaseExternalAccountClient.cloudResourceManagerURL} instead
	**/
	exports.CLOUD_RESOURCE_MANAGER = "https://cloudresourcemanager.googleapis.com/v1/projects/";
	/** The workforce audience pattern. */
	const WORKFORCE_AUDIENCE_PATTERN = "//iam\\.googleapis\\.com/locations/[^/]+/workforcePools/[^/]+/providers/.+";
	const DEFAULT_TOKEN_URL = "https://sts.{universeDomain}/v1/token";
	exports.BaseExternalAccountClient = class BaseExternalAccountClient extends authclient_1.AuthClient {
		/**
		* OAuth scopes for the GCP access token to use. When not provided,
		* the default https://www.googleapis.com/auth/cloud-platform is
		* used.
		*/
		scopes;
		projectNumber;
		audience;
		subjectTokenType;
		stsCredential;
		clientAuth;
		credentialSourceType;
		cachedAccessToken;
		serviceAccountImpersonationUrl;
		serviceAccountImpersonationLifetime;
		workforcePoolUserProject;
		configLifetimeRequested;
		tokenUrl;
		/**
		* @example
		* ```ts
		* new URL('https://cloudresourcemanager.googleapis.com/v1/projects/');
		* ```
		*/
		cloudResourceManagerURL;
		supplierContext;
		/**
		* A pending access token request. Used for concurrent calls.
		*/
		#pendingAccessToken = null;
		/**
		* Instantiate a BaseExternalAccountClient instance using the provided JSON
		* object loaded from an external account credentials file.
		* @param options The external account options object typically loaded
		*   from the external account JSON credential file. The camelCased options
		*   are aliases for the snake_cased options.
		*/
		constructor(options) {
			super(options);
			const opts = (0, util_1.originalOrCamelOptions)(options);
			const type = opts.get("type");
			if (type && type !== exports.EXTERNAL_ACCOUNT_TYPE) throw new Error(`Expected "${exports.EXTERNAL_ACCOUNT_TYPE}" type but received "${options.type}"`);
			const clientId = opts.get("client_id");
			const clientSecret = opts.get("client_secret");
			this.tokenUrl = opts.get("token_url") ?? DEFAULT_TOKEN_URL.replace("{universeDomain}", this.universeDomain);
			const subjectTokenType = opts.get("subject_token_type");
			const workforcePoolUserProject = opts.get("workforce_pool_user_project");
			const serviceAccountImpersonationUrl = opts.get("service_account_impersonation_url");
			const serviceAccountImpersonation = opts.get("service_account_impersonation");
			const serviceAccountImpersonationLifetime = (0, util_1.originalOrCamelOptions)(serviceAccountImpersonation).get("token_lifetime_seconds");
			this.cloudResourceManagerURL = new URL(opts.get("cloud_resource_manager_url") || `https://cloudresourcemanager.${this.universeDomain}/v1/projects/`);
			if (clientId) this.clientAuth = {
				confidentialClientType: "basic",
				clientId,
				clientSecret
			};
			this.stsCredential = new sts.StsCredentials({
				tokenExchangeEndpoint: this.tokenUrl,
				clientAuthentication: this.clientAuth
			});
			this.scopes = opts.get("scopes") || [DEFAULT_OAUTH_SCOPE];
			this.cachedAccessToken = null;
			this.audience = opts.get("audience");
			this.subjectTokenType = subjectTokenType;
			this.workforcePoolUserProject = workforcePoolUserProject;
			const workforceAudiencePattern = new RegExp(WORKFORCE_AUDIENCE_PATTERN);
			if (this.workforcePoolUserProject && !this.audience.match(workforceAudiencePattern)) throw new Error("workforcePoolUserProject should not be set for non-workforce pool credentials.");
			this.serviceAccountImpersonationUrl = serviceAccountImpersonationUrl;
			this.serviceAccountImpersonationLifetime = serviceAccountImpersonationLifetime;
			if (this.serviceAccountImpersonationLifetime) this.configLifetimeRequested = true;
			else {
				this.configLifetimeRequested = false;
				this.serviceAccountImpersonationLifetime = DEFAULT_TOKEN_LIFESPAN;
			}
			this.projectNumber = this.getProjectNumber(this.audience);
			this.supplierContext = {
				audience: this.audience,
				subjectTokenType: this.subjectTokenType,
				transporter: this.transporter
			};
		}
		/** The service account email to be impersonated, if available. */
		getServiceAccountEmail() {
			if (this.serviceAccountImpersonationUrl) {
				if (this.serviceAccountImpersonationUrl.length > 256)
 /**
				* Prevents DOS attacks.
				* @see {@link https://github.com/googleapis/google-auth-library-nodejs/security/code-scanning/84}
				**/
				throw new RangeError(`URL is too long: ${this.serviceAccountImpersonationUrl}`);
				return /serviceAccounts\/(?<email>[^:]+):generateAccessToken$/.exec(this.serviceAccountImpersonationUrl)?.groups?.email || null;
			}
			return null;
		}
		/**
		* Provides a mechanism to inject GCP access tokens directly.
		* When the provided credential expires, a new credential, using the
		* external account options, is retrieved.
		* @param credentials The Credentials object to set on the current client.
		*/
		setCredentials(credentials) {
			super.setCredentials(credentials);
			this.cachedAccessToken = credentials;
		}
		/**
		* @return A promise that resolves with the current GCP access token
		*   response. If the current credential is expired, a new one is retrieved.
		*/
		async getAccessToken() {
			if (!this.cachedAccessToken || this.isExpired(this.cachedAccessToken)) await this.refreshAccessTokenAsync();
			return {
				token: this.cachedAccessToken.access_token,
				res: this.cachedAccessToken.res
			};
		}
		/**
		* The main authentication interface. It takes an optional url which when
		* present is the endpoint being accessed, and returns a Promise which
		* resolves with authorization header fields.
		*
		* The result has the form:
		* { authorization: 'Bearer <access_token_value>' }
		*/
		async getRequestHeaders() {
			const accessTokenResponse = await this.getAccessToken();
			const headers = new Headers({ authorization: `Bearer ${accessTokenResponse.token}` });
			return this.addSharedMetadataHeaders(headers);
		}
		request(opts, callback) {
			if (callback) this.requestAsync(opts).then((r) => callback(null, r), (e) => {
				return callback(e, e.response);
			});
			else return this.requestAsync(opts);
		}
		/**
		* @return A promise that resolves with the project ID corresponding to the
		*   current workload identity pool or current workforce pool if
		*   determinable. For workforce pool credential, it returns the project ID
		*   corresponding to the workforcePoolUserProject.
		*   This is introduced to match the current pattern of using the Auth
		*   library:
		*   const projectId = await auth.getProjectId();
		*   const url = `https://dns.googleapis.com/dns/v1/projects/${projectId}`;
		*   const res = await client.request({ url });
		*   The resource may not have permission
		*   (resourcemanager.projects.get) to call this API or the required
		*   scopes may not be selected:
		*   https://cloud.google.com/resource-manager/reference/rest/v1/projects/get#authorization-scopes
		*/
		async getProjectId() {
			const projectNumber = this.projectNumber || this.workforcePoolUserProject;
			if (this.projectId) return this.projectId;
			else if (projectNumber) {
				const headers = await this.getRequestHeaders();
				const opts = {
					...BaseExternalAccountClient.RETRY_CONFIG,
					headers,
					url: `${this.cloudResourceManagerURL.toString()}${projectNumber}`,
					responseType: "json"
				};
				authclient_1.AuthClient.setMethodName(opts, "getProjectId");
				const response = await this.transporter.request(opts);
				this.projectId = response.data.projectId;
				return this.projectId;
			}
			return null;
		}
		/**
		* Authenticates the provided HTTP request, processes it and resolves with the
		* returned response.
		* @param opts The HTTP request options.
		* @param reAuthRetried Whether the current attempt is a retry after a failed attempt due to an auth failure.
		* @return A promise that resolves with the successful response.
		*/
		async requestAsync(opts, reAuthRetried = false) {
			let response;
			try {
				const requestHeaders = await this.getRequestHeaders();
				opts.headers = gaxios_1.Gaxios.mergeHeaders(opts.headers);
				this.addUserProjectAndAuthHeaders(opts.headers, requestHeaders);
				response = await this.transporter.request(opts);
			} catch (e) {
				const res = e.response;
				if (res) {
					const statusCode = res.status;
					const isReadableStream = res.config.data instanceof stream$3.Readable;
					if (!reAuthRetried && (statusCode === 401 || statusCode === 403) && !isReadableStream && this.forceRefreshOnFailure) {
						await this.refreshAccessTokenAsync();
						return await this.requestAsync(opts, true);
					}
				}
				throw e;
			}
			return response;
		}
		/**
		* Forces token refresh, even if unexpired tokens are currently cached.
		* External credentials are exchanged for GCP access tokens via the token
		* exchange endpoint and other settings provided in the client options
		* object.
		* If the service_account_impersonation_url is provided, an additional
		* step to exchange the external account GCP access token for a service
		* account impersonated token is performed.
		* @return A promise that resolves with the fresh GCP access tokens.
		*/
		async refreshAccessTokenAsync() {
			this.#pendingAccessToken = this.#pendingAccessToken || this.#internalRefreshAccessTokenAsync();
			try {
				return await this.#pendingAccessToken;
			} finally {
				this.#pendingAccessToken = null;
			}
		}
		async #internalRefreshAccessTokenAsync() {
			const subjectToken = await this.retrieveSubjectToken();
			const stsCredentialsOptions = {
				grantType: STS_GRANT_TYPE,
				audience: this.audience,
				requestedTokenType: STS_REQUEST_TOKEN_TYPE,
				subjectToken,
				subjectTokenType: this.subjectTokenType,
				scope: this.serviceAccountImpersonationUrl ? [DEFAULT_OAUTH_SCOPE] : this.getScopesArray()
			};
			const additionalOptions = !this.clientAuth && this.workforcePoolUserProject ? { userProject: this.workforcePoolUserProject } : void 0;
			const additionalHeaders = new Headers({ "x-goog-api-client": this.getMetricsHeaderValue() });
			const stsResponse = await this.stsCredential.exchangeToken(stsCredentialsOptions, additionalHeaders, additionalOptions);
			if (this.serviceAccountImpersonationUrl) this.cachedAccessToken = await this.getImpersonatedAccessToken(stsResponse.access_token);
			else if (stsResponse.expires_in) this.cachedAccessToken = {
				access_token: stsResponse.access_token,
				expiry_date: (/* @__PURE__ */ new Date()).getTime() + stsResponse.expires_in * 1e3,
				res: stsResponse.res
			};
			else this.cachedAccessToken = {
				access_token: stsResponse.access_token,
				res: stsResponse.res
			};
			this.credentials = {};
			Object.assign(this.credentials, this.cachedAccessToken);
			delete this.credentials.res;
			this.emit("tokens", {
				refresh_token: null,
				expiry_date: this.cachedAccessToken.expiry_date,
				access_token: this.cachedAccessToken.access_token,
				token_type: "Bearer",
				id_token: null
			});
			return this.cachedAccessToken;
		}
		/**
		* Returns the workload identity pool project number if it is determinable
		* from the audience resource name.
		* @param audience The STS audience used to determine the project number.
		* @return The project number associated with the workload identity pool, if
		*   this can be determined from the STS audience field. Otherwise, null is
		*   returned.
		*/
		getProjectNumber(audience) {
			const match = audience.match(/\/projects\/([^/]+)/);
			if (!match) return null;
			return match[1];
		}
		/**
		* Exchanges an external account GCP access token for a service
		* account impersonated access token using iamcredentials
		* GenerateAccessToken API.
		* @param token The access token to exchange for a service account access
		*   token.
		* @return A promise that resolves with the service account impersonated
		*   credentials response.
		*/
		async getImpersonatedAccessToken(token) {
			const opts = {
				...BaseExternalAccountClient.RETRY_CONFIG,
				url: this.serviceAccountImpersonationUrl,
				method: "POST",
				headers: {
					"content-type": "application/json",
					authorization: `Bearer ${token}`
				},
				data: {
					scope: this.getScopesArray(),
					lifetime: this.serviceAccountImpersonationLifetime + "s"
				},
				responseType: "json"
			};
			authclient_1.AuthClient.setMethodName(opts, "getImpersonatedAccessToken");
			const response = await this.transporter.request(opts);
			const successResponse = response.data;
			return {
				access_token: successResponse.accessToken,
				expiry_date: new Date(successResponse.expireTime).getTime(),
				res: response
			};
		}
		/**
		* Returns whether the provided credentials are expired or not.
		* If there is no expiry time, assumes the token is not expired or expiring.
		* @param accessToken The credentials to check for expiration.
		* @return Whether the credentials are expired or not.
		*/
		isExpired(accessToken) {
			const now = (/* @__PURE__ */ new Date()).getTime();
			return accessToken.expiry_date ? now >= accessToken.expiry_date - this.eagerRefreshThresholdMillis : false;
		}
		/**
		* @return The list of scopes for the requested GCP access token.
		*/
		getScopesArray() {
			if (typeof this.scopes === "string") return [this.scopes];
			return this.scopes || [DEFAULT_OAUTH_SCOPE];
		}
		getMetricsHeaderValue() {
			const nodeVersion = process.version.replace(/^v/, "");
			const saImpersonation = this.serviceAccountImpersonationUrl !== void 0;
			const credentialSourceType = this.credentialSourceType ? this.credentialSourceType : "unknown";
			return `gl-node/${nodeVersion} auth/${shared_cjs_1.pkg.version} google-byoid-sdk source/${credentialSourceType} sa-impersonation/${saImpersonation} config-lifetime/${this.configLifetimeRequested}`;
		}
		getTokenUrl() {
			return this.tokenUrl;
		}
	};
}));
//#endregion
//#region ../../node_modules/.pnpm/google-auth-library@11.1.0/node_modules/google-auth-library/build/src/auth/filesubjecttokensupplier.js
var require_filesubjecttokensupplier = /* @__PURE__ */ __commonJSMin(((exports) => {
	Object.defineProperty(exports, "__esModule", { value: true });
	exports.FileSubjectTokenSupplier = void 0;
	const util_1 = __require("util");
	const fs$5 = __require("fs");
	const readFile = (0, util_1.promisify)(fs$5.readFile ?? (() => {}));
	const realpath = (0, util_1.promisify)(fs$5.realpath ?? (() => {}));
	const lstat = (0, util_1.promisify)(fs$5.lstat ?? (() => {}));
	/**
	* Internal subject token supplier implementation used when a file location
	* is configured in the credential configuration used to build an {@link IdentityPoolClient}
	*/
	var FileSubjectTokenSupplier = class {
		filePath;
		formatType;
		subjectTokenFieldName;
		/**
		* Instantiates a new file based subject token supplier.
		* @param opts The file subject token supplier options to build the supplier
		*   with.
		*/
		constructor(opts) {
			this.filePath = opts.filePath;
			this.formatType = opts.formatType;
			this.subjectTokenFieldName = opts.subjectTokenFieldName;
		}
		/**
		* Returns the subject token stored at the file specified in the constructor.
		* @param context {@link ExternalAccountSupplierContext} from the calling
		*   {@link IdentityPoolClient}, contains the requested audience and subject
		*   token type for the external account identity. Not used.
		*/
		async getSubjectToken() {
			let parsedFilePath = this.filePath;
			try {
				parsedFilePath = await realpath(parsedFilePath);
				if (!(await lstat(parsedFilePath)).isFile()) throw new Error();
			} catch (err) {
				if (err instanceof Error) err.message = `The file at ${parsedFilePath} does not exist, or it is not a file. ${err.message}`;
				throw err;
			}
			let subjectToken;
			const rawText = await readFile(parsedFilePath, { encoding: "utf8" });
			if (this.formatType === "text") subjectToken = rawText;
			else if (this.formatType === "json" && this.subjectTokenFieldName) subjectToken = JSON.parse(rawText)[this.subjectTokenFieldName];
			if (!subjectToken) throw new Error("Unable to parse the subject_token from the credential_source file");
			return subjectToken;
		}
	};
	exports.FileSubjectTokenSupplier = FileSubjectTokenSupplier;
}));
//#endregion
//#region ../../node_modules/.pnpm/google-auth-library@11.1.0/node_modules/google-auth-library/build/src/auth/urlsubjecttokensupplier.js
var require_urlsubjecttokensupplier = /* @__PURE__ */ __commonJSMin(((exports) => {
	Object.defineProperty(exports, "__esModule", { value: true });
	exports.UrlSubjectTokenSupplier = void 0;
	const authclient_1 = require_authclient();
	/**
	* Internal subject token supplier implementation used when a URL
	* is configured in the credential configuration used to build an {@link IdentityPoolClient}
	*/
	var UrlSubjectTokenSupplier = class {
		url;
		headers;
		formatType;
		subjectTokenFieldName;
		additionalGaxiosOptions;
		/**
		* Instantiates a URL subject token supplier.
		* @param opts The URL subject token supplier options to build the supplier with.
		*/
		constructor(opts) {
			this.url = opts.url;
			this.formatType = opts.formatType;
			this.subjectTokenFieldName = opts.subjectTokenFieldName;
			this.headers = opts.headers;
			this.additionalGaxiosOptions = opts.additionalGaxiosOptions;
		}
		/**
		* Sends a GET request to the URL provided in the constructor and resolves
		* with the returned external subject token.
		* @param context {@link ExternalAccountSupplierContext} from the calling
		*   {@link IdentityPoolClient}, contains the requested audience and subject
		*   token type for the external account identity. Not used.
		*/
		async getSubjectToken(context) {
			const opts = {
				...this.additionalGaxiosOptions,
				url: this.url,
				method: "GET",
				headers: this.headers,
				responseType: this.formatType
			};
			authclient_1.AuthClient.setMethodName(opts, "getSubjectToken");
			let subjectToken;
			if (this.formatType === "text") subjectToken = (await context.transporter.request(opts)).data;
			else if (this.formatType === "json" && this.subjectTokenFieldName) subjectToken = (await context.transporter.request(opts)).data[this.subjectTokenFieldName];
			if (!subjectToken) throw new Error("Unable to parse the subject_token from the credential_source URL");
			return subjectToken;
		}
	};
	exports.UrlSubjectTokenSupplier = UrlSubjectTokenSupplier;
}));
//#endregion
//#region ../../node_modules/.pnpm/google-auth-library@11.1.0/node_modules/google-auth-library/build/src/auth/certificatesubjecttokensupplier.js
var require_certificatesubjecttokensupplier = /* @__PURE__ */ __commonJSMin(((exports) => {
	Object.defineProperty(exports, "__esModule", { value: true });
	exports.CertificateSubjectTokenSupplier = exports.InvalidConfigurationError = exports.CertificateSourceUnavailableError = exports.CERTIFICATE_CONFIGURATION_ENV_VARIABLE = void 0;
	const util_1 = require_util$1();
	const fs$4 = __require("fs");
	const crypto_1 = __require("crypto");
	const https$1 = __require("https");
	exports.CERTIFICATE_CONFIGURATION_ENV_VARIABLE = "GOOGLE_API_CERTIFICATE_CONFIG";
	/**
	* Thrown when the certificate source cannot be located or accessed.
	*/
	var CertificateSourceUnavailableError = class extends Error {
		constructor(message) {
			super(message);
			this.name = "CertificateSourceUnavailableError";
		}
	};
	exports.CertificateSourceUnavailableError = CertificateSourceUnavailableError;
	/**
	* Thrown for invalid configuration that is not related to file availability.
	*/
	var InvalidConfigurationError = class extends Error {
		constructor(message) {
			super(message);
			this.name = "InvalidConfigurationError";
		}
	};
	exports.InvalidConfigurationError = InvalidConfigurationError;
	/**
	* A subject token supplier that uses a client certificate for authentication.
	* It provides the certificate chain as the subject token for identity federation.
	*/
	var CertificateSubjectTokenSupplier = class {
		certificateConfigPath;
		trustChainPath;
		cert;
		key;
		/**
		* Initializes a new instance of the CertificateSubjectTokenSupplier.
		* @param opts The configuration options for the supplier.
		*/
		constructor(opts) {
			if (!opts.useDefaultCertificateConfig && !opts.certificateConfigLocation) throw new InvalidConfigurationError("Either `useDefaultCertificateConfig` must be true or a `certificateConfigLocation` must be provided.");
			if (opts.useDefaultCertificateConfig && opts.certificateConfigLocation) throw new InvalidConfigurationError("Both `useDefaultCertificateConfig` and `certificateConfigLocation` cannot be provided.");
			this.trustChainPath = opts.trustChainPath;
			this.certificateConfigPath = opts.certificateConfigLocation ?? "";
		}
		/**
		* Creates an HTTPS agent configured with the client certificate and private key for mTLS.
		* @returns An mTLS-configured https.Agent.
		*/
		async createMtlsHttpsAgent() {
			if (!this.key || !this.cert) throw new InvalidConfigurationError("Cannot create mTLS Agent with missing certificate or key");
			return new https$1.Agent({
				key: this.key,
				cert: this.cert
			});
		}
		/**
		* Constructs the subject token, which is the base64-encoded certificate chain.
		* @returns A promise that resolves with the subject token.
		*/
		async getSubjectToken() {
			this.certificateConfigPath = await this.#resolveCertificateConfigFilePath();
			const { certPath, keyPath } = await this.#getCertAndKeyPaths();
			({cert: this.cert, key: this.key} = await this.#getKeyAndCert(certPath, keyPath));
			return await this.#processChainFromPaths(this.cert);
		}
		/**
		* Resolves the absolute path to the certificate configuration file
		* by checking the "certificate_config_location" provided in the ADC file,
		* or the "GOOGLE_API_CERTIFICATE_CONFIG" environment variable
		* or in the default gcloud path.
		* @param overridePath An optional path to check first.
		* @returns The resolved file path.
		*/
		async #resolveCertificateConfigFilePath() {
			const overridePath = this.certificateConfigPath;
			if (overridePath) {
				if (await (0, util_1.isValidFile)(overridePath)) return overridePath;
				throw new CertificateSourceUnavailableError(`Provided certificate config path is invalid: ${overridePath}`);
			}
			const envPath = process.env[exports.CERTIFICATE_CONFIGURATION_ENV_VARIABLE];
			if (envPath) {
				if (await (0, util_1.isValidFile)(envPath)) return envPath;
				throw new CertificateSourceUnavailableError(`Path from environment variable "${exports.CERTIFICATE_CONFIGURATION_ENV_VARIABLE}" is invalid: ${envPath}`);
			}
			const wellKnownPath = (0, util_1.getWellKnownCertificateConfigFileLocation)();
			if (await (0, util_1.isValidFile)(wellKnownPath)) return wellKnownPath;
			throw new CertificateSourceUnavailableError(`Could not find certificate configuration file. Searched override path, the "${exports.CERTIFICATE_CONFIGURATION_ENV_VARIABLE}" env var, and the gcloud path (${wellKnownPath}).`);
		}
		/**
		* Reads and parses the certificate config JSON file to extract the certificate and key paths.
		* @returns An object containing the certificate and key paths.
		*/
		async #getCertAndKeyPaths() {
			const configPath = this.certificateConfigPath;
			let fileContents;
			try {
				fileContents = await fs$4.promises.readFile(configPath, "utf8");
			} catch (err) {
				throw new CertificateSourceUnavailableError(`Failed to read certificate config file at: ${configPath}`);
			}
			try {
				const config = JSON.parse(fileContents);
				const certPath = config?.cert_configs?.workload?.cert_path;
				const keyPath = config?.cert_configs?.workload?.key_path;
				if (!certPath || !keyPath) throw new InvalidConfigurationError(`Certificate config file (${configPath}) is missing required "cert_path" or "key_path" in the workload config.`);
				return {
					certPath,
					keyPath
				};
			} catch (e) {
				if (e instanceof InvalidConfigurationError) throw e;
				throw new InvalidConfigurationError(`Failed to parse certificate config from ${configPath}: ${e.message}`);
			}
		}
		/**
		* Reads and parses the cert and key files get their content and check valid format.
		* @returns An object containing the cert content and key content in buffer format.
		*/
		async #getKeyAndCert(certPath, keyPath) {
			let cert, key;
			try {
				cert = await fs$4.promises.readFile(certPath);
				new crypto_1.X509Certificate(cert);
			} catch (err) {
				throw new CertificateSourceUnavailableError(`Failed to read certificate file at ${certPath}: ${err instanceof Error ? err.message : String(err)}`);
			}
			try {
				key = await fs$4.promises.readFile(keyPath);
				(0, crypto_1.createPrivateKey)(key);
			} catch (err) {
				throw new CertificateSourceUnavailableError(`Failed to read private key file at ${keyPath}: ${err instanceof Error ? err.message : String(err)}`);
			}
			return {
				cert,
				key
			};
		}
		/**
		* Reads the leaf certificate and trust chain, combines them,
		* and returns a JSON array of base64-encoded certificates.
		* @returns A stringified JSON array of the certificate chain.
		*/
		async #processChainFromPaths(leafCertBuffer) {
			const leafCert = new crypto_1.X509Certificate(leafCertBuffer);
			if (!this.trustChainPath) return JSON.stringify([leafCert.raw.toString("base64")]);
			try {
				const chainCerts = ((await fs$4.promises.readFile(this.trustChainPath, "utf8")).match(/-----BEGIN CERTIFICATE-----[^-]+-----END CERTIFICATE-----/g) ?? []).map((pem, index) => {
					try {
						return new crypto_1.X509Certificate(pem);
					} catch (err) {
						const message = err instanceof Error ? err.message : String(err);
						throw new InvalidConfigurationError(`Failed to parse certificate at index ${index} in trust chain file ${this.trustChainPath}: ${message}`);
					}
				});
				const leafIndex = chainCerts.findIndex((chainCert) => leafCert.raw.equals(chainCert.raw));
				let finalChain;
				if (leafIndex === -1) finalChain = [leafCert, ...chainCerts];
				else if (leafIndex === 0) finalChain = chainCerts;
				else throw new InvalidConfigurationError(`Leaf certificate exists in the trust chain but is not the first entry (found at index ${leafIndex}).`);
				return JSON.stringify(finalChain.map((cert) => cert.raw.toString("base64")));
			} catch (err) {
				if (err instanceof InvalidConfigurationError) throw err;
				const message = err instanceof Error ? err.message : String(err);
				throw new CertificateSourceUnavailableError(`Failed to process certificate chain from ${this.trustChainPath}: ${message}`);
			}
		}
	};
	exports.CertificateSubjectTokenSupplier = CertificateSubjectTokenSupplier;
}));
//#endregion
//#region ../../node_modules/.pnpm/google-auth-library@11.1.0/node_modules/google-auth-library/build/src/auth/identitypoolclient.js
var require_identitypoolclient = /* @__PURE__ */ __commonJSMin(((exports) => {
	Object.defineProperty(exports, "__esModule", { value: true });
	exports.IdentityPoolClient = void 0;
	const baseexternalclient_1 = require_baseexternalclient();
	const util_1 = require_util$1();
	const filesubjecttokensupplier_1 = require_filesubjecttokensupplier();
	const urlsubjecttokensupplier_1 = require_urlsubjecttokensupplier();
	const certificatesubjecttokensupplier_1 = require_certificatesubjecttokensupplier();
	const stscredentials_1 = require_stscredentials();
	const gaxios_1 = require_src$4();
	exports.IdentityPoolClient = class IdentityPoolClient extends baseexternalclient_1.BaseExternalAccountClient {
		subjectTokenSupplier;
		/**
		* Instantiate an IdentityPoolClient instance using the provided JSON
		* object loaded from an external account credentials file.
		* An error is thrown if the credential is not a valid file-sourced or
		* url-sourced credential or a workforce pool user project is provided
		* with a non workforce audience.
		* @param options The external account options object typically loaded
		*   from the external account JSON credential file. The camelCased options
		*   are aliases for the snake_cased options.
		*/
		constructor(options) {
			super(options);
			const opts = (0, util_1.originalOrCamelOptions)(options);
			const credentialSource = opts.get("credential_source");
			const subjectTokenSupplier = opts.get("subject_token_supplier");
			if (!credentialSource && !subjectTokenSupplier) throw new Error("A credential source or subject token supplier must be specified.");
			if (credentialSource && subjectTokenSupplier) throw new Error("Only one of credential source or subject token supplier can be specified.");
			if (subjectTokenSupplier) {
				this.subjectTokenSupplier = subjectTokenSupplier;
				this.credentialSourceType = "programmatic";
			} else {
				const credentialSourceOpts = (0, util_1.originalOrCamelOptions)(credentialSource);
				const formatOpts = (0, util_1.originalOrCamelOptions)(credentialSourceOpts.get("format"));
				const formatType = formatOpts.get("type") || "text";
				const formatSubjectTokenFieldName = formatOpts.get("subject_token_field_name");
				if (formatType !== "json" && formatType !== "text") throw new Error(`Invalid credential_source format "${formatType}"`);
				if (formatType === "json" && !formatSubjectTokenFieldName) throw new Error("Missing subject_token_field_name for JSON credential_source format");
				const file = credentialSourceOpts.get("file");
				const url = credentialSourceOpts.get("url");
				const certificate = credentialSourceOpts.get("certificate");
				const headers = credentialSourceOpts.get("headers");
				if (file && url || url && certificate || file && certificate) throw new Error("No valid Identity Pool \"credential_source\" provided, must be either file, url, or certificate.");
				else if (file) {
					this.credentialSourceType = "file";
					this.subjectTokenSupplier = new filesubjecttokensupplier_1.FileSubjectTokenSupplier({
						filePath: file,
						formatType,
						subjectTokenFieldName: formatSubjectTokenFieldName
					});
				} else if (url) {
					this.credentialSourceType = "url";
					this.subjectTokenSupplier = new urlsubjecttokensupplier_1.UrlSubjectTokenSupplier({
						url,
						formatType,
						subjectTokenFieldName: formatSubjectTokenFieldName,
						headers,
						additionalGaxiosOptions: IdentityPoolClient.RETRY_CONFIG
					});
				} else if (certificate) {
					this.credentialSourceType = "certificate";
					const certificateSubjecttokensupplier = new certificatesubjecttokensupplier_1.CertificateSubjectTokenSupplier({
						useDefaultCertificateConfig: certificate.use_default_certificate_config,
						certificateConfigLocation: certificate.certificate_config_location,
						trustChainPath: certificate.trust_chain_path
					});
					this.subjectTokenSupplier = certificateSubjecttokensupplier;
				} else throw new Error("No valid Identity Pool \"credential_source\" provided, must be either file, url, or certificate.");
			}
		}
		/**
		* Triggered when a external subject token is needed to be exchanged for a GCP
		* access token via GCP STS endpoint. Gets a subject token by calling
		* the configured {@link SubjectTokenSupplier}
		* @return A promise that resolves with the external subject token.
		*/
		async retrieveSubjectToken() {
			const subjectToken = await this.subjectTokenSupplier.getSubjectToken(this.supplierContext);
			if (this.subjectTokenSupplier instanceof certificatesubjecttokensupplier_1.CertificateSubjectTokenSupplier) {
				const mtlsAgent = await this.subjectTokenSupplier.createMtlsHttpsAgent();
				this.stsCredential = new stscredentials_1.StsCredentials({
					tokenExchangeEndpoint: this.getTokenUrl(),
					clientAuthentication: this.clientAuth,
					transporter: new gaxios_1.Gaxios({ agent: mtlsAgent })
				});
				this.transporter = new gaxios_1.Gaxios({
					...this.transporter.defaults || {},
					agent: mtlsAgent
				});
			}
			return subjectToken;
		}
	};
}));
//#endregion
//#region ../../node_modules/.pnpm/google-auth-library@11.1.0/node_modules/google-auth-library/build/src/auth/awsrequestsigner.js
var require_awsrequestsigner = /* @__PURE__ */ __commonJSMin(((exports) => {
	Object.defineProperty(exports, "__esModule", { value: true });
	exports.AwsRequestSigner = void 0;
	const gaxios_1 = require_src$4();
	const crypto_1 = require_crypto();
	/** AWS Signature Version 4 signing algorithm identifier.  */
	const AWS_ALGORITHM = "AWS4-HMAC-SHA256";
	/**
	* The termination string for the AWS credential scope value as defined in
	* https://docs.aws.amazon.com/general/latest/gr/sigv4-create-string-to-sign.html
	*/
	const AWS_REQUEST_TYPE = "aws4_request";
	/**
	* Implements an AWS API request signer based on the AWS Signature Version 4
	* signing process.
	* https://docs.aws.amazon.com/general/latest/gr/signature-version-4.html
	*/
	var AwsRequestSigner = class {
		getCredentials;
		region;
		crypto;
		/**
		* Instantiates an AWS API request signer used to send authenticated signed
		* requests to AWS APIs based on the AWS Signature Version 4 signing process.
		* This also provides a mechanism to generate the signed request without
		* sending it.
		* @param getCredentials A mechanism to retrieve AWS security credentials
		*   when needed.
		* @param region The AWS region to use.
		*/
		constructor(getCredentials, region) {
			this.getCredentials = getCredentials;
			this.region = region;
			this.crypto = (0, crypto_1.createCrypto)();
		}
		/**
		* Generates the signed request for the provided HTTP request for calling
		* an AWS API. This follows the steps described at:
		* https://docs.aws.amazon.com/general/latest/gr/sigv4_signing.html
		* @param amzOptions The AWS request options that need to be signed.
		* @return A promise that resolves with the GaxiosOptions containing the
		*   signed HTTP request parameters.
		*/
		async getRequestOptions(amzOptions) {
			if (!amzOptions.url) throw new RangeError("\"url\" is required in \"amzOptions\"");
			const requestPayloadData = typeof amzOptions.data === "object" ? JSON.stringify(amzOptions.data) : amzOptions.data;
			const url = amzOptions.url;
			const method = amzOptions.method || "GET";
			const requestPayload = amzOptions.body || requestPayloadData;
			const additionalAmzHeaders = amzOptions.headers;
			const awsSecurityCredentials = await this.getCredentials();
			const uri = new URL(url);
			if (typeof requestPayload !== "string" && requestPayload !== void 0) throw new TypeError(`'requestPayload' is expected to be a string if provided. Got: ${requestPayload}`);
			const headerMap = await generateAuthenticationHeaderMap({
				crypto: this.crypto,
				host: uri.host,
				canonicalUri: uri.pathname,
				canonicalQuerystring: uri.search.slice(1),
				method,
				region: this.region,
				securityCredentials: awsSecurityCredentials,
				requestPayload,
				additionalAmzHeaders
			});
			const headers = gaxios_1.Gaxios.mergeHeaders(headerMap.amzDate ? { "x-amz-date": headerMap.amzDate } : {}, {
				authorization: headerMap.authorizationHeader,
				host: uri.host
			}, additionalAmzHeaders || {});
			if (awsSecurityCredentials.token) gaxios_1.Gaxios.mergeHeaders(headers, { "x-amz-security-token": awsSecurityCredentials.token });
			const awsSignedReq = {
				url,
				method,
				headers
			};
			if (requestPayload !== void 0) awsSignedReq.body = requestPayload;
			return awsSignedReq;
		}
	};
	exports.AwsRequestSigner = AwsRequestSigner;
	/**
	* Creates the HMAC-SHA256 hash of the provided message using the
	* provided key.
	*
	* @param crypto The crypto instance used to facilitate cryptographic
	*   operations.
	* @param key The HMAC-SHA256 key to use.
	* @param msg The message to hash.
	* @return The computed hash bytes.
	*/
	async function sign(crypto, key, msg) {
		return await crypto.signWithHmacSha256(key, msg);
	}
	/**
	* Calculates the signing key used to calculate the signature for
	* AWS Signature Version 4 based on:
	* https://docs.aws.amazon.com/general/latest/gr/sigv4-calculate-signature.html
	*
	* @param crypto The crypto instance used to facilitate cryptographic
	*   operations.
	* @param key The AWS secret access key.
	* @param dateStamp The '%Y%m%d' date format.
	* @param region The AWS region.
	* @param serviceName The AWS service name, eg. sts.
	* @return The signing key bytes.
	*/
	async function getSigningKey(crypto, key, dateStamp, region, serviceName) {
		return await sign(crypto, await sign(crypto, await sign(crypto, await sign(crypto, `AWS4${key}`, dateStamp), region), serviceName), "aws4_request");
	}
	/**
	* Generates the authentication header map needed for generating the AWS
	* Signature Version 4 signed request.
	*
	* @param option The options needed to compute the authentication header map.
	* @return The AWS authentication header map which constitutes of the following
	*   components: amz-date, authorization header and canonical query string.
	*/
	async function generateAuthenticationHeaderMap(options) {
		const additionalAmzHeaders = gaxios_1.Gaxios.mergeHeaders(options.additionalAmzHeaders);
		const requestPayload = options.requestPayload || "";
		const serviceName = options.host.split(".")[0];
		const now = /* @__PURE__ */ new Date();
		const amzDate = now.toISOString().replace(/[-:]/g, "").replace(/\.[0-9]+/, "");
		const dateStamp = now.toISOString().replace(/[-]/g, "").replace(/T.*/, "");
		if (options.securityCredentials.token) additionalAmzHeaders.set("x-amz-security-token", options.securityCredentials.token);
		const amzHeaders = gaxios_1.Gaxios.mergeHeaders({ host: options.host }, additionalAmzHeaders.has("date") ? {} : { "x-amz-date": amzDate }, additionalAmzHeaders);
		let canonicalHeaders = "";
		const signedHeadersList = [...amzHeaders.keys()].sort();
		signedHeadersList.forEach((key) => {
			canonicalHeaders += `${key}:${amzHeaders.get(key)}\n`;
		});
		const signedHeaders = signedHeadersList.join(";");
		const payloadHash = await options.crypto.sha256DigestHex(requestPayload);
		const canonicalRequest = `${options.method.toUpperCase()}\n${options.canonicalUri}\n${options.canonicalQuerystring}\n${canonicalHeaders}\n${signedHeaders}\n${payloadHash}`;
		const credentialScope = `${dateStamp}/${options.region}/${serviceName}/${AWS_REQUEST_TYPE}`;
		const stringToSign = `${AWS_ALGORITHM}\n${amzDate}\n${credentialScope}\n` + await options.crypto.sha256DigestHex(canonicalRequest);
		const signingKey = await getSigningKey(options.crypto, options.securityCredentials.secretAccessKey, dateStamp, options.region, serviceName);
		const signature = await sign(options.crypto, signingKey, stringToSign);
		const authorizationHeader = `${AWS_ALGORITHM} Credential=${options.securityCredentials.accessKeyId}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${(0, crypto_1.fromArrayBufferToHex)(signature)}`;
		return {
			amzDate: additionalAmzHeaders.has("date") ? void 0 : amzDate,
			authorizationHeader,
			canonicalQuerystring: options.canonicalQuerystring
		};
	}
}));
//#endregion
//#region ../../node_modules/.pnpm/google-auth-library@11.1.0/node_modules/google-auth-library/build/src/auth/defaultawssecuritycredentialssupplier.js
var require_defaultawssecuritycredentialssupplier = /* @__PURE__ */ __commonJSMin(((exports) => {
	Object.defineProperty(exports, "__esModule", { value: true });
	exports.DefaultAwsSecurityCredentialsSupplier = void 0;
	const authclient_1 = require_authclient();
	/**
	* Internal AWS security credentials supplier implementation used by {@link AwsClient}
	* when a credential source is provided instead of a user defined supplier.
	* The logic is summarized as:
	* 1. If imdsv2_session_token_url is provided in the credential source, then
	*    fetch the aws session token and include it in the headers of the
	*    metadata requests. This is a requirement for IDMSv2 but optional
	*    for IDMSv1.
	* 2. Retrieve AWS region from availability-zone.
	* 3a. Check AWS credentials in environment variables. If not found, get
	*     from security-credentials endpoint.
	* 3b. Get AWS credentials from security-credentials endpoint. In order
	*     to retrieve this, the AWS role needs to be determined by calling
	*     security-credentials endpoint without any argument. Then the
	*     credentials can be retrieved via: security-credentials/role_name
	* 4. Generate the signed request to AWS STS GetCallerIdentity action.
	* 5. Inject x-goog-cloud-target-resource into header and serialize the
	*    signed request. This will be the subject-token to pass to GCP STS.
	*/
	var DefaultAwsSecurityCredentialsSupplier = class {
		regionUrl;
		securityCredentialsUrl;
		imdsV2SessionTokenUrl;
		additionalGaxiosOptions;
		/**
		* Instantiates a new DefaultAwsSecurityCredentialsSupplier using information
		* from the credential_source stored in the ADC file.
		* @param opts The default aws security credentials supplier options object to
		*   build the supplier with.
		*/
		constructor(opts) {
			this.regionUrl = opts.regionUrl;
			this.securityCredentialsUrl = opts.securityCredentialsUrl;
			this.imdsV2SessionTokenUrl = opts.imdsV2SessionTokenUrl;
			this.additionalGaxiosOptions = opts.additionalGaxiosOptions;
		}
		/**
		* Returns the active AWS region. This first checks to see if the region
		* is available as an environment variable. If it is not, then the supplier
		* will call the region URL.
		* @param context {@link ExternalAccountSupplierContext} from the calling
		*   {@link AwsClient}, contains the requested audience and subject token type
		*   for the external account identity.
		* @return A promise that resolves with the AWS region string.
		*/
		async getAwsRegion(context) {
			if (this.#regionFromEnv) return this.#regionFromEnv;
			const metadataHeaders = new Headers();
			if (!this.#regionFromEnv && this.imdsV2SessionTokenUrl) metadataHeaders.set("x-aws-ec2-metadata-token", await this.#getImdsV2SessionToken(context.transporter));
			if (!this.regionUrl) throw new RangeError("Unable to determine AWS region due to missing \"options.credential_source.region_url\"");
			const opts = {
				...this.additionalGaxiosOptions,
				url: this.regionUrl,
				method: "GET",
				responseType: "text",
				headers: metadataHeaders
			};
			authclient_1.AuthClient.setMethodName(opts, "getAwsRegion");
			const response = await context.transporter.request(opts);
			return response.data.substr(0, response.data.length - 1);
		}
		/**
		* Returns AWS security credentials. This first checks to see if the credentials
		* is available as environment variables. If it is not, then the supplier
		* will call the security credentials URL.
		* @param context {@link ExternalAccountSupplierContext} from the calling
		*   {@link AwsClient}, contains the requested audience and subject token type
		*   for the external account identity.
		* @return A promise that resolves with the AWS security credentials.
		*/
		async getAwsSecurityCredentials(context) {
			if (this.#securityCredentialsFromEnv) return this.#securityCredentialsFromEnv;
			const metadataHeaders = new Headers();
			if (this.imdsV2SessionTokenUrl) metadataHeaders.set("x-aws-ec2-metadata-token", await this.#getImdsV2SessionToken(context.transporter));
			const roleName = await this.#getAwsRoleName(metadataHeaders, context.transporter);
			const awsCreds = await this.#retrieveAwsSecurityCredentials(roleName, metadataHeaders, context.transporter);
			return {
				accessKeyId: awsCreds.AccessKeyId,
				secretAccessKey: awsCreds.SecretAccessKey,
				token: awsCreds.Token
			};
		}
		/**
		* @param transporter The transporter to use for requests.
		* @return A promise that resolves with the IMDSv2 Session Token.
		*/
		async #getImdsV2SessionToken(transporter) {
			const opts = {
				...this.additionalGaxiosOptions,
				url: this.imdsV2SessionTokenUrl,
				method: "PUT",
				responseType: "text",
				headers: { "x-aws-ec2-metadata-token-ttl-seconds": "300" }
			};
			authclient_1.AuthClient.setMethodName(opts, "#getImdsV2SessionToken");
			return (await transporter.request(opts)).data;
		}
		/**
		* @param headers The headers to be used in the metadata request.
		* @param transporter The transporter to use for requests.
		* @return A promise that resolves with the assigned role to the current
		*   AWS VM. This is needed for calling the security-credentials endpoint.
		*/
		async #getAwsRoleName(headers, transporter) {
			if (!this.securityCredentialsUrl) throw new Error("Unable to determine AWS role name due to missing \"options.credential_source.url\"");
			const opts = {
				...this.additionalGaxiosOptions,
				url: this.securityCredentialsUrl,
				method: "GET",
				responseType: "text",
				headers
			};
			authclient_1.AuthClient.setMethodName(opts, "#getAwsRoleName");
			return (await transporter.request(opts)).data;
		}
		/**
		* Retrieves the temporary AWS credentials by calling the security-credentials
		* endpoint as specified in the `credential_source` object.
		* @param roleName The role attached to the current VM.
		* @param headers The headers to be used in the metadata request.
		* @param transporter The transporter to use for requests.
		* @return A promise that resolves with the temporary AWS credentials
		*   needed for creating the GetCallerIdentity signed request.
		*/
		async #retrieveAwsSecurityCredentials(roleName, headers, transporter) {
			const opts = {
				...this.additionalGaxiosOptions,
				url: `${this.securityCredentialsUrl}/${roleName}`,
				headers,
				responseType: "json"
			};
			authclient_1.AuthClient.setMethodName(opts, "#retrieveAwsSecurityCredentials");
			return (await transporter.request(opts)).data;
		}
		get #regionFromEnv() {
			return process.env["AWS_REGION"] || process.env["AWS_DEFAULT_REGION"] || null;
		}
		get #securityCredentialsFromEnv() {
			if (process.env["AWS_ACCESS_KEY_ID"] && process.env["AWS_SECRET_ACCESS_KEY"]) return {
				accessKeyId: process.env["AWS_ACCESS_KEY_ID"],
				secretAccessKey: process.env["AWS_SECRET_ACCESS_KEY"],
				token: process.env["AWS_SESSION_TOKEN"]
			};
			return null;
		}
	};
	exports.DefaultAwsSecurityCredentialsSupplier = DefaultAwsSecurityCredentialsSupplier;
}));
//#endregion
//#region ../../node_modules/.pnpm/google-auth-library@11.1.0/node_modules/google-auth-library/build/src/auth/awsclient.js
var require_awsclient = /* @__PURE__ */ __commonJSMin(((exports) => {
	Object.defineProperty(exports, "__esModule", { value: true });
	exports.AwsClient = void 0;
	const awsrequestsigner_1 = require_awsrequestsigner();
	const baseexternalclient_1 = require_baseexternalclient();
	const defaultawssecuritycredentialssupplier_1 = require_defaultawssecuritycredentialssupplier();
	const util_1 = require_util$1();
	const gaxios_1 = require_src$4();
	exports.AwsClient = class AwsClient extends baseexternalclient_1.BaseExternalAccountClient {
		environmentId;
		awsSecurityCredentialsSupplier;
		regionalCredVerificationUrl;
		awsRequestSigner;
		region;
		static #DEFAULT_AWS_REGIONAL_CREDENTIAL_VERIFICATION_URL = "https://sts.{region}.amazonaws.com?Action=GetCallerIdentity&Version=2011-06-15";
		/**
		* @deprecated AWS client no validates the EC2 metadata address.
		**/
		static AWS_EC2_METADATA_IPV4_ADDRESS = "169.254.169.254";
		/**
		* @deprecated AWS client no validates the EC2 metadata address.
		**/
		static AWS_EC2_METADATA_IPV6_ADDRESS = "fd00:ec2::254";
		/**
		* Instantiates an AwsClient instance using the provided JSON
		* object loaded from an external account credentials file.
		* An error is thrown if the credential is not a valid AWS credential.
		* @param options The external account options object typically loaded
		*   from the external account JSON credential file.
		*/
		constructor(options) {
			super(options);
			const opts = (0, util_1.originalOrCamelOptions)(options);
			const credentialSource = opts.get("credential_source");
			const awsSecurityCredentialsSupplier = opts.get("aws_security_credentials_supplier");
			if (!credentialSource && !awsSecurityCredentialsSupplier) throw new Error("A credential source or AWS security credentials supplier must be specified.");
			if (credentialSource && awsSecurityCredentialsSupplier) throw new Error("Only one of credential source or AWS security credentials supplier can be specified.");
			if (awsSecurityCredentialsSupplier) {
				this.awsSecurityCredentialsSupplier = awsSecurityCredentialsSupplier;
				this.regionalCredVerificationUrl = AwsClient.#DEFAULT_AWS_REGIONAL_CREDENTIAL_VERIFICATION_URL;
				this.credentialSourceType = "programmatic";
			} else {
				const credentialSourceOpts = (0, util_1.originalOrCamelOptions)(credentialSource);
				this.environmentId = credentialSourceOpts.get("environment_id");
				const regionUrl = credentialSourceOpts.get("region_url");
				const securityCredentialsUrl = credentialSourceOpts.get("url");
				const imdsV2SessionTokenUrl = credentialSourceOpts.get("imdsv2_session_token_url");
				this.awsSecurityCredentialsSupplier = new defaultawssecuritycredentialssupplier_1.DefaultAwsSecurityCredentialsSupplier({
					regionUrl,
					securityCredentialsUrl,
					imdsV2SessionTokenUrl
				});
				this.regionalCredVerificationUrl = credentialSourceOpts.get("regional_cred_verification_url");
				this.credentialSourceType = "aws";
				this.validateEnvironmentId();
			}
			this.awsRequestSigner = null;
			this.region = "";
		}
		validateEnvironmentId() {
			const match = this.environmentId?.match(/^(aws)(\d+)$/);
			if (!match || !this.regionalCredVerificationUrl) throw new Error("No valid AWS \"credential_source\" provided");
			else if (parseInt(match[2], 10) !== 1) throw new Error(`aws version "${match[2]}" is not supported in the current build.`);
		}
		/**
		* Triggered when an external subject token is needed to be exchanged for a
		* GCP access token via GCP STS endpoint. This will call the
		* {@link AwsSecurityCredentialsSupplier} to retrieve an AWS region and AWS
		* Security Credentials, then use them to create a signed AWS STS request that
		* can be exchanged for a GCP access token.
		* @return A promise that resolves with the external subject token.
		*/
		async retrieveSubjectToken() {
			if (!this.awsRequestSigner) {
				this.region = await this.awsSecurityCredentialsSupplier.getAwsRegion(this.supplierContext);
				this.awsRequestSigner = new awsrequestsigner_1.AwsRequestSigner(async () => {
					return this.awsSecurityCredentialsSupplier.getAwsSecurityCredentials(this.supplierContext);
				}, this.region);
			}
			const options = await this.awsRequestSigner.getRequestOptions({
				...AwsClient.RETRY_CONFIG,
				url: this.regionalCredVerificationUrl.replace("{region}", this.region),
				method: "POST"
			});
			const reformattedHeader = [];
			gaxios_1.Gaxios.mergeHeaders({ "x-goog-cloud-target-resource": this.audience }, options.headers).forEach((value, key) => reformattedHeader.push({
				key,
				value
			}));
			return encodeURIComponent(JSON.stringify({
				url: options.url,
				method: options.method,
				headers: reformattedHeader
			}));
		}
	};
}));
//#endregion
//#region ../../node_modules/.pnpm/google-auth-library@11.1.0/node_modules/google-auth-library/build/src/auth/executable-response.js
var require_executable_response = /* @__PURE__ */ __commonJSMin(((exports) => {
	Object.defineProperty(exports, "__esModule", { value: true });
	exports.InvalidSubjectTokenError = exports.InvalidMessageFieldError = exports.InvalidCodeFieldError = exports.InvalidTokenTypeFieldError = exports.InvalidExpirationTimeFieldError = exports.InvalidSuccessFieldError = exports.InvalidVersionFieldError = exports.ExecutableResponseError = exports.ExecutableResponse = void 0;
	const SAML_SUBJECT_TOKEN_TYPE = "urn:ietf:params:oauth:token-type:saml2";
	const OIDC_SUBJECT_TOKEN_TYPE1 = "urn:ietf:params:oauth:token-type:id_token";
	const OIDC_SUBJECT_TOKEN_TYPE2 = "urn:ietf:params:oauth:token-type:jwt";
	/**
	* Defines the response of a 3rd party executable run by the pluggable auth client.
	*/
	var ExecutableResponse = class {
		/**
		* The version of the Executable response. Only version 1 is currently supported.
		*/
		version;
		/**
		* Whether the executable ran successfully.
		*/
		success;
		/**
		* The epoch time for expiration of the token in seconds.
		*/
		expirationTime;
		/**
		* The type of subject token in the response, currently supported values are:
		* urn:ietf:params:oauth:token-type:saml2
		* urn:ietf:params:oauth:token-type:id_token
		* urn:ietf:params:oauth:token-type:jwt
		*/
		tokenType;
		/**
		* The error code from the executable.
		*/
		errorCode;
		/**
		* The error message from the executable.
		*/
		errorMessage;
		/**
		* The subject token from the executable, format depends on tokenType.
		*/
		subjectToken;
		/**
		* Instantiates an ExecutableResponse instance using the provided JSON object
		* from the output of the executable.
		* @param responseJson Response from a 3rd party executable, loaded from a
		* run of the executable or a cached output file.
		*/
		constructor(responseJson) {
			if (!responseJson.version) throw new InvalidVersionFieldError("Executable response must contain a 'version' field.");
			if (responseJson.success === void 0) throw new InvalidSuccessFieldError("Executable response must contain a 'success' field.");
			this.version = responseJson.version;
			this.success = responseJson.success;
			if (this.success) {
				this.expirationTime = responseJson.expiration_time;
				this.tokenType = responseJson.token_type;
				if (this.tokenType !== SAML_SUBJECT_TOKEN_TYPE && this.tokenType !== OIDC_SUBJECT_TOKEN_TYPE1 && this.tokenType !== OIDC_SUBJECT_TOKEN_TYPE2) throw new InvalidTokenTypeFieldError(`Executable response must contain a 'token_type' field when successful and it must be one of ${OIDC_SUBJECT_TOKEN_TYPE1}, ${OIDC_SUBJECT_TOKEN_TYPE2}, or ${SAML_SUBJECT_TOKEN_TYPE}.`);
				if (this.tokenType === SAML_SUBJECT_TOKEN_TYPE) {
					if (!responseJson.saml_response) throw new InvalidSubjectTokenError(`Executable response must contain a 'saml_response' field when token_type=${SAML_SUBJECT_TOKEN_TYPE}.`);
					this.subjectToken = responseJson.saml_response;
				} else {
					if (!responseJson.id_token) throw new InvalidSubjectTokenError(`Executable response must contain a 'id_token' field when token_type=${OIDC_SUBJECT_TOKEN_TYPE1} or ${OIDC_SUBJECT_TOKEN_TYPE2}.`);
					this.subjectToken = responseJson.id_token;
				}
			} else {
				if (!responseJson.code) throw new InvalidCodeFieldError("Executable response must contain a 'code' field when unsuccessful.");
				if (!responseJson.message) throw new InvalidMessageFieldError("Executable response must contain a 'message' field when unsuccessful.");
				this.errorCode = responseJson.code;
				this.errorMessage = responseJson.message;
			}
		}
		/**
		* @return A boolean representing if the response has a valid token. Returns
		* true when the response was successful and the token is not expired.
		*/
		isValid() {
			return !this.isExpired() && this.success;
		}
		/**
		* @return A boolean representing if the response is expired. Returns true if the
		* provided timeout has passed.
		*/
		isExpired() {
			return this.expirationTime !== void 0 && this.expirationTime < Math.round(Date.now() / 1e3);
		}
	};
	exports.ExecutableResponse = ExecutableResponse;
	/**
	* An error thrown by the ExecutableResponse class.
	*/
	var ExecutableResponseError = class extends Error {
		constructor(message) {
			super(message);
			Object.setPrototypeOf(this, new.target.prototype);
		}
	};
	exports.ExecutableResponseError = ExecutableResponseError;
	/**
	* An error thrown when the 'version' field in an executable response is missing or invalid.
	*/
	var InvalidVersionFieldError = class extends ExecutableResponseError {};
	exports.InvalidVersionFieldError = InvalidVersionFieldError;
	/**
	* An error thrown when the 'success' field in an executable response is missing or invalid.
	*/
	var InvalidSuccessFieldError = class extends ExecutableResponseError {};
	exports.InvalidSuccessFieldError = InvalidSuccessFieldError;
	/**
	* An error thrown when the 'expiration_time' field in an executable response is missing or invalid.
	*/
	var InvalidExpirationTimeFieldError = class extends ExecutableResponseError {};
	exports.InvalidExpirationTimeFieldError = InvalidExpirationTimeFieldError;
	/**
	* An error thrown when the 'token_type' field in an executable response is missing or invalid.
	*/
	var InvalidTokenTypeFieldError = class extends ExecutableResponseError {};
	exports.InvalidTokenTypeFieldError = InvalidTokenTypeFieldError;
	/**
	* An error thrown when the 'code' field in an executable response is missing or invalid.
	*/
	var InvalidCodeFieldError = class extends ExecutableResponseError {};
	exports.InvalidCodeFieldError = InvalidCodeFieldError;
	/**
	* An error thrown when the 'message' field in an executable response is missing or invalid.
	*/
	var InvalidMessageFieldError = class extends ExecutableResponseError {};
	exports.InvalidMessageFieldError = InvalidMessageFieldError;
	/**
	* An error thrown when the subject token in an executable response is missing or invalid.
	*/
	var InvalidSubjectTokenError = class extends ExecutableResponseError {};
	exports.InvalidSubjectTokenError = InvalidSubjectTokenError;
}));
//#endregion
//#region ../../node_modules/.pnpm/google-auth-library@11.1.0/node_modules/google-auth-library/build/src/auth/pluggable-auth-handler.js
var require_pluggable_auth_handler = /* @__PURE__ */ __commonJSMin(((exports) => {
	Object.defineProperty(exports, "__esModule", { value: true });
	exports.PluggableAuthHandler = exports.ExecutableError = void 0;
	const executable_response_1 = require_executable_response();
	const childProcess = __require("child_process");
	const fs$3 = __require("fs");
	/**
	* Error thrown from the executable run by PluggableAuthClient.
	*/
	var ExecutableError = class extends Error {
		/**
		* The exit code returned by the executable.
		*/
		code;
		constructor(message, code) {
			super(`The executable failed with exit code: ${code} and error message: ${message}.`);
			this.code = code;
			Object.setPrototypeOf(this, new.target.prototype);
		}
	};
	exports.ExecutableError = ExecutableError;
	exports.PluggableAuthHandler = class PluggableAuthHandler {
		commandComponents;
		timeoutMillis;
		outputFile;
		/**
		* Instantiates a PluggableAuthHandler instance using the provided
		* PluggableAuthHandlerOptions object.
		*/
		constructor(options) {
			if (!options.command) throw new Error("No command provided.");
			this.commandComponents = PluggableAuthHandler.parseCommand(options.command);
			this.timeoutMillis = options.timeoutMillis;
			if (!this.timeoutMillis) throw new Error("No timeoutMillis provided.");
			this.outputFile = options.outputFile;
		}
		/**
		* Calls user provided executable to get a 3rd party subject token and
		* returns the response.
		* @param envMap a Map of additional Environment Variables required for
		*   the executable.
		* @return A promise that resolves with the executable response.
		*/
		retrieveResponseFromExecutable(envMap) {
			return new Promise((resolve, reject) => {
				const child = childProcess.spawn(this.commandComponents[0], this.commandComponents.slice(1), { env: {
					...process.env,
					...Object.fromEntries(envMap)
				} });
				let output = "";
				child.stdout.on("data", (data) => {
					output += data;
				});
				child.stderr.on("data", (err) => {
					output += err;
				});
				const timeout = setTimeout(() => {
					child.removeAllListeners();
					child.kill();
					return reject(/* @__PURE__ */ new Error("The executable failed to finish within the timeout specified."));
				}, this.timeoutMillis);
				child.on("close", (code) => {
					clearTimeout(timeout);
					if (code === 0) try {
						const responseJson = JSON.parse(output);
						return resolve(new executable_response_1.ExecutableResponse(responseJson));
					} catch (error) {
						if (error instanceof executable_response_1.ExecutableResponseError) return reject(error);
						return reject(new executable_response_1.ExecutableResponseError(`The executable returned an invalid response: ${output}`));
					}
					else return reject(new ExecutableError(output, code.toString()));
				});
			});
		}
		/**
		* Checks user provided output file for response from previous run of
		* executable and return the response if it exists, is formatted correctly, and is not expired.
		*/
		async retrieveCachedResponse() {
			if (!this.outputFile || this.outputFile.length === 0) return;
			let filePath;
			try {
				filePath = await fs$3.promises.realpath(this.outputFile);
			} catch {
				return;
			}
			if (!(await fs$3.promises.lstat(filePath)).isFile()) return;
			const responseString = await fs$3.promises.readFile(filePath, { encoding: "utf8" });
			if (responseString === "") return;
			try {
				const responseJson = JSON.parse(responseString);
				if (new executable_response_1.ExecutableResponse(responseJson).isValid()) return new executable_response_1.ExecutableResponse(responseJson);
				return;
			} catch (error) {
				if (error instanceof executable_response_1.ExecutableResponseError) throw error;
				throw new executable_response_1.ExecutableResponseError(`The output file contained an invalid response: ${responseString}`);
			}
		}
		/**
		* Parses given command string into component array, splitting on spaces unless
		* spaces are between quotation marks.
		*/
		static parseCommand(command) {
			const components = command.match(/(?:[^\s"]+|"[^"]*")+/g);
			if (!components) throw new Error(`Provided command: "${command}" could not be parsed.`);
			for (let i = 0; i < components.length; i++) if (components[i][0] === "\"" && components[i].slice(-1) === "\"") components[i] = components[i].slice(1, -1);
			return components;
		}
	};
}));
//#endregion
//#region ../../node_modules/.pnpm/google-auth-library@11.1.0/node_modules/google-auth-library/build/src/auth/pluggable-auth-client.js
var require_pluggable_auth_client = /* @__PURE__ */ __commonJSMin(((exports) => {
	Object.defineProperty(exports, "__esModule", { value: true });
	exports.PluggableAuthClient = exports.ExecutableError = void 0;
	const baseexternalclient_1 = require_baseexternalclient();
	const executable_response_1 = require_executable_response();
	const pluggable_auth_handler_1 = require_pluggable_auth_handler();
	var pluggable_auth_handler_2 = require_pluggable_auth_handler();
	Object.defineProperty(exports, "ExecutableError", {
		enumerable: true,
		get: function() {
			return pluggable_auth_handler_2.ExecutableError;
		}
	});
	/**
	* The default executable timeout when none is provided, in milliseconds.
	*/
	const DEFAULT_EXECUTABLE_TIMEOUT_MILLIS = 3e4;
	/**
	* The minimum allowed executable timeout in milliseconds.
	*/
	const MINIMUM_EXECUTABLE_TIMEOUT_MILLIS = 5e3;
	/**
	* The maximum allowed executable timeout in milliseconds.
	*/
	const MAXIMUM_EXECUTABLE_TIMEOUT_MILLIS = 12e4;
	/**
	* The environment variable to check to see if executable can be run.
	* Value must be set to '1' for the executable to run.
	*/
	const GOOGLE_EXTERNAL_ACCOUNT_ALLOW_EXECUTABLES = "GOOGLE_EXTERNAL_ACCOUNT_ALLOW_EXECUTABLES";
	/**
	* The maximum currently supported executable version.
	*/
	const MAXIMUM_EXECUTABLE_VERSION = 1;
	/**
	* PluggableAuthClient enables the exchange of workload identity pool external credentials for
	* Google access tokens by retrieving 3rd party tokens through a user supplied executable. These
	* scripts/executables are completely independent of the Google Cloud Auth libraries. These
	* credentials plug into ADC and will call the specified executable to retrieve the 3rd party token
	* to be exchanged for a Google access token.
	*
	* <p>To use these credentials, the GOOGLE_EXTERNAL_ACCOUNT_ALLOW_EXECUTABLES environment variable
	* must be set to '1'. This is for security reasons.
	*
	* <p>Both OIDC and SAML are supported. The executable must adhere to a specific response format
	* defined below.
	*
	* <p>The executable must print out the 3rd party token to STDOUT in JSON format. When an
	* output_file is specified in the credential configuration, the executable must also handle writing the
	* JSON response to this file.
	*
	* <pre>
	* OIDC response sample:
	* {
	*   "version": 1,
	*   "success": true,
	*   "token_type": "urn:ietf:params:oauth:token-type:id_token",
	*   "id_token": "HEADER.PAYLOAD.SIGNATURE",
	*   "expiration_time": 1620433341
	* }
	*
	* SAML2 response sample:
	* {
	*   "version": 1,
	*   "success": true,
	*   "token_type": "urn:ietf:params:oauth:token-type:saml2",
	*   "saml_response": "...",
	*   "expiration_time": 1620433341
	* }
	*
	* Error response sample:
	* {
	*   "version": 1,
	*   "success": false,
	*   "code": "401",
	*   "message": "Error message."
	* }
	* </pre>
	*
	* <p>The "expiration_time" field in the JSON response is only required for successful
	* responses when an output file was specified in the credential configuration
	*
	* <p>The auth libraries will populate certain environment variables that will be accessible by the
	* executable, such as: GOOGLE_EXTERNAL_ACCOUNT_AUDIENCE, GOOGLE_EXTERNAL_ACCOUNT_TOKEN_TYPE,
	* GOOGLE_EXTERNAL_ACCOUNT_INTERACTIVE, GOOGLE_EXTERNAL_ACCOUNT_IMPERSONATED_EMAIL, and
	* GOOGLE_EXTERNAL_ACCOUNT_OUTPUT_FILE.
	*
	* <p>Please see this repositories README for a complete executable request/response specification.
	*/
	var PluggableAuthClient = class extends baseexternalclient_1.BaseExternalAccountClient {
		/**
		* The command used to retrieve the third party token.
		*/
		command;
		/**
		* The timeout in milliseconds for running executable,
		* set to default if none provided.
		*/
		timeoutMillis;
		/**
		* The path to file to check for cached executable response.
		*/
		outputFile;
		/**
		* Executable and output file handler.
		*/
		handler;
		/**
		* Instantiates a PluggableAuthClient instance using the provided JSON
		* object loaded from an external account credentials file.
		* An error is thrown if the credential is not a valid pluggable auth credential.
		* @param options The external account options object typically loaded from
		*   the external account JSON credential file.
		*/
		constructor(options) {
			super(options);
			if (!options.credential_source.executable) throw new Error("No valid Pluggable Auth \"credential_source\" provided.");
			this.command = options.credential_source.executable.command;
			if (!this.command) throw new Error("No valid Pluggable Auth \"credential_source\" provided.");
			if (options.credential_source.executable.timeout_millis === void 0) this.timeoutMillis = DEFAULT_EXECUTABLE_TIMEOUT_MILLIS;
			else {
				this.timeoutMillis = options.credential_source.executable.timeout_millis;
				if (this.timeoutMillis < MINIMUM_EXECUTABLE_TIMEOUT_MILLIS || this.timeoutMillis > MAXIMUM_EXECUTABLE_TIMEOUT_MILLIS) throw new Error(`Timeout must be between ${MINIMUM_EXECUTABLE_TIMEOUT_MILLIS} and ${MAXIMUM_EXECUTABLE_TIMEOUT_MILLIS} milliseconds.`);
			}
			this.outputFile = options.credential_source.executable.output_file;
			this.handler = new pluggable_auth_handler_1.PluggableAuthHandler({
				command: this.command,
				timeoutMillis: this.timeoutMillis,
				outputFile: this.outputFile
			});
			this.credentialSourceType = "executable";
		}
		/**
		* Triggered when an external subject token is needed to be exchanged for a
		* GCP access token via GCP STS endpoint.
		* This uses the `options.credential_source` object to figure out how
		* to retrieve the token using the current environment. In this case,
		* this calls a user provided executable which returns the subject token.
		* The logic is summarized as:
		* 1. Validated that the executable is allowed to run. The
		*    GOOGLE_EXTERNAL_ACCOUNT_ALLOW_EXECUTABLES environment must be set to
		*    1 for security reasons.
		* 2. If an output file is specified by the user, check the file location
		*    for a response. If the file exists and contains a valid response,
		*    return the subject token from the file.
		* 3. Call the provided executable and return response.
		* @return A promise that resolves with the external subject token.
		*/
		async retrieveSubjectToken() {
			if (process.env[GOOGLE_EXTERNAL_ACCOUNT_ALLOW_EXECUTABLES] !== "1") throw new Error("Pluggable Auth executables need to be explicitly allowed to run by setting the GOOGLE_EXTERNAL_ACCOUNT_ALLOW_EXECUTABLES environment Variable to 1.");
			let executableResponse = void 0;
			if (this.outputFile) executableResponse = await this.handler.retrieveCachedResponse();
			if (!executableResponse) {
				const envMap = /* @__PURE__ */ new Map();
				envMap.set("GOOGLE_EXTERNAL_ACCOUNT_AUDIENCE", this.audience);
				envMap.set("GOOGLE_EXTERNAL_ACCOUNT_TOKEN_TYPE", this.subjectTokenType);
				envMap.set("GOOGLE_EXTERNAL_ACCOUNT_INTERACTIVE", "0");
				if (this.outputFile) envMap.set("GOOGLE_EXTERNAL_ACCOUNT_OUTPUT_FILE", this.outputFile);
				const serviceAccountEmail = this.getServiceAccountEmail();
				if (serviceAccountEmail) envMap.set("GOOGLE_EXTERNAL_ACCOUNT_IMPERSONATED_EMAIL", serviceAccountEmail);
				executableResponse = await this.handler.retrieveResponseFromExecutable(envMap);
			}
			if (executableResponse.version > MAXIMUM_EXECUTABLE_VERSION) throw new Error(`Version of executable is not currently supported, maximum supported version is ${MAXIMUM_EXECUTABLE_VERSION}.`);
			if (!executableResponse.success) throw new pluggable_auth_handler_1.ExecutableError(executableResponse.errorMessage, executableResponse.errorCode);
			if (this.outputFile) {
				if (!executableResponse.expirationTime) throw new executable_response_1.InvalidExpirationTimeFieldError("The executable response must contain the `expiration_time` field for successful responses when an output_file has been specified in the configuration.");
			}
			if (executableResponse.isExpired()) throw new Error("Executable response is expired.");
			return executableResponse.subjectToken;
		}
	};
	exports.PluggableAuthClient = PluggableAuthClient;
}));
//#endregion
//#region ../../node_modules/.pnpm/google-auth-library@11.1.0/node_modules/google-auth-library/build/src/auth/externalclient.js
var require_externalclient = /* @__PURE__ */ __commonJSMin(((exports) => {
	Object.defineProperty(exports, "__esModule", { value: true });
	exports.ExternalAccountClient = void 0;
	const baseexternalclient_1 = require_baseexternalclient();
	const identitypoolclient_1 = require_identitypoolclient();
	const awsclient_1 = require_awsclient();
	const pluggable_auth_client_1 = require_pluggable_auth_client();
	/**
	* Dummy class with no constructor. Developers are expected to use fromJSON.
	*/
	var ExternalAccountClient = class {
		constructor() {
			throw new Error("ExternalAccountClients should be initialized via: ExternalAccountClient.fromJSON(), directly via explicit constructors, eg. new AwsClient(options), new IdentityPoolClient(options), newPluggableAuthClientOptions, or via new GoogleAuth(options).getClient()");
		}
		/**
		* This static method will instantiate the
		* corresponding type of external account credential depending on the
		* underlying credential source.
		*
		* **IMPORTANT**: This method does not validate the credential configuration.
		* A security risk occurs when a credential configuration configured with
		* malicious URLs is used. When the credential configuration is accepted from
		* an untrusted source, you should validate it before using it with this
		* method. For more details, see
		* https://cloud.google.com/docs/authentication/external/externally-sourced-credentials.
		*
		* @param options The external account options object typically loaded
		*   from the external account JSON credential file.
		* @return A BaseExternalAccountClient instance or null if the options
		*   provided do not correspond to an external account credential.
		*/
		static fromJSON(options) {
			if (options && options.type === baseexternalclient_1.EXTERNAL_ACCOUNT_TYPE) {
				if (options.credential_source?.environment_id) return new awsclient_1.AwsClient(options);
				else if (options.credential_source?.executable) return new pluggable_auth_client_1.PluggableAuthClient(options);
				else return new identitypoolclient_1.IdentityPoolClient(options);
			} else return null;
		}
	};
	exports.ExternalAccountClient = ExternalAccountClient;
}));
//#endregion
//#region ../../node_modules/.pnpm/google-auth-library@11.1.0/node_modules/google-auth-library/build/src/auth/externalAccountAuthorizedUserClient.js
var require_externalAccountAuthorizedUserClient = /* @__PURE__ */ __commonJSMin(((exports) => {
	Object.defineProperty(exports, "__esModule", { value: true });
	exports.ExternalAccountAuthorizedUserClient = exports.EXTERNAL_ACCOUNT_AUTHORIZED_USER_TYPE = void 0;
	const authclient_1 = require_authclient();
	const oauth2common_1 = require_oauth2common();
	const gaxios_1 = require_src$4();
	const stream$2 = __require("stream");
	const baseexternalclient_1 = require_baseexternalclient();
	/**
	* The credentials JSON file type for external account authorized user clients.
	*/
	exports.EXTERNAL_ACCOUNT_AUTHORIZED_USER_TYPE = "external_account_authorized_user";
	const DEFAULT_TOKEN_URL = "https://sts.{universeDomain}/v1/oauthtoken";
	/**
	* Handler for token refresh requests sent to the token_url endpoint for external
	* authorized user credentials.
	*/
	var ExternalAccountAuthorizedUserHandler = class ExternalAccountAuthorizedUserHandler extends oauth2common_1.OAuthClientAuthHandler {
		#tokenRefreshEndpoint;
		/**
		* Initializes an ExternalAccountAuthorizedUserHandler instance.
		* @param url The URL of the token refresh endpoint.
		* @param transporter The transporter to use for the refresh request.
		* @param clientAuthentication The client authentication credentials to use
		*   for the refresh request.
		*/
		constructor(options) {
			super(options);
			this.#tokenRefreshEndpoint = options.tokenRefreshEndpoint;
		}
		/**
		* Requests a new access token from the token_url endpoint using the provided
		*   refresh token.
		* @param refreshToken The refresh token to use to generate a new access token.
		* @param additionalHeaders Optional additional headers to pass along the
		*   request.
		* @return A promise that resolves with the token refresh response containing
		*   the requested access token and its expiration time.
		*/
		async refreshToken(refreshToken, headers) {
			const opts = {
				...ExternalAccountAuthorizedUserHandler.RETRY_CONFIG,
				url: this.#tokenRefreshEndpoint,
				method: "POST",
				headers,
				data: new URLSearchParams({
					grant_type: "refresh_token",
					refresh_token: refreshToken
				}),
				responseType: "json"
			};
			authclient_1.AuthClient.setMethodName(opts, "refreshToken");
			this.applyClientAuthenticationOptions(opts);
			try {
				const response = await this.transporter.request(opts);
				const tokenRefreshResponse = response.data;
				tokenRefreshResponse.res = response;
				return tokenRefreshResponse;
			} catch (error) {
				if (error instanceof gaxios_1.GaxiosError && error.response) throw (0, oauth2common_1.getErrorFromOAuthErrorResponse)(error.response.data, error);
				throw error;
			}
		}
	};
	/**
	* External Account Authorized User Client. This is used for OAuth2 credentials
	* sourced using external identities through Workforce Identity Federation.
	* Obtaining the initial access and refresh token can be done through the
	* Google Cloud CLI.
	*/
	var ExternalAccountAuthorizedUserClient = class extends authclient_1.AuthClient {
		cachedAccessToken;
		externalAccountAuthorizedUserHandler;
		refreshToken;
		/**
		* Instantiates an ExternalAccountAuthorizedUserClient instances using the
		* provided JSON object loaded from a credentials files.
		* An error is throws if the credential is not valid.
		* @param options The external account authorized user option object typically
		*   from the external accoutn authorized user JSON credential file.
		*/
		constructor(options) {
			super(options);
			if (options.universe_domain) this.universeDomain = options.universe_domain;
			this.refreshToken = options.refresh_token;
			const clientAuthentication = {
				confidentialClientType: "basic",
				clientId: options.client_id,
				clientSecret: options.client_secret
			};
			this.externalAccountAuthorizedUserHandler = new ExternalAccountAuthorizedUserHandler({
				tokenRefreshEndpoint: options.token_url ?? DEFAULT_TOKEN_URL.replace("{universeDomain}", this.universeDomain),
				transporter: this.transporter,
				clientAuthentication
			});
			this.cachedAccessToken = null;
			this.quotaProjectId = options.quota_project_id;
			if (typeof options?.eagerRefreshThresholdMillis !== "number") this.eagerRefreshThresholdMillis = baseexternalclient_1.EXPIRATION_TIME_OFFSET;
			else this.eagerRefreshThresholdMillis = options.eagerRefreshThresholdMillis;
			this.forceRefreshOnFailure = !!options?.forceRefreshOnFailure;
		}
		async getAccessToken() {
			if (!this.cachedAccessToken || this.isExpired(this.cachedAccessToken)) await this.refreshAccessTokenAsync();
			return {
				token: this.cachedAccessToken.access_token,
				res: this.cachedAccessToken.res
			};
		}
		async getRequestHeaders() {
			const accessTokenResponse = await this.getAccessToken();
			const headers = new Headers({ authorization: `Bearer ${accessTokenResponse.token}` });
			return this.addSharedMetadataHeaders(headers);
		}
		request(opts, callback) {
			if (callback) this.requestAsync(opts).then((r) => callback(null, r), (e) => {
				return callback(e, e.response);
			});
			else return this.requestAsync(opts);
		}
		/**
		* Authenticates the provided HTTP request, processes it and resolves with the
		* returned response.
		* @param opts The HTTP request options.
		* @param reAuthRetried Whether the current attempt is a retry after a failed attempt due to an auth failure.
		* @return A promise that resolves with the successful response.
		*/
		async requestAsync(opts, reAuthRetried = false) {
			let response;
			try {
				const requestHeaders = await this.getRequestHeaders();
				opts.headers = gaxios_1.Gaxios.mergeHeaders(opts.headers);
				this.addUserProjectAndAuthHeaders(opts.headers, requestHeaders);
				response = await this.transporter.request(opts);
			} catch (e) {
				const res = e.response;
				if (res) {
					const statusCode = res.status;
					const isReadableStream = res.config.data instanceof stream$2.Readable;
					if (!reAuthRetried && (statusCode === 401 || statusCode === 403) && !isReadableStream && this.forceRefreshOnFailure) {
						await this.refreshAccessTokenAsync();
						return await this.requestAsync(opts, true);
					}
				}
				throw e;
			}
			return response;
		}
		/**
		* Forces token refresh, even if unexpired tokens are currently cached.
		* @return A promise that resolves with the refreshed credential.
		*/
		async refreshAccessTokenAsync() {
			const refreshResponse = await this.externalAccountAuthorizedUserHandler.refreshToken(this.refreshToken);
			this.cachedAccessToken = {
				access_token: refreshResponse.access_token,
				expiry_date: (/* @__PURE__ */ new Date()).getTime() + refreshResponse.expires_in * 1e3,
				res: refreshResponse.res
			};
			if (refreshResponse.refresh_token !== void 0) this.refreshToken = refreshResponse.refresh_token;
			return this.cachedAccessToken;
		}
		/**
		* Returns whether the provided credentials are expired or not.
		* If there is no expiry time, assumes the token is not expired or expiring.
		* @param credentials The credentials to check for expiration.
		* @return Whether the credentials are expired or not.
		*/
		isExpired(credentials) {
			const now = (/* @__PURE__ */ new Date()).getTime();
			return credentials.expiry_date ? now >= credentials.expiry_date - this.eagerRefreshThresholdMillis : false;
		}
	};
	exports.ExternalAccountAuthorizedUserClient = ExternalAccountAuthorizedUserClient;
}));
//#endregion
//#region ../../node_modules/.pnpm/google-auth-library@11.1.0/node_modules/google-auth-library/build/src/auth/gdchclient.js
var require_gdchclient = /* @__PURE__ */ __commonJSMin(((exports) => {
	Object.defineProperty(exports, "__esModule", { value: true });
	exports.GdchClient = exports.GDCH_SERVICE_ACCOUNT_TYPE = void 0;
	const crypto$2 = __require("crypto");
	const fs$2 = __require("fs");
	const https = __require("https");
	const oauth2client_1 = require_oauth2client();
	const DEFAULT_LIFETIME_IN_SECONDS = 3600;
	exports.GDCH_SERVICE_ACCOUNT_TYPE = "gdch_service_account";
	exports.GdchClient = class GdchClient extends oauth2client_1.OAuth2Client {
		projectId;
		privateKeyId;
		privateKey;
		serviceIdentityName;
		tokenServerUri;
		caCertPath;
		apiAudience;
		lifetime;
		gdchOptions;
		caAgentPromise;
		cachedCaCertPath;
		lastCaCertReadTime = 0;
		CA_CERT_TTL_MS = 3e5;
		constructor(options = {}) {
			super(options);
			this.gdchOptions = options;
			this.projectId = options.projectId || void 0;
			this.privateKeyId = options.privateKeyId;
			this.privateKey = options.privateKey;
			this.serviceIdentityName = options.serviceIdentityName;
			this.tokenServerUri = options.tokenServerUri;
			this.caCertPath = options.caCertPath;
			this.apiAudience = options.apiAudience;
			this.lifetime = options.lifetime || DEFAULT_LIFETIME_IN_SECONDS;
			this.credentials = {
				refresh_token: "gdch-placeholder",
				expiry_date: 1
			};
		}
		createWithGdchAudience(apiAudience) {
			if (!apiAudience) throw new Error("Audience cannot be null or empty for GDCH service account credentials.");
			return new GdchClient({
				...this.gdchOptions,
				projectId: this.projectId,
				privateKeyId: this.privateKeyId,
				privateKey: this.privateKey,
				serviceIdentityName: this.serviceIdentityName,
				tokenServerUri: this.tokenServerUri,
				caCertPath: this.caCertPath,
				lifetime: this.lifetime,
				apiAudience
			});
		}
		fromJSON(json) {
			if (!json) throw new Error("Must pass in a JSON object containing the GDCH credentials settings.");
			if (json.type !== exports.GDCH_SERVICE_ACCOUNT_TYPE) throw new Error(`The incoming JSON object does not have the "${exports.GDCH_SERVICE_ACCOUNT_TYPE}" type`);
			if (json.format_version !== "1") throw new Error("Only format version 1 is supported.");
			if (!json.project) throw new Error("The incoming JSON object does not contain a project field");
			if (!json.private_key_id) throw new Error("The incoming JSON object does not contain a private_key_id field");
			if (!json.private_key) throw new Error("The incoming JSON object does not contain a private_key field");
			if (!json.name) throw new Error("The incoming JSON object does not contain a name field");
			if (!json.token_uri) throw new Error("The incoming JSON object does not contain a token_uri field");
			this.projectId = json.project;
			this.privateKeyId = json.private_key_id;
			this.privateKey = json.private_key;
			this.serviceIdentityName = json.name;
			this.tokenServerUri = json.token_uri;
			this.caCertPath = json.ca_cert_path;
			this.gdchOptions = {
				...this.gdchOptions,
				projectId: json.project,
				privateKeyId: json.private_key_id,
				privateKey: json.private_key,
				serviceIdentityName: json.name,
				tokenServerUri: json.token_uri,
				caCertPath: json.ca_cert_path
			};
		}
		async refreshTokenNoCache() {
			if (!this.apiAudience) throw new Error("Audience cannot be null or empty for GDCH service account credentials. Specify the audience by calling createWithGdchAudience.");
			if (!this.privateKey) throw new Error("Private key is not configured for GDCH credentials.");
			if (!this.privateKeyId) throw new Error("Private key ID is not configured for GDCH credentials.");
			if (!this.projectId) throw new Error("Project is not configured for GDCH credentials.");
			if (!this.serviceIdentityName) throw new Error("Service identity name is not configured for GDCH credentials.");
			if (!this.tokenServerUri) throw new Error("Token server URI is not configured for GDCH credentials.");
			const assertion = this.createAssertion();
			const data = {
				audience: this.apiAudience,
				grant_type: "urn:ietf:params:oauth:token-type:token-exchange",
				requested_token_type: "urn:ietf:params:oauth:token-type:access_token",
				subject_token: assertion,
				subject_token_type: "urn:k8s:params:oauth:token-type:serviceaccount"
			};
			const requestOpts = {
				url: this.tokenServerUri,
				method: "POST",
				headers: { "Content-Type": "application/json" },
				data,
				responseType: "json",
				timeout: 1e4,
				retry: true,
				retryConfig: {
					httpMethodsToRetry: ["POST"],
					statusCodesToRetry: [[500, 599]],
					noResponseRetries: 3
				}
			};
			if (this.caCertPath) requestOpts.agent = await this.getCaAgent();
			try {
				const res = await this.transporter.request(requestOpts);
				const tokenResponse = res.data;
				if (!tokenResponse.access_token) throw new Error("Token response did not contain an access_token.");
				if (!tokenResponse.expires_in) throw new Error("Token response did not contain an expires_in field.");
				const tokens = {
					access_token: tokenResponse.access_token,
					token_type: "STS-Bearer",
					expiry_date: Date.now() + tokenResponse.expires_in * 1e3
				};
				this.emit("tokens", tokens);
				return {
					res,
					tokens
				};
			} catch (e) {
				if (e && e.config && e.config.data) try {
					if (typeof e.config.data === "string") {
						const parsedData = JSON.parse(e.config.data);
						if (parsedData.subject_token) {
							parsedData.subject_token = "***REDACTED***";
							e.config.data = JSON.stringify(parsedData);
						}
					} else if (typeof e.config.data === "object" && e.config.data.subject_token) e.config.data.subject_token = "***REDACTED***";
				} catch {}
				if (e instanceof Error) e.message = `Error getting access token for GDCH service account: ${e.message}, iss: ${this.serviceIdentityName}`;
				throw e;
			}
		}
		createAssertion() {
			const header = {
				alg: "ES256",
				typ: "JWT",
				kid: this.privateKeyId
			};
			const issSub = `system:serviceaccount:${this.projectId}:${this.serviceIdentityName}`;
			const currentTime = Math.floor(Date.now() / 1e3);
			const payload = {
				iss: issSub,
				sub: issSub,
				iat: currentTime,
				exp: currentTime + this.lifetime,
				aud: this.tokenServerUri
			};
			const signingInput = `${this.base64UrlEncode(JSON.stringify(header))}.${this.base64UrlEncode(JSON.stringify(payload))}`;
			const signature = crypto$2.sign("sha256", Buffer.from(signingInput), {
				key: this.privateKey,
				dsaEncoding: "ieee-p1363"
			});
			return `${signingInput}.${this.base64UrlEncode(signature)}`;
		}
		async requestAsync(opts, retry = false) {
			if (this.caCertPath && !opts.agent) {
				const url = (opts.url || "").toString();
				if (!url.includes("googleapis.com") && !url.includes("google.com")) opts.agent = await this.getCaAgent();
			}
			return super.requestAsync(opts, retry);
		}
		getCaAgent() {
			if (!this.caCertPath) {
				this.caAgentPromise = void 0;
				this.cachedCaCertPath = void 0;
				this.lastCaCertReadTime = 0;
				return;
			}
			const now = Date.now();
			const isCacheExpired = now - this.lastCaCertReadTime > this.CA_CERT_TTL_MS;
			if (this.caAgentPromise && this.caCertPath === this.cachedCaCertPath && !isCacheExpired) return this.caAgentPromise;
			this.cachedCaCertPath = this.caCertPath;
			this.lastCaCertReadTime = now;
			const currentPath = this.caCertPath;
			this.caAgentPromise = (async () => {
				try {
					const ca = await fs$2.promises.readFile(currentPath);
					return new https.Agent({ ca });
				} catch (err) {
					if (this.cachedCaCertPath === currentPath) {
						this.caAgentPromise = void 0;
						this.cachedCaCertPath = void 0;
						this.lastCaCertReadTime = 0;
					}
					if (err instanceof Error) err.message = `Error reading certificate file from CA cert path, value '${currentPath}': ${err.message}`;
					throw err;
				}
			})();
			return this.caAgentPromise;
		}
		toJSON() {
			return {
				...this,
				privateKey: this.privateKey ? "***REDACTED***" : void 0,
				_clientSecret: this._clientSecret ? "***REDACTED***" : void 0,
				apiKey: this.apiKey ? "***REDACTED***" : void 0,
				gdchOptions: this.gdchOptions ? {
					...this.gdchOptions,
					privateKey: this.gdchOptions.privateKey ? "***REDACTED***" : void 0,
					clientSecret: this.gdchOptions.clientSecret ? "***REDACTED***" : void 0,
					client_secret: this.gdchOptions.client_secret ? "***REDACTED***" : void 0,
					apiKey: this.gdchOptions.apiKey ? "***REDACTED***" : void 0,
					credentials: this.gdchOptions.credentials ? {
						...this.gdchOptions.credentials,
						access_token: this.gdchOptions.credentials.access_token ? "***REDACTED***" : void 0,
						refresh_token: this.gdchOptions.credentials.refresh_token ? "***REDACTED***" : void 0
					} : void 0
				} : void 0,
				credentials: {
					...this.credentials,
					access_token: this.credentials?.access_token ? "***REDACTED***" : void 0,
					refresh_token: this.credentials?.refresh_token ? "***REDACTED***" : void 0
				}
			};
		}
		[Symbol.for("nodejs.util.inspect.custom")]() {
			return this.toJSON();
		}
		base64UrlEncode(str) {
			return (typeof str === "string" ? Buffer.from(str) : str).toString("base64url");
		}
	};
}));
//#endregion
//#region ../../node_modules/.pnpm/google-auth-library@11.1.0/node_modules/google-auth-library/build/src/auth/googleauth.js
var require_googleauth = /* @__PURE__ */ __commonJSMin(((exports) => {
	Object.defineProperty(exports, "__esModule", { value: true });
	exports.GoogleAuth = exports.GoogleAuthExceptionMessages = void 0;
	const child_process_1 = __require("child_process");
	const fs$1 = __require("fs");
	const gaxios_1 = require_src$4();
	const gcpMetadata = require_src$2();
	const os = __require("os");
	const path$1 = __require("path");
	const crypto_1 = require_crypto();
	const computeclient_1 = require_computeclient();
	const idtokenclient_1 = require_idtokenclient();
	const envDetect_1 = require_envDetect();
	const jwtclient_1 = require_jwtclient();
	const refreshclient_1 = require_refreshclient();
	const impersonated_1 = require_impersonated();
	const externalclient_1 = require_externalclient();
	const baseexternalclient_1 = require_baseexternalclient();
	const authclient_1 = require_authclient();
	const externalAccountAuthorizedUserClient_1 = require_externalAccountAuthorizedUserClient();
	const gdchclient_1 = require_gdchclient();
	const util_1 = require_util$1();
	exports.GoogleAuthExceptionMessages = {
		API_KEY_WITH_CREDENTIALS: "API Keys and Credentials are mutually exclusive authentication methods and cannot be used together.",
		NO_PROJECT_ID_FOUND: "Unable to detect a Project Id in the current environment. \nTo learn more about authentication and Google APIs, visit: \nhttps://cloud.google.com/docs/authentication/getting-started",
		NO_CREDENTIALS_FOUND: "Unable to find credentials in current environment. \nTo learn more about authentication and Google APIs, visit: \nhttps://cloud.google.com/docs/authentication/getting-started",
		NO_ADC_FOUND: "Could not load the default credentials. Browse to https://cloud.google.com/docs/authentication/getting-started for more information.",
		NO_UNIVERSE_DOMAIN_FOUND: "Unable to detect a Universe Domain in the current environment.\nTo learn more about Universe Domain retrieval, visit: \nhttps://cloud.google.com/compute/docs/metadata/predefined-metadata-keys"
	};
	var GoogleAuth = class {
		/**
		* Caches a value indicating whether the auth layer is running on Google
		* Compute Engine.
		* @private
		*/
		checkIsGCE = void 0;
		useJWTAccessWithScope;
		defaultServicePath;
		get isGCE() {
			return this.checkIsGCE;
		}
		_findProjectIdPromise;
		_cachedProjectId;
		jsonContent = null;
		apiKey;
		cachedCredential = null;
		/**
		* A pending {@link AuthClient}. Used for concurrent {@link GoogleAuth.getClient} calls.
		*/
		#pendingAuthClient = null;
		/**
		* Scopes populated by the client library by default. We differentiate between
		* these and user defined scopes when deciding whether to use a self-signed JWT.
		*/
		defaultScopes;
		keyFilename;
		scopes;
		clientOptions = {};
		/**
		* Configuration is resolved in the following order of precedence:
		* - {@link GoogleAuthOptions.credentials `credentials`}
		* - {@link GoogleAuthOptions.keyFilename `keyFilename`}
		* - {@link GoogleAuthOptions.keyFile `keyFile`}
		*
		* {@link GoogleAuthOptions.clientOptions `clientOptions`} are passed to the
		* {@link AuthClient `AuthClient`s}.
		*
		* @param opts
		*/
		constructor(opts = {}) {
			this._cachedProjectId = opts.projectId || null;
			this.cachedCredential = opts.authClient || null;
			this.keyFilename = opts.keyFilename || opts.keyFile;
			this.scopes = opts.scopes;
			this.clientOptions = opts.clientOptions || {};
			this.jsonContent = opts.credentials || null;
			this.apiKey = opts.apiKey || this.clientOptions.apiKey || null;
			if (this.apiKey && (this.jsonContent || this.clientOptions.credentials)) throw new RangeError(exports.GoogleAuthExceptionMessages.API_KEY_WITH_CREDENTIALS);
			if (opts.universeDomain) this.clientOptions.universeDomain = opts.universeDomain;
		}
		setGapicJWTValues(client) {
			client.defaultServicePath = this.defaultServicePath;
			client.useJWTAccessWithScope = this.useJWTAccessWithScope;
			client.defaultScopes = this.defaultScopes;
		}
		getProjectId(callback) {
			if (callback) this.getProjectIdAsync().then((r) => callback(null, r), callback);
			else return this.getProjectIdAsync();
		}
		/**
		* A temporary method for internal `getProjectId` usages where `null` is
		* acceptable. In a future major release, `getProjectId` should return `null`
		* (as the `Promise<string | null>` base signature describes) and this private
		* method should be removed.
		*
		* @returns Promise that resolves with project id (or `null`)
		*/
		async getProjectIdOptional() {
			try {
				return await this.getProjectId();
			} catch (e) {
				if (e instanceof Error && e.message === exports.GoogleAuthExceptionMessages.NO_PROJECT_ID_FOUND) return null;
				else throw e;
			}
		}
		/**
		* A private method for finding and caching a projectId.
		*
		* Supports environments in order of precedence:
		* - GCLOUD_PROJECT or GOOGLE_CLOUD_PROJECT environment variable
		* - GOOGLE_APPLICATION_CREDENTIALS JSON file
		* - Cloud SDK: `gcloud config config-helper --format json`
		* - GCE project ID from metadata server
		*
		* @returns projectId
		*/
		async findAndCacheProjectId() {
			let projectId = null;
			projectId ||= await this.getProductionProjectId();
			projectId ||= await this.getFileProjectId();
			projectId ||= await this.getDefaultServiceProjectId();
			projectId ||= await this.getGCEProjectId();
			projectId ||= await this.getExternalAccountClientProjectId();
			if (projectId) {
				this._cachedProjectId = projectId;
				return projectId;
			} else throw new Error(exports.GoogleAuthExceptionMessages.NO_PROJECT_ID_FOUND);
		}
		async getProjectIdAsync() {
			if (this._cachedProjectId) return this._cachedProjectId;
			if (!this._findProjectIdPromise) this._findProjectIdPromise = this.findAndCacheProjectId();
			return this._findProjectIdPromise;
		}
		/**
		* Retrieves a universe domain from the metadata server via
		* {@link gcpMetadata.universe}.
		*
		* @returns a universe domain
		*/
		async getUniverseDomainFromMetadataServer() {
			let universeDomain;
			try {
				universeDomain = await gcpMetadata.universe("universe-domain");
				universeDomain ||= authclient_1.DEFAULT_UNIVERSE;
			} catch (e) {
				if (e && e?.response?.status === 404) universeDomain = authclient_1.DEFAULT_UNIVERSE;
				else throw e;
			}
			return universeDomain;
		}
		/**
		* Retrieves, caches, and returns the universe domain in the following order
		* of precedence:
		* - The universe domain in {@link GoogleAuth.clientOptions}
		* - An existing or ADC {@link AuthClient}'s universe domain
		* - {@link gcpMetadata.universe}, if {@link Compute} client
		*
		* @returns The universe domain
		*/
		async getUniverseDomain() {
			let universeDomain = (0, util_1.originalOrCamelOptions)(this.clientOptions).get("universe_domain");
			try {
				universeDomain ??= (await this.getClient()).universeDomain;
			} catch {
				universeDomain ??= authclient_1.DEFAULT_UNIVERSE;
			}
			return universeDomain;
		}
		/**
		* @returns Any scopes (user-specified or default scopes specified by the
		*   client library) that need to be set on the current Auth client.
		*/
		getAnyScopes() {
			return this.scopes || this.defaultScopes;
		}
		getApplicationDefault(optionsOrCallback = {}, callback) {
			let options;
			if (typeof optionsOrCallback === "function") callback = optionsOrCallback;
			else options = optionsOrCallback;
			if (callback) this.getApplicationDefaultAsync(options).then((r) => callback(null, r.credential, r.projectId), callback);
			else return this.getApplicationDefaultAsync(options);
		}
		async getApplicationDefaultAsync(options = {}) {
			if (this.cachedCredential) return await this.#prepareAndCacheClient(this.cachedCredential, null);
			let credential;
			credential = await this._tryGetApplicationCredentialsFromEnvironmentVariable(options);
			if (credential) {
				if (credential instanceof jwtclient_1.JWT) credential.scopes = this.scopes;
				else if (credential instanceof baseexternalclient_1.BaseExternalAccountClient) credential.scopes = this.getAnyScopes();
				return await this.#prepareAndCacheClient(credential);
			}
			credential = await this._tryGetApplicationCredentialsFromWellKnownFile(options);
			if (credential) {
				if (credential instanceof jwtclient_1.JWT) credential.scopes = this.scopes;
				else if (credential instanceof baseexternalclient_1.BaseExternalAccountClient) credential.scopes = this.getAnyScopes();
				return await this.#prepareAndCacheClient(credential);
			}
			if (await this._checkIsGCE()) {
				options.scopes = this.getAnyScopes();
				return await this.#prepareAndCacheClient(new computeclient_1.Compute(options));
			}
			throw new Error(exports.GoogleAuthExceptionMessages.NO_ADC_FOUND);
		}
		async #prepareAndCacheClient(credential, quotaProjectIdOverride = process.env["GOOGLE_CLOUD_QUOTA_PROJECT"] || null) {
			const projectId = await this.getProjectIdOptional();
			if (quotaProjectIdOverride) credential.quotaProjectId = quotaProjectIdOverride;
			this.cachedCredential = credential;
			return {
				credential,
				projectId
			};
		}
		/**
		* Determines whether the auth layer is running on Google Compute Engine.
		* Checks for GCP Residency, then fallback to checking if metadata server
		* is available.
		*
		* @returns A promise that resolves with the boolean.
		* @api private
		*/
		async _checkIsGCE() {
			if (this.checkIsGCE === void 0) this.checkIsGCE = gcpMetadata.getGCPResidency() || await gcpMetadata.isAvailable();
			return this.checkIsGCE;
		}
		/**
		* Attempts to load default credentials from the environment variable path..
		* @returns Promise that resolves with the OAuth2Client or null.
		* @api private
		*/
		async _tryGetApplicationCredentialsFromEnvironmentVariable(options) {
			const credentialsPath = process.env["GOOGLE_APPLICATION_CREDENTIALS"] || process.env["google_application_credentials"];
			if (!credentialsPath || credentialsPath.length === 0) return null;
			try {
				return await this._getApplicationCredentialsFromFilePath(credentialsPath, options);
			} catch (e) {
				if (e instanceof Error) e.message = `Unable to read the credential file specified by the GOOGLE_APPLICATION_CREDENTIALS environment variable: ${e.message}`;
				throw e;
			}
		}
		/**
		* Attempts to load default credentials from a well-known file location
		* @return Promise that resolves with the OAuth2Client or null.
		* @api private
		*/
		async _tryGetApplicationCredentialsFromWellKnownFile(options) {
			let configDir = process.env["CLOUDSDK_CONFIG"];
			if (!configDir) {
				if (this._isWindows()) {
					if (process.env["APPDATA"]) configDir = path$1.join(process.env["APPDATA"], "gcloud");
				} else {
					const home = process.env["HOME"];
					if (home) configDir = path$1.join(home, ".config", "gcloud");
				}
			}
			if (!configDir) return null;
			const location = path$1.join(configDir, "application_default_credentials.json");
			if (!fs$1.existsSync(location)) return null;
			return await this._getApplicationCredentialsFromFilePath(location, options);
		}
		/**
		* Attempts to load default credentials from a file at the given path..
		* @param filePath The path to the file to read.
		* @returns Promise that resolves with the OAuth2Client
		* @api private
		*/
		async _getApplicationCredentialsFromFilePath(filePath, options = {}) {
			if (!filePath || filePath.length === 0) throw new Error("The file path is invalid.");
			try {
				filePath = fs$1.realpathSync(filePath);
				if (!fs$1.lstatSync(filePath).isFile()) throw new Error();
			} catch (err) {
				if (err instanceof Error) err.message = `The file at ${filePath} does not exist, or it is not a file. ${err.message}`;
				throw err;
			}
			const readStream = fs$1.createReadStream(filePath);
			return this.fromStream(readStream, options);
		}
		/**
		* Create a credentials instance using a given impersonated input options.
		* @param json The impersonated input object.
		* @returns JWT or UserRefresh Client with data
		*/
		fromImpersonatedJSON(json) {
			if (!json) throw new Error("Must pass in a JSON object containing an  impersonated refresh token");
			if (json.type !== impersonated_1.IMPERSONATED_ACCOUNT_TYPE) throw new Error(`The incoming JSON object does not have the "${impersonated_1.IMPERSONATED_ACCOUNT_TYPE}" type`);
			if (!json.source_credentials) throw new Error("The incoming JSON object does not contain a source_credentials field");
			if (!json.service_account_impersonation_url) throw new Error("The incoming JSON object does not contain a service_account_impersonation_url field");
			const sourceClient = this.fromJSON(json.source_credentials);
			if (json.service_account_impersonation_url?.length > 256)
 /**
			* Prevents DOS attacks.
			* @see {@link https://github.com/googleapis/google-auth-library-nodejs/security/code-scanning/85}
			**/
			throw new RangeError(`Target principal is too long: ${json.service_account_impersonation_url}`);
			const targetPrincipal = /(?<target>[^/]+):(generateAccessToken|generateIdToken)$/.exec(json.service_account_impersonation_url)?.groups?.target;
			if (!targetPrincipal) throw new RangeError(`Cannot extract target principal from ${json.service_account_impersonation_url}`);
			const targetScopes = (this.scopes || json.scopes || this.defaultScopes) ?? [];
			return new impersonated_1.Impersonated({
				...json,
				sourceClient,
				targetPrincipal,
				targetScopes: Array.isArray(targetScopes) ? targetScopes : [targetScopes]
			});
		}
		/**
		* Create a credentials instance using the given input options.
		* This client is not cached.
		*
		* **Important**: If you accept a credential configuration (credential JSON/File/Stream) from an external source for authentication to Google Cloud, you must validate it before providing it to any Google API or library. Providing an unvalidated credential configuration to Google APIs can compromise the security of your systems and data. For more information, refer to {@link https://cloud.google.com/docs/authentication/external/externally-sourced-credentials Validate credential configurations from external sources}.
		*
		* @deprecated This method is being deprecated because of a potential security risk.
		*
		* This method does not validate the credential configuration. The security
		* risk occurs when a credential configuration is accepted from a source that
		* is not under your control and used without validation on your side.
		*
		* If you know that you will be loading credential configurations of a
		* specific type, it is recommended to use a credential-type-specific
		* constructor. This will ensure that an unexpected credential type with
		* potential for malicious intent is not loaded unintentionally. You might
		* still have to do validation for certain credential types. Please follow
		* the recommendation for that method. For example, if you want to load only
		* service accounts, you can use the `JWT` constructor:
		* ```
		* const {JWT} = require('google-auth-library');
		* const keys = require('/path/to/key.json');
		* const client = new JWT({
		*   email: keys.client_email,
		*   key: keys.private_key,
		*   scopes: ['https://www.googleapis.com/auth/cloud-platform'],
		* });
		* ```
		*
		* If you are loading your credential configuration from an untrusted source and have
		* not mitigated the risks (e.g. by validating the configuration yourself), make
		* these changes as soon as possible to prevent security risks to your environment.
		*
		* Regardless of the method used, it is always your responsibility to validate
		* configurations received from external sources.
		*
		* For more details, see https://cloud.google.com/docs/authentication/external/externally-sourced-credentials.
		*
		* @param json The input object.
		* @param options The JWT or UserRefresh options for the client
		* @returns JWT or UserRefresh Client with data
		*/
		fromJSON(json, options = {}) {
			let client;
			const preferredUniverseDomain = (0, util_1.originalOrCamelOptions)(options).get("universe_domain");
			if (json.type === refreshclient_1.USER_REFRESH_ACCOUNT_TYPE) {
				client = new refreshclient_1.UserRefreshClient(options);
				client.fromJSON(json);
			} else if (json.type === impersonated_1.IMPERSONATED_ACCOUNT_TYPE) client = this.fromImpersonatedJSON(json);
			else if (json.type === baseexternalclient_1.EXTERNAL_ACCOUNT_TYPE) {
				client = externalclient_1.ExternalAccountClient.fromJSON({
					...json,
					...options
				});
				client.scopes = this.getAnyScopes();
			} else if (json.type === externalAccountAuthorizedUserClient_1.EXTERNAL_ACCOUNT_AUTHORIZED_USER_TYPE) client = new externalAccountAuthorizedUserClient_1.ExternalAccountAuthorizedUserClient({
				...json,
				...options
			});
			else if (json.type === gdchclient_1.GDCH_SERVICE_ACCOUNT_TYPE) {
				client = new gdchclient_1.GdchClient(options);
				client.fromJSON(json);
			} else {
				options.scopes = this.scopes;
				client = new jwtclient_1.JWT(options);
				this.setGapicJWTValues(client);
				client.fromJSON(json);
			}
			if (preferredUniverseDomain) client.universeDomain = preferredUniverseDomain;
			return client;
		}
		/**
		* Return a JWT or UserRefreshClient from JavaScript object, caching both the
		* object used to instantiate and the client.
		* @param json The input object.
		* @param options The JWT or UserRefresh options for the client
		* @returns JWT or UserRefresh Client with data
		*/
		_cacheClientFromJSON(json, options) {
			const client = this.fromJSON(json, options);
			this.jsonContent = json;
			this.cachedCredential = client;
			return client;
		}
		fromStream(inputStream, optionsOrCallback = {}, callback) {
			let options = {};
			if (typeof optionsOrCallback === "function") callback = optionsOrCallback;
			else options = optionsOrCallback;
			if (callback) this.fromStreamAsync(inputStream, options).then((r) => callback(null, r), callback);
			else return this.fromStreamAsync(inputStream, options);
		}
		fromStreamAsync(inputStream, options) {
			return new Promise((resolve, reject) => {
				if (!inputStream) throw new Error("Must pass in a stream containing the Google auth settings.");
				const chunks = [];
				inputStream.setEncoding("utf8").on("error", reject).on("data", (chunk) => chunks.push(chunk)).on("end", () => {
					try {
						try {
							const data = JSON.parse(chunks.join(""));
							return resolve(this._cacheClientFromJSON(data, options));
						} catch (err) {
							if (!this.keyFilename) throw err;
							const client = new jwtclient_1.JWT({
								...this.clientOptions,
								keyFile: this.keyFilename
							});
							this.cachedCredential = client;
							this.setGapicJWTValues(client);
							return resolve(client);
						}
					} catch (err) {
						return reject(err);
					}
				});
			});
		}
		/**
		* Create a credentials instance using the given API key string.
		* The created client is not cached. In order to create and cache it use the {@link GoogleAuth.getClient `getClient`} method after first providing an {@link GoogleAuth.apiKey `apiKey`}.
		*
		* @param apiKey The API key string
		* @param options An optional options object.
		* @returns A JWT loaded from the key
		*/
		fromAPIKey(apiKey, options = {}) {
			return new jwtclient_1.JWT({
				...options,
				apiKey
			});
		}
		/**
		* Determines whether the current operating system is Windows.
		* @api private
		*/
		_isWindows() {
			const sys = os.platform();
			if (sys && sys.length >= 3) {
				if (sys.substring(0, 3).toLowerCase() === "win") return true;
			}
			return false;
		}
		/**
		* Run the Google Cloud SDK command that prints the default project ID
		*/
		async getDefaultServiceProjectId() {
			return new Promise((resolve) => {
				(0, child_process_1.exec)("gcloud config config-helper --format json", (err, stdout) => {
					if (!err && stdout) try {
						const projectId = JSON.parse(stdout).configuration.properties.core.project;
						resolve(projectId);
						return;
					} catch (e) {}
					resolve(null);
				});
			});
		}
		/**
		* Loads the project id from environment variables.
		* @api private
		*/
		getProductionProjectId() {
			return process.env["GCLOUD_PROJECT"] || process.env["GOOGLE_CLOUD_PROJECT"] || process.env["gcloud_project"] || process.env["google_cloud_project"];
		}
		/**
		* Loads the project id from the GOOGLE_APPLICATION_CREDENTIALS json file.
		* @api private
		*/
		async getFileProjectId() {
			if (this.cachedCredential) return this.cachedCredential.projectId;
			if (this.keyFilename) {
				const creds = await this.getClient();
				if (creds && creds.projectId) return creds.projectId;
			}
			const r = await this._tryGetApplicationCredentialsFromEnvironmentVariable();
			if (r) return r.projectId;
			else return null;
		}
		/**
		* Gets the project ID from external account client if available.
		*/
		async getExternalAccountClientProjectId() {
			if (!this.jsonContent || this.jsonContent.type !== baseexternalclient_1.EXTERNAL_ACCOUNT_TYPE) return null;
			return await (await this.getClient()).getProjectId();
		}
		/**
		* Gets the Compute Engine project ID if it can be inferred.
		*/
		async getGCEProjectId() {
			try {
				return await gcpMetadata.project("project-id");
			} catch (e) {
				return null;
			}
		}
		getCredentials(callback) {
			if (callback) this.getCredentialsAsync().then((r) => callback(null, r), callback);
			else return this.getCredentialsAsync();
		}
		async getCredentialsAsync() {
			const client = await this.getClient();
			if (client instanceof impersonated_1.Impersonated) return { client_email: client.getTargetPrincipal() };
			if (client instanceof baseexternalclient_1.BaseExternalAccountClient) {
				const serviceAccountEmail = client.getServiceAccountEmail();
				if (serviceAccountEmail) return {
					client_email: serviceAccountEmail,
					universe_domain: client.universeDomain
				};
			}
			if (this.jsonContent) return {
				client_email: this.jsonContent.client_email,
				private_key: this.jsonContent.private_key,
				universe_domain: this.jsonContent.universe_domain
			};
			if (await this._checkIsGCE()) {
				const [client_email, universe_domain] = await Promise.all([gcpMetadata.instance("service-accounts/default/email"), this.getUniverseDomain()]);
				return {
					client_email,
					universe_domain
				};
			}
			throw new Error(exports.GoogleAuthExceptionMessages.NO_CREDENTIALS_FOUND);
		}
		/**
		* Automatically obtain an {@link AuthClient `AuthClient`} based on the
		* provided configuration. If no options were passed, use Application
		* Default Credentials.
		*/
		async getClient() {
			if (this.cachedCredential) return this.cachedCredential;
			this.#pendingAuthClient = this.#pendingAuthClient || this.#determineClient();
			try {
				const client = await this.#pendingAuthClient;
				if (client instanceof gdchclient_1.GdchClient && !client.apiAudience) {
					const opts = this.clientOptions;
					const endpoint = opts.apiEndpoint || opts.servicePath;
					if (endpoint) {
						const formattedAudience = `${endpoint.startsWith("http") ? "" : "https://"}${endpoint}`.replace(/\/+$/, "");
						const newClient = client.createWithGdchAudience(formattedAudience);
						this.cachedCredential = newClient;
						return newClient;
					}
				}
				return client;
			} finally {
				this.#pendingAuthClient = null;
			}
		}
		async #determineClient() {
			if (this.jsonContent) return this._cacheClientFromJSON(this.jsonContent, this.clientOptions);
			else if (this.keyFilename) {
				const filePath = path$1.resolve(this.keyFilename);
				const stream = fs$1.createReadStream(filePath);
				return await this.fromStreamAsync(stream, this.clientOptions);
			} else if (this.apiKey) {
				const client = await this.fromAPIKey(this.apiKey, this.clientOptions);
				client.scopes = this.scopes;
				const { credential } = await this.#prepareAndCacheClient(client);
				return credential;
			} else {
				const { credential } = await this.getApplicationDefaultAsync(this.clientOptions);
				return credential;
			}
		}
		/**
		* Creates a client which will fetch an ID token for authorization.
		* @param targetAudience the audience for the fetched ID token.
		* @returns IdTokenClient for making HTTP calls authenticated with ID tokens.
		*/
		async getIdTokenClient(targetAudience) {
			const client = await this.getClient();
			if (!("fetchIdToken" in client)) throw new Error("Cannot fetch ID token in this environment, use GCE or set the GOOGLE_APPLICATION_CREDENTIALS environment variable to a service account credentials JSON file.");
			return new idtokenclient_1.IdTokenClient({
				targetAudience,
				idTokenProvider: client
			});
		}
		/**
		* Automatically obtain application default credentials, and return
		* an access token for making requests.
		*/
		async getAccessToken() {
			return (await (await this.getClient()).getAccessToken()).token;
		}
		/**
		* Obtain the HTTP headers that will provide authorization for a given
		* request.
		*/
		async getRequestHeaders(url) {
			return (await this.getClient()).getRequestHeaders(url);
		}
		/**
		* Obtain credentials for a request, then attach the appropriate headers to
		* the request options.
		* @param opts Axios or Request options on which to attach the headers
		*/
		async authorizeRequest(opts = {}) {
			const url = opts.url;
			const headers = await (await this.getClient()).getRequestHeaders(url);
			opts.headers = gaxios_1.Gaxios.mergeHeaders(opts.headers, headers);
			return opts;
		}
		/**
		* A {@link fetch `fetch`} compliant API for {@link GoogleAuth}.
		*
		* @see {@link GoogleAuth.request} for the classic method.
		*
		* @remarks
		*
		* This is useful as a drop-in replacement for `fetch` API usage.
		*
		* @example
		*
		* ```ts
		* const auth = new GoogleAuth();
		* const fetchWithAuth: typeof fetch = (...args) => auth.fetch(...args);
		* await fetchWithAuth('https://example.com');
		* ```
		*
		* @param args `fetch` API or {@link Gaxios.fetch `Gaxios#fetch`} parameters
		* @returns the {@link GaxiosResponse} with Gaxios-added properties
		*/
		async fetch(...args) {
			return (await this.getClient()).fetch(...args);
		}
		/**
		* Automatically obtain application default credentials, and make an
		* HTTP request using the given options.
		*
		* @see {@link GoogleAuth.fetch} for the modern method.
		*
		* @param opts Axios request options for the HTTP request.
		*/
		async request(opts) {
			return (await this.getClient()).request(opts);
		}
		/**
		* Determine the compute environment in which the code is running.
		*/
		getEnv() {
			return (0, envDetect_1.getEnv)();
		}
		/**
		* Sign the given data with the current private key, or go out
		* to the IAM API to sign it.
		* @param data The data to be signed.
		* @param endpoint A custom endpoint to use.
		*
		* @example
		* ```
		* sign('data', 'https://iamcredentials.googleapis.com/v1/projects/-/serviceAccounts/');
		* ```
		*/
		async sign(data, endpoint) {
			const client = await this.getClient();
			const universe = await this.getUniverseDomain();
			endpoint = endpoint || `https://iamcredentials.${universe}/v1/projects/-/serviceAccounts/`;
			if (client instanceof impersonated_1.Impersonated) return (await client.sign(data)).signedBlob;
			const crypto = (0, crypto_1.createCrypto)();
			if (client instanceof jwtclient_1.JWT && client.key) return await crypto.sign(client.key, data);
			const creds = await this.getCredentials();
			if (!creds.client_email) throw new Error("Cannot sign data without `client_email`.");
			return this.signBlob(crypto, creds.client_email, data, endpoint);
		}
		async signBlob(crypto, emailOrUniqueId, data, endpoint) {
			const url = new URL(endpoint + `${emailOrUniqueId}:signBlob`);
			return (await this.request({
				method: "POST",
				url: url.href,
				data: { payload: crypto.encodeBase64StringUtf8(data) },
				retry: true,
				retryConfig: { httpMethodsToRetry: ["POST"] }
			})).data.signedBlob;
		}
	};
	exports.GoogleAuth = GoogleAuth;
}));
//#endregion
//#region ../../node_modules/.pnpm/google-auth-library@11.1.0/node_modules/google-auth-library/build/src/auth/iam.js
var require_iam = /* @__PURE__ */ __commonJSMin(((exports) => {
	Object.defineProperty(exports, "__esModule", { value: true });
	exports.IAMAuth = void 0;
	var IAMAuth = class {
		selector;
		token;
		/**
		* IAM credentials.
		*
		* @param selector the iam authority selector
		* @param token the token
		* @constructor
		*/
		constructor(selector, token) {
			this.selector = selector;
			this.token = token;
			this.selector = selector;
			this.token = token;
		}
		/**
		* Acquire the HTTP headers required to make an authenticated request.
		*/
		getRequestHeaders() {
			return {
				"x-goog-iam-authority-selector": this.selector,
				"x-goog-iam-authorization-token": this.token
			};
		}
	};
	exports.IAMAuth = IAMAuth;
}));
//#endregion
//#region ../../node_modules/.pnpm/google-auth-library@11.1.0/node_modules/google-auth-library/build/src/auth/downscopedclient.js
var require_downscopedclient = /* @__PURE__ */ __commonJSMin(((exports) => {
	Object.defineProperty(exports, "__esModule", { value: true });
	exports.DownscopedClient = exports.EXPIRATION_TIME_OFFSET = exports.MAX_ACCESS_BOUNDARY_RULES_COUNT = void 0;
	const gaxios_1 = require_src$4();
	const stream$1 = __require("stream");
	const authclient_1 = require_authclient();
	const sts = require_stscredentials();
	/**
	* The required token exchange grant_type: rfc8693#section-2.1
	*/
	const STS_GRANT_TYPE = "urn:ietf:params:oauth:grant-type:token-exchange";
	/**
	* The requested token exchange requested_token_type: rfc8693#section-2.1
	*/
	const STS_REQUEST_TOKEN_TYPE = "urn:ietf:params:oauth:token-type:access_token";
	/**
	* The requested token exchange subject_token_type: rfc8693#section-2.1
	*/
	const STS_SUBJECT_TOKEN_TYPE = "urn:ietf:params:oauth:token-type:access_token";
	/**
	* The maximum number of access boundary rules a Credential Access Boundary
	* can contain.
	*/
	exports.MAX_ACCESS_BOUNDARY_RULES_COUNT = 10;
	/**
	* Offset to take into account network delays and server clock skews.
	*/
	exports.EXPIRATION_TIME_OFFSET = 3e5;
	/**
	* Defines a set of Google credentials that are downscoped from an existing set
	* of Google OAuth2 credentials. This is useful to restrict the Identity and
	* Access Management (IAM) permissions that a short-lived credential can use.
	* The common pattern of usage is to have a token broker with elevated access
	* generate these downscoped credentials from higher access source credentials
	* and pass the downscoped short-lived access tokens to a token consumer via
	* some secure authenticated channel for limited access to Google Cloud Storage
	* resources.
	*/
	var DownscopedClient = class extends authclient_1.AuthClient {
		authClient;
		credentialAccessBoundary;
		cachedDownscopedAccessToken;
		stsCredential;
		/**
		* Instantiates a downscoped client object using the provided source
		* AuthClient and credential access boundary rules.
		* To downscope permissions of a source AuthClient, a Credential Access
		* Boundary that specifies which resources the new credential can access, as
		* well as an upper bound on the permissions that are available on each
		* resource, has to be defined. A downscoped client can then be instantiated
		* using the source AuthClient and the Credential Access Boundary.
		* @param options the {@link DownscopedClientOptions `DownscopedClientOptions`} to use. Passing an `AuthClient` directly is **@DEPRECATED**.
		* @param credentialAccessBoundary **@DEPRECATED**. Provide a {@link DownscopedClientOptions `DownscopedClientOptions`} object in the first parameter instead.
		*/
		constructor(options, credentialAccessBoundary = { accessBoundary: { accessBoundaryRules: [] } }) {
			super(options instanceof authclient_1.AuthClient ? {} : options);
			if (options instanceof authclient_1.AuthClient) {
				this.authClient = options;
				this.credentialAccessBoundary = credentialAccessBoundary;
			} else {
				this.authClient = options.authClient;
				this.credentialAccessBoundary = options.credentialAccessBoundary;
			}
			if (this.credentialAccessBoundary.accessBoundary.accessBoundaryRules.length === 0) throw new Error("At least one access boundary rule needs to be defined.");
			else if (this.credentialAccessBoundary.accessBoundary.accessBoundaryRules.length > exports.MAX_ACCESS_BOUNDARY_RULES_COUNT) throw new Error(`The provided access boundary has more than ${exports.MAX_ACCESS_BOUNDARY_RULES_COUNT} access boundary rules.`);
			for (const rule of this.credentialAccessBoundary.accessBoundary.accessBoundaryRules) if (rule.availablePermissions.length === 0) throw new Error("At least one permission should be defined in access boundary rules.");
			this.stsCredential = new sts.StsCredentials({ tokenExchangeEndpoint: `https://sts.${this.universeDomain}/v1/token` });
			this.cachedDownscopedAccessToken = null;
		}
		/**
		* Provides a mechanism to inject Downscoped access tokens directly.
		* The expiry_date field is required to facilitate determination of the token
		* expiration which would make it easier for the token consumer to handle.
		* @param credentials The Credentials object to set on the current client.
		*/
		setCredentials(credentials) {
			if (!credentials.expiry_date) throw new Error("The access token expiry_date field is missing in the provided credentials.");
			super.setCredentials(credentials);
			this.cachedDownscopedAccessToken = credentials;
		}
		async getAccessToken() {
			if (!this.cachedDownscopedAccessToken || this.isExpired(this.cachedDownscopedAccessToken)) await this.refreshAccessTokenAsync();
			return {
				token: this.cachedDownscopedAccessToken.access_token,
				expirationTime: this.cachedDownscopedAccessToken.expiry_date,
				res: this.cachedDownscopedAccessToken.res
			};
		}
		/**
		* The main authentication interface. It takes an optional url which when
		* present is the endpoint being accessed, and returns a Promise which
		* resolves with authorization header fields.
		*
		* The result has the form:
		* { authorization: 'Bearer <access_token_value>' }
		*/
		async getRequestHeaders() {
			const accessTokenResponse = await this.getAccessToken();
			const headers = new Headers({ authorization: `Bearer ${accessTokenResponse.token}` });
			return this.addSharedMetadataHeaders(headers);
		}
		request(opts, callback) {
			if (callback) this.requestAsync(opts).then((r) => callback(null, r), (e) => {
				return callback(e, e.response);
			});
			else return this.requestAsync(opts);
		}
		/**
		* Authenticates the provided HTTP request, processes it and resolves with the
		* returned response.
		* @param opts The HTTP request options.
		* @param reAuthRetried Whether the current attempt is a retry after a failed attempt due to an auth failure
		* @return A promise that resolves with the successful response.
		*/
		async requestAsync(opts, reAuthRetried = false) {
			let response;
			try {
				const requestHeaders = await this.getRequestHeaders();
				opts.headers = gaxios_1.Gaxios.mergeHeaders(opts.headers);
				this.addUserProjectAndAuthHeaders(opts.headers, requestHeaders);
				response = await this.transporter.request(opts);
			} catch (e) {
				const res = e.response;
				if (res) {
					const statusCode = res.status;
					const isReadableStream = res.config.data instanceof stream$1.Readable;
					if (!reAuthRetried && (statusCode === 401 || statusCode === 403) && !isReadableStream && this.forceRefreshOnFailure) {
						await this.refreshAccessTokenAsync();
						return await this.requestAsync(opts, true);
					}
				}
				throw e;
			}
			return response;
		}
		/**
		* Forces token refresh, even if unexpired tokens are currently cached.
		* GCP access tokens are retrieved from authclient object/source credential.
		* Then GCP access tokens are exchanged for downscoped access tokens via the
		* token exchange endpoint.
		* @return A promise that resolves with the fresh downscoped access token.
		*/
		async refreshAccessTokenAsync() {
			const subjectToken = (await this.authClient.getAccessToken()).token;
			const stsCredentialsOptions = {
				grantType: STS_GRANT_TYPE,
				requestedTokenType: STS_REQUEST_TOKEN_TYPE,
				subjectToken,
				subjectTokenType: STS_SUBJECT_TOKEN_TYPE
			};
			const stsResponse = await this.stsCredential.exchangeToken(stsCredentialsOptions, void 0, this.credentialAccessBoundary);
			/**
			* The STS endpoint will only return the expiration time for the downscoped
			* access token if the original access token represents a service account.
			* The downscoped token's expiration time will always match the source
			* credential expiration. When no expires_in is returned, we can copy the
			* source credential's expiration time.
			*/
			const sourceCredExpireDate = this.authClient.credentials?.expiry_date || null;
			const expiryDate = stsResponse.expires_in ? (/* @__PURE__ */ new Date()).getTime() + stsResponse.expires_in * 1e3 : sourceCredExpireDate;
			this.cachedDownscopedAccessToken = {
				access_token: stsResponse.access_token,
				expiry_date: expiryDate,
				res: stsResponse.res
			};
			this.credentials = {};
			Object.assign(this.credentials, this.cachedDownscopedAccessToken);
			delete this.credentials.res;
			this.emit("tokens", {
				refresh_token: null,
				expiry_date: this.cachedDownscopedAccessToken.expiry_date,
				access_token: this.cachedDownscopedAccessToken.access_token,
				token_type: "Bearer",
				id_token: null
			});
			return this.cachedDownscopedAccessToken;
		}
		/**
		* Returns whether the provided credentials are expired or not.
		* If there is no expiry time, assumes the token is not expired or expiring.
		* @param downscopedAccessToken The credentials to check for expiration.
		* @return Whether the credentials are expired or not.
		*/
		isExpired(downscopedAccessToken) {
			const now = (/* @__PURE__ */ new Date()).getTime();
			return downscopedAccessToken.expiry_date ? now >= downscopedAccessToken.expiry_date - this.eagerRefreshThresholdMillis : false;
		}
	};
	exports.DownscopedClient = DownscopedClient;
}));
//#endregion
//#region ../../node_modules/.pnpm/google-auth-library@11.1.0/node_modules/google-auth-library/build/src/auth/passthrough.js
var require_passthrough = /* @__PURE__ */ __commonJSMin(((exports) => {
	Object.defineProperty(exports, "__esModule", { value: true });
	exports.PassThroughClient = void 0;
	const authclient_1 = require_authclient();
	/**
	* An AuthClient without any Authentication information. Useful for:
	* - Anonymous access
	* - Local Emulators
	* - Testing Environments
	*
	*/
	var PassThroughClient = class extends authclient_1.AuthClient {
		/**
		* Creates a request without any authentication headers or checks.
		*
		* @remarks
		*
		* In testing environments it may be useful to change the provided
		* {@link AuthClient.transporter} for any desired request overrides/handling.
		*
		* @param opts
		* @returns The response of the request.
		*/
		async request(opts) {
			return this.transporter.request(opts);
		}
		/**
		* A required method of the base class.
		* Always will return an empty object.
		*
		* @returns {}
		*/
		async getAccessToken() {
			return {};
		}
		/**
		* A required method of the base class.
		* Always will return an empty object.
		*
		* @returns {}
		*/
		async getRequestHeaders() {
			return new Headers();
		}
	};
	exports.PassThroughClient = PassThroughClient;
}));
//#endregion
//#region ../../node_modules/.pnpm/google-auth-library@11.1.0/node_modules/google-auth-library/build/src/index.js
var require_src$1 = /* @__PURE__ */ __commonJSMin(((exports) => {
	var __createBinding = exports && exports.__createBinding || (Object.create ? (function(o, m, k, k2) {
		if (k2 === void 0) k2 = k;
		var desc = Object.getOwnPropertyDescriptor(m, k);
		if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) desc = {
			enumerable: true,
			get: function() {
				return m[k];
			}
		};
		Object.defineProperty(o, k2, desc);
	}) : (function(o, m, k, k2) {
		if (k2 === void 0) k2 = k;
		o[k2] = m[k];
	}));
	var __exportStar = exports && exports.__exportStar || function(m, exports$2) {
		for (var p in m) if (p !== "default" && !Object.prototype.hasOwnProperty.call(exports$2, p)) __createBinding(exports$2, m, p);
	};
	Object.defineProperty(exports, "__esModule", { value: true });
	exports.GoogleAuth = exports.auth = exports.GDCH_SERVICE_ACCOUNT_TYPE = exports.GdchClient = exports.PassThroughClient = exports.ExternalAccountAuthorizedUserClient = exports.EXTERNAL_ACCOUNT_AUTHORIZED_USER_TYPE = exports.ExecutableError = exports.PluggableAuthClient = exports.DownscopedClient = exports.BaseExternalAccountClient = exports.ExternalAccountClient = exports.IdentityPoolClient = exports.AwsRequestSigner = exports.AwsClient = exports.UserRefreshClient = exports.LoginTicket = exports.ClientAuthentication = exports.OAuth2Client = exports.CodeChallengeMethod = exports.Impersonated = exports.JWT = exports.JWTAccess = exports.IdTokenClient = exports.IAMAuth = exports.GCPEnv = exports.Compute = exports.DEFAULT_UNIVERSE = exports.AuthClient = exports.gaxios = exports.gcpMetadata = void 0;
	const googleauth_1 = require_googleauth();
	Object.defineProperty(exports, "GoogleAuth", {
		enumerable: true,
		get: function() {
			return googleauth_1.GoogleAuth;
		}
	});
	exports.gcpMetadata = require_src$2();
	exports.gaxios = require_src$4();
	var authclient_1 = require_authclient();
	Object.defineProperty(exports, "AuthClient", {
		enumerable: true,
		get: function() {
			return authclient_1.AuthClient;
		}
	});
	Object.defineProperty(exports, "DEFAULT_UNIVERSE", {
		enumerable: true,
		get: function() {
			return authclient_1.DEFAULT_UNIVERSE;
		}
	});
	var computeclient_1 = require_computeclient();
	Object.defineProperty(exports, "Compute", {
		enumerable: true,
		get: function() {
			return computeclient_1.Compute;
		}
	});
	var envDetect_1 = require_envDetect();
	Object.defineProperty(exports, "GCPEnv", {
		enumerable: true,
		get: function() {
			return envDetect_1.GCPEnv;
		}
	});
	var iam_1 = require_iam();
	Object.defineProperty(exports, "IAMAuth", {
		enumerable: true,
		get: function() {
			return iam_1.IAMAuth;
		}
	});
	var idtokenclient_1 = require_idtokenclient();
	Object.defineProperty(exports, "IdTokenClient", {
		enumerable: true,
		get: function() {
			return idtokenclient_1.IdTokenClient;
		}
	});
	var jwtaccess_1 = require_jwtaccess();
	Object.defineProperty(exports, "JWTAccess", {
		enumerable: true,
		get: function() {
			return jwtaccess_1.JWTAccess;
		}
	});
	var jwtclient_1 = require_jwtclient();
	Object.defineProperty(exports, "JWT", {
		enumerable: true,
		get: function() {
			return jwtclient_1.JWT;
		}
	});
	var impersonated_1 = require_impersonated();
	Object.defineProperty(exports, "Impersonated", {
		enumerable: true,
		get: function() {
			return impersonated_1.Impersonated;
		}
	});
	var oauth2client_1 = require_oauth2client();
	Object.defineProperty(exports, "CodeChallengeMethod", {
		enumerable: true,
		get: function() {
			return oauth2client_1.CodeChallengeMethod;
		}
	});
	Object.defineProperty(exports, "OAuth2Client", {
		enumerable: true,
		get: function() {
			return oauth2client_1.OAuth2Client;
		}
	});
	Object.defineProperty(exports, "ClientAuthentication", {
		enumerable: true,
		get: function() {
			return oauth2client_1.ClientAuthentication;
		}
	});
	var loginticket_1 = require_loginticket();
	Object.defineProperty(exports, "LoginTicket", {
		enumerable: true,
		get: function() {
			return loginticket_1.LoginTicket;
		}
	});
	var refreshclient_1 = require_refreshclient();
	Object.defineProperty(exports, "UserRefreshClient", {
		enumerable: true,
		get: function() {
			return refreshclient_1.UserRefreshClient;
		}
	});
	var awsclient_1 = require_awsclient();
	Object.defineProperty(exports, "AwsClient", {
		enumerable: true,
		get: function() {
			return awsclient_1.AwsClient;
		}
	});
	var awsrequestsigner_1 = require_awsrequestsigner();
	Object.defineProperty(exports, "AwsRequestSigner", {
		enumerable: true,
		get: function() {
			return awsrequestsigner_1.AwsRequestSigner;
		}
	});
	var identitypoolclient_1 = require_identitypoolclient();
	Object.defineProperty(exports, "IdentityPoolClient", {
		enumerable: true,
		get: function() {
			return identitypoolclient_1.IdentityPoolClient;
		}
	});
	var externalclient_1 = require_externalclient();
	Object.defineProperty(exports, "ExternalAccountClient", {
		enumerable: true,
		get: function() {
			return externalclient_1.ExternalAccountClient;
		}
	});
	var baseexternalclient_1 = require_baseexternalclient();
	Object.defineProperty(exports, "BaseExternalAccountClient", {
		enumerable: true,
		get: function() {
			return baseexternalclient_1.BaseExternalAccountClient;
		}
	});
	var downscopedclient_1 = require_downscopedclient();
	Object.defineProperty(exports, "DownscopedClient", {
		enumerable: true,
		get: function() {
			return downscopedclient_1.DownscopedClient;
		}
	});
	var pluggable_auth_client_1 = require_pluggable_auth_client();
	Object.defineProperty(exports, "PluggableAuthClient", {
		enumerable: true,
		get: function() {
			return pluggable_auth_client_1.PluggableAuthClient;
		}
	});
	Object.defineProperty(exports, "ExecutableError", {
		enumerable: true,
		get: function() {
			return pluggable_auth_client_1.ExecutableError;
		}
	});
	var externalAccountAuthorizedUserClient_1 = require_externalAccountAuthorizedUserClient();
	Object.defineProperty(exports, "EXTERNAL_ACCOUNT_AUTHORIZED_USER_TYPE", {
		enumerable: true,
		get: function() {
			return externalAccountAuthorizedUserClient_1.EXTERNAL_ACCOUNT_AUTHORIZED_USER_TYPE;
		}
	});
	Object.defineProperty(exports, "ExternalAccountAuthorizedUserClient", {
		enumerable: true,
		get: function() {
			return externalAccountAuthorizedUserClient_1.ExternalAccountAuthorizedUserClient;
		}
	});
	var passthrough_1 = require_passthrough();
	Object.defineProperty(exports, "PassThroughClient", {
		enumerable: true,
		get: function() {
			return passthrough_1.PassThroughClient;
		}
	});
	var gdchclient_1 = require_gdchclient();
	Object.defineProperty(exports, "GdchClient", {
		enumerable: true,
		get: function() {
			return gdchclient_1.GdchClient;
		}
	});
	Object.defineProperty(exports, "GDCH_SERVICE_ACCOUNT_TYPE", {
		enumerable: true,
		get: function() {
			return gdchclient_1.GDCH_SERVICE_ACCOUNT_TYPE;
		}
	});
	__exportStar(require_googleToken(), exports);
	exports.auth = new googleauth_1.GoogleAuth();
}));
//#endregion
//#region ../../node_modules/.pnpm/googleapis-common@9.1.0/node_modules/googleapis-common/build/src/apiIndex.js
var require_apiIndex = /* @__PURE__ */ __commonJSMin(((exports) => {
	Object.defineProperty(exports, "__esModule", { value: true });
	exports.getAPI = getAPI;
	function getAPI(api, options, versions, context) {
		let version;
		if (typeof options === "string") {
			version = options;
			options = {};
		} else if (typeof options === "object") {
			version = options.version;
			delete options.version;
		} else throw new Error("Argument error: Accepts only string or object");
		try {
			const ctr = versions[version];
			const ep = new ctr(options, context);
			return Object.freeze(ep);
		} catch (e) {
			throw new Error(`Unable to load endpoint ${api}("${version}"): ${e.message}`);
		}
	}
}));
//#endregion
//#region ../../node_modules/.pnpm/es-errors@1.3.0/node_modules/es-errors/type.js
var require_type = /* @__PURE__ */ __commonJSMin(((exports, module) => {
	/** @type {import('./type')} */
	module.exports = TypeError;
}));
//#endregion
//#region ../../node_modules/.pnpm/object-inspect@1.13.4/node_modules/object-inspect/util.inspect.js
var require_util_inspect = /* @__PURE__ */ __commonJSMin(((exports, module) => {
	module.exports = __require("util").inspect;
}));
//#endregion
//#region ../../node_modules/.pnpm/object-inspect@1.13.4/node_modules/object-inspect/index.js
var require_object_inspect = /* @__PURE__ */ __commonJSMin(((exports, module) => {
	var hasMap = typeof Map === "function" && Map.prototype;
	var mapSizeDescriptor = Object.getOwnPropertyDescriptor && hasMap ? Object.getOwnPropertyDescriptor(Map.prototype, "size") : null;
	var mapSize = hasMap && mapSizeDescriptor && typeof mapSizeDescriptor.get === "function" ? mapSizeDescriptor.get : null;
	var mapForEach = hasMap && Map.prototype.forEach;
	var hasSet = typeof Set === "function" && Set.prototype;
	var setSizeDescriptor = Object.getOwnPropertyDescriptor && hasSet ? Object.getOwnPropertyDescriptor(Set.prototype, "size") : null;
	var setSize = hasSet && setSizeDescriptor && typeof setSizeDescriptor.get === "function" ? setSizeDescriptor.get : null;
	var setForEach = hasSet && Set.prototype.forEach;
	var weakMapHas = typeof WeakMap === "function" && WeakMap.prototype ? WeakMap.prototype.has : null;
	var weakSetHas = typeof WeakSet === "function" && WeakSet.prototype ? WeakSet.prototype.has : null;
	var weakRefDeref = typeof WeakRef === "function" && WeakRef.prototype ? WeakRef.prototype.deref : null;
	var booleanValueOf = Boolean.prototype.valueOf;
	var objectToString = Object.prototype.toString;
	var functionToString = Function.prototype.toString;
	var $match = String.prototype.match;
	var $slice = String.prototype.slice;
	var $replace = String.prototype.replace;
	var $toUpperCase = String.prototype.toUpperCase;
	var $toLowerCase = String.prototype.toLowerCase;
	var $test = RegExp.prototype.test;
	var $concat = Array.prototype.concat;
	var $join = Array.prototype.join;
	var $arrSlice = Array.prototype.slice;
	var $floor = Math.floor;
	var bigIntValueOf = typeof BigInt === "function" ? BigInt.prototype.valueOf : null;
	var gOPS = Object.getOwnPropertySymbols;
	var symToString = typeof Symbol === "function" && typeof Symbol.iterator === "symbol" ? Symbol.prototype.toString : null;
	var hasShammedSymbols = typeof Symbol === "function" && typeof Symbol.iterator === "object";
	var toStringTag = typeof Symbol === "function" && Symbol.toStringTag && (typeof Symbol.toStringTag === hasShammedSymbols ? "object" : "symbol") ? Symbol.toStringTag : null;
	var isEnumerable = Object.prototype.propertyIsEnumerable;
	var gPO = (typeof Reflect === "function" ? Reflect.getPrototypeOf : Object.getPrototypeOf) || ([].__proto__ === Array.prototype ? function(O) {
		return O.__proto__;
	} : null);
	function addNumericSeparator(num, str) {
		if (num === Infinity || num === -Infinity || num !== num || num && num > -1e3 && num < 1e3 || $test.call(/e/, str)) return str;
		var sepRegex = /[0-9](?=(?:[0-9]{3})+(?![0-9]))/g;
		if (typeof num === "number") {
			var int = num < 0 ? -$floor(-num) : $floor(num);
			if (int !== num) {
				var intStr = String(int);
				var dec = $slice.call(str, intStr.length + 1);
				return $replace.call(intStr, sepRegex, "$&_") + "." + $replace.call($replace.call(dec, /([0-9]{3})/g, "$&_"), /_$/, "");
			}
		}
		return $replace.call(str, sepRegex, "$&_");
	}
	var utilInspect = require_util_inspect();
	var inspectCustom = utilInspect.custom;
	var inspectSymbol = isSymbol(inspectCustom) ? inspectCustom : null;
	var quotes = {
		__proto__: null,
		"double": "\"",
		single: "'"
	};
	var quoteREs = {
		__proto__: null,
		"double": /(["\\])/g,
		single: /(['\\])/g
	};
	module.exports = function inspect_(obj, options, depth, seen) {
		var opts = options || {};
		if (has(opts, "quoteStyle") && !has(quotes, opts.quoteStyle)) throw new TypeError("option \"quoteStyle\" must be \"single\" or \"double\"");
		if (has(opts, "maxStringLength") && (typeof opts.maxStringLength === "number" ? opts.maxStringLength < 0 && opts.maxStringLength !== Infinity : opts.maxStringLength !== null)) throw new TypeError("option \"maxStringLength\", if provided, must be a positive integer, Infinity, or `null`");
		var customInspect = has(opts, "customInspect") ? opts.customInspect : true;
		if (typeof customInspect !== "boolean" && customInspect !== "symbol") throw new TypeError("option \"customInspect\", if provided, must be `true`, `false`, or `'symbol'`");
		if (has(opts, "indent") && opts.indent !== null && opts.indent !== "	" && !(parseInt(opts.indent, 10) === opts.indent && opts.indent > 0)) throw new TypeError("option \"indent\" must be \"\\t\", an integer > 0, or `null`");
		if (has(opts, "numericSeparator") && typeof opts.numericSeparator !== "boolean") throw new TypeError("option \"numericSeparator\", if provided, must be `true` or `false`");
		var numericSeparator = opts.numericSeparator;
		if (typeof obj === "undefined") return "undefined";
		if (obj === null) return "null";
		if (typeof obj === "boolean") return obj ? "true" : "false";
		if (typeof obj === "string") return inspectString(obj, opts);
		if (typeof obj === "number") {
			if (obj === 0) return Infinity / obj > 0 ? "0" : "-0";
			var str = String(obj);
			return numericSeparator ? addNumericSeparator(obj, str) : str;
		}
		if (typeof obj === "bigint") {
			var bigIntStr = String(obj) + "n";
			return numericSeparator ? addNumericSeparator(obj, bigIntStr) : bigIntStr;
		}
		var maxDepth = typeof opts.depth === "undefined" ? 5 : opts.depth;
		if (typeof depth === "undefined") depth = 0;
		if (depth >= maxDepth && maxDepth > 0 && typeof obj === "object") return isArray(obj) ? "[Array]" : "[Object]";
		var indent = getIndent(opts, depth);
		if (typeof seen === "undefined") seen = [];
		else if (indexOf(seen, obj) >= 0) return "[Circular]";
		function inspect(value, from, noIndent) {
			if (from) {
				seen = $arrSlice.call(seen);
				seen.push(from);
			}
			if (noIndent) {
				var newOpts = { depth: opts.depth };
				if (has(opts, "quoteStyle")) newOpts.quoteStyle = opts.quoteStyle;
				return inspect_(value, newOpts, depth + 1, seen);
			}
			return inspect_(value, opts, depth + 1, seen);
		}
		if (typeof obj === "function" && !isRegExp(obj)) {
			var name = nameOf(obj);
			var keys = arrObjKeys(obj, inspect);
			return "[Function" + (name ? ": " + name : " (anonymous)") + "]" + (keys.length > 0 ? " { " + $join.call(keys, ", ") + " }" : "");
		}
		if (isSymbol(obj)) {
			var symString = hasShammedSymbols ? $replace.call(String(obj), /^(Symbol\(.*\))_[^)]*$/, "$1") : symToString.call(obj);
			return typeof obj === "object" && !hasShammedSymbols ? markBoxed(symString) : symString;
		}
		if (isElement(obj)) {
			var s = "<" + $toLowerCase.call(String(obj.nodeName));
			var attrs = obj.attributes || [];
			for (var i = 0; i < attrs.length; i++) s += " " + attrs[i].name + "=" + wrapQuotes(quote(attrs[i].value), "double", opts);
			s += ">";
			if (obj.childNodes && obj.childNodes.length) s += "...";
			s += "</" + $toLowerCase.call(String(obj.nodeName)) + ">";
			return s;
		}
		if (isArray(obj)) {
			if (obj.length === 0) return "[]";
			var xs = arrObjKeys(obj, inspect);
			if (indent && !singleLineValues(xs)) return "[" + indentedJoin(xs, indent) + "]";
			return "[ " + $join.call(xs, ", ") + " ]";
		}
		if (isError(obj)) {
			var parts = arrObjKeys(obj, inspect);
			if (!("cause" in Error.prototype) && "cause" in obj && !isEnumerable.call(obj, "cause")) return "{ [" + String(obj) + "] " + $join.call($concat.call("[cause]: " + inspect(obj.cause), parts), ", ") + " }";
			if (parts.length === 0) return "[" + String(obj) + "]";
			return "{ [" + String(obj) + "] " + $join.call(parts, ", ") + " }";
		}
		if (typeof obj === "object" && customInspect) {
			if (inspectSymbol && typeof obj[inspectSymbol] === "function" && utilInspect) return utilInspect(obj, { depth: maxDepth - depth });
			else if (customInspect !== "symbol" && typeof obj.inspect === "function") return obj.inspect();
		}
		if (isMap(obj)) {
			var mapParts = [];
			if (mapForEach) mapForEach.call(obj, function(value, key) {
				mapParts.push(inspect(key, obj, true) + " => " + inspect(value, obj));
			});
			return collectionOf("Map", mapSize.call(obj), mapParts, indent);
		}
		if (isSet(obj)) {
			var setParts = [];
			if (setForEach) setForEach.call(obj, function(value) {
				setParts.push(inspect(value, obj));
			});
			return collectionOf("Set", setSize.call(obj), setParts, indent);
		}
		if (isWeakMap(obj)) return weakCollectionOf("WeakMap");
		if (isWeakSet(obj)) return weakCollectionOf("WeakSet");
		if (isWeakRef(obj)) return weakCollectionOf("WeakRef");
		if (isNumber(obj)) return markBoxed(inspect(Number(obj)));
		if (isBigInt(obj)) return markBoxed(inspect(bigIntValueOf.call(obj)));
		if (isBoolean(obj)) return markBoxed(booleanValueOf.call(obj));
		if (isString(obj)) return markBoxed(inspect(String(obj)));
		if (typeof window !== "undefined" && obj === window) return "{ [object Window] }";
		if (typeof globalThis !== "undefined" && obj === globalThis || typeof global !== "undefined" && obj === global) return "{ [object globalThis] }";
		if (!isDate(obj) && !isRegExp(obj)) {
			var ys = arrObjKeys(obj, inspect);
			var isPlainObject = gPO ? gPO(obj) === Object.prototype : obj instanceof Object || obj.constructor === Object;
			var protoTag = obj instanceof Object ? "" : "null prototype";
			var stringTag = !isPlainObject && toStringTag && Object(obj) === obj && toStringTag in obj ? $slice.call(toStr(obj), 8, -1) : protoTag ? "Object" : "";
			var tag = (isPlainObject || typeof obj.constructor !== "function" ? "" : obj.constructor.name ? obj.constructor.name + " " : "") + (stringTag || protoTag ? "[" + $join.call($concat.call([], stringTag || [], protoTag || []), ": ") + "] " : "");
			if (ys.length === 0) return tag + "{}";
			if (indent) return tag + "{" + indentedJoin(ys, indent) + "}";
			return tag + "{ " + $join.call(ys, ", ") + " }";
		}
		return String(obj);
	};
	function wrapQuotes(s, defaultStyle, opts) {
		var quoteChar = quotes[opts.quoteStyle || defaultStyle];
		return quoteChar + s + quoteChar;
	}
	function quote(s) {
		return $replace.call(String(s), /"/g, "&quot;");
	}
	function canTrustToString(obj) {
		return !toStringTag || !(typeof obj === "object" && (toStringTag in obj || typeof obj[toStringTag] !== "undefined"));
	}
	function isArray(obj) {
		return toStr(obj) === "[object Array]" && canTrustToString(obj);
	}
	function isDate(obj) {
		return toStr(obj) === "[object Date]" && canTrustToString(obj);
	}
	function isRegExp(obj) {
		return toStr(obj) === "[object RegExp]" && canTrustToString(obj);
	}
	function isError(obj) {
		return toStr(obj) === "[object Error]" && canTrustToString(obj);
	}
	function isString(obj) {
		return toStr(obj) === "[object String]" && canTrustToString(obj);
	}
	function isNumber(obj) {
		return toStr(obj) === "[object Number]" && canTrustToString(obj);
	}
	function isBoolean(obj) {
		return toStr(obj) === "[object Boolean]" && canTrustToString(obj);
	}
	function isSymbol(obj) {
		if (hasShammedSymbols) return obj && typeof obj === "object" && obj instanceof Symbol;
		if (typeof obj === "symbol") return true;
		if (!obj || typeof obj !== "object" || !symToString) return false;
		try {
			symToString.call(obj);
			return true;
		} catch (e) {}
		return false;
	}
	function isBigInt(obj) {
		if (!obj || typeof obj !== "object" || !bigIntValueOf) return false;
		try {
			bigIntValueOf.call(obj);
			return true;
		} catch (e) {}
		return false;
	}
	var hasOwn = Object.prototype.hasOwnProperty || function(key) {
		return key in this;
	};
	function has(obj, key) {
		return hasOwn.call(obj, key);
	}
	function toStr(obj) {
		return objectToString.call(obj);
	}
	function nameOf(f) {
		if (f.name) return f.name;
		var m = $match.call(functionToString.call(f), /^function\s*([\w$]+)/);
		if (m) return m[1];
		return null;
	}
	function indexOf(xs, x) {
		if (xs.indexOf) return xs.indexOf(x);
		for (var i = 0, l = xs.length; i < l; i++) if (xs[i] === x) return i;
		return -1;
	}
	function isMap(x) {
		if (!mapSize || !x || typeof x !== "object") return false;
		try {
			mapSize.call(x);
			try {
				setSize.call(x);
			} catch (s) {
				return true;
			}
			return x instanceof Map;
		} catch (e) {}
		return false;
	}
	function isWeakMap(x) {
		if (!weakMapHas || !x || typeof x !== "object") return false;
		try {
			weakMapHas.call(x, weakMapHas);
			try {
				weakSetHas.call(x, weakSetHas);
			} catch (s) {
				return true;
			}
			return x instanceof WeakMap;
		} catch (e) {}
		return false;
	}
	function isWeakRef(x) {
		if (!weakRefDeref || !x || typeof x !== "object") return false;
		try {
			weakRefDeref.call(x);
			return true;
		} catch (e) {}
		return false;
	}
	function isSet(x) {
		if (!setSize || !x || typeof x !== "object") return false;
		try {
			setSize.call(x);
			try {
				mapSize.call(x);
			} catch (m) {
				return true;
			}
			return x instanceof Set;
		} catch (e) {}
		return false;
	}
	function isWeakSet(x) {
		if (!weakSetHas || !x || typeof x !== "object") return false;
		try {
			weakSetHas.call(x, weakSetHas);
			try {
				weakMapHas.call(x, weakMapHas);
			} catch (s) {
				return true;
			}
			return x instanceof WeakSet;
		} catch (e) {}
		return false;
	}
	function isElement(x) {
		if (!x || typeof x !== "object") return false;
		if (typeof HTMLElement !== "undefined" && x instanceof HTMLElement) return true;
		return typeof x.nodeName === "string" && typeof x.getAttribute === "function";
	}
	function inspectString(str, opts) {
		if (str.length > opts.maxStringLength) {
			var remaining = str.length - opts.maxStringLength;
			var trailer = "... " + remaining + " more character" + (remaining > 1 ? "s" : "");
			return inspectString($slice.call(str, 0, opts.maxStringLength), opts) + trailer;
		}
		var quoteRE = quoteREs[opts.quoteStyle || "single"];
		quoteRE.lastIndex = 0;
		return wrapQuotes($replace.call($replace.call(str, quoteRE, "\\$1"), /[\x00-\x1f]/g, lowbyte), "single", opts);
	}
	function lowbyte(c) {
		var n = c.charCodeAt(0);
		var x = {
			8: "b",
			9: "t",
			10: "n",
			12: "f",
			13: "r"
		}[n];
		if (x) return "\\" + x;
		return "\\x" + (n < 16 ? "0" : "") + $toUpperCase.call(n.toString(16));
	}
	function markBoxed(str) {
		return "Object(" + str + ")";
	}
	function weakCollectionOf(type) {
		return type + " { ? }";
	}
	function collectionOf(type, size, entries, indent) {
		var joinedEntries = indent ? indentedJoin(entries, indent) : $join.call(entries, ", ");
		return type + " (" + size + ") {" + joinedEntries + "}";
	}
	function singleLineValues(xs) {
		for (var i = 0; i < xs.length; i++) if (indexOf(xs[i], "\n") >= 0) return false;
		return true;
	}
	function getIndent(opts, depth) {
		var baseIndent;
		if (opts.indent === "	") baseIndent = "	";
		else if (typeof opts.indent === "number" && opts.indent > 0) baseIndent = $join.call(Array(opts.indent + 1), " ");
		else return null;
		return {
			base: baseIndent,
			prev: $join.call(Array(depth + 1), baseIndent)
		};
	}
	function indentedJoin(xs, indent) {
		if (xs.length === 0) return "";
		var lineJoiner = "\n" + indent.prev + indent.base;
		return lineJoiner + $join.call(xs, "," + lineJoiner) + "\n" + indent.prev;
	}
	function arrObjKeys(obj, inspect) {
		var isArr = isArray(obj);
		var xs = [];
		if (isArr) {
			xs.length = obj.length;
			for (var i = 0; i < obj.length; i++) xs[i] = has(obj, i) ? inspect(obj[i], obj) : "";
		}
		var syms = typeof gOPS === "function" ? gOPS(obj) : [];
		var symMap;
		if (hasShammedSymbols) {
			symMap = {};
			for (var k = 0; k < syms.length; k++) symMap["$" + syms[k]] = syms[k];
		}
		for (var key in obj) {
			if (!has(obj, key)) continue;
			if (isArr && String(Number(key)) === key && key < obj.length) continue;
			if (hasShammedSymbols && symMap["$" + key] instanceof Symbol) continue;
			else if ($test.call(/[^\w$]/, key)) xs.push(inspect(key, obj) + ": " + inspect(obj[key], obj));
			else xs.push(key + ": " + inspect(obj[key], obj));
		}
		if (typeof gOPS === "function") {
			for (var j = 0; j < syms.length; j++) if (isEnumerable.call(obj, syms[j])) xs.push("[" + inspect(syms[j]) + "]: " + inspect(obj[syms[j]], obj));
		}
		return xs;
	}
}));
//#endregion
//#region ../../node_modules/.pnpm/side-channel-list@1.0.1/node_modules/side-channel-list/index.js
var require_side_channel_list = /* @__PURE__ */ __commonJSMin(((exports, module) => {
	var inspect = require_object_inspect();
	var $TypeError = require_type();
	/** @type {import('./list.d.ts').listGetNode} */
	var listGetNode = function(list, key, isDelete) {
		/** @type {typeof list | NonNullable<(typeof list)['next']>} */
		var prev = list;
		/** @type {(typeof list)['next']} */
		var curr;
		for (; (curr = prev.next) != null; prev = curr) if (curr.key === key) {
			prev.next = curr.next;
			if (!isDelete) {
				curr.next = list.next;
				list.next = curr;
			}
			return curr;
		}
	};
	/** @type {import('./list.d.ts').listGet} */
	var listGet = function(objects, key) {
		if (!objects) return;
		var node = listGetNode(objects, key);
		return node && node.value;
	};
	/** @type {import('./list.d.ts').listSet} */
	var listSet = function(objects, key, value) {
		var node = listGetNode(objects, key);
		if (node) node.value = value;
		else objects.next = {
			key,
			next: objects.next,
			value
		};
	};
	/** @type {import('./list.d.ts').listHas} */
	var listHas = function(objects, key) {
		if (!objects) return false;
		return !!listGetNode(objects, key);
	};
	/** @type {import('./list.d.ts').listDelete} */
	var listDelete = function(objects, key) {
		if (objects) return listGetNode(objects, key, true);
	};
	/** @type {import('.')} */
	module.exports = function getSideChannelList() {
		/** @typedef {ReturnType<typeof getSideChannelList>} Channel */
		/** @typedef {Parameters<Channel['get']>[0]} K */
		/** @typedef {Parameters<Channel['set']>[1]} V */
		/** @type {import('./list.d.ts').RootNode<V, K> | undefined} */ var $o;
		/** @type {Channel} */
		var channel = {
			assert: function(key) {
				if (!channel.has(key)) throw new $TypeError("Side channel does not contain " + inspect(key));
			},
			"delete": function(key) {
				var deletedNode = listDelete($o, key);
				if (deletedNode && $o && !$o.next) $o = void 0;
				return !!deletedNode;
			},
			get: function(key) {
				return listGet($o, key);
			},
			has: function(key) {
				return listHas($o, key);
			},
			set: function(key, value) {
				if (!$o) $o = { next: void 0 };
				listSet($o, key, value);
			}
		};
		return channel;
	};
}));
//#endregion
//#region ../../node_modules/.pnpm/es-object-atoms@1.1.2/node_modules/es-object-atoms/index.js
var require_es_object_atoms = /* @__PURE__ */ __commonJSMin(((exports, module) => {
	/** @type {import('.')} */
	module.exports = Object;
}));
//#endregion
//#region ../../node_modules/.pnpm/es-errors@1.3.0/node_modules/es-errors/index.js
var require_es_errors = /* @__PURE__ */ __commonJSMin(((exports, module) => {
	/** @type {import('.')} */
	module.exports = Error;
}));
//#endregion
//#region ../../node_modules/.pnpm/es-errors@1.3.0/node_modules/es-errors/eval.js
var require_eval = /* @__PURE__ */ __commonJSMin(((exports, module) => {
	/** @type {import('./eval')} */
	module.exports = EvalError;
}));
//#endregion
//#region ../../node_modules/.pnpm/es-errors@1.3.0/node_modules/es-errors/range.js
var require_range = /* @__PURE__ */ __commonJSMin(((exports, module) => {
	/** @type {import('./range')} */
	module.exports = RangeError;
}));
//#endregion
//#region ../../node_modules/.pnpm/es-errors@1.3.0/node_modules/es-errors/ref.js
var require_ref = /* @__PURE__ */ __commonJSMin(((exports, module) => {
	/** @type {import('./ref')} */
	module.exports = ReferenceError;
}));
//#endregion
//#region ../../node_modules/.pnpm/es-errors@1.3.0/node_modules/es-errors/syntax.js
var require_syntax = /* @__PURE__ */ __commonJSMin(((exports, module) => {
	/** @type {import('./syntax')} */
	module.exports = SyntaxError;
}));
//#endregion
//#region ../../node_modules/.pnpm/es-errors@1.3.0/node_modules/es-errors/uri.js
var require_uri = /* @__PURE__ */ __commonJSMin(((exports, module) => {
	/** @type {import('./uri')} */
	module.exports = URIError;
}));
//#endregion
//#region ../../node_modules/.pnpm/math-intrinsics@1.1.0/node_modules/math-intrinsics/abs.js
var require_abs = /* @__PURE__ */ __commonJSMin(((exports, module) => {
	/** @type {import('./abs')} */
	module.exports = Math.abs;
}));
//#endregion
//#region ../../node_modules/.pnpm/math-intrinsics@1.1.0/node_modules/math-intrinsics/floor.js
var require_floor = /* @__PURE__ */ __commonJSMin(((exports, module) => {
	/** @type {import('./floor')} */
	module.exports = Math.floor;
}));
//#endregion
//#region ../../node_modules/.pnpm/math-intrinsics@1.1.0/node_modules/math-intrinsics/max.js
var require_max = /* @__PURE__ */ __commonJSMin(((exports, module) => {
	/** @type {import('./max')} */
	module.exports = Math.max;
}));
//#endregion
//#region ../../node_modules/.pnpm/math-intrinsics@1.1.0/node_modules/math-intrinsics/min.js
var require_min = /* @__PURE__ */ __commonJSMin(((exports, module) => {
	/** @type {import('./min')} */
	module.exports = Math.min;
}));
//#endregion
//#region ../../node_modules/.pnpm/math-intrinsics@1.1.0/node_modules/math-intrinsics/pow.js
var require_pow = /* @__PURE__ */ __commonJSMin(((exports, module) => {
	/** @type {import('./pow')} */
	module.exports = Math.pow;
}));
//#endregion
//#region ../../node_modules/.pnpm/math-intrinsics@1.1.0/node_modules/math-intrinsics/round.js
var require_round = /* @__PURE__ */ __commonJSMin(((exports, module) => {
	/** @type {import('./round')} */
	module.exports = Math.round;
}));
//#endregion
//#region ../../node_modules/.pnpm/math-intrinsics@1.1.0/node_modules/math-intrinsics/isNaN.js
var require_isNaN = /* @__PURE__ */ __commonJSMin(((exports, module) => {
	/** @type {import('./isNaN')} */
	module.exports = Number.isNaN || function isNaN(a) {
		return a !== a;
	};
}));
//#endregion
//#region ../../node_modules/.pnpm/math-intrinsics@1.1.0/node_modules/math-intrinsics/sign.js
var require_sign = /* @__PURE__ */ __commonJSMin(((exports, module) => {
	var $isNaN = require_isNaN();
	/** @type {import('./sign')} */
	module.exports = function sign(number) {
		if ($isNaN(number) || number === 0) return number;
		return number < 0 ? -1 : 1;
	};
}));
//#endregion
//#region ../../node_modules/.pnpm/gopd@1.2.0/node_modules/gopd/gOPD.js
var require_gOPD = /* @__PURE__ */ __commonJSMin(((exports, module) => {
	/** @type {import('./gOPD')} */
	module.exports = Object.getOwnPropertyDescriptor;
}));
//#endregion
//#region ../../node_modules/.pnpm/gopd@1.2.0/node_modules/gopd/index.js
var require_gopd = /* @__PURE__ */ __commonJSMin(((exports, module) => {
	/** @type {import('.')} */
	var $gOPD = require_gOPD();
	if ($gOPD) try {
		$gOPD([], "length");
	} catch (e) {
		$gOPD = null;
	}
	module.exports = $gOPD;
}));
//#endregion
//#region ../../node_modules/.pnpm/es-define-property@1.0.1/node_modules/es-define-property/index.js
var require_es_define_property = /* @__PURE__ */ __commonJSMin(((exports, module) => {
	/** @type {import('.')} */
	var $defineProperty = Object.defineProperty || false;
	if ($defineProperty) try {
		$defineProperty({}, "a", { value: 1 });
	} catch (e) {
		$defineProperty = false;
	}
	module.exports = $defineProperty;
}));
//#endregion
//#region ../../node_modules/.pnpm/has-symbols@1.1.0/node_modules/has-symbols/shams.js
var require_shams = /* @__PURE__ */ __commonJSMin(((exports, module) => {
	/** @type {import('./shams')} */
	module.exports = function hasSymbols() {
		if (typeof Symbol !== "function" || typeof Object.getOwnPropertySymbols !== "function") return false;
		if (typeof Symbol.iterator === "symbol") return true;
		/** @type {{ [k in symbol]?: unknown }} */
		var obj = {};
		var sym = Symbol("test");
		var symObj = Object(sym);
		if (typeof sym === "string") return false;
		if (Object.prototype.toString.call(sym) !== "[object Symbol]") return false;
		if (Object.prototype.toString.call(symObj) !== "[object Symbol]") return false;
		var symVal = 42;
		obj[sym] = symVal;
		for (var _ in obj) return false;
		if (typeof Object.keys === "function" && Object.keys(obj).length !== 0) return false;
		if (typeof Object.getOwnPropertyNames === "function" && Object.getOwnPropertyNames(obj).length !== 0) return false;
		var syms = Object.getOwnPropertySymbols(obj);
		if (syms.length !== 1 || syms[0] !== sym) return false;
		if (!Object.prototype.propertyIsEnumerable.call(obj, sym)) return false;
		if (typeof Object.getOwnPropertyDescriptor === "function") {
			var descriptor = Object.getOwnPropertyDescriptor(obj, sym);
			if (descriptor.value !== symVal || descriptor.enumerable !== true) return false;
		}
		return true;
	};
}));
//#endregion
//#region ../../node_modules/.pnpm/has-symbols@1.1.0/node_modules/has-symbols/index.js
var require_has_symbols = /* @__PURE__ */ __commonJSMin(((exports, module) => {
	var origSymbol = typeof Symbol !== "undefined" && Symbol;
	var hasSymbolSham = require_shams();
	/** @type {import('.')} */
	module.exports = function hasNativeSymbols() {
		if (typeof origSymbol !== "function") return false;
		if (typeof Symbol !== "function") return false;
		if (typeof origSymbol("foo") !== "symbol") return false;
		if (typeof Symbol("bar") !== "symbol") return false;
		return hasSymbolSham();
	};
}));
//#endregion
//#region ../../node_modules/.pnpm/get-proto@1.0.1/node_modules/get-proto/Reflect.getPrototypeOf.js
var require_Reflect_getPrototypeOf = /* @__PURE__ */ __commonJSMin(((exports, module) => {
	/** @type {import('./Reflect.getPrototypeOf')} */
	module.exports = typeof Reflect !== "undefined" && Reflect.getPrototypeOf || null;
}));
//#endregion
//#region ../../node_modules/.pnpm/get-proto@1.0.1/node_modules/get-proto/Object.getPrototypeOf.js
var require_Object_getPrototypeOf = /* @__PURE__ */ __commonJSMin(((exports, module) => {
	/** @type {import('./Object.getPrototypeOf')} */
	module.exports = require_es_object_atoms().getPrototypeOf || null;
}));
//#endregion
//#region ../../node_modules/.pnpm/function-bind@1.1.2/node_modules/function-bind/implementation.js
var require_implementation = /* @__PURE__ */ __commonJSMin(((exports, module) => {
	var ERROR_MESSAGE = "Function.prototype.bind called on incompatible ";
	var toStr = Object.prototype.toString;
	var max = Math.max;
	var funcType = "[object Function]";
	var concatty = function concatty(a, b) {
		var arr = [];
		for (var i = 0; i < a.length; i += 1) arr[i] = a[i];
		for (var j = 0; j < b.length; j += 1) arr[j + a.length] = b[j];
		return arr;
	};
	var slicy = function slicy(arrLike, offset) {
		var arr = [];
		for (var i = offset || 0, j = 0; i < arrLike.length; i += 1, j += 1) arr[j] = arrLike[i];
		return arr;
	};
	var joiny = function(arr, joiner) {
		var str = "";
		for (var i = 0; i < arr.length; i += 1) {
			str += arr[i];
			if (i + 1 < arr.length) str += joiner;
		}
		return str;
	};
	module.exports = function bind(that) {
		var target = this;
		if (typeof target !== "function" || toStr.apply(target) !== funcType) throw new TypeError(ERROR_MESSAGE + target);
		var args = slicy(arguments, 1);
		var bound;
		var binder = function() {
			if (this instanceof bound) {
				var result = target.apply(this, concatty(args, arguments));
				if (Object(result) === result) return result;
				return this;
			}
			return target.apply(that, concatty(args, arguments));
		};
		var boundLength = max(0, target.length - args.length);
		var boundArgs = [];
		for (var i = 0; i < boundLength; i++) boundArgs[i] = "$" + i;
		bound = Function("binder", "return function (" + joiny(boundArgs, ",") + "){ return binder.apply(this,arguments); }")(binder);
		if (target.prototype) {
			var Empty = function Empty() {};
			Empty.prototype = target.prototype;
			bound.prototype = new Empty();
			Empty.prototype = null;
		}
		return bound;
	};
}));
//#endregion
//#region ../../node_modules/.pnpm/function-bind@1.1.2/node_modules/function-bind/index.js
var require_function_bind = /* @__PURE__ */ __commonJSMin(((exports, module) => {
	var implementation = require_implementation();
	module.exports = Function.prototype.bind || implementation;
}));
//#endregion
//#region ../../node_modules/.pnpm/call-bind-apply-helpers@1.0.2/node_modules/call-bind-apply-helpers/functionCall.js
var require_functionCall = /* @__PURE__ */ __commonJSMin(((exports, module) => {
	/** @type {import('./functionCall')} */
	module.exports = Function.prototype.call;
}));
//#endregion
//#region ../../node_modules/.pnpm/call-bind-apply-helpers@1.0.2/node_modules/call-bind-apply-helpers/functionApply.js
var require_functionApply = /* @__PURE__ */ __commonJSMin(((exports, module) => {
	/** @type {import('./functionApply')} */
	module.exports = Function.prototype.apply;
}));
//#endregion
//#region ../../node_modules/.pnpm/call-bind-apply-helpers@1.0.2/node_modules/call-bind-apply-helpers/reflectApply.js
var require_reflectApply = /* @__PURE__ */ __commonJSMin(((exports, module) => {
	/** @type {import('./reflectApply')} */
	module.exports = typeof Reflect !== "undefined" && Reflect && Reflect.apply;
}));
//#endregion
//#region ../../node_modules/.pnpm/call-bind-apply-helpers@1.0.2/node_modules/call-bind-apply-helpers/actualApply.js
var require_actualApply = /* @__PURE__ */ __commonJSMin(((exports, module) => {
	var bind = require_function_bind();
	var $apply = require_functionApply();
	var $call = require_functionCall();
	/** @type {import('./actualApply')} */
	module.exports = require_reflectApply() || bind.call($call, $apply);
}));
//#endregion
//#region ../../node_modules/.pnpm/call-bind-apply-helpers@1.0.2/node_modules/call-bind-apply-helpers/index.js
var require_call_bind_apply_helpers = /* @__PURE__ */ __commonJSMin(((exports, module) => {
	var bind = require_function_bind();
	var $TypeError = require_type();
	var $call = require_functionCall();
	var $actualApply = require_actualApply();
	/** @type {(args: [Function, thisArg?: unknown, ...args: unknown[]]) => Function} TODO FIXME, find a way to use import('.') */
	module.exports = function callBindBasic(args) {
		if (args.length < 1 || typeof args[0] !== "function") throw new $TypeError("a function is required");
		return $actualApply(bind, $call, args);
	};
}));
//#endregion
//#region ../../node_modules/.pnpm/dunder-proto@1.0.1/node_modules/dunder-proto/get.js
var require_get = /* @__PURE__ */ __commonJSMin(((exports, module) => {
	var callBind = require_call_bind_apply_helpers();
	var gOPD = require_gopd();
	var hasProtoAccessor;
	try {
		hasProtoAccessor = [].__proto__ === Array.prototype;
	} catch (e) {
		if (!e || typeof e !== "object" || !("code" in e) || e.code !== "ERR_PROTO_ACCESS") throw e;
	}
	var desc = !!hasProtoAccessor && gOPD && gOPD(Object.prototype, "__proto__");
	var $Object = Object;
	var $getPrototypeOf = $Object.getPrototypeOf;
	/** @type {import('./get')} */
	module.exports = desc && typeof desc.get === "function" ? callBind([desc.get]) : typeof $getPrototypeOf === "function" ? function getDunder(value) {
		return $getPrototypeOf(value == null ? value : $Object(value));
	} : false;
}));
//#endregion
//#region ../../node_modules/.pnpm/get-proto@1.0.1/node_modules/get-proto/index.js
var require_get_proto = /* @__PURE__ */ __commonJSMin(((exports, module) => {
	var reflectGetProto = require_Reflect_getPrototypeOf();
	var originalGetProto = require_Object_getPrototypeOf();
	var getDunderProto = require_get();
	/** @type {import('.')} */
	module.exports = reflectGetProto ? function getProto(O) {
		return reflectGetProto(O);
	} : originalGetProto ? function getProto(O) {
		if (!O || typeof O !== "object" && typeof O !== "function") throw new TypeError("getProto: not an object");
		return originalGetProto(O);
	} : getDunderProto ? function getProto(O) {
		return getDunderProto(O);
	} : null;
}));
//#endregion
//#region ../../node_modules/.pnpm/hasown@2.0.4/node_modules/hasown/index.js
var require_hasown = /* @__PURE__ */ __commonJSMin(((exports, module) => {
	var call = Function.prototype.call;
	var $hasOwn = Object.prototype.hasOwnProperty;
	/** @type {import('.')} */
	module.exports = require_function_bind().call(call, $hasOwn);
}));
//#endregion
//#region ../../node_modules/.pnpm/get-intrinsic@1.3.0/node_modules/get-intrinsic/index.js
var require_get_intrinsic = /* @__PURE__ */ __commonJSMin(((exports, module) => {
	var undefined;
	var $Object = require_es_object_atoms();
	var $Error = require_es_errors();
	var $EvalError = require_eval();
	var $RangeError = require_range();
	var $ReferenceError = require_ref();
	var $SyntaxError = require_syntax();
	var $TypeError = require_type();
	var $URIError = require_uri();
	var abs = require_abs();
	var floor = require_floor();
	var max = require_max();
	var min = require_min();
	var pow = require_pow();
	var round = require_round();
	var sign = require_sign();
	var $Function = Function;
	var getEvalledConstructor = function(expressionSyntax) {
		try {
			return $Function("\"use strict\"; return (" + expressionSyntax + ").constructor;")();
		} catch (e) {}
	};
	var $gOPD = require_gopd();
	var $defineProperty = require_es_define_property();
	var throwTypeError = function() {
		throw new $TypeError();
	};
	var ThrowTypeError = $gOPD ? function() {
		try {
			arguments.callee;
			return throwTypeError;
		} catch (calleeThrows) {
			try {
				return $gOPD(arguments, "callee").get;
			} catch (gOPDthrows) {
				return throwTypeError;
			}
		}
	}() : throwTypeError;
	var hasSymbols = require_has_symbols()();
	var getProto = require_get_proto();
	var $ObjectGPO = require_Object_getPrototypeOf();
	var $ReflectGPO = require_Reflect_getPrototypeOf();
	var $apply = require_functionApply();
	var $call = require_functionCall();
	var needsEval = {};
	var TypedArray = typeof Uint8Array === "undefined" || !getProto ? undefined : getProto(Uint8Array);
	var INTRINSICS = {
		__proto__: null,
		"%AggregateError%": typeof AggregateError === "undefined" ? undefined : AggregateError,
		"%Array%": Array,
		"%ArrayBuffer%": typeof ArrayBuffer === "undefined" ? undefined : ArrayBuffer,
		"%ArrayIteratorPrototype%": hasSymbols && getProto ? getProto([][Symbol.iterator]()) : undefined,
		"%AsyncFromSyncIteratorPrototype%": undefined,
		"%AsyncFunction%": needsEval,
		"%AsyncGenerator%": needsEval,
		"%AsyncGeneratorFunction%": needsEval,
		"%AsyncIteratorPrototype%": needsEval,
		"%Atomics%": typeof Atomics === "undefined" ? undefined : Atomics,
		"%BigInt%": typeof BigInt === "undefined" ? undefined : BigInt,
		"%BigInt64Array%": typeof BigInt64Array === "undefined" ? undefined : BigInt64Array,
		"%BigUint64Array%": typeof BigUint64Array === "undefined" ? undefined : BigUint64Array,
		"%Boolean%": Boolean,
		"%DataView%": typeof DataView === "undefined" ? undefined : DataView,
		"%Date%": Date,
		"%decodeURI%": decodeURI,
		"%decodeURIComponent%": decodeURIComponent,
		"%encodeURI%": encodeURI,
		"%encodeURIComponent%": encodeURIComponent,
		"%Error%": $Error,
		"%eval%": eval,
		"%EvalError%": $EvalError,
		"%Float16Array%": typeof Float16Array === "undefined" ? undefined : Float16Array,
		"%Float32Array%": typeof Float32Array === "undefined" ? undefined : Float32Array,
		"%Float64Array%": typeof Float64Array === "undefined" ? undefined : Float64Array,
		"%FinalizationRegistry%": typeof FinalizationRegistry === "undefined" ? undefined : FinalizationRegistry,
		"%Function%": $Function,
		"%GeneratorFunction%": needsEval,
		"%Int8Array%": typeof Int8Array === "undefined" ? undefined : Int8Array,
		"%Int16Array%": typeof Int16Array === "undefined" ? undefined : Int16Array,
		"%Int32Array%": typeof Int32Array === "undefined" ? undefined : Int32Array,
		"%isFinite%": isFinite,
		"%isNaN%": isNaN,
		"%IteratorPrototype%": hasSymbols && getProto ? getProto(getProto([][Symbol.iterator]())) : undefined,
		"%JSON%": typeof JSON === "object" ? JSON : undefined,
		"%Map%": typeof Map === "undefined" ? undefined : Map,
		"%MapIteratorPrototype%": typeof Map === "undefined" || !hasSymbols || !getProto ? undefined : getProto((/* @__PURE__ */ new Map())[Symbol.iterator]()),
		"%Math%": Math,
		"%Number%": Number,
		"%Object%": $Object,
		"%Object.getOwnPropertyDescriptor%": $gOPD,
		"%parseFloat%": parseFloat,
		"%parseInt%": parseInt,
		"%Promise%": typeof Promise === "undefined" ? undefined : Promise,
		"%Proxy%": typeof Proxy === "undefined" ? undefined : Proxy,
		"%RangeError%": $RangeError,
		"%ReferenceError%": $ReferenceError,
		"%Reflect%": typeof Reflect === "undefined" ? undefined : Reflect,
		"%RegExp%": RegExp,
		"%Set%": typeof Set === "undefined" ? undefined : Set,
		"%SetIteratorPrototype%": typeof Set === "undefined" || !hasSymbols || !getProto ? undefined : getProto((/* @__PURE__ */ new Set())[Symbol.iterator]()),
		"%SharedArrayBuffer%": typeof SharedArrayBuffer === "undefined" ? undefined : SharedArrayBuffer,
		"%String%": String,
		"%StringIteratorPrototype%": hasSymbols && getProto ? getProto(""[Symbol.iterator]()) : undefined,
		"%Symbol%": hasSymbols ? Symbol : undefined,
		"%SyntaxError%": $SyntaxError,
		"%ThrowTypeError%": ThrowTypeError,
		"%TypedArray%": TypedArray,
		"%TypeError%": $TypeError,
		"%Uint8Array%": typeof Uint8Array === "undefined" ? undefined : Uint8Array,
		"%Uint8ClampedArray%": typeof Uint8ClampedArray === "undefined" ? undefined : Uint8ClampedArray,
		"%Uint16Array%": typeof Uint16Array === "undefined" ? undefined : Uint16Array,
		"%Uint32Array%": typeof Uint32Array === "undefined" ? undefined : Uint32Array,
		"%URIError%": $URIError,
		"%WeakMap%": typeof WeakMap === "undefined" ? undefined : WeakMap,
		"%WeakRef%": typeof WeakRef === "undefined" ? undefined : WeakRef,
		"%WeakSet%": typeof WeakSet === "undefined" ? undefined : WeakSet,
		"%Function.prototype.call%": $call,
		"%Function.prototype.apply%": $apply,
		"%Object.defineProperty%": $defineProperty,
		"%Object.getPrototypeOf%": $ObjectGPO,
		"%Math.abs%": abs,
		"%Math.floor%": floor,
		"%Math.max%": max,
		"%Math.min%": min,
		"%Math.pow%": pow,
		"%Math.round%": round,
		"%Math.sign%": sign,
		"%Reflect.getPrototypeOf%": $ReflectGPO
	};
	if (getProto) try {
		null.error;
	} catch (e) {
		INTRINSICS["%Error.prototype%"] = getProto(getProto(e));
	}
	var doEval = function doEval(name) {
		var value;
		if (name === "%AsyncFunction%") value = getEvalledConstructor("async function () {}");
		else if (name === "%GeneratorFunction%") value = getEvalledConstructor("function* () {}");
		else if (name === "%AsyncGeneratorFunction%") value = getEvalledConstructor("async function* () {}");
		else if (name === "%AsyncGenerator%") {
			var fn = doEval("%AsyncGeneratorFunction%");
			if (fn) value = fn.prototype;
		} else if (name === "%AsyncIteratorPrototype%") {
			var gen = doEval("%AsyncGenerator%");
			if (gen && getProto) value = getProto(gen.prototype);
		}
		INTRINSICS[name] = value;
		return value;
	};
	var LEGACY_ALIASES = {
		__proto__: null,
		"%ArrayBufferPrototype%": ["ArrayBuffer", "prototype"],
		"%ArrayPrototype%": ["Array", "prototype"],
		"%ArrayProto_entries%": [
			"Array",
			"prototype",
			"entries"
		],
		"%ArrayProto_forEach%": [
			"Array",
			"prototype",
			"forEach"
		],
		"%ArrayProto_keys%": [
			"Array",
			"prototype",
			"keys"
		],
		"%ArrayProto_values%": [
			"Array",
			"prototype",
			"values"
		],
		"%AsyncFunctionPrototype%": ["AsyncFunction", "prototype"],
		"%AsyncGenerator%": ["AsyncGeneratorFunction", "prototype"],
		"%AsyncGeneratorPrototype%": [
			"AsyncGeneratorFunction",
			"prototype",
			"prototype"
		],
		"%BooleanPrototype%": ["Boolean", "prototype"],
		"%DataViewPrototype%": ["DataView", "prototype"],
		"%DatePrototype%": ["Date", "prototype"],
		"%ErrorPrototype%": ["Error", "prototype"],
		"%EvalErrorPrototype%": ["EvalError", "prototype"],
		"%Float32ArrayPrototype%": ["Float32Array", "prototype"],
		"%Float64ArrayPrototype%": ["Float64Array", "prototype"],
		"%FunctionPrototype%": ["Function", "prototype"],
		"%Generator%": ["GeneratorFunction", "prototype"],
		"%GeneratorPrototype%": [
			"GeneratorFunction",
			"prototype",
			"prototype"
		],
		"%Int8ArrayPrototype%": ["Int8Array", "prototype"],
		"%Int16ArrayPrototype%": ["Int16Array", "prototype"],
		"%Int32ArrayPrototype%": ["Int32Array", "prototype"],
		"%JSONParse%": ["JSON", "parse"],
		"%JSONStringify%": ["JSON", "stringify"],
		"%MapPrototype%": ["Map", "prototype"],
		"%NumberPrototype%": ["Number", "prototype"],
		"%ObjectPrototype%": ["Object", "prototype"],
		"%ObjProto_toString%": [
			"Object",
			"prototype",
			"toString"
		],
		"%ObjProto_valueOf%": [
			"Object",
			"prototype",
			"valueOf"
		],
		"%PromisePrototype%": ["Promise", "prototype"],
		"%PromiseProto_then%": [
			"Promise",
			"prototype",
			"then"
		],
		"%Promise_all%": ["Promise", "all"],
		"%Promise_reject%": ["Promise", "reject"],
		"%Promise_resolve%": ["Promise", "resolve"],
		"%RangeErrorPrototype%": ["RangeError", "prototype"],
		"%ReferenceErrorPrototype%": ["ReferenceError", "prototype"],
		"%RegExpPrototype%": ["RegExp", "prototype"],
		"%SetPrototype%": ["Set", "prototype"],
		"%SharedArrayBufferPrototype%": ["SharedArrayBuffer", "prototype"],
		"%StringPrototype%": ["String", "prototype"],
		"%SymbolPrototype%": ["Symbol", "prototype"],
		"%SyntaxErrorPrototype%": ["SyntaxError", "prototype"],
		"%TypedArrayPrototype%": ["TypedArray", "prototype"],
		"%TypeErrorPrototype%": ["TypeError", "prototype"],
		"%Uint8ArrayPrototype%": ["Uint8Array", "prototype"],
		"%Uint8ClampedArrayPrototype%": ["Uint8ClampedArray", "prototype"],
		"%Uint16ArrayPrototype%": ["Uint16Array", "prototype"],
		"%Uint32ArrayPrototype%": ["Uint32Array", "prototype"],
		"%URIErrorPrototype%": ["URIError", "prototype"],
		"%WeakMapPrototype%": ["WeakMap", "prototype"],
		"%WeakSetPrototype%": ["WeakSet", "prototype"]
	};
	var bind = require_function_bind();
	var hasOwn = require_hasown();
	var $concat = bind.call($call, Array.prototype.concat);
	var $spliceApply = bind.call($apply, Array.prototype.splice);
	var $replace = bind.call($call, String.prototype.replace);
	var $strSlice = bind.call($call, String.prototype.slice);
	var $exec = bind.call($call, RegExp.prototype.exec);
	var rePropName = /[^%.[\]]+|\[(?:(-?\d+(?:\.\d+)?)|(["'])((?:(?!\2)[^\\]|\\.)*?)\2)\]|(?=(?:\.|\[\])(?:\.|\[\]|%$))/g;
	var reEscapeChar = /\\(\\)?/g;
	var stringToPath = function stringToPath(string) {
		var first = $strSlice(string, 0, 1);
		var last = $strSlice(string, -1);
		if (first === "%" && last !== "%") throw new $SyntaxError("invalid intrinsic syntax, expected closing `%`");
		else if (last === "%" && first !== "%") throw new $SyntaxError("invalid intrinsic syntax, expected opening `%`");
		var result = [];
		$replace(string, rePropName, function(match, number, quote, subString) {
			result[result.length] = quote ? $replace(subString, reEscapeChar, "$1") : number || match;
		});
		return result;
	};
	var getBaseIntrinsic = function getBaseIntrinsic(name, allowMissing) {
		var intrinsicName = name;
		var alias;
		if (hasOwn(LEGACY_ALIASES, intrinsicName)) {
			alias = LEGACY_ALIASES[intrinsicName];
			intrinsicName = "%" + alias[0] + "%";
		}
		if (hasOwn(INTRINSICS, intrinsicName)) {
			var value = INTRINSICS[intrinsicName];
			if (value === needsEval) value = doEval(intrinsicName);
			if (typeof value === "undefined" && !allowMissing) throw new $TypeError("intrinsic " + name + " exists, but is not available. Please file an issue!");
			return {
				alias,
				name: intrinsicName,
				value
			};
		}
		throw new $SyntaxError("intrinsic " + name + " does not exist!");
	};
	module.exports = function GetIntrinsic(name, allowMissing) {
		if (typeof name !== "string" || name.length === 0) throw new $TypeError("intrinsic name must be a non-empty string");
		if (arguments.length > 1 && typeof allowMissing !== "boolean") throw new $TypeError("\"allowMissing\" argument must be a boolean");
		if ($exec(/^%?[^%]*%?$/, name) === null) throw new $SyntaxError("`%` may not be present anywhere but at the beginning and end of the intrinsic name");
		var parts = stringToPath(name);
		var intrinsicBaseName = parts.length > 0 ? parts[0] : "";
		var intrinsic = getBaseIntrinsic("%" + intrinsicBaseName + "%", allowMissing);
		var intrinsicRealName = intrinsic.name;
		var value = intrinsic.value;
		var skipFurtherCaching = false;
		var alias = intrinsic.alias;
		if (alias) {
			intrinsicBaseName = alias[0];
			$spliceApply(parts, $concat([0, 1], alias));
		}
		for (var i = 1, isOwn = true; i < parts.length; i += 1) {
			var part = parts[i];
			var first = $strSlice(part, 0, 1);
			var last = $strSlice(part, -1);
			if ((first === "\"" || first === "'" || first === "`" || last === "\"" || last === "'" || last === "`") && first !== last) throw new $SyntaxError("property names with quotes must have matching quotes");
			if (part === "constructor" || !isOwn) skipFurtherCaching = true;
			intrinsicBaseName += "." + part;
			intrinsicRealName = "%" + intrinsicBaseName + "%";
			if (hasOwn(INTRINSICS, intrinsicRealName)) value = INTRINSICS[intrinsicRealName];
			else if (value != null) {
				if (!(part in value)) {
					if (!allowMissing) throw new $TypeError("base intrinsic for " + name + " exists, but the property is not available.");
					return;
				}
				if ($gOPD && i + 1 >= parts.length) {
					var desc = $gOPD(value, part);
					isOwn = !!desc;
					if (isOwn && "get" in desc && !("originalValue" in desc.get)) value = desc.get;
					else value = value[part];
				} else {
					isOwn = hasOwn(value, part);
					value = value[part];
				}
				if (isOwn && !skipFurtherCaching) INTRINSICS[intrinsicRealName] = value;
			}
		}
		return value;
	};
}));
//#endregion
//#region ../../node_modules/.pnpm/call-bound@1.0.4/node_modules/call-bound/index.js
var require_call_bound = /* @__PURE__ */ __commonJSMin(((exports, module) => {
	var GetIntrinsic = require_get_intrinsic();
	var callBindBasic = require_call_bind_apply_helpers();
	/** @type {(thisArg: string, searchString: string, position?: number) => number} */
	var $indexOf = callBindBasic([GetIntrinsic("%String.prototype.indexOf%")]);
	/** @type {import('.')} */
	module.exports = function callBoundIntrinsic(name, allowMissing) {
		var intrinsic = GetIntrinsic(name, !!allowMissing);
		if (typeof intrinsic === "function" && $indexOf(name, ".prototype.") > -1) return callBindBasic([intrinsic]);
		return intrinsic;
	};
}));
//#endregion
//#region ../../node_modules/.pnpm/side-channel-map@1.0.1/node_modules/side-channel-map/index.js
var require_side_channel_map = /* @__PURE__ */ __commonJSMin(((exports, module) => {
	var GetIntrinsic = require_get_intrinsic();
	var callBound = require_call_bound();
	var inspect = require_object_inspect();
	var $TypeError = require_type();
	var $Map = GetIntrinsic("%Map%", true);
	/** @type {<K, V>(thisArg: Map<K, V>, key: K) => V} */
	var $mapGet = callBound("Map.prototype.get", true);
	/** @type {<K, V>(thisArg: Map<K, V>, key: K, value: V) => void} */
	var $mapSet = callBound("Map.prototype.set", true);
	/** @type {<K, V>(thisArg: Map<K, V>, key: K) => boolean} */
	var $mapHas = callBound("Map.prototype.has", true);
	/** @type {<K, V>(thisArg: Map<K, V>, key: K) => boolean} */
	var $mapDelete = callBound("Map.prototype.delete", true);
	/** @type {<K, V>(thisArg: Map<K, V>) => number} */
	var $mapSize = callBound("Map.prototype.size", true);
	/** @type {import('.')} */
	module.exports = !!$Map && function getSideChannelMap() {
		/** @typedef {ReturnType<typeof getSideChannelMap>} Channel */
		/** @typedef {Parameters<Channel['get']>[0]} K */
		/** @typedef {Parameters<Channel['set']>[1]} V */
		/** @type {Map<K, V> | undefined} */ var $m;
		/** @type {Channel} */
		var channel = {
			assert: function(key) {
				if (!channel.has(key)) throw new $TypeError("Side channel does not contain " + inspect(key));
			},
			"delete": function(key) {
				if ($m) {
					var result = $mapDelete($m, key);
					if ($mapSize($m) === 0) $m = void 0;
					return result;
				}
				return false;
			},
			get: function(key) {
				if ($m) return $mapGet($m, key);
			},
			has: function(key) {
				if ($m) return $mapHas($m, key);
				return false;
			},
			set: function(key, value) {
				if (!$m) $m = new $Map();
				$mapSet($m, key, value);
			}
		};
		return channel;
	};
}));
//#endregion
//#region ../../node_modules/.pnpm/side-channel-weakmap@1.0.2/node_modules/side-channel-weakmap/index.js
var require_side_channel_weakmap = /* @__PURE__ */ __commonJSMin(((exports, module) => {
	var GetIntrinsic = require_get_intrinsic();
	var callBound = require_call_bound();
	var inspect = require_object_inspect();
	var getSideChannelMap = require_side_channel_map();
	var $TypeError = require_type();
	var $WeakMap = GetIntrinsic("%WeakMap%", true);
	/** @type {<K extends object, V>(thisArg: WeakMap<K, V>, key: K) => V} */
	var $weakMapGet = callBound("WeakMap.prototype.get", true);
	/** @type {<K extends object, V>(thisArg: WeakMap<K, V>, key: K, value: V) => void} */
	var $weakMapSet = callBound("WeakMap.prototype.set", true);
	/** @type {<K extends object, V>(thisArg: WeakMap<K, V>, key: K) => boolean} */
	var $weakMapHas = callBound("WeakMap.prototype.has", true);
	/** @type {<K extends object, V>(thisArg: WeakMap<K, V>, key: K) => boolean} */
	var $weakMapDelete = callBound("WeakMap.prototype.delete", true);
	/** @type {import('.')} */
	module.exports = $WeakMap ? function getSideChannelWeakMap() {
		/** @typedef {ReturnType<typeof getSideChannelWeakMap>} Channel */
		/** @typedef {Parameters<Channel['get']>[0]} K */
		/** @typedef {Parameters<Channel['set']>[1]} V */
		/** @type {WeakMap<K & object, V> | undefined} */ var $wm;
		/** @type {Channel | undefined} */ var $m;
		/** @type {Channel} */
		var channel = {
			assert: function(key) {
				if (!channel.has(key)) throw new $TypeError("Side channel does not contain " + inspect(key));
			},
			"delete": function(key) {
				if ($WeakMap && key && (typeof key === "object" || typeof key === "function")) {
					if ($wm) return $weakMapDelete($wm, key);
				} else if (getSideChannelMap) {
					if ($m) return $m["delete"](key);
				}
				return false;
			},
			get: function(key) {
				if ($WeakMap && key && (typeof key === "object" || typeof key === "function")) {
					if ($wm) return $weakMapGet($wm, key);
				}
				return $m && $m.get(key);
			},
			has: function(key) {
				if ($WeakMap && key && (typeof key === "object" || typeof key === "function")) {
					if ($wm) return $weakMapHas($wm, key);
				}
				return !!$m && $m.has(key);
			},
			set: function(key, value) {
				if ($WeakMap && key && (typeof key === "object" || typeof key === "function")) {
					if (!$wm) $wm = new $WeakMap();
					$weakMapSet($wm, key, value);
				} else if (getSideChannelMap) {
					if (!$m) $m = getSideChannelMap();
					/** @type {NonNullable<typeof $m>} */ $m.set(key, value);
				}
			}
		};
		return channel;
	} : getSideChannelMap;
}));
//#endregion
//#region ../../node_modules/.pnpm/side-channel@1.1.1/node_modules/side-channel/index.js
var require_side_channel = /* @__PURE__ */ __commonJSMin(((exports, module) => {
	var $TypeError = require_type();
	var inspect = require_object_inspect();
	var getSideChannelList = require_side_channel_list();
	var getSideChannelMap = require_side_channel_map();
	var makeChannel = require_side_channel_weakmap() || getSideChannelMap || getSideChannelList;
	/** @type {import('.')} */
	module.exports = function getSideChannel() {
		/** @typedef {ReturnType<typeof getSideChannel>} Channel */
		/** @type {Channel | undefined} */ var $channelData;
		/** @type {Channel} */
		var channel = {
			assert: function(key) {
				if (!channel.has(key)) throw new $TypeError("Side channel does not contain " + (key && Object(key) === key ? "the given object key" : inspect(key)));
			},
			"delete": function(key) {
				return !!$channelData && $channelData["delete"](key);
			},
			get: function(key) {
				return $channelData && $channelData.get(key);
			},
			has: function(key) {
				return !!$channelData && $channelData.has(key);
			},
			set: function(key, value) {
				if (!$channelData) $channelData = makeChannel();
				$channelData.set(key, value);
			}
		};
		return channel;
	};
}));
//#endregion
//#region ../../node_modules/.pnpm/qs@6.16.0/node_modules/qs/lib/formats.js
var require_formats = /* @__PURE__ */ __commonJSMin(((exports, module) => {
	var replace = String.prototype.replace;
	var percentTwenties = /%20/g;
	var Format = {
		RFC1738: "RFC1738",
		RFC3986: "RFC3986"
	};
	module.exports = {
		"default": Format.RFC3986,
		formatters: {
			RFC1738: function(value) {
				return replace.call(value, percentTwenties, "+");
			},
			RFC3986: function(value) {
				return String(value);
			}
		},
		RFC1738: Format.RFC1738,
		RFC3986: Format.RFC3986
	};
}));
//#endregion
//#region ../../node_modules/.pnpm/qs@6.16.0/node_modules/qs/lib/utils.js
var require_utils = /* @__PURE__ */ __commonJSMin(((exports, module) => {
	var formats = require_formats();
	var getSideChannel = require_side_channel();
	var defineProperty = require_es_define_property();
	var has = Object.prototype.hasOwnProperty;
	var isArray = Array.isArray;
	var overflowChannel = getSideChannel();
	var markOverflow = function markOverflow(obj, maxIndex) {
		overflowChannel.set(obj, maxIndex);
		return obj;
	};
	var isOverflow = function isOverflow(obj) {
		return overflowChannel.has(obj);
	};
	var getMaxIndex = function getMaxIndex(obj) {
		return overflowChannel.get(obj);
	};
	var setMaxIndex = function setMaxIndex(obj, maxIndex) {
		overflowChannel.set(obj, maxIndex);
	};
	var hexTable = function() {
		var array = [];
		for (var i = 0; i < 256; ++i) array[array.length] = "%" + ((i < 16 ? "0" : "") + i.toString(16)).toUpperCase();
		return array;
	}();
	var compactQueue = function compactQueue(queue) {
		while (queue.length > 1) {
			var item = queue.pop();
			var obj = item.obj[item.prop];
			if (isArray(obj)) {
				var compacted = [];
				for (var j = 0; j < obj.length; ++j) if (typeof obj[j] !== "undefined") compacted[compacted.length] = obj[j];
				item.obj[item.prop] = compacted;
			}
		}
	};
	var arrayToObject = function arrayToObject(source, options) {
		var obj = options && options.plainObjects ? { __proto__: null } : {};
		for (var i = 0; i < source.length; ++i) if (typeof source[i] !== "undefined") obj[i] = source[i];
		return obj;
	};
	var setProperty = function setProperty(obj, key, value) {
		if (key === "__proto__" && defineProperty) defineProperty(obj, key, {
			configurable: true,
			enumerable: true,
			value,
			writable: true
		});
		else obj[key] = value;
	};
	var merge = function merge(target, source, options) {
		if (!source) return target;
		if (typeof source !== "object" && typeof source !== "function") {
			if (isArray(target)) {
				var nextIndex = target.length;
				if (options && typeof options.arrayLimit === "number" && nextIndex >= options.arrayLimit) {
					if (options.throwOnLimitExceeded) throw new RangeError("Array limit exceeded. Only " + options.arrayLimit + " element" + (options.arrayLimit === 1 ? "" : "s") + " allowed in an array.");
					return markOverflow(arrayToObject(target.concat(source), options), nextIndex);
				}
				target[nextIndex] = source;
			} else if (target && typeof target === "object") {
				if (isOverflow(target)) {
					var newIndex = getMaxIndex(target) + 1;
					target[newIndex] = source;
					setMaxIndex(target, newIndex);
				} else if (options && options.strictMerge) return [target, source];
				else if (options && (options.plainObjects || options.allowPrototypes) || !has.call(Object.prototype, source)) target[source] = true;
			} else return [target, source];
			return target;
		}
		if (!target || typeof target !== "object") {
			if (isOverflow(source)) {
				var sourceKeys = Object.keys(source);
				var result = options && options.plainObjects ? {
					__proto__: null,
					0: target
				} : { 0: target };
				for (var m = 0; m < sourceKeys.length; m++) {
					var oldKey = parseInt(sourceKeys[m], 10);
					result[oldKey + 1] = source[sourceKeys[m]];
				}
				return markOverflow(result, getMaxIndex(source) + 1);
			}
			var combined = [target].concat(source);
			if (options && typeof options.arrayLimit === "number" && combined.length > options.arrayLimit) {
				if (options.throwOnLimitExceeded) throw new RangeError("Array limit exceeded. Only " + options.arrayLimit + " element" + (options.arrayLimit === 1 ? "" : "s") + " allowed in an array.");
				return markOverflow(arrayToObject(combined, options), combined.length - 1);
			}
			return combined;
		}
		var mergeTarget = target;
		if (isArray(target) && !isArray(source)) mergeTarget = arrayToObject(target, options);
		if (isArray(target) && isArray(source)) {
			source.forEach(function(item, i) {
				if (has.call(target, i)) {
					var targetItem = target[i];
					if (targetItem && typeof targetItem === "object" && item && typeof item === "object") target[i] = merge(targetItem, item, options);
					else target[target.length] = item;
				} else target[i] = item;
			});
			if (options && typeof options.arrayLimit === "number" && target.length > options.arrayLimit) {
				if (options.throwOnLimitExceeded) throw new RangeError("Array limit exceeded. Only " + options.arrayLimit + " element" + (options.arrayLimit === 1 ? "" : "s") + " allowed in an array.");
				return markOverflow(arrayToObject(target, options), target.length - 1);
			}
			return target;
		}
		return Object.keys(source).reduce(function(acc, key) {
			var value = source[key];
			if (has.call(acc, key)) setProperty(acc, key, merge(acc[key], value, options));
			else setProperty(acc, key, value);
			if (isOverflow(source) && !isOverflow(acc)) markOverflow(acc, getMaxIndex(source));
			if (isOverflow(acc)) {
				var keyNum = parseInt(key, 10);
				if (String(keyNum) === key && keyNum >= 0 && keyNum > getMaxIndex(acc)) setMaxIndex(acc, keyNum);
			}
			return acc;
		}, mergeTarget);
	};
	var assign = function assignSingleSource(target, source) {
		return Object.keys(source).reduce(function(acc, key) {
			setProperty(acc, key, source[key]);
			return acc;
		}, target);
	};
	var decode = function(str, defaultDecoder, charset) {
		var strWithoutPlus = str.replace(/\+/g, " ");
		if (charset === "iso-8859-1") return strWithoutPlus.replace(/%[0-9a-f]{2}/gi, unescape);
		try {
			return decodeURIComponent(strWithoutPlus);
		} catch (e) {
			return strWithoutPlus;
		}
	};
	var limit = 1024;
	module.exports = {
		arrayToObject,
		assign,
		combine: function combine(a, b, arrayLimit, plainObjects, throwOnLimitExceeded) {
			if (isOverflow(a)) {
				if (throwOnLimitExceeded) throw new RangeError("Array limit exceeded. Only " + arrayLimit + " element" + (arrayLimit === 1 ? "" : "s") + " allowed in an array.");
				var bValues = isArray(b) ? b : [b];
				var newIndex = getMaxIndex(a);
				for (var i = 0; i < bValues.length; ++i) {
					newIndex += 1;
					a[newIndex] = bValues[i];
				}
				setMaxIndex(a, newIndex);
				return a;
			}
			var result = [].concat(a, b);
			if (result.length > arrayLimit) {
				if (throwOnLimitExceeded) throw new RangeError("Array limit exceeded. Only " + arrayLimit + " element" + (arrayLimit === 1 ? "" : "s") + " allowed in an array.");
				return markOverflow(arrayToObject(result, { plainObjects }), result.length - 1);
			}
			return result;
		},
		compact: function compact(value) {
			var queue = [{
				obj: { o: value },
				prop: "o"
			}];
			var refs = getSideChannel();
			for (var i = 0; i < queue.length; ++i) {
				var item = queue[i];
				var obj = item.obj[item.prop];
				var keys = Object.keys(obj);
				for (var j = 0; j < keys.length; ++j) {
					var key = keys[j];
					var val = obj[key];
					if (typeof val === "object" && val !== null && !refs.has(val)) {
						queue[queue.length] = {
							obj,
							prop: key
						};
						refs.set(val, true);
					}
				}
			}
			compactQueue(queue);
			return value;
		},
		decode,
		encode: function encode(str, defaultEncoder, charset, kind, format) {
			if (str.length === 0) return str;
			var string = str;
			if (typeof str === "symbol") string = Symbol.prototype.toString.call(str);
			else if (typeof str !== "string") string = String(str);
			if (charset === "iso-8859-1") return escape(string).replace(/%u[0-9a-f]{4}/gi, function($0) {
				return "%26%23" + parseInt($0.slice(2), 16) + "%3B";
			});
			var out = "";
			for (var j = 0; j < string.length; j += limit) {
				var segment = string.length >= limit ? string.slice(j, j + limit) : string;
				if (j + limit < string.length) {
					var last = segment.charCodeAt(segment.length - 1);
					if (last >= 55296 && last <= 56319) {
						segment = segment.slice(0, -1);
						j -= 1;
					}
				}
				var arr = [];
				for (var i = 0; i < segment.length; ++i) {
					var c = segment.charCodeAt(i);
					if (c === 45 || c === 46 || c === 95 || c === 126 || c >= 48 && c <= 57 || c >= 65 && c <= 90 || c >= 97 && c <= 122 || format === formats.RFC1738 && (c === 40 || c === 41)) {
						arr[arr.length] = segment.charAt(i);
						continue;
					}
					if (c < 128) {
						arr[arr.length] = hexTable[c];
						continue;
					}
					if (c < 2048) {
						arr[arr.length] = hexTable[192 | c >> 6] + hexTable[128 | c & 63];
						continue;
					}
					if (c < 55296 || c >= 57344) {
						arr[arr.length] = hexTable[224 | c >> 12] + hexTable[128 | c >> 6 & 63] + hexTable[128 | c & 63];
						continue;
					}
					i += 1;
					c = 65536 + ((c & 1023) << 10 | segment.charCodeAt(i) & 1023);
					arr[arr.length] = hexTable[240 | c >> 18] + hexTable[128 | c >> 12 & 63] + hexTable[128 | c >> 6 & 63] + hexTable[128 | c & 63];
				}
				out += arr.join("");
			}
			return out;
		},
		isBuffer: function isBuffer(obj) {
			if (!obj || typeof obj !== "object") return false;
			return !!(obj.constructor && typeof obj.constructor.isBuffer === "function" && obj.constructor.isBuffer(obj));
		},
		isOverflow,
		isRegExp: function isRegExp(obj) {
			return Object.prototype.toString.call(obj) === "[object RegExp]";
		},
		markOverflow,
		maybeMap: function maybeMap(val, fn) {
			if (isArray(val)) {
				var mapped = [];
				for (var i = 0; i < val.length; i += 1) mapped[mapped.length] = fn(val[i]);
				return mapped;
			}
			return fn(val);
		},
		merge
	};
}));
//#endregion
//#region ../../node_modules/.pnpm/qs@6.16.0/node_modules/qs/lib/stringify.js
var require_stringify = /* @__PURE__ */ __commonJSMin(((exports, module) => {
	var getSideChannel = require_side_channel();
	var utils = require_utils();
	var formats = require_formats();
	var has = Object.prototype.hasOwnProperty;
	var arrayPrefixGenerators = {
		brackets: function brackets(prefix) {
			return prefix + "[]";
		},
		comma: "comma",
		indices: function indices(prefix, key) {
			return prefix + "[" + key + "]";
		},
		repeat: function repeat(prefix) {
			return prefix;
		}
	};
	var isArray = Array.isArray;
	var push = Array.prototype.push;
	var pushToArray = function(arr, valueOrArray) {
		push.apply(arr, isArray(valueOrArray) ? valueOrArray : [valueOrArray]);
	};
	var toISO = Date.prototype.toISOString;
	var defaultFormat = formats["default"];
	var defaults = {
		addQueryPrefix: false,
		allowDots: false,
		allowEmptyArrays: false,
		arrayFormat: "indices",
		charset: "utf-8",
		charsetSentinel: false,
		commaRoundTrip: false,
		delimiter: "&",
		depth: Infinity,
		encode: true,
		encodeDotInKeys: false,
		encoder: utils.encode,
		encodeValuesOnly: false,
		filter: void 0,
		format: defaultFormat,
		formatter: formats.formatters[defaultFormat],
		indices: false,
		serializeDate: function serializeDate(date) {
			return toISO.call(date);
		},
		skipNulls: false,
		strictNullHandling: false
	};
	var isNonNullishPrimitive = function isNonNullishPrimitive(v) {
		return typeof v === "string" || typeof v === "number" || typeof v === "boolean" || typeof v === "symbol" || typeof v === "bigint";
	};
	var sentinel = {};
	var stringify = function stringify(object, prefix, generateArrayPrefix, commaRoundTrip, allowEmptyArrays, strictNullHandling, skipNulls, encodeDotInKeys, encoder, filter, sort, allowDots, serializeDate, format, formatter, encodeValuesOnly, charset, sideChannel, depth, currentDepth) {
		var obj = object;
		if (currentDepth > depth) throw new RangeError("Input depth exceeded depth option of " + depth);
		var tmpSc = sideChannel;
		var step = 0;
		var findFlag = false;
		while ((tmpSc = tmpSc.get(sentinel)) !== void 0 && !findFlag) {
			var pos = tmpSc.get(object);
			step += 1;
			if (typeof pos !== "undefined") {
				if (pos === step) throw new RangeError("Cyclic object value");
				else findFlag = true;
			}
			if (typeof tmpSc.get(sentinel) === "undefined") step = 0;
		}
		obj = typeof filter === "function" ? filter(prefix, obj) : obj;
		if (obj instanceof Date) obj = serializeDate(obj);
		else if (generateArrayPrefix === "comma" && isArray(obj)) obj = utils.maybeMap(obj, function(value) {
			if (value instanceof Date) return serializeDate(value);
			return value;
		});
		if (obj === null) {
			if (strictNullHandling) return formatter(encoder && !encodeValuesOnly ? encoder(prefix, defaults.encoder, charset, "key", format) : prefix);
			obj = "";
		}
		if (isNonNullishPrimitive(obj) || utils.isBuffer(obj)) {
			if (encoder) return [formatter(encodeValuesOnly ? prefix : encoder(prefix, defaults.encoder, charset, "key", format)) + "=" + formatter(encoder(obj, defaults.encoder, charset, "value", format))];
			return [formatter(prefix) + "=" + formatter(String(obj))];
		}
		var values = [];
		if (typeof obj === "undefined") return values;
		var objKeys;
		if (generateArrayPrefix === "comma" && isArray(obj)) {
			if (encodeValuesOnly && encoder) obj = utils.maybeMap(obj, function(v) {
				return v == null ? v : encoder(v);
			});
			objKeys = [{ value: obj.length > 0 ? obj.join(",") || null : void 0 }];
		} else if (isArray(filter)) objKeys = filter;
		else {
			var keys = Object.keys(obj);
			objKeys = sort ? keys.sort(sort) : keys;
		}
		var encodedPrefix = encodeDotInKeys ? String(prefix).replace(/\./g, "%2E") : String(prefix);
		var adjustedPrefix = commaRoundTrip && isArray(obj) && obj.length === 1 ? encodedPrefix + "[]" : encodedPrefix;
		if (allowEmptyArrays && isArray(obj) && obj.length === 0 && Object.keys(obj).length === 0) return adjustedPrefix + "[]";
		for (var j = 0; j < objKeys.length; ++j) {
			var key = objKeys[j];
			var value = typeof key === "object" && key && typeof key.value !== "undefined" ? key.value : obj[key];
			if (skipNulls && value === null) continue;
			var encodedKey = allowDots && encodeDotInKeys ? String(key).replace(/\./g, "%2E") : String(key);
			var keyPrefix = isArray(obj) ? typeof generateArrayPrefix === "function" ? generateArrayPrefix(adjustedPrefix, encodedKey) : adjustedPrefix : adjustedPrefix + (allowDots ? "." + encodedKey : "[" + encodedKey + "]");
			sideChannel.set(object, step);
			var valueSideChannel = getSideChannel();
			valueSideChannel.set(sentinel, sideChannel);
			pushToArray(values, stringify(value, keyPrefix, generateArrayPrefix, commaRoundTrip, allowEmptyArrays, strictNullHandling, skipNulls, encodeDotInKeys, generateArrayPrefix === "comma" && encodeValuesOnly && isArray(obj) ? null : encoder, filter, sort, allowDots, serializeDate, format, formatter, encodeValuesOnly, charset, valueSideChannel, depth, currentDepth + 1));
		}
		return values;
	};
	var normalizeStringifyOptions = function normalizeStringifyOptions(opts) {
		if (!opts) return defaults;
		if (typeof opts.allowEmptyArrays !== "undefined" && typeof opts.allowEmptyArrays !== "boolean") throw new TypeError("`allowEmptyArrays` option can only be `true` or `false`, when provided");
		if (typeof opts.encodeDotInKeys !== "undefined" && typeof opts.encodeDotInKeys !== "boolean") throw new TypeError("`encodeDotInKeys` option can only be `true` or `false`, when provided");
		if (opts.encoder !== null && typeof opts.encoder !== "undefined" && typeof opts.encoder !== "function") throw new TypeError("Encoder has to be a function.");
		var charset = opts.charset || defaults.charset;
		if (typeof opts.charset !== "undefined" && opts.charset !== "utf-8" && opts.charset !== "iso-8859-1") throw new TypeError("The charset option must be either utf-8, iso-8859-1, or undefined");
		var format = formats["default"];
		if (typeof opts.format !== "undefined") {
			if (!has.call(formats.formatters, opts.format)) throw new TypeError("Unknown format option provided.");
			format = opts.format;
		}
		var formatter = formats.formatters[format];
		var filter = defaults.filter;
		if (typeof opts.filter === "function" || isArray(opts.filter)) filter = opts.filter;
		var arrayFormat;
		if (opts.arrayFormat in arrayPrefixGenerators) arrayFormat = opts.arrayFormat;
		else if ("indices" in opts) arrayFormat = opts.indices ? "indices" : "repeat";
		else arrayFormat = defaults.arrayFormat;
		if ("commaRoundTrip" in opts && typeof opts.commaRoundTrip !== "boolean") throw new TypeError("`commaRoundTrip` must be a boolean, or absent");
		var allowDots = typeof opts.allowDots === "undefined" ? opts.encodeDotInKeys === true ? true : defaults.allowDots : !!opts.allowDots;
		return {
			addQueryPrefix: typeof opts.addQueryPrefix === "boolean" ? opts.addQueryPrefix : defaults.addQueryPrefix,
			allowDots,
			allowEmptyArrays: typeof opts.allowEmptyArrays === "boolean" ? !!opts.allowEmptyArrays : defaults.allowEmptyArrays,
			arrayFormat,
			charset,
			charsetSentinel: typeof opts.charsetSentinel === "boolean" ? opts.charsetSentinel : defaults.charsetSentinel,
			commaRoundTrip: !!opts.commaRoundTrip,
			delimiter: typeof opts.delimiter === "undefined" ? defaults.delimiter : opts.delimiter,
			depth: typeof opts.depth === "number" ? opts.depth : defaults.depth,
			encode: typeof opts.encode === "boolean" ? opts.encode : defaults.encode,
			encodeDotInKeys: typeof opts.encodeDotInKeys === "boolean" ? opts.encodeDotInKeys : defaults.encodeDotInKeys,
			encoder: typeof opts.encoder === "function" ? opts.encoder : defaults.encoder,
			encodeValuesOnly: typeof opts.encodeValuesOnly === "boolean" ? opts.encodeValuesOnly : defaults.encodeValuesOnly,
			filter,
			format,
			formatter,
			serializeDate: typeof opts.serializeDate === "function" ? opts.serializeDate : defaults.serializeDate,
			skipNulls: typeof opts.skipNulls === "boolean" ? opts.skipNulls : defaults.skipNulls,
			sort: typeof opts.sort === "function" ? opts.sort : null,
			strictNullHandling: typeof opts.strictNullHandling === "boolean" ? opts.strictNullHandling : defaults.strictNullHandling
		};
	};
	module.exports = function(object, opts) {
		var obj = object;
		var options = normalizeStringifyOptions(opts);
		var objKeys;
		var filter;
		if (typeof options.filter === "function") {
			filter = options.filter;
			obj = filter("", obj);
		} else if (isArray(options.filter)) {
			filter = options.filter;
			objKeys = filter;
		}
		var keys = [];
		if (typeof obj !== "object" || obj === null) return "";
		var generateArrayPrefix = arrayPrefixGenerators[options.arrayFormat];
		var commaRoundTrip = generateArrayPrefix === "comma" && options.commaRoundTrip;
		if (!objKeys) objKeys = Object.keys(obj);
		if (options.sort) objKeys.sort(options.sort);
		var sideChannel = getSideChannel();
		for (var i = 0; i < objKeys.length; ++i) {
			var key = objKeys[i];
			if (typeof key === "undefined" || key === null) continue;
			var value = obj[key];
			if (options.skipNulls && value === null) continue;
			pushToArray(keys, stringify(value, options.encodeDotInKeys ? String(key).replace(/\./g, "%2E") : String(key), generateArrayPrefix, commaRoundTrip, options.allowEmptyArrays, options.strictNullHandling, options.skipNulls, options.encodeDotInKeys, options.encode ? options.encoder : null, options.filter, options.sort, options.allowDots, options.serializeDate, options.format, options.formatter, options.encodeValuesOnly, options.charset, sideChannel, options.depth, 0));
		}
		var joined = keys.join(options.delimiter);
		var prefix = options.addQueryPrefix === true ? "?" : "";
		if (options.charsetSentinel) {
			if (options.charset === "iso-8859-1") prefix += "utf8=%26%2310003%3B" + options.delimiter;
			else prefix += "utf8=%E2%9C%93" + options.delimiter;
		}
		return joined.length > 0 ? prefix + joined : "";
	};
}));
//#endregion
//#region ../../node_modules/.pnpm/qs@6.16.0/node_modules/qs/lib/parse.js
var require_parse = /* @__PURE__ */ __commonJSMin(((exports, module) => {
	var utils = require_utils();
	var has = Object.prototype.hasOwnProperty;
	var isArray = Array.isArray;
	var defaults = {
		allowDots: false,
		allowEmptyArrays: false,
		allowPrototypes: false,
		allowSparse: false,
		arrayLimit: 20,
		charset: "utf-8",
		charsetSentinel: false,
		comma: false,
		decodeDotInKeys: false,
		decoder: utils.decode,
		delimiter: "&",
		depth: 5,
		duplicates: "combine",
		ignoreQueryPrefix: false,
		interpretNumericEntities: false,
		parameterLimit: 1e3,
		parseArrays: true,
		plainObjects: false,
		strictDepth: false,
		strictMerge: true,
		strictNullHandling: false,
		throwOnLimitExceeded: false
	};
	var interpretNumericEntities = function(str) {
		return str.replace(/&#(\d+);/g, function($0, numberStr) {
			return String.fromCharCode(parseInt(numberStr, 10));
		});
	};
	var parseArrayValue = function(val, options, currentArrayLength) {
		if (val && typeof val === "string" && options.comma && val.indexOf(",") > -1) {
			if (options.throwOnLimitExceeded) {
				var commaCount = 0;
				var commaIndex = val.indexOf(",");
				while (commaIndex > -1) {
					commaCount += 1;
					if (commaCount >= options.arrayLimit) throw new RangeError("Array limit exceeded. Only " + options.arrayLimit + " element" + (options.arrayLimit === 1 ? "" : "s") + " allowed in an array.");
					commaIndex = val.indexOf(",", commaIndex + 1);
				}
			}
			return val.split(",");
		}
		if (options.throwOnLimitExceeded && currentArrayLength >= options.arrayLimit) throw new RangeError("Array limit exceeded. Only " + options.arrayLimit + " element" + (options.arrayLimit === 1 ? "" : "s") + " allowed in an array.");
		return val;
	};
	var isoSentinel = "utf8=%26%2310003%3B";
	var charsetSentinel = "utf8=%E2%9C%93";
	var parseValues = function parseQueryStringValues(str, options) {
		var obj = { __proto__: null };
		var cleanStr = options.ignoreQueryPrefix ? str.replace(/^\?/, "") : str;
		cleanStr = cleanStr.replace(/%5B/gi, "[").replace(/%5D/gi, "]");
		var limit = options.parameterLimit === Infinity ? void 0 : options.parameterLimit;
		var parts = cleanStr.split(options.delimiter, options.throwOnLimitExceeded && typeof limit !== "undefined" ? limit + 1 : limit);
		if (options.throwOnLimitExceeded && typeof limit !== "undefined" && parts.length > limit) throw new RangeError("Parameter limit exceeded. Only " + limit + " parameter" + (limit === 1 ? "" : "s") + " allowed.");
		var skipIndex = -1;
		var i;
		var charset = options.charset;
		if (options.charsetSentinel) {
			for (i = 0; i < parts.length; ++i) if (parts[i].indexOf("utf8=") === 0) {
				if (parts[i] === charsetSentinel) charset = "utf-8";
				else if (parts[i] === isoSentinel) charset = "iso-8859-1";
				skipIndex = i;
				i = parts.length;
			}
		}
		for (i = 0; i < parts.length; ++i) {
			if (i === skipIndex) continue;
			var part = parts[i];
			var bracketEqualsPos = part.indexOf("]=");
			var pos = bracketEqualsPos === -1 ? part.indexOf("=") : bracketEqualsPos + 1;
			var key;
			var val;
			if (pos === -1) {
				key = options.decoder(part, defaults.decoder, charset, "key");
				val = options.strictNullHandling ? null : "";
			} else {
				key = options.decoder(part.slice(0, pos), defaults.decoder, charset, "key");
				if (key !== null) val = utils.maybeMap(parseArrayValue(part.slice(pos + 1), options, isArray(obj[key]) ? obj[key].length : 0), function(encodedVal) {
					return options.decoder(encodedVal, defaults.decoder, charset, "value");
				});
			}
			if (val && options.interpretNumericEntities && charset === "iso-8859-1") val = interpretNumericEntities(String(val));
			if (part.indexOf("[]=") > -1) val = isArray(val) ? [val] : val;
			if (options.comma && isArray(val) && val.length > options.arrayLimit) val = utils.combine([], val, options.arrayLimit, options.plainObjects, options.throwOnLimitExceeded);
			if (key !== null) {
				var existing = has.call(obj, key);
				if (existing && (options.duplicates === "combine" || part.indexOf("[]=") > -1)) obj[key] = utils.combine(obj[key], val, options.arrayLimit, options.plainObjects, options.throwOnLimitExceeded);
				else if (!existing || options.duplicates === "last") obj[key] = val;
			}
		}
		return obj;
	};
	var parseObject = function(chain, val, options, valuesParsed) {
		var currentArrayLength = 0;
		if (chain.length > 0 && chain[chain.length - 1] === "[]") {
			var parentKey = chain.slice(0, -1).join("");
			currentArrayLength = Array.isArray(val) && val[parentKey] ? val[parentKey].length : 0;
		}
		var leaf = valuesParsed ? val : parseArrayValue(val, options, currentArrayLength);
		for (var i = chain.length - 1; i >= 0; --i) {
			var obj;
			var root = chain[i];
			if (root === "[]" && options.parseArrays) {
				if (utils.isOverflow(leaf)) obj = leaf;
				else obj = options.allowEmptyArrays && (leaf === "" || options.strictNullHandling && leaf === null) ? [] : utils.combine([], leaf, options.arrayLimit, options.plainObjects, options.throwOnLimitExceeded);
			} else {
				obj = options.plainObjects ? { __proto__: null } : {};
				var cleanRoot = root.charAt(0) === "[" && root.charAt(root.length - 1) === "]" ? root.slice(1, -1) : root;
				var decodedRoot = options.decodeDotInKeys ? cleanRoot.replace(/%2E/g, ".") : cleanRoot;
				var index = parseInt(decodedRoot, 10);
				var isValidArrayIndex = !isNaN(index) && root !== decodedRoot && String(index) === decodedRoot && index >= 0 && options.parseArrays;
				if (!options.parseArrays && decodedRoot === "") obj = { 0: leaf };
				else if (isValidArrayIndex && index < options.arrayLimit) {
					obj = [];
					obj[index] = leaf;
				} else if (isValidArrayIndex && options.throwOnLimitExceeded) throw new RangeError("Array limit exceeded. Only " + options.arrayLimit + " element" + (options.arrayLimit === 1 ? "" : "s") + " allowed in an array.");
				else if (isValidArrayIndex) {
					obj[index] = leaf;
					utils.markOverflow(obj, index);
				} else if (decodedRoot !== "__proto__") obj[decodedRoot] = leaf;
			}
			leaf = obj;
		}
		return leaf;
	};
	var splitKeyIntoSegments = function splitKeyIntoSegments(originalKey, options) {
		var key = options.allowDots ? originalKey.replace(/\.([^.[]+)/g, "[$1]") : originalKey;
		if (options.depth <= 0) {
			if (!options.plainObjects && has.call(Object.prototype, key)) {
				if (!options.allowPrototypes) return;
			}
			return [key];
		}
		var segments = [];
		var first = key.indexOf("[");
		var parent = first >= 0 ? key.slice(0, first) : key;
		if (parent) {
			if (!options.plainObjects && has.call(Object.prototype, parent)) {
				if (!options.allowPrototypes) return;
			}
			segments[segments.length] = parent;
		}
		var n = key.length;
		var open = first;
		var collected = 0;
		while (open >= 0 && collected < options.depth) {
			var level = 1;
			var i = open + 1;
			var close = -1;
			while (i < n && close < 0) {
				var cu = key.charCodeAt(i);
				if (cu === 91) level += 1;
				else if (cu === 93) {
					level -= 1;
					if (level === 0) close = i;
				}
				i += 1;
			}
			if (close < 0) {
				segments[segments.length] = "[" + key.slice(open) + "]";
				return segments;
			}
			var seg = key.slice(open, close + 1);
			var content = seg.slice(1, -1);
			if (!options.plainObjects && has.call(Object.prototype, content) && !options.allowPrototypes) return;
			segments[segments.length] = seg;
			collected += 1;
			open = key.indexOf("[", close + 1);
		}
		if (open >= 0) {
			if (options.strictDepth === true) throw new RangeError("Input depth exceeded depth option of " + options.depth + " and strictDepth is true");
			segments[segments.length] = "[" + key.slice(open) + "]";
		}
		return segments;
	};
	var parseKeys = function parseQueryStringKeys(givenKey, val, options, valuesParsed) {
		if (!givenKey) return;
		var keys = splitKeyIntoSegments(givenKey, options);
		if (!keys) return;
		return parseObject(keys, val, options, valuesParsed);
	};
	var normalizeParseOptions = function normalizeParseOptions(opts) {
		if (!opts) return defaults;
		if (typeof opts.allowEmptyArrays !== "undefined" && typeof opts.allowEmptyArrays !== "boolean") throw new TypeError("`allowEmptyArrays` option can only be `true` or `false`, when provided");
		if (typeof opts.decodeDotInKeys !== "undefined" && typeof opts.decodeDotInKeys !== "boolean") throw new TypeError("`decodeDotInKeys` option can only be `true` or `false`, when provided");
		if (opts.decoder !== null && typeof opts.decoder !== "undefined" && typeof opts.decoder !== "function") throw new TypeError("Decoder has to be a function.");
		if (typeof opts.charset !== "undefined" && opts.charset !== "utf-8" && opts.charset !== "iso-8859-1") throw new TypeError("The charset option must be either utf-8, iso-8859-1, or undefined");
		if (typeof opts.throwOnLimitExceeded !== "undefined" && typeof opts.throwOnLimitExceeded !== "boolean") throw new TypeError("`throwOnLimitExceeded` option must be a boolean");
		var charset = typeof opts.charset === "undefined" ? defaults.charset : opts.charset;
		var duplicates = typeof opts.duplicates === "undefined" ? defaults.duplicates : opts.duplicates;
		if (duplicates !== "combine" && duplicates !== "first" && duplicates !== "last") throw new TypeError("The duplicates option must be either combine, first, or last");
		return {
			allowDots: typeof opts.allowDots === "undefined" ? opts.decodeDotInKeys === true ? true : defaults.allowDots : !!opts.allowDots,
			allowEmptyArrays: typeof opts.allowEmptyArrays === "boolean" ? !!opts.allowEmptyArrays : defaults.allowEmptyArrays,
			allowPrototypes: typeof opts.allowPrototypes === "boolean" ? opts.allowPrototypes : defaults.allowPrototypes,
			allowSparse: typeof opts.allowSparse === "boolean" ? opts.allowSparse : defaults.allowSparse,
			arrayLimit: typeof opts.arrayLimit === "number" ? opts.arrayLimit : defaults.arrayLimit,
			charset,
			charsetSentinel: typeof opts.charsetSentinel === "boolean" ? opts.charsetSentinel : defaults.charsetSentinel,
			comma: typeof opts.comma === "boolean" ? opts.comma : defaults.comma,
			decodeDotInKeys: typeof opts.decodeDotInKeys === "boolean" ? opts.decodeDotInKeys : defaults.decodeDotInKeys,
			decoder: typeof opts.decoder === "function" ? opts.decoder : defaults.decoder,
			delimiter: typeof opts.delimiter === "string" || utils.isRegExp(opts.delimiter) ? opts.delimiter : defaults.delimiter,
			depth: typeof opts.depth === "number" || opts.depth === false ? +opts.depth : defaults.depth,
			duplicates,
			ignoreQueryPrefix: opts.ignoreQueryPrefix === true,
			interpretNumericEntities: typeof opts.interpretNumericEntities === "boolean" ? opts.interpretNumericEntities : defaults.interpretNumericEntities,
			parameterLimit: typeof opts.parameterLimit === "number" ? opts.parameterLimit : defaults.parameterLimit,
			parseArrays: opts.parseArrays !== false,
			plainObjects: typeof opts.plainObjects === "boolean" ? opts.plainObjects : defaults.plainObjects,
			strictDepth: typeof opts.strictDepth === "boolean" ? !!opts.strictDepth : defaults.strictDepth,
			strictMerge: typeof opts.strictMerge === "boolean" ? !!opts.strictMerge : defaults.strictMerge,
			strictNullHandling: typeof opts.strictNullHandling === "boolean" ? opts.strictNullHandling : defaults.strictNullHandling,
			throwOnLimitExceeded: typeof opts.throwOnLimitExceeded === "boolean" ? opts.throwOnLimitExceeded : false
		};
	};
	module.exports = function(str, opts) {
		var options = normalizeParseOptions(opts);
		if (str === "" || str === null || typeof str === "undefined") return options.plainObjects ? { __proto__: null } : {};
		var tempObj = typeof str === "string" ? parseValues(str, options) : str;
		var obj = options.plainObjects ? { __proto__: null } : {};
		var keys = Object.keys(tempObj);
		for (var i = 0; i < keys.length; ++i) {
			var key = keys[i];
			var newObj = parseKeys(key, tempObj[key], options, typeof str === "string");
			obj = utils.merge(obj, newObj, options);
		}
		if (options.allowSparse === true) return obj;
		return utils.compact(obj);
	};
}));
//#endregion
//#region ../../node_modules/.pnpm/qs@6.16.0/node_modules/qs/lib/index.js
var require_lib = /* @__PURE__ */ __commonJSMin(((exports, module) => {
	var stringify = require_stringify();
	var parse = require_parse();
	module.exports = {
		formats: require_formats(),
		parse,
		stringify
	};
}));
//#endregion
//#region ../../node_modules/.pnpm/url-template@2.0.8/node_modules/url-template/lib/url-template.js
var require_url_template = /* @__PURE__ */ __commonJSMin(((exports, module) => {
	(function(root, factory) {
		if (typeof exports === "object") module.exports = factory();
		else if (typeof define === "function" && define.amd) define([], factory);
		else root.urltemplate = factory();
	})(exports, function() {
		/**
		* @constructor
		*/
		function UrlTemplate() {}
		/**
		* @private
		* @param {string} str
		* @return {string}
		*/
		UrlTemplate.prototype.encodeReserved = function(str) {
			return str.split(/(%[0-9A-Fa-f]{2})/g).map(function(part) {
				if (!/%[0-9A-Fa-f]/.test(part)) part = encodeURI(part).replace(/%5B/g, "[").replace(/%5D/g, "]");
				return part;
			}).join("");
		};
		/**
		* @private
		* @param {string} str
		* @return {string}
		*/
		UrlTemplate.prototype.encodeUnreserved = function(str) {
			return encodeURIComponent(str).replace(/[!'()*]/g, function(c) {
				return "%" + c.charCodeAt(0).toString(16).toUpperCase();
			});
		};
		/**
		* @private
		* @param {string} operator
		* @param {string} value
		* @param {string} key
		* @return {string}
		*/
		UrlTemplate.prototype.encodeValue = function(operator, value, key) {
			value = operator === "+" || operator === "#" ? this.encodeReserved(value) : this.encodeUnreserved(value);
			if (key) return this.encodeUnreserved(key) + "=" + value;
			else return value;
		};
		/**
		* @private
		* @param {*} value
		* @return {boolean}
		*/
		UrlTemplate.prototype.isDefined = function(value) {
			return value !== void 0 && value !== null;
		};
		/**
		* @private
		* @param {string}
		* @return {boolean}
		*/
		UrlTemplate.prototype.isKeyOperator = function(operator) {
			return operator === ";" || operator === "&" || operator === "?";
		};
		/**
		* @private
		* @param {Object} context
		* @param {string} operator
		* @param {string} key
		* @param {string} modifier
		*/
		UrlTemplate.prototype.getValues = function(context, operator, key, modifier) {
			var value = context[key], result = [];
			if (this.isDefined(value) && value !== "") {
				if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
					value = value.toString();
					if (modifier && modifier !== "*") value = value.substring(0, parseInt(modifier, 10));
					result.push(this.encodeValue(operator, value, this.isKeyOperator(operator) ? key : null));
				} else if (modifier === "*") {
					if (Array.isArray(value)) value.filter(this.isDefined).forEach(function(value) {
						result.push(this.encodeValue(operator, value, this.isKeyOperator(operator) ? key : null));
					}, this);
					else Object.keys(value).forEach(function(k) {
						if (this.isDefined(value[k])) result.push(this.encodeValue(operator, value[k], k));
					}, this);
				} else {
					var tmp = [];
					if (Array.isArray(value)) value.filter(this.isDefined).forEach(function(value) {
						tmp.push(this.encodeValue(operator, value));
					}, this);
					else Object.keys(value).forEach(function(k) {
						if (this.isDefined(value[k])) {
							tmp.push(this.encodeUnreserved(k));
							tmp.push(this.encodeValue(operator, value[k].toString()));
						}
					}, this);
					if (this.isKeyOperator(operator)) result.push(this.encodeUnreserved(key) + "=" + tmp.join(","));
					else if (tmp.length !== 0) result.push(tmp.join(","));
				}
			} else if (operator === ";") {
				if (this.isDefined(value)) result.push(this.encodeUnreserved(key));
			} else if (value === "" && (operator === "&" || operator === "?")) result.push(this.encodeUnreserved(key) + "=");
			else if (value === "") result.push("");
			return result;
		};
		/**
		* @param {string} template
		* @return {function(Object):string}
		*/
		UrlTemplate.prototype.parse = function(template) {
			var that = this;
			var operators = [
				"+",
				"#",
				".",
				"/",
				";",
				"?",
				"&"
			];
			return { expand: function(context) {
				return template.replace(/\{([^\{\}]+)\}|([^\{\}]+)/g, function(_, expression, literal) {
					if (expression) {
						var operator = null, values = [];
						if (operators.indexOf(expression.charAt(0)) !== -1) {
							operator = expression.charAt(0);
							expression = expression.substr(1);
						}
						expression.split(/,/g).forEach(function(variable) {
							var tmp = /([^:\*]*)(?::(\d+)|(\*))?/.exec(variable);
							values.push.apply(values, that.getValues(context, operator, tmp[1], tmp[2] || tmp[3]));
						});
						if (operator && operator !== "+") {
							var separator = ",";
							if (operator === "?") separator = "&";
							else if (operator !== "#") separator = operator;
							return (values.length !== 0 ? operator : "") + values.join(separator);
						} else return values.join(",");
					} else return that.encodeReserved(literal);
				});
			} };
		};
		return new UrlTemplate();
	});
}));
//#endregion
//#region ../../node_modules/.pnpm/googleapis-common@9.1.0/node_modules/googleapis-common/build/src/isbrowser.js
var require_isbrowser = /* @__PURE__ */ __commonJSMin(((exports) => {
	Object.defineProperty(exports, "__esModule", { value: true });
	exports.isBrowser = isBrowser;
	function isBrowser() {
		return typeof window !== "undefined";
	}
}));
//#endregion
//#region ../../node_modules/.pnpm/googleapis-common@9.1.0/node_modules/googleapis-common/build/src/util.js
var require_util = /* @__PURE__ */ __commonJSMin(((exports) => {
	Object.defineProperty(exports, "__esModule", { value: true });
	exports.headersToClassicHeaders = headersToClassicHeaders;
	exports.marshallGaxiosResponse = marshallGaxiosResponse;
	/**
	* A utility for converting potential {@link Headers `Headers`} objects to plain headers objects.
	*
	* @param headers any compatible `HeadersInit` (`Headers`, (string, string)[], {})
	* @returns the headers in `Record<string, string>` form.
	*/
	function headersToClassicHeaders(headers) {
		let classicHeaders = {};
		if (headers instanceof Headers) headers.forEach((value, key) => {
			classicHeaders[key] = value;
		});
		else if (Array.isArray(headers)) for (const [key, value] of headers) classicHeaders[key] = value;
		else classicHeaders = headers || {};
		return classicHeaders;
	}
	/**
	* marshall a GaxiosResponse into a library-friendly type.
	*
	* @param res the Gaxios Response
	* @returns the GaxiosResponse with HTTP2-ready/compatible headers
	*/
	function marshallGaxiosResponse(res) {
		return Object.defineProperties(res || {}, { headers: {
			configurable: true,
			writable: true,
			enumerable: true,
			value: headersToClassicHeaders(res?.headers)
		} });
	}
}));
//#endregion
//#region ../../node_modules/.pnpm/googleapis-common@9.1.0/node_modules/googleapis-common/build/src/http2.js
var require_http2 = /* @__PURE__ */ __commonJSMin(((exports) => {
	Object.defineProperty(exports, "__esModule", { value: true });
	exports.sessions = void 0;
	exports.request = request;
	exports.closeSession = closeSession;
	const http2 = __require("http2");
	const zlib = __require("zlib");
	const url_1 = __require("url");
	const qs = require_lib();
	const extend = require_extend();
	const stream_1 = __require("stream");
	const util$1 = __require("util");
	const process$1 = __require("process");
	const util_1 = require_util();
	const { HTTP2_HEADER_CONTENT_ENCODING, HTTP2_HEADER_CONTENT_TYPE, HTTP2_HEADER_METHOD, HTTP2_HEADER_PATH, HTTP2_HEADER_STATUS } = http2.constants;
	const DEBUG = !!process$1.env.HTTP2_DEBUG;
	/**
	* List of sessions current in use.
	* @private
	*/
	exports.sessions = {};
	/**
	* Public method to make an http2 request.
	* @param config - Request options.
	*/
	async function request(config) {
		const opts = extend(true, {}, config);
		opts.validateStatus = opts.validateStatus || validateStatus;
		opts.responseType = opts.responseType || "json";
		const url = new url_1.URL(opts.url);
		const sessionData = _getClient(url.host);
		if (sessionData.timeoutHandle !== void 0) clearTimeout(sessionData.timeoutHandle);
		let pathWithQs = url.pathname;
		if (config.params && Object.keys(config.params).length > 0) {
			const q = (config.paramsSerializer || qs.stringify)(opts.params);
			pathWithQs += `?${q}`;
		}
		const headers = (0, util_1.headersToClassicHeaders)(opts.headers);
		headers[HTTP2_HEADER_PATH] = pathWithQs;
		headers[HTTP2_HEADER_METHOD] = config.method || "GET";
		opts.headers = headers;
		if (!headers[HTTP2_HEADER_CONTENT_TYPE]) {
			if (opts.responseType !== "text") headers[HTTP2_HEADER_CONTENT_TYPE] = "application/json";
		}
		const res = {
			config,
			headers: {},
			status: 0,
			data: {},
			statusText: ""
		};
		const chunks = [];
		const session = sessionData.session;
		let req;
		return new Promise((resolve, reject) => {
			try {
				req = session.request(headers).on("response", (responseHeaders) => {
					Object.assign(res, {
						headers: responseHeaders,
						status: responseHeaders[HTTP2_HEADER_STATUS]
					});
					let stream = req;
					if (responseHeaders[HTTP2_HEADER_CONTENT_ENCODING] === "gzip") stream = req.pipe(zlib.createGunzip());
					if (opts.responseType === "stream") {
						res.data = stream;
						resolve(res);
						return;
					}
					stream.on("data", (d) => {
						chunks.push(d);
					}).on("error", (err) => {
						reject(err);
					}).on("end", () => {
						const buf = Buffer.concat(chunks);
						let data = buf;
						if (buf) {
							if (opts.responseType === "json") try {
								data = JSON.parse(buf.toString("utf8"));
							} catch {
								data = buf.toString("utf8");
							}
							else if (opts.responseType === "text") data = buf.toString("utf8");
							else if (opts.responseType === "arraybuffer") data = buf.buffer;
							res.data = data;
						}
						if (!opts.validateStatus(res.status)) {
							let message = `Request failed with status code ${res.status}. `;
							if (res.data && typeof res.data === "object") {
								const body = util$1.inspect(res.data, { depth: 5 });
								message = `${message}\n'${body}`;
							}
							reject(new Error(message, { cause: res }));
						}
						resolve(res);
					});
				}).on("error", (e) => {
					reject(e);
				});
			} catch (e) {
				closeSession(url).then(() => reject(e)).catch(reject);
				return;
			}
			res.request = req;
			if (config.data) {
				if (config.data instanceof stream_1.Stream) config.data.pipe(req);
				else if (typeof config.data === "string") {
					const data = Buffer.from(config.data);
					req.end(data);
				} else if (typeof config.data === "object") {
					const data = JSON.stringify(config.data);
					req.end(data);
				}
			}
			sessionData.timeoutHandle = setTimeout(() => closeSession(url), 500);
		});
	}
	/**
	* By default, throw for any non-2xx status code
	* @param status - status code from the HTTP response
	*/
	function validateStatus(status) {
		return status >= 200 && status < 300;
	}
	/**
	* Obtain an existing h2 session or go create a new one.
	* @param host - The hostname to which the session belongs.
	*/
	function _getClient(host) {
		if (!exports.sessions[host]) {
			if (DEBUG) console.log(`Creating client for ${host}`);
			const session = http2.connect(`https://${host}`);
			session.on("error", (e) => {
				console.error(`*ERROR*: ${e}`);
				delete exports.sessions[host];
			}).on("goaway", (errorCode, lastStreamId) => {
				console.error(`*GOAWAY*: ${errorCode} : ${lastStreamId}`);
				delete exports.sessions[host];
			});
			exports.sessions[host] = { session };
		} else if (DEBUG) console.log(`Used cached client for ${host}`);
		return exports.sessions[host];
	}
	async function closeSession(url) {
		const sessionData = exports.sessions[url.host];
		if (!sessionData) return;
		const { session } = sessionData;
		delete exports.sessions[url.host];
		if (DEBUG) console.error(`Closing ${url.host}`);
		session.close(() => {
			if (DEBUG) console.error(`Closed ${url.host}`);
		});
		setTimeout(() => {
			if (session && !session.destroyed) {
				if (DEBUG) console.log(`Forcing close ${url.host}`);
				if (session) session.destroy();
			}
		}, 1e3);
	}
}));
//#endregion
//#region ../../node_modules/.pnpm/googleapis-common@9.1.0/node_modules/googleapis-common/build/src/transcoding.js
var require_transcoding = /* @__PURE__ */ __commonJSMin(((exports) => {
	Object.defineProperty(exports, "__esModule", { value: true });
	exports.validateAndEncodeParams = validateAndEncodeParams;
	/**
	* Validates a single path segment matched by a single wildcard (*) or {param}.
	* Checks that the segment is not exactly '.' or '..' (directory traversal indicators).
	*
	* @param propertyName Name of the parameter being validated
	* @param value Value of the path segment
	*/
	function validateUriPathSegment(propertyName, value) {
		if (value === "." || value === "..") throw new Error(`Invalid value ${value} for ${propertyName}`);
	}
	/**
	* Validates a multi-segment path matched by a double wildcard (**) or {+param}.
	* Splitting by slash, it checks that no individual segment is exactly '.' or '..'.
	* This segment-by-segment check prevents directory traversal while allowing
	* legitimate resource names containing dots (e.g., domain-scoped project IDs).
	*
	* @param propertyName Name of the parameter being validated
	* @param value Value of the multi-segment path
	*/
	function validateUriPath(propertyName, value) {
		if (value) {
			if (value.split("/").some((segment) => segment === "." || segment === "..")) throw new Error(`Value for ${propertyName} must not contain segments that are exactly . or ..`);
		}
	}
	/**
	* Percent-encodes a string according to RFC 3986, preserving only unreserved
	* characters (alpha-numeric, '-', '_', '.', and '~'). All other characters,
	* including slashes ('/'), are percent-encoded.
	*
	* This is necessary because encodeURIComponent natively encodes URL-unsafe
	* characters like ?, #, $, &, +, etc., but preserves !, ', (, ), and *.
	* To ensure strict compliance, we manually encode those preserved characters.
	*
	* @param str The input string to encode
	* @returns The percent-encoded string
	*/
	function encodeWithSlashes(str) {
		return encodeURIComponent(str).replace(/[!'()*]/g, (character) => "%" + character.charCodeAt(0).toString(16).toUpperCase());
	}
	/**
	* Percent-encodes a string according to RFC 3986, preserving unreserved
	* characters (alpha-numeric, '-', '_', '.', and '~') and slashes ('/'). All other
	* characters are percent-encoded.
	*
	* @param str The input string to encode
	* @returns The percent-encoded string with slashes preserved
	*/
	function encodeWithoutSlashes(str) {
		return str.split("/").map(encodeWithSlashes).join("/");
	}
	/**
	* Extracts template parameters and their corresponding wildcard types ('*' or '**').
	*
	* @example
	* ```ts
	* // Input:
	* 'https://example.com/v1/{+parent}/databases/{databaseId}/documents/{+documentPath}'
	*
	* // Output:
	* [
	*   { param: 'parent', wildcard: '**' },
	*   { param: 'databaseId', wildcard: '*' },
	*   { param: 'documentPath', wildcard: '**' }
	* ]
	* ```
	*
	* @param urlTemplate The RFC 6570 URI template string
	* @returns Array of parameter names and their associated wildcard pattern
	*/
	function extractTemplateParams(urlTemplate) {
		const paramMap = /* @__PURE__ */ new Map();
		const matches = urlTemplate.matchAll(/\{(\+?)([a-zA-Z0-9_$-]+)\}/g);
		for (const match of matches) {
			const wildcard = match[1] === "+" ? "**" : "*";
			const paramName = match[2];
			if (wildcard === "**" || !paramMap.has(paramName)) paramMap.set(paramName, wildcard);
		}
		return Array.from(paramMap.entries()).map(([param, wildcard]) => ({
			param,
			wildcard
		}));
	}
	/**
	* Validates path parameters against traversal attacks ('.' and '..') and encodes
	* multi-segment parameters in params so that reserved characters (query params, fragments, etc.)
	* cannot be injected into the path. Modifies params in-place.
	*
	* @param urlTemplate URL template associated with the request (e.g. url, mediaUrl)
	* @param params Request parameters dictionary (modified in-place)
	*/
	function validateAndEncodeParams(urlTemplate, params) {
		if (!params || typeof params !== "object" || !urlTemplate) return;
		const templateParams = extractTemplateParams(urlTemplate);
		for (const { param, wildcard } of templateParams) {
			const parameterValue = params[param];
			if (parameterValue === void 0 || parameterValue === null) continue;
			if (wildcard === "**") {
				const encodeParam = (val) => {
					validateUriPath(param, val);
					return encodeWithoutSlashes(val);
				};
				params[param] = Array.isArray(parameterValue) ? parameterValue.map((item) => encodeParam(String(item))) : encodeParam(String(parameterValue));
			} else if (Array.isArray(parameterValue)) parameterValue.forEach((item) => validateUriPathSegment(param, String(item)));
			else validateUriPathSegment(param, String(parameterValue));
		}
	}
}));
//#endregion
//#region ../../node_modules/.pnpm/googleapis-common@9.1.0/node_modules/googleapis-common/package.json
var require_package = /* @__PURE__ */ __commonJSMin(((exports, module) => {
	module.exports = {
		"name": "googleapis-common",
		"version": "9.1.0",
		"description": "A common tooling library used by the googleapis npm module. You probably don't want to use this directly.",
		"repository": {
			"type": "git",
			"directory": "core/packages/nodejs-googleapis-common",
			"url": "https://github.com/googleapis/google-cloud-node.git"
		},
		"main": "build/src/index.js",
		"types": "build/src/index.d.ts",
		"files": ["build/src", "!build/src/**/*.map"],
		"scripts": {
			"prebenchmark": "npm run compile",
			"benchmark": "node build/benchmark/bench.js",
			"compile": "tsc -p .",
			"test": "c8 mocha build/test",
			"system-test": "c8 mocha build/system-test --timeout 600000",
			"presystem-test": "npm run compile",
			"fix": "gts fix",
			"prepare": "npm run compile",
			"pretest": "npm run compile",
			"lint": "gts check",
			"samples-test": "mocha build/samples-test",
			"docs": "jsdoc -c .jsdoc.js",
			"webpack": "webpack",
			"browser-test": "karma start",
			"prelint": "cd samples; npm link ../; npm install",
			"clean": "gts clean",
			"precompile": "gts clean"
		},
		"keywords": [],
		"author": "Google LLC",
		"license": "Apache-2.0",
		"dependencies": {
			"extend": "^3.0.2",
			"gaxios": "^7.3.0",
			"google-auth-library": "^11.0.0",
			"google-logging-utils": "^2.0.0",
			"qs": "^6.7.0",
			"url-template": "^2.0.8"
		},
		"devDependencies": {
			"@googleapis/dialogflow": "^1.0.0",
			"@babel/plugin-proposal-private-methods": "^7.18.6",
			"@types/extend": "^3.0.1",
			"@types/mocha": "^10.0.10",
			"@types/mv": "^2.1.0",
			"@types/ncp": "^2.0.8",
			"@types/nock": "^11.0.0",
			"@types/proxyquire": "^1.3.31",
			"@types/qs": "^6.5.3",
			"@types/sinon": "^21.0.0",
			"@types/tmp": "^0.2.6",
			"@types/url-template": "^2.0.28",
			"c8": "^10.1.3",
			"codecov": "^3.8.3",
			"gts": "^6.0.2",
			"http2spy": "^2.0.0",
			"is-docker": "^3.0.0",
			"jsdoc": "^4.0.4",
			"jsdoc-fresh": "^6.0.0",
			"jsdoc-region-tag": "^5.0.0",
			"karma": "^6.0.0",
			"karma-chrome-launcher": "^3.0.0",
			"karma-coverage": "^2.0.0",
			"karma-firefox-launcher": "^2.0.0",
			"karma-mocha": "^2.0.0",
			"karma-remap-coverage": "^0.1.5",
			"karma-sourcemap-loader": "^0.4.0",
			"karma-webpack": "^5.0.0",
			"mocha": "^11.1.0",
			"mv": "^2.1.1",
			"ncp": "^2.0.0",
			"nock": "^14.0.5",
			"null-loader": "^4.0.1",
			"path-to-regexp": "^6.0.0",
			"proxyquire": "^2.1.3",
			"puppeteer": "^24.0.0",
			"sinon": "21.0.3",
			"tmp": "0.2.7",
			"ts-loader": "^9.5.2",
			"typescript": "5.8.3",
			"webpack": "^5.97.1",
			"webpack-cli": "^6.0.1"
		},
		"engines": { "node": ">=22" },
		"homepage": "https://github.com/googleapis/google-cloud-node/tree/main/core/packages/nodejs-googleapis-common"
	};
}));
//#endregion
//#region ../../node_modules/.pnpm/googleapis-common@9.1.0/node_modules/googleapis-common/build/src/apirequest.js
var require_apirequest = /* @__PURE__ */ __commonJSMin(((exports) => {
	Object.defineProperty(exports, "__esModule", { value: true });
	exports.createAPIRequest = createAPIRequest;
	const gaxios_1 = require_src$4();
	const qs = require_lib();
	const stream = __require("stream");
	const urlTemplate = require_url_template();
	const extend = require_extend();
	const isbrowser_1 = require_isbrowser();
	const h2 = require_http2();
	const util_1 = require_util();
	const transcoding_1 = require_transcoding();
	const pkg = require_package();
	const randomUUID = () => globalThis.crypto?.randomUUID() || __require("crypto").randomUUID();
	function isReadableStream(obj) {
		return obj !== null && typeof obj === "object" && typeof obj.pipe === "function" && obj.readable !== false && typeof obj._read === "function" && typeof obj._readableState === "object";
	}
	function getMissingParams(params, required) {
		const missing = new Array();
		required.forEach((param) => {
			if (params[param] === void 0) missing.push(param);
		});
		return missing.length > 0 ? missing : null;
	}
	function createAPIRequest(parameters, callback) {
		if (callback) createAPIRequestAsync(parameters).then((r) => callback(null, r), callback);
		else return createAPIRequestAsync(parameters);
	}
	async function createAPIRequestAsync(parameters) {
		const options = extend(true, {}, parameters.context.google?._options || {}, parameters.context._options || {}, parameters.options);
		const params = extend(true, {}, options.params, parameters.params);
		options.userAgentDirectives = options.userAgentDirectives || [];
		const media = params.media || {};
		/**
		* In a previous version of this API, the request body was stuffed in a field
		* named `resource`.  This caused lots of problems, because it's not uncommon
		* to have an actual named parameter required which is also named `resource`.
		* This meant that users would have to use `resource_` in those cases, which
		* pretty much nobody figures out on their own. The request body is now
		* documented as being in the `requestBody` property, but we also need to keep
		* using `resource` for reasons of back-compat. Cases that need to be covered
		* here:
		* - user provides just a `resource` with a request body
		* - user provides both a `resource` and a `resource_`
		* - user provides just a `requestBody`
		* - user provides both a `requestBody` and a `resource`
		*/
		let resource = params.requestBody;
		if (!params.requestBody && params.resource && (!parameters.requiredParams.includes("resource") || typeof params.resource !== "string")) {
			resource = params.resource;
			delete params.resource;
		}
		delete params.requestBody;
		let authClient = params.auth || options.auth;
		const defaultMime = typeof media.body === "string" ? "text/plain" : "application/octet-stream";
		delete params.media;
		delete params.auth;
		const headers = (0, util_1.headersToClassicHeaders)(params.headers || {});
		populateAPIHeader(headers, options.apiVersion);
		delete params.headers;
		Object.keys(params).forEach((key) => {
			if (key.slice(-1) === "_") {
				const newKey = key.slice(0, -1);
				params[newKey] = params[key];
				delete params[key];
			}
		});
		const missingParams = getMissingParams(params, parameters.requiredParams);
		if (missingParams) throw new Error("Missing required parameters: " + missingParams.join(", "));
		(0, transcoding_1.validateAndEncodeParams)(options.url?.toString() ?? parameters.mediaUrl ?? void 0, params);
		if (options.url) {
			let url = options.url;
			if (typeof url === "object") url = url.toString();
			options.url = urlTemplate.parse(url).expand(params);
		}
		if (parameters.mediaUrl) parameters.mediaUrl = urlTemplate.parse(parameters.mediaUrl).expand(params);
		if (parameters.context._options.rootUrl !== void 0 && options.url !== void 0) {
			const originalUrl = new URL(options.url);
			const path = originalUrl.href.substr(originalUrl.origin.length);
			options.url = new URL(path, parameters.context._options.rootUrl).href;
		}
		options.paramsSerializer = (params) => {
			return qs.stringify(params, { arrayFormat: "repeat" });
		};
		parameters.pathParams.forEach((param) => delete params[param]);
		if (typeof authClient === "string") {
			params.key = params.key || authClient;
			authClient = void 0;
		}
		function multipartUpload(multipart) {
			const boundary = randomUUID();
			const finale = `--${boundary}--`;
			const rStream = new stream.PassThrough({ flush(callback) {
				this.push("\r\n");
				this.push(finale);
				callback();
			} });
			const pStream = new ProgressStream();
			const isStream = isReadableStream(multipart[1].body);
			headers["content-type"] = `multipart/related; boundary=${boundary}`;
			for (const part of multipart) {
				const preamble = `--${boundary}\r\ncontent-type: ${part["content-type"]}\r\n\r\n`;
				rStream.push(preamble);
				if (typeof part.body === "string") {
					rStream.push(part.body);
					rStream.push("\r\n");
				} else {
					pStream.on("progress", (bytesRead) => {
						if (options.onUploadProgress) options.onUploadProgress({ bytesRead });
					});
					part.body.pipe(pStream).pipe(rStream);
				}
			}
			if (!isStream) {
				rStream.push(finale);
				rStream.push(null);
			}
			options.data = rStream;
		}
		function browserMultipartUpload(multipart) {
			const boundary = randomUUID();
			const finale = `--${boundary}--`;
			headers["content-type"] = `multipart/related; boundary=${boundary}`;
			let content = "";
			for (const part of multipart) {
				const preamble = `--${boundary}\r\ncontent-type: ${part["content-type"]}\r\n\r\n`;
				content += preamble;
				if (typeof part.body === "string") {
					content += part.body;
					content += "\r\n";
				}
			}
			content += finale;
			options.data = content;
		}
		if (parameters.mediaUrl && media.body) {
			options.url = parameters.mediaUrl;
			if (resource) {
				params.uploadType = "multipart";
				const multipart = [{
					"content-type": "application/json",
					body: JSON.stringify(resource)
				}, {
					"content-type": media.mimeType || resource && resource.mimeType || defaultMime,
					body: media.body
				}];
				if (!(0, isbrowser_1.isBrowser)()) multipartUpload(multipart);
				else browserMultipartUpload(multipart);
			} else {
				params.uploadType = "media";
				Object.assign(headers, { "content-type": media.mimeType || defaultMime });
				options.data = media.body;
			}
		} else options.data = resource || void 0;
		options.headers = gaxios_1.Gaxios.mergeHeaders(options.headers || {}, headers);
		options.params = params;
		if (!(0, isbrowser_1.isBrowser)()) {
			options.headers.set("Accept-Encoding", "gzip");
			options.userAgentDirectives.push({
				product: "google-api-nodejs-client",
				version: pkg.version,
				comment: "gzip"
			});
			const userAgent = options.userAgentDirectives.map((d) => {
				let line = `${d.product}/${d.version}`;
				if (d.comment) line += ` (${d.comment})`;
				return line;
			}).join(" ");
			options.headers.set("User-Agent", userAgent);
		}
		if (!options.validateStatus) options.validateStatus = (status) => {
			return status >= 200 && status < 300 || status === 304;
		};
		options.retry = options.retry === void 0 ? true : options.retry;
		delete options.auth;
		if (options.universeDomain && options.universe_domain && options.universeDomain !== options.universe_domain) throw new Error("Please set either universe_domain or universeDomain, but not both.");
		const universeDomainEnvVar = typeof process === "object" && typeof process.env === "object" ? process.env["GOOGLE_CLOUD_UNIVERSE_DOMAIN"] : void 0;
		const universeDomain = options.universeDomain ?? options.universe_domain ?? universeDomainEnvVar ?? "googleapis.com";
		if (universeDomain !== "googleapis.com" && options.url) {
			const url = new URL(options.url);
			if (url.hostname.endsWith(".googleapis.com")) {
				url.hostname = url.hostname.replace(/googleapis\.com$/, universeDomain);
				options.url = url.toString();
			}
		}
		if (!Object.keys(options.params).length) {
			delete options.params;
			delete options.paramsSerializer;
		}
		if (authClient && typeof authClient === "object") {
			const universeFromAuth = typeof authClient.getUniverseDomain === "function" ? await authClient.getUniverseDomain() : void 0;
			if (universeFromAuth && universeDomain !== universeFromAuth) throw new Error(`The configured universe domain (${universeDomain}) does not match the universe domain found in the credentials (${universeFromAuth}). If you haven't configured the universe domain explicitly, googleapis.com is the default.`);
			if (options.http2) {
				const authHeaders = await authClient.getRequestHeaders(options.url);
				const mooOpts = Object.assign({}, options);
				mooOpts.headers = gaxios_1.Gaxios.mergeHeaders(mooOpts.headers, authHeaders);
				return h2.request(mooOpts);
			} else {
				const res = await authClient.request(options);
				return (0, util_1.marshallGaxiosResponse)(res);
			}
		} else return new gaxios_1.Gaxios().request(options).then((res) => (0, util_1.marshallGaxiosResponse)(res));
	}
	/**
	* Basic Passthrough Stream that records the number of bytes read
	* every time the cursor is moved.
	*/
	var ProgressStream = class extends stream.Transform {
		bytesRead = 0;
		_transform(chunk, encoding, callback) {
			this.bytesRead += chunk.length;
			this.emit("progress", this.bytesRead);
			this.push(chunk);
			callback();
		}
	};
	function populateAPIHeader(headers, apiVersion) {
		if (!(0, isbrowser_1.isBrowser)()) headers["x-goog-api-client"] = `gdcl/${pkg.version} gl-node/${process.versions.node}`;
		if (apiVersion) headers["x-goog-api-version"] = apiVersion;
	}
}));
//#endregion
//#region ../../node_modules/.pnpm/googleapis-common@9.1.0/node_modules/googleapis-common/build/src/authplus.js
var require_authplus = /* @__PURE__ */ __commonJSMin(((exports) => {
	Object.defineProperty(exports, "__esModule", { value: true });
	exports.AuthPlus = void 0;
	const google_auth_library_1 = require_src$1();
	var AuthPlus = class extends google_auth_library_1.GoogleAuth {
		JWT = google_auth_library_1.JWT;
		Compute = google_auth_library_1.Compute;
		OAuth2 = google_auth_library_1.OAuth2Client;
		GoogleAuth = google_auth_library_1.GoogleAuth;
		AwsClient = google_auth_library_1.AwsClient;
		IdentityPoolClient = google_auth_library_1.IdentityPoolClient;
		ExternalAccountClient = google_auth_library_1.ExternalAccountClient;
		_cachedAuth;
		/**
		* Override getClient(), memoizing an instance of auth for
		* subsequent calls to getProjectId().
		*/
		async getClient(options) {
			this._cachedAuth = new google_auth_library_1.GoogleAuth(options);
			return this._cachedAuth.getClient();
		}
		getProjectId(callback) {
			if (callback) return this._cachedAuth ? this._cachedAuth.getProjectId(callback) : super.getProjectId(callback);
			else return this._cachedAuth ? this._cachedAuth.getProjectId() : super.getProjectId();
		}
	};
	exports.AuthPlus = AuthPlus;
}));
//#endregion
//#region ../../node_modules/.pnpm/googleapis-common@9.1.0/node_modules/googleapis-common/build/src/endpoint.js
var require_endpoint = /* @__PURE__ */ __commonJSMin(((exports) => {
	Object.defineProperty(exports, "__esModule", { value: true });
	exports.Endpoint = void 0;
	const apirequest_1 = require_apirequest();
	var Endpoint = class {
		_options;
		google;
		constructor(options) {
			this._options = options || {};
		}
		/**
		* Given a schema, add methods and resources to a target.
		*
		* @param {object} target The target to which to apply the schema.
		* @param {object} rootSchema The top-level schema, so we don't lose track of it
		* during recursion.
		* @param {object} schema The current schema from which to extract methods and
		* resources.
		* @param {object} context The context to add to each method.
		*/
		applySchema(target, rootSchema, schema, context) {
			this.applyMethodsFromSchema(target, rootSchema, schema, context);
			if (schema.resources) {
				for (const resourceName in schema.resources) if (Object.prototype.hasOwnProperty.call(schema.resources, resourceName)) {
					const resource = schema.resources[resourceName];
					if (!target[resourceName]) target[resourceName] = {};
					this.applySchema(target[resourceName], rootSchema, resource, context);
				}
			}
		}
		/**
		* Given a schema, add methods to a target.
		*
		* @param {object} target The target to which to apply the methods.
		* @param {object} rootSchema The top-level schema, so we don't lose track of it
		* during recursion.
		* @param {object} schema The current schema from which to extract methods.
		* @param {object} context The context to add to each method.
		*/
		applyMethodsFromSchema(target, rootSchema, schema, context) {
			if (schema.methods) {
				for (const name in schema.methods) if (Object.prototype.hasOwnProperty.call(schema.methods, name)) {
					const method = schema.methods[name];
					target[name] = this.makeMethod(rootSchema, method, context);
				}
			}
		}
		/**
		* Given a method schema, add a method to a target.
		*
		* @param target The target to which to add the method.
		* @param schema The top-level schema that contains the rootUrl, etc.
		* @param method The method schema from which to generate the method.
		* @param context The context to add to the method.
		*/
		makeMethod(schema, method, context) {
			return (paramsOrCallback, callback) => {
				const params = typeof paramsOrCallback === "function" ? {} : paramsOrCallback;
				callback = typeof paramsOrCallback === "function" ? paramsOrCallback : callback;
				const schemaUrl = buildurl(schema.rootUrl + schema.servicePath + method.path);
				const parameters = {
					options: {
						url: schemaUrl.substring(1, schemaUrl.length - 1),
						method: method.httpMethod,
						apiVersion: method.apiVersion
					},
					params,
					requiredParams: method.parameterOrder || [],
					pathParams: this.getPathParams(method.parameters),
					context
				};
				if (method.mediaUpload && method.mediaUpload.protocols && method.mediaUpload.protocols.simple && method.mediaUpload.protocols.simple.path) {
					const mediaUrl = buildurl(schema.rootUrl + method.mediaUpload.protocols.simple.path);
					parameters.mediaUrl = mediaUrl.substring(1, mediaUrl.length - 1);
				}
				if (!callback) return (0, apirequest_1.createAPIRequest)(parameters);
				(0, apirequest_1.createAPIRequest)(parameters, callback);
			};
		}
		getPathParams(params) {
			const pathParams = new Array();
			if (typeof params !== "object") params = {};
			Object.keys(params).forEach((key) => {
				if (params[key].location === "path") pathParams.push(key);
			});
			return pathParams;
		}
	};
	exports.Endpoint = Endpoint;
	/**
	* Build a string used to create a URL from the discovery doc provided URL.
	* replace double slashes with single slash (except in https://)
	* @private
	* @param  input URL to build from
	* @return Resulting built URL
	*/
	function buildurl(input) {
		return input ? `'${input}'`.replace(/([^:]\/)\/+/g, "$1") : "";
	}
}));
//#endregion
//#region ../../node_modules/.pnpm/googleapis-common@9.1.0/node_modules/googleapis-common/build/src/discovery.js
var require_discovery = /* @__PURE__ */ __commonJSMin(((exports) => {
	Object.defineProperty(exports, "__esModule", { value: true });
	exports.Discovery = void 0;
	const fs = __require("fs");
	const gaxios_1 = require_src$4();
	const util = __require("util");
	const apirequest_1 = require_apirequest();
	const endpoint_1 = require_endpoint();
	const readFile = util.promisify(fs.readFile);
	var Discovery = class {
		transporter = new gaxios_1.Gaxios();
		options;
		/**
		* Discovery for discovering API endpoints
		*
		* @param options Options for discovery
		*/
		constructor(options) {
			this.options = options || {};
		}
		/**
		* Generate and Endpoint from an endpoint schema object.
		*
		* @param schema The schema from which to generate the Endpoint.
		* @return A function that creates an endpoint.
		*/
		makeEndpoint(schema) {
			return (options) => {
				const ep = new endpoint_1.Endpoint(options);
				ep.applySchema(ep, schema, schema, ep);
				return ep;
			};
		}
		/**
		* Log output of generator. Works just like console.log
		*/
		log(...args) {
			if (this.options && this.options.debug) console.log(...args);
		}
		/**
		* Generate all APIs and return as in-memory object.
		* @param discoveryUrl
		*/
		async discoverAllAPIs(discoveryUrl) {
			const headers = new Headers(this.options.includePrivate ? {} : { "X-User-Ip": "0.0.0.0" });
			const items = (await this.transporter.request({
				url: discoveryUrl,
				headers
			})).data.items;
			const apis = await Promise.all(items.map(async (api) => {
				return {
					api,
					endpointCreator: await this.discoverAPI(api.discoveryRestUrl)
				};
			}));
			const versionIndex = {};
			const apisIndex = {};
			for (const set of apis) {
				if (!apisIndex[set.api.name]) {
					versionIndex[set.api.name] = {};
					apisIndex[set.api.name] = (options) => {
						const type = typeof options;
						let version;
						if (type === "string") {
							version = options;
							options = {};
						} else if (type === "object") {
							version = options.version;
							delete options.version;
						} else throw new Error("Argument error: Accepts only string or object");
						try {
							const ep = set.endpointCreator(options, this);
							return Object.freeze(ep);
						} catch (e) {
							throw new Error(util.format("Unable to load endpoint %s(\"%s\"): %s", set.api.name, version, e.message));
						}
					};
				}
				versionIndex[set.api.name][set.api.version] = set.endpointCreator;
			}
			return apisIndex;
		}
		/**
		* Generate API file given discovery URL
		*
		* @param apiDiscoveryUrl URL or filename of discovery doc for API
		* @returns A promise that resolves with a function that creates the endpoint
		*/
		async discoverAPI(apiDiscoveryUrl) {
			if (typeof apiDiscoveryUrl === "string") {
				let isUrl = false;
				try {
					const parsed = new URL(apiDiscoveryUrl);
					isUrl = parsed.protocol === "http:" || parsed.protocol === "https:";
				} catch (e) {}
				if (apiDiscoveryUrl && !isUrl) {
					this.log("Reading from file " + apiDiscoveryUrl);
					const file = await readFile(apiDiscoveryUrl, { encoding: "utf8" });
					return this.makeEndpoint(JSON.parse(file));
				} else {
					this.log("Requesting " + apiDiscoveryUrl);
					const res = await this.transporter.request({ url: apiDiscoveryUrl });
					return this.makeEndpoint(res.data);
				}
			} else {
				const options = apiDiscoveryUrl;
				this.log("Requesting " + options.url);
				const url = options.url;
				delete options.url;
				const parameters = {
					options: {
						url,
						method: "GET"
					},
					requiredParams: [],
					pathParams: [],
					params: options,
					context: {
						google: { _options: {} },
						_options: {}
					}
				};
				const res = await (0, apirequest_1.createAPIRequest)(parameters);
				return this.makeEndpoint(res.data);
			}
		}
	};
	exports.Discovery = Discovery;
}));
//#endregion
//#region ../../node_modules/.pnpm/googleapis-common@9.1.0/node_modules/googleapis-common/build/src/index.js
var require_src = /* @__PURE__ */ __commonJSMin(((exports) => {
	var __createBinding = exports && exports.__createBinding || (Object.create ? (function(o, m, k, k2) {
		if (k2 === void 0) k2 = k;
		var desc = Object.getOwnPropertyDescriptor(m, k);
		if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) desc = {
			enumerable: true,
			get: function() {
				return m[k];
			}
		};
		Object.defineProperty(o, k2, desc);
	}) : (function(o, m, k, k2) {
		if (k2 === void 0) k2 = k;
		o[k2] = m[k];
	}));
	var __exportStar = exports && exports.__exportStar || function(m, exports$1) {
		for (var p in m) if (p !== "default" && !Object.prototype.hasOwnProperty.call(exports$1, p)) __createBinding(exports$1, m, p);
	};
	Object.defineProperty(exports, "__esModule", { value: true });
	exports.Endpoint = exports.Discovery = exports.AuthPlus = exports.createAPIRequest = exports.getAPI = exports.GaxiosError = exports.Gaxios = exports.AwsClient = exports.IdentityPoolClient = exports.BaseExternalAccountClient = exports.ExternalAccountClient = exports.GoogleAuth = exports.UserRefreshClient = exports.Compute = exports.JWT = exports.OAuth2Client = exports.gaxios = exports.googleAuthLibrary = void 0;
	exports.googleAuthLibrary = require_src$1();
	exports.gaxios = require_src$4();
	var google_auth_library_1 = require_src$1();
	Object.defineProperty(exports, "OAuth2Client", {
		enumerable: true,
		get: function() {
			return google_auth_library_1.OAuth2Client;
		}
	});
	Object.defineProperty(exports, "JWT", {
		enumerable: true,
		get: function() {
			return google_auth_library_1.JWT;
		}
	});
	Object.defineProperty(exports, "Compute", {
		enumerable: true,
		get: function() {
			return google_auth_library_1.Compute;
		}
	});
	Object.defineProperty(exports, "UserRefreshClient", {
		enumerable: true,
		get: function() {
			return google_auth_library_1.UserRefreshClient;
		}
	});
	Object.defineProperty(exports, "GoogleAuth", {
		enumerable: true,
		get: function() {
			return google_auth_library_1.GoogleAuth;
		}
	});
	Object.defineProperty(exports, "ExternalAccountClient", {
		enumerable: true,
		get: function() {
			return google_auth_library_1.ExternalAccountClient;
		}
	});
	Object.defineProperty(exports, "BaseExternalAccountClient", {
		enumerable: true,
		get: function() {
			return google_auth_library_1.BaseExternalAccountClient;
		}
	});
	Object.defineProperty(exports, "IdentityPoolClient", {
		enumerable: true,
		get: function() {
			return google_auth_library_1.IdentityPoolClient;
		}
	});
	Object.defineProperty(exports, "AwsClient", {
		enumerable: true,
		get: function() {
			return google_auth_library_1.AwsClient;
		}
	});
	var gaxios_1 = require_src$4();
	Object.defineProperty(exports, "Gaxios", {
		enumerable: true,
		get: function() {
			return gaxios_1.Gaxios;
		}
	});
	Object.defineProperty(exports, "GaxiosError", {
		enumerable: true,
		get: function() {
			return gaxios_1.GaxiosError;
		}
	});
	var apiIndex_1 = require_apiIndex();
	Object.defineProperty(exports, "getAPI", {
		enumerable: true,
		get: function() {
			return apiIndex_1.getAPI;
		}
	});
	var apirequest_1 = require_apirequest();
	Object.defineProperty(exports, "createAPIRequest", {
		enumerable: true,
		get: function() {
			return apirequest_1.createAPIRequest;
		}
	});
	var authplus_1 = require_authplus();
	Object.defineProperty(exports, "AuthPlus", {
		enumerable: true,
		get: function() {
			return authplus_1.AuthPlus;
		}
	});
	var discovery_1 = require_discovery();
	Object.defineProperty(exports, "Discovery", {
		enumerable: true,
		get: function() {
			return discovery_1.Discovery;
		}
	});
	var endpoint_1 = require_endpoint();
	Object.defineProperty(exports, "Endpoint", {
		enumerable: true,
		get: function() {
			return endpoint_1.Endpoint;
		}
	});
	__exportStar(require_util(), exports);
}));
//#endregion
//#region ../../node_modules/.pnpm/@googleapis+gmail@22.0.0/node_modules/@googleapis/gmail/build/v1.js
var require_v1$1 = /* @__PURE__ */ __commonJSMin(((exports) => {
	Object.defineProperty(exports, "__esModule", { value: true });
	exports.gmail_v1 = void 0;
	const googleapis_common_1 = require_src();
	var gmail_v1;
	(function(gmail_v1) {
		/**
		* Gmail API
		*
		* The Gmail API lets you view and manage Gmail mailbox data like threads, messages, and labels.
		*
		* @example
		* ```js
		* const {google} = require('googleapis');
		* const gmail = google.gmail('v1');
		* ```
		*/
		class Gmail {
			context;
			users;
			constructor(options, google) {
				this.context = {
					_options: options || {},
					google
				};
				this.users = new Resource$Users(this.context);
			}
		}
		gmail_v1.Gmail = Gmail;
		class Resource$Users {
			context;
			drafts;
			history;
			labels;
			messages;
			settings;
			threads;
			constructor(context) {
				this.context = context;
				this.drafts = new Resource$Users$Drafts(this.context);
				this.history = new Resource$Users$History(this.context);
				this.labels = new Resource$Users$Labels(this.context);
				this.messages = new Resource$Users$Messages(this.context);
				this.settings = new Resource$Users$Settings(this.context);
				this.threads = new Resource$Users$Threads(this.context);
			}
			getProfile(paramsOrCallback, optionsOrCallback, callback) {
				let params = paramsOrCallback || {};
				let options = optionsOrCallback || {};
				if (typeof paramsOrCallback === "function") {
					callback = paramsOrCallback;
					params = {};
					options = {};
				}
				if (typeof optionsOrCallback === "function") {
					callback = optionsOrCallback;
					options = {};
				}
				const rootUrl = options.rootUrl || "https://gmail.googleapis.com/";
				const parameters = {
					options: Object.assign({
						url: (rootUrl + "/gmail/v1/users/{userId}/profile").replace(/([^:]\/)\/+/g, "$1"),
						method: "GET",
						apiVersion: ""
					}, options),
					params,
					requiredParams: ["userId"],
					pathParams: ["userId"],
					context: this.context
				};
				if (callback) (0, googleapis_common_1.createAPIRequest)(parameters, callback);
				else return (0, googleapis_common_1.createAPIRequest)(parameters);
			}
			stop(paramsOrCallback, optionsOrCallback, callback) {
				let params = paramsOrCallback || {};
				let options = optionsOrCallback || {};
				if (typeof paramsOrCallback === "function") {
					callback = paramsOrCallback;
					params = {};
					options = {};
				}
				if (typeof optionsOrCallback === "function") {
					callback = optionsOrCallback;
					options = {};
				}
				const rootUrl = options.rootUrl || "https://gmail.googleapis.com/";
				const parameters = {
					options: Object.assign({
						url: (rootUrl + "/gmail/v1/users/{userId}/stop").replace(/([^:]\/)\/+/g, "$1"),
						method: "POST",
						apiVersion: ""
					}, options),
					params,
					requiredParams: ["userId"],
					pathParams: ["userId"],
					context: this.context
				};
				if (callback) (0, googleapis_common_1.createAPIRequest)(parameters, callback);
				else return (0, googleapis_common_1.createAPIRequest)(parameters);
			}
			watch(paramsOrCallback, optionsOrCallback, callback) {
				let params = paramsOrCallback || {};
				let options = optionsOrCallback || {};
				if (typeof paramsOrCallback === "function") {
					callback = paramsOrCallback;
					params = {};
					options = {};
				}
				if (typeof optionsOrCallback === "function") {
					callback = optionsOrCallback;
					options = {};
				}
				const rootUrl = options.rootUrl || "https://gmail.googleapis.com/";
				const parameters = {
					options: Object.assign({
						url: (rootUrl + "/gmail/v1/users/{userId}/watch").replace(/([^:]\/)\/+/g, "$1"),
						method: "POST",
						apiVersion: ""
					}, options),
					params,
					requiredParams: ["userId"],
					pathParams: ["userId"],
					context: this.context
				};
				if (callback) (0, googleapis_common_1.createAPIRequest)(parameters, callback);
				else return (0, googleapis_common_1.createAPIRequest)(parameters);
			}
		}
		gmail_v1.Resource$Users = Resource$Users;
		class Resource$Users$Drafts {
			context;
			constructor(context) {
				this.context = context;
			}
			create(paramsOrCallback, optionsOrCallback, callback) {
				let params = paramsOrCallback || {};
				let options = optionsOrCallback || {};
				if (typeof paramsOrCallback === "function") {
					callback = paramsOrCallback;
					params = {};
					options = {};
				}
				if (typeof optionsOrCallback === "function") {
					callback = optionsOrCallback;
					options = {};
				}
				const rootUrl = options.rootUrl || "https://gmail.googleapis.com/";
				const parameters = {
					options: Object.assign({
						url: (rootUrl + "/gmail/v1/users/{userId}/drafts").replace(/([^:]\/)\/+/g, "$1"),
						method: "POST",
						apiVersion: ""
					}, options),
					params,
					mediaUrl: (rootUrl + "/upload/gmail/v1/users/{userId}/drafts").replace(/([^:]\/)\/+/g, "$1"),
					requiredParams: ["userId"],
					pathParams: ["userId"],
					context: this.context
				};
				if (callback) (0, googleapis_common_1.createAPIRequest)(parameters, callback);
				else return (0, googleapis_common_1.createAPIRequest)(parameters);
			}
			delete(paramsOrCallback, optionsOrCallback, callback) {
				let params = paramsOrCallback || {};
				let options = optionsOrCallback || {};
				if (typeof paramsOrCallback === "function") {
					callback = paramsOrCallback;
					params = {};
					options = {};
				}
				if (typeof optionsOrCallback === "function") {
					callback = optionsOrCallback;
					options = {};
				}
				const rootUrl = options.rootUrl || "https://gmail.googleapis.com/";
				const parameters = {
					options: Object.assign({
						url: (rootUrl + "/gmail/v1/users/{userId}/drafts/{id}").replace(/([^:]\/)\/+/g, "$1"),
						method: "DELETE",
						apiVersion: ""
					}, options),
					params,
					requiredParams: ["userId", "id"],
					pathParams: ["id", "userId"],
					context: this.context
				};
				if (callback) (0, googleapis_common_1.createAPIRequest)(parameters, callback);
				else return (0, googleapis_common_1.createAPIRequest)(parameters);
			}
			get(paramsOrCallback, optionsOrCallback, callback) {
				let params = paramsOrCallback || {};
				let options = optionsOrCallback || {};
				if (typeof paramsOrCallback === "function") {
					callback = paramsOrCallback;
					params = {};
					options = {};
				}
				if (typeof optionsOrCallback === "function") {
					callback = optionsOrCallback;
					options = {};
				}
				const rootUrl = options.rootUrl || "https://gmail.googleapis.com/";
				const parameters = {
					options: Object.assign({
						url: (rootUrl + "/gmail/v1/users/{userId}/drafts/{id}").replace(/([^:]\/)\/+/g, "$1"),
						method: "GET",
						apiVersion: ""
					}, options),
					params,
					requiredParams: ["userId", "id"],
					pathParams: ["id", "userId"],
					context: this.context
				};
				if (callback) (0, googleapis_common_1.createAPIRequest)(parameters, callback);
				else return (0, googleapis_common_1.createAPIRequest)(parameters);
			}
			list(paramsOrCallback, optionsOrCallback, callback) {
				let params = paramsOrCallback || {};
				let options = optionsOrCallback || {};
				if (typeof paramsOrCallback === "function") {
					callback = paramsOrCallback;
					params = {};
					options = {};
				}
				if (typeof optionsOrCallback === "function") {
					callback = optionsOrCallback;
					options = {};
				}
				const rootUrl = options.rootUrl || "https://gmail.googleapis.com/";
				const parameters = {
					options: Object.assign({
						url: (rootUrl + "/gmail/v1/users/{userId}/drafts").replace(/([^:]\/)\/+/g, "$1"),
						method: "GET",
						apiVersion: ""
					}, options),
					params,
					requiredParams: ["userId"],
					pathParams: ["userId"],
					context: this.context
				};
				if (callback) (0, googleapis_common_1.createAPIRequest)(parameters, callback);
				else return (0, googleapis_common_1.createAPIRequest)(parameters);
			}
			send(paramsOrCallback, optionsOrCallback, callback) {
				let params = paramsOrCallback || {};
				let options = optionsOrCallback || {};
				if (typeof paramsOrCallback === "function") {
					callback = paramsOrCallback;
					params = {};
					options = {};
				}
				if (typeof optionsOrCallback === "function") {
					callback = optionsOrCallback;
					options = {};
				}
				const rootUrl = options.rootUrl || "https://gmail.googleapis.com/";
				const parameters = {
					options: Object.assign({
						url: (rootUrl + "/gmail/v1/users/{userId}/drafts/send").replace(/([^:]\/)\/+/g, "$1"),
						method: "POST",
						apiVersion: ""
					}, options),
					params,
					mediaUrl: (rootUrl + "/upload/gmail/v1/users/{userId}/drafts/send").replace(/([^:]\/)\/+/g, "$1"),
					requiredParams: ["userId"],
					pathParams: ["userId"],
					context: this.context
				};
				if (callback) (0, googleapis_common_1.createAPIRequest)(parameters, callback);
				else return (0, googleapis_common_1.createAPIRequest)(parameters);
			}
			update(paramsOrCallback, optionsOrCallback, callback) {
				let params = paramsOrCallback || {};
				let options = optionsOrCallback || {};
				if (typeof paramsOrCallback === "function") {
					callback = paramsOrCallback;
					params = {};
					options = {};
				}
				if (typeof optionsOrCallback === "function") {
					callback = optionsOrCallback;
					options = {};
				}
				const rootUrl = options.rootUrl || "https://gmail.googleapis.com/";
				const parameters = {
					options: Object.assign({
						url: (rootUrl + "/gmail/v1/users/{userId}/drafts/{id}").replace(/([^:]\/)\/+/g, "$1"),
						method: "PUT",
						apiVersion: ""
					}, options),
					params,
					mediaUrl: (rootUrl + "/upload/gmail/v1/users/{userId}/drafts/{id}").replace(/([^:]\/)\/+/g, "$1"),
					requiredParams: ["userId", "id"],
					pathParams: ["id", "userId"],
					context: this.context
				};
				if (callback) (0, googleapis_common_1.createAPIRequest)(parameters, callback);
				else return (0, googleapis_common_1.createAPIRequest)(parameters);
			}
		}
		gmail_v1.Resource$Users$Drafts = Resource$Users$Drafts;
		class Resource$Users$History {
			context;
			constructor(context) {
				this.context = context;
			}
			list(paramsOrCallback, optionsOrCallback, callback) {
				let params = paramsOrCallback || {};
				let options = optionsOrCallback || {};
				if (typeof paramsOrCallback === "function") {
					callback = paramsOrCallback;
					params = {};
					options = {};
				}
				if (typeof optionsOrCallback === "function") {
					callback = optionsOrCallback;
					options = {};
				}
				const rootUrl = options.rootUrl || "https://gmail.googleapis.com/";
				const parameters = {
					options: Object.assign({
						url: (rootUrl + "/gmail/v1/users/{userId}/history").replace(/([^:]\/)\/+/g, "$1"),
						method: "GET",
						apiVersion: ""
					}, options),
					params,
					requiredParams: ["userId"],
					pathParams: ["userId"],
					context: this.context
				};
				if (callback) (0, googleapis_common_1.createAPIRequest)(parameters, callback);
				else return (0, googleapis_common_1.createAPIRequest)(parameters);
			}
		}
		gmail_v1.Resource$Users$History = Resource$Users$History;
		class Resource$Users$Labels {
			context;
			constructor(context) {
				this.context = context;
			}
			create(paramsOrCallback, optionsOrCallback, callback) {
				let params = paramsOrCallback || {};
				let options = optionsOrCallback || {};
				if (typeof paramsOrCallback === "function") {
					callback = paramsOrCallback;
					params = {};
					options = {};
				}
				if (typeof optionsOrCallback === "function") {
					callback = optionsOrCallback;
					options = {};
				}
				const rootUrl = options.rootUrl || "https://gmail.googleapis.com/";
				const parameters = {
					options: Object.assign({
						url: (rootUrl + "/gmail/v1/users/{userId}/labels").replace(/([^:]\/)\/+/g, "$1"),
						method: "POST",
						apiVersion: ""
					}, options),
					params,
					requiredParams: ["userId"],
					pathParams: ["userId"],
					context: this.context
				};
				if (callback) (0, googleapis_common_1.createAPIRequest)(parameters, callback);
				else return (0, googleapis_common_1.createAPIRequest)(parameters);
			}
			delete(paramsOrCallback, optionsOrCallback, callback) {
				let params = paramsOrCallback || {};
				let options = optionsOrCallback || {};
				if (typeof paramsOrCallback === "function") {
					callback = paramsOrCallback;
					params = {};
					options = {};
				}
				if (typeof optionsOrCallback === "function") {
					callback = optionsOrCallback;
					options = {};
				}
				const rootUrl = options.rootUrl || "https://gmail.googleapis.com/";
				const parameters = {
					options: Object.assign({
						url: (rootUrl + "/gmail/v1/users/{userId}/labels/{id}").replace(/([^:]\/)\/+/g, "$1"),
						method: "DELETE",
						apiVersion: ""
					}, options),
					params,
					requiredParams: ["userId", "id"],
					pathParams: ["id", "userId"],
					context: this.context
				};
				if (callback) (0, googleapis_common_1.createAPIRequest)(parameters, callback);
				else return (0, googleapis_common_1.createAPIRequest)(parameters);
			}
			get(paramsOrCallback, optionsOrCallback, callback) {
				let params = paramsOrCallback || {};
				let options = optionsOrCallback || {};
				if (typeof paramsOrCallback === "function") {
					callback = paramsOrCallback;
					params = {};
					options = {};
				}
				if (typeof optionsOrCallback === "function") {
					callback = optionsOrCallback;
					options = {};
				}
				const rootUrl = options.rootUrl || "https://gmail.googleapis.com/";
				const parameters = {
					options: Object.assign({
						url: (rootUrl + "/gmail/v1/users/{userId}/labels/{id}").replace(/([^:]\/)\/+/g, "$1"),
						method: "GET",
						apiVersion: ""
					}, options),
					params,
					requiredParams: ["userId", "id"],
					pathParams: ["id", "userId"],
					context: this.context
				};
				if (callback) (0, googleapis_common_1.createAPIRequest)(parameters, callback);
				else return (0, googleapis_common_1.createAPIRequest)(parameters);
			}
			list(paramsOrCallback, optionsOrCallback, callback) {
				let params = paramsOrCallback || {};
				let options = optionsOrCallback || {};
				if (typeof paramsOrCallback === "function") {
					callback = paramsOrCallback;
					params = {};
					options = {};
				}
				if (typeof optionsOrCallback === "function") {
					callback = optionsOrCallback;
					options = {};
				}
				const rootUrl = options.rootUrl || "https://gmail.googleapis.com/";
				const parameters = {
					options: Object.assign({
						url: (rootUrl + "/gmail/v1/users/{userId}/labels").replace(/([^:]\/)\/+/g, "$1"),
						method: "GET",
						apiVersion: ""
					}, options),
					params,
					requiredParams: ["userId"],
					pathParams: ["userId"],
					context: this.context
				};
				if (callback) (0, googleapis_common_1.createAPIRequest)(parameters, callback);
				else return (0, googleapis_common_1.createAPIRequest)(parameters);
			}
			patch(paramsOrCallback, optionsOrCallback, callback) {
				let params = paramsOrCallback || {};
				let options = optionsOrCallback || {};
				if (typeof paramsOrCallback === "function") {
					callback = paramsOrCallback;
					params = {};
					options = {};
				}
				if (typeof optionsOrCallback === "function") {
					callback = optionsOrCallback;
					options = {};
				}
				const rootUrl = options.rootUrl || "https://gmail.googleapis.com/";
				const parameters = {
					options: Object.assign({
						url: (rootUrl + "/gmail/v1/users/{userId}/labels/{id}").replace(/([^:]\/)\/+/g, "$1"),
						method: "PATCH",
						apiVersion: ""
					}, options),
					params,
					requiredParams: ["userId", "id"],
					pathParams: ["id", "userId"],
					context: this.context
				};
				if (callback) (0, googleapis_common_1.createAPIRequest)(parameters, callback);
				else return (0, googleapis_common_1.createAPIRequest)(parameters);
			}
			update(paramsOrCallback, optionsOrCallback, callback) {
				let params = paramsOrCallback || {};
				let options = optionsOrCallback || {};
				if (typeof paramsOrCallback === "function") {
					callback = paramsOrCallback;
					params = {};
					options = {};
				}
				if (typeof optionsOrCallback === "function") {
					callback = optionsOrCallback;
					options = {};
				}
				const rootUrl = options.rootUrl || "https://gmail.googleapis.com/";
				const parameters = {
					options: Object.assign({
						url: (rootUrl + "/gmail/v1/users/{userId}/labels/{id}").replace(/([^:]\/)\/+/g, "$1"),
						method: "PUT",
						apiVersion: ""
					}, options),
					params,
					requiredParams: ["userId", "id"],
					pathParams: ["id", "userId"],
					context: this.context
				};
				if (callback) (0, googleapis_common_1.createAPIRequest)(parameters, callback);
				else return (0, googleapis_common_1.createAPIRequest)(parameters);
			}
		}
		gmail_v1.Resource$Users$Labels = Resource$Users$Labels;
		class Resource$Users$Messages {
			context;
			attachments;
			constructor(context) {
				this.context = context;
				this.attachments = new Resource$Users$Messages$Attachments(this.context);
			}
			batchDelete(paramsOrCallback, optionsOrCallback, callback) {
				let params = paramsOrCallback || {};
				let options = optionsOrCallback || {};
				if (typeof paramsOrCallback === "function") {
					callback = paramsOrCallback;
					params = {};
					options = {};
				}
				if (typeof optionsOrCallback === "function") {
					callback = optionsOrCallback;
					options = {};
				}
				const rootUrl = options.rootUrl || "https://gmail.googleapis.com/";
				const parameters = {
					options: Object.assign({
						url: (rootUrl + "/gmail/v1/users/{userId}/messages/batchDelete").replace(/([^:]\/)\/+/g, "$1"),
						method: "POST",
						apiVersion: ""
					}, options),
					params,
					requiredParams: ["userId"],
					pathParams: ["userId"],
					context: this.context
				};
				if (callback) (0, googleapis_common_1.createAPIRequest)(parameters, callback);
				else return (0, googleapis_common_1.createAPIRequest)(parameters);
			}
			batchModify(paramsOrCallback, optionsOrCallback, callback) {
				let params = paramsOrCallback || {};
				let options = optionsOrCallback || {};
				if (typeof paramsOrCallback === "function") {
					callback = paramsOrCallback;
					params = {};
					options = {};
				}
				if (typeof optionsOrCallback === "function") {
					callback = optionsOrCallback;
					options = {};
				}
				const rootUrl = options.rootUrl || "https://gmail.googleapis.com/";
				const parameters = {
					options: Object.assign({
						url: (rootUrl + "/gmail/v1/users/{userId}/messages/batchModify").replace(/([^:]\/)\/+/g, "$1"),
						method: "POST",
						apiVersion: ""
					}, options),
					params,
					requiredParams: ["userId"],
					pathParams: ["userId"],
					context: this.context
				};
				if (callback) (0, googleapis_common_1.createAPIRequest)(parameters, callback);
				else return (0, googleapis_common_1.createAPIRequest)(parameters);
			}
			delete(paramsOrCallback, optionsOrCallback, callback) {
				let params = paramsOrCallback || {};
				let options = optionsOrCallback || {};
				if (typeof paramsOrCallback === "function") {
					callback = paramsOrCallback;
					params = {};
					options = {};
				}
				if (typeof optionsOrCallback === "function") {
					callback = optionsOrCallback;
					options = {};
				}
				const rootUrl = options.rootUrl || "https://gmail.googleapis.com/";
				const parameters = {
					options: Object.assign({
						url: (rootUrl + "/gmail/v1/users/{userId}/messages/{id}").replace(/([^:]\/)\/+/g, "$1"),
						method: "DELETE",
						apiVersion: ""
					}, options),
					params,
					requiredParams: ["userId", "id"],
					pathParams: ["id", "userId"],
					context: this.context
				};
				if (callback) (0, googleapis_common_1.createAPIRequest)(parameters, callback);
				else return (0, googleapis_common_1.createAPIRequest)(parameters);
			}
			get(paramsOrCallback, optionsOrCallback, callback) {
				let params = paramsOrCallback || {};
				let options = optionsOrCallback || {};
				if (typeof paramsOrCallback === "function") {
					callback = paramsOrCallback;
					params = {};
					options = {};
				}
				if (typeof optionsOrCallback === "function") {
					callback = optionsOrCallback;
					options = {};
				}
				const rootUrl = options.rootUrl || "https://gmail.googleapis.com/";
				const parameters = {
					options: Object.assign({
						url: (rootUrl + "/gmail/v1/users/{userId}/messages/{id}").replace(/([^:]\/)\/+/g, "$1"),
						method: "GET",
						apiVersion: ""
					}, options),
					params,
					requiredParams: ["userId", "id"],
					pathParams: ["id", "userId"],
					context: this.context
				};
				if (callback) (0, googleapis_common_1.createAPIRequest)(parameters, callback);
				else return (0, googleapis_common_1.createAPIRequest)(parameters);
			}
			import(paramsOrCallback, optionsOrCallback, callback) {
				let params = paramsOrCallback || {};
				let options = optionsOrCallback || {};
				if (typeof paramsOrCallback === "function") {
					callback = paramsOrCallback;
					params = {};
					options = {};
				}
				if (typeof optionsOrCallback === "function") {
					callback = optionsOrCallback;
					options = {};
				}
				const rootUrl = options.rootUrl || "https://gmail.googleapis.com/";
				const parameters = {
					options: Object.assign({
						url: (rootUrl + "/gmail/v1/users/{userId}/messages/import").replace(/([^:]\/)\/+/g, "$1"),
						method: "POST",
						apiVersion: ""
					}, options),
					params,
					mediaUrl: (rootUrl + "/upload/gmail/v1/users/{userId}/messages/import").replace(/([^:]\/)\/+/g, "$1"),
					requiredParams: ["userId"],
					pathParams: ["userId"],
					context: this.context
				};
				if (callback) (0, googleapis_common_1.createAPIRequest)(parameters, callback);
				else return (0, googleapis_common_1.createAPIRequest)(parameters);
			}
			insert(paramsOrCallback, optionsOrCallback, callback) {
				let params = paramsOrCallback || {};
				let options = optionsOrCallback || {};
				if (typeof paramsOrCallback === "function") {
					callback = paramsOrCallback;
					params = {};
					options = {};
				}
				if (typeof optionsOrCallback === "function") {
					callback = optionsOrCallback;
					options = {};
				}
				const rootUrl = options.rootUrl || "https://gmail.googleapis.com/";
				const parameters = {
					options: Object.assign({
						url: (rootUrl + "/gmail/v1/users/{userId}/messages").replace(/([^:]\/)\/+/g, "$1"),
						method: "POST",
						apiVersion: ""
					}, options),
					params,
					mediaUrl: (rootUrl + "/upload/gmail/v1/users/{userId}/messages").replace(/([^:]\/)\/+/g, "$1"),
					requiredParams: ["userId"],
					pathParams: ["userId"],
					context: this.context
				};
				if (callback) (0, googleapis_common_1.createAPIRequest)(parameters, callback);
				else return (0, googleapis_common_1.createAPIRequest)(parameters);
			}
			list(paramsOrCallback, optionsOrCallback, callback) {
				let params = paramsOrCallback || {};
				let options = optionsOrCallback || {};
				if (typeof paramsOrCallback === "function") {
					callback = paramsOrCallback;
					params = {};
					options = {};
				}
				if (typeof optionsOrCallback === "function") {
					callback = optionsOrCallback;
					options = {};
				}
				const rootUrl = options.rootUrl || "https://gmail.googleapis.com/";
				const parameters = {
					options: Object.assign({
						url: (rootUrl + "/gmail/v1/users/{userId}/messages").replace(/([^:]\/)\/+/g, "$1"),
						method: "GET",
						apiVersion: ""
					}, options),
					params,
					requiredParams: ["userId"],
					pathParams: ["userId"],
					context: this.context
				};
				if (callback) (0, googleapis_common_1.createAPIRequest)(parameters, callback);
				else return (0, googleapis_common_1.createAPIRequest)(parameters);
			}
			modify(paramsOrCallback, optionsOrCallback, callback) {
				let params = paramsOrCallback || {};
				let options = optionsOrCallback || {};
				if (typeof paramsOrCallback === "function") {
					callback = paramsOrCallback;
					params = {};
					options = {};
				}
				if (typeof optionsOrCallback === "function") {
					callback = optionsOrCallback;
					options = {};
				}
				const rootUrl = options.rootUrl || "https://gmail.googleapis.com/";
				const parameters = {
					options: Object.assign({
						url: (rootUrl + "/gmail/v1/users/{userId}/messages/{id}/modify").replace(/([^:]\/)\/+/g, "$1"),
						method: "POST",
						apiVersion: ""
					}, options),
					params,
					requiredParams: ["userId", "id"],
					pathParams: ["id", "userId"],
					context: this.context
				};
				if (callback) (0, googleapis_common_1.createAPIRequest)(parameters, callback);
				else return (0, googleapis_common_1.createAPIRequest)(parameters);
			}
			send(paramsOrCallback, optionsOrCallback, callback) {
				let params = paramsOrCallback || {};
				let options = optionsOrCallback || {};
				if (typeof paramsOrCallback === "function") {
					callback = paramsOrCallback;
					params = {};
					options = {};
				}
				if (typeof optionsOrCallback === "function") {
					callback = optionsOrCallback;
					options = {};
				}
				const rootUrl = options.rootUrl || "https://gmail.googleapis.com/";
				const parameters = {
					options: Object.assign({
						url: (rootUrl + "/gmail/v1/users/{userId}/messages/send").replace(/([^:]\/)\/+/g, "$1"),
						method: "POST",
						apiVersion: ""
					}, options),
					params,
					mediaUrl: (rootUrl + "/upload/gmail/v1/users/{userId}/messages/send").replace(/([^:]\/)\/+/g, "$1"),
					requiredParams: ["userId"],
					pathParams: ["userId"],
					context: this.context
				};
				if (callback) (0, googleapis_common_1.createAPIRequest)(parameters, callback);
				else return (0, googleapis_common_1.createAPIRequest)(parameters);
			}
			trash(paramsOrCallback, optionsOrCallback, callback) {
				let params = paramsOrCallback || {};
				let options = optionsOrCallback || {};
				if (typeof paramsOrCallback === "function") {
					callback = paramsOrCallback;
					params = {};
					options = {};
				}
				if (typeof optionsOrCallback === "function") {
					callback = optionsOrCallback;
					options = {};
				}
				const rootUrl = options.rootUrl || "https://gmail.googleapis.com/";
				const parameters = {
					options: Object.assign({
						url: (rootUrl + "/gmail/v1/users/{userId}/messages/{id}/trash").replace(/([^:]\/)\/+/g, "$1"),
						method: "POST",
						apiVersion: ""
					}, options),
					params,
					requiredParams: ["userId", "id"],
					pathParams: ["id", "userId"],
					context: this.context
				};
				if (callback) (0, googleapis_common_1.createAPIRequest)(parameters, callback);
				else return (0, googleapis_common_1.createAPIRequest)(parameters);
			}
			untrash(paramsOrCallback, optionsOrCallback, callback) {
				let params = paramsOrCallback || {};
				let options = optionsOrCallback || {};
				if (typeof paramsOrCallback === "function") {
					callback = paramsOrCallback;
					params = {};
					options = {};
				}
				if (typeof optionsOrCallback === "function") {
					callback = optionsOrCallback;
					options = {};
				}
				const rootUrl = options.rootUrl || "https://gmail.googleapis.com/";
				const parameters = {
					options: Object.assign({
						url: (rootUrl + "/gmail/v1/users/{userId}/messages/{id}/untrash").replace(/([^:]\/)\/+/g, "$1"),
						method: "POST",
						apiVersion: ""
					}, options),
					params,
					requiredParams: ["userId", "id"],
					pathParams: ["id", "userId"],
					context: this.context
				};
				if (callback) (0, googleapis_common_1.createAPIRequest)(parameters, callback);
				else return (0, googleapis_common_1.createAPIRequest)(parameters);
			}
		}
		gmail_v1.Resource$Users$Messages = Resource$Users$Messages;
		class Resource$Users$Messages$Attachments {
			context;
			constructor(context) {
				this.context = context;
			}
			get(paramsOrCallback, optionsOrCallback, callback) {
				let params = paramsOrCallback || {};
				let options = optionsOrCallback || {};
				if (typeof paramsOrCallback === "function") {
					callback = paramsOrCallback;
					params = {};
					options = {};
				}
				if (typeof optionsOrCallback === "function") {
					callback = optionsOrCallback;
					options = {};
				}
				const rootUrl = options.rootUrl || "https://gmail.googleapis.com/";
				const parameters = {
					options: Object.assign({
						url: (rootUrl + "/gmail/v1/users/{userId}/messages/{messageId}/attachments/{id}").replace(/([^:]\/)\/+/g, "$1"),
						method: "GET",
						apiVersion: ""
					}, options),
					params,
					requiredParams: [
						"userId",
						"messageId",
						"id"
					],
					pathParams: [
						"id",
						"messageId",
						"userId"
					],
					context: this.context
				};
				if (callback) (0, googleapis_common_1.createAPIRequest)(parameters, callback);
				else return (0, googleapis_common_1.createAPIRequest)(parameters);
			}
		}
		gmail_v1.Resource$Users$Messages$Attachments = Resource$Users$Messages$Attachments;
		class Resource$Users$Settings {
			context;
			cse;
			delegates;
			filters;
			forwardingAddresses;
			sendAs;
			constructor(context) {
				this.context = context;
				this.cse = new Resource$Users$Settings$Cse(this.context);
				this.delegates = new Resource$Users$Settings$Delegates(this.context);
				this.filters = new Resource$Users$Settings$Filters(this.context);
				this.forwardingAddresses = new Resource$Users$Settings$Forwardingaddresses(this.context);
				this.sendAs = new Resource$Users$Settings$Sendas(this.context);
			}
			getAutoForwarding(paramsOrCallback, optionsOrCallback, callback) {
				let params = paramsOrCallback || {};
				let options = optionsOrCallback || {};
				if (typeof paramsOrCallback === "function") {
					callback = paramsOrCallback;
					params = {};
					options = {};
				}
				if (typeof optionsOrCallback === "function") {
					callback = optionsOrCallback;
					options = {};
				}
				const rootUrl = options.rootUrl || "https://gmail.googleapis.com/";
				const parameters = {
					options: Object.assign({
						url: (rootUrl + "/gmail/v1/users/{userId}/settings/autoForwarding").replace(/([^:]\/)\/+/g, "$1"),
						method: "GET",
						apiVersion: ""
					}, options),
					params,
					requiredParams: ["userId"],
					pathParams: ["userId"],
					context: this.context
				};
				if (callback) (0, googleapis_common_1.createAPIRequest)(parameters, callback);
				else return (0, googleapis_common_1.createAPIRequest)(parameters);
			}
			getImap(paramsOrCallback, optionsOrCallback, callback) {
				let params = paramsOrCallback || {};
				let options = optionsOrCallback || {};
				if (typeof paramsOrCallback === "function") {
					callback = paramsOrCallback;
					params = {};
					options = {};
				}
				if (typeof optionsOrCallback === "function") {
					callback = optionsOrCallback;
					options = {};
				}
				const rootUrl = options.rootUrl || "https://gmail.googleapis.com/";
				const parameters = {
					options: Object.assign({
						url: (rootUrl + "/gmail/v1/users/{userId}/settings/imap").replace(/([^:]\/)\/+/g, "$1"),
						method: "GET",
						apiVersion: ""
					}, options),
					params,
					requiredParams: ["userId"],
					pathParams: ["userId"],
					context: this.context
				};
				if (callback) (0, googleapis_common_1.createAPIRequest)(parameters, callback);
				else return (0, googleapis_common_1.createAPIRequest)(parameters);
			}
			getLanguage(paramsOrCallback, optionsOrCallback, callback) {
				let params = paramsOrCallback || {};
				let options = optionsOrCallback || {};
				if (typeof paramsOrCallback === "function") {
					callback = paramsOrCallback;
					params = {};
					options = {};
				}
				if (typeof optionsOrCallback === "function") {
					callback = optionsOrCallback;
					options = {};
				}
				const rootUrl = options.rootUrl || "https://gmail.googleapis.com/";
				const parameters = {
					options: Object.assign({
						url: (rootUrl + "/gmail/v1/users/{userId}/settings/language").replace(/([^:]\/)\/+/g, "$1"),
						method: "GET",
						apiVersion: ""
					}, options),
					params,
					requiredParams: ["userId"],
					pathParams: ["userId"],
					context: this.context
				};
				if (callback) (0, googleapis_common_1.createAPIRequest)(parameters, callback);
				else return (0, googleapis_common_1.createAPIRequest)(parameters);
			}
			getPop(paramsOrCallback, optionsOrCallback, callback) {
				let params = paramsOrCallback || {};
				let options = optionsOrCallback || {};
				if (typeof paramsOrCallback === "function") {
					callback = paramsOrCallback;
					params = {};
					options = {};
				}
				if (typeof optionsOrCallback === "function") {
					callback = optionsOrCallback;
					options = {};
				}
				const rootUrl = options.rootUrl || "https://gmail.googleapis.com/";
				const parameters = {
					options: Object.assign({
						url: (rootUrl + "/gmail/v1/users/{userId}/settings/pop").replace(/([^:]\/)\/+/g, "$1"),
						method: "GET",
						apiVersion: ""
					}, options),
					params,
					requiredParams: ["userId"],
					pathParams: ["userId"],
					context: this.context
				};
				if (callback) (0, googleapis_common_1.createAPIRequest)(parameters, callback);
				else return (0, googleapis_common_1.createAPIRequest)(parameters);
			}
			getVacation(paramsOrCallback, optionsOrCallback, callback) {
				let params = paramsOrCallback || {};
				let options = optionsOrCallback || {};
				if (typeof paramsOrCallback === "function") {
					callback = paramsOrCallback;
					params = {};
					options = {};
				}
				if (typeof optionsOrCallback === "function") {
					callback = optionsOrCallback;
					options = {};
				}
				const rootUrl = options.rootUrl || "https://gmail.googleapis.com/";
				const parameters = {
					options: Object.assign({
						url: (rootUrl + "/gmail/v1/users/{userId}/settings/vacation").replace(/([^:]\/)\/+/g, "$1"),
						method: "GET",
						apiVersion: ""
					}, options),
					params,
					requiredParams: ["userId"],
					pathParams: ["userId"],
					context: this.context
				};
				if (callback) (0, googleapis_common_1.createAPIRequest)(parameters, callback);
				else return (0, googleapis_common_1.createAPIRequest)(parameters);
			}
			updateAutoForwarding(paramsOrCallback, optionsOrCallback, callback) {
				let params = paramsOrCallback || {};
				let options = optionsOrCallback || {};
				if (typeof paramsOrCallback === "function") {
					callback = paramsOrCallback;
					params = {};
					options = {};
				}
				if (typeof optionsOrCallback === "function") {
					callback = optionsOrCallback;
					options = {};
				}
				const rootUrl = options.rootUrl || "https://gmail.googleapis.com/";
				const parameters = {
					options: Object.assign({
						url: (rootUrl + "/gmail/v1/users/{userId}/settings/autoForwarding").replace(/([^:]\/)\/+/g, "$1"),
						method: "PUT",
						apiVersion: ""
					}, options),
					params,
					requiredParams: ["userId"],
					pathParams: ["userId"],
					context: this.context
				};
				if (callback) (0, googleapis_common_1.createAPIRequest)(parameters, callback);
				else return (0, googleapis_common_1.createAPIRequest)(parameters);
			}
			updateImap(paramsOrCallback, optionsOrCallback, callback) {
				let params = paramsOrCallback || {};
				let options = optionsOrCallback || {};
				if (typeof paramsOrCallback === "function") {
					callback = paramsOrCallback;
					params = {};
					options = {};
				}
				if (typeof optionsOrCallback === "function") {
					callback = optionsOrCallback;
					options = {};
				}
				const rootUrl = options.rootUrl || "https://gmail.googleapis.com/";
				const parameters = {
					options: Object.assign({
						url: (rootUrl + "/gmail/v1/users/{userId}/settings/imap").replace(/([^:]\/)\/+/g, "$1"),
						method: "PUT",
						apiVersion: ""
					}, options),
					params,
					requiredParams: ["userId"],
					pathParams: ["userId"],
					context: this.context
				};
				if (callback) (0, googleapis_common_1.createAPIRequest)(parameters, callback);
				else return (0, googleapis_common_1.createAPIRequest)(parameters);
			}
			updateLanguage(paramsOrCallback, optionsOrCallback, callback) {
				let params = paramsOrCallback || {};
				let options = optionsOrCallback || {};
				if (typeof paramsOrCallback === "function") {
					callback = paramsOrCallback;
					params = {};
					options = {};
				}
				if (typeof optionsOrCallback === "function") {
					callback = optionsOrCallback;
					options = {};
				}
				const rootUrl = options.rootUrl || "https://gmail.googleapis.com/";
				const parameters = {
					options: Object.assign({
						url: (rootUrl + "/gmail/v1/users/{userId}/settings/language").replace(/([^:]\/)\/+/g, "$1"),
						method: "PUT",
						apiVersion: ""
					}, options),
					params,
					requiredParams: ["userId"],
					pathParams: ["userId"],
					context: this.context
				};
				if (callback) (0, googleapis_common_1.createAPIRequest)(parameters, callback);
				else return (0, googleapis_common_1.createAPIRequest)(parameters);
			}
			updatePop(paramsOrCallback, optionsOrCallback, callback) {
				let params = paramsOrCallback || {};
				let options = optionsOrCallback || {};
				if (typeof paramsOrCallback === "function") {
					callback = paramsOrCallback;
					params = {};
					options = {};
				}
				if (typeof optionsOrCallback === "function") {
					callback = optionsOrCallback;
					options = {};
				}
				const rootUrl = options.rootUrl || "https://gmail.googleapis.com/";
				const parameters = {
					options: Object.assign({
						url: (rootUrl + "/gmail/v1/users/{userId}/settings/pop").replace(/([^:]\/)\/+/g, "$1"),
						method: "PUT",
						apiVersion: ""
					}, options),
					params,
					requiredParams: ["userId"],
					pathParams: ["userId"],
					context: this.context
				};
				if (callback) (0, googleapis_common_1.createAPIRequest)(parameters, callback);
				else return (0, googleapis_common_1.createAPIRequest)(parameters);
			}
			updateVacation(paramsOrCallback, optionsOrCallback, callback) {
				let params = paramsOrCallback || {};
				let options = optionsOrCallback || {};
				if (typeof paramsOrCallback === "function") {
					callback = paramsOrCallback;
					params = {};
					options = {};
				}
				if (typeof optionsOrCallback === "function") {
					callback = optionsOrCallback;
					options = {};
				}
				const rootUrl = options.rootUrl || "https://gmail.googleapis.com/";
				const parameters = {
					options: Object.assign({
						url: (rootUrl + "/gmail/v1/users/{userId}/settings/vacation").replace(/([^:]\/)\/+/g, "$1"),
						method: "PUT",
						apiVersion: ""
					}, options),
					params,
					requiredParams: ["userId"],
					pathParams: ["userId"],
					context: this.context
				};
				if (callback) (0, googleapis_common_1.createAPIRequest)(parameters, callback);
				else return (0, googleapis_common_1.createAPIRequest)(parameters);
			}
		}
		gmail_v1.Resource$Users$Settings = Resource$Users$Settings;
		class Resource$Users$Settings$Cse {
			context;
			identities;
			keypairs;
			constructor(context) {
				this.context = context;
				this.identities = new Resource$Users$Settings$Cse$Identities(this.context);
				this.keypairs = new Resource$Users$Settings$Cse$Keypairs(this.context);
			}
		}
		gmail_v1.Resource$Users$Settings$Cse = Resource$Users$Settings$Cse;
		class Resource$Users$Settings$Cse$Identities {
			context;
			constructor(context) {
				this.context = context;
			}
			create(paramsOrCallback, optionsOrCallback, callback) {
				let params = paramsOrCallback || {};
				let options = optionsOrCallback || {};
				if (typeof paramsOrCallback === "function") {
					callback = paramsOrCallback;
					params = {};
					options = {};
				}
				if (typeof optionsOrCallback === "function") {
					callback = optionsOrCallback;
					options = {};
				}
				const rootUrl = options.rootUrl || "https://gmail.googleapis.com/";
				const parameters = {
					options: Object.assign({
						url: (rootUrl + "/gmail/v1/users/{userId}/settings/cse/identities").replace(/([^:]\/)\/+/g, "$1"),
						method: "POST",
						apiVersion: ""
					}, options),
					params,
					requiredParams: ["userId"],
					pathParams: ["userId"],
					context: this.context
				};
				if (callback) (0, googleapis_common_1.createAPIRequest)(parameters, callback);
				else return (0, googleapis_common_1.createAPIRequest)(parameters);
			}
			delete(paramsOrCallback, optionsOrCallback, callback) {
				let params = paramsOrCallback || {};
				let options = optionsOrCallback || {};
				if (typeof paramsOrCallback === "function") {
					callback = paramsOrCallback;
					params = {};
					options = {};
				}
				if (typeof optionsOrCallback === "function") {
					callback = optionsOrCallback;
					options = {};
				}
				const rootUrl = options.rootUrl || "https://gmail.googleapis.com/";
				const parameters = {
					options: Object.assign({
						url: (rootUrl + "/gmail/v1/users/{userId}/settings/cse/identities/{cseEmailAddress}").replace(/([^:]\/)\/+/g, "$1"),
						method: "DELETE",
						apiVersion: ""
					}, options),
					params,
					requiredParams: ["userId", "cseEmailAddress"],
					pathParams: ["cseEmailAddress", "userId"],
					context: this.context
				};
				if (callback) (0, googleapis_common_1.createAPIRequest)(parameters, callback);
				else return (0, googleapis_common_1.createAPIRequest)(parameters);
			}
			get(paramsOrCallback, optionsOrCallback, callback) {
				let params = paramsOrCallback || {};
				let options = optionsOrCallback || {};
				if (typeof paramsOrCallback === "function") {
					callback = paramsOrCallback;
					params = {};
					options = {};
				}
				if (typeof optionsOrCallback === "function") {
					callback = optionsOrCallback;
					options = {};
				}
				const rootUrl = options.rootUrl || "https://gmail.googleapis.com/";
				const parameters = {
					options: Object.assign({
						url: (rootUrl + "/gmail/v1/users/{userId}/settings/cse/identities/{cseEmailAddress}").replace(/([^:]\/)\/+/g, "$1"),
						method: "GET",
						apiVersion: ""
					}, options),
					params,
					requiredParams: ["userId", "cseEmailAddress"],
					pathParams: ["cseEmailAddress", "userId"],
					context: this.context
				};
				if (callback) (0, googleapis_common_1.createAPIRequest)(parameters, callback);
				else return (0, googleapis_common_1.createAPIRequest)(parameters);
			}
			list(paramsOrCallback, optionsOrCallback, callback) {
				let params = paramsOrCallback || {};
				let options = optionsOrCallback || {};
				if (typeof paramsOrCallback === "function") {
					callback = paramsOrCallback;
					params = {};
					options = {};
				}
				if (typeof optionsOrCallback === "function") {
					callback = optionsOrCallback;
					options = {};
				}
				const rootUrl = options.rootUrl || "https://gmail.googleapis.com/";
				const parameters = {
					options: Object.assign({
						url: (rootUrl + "/gmail/v1/users/{userId}/settings/cse/identities").replace(/([^:]\/)\/+/g, "$1"),
						method: "GET",
						apiVersion: ""
					}, options),
					params,
					requiredParams: ["userId"],
					pathParams: ["userId"],
					context: this.context
				};
				if (callback) (0, googleapis_common_1.createAPIRequest)(parameters, callback);
				else return (0, googleapis_common_1.createAPIRequest)(parameters);
			}
			patch(paramsOrCallback, optionsOrCallback, callback) {
				let params = paramsOrCallback || {};
				let options = optionsOrCallback || {};
				if (typeof paramsOrCallback === "function") {
					callback = paramsOrCallback;
					params = {};
					options = {};
				}
				if (typeof optionsOrCallback === "function") {
					callback = optionsOrCallback;
					options = {};
				}
				const rootUrl = options.rootUrl || "https://gmail.googleapis.com/";
				const parameters = {
					options: Object.assign({
						url: (rootUrl + "/gmail/v1/users/{userId}/settings/cse/identities/{emailAddress}").replace(/([^:]\/)\/+/g, "$1"),
						method: "PATCH",
						apiVersion: ""
					}, options),
					params,
					requiredParams: ["userId", "emailAddress"],
					pathParams: ["emailAddress", "userId"],
					context: this.context
				};
				if (callback) (0, googleapis_common_1.createAPIRequest)(parameters, callback);
				else return (0, googleapis_common_1.createAPIRequest)(parameters);
			}
		}
		gmail_v1.Resource$Users$Settings$Cse$Identities = Resource$Users$Settings$Cse$Identities;
		class Resource$Users$Settings$Cse$Keypairs {
			context;
			constructor(context) {
				this.context = context;
			}
			create(paramsOrCallback, optionsOrCallback, callback) {
				let params = paramsOrCallback || {};
				let options = optionsOrCallback || {};
				if (typeof paramsOrCallback === "function") {
					callback = paramsOrCallback;
					params = {};
					options = {};
				}
				if (typeof optionsOrCallback === "function") {
					callback = optionsOrCallback;
					options = {};
				}
				const rootUrl = options.rootUrl || "https://gmail.googleapis.com/";
				const parameters = {
					options: Object.assign({
						url: (rootUrl + "/gmail/v1/users/{userId}/settings/cse/keypairs").replace(/([^:]\/)\/+/g, "$1"),
						method: "POST",
						apiVersion: ""
					}, options),
					params,
					requiredParams: ["userId"],
					pathParams: ["userId"],
					context: this.context
				};
				if (callback) (0, googleapis_common_1.createAPIRequest)(parameters, callback);
				else return (0, googleapis_common_1.createAPIRequest)(parameters);
			}
			disable(paramsOrCallback, optionsOrCallback, callback) {
				let params = paramsOrCallback || {};
				let options = optionsOrCallback || {};
				if (typeof paramsOrCallback === "function") {
					callback = paramsOrCallback;
					params = {};
					options = {};
				}
				if (typeof optionsOrCallback === "function") {
					callback = optionsOrCallback;
					options = {};
				}
				const rootUrl = options.rootUrl || "https://gmail.googleapis.com/";
				const parameters = {
					options: Object.assign({
						url: (rootUrl + "/gmail/v1/users/{userId}/settings/cse/keypairs/{keyPairId}:disable").replace(/([^:]\/)\/+/g, "$1"),
						method: "POST",
						apiVersion: ""
					}, options),
					params,
					requiredParams: ["userId", "keyPairId"],
					pathParams: ["keyPairId", "userId"],
					context: this.context
				};
				if (callback) (0, googleapis_common_1.createAPIRequest)(parameters, callback);
				else return (0, googleapis_common_1.createAPIRequest)(parameters);
			}
			enable(paramsOrCallback, optionsOrCallback, callback) {
				let params = paramsOrCallback || {};
				let options = optionsOrCallback || {};
				if (typeof paramsOrCallback === "function") {
					callback = paramsOrCallback;
					params = {};
					options = {};
				}
				if (typeof optionsOrCallback === "function") {
					callback = optionsOrCallback;
					options = {};
				}
				const rootUrl = options.rootUrl || "https://gmail.googleapis.com/";
				const parameters = {
					options: Object.assign({
						url: (rootUrl + "/gmail/v1/users/{userId}/settings/cse/keypairs/{keyPairId}:enable").replace(/([^:]\/)\/+/g, "$1"),
						method: "POST",
						apiVersion: ""
					}, options),
					params,
					requiredParams: ["userId", "keyPairId"],
					pathParams: ["keyPairId", "userId"],
					context: this.context
				};
				if (callback) (0, googleapis_common_1.createAPIRequest)(parameters, callback);
				else return (0, googleapis_common_1.createAPIRequest)(parameters);
			}
			get(paramsOrCallback, optionsOrCallback, callback) {
				let params = paramsOrCallback || {};
				let options = optionsOrCallback || {};
				if (typeof paramsOrCallback === "function") {
					callback = paramsOrCallback;
					params = {};
					options = {};
				}
				if (typeof optionsOrCallback === "function") {
					callback = optionsOrCallback;
					options = {};
				}
				const rootUrl = options.rootUrl || "https://gmail.googleapis.com/";
				const parameters = {
					options: Object.assign({
						url: (rootUrl + "/gmail/v1/users/{userId}/settings/cse/keypairs/{keyPairId}").replace(/([^:]\/)\/+/g, "$1"),
						method: "GET",
						apiVersion: ""
					}, options),
					params,
					requiredParams: ["userId", "keyPairId"],
					pathParams: ["keyPairId", "userId"],
					context: this.context
				};
				if (callback) (0, googleapis_common_1.createAPIRequest)(parameters, callback);
				else return (0, googleapis_common_1.createAPIRequest)(parameters);
			}
			list(paramsOrCallback, optionsOrCallback, callback) {
				let params = paramsOrCallback || {};
				let options = optionsOrCallback || {};
				if (typeof paramsOrCallback === "function") {
					callback = paramsOrCallback;
					params = {};
					options = {};
				}
				if (typeof optionsOrCallback === "function") {
					callback = optionsOrCallback;
					options = {};
				}
				const rootUrl = options.rootUrl || "https://gmail.googleapis.com/";
				const parameters = {
					options: Object.assign({
						url: (rootUrl + "/gmail/v1/users/{userId}/settings/cse/keypairs").replace(/([^:]\/)\/+/g, "$1"),
						method: "GET",
						apiVersion: ""
					}, options),
					params,
					requiredParams: ["userId"],
					pathParams: ["userId"],
					context: this.context
				};
				if (callback) (0, googleapis_common_1.createAPIRequest)(parameters, callback);
				else return (0, googleapis_common_1.createAPIRequest)(parameters);
			}
			obliterate(paramsOrCallback, optionsOrCallback, callback) {
				let params = paramsOrCallback || {};
				let options = optionsOrCallback || {};
				if (typeof paramsOrCallback === "function") {
					callback = paramsOrCallback;
					params = {};
					options = {};
				}
				if (typeof optionsOrCallback === "function") {
					callback = optionsOrCallback;
					options = {};
				}
				const rootUrl = options.rootUrl || "https://gmail.googleapis.com/";
				const parameters = {
					options: Object.assign({
						url: (rootUrl + "/gmail/v1/users/{userId}/settings/cse/keypairs/{keyPairId}:obliterate").replace(/([^:]\/)\/+/g, "$1"),
						method: "POST",
						apiVersion: ""
					}, options),
					params,
					requiredParams: ["userId", "keyPairId"],
					pathParams: ["keyPairId", "userId"],
					context: this.context
				};
				if (callback) (0, googleapis_common_1.createAPIRequest)(parameters, callback);
				else return (0, googleapis_common_1.createAPIRequest)(parameters);
			}
		}
		gmail_v1.Resource$Users$Settings$Cse$Keypairs = Resource$Users$Settings$Cse$Keypairs;
		class Resource$Users$Settings$Delegates {
			context;
			constructor(context) {
				this.context = context;
			}
			create(paramsOrCallback, optionsOrCallback, callback) {
				let params = paramsOrCallback || {};
				let options = optionsOrCallback || {};
				if (typeof paramsOrCallback === "function") {
					callback = paramsOrCallback;
					params = {};
					options = {};
				}
				if (typeof optionsOrCallback === "function") {
					callback = optionsOrCallback;
					options = {};
				}
				const rootUrl = options.rootUrl || "https://gmail.googleapis.com/";
				const parameters = {
					options: Object.assign({
						url: (rootUrl + "/gmail/v1/users/{userId}/settings/delegates").replace(/([^:]\/)\/+/g, "$1"),
						method: "POST",
						apiVersion: ""
					}, options),
					params,
					requiredParams: ["userId"],
					pathParams: ["userId"],
					context: this.context
				};
				if (callback) (0, googleapis_common_1.createAPIRequest)(parameters, callback);
				else return (0, googleapis_common_1.createAPIRequest)(parameters);
			}
			delete(paramsOrCallback, optionsOrCallback, callback) {
				let params = paramsOrCallback || {};
				let options = optionsOrCallback || {};
				if (typeof paramsOrCallback === "function") {
					callback = paramsOrCallback;
					params = {};
					options = {};
				}
				if (typeof optionsOrCallback === "function") {
					callback = optionsOrCallback;
					options = {};
				}
				const rootUrl = options.rootUrl || "https://gmail.googleapis.com/";
				const parameters = {
					options: Object.assign({
						url: (rootUrl + "/gmail/v1/users/{userId}/settings/delegates/{delegateEmail}").replace(/([^:]\/)\/+/g, "$1"),
						method: "DELETE",
						apiVersion: ""
					}, options),
					params,
					requiredParams: ["userId", "delegateEmail"],
					pathParams: ["delegateEmail", "userId"],
					context: this.context
				};
				if (callback) (0, googleapis_common_1.createAPIRequest)(parameters, callback);
				else return (0, googleapis_common_1.createAPIRequest)(parameters);
			}
			get(paramsOrCallback, optionsOrCallback, callback) {
				let params = paramsOrCallback || {};
				let options = optionsOrCallback || {};
				if (typeof paramsOrCallback === "function") {
					callback = paramsOrCallback;
					params = {};
					options = {};
				}
				if (typeof optionsOrCallback === "function") {
					callback = optionsOrCallback;
					options = {};
				}
				const rootUrl = options.rootUrl || "https://gmail.googleapis.com/";
				const parameters = {
					options: Object.assign({
						url: (rootUrl + "/gmail/v1/users/{userId}/settings/delegates/{delegateEmail}").replace(/([^:]\/)\/+/g, "$1"),
						method: "GET",
						apiVersion: ""
					}, options),
					params,
					requiredParams: ["userId", "delegateEmail"],
					pathParams: ["delegateEmail", "userId"],
					context: this.context
				};
				if (callback) (0, googleapis_common_1.createAPIRequest)(parameters, callback);
				else return (0, googleapis_common_1.createAPIRequest)(parameters);
			}
			list(paramsOrCallback, optionsOrCallback, callback) {
				let params = paramsOrCallback || {};
				let options = optionsOrCallback || {};
				if (typeof paramsOrCallback === "function") {
					callback = paramsOrCallback;
					params = {};
					options = {};
				}
				if (typeof optionsOrCallback === "function") {
					callback = optionsOrCallback;
					options = {};
				}
				const rootUrl = options.rootUrl || "https://gmail.googleapis.com/";
				const parameters = {
					options: Object.assign({
						url: (rootUrl + "/gmail/v1/users/{userId}/settings/delegates").replace(/([^:]\/)\/+/g, "$1"),
						method: "GET",
						apiVersion: ""
					}, options),
					params,
					requiredParams: ["userId"],
					pathParams: ["userId"],
					context: this.context
				};
				if (callback) (0, googleapis_common_1.createAPIRequest)(parameters, callback);
				else return (0, googleapis_common_1.createAPIRequest)(parameters);
			}
		}
		gmail_v1.Resource$Users$Settings$Delegates = Resource$Users$Settings$Delegates;
		class Resource$Users$Settings$Filters {
			context;
			constructor(context) {
				this.context = context;
			}
			create(paramsOrCallback, optionsOrCallback, callback) {
				let params = paramsOrCallback || {};
				let options = optionsOrCallback || {};
				if (typeof paramsOrCallback === "function") {
					callback = paramsOrCallback;
					params = {};
					options = {};
				}
				if (typeof optionsOrCallback === "function") {
					callback = optionsOrCallback;
					options = {};
				}
				const rootUrl = options.rootUrl || "https://gmail.googleapis.com/";
				const parameters = {
					options: Object.assign({
						url: (rootUrl + "/gmail/v1/users/{userId}/settings/filters").replace(/([^:]\/)\/+/g, "$1"),
						method: "POST",
						apiVersion: ""
					}, options),
					params,
					requiredParams: ["userId"],
					pathParams: ["userId"],
					context: this.context
				};
				if (callback) (0, googleapis_common_1.createAPIRequest)(parameters, callback);
				else return (0, googleapis_common_1.createAPIRequest)(parameters);
			}
			delete(paramsOrCallback, optionsOrCallback, callback) {
				let params = paramsOrCallback || {};
				let options = optionsOrCallback || {};
				if (typeof paramsOrCallback === "function") {
					callback = paramsOrCallback;
					params = {};
					options = {};
				}
				if (typeof optionsOrCallback === "function") {
					callback = optionsOrCallback;
					options = {};
				}
				const rootUrl = options.rootUrl || "https://gmail.googleapis.com/";
				const parameters = {
					options: Object.assign({
						url: (rootUrl + "/gmail/v1/users/{userId}/settings/filters/{id}").replace(/([^:]\/)\/+/g, "$1"),
						method: "DELETE",
						apiVersion: ""
					}, options),
					params,
					requiredParams: ["userId", "id"],
					pathParams: ["id", "userId"],
					context: this.context
				};
				if (callback) (0, googleapis_common_1.createAPIRequest)(parameters, callback);
				else return (0, googleapis_common_1.createAPIRequest)(parameters);
			}
			get(paramsOrCallback, optionsOrCallback, callback) {
				let params = paramsOrCallback || {};
				let options = optionsOrCallback || {};
				if (typeof paramsOrCallback === "function") {
					callback = paramsOrCallback;
					params = {};
					options = {};
				}
				if (typeof optionsOrCallback === "function") {
					callback = optionsOrCallback;
					options = {};
				}
				const rootUrl = options.rootUrl || "https://gmail.googleapis.com/";
				const parameters = {
					options: Object.assign({
						url: (rootUrl + "/gmail/v1/users/{userId}/settings/filters/{id}").replace(/([^:]\/)\/+/g, "$1"),
						method: "GET",
						apiVersion: ""
					}, options),
					params,
					requiredParams: ["userId", "id"],
					pathParams: ["id", "userId"],
					context: this.context
				};
				if (callback) (0, googleapis_common_1.createAPIRequest)(parameters, callback);
				else return (0, googleapis_common_1.createAPIRequest)(parameters);
			}
			list(paramsOrCallback, optionsOrCallback, callback) {
				let params = paramsOrCallback || {};
				let options = optionsOrCallback || {};
				if (typeof paramsOrCallback === "function") {
					callback = paramsOrCallback;
					params = {};
					options = {};
				}
				if (typeof optionsOrCallback === "function") {
					callback = optionsOrCallback;
					options = {};
				}
				const rootUrl = options.rootUrl || "https://gmail.googleapis.com/";
				const parameters = {
					options: Object.assign({
						url: (rootUrl + "/gmail/v1/users/{userId}/settings/filters").replace(/([^:]\/)\/+/g, "$1"),
						method: "GET",
						apiVersion: ""
					}, options),
					params,
					requiredParams: ["userId"],
					pathParams: ["userId"],
					context: this.context
				};
				if (callback) (0, googleapis_common_1.createAPIRequest)(parameters, callback);
				else return (0, googleapis_common_1.createAPIRequest)(parameters);
			}
		}
		gmail_v1.Resource$Users$Settings$Filters = Resource$Users$Settings$Filters;
		class Resource$Users$Settings$Forwardingaddresses {
			context;
			constructor(context) {
				this.context = context;
			}
			create(paramsOrCallback, optionsOrCallback, callback) {
				let params = paramsOrCallback || {};
				let options = optionsOrCallback || {};
				if (typeof paramsOrCallback === "function") {
					callback = paramsOrCallback;
					params = {};
					options = {};
				}
				if (typeof optionsOrCallback === "function") {
					callback = optionsOrCallback;
					options = {};
				}
				const rootUrl = options.rootUrl || "https://gmail.googleapis.com/";
				const parameters = {
					options: Object.assign({
						url: (rootUrl + "/gmail/v1/users/{userId}/settings/forwardingAddresses").replace(/([^:]\/)\/+/g, "$1"),
						method: "POST",
						apiVersion: ""
					}, options),
					params,
					requiredParams: ["userId"],
					pathParams: ["userId"],
					context: this.context
				};
				if (callback) (0, googleapis_common_1.createAPIRequest)(parameters, callback);
				else return (0, googleapis_common_1.createAPIRequest)(parameters);
			}
			delete(paramsOrCallback, optionsOrCallback, callback) {
				let params = paramsOrCallback || {};
				let options = optionsOrCallback || {};
				if (typeof paramsOrCallback === "function") {
					callback = paramsOrCallback;
					params = {};
					options = {};
				}
				if (typeof optionsOrCallback === "function") {
					callback = optionsOrCallback;
					options = {};
				}
				const rootUrl = options.rootUrl || "https://gmail.googleapis.com/";
				const parameters = {
					options: Object.assign({
						url: (rootUrl + "/gmail/v1/users/{userId}/settings/forwardingAddresses/{forwardingEmail}").replace(/([^:]\/)\/+/g, "$1"),
						method: "DELETE",
						apiVersion: ""
					}, options),
					params,
					requiredParams: ["userId", "forwardingEmail"],
					pathParams: ["forwardingEmail", "userId"],
					context: this.context
				};
				if (callback) (0, googleapis_common_1.createAPIRequest)(parameters, callback);
				else return (0, googleapis_common_1.createAPIRequest)(parameters);
			}
			get(paramsOrCallback, optionsOrCallback, callback) {
				let params = paramsOrCallback || {};
				let options = optionsOrCallback || {};
				if (typeof paramsOrCallback === "function") {
					callback = paramsOrCallback;
					params = {};
					options = {};
				}
				if (typeof optionsOrCallback === "function") {
					callback = optionsOrCallback;
					options = {};
				}
				const rootUrl = options.rootUrl || "https://gmail.googleapis.com/";
				const parameters = {
					options: Object.assign({
						url: (rootUrl + "/gmail/v1/users/{userId}/settings/forwardingAddresses/{forwardingEmail}").replace(/([^:]\/)\/+/g, "$1"),
						method: "GET",
						apiVersion: ""
					}, options),
					params,
					requiredParams: ["userId", "forwardingEmail"],
					pathParams: ["forwardingEmail", "userId"],
					context: this.context
				};
				if (callback) (0, googleapis_common_1.createAPIRequest)(parameters, callback);
				else return (0, googleapis_common_1.createAPIRequest)(parameters);
			}
			list(paramsOrCallback, optionsOrCallback, callback) {
				let params = paramsOrCallback || {};
				let options = optionsOrCallback || {};
				if (typeof paramsOrCallback === "function") {
					callback = paramsOrCallback;
					params = {};
					options = {};
				}
				if (typeof optionsOrCallback === "function") {
					callback = optionsOrCallback;
					options = {};
				}
				const rootUrl = options.rootUrl || "https://gmail.googleapis.com/";
				const parameters = {
					options: Object.assign({
						url: (rootUrl + "/gmail/v1/users/{userId}/settings/forwardingAddresses").replace(/([^:]\/)\/+/g, "$1"),
						method: "GET",
						apiVersion: ""
					}, options),
					params,
					requiredParams: ["userId"],
					pathParams: ["userId"],
					context: this.context
				};
				if (callback) (0, googleapis_common_1.createAPIRequest)(parameters, callback);
				else return (0, googleapis_common_1.createAPIRequest)(parameters);
			}
		}
		gmail_v1.Resource$Users$Settings$Forwardingaddresses = Resource$Users$Settings$Forwardingaddresses;
		class Resource$Users$Settings$Sendas {
			context;
			smimeInfo;
			constructor(context) {
				this.context = context;
				this.smimeInfo = new Resource$Users$Settings$Sendas$Smimeinfo(this.context);
			}
			create(paramsOrCallback, optionsOrCallback, callback) {
				let params = paramsOrCallback || {};
				let options = optionsOrCallback || {};
				if (typeof paramsOrCallback === "function") {
					callback = paramsOrCallback;
					params = {};
					options = {};
				}
				if (typeof optionsOrCallback === "function") {
					callback = optionsOrCallback;
					options = {};
				}
				const rootUrl = options.rootUrl || "https://gmail.googleapis.com/";
				const parameters = {
					options: Object.assign({
						url: (rootUrl + "/gmail/v1/users/{userId}/settings/sendAs").replace(/([^:]\/)\/+/g, "$1"),
						method: "POST",
						apiVersion: ""
					}, options),
					params,
					requiredParams: ["userId"],
					pathParams: ["userId"],
					context: this.context
				};
				if (callback) (0, googleapis_common_1.createAPIRequest)(parameters, callback);
				else return (0, googleapis_common_1.createAPIRequest)(parameters);
			}
			delete(paramsOrCallback, optionsOrCallback, callback) {
				let params = paramsOrCallback || {};
				let options = optionsOrCallback || {};
				if (typeof paramsOrCallback === "function") {
					callback = paramsOrCallback;
					params = {};
					options = {};
				}
				if (typeof optionsOrCallback === "function") {
					callback = optionsOrCallback;
					options = {};
				}
				const rootUrl = options.rootUrl || "https://gmail.googleapis.com/";
				const parameters = {
					options: Object.assign({
						url: (rootUrl + "/gmail/v1/users/{userId}/settings/sendAs/{sendAsEmail}").replace(/([^:]\/)\/+/g, "$1"),
						method: "DELETE",
						apiVersion: ""
					}, options),
					params,
					requiredParams: ["userId", "sendAsEmail"],
					pathParams: ["sendAsEmail", "userId"],
					context: this.context
				};
				if (callback) (0, googleapis_common_1.createAPIRequest)(parameters, callback);
				else return (0, googleapis_common_1.createAPIRequest)(parameters);
			}
			get(paramsOrCallback, optionsOrCallback, callback) {
				let params = paramsOrCallback || {};
				let options = optionsOrCallback || {};
				if (typeof paramsOrCallback === "function") {
					callback = paramsOrCallback;
					params = {};
					options = {};
				}
				if (typeof optionsOrCallback === "function") {
					callback = optionsOrCallback;
					options = {};
				}
				const rootUrl = options.rootUrl || "https://gmail.googleapis.com/";
				const parameters = {
					options: Object.assign({
						url: (rootUrl + "/gmail/v1/users/{userId}/settings/sendAs/{sendAsEmail}").replace(/([^:]\/)\/+/g, "$1"),
						method: "GET",
						apiVersion: ""
					}, options),
					params,
					requiredParams: ["userId", "sendAsEmail"],
					pathParams: ["sendAsEmail", "userId"],
					context: this.context
				};
				if (callback) (0, googleapis_common_1.createAPIRequest)(parameters, callback);
				else return (0, googleapis_common_1.createAPIRequest)(parameters);
			}
			list(paramsOrCallback, optionsOrCallback, callback) {
				let params = paramsOrCallback || {};
				let options = optionsOrCallback || {};
				if (typeof paramsOrCallback === "function") {
					callback = paramsOrCallback;
					params = {};
					options = {};
				}
				if (typeof optionsOrCallback === "function") {
					callback = optionsOrCallback;
					options = {};
				}
				const rootUrl = options.rootUrl || "https://gmail.googleapis.com/";
				const parameters = {
					options: Object.assign({
						url: (rootUrl + "/gmail/v1/users/{userId}/settings/sendAs").replace(/([^:]\/)\/+/g, "$1"),
						method: "GET",
						apiVersion: ""
					}, options),
					params,
					requiredParams: ["userId"],
					pathParams: ["userId"],
					context: this.context
				};
				if (callback) (0, googleapis_common_1.createAPIRequest)(parameters, callback);
				else return (0, googleapis_common_1.createAPIRequest)(parameters);
			}
			patch(paramsOrCallback, optionsOrCallback, callback) {
				let params = paramsOrCallback || {};
				let options = optionsOrCallback || {};
				if (typeof paramsOrCallback === "function") {
					callback = paramsOrCallback;
					params = {};
					options = {};
				}
				if (typeof optionsOrCallback === "function") {
					callback = optionsOrCallback;
					options = {};
				}
				const rootUrl = options.rootUrl || "https://gmail.googleapis.com/";
				const parameters = {
					options: Object.assign({
						url: (rootUrl + "/gmail/v1/users/{userId}/settings/sendAs/{sendAsEmail}").replace(/([^:]\/)\/+/g, "$1"),
						method: "PATCH",
						apiVersion: ""
					}, options),
					params,
					requiredParams: ["userId", "sendAsEmail"],
					pathParams: ["sendAsEmail", "userId"],
					context: this.context
				};
				if (callback) (0, googleapis_common_1.createAPIRequest)(parameters, callback);
				else return (0, googleapis_common_1.createAPIRequest)(parameters);
			}
			update(paramsOrCallback, optionsOrCallback, callback) {
				let params = paramsOrCallback || {};
				let options = optionsOrCallback || {};
				if (typeof paramsOrCallback === "function") {
					callback = paramsOrCallback;
					params = {};
					options = {};
				}
				if (typeof optionsOrCallback === "function") {
					callback = optionsOrCallback;
					options = {};
				}
				const rootUrl = options.rootUrl || "https://gmail.googleapis.com/";
				const parameters = {
					options: Object.assign({
						url: (rootUrl + "/gmail/v1/users/{userId}/settings/sendAs/{sendAsEmail}").replace(/([^:]\/)\/+/g, "$1"),
						method: "PUT",
						apiVersion: ""
					}, options),
					params,
					requiredParams: ["userId", "sendAsEmail"],
					pathParams: ["sendAsEmail", "userId"],
					context: this.context
				};
				if (callback) (0, googleapis_common_1.createAPIRequest)(parameters, callback);
				else return (0, googleapis_common_1.createAPIRequest)(parameters);
			}
			verify(paramsOrCallback, optionsOrCallback, callback) {
				let params = paramsOrCallback || {};
				let options = optionsOrCallback || {};
				if (typeof paramsOrCallback === "function") {
					callback = paramsOrCallback;
					params = {};
					options = {};
				}
				if (typeof optionsOrCallback === "function") {
					callback = optionsOrCallback;
					options = {};
				}
				const rootUrl = options.rootUrl || "https://gmail.googleapis.com/";
				const parameters = {
					options: Object.assign({
						url: (rootUrl + "/gmail/v1/users/{userId}/settings/sendAs/{sendAsEmail}/verify").replace(/([^:]\/)\/+/g, "$1"),
						method: "POST",
						apiVersion: ""
					}, options),
					params,
					requiredParams: ["userId", "sendAsEmail"],
					pathParams: ["sendAsEmail", "userId"],
					context: this.context
				};
				if (callback) (0, googleapis_common_1.createAPIRequest)(parameters, callback);
				else return (0, googleapis_common_1.createAPIRequest)(parameters);
			}
		}
		gmail_v1.Resource$Users$Settings$Sendas = Resource$Users$Settings$Sendas;
		class Resource$Users$Settings$Sendas$Smimeinfo {
			context;
			constructor(context) {
				this.context = context;
			}
			delete(paramsOrCallback, optionsOrCallback, callback) {
				let params = paramsOrCallback || {};
				let options = optionsOrCallback || {};
				if (typeof paramsOrCallback === "function") {
					callback = paramsOrCallback;
					params = {};
					options = {};
				}
				if (typeof optionsOrCallback === "function") {
					callback = optionsOrCallback;
					options = {};
				}
				const rootUrl = options.rootUrl || "https://gmail.googleapis.com/";
				const parameters = {
					options: Object.assign({
						url: (rootUrl + "/gmail/v1/users/{userId}/settings/sendAs/{sendAsEmail}/smimeInfo/{id}").replace(/([^:]\/)\/+/g, "$1"),
						method: "DELETE",
						apiVersion: ""
					}, options),
					params,
					requiredParams: [
						"userId",
						"sendAsEmail",
						"id"
					],
					pathParams: [
						"id",
						"sendAsEmail",
						"userId"
					],
					context: this.context
				};
				if (callback) (0, googleapis_common_1.createAPIRequest)(parameters, callback);
				else return (0, googleapis_common_1.createAPIRequest)(parameters);
			}
			get(paramsOrCallback, optionsOrCallback, callback) {
				let params = paramsOrCallback || {};
				let options = optionsOrCallback || {};
				if (typeof paramsOrCallback === "function") {
					callback = paramsOrCallback;
					params = {};
					options = {};
				}
				if (typeof optionsOrCallback === "function") {
					callback = optionsOrCallback;
					options = {};
				}
				const rootUrl = options.rootUrl || "https://gmail.googleapis.com/";
				const parameters = {
					options: Object.assign({
						url: (rootUrl + "/gmail/v1/users/{userId}/settings/sendAs/{sendAsEmail}/smimeInfo/{id}").replace(/([^:]\/)\/+/g, "$1"),
						method: "GET",
						apiVersion: ""
					}, options),
					params,
					requiredParams: [
						"userId",
						"sendAsEmail",
						"id"
					],
					pathParams: [
						"id",
						"sendAsEmail",
						"userId"
					],
					context: this.context
				};
				if (callback) (0, googleapis_common_1.createAPIRequest)(parameters, callback);
				else return (0, googleapis_common_1.createAPIRequest)(parameters);
			}
			insert(paramsOrCallback, optionsOrCallback, callback) {
				let params = paramsOrCallback || {};
				let options = optionsOrCallback || {};
				if (typeof paramsOrCallback === "function") {
					callback = paramsOrCallback;
					params = {};
					options = {};
				}
				if (typeof optionsOrCallback === "function") {
					callback = optionsOrCallback;
					options = {};
				}
				const rootUrl = options.rootUrl || "https://gmail.googleapis.com/";
				const parameters = {
					options: Object.assign({
						url: (rootUrl + "/gmail/v1/users/{userId}/settings/sendAs/{sendAsEmail}/smimeInfo").replace(/([^:]\/)\/+/g, "$1"),
						method: "POST",
						apiVersion: ""
					}, options),
					params,
					requiredParams: ["userId", "sendAsEmail"],
					pathParams: ["sendAsEmail", "userId"],
					context: this.context
				};
				if (callback) (0, googleapis_common_1.createAPIRequest)(parameters, callback);
				else return (0, googleapis_common_1.createAPIRequest)(parameters);
			}
			list(paramsOrCallback, optionsOrCallback, callback) {
				let params = paramsOrCallback || {};
				let options = optionsOrCallback || {};
				if (typeof paramsOrCallback === "function") {
					callback = paramsOrCallback;
					params = {};
					options = {};
				}
				if (typeof optionsOrCallback === "function") {
					callback = optionsOrCallback;
					options = {};
				}
				const rootUrl = options.rootUrl || "https://gmail.googleapis.com/";
				const parameters = {
					options: Object.assign({
						url: (rootUrl + "/gmail/v1/users/{userId}/settings/sendAs/{sendAsEmail}/smimeInfo").replace(/([^:]\/)\/+/g, "$1"),
						method: "GET",
						apiVersion: ""
					}, options),
					params,
					requiredParams: ["userId", "sendAsEmail"],
					pathParams: ["sendAsEmail", "userId"],
					context: this.context
				};
				if (callback) (0, googleapis_common_1.createAPIRequest)(parameters, callback);
				else return (0, googleapis_common_1.createAPIRequest)(parameters);
			}
			setDefault(paramsOrCallback, optionsOrCallback, callback) {
				let params = paramsOrCallback || {};
				let options = optionsOrCallback || {};
				if (typeof paramsOrCallback === "function") {
					callback = paramsOrCallback;
					params = {};
					options = {};
				}
				if (typeof optionsOrCallback === "function") {
					callback = optionsOrCallback;
					options = {};
				}
				const rootUrl = options.rootUrl || "https://gmail.googleapis.com/";
				const parameters = {
					options: Object.assign({
						url: (rootUrl + "/gmail/v1/users/{userId}/settings/sendAs/{sendAsEmail}/smimeInfo/{id}/setDefault").replace(/([^:]\/)\/+/g, "$1"),
						method: "POST",
						apiVersion: ""
					}, options),
					params,
					requiredParams: [
						"userId",
						"sendAsEmail",
						"id"
					],
					pathParams: [
						"id",
						"sendAsEmail",
						"userId"
					],
					context: this.context
				};
				if (callback) (0, googleapis_common_1.createAPIRequest)(parameters, callback);
				else return (0, googleapis_common_1.createAPIRequest)(parameters);
			}
		}
		gmail_v1.Resource$Users$Settings$Sendas$Smimeinfo = Resource$Users$Settings$Sendas$Smimeinfo;
		class Resource$Users$Threads {
			context;
			constructor(context) {
				this.context = context;
			}
			delete(paramsOrCallback, optionsOrCallback, callback) {
				let params = paramsOrCallback || {};
				let options = optionsOrCallback || {};
				if (typeof paramsOrCallback === "function") {
					callback = paramsOrCallback;
					params = {};
					options = {};
				}
				if (typeof optionsOrCallback === "function") {
					callback = optionsOrCallback;
					options = {};
				}
				const rootUrl = options.rootUrl || "https://gmail.googleapis.com/";
				const parameters = {
					options: Object.assign({
						url: (rootUrl + "/gmail/v1/users/{userId}/threads/{id}").replace(/([^:]\/)\/+/g, "$1"),
						method: "DELETE",
						apiVersion: ""
					}, options),
					params,
					requiredParams: ["userId", "id"],
					pathParams: ["id", "userId"],
					context: this.context
				};
				if (callback) (0, googleapis_common_1.createAPIRequest)(parameters, callback);
				else return (0, googleapis_common_1.createAPIRequest)(parameters);
			}
			get(paramsOrCallback, optionsOrCallback, callback) {
				let params = paramsOrCallback || {};
				let options = optionsOrCallback || {};
				if (typeof paramsOrCallback === "function") {
					callback = paramsOrCallback;
					params = {};
					options = {};
				}
				if (typeof optionsOrCallback === "function") {
					callback = optionsOrCallback;
					options = {};
				}
				const rootUrl = options.rootUrl || "https://gmail.googleapis.com/";
				const parameters = {
					options: Object.assign({
						url: (rootUrl + "/gmail/v1/users/{userId}/threads/{id}").replace(/([^:]\/)\/+/g, "$1"),
						method: "GET",
						apiVersion: ""
					}, options),
					params,
					requiredParams: ["userId", "id"],
					pathParams: ["id", "userId"],
					context: this.context
				};
				if (callback) (0, googleapis_common_1.createAPIRequest)(parameters, callback);
				else return (0, googleapis_common_1.createAPIRequest)(parameters);
			}
			list(paramsOrCallback, optionsOrCallback, callback) {
				let params = paramsOrCallback || {};
				let options = optionsOrCallback || {};
				if (typeof paramsOrCallback === "function") {
					callback = paramsOrCallback;
					params = {};
					options = {};
				}
				if (typeof optionsOrCallback === "function") {
					callback = optionsOrCallback;
					options = {};
				}
				const rootUrl = options.rootUrl || "https://gmail.googleapis.com/";
				const parameters = {
					options: Object.assign({
						url: (rootUrl + "/gmail/v1/users/{userId}/threads").replace(/([^:]\/)\/+/g, "$1"),
						method: "GET",
						apiVersion: ""
					}, options),
					params,
					requiredParams: ["userId"],
					pathParams: ["userId"],
					context: this.context
				};
				if (callback) (0, googleapis_common_1.createAPIRequest)(parameters, callback);
				else return (0, googleapis_common_1.createAPIRequest)(parameters);
			}
			modify(paramsOrCallback, optionsOrCallback, callback) {
				let params = paramsOrCallback || {};
				let options = optionsOrCallback || {};
				if (typeof paramsOrCallback === "function") {
					callback = paramsOrCallback;
					params = {};
					options = {};
				}
				if (typeof optionsOrCallback === "function") {
					callback = optionsOrCallback;
					options = {};
				}
				const rootUrl = options.rootUrl || "https://gmail.googleapis.com/";
				const parameters = {
					options: Object.assign({
						url: (rootUrl + "/gmail/v1/users/{userId}/threads/{id}/modify").replace(/([^:]\/)\/+/g, "$1"),
						method: "POST",
						apiVersion: ""
					}, options),
					params,
					requiredParams: ["userId", "id"],
					pathParams: ["id", "userId"],
					context: this.context
				};
				if (callback) (0, googleapis_common_1.createAPIRequest)(parameters, callback);
				else return (0, googleapis_common_1.createAPIRequest)(parameters);
			}
			trash(paramsOrCallback, optionsOrCallback, callback) {
				let params = paramsOrCallback || {};
				let options = optionsOrCallback || {};
				if (typeof paramsOrCallback === "function") {
					callback = paramsOrCallback;
					params = {};
					options = {};
				}
				if (typeof optionsOrCallback === "function") {
					callback = optionsOrCallback;
					options = {};
				}
				const rootUrl = options.rootUrl || "https://gmail.googleapis.com/";
				const parameters = {
					options: Object.assign({
						url: (rootUrl + "/gmail/v1/users/{userId}/threads/{id}/trash").replace(/([^:]\/)\/+/g, "$1"),
						method: "POST",
						apiVersion: ""
					}, options),
					params,
					requiredParams: ["userId", "id"],
					pathParams: ["id", "userId"],
					context: this.context
				};
				if (callback) (0, googleapis_common_1.createAPIRequest)(parameters, callback);
				else return (0, googleapis_common_1.createAPIRequest)(parameters);
			}
			untrash(paramsOrCallback, optionsOrCallback, callback) {
				let params = paramsOrCallback || {};
				let options = optionsOrCallback || {};
				if (typeof paramsOrCallback === "function") {
					callback = paramsOrCallback;
					params = {};
					options = {};
				}
				if (typeof optionsOrCallback === "function") {
					callback = optionsOrCallback;
					options = {};
				}
				const rootUrl = options.rootUrl || "https://gmail.googleapis.com/";
				const parameters = {
					options: Object.assign({
						url: (rootUrl + "/gmail/v1/users/{userId}/threads/{id}/untrash").replace(/([^:]\/)\/+/g, "$1"),
						method: "POST",
						apiVersion: ""
					}, options),
					params,
					requiredParams: ["userId", "id"],
					pathParams: ["id", "userId"],
					context: this.context
				};
				if (callback) (0, googleapis_common_1.createAPIRequest)(parameters, callback);
				else return (0, googleapis_common_1.createAPIRequest)(parameters);
			}
		}
		gmail_v1.Resource$Users$Threads = Resource$Users$Threads;
	})(gmail_v1 || (exports.gmail_v1 = gmail_v1 = {}));
}));
//#endregion
//#region ../../node_modules/.pnpm/@googleapis+gmail@22.0.0/node_modules/@googleapis/gmail/build/index.js
var require_build$1 = /* @__PURE__ */ __commonJSMin(((exports) => {
	Object.defineProperty(exports, "__esModule", { value: true });
	exports.AuthPlus = exports.gmail_v1 = exports.auth = exports.VERSIONS = void 0;
	exports.gmail = gmail;
	/*! THIS FILE IS AUTO-GENERATED */
	const googleapis_common_1 = require_src();
	const v1_1 = require_v1$1();
	Object.defineProperty(exports, "gmail_v1", {
		enumerable: true,
		get: function() {
			return v1_1.gmail_v1;
		}
	});
	exports.VERSIONS = { v1: v1_1.gmail_v1.Gmail };
	function gmail(versionOrOptions) {
		return (0, googleapis_common_1.getAPI)("gmail", versionOrOptions, exports.VERSIONS, this);
	}
	exports.auth = new googleapis_common_1.AuthPlus();
	var googleapis_common_2 = require_src();
	Object.defineProperty(exports, "AuthPlus", {
		enumerable: true,
		get: function() {
			return googleapis_common_2.AuthPlus;
		}
	});
}));
//#endregion
//#region ../../node_modules/.pnpm/@googleapis+people@12.0.0/node_modules/@googleapis/people/build/v1.js
var require_v1 = /* @__PURE__ */ __commonJSMin(((exports) => {
	Object.defineProperty(exports, "__esModule", { value: true });
	exports.people_v1 = void 0;
	const googleapis_common_1 = require_src();
	var people_v1;
	(function(people_v1) {
		/**
		* People API
		*
		* Provides access to information about profiles and contacts.
		*
		* @example
		* ```js
		* const {google} = require('googleapis');
		* const people = google.people('v1');
		* ```
		*/
		class People {
			context;
			contactGroups;
			otherContacts;
			people;
			constructor(options, google) {
				this.context = {
					_options: options || {},
					google
				};
				this.contactGroups = new Resource$Contactgroups(this.context);
				this.otherContacts = new Resource$Othercontacts(this.context);
				this.people = new Resource$People(this.context);
			}
		}
		people_v1.People = People;
		class Resource$Contactgroups {
			context;
			members;
			constructor(context) {
				this.context = context;
				this.members = new Resource$Contactgroups$Members(this.context);
			}
			batchGet(paramsOrCallback, optionsOrCallback, callback) {
				let params = paramsOrCallback || {};
				let options = optionsOrCallback || {};
				if (typeof paramsOrCallback === "function") {
					callback = paramsOrCallback;
					params = {};
					options = {};
				}
				if (typeof optionsOrCallback === "function") {
					callback = optionsOrCallback;
					options = {};
				}
				const rootUrl = options.rootUrl || "https://people.googleapis.com/";
				const parameters = {
					options: Object.assign({
						url: (rootUrl + "/v1/contactGroups:batchGet").replace(/([^:]\/)\/+/g, "$1"),
						method: "GET",
						apiVersion: ""
					}, options),
					params,
					requiredParams: [],
					pathParams: [],
					context: this.context
				};
				if (callback) (0, googleapis_common_1.createAPIRequest)(parameters, callback);
				else return (0, googleapis_common_1.createAPIRequest)(parameters);
			}
			create(paramsOrCallback, optionsOrCallback, callback) {
				let params = paramsOrCallback || {};
				let options = optionsOrCallback || {};
				if (typeof paramsOrCallback === "function") {
					callback = paramsOrCallback;
					params = {};
					options = {};
				}
				if (typeof optionsOrCallback === "function") {
					callback = optionsOrCallback;
					options = {};
				}
				const rootUrl = options.rootUrl || "https://people.googleapis.com/";
				const parameters = {
					options: Object.assign({
						url: (rootUrl + "/v1/contactGroups").replace(/([^:]\/)\/+/g, "$1"),
						method: "POST",
						apiVersion: ""
					}, options),
					params,
					requiredParams: [],
					pathParams: [],
					context: this.context
				};
				if (callback) (0, googleapis_common_1.createAPIRequest)(parameters, callback);
				else return (0, googleapis_common_1.createAPIRequest)(parameters);
			}
			delete(paramsOrCallback, optionsOrCallback, callback) {
				let params = paramsOrCallback || {};
				let options = optionsOrCallback || {};
				if (typeof paramsOrCallback === "function") {
					callback = paramsOrCallback;
					params = {};
					options = {};
				}
				if (typeof optionsOrCallback === "function") {
					callback = optionsOrCallback;
					options = {};
				}
				const rootUrl = options.rootUrl || "https://people.googleapis.com/";
				const parameters = {
					options: Object.assign({
						url: (rootUrl + "/v1/{+resourceName}").replace(/([^:]\/)\/+/g, "$1"),
						method: "DELETE",
						apiVersion: ""
					}, options),
					params,
					requiredParams: ["resourceName"],
					pathParams: ["resourceName"],
					context: this.context
				};
				if (callback) (0, googleapis_common_1.createAPIRequest)(parameters, callback);
				else return (0, googleapis_common_1.createAPIRequest)(parameters);
			}
			get(paramsOrCallback, optionsOrCallback, callback) {
				let params = paramsOrCallback || {};
				let options = optionsOrCallback || {};
				if (typeof paramsOrCallback === "function") {
					callback = paramsOrCallback;
					params = {};
					options = {};
				}
				if (typeof optionsOrCallback === "function") {
					callback = optionsOrCallback;
					options = {};
				}
				const rootUrl = options.rootUrl || "https://people.googleapis.com/";
				const parameters = {
					options: Object.assign({
						url: (rootUrl + "/v1/{+resourceName}").replace(/([^:]\/)\/+/g, "$1"),
						method: "GET",
						apiVersion: ""
					}, options),
					params,
					requiredParams: ["resourceName"],
					pathParams: ["resourceName"],
					context: this.context
				};
				if (callback) (0, googleapis_common_1.createAPIRequest)(parameters, callback);
				else return (0, googleapis_common_1.createAPIRequest)(parameters);
			}
			list(paramsOrCallback, optionsOrCallback, callback) {
				let params = paramsOrCallback || {};
				let options = optionsOrCallback || {};
				if (typeof paramsOrCallback === "function") {
					callback = paramsOrCallback;
					params = {};
					options = {};
				}
				if (typeof optionsOrCallback === "function") {
					callback = optionsOrCallback;
					options = {};
				}
				const rootUrl = options.rootUrl || "https://people.googleapis.com/";
				const parameters = {
					options: Object.assign({
						url: (rootUrl + "/v1/contactGroups").replace(/([^:]\/)\/+/g, "$1"),
						method: "GET",
						apiVersion: ""
					}, options),
					params,
					requiredParams: [],
					pathParams: [],
					context: this.context
				};
				if (callback) (0, googleapis_common_1.createAPIRequest)(parameters, callback);
				else return (0, googleapis_common_1.createAPIRequest)(parameters);
			}
			update(paramsOrCallback, optionsOrCallback, callback) {
				let params = paramsOrCallback || {};
				let options = optionsOrCallback || {};
				if (typeof paramsOrCallback === "function") {
					callback = paramsOrCallback;
					params = {};
					options = {};
				}
				if (typeof optionsOrCallback === "function") {
					callback = optionsOrCallback;
					options = {};
				}
				const rootUrl = options.rootUrl || "https://people.googleapis.com/";
				const parameters = {
					options: Object.assign({
						url: (rootUrl + "/v1/{+resourceName}").replace(/([^:]\/)\/+/g, "$1"),
						method: "PUT",
						apiVersion: ""
					}, options),
					params,
					requiredParams: ["resourceName"],
					pathParams: ["resourceName"],
					context: this.context
				};
				if (callback) (0, googleapis_common_1.createAPIRequest)(parameters, callback);
				else return (0, googleapis_common_1.createAPIRequest)(parameters);
			}
		}
		people_v1.Resource$Contactgroups = Resource$Contactgroups;
		class Resource$Contactgroups$Members {
			context;
			constructor(context) {
				this.context = context;
			}
			modify(paramsOrCallback, optionsOrCallback, callback) {
				let params = paramsOrCallback || {};
				let options = optionsOrCallback || {};
				if (typeof paramsOrCallback === "function") {
					callback = paramsOrCallback;
					params = {};
					options = {};
				}
				if (typeof optionsOrCallback === "function") {
					callback = optionsOrCallback;
					options = {};
				}
				const rootUrl = options.rootUrl || "https://people.googleapis.com/";
				const parameters = {
					options: Object.assign({
						url: (rootUrl + "/v1/{+resourceName}/members:modify").replace(/([^:]\/)\/+/g, "$1"),
						method: "POST",
						apiVersion: ""
					}, options),
					params,
					requiredParams: ["resourceName"],
					pathParams: ["resourceName"],
					context: this.context
				};
				if (callback) (0, googleapis_common_1.createAPIRequest)(parameters, callback);
				else return (0, googleapis_common_1.createAPIRequest)(parameters);
			}
		}
		people_v1.Resource$Contactgroups$Members = Resource$Contactgroups$Members;
		class Resource$Othercontacts {
			context;
			constructor(context) {
				this.context = context;
			}
			copyOtherContactToMyContactsGroup(paramsOrCallback, optionsOrCallback, callback) {
				let params = paramsOrCallback || {};
				let options = optionsOrCallback || {};
				if (typeof paramsOrCallback === "function") {
					callback = paramsOrCallback;
					params = {};
					options = {};
				}
				if (typeof optionsOrCallback === "function") {
					callback = optionsOrCallback;
					options = {};
				}
				const rootUrl = options.rootUrl || "https://people.googleapis.com/";
				const parameters = {
					options: Object.assign({
						url: (rootUrl + "/v1/{+resourceName}:copyOtherContactToMyContactsGroup").replace(/([^:]\/)\/+/g, "$1"),
						method: "POST",
						apiVersion: ""
					}, options),
					params,
					requiredParams: ["resourceName"],
					pathParams: ["resourceName"],
					context: this.context
				};
				if (callback) (0, googleapis_common_1.createAPIRequest)(parameters, callback);
				else return (0, googleapis_common_1.createAPIRequest)(parameters);
			}
			list(paramsOrCallback, optionsOrCallback, callback) {
				let params = paramsOrCallback || {};
				let options = optionsOrCallback || {};
				if (typeof paramsOrCallback === "function") {
					callback = paramsOrCallback;
					params = {};
					options = {};
				}
				if (typeof optionsOrCallback === "function") {
					callback = optionsOrCallback;
					options = {};
				}
				const rootUrl = options.rootUrl || "https://people.googleapis.com/";
				const parameters = {
					options: Object.assign({
						url: (rootUrl + "/v1/otherContacts").replace(/([^:]\/)\/+/g, "$1"),
						method: "GET",
						apiVersion: ""
					}, options),
					params,
					requiredParams: [],
					pathParams: [],
					context: this.context
				};
				if (callback) (0, googleapis_common_1.createAPIRequest)(parameters, callback);
				else return (0, googleapis_common_1.createAPIRequest)(parameters);
			}
			search(paramsOrCallback, optionsOrCallback, callback) {
				let params = paramsOrCallback || {};
				let options = optionsOrCallback || {};
				if (typeof paramsOrCallback === "function") {
					callback = paramsOrCallback;
					params = {};
					options = {};
				}
				if (typeof optionsOrCallback === "function") {
					callback = optionsOrCallback;
					options = {};
				}
				const rootUrl = options.rootUrl || "https://people.googleapis.com/";
				const parameters = {
					options: Object.assign({
						url: (rootUrl + "/v1/otherContacts:search").replace(/([^:]\/)\/+/g, "$1"),
						method: "GET",
						apiVersion: ""
					}, options),
					params,
					requiredParams: [],
					pathParams: [],
					context: this.context
				};
				if (callback) (0, googleapis_common_1.createAPIRequest)(parameters, callback);
				else return (0, googleapis_common_1.createAPIRequest)(parameters);
			}
		}
		people_v1.Resource$Othercontacts = Resource$Othercontacts;
		class Resource$People {
			context;
			connections;
			constructor(context) {
				this.context = context;
				this.connections = new Resource$People$Connections(this.context);
			}
			batchCreateContacts(paramsOrCallback, optionsOrCallback, callback) {
				let params = paramsOrCallback || {};
				let options = optionsOrCallback || {};
				if (typeof paramsOrCallback === "function") {
					callback = paramsOrCallback;
					params = {};
					options = {};
				}
				if (typeof optionsOrCallback === "function") {
					callback = optionsOrCallback;
					options = {};
				}
				const rootUrl = options.rootUrl || "https://people.googleapis.com/";
				const parameters = {
					options: Object.assign({
						url: (rootUrl + "/v1/people:batchCreateContacts").replace(/([^:]\/)\/+/g, "$1"),
						method: "POST",
						apiVersion: ""
					}, options),
					params,
					requiredParams: [],
					pathParams: [],
					context: this.context
				};
				if (callback) (0, googleapis_common_1.createAPIRequest)(parameters, callback);
				else return (0, googleapis_common_1.createAPIRequest)(parameters);
			}
			batchDeleteContacts(paramsOrCallback, optionsOrCallback, callback) {
				let params = paramsOrCallback || {};
				let options = optionsOrCallback || {};
				if (typeof paramsOrCallback === "function") {
					callback = paramsOrCallback;
					params = {};
					options = {};
				}
				if (typeof optionsOrCallback === "function") {
					callback = optionsOrCallback;
					options = {};
				}
				const rootUrl = options.rootUrl || "https://people.googleapis.com/";
				const parameters = {
					options: Object.assign({
						url: (rootUrl + "/v1/people:batchDeleteContacts").replace(/([^:]\/)\/+/g, "$1"),
						method: "POST",
						apiVersion: ""
					}, options),
					params,
					requiredParams: [],
					pathParams: [],
					context: this.context
				};
				if (callback) (0, googleapis_common_1.createAPIRequest)(parameters, callback);
				else return (0, googleapis_common_1.createAPIRequest)(parameters);
			}
			batchUpdateContacts(paramsOrCallback, optionsOrCallback, callback) {
				let params = paramsOrCallback || {};
				let options = optionsOrCallback || {};
				if (typeof paramsOrCallback === "function") {
					callback = paramsOrCallback;
					params = {};
					options = {};
				}
				if (typeof optionsOrCallback === "function") {
					callback = optionsOrCallback;
					options = {};
				}
				const rootUrl = options.rootUrl || "https://people.googleapis.com/";
				const parameters = {
					options: Object.assign({
						url: (rootUrl + "/v1/people:batchUpdateContacts").replace(/([^:]\/)\/+/g, "$1"),
						method: "POST",
						apiVersion: ""
					}, options),
					params,
					requiredParams: [],
					pathParams: [],
					context: this.context
				};
				if (callback) (0, googleapis_common_1.createAPIRequest)(parameters, callback);
				else return (0, googleapis_common_1.createAPIRequest)(parameters);
			}
			createContact(paramsOrCallback, optionsOrCallback, callback) {
				let params = paramsOrCallback || {};
				let options = optionsOrCallback || {};
				if (typeof paramsOrCallback === "function") {
					callback = paramsOrCallback;
					params = {};
					options = {};
				}
				if (typeof optionsOrCallback === "function") {
					callback = optionsOrCallback;
					options = {};
				}
				const rootUrl = options.rootUrl || "https://people.googleapis.com/";
				const parameters = {
					options: Object.assign({
						url: (rootUrl + "/v1/people:createContact").replace(/([^:]\/)\/+/g, "$1"),
						method: "POST",
						apiVersion: ""
					}, options),
					params,
					requiredParams: [],
					pathParams: [],
					context: this.context
				};
				if (callback) (0, googleapis_common_1.createAPIRequest)(parameters, callback);
				else return (0, googleapis_common_1.createAPIRequest)(parameters);
			}
			deleteContact(paramsOrCallback, optionsOrCallback, callback) {
				let params = paramsOrCallback || {};
				let options = optionsOrCallback || {};
				if (typeof paramsOrCallback === "function") {
					callback = paramsOrCallback;
					params = {};
					options = {};
				}
				if (typeof optionsOrCallback === "function") {
					callback = optionsOrCallback;
					options = {};
				}
				const rootUrl = options.rootUrl || "https://people.googleapis.com/";
				const parameters = {
					options: Object.assign({
						url: (rootUrl + "/v1/{+resourceName}:deleteContact").replace(/([^:]\/)\/+/g, "$1"),
						method: "DELETE",
						apiVersion: ""
					}, options),
					params,
					requiredParams: ["resourceName"],
					pathParams: ["resourceName"],
					context: this.context
				};
				if (callback) (0, googleapis_common_1.createAPIRequest)(parameters, callback);
				else return (0, googleapis_common_1.createAPIRequest)(parameters);
			}
			deleteContactPhoto(paramsOrCallback, optionsOrCallback, callback) {
				let params = paramsOrCallback || {};
				let options = optionsOrCallback || {};
				if (typeof paramsOrCallback === "function") {
					callback = paramsOrCallback;
					params = {};
					options = {};
				}
				if (typeof optionsOrCallback === "function") {
					callback = optionsOrCallback;
					options = {};
				}
				const rootUrl = options.rootUrl || "https://people.googleapis.com/";
				const parameters = {
					options: Object.assign({
						url: (rootUrl + "/v1/{+resourceName}:deleteContactPhoto").replace(/([^:]\/)\/+/g, "$1"),
						method: "DELETE",
						apiVersion: ""
					}, options),
					params,
					requiredParams: ["resourceName"],
					pathParams: ["resourceName"],
					context: this.context
				};
				if (callback) (0, googleapis_common_1.createAPIRequest)(parameters, callback);
				else return (0, googleapis_common_1.createAPIRequest)(parameters);
			}
			get(paramsOrCallback, optionsOrCallback, callback) {
				let params = paramsOrCallback || {};
				let options = optionsOrCallback || {};
				if (typeof paramsOrCallback === "function") {
					callback = paramsOrCallback;
					params = {};
					options = {};
				}
				if (typeof optionsOrCallback === "function") {
					callback = optionsOrCallback;
					options = {};
				}
				const rootUrl = options.rootUrl || "https://people.googleapis.com/";
				const parameters = {
					options: Object.assign({
						url: (rootUrl + "/v1/{+resourceName}").replace(/([^:]\/)\/+/g, "$1"),
						method: "GET",
						apiVersion: ""
					}, options),
					params,
					requiredParams: ["resourceName"],
					pathParams: ["resourceName"],
					context: this.context
				};
				if (callback) (0, googleapis_common_1.createAPIRequest)(parameters, callback);
				else return (0, googleapis_common_1.createAPIRequest)(parameters);
			}
			getBatchGet(paramsOrCallback, optionsOrCallback, callback) {
				let params = paramsOrCallback || {};
				let options = optionsOrCallback || {};
				if (typeof paramsOrCallback === "function") {
					callback = paramsOrCallback;
					params = {};
					options = {};
				}
				if (typeof optionsOrCallback === "function") {
					callback = optionsOrCallback;
					options = {};
				}
				const rootUrl = options.rootUrl || "https://people.googleapis.com/";
				const parameters = {
					options: Object.assign({
						url: (rootUrl + "/v1/people:batchGet").replace(/([^:]\/)\/+/g, "$1"),
						method: "GET",
						apiVersion: ""
					}, options),
					params,
					requiredParams: [],
					pathParams: [],
					context: this.context
				};
				if (callback) (0, googleapis_common_1.createAPIRequest)(parameters, callback);
				else return (0, googleapis_common_1.createAPIRequest)(parameters);
			}
			listDirectoryPeople(paramsOrCallback, optionsOrCallback, callback) {
				let params = paramsOrCallback || {};
				let options = optionsOrCallback || {};
				if (typeof paramsOrCallback === "function") {
					callback = paramsOrCallback;
					params = {};
					options = {};
				}
				if (typeof optionsOrCallback === "function") {
					callback = optionsOrCallback;
					options = {};
				}
				const rootUrl = options.rootUrl || "https://people.googleapis.com/";
				const parameters = {
					options: Object.assign({
						url: (rootUrl + "/v1/people:listDirectoryPeople").replace(/([^:]\/)\/+/g, "$1"),
						method: "GET",
						apiVersion: ""
					}, options),
					params,
					requiredParams: [],
					pathParams: [],
					context: this.context
				};
				if (callback) (0, googleapis_common_1.createAPIRequest)(parameters, callback);
				else return (0, googleapis_common_1.createAPIRequest)(parameters);
			}
			searchContacts(paramsOrCallback, optionsOrCallback, callback) {
				let params = paramsOrCallback || {};
				let options = optionsOrCallback || {};
				if (typeof paramsOrCallback === "function") {
					callback = paramsOrCallback;
					params = {};
					options = {};
				}
				if (typeof optionsOrCallback === "function") {
					callback = optionsOrCallback;
					options = {};
				}
				const rootUrl = options.rootUrl || "https://people.googleapis.com/";
				const parameters = {
					options: Object.assign({
						url: (rootUrl + "/v1/people:searchContacts").replace(/([^:]\/)\/+/g, "$1"),
						method: "GET",
						apiVersion: ""
					}, options),
					params,
					requiredParams: [],
					pathParams: [],
					context: this.context
				};
				if (callback) (0, googleapis_common_1.createAPIRequest)(parameters, callback);
				else return (0, googleapis_common_1.createAPIRequest)(parameters);
			}
			searchDirectoryPeople(paramsOrCallback, optionsOrCallback, callback) {
				let params = paramsOrCallback || {};
				let options = optionsOrCallback || {};
				if (typeof paramsOrCallback === "function") {
					callback = paramsOrCallback;
					params = {};
					options = {};
				}
				if (typeof optionsOrCallback === "function") {
					callback = optionsOrCallback;
					options = {};
				}
				const rootUrl = options.rootUrl || "https://people.googleapis.com/";
				const parameters = {
					options: Object.assign({
						url: (rootUrl + "/v1/people:searchDirectoryPeople").replace(/([^:]\/)\/+/g, "$1"),
						method: "GET",
						apiVersion: ""
					}, options),
					params,
					requiredParams: [],
					pathParams: [],
					context: this.context
				};
				if (callback) (0, googleapis_common_1.createAPIRequest)(parameters, callback);
				else return (0, googleapis_common_1.createAPIRequest)(parameters);
			}
			updateContact(paramsOrCallback, optionsOrCallback, callback) {
				let params = paramsOrCallback || {};
				let options = optionsOrCallback || {};
				if (typeof paramsOrCallback === "function") {
					callback = paramsOrCallback;
					params = {};
					options = {};
				}
				if (typeof optionsOrCallback === "function") {
					callback = optionsOrCallback;
					options = {};
				}
				const rootUrl = options.rootUrl || "https://people.googleapis.com/";
				const parameters = {
					options: Object.assign({
						url: (rootUrl + "/v1/{+resourceName}:updateContact").replace(/([^:]\/)\/+/g, "$1"),
						method: "PATCH",
						apiVersion: ""
					}, options),
					params,
					requiredParams: ["resourceName"],
					pathParams: ["resourceName"],
					context: this.context
				};
				if (callback) (0, googleapis_common_1.createAPIRequest)(parameters, callback);
				else return (0, googleapis_common_1.createAPIRequest)(parameters);
			}
			updateContactPhoto(paramsOrCallback, optionsOrCallback, callback) {
				let params = paramsOrCallback || {};
				let options = optionsOrCallback || {};
				if (typeof paramsOrCallback === "function") {
					callback = paramsOrCallback;
					params = {};
					options = {};
				}
				if (typeof optionsOrCallback === "function") {
					callback = optionsOrCallback;
					options = {};
				}
				const rootUrl = options.rootUrl || "https://people.googleapis.com/";
				const parameters = {
					options: Object.assign({
						url: (rootUrl + "/v1/{+resourceName}:updateContactPhoto").replace(/([^:]\/)\/+/g, "$1"),
						method: "PATCH",
						apiVersion: ""
					}, options),
					params,
					requiredParams: ["resourceName"],
					pathParams: ["resourceName"],
					context: this.context
				};
				if (callback) (0, googleapis_common_1.createAPIRequest)(parameters, callback);
				else return (0, googleapis_common_1.createAPIRequest)(parameters);
			}
		}
		people_v1.Resource$People = Resource$People;
		class Resource$People$Connections {
			context;
			constructor(context) {
				this.context = context;
			}
			list(paramsOrCallback, optionsOrCallback, callback) {
				let params = paramsOrCallback || {};
				let options = optionsOrCallback || {};
				if (typeof paramsOrCallback === "function") {
					callback = paramsOrCallback;
					params = {};
					options = {};
				}
				if (typeof optionsOrCallback === "function") {
					callback = optionsOrCallback;
					options = {};
				}
				const rootUrl = options.rootUrl || "https://people.googleapis.com/";
				const parameters = {
					options: Object.assign({
						url: (rootUrl + "/v1/{+resourceName}/connections").replace(/([^:]\/)\/+/g, "$1"),
						method: "GET",
						apiVersion: ""
					}, options),
					params,
					requiredParams: ["resourceName"],
					pathParams: ["resourceName"],
					context: this.context
				};
				if (callback) (0, googleapis_common_1.createAPIRequest)(parameters, callback);
				else return (0, googleapis_common_1.createAPIRequest)(parameters);
			}
		}
		people_v1.Resource$People$Connections = Resource$People$Connections;
	})(people_v1 || (exports.people_v1 = people_v1 = {}));
}));
//#endregion
//#region ../../node_modules/.pnpm/@googleapis+people@12.0.0/node_modules/@googleapis/people/build/index.js
var require_build = /* @__PURE__ */ __commonJSMin(((exports) => {
	Object.defineProperty(exports, "__esModule", { value: true });
	exports.AuthPlus = exports.people_v1 = exports.auth = exports.VERSIONS = void 0;
	exports.people = people;
	/*! THIS FILE IS AUTO-GENERATED */
	const googleapis_common_1 = require_src();
	const v1_1 = require_v1();
	Object.defineProperty(exports, "people_v1", {
		enumerable: true,
		get: function() {
			return v1_1.people_v1;
		}
	});
	exports.VERSIONS = { v1: v1_1.people_v1.People };
	function people(versionOrOptions) {
		return (0, googleapis_common_1.getAPI)("people", versionOrOptions, exports.VERSIONS, this);
	}
	exports.auth = new googleapis_common_1.AuthPlus();
	var googleapis_common_2 = require_src();
	Object.defineProperty(exports, "AuthPlus", {
		enumerable: true,
		get: function() {
			return googleapis_common_2.AuthPlus;
		}
	});
}));
//#endregion
//#region src/gmail-api/download.ts
var import_src = require_src$1();
var import_build = require_build$1();
var import_build$1 = require_build();
const DOWNLOAD_PACE = {
	floorMs: 12e4,
	bytesPerSecond: 131072
};
/**
* The largest an attachment can be: Gmail takes a message of 50 MB at most, everything in it included.
*
* Two uses. A download whose size is not known is allowed the time this is worth — the most it could need, so that a
* large file is never cut off for a size nobody gave. And a size Gmail does give is believed only up to this: it is
* used for nothing but time, and a size of terabytes would be no limit at all.
*/
const LARGEST_ATTACHMENT = 52428800;
/**
* How long a whole download of an attachment of `size` bytes may take at `pace`: see {@link DownloadPace}.
*
* Measured on the answer rather than on the file. The answer carries the file as base64 — four bytes for every three —
* and an allowance worked out on the file alone would cut off a file arriving at exactly the slowest pace allowed.
*/
function attachmentCeilingMs(size, pace = DOWNLOAD_PACE) {
	const answered = Math.ceil((size !== void 0 && Number.isFinite(size) && size > 0 ? Math.min(size, LARGEST_ATTACHMENT) : LARGEST_ATTACHMENT) * 4 / 3);
	return Math.max(pace.floorMs, Math.ceil(answered / pace.bytesPerSecond * 1e3));
}
/** A length of time as a person says it: `0.4 seconds`, `30 seconds`, `2 minutes`, `8 minutes 53 seconds`. Slack's. */
function spokenDuration(ms) {
	const unit = (count, name) => `${count} ${name}${count === 1 ? "" : "s"}`;
	if (ms < 6e4) return unit(Math.round(ms / 100) / 10, "second");
	const minutes = Math.floor(ms / 6e4);
	const seconds = Math.round(ms % 6e4 / 1e3);
	return seconds === 0 ? unit(minutes, "minute") : `${unit(minutes, "minute")} ${unit(seconds, "second")}`;
}
/**
* Two limits — one on silence, one on the whole answer — and the caller's own signal, rejecting one promise, so that
* whichever comes first wakes the download.
*
* Slack's design, and for Slack's measured reason. Its first version handed an `AbortSignal.timeout` to `fetch` and
* trusted `fetch` to fail the read when it fired; with the body stalled and garbage collection forced while it waited,
* the abort no longer reached the waiting read, and a three-second limit was still waiting ten seconds later. So every
* wait here — for the answer, and for each piece of it — is raced against a promise the deadline itself rejects, and
* the code waiting is woken by the deadline rather than by whatever the HTTP library still holds. The signal still goes
* to the request as well, so that when the library is listening the connection is closed too. The timers are plain
* `setTimeout`s, each cleared when the download ends, so nothing is left to keep a finished process alive.
*
* The limit on silence starts again each time Gmail is heard from (`heard`). The one on the whole answer runs from the
* start, the wait for the answer included, so a slow answer does not buy its body more time.
*/
function deadline(idleMs, wholeMs, outer) {
	const controller = new AbortController();
	let ended;
	let give = () => void 0;
	const up = new Promise((_, reject) => {
		give = reject;
	});
	up.catch(() => void 0);
	const end = (which) => () => {
		if (ended !== void 0) return;
		ended = which;
		const reason = which === "cancelled" ? outer?.reason : new DOMException(`the download ran out of time (${which})`, "TimeoutError");
		controller.abort(reason);
		give(reason);
	};
	const idle = setTimeout(end("stalled"), idleMs);
	const ceiling = setTimeout(end("too-slow"), wholeMs);
	const cancel = end("cancelled");
	if (outer?.aborted) cancel();
	else outer?.addEventListener("abort", cancel, { once: true });
	return {
		signal: controller.signal,
		within: (work) => Promise.race([work, up]),
		heard: () => {
			idle.refresh();
		},
		ended: () => ended,
		end: () => {
			clearTimeout(idle);
			clearTimeout(ceiling);
			outer?.removeEventListener("abort", cancel);
		}
	};
}
/** Reads a streamed body to the end, each piece raced against the deadline, which hears every one. */
async function readBody(data, clock) {
	if (data === null || data === void 0) return "";
	if (typeof data === "string") return data;
	const pieces = data[Symbol.asyncIterator]();
	const chunks = [];
	try {
		for (;;) {
			const next = await clock.within(pieces.next());
			if (next.done) break;
			clock.heard();
			chunks.push(typeof next.value === "string" ? Buffer.from(next.value) : Buffer.from(next.value));
		}
	} catch (error) {
		data.destroy?.();
		Promise.resolve(pieces.return?.()).catch(() => void 0);
		throw error;
	}
	return Buffer.concat(chunks).toString("utf8");
}
/** The JSON in an answer, or undefined when it holds none. */
function parsed(text) {
	try {
		return JSON.parse(text);
	} catch {
		return;
	}
}
/**
* Downloads one attachment through `send`, within both limits and the caller's signal, and returns its bytes.
*
* `send` makes the request with the signal it is given and returns the answer unread, whatever its status — the
* transport asks the library for exactly that. A refusal from Google is thrown in the shape the transport's retry
* policy and `mapGoogleError` read from any Google error, so a rate limit is still retried and a missing attachment
* is still not found; a limit reached is thrown as a `CommsError` of its own, described at the top of this file.
*/
async function downloadAttachment(send, request, limits) {
	const named = request.partId === void 0 ? `an attachment of message ${request.messageId}` : `attachment ${request.messageId}/${request.partId}`;
	const which = {
		messageId: request.messageId,
		partId: request.partId ?? null
	};
	const wholeMs = attachmentCeilingMs(request.size, limits.pace);
	const clock = deadline(limits.idleMs, wholeMs, request.signal);
	try {
		let answer;
		let text;
		try {
			answer = await clock.within(send(clock.signal));
			clock.heard();
			text = await readBody(answer.data, clock);
		} catch (error) {
			const why = clock.ended();
			if (why === "stalled") throw new CommsError("TRANSIENT", `Gmail stopped sending ${named} for ${spokenDuration(limits.idleMs)}`, {
				hint: "Check the network, then try again.",
				details: {
					why,
					...which
				}
			});
			if (why === "too-slow") throw new CommsError("TRANSIENT", `${named} took longer to arrive than a file of its size is allowed (${spokenDuration(wholeMs)})`, {
				hint: "It kept arriving, but too slowly to finish in time. Download it again on a faster connection, or open it in Gmail and save it from there.",
				details: {
					why,
					...which
				}
			});
			if (why === "cancelled") throw new CommsError("TRANSIENT", `the download of ${named} was cancelled`, { details: {
				why,
				...which
			} });
			throw error;
		}
		const body = parsed(text);
		if (answer.status < 200 || answer.status >= 300) throw Object.assign(/* @__PURE__ */ new Error(`Gmail answered ${answer.status}`), { response: {
			status: answer.status,
			headers: answer.headers,
			data: body ?? text
		} });
		if (typeof body !== "object" || body === null || Array.isArray(body)) throw new CommsError("PROVIDER_UNAVAILABLE", `Gmail’s answer for ${named} was not the attachment`, {
			hint: "Nothing of it was kept. Try again shortly.",
			details: which
		});
		const data = body.data;
		return Buffer.from(typeof data === "string" ? data : "", "base64url");
	} finally {
		clock.end();
	}
}
/**
* Runs `fn`, repeating it while Google's answer says "later": 429, 5xx, the 403 rate-limit reasons, and — for calls
* that are safe to repeat — a connection that never produced an answer. `Retry-After` wins over the backoff; otherwise
* the delay is exponential with full jitter, so parallel inboxes do not retry in lockstep.
*/
async function withRetry(fn, options = {}) {
	const mode = options.mode ?? "safe";
	const attempts = mode === "never" ? 1 : options.attempts ?? 5;
	const baseMs = options.baseMs ?? 500;
	const maxDelayMs = options.maxDelayMs ?? 32e3;
	const wait = options.sleep ?? ((ms) => setTimeout$1(ms));
	const random = options.random ?? Math.random;
	for (let attempt = 1;; attempt++) try {
		return await fn();
	} catch (error) {
		if (attempt >= attempts) throw error;
		const shape = describeGoogleError(error);
		if (shape.status === void 0 && mode !== "safe") throw error;
		if (!isRetryable(shape)) throw error;
		const backoff = Math.min(baseMs * 2 ** (attempt - 1), maxDelayMs);
		const delayMs = shape.retryAfterMs ?? Math.round(backoff * random());
		options.onRetry?.({
			attempt,
			delayMs,
			error
		});
		await wait(delayMs);
	}
}
/**
* Runs at most `limit` tasks at once. Gmail's per-user quota is the scarce resource, so each inbox gets its own
* limiter rather than one global pool.
*/
function createLimiter(limit) {
	let active = 0;
	const queue = [];
	const next = () => {
		active--;
		queue.shift()?.();
	};
	return async (task) => {
		if (active >= limit) await new Promise((resolve) => queue.push(resolve));
		active++;
		try {
			return await task();
		} finally {
			next();
		}
	};
}
//#endregion
//#region src/gmail-api/transport.ts
/** Builds the list parameters, omitting the page token entirely when there is none. */
function listParameters(options) {
	const parameters = {
		userId: "me",
		q: options.query,
		maxResults: options.maxResults ?? 25,
		includeSpamTrash: options.includeSpamTrash ?? false
	};
	return options.pageToken === void 0 ? parameters : {
		...parameters,
		pageToken: options.pageToken
	};
}
/** The live transport: `@googleapis/gmail` and `@googleapis/people`, with our own auth, retries and error mapping. */
/**
* The URL path of every Gmail endpoint that makes mail leave: `drafts/{id}/send`, `messages/send`. Matching the path
* rather than the method name means a future call, a hand-built request, or a redirect to one is caught too.
*/
const SEND_PATH = /\/send$/;
/**
* Refuses any request to a send endpoint unless a permit for that draft is open.
*
* This wraps the auth client's own `request`, which is where every Gmail call in this package ends up —
* `@googleapis/gmail` issues its requests through it. So this is the narrowest place where every send can be seen,
* and the only one that cannot be bypassed by adding another method somewhere else in the package.
*/
function guardSendRequests(client, permit) {
	const inner = client.request.bind(client);
	const guarded = (options, callback) => {
		const url = String(options?.url ?? "");
		let path = url;
		try {
			path = new URL(url).pathname;
		} catch {
			path = url.split(/[?#]/)[0] ?? url;
		}
		if (/\/batch(\/|$)/.test(path)) throw new CommsError("SEND_REFUSED", "this package does not batch requests, and a batch could hide a send", { hint: "This is a bug — please report it." });
		if (SEND_PATH.test(path.replace(/\/$/, ""))) {
			if (!permit.draftId) throw new CommsError("SEND_REFUSED", "a send was attempted without an approval", { hint: "Mail leaves only through `send execute`, after an approval. This is a bug — please report it." });
			const body = typeof options.data === "string" ? options.data : JSON.stringify(options.data ?? {});
			if (!path.includes(permit.draftId) && !body.includes(permit.draftId)) throw new CommsError("SEND_REFUSED", "a send was attempted for a different draft than the approved one", { hint: "The approval names one draft. Prepare the send again for the draft you mean." });
			permit.draftId = null;
		}
		return inner(options, callback);
	};
	client.request = guarded;
}
var GoogleGmailTransport = class {
	alias;
	inboxId;
	#tokens;
	#endpoints;
	#limit;
	#retry;
	#download;
	#platform;
	#gmail = null;
	#people = null;
	#oauth = null;
	/** Open only inside `withSendPermit`, and only for the draft named there. */
	#sendPermit = { draftId: null };
	constructor(options) {
		this.#tokens = options.tokens;
		this.alias = options.tokens.alias;
		this.inboxId = options.tokens.inbox.id;
		this.#endpoints = options.endpoints;
		this.#platform = options.platform ?? process.platform;
		this.#limit = createLimiter(options.concurrency ?? 5);
		this.#retry = options.retry;
		this.#download = {
			idleMs: options.download?.idleMs ?? 3e4,
			pace: options.download?.pace ?? DOWNLOAD_PACE
		};
	}
	/**
	* One OAuth2Client per transport, fed by our `TokenSource` through `refreshHandler`, so the library never holds the
	* refresh token. `forceRefreshOnFailure` is deliberately left off: it makes the library refresh and silently repeat
	* the request on any 401 *or 403* — which would hide a disabled API or a missing scope behind a wasted token
	* refresh, and would repeat requests outside the retry policy. Stale access tokens are handled in `call()` instead.
	*/
	#auth() {
		if (this.#oauth) return this.#oauth;
		const client = new import_src.OAuth2Client();
		guardSendRequests(client, this.#sendPermit);
		client.refreshHandler = async () => {
			const token = await this.#tokens.accessToken();
			return {
				access_token: token.token,
				expiry_date: token.expiresAt,
				scope: token.scopes.join(" ")
			};
		};
		this.#oauth = client;
		return client;
	}
	/** Drops the access token held here and inside the library, so the next call fetches a fresh one. */
	#forgetAccessToken() {
		this.#tokens.invalidate();
		this.#oauth?.setCredentials({});
	}
	gmail() {
		this.#gmail ??= (0, import_build.gmail)({
			version: "v1",
			auth: this.#auth(),
			rootUrl: this.#endpoints.gmailRoot,
			retry: false
		});
		return this.#gmail;
	}
	people() {
		this.#people ??= (0, import_build$1.people)({
			version: "v1",
			auth: this.#auth(),
			rootUrl: this.#endpoints.peopleRoot,
			retry: false
		});
		return this.#people;
	}
	/** Runs one Google call under the inbox's concurrency cap and retry policy, mapping any failure to a CommsError. */
	async call(operation, fn, options = {}) {
		const mode = options.mode ?? "safe";
		return this.#limit(async () => {
			try {
				try {
					return await withRetry(fn, {
						mode,
						...this.#retry
					});
				} catch (error) {
					if (mode === "never" || describeGoogleError(error).status !== 401) throw error;
					this.#forgetAccessToken();
					return await withRetry(fn, {
						mode,
						...this.#retry
					});
				}
			} catch (error) {
				throw mapGoogleError(error, {
					alias: this.alias,
					operation,
					api: options.api ?? "gmail",
					platform: this.#platform
				});
			}
		});
	}
	async getProfile() {
		const { data } = await this.call("read the profile", () => this.gmail().users.getProfile({ userId: "me" }));
		return {
			emailAddress: data.emailAddress ?? "",
			messagesTotal: data.messagesTotal ?? 0,
			threadsTotal: data.threadsTotal ?? 0,
			historyId: data.historyId ?? ""
		};
	}
	async listLabels() {
		const { data } = await this.call("list labels", () => this.gmail().users.labels.list({ userId: "me" }));
		return (data.labels ?? []).map((label) => ({
			id: label.id ?? "",
			name: label.name ?? "",
			type: label.type === "system" ? "system" : "user",
			messagesTotal: label.messagesTotal ?? void 0,
			messagesUnread: label.messagesUnread ?? void 0
		}));
	}
	async getMessage(messageId) {
		const { data } = await this.call("read a message", () => this.gmail().users.messages.get({
			userId: "me",
			id: messageId,
			format: "full"
		}));
		return data;
	}
	async getThread(threadId) {
		const { data } = await this.call("read a thread", () => this.gmail().users.threads.get({
			userId: "me",
			id: threadId,
			format: "full"
		}));
		return data;
	}
	async listMessages(options) {
		const { data } = await this.call("search messages", () => this.gmail().users.messages.list(listParameters(options)));
		return {
			ids: (data.messages ?? []).map((message) => ({
				id: message.id ?? "",
				threadId: message.threadId ?? void 0
			})),
			nextPageToken: data.nextPageToken ?? void 0,
			resultSizeEstimate: data.resultSizeEstimate ?? void 0
		};
	}
	async listThreads(options) {
		const { data } = await this.call("search threads", () => this.gmail().users.threads.list(listParameters(options)));
		return {
			ids: (data.threads ?? []).map((thread) => ({
				id: thread.id ?? "",
				threadId: thread.id ?? void 0
			})),
			nextPageToken: data.nextPageToken ?? void 0,
			resultSizeEstimate: data.resultSizeEstimate ?? void 0
		};
	}
	async getMessageMetadata(messageId) {
		const { data } = await this.call("read message metadata", () => this.gmail().users.messages.get({
			userId: "me",
			id: messageId,
			format: "full",
			fields: "id,threadId,labelIds,snippet,internalDate,payload(partId,mimeType,filename,headers,body/size,body/attachmentId,parts(partId,mimeType,filename,headers,body/size,body/attachmentId,parts(partId,mimeType,filename,headers,body/size,body/attachmentId)))"
		}));
		return data;
	}
	async getAttachment(messageId, attachmentId, about = {}) {
		return this.call("download an attachment", async () => {
			await this.#tokens.accessToken();
			return downloadAttachment((signal) => this.gmail().users.messages.attachments.get({
				userId: "me",
				messageId,
				id: attachmentId
			}, {
				responseType: "stream",
				signal,
				validateStatus: () => true
			}), {
				...about,
				messageId
			}, this.#download);
		});
	}
	/**
	* The People API needs a warm-up call before it returns anything for a query, which is why the first search of a
	* session can come back empty. Both collections are asked; the caller merges them with what it saw in headers.
	*/
	async searchContacts(query) {
		const fields = "names,emailAddresses";
		const [saved, others] = await Promise.all([this.call("search contacts", () => this.people().people.searchContacts({
			query,
			readMask: fields,
			pageSize: 20
		}), { api: "people" }), this.call("search other contacts", () => this.people().otherContacts.search({
			query,
			readMask: fields,
			pageSize: 20
		}), { api: "people" })]);
		const matches = [];
		const collect = (results, source) => {
			for (const entry of results?.results ?? []) {
				const person = entry.person;
				const name = person?.names?.[0]?.displayName ?? "";
				for (const address of person?.emailAddresses ?? []) if (address.value) matches.push({
					name,
					email: address.value.toLowerCase(),
					source
				});
			}
		};
		collect(saved.data, "contacts");
		collect(others.data, "other-contacts");
		return matches;
	}
	async getRawMessage(messageId) {
		const { data } = await this.call("export a message", () => this.gmail().users.messages.get({
			userId: "me",
			id: messageId,
			format: "raw"
		}));
		return Buffer.from(data.raw ?? "", "base64url");
	}
	async createDraft(raw, threadId) {
		const { data } = await this.call("save a draft", () => this.gmail().users.drafts.create({
			userId: "me",
			requestBody: { message: {
				raw: raw.toString("base64url"),
				...threadId ? { threadId } : {}
			} }
		}), { mode: "rate-limit-only" });
		return {
			draftId: data.id ?? "",
			messageId: data.message?.id ?? "",
			threadId: data.message?.threadId ?? void 0
		};
	}
	async updateDraft(draftId, raw, threadId) {
		const { data } = await this.call("update a draft", () => this.gmail().users.drafts.update({
			userId: "me",
			id: draftId,
			requestBody: { message: {
				raw: raw.toString("base64url"),
				...threadId ? { threadId } : {}
			} }
		}));
		return {
			draftId: data.id ?? draftId,
			messageId: data.message?.id ?? "",
			threadId: data.message?.threadId ?? void 0
		};
	}
	async getDraft(draftId) {
		const { data } = await this.call("read a draft", () => this.gmail().users.drafts.get({
			userId: "me",
			id: draftId,
			format: "full"
		}));
		return {
			id: data.id ?? draftId,
			message: data.message ?? void 0
		};
	}
	async listDrafts(limit) {
		const { data } = await this.call("list drafts", () => this.gmail().users.drafts.list({
			userId: "me",
			maxResults: limit
		}));
		const drafts = data.drafts ?? [];
		return Promise.all(drafts.map(async (draft) => draft.id ? this.getDraft(draft.id) : {
			id: "",
			message: void 0
		}));
	}
	async deleteDraft(draftId) {
		await this.call("delete a draft", () => this.gmail().users.drafts.delete({
			userId: "me",
			id: draftId
		}), { mode: "rate-limit-only" });
	}
	async sendDraft(draftId) {
		this.#auth();
		if (this.#sendPermit.draftId) throw new CommsError("SEND_REFUSED", "a send is already in progress on this transport");
		this.#sendPermit.draftId = draftId;
		try {
			const { data } = await this.call("send the draft", () => this.gmail().users.drafts.send({
				userId: "me",
				requestBody: { id: draftId }
			}), { mode: "never" });
			return {
				id: data.id ?? "",
				threadId: data.threadId ?? void 0
			};
		} finally {
			this.#sendPermit.draftId = null;
		}
	}
	async modifyMessages(messageIds, addLabelIds, removeLabelIds) {
		for (let index = 0; index < messageIds.length; index += 1e3) {
			const chunk = messageIds.slice(index, index + 1e3);
			await this.call("change labels", () => this.gmail().users.messages.batchModify({
				userId: "me",
				requestBody: {
					ids: [...chunk],
					addLabelIds: [...addLabelIds],
					removeLabelIds: [...removeLabelIds]
				}
			}));
		}
	}
	async trashMessage(messageId) {
		await this.call("move a message to the bin", () => this.gmail().users.messages.trash({
			userId: "me",
			id: messageId
		}));
	}
	async untrashMessage(messageId) {
		await this.call("take a message out of the bin", () => this.gmail().users.messages.untrash({
			userId: "me",
			id: messageId
		}));
	}
	async createLabel(name) {
		const { data } = await this.call("create a label", () => this.gmail().users.labels.create({
			userId: "me",
			requestBody: {
				name,
				labelListVisibility: "labelShow",
				messageListVisibility: "show"
			}
		}), { mode: "rate-limit-only" });
		return {
			id: data.id ?? "",
			name: data.name ?? name
		};
	}
	async listSendAs() {
		const { data } = await this.call("list the send-as addresses", () => this.gmail().users.settings.sendAs.list({ userId: "me" }));
		return (data.sendAs ?? []).map((entry) => ({
			sendAsEmail: entry.sendAsEmail ?? "",
			displayName: entry.displayName ?? "",
			isDefault: entry.isDefault ?? false,
			isPrimary: entry.isPrimary ?? false,
			treatAsAlias: entry.treatAsAlias ?? false,
			verificationStatus: entry.verificationStatus ?? void 0,
			signature: entry.signature ?? void 0
		}));
	}
};
//#endregion
//#region src/context.ts
/**
* What every operation needs: the core stores, the Google endpoints, and a transport per inbox. Config is read afresh
* on each use rather than cached here, so an inbox added or a policy tightened through the CLI applies to the next
* call of an MCP server that is already running.
*/
var GmailContext = class {
	core;
	env;
	endpoints;
	flows;
	now;
	platform;
	surface;
	cwd;
	#createTransport;
	#transports = /* @__PURE__ */ new Map();
	constructor(options = {}) {
		this.env = options.env ?? process.env;
		this.core = options.core ?? openCore({ env: this.env });
		this.endpoints = resolveEndpoints(this.env);
		this.now = options.now ?? (() => /* @__PURE__ */ new Date());
		this.platform = options.platform ?? process.platform;
		this.surface = options.surface ?? "cli";
		this.cwd = options.cwd ?? process.cwd();
		this.flows = new FlowStore(this.core.paths.stateDir, this.now, this.surface, this.platform);
		this.#createTransport = options.createTransport ?? defaultTransport;
	}
	config() {
		return this.core.config.load();
	}
	/** Resolves an alias against the current config, failing with the known aliases when it is not one. */
	async inbox(alias) {
		const config = await this.config();
		return {
			alias,
			inbox: requireInbox(config, alias)
		};
	}
	async client(name) {
		const client = (await this.config()).clients[name];
		if (client) return client;
		throw new CommsError("CONFIG", `no OAuth client called "${name}" is registered`, { hint: "Add one with `agent-gmail client add <client_secret.json>`." });
	}
	/**
	* Refuses the call when the inbox was never granted what it needs, naming the command that grants it. Checked here,
	* before Google is called, so the message is the fix rather than a 403 — and checked on every call, so a server
	* started before a re-consent sees the new scopes without a restart.
	*/
	async requireCapability(resolved, capability) {
		if (capabilitiesOf(resolved.inbox.grantedScopes).has(capability)) return;
		throw new CommsError("SCOPE_MISSING", `${resolved.alias} was not granted permission to ${describe(capability)}`, {
			hint: `Grant it: ${grantHint(resolved.alias, capability, this.platform)}.`,
			details: {
				alias: resolved.alias,
				capability
			}
		});
	}
	/**
	* The transport for an inbox, built once per context: each carries its own token cache and concurrency budget.
	*
	* **Keyed by the inbox id, not the alias.** An alias is a name a person chose and can move; the id is the mailbox.
	* Keyed by alias, a long-lived process served the *previous* mailbox's transport after an alias was reused — and
	* `forgetTransports()` does not help, because it only runs in the process that made the change, while an MCP
	* server holds one context for a whole client session and never sees a rename made at a terminal. Every operation
	* resolves the inbox freshly and then asks for a transport, so the two would disagree: the gates (send policy,
	* granted scopes, internal domains) ran against the new inbox's config while the Google calls went to the old
	* mailbox. Resolving first costs a config read that the operation has already done anyway.
	*/
	async transport(alias) {
		const resolved = await this.inbox(alias);
		const existing = this.#transports.get(resolved.inbox.id);
		if (existing) return existing;
		const client = await this.client(resolved.inbox.client);
		const transport = this.#createTransport({
			resolved,
			client,
			context: this
		});
		this.#transports.set(resolved.inbox.id, transport);
		return transport;
	}
	/** A transport for an inbox that is not in the config yet — used while a sign-in is being verified. */
	transportFor(resolved, client) {
		return this.#createTransport({
			resolved,
			client,
			context: this
		});
	}
	/** Forgets cached transports, so the next call reloads config (after add, reauth or remove). */
	forgetTransports() {
		this.#transports.clear();
	}
};
function defaultTransport({ resolved, client, context }) {
	return new GoogleGmailTransport({
		tokens: new TokenSource({
			core: context.core,
			endpoints: context.endpoints,
			inbox: resolved.inbox,
			client,
			alias: resolved.alias,
			platform: context.platform
		}),
		endpoints: context.endpoints,
		platform: context.platform
	});
}
function describe(capability) {
	switch (capability) {
		case "read": return "read this mailbox";
		case "draft": return "create drafts";
		case "organize": return "change labels and archive";
		case "contacts": return "search contacts";
	}
}
//#endregion
//#region src/domain/timeline.ts
const HOUR = 36e5;
/** Whole business hours between two instants: weekdays only, 09:00–17:00 UTC. */
function businessHoursBetween(from, to) {
	if (to <= from) return 0;
	let hours = 0;
	const cursor = new Date(from.getTime());
	cursor.setUTCMinutes(0, 0, 0);
	while (cursor < to) {
		const day = cursor.getUTCDay();
		const hour = cursor.getUTCHours();
		if (day >= 1 && day <= 5 && hour >= 9 && hour < 17) hours += 1;
		cursor.setUTCHours(cursor.getUTCHours() + 1);
	}
	return hours;
}
function hoursBetween(from, to, businessOnly) {
	if (!from || !to) return null;
	const start = new Date(from);
	const end = new Date(to);
	if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return null;
	if (businessOnly) return businessHoursBetween(start, end);
	return Math.round((end.getTime() - start.getTime()) / HOUR * 10) / 10;
}
function normaliseSubject(subject) {
	return subject.replace(/^((re|fwd?|aw|sv|vs|rv)\s*(\[\d+\])?\s*:\s*)+/i, "").trim().toLowerCase();
}
function isForward(subject) {
	return /^\s*(fwd?|tr|wg)\s*:/i.test(subject);
}
/** Builds the timeline from messages already read (chronological, oldest first). */
function buildTimeline(thread, options) {
	const own = new Set(options.ownAddresses.map(canonicalAddress));
	const events = [];
	let previousParticipants = /* @__PURE__ */ new Set();
	let previousAt = null;
	const baseSubject = normaliseSubject(thread.messages[0]?.subject ?? "");
	const seenSenders = /* @__PURE__ */ new Set();
	for (const [index, message] of thread.messages.entries()) {
		const from = message.from?.address ?? null;
		const to = message.to.map((entry) => entry.address);
		const cc = message.cc.map((entry) => entry.address);
		const participants = /* @__PURE__ */ new Set([
			...from ? [from] : [],
			...to,
			...cc
		]);
		const isDraft = message.labels.includes("DRAFT");
		const direction = from && own.has(from) ? "out" : message.labels.includes("SENT") ? "out" : "in";
		const gapHours = hoursBetween(previousAt, message.date, options.businessHours ?? false);
		events.push({
			index,
			messageId: message.messageId,
			at: message.date,
			from,
			fromName: message.from?.name ?? "",
			direction,
			to,
			cc,
			isDraft,
			attachments: message.attachments.filter((attachment) => !attachment.inline).map((attachment) => ({
				filename: attachment.filename,
				size: attachment.size,
				riskFlags: attachment.riskFlags
			})),
			subjectChanged: index > 0 && normaliseSubject(message.subject) !== baseSubject,
			gapHours,
			participantsAdded: [...participants].filter((address) => !previousParticipants.has(address) && index > 0),
			participantsDropped: [...previousParticipants].filter((address) => !participants.has(address) && index > 0),
			forwardedIn: index > 0 && (isForward(message.subject) || Boolean(from && !seenSenders.has(from)))
		});
		if (from) seenSenders.add(from);
		for (const address of participants) seenSenders.add(address);
		previousParticipants = participants;
		if (!isDraft) previousAt = message.date;
	}
	const sent = events.filter((event) => !event.isDraft);
	const last = sent.at(-1);
	const now = /* @__PURE__ */ new Date();
	const waitingOn = last ? {
		party: last.direction === "in" ? "us" : "them",
		sinceHours: hoursBetween(last.at, now.toISOString(), options.businessHours ?? false),
		since: last.at
	} : {
		party: "nobody",
		sinceHours: null,
		since: null
	};
	const gaps = sent.map((event) => event.gapHours).filter((gap) => gap !== null);
	return {
		threadId: thread.threadId,
		inbox: thread.inbox,
		subject: thread.messages[0]?.subject ?? "",
		messageCount: thread.messages.length,
		participants: [...new Set(events.flatMap((event) => [
			event.from,
			...event.to,
			...event.cc
		]))].filter((address) => Boolean(address)),
		events,
		longestWaitHours: gaps.length > 0 ? Math.max(...gaps) : null,
		waitingOn,
		firstAt: sent[0]?.at ?? null,
		lastAt: last?.at ?? null
	};
}
function shortDate(at) {
	if (!at) return "—";
	return at.replace("T", " ").replace(/:\d{2}\.\d{3}Z$/, "");
}
/**
* What an event carried, by count and risk: the names are the senders', wrapped in the structured events, and an
* envelope is several lines — it cannot sit in a table cell, and a bare name there would be the sender's sentence in
* this tool's voice.
*/
function attachmentsCell(attachments) {
	if (attachments.length === 0) return "—";
	const flags = [...new Set(attachments.flatMap((attachment) => attachment.riskFlags))];
	return `${attachments.length} ${attachments.length === 1 ? "file" : "files"}${flags.length ? ` (${flags.join(", ")})` : ""}`;
}
/**
* A table a person can read at a glance. Display names and attachment names are sender-controlled, so only addresses
* are shown, and attachments by count.
*/
function renderTimelineMarkdown(timeline) {
	const lines = [
		`**${timeline.subject}** — ${timeline.messageCount} messages in ${timeline.inbox}`,
		"",
		"| # | when | direction | from | waited | attachments | changes |",
		"|---|---|---|---|---|---|---|"
	];
	for (const event of timeline.events) {
		const changes = [
			event.participantsAdded.length ? `+${event.participantsAdded.join(" +")}` : "",
			event.participantsDropped.length ? `−${event.participantsDropped.join(" −")}` : "",
			event.subjectChanged ? "subject changed" : "",
			event.forwardedIn ? "forwarded in" : "",
			event.isDraft ? "draft (not sent)" : ""
		].filter(Boolean).join(", ");
		lines.push(`| ${event.index + 1} | ${shortDate(event.at)} | ${event.direction === "in" ? "received" : "sent"} | ${event.from ?? "—"} | ${event.gapHours === null ? "—" : `${event.gapHours}h`} | ${attachmentsCell(event.attachments)} | ${changes || "—"} |`);
	}
	lines.push("");
	if (timeline.longestWaitHours !== null) lines.push(`Longest wait: ${timeline.longestWaitHours}h.`);
	if (timeline.waitingOn.party !== "nobody") lines.push(`Waiting on: ${timeline.waitingOn.party === "us" ? "us" : "them"}, for ${timeline.waitingOn.sinceHours ?? "—"}h.`);
	return lines.join("\n");
}
/** A Mermaid timeline, which renders in Markdown viewers that support it. */
function renderTimelineMermaid(timeline) {
	const lines = ["timeline", `    title ${timeline.subject.replace(/[\n\r]/g, " ").slice(0, 80) || "Thread"}`];
	for (const event of timeline.events) {
		const label = `${event.direction === "in" ? "from" : "to"} ${event.from ?? "unknown"}${event.attachments.length ? ` (${event.attachments.length} attached)` : ""}`;
		lines.push(`    ${shortDate(event.at).replace(/:/g, ".")} : ${label.replace(/:/g, " ")}`);
	}
	return lines.join("\n");
}
//#endregion
//#region src/domain/mime.ts
/** Case-insensitive header lookup; Gmail preserves the sender's capitalisation. */
function headerValue(headers, name) {
	const wanted = name.toLowerCase();
	for (const header of headers ?? []) if ((header.name ?? "").toLowerCase() === wanted) return header.value ?? void 0;
}
/** Every value of a repeated header, topmost first — `Received` and `Authentication-Results` both repeat. */
function headerValues(headers, name) {
	const wanted = name.toLowerCase();
	const found = [];
	for (const header of headers ?? []) if ((header.name ?? "").toLowerCase() === wanted && header.value) found.push(header.value);
	return found;
}
function parameterOf(header, name) {
	if (!header) return void 0;
	const match = new RegExp(`${name}\\s*=\\s*("([^"]*)"|[^;\\s]+)`, "i").exec(header);
	return (match?.[2] ?? match?.[1])?.trim();
}
/**
* Decodes a part's bytes to text. UTF-8 first, then the declared charset: a message that declares one charset and
* carries another is common, and a stateful 7-bit encoding (ISO-2022-JP, UTF-7) is a known way to smuggle text past
* a scanner that trusted the declaration. Anything undecodable degrades to replacement characters rather than
* throwing, because a body that cannot be read still has to be reported.
*/
function hasNonAscii(text) {
	for (const character of text) if ((character.codePointAt(0) ?? 0) > 127) return true;
	return false;
}
function decodeBody(data, charset) {
	const bytes = Buffer.from(data, "base64url");
	const declared = (charset ?? "").toLowerCase().replace(/^["']|["']$/g, "");
	const utf8 = new TextDecoder("utf-8", { fatal: false }).decode(bytes);
	const replacementCount = (utf8.match(/�/g) ?? []).length;
	if (!declared || declared === "utf-8" || declared === "utf8" || declared === "us-ascii" || declared === "ascii") return {
		text: utf8,
		overridden: false
	};
	if (replacementCount === 0 && hasNonAscii(utf8)) return {
		text: utf8,
		overridden: true
	};
	try {
		return {
			text: new TextDecoder(declared, { fatal: false }).decode(bytes),
			overridden: false
		};
	} catch {
		return {
			text: utf8,
			overridden: true
		};
	}
}
/** Flattens the part tree, decoding the text parts. Attachments keep their ids instead of their bytes. */
function readParts(payload) {
	const parts = [];
	const visit = (part, path) => {
		const mimeType = (part.mimeType ?? "application/octet-stream").toLowerCase();
		const contentType = headerValue(part.headers, "content-type");
		const disposition = headerValue(part.headers, "content-disposition");
		const filename = part.filename && part.filename.length > 0 ? part.filename : parameterOf(disposition, "filename") ?? parameterOf(contentType, "name");
		const data = part.body?.data;
		const decoded = data ? decodeBody(data, parameterOf(contentType, "charset")) : void 0;
		parts.push({
			partId: part.partId ?? path,
			mimeType,
			charset: parameterOf(contentType, "charset"),
			disposition: disposition?.toLowerCase().startsWith("attachment") ? "attachment" : disposition?.toLowerCase().startsWith("inline") ? "inline" : void 0,
			filename: filename || void 0,
			contentId: headerValue(part.headers, "content-id")?.replace(/^<|>$/g, ""),
			size: part.body?.size ?? 0,
			text: decoded?.text,
			attachmentId: part.body?.attachmentId ?? void 0,
			charsetOverridden: decoded?.overridden ?? false
		});
		for (const [index, child] of (part.parts ?? []).entries()) visit(child, path ? `${path}.${index}` : String(index));
	};
	if (payload) visit(payload, "0");
	const isAttachment = (part) => Boolean(part.attachmentId) || part.disposition === "attachment" && Boolean(part.filename);
	return {
		parts,
		html: parts.filter((part) => part.mimeType === "text/html" && !isAttachment(part) && part.text !== void 0),
		plain: parts.filter((part) => part.mimeType === "text/plain" && !isAttachment(part) && part.text !== void 0),
		attachments: parts.filter(isAttachment)
	};
}
//#endregion
//#region src/domain/auth-results.ts
const GOOGLE_AUTHSERV = "mx.google.com";
function methodResult(header, method) {
	const match = new RegExp(`(?:^|;)\\s*${method}\\s*=\\s*([a-z]+)((?:\\s+[\\w.]+=[^;]+)*)`, "i").exec(header);
	if (!match) return {
		result: null,
		properties: /* @__PURE__ */ new Map()
	};
	const properties = /* @__PURE__ */ new Map();
	for (const property of (match[2] ?? "").matchAll(/([\w.]+)=("([^"]*)"|[^\s;]+)/g)) properties.set((property[1] ?? "").toLowerCase(), (property[3] ?? property[2] ?? "").trim());
	return {
		result: (match[1] ?? "").toLowerCase(),
		properties
	};
}
function domainOf(address) {
	return address.slice(address.lastIndexOf("@") + 1).toLowerCase();
}
/** Reads the verdict from Gmail's own header; everything else is counted and discarded. */
function readAuthResults(headers, fromHeader) {
	const all = headerValues(headers, "Authentication-Results");
	const mine = all.filter((header) => {
		return (header.trim().split(/[\s;]/)[0]?.toLowerCase() ?? "") === GOOGLE_AUTHSERV;
	});
	const chosen = mine[0];
	if (!chosen) return {
		evaluatedBy: null,
		spf: null,
		dkim: null,
		dkimDomain: null,
		dmarc: null,
		aligned: null,
		ignoredHeaders: all.length
	};
	const spf = methodResult(chosen, "spf");
	const dkim = methodResult(chosen, "dkim");
	const dmarc = methodResult(chosen, "dmarc");
	const dkimDomain = dkim.properties.get("header.d")?.toLowerCase() ?? null;
	const from = parseAddressList(fromHeader)[0]?.address;
	const fromDomain = from ? domainOf(from) : null;
	return {
		evaluatedBy: GOOGLE_AUTHSERV,
		spf: spf.result,
		dkim: dkim.result,
		dkimDomain,
		dmarc: dmarc.result,
		aligned: dkim.result === "pass" && dkimDomain && fromDomain ? dkimDomain === fromDomain || fromDomain.endsWith(`.${dkimDomain}`) : dkim.result === "pass" ? false : null,
		ignoredHeaders: all.length - mine.length
	};
}
/** The two things about a sender that most often mislead a reader, computed rather than judged. */
function readSenderWarnings(fromHeader, replyToHeader) {
	const from = parseAddressList(fromHeader);
	const replyTo = parseAddressList(replyToHeader);
	const fromAddress = from[0]?.address ?? null;
	const fromDomain = fromAddress ? domainOf(fromAddress) : null;
	const nameHasOtherAddress = from.some((entry) => {
		return (entry.name.match(/[\w.+-]+@[\w.-]+\.\w+/g) ?? []).some((address) => address.toLowerCase() !== entry.address);
	});
	const replyToAddresses = replyTo.map((entry) => entry.address);
	return {
		replyToDiffers: replyToAddresses.length > 0 && replyToAddresses.some((address) => address !== fromAddress),
		replyToDomains: [...new Set(replyToAddresses.map(domainOf))],
		displayNameContainsOtherAddress: nameHasOtherAddress,
		fromDomain
	};
}
/**
* How much text has to appear only in the plain part before it is reported. Low enough to catch a short instruction
* (about ten words), high enough to ignore what differs between the parts in ordinary mail: a signature line, an
* unsubscribe footer, "Sent from my phone".
*/
const MISMATCH_THRESHOLD_CHARS = 60;
/** Markers Gmail and other clients leave where quoted history starts. */
/**
* Lines that begin quoted history.
*
* A bare `From:` line used to be here, and it was the whole marker: one line of the sender's choosing —
* `From: Finance <finance@example.test>` in the middle of a paragraph — cut everything after it out of what the
* agent read, labelled as quoted history so there was no reason to look. The human sees the whole message in
* Gmail. That one is gone; a header block is recognised below, where it has to look like a header block.
*/
const QUOTE_MARKERS = [
	/^On .{10,120}\bwrote:\s*$/,
	/^-{2,}\s*Original Message\s*-{2,}$/i,
	/^_{5,}$/,
	/^Sent from my \w+/i
];
/** A forwarded-header block: two or more of these in consecutive lines, which prose does not do by accident. */
const HEADER_LINE = /^(From|Sent|Date|To|Cc|Subject|Reply-To):\s/i;
/** A signature block: the standard `-- ` separator, and nothing after it. */
const SIGNATURE_MARKER = /^--\s?$/;
/**
* Collapses quoted history and signatures. Conservative: it cuts at the first marker that has real text before it,
* so a reply whose new content sits under the quote is not emptied out.
*/
function collapseQuoted(text) {
	const lines = text.split("\n");
	let cut = -1;
	for (const [index, line] of lines.entries()) {
		const trimmed = line.trim();
		if (!(SIGNATURE_MARKER.test(trimmed) || QUOTE_MARKERS.some((marker) => marker.test(trimmed)) || isHeaderBlock(lines, index))) continue;
		if (lines.slice(0, index).join("\n").trim().length === 0) continue;
		cut = index;
		break;
	}
	if (cut === -1) {
		for (let index = lines.length - 1; index >= 0; index--) {
			if (lines[index]?.trim() === "") continue;
			if (!/^\s*>/.test(lines[index] ?? "")) break;
			cut = index;
		}
		if (cut !== -1 && lines.slice(0, cut).join("\n").trim().length === 0) cut = -1;
	}
	if (cut === -1) return {
		text,
		quoted: {
			linesOmitted: 0,
			collapsed: false
		}
	};
	const kept = lines.slice(0, cut).join("\n").replace(/\s+$/, "");
	const omitted = lines.length - cut;
	return {
		text: `${kept}\n\n[quoted: ${omitted} lines omitted — pass includeQuoted to see them]`,
		quoted: {
			linesOmitted: omitted,
			collapsed: true
		}
	};
}
/**
* Whether a run of header-shaped lines starts here.
*
* Two or more consecutive `From:` / `Date:` / `To:` / `Subject:` lines is a forwarded header block; one on its own
* is a sentence somebody wrote, and treating it as a block boundary let a sender hide the rest of their message.
*/
function isHeaderBlock(lines, index) {
	if (!HEADER_LINE.test((lines[index] ?? "").trim())) return false;
	let run = 0;
	for (let at = index; at < lines.length && at < index + 6; at++) {
		const line = (lines[at] ?? "").trim();
		if (line === "") continue;
		if (!HEADER_LINE.test(line)) break;
		run += 1;
	}
	return run >= 2;
}
/** Words of four characters or more, lower-cased: enough to tell "this text is elsewhere too" from "this is new". */
function meaningfulTokens(text) {
	const counts = /* @__PURE__ */ new Map();
	for (const match of text.toLowerCase().matchAll(/[\p{L}\p{N}][\p{L}\p{N}'-]{3,}/gu)) {
		const word = match[0];
		counts.set(word, (counts.get(word) ?? 0) + 1);
	}
	return counts;
}
/** What the plain part says that the visible HTML does not. */
function compareParts(htmlText, plainText) {
	const visible = meaningfulTokens(htmlText);
	const extra = [];
	let extraChars = 0;
	for (const [word, count] of meaningfulTokens(plainText)) {
		const seen = visible.get(word) ?? 0;
		if (seen >= count) continue;
		const missing = count - seen;
		extraChars += word.length * missing;
		if (extra.length < 40) extra.push(word);
	}
	if (extraChars < MISMATCH_THRESHOLD_CHARS) return void 0;
	return {
		extraChars,
		sample: extra.join(" ").slice(0, 300)
	};
}
function mergeReports(primary, secondary) {
	return {
		hiddenElements: primary.hiddenElements + secondary.hiddenElements,
		hiddenChars: primary.hiddenChars + secondary.hiddenChars,
		sameColorElements: primary.sameColorElements + secondary.sameColorElements,
		invisibleCharsRemoved: primary.invisibleCharsRemoved + secondary.invisibleCharsRemoved,
		tokensNeutralised: primary.tokensNeutralised + secondary.tokensNeutralised,
		unreadableHidingRules: primary.unreadableHidingRules + secondary.unreadableHidingRules,
		links: [...primary.links, ...secondary.links],
		imagesNotLoaded: primary.imagesNotLoaded + secondary.imagesNotLoaded
	};
}
/**
* The body a caller sees: sanitised, quote-collapsed, truncated with a continuation offset, and carrying everything
* that was removed or that disagreed — so nothing is dropped without being counted.
*/
function buildBody(parts, options = {}) {
	const maxChars = options.maxChars ?? 8e3;
	const offset = Math.max(0, options.offset ?? 0);
	const htmlSource = parts.html.map((part) => part.text ?? "").join("\n");
	const plainSource = parts.plain.map((part) => part.text ?? "").join("\n");
	const html = htmlSource ? sanitizeHtmlToText(htmlSource) : void 0;
	const plain = plainSource ? sanitizePlainText(plainSource) : void 0;
	const htmlHasText = Boolean(html && html.text.trim().length > 0);
	const source = htmlHasText ? "html" : plain?.text.trim() ? "plain" : "none";
	let report = (htmlHasText ? html?.report : plain?.report) ?? sanitizePlainText("").report;
	let mismatch;
	if (htmlHasText && plain?.text.trim()) {
		mismatch = compareParts(html?.text ?? "", plain.text);
		if (mismatch) report = {
			...report,
			hiddenChars: report.hiddenChars + mismatch.extraChars
		};
	}
	if (!htmlHasText && html && plain) report = mergeReports(report, html.report);
	const full = (htmlHasText ? html?.text : plain?.text) ?? "";
	const collapsed = options.includeQuoted ? {
		text: full,
		quoted: {
			linesOmitted: 0,
			collapsed: false
		}
	} : collapseQuoted(full);
	const neutralised = neutralise(collapsed.text);
	report.tokensNeutralised += neutralised.tokensNeutralised;
	const totalChars = neutralised.text.length;
	const window = neutralised.text.slice(offset, offset + maxChars);
	const truncated = offset + window.length < totalChars;
	return {
		text: window,
		source,
		report,
		quoted: collapsed.quoted,
		mismatch,
		truncated,
		nextOffset: truncated ? offset + window.length : void 0,
		totalChars
	};
}
//#endregion
//#region src/domain/untrusted-fields.ts
/** Bounds what a malformed token can bring with it into the envelope. */
const MAX_TOKEN_CHARS = 500;
/** A plain address: a local part of the usual characters, and a domain of labels. No quotes, no spaces. */
const PLAIN_ADDRESS = /^[a-z0-9._%+-]{1,64}@(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z0-9-]{2,63}$/i;
/** A MIME type with no parameters: a registered top-level type and an RFC 6838 restricted-name subtype. */
const MIME_TYPE = /^(?:application|audio|font|haptics|image|message|model|multipart|text|video)\/[a-z0-9][a-z0-9!#$&^_.+-]{0,126}$/i;
/** Sender-chosen text, inside the untrusted-content envelope. */
function wrapField(text, field, envelope) {
	return wrapUntrusted(text, {
		field,
		inbox: envelope.inbox,
		id: envelope.id
	}, envelope.boundary, envelope.collector);
}
/**
* An attachment's name: decoded from its RFC 2047 form, then wrapped. A part with no name at all says `(unnamed)`,
* which is this package's word and stays bare.
*/
function filenameField(filename, envelope) {
	return filename ? wrapField(decodeHeaderWords(filename), "filename", envelope) : "(unnamed)";
}
/** A declared type: lower-cased when it is a bare MIME type, wrapped when it is anything else. */
function mimeTypeField(value, envelope) {
	const trimmed = value.trim();
	return MIME_TYPE.test(trimmed) ? trimmed.toLowerCase() : wrapField(trimmed.slice(0, MAX_TOKEN_CHARS), "mime-type", envelope);
}
/** An address: bare when it is a plain address and nothing more, wrapped otherwise. */
function addressField(address, field, envelope) {
	return PLAIN_ADDRESS.test(address) ? address : wrapField(address.slice(0, MAX_TOKEN_CHARS), field, envelope);
}
//#endregion
//#region src/operations/numbers.ts
/**
* A number option as given, checked by the operation for both surfaces — as `oneOf` checks a word: the number,
* `undefined` when none was given, or a USAGE refusal naming the option as its caller spells it, and the range.
*
* The command handed these over as `Number.parseInt` read them — `--limit abc` as NaN, `--limit 1e2` as 1,
* `--max-chars 12abc` as 12 — and the operations clamped whatever arrived, so a tool's `limit: 500` searched 50 and
* said nothing. Checked here, before anything is read, a number is taken as typed or refused, from either surface.
*/
function numberOption(context, raw, option) {
	return wholeNumber(raw, {
		name: context.surface === "mcp" ? option.arg : option.flag,
		min: option.min,
		max: option.max,
		hint: option.hint
	});
}
//#endregion
//#region src/operations/read.ts
/**
* A parsed address with its display name neutralised.
*
* The address itself is structure — it is parsed, canonicalised and compared elsewhere — but the display name is
* free text the sender chose, and it travels in the same object.
*/
function safeAddress(entry) {
	if (!entry) return entry;
	return {
		...entry,
		name: neutralise(entry.name).text
	};
}
/**
* The risks worth naming for an attachment, judged from the name the sender sent.
*
* **It normalises its own input, and it needs two forms of the name to do it.** Every call site used to pass a
* different string — the raw header on the download path, `safeFilename(...)` on the read path, something else
* again on find — so the same file came back `['executable']` from one surface and `[]` from another. Deciding it
* here means a caller cannot get it wrong, and a new surface inherits the right answer.
*
* The extension rules run against the name the file would actually be **written under**: decoded, and with the
* trailing spaces and separators `safeFilename` strips. `invoice.exe ` matches no `$`-anchored rule while landing
* on disk as `invoice.exe`, and an RFC 2047-encoded header matches nothing at all — so a sender could suppress
* every flag just by encoding the name.
*
* The bidi rule runs against the **raw** header, because that is the only place the override still exists:
* `safeFilename` removes it by design, so testing the cleaned name meant `bidi-filename` could never fire on a
* find row or a message read at all.
*/
function attachmentRisks(filename, mimeType) {
	return fileRisks(decodeHeaderWords(filename), mimeType);
}
const MAX_CHARS = {
	flag: "--max-chars",
	arg: "maxChars",
	min: 1
};
const OFFSET = {
	flag: "--offset",
	arg: "offset",
	min: 0
};
/** The read's numbers, checked before anything is read. */
function bodyNumbers(context, options) {
	return {
		maxChars: numberOption(context, options.maxChars, MAX_CHARS),
		offset: numberOption(context, options.offset, OFFSET)
	};
}
/**
* Turns one Gmail message into a result. Pure apart from the taint collector it fills, so a thread read can reuse it
* for every message and record everything once.
*/
function buildMessageResult(message, options) {
	const headers = message.payload?.headers ?? [];
	const parts = readParts(message.payload);
	const body = buildBody(parts, options.body ?? {});
	const from = parseAddressList(headerValue(headers, "From"))[0] ?? null;
	const replyTo = parseAddressList(headerValue(headers, "Reply-To"));
	const to = parseAddressList(headerValue(headers, "To"));
	const cc = parseAddressList(headerValue(headers, "Cc"));
	const subject = headerValue(headers, "Subject") ?? "";
	options.collector.observeHeaders([
		from?.address,
		...replyTo.map((a) => a.address),
		...to.map((a) => a.address),
		...cc.map((a) => a.address)
	].filter((address) => Boolean(address)));
	const enveloped = wrapUntrusted(`Subject: ${subject}\n\n${body.text}`, {
		field: "body",
		inbox: options.inbox,
		id: message.id ?? void 0
	}, options.boundary, options.collector);
	const date = message.internalDate ? new Date(Number(message.internalDate)).toISOString() : null;
	const labels = message.labelIds ?? [];
	const fields = {
		boundary: options.boundary,
		inbox: options.inbox,
		id: message.id ?? void 0,
		collector: options.collector
	};
	return {
		inbox: options.inbox,
		messageId: message.id ?? "",
		threadId: message.threadId ?? "",
		date,
		from: safeAddress(from),
		replyTo: replyTo.map(safeAddress),
		to: to.map(safeAddress),
		cc: cc.map(safeAddress),
		subject: neutralise(decodeHeaderWords(subject)).text,
		labels,
		unread: labels.includes("UNREAD"),
		auth: readAuthResults(headers, headerValue(headers, "From")),
		sender: readSenderWarnings(headerValue(headers, "From"), headerValue(headers, "Reply-To")),
		attachments: parts.attachments.map((part) => {
			return {
				partId: part.partId,
				attachmentId: part.attachmentId,
				filename: filenameField(part.filename, fields),
				mimeType: mimeTypeField(part.mimeType, fields),
				size: part.size,
				inline: part.disposition === "inline",
				riskFlags: attachmentRisks(part.filename ?? "", part.mimeType)
			};
		}),
		sanitisation: {
			...body.report,
			plainHtmlMismatch: body.mismatch,
			charsetOverridden: parts.parts.some((part) => part.charsetOverridden)
		},
		body: {
			enveloped,
			source: body.source,
			truncated: body.truncated,
			nextOffset: body.nextOffset,
			totalChars: body.totalChars,
			quotedLinesOmitted: body.quoted.linesOmitted
		},
		webLink: message.id ? `https://mail.google.com/mail/u/0/#all/${message.id}` : ""
	};
}
/** The addresses that are not worth recording as tainted: the inbox's own, and its internal domains. */
async function taintExclusions(context, alias) {
	const { inbox } = await context.inbox(alias);
	return {
		ownAddresses: [inbox.email],
		internalDomains: inbox.internalDomains
	};
}
/**
* Reads a whole thread in one call. Later messages quote earlier ones, so each body is collapsed as usual, and the
* budget is spent oldest-first — a reader who runs out of room has still seen how the conversation started.
*/
async function readThread(context, alias, threadId, options = {}) {
	const { maxChars, offset } = bodyNumbers(context, options);
	const resolved = await context.inbox(alias);
	await context.requireCapability(resolved, "read");
	const thread = await (await context.transport(alias)).getThread(threadId);
	const boundary = options.boundary ?? newBoundary();
	const collector = new TaintCollector(resolved.inbox.id, threadId);
	const ordered = [...thread.messages ?? []].sort((a, b) => Number(a.internalDate ?? 0) - Number(b.internalDate ?? 0));
	const budget = options.maxThreadChars ?? 2e4;
	const messages = [];
	let spent = 0;
	let truncated = false;
	for (const message of ordered) {
		const remaining = budget - spent;
		if (remaining <= 0) {
			truncated = true;
			break;
		}
		const result = buildMessageResult(message, {
			inbox: alias,
			boundary,
			collector,
			body: {
				...options,
				maxChars: Math.min(maxChars ?? 8e3, remaining),
				offset
			}
		});
		spent += result.body.enveloped.length;
		if (result.body.truncated) truncated = true;
		messages.push(result);
	}
	await collector.flush(context.core.taint, await taintExclusions(context, alias));
	await context.core.states.update(resolved.inbox.id, { lastUsedAt: context.now().toISOString() });
	const participants = [...new Set(messages.flatMap((message) => [
		message.from?.address,
		...message.to.map((a) => a.address),
		...message.cc.map((a) => a.address)
	].filter((address) => Boolean(address))))];
	return {
		inbox: alias,
		threadId: thread.id ?? threadId,
		subject: messages[0]?.subject ?? "",
		messageCount: ordered.length,
		participants,
		messages,
		truncated,
		totalChars: spent
	};
}
/** Reads one message. The result is returned only after the taint it observed has been recorded. */
async function readMessage(context, alias, messageId, options = {}) {
	const numbers = bodyNumbers(context, options);
	const resolved = await context.inbox(alias);
	await context.requireCapability(resolved, "read");
	const message = await (await context.transport(alias)).getMessage(messageId);
	const collector = new TaintCollector(resolved.inbox.id, messageId);
	const result = buildMessageResult(message, {
		inbox: alias,
		boundary: options.boundary ?? newBoundary(),
		collector,
		body: {
			...options,
			...numbers
		}
	});
	await collector.flush(context.core.taint, await taintExclusions(context, alias));
	await context.core.states.update(resolved.inbox.id, { lastUsedAt: context.now().toISOString() });
	return result;
}
//#endregion
//#region src/operations/analyse.ts
/** The addresses that count as "us" for this mailbox: its own, plus every verified send-as alias. */
async function ownAddresses$1(context, alias) {
	const { inbox } = await context.inbox(alias);
	const addresses = /* @__PURE__ */ new Set([inbox.email.toLowerCase()]);
	try {
		const transport = await context.transport(alias);
		for (const sendAs of await transport.listSendAs()) if (sendAs.sendAsEmail) addresses.add(sendAs.sendAsEmail.toLowerCase());
	} catch {}
	return [...addresses];
}
async function threadTimeline(context, alias, threadId, options = {}) {
	const thread = await readThread(context, alias, threadId, {
		...options,
		maxChars: options.maxChars ?? 1
	});
	const timeline = buildTimeline({
		threadId: thread.threadId,
		inbox: alias,
		messages: thread.messages
	}, {
		ownAddresses: await ownAddresses$1(context, alias),
		businessHours: options.businessHours ?? false
	});
	return {
		timeline,
		markdown: renderTimelineMarkdown(timeline),
		mermaid: renderTimelineMermaid(timeline),
		messageCount: thread.messageCount,
		truncated: thread.messages.length < thread.messageCount
	};
}
async function listLabels(context, alias) {
	const resolved = await context.inbox(alias);
	await context.requireCapability(resolved, "read");
	return (await (await context.transport(alias)).listLabels()).sort((a, b) => a.name.localeCompare(b.name));
}
async function listSendAs(context, alias) {
	const resolved = await context.inbox(alias);
	await context.requireCapability(resolved, "read");
	return (await (await context.transport(alias)).listSendAs()).map((entry) => ({
		email: entry.sendAsEmail,
		displayName: entry.displayName,
		isDefault: entry.isDefault,
		isPrimary: entry.isPrimary,
		verificationStatus: entry.verificationStatus,
		hasSignature: Boolean(entry.signature && entry.signature.trim().length > 0)
	}));
}
//#endregion
//#region src/domain/query.ts
const DATE_OPERATORS = /* @__PURE__ */ new Set([
	"after",
	"before",
	"older",
	"newer"
]);
/** `YYYY/MM/DD`, `YYYY-MM-DD` and `MM/DD/YYYY`, the three forms Gmail's own help uses. */
function parseDateParts(value) {
	const iso = /^(\d{4})[/-](\d{1,2})[/-](\d{1,2})$/.exec(value);
	if (iso) return {
		year: Number(iso[1]),
		month: Number(iso[2]),
		day: Number(iso[3])
	};
	const american = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(value);
	if (american) return {
		year: Number(american[3]),
		month: Number(american[1]),
		day: Number(american[2])
	};
	return null;
}
/**
* The UTC instant of local midnight on a date in a named timezone. Derived from the zone's own offset on that date,
* so it stays correct across daylight saving.
*/
function localMidnightEpochSeconds(parts, timezone) {
	const guess = Date.UTC(parts.year, parts.month - 1, parts.day, 0, 0, 0);
	try {
		const formatter = new Intl.DateTimeFormat("en-US", {
			timeZone: timezone,
			hour12: false,
			year: "numeric",
			month: "2-digit",
			day: "2-digit",
			hour: "2-digit",
			minute: "2-digit",
			second: "2-digit"
		});
		const read = (instant) => {
			const fields = Object.fromEntries(formatter.formatToParts(new Date(instant)).map((part) => [part.type, part.value]));
			return Date.UTC(Number(fields.year), Number(fields.month) - 1, Number(fields.day), Number(fields.hour) % 24, Number(fields.minute), Number(fields.second));
		};
		let instant = guess - (read(guess) - guess);
		instant = guess - (read(instant) - instant);
		return Math.floor(instant / 1e3);
	} catch {
		return null;
	}
}
/** Splits a query into tokens, keeping quoted strings, parentheses and `{}` groups intact. */
function tokenizeQuery(query) {
	const tokens = [];
	let current = "";
	let quote = null;
	for (const character of query) {
		if (quote) {
			current += character;
			if (character === quote) quote = null;
			continue;
		}
		if (character === "\"" || character === "'") {
			quote = character;
			current += character;
			continue;
		}
		if (/\s/.test(character)) {
			if (current) tokens.push(current);
			current = "";
			continue;
		}
		current += character;
	}
	if (current) tokens.push(current);
	return tokens;
}
function compileQuery(query, options = {}) {
	const timezone = (options.timezone && options.timezone !== "system" ? options.timezone : void 0) ?? Intl.DateTimeFormat().resolvedOptions().timeZone ?? "UTC";
	const rewrites = [];
	return {
		compiled: tokenizeQuery(query).map((token) => {
			const negation = token.startsWith("-") ? "-" : "";
			const body = negation ? token.slice(1) : token;
			const colon = body.indexOf(":");
			if (colon <= 0) return token;
			const operator = body.slice(0, colon).toLowerCase();
			const value = body.slice(colon + 1);
			if (!DATE_OPERATORS.has(operator)) return token;
			const parts = parseDateParts(value);
			if (!parts) return token;
			const epoch = localMidnightEpochSeconds(parts, timezone);
			if (epoch === null) return token;
			rewrites.push({
				operator,
				from: value,
				to: String(epoch)
			});
			return `${negation}${operator}:${epoch}`;
		}).join(" "),
		rewrites,
		timezone
	};
}
//#endregion
//#region src/operations/words.ts
/**
* A word an argument takes, checked against the words there are: the word, `undefined` when none was given, or the
* USAGE refusal naming the choices.
*
* The tools take these arguments as strings and leave the check to the operation — as `gmail_inbox_policy` and
* `gmail_inbox_reauth` do with `sendPolicy`, `changePolicy` and `tier` — because a schema enum refused a word that is
* not one with the SDK's "Input validation error", which carries no `error.code` for an agent to act on, while the
* command refused the same word as USAGE. Checked here, both surfaces refuse it with the same code, and the words
* each accepts come from one list.
*/
function oneOf(value, words, what) {
	if (value === void 0) return void 0;
	if (words.includes(value)) return value;
	throw new CommsError("USAGE", `"${value}" is not ${what}`, { hint: `Use ${spoken(words)}.` });
}
/**
* A list of words, each checked as {@link oneOf} checks one: the list, `undefined` when none was given, or the USAGE
* refusal of the first that is not one of the words there are — not a list with it quietly left out.
*/
function allOf(values, words, what) {
	if (values === void 0) return void 0;
	return values.map((value) => oneOf(value, words, what));
}
/** `a`, `a or b`, `a, b or c`: the choices as a person would say them. */
function spoken(words) {
	if (words.length <= 1) return words.join("");
	return `${words.slice(0, -1).join(", ")} or ${words.at(-1)}`;
}
//#endregion
//#region src/operations/search.ts
/** What a search can return rows of. */
const SEARCH_KINDS = ["threads", "messages"];
const SEARCH_LIMIT = {
	flag: "--limit",
	arg: "limit",
	min: 1,
	max: 50
};
function encodeCursor(state) {
	return Buffer.from(JSON.stringify(state), "utf8").toString("base64url");
}
function decodeCursor(cursor) {
	let parsed;
	try {
		parsed = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8"));
	} catch {
		throw new CommsError("CURSOR_MISMATCH", "that cursor is not one of ours", { hint: "Run the search again without a cursor." });
	}
	if (parsed?.v !== 1 || typeof parsed.q !== "string" || !parsed.per) throw new CommsError("CURSOR_MISMATCH", "that cursor is from an older version", { hint: "Run the search again without a cursor." });
	return parsed;
}
function queryHash(compiled) {
	return createHash("sha256").update(compiled).digest("hex").slice(0, 16);
}
/**
* One mailbox's side of the merge: pages of ids, and metadata fetched only when the merge actually looks at a row.
* A search over six mailboxes that returns twenty rows fetches about twenty-six messages, not six pages of fifty.
*/
var InboxStream = class {
	alias;
	#transport;
	#kind;
	#query;
	#includeSpamTrash;
	#pageToken;
	#pending = [];
	/** Gmail said there is no page after the one we hold. */
	#noMorePages = false;
	#exhausted = false;
	#head = null;
	consumed = [];
	resultSizeEstimate = 0;
	constructor(options) {
		this.alias = options.alias;
		this.#transport = options.transport;
		this.#kind = options.kind;
		this.#query = options.query;
		this.#includeSpamTrash = options.includeSpamTrash;
		this.#pageToken = options.state?.pageToken;
		this.consumed = options.state?.consumed ?? [];
		this.#exhausted = options.state?.exhausted ?? false;
		this.#noMorePages = this.#exhausted;
	}
	get exhausted() {
		return this.#exhausted && this.#pending.length === 0 && this.#head === null;
	}
	async #fill() {
		if (this.#pending.length > 0 || this.#exhausted) return;
		if (this.#noMorePages) {
			this.#exhausted = true;
			return;
		}
		const page = this.#kind === "threads" ? await this.#transport.listThreads({
			query: this.#query,
			pageToken: this.#pageToken,
			includeSpamTrash: this.#includeSpamTrash
		}) : await this.#transport.listMessages({
			query: this.#query,
			pageToken: this.#pageToken,
			includeSpamTrash: this.#includeSpamTrash
		});
		this.resultSizeEstimate = Math.max(this.resultSizeEstimate, page.resultSizeEstimate ?? 0);
		this.#pageToken = page.nextPageToken;
		if (page.nextPageToken === void 0) this.#noMorePages = true;
		this.#pending = page.ids.filter((entry) => !this.consumed.includes(entry.id));
		if (this.#pending.length === 0 && this.#noMorePages) this.#exhausted = true;
	}
	/** The newest row this mailbox has not yet emitted, with its metadata fetched. */
	async peek() {
		if (this.#head) return this.#head;
		await this.#fill();
		const next = this.#pending.shift();
		if (!next) return null;
		const message = await this.#transport.getMessageMetadata(this.#kind === "threads" ? await this.#newestOfThread(next.id) : next.id);
		this.#head = {
			id: next.id,
			message,
			date: Number(message.internalDate ?? 0)
		};
		return this.#head;
	}
	async #newestOfThread(threadId) {
		return [...(await this.#transport.getThread(threadId)).messages ?? []].sort((a, b) => Number(a.internalDate ?? 0) - Number(b.internalDate ?? 0)).at(-1)?.id ?? threadId;
	}
	take() {
		const head = this.#head;
		if (!head) return null;
		this.#head = null;
		this.consumed.push(head.id);
		return head;
	}
	state() {
		return {
			pageToken: this.#pageToken,
			consumed: this.consumed.slice(-200),
			exhausted: this.#noMorePages && this.#head === null && this.#pending.length === 0
		};
	}
};
function rowFrom(alias, message, threadId) {
	const headers = message.payload?.headers ?? [];
	const parts = readParts(message.payload);
	const from = parseAddressList(headerValue(headers, "From"))[0] ?? null;
	const labels = message.labelIds ?? [];
	return {
		inbox: alias,
		threadId,
		messageId: message.id ?? "",
		date: message.internalDate ? new Date(Number(message.internalDate)).toISOString() : null,
		from: from ? {
			...from,
			name: neutralise(from.name).text
		} : null,
		toCount: parseAddressList(headerValue(headers, "To")).length + parseAddressList(headerValue(headers, "Cc")).length,
		subject: neutralise(decodeHeaderWords(headerValue(headers, "Subject") ?? "").slice(0, 120)).text,
		snippet: neutralise(message.snippet ?? "").text,
		labels,
		attachmentCount: parts.attachments.filter((part) => part.disposition !== "inline").length,
		unread: labels.includes("UNREAD"),
		webLink: message.id ? `https://mail.google.com/mail/u/0/#all/${message.id}` : ""
	};
}
/**
* Resolves the mailbox list: named aliases, or every connected mailbox — and refuses a list that names none.
*
* `inboxes: []` was taken as given, so gmail_search, gmail_attachments_find, gmail_contacts_search and
* gmail_followups each read no mailbox and answered with no rows, no errors and `complete: true`: an answer about
* nothing, in the words of one about everything asked. The command cannot send an empty list (`--inbox` takes one or
* more, and `--all` is all), so refusing it here keeps the two surfaces alike.
*/
async function resolveInboxes(context, requested) {
	if (Array.isArray(requested) && requested.length === 0) throw new CommsError("USAGE", `${context.surface === "mcp" ? "`inboxes`" : "`--inbox`"} names no mailbox, so nothing would be searched`, { hint: context.surface === "mcp" ? "Name one or more mailboxes, pass \"all\", or leave `inboxes` out to search them all." : "Name one or more mailboxes with `--inbox`, or pass `--all`." });
	const config = await context.config();
	const known = Object.keys(config.inboxes);
	if (requested === void 0 || requested === "all") {
		if (known.length === 0) throw new CommsError("NOT_FOUND", "no mailbox is connected yet", { hint: "Connect one with `agent-gmail inbox add <name> --start`." });
		return [...known].sort();
	}
	const unknown = requested.filter((alias) => !known.includes(alias));
	for (const alias of unknown) {
		const renamed = formerNameRefusal(config, "inbox", alias);
		if (renamed) throw renamed;
	}
	if (unknown.length > 0) throw new CommsError("NOT_FOUND", `no inbox called "${unknown.join("\", \"")}"`, { hint: known.length ? `Known inboxes: ${known.join(", ")}.` : "No inboxes yet." });
	return requested;
}
async function search(context, options) {
	const kind = oneOf(options.kind, SEARCH_KINDS, "a kind of result") ?? "threads";
	const limit = numberOption(context, options.limit, SEARCH_LIMIT) ?? 20;
	const config = await context.config();
	const aliases = await resolveInboxes(context, options.inboxes);
	const compiled = compileQuery(options.query, { timezone: config.defaults.timezone });
	const hash = queryHash(`${compiled.compiled}|${kind}`);
	let cursorState;
	if (options.cursor) {
		cursorState = decodeCursor(options.cursor);
		if (cursorState.q !== hash) throw new CommsError("CURSOR_MISMATCH", "that cursor belongs to a different search", { hint: "Cursors carry their query and mailboxes. Run this search from the start, or repeat the original query." });
		if (cursorState.inboxes.join(",") !== aliases.join(",")) throw new CommsError("CURSOR_MISMATCH", "that cursor was made for a different set of mailboxes", { hint: `It was for: ${cursorState.inboxes.join(", ")}.` });
	}
	const streams = [];
	const errors = [];
	for (const alias of aliases) try {
		const resolved = await context.inbox(alias);
		await context.requireCapability(resolved, "read");
		streams.push(new InboxStream({
			alias,
			transport: await context.transport(alias),
			kind,
			query: compiled.compiled,
			includeSpamTrash: options.includeSpamTrash ?? false,
			state: cursorState?.per[alias]
		}));
	} catch (error) {
		const failure = error;
		errors.push({
			inbox: alias,
			code: failure.code ?? "UNEXPECTED",
			message: failure.message,
			hint: failure.hint
		});
	}
	const rows = [];
	const boundary = newBoundary();
	const collectors = /* @__PURE__ */ new Map();
	while (rows.length < limit) {
		const heads = [];
		for (const stream of streams) try {
			const head = await stream.peek();
			if (head) heads.push({
				stream,
				head
			});
		} catch (error) {
			const failure = error;
			if (!errors.some((entry) => entry.inbox === stream.alias)) errors.push({
				inbox: stream.alias,
				code: failure.code ?? "UNEXPECTED",
				message: failure.message,
				hint: failure.hint
			});
		}
		if (heads.length === 0) break;
		heads.sort((a, b) => b.head.date - a.head.date);
		const chosen = heads[0];
		if (!chosen) break;
		const taken = chosen.stream.take();
		if (!taken) break;
		const row = rowFrom(chosen.stream.alias, taken.message, taken.message.threadId ?? taken.id);
		rows.push(row);
		const resolved = await context.inbox(chosen.stream.alias);
		let collector = collectors.get(chosen.stream.alias);
		if (!collector) {
			collector = new TaintCollector(resolved.inbox.id);
			collectors.set(chosen.stream.alias, collector);
		}
		collector.observeText(`${row.subject}\n${row.snippet}`);
		if (row.from) collector.observeHeaders([row.from.address]);
	}
	for (const [alias, collector] of collectors) await collector.flush(context.core.taint, await taintExclusions(context, alias));
	const per = {};
	for (const stream of streams) per[stream.alias] = stream.state();
	const hasMore = streams.some((stream) => !stream.exhausted);
	const enveloped = wrapUntrusted(rows.map((row, index) => `[${index + 1}] ${row.inbox} · ${row.date ?? "unknown date"} · from ${row.from?.address ?? "unknown"}\nSubject: ${row.subject}\n${row.snippet}`).join("\n\n"), { field: "search-results" }, boundary);
	return {
		query: {
			given: options.query,
			compiled: compiled.compiled,
			rewrites: compiled.rewrites,
			timezone: compiled.timezone
		},
		kind,
		inboxes: aliases,
		rows,
		enveloped,
		hasMore,
		nextCursor: hasMore ? encodeCursor({
			v: 1,
			q: hash,
			kind,
			inboxes: aliases,
			per
		}) : void 0,
		returned: rows.length,
		estimatedTotal: streams.reduce((total, stream) => total + stream.resultSizeEstimate, 0),
		errors,
		complete: errors.length === 0
	};
}
//#endregion
//#region src/operations/attachments.ts
const MIN_BYTES = {
	flag: "--min-bytes",
	arg: "minBytes",
	min: 0
};
const MAX_BYTES = {
	flag: "--max-bytes",
	arg: "maxBytes",
	min: 1
};
const FIND_LIMIT = {
	flag: "--limit",
	arg: "limit",
	min: 1,
	max: 100
};
/** Builds the Gmail query for the filters, so a caller does not have to know the syntax. */
function attachmentQuery(options) {
	const parts = ["has:attachment"];
	if (options.from) parts.push(`from:${options.from}`);
	if (options.filename) parts.push(`filename:${options.filename}`);
	if (options.after) parts.push(`after:${options.after}`);
	if (options.before) parts.push(`before:${options.before}`);
	if (options.minBytes) parts.push(`larger:${options.minBytes}`);
	if (options.maxBytes) parts.push(`smaller:${options.maxBytes}`);
	if (options.query) parts.push(options.query);
	return parts.join(" ");
}
async function findAttachments(context, options = {}) {
	const minBytes = numberOption(context, options.minBytes, MIN_BYTES);
	const maxBytes = numberOption(context, options.maxBytes, MAX_BYTES);
	const limit = numberOption(context, options.limit, FIND_LIMIT) ?? 25;
	const config = await context.config();
	const aliases = await resolveInboxes(context, options.inboxes);
	const query = compileQuery(attachmentQuery({
		...options,
		minBytes,
		maxBytes
	}), { timezone: config.defaults.timezone }).compiled;
	const rows = [];
	const errors = [];
	let driveLinks = 0;
	const boundary = newBoundary();
	for (const alias of aliases) try {
		const resolved = await context.inbox(alias);
		await context.requireCapability(resolved, "read");
		const transport = await context.transport(alias);
		const page = await transport.listMessages({
			query,
			maxResults: limit
		});
		for (const entry of page.ids) {
			if (rows.length >= limit) break;
			const message = await transport.getMessageMetadata(entry.id);
			const headers = message.payload?.headers ?? [];
			const parts = readParts(message.payload);
			const date = message.internalDate ? new Date(Number(message.internalDate)).toISOString() : null;
			const envelope = {
				boundary,
				inbox: alias,
				id: message.id ?? entry.id
			};
			const address = parseAddressList(headerValue(headers, "From"))[0]?.address;
			const from = address === void 0 ? null : addressField(address, "from-address", envelope);
			const subject = wrapField(decodeHeaderWords(headerValue(headers, "Subject") ?? "").slice(0, 120), "subject", envelope);
			for (const part of parts.attachments) {
				if (part.disposition === "inline" && !part.filename) continue;
				const filename = part.filename ?? "(unnamed)";
				if (options.mimeType && !part.mimeType.includes(options.mimeType.toLowerCase())) continue;
				if (minBytes && part.size < minBytes) continue;
				if (maxBytes && part.size > maxBytes) continue;
				if (!part.attachmentId) {
					driveLinks += 1;
					continue;
				}
				rows.push({
					inbox: alias,
					messageId: message.id ?? entry.id,
					threadId: message.threadId ?? entry.threadId ?? "",
					partId: part.partId,
					attachmentId: part.attachmentId,
					filename: filenameField(part.filename, envelope),
					mimeType: mimeTypeField(part.mimeType, envelope),
					size: part.size,
					date,
					from,
					subject,
					riskFlags: attachmentRisks(filename, part.mimeType)
				});
			}
		}
	} catch (error) {
		const failure = error;
		errors.push({
			inbox: alias,
			code: failure.code ?? "UNEXPECTED",
			message: failure.message
		});
	}
	rows.sort((a, b) => (b.date ?? "").localeCompare(a.date ?? ""));
	return {
		query,
		rows: rows.slice(0, limit),
		driveLinks,
		errors,
		complete: errors.length === 0
	};
}
const MAX_FILES = {
	flag: "--max-files",
	arg: "maxFiles",
	min: 1,
	max: 200
};
const DAY = /^\d{4}-\d{2}-\d{2}$/;
/**
* A day, `YYYY-MM-DD`, for a folder or file name — or `undated`. Gmail's time, not the sender's; still only a date or
* nothing, since it becomes part of a path: a number that is no time at all threw, and one past the year 9999 came
* out as `+010000-01`.
*/
function dayOf(at) {
	const time = new Date(at ?? NaN);
	if (Number.isNaN(time.getTime())) return "undated";
	const day = time.toISOString().slice(0, 10);
	return DAY.test(day) ? day : "undated";
}
/** The downloads root, where exports go: `~/Downloads/agent-communications` unless the config says otherwise. */
async function downloadsRoot(context) {
	const configured = (await context.config()).defaults.downloadsDir;
	const root = configured ? expandHome(configured, homeDirectory(context.env)) : context.core.paths.downloadsDir;
	await ensurePrivateDir(root);
	return root;
}
/** The command that answers a download's question at a person's own terminal, under a `confirm` change policy. */
const APPROVE_COMMAND = "agent-gmail approve";
/**
* Downloads specific attachments — where the person says, and only once they have said it.
*
* Without an answer nothing is saved. The messages are read, and what comes back is the question: the attachments
* the request names, by name and size, and three places to save them, the first two by their exact paths — see core's
* `save-destination.ts`. With the person's answer and the question's `choiceId` the question is claimed, for these
* messages and these attachments only — under this mailbox's change policy, so that under `confirm` only an answer the
* person gave at their terminal or in a trusted form will do — and each attachment is saved in the chosen folder, never
* one on core's deny list (`save-deny.ts`), under the name its sender gave it, made safe by `savedFileName`, created
* exclusively and never through a link or over a file already there. Nothing else is written into that folder.
*
* A download that stops part-way — a part Gmail will not hand over, a file that cannot be written — records what it
* saved, in the manifest and the audit log, removes a file it wrote only part of, and ends in an error that says what
* was saved and what was not.
*
* The attachment id is resolved fresh from the message each time: Gmail's ids are reported to change between fetches,
* and a stale one fails in a way that looks like the file is gone.
*/
async function downloadAttachments(context, alias, targets, options = {}) {
	if (targets.length === 0) throw new CommsError("USAGE", "name the messages whose attachments to save", { hint: context.surface === "mcp" ? "Pass one message id or more in `messageIds`." : "Pass one message id or more." });
	const maxFiles = numberOption(context, options.maxFiles, MAX_FILES) ?? 50;
	const answer = checkDownloadAnswer(options, context.surface);
	const resolved = await context.inbox(alias);
	await context.requireCapability(resolved, "read");
	const transport = await context.transport(alias);
	const maxBytes = options.maxBytes ?? 524288e3;
	const planned = [];
	const skipped = [];
	const boundary = newBoundary();
	for (const target of targets) {
		const message = await transport.getMessage(target.messageId);
		const parts = readParts(message.payload);
		const envelope = {
			boundary,
			inbox: alias,
			id: message.id ?? target.messageId
		};
		const headers = message.payload?.headers ?? [];
		const address = parseAddressList(headerValue(headers, "From"))[0]?.address;
		const from = address === void 0 ? null : addressField(address, "from-address", envelope);
		const subject = wrapField(decodeHeaderWords(headerValue(headers, "Subject") ?? "").slice(0, 120), "subject", envelope);
		const date = message.internalDate ? new Date(Number(message.internalDate)).toISOString() : null;
		const chosen = target.partId ? parts.attachments.filter((candidate) => candidate.partId === target.partId) : target.filename !== void 0 ? parts.attachments.filter((candidate) => candidate.filename === target.filename) : parts.attachments;
		if (chosen.length === 0) {
			skipped.push({
				messageId: target.messageId,
				partId: target.partId ?? "",
				reason: "no such attachment"
			});
			continue;
		}
		for (const part of chosen) {
			if (planned.length >= maxFiles) {
				skipped.push({
					messageId: target.messageId,
					partId: part.partId,
					reason: `more than ${maxFiles} files`
				});
				continue;
			}
			if (!part.attachmentId) {
				skipped.push({
					messageId: target.messageId,
					partId: part.partId,
					reason: "this part holds no downloadable bytes (a Drive link, perhaps)"
				});
				continue;
			}
			const saved = savedName(decodeHeaderWords(part.filename ?? ""), `${slug(target.messageId, 64, "message")}-part-${slug(part.partId, 32, "root")}`);
			planned.push({
				messageId: target.messageId,
				part,
				name: saved.name,
				given: saved.given,
				renamed: saved.renamed,
				listed: {
					messageId: target.messageId,
					partId: part.partId,
					filename: filenameField(part.filename, envelope),
					size: part.size,
					mimeType: mimeTypeField(part.mimeType, envelope),
					from,
					subject,
					date,
					riskFlags: attachmentRisks(part.filename ?? "", part.mimeType)
				}
			});
		}
	}
	const request = {
		target: {
			kind: "inbox",
			name: alias,
			id: resolved.inbox.id
		},
		operation: "attachments.download",
		request: {
			targets: targets.map((target) => ({
				messageId: target.messageId,
				partId: target.partId ?? null,
				filename: target.filename ?? null
			})),
			maxFiles
		},
		files: planned.map((entry) => `${entry.messageId}/${entry.part.partId}`),
		names: planned.map((entry) => entry.name)
	};
	const config = await context.config();
	const folders = () => saveFolders({
		configured: config.defaults.downloadsDir,
		env: context.env,
		cwd: context.cwd
	});
	const policy = effectiveChangePolicy(config, { inbox: alias });
	if (answer.kind === "none") {
		if (planned.length === 0) return nothingToSave(skipped);
		return {
			...await askWhereToSave(context.core, {
				request,
				folders: folders(),
				configured: Boolean(config.defaults.downloadsDir),
				count: planned.length,
				bytes: planned.reduce((sum, entry) => sum + entry.part.size, 0),
				listing: planned.map((entry) => ({
					name: entry.name,
					size: entry.part.size,
					renamed: entry.renamed,
					flags: entry.listed.riskFlags
				})),
				policy,
				approveCommand: APPROVE_COMMAND,
				surface: context.surface,
				tool: "gmail_attachment_download",
				env: context.env
			}),
			files: planned.map((entry) => entry.listed),
			skipped,
			totalBytes: planned.reduce((sum, entry) => sum + entry.part.size, 0)
		};
	}
	if (answer.kind === "person" && planned.length === 0) return nothingToSave(skipped);
	const destination = await settleDestination(context.core, {
		answer,
		request,
		folders,
		policy,
		approveCommand: APPROVE_COMMAND,
		surface: context.surface,
		env: context.env,
		signal: options.signal
	});
	const files = [];
	const writtenAs = /* @__PURE__ */ new Map();
	const warned = [];
	const unmarked = [];
	let totalBytes = 0;
	let stopped;
	let leftBehind;
	let at = 0;
	try {
		for (; at < planned.length; at += 1) {
			const { messageId, part, listed, name, given, renamed } = planned[at];
			const fileId = `${messageId}/${part.partId}`;
			if (totalBytes + part.size > maxBytes) {
				skipped.push({
					messageId,
					partId: part.partId,
					reason: `more than ${maxBytes} bytes in one batch`
				});
				continue;
			}
			const bytes = await transport.getAttachment(messageId, part.attachmentId, {
				partId: part.partId,
				size: part.size,
				signal: options.signal
			});
			const sha256 = createHash("sha256").update(bytes).digest("hex");
			const envelope = {
				boundary,
				inbox: alias,
				id: messageId
			};
			const same = writtenAs.get(`${name}\u0000${sha256}`);
			if (same) {
				files.push({
					...savedFields(listed, same),
					size: bytes.byteLength,
					sha256,
					duplicate: true
				});
				continue;
			}
			const created = await createSavedFile(destination, name, { fileId });
			let marking;
			try {
				marking = await (options.mark ?? markFromInternet)(created.path);
				await (options.write ?? ((handle, data) => handle.writeFile(data)))(created.handle, bytes);
				await created.handle.close();
			} catch (error) {
				await created.handle.close().catch(() => void 0);
				await rm(created.path, { force: true }).catch(() => {
					leftBehind = {
						fileId,
						path: savedNameFields(created.path, envelope).path
					};
				});
				throw saveFailure(error, {
					folder: destination.folder,
					fileId
				});
			}
			const shown = {
				...savedNameFields(created.path, envelope),
				marked: marking.mark
			};
			writtenAs.set(`${name}\u0000${sha256}`, shown);
			totalBytes += bytes.byteLength;
			files.push({
				...savedFields(listed, shown),
				size: bytes.byteLength,
				sha256,
				duplicate: false
			});
			const position = files.length;
			const savedAs = basename(created.path);
			warned.push({
				given,
				savedAs,
				renamed,
				flags: listed.riskFlags,
				position
			});
			if (marking.failure !== void 0) unmarked.push(`${isPlainFileName(savedAs) ? savedAs : `file ${position}`} is not marked as downloaded from the internet: ${marking.failure}`);
		}
	} catch (error) {
		stopped = { error };
	}
	const stoppedBefore = [];
	if (stopped !== void 0) for (const { messageId, part } of planned.slice(at)) {
		const fileId = `${messageId}/${part.partId}`;
		stoppedBefore.push(fileId);
		skipped.push({
			messageId,
			partId: part.partId,
			cause: "stopped",
			reason: leftBehind?.fileId === fileId ? `the download stopped while it was being written, and the part written could not be removed: ${leftBehind.path}` : "the download stopped before this file was saved"
		});
	}
	const now = context.now();
	const manifestPath = downloadRecordPath(context.core, now, destination.choiceId);
	const result = {
		destinationRequired: false,
		folder: destination.folder,
		chosen: destination.choice,
		files,
		skipped,
		manifestPath,
		totalBytes,
		warnings: [...fileWarnings(warned, "result"), ...unmarked]
	};
	let manifestFailure;
	try {
		await writeFileAtomic(manifestPath, `${JSON.stringify({
			at: now.toISOString(),
			inbox: alias,
			choiceId: destination.choiceId,
			answeredVia: destination.answeredVia,
			complete: stopped === void 0,
			...result
		}, null, 2)}\n`);
	} catch (error) {
		manifestFailure = { error };
	}
	const savedCount = files.filter((file) => !file.duplicate).length;
	let auditFailure;
	try {
		await context.core.audit.append({
			inboxId: resolved.inbox.id,
			alias,
			operation: "attachments.download",
			outcome: stopped === void 0 && manifestFailure === void 0 ? "ok" : "failed",
			surface: context.surface,
			ids: {
				messageIds: targets.map((target) => target.messageId),
				savedParts: files.filter((file) => !file.duplicate).map((file) => `${file.messageId}/${file.partId}`),
				...stoppedBefore.length === 0 ? {} : { stoppedBefore: [...stoppedBefore] }
			},
			...destination.choiceId ? { approvalId: destination.choiceId } : {},
			reason: `${savedCount} file(s), ${totalBytes} bytes, saved to ${destination.folder} (${destination.choice}, answered ${destination.answeredVia === "flag" ? "by flag" : `in ${destination.answeredVia}`}); ${skipped.length} skipped${stopped === void 0 ? "" : "; stopped part-way"}${manifestFailure === void 0 ? "" : "; the manifest not written"}${leftBehind === void 0 ? "" : `; part of ${leftBehind.fileId} could not be removed from ${destination.folder}`}`
		});
	} catch (error) {
		auditFailure = { error };
	}
	if (stopped === void 0 && manifestFailure === void 0 && auditFailure === void 0) return result;
	throw unfinished({
		stopped,
		manifestFailure,
		auditFailure,
		files: files.filter((file) => !file.duplicate),
		folder: destination.folder,
		manifestPath,
		stoppedBefore,
		leftBehind
	});
}
/** A failure's message, whatever was thrown. By here a file-system error has been made one naming no sender's name. */
function messageOf$1(error) {
	return error instanceof Error ? error.message : String(error);
}
/**
* The error a download ends with once files may be on disk: what went wrong, what was saved and where it is listed,
* which parts it stopped before, and any part-written file it could not remove — as Slack's `unfinished` says it.
*
* Parts are named by their ids, `<message id>/<part id>`, and the folder by its path: a saved name is the sender's
* words, and a hint is the tool's. A part-written file's path is carried as `savedNameFields` carries any path, inside
* the envelope unless its name is plainly a file name. A refusal the download stopped on keeps its own code and hint;
* anything else is `CONFIG`, as another file this machine could not write is.
*/
function unfinished(state) {
	const { stopped, manifestFailure, auditFailure, files, folder, manifestPath, stoppedBefore, leftBehind } = state;
	const cause = (stopped ?? manifestFailure ?? auditFailure)?.error;
	const own = cause instanceof CommsError ? cause : void 0;
	const count = files.length;
	const them = count === 1 ? "it" : "them";
	const ids = files.map((file) => `${file.messageId}/${file.partId}`);
	const savedSoFar = count === 0 ? "" : `${count === 1 ? "the file was" : "the files were"} saved`;
	let message;
	if (stopped !== void 0) message = `the download stopped part-way: ${messageOf$1(stopped.error)}`;
	else if (manifestFailure !== void 0) message = `${savedSoFar === "" ? "" : `${savedSoFar}, but `}the manifest could not be written: ${messageOf$1(manifestFailure.error)}`;
	else message = `${savedSoFar === "" ? "" : `${savedSoFar} and the manifest lists ${them}, but `}the audit log could not be written: ${messageOf$1(auditFailure?.error)}`;
	const hint = [];
	if (own?.hint !== void 0) hint.push(own.hint);
	if (count === 0) hint.push("Nothing was saved.");
	else {
		const listed = manifestFailure === void 0 ? `, and the manifest at ${manifestPath} lists ${them}` : auditFailure === void 0 ? ", and the audit log records which" : `, and nothing else records ${count === 1 ? "it" : "which"}: ${ids.join(", ")}, in ${folder}`;
		hint.push(`${count === 1 ? "1 file was" : `${count} files were`} saved${stopped === void 0 ? "" : " before it stopped"}${listed}.`, `Downloading again saves ${count === 1 ? "that file" : "each of those files"} a second time, so ask only for what is missing.`);
	}
	if (stoppedBefore.length > 0) {
		const which = stoppedBefore.length === 1 ? "The attachment it stopped before is" : `The ${stoppedBefore.length} attachments it stopped before are`;
		hint.push(manifestFailure === void 0 ? `${which} in the manifest under \`skipped\`, as \`stopped\`.` : auditFailure === void 0 ? `${which} in the audit log.` : `${which} ${stoppedBefore.join(", ")}.`);
	}
	if (leftBehind !== void 0) hint.push(`Part of ${leftBehind.fileId} was written and could not be removed: delete it — it is not the whole file. It is ${leftBehind.path}`);
	return new CommsError(own?.code ?? "CONFIG", message, {
		hint: hint.join(" "),
		details: {
			...own?.details ?? {},
			saved: count,
			savedFiles: files.map((file) => ({
				messageId: file.messageId,
				partId: file.partId,
				path: file.path
			})),
			stoppedBefore: [...stoppedBefore],
			partialFile: leftBehind?.path ?? null,
			manifestPath: manifestFailure === void 0 ? manifestPath : null,
			audited: auditFailure === void 0
		}
	});
}
/** A download with nothing in it to save: said, with each reason, and nothing asked, made or written. */
function nothingToSave(skipped) {
	return {
		destinationRequired: false,
		folder: null,
		chosen: null,
		files: [],
		skipped,
		manifestPath: null,
		totalBytes: 0,
		warnings: []
	};
}
/** A listed attachment as saved: what the question said of it, with where it went. */
function savedFields(listed, saved) {
	return {
		filename: listed.filename,
		savedAs: saved.savedAs,
		path: saved.path,
		partId: listed.partId,
		mimeType: listed.mimeType,
		messageId: listed.messageId,
		from: listed.from,
		subject: listed.subject,
		date: listed.date,
		riskFlags: listed.riskFlags,
		marked: saved.marked
	};
}
/**
* The saved name and path as a result carries them: bare while the name is plainly a file name, and otherwise inside
* the envelope — the name is the sender's, and `Ignore previous instructions.txt` is still a sentence on disk.
*/
function savedNameFields(path, envelope) {
	const savedAs = basename(path);
	if (isPlainFileName(savedAs)) return {
		path,
		savedAs
	};
	return {
		path: wrapField(path, "saved-path", envelope),
		savedAs: wrapField(savedAs, "saved-as", envelope)
	};
}
//#endregion
//#region src/operations/clients.ts
/** Where secrets can be kept. */
const STORE_KINDS = ["keychain", "file"];
/** A secret store as somebody named it, `undefined` when they did not, or the USAGE refusal naming the two there are. */
function parseStore(value) {
	return oneOf(value, STORE_KINDS, "a secret store");
}
/**
* Reads a downloaded client JSON from a path somebody named, and checks it is a Desktop client.
*
* Shared by `client add` and by the change that prepares it, so what a person approves is the file as it was read,
* and the same file is what gets registered: the change keeps this result and registers it, rather than reading
* the path a second time after the approval, when it could hold something else.
*/
async function readClientFile(context, given) {
	const path = resolve(expandHome(given, homeDirectory(context.env)));
	const file = await readSmallFile(path, { follow: true });
	if (!file.ok) {
		if (file.problem === "missing") throw new CommsError("NOT_FOUND", `no file at ${path}`, { hint: "Download the client JSON from Google Cloud → Google Auth Platform → Clients, and pass its path." });
		throw new CommsError("USAGE", file.problem === "not-a-file" ? `${path} is not a file` : `${path} is far too large to be a client JSON (over ${Math.round(MAX_CLIENT_BYTES / 1024)}KB)`, { hint: "Pass the JSON Google offered when the Desktop client was created; it is well under a kilobyte." });
	}
	return {
		path,
		client: parseClientJson(file.text)
	};
}
/**
* Refuses a registration that would replace what is there: a name already taken, or a different client under it
* while mailboxes still sign in through it. Checked when the change is planned — so an approval is never asked for a
* registration that would only be refused — and again under the lock, where it counts.
*/
function refuseClientConflict(config, name, parsed, replace, platform) {
	const existing = config.clients[name];
	refuseOrganisationRow(config, name, "replace", platform);
	if (existing && !replace) throw new CommsError("CONFIG", `an OAuth client called "${name}" is already registered`, { hint: existing.clientId === parsed.clientId ? `To rotate its secret, run the same command with --replace.` : `Choose another name with --name, or remove it first with ${inlineCommand(shellCommand([
		"agent-gmail",
		"client",
		"remove",
		name
	], platform))}.` });
	if (existing && replace && existing.clientId !== parsed.clientId) {
		const users = inboxesOf(config.inboxes, name);
		if (users.length > 0) throw new CommsError("CONFIG", `"${name}" is a different OAuth client, and ${users.length} inbox(es) use it`, { hint: `Replacing it would break ${users.join(", ")}. Add the new client under another name, then \`inbox reauth\` each inbox onto it.` });
	}
}
/**
* Refuses to replace or remove a client an organisation profile made and owns (design 2026-10-02 §D4).
*
* Its row carries `organisation`, and it changes with the profile: `org update` rotates its secret or rebuilds it, and
* `org remove` removes it. Replaced here, the profile would rebuild it over the person's client on its next update, or
* removal would leave a record naming a client that is gone — so the refusal points at the command that does it. A
* mark naming an organisation with no record here refuses nothing: no `org` command could change that row, and a row
* no command can change is the one outcome the design rules out.
*/
function refuseOrganisationRow(config, name, act, platform) {
	const organisation = managingOrganisation(config, Object.hasOwn(config.clients, name) ? config.clients[name] : void 0);
	if (organisation === null) return;
	throw new CommsError("CONFIG", `the OAuth client "${name}" belongs to the organisation profile "${organisation}", so ${act === "replace" ? "it is replaced" : "it is removed"} with the profile`, { hint: act === "replace" ? `To read the profile again — a new secret, a repaired client — run ${inlineCommand(shellCommand([
		"agentcomms",
		"org",
		"update",
		organisation
	], platform))}. To register a client of your own, choose another name with --name.` : `To stop using the organisation's apps, run ${inlineCommand(shellCommand([
		"agentcomms",
		"org",
		"remove",
		organisation
	], platform))}; if the client has drifted from the profile, ${inlineCommand(shellCommand([
		"agentcomms",
		"org",
		"update",
		organisation
	], platform))} repairs it.` });
}
/**
* Registering an OAuth client, as one change both surfaces run through core's flow.
*
* A client loosens nothing the config store measures — it grants no mailbox anything by itself — but every mailbox
* connected through it signs in with it, and a client from somebody else's Cloud project is a way to have that
* somebody's app hold the grant. So it is approved like a loosening, by its effects, and the preview names the
* client by its id and project: public values that appear in every sign-in link. Never the secret.
*
* The file is read when the change is planned, and what that read found is what `apply` registers.
*/
function clientAddChange(context, request) {
	const options = {
		...request,
		store: parseStore(request.store)
	};
	let read;
	return {
		plan: async (config) => {
			read = await readClientFile(context, options.path);
			const name = options.name ?? "default";
			refuseClientConflict(config, name, read.client, options.replace === true, context.platform);
			const store = await chooseStore(context, options.store);
			const existing = config.clients[name];
			const after = structuredClone(config);
			after.secrets = { store };
			after.clients[name] = gmailClientRow({
				name,
				clientId: read.client.clientId,
				projectId: read.client.projectId,
				addedAt: existing?.addedAt ?? context.now().toISOString()
			});
			const project = read.client.projectId ? ` from the Google Cloud project ${read.client.projectId}` : "";
			return {
				before: config,
				after,
				summary: existing ? `Replace the secret of the OAuth client "${name}"` : `Register the OAuth client "${name}", which mailboxes sign in through`,
				effects: [
					`registers the OAuth client ${read.client.clientId}${project} as "${name}", and keeps its secret in the ${store} store on this machine`,
					...existing ? [`replaces the secret "${name}" holds now`] : [],
					...options.move ? [`deletes ${read.path} once the secret is stored`] : []
				]
			};
		},
		apply: (consent) => {
			if (!read) throw new CommsError("UNEXPECTED", "the client file was not read before it was registered");
			return registerClient(context, read, {
				...options,
				consent
			});
		}
	};
}
async function registerClient(context, file, options) {
	const name = options.name ?? "default";
	const { path, client: parsed } = file;
	const config = await context.config();
	const existing = config.clients[name];
	refuseClientConflict(config, name, parsed, options.replace === true, context.platform);
	const chosen = await chooseStore(context, options.store);
	let probed = false;
	let probeSkippedReason;
	if (!options.noProbe) {
		const probe = await probeClientCredentials(context.endpoints, parsed);
		if (probe.ok) probed = true;
		else if (probe.fatal) throw probe.error;
		else probeSkippedReason = probe.reason;
	}
	const secrets = await context.core.secrets(chosen);
	const secretRef = clientSecretRef(name);
	const client = await withCredentialsLock(context.core.paths.configDir, async () => {
		const fresh = await context.config();
		if ((committedSecretsStore(fresh) ?? chosen) !== chosen) throw new CommsError("TRANSIENT", "the secret store was changed while this ran", { hint: "Run the command again." });
		const held = fresh.clients[name];
		refuseOrganisationRow(fresh, name, "replace", context.platform);
		if (held && !options.replace) throw new CommsError("CONFIG", `an OAuth client called "${name}" was registered while this ran`, { hint: "Run the command again to see what is there now." });
		if (held && options.replace && held.clientId !== parsed.clientId && inboxesOf(fresh.inboxes, name).length > 0) throw new CommsError("CONFIG", `"${name}" is a different OAuth client, and mailboxes use it`, { hint: "Add the new client under another name, then `inbox reauth` each mailbox onto it." });
		if (held && options.replace && held.clientId !== existing?.clientId) throw new CommsError("CONFIG", `the OAuth client "${name}" changed while this ran`, { hint: "Run the command again to see what is there now." });
		const row = gmailClientRow({
			name,
			clientId: parsed.clientId,
			projectId: parsed.projectId,
			addedAt: existing?.addedAt ?? context.now().toISOString()
		});
		await writeSecretWithRestore({
			secrets,
			secretRef,
			secret: parsed.clientSecret,
			commit: async (refuse) => {
				await context.core.config.update((current) => {
					refuse(true);
					if ((committedSecretsStore(current) ?? chosen) !== chosen) throw new CommsError("TRANSIENT", "the secret store was changed while this ran", { hint: "Run the command again." });
					refuseOrganisationRow(current, name, "replace", context.platform);
					const held = current.clients[name];
					if (held && held.clientId !== parsed.clientId && inboxesOf(current.inboxes, name).length > 0) throw new CommsError("CONFIG", `"${name}" is a different OAuth client, and mailboxes use it`, { hint: "Add the new client under another name, then `inbox reauth` each mailbox onto it." });
					refuse(false);
					return {
						...current,
						secrets: { store: chosen },
						clients: {
							...current.clients,
							[name]: row
						}
					};
				}, options.consent ? { consent: options.consent } : {});
			},
			landed: async () => {
				const held = (await context.config()).clients[name];
				return held !== void 0 && JSON.stringify(held) === JSON.stringify(row);
			},
			howToCheck: `Run ${inlineCommand(shellCommand([
				"agent-gmail",
				"client",
				"list"
			], context.platform))}.`,
			restoreHint: `register the client again; see ${inlineCommand(shellCommand([
				"agent-gmail",
				"client",
				"add",
				"--help"
			], context.platform))} and use its JSON with ${inlineCommand(shellCommand([
				"--name",
				name,
				"--replace"
			], context.platform))}.`
		});
		return row;
	});
	await clearSetupProgress(context.core.paths.stateDir).catch(() => void 0);
	let sourceRemoved = false;
	if (options.move) {
		await rm(path, { force: true });
		sourceRemoved = true;
	}
	return {
		...view(name, client, await context.config().then((c) => inboxesOf(c.inboxes, name))),
		store: chosen,
		sourceRemoved,
		probed,
		probeSkippedReason
	};
}
/**
* The store this registration keeps its secret in: the one the configuration already uses — recorded, or the keychain
* that a Slack token already sits in — or, when nothing is stored yet, the one asked for. A different one is refused
* before anybody is asked to approve it (`secretsStoreFor`): switching here would record a store and move nothing.
*/
async function chooseStore(context, requested) {
	return (await chooseSecretStore(await context.config(), requested, { platform: context.platform })).store;
}
async function clientList(context) {
	const config = await context.config();
	return Object.entries(config.clients).map(([name, client]) => view(name, client, inboxesOf(config.inboxes, name)));
}
/**
* Removing an OAuth client, as one change both surfaces run through core's flow.
*
* It loosens nothing, and it is refused while any mailbox signs in through the client; what needs approval is that it
* cannot be taken back. The secret is deleted from this machine, and Google shows a client secret once — so adding
* the client again takes the JSON downloaded when it was made, or a new secret. The approval binds the client by its
* id, and so does the removal.
*/
function clientRemoveChange(context, name) {
	let planned;
	return {
		plan: (config) => {
			const client = requireRemovableClient(config, name, context.platform);
			planned = client.clientId;
			const after = structuredClone(config);
			delete after.clients[name];
			return {
				before: config,
				after,
				summary: `Remove the OAuth client "${name}"`,
				effects: [`forgets the OAuth client ${client.clientId} registered as "${name}", and deletes its secret from this machine; Google shows a client secret once, so adding it back takes its downloaded JSON or a new secret`]
			};
		},
		apply: () => clientRemove(context, name, { expectedClientId: planned })
	};
}
/**
* Forgets an OAuth client and deletes its secret.
*
* `expectedClientId` is the client an approval was given for: the name can be given to another client between that
* approval and this call, and that one is not what the person agreed to remove.
*/
async function clientRemove(context, name, options = {}) {
	return withCredentialsLock(context.core.paths.configDir, () => removeClientLocked(context, name, options));
}
/** The client registered under `name`, or the refusal: none there, or mailboxes still signing in through it. */
function requireRemovableClient(config, name, platform) {
	const client = Object.hasOwn(config.clients, name) ? config.clients[name] : void 0;
	if (!client) throw new CommsError("NOT_FOUND", `no OAuth client called "${name}"`, { hint: Object.keys(config.clients).length ? `Known clients: ${Object.keys(config.clients).join(", ")}.` : "None are registered yet." });
	refuseOrganisationRow(config, name, "remove", platform);
	const users = inboxesOf(config.inboxes, name);
	if (users.length > 0) throw new CommsError("CONFIG", `${users.length} inbox(es) still sign in through "${name}"`, { hint: `Remove them first (${users.join(", ")}), or move them to another client; see ${inlineCommand(shellCommand([
		"agent-gmail",
		"inbox",
		"reauth",
		"--help"
	], platform))}.` });
	return client;
}
async function removeClientLocked(context, name, options) {
	const client = requireRemovableClient(await context.config(), name, context.platform);
	if (options.expectedClientId !== void 0 && client.clientId !== options.expectedClientId) throw new CommsError("CONFIG", `"${name}" is no longer the OAuth client this removal was approved for`, { hint: "Nothing was removed. Prepare the removal again, and read the preview before approving it." });
	try {
		await context.core.config.update((current) => {
			refuseOrganisationRow(current, name, "remove", context.platform);
			if (current.clients[name]?.clientId !== client.clientId) throw new CommsError("CONFIG", `the OAuth client "${name}" changed while it was being removed`, { hint: "Run the command again to see what is there now." });
			const attached = inboxesOf(current.inboxes, name);
			if (attached.length > 0) throw new CommsError("CONFIG", `${attached.length} inbox(es) began using "${name}" while it was being removed`, { hint: `Remove them first (${attached.join(", ")}), or move them; see ${inlineCommand(shellCommand([
				"agent-gmail",
				"inbox",
				"reauth",
				"--help"
			], context.platform))}.` });
			const clients = { ...current.clients };
			delete clients[name];
			return {
				...current,
				clients
			};
		});
	} catch (error) {
		const gone = await writeOutcome(async () => (await context.config()).clients[name] === void 0);
		if (gone === "absent") throw error;
		if (gone === "unknown") throw keepAndReport(error, client.secretRef, `Run ${inlineCommand(shellCommand([
			"agent-gmail",
			"client",
			"list"
		], context.platform))}.`);
	}
	await (await context.core.secrets()).delete(client.secretRef);
	return { name };
}
function inboxesOf(inboxes, name) {
	return Object.entries(inboxes).filter(([, inbox]) => inbox.client === name).map(([alias]) => alias);
}
function view(name, client, inboxes) {
	return {
		name,
		clientId: client.clientId,
		projectId: client.projectId,
		addedAt: client.addedAt,
		inboxes
	};
}
//#endregion
//#region src/operations/confirm-clients.ts
/**
* Which MCP clients may be trusted to put an approval form in front of a person.
*
* Under the `confirm` policy the approval has to come from a channel the model cannot answer. An MCP form elicitation
* is such a channel **only if the client actually shows it to a human** — `clientInfo.name` is self-reported, and a
* client that auto-accepts forms, or answers them from the model, would turn the strongest gate in this package into
* a formality. So the list is empty by default and fail-closed, and a name reaches it only by evidence: the client
* raises a probe form carrying a code, a person types that code back, and only then may the name be added — with a
* change approval, from a chat or a terminal, the consent every other loosening needs.
*/
const PROBE_TTL_MS = 6e5;
const PROBE_FILE = "confirm-probes.json";
function probePath(context) {
	return join(context.core.paths.stateDir, PROBE_FILE);
}
async function readProbes(context) {
	try {
		const parsed = JSON.parse(await readFile(probePath(context), "utf8"));
		return {
			version: 1,
			probes: Array.isArray(parsed.probes) ? parsed.probes : []
		};
	} catch {
		return {
			version: 1,
			probes: []
		};
	}
}
async function writeProbes(context, file) {
	await ensurePrivateDir(context.core.paths.stateDir);
	const cutoff = context.now().getTime() - 36e5;
	const probes = file.probes.filter((probe) => Date.parse(probe.at) >= cutoff);
	await writeFileAtomic(probePath(context), `${JSON.stringify({
		version: 1,
		probes
	}, null, 2)}\n`);
}
/** Records that a client raised a probe, and returns the code the human has to type back into it. */
async function startProbe(context, client) {
	const name = client.trim();
	if (!name) throw new CommsError("USAGE", "the client did not say what it is called");
	const file = await readProbes(context);
	const probeId = `pr_${randomBytes(9).toString("base64url")}`;
	const code = randomBytes(3).toString("base64url").slice(0, 4).toUpperCase();
	file.probes.push({
		probeId,
		client: name,
		at: context.now().toISOString(),
		completed: false
	});
	await writeProbes(context, file);
	return {
		probeId,
		code
	};
}
/** Marks a probe answered. Called only after the typed code matched, inside the tool that raised it. */
async function completeProbe(context, probeId) {
	const file = await readProbes(context);
	const probe = file.probes.find((entry) => entry.probeId === probeId);
	if (!probe) throw new CommsError("NOT_FOUND", "that probe is no longer on record");
	probe.completed = true;
	probe.at = context.now().toISOString();
	await writeProbes(context, file);
}
/** Has this client proved, in the last ten minutes, that its forms reach a person? */
async function hasRecentProbe(context, client) {
	const file = await readProbes(context);
	const cutoff = context.now().getTime() - PROBE_TTL_MS;
	return file.probes.some((probe) => probe.completed && probe.client === client.trim() && Date.parse(probe.at) >= cutoff);
}
async function listConfirmClients(context) {
	return (await context.config()).defaults.confirm.elicitationClients;
}
/** The refusal for a client that has not proved, in the last ten minutes, that its forms reach a person. */
async function requireRecentProbe(context, name) {
	if (!await hasRecentProbe(context, name)) throw new CommsError("APPROVAL_REQUIRED", `"${name}" has not shown that its approval forms reach a person`, { hint: `In that client, ask it to run the gmail_confirm_probe tool and type the code it shows. Then run this again within ten minutes.` });
}
/**
* Trusting a client's approval forms, as one change both surfaces run through core's flow.
*
* Two things have to be true, and they are different in kind. The probe is evidence that the client shows its forms
* to a person — checked when the change is planned, so nobody is asked to approve trusting a client that has not
* shown it, and again when it is written. The change approval is the decision, and core's classifier already counts
* a name added to `defaults.confirm.elicitationClients` as a loosening, so the store refuses the write without it.
* A name already on the list loosens nothing, and is applied at once.
*/
function confirmClientAddChange(context, client) {
	const name = client.trim();
	return {
		plan: async (config) => {
			if (!name) throw new CommsError("USAGE", "name the client to trust");
			await requireRecentProbe(context, name);
			const after = structuredClone(config);
			after.defaults.confirm.elicitationClients = [.../* @__PURE__ */ new Set([...config.defaults.confirm.elicitationClients, name])];
			return {
				before: config,
				after,
				summary: `Trust "${name}" to show you approval forms for sends`
			};
		},
		apply: (consent) => addConfirmClient(context, name, consent)
	};
}
/**
* Adds a client to the allowlist. Refused unless that client completed a probe in the last ten minutes, and refused
* again by the config store unless the caller carries consent — which only a change approval a person gave yields.
*/
async function addConfirmClient(context, client, consent) {
	const name = client.trim();
	if (!name) throw new CommsError("USAGE", "name the client to trust");
	await requireRecentProbe(context, name);
	const config = await context.core.config.update((current) => ({
		...current,
		defaults: {
			...current.defaults,
			confirm: {
				...current.defaults.confirm,
				elicitationClients: [.../* @__PURE__ */ new Set([...current.defaults.confirm.elicitationClients, name])]
			}
		}
	}), consent ? { consent } : {});
	await context.core.audit.append({
		inboxId: "",
		operation: "confirm-clients.add",
		outcome: "ok",
		surface: context.surface,
		reason: name
	});
	return config.defaults.confirm.elicitationClients;
}
/** Removes a client. Trusting one fewer client is a tightening, so it needs nothing but the command. */
async function removeConfirmClient(context, client) {
	const name = client.trim();
	const config = await context.core.config.update((current) => ({
		...current,
		defaults: {
			...current.defaults,
			confirm: {
				...current.defaults.confirm,
				elicitationClients: current.defaults.confirm.elicitationClients.filter((entry) => entry !== name)
			}
		}
	}));
	await context.core.audit.append({
		inboxId: "",
		operation: "confirm-clients.remove",
		outcome: "ok",
		surface: context.surface,
		reason: name
	});
	return config.defaults.confirm.elicitationClients;
}
//#endregion
//#region src/operations/contacts.ts
/** Where an address can come from: the saved address book, Google's "other contacts", and past mail's headers. */
const CONTACT_SOURCES = [
	"contacts",
	"other-contacts",
	"history"
];
const CONTACTS_LIMIT = {
	flag: "--limit",
	arg: "limit",
	min: 1,
	max: 50
};
const RANK = {
	contacts: 0,
	history: 1,
	"other-contacts": 2
};
async function searchContacts(context, query, options = {}) {
	if (!query.trim()) throw new CommsError("USAGE", "searching contacts needs something to search for", { hint: "Pass a name, part of an address, or a domain." });
	const sources = new Set(allOf(options.sources, CONTACT_SOURCES, "a source") ?? CONTACT_SOURCES);
	if (options.sources !== void 0 && sources.size === 0) {
		const name = context.surface === "mcp" ? "`sources`" : "`--sources`";
		throw new CommsError("USAGE", `${name} names no source, so nothing would be searched`, { hint: `Name one or more of ${spoken(CONTACT_SOURCES)}, or leave ${name} out to look in all three.` });
	}
	const limit = numberOption(context, options.limit, CONTACTS_LIMIT) ?? 20;
	const aliases = await resolveInboxes(context, options.inboxes);
	const errors = [];
	const found = /* @__PURE__ */ new Map();
	const add = (alias, entry) => {
		const email = canonicalAddress(entry.email);
		const name = neutralise(entry.name).text;
		const key = `${alias}:${email}`;
		const existing = found.get(key);
		if (existing) {
			if (!existing.sources.includes(entry.source)) existing.sources.push(entry.source);
			if (entry.source === "history") existing.messages += 1;
			if (entry.at && (!existing.lastSeen || entry.at > existing.lastSeen)) existing.lastSeen = entry.at;
			if (!existing.name && name) existing.name = name;
			return;
		}
		found.set(key, {
			name,
			email,
			inbox: alias,
			sources: [entry.source],
			messages: entry.source === "history" ? 1 : 0,
			lastSeen: entry.at ?? null
		});
	};
	for (const alias of aliases) try {
		const resolved = await context.inbox(alias);
		await context.requireCapability(resolved, "read");
		const transport = await context.transport(alias);
		if (sources.has("contacts") || sources.has("other-contacts")) {
			if (resolved.inbox.contacts) try {
				for (const match of await transport.searchContacts(query)) {
					if (!sources.has(match.source)) continue;
					add(alias, {
						name: match.name,
						email: match.email,
						source: match.source
					});
				}
			} catch (error) {
				const failure = error;
				errors.push({
					inbox: alias,
					code: failure.code ?? "UNEXPECTED",
					message: failure.message
				});
			}
			else errors.push({
				inbox: alias,
				code: "SCOPE_MISSING",
				message: `${alias} was not granted access to contacts, so only past mail was searched`
			});
		}
		if (sources.has("history")) {
			const page = await transport.listMessages({
				query: `from:${query} OR to:${query}`,
				maxResults: 25
			});
			for (const entry of page.ids.slice(0, 25)) {
				const message = await transport.getMessageMetadata(entry.id);
				const headers = message.payload?.headers ?? [];
				const at = message.internalDate ? new Date(Number(message.internalDate)).toISOString() : null;
				for (const header of [
					"From",
					"To",
					"Cc"
				]) for (const address of parseAddressList(headerValue(headers, header))) {
					if (address.address === resolved.inbox.email.toLowerCase()) continue;
					const needle = query.toLowerCase();
					if (!address.address.includes(needle) && !address.name.toLowerCase().includes(needle)) continue;
					add(alias, {
						name: address.name,
						email: address.address,
						source: "history",
						at
					});
				}
			}
		}
	} catch (error) {
		const failure = error;
		errors.push({
			inbox: alias,
			code: failure.code ?? "UNEXPECTED",
			message: failure.message
		});
	}
	return {
		query,
		contacts: [...found.values()].sort((a, b) => {
			const source = Math.min(...a.sources.map((s) => RANK[s])) - Math.min(...b.sources.map((s) => RANK[s]));
			if (source !== 0) return source;
			if (b.messages !== a.messages) return b.messages - a.messages;
			return (b.lastSeen ?? "").localeCompare(a.lastSeen ?? "");
		}).slice(0, limit),
		errors,
		complete: errors.length === 0
	};
}
/** Who a follow-up waits on: them, or me. */
const FOLLOW_UP_DIRECTIONS = ["them", "me"];
const OLDER_THAN_DAYS = {
	flag: "--older-than",
	arg: "olderThanDays",
	min: 0
};
const LOOKBACK_DAYS = {
	flag: "--lookback",
	arg: "lookbackDays",
	min: 1
};
const FOLLOW_UP_LIMIT = {
	flag: "--limit",
	arg: "limit",
	min: 1,
	max: 50
};
/**
* Threads that are waiting on somebody. Computed from Gmail's own view of what was sent and received, not from a
* model's reading of the text — a follow-up list that invents obligations is worse than none.
*/
async function followUps(context, options = {}) {
	const direction = oneOf(options.direction, FOLLOW_UP_DIRECTIONS, "a direction") ?? "them";
	const olderThanDays = numberOption(context, options.olderThanDays, OLDER_THAN_DAYS);
	const lookbackDays = numberOption(context, options.lookbackDays, LOOKBACK_DAYS);
	const limit = numberOption(context, options.limit, FOLLOW_UP_LIMIT) ?? 20;
	const aliases = await resolveInboxes(context, options.inboxes);
	const olderThan = olderThanDays ?? (direction === "me" ? 0 : 3);
	const lookback = Math.max(olderThan + 1, lookbackDays ?? 30);
	const query = direction === "them" ? `in:sent older_than:${olderThan}d newer_than:${lookback}d` : `in:inbox newer_than:${lookback}d -category:promotions -category:social -category:updates -category:forums`;
	const rows = [];
	const errors = [];
	for (const alias of aliases) try {
		const resolved = await context.inbox(alias);
		await context.requireCapability(resolved, "read");
		const transport = await context.transport(alias);
		const page = await transport.listThreads({
			query,
			maxResults: limit
		});
		for (const entry of page.ids) {
			if (rows.length >= limit) break;
			const thread = await transport.getThread(entry.id);
			const messages = [...thread.messages ?? []].sort((a, b) => Number(a.internalDate ?? 0) - Number(b.internalDate ?? 0));
			const last = messages.at(-1);
			if (!last) continue;
			const lastSent = (last.labelIds ?? []).includes("DRAFT") ? messages.filter((m) => !(m.labelIds ?? []).includes("DRAFT")).at(-1) : last;
			if (!lastSent) continue;
			const weSentLast = (lastSent.labelIds ?? []).includes("SENT");
			if (direction === "them" ? !weSentLast : weSentLast) continue;
			const headers = lastSent.payload?.headers ?? [];
			const at = lastSent.internalDate ? new Date(Number(lastSent.internalDate)) : null;
			const ageDays = at ? Math.floor((context.now().getTime() - at.getTime()) / 864e5) : 0;
			if (ageDays < olderThan) continue;
			const counterpart = weSentLast ? parseAddressList(headerValue(headers, "To"))[0]?.address ?? "unknown" : parseAddressList(headerValue(headers, "From"))[0]?.address ?? "unknown";
			rows.push({
				inbox: alias,
				threadId: thread.id ?? entry.id,
				messageId: lastSent.id ?? "",
				subject: neutralise(decodeHeaderWords(headerValue(headers, "Subject") ?? "").slice(0, 120)).text,
				with: counterpart,
				lastAt: at?.toISOString() ?? null,
				ageDays,
				direction: direction === "them" ? "awaiting-them" : "awaiting-me"
			});
		}
	} catch (error) {
		const failure = error;
		errors.push({
			inbox: alias,
			code: failure.code ?? "UNEXPECTED",
			message: failure.message
		});
	}
	rows.sort((a, b) => b.ageDays - a.ageDays);
	return {
		rows: rows.slice(0, limit),
		query,
		errors,
		complete: errors.length === 0
	};
}
//#endregion
//#region src/operations/inboxes.ts
function health(state) {
	if (state.lastError) return "needs-attention";
	return state.lastRefreshOkAt ? "ok" : "unknown";
}
async function inboxList(context) {
	const config = await context.config();
	const views = [];
	for (const [alias, inbox] of Object.entries(config.inboxes)) {
		const state = await context.core.states.get(inbox.id);
		const organisation = organisationForClient(config, inbox.client);
		views.push({
			alias,
			id: inbox.id,
			email: inbox.email,
			tier: tierOf(inbox.grantedScopes) ?? inbox.tier,
			capabilities: [...capabilitiesOf(inbox.grantedScopes)],
			contacts: inbox.contacts,
			sendPolicy: effectiveSendPolicy(config, alias),
			sendPolicyInherited: inbox.sendPolicy === void 0,
			changePolicy: inbox.changePolicy ?? defaultChangePolicy(config),
			changePolicyInherited: inbox.changePolicy === void 0,
			client: inbox.client,
			...organisation ? { organisation } : {},
			identity: inbox.identity,
			createdAt: inbox.createdAt,
			lastRefreshOkAt: state.lastRefreshOkAt,
			lastUsedAt: state.lastUsedAt,
			health: health(state),
			lastError: state.lastError
		});
	}
	return views.sort((a, b) => a.alias.localeCompare(b.alias));
}
async function inboxShow(context, alias) {
	const { inbox } = await context.inbox(alias);
	const view = (await inboxList(context)).find((candidate) => candidate.id === inbox.id);
	if (!view) throw new CommsError("NOT_FOUND", `no inbox called "${alias}"`);
	return {
		...view,
		grantedScopes: inbox.grantedScopes,
		internalDomains: inbox.internalDomains
	};
}
async function inboxRename(context, from, to) {
	const { inbox } = await context.inbox(from);
	if (RESERVED_ALIASES.has(to)) throw new CommsError("USAGE", `"${to}" is reserved: it means every inbox`, { hint: "Choose another name." });
	requireNewInboxName(await context.config(), to, "Choose another name.", context.platform);
	await context.core.config.update((current) => {
		const now = findById(current, "inbox", inbox.id);
		if (!now) throw new CommsError("NOT_FOUND", `no inbox called "${from}"`);
		requireNewInboxName(current, to, "Choose another name.", context.platform);
		return renameEntry(current, "inbox", now.alias, to);
	});
	context.forgetTransports();
	await context.core.audit.append({
		inboxId: inbox.id,
		alias: to,
		operation: "inbox.rename",
		outcome: "ok",
		surface: context.surface,
		reason: `was ${from}`
	});
	return {
		from,
		to,
		id: inbox.id
	};
}
const SEND_POLICIES = [
	"chat",
	"confirm",
	"never"
];
const CHANGE_POLICIES = ["chat", "confirm"];
/** A send policy as somebody typed it, or the refusal naming the three there are. */
function parseSendPolicy(value) {
	if (SEND_POLICIES.includes(value)) return value;
	throw new CommsError("USAGE", `"${value}" is not a send policy`, { hint: "Use chat, confirm or never." });
}
/** A change policy as somebody typed it, or the refusal naming the two there are. */
function parseChangePolicy(value) {
	if (CHANGE_POLICIES.includes(value)) return value;
	throw new CommsError("USAGE", `"${value}" is not a change policy`, { hint: "Use chat or confirm." });
}
/**
* The policies asked for, or the refusal: each has to be one of its values, and at least one has to be named.
*
* Checked before anything is read, so a word that is not a policy is refused the same way on both surfaces whatever
* the mailbox — and before a change approval could be prepared for it.
*/
function parsePolicies(request) {
	const sendPolicy = request.sendPolicy === void 0 ? void 0 : parseSendPolicy(request.sendPolicy);
	const changePolicy = request.changePolicy === void 0 ? void 0 : parseChangePolicy(request.changePolicy);
	if (sendPolicy === void 0 && changePolicy === void 0) throw new CommsError("USAGE", "name a policy to set: how sending is approved, how changes are approved, or both", { hint: "At a terminal: --send chat|confirm|never, --change chat|confirm. Over MCP: sendPolicy, changePolicy." });
	return {
		...sendPolicy ? { sendPolicy } : {},
		...changePolicy ? { changePolicy } : {}
	};
}
/**
* Setting how a mailbox's sends and changes are approved, as one change both surfaces run through core's flow.
*
* The plan is the mailbox as it would be with the policies set, so core's classifier — the one `ConfigStore.update`
* enforces with — decides which direction is a loosening. Nothing here decides it a second time: tightening loosens
* nothing and is applied at once, and a loosening is prepared for a person to approve and claimed on the next call.
* The change policy governs itself, so moving a mailbox off `confirm` is approved under `confirm`, at a terminal.
*/
function inboxPolicyChange(context, alias, request) {
	const wanted = parsePolicies(request);
	return {
		plan: (config) => {
			const inbox = requireInbox(config, alias);
			return {
				inbox: alias,
				before: config,
				after: {
					...config,
					inboxes: {
						...config.inboxes,
						[alias]: {
							...inbox,
							...wanted
						}
					}
				},
				summary: `${alias}: ${[...wanted.sendPolicy ? [`sends approved by ${wanted.sendPolicy}`] : [], ...wanted.changePolicy ? [`changes to its settings approved by ${wanted.changePolicy}`] : []].join("; ")}`
			};
		},
		apply: (consent) => inboxPolicy(context, alias, wanted, consent)
	};
}
/**
* Sets how sending from one inbox, and loosening its settings, must be approved.
*
* Tightening is always allowed. A loosening is refused by the config store unless `consent` covers it — the consent a
* claimed change approval yields (`inboxPolicyChange`). There is no second check here: the store is the one place a
* loosening is let through or refused, whichever surface asked, and a caller that forgot to ask is refused there.
*/
async function inboxPolicy(context, alias, wanted, consent) {
	const { inbox } = await context.inbox(alias);
	let result;
	await context.core.config.update((current) => {
		const now = findById(current, "inbox", inbox.id);
		if (!now) throw new CommsError("NOT_FOUND", `no inbox called "${alias}"`);
		const next = {
			...now.inbox,
			...wanted
		};
		result = {
			alias: now.alias,
			sendPolicy: next.sendPolicy ?? current.defaults.sendPolicy,
			previous: now.inbox.sendPolicy ?? current.defaults.sendPolicy,
			changePolicy: next.changePolicy ?? defaultChangePolicy(current),
			previousChangePolicy: now.inbox.changePolicy ?? defaultChangePolicy(current)
		};
		return {
			...current,
			inboxes: {
				...current.inboxes,
				[now.alias]: next
			}
		};
	}, consent ? { consent } : {});
	if (!result) throw new CommsError("UNEXPECTED", "the policy was written without being measured");
	await context.core.audit.append({
		inboxId: inbox.id,
		alias: result.alias,
		operation: "inbox.policy",
		outcome: "ok",
		surface: context.surface,
		reason: [...wanted.sendPolicy ? [`send ${result.previous} → ${result.sendPolicy}`] : [], ...wanted.changePolicy ? [`change ${result.previousChangePolicy} → ${result.changePolicy}`] : []].join("; ")
	});
	return result;
}
/**
* Removing a mailbox, as one change both surfaces run through core's flow.
*
* It loosens no setting, so what makes it need approval is its effects: a mailbox removed takes its token with it,
* and connecting it again means Google's consent screen again. The effects name the mailbox by address, so the
* person reads which account goes rather than a name that may mean something else to them.
*
* The approval binds the mailbox by id (core's target), and so does the removal: `apply` passes the id the plan saw,
* and `inboxRemove` refuses if the name has come to mean another mailbox in between.
*/
function inboxRemoveChange(context, alias, options = {}) {
	let planned;
	return {
		plan: (config) => {
			const inbox = requireInbox(config, alias);
			planned = inbox.id;
			const { [alias]: _removed, ...inboxes } = config.inboxes;
			return {
				inbox: alias,
				before: config,
				after: {
					...config,
					inboxes
				},
				summary: `Remove the mailbox ${alias}`,
				effects: [`disconnects ${alias} (${inbox.email}) and deletes its token from this machine; connecting it again means signing in to Google again`, ...options.revoke ? ["asks Google to revoke that token, which can end the grant for every other tool signed in through the same client"] : []]
			};
		},
		apply: () => inboxRemove(context, alias, {
			revoke: options.revoke === true,
			expectedId: planned
		})
	};
}
/**
* Disconnects an inbox. The registry row goes first, so a server that is mid-call stops serving it immediately; the
* token is deleted afterwards. Revocation is opt-in, because revoking one token can invalidate the whole
* account-and-client grant, including other tools that share it.
*
* `expectedId` is the mailbox an approval was given for. A name is only a label, so between that approval and this
* call it can come to mean another mailbox — removed and connected again under the same name — and that one is not
* the one the person agreed to remove.
*/
async function inboxRemove(context, alias, options = {}) {
	const { inbox: named } = await context.inbox(alias);
	if (options.expectedId !== void 0 && named.id !== options.expectedId) throw new CommsError("CONFIG", `"${alias}" is no longer the mailbox this removal was approved for`, {
		hint: "Nothing was removed. Prepare the removal again, and read the preview before approving it.",
		details: {
			alias,
			expectedId: options.expectedId,
			id: named.id
		}
	});
	const removed = await withCredentialsLock(context.core.paths.configDir, async () => {
		const found = findById(await context.config(), "inbox", named.id);
		if (!found) throw new CommsError("NOT_FOUND", `no inbox called "${alias}"`);
		const { inbox } = found;
		const secrets = await context.core.secrets();
		const refreshToken = options.revoke ? await secrets.get(inbox.secretRef) : null;
		try {
			await context.core.config.update((current) => {
				const now = findById(current, "inbox", inbox.id);
				if (!now) throw new CommsError("NOT_FOUND", `no inbox called "${alias}"`);
				const inboxes = { ...current.inboxes };
				delete inboxes[now.alias];
				return {
					...current,
					inboxes
				};
			});
		} catch (error) {
			const gone = await writeOutcome(async () => findById(await context.config(), "inbox", inbox.id) === null);
			if (gone === "absent") throw error;
			if (gone === "unknown") {
				await recordOrphan(context, {
					secretRef: inbox.secretRef,
					alias: found.alias,
					inboxId: inbox.id
				}, error, true);
				throw keepAndReport(error, inbox.secretRef, "Run `agent-gmail inbox list`.");
			}
		}
		context.forgetTransports();
		let orphanedSecret;
		let orphanRecorded;
		try {
			await secrets.delete(inbox.secretRef);
		} catch (error) {
			orphanedSecret = inbox.secretRef;
			orphanRecorded = await recordOrphan(context, {
				secretRef: inbox.secretRef,
				alias: found.alias,
				inboxId: inbox.id
			}, error, false);
		}
		return {
			name: found.alias,
			inbox,
			refreshToken,
			orphanedSecret,
			orphanRecorded
		};
	});
	let revoked = false;
	if (options.revoke && removed.refreshToken) try {
		await revokeToken(context.endpoints, removed.refreshToken);
		revoked = true;
	} catch {}
	await context.core.states.update(removed.inbox.id, { lastError: void 0 });
	await context.core.audit.append({
		inboxId: removed.inbox.id,
		alias: removed.name,
		operation: "inbox.remove",
		outcome: "ok",
		surface: context.surface,
		reason: `${revoked ? "token revoked" : "token not revoked"}; ${removed.orphanedSecret ? `local token could not be deleted (${removed.orphanedSecret})` : "local token deleted"}`
	});
	return {
		alias: removed.name,
		id: removed.inbox.id,
		email: removed.inbox.email,
		revoked,
		orphanedSecret: removed.orphanedSecret,
		orphanRecorded: removed.orphanRecorded
	};
}
/**
* One line in the orphaned-secrets file `doctor` reads.
*
* `unconfirmed` marks a token kept because nobody could tell whether its mailbox was removed. `doctor` re-checks every
* line against the config anyway, and only advises deleting a reference nothing still holds.
*/
async function recordOrphan(context, entry, error, unconfirmed) {
	try {
		await appendPrivateLine(orphanedSecretsPath(context), JSON.stringify({
			at: context.now().toISOString(),
			...entry,
			...unconfirmed ? { unconfirmed: true } : {},
			reason: error instanceof Error ? error.message : String(error)
		}));
		return true;
	} catch {
		return false;
	}
}
function orphanedSecretsPath(context) {
	return join(context.core.paths.stateDir, "orphaned-secrets.jsonl");
}
async function whoami(context, alias) {
	const config = await context.config();
	const resolved = await context.inbox(alias);
	await context.requireCapability(resolved, "read");
	const profile = await (await context.transport(alias)).getProfile();
	await context.core.states.update(resolved.inbox.id, { lastUsedAt: context.now().toISOString() });
	return {
		alias,
		email: resolved.inbox.email,
		profileEmail: profile.emailAddress,
		matches: profile.emailAddress.toLowerCase() === resolved.inbox.email.toLowerCase(),
		tier: tierOf(resolved.inbox.grantedScopes) ?? resolved.inbox.tier,
		capabilities: [...capabilitiesOf(resolved.inbox.grantedScopes)],
		sendPolicy: effectiveSendPolicy(config, alias),
		messagesTotal: profile.messagesTotal,
		threadsTotal: profile.threadsTotal
	};
}
//#endregion
//#region src/operations/doctor.ts
/**
* The command that re-registers *this* entry, not a default one.
*
* A generic `mcp install --client <c> --force` would rewrite a server registered as `work`, or scoped to one
* mailbox, or installed `--read-only`, into the default: every mailbox, every tool, under another name. That
* turns a staleness warning into a widening of what an agent may reach — the opposite of a repair. So the flags
* are read back off the entry that is actually there.
*/
function repairCommand(server, platform) {
	if (server.scope === "project") return `remove "${server.name}" from the project entry in ${server.path} by hand, then re-run mcp install`;
	const words = [
		"agent-gmail",
		"mcp",
		"install",
		"--client",
		server.client
	];
	if (server.name && server.name !== "gmail") words.push("--name", server.name);
	const inbox = server.args[server.args.indexOf("--inbox") + 1];
	if (server.args.includes("--inbox") && inbox) words.push("--inbox", inbox);
	if (server.args.includes("--read-only")) words.push("--read-only");
	if (server.args.some((argument) => argument.startsWith(`${GMAIL_MCP.npxPackage}@`))) words.push("--launcher", "npx");
	words.push("--force");
	return commandText(shellCommand(words, platform));
}
const MINIMUM_NODE = [
	22,
	12,
	0
];
const UNUSED_WARNING_DAYS = 150;
/**
* A single place that answers "why doesn't it work?". Every check states what it found and what to do about it;
* nothing here changes anything.
*/
async function doctor(context, options = {}) {
	const checks = [];
	checks.push(nodeCheck());
	checks.push(...await directoryChecks(context));
	checks.push(await secretStoreCheck(context));
	const config = await context.config();
	const scope = options.inbox === void 0 ? void 0 : {
		name: options.inbox,
		inbox: lookupName(config, "inbox", options.inbox)
	};
	checks.push(clientCheck(config, scope));
	const aliases = options.inbox ? [options.inbox] : Object.keys(config.inboxes);
	if (aliases.length === 0) checks.push({
		id: "inboxes",
		title: "Mailboxes",
		status: "warn",
		detail: "none connected yet",
		fix: "agent-gmail setup"
	});
	for (const alias of aliases) checks.push(...await inboxChecks(context, alias));
	checks.push(await orphanedSecretsCheck(context, scope));
	const folders = scope && !scope.inbox ? null : await formerFoldersCheck(context, config, scope?.inbox?.id);
	if (folders) checks.push(folders);
	checks.push(...await mcpChecks(context, scope));
	const summary = {
		ok: checks.filter((check) => check.status === "ok").length,
		warn: checks.filter((check) => check.status === "warn").length,
		fail: checks.filter((check) => check.status === "fail").length,
		skipped: checks.filter((check) => check.status === "skipped").length
	};
	return {
		checks,
		summary,
		healthy: summary.fail === 0
	};
}
/**
* Whether an OAuth client is registered — every client, or only the one a scoped mailbox signs in through.
*
* `setup`, not `client add <a file you do not have>`, when there is none at all. This check is the first thing a new
* install reports, and it used to answer with a command naming a downloaded JSON that only exists after five screens
* of Google Cloud nobody had mentioned — repair advice handed to somebody who had not built the thing yet.
*/
function clientCheck(config, scope) {
	const clients = Object.keys(config.clients);
	const base = {
		id: "oauth-client",
		title: "OAuth client"
	};
	if (scope?.inbox) {
		const name = scope.inbox.client;
		const registered = Object.hasOwn(config.clients, name);
		return {
			...base,
			status: registered ? "ok" : "fail",
			detail: `"${name}", which ${scope.name} signs in through${registered ? "" : ", is not registered"}`,
			fix: registered ? void 0 : "agent-gmail client add <client_secret.json>"
		};
	}
	return {
		...base,
		status: clients.length > 0 ? "ok" : "fail",
		detail: clients.length === 0 ? "none registered" : scope ? `${clients.length} registered` : `${clients.length} registered: ${clients.join(", ")}`,
		fix: clients.length > 0 ? void 0 : "agent-gmail setup"
	};
}
/** Compares dotted version numbers left to right: the first difference decides. */
function atLeast(version, minimum) {
	const parts = version.split(".").map((part) => Number.parseInt(part, 10) || 0);
	for (const [index, floor] of minimum.entries()) {
		const part = parts[index] ?? 0;
		if (part > floor) return true;
		if (part < floor) return false;
	}
	return true;
}
function nodeCheck() {
	const enough = atLeast(process.versions.node, MINIMUM_NODE);
	return {
		id: "node-version",
		title: "Node.js",
		status: enough ? "ok" : "fail",
		detail: `v${process.versions.node}`,
		fix: enough ? void 0 : `Install Node ${MINIMUM_NODE.join(".")} or newer.`
	};
}
async function directoryChecks(context) {
	const checks = [];
	for (const [id, path] of [
		["config-dir", context.core.paths.configDir],
		["state-dir", context.core.paths.stateDir],
		["secrets-dir", context.core.paths.secretsDir]
	]) {
		try {
			await stat(path);
		} catch {
			checks.push({
				id,
				title: `Directory ${path}`,
				status: "ok",
				detail: "not created yet"
			});
			continue;
		}
		const loose = await isGroupOrWorldAccessible(path);
		checks.push({
			id,
			title: `Directory ${path}`,
			status: loose ? "warn" : "ok",
			detail: loose ? "readable by other users on this machine" : "owner-only",
			fix: loose ? commandText(shellCommand([
				"chmod",
				"700",
				path
			], context.platform)) : void 0
		});
	}
	return checks;
}
async function secretStoreCheck(context) {
	const config = await context.config();
	if (secretsStoreOf(config) === "file") return {
		id: "secret-store",
		title: "Secret store",
		status: "ok",
		detail: "owner-only files in the config directory"
	};
	const probe = await probeKeychain();
	return {
		id: "secret-store",
		title: "Secret store",
		status: probe.ok ? "ok" : "fail",
		detail: probe.ok ? "the system keychain answers" : `the system keychain cannot be used: ${probe.reason}`,
		fix: probe.ok ? void 0 : "agentcomms secrets migrate --to file"
	};
}
async function inboxChecks(context, alias) {
	const checks = [];
	const config = await context.config();
	const inbox = lookupName(config, "inbox", alias);
	if (!inbox) {
		const renamed = formerNameRefusal(config, "inbox", alias);
		const current = (renamed?.details)?.currentName;
		return [{
			id: "inbox-known",
			title: `Mailbox ${alias}`,
			status: "fail",
			detail: renamed ? renamed.message : "no such mailbox",
			fix: current ? commandText(shellCommand([
				"agent-gmail",
				"doctor",
				"--inbox",
				current
			], context.platform)) : commandText(shellCommand([
				"agent-gmail",
				"inbox",
				"add",
				alias,
				"--start"
			], context.platform)),
			inbox: alias
		}];
	}
	const granted = capabilitiesOf(inbox.grantedScopes);
	const missing = scopesFor(TIERS.includes(inbox.tier) ? inbox.tier : "organize", inbox.contacts).filter((scope) => !inbox.grantedScopes.includes(scope));
	checks.push({
		id: "inbox-scopes",
		title: `Permissions for ${alias}`,
		status: missing.length === 0 ? "ok" : "warn",
		detail: missing.length === 0 ? `${[...granted].join(", ")}` : `missing: ${missing.join(", ")}`,
		fix: missing.length === 0 ? void 0 : commandText(shellCommand([
			"agent-gmail",
			"inbox",
			"reauth",
			alias
		], context.platform)),
		inbox: alias
	});
	const client = config.clients[inbox.client];
	if (!client) {
		checks.push({
			id: "inbox-client",
			title: `OAuth client for ${alias}`,
			status: "fail",
			detail: `"${inbox.client}" is not registered`,
			fix: "agent-gmail client add <client_secret.json>",
			inbox: alias
		});
		return checks;
	}
	let tokenOk = false;
	try {
		await new TokenSource({
			core: context.core,
			endpoints: context.endpoints,
			inbox,
			client,
			alias,
			platform: context.platform
		}).accessToken();
		tokenOk = true;
		checks.push({
			id: "inbox-token",
			title: `Sign-in for ${alias}`,
			status: "ok",
			detail: "Google renewed the access token",
			inbox: alias
		});
	} catch (error) {
		const failure = error;
		checks.push({
			id: "inbox-token",
			title: `Sign-in for ${alias}`,
			status: "fail",
			detail: failure.message,
			fix: failure.hint ?? commandText(shellCommand([
				"agent-gmail",
				"inbox",
				"reauth",
				alias
			], context.platform)),
			inbox: alias
		});
	}
	if (tokenOk) try {
		const profile = await (await context.transport(alias)).getProfile();
		const matches = profile.emailAddress.toLowerCase() === inbox.email.toLowerCase();
		checks.push({
			id: "inbox-profile",
			title: `Mailbox ${alias}`,
			status: matches ? "ok" : "warn",
			detail: matches ? profile.emailAddress : `recorded as ${inbox.email}, but Google says ${profile.emailAddress}`,
			fix: matches ? void 0 : commandText(shellCommand([
				"agent-gmail",
				"inbox",
				"reauth",
				alias
			], context.platform)),
			inbox: alias
		});
	} catch (error) {
		const failure = error;
		checks.push({
			id: "inbox-profile",
			title: `Mailbox ${alias}`,
			status: "fail",
			detail: failure.message,
			fix: failure.hint,
			inbox: alias
		});
	}
	const state = await context.core.states.get(inbox.id);
	const lastUsed = state.lastUsedAt ?? state.lastRefreshOkAt;
	if (lastUsed) {
		const days = (context.now().getTime() - Date.parse(lastUsed)) / 864e5;
		if (days >= UNUSED_WARNING_DAYS) checks.push({
			id: "inbox-idle",
			title: `Last used: ${alias}`,
			status: "warn",
			detail: `${Math.floor(days)} days ago; Google drops a token unused for six months`,
			fix: commandText(shellCommand([
				"agent-gmail",
				"whoami",
				"--inbox",
				alias
			], context.platform)),
			inbox: alias
		});
	}
	return checks;
}
/**
* Tokens whose removal failed when an inbox was disconnected: still stored, no longer referenced.
*
* Every recorded line is checked against the config as it is now before any deletion is advised. A line can be
* recorded for a token whose mailbox is still connected — a removal that could not tell whether its write went through
* keeps the token and records it as unconfirmed — and advising the person to delete that would delete a live
* credential. A reference something configured still holds is reported as in use, and left out of the advice.
*/
async function orphanedSecretsCheck(context, scope) {
	let lines = [];
	try {
		lines = (await readFile(orphanedSecretsPath(context), "utf8")).split("\n").filter((line) => line.trim());
	} catch {}
	const entries = lines.map((line) => {
		try {
			const parsed = JSON.parse(line);
			return parsed !== null && typeof parsed === "object" ? parsed : {};
		} catch {
			return {};
		}
	});
	const refs = (scope ? entries.filter((entry) => scope.inbox !== void 0 && entry.inboxId === scope.inbox.id) : entries).map((entry) => entry.secretRef);
	let held = null;
	try {
		held = referencedSecrets(await context.config());
	} catch {}
	const recorded = [...new Set(refs.filter((ref) => typeof ref === "string"))];
	const unparseable = refs.filter((ref) => typeof ref !== "string").length;
	const unreferenced = held === null ? [] : recorded.filter((ref) => !held.has(ref));
	const inUse = held === null ? 0 : recorded.filter((ref) => held.has(ref)).length;
	const unchecked = held === null ? recorded.length + unparseable : unparseable;
	if (unreferenced.length === 0 && unchecked === 0) return {
		id: "orphaned-secrets",
		title: "Tokens left behind",
		status: "ok",
		detail: inUse === 0 ? "none" : `none — ${inUse} recorded token(s) belong to a connected mailbox, so nothing to do`
	};
	if (unreferenced.length === 0) return {
		id: "orphaned-secrets",
		title: "Tokens left behind",
		status: "warn",
		detail: `${unchecked} recorded token(s) could not be checked against the configuration`,
		fix: "Run `agent-gmail doctor` again once the configuration can be read. Delete nothing until then."
	};
	return {
		id: "orphaned-secrets",
		title: "Tokens left behind",
		status: "warn",
		detail: `${unreferenced.length} stored token(s) could not be deleted when an inbox was removed, and nothing uses them`,
		fix: `Remove ${unreferenced.join(", ")} from the secret store by hand, then delete ${orphanedSecretsPath(context)}`
	};
}
/**
* Downloads still sitting under a mailbox's former name, said once and never moved.
*
* A download lands in a folder named for the mailbox, so a rename leaves the old ones where they were. Usually that is
* the organisation's own folder — `cue` became `cue/gmail`, so new files go to `downloads/cue/gmail/` inside the old
* `downloads/cue/` — and what is worth saying is that the old files sit beside the new folder, not that the folder
* exists. Nothing here moves a file: they are a person's downloads, and where they belong is theirs to decide.
*/
async function formerFoldersCheck(context, config, onlyId) {
	if (config.version !== 2) return null;
	const configured = config.defaults.downloadsDir;
	const root = configured ? expandHome(configured, homeDirectory(context.env)) : context.core.paths.downloadsDir;
	const found = [];
	for (const [former, record] of Object.entries(config.formerNames.inboxes)) {
		if (onlyId !== void 0 && record.id !== onlyId) continue;
		let children;
		try {
			children = await readdir(join(root, former));
		} catch {
			continue;
		}
		const current = Object.keys(config.inboxes).filter((name) => name.startsWith(`${former}/`)).map((name) => name.slice(former.length + 1).split("/")[0]);
		const leftovers = children.filter((child) => !current.includes(child));
		if (leftovers.length === 0) continue;
		const now = findById(config, "inbox", record.id)?.alias ?? record.name;
		found.push(`${join(root, former)} (${leftovers.length} item(s) from before "${former}" became "${now}")`);
	}
	if (found.length === 0) return null;
	return {
		id: "former-download-folders",
		title: "Downloads under former names",
		status: "warn",
		detail: found.join("; "),
		fix: "Nothing was moved. Move them into the new folders yourself if you want them together."
	};
}
function referencedSecrets(config) {
	return /* @__PURE__ */ new Set([
		...Object.values(config.inboxes).map((inbox) => inbox.secretRef),
		...Object.values(config.accounts).map((account) => account.secretRef),
		...Object.values(config.clients).map((client) => client.secretRef)
	]);
}
async function mcpChecks(context, scope) {
	const servers = await listRegisteredServers(context.env);
	const checks = [];
	const ungated = findUngatedGmailServers(servers, context.platform);
	checks.push({
		id: "other-gmail-servers",
		title: "Other Gmail MCP servers",
		status: ungated.length === 0 ? "ok" : "fail",
		detail: ungated.length === 0 ? "none registered" : ungated.map((finding) => `${finding.name} in ${finding.path} (${finding.client}): ${finding.reason}`).join("; "),
		fix: ungated.length === 0 ? void 0 : ungated.map((finding) => finding.removal).join("\n")
	});
	const ours = servers.filter((server) => {
		if (!scope) return true;
		const at = server.args.indexOf("--inbox");
		return at === -1 || server.args[at + 1] === void 0 || server.args[at + 1] === scope.name;
	});
	const registered = ours.filter((entry) => isProductServer(entry, GMAIL_MCP));
	const stale = ours.map((server) => {
		const pin = server.args.map((arg) => pinnedVersion(arg, GMAIL_MCP)).find((version) => version !== null);
		return pin ? {
			server,
			version: pin
		} : null;
	}).filter((entry) => entry !== null).filter((entry) => entry.version !== VERSION);
	checks.push(registered.length === 0 && stale.length === 0 ? {
		id: "registered-server-version",
		title: "Registered server version",
		status: "warn",
		detail: `${scope ? `none registered that serves ${scope.name}: no MCP client's config file starts one that reaches it` : "none registered: no MCP client's config file starts this server"} (one a plugin or an extension starts is not visible from here)`,
		fix: commandText(shellCommand([
			"agent-gmail",
			"mcp",
			"install",
			"--help"
		], context.platform))
	} : {
		id: "registered-server-version",
		title: "Registered server version",
		status: stale.length === 0 ? "ok" : "warn",
		detail: stale.length === 0 ? `this release, ${VERSION}` : stale.map((entry) => `${entry.server.client} runs ${entry.version} as "${entry.server.name}"; this release is ${VERSION}`).join("; "),
		fix: stale.length === 0 ? void 0 : stale.map((entry) => repairCommand(entry.server, context.platform)).join("\n")
	});
	for (const server of registered) {
		const missing = await missingEntryFile(server);
		checks.push({
			id: "mcp-command",
			title: `MCP entry "${server.name}" (${server.client})`,
			status: missing ? "fail" : "ok",
			detail: missing ? `${missing} is not there any more` : server.command,
			fix: missing ? repairCommand(server, context.platform) : void 0
		});
	}
	return checks;
}
//#endregion
//#region src/operations/drafts.ts
async function attachmentsFor(context, paths) {
	if (paths.length === 0) return {
		attachments: [],
		described: [],
		warnings: []
	};
	const config = await context.config();
	const home = homeDirectory(context.env);
	const policy = {
		roots: config.defaults.attachRoots.map((root) => expandHome(root, home)),
		deny: [...defaultAttachDeny(context.core.paths.configDir, context.env), ...config.defaults.attachDeny],
		home
	};
	const attachments = [];
	const described = [];
	const warnings = [];
	let total = 0;
	for (const given of paths) {
		const path = resolve(expandHome(given, home));
		const allowed = await checkAttachable(path, policy);
		if (!(await stat(allowed)).isFile()) throw new CommsError("BAD_DATA", `${allowed} is not a file`, { hint: "Attach files, not directories." });
		const content = await readFile(allowed);
		total += content.byteLength;
		attachments.push({
			filename: basename(allowed),
			content
		});
		described.push({
			filename: basename(allowed),
			size: content.byteLength,
			mimeType: "application/octet-stream",
			source: allowed
		});
	}
	if (total > 26214400) warnings.push(`${Math.round(total / 1048576)} MB of attachments: Gmail's limit is 25 MB and some recipients will not receive it. A link may be better.`);
	return {
		attachments,
		described,
		warnings
	};
}
/** The signature Gmail holds for the sending address, used byte-for-byte or not at all. */
async function signatureFor(context, alias, from) {
	const addresses = await (await context.transport(alias)).listSendAs();
	const match = addresses.find((entry) => entry.sendAsEmail.toLowerCase() === from.toLowerCase()) ?? addresses.find((entry) => entry.isDefault);
	if (!match?.signature) return void 0;
	return {
		text: match.signature.replace(/<br\s*\/?>/gi, "\n").replace(/<[^>]+>/g, "").replace(/&nbsp;/g, " ").trim(),
		html: match.signature
	};
}
async function profileFor(context, alias) {
	const config = await context.config();
	return (await readComposeProfile(join(context.core.paths.configDir, "compose"), {
		platform: "gmail",
		inbox: alias,
		formerInboxes: formerNamesOf(config, "inbox", alias)
	})).text;
}
function warningsFor(input) {
	const warnings = [];
	const external = [
		...input.to,
		...input.cc,
		...input.bcc
	].filter((address) => {
		const domain = address.slice(address.lastIndexOf("@") + 1).toLowerCase();
		return !input.ownDomains.includes(domain);
	});
	if (external.length > 0) warnings.push(`goes outside your organisation: ${[...new Set(external)].join(", ")}`);
	if (input.bcc.length > 0) warnings.push(`${input.bcc.length} blind recipient(s), who the others cannot see`);
	return warnings;
}
/** Creates a draft. Nothing is sent, and nothing can be: the send path is a separate operation with its own gate. */
async function createDraft(context, alias, input) {
	const resolved = await context.inbox(alias);
	await context.requireCapability(resolved, "draft");
	const transport = await context.transport(alias);
	const to = input.to ?? [];
	const cc = input.cc ?? [];
	const bcc = input.bcc ?? [];
	const from = resolved.inbox.email;
	const { attachments, described, warnings: attachmentWarnings } = await attachmentsFor(context, input.attach ?? []);
	const signature = input.signature === false ? void 0 : await signatureFor(context, alias, from);
	const composed = await composeMessage({
		from: formatAddress({
			name: "",
			address: from
		}),
		to,
		cc,
		bcc,
		subject: input.subject ?? "",
		text: input.text,
		signature,
		attachments
	});
	const created = await transport.createDraft(composed.raw);
	const warnings = [
		...attachmentWarnings,
		...signatureWarnings(composed.signatureResources),
		...warningsFor({
			to,
			cc,
			bcc,
			ownDomains: resolved.inbox.internalDomains
		})
	];
	await context.core.audit.append({
		inboxId: resolved.inbox.id,
		alias,
		operation: "draft.create",
		outcome: "ok",
		surface: context.surface,
		ids: {
			draftIds: [created.draftId],
			messageIds: [created.messageId]
		},
		recipientDomains: recipientDomains([
			...to,
			...cc,
			...bcc
		])
	});
	return {
		inbox: alias,
		draftId: created.draftId,
		messageId: created.messageId,
		threadId: created.threadId,
		to,
		cc,
		bcc,
		subject: input.subject ?? "",
		preview: renderMessagePreview({
			recipients: {
				from,
				to: previewable(to),
				cc: previewable(cc),
				bcc: previewable(bcc)
			},
			subject: input.subject ?? "",
			body: composed.text,
			attachments: described.map((attachment) => ({
				filename: attachment.filename,
				size: attachment.size,
				mimeType: attachment.mimeType
			})),
			context: {
				inbox: alias,
				draftId: created.draftId,
				note: "nothing has been sent"
			},
			warnings
		}),
		attachments: described,
		bytes: composed.bytes,
		warnings,
		profile: input.includeProfile ? await profileFor(context, alias) : void 0
	};
}
/** How a message can be answered. */
const REPLY_MODES = [
	"reply",
	"reply_all",
	"forward"
];
/**
* The original as a quote: its sanitised text, never its HTML.
*
* The original's markup belongs to whoever sent it and can carry a tracking image, hidden text or a form.
* Forwarding that would put the user's name on somebody else's beacon, and the outbound analyser would refuse the
* draft anyway. Quoting the text loses the original's formatting, which is the right trade.
*/
function quoteOf(original, mode) {
	const headers = original.payload?.headers ?? [];
	const body = buildBody(readParts(original.payload), {
		maxChars: QUOTE_MAX_CHARS,
		includeQuoted: true
	});
	if (!body.text.trim()) return void 0;
	const quotedText = body.truncated ? `${body.text}

[the original continues — ${body.totalChars - body.text.length} more characters not quoted]` : body.text;
	const quoted = (value, fallback) => neutralise(decodeHeaderWords(value ?? fallback)).text;
	const sender = quoted(headerValue(headers, "From"), "someone");
	const date = headerValue(headers, "Date");
	const when = date ? new Date(date) : null;
	const stamp = when && !Number.isNaN(when.getTime()) ? when.toUTCString() : date ?? "an earlier date";
	if (mode !== "forward") return {
		attribution: `On ${stamp}, ${sender} wrote:`,
		text: quotedText
	};
	return {
		attribution: "---------- Forwarded message ----------",
		text: quotedText,
		headerLines: [
			`From: ${sender}`,
			`Date: ${stamp}`,
			`Subject: ${quoted(headerValue(headers, "Subject"), "(no subject)")}`,
			`To: ${quoted(headerValue(headers, "To"), "(undisclosed)")}`,
			...headerValue(headers, "Cc") ? [`Cc: ${quoted(headerValue(headers, "Cc"), "")}`] : []
		]
	};
}
/** Removes a trailing block from a body, if it is there. Used to take the signature off before it is re-added. */
function stripTrailing(text, trailing) {
	if (!trailing?.trim()) return text;
	const trimmed = text.replace(/\s+$/, "");
	const block = trailing.replace(/\s+$/, "");
	return trimmed.endsWith(block) ? trimmed.slice(0, -block.length).replace(/\s+$/, "") : text;
}
/**
* What the mailbox's own signature fetches when the message is opened.
*
* Not a refusal — it is the user's signature and a company logo is the ordinary case — but the person approving a
* message should know that opening it tells someone's server it was opened.
*/
function signatureWarnings(resources) {
	if (resources.length === 0) return [];
	return [`your signature loads ${resources.length} image(s) from the internet when the message is opened: ` + resources.slice(0, 3).join(", ")];
}
/** Addresses as they will actually be used, so a display name cannot stand in for the recipient in a preview. */
function previewable(entries) {
	return entries.flatMap((entry) => {
		const parsed = parseAddressList(entry);
		return parsed.length > 0 ? parsed.map((address) => formatAddress(address)) : [entry];
	});
}
/** How much of an original is quoted. Long enough for context, short enough not to dominate the message. */
const QUOTE_MAX_CHARS = 4e3;
/** The attachments already on a draft, fetched by their bytes so an update can put them back. */
async function carriedAttachments(transport, messageId, parts) {
	const attachments = [];
	const described = [];
	const warnings = [];
	for (const part of parts.attachments) {
		if (!part.attachmentId || !messageId) continue;
		try {
			const content = await transport.getAttachment(messageId, part.attachmentId);
			const filename = part.filename ?? "attachment";
			attachments.push({
				filename,
				content,
				contentType: part.mimeType
			});
			described.push({
				filename,
				size: content.length,
				mimeType: part.mimeType,
				source: "kept from the draft"
			});
		} catch {
			warnings.push(`could not keep the attachment "${part.filename ?? "attachment"}"; it is no longer on the draft`);
		}
	}
	return {
		attachments,
		described,
		warnings
	};
}
/** Replies to a message, or forwards it. The recipients are computed, then shown, never assumed. */
async function replyDraft(context, alias, messageId, input) {
	const mode = oneOf(input.mode, REPLY_MODES, "a reply mode") ?? "reply";
	const resolved = await context.inbox(alias);
	await context.requireCapability(resolved, "draft");
	const transport = await context.transport(alias);
	const original = await transport.getMessage(messageId);
	const headers = original.payload?.headers ?? [];
	const plan = planReply({
		from: parseAddressList(headerValue(headers, "From"))[0] ?? null,
		replyTo: parseAddressList(headerValue(headers, "Reply-To")),
		to: parseAddressList(headerValue(headers, "To")),
		cc: parseAddressList(headerValue(headers, "Cc")),
		subject: decodeHeaderWords(headerValue(headers, "Subject") ?? ""),
		messageIdHeader: headerValue(headers, "Message-ID"),
		references: (headerValue(headers, "References") ?? "").split(/\s+/).filter(Boolean),
		threadId: original.threadId ?? ""
	}, {
		mode,
		ownAddresses: await ownAddresses$1(context, alias),
		to: input.to
	});
	const to = input.to ?? plan.to;
	const cc = input.cc ?? plan.cc;
	const bcc = input.bcc ?? [];
	if (to.length === 0 && cc.length === 0 && bcc.length === 0) throw new CommsError("REPLY_INVALID", "there is nobody to reply to", { hint: mode === "forward" ? "A forward needs recipients: pass `to`." : "Pass `to` explicitly." });
	const from = resolved.inbox.email;
	const { attachments, described, warnings: attachmentWarnings } = await attachmentsFor(context, input.attach ?? []);
	const signature = input.signature === false ? void 0 : await signatureFor(context, alias, from);
	const subject = input.subject ?? plan.subject;
	const quoted = input.quote === false ? void 0 : quoteOf(original, mode);
	const composed = await composeMessage({
		from: formatAddress({
			name: "",
			address: from
		}),
		to,
		cc,
		bcc,
		subject,
		text: input.text,
		signature,
		attachments,
		quoted,
		inReplyTo: plan.inReplyTo,
		references: plan.references
	});
	const created = await transport.createDraft(composed.raw, plan.threadId);
	const senderWarnings = [];
	const replyTo = parseAddressList(headerValue(headers, "Reply-To"));
	const fromAddress = parseAddressList(headerValue(headers, "From"))[0]?.address;
	if (replyTo.length > 0 && replyTo.some((entry) => entry.address !== fromAddress)) senderWarnings.push(`the sender asked for replies to go to ${replyTo.map((entry) => entry.address).join(", ")}, not to the address it came from`);
	const warnings = [
		...attachmentWarnings,
		...senderWarnings,
		...signatureWarnings(composed.signatureResources),
		...warningsFor({
			to,
			cc,
			bcc,
			ownDomains: resolved.inbox.internalDomains
		})
	];
	await context.core.audit.append({
		inboxId: resolved.inbox.id,
		alias,
		operation: `draft.${mode}`,
		outcome: "ok",
		surface: context.surface,
		ids: {
			draftIds: [created.draftId],
			messageIds: [messageId]
		},
		recipientDomains: recipientDomains([
			...to,
			...cc,
			...bcc
		])
	});
	return {
		inbox: alias,
		draftId: created.draftId,
		messageId: created.messageId,
		threadId: created.threadId,
		to,
		cc,
		bcc,
		subject,
		preview: renderMessagePreview({
			recipients: {
				from,
				to: previewable(to),
				cc: previewable(cc),
				bcc: previewable(bcc)
			},
			subject,
			body: composed.text,
			attachments: described.map((attachment) => ({
				filename: attachment.filename,
				size: attachment.size,
				mimeType: attachment.mimeType
			})),
			context: {
				inbox: alias,
				draftId: created.draftId,
				note: "nothing has been sent"
			},
			warnings
		}),
		attachments: described,
		bytes: composed.bytes,
		warnings,
		profile: input.includeProfile ? await profileFor(context, alias) : void 0
	};
}
const DRAFT_LIST_LIMIT = {
	flag: "--limit",
	arg: "limit",
	min: 1
};
/** The drafts in a mailbox. `limit` is as given, and checked before the mailbox is read; twenty when left out. */
async function listDrafts(context, alias, given) {
	const limit = numberOption(context, given, DRAFT_LIST_LIMIT) ?? 20;
	const resolved = await context.inbox(alias);
	await context.requireCapability(resolved, "draft");
	const drafts = await (await context.transport(alias)).listDrafts(limit);
	const summaries = [];
	for (const draft of drafts) {
		const message = draft.message;
		const headers = message?.payload?.headers ?? [];
		summaries.push({
			draftId: draft.id,
			messageId: message?.id ?? "",
			threadId: message?.threadId ?? void 0,
			to: parseAddressList(headerValue(headers, "To")).map((entry) => entry.address),
			subject: decodeHeaderWords(headerValue(headers, "Subject") ?? ""),
			updatedAt: message?.internalDate ? new Date(Number(message.internalDate)).toISOString() : null
		});
	}
	return summaries;
}
async function deleteDraft(context, alias, draftId) {
	const resolved = await context.inbox(alias);
	await context.requireCapability(resolved, "draft");
	await refuseWhileSending$1(context, resolved.inbox.id, draftId);
	await (await context.transport(alias)).deleteDraft(draftId);
	await context.core.audit.append({
		inboxId: resolved.inbox.id,
		alias,
		operation: "draft.delete",
		outcome: "ok",
		surface: context.surface,
		ids: { draftIds: [draftId] }
	});
	return { draftId };
}
/**
* Replaces the content of a draft that already exists.
*
* Gmail gives the draft's message a new id on every save, which is how an edit is noticed later: an approval is
* bound to the message id it was given, so editing a draft after it has been approved invalidates that approval
* rather than quietly changing what gets sent.
*/
/**
* Refuses to change a draft that a send is standing on.
*
* Between the final check and `drafts.send` there is a window in which an edit would mean the mail that goes is not
* the mail that was approved. Our own tools close it here — including two tool calls from the same agent in
* parallel. What remains is an edit made in Gmail web at that exact moment, and that is documented, not claimed.
*/
async function refuseWhileSending$1(context, inboxId, draftId) {
	if ((await context.core.approvals.list({
		inboxId,
		states: ["sending"]
	})).some((record) => record.draftId === draftId)) throw new CommsError("APPROVAL_PENDING", "this draft is being sent right now, so it cannot be changed", {
		hint: "Wait for the send to finish, then look at the message in Sent.",
		details: { draftId }
	});
}
async function updateDraft(context, alias, draftId, input) {
	const resolved = await context.inbox(alias);
	await context.requireCapability(resolved, "draft");
	await refuseWhileSending$1(context, resolved.inbox.id, draftId);
	const transport = await context.transport(alias);
	const existing = await transport.getDraft(draftId);
	const headers = existing.message?.payload?.headers ?? [];
	const to = input.to ?? parseAddressList(headerValue(headers, "To")).map((entry) => entry.address);
	const cc = input.cc ?? parseAddressList(headerValue(headers, "Cc")).map((entry) => entry.address);
	const bcc = input.bcc ?? parseAddressList(headerValue(headers, "Bcc")).map((entry) => entry.address);
	const subject = input.subject ?? headerValue(headers, "Subject") ?? "";
	const from = resolved.inbox.email;
	const existingParts = readParts(existing.message?.payload);
	const existingText = existingParts.plain[0]?.text ?? "";
	const keptSignature = await signatureFor(context, alias, resolved.inbox.email);
	const text = input.text ?? stripTrailing(existingText, keptSignature?.text);
	if (!input.text && !text.trim()) throw new CommsError("USAGE", "this draft has no body, and none was given", { hint: "Pass `text` with what the message should say." });
	const carried = input.attach ? {
		attachments: [],
		described: [],
		warnings: []
	} : await carriedAttachments(transport, existing.message?.id ?? "", existingParts);
	const { attachments: added, described: describedAdded, warnings: attachmentWarnings } = await attachmentsFor(context, input.attach ?? []);
	const attachments = [...carried.attachments, ...added];
	const described = [...carried.described, ...describedAdded];
	const signature = input.signature === false ? void 0 : keptSignature;
	const inReplyTo = headerValue(headers, "In-Reply-To");
	const references = (headerValue(headers, "References") ?? "").split(/\s+/).filter(Boolean);
	const composed = await composeMessage({
		from: formatAddress({
			name: "",
			address: from
		}),
		to,
		cc,
		bcc,
		subject,
		text,
		signature,
		attachments,
		inReplyTo,
		references
	});
	const saved = await transport.updateDraft(draftId, composed.raw, existing.message?.threadId ?? void 0);
	const warnings = [
		...attachmentWarnings,
		...signatureWarnings(composed.signatureResources),
		...warningsFor({
			to,
			cc,
			bcc,
			ownDomains: resolved.inbox.internalDomains
		})
	];
	await context.core.audit.append({
		inboxId: resolved.inbox.id,
		alias,
		operation: "draft.update",
		outcome: "ok",
		surface: context.surface,
		ids: {
			draftIds: [draftId],
			messageIds: [saved.messageId]
		},
		recipientDomains: recipientDomains([
			...to,
			...cc,
			...bcc
		])
	});
	return {
		inbox: alias,
		draftId: saved.draftId,
		messageId: saved.messageId,
		threadId: saved.threadId,
		to,
		cc,
		bcc,
		subject,
		preview: renderMessagePreview({
			recipients: {
				from,
				to: previewable(to),
				cc: previewable(cc),
				bcc: previewable(bcc)
			},
			subject,
			body: composed.text,
			attachments: described.map((attachment) => ({
				filename: attachment.filename,
				size: attachment.size,
				mimeType: attachment.mimeType
			})),
			context: {
				inbox: alias,
				draftId: saved.draftId,
				note: "nothing has been sent"
			},
			warnings
		}),
		attachments: described,
		bytes: composed.bytes,
		warnings,
		profile: input.includeProfile ? await profileFor(context, alias) : void 0
	};
}
/** Reads a draft back, with the preview: what the user would approve if asked now. */
async function getDraft(context, alias, draftId) {
	const resolved = await context.inbox(alias);
	await context.requireCapability(resolved, "draft");
	const message = (await (await context.transport(alias)).getDraft(draftId)).message;
	const headers = message?.payload?.headers ?? [];
	const parts = readParts(message?.payload);
	const to = parseAddressList(headerValue(headers, "To")).map((entry) => entry.address);
	const cc = parseAddressList(headerValue(headers, "Cc")).map((entry) => entry.address);
	const bcc = parseAddressList(headerValue(headers, "Bcc")).map((entry) => entry.address);
	const subject = headerValue(headers, "Subject") ?? "";
	const body = parts.plain.map((part) => part.text ?? "").join("\n");
	const attachments = parts.attachments.map((part) => ({
		filename: part.filename ?? "(unnamed)",
		size: part.size,
		mimeType: part.mimeType,
		source: "in the draft"
	}));
	const warnings = warningsFor({
		to,
		cc,
		bcc,
		ownDomains: resolved.inbox.internalDomains
	});
	return {
		inbox: alias,
		draftId,
		messageId: message?.id ?? "",
		threadId: message?.threadId ?? void 0,
		to,
		cc,
		bcc,
		subject,
		preview: renderMessagePreview({
			recipients: {
				from: resolved.inbox.email,
				to,
				cc,
				bcc
			},
			subject,
			body,
			attachments,
			context: {
				inbox: alias,
				draftId,
				note: "nothing has been sent"
			},
			warnings
		}),
		attachments,
		bytes: 0,
		warnings
	};
}
//#endregion
//#region src/operations/export.ts
/** The formats a message or thread can be written in, in the order they are offered. */
const EXPORT_FORMATS = [
	"md",
	"json",
	"eml"
];
function markdownForMessage(message) {
	const lines = [
		`## ${message.subject || "(no subject)"}`,
		"",
		`- **From:** ${message.from?.address ?? "unknown"}${message.from?.name ? ` (${message.from.name})` : ""}`,
		`- **To:** ${message.to.map((entry) => entry.address).join(", ") || "—"}`
	];
	if (message.cc.length > 0) lines.push(`- **Cc:** ${message.cc.map((entry) => entry.address).join(", ")}`);
	lines.push(`- **Date:** ${message.date ?? "unknown"}`, `- **Message:** ${message.messageId}`);
	if (message.auth.evaluatedBy) lines.push(`- **Authentication:** spf ${message.auth.spf ?? "—"}, dkim ${message.auth.dkim ?? "—"}, dmarc ${message.auth.dmarc ?? "—"}`);
	if (message.sanitisation.hiddenElements > 0 || message.sanitisation.plainHtmlMismatch) lines.push(`- **Hidden content removed:** ${message.sanitisation.hiddenElements} element(s)` + (message.sanitisation.plainHtmlMismatch ? `, and ${message.sanitisation.plainHtmlMismatch.extraChars} characters present only in the plain-text part` : ""));
	if (message.attachments.length > 0) {
		lines.push("", "### Attachments", "");
		for (const attachment of message.attachments) lines.push(`- part ${attachment.partId} — ${Math.round(attachment.size / 1024)} KB` + (attachment.riskFlags.length ? ` (${attachment.riskFlags.join(", ")})` : ""), `  type ${attachment.mimeType}`, attachment.filename);
	}
	lines.push("", message.body.enveloped, "");
	return lines.join("\n");
}
async function exportMail(context, alias, id, options = {}) {
	const format = oneOf(options.format, EXPORT_FORMATS, "an export format") ?? "md";
	const resolved = await context.inbox(alias);
	await context.requireCapability(resolved, "read");
	const root = await downloadsRoot(context);
	const directory = await resolveInsideRoot(root, join(alias, relativeSubpath(options.out) || "exports"));
	await mkdir(directory, {
		recursive: true,
		mode: 448
	});
	let content;
	let name;
	let kind = options.thread ? "thread" : "message";
	let messageCount = 1;
	if (format === "eml") {
		if (options.thread) throw new CommsError("USAGE", "a thread cannot be exported as one .eml file", { hint: "Export the thread as md or json, or export each message as eml by its own id." });
		content = await (await context.transport(alias)).getRawMessage(id);
		name = `${slug(id, 30, "message")}.eml`;
		kind = "message";
	} else if (options.thread) {
		const thread = await readThread(context, alias, id, {
			includeQuoted: options.includeQuoted,
			maxChars: 1e5,
			maxThreadChars: 1e6
		});
		messageCount = thread.messages.length;
		const body = format === "json" ? JSON.stringify(thread, null, 2) : [
			`# ${thread.subject || "(no subject)"}`,
			"",
			`${thread.messageCount} messages · ${thread.participants.join(", ")} · exported from ${alias}`,
			"",
			...thread.messages.map(markdownForMessage)
		].join("\n");
		content = Buffer.from(body, "utf8");
		const began = thread.messages[0]?.date;
		name = `${dayOf(began ? Date.parse(began) : null)}_thread-${slug(thread.threadId, 64, "thread")}.${format}`;
	} else {
		const message = await readMessage(context, alias, id, {
			includeQuoted: options.includeQuoted,
			maxChars: 1e5
		});
		const body = format === "json" ? JSON.stringify(message, null, 2) : markdownForMessage(message);
		content = Buffer.from(body, "utf8");
		name = `${dayOf(message.date ? Date.parse(message.date) : null)}_message-${slug(message.messageId, 64, "message")}.${format}`;
	}
	const { path, handle } = await createUniqueFile(directory, safeFilename(name));
	try {
		await handle.writeFile(content);
	} finally {
		await handle.close();
	}
	await context.core.audit.append({
		inboxId: resolved.inbox.id,
		alias,
		operation: "export",
		outcome: "ok",
		surface: context.surface,
		ids: { [kind === "thread" ? "threadIds" : "messageIds"]: [id] },
		reason: `${format}, ${content.byteLength} bytes`
	});
	return {
		path,
		format,
		bytes: content.byteLength,
		kind,
		messageCount
	};
}
//#endregion
//#region src/operations/import-legacy.ts
/** Both shapes the legacy server has written: `{tokens: {...}, scopes: [...]}` and the older flat token object. */
function parseLegacyCredentials(text) {
	let json;
	try {
		json = JSON.parse(text);
	} catch {
		throw new CommsError("BAD_DATA", "the credentials file is not valid JSON");
	}
	const tokens = json.tokens ?? json;
	const refreshToken = tokens.refresh_token;
	if (typeof refreshToken !== "string" || !refreshToken) throw new CommsError("BAD_DATA", "the credentials file has no refresh token");
	const recorded = Array.isArray(json.scopes) ? json.scopes.map(String) : [];
	return {
		refreshToken,
		scopes: recorded.length > 0 ? parseGrantedScopes(recorded.join(" ")) : parseGrantedScopes(String(tokens.scope ?? ""))
	};
}
/** `creds-work.json` → `work`; the default `credentials.json` → `default`. */
function aliasFromCredentialsFile(file) {
	const name = basename(file).replace(/\.json$/i, "");
	if (name === "credentials") return "default";
	const alias = name.replace(/^creds-/, "").toLowerCase();
	return isValidAlias(alias) ? alias : "imported";
}
/** Where the other server keeps its files: `--dir`, or its own default. */
function importDirectory(context, dir) {
	return expandHome(dir ?? "~/.gmail-mcp", homeDirectory(context.env));
}
/**
* Importing another server's mailboxes, as one change both surfaces run through core's flow.
*
* It loosens no setting — an imported mailbox arrives at the defaults, as a connected one does — but it connects
* accounts, stores their tokens and possibly an OAuth client's secret on this machine, and the design counts adding
* an account as a change a person approves. So the plan is a dry run, and its findings are the effects: every
* mailbox by name, address and file, and the client if it is new. What the dry run found is what `apply` imports.
*
* Asked for as a dry run, it is one: no effects, so nobody is asked, and nothing is written.
*/
function inboxImportChange(context, request) {
	const options = {
		...request,
		store: parseStore(request.store)
	};
	if (options.dryRun) return {
		plan: (config) => ({
			before: config,
			after: config,
			summary: "Say what an import would do"
		}),
		apply: () => importLegacy(context, {
			...options,
			dryRun: true,
			approved: void 0
		})
	};
	let approved;
	return {
		plan: async (config) => {
			const { store } = secretsStoreFor(config, options.store, context.platform);
			const found = await importLegacy(context, {
				...options,
				dryRun: true,
				approved: void 0
			});
			const client = found.client;
			approved = {
				registersClient: client !== null && !client.alreadyPresent,
				mailboxes: found.imported.map((candidate) => ({
					file: candidate.file,
					alias: candidate.alias,
					email: candidate.email ?? ""
				}))
			};
			const directory = importDirectory(context, options.dir);
			const effects = [...approved.registersClient && client ? [`registers the OAuth client ${client.clientId} from ${join(directory, "gcp-oauth.keys.json")} as "${client.name}", and keeps its secret in the ${store} store on this machine`] : [], ...found.imported.map((candidate) => `connects ${candidate.alias} (${candidate.email}) with ${candidate.tier} access, copying the token in ${candidate.file}; the file itself is left as it is`)];
			const count = found.imported.length;
			return {
				before: config,
				after: approved.registersClient ? {
					...config,
					secrets: { store }
				} : config,
				summary: `Import ${count} mailbox${count === 1 ? "" : "es"} from ${directory}`,
				effects
			};
		},
		apply: () => {
			if (!approved) throw new CommsError("UNEXPECTED", "the import was not planned before it was applied");
			return importLegacy(context, {
				...options,
				dryRun: false,
				approved
			});
		}
	};
}
async function importLegacy(context, options = {}) {
	const directory = importDirectory(context, options.dir);
	const clientName = options.clientName ?? "imported";
	const dryRun = options.dryRun ?? false;
	let entries;
	try {
		entries = await readdir(directory);
	} catch {
		throw new CommsError("NOT_FOUND", `there is nothing to import from ${directory}`, { hint: "Pass --dir if the other server keeps its files somewhere else." });
	}
	const keysFile = entries.includes("gcp-oauth.keys.json") ? join(directory, "gcp-oauth.keys.json") : null;
	if (!keysFile) throw new CommsError("NOT_FOUND", `no gcp-oauth.keys.json in ${directory}`, { hint: "That file holds the OAuth client the other server used; without it the tokens cannot be renewed." });
	const keysContent = await readSmallFile(keysFile, { follow: false });
	if (!keysContent.ok) throw new CommsError("BAD_DATA", `${keysFile} is not a readable client JSON`, { hint: "It should be the small JSON the other server was given by Google Cloud." });
	const parsedClient = parseClientJson(keysContent.text);
	const config = await context.config();
	const existingClient = Object.entries(config.clients).find(([, row]) => row.clientId === parsedClient.clientId);
	const clientKey = existingClient?.[0] ?? clientName;
	if (!existingClient && Object.hasOwn(config.clients, clientKey)) throw new CommsError("CONFIG", `an OAuth client called "${clientKey}" already exists, for a different Google project`, { hint: "Import it under another name with `--name <name>`." });
	const approved = dryRun ? void 0 : options.approved;
	if (approved && !approved.registersClient && !existingClient) throw new CommsError("CONFIG", `the OAuth client this import was approved to use is no longer registered`, { hint: "Nothing was imported. Prepare the import again, and read the preview before approving it." });
	const credentialFiles = entries.filter((entry) => /^creds-.+\.json$/i.test(entry) || entry === "credentials.json");
	const names = importNames(config, credentialFiles, options.renames ?? []);
	const imported = [];
	const skipped = [];
	const { store } = secretsStoreFor(config, options.store, context.platform);
	const secrets = dryRun ? null : await context.core.secrets(store);
	if (!dryRun && secrets && !existingClient) {
		const ref = clientSecretRef(clientKey);
		await withCredentialsLock(context.core.paths.configDir, async () => {
			const held = (await context.config()).clients;
			if (Object.hasOwn(held, clientKey)) throw new CommsError("CONFIG", `an OAuth client called "${clientKey}" was added while this ran`, { hint: "Run the import again." });
			await storeThenRecord(secrets, ref, parsedClient.clientSecret, () => context.core.config.update((current) => {
				if (Object.hasOwn(current.clients, clientKey)) throw new CommsError("CONFIG", `an OAuth client called "${clientKey}" was added while this ran`, { hint: "Run the import again." });
				requireStore(current, secrets.kind);
				return {
					...current,
					secrets: { store: current.secrets?.store ?? store },
					clients: {
						...current.clients,
						[clientKey]: {
							provider: "gmail",
							clientId: parsedClient.clientId,
							projectId: parsedClient.projectId,
							secretRef: ref,
							addedAt: context.now().toISOString()
						}
					}
				};
			}), async () => {
				const row = (await context.config()).clients[clientKey];
				return row?.secretRef === ref && row.clientId === parsedClient.clientId;
			}, async () => {
				const row = (await context.config()).clients[clientKey];
				return row?.secretRef === ref && row.clientId !== parsedClient.clientId;
			});
		});
		await clearSetupProgress(context.core.paths.stateDir).catch(() => void 0);
	}
	for (const file of credentialFiles.sort()) {
		const path = join(directory, file);
		const alias = names.get(file) ?? aliasFromCredentialsFile(file);
		let credentials;
		try {
			const content = await readSmallFile(path, { follow: false });
			if (!content.ok) throw new CommsError("BAD_DATA", `${path} is not a readable credentials file`);
			credentials = parseLegacyCredentials(content.text);
		} catch (error) {
			skipped.push({
				alias,
				file: path,
				scopes: [],
				tier: "read",
				problem: error.message
			});
			continue;
		}
		const candidate = {
			alias,
			file: path,
			scopes: credentials.scopes,
			tier: tierOf(credentials.scopes) ?? "read"
		};
		if (!capabilitiesOf(credentials.scopes).has("read")) {
			skipped.push({
				...candidate,
				problem: "this grant cannot read the mailbox"
			});
			continue;
		}
		let email;
		try {
			email = await identify(context, parsedClient, credentials.refreshToken);
		} catch (error) {
			skipped.push({
				...candidate,
				problem: error.message
			});
			continue;
		}
		candidate.email = email;
		const current = await context.config();
		const duplicate = duplicateInbox(current, {
			client: clientKey,
			email
		});
		if (duplicate) {
			skipped.push({
				...candidate,
				duplicateOf: duplicate,
				problem: `already connected as "${duplicate}"`
			});
			continue;
		}
		const outside = approved ? outsideApproval(approved, candidate) : null;
		if (outside) {
			skipped.push({
				...candidate,
				problem: outside
			});
			continue;
		}
		if (dryRun) {
			imported.push(candidate);
			continue;
		}
		const id = newInboxId();
		const inbox = {
			id,
			provider: "gmail",
			email,
			identity: "legacy",
			client: clientKey,
			tier: candidate.tier,
			contacts: capabilitiesOf(credentials.scopes).has("contacts"),
			grantedScopes: credentials.scopes,
			secretRef: refreshTokenRef(id),
			internalDomains: defaultInternalDomains(email, PUBLIC_MAILBOX_DOMAINS),
			createdAt: context.now().toISOString()
		};
		if (secrets) await storeThenRecord(secrets, inbox.secretRef, credentials.refreshToken, () => context.core.config.update((existing) => {
			requireNewInboxName(existing, alias, "Run the import again.", context.platform);
			requireStore(existing, secrets.kind);
			const raced = duplicateInbox(existing, {
				client: clientKey,
				email
			});
			if (raced) throw new CommsError("CONFIG", `${email} was connected as "${raced}" while this ran`, { hint: "Run the import again." });
			if (existing.clients[clientKey]?.clientId !== parsedClient.clientId) throw new CommsError("CONFIG", `the OAuth client "${clientKey}" changed while this ran`, { hint: "Run the import again." });
			return {
				...existing,
				inboxes: {
					...existing.inboxes,
					[alias]: inbox
				}
			};
		}), async () => findById(await context.config(), "inbox", id)?.inbox.secretRef === inbox.secretRef);
		await context.core.audit.append({
			inboxId: id,
			alias,
			operation: "inbox.import",
			outcome: "ok",
			surface: context.surface,
			reason: `from ${path}`
		});
		imported.push(candidate);
	}
	context.forgetTransports();
	const ungatedServers = findUngatedGmailServers(await listRegisteredServers(context.env), context.platform);
	return {
		dryRun,
		client: {
			name: clientKey,
			clientId: parsedClient.clientId,
			imported: !dryRun && !existingClient,
			alreadyPresent: Boolean(existingClient)
		},
		imported,
		skipped,
		ungatedServers,
		nextSteps: nextSteps(imported, ungatedServers, dryRun, context.platform)
	};
}
/** Why a mailbox about to be imported is not the one an approval covered, or null when it is. */
function outsideApproval(approved, candidate) {
	const allowed = approved.mailboxes.find((mailbox) => mailbox.file === candidate.file);
	if (!allowed) return "it was not in the import that was approved";
	if (allowed.alias !== candidate.alias) return `it would be called "${candidate.alias}" now, not the "${allowed.alias}" that was approved`;
	if (allowed.email.toLowerCase() !== (candidate.email ?? "").toLowerCase()) return `it is ${candidate.email ?? "an unknown address"} now, not the ${allowed.email} that was approved`;
	return null;
}
function nextSteps(imported, ungated, dryRun, platform) {
	const steps = [];
	if (dryRun) {
		steps.push("Run the same command without --dry-run to import these.");
		return steps;
	}
	const needsUpgrade = imported.filter((candidate) => candidate.tier !== "organize");
	for (const candidate of needsUpgrade) steps.push(`${commandText(shellCommand([
		"agent-gmail",
		"inbox",
		"reauth",
		candidate.alias,
		"--start"
	], platform))}  (to label and archive, and to record which account it is)`);
	for (const finding of ungated) steps.push(`${finding.removal}  (while ${finding.packageName} is connected, an agent can send without approval)`);
	if (imported.length > 0) steps.push("agent-gmail doctor");
	return steps;
}
/** Renews an imported token once, to prove it works and to learn which mailbox it is. */
async function identify(context, client, refreshToken) {
	const response = await fetch(context.endpoints.tokenUrl, {
		method: "POST",
		headers: { "content-type": "application/x-www-form-urlencoded" },
		body: new URLSearchParams({
			grant_type: "refresh_token",
			refresh_token: refreshToken,
			client_id: client.clientId,
			client_secret: client.clientSecret
		})
	}).catch((error) => {
		throw new CommsError("PROVIDER_UNAVAILABLE", "could not reach Google to check the imported token", { cause: error });
	});
	const body = await response.json().catch(() => ({}));
	if (!response.ok || !body.access_token) throw new CommsError("AUTH_REQUIRED", `Google will not renew this token (${body.error ?? response.status})`, { hint: "Connect the mailbox from scratch with `agent-gmail inbox add <name> --start`." });
	return (await getProfileWithToken(context.endpoints, body.access_token)).emailAddress;
}
/**
* What each credentials file will be called, decided before anything is written.
*
* Version 1 keeps the plain name the file implies, made unique with `-2`, `-3`… Version 2 proposes
* `<legacy name>/gmail`, made unique with a qualifier — `work/gmail-2`. `--rename work=acme/gmail` overrides one, by
* the legacy name. Every problem — an override naming no file, a target the config cannot take, two files given one
* name — is collected and refused together, so nothing is half-imported under names somebody would have to undo.
*/
function importNames(config, files, renames) {
	const problems = [];
	const byLegacy = /* @__PURE__ */ new Map();
	for (const file of files) {
		const from = aliasFromCredentialsFile(file);
		byLegacy.set(from, [...byLegacy.get(from) ?? [], file]);
	}
	const overrides = /* @__PURE__ */ new Map();
	for (const rename of renames) {
		const at = rename.indexOf("=");
		const from = rename.slice(0, at);
		const to = rename.slice(at + 1);
		if (at <= 0 || !to) problems.push(`"${rename}" is not <legacy name>=<name>`);
		else if (!byLegacy.has(from)) problems.push(`no credentials file is called "${from}"`);
		else if ((byLegacy.get(from)?.length ?? 0) > 1) problems.push(`"${from}" is more than one file, so it cannot be renamed`);
		else if (overrides.has(from)) problems.push(`"${from}" is renamed more than once`);
		else overrides.set(from, to);
	}
	const taken = /* @__PURE__ */ new Set();
	const free = (name) => !taken.has(name) && nameAvailable(config, "inbox", name, "gmail").ok;
	const names = /* @__PURE__ */ new Map();
	for (const file of [...files].sort()) {
		const from = aliasFromCredentialsFile(file);
		const override = overrides.get(from);
		let name;
		if (override !== void 0) {
			const check = nameAvailable(config, "inbox", override, "gmail");
			if (!check.ok) problems.push(`${from}: ${check.error.message}`);
			else if (taken.has(override)) problems.push(`"${override}" is given to more than one mailbox`);
			name = override;
		} else {
			const base = config.version === 2 ? `${from}/gmail` : from;
			const variant = (n) => config.version === 2 ? `${from}/gmail-${n}` : `${from}-${n}`;
			name = base;
			for (let n = 2; !free(name) && n < 50; n++) name = variant(n);
			if (!free(name)) problems.push(`${from}: no free name near "${base}" — choose one with --rename ${from}=<name>`);
		}
		taken.add(name);
		names.set(file, name);
	}
	if (problems.length > 0) throw new CommsError("USAGE", `nothing was imported: ${problems.length === 1 ? problems[0] : `${problems.length} problems`}`, {
		hint: problems.map((problem) => `- ${problem}`).join("\n"),
		details: { problems }
	});
	return names;
}
/**
* Refuses a write whose secret went into a backend that is no longer the one in use: recorded, or — with none
* recorded — the keychain a token stored meanwhile commits this configuration to.
*/
function requireStore(config, kind) {
	if ((committedSecretsStore(config) ?? kind) !== kind) throw new CommsError("TRANSIENT", "the secret store was changed while this ran", { hint: "Run the import again." });
}
/**
* Stores a secret, then the config row naming it — and if the row's write is rejected, looks before undoing.
*
* A rejected write may have committed (see `writeOutcome` in core). The secret is kept when the row is there, taken
* back when it is not, and kept and reported when nobody can tell.
*/
async function storeThenRecord(secrets, ref, value, record, recorded, ownedByAnother) {
	try {
		await secrets.set(ref, value);
		await record();
	} catch (error) {
		const landed = await writeOutcome(recorded);
		if (landed === "unknown") throw keepAndReport(error, ref, "Run `agent-gmail inbox list`.");
		if (landed === "absent") {
			if (ownedByAnother) {
				const base = error instanceof CommsError ? error : new CommsError("UNEXPECTED", String(error));
				const contested = await writeOutcome(ownedByAnother) !== "absent";
				throw new CommsError(base.code, base.message, {
					hint: contested ? `${base.hint ? `${base.hint} ` : ""}Something else registered this client name while the import ran, and both wrote \`${ref}\`, so it may now hold the wrong secret. Register that client again with \`agent-gmail client add <its JSON> --replace\`.` : `${base.hint ? `${base.hint} ` : ""}The client's secret was stored as \`${ref}\` but not registered. Run the import again, or delete it from your secret store.`,
					details: contested ? { contestedSecretRef: ref } : { strandedSecretRef: ref },
					cause: error
				});
			}
			throw await withdrawStaged(secrets, ref, error);
		}
	}
}
//#endregion
//#region src/operations/organise.ts
/** Resolves a label the way a person means it: by id, by its Gmail name, or by a system name in any case. */
async function resolveLabelIds(context, alias, names) {
	if (names.length === 0) return [];
	const labels = await (await context.transport(alias)).listLabels();
	const byId = new Map(labels.map((label) => [label.id, label.id]));
	const byName = new Map(labels.map((label) => [label.name.toLowerCase(), label.id]));
	return names.map((name) => {
		const exact = byId.get(name);
		if (exact) return exact;
		const named = byName.get(name.toLowerCase());
		if (named) return named;
		const system = name.toUpperCase().replace(/[\s-]+/g, "_");
		if (byId.has(system)) return system;
		throw new CommsError("NOT_FOUND", `no label called "${name}"`, { hint: `Labels in this mailbox: ${labels.map((label) => label.name).slice(0, 20).join(", ")}.` });
	});
}
/**
* Applies an undo returned by `modify`.
*
* The entries differ per message, and Gmail's batch takes one pair of label lists for a whole set of ids — so the
* entries are grouped by the change they ask for and one batch is sent per group. Two or three groups is typical;
* a selection that was already uniform collapses to one.
*/
async function applyUndo(context, alias, entries) {
	const resolved = await context.inbox(alias);
	await context.requireCapability(resolved, "organize");
	const transport = await context.transport(alias);
	if (entries.length === 0) throw new CommsError("USAGE", "there is nothing to put back");
	const groups = /* @__PURE__ */ new Map();
	for (const entry of entries) {
		const add = [...entry.addLabelIds].sort();
		const remove = [...entry.removeLabelIds].sort();
		const key = `${add.join(",")}|${remove.join(",")}`;
		const group = groups.get(key) ?? {
			add,
			remove,
			ids: []
		};
		group.ids.push(entry.messageId);
		groups.set(key, group);
	}
	for (const group of groups.values()) await transport.modifyMessages(group.ids, group.add, group.remove);
	await context.core.audit.append({
		inboxId: resolved.inbox.id,
		alias,
		operation: "modify.undo",
		outcome: "ok",
		surface: context.surface,
		ids: { messageIds: entries.map((entry) => entry.messageId) },
		reason: `${groups.size} group(s)`
	});
	return {
		inbox: alias,
		messages: entries.length,
		groups: groups.size
	};
}
/**
* Refuses to touch a message that a send is standing on.
*
* `draft update` and `draft delete` already refuse while an approval for that draft is sending. Labelling or
* binning the draft's *message* is the same act reached through a different operation — and it was not guarded,
* which is the shape of bug this project keeps finding: a rule applied to one operation and not its sibling.
*
* The send would survive it: the final re-read compares the message id and the digest, so a changed draft aborts.
* But it aborts with a confusing error about a draft that changed, when the truth is that another tool moved it.
*/
async function refuseWhileSending(context, inboxId, messageIds) {
	if (messageIds.length === 0) return;
	const sending = await context.core.approvals.list({
		inboxId,
		states: ["sending"]
	});
	const held = new Set(sending.map((record) => record.draftMessageId));
	const clash = messageIds.find((id) => held.has(id));
	if (clash) throw new CommsError("APPROVAL_PENDING", "that message is a draft being sent right now, so it cannot be changed", {
		hint: "Wait for the send to finish, then look at the message in Sent.",
		details: { messageId: clash }
	});
}
async function modify(context, alias, options) {
	const resolved = await context.inbox(alias);
	await context.requireCapability(resolved, "organize");
	const transport = await context.transport(alias);
	const messageIds = options.messageIds ?? [];
	const threadIds = options.threadIds ?? [];
	if (messageIds.length === 0 && threadIds.length === 0) throw new CommsError("USAGE", "name the messages or threads to change", { hint: "Pass messageIds or threadIds; search returns both." });
	const add = new Set(await resolveLabelIds(context, alias, options.addLabels ?? []));
	const remove = new Set(await resolveLabelIds(context, alias, options.removeLabels ?? []));
	if (options.archive) remove.add("INBOX");
	if (options.markRead) remove.add("UNREAD");
	if (options.markUnread) add.add("UNREAD");
	if (options.star) add.add("STARRED");
	if (options.unstar) remove.add("STARRED");
	const overlap = [...add].filter((label) => remove.has(label));
	if (overlap.length > 0) throw new CommsError("USAGE", `${overlap.join(", ")} would be both added and removed`, { hint: "Ask for one or the other." });
	if (add.size === 0 && remove.size === 0) throw new CommsError("USAGE", "nothing to change", { hint: "Pass labels to add or remove, or one of --archive, --read, --unread, --star, --unstar." });
	const expanded = [...messageIds];
	for (const threadId of threadIds) {
		const thread = await transport.getThread(threadId);
		for (const message of thread.messages ?? []) if (message.id) expanded.push(message.id);
	}
	const unique = [...new Set(expanded)];
	await refuseWhileSending(context, resolved.inbox.id, unique);
	const undo = [];
	for (const messageId of unique) {
		let current = [];
		try {
			current = (await transport.getMessageMetadata(messageId)).labelIds ?? [];
		} catch {
			continue;
		}
		const held = new Set(current);
		undo.push({
			messageId,
			addLabelIds: [...remove].filter((label) => held.has(label)),
			removeLabelIds: [...add].filter((label) => !held.has(label))
		});
	}
	const result = {
		inbox: alias,
		dryRun: Boolean(options.dryRun),
		messages: unique.length,
		threads: threadIds.length,
		addLabelIds: [...add],
		removeLabelIds: [...remove],
		undo: undo.filter((entry) => entry.addLabelIds.length > 0 || entry.removeLabelIds.length > 0)
	};
	if (options.dryRun) return result;
	await transport.modifyMessages(unique, [...add], [...remove]);
	await context.core.audit.append({
		inboxId: resolved.inbox.id,
		alias,
		operation: "modify",
		outcome: "ok",
		surface: context.surface,
		ids: { messageIds: unique },
		reason: `+${[...add].join(",") || "none"} -${[...remove].join(",") || "none"}`
	});
	return result;
}
/**
* Moves messages to the bin, or takes them out again. Nothing is deleted outright: Gmail keeps a binned message for
* thirty days, so this is reversible, and permanent deletion is not offered at all.
*/
async function trash(context, alias, options) {
	const resolved = await context.inbox(alias);
	await context.requireCapability(resolved, "organize");
	const transport = await context.transport(alias);
	const expanded = [...options.messageIds ?? []];
	for (const threadId of options.threadIds ?? []) {
		const thread = await transport.getThread(threadId);
		for (const message of thread.messages ?? []) if (message.id) expanded.push(message.id);
	}
	const unique = [...new Set(expanded)];
	if (unique.length === 0) throw new CommsError("USAGE", "name the messages or threads to move", { hint: "Pass messageIds or threadIds." });
	await refuseWhileSending(context, resolved.inbox.id, unique);
	const action = options.undo ? "untrash" : "trash";
	if (options.dryRun) return {
		inbox: alias,
		dryRun: true,
		messages: unique,
		action
	};
	for (const messageId of unique) if (action === "trash") await transport.trashMessage(messageId);
	else await transport.untrashMessage(messageId);
	await context.core.audit.append({
		inboxId: resolved.inbox.id,
		alias,
		operation: action,
		outcome: "ok",
		surface: context.surface,
		ids: { messageIds: unique }
	});
	return {
		inbox: alias,
		dryRun: false,
		messages: unique,
		action
	};
}
/** Creates a label, or returns the one already there: asking twice should not be an error. */
async function createLabel(context, alias, name) {
	const resolved = await context.inbox(alias);
	await context.requireCapability(resolved, "organize");
	const transport = await context.transport(alias);
	const trimmed = name.trim();
	if (!trimmed) throw new CommsError("USAGE", "a label needs a name");
	const existing = (await transport.listLabels()).find((label) => label.name.toLowerCase() === trimmed.toLowerCase());
	if (existing) return {
		id: existing.id,
		name: existing.name,
		existed: true
	};
	const created = await transport.createLabel(trimmed);
	await context.core.audit.append({
		inboxId: resolved.inbox.id,
		alias,
		operation: "label.create",
		outcome: "ok",
		surface: context.surface,
		ids: { labelIds: [created.id] },
		reason: trimmed
	});
	return {
		id: created.id,
		name: created.name,
		existed: false
	};
}
//#endregion
//#region src/domain/outbound.ts
const GMAIL_SIGNATURE = /<div[^>]*class="[^"]*gmail_signature[^"]*"[^>]*>([\s\S]*?)<\/div>/i;
/**
* Removes a signature block from the HTML **only when it is byte-identical to the mailbox's live signature**.
*
* The signature is the user's own HTML and often carries a company logo from a remote URL, which the remote-resource
* rule would otherwise refuse. Exempting it by its marker alone would let anyone smuggle a beacon inside a div with
* the right class, so the exemption is the whole block matching what Gmail reports for this From address, fetched at
* prepare time; anything else is analysed like the rest of the message.
*/
function separateSignature(html, liveSignature) {
	if (!liveSignature?.trim()) return {
		body: html,
		signature: null
	};
	const match = GMAIL_SIGNATURE.exec(html);
	if (!match) return {
		body: html,
		signature: null
	};
	const inner = match[1] ?? "";
	if (inner.trim() !== liveSignature.trim()) return {
		body: html,
		signature: null
	};
	return {
		body: html.replace(match[0], ""),
		signature: {
			block: match[0],
			inner
		}
	};
}
/**
* Every address under a header name, across **all** instances of it.
*
* A message may legitimately carry more than one `Cc:` line, and a reader of only the first would digest a message
* with fewer recipients than the one that goes out — which is the difference between what was approved and what was
* sent. Merged and de-duplicated, order preserved.
*/
function mergedAddresses(headers, name) {
	const merged = headerValues(headers, name).flatMap((value) => parseAddressList(value).map((entry) => entry.address));
	return [...new Set(merged)];
}
/**
* Reads a draft into the form an approval is bound to, and refuses it if an agent could not have written it.
*
* `fetchAttachment` is called for every attachment: the digest covers the bytes, not just the name and size, so
* replacing a file with another of the same length is a different message. Sends are rare and a prepare that reads
* the attachments once is the cheapest honest answer.
*/
async function analyseDraft(options) {
	const { message, sendAs } = options;
	const headers = message.payload?.headers ?? [];
	const parts = readParts(message.payload);
	const from = headerValue(headers, "From") ?? "";
	const fromAddress = normaliseAddress(parseAddressList(from)[0]?.address ?? "");
	const liveSignature = sendAs.find((entry) => normaliseAddress(entry.sendAsEmail) === fromAddress)?.signature;
	const refusals = [];
	if (parts.plain.length > 1 || parts.html.length > 1) refusals.push({
		reason: "it has more than one body part, and only one of each can be shown and checked",
		detail: `${parts.plain.length} text part(s), ${parts.html.length} HTML part(s)`
	});
	const text = parts.plain[0]?.text ?? "";
	const html = parts.html[0]?.text ?? "";
	if (html && !text.trim()) refusals.push({
		reason: "it has no plain-text part, so there is nothing to show you that matches what would be sent",
		detail: "every message this package composes carries both parts"
	});
	let visibleText = collapseWhitespace(text);
	let links = [];
	let signatureResources = [];
	if (html) {
		const { body, signature } = separateSignature(html, liveSignature);
		const report = analyseOutboundHtml(body);
		visibleText = collapseWhitespace(report.visibleText);
		links = [...new Set(report.urls.map((entry) => entry.url))];
		if (signature) {
			const inSignature = analyseOutboundHtml(signature.block);
			signatureResources = [...new Set(inSignature.remoteResources)];
			links = [.../* @__PURE__ */ new Set([...links, ...inSignature.urls.map((entry) => entry.url)])];
		}
		if (report.remoteResources.length > 0) refusals.push({
			reason: "it loads something from the internet when it is opened",
			detail: report.remoteResources.slice(0, 5).join(", ")
		});
		if (report.hidden.length > 0) refusals.push({
			reason: "it contains content a recipient would not see",
			detail: report.hidden.map((entry) => entry.reason).slice(0, 5).join(", ")
		});
		const formElements = report.forms + report.formFields;
		if (formElements > 0) refusals.push({
			reason: "it contains a form",
			detail: `${formElements} element(s)`
		});
		if (report.scripts > 0) refusals.push({
			reason: "it contains a script",
			detail: `${report.scripts} element(s)`
		});
		const images = report.images.filter((image) => !report.remoteResources.includes(image.url));
		if (images.length > 0) refusals.push({
			reason: "it shows an image, which the preview cannot show",
			detail: images.slice(0, 5).map((image) => `${image.where} ${image.url.length > 60 ? `${image.url.slice(0, 60)}…` : image.url}`.trim()).join(", ")
		});
		if (report.alterations.length > 0) refusals.push({
			reason: "it changes what its text shows, or the order it is read in",
			detail: [...new Set(report.alterations.map((entry) => entry.reason))].slice(0, 5).join("; ")
		});
		const comparable = collapseWhitespace(analyseOutboundHtml(html).comparableText);
		const plain = collapseWhitespace(text);
		if (plain && comparable && plain !== comparable) refusals.push({
			reason: "its plain-text and HTML parts do not say the same thing",
			detail: `text ${plain.length} characters, HTML ${comparable.length}`
		});
	}
	const attachments = [];
	for (const attachment of parts.attachments) {
		const bytes = attachment.attachmentId ? await options.fetchAttachment(attachment.attachmentId) : Buffer.from(attachment.text ?? "", "utf8");
		if (bytes.length === 0) refusals.push({
			reason: `the attachment "${attachment.filename ?? "(unnamed)"}" has no readable content`,
			detail: "an attachment whose bytes cannot be read cannot be bound to the approval"
		});
		attachments.push({
			filename: decodeHeaderWords(attachment.filename ?? "(unnamed)"),
			mimeType: attachment.mimeType ?? "application/octet-stream",
			size: bytes.length || (attachment.size ?? 0),
			sha256: sha256Hex(bytes)
		});
	}
	const canonical = {
		from: fromAddress,
		to: mergedAddresses(headers, "To"),
		cc: mergedAddresses(headers, "Cc"),
		bcc: mergedAddresses(headers, "Bcc"),
		replyTo: [.../* @__PURE__ */ new Set([...mergedAddresses(headers, "Reply-To"), ...mergedAddresses(headers, "Sender")])],
		subject: decodeHeaderWords(headerValue(headers, "Subject") ?? ""),
		threadId: options.threadId,
		inReplyTo: headerValue(headers, "In-Reply-To"),
		references: (headerValue(headers, "References") ?? "").split(/\s+/).filter(Boolean),
		visibleText,
		htmlSha256: html ? sha256Hex(html) : void 0,
		textSha256: text ? sha256Hex(text) : void 0,
		attachments
	};
	return {
		analysis: {
			from,
			to: canonical.to,
			cc: canonical.cc,
			bcc: canonical.bcc,
			replyTo: canonical.replyTo,
			subject: canonical.subject,
			threadId: options.threadId,
			inReplyTo: canonical.inReplyTo,
			references: canonical.references,
			text,
			visibleText,
			attachments,
			links,
			signatureResources,
			canonical,
			digest: messageDigest(canonical)
		},
		refusals
	};
}
/** The one error for a draft an agent may not send, carrying every reason rather than only the first. */
function unsendable(refusals) {
	return new CommsError("UNSENDABLE_HTML", `this draft cannot be sent by an agent: ${refusals[0]?.reason}`, {
		hint: "Review it and send it from Gmail. An agent may only send what it could have written itself.",
		details: { refusals: refusals.map((refusal) => `${refusal.reason} (${refusal.detail})`) }
	});
}
//#endregion
//#region src/operations/send.ts
const LOOKALIKE_DISTANCE = 2;
/** Levenshtein distance, capped: only used to notice that `partner.test` and `partners.test` are neighbours. */
function distance(a, b) {
	if (Math.abs(a.length - b.length) > LOOKALIKE_DISTANCE) return 3;
	let previous = Array.from({ length: b.length + 1 }, (_, index) => index);
	for (let i = 1; i <= a.length; i++) {
		const current = [i];
		for (let j = 1; j <= b.length; j++) current[j] = Math.min((previous[j] ?? 0) + 1, (current[j - 1] ?? 0) + 1, (previous[j - 1] ?? 0) + (a[i - 1] === b[j - 1] ? 0 : 1));
		previous = current;
	}
	return previous[b.length] ?? 3;
}
/** A record state in the words a person would use, for the message they read when a send does not happen. */
function describeState(state) {
	switch (state) {
		case "used": return "this approval has already been used — the message was sent once";
		case "sending": return "this approval is being sent by another process right now";
		case "failed": return "the send under this approval was refused; nothing was sent";
		case "unknown": return "a process died mid-send under this approval; whether the message went is not known";
		case "expired": return "this approval has expired";
		case "revoked": return "this approval was cancelled or voided";
		default: return `this approval is ${state}`;
	}
}
function messageOf(error) {
	return error instanceof Error ? error.message : String(error);
}
/** Keeps the failure that stopped the send visible, adding only what could not be settled afterwards. */
function noSendError(error, unrecorded) {
	const original = error instanceof CommsError ? error : new CommsError("UNEXPECTED", messageOf(error), { cause: error });
	const hint = [original.hint, ...unrecorded].filter((part) => part !== void 0);
	return new CommsError(original.code, original.message, {
		...hint.length === 0 ? {} : { hint: hint.join(" ") },
		...original.details === void 0 ? {} : { details: original.details },
		cause: error
	});
}
/** Settles a failure known to have happened before Gmail sent anything, without one failed write skipping another. */
async function recordNoSend(context, options, error) {
	const unrecorded = [];
	const said = messageOf(error);
	try {
		await context.core.ledger.release(options.inboxId, options.approvalId);
	} catch (failure) {
		unrecorded.push(`the capacity slot could not be released (${messageOf(failure)})`);
	}
	try {
		await context.core.approvals.complete(options.approvalId, { error: said });
	} catch (failure) {
		unrecorded.push(`the approval could not be marked failed (${messageOf(failure)})`);
	}
	try {
		await context.core.audit.append({
			inboxId: options.inboxId,
			alias: options.alias,
			operation: "send.execute",
			outcome: "failed",
			surface: context.surface,
			ids: {
				approvalIds: [options.approvalId],
				draftIds: [options.draftId]
			},
			reason: [said, ...unrecorded].join("; ")
		});
	} catch (failure) {
		unrecorded.push(`the audit log could not record the failure (${messageOf(failure)})`);
	}
	return noSendError(error, unrecorded);
}
function capsFor(defaults) {
	return {
		perHour: defaults.sendCaps.perHour,
		perDay: defaults.sendCaps.perDay
	};
}
/** Every address this mailbox can be: its own, plus each verified send-as. Never tainted, never "first-time". */
async function ownAddresses(transport, inbox) {
	const own = /* @__PURE__ */ new Set([canonicalAddress(inbox.inbox.email)]);
	try {
		for (const entry of await transport.listSendAs()) own.add(canonicalAddress(entry.sendAsEmail));
	} catch {}
	return own;
}
/**
* The domains this mailbox has written to recently.
*
* One list per prepare, from the last two hundred sent messages. It is the yardstick a lookalike is measured
* against, so it has to come from the mailbox's history rather than from the draft under examination.
*/
async function correspondentDomains(transport) {
	const domains = /* @__PURE__ */ new Set();
	try {
		const page = await transport.listMessages({
			query: "in:sent",
			maxResults: 200
		});
		for (const { id } of page.ids.slice(0, 200)) {
			const message = await transport.getMessageMetadata(id);
			for (const header of message.payload?.headers ?? []) {
				if (!/^(to|cc|bcc)$/i.test(header.name ?? "")) continue;
				for (const entry of (header.value ?? "").split(",")) {
					const domain = domainOf$1(canonicalAddress(entry.replace(/^.*<|>.*$/g, "").trim()));
					if (domain) domains.add(domain);
				}
			}
		}
	} catch {}
	return domains;
}
/**
* Has this mailbox written to this address before?
*
* Gmail's `to:` matching is fuzzy — it matches display names and partial addresses — so a hit is confirmed by
* comparing the parsed recipients of the messages it returns. A false "we have written to them" would remove exactly
* the warning a first-time external recipient is there to raise.
*/
async function hasWrittenTo(transport, address) {
	const canonical = canonicalAddress(address);
	const page = await transport.listMessages({
		query: `in:sent to:${canonical}`,
		maxResults: 5
	});
	for (const { id } of page.ids) if (((await transport.getMessageMetadata(id)).payload?.headers ?? []).filter((header) => /^(to|cc|bcc)$/i.test(header.name ?? "")).flatMap((header) => (header.value ?? "").split(",")).map((value) => canonicalAddress(value.replace(/^.*<|>.*$/g, "").trim())).includes(canonical)) return true;
	return false;
}
/**
* What is known about each recipient, and what it means for the policy.
*
* Risk escalation exists because `chat` trusts the agent to show the preview: a send to somebody the user has never
* written to, at an address that arrived in a message we read this week, is exactly the shape of an exfiltration, and
* it is worth taking out of the agent's hands entirely.
*/
async function studyRecipients(context, transport, inbox, analysis) {
	const own = await ownAddresses(transport, inbox);
	const internal = new Set(inbox.inbox.internalDomains.map((domain) => domain.toLowerCase()));
	const everyone = [.../* @__PURE__ */ new Set([
		...analysis.to,
		...analysis.cc,
		...analysis.bcc
	])];
	const knownDomains = await correspondentDomains(transport);
	for (const address of own) {
		const domain = domainOf$1(address);
		if (domain) knownDomains.add(domain);
	}
	for (const domain of internal) knownDomains.add(domain);
	const facts = [];
	for (const address of everyone) {
		const canonical = canonicalAddress(address);
		const domain = domainOf$1(canonical) ?? "";
		const external = !own.has(canonical) && !internal.has(domain);
		const seen = await context.core.taint.check(canonical);
		const written = own.has(canonical) ? true : await hasWrittenTo(transport, canonical);
		const tainted = seen.address || seen.domain;
		facts.push({
			address,
			external,
			firstTime: external && !written,
			tainted: tainted && !written,
			lookalikeOf: null,
			note: ""
		});
	}
	for (const fact of facts) {
		const domain = domainOf$1(canonicalAddress(fact.address)) ?? "";
		if (!fact.firstTime) continue;
		for (const known of knownDomains) if (known !== domain && distance(known, domain) <= LOOKALIKE_DISTANCE) {
			fact.lookalikeOf = known;
			break;
		}
	}
	for (const fact of facts) fact.note = [
		fact.external ? "EXTERNAL" : "internal",
		fact.firstTime ? "FIRST-TIME" : "",
		fact.tainted ? "ADDRESS SEEN IN MAIL YOU READ" : "",
		fact.lookalikeOf ? `LOOKS LIKE ${fact.lookalikeOf}` : ""
	].filter(Boolean).join(" · ");
	const flags = [];
	if (facts.some((fact) => fact.tainted)) flags.push("recipient-tainted");
	if (analysis.attachments.length > 0 && facts.some((fact) => fact.firstTime)) flags.push("attachment-to-first-time-recipient");
	if (facts.some((fact) => fact.lookalikeOf)) flags.push("lookalike-domain");
	return {
		facts,
		flags
	};
}
function expectationOf(analysis) {
	return {
		to: analysis.to,
		cc: analysis.cc,
		bcc: analysis.bcc,
		subject: analysis.subject
	};
}
/** Reads the draft and everything the approval will be bound to. Used by prepare and again by execute. */
async function readDraft(context, alias, draftId) {
	const transport = await context.transport(alias);
	const draft = await transport.getDraft(draftId);
	if (!draft.message?.id) throw new CommsError("NOT_FOUND", `there is no draft ${draftId} in this mailbox`, { hint: "List them with `agent-gmail draft list --inbox <alias>`." });
	const sendAs = await transport.listSendAs().catch(() => []);
	const { analysis, refusals } = await analyseDraft({
		message: draft.message,
		threadId: draft.message.threadId ?? void 0,
		sendAs,
		fetchAttachment: (attachmentId) => transport.getAttachment(draft.message?.id ?? "", attachmentId)
	});
	return {
		analysis,
		draftMessageId: draft.message.id,
		refusals
	};
}
function previewFor(options) {
	const { analysis, facts, record, alias } = options;
	const notes = {};
	for (const fact of facts) notes[fact.address] = fact.note;
	const warnings = [];
	if (analysis.signatureResources.length > 0) warnings.push(`signature loads ${analysis.signatureResources.length} image(s) from the internet when opened`);
	if (analysis.bcc.length > 0) warnings.push(`${analysis.bcc.length} blind recipient(s) — the others will not see them`);
	const preview = {
		recipients: {
			from: analysis.from,
			to: analysis.to,
			cc: analysis.cc,
			bcc: analysis.bcc,
			replyTo: analysis.replyTo.filter((address) => canonicalAddress(address) !== canonicalAddress(analysis.from))
		},
		subject: analysis.subject,
		body: analysis.text,
		attachments: analysis.attachments,
		context: {
			inbox: alias,
			approvalId: record.approvalId,
			draftId: record.draftId,
			note: "nothing has been sent"
		},
		recipientNotes: notes,
		thread: analysis.threadId ? `reply in conversation ${analysis.threadId}` : void 0,
		links: analysis.links,
		warnings,
		policy: options.effectivePolicy === "confirm" ? "Policy: confirm — this send needs approval outside the chat before it can go." : "Policy: chat — send only after the user approves this exact preview."
	};
	return renderMessagePreview(preview);
}
/**
* Step one. Reads the draft, refuses it if an agent could not have written it, and records an approval bound to this
* exact content. Nothing is sent, and preparing twice is free: each prepare is its own record.
*/
async function prepareSend(context, alias, draftId) {
	const resolved = await context.inbox(alias);
	await context.requireCapability(resolved, "draft");
	const config = await context.config();
	const livePolicy = resolved.inbox.sendPolicy ?? config.defaults.sendPolicy;
	if (livePolicy === "never") throw new CommsError("POLICY_NEVER", `sending from ${alias} is turned off (policy: never)`, { hint: `The draft is in Gmail; send it from there, or change the policy with ${inlineCommand(shellCommand([
		"agent-gmail",
		"inbox",
		"policy",
		alias,
		"--send",
		"confirm"
	], context.platform))} in a terminal.` });
	const transport = await context.transport(alias);
	const { analysis, draftMessageId, refusals } = await readDraft(context, alias, draftId);
	if (refusals.length > 0) throw unsendable(refusals);
	if (analysis.to.length === 0 && analysis.cc.length === 0 && analysis.bcc.length === 0) throw new CommsError("BAD_DATA", "this draft has no recipients", { hint: "Add them and prepare the send again." });
	const { facts, flags } = config.defaults.riskEscalation ? await studyRecipients(context, transport, resolved, analysis) : {
		facts: [],
		flags: []
	};
	const requiredPolicy = flags.length > 0 ? "confirm" : "chat";
	const effectivePolicy = stricterPolicy(livePolicy, requiredPolicy);
	const record = await context.core.approvals.create({
		inboxId: resolved.inbox.id,
		inboxSub: resolved.inbox.sub,
		draftId,
		draftMessageId,
		digest: analysis.digest,
		policy: livePolicy,
		requiredPolicy,
		riskFlags: flags,
		expect: expectationOf(analysis)
	});
	await context.core.audit.append({
		inboxId: resolved.inbox.id,
		alias,
		operation: "send.prepare",
		outcome: "ok",
		surface: context.surface,
		ids: {
			draftIds: [draftId],
			messageIds: [draftMessageId],
			approvalIds: [record.approvalId]
		},
		reason: flags.length > 0 ? `escalated: ${flags.join(", ")}` : `policy ${effectivePolicy}`
	});
	return {
		approvalId: record.approvalId,
		inbox: alias,
		draftId,
		preview: previewFor({
			analysis,
			facts,
			record,
			alias,
			effectivePolicy
		}),
		policy: livePolicy,
		effectivePolicy,
		riskFlags: flags,
		expect: record.expect,
		digest: analysis.digest,
		expiresAt: record.expiresAt,
		nextStep: effectivePolicy === "confirm" ? `Show the preview to the user, then have them run ${inlineCommand(shellCommand([
			"agent-gmail",
			"approve",
			record.approvalId
		], context.platform))} in a terminal, or send it from Gmail. You cannot approve this yourself.` : "Show the preview to the user verbatim and wait for an explicit yes. Then send it with the same approval id and the recipients and subject shown above."
	};
}
/**
* Re-reads the draft, renders the preview a human is about to approve, and issues the challenge they must type back.
*
* The challenge is never returned to an agent: this is called by the terminal command, which prints it to a person.
* Re-reading is the point — an approval must be for what is in the draft now, not for what was there at prepare.
*/
async function beginApproval(context, approvalId) {
	const record = await context.core.approvals.get(approvalId);
	if (!record) throw new CommsError("NOT_FOUND", `there is no approval ${approvalId}`, { hint: "Approvals last ten minutes. Prepare the send again." });
	const config = await context.config();
	const entry = Object.entries(config.inboxes).find(([, inbox]) => inbox.id === record.inboxId);
	if (!entry) throw new CommsError("NOT_FOUND", "the mailbox this approval belongs to is no longer connected");
	const [alias, inbox] = entry;
	const livePolicy = inbox.sendPolicy ?? config.defaults.sendPolicy;
	const { analysis, draftMessageId } = await readDraft(context, alias, record.draftId);
	if (draftMessageId !== record.draftMessageId || analysis.digest !== record.digest) {
		await context.core.approvals.revoke(approvalId, "the draft changed after the preview was prepared");
		throw new CommsError("APPROVAL_VOID", "nothing was sent: the draft changed after the preview was prepared", { hint: "Prepare the send again to see what it says now." });
	}
	const transport = await context.transport(alias);
	const { facts } = config.defaults.riskEscalation ? await studyRecipients(context, transport, {
		alias,
		inbox
	}, analysis) : { facts: [] };
	const challenge = await context.core.approvals.issueChallenge(approvalId, "send", context.platform);
	return {
		approvalId,
		preview: previewFor({
			analysis,
			facts,
			record,
			alias,
			effectivePolicy: stricterPolicy(livePolicy, record.requiredPolicy)
		}),
		challenge,
		effectivePolicy: stricterPolicy(livePolicy, record.requiredPolicy)
	};
}
/** Accepts the typed challenge. The draft is read once more, so an edit between the preview and the answer voids it. */
async function finishApproval(context, approvalId, answer, via = "terminal") {
	const record = await context.core.approvals.get(approvalId);
	if (!record) throw new CommsError("NOT_FOUND", `there is no approval ${approvalId}`);
	const config = await context.config();
	const entry = Object.entries(config.inboxes).find(([, inbox]) => inbox.id === record.inboxId);
	if (!entry) throw new CommsError("NOT_FOUND", "the mailbox this approval belongs to is no longer connected");
	const [alias] = entry;
	const { analysis, draftMessageId } = await readDraft(context, alias, record.draftId);
	const approved = await context.core.approvals.approve(approvalId, via, {
		draftMessageId,
		digest: analysis.digest
	}, answer, "send", context.platform);
	await context.core.audit.append({
		inboxId: record.inboxId,
		alias,
		operation: "send.approve",
		outcome: "ok",
		surface: context.surface,
		ids: {
			approvalIds: [approvalId],
			draftIds: [record.draftId]
		},
		reason: `approved via ${via}`
	});
	return approved;
}
/**
* Step three, and the only place mail leaves.
*
* The order matters and is the whole guarantee: claim the record (once, across processes, by O_EXCL), reserve a slot
* against the rate caps, re-read the draft and check it against the record one final time, and only then send —
* exactly once, never retried, because a retried send may deliver twice.
*/
async function executeSend(context, alias, options) {
	const resolved = await context.inbox(alias);
	await context.requireCapability(resolved, "draft");
	const config = await context.config();
	const livePolicy = resolved.inbox.sendPolicy ?? config.defaults.sendPolicy;
	const transport = await context.transport(alias);
	const known = await context.core.approvals.get(options.approvalId);
	if (!known) throw new CommsError("NOT_FOUND", `there is no approval ${options.approvalId}`, { hint: "Approvals last ten minutes. Prepare the send again and show the new preview." });
	if (known.state !== "pending" && known.state !== "approved") throw new CommsError("APPROVAL_VOID", `nothing was sent: ${describeState(known.state)}`, {
		hint: "Prepare the send again if it should still go.",
		details: {
			approvalId: options.approvalId,
			state: known.state
		}
	});
	const before = await readDraft(context, alias, options.draftId);
	if (before.refusals.length > 0) throw unsendable(before.refusals);
	const liveSubject = before.analysis.subject;
	const expect = options.expectSubjectNone ? {
		...options.expect,
		subject: ["", "none"].includes(liveSubject.trim()) ? liveSubject : "none"
	} : options.expect;
	const claimed = await context.core.approvals.claimForSend(options.approvalId, {
		draftMessageId: before.draftMessageId,
		digest: before.analysis.digest,
		inboxId: resolved.inbox.id,
		inboxSub: resolved.inbox.sub,
		policy: livePolicy,
		expect
	}, {
		pendingHint: "Ask the user to approve it in the terminal (`agent-gmail approve <id>`) or in a trusted client form, or to send it from Gmail.",
		platform: context.platform
	});
	const bookkeeping = {
		alias,
		inboxId: resolved.inbox.id,
		approvalId: options.approvalId,
		draftId: options.draftId
	};
	if (claimed.draftId !== options.draftId) throw await recordNoSend(context, bookkeeping, new CommsError("APPROVAL_VOID", "nothing was sent: this approval was prepared for a different draft", { hint: "Prepare the send again for the draft you mean." }));
	const caps = capsFor(config.defaults);
	try {
		await context.core.ledger.reserve(resolved.inbox.id, options.approvalId, caps);
	} catch (error) {
		throw await recordNoSend(context, bookkeeping, error);
	}
	let now;
	try {
		now = await readDraft(context, alias, options.draftId);
	} catch (error) {
		throw await recordNoSend(context, bookkeeping, error);
	}
	if (now.draftMessageId !== claimed.draftMessageId || now.analysis.digest !== claimed.digest) throw await recordNoSend(context, bookkeeping, new CommsError("APPROVAL_VOID", "nothing was sent: the draft changed while it was being sent", { hint: "Prepare the send again to see what it says now." }));
	let sent;
	try {
		sent = await transport.sendDraft(options.draftId);
	} catch (error) {
		const said = error instanceof Error ? error.message : String(error);
		const ids = {
			approvalIds: [options.approvalId],
			draftIds: [options.draftId]
		};
		if (sendCertainlyRefused(error)) throw await recordNoSend(context, bookkeeping, error);
		let unaudited = "";
		try {
			await context.core.audit.append({
				inboxId: resolved.inbox.id,
				alias,
				operation: "send.execute",
				outcome: "failed",
				surface: context.surface,
				ids,
				reason: `outcome unknown: ${said}`
			});
		} catch (failure) {
			unaudited = ` The audit log could not record this either (${failure instanceof Error ? failure.message : String(failure)}).`;
		}
		throw new CommsError(error instanceof CommsError ? error.code : "TRANSIENT", `whether the email was sent is not known: ${said}`, {
			hint: `Check the Sent folder before anything else: Gmail may have sent it. Prepare the draft again only if it is not there — this approval is not used again.${unaudited}`,
			details: {
				...error instanceof CommsError ? error.details : {},
				approvalId: options.approvalId,
				outcome: "unknown"
			},
			cause: error
		});
	}
	const sentMessageId = sent.id;
	const unrecorded = [];
	try {
		await context.core.approvals.complete(options.approvalId, { sentMessageId });
	} catch (error) {
		unrecorded.push(`the approval could not be marked used (${error instanceof Error ? error.message : String(error)}), so it will read as unknown`);
	}
	let verified = null;
	try {
		const message = await transport.getMessageMetadata(sentMessageId);
		verified = {
			threadId: message.threadId ?? void 0,
			labelIds: message.labelIds ?? []
		};
	} catch {}
	try {
		await context.core.audit.append({
			inboxId: resolved.inbox.id,
			alias,
			operation: "send.execute",
			outcome: "ok",
			surface: context.surface,
			ids: {
				approvalIds: [options.approvalId],
				draftIds: [options.draftId],
				messageIds: [sentMessageId]
			},
			recipients: [
				...claimed.expect.to,
				...claimed.expect.cc,
				...claimed.expect.bcc
			].map(canonicalAddress),
			reason: [`digest ${claimed.digest.slice(0, 12)} · policy ${livePolicy} · ${claimed.approvedVia ?? "chat"}`, ...unrecorded].join(" · ")
		});
	} catch (error) {
		unrecorded.push(`the audit log could not record it (${error instanceof Error ? error.message : String(error)})`);
	}
	return {
		inbox: alias,
		approvalId: options.approvalId,
		draftId: options.draftId,
		sentMessageId,
		threadId: sent.threadId,
		to: claimed.expect.to,
		cc: claimed.expect.cc,
		bcc: claimed.expect.bcc,
		subject: claimed.expect.subject,
		verified,
		...unrecorded.length > 0 ? { note: unrecorded.join("; ") } : {}
	};
}
/** The approvals this mailbox has open, for `send list` and for the doctor. Never includes a challenge hash. */
async function listApprovals(context, filter = {}) {
	const config = await context.config();
	const byId = new Map(Object.entries(config.inboxes).map(([alias, inbox]) => [inbox.id, alias]));
	const name = filter.inbox;
	const inboxId = name ? resolveName(config, "inbox", name, () => new CommsError("NOT_FOUND", `there is no mailbox called "${name}"`)).inbox.id : void 0;
	return (await context.core.approvals.list(inboxId ? { inboxId } : {})).map((record) => ({
		...publicView(record),
		inbox: byId.get(record.inboxId) ?? "(removed)"
	}));
}
/** Cancels an approval. Anyone may cancel: refusing to send is never the dangerous direction. */
async function revokeApproval(context, approvalId) {
	const record = await context.core.approvals.revoke(approvalId, "cancelled");
	await context.core.audit.append({
		inboxId: record.inboxId,
		alias: "",
		operation: "send.revoke",
		outcome: "ok",
		surface: context.surface,
		ids: { approvalIds: [approvalId] }
	});
	return record;
}
//#endregion
export { followUps as A, clientRemoveChange as B, inboxPolicyChange as C, whoami as D, inboxShow as E, removeConfirmClient as F, listSendAs as G, findAttachments as H, startProbe as I, readThread as J, threadTimeline as K, STORE_KINDS as L, completeProbe as M, confirmClientAddChange as N, CONTACT_SOURCES as O, listConfirmClients as P, clientAddChange as R, inboxList as S, inboxRename as T, search as U, downloadAttachments as V, listLabels as W, GmailContext as Y, getDraft as _, prepareSend as a, updateDraft as b, createLabel as c, inboxImportChange as d, EXPORT_FORMATS as f, deleteDraft as g, createDraft as h, listApprovals as i, searchContacts as j, FOLLOW_UP_DIRECTIONS as k, modify as l, REPLY_MODES as m, executeSend as n, revokeApproval as o, exportMail as p, readMessage as q, finishApproval as r, applyUndo as s, beginApproval as t, trash as u, listDrafts as v, inboxRemoveChange as w, doctor as x, replyDraft as y, clientList as z };
