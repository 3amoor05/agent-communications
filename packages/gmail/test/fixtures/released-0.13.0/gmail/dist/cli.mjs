#!/usr/bin/env node
import { $ as commandText, B as approvalsOf, Cn as updateGateAtTerminal, D as CommsError, En as windowsSystemProgram, Gt as profileSourcePath, H as canPrompt, I as agentMarker, N as UPDATE_CHECK_CHILD_COMMAND, Nn as writeResult, O as DOWNLOAD_CLAIM, On as withWords, P as absoluteSearchPath, Q as commandPathOf, R as approvalHint, Rt as openCore, Sn as toCommsError, St as installExitStatus, V as approveChangeAtTerminal, Vt as paint, Z as colorEnabled, Zt as refuseUnclaimedApproval, _ as refuseRetiredOut, _t as gatedChangeAtTerminal, bt as homeDirectory, c as downloadAtTerminal, cn as runUpdateCheckChild, en as renderInstall, fn as serverInstallChange, gt as gatedChange, hn as shellCommand, k as EXIT_CODES, n as answerDownloadAtTerminal, nn as renderPrune, pn as serverPruneChange, q as childEnvironment, sn as runCommand, ut as exemptFromUpdateGate, xn as terminalUpdateHooks, xt as inlineCommand, z as approvalKind, zt as orgAddChange } from "./dist-CBfqDru2.mjs";
import { A as followUps, B as clientRemoveChange, C as inboxPolicyChange, D as whoami, E as inboxShow, F as removeConfirmClient, G as listSendAs, H as findAttachments, J as readThread, K as threadTimeline, L as STORE_KINDS, N as confirmClientAddChange, O as CONTACT_SOURCES, P as listConfirmClients, R as clientAddChange, S as inboxList, T as inboxRename, U as search, V as downloadAttachments, W as listLabels, Y as GmailContext, _ as getDraft, a as prepareSend, b as updateDraft, c as createLabel, d as inboxImportChange, f as EXPORT_FORMATS, g as deleteDraft, h as createDraft, i as listApprovals, j as searchContacts, k as FOLLOW_UP_DIRECTIONS, l as modify, m as REPLY_MODES, n as executeSend, o as revokeApproval, p as exportMail, q as readMessage, r as finishApproval, s as applyUndo, t as beginApproval, u as trash, v as listDrafts, w as inboxRemoveChange, x as doctor, y as replyDraft, z as clientList } from "./send-DgBk5FF5.mjs";
import { _ as aboutFlow, a as inboxReauthChange, i as finishSignIn, n as checkedPort, o as startSignIn, r as checkedWait, s as startLoopback, t as MAX_WAIT_SECONDS } from "./signin-DlaRESVJ.mjs";
import { y as TIERS } from "./setup-DWh5j-sH.mjs";
import { a as VERSION } from "./install-CAhyfCot.mjs";
import { t as askFor } from "./prompt-DKE-Q2VZ.mjs";
import { C as renderSetupPlan, D as renderTrash, E as renderThread, O as renderWhoami, S as renderSent, T as renderSignedIn, _ as renderMessage, a as renderClients, b as renderSendAs, c as renderDownloadQuestion, d as renderDrafts, f as renderFollowUps, g as renderLabels, h as renderInboxShow, i as renderClientAdd, l as renderDownloads, m as renderInboxList, n as renderApprovals, o as renderContacts, p as renderImport, r as renderAttachments, s as renderDoctor, u as renderDraft, v as renderModify, w as renderSignInStarted, x as renderSendPreparation, y as renderSearch } from "./render-Bz9IAZIe.mjs";
import path, { delimiter, join } from "node:path";
import { stripVTControlCharacters } from "node:util";
import fs, { accessSync, constants } from "node:fs";
import childProcess, { spawn } from "node:child_process";
import process$1 from "node:process";
import { EventEmitter } from "node:events";
//#region ../../node_modules/.pnpm/commander@15.0.0/node_modules/commander/lib/error.js
/**
* CommanderError class
*/
var CommanderError = class extends Error {
	/**
	* Constructs the CommanderError class
	* @param {number} exitCode suggested exit code which could be used with process.exit
	* @param {string} code an id string representing the error
	* @param {string} message human-readable description of the error
	*/
	constructor(exitCode, code, message) {
		super(message);
		Error.captureStackTrace(this, this.constructor);
		this.name = this.constructor.name;
		this.code = code;
		this.exitCode = exitCode;
		this.nestedError = void 0;
	}
};
/**
* InvalidArgumentError class
*/
var InvalidArgumentError = class extends CommanderError {
	/**
	* Constructs the InvalidArgumentError class
	* @param {string} [message] explanation of why argument is invalid
	*/
	constructor(message) {
		super(1, "commander.invalidArgument", message);
		Error.captureStackTrace(this, this.constructor);
		this.name = this.constructor.name;
	}
};
//#endregion
//#region ../../node_modules/.pnpm/commander@15.0.0/node_modules/commander/lib/argument.js
var Argument = class {
	/**
	* Initialize a new command argument with the given name and description.
	* The default is that the argument is required, and you can explicitly
	* indicate this with <> around the name. Put [] around the name for an optional argument.
	*
	* @param {string} name
	* @param {string} [description]
	*/
	constructor(name, description) {
		this.description = description || "";
		this.variadic = false;
		this.parseArg = void 0;
		this.defaultValue = void 0;
		this.defaultValueDescription = void 0;
		this.argChoices = void 0;
		switch (name[0]) {
			case "<":
				this.required = true;
				this._name = name.slice(1, -1);
				break;
			case "[":
				this.required = false;
				this._name = name.slice(1, -1);
				break;
			default:
				this.required = true;
				this._name = name;
		}
		if (this._name.endsWith("...")) {
			this.variadic = true;
			this._name = this._name.slice(0, -3);
		}
	}
	/**
	* Return argument name.
	*
	* @return {string}
	*/
	name() {
		return this._name;
	}
	/**
	* @package
	*/
	_collectValue(value, previous) {
		if (previous === this.defaultValue || !Array.isArray(previous)) return [value];
		previous.push(value);
		return previous;
	}
	/**
	* Set the default value, and optionally supply the description to be displayed in the help.
	*
	* @param {*} value
	* @param {string} [description]
	* @return {Argument}
	*/
	default(value, description) {
		this.defaultValue = value;
		this.defaultValueDescription = description;
		return this;
	}
	/**
	* Set the custom handler for processing CLI command arguments into argument values.
	*
	* @param {Function} [fn]
	* @return {Argument}
	*/
	argParser(fn) {
		this.parseArg = fn;
		return this;
	}
	/**
	* Only allow argument value to be one of choices.
	*
	* @param {string[]} values
	* @return {Argument}
	*/
	choices(values) {
		this.argChoices = values.slice();
		this.parseArg = (arg, previous) => {
			if (!this.argChoices.includes(arg)) throw new InvalidArgumentError(`Allowed choices are ${this.argChoices.join(", ")}.`);
			if (this.variadic) return this._collectValue(arg, previous);
			return arg;
		};
		return this;
	}
	/**
	* Make argument required.
	*
	* @returns {Argument}
	*/
	argRequired() {
		this.required = true;
		return this;
	}
	/**
	* Make argument optional.
	*
	* @returns {Argument}
	*/
	argOptional() {
		this.required = false;
		return this;
	}
};
/**
* Takes an argument and returns its human readable equivalent for help usage.
*
* @param {Argument} arg
* @return {string}
* @private
*/
function humanReadableArgName(arg) {
	const nameOutput = arg.name() + (arg.variadic === true ? "..." : "");
	return arg.required ? "<" + nameOutput + ">" : "[" + nameOutput + "]";
}
//#endregion
//#region ../../node_modules/.pnpm/commander@15.0.0/node_modules/commander/lib/help.js
/**
* TypeScript import types for JSDoc, used by Visual Studio Code IntelliSense and `npm run typescript-checkJS`
* https://www.typescriptlang.org/docs/handbook/jsdoc-supported-types.html#import-types
* @typedef { import("./argument.js").Argument } Argument
* @typedef { import("./command.js").Command } Command
* @typedef { import("./option.js").Option } Option
*/
var Help = class {
	constructor() {
		this.helpWidth = void 0;
		this.minWidthToWrap = 40;
		this.sortSubcommands = false;
		this.sortOptions = false;
		this.showGlobalOptions = false;
	}
	/**
	* prepareContext is called by Commander after applying overrides from `Command.configureHelp()`
	* and just before calling `formatHelp()`.
	*
	* Commander just uses the helpWidth and the rest is provided for optional use by more complex subclasses.
	*
	* @param {{ error?: boolean, helpWidth?: number, outputHasColors?: boolean }} contextOptions
	*/
	prepareContext(contextOptions) {
		this.helpWidth = this.helpWidth ?? contextOptions.helpWidth ?? 80;
	}
	/**
	* Get an array of the visible subcommands. Includes a placeholder for the implicit help command, if there is one.
	*
	* @param {Command} cmd
	* @returns {Command[]}
	*/
	visibleCommands(cmd) {
		const visibleCommands = cmd.commands.filter((cmd) => !cmd._hidden);
		const helpCommand = cmd._getHelpCommand();
		if (helpCommand && !helpCommand._hidden) visibleCommands.push(helpCommand);
		if (this.sortSubcommands) visibleCommands.sort((a, b) => {
			return a.name().localeCompare(b.name());
		});
		return visibleCommands;
	}
	/**
	* Compare options for sort.
	*
	* @param {Option} a
	* @param {Option} b
	* @returns {number}
	*/
	compareOptions(a, b) {
		const getSortKey = (option) => {
			return option.short ? option.short.replace(/^-/, "") : option.long.replace(/^--/, "");
		};
		return getSortKey(a).localeCompare(getSortKey(b));
	}
	/**
	* Get an array of the visible options. Includes a placeholder for the implicit help option, if there is one.
	*
	* @param {Command} cmd
	* @returns {Option[]}
	*/
	visibleOptions(cmd) {
		const visibleOptions = cmd.options.filter((option) => !option.hidden);
		const helpOption = cmd._getHelpOption();
		if (helpOption && !helpOption.hidden) {
			const removeShort = helpOption.short && cmd._findOption(helpOption.short);
			const removeLong = helpOption.long && cmd._findOption(helpOption.long);
			if (!removeShort && !removeLong) visibleOptions.push(helpOption);
			else if (helpOption.long && !removeLong) visibleOptions.push(cmd.createOption(helpOption.long, helpOption.description));
			else if (helpOption.short && !removeShort) visibleOptions.push(cmd.createOption(helpOption.short, helpOption.description));
		}
		if (this.sortOptions) visibleOptions.sort(this.compareOptions);
		return visibleOptions;
	}
	/**
	* Get an array of the visible global options. (Not including help.)
	*
	* @param {Command} cmd
	* @returns {Option[]}
	*/
	visibleGlobalOptions(cmd) {
		if (!this.showGlobalOptions) return [];
		const globalOptions = [];
		for (let ancestorCmd = cmd.parent; ancestorCmd; ancestorCmd = ancestorCmd.parent) {
			const visibleOptions = ancestorCmd.options.filter((option) => !option.hidden);
			globalOptions.push(...visibleOptions);
		}
		if (this.sortOptions) globalOptions.sort(this.compareOptions);
		return globalOptions;
	}
	/**
	* Get an array of the arguments if any have a description.
	*
	* @param {Command} cmd
	* @returns {Argument[]}
	*/
	visibleArguments(cmd) {
		if (cmd._argsDescription) cmd.registeredArguments.forEach((argument) => {
			argument.description = argument.description || cmd._argsDescription[argument.name()] || "";
		});
		if (cmd.registeredArguments.find((argument) => argument.description)) return cmd.registeredArguments;
		return [];
	}
	/**
	* Get the command term to show in the list of subcommands.
	*
	* @param {Command} cmd
	* @returns {string}
	*/
	subcommandTerm(cmd) {
		const args = cmd.registeredArguments.map((arg) => humanReadableArgName(arg)).join(" ");
		return cmd._name + (cmd._aliases[0] ? "|" + cmd._aliases[0] : "") + (cmd.options.length ? " [options]" : "") + (args ? " " + args : "");
	}
	/**
	* Get the option term to show in the list of options.
	*
	* @param {Option} option
	* @returns {string}
	*/
	optionTerm(option) {
		return option.flags;
	}
	/**
	* Get the argument term to show in the list of arguments.
	*
	* @param {Argument} argument
	* @returns {string}
	*/
	argumentTerm(argument) {
		return argument.name();
	}
	/**
	* Get the longest command term length.
	*
	* @param {Command} cmd
	* @param {Help} helper
	* @returns {number}
	*/
	longestSubcommandTermLength(cmd, helper) {
		return helper.visibleCommands(cmd).reduce((max, command) => {
			return Math.max(max, this.displayWidth(helper.styleSubcommandTerm(helper.subcommandTerm(command))));
		}, 0);
	}
	/**
	* Get the longest option term length.
	*
	* @param {Command} cmd
	* @param {Help} helper
	* @returns {number}
	*/
	longestOptionTermLength(cmd, helper) {
		return helper.visibleOptions(cmd).reduce((max, option) => {
			return Math.max(max, this.displayWidth(helper.styleOptionTerm(helper.optionTerm(option))));
		}, 0);
	}
	/**
	* Get the longest global option term length.
	*
	* @param {Command} cmd
	* @param {Help} helper
	* @returns {number}
	*/
	longestGlobalOptionTermLength(cmd, helper) {
		return helper.visibleGlobalOptions(cmd).reduce((max, option) => {
			return Math.max(max, this.displayWidth(helper.styleOptionTerm(helper.optionTerm(option))));
		}, 0);
	}
	/**
	* Get the longest argument term length.
	*
	* @param {Command} cmd
	* @param {Help} helper
	* @returns {number}
	*/
	longestArgumentTermLength(cmd, helper) {
		return helper.visibleArguments(cmd).reduce((max, argument) => {
			return Math.max(max, this.displayWidth(helper.styleArgumentTerm(helper.argumentTerm(argument))));
		}, 0);
	}
	/**
	* Get the command usage to be displayed at the top of the built-in help.
	*
	* @param {Command} cmd
	* @returns {string}
	*/
	commandUsage(cmd) {
		let cmdName = cmd._name;
		if (cmd._aliases[0]) cmdName = cmdName + "|" + cmd._aliases[0];
		let ancestorCmdNames = "";
		for (let ancestorCmd = cmd.parent; ancestorCmd; ancestorCmd = ancestorCmd.parent) ancestorCmdNames = ancestorCmd.name() + " " + ancestorCmdNames;
		return ancestorCmdNames + cmdName + " " + cmd.usage();
	}
	/**
	* Get the description for the command.
	*
	* @param {Command} cmd
	* @returns {string}
	*/
	commandDescription(cmd) {
		return cmd.description();
	}
	/**
	* Get the subcommand summary to show in the list of subcommands.
	* (Fallback to description for backwards compatibility.)
	*
	* @param {Command} cmd
	* @returns {string}
	*/
	subcommandDescription(cmd) {
		return cmd.summary() || cmd.description();
	}
	/**
	* Get the option description to show in the list of options.
	*
	* @param {Option} option
	* @return {string}
	*/
	optionDescription(option) {
		const extraInfo = [];
		if (option.argChoices) extraInfo.push(`choices: ${option.argChoices.map((choice) => JSON.stringify(choice)).join(", ")}`);
		if (option.defaultValue !== void 0) {
			if (option.required || option.optional || option.isBoolean() && typeof option.defaultValue === "boolean") extraInfo.push(`default: ${option.defaultValueDescription || JSON.stringify(option.defaultValue)}`);
		}
		if (option.presetArg !== void 0 && option.optional) extraInfo.push(`preset: ${JSON.stringify(option.presetArg)}`);
		if (option.envVar !== void 0) extraInfo.push(`env: ${option.envVar}`);
		if (extraInfo.length > 0) {
			const extraDescription = `(${extraInfo.join(", ")})`;
			if (option.description) return `${option.description} ${extraDescription}`;
			return extraDescription;
		}
		return option.description;
	}
	/**
	* Get the argument description to show in the list of arguments.
	*
	* @param {Argument} argument
	* @return {string}
	*/
	argumentDescription(argument) {
		const extraInfo = [];
		if (argument.argChoices) extraInfo.push(`choices: ${argument.argChoices.map((choice) => JSON.stringify(choice)).join(", ")}`);
		if (argument.defaultValue !== void 0) extraInfo.push(`default: ${argument.defaultValueDescription || JSON.stringify(argument.defaultValue)}`);
		if (extraInfo.length > 0) {
			const extraDescription = `(${extraInfo.join(", ")})`;
			if (argument.description) return `${argument.description} ${extraDescription}`;
			return extraDescription;
		}
		return argument.description;
	}
	/**
	* Format a list of items, given a heading and an array of formatted items.
	*
	* @param {string} heading
	* @param {string[]} items
	* @param {Help} helper
	* @returns string[]
	*/
	formatItemList(heading, items, helper) {
		if (items.length === 0) return [];
		return [
			helper.styleTitle(heading),
			...items,
			""
		];
	}
	/**
	* Group items by their help group heading.
	*
	* @param {Command[] | Option[]} unsortedItems
	* @param {Command[] | Option[]} visibleItems
	* @param {Function} getGroup
	* @returns {Map<string, Command[] | Option[]>}
	*/
	groupItems(unsortedItems, visibleItems, getGroup) {
		const result = /* @__PURE__ */ new Map();
		unsortedItems.forEach((item) => {
			const group = getGroup(item);
			if (!result.has(group)) result.set(group, []);
		});
		visibleItems.forEach((item) => {
			const group = getGroup(item);
			if (!result.has(group)) result.set(group, []);
			result.get(group).push(item);
		});
		return result;
	}
	/**
	* Generate the built-in help text.
	*
	* @param {Command} cmd
	* @param {Help} helper
	* @returns {string}
	*/
	formatHelp(cmd, helper) {
		const termWidth = helper.padWidth(cmd, helper);
		const helpWidth = helper.helpWidth ?? 80;
		function callFormatItem(term, description) {
			return helper.formatItem(term, termWidth, description, helper);
		}
		let output = [`${helper.styleTitle("Usage:")} ${helper.styleUsage(helper.commandUsage(cmd))}`, ""];
		const commandDescription = helper.commandDescription(cmd);
		if (commandDescription.length > 0) output = output.concat([helper.boxWrap(helper.styleCommandDescription(commandDescription), helpWidth), ""]);
		const argumentList = helper.visibleArguments(cmd).map((argument) => {
			return callFormatItem(helper.styleArgumentTerm(helper.argumentTerm(argument)), helper.styleArgumentDescription(helper.argumentDescription(argument)));
		});
		output = output.concat(this.formatItemList("Arguments:", argumentList, helper));
		this.groupItems(cmd.options, helper.visibleOptions(cmd), (option) => option.helpGroupHeading ?? "Options:").forEach((options, group) => {
			const optionList = options.map((option) => {
				return callFormatItem(helper.styleOptionTerm(helper.optionTerm(option)), helper.styleOptionDescription(helper.optionDescription(option)));
			});
			output = output.concat(this.formatItemList(group, optionList, helper));
		});
		if (helper.showGlobalOptions) {
			const globalOptionList = helper.visibleGlobalOptions(cmd).map((option) => {
				return callFormatItem(helper.styleOptionTerm(helper.optionTerm(option)), helper.styleOptionDescription(helper.optionDescription(option)));
			});
			output = output.concat(this.formatItemList("Global Options:", globalOptionList, helper));
		}
		this.groupItems(cmd.commands, helper.visibleCommands(cmd), (sub) => sub.helpGroup() || "Commands:").forEach((commands, group) => {
			const commandList = commands.map((sub) => {
				return callFormatItem(helper.styleSubcommandTerm(helper.subcommandTerm(sub)), helper.styleSubcommandDescription(helper.subcommandDescription(sub)));
			});
			output = output.concat(this.formatItemList(group, commandList, helper));
		});
		return output.join("\n");
	}
	/**
	* Return display width of string, ignoring ANSI escape sequences. Used in padding and wrapping calculations.
	*
	* @param {string} str
	* @returns {number}
	*/
	displayWidth(str) {
		return stripVTControlCharacters(str).length;
	}
	/**
	* Style the title for displaying in the help. Called with 'Usage:', 'Options:', etc.
	*
	* @param {string} str
	* @returns {string}
	*/
	styleTitle(str) {
		return str;
	}
	styleUsage(str) {
		return str.split(" ").map((word) => {
			if (word === "[options]") return this.styleOptionText(word);
			if (word === "[command]") return this.styleSubcommandText(word);
			if (word[0] === "[" || word[0] === "<") return this.styleArgumentText(word);
			return this.styleCommandText(word);
		}).join(" ");
	}
	styleCommandDescription(str) {
		return this.styleDescriptionText(str);
	}
	styleOptionDescription(str) {
		return this.styleDescriptionText(str);
	}
	styleSubcommandDescription(str) {
		return this.styleDescriptionText(str);
	}
	styleArgumentDescription(str) {
		return this.styleDescriptionText(str);
	}
	styleDescriptionText(str) {
		return str;
	}
	styleOptionTerm(str) {
		return this.styleOptionText(str);
	}
	styleSubcommandTerm(str) {
		return str.split(" ").map((word) => {
			if (word === "[options]") return this.styleOptionText(word);
			if (word[0] === "[" || word[0] === "<") return this.styleArgumentText(word);
			return this.styleSubcommandText(word);
		}).join(" ");
	}
	styleArgumentTerm(str) {
		return this.styleArgumentText(str);
	}
	styleOptionText(str) {
		return str;
	}
	styleArgumentText(str) {
		return str;
	}
	styleSubcommandText(str) {
		return str;
	}
	styleCommandText(str) {
		return str;
	}
	/**
	* Calculate the pad width from the maximum term length.
	*
	* @param {Command} cmd
	* @param {Help} helper
	* @returns {number}
	*/
	padWidth(cmd, helper) {
		return Math.max(helper.longestOptionTermLength(cmd, helper), helper.longestGlobalOptionTermLength(cmd, helper), helper.longestSubcommandTermLength(cmd, helper), helper.longestArgumentTermLength(cmd, helper));
	}
	/**
	* Detect manually wrapped and indented strings by checking for line break followed by whitespace.
	*
	* @param {string} str
	* @returns {boolean}
	*/
	preformatted(str) {
		return /\n[^\S\r\n]/.test(str);
	}
	/**
	* Format the "item", which consists of a term and description. Pad the term and wrap the description, indenting the following lines.
	*
	* So "TTT", 5, "DDD DDDD DD DDD" might be formatted for this.helpWidth=17 like so:
	*   TTT  DDD DDDD
	*        DD DDD
	*
	* @param {string} term
	* @param {number} termWidth
	* @param {string} description
	* @param {Help} helper
	* @returns {string}
	*/
	formatItem(term, termWidth, description, helper) {
		const itemIndent = 2;
		const itemIndentStr = " ".repeat(itemIndent);
		if (!description) return itemIndentStr + term;
		const paddedTerm = term.padEnd(termWidth + term.length - helper.displayWidth(term));
		const spacerWidth = 2;
		const remainingWidth = (this.helpWidth ?? 80) - termWidth - spacerWidth - itemIndent;
		let formattedDescription;
		if (remainingWidth < this.minWidthToWrap || helper.preformatted(description)) formattedDescription = description;
		else formattedDescription = helper.boxWrap(description, remainingWidth).replace(/\n/g, "\n" + " ".repeat(termWidth + spacerWidth));
		return itemIndentStr + paddedTerm + " ".repeat(spacerWidth) + formattedDescription.replace(/\n/g, `\n${itemIndentStr}`);
	}
	/**
	* Wrap a string at whitespace, preserving existing line breaks.
	* Wrapping is skipped if the width is less than `minWidthToWrap`.
	*
	* @param {string} str
	* @param {number} width
	* @returns {string}
	*/
	boxWrap(str, width) {
		if (width < this.minWidthToWrap) return str;
		const rawLines = str.split(/\r\n|\n/);
		const chunkPattern = /[\s]*[^\s]+/g;
		const wrappedLines = [];
		rawLines.forEach((line) => {
			const chunks = line.match(chunkPattern);
			if (chunks === null) {
				wrappedLines.push("");
				return;
			}
			let sumChunks = [chunks.shift()];
			let sumWidth = this.displayWidth(sumChunks[0]);
			chunks.forEach((chunk) => {
				const visibleWidth = this.displayWidth(chunk);
				if (sumWidth + visibleWidth <= width) {
					sumChunks.push(chunk);
					sumWidth += visibleWidth;
					return;
				}
				wrappedLines.push(sumChunks.join(""));
				const nextChunk = chunk.trimStart();
				sumChunks = [nextChunk];
				sumWidth = this.displayWidth(nextChunk);
			});
			wrappedLines.push(sumChunks.join(""));
		});
		return wrappedLines.join("\n");
	}
};
//#endregion
//#region ../../node_modules/.pnpm/commander@15.0.0/node_modules/commander/lib/option.js
var Option = class {
	/**
	* Initialize a new `Option` with the given `flags` and `description`.
	*
	* @param {string} flags
	* @param {string} [description]
	*/
	constructor(flags, description) {
		this.flags = flags;
		this.description = description || "";
		this.required = flags.includes("<");
		this.optional = flags.includes("[");
		this.variadic = /\w\.\.\.[>\]]$/.test(flags);
		this.mandatory = false;
		const optionFlags = splitOptionFlags(flags);
		this.short = optionFlags.shortFlag;
		this.long = optionFlags.longFlag;
		this.negate = false;
		if (this.long) this.negate = this.long.startsWith("--no-");
		this.defaultValue = void 0;
		this.defaultValueDescription = void 0;
		this.presetArg = void 0;
		this.envVar = void 0;
		this.parseArg = void 0;
		this.hidden = false;
		this.argChoices = void 0;
		this.conflictsWith = [];
		this.implied = void 0;
		this.helpGroupHeading = void 0;
	}
	/**
	* Set the default value, and optionally supply the description to be displayed in the help.
	*
	* @param {*} value
	* @param {string} [description]
	* @return {Option}
	*/
	default(value, description) {
		this.defaultValue = value;
		this.defaultValueDescription = description;
		return this;
	}
	/**
	* Preset to use when option used without option-argument, especially optional but also boolean and negated.
	* The custom processing (parseArg) is called.
	*
	* @example
	* new Option('--color').default('GREYSCALE').preset('RGB');
	* new Option('--donate [amount]').preset('20').argParser(parseFloat);
	*
	* @param {*} arg
	* @return {Option}
	*/
	preset(arg) {
		this.presetArg = arg;
		return this;
	}
	/**
	* Add option name(s) that conflict with this option.
	* An error will be displayed if conflicting options are found during parsing.
	*
	* @example
	* new Option('--rgb').conflicts('cmyk');
	* new Option('--js').conflicts(['ts', 'jsx']);
	*
	* @param {(string | string[])} names
	* @return {Option}
	*/
	conflicts(names) {
		this.conflictsWith = this.conflictsWith.concat(names);
		return this;
	}
	/**
	* Specify implied option values for when this option is set and the implied options are not.
	*
	* The custom processing (parseArg) is not called on the implied values.
	*
	* @example
	* program
	*   .addOption(new Option('--log', 'write logging information to file'))
	*   .addOption(new Option('--trace', 'log extra details').implies({ log: 'trace.txt' }));
	*
	* @param {object} impliedOptionValues
	* @return {Option}
	*/
	implies(impliedOptionValues) {
		let newImplied = impliedOptionValues;
		if (typeof impliedOptionValues === "string") newImplied = { [impliedOptionValues]: true };
		this.implied = Object.assign(this.implied || {}, newImplied);
		return this;
	}
	/**
	* Set environment variable to check for option value.
	*
	* An environment variable is only used if when processed the current option value is
	* undefined, or the source of the current value is 'default' or 'config' or 'env'.
	*
	* @param {string} name
	* @return {Option}
	*/
	env(name) {
		this.envVar = name;
		return this;
	}
	/**
	* Set the custom handler for processing CLI option arguments into option values.
	*
	* @param {Function} [fn]
	* @return {Option}
	*/
	argParser(fn) {
		this.parseArg = fn;
		return this;
	}
	/**
	* Whether the option is mandatory and must have a value after parsing.
	*
	* @param {boolean} [mandatory=true]
	* @return {Option}
	*/
	makeOptionMandatory(mandatory = true) {
		this.mandatory = !!mandatory;
		return this;
	}
	/**
	* Hide option in help.
	*
	* @param {boolean} [hide=true]
	* @return {Option}
	*/
	hideHelp(hide = true) {
		this.hidden = !!hide;
		return this;
	}
	/**
	* @package
	*/
	_collectValue(value, previous) {
		if (previous === this.defaultValue || !Array.isArray(previous)) return [value];
		previous.push(value);
		return previous;
	}
	/**
	* Only allow option value to be one of choices.
	*
	* @param {string[]} values
	* @return {Option}
	*/
	choices(values) {
		this.argChoices = values.slice();
		this.parseArg = (arg, previous) => {
			if (!this.argChoices.includes(arg)) throw new InvalidArgumentError(`Allowed choices are ${this.argChoices.join(", ")}.`);
			if (this.variadic) return this._collectValue(arg, previous);
			return arg;
		};
		return this;
	}
	/**
	* Return option name.
	*
	* @return {string}
	*/
	name() {
		if (this.long) return this.long.replace(/^--/, "");
		return this.short.replace(/^-/, "");
	}
	/**
	* Return option name, in a camelcase format that can be used
	* as an object attribute key.
	*
	* @return {string}
	*/
	attributeName() {
		if (this.negate) return camelcase(this.name().replace(/^no-/, ""));
		return camelcase(this.name());
	}
	/**
	* Set the help group heading.
	*
	* @param {string} heading
	* @return {Option}
	*/
	helpGroup(heading) {
		this.helpGroupHeading = heading;
		return this;
	}
	/**
	* Check if `arg` matches the short or long flag.
	*
	* @param {string} arg
	* @return {boolean}
	* @package
	*/
	is(arg) {
		return this.short === arg || this.long === arg;
	}
	/**
	* Return whether a boolean option.
	*
	* Options are one of boolean, negated, required argument, or optional argument.
	*
	* @return {boolean}
	* @package
	*/
	isBoolean() {
		return !this.required && !this.optional && !this.negate;
	}
};
/**
* This class is to make it easier to work with dual options, without changing the existing
* implementation. We support separate dual options for separate positive and negative options,
* like `--build` and `--no-build`, which share a single option value. This works nicely for some
* use cases, but is tricky for others where we want separate behaviours despite
* the single shared option value.
*/
var DualOptions = class {
	/**
	* @param {Option[]} options
	*/
	constructor(options) {
		this.positiveOptions = /* @__PURE__ */ new Map();
		this.negativeOptions = /* @__PURE__ */ new Map();
		this.dualOptions = /* @__PURE__ */ new Set();
		options.forEach((option) => {
			if (option.negate) this.negativeOptions.set(option.attributeName(), option);
			else this.positiveOptions.set(option.attributeName(), option);
		});
		this.negativeOptions.forEach((value, key) => {
			if (this.positiveOptions.has(key)) this.dualOptions.add(key);
		});
	}
	/**
	* Did the value come from the option, and not from possible matching dual option?
	*
	* @param {*} value
	* @param {Option} option
	* @returns {boolean}
	*/
	valueFromOption(value, option) {
		const optionKey = option.attributeName();
		if (!this.dualOptions.has(optionKey)) return true;
		const preset = this.negativeOptions.get(optionKey).presetArg;
		const negativeValue = preset !== void 0 ? preset : false;
		return option.negate === (negativeValue === value);
	}
};
/**
* Convert string from kebab-case to camelCase.
*
* @param {string} str
* @return {string}
* @private
*/
function camelcase(str) {
	return str.split("-").reduce((str, word) => {
		return str + word[0].toUpperCase() + word.slice(1);
	});
}
/**
* Split the short and long flag out of something like '-m,--mixed <value>'
*
* @private
*/
function splitOptionFlags(flags) {
	let shortFlag;
	let longFlag;
	const shortFlagExp = /^-[^-]$/;
	const longFlagExp = /^--[^-]/;
	const flagParts = flags.split(/[ |,]+/).concat("guard");
	if (shortFlagExp.test(flagParts[0])) shortFlag = flagParts.shift();
	if (longFlagExp.test(flagParts[0])) longFlag = flagParts.shift();
	if (!shortFlag && shortFlagExp.test(flagParts[0])) shortFlag = flagParts.shift();
	if (!shortFlag && longFlagExp.test(flagParts[0])) {
		shortFlag = longFlag;
		longFlag = flagParts.shift();
	}
	if (flagParts[0].startsWith("-")) {
		const unsupportedFlag = flagParts[0];
		const baseError = `option creation failed due to '${unsupportedFlag}' in option flags '${flags}'`;
		if (/^-[^-][^-]/.test(unsupportedFlag)) throw new Error(`${baseError}
- a short flag is a single dash and a single character
  - either use a single dash and a single character (for a short flag)
  - or use a double dash for a long option (and can have two, like '--ws, --workspace')`);
		if (shortFlagExp.test(unsupportedFlag)) throw new Error(`${baseError}
- too many short flags`);
		if (longFlagExp.test(unsupportedFlag)) throw new Error(`${baseError}
- too many long flags`);
		throw new Error(`${baseError}
- unrecognised flag format`);
	}
	if (shortFlag === void 0 && longFlag === void 0) throw new Error(`option creation failed due to no flags found in '${flags}'.`);
	return {
		shortFlag,
		longFlag
	};
}
//#endregion
//#region ../../node_modules/.pnpm/commander@15.0.0/node_modules/commander/lib/suggestSimilar.js
const maxDistance = 3;
function editDistance(a, b) {
	if (Math.abs(a.length - b.length) > maxDistance) return Math.max(a.length, b.length);
	const d = [];
	for (let i = 0; i <= a.length; i++) d[i] = [i];
	for (let j = 0; j <= b.length; j++) d[0][j] = j;
	for (let j = 1; j <= b.length; j++) for (let i = 1; i <= a.length; i++) {
		let cost;
		if (a[i - 1] === b[j - 1]) cost = 0;
		else cost = 1;
		d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + cost);
		if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
	}
	return d[a.length][b.length];
}
/**
* Find close matches, restricted to same number of edits.
*
* @param {string} word
* @param {string[]} candidates
* @returns {string}
*/
function suggestSimilar(word, candidates) {
	if (!candidates || candidates.length === 0) return "";
	candidates = Array.from(new Set(candidates));
	const searchingOptions = word.startsWith("--");
	if (searchingOptions) {
		word = word.slice(2);
		candidates = candidates.map((candidate) => candidate.slice(2));
	}
	let similar = [];
	let bestDistance = maxDistance;
	const minSimilarity = .4;
	candidates.forEach((candidate) => {
		if (candidate.length <= 1) return;
		const distance = editDistance(word, candidate);
		const length = Math.max(word.length, candidate.length);
		if ((length - distance) / length > minSimilarity) {
			if (distance < bestDistance) {
				bestDistance = distance;
				similar = [candidate];
			} else if (distance === bestDistance) similar.push(candidate);
		}
	});
	similar.sort((a, b) => a.localeCompare(b));
	if (searchingOptions) similar = similar.map((candidate) => `--${candidate}`);
	if (similar.length > 1) return `\n(Did you mean one of ${similar.join(", ")}?)`;
	if (similar.length === 1) return `\n(Did you mean ${similar[0]}?)`;
	return "";
}
//#endregion
//#region ../../node_modules/.pnpm/commander@15.0.0/node_modules/commander/lib/command.js
var Command = class Command extends EventEmitter {
	/**
	* Initialize a new `Command`.
	*
	* @param {string} [name]
	*/
	constructor(name) {
		super();
		/** @type {Command[]} */
		this.commands = [];
		/** @type {Option[]} */
		this.options = [];
		this.parent = null;
		this._allowUnknownOption = false;
		this._allowExcessArguments = false;
		/** @type {Argument[]} */
		this.registeredArguments = [];
		this._args = this.registeredArguments;
		/** @type {string[]} */
		this.args = [];
		this.rawArgs = [];
		this.processedArgs = [];
		this._scriptPath = null;
		this._name = name || "";
		this._optionValues = {};
		this._optionValueSources = {};
		this._storeOptionsAsProperties = false;
		this._actionHandler = null;
		this._executableHandler = false;
		this._executableFile = null;
		this._executableDir = null;
		this._defaultCommandName = null;
		this._exitCallback = null;
		this._aliases = [];
		this._combineFlagAndOptionalValue = true;
		this._description = "";
		this._summary = "";
		this._argsDescription = void 0;
		this._enablePositionalOptions = false;
		this._passThroughOptions = false;
		this._lifeCycleHooks = {};
		/** @type {(boolean | string)} */
		this._showHelpAfterError = false;
		this._showSuggestionAfterError = true;
		this._savedState = null;
		this._outputConfiguration = {
			writeOut: (str) => process$1.stdout.write(str),
			writeErr: (str) => process$1.stderr.write(str),
			outputError: (str, write) => write(str),
			getOutHelpWidth: () => process$1.stdout.isTTY ? process$1.stdout.columns : void 0,
			getErrHelpWidth: () => process$1.stderr.isTTY ? process$1.stderr.columns : void 0,
			getOutHasColors: () => useColor() ?? (process$1.stdout.isTTY && process$1.stdout.hasColors?.()),
			getErrHasColors: () => useColor() ?? (process$1.stderr.isTTY && process$1.stderr.hasColors?.()),
			stripColor: (str) => stripVTControlCharacters(str)
		};
		this._hidden = false;
		/** @type {(Option | null | undefined)} */
		this._helpOption = void 0;
		this._addImplicitHelpCommand = void 0;
		/** @type {Command} */
		this._helpCommand = void 0;
		this._helpConfiguration = {};
		/** @type {string | undefined} */
		this._helpGroupHeading = void 0;
		/** @type {string | undefined} */
		this._defaultCommandGroup = void 0;
		/** @type {string | undefined} */
		this._defaultOptionGroup = void 0;
	}
	/**
	* Copy settings that are useful to have in common across root command and subcommands.
	*
	* (Used internally when adding a command using `.command()` so subcommands inherit parent settings.)
	*
	* @param {Command} sourceCommand
	* @return {Command} `this` command for chaining
	*/
	copyInheritedSettings(sourceCommand) {
		this._outputConfiguration = sourceCommand._outputConfiguration;
		this._helpOption = sourceCommand._helpOption;
		this._helpCommand = sourceCommand._helpCommand;
		this._helpConfiguration = sourceCommand._helpConfiguration;
		this._exitCallback = sourceCommand._exitCallback;
		this._storeOptionsAsProperties = sourceCommand._storeOptionsAsProperties;
		this._combineFlagAndOptionalValue = sourceCommand._combineFlagAndOptionalValue;
		this._allowExcessArguments = sourceCommand._allowExcessArguments;
		this._enablePositionalOptions = sourceCommand._enablePositionalOptions;
		this._showHelpAfterError = sourceCommand._showHelpAfterError;
		this._showSuggestionAfterError = sourceCommand._showSuggestionAfterError;
		return this;
	}
	/**
	* @returns {Command[]}
	* @private
	*/
	_getCommandAndAncestors() {
		const result = [];
		for (let command = this; command; command = command.parent) result.push(command);
		return result;
	}
	/**
	* Define a command.
	*
	* There are two styles of command: pay attention to where to put the description.
	*
	* @example
	* // Command implemented using action handler (description is supplied separately to `.command`)
	* program
	*   .command('clone <source> [destination]')
	*   .description('clone a repository into a newly created directory')
	*   .action((source, destination) => {
	*     console.log('clone command called');
	*   });
	*
	* // Command implemented using separate executable file (description is second parameter to `.command`)
	* program
	*   .command('start <service>', 'start named service')
	*   .command('stop [service]', 'stop named service, or all if no name supplied');
	*
	* @param {string} nameAndArgs - command name and arguments, args are `<required>` or `[optional]` and last may also be `variadic...`
	* @param {(object | string)} [actionOptsOrExecDesc] - configuration options (for action), or description (for executable)
	* @param {object} [execOpts] - configuration options (for executable)
	* @return {Command} returns new command for action handler, or `this` for executable command
	*/
	command(nameAndArgs, actionOptsOrExecDesc, execOpts) {
		let desc = actionOptsOrExecDesc;
		let opts = execOpts;
		if (typeof desc === "object" && desc !== null) {
			opts = desc;
			desc = null;
		}
		opts = opts || {};
		const [, name, args] = nameAndArgs.match(/([^ ]+) *(.*)/);
		const cmd = this.createCommand(name);
		if (desc) {
			cmd.description(desc);
			cmd._executableHandler = true;
		}
		if (opts.isDefault) this._defaultCommandName = cmd._name;
		cmd._hidden = !!(opts.noHelp || opts.hidden);
		cmd._executableFile = opts.executableFile || null;
		if (args) cmd.arguments(args);
		this._registerCommand(cmd);
		cmd.parent = this;
		cmd.copyInheritedSettings(this);
		if (desc) return this;
		return cmd;
	}
	/**
	* Factory routine to create a new unattached command.
	*
	* See .command() for creating an attached subcommand, which uses this routine to
	* create the command. You can override createCommand to customise subcommands.
	*
	* @param {string} [name]
	* @return {Command} new command
	*/
	createCommand(name) {
		return new Command(name);
	}
	/**
	* You can customise the help with a subclass of Help by overriding createHelp,
	* or by overriding Help properties using configureHelp().
	*
	* @return {Help}
	*/
	createHelp() {
		return Object.assign(new Help(), this.configureHelp());
	}
	/**
	* You can customise the help by overriding Help properties using configureHelp(),
	* or with a subclass of Help by overriding createHelp().
	*
	* @param {object} [configuration] - configuration options
	* @return {(Command | object)} `this` command for chaining, or stored configuration
	*/
	configureHelp(configuration) {
		if (configuration === void 0) return this._helpConfiguration;
		this._helpConfiguration = configuration;
		return this;
	}
	/**
	* The default output goes to stdout and stderr. You can customise this for special
	* applications. You can also customise the display of errors by overriding outputError.
	*
	* The configuration properties are all functions:
	*
	*     // change how output being written, defaults to stdout and stderr
	*     writeOut(str)
	*     writeErr(str)
	*     // change how output being written for errors, defaults to writeErr
	*     outputError(str, write) // used for displaying errors and not used for displaying help
	*     // specify width for wrapping help
	*     getOutHelpWidth()
	*     getErrHelpWidth()
	*     // color support, currently only used with Help
	*     getOutHasColors()
	*     getErrHasColors()
	*     stripColor() // used to remove ANSI escape codes if output does not have colors
	*
	* @param {object} [configuration] - configuration options
	* @return {(Command | object)} `this` command for chaining, or stored configuration
	*/
	configureOutput(configuration) {
		if (configuration === void 0) return this._outputConfiguration;
		this._outputConfiguration = {
			...this._outputConfiguration,
			...configuration
		};
		return this;
	}
	/**
	* Display the help or a custom message after an error occurs.
	*
	* @param {(boolean|string)} [displayHelp]
	* @return {Command} `this` command for chaining
	*/
	showHelpAfterError(displayHelp = true) {
		if (typeof displayHelp !== "string") displayHelp = !!displayHelp;
		this._showHelpAfterError = displayHelp;
		return this;
	}
	/**
	* Display suggestion of similar commands for unknown commands, or options for unknown options.
	*
	* @param {boolean} [displaySuggestion]
	* @return {Command} `this` command for chaining
	*/
	showSuggestionAfterError(displaySuggestion = true) {
		this._showSuggestionAfterError = !!displaySuggestion;
		return this;
	}
	/**
	* Add a prepared subcommand.
	*
	* See .command() for creating an attached subcommand which inherits settings from its parent.
	*
	* @param {Command} cmd - new subcommand
	* @param {object} [opts] - configuration options
	* @return {Command} `this` command for chaining
	*/
	addCommand(cmd, opts) {
		if (!cmd._name) throw new Error(`Command passed to .addCommand() must have a name
- specify the name in Command constructor or using .name()`);
		opts = opts || {};
		if (opts.isDefault) this._defaultCommandName = cmd._name;
		if (opts.noHelp || opts.hidden) cmd._hidden = true;
		this._registerCommand(cmd);
		cmd.parent = this;
		cmd._checkForBrokenPassThrough();
		return this;
	}
	/**
	* Factory routine to create a new unattached argument.
	*
	* See .argument() for creating an attached argument, which uses this routine to
	* create the argument. You can override createArgument to return a custom argument.
	*
	* @param {string} name
	* @param {string} [description]
	* @return {Argument} new argument
	*/
	createArgument(name, description) {
		return new Argument(name, description);
	}
	/**
	* Define argument syntax for command.
	*
	* The default is that the argument is required, and you can explicitly
	* indicate this with <> around the name. Put [] around the name for an optional argument.
	*
	* @example
	* program.argument('<input-file>');
	* program.argument('[output-file]');
	*
	* @param {string} name
	* @param {string} [description]
	* @param {(Function|*)} [parseArg] - custom argument processing function or default value
	* @param {*} [defaultValue]
	* @return {Command} `this` command for chaining
	*/
	argument(name, description, parseArg, defaultValue) {
		const argument = this.createArgument(name, description);
		if (typeof parseArg === "function") argument.default(defaultValue).argParser(parseArg);
		else argument.default(parseArg);
		this.addArgument(argument);
		return this;
	}
	/**
	* Define argument syntax for command, adding multiple at once (without descriptions).
	*
	* See also .argument().
	*
	* @example
	* program.arguments('<cmd> [env]');
	*
	* @param {string} names
	* @return {Command} `this` command for chaining
	*/
	arguments(names) {
		names.trim().split(/ +/).forEach((detail) => {
			this.argument(detail);
		});
		return this;
	}
	/**
	* Define argument syntax for command, adding a prepared argument.
	*
	* @param {Argument} argument
	* @return {Command} `this` command for chaining
	*/
	addArgument(argument) {
		const previousArgument = this.registeredArguments.slice(-1)[0];
		if (previousArgument?.variadic) throw new Error(`only the last argument can be variadic '${previousArgument.name()}'`);
		if (argument.required && argument.defaultValue !== void 0 && argument.parseArg === void 0) throw new Error(`a default value for a required argument is never used: '${argument.name()}'`);
		this.registeredArguments.push(argument);
		return this;
	}
	/**
	* Customise or override default help command. By default a help command is automatically added if your command has subcommands.
	*
	* @example
	*    program.helpCommand('help [cmd]');
	*    program.helpCommand('help [cmd]', 'show help');
	*    program.helpCommand(false); // suppress default help command
	*    program.helpCommand(true); // add help command even if no subcommands
	*
	* @param {string|boolean} enableOrNameAndArgs - enable with custom name and/or arguments, or boolean to override whether added
	* @param {string} [description] - custom description
	* @return {Command} `this` command for chaining
	*/
	helpCommand(enableOrNameAndArgs, description) {
		if (typeof enableOrNameAndArgs === "boolean") {
			this._addImplicitHelpCommand = enableOrNameAndArgs;
			if (enableOrNameAndArgs && this._defaultCommandGroup) this._initCommandGroup(this._getHelpCommand());
			return this;
		}
		const [, helpName, helpArgs] = (enableOrNameAndArgs ?? "help [command]").match(/([^ ]+) *(.*)/);
		const helpDescription = description ?? "display help for command";
		const helpCommand = this.createCommand(helpName);
		helpCommand.helpOption(false);
		if (helpArgs) helpCommand.arguments(helpArgs);
		if (helpDescription) helpCommand.description(helpDescription);
		this._addImplicitHelpCommand = true;
		this._helpCommand = helpCommand;
		if (enableOrNameAndArgs || description) this._initCommandGroup(helpCommand);
		return this;
	}
	/**
	* Add prepared custom help command.
	*
	* @param {(Command|string|boolean)} helpCommand - custom help command, or deprecated enableOrNameAndArgs as for `.helpCommand()`
	* @param {string} [deprecatedDescription] - deprecated custom description used with custom name only
	* @return {Command} `this` command for chaining
	*/
	addHelpCommand(helpCommand, deprecatedDescription) {
		if (typeof helpCommand !== "object") {
			this.helpCommand(helpCommand, deprecatedDescription);
			return this;
		}
		this._addImplicitHelpCommand = true;
		this._helpCommand = helpCommand;
		this._initCommandGroup(helpCommand);
		return this;
	}
	/**
	* Lazy create help command.
	*
	* @return {(Command|null)}
	* @package
	*/
	_getHelpCommand() {
		if (this._addImplicitHelpCommand ?? (this.commands.length && !this._actionHandler && !this._findCommand("help"))) {
			if (this._helpCommand === void 0) this.helpCommand(void 0, void 0);
			return this._helpCommand;
		}
		return null;
	}
	/**
	* Add hook for life cycle event.
	*
	* @param {string} event
	* @param {Function} listener
	* @return {Command} `this` command for chaining
	*/
	hook(event, listener) {
		const allowedValues = [
			"preSubcommand",
			"preAction",
			"postAction"
		];
		if (!allowedValues.includes(event)) throw new Error(`Unexpected value for event passed to hook : '${event}'.
Expecting one of '${allowedValues.join("', '")}'`);
		if (this._lifeCycleHooks[event]) this._lifeCycleHooks[event].push(listener);
		else this._lifeCycleHooks[event] = [listener];
		return this;
	}
	/**
	* Register callback to use as replacement for calling process.exit.
	*
	* @param {Function} [fn] optional callback which will be passed a CommanderError, defaults to throwing
	* @return {Command} `this` command for chaining
	*/
	exitOverride(fn) {
		if (fn) this._exitCallback = fn;
		else this._exitCallback = (err) => {
			if (err.code !== "commander.executeSubCommandAsync") throw err;
		};
		return this;
	}
	/**
	* Call process.exit, and _exitCallback if defined.
	*
	* @param {number} exitCode exit code for using with process.exit
	* @param {string} code an id string representing the error
	* @param {string} message human-readable description of the error
	* @return never
	* @private
	*/
	_exit(exitCode, code, message) {
		if (this._exitCallback) this._exitCallback(new CommanderError(exitCode, code, message));
		process$1.exit(exitCode);
	}
	/**
	* Register callback `fn` for the command.
	*
	* @example
	* program
	*   .command('serve')
	*   .description('start service')
	*   .action(function() {
	*      // do work here
	*   });
	*
	* @param {Function} fn
	* @return {Command} `this` command for chaining
	*/
	action(fn) {
		const listener = (args) => {
			const expectedArgsCount = this.registeredArguments.length;
			const actionArgs = args.slice(0, expectedArgsCount);
			if (this._storeOptionsAsProperties) actionArgs[expectedArgsCount] = this;
			else actionArgs[expectedArgsCount] = this.opts();
			actionArgs.push(this);
			return fn.apply(this, actionArgs);
		};
		this._actionHandler = listener;
		return this;
	}
	/**
	* Factory routine to create a new unattached option.
	*
	* See .option() for creating an attached option, which uses this routine to
	* create the option. You can override createOption to return a custom option.
	*
	* @param {string} flags
	* @param {string} [description]
	* @return {Option} new option
	*/
	createOption(flags, description) {
		return new Option(flags, description);
	}
	/**
	* Wrap parseArgs to catch 'commander.invalidArgument'.
	*
	* @param {(Option | Argument)} target
	* @param {string} value
	* @param {*} previous
	* @param {string} invalidArgumentMessage
	* @private
	*/
	_callParseArg(target, value, previous, invalidArgumentMessage) {
		try {
			return target.parseArg(value, previous);
		} catch (err) {
			if (err.code === "commander.invalidArgument") {
				const message = `${invalidArgumentMessage} ${err.message}`;
				this.error(message, {
					exitCode: err.exitCode,
					code: err.code
				});
			}
			throw err;
		}
	}
	/**
	* Check for option flag conflicts.
	* Register option if no conflicts found, or throw on conflict.
	*
	* @param {Option} option
	* @private
	*/
	_registerOption(option) {
		const matchingOption = option.short && this._findOption(option.short) || option.long && this._findOption(option.long);
		if (matchingOption) {
			const matchingFlag = option.long && this._findOption(option.long) ? option.long : option.short;
			throw new Error(`Cannot add option '${option.flags}'${this._name && ` to command '${this._name}'`} due to conflicting flag '${matchingFlag}'
-  already used by option '${matchingOption.flags}'`);
		}
		this._initOptionGroup(option);
		this.options.push(option);
	}
	/**
	* Check for command name and alias conflicts with existing commands.
	* Register command if no conflicts found, or throw on conflict.
	*
	* @param {Command} command
	* @private
	*/
	_registerCommand(command) {
		const knownBy = (cmd) => {
			return [cmd.name()].concat(cmd.aliases());
		};
		const alreadyUsed = knownBy(command).find((name) => this._findCommand(name));
		if (alreadyUsed) {
			const existingCmd = knownBy(this._findCommand(alreadyUsed)).join("|");
			const newCmd = knownBy(command).join("|");
			throw new Error(`cannot add command '${newCmd}' as already have command '${existingCmd}'`);
		}
		this._initCommandGroup(command);
		this.commands.push(command);
	}
	/**
	* Add an option.
	*
	* @param {Option} option
	* @return {Command} `this` command for chaining
	*/
	addOption(option) {
		this._registerOption(option);
		const oname = option.name();
		const name = option.attributeName();
		if (option.defaultValue !== void 0) this.setOptionValueWithSource(name, option.defaultValue, "default");
		const handleOptionValue = (val, invalidValueMessage, valueSource) => {
			if (val == null && option.presetArg !== void 0) val = option.presetArg;
			const oldValue = this.getOptionValue(name);
			if (val !== null && option.parseArg) val = this._callParseArg(option, val, oldValue, invalidValueMessage);
			else if (val !== null && option.variadic) val = option._collectValue(val, oldValue);
			if (val == null) {
				if (option.negate) val = false;
				else if (option.isBoolean() || option.optional) val = true;
				else val = "";
			}
			this.setOptionValueWithSource(name, val, valueSource);
		};
		this.on("option:" + oname, (val) => {
			const invalidValueMessage = `error: option '${option.flags}' argument '${val}' is invalid.`;
			handleOptionValue(val, invalidValueMessage, "cli");
		});
		if (option.envVar) this.on("optionEnv:" + oname, (val) => {
			const invalidValueMessage = `error: option '${option.flags}' value '${val}' from env '${option.envVar}' is invalid.`;
			handleOptionValue(val, invalidValueMessage, "env");
		});
		return this;
	}
	/**
	* Internal implementation shared by .option() and .requiredOption()
	*
	* @return {Command} `this` command for chaining
	* @private
	*/
	_optionEx(config, flags, description, fn, defaultValue) {
		if (typeof flags === "object" && flags instanceof Option) throw new Error("To add an Option object use addOption() instead of option() or requiredOption()");
		const option = this.createOption(flags, description);
		option.makeOptionMandatory(!!config.mandatory);
		if (typeof fn === "function") option.default(defaultValue).argParser(fn);
		else if (fn instanceof RegExp) {
			const regex = fn;
			fn = (val, def) => {
				const m = regex.exec(val);
				return m ? m[0] : def;
			};
			option.default(defaultValue).argParser(fn);
		} else option.default(fn);
		return this.addOption(option);
	}
	/**
	* Define option with `flags`, `description`, and optional argument parsing function or `defaultValue` or both.
	*
	* The `flags` string contains the short and/or long flags, separated by comma, a pipe or space. A required
	* option-argument is indicated by `<>` and an optional option-argument by `[]`.
	*
	* See the README for more details, and see also addOption() and requiredOption().
	*
	* @example
	* program
	*     .option('-p, --pepper', 'add pepper')
	*     .option('--pt, --pizza-type <TYPE>', 'type of pizza') // required option-argument
	*     .option('-c, --cheese [CHEESE]', 'add extra cheese', 'mozzarella') // optional option-argument with default
	*     .option('-t, --tip <VALUE>', 'add tip to purchase cost', parseFloat) // custom parse function
	*
	* @param {string} flags
	* @param {string} [description]
	* @param {(Function|*)} [parseArg] - custom option processing function or default value
	* @param {*} [defaultValue]
	* @return {Command} `this` command for chaining
	*/
	option(flags, description, parseArg, defaultValue) {
		return this._optionEx({}, flags, description, parseArg, defaultValue);
	}
	/**
	* Add a required option which must have a value after parsing. This usually means
	* the option must be specified on the command line. (Otherwise the same as .option().)
	*
	* The `flags` string contains the short and/or long flags, separated by comma, a pipe or space.
	*
	* @param {string} flags
	* @param {string} [description]
	* @param {(Function|*)} [parseArg] - custom option processing function or default value
	* @param {*} [defaultValue]
	* @return {Command} `this` command for chaining
	*/
	requiredOption(flags, description, parseArg, defaultValue) {
		return this._optionEx({ mandatory: true }, flags, description, parseArg, defaultValue);
	}
	/**
	* Alter parsing of short flags with optional values.
	*
	* @example
	* // for `.option('-f,--flag [value]'):
	* program.combineFlagAndOptionalValue(true);  // `-f80` is treated like `--flag=80`, this is the default behaviour
	* program.combineFlagAndOptionalValue(false) // `-fb` is treated like `-f -b`
	*
	* @param {boolean} [combine] - if `true` or omitted, an optional value can be specified directly after the flag.
	* @return {Command} `this` command for chaining
	*/
	combineFlagAndOptionalValue(combine = true) {
		this._combineFlagAndOptionalValue = !!combine;
		return this;
	}
	/**
	* Allow unknown options on the command line.
	*
	* @param {boolean} [allowUnknown] - if `true` or omitted, no error will be thrown for unknown options.
	* @return {Command} `this` command for chaining
	*/
	allowUnknownOption(allowUnknown = true) {
		this._allowUnknownOption = !!allowUnknown;
		return this;
	}
	/**
	* Allow excess command-arguments on the command line. Pass false to make excess arguments an error.
	*
	* @param {boolean} [allowExcess] - if `true` or omitted, no error will be thrown for excess arguments.
	* @return {Command} `this` command for chaining
	*/
	allowExcessArguments(allowExcess = true) {
		this._allowExcessArguments = !!allowExcess;
		return this;
	}
	/**
	* Enable positional options. Positional means global options are specified before subcommands which lets
	* subcommands reuse the same option names, and also enables subcommands to turn on passThroughOptions.
	* The default behaviour is non-positional and global options may appear anywhere on the command line.
	*
	* @param {boolean} [positional]
	* @return {Command} `this` command for chaining
	*/
	enablePositionalOptions(positional = true) {
		this._enablePositionalOptions = !!positional;
		return this;
	}
	/**
	* Pass through options that come after command-arguments rather than treat them as command-options,
	* so actual command-options come before command-arguments. Turning this on for a subcommand requires
	* positional options to have been enabled on the program (parent commands).
	* The default behaviour is non-positional and options may appear before or after command-arguments.
	*
	* @param {boolean} [passThrough] for unknown options.
	* @return {Command} `this` command for chaining
	*/
	passThroughOptions(passThrough = true) {
		this._passThroughOptions = !!passThrough;
		this._checkForBrokenPassThrough();
		return this;
	}
	/**
	* @private
	*/
	_checkForBrokenPassThrough() {
		if (this.parent && this._passThroughOptions && !this.parent._enablePositionalOptions) throw new Error(`passThroughOptions cannot be used for '${this._name}' without turning on enablePositionalOptions for parent command(s)`);
	}
	/**
	* Whether to store option values as properties on command object,
	* or store separately (specify false). In both cases the option values can be accessed using .opts().
	*
	* @param {boolean} [storeAsProperties=true]
	* @return {Command} `this` command for chaining
	*/
	storeOptionsAsProperties(storeAsProperties = true) {
		if (this.options.length) throw new Error("call .storeOptionsAsProperties() before adding options");
		if (Object.keys(this._optionValues).length) throw new Error("call .storeOptionsAsProperties() before setting option values");
		this._storeOptionsAsProperties = !!storeAsProperties;
		return this;
	}
	/**
	* Retrieve option value.
	*
	* @param {string} key
	* @return {object} value
	*/
	getOptionValue(key) {
		if (this._storeOptionsAsProperties) return this[key];
		return this._optionValues[key];
	}
	/**
	* Store option value.
	*
	* @param {string} key
	* @param {object} value
	* @return {Command} `this` command for chaining
	*/
	setOptionValue(key, value) {
		return this.setOptionValueWithSource(key, value, void 0);
	}
	/**
	* Store option value and where the value came from.
	*
	* @param {string} key
	* @param {object} value
	* @param {string} source - expected values are default/config/env/cli/implied
	* @return {Command} `this` command for chaining
	*/
	setOptionValueWithSource(key, value, source) {
		if (this._storeOptionsAsProperties) this[key] = value;
		else this._optionValues[key] = value;
		this._optionValueSources[key] = source;
		return this;
	}
	/**
	* Get source of option value.
	* Expected values are default | config | env | cli | implied
	*
	* @param {string} key
	* @return {string}
	*/
	getOptionValueSource(key) {
		return this._optionValueSources[key];
	}
	/**
	* Get source of option value. See also .optsWithGlobals().
	* Expected values are default | config | env | cli | implied
	*
	* @param {string} key
	* @return {string}
	*/
	getOptionValueSourceWithGlobals(key) {
		let source;
		this._getCommandAndAncestors().forEach((cmd) => {
			if (cmd.getOptionValueSource(key) !== void 0) source = cmd.getOptionValueSource(key);
		});
		return source;
	}
	/**
	* Get user arguments from implied or explicit arguments.
	* Side-effects: set _scriptPath if args included script. Used for default program name, and subcommand searches.
	*
	* @private
	*/
	_prepareUserArgs(argv, parseOptions) {
		if (argv !== void 0 && !Array.isArray(argv)) throw new Error("first parameter to parse must be array or undefined");
		parseOptions = parseOptions || {};
		if (argv === void 0 && parseOptions.from === void 0) {
			if (process$1.versions?.electron) parseOptions.from = "electron";
			const execArgv = process$1.execArgv ?? [];
			if (execArgv.includes("-e") || execArgv.includes("--eval") || execArgv.includes("-p") || execArgv.includes("--print")) parseOptions.from = "eval";
		}
		if (argv === void 0) argv = process$1.argv;
		this.rawArgs = argv.slice();
		let userArgs;
		switch (parseOptions.from) {
			case void 0:
			case "node":
				this._scriptPath = argv[1];
				userArgs = argv.slice(2);
				break;
			case "electron":
				if (process$1.defaultApp) {
					this._scriptPath = argv[1];
					userArgs = argv.slice(2);
				} else userArgs = argv.slice(1);
				break;
			case "user":
				userArgs = argv.slice(0);
				break;
			case "eval":
				userArgs = argv.slice(1);
				break;
			default: throw new Error(`unexpected parse option { from: '${parseOptions.from}' }`);
		}
		if (!this._name && this._scriptPath) this.nameFromFilename(this._scriptPath);
		this._name = this._name || "program";
		return userArgs;
	}
	/**
	* Parse `argv`, setting options and invoking commands when defined.
	*
	* Use parseAsync instead of parse if any of your action handlers are async.
	*
	* Call with no parameters to parse `process.argv`. Detects Electron and special node options like `node --eval`. Easy mode!
	*
	* Or call with an array of strings to parse, and optionally where the user arguments start by specifying where the arguments are `from`:
	* - `'node'`: default, `argv[0]` is the application and `argv[1]` is the script being run, with user arguments after that
	* - `'electron'`: `argv[0]` is the application and `argv[1]` varies depending on whether the electron application is packaged
	* - `'user'`: just user arguments
	*
	* @example
	* program.parse(); // parse process.argv and auto-detect electron and special node flags
	* program.parse(process.argv); // assume argv[0] is app and argv[1] is script
	* program.parse(my-args, { from: 'user' }); // just user supplied arguments, nothing special about argv[0]
	*
	* @param {string[]} [argv] - optional, defaults to process.argv
	* @param {object} [parseOptions] - optionally specify style of options with from: node/user/electron
	* @param {string} [parseOptions.from] - where the args are from: 'node', 'user', 'electron'
	* @return {Command} `this` command for chaining
	*/
	parse(argv, parseOptions) {
		this._prepareForParse();
		const userArgs = this._prepareUserArgs(argv, parseOptions);
		this._parseCommand([], userArgs);
		return this;
	}
	/**
	* Parse `argv`, setting options and invoking commands when defined.
	*
	* Call with no parameters to parse `process.argv`. Detects Electron and special node options like `node --eval`. Easy mode!
	*
	* Or call with an array of strings to parse, and optionally where the user arguments start by specifying where the arguments are `from`:
	* - `'node'`: default, `argv[0]` is the application and `argv[1]` is the script being run, with user arguments after that
	* - `'electron'`: `argv[0]` is the application and `argv[1]` varies depending on whether the electron application is packaged
	* - `'user'`: just user arguments
	*
	* @example
	* await program.parseAsync(); // parse process.argv and auto-detect electron and special node flags
	* await program.parseAsync(process.argv); // assume argv[0] is app and argv[1] is script
	* await program.parseAsync(my-args, { from: 'user' }); // just user supplied arguments, nothing special about argv[0]
	*
	* @param {string[]} [argv]
	* @param {object} [parseOptions]
	* @param {string} parseOptions.from - where the args are from: 'node', 'user', 'electron'
	* @return {Promise}
	*/
	async parseAsync(argv, parseOptions) {
		this._prepareForParse();
		const userArgs = this._prepareUserArgs(argv, parseOptions);
		await this._parseCommand([], userArgs);
		return this;
	}
	_prepareForParse() {
		if (this._savedState === null) {
			this.options.filter((option) => option.negate && option.defaultValue === void 0 && this.getOptionValue(option.attributeName()) === void 0).forEach((option) => {
				const positiveLongFlag = option.long.replace(/^--no-/, "--");
				if (!this._findOption(positiveLongFlag)) this.setOptionValueWithSource(option.attributeName(), true, "default");
			});
			this.saveStateBeforeParse();
		} else this.restoreStateBeforeParse();
	}
	/**
	* Called the first time parse is called to save state and allow a restore before subsequent calls to parse.
	* Not usually called directly, but available for subclasses to save their custom state.
	*
	* This is called in a lazy way. Only commands used in parsing chain will have state saved.
	*/
	saveStateBeforeParse() {
		this._savedState = {
			_name: this._name,
			_optionValues: { ...this._optionValues },
			_optionValueSources: { ...this._optionValueSources }
		};
	}
	/**
	* Restore state before parse for calls after the first.
	* Not usually called directly, but available for subclasses to save their custom state.
	*
	* This is called in a lazy way. Only commands used in parsing chain will have state restored.
	*/
	restoreStateBeforeParse() {
		if (this._storeOptionsAsProperties) throw new Error(`Can not call parse again when storeOptionsAsProperties is true.
- either make a new Command for each call to parse, or stop storing options as properties`);
		this._name = this._savedState._name;
		this._scriptPath = null;
		this.rawArgs = [];
		this._optionValues = { ...this._savedState._optionValues };
		this._optionValueSources = { ...this._savedState._optionValueSources };
		this.args = [];
		this.processedArgs = [];
	}
	/**
	* Throw if expected executable is missing. Add lots of help for author.
	*
	* @param {string} executableFile
	* @param {string} executableDir
	* @param {string} subcommandName
	*/
	_checkForMissingExecutable(executableFile, executableDir, subcommandName) {
		if (fs.existsSync(executableFile)) return;
		const executableMissing = `'${executableFile}' does not exist
 - if '${subcommandName}' is not meant to be an executable command, remove description parameter from '.command()' and use '.description()' instead
 - if the default executable name is not suitable, use the executableFile option to supply a custom name or path
 - ${executableDir ? `searched for local subcommand relative to directory '${executableDir}'` : "no directory for search for local subcommand, use .executableDir() to supply a custom directory"}`;
		throw new Error(executableMissing);
	}
	/**
	* Execute a sub-command executable.
	*
	* @private
	*/
	_executeSubCommand(subcommand, args) {
		args = args.slice();
		const sourceExt = [
			".js",
			".ts",
			".tsx",
			".mjs",
			".cjs"
		];
		function findFile(baseDir, baseName) {
			const localBin = path.resolve(baseDir, baseName);
			if (fs.existsSync(localBin)) return localBin;
			if (sourceExt.includes(path.extname(baseName))) return void 0;
			const foundExt = sourceExt.find((ext) => fs.existsSync(`${localBin}${ext}`));
			if (foundExt) return `${localBin}${foundExt}`;
		}
		this._checkForMissingMandatoryOptions();
		this._checkForConflictingOptions();
		let executableFile = subcommand._executableFile || `${this._name}-${subcommand._name}`;
		let executableDir = this._executableDir || "";
		if (this._scriptPath) {
			let resolvedScriptPath;
			try {
				resolvedScriptPath = fs.realpathSync(this._scriptPath);
			} catch {
				resolvedScriptPath = this._scriptPath;
			}
			executableDir = path.resolve(path.dirname(resolvedScriptPath), executableDir);
		}
		if (executableDir) {
			let localFile = findFile(executableDir, executableFile);
			if (!localFile && !subcommand._executableFile && this._scriptPath) {
				const legacyName = path.basename(this._scriptPath, path.extname(this._scriptPath));
				if (legacyName !== this._name) localFile = findFile(executableDir, `${legacyName}-${subcommand._name}`);
			}
			executableFile = localFile || executableFile;
		}
		const launchWithNode = sourceExt.includes(path.extname(executableFile));
		let proc;
		if (process$1.platform !== "win32") {
			if (launchWithNode) {
				args.unshift(executableFile);
				args = incrementNodeInspectorPort(process$1.execArgv).concat(args);
				proc = childProcess.spawn(process$1.argv[0], args, { stdio: "inherit" });
			} else proc = childProcess.spawn(executableFile, args, { stdio: "inherit" });
		} else {
			this._checkForMissingExecutable(executableFile, executableDir, subcommand._name);
			args.unshift(executableFile);
			args = incrementNodeInspectorPort(process$1.execArgv).concat(args);
			proc = childProcess.spawn(process$1.execPath, args, { stdio: "inherit" });
		}
		if (!proc.killed) [
			"SIGUSR1",
			"SIGUSR2",
			"SIGTERM",
			"SIGINT",
			"SIGHUP"
		].forEach((signal) => {
			process$1.on(signal, () => {
				if (proc.killed === false && proc.exitCode === null) proc.kill(signal);
			});
		});
		const exitCallback = this._exitCallback;
		proc.on("close", (code) => {
			code = code ?? 1;
			if (!exitCallback) process$1.exit(code);
			else exitCallback(new CommanderError(code, "commander.executeSubCommandAsync", "(close)"));
		});
		proc.on("error", (err) => {
			if (err.code === "ENOENT") this._checkForMissingExecutable(executableFile, executableDir, subcommand._name);
			else if (err.code === "EACCES") throw new Error(`'${executableFile}' not executable`);
			if (!exitCallback) process$1.exit(1);
			else {
				const wrappedError = new CommanderError(1, "commander.executeSubCommandAsync", "(error)");
				wrappedError.nestedError = err;
				exitCallback(wrappedError);
			}
		});
		this.runningCommand = proc;
	}
	/**
	* @private
	*/
	_dispatchSubcommand(commandName, operands, unknown) {
		const subCommand = this._findCommand(commandName);
		if (!subCommand) this.help({ error: true });
		subCommand._prepareForParse();
		let promiseChain;
		promiseChain = this._chainOrCallSubCommandHook(promiseChain, subCommand, "preSubcommand");
		promiseChain = this._chainOrCall(promiseChain, () => {
			if (subCommand._executableHandler) this._executeSubCommand(subCommand, operands.concat(unknown));
			else return subCommand._parseCommand(operands, unknown);
		});
		return promiseChain;
	}
	/**
	* Invoke help directly if possible, or dispatch if necessary.
	* e.g. help foo
	*
	* @private
	*/
	_dispatchHelpCommand(subcommandName) {
		if (!subcommandName) this.help();
		const subCommand = this._findCommand(subcommandName);
		if (subCommand && !subCommand._executableHandler) subCommand.help();
		return this._dispatchSubcommand(subcommandName, [], [this._getHelpOption()?.long ?? this._getHelpOption()?.short ?? "--help"]);
	}
	/**
	* Check this.args against expected this.registeredArguments.
	*
	* @private
	*/
	_checkNumberOfArguments() {
		this.registeredArguments.forEach((arg, i) => {
			if (arg.required && this.args[i] == null) this.missingArgument(arg.name());
		});
		if (this.registeredArguments.length > 0 && this.registeredArguments[this.registeredArguments.length - 1].variadic) return;
		if (this.args.length > this.registeredArguments.length) this._excessArguments(this.args);
	}
	/**
	* Process this.args using this.registeredArguments and save as this.processedArgs!
	*
	* @private
	*/
	_processArguments() {
		const myParseArg = (argument, value, previous) => {
			let parsedValue = value;
			if (value !== null && argument.parseArg) {
				const invalidValueMessage = `error: command-argument value '${value}' is invalid for argument '${argument.name()}'.`;
				parsedValue = this._callParseArg(argument, value, previous, invalidValueMessage);
			}
			return parsedValue;
		};
		this._checkNumberOfArguments();
		const processedArgs = [];
		this.registeredArguments.forEach((declaredArg, index) => {
			let value = declaredArg.defaultValue;
			if (declaredArg.variadic) {
				if (index < this.args.length) {
					value = this.args.slice(index);
					if (declaredArg.parseArg) value = value.reduce((processed, v) => {
						return myParseArg(declaredArg, v, processed);
					}, declaredArg.defaultValue);
				} else if (value === void 0) value = [];
			} else if (index < this.args.length) {
				value = this.args[index];
				if (declaredArg.parseArg) value = myParseArg(declaredArg, value, declaredArg.defaultValue);
			}
			processedArgs[index] = value;
		});
		this.processedArgs = processedArgs;
	}
	/**
	* Once we have a promise we chain, but call synchronously until then.
	*
	* @param {(Promise|undefined)} promise
	* @param {Function} fn
	* @return {(Promise|undefined)}
	* @private
	*/
	_chainOrCall(promise, fn) {
		if (promise?.then && typeof promise.then === "function") return promise.then(() => fn());
		return fn();
	}
	/**
	*
	* @param {(Promise|undefined)} promise
	* @param {string} event
	* @return {(Promise|undefined)}
	* @private
	*/
	_chainOrCallHooks(promise, event) {
		let result = promise;
		const hooks = [];
		this._getCommandAndAncestors().reverse().filter((cmd) => cmd._lifeCycleHooks[event] !== void 0).forEach((hookedCommand) => {
			hookedCommand._lifeCycleHooks[event].forEach((callback) => {
				hooks.push({
					hookedCommand,
					callback
				});
			});
		});
		if (event === "postAction") hooks.reverse();
		hooks.forEach((hookDetail) => {
			result = this._chainOrCall(result, () => {
				return hookDetail.callback(hookDetail.hookedCommand, this);
			});
		});
		return result;
	}
	/**
	*
	* @param {(Promise|undefined)} promise
	* @param {Command} subCommand
	* @param {string} event
	* @return {(Promise|undefined)}
	* @private
	*/
	_chainOrCallSubCommandHook(promise, subCommand, event) {
		let result = promise;
		if (this._lifeCycleHooks[event] !== void 0) this._lifeCycleHooks[event].forEach((hook) => {
			result = this._chainOrCall(result, () => {
				return hook(this, subCommand);
			});
		});
		return result;
	}
	/**
	* Process arguments in context of this command.
	* Returns action result, in case it is a promise.
	*
	* @private
	*/
	_parseCommand(operands, unknown) {
		const parsed = this.parseOptions(unknown);
		this._parseOptionsEnv();
		this._parseOptionsImplied();
		operands = operands.concat(parsed.operands);
		unknown = parsed.unknown;
		this.args = operands.concat(unknown);
		if (operands && this._findCommand(operands[0])) return this._dispatchSubcommand(operands[0], operands.slice(1), unknown);
		if (this._getHelpCommand() && operands[0] === this._getHelpCommand().name()) return this._dispatchHelpCommand(operands[1]);
		if (this._defaultCommandName) {
			this._outputHelpIfRequested(unknown);
			return this._dispatchSubcommand(this._defaultCommandName, operands, unknown);
		}
		if (this.commands.length && this.args.length === 0 && !this._actionHandler && !this._defaultCommandName) this.help({ error: true });
		this._outputHelpIfRequested(parsed.unknown);
		this._checkForMissingMandatoryOptions();
		this._checkForConflictingOptions();
		const checkForUnknownOptions = () => {
			if (parsed.unknown.length > 0) this.unknownOption(parsed.unknown[0]);
		};
		const commandEvent = `command:${this.name()}`;
		if (this._actionHandler) {
			checkForUnknownOptions();
			this._processArguments();
			let promiseChain;
			promiseChain = this._chainOrCallHooks(promiseChain, "preAction");
			promiseChain = this._chainOrCall(promiseChain, () => this._actionHandler(this.processedArgs));
			if (this.parent) promiseChain = this._chainOrCall(promiseChain, () => {
				this.parent.emit(commandEvent, operands, unknown);
			});
			promiseChain = this._chainOrCallHooks(promiseChain, "postAction");
			return promiseChain;
		}
		if (this.parent?.listenerCount(commandEvent)) {
			checkForUnknownOptions();
			this._processArguments();
			this.parent.emit(commandEvent, operands, unknown);
		} else if (operands.length) {
			if (this._findCommand("*")) return this._dispatchSubcommand("*", operands, unknown);
			if (this.listenerCount("command:*")) this.emit("command:*", operands, unknown);
			else if (this.commands.length) this.unknownCommand();
			else {
				checkForUnknownOptions();
				this._processArguments();
			}
		} else if (this.commands.length) {
			checkForUnknownOptions();
			this.help({ error: true });
		} else {
			checkForUnknownOptions();
			this._processArguments();
		}
	}
	/**
	* Find matching command.
	*
	* @private
	* @return {Command | undefined}
	*/
	_findCommand(name) {
		if (!name) return void 0;
		return this.commands.find((cmd) => cmd._name === name || cmd._aliases.includes(name));
	}
	/**
	* Return an option matching `arg` if any.
	*
	* @param {string} arg
	* @return {Option}
	* @package
	*/
	_findOption(arg) {
		return this.options.find((option) => option.is(arg));
	}
	/**
	* Display an error message if a mandatory option does not have a value.
	* Called after checking for help flags in leaf subcommand.
	*
	* @private
	*/
	_checkForMissingMandatoryOptions() {
		this._getCommandAndAncestors().forEach((cmd) => {
			cmd.options.forEach((anOption) => {
				if (anOption.mandatory && cmd.getOptionValue(anOption.attributeName()) === void 0) cmd.missingMandatoryOptionValue(anOption);
			});
		});
	}
	/**
	* Display an error message if conflicting options are used together in this.
	*
	* @private
	*/
	_checkForConflictingLocalOptions() {
		const definedNonDefaultOptions = this.options.filter((option) => {
			const optionKey = option.attributeName();
			if (this.getOptionValue(optionKey) === void 0) return false;
			return this.getOptionValueSource(optionKey) !== "default";
		});
		definedNonDefaultOptions.filter((option) => option.conflictsWith.length > 0).forEach((option) => {
			const conflictingAndDefined = definedNonDefaultOptions.find((defined) => option.conflictsWith.includes(defined.attributeName()));
			if (conflictingAndDefined) this._conflictingOption(option, conflictingAndDefined);
		});
	}
	/**
	* Display an error message if conflicting options are used together.
	* Called after checking for help flags in leaf subcommand.
	*
	* @private
	*/
	_checkForConflictingOptions() {
		this._getCommandAndAncestors().forEach((cmd) => {
			cmd._checkForConflictingLocalOptions();
		});
	}
	/**
	* Parse options from `argv` removing known options,
	* and return argv split into operands and unknown arguments.
	*
	* Side effects: modifies command by storing options. Does not reset state if called again.
	*
	* Examples:
	*
	*     argv => operands, unknown
	*     --known kkk op => [op], []
	*     op --known kkk => [op], []
	*     sub --unknown uuu op => [sub], [--unknown uuu op]
	*     sub -- --unknown uuu op => [sub --unknown uuu op], []
	*
	* @param {string[]} args
	* @return {{operands: string[], unknown: string[]}}
	*/
	parseOptions(args) {
		const operands = [];
		const unknown = [];
		let dest = operands;
		function maybeOption(arg) {
			return arg.length > 1 && arg[0] === "-";
		}
		const negativeNumberArg = (arg) => {
			if (!/^-(\d+|\d*\.\d+)(e[+-]?\d+)?$/.test(arg)) return false;
			return !this._getCommandAndAncestors().some((cmd) => cmd.options.map((opt) => opt.short).some((short) => /^-\d$/.test(short)));
		};
		let activeVariadicOption = null;
		let activeGroup = null;
		let i = 0;
		while (i < args.length || activeGroup) {
			const arg = activeGroup ?? args[i++];
			activeGroup = null;
			if (arg === "--") {
				if (dest === unknown) dest.push(arg);
				dest.push(...args.slice(i));
				break;
			}
			if (activeVariadicOption && (!maybeOption(arg) || negativeNumberArg(arg))) {
				this.emit(`option:${activeVariadicOption.name()}`, arg);
				continue;
			}
			activeVariadicOption = null;
			if (maybeOption(arg)) {
				const option = this._findOption(arg);
				if (option) {
					if (option.required) {
						const value = args[i++];
						if (value === void 0) this.optionMissingArgument(option);
						this.emit(`option:${option.name()}`, value);
					} else if (option.optional) {
						let value = null;
						if (i < args.length && (!maybeOption(args[i]) || negativeNumberArg(args[i]))) value = args[i++];
						this.emit(`option:${option.name()}`, value);
					} else this.emit(`option:${option.name()}`);
					activeVariadicOption = option.variadic ? option : null;
					continue;
				}
			}
			if (arg.length > 2 && arg[0] === "-" && arg[1] !== "-") {
				const option = this._findOption(`-${arg[1]}`);
				if (option) {
					if (option.required || option.optional && this._combineFlagAndOptionalValue) this.emit(`option:${option.name()}`, arg.slice(2));
					else {
						this.emit(`option:${option.name()}`);
						activeGroup = `-${arg.slice(2)}`;
					}
					continue;
				}
			}
			if (/^--[^=]+=/.test(arg)) {
				const index = arg.indexOf("=");
				const option = this._findOption(arg.slice(0, index));
				if (option && (option.required || option.optional)) {
					this.emit(`option:${option.name()}`, arg.slice(index + 1));
					continue;
				}
			}
			if (dest === operands && maybeOption(arg) && !(this.commands.length === 0 && negativeNumberArg(arg))) dest = unknown;
			if ((this._enablePositionalOptions || this._passThroughOptions) && operands.length === 0 && unknown.length === 0) {
				if (this._findCommand(arg)) {
					operands.push(arg);
					unknown.push(...args.slice(i));
					break;
				} else if (this._getHelpCommand() && arg === this._getHelpCommand().name()) {
					operands.push(arg, ...args.slice(i));
					break;
				} else if (this._defaultCommandName) {
					unknown.push(arg, ...args.slice(i));
					break;
				}
			}
			if (this._passThroughOptions) {
				dest.push(arg, ...args.slice(i));
				break;
			}
			dest.push(arg);
		}
		return {
			operands,
			unknown
		};
	}
	/**
	* Return an object containing local option values as key-value pairs.
	*
	* @return {object}
	*/
	opts() {
		if (this._storeOptionsAsProperties) {
			const result = {};
			const len = this.options.length;
			for (let i = 0; i < len; i++) {
				const key = this.options[i].attributeName();
				result[key] = key === this._versionOptionName ? this._version : this[key];
			}
			return result;
		}
		return this._optionValues;
	}
	/**
	* Return an object containing merged local and global option values as key-value pairs.
	*
	* @return {object}
	*/
	optsWithGlobals() {
		return this._getCommandAndAncestors().reduce((combinedOptions, cmd) => Object.assign(combinedOptions, cmd.opts()), {});
	}
	/**
	* Display error message and exit (or call exitOverride).
	*
	* @param {string} message
	* @param {object} [errorOptions]
	* @param {string} [errorOptions.code] - an id string representing the error
	* @param {number} [errorOptions.exitCode] - used with process.exit
	*/
	error(message, errorOptions) {
		this._outputConfiguration.outputError(`${message}\n`, this._outputConfiguration.writeErr);
		if (typeof this._showHelpAfterError === "string") this._outputConfiguration.writeErr(`${this._showHelpAfterError}\n`);
		else if (this._showHelpAfterError) {
			this._outputConfiguration.writeErr("\n");
			this.outputHelp({ error: true });
		}
		const config = errorOptions || {};
		const exitCode = config.exitCode || 1;
		const code = config.code || "commander.error";
		this._exit(exitCode, code, message);
	}
	/**
	* Apply any option related environment variables, if option does
	* not have a value from cli or client code.
	*
	* @private
	*/
	_parseOptionsEnv() {
		this.options.forEach((option) => {
			if (option.envVar && option.envVar in process$1.env) {
				const optionKey = option.attributeName();
				if (this.getOptionValue(optionKey) === void 0 || [
					"default",
					"config",
					"env"
				].includes(this.getOptionValueSource(optionKey))) {
					if (option.required || option.optional) this.emit(`optionEnv:${option.name()}`, process$1.env[option.envVar]);
					else this.emit(`optionEnv:${option.name()}`);
				}
			}
		});
	}
	/**
	* Apply any implied option values, if option is undefined or default value.
	*
	* @private
	*/
	_parseOptionsImplied() {
		const dualHelper = new DualOptions(this.options);
		const hasCustomOptionValue = (optionKey) => {
			return this.getOptionValue(optionKey) !== void 0 && !["default", "implied"].includes(this.getOptionValueSource(optionKey));
		};
		this.options.filter((option) => option.implied !== void 0 && hasCustomOptionValue(option.attributeName()) && dualHelper.valueFromOption(this.getOptionValue(option.attributeName()), option)).forEach((option) => {
			Object.keys(option.implied).filter((impliedKey) => !hasCustomOptionValue(impliedKey)).forEach((impliedKey) => {
				this.setOptionValueWithSource(impliedKey, option.implied[impliedKey], "implied");
			});
		});
	}
	/**
	* Argument `name` is missing.
	*
	* @param {string} name
	* @private
	*/
	missingArgument(name) {
		const message = `error: missing required argument '${name}'`;
		this.error(message, { code: "commander.missingArgument" });
	}
	/**
	* `Option` is missing an argument.
	*
	* @param {Option} option
	* @private
	*/
	optionMissingArgument(option) {
		const message = `error: option '${option.flags}' argument missing`;
		this.error(message, { code: "commander.optionMissingArgument" });
	}
	/**
	* `Option` does not have a value, and is a mandatory option.
	*
	* @param {Option} option
	* @private
	*/
	missingMandatoryOptionValue(option) {
		const message = `error: required option '${option.flags}' not specified`;
		this.error(message, { code: "commander.missingMandatoryOptionValue" });
	}
	/**
	* `Option` conflicts with another option.
	*
	* @param {Option} option
	* @param {Option} conflictingOption
	* @private
	*/
	_conflictingOption(option, conflictingOption) {
		const findBestOptionFromValue = (option) => {
			const optionKey = option.attributeName();
			const optionValue = this.getOptionValue(optionKey);
			const negativeOption = this.options.find((target) => target.negate && optionKey === target.attributeName());
			const positiveOption = this.options.find((target) => !target.negate && optionKey === target.attributeName());
			if (negativeOption && (negativeOption.presetArg === void 0 && optionValue === false || negativeOption.presetArg !== void 0 && optionValue === negativeOption.presetArg)) return negativeOption;
			return positiveOption || option;
		};
		const getErrorMessage = (option) => {
			const bestOption = findBestOptionFromValue(option);
			const optionKey = bestOption.attributeName();
			if (this.getOptionValueSource(optionKey) === "env") return `environment variable '${bestOption.envVar}'`;
			return `option '${bestOption.flags}'`;
		};
		const message = `error: ${getErrorMessage(option)} cannot be used with ${getErrorMessage(conflictingOption)}`;
		this.error(message, { code: "commander.conflictingOption" });
	}
	/**
	* Unknown option `flag`.
	*
	* @param {string} flag
	* @private
	*/
	unknownOption(flag) {
		if (this._allowUnknownOption) return;
		let suggestion = "";
		if (flag.startsWith("--") && this._showSuggestionAfterError) {
			let candidateFlags = [];
			let command = this;
			do {
				const moreFlags = command.createHelp().visibleOptions(command).filter((option) => option.long).map((option) => option.long);
				candidateFlags = candidateFlags.concat(moreFlags);
				command = command.parent;
			} while (command && !command._enablePositionalOptions);
			suggestion = suggestSimilar(flag, candidateFlags);
		}
		const message = `error: unknown option '${flag}'${suggestion}`;
		this.error(message, { code: "commander.unknownOption" });
	}
	/**
	* Excess arguments, more than expected.
	*
	* @param {string[]} receivedArgs
	* @private
	*/
	_excessArguments(receivedArgs) {
		if (this._allowExcessArguments) return;
		const expected = this.registeredArguments.length;
		const s = expected === 1 ? "" : "s";
		const received = receivedArgs.length;
		const message = `error: too many arguments${this.parent ? ` for '${this.name()}'` : ""}. Expected ${expected} argument${s} but got ${received}: ${receivedArgs.join(", ")}.`;
		this.error(message, { code: "commander.excessArguments" });
	}
	/**
	* Unknown command.
	*
	* @private
	*/
	unknownCommand() {
		const unknownName = this.args[0];
		let suggestion = "";
		if (this._showSuggestionAfterError) {
			const candidateNames = [];
			this.createHelp().visibleCommands(this).forEach((command) => {
				candidateNames.push(command.name());
				if (command.alias()) candidateNames.push(command.alias());
			});
			suggestion = suggestSimilar(unknownName, candidateNames);
		}
		const message = `error: unknown command '${unknownName}'${suggestion}`;
		this.error(message, { code: "commander.unknownCommand" });
	}
	/**
	* Get or set the program version.
	*
	* This method auto-registers the "-V, --version" option which will print the version number.
	*
	* You can optionally supply the flags and description to override the defaults.
	*
	* @param {string} [str]
	* @param {string} [flags]
	* @param {string} [description]
	* @return {(this | string | undefined)} `this` command for chaining, or version string if no arguments
	*/
	version(str, flags, description) {
		if (str === void 0) return this._version;
		this._version = str;
		flags = flags || "-V, --version";
		description = description || "output the version number";
		const versionOption = this.createOption(flags, description);
		this._versionOptionName = versionOption.attributeName();
		this._registerOption(versionOption);
		this.on("option:" + versionOption.name(), () => {
			this._outputConfiguration.writeOut(`${str}\n`);
			this._exit(0, "commander.version", str);
		});
		return this;
	}
	/**
	* Set the description.
	*
	* @param {string} [str]
	* @param {object} [argsDescription]
	* @return {(string|Command)}
	*/
	description(str, argsDescription) {
		if (str === void 0 && argsDescription === void 0) return this._description;
		this._description = str;
		if (argsDescription) this._argsDescription = argsDescription;
		return this;
	}
	/**
	* Set the summary. Used when listed as subcommand of parent.
	*
	* @param {string} [str]
	* @return {(string|Command)}
	*/
	summary(str) {
		if (str === void 0) return this._summary;
		this._summary = str;
		return this;
	}
	/**
	* Set an alias for the command.
	*
	* You may call more than once to add multiple aliases. Only the first alias is shown in the auto-generated help.
	*
	* @param {string} [alias]
	* @return {(string|Command)}
	*/
	alias(alias) {
		if (alias === void 0) return this._aliases[0];
		/** @type {Command} */
		let command = this;
		if (this.commands.length !== 0 && this.commands[this.commands.length - 1]._executableHandler) command = this.commands[this.commands.length - 1];
		if (alias === command._name) throw new Error("Command alias can't be the same as its name");
		const matchingCommand = this.parent?._findCommand(alias);
		if (matchingCommand) {
			const existingCmd = [matchingCommand.name()].concat(matchingCommand.aliases()).join("|");
			throw new Error(`cannot add alias '${alias}' to command '${this.name()}' as already have command '${existingCmd}'`);
		}
		command._aliases.push(alias);
		return this;
	}
	/**
	* Set aliases for the command.
	*
	* Only the first alias is shown in the auto-generated help.
	*
	* @param {string[]} [aliases]
	* @return {(string[]|Command)}
	*/
	aliases(aliases) {
		if (aliases === void 0) return this._aliases;
		aliases.forEach((alias) => this.alias(alias));
		return this;
	}
	/**
	* Set / get the command usage `str`.
	*
	* @param {string} [str]
	* @return {(string|Command)}
	*/
	usage(str) {
		if (str === void 0) {
			if (this._usage) return this._usage;
			const args = this.registeredArguments.map((arg) => {
				return humanReadableArgName(arg);
			});
			return [].concat(this.options.length || this._helpOption !== null ? "[options]" : [], this.commands.length ? "[command]" : [], this.registeredArguments.length ? args : []).join(" ");
		}
		this._usage = str;
		return this;
	}
	/**
	* Get or set the name of the command.
	*
	* @param {string} [str]
	* @return {(string|Command)}
	*/
	name(str) {
		if (str === void 0) return this._name;
		this._name = str;
		return this;
	}
	/**
	* Set/get the help group heading for this subcommand in parent command's help.
	*
	* @param {string} [heading]
	* @return {Command | string}
	*/
	helpGroup(heading) {
		if (heading === void 0) return this._helpGroupHeading ?? "";
		this._helpGroupHeading = heading;
		return this;
	}
	/**
	* Set/get the default help group heading for subcommands added to this command.
	* (This does not override a group set directly on the subcommand using .helpGroup().)
	*
	* @example
	* program.commandsGroup('Development Commands:);
	* program.command('watch')...
	* program.command('lint')...
	* ...
	*
	* @param {string} [heading]
	* @returns {Command | string}
	*/
	commandsGroup(heading) {
		if (heading === void 0) return this._defaultCommandGroup ?? "";
		this._defaultCommandGroup = heading;
		return this;
	}
	/**
	* Set/get the default help group heading for options added to this command.
	* (This does not override a group set directly on the option using .helpGroup().)
	*
	* @example
	* program
	*   .optionsGroup('Development Options:')
	*   .option('-d, --debug', 'output extra debugging')
	*   .option('-p, --profile', 'output profiling information')
	*
	* @param {string} [heading]
	* @returns {Command | string}
	*/
	optionsGroup(heading) {
		if (heading === void 0) return this._defaultOptionGroup ?? "";
		this._defaultOptionGroup = heading;
		return this;
	}
	/**
	* @param {Option} option
	* @private
	*/
	_initOptionGroup(option) {
		if (this._defaultOptionGroup && !option.helpGroupHeading) option.helpGroup(this._defaultOptionGroup);
	}
	/**
	* @param {Command} cmd
	* @private
	*/
	_initCommandGroup(cmd) {
		if (this._defaultCommandGroup && !cmd.helpGroup()) cmd.helpGroup(this._defaultCommandGroup);
	}
	/**
	* Set the name of the command from script filename, such as process.argv[1],
	* or import.meta.filename.
	*
	* (Used internally and public although not documented in README.)
	*
	* @example
	* program.nameFromFilename(import.meta.filename);
	*
	* @param {string} filename
	* @return {Command}
	*/
	nameFromFilename(filename) {
		this._name = path.basename(filename, path.extname(filename));
		return this;
	}
	/**
	* Get or set the directory for searching for executable subcommands of this command.
	*
	* @example
	* program.executableDir(import.meta.dirname);
	* // or
	* program.executableDir('subcommands');
	*
	* @param {string} [path]
	* @return {(string|null|Command)}
	*/
	executableDir(path) {
		if (path === void 0) return this._executableDir;
		this._executableDir = path;
		return this;
	}
	/**
	* Return program help documentation.
	*
	* @param {{ error: boolean }} [contextOptions] - pass {error:true} to wrap for stderr instead of stdout
	* @return {string}
	*/
	helpInformation(contextOptions) {
		const helper = this.createHelp();
		const context = this._getOutputContext(contextOptions);
		helper.prepareContext({
			error: context.error,
			helpWidth: context.helpWidth,
			outputHasColors: context.hasColors
		});
		const text = helper.formatHelp(this, helper);
		if (context.hasColors) return text;
		return this._outputConfiguration.stripColor(text);
	}
	/**
	* @typedef HelpContext
	* @type {object}
	* @property {boolean} error
	* @property {number} helpWidth
	* @property {boolean} hasColors
	* @property {function} write - includes stripColor if needed
	*
	* @returns {HelpContext}
	* @private
	*/
	_getOutputContext(contextOptions) {
		contextOptions = contextOptions || {};
		const error = !!contextOptions.error;
		let baseWrite;
		let hasColors;
		let helpWidth;
		if (error) {
			baseWrite = (str) => this._outputConfiguration.writeErr(str);
			hasColors = this._outputConfiguration.getErrHasColors();
			helpWidth = this._outputConfiguration.getErrHelpWidth();
		} else {
			baseWrite = (str) => this._outputConfiguration.writeOut(str);
			hasColors = this._outputConfiguration.getOutHasColors();
			helpWidth = this._outputConfiguration.getOutHelpWidth();
		}
		const write = (str) => {
			if (!hasColors) str = this._outputConfiguration.stripColor(str);
			return baseWrite(str);
		};
		return {
			error,
			write,
			hasColors,
			helpWidth
		};
	}
	/**
	* Output help information for this command.
	*
	* Outputs built-in help, and custom text added using `.addHelpText()`.
	*
	* @param {{ error: boolean } | Function} [contextOptions] - pass {error:true} to write to stderr instead of stdout
	*/
	outputHelp(contextOptions) {
		let deprecatedCallback;
		if (typeof contextOptions === "function") {
			deprecatedCallback = contextOptions;
			contextOptions = void 0;
		}
		const outputContext = this._getOutputContext(contextOptions);
		/** @type {HelpTextEventContext} */
		const eventContext = {
			error: outputContext.error,
			write: outputContext.write,
			command: this
		};
		this._getCommandAndAncestors().reverse().forEach((command) => command.emit("beforeAllHelp", eventContext));
		this.emit("beforeHelp", eventContext);
		let helpInformation = this.helpInformation({ error: outputContext.error });
		if (deprecatedCallback) {
			helpInformation = deprecatedCallback(helpInformation);
			if (typeof helpInformation !== "string" && !Buffer.isBuffer(helpInformation)) throw new Error("outputHelp callback must return a string or a Buffer");
		}
		outputContext.write(helpInformation);
		if (this._getHelpOption()?.long) this.emit(this._getHelpOption().long);
		this.emit("afterHelp", eventContext);
		this._getCommandAndAncestors().forEach((command) => command.emit("afterAllHelp", eventContext));
	}
	/**
	* You can pass in flags and a description to customise the built-in help option.
	* Pass in false to disable the built-in help option.
	*
	* @example
	* program.helpOption('-?, --help' 'show help'); // customise
	* program.helpOption(false); // disable
	*
	* @param {(string | boolean)} flags
	* @param {string} [description]
	* @return {Command} `this` command for chaining
	*/
	helpOption(flags, description) {
		if (typeof flags === "boolean") {
			if (flags) {
				if (this._helpOption === null) this._helpOption = void 0;
				if (this._defaultOptionGroup) this._initOptionGroup(this._getHelpOption());
			} else this._helpOption = null;
			return this;
		}
		this._helpOption = this.createOption(flags ?? "-h, --help", description ?? "display help for command");
		if (flags || description) this._initOptionGroup(this._helpOption);
		return this;
	}
	/**
	* Lazy create help option.
	* Returns null if has been disabled with .helpOption(false).
	*
	* @returns {(Option | null)} the help option
	* @package
	*/
	_getHelpOption() {
		if (this._helpOption === void 0) this.helpOption(void 0, void 0);
		return this._helpOption;
	}
	/**
	* Supply your own option to use for the built-in help option.
	* This is an alternative to using helpOption() to customise the flags and description etc.
	*
	* @param {Option} option
	* @return {Command} `this` command for chaining
	*/
	addHelpOption(option) {
		this._helpOption = option;
		this._initOptionGroup(option);
		return this;
	}
	/**
	* Output help information and exit.
	*
	* Outputs built-in help, and custom text added using `.addHelpText()`.
	*
	* @param {{ error: boolean }} [contextOptions] - pass {error:true} to write to stderr instead of stdout
	*/
	help(contextOptions) {
		this.outputHelp(contextOptions);
		let exitCode = Number(process$1.exitCode ?? 0);
		if (exitCode === 0 && contextOptions && typeof contextOptions !== "function" && contextOptions.error) exitCode = 1;
		this._exit(exitCode, "commander.help", "(outputHelp)");
	}
	/**
	* // Do a little typing to coordinate emit and listener for the help text events.
	* @typedef HelpTextEventContext
	* @type {object}
	* @property {boolean} error
	* @property {Command} command
	* @property {function} write
	*/
	/**
	* Add additional text to be displayed with the built-in help.
	*
	* Position is 'before' or 'after' to affect just this command,
	* and 'beforeAll' or 'afterAll' to affect this command and all its subcommands.
	*
	* @param {string} position - before or after built-in help
	* @param {(string | Function)} text - string to add, or a function returning a string
	* @return {Command} `this` command for chaining
	*/
	addHelpText(position, text) {
		const allowedValues = [
			"beforeAll",
			"before",
			"after",
			"afterAll"
		];
		if (!allowedValues.includes(position)) throw new Error(`Unexpected value for position to addHelpText.
Expecting one of '${allowedValues.join("', '")}'`);
		const helpEvent = `${position}Help`;
		this.on(helpEvent, (context) => {
			let helpStr;
			if (typeof text === "function") helpStr = text({
				error: context.error,
				command: context.command
			});
			else helpStr = text;
			if (helpStr) context.write(`${helpStr}\n`);
		});
		return this;
	}
	/**
	* Output help information if help flags specified
	*
	* @param {Array} args - array of options to search for help flags
	* @private
	*/
	_outputHelpIfRequested(args) {
		const helpOption = this._getHelpOption();
		if (helpOption && args.find((arg) => helpOption.is(arg))) {
			this.outputHelp();
			this._exit(0, "commander.helpDisplayed", "(outputHelp)");
		}
	}
};
/**
* Scan arguments and increment port number for inspect calls (to avoid conflicts when spawning new command).
*
* @param {string[]} args - array of arguments from node.execArgv
* @returns {string[]}
* @private
*/
function incrementNodeInspectorPort(args) {
	return args.map((arg) => {
		if (!arg.startsWith("--inspect")) return arg;
		let debugOption;
		let debugHost = "127.0.0.1";
		let debugPort = "9229";
		let match;
		if ((match = arg.match(/^(--inspect(-brk)?)$/)) !== null) debugOption = match[1];
		else if ((match = arg.match(/^(--inspect(-brk|-port)?)=([^:]+)$/)) !== null) {
			debugOption = match[1];
			if (/^\d+$/.test(match[3])) debugPort = match[3];
			else debugHost = match[3];
		} else if ((match = arg.match(/^(--inspect(-brk|-port)?)=([^:]+):(\d+)$/)) !== null) {
			debugOption = match[1];
			debugHost = match[3];
			debugPort = match[4];
		}
		if (debugOption && debugPort !== "0") return `${debugOption}=${debugHost}:${parseInt(debugPort) + 1}`;
		return arg;
	});
}
/**
* Exported for using from tests, not otherwise used outside this file.
*
* @returns {boolean | undefined}
* @package
*/
function useColor() {
	if (process$1.env.NO_COLOR || process$1.env.FORCE_COLOR === "0" || process$1.env.FORCE_COLOR === "false") return false;
	if (process$1.env.FORCE_COLOR || process$1.env.CLICOLOR_FORCE !== void 0) return true;
}
new Command();
//#endregion
//#region src/operations/oauth-listen.ts
/**
* The detached half of a two-step sign-in: it holds the loopback port open while the person works through Google's
* consent screens, and writes what comes back into the flow's outcome file for `--finish` to collect.
*
* It is started by `startSignIn` and is not meant to be run by hand, so its command is hidden from `--help`.
*/
async function runOauthListener(context, flowId) {
	const flow = await context.flows.get(flowId);
	const port = Number(context.env.AGENT_COMMS_LOOPBACK_PORT ?? "") || void 0;
	const listener = await startLoopback({
		state: flow.state,
		port,
		timeoutMs: Math.max(1e3, Date.parse(flow.expiresAt) - context.now().getTime()),
		about: aboutFlow(flow)
	});
	await context.flows.patch(flowId, {
		redirectUri: listener.redirectUri,
		port: listener.port,
		listenerPid: process.pid
	});
	process.send?.({
		type: "ready",
		port: listener.port
	});
	process.disconnect?.();
	const result = await listener.result;
	await listener.close();
	if ("code" in result) await context.flows.recordOutcome(flowId, { code: result.code });
	else if ("error" in result) await context.flows.recordOutcome(flowId, {
		error: result.error,
		description: result.description
	});
}
//#endregion
//#region src/cli/browser.ts
/**
* Opens the consent link in the user's browser. Best effort by design: if it fails, the link has already been
* printed, and a sign-in that cannot start a browser is not a failed sign-in — it is a link the user opens by hand.
*
* Never used for the agent-driven flow, where the link is returned for the agent to show and nothing local opens.
*
* The program that opens it is named by its full path, never looked up by a bare name. On Windows the lookup starts in
* the current folder, and a download may have saved a stranger's program there: it would be what ran. So it is the
* `rundll32.exe` under the Windows folder, started with `NoDefaultCurrentDirectoryInExePath`, handing the link to
* `url.dll`'s `FileProtocolHandler` — which opens it as a double-click would, and which no shell stands in front of.
* `cmd.exe /c start` did, and read the link as a command line: every `&` in it ended the command there, so the browser
* got the link cut short and what followed was run as a command of its own. `/usr/bin/open` on macOS; and elsewhere the
* `xdg-open` in the first absolute directory of `PATH` that holds one. When there is none, nothing is started and the
* link is left for the user to open.
*/
function openInBrowser(url, platform = process.platform, deps = {}) {
	const env = deps.env ?? process.env;
	const command = browserOpener(platform, env);
	if (command === null) return false;
	const args = platform === "win32" ? ["url.dll,FileProtocolHandler", url] : [url];
	try {
		const child = (deps.spawn ?? spawn)(command, args, {
			stdio: "ignore",
			detached: true,
			env: childEnvironment(env, platform)
		});
		child.on("error", () => void 0);
		child.unref();
		return true;
	} catch {
		return false;
	}
}
/** The opener's full path, or null when there is none that can be named without looking in the current folder. */
function browserOpener(platform, env) {
	if (platform === "win32") return windowsSystemProgram("rundll32.exe", env);
	if (platform === "darwin") return "/usr/bin/open";
	for (const directory of absoluteSearchPath((env.PATH ?? "").split(delimiter), platform)) {
		const candidate = join(directory, "xdg-open");
		try {
			accessSync(candidate, constants.X_OK);
			return candidate;
		} catch {}
	}
	return null;
}
//#endregion
//#region src/cli/program.ts
/**
* The `agent-gmail` command. Both a person and an agent run it, so every command prints a readable summary by default
* and the full result under `--json`, with the same exit codes either way (documented in `--help`).
*/
async function run(argv, deps = {}) {
	const streams = deps.streams ?? {
		stdout: process.stdout,
		stderr: process.stderr,
		stdin: process.stdin
	};
	const env = deps.env ?? process.env;
	const platform = deps.platform ?? process.platform;
	const program = new Command();
	let exitCode = 0;
	let ran = false;
	program.name("agent-gmail").description("Gmail for coding agents: read, search, draft and organise across inboxes — sending needs approval.").version(VERSION, "-v, --version").option("--json", "print the result as {\"ok\":true,\"schemaVersion\":1,\"data\":…}", false).option("--no-color", "never colour the output").option("--no-input", "never prompt, even on a terminal").configureOutput({
		writeOut: (text) => streams.stdout.write(text),
		writeErr: (text) => streams.stderr.write(text)
	}).addHelpText("after", `
Exit codes: 0 ok · 1 unexpected · 10 send refused or approval required · 11 an update is out:
update first, or put it off (agentcomms update, agentcomms update --later) · 64 usage ·
65 bad data · 66 not found · 69 provider or secret store unavailable · 75 temporary
(retry later) · 77 sign-in or permission needed · 78 configuration problem.`).exitOverride();
	const globals = () => {
		const options = program.opts();
		return {
			json: Boolean(options.json),
			color: colorEnabled(env, streams.stdout, options.color),
			noInput: options.input === false
		};
	};
	const output = () => ({
		json: globals().json,
		color: globals().color,
		platform
	});
	/** Wraps a command body so every failure becomes the documented envelope and exit code. */
	/**
	* A command that succeeded but wants a non-zero exit code — `doctor` finding something broken, where the findings
	* *are* the output and the envelope must still be the normal one. Throwing instead would print a second envelope
	* after the first, and `--json` promises exactly one document on stdout.
	*/
	let softExit = null;
	let gated = null;
	program.hook("preAction", async (_program, command) => {
		const path = commandPathOf(command);
		if (exemptFromUpdateGate(path, ["oauth-listen", "update-check-child"])) return;
		const core = openCore({ env });
		let ended = null;
		const code = await runCommand(output(), async () => {
			ended = await updateGateAtTerminal({
				core,
				env,
				binary: "agent-gmail",
				channel: "gmail",
				running: VERSION,
				output: output(),
				noInput: globals().noInput,
				streams,
				approveCommand: "agent-gmail approve",
				approvals: approvalsOf(command),
				approvalClaim: path.join(" ") === "attachments download" ? DOWNLOAD_CLAIM : void 0,
				...terminalUpdateHooks(core, env, {
					output: output(),
					streams,
					approveCommand: "agent-gmail approve"
				})
			});
		}, streams);
		gated = code !== 0 ? code : ended;
	});
	const act = (body) => async (...args) => {
		ran = true;
		softExit = null;
		if (gated !== null) {
			exitCode = gated;
			return;
		}
		const context = new GmailContext({
			...deps,
			env,
			surface: "cli"
		});
		exitCode = await runCommand(output(), () => body(context, globals(), ...args), streams);
		if (exitCode === 0 && softExit !== null) exitCode = softExit;
	};
	/**
	* The body of a message, from `--text`, from `--file`, or from standard input.
	*
	* Standard input matters more than it looks: a body is prose with newlines and quotes in it, and an agent that has
	* to fit one into a shell argument will mangle it. Piping it in is the way that always works.
	*
	* `--file -` asks for standard input by name. A new draft or a reply also reads it when nothing else is given,
	* because it cannot exist without a body. An update never does: there, no body means "keep the one it has" — what
	* `gmail_draft_update` does when `text` is left out — and guessing from standard input is what broke it. An agent's
	* shell hands a command standard input that has already ended, which read as an empty body and was refused; or a
	* pipe nobody closes, which was read until the end that never came. Only an explicit `--file -` reads it now.
	*/
	const bodyText = async (options, behaviour = {}) => {
		if (typeof options.text === "string") return options.text;
		if (options.file === "-") return pipedBody();
		if (typeof options.file === "string") {
			const { readSmallFile } = await import("./small-file-BNvPUCv_.mjs");
			const { MAX_MESSAGE_BYTES } = await import("./compose-DbQkKXBu.mjs");
			const path = String(options.file);
			const content = await readSmallFile(path, {
				follow: true,
				maxBytes: MAX_MESSAGE_BYTES
			});
			if (!content.ok) throw new CommsError(content.problem === "missing" ? "NOT_FOUND" : "USAGE", content.problem === "too-large" ? `${path} is larger than a message can be` : `cannot read ${path}`, { hint: "Pass a regular file holding the message body, or use --text." });
			return content.text;
		}
		if (behaviour.bodyOptional) return void 0;
		if (streams.stdin.isTTY) throw new CommsError("USAGE", "no message body", { hint: "Pass --text \"…\", or --file <path>, or pipe the body in on standard input." });
		return pipedBody();
	};
	/** Standard input, read to its end as a message body. */
	const pipedBody = async () => {
		const stdin = streams.stdin;
		const { readBoundedStream } = await import("./small-file-BNvPUCv_.mjs");
		const { MAX_MESSAGE_BYTES } = await import("./compose-DbQkKXBu.mjs");
		const piped = await readBoundedStream(stdin, MAX_MESSAGE_BYTES);
		if (!piped.ok) throw new CommsError("USAGE", piped.problem === "too-large" ? "the piped message body is larger than a message can be" : "the piped message body could not be read to the end", { hint: piped.problem === "too-large" ? "A Gmail message tops out at 35MB including attachments." : "Whatever was piping the body stopped before it finished. Pass --text or --file instead." });
		const text = piped.text;
		if (!text.trim()) throw new CommsError("USAGE", "the message body was empty", { hint: "Pass --text \"…\", or --file <path>, or pipe the body in on standard input." });
		return text;
	};
	/**
	* An `--expect-*` list as the caller meant it. `none` is the explicit empty list.
	*
	* Explicit, because an omitted flag and an empty one look the same on a command line, and the difference here is
	* "I know there are no Bcc recipients" versus "I did not think about Bcc" — which is the difference between a
	* check and a formality.
	*/
	const expected = (value) => {
		const list = (Array.isArray(value) ? value : value === void 0 ? [] : [value]).map(String);
		return list.length === 1 && list[0] === "none" ? [] : list;
	};
	/** The options every draft command shares, so `draft new` and `draft reply` take the same flags. */
	const withDraftOptions = (command) => command.option("--text <text>", "the body, as plain text (the HTML part is generated from it)").option("--file <path>", "read the body from a file; `-` reads standard input").option("--cc <address...>", "copy these people").option("--bcc <address...>", "blind-copy these people").option("--attach <path...>", "attach these local files").option("--no-signature", "leave the mailbox signature off").option("--no-quote", "do not quote the original (a reply only; a forward needs it)").option("--profile", "include the mailbox writing profile in the result", false);
	const draftInput = async (options, behaviour = {}) => ({
		to: options.to,
		cc: options.cc,
		bcc: options.bcc,
		subject: options.subject === void 0 ? void 0 : String(options.subject),
		text: await bodyText(options, behaviour),
		attach: options.attach,
		signature: options.signature !== false,
		includeProfile: Boolean(options.profile)
	});
	/**
	* This command as it was typed, without an `--approval` it already carried: what to run again once a change it
	* prepared has been approved.
	*
	* From the arguments themselves rather than rebuilt per command, so every flag the person or agent gave is in it
	* — `--rename`, `--dir`, `--revoke` — and running it again prepares nothing new: it claims the approval for the
	* same change. `setup` leaves out its `--mcp-approval` too, the second approval it can carry.
	*/
	const again = (approvalFlags = ["--approval"]) => {
		const kept = [];
		for (let index = 0; index < argv.length; index++) {
			const arg = argv[index] ?? "";
			if (approvalFlags.includes(arg)) {
				index++;
				continue;
			}
			if (approvalFlags.some((flag) => arg.startsWith(`${flag}=`))) continue;
			kept.push(arg);
		}
		return shellCommand(["agent-gmail", ...kept], platform);
	};
	/**
	* A command that changes an account, asked the way every surface asks: through core's one flow.
	*
	* With `--approval <id>` it claims that approval and applies the change. Without one, a change that loosens nothing
	* is applied at once; one that does is prepared, and a person at this terminal approves it there — a yes under the
	* `chat` change policy, the code under `confirm` — while an agent, or anything without a terminal, gets the preview
	* and the approval id and exits 10. `gmail_*` tools call the same flow with the same change, so the two surfaces
	* cannot ask differently.
	*/
	const changed = (context, globalOptions, change, approvalId) => gatedChangeAtTerminal(context.core, change, {
		approvalId: typeof approvalId === "string" ? approvalId : void 0,
		env,
		output: {
			json: globalOptions.json || globalOptions.noInput,
			color: globalOptions.color,
			platform
		},
		command: again(),
		approveCommand: "agent-gmail approve",
		streams
	});
	/**
	* The agent connection as a change: the one `mcp install` and `comms_server_install` make, for this package's own
	* server, with what `setup` has always registered — the default name, pinned to nothing. `setup --mcp-client` makes
	* it, and so does `inbox add --finish` for a sign-in `setup` handed off with that flag: one change, written once, so
	* an approval any of them prepared is claimed by the others, `mcp install --approval` among them.
	*/
	const setupRegistration = async (context, request) => {
		const { GMAIL_MCP } = await import("./install-CIM-46In.mjs");
		return serverInstallChange(context.core, env, {
			channel: "gmail",
			client: request.client,
			force: request.force === true,
			...request.launcher ? { launcher: request.launcher } : {},
			...request.inbox ? { inbox: request.inbox } : {}
		}, GMAIL_MCP);
	};
	/**
	* The pin a registration for `inbox` takes: that mailbox, when the entry of ours in its place serves another
	* (`mailboxServedElsewhere`), so a replacement serves the mailbox just connected rather than keeping the other's
	* pin, and a refusal names a second entry for it; otherwise none, as `setup` has always registered.
	*/
	const pinFor = async (client, inbox) => {
		const { mailboxServedElsewhere } = await import("./install-CIM-46In.mjs");
		return await mailboxServedElsewhere(env, {
			client,
			inbox
		}) === null ? void 0 : inbox;
	};
	/**
	* Takes up the registration a finished sign-in carried from `setup --mcp-client`: see `OAuthFlow.registerWith`.
	*
	* The mailbox is connected by the time this runs, and nothing here may say otherwise — what happens to the
	* registration is reported beside it, never in its place. A client whose entry of ours already serves this mailbox
	* is left alone (`clientServesInbox`), unless `setup` was given `--replace-server`, which asked for exactly that
	* entry to be replaced. Otherwise it is `setup`'s own registration step, through the same change: a person at this
	* terminal reads the preview and approves it there and then; an agent, or anything without a terminal, gets the
	* preview, the approval id and the `mcp install` command that claims it — the same change, so the claim succeeds —
	* and the command exits 10, as `setup` does when it stops at this step, so a script reading only the status does
	* not take a registration nobody approved for one that happened. One the change refuses — somebody else's server
	* under that name, or ours without `--replace-server` — is `not-registered`, with the refusal's reason.
	*/
	const registerForFinish = async (context, globalOptions, intent, connected) => {
		const { client } = intent;
		const replace = intent.replace === true;
		if (!replace) {
			const { clientServesInbox } = await import("./install-CIM-46In.mjs");
			if (await clientServesInbox(env, {
				client,
				inbox: connected.alias
			})) return {
				client,
				status: "already-registered"
			};
		}
		const pin = await pinFor(client, connected.alias);
		const install = shellCommand([
			"agent-gmail",
			"mcp",
			"install",
			"--client",
			client,
			...intent.launcher ? ["--launcher", intent.launcher] : [],
			...pin ? ["--inbox", pin] : [],
			...replace ? ["--force"] : []
		], platform);
		const person = agentMarker(env) === null && canPrompt(env, streams, {
			json: globalOptions.json,
			noInput: globalOptions.noInput
		});
		try {
			const change = await setupRegistration(context, {
				client,
				...intent.launcher ? { launcher: intent.launcher } : {},
				force: replace,
				...pin ? { inbox: pin } : {}
			});
			let result;
			if (person) {
				streams.stderr.write(`Connected ${connected.inbox.email} as "${connected.alias}". Setup also asked to register the Gmail server with ${client}.\n\n`);
				result = await gatedChangeAtTerminal(context.core, change, {
					env,
					output: {
						json: globalOptions.json || globalOptions.noInput,
						color: globalOptions.color,
						platform
					},
					command: install,
					approveCommand: "agent-gmail approve",
					streams
				});
			} else {
				const outcome = await gatedChange(context.core, change, {
					surface: "cli",
					approveCommand: "agent-gmail approve",
					platform
				});
				if (outcome.status === "approval-required") {
					const { prepared } = outcome;
					const claimCommand = withWords(install, "--approval", prepared.approvalId);
					const claim = commandText(claimCommand);
					softExit = EXIT_CODES.APPROVAL;
					return {
						client,
						status: "approval-required",
						approvalId: prepared.approvalId,
						policy: prepared.policy,
						summary: prepared.summary,
						preview: prepared.preview,
						expiresAt: prepared.expiresAt,
						claim,
						hint: approvalHint(prepared, claimCommand, "agent-gmail approve")
					};
				}
				result = outcome.result;
			}
			const status = installExitStatus(result);
			if (status !== EXIT_CODES.OK) softExit = status;
			return result.applied ? {
				client,
				status: "registered",
				install: result
			} : {
				client,
				status: "not-registered",
				reason: result.notApplied ?? "nothing was written",
				install: result
			};
		} catch (error) {
			const failure = toCommsError(error);
			softExit = failure.exitCode;
			return {
				client,
				status: "not-registered",
				reason: failure.message,
				hint: failure.hint
			};
		}
	};
	const client = program.command("client").description("the Google Cloud OAuth client every inbox signs in through");
	client.command("add <path>").description("register a Desktop OAuth client JSON downloaded from Google Cloud (needs a change approval)").option("--name <name>", "register it under this name", "default").addOption(new Option("--store <store>", "where secrets are kept (first time only)").choices([...STORE_KINDS])).option("--move", "delete the downloaded file once the secret is stored", false).option("--replace", "rotate the secret of the client already registered under this name", false).option("--no-probe", "do not check the credentials with Google first").option("--approval <id>", "apply the change this approval was given for").action(act(async (context, globalOptions, path, options) => {
		const change = clientAddChange(context, {
			path,
			name: String(options.name ?? "default"),
			store: options.store === void 0 ? void 0 : String(options.store),
			move: Boolean(options.move),
			replace: Boolean(options.replace),
			noProbe: options.probe === false
		});
		const result = await changed(context, globalOptions, change, options.approval);
		writeResult(result, output(), (data) => renderClientAdd(data, globalOptions.color), streams);
	}));
	client.command("list").description("list the registered OAuth clients").action(act(async (context, globalOptions) => {
		writeResult(await clientList(context), output(), (data) => renderClients(data, globalOptions.color), streams);
	}));
	client.command("remove <name>").description("forget an OAuth client and delete its secret (needs a change approval)").option("--approval <id>", "apply the change this approval was given for").action(act(async (context, globalOptions, name, options) => {
		writeResult(await changed(context, globalOptions, clientRemoveChange(context, name), options.approval), output(), (data) => `Removed the OAuth client "${data.name}".`, streams);
	}));
	const inbox = program.command("inbox").description("connect, inspect and disconnect mailboxes");
	const withSignInOptions = (command) => command.option("--email <address>", "the address this must turn out to be; refused if it is not").addOption(new Option("--tier <tier>", "how much access to ask for").choices([...TIERS])).option("--no-contacts", "do not ask for contacts access", void 0).option("--contacts", "ask for contacts access (the default)").option("--client <name>", "sign in through this OAuth client").option("--port <number>", "use this loopback port for the redirect: 1 to 65535, or 0 for any free one").option("--no-browser", "do not open the link, just print it").option("--hd <domain>", "restrict the account chooser to a Google Workspace domain").option("--start", "start the sign-in and return the link, to be finished later", false).option("--finish <flowId>", "finish a sign-in started earlier").option("--url <url>", "the address the browser ended up at, pasted back").option("--wait <seconds>", `with --finish, how long to wait for the browser: 0 to ${MAX_WAIT_SECONDS} seconds`, String(60));
	const signIn = async (context, globalOptions, mode, alias, options) => {
		const waitSeconds = checkedWait(options.wait, context.surface);
		const port = checkedPort(options.port, context.surface);
		if (options.finish) {
			refuseUnclaimedApproval(options.approval, {
				message: "--finish collects a sign-in already started, so it takes no --approval",
				hint: "An approval is claimed where the sign-in starts, and finishing it needs none: run the same command again without --approval."
			});
			const result = await finishSignIn(context, {
				flowId: String(options.finish),
				onlyMode: mode,
				onlyAlias: alias,
				url: options.url ? String(options.url) : void 0,
				waitSeconds
			});
			if (mode === "add" && result.registerWith) {
				const { registerWith, ...connected } = result;
				const registration = await registerForFinish(context, globalOptions, registerWith, connected);
				writeResult({
					...connected,
					registration
				}, output(), (data) => renderSignedIn(data, globalOptions.color, context.platform), streams);
				return;
			}
			writeResult(result, output(), (data) => renderSignedIn(data, globalOptions.color, context.platform), streams);
			return;
		}
		if (!alias) {
			const example = (await context.config()).version === 2 ? "acme/gmail" : "work";
			throw new CommsError("USAGE", "name the inbox", { hint: `For example: ${inlineCommand(shellCommand([
				"agent-gmail",
				"inbox",
				mode,
				example,
				"--start"
			], context.platform))}.` });
		}
		const interactive = !options.start && canPrompt(env, streams, {
			json: globalOptions.json,
			noInput: globalOptions.noInput
		});
		const signInOptions = {
			alias,
			tier: options.tier ? String(options.tier) : void 0,
			contacts: options.contacts === void 0 ? void 0 : options.contacts !== false,
			client: options.client ? String(options.client) : void 0,
			email: options.email ? String(options.email) : void 0,
			hostedDomain: options.hd ? String(options.hd) : void 0,
			port,
			detached: !interactive,
			listenerCommand: deps.listenerCommand
		};
		const started = mode === "reauth" ? await changed(context, globalOptions, inboxReauthChange(context, signInOptions), options.approval) : await startSignIn(context, {
			...signInOptions,
			mode
		});
		if (!interactive || !started.listener) {
			writeResult(started, output(), (data) => renderSignInStarted(data, mode, globalOptions.color, context.platform), streams);
			return;
		}
		streams.stderr.write(`${renderSignInStarted(started, mode, globalOptions.color, context.platform)}\n`);
		if (options.browser !== false) openInBrowser(started.authUrl);
		const result = await started.listener.result;
		writeResult(result, output(), (data) => renderSignedIn(data, globalOptions.color, context.platform), streams);
	};
	withSignInOptions(inbox.command("add [alias]").description("connect a mailbox (opens Google in a browser)")).action(act(async (context, globalOptions, alias, options) => {
		await signIn(context, globalOptions, "add", alias, options);
	}));
	withSignInOptions(inbox.command("reauth [alias]").description("sign in again: renew the grant, or change how much access it has (more needs a change approval)")).option("--approval <id>", "start the sign-in this approval was given for").action(act(async (context, globalOptions, alias, options) => {
		await signIn(context, globalOptions, "reauth", alias, options);
	}));
	inbox.command("list").description("list the connected mailboxes").action(act(async (context, globalOptions) => {
		writeResult(await inboxList(context), output(), (data) => renderInboxList(data, globalOptions.color), streams);
	}));
	inbox.command("show <alias>").description("everything known about one mailbox").action(act(async (context, globalOptions, alias) => {
		writeResult(await inboxShow(context, alias), output(), (data) => renderInboxShow(data, globalOptions.color), streams);
	}));
	inbox.command("rename <from> <to>").description("change the name an inbox is known by").action(act(async (context, _globalOptions, from, to) => {
		writeResult(await inboxRename(context, from, to), output(), (data) => `Renamed "${data.from}" to "${data.to}".`, streams);
	}));
	inbox.command("policy <alias>").description("how sending from this inbox, and loosening its settings, must be approved (looser needs approval)").option("--send <policy>", "how a send is approved: chat | confirm | never").option("--change <policy>", "how a loosening of its settings is approved: chat | confirm").option("--approval <id>", "apply the change this approval was given for").action(act(async (context, globalOptions, alias, options) => {
		const change = inboxPolicyChange(context, alias, {
			sendPolicy: options.send === void 0 ? void 0 : String(options.send),
			changePolicy: options.change === void 0 ? void 0 : String(options.change)
		});
		writeResult(await changed(context, globalOptions, change, options.approval), output(), (data) => [...options.send === void 0 ? [] : [`Sending from "${data.alias}" now needs: ${data.sendPolicy} (was ${data.previous}).`], ...options.change === void 0 ? [] : [`Loosening "${data.alias}" now needs: ${data.changePolicy} (was ${data.previousChangePolicy}).`]].join("\n"), streams);
	}));
	inbox.command("import [source]").description("copy the mailboxes set up in another Gmail MCP server (default: @artymclabin/gmail-mcp; needs a change approval)").option("--dir <path>", "where that server keeps its files", "~/.gmail-mcp").option("--name <name>", "register its OAuth client under this name", "imported").addOption(new Option("--store <store>", "where secrets are kept (first time only)").choices([...STORE_KINDS])).option("--dry-run", "say what would be imported, and change nothing", false).option("--rename <old=new>", "import one under another name (repeatable)", (value, previous = []) => [...previous, value]).option("--approval <id>", "apply the import this approval was given for").action(act(async (context, globalOptions, source, options) => {
		if (source && source !== "artymclabin") throw new CommsError("USAGE", `"${source}" is not a source this can import from`, { hint: "Only `artymclabin` (and the servers sharing its file layout) is supported: `agent-gmail inbox import`." });
		const change = inboxImportChange(context, {
			dir: options.dir ? String(options.dir) : void 0,
			clientName: options.name ? String(options.name) : void 0,
			store: options.store === void 0 ? void 0 : String(options.store),
			dryRun: Boolean(options.dryRun),
			renames: Array.isArray(options.rename) ? options.rename.map(String) : []
		});
		const result = await changed(context, globalOptions, change, options.approval);
		writeResult(result, output(), (data) => renderImport(data, globalOptions.color), streams);
	}));
	inbox.command("remove <alias>").description("disconnect a mailbox and delete its token (needs a change approval)").option("--revoke", "also ask Google to revoke the token (may affect other tools sharing the grant)", false).option("--approval <id>", "apply the removal this approval was given for").action(act(async (context, globalOptions, alias, options) => {
		writeResult(await changed(context, globalOptions, inboxRemoveChange(context, alias, { revoke: Boolean(options.revoke) }), options.approval), output(), (data) => `Disconnected "${data.alias}" (${data.email}).\n` + (data.revoked ? "Its token was revoked with Google." : "Its token was not revoked. To revoke it with Google: https://myaccount.google.com/connections") + (data.orphanedSecret ? `\nIts token could not be deleted from this machine: remove ${data.orphanedSecret} from the secret store${data.orphanRecorded ? " (`agent-gmail doctor` lists it)." : ". It could not be recorded either, so nothing else will list it."}` : "\nIts token was deleted from this machine."), streams);
	}));
	program.command("search <query>").description("search across mailboxes, newest first").option("--inbox <alias...>", "search these mailboxes (default: all)").option("--all", "search every connected mailbox", false).option("--messages", "return messages rather than threads", false).option("--limit <number>", "how many rows: 1 to 50 (default 20)").option("--cursor <cursor>", "continue a previous search").option("--include-spam-trash", "include spam and trash", false).action(act(async (context, globalOptions, query, options) => {
		const result = await search(context, {
			query,
			inboxes: options.all ? "all" : options.inbox,
			kind: options.messages ? "messages" : "threads",
			limit: options.limit,
			cursor: options.cursor ? String(options.cursor) : void 0,
			includeSpamTrash: Boolean(options.includeSpamTrash)
		});
		writeResult(result, output(), (data) => renderSearch(data, globalOptions.color), streams);
	}));
	program.command("read <messageId>").description("read one message: headers, body, attachments and what was hidden in it").requiredOption("--inbox <alias>", "which mailbox").option("--quoted", "keep quoted history and signatures", false).option("--max-chars <number>", "how much body to return").option("--offset <number>", "continue from this character").action(act(async (context, globalOptions, messageId, options) => {
		const result = await readMessage(context, String(options.inbox), messageId, {
			includeQuoted: Boolean(options.quoted),
			maxChars: options.maxChars,
			offset: options.offset
		});
		writeResult(result, output(), (data) => renderMessage(data, globalOptions.color), streams);
	}));
	program.command("thread <threadId>").description("read a whole conversation, oldest first").requiredOption("--inbox <alias>", "which mailbox").option("--quoted", "keep quoted history and signatures", false).option("--max-chars <number>", "how much of each body to return").action(act(async (context, globalOptions, threadId, options) => {
		const result = await readThread(context, String(options.inbox), threadId, {
			includeQuoted: Boolean(options.quoted),
			maxChars: options.maxChars
		});
		writeResult(result, output(), (data) => renderThread(data, globalOptions.color), streams);
	}));
	program.command("timeline <threadId>").description("what happened in a conversation, computed from the messages").requiredOption("--inbox <alias>", "which mailbox").addOption(new Option("--format <format>", "how to render it").choices([
		"md",
		"json",
		"mermaid"
	])).option("--business-hours", "count waiting time in working hours only", false).action(act(async (context, _globalOptions, threadId, options) => {
		const result = await threadTimeline(context, String(options.inbox), threadId, { businessHours: Boolean(options.businessHours) });
		const format = String(options.format ?? "md");
		writeResult(format === "json" ? result.timeline : result, output(), () => format === "mermaid" ? result.mermaid : result.markdown, streams);
	}));
	const attachments = program.command("attachments").description("find and download files people sent");
	attachments.command("find").description("find attachments across mailboxes").option("--inbox <alias...>", "search these mailboxes (default: all)").option("--from <address>", "only from this sender").option("--filename <text>", "name or extension").option("--after <date>", "only after this date").option("--before <date>", "only before this date").option("--min-bytes <number>", "at least this big").option("--max-bytes <number>", "at most this big").option("--type <mimeType>", "only this content type").option("--query <query>", "extra Gmail search syntax").option("--limit <number>", "how many rows: 1 to 100 (default 25)").action(act(async (context, globalOptions, options) => {
		const result = await findAttachments(context, {
			inboxes: options.inbox,
			from: options.from ? String(options.from) : void 0,
			filename: options.filename ? String(options.filename) : void 0,
			after: options.after ? String(options.after) : void 0,
			before: options.before ? String(options.before) : void 0,
			minBytes: options.minBytes,
			maxBytes: options.maxBytes,
			mimeType: options.type ? String(options.type) : void 0,
			query: options.query ? String(options.query) : void 0,
			limit: options.limit
		});
		writeResult(result, output(), (data) => renderAttachments(data, globalOptions.color), streams);
	}));
	attachments.command("download <messageId...>").description("save the attachments of one or more messages where you say: Downloads, the current folder, or a folder you name").requiredOption("--inbox <alias>", "which mailbox").option("--part <partId>", "one specific attachment").option("--max-files <number>", "stop after this many files: 1 to 200 (default 50)").option("--to <where>", "where to save: downloads, current, or a folder (absolute, or starting with ~) — alone only at your own terminal").option("--choice <id>", "the choice id the question came with: beside --to, or alone once the person answered it with approve").addOption(new Option("--out <subpath>").hideHelp()).action(act(async (context, globalOptions, messageIds, options) => {
		refuseRetiredOut(options.out, "cli");
		const inbox = String(options.inbox);
		const part = options.part ? String(options.part) : void 0;
		const result = await downloadAtTerminal({
			core: context.core,
			download: (answer) => downloadAttachments(context, inbox, messageIds.map((messageId) => ({
				messageId,
				partId: part
			})), {
				maxFiles: options.maxFiles,
				...answer
			}),
			to: options.to === void 0 ? void 0 : String(options.to),
			choice: options.choice === void 0 ? void 0 : String(options.choice),
			env,
			output: output(),
			noInput: globalOptions.noInput,
			command: shellCommand([
				"agent-gmail",
				"attachments",
				"download",
				...messageIds,
				"--inbox",
				inbox,
				...part === void 0 ? [] : ["--part", part],
				...options.maxFiles === void 0 ? [] : ["--max-files", String(options.maxFiles)]
			], platform),
			approveCommand: "agent-gmail approve",
			render: (question) => renderDownloadQuestion(question, globalOptions.color),
			streams
		});
		writeResult(result, output(), (data) => renderDownloads(data, globalOptions.color), streams);
	}));
	program.command("contacts <query>").description("find someone’s address: from the address book, from people written to, and from past mail").option("--inbox <alias...>", "search these mailboxes (default: all)").addOption(new Option("--sources <source...>", "where to look; all three when left out").choices([...CONTACT_SOURCES])).option("--limit <number>", "how many rows: 1 to 50 (default 20)").action(act(async (context, globalOptions, query, options) => {
		const result = await searchContacts(context, query, {
			inboxes: options.inbox,
			sources: options.sources,
			limit: options.limit
		});
		writeResult(result, output(), (data) => renderContacts(data, globalOptions.color), streams);
	}));
	program.command("followups").description("conversations waiting on somebody").option("--inbox <alias...>", "these mailboxes (default: all)").addOption(new Option("--direction <who>", "who is being waited on").choices([...FOLLOW_UP_DIRECTIONS])).option("--older-than <days>", "only threads quiet for this long").option("--lookback <days>", "how far back to look").option("--limit <number>", "how many rows: 1 to 50 (default 20)").action(act(async (context, globalOptions, options) => {
		const result = await followUps(context, {
			inboxes: options.inbox,
			direction: options.direction === void 0 ? void 0 : String(options.direction),
			olderThanDays: options.olderThan,
			lookbackDays: options.lookback,
			limit: options.limit
		});
		writeResult(result, output(), (data) => renderFollowUps(data, globalOptions.color), streams);
	}));
	program.command("export <id>").description("write a message or a thread to a file, to read without filling the conversation").requiredOption("--inbox <alias>", "which mailbox").option("--thread", "export the whole conversation", false).addOption(new Option("--format <format>", "md, json or eml").choices([...EXPORT_FORMATS])).option("--out <subpath>", "a folder inside the downloads root").option("--quoted", "keep quoted history", false).action(act(async (context, _globalOptions, id, options) => {
		const result = await exportMail(context, String(options.inbox), id, {
			thread: Boolean(options.thread),
			format: options.format === void 0 ? void 0 : String(options.format),
			out: options.out ? String(options.out) : void 0,
			includeQuoted: Boolean(options.quoted)
		});
		writeResult(result, output(), (data) => `Wrote ${data.kind === "thread" ? `${data.messageCount} messages` : "the message"} to ${data.path} (${Math.round(data.bytes / 1024)} KB, ${data.format}).`, streams);
	}));
	const draft = program.command("draft").description("write messages into Drafts — never sent from here");
	withDraftOptions(draft.command("new").description("write a new message into Drafts")).requiredOption("--inbox <alias>", "which mailbox").requiredOption("--to <address...>", "who it goes to").option("--subject <subject>", "the subject line").action(act(async (context, globalOptions, options) => {
		const result = await createDraft(context, String(options.inbox), await draftInput(options));
		writeResult(result, output(), (data) => renderDraft(data, globalOptions.color), streams);
	}));
	withDraftOptions(draft.command("reply <messageId>").description("reply, reply to all, or forward")).requiredOption("--inbox <alias>", "which mailbox").addOption(new Option("--mode <mode>", "how to answer").choices([...REPLY_MODES])).option("--to <address...>", "who it goes to (a forward needs this; a reply computes it)").action(act(async (context, globalOptions, messageId, options) => {
		const result = await replyDraft(context, String(options.inbox), messageId, {
			...await draftInput(options),
			mode: options.mode === void 0 ? void 0 : String(options.mode),
			quote: options.quote !== false
		});
		writeResult(result, output(), (data) => renderDraft(data, globalOptions.color), streams);
	}));
	draft.command("list").description("the drafts in a mailbox").requiredOption("--inbox <alias>", "which mailbox").option("--limit <number>", "how many rows (default 20)").action(act(async (context, globalOptions, options) => {
		const result = await listDrafts(context, String(options.inbox), options.limit);
		writeResult(result, output(), (data) => renderDrafts(data, globalOptions.color), streams);
	}));
	draft.command("show <draftId>").description("read a draft back, with the preview the sender would approve").requiredOption("--inbox <alias>", "which mailbox").action(act(async (context, globalOptions, draftId, options) => {
		const result = await getDraft(context, String(options.inbox), draftId);
		writeResult(result, output(), (data) => renderDraft(data, globalOptions.color), streams);
	}));
	withDraftOptions(draft.command("update <draftId>").description("change a draft — the body, files and headers you do not restate are kept; a new body comes only from --text or --file (`--file -` for standard input)")).requiredOption("--inbox <alias>", "which mailbox").option("--to <address...>", "replace the recipients").option("--subject <subject>", "replace the subject line").action(act(async (context, globalOptions, draftId, options) => {
		const input = await draftInput(options, { bodyOptional: true });
		const result = await updateDraft(context, String(options.inbox), draftId, input);
		writeResult(result, output(), (data) => renderDraft(data, globalOptions.color), streams);
	}));
	draft.command("delete <draftId>").description("throw a draft away").requiredOption("--inbox <alias>", "which mailbox").action(act(async (context, _globalOptions, draftId, options) => {
		const result = await deleteDraft(context, String(options.inbox), draftId);
		writeResult(result, output(), (data) => `Deleted draft ${data.draftId}.`, streams);
	}));
	const send = program.command("send").description("send a draft that has been prepared and approved — never anything else");
	send.command("prepare <draftId>").description("show exactly what would be sent, and record an approval for it").requiredOption("--inbox <alias>", "which mailbox").action(act(async (context, globalOptions, draftId, options) => {
		const result = await prepareSend(context, String(options.inbox), draftId);
		writeResult(result, output(), (data) => renderSendPreparation(data, globalOptions.color, context.platform), streams);
	}));
	send.command("execute <draftId>").description("send it — only with an approval, and only to the recipients that approval names").requiredOption("--inbox <alias>", "which mailbox").requiredOption("--approval <id>", "the approval from `send prepare`").requiredOption("--expect-to <address...>", "who you believe this goes to; `none` for nobody").requiredOption("--expect-subject <subject>", "the subject you believe it has; `none` for an empty one").option("--expect-cc <address...>", "who you believe is copied; `none` for nobody", ["none"]).option("--expect-bcc <address...>", "who you believe is blind-copied; `none` for nobody", ["none"]).action(act(async (context, globalOptions, draftId, options) => {
		const expectSubject = String(options.expectSubject);
		const result = await (deps.executeSend ?? executeSend)(context, String(options.inbox), {
			draftId,
			approvalId: String(options.approval),
			expect: {
				to: expected(options.expectTo),
				cc: expected(options.expectCc),
				bcc: expected(options.expectBcc),
				subject: expectSubject
			},
			expectSubjectNone: expectSubject === "none"
		});
		writeResult(result, output(), (data) => renderSent(data, globalOptions.color), streams);
	}));
	send.command("list").description("approvals waiting, and what each one is for").option("--inbox <alias>", "only this mailbox").action(act(async (context, globalOptions, options) => {
		const result = await listApprovals(context, { inbox: options.inbox ? String(options.inbox) : void 0 });
		writeResult(result, output(), (data) => renderApprovals(data, globalOptions.color), streams);
	}));
	send.command("cancel <approvalId>").description("cancel an approval — refusing to send is never the dangerous direction").action(act(async (context, _globalOptions, approvalId) => {
		const result = await revokeApproval(context, approvalId);
		writeResult(result, output(), (data) => `Approval ${data.approvalId} is ${data.state}. Nothing was sent.`, streams);
	}));
	program.command("approve <approvalId>").description("approve a send or a change at this terminal: read it, then type the code back — or answer where a download is saved").action(act(async (context, globalOptions, approvalId) => {
		const marker = agentMarker(env);
		if (marker) throw new CommsError("APPROVAL_REQUIRED", "only a person can approve a send or a change, not an agent", {
			hint: `Ask the user to run ${inlineCommand(shellCommand([
				"agent-gmail",
				"approve",
				approvalId
			], context.platform))} in their own terminal.`,
			details: { marker }
		});
		if (!canPrompt(env, streams, {
			json: globalOptions.json,
			noInput: globalOptions.noInput
		})) throw new CommsError("APPROVAL_REQUIRED", "approving a send or a change needs an interactive terminal", { hint: `Run ${inlineCommand(shellCommand([
			"agent-gmail",
			"approve",
			approvalId
		], context.platform))} directly in a terminal, or send the draft from Gmail.` });
		const pending = await context.core.approvals.get(approvalId);
		if (pending && approvalKind(pending) === "change") {
			const outcome = await approveChangeAtTerminal(context.core, approvalId, env, {
				json: globalOptions.json,
				color: globalOptions.color,
				platform: context.platform
			}, streams);
			streams.stdout.write(outcome.state === "approved" ? "Approved. This command approves; the change is applied by the command that prepared it.\n" : "Cancelled. Nothing was changed.\n");
			return;
		}
		if (pending && approvalKind(pending) === "download") {
			const outcome = await answerDownloadAtTerminal(context.core, approvalId, {
				env,
				color: globalOptions.color,
				platform,
				approveCommand: "agent-gmail approve",
				streams
			});
			streams.stdout.write(outcome.state === "approved" ? `Answered. Nothing is saved yet: the download that asked saves there when it is made again with --choice ${approvalId}, or choiceId "${approvalId}".\n` : "Cancelled. Nothing was saved.\n");
			return;
		}
		const prompt = await beginApproval(context, approvalId);
		streams.stdout.write(`${prompt.preview}\n\n`);
		const answer = await askFor(streams, { question: `Type ${paint(globalOptions.color, "bold", prompt.challenge)} to send this, or press Enter to cancel: ` });
		if (!answer.trim()) {
			await revokeApproval(context, approvalId);
			streams.stdout.write("Cancelled. Nothing was sent.\n");
			return;
		}
		await finishApproval(context, approvalId, answer);
		streams.stdout.write("Approved. The agent can send it now — this command approves, it does not send.\n");
	}));
	const confirmClients = program.command("confirm-clients").description("MCP clients whose approval forms are trusted to reach you");
	confirmClients.command("list").description("the clients on the list").action(act(async (context, _globalOptions) => {
		writeResult(await listConfirmClients(context), output(), (data) => data.length === 0 ? "No client may show approval forms. Sends under \"confirm\" are approved in a terminal, or from Gmail." : `Trusted to show approval forms: ${data.join(", ")}.`, streams);
	}));
	confirmClients.command("add <name>").description("trust a client that has just passed the probe (needs a change approval)").option("--approval <id>", "apply the change this approval was given for").action(act(async (context, globalOptions, name, options) => {
		const clients = await changed(context, globalOptions, confirmClientAddChange(context, name), options.approval);
		writeResult(clients, output(), (data) => `Trusted to show approval forms: ${data.join(", ")}.`, streams);
	}));
	confirmClients.command("remove <name>").description("stop trusting a client — never needs permission").action(act(async (context, _globalOptions, name) => {
		const clients = await removeConfirmClient(context, name);
		writeResult(clients, output(), (data) => data.length === 0 ? "No client may show approval forms now." : `Still trusted: ${data.join(", ")}.`, streams);
	}));
	program.command("organise").alias("organize").description("label, archive, star and mark read — every change reversible, and previewable with --dry-run").requiredOption("--inbox <alias>", "which mailbox").option("--message <id...>", "these messages").option("--thread <id...>", "every message in these conversations").option("--add <label...>", "add these labels (by name or id)").option("--remove <label...>", "remove these labels").option("--archive", "take it out of the inbox", false).option("--read", "mark it read", false).option("--unread", "mark it unread", false).option("--star", "star it", false).option("--unstar", "unstar it", false).option("--dry-run", "say what would change and change nothing", false).action(act(async (context, globalOptions, options) => {
		const result = await modify(context, String(options.inbox), {
			messageIds: options.message,
			threadIds: options.thread,
			addLabels: options.add,
			removeLabels: options.remove,
			archive: Boolean(options.archive),
			markRead: Boolean(options.read),
			markUnread: Boolean(options.unread),
			star: Boolean(options.star),
			unstar: Boolean(options.unstar),
			dryRun: Boolean(options.dryRun)
		});
		writeResult(result, output(), (data) => renderModify(data, globalOptions.color, context.platform), streams);
	}));
	program.command("organise-undo").alias("organize-undo").description("put an organising change back, from the `undo` a --json organise returned").requiredOption("--inbox <alias>", "which mailbox").option("--from <path>", "a file holding the undo array; `-` reads standard input", "-").action(act(async (context, _globalOptions, options) => {
		const source = String(options.from);
		const raw = source === "-" ? await (async () => {
			const { readBoundedStream } = await import("./small-file-BNvPUCv_.mjs");
			const piped = await readBoundedStream(streams.stdin, 4194304);
			if (!piped.ok) throw new CommsError("USAGE", piped.problem === "too-large" ? "that is far larger than an undo receipt" : "the piped undo receipt could not be read to the end", { hint: "Pipe in the `undo` array from `agent-gmail organise … --json`." });
			return piped.text;
		})() : await (async () => {
			const { readSmallFile } = await import("./small-file-BNvPUCv_.mjs");
			const content = await readSmallFile(source, {
				follow: true,
				maxBytes: 4194304
			});
			if (!content.ok) throw new CommsError(content.problem === "missing" ? "NOT_FOUND" : "USAGE", `cannot read the undo receipt at ${source}`, { hint: "Pass the file `agent-gmail organise … --json` wrote, or pipe it in on stdin." });
			return content.text;
		})();
		let parsed;
		try {
			parsed = JSON.parse(raw);
		} catch {
			throw new CommsError("BAD_DATA", "that is not the undo from an organise result", { hint: "Pipe in the `undo` array from `agent-gmail organise … --json`." });
		}
		const entries = Array.isArray(parsed) ? parsed : parsed?.data?.undo ?? parsed?.undo;
		if (!Array.isArray(entries)) throw new CommsError("BAD_DATA", "that JSON has no undo array in it", { hint: "Pipe in the `undo` array from `agent-gmail organise … --json`." });
		const result = await applyUndo(context, String(options.inbox), entries);
		writeResult(result, output(), (data) => `Put ${data.messages} message(s) back in ${data.inbox}, exactly as each one was.`, streams);
	}));
	program.command("trash").description("move mail to the bin, or take it out again — nothing is ever deleted outright").requiredOption("--inbox <alias>", "which mailbox").option("--message <id...>", "these messages").option("--thread <id...>", "every message in these conversations").option("--undo", "take them out of the bin instead", false).option("--dry-run", "say what would move and move nothing", false).action(act(async (context, globalOptions, options) => {
		const result = await trash(context, String(options.inbox), {
			messageIds: options.message,
			threadIds: options.thread,
			undo: Boolean(options.undo),
			dryRun: Boolean(options.dryRun)
		});
		writeResult(result, output(), (data) => renderTrash(data, globalOptions.color), streams);
	}));
	program.command("label <name>").description("create a label, or find the one already there").requiredOption("--inbox <alias>", "which mailbox").action(act(async (context, _globalOptions, name, options) => {
		const result = await createLabel(context, String(options.inbox), name);
		writeResult(result, output(), (data) => data.existed ? `"${data.name}" already exists (${data.id}).` : `Created "${data.name}" (${data.id}).`, streams);
	}));
	program.command("labels").description("the labels in a mailbox").requiredOption("--inbox <alias>", "which mailbox").action(act(async (context, globalOptions, options) => {
		writeResult(await listLabels(context, String(options.inbox)), output(), (data) => renderLabels(data, globalOptions.color), streams);
	}));
	program.command("sendas").description("the addresses this mailbox can send as").requiredOption("--inbox <alias>", "which mailbox").action(act(async (context, globalOptions, options) => {
		writeResult(await listSendAs(context, String(options.inbox)), output(), (data) => renderSendAs(data, globalOptions.color), streams);
	}));
	program.command("whoami").description("what Google says about an inbox, and how it is configured").requiredOption("--inbox <alias>", "which mailbox").action(act(async (context, globalOptions, options) => {
		writeResult(await whoami(context, String(options.inbox)), output(), (data) => renderWhoami(data, globalOptions.color), streams);
	}));
	const mcp = program.command("mcp").description("run the MCP server on stdio, for a client to connect to").option("--inbox <alias>", "serve only this mailbox").option("--read-only", "leave out every tool that changes the mailbox", false).action(act(async (_context, _globalOptions, options) => {
		ran = true;
		const { startStdioServer } = await import("./stdio-entry-DX_CMmk_.mjs");
		await startStdioServer({
			...deps,
			env,
			inbox: options.inbox ? String(options.inbox) : void 0,
			readOnly: Boolean(options.readOnly)
		});
	}));
	mcp.command("install").description("register this server with an MCP client, and prove it starts").addOption(new Option("--client <client>", "which client to register with").choices([
		"claude-code",
		"claude-desktop",
		"codex",
		"cursor",
		"gemini",
		"vscode",
		"json"
	])).option("--name <name>", "the name the client will show: 1 to 64 letters, digits, dots, underscores or hyphens", "gmail").option("--inbox <alias>", "serve only this mailbox").option("--read-only", "leave out every tool that changes the mailbox", false).addOption(new Option("--launcher <launcher>", "how the server is started").choices([
		"managed",
		"npx",
		"local"
	])).option("--no-verify", "do not start the server to check the entry works").option("--force", "replace this server's own earlier entry — this is how you upgrade", false).option("--print", "only print what would be written", false).option("--approval <id>", "register the server this approval was given for").action(act(async (context, globalOptions, options) => {
		if (!options.client) throw new CommsError("USAGE", "name the client with --client", { hint: "For example: `agent-gmail mcp install --client claude-code`." });
		const pinned = options.inbox ?? mcp.opts().inbox;
		const { GMAIL_MCP } = await import("./install-CIM-46In.mjs");
		const result = await changed(context, globalOptions, serverInstallChange(context.core, env, {
			channel: "gmail",
			client: options.client,
			name: String(options.name ?? "gmail"),
			inbox: pinned ? String(pinned) : void 0,
			readOnly: Boolean(options.readOnly || mcp.opts().readOnly),
			launcher: options.launcher,
			noVerify: options.verify === false,
			print: options.print === true,
			force: Boolean(options.force)
		}, GMAIL_MCP), options.approval);
		const status = installExitStatus(result);
		if (status !== EXIT_CODES.OK) softExit = status;
		writeResult(result, output(), (data) => renderInstall(data, globalOptions.color), streams);
	}));
	mcp.command("prune").description("remove managed runtimes that no client config it can read names, no printed entry names, and no process runs").option("--dry-run", "only say what would be removed", false).option("--include-printed", "also remove runtimes kept only because an entry for them was printed (--client json, --print), once those entries are gone", false).option("--approval <id>", "remove the runtimes this approval was given for").action(act(async (context, globalOptions, options) => {
		const { GMAIL_MCP } = await import("./install-CIM-46In.mjs");
		const result = await changed(context, globalOptions, serverPruneChange(context.core, env, {
			channel: "gmail",
			dryRun: options.dryRun === true,
			includePrinted: options.includePrinted === true
		}, GMAIL_MCP), options.approval);
		writeResult(result, output(), (data) => renderPrune(data, globalOptions.color), streams);
	}));
	program.command("setup").description("set this up from nothing: the Google client, a mailbox, and the agent connection").option("--client-json <path>", "the OAuth client JSON, if you already have it").option("--inbox <alias>", "the name to connect the first mailbox under").option("--email <address>", "the address that mailbox must turn out to be").option("--client <name>", "sign that mailbox in through this OAuth client").option("--profile <file>", "add this organisation profile before continuing setup").option("--org-approval <id>", "add the organisation profile this approval was given for").addOption(new Option("--mcp-client <client>", "register with this MCP client when the mailbox is connected").choices([
		"claude-code",
		"claude-desktop",
		"codex",
		"cursor",
		"gemini",
		"vscode"
	])).option("--replace-server", "replace an MCP entry of the same name that is already there", false).addOption(new Option("--store <store>", "where secrets are kept (first time only)").choices([...STORE_KINDS])).option("--move", "delete the downloaded client JSON once its secret is stored", false).addOption(new Option("--launcher <launcher>", "how the server is started").choices([
		"managed",
		"npx",
		"local"
	])).option("--restart", "walk the Google Cloud steps again even if a client is registered", false).option("--approval <id>", "register the client this approval was given for").option("--mcp-approval <id>", "register the MCP server this approval was given for").option("--no-tui", "plain one-line prompts instead of lists and fields").option("--no-browser", "print the links instead of opening them").action(act(async (context, globalOptions, options) => {
		const { loadSetupProfile, requireSetupTarget, setupClientChoiceNeedsMailbox, setupState, CONSOLE_STEPS } = await import("./setup-C7FzGk3t.mjs");
		const out = streams.stderr;
		const bold = (text) => paint(globalOptions.color, "bold", text);
		const dim = (text) => paint(globalOptions.color, "dim", text);
		/**
		* The agent connection as a change: `setupRegistration`, the one `mcp install` and `comms_server_install`
		* make. An approval for it from either of those is claimed here with `--mcp-approval`, and one from here by
		* them.
		*/
		const registration = async (client) => {
			const pin = options.inbox ? await pinFor(client, String(options.inbox)) : void 0;
			return setupRegistration(context, {
				client,
				...options.launcher ? { launcher: String(options.launcher) } : {},
				force: options.replaceServer === true,
				...pin ? { inbox: pin } : {}
			});
		};
		const mcpApproval = typeof options.mcpApproval === "string" ? options.mcpApproval : void 0;
		const againForMcp = () => again(["--approval", "--mcp-approval"]);
		const { interactionFor, askText, askChoice, askYesNo } = await import("./tui-BOprQnnc.mjs");
		const mode = interactionFor({
			streams,
			env,
			json: Boolean(globalOptions.json),
			noInput: Boolean(globalOptions.noInput),
			noTui: options.tui === false,
			canPrompt: canPrompt(env, streams, {
				json: globalOptions.json,
				noInput: globalOptions.noInput
			})
		});
		if (!options.profile) refuseUnclaimedApproval(options.orgApproval, {
			message: "--org-approval goes with --profile: without it this run adds no organisation profile",
			hint: `Run ${inlineCommand(shellCommand([
				"agent-gmail",
				"setup",
				"--help"
			], platform))} and include the --profile file the preview named. Nothing was done.`
		});
		const configBeforeProfile = await context.config();
		const profilePath = options.profile ? profileSourcePath(String(options.profile), context.env, context.cwd, platform) : void 0;
		const incomingProfile = profilePath ? await loadSetupProfile(profilePath) : void 0;
		const incomingProfileHasGmail = incomingProfile?.profile.gmail !== void 0;
		const clientChoiceNeedsMailbox = incomingProfileHasGmail || setupClientChoiceNeedsMailbox(configBeforeProfile);
		const startSetupSignIn = (signIn) => startSignIn(context, {
			...signIn,
			mode: "add",
			setupWithoutGmailProfile: !clientChoiceNeedsMailbox
		});
		if (clientChoiceNeedsMailbox && mode !== "none" && !options.inbox) {
			const organisationNames = incomingProfileHasGmail || configBeforeProfile.version === 2;
			options.inbox = await askText(mode, streams, {
				message: organisationNames ? "A name for it: organisation/gmail" : "A short name for it",
				placeholder: organisationNames ? "acme/gmail" : "work",
				...organisationNames ? {} : { defaultValue: "work" }
			});
			if (!options.email) {
				const address = await askText(mode, streams, { message: "Which address (blank to choose in the browser)" });
				if (address) options.email = address;
			}
		}
		if (clientChoiceNeedsMailbox && !options.inbox) throw new CommsError("USAGE", "name the mailbox with --inbox before setup can choose its client", { hint: `Run ${inlineCommand(shellCommand([
			"agent-gmail",
			"setup",
			"--inbox",
			"acme/gmail"
		], platform))}, replacing acme/gmail with the name being added. Nothing was done.` });
		if (clientChoiceNeedsMailbox && options.inbox) requireSetupTarget(configBeforeProfile, String(options.inbox));
		if (profilePath) await gatedChangeAtTerminal(context.core, orgAddChange(context.core, {
			file: profilePath,
			loadedProfile: incomingProfile,
			...options.store ? { store: String(options.store) } : {},
			...typeof options.orgApproval === "string" ? { approvalId: options.orgApproval } : {}
		}, {
			env: context.env,
			platform: context.platform,
			surface: context.surface,
			cwd: context.cwd,
			now: context.now
		}), {
			approvalId: typeof options.orgApproval === "string" ? options.orgApproval : void 0,
			env,
			output: {
				json: globalOptions.json || globalOptions.noInput,
				color: globalOptions.color
			},
			command: again(["--org-approval"]),
			approvalFlag: "--org-approval",
			approveCommand: "agent-gmail approve",
			streams
		});
		const setupStateOptions = (scanDownloads = true) => ({
			scanDownloads,
			...options.inbox ? { alias: String(options.inbox) } : {},
			...options.email ? { email: String(options.email) } : {},
			...options.client ? { client: String(options.client) } : {}
		});
		let state = await setupState(context, setupStateOptions());
		if (mode !== "none" && state.clientChoice?.organisationLabel) out.write(`Your organisation, ${state.clientChoice.organisationLabel}, provides the Google client.\n\n`);
		const headless = mode === "none";
		const clientStep = state.next === "client";
		const targetAlreadyConnected = clientChoiceNeedsMailbox && options.inbox && Array.isArray(state.inboxes) ? state.inboxes.includes(String(options.inbox)) : false;
		if (!clientStep || headless && !options.clientJson) refuseUnclaimedApproval(options.approval, clientStep ? {
			message: "--approval goes with --client-json: without it this run registers no OAuth client",
			hint: "Run it again with --client-json <path> as well, as the preview named it. Nothing was done."
		} : {
			message: "an OAuth client is already registered, so this run registers none and takes no --approval",
			hint: "Leave out --approval; `agent-gmail client add` registers another. Nothing was done."
		});
		const stopsBefore = !options.mcpClient ? "it names no client with --mcp-client" : !headless ? null : options.inbox && !targetAlreadyConnected ? "it signs a mailbox in first, and that waits for a browser" : state.inboxes.length === 0 ? "no mailbox is connected yet, and connecting one waits for a browser" : clientStep && !(options.clientJson && options.approval !== void 0) ? "the OAuth client comes first, and this run does not register it" : null;
		if (stopsBefore !== null) refuseUnclaimedApproval(options.mcpApproval, {
			message: `this run does not reach the server's registration — ${stopsBefore} — so it takes no --mcp-approval`,
			hint: "Carry it on the run that registers the server, as the preview named it. Nothing was done."
		});
		if (mode === "none") {
			const did = [];
			const warnings = [];
			let blocked = null;
			let handoff = null;
			if (state.next === "client") {
				const path = options.clientJson ? String(options.clientJson) : "";
				if (path) {
					const added = await changed(context, globalOptions, clientAddChange(context, {
						path,
						name: "desktop",
						...options.store ? { store: String(options.store) } : {},
						...options.move === true ? { move: true } : {}
					}), options.approval);
					did.push(`registered the OAuth client as "${added.name}" (secret in the ${added.store} store)` + (added.sourceRemoved ? ", and removed the downloaded file" : ""));
					state = await setupState(context, setupStateOptions());
				} else {
					const usable = state.candidates.find((candidate) => candidate.kind === "desktop");
					blocked = {
						step: "client",
						needs: "--client-json <path>",
						...usable ? { hint: `a Desktop client is already downloaded: ${usable.path}` } : {}
					};
				}
			}
			if (!blocked && (state.next === "inbox" || options.inbox && !targetAlreadyConnected)) {
				const alias = options.inbox ? String(options.inbox) : "";
				if (alias) {
					const registerWith = options.mcpClient ? {
						client: String(options.mcpClient),
						...options.launcher ? { launcher: String(options.launcher) } : {},
						...options.replaceServer === true ? { replace: true } : {}
					} : void 0;
					const started = await startSetupSignIn({
						alias,
						...options.email ? { email: String(options.email) } : {},
						...options.client ? { client: String(options.client) } : {},
						detached: true,
						...deps.listenerCommand ? { listenerCommand: deps.listenerCommand } : {},
						...registerWith ? { registerWith } : {}
					});
					handoff = {
						authUrl: started.authUrl,
						finish: commandText(shellCommand([
							"agent-gmail",
							"inbox",
							"add",
							"--finish",
							started.flowId,
							"--wait",
							String(60)
						], context.platform)),
						...registerWith ? { registerWith } : {}
					};
					did.push(`started a sign-in for "${alias}"`);
					blocked = {
						step: "inbox",
						needs: "the link opened and approved in a browser",
						hint: registerWith ? `This command does not open browsers or grant consent. Give the user the link, then run the finish command: it also registers the server with ${registerWith.client}, and stops for the person's approval of that.` : "This command does not open browsers or grant consent. Give the user the link, then run the finish command."
					};
				} else blocked = {
					step: "inbox",
					needs: "--inbox <alias> [--email <address>]"
				};
			}
			if (!blocked && (state.next === "mcp" || options.mcpClient)) {
				const which = options.mcpClient ? String(options.mcpClient) : "";
				if (which) {
					const outcome = await gatedChange(context.core, await registration(which), {
						surface: "cli",
						approvalId: mcpApproval,
						approveCommand: "agent-gmail approve",
						platform
					});
					if (outcome.status === "approval-required") {
						const { prepared } = outcome;
						blocked = {
							step: "mcp",
							needs: `a person's approval to register the server with ${which}`,
							hint: approvalHint(prepared, withWords(againForMcp(), "--mcp-approval", prepared.approvalId), "agent-gmail approve"),
							approvalId: prepared.approvalId,
							policy: prepared.policy,
							preview: prepared.preview,
							expiresAt: prepared.expiresAt
						};
						softExit = EXIT_CODES.APPROVAL;
					} else {
						const result = outcome.result;
						warnings.push(...result.warnings);
						if (result.applied && result.verified) did.push(`registered the server with ${which}`);
						else blocked = {
							step: "mcp",
							needs: result.applied ? "a server that starts" : "a client this can write to",
							...result.verifyDetail ? { hint: result.verifyDetail } : {}
						};
					}
					state = await setupState(context, setupStateOptions());
				} else blocked = {
					step: "mcp",
					needs: "--mcp-client <client>"
				};
			}
			const report = {
				...state,
				did,
				warnings,
				blocked,
				handoff
			};
			const nameExample = (await context.config()).version === 2 ? "acme/gmail" : "work";
			writeResult(report, output(), () => renderSetupPlan({
				...report,
				nameExample
			}, CONSOLE_STEPS, globalOptions.color, context.platform), streams);
			return;
		}
		let walkConsole = state.next === "client" || options.restart === true;
		let addAnother = Boolean(options.inbox && !targetAlreadyConnected);
		let addMcp = Boolean(options.mcpClient);
		/** Set by `--restart`, or by answering "start over": the walk then begins at 1/5 whatever is recorded. */
		let startOver = options.restart === true;
		if (state.done.length > 0 && !options.restart && !addAnother && !addMcp) {
			out.write(`${bold("Picking up where you left off.")}\n`);
			if (state.clients.length > 0) out.write(`  done · client "${state.clients.join("\", \"")}" registered\n`);
			if (state.inboxes.length > 0) out.write(`  done · ${state.inboxes.length} mailbox(es): ${state.inboxes.join(", ")}\n`);
			if (state.registeredWith.length > 0) out.write(`  done · connected to ${state.registeredWith.join(", ")}\n`);
			if (state.next === "done") {
				const what = await askChoice(mode, streams, {
					message: "Everything is set up. What would you like to do?",
					choices: [
						{
							value: "inbox",
							label: "Connect another mailbox",
							hint: "you can have as many as you like"
						},
						{
							value: "mcp",
							label: "Register with another agent",
							hint: `already: ${state.registeredWith.join(", ")}`
						},
						{
							value: "console",
							label: "Walk the Google Cloud steps again",
							hint: "changes nothing on this machine"
						},
						{
							value: "nothing",
							label: "Nothing, thanks"
						}
					],
					initial: "inbox"
				});
				if (what === "nothing") return;
				if (what === "console") walkConsole = true;
				if (what === "inbox") addAnother = true;
				if (what === "mcp") addMcp = true;
				out.write("\n");
			}
			if (await askChoice(mode, streams, {
				message: "Continue from here, or start over?",
				choices: [{
					value: "continue",
					label: "Continue",
					hint: "pick up at the next unfinished step"
				}, {
					value: "restart",
					label: "Start over",
					hint: "walk the Google Cloud steps again; removes nothing"
				}],
				initial: "continue"
			}) === "restart") {
				walkConsole = true;
				startOver = true;
			}
			out.write("\n");
		} else out.write(`${bold("Setting up agent-gmail")}\n\n`);
		const { planConsoleWalk, runConsoleWalk } = await import("./console-walk-C6ryp_13.mjs");
		const { asTyped, chooseClientFile } = await import("./client-step-AGvcDppJ.mjs");
		const { readSetupProgress, recordConsoleStep } = await import("./setup-progress-C5mYtgAz.mjs");
		const { downloadDirectory, findClientJson } = await import("./setup-C7FzGk3t.mjs");
		const stateDir = context.core.paths.stateDir;
		const where = asTyped(downloadDirectory(context.env), homeDirectory(context.env));
		let clientPath = options.clientJson ? String(options.clientJson) : "";
		let walkFrom = 0;
		if (walkConsole && state.next === "client" && !startOver) {
			if (clientPath) walkFrom = CONSOLE_STEPS.length;
			else {
				const plan = await planConsoleWalk({
					steps: CONSOLE_STEPS,
					progress: await readSetupProgress(stateDir, CONSOLE_STEPS.length),
					candidates: state.candidates,
					where,
					choose: (question) => askChoice(mode, streams, question)
				});
				walkFrom = plan.from;
				if (plan.path) clientPath = plan.path;
				out.write("\n");
			}
		}
		if (walkConsole && walkFrom < CONSOLE_STEPS.length) {
			if (walkFrom === 0) out.write("Gmail only accepts calls from an OAuth client registered to a Google Cloud project, and it has to be\nyours, unless an organisation profile provides one. This is once per person, and one client covers every\nmailbox you connect and everyone you share it with.\n\n");
			await runConsoleWalk({
				steps: CONSOLE_STEPS,
				from: walkFrom,
				show: async (step, index) => {
					out.write(`${bold(`${index + 1}/${CONSOLE_STEPS.length}  ${step.title}`)}\n`);
					out.write(`${dim(`      ${step.why}`)}\n`);
					out.write(`      ${dim(step.url)}\n\n`);
					for (const action of step.actions) out.write(`      • ${action}\n`);
					for (const warning of step.avoid) out.write(`      ${paint(globalOptions.color, "yellow", "!")} ${warning}\n`);
					out.write("\n");
					if (options.browser !== false) openInBrowser(step.url);
					await askFor(streams, { question: "      press Enter when that is done — " });
					out.write("\n");
				},
				record: async (consoleStep) => {
					if (state.next === "client") await recordConsoleStep(stateDir, consoleStep, context.now()).catch(() => void 0);
				}
			});
		}
		if (state.next === "client") {
			const path = clientPath || await chooseClientFile({
				choose: (question) => askChoice(mode, streams, question),
				type: (question) => askText(mode, streams, question)
			}, () => findClientJson(context.env), where);
			const added = await changed(context, globalOptions, clientAddChange(context, {
				path,
				name: "desktop",
				...options.store ? { store: String(options.store) } : {},
				...options.move === true ? { move: true } : {}
			}), options.approval);
			out.write(`\n${bold("Client registered")} as "${added.name}".\n`);
			out.write(`${dim(added.store === "keychain" ? "The id went to your config; the secret to your keychain, never to a file." : "The id went to your config; the secret to an owner-only file beside it, in the file store.")}\n`);
			if (added.sourceRemoved) out.write(`${dim("The downloaded JSON has been deleted.")}\n`);
			out.write("\n");
			state = await setupState(context, setupStateOptions(false));
		}
		/** Reads a flag once and forgets it, so the second mailbox is not offered the first one's name. */
		const pending = {
			inbox: options.inbox ? String(options.inbox).trim() : "",
			email: options.email ? String(options.email).trim() : ""
		};
		const takeFlag = (name) => {
			const value = pending[name] ?? "";
			pending[name] = "";
			return value;
		};
		while (state.next === "inbox" || addAnother) {
			addAnother = false;
			out.write(`${bold("Connect a mailbox")}\n`);
			out.write(`${dim("Google will warn the app is not verified. That is expected for a client you made")}\n`);
			out.write(`${dim("yourself: choose Advanced, then \"Go to … (unsafe)\", and leave every box ticked.")}\n\n`);
			const organisationNames = (await context.config()).version === 2;
			const alias = takeFlag("inbox") || await askText(mode, streams, organisationNames ? {
				message: "A name for it: organisation/gmail",
				placeholder: "acme/gmail"
			} : {
				message: "A short name for it",
				placeholder: "work",
				defaultValue: "work"
			});
			const email = takeFlag("email") || await askText(mode, streams, { message: "Which address (blank to choose in the browser)" });
			const started = await startSetupSignIn({
				alias,
				...email ? { email } : {},
				...options.client ? { client: String(options.client) } : {},
				detached: false,
				...deps.listenerCommand ? { listenerCommand: deps.listenerCommand } : {}
			});
			out.write(`\n${renderSignInStarted(started, "add", globalOptions.color, context.platform)}\n`);
			if (options.browser !== false) openInBrowser(started.authUrl);
			if (started.listener) {
				const signedIn = await started.listener.result;
				out.write(`\n${renderSignedIn(signedIn, globalOptions.color, context.platform)}\n\n`);
			}
			state = await setupState(context, setupStateOptions(false));
			if (!await askYesNo(mode, streams, {
				message: "Connect another mailbox?",
				defaultYes: false
			})) break;
			out.write("\n");
		}
		if (state.next === "mcp" || addMcp) {
			const named = options.mcpClient ? String(options.mcpClient) : "";
			if (named !== "" || await askYesNo(mode, streams, { message: "Connect this to an agent?" })) {
				const which = named || await askChoice(mode, streams, {
					message: "Which client?",
					choices: [
						{
							value: "claude-code",
							label: "Claude Code"
						},
						{
							value: "claude-desktop",
							label: "Claude Desktop"
						},
						{
							value: "codex",
							label: "Codex"
						},
						{
							value: "cursor",
							label: "Cursor"
						},
						{
							value: "gemini",
							label: "Gemini CLI"
						},
						{
							value: "vscode",
							label: "VS Code"
						}
					],
					initial: "claude-code"
				});
				const result = await gatedChangeAtTerminal(context.core, await registration(which), {
					approvalId: mcpApproval,
					env,
					output: {
						json: globalOptions.json || globalOptions.noInput,
						color: globalOptions.color
					},
					command: named ? againForMcp() : withWords(againForMcp(), "--mcp-client", which),
					approvalFlag: "--mcp-approval",
					approveCommand: "agent-gmail approve",
					answered: named === "",
					streams
				});
				out.write(`\n${renderInstall(result, globalOptions.color)}\n`);
			}
		}
		const final = await setupState(context, setupStateOptions(false));
		const [first] = final.inboxes;
		out.write(`\n${bold("Done.")} ${final.inboxes.length} mailbox(es): ${final.inboxes.join(", ")}\n`);
		if (first) out.write(`${dim(`Try: ${commandText(shellCommand([
			"agent-gmail",
			"search",
			"newer_than:7d",
			"--inbox",
			first
		], context.platform))}`)}\n`);
		out.write(`${dim(`${first ? "Add another" : "Add one"} with: agent-gmail inbox add <organisation>/gmail --email <address>`)}\n`);
	}));
	program.command("doctor").description("check everything that has to work, and say how to fix what does not").option("--inbox <alias>", "check only this mailbox").action(act(async (context, globalOptions, options) => {
		const result = await doctor(context, { inbox: options.inbox ? String(options.inbox) : void 0 });
		writeResult(result, output(), (data) => renderDoctor(data, globalOptions.color), streams);
		if (!result.healthy) softExit = EXIT_CODES.CONFIG;
	}));
	program.command("oauth-listen <flowId>", { hidden: true }).description("internal: hold the loopback port open for a sign-in started with --start").action(act(async (context, _globalOptions, flowId) => {
		await runOauthListener(context, flowId);
	}));
	program.command(`${UPDATE_CHECK_CHILD_COMMAND} <claimedAt>`, { hidden: true }).description("internal: finish the day's update check a command handed on").action(act(async (context, _globalOptions, claimedAt) => {
		await runUpdateCheckChild(context.core, env, claimedAt);
	}));
	try {
		await program.parseAsync([...argv], { from: "user" });
	} catch (error) {
		if (error instanceof CommanderError) {
			if ([
				"commander.helpDisplayed",
				"commander.help",
				"commander.version"
			].includes(error.code)) return 0;
			return runCommand(output(), async () => {
				throw new CommsError("USAGE", error.message.replace(/^error: /, ""), { hint: "Run `agent-gmail --help` to see the commands." });
			}, streams);
		}
		throw error;
	}
	if (!ran) {
		streams.stderr.write(`${paint(globals().color, "dim", "Nothing to do. Try `agent-gmail --help`.")}\n`);
		return 64;
	}
	return exitCode;
}
//#endregion
//#region src/cli.ts
const code = await run(process.argv.slice(2));
process.exitCode = code;
//#endregion
export {};
