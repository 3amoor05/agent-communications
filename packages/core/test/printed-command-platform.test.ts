import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const SOURCE = fileURLToPath(new URL('../src', import.meta.url));

function sourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    return entry.isFile() && entry.name.endsWith('.ts') ? [path] : [];
  });
}

test('core passes a selected platform to every printed shell command', () => {
  /*
   * Most of core's command words are generated ids or fixed values, so POSIX and Windows happen to print the same
   * text. A behavioral assertion cannot see a missing platform there even though it breaks D1's injection contract.
   * Parse the calls instead: `externalCommand` may keep its host default, but production callers name their platform —
   * its third argument — and the quoting under both brands (`quoteCommand`) has no default at all.
   */
  const missing: string[] = [];
  let calls = 0;
  for (const path of sourceFiles(SOURCE)) {
    const text = readFileSync(path, 'utf8');
    for (const match of text.matchAll(/\b(quoteCommand|externalCommand)\s*\(/g)) {
      const needed = match[1] === 'externalCommand' ? 2 : 1;
      const start = match.index ?? 0;
      if (/function\s+$/.test(text.slice(Math.max(0, start - 20), start))) continue;
      calls += 1;
      let parentheses = 1;
      let brackets = 0;
      let braces = 0;
      let commas = 0;
      // Whether the last thing read at the call's own level was a comma: a trailing one separates nothing.
      let trailing = false;
      let quote = '';
      for (let index = start + match[0].length; index < text.length && parentheses > 0; index += 1) {
        const character = text[index] ?? '';
        const next = text[index + 1] ?? '';
        if (quote) {
          if (character === '\\') index += 1;
          else if (character === quote) quote = '';
          continue;
        }
        if (character === '/' && next === '/') {
          index = text.indexOf('\n', index + 2);
          if (index < 0) break;
          continue;
        }
        if (character === '/' && next === '*') {
          index = text.indexOf('*/', index + 2);
          if (index < 0) break;
          index += 1;
          continue;
        }
        if (character === "'" || character === '"' || character === '`') {
          quote = character;
          trailing = false;
          continue;
        }
        if (!/\s/.test(character) && character !== ')') trailing = false;
        if (character === '(') parentheses += 1;
        else if (character === ')') parentheses -= 1;
        else if (character === '[') brackets += 1;
        else if (character === ']') brackets -= 1;
        else if (character === '{') braces += 1;
        else if (character === '}') braces -= 1;
        else if (character === ',' && parentheses === 1 && brackets === 0 && braces === 0) {
          commas += 1;
          trailing = true;
        }
      }
      if (commas - (trailing ? 1 : 0) < needed) {
        const line = text.slice(0, start).split('\n').length;
        missing.push(`${path.slice(SOURCE.length + 1)}:${line}`);
      }
    }
  }
  assert.ok(calls > 3, `${calls} calls were read`);
  assert.deepEqual(missing, [], `command constructions without an explicit platform:\n${missing.join('\n')}`);
});

test('organisation secret-store selection receives the operation platform', () => {
  const source = readFileSync(join(SOURCE, 'operations', 'organisations.ts'), 'utf8');
  // The platform, and the handoffs its refusal's command is made with — made for that same platform (CUE-403).
  assert.match(
    source,
    /chooseSecretStore\s*\(\s*config,\s*spec\.store,\s*\{\s*keyring:\s*options\.keyring,\s*handoffs:\s*commands\.handoffs,?\s*\}\s*\)/,
  );
  assert.match(source, /const commands = orgHandoffs\(core, options\.platform\);/);
});
