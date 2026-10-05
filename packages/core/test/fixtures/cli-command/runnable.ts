import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { shortName, writeFile, writePackage } from './trees.ts';

/*
 * Installations whose CLI really runs, for the time-of-print cases (design 2026-10-04, D6): an entry that says which
 * fixture it is, an npx cache, a preloader that leaves a mark, and a way to run a printed command's words exactly as a
 * person's shell would hand them to the program — with no shell, so nothing but the words decides what runs.
 */

/** An entry that prints, as JSON, which fixture it is and the words it was given. */
export function writeRunnable(path: string, fixture: string): string {
  return writeFile(
    path,
    `process.stdout.write(JSON.stringify({ fixture: ${JSON.stringify(fixture)}, args: process.argv.slice(2) }));\n`,
  );
}

/**
 * The cache npx leaves for a package it ran — `<home>/.npm/_npx/<hash>/node_modules/@agentcomms/<name>` — holding that
 * package, whose CLI runs and says it is `fixture`. `cache` is the whole `<hash>` directory npx may evict.
 */
export function writeNpxCache(
  home: string,
  channel: string,
  hash: string,
  fixture: string,
): { cache: string; root: string; entry: string } {
  const cache = join(home, '.npm', '_npx', hash);
  const root = writePackage(join(cache, 'node_modules', '@agentcomms', shortName(channel)), channel, { files: [] });
  const entry = writeRunnable(join(root, 'dist', 'cli.mjs'), fixture);
  return { cache, root, entry };
}

/**
 * A module that only leaves a mark when Node loads it: what a hostile `NODE_OPTIONS=--require …` in somebody's shell
 * would run before any CLI. It changes nothing else, so a test can see that it ran and that nothing else differed.
 */
export function writePreloader(dir: string, name = 'hostile.cjs'): { path: string; loaded: () => boolean } {
  const marker = join(dir, `${name}.loaded`);
  const path = writeFile(
    join(dir, name),
    `require('node:fs').appendFileSync(${JSON.stringify(marker)}, String(process.pid) + '\\n');\n`,
  );
  return { path, loaded: () => existsSync(marker) };
}

/**
 * The environment a printed command is run in here: `PATH` as given and nothing of this process's own, but what
 * Windows needs to start a program at all.
 */
export function bareEnv(extra: Record<string, string> = {}): NodeJS.ProcessEnv {
  return {
    PATH: '',
    ...(process.env.SystemRoot === undefined ? {} : { SystemRoot: process.env.SystemRoot }),
    ...extra,
  };
}

/** Runs a printed command's words as the program receives them: no shell, in `env`. */
export function runPrinted(
  command: { readonly words: readonly string[] },
  env: NodeJS.ProcessEnv = bareEnv(),
): { status: number | null; stdout: string; stderr: string } {
  const [program, ...args] = command.words;
  const ran = spawnSync(program as string, args, { encoding: 'utf8', env });
  if (ran.error && (ran.error as NodeJS.ErrnoException).code !== 'ENOENT') throw ran.error;
  return { status: ran.status, stdout: ran.stdout ?? '', stderr: ran.stderr ?? '' };
}
