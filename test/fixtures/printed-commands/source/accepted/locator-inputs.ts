// §4 7e-structure: the locator's own inputs — a caller, a target, the words after the program — and the renderers.
declare const handoffs: {
  own(words: readonly string[], use?: { uses?: readonly string[] }): unknown;
  core(words: readonly string[]): unknown;
  of(channel: string, words: readonly string[]): unknown;
};
declare const locateCliCommand: (request: object) => unknown;
declare const handoffSentence: (handoff: unknown, say: (command: string) => string) => string;
declare const target: object;
declare const paths: object;

export const approve = handoffs.own(['approve', 'ap_1']);
export const help = handoffs.own(['--help'], { uses: [] });
export const update = handoffs.core(['update', '--later']);
export const slack = handoffs.of('slack', ['workspace', 'reauth', 'acme/slack']);
export const located = locateCliCommand({
  caller: { url: import.meta.url, packageName: '@agentcomms/gmail' },
  target,
  words: ['inbox', 'reauth', 'acme/gmail'],
  uses: ['configDir', 'stateDir', 'dataDir', 'secretsDir'],
  paths,
});
export const hint = handoffSentence(approve, (command) => `Ask the person to run ${command} in their own terminal.`);
