import { extname } from 'node:path';
import { safeFilename } from './jail.ts';

/**
 * What a file saved from a stranger may keep of its name, and what its name says about opening it.
 *
 * Gmail's attachment download had both, in its own package; Slack's file download needs the same two answers, and a
 * second copy of either list is a second list to fall behind. So they live here, and each channel hands in the name
 * as its platform delivers it — decoded from RFC 2047 for mail, as Slack sent it for Slack.
 */

/**
 * Extensions a saved file keeps: documents and images that open in a viewer. Anything else — an executable, a script,
 * a macro-enabled document, an archive, HTML or SVG, or a name with no extension — is saved with none, so opening it
 * by accident runs nothing.
 */
const KEPT_EXTENSIONS: ReadonlySet<string> = new Set([
  '.pdf',
  '.txt',
  '.csv',
  '.md',
  '.json',
  '.png',
  '.jpg',
  '.jpeg',
  '.gif',
  '.webp',
  '.heic',
  '.docx',
  '.xlsx',
  '.pptx',
  '.odt',
  '.ods',
  '.odp',
]);

/**
 * The extension a saved file may carry, lower-cased, or `''` when it may carry none.
 *
 * Read from the name the file would be written under — `safeFilename` of it — so the trailing dots and spaces a
 * sender adds to hide an extension are gone before the list is consulted. Only the extension ever comes from the
 * sender's name: the rest of a saved file's name is the channel's own.
 */
export function keptExtension(name: string): string {
  const extension = extname(safeFilename(name)).toLowerCase();
  return KEPT_EXTENSIONS.has(extension) ? extension : '';
}

/** File kinds worth naming before anyone opens one. Nothing in this repository ever opens or runs a saved file. */
const RISK_RULES: Array<{ flag: string; extensions?: RegExp; mimeTypes?: RegExp }> = [
  { flag: 'executable', extensions: /\.(exe|msi|bat|cmd|com|scr|pif|app|dmg|pkg|deb|rpm|apk)$/i },
  { flag: 'script', extensions: /\.(js|mjs|vbs|ps1|sh|bash|zsh|py|rb|jar|jse|wsf|hta)$/i },
  { flag: 'macro-enabled', extensions: /\.(docm|xlsm|pptm|dotm|xltm|xlam)$/i },
  { flag: 'markup', extensions: /\.(html?|svg|xhtml|mht|mhtml)$/i, mimeTypes: /^(text\/html|image\/svg\+xml)$/i },
  { flag: 'archive', extensions: /\.(zip|rar|7z|tar|gz|bz2|xz|iso|cab)$/i },
  { flag: 'disk-image', extensions: /\.(iso|img|vhd|vmdk)$/i },
];

/**
 * The risks worth naming for a file, judged from the name its sender gave it and the type they declared.
 *
 * Two forms of the name, for two kinds of rule. The extension rules run against the name the file would be **written
 * under** — `safeFilename` of it — because `invoice.exe ` matches no `$`-anchored rule while landing on disk as
 * `invoice.exe`. The bidi rule runs against the name as given, because that is the only place a right-to-left
 * override still exists: `safeFilename` removes it by design.
 *
 * `name` is the name as the platform delivers it, already decoded: Gmail decodes RFC 2047 first, and passes the result.
 */
export function fileRisks(name: string, mimeType: string): string[] {
  const onDisk = safeFilename(name);
  const flags: string[] = [];
  for (const rule of RISK_RULES) {
    if (rule.extensions?.test(onDisk) || rule.mimeTypes?.test(mimeType)) flags.push(rule.flag);
  }
  // `invoice.pdf.exe` shows as `invoice.pdf` in clients that hide extensions.
  if (/\.[a-z0-9]{2,5}\.[a-z0-9]{2,5}$/i.test(onDisk)) flags.push('double-extension');
  if (/[\u202a-\u202e\u2066-\u2069]/.test(name)) flags.push('bidi-filename');
  return [...new Set(flags)];
}
