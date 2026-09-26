/**
 * Starting the stdio server. On stdio, stdout is the protocol, so the console is redirected to stderr first — the
 * same precaution the Slack and Gmail servers take.
 */
import { createWhatsAppMcpServer, type WhatsAppMcpOptions } from './server.ts';

export function redirectConsoleToStderr(): void {
  const toStderr = (...args: unknown[]): void => {
    process.stderr.write(`${args.map((arg) => (typeof arg === 'string' ? arg : JSON.stringify(arg))).join(' ')}\n`);
  };
  console.log = toStderr;
  console.info = toStderr;
  console.debug = toStderr;
  console.warn = toStderr;
}

export async function startWhatsAppStdioServer(options: WhatsAppMcpOptions = {}): Promise<void> {
  redirectConsoleToStderr();
  const server = await createWhatsAppMcpServer(options);
  await server.connectStdio();
}
