// §4 7e-structure: protocol identities — a program's or a server's name alone, where a name is what is meant.
declare const program: { name(name: string): unknown };
declare class McpServer {
  constructor(info: { name: string; version: string }, options: { instructions: string });
}
declare const binaryOf: (name: string) => string;
declare const names: Set<string>;

// The MCP server's name, and the name a client is given: the protocol's own fields.
export const server = new McpServer({ name: 'agent-gmail', version: '0.0.0' }, { instructions: 'Gmail.' });
// Commander's program name, which its generated `Usage:` line prints.
program.name('agent-slack');
// The update gate's and an MCP tool gate's identity fields, an HTTP user agent, a schema's vendor.
export const gate = { binary: 'agentcomms', server: 'agent-resend', channel: 'resend' };
export const headers = { 'user-agent': 'agent-resend', accept: 'application/json' };
export const schema = { vendor: 'agentcomms', version: 1 };
// Comparisons and look-ups: the name read, never printed.
export const isCore = (name: string) => name === 'agentcomms' || names.has('agent-whatsapp');
export function kind(name: string): string {
  switch (name) {
    case 'agent-gmail':
      return 'gmail';
    default:
      return binaryOf(name);
  }
}
// A constant bound to the name, used only to compare with.
const CORE_BINARY = 'agentcomms';
export const core = (binary: string) => binary !== CORE_BINARY;
// A Symbol's key, a package specifier, a folder, a header's prefix: none is a binary at a word's edge.
export const key = Symbol.for('agentcomms.strictToolArguments');
export const packageName = '@agentcomms/gmail';
export const folder = '~/.config/agent-communications';
export const marker = 'x-agentcomms-version';
export const quarantine = `0081;${Date.now()};agentcomms;`;
// A manifest, as core's snapshot of one holds it: its identity fields hold names and the approve command.
export const manifest = {
  contract: 1,
  channel: 'gmail',
  label: 'Gmail',
  binary: 'agent-gmail',
  server: { defaultName: 'gmail', npxPackage: '@agentcomms/gmail-mcp', bins: ['agent-gmail-mcp'] },
  approve: 'agent-gmail approve',
};
