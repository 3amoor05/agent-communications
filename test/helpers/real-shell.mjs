/**
 * Shared fixtures for pasting a printed command into a real shell (CUE-403, design 2026-10-04 §4 items 3 and 8).
 *
 * A handoff is only runnable if a person can paste it into a terminal that has none of this suite on its PATH, none of
 * the printing process's environment, and another working folder — and it still reaches the installation, and the
 * folders, of the process that printed it. These fixtures build that shell:
 *
 * - **a PATH with no suite command on it** (`strippedPath`), checked against every command the packages install, read
 *   from their manifests rather than listed here (`suiteCommandsOn`);
 * - **an environment that disagrees** (`freshShell`): `AGENT_COMMS_*`, XDG, the home and Windows' AppData all point
 *   at decoy folders under the test's own, so a command that found its folders from the environment instead of its
 *   pins would leave a trace there (`suiteTraces`), and the working folder is another;
 * - **a seal** (`seal-process.mjs`, through `NODE_OPTIONS`): no system keychain and no connection off the machine, with
 *   every attempt written down (`sealAttempts`) — no provider and no real keychain is reached, and a test can say so;
 * - **the shells themselves**: `/bin/sh` (`posixShell`), a pseudo-terminal for the person's own commands such as
 *   `approve` (`posixTerminal`, `terminal.py`), and on Windows cmd.exe with delayed expansion, Windows PowerShell and,
 *   where installed, PowerShell 7 (`windowsShells`), as core's renderer tests run them.
 *
 * Root tests use it from `.mjs`; package tests import it with its types from `real-shell.d.mts`. Every folder it makes
 * is under the temporary folder a test gives it, and every write it makes is refused before it happens when its target
 * is in the real home (`fixtureWrites`): nothing here reads or writes the real home.
 */
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  openSync,
  readdirSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { delimiter, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { readChannels, SCOPE } from '../../scripts/channels.mjs';

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const TERMINAL = join(ROOT, 'test', 'helpers', 'terminal.py');
const SEAL = join(ROOT, 'test', 'helpers', 'seal-process.mjs');

/** The five path options, in the order the locator writes them, by the directory each pins. */
export const PATH_OPTIONS = Object.freeze({
  configDir: '--config-dir',
  stateDir: '--state-dir',
  dataDir: '--data-dir',
  secretsDir: '--secrets-dir',
  downloadsDir: '--downloads-dir',
});

/** The four every command opens unless it says otherwise (core's `HANDOFF_FOLDERS`). */
export const FOUR_FOLDERS = Object.freeze(['configDir', 'stateDir', 'dataDir', 'secretsDir']);

/**
 * Every command this suite installs on a machine: each package's `bin`, each channel manifest's `binary` and its
 * server's `bins` — read from `packages/*` as the tooling reads them (`scripts/channels.mjs`), so a new channel or a
 * new server wrapper is covered without an edit here.
 */
export const SUITE_COMMANDS = Object.freeze(
  (() => {
    const names = new Set();
    for (const { manifest } of readChannels()) {
      names.add(manifest.binary);
      for (const bin of manifest.server?.bins ?? []) names.add(bin);
    }
    for (const entry of readdirSync(join(ROOT, 'packages'), { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      let manifest;
      try {
        manifest = JSON.parse(readFileSync(join(ROOT, 'packages', entry.name, 'package.json'), 'utf8'));
      } catch {
        continue;
      }
      if (!String(manifest.name ?? '').startsWith(`${SCOPE}/`)) continue;
      const bins = typeof manifest.bin === 'string' ? [manifest.name.split('/')[1]] : Object.keys(manifest.bin ?? {});
      for (const bin of bins) names.add(bin);
    }
    return [...names].sort();
  })(),
);

const WINDOWS_EXTENSIONS = ['', '.cmd', '.exe', '.bat', '.ps1', '.com'];

/** Every suite command found in a folder of `pathValue`: what a PATH that is meant to have none must not have. */
export function suiteCommandsOn(pathValue, platform = process.platform) {
  const found = [];
  const separator = platform === 'win32' ? ';' : ':';
  for (const directory of String(pathValue ?? '')
    .split(separator)
    .filter(Boolean)) {
    for (const name of SUITE_COMMANDS) {
      for (const extension of platform === 'win32' ? WINDOWS_EXTENSIONS : ['']) {
        const candidate = join(directory, name + extension);
        if (existsSync(candidate)) found.push(candidate);
      }
    }
  }
  return found;
}

/**
 * A PATH with only the system's own folders: no Node, no npm, no suite command. A printed command names its Node and
 * its entry by absolute path, so it needs nothing from PATH; a bare `agentcomms …` would not be found.
 */
export function strippedPath(platform = process.platform) {
  if (platform !== 'win32') return ['/usr/bin', '/bin'].join(':');
  const system = process.env.SystemRoot ?? process.env.SYSTEMROOT ?? 'C:\\Windows';
  return [join(system, 'System32'), system, join(system, 'System32', 'WindowsPowerShell', 'v1.0')].join(';');
}

/** The Windows variables a process needs to start at all, from this process: nothing that names a suite folder. */
function windowsBase() {
  const base = {};
  for (const key of [
    'SystemRoot',
    'SYSTEMROOT',
    'windir',
    'SystemDrive',
    'ComSpec',
    'PATHEXT',
    'NUMBER_OF_PROCESSORS',
  ]) {
    if (process.env[key] !== undefined) base[key] = process.env[key];
  }
  return base;
}

/**
 * The environment every process here starts with: a stripped PATH, no colour, the update check off (it would ask npm),
 * no client CLI looked for outside PATH (a real `claude` or `codex` would be run), and the seal, writing to `sealLog`.
 * Built from nothing rather than from this process's environment: a coding agent's markers (`CLAUDECODE`) would make
 * `approve` refuse, and a token in it is not the shell's to see.
 */
export function baseEnvironment({ home, tmp, sealLog, platform = process.platform }) {
  return {
    ...(platform === 'win32' ? windowsBase() : {}),
    // A temporary folder of the test's own, under every name a platform reads it by.
    ...(tmp === undefined ? {} : { TMPDIR: tmp, TEMP: tmp, TMP: tmp }),
    PATH: strippedPath(platform),
    HOME: home,
    USERPROFILE: home,
    TERM: 'dumb',
    NO_COLOR: '1',
    AGENT_COMMS_UPDATE_CHECK: 'off',
    AGENT_COMMS_CLIENT_CLI_DIRS: '',
    NODE_OPTIONS: `--import=${pathToFileURL(SEAL).href}`,
    AGENTCOMMS_TEST_SEAL_LOG: sealLog,
  };
}

// ── The real home is never written ───────────────────────────────────────────────────────────────────────────────

/** Whether `path` is `root` or inside it, by whole segments; without case on Windows, as Windows finds files. */
function within(path, root) {
  const fold = (each) => (process.platform === 'win32' ? each.toLowerCase() : each);
  const from = relative(fold(resolve(root)), fold(resolve(path)));
  return from === '' || (!from.startsWith('..') && !isAbsolute(from));
}

/**
 * A folder as given and as the file system names it: Windows' short `RUNNER~1` and its long name, macOS's `/var` and
 * `/private/var`. A fixture's folders are real paths, and the system's temporary folder may be given as either.
 */
function bothForms(path) {
  const forms = [resolve(path)];
  try {
    forms.push(realpathSync.native(path));
  } catch {
    // Not there: only as given.
  }
  return forms;
}

/**
 * Refuses a path a fixture is about to write when it is in the real home: the home itself or anything in it, except the
 * system's temporary folder — which on Windows is inside the profile, and where every fixture here lives. Checked
 * before the call reaches the file system, so a refused write leaves nothing behind (design 2026-10-04 §4 item 9).
 * `home` and `temp` are the machine's own unless a test gives others.
 */
export function refuseRealHome(path, { home = homedir(), temp = tmpdir() } = {}) {
  if (bothForms(home).some((root) => within(path, root)) && !bothForms(temp).some((root) => within(path, root))) {
    throw new Error(
      `refused before writing: ${path} is in the real home, and a test writes only under its temp folder`,
    );
  }
}

/** Node's own synchronous writes, the ones `fixtureWrites` passes a checked call on to. */
const NODE_WRITES = Object.freeze({
  mkdir: mkdirSync,
  writeFile: writeFileSync,
  open: openSync,
  rename: renameSync,
  rm: rmSync,
});

/**
 * The writes every fixture here makes — `mkdir`, `writeFile`, `open`, `rename`, `rm` — each refused before it reaches
 * `fs` when its target (both, for a rename) is in the real home (`refuseRealHome`). `fs`, `home` and `temp` are for a
 * test of the guard itself, which gives a spy and a home of its own, and never names the machine's.
 */
export function fixtureWrites({ fs = NODE_WRITES, home, temp } = {}) {
  const where = { ...(home === undefined ? {} : { home }), ...(temp === undefined ? {} : { temp }) };
  const checked =
    (name, targets = 1) =>
    (...args) => {
      for (const target of args.slice(0, targets)) refuseRealHome(String(target), where);
      return fs[name](...args);
    };
  return Object.freeze({
    mkdir: checked('mkdir'),
    writeFile: checked('writeFile'),
    open: checked('open'),
    rename: checked('rename', 2),
    rm: checked('rm'),
  });
}

/** The writes the fixtures and the tests that use them make, on this machine. */
export const WRITES = fixtureWrites();

/**
 * A fresh shell's environment and working folder, under `root`: every suite folder the environment could name points
 * at a decoy, and so does every default those are derived from — `AGENT_COMMS_CONFIG_DIR`, `_STATE_DIR`, `_DATA_DIR`,
 * the XDG folders, the home, and Windows' `APPDATA` and `LOCALAPPDATA`. None is made: a command that used one would
 * make it, and `suiteTraces` finds it. `extra` is laid over the top (a client's own variables, a fake provider).
 */
export function freshShell(root, { platform = process.platform, extra = {}, writes = WRITES } = {}) {
  const decoys = join(root, 'decoys');
  const cwd = join(root, 'elsewhere');
  const tmp = join(root, 'tmp');
  writes.mkdir(cwd, { recursive: true });
  writes.mkdir(tmp, { recursive: true });
  const env = {
    ...baseEnvironment({ home: join(decoys, 'home'), tmp, sealLog: join(root, 'seal.jsonl'), platform }),
    XDG_CONFIG_HOME: join(decoys, 'xdg-config'),
    XDG_STATE_HOME: join(decoys, 'xdg-state'),
    XDG_DATA_HOME: join(decoys, 'xdg-data'),
    XDG_CACHE_HOME: join(decoys, 'xdg-cache'),
    APPDATA: join(decoys, 'appdata-roaming'),
    LOCALAPPDATA: join(decoys, 'appdata-local'),
    AGENT_COMMS_CONFIG_DIR: join(decoys, 'env-config'),
    AGENT_COMMS_STATE_DIR: join(decoys, 'env-state'),
    AGENT_COMMS_DATA_DIR: join(decoys, 'env-data'),
    ...extra,
  };
  return { env, cwd, decoys, sealLog: env.AGENTCOMMS_TEST_SEAL_LOG };
}

/** Every file under `dir`, relative to it; none when it is not there. */
export function filesUnder(dir) {
  if (!existsSync(dir)) return [];
  const found = [];
  const walk = (at) => {
    for (const entry of readdirSync(at, { withFileTypes: true })) {
      const path = join(at, entry.name);
      if (entry.isDirectory()) walk(path);
      else found.push(relative(dir, path));
    }
  };
  walk(dir);
  return found.sort();
}

/**
 * What a command left in a fresh shell's decoys that is not one of `expected` (paths relative to the decoys): a
 * command that found its suite folders from the environment rather than its pins writes there. A client's own files —
 * `home/.cursor/mcp.json` written by a registration the person ran — are named in `expected`.
 */
export function suiteTraces(shell, expected = []) {
  const allowed = new Set(expected.map((path) => path.split('/').join(sep)));
  return filesUnder(shell.decoys).filter((path) => !allowed.has(path) && !POWERSHELL_STARTUP_CACHE.test(path));
}

/**
 * The one file a shell itself leaves in the decoy home: Windows PowerShell's and PowerShell 7's startup-profile cache,
 * written under the profile's `AppData\Local` by `-NonInteractive` runs. It is the shell's own, not a suite folder, and
 * nothing else of PowerShell's — or under it — is let through.
 */
const POWERSHELL_STARTUP_CACHE =
  /^home[\\/]AppData[\\/]Local[\\/]Microsoft[\\/](?:Windows[\\/])?PowerShell[\\/]StartupProfileData-NonInteractive$/;

/** Every attempt the seal refused in processes writing to `sealLog`: a keychain, a connection, a lookup. */
export function sealAttempts(sealLog) {
  if (!existsSync(sealLog)) return [];
  return readFileSync(sealLog, 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

// ── Shells ────────────────────────────────────────────────────────────────────────────────────────────────────────

const RUN = { encoding: 'utf8', timeout: 120_000, maxBuffer: 16 * 1024 * 1024 };

/** A command run as it is printed — the CLI the test plays the printing process with, never a shell. */
export function runNode(args, { env, cwd, input }) {
  return spawnSync(process.execPath, args, { ...RUN, env, cwd, ...(input === undefined ? {} : { input }) });
}

/** `line` pasted into `/bin/sh`, with no terminal: what an agent runs. */
export function posixShell(line, { env, cwd }) {
  return spawnSync('/bin/sh', ['-c', line], { ...RUN, env, cwd, input: '' });
}

/**
 * A program run to its end without blocking this process: what a test needs when the program talks to a fake provider
 * this process serves (a synchronous spawn would hold the fake's event loop, and both would wait for ever).
 * `{ status, stdout, stderr }`, as `spawnSync` gives them.
 */
export function spawnAsync(program, args, { env, cwd, input = '' }) {
  return new Promise((settle, fail) => {
    const child = spawn(program, args, { env, cwd });
    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => child.kill(), RUN.timeout);
    child.stdout.on('data', (chunk) => {
      stdout += chunk;
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk;
    });
    child.once('error', fail);
    child.once('close', (status, signal) => {
      clearTimeout(timer);
      settle({ status, signal, stdout, stderr });
    });
    child.stdin.end(input);
  });
}

/** `runNode`, without blocking this process: see `spawnAsync`. */
export function runNodeAsync(args, options) {
  return spawnAsync(process.execPath, args, options);
}

/** `posixShell`, without blocking this process: see `spawnAsync`. */
export function posixShellAsync(line, options) {
  return spawnAsync('/bin/sh', ['-c', line], options);
}

/** Python 3 with `pty`, found on this process's PATH, or null: what `posixTerminal` runs the shell under. */
export const TERMINAL_PYTHON = (() => {
  if (process.platform === 'win32') return null;
  for (const directory of String(process.env.PATH ?? '').split(delimiter)) {
    const candidate = join(directory, 'python3');
    if (!existsSync(candidate)) continue;
    const probe = spawnSync(candidate, ['-c', 'import pty, os; os.waitstatus_to_exitcode'], RUN);
    if (probe.status === 0) return candidate;
  }
  return null;
})();

/** A test option: skipped where there is no pseudo-terminal to paste a person's command into. */
export const NEEDS_TERMINAL = TERMINAL_PYTHON
  ? {}
  : { skip: 'needs a POSIX shell and python3 with pty, to give the person a terminal' };

/**
 * `line` pasted into `/bin/sh` at a terminal, as the person runs their own commands: both ends are a terminal, and
 * when the command asks for its code it is typed back (`answer: 'challenge'`), or Enter is pressed (`'enter'`); asked
 * where a download is saved, Enter takes its default folder (`'save'`).
 */
export function posixTerminal(line, { env, cwd, answer = 'challenge' }) {
  if (!TERMINAL_PYTHON) throw new Error('no pseudo-terminal here: see NEEDS_TERMINAL');
  return spawnSync(TERMINAL_PYTHON, [TERMINAL, answer, '/bin/sh', '-c', line], { ...RUN, env, cwd });
}

/** `posixTerminal`, without blocking this process: see `spawnAsync`. */
export function posixTerminalAsync(line, { env, cwd, answer = 'challenge' }) {
  if (!TERMINAL_PYTHON) throw new Error('no pseudo-terminal here: see NEEDS_TERMINAL');
  return spawnAsync(TERMINAL_PYTHON, [TERMINAL, answer, '/bin/sh', '-c', line], { env, cwd });
}

/** A test option: only where cmd.exe and PowerShell are, the release run's windows-latest legs. */
export const ON_WINDOWS = process.platform === 'win32' ? {} : { skip: 'needs cmd.exe and PowerShell, so Windows' };

/** Only off Windows: a POSIX shell. */
export const ON_POSIX = process.platform === 'win32' ? { skip: 'needs a POSIX shell' } : {};

/** PowerShell 7's own path, found on this process's PATH: the shell's stripped PATH does not hold it. */
function pwshPath() {
  for (const directory of String(process.env.PATH ?? process.env.Path ?? '').split(';')) {
    const candidate = join(directory, 'pwsh.exe');
    if (directory && existsSync(candidate)) return candidate;
  }
  return null;
}

/**
 * The shells a person on Windows pastes a line into, each running it once: cmd.exe as a typed line (`/d /v:on /s /c
 * "…"`: no AutoRun, delayed expansion on), Windows PowerShell and, where installed, PowerShell 7 — each given the line
 * encoded, so nothing on their own command line changes it. As core's renderer tests run them (`cli.test.ts`).
 */
export function windowsShells() {
  const system = process.env.SystemRoot ?? 'C:\\Windows';
  const encoded = (line) => Buffer.from(line, 'utf16le').toString('base64');
  /*
   * PowerShell run with `-EncodedCommand` exits 0 or 1 by whether the script failed, not with the code of the program
   * the line started; a person reads that code from `$LASTEXITCODE`. So the script ends by exiting with it — and with 1
   * when no program ran at all, which is no success. The line itself is the first statement, unchanged.
   */
  const exitWithProgram = '\nexit $(if ($null -eq $LASTEXITCODE) { 1 } else { $LASTEXITCODE })';
  const powershell = (program) => (line, options) =>
    spawnSync(program, ['-NoProfile', '-NonInteractive', '-EncodedCommand', encoded(`${line}${exitWithProgram}`)], {
      ...RUN,
      ...options,
      input: '',
    });
  const shells = [
    {
      name: 'cmd.exe',
      run: (line, options) =>
        spawnSync(join(system, 'System32', 'cmd.exe'), ['/d', '/v:on', '/s', '/c', `"${line}"`], {
          ...RUN,
          ...options,
          input: '',
          windowsVerbatimArguments: true,
        }),
    },
    {
      name: 'Windows PowerShell',
      run: powershell(join(system, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe')),
    },
  ];
  const pwsh = pwshPath();
  if (pwsh) shells.push({ name: 'PowerShell 7', run: powershell(pwsh) });
  return shells;
}

/**
 * A printed command run in each Windows shell (`shells`, all of them unless given) — or, where the renderer gave its
 * words as JSON because no line is safe in every shell (D3's second outcome: on a default Windows install, a Node
 * under `C:\\Program Files`), those words as a person types them. `check(result, name)` judges each run.
 */
export function inWindowsShells(command, shell, check, shells = windowsShells()) {
  const words = wordsOf(command, 'win32');
  if (words === null) {
    const typed = JSON.parse(command);
    check(spawnSync(typed[0], typed.slice(1), { ...RUN, env: shell.env, cwd: shell.cwd, input: '' }), 'typed');
    return;
  }
  for (const each of shells) check(each.run(command, { env: shell.env, cwd: shell.cwd }), each.name);
}

/**
 * A pasted `approve` on Windows, where no test can give a person a terminal: in each shell it refuses for want of one,
 * and names the command to run instead — made by the pasted process from its own folders. It names the very words that
 * were pasted only when the pins decided its folders, not the shell's decoys.
 */
export function refusesWithoutATerminal(approve, shell, tail) {
  inWindowsShells(approve, shell, (result, name) => {
    const said = `${result.stdout}${result.stderr}`;
    assert.match(said, /needs an interactive terminal/, `${name}: ${said}`);
    assert.deepEqual(
      argvOf(commandEndingWith(said, tail, 'win32'), 'win32'),
      argvOf(approve, 'win32'),
      `${name}: the refusal names the command that was pasted`,
    );
  });
}

// ── A server, as a client starts it ──────────────────────────────────────────────────────────────────────────────

/**
 * An MCP server started as a client starts it — its command, its arguments and its environment — with a minimal
 * client over stdio: `call(tool, arguments)` gives the tool's `structuredContent`. A Windows `.cmd` (npm's, or a
 * test's npx) is started through cmd.exe, as a client starts one.
 */
export function startMcpServer(command, args, { env, cwd }) {
  const windowsScript = process.platform === 'win32' && /\.(?:cmd|bat)$/i.test(command);
  const quote = (word) => (/[\s"&|<>^]/.test(word) ? `"${word}"` : word);
  const child = windowsScript
    ? spawn(env.ComSpec ?? 'cmd.exe', ['/d', '/s', '/c', `"${[command, ...args].map(quote).join(' ')}"`], {
        env,
        cwd,
        windowsVerbatimArguments: true,
      })
    : spawn(command, args, { env, cwd });
  let buffer = '';
  let stderr = '';
  let next = 0;
  const waiting = new Map();
  child.stderr.on('data', (chunk) => {
    stderr += chunk;
  });
  child.stdout.on('data', (chunk) => {
    buffer += chunk;
    for (let end = buffer.indexOf('\n'); end !== -1; end = buffer.indexOf('\n')) {
      const message = JSON.parse(buffer.slice(0, end));
      buffer = buffer.slice(end + 1);
      waiting.get(message.id)?.(message);
    }
  });
  const exited = new Promise((settle) => child.once('exit', settle));
  const request = (method, params) =>
    new Promise((settle, fail) => {
      next += 1;
      const id = next;
      const timer = setTimeout(() => fail(new Error(`no answer to ${method}: ${stderr}`)), 60_000);
      waiting.set(id, (message) => {
        clearTimeout(timer);
        if (message.error) fail(new Error(`${method}: ${JSON.stringify(message.error)}\n${stderr}`));
        else settle(message.result);
      });
      child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`);
    });
  const ready = request('initialize', {
    protocolVersion: '2025-06-18',
    capabilities: {},
    clientInfo: { name: 'cue-403-real-shell', version: '0' },
  }).then(() => child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' })}\n`));
  return {
    async call(name, args) {
      await ready;
      const result = await request('tools/call', { name, arguments: args });
      return result.structuredContent ?? JSON.parse(result.content?.[0]?.text ?? 'null');
    },
    async close() {
      child.stdin.end();
      child.kill();
      await exited;
    },
  };
}

// ── Reading what was printed ──────────────────────────────────────────────────────────────────────────────────────

/** The commands a text gives in backticks, in order. */
export function commandsIn(text) {
  return [...String(text).matchAll(/`([^`]+)`/g)].map((match) => match[1]);
}

/** The one command in `text` whose words end with `tail` (words after the program), or a failure naming the text. */
export function commandEndingWith(text, tail, platform = process.platform) {
  const found = commandsIn(text).filter((command) => {
    const words = argvOf(command, platform);
    return words !== null && words.slice(-tail.length).join('\0') === tail.join('\0');
  });
  if (found.length !== 1) {
    throw new Error(`expected one command ending in "${tail.join(' ')}", found ${found.length} in: ${text}`);
  }
  return found[0];
}

/**
 * The words of a printed line, read back as its shell reads it — enough for what the locator prints: POSIX single
 * quotes (with `'\''` inside), or on Windows double quotes around a word with no quote in it. Null for the JSON form,
 * which is not a line.
 */
export function wordsOf(line, platform = process.platform) {
  if (line.startsWith('[')) return null;
  if (platform === 'win32') return [...line.matchAll(/"([^"]*)"|(\S+)/g)].map((m) => m[1] ?? m[2]);
  return [...line.matchAll(/'((?:[^']|'\\'')*)'|(\S+)/g)].map((m) =>
    m[1] !== undefined ? m[1].replaceAll("'\\''", "'") : m[2],
  );
}

/**
 * A printed command's words: its line read as its shell reads it, or — the JSON form, D3's second outcome — the words
 * it gives to type. Null for text that is neither.
 */
export function argvOf(command, platform = process.platform) {
  const words = wordsOf(command, platform);
  if (words !== null) return words;
  try {
    const typed = JSON.parse(command);
    return Array.isArray(typed) && typed.every((word) => typeof word === 'string') ? typed : null;
  } catch {
    return null;
  }
}

/** The path options among `words` before any `--`, by the directory each pins: what a printed command carries. */
export function pinsOf(words) {
  const byFlag = Object.fromEntries(Object.entries(PATH_OPTIONS).map(([key, flag]) => [flag, key]));
  const pins = {};
  for (let index = 0; index < words.length; index += 1) {
    const word = words[index];
    if (word === '--') break;
    if (byFlag[word] !== undefined) {
      if (Object.hasOwn(pins, byFlag[word])) throw new Error(`${word} twice in ${JSON.stringify(words)}`);
      pins[byFlag[word]] = words[index + 1];
      index += 1;
    }
  }
  return pins;
}

/**
 * No environment assignment anywhere in `text`: no `NAME=value` before a command, no `env`, `set` or `$env:`. The
 * folders travel as options (D2); a printed `AGENT_COMMS_CONFIG_DIR=…` would only work in one shell, and would change
 * how the other folders are derived.
 */
export function environmentAssignments(text) {
  const found = [];
  for (const command of commandsIn(text)) {
    const first = command.trimStart().split(/\s+/)[0] ?? '';
    if (/^[A-Za-z_][A-Za-z0-9_]*=/.test(first) || /^(?:env|set|export)$/i.test(first)) found.push(command);
  }
  for (const match of String(text).matchAll(/\b(?:AGENT_COMMS|XDG)_[A-Z_]+=|\$env:/gi)) found.push(match[0]);
  return found;
}

/** The real path of a folder, so a pin compares with what the locator printed (macOS `/var` is `/private/var`). */
export function real(path) {
  return realpathSync.native(path);
}

/** A built CLI of this checkout, `packages/<directory>/dist/cli.mjs`: `pnpm build` makes it, before `pnpm test`. */
export function builtCli(directory) {
  const entry = join(ROOT, 'packages', directory, 'dist', 'cli.mjs');
  if (!existsSync(entry) || !statSync(entry).isFile()) {
    throw new Error(`${entry} is not built: run \`pnpm build\` first (pnpm verify builds before it tests)`);
  }
  return real(entry);
}

/** Whether `path` is absolute and canonical: no relative part, no doubled or trailing separator but a root's. */
export function isCanonical(path) {
  return isAbsolute(path) && resolve(path) === path;
}
