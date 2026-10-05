import { t as __commonJSMin } from "./rolldown-runtime-CbG-q-O0.mjs";
import { D as CommsError } from "./dist-CBfqDru2.mjs";
import { t as askFor } from "./prompt-DKE-Q2VZ.mjs";
import "node:path";
import { styleText } from "node:util";
import process$1, { stdin, stdout } from "node:process";
import l__default from "node:readline";
//#region ../../node_modules/.pnpm/fast-string-truncated-width@3.0.3/node_modules/fast-string-truncated-width/dist/utils.js
const getCodePointsLength = (() => {
	const SURROGATE_PAIR_RE = /[\uD800-\uDBFF][\uDC00-\uDFFF]/g;
	return (input) => {
		let surrogatePairsNr = 0;
		SURROGATE_PAIR_RE.lastIndex = 0;
		while (SURROGATE_PAIR_RE.test(input)) surrogatePairsNr += 1;
		return input.length - surrogatePairsNr;
	};
})();
const isFullWidth = (x) => {
	return x === 12288 || x >= 65281 && x <= 65376 || x >= 65504 && x <= 65510;
};
const isWideNotCJKTNotEmoji = (x) => {
	return x === 8987 || x === 9001 || x >= 12272 && x <= 12287 || x >= 12289 && x <= 12350 || x >= 12441 && x <= 12543 || x >= 12549 && x <= 12591 || x >= 12593 && x <= 12686 || x >= 12688 && x <= 12771 || x >= 12783 && x <= 12830 || x >= 12832 && x <= 12871 || x >= 12880 && x <= 19903 || x >= 65040 && x <= 65049 || x >= 65072 && x <= 65106 || x >= 65108 && x <= 65126 || x >= 65128 && x <= 65131 || x >= 127488 && x <= 127490 || x >= 127504 && x <= 127547 || x >= 127552 && x <= 127560 || x >= 131072 && x <= 196605 || x >= 196608 && x <= 262141;
};
//#endregion
//#region ../../node_modules/.pnpm/fast-string-truncated-width@3.0.3/node_modules/fast-string-truncated-width/dist/index.js
const ANSI_RE = /[\u001b\u009b][[()#;?]*(?:[0-9]{1,4}(?:;[0-9]{0,4})*)?[0-9A-ORZcf-nqry=><]|\u001b\]8;[^;]*;.*?(?:\u0007|\u001b\u005c)/y;
const CONTROL_RE = /[\x00-\x08\x0A-\x1F\x7F-\x9F]{1,1000}/y;
const CJKT_WIDE_RE = /(?:(?![\uFF61-\uFF9F\uFF00-\uFFEF])[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}\p{Script=Tangut}]){1,1000}/uy;
const TAB_RE = /\t{1,1000}/y;
const EMOJI_RE = /[\u{1F1E6}-\u{1F1FF}]{2}|\u{1F3F4}[\u{E0061}-\u{E007A}]{2}[\u{E0030}-\u{E0039}\u{E0061}-\u{E007A}]{1,3}\u{E007F}|(?:\p{Emoji}\uFE0F\u20E3?|\p{Emoji_Modifier_Base}\p{Emoji_Modifier}?|\p{Emoji_Presentation})(?:\u200D(?:\p{Emoji_Modifier_Base}\p{Emoji_Modifier}?|\p{Emoji_Presentation}|\p{Emoji}\uFE0F\u20E3?))*/uy;
const LATIN_RE = /(?:[\x20-\x7E\xA0-\xFF](?!\uFE0F)){1,1000}/y;
const MODIFIER_RE = /\p{M}+/gu;
const NO_TRUNCATION$1 = {
	limit: Infinity,
	ellipsis: ""
};
const getStringTruncatedWidth = (input, truncationOptions = {}, widthOptions = {}) => {
	const LIMIT = truncationOptions.limit ?? Infinity;
	const ELLIPSIS = truncationOptions.ellipsis ?? "";
	const ELLIPSIS_WIDTH = truncationOptions?.ellipsisWidth ?? (ELLIPSIS ? getStringTruncatedWidth(ELLIPSIS, NO_TRUNCATION$1, widthOptions).width : 0);
	const ANSI_WIDTH = 0;
	const CONTROL_WIDTH = widthOptions.controlWidth ?? 0;
	const TAB_WIDTH = widthOptions.tabWidth ?? 8;
	const EMOJI_WIDTH = widthOptions.emojiWidth ?? 2;
	const FULL_WIDTH_WIDTH = 2;
	const REGULAR_WIDTH = widthOptions.regularWidth ?? 1;
	const WIDE_WIDTH = widthOptions.wideWidth ?? FULL_WIDTH_WIDTH;
	const PARSE_BLOCKS = [
		[LATIN_RE, REGULAR_WIDTH],
		[ANSI_RE, ANSI_WIDTH],
		[CONTROL_RE, CONTROL_WIDTH],
		[TAB_RE, TAB_WIDTH],
		[EMOJI_RE, EMOJI_WIDTH],
		[CJKT_WIDE_RE, WIDE_WIDTH]
	];
	let indexPrev = 0;
	let index = 0;
	let length = input.length;
	let lengthExtra = 0;
	let truncationEnabled = false;
	let truncationIndex = length;
	let truncationLimit = Math.max(0, LIMIT - ELLIPSIS_WIDTH);
	let unmatchedStart = 0;
	let unmatchedEnd = 0;
	let width = 0;
	let widthExtra = 0;
	outer: while (true) {
		if (unmatchedEnd > unmatchedStart || index >= length && index > indexPrev) {
			const unmatched = input.slice(unmatchedStart, unmatchedEnd) || input.slice(indexPrev, index);
			lengthExtra = 0;
			for (const char of unmatched.replaceAll(MODIFIER_RE, "")) {
				const codePoint = char.codePointAt(0) || 0;
				if (isFullWidth(codePoint)) widthExtra = FULL_WIDTH_WIDTH;
				else if (isWideNotCJKTNotEmoji(codePoint)) widthExtra = WIDE_WIDTH;
				else widthExtra = REGULAR_WIDTH;
				if (width + widthExtra > truncationLimit) truncationIndex = Math.min(truncationIndex, Math.max(unmatchedStart, indexPrev) + lengthExtra);
				if (width + widthExtra > LIMIT) {
					truncationEnabled = true;
					break outer;
				}
				lengthExtra += char.length;
				width += widthExtra;
			}
			unmatchedStart = unmatchedEnd = 0;
		}
		if (index >= length) break outer;
		for (let i = 0, l = PARSE_BLOCKS.length; i < l; i++) {
			const [BLOCK_RE, BLOCK_WIDTH] = PARSE_BLOCKS[i];
			BLOCK_RE.lastIndex = index;
			if (BLOCK_RE.test(input)) {
				lengthExtra = BLOCK_RE === CJKT_WIDE_RE ? getCodePointsLength(input.slice(index, BLOCK_RE.lastIndex)) : BLOCK_RE === EMOJI_RE ? 1 : BLOCK_RE.lastIndex - index;
				widthExtra = lengthExtra * BLOCK_WIDTH;
				if (width + widthExtra > truncationLimit) truncationIndex = Math.min(truncationIndex, index + Math.floor((truncationLimit - width) / BLOCK_WIDTH));
				if (width + widthExtra > LIMIT) {
					truncationEnabled = true;
					break outer;
				}
				width += widthExtra;
				unmatchedStart = indexPrev;
				unmatchedEnd = index;
				index = indexPrev = BLOCK_RE.lastIndex;
				continue outer;
			}
		}
		index += 1;
	}
	return {
		width: truncationEnabled ? truncationLimit : width,
		index: truncationEnabled ? truncationIndex : length,
		truncated: truncationEnabled,
		ellipsed: truncationEnabled && LIMIT >= ELLIPSIS_WIDTH
	};
};
//#endregion
//#region ../../node_modules/.pnpm/fast-string-width@3.0.2/node_modules/fast-string-width/dist/index.js
const NO_TRUNCATION = {
	limit: Infinity,
	ellipsis: "",
	ellipsisWidth: 0
};
const fastStringWidth = (input, options = {}) => {
	return getStringTruncatedWidth(input, NO_TRUNCATION, options).width;
};
//#endregion
//#region ../../node_modules/.pnpm/fast-wrap-ansi@0.2.2/node_modules/fast-wrap-ansi/lib/main.js
const ESC = "\x1B";
const CSI = "";
const END_CODE = 39;
const ANSI_ESCAPE_BELL = "\x07";
const ANSI_CSI = "[";
const ANSI_OSC = "]";
const ANSI_SGR_TERMINATOR = "m";
const ANSI_ESCAPE_LINK = `${ANSI_OSC}8;;`;
const GROUP_REGEX = new RegExp(`(?:\\${ANSI_CSI}(?<code>\\d+)m|\\${ANSI_ESCAPE_LINK}(?<uri>.*)${ANSI_ESCAPE_BELL})`, "y");
const getClosingCode = (openingCode) => {
	if (openingCode >= 30 && openingCode <= 37) return 39;
	if (openingCode >= 90 && openingCode <= 97) return 39;
	if (openingCode >= 40 && openingCode <= 47) return 49;
	if (openingCode >= 100 && openingCode <= 107) return 49;
	if (openingCode === 1 || openingCode === 2) return 22;
	if (openingCode === 3) return 23;
	if (openingCode === 4) return 24;
	if (openingCode === 7) return 27;
	if (openingCode === 8) return 28;
	if (openingCode === 9) return 29;
	if (openingCode === 0) return 0;
};
const wrapAnsiCode = (code) => `${ESC}${ANSI_CSI}${code}${ANSI_SGR_TERMINATOR}`;
const wrapAnsiHyperlink = (url) => `${ESC}${ANSI_ESCAPE_LINK}${url}${ANSI_ESCAPE_BELL}`;
const wrapWord = (rows, word, columns) => {
	const characters = word[Symbol.iterator]();
	let isInsideEscape = false;
	let isInsideLinkEscape = false;
	let lastRow = rows.at(-1);
	let visible = lastRow === void 0 ? 0 : fastStringWidth(lastRow);
	let currentCharacter = characters.next();
	let nextCharacter = characters.next();
	let rawCharacterIndex = 0;
	while (!currentCharacter.done) {
		const character = currentCharacter.value;
		const characterLength = fastStringWidth(character);
		if (visible + characterLength <= columns) rows[rows.length - 1] += character;
		else {
			rows.push(character);
			visible = 0;
		}
		if (character === ESC || character === CSI) {
			isInsideEscape = true;
			isInsideLinkEscape = word.startsWith(ANSI_ESCAPE_LINK, rawCharacterIndex + 1);
		}
		if (isInsideEscape) {
			if (isInsideLinkEscape) {
				if (character === ANSI_ESCAPE_BELL) {
					isInsideEscape = false;
					isInsideLinkEscape = false;
				}
			} else if (character === ANSI_SGR_TERMINATOR) isInsideEscape = false;
		} else {
			visible += characterLength;
			if (visible === columns && !nextCharacter.done) {
				rows.push("");
				visible = 0;
			}
		}
		currentCharacter = nextCharacter;
		nextCharacter = characters.next();
		rawCharacterIndex += character.length;
	}
	lastRow = rows.at(-1);
	if (!visible && lastRow !== void 0 && lastRow.length && rows.length > 1) rows[rows.length - 2] += rows.pop();
};
const stringVisibleTrimSpacesRight = (string) => {
	const words = string.split(" ");
	let last = words.length;
	while (last) {
		if (fastStringWidth(words[last - 1])) break;
		last--;
	}
	if (last === words.length) return string;
	return words.slice(0, last).join(" ") + words.slice(last).join("");
};
const exec = (string, columns, options = {}) => {
	if (options.trim !== false && string.trim() === "") return "";
	let returnValue = "";
	let escapeCode;
	let escapeUrl;
	const words = string.split(" ");
	let rows = [""];
	let rowLength = 0;
	for (let index = 0; index < words.length; index++) {
		const word = words[index];
		if (options.trim !== false) {
			const row = rows.at(-1) ?? "";
			const trimmed = row.trimStart();
			if (row.length !== trimmed.length) {
				rows[rows.length - 1] = trimmed;
				rowLength = fastStringWidth(trimmed);
			}
		}
		if (index !== 0) {
			if (rowLength >= columns && (options.wordWrap === false || options.trim === false)) {
				rows.push("");
				rowLength = 0;
			}
			if (rowLength || options.trim === false) {
				rows[rows.length - 1] += " ";
				rowLength++;
			}
		}
		const wordLength = fastStringWidth(word);
		if (options.hard && wordLength > columns) {
			const remainingColumns = columns - rowLength;
			const breaksStartingThisLine = 1 + Math.floor((wordLength - remainingColumns - 1) / columns);
			if (Math.floor((wordLength - 1) / columns) < breaksStartingThisLine) rows.push("");
			wrapWord(rows, word, columns);
			rowLength = fastStringWidth(rows.at(-1) ?? "");
			continue;
		}
		if (rowLength + wordLength > columns && rowLength && wordLength) {
			if (options.wordWrap === false && rowLength < columns) {
				wrapWord(rows, word, columns);
				rowLength = fastStringWidth(rows.at(-1) ?? "");
				continue;
			}
			rows.push("");
			rowLength = 0;
		}
		if (rowLength + wordLength > columns && options.wordWrap === false) {
			wrapWord(rows, word, columns);
			rowLength = fastStringWidth(rows.at(-1) ?? "");
			continue;
		}
		rows[rows.length - 1] += word;
		rowLength += wordLength;
	}
	if (options.trim !== false) rows = rows.map((row) => stringVisibleTrimSpacesRight(row));
	const preString = rows.join("\n");
	let inSurrogate = false;
	for (let i = 0; i < preString.length; i++) {
		const character = preString[i];
		returnValue += character;
		if (!inSurrogate) {
			inSurrogate = character >= "\ud800" && character <= "\udbff";
			if (inSurrogate) continue;
		} else inSurrogate = false;
		if (character === ESC || character === CSI) {
			GROUP_REGEX.lastIndex = i + 1;
			const groups = GROUP_REGEX.exec(preString)?.groups;
			if (groups?.code !== void 0) {
				const code = Number.parseFloat(groups.code);
				escapeCode = code === END_CODE ? void 0 : code;
			} else if (groups?.uri !== void 0) escapeUrl = groups.uri.length === 0 ? void 0 : groups.uri;
		}
		if (preString[i + 1] === "\n") {
			if (escapeUrl) returnValue += wrapAnsiHyperlink("");
			const closingCode = escapeCode ? getClosingCode(escapeCode) : void 0;
			if (escapeCode && closingCode) returnValue += wrapAnsiCode(closingCode);
		} else if (character === "\n") {
			if (escapeCode && getClosingCode(escapeCode)) returnValue += wrapAnsiCode(escapeCode);
			if (escapeUrl) returnValue += wrapAnsiHyperlink(escapeUrl);
		}
	}
	return returnValue;
};
const CRLF_OR_LF = /\r?\n/;
function wrapAnsi(string, columns, options) {
	return String(string).normalize().split(CRLF_OR_LF).map((line) => exec(line, columns, options)).join("\n");
}
//#endregion
//#region ../../node_modules/.pnpm/@clack+core@1.5.1/node_modules/@clack/core/dist/index.mjs
var import_src = (/* @__PURE__ */ __commonJSMin(((exports, module) => {
	const ESC = "\x1B";
	const CSI = `${ESC}[`;
	const beep = "\x07";
	const cursor = {
		to(x, y) {
			if (!y) return `${CSI}${x + 1}G`;
			return `${CSI}${y + 1};${x + 1}H`;
		},
		move(x, y) {
			let ret = "";
			if (x < 0) ret += `${CSI}${-x}D`;
			else if (x > 0) ret += `${CSI}${x}C`;
			if (y < 0) ret += `${CSI}${-y}A`;
			else if (y > 0) ret += `${CSI}${y}B`;
			return ret;
		},
		up: (count = 1) => `${CSI}${count}A`,
		down: (count = 1) => `${CSI}${count}B`,
		forward: (count = 1) => `${CSI}${count}C`,
		backward: (count = 1) => `${CSI}${count}D`,
		nextLine: (count = 1) => `${CSI}E`.repeat(count),
		prevLine: (count = 1) => `${CSI}F`.repeat(count),
		left: `${CSI}G`,
		hide: `${CSI}?25l`,
		show: `${CSI}?25h`,
		save: `${ESC}7`,
		restore: `${ESC}8`
	};
	module.exports = {
		cursor,
		scroll: {
			up: (count = 1) => `${CSI}S`.repeat(count),
			down: (count = 1) => `${CSI}T`.repeat(count)
		},
		erase: {
			screen: `${CSI}2J`,
			up: (count = 1) => `${CSI}1J`.repeat(count),
			down: (count = 1) => `${CSI}J`.repeat(count),
			line: `${CSI}2K`,
			lineEnd: `${CSI}K`,
			lineStart: `${CSI}1K`,
			lines(count) {
				let clear = "";
				for (let i = 0; i < count; i++) clear += this.line + (i < count - 1 ? cursor.up() : "");
				if (count) clear += cursor.left;
				return clear;
			}
		},
		beep
	};
})))();
function findCursor(s, o, l) {
	if (!l.some((r) => !r.disabled)) return s;
	const t = s + o, n = Math.max(l.length - 1, 0), e = t < 0 ? n : t > n ? 0 : t;
	return l[e]?.disabled ? findCursor(e, o < 0 ? -1 : 1, l) : e;
}
const settings = {
	actions: /* @__PURE__ */ new Set([
		"up",
		"down",
		"left",
		"right",
		"space",
		"enter",
		"cancel"
	]),
	aliases: /* @__PURE__ */ new Map([
		["k", "up"],
		["j", "down"],
		["h", "left"],
		["l", "right"],
		["", "cancel"],
		["escape", "cancel"]
	]),
	messages: {
		cancel: "Canceled",
		error: "Something went wrong"
	},
	withGuide: true,
	accessible: void 0,
	date: {
		monthNames: [...[
			"January",
			"February",
			"March",
			"April",
			"May",
			"June",
			"July",
			"August",
			"September",
			"October",
			"November",
			"December"
		]],
		messages: {
			required: "Please enter a valid date",
			invalidMonth: "There are only 12 months in a year",
			invalidDay: (n, e) => `There are only ${n} days in ${e}`,
			afterMin: (n) => `Date must be on or after ${n.toISOString().slice(0, 10)}`,
			beforeMax: (n) => `Date must be on or before ${n.toISOString().slice(0, 10)}`
		}
	}
};
function isAccessible(n) {
	if (n !== void 0) return n;
	if (settings.accessible !== void 0) return settings.accessible;
	const e = process.env.ACCESSIBLE;
	return e !== void 0 && e !== "" && e !== "0" && e !== "false";
}
function isActionKey(n, e) {
	if (typeof n == "string") return settings.aliases.get(n) === e;
	for (const s of n) if (s !== void 0 && isActionKey(s, e)) return true;
	return false;
}
function diffLines(i, s) {
	if (i === s) return;
	const e = i.split(`
`), t = s.split(`
`), r = Math.max(e.length, t.length), f = [];
	for (let n = 0; n < r; n++) e[n] !== t[n] && f.push(n);
	return {
		lines: f,
		numLinesBefore: e.length,
		numLinesAfter: t.length,
		numLines: r
	};
}
globalThis.process.platform.startsWith("win");
const CANCEL_SYMBOL = Symbol("clack:cancel");
function isCancel(e) {
	return e === CANCEL_SYMBOL;
}
function setRawMode(e, r) {
	const o = e;
	o.isTTY && o.setRawMode(r);
}
const getColumns = (e) => "columns" in e && typeof e.columns == "number" ? e.columns : 80;
const getRows = (e) => "rows" in e && typeof e.rows == "number" ? e.rows : 20;
function wrapTextWithPrefix(e, r, o, n = o, s = o, t) {
	return wrapAnsi(r, getColumns(e ?? stdout) - o.length, {
		hard: true,
		trim: false
	}).split(`
`).map((c, i, m) => {
		const d = t ? t(c, i) : c;
		return i === 0 ? `${n}${d}` : i === m.length - 1 ? `${s}${d}` : `${o}${d}`;
	}).join(`
`);
}
function runValidation(e, a) {
	if ("~standard" in e) {
		const n = e["~standard"].validate(a);
		return n instanceof Promise ? n.then((r) => r.issues?.at(0)?.message) : n.issues?.at(0)?.message;
	}
	return e(a);
}
var y = class {
	input;
	output;
	_abortSignal;
	rl;
	opts;
	_render;
	_track = false;
	_prevFrame = "";
	_subscribers = /* @__PURE__ */ new Map();
	_cursor = 0;
	state = "initial";
	error = "";
	value;
	userInput = "";
	/**
	* Whether accessible (static, screen-reader friendly) output is enabled for
	* this prompt, resolved from the `accessible` option, the global setting,
	* and the `ACCESSIBLE` env var.
	*/
	get accessible() {
		return isAccessible(this.opts.accessible);
	}
	constructor(t, e = true) {
		const { input: i = stdin, output: s = stdout, render: r, signal: n, ...o } = t;
		this.opts = o, this.onKeypress = this.onKeypress.bind(this), this.close = this.close.bind(this), this.render = this.render.bind(this), this._render = r.bind(this), this._track = e, this._abortSignal = n, this.input = i, this.output = s;
	}
	/**
	* Unsubscribe all listeners
	*/
	unsubscribe() {
		this._subscribers.clear();
	}
	/**
	* Set a subscriber with opts
	* @param event - The event name
	*/
	setSubscriber(t, e) {
		const i = this._subscribers.get(t) ?? [];
		i.push(e), this._subscribers.set(t, i);
	}
	/**
	* Subscribe to an event
	* @param event - The event name
	* @param cb - The callback
	*/
	on(t, e) {
		this.setSubscriber(t, { cb: e });
	}
	/**
	* Subscribe to an event once
	* @param event - The event name
	* @param cb - The callback
	*/
	once(t, e) {
		this.setSubscriber(t, {
			cb: e,
			once: true
		});
	}
	/**
	* Emit an event with data
	* @param event - The event name
	* @param data - The data to pass to the callback
	*/
	emit(t, ...e) {
		const i = this._subscribers.get(t) ?? [], s = [];
		for (const r of i) r.cb(...e), r.once && s.push(() => i.splice(i.indexOf(r), 1));
		for (const r of s) r();
	}
	prompt() {
		return new Promise((t) => {
			if (this._abortSignal) {
				if (this._abortSignal.aborted) return this.state = "cancel", this.close(), t(CANCEL_SYMBOL);
				this._abortSignal.addEventListener("abort", () => {
					this.state = "cancel", this.close();
				}, { once: true });
			}
			this.rl = l__default.createInterface({
				input: this.input,
				tabSize: 2,
				prompt: "",
				escapeCodeTimeout: 50,
				terminal: true
			}), this.rl.prompt(), this.opts.initialUserInput !== void 0 && this._setUserInput(this.opts.initialUserInput, true), this.input.on("keypress", this.onKeypress), setRawMode(this.input, true), this.output.on("resize", this.render), this.render(), this.once("submit", () => {
				this.output.write(import_src.cursor.show), this.output.off("resize", this.render), setRawMode(this.input, false), t(this.value);
			}), this.once("cancel", () => {
				this.output.write(import_src.cursor.show), this.output.off("resize", this.render), setRawMode(this.input, false), t(CANCEL_SYMBOL);
			});
		});
	}
	_isActionKey(t, e) {
		return t === "	";
	}
	_shouldSubmit(t, e) {
		return true;
	}
	_setValue(t) {
		this.value = t, this.emit("value", this.value);
	}
	_setUserInput(t, e) {
		this.userInput = t ?? "", this.emit("userInput", this.userInput), e && this._track && this.rl && (this.rl.write(this.userInput), this._cursor = this.rl.cursor);
	}
	_clearUserInput() {
		this.rl?.write(null, {
			ctrl: true,
			name: "u"
		}), this._setUserInput("");
	}
	async onKeypress(t, e) {
		if (this.state !== "validating") {
			if (this._track && e.name !== "return" && (e.name && this._isActionKey(t, e) && this.rl?.write(null, {
				ctrl: true,
				name: "h"
			}), this._cursor = this.rl?.cursor ?? 0, this._setUserInput(this.rl?.line)), this.state === "error" && (this.state = "active"), e?.name && (!this._track && settings.aliases.has(e.name) && this.emit("cursor", settings.aliases.get(e.name)), settings.actions.has(e.name) && this.emit("cursor", e.name)), t && (t.toLowerCase() === "y" || t.toLowerCase() === "n") && this.emit("confirm", t.toLowerCase() === "y"), this.emit("key", t, e), e?.name === "return" && this._shouldSubmit(t, e)) {
				if (this.opts.validate) {
					const i = runValidation(this.opts.validate, this.value);
					let s;
					i instanceof Promise ? (this.state = "validating", this.render(), s = await i) : s = i, s && (this.error = s instanceof Error ? s.message : s, this.state = "error", this.rl?.write(this.userInput));
				}
				this.state !== "error" && (this.state = "submit");
			}
			isActionKey([
				t,
				e?.name,
				e?.sequence
			], "cancel") && (this.state = "cancel"), (this.state === "submit" || this.state === "cancel") && this.emit("finalize"), this.render(), (this.state === "submit" || this.state === "cancel") && this.close();
		}
	}
	close() {
		this.input.unpipe(), this.input.removeListener("keypress", this.onKeypress), this.output.write(`
`), setRawMode(this.input, false), this.rl?.close(), this.rl = void 0, this.emit(`${this.state}`, this.value), this.unsubscribe();
	}
	restoreCursor() {
		const t = wrapAnsi(this._prevFrame, process.stdout.columns, {
			hard: true,
			trim: false
		}).split(`
`).length - 1;
		this.output.write(import_src.cursor.move(-999, t * -1));
	}
	render() {
		const t = wrapAnsi(this._render(this) ?? "", process.stdout.columns, {
			hard: true,
			trim: false
		});
		if (t !== this._prevFrame) {
			if (this.state === "initial") this.output.write(import_src.cursor.hide);
			else {
				const e = diffLines(this._prevFrame, t), i = getRows(this.output);
				if (this.restoreCursor(), e) {
					const s = Math.max(0, e.numLinesAfter - i), r = Math.max(0, e.numLinesBefore - i);
					let n = e.lines.find((o) => o >= s);
					if (n === void 0) {
						this._prevFrame = t;
						return;
					}
					if (e.lines.length === 1) {
						this.output.write(import_src.cursor.move(0, n - r)), this.output.write(import_src.erase.lines(1));
						const o = t.split(`
`);
						this.output.write(o[n]), this._prevFrame = t, this.output.write(import_src.cursor.move(0, o.length - n - 1));
						return;
					} else if (e.lines.length > 1) {
						if (s < r) n = s;
						else {
							const h = n - r;
							h > 0 && this.output.write(import_src.cursor.move(0, h));
						}
						this.output.write(import_src.erase.down());
						const f = t.split(`
`).slice(n);
						this.output.write(f.join(`
`)), this._prevFrame = t;
						return;
					}
				}
				this.output.write(import_src.erase.down());
			}
			this.output.write(t), this.state === "initial" && (this.state = "active"), this._prevFrame = t;
		}
	}
};
let n$1 = class n extends y {
	options;
	cursor = 0;
	get _selectedValue() {
		return this.options[this.cursor];
	}
	changeValue() {
		const e = this._selectedValue;
		this.value = e === void 0 ? void 0 : e.value;
	}
	constructor(e) {
		super(e, false), this.options = e.options;
		const o = this.options.findIndex(({ value: s }) => s === e.initialValue), t = o === -1 ? 0 : o;
		this.cursor = this.options[t]?.disabled ? findCursor(t, 1, this.options) : t, this.changeValue(), this.on("cursor", (s) => {
			switch (s) {
				case "left":
				case "up":
					this.cursor = findCursor(this.cursor, -1, this.options);
					break;
				case "down":
				case "right": this.cursor = findCursor(this.cursor, 1, this.options);
			}
			this.changeValue();
		});
	}
};
var n = class extends y {
	get userInputWithCursor() {
		if (this.state === "submit") return this.userInput;
		const t = this.userInput;
		if (this.cursor >= t.length) return `${this.userInput}\u2588`;
		const r = t.slice(0, this.cursor), s = t.slice(this.cursor, this.cursor + 1), e = t.slice(this.cursor + 1);
		return `${r}${styleText("inverse", s)}${e}`;
	}
	get cursor() {
		return this._cursor;
	}
	constructor(t) {
		super({
			...t,
			initialUserInput: t.initialUserInput ?? t.initialValue
		}), this.on("userInput", (r) => {
			this._setValue(r);
		}), this.on("finalize", () => {
			this.value || (this.value = t.defaultValue), this.value === void 0 && (this.value = "");
		});
	}
};
//#endregion
//#region ../../node_modules/.pnpm/@clack+prompts@1.8.1/node_modules/@clack/prompts/dist/index.mjs
function isUnicodeSupported() {
	if (process$1.platform !== "win32") return process$1.env.TERM !== "linux";
	return Boolean(process$1.env.CI) || Boolean(process$1.env.WT_SESSION) || Boolean(process$1.env.TERMINUS_SUBLIME) || process$1.env.ConEmuTask === "{cmd::Cmder}" || process$1.env.TERM_PROGRAM === "Terminus-Sublime" || process$1.env.TERM_PROGRAM === "vscode" || process$1.env.TERM === "xterm-256color" || process$1.env.TERM === "alacritty" || process$1.env.TERMINAL_EMULATOR === "JetBrains-JediTerm";
}
const unicode = isUnicodeSupported();
const isTTY = (o) => o.isTTY === true;
const unicodeOr = (o, e) => unicode ? o : e;
const S_STEP_ACTIVE = unicodeOr("◆", "*");
const S_STEP_CANCEL = unicodeOr("■", "x");
const S_STEP_ERROR = unicodeOr("▲", "x");
const S_STEP_SUBMIT = unicodeOr("◇", "o");
const S_BAR = unicodeOr("│", "|");
const S_BAR_END = unicodeOr("└", "—");
const S_RADIO_ACTIVE = unicodeOr("●", ">");
const S_RADIO_INACTIVE = unicodeOr("○", " ");
const symbol = (o) => {
	switch (o) {
		case "initial":
		case "active": return styleText("cyan", S_STEP_ACTIVE);
		case "cancel": return styleText("red", S_STEP_CANCEL);
		case "error": return styleText("yellow", S_STEP_ERROR);
		case "submit": return styleText("green", S_STEP_SUBMIT);
		case "validating": return styleText("dim", S_STEP_ACTIVE);
	}
};
const symbolBar = (o) => {
	switch (o) {
		case "initial":
		case "active": return styleText("cyan", S_BAR);
		case "cancel": return styleText("red", S_BAR);
		case "error": return styleText("yellow", S_BAR);
		case "submit": return styleText("green", S_BAR);
	}
};
function formatInstructionFooter(o, e) {
	const r = [`${e ? `${styleText("cyan", S_BAR)}  ` : ""}${o.join(" • ")}`];
	return e && r.push(styleText("cyan", S_BAR_END)), r;
}
const I = (l, e, w, p, b, C = false) => {
	let r = e, O = 0;
	if (C) for (let i = p - 1; i >= w; i--) {
		const m = l[i];
		if (m && (r -= m.length), O++, r <= b) break;
	}
	else for (let i = w; i < p; i++) {
		const m = l[i];
		if (m && (r -= m.length), O++, r <= b) break;
	}
	return {
		lineCount: r,
		removals: O
	};
};
const limitOptions = ({ cursor: l, options: e, style: w, output: p = process.stdout, maxItems: b = Number.POSITIVE_INFINITY, columnPadding: C = 0, rowPadding: r = 4 }) => {
	const i = getColumns(p) - C, m = getRows(p), M = styleText("dim", "..."), v = Math.max(m - r, 0), a = Math.max(Math.min(b, v), 5);
	let f = 0;
	l >= a - 3 && (f = Math.max(Math.min(l - a + 3, e.length - a), 0));
	let d = a < e.length && f > 0, c = a < e.length && f + a < e.length;
	const W = Math.min(f + a, e.length), s = [];
	let g = 0;
	d && g++, c && g++;
	const T = f + (d ? 1 : 0), y = W - (c ? 1 : 0);
	for (let t = T; t < y; t++) {
		const n = e[t], h = wrapAnsi(n ? w(n, t === l) : "", i, {
			hard: true,
			trim: false
		}).split(`
`);
		s.push(h), g += h.length;
	}
	if (g > v) {
		let t = 0, n = 0, o = g;
		const h = l - T;
		let u = v;
		const L = () => I(s, o, 0, h, u), E = () => I(s, o, h + 1, s.length, u, true);
		d ? ({lineCount: o, removals: t} = L(), o > u && (c || (u -= 1), {lineCount: o, removals: n} = E())) : (c || (u -= 1), {lineCount: o, removals: n} = E(), o > u && (u -= 1, {lineCount: o, removals: t} = L())), t > 0 && (d = true, s.splice(0, t)), n > 0 && (c = true, s.splice(s.length - n, n));
	}
	const x = [];
	d && x.push(M);
	for (const t of s) for (const n of t) x.push(n);
	return c && x.push(M), x;
};
`${styleText("dim", "↑/↓")}`, `${styleText("dim", "Space:")}`, `${styleText("dim", "Enter:")}`;
const SELECT_INSTRUCTIONS = [`${styleText("dim", "↑/↓")} to navigate`, `${styleText("dim", "Enter:")} confirm`];
const c = (t, o) => t.includes(`
`) ? t.split(`
`).map((d) => o(d)).join(`
`) : o(t);
const select = (t) => {
	const o = (n, m) => {
		if (n === void 0) return "";
		const s = n.label ?? String(n.value);
		switch (m) {
			case "disabled": return `${styleText("gray", S_RADIO_INACTIVE)} ${c(s, (i) => styleText("gray", i))}${n.hint ? ` ${styleText("dim", `(${n.hint ?? "disabled"})`)}` : ""}`;
			case "selected": return `${c(s, (i) => styleText("dim", i))}`;
			case "active": return `${styleText("green", S_RADIO_ACTIVE)} ${s}${n.hint ? ` ${styleText("dim", `(${n.hint})`)}` : ""}`;
			case "cancelled": return `${c(s, (i) => styleText(["strikethrough", "dim"], i))}`;
			default: return `${styleText("dim", S_RADIO_INACTIVE)} ${c(s, (i) => styleText("dim", i))}`;
		}
	}, d = t.showInstructions ?? true;
	return new n$1({
		options: t.options,
		signal: t.signal,
		input: t.input,
		output: t.output,
		initialValue: t.initialValue,
		render() {
			const n = t.withGuide ?? settings.withGuide, m = `${symbol(this.state)}  `, s = `${symbolBar(this.state)}  `, i = wrapTextWithPrefix(t.output, t.message, s, m), u = `${n ? `${styleText("gray", S_BAR)}
` : ""}${i}
`;
			switch (this.state) {
				case "submit": {
					const r = n ? `${styleText("gray", S_BAR)}  ` : "";
					return `${u}${wrapTextWithPrefix(t.output, o(this.options[this.cursor], "selected"), r)}`;
				}
				case "cancel": {
					const r = n ? `${styleText("gray", S_BAR)}  ` : "";
					return `${u}${wrapTextWithPrefix(t.output, o(this.options[this.cursor], "cancelled"), r)}${n ? `
${styleText("gray", S_BAR)}` : ""}`;
				}
				default: {
					const r = n ? `${styleText("cyan", S_BAR)}  ` : "", a = u.split(`
`).length, p = d ? formatInstructionFooter(SELECT_INSTRUCTIONS, n) : n ? [styleText("cyan", S_BAR_END)] : [], f = p.join(`
`), b = p.length + 1;
					return `${u}${r}${limitOptions({
						output: t.output,
						cursor: this.cursor,
						options: this.options,
						maxItems: t.maxItems,
						columnPadding: r.length,
						rowPadding: a + b,
						style: (g, x) => o(g, g.disabled ? "disabled" : x ? "active" : "inactive")
					}).join(`
${r}`)}
${f}
`;
				}
			}
		}
	}).prompt();
};
`${styleText("gray", S_BAR)}`;
const text = (t) => new n({
	validate: t.validate,
	placeholder: t.placeholder,
	defaultValue: t.defaultValue,
	initialValue: t.initialValue,
	output: t.output,
	signal: t.signal,
	input: t.input,
	render() {
		const r = t?.withGuide ?? settings.withGuide, l = `${`${r ? `${styleText("gray", S_BAR)}
` : ""}${symbol(this.state)}  `}${t.message}
`, d = t.placeholder && t.placeholder.length > 0 ? styleText("inverse", t.placeholder[0]) + styleText("dim", t.placeholder.slice(1)) : styleText(["inverse", "hidden"], "_"), o = this.userInput ? this.userInputWithCursor : d, s = this.value ?? "";
		switch (this.state) {
			case "validating": {
				const n = r ? `${styleText("cyan", S_BAR)}  ` : "", i = r ? styleText("cyan", S_BAR_END) : "";
				return `${l}${n}${styleText("dim", o)}
${i}  ${styleText("dim", "Validating...")}
`;
			}
			case "error": {
				const n = this.error ? `  ${styleText("yellow", this.error)}` : "", i = r ? `${styleText("yellow", S_BAR)}  ` : "", c = r ? styleText("yellow", S_BAR_END) : "";
				return `${l.trim()}
${i}${o}
${c}${n}
`;
			}
			case "submit": {
				const n = s ? `${r ? "  " : ""}${styleText("dim", s)}` : "";
				return `${l}${r ? styleText("gray", S_BAR) : ""}${n}`;
			}
			case "cancel": {
				const n = s ? `  ${styleText(["strikethrough", "dim"], s)}` : "", i = r ? styleText("gray", S_BAR) : "";
				return `${l}${i}${n}${s.trim() ? `
${i}` : ""}`;
			}
			default: return `${l}${r ? `${styleText("cyan", S_BAR)}  ` : ""}${o}
${r ? styleText("cyan", S_BAR_END) : ""}
`;
		}
	}
}).prompt();
//#endregion
//#region src/cli/tui.ts
/**
* Which of the three this run is.
*
* **`canPrompt` decides almost all of it, and that is deliberate.** It is the repository's one answer to "could a
* person answer a question right now" — no `--json`, no `--no-input`, not CI, and both stdin and stdout are
* terminals — and it is the same helper that guards the send approval, where the answer is a security boundary.
* Anything it excludes is `none` here, and this file does not get a second opinion.
*
* That leaves less to decide than it first appeared. This used to branch again on CI and on a piped stdin,
* reasoning that a CI job might still be feeding answers in and should get plain prompts rather than none — and
* those branches could not run, because `canPrompt` had already returned false for both. They read as support for
* `setup < answers.txt` and were dead code. Making them live would mean loosening `canPrompt`, which would loosen
* the send gate with it, so they are gone instead.
*
* What is left: nobody who can answer → `none`. Somebody who asked for plain → `plain`. Otherwise the terminal
* gets the list, unless stderr is not one — the list is drawn there, and `canPrompt` checks stdout rather than
* stderr, so this is the one thing it does not already cover.
*/
function interactionFor(input) {
	if (input.json || input.noInput || !input.canPrompt) return "none";
	if (input.noTui) return "plain";
	return isTTY(input.streams.stderr) ? "tui" : "plain";
}
/** Cancelling is a decision, not a crash: Ctrl-C leaves the setup where it was, and it can be resumed. */
function cancelled() {
	throw new CommsError("USAGE", "setup was cancelled; nothing was changed", { hint: "Run `agent-gmail setup` again to pick up where you left off." });
}
/** One free-text answer. */
async function askText(mode, streams, options) {
	if (mode === "tui") {
		const answer = await text({
			message: options.message,
			output: streams.stderr,
			input: streams.stdin,
			...options.placeholder ? { placeholder: options.placeholder } : {},
			...options.defaultValue ? { defaultValue: options.defaultValue } : {}
		});
		if (isCancel(answer)) cancelled();
		return String(answer ?? options.defaultValue ?? "").trim();
	}
	const hint = options.defaultValue ? ` [${options.defaultValue}]` : options.placeholder ? ` (e.g. ${options.placeholder})` : "";
	return (await askFor(streams, { question: `${options.message}${hint}: ` })).trim() || options.defaultValue || "";
}
/**
* One choice from a list.
*
* The plain rendering is numbered rather than typed, for the same reason the rich one is a list: the things being
* chosen between here are file paths like `client_secret_760917502475-7asd913….apps.googleusercontent.com.json`,
* and asking somebody to retype one of those is asking them to make a mistake.
*/
async function askChoice(mode, streams, options) {
	if (options.choices.length === 0) throw new CommsError("USAGE", "nothing to choose from");
	if (mode === "tui") {
		const answer = await select({
			message: options.message,
			output: streams.stderr,
			input: streams.stdin,
			options: options.choices.map((choice) => choice.hint ? {
				value: choice.value,
				label: choice.label,
				hint: choice.hint
			} : {
				value: choice.value,
				label: choice.label
			}),
			...options.initial ? { initialValue: options.initial } : {}
		});
		if (isCancel(answer)) cancelled();
		return answer;
	}
	const initialIndex = options.initial ? options.choices.findIndex((choice) => choice.value === options.initial) + 1 : 1;
	streams.stderr.write(`${options.message}\n`);
	for (const [index, choice] of options.choices.entries()) streams.stderr.write(`  ${index + 1}) ${choice.label}${choice.hint ? `\n     ${choice.hint}` : ""}\n`);
	for (;;) {
		const typed = (await askFor(streams, { question: `  which one? [${initialIndex}] ` })).trim();
		const picked = typed === "" ? initialIndex : Number(typed);
		if (Number.isInteger(picked) && picked >= 1 && picked <= options.choices.length) return options.choices[picked - 1]?.value;
		streams.stderr.write(`  Type a number between 1 and ${options.choices.length}.\n`);
	}
}
/** A yes or no. `defaultYes` is what an empty answer means, and is stated in the prompt. */
async function askYesNo(mode, streams, options) {
	const defaultYes = options.defaultYes !== false;
	if (mode === "tui") {
		const answer = await select({
			message: options.message,
			output: streams.stderr,
			input: streams.stdin,
			options: [{
				value: "yes",
				label: "Yes"
			}, {
				value: "no",
				label: "No"
			}],
			initialValue: defaultYes ? "yes" : "no"
		});
		if (isCancel(answer)) cancelled();
		return answer === "yes";
	}
	const typed = (await askFor(streams, { question: `${options.message} [${defaultYes ? "Y/n" : "y/N"}] ` })).trim();
	if (typed === "") return defaultYes;
	return /^y/i.test(typed);
}
//#endregion
export { askChoice, askText, askYesNo, interactionFor };
