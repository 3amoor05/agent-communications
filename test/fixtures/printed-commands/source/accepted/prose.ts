/*
 * §4 7e-structure: what is not a string a person reads, and prose that names no program. A comment may quote
 * `agent-gmail approve ap_1` and `npx -y @agentcomms/core@latest update` as what used to be printed.
 */
// agentcomms update --later, in a line comment.
export type Program = 'agentcomms' | 'agent-slack';
export const pattern = /^agent-(?:gmail|slack) approve/;
export const prose = "npx's cache, a project's own install, a checkout: started from somewhere else.";
export const suite = 'agent-communications core: install and manage the Gmail, Resend, Slack and WhatsApp servers.';
export const field = 'agentcomms.binary: the core keeps its own command name';
export const shell = ['sh', '-c', 'echo hello'];
