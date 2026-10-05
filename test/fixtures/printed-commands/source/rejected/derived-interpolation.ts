// §4 7c: a binary taken from a manifest, interpolated into a sentence — alone, or followed by its arguments.
declare const manifest: { binary: string; approve: string };
declare const binary: string;
const CORE_BINARY = 'agentcomms';

export const approve = (id: string) => `Run ${manifest.approve} ${id} in your own terminal.`; // expect: derived-binary
export const help = `Run ${binary} --help.`; // expect: derived-binary
export const alone = `this ${manifest.binary} did not run`; // expect: derived-binary
export const bound = `Run ${CORE_BINARY} doctor.`; // expect: derived-binary
// biome-ignore lint/style/useTemplate: the fixture is a concatenation, as a sentence built with `+` would be.
export const added = `${manifest.binary} ` + 'doctor'; // expect: derived-binary
