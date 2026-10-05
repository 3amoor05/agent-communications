import { basename } from "node:path";
//#region src/cli/console-walk.ts
async function planConsoleWalk(input) {
	const total = input.steps.length;
	const usable = input.candidates.find((candidate) => candidate.kind === "desktop");
	const progress = input.progress;
	if (!usable && !progress) return { from: 0 };
	const said = [];
	const choices = [];
	if (usable) {
		const when = new Date(usable.modifiedAt).toLocaleString();
		said.push(`${basename(usable.path)} is in ${input.where} (Desktop app, downloaded ${when}). Downloading it is the last Google Cloud step.`);
		choices.push({
			value: "use",
			label: "Use it, and skip the Google Cloud steps"
		}, {
			value: "list",
			label: "Skip the Google Cloud steps, and choose a file",
			hint: `another one in ${input.where}, or one still downloading`
		});
	}
	if (progress) {
		const when = new Date(progress.at).toLocaleString();
		const done = progress.consoleStep;
		const last = input.steps[done - 1]?.title ?? `step ${done}`;
		const next = input.steps[done]?.title;
		said.push(`You confirmed Google Cloud step ${done}/${total} (${last}) on ${when}.`);
		choices.push(next ? {
			value: "continue",
			label: `Continue from step ${done + 1}/${total}: ${next}`
		} : {
			value: "continue",
			label: "Continue to the client file",
			hint: `all ${total} steps were confirmed`
		});
	}
	choices.push({
		value: "restart",
		label: progress ? `Start over from 1/${total}` : `Walk the Google Cloud steps from 1/${total}`,
		hint: "changes nothing on this machine"
	});
	const answer = await input.choose({
		message: said.join(" "),
		choices,
		initial: usable ? "use" : "continue"
	});
	if (answer === "use" && usable) return {
		from: total,
		path: usable.path
	};
	if (answer === "list") return { from: total };
	if (answer === "continue" && progress) return { from: progress.consoleStep };
	return { from: 0 };
}
async function runConsoleWalk(input) {
	for (let index = input.from; index < input.steps.length; index++) {
		await input.show(input.steps[index], index);
		await input.record(index + 1);
	}
}
//#endregion
export { planConsoleWalk, runConsoleWalk };
