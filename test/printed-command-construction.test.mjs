import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const PREFIX = '(?:agent-(?:gmail|slack|resend|whatsapp)|agentcomms|npx)';
const DIRECT = [
  new RegExp(String.raw`(?<!\\)\`${PREFIX} [^\`]*?\$\{`, 'g'),
  // A command later in a one-line hint is still a command; the escaped backticks are its inline-code markers.
  new RegExp(String.raw`(?<!\\)\`[^\`\n]*?\\\`${PREFIX} [^\`\n]*?\$\{`, 'g'),
  new RegExp(String.raw`(?<!\\)\`${PREFIX} [^\`]*?\`\s*\+`, 'g'),
  new RegExp(String.raw`(?<!\\)'${PREFIX} [^'\n]*?'\s*\+`, 'g'),
  new RegExp(String.raw`(?<!\\)"${PREFIX} [^"\n]*?"\s*\+`, 'g'),
];

/*
 * Prose that deliberately quotes a bad construction belongs here by stable text, with a comment saying why. The
 * allowlist is intentionally not line-numbered: a formatter moving prose must not silently turn it into a failure.
 */
const PROSE_ALLOWLIST = [
  // The CLI's banner begins with the executable name and version; it is a heading, not a command to paste.
  { path: 'packages/core/src/cli.ts', text: 'const HELP = `agentcomms $' + '{VERSION}' },
  // These are compatibility errors naming the executable and required Node version, not runnable commands.
  { path: 'packages/whatsapp/src/sqlite.ts', text: '`agent-whatsapp needs Node $' + '{MIN_NODE}' },
];

function sourceFiles(directory) {
  const found = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) found.push(...sourceFiles(path));
    else if (entry.isFile() && path.endsWith('.ts')) found.push(path);
  }
  return found;
}

function findings(source, path) {
  const starts = new Set();
  for (const pattern of DIRECT) {
    pattern.lastIndex = 0;
    for (let match = pattern.exec(source); match !== null; match = pattern.exec(source)) starts.add(match.index);
  }
  return [...starts]
    .sort((a, b) => a - b)
    .map((index) => {
      const line = source.slice(0, index).split('\n').length;
      const text = source.slice(
        source.lastIndexOf('\n', index) + 1,
        source.indexOf('\n', index) < 0 ? undefined : source.indexOf('\n', index),
      );
      return { path, line, text: text.trim() };
    })
    .filter(
      (finding) =>
        !PROSE_ALLOWLIST.some((allowed) => allowed.path === finding.path && finding.text.includes(allowed.text)),
    );
}

test('the printed-command lint catches direct interpolation and concatenation, but accepts shellCommand', () => {
  assert.equal(findings('const hint = `agent-gmail inbox reauth $' + '{alias}`;', 'fixture.ts').length, 1);
  assert.equal(
    findings('const hint = `Try again with \\`agent-slack workspace reauth $' + '{alias}\\`.`;', 'fixture.ts').length,
    1,
  );
  assert.equal(findings("const hint = 'agent-slack workspace remove ' + alias;", 'fixture.ts').length, 1);
  assert.equal(
    findings(
      "const hint = commandText(shellCommand(['agent-whatsapp', 'sync', '--account', account], platform));",
      'fixture.ts',
    ).length,
    0,
  );
});

test('package sources do not assemble a printed command directly', () => {
  const packages = join(ROOT, 'packages');
  const found = [];
  for (const entry of readdirSync(packages, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const source = join(packages, entry.name, 'src');
    try {
      for (const path of sourceFiles(source)) {
        const name = relative(ROOT, path);
        found.push(...findings(readFileSync(path, 'utf8'), name));
      }
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error;
    }
  }
  assert.deepEqual(
    found,
    [],
    `best-effort lint: printed commands must be built as words with shellCommand:\n${found
      .map((finding) => `${finding.path}:${finding.line}: ${finding.text}`)
      .join('\n')}`,
  );
});
