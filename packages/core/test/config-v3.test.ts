import assert from 'node:assert/strict';
import { type ChildProcess, fork } from 'node:child_process';
import { mkdirSync, readFileSync, utimesSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { setTimeout as sleep } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { deriveLegacyV1State } from '../src/approval-legacy.ts';
import { ApprovalStore } from '../src/approvals.ts';
import { type Config, ConfigStore, type ConfigV3, parseConfig } from '../src/config.ts';
import { CONVERSION_HOOKS, type ConversionHooks } from '../src/config-hooks.ts';
import { openCore } from '../src/core.ts';
import { CommsError } from '../src/errors.ts';
import { CORE_CALLER } from '../src/handoffs.ts';
import { doctor } from '../src/operations/maintenance.ts';
import { ensureSendEpochConfig, LEGACY_DRAIN_MS, LEGACY_DRAIN_REASON, sendEpochOf } from '../src/send-epoch.ts';
import { readV1Record, v1SendRecord, writeV1Record } from './fixtures/approval-v1-0.13.0.ts';
import { tempDir } from './helpers/temp.ts';

/*
 * Config version 3 (CUE-404 Task 4; design 2026-10-05 §D1 and §4 departure 0): the per-owner send epoch, the one door
 * that converts to it, and the drain that retires every approval an earlier release left waiting.
 */

const T = Date.parse('2026-10-05T10:00:00.000Z');
const MIN = 60_000;
const id = (c: string) => `ap_${'0'.repeat(25)}${c}`;
const GMAIL = 'ibx_AAAAAAAAAAAAAAAA';
const GMAIL_INHERITS = 'ibx_BBBBBBBBBBBBBBBB';
const SLACK = 'acc_SSSSSSSSSSSSSSSS';
const RESEND = 'acc_RRRRRRRRRRRRRRRR';

function inbox(inboxId: string, over: Record<string, unknown> = {}) {
  return {
    id: inboxId,
    provider: 'gmail',
    email: 'jo@acme.test',
    identity: 'oidc',
    client: 'desktop',
    tier: 'send',
    grantedScopes: [],
    secretRef: `gmail:refresh:${inboxId}`,
    internalDomains: ['acme.test'],
    createdAt: '2026-09-01T00:00:00.000Z',
    ...over,
  };
}

function account(accountId: string, platform: string, over: Record<string, unknown> = {}) {
  return {
    id: accountId,
    platform,
    workspace: 'T_ACME',
    userId: 'U_ME',
    tier: 'send',
    mode: 'send',
    grantedScopes: [],
    secretRef: `${platform}:none:${accountId}`,
    createdAt: '2026-09-01T00:00:00.000Z',
    ...over,
  };
}

/** Two mailboxes and two accounts: one of each with a send policy of its own, one of each inheriting the default. */
function body(version: 1 | 2 = 2, extra: Record<string, unknown> = {}) {
  const names =
    version === 2
      ? { gmail: 'acme/gmail', gmail2: 'acme/gmail-2', slack: 'acme/slack', resend: 'acme/resend' }
      : { gmail: 'work', gmail2: 'home', slack: 'team', resend: 'mail' };
  return {
    version,
    clients: {
      desktop: {
        provider: 'google',
        clientId: 'x',
        secretRef: 'gmail:client:desktop',
        addedAt: '2026-09-01T00:00:00.000Z',
      },
    },
    inboxes: {
      [names.gmail]: inbox(GMAIL, { sendPolicy: 'chat' }),
      [names.gmail2]: inbox(GMAIL_INHERITS, { email: 'sam@acme.test' }),
    },
    accounts: {
      [names.slack]: account(SLACK, 'slack'),
      [names.resend]: account(RESEND, 'resend', { sendPolicy: 'confirm' }),
    },
    defaults: { sendPolicy: 'chat' },
    ...extra,
  };
}

function clock(start = T) {
  let t = start;
  return { now: () => new Date(t), set: (ms: number) => (t = ms) };
}

/** A machine: its config written as given, and a core over it on `time`. */
function machine(config: Record<string, unknown> = body(), time = clock()) {
  const home = tempDir('comms-v3-');
  const configDir = join(home, 'config');
  const env = { HOME: home, USERPROFILE: home, AGENT_COMMS_CONFIG_DIR: configDir, AGENT_COMMS_UPDATE_CHECK: 'off' };
  mkdirSync(configDir, { recursive: true });
  const core = openCore({ env, now: time.now, caller: CORE_CALLER });
  writeFileSync(core.config.path, `${JSON.stringify(config, null, 2)}\n`);
  return { home, env, core, time, file: core.config.path };
}

/** A version-1 send record, `pending` unless said otherwise, made a minute before T. */
function v1(approvalId: string, over: Record<string, unknown> = {}) {
  return {
    ...v1SendRecord({
      approvalId,
      inboxId: GMAIL,
      inboxSub: 'sub-1',
      draftId: `r-${approvalId.slice(-1)}`,
      draftMessageId: 'msg-v1',
      digest: 'a'.repeat(64),
      expect: { to: ['sam@partner.test'], cc: [], bcc: [], subject: 'Re: plan' },
      createdAt: new Date(T - MIN).toISOString(),
    }),
    ...over,
  };
}

const read = (file: string) => JSON.parse(readFileSync(file, 'utf8')) as Record<string, unknown>;
const drainOf = (file: string) =>
  read(file).legacyDrain as { since: string; tracked: Record<string, string> } | undefined;

/** What the drain's scan tracks: every version-1 send record still pending or approved by its own rules. */
async function scanOf(store: ApprovalStore): Promise<Record<string, 'open'>> {
  const listed = await store.list({ states: ['pending', 'approved'] });
  return Object.fromEntries(
    listed.flatMap((stored) =>
      stored.form === 'legacy' && stored.view.kind === 'send' ? [[stored.view.approvalId, 'open' as const]] : [],
    ),
  );
}

/** A send-policy write with the consent a claimed change approval would hand over. */
function setSendPolicy(name: string, kind: 'inboxes' | 'accounts', to: 'chat' | 'confirm' | 'never') {
  return (config: Config): Config => {
    const map = config[kind] as unknown as Record<string, Record<string, unknown>>;
    return { ...config, [kind]: { ...map, [name]: { ...map[name], sendPolicy: to } } } as Config;
  };
}
const consent = (paths: string[]) => ({ consent: { kind: 'loosening-consent' as const, paths } });

// ── The door ────────────────────────────────────────────────────────────────────────────────────────────────────

test('a version-2 config becomes version 3 in one locked write before any send operation, renaming nothing; again it is a no-op', async () => {
  const m = machine();
  // As this release reads it, defaults filled in: what an ordinary write would have written.
  const before = parseConfig(readFileSync(m.file, 'utf8')) as unknown as Record<string, unknown>;
  const converted = await ensureSendEpochConfig(m.core, { now: m.time.now });
  assert.equal(converted.config.version, 3);
  const after = read(m.file);
  assert.deepEqual(after, { ...before, version: 3, naming: 2 }, 'only the version, and how it names its accounts');
  assert.equal('legacyDrain' in after, false, 'nothing to retire, so no drain');
  assert.equal(converted.legacyDrain, undefined);
  const bytes = readFileSync(m.file, 'utf8');
  const again = await ensureSendEpochConfig(m.core, { now: m.time.now });
  assert.equal(again.config.version, 3);
  assert.equal(readFileSync(m.file, 'utf8'), bytes, 'converting again writes nothing');
});

test('a version-1 config converts to version 3 with naming 1, and keeps its plain names', async () => {
  const m = machine(body(1));
  await ensureSendEpochConfig(m.core, { now: m.time.now });
  const after = read(m.file);
  assert.equal(after.version, 3);
  assert.equal(after.naming, 1);
  assert.deepEqual(Object.keys(after.inboxes as object).sort(), ['home', 'work']);
  assert.equal((await m.core.config.load()).version, 3);
});

test('version 3 is never written back as version 2, and its unknown keys survive every write', async () => {
  const m = machine(body(2, { laterRelease: { kept: true } }));
  await ensureSendEpochConfig(m.core, { now: m.time.now });
  const raw = read(m.file);
  raw.defaults = { ...(raw.defaults as object), laterDefault: 'kept' };
  writeFileSync(m.file, `${JSON.stringify(raw, null, 2)}\n`);
  await m.core.config.update((config) => ({ ...config, defaults: { ...config.defaults, timezone: 'Europe/London' } }));
  const after = read(m.file);
  assert.equal(after.version, 3);
  assert.equal(after.naming, 2);
  assert.deepEqual(after.laterRelease, { kept: true });
  assert.equal((after.defaults as Record<string, unknown>).laterDefault, 'kept');
  await assert.rejects(
    m.core.config.update((config) => ({ ...config, version: 2 }) as unknown as Config),
    (e: unknown) => e instanceof CommsError && /refusing to change the config version from 3 to 2/.test(e.message),
  );
  await assert.rejects(
    m.core.config.update((config) => ({ ...config, naming: 1 }) as unknown as Config),
    (e: unknown) =>
      e instanceof CommsError && /refusing to change how the configuration names its accounts/.test(e.message),
  );
  assert.equal(read(m.file).version, 3);
});

test('before version 3, a send policy of an existing owner never moves; a new owner may bring one', async () => {
  for (const version of [1, 2] as const) {
    const m = machine(body(version));
    const name = version === 2 ? 'acme/gmail' : 'work';
    await assert.rejects(
      m.core.config.update(setSendPolicy(name, 'inboxes', 'never')),
      (e: unknown) => e instanceof CommsError && /before the configuration is version 3/.test(e.message),
      `version ${version}: a tightening`,
    );
    await assert.rejects(
      m.core.config.update((config) => ({ ...config, defaults: { ...config.defaults, sendPolicy: 'never' } })),
      /before the configuration is version 3/,
      `version ${version}: the default an owner inherits`,
    );
    const added = version === 2 ? 'acme/gmail-3' : 'third';
    await m.core.config.update(
      (config) =>
        ({
          ...config,
          inboxes: {
            ...config.inboxes,
            [added]: inbox('ibx_CCCCCCCCCCCCCCCC', { email: 'kim@acme.test', sendPolicy: 'never' }),
          },
        }) as Config,
    );
    assert.equal(read(m.file).version, version);
  }
});

// ── The send epoch ──────────────────────────────────────────────────────────────────────────────────────────────

test('a default-policy change to never raises the epoch of every owner that inherits it, and of no other', async () => {
  const m = machine();
  await ensureSendEpochConfig(m.core, { now: m.time.now });
  const written = await m.core.config.update((config) => ({
    ...config,
    defaults: { ...config.defaults, sendPolicy: 'never' },
  }));
  // acme/gmail-2 and acme/slack inherit; acme/gmail (chat) and acme/resend (confirm) have their own.
  assert.deepEqual(read(m.file).sendEpochs, { [GMAIL_INHERITS]: 1, [SLACK]: 1 });
  assert.equal(sendEpochOf(written, GMAIL), 0);
  assert.equal(sendEpochOf(written, RESEND), 0);
  assert.equal(sendEpochOf(written, SLACK), 1);
});

test('an owner’s own change to never raises its own epoch only, once per change', async () => {
  const m = machine();
  await ensureSendEpochConfig(m.core, { now: m.time.now });
  await m.core.config.update(setSendPolicy('acme/resend', 'accounts', 'never'));
  assert.deepEqual(read(m.file).sendEpochs, { [RESEND]: 1 });
  // Never again while it stays never; again after it moved away and back.
  await m.core.config.update((config) => ({ ...config, defaults: { ...config.defaults, timezone: 'UTC' } }));
  assert.deepEqual(read(m.file).sendEpochs, { [RESEND]: 1 });
  await m.core.config.update(
    setSendPolicy('acme/resend', 'accounts', 'confirm'),
    consent(['accounts.acme/resend.sendPolicy']),
  );
  await m.core.config.update(setSendPolicy('acme/resend', 'accounts', 'never'));
  assert.deepEqual(read(m.file).sendEpochs, { [RESEND]: 2 });
});

test('loosening leaves every epoch as it is, whatever the write says', async () => {
  const m = machine();
  await ensureSendEpochConfig(m.core, { now: m.time.now });
  await m.core.config.update((config) => ({ ...config, defaults: { ...config.defaults, sendPolicy: 'never' } }));
  await m.core.config.update(setSendPolicy('acme/gmail', 'inboxes', 'never'));
  const fenced = read(m.file).sendEpochs;
  assert.deepEqual(fenced, { [GMAIL]: 1, [GMAIL_INHERITS]: 1, [SLACK]: 1 });
  await m.core.config.update(
    (config) => ({ ...config, defaults: { ...config.defaults, sendPolicy: 'chat' } }),
    consent(['defaults.sendPolicy', 'inboxes.acme/gmail-2.sendPolicy', 'accounts.acme/slack.sendPolicy']),
  );
  await m.core.config.update(
    setSendPolicy('acme/gmail', 'inboxes', 'chat'),
    consent(['inboxes.acme/gmail.sendPolicy']),
  );
  assert.deepEqual(read(m.file).sendEpochs, fenced, 'loosening lowered nothing');
  // And a write that tries to lower one is not believed.
  await m.core.config.update((config) => ({ ...config, sendEpochs: { [GMAIL]: 0 } }) as Config);
  assert.deepEqual(read(m.file).sendEpochs, fenced);
});

// ── The legacy drain ────────────────────────────────────────────────────────────────────────────────────────────

test('a version-3 config with no version-1 records never gains a legacy drain', async () => {
  const m = machine();
  await ensureSendEpochConfig(m.core, { now: m.time.now });
  await ensureSendEpochConfig(m.core, { now: m.time.now });
  await m.core.config.update(setSendPolicy('acme/gmail', 'inboxes', 'never'));
  assert.equal(drainOf(m.file), undefined);
});

test('historical used, failed, revoked and expired version-1 records are never tracked', async () => {
  const m = machine();
  writeV1Record(m.core.paths.stateDir, v1(id('1'), { state: 'used', sentMessageId: 's-1' }));
  writeV1Record(m.core.paths.stateDir, v1(id('2'), { state: 'failed', reason: 'backendError' }));
  writeV1Record(m.core.paths.stateDir, v1(id('3'), { state: 'revoked', reason: 'cancelled' }));
  // Stored pending, and past its original deadline: expired by its own release's rules.
  writeV1Record(
    m.core.paths.stateDir,
    v1(id('4'), {
      createdAt: new Date(T - 20 * MIN).toISOString(),
      expiresAt: new Date(T - 10 * MIN).toISOString(),
      updatedAt: new Date(T - 20 * MIN).toISOString(),
    }),
  );
  const result = await ensureSendEpochConfig(m.core, { now: m.time.now });
  assert.equal(read(m.file).version, 3);
  assert.equal(drainOf(m.file), undefined, 'nothing is tracked, so no drain');
  assert.equal(result.legacyDrain, undefined);
});

test('a crash after the version-3 write with one revocation failed, then a restart: the set survives, is retried, and loosening waits for it', async () => {
  const time = clock();
  const m = machine(body(2), time);
  // acme/gmail sends under never, so that loosening it is the write the drain must refuse.
  writeFileSync(
    m.file,
    `${JSON.stringify({ ...body(2), inboxes: { ...body(2).inboxes, 'acme/gmail': inbox(GMAIL, { sendPolicy: 'never' }) } }, null, 2)}\n`,
  );
  const originals = {
    [id('1')]: writeV1Record(m.core.paths.stateDir, v1(id('1'))),
    [id('2')]: writeV1Record(
      m.core.paths.stateDir,
      v1(id('2'), { state: 'approved', approvedDigest: 'a'.repeat(64), approvedVia: 'terminal' }),
    ),
  };
  // The version-3 write, and then the process dies: no record was retired.
  await m.core.config.convertToVersion3(() => scanOf(m.core.approvals), { now: time.now });
  assert.deepEqual(drainOf(m.file), {
    since: new Date(T).toISOString(),
    tracked: { [id('1')]: 'open', [id('2')]: 'open' },
  });
  assert.equal(readV1Record(m.core.paths.stateDir, id('1')), originals[id('1')]);

  // Restarted: a new process over the same files. One record cannot be retired yet — its file is mid-write.
  const restarted = openCore({ env: m.env, now: time.now, caller: CORE_CALLER });
  writeFileSync(join(m.core.paths.stateDir, 'approvals', `${id('1')}.json`), '{ "approvalId": "');
  time.set(T + MIN);
  const first = await ensureSendEpochConfig(restarted, { now: time.now });
  assert.deepEqual(first.legacyDrain, { couldNotRevoke: [id('1')], inFlight: [] });
  assert.deepEqual(drainOf(m.file)?.tracked, { [id('1')]: 'open', [id('2')]: 'revoked' });
  // Retired in its own shape: its version, no kind, nothing of version 2 — only the state, the reason and the time.
  const retired = JSON.parse(readV1Record(m.core.paths.stateDir, id('2'))) as Record<string, unknown>;
  assert.deepEqual(retired, {
    ...JSON.parse(originals[id('2')] as string),
    state: 'revoked',
    reason: LEGACY_DRAIN_REASON,
    updatedAt: new Date(T + MIN).toISOString(),
  });
  assert.equal(deriveLegacyV1State(retired as never, time.now()).state, 'revoked');

  const loosen = () =>
    restarted.config.update(setSendPolicy('acme/gmail', 'inboxes', 'chat'), consent(['inboxes.acme/gmail.sendPolicy']));
  await assert.rejects(
    loosen(),
    (e: unknown) => e instanceof CommsError && e.code === 'TRANSIENT' && /still being retired/.test(e.message),
  );

  // The file is whole again; the next operation retries it.
  writeFileSync(join(m.core.paths.stateDir, 'approvals', `${id('1')}.json`), originals[id('1')] as string);
  time.set(T + 2 * MIN);
  const second = await ensureSendEpochConfig(restarted, { now: time.now });
  assert.deepEqual(second.legacyDrain, { couldNotRevoke: [], inFlight: [] });
  assert.deepEqual(drainOf(m.file)?.tracked, { [id('1')]: 'revoked', [id('2')]: 'revoked' });
  await assert.rejects(loosen(), /still being retired/, 'not before the drain closes');

  time.set(T + LEGACY_DRAIN_MS);
  await ensureSendEpochConfig(restarted, { now: time.now });
  assert.equal(drainOf(m.file), undefined, 'closed');
  await loosen();
  assert.equal((read(m.file).inboxes as Record<string, { sendPolicy?: string }>)['acme/gmail']?.sendPolicy, 'chat');
});

test('a version-1 record written by a paused prepare after the scan joins the drain on the next rescan', async () => {
  const time = clock();
  const m = machine(body(), time);
  writeV1Record(m.core.paths.stateDir, v1(id('1')));
  await m.core.config.convertToVersion3(() => scanOf(m.core.approvals), { now: time.now });
  // Written after the scan, by a prepare that had read version 2 before the conversion.
  const late = writeV1Record(m.core.paths.stateDir, v1(id('2')));
  time.set(T + MIN);
  await ensureSendEpochConfig(m.core, { now: time.now });
  assert.deepEqual(drainOf(m.file)?.tracked, { [id('1')]: 'revoked', [id('2')]: 'revoked' });
  assert.deepEqual(JSON.parse(readV1Record(m.core.paths.stateDir, id('2'))), {
    ...JSON.parse(late),
    state: 'revoked',
    reason: LEGACY_DRAIN_REASON,
    updatedAt: new Date(T + MIN).toISOString(),
  });
});

test('the drain does not close before the earlier release’s pending lifetime has passed, even with every record finished', async () => {
  const time = clock();
  const m = machine(body(), time);
  writeV1Record(m.core.paths.stateDir, v1(id('1')));
  await ensureSendEpochConfig(m.core, { now: time.now });
  assert.deepEqual(drainOf(m.file)?.tracked, { [id('1')]: 'revoked' }, 'finished at once');
  for (const at of [T + MIN, T + LEGACY_DRAIN_MS - 1]) {
    time.set(at);
    await ensureSendEpochConfig(m.core, { now: time.now });
    assert.ok(drainOf(m.file), `still open at ${new Date(at).toISOString()}`);
  }
  time.set(T + LEGACY_DRAIN_MS);
  await ensureSendEpochConfig(m.core, { now: time.now });
  assert.equal(drainOf(m.file), undefined, 'closed at the boundary');
});

test('tracked records an admitted earlier-release send finished — used, failed — or left sending or unknown clear the drain, each listed', async () => {
  const time = clock();
  const m = machine(body(), time);
  for (const c of ['1', '2', '3', '4']) writeV1Record(m.core.paths.stateDir, v1(id(c)));
  await m.core.config.convertToVersion3(() => scanOf(m.core.approvals), { now: time.now });
  // An earlier release's send, already past its config read, claims and finishes each in turn.
  writeV1Record(m.core.paths.stateDir, v1(id('1'), { state: 'used', sentMessageId: 's-1' }));
  writeV1Record(m.core.paths.stateDir, v1(id('2'), { state: 'failed', reason: 'backendError' }));
  writeV1Record(
    m.core.paths.stateDir,
    v1(id('3'), { state: 'sending', updatedAt: new Date(T + 10 * MIN).toISOString() }),
  );
  writeV1Record(m.core.paths.stateDir, v1(id('4'), { state: 'sending', updatedAt: new Date(T).toISOString() }));
  time.set(T + LEGACY_DRAIN_MS + MIN);
  const result = await ensureSendEpochConfig(m.core, { now: time.now });
  assert.equal(drainOf(m.file), undefined, 'every one has an outcome, so the drain closed');
  assert.deepEqual(result.legacyDrain, { couldNotRevoke: [], inFlight: [id('1'), id('2'), id('3'), id('4')] });
  // None of them was rewritten: an admitted send is never revoked under it.
  assert.equal(JSON.parse(readV1Record(m.core.paths.stateDir, id('3'))).state, 'sending');
});

test('doctor names an open drain — what it tracks, what is still open, what an earlier release reached — and nothing once it closes', async () => {
  const time = clock();
  const m = machine(body(), time);
  for (const c of ['1', '2', '3']) writeV1Record(m.core.paths.stateDir, v1(id(c)));
  await m.core.config.convertToVersion3(() => scanOf(m.core.approvals), { now: time.now });
  writeFileSync(join(m.core.paths.stateDir, 'approvals', `${id('1')}.json`), '{ "approvalId": "');
  writeV1Record(m.core.paths.stateDir, v1(id('3'), { state: 'used', sentMessageId: 's-3' }));
  time.set(T + MIN);
  await ensureSendEpochConfig(m.core, { now: time.now });
  const check = async () =>
    (await doctor(m.core, m.env, { keyring: null })).checks.find((one) => one.name === 'earlier-release approvals');
  const open = await check();
  assert.ok(open);
  assert.equal(open.ok, true);
  assert.equal(open.warn, true);
  assert.equal(
    open.detail,
    `being retired since ${new Date(T).toISOString()}: 3 tracked, 1 still open (${id('1')}), 1 reached by an earlier release's send (${id('3')})`,
  );
  // Whole again, and past the earlier release's lifetime: the next call closes it, and doctor has nothing to say.
  writeV1Record(m.core.paths.stateDir, v1(id('1')));
  time.set(T + LEGACY_DRAIN_MS);
  await ensureSendEpochConfig(m.core, { now: time.now });
  assert.equal(await check(), undefined);
});

// ── The conversion, raced (a child process shares the configuration) ─────────────────────────────────────────────

const CHILD = fileURLToPath(new URL('./fixtures/config-child.ts', import.meta.url));

interface Child {
  send(message: Record<string, unknown>): void;
  next(match: (message: Record<string, unknown>) => boolean): Promise<Record<string, unknown>>;
  seen(match: (message: Record<string, unknown>) => boolean): boolean;
  close(): void;
}

async function child(): Promise<Child> {
  const proc: ChildProcess = fork(CHILD, [], {
    execArgv: ['--experimental-strip-types', '--disable-warning=ExperimentalWarning'],
    stdio: ['ignore', 'inherit', 'inherit', 'ipc'],
  });
  const received: Record<string, unknown>[] = [];
  const waiting: {
    match: (message: Record<string, unknown>) => boolean;
    settle: (m: Record<string, unknown>) => void;
  }[] = [];
  proc.on('message', (message: Record<string, unknown>) => {
    received.push(message);
    if (message.op === 'error') throw new Error(`the child failed: ${String(message.message)}`);
    for (const waiter of [...waiting]) {
      if (waiter.match(message)) {
        waiting.splice(waiting.indexOf(waiter), 1);
        waiter.settle(message);
      }
    }
  });
  const handle: Child = {
    send: (message) => proc.send(message),
    next: (match) => {
      const already = received.find(match);
      if (already) return Promise.resolve(already);
      return new Promise((settle) => waiting.push({ match, settle }));
    },
    seen: (match) => received.some(match),
    close: () => proc.kill(),
  };
  await handle.next((message) => message.op === 'ready');
  return handle;
}

const committed = (updateId: string) => (message: Record<string, unknown>) =>
  message.op === 'update' && message.id === updateId && message.committed === true;

/** A conversion of `m`'s version-2 config by a store of its own, paused at the hooks it is given. */
function converting(m: ReturnType<typeof machine>, hooks: ConversionHooks) {
  const store = new ConfigStore(m.core.paths.configDir, { [CONVERSION_HOOKS]: hooks });
  const approvals = new ApprovalStore(m.core.paths.stateDir, { now: m.time.now });
  return store.convertToVersion3(() => scanOf(approvals), { now: m.time.now });
}

test('the conversion tracks a v1 record written after its pre-lock read', async () => {
  const m = machine();
  const other = await child();
  try {
    const result = await converting(m, {
      beforeLock: async () => {
        other.send({ op: 'v1', stateDir: m.core.paths.stateDir, record: v1(id('7')) });
        await other.next((message) => message.op === 'v1');
      },
    });
    assert.equal(result.status, 'converted');
    assert.deepEqual((result.config as ConfigV3).legacyDrain?.tracked, { [id('7')]: 'open' });
  } finally {
    other.close();
  }
});

test('a config update committed while the conversion waited for the lock survives in the version-3 write', async () => {
  const m = machine();
  const other = await child();
  try {
    const result = await converting(m, {
      beforeLock: async () => {
        other.send({
          op: 'update',
          id: 'early',
          configDir: m.core.paths.configDir,
          changePolicy: 'confirm',
          key: { name: 'laterRelease', value: { kept: true } },
        });
        await other.next(committed('early'));
      },
    });
    assert.equal(result.status, 'converted');
    const after = read(m.file);
    assert.equal(after.version, 3);
    assert.equal((after.defaults as Record<string, unknown>).changePolicy, 'confirm');
    assert.deepEqual(after.laterRelease, { kept: true });
  } finally {
    other.close();
  }
});

test('a config update racing the conversion is neither lost nor let in between its scan and its write', async () => {
  const m = machine();
  const other = await child();
  let landedBeforeWrite: boolean | undefined;
  try {
    const result = await converting(m, {
      beforeLock: async () => {
        other.send({ op: 'v1', stateDir: m.core.paths.stateDir, record: v1(id('8')) });
        await other.next((message) => message.op === 'v1');
        other.send({
          op: 'update',
          id: 'first',
          configDir: m.core.paths.configDir,
          changePolicy: 'confirm',
          key: { name: 'firstKey', value: 1 },
        });
        await other.next(committed('first'));
      },
      afterScan: async () => {
        other.send({
          op: 'update',
          id: 'second',
          configDir: m.core.paths.configDir,
          key: { name: 'secondKey', value: 2 },
        });
        await other.next((message) => message.op === 'update' && message.id === 'second' && message.started === true);
        // Long enough for its update to be waiting on the lock, rather than on its way to it.
        await sleep(300);
      },
      beforeWrite: () => {
        landedBeforeWrite = other.seen(committed('second'));
      },
    });
    assert.equal(landedBeforeWrite, false, 'the second update could not land between the scan and the write');
    // The version-3 write's own tracked set holds the record written before the lock, before anything rescans.
    assert.deepEqual((result.config as ConfigV3).legacyDrain?.tracked, { [id('8')]: 'open' });
    const second = await other.next(committed('second'));
    assert.equal(second.version, 3, 'it landed after the version-3 write, on top of it');
    const after = read(m.file);
    assert.equal(after.version, 3);
    assert.equal(after.firstKey, 1);
    assert.equal(after.secondKey, 2);
    assert.equal((after.defaults as Record<string, unknown>).changePolicy, 'confirm');
    assert.deepEqual((after.legacyDrain as { tracked: object }).tracked, { [id('8')]: 'open' });
  } finally {
    other.close();
  }
});

test('a conversion that lost the race returns the winner’s version 3 unchanged', async () => {
  const m = machine();
  writeV1Record(m.core.paths.stateDir, v1(id('9')));
  const winner = new ConfigStore(m.core.paths.configDir);
  const approvals = new ApprovalStore(m.core.paths.stateDir, { now: m.time.now });
  const result = await converting(m, {
    // The loser has read version 2; before it takes the lock, the winner converts and records a `never`.
    beforeLock: async () => {
      await winner.convertToVersion3(() => scanOf(approvals), { now: m.time.now });
      await winner.update(setSendPolicy('acme/gmail', 'inboxes', 'never'));
    },
  });
  const after = read(m.file);
  assert.equal(result.status, 'already');
  assert.deepEqual(after.sendEpochs, { [GMAIL]: 1 }, 'the winner’s epoch is kept');
  assert.deepEqual((after.legacyDrain as { tracked: object }).tracked, { [id('9')]: 'open' });
  assert.deepEqual(parseConfig(readFileSync(m.file, 'utf8')), result.config);

  // And when the winner's write left the file looking as the loser last saw it — the same inode, size and time, as a
  // write in place within one tick of a coarse clock does — the loser still reads what is there, not what it cached.
  const quiet = machine();
  const at = Math.floor(T / 1000);
  utimesSync(quiet.file, at, at);
  const earlier = readFileSync(quiet.file, 'utf8');
  const won = JSON.stringify({ ...JSON.parse(earlier), version: 3, naming: 2, sendEpochs: { [GMAIL]: 1 } });
  assert.ok(Buffer.byteLength(won) < Buffer.byteLength(earlier));
  const lost = await converting(quiet, {
    beforeLock: () => {
      writeFileSync(quiet.file, won.padEnd(Buffer.byteLength(earlier), ' '));
      utimesSync(quiet.file, at, at);
    },
  });
  assert.equal(lost.status, 'already');
  assert.deepEqual(read(quiet.file).sendEpochs, { [GMAIL]: 1 }, 'the winner’s epoch is kept');
  assert.equal(read(quiet.file).legacyDrain, undefined);
});
