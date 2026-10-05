// §4 7c-launches: `node` before a suite entry, as a list of words and as a line — no binary named anywhere.
declare const root: string;

export const words = ['node', '/usr/local/lib/node_modules/@agentcomms/gmail/dist/cli.mjs', 'approve', 'ap_1']; // expect: node-entry
export const line = `node ${root}/packages/slack/src/cli.ts doctor`; // expect: node-entry
export const flagged = ['node', '--experimental-strip-types', `${root}/packages/core/src/cli.ts`, 'update']; // expect: node-entry
