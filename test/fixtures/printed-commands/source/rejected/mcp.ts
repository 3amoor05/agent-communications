// §4 7c: an MCP server's instructions and a tool's description, each naming a bare command.
declare class McpServer {
  constructor(info: { name: string; version: string }, options: { instructions: string });
  registerTool(name: string, config: { description: string }, handler: () => unknown): void;
}

export const server = new McpServer(
  { name: 'agent-gmail', version: '0.0.0' },
  { instructions: 'Under confirm the person runs agent-gmail approve <id> in their own terminal.' }, // expect: binary
);
server.registerTool('gmail_send_execute', { description: 'The same as `agent-gmail send execute`.' }, () => null); // expect: binary
