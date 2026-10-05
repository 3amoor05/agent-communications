// §4 7c: an MCP server's instructions, and a tool's description, that are a binary taken from a manifest, whole.
declare class McpServer {
  constructor(info: { name: string; version: string }, options: { instructions: string });
  registerTool(name: string, config: { description: string }, handler: () => unknown): void;
}
declare const manifest: { binary: string; approve: string };

export const server = new McpServer({ name: 'x', version: '0.0.0' }, { instructions: manifest.approve }); // expect: sink-mcp
server.registerTool('x_tool', { description: manifest.binary }, () => null); // expect: sink-mcp
