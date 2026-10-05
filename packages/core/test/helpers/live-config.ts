import { mkdirSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { type ChangePolicy, type Config, ConfigStore, type SendPolicy } from '../../src/config.ts';

/**
 * The configuration a test's approval store classifies by (design 2026-10-05 §D2): a store's every claim, approval and
 * answer reads its live gate — the owner, its policies, its send epoch — from here, under the record's lock.
 *
 * Written straight to the file, as a person's edit or another release's write would be, so a test can put the
 * configuration in any state — a policy turned to `never` without its epoch, an owner removed — without going through
 * `ConfigStore.update`, whose own rules are tested elsewhere.
 */

export interface LiveOwner {
  readonly id: string;
  readonly sendPolicy?: SendPolicy | undefined;
  readonly changePolicy?: ChangePolicy | undefined;
  /** For an account: its platform. Slack when left out. */
  readonly platform?: string | undefined;
}

export interface LiveConfigState {
  readonly sendPolicy?: SendPolicy | undefined;
  readonly changePolicy?: ChangePolicy | undefined;
  /** Mailboxes by name; `ibx_` ids. */
  readonly inboxes?: Readonly<Record<string, LiveOwner>> | undefined;
  /** Accounts by name; `acc_` ids. */
  readonly accounts?: Readonly<Record<string, LiveOwner>> | undefined;
  readonly sendEpochs?: Readonly<Record<string, number>> | undefined;
}

export interface LiveConfig {
  readonly dir: string;
  readonly store: ConfigStore;
  /** The loader a store is opened with: `() => store.load()`, counted. */
  readonly loadConfig: () => Promise<Config>;
  /** How many times the loader has been called. */
  loads(): number;
  /** Replaces the configuration with `state`. */
  write(state: LiveConfigState): void;
}

const CREATED = '2026-09-01T00:00:00.000Z';

function body(state: LiveConfigState): Record<string, unknown> {
  const inboxes = Object.fromEntries(
    Object.entries(state.inboxes ?? {}).map(([name, owner]) => [
      name,
      {
        id: owner.id,
        provider: 'gmail',
        email: `${owner.id.slice(4, 8).toLowerCase()}@acme.test`,
        identity: 'oidc',
        client: 'desktop',
        tier: 'send',
        grantedScopes: [],
        secretRef: `gmail:refresh:${owner.id}`,
        internalDomains: ['acme.test'],
        createdAt: CREATED,
        ...(owner.sendPolicy === undefined ? {} : { sendPolicy: owner.sendPolicy }),
        ...(owner.changePolicy === undefined ? {} : { changePolicy: owner.changePolicy }),
      },
    ]),
  );
  const accounts = Object.fromEntries(
    Object.entries(state.accounts ?? {}).map(([name, owner]) => [
      name,
      {
        id: owner.id,
        platform: owner.platform ?? 'slack',
        workspace: 'T_ACME',
        userId: 'U_ME',
        tier: 'send',
        mode: 'send',
        grantedScopes: [],
        secretRef: `${owner.platform ?? 'slack'}:none:${owner.id}`,
        createdAt: CREATED,
        ...(owner.sendPolicy === undefined ? {} : { sendPolicy: owner.sendPolicy }),
        ...(owner.changePolicy === undefined ? {} : { changePolicy: owner.changePolicy }),
      },
    ]),
  );
  return {
    version: 3,
    naming: 2,
    clients: {
      desktop: { provider: 'google', clientId: 'x', secretRef: 'gmail:client:desktop', addedAt: CREATED },
    },
    inboxes,
    accounts,
    defaults: {
      sendPolicy: state.sendPolicy ?? 'chat',
      ...(state.changePolicy === undefined ? {} : { changePolicy: state.changePolicy }),
    },
    ...(state.sendEpochs === undefined ? {} : { sendEpochs: state.sendEpochs }),
  };
}

/** A configuration under `dir/config`, holding `state`, and the counted loader a store reads it through. */
export function liveConfig(dir: string, state: LiveConfigState): LiveConfig {
  const configDir = join(dir, 'config');
  mkdirSync(configDir, { recursive: true });
  const store = new ConfigStore(configDir);
  let loads = 0;
  const handle: LiveConfig = {
    dir: configDir,
    store,
    loadConfig: () => {
      loads += 1;
      return store.load();
    },
    loads: () => loads,
    // By rename, as every write to it is: a new file each time, so no read can take it for the one before.
    write: (next) => {
      const staged = `${store.path}.${process.pid}.test`;
      writeFileSync(staged, `${JSON.stringify(body(next), null, 2)}\n`);
      renameSync(staged, store.path);
    },
  };
  handle.write(state);
  return handle;
}
