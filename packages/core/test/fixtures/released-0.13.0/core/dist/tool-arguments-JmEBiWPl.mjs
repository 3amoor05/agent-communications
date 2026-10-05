import { Mo as CommsError } from "./update-check-C8sNjCez.mjs";
import { z } from "zod";
//#region src/tool-arguments.ts
const APPLIED = Symbol.for("agentcomms.strictToolArguments");
const TARGET = "draft-2020-12";
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
function strictToolArguments(server, refuse, gate, retired = {}) {
	const target = server;
	if (typeof target.registerTool !== "function") throw new Error("strictToolArguments needs an MCP server: this has no registerTool");
	if (target[APPLIED]) return;
	const register = target.registerTool.bind(server);
	target.registerTool = (...args) => {
		assertToolRegistration(args);
		const [name, config, handler] = args;
		const declared = config.inputSchema !== void 0;
		const schema = strictSchemaOf(name, config.inputSchema);
		const published = schema["~standard"].jsonSchema.input({ target: TARGET });
		return register(name, {
			...config,
			inputSchema: passThrough(schema)
		}, async (input, context) => {
			const parsed = await schema.safeParseAsync(input ?? {});
			if (!parsed.success) return refuse(refusal(name, published, input, parsed.error.issues, retired[name] ?? {}));
			const stopped = gate ? await gate(name, parsed.data) : null;
			if (stopped !== null) return stopped;
			return declared ? handler(parsed.data, context) : handler(context);
		});
	};
	Object.defineProperty(target, APPLIED, { value: true });
}
/**
* Throws unless a registration is `(name, config, handler)` — the shape this wraps.
*
* The SDK's types cannot promise it across versions: an added overload, or the handler in another position, would have
* the wrapper check the wrong thing, and that would not crash but register a tool unchecked. So anything else stops
* the server from starting — loud, at startup, in every test that starts one.
*/
function assertToolRegistration(args) {
	const [name, config, handler] = args;
	if (args.length === 3 && typeof name === "string" && typeof config === "object" && config !== null) {
		if (typeof handler === "function") return;
	}
	throw new Error(`registerTool was called as (${args.map((arg) => arg === null ? "null" : typeof arg).join(", ")}); strict tool arguments wrap (string, object, function) and cannot check this tool. Update strictToolArguments for this SDK.`);
}
const isZodObject = (value) => typeof value === "object" && value !== null && value._zod?.def?.type === "object" && typeof value.strict === "function";
const isZodSchema = (value) => typeof value === "object" && value !== null && "_zod" in value;
/** The tool's input schema, refusing any key it does not declare: a raw shape, a `z.object`, or nothing at all. */
function strictSchemaOf(tool, inputSchema) {
	if (inputSchema === void 0) return z.strictObject({});
	if (isZodObject(inputSchema)) return inputSchema.strict();
	if (typeof inputSchema === "object" && inputSchema !== null && !("~standard" in inputSchema) && Object.values(inputSchema).every(isZodSchema)) return z.strictObject(inputSchema);
	throw new Error(`${tool}: its input schema must be an object of named arguments — a raw zod shape or a z.object — so that a key it does not declare can be refused`);
}
/**
* What the SDK is handed: a Standard Schema that publishes the strict schema as JSON Schema, and passes every call
* through unchanged to the check the wrapped handler makes. Validating in the SDK would refuse in its own words.
*/
function passThrough(schema) {
	return { "~standard": {
		version: 1,
		vendor: "agentcomms",
		validate: (value) => ({ value }),
		jsonSchema: schema["~standard"].jsonSchema
	} };
}
/** A USAGE refusal naming what was wrong and what the tool takes. */
function refusal(tool, published, input, issues, retired) {
	const properties = published.properties ?? {};
	const takes = Object.keys(properties);
	const required = new Set(published.required ?? []);
	const signature = takes.length === 0 ? `${tool} takes no arguments.` : `${tool} takes ${spoken(takes.map((key) => required.has(key) ? `\`${key}\` (required)` : `\`${key}\``), "and")}.`;
	const unknown = issues.flatMap((issue) => issue.code === "unrecognized_keys" && issue.path.length === 0 ? issue.keys : []);
	const removed = unknown.filter((key) => Object.hasOwn(retired, key));
	if (removed.length > 0) return new CommsError("USAGE", `${tool} no longer takes ${spoken(removed.map((key) => `\`${key}\``), "or")}`, {
		hint: removed.map((key) => retired[key]).join(" "),
		details: {
			tool,
			retired: removed,
			unknown,
			takes
		}
	});
	if (unknown.length > 0) return new CommsError("USAGE", `${tool} does not take ${spoken(unknown.map((key) => `\`${key}\``), "or")}`, {
		hint: takes.length === 0 ? signature : `${signature} Leave out anything else.`,
		details: {
			tool,
			unknown,
			takes
		}
	});
	const given = typeof input === "object" && input !== null ? input : {};
	const problems = /* @__PURE__ */ new Map();
	const general = [];
	for (const issue of issues) {
		const [key] = issue.path;
		if (typeof key !== "string") {
			general.push(issue.message);
			continue;
		}
		if (issue.path.length === 1 && issue.code !== "unrecognized_keys") {
			if (!problems.has(key)) {
				const text = problemWith(key, properties[key], issue, given[key] === void 0);
				problems.set(key, {
					argument: key,
					path: key,
					inside: false,
					text: () => text,
					hint: void 0
				});
			}
			continue;
		}
		if (issue.code === "unrecognized_keys") {
			unknownInside(problems, published, given, issue.path, issue.keys);
			continue;
		}
		const path = pathName(issue.path);
		if (!problems.has(path)) {
			const container = issue.path.slice(0, -1);
			const holder = valueAt(given, container);
			const last = issue.path.at(-1);
			const missing = typeof holder === "object" && holder !== null && holder[last] === void 0;
			const text = problemWith(path, schemaAt(published, issue.path), issue, missing);
			problems.set(path, {
				argument: key,
				path,
				inside: true,
				text: () => text,
				hint: nearestSignature(published, container)
			});
		}
		if (typeof issue.path.at(-1) === "string") unknownInside(problems, published, given, issue.path.slice(0, -1));
	}
	const entries = [...problems.values()];
	let inside = 0;
	const named = entries.filter((entry) => !entry.inside || ++inside <= NESTED_SHOWN);
	const shown = named.map((entry) => entry.text());
	if (inside > NESTED_SHOWN) shown.push(`and ${inside - NESTED_SHOWN} more`);
	const first = entries[0];
	const description = first === void 0 || first.inside ? void 0 : properties[first.argument]?.description;
	return new CommsError("USAGE", [...shown, ...general].join("; ") || `${tool} was called wrongly`, {
		hint: first?.hint ?? (description ? `\`${first?.argument}\`: ${sentence(description)}` : signature),
		details: {
			tool,
			arguments: [...new Set(entries.map((entry) => entry.argument))],
			paths: named.map((entry) => entry.path),
			takes
		}
	});
}
/** How many problems inside object arguments a refusal names: a list of records wrong the same way is not a page. */
const NESTED_SHOWN = 5;
/**
* Names the keys an object inside an argument does not take: those zod reported (a strict object), and those it
* dropped without a word (a plain one), found by comparing what was given with the properties published there. Only
* key names are named — the caller's own spelling — never what they hold. Nothing is added for an object whose schema
* takes any key, or one that was not an object at all.
*/
function unknownInside(problems, published, given, path, reported = []) {
	const [argument] = path;
	if (typeof argument !== "string" || path.length === 0) return;
	const schema = schemaAt(published, path);
	const value = valueAt(given, path);
	const declared = schema?.properties;
	const closed = schema?.additionalProperties === void 0 || schema.additionalProperties === false;
	const stray = declared && closed && typeof value === "object" && value !== null && !Array.isArray(value) ? Object.keys(value).filter((key) => !Object.hasOwn(declared, key)) : [];
	const keys = [.../* @__PURE__ */ new Set([...reported, ...stray])];
	if (keys.length === 0) return;
	const name = pathName(path);
	const id = `${name}\u0000unknown`;
	const existing = problems.get(id);
	if (existing) {
		for (const key of keys) existing.keys.add(key);
		return;
	}
	const entry = {
		argument,
		path: name,
		inside: true,
		keys: new Set(keys),
		text: () => `\`${name}\` does not take ${spoken([...entry.keys].map((key) => `\`${key}\``), "or")}`,
		hint: nearestSignature(published, path)
	};
	problems.set(id, entry);
}
/** `expect.to`, `undo[0].messageId`: a path into the arguments as it would be written to reach it. */
function pathName(path) {
	let name = "";
	for (const segment of path) if (typeof segment === "number") name += `[${segment}]`;
	else name += name === "" ? String(segment) : `.${String(segment)}`;
	return name;
}
/** What the call held at a path, or `undefined` where there is nothing — read only through objects and arrays. */
function valueAt(value, path) {
	let at = value;
	for (const segment of path) {
		if (typeof at !== "object" || at === null) return void 0;
		at = at[segment];
	}
	return at;
}
/** The published schema at a path: through `properties` for a key and `items` for an index, into either side of a union. */
function schemaAt(schema, path) {
	let at = schema;
	for (const segment of path) {
		at = step(at, segment);
		if (!at) return void 0;
	}
	return at;
}
function step(schema, segment) {
	if (!schema) return void 0;
	const alternatives = schema.anyOf ?? schema.oneOf;
	if (Array.isArray(alternatives)) {
		for (const alternative of alternatives) {
			const found = step(alternative, segment);
			if (found) return found;
		}
		return;
	}
	if (typeof segment === "number") return schema.items;
	if (typeof segment === "string" && schema.properties && Object.hasOwn(schema.properties, segment)) return schema.properties[segment];
}
/**
* What the nearest object at or above a path takes, as the hint for a problem there: "`undo[0]` takes `messageId`
* (required), …". It spells each key as the tool does, which is what a caller who misspelt one needs to see.
*/
function nearestSignature(published, path) {
	for (let length = path.length; length > 0; length -= 1) {
		const at = path.slice(0, length);
		const schema = schemaAt(published, at);
		const keys = Object.keys(schema?.properties ?? {});
		if (keys.length === 0) continue;
		const required = new Set(schema?.required ?? []);
		return `\`${pathName(at)}\` takes ${spoken(keys.map((key) => required.has(key) ? `\`${key}\` (required)` : `\`${key}\``), "and")}.`;
	}
}
/** One argument's problem, in words: missing, or not what it takes — or the schema's own message, where it has one. */
function problemWith(key, schema, issue, missing) {
	if (missing) return `\`${key}\` is required, and takes ${what(schema)}`;
	switch (issue.code) {
		case "invalid_type":
		case "invalid_value":
		case "invalid_union":
		case "too_small":
		case "too_big":
		case "not_multiple_of": return `\`${key}\` takes ${what(schema)}`;
		default: return `\`${key}\`: ${issue.message}`;
	}
}
/** What an argument takes, from the JSON Schema a client is shown: "a whole number from 0 to 600", "`a` or `b`". */
function what(schema) {
	if (!schema) return "a value";
	if (Array.isArray(schema.enum)) return spoken(schema.enum.map((value) => `\`${String(value)}\``), "or");
	if ("const" in schema) return `\`${String(schema.const)}\``;
	const alternatives = schema.anyOf ?? schema.oneOf;
	if (Array.isArray(alternatives)) return spoken([...new Set(alternatives.map(what))], "or");
	switch (Array.isArray(schema.type) ? schema.type[0] : schema.type) {
		case "integer": return `a whole number${range(schema, true)}`;
		case "number": return `a number${range(schema, false)}`;
		case "boolean": return "true or false";
		case "string": return (schema.minLength ?? 0) > 0 ? "a non-empty string" : "a string";
		case "array": {
			const item = schema.items ? what(schema.items) : "";
			return item === "a string" || item === "a non-empty string" ? "a list of strings" : "a list";
		}
		case "object": return "an object";
		case "null": return "null";
		default: return "a value";
	}
}
/** A number's range, as the operations say it — "from 0 to 600", "of 1 or more" — leaving out zod's safe bounds. */
function range(schema, whole) {
	const shown = (value) => value !== void 0 && Math.abs(value) < Number.MAX_SAFE_INTEGER ? value : void 0;
	const step = whole ? 1 : 0;
	const min = shown(schema.minimum ?? (schema.exclusiveMinimum === void 0 ? void 0 : schema.exclusiveMinimum + step));
	const max = shown(schema.maximum ?? (schema.exclusiveMaximum === void 0 ? void 0 : schema.exclusiveMaximum - step));
	const strictBelow = !whole && schema.minimum === void 0 && schema.exclusiveMinimum !== void 0;
	const strictAbove = !whole && schema.maximum === void 0 && schema.exclusiveMaximum !== void 0;
	if (min !== void 0 && max !== void 0 && !strictBelow && !strictAbove) return ` from ${min} to ${max}`;
	const parts = [];
	if (min !== void 0) parts.push(strictBelow ? `more than ${min}` : `${min} or more`);
	if (max !== void 0) parts.push(strictAbove ? `less than ${max}` : `${max} or less`);
	return parts.length === 0 ? "" : ` of ${parts.join(" and ")}`;
}
/** A description as the end of a sentence: with a full stop, unless it already has one. */
const sentence = (text) => /[.!?]$/.test(text.trim()) ? text.trim() : `${text.trim()}.`;
/** `a`, `a or b`, `a, b or c`: a list as a person would say it. */
function spoken(words, joiner) {
	if (words.length <= 1) return words.join("");
	return `${words.slice(0, -1).join(", ")} ${joiner} ${words.at(-1)}`;
}
//#endregion
export { strictToolArguments as t };
