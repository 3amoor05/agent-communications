// §4 7c: a `CommsError` hint with a bare command — alone, with an option, or with arguments.
declare class CommsError extends Error {
  constructor(code: string, message: string, options?: { hint?: string });
}

export const usage = new CommsError('USAGE', 'not a command', { hint: 'Run agent-slack --help.' }); // expect: binary
export const bare = new CommsError('USAGE', 'nothing to do', { hint: 'agent-resend' }); // expect: binary
export const approve = new CommsError('APPROVAL_PENDING', 'waits', {
  hint: 'Ask them to run `agentcomms approve ap_1`.', // expect: binary
});
