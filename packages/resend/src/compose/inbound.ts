import { extname } from 'node:path';
import {
  neutralise,
  parseAddressList,
  type SanitizeReport,
  sanitizeHtmlToText,
  sanitizePlainText,
  stripInvisible,
  type TaintCollector,
  wrapUntrusted,
} from '@agentcomms/core';

/**
 * Turning what arrived — or what the team sent — into what an agent may read.
 *
 * Everything a sender controls (subject, display names, body, attachment names) goes through core's sanitiser and
 * into the untrusted-content envelope, with one boundary per response. What they cannot control — ids, sizes, and
 * Resend's own SPF/DKIM/DMARC verdict, computed by its receiving server — stays outside, in plain fields.
 *
 * **The HTML part is authoritative** when there is one, because it is what a mail client shows; the text part is
 * compared with it, and text that appears only there is counted as hidden — a reader never sees it, which makes it
 * the natural place to leave an instruction for a model.
 */

export const MAX_BODY_CHARS = 20_000;
/** How much text may appear only in the plain part before it is reported: about ten words. */
const MISMATCH_THRESHOLD_CHARS = 60;

export interface HiddenReport {
  /** Elements a reader would not see, removed. */
  hiddenElements: number;
  hiddenChars: number;
  /** Zero-width, bidi-control and tag characters removed. */
  invisibleCharsRemoved: number;
  /** Chat-template tokens, role markers and envelope look-alikes defused. */
  tokensNeutralised: number;
  sameColorElements: number;
  unreadableHidingRules: number;
  /** Characters of text present only in the plain part, never shown by a mail client. */
  plainOnlyChars: number;
  imagesNotLoaded: number;
}

export interface ReadBody {
  /** Wrapped: sender-controlled. */
  body: string;
  source: 'html' | 'text' | 'none';
  truncated: boolean;
  totalChars: number;
  hidden: HiddenReport;
  /** Links in the body: their domains and what looks wrong with them. The text is inside `body`. */
  links: { domain: string | null; flags: string[] }[];
  /** What a reader should know before trusting it, in words — escaping aside, nothing here is sender text. */
  warnings: string[];
}

function wordsOf(text: string): Set<string> {
  return new Set(text.toLowerCase().match(/[\p{L}\p{N}]{3,}/gu) ?? []);
}

/** Characters of words in `plain` that the visible HTML never shows. */
function plainOnly(visible: string, plain: string): number {
  const shown = wordsOf(visible);
  let extra = 0;
  for (const word of wordsOf(plain)) if (!shown.has(word)) extra += word.length;
  return extra;
}

export interface Envelope {
  boundary: string;
  account: string;
  id: string;
  collector?: TaintCollector | undefined;
}

/** One sender-controlled string, stripped and wrapped. */
export function wrapField(text: string, field: string, envelope: Envelope): string {
  return wrapUntrusted(
    stripInvisible(text).text,
    { field, inbox: envelope.account, id: envelope.id },
    envelope.boundary,
    envelope.collector,
  );
}

export function readBody(
  html: string | null | undefined,
  text: string | null | undefined,
  envelope: Envelope,
): ReadBody {
  let report: SanitizeReport;
  let source: ReadBody['source'];
  let content: string;
  let plainOnlyChars = 0;
  if (typeof html === 'string' && html.trim() !== '') {
    ({ text: content, report } = sanitizeHtmlToText(html));
    source = 'html';
    if (typeof text === 'string' && text.trim() !== '') {
      plainOnlyChars = plainOnly(content, sanitizePlainText(text).text);
    }
  } else if (typeof text === 'string' && text !== '') {
    ({ text: content, report } = sanitizePlainText(text));
    source = 'text';
  } else {
    ({ text: content, report } = sanitizePlainText(''));
    source = 'none';
  }
  const totalChars = content.length;
  const truncated = totalChars > MAX_BODY_CHARS;
  const shown = truncated ? content.slice(0, MAX_BODY_CHARS) : content;
  const { tokensNeutralised } = neutralise(shown);
  const hidden: HiddenReport = {
    hiddenElements: report.hiddenElements,
    hiddenChars: report.hiddenChars,
    invisibleCharsRemoved: report.invisibleCharsRemoved,
    tokensNeutralised: report.tokensNeutralised + tokensNeutralised,
    sameColorElements: report.sameColorElements,
    unreadableHidingRules: report.unreadableHidingRules,
    plainOnlyChars: plainOnlyChars > MISMATCH_THRESHOLD_CHARS ? plainOnlyChars : 0,
    imagesNotLoaded: report.imagesNotLoaded,
  };
  const warnings: string[] = [];
  if (hidden.hiddenElements > 0) {
    warnings.push(
      `${hidden.hiddenElements} hidden element(s) removed (${hidden.hiddenChars} characters a reader would not see)`,
    );
  }
  if (hidden.invisibleCharsRemoved > 0) warnings.push(`${hidden.invisibleCharsRemoved} invisible character(s) removed`);
  if (hidden.tokensNeutralised > 0)
    warnings.push(`${hidden.tokensNeutralised} model-control token(s) or role marker(s) defused`);
  if (hidden.sameColorElements > 0)
    warnings.push(`${hidden.sameColorElements} element(s) coloured like their background`);
  if (hidden.unreadableHidingRules > 0) {
    warnings.push(`${hidden.unreadableHidingRules} hiding rule(s) could not be applied; some hidden text may remain`);
  }
  if (hidden.plainOnlyChars > 0) {
    warnings.push(
      `the text part carries ${hidden.plainOnlyChars} characters the HTML never shows — a mail client hides them`,
    );
  }
  if (truncated) warnings.push(`the body was cut at ${MAX_BODY_CHARS} of ${totalChars} characters`);
  return {
    body: wrapField(shown, 'body', envelope),
    source,
    truncated,
    totalChars,
    hidden,
    links: report.links.map((link) => ({ domain: link.domain, flags: [...link.flags] })),
    warnings,
  };
}

/** An address-list value as Resend returns it — a string or a list of strings — as `{address, name}` pairs. */
export function addressesOf(value: unknown): { address: string; name: string }[] {
  const entries = Array.isArray(value)
    ? value.filter((item) => typeof item === 'string')
    : typeof value === 'string'
      ? [value]
      : [];
  return entries.flatMap((entry) => parseAddressList(entry));
}

/** An address with its display name wrapped, since the name is whatever the sender chose. */
export function personOf(
  entry: { address: string; name: string },
  field: string,
  envelope: Envelope,
): { address: string; name: string | null } {
  return { address: entry.address, name: entry.name ? wrapField(entry.name, field, envelope) : null };
}

const EXECUTABLE = new Set([
  '.exe',
  '.bat',
  '.cmd',
  '.com',
  '.scr',
  '.msi',
  '.ps1',
  '.sh',
  '.js',
  '.vbs',
  '.jar',
  '.app',
  '.pif',
  '.lnk',
  '.hta',
]);
const MACRO = new Set(['.docm', '.xlsm', '.pptm', '.dotm', '.xltm']);
const ARCHIVE = new Set(['.zip', '.rar', '.7z', '.tar', '.gz', '.tgz', '.bz2', '.xz']);
const DISK = new Set(['.iso', '.img', '.dmg', '.vhd', '.vhdx']);
const ACTIVE = new Set(['.html', '.htm', '.svg', '.xhtml']);

/** What an attachment's name says about opening it. Never opened here either way. */
export function attachmentRisks(filename: string): string[] {
  const name = stripInvisible(filename).text.toLowerCase();
  const extension = extname(name);
  const flags: string[] = [];
  if (EXECUTABLE.has(extension)) flags.push('executable');
  if (MACRO.has(extension)) flags.push('macro-enabled');
  if (ARCHIVE.has(extension)) flags.push('archive');
  if (DISK.has(extension)) flags.push('disk-image');
  if (ACTIVE.has(extension)) flags.push('html-or-svg');
  const parts = name.split('.');
  if (parts.length > 2 && (EXECUTABLE.has(extension) || ACTIVE.has(extension))) flags.push('double-extension');
  if (stripInvisible(filename).removed > 0) flags.push('hidden-characters-in-name');
  return flags;
}
