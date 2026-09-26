/**
 * Starting the stdio server. On stdio, **stdout is the protocol**: one stray `console.log` corrupts the stream, so
 * the console is redirected to stderr before the server is built.
 */
import { createResendMcpServer, type ResendMcpOptions } from './server.ts';

export function redirectConsoleToStderr(): void {
  const toStderr = (...args: unknown[]): void => {
    process.stderr.write(`${args.map((arg) => (typeof arg === 'string' ? arg : JSON.stringify(arg))).join(' ')}\n`);
  };
  console.log = toStderr;
  console.info = toStderr;
  console.debug = toStderr;
  console.warn = toStderr;
}

export async function startResendStdioServer(options: ResendMcpOptions = {}): Promise<void> {
  redirectConsoleToStderr();
  const server = await createResendMcpServer(options);
  await server.connectStdio();
}
