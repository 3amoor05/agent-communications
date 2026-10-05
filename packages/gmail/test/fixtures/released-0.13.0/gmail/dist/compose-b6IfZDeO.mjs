import { r as __exportAll } from "./rolldown-runtime-CbG-q-O0.mjs";
import { D as CommsError, t as analyseOutboundHtml } from "./dist-CBfqDru2.mjs";
import path from "node:path";
import urllib from "node:url";
import crypto from "node:crypto";
import os from "node:os";
import fs from "node:fs";
import { PassThrough, Transform } from "node:stream";
import net from "node:net";
import http from "node:http";
import https from "node:https";
import zlib from "node:zlib";
//#region ../../node_modules/.pnpm/nodemailer@10.0.10/node_modules/nodemailer/dist/esm/punycode/index.js
/** Highest positive signed 32-bit float value */
const maxInt = 2147483647;
/** Bootstring parameters */
const base = 36;
const tMin = 1;
const tMax = 26;
const skew = 38;
const damp = 700;
const initialBias = 72;
const initialN = 128;
const delimiter$1 = "-";
/** Regular expressions */
const regexPunycode = /^xn--/;
const regexNonASCII = /[^\0-\x7F]/;
const regexSeparators = /[\x2E\u3002\uFF0E\uFF61]/g;
/** Error messages */
const errors = {
	overflow: "Overflow: input needs wider integers to process",
	"not-basic": "Illegal input >= 0x80 (not a basic code point)",
	"invalid-input": "Invalid input"
};
/** Convenience shortcuts */
const baseMinusTMin = 35;
const floor = Math.floor;
const stringFromCharCode = String.fromCharCode;
/**
* A generic error utility function.
* @private
* @param type The error type.
* @returns Throws a `RangeError` with the applicable error message.
*/
function error(type) {
	throw new RangeError(errors[type]);
}
/**
* A generic `Array#map` utility function.
* @private
* @param array The array to iterate over.
* @param callback The function that gets called for every array
* item.
* @returns A new array of values returned by the callback function.
*/
function map(array, callback) {
	const result = [];
	let length = array.length;
	while (length--) result[length] = callback(array[length]);
	return result;
}
/**
* A simple `Array#map`-like wrapper to work with domain name strings or email
* addresses.
* @private
* @param domain The domain name or email address.
* @param callback The function that gets called for every
* character.
* @returns A new string of characters returned by the callback
* function.
*/
function mapDomain(domain, callback) {
	const parts = domain.split("@");
	let result = "";
	if (parts.length > 1) {
		result = parts[0] + "@";
		domain = parts[1];
	}
	domain = domain.replace(regexSeparators, ".");
	const encoded = map(domain.split("."), callback).join(".");
	return result + encoded;
}
/**
* Creates an array containing the numeric code points of each Unicode
* character in the string. While JavaScript uses UCS-2 internally,
* this function will convert a pair of surrogate halves (each of which
* UCS-2 exposes as separate characters) into a single code point,
* matching UTF-16.
* @see `punycode.ucs2.encode`
* @see <https://mathiasbynens.be/notes/javascript-encoding>
* @memberOf punycode.ucs2
* @name decode
* @param string The Unicode input string (UCS-2).
* @returns The new array of code points.
*/
function ucs2decode(string) {
	const output = [];
	let counter = 0;
	const length = string.length;
	while (counter < length) {
		const value = string.charCodeAt(counter++);
		if (value >= 55296 && value <= 56319 && counter < length) {
			const extra = string.charCodeAt(counter++);
			if ((extra & 64512) == 56320) output.push(((value & 1023) << 10) + (extra & 1023) + 65536);
			else {
				output.push(value);
				counter--;
			}
		} else output.push(value);
	}
	return output;
}
/**
* Converts a basic code point into a digit/integer.
* @see `digitToBasic()`
* @private
* @param codePoint The basic numeric code point value.
* @returns The numeric value of a basic code point (for use in
* representing integers) in the range `0` to `base - 1`, or `base` if
* the code point does not represent a value.
*/
const basicToDigit = function(codePoint) {
	if (codePoint >= 48 && codePoint < 58) return 26 + (codePoint - 48);
	if (codePoint >= 65 && codePoint < 91) return codePoint - 65;
	if (codePoint >= 97 && codePoint < 123) return codePoint - 97;
	return base;
};
/**
* Converts a digit/integer into a basic code point.
* @see `basicToDigit()`
* @private
* @param digit The numeric value of a basic code point.
* @returns The basic code point whose value (when used for
* representing integers) is `digit`, which needs to be in the range
* `0` to `base - 1`. If `flag` is non-zero, the uppercase form is
* used; else, the lowercase form is used. The behavior is undefined
* if `flag` is non-zero and `digit` has no uppercase form.
*/
const digitToBasic = function(digit, flag) {
	return digit + 22 + 75 * Number(digit < 26) - (Number(flag != 0) << 5);
};
/**
* Bias adaptation function as per section 3.4 of RFC 3492.
* https://tools.ietf.org/html/rfc3492#section-3.4
* @private
*/
const adapt = function(delta, numPoints, firstTime) {
	let k = 0;
	delta = firstTime ? floor(delta / damp) : delta >> 1;
	delta += floor(delta / numPoints);
	for (; delta > 455; k += base) delta = floor(delta / baseMinusTMin);
	return floor(k + 36 * delta / (delta + skew));
};
/**
* Converts a Punycode string of ASCII-only symbols to a string of Unicode
* symbols.
* @memberOf punycode
* @param input The Punycode string of ASCII-only symbols.
* @returns The resulting string of Unicode symbols.
*/
const decode = function(input) {
	const output = [];
	const inputLength = input.length;
	let i = 0;
	let n = initialN;
	let bias = initialBias;
	let basic = input.lastIndexOf(delimiter$1);
	if (basic < 0) basic = 0;
	for (let j = 0; j < basic; ++j) {
		if (input.charCodeAt(j) >= 128) error("not-basic");
		output.push(input.charCodeAt(j));
	}
	for (let index = basic > 0 ? basic + 1 : 0; index < inputLength;) {
		const oldi = i;
		for (let w = 1, k = base;; k += base) {
			if (index >= inputLength) error("invalid-input");
			const digit = basicToDigit(input.charCodeAt(index++));
			if (digit >= base) error("invalid-input");
			if (digit > floor((maxInt - i) / w)) error("overflow");
			i += digit * w;
			const t = k <= bias ? tMin : k >= bias + tMax ? tMax : k - bias;
			if (digit < t) break;
			const baseMinusT = base - t;
			if (w > floor(maxInt / baseMinusT)) error("overflow");
			w *= baseMinusT;
		}
		const out = output.length + 1;
		bias = adapt(i - oldi, out, oldi == 0);
		if (floor(i / out) > maxInt - n) error("overflow");
		n += floor(i / out);
		i %= out;
		output.splice(i++, 0, n);
	}
	return String.fromCodePoint(...output);
};
/**
* Converts a string of Unicode symbols (e.g. a domain name label) to a
* Punycode string of ASCII-only symbols.
* @memberOf punycode
* @param input The string of Unicode symbols.
* @returns The resulting Punycode string of ASCII-only symbols.
*/
const encode$2 = function(input) {
	const output = [];
	const codePoints = ucs2decode(input);
	const inputLength = codePoints.length;
	let n = initialN;
	let delta = 0;
	let bias = initialBias;
	for (const currentValue of codePoints) if (currentValue < 128) output.push(stringFromCharCode(currentValue));
	const basicLength = output.length;
	let handledCPCount = basicLength;
	if (basicLength) output.push(delimiter$1);
	while (handledCPCount < inputLength) {
		let m = maxInt;
		for (const currentValue of codePoints) if (currentValue >= n && currentValue < m) m = currentValue;
		const handledCPCountPlusOne = handledCPCount + 1;
		if (m - n > floor((maxInt - delta) / handledCPCountPlusOne)) error("overflow");
		delta += (m - n) * handledCPCountPlusOne;
		n = m;
		for (const currentValue of codePoints) {
			if (currentValue < n && ++delta > maxInt) error("overflow");
			if (currentValue === n) {
				let q = delta;
				for (let k = base;; k += base) {
					const t = k <= bias ? tMin : k >= bias + tMax ? tMax : k - bias;
					if (q < t) break;
					const qMinusT = q - t;
					const baseMinusT = base - t;
					output.push(stringFromCharCode(digitToBasic(t + qMinusT % baseMinusT, 0)));
					q = floor(qMinusT / baseMinusT);
				}
				output.push(stringFromCharCode(digitToBasic(q, 0)));
				bias = adapt(delta, handledCPCountPlusOne, handledCPCount === basicLength);
				delta = 0;
				++handledCPCount;
			}
		}
		++delta;
		++n;
	}
	return output.join("");
};
/**
* Converts a Punycode string representing a domain name or an email address
* to Unicode. Only the Punycoded parts of the input will be converted, i.e.
* it doesn't matter if you call it on a string that has already been
* converted to Unicode.
* @memberOf punycode
* @param input The Punycoded domain name or email address to
* convert to Unicode.
* @returns The Unicode representation of the given Punycode
* string.
*/
const toUnicode = function(input) {
	return mapDomain(input, function(string) {
		return regexPunycode.test(string) ? decode(string.slice(4).toLowerCase()) : string;
	});
};
/**
* Converts a Unicode string representing a domain name or an email address to
* Punycode. Only the non-ASCII parts of the domain name will be converted,
* i.e. it doesn't matter if you call it with a domain that's already in
* ASCII.
* @memberOf punycode
* @param input The domain name or email address to convert, as a
* Unicode string.
* @returns The Punycode representation of the given domain name or
* email address.
*/
const toASCII = function(input) {
	return mapDomain(input, function(string) {
		return regexNonASCII.test(string) ? "xn--" + encode$2(string) : string;
	});
};
//#endregion
//#region ../../node_modules/.pnpm/nodemailer@10.0.10/node_modules/nodemailer/dist/esm/shared/url.js
const SLASHLESS_AUTHORITY = /^([a-zA-Z][a-zA-Z0-9+.-]*:)(?!\/\/)([\s\S]+)$/;
const SURROUNDING_WHITESPACE = /^[\x00-\x20]+|[\x00-\x20]+$/g;
const LEGACY_TRIM = /^[\x00-\x20\u00a0\ufeff]+/;
const AUTHORITY = /^([a-zA-Z0-9+.-]+:)?[\\/]{2}([^\\/?#]*)/;
const FORBIDDEN_HOST_CHARS = /[\x00-\x20#/:<>?@[\\\]^|\x7f]/;
const CONTROL_CHARS = /[\x00-\x1f\x7f]/;
function invalidUrl(input) {
	const err = /* @__PURE__ */ new TypeError("Invalid URL");
	err.code = "ERR_INVALID_URL";
	err.input = input;
	return err;
}
function legacyParse(input, parseQueryString, whatwgError, slashesDenoteHost) {
	const parsed = urllib.parse(input, parseQueryString, slashesDenoteHost);
	const authority = AUTHORITY.exec(input.replace(LEGACY_TRIM, ""));
	if (authority && (authority[1] || parsed.hostname !== null)) {
		const written = authority[2].slice(authority[2].lastIndexOf("@") + 1);
		if (!written || CONTROL_CHARS.test(written) || (parsed.host || "").toLowerCase() !== toASCII(written.toLowerCase())) throw whatwgError;
		if (written.charAt(0) === "[" && !net.isIPv6(written.slice(1, written.indexOf("]")))) throw whatwgError;
	} else if (parsed.hostname !== null) throw whatwgError;
	const legacyAuth = parsed.auth === null || parsed.auth === void 0 ? null : parsed.auth.split(":");
	const result = parsed;
	result.username = legacyAuth ? legacyAuth.shift() : null;
	result.password = legacyAuth && legacyAuth.length ? legacyAuth.join(":") : null;
	return result;
}
function safeDecode(str) {
	try {
		return decodeURIComponent(str);
	} catch (_err) {
		return str;
	}
}
function normalizeHostname(raw, href) {
	const hostname = raw || "";
	if (!hostname) return "";
	if (hostname.charAt(0) === "[" && hostname.charAt(hostname.length - 1) === "]") return hostname.slice(1, -1);
	const decoded = safeDecode(hostname);
	const mapped = FORBIDDEN_HOST_CHARS.test(decoded) ? "" : urllib.domainToASCII(decoded);
	if (!mapped) throw invalidUrl(href);
	return mapped;
}
const parse = (input, parseQueryString) => {
	input = (input || "").replace(SURROUNDING_WHITESPACE, "");
	const slashless = SLASHLESS_AUTHORITY.exec(input);
	const normalized = slashless ? slashless[1] + "//" + slashless[2] : input;
	let u;
	try {
		u = new URL(normalized);
	} catch (err) {
		return legacyParse(normalized, parseQueryString, err);
	}
	const hostname = normalizeHostname(u.hostname, u.href);
	const port = u.port || null;
	const pathname = u.pathname || null;
	const search = u.search || null;
	let auth = null;
	let username = null;
	let password = null;
	if (u.username || u.password) {
		username = safeDecode(u.username);
		password = u.password ? safeDecode(u.password) : null;
		auth = username + (password !== null ? ":" + password : "");
	}
	let query;
	if (parseQueryString) {
		const parsed = Object.create(null);
		u.searchParams.forEach((value, key) => {
			if (Object.prototype.hasOwnProperty.call(parsed, key)) {
				const existing = parsed[key];
				if (Array.isArray(existing)) existing.push(value);
				else parsed[key] = [existing, value];
			} else parsed[key] = value;
		});
		query = parsed;
	} else query = search ? search.slice(1) : null;
	return {
		protocol: u.protocol || null,
		host: u.host || null,
		hostname,
		port,
		pathname,
		search,
		path: (pathname || "") + (search || "") || null,
		href: u.href,
		auth,
		username,
		password,
		query
	};
};
const resolve$1 = (from, to) => {
	try {
		return new URL(to, from).href;
	} catch (err) {
		legacyParse(from, false, err, true);
		legacyParse(to, false, err, true);
		return urllib.resolve(from, to);
	}
};
//#endregion
//#region ../../node_modules/.pnpm/nodemailer@10.0.10/node_modules/nodemailer/dist/esm/fetch/cookies.js
const SESSION_TIMEOUT = 1800;
/**
* Creates a biskviit cookie jar for managing cookie values in memory
*
* @constructor
* @param [options] Optional options object
*/
var Cookies = class {
	constructor(options) {
		this.options = options || {};
		this.cookies = [];
	}
	/**
	* Stores a cookie string to the cookie storage
	*
	* @param cookieStr Value from the 'Set-Cookie:' header
	* @param url Current URL
	*/
	set(cookieStr, url) {
		const urlparts = parse(url || "");
		const cookie = this.parse(cookieStr);
		let domain;
		if (cookie.domain) {
			domain = cookie.domain.replace(/^\./, "");
			if (urlparts.hostname.length < domain.length || domain.indexOf(".") < 0 || domain.endsWith(".") || net.isIP(urlparts.hostname) || !("." + urlparts.hostname).endsWith("." + domain)) cookie.domain = urlparts.hostname;
		} else cookie.domain = urlparts.hostname;
		if (!cookie.path) cookie.path = this.getPath(urlparts.pathname);
		if (!cookie.expires) cookie.expires = new Date(Date.now() + (Number(this.options.sessionTimeout || SESSION_TIMEOUT) || SESSION_TIMEOUT) * 1e3);
		return this.add(cookie);
	}
	/**
	* Returns cookie string for the 'Cookie:' header.
	*
	* @param url URL to check for
	* @returns Cookie header or empty string if no matches were found
	*/
	get(url) {
		return this.list(url).map((cookie) => cookie.name + "=" + cookie.value).join("; ");
	}
	/**
	* Lists all valied cookie objects for the specified URL
	*
	* @param url URL to check for
	* @returns An array of cookie objects
	*/
	list(url) {
		const result = [];
		for (let i = this.cookies.length - 1; i >= 0; i--) {
			const cookie = this.cookies[i];
			if (this.isExpired(cookie)) {
				this.cookies.splice(i, 1);
				continue;
			}
			if (this.match(cookie, url)) result.unshift(cookie);
		}
		return result;
	}
	/**
	* Parses cookie string from the 'Set-Cookie:' header
	*
	* @param cookieStr String from the 'Set-Cookie:' header
	* @returns Cookie object
	*/
	parse(cookieStr) {
		const cookie = {};
		(cookieStr || "").toString().split(";").forEach((cookiePart) => {
			const valueParts = cookiePart.split("=");
			const key = valueParts.shift().trim().toLowerCase();
			let value = valueParts.join("=").trim();
			let domain;
			if (!key) return;
			switch (key) {
				case "expires": {
					const expires = new Date(value);
					if (expires.toString() !== "Invalid Date") cookie.expires = expires;
					break;
				}
				case "path":
					cookie.path = value;
					break;
				case "domain":
					domain = value.toLowerCase();
					if (domain.length && domain.charAt(0) !== ".") domain = "." + domain;
					cookie.domain = domain;
					break;
				case "max-age":
					cookie.expires = new Date(Date.now() + (Number(value) || 0) * 1e3);
					break;
				case "secure":
					cookie.secure = true;
					break;
				case "httponly":
					cookie.httponly = true;
					break;
				default: if (!cookie.name) {
					cookie.name = key;
					cookie.value = value;
				}
			}
		});
		return cookie;
	}
	/**
	* Checks if a cookie object is valid for a specified URL
	*
	* @param cookie Cookie object
	* @param url URL to check for
	* @returns true if cookie is valid for specifiec URL
	*/
	match(cookie, url) {
		const urlparts = parse(url || "");
		if (urlparts.hostname !== cookie.domain && (cookie.domain.charAt(0) !== "." || ("." + urlparts.hostname).substr(-cookie.domain.length) !== cookie.domain)) return false;
		const pathname = urlparts.pathname || "/";
		const cookiePath = cookie.path;
		if (!(pathname === cookiePath || pathname.startsWith(cookiePath) && (cookiePath.endsWith("/") || pathname.charAt(cookiePath.length) === "/"))) return false;
		if (cookie.secure && urlparts.protocol !== "https:") return false;
		return true;
	}
	/**
	* Adds (or updates/removes if needed) a cookie object to the cookie storage
	*
	* @param cookie Cookie value to be stored
	*/
	add(cookie) {
		if (!cookie || !cookie.name) return false;
		for (let i = 0, len = this.cookies.length; i < len; i++) if (this.compare(this.cookies[i], cookie)) {
			if (this.isExpired(cookie)) {
				this.cookies.splice(i, 1);
				return false;
			}
			this.cookies[i] = cookie;
			return true;
		}
		if (!this.isExpired(cookie)) this.cookies.push(cookie);
		return true;
	}
	/**
	* Checks if two cookie objects are the same
	*
	* @param a Cookie to check against
	* @param b Cookie to check against
	* @returns True, if the cookies are the same
	*/
	compare(a, b) {
		return a.name === b.name && a.path === b.path && a.domain === b.domain && a.secure === b.secure && a.httponly === b.httponly;
	}
	/**
	* Checks if a cookie is expired
	*
	* @param cookie Cookie object to check against
	* @returns True, if the cookie is expired
	*/
	isExpired(cookie) {
		return cookie.expires && cookie.expires < /* @__PURE__ */ new Date() || !cookie.value;
	}
	/**
	* Returns the default path for an URL path argument, the default-path of
	* RFC 6265 section 5.1.4. A cookie that carries no Path attribute is scoped
	* to the directory of the URL it was set from
	*
	* @param pathname
	* @returns Default path
	*/
	getPath(pathname) {
		const pathParts = (pathname || "/").split("/");
		pathParts.pop();
		const path = pathParts.join("/").trim();
		if (path.charAt(0) !== "/") return "/";
		return path;
	}
};
//#endregion
//#region ../../node_modules/.pnpm/nodemailer@10.0.10/node_modules/nodemailer/dist/esm/errors.js
const EFILEACCESS = "EFILEACCESS";
const EURLACCESS = "EURLACCESS";
const EFETCH = "EFETCH";
//#endregion
//#region ../../node_modules/.pnpm/nodemailer@10.0.10/node_modules/nodemailer/dist/esm/shared/objects.js
/**
* Detects a key that can not be copied onto a plain object with `target[key] = value`.
*
* "__proto__" is the only one: assigning it runs the inherited setter and replaces the
* prototype of the target instead of adding a property to it, so a caller can smuggle
* values past validation that only inspects own keys. JSON.parse produces such a key
* where an object literal can not. "constructor" and "prototype" have no such setter and
* become ordinary own properties, so dropping them would only discard legitimate values.
*
* @param key Key to check
* @returns true if the key must not be copied
*/
const isProtoKey = (key) => key === "__proto__";
/**
* Copies own enumerable keys from a source object to a target object. Every copy that
* walks the keys of user supplied data goes through here, see isProtoKey.
*
* @param target Object to copy the keys to
* @param source Object to copy the keys from
* @param [skip] Optional predicate, return true to leave a key out
* @returns The target object
*/
const copyOwnKeys = (target, source, skip) => {
	Object.keys(source || {}).forEach((key) => {
		if (isProtoKey(key) || skip && skip(key)) return;
		target[key] = source[key];
	});
	return target;
};
//#endregion
//#region ../../node_modules/.pnpm/nodemailer@10.0.10/node_modules/nodemailer/dist/esm/fetch/index.js
const MAX_REDIRECTS = 5;
const TLS_OPTION_KEYS = [
	"ALPNProtocols",
	"ca",
	"cert",
	"checkServerIdentity",
	"ciphers",
	"crl",
	"dhparam",
	"ecdhCurve",
	"honorCipherOrder",
	"key",
	"maxVersion",
	"minVersion",
	"passphrase",
	"pfx",
	"rejectUnauthorized",
	"secureContext",
	"secureOptions",
	"secureProtocol",
	"servername",
	"sessionIdContext",
	"sigalgs"
];
/**
* Resolves a URL only if it is one this module is willing to request.
*
* urllib.parse throws for a host that contains forbidden bytes, and it is called for
* every URL that reaches nmfetch, including ones that arrive from a message attachment
* or from a redirect Location header. An uncaught throw here takes the process down,
* so a URL that does not parse is reported the same way as one with a scheme we refuse.
*
* @param url URL to parse
* @returns Parsed URL, or false if it is not a usable http(s) URL
*/
function parseFetchUrl(url) {
	let parsed;
	try {
		parsed = parse(url);
	} catch (_err) {
		return false;
	}
	if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return false;
	return parsed;
}
function nmfetch(url, options) {
	options = options || {};
	options.fetchRes = options.fetchRes || new PassThrough();
	options.cookies = options.cookies || new Cookies();
	options.redirects = options.redirects || 0;
	options.maxRedirects = isNaN(options.maxRedirects) ? MAX_REDIRECTS : options.maxRedirects;
	const fetchRes = options.fetchRes;
	const parsed = parseFetchUrl(url);
	if (!parsed) {
		if (options.body && typeof options.body.destroy === "function") {
			options.body.on("error", () => false);
			options.body.destroy();
		}
		setImmediate(() => {
			const err = /* @__PURE__ */ new Error("Unsupported protocol for URL " + url);
			err.code = EFETCH;
			err.sourceUrl = url;
			fetchRes.emit("error", err);
		});
		return fetchRes;
	}
	if (options.cookie) {
		[].concat(options.cookie || []).forEach((cookie) => {
			options.cookies.set(cookie, url);
		});
		options.cookie = false;
	}
	let method = (options.method || "").toString().trim().toUpperCase() || "GET";
	let finished = false;
	let cookies;
	let body;
	const handler = parsed.protocol === "https:" ? https : http;
	const headers = {
		"accept-encoding": "gzip,deflate",
		"user-agent": "nodemailer/10.0.10"
	};
	Object.keys(options.headers || {}).forEach((key) => {
		if (isProtoKey(key.toLowerCase().trim())) return;
		headers[key.toLowerCase().trim()] = options.headers[key];
	});
	if (options.userAgent) headers["user-agent"] = options.userAgent;
	if (parsed.auth) headers.Authorization = "Basic " + Buffer.from(parsed.auth).toString("base64");
	if (cookies = options.cookies.get(url)) headers.cookie = cookies;
	if (options.body) {
		if (options.contentType !== false) headers["Content-Type"] = options.contentType || "application/x-www-form-urlencoded";
		if (typeof options.body.pipe === "function") {
			headers["Transfer-Encoding"] = "chunked";
			body = options.body;
			body.on("error", (err) => {
				if (finished) return;
				finished = true;
				err.code = EFETCH;
				err.sourceUrl = url;
				fetchRes.emit("error", err);
			});
		} else {
			if (options.body instanceof Buffer) body = options.body;
			else if (typeof options.body === "object") try {
				body = Buffer.from(Object.keys(options.body).map((key) => {
					const value = options.body[key].toString().trim();
					return encodeURIComponent(key) + "=" + encodeURIComponent(value);
				}).join("&"));
			} catch (E) {
				if (finished) return;
				finished = true;
				E.code = EFETCH;
				E.sourceUrl = url;
				fetchRes.emit("error", E);
				return;
			}
			else body = Buffer.from(options.body.toString().trim());
			headers["Content-Type"] = options.contentType || "application/x-www-form-urlencoded";
			headers["Content-Length"] = body.length;
		}
		method = (options.method || "").toString().trim().toUpperCase() || "POST";
	}
	let req;
	const reqOptions = {
		method,
		host: parsed.hostname,
		path: parsed.path,
		port: parsed.port ? parsed.port : parsed.protocol === "https:" ? 443 : 80,
		headers,
		rejectUnauthorized: true,
		agent: false
	};
	if (options.tls) Object.keys(options.tls).forEach((key) => {
		if (TLS_OPTION_KEYS.includes(key)) reqOptions[key] = options.tls[key];
	});
	if (parsed.protocol === "https:" && parsed.hostname && parsed.hostname !== reqOptions.host && !net.isIP(parsed.hostname) && !reqOptions.servername) reqOptions.servername = parsed.hostname;
	try {
		req = handler.request(reqOptions);
	} catch (E) {
		finished = true;
		setImmediate(() => {
			E.code = EFETCH;
			E.sourceUrl = url;
			fetchRes.emit("error", E);
		});
		return fetchRes;
	}
	if (options.timeout) req.setTimeout(options.timeout, () => {
		if (finished) return;
		finished = true;
		req.abort();
		const err = /* @__PURE__ */ new Error("Request Timeout");
		err.code = EFETCH;
		err.sourceUrl = url;
		fetchRes.emit("error", err);
	});
	req.on("error", (err) => {
		if (finished) return;
		finished = true;
		err.code = EFETCH;
		err.sourceUrl = url;
		fetchRes.emit("error", err);
	});
	req.on("response", (res) => {
		let inflate;
		if (finished) return;
		switch (res.headers["content-encoding"]) {
			case "gzip":
			case "deflate": inflate = zlib.createUnzip();
		}
		if (res.headers["set-cookie"]) [].concat(res.headers["set-cookie"] || []).forEach((cookie) => {
			options.cookies.set(cookie, url);
		});
		if ([
			301,
			302,
			303,
			307,
			308
		].includes(res.statusCode) && res.headers.location) {
			options.redirects++;
			if (options.redirects > options.maxRedirects) {
				finished = true;
				const err = /* @__PURE__ */ new Error("Maximum redirect count exceeded");
				err.code = EFETCH;
				err.sourceUrl = url;
				fetchRes.emit("error", err);
				req.abort();
				return;
			}
			options.method = "GET";
			options.body = false;
			let redirectUrl;
			try {
				redirectUrl = resolve$1(url, res.headers.location);
			} catch (_err) {
				redirectUrl = res.headers.location;
			}
			const redirectParsed = parseFetchUrl(redirectUrl);
			if (!redirectParsed) {
				finished = true;
				const err = /* @__PURE__ */ new Error("Unsupported protocol for URL " + redirectUrl);
				err.code = EFETCH;
				err.sourceUrl = redirectUrl;
				fetchRes.emit("error", err);
				req.abort();
				return;
			}
			const crossHost = redirectParsed.hostname !== parsed.hostname;
			const downgrade = parsed.protocol === "https:" && redirectParsed.protocol === "http:";
			if (options.headers && (crossHost || downgrade)) {
				const sensitive = [
					"authorization",
					"cookie",
					"proxy-authorization"
				];
				Object.keys(options.headers).forEach((key) => {
					if (sensitive.includes(key.toLowerCase())) delete options.headers[key];
				});
			}
			return nmfetch(redirectUrl, options);
		}
		fetchRes.statusCode = res.statusCode;
		fetchRes.headers = res.headers;
		if (res.statusCode >= 300 && !options.allowErrorResponse) {
			finished = true;
			const err = /* @__PURE__ */ new Error("Invalid status code " + res.statusCode);
			err.code = EFETCH;
			err.sourceUrl = url;
			fetchRes.emit("error", err);
			req.abort();
			return;
		}
		res.on("error", (err) => {
			if (finished) return;
			finished = true;
			err.code = EFETCH;
			err.sourceUrl = url;
			fetchRes.emit("error", err);
			req.abort();
		});
		if (inflate) {
			res.pipe(inflate).pipe(fetchRes);
			inflate.on("error", (err) => {
				if (finished) return;
				finished = true;
				err.code = EFETCH;
				err.sourceUrl = url;
				fetchRes.emit("error", err);
				req.abort();
			});
		} else res.pipe(fetchRes);
	});
	setImmediate(() => {
		if (body) try {
			if (typeof body.pipe === "function") return body.pipe(req);
			req.write(body);
		} catch (err) {
			finished = true;
			err.code = EFETCH;
			err.sourceUrl = url;
			fetchRes.emit("error", err);
			return;
		}
		req.end();
	});
	return fetchRes;
}
nmfetch.Cookies = Cookies;
try {
	os.networkInterfaces();
} catch (_err) {}
/**
* Wrapper for creating a callback that either resolves or rejects a promise
* based on input
*
* @param resolve Function to run if callback is called
* @param reject Function to run if callback ends with an error
*/
const callbackPromise = (resolve, reject) => function(...args) {
	const err = args.shift();
	if (err) reject(err);
	else resolve(...args);
};
const parseDataURI = (uri) => {
	if (typeof uri !== "string") return null;
	if (!uri.startsWith("data:")) return null;
	const commaPos = uri.indexOf(",");
	if (commaPos === -1) return null;
	const data = uri.substring(commaPos + 1);
	const metaStr = uri.substring(5, commaPos);
	let encoding;
	const metaEntries = metaStr.split(";");
	if (metaEntries.length > 0) {
		const lastEntry = metaEntries[metaEntries.length - 1].toLowerCase().trim();
		if ([
			"base64",
			"utf8",
			"utf-8"
		].includes(lastEntry) && lastEntry.indexOf("=") === -1) {
			encoding = lastEntry;
			metaEntries.pop();
		}
	}
	const contentType = metaEntries.length > 0 ? metaEntries.shift() : "application/octet-stream";
	const params = {};
	for (let i = 0; i < metaEntries.length; i++) {
		const entry = metaEntries[i];
		const sepPos = entry.indexOf("=");
		if (sepPos > 0) {
			const key = entry.substring(0, sepPos).trim();
			const value = entry.substring(sepPos + 1).trim();
			if (key && !isProtoKey(key)) params[key] = value;
		}
	}
	let bufferData;
	try {
		if (encoding === "base64") bufferData = Buffer.from(data, "base64");
		else try {
			bufferData = Buffer.from(decodeURIComponent(data));
		} catch (_decodeError) {
			bufferData = Buffer.from(data);
		}
	} catch (_bufferError) {
		bufferData = Buffer.alloc(0);
	}
	return {
		data: bufferData,
		encoding: encoding || null,
		contentType: contentType || "application/octet-stream",
		params
	};
};
//#endregion
//#region ../../node_modules/.pnpm/nodemailer@10.0.10/node_modules/nodemailer/dist/esm/base64/index.js
var base64_exports = /* @__PURE__ */ __exportAll({
	Encoder: () => Encoder$1,
	encode: () => encode$1,
	wrap: () => wrap$1
});
/**
* Encodes a Buffer into a base64 encoded string
*
* @param buffer Buffer to convert
* @returns base64 encoded string
*/
function encode$1(buffer) {
	if (typeof buffer === "string") buffer = Buffer.from(buffer, "utf-8");
	return buffer.toString("base64");
}
/**
* Adds soft line breaks to a base64 string
*
* @param str base64 encoded string that might need line wrapping
* @param [lineLength=76] Maximum allowed length for a line
* @returns Soft-wrapped base64 encoded string
*/
function wrap$1(str, lineLength) {
	str = (str || "").toString();
	lineLength = lineLength || 76;
	if (str.length <= lineLength) return str;
	const result = [];
	let pos = 0;
	const chunkLength = lineLength * 1024;
	const wrapRegex = new RegExp(".{" + lineLength + "}", "g");
	while (pos < str.length) {
		const wrappedLines = str.substr(pos, chunkLength).replace(wrapRegex, "$&\r\n").trim();
		result.push(wrappedLines);
		pos += chunkLength;
	}
	return result.join("\r\n").trim();
}
/**
* Creates a transform stream for encoding data to base64 encoding
*
* @constructor
* @param options Stream options
* @param [options.lineLength=76] Maximum length for lines, set to false to disable wrapping
*/
var Encoder$1 = class extends Transform {
	constructor(options) {
		super();
		this.options = options || {};
		if (this.options.lineLength !== false) this.options.lineLength = this.options.lineLength || 76;
		this._curLine = "";
		this._remainingBytes = false;
		this.inputBytes = 0;
		this.outputBytes = 0;
	}
	/** @internal */
	_transform(chunk, encoding, done) {
		let buf = encoding !== "buffer" ? Buffer.from(chunk, encoding) : chunk;
		if (!buf || !buf.length) {
			setImmediate(done);
			return;
		}
		this.inputBytes += buf.length;
		if (this._remainingBytes && this._remainingBytes.length) {
			buf = Buffer.concat([this._remainingBytes, buf], this._remainingBytes.length + buf.length);
			this._remainingBytes = false;
		}
		if (buf.length % 3) {
			this._remainingBytes = buf.slice(buf.length - buf.length % 3);
			buf = buf.slice(0, buf.length - buf.length % 3);
		} else this._remainingBytes = false;
		let b64 = this._curLine + encode$1(buf);
		if (this.options.lineLength) {
			b64 = wrap$1(b64, this.options.lineLength);
			const lastLF = b64.lastIndexOf("\n");
			if (lastLF < 0) {
				this._curLine = b64;
				b64 = "";
			} else if (lastLF === b64.length - 1) this._curLine = "";
			else {
				this._curLine = b64.substring(lastLF + 1);
				b64 = b64.substring(0, lastLF + 1);
			}
		}
		if (b64) {
			this.outputBytes += b64.length;
			this.push(Buffer.from(b64, "ascii"));
		}
		setImmediate(done);
	}
	/** @internal */
	_flush(done) {
		if (this._remainingBytes && this._remainingBytes.length) this._curLine += encode$1(this._remainingBytes);
		if (this._curLine) {
			this._curLine = wrap$1(this._curLine, this.options.lineLength);
			this.outputBytes += this._curLine.length;
			this.push(Buffer.from(this._curLine, "ascii"));
			this._curLine = "";
		}
		done();
	}
};
//#endregion
//#region ../../node_modules/.pnpm/nodemailer@10.0.10/node_modules/nodemailer/dist/esm/qp/index.js
var qp_exports = /* @__PURE__ */ __exportAll({
	Encoder: () => Encoder,
	encode: () => encode,
	wrap: () => wrap
});
/**
* Encodes a Buffer into a Quoted-Printable encoded string
*
* @param buffer Buffer to convert
* @returns Quoted-Printable encoded string
*/
const QP_RANGES = [
	[9],
	[10],
	[13],
	[32, 60],
	[62, 126]
];
function encode(buffer) {
	if (typeof buffer === "string") buffer = Buffer.from(buffer, "utf-8");
	let result = "";
	let ord;
	for (let i = 0, len = buffer.length; i < len; i++) {
		ord = buffer[i];
		if (checkRanges(ord, QP_RANGES) && !((ord === 32 || ord === 9) && (i === len - 1 || buffer[i + 1] === 10 || buffer[i + 1] === 13))) {
			result += String.fromCharCode(ord);
			continue;
		}
		result += "=" + (ord < 16 ? "0" : "") + ord.toString(16).toUpperCase();
	}
	return result;
}
/**
* Adds soft line breaks to a Quoted-Printable string
*
* @param str Quoted-Printable encoded string that might need line wrapping
* @param [lineLength=76] Maximum allowed length for a line
* @returns Soft-wrapped Quoted-Printable encoded string
*/
function wrap(str, lineLength) {
	str = (str || "").toString();
	lineLength = lineLength || 76;
	if (str.length <= lineLength) return str;
	let pos = 0;
	const len = str.length;
	let match, code, line;
	const lineMargin = Math.floor(lineLength / 3);
	let result = "";
	while (pos < len) {
		line = str.substr(pos, lineLength);
		if (match = line.match(/\r\n/)) {
			line = line.substr(0, match.index + match[0].length);
			result += line;
			pos += line.length;
			continue;
		}
		if (line.substr(-1) === "\n") {
			result += line;
			pos += line.length;
			continue;
		}
		if (match = line.substr(-lineMargin).match(/\n.*?$/)) {
			line = line.substr(0, line.length - (match[0].length - 1));
			result += line;
			pos += line.length;
			continue;
		}
		if (line.length > lineLength - lineMargin && (match = line.substr(-lineMargin).match(/[ \t.,!?][^ \t.,!?]*$/))) line = line.substr(0, line.length - (match[0].length - 1));
		else if (line.match(/[=][\da-f]{0,2}$/i)) {
			if (match = line.match(/[=][\da-f]{0,1}$/i)) line = line.substr(0, line.length - match[0].length);
			while (line.length > 3 && line.length < len - pos && !line.match(/^(?:=[\da-f]{2}){1,4}$/i) && (match = line.match(/[=][\da-f]{2}$/gi))) {
				code = parseInt(match[0].substr(1, 2), 16);
				if (code < 128) break;
				line = line.substr(0, line.length - 3);
				if (code >= 192) break;
			}
		}
		if (pos + line.length < len && line.substr(-1) !== "\n") {
			if (line.length === lineLength && line.match(/[=][\da-f]{2}$/i)) line = line.substr(0, line.length - 3);
			else if (line.length === lineLength) line = line.substr(0, line.length - 1);
			pos += line.length;
			line += "=\r\n";
		} else pos += line.length;
		result += line;
	}
	return result;
}
/**
* Helper function to check if a number is inside provided ranges
*
* @param nr Number to check for
* @param ranges An Array of allowed values
* @returns True if the value was found inside allowed ranges, false otherwise
*/
function checkRanges(nr, ranges) {
	for (let i = ranges.length - 1; i >= 0; i--) {
		const range = ranges[i];
		if (!range.length) continue;
		if (range.length === 1 && nr === range[0]) return true;
		if (range.length === 2 && nr >= range[0] && nr <= range[1]) return true;
	}
	return false;
}
/**
* Creates a transform stream for encoding data to Quoted-Printable encoding
*
* @constructor
* @param options Stream options
* @param [options.lineLength=76] Maximum length for lines, set to false to disable wrapping
*/
var Encoder = class extends Transform {
	constructor(options) {
		super();
		this.options = options || {};
		if (this.options.lineLength !== false) this.options.lineLength = this.options.lineLength || 76;
		this._curLine = "";
		this.inputBytes = 0;
		this.outputBytes = 0;
	}
	/** @internal */
	_transform(chunk, encoding, done) {
		let qp;
		if (encoding !== "buffer") chunk = Buffer.from(chunk, encoding);
		if (!chunk || !chunk.length) return done();
		this.inputBytes += chunk.length;
		if (this.options.lineLength) {
			qp = this._curLine + encode(chunk);
			qp = wrap(qp, this.options.lineLength);
			qp = qp.replace(/(^|\n)([^\n]*)$/, (match, lineBreak, lastLine) => {
				this._curLine = lastLine;
				return lineBreak;
			});
			if (qp) {
				this.outputBytes += qp.length;
				this.push(qp);
			}
		} else {
			qp = encode(chunk);
			this.outputBytes += qp.length;
			this.push(qp, "ascii");
		}
		done();
	}
	/** @internal */
	_flush(done) {
		if (this._curLine) {
			this.outputBytes += this._curLine.length;
			this.push(this._curLine, "ascii");
		}
		done();
	}
};
//#endregion
//#region ../../node_modules/.pnpm/nodemailer@10.0.10/node_modules/nodemailer/dist/esm/mime-funcs/mime-types.js
const defaultMimeType = "application/octet-stream";
const defaultExtension = "bin";
const mimeTypes = /* @__PURE__ */ new Map([
	["application/acad", "dwg"],
	["application/applixware", "aw"],
	["application/arj", "arj"],
	["application/atom+xml", "xml"],
	["application/atomcat+xml", "atomcat"],
	["application/atomsvc+xml", "atomsvc"],
	["application/base64", ["mm", "mme"]],
	["application/binhex", "hqx"],
	["application/binhex4", "hqx"],
	["application/book", ["book", "boo"]],
	["application/ccxml+xml,", "ccxml"],
	["application/cdf", "cdf"],
	["application/cdmi-capability", "cdmia"],
	["application/cdmi-container", "cdmic"],
	["application/cdmi-domain", "cdmid"],
	["application/cdmi-object", "cdmio"],
	["application/cdmi-queue", "cdmiq"],
	["application/clariscad", "ccad"],
	["application/commonground", "dp"],
	["application/cu-seeme", "cu"],
	["application/davmount+xml", "davmount"],
	["application/drafting", "drw"],
	["application/dsptype", "tsp"],
	["application/dssc+der", "dssc"],
	["application/dssc+xml", "xdssc"],
	["application/dxf", "dxf"],
	["application/ecmascript", ["js", "es"]],
	["application/emma+xml", "emma"],
	["application/envoy", "evy"],
	["application/epub+zip", "epub"],
	["application/excel", [
		"xls",
		"xl",
		"xla",
		"xlb",
		"xlc",
		"xld",
		"xlk",
		"xll",
		"xlm",
		"xlt",
		"xlv",
		"xlw"
	]],
	["application/exi", "exi"],
	["application/font-tdpfr", "pfr"],
	["application/fractals", "fif"],
	["application/freeloader", "frl"],
	["application/futuresplash", "spl"],
	["application/geo+json", "geojson"],
	["application/gnutar", "tgz"],
	["application/groupwise", "vew"],
	["application/hlp", "hlp"],
	["application/hta", "hta"],
	["application/hyperstudio", "stk"],
	["application/i-deas", "unv"],
	["application/iges", ["iges", "igs"]],
	["application/inf", "inf"],
	["application/internet-property-stream", "acx"],
	["application/ipfix", "ipfix"],
	["application/java", "class"],
	["application/java-archive", "jar"],
	["application/java-byte-code", "class"],
	["application/java-serialized-object", "ser"],
	["application/java-vm", "class"],
	["application/javascript", "js"],
	["application/json", "json"],
	["application/lha", "lha"],
	["application/lzx", "lzx"],
	["application/mac-binary", "bin"],
	["application/mac-binhex", "hqx"],
	["application/mac-binhex40", "hqx"],
	["application/mac-compactpro", "cpt"],
	["application/macbinary", "bin"],
	["application/mads+xml", "mads"],
	["application/marc", "mrc"],
	["application/marcxml+xml", "mrcx"],
	["application/mathematica", "ma"],
	["application/mathml+xml", "mathml"],
	["application/mbedlet", "mbd"],
	["application/mbox", "mbox"],
	["application/mcad", "mcd"],
	["application/mediaservercontrol+xml", "mscml"],
	["application/metalink4+xml", "meta4"],
	["application/mets+xml", "mets"],
	["application/mime", "aps"],
	["application/mods+xml", "mods"],
	["application/mp21", "m21"],
	["application/mp4", "mp4"],
	["application/mspowerpoint", [
		"ppt",
		"pot",
		"pps",
		"ppz"
	]],
	["application/msword", [
		"doc",
		"dot",
		"w6w",
		"wiz",
		"word"
	]],
	["application/mswrite", "wri"],
	["application/mxf", "mxf"],
	["application/netmc", "mcp"],
	["application/octet-stream", ["*"]],
	["application/oda", "oda"],
	["application/oebps-package+xml", "opf"],
	["application/ogg", "ogx"],
	["application/olescript", "axs"],
	["application/onenote", "onetoc"],
	["application/patch-ops-error+xml", "xer"],
	["application/pdf", "pdf"],
	["application/pgp-encrypted", "asc"],
	["application/pgp-signature", "pgp"],
	["application/pics-rules", "prf"],
	["application/pkcs-12", "p12"],
	["application/pkcs-crl", "crl"],
	["application/pkcs10", "p10"],
	["application/pkcs7-mime", ["p7c", "p7m"]],
	["application/pkcs7-signature", "p7s"],
	["application/pkcs8", "p8"],
	["application/pkix-attr-cert", "ac"],
	["application/pkix-cert", ["cer", "crt"]],
	["application/pkix-crl", "crl"],
	["application/pkix-pkipath", "pkipath"],
	["application/pkixcmp", "pki"],
	["application/plain", "text"],
	["application/pls+xml", "pls"],
	["application/postscript", [
		"ps",
		"ai",
		"eps"
	]],
	["application/powerpoint", "ppt"],
	["application/pro_eng", ["part", "prt"]],
	["application/prs.cww", "cww"],
	["application/pskc+xml", "pskcxml"],
	["application/rdf+xml", "rdf"],
	["application/reginfo+xml", "rif"],
	["application/relax-ng-compact-syntax", "rnc"],
	["application/resource-lists+xml", "rl"],
	["application/resource-lists-diff+xml", "rld"],
	["application/ringing-tones", "rng"],
	["application/rls-services+xml", "rs"],
	["application/rsd+xml", "rsd"],
	["application/rss+xml", "xml"],
	["application/rtf", ["rtf", "rtx"]],
	["application/sbml+xml", "sbml"],
	["application/scvp-cv-request", "scq"],
	["application/scvp-cv-response", "scs"],
	["application/scvp-vp-request", "spq"],
	["application/scvp-vp-response", "spp"],
	["application/sdp", "sdp"],
	["application/sea", "sea"],
	["application/set", "set"],
	["application/set-payment-initiation", "setpay"],
	["application/set-registration-initiation", "setreg"],
	["application/shf+xml", "shf"],
	["application/sla", "stl"],
	["application/smil", ["smi", "smil"]],
	["application/smil+xml", "smi"],
	["application/solids", "sol"],
	["application/sounder", "sdr"],
	["application/sparql-query", "rq"],
	["application/sparql-results+xml", "srx"],
	["application/srgs", "gram"],
	["application/srgs+xml", "grxml"],
	["application/sru+xml", "sru"],
	["application/ssml+xml", "ssml"],
	["application/step", ["step", "stp"]],
	["application/streamingmedia", "ssm"],
	["application/tei+xml", "tei"],
	["application/thraud+xml", "tfi"],
	["application/timestamped-data", "tsd"],
	["application/toolbook", "tbk"],
	["application/vda", "vda"],
	["application/vnd.3gpp.pic-bw-large", "plb"],
	["application/vnd.3gpp.pic-bw-small", "psb"],
	["application/vnd.3gpp.pic-bw-var", "pvb"],
	["application/vnd.3gpp2.tcap", "tcap"],
	["application/vnd.3m.post-it-notes", "pwn"],
	["application/vnd.accpac.simply.aso", "aso"],
	["application/vnd.accpac.simply.imp", "imp"],
	["application/vnd.acucobol", "acu"],
	["application/vnd.acucorp", "atc"],
	["application/vnd.adobe.air-application-installer-package+zip", "air"],
	["application/vnd.adobe.fxp", "fxp"],
	["application/vnd.adobe.xdp+xml", "xdp"],
	["application/vnd.adobe.xfdf", "xfdf"],
	["application/vnd.ahead.space", "ahead"],
	["application/vnd.airzip.filesecure.azf", "azf"],
	["application/vnd.airzip.filesecure.azs", "azs"],
	["application/vnd.amazon.ebook", "azw"],
	["application/vnd.americandynamics.acc", "acc"],
	["application/vnd.amiga.ami", "ami"],
	["application/vnd.android.package-archive", "apk"],
	["application/vnd.anser-web-certificate-issue-initiation", "cii"],
	["application/vnd.anser-web-funds-transfer-initiation", "fti"],
	["application/vnd.antix.game-component", "atx"],
	["application/vnd.apple.installer+xml", "mpkg"],
	["application/vnd.apple.mpegurl", "m3u8"],
	["application/vnd.aristanetworks.swi", "swi"],
	["application/vnd.audiograph", "aep"],
	["application/vnd.blueice.multipass", "mpm"],
	["application/vnd.bmi", "bmi"],
	["application/vnd.businessobjects", "rep"],
	["application/vnd.chemdraw+xml", "cdxml"],
	["application/vnd.chipnuts.karaoke-mmd", "mmd"],
	["application/vnd.cinderella", "cdy"],
	["application/vnd.claymore", "cla"],
	["application/vnd.cloanto.rp9", "rp9"],
	["application/vnd.clonk.c4group", "c4g"],
	["application/vnd.cluetrust.cartomobile-config", "c11amc"],
	["application/vnd.cluetrust.cartomobile-config-pkg", "c11amz"],
	["application/vnd.commonspace", "csp"],
	["application/vnd.contact.cmsg", "cdbcmsg"],
	["application/vnd.cosmocaller", "cmc"],
	["application/vnd.crick.clicker", "clkx"],
	["application/vnd.crick.clicker.keyboard", "clkk"],
	["application/vnd.crick.clicker.palette", "clkp"],
	["application/vnd.crick.clicker.template", "clkt"],
	["application/vnd.crick.clicker.wordbank", "clkw"],
	["application/vnd.criticaltools.wbs+xml", "wbs"],
	["application/vnd.ctc-posml", "pml"],
	["application/vnd.cups-ppd", "ppd"],
	["application/vnd.curl.car", "car"],
	["application/vnd.curl.pcurl", "pcurl"],
	["application/vnd.data-vision.rdz", "rdz"],
	["application/vnd.denovo.fcselayout-link", "fe_launch"],
	["application/vnd.dna", "dna"],
	["application/vnd.dolby.mlp", "mlp"],
	["application/vnd.dpgraph", "dpg"],
	["application/vnd.dreamfactory", "dfac"],
	["application/vnd.dvb.ait", "ait"],
	["application/vnd.dvb.service", "svc"],
	["application/vnd.dynageo", "geo"],
	["application/vnd.ecowin.chart", "mag"],
	["application/vnd.enliven", "nml"],
	["application/vnd.epson.esf", "esf"],
	["application/vnd.epson.msf", "msf"],
	["application/vnd.epson.quickanime", "qam"],
	["application/vnd.epson.salt", "slt"],
	["application/vnd.epson.ssf", "ssf"],
	["application/vnd.eszigno3+xml", "es3"],
	["application/vnd.ezpix-album", "ez2"],
	["application/vnd.ezpix-package", "ez3"],
	["application/vnd.fdf", "fdf"],
	["application/vnd.fdsn.seed", "seed"],
	["application/vnd.flographit", "gph"],
	["application/vnd.fluxtime.clip", "ftc"],
	["application/vnd.framemaker", "fm"],
	["application/vnd.frogans.fnc", "fnc"],
	["application/vnd.frogans.ltf", "ltf"],
	["application/vnd.fsc.weblaunch", "fsc"],
	["application/vnd.fujitsu.oasys", "oas"],
	["application/vnd.fujitsu.oasys2", "oa2"],
	["application/vnd.fujitsu.oasys3", "oa3"],
	["application/vnd.fujitsu.oasysgp", "fg5"],
	["application/vnd.fujitsu.oasysprs", "bh2"],
	["application/vnd.fujixerox.ddd", "ddd"],
	["application/vnd.fujixerox.docuworks", "xdw"],
	["application/vnd.fujixerox.docuworks.binder", "xbd"],
	["application/vnd.fuzzysheet", "fzs"],
	["application/vnd.genomatix.tuxedo", "txd"],
	["application/vnd.geogebra.file", "ggb"],
	["application/vnd.geogebra.tool", "ggt"],
	["application/vnd.geometry-explorer", "gex"],
	["application/vnd.geonext", "gxt"],
	["application/vnd.geoplan", "g2w"],
	["application/vnd.geospace", "g3w"],
	["application/vnd.gmx", "gmx"],
	["application/vnd.google-earth.kml+xml", "kml"],
	["application/vnd.google-earth.kmz", "kmz"],
	["application/vnd.grafeq", "gqf"],
	["application/vnd.groove-account", "gac"],
	["application/vnd.groove-help", "ghf"],
	["application/vnd.groove-identity-message", "gim"],
	["application/vnd.groove-injector", "grv"],
	["application/vnd.groove-tool-message", "gtm"],
	["application/vnd.groove-tool-template", "tpl"],
	["application/vnd.groove-vcard", "vcg"],
	["application/vnd.hal+xml", "hal"],
	["application/vnd.handheld-entertainment+xml", "zmm"],
	["application/vnd.hbci", "hbci"],
	["application/vnd.hhe.lesson-player", "les"],
	["application/vnd.hp-hpgl", [
		"hgl",
		"hpg",
		"hpgl"
	]],
	["application/vnd.hp-hpid", "hpid"],
	["application/vnd.hp-hps", "hps"],
	["application/vnd.hp-jlyt", "jlt"],
	["application/vnd.hp-pcl", "pcl"],
	["application/vnd.hp-pclxl", "pclxl"],
	["application/vnd.hydrostatix.sof-data", "sfd-hdstx"],
	["application/vnd.hzn-3d-crossword", "x3d"],
	["application/vnd.ibm.minipay", "mpy"],
	["application/vnd.ibm.modcap", "afp"],
	["application/vnd.ibm.rights-management", "irm"],
	["application/vnd.ibm.secure-container", "sc"],
	["application/vnd.iccprofile", "icc"],
	["application/vnd.igloader", "igl"],
	["application/vnd.immervision-ivp", "ivp"],
	["application/vnd.immervision-ivu", "ivu"],
	["application/vnd.insors.igm", "igm"],
	["application/vnd.intercon.formnet", "xpw"],
	["application/vnd.intergeo", "i2g"],
	["application/vnd.intu.qbo", "qbo"],
	["application/vnd.intu.qfx", "qfx"],
	["application/vnd.ipunplugged.rcprofile", "rcprofile"],
	["application/vnd.irepository.package+xml", "irp"],
	["application/vnd.is-xpr", "xpr"],
	["application/vnd.isac.fcs", "fcs"],
	["application/vnd.jam", "jam"],
	["application/vnd.jcp.javame.midlet-rms", "rms"],
	["application/vnd.jisp", "jisp"],
	["application/vnd.joost.joda-archive", "joda"],
	["application/vnd.kahootz", "ktz"],
	["application/vnd.kde.karbon", "karbon"],
	["application/vnd.kde.kchart", "chrt"],
	["application/vnd.kde.kformula", "kfo"],
	["application/vnd.kde.kivio", "flw"],
	["application/vnd.kde.kontour", "kon"],
	["application/vnd.kde.kpresenter", "kpr"],
	["application/vnd.kde.kspread", "ksp"],
	["application/vnd.kde.kword", "kwd"],
	["application/vnd.kenameaapp", "htke"],
	["application/vnd.kidspiration", "kia"],
	["application/vnd.kinar", "kne"],
	["application/vnd.koan", "skp"],
	["application/vnd.kodak-descriptor", "sse"],
	["application/vnd.las.las+xml", "lasxml"],
	["application/vnd.llamagraphics.life-balance.desktop", "lbd"],
	["application/vnd.llamagraphics.life-balance.exchange+xml", "lbe"],
	["application/vnd.lotus-1-2-3", "123"],
	["application/vnd.lotus-approach", "apr"],
	["application/vnd.lotus-freelance", "pre"],
	["application/vnd.lotus-notes", "nsf"],
	["application/vnd.lotus-organizer", "org"],
	["application/vnd.lotus-screencam", "scm"],
	["application/vnd.lotus-wordpro", "lwp"],
	["application/vnd.macports.portpkg", "portpkg"],
	["application/vnd.mcd", "mcd"],
	["application/vnd.medcalcdata", "mc1"],
	["application/vnd.mediastation.cdkey", "cdkey"],
	["application/vnd.mfer", "mwf"],
	["application/vnd.mfmp", "mfm"],
	["application/vnd.micrografx.flo", "flo"],
	["application/vnd.micrografx.igx", "igx"],
	["application/vnd.mif", "mif"],
	["application/vnd.mobius.daf", "daf"],
	["application/vnd.mobius.dis", "dis"],
	["application/vnd.mobius.mbk", "mbk"],
	["application/vnd.mobius.mqy", "mqy"],
	["application/vnd.mobius.msl", "msl"],
	["application/vnd.mobius.plc", "plc"],
	["application/vnd.mobius.txf", "txf"],
	["application/vnd.mophun.application", "mpn"],
	["application/vnd.mophun.certificate", "mpc"],
	["application/vnd.mozilla.xul+xml", "xul"],
	["application/vnd.ms-artgalry", "cil"],
	["application/vnd.ms-cab-compressed", "cab"],
	["application/vnd.ms-excel", [
		"xls",
		"xla",
		"xlc",
		"xlm",
		"xlt",
		"xlw",
		"xlb",
		"xll"
	]],
	["application/vnd.ms-excel.addin.macroenabled.12", "xlam"],
	["application/vnd.ms-excel.sheet.binary.macroenabled.12", "xlsb"],
	["application/vnd.ms-excel.sheet.macroenabled.12", "xlsm"],
	["application/vnd.ms-excel.template.macroenabled.12", "xltm"],
	["application/vnd.ms-fontobject", "eot"],
	["application/vnd.ms-htmlhelp", "chm"],
	["application/vnd.ms-ims", "ims"],
	["application/vnd.ms-lrm", "lrm"],
	["application/vnd.ms-officetheme", "thmx"],
	["application/vnd.ms-outlook", "msg"],
	["application/vnd.ms-pki.certstore", "sst"],
	["application/vnd.ms-pki.pko", "pko"],
	["application/vnd.ms-pki.seccat", "cat"],
	["application/vnd.ms-pki.stl", "stl"],
	["application/vnd.ms-pkicertstore", "sst"],
	["application/vnd.ms-pkiseccat", "cat"],
	["application/vnd.ms-pkistl", "stl"],
	["application/vnd.ms-powerpoint", [
		"ppt",
		"pot",
		"pps",
		"ppa",
		"pwz"
	]],
	["application/vnd.ms-powerpoint.addin.macroenabled.12", "ppam"],
	["application/vnd.ms-powerpoint.presentation.macroenabled.12", "pptm"],
	["application/vnd.ms-powerpoint.slide.macroenabled.12", "sldm"],
	["application/vnd.ms-powerpoint.slideshow.macroenabled.12", "ppsm"],
	["application/vnd.ms-powerpoint.template.macroenabled.12", "potm"],
	["application/vnd.ms-project", "mpp"],
	["application/vnd.ms-word.document.macroenabled.12", "docm"],
	["application/vnd.ms-word.template.macroenabled.12", "dotm"],
	["application/vnd.ms-works", [
		"wks",
		"wcm",
		"wdb",
		"wps"
	]],
	["application/vnd.ms-wpl", "wpl"],
	["application/vnd.ms-xpsdocument", "xps"],
	["application/vnd.mseq", "mseq"],
	["application/vnd.musician", "mus"],
	["application/vnd.muvee.style", "msty"],
	["application/vnd.neurolanguage.nlu", "nlu"],
	["application/vnd.noblenet-directory", "nnd"],
	["application/vnd.noblenet-sealer", "nns"],
	["application/vnd.noblenet-web", "nnw"],
	["application/vnd.nokia.configuration-message", "ncm"],
	["application/vnd.nokia.n-gage.data", "ngdat"],
	["application/vnd.nokia.n-gage.symbian.install", "n-gage"],
	["application/vnd.nokia.radio-preset", "rpst"],
	["application/vnd.nokia.radio-presets", "rpss"],
	["application/vnd.nokia.ringing-tone", "rng"],
	["application/vnd.novadigm.edm", "edm"],
	["application/vnd.novadigm.edx", "edx"],
	["application/vnd.novadigm.ext", "ext"],
	["application/vnd.oasis.opendocument.chart", "odc"],
	["application/vnd.oasis.opendocument.chart-template", "otc"],
	["application/vnd.oasis.opendocument.database", "odb"],
	["application/vnd.oasis.opendocument.formula", "odf"],
	["application/vnd.oasis.opendocument.formula-template", "odft"],
	["application/vnd.oasis.opendocument.graphics", "odg"],
	["application/vnd.oasis.opendocument.graphics-template", "otg"],
	["application/vnd.oasis.opendocument.image", "odi"],
	["application/vnd.oasis.opendocument.image-template", "oti"],
	["application/vnd.oasis.opendocument.presentation", "odp"],
	["application/vnd.oasis.opendocument.presentation-template", "otp"],
	["application/vnd.oasis.opendocument.spreadsheet", "ods"],
	["application/vnd.oasis.opendocument.spreadsheet-template", "ots"],
	["application/vnd.oasis.opendocument.text", "odt"],
	["application/vnd.oasis.opendocument.text-master", "odm"],
	["application/vnd.oasis.opendocument.text-template", "ott"],
	["application/vnd.oasis.opendocument.text-web", "oth"],
	["application/vnd.olpc-sugar", "xo"],
	["application/vnd.oma.dd2+xml", "dd2"],
	["application/vnd.openofficeorg.extension", "oxt"],
	["application/vnd.openxmlformats-officedocument.presentationml.presentation", "pptx"],
	["application/vnd.openxmlformats-officedocument.presentationml.slide", "sldx"],
	["application/vnd.openxmlformats-officedocument.presentationml.slideshow", "ppsx"],
	["application/vnd.openxmlformats-officedocument.presentationml.template", "potx"],
	["application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "xlsx"],
	["application/vnd.openxmlformats-officedocument.spreadsheetml.template", "xltx"],
	["application/vnd.openxmlformats-officedocument.wordprocessingml.document", "docx"],
	["application/vnd.openxmlformats-officedocument.wordprocessingml.template", "dotx"],
	["application/vnd.osgeo.mapguide.package", "mgp"],
	["application/vnd.osgi.dp", "dp"],
	["application/vnd.palm", "pdb"],
	["application/vnd.pawaafile", "paw"],
	["application/vnd.pg.format", "str"],
	["application/vnd.pg.osasli", "ei6"],
	["application/vnd.picsel", "efif"],
	["application/vnd.pmi.widget", "wg"],
	["application/vnd.pocketlearn", "plf"],
	["application/vnd.powerbuilder6", "pbd"],
	["application/vnd.previewsystems.box", "box"],
	["application/vnd.proteus.magazine", "mgz"],
	["application/vnd.publishare-delta-tree", "qps"],
	["application/vnd.pvi.ptid1", "ptid"],
	["application/vnd.quark.quarkxpress", "qxd"],
	["application/vnd.realvnc.bed", "bed"],
	["application/vnd.recordare.musicxml", "mxl"],
	["application/vnd.recordare.musicxml+xml", "musicxml"],
	["application/vnd.rig.cryptonote", "cryptonote"],
	["application/vnd.rim.cod", "cod"],
	["application/vnd.rn-realmedia", "rm"],
	["application/vnd.rn-realplayer", "rnx"],
	["application/vnd.route66.link66+xml", "link66"],
	["application/vnd.sailingtracker.track", "st"],
	["application/vnd.seemail", "see"],
	["application/vnd.sema", "sema"],
	["application/vnd.semd", "semd"],
	["application/vnd.semf", "semf"],
	["application/vnd.shana.informed.formdata", "ifm"],
	["application/vnd.shana.informed.formtemplate", "itp"],
	["application/vnd.shana.informed.interchange", "iif"],
	["application/vnd.shana.informed.package", "ipk"],
	["application/vnd.simtech-mindmapper", "twd"],
	["application/vnd.smaf", "mmf"],
	["application/vnd.smart.teacher", "teacher"],
	["application/vnd.solent.sdkm+xml", "sdkm"],
	["application/vnd.spotfire.dxp", "dxp"],
	["application/vnd.spotfire.sfs", "sfs"],
	["application/vnd.stardivision.calc", "sdc"],
	["application/vnd.stardivision.draw", "sda"],
	["application/vnd.stardivision.impress", "sdd"],
	["application/vnd.stardivision.math", "smf"],
	["application/vnd.stardivision.writer", "sdw"],
	["application/vnd.stardivision.writer-global", "sgl"],
	["application/vnd.stepmania.stepchart", "sm"],
	["application/vnd.sun.xml.calc", "sxc"],
	["application/vnd.sun.xml.calc.template", "stc"],
	["application/vnd.sun.xml.draw", "sxd"],
	["application/vnd.sun.xml.draw.template", "std"],
	["application/vnd.sun.xml.impress", "sxi"],
	["application/vnd.sun.xml.impress.template", "sti"],
	["application/vnd.sun.xml.math", "sxm"],
	["application/vnd.sun.xml.writer", "sxw"],
	["application/vnd.sun.xml.writer.global", "sxg"],
	["application/vnd.sun.xml.writer.template", "stw"],
	["application/vnd.sus-calendar", "sus"],
	["application/vnd.svd", "svd"],
	["application/vnd.symbian.install", "sis"],
	["application/vnd.syncml+xml", "xsm"],
	["application/vnd.syncml.dm+wbxml", "bdm"],
	["application/vnd.syncml.dm+xml", "xdm"],
	["application/vnd.tao.intent-module-archive", "tao"],
	["application/vnd.tmobile-livetv", "tmo"],
	["application/vnd.trid.tpt", "tpt"],
	["application/vnd.triscape.mxs", "mxs"],
	["application/vnd.trueapp", "tra"],
	["application/vnd.ufdl", "ufd"],
	["application/vnd.uiq.theme", "utz"],
	["application/vnd.umajin", "umj"],
	["application/vnd.unity", "unityweb"],
	["application/vnd.uoml+xml", "uoml"],
	["application/vnd.vcx", "vcx"],
	["application/vnd.visio", "vsd"],
	["application/vnd.visionary", "vis"],
	["application/vnd.vsf", "vsf"],
	["application/vnd.wap.wbxml", "wbxml"],
	["application/vnd.wap.wmlc", "wmlc"],
	["application/vnd.wap.wmlscriptc", "wmlsc"],
	["application/vnd.webturbo", "wtb"],
	["application/vnd.wolfram.player", "nbp"],
	["application/vnd.wordperfect", "wpd"],
	["application/vnd.wqd", "wqd"],
	["application/vnd.wt.stf", "stf"],
	["application/vnd.xara", ["web", "xar"]],
	["application/vnd.xfdl", "xfdl"],
	["application/vnd.yamaha.hv-dic", "hvd"],
	["application/vnd.yamaha.hv-script", "hvs"],
	["application/vnd.yamaha.hv-voice", "hvp"],
	["application/vnd.yamaha.openscoreformat", "osf"],
	["application/vnd.yamaha.openscoreformat.osfpvg+xml", "osfpvg"],
	["application/vnd.yamaha.smaf-audio", "saf"],
	["application/vnd.yamaha.smaf-phrase", "spf"],
	["application/vnd.yellowriver-custom-menu", "cmp"],
	["application/vnd.zul", "zir"],
	["application/vnd.zzazz.deck+xml", "zaz"],
	["application/vocaltec-media-desc", "vmd"],
	["application/vocaltec-media-file", "vmf"],
	["application/voicexml+xml", "vxml"],
	["application/widget", "wgt"],
	["application/winhlp", "hlp"],
	["application/wordperfect", [
		"wp",
		"wp5",
		"wp6",
		"wpd"
	]],
	["application/wordperfect6.0", ["w60", "wp5"]],
	["application/wordperfect6.1", "w61"],
	["application/wsdl+xml", "wsdl"],
	["application/wspolicy+xml", "wspolicy"],
	["application/x-123", "wk1"],
	["application/x-7z-compressed", "7z"],
	["application/x-abiword", "abw"],
	["application/x-ace-compressed", "ace"],
	["application/x-aim", "aim"],
	["application/x-authorware-bin", "aab"],
	["application/x-authorware-map", "aam"],
	["application/x-authorware-seg", "aas"],
	["application/x-bcpio", "bcpio"],
	["application/x-binary", "bin"],
	["application/x-binhex40", "hqx"],
	["application/x-bittorrent", "torrent"],
	["application/x-bsh", [
		"bsh",
		"sh",
		"shar"
	]],
	["application/x-bytecode.elisp", "elc"],
	["application/x-bytecode.python", "pyc"],
	["application/x-bzip", "bz"],
	["application/x-bzip2", ["boz", "bz2"]],
	["application/x-cdf", "cdf"],
	["application/x-cdlink", "vcd"],
	["application/x-chat", ["cha", "chat"]],
	["application/x-chess-pgn", "pgn"],
	["application/x-cmu-raster", "ras"],
	["application/x-cocoa", "cco"],
	["application/x-compactpro", "cpt"],
	["application/x-compress", "z"],
	["application/x-compressed", [
		"tgz",
		"gz",
		"z",
		"zip"
	]],
	["application/x-conference", "nsc"],
	["application/x-cpio", "cpio"],
	["application/x-cpt", "cpt"],
	["application/x-csh", "csh"],
	["application/x-debian-package", "deb"],
	["application/x-deepv", "deepv"],
	["application/x-director", [
		"dir",
		"dcr",
		"dxr"
	]],
	["application/x-doom", "wad"],
	["application/x-dtbncx+xml", "ncx"],
	["application/x-dtbook+xml", "dtb"],
	["application/x-dtbresource+xml", "res"],
	["application/x-dvi", "dvi"],
	["application/x-elc", "elc"],
	["application/x-envoy", ["env", "evy"]],
	["application/x-esrehber", "es"],
	["application/x-excel", [
		"xls",
		"xla",
		"xlb",
		"xlc",
		"xld",
		"xlk",
		"xll",
		"xlm",
		"xlt",
		"xlv",
		"xlw"
	]],
	["application/x-font-bdf", "bdf"],
	["application/x-font-ghostscript", "gsf"],
	["application/x-font-linux-psf", "psf"],
	["application/x-font-otf", "otf"],
	["application/x-font-pcf", "pcf"],
	["application/x-font-snf", "snf"],
	["application/x-font-ttf", "ttf"],
	["application/x-font-type1", "pfa"],
	["application/x-font-woff", "woff"],
	["application/x-frame", "mif"],
	["application/x-freelance", "pre"],
	["application/x-futuresplash", "spl"],
	["application/x-gnumeric", "gnumeric"],
	["application/x-gsp", "gsp"],
	["application/x-gss", "gss"],
	["application/x-gtar", "gtar"],
	["application/x-gzip", ["gz", "gzip"]],
	["application/x-hdf", "hdf"],
	["application/x-helpfile", ["help", "hlp"]],
	["application/x-httpd-imap", "imap"],
	["application/x-ima", "ima"],
	["application/x-internet-signup", ["ins", "isp"]],
	["application/x-internett-signup", "ins"],
	["application/x-inventor", "iv"],
	["application/x-ip2", "ip"],
	["application/x-iphone", "iii"],
	["application/x-java-class", "class"],
	["application/x-java-commerce", "jcm"],
	["application/x-java-jnlp-file", "jnlp"],
	["application/x-javascript", "js"],
	["application/x-koan", [
		"skd",
		"skm",
		"skp",
		"skt"
	]],
	["application/x-ksh", "ksh"],
	["application/x-latex", ["latex", "ltx"]],
	["application/x-lha", "lha"],
	["application/x-lisp", "lsp"],
	["application/x-livescreen", "ivy"],
	["application/x-lotus", "wq1"],
	["application/x-lotusscreencam", "scm"],
	["application/x-lzh", "lzh"],
	["application/x-lzx", "lzx"],
	["application/x-mac-binhex40", "hqx"],
	["application/x-macbinary", "bin"],
	["application/x-magic-cap-package-1.0", "mc$"],
	["application/x-mathcad", "mcd"],
	["application/x-meme", "mm"],
	["application/x-midi", ["mid", "midi"]],
	["application/x-mif", "mif"],
	["application/x-mix-transfer", "nix"],
	["application/x-mobipocket-ebook", "prc"],
	["application/x-mplayer2", "asx"],
	["application/x-ms-application", "application"],
	["application/x-ms-wmd", "wmd"],
	["application/x-ms-wmz", "wmz"],
	["application/x-ms-xbap", "xbap"],
	["application/x-msaccess", "mdb"],
	["application/x-msbinder", "obd"],
	["application/x-mscardfile", "crd"],
	["application/x-msclip", "clp"],
	["application/x-msdownload", ["exe", "dll"]],
	["application/x-msexcel", [
		"xls",
		"xla",
		"xlw"
	]],
	["application/x-msmediaview", [
		"mvb",
		"m13",
		"m14"
	]],
	["application/x-msmetafile", "wmf"],
	["application/x-msmoney", "mny"],
	["application/x-mspowerpoint", "ppt"],
	["application/x-mspublisher", "pub"],
	["application/x-msschedule", "scd"],
	["application/x-msterminal", "trm"],
	["application/x-mswrite", "wri"],
	["application/x-navi-animation", "ani"],
	["application/x-navidoc", "nvd"],
	["application/x-navimap", "map"],
	["application/x-navistyle", "stl"],
	["application/x-netcdf", ["cdf", "nc"]],
	["application/x-newton-compatible-pkg", "pkg"],
	["application/x-nokia-9000-communicator-add-on-software", "aos"],
	["application/x-omc", "omc"],
	["application/x-omcdatamaker", "omcd"],
	["application/x-omcregerator", "omcr"],
	["application/x-pagemaker", ["pm4", "pm5"]],
	["application/x-pcl", "pcl"],
	["application/x-perfmon", [
		"pma",
		"pmc",
		"pml",
		"pmr",
		"pmw"
	]],
	["application/x-pixclscript", "plx"],
	["application/x-pkcs10", "p10"],
	["application/x-pkcs12", ["p12", "pfx"]],
	["application/x-pkcs7-certificates", ["p7b", "spc"]],
	["application/x-pkcs7-certreqresp", "p7r"],
	["application/x-pkcs7-mime", ["p7m", "p7c"]],
	["application/x-pkcs7-signature", ["p7s", "p7a"]],
	["application/x-pointplus", "css"],
	["application/x-portable-anymap", "pnm"],
	["application/x-project", [
		"mpc",
		"mpt",
		"mpv",
		"mpx"
	]],
	["application/x-qpro", "wb1"],
	["application/x-rar-compressed", "rar"],
	["application/x-rtf", "rtf"],
	["application/x-sdp", "sdp"],
	["application/x-sea", "sea"],
	["application/x-seelogo", "sl"],
	["application/x-sh", "sh"],
	["application/x-shar", ["shar", "sh"]],
	["application/x-shockwave-flash", "swf"],
	["application/x-silverlight-app", "xap"],
	["application/x-sit", "sit"],
	["application/x-sprite", ["spr", "sprite"]],
	["application/x-stuffit", "sit"],
	["application/x-stuffitx", "sitx"],
	["application/x-sv4cpio", "sv4cpio"],
	["application/x-sv4crc", "sv4crc"],
	["application/x-tar", "tar"],
	["application/x-tbook", ["sbk", "tbk"]],
	["application/x-tcl", "tcl"],
	["application/x-tex", "tex"],
	["application/x-tex-tfm", "tfm"],
	["application/x-texinfo", ["texi", "texinfo"]],
	["application/x-troff", [
		"roff",
		"t",
		"tr"
	]],
	["application/x-troff-man", "man"],
	["application/x-troff-me", "me"],
	["application/x-troff-ms", "ms"],
	["application/x-troff-msvideo", "avi"],
	["application/x-ustar", "ustar"],
	["application/x-visio", [
		"vsd",
		"vst",
		"vsw"
	]],
	["application/x-vnd.audioexplosion.mzz", "mzz"],
	["application/x-vnd.ls-xpix", "xpix"],
	["application/x-vrml", "vrml"],
	["application/x-wais-source", ["src", "wsrc"]],
	["application/x-winhelp", "hlp"],
	["application/x-wintalk", "wtk"],
	["application/x-world", ["wrl", "svr"]],
	["application/x-wpwin", "wpd"],
	["application/x-wri", "wri"],
	["application/x-x509-ca-cert", [
		"cer",
		"crt",
		"der"
	]],
	["application/x-x509-user-cert", "crt"],
	["application/x-xfig", "fig"],
	["application/x-xpinstall", "xpi"],
	["application/x-zip-compressed", "zip"],
	["application/xcap-diff+xml", "xdf"],
	["application/xenc+xml", "xenc"],
	["application/xhtml+xml", "xhtml"],
	["application/xml", "xml"],
	["application/xml-dtd", "dtd"],
	["application/xop+xml", "xop"],
	["application/xslt+xml", "xslt"],
	["application/xspf+xml", "xspf"],
	["application/xv+xml", "mxml"],
	["application/yang", "yang"],
	["application/yin+xml", "yin"],
	["application/ynd.ms-pkipko", "pko"],
	["application/zip", "zip"],
	["audio/adpcm", "adp"],
	["audio/aiff", [
		"aiff",
		"aif",
		"aifc"
	]],
	["audio/basic", ["snd", "au"]],
	["audio/it", "it"],
	["audio/make", [
		"funk",
		"my",
		"pfunk"
	]],
	["audio/make.my.funk", "pfunk"],
	["audio/mid", ["mid", "rmi"]],
	["audio/midi", [
		"midi",
		"kar",
		"mid"
	]],
	["audio/mod", "mod"],
	["audio/mp4", "mp4a"],
	["audio/mpeg", [
		"mpga",
		"mp3",
		"m2a",
		"mp2",
		"mpa",
		"mpg"
	]],
	["audio/mpeg3", "mp3"],
	["audio/nspaudio", ["la", "lma"]],
	["audio/ogg", "oga"],
	["audio/s3m", "s3m"],
	["audio/tsp-audio", "tsi"],
	["audio/tsplayer", "tsp"],
	["audio/vnd.dece.audio", "uva"],
	["audio/vnd.digital-winds", "eol"],
	["audio/vnd.dra", "dra"],
	["audio/vnd.dts", "dts"],
	["audio/vnd.dts.hd", "dtshd"],
	["audio/vnd.lucent.voice", "lvp"],
	["audio/vnd.ms-playready.media.pya", "pya"],
	["audio/vnd.nuera.ecelp4800", "ecelp4800"],
	["audio/vnd.nuera.ecelp7470", "ecelp7470"],
	["audio/vnd.nuera.ecelp9600", "ecelp9600"],
	["audio/vnd.qcelp", "qcp"],
	["audio/vnd.rip", "rip"],
	["audio/voc", "voc"],
	["audio/voxware", "vox"],
	["audio/wav", "wav"],
	["audio/webm", "weba"],
	["audio/x-aac", "aac"],
	["audio/x-adpcm", "snd"],
	["audio/x-aiff", [
		"aiff",
		"aif",
		"aifc"
	]],
	["audio/x-au", "au"],
	["audio/x-gsm", ["gsd", "gsm"]],
	["audio/x-jam", "jam"],
	["audio/x-liveaudio", "lam"],
	["audio/x-mid", ["mid", "midi"]],
	["audio/x-midi", ["midi", "mid"]],
	["audio/x-mod", "mod"],
	["audio/x-mpeg", "mp2"],
	["audio/x-mpeg-3", "mp3"],
	["audio/x-mpegurl", "m3u"],
	["audio/x-mpequrl", "m3u"],
	["audio/x-ms-wax", "wax"],
	["audio/x-ms-wma", "wma"],
	["audio/x-nspaudio", ["la", "lma"]],
	["audio/x-pn-realaudio", [
		"ra",
		"ram",
		"rm",
		"rmm",
		"rmp"
	]],
	["audio/x-pn-realaudio-plugin", [
		"ra",
		"rmp",
		"rpm"
	]],
	["audio/x-psid", "sid"],
	["audio/x-realaudio", "ra"],
	["audio/x-twinvq", "vqf"],
	["audio/x-twinvq-plugin", ["vqe", "vql"]],
	["audio/x-vnd.audioexplosion.mjuicemediafile", "mjf"],
	["audio/x-voc", "voc"],
	["audio/x-wav", "wav"],
	["audio/xm", "xm"],
	["chemical/x-cdx", "cdx"],
	["chemical/x-cif", "cif"],
	["chemical/x-cmdf", "cmdf"],
	["chemical/x-cml", "cml"],
	["chemical/x-csml", "csml"],
	["chemical/x-pdb", ["pdb", "xyz"]],
	["chemical/x-xyz", "xyz"],
	["drawing/x-dwf", "dwf"],
	["i-world/i-vrml", "ivr"],
	["image/bmp", ["bmp", "bm"]],
	["image/cgm", "cgm"],
	["image/cis-cod", "cod"],
	["image/cmu-raster", ["ras", "rast"]],
	["image/fif", "fif"],
	["image/florian", ["flo", "turbot"]],
	["image/g3fax", "g3"],
	["image/gif", "gif"],
	["image/ief", ["ief", "iefs"]],
	["image/jpeg", [
		"jpeg",
		"jpe",
		"jpg",
		"jfif",
		"jfif-tbnl"
	]],
	["image/jutvision", "jut"],
	["image/ktx", "ktx"],
	["image/naplps", ["nap", "naplps"]],
	["image/pict", ["pic", "pict"]],
	["image/pipeg", "jfif"],
	["image/pjpeg", [
		"jfif",
		"jpe",
		"jpeg",
		"jpg"
	]],
	["image/png", ["png", "x-png"]],
	["image/prs.btif", "btif"],
	["image/svg+xml", "svg"],
	["image/tiff", ["tif", "tiff"]],
	["image/vasa", "mcf"],
	["image/vnd.adobe.photoshop", "psd"],
	["image/vnd.dece.graphic", "uvi"],
	["image/vnd.djvu", "djvu"],
	["image/vnd.dvb.subtitle", "sub"],
	["image/vnd.dwg", [
		"dwg",
		"dxf",
		"svf"
	]],
	["image/vnd.dxf", "dxf"],
	["image/vnd.fastbidsheet", "fbs"],
	["image/vnd.fpx", "fpx"],
	["image/vnd.fst", "fst"],
	["image/vnd.fujixerox.edmics-mmr", "mmr"],
	["image/vnd.fujixerox.edmics-rlc", "rlc"],
	["image/vnd.ms-modi", "mdi"],
	["image/vnd.net-fpx", ["fpx", "npx"]],
	["image/vnd.rn-realflash", "rf"],
	["image/vnd.rn-realpix", "rp"],
	["image/vnd.wap.wbmp", "wbmp"],
	["image/vnd.xiff", "xif"],
	["image/webp", "webp"],
	["image/x-cmu-raster", "ras"],
	["image/x-cmx", "cmx"],
	["image/x-dwg", [
		"dwg",
		"dxf",
		"svf"
	]],
	["image/x-freehand", "fh"],
	["image/x-icon", "ico"],
	["image/x-jg", "art"],
	["image/x-jps", "jps"],
	["image/x-niff", ["niff", "nif"]],
	["image/x-pcx", "pcx"],
	["image/x-pict", ["pct", "pic"]],
	["image/x-portable-anymap", "pnm"],
	["image/x-portable-bitmap", "pbm"],
	["image/x-portable-graymap", "pgm"],
	["image/x-portable-greymap", "pgm"],
	["image/x-portable-pixmap", "ppm"],
	["image/x-quicktime", [
		"qif",
		"qti",
		"qtif"
	]],
	["image/x-rgb", "rgb"],
	["image/x-tiff", ["tif", "tiff"]],
	["image/x-windows-bmp", "bmp"],
	["image/x-xbitmap", "xbm"],
	["image/x-xbm", "xbm"],
	["image/x-xpixmap", ["xpm", "pm"]],
	["image/x-xwd", "xwd"],
	["image/x-xwindowdump", "xwd"],
	["image/xbm", "xbm"],
	["image/xpm", "xpm"],
	["message/rfc822", [
		"eml",
		"mht",
		"mhtml",
		"nws",
		"mime"
	]],
	["model/iges", ["iges", "igs"]],
	["model/mesh", "msh"],
	["model/vnd.collada+xml", "dae"],
	["model/vnd.dwf", "dwf"],
	["model/vnd.gdl", "gdl"],
	["model/vnd.gtw", "gtw"],
	["model/vnd.mts", "mts"],
	["model/vnd.vtu", "vtu"],
	["model/vrml", [
		"vrml",
		"wrl",
		"wrz"
	]],
	["model/x-pov", "pov"],
	["multipart/x-gzip", "gzip"],
	["multipart/x-ustar", "ustar"],
	["multipart/x-zip", "zip"],
	["music/crescendo", ["mid", "midi"]],
	["music/x-karaoke", "kar"],
	["paleovu/x-pv", "pvu"],
	["text/asp", "asp"],
	["text/calendar", "ics"],
	["text/css", "css"],
	["text/csv", "csv"],
	["text/ecmascript", "js"],
	["text/h323", "323"],
	["text/html", [
		"html",
		"htm",
		"stm",
		"acgi",
		"htmls",
		"htx",
		"shtml"
	]],
	["text/iuls", "uls"],
	["text/javascript", "js"],
	["text/mcf", "mcf"],
	["text/n3", "n3"],
	["text/pascal", "pas"],
	["text/plain", [
		"txt",
		"bas",
		"c",
		"h",
		"c++",
		"cc",
		"com",
		"conf",
		"cxx",
		"def",
		"f",
		"f90",
		"for",
		"g",
		"hh",
		"idc",
		"jav",
		"java",
		"list",
		"log",
		"lst",
		"m",
		"mar",
		"pl",
		"sdml",
		"text"
	]],
	["text/plain-bas", "par"],
	["text/prs.lines.tag", "dsc"],
	["text/richtext", [
		"rtx",
		"rt",
		"rtf"
	]],
	["text/scriplet", "wsc"],
	["text/scriptlet", "sct"],
	["text/sgml", ["sgm", "sgml"]],
	["text/tab-separated-values", "tsv"],
	["text/troff", "t"],
	["text/turtle", "ttl"],
	["text/uri-list", [
		"uni",
		"unis",
		"uri",
		"uris"
	]],
	["text/vnd.abc", "abc"],
	["text/vnd.curl", "curl"],
	["text/vnd.curl.dcurl", "dcurl"],
	["text/vnd.curl.mcurl", "mcurl"],
	["text/vnd.curl.scurl", "scurl"],
	["text/vnd.fly", "fly"],
	["text/vnd.fmi.flexstor", "flx"],
	["text/vnd.graphviz", "gv"],
	["text/vnd.in3d.3dml", "3dml"],
	["text/vnd.in3d.spot", "spot"],
	["text/vnd.rn-realtext", "rt"],
	["text/vnd.sun.j2me.app-descriptor", "jad"],
	["text/vnd.wap.wml", "wml"],
	["text/vnd.wap.wmlscript", "wmls"],
	["text/webviewhtml", "htt"],
	["text/x-asm", ["asm", "s"]],
	["text/x-audiosoft-intra", "aip"],
	["text/x-c", [
		"c",
		"cc",
		"cpp"
	]],
	["text/x-component", "htc"],
	["text/x-fortran", [
		"for",
		"f",
		"f77",
		"f90"
	]],
	["text/x-h", ["h", "hh"]],
	["text/x-java-source", ["java", "jav"]],
	["text/x-java-source,java", "java"],
	["text/x-la-asf", "lsx"],
	["text/x-m", "m"],
	["text/x-pascal", "p"],
	["text/x-script", "hlb"],
	["text/x-script.csh", "csh"],
	["text/x-script.elisp", "el"],
	["text/x-script.guile", "scm"],
	["text/x-script.ksh", "ksh"],
	["text/x-script.lisp", "lsp"],
	["text/x-script.perl", "pl"],
	["text/x-script.perl-module", "pm"],
	["text/x-script.phyton", "py"],
	["text/x-script.rexx", "rexx"],
	["text/x-script.scheme", "scm"],
	["text/x-script.sh", "sh"],
	["text/x-script.tcl", "tcl"],
	["text/x-script.tcsh", "tcsh"],
	["text/x-script.zsh", "zsh"],
	["text/x-server-parsed-html", ["shtml", "ssi"]],
	["text/x-setext", "etx"],
	["text/x-sgml", ["sgm", "sgml"]],
	["text/x-speech", ["spc", "talk"]],
	["text/x-uil", "uil"],
	["text/x-uuencode", ["uu", "uue"]],
	["text/x-vcalendar", "vcs"],
	["text/x-vcard", "vcf"],
	["text/xml", "xml"],
	["video/3gpp", "3gp"],
	["video/3gpp2", "3g2"],
	["video/animaflex", "afl"],
	["video/avi", "avi"],
	["video/avs-video", "avs"],
	["video/dl", "dl"],
	["video/fli", "fli"],
	["video/gl", "gl"],
	["video/h261", "h261"],
	["video/h263", "h263"],
	["video/h264", "h264"],
	["video/jpeg", "jpgv"],
	["video/jpm", "jpm"],
	["video/mj2", "mj2"],
	["video/mp4", "mp4"],
	["video/mpeg", [
		"mpeg",
		"mp2",
		"mpa",
		"mpe",
		"mpg",
		"mpv2",
		"m1v",
		"m2v",
		"mp3"
	]],
	["video/msvideo", "avi"],
	["video/ogg", "ogv"],
	["video/quicktime", [
		"mov",
		"qt",
		"moov"
	]],
	["video/vdo", "vdo"],
	["video/vivo", ["viv", "vivo"]],
	["video/vnd.dece.hd", "uvh"],
	["video/vnd.dece.mobile", "uvm"],
	["video/vnd.dece.pd", "uvp"],
	["video/vnd.dece.sd", "uvs"],
	["video/vnd.dece.video", "uvv"],
	["video/vnd.fvt", "fvt"],
	["video/vnd.mpegurl", "mxu"],
	["video/vnd.ms-playready.media.pyv", "pyv"],
	["video/vnd.rn-realvideo", "rv"],
	["video/vnd.uvvu.mp4", "uvu"],
	["video/vnd.vivo", ["viv", "vivo"]],
	["video/vosaic", "vos"],
	["video/webm", "webm"],
	["video/x-amt-demorun", "xdr"],
	["video/x-amt-showrun", "xsr"],
	["video/x-atomic3d-feature", "fmf"],
	["video/x-dl", "dl"],
	["video/x-dv", ["dif", "dv"]],
	["video/x-f4v", "f4v"],
	["video/x-fli", "fli"],
	["video/x-flv", "flv"],
	["video/x-gl", "gl"],
	["video/x-isvideo", "isu"],
	["video/x-la-asf", ["lsf", "lsx"]],
	["video/x-m4v", "m4v"],
	["video/x-motion-jpeg", "mjpg"],
	["video/x-mpeg", ["mp3", "mp2"]],
	["video/x-mpeq2a", "mp2"],
	["video/x-ms-asf", [
		"asf",
		"asr",
		"asx"
	]],
	["video/x-ms-asf-plugin", "asx"],
	["video/x-ms-wm", "wm"],
	["video/x-ms-wmv", "wmv"],
	["video/x-ms-wmx", "wmx"],
	["video/x-ms-wvx", "wvx"],
	["video/x-msvideo", "avi"],
	["video/x-qtc", "qtc"],
	["video/x-scm", "scm"],
	["video/x-sgi-movie", ["movie", "mv"]],
	["windows/metafile", "wmf"],
	["www/mime", "mime"],
	["x-conference/x-cooltalk", "ice"],
	["x-music/x-midi", ["mid", "midi"]],
	["x-world/x-3dmf", [
		"3dm",
		"3dmf",
		"qd3",
		"qd3d"
	]],
	["x-world/x-svr", "svr"],
	["x-world/x-vrml", [
		"flr",
		"vrml",
		"wrl",
		"wrz",
		"xaf",
		"xof"
	]],
	["x-world/x-vrt", "vrt"],
	["xgl/drawing", "xgz"],
	["xgl/movie", "xmz"]
]);
const extensions = /* @__PURE__ */ new Map([
	["123", "application/vnd.lotus-1-2-3"],
	["323", "text/h323"],
	["*", "application/octet-stream"],
	["3dm", "x-world/x-3dmf"],
	["3dmf", "x-world/x-3dmf"],
	["3dml", "text/vnd.in3d.3dml"],
	["3g2", "video/3gpp2"],
	["3gp", "video/3gpp"],
	["7z", "application/x-7z-compressed"],
	["a", "application/octet-stream"],
	["aab", "application/x-authorware-bin"],
	["aac", "audio/x-aac"],
	["aam", "application/x-authorware-map"],
	["aas", "application/x-authorware-seg"],
	["abc", "text/vnd.abc"],
	["abw", "application/x-abiword"],
	["ac", "application/pkix-attr-cert"],
	["acc", "application/vnd.americandynamics.acc"],
	["ace", "application/x-ace-compressed"],
	["acgi", "text/html"],
	["acu", "application/vnd.acucobol"],
	["acx", "application/internet-property-stream"],
	["adp", "audio/adpcm"],
	["aep", "application/vnd.audiograph"],
	["afl", "video/animaflex"],
	["afp", "application/vnd.ibm.modcap"],
	["ahead", "application/vnd.ahead.space"],
	["ai", "application/postscript"],
	["aif", ["audio/aiff", "audio/x-aiff"]],
	["aifc", ["audio/aiff", "audio/x-aiff"]],
	["aiff", ["audio/aiff", "audio/x-aiff"]],
	["aim", "application/x-aim"],
	["aip", "text/x-audiosoft-intra"],
	["air", "application/vnd.adobe.air-application-installer-package+zip"],
	["ait", "application/vnd.dvb.ait"],
	["ami", "application/vnd.amiga.ami"],
	["ani", "application/x-navi-animation"],
	["aos", "application/x-nokia-9000-communicator-add-on-software"],
	["apk", "application/vnd.android.package-archive"],
	["application", "application/x-ms-application"],
	["apr", "application/vnd.lotus-approach"],
	["aps", "application/mime"],
	["arc", "application/octet-stream"],
	["arj", ["application/arj", "application/octet-stream"]],
	["art", "image/x-jg"],
	["asf", "video/x-ms-asf"],
	["asm", "text/x-asm"],
	["aso", "application/vnd.accpac.simply.aso"],
	["asp", "text/asp"],
	["asr", "video/x-ms-asf"],
	["asx", [
		"video/x-ms-asf",
		"application/x-mplayer2",
		"video/x-ms-asf-plugin"
	]],
	["atc", "application/vnd.acucorp"],
	["atomcat", "application/atomcat+xml"],
	["atomsvc", "application/atomsvc+xml"],
	["atx", "application/vnd.antix.game-component"],
	["au", ["audio/basic", "audio/x-au"]],
	["avi", [
		"video/avi",
		"video/msvideo",
		"application/x-troff-msvideo",
		"video/x-msvideo"
	]],
	["avs", "video/avs-video"],
	["aw", "application/applixware"],
	["axs", "application/olescript"],
	["azf", "application/vnd.airzip.filesecure.azf"],
	["azs", "application/vnd.airzip.filesecure.azs"],
	["azw", "application/vnd.amazon.ebook"],
	["bas", "text/plain"],
	["bcpio", "application/x-bcpio"],
	["bdf", "application/x-font-bdf"],
	["bdm", "application/vnd.syncml.dm+wbxml"],
	["bed", "application/vnd.realvnc.bed"],
	["bh2", "application/vnd.fujitsu.oasysprs"],
	["bin", [
		"application/octet-stream",
		"application/mac-binary",
		"application/macbinary",
		"application/x-macbinary",
		"application/x-binary"
	]],
	["bm", "image/bmp"],
	["bmi", "application/vnd.bmi"],
	["bmp", ["image/bmp", "image/x-windows-bmp"]],
	["boo", "application/book"],
	["book", "application/book"],
	["box", "application/vnd.previewsystems.box"],
	["boz", "application/x-bzip2"],
	["bsh", "application/x-bsh"],
	["btif", "image/prs.btif"],
	["bz", "application/x-bzip"],
	["bz2", "application/x-bzip2"],
	["c", ["text/plain", "text/x-c"]],
	["c++", "text/plain"],
	["c11amc", "application/vnd.cluetrust.cartomobile-config"],
	["c11amz", "application/vnd.cluetrust.cartomobile-config-pkg"],
	["c4g", "application/vnd.clonk.c4group"],
	["cab", "application/vnd.ms-cab-compressed"],
	["car", "application/vnd.curl.car"],
	["cat", ["application/vnd.ms-pkiseccat", "application/vnd.ms-pki.seccat"]],
	["cc", ["text/plain", "text/x-c"]],
	["ccad", "application/clariscad"],
	["cco", "application/x-cocoa"],
	["ccxml", "application/ccxml+xml,"],
	["cdbcmsg", "application/vnd.contact.cmsg"],
	["cdf", [
		"application/cdf",
		"application/x-cdf",
		"application/x-netcdf"
	]],
	["cdkey", "application/vnd.mediastation.cdkey"],
	["cdmia", "application/cdmi-capability"],
	["cdmic", "application/cdmi-container"],
	["cdmid", "application/cdmi-domain"],
	["cdmio", "application/cdmi-object"],
	["cdmiq", "application/cdmi-queue"],
	["cdx", "chemical/x-cdx"],
	["cdxml", "application/vnd.chemdraw+xml"],
	["cdy", "application/vnd.cinderella"],
	["cer", ["application/pkix-cert", "application/x-x509-ca-cert"]],
	["cgm", "image/cgm"],
	["cha", "application/x-chat"],
	["chat", "application/x-chat"],
	["chm", "application/vnd.ms-htmlhelp"],
	["chrt", "application/vnd.kde.kchart"],
	["cif", "chemical/x-cif"],
	["cii", "application/vnd.anser-web-certificate-issue-initiation"],
	["cil", "application/vnd.ms-artgalry"],
	["cla", "application/vnd.claymore"],
	["class", [
		"application/octet-stream",
		"application/java",
		"application/java-byte-code",
		"application/java-vm",
		"application/x-java-class"
	]],
	["clkk", "application/vnd.crick.clicker.keyboard"],
	["clkp", "application/vnd.crick.clicker.palette"],
	["clkt", "application/vnd.crick.clicker.template"],
	["clkw", "application/vnd.crick.clicker.wordbank"],
	["clkx", "application/vnd.crick.clicker"],
	["clp", "application/x-msclip"],
	["cmc", "application/vnd.cosmocaller"],
	["cmdf", "chemical/x-cmdf"],
	["cml", "chemical/x-cml"],
	["cmp", "application/vnd.yellowriver-custom-menu"],
	["cmx", "image/x-cmx"],
	["cod", ["image/cis-cod", "application/vnd.rim.cod"]],
	["com", ["application/octet-stream", "text/plain"]],
	["conf", "text/plain"],
	["cpio", "application/x-cpio"],
	["cpp", "text/x-c"],
	["cpt", [
		"application/mac-compactpro",
		"application/x-compactpro",
		"application/x-cpt"
	]],
	["crd", "application/x-mscardfile"],
	["crl", ["application/pkix-crl", "application/pkcs-crl"]],
	["crt", [
		"application/pkix-cert",
		"application/x-x509-user-cert",
		"application/x-x509-ca-cert"
	]],
	["cryptonote", "application/vnd.rig.cryptonote"],
	["csh", ["text/x-script.csh", "application/x-csh"]],
	["csml", "chemical/x-csml"],
	["csp", "application/vnd.commonspace"],
	["css", ["text/css", "application/x-pointplus"]],
	["csv", "text/csv"],
	["cu", "application/cu-seeme"],
	["curl", "text/vnd.curl"],
	["cww", "application/prs.cww"],
	["cxx", "text/plain"],
	["dae", "model/vnd.collada+xml"],
	["daf", "application/vnd.mobius.daf"],
	["davmount", "application/davmount+xml"],
	["dcr", "application/x-director"],
	["dcurl", "text/vnd.curl.dcurl"],
	["dd2", "application/vnd.oma.dd2+xml"],
	["ddd", "application/vnd.fujixerox.ddd"],
	["deb", "application/x-debian-package"],
	["deepv", "application/x-deepv"],
	["def", "text/plain"],
	["der", "application/x-x509-ca-cert"],
	["dfac", "application/vnd.dreamfactory"],
	["dif", "video/x-dv"],
	["dir", "application/x-director"],
	["dis", "application/vnd.mobius.dis"],
	["djvu", "image/vnd.djvu"],
	["dl", ["video/dl", "video/x-dl"]],
	["dll", "application/x-msdownload"],
	["dms", "application/octet-stream"],
	["dna", "application/vnd.dna"],
	["doc", "application/msword"],
	["docm", "application/vnd.ms-word.document.macroenabled.12"],
	["docx", "application/vnd.openxmlformats-officedocument.wordprocessingml.document"],
	["dot", "application/msword"],
	["dotm", "application/vnd.ms-word.template.macroenabled.12"],
	["dotx", "application/vnd.openxmlformats-officedocument.wordprocessingml.template"],
	["dp", ["application/commonground", "application/vnd.osgi.dp"]],
	["dpg", "application/vnd.dpgraph"],
	["dra", "audio/vnd.dra"],
	["drw", "application/drafting"],
	["dsc", "text/prs.lines.tag"],
	["dssc", "application/dssc+der"],
	["dtb", "application/x-dtbook+xml"],
	["dtd", "application/xml-dtd"],
	["dts", "audio/vnd.dts"],
	["dtshd", "audio/vnd.dts.hd"],
	["dump", "application/octet-stream"],
	["dv", "video/x-dv"],
	["dvi", "application/x-dvi"],
	["dwf", ["model/vnd.dwf", "drawing/x-dwf"]],
	["dwg", [
		"application/acad",
		"image/vnd.dwg",
		"image/x-dwg"
	]],
	["dxf", [
		"application/dxf",
		"image/vnd.dwg",
		"image/vnd.dxf",
		"image/x-dwg"
	]],
	["dxp", "application/vnd.spotfire.dxp"],
	["dxr", "application/x-director"],
	["ecelp4800", "audio/vnd.nuera.ecelp4800"],
	["ecelp7470", "audio/vnd.nuera.ecelp7470"],
	["ecelp9600", "audio/vnd.nuera.ecelp9600"],
	["edm", "application/vnd.novadigm.edm"],
	["edx", "application/vnd.novadigm.edx"],
	["efif", "application/vnd.picsel"],
	["ei6", "application/vnd.pg.osasli"],
	["el", "text/x-script.elisp"],
	["elc", ["application/x-elc", "application/x-bytecode.elisp"]],
	["eml", "message/rfc822"],
	["emma", "application/emma+xml"],
	["env", "application/x-envoy"],
	["eol", "audio/vnd.digital-winds"],
	["eot", "application/vnd.ms-fontobject"],
	["eps", "application/postscript"],
	["epub", "application/epub+zip"],
	["es", ["application/ecmascript", "application/x-esrehber"]],
	["es3", "application/vnd.eszigno3+xml"],
	["esf", "application/vnd.epson.esf"],
	["etx", "text/x-setext"],
	["evy", ["application/envoy", "application/x-envoy"]],
	["exe", ["application/octet-stream", "application/x-msdownload"]],
	["exi", "application/exi"],
	["ext", "application/vnd.novadigm.ext"],
	["ez2", "application/vnd.ezpix-album"],
	["ez3", "application/vnd.ezpix-package"],
	["f", ["text/plain", "text/x-fortran"]],
	["f4v", "video/x-f4v"],
	["f77", "text/x-fortran"],
	["f90", ["text/plain", "text/x-fortran"]],
	["fbs", "image/vnd.fastbidsheet"],
	["fcs", "application/vnd.isac.fcs"],
	["fdf", "application/vnd.fdf"],
	["fe_launch", "application/vnd.denovo.fcselayout-link"],
	["fg5", "application/vnd.fujitsu.oasysgp"],
	["fh", "image/x-freehand"],
	["fif", ["application/fractals", "image/fif"]],
	["fig", "application/x-xfig"],
	["fli", ["video/fli", "video/x-fli"]],
	["flo", ["image/florian", "application/vnd.micrografx.flo"]],
	["flr", "x-world/x-vrml"],
	["flv", "video/x-flv"],
	["flw", "application/vnd.kde.kivio"],
	["flx", "text/vnd.fmi.flexstor"],
	["fly", "text/vnd.fly"],
	["fm", "application/vnd.framemaker"],
	["fmf", "video/x-atomic3d-feature"],
	["fnc", "application/vnd.frogans.fnc"],
	["for", ["text/plain", "text/x-fortran"]],
	["fpx", ["image/vnd.fpx", "image/vnd.net-fpx"]],
	["frl", "application/freeloader"],
	["fsc", "application/vnd.fsc.weblaunch"],
	["fst", "image/vnd.fst"],
	["ftc", "application/vnd.fluxtime.clip"],
	["fti", "application/vnd.anser-web-funds-transfer-initiation"],
	["funk", "audio/make"],
	["fvt", "video/vnd.fvt"],
	["fxp", "application/vnd.adobe.fxp"],
	["fzs", "application/vnd.fuzzysheet"],
	["g", "text/plain"],
	["g2w", "application/vnd.geoplan"],
	["g3", "image/g3fax"],
	["g3w", "application/vnd.geospace"],
	["gac", "application/vnd.groove-account"],
	["gdl", "model/vnd.gdl"],
	["geo", "application/vnd.dynageo"],
	["geojson", "application/geo+json"],
	["gex", "application/vnd.geometry-explorer"],
	["ggb", "application/vnd.geogebra.file"],
	["ggt", "application/vnd.geogebra.tool"],
	["ghf", "application/vnd.groove-help"],
	["gif", "image/gif"],
	["gim", "application/vnd.groove-identity-message"],
	["gl", ["video/gl", "video/x-gl"]],
	["gmx", "application/vnd.gmx"],
	["gnumeric", "application/x-gnumeric"],
	["gph", "application/vnd.flographit"],
	["gqf", "application/vnd.grafeq"],
	["gram", "application/srgs"],
	["grv", "application/vnd.groove-injector"],
	["grxml", "application/srgs+xml"],
	["gsd", "audio/x-gsm"],
	["gsf", "application/x-font-ghostscript"],
	["gsm", "audio/x-gsm"],
	["gsp", "application/x-gsp"],
	["gss", "application/x-gss"],
	["gtar", "application/x-gtar"],
	["gtm", "application/vnd.groove-tool-message"],
	["gtw", "model/vnd.gtw"],
	["gv", "text/vnd.graphviz"],
	["gxt", "application/vnd.geonext"],
	["gz", ["application/x-gzip", "application/x-compressed"]],
	["gzip", ["multipart/x-gzip", "application/x-gzip"]],
	["h", ["text/plain", "text/x-h"]],
	["h261", "video/h261"],
	["h263", "video/h263"],
	["h264", "video/h264"],
	["hal", "application/vnd.hal+xml"],
	["hbci", "application/vnd.hbci"],
	["hdf", "application/x-hdf"],
	["help", "application/x-helpfile"],
	["hgl", "application/vnd.hp-hpgl"],
	["hh", ["text/plain", "text/x-h"]],
	["hlb", "text/x-script"],
	["hlp", [
		"application/winhlp",
		"application/hlp",
		"application/x-helpfile",
		"application/x-winhelp"
	]],
	["hpg", "application/vnd.hp-hpgl"],
	["hpgl", "application/vnd.hp-hpgl"],
	["hpid", "application/vnd.hp-hpid"],
	["hps", "application/vnd.hp-hps"],
	["hqx", [
		"application/mac-binhex40",
		"application/binhex",
		"application/binhex4",
		"application/mac-binhex",
		"application/x-binhex40",
		"application/x-mac-binhex40"
	]],
	["hta", "application/hta"],
	["htc", "text/x-component"],
	["htke", "application/vnd.kenameaapp"],
	["htm", "text/html"],
	["html", "text/html"],
	["htmls", "text/html"],
	["htt", "text/webviewhtml"],
	["htx", "text/html"],
	["hvd", "application/vnd.yamaha.hv-dic"],
	["hvp", "application/vnd.yamaha.hv-voice"],
	["hvs", "application/vnd.yamaha.hv-script"],
	["i2g", "application/vnd.intergeo"],
	["icc", "application/vnd.iccprofile"],
	["ice", "x-conference/x-cooltalk"],
	["ico", "image/x-icon"],
	["ics", "text/calendar"],
	["idc", "text/plain"],
	["ief", "image/ief"],
	["iefs", "image/ief"],
	["ifm", "application/vnd.shana.informed.formdata"],
	["iges", ["application/iges", "model/iges"]],
	["igl", "application/vnd.igloader"],
	["igm", "application/vnd.insors.igm"],
	["igs", ["application/iges", "model/iges"]],
	["igx", "application/vnd.micrografx.igx"],
	["iif", "application/vnd.shana.informed.interchange"],
	["iii", "application/x-iphone"],
	["ima", "application/x-ima"],
	["imap", "application/x-httpd-imap"],
	["imp", "application/vnd.accpac.simply.imp"],
	["ims", "application/vnd.ms-ims"],
	["inf", "application/inf"],
	["ins", ["application/x-internet-signup", "application/x-internett-signup"]],
	["ip", "application/x-ip2"],
	["ipfix", "application/ipfix"],
	["ipk", "application/vnd.shana.informed.package"],
	["irm", "application/vnd.ibm.rights-management"],
	["irp", "application/vnd.irepository.package+xml"],
	["isp", "application/x-internet-signup"],
	["isu", "video/x-isvideo"],
	["it", "audio/it"],
	["itp", "application/vnd.shana.informed.formtemplate"],
	["iv", "application/x-inventor"],
	["ivp", "application/vnd.immervision-ivp"],
	["ivr", "i-world/i-vrml"],
	["ivu", "application/vnd.immervision-ivu"],
	["ivy", "application/x-livescreen"],
	["jad", "text/vnd.sun.j2me.app-descriptor"],
	["jam", ["application/vnd.jam", "audio/x-jam"]],
	["jar", "application/java-archive"],
	["jav", ["text/plain", "text/x-java-source"]],
	["java", [
		"text/plain",
		"text/x-java-source,java",
		"text/x-java-source"
	]],
	["jcm", "application/x-java-commerce"],
	["jfif", [
		"image/pipeg",
		"image/jpeg",
		"image/pjpeg"
	]],
	["jfif-tbnl", "image/jpeg"],
	["jisp", "application/vnd.jisp"],
	["jlt", "application/vnd.hp-jlyt"],
	["jnlp", "application/x-java-jnlp-file"],
	["joda", "application/vnd.joost.joda-archive"],
	["jpe", ["image/jpeg", "image/pjpeg"]],
	["jpeg", ["image/jpeg", "image/pjpeg"]],
	["jpg", ["image/jpeg", "image/pjpeg"]],
	["jpgv", "video/jpeg"],
	["jpm", "video/jpm"],
	["jps", "image/x-jps"],
	["js", [
		"application/javascript",
		"application/ecmascript",
		"text/javascript",
		"text/ecmascript",
		"application/x-javascript"
	]],
	["json", "application/json"],
	["jut", "image/jutvision"],
	["kar", ["audio/midi", "music/x-karaoke"]],
	["karbon", "application/vnd.kde.karbon"],
	["kfo", "application/vnd.kde.kformula"],
	["kia", "application/vnd.kidspiration"],
	["kml", "application/vnd.google-earth.kml+xml"],
	["kmz", "application/vnd.google-earth.kmz"],
	["kne", "application/vnd.kinar"],
	["kon", "application/vnd.kde.kontour"],
	["kpr", "application/vnd.kde.kpresenter"],
	["ksh", ["application/x-ksh", "text/x-script.ksh"]],
	["ksp", "application/vnd.kde.kspread"],
	["ktx", "image/ktx"],
	["ktz", "application/vnd.kahootz"],
	["kwd", "application/vnd.kde.kword"],
	["la", ["audio/nspaudio", "audio/x-nspaudio"]],
	["lam", "audio/x-liveaudio"],
	["lasxml", "application/vnd.las.las+xml"],
	["latex", "application/x-latex"],
	["lbd", "application/vnd.llamagraphics.life-balance.desktop"],
	["lbe", "application/vnd.llamagraphics.life-balance.exchange+xml"],
	["les", "application/vnd.hhe.lesson-player"],
	["lha", [
		"application/octet-stream",
		"application/lha",
		"application/x-lha"
	]],
	["lhx", "application/octet-stream"],
	["link66", "application/vnd.route66.link66+xml"],
	["list", "text/plain"],
	["lma", ["audio/nspaudio", "audio/x-nspaudio"]],
	["log", "text/plain"],
	["lrm", "application/vnd.ms-lrm"],
	["lsf", "video/x-la-asf"],
	["lsp", ["application/x-lisp", "text/x-script.lisp"]],
	["lst", "text/plain"],
	["lsx", ["video/x-la-asf", "text/x-la-asf"]],
	["ltf", "application/vnd.frogans.ltf"],
	["ltx", "application/x-latex"],
	["lvp", "audio/vnd.lucent.voice"],
	["lwp", "application/vnd.lotus-wordpro"],
	["lzh", ["application/octet-stream", "application/x-lzh"]],
	["lzx", [
		"application/lzx",
		"application/octet-stream",
		"application/x-lzx"
	]],
	["m", ["text/plain", "text/x-m"]],
	["m13", "application/x-msmediaview"],
	["m14", "application/x-msmediaview"],
	["m1v", "video/mpeg"],
	["m21", "application/mp21"],
	["m2a", "audio/mpeg"],
	["m2v", "video/mpeg"],
	["m3u", ["audio/x-mpegurl", "audio/x-mpequrl"]],
	["m3u8", "application/vnd.apple.mpegurl"],
	["m4v", "video/x-m4v"],
	["ma", "application/mathematica"],
	["mads", "application/mads+xml"],
	["mag", "application/vnd.ecowin.chart"],
	["man", "application/x-troff-man"],
	["map", "application/x-navimap"],
	["mar", "text/plain"],
	["mathml", "application/mathml+xml"],
	["mbd", "application/mbedlet"],
	["mbk", "application/vnd.mobius.mbk"],
	["mbox", "application/mbox"],
	["mc$", "application/x-magic-cap-package-1.0"],
	["mc1", "application/vnd.medcalcdata"],
	["mcd", [
		"application/mcad",
		"application/vnd.mcd",
		"application/x-mathcad"
	]],
	["mcf", ["image/vasa", "text/mcf"]],
	["mcp", "application/netmc"],
	["mcurl", "text/vnd.curl.mcurl"],
	["mdb", "application/x-msaccess"],
	["mdi", "image/vnd.ms-modi"],
	["me", "application/x-troff-me"],
	["meta4", "application/metalink4+xml"],
	["mets", "application/mets+xml"],
	["mfm", "application/vnd.mfmp"],
	["mgp", "application/vnd.osgeo.mapguide.package"],
	["mgz", "application/vnd.proteus.magazine"],
	["mht", "message/rfc822"],
	["mhtml", "message/rfc822"],
	["mid", [
		"audio/mid",
		"audio/midi",
		"music/crescendo",
		"x-music/x-midi",
		"audio/x-midi",
		"application/x-midi",
		"audio/x-mid"
	]],
	["midi", [
		"audio/midi",
		"music/crescendo",
		"x-music/x-midi",
		"audio/x-midi",
		"application/x-midi",
		"audio/x-mid"
	]],
	["mif", [
		"application/vnd.mif",
		"application/x-mif",
		"application/x-frame"
	]],
	["mime", ["message/rfc822", "www/mime"]],
	["mj2", "video/mj2"],
	["mjf", "audio/x-vnd.audioexplosion.mjuicemediafile"],
	["mjpg", "video/x-motion-jpeg"],
	["mlp", "application/vnd.dolby.mlp"],
	["mm", ["application/base64", "application/x-meme"]],
	["mmd", "application/vnd.chipnuts.karaoke-mmd"],
	["mme", "application/base64"],
	["mmf", "application/vnd.smaf"],
	["mmr", "image/vnd.fujixerox.edmics-mmr"],
	["mny", "application/x-msmoney"],
	["mod", ["audio/mod", "audio/x-mod"]],
	["mods", "application/mods+xml"],
	["moov", "video/quicktime"],
	["mov", "video/quicktime"],
	["movie", "video/x-sgi-movie"],
	["mp2", [
		"video/mpeg",
		"audio/mpeg",
		"video/x-mpeg",
		"audio/x-mpeg",
		"video/x-mpeq2a"
	]],
	["mp3", [
		"audio/mpeg",
		"audio/mpeg3",
		"video/mpeg",
		"audio/x-mpeg-3",
		"video/x-mpeg"
	]],
	["mp4", ["video/mp4", "application/mp4"]],
	["mp4a", "audio/mp4"],
	["mpa", ["video/mpeg", "audio/mpeg"]],
	["mpc", ["application/vnd.mophun.certificate", "application/x-project"]],
	["mpe", "video/mpeg"],
	["mpeg", "video/mpeg"],
	["mpg", ["video/mpeg", "audio/mpeg"]],
	["mpga", "audio/mpeg"],
	["mpkg", "application/vnd.apple.installer+xml"],
	["mpm", "application/vnd.blueice.multipass"],
	["mpn", "application/vnd.mophun.application"],
	["mpp", "application/vnd.ms-project"],
	["mpt", "application/x-project"],
	["mpv", "application/x-project"],
	["mpv2", "video/mpeg"],
	["mpx", "application/x-project"],
	["mpy", "application/vnd.ibm.minipay"],
	["mqy", "application/vnd.mobius.mqy"],
	["mrc", "application/marc"],
	["mrcx", "application/marcxml+xml"],
	["ms", "application/x-troff-ms"],
	["mscml", "application/mediaservercontrol+xml"],
	["mseq", "application/vnd.mseq"],
	["msf", "application/vnd.epson.msf"],
	["msg", "application/vnd.ms-outlook"],
	["msh", "model/mesh"],
	["msl", "application/vnd.mobius.msl"],
	["msty", "application/vnd.muvee.style"],
	["mts", "model/vnd.mts"],
	["mus", "application/vnd.musician"],
	["musicxml", "application/vnd.recordare.musicxml+xml"],
	["mv", "video/x-sgi-movie"],
	["mvb", "application/x-msmediaview"],
	["mwf", "application/vnd.mfer"],
	["mxf", "application/mxf"],
	["mxl", "application/vnd.recordare.musicxml"],
	["mxml", "application/xv+xml"],
	["mxs", "application/vnd.triscape.mxs"],
	["mxu", "video/vnd.mpegurl"],
	["my", "audio/make"],
	["mzz", "application/x-vnd.audioexplosion.mzz"],
	["n-gage", "application/vnd.nokia.n-gage.symbian.install"],
	["n3", "text/n3"],
	["nap", "image/naplps"],
	["naplps", "image/naplps"],
	["nbp", "application/vnd.wolfram.player"],
	["nc", "application/x-netcdf"],
	["ncm", "application/vnd.nokia.configuration-message"],
	["ncx", "application/x-dtbncx+xml"],
	["ngdat", "application/vnd.nokia.n-gage.data"],
	["nif", "image/x-niff"],
	["niff", "image/x-niff"],
	["nix", "application/x-mix-transfer"],
	["nlu", "application/vnd.neurolanguage.nlu"],
	["nml", "application/vnd.enliven"],
	["nnd", "application/vnd.noblenet-directory"],
	["nns", "application/vnd.noblenet-sealer"],
	["nnw", "application/vnd.noblenet-web"],
	["npx", "image/vnd.net-fpx"],
	["nsc", "application/x-conference"],
	["nsf", "application/vnd.lotus-notes"],
	["nvd", "application/x-navidoc"],
	["nws", "message/rfc822"],
	["o", "application/octet-stream"],
	["oa2", "application/vnd.fujitsu.oasys2"],
	["oa3", "application/vnd.fujitsu.oasys3"],
	["oas", "application/vnd.fujitsu.oasys"],
	["obd", "application/x-msbinder"],
	["oda", "application/oda"],
	["odb", "application/vnd.oasis.opendocument.database"],
	["odc", "application/vnd.oasis.opendocument.chart"],
	["odf", "application/vnd.oasis.opendocument.formula"],
	["odft", "application/vnd.oasis.opendocument.formula-template"],
	["odg", "application/vnd.oasis.opendocument.graphics"],
	["odi", "application/vnd.oasis.opendocument.image"],
	["odm", "application/vnd.oasis.opendocument.text-master"],
	["odp", "application/vnd.oasis.opendocument.presentation"],
	["ods", "application/vnd.oasis.opendocument.spreadsheet"],
	["odt", "application/vnd.oasis.opendocument.text"],
	["oga", "audio/ogg"],
	["ogv", "video/ogg"],
	["ogx", "application/ogg"],
	["omc", "application/x-omc"],
	["omcd", "application/x-omcdatamaker"],
	["omcr", "application/x-omcregerator"],
	["onetoc", "application/onenote"],
	["opf", "application/oebps-package+xml"],
	["org", "application/vnd.lotus-organizer"],
	["osf", "application/vnd.yamaha.openscoreformat"],
	["osfpvg", "application/vnd.yamaha.openscoreformat.osfpvg+xml"],
	["otc", "application/vnd.oasis.opendocument.chart-template"],
	["otf", "application/x-font-otf"],
	["otg", "application/vnd.oasis.opendocument.graphics-template"],
	["oth", "application/vnd.oasis.opendocument.text-web"],
	["oti", "application/vnd.oasis.opendocument.image-template"],
	["otp", "application/vnd.oasis.opendocument.presentation-template"],
	["ots", "application/vnd.oasis.opendocument.spreadsheet-template"],
	["ott", "application/vnd.oasis.opendocument.text-template"],
	["oxt", "application/vnd.openofficeorg.extension"],
	["p", "text/x-pascal"],
	["p10", ["application/pkcs10", "application/x-pkcs10"]],
	["p12", ["application/pkcs-12", "application/x-pkcs12"]],
	["p7a", "application/x-pkcs7-signature"],
	["p7b", "application/x-pkcs7-certificates"],
	["p7c", ["application/pkcs7-mime", "application/x-pkcs7-mime"]],
	["p7m", ["application/pkcs7-mime", "application/x-pkcs7-mime"]],
	["p7r", "application/x-pkcs7-certreqresp"],
	["p7s", ["application/pkcs7-signature", "application/x-pkcs7-signature"]],
	["p8", "application/pkcs8"],
	["par", "text/plain-bas"],
	["part", "application/pro_eng"],
	["pas", "text/pascal"],
	["paw", "application/vnd.pawaafile"],
	["pbd", "application/vnd.powerbuilder6"],
	["pbm", "image/x-portable-bitmap"],
	["pcf", "application/x-font-pcf"],
	["pcl", ["application/vnd.hp-pcl", "application/x-pcl"]],
	["pclxl", "application/vnd.hp-pclxl"],
	["pct", "image/x-pict"],
	["pcurl", "application/vnd.curl.pcurl"],
	["pcx", "image/x-pcx"],
	["pdb", ["application/vnd.palm", "chemical/x-pdb"]],
	["pdf", "application/pdf"],
	["pfa", "application/x-font-type1"],
	["pfr", "application/font-tdpfr"],
	["pfunk", ["audio/make", "audio/make.my.funk"]],
	["pfx", "application/x-pkcs12"],
	["pgm", ["image/x-portable-graymap", "image/x-portable-greymap"]],
	["pgn", "application/x-chess-pgn"],
	["pgp", "application/pgp-signature"],
	["pic", ["image/pict", "image/x-pict"]],
	["pict", "image/pict"],
	["pkg", "application/x-newton-compatible-pkg"],
	["pki", "application/pkixcmp"],
	["pkipath", "application/pkix-pkipath"],
	["pko", ["application/ynd.ms-pkipko", "application/vnd.ms-pki.pko"]],
	["pl", ["text/plain", "text/x-script.perl"]],
	["plb", "application/vnd.3gpp.pic-bw-large"],
	["plc", "application/vnd.mobius.plc"],
	["plf", "application/vnd.pocketlearn"],
	["pls", "application/pls+xml"],
	["plx", "application/x-pixclscript"],
	["pm", ["text/x-script.perl-module", "image/x-xpixmap"]],
	["pm4", "application/x-pagemaker"],
	["pm5", "application/x-pagemaker"],
	["pma", "application/x-perfmon"],
	["pmc", "application/x-perfmon"],
	["pml", ["application/vnd.ctc-posml", "application/x-perfmon"]],
	["pmr", "application/x-perfmon"],
	["pmw", "application/x-perfmon"],
	["png", "image/png"],
	["pnm", ["application/x-portable-anymap", "image/x-portable-anymap"]],
	["portpkg", "application/vnd.macports.portpkg"],
	["pot", ["application/vnd.ms-powerpoint", "application/mspowerpoint"]],
	["potm", "application/vnd.ms-powerpoint.template.macroenabled.12"],
	["potx", "application/vnd.openxmlformats-officedocument.presentationml.template"],
	["pov", "model/x-pov"],
	["ppa", "application/vnd.ms-powerpoint"],
	["ppam", "application/vnd.ms-powerpoint.addin.macroenabled.12"],
	["ppd", "application/vnd.cups-ppd"],
	["ppm", "image/x-portable-pixmap"],
	["pps", ["application/vnd.ms-powerpoint", "application/mspowerpoint"]],
	["ppsm", "application/vnd.ms-powerpoint.slideshow.macroenabled.12"],
	["ppsx", "application/vnd.openxmlformats-officedocument.presentationml.slideshow"],
	["ppt", [
		"application/vnd.ms-powerpoint",
		"application/mspowerpoint",
		"application/powerpoint",
		"application/x-mspowerpoint"
	]],
	["pptm", "application/vnd.ms-powerpoint.presentation.macroenabled.12"],
	["pptx", "application/vnd.openxmlformats-officedocument.presentationml.presentation"],
	["ppz", "application/mspowerpoint"],
	["prc", "application/x-mobipocket-ebook"],
	["pre", ["application/vnd.lotus-freelance", "application/x-freelance"]],
	["prf", "application/pics-rules"],
	["prt", "application/pro_eng"],
	["ps", "application/postscript"],
	["psb", "application/vnd.3gpp.pic-bw-small"],
	["psd", ["application/octet-stream", "image/vnd.adobe.photoshop"]],
	["psf", "application/x-font-linux-psf"],
	["pskcxml", "application/pskc+xml"],
	["ptid", "application/vnd.pvi.ptid1"],
	["pub", "application/x-mspublisher"],
	["pvb", "application/vnd.3gpp.pic-bw-var"],
	["pvu", "paleovu/x-pv"],
	["pwn", "application/vnd.3m.post-it-notes"],
	["pwz", "application/vnd.ms-powerpoint"],
	["py", "text/x-script.phyton"],
	["pya", "audio/vnd.ms-playready.media.pya"],
	["pyc", "application/x-bytecode.python"],
	["pyv", "video/vnd.ms-playready.media.pyv"],
	["qam", "application/vnd.epson.quickanime"],
	["qbo", "application/vnd.intu.qbo"],
	["qcp", "audio/vnd.qcelp"],
	["qd3", "x-world/x-3dmf"],
	["qd3d", "x-world/x-3dmf"],
	["qfx", "application/vnd.intu.qfx"],
	["qif", "image/x-quicktime"],
	["qps", "application/vnd.publishare-delta-tree"],
	["qt", "video/quicktime"],
	["qtc", "video/x-qtc"],
	["qti", "image/x-quicktime"],
	["qtif", "image/x-quicktime"],
	["qxd", "application/vnd.quark.quarkxpress"],
	["ra", [
		"audio/x-realaudio",
		"audio/x-pn-realaudio",
		"audio/x-pn-realaudio-plugin"
	]],
	["ram", "audio/x-pn-realaudio"],
	["rar", "application/x-rar-compressed"],
	["ras", [
		"image/cmu-raster",
		"application/x-cmu-raster",
		"image/x-cmu-raster"
	]],
	["rast", "image/cmu-raster"],
	["rcprofile", "application/vnd.ipunplugged.rcprofile"],
	["rdf", "application/rdf+xml"],
	["rdz", "application/vnd.data-vision.rdz"],
	["rep", "application/vnd.businessobjects"],
	["res", "application/x-dtbresource+xml"],
	["rexx", "text/x-script.rexx"],
	["rf", "image/vnd.rn-realflash"],
	["rgb", "image/x-rgb"],
	["rif", "application/reginfo+xml"],
	["rip", "audio/vnd.rip"],
	["rl", "application/resource-lists+xml"],
	["rlc", "image/vnd.fujixerox.edmics-rlc"],
	["rld", "application/resource-lists-diff+xml"],
	["rm", ["application/vnd.rn-realmedia", "audio/x-pn-realaudio"]],
	["rmi", "audio/mid"],
	["rmm", "audio/x-pn-realaudio"],
	["rmp", ["audio/x-pn-realaudio-plugin", "audio/x-pn-realaudio"]],
	["rms", "application/vnd.jcp.javame.midlet-rms"],
	["rnc", "application/relax-ng-compact-syntax"],
	["rng", ["application/ringing-tones", "application/vnd.nokia.ringing-tone"]],
	["rnx", "application/vnd.rn-realplayer"],
	["roff", "application/x-troff"],
	["rp", "image/vnd.rn-realpix"],
	["rp9", "application/vnd.cloanto.rp9"],
	["rpm", "audio/x-pn-realaudio-plugin"],
	["rpss", "application/vnd.nokia.radio-presets"],
	["rpst", "application/vnd.nokia.radio-preset"],
	["rq", "application/sparql-query"],
	["rs", "application/rls-services+xml"],
	["rsd", "application/rsd+xml"],
	["rt", ["text/richtext", "text/vnd.rn-realtext"]],
	["rtf", [
		"application/rtf",
		"text/richtext",
		"application/x-rtf"
	]],
	["rtx", ["text/richtext", "application/rtf"]],
	["rv", "video/vnd.rn-realvideo"],
	["s", "text/x-asm"],
	["s3m", "audio/s3m"],
	["saf", "application/vnd.yamaha.smaf-audio"],
	["saveme", "application/octet-stream"],
	["sbk", "application/x-tbook"],
	["sbml", "application/sbml+xml"],
	["sc", "application/vnd.ibm.secure-container"],
	["scd", "application/x-msschedule"],
	["scm", [
		"application/vnd.lotus-screencam",
		"video/x-scm",
		"text/x-script.guile",
		"application/x-lotusscreencam",
		"text/x-script.scheme"
	]],
	["scq", "application/scvp-cv-request"],
	["scs", "application/scvp-cv-response"],
	["sct", "text/scriptlet"],
	["scurl", "text/vnd.curl.scurl"],
	["sda", "application/vnd.stardivision.draw"],
	["sdc", "application/vnd.stardivision.calc"],
	["sdd", "application/vnd.stardivision.impress"],
	["sdkm", "application/vnd.solent.sdkm+xml"],
	["sdml", "text/plain"],
	["sdp", ["application/sdp", "application/x-sdp"]],
	["sdr", "application/sounder"],
	["sdw", "application/vnd.stardivision.writer"],
	["sea", ["application/sea", "application/x-sea"]],
	["see", "application/vnd.seemail"],
	["seed", "application/vnd.fdsn.seed"],
	["sema", "application/vnd.sema"],
	["semd", "application/vnd.semd"],
	["semf", "application/vnd.semf"],
	["ser", "application/java-serialized-object"],
	["set", "application/set"],
	["setpay", "application/set-payment-initiation"],
	["setreg", "application/set-registration-initiation"],
	["sfd-hdstx", "application/vnd.hydrostatix.sof-data"],
	["sfs", "application/vnd.spotfire.sfs"],
	["sgl", "application/vnd.stardivision.writer-global"],
	["sgm", ["text/sgml", "text/x-sgml"]],
	["sgml", ["text/sgml", "text/x-sgml"]],
	["sh", [
		"application/x-shar",
		"application/x-bsh",
		"application/x-sh",
		"text/x-script.sh"
	]],
	["shar", ["application/x-bsh", "application/x-shar"]],
	["shf", "application/shf+xml"],
	["shtml", ["text/html", "text/x-server-parsed-html"]],
	["sid", "audio/x-psid"],
	["sis", "application/vnd.symbian.install"],
	["sit", ["application/x-stuffit", "application/x-sit"]],
	["sitx", "application/x-stuffitx"],
	["skd", "application/x-koan"],
	["skm", "application/x-koan"],
	["skp", ["application/vnd.koan", "application/x-koan"]],
	["skt", "application/x-koan"],
	["sl", "application/x-seelogo"],
	["sldm", "application/vnd.ms-powerpoint.slide.macroenabled.12"],
	["sldx", "application/vnd.openxmlformats-officedocument.presentationml.slide"],
	["slt", "application/vnd.epson.salt"],
	["sm", "application/vnd.stepmania.stepchart"],
	["smf", "application/vnd.stardivision.math"],
	["smi", ["application/smil", "application/smil+xml"]],
	["smil", "application/smil"],
	["snd", ["audio/basic", "audio/x-adpcm"]],
	["snf", "application/x-font-snf"],
	["sol", "application/solids"],
	["spc", ["text/x-speech", "application/x-pkcs7-certificates"]],
	["spf", "application/vnd.yamaha.smaf-phrase"],
	["spl", ["application/futuresplash", "application/x-futuresplash"]],
	["spot", "text/vnd.in3d.spot"],
	["spp", "application/scvp-vp-response"],
	["spq", "application/scvp-vp-request"],
	["spr", "application/x-sprite"],
	["sprite", "application/x-sprite"],
	["src", "application/x-wais-source"],
	["sru", "application/sru+xml"],
	["srx", "application/sparql-results+xml"],
	["sse", "application/vnd.kodak-descriptor"],
	["ssf", "application/vnd.epson.ssf"],
	["ssi", "text/x-server-parsed-html"],
	["ssm", "application/streamingmedia"],
	["ssml", "application/ssml+xml"],
	["sst", ["application/vnd.ms-pkicertstore", "application/vnd.ms-pki.certstore"]],
	["st", "application/vnd.sailingtracker.track"],
	["stc", "application/vnd.sun.xml.calc.template"],
	["std", "application/vnd.sun.xml.draw.template"],
	["step", "application/step"],
	["stf", "application/vnd.wt.stf"],
	["sti", "application/vnd.sun.xml.impress.template"],
	["stk", "application/hyperstudio"],
	["stl", [
		"application/vnd.ms-pkistl",
		"application/sla",
		"application/vnd.ms-pki.stl",
		"application/x-navistyle"
	]],
	["stm", "text/html"],
	["stp", "application/step"],
	["str", "application/vnd.pg.format"],
	["stw", "application/vnd.sun.xml.writer.template"],
	["sub", "image/vnd.dvb.subtitle"],
	["sus", "application/vnd.sus-calendar"],
	["sv4cpio", "application/x-sv4cpio"],
	["sv4crc", "application/x-sv4crc"],
	["svc", "application/vnd.dvb.service"],
	["svd", "application/vnd.svd"],
	["svf", ["image/vnd.dwg", "image/x-dwg"]],
	["svg", "image/svg+xml"],
	["svr", ["x-world/x-svr", "application/x-world"]],
	["swf", "application/x-shockwave-flash"],
	["swi", "application/vnd.aristanetworks.swi"],
	["sxc", "application/vnd.sun.xml.calc"],
	["sxd", "application/vnd.sun.xml.draw"],
	["sxg", "application/vnd.sun.xml.writer.global"],
	["sxi", "application/vnd.sun.xml.impress"],
	["sxm", "application/vnd.sun.xml.math"],
	["sxw", "application/vnd.sun.xml.writer"],
	["t", ["text/troff", "application/x-troff"]],
	["talk", "text/x-speech"],
	["tao", "application/vnd.tao.intent-module-archive"],
	["tar", "application/x-tar"],
	["tbk", ["application/toolbook", "application/x-tbook"]],
	["tcap", "application/vnd.3gpp2.tcap"],
	["tcl", ["text/x-script.tcl", "application/x-tcl"]],
	["tcsh", "text/x-script.tcsh"],
	["teacher", "application/vnd.smart.teacher"],
	["tei", "application/tei+xml"],
	["tex", "application/x-tex"],
	["texi", "application/x-texinfo"],
	["texinfo", "application/x-texinfo"],
	["text", ["application/plain", "text/plain"]],
	["tfi", "application/thraud+xml"],
	["tfm", "application/x-tex-tfm"],
	["tgz", ["application/gnutar", "application/x-compressed"]],
	["thmx", "application/vnd.ms-officetheme"],
	["tif", ["image/tiff", "image/x-tiff"]],
	["tiff", ["image/tiff", "image/x-tiff"]],
	["tmo", "application/vnd.tmobile-livetv"],
	["torrent", "application/x-bittorrent"],
	["tpl", "application/vnd.groove-tool-template"],
	["tpt", "application/vnd.trid.tpt"],
	["tr", "application/x-troff"],
	["tra", "application/vnd.trueapp"],
	["trm", "application/x-msterminal"],
	["tsd", "application/timestamped-data"],
	["tsi", "audio/tsp-audio"],
	["tsp", ["application/dsptype", "audio/tsplayer"]],
	["tsv", "text/tab-separated-values"],
	["ttf", "application/x-font-ttf"],
	["ttl", "text/turtle"],
	["turbot", "image/florian"],
	["twd", "application/vnd.simtech-mindmapper"],
	["txd", "application/vnd.genomatix.tuxedo"],
	["txf", "application/vnd.mobius.txf"],
	["txt", "text/plain"],
	["ufd", "application/vnd.ufdl"],
	["uil", "text/x-uil"],
	["uls", "text/iuls"],
	["umj", "application/vnd.umajin"],
	["uni", "text/uri-list"],
	["unis", "text/uri-list"],
	["unityweb", "application/vnd.unity"],
	["unv", "application/i-deas"],
	["uoml", "application/vnd.uoml+xml"],
	["uri", "text/uri-list"],
	["uris", "text/uri-list"],
	["ustar", ["application/x-ustar", "multipart/x-ustar"]],
	["utz", "application/vnd.uiq.theme"],
	["uu", ["application/octet-stream", "text/x-uuencode"]],
	["uue", "text/x-uuencode"],
	["uva", "audio/vnd.dece.audio"],
	["uvh", "video/vnd.dece.hd"],
	["uvi", "image/vnd.dece.graphic"],
	["uvm", "video/vnd.dece.mobile"],
	["uvp", "video/vnd.dece.pd"],
	["uvs", "video/vnd.dece.sd"],
	["uvu", "video/vnd.uvvu.mp4"],
	["uvv", "video/vnd.dece.video"],
	["vcd", "application/x-cdlink"],
	["vcf", "text/x-vcard"],
	["vcg", "application/vnd.groove-vcard"],
	["vcs", "text/x-vcalendar"],
	["vcx", "application/vnd.vcx"],
	["vda", "application/vda"],
	["vdo", "video/vdo"],
	["vew", "application/groupwise"],
	["vis", "application/vnd.visionary"],
	["viv", ["video/vivo", "video/vnd.vivo"]],
	["vivo", ["video/vivo", "video/vnd.vivo"]],
	["vmd", "application/vocaltec-media-desc"],
	["vmf", "application/vocaltec-media-file"],
	["voc", ["audio/voc", "audio/x-voc"]],
	["vos", "video/vosaic"],
	["vox", "audio/voxware"],
	["vqe", "audio/x-twinvq-plugin"],
	["vqf", "audio/x-twinvq"],
	["vql", "audio/x-twinvq-plugin"],
	["vrml", [
		"model/vrml",
		"x-world/x-vrml",
		"application/x-vrml"
	]],
	["vrt", "x-world/x-vrt"],
	["vsd", ["application/vnd.visio", "application/x-visio"]],
	["vsf", "application/vnd.vsf"],
	["vst", "application/x-visio"],
	["vsw", "application/x-visio"],
	["vtu", "model/vnd.vtu"],
	["vxml", "application/voicexml+xml"],
	["w60", "application/wordperfect6.0"],
	["w61", "application/wordperfect6.1"],
	["w6w", "application/msword"],
	["wad", "application/x-doom"],
	["wav", ["audio/wav", "audio/x-wav"]],
	["wax", "audio/x-ms-wax"],
	["wb1", "application/x-qpro"],
	["wbmp", "image/vnd.wap.wbmp"],
	["wbs", "application/vnd.criticaltools.wbs+xml"],
	["wbxml", "application/vnd.wap.wbxml"],
	["wcm", "application/vnd.ms-works"],
	["wdb", "application/vnd.ms-works"],
	["web", "application/vnd.xara"],
	["weba", "audio/webm"],
	["webm", "video/webm"],
	["webp", "image/webp"],
	["wg", "application/vnd.pmi.widget"],
	["wgt", "application/widget"],
	["wiz", "application/msword"],
	["wk1", "application/x-123"],
	["wks", "application/vnd.ms-works"],
	["wm", "video/x-ms-wm"],
	["wma", "audio/x-ms-wma"],
	["wmd", "application/x-ms-wmd"],
	["wmf", ["windows/metafile", "application/x-msmetafile"]],
	["wml", "text/vnd.wap.wml"],
	["wmlc", "application/vnd.wap.wmlc"],
	["wmls", "text/vnd.wap.wmlscript"],
	["wmlsc", "application/vnd.wap.wmlscriptc"],
	["wmv", "video/x-ms-wmv"],
	["wmx", "video/x-ms-wmx"],
	["wmz", "application/x-ms-wmz"],
	["woff", "application/x-font-woff"],
	["word", "application/msword"],
	["wp", "application/wordperfect"],
	["wp5", ["application/wordperfect", "application/wordperfect6.0"]],
	["wp6", "application/wordperfect"],
	["wpd", [
		"application/wordperfect",
		"application/vnd.wordperfect",
		"application/x-wpwin"
	]],
	["wpl", "application/vnd.ms-wpl"],
	["wps", "application/vnd.ms-works"],
	["wq1", "application/x-lotus"],
	["wqd", "application/vnd.wqd"],
	["wri", [
		"application/mswrite",
		"application/x-wri",
		"application/x-mswrite"
	]],
	["wrl", [
		"model/vrml",
		"x-world/x-vrml",
		"application/x-world"
	]],
	["wrz", ["model/vrml", "x-world/x-vrml"]],
	["wsc", "text/scriplet"],
	["wsdl", "application/wsdl+xml"],
	["wspolicy", "application/wspolicy+xml"],
	["wsrc", "application/x-wais-source"],
	["wtb", "application/vnd.webturbo"],
	["wtk", "application/x-wintalk"],
	["wvx", "video/x-ms-wvx"],
	["x-png", "image/png"],
	["x3d", "application/vnd.hzn-3d-crossword"],
	["xaf", "x-world/x-vrml"],
	["xap", "application/x-silverlight-app"],
	["xar", "application/vnd.xara"],
	["xbap", "application/x-ms-xbap"],
	["xbd", "application/vnd.fujixerox.docuworks.binder"],
	["xbm", [
		"image/xbm",
		"image/x-xbm",
		"image/x-xbitmap"
	]],
	["xdf", "application/xcap-diff+xml"],
	["xdm", "application/vnd.syncml.dm+xml"],
	["xdp", "application/vnd.adobe.xdp+xml"],
	["xdr", "video/x-amt-demorun"],
	["xdssc", "application/dssc+xml"],
	["xdw", "application/vnd.fujixerox.docuworks"],
	["xenc", "application/xenc+xml"],
	["xer", "application/patch-ops-error+xml"],
	["xfdf", "application/vnd.adobe.xfdf"],
	["xfdl", "application/vnd.xfdl"],
	["xgz", "xgl/drawing"],
	["xhtml", "application/xhtml+xml"],
	["xif", "image/vnd.xiff"],
	["xl", "application/excel"],
	["xla", [
		"application/vnd.ms-excel",
		"application/excel",
		"application/x-msexcel",
		"application/x-excel"
	]],
	["xlam", "application/vnd.ms-excel.addin.macroenabled.12"],
	["xlb", [
		"application/excel",
		"application/vnd.ms-excel",
		"application/x-excel"
	]],
	["xlc", [
		"application/vnd.ms-excel",
		"application/excel",
		"application/x-excel"
	]],
	["xld", ["application/excel", "application/x-excel"]],
	["xlk", ["application/excel", "application/x-excel"]],
	["xll", [
		"application/excel",
		"application/vnd.ms-excel",
		"application/x-excel"
	]],
	["xlm", [
		"application/vnd.ms-excel",
		"application/excel",
		"application/x-excel"
	]],
	["xls", [
		"application/vnd.ms-excel",
		"application/excel",
		"application/x-msexcel",
		"application/x-excel"
	]],
	["xlsb", "application/vnd.ms-excel.sheet.binary.macroenabled.12"],
	["xlsm", "application/vnd.ms-excel.sheet.macroenabled.12"],
	["xlsx", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"],
	["xlt", [
		"application/vnd.ms-excel",
		"application/excel",
		"application/x-excel"
	]],
	["xltm", "application/vnd.ms-excel.template.macroenabled.12"],
	["xltx", "application/vnd.openxmlformats-officedocument.spreadsheetml.template"],
	["xlv", ["application/excel", "application/x-excel"]],
	["xlw", [
		"application/vnd.ms-excel",
		"application/excel",
		"application/x-msexcel",
		"application/x-excel"
	]],
	["xm", "audio/xm"],
	["xml", [
		"application/xml",
		"text/xml",
		"application/atom+xml",
		"application/rss+xml"
	]],
	["xmz", "xgl/movie"],
	["xo", "application/vnd.olpc-sugar"],
	["xof", "x-world/x-vrml"],
	["xop", "application/xop+xml"],
	["xpi", "application/x-xpinstall"],
	["xpix", "application/x-vnd.ls-xpix"],
	["xpm", ["image/xpm", "image/x-xpixmap"]],
	["xpr", "application/vnd.is-xpr"],
	["xps", "application/vnd.ms-xpsdocument"],
	["xpw", "application/vnd.intercon.formnet"],
	["xslt", "application/xslt+xml"],
	["xsm", "application/vnd.syncml+xml"],
	["xspf", "application/xspf+xml"],
	["xsr", "video/x-amt-showrun"],
	["xul", "application/vnd.mozilla.xul+xml"],
	["xwd", ["image/x-xwd", "image/x-xwindowdump"]],
	["xyz", ["chemical/x-xyz", "chemical/x-pdb"]],
	["yang", "application/yang"],
	["yin", "application/yin+xml"],
	["z", ["application/x-compressed", "application/x-compress"]],
	["zaz", "application/vnd.zzazz.deck+xml"],
	["zip", [
		"application/zip",
		"multipart/x-zip",
		"application/x-zip-compressed",
		"application/x-compressed"
	]],
	["zir", "application/vnd.zul"],
	["zmm", "application/vnd.handheld-entertainment+xml"],
	["zoo", "application/octet-stream"],
	["zsh", "text/x-script.zsh"]
]);
function detectMimeType$1(filename) {
	if (!filename) return defaultMimeType;
	const parsed = path.parse(filename);
	const extension = (parsed.ext.substr(1) || parsed.name || "").split("?").shift().trim().toLowerCase();
	const value = extensions.has(extension) ? extensions.get(extension) : defaultMimeType;
	if (Array.isArray(value)) return value[0];
	return value;
}
function detectExtension$1(mimeType) {
	if (!mimeType) return defaultExtension;
	const parts = mimeType.toLowerCase().trim().split("/");
	const rootType = parts.shift().trim();
	const subType = parts.join("/").trim();
	if (mimeTypes.has(rootType + "/" + subType)) {
		const value = mimeTypes.get(rootType + "/" + subType);
		if (Array.isArray(value)) return value[0];
		return value;
	}
	switch (rootType) {
		case "text": return "txt";
		default: return "bin";
	}
}
//#endregion
//#region ../../node_modules/.pnpm/nodemailer@10.0.10/node_modules/nodemailer/dist/esm/mime-funcs/index.js
/**
* Checks if a value is plaintext string (uses only printable 7bit chars)
*
* When isParam is set the value is destined for a header parameter, so HT, CR and LF
* are not plaintext either: a header parameter has no way to carry them. HT is a valid
* fold point, so folding and unfolding a header would rewrite it as a space, and CR/LF
* cannot appear in a header value at all. DEL is neither a token character nor qtext,
* so it can not be carried bare or quoted. Such values have to go through the rfc2231
* parameter continuation encoding instead, the same way a quote already does.
*
* @param value String to be tested
* @param [isParam] Set to true if the value is a header parameter value
* @returns true if it is a plaintext string
*/
function isPlainText(value, isParam) {
	return typeof value === "string" && !(isParam ? /[\x00-\x1f\x7f"\u0080-\uFFFF]/ : /[\x00-\x08\x0b\x0c\x0e-\x1f\u0080-\uFFFF]/).test(value);
}
/**
* Wraps a value into a quoted-string. Inside one a quote would end the string early
* and a backslash would escape whatever follows it, so both go out as quoted-pairs.
*
* @param value String to be quoted
* @returns The value as a quoted-string, quotes included
*/
function quoteString(value) {
	return "\"" + (value || "").toString().replace(/["\\]/g, "\\$&") + "\"";
}
/**
* Checks if a multi line string containes lines longer than the selected value.
*
* Useful when detecting if a mail message needs any processing at all:
* if only plaintext characters are used and lines are short, then there is
* no need to encode the values in any way. If the value is plaintext but has
* longer lines then allowed, then use format=flowed
*
* @param lineLength Max line length to check for
* @returns Returns true if there is at least one line longer than lineLength chars
*/
function hasLongerLines(str, lineLength) {
	if (str.length > 131072) return true;
	return new RegExp("^.{" + (lineLength + 1) + ",}", "m").test(str);
}
/**
* Encodes a string or an Buffer to an UTF-8 MIME Word (rfc2047)
*
* @param data String to be encoded
* @param mimeWordEncoding='Q' Encoding for the mime word, either Q or B
* @param [maxLength=0] If set, split mime words into several chunks if needed
* @return Single or several mime words joined together
*/
function encodeWord(data, mimeWordEncoding, maxLength) {
	mimeWordEncoding = (mimeWordEncoding || "Q").toString().toUpperCase().trim().charAt(0);
	maxLength = maxLength || 0;
	let encodedStr;
	if (maxLength && maxLength > 12) maxLength -= 12;
	if (mimeWordEncoding === "Q") encodedStr = encode(data).replace(/[^a-z0-9!*+\-/=]/gi, (chr) => {
		const ord = chr.charCodeAt(0).toString(16).toUpperCase();
		if (chr === " ") return "_";
		return "=" + (ord.length === 1 ? "0" + ord : ord);
	});
	else if (mimeWordEncoding === "B") {
		encodedStr = typeof data === "string" ? data : data.toString("utf-8");
		maxLength = maxLength ? Math.max(3, (maxLength - maxLength % 4) / 4 * 3) : 0;
	}
	if (maxLength && (mimeWordEncoding !== "B" ? encodedStr : encode$1(data)).length > maxLength) {
		if (mimeWordEncoding === "Q") encodedStr = splitMimeEncodedString(encodedStr, maxLength).join("?= =?UTF-8?" + mimeWordEncoding + "?");
		else {
			const parts = [];
			let lpart = "";
			for (let i = 0, len = encodedStr.length; i < len; i++) {
				let chr = encodedStr.charAt(i);
				if (/[\ud800-\udbff]/.test(chr) && /[\udc00-\udfff]/.test(encodedStr.charAt(i + 1))) chr += encodedStr.charAt(++i);
				if (Buffer.byteLength(lpart + chr) <= maxLength || i === 0) lpart += chr;
				else {
					parts.push(encode$1(lpart));
					lpart = chr;
				}
			}
			if (lpart) parts.push(encode$1(lpart));
			if (parts.length > 1) encodedStr = parts.join("?= =?UTF-8?" + mimeWordEncoding + "?");
			else encodedStr = parts.join("");
		}
	} else if (mimeWordEncoding === "B") encodedStr = encode$1(data);
	return "=?UTF-8?" + mimeWordEncoding + "?" + encodedStr + (encodedStr.substr(-2) === "?=" ? "" : "?=");
}
/**
* Finds word sequences with non ascii text and converts these to mime words
*
* @param value String to be encoded
* @param mimeWordEncoding='Q' Encoding for the mime word, either Q or B
* @param [maxLength=0] If set, split mime words into several chunks if needed
* @param [encodeAll=false] If true and the value needs encoding then encodes entire string, not just the smallest match
* @return String with possible mime words
*/
function encodeWords(value, mimeWordEncoding, maxLength, encodeAll) {
	maxLength = maxLength || 0;
	const firstMatch = value.match(/(?:^|\s)([^\s]*["\u0080-\uFFFF])/);
	if (!firstMatch) return value;
	if (encodeAll) return encodeWord(value, mimeWordEncoding, maxLength);
	const lastMatch = value.match(/(["\u0080-\uFFFF][^\s]*)[^"\u0080-\uFFFF]*$/);
	if (!lastMatch) return value;
	const startIndex = firstMatch.index + (firstMatch[0].match(/[^\s]/) || { index: 0 }).index;
	const endIndex = lastMatch.index + (lastMatch[1] || "").length;
	return (startIndex ? value.substr(0, startIndex) : "") + encodeWord(value.substring(startIndex, endIndex), mimeWordEncoding || "Q", maxLength) + (endIndex < value.length ? value.substr(endIndex) : "");
}
/**
* Joins parsed header value together as 'value; param1=value1; param2=value2'
* PS: We are following RFC 822 for the list of special characters that we need to keep in quotes.
*      Refer: https://www.w3.org/Protocols/rfc1341/4_Content-Type.html
* @param structured Parsed header value
* @return joined header value
*/
function buildHeaderValue(structured) {
	const paramsArray = [];
	Object.keys(structured.params || {}).forEach((key) => {
		const value = structured.params[key];
		const param = key.replace(/[\x00-\x1f\x7f]/g, "");
		if (!isPlainText(value, true) || value.length >= 75) buildHeaderParam(param, value, 50).forEach((encodedParam) => {
			if (!/[\s"\\;:/=(),<>@[\]?]|^[-']|'$/.test(encodedParam.value) || encodedParam.key.substr(-1) === "*") paramsArray.push(encodedParam.key + "=" + encodedParam.value);
			else paramsArray.push(encodedParam.key + "=" + JSON.stringify(encodedParam.value));
		});
		else if (/[\s'"\\;:/=(),<>@[\]?]|^-/.test(value)) paramsArray.push(param + "=" + JSON.stringify(value));
		else paramsArray.push(param + "=" + value);
	});
	return (typeof structured.value === "string" ? structured.value.replace(/[\x00-\x1f\x7f]/g, "") : structured.value) + (paramsArray.length ? "; " + paramsArray.join("; ") : "");
}
/**
* Encodes a string or an Buffer to an UTF-8 Parameter Value Continuation encoding (rfc2231)
* Useful for splitting long parameter values.
*
* For example
*      title="unicode string"
* becomes
*     title*0*=utf-8''unicode
*     title*1*=%20string
*
* @param data String to be encoded
* @param [maxLength=50] Max length for generated chunks
* @param [fromCharset='UTF-8'] Source sharacter set
* @return A list of encoded keys and headers
*/
function buildHeaderParam(key, data, maxLength) {
	const list = [];
	let encodedStr = typeof data === "string" ? data : (data || "").toString();
	let chr;
	let line;
	let startPos = 0;
	let i, len;
	maxLength = maxLength || 50;
	if (isPlainText(data, true)) {
		if (encodedStr.length <= maxLength) return [{
			key,
			value: encodedStr
		}];
		encodedStr = encodedStr.replace(new RegExp(".{" + maxLength + "}", "g"), (str) => {
			list.push({ line: str });
			return "";
		});
		if (encodedStr) list.push({ line: encodedStr });
	} else {
		if (/[\uD800-\uDBFF]/.test(encodedStr)) {
			const encodedStrArr = [];
			for (i = 0, len = encodedStr.length; i < len; i++) {
				chr = encodedStr.charAt(i);
				if (/[\ud800-\udbff]/.test(chr) && /[\udc00-\udfff]/.test(encodedStr.charAt(i + 1))) {
					chr += encodedStr.charAt(i + 1);
					encodedStrArr.push(chr);
					i++;
				} else encodedStrArr.push(chr);
			}
			encodedStr = encodedStrArr;
		}
		line = "utf-8''";
		let encoded = true;
		startPos = 0;
		for (i = 0, len = encodedStr.length; i < len; i++) {
			chr = encodedStr[i];
			if (encoded) chr = safeEncodeURIComponent(chr);
			else {
				chr = chr === " " ? chr : safeEncodeURIComponent(chr);
				if (chr !== encodedStr[i]) {
					if ((safeEncodeURIComponent(line) + chr).length >= maxLength) {
						list.push({
							line,
							encoded
						});
						line = "";
						encoded = true;
					} else {
						encoded = true;
						i = startPos;
						line = "";
						continue;
					}
				}
			}
			if ((line + chr).length >= maxLength) {
				list.push({
					line,
					encoded
				});
				line = chr = encodedStr[i] === " " ? " " : safeEncodeURIComponent(encodedStr[i]);
				if (chr === encodedStr[i]) {
					encoded = false;
					startPos = i - 1;
				} else encoded = true;
			} else line += chr;
		}
		if (line) list.push({
			line,
			encoded
		});
	}
	return list.map((item, i) => ({
		key: key + "*" + i + (item.encoded ? "*" : ""),
		value: item.line
	}));
}
/**
* Parses a header value with key=value arguments into a structured
* object.
*
*   parseHeaderValue('content-type: text/plain; CHARSET='UTF-8'') ->
*   {
*     'value': 'text/plain',
*     'params': {
*       'charset': 'UTF-8'
*     }
*   }
*
* @param str Header value
* @return Header value as a parsed structure
*/
function parseHeaderValue(str) {
	const response = {
		value: false,
		params: {}
	};
	const setParam = (name, value) => {
		if (!isProtoKey(name)) response.params[name] = value;
	};
	let key = false;
	let value = "";
	let type = "value";
	let quote = false;
	let escaped = false;
	let chr;
	for (let i = 0, len = str.length; i < len; i++) {
		chr = str.charAt(i);
		if (type === "key") {
			if (chr === "=") {
				key = value.trim().toLowerCase();
				type = "value";
				value = "";
				continue;
			}
			value += chr;
		} else {
			if (escaped) value += chr;
			else if (chr === "\\") {
				escaped = true;
				continue;
			} else if (quote && chr === quote) quote = false;
			else if (!quote && chr === "\"") quote = chr;
			else if (!quote && chr === ";") {
				if (key === false) response.value = value.trim();
				else setParam(key, value.trim());
				type = "key";
				value = "";
			} else value += chr;
			escaped = false;
		}
	}
	if (type === "value") {
		if (key === false) response.value = value.trim();
		else setParam(key, value.trim());
	} else if (value.trim()) setParam(value.trim().toLowerCase(), "");
	Object.keys(response.params).forEach((key) => {
		let actualKey, nr, match, value;
		if (match = key.match(/(\*(\d+)|\*(\d+)\*|\*)$/)) {
			actualKey = key.substr(0, match.index);
			nr = Number(match[2] || match[3]) || 0;
			if (isProtoKey(actualKey)) {
				delete response.params[key];
				return;
			}
			if (!response.params[actualKey] || typeof response.params[actualKey] !== "object") response.params[actualKey] = {
				charset: false,
				values: []
			};
			value = response.params[key];
			if (nr === 0 && match[0].substr(-1) === "*" && (match = value.match(/^([^']*)'[^']*'(.*)$/))) {
				response.params[actualKey].charset = match[1] || "iso-8859-1";
				value = match[2];
			}
			response.params[actualKey].values[nr] = value;
			delete response.params[key];
		}
	});
	Object.keys(response.params).forEach((key) => {
		let value;
		if (response.params[key] && Array.isArray(response.params[key].values)) {
			value = response.params[key].values.map((val) => val || "").join("");
			if (response.params[key].charset) response.params[key] = "=?" + response.params[key].charset + "?Q?" + value.replace(/[=?_\s]/g, (s) => {
				const c = s.charCodeAt(0).toString(16);
				if (s === " ") return "_";
				return "%" + (c.length < 2 ? "0" : "") + c;
			}).replace(/%/g, "=") + "?=";
			else response.params[key] = value;
		}
	});
	return response;
}
/**
* Returns file extension for a content type string. If no suitable extensions
* are found, 'bin' is used as the default extension
*
* @param mimeType Content type to be checked for
* @return File extension
*/
function detectExtension(mimeType) {
	return detectExtension$1(mimeType);
}
/**
* Returns content type for a file extension. If no suitable content types
* are found, 'application/octet-stream' is used as the default content type
*
* @param extension Extension to be checked for
* @return File extension
*/
function detectMimeType(extension) {
	return detectMimeType$1(extension);
}
/**
* Folds long lines, useful for folding header lines (afterSpace=false) and
* flowed text (afterSpace=true)
*
* @param str String to be folded
* @param [lineLength=76] Maximum length of a line
* @param afterSpace If true, leave a space in th end of a line
* @return String with folded lines
*/
function foldLines(str, lineLength, afterSpace) {
	str = (str || "").toString();
	lineLength = lineLength || 76;
	let pos = 0;
	const len = str.length;
	let result = "";
	let line, match;
	while (pos < len) {
		line = str.substr(pos, lineLength);
		if (line.length < lineLength) {
			result += line;
			break;
		}
		if (match = line.match(/^[^\n\r]*(\r?\n|\r)/)) {
			line = match[0];
			result += line;
			pos += line.length;
			continue;
		} else if ((match = line.match(/(\s+)[^\s]*$/)) && match[0].length - (afterSpace ? (match[1] || "").length : 0) < line.length) line = line.substr(0, line.length - (match[0].length - (afterSpace ? (match[1] || "").length : 0)));
		else if (match = str.substr(pos + line.length).match(/^[^\s]+(\s*)/)) line = line + match[0].substr(0, match[0].length - (!afterSpace ? (match[1] || "").length : 0));
		result += line;
		pos += line.length;
		if (pos < len) result += "\r\n";
	}
	return result;
}
/**
* Splits a mime encoded string. Needed for dividing mime words into smaller chunks
*
* @param str Mime encoded string to be split up
* @param maxlen Maximum length of characters for one part (minimum 12)
* @return Split string
*/
function splitMimeEncodedString(str, maxlen) {
	const lines = [];
	let curLine, fallbackLine, match, chr, done;
	maxlen = Math.max(maxlen || 0, 12);
	while (str.length) {
		curLine = str.substr(0, maxlen);
		if (match = curLine.match(/[=][0-9A-F]?$/i)) curLine = curLine.substr(0, match.index);
		fallbackLine = curLine.length ? curLine : str.substr(0, maxlen);
		done = false;
		while (!done && curLine.length) {
			done = true;
			if (match = str.substr(curLine.length).match(/^[=]([0-9A-F]{2})/i)) {
				chr = parseInt(match[1], 16);
				if (chr < 194 && chr > 127) {
					curLine = curLine.substr(0, curLine.length - 3);
					done = false;
				}
			}
		}
		if (!curLine.length) curLine = fallbackLine;
		lines.push(curLine);
		str = str.substr(curLine.length);
	}
	return lines;
}
function encodeURICharComponent(chr) {
	let res = "";
	let ord = chr.charCodeAt(0).toString(16).toUpperCase();
	if (ord.length % 2) ord = "0" + ord;
	if (ord.length > 2) for (let i = 0, len = ord.length / 2; i < len; i++) res += "%" + ord.substr(i, 2);
	else res += "%" + ord;
	return res;
}
function safeEncodeURIComponent(str) {
	str = (str || "").toString();
	try {
		str = encodeURIComponent(str);
	} catch (_E) {
		str = encodeURIComponent(Buffer.from(str, "utf-8").toString("utf-8"));
	}
	return str.replace(/[\x00-\x1F *'()<>@,;:\\"[\]?=\u007F-\uFFFF]/g, (chr) => encodeURICharComponent(chr));
}
//#endregion
//#region ../../node_modules/.pnpm/nodemailer@10.0.10/node_modules/nodemailer/dist/esm/addressparser/index.js
/**
* Restores the quoting of a local part that was read out of a quoted string.
*
* RFC 5321 allows '@' inside a quoted local part, so handing '"user@evil.com"@good.com'
* on as the bare 'user@evil.com@good.com' leaves it to the consumer which '@' splits the
* domain off. Getting that wrong is a misrouting vector, so the quotes go back on. The
* same holds for the other specials: a ',' or a ';' that loses its quotes reads as a
* recipient separator once the consumer puts the address back into a header.
*
* This module has no dependencies so that it can ship on its own, which is why the two
* grammar tests below are spelled out here instead of shared with src/mime-node. Keeping
* only what is ambiguous quoted is deliberate, mime-node applies the stricter RFC 5321
* dot-atom rule on top of this when it emits an address.
*
* @param address Address with an unquoted local part
* @return Address with the local part as a quoted-string
*/
function _quoteLocalPart(address) {
	const lastAt = address.lastIndexOf("@");
	if (lastAt < 0) return address;
	const user = address.substr(0, lastAt);
	if (/^[^\s"(),:;<>@[\\\]]+$/.test(user) || /^"(?:[^"\\]|\\[\s\S])*"$/.test(user)) return address;
	return "\"" + user.replace(/["\\]/g, "\\$&") + "\"@" + address.substr(lastAt + 1);
}
/**
* Reached for every parsed address, so it is built once rather than per call.
*/
const HAS_WHITESPACE = /\s/;
/**
* An addr-spec that carries its whitespace legally, inside a quoted local part. The
* optional tail is the malformed shape: a real mailbox with wreckage trailing it.
*/
const QUOTED_LOCAL_ADDR = /^("(?:[^"\\]|\\[\s\S])*"@\S+)(?:\s+([\s\S]+))?$/;
/**
* One run holding a single '@' and no whitespace, the shape an addr-spec has to have.
*/
const ADDR_SPEC = /^[^@\s]+@[^@\s]+$/;
/**
* The looser reading applied once the strict one finds nothing, which tolerates the
* further '@' that a domain should not have but malformed headers carry anyway.
*/
const LOOSE_ADDR_SPEC = /^[^@\s]+@\S+$/;
/**
* An addr-spec sitting inside free text, together with the whitespace around it. Sticky
* on purpose: it is run at the one offset _looseAddressStart picks rather than being let
* loose to search, see there.
*/
const LOOSE_TEXT_ADDR = /\s*\b[^@\s]+@[^\s]+\b\s*/y;
/**
* The characters JS `\s` matches, which the scan below has to agree with to land on the
* same match the pattern would.
*/
function _isSpaceCode(code) {
	return code === 32 || code >= 9 && code <= 13 || code === 160 || code === 5760 || code >= 8192 && code <= 8202 || code === 8232 || code === 8233 || code === 8239 || code === 8287 || code === 12288 || code === 65279;
}
/**
* The characters JS `\w` matches without the unicode flag, the set the `\b` in
* LOOSE_TEXT_ADDR is read against. charCodeAt off either end of the string gives NaN,
* which compares false throughout, so out of range reads as the non-word the pattern
* treats them as.
*/
function _isWordCode(code) {
	return code >= 48 && code <= 57 || code >= 65 && code <= 90 || code >= 97 && code <= 122 || code === 95;
}
/**
* Whether `\b` holds at an offset
*/
function _isBoundary(text, at) {
	return _isWordCode(text.charCodeAt(at - 1)) !== _isWordCode(text.charCodeAt(at));
}
/**
* Offset of the first '@' in `text` between `from` and `to`, or -1 when the range holds none.
*
* indexOf would scan on to the end of the value, and the value here is a whole header. The
* walk below steps one whitespace delimited run at a time and only ever uses a '@' that sits
* inside the run it is on, so an unbounded probe rescans everything behind that run once per
* run and grows with the square of the header: 400KB of free text carrying no '@' took a
* quarter of a second. GHSA-v53p-9fqp-m79j took the pattern search out of this walk and left
* the probe unbounded behind it.
*
* @param text Text to look in
* @param from Offset to start at
* @param to Offset to stop before
* @return Offset of the '@', or -1
*/
function _indexOfAt(text, from, to) {
	for (let i = from; i < to; i++) if (text.charCodeAt(i) === 64) return i;
	return -1;
}
/**
* Finds the offset LOOSE_TEXT_ADDR matches at, or -1 when it does not match at all.
*
* Letting the pattern search for itself is quadratic: '[^@\s]+' is retried from every
* offset and rescans the run to the next '@' each time, so 140KB of header holding no
* usable '@' blocks the event loop for about ten seconds (GHSA-v53p-9fqp-m79j). The search is also unnecessary.
* '[^@\s]+' crosses neither whitespace nor a '@', so a match can only begin at the head of
* a whitespace delimited run or just past a '@' inside one, and '[^\s]+\b' gives characters
* back until it lands on a boundary, so the only end it can take in that run is the last
* boundary in it. Both are found in one pass, and the pattern is then run at that single
* offset.
*
* @param text Free text to look in
* @return Offset to match at, or -1
*/
function _looseAddressStart(text) {
	const len = text.length;
	let pos = 0;
	while (pos < len) {
		while (pos < len && _isSpaceCode(text.charCodeAt(pos))) pos++;
		if (pos >= len) break;
		const runStart = pos;
		let runEnd = pos;
		while (runEnd < len && !_isSpaceCode(text.charCodeAt(runEnd))) runEnd++;
		let at = _indexOfAt(text, runStart, runEnd);
		if (at >= 0) {
			let lastBoundary = -1;
			for (let k = runEnd; k > runStart; k--) if (_isBoundary(text, k)) {
				lastBoundary = k;
				break;
			}
			let atomStart = runStart;
			while (lastBoundary >= 0 && at >= 0) {
				if (at > atomStart && runEnd > at + 1 && lastBoundary > at + 1) {
					for (let start = atomStart; start < at; start++) if (_isBoundary(text, start)) {
						if (start > runStart) return start;
						let padded = runStart;
						while (padded > 0 && _isSpaceCode(text.charCodeAt(padded - 1))) padded--;
						return padded;
					}
				}
				atomStart = at + 1;
				at = _indexOfAt(text, atomStart, runEnd);
			}
		}
		pos = runEnd;
	}
	return -1;
}
/**
* Recovers the addr-spec from an angle-addr that came back holding unquoted whitespace.
*
* A malformed header can put more than a mailbox between the angle brackets, most often
* because the generator wrote the recipient twice: '<user@example.com user@example.com>'
* or '<example.com user@example.com>'. Whitespace is not addr-spec, so the whole run can
* never be a mailbox anyone could deliver to, and passing it on as the address loses the
* recipient that is sitting right there in the header.
*
* The run that still reads as an addr-spec is kept and whatever is left over becomes
* display text rather than being dropped. Candidates are read strictly first and then
* under the looser grammar, the same two tiers the unquoted-text branch below applies to
* the same problem, so that '<a@b@c.com junk>' and a bare 'a@b@c.com junk' agree on the
* recipient. When several runs qualify the first wins, which is what that branch's looser
* tier does within a token.
*
* A quoted local part is left alone: RFC 5321 allows whitespace inside it, so
* '<"user name"@example.com>' is well formed and means exactly what it says.
*
* @param data Collected address parts, mutated in place
*/
function _recoverAddrSpec(data) {
	if (!HAS_WHITESPACE.test(data.address)) return;
	let address;
	let rest;
	const quoted = data.address.match(QUOTED_LOCAL_ADDR);
	if (quoted) {
		if (!quoted[2]) return;
		address = quoted[1];
		rest = [quoted[2]];
	} else {
		if (data.address.indexOf("\"") >= 0) return;
		const parts = data.address.split(/\s+/);
		let addrIndex = parts.findIndex((part) => ADDR_SPEC.test(part));
		if (addrIndex < 0) addrIndex = parts.findIndex((part) => LOOSE_ADDR_SPEC.test(part));
		if (addrIndex < 0) return;
		address = parts.splice(addrIndex, 1)[0];
		rest = parts;
	}
	data.address = address;
	data.text = [data.text].concat(rest).filter((part) => part).join(" ");
}
/**
* Converts tokens for a single address into an address object
*
* @param tokens Tokens object
* @param depth Current recursion depth for nested group protection
* @return Address object
*/
function _handleAddress(tokens, depth) {
	let isGroup = false;
	let state = "text";
	const addresses = [];
	const data = {
		address: [],
		comment: [],
		group: [],
		text: [],
		textWasQuoted: []
	};
	let insideQuotes = false;
	const lastChars = {
		address: "",
		comment: "",
		group: "",
		text: ""
	};
	for (let i = 0, len = tokens.length; i < len; i++) {
		const token = tokens[i];
		const prevToken = i ? tokens[i - 1] : null;
		if (token.type === "operator") switch (token.value) {
			case "<":
				state = "address";
				insideQuotes = false;
				break;
			case "(":
				state = "comment";
				insideQuotes = false;
				break;
			case ":":
				state = "group";
				isGroup = true;
				insideQuotes = false;
				break;
			case "\"":
				insideQuotes = !insideQuotes;
				state = "text";
				break;
			default:
				state = "text";
				insideQuotes = false;
		}
		else if (token.value) {
			const prevPrevToken = i > 1 ? tokens[i - 2] : null;
			const opensAfterEmptyQuotedString = prevToken?.type === "operator" && prevToken.value === "\"" && !!prevToken.noBreak && prevPrevToken?.type === "operator" && prevPrevToken.value === "\"";
			if (state === "address") token.value = token.value.replace(/^[^<]*<\s*/, "");
			const parts = data[state];
			if (prevToken && prevToken.noBreak && parts.length && (prevToken.value !== ")" || lastChars[state] === "@" || token.value.charAt(0) === "@")) {
				data[state][data[state].length - 1] += token.value;
				if (token.value) lastChars[state] = token.value.charAt(token.value.length - 1);
				if (state === "text" && insideQuotes) data.textWasQuoted[data.textWasQuoted.length - 1] = true;
			} else {
				data[state].push(token.value);
				lastChars[state] = token.value.charAt(token.value.length - 1);
				if (state === "text") data.textWasQuoted.push(insideQuotes || opensAfterEmptyQuotedString);
			}
		}
	}
	if (!data.text.length && data.comment.length) {
		data.text = data.comment;
		data.comment = [];
	}
	if (isGroup) {
		data.text = data.text.join(" ");
		let groupMembers = [];
		if (data.group.length) addressparser(data.group.join(","), { _depth: depth + 1 }).forEach((member) => {
			if (member.group) groupMembers = groupMembers.concat(member.group);
			else groupMembers.push(member);
		});
		addresses.push({
			name: data.text || "",
			group: groupMembers
		});
	} else {
		if (!data.address.length && data.text.length) {
			for (let i = data.text.length - 1; i >= 0; i--) if (!data.textWasQuoted[i] && ADDR_SPEC.test(data.text[i])) {
				data.address = data.text.splice(i, 1);
				data.textWasQuoted.splice(i, 1);
				break;
			}
			if (!data.address.length) {
				let extracted = false;
				for (let i = data.text.length - 1; i >= 0; i--) if (!data.textWasQuoted[i]) {
					const part = data.text[i];
					let remainder = part;
					const at = _looseAddressStart(part);
					if (at >= 0) {
						LOOSE_TEXT_ADDR.lastIndex = at;
						const match = LOOSE_TEXT_ADDR.exec(part);
						if (match) {
							data.address = [match[0].trim()];
							extracted = true;
							remainder = part.slice(0, at) + " " + part.slice(at + match[0].length);
						}
					}
					data.text[i] = remainder.trim();
					if (extracted) break;
				}
			}
		}
		if (!data.text.length && data.comment.length) {
			data.text = data.comment;
			data.comment = [];
		}
		if (data.address.length > 1) data.text = data.text.concat(data.address.splice(1));
		const addressFromQuotedText = !data.address.length && data.textWasQuoted.some((wasQuoted) => wasQuoted);
		data.text = data.text.join(" ");
		data.address = data.address.join(" ");
		if (addressFromQuotedText && data.text) {
			data.address = _quoteLocalPart(data.text);
			data.text = "";
		}
		_recoverAddrSpec(data);
		const address = {
			address: data.address || data.text || "",
			name: data.text || data.address || ""
		};
		if (address.address === address.name) {
			if (/@/.test(address.address || "")) address.name = "";
			else address.address = "";
		}
		addresses.push(address);
	}
	return addresses;
}
/**
* Creates a Tokenizer object for tokenizing address field strings
*
* @constructor
* @param str Address field string
*/
var Tokenizer = class {
	constructor(str) {
		this.str = (str || "").toString();
		this.operatorCurrent = "";
		this.operatorExpecting = "";
		this.node = null;
		this.escaped = false;
		this.inDomainLiteral = false;
		this.list = [];
		/**
		* Operator tokens and which tokens are expected to end the sequence
		*/
		this.operators = {
			"\"": "\"",
			"(": ")",
			"<": ">",
			",": "",
			":": ";",
			";": ""
		};
	}
	/**
	* Tokenizes the original input string
	*
	* @return An array of operator|text tokens
	*/
	tokenize() {
		const list = [];
		for (let i = 0, len = this.str.length; i < len; i++) {
			const chr = this.str.charAt(i);
			const nextChr = i < len - 1 ? this.str.charAt(i + 1) : null;
			this.checkChar(chr, nextChr);
		}
		this.list.forEach((node) => {
			node.value = (node.value || "").toString().trim();
			if (node.value) list.push(node);
		});
		return list;
	}
	/**
	* Checks if a character is an operator or text and acts accordingly
	*
	* @param chr Character from the address field
	*/
	checkChar(chr, nextChr) {
		if (!this.escaped && !this.operatorExpecting) {
			if (!this.inDomainLiteral && chr === "[") this.inDomainLiteral = true;
			else if (this.inDomainLiteral && (chr === "]" || chr === "," || chr === ";")) this.inDomainLiteral = false;
		}
		if (this.escaped) {} else if (chr === this.operatorExpecting) {
			this.node = {
				type: "operator",
				value: chr
			};
			if (nextChr && ![
				" ",
				"	",
				"\r",
				"\n",
				",",
				";"
			].includes(nextChr)) this.node.noBreak = true;
			this.list.push(this.node);
			this.node = null;
			this.operatorExpecting = "";
			this.escaped = false;
			return;
		} else if (!this.operatorExpecting && !this.inDomainLiteral && chr in this.operators) {
			this.node = {
				type: "operator",
				value: chr
			};
			this.list.push(this.node);
			this.node = null;
			this.operatorExpecting = this.operators[chr];
			this.escaped = false;
			return;
		} else if (["\"", "'"].includes(this.operatorExpecting) && chr === "\\") {
			this.escaped = true;
			return;
		}
		if (!this.node) {
			this.node = {
				type: "text",
				value: ""
			};
			this.list.push(this.node);
		}
		if (chr === "\n") chr = " ";
		if (chr.charCodeAt(0) >= 33 || [" ", "	"].includes(chr)) this.node.value += chr;
		this.escaped = false;
	}
};
/**
* Maximum recursion depth for parsing nested groups.
* RFC 5322 doesn't allow nested groups, so this is a safeguard against
* malicious input that could cause stack overflow.
*/
const MAX_NESTED_GROUP_DEPTH = 50;
/**
* Parses structured e-mail addresses from an address field
*
* Example:
*
*    'Name <address@domain>'
*
* will be converted to
*
*     [{name: 'Name', address: 'address@domain'}]
*
* @param str Address field
* @param options Optional options object
* @param options._depth Internal recursion depth counter (do not set manually)
* @return An array of address objects
*/
function addressparser(str, options) {
	options = options || {};
	const depth = options._depth || 0;
	if (depth > MAX_NESTED_GROUP_DEPTH) return [];
	const tokens = new Tokenizer(str).tokenize();
	const addresses = [];
	let address = [];
	let parsedAddresses = [];
	tokens.forEach((token) => {
		if (token.type === "operator" && (token.value === "," || token.value === ";")) {
			if (address.length) addresses.push(address);
			address = [];
		} else address.push(token);
	});
	if (address.length) addresses.push(address);
	addresses.forEach((addr) => {
		const handled = _handleAddress(addr, depth);
		for (let i = 0; i < handled.length; i++) parsedAddresses.push(handled[i]);
	});
	const mergedAddresses = [];
	for (let i = parsedAddresses.length - 1; i >= 0; i--) {
		const current = parsedAddresses[i];
		const next = mergedAddresses.length ? mergedAddresses[mergedAddresses.length - 1] : null;
		if (next && current.address === "" && current.name && !current.group && next.address && next.name) next.name = current.name + ", " + next.name;
		else mergedAddresses.push(current);
	}
	mergedAddresses.reverse();
	parsedAddresses = mergedAddresses;
	if (options.flatten) {
		const flatAddresses = [];
		const walkAddressList = (list) => {
			list.forEach((entry) => {
				if (entry.group) return walkAddressList(entry.group);
				flatAddresses.push(entry);
			});
		};
		walkAddressList(parsedAddresses);
		return flatAddresses;
	}
	return parsedAddresses;
}
//#endregion
//#region ../../node_modules/.pnpm/nodemailer@10.0.10/node_modules/nodemailer/dist/esm/mime-node/last-newline.js
var LastNewline = class extends Transform {
	constructor() {
		super();
		this.lastByte = false;
	}
	/** @internal */
	_transform(chunk, encoding, done) {
		if (chunk.length) this.lastByte = chunk[chunk.length - 1];
		this.push(chunk);
		done();
	}
	/** @internal */
	_flush(done) {
		if (this.lastByte === 10) return done();
		if (this.lastByte === 13) {
			this.push(Buffer.from("\n"));
			return done();
		}
		this.push(Buffer.from("\r\n"));
		return done();
	}
};
//#endregion
//#region ../../node_modules/.pnpm/nodemailer@10.0.10/node_modules/nodemailer/dist/esm/mime-node/le-windows.js
/**
* Ensures that only <CR><LF> sequences are used for linebreaks
*
* @param options Stream options
*/
var LeWindows = class extends Transform {
	constructor(options) {
		super(options);
		this.lastByte = false;
	}
	/**
	* Escapes dots
	* @internal
	*/
	_transform(chunk, encoding, done) {
		let buf;
		let lastPos = 0;
		for (let i = 0, len = chunk.length; i < len; i++) if (chunk[i] === 10) {
			if (i && chunk[i - 1] !== 13 || !i && this.lastByte !== 13) {
				if (i > lastPos) {
					buf = chunk.slice(lastPos, i);
					this.push(buf);
				}
				this.push(Buffer.from("\r\n"));
				lastPos = i + 1;
			}
		}
		if (lastPos && lastPos < chunk.length) {
			buf = chunk.slice(lastPos);
			this.push(buf);
		} else if (!lastPos) this.push(chunk);
		this.lastByte = chunk[chunk.length - 1];
		done();
	}
};
//#endregion
//#region ../../node_modules/.pnpm/nodemailer@10.0.10/node_modules/nodemailer/dist/esm/mime-node/le-unix.js
/**
* Ensures that only <LF> is used for linebreaks
*
* @param options Stream options
*/
var LeUnix = class extends Transform {
	constructor(options) {
		super(options);
	}
	/**
	* Escapes dots
	* @internal
	*/
	_transform(chunk, encoding, done) {
		let buf;
		let lastPos = 0;
		for (let i = 0, len = chunk.length; i < len; i++) if (chunk[i] === 13) {
			buf = chunk.slice(lastPos, i);
			lastPos = i + 1;
			this.push(buf);
		}
		if (lastPos && lastPos < chunk.length) {
			buf = chunk.slice(lastPos);
			this.push(buf);
		} else if (!lastPos) this.push(chunk);
		done();
	}
};
//#endregion
//#region ../../node_modules/.pnpm/nodemailer@10.0.10/node_modules/nodemailer/dist/esm/mime-node/index.js
const FORMATTED_HEADERS = [
	"From",
	"Sender",
	"To",
	"Cc",
	"Bcc",
	"Reply-To",
	"Date",
	"References"
];
const ATEXT = "[A-Za-z0-9!#$%&'*+\\-/=?^_`{|}~\\x80-\\uFFFF]";
const DOT_ATOM = new RegExp("^" + ATEXT + "+(?:\\." + ATEXT + "+)*$");
const QUOTED_STRING = /^"(?:[^"\\]|\\[\s\S])*"$/;
const PLAIN_ADDRESS = /^[^\s"(),:;<>@[\\\]]+@[^\s"(),:;<>@[\\\]]+$/;
const URL_PARSER_UNSAFE = /[/\\?#%\x00-\x20\x7F]/;
/**
* Encodes a domain the way browsers, the WHATWG URL Standard and DNS facing resolvers do,
* which is with UTS-46 mapping applied before the Punycode step.
*
* The bundled codec is plain RFC 3492 and maps nothing, so it disagrees with every
* conformant parser on any domain holding a mapped or ignored code point. An invisible
* U+00AD in 'compa\u00ADny.com' encoded to 'xn--company-pka.com' where a validator reads
* 'company.com', which let an allow-listed domain be checked and a different one mailed.
*
* Anything the URL parser does not accept as a hostname, an address literal such as
* '[127.0.0.1]' included, comes back empty and falls through to the bundled codec, which
* leaves those as they were supplied.
*
* @param domain Domain to encode, already lowercased by the caller
* @param toUnicode Return the U-label form instead of the A-label form
* @return Encoded domain
*/
function normalizeDomain(domain, toUnicode$1) {
	const mapper = toUnicode$1 ? urllib.domainToUnicode : urllib.domainToASCII;
	if (typeof mapper === "function" && !URL_PARSER_UNSAFE.test(domain)) {
		const mapped = mapper(domain);
		if (mapped) return mapped;
	}
	return toUnicode$1 ? toUnicode(domain) : toASCII(domain);
}
/**
* Removes the characters that must never reach a multipart delimiter line.
*
* A line break splits the delimiter, so the boundary declared in the header can never
* match it again and the parts go out as body lines instead. The other C0 controls and
* DEL do not split anything but must not be written either: RFC 5321 does not allow a
* NUL in DATA at all, and an MTA or a scanner that stops at one reads a different
* message than a client that does not, which is the same parser disagreement a split
* delimiter creates. Both sides are cleaned together, since the declared value and the
* delimiters come from this one result.
*
* @param value Value to clean
* @return Value with every control character removed
*/
function _stripBoundaryControls(value) {
	return value.replace(/[\x00-\x1f\x7f]+/g, "");
}
/**
* Creates a new mime tree node. Assumes 'multipart/*' as the content type
* if it is a branch, anything else counts as leaf. If rootNode is missing from
* the options, assumes this is the root.
*
* @param contentType Define the content type for the node. Can be left blank for attachments (derived from filename)
* @param [options] optional options
* @param [options.rootNode] root node for this tree
* @param [options.parentNode] immediate parent for this node
* @param [options.filename] filename for an attachment node
* @param [options.baseBoundary] shared part of the unique multipart boundary
* @param [options.keepBcc] If true, do not exclude Bcc from the generated headers
* @param [options.normalizeHeaderKey] method to normalize header keys for custom caseing
* @param [options.textEncoding] either 'Q' (the default) or 'B'
*/
var MimeNode = class MimeNode {
	constructor(contentType, options) {
		this.nodeCounter = 0;
		options = options || {};
		/**
		* shared part of the unique multipart boundary. Control characters are dropped
		* here rather than at the delimiter, see _stripBoundaryControls
		*/
		this.baseBoundary = _stripBoundaryControls(options.baseBoundary || crypto.randomBytes(8).toString("hex"));
		this.boundaryPrefix = _stripBoundaryControls(options.boundaryPrefix || "--_NmP");
		this.disableFileAccess = !!options.disableFileAccess;
		this.disableUrlAccess = !!options.disableUrlAccess;
		this.normalizeHeaderKey = options.normalizeHeaderKey;
		/**
		* If date headers is missing and current node is the root, this value is used instead
		*/
		this.date = options.parentNode ? null : /* @__PURE__ */ new Date();
		/**
		* Root node for current mime tree
		*/
		this.rootNode = options.rootNode || this;
		/**
		* If true include Bcc in generated headers (if available)
		*/
		this.keepBcc = !!options.keepBcc;
		/**
		* If filename is specified but contentType is not (probably an attachment)
		* detect the content type from filename extension
		*/
		if (options.filename) {
			/**
			* Filename for this node. Useful with attachments
			*/
			this.filename = options.filename;
			if (!contentType) contentType = detectMimeType(this.filename.split(".").pop());
		}
		/**
		* Indicates which encoding should be used for header strings: "Q" or "B"
		*/
		this.textEncoding = (options.textEncoding || "").toString().trim().charAt(0).toUpperCase();
		/**
		* Immediate parent for this node (or undefined if not set)
		*/
		this.parentNode = options.parentNode;
		/**
		* Hostname for default message-id values
		*/
		this.hostname = options.hostname;
		/**
		* If set to 'win' then uses \r\n, if 'linux' then \n. If not set (or `raw` is used) then newlines are kept as is.
		*/
		this.newline = options.newline;
		/**
		* An array for possible child nodes
		*/
		this.childNodes = [];
		/**
		* Used for generating unique boundaries (prepended to the shared base)
		*/
		this._nodeId = ++this.rootNode.nodeCounter;
		/**
		* A list of header values for this node in the form of [{key:'', value:''}]
		*/
		this._headers = [];
		/**
		* True if the content only uses ASCII printable characters
		* @type {Boolean}
		*/
		this._isPlainText = false;
		/**
		* True if the content is plain text but has longer lines than allowed
		* @type {Boolean}
		*/
		this._hasLongLines = false;
		/**
		* If set, use instead this value for envelopes instead of generating one
		* @type {Boolean}
		*/
		this._envelope = false;
		/**
		* If set then use this value as the stream content instead of building it
		* @type {String|Buffer|Stream}
		*/
		this._raw = false;
		/**
		* Additional transform streams that the message will be piped before
		* exposing by createReadStream
		* @type {Array}
		*/
		this._transforms = [];
		/**
		* Additional process functions that the message will be piped through before
		* exposing by createReadStream. These functions are run after transforms
		* @type {Array}
		*/
		this._processFuncs = [];
		/**
		* If content type is set (or derived from the filename) add it to headers
		*/
		if (contentType) this.setHeader("Content-Type", contentType);
	}
	/**
	* Creates and appends a child node.Arguments provided are passed to MimeNode constructor
	*
	* @param [contentType] Optional content type
	* @param [options] Optional options object
	* @return Created node object
	*/
	createChild(contentType, options) {
		if (!options && typeof contentType === "object") {
			options = contentType;
			contentType = void 0;
		}
		const node = new MimeNode(contentType, options);
		this.appendChild(node);
		return node;
	}
	/**
	* Appends an existing node to the mime tree. Removes the node from an existing
	* tree if needed
	*
	* @param childNode node to be appended
	* @return Appended node object
	*/
	appendChild(childNode) {
		if (childNode.parentNode && childNode.parentNode !== this) childNode.remove();
		if (childNode.rootNode !== this.rootNode) {
			childNode.rootNode = this.rootNode;
			childNode._nodeId = ++this.rootNode.nodeCounter;
		}
		childNode.parentNode = this;
		this.childNodes.push(childNode);
		return childNode;
	}
	/**
	* Replaces current node with another node
	*
	* @param node Replacement node
	* @return Replacement node
	*/
	replace(node) {
		if (node === this) return this;
		this.parentNode.childNodes.forEach((childNode, i) => {
			if (childNode === this) {
				node.rootNode = this.rootNode;
				node.parentNode = this.parentNode;
				node._nodeId = this._nodeId;
				this.rootNode = this;
				this.parentNode = void 0;
				node.parentNode.childNodes[i] = node;
			}
		});
		return node;
	}
	/**
	* Removes current node from the mime tree
	*
	* @return removed node
	*/
	remove() {
		if (!this.parentNode) return this;
		for (let i = this.parentNode.childNodes.length - 1; i >= 0; i--) if (this.parentNode.childNodes[i] === this) {
			this.parentNode.childNodes.splice(i, 1);
			this.parentNode = void 0;
			this.rootNode = this;
			return this;
		}
	}
	/**
	* Sets a header value. If the value for selected key exists, it is overwritten.
	* You can set multiple values as well by using [{key:'', value:''}] or
	* {key: 'value'} as the first argument.
	*
	* @param key Header key or a list of key value pairs
	* @param value Header value
	* @return current node
	*/
	setHeader(key, value) {
		let added = false;
		if (!value && key && typeof key === "object") {
			if (key.key && "value" in key) this.setHeader(key.key, key.value);
			else if (Array.isArray(key)) key.forEach((i) => {
				this.setHeader(i.key, i.value);
			});
			else Object.keys(key).forEach((i) => {
				this.setHeader(i, key[i]);
			});
			return this;
		}
		key = this._normalizeHeaderKey(key);
		const headerValue = {
			key,
			value
		};
		for (let i = 0, len = this._headers.length; i < len; i++) if (this._headers[i].key === key) {
			if (!added) {
				this._headers[i] = headerValue;
				added = true;
			} else {
				this._headers.splice(i, 1);
				i--;
				len--;
			}
		}
		if (!added) this._headers.push(headerValue);
		return this;
	}
	/**
	* Adds a header value. If the value for selected key exists, the value is appended
	* as a new field and old one is not touched.
	* You can set multiple values as well by using [{key:'', value:''}] or
	* {key: 'value'} as the first argument.
	*
	* @param key Header key or a list of key value pairs
	* @param value Header value
	* @return current node
	*/
	addHeader(key, value) {
		if (!value && key && typeof key === "object") {
			if (key.key && key.value) this.addHeader(key.key, key.value);
			else if (Array.isArray(key)) key.forEach((i) => {
				this.addHeader(i.key, i.value);
			});
			else Object.keys(key).forEach((i) => {
				this.addHeader(i, key[i]);
			});
			return this;
		} else if (Array.isArray(value)) {
			value.forEach((val) => {
				this.addHeader(key, val);
			});
			return this;
		}
		this._headers.push({
			key: this._normalizeHeaderKey(key),
			value
		});
		return this;
	}
	/**
	* Retrieves the first mathcing value of a selected key
	*
	* @param key Key to search for
	* @retun Value for the key
	*/
	getHeader(key) {
		key = this._normalizeHeaderKey(key);
		for (let i = 0, len = this._headers.length; i < len; i++) if (this._headers[i].key === key) return this._headers[i].value;
	}
	/**
	* Sets body content for current node. If the value is a string, charset is added automatically
	* to Content-Type (if it is text/*). If the value is a Buffer, you need to specify
	* the charset yourself
	*
	* @param content Body content
	* @return current node
	*/
	setContent(content) {
		this.content = content;
		if (typeof this.content.pipe === "function") {
			this._contentErrorHandler = (err) => {
				this.content.removeListener("error", this._contentErrorHandler);
				this.content = err;
			};
			this.content.once("error", this._contentErrorHandler);
		} else if (typeof this.content === "string") {
			this._isPlainText = isPlainText(this.content);
			if (this._isPlainText && hasLongerLines(this.content, 76)) this._hasLongLines = true;
		}
		return this;
	}
	build(callback) {
		let promise;
		if (!callback) promise = new Promise((resolve, reject) => {
			callback = callbackPromise(resolve, reject);
		});
		const done = callback;
		const stream = this.createReadStream();
		const buf = [];
		let buflen = 0;
		let returned = false;
		stream.on("readable", () => {
			let chunk;
			while ((chunk = stream.read()) !== null) {
				buf.push(chunk);
				buflen += chunk.length;
			}
		});
		stream.once("error", (err) => {
			if (returned) return;
			returned = true;
			return done(err);
		});
		stream.once("end", (chunk) => {
			if (returned) return;
			returned = true;
			if (chunk && chunk.length) {
				buf.push(chunk);
				buflen += chunk.length;
			}
			return done(null, Buffer.concat(buf, buflen));
		});
		return promise;
	}
	getTransferEncoding() {
		let transferEncoding = false;
		const contentType = (this.getHeader("Content-Type") || "").toString().toLowerCase().trim();
		if (this.content) {
			transferEncoding = (this.getHeader("Content-Transfer-Encoding") || "").toString().toLowerCase().trim();
			if (!transferEncoding || !["base64", "quoted-printable"].includes(transferEncoding)) {
				if (/^text\//i.test(contentType)) {
					if (this._isPlainText && !this._hasLongLines) transferEncoding = "7bit";
					else if (typeof this.content === "string" || this.content instanceof Buffer) transferEncoding = this._getTextEncoding(this.content) === "Q" ? "quoted-printable" : "base64";
					else transferEncoding = this.textEncoding === "B" ? "base64" : "quoted-printable";
				} else if (!/^(multipart|message)\//i.test(contentType)) transferEncoding = transferEncoding || "base64";
			}
		}
		return transferEncoding;
	}
	/**
	* Builds the header block for the mime node. Append \r\n\r\n before writing the content
	*
	* @returns Headers
	*/
	buildHeaders() {
		const transferEncoding = this.getTransferEncoding();
		const headers = [];
		if (transferEncoding) this.setHeader("Content-Transfer-Encoding", transferEncoding);
		if (this.filename && !this.getHeader("Content-Disposition")) this.setHeader("Content-Disposition", "attachment");
		if (this.rootNode === this) {
			if (!this.getHeader("Date")) this.setHeader("Date", this.date.toUTCString().replace(/GMT/, "+0000"));
			this.messageId();
			if (!this.getHeader("MIME-Version")) this.setHeader("MIME-Version", "1.0");
			for (let i = this._headers.length - 2; i >= 0; i--) {
				const header = this._headers[i];
				if (header.key === "Content-Type") {
					this._headers.splice(i, 1);
					this._headers.push(header);
				}
			}
		}
		this._headers.forEach((header) => {
			let key = header.key;
			let value = header.value;
			let structured;
			let param;
			const options = {};
			if (value && typeof value === "object" && !FORMATTED_HEADERS.includes(key)) {
				copyOwnKeys(options, value, (optionKey) => optionKey === "value");
				value = (value.value || "").toString();
				if (!value.trim()) return;
			}
			if (options.prepared) {
				if (options.foldLines) headers.push(foldLines(key + ": " + value));
				else headers.push(key + ": " + value);
				return;
			}
			switch (header.key) {
				case "Content-Disposition":
					structured = parseHeaderValue(value);
					if (this.filename) structured.params.filename = this.filename;
					value = buildHeaderValue(structured);
					break;
				case "Content-Type":
					structured = parseHeaderValue(value);
					structured.value = (structured.value || "").toString().replace(/[\x00-\x1f\x7f]/g, "");
					this._handleContentType(structured);
					if (structured.value.match(/^text\/plain\b/) && typeof this.content === "string" && /[\u0080-\uFFFF]/.test(this.content)) structured.params.charset = "utf-8";
					value = buildHeaderValue(structured);
					if (this.filename) {
						param = /[\x00-\x1f\x7f]/.test(this.filename) ? encodeWord(this.filename, this._getTextEncoding(this.filename), 52) : this._encodeWords(this.filename);
						if (param !== this.filename || /[\s'"\\;:/=(),<>@[\]?]|^-/.test(param)) param = JSON.stringify(param);
						value += "; name=" + param;
					}
					break;
				case "Bcc": if (!this.keepBcc) return;
			}
			value = this._encodeHeaderValue(key, value);
			if (!(value || "").toString().trim()) return;
			if (typeof this.normalizeHeaderKey === "function") {
				const normalized = this.normalizeHeaderKey(key, value);
				const cleaned = typeof normalized === "string" ? normalized.replace(/[\x00-\x1f\x7f]/g, "") : "";
				if (cleaned) key = cleaned;
			}
			headers.push(foldLines(key + ": " + value, 76));
		});
		return headers.join("\r\n");
	}
	/**
	* Streams the rfc2822 message from the current node. If this is a root node,
	* mandatory header fields are set if missing (Date, Message-Id, MIME-Version)
	*
	* @return Compiled message
	*/
	createReadStream(options) {
		options = options || {};
		const stream = new PassThrough(options);
		let outputStream = stream;
		let transform;
		this.stream(stream, options, (err) => {
			if (err) {
				outputStream.emit("error", err);
				return;
			}
			stream.end();
		});
		for (let i = 0, len = this._transforms.length; i < len; i++) {
			transform = typeof this._transforms[i] === "function" ? this._transforms[i]() : this._transforms[i];
			outputStream.once("error", (err) => {
				transform.emit("error", err);
			});
			outputStream = outputStream.pipe(transform);
		}
		transform = new LastNewline();
		outputStream.once("error", (err) => {
			transform.emit("error", err);
		});
		outputStream = outputStream.pipe(transform);
		for (let i = 0, len = this._processFuncs.length; i < len; i++) {
			transform = this._processFuncs[i];
			outputStream = transform(outputStream);
		}
		if (this.newline) {
			const newlineTransform = [
				"win",
				"windows",
				"dos",
				"\r\n"
			].includes(this.newline.toString().toLowerCase()) ? new LeWindows() : new LeUnix();
			const stream = outputStream.pipe(newlineTransform);
			outputStream.on("error", (err) => stream.emit("error", err));
			return stream;
		}
		return outputStream;
	}
	/**
	* Appends a transform stream object to the transforms list. Final output
	* is passed through this stream before exposing
	*
	* @param transform Read-Write stream
	*/
	transform(transform) {
		this._transforms.push(transform);
	}
	/**
	* Appends a post process function. The functon is run after transforms and
	* uses the following syntax
	*
	*   processFunc(input) -> outputStream
	*
	* @param processFunc Read-Write stream
	*/
	processFunc(processFunc) {
		this._processFuncs.push(processFunc);
	}
	stream(outputStream, options, done) {
		const transferEncoding = this.getTransferEncoding();
		let contentStream;
		let localStream;
		let returned = false;
		const callback = (err) => {
			if (returned) return;
			returned = true;
			done(err);
		};
		const finalize = () => {
			let childId = 0;
			const processChildNode = () => {
				if (childId >= this.childNodes.length) {
					outputStream.write("\r\n--" + this.boundary + "--\r\n");
					return callback();
				}
				const child = this.childNodes[childId++];
				outputStream.write((childId > 1 ? "\r\n" : "") + "--" + this.boundary + "\r\n");
				child.stream(outputStream, options, (err) => {
					if (err) return callback(err);
					setImmediate(processChildNode);
				});
			};
			if (this.multipart) setImmediate(processChildNode);
			else return callback();
		};
		const sendContent = () => {
			if (this.content) {
				if (Object.prototype.toString.call(this.content) === "[object Error]") return callback(this.content);
				if (typeof this.content.pipe === "function") {
					this.content.removeListener("error", this._contentErrorHandler);
					this._contentErrorHandler = (err) => callback(err);
					this.content.once("error", this._contentErrorHandler);
				}
				const createStream = () => {
					if (["quoted-printable", "base64"].includes(transferEncoding)) {
						contentStream = new (transferEncoding === "base64" ? base64_exports : qp_exports).Encoder(options);
						contentStream.pipe(outputStream, { end: false });
						contentStream.once("end", finalize);
						contentStream.once("error", (err) => callback(err));
						localStream = this._getStream(this.content);
						localStream.pipe(contentStream);
					} else {
						localStream = this._getStream(this.content);
						localStream.pipe(outputStream, { end: false });
						localStream.once("end", finalize);
					}
					localStream.once("error", (err) => callback(err));
				};
				if (this.content._resolve) {
					const chunks = [];
					let chunklen = 0;
					let returned = false;
					const sourceStream = this._getStream(this.content);
					sourceStream.on("error", (err) => {
						if (returned) return;
						returned = true;
						callback(err);
					});
					sourceStream.on("readable", () => {
						let chunk;
						while ((chunk = sourceStream.read()) !== null) {
							chunks.push(chunk);
							chunklen += chunk.length;
						}
					});
					sourceStream.on("end", () => {
						if (returned) return;
						returned = true;
						this.content._resolve = false;
						this.content._resolvedValue = Buffer.concat(chunks, chunklen);
						setImmediate(createStream);
					});
				} else setImmediate(createStream);
				return;
			}
			return setImmediate(finalize);
		};
		if (this._raw) setImmediate(() => {
			if (Object.prototype.toString.call(this._raw) === "[object Error]") return callback(this._raw);
			if (typeof this._raw.pipe === "function") this._raw.removeListener("error", this._contentErrorHandler);
			const raw = this._getStream(this._raw);
			raw.pipe(outputStream, { end: false });
			raw.on("error", (err) => outputStream.emit("error", err));
			raw.on("end", finalize);
		});
		else {
			outputStream.write(this.buildHeaders() + "\r\n\r\n");
			setImmediate(sendContent);
		}
	}
	/**
	* Sets envelope to be used instead of the generated one
	*
	* @return SMTP envelope in the form of {from: 'from@example.com', to: ['to@example.com']}
	*/
	setEnvelope(envelope) {
		let list;
		this._envelope = {
			from: false,
			to: []
		};
		if (envelope.from) {
			list = [];
			this._convertAddresses(this._parseEnvelopeAddresses(envelope.from), list);
			list = list.filter((address) => address && address.address);
			if (list.length && list[0]) this._envelope.from = list[0].address;
		}
		const seenRecipients = /* @__PURE__ */ new Set();
		const recipients = [];
		[
			"to",
			"cc",
			"bcc"
		].forEach((key) => {
			if (envelope[key]) this._convertAddresses(this._parseEnvelopeAddresses(envelope[key]), recipients, seenRecipients);
		});
		this._envelope.to = recipients.map((to) => to.address).filter((address) => address);
		const standardFields = [
			"to",
			"cc",
			"bcc",
			"from"
		];
		copyOwnKeys(this._envelope, envelope, (key) => standardFields.includes(key));
		return this;
	}
	/**
	* Generates and returns an object with parsed address fields
	*
	* @return Address object
	*/
	getAddresses() {
		const addresses = {};
		const seenByKey = /* @__PURE__ */ new Map();
		this._headers.forEach((header) => {
			const key = header.key.toLowerCase();
			if ([
				"from",
				"sender",
				"reply-to",
				"to",
				"cc",
				"bcc"
			].includes(key)) {
				if (!Array.isArray(addresses[key])) {
					addresses[key] = [];
					seenByKey.set(key, /* @__PURE__ */ new Set());
				}
				this._convertAddresses(this._parseAddresses(header.value), addresses[key], seenByKey.get(key));
			}
		});
		return addresses;
	}
	/**
	* Generates and returns SMTP envelope with the sender address and a list of recipients addresses
	*
	* @return SMTP envelope in the form of {from: 'from@example.com', to: ['to@example.com']}
	*/
	getEnvelope() {
		if (this._envelope) return this._envelope;
		const envelope = {
			from: false,
			to: []
		};
		const seenRecipients = /* @__PURE__ */ new Set();
		const recipients = [];
		this._headers.forEach((header) => {
			const list = [];
			if (header.key === "From" || !envelope.from && ["Reply-To", "Sender"].includes(header.key)) {
				this._convertAddresses(this._parseAddresses(header.value), list);
				if (list.length && list[0]) envelope.from = list[0].address;
			} else if ([
				"To",
				"Cc",
				"Bcc"
			].includes(header.key)) this._convertAddresses(this._parseAddresses(header.value), recipients, seenRecipients);
		});
		envelope.to = recipients.map((to) => to.address);
		return envelope;
	}
	/**
	* Returns Message-Id value. If it does not exist, then creates one
	*
	* @return Message-Id value
	*/
	messageId() {
		let messageId = this.getHeader("Message-ID");
		if (!messageId) {
			messageId = this._generateMessageId();
			this.setHeader("Message-ID", messageId);
		}
		return messageId;
	}
	/**
	* Sets pregenerated content that will be used as the output of this node
	*
	* @param raw Raw MIME contents
	*/
	setRaw(raw) {
		this._raw = raw;
		if (this._raw && typeof this._raw.pipe === "function") {
			this._contentErrorHandler = (err) => {
				this._raw.removeListener("error", this._contentErrorHandler);
				this._raw = err;
			};
			this._raw.once("error", this._contentErrorHandler);
		}
		return this;
	}
	/**
	* Checks an access policy flag for this node and every node above it. The flags are set
	* from the options the node was built with, and createChild only ever sees the options
	* the caller passed, so a child of a closed tree starts out open. Reading the answer off
	* the parent chain keeps it right whatever order the tree was assembled in.
	*
	* @param flag Either 'disableFileAccess' or 'disableUrlAccess'
	* @return true if this node or an ancestor closed that access
	* @internal
	*/
	_accessDisabled(flag) {
		let node = this;
		while (node) {
			if (node[flag]) return true;
			node = node.parentNode;
		}
		return false;
	}
	/**
	* Detects and returns handle to a stream related with the content.
	*
	* @param content Node content
	* @returns Stream object
	* @internal
	*/
	_getStream(content) {
		let contentStream;
		if (content._resolvedValue) {
			contentStream = new PassThrough();
			setImmediate(() => {
				try {
					contentStream.end(content._resolvedValue);
				} catch (_err) {
					contentStream.emit("error", _err);
				}
			});
			return contentStream;
		}
		if (typeof content.pipe === "function") return content;
		if (content && typeof content.path === "string" && !content.href) {
			if (this._accessDisabled("disableFileAccess")) {
				contentStream = new PassThrough();
				setImmediate(() => {
					const err = /* @__PURE__ */ new Error("File access rejected for " + content.path);
					err.code = EFILEACCESS;
					contentStream.emit("error", err);
				});
				return contentStream;
			}
			return fs.createReadStream(content.path);
		}
		if (content && typeof content.href === "string") {
			if (this._accessDisabled("disableUrlAccess")) {
				contentStream = new PassThrough();
				setImmediate(() => {
					const err = /* @__PURE__ */ new Error("Url access rejected for " + content.href);
					err.code = EURLACCESS;
					contentStream.emit("error", err);
				});
				return contentStream;
			}
			return nmfetch(content.href, {
				headers: content.httpHeaders,
				tls: content.tls
			});
		}
		contentStream = new PassThrough();
		setImmediate(() => {
			try {
				contentStream.end(content || "");
			} catch (_err) {
				contentStream.emit("error", _err);
			}
		});
		return contentStream;
	}
	/**
	* Parses addresses. Takes in a single address or an array or an
	* array of address arrays (eg. To: [[first group], [second group],...])
	*
	* @param addresses Addresses to be parsed
	* @return An array of address objects
	* @internal
	*/
	_parseAddresses(addresses) {
		const flattened = [];
		const seen = /* @__PURE__ */ new WeakSet();
		const stack = [];
		const enter = (list) => {
			if (!seen.has(list)) {
				seen.add(list);
				stack.push({
					list,
					pos: 0
				});
			}
		};
		enter(Array.isArray(addresses) ? addresses : [addresses]);
		while (stack.length) {
			const frame = stack[stack.length - 1];
			if (frame.pos >= frame.list.length) {
				stack.pop();
				continue;
			}
			const address = frame.list[frame.pos++];
			if (Array.isArray(address)) {
				enter(address);
				continue;
			}
			if (address && address.address) {
				const normalized = this._normalizeAddress(address.address);
				if (normalized === address.address && typeof address.name === "string") {
					flattened.push(address);
					continue;
				}
				const copy = copyOwnKeys({}, address);
				copy.address = normalized;
				copy.name = address.name || "";
				flattened.push(copy);
				continue;
			}
			const parsed = this._normalizeParsedAddresses(addressparser(address));
			for (let i = 0; i < parsed.length; i++) flattened.push(parsed[i]);
		}
		return flattened;
	}
	/**
	* Normalizes the addresses of a freshly parsed address list, groups included.
	*
	* Everything this method returns carries a normalized address, whether it arrived as an
	* object or was parsed out of a header value. Without this the two shapes disagree, and
	* a consumer reading the parsed form back is handed the ambiguous
	* 'user@evil.com@good.com' that the header and the envelope no longer carry.
	*
	* @param parsed An array of address objects, as returned by addressparser
	* @return The same array, with every address normalized
	* @internal
	*/
	_normalizeParsedAddresses(parsed) {
		parsed.forEach((entry) => {
			if (entry.address) entry.address = this._normalizeAddress(entry.address);
			else if (entry.group) this._normalizeParsedAddresses(entry.group);
		});
		return parsed;
	}
	/**
	* Parses the addresses of an explicitly set envelope.
	*
	* An envelope value is an addr-spec and never a display name, so a bare local username
	* such as 'root' is the address here. Header parsing has to read the same value as a
	* display name, as a value with no '@' in it can not be an addr-spec in a header.
	*
	* @param addresses Addresses to be parsed
	* @return An array of address objects
	* @internal
	*/
	_parseEnvelopeAddresses(addresses) {
		return this._parseAddresses(addresses).map((entry) => {
			if (entry.address || entry.group || !entry.name || /[\s@]/.test(entry.name)) return entry;
			return {
				address: this._normalizeAddress(entry.name),
				name: ""
			};
		});
	}
	/**
	* Normalizes a header key, uses Camel-Case form, except for uppercase MIME-
	*
	* @param key Key to be normalized
	* @return key in Camel-Case form
	* @internal
	*/
	_normalizeHeaderKey(key) {
		key = (key || "").toString().replace(/\r?\n|\r/g, " ").replace(/[\x00-\x1f\x7f]/g, "").trim().toLowerCase().replace(/^X-SMTPAPI$|^(MIME|DKIM|ARC|BIMI)\b|^[a-z]|-(SPF|FBL|ID|MD5)$|-[a-z]/gi, (c) => c.toUpperCase()).replace(/^Content-Features$/i, "Content-features");
		return key;
	}
	/**
	* Checks if the content type is multipart and defines boundary if needed.
	* Doesn't return anything, modifies object argument instead.
	*
	* @param structured Parsed header value for 'Content-Type' key
	* @internal
	*/
	_handleContentType(structured) {
		this.contentType = structured.value.trim().toLowerCase();
		this.multipart = /^multipart\//i.test(this.contentType) ? this.contentType.substr(this.contentType.indexOf("/") + 1) : false;
		if (this.multipart) {
			const declared = _stripBoundaryControls(structured.params.boundary || this.boundary || "");
			this.boundary = structured.params.boundary = declared || _stripBoundaryControls(this._generateBoundary());
		} else this.boundary = false;
	}
	/**
	* Generates a multipart boundary value
	*
	* @return boundary value
	* @internal
	*/
	_generateBoundary() {
		return _stripBoundaryControls(this.rootNode.boundaryPrefix + "-" + this.rootNode.baseBoundary) + "-Part_" + this._nodeId;
	}
	/**
	* Encodes a header value for use in the generated rfc2822 email.
	*
	* @param key Header key
	* @param value Header value
	* @internal
	*/
	_encodeHeaderValue(key, value) {
		key = this._normalizeHeaderKey(key);
		switch (key) {
			case "From":
			case "Sender":
			case "To":
			case "Cc":
			case "Bcc":
			case "Reply-To": return this._convertAddresses(this._parseAddresses(value));
			case "Message-ID":
			case "In-Reply-To":
			case "Content-Id":
				value = (value || "").toString().replace(/\r?\n|\r/g, " ").replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g, "");
				if (value.charAt(0) !== "<") value = "<" + value;
				if (value.charAt(value.length - 1) !== ">") value = value + ">";
				return value;
			case "References":
				value = [].concat.apply([], [].concat(value || "").map((elm) => {
					elm = (elm || "").toString().replace(/\r?\n|\r/g, " ").replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g, "").trim();
					return elm.replace(/<[^>]*>/g, (str) => str.replace(/\s/g, "")).split(/\s+/);
				})).map((elm) => {
					if (elm.charAt(0) !== "<") elm = "<" + elm;
					if (elm.charAt(elm.length - 1) !== ">") elm = elm + ">";
					return elm;
				});
				return value.join(" ").trim();
			case "Date":
				if (Object.prototype.toString.call(value) === "[object Date]") return value.toUTCString().replace(/GMT/, "+0000");
				value = (value || "").toString().replace(/\r?\n|\r/g, " ");
				return this._encodeHeaderText(value);
			case "Content-Type":
			case "Content-Disposition": return (value || "").toString().replace(/\r?\n|\r/g, " ");
			default:
				value = (value || "").toString().replace(/\r?\n|\r/g, " ");
				return this._encodeHeaderText(value);
		}
	}
	/**
	* Rebuilds address object using punycode and other adjustments
	*
	* @param addresses An array of address objects
	* @param [uniqueList] An array to be populated with addresses
	* @return address string
	* @internal
	*/
	_convertAddresses(addresses, uniqueList, seenAddresses) {
		const values = [];
		uniqueList = uniqueList || [];
		if (!seenAddresses) {
			seenAddresses = /* @__PURE__ */ new Set();
			for (let i = 0; i < uniqueList.length; i++) seenAddresses.add(uniqueList[i].address);
		}
		[].concat(addresses || []).forEach((address) => {
			if (address.address) {
				address.address = this._normalizeAddress(address.address);
				if (!address.name) values.push(PLAIN_ADDRESS.test(address.address) ? address.address : `<${address.address}>`);
				else values.push(`${this._encodeAddressName(address.name)} <${address.address}>`);
				if (!seenAddresses.has(address.address)) {
					seenAddresses.add(address.address);
					uniqueList.push(address);
				}
			} else if (address.group) {
				const groupListAddresses = (address.group.length ? this._convertAddresses(address.group, uniqueList, seenAddresses) : "").trim();
				values.push(`${this._encodeAddressName(address.name)}:${groupListAddresses};`);
			}
		});
		return values.join(", ");
	}
	/**
	* Normalizes an email address
	*
	* @param address An array of address objects
	* @return address string
	* @internal
	*/
	_normalizeAddress(address) {
		address = (address || "").toString().replace(/[\x00-\x1F\x7F<>]+/g, " ").trim();
		if (!address) return address;
		const lastAt = address.lastIndexOf("@");
		if (lastAt < 0) return this._normalizeLocalPart(address);
		const user = address.substr(0, lastAt);
		const domain = address.substr(lastAt + 1);
		let encodedDomain = domain;
		const smtputf8 = /[\x80-\uFFFF]/.test(user);
		try {
			encodedDomain = normalizeDomain(domain.toLowerCase(), smtputf8);
		} catch (_err) {}
		return `${this._normalizeLocalPart(user)}@${encodedDomain}`;
	}
	/**
	* Normalizes the local part of an address into a form that can be emitted as is.
	*
	* A local part is either a dot-atom or a quoted-string, anything else is not a valid
	* addr-spec. The quotes of a quoted local part get lost along the way, and a bare
	* 'user@evil.com@good.com' leaves it to the receiver which '@' splits the domain off,
	* while the split here is always at the last one. So whatever is not already one of
	* the two valid forms goes back out as a quoted-string.
	*
	* @param user Local part of an address
	* @return Local part as a dot-atom or as a quoted-string
	* @internal
	*/
	_normalizeLocalPart(user) {
		if (DOT_ATOM.test(user) || QUOTED_STRING.test(user)) return user;
		return quoteString(user);
	}
	/**
	* If needed, mime encodes the name part
	*
	* @param name Name part of an address
	* @returns Mime word encoded string if needed
	* @internal
	*/
	_encodeAddressName(name) {
		if (!/^[\w ]*$/.test(name)) {
			if (/^[\x20-\x7e]*$/.test(name)) return quoteString(name);
			else return encodeWord(name, this._getTextEncoding(name), 52);
		}
		return name;
	}
	/**
	* Encodes an unstructured header value. Such a value can only carry VCHAR and WSP, so a
	* control char or DEL has to be forced into the mime encoded word that a non-ascii value
	* would get anyway. HT stays as it is, it is valid folding whitespace here.
	*
	* @param value Header value to encode
	* @returns Mime word encoded string if needed
	* @internal
	*/
	_encodeHeaderText(value) {
		return /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(value) ? encodeWord(value, this._getTextEncoding(value), 52) : this._encodeWords(value);
	}
	/**
	* If needed, mime encodes the name part
	*
	* @param name Name part of an address
	* @returns Mime word encoded string if needed
	* @internal
	*/
	_encodeWords(value) {
		return encodeWords(value, this._getTextEncoding(value), 52, true);
	}
	/**
	* Detects best mime encoding for a text value
	*
	* @param value Value to check for
	* @return either 'Q' or 'B'
	* @internal
	*/
	_getTextEncoding(value) {
		value = (value || "").toString();
		if (this.textEncoding) return this.textEncoding;
		let nonLatinLen = 0;
		let latinLen = 0;
		for (let i = 0, len = value.length; i < len; i++) {
			const code = value.charCodeAt(i);
			if (code >= 0 && code <= 8 || code === 11 || code === 12 || code >= 14 && code <= 31 || code >= 128) nonLatinLen++;
			else if (code >= 65 && code <= 90 || code >= 97 && code <= 122) latinLen++;
		}
		return nonLatinLen < latinLen ? "Q" : "B";
	}
	/**
	* Generates a message id
	*
	* @return Random Message-ID value
	* @internal
	*/
	_generateMessageId() {
		return "<" + [
			2,
			2,
			2,
			6
		].reduce((prev, len) => prev + "-" + crypto.randomBytes(len).toString("hex"), crypto.randomBytes(4).toString("hex")) + "@" + (this.getEnvelope().from || this.hostname || "localhost").split("@").pop() + ">";
	}
};
//#endregion
//#region ../../node_modules/.pnpm/nodemailer@10.0.10/node_modules/nodemailer/dist/esm/mail-composer/index.js
/**
* Creates the object for composing a MimeNode instance out from the mail options
*
* @constructor
* @param mail Mail options
*/
/**
* Tells whether a content value is a content descriptor object (something to load or to
* use as is) rather than the content itself
*/
function isContentObject(value) {
	const content = value;
	return typeof value === "object" && !!(content.content || content.path || content.href || content.raw);
}
var MailComposer = class {
	constructor(mail) {
		this.mail = mail || {};
		this.message = false;
	}
	/**
	* Builds MimeNode instance
	*/
	compile() {
		this._alternatives = this.getAlternatives();
		this._htmlNode = this._alternatives.filter((alternative) => /^text\/html\b/i.test(alternative.contentType)).pop();
		this._attachments = this.getAttachments(!!this._htmlNode);
		this._useRelated = !!(this._htmlNode && this._attachments.related.length);
		this._useAlternative = this._alternatives.length > 1;
		this._useMixed = this._attachments.attached.length > 1 || this._alternatives.length && this._attachments.attached.length === 1;
		if (this.mail.raw) this.message = new MimeNode("message/rfc822", {
			newline: this.mail.newline,
			disableUrlAccess: this.mail.disableUrlAccess,
			disableFileAccess: this.mail.disableFileAccess
		}).setRaw(this.mail.raw);
		else if (this._useMixed) this.message = this._createMixed();
		else if (this._useAlternative) this.message = this._createAlternative();
		else if (this._useRelated) this.message = this._createRelated();
		else this.message = this._createContentNode(false, [].concat(this._alternatives || []).concat(this._attachments.attached || []).shift() || {
			contentType: "text/plain",
			content: ""
		});
		if (this.mail.headers) this.message.addHeader(this.mail.headers);
		[
			"from",
			"sender",
			"to",
			"cc",
			"bcc",
			"reply-to",
			"in-reply-to",
			"references",
			"subject",
			"message-id",
			"date"
		].forEach((header) => {
			const key = header.replace(/-(\w)/g, (o, c) => c.toUpperCase());
			if (this.mail[key]) this.message.setHeader(header, this.mail[key]);
		});
		if (this.mail.envelope) this.message.setEnvelope(this.mail.envelope);
		this.message.messageId();
		return this.message;
	}
	/**
	* List all attachments. Resulting attachment objects can be used as input for MimeNode nodes
	*
	* @param findRelated If true separate related attachments from attached ones
	* @returns An object of arrays (`related` and `attached`)
	*/
	getAttachments(findRelated) {
		let eventObject;
		const attachments = [].concat(this.mail.attachments || []).map((attachment, i) => {
			if (/^data:/i.test(attachment.path || attachment.href)) attachment = this._processDataUrl(attachment);
			const contentType = attachment.contentType || detectMimeType(attachment.filename || attachment.path || attachment.href || "bin");
			const isImage = /^image\//i.test(contentType);
			const isMessageNode = /^message\//i.test(contentType);
			const contentDisposition = attachment.contentDisposition || (isMessageNode || isImage && attachment.cid ? "inline" : "attachment");
			let contentTransferEncoding;
			if ("contentTransferEncoding" in attachment) contentTransferEncoding = attachment.contentTransferEncoding;
			else if (isMessageNode) contentTransferEncoding = "8bit";
			else contentTransferEncoding = "base64";
			const data = {
				contentType,
				contentDisposition,
				contentTransferEncoding
			};
			if (attachment.filename) data.filename = attachment.filename;
			else if (!isMessageNode && attachment.filename !== false) {
				data.filename = (attachment.path || attachment.href || "").split(/[/\\]/).pop().split("?").shift() || "attachment-" + (i + 1);
				if (data.filename.indexOf(".") < 0) data.filename += "." + detectExtension(data.contentType);
			}
			if (/^https?:\/\//i.test(attachment.path)) {
				attachment.href = attachment.path;
				attachment.path = void 0;
			}
			if (attachment.cid) data.cid = attachment.cid;
			if (attachment.raw) data.raw = attachment.raw;
			else if (attachment.path) data.content = { path: attachment.path };
			else if (attachment.href) data.content = {
				href: attachment.href,
				httpHeaders: attachment.httpHeaders,
				tls: attachment.tls
			};
			else data.content = attachment.content || "";
			if (attachment.encoding) data.encoding = attachment.encoding;
			if (attachment.headers) data.headers = attachment.headers;
			return data;
		});
		if (this.mail.icalEvent) {
			eventObject = Object.assign({}, this._getIcalEvent());
			eventObject.contentType = "application/ics";
			if (!eventObject.headers) eventObject.headers = {};
			eventObject.filename = eventObject.filename || "invite.ics";
			eventObject.headers["Content-Disposition"] = "attachment";
			eventObject.headers["Content-Transfer-Encoding"] = "base64";
		}
		if (!findRelated) return {
			attached: attachments.concat(eventObject || []),
			related: []
		};
		return {
			attached: attachments.filter((attachment) => !attachment.cid).concat(eventObject || []),
			related: attachments.filter((attachment) => !!attachment.cid)
		};
	}
	/**
	* Returns the icalEvent value with `path`/`href`/data uri input normalized into
	* a `content` entry, the same way as for regular attachments. The same event is
	* included twice (as a text/calendar alternative and as an application/ics
	* attachment), so the shared content object is marked to be resolved just once
	* and the buffered result is reused by the second node.
	*
	* @returns Normalized icalEvent data
	* @internal
	*/
	_getIcalEvent() {
		if (!this._icalEvent) {
			let icalEvent;
			if (isContentObject(this.mail.icalEvent)) icalEvent = copyOwnKeys({}, this.mail.icalEvent);
			else icalEvent = { content: this.mail.icalEvent };
			if (/^data:/i.test(icalEvent.path || icalEvent.href)) icalEvent = this._processDataUrl(icalEvent);
			if (/^https?:\/\//i.test(icalEvent.path)) {
				icalEvent.href = icalEvent.path;
				icalEvent.path = void 0;
			}
			if (!icalEvent.raw) {
				if (icalEvent.path) {
					icalEvent.content = { path: icalEvent.path };
					icalEvent.path = void 0;
				} else if (icalEvent.href) {
					icalEvent.content = {
						href: icalEvent.href,
						httpHeaders: icalEvent.httpHeaders,
						tls: icalEvent.tls
					};
					icalEvent.href = void 0;
				}
			}
			if (icalEvent.content && typeof icalEvent.content === "object") icalEvent.content._resolve = true;
			this._icalEvent = icalEvent;
		}
		return this._icalEvent;
	}
	/**
	* List alternatives. Resulting objects can be used as input for MimeNode nodes
	*
	* @returns An array of alternative elements. Includes the `text` and `html` values as well
	*/
	getAlternatives() {
		const alternatives = [];
		let text, html, watchHtml, amp, eventObject;
		if (this.mail.text) {
			if (isContentObject(this.mail.text)) text = this.mail.text;
			else text = { content: this.mail.text };
			text.contentType = "text/plain; charset=utf-8";
		}
		if (this.mail.watchHtml) {
			if (isContentObject(this.mail.watchHtml)) watchHtml = this.mail.watchHtml;
			else watchHtml = { content: this.mail.watchHtml };
			watchHtml.contentType = "text/watch-html; charset=utf-8";
		}
		if (this.mail.amp) {
			if (isContentObject(this.mail.amp)) amp = this.mail.amp;
			else amp = { content: this.mail.amp };
			amp.contentType = "text/x-amp-html; charset=utf-8";
		}
		if (this.mail.icalEvent) {
			eventObject = Object.assign({}, this._getIcalEvent());
			eventObject.filename = false;
			eventObject.contentType = "text/calendar; charset=utf-8; method=" + (eventObject.method || "PUBLISH").toString().trim().toUpperCase();
			if (!eventObject.headers) eventObject.headers = {};
		}
		if (this.mail.html) {
			if (isContentObject(this.mail.html)) html = this.mail.html;
			else html = { content: this.mail.html };
			html.contentType = "text/html; charset=utf-8";
		}
		[].concat(text || []).concat(watchHtml || []).concat(amp || []).concat(html || []).concat(eventObject || []).concat(this.mail.alternatives || []).forEach((alternative) => {
			if (/^data:/i.test(alternative.path || alternative.href)) alternative = this._processDataUrl(alternative);
			const data = {
				contentType: alternative.contentType || detectMimeType(alternative.filename || alternative.path || alternative.href || "txt"),
				contentTransferEncoding: alternative.contentTransferEncoding
			};
			if (alternative.filename) data.filename = alternative.filename;
			if (/^https?:\/\//i.test(alternative.path)) {
				alternative.href = alternative.path;
				alternative.path = void 0;
			}
			if (alternative.raw) data.raw = alternative.raw;
			else if (alternative.path) data.content = { path: alternative.path };
			else if (alternative.href) data.content = {
				href: alternative.href,
				httpHeaders: alternative.httpHeaders,
				tls: alternative.tls
			};
			else data.content = alternative.content || "";
			if (alternative.encoding) data.encoding = alternative.encoding;
			if (alternative.headers) data.headers = alternative.headers;
			alternatives.push(data);
		});
		return alternatives;
	}
	/**
	* Builds multipart/mixed node. It should always contain different type of elements on the same level
	* eg. text + attachments
	*
	* @param parentNode Parent for this note. If it does not exist, a root node is created
	* @returns MimeNode node element
	* @internal
	*/
	_createMixed(parentNode) {
		const node = parentNode ? parentNode.createChild("multipart/mixed", {
			disableUrlAccess: this.mail.disableUrlAccess,
			disableFileAccess: this.mail.disableFileAccess,
			normalizeHeaderKey: this.mail.normalizeHeaderKey,
			newline: this.mail.newline
		}) : new MimeNode("multipart/mixed", {
			baseBoundary: this.mail.baseBoundary,
			textEncoding: this.mail.textEncoding,
			boundaryPrefix: this.mail.boundaryPrefix,
			disableUrlAccess: this.mail.disableUrlAccess,
			disableFileAccess: this.mail.disableFileAccess,
			normalizeHeaderKey: this.mail.normalizeHeaderKey,
			newline: this.mail.newline
		});
		if (this._useAlternative) this._createAlternative(node);
		else if (this._useRelated) this._createRelated(node);
		[].concat(!this._useAlternative && this._alternatives || []).concat(this._attachments.attached || []).forEach((element) => {
			if (!this._useRelated || element !== this._htmlNode) this._createContentNode(node, element);
		});
		return node;
	}
	/**
	* Builds multipart/alternative node. It should always contain same type of elements on the same level
	* eg. text + html view of the same data
	*
	* @param parentNode Parent for this note. If it does not exist, a root node is created
	* @returns MimeNode node element
	* @internal
	*/
	_createAlternative(parentNode) {
		const node = parentNode ? parentNode.createChild("multipart/alternative", {
			disableUrlAccess: this.mail.disableUrlAccess,
			disableFileAccess: this.mail.disableFileAccess,
			normalizeHeaderKey: this.mail.normalizeHeaderKey,
			newline: this.mail.newline
		}) : new MimeNode("multipart/alternative", {
			baseBoundary: this.mail.baseBoundary,
			textEncoding: this.mail.textEncoding,
			boundaryPrefix: this.mail.boundaryPrefix,
			disableUrlAccess: this.mail.disableUrlAccess,
			disableFileAccess: this.mail.disableFileAccess,
			normalizeHeaderKey: this.mail.normalizeHeaderKey,
			newline: this.mail.newline
		});
		this._alternatives.forEach((alternative) => {
			if (this._useRelated && this._htmlNode === alternative) this._createRelated(node);
			else this._createContentNode(node, alternative);
		});
		return node;
	}
	/**
	* Builds multipart/related node. It should always contain html node with related attachments
	*
	* @param parentNode Parent for this note. If it does not exist, a root node is created
	* @returns MimeNode node element
	* @internal
	*/
	_createRelated(parentNode) {
		const node = parentNode ? parentNode.createChild("multipart/related; type=\"text/html\"", {
			disableUrlAccess: this.mail.disableUrlAccess,
			disableFileAccess: this.mail.disableFileAccess,
			normalizeHeaderKey: this.mail.normalizeHeaderKey,
			newline: this.mail.newline
		}) : new MimeNode("multipart/related; type=\"text/html\"", {
			baseBoundary: this.mail.baseBoundary,
			textEncoding: this.mail.textEncoding,
			boundaryPrefix: this.mail.boundaryPrefix,
			disableUrlAccess: this.mail.disableUrlAccess,
			disableFileAccess: this.mail.disableFileAccess,
			normalizeHeaderKey: this.mail.normalizeHeaderKey,
			newline: this.mail.newline
		});
		this._createContentNode(node, this._htmlNode);
		this._attachments.related.forEach((alternative) => this._createContentNode(node, alternative));
		return node;
	}
	/**
	* Creates a regular node with contents
	*
	* @param parentNode Parent for this note. If it does not exist, a root node is created
	* @param element Node data
	* @returns MimeNode node element
	* @internal
	*/
	_createContentNode(parentNode, element) {
		element = element || {};
		element.content = element.content || "";
		const encoding = (element.encoding || "utf8").toString().toLowerCase().replace(/[-_\s]/g, "");
		const node = parentNode ? parentNode.createChild(element.contentType, {
			filename: element.filename,
			textEncoding: this.mail.textEncoding,
			disableUrlAccess: this.mail.disableUrlAccess,
			disableFileAccess: this.mail.disableFileAccess,
			normalizeHeaderKey: this.mail.normalizeHeaderKey,
			newline: this.mail.newline
		}) : new MimeNode(element.contentType, {
			filename: element.filename,
			baseBoundary: this.mail.baseBoundary,
			textEncoding: this.mail.textEncoding,
			boundaryPrefix: this.mail.boundaryPrefix,
			disableUrlAccess: this.mail.disableUrlAccess,
			disableFileAccess: this.mail.disableFileAccess,
			normalizeHeaderKey: this.mail.normalizeHeaderKey,
			newline: this.mail.newline
		});
		if (element.headers) node.addHeader(element.headers);
		if (element.cid) node.setHeader("Content-Id", "<" + element.cid.replace(/[<>]/g, "") + ">");
		if (element.contentTransferEncoding) node.setHeader("Content-Transfer-Encoding", element.contentTransferEncoding);
		else if (this.mail.encoding && /^text\//i.test(element.contentType)) node.setHeader("Content-Transfer-Encoding", this.mail.encoding);
		if (!/^text\//i.test(element.contentType) || element.contentDisposition) node.setHeader("Content-Disposition", element.contentDisposition || (element.cid && /^image\//i.test(element.contentType) ? "inline" : "attachment"));
		if (typeof element.content === "string" && ![
			"utf8",
			"usascii",
			"ascii"
		].includes(encoding)) element.content = Buffer.from(element.content, encoding);
		if (element.raw) node.setRaw(element.raw);
		else node.setContent(element.content);
		return node;
	}
	/**
	* Parses data uri and converts it to a Buffer
	*
	* @param element Content element
	* @return Parsed element
	* @internal
	*/
	_processDataUrl(element) {
		const dataUrl = element.path || element.href;
		if (!dataUrl || typeof dataUrl !== "string") return element;
		if (!dataUrl.startsWith("data:")) return element;
		if (dataUrl.length > 52428800) {
			let detectedType = "application/octet-stream";
			const commaPos = dataUrl.indexOf(",");
			if (commaPos > 0 && commaPos < 200) {
				const parts = dataUrl.substring(5, commaPos).split(";");
				if (parts[0] && parts[0].includes("/")) detectedType = parts[0].trim();
			}
			return Object.assign(copyOwnKeys({}, element), {
				path: false,
				href: false,
				content: Buffer.alloc(0),
				contentType: element.contentType || detectedType
			});
		}
		let parsedDataUri;
		try {
			parsedDataUri = parseDataURI(dataUrl);
		} catch (_err) {
			return element;
		}
		if (!parsedDataUri) return element;
		element.content = parsedDataUri.data;
		element.contentType = element.contentType || parsedDataUri.contentType;
		if ("path" in element) element.path = false;
		if ("href" in element) element.href = false;
		return element;
	}
};
//#endregion
//#region src/domain/compose.ts
/** Gmail's own limit on the whole message, after base64 inflates the attachments by about a third. */
const MAX_MESSAGE_BYTES = 36700160;
/** Gmail's user-facing attachment limit; above this a recipient may simply not receive it. */
const WARN_ATTACHMENT_BYTES = 26214400;
function escapeHtml(text) {
	return text.replace(/[&<>"']/g, (character) => {
		switch (character) {
			case "&": return "&amp;";
			case "<": return "&lt;";
			case ">": return "&gt;";
			case "\"": return "&quot;";
			default: return "&#39;";
		}
	});
}
const URL_PATTERN = /\bhttps?:\/\/[^\s<>()[\]{}"']+/g;
/**
* Turns the author's text into the HTML part: paragraphs, line breaks, and links for anything that is already a
* URL. Nothing else — no images, no styles, no tables — because everything here ends up in somebody's mailbox with
* the user's name on it, and the simplest thing that renders correctly everywhere is a paragraph.
*/
function textToHtml(text) {
	return text.replace(/\r\n/g, "\n").split(/\n{2,}/).map((paragraph) => {
		let html = "";
		let index = 0;
		for (const match of paragraph.matchAll(URL_PATTERN)) {
			const start = match.index ?? 0;
			html += escapeHtml(paragraph.slice(index, start));
			const url = escapeHtml(match[0]);
			html += `<a href="${url}">${url}</a>`;
			index = start + match[0].length;
		}
		html += escapeHtml(paragraph.slice(index));
		return `<p>${html.split("\n").join("<br>")}</p>`;
	}).join("\n");
}
/** Formats an address for a header, quoting a display name that needs it. */
function formatAddress(entry) {
	if (typeof entry === "string") return entry;
	if (!entry.name) return entry.address;
	return `${/["\\,:;<>@[\]]/.test(entry.name) ? `"${entry.name.replace(/(["\\])/g, "\\$1")}"` : entry.name} <${entry.address}>`;
}
/**
* Builds the message. Returns the raw bytes for Gmail, and the two body parts for a preview and for the digest the
* approval is bound to.
*/
/**
* The original, quoted below what the author wrote, in both parts.
*
* It is built from the **sanitised text** of the original, never its HTML: the original's markup belongs to
* whoever sent it and can carry a tracking image or hidden text, and forwarding that would put the user's name on
* somebody else's beacon. Quoting the text loses the original's formatting, which is the right trade — a forward
* that is safe to send beats one that renders prettily.
*/
function renderQuote(quoted) {
	const headerLines = quoted.headerLines ?? [];
	return {
		text: [
			quoted.attribution,
			...headerLines,
			"",
			...quoted.text.split("\n").map((line) => `> ${line}`.trimEnd())
		].join("\n"),
		html: [
			`<div class="gmail_quote">`,
			`<div dir="ltr" class="gmail_attr">${escapeHtml(quoted.attribution)}</div>`,
			...headerLines.map((line) => `<div class="gmail_attr">${escapeHtml(line)}</div>`),
			`<blockquote class="gmail_quote" style="margin:0 0 0 .8ex;border-left:1px solid #ccc;padding-left:1ex">`,
			textToHtml(quoted.text),
			`</blockquote>`,
			`</div>`
		].join("\n")
	};
}
/** The signature exactly as it is written into the message, so the strip and the analysis cannot drift apart. */
function signatureBlock(signature) {
	return `<div class="gmail_signature" data-smartmail="gmail_signature">${signature.html}</div>`;
}
async function composeMessage(input) {
	if (input.to.length === 0 && (input.cc?.length ?? 0) === 0 && (input.bcc?.length ?? 0) === 0) throw new CommsError("BAD_DATA", "a message needs at least one recipient");
	const quote = input.quoted ? renderQuote(input.quoted) : null;
	const written = quote ? `${input.text.replace(/\s+$/, "")}\n\n${quote.text}` : input.text;
	const text = input.signature ? `${written.replace(/\s+$/, "")}\n\n${input.signature.text}` : written;
	const body = quote ? `${textToHtml(input.text)}\n${quote.html}` : textToHtml(input.text);
	const html = input.signature ? `${body}\n${signatureBlock(input.signature)}` : body;
	const generated = input.signature ? html.replace(signatureBlock(input.signature), "") : html;
	const report = analyseOutboundHtml(generated);
	const problems = [
		report.scripts > 0 ? "scripts" : "",
		report.forms > 0 ? "forms" : "",
		report.remoteResources.length > 0 ? "remote images or other remote resources" : "",
		report.hidden.length > 0 ? "text hidden from the reader" : ""
	].filter(Boolean);
	if (problems.length > 0) throw new CommsError("UNSENDABLE_HTML", `this message would contain ${problems.join(", ")}`, {
		hint: "The HTML part is generated from your text, so this is a fault in this package rather than in what you wrote.",
		details: { report }
	});
	const signatureResources = input.signature ? [...new Set(analyseOutboundHtml(signatureBlock(input.signature)).remoteResources)] : [];
	const message = new MailComposer({
		from: input.from,
		to: input.to.length > 0 ? input.to : void 0,
		cc: input.cc?.length ? input.cc : void 0,
		bcc: input.bcc?.length ? input.bcc : void 0,
		subject: input.subject,
		text,
		html,
		inReplyTo: input.inReplyTo,
		references: input.references?.length ? input.references : void 0,
		headers: input.headers,
		attachments: input.attachments?.map((attachment) => ({
			filename: attachment.filename,
			content: attachment.content,
			contentType: attachment.contentType
		})),
		textEncoding: "quoted-printable"
	}).compile();
	message.keepBcc = true;
	const raw = await message.build();
	if (raw.byteLength > 36700160) throw new CommsError("BAD_DATA", `the message is ${Math.round(raw.byteLength / 1048576)} MB, over Gmail's limit`, { hint: "Send fewer or smaller attachments, or share a link instead." });
	return {
		raw,
		text,
		html,
		bytes: raw.byteLength,
		signatureResources
	};
}
/**
* Who a reply goes to.
*
* `Reply-To` wins over `From` where it is set, which is what mail clients do and how mailing lists work — and also
* how a redirect is done, so the caller is told about it separately. Reply-all keeps everyone except this mailbox's
* own addresses, so nobody replies to themselves; duplicates are removed; and a forward starts a new conversation
* rather than inheriting one.
*/
function planReply(context, options) {
	const own = new Set(options.ownAddresses.map((address) => address.toLowerCase()));
	const sender = context.replyTo.length > 0 ? context.replyTo : context.from ? [context.from] : [];
	const subjectBase = context.subject.replace(/^((re|fwd?|aw|sv|vs|rv)\s*(\[\d+\])?\s*:\s*)+/i, "").trim();
	if (options.mode === "forward") return {
		to: options.to ?? [],
		cc: [],
		subject: `Fwd: ${subjectBase}`,
		inReplyTo: void 0,
		references: [],
		threadId: void 0
	};
	const to = sender.map((entry) => entry.address).filter((address) => !own.has(address));
	const everyone = options.mode === "reply_all" ? [...context.to, ...context.cc].map((entry) => entry.address).filter((address) => !own.has(address)) : [];
	const primary = to.length > 0 ? to : sender.map((entry) => entry.address);
	const cc = [...new Set(everyone)].filter((address) => !primary.includes(address));
	return {
		to: [...new Set(primary)],
		cc,
		subject: subjectBase.toLowerCase().startsWith("re:") ? subjectBase : `Re: ${subjectBase}`,
		inReplyTo: context.messageIdHeader,
		references: [...new Set([...context.references, context.messageIdHeader].filter((id) => Boolean(id)))],
		threadId: context.threadId
	};
}
//#endregion
export { planReply as a, formatAddress as i, WARN_ATTACHMENT_BYTES as n, textToHtml as o, composeMessage as r, MAX_MESSAGE_BYTES as t };
