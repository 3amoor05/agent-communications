import { createInterface } from "node:readline/promises";
//#region src/cli/prompt.ts
/**
* Asks one question at the terminal and returns what was typed.
*
* Separate from `askChallenge` (which moved to `@agentcomms/core`, because two packages need it) because the send
* approval shows the preview first and compares the answer against a hash held in the approval record, not against
* a challenge this process invented: the code the person types was issued by the store and is checked there, in
* constant time, with a limited number of attempts.
*/
async function askFor(streams, options) {
	const rl = createInterface({
		input: streams.stdin,
		output: streams.stderr
	});
	try {
		return await rl.question(options.question);
	} finally {
		rl.close();
	}
}
//#endregion
export { askFor as t };
