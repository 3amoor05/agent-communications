import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import { extname, join, relative } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { REGISTRY } from '../scripts/channels.mjs';

/**
 * Documentation that names a tool which does not exist is worse than no documentation: an agent follows it, the call
 * fails, and the agent concludes the mailbox is broken rather than that the skill is wrong. The reverse is nearly as
 * bad — a tool nothing documents is a tool nobody uses, and it still has to be maintained.
 *
 * So this test reads the tools and commands that actually exist from the source that registers them, reads every name
 * the skills and the README use, and fails when the two disagree in either direction.
 */

const ROOT = fileURLToPath(new URL('..', import.meta.url));

/**
 * The products whose names are checked, each with its tool prefix and its binary.
 *
 * Gmail was the only one for a long time, and the test read `packages/gmail` by name — so when the Slack server
 * shipped eleven tools, ten of them were documented nowhere and nothing failed. The list is the channel registry's
 * (`scripts/channels.mjs`), so a channel is checked in both directions from the moment its package declares itself.
 * The core server installs the others; its CLI is not Commander, and its commands are the lines of the usage table
 * in `src/cli.ts`, which `usage` says to read.
 */
const PRODUCTS = REGISTRY.products;

/** The source without its comments, which quote the calls the readers below look for. */
const withoutComments = (source) => source.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:'"`])\/\/.*$/gm, '$1');

/**
 * Every tool a server registers. Read from the registration calls, not from a list kept beside them — and every call
 * has to be read: a server whose registrations this pattern stopped recognising would otherwise pass with nothing
 * checked. (This was "more than ten", which a channel with six tools fails for being small.)
 */
async function registeredTools(product) {
  const source = withoutComments(await readFile(join(ROOT, product.server), 'utf8'));
  const pattern = new RegExp(`registerTool\\(\\s*'(${product.tool}_[a-z_]+)'`, 'g');
  const names = [...source.matchAll(pattern)].map((match) => match[1]);
  const calls = source.match(/registerTool\(/g)?.length ?? 0;
  assert.ok(
    names.length > 0 && names.length === calls,
    `the ${product.tool} tool registrations should be readable from the server source: read ${names.length} of ${calls}`,
  );
  return new Set(names);
}

/**
 * Every command path a CLI defines, as `<binary> <path>`.
 *
 * Commander nests, so a subcommand's full path is its parent's plus its own. The parents are read from the
 * `program.command('x')` calls that are assigned to a variable, which is how these CLIs spell a command group.
 */
async function definedCommands(product) {
  if (product.usage) return usageCommands(product);
  const source = await readFile(join(ROOT, product.program), 'utf8');
  const groups = new Map();
  for (const match of source.matchAll(/const (\w+) = program\s*\.command\('([a-z-]+)'\)/g)) {
    groups.set(match[1], match[2]);
  }
  const paths = new Set();
  for (const match of source.matchAll(/(?:^|[\s(])(\w+)\s*\.command\('([a-z-]+)/gm)) {
    const receiver = match[1];
    const name = match[2];
    if (receiver === 'program') paths.add(name);
    else if (groups.has(receiver)) paths.add(`${groups.get(receiver)} ${name}`);
  }
  // `withDraftOptions(draft.command('new')…)` and friends wrap the call, so pick those up too.
  for (const match of source.matchAll(/\w+\(\s*(\w+)\s*\.command\('([a-z-]+)/g)) {
    const receiver = match[1];
    if (groups.has(receiver)) paths.add(`${groups.get(receiver)} ${match[2]}`);
  }
  for (const match of source.matchAll(/\.alias\('([a-z-]+)'\)/g)) paths.add(match[1]);
  // Every command the source defines has to be read, however few: a pattern that stopped recognising them would pass.
  const defined = withoutComments(source).match(/\.command\('/g)?.length ?? 0;
  assert.ok(
    paths.size > 0 && paths.size >= defined,
    `the ${product.binary} commands should be readable from the program source: read ${paths.size} of ${defined}`,
  );
  return { paths, groups: new Set(groups.values()) };
}

/**
 * The core CLI's commands, from the usage table it prints: a line of its own is a command, and a word that only
 * prefixes others (`audit` in `audit tail`) is a group. `scripts/registries.mjs` reads the same table from the running
 * CLI; this reads the source, as the rest of this file does.
 */
async function usageCommands(product) {
  const source = await readFile(join(ROOT, product.program), 'utf8');
  const help = /const HELP = `([\s\S]*?)`;/.exec(source)?.[1] ?? '';
  const paths = new Set();
  for (const [, rest] of help.matchAll(new RegExp(`^\\s+${product.binary}\\s+(.*)$`, 'gm'))) {
    const words = [];
    for (const word of rest
      .split(/\s{2,}/)[0]
      .trim()
      .split(/\s+/)) {
      if (!/^[a-z][a-z-]*$/.test(word)) break;
      words.push(word);
    }
    if (words.length > 0) paths.add(words.join(' '));
  }
  const groups = new Set([...paths].filter((path) => path.includes(' ')).map((path) => path.split(' ')[0]));
  assert.ok(paths.size > 10, `the ${product.binary} commands should be readable from its usage table`);
  return { paths, groups };
}

/**
 * Only the parts of a document that claim to be commands: fenced blocks and inline code spans.
 *
 * Prose says things like "install agent-gmail and connect a mailbox", where "and" is a word rather than a
 * subcommand. Reading those as commands made the check cry wolf, and a check that cries wolf gets turned off.
 */
function codeOnly(text) {
  const fenced = [...text.matchAll(/```[\s\S]*?```/g)].map((match) => match[0]);
  const inline = [...text.matchAll(/`([^`\n]+)`/g)].map((match) => match[1]);
  return [...fenced, ...inline].join('\n');
}

/**
 * What a user or an agent reads: the READMEs, the hand-written docs, and every skill.
 *
 * Not the generated reference pages — they are produced from the code and checked by `verify:reference` — and not
 * the design specs and research notes, which describe what was planned or what other servers do.
 */
async function documentation() {
  const files = [join(ROOT, 'README.md')];
  for (const name of await readdir(join(ROOT, 'packages'))) {
    files.push(join(ROOT, 'packages', name, 'README.md'));
  }
  for (const name of await readdir(join(ROOT, 'docs'))) {
    if (extname(name) === '.md') files.push(join(ROOT, 'docs', name));
  }
  const skills = join(ROOT, 'skills');
  for (const entry of await readdir(skills, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const directory = join(skills, entry.name);
    for (const file of await readdir(directory, { recursive: true })) {
      if (extname(file) === '.md') files.push(join(directory, file));
    }
  }
  const readable = [];
  for (const file of files) {
    const text = await readFile(file, 'utf8').catch(() => null);
    if (text !== null && !text.startsWith('<!-- generated by scripts/sync-reference.mjs'))
      readable.push({ file, text });
  }
  return readable;
}

for (const product of PRODUCTS) {
  const toolPattern = new RegExp(`\\b${product.tool}_[a-z_]+`, 'g');

  test(`every ${product.tool}_ tool named in the docs is one the server registers`, async () => {
    const tools = await registeredTools(product);
    const offenders = [];
    for (const { file, text } of await documentation()) {
      for (const match of text.matchAll(toolPattern)) {
        if (!tools.has(match[0])) offenders.push(`${relative(ROOT, file)}: ${match[0]}`);
      }
    }
    assert.deepEqual([...new Set(offenders)], [], `documented tools that do not exist:\n${offenders.join('\n')}`);
  });

  test(`every ${product.binary} command named in the docs is one the CLI defines`, async () => {
    const { paths: commands, groups } = await definedCommands(product);
    const offenders = [];
    // Spaces and tabs only: `\s` crossed from one code span into the next, reading `agent-gmail send` followed by an
    // unrelated span as the two-word command `send agent-gmail`.
    // Not inside a package name: `@agentcomms/core` and "an @agentcomms server" name no `agentcomms` command.
    const commandPattern = new RegExp(
      `(?<![@/\\w-])${product.binary}[ \\t]+([a-z][a-z-]*)(?:[ \\t]+([a-z][a-z-]*))?(?:[ \\t]+([a-z][a-z-]*))?`,
      'g',
    );
    for (const { file, text } of await documentation()) {
      // A leading `-` is a flag, not a subcommand: `agent-gmail --json` names no command at all.
      for (const match of codeOnly(text).matchAll(commandPattern)) {
        const [, first, second, third] = match;
        // Three words are a command only as a whole — `agentcomms attach roots add` — never by their first two:
        // `attach roots` groups the others, as `draft` does below.
        if (third && commands.has(`${first} ${second} ${third}`)) continue;
        // A two-word form counts if the pair is a command, or if the first word is a command on its own and the
        // second is one of its arguments. Not when the first word is a group: `draft peek` is not a command just
        // because `draft` is one, and reading it as an argument let an invented subcommand through.
        if (commands.has(`${first} ${second}`)) continue;
        if (commands.has(first) && !(groups.has(first) && second)) continue;
        offenders.push(`${relative(ROOT, file)}: ${product.binary} ${first}${second ? ` ${second}` : ''}`);
      }
    }
    assert.deepEqual([...new Set(offenders)], [], `documented commands that do not exist:\n${offenders.join('\n')}`);
  });

  test(`every ${product.tool}_ tool the server registers is documented somewhere`, async () => {
    const tools = await registeredTools(product);
    const documented = new Set();
    for (const { text } of await documentation()) {
      for (const match of text.matchAll(toolPattern)) documented.add(match[0]);
    }
    const undocumented = [...tools].filter((tool) => !documented.has(tool)).sort();
    assert.deepEqual(
      undocumented,
      [],
      `these tools exist and no skill, README or guide mentions them, so nobody will use them:\n${undocumented.join('\n')}`,
    );
  });

  test(`every ${product.tool}_ tool has a section in the generated reference`, async () => {
    /*
     * The generator reads each server it is told about, and `verify:reference` checks only the pages it generates —
     * so a server it was never told about has no page and nothing fails. This is what fails.
     */
    const tools = await registeredTools(product);
    const page = await readFile(join(ROOT, product.reference), 'utf8').catch(() => '');
    const missing = [...tools].filter((tool) => !page.includes(`### \`${tool}\``)).sort();
    assert.deepEqual(missing, [], `${product.reference} does not document:\n${missing.join('\n')}`);
  });
}
