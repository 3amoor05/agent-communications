// §4 7e-structure: the reviewed external commands — `chmod`, and a client's own `mcp` — none of them this suite's.
declare const externalCommand: (words: readonly string[], reason: string, platform: string) => unknown;
declare const dir: string;
declare const name: string;
declare const cliPath: string;
declare const run: (program: string, args: readonly string[]) => Promise<void>;

export const owner = externalCommand(['chmod', '700', dir], 'the system command that sets permissions', 'darwin');
export const remove = externalCommand(['claude', 'mcp', 'remove', name], "the client's own command", 'darwin');
export const look = externalCommand(['codex', 'mcp', 'get', name], "the client's own command", 'win32');
export const registered = run(cliPath, ['mcp', 'add', name, '--', 'node', '/opt/server.mjs']);
