import { mkdirSync, mkdtempSync, realpathSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Writable } from 'node:stream';
import { type CliDeps, run } from '../../src/cli/program.ts';
import { WhatsAppContext, type WhatsAppContextOptions } from '../../src/context.ts';
import { WHATSAPP_GROUP_CONTAINER } from '../../src/source/location.ts';
import { buildFixtureStore, type Fixture, type FixtureOptions } from './fixture.ts';

/**
 * A temporary home, config and state directory, with a synthetic store where WhatsApp for Mac would keep its own.
 *
 * Everything is under one temporary directory, and the environment is built from nothing — not copied from
 * `process.env` — so no agent marker, no real HOME and no real config reach the code under test. Core's config is
 * written with the file secret store pinned, though this package never opens a secret store: a harness that could
 * reach the login keychain is one refactor away from writing to it.
 */

export function tempDir(prefix = 'agent-whatsapp-'): string {
  return realpathSync(mkdtempSync(join(tmpdir(), prefix)));
}

export interface CliRun {
  code: number;
  stdout: string;
  stderr: string;
  /** The `--json` envelope on stdout. */
  json(): { ok: boolean; data?: Record<string, unknown>; error?: Record<string, unknown> };
  /** The envelope's `data`, which must be there: the command succeeded. */
  data(): Record<string, unknown>;
}

export interface Harness {
  root: string;
  home: string;
  env: NodeJS.ProcessEnv;
  /** The container directory inside the temporary home. */
  container: string;
  /** Present unless the harness was made with `store: false`. */
  fixture: Fixture | null;
  context(options?: WhatsAppContextOptions): WhatsAppContext;
  cli(argv: readonly string[], deps?: CliDeps): Promise<CliRun>;
  /** `add` then `sync`, as a person would start. */
  ready(name?: string): Promise<void>;
}

class Capture extends Writable {
  text = '';
  override _write(chunk: Buffer, _encoding: BufferEncoding, done: () => void): void {
    this.text += chunk.toString('utf8');
    done();
  }
}

export async function newHarness(
  options: { store?: FixtureOptions | false; env?: NodeJS.ProcessEnv } = {},
): Promise<Harness> {
  const root = tempDir();
  const home = join(root, 'home');
  const configDir = join(root, 'config');
  mkdirSync(home, { recursive: true });
  mkdirSync(configDir, { recursive: true });
  writeFileSync(join(configDir, 'config.json'), `${JSON.stringify({ version: 2, secrets: { store: 'file' } })}\n`);
  const env: NodeJS.ProcessEnv = {
    HOME: home,
    AGENT_COMMS_CONFIG_DIR: configDir,
    AGENT_COMMS_STATE_DIR: join(root, 'state'),
    AGENT_COMMS_DATA_DIR: join(root, 'data'),
    NO_COLOR: '1',
    ...options.env,
  };
  const container = join(home, 'Library', 'Group Containers', WHATSAPP_GROUP_CONTAINER);
  const fixture = options.store === false ? null : await buildFixtureStore(container, options.store ?? {});

  const harness: Harness = {
    root,
    home,
    env,
    container,
    fixture,
    context: (extra = {}) => new WhatsAppContext({ env, ...extra }),
    async cli(argv, deps = {}) {
      const stdout = new Capture();
      const stderr = new Capture();
      const code = await run(argv, { env, streams: { stdout, stderr }, open: () => true, ...deps });
      return {
        code,
        stdout: stdout.text,
        stderr: stderr.text,
        json: () => JSON.parse(stdout.text),
        data: () => {
          const envelope = JSON.parse(stdout.text) as { ok: boolean; data?: Record<string, unknown> };
          if (!envelope.ok || !envelope.data) throw new Error(`expected a result, got: ${stdout.text}`);
          return envelope.data;
        },
      };
    },
    async ready(name = 'acme/whatsapp') {
      const added = await harness.cli(['add', name, '--json']);
      if (added.code !== 0) throw new Error(`add failed: ${added.stdout}${added.stderr}`);
      const synced = await harness.cli(['sync', '--account', name, '--json']);
      if (synced.code !== 0) throw new Error(`sync failed: ${synced.stdout}${synced.stderr}`);
    },
  };
  return harness;
}
