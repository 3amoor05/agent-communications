import { t as CLIENT_KIND_LABEL } from "./render-Bz9IAZIe.mjs";
import { basename } from "node:path";
//#region src/cli/client-step.ts
/** The two list entries that are not files. A path cannot contain a NUL, so neither can be mistaken for one. */
const LOOK_AGAIN = "\0look-again";
const ELSEWHERE = "\0elsewhere";
const CLIENT_PATH_PLACEHOLDER = "~/Downloads/client_secret_….json";
/** A directory as a person would type it: `~/Downloads` rather than the whole home path. */
function asTyped(directory, home) {
	if (directory === home) return "~";
	for (const separator of ["/", "\\"]) if (home && directory.startsWith(home + separator)) return `~${separator}${directory.slice(home.length + 1)}`;
	return directory;
}
async function chooseClientFile(prompts, scan, where) {
	for (;;) {
		const candidates = await scan();
		if (candidates.length > 0) {
			const usable = candidates.find((candidate) => candidate.kind === "desktop");
			const picked = await prompts.choose({
				message: "Which client file?",
				choices: [
					...candidates.map((candidate) => ({
						value: candidate.path,
						label: basename(candidate.path),
						hint: `${CLIENT_KIND_LABEL[candidate.kind] ?? candidate.kind} · downloaded ${new Date(candidate.modifiedAt).toLocaleString()}`
					})),
					{
						value: LOOK_AGAIN,
						label: "Look again",
						hint: `not listed yet? check ${where} again`
					},
					{
						value: ELSEWHERE,
						label: "Somewhere else…",
						hint: "type a path"
					}
				],
				initial: usable?.path
			});
			if (picked === LOOK_AGAIN) continue;
			if (picked !== ELSEWHERE) return picked;
			const typed = await prompts.type({
				message: `Path to the downloaded client JSON (Enter to look in ${where} again)`,
				placeholder: CLIENT_PATH_PLACEHOLDER
			});
			if (typed) return typed;
			continue;
		}
		const typed = await prompts.type({
			message: `No client file in ${where} yet. Path to it, or Enter to look again`,
			placeholder: CLIENT_PATH_PLACEHOLDER
		});
		if (typed) return typed;
	}
}
//#endregion
export { asTyped, chooseClientFile };
