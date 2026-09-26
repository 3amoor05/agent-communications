import { spawn } from 'node:child_process';

/**
 * Hands a `whatsapp://` or `https://wa.me/` link to the operating system, which opens WhatsApp with the text filled in.
 *
 * The only module in this package that starts a process, and a test holds it to that. It opens a link the way a
 * click would — `open` on macOS, `xdg-open` elsewhere, with the link as one argument and no shell — and it sends
 * nothing: WhatsApp shows the message and waits for the person. The same shape as the Slack package's browser opener.
 */
export type Opener = (url: string) => boolean;

export function openLink(url: string, platform: NodeJS.Platform = process.platform): boolean {
  if (!/^(?:whatsapp:\/\/send\?|https:\/\/wa\.me\/)/.test(url)) return false;
  const [command, args] =
    platform === 'darwin'
      ? ['open', [url]]
      : platform === 'win32'
        ? ['cmd', ['/c', 'start', '', url]]
        : ['xdg-open', [url]];
  try {
    const child = spawn(command, args as string[], { stdio: 'ignore', detached: true });
    child.on('error', () => undefined);
    child.unref();
    return true;
  } catch {
    return false;
  }
}
