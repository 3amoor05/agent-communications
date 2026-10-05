import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, posix, sep } from 'node:path';
import * as ts from 'typescript/unstable/ast';
import { createVirtualFileSystem } from 'typescript/unstable/fs';
import { API } from 'typescript/unstable/sync';
import { loadRegistry } from '../../scripts/channels.mjs';

/*
 * The source half of CUE-403 task 15 (design 2026-10-04, D5): a syntax-tree scan of every runtime package's source for
 * a command of this suite written anywhere but the locator — a binary by its name in a string a person reads, a
 * binary taken from a manifest and put into one, `node` before a suite entry, `npx` before a suite package, a shell
 * wrapper whose payload starts a suite product. The compile-time half is `printed-command-types.test.mjs`.
 *
 * What it knows of the suite it derives: the packages from `capabilities.json` and the channel registry
 * (`scripts/channels.mjs`), servers' wrappers among them; each package's binaries from its own `package.json` — `bin`,
 * the manifest's `binary` and its server's `bins` — compared without case, with or without a Windows extension, as
 * Windows compares them. Nothing here lists a channel, a binary or a file to skip.
 *
 * What it leaves alone it leaves by syntax and data flow, never by file:
 *
 * - comments, regular expressions, types and import and export declarations — none of them a string a person reads;
 * - a protocol identity, where the value is a binary's name alone: a property that names a program or a server
 *   (`name`, `binary`, `bins`, `server`, `vendor`, `user-agent`, `defaultName`, `npxPackage`, `packageName`), Commander's
 *   `.name(…)`, a comparison, a `case`, a set's or a string's look-up, and a constant bound to that name — which then
 *   counts as a binary taken from a manifest wherever it is put into a string;
 * - a channel manifest's own identity fields, inside the object literal that is a manifest (`contract`, `channel` and
 *   `binary` together): `binary`, `label`, `approve`, `server`'s `defaultName`, `npxPackage`, `bins` and `entryFiles`.
 *   Its other fields — a guarantee a person reads — are scanned like anything else;
 * - the locator's own inputs — the words after the program, given to `own`, `core`, `of` or `locateCliCommand` — which
 *   name no program, and the reviewed external commands (`externalCommand(['claude', 'mcp', …])`), which name none of
 *   this suite's.
 *
 * A binary taken from a manifest is, by syntax: a property called `binary` or `approve`, an element of `bins`, a
 * variable called `binary` (or `…Binary`, `…_BINARY`), or a constant bound to a binary's name. A client's own CLI is
 * never called `binary` here (`cliPath`), so the convention holds.
 */

/** Every rule, by the name a finding carries. */
export const RULES = Object.freeze([
  'binary',
  'derived-binary',
  'sink-hint',
  'sink-mcp',
  'sink-stream',
  'sink-result',
  'node-entry',
  'npx-package',
  'wrapper-payload',
]);

const SCOPE = '@agentcomms';
const EXTENSION = '(?:\\.(?:cmd|exe|bat|ps1|com))?';
/**
 * Where a binary's name starts a word: the start, a space, a quote (a typographic one too), a bracket, a shell's
 * separator, a path's `/`.
 */
const BEFORE = '(?<=^|[\\s`\'"\u2018\u201C(\\[{<>|&,=\\\\/])';
/** Where it ends one: the end, a space, a quote, a bracket, `:`, `;`, a shell's separator, or a sentence's full stop. */
const AFTER = '(?=$|[\\s`\'"\u2019\u201D),\\]}<>|&;:]|\\.(?:$|[\\s`\'"\u2019\u201D]))';
/** What a binary taken from a manifest reads as, in a string being built: a word of its own. */
const DERIVED = '\u0001derived\u0001';
/** What anything else interpolated reads as: part of whatever word it is in. */
const OTHER = '\u0002';

/** Properties whose value names a program or a server: an identity, never a command, when it is a binary alone. */
const IDENTITY_KEYS = new Set([
  'name',
  'binary',
  'bins',
  'server',
  'vendor',
  'user-agent',
  'defaultName',
  'npxPackage',
  'packageName',
]);
/** A channel manifest's own identity fields. */
const MANIFEST_IDENTITY_KEYS = new Set([
  'binary',
  'label',
  'approve',
  'defaultName',
  'npxPackage',
  'bins',
  'entryFiles',
]);
/** Look-ups that compare a value with a name rather than print it. */
const LOOKUPS = new Set([
  'includes',
  'has',
  'startsWith',
  'endsWith',
  'indexOf',
  'lastIndexOf',
  'get',
  'add',
  'delete',
]);
/** Shells, whose argument after `-c` (or `/c`, `-Command`) is a command line of its own. */
const SHELLS = new Set(['sh', 'bash', 'zsh', 'dash', 'ksh', 'fish', 'cmd', 'powershell', 'pwsh']);
const SHELL_PAYLOAD = /^(?:-[a-z]*c|\/[ck]|-command|-encodedcommand)$/i;
/** Programs that run the rest of their words as a command: read so only in a list of words, never in prose. */
const PREFIXES = new Set(['env', 'exec', 'nohup', 'sudo', 'xargs', 'start', 'timeout', 'nice', 'script', 'time']);
/** Programs that fetch and run a package. */
const RUNNERS = new Set(['npx', 'pnpx', 'bunx']);

/**
 * What the scan knows of the suite under `root`: its runtime packages and their sources, its binaries, its package
 * specifiers and its entries — all derived from `capabilities.json` and the channel registry.
 */
export function suiteFacts(root, options = {}) {
  const registry = options.registry ?? loadRegistry(root);
  const capabilities = options.capabilities ?? JSON.parse(readFileSync(join(root, 'capabilities.json'), 'utf8'));
  const fromCapabilities = [...new Set(capabilities.capabilities.map((row) => row.package))];
  const packages = [...new Set([...registry.packages, ...fromCapabilities])].sort();
  const manifests = new Map();
  for (const name of packages) {
    const path = join(root, 'packages', name, 'package.json');
    if (!existsSync(path))
      throw new Error(`capabilities.json names the package ${name}, and there is no packages/${name}`);
    manifests.set(name, JSON.parse(readFileSync(path, 'utf8')));
  }
  const binaries = new Set();
  const entries = new Set(['src/cli.ts']);
  const specifiers = new Set();
  for (const manifest of manifests.values()) {
    specifiers.add(manifest.name);
    for (const [binary, entry] of Object.entries(manifest.bin ?? {})) {
      binaries.add(binary.toLowerCase());
      entries.add(String(entry).replace(/^\.\//, ''));
    }
    const declared = manifest.agentcomms;
    if (declared?.binary) binaries.add(declared.binary.toLowerCase());
    for (const binary of declared?.server?.bins ?? []) binaries.add(binary.toLowerCase());
    for (const parts of declared?.server?.entryFiles ?? []) entries.add(parts.join('/'));
  }
  return {
    root,
    packages,
    fromCapabilities,
    binaries: [...binaries].sort((a, b) => b.length - a.length || (a < b ? -1 : 1)),
    entries: [...entries].sort(),
    specifiers: [...specifiers].sort(),
  };
}

/** Every runtime source file of the suite's packages, as `{ path, text }`, `path` relative to the root with `/`. */
export function runtimeSources(facts) {
  const files = [];
  for (const name of facts.packages) {
    const src = join(facts.root, 'packages', name, 'src');
    if (!existsSync(src)) continue;
    for (const file of readdirSync(src, { recursive: true })) {
      if (!String(file).endsWith('.ts')) continue;
      const path = `packages/${name}/src/${String(file).split(sep).join('/')}`;
      files.push({ path, text: readFileSync(join(facts.root, path), 'utf8') });
    }
  }
  return files.sort((a, b) => (a.path < b.path ? -1 : 1));
}

/** Parses `files` with the repository's own TypeScript, without resolving anything or writing a file. */
export function syntaxTrees(files) {
  // A virtual tree rooted the way TypeScript names paths on every platform: with forward slashes.
  const root = '/agentcomms-printed-command-scan';
  const config = posix.join(root, 'tsconfig.json');
  const api = new API({
    fs: createVirtualFileSystem({
      [config]: JSON.stringify({ compilerOptions: { noLib: true, noResolve: true }, files: files.map((f) => f.path) }),
      ...Object.fromEntries(files.map((file) => [posix.join(root, file.path), file.text])),
    }),
  });
  try {
    const snapshot = api.updateSnapshot({ openProjects: [config] });
    try {
      const project = snapshot.getProject(config);
      const broken = project.program.getSyntacticDiagnostics();
      if (broken.length > 0) throw new Error(`the scan needs valid syntax: ${JSON.stringify(broken.slice(0, 3))}`);
      return files.map((file) => ({
        path: file.path,
        text: file.text,
        tree: project.program.getSourceFile(posix.join(root, file.path)),
      }));
    } finally {
      snapshot.dispose();
    }
  } finally {
    api.close();
  }
}

const escapeRegExp = (text) => text.replace(/[\\^$.*+?()[\]{}|/]/g, '\\$&');

/** The scan of `files` against `facts`: every finding, `{ path, line, rule, text }`. `disable` turns rules off. */
export function scan(files, facts, options = {}) {
  const disabled = new Set(options.disable ?? []);
  const names = facts.binaries.map(escapeRegExp).join('|');
  const binaryIn = new RegExp(`${BEFORE}(?:${names})${EXTENSION}${AFTER}`, 'gi');
  const derivedIn = new RegExp(`${BEFORE}${escapeRegExp(DERIVED)}${AFTER}`, 'g');
  const binaryAlone = new RegExp(`^(?:${names})${EXTENSION}$`, 'i');
  const findings = [];
  for (const { path, text, tree } of syntaxTrees(files)) {
    const add = (node, rule, said) => {
      if (disabled.has(rule)) return;
      const start = node.getStart ? node.getStart(tree) : node.pos;
      findings.push({ path, line: text.slice(0, start).split('\n').length, rule, text: said.slice(0, 160) });
    };
    // Constants bound to a binary's name, in this file: what they are put into is a manifest-derived binary.
    const bound = new Set();
    const visitBindings = (node) => {
      if (ts.isVariableDeclaration(node) && node.initializer && ts.isIdentifier(node.name)) {
        const value = literalText(node.initializer);
        if (value !== undefined && binaryAlone.test(value.trim())) bound.add(node.name.text);
      }
      node.forEachChild(visitBindings);
    };
    visitBindings(tree);
    const derived = (node) => isDerived(node, bound);

    const visit = (node) => {
      if (skipped(node)) return;
      // A string a person reads: a literal, a template, or a `+` chain of them — each read whole, as its words.
      if (isStringBuilt(node)) {
        if (!ts.isBinaryExpression(node.parent) || !isPlusChain(node.parent)) {
          const said = textOf(node, derived);
          const identity = identityPosition(node, said, binaryAlone);
          if (!identity) {
            if (said.match(binaryIn)) add(node, 'binary', said);
            if (said.match(derivedIn)) add(node, 'derived-binary', said.replaceAll(DERIVED, '<binary>'));
          }
          for (const rule of launches(wordsOf(said), facts, { list: false })) add(node, rule, said);
        }
      }
      // A word list — an array, a call's arguments, a command and its arguments — as a command line would be.
      const list = wordListOf(node, derived);
      if (list) for (const rule of launches(list, facts, { list: true })) add(node, rule, list.join(' '));
      // A binary taken from a manifest, put whole into what a person reads.
      const sink = sinkOf(node);
      if (sink && derived(sink.value))
        add(sink.value, sink.rule, sink.value.getText ? sink.value.getText(tree) : 'binary');
      node.forEachChild(visit);
    };
    visit(tree);
  }
  return findings;
}

// ── Syntax ──────────────────────────────────────────────────────────────────────────────────────────────────────

/** Syntax that is never a string a person reads: types, and import and export declarations. */
function skipped(node) {
  return ts.isTypeNode(node) || ts.isImportDeclaration(node) || ts.isExportDeclaration(node);
}

function literalText(node) {
  return node && (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) ? node.text : undefined;
}

function unwrapped(node) {
  let at = node;
  while (
    at &&
    (ts.isParenthesizedExpression(at) ||
      ts.isAsExpression(at) ||
      ts.isSatisfiesExpression(at) ||
      ts.isNonNullExpression?.(at))
  ) {
    at = at.expression;
  }
  return at;
}

function isPlusChain(node) {
  return (
    ts.isBinaryExpression(node) &&
    node.operatorToken.kind === ts.SyntaxKind.PlusToken &&
    (isStringBuilt(node.left) || isStringBuilt(node.right))
  );
}

/** A string literal, a template, or a `+` chain with one in it. */
function isStringBuilt(node) {
  if (!node) return false;
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node) || ts.isTemplateExpression(node)) {
    // A tagged template's literal is the tag's to read, and a property's or element's name is no string a person reads.
    return !(node.parent && ts.isTaggedTemplateExpression(node.parent)) && !isNamePosition(node);
  }
  return isPlusChain(node);
}

function isNamePosition(node) {
  const parent = node.parent;
  if (!parent) return false;
  if (
    (ts.isPropertyAssignment(parent) || ts.isPropertyDeclaration?.(parent) || ts.isMethodDeclaration?.(parent)) &&
    parent.name === node
  )
    return true;
  if (ts.isElementAccessExpression(parent) && parent.argumentExpression === node) return true;
  if (ts.isComputedPropertyName?.(parent)) return true;
  return false;
}

/** The words a person reads: literal text as written, a manifest's binary as one word, anything else as part of one. */
function textOf(node, derived) {
  const at = unwrapped(node);
  if (ts.isStringLiteral(at) || ts.isNoSubstitutionTemplateLiteral(at)) return at.text;
  if (ts.isTemplateExpression(at)) {
    let said = at.head.text;
    for (const span of at.templateSpans) said += (derived(span.expression) ? DERIVED : OTHER) + span.literal.text;
    return said;
  }
  if (ts.isBinaryExpression(at) && at.operatorToken.kind === ts.SyntaxKind.PlusToken) {
    return textOf(at.left, derived) + textOf(at.right, derived);
  }
  return derived(at) ? DERIVED : OTHER;
}

/** Whether an expression is a binary taken from a manifest (see the module). */
function isDerived(node, bound) {
  const at = unwrapped(node);
  if (!at) return false;
  if (ts.isPropertyAccessExpression(at)) {
    const name = at.name.text;
    if (name === 'binary' || name === 'approve') return true;
    return false;
  }
  if (ts.isElementAccessExpression(at)) {
    return ts.isPropertyAccessExpression(unwrapped(at.expression)) && unwrapped(at.expression).name.text === 'bins';
  }
  if (ts.isIdentifier(at)) {
    return at.text === 'binary' || /[a-z]Binary$/.test(at.text) || /_BINARY$/.test(at.text) || bound.has(at.text);
  }
  return false;
}

/** Whether a string that names a binary alone sits where a program's or a server's identity is, not a command. */
function identityPosition(node, said, binaryAlone) {
  const at = outermost(node);
  const parent = at.parent;
  // A channel manifest's own identity fields, whatever they hold.
  if (inManifestIdentity(at)) return true;
  if (!binaryAlone.test(said.trim()) && said.trim() !== DERIVED) return false;
  if (!parent) return false;
  if (ts.isPropertyAssignment(parent) && parent.initializer === at) return IDENTITY_KEYS.has(propertyName(parent));
  if (ts.isArrayLiteralExpression(parent) && ts.isPropertyAssignment(parent.parent)) {
    return IDENTITY_KEYS.has(propertyName(parent.parent));
  }
  if (ts.isVariableDeclaration(parent) && parent.initializer === at) return true;
  if (ts.isBinaryExpression(parent)) {
    const kind = parent.operatorToken.kind;
    return (
      kind === ts.SyntaxKind.EqualsEqualsEqualsToken ||
      kind === ts.SyntaxKind.ExclamationEqualsEqualsToken ||
      kind === ts.SyntaxKind.EqualsEqualsToken ||
      kind === ts.SyntaxKind.ExclamationEqualsToken
    );
  }
  if (ts.isCaseClause(parent)) return true;
  if (ts.isCallExpression(parent) && parent.arguments.includes(at)) {
    const callee = unwrapped(parent.expression);
    if (ts.isPropertyAccessExpression(callee)) return callee.name.text === 'name' || LOOKUPS.has(callee.name.text);
  }
  return false;
}

/** The node a string is read as: itself, or the parentheses and casts around it. */
function outermost(node) {
  let at = node;
  while (
    at.parent &&
    (ts.isParenthesizedExpression(at.parent) || ts.isAsExpression(at.parent) || ts.isSatisfiesExpression(at.parent))
  )
    at = at.parent;
  return at;
}

function propertyName(property) {
  const name = property.name;
  if (ts.isIdentifier(name) || ts.isStringLiteral(name)) return name.text;
  return '';
}

/** Whether a node sits in a channel manifest's identity field: an object literal with `contract`, `channel`, `binary`. */
function inManifestIdentity(node) {
  for (let at = node; at?.parent; at = at.parent) {
    const parent = at.parent;
    if (!ts.isPropertyAssignment(parent) || parent.initializer !== at) continue;
    const key = propertyName(parent);
    if (!MANIFEST_IDENTITY_KEYS.has(key) && key !== 'server') continue;
    const object = parent.parent;
    if (key === 'server') continue;
    if (isManifest(object) || (ts.isObjectLiteralExpression(object) && isServerOfManifest(object))) return true;
  }
  return false;
}

function keysOf(object) {
  return new Set(
    object.properties
      .filter((p) => ts.isPropertyAssignment(p) || ts.isShorthandPropertyAssignment?.(p))
      .map((p) => propertyName(p)),
  );
}

function isManifest(object) {
  if (!ts.isObjectLiteralExpression(object)) return false;
  const keys = keysOf(object);
  return keys.has('contract') && keys.has('channel') && keys.has('binary');
}

function isServerOfManifest(object) {
  const parent = object.parent;
  return ts.isPropertyAssignment(parent) && propertyName(parent) === 'server' && isManifest(parent.parent);
}

// ── Sinks ───────────────────────────────────────────────────────────────────────────────────────────────────────

/**
 * What a node writes where a person reads it, whole: a `CommsError`'s message or hint, an MCP server's instructions or
 * a tool's description, a write to stdout or stderr or a stream handed in, a result's field of any name.
 */
function sinkOf(node) {
  if (ts.isNewExpression(node) && ts.isIdentifier(node.expression)) {
    const args = node.arguments ?? [];
    if (node.expression.text === 'CommsError') {
      const hint = args[2] && ts.isObjectLiteralExpression(args[2]) ? property(args[2], 'hint') : undefined;
      if (args[1] && !isStringBuilt(args[1])) return { rule: 'sink-hint', value: args[1] };
      if (hint) return { rule: 'sink-hint', value: hint };
    }
    if (node.expression.text === 'McpServer' && args[1] && ts.isObjectLiteralExpression(args[1])) {
      const instructions = property(args[1], 'instructions');
      if (instructions) return { rule: 'sink-mcp', value: instructions };
    }
  }
  if (ts.isCallExpression(node)) {
    const callee = unwrapped(node.expression);
    if (ts.isPropertyAccessExpression(callee)) {
      const method = callee.name.text;
      if (['registerTool', 'registerPrompt', 'registerResource', 'tool'].includes(method)) {
        for (const argument of node.arguments) {
          if (ts.isObjectLiteralExpression(argument)) {
            const description = property(argument, 'description') ?? property(argument, 'title');
            if (description) return { rule: 'sink-mcp', value: description };
          }
        }
      }
      if (method === 'write' && ts.isPropertyAccessExpression(unwrapped(callee.expression))) {
        const stream = unwrapped(callee.expression).name.text;
        if ((stream === 'stdout' || stream === 'stderr') && node.arguments[0]) {
          return { rule: 'sink-stream', value: node.arguments[0] };
        }
      }
      if (
        ts.isIdentifier(unwrapped(callee.expression)) &&
        unwrapped(callee.expression).text === 'console' &&
        node.arguments[0]
      ) {
        return { rule: 'sink-stream', value: node.arguments[0] };
      }
    }
  }
  // A result's field of any name — but not one a sink above reads as its own (a hint, instructions, a description).
  if (
    ts.isPropertyAssignment(node) &&
    !IDENTITY_KEYS.has(propertyName(node)) &&
    !inManifestIdentity(node.initializer) &&
    !claimedBySink(node)
  ) {
    return { rule: 'sink-result', value: node.initializer };
  }
  return undefined;
}

/** Whether a property is one a sink reads by its name: a `CommsError`'s options, an MCP server's, a tool's config. */
function claimedBySink(property) {
  const object = property.parent;
  const call = object?.parent;
  if (!call || !(ts.isNewExpression(call) || ts.isCallExpression(call)) || !call.arguments?.includes(object))
    return false;
  const callee = unwrapped(call.expression);
  const name = ts.isIdentifier(callee) ? callee.text : ts.isPropertyAccessExpression(callee) ? callee.name.text : '';
  return ['CommsError', 'McpServer', 'registerTool', 'registerPrompt', 'registerResource', 'tool'].includes(name);
}

function property(object, name) {
  const found = object.properties.find((p) => ts.isPropertyAssignment(p) && propertyName(p) === name);
  return found?.initializer;
}

// ── Launches ────────────────────────────────────────────────────────────────────────────────────────────────────

/** A string's words: split where a shell splits them, and where `=` joins an option to its value. */
function wordsOf(said) {
  return said.split(/[\s"'`]+/).filter(Boolean);
}

/**
 * The words of a command line given as a list: an array of strings, a call's arguments (an array among them spread
 * in), or an object's `command` and `args`. Anything not literal is a word nobody can read here.
 */
function wordListOf(node, derived) {
  const word = (element) => {
    if (ts.isSpreadElement(element)) return OTHER;
    const literal = literalText(unwrapped(element));
    if (literal !== undefined) return literal;
    if (ts.isTemplateExpression(unwrapped(element))) return textOf(element, derived);
    if (ts.isPropertyAccessExpression(unwrapped(element)) && unwrapped(element).getText?.() === 'process.execPath')
      return 'node';
    return derived(element) ? DERIVED : OTHER;
  };
  if (ts.isArrayLiteralExpression(node)) return node.elements.map(word);
  if ((ts.isCallExpression(node) || ts.isNewExpression(node)) && (node.arguments?.length ?? 0) > 1) {
    return node.arguments.flatMap((argument) =>
      ts.isArrayLiteralExpression(unwrapped(argument)) ? unwrapped(argument).elements.map(word) : [word(argument)],
    );
  }
  if (ts.isObjectLiteralExpression(node)) {
    const command = property(node, 'command');
    const args = property(node, 'args');
    if (command && args && ts.isArrayLiteralExpression(unwrapped(args)))
      return [word(command), ...unwrapped(args).elements.map(word)];
  }
  return undefined;
}

/** The program a word names: its last path segment, without a Windows extension, in lower case. */
function programOf(word) {
  return (word.split(/[\\/]/).at(-1) ?? '').replace(/\.(?:cmd|exe|bat|ps1|com)$/i, '').toLowerCase();
}

/**
 * The rules a command line given as words breaks: `node` before a suite entry, a runner before a suite package, a
 * shell — or, in a list of words, a prefix such as `env` or `exec` — whose payload starts a suite product.
 */
function launches(words, facts, { list }) {
  const broken = new Set();
  const names = new Set(facts.binaries);
  const suitePath = new RegExp(
    `(?:${escapeRegExp(SCOPE)}[\\\\/]|(?:^|[\\\\/])packages[\\\\/](?:${facts.packages.map(escapeRegExp).join('|')})[\\\\/])`,
    'i',
  );
  const entry = new RegExp(
    `(?:^|[\\\\/])(?:${facts.entries.map((each) => escapeRegExp(each).replace(/\\\//g, '[\\\\/]')).join('|')})$`,
    'i',
  );
  const specifier = new RegExp(
    `${escapeRegExp(SCOPE)}/(?:${facts.packages.map(escapeRegExp).join('|')})(?:@|$|[^\\w-])`,
    'i',
  );
  const namesIn = (word) =>
    word
      .split(/[^A-Za-z0-9._-]+/)
      .map((part) =>
        part
          .replace(/^\.+|\.+$/g, '')
          .replace(/\.(?:cmd|exe|bat|ps1|com)$/i, '')
          .toLowerCase(),
      )
      .filter(Boolean);
  const startsProduct = (payload) =>
    payload.some((word) => word.includes(DERIVED)) ||
    payload.some((word) => namesIn(word).some((name) => names.has(name))) ||
    payload.some((word) => suitePath.test(word) || specifier.test(word));
  for (const [index, word] of words.entries()) {
    const program = programOf(word);
    const rest = words.slice(index + 1);
    if (program === 'node' || program === 'nodejs') {
      // The first word that is not one of Node's own flags is what it runs.
      const script = rest.find((each) => !each.startsWith('-'));
      if (script !== undefined && (suitePath.test(script) || entry.test(script))) broken.add('node-entry');
    }
    const runner =
      RUNNERS.has(program) ||
      (program === 'npm' && rest[0] === 'exec') ||
      (['pnpm', 'yarn'].includes(program) && rest[0] === 'dlx');
    if (runner && rest.some((each) => specifier.test(each))) broken.add('npx-package');
    if (SHELLS.has(program)) {
      const at = rest.findIndex((each) => SHELL_PAYLOAD.test(each));
      if (at >= 0 && startsProduct(rest.slice(at + 1))) broken.add('wrapper-payload');
    }
    if (list && PREFIXES.has(program) && startsProduct(rest)) broken.add('wrapper-payload');
  }
  return broken;
}
