import { jn as writeFileAtomic } from "./dist-CBfqDru2.mjs";
import { readFile, rm } from "node:fs/promises";
import { join } from "node:path";
//#region src/operations/setup-progress.ts
/**
* How far through the Google Cloud steps a person has said they are.
*
* Everything else setup knows about where it stands it reads from the machine: a registered client, a connected
* mailbox, a server entry. The five console steps leave nothing on the machine — they happen in a browser — so until
* a client was registered, every run started them again from 1/5, however far the last one had got (CUE-298: "it was
* taken from the absolute beginning, not the last step where he was"). This is the one thing the walk now writes
* down: the last step the person pressed Enter on, and when.
*
* It records an answer, not a fact. Nothing here can see the Cloud console, so a resumed run offers to continue
* rather than continuing, and always offers to start over. Once a client is registered the record has done its job
* and is removed.
*/
const PROGRESS_FILE = "gmail-setup-progress.json";
function progressPath(stateDir) {
	return join(stateDir, PROGRESS_FILE);
}
/** The recorded progress, or null for none — and for anything unreadable, which is the same as none. */
async function readSetupProgress(stateDir, steps) {
	try {
		const parsed = JSON.parse(await readFile(progressPath(stateDir), "utf8"));
		const step = parsed?.consoleStep;
		const at = parsed?.at;
		if (!Number.isInteger(step) || step < 1 || step > steps) return null;
		if (typeof at !== "string" || Number.isNaN(Date.parse(at))) return null;
		return {
			consoleStep: step,
			at
		};
	} catch {
		return null;
	}
}
async function recordConsoleStep(stateDir, consoleStep, now) {
	const record = {
		consoleStep,
		at: now.toISOString()
	};
	await writeFileAtomic(progressPath(stateDir), `${JSON.stringify(record, null, 2)}\n`);
}
async function clearSetupProgress(stateDir) {
	await rm(progressPath(stateDir), { force: true });
}
//#endregion
export { readSetupProgress as n, recordConsoleStep as r, clearSetupProgress as t };
