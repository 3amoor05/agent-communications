import assert from 'node:assert/strict';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { PassThrough } from 'node:stream';
import { test } from 'node:test';
import { asV2 } from '../src/approval-stored.ts';
import { changeDigest } from '../src/approvals.ts';
import {
  beginChangeApproval,
  type ChangeRequest,
  type ChangeSpec,
  claimChange,
  finishChangeApproval,
  type PreparedChange,
  prepareChange,
} from '../src/changes.ts';
import { inlineCommand, type Streams } from '../src/cli-runtime.ts';
import {
  type AccountConfig,
  type Config,
  ConfigStore,
  classifyChange,
  effectiveChangePolicy,
  emptyConfig,
  governingChangePolicy,
  type InboxConfig,
  type LooseningConsent,
  parseConfig,
} from '../src/config.ts';
import { type Core, openCore } from '../src/core.ts';
import { CommsError } from '../src/errors.ts';
import { CORE_CALLER, isCommand } from '../src/handoffs.ts';
import { revokeApproval } from '../src/operations/maintenance.ts';
import { readV1Record, v1ChangeRecord, v1RecordPath, writeV1Record } from './fixtures/approval-v1-0.13.0.ts';
import { coreHandoffs } from './helpers/handoffs.ts';
import { tempDir } from './helpers/temp.ts';

/*
 * Change approvals (design 2026-09-25 §3): a loosening of the configuration, or an act that cannot be taken back,
 * agreed to from a chat or at a terminal. The fixtures run on a clock of their own, so nothing here depends on when
 * the suite runs.
 */

const CREATED = '2026-09-20T00:00:00.000Z';
const ACME = 'acc_AAAAAAAAAAAAAAAA';
const OTHER = 'acc_BBBBBBBBBBBBBBBB';
const MAIL = 'ibx_AAAAAAAAAAAAAAAA';

function account(id: string, over: Partial<AccountConfig> = {}): AccountConfig {
  return {
    id,
    platform: 'slack',
    workspace: 'T_ACME',
    userId: `U_${id.slice(-4)}`,
    tier: 'read',
    mode: 'read',
    grantedScopes: [],
    secretRef: `slack/token/${id}`,
    createdAt: CREATED,
    ...over,
  };
}

function inbox(id: string, over: Partial<InboxConfig> = {}): InboxConfig {
  return {
    id,
    provider: 'gmail',
    email: 'jo@acme.test',
    identity: 'oidc',
    client: 'desktop',
    tier: 'read',
    contacts: false,
    grantedScopes: [],
    secretRef: `gmail:refresh:${id}`,
    internalDomains: ['acme.test'],
    createdAt: CREATED,
    ...over,
  };
}

/** A version-2 configuration, parsed as the store would read it. */
function configOf(body: Record<string, unknown>): Config {
  return parseConfig(JSON.stringify({ version: 2, ...body }));
}

function clock(start = Date.parse('2026-09-25T10:00:00.000Z')) {
  let t = start;
  return { now: () => new Date(t), advance: (ms: number) => (t += ms) };
}

/**
 * A core over a temp directory, holding `body` as its configuration.
 *
 * Written to disk directly rather than through `ConfigStore.update`: the fixtures start from settings that were
 * loosened long ago, and the store would — rightly — ask for consent to write them.
 */
function coreWith(body: Record<string, unknown>) {
  const dir = tempDir();
  const time = clock();
  const write = (next: Record<string, unknown>) =>
    writeFileSync(join(dir, 'config.json'), `${JSON.stringify({ version: 2, ...next }, null, 2)}\n`);
  write(body);
  const core = openCore({
    env: { AGENT_COMMS_CONFIG_DIR: dir, HOME: dir, USERPROFILE: dir },
    now: time.now,
    caller: CORE_CALLER,
  });
  return { core, time, write, dir };
}

/** `acme/slack` widened from read to send, as a reauth in `send` mode would write it. */
async function widening(core: Core, name = 'acme/slack'): Promise<ChangeSpec> {
  const before = await core.config.load();
  const after = structuredClone(before);
  const held = after.accounts[name] as AccountConfig;
  after.accounts[name] = { ...held, mode: 'send', tier: 'send' };
  return { account: name, before, after, effects: ['signs in to Slack again and stores a token that can post'] };
}

function refusedWith(code: string, pattern: RegExp) {
  return (error: unknown) => {
    assert.ok(error instanceof CommsError, String(error));
    assert.equal(error.code, code, error.message);
    assert.match(error.message, pattern);
    return true;
  };
}

/* ---------------------------------------------------------------------------------------------------------------- */
/* changePolicy is a safety setting                                                                                   */
/* ---------------------------------------------------------------------------------------------------------------- */

test('changePolicy: absent reads as chat, and a config without it is written back without it', async () => {
  const empty = emptyConfig();
  assert.equal(empty.defaults.changePolicy, undefined);
  assert.equal(effectiveChangePolicy(empty), 'chat');
  // Upgrading changes nothing silently: an unrelated write does not record a choice nobody made.
  const store = new ConfigStore(tempDir());
  await store.update((config) => ({ ...config, defaults: { ...config.defaults, timezone: 'Europe/London' } }));
  assert.equal(JSON.parse(readFileSync(store.path, 'utf8')).defaults.changePolicy, undefined);
  // And a value that is not a change policy is refused, as a bad send policy is.
  assert.throws(() => configOf({ defaults: { changePolicy: 'never' } }), /changePolicy/);
});

test('changePolicy: its own, else the default, else chat', () => {
  const config = configOf({
    defaults: { changePolicy: 'confirm' },
    accounts: { 'acme/slack': account(ACME, { changePolicy: 'chat' }), 'other/slack': account(OTHER) },
    inboxes: { 'acme/gmail': inbox(MAIL) },
  });
  assert.equal(effectiveChangePolicy(config, { account: 'acme/slack' }), 'chat');
  assert.equal(effectiveChangePolicy(config, { account: 'other/slack' }), 'confirm');
  assert.equal(effectiveChangePolicy(config, { inbox: 'acme/gmail' }), 'confirm');
  assert.equal(effectiveChangePolicy(config, { account: 'not/connected' }), 'confirm');
  assert.equal(effectiveChangePolicy(config), 'confirm');
});

test('classifyChange: the default change policy moved confirm → chat is a loosening; chat → confirm is not', () => {
  const confirm = configOf({ defaults: { changePolicy: 'confirm' } });
  const chat = configOf({});
  assert.deepEqual(classifyChange(confirm, chat).changes, [
    { path: 'defaults.changePolicy', before: 'confirm', after: 'chat' },
  ]);
  assert.deepEqual(classifyChange(confirm, configOf({ defaults: { changePolicy: 'chat' } })).loosened, [
    'defaults.changePolicy',
  ]);
  assert.deepEqual(classifyChange(chat, confirm).loosened, [], 'tightening asks nobody');
});

test('classifyChange: an inbox’s or an account’s change policy loosened, or inheriting a looser default, is a loosening', () => {
  const at = (inboxPolicy?: 'chat' | 'confirm', accountPolicy?: 'chat' | 'confirm', defaults?: 'chat' | 'confirm') =>
    configOf({
      ...(defaults ? { defaults: { changePolicy: defaults } } : {}),
      inboxes: { 'acme/gmail': inbox(MAIL, inboxPolicy ? { changePolicy: inboxPolicy } : {}) },
      accounts: { 'acme/slack': account(ACME, accountPolicy ? { changePolicy: accountPolicy } : {}) },
    });
  assert.deepEqual(classifyChange(at('confirm'), at('chat')).changes, [
    { path: 'inboxes.acme/gmail.changePolicy', before: 'confirm', after: 'chat', id: MAIL },
  ]);
  assert.deepEqual(classifyChange(at(undefined, 'confirm'), at(undefined, 'chat')).changes, [
    { path: 'accounts.acme/slack.changePolicy', before: 'confirm', after: 'chat', id: ACME },
  ]);
  // Both inherit the default, so loosening the default loosens each of them too.
  assert.deepEqual(classifyChange(at(undefined, undefined, 'confirm'), at()).loosened, [
    'inboxes.acme/gmail.changePolicy',
    'accounts.acme/slack.changePolicy',
    'defaults.changePolicy',
  ]);
  assert.deepEqual(classifyChange(at('chat', 'chat'), at('confirm', 'confirm')).loosened, [], 'tightening');
});

test('classifyChange: a new inbox or account looser than the default in force before it existed is a loosening', () => {
  const before = configOf({ defaults: { changePolicy: 'confirm' } });
  const withInbox = (over: Partial<InboxConfig>) =>
    configOf({ defaults: { changePolicy: 'confirm' }, inboxes: { 'acme/gmail': inbox(MAIL, over) } });
  const withAccount = (over: Partial<AccountConfig>) =>
    configOf({ defaults: { changePolicy: 'confirm' }, accounts: { 'acme/slack': account(ACME, over) } });

  // Measured against the default before it existed, and new: no id on the before side.
  assert.deepEqual(classifyChange(before, withInbox({ changePolicy: 'chat' })).changes, [
    { path: 'inboxes.acme/gmail.changePolicy', before: 'confirm', after: 'chat' },
  ]);
  assert.deepEqual(classifyChange(before, withAccount({ changePolicy: 'chat' })).loosened, [
    'accounts.acme/slack.changePolicy',
  ]);
  // Inheriting the default, or naming it, is no loosening.
  assert.deepEqual(classifyChange(before, withInbox({})).loosened, []);
  assert.deepEqual(classifyChange(before, withAccount({ changePolicy: 'confirm' })).loosened, []);
});

test('classifyChange: an account’s change policy is measured across a reauth’s new id', () => {
  // A reauth mints a new id for the same person in the same workspace. Matched by id alone, the renewed account would
  // be measured against the default — `chat` — and `confirm` → `chat` across a reauth would read as no change.
  const before = configOf({ accounts: { 'acme/slack': account(ACME, { userId: 'U_ME', changePolicy: 'confirm' }) } });
  const after = configOf({ accounts: { 'acme/slack': account(OTHER, { userId: 'U_ME', changePolicy: 'chat' }) } });
  assert.deepEqual(classifyChange(before, after).changes, [
    { path: 'accounts.acme/slack.changePolicy', before: 'confirm', after: 'chat', id: ACME },
  ]);
});

test('classifyChange: reports the values it judged, not the raw fields', () => {
  // An inherited default is what the inbox had; a new account is measured against the default before it and starts
  // from `read`; an unrecorded store is the keychain.
  const before = configOf({ defaults: { sendPolicy: 'confirm' }, inboxes: { 'acme/gmail': inbox(MAIL) } });
  const after = configOf({
    inboxes: { 'acme/gmail': inbox(MAIL) },
    accounts: { 'zed/slack': account(OTHER, { mode: 'send', tier: 'send' }) },
    secrets: { store: 'file' },
  });
  assert.deepEqual(classifyChange(before, after).changes, [
    { path: 'inboxes.acme/gmail.sendPolicy', before: 'confirm', after: 'chat', id: MAIL },
    { path: 'accounts.zed/slack.sendPolicy', before: 'confirm', after: 'chat' },
    { path: 'accounts.zed/slack.mode', before: 'read', after: 'send' },
    { path: 'defaults.sendPolicy', before: 'confirm', after: 'chat' },
    { path: 'secrets.store', before: 'keychain', after: 'file' },
  ]);
});

/* ---------------------------------------------------------------------------------------------------------------- */
/* The consent a change approval yields                                                                               */
/* ---------------------------------------------------------------------------------------------------------------- */

test('a consent carrying approved values lets exactly that change through, and not the same path moved further', async () => {
  const store = new ConfigStore(tempDir());
  writeFileSync(
    store.path,
    // Version 3, where a send policy is written with its send epoch: before it, no send policy moves at all.
    JSON.stringify({ version: 3, naming: 2, accounts: { 'acme/slack': account(ACME, { sendPolicy: 'never' }) } }),
  );
  const path = 'accounts.acme/slack.sendPolicy';
  const to = (sendPolicy: 'chat' | 'confirm') => (config: Config) => {
    config.accounts['acme/slack'] = { ...(config.accounts['acme/slack'] as AccountConfig), sendPolicy };
    return config;
  };
  const neverToConfirm = { path, before: 'never', after: 'confirm', id: ACME };
  const approved = { kind: 'loosening-consent' as const, paths: [path], changes: [neverToConfirm] };
  // The path matches and the value does not: approved never → confirm, asked for never → chat.
  await assert.rejects(
    store.update(to('chat'), { consent: approved }),
    refusedWith('LOOSENING_REFUSED', /this is not the change that was approved: accounts\.acme\/slack\.sendPolicy/),
  );
  assert.equal((await store.load()).accounts['acme/slack']?.sendPolicy, 'never', 'nothing was written');
  // A different account under the same name is a different change, whatever the values.
  await assert.rejects(
    store.update(to('confirm'), { consent: { ...approved, changes: [{ ...neverToConfirm, id: OTHER }] } }),
    refusedWith('LOOSENING_REFUSED', /not the change that was approved/),
  );
  await store.update(to('confirm'), { consent: approved });
  assert.equal((await store.load()).accounts['acme/slack']?.sendPolicy, 'confirm');
  // A terminal consent names paths alone, and is judged as it always was.
  await store.update(to('chat'), { consent: { kind: 'loosening-consent', paths: [path] } });
});

/* ---------------------------------------------------------------------------------------------------------------- */
/* Prepare, preview, approve, apply                                                                                   */
/* ---------------------------------------------------------------------------------------------------------------- */

test('under chat, a prepared change shows before → after in words, and is claimed once for exactly that write', async () => {
  const { core } = coreWith({ accounts: { 'acme/slack': account(ACME) } });
  const spec = await widening(core);
  const prepared = await prepareChange(
    core,
    { ...spec, summary: 'Let acme/slack post' },
    { channel: 'core', surface: 'mcp' },
  );

  assert.equal(prepared.policy, 'chat');
  assert.deepEqual(prepared.loosened, [{ path: 'accounts.acme/slack.mode', before: 'read', after: 'send', id: ACME }]);
  assert.match(
    prepared.preview,
    /^CHANGE PREVIEW · approval ap_\w+ · approved by a yes in the chat · nothing has been changed/,
  );
  assert.match(prepared.preview, /\nLet acme\/slack post\nFor: account acme\/slack\n/);
  assert.match(prepared.preview, /acme\/slack mode: read → send — it will be able to send, not only read/);
  assert.match(prepared.preview, /It also:\n {2}- signs in to Slack again and stores a token that can post/);
  assert.match(prepared.next, /If they say yes, claim approval/);

  // Nothing was written, and the write still needs consent.
  assert.equal((await core.config.load()).accounts['acme/slack']?.mode, 'read');
  await assert.rejects(
    core.config.update(() => spec.after),
    refusedWith('LOOSENING_REFUSED', /accounts\.acme\/slack\.mode/),
  );

  const consent = await claimChange(core, prepared.approvalId, await widening(core), { surface: 'mcp' });
  assert.deepEqual(consent.paths, ['accounts.acme/slack.mode']);
  await core.config.update(() => spec.after, { consent });
  assert.equal((await core.config.load()).accounts['acme/slack']?.mode, 'send');

  // Single use.
  await assert.rejects(
    claimChange(core, prepared.approvalId, spec, { surface: 'mcp' }),
    refusedWith('APPROVAL_VOID', /nothing was changed: the approved change was already claimed at /),
  );
});

test('drift between preview and apply voids the approval, and says what moved', async () => {
  /** `acme/slack` from `never` to `policy`, as well as widened. */
  const withSendPolicy = (spec: ChangeSpec, sendPolicy: 'chat' | 'confirm'): ChangeSpec => {
    const after = structuredClone(spec.after);
    after.accounts['acme/slack'] = { ...(after.accounts['acme/slack'] as AccountConfig), sendPolicy };
    return { ...spec, after };
  };
  const cases: [string, (spec: ChangeSpec) => ChangeSpec, RegExp][] = [
    // Approved never → confirm, applied never → chat: the same path, a different value.
    [
      'a different value',
      (spec) => withSendPolicy(spec, 'chat'),
      /accounts\.acme\/slack\.sendPolicy would not move between the values that were approved/,
    ],
    [
      'a different setting',
      (spec) => {
        const after = structuredClone(spec.after);
        after.defaults.riskEscalation = false;
        return { ...spec, after };
      },
      /it loosens different settings from the ones approved/,
    ],
    [
      'different effects',
      (spec) => ({ ...spec, effects: ['removes every token'] }),
      /what it does outside the configuration is not what was approved/,
    ],
  ];
  for (const [name, drift, reason] of cases) {
    const { core } = coreWith({ accounts: { 'acme/slack': account(ACME, { sendPolicy: 'never' }) } });
    const spec = withSendPolicy(await widening(core), 'confirm');
    const prepared = await prepareChange(
      core,
      { ...spec, summary: 'Let acme/slack post' },
      { channel: 'core', surface: 'mcp' },
    );
    await assert.rejects(
      claimChange(core, prepared.approvalId, drift(spec), { surface: 'mcp' }),
      refusedWith('APPROVAL_VOID', new RegExp(`nothing was changed: ${reason.source}`)),
      name,
    );
    // Voided for good: the change as prepared no longer claims it either.
    await assert.rejects(
      claimChange(core, prepared.approvalId, spec, { surface: 'mcp' }),
      refusedWith('APPROVAL_VOID', /was voided/),
      name,
    );
  }
});

test('an approval binds every setting the change writes: a claim that drops, adds or moves a tightening is refused', async () => {
  /*
   * The digest bound the loosenings and the effects, not the tightenings. A person shown "send policy to never, change
   * policy to chat" approved at a terminal, and a claim for the change policy alone — the same loosening — was
   * applied: the send policy the person saw tightened stayed as it was.
   */
  const cases: [string, Partial<InboxConfig>, RegExp][] = [
    ['a tightening dropped', { changePolicy: 'chat' }, /it would not set inboxes\.acme\/gmail\.sendPolicy the way/],
    [
      'a tightening added',
      { sendPolicy: 'never', changePolicy: 'chat', internalDomains: [] },
      /it would not set inboxes\.acme\/gmail\.internalDomains the way/,
    ],
    [
      'a tightening moved',
      { sendPolicy: 'confirm', changePolicy: 'chat' },
      /it would not set inboxes\.acme\/gmail\.sendPolicy the way/,
    ],
  ];
  for (const [name, claimed, reason] of cases) {
    const { core } = coreWith({ inboxes: { 'acme/gmail': inbox(MAIL, { changePolicy: 'confirm' }) } });
    const before = await core.config.load();
    const setting = (over: Partial<InboxConfig>): ChangeSpec => {
      const after = structuredClone(before);
      after.inboxes['acme/gmail'] = { ...(after.inboxes['acme/gmail'] as InboxConfig), ...over };
      return { inbox: 'acme/gmail', before, after };
    };
    const shown = setting({ sendPolicy: 'never', changePolicy: 'chat' });
    const prepared = await prepareChange(
      core,
      { ...shown, summary: 'acme/gmail: sends approved by never; changes approved by chat' },
      { channel: 'core', surface: 'mcp' },
    );
    assert.equal(prepared.policy, 'confirm', name);
    const prompt = await beginChangeApproval(core, prepared.approvalId, { surface: 'cli' });
    await finishChangeApproval(core, prepared.approvalId, prompt.challenge, { surface: 'cli' });

    await assert.rejects(
      claimChange(core, prepared.approvalId, setting(claimed), { surface: 'mcp' }),
      refusedWith('APPROVAL_VOID', reason),
      name,
    );
    await assert.rejects(
      claimChange(core, prepared.approvalId, shown, { surface: 'mcp' }),
      refusedWith('APPROVAL_VOID', /was voided/),
      `${name}: the approval survived a claim for another change`,
    );
  }

  // The change as it was shown is claimed, and carries only the loosening as consent.
  const { core } = coreWith({ inboxes: { 'acme/gmail': inbox(MAIL, { changePolicy: 'confirm' }) } });
  const before = await core.config.load();
  const after = structuredClone(before);
  after.inboxes['acme/gmail'] = { ...(after.inboxes['acme/gmail'] as InboxConfig), sendPolicy: 'never' };
  (after.inboxes['acme/gmail'] as InboxConfig).changePolicy = 'chat';
  const spec: ChangeSpec = { inbox: 'acme/gmail', before, after };
  const prepared = await prepareChange(
    core,
    { ...spec, summary: 'acme/gmail: both' },
    { channel: 'core', surface: 'mcp' },
  );
  const prompt = await beginChangeApproval(core, prepared.approvalId, { surface: 'cli' });
  await finishChangeApproval(core, prepared.approvalId, prompt.challenge, { surface: 'cli' });
  const consent = await claimChange(core, prepared.approvalId, spec, { surface: 'mcp' });
  assert.deepEqual(consent.paths, ['inboxes.acme/gmail.changePolicy']);
});

test('an account replaced under the same name between preview and apply is not the one approved', async () => {
  const { core, write } = coreWith({ accounts: { 'acme/slack': account(ACME) } });
  const spec = await widening(core);
  const prepared = await prepareChange(
    core,
    { ...spec, summary: 'Let acme/slack post' },
    { channel: 'core', surface: 'mcp' },
  );
  // Somebody removed acme/slack and connected a different workspace under the name: the account the approval was
  // for is gone (D2), whatever holds its name now.
  write({ accounts: { 'acme/slack': account(OTHER, { workspace: 'T_ELSEWHERE' }) } });
  await assert.rejects(
    claimChange(core, prepared.approvalId, await widening(core), { surface: 'mcp' }),
    refusedWith('APPROVAL_VOID', /the approval was voided \(its mailbox or account was removed\)/),
  );
});

test('under confirm, a change is not claimable until a person approved it at a terminal — then it is, once', async () => {
  const { core } = coreWith({ defaults: { changePolicy: 'confirm' }, accounts: { 'acme/slack': account(ACME) } });
  const spec = await widening(core);
  const prepared = await prepareChange(
    core,
    { ...spec, summary: 'Let acme/slack post' },
    { channel: 'core', surface: 'mcp' },
  );
  assert.equal(prepared.policy, 'confirm');
  assert.match(prepared.preview, /approved by a code typed at a terminal/);
  const approve = coreHandoffs(core.paths).own(['approve', prepared.approvalId]);
  assert.ok(isCommand(approve));
  assert.ok(prepared.next.includes(inlineCommand(approve)), prepared.next);

  await assert.rejects(claimChange(core, prepared.approvalId, spec, { surface: 'mcp' }), (error: CommsError) => {
    assert.equal(error.code, 'APPROVAL_PENDING');
    assert.match(error.message, /needs a person to approve it at a terminal first/);
    assert.ok(error.hint?.includes(inlineCommand(approve)), error.hint);
    return true;
  });
  assert.equal(asV2(await core.approvals.get(prepared.approvalId))?.state, 'pending', 'waiting is not voiding');

  const prompt = await beginChangeApproval(core, prepared.approvalId, { surface: 'cli' });
  assert.equal(prompt.preview, prepared.preview, 'the terminal shows what the chat showed');
  await finishChangeApproval(core, prepared.approvalId, prompt.challenge.toLowerCase(), { surface: 'cli' });

  const consent = await claimChange(core, prepared.approvalId, spec, { surface: 'mcp' });
  await core.config.update(() => spec.after, { consent });
  assert.equal((await core.config.load()).accounts['acme/slack']?.mode, 'send');
});

test('under confirm, an approval given anywhere but a terminal does not count', async () => {
  const { core } = coreWith({ defaults: { changePolicy: 'confirm' }, accounts: { 'acme/slack': account(ACME) } });
  const spec = await widening(core);
  const prepared = await prepareChange(
    core,
    { ...spec, summary: 'Let acme/slack post' },
    { channel: 'core', surface: 'mcp' },
  );
  const record = asV2(await core.approvals.get(prepared.approvalId));
  const challenge = await core.approvals.issueChallenge(prepared.approvalId, 'change');
  const bound = { draftMessageId: record?.contentDigest ?? '', contentDigest: record?.contentDigest ?? '' };
  // Voided where it is given: a form approval of a change is never written as one.
  await assert.rejects(
    core.approvals.approve(prepared.approvalId, 'elicitation', bound, challenge, 'change'),
    refusedWith('APPROVAL_VOID', /the change policy is confirm, and this was not approved at a terminal/),
  );
  assert.equal(asV2(await core.approvals.get(prepared.approvalId))?.state, 'revoked');
  await assert.rejects(
    claimChange(core, prepared.approvalId, spec, { surface: 'mcp' }),
    refusedWith('APPROVAL_VOID', /the change policy is confirm, and this was not approved at a terminal/),
  );
});

test('loosening the change policy itself is approved under the policy in force before it', async () => {
  const { core } = coreWith({ defaults: { changePolicy: 'confirm' } });
  const before = await core.config.load();
  const after = structuredClone(before);
  after.defaults.changePolicy = 'chat';
  const prepared = await prepareChange(
    core,
    { before, after, summary: 'Approve changes in chat from now on' },
    { channel: 'core', surface: 'mcp' },
  );
  assert.equal(prepared.policy, 'confirm', 'confirm → chat is asked under confirm, not under the chat it asks for');
  // It said "loosen its settings" here, with no "it" for the default to be: say what the default governs.
  assert.match(
    prepared.preview,
    /default change policy: confirm → chat — a yes in the chat will be enough to loosen settings for the whole configuration, and for every mailbox or account without a change policy of its own/,
  );
  assert.doesNotMatch(prepared.preview, /its settings/);
  await assert.rejects(
    claimChange(core, prepared.approvalId, { before, after }, { surface: 'mcp' }),
    refusedWith('APPROVAL_PENDING', /at a terminal first/),
  );

  // And chat → confirm is a tightening, which needs nobody: there is nothing to prepare.
  await assert.rejects(
    prepareChange(
      core,
      { before: after, after: before, summary: 'Back to confirm' },
      { channel: 'core', surface: 'mcp' },
    ),
    refusedWith('USAGE', /nothing to approve/),
  );
});

test('a mailbox’s or an account’s own change policy, loosened, names what it lets a yes in the chat change', async () => {
  const { core } = coreWith({
    inboxes: { 'acme/gmail': inbox(MAIL, { changePolicy: 'confirm' }) },
    accounts: { 'acme/slack': account(ACME, { changePolicy: 'confirm' }) },
  });
  const before = await core.config.load();
  const after = structuredClone(before);
  (after.inboxes['acme/gmail'] as InboxConfig).changePolicy = 'chat';
  (after.accounts['acme/slack'] as AccountConfig).changePolicy = 'chat';
  const prepared = await prepareChange(
    core,
    { before, after, summary: 'Approve changes to both in chat' },
    { channel: 'core', surface: 'cli' },
  );
  assert.match(
    prepared.preview,
    /acme\/gmail change policy: confirm → chat — a yes in the chat will be enough to loosen this mailbox’s settings/,
  );
  assert.match(
    prepared.preview,
    /acme\/slack change policy: confirm → chat — a yes in the chat will be enough to loosen this account’s settings/,
  );
});

test('the strictest policy over everything a change touches governs it', () => {
  const config = configOf({
    defaults: { changePolicy: 'confirm' },
    accounts: { 'acme/slack': account(ACME, { changePolicy: 'chat' }), 'other/slack': account(OTHER) },
  });
  const target = { kind: 'account' as const, name: 'acme/slack', id: ACME };
  const mode = { path: 'accounts.acme/slack.mode', before: 'read', after: 'send', id: ACME };
  // The account's own override governs a change to it.
  assert.equal(governingChangePolicy(config, { target, loosened: [mode] }), 'chat');
  // The default governs one to another account, to a new one, and to the whole configuration.
  assert.equal(
    governingChangePolicy(config, { target: { ...target, name: 'other/slack', id: OTHER }, loosened: [] }),
    'confirm',
  );
  assert.equal(
    governingChangePolicy(config, { target: { kind: 'account', name: 'zed/slack' }, loosened: [] }),
    'confirm',
  );
  assert.equal(governingChangePolicy(config, { target: null, loosened: [] }), 'confirm');
  // A change to acme/slack that also loosens a default is governed by the default too.
  const caps = { path: 'defaults.sendCaps', before: { perHour: 20 }, after: { perHour: 99 } };
  assert.equal(governingChangePolicy(config, { target, loosened: [mode, caps] }), 'confirm');
  // And one that loosens another account is governed by that account's policy.
  const other = { path: 'accounts.other/slack.mode', before: 'read', after: 'send', id: OTHER };
  assert.equal(governingChangePolicy(config, { target, loosened: [mode, other] }), 'confirm');
});

test('a policy tightened after prepare governs the claim; one loosened after prepare does not release it', async () => {
  const tightened = coreWith({ accounts: { 'acme/slack': account(ACME) } });
  const spec = await widening(tightened.core);
  const underChat = await prepareChange(tightened.core, { ...spec, summary: 'x' }, { channel: 'core', surface: 'mcp' });
  assert.equal(underChat.policy, 'chat');
  tightened.write({ defaults: { changePolicy: 'confirm' }, accounts: { 'acme/slack': account(ACME) } });
  await assert.rejects(
    claimChange(tightened.core, underChat.approvalId, spec, { surface: 'mcp' }),
    refusedWith('APPROVAL_PENDING', /at a terminal first/),
  );

  const loosened = coreWith({ defaults: { changePolicy: 'confirm' }, accounts: { 'acme/slack': account(ACME) } });
  const again = await widening(loosened.core);
  const underConfirm = await prepareChange(
    loosened.core,
    { ...again, summary: 'x' },
    { channel: 'core', surface: 'mcp' },
  );
  loosened.write({ accounts: { 'acme/slack': account(ACME) } });
  const live = await widening(loosened.core);
  await assert.rejects(
    claimChange(loosened.core, underConfirm.approvalId, live, { surface: 'mcp' }),
    refusedWith('APPROVAL_PENDING', /at a terminal first/),
  );
});

test('a pending chat change is claimed inside its ten minutes, and expires at them', async () => {
  const { core, time } = coreWith({ accounts: { 'acme/slack': account(ACME) } });
  const spec = await widening(core);
  const claimed = await prepareChange(core, { ...spec, summary: 'x' }, { channel: 'core', surface: 'mcp' });
  const late = await prepareChange(core, { ...spec, summary: 'x' }, { channel: 'core', surface: 'mcp' });
  time.advance(10 * 60 * 1000 - 1);
  const consent = await claimChange(core, claimed.approvalId, spec, { surface: 'mcp' });
  assert.deepEqual(consent.paths, ['accounts.acme/slack.mode'], 'claimed a millisecond before its window closes');
  time.advance(1);
  await assert.rejects(
    claimChange(core, late.approvalId, spec, { surface: 'mcp' }),
    refusedWith('APPROVAL_EXPIRED', /^this approval expired; nothing was changed with it: prepared at .+, expired at /),
  );
});

test('the policy in force is read from the file, never from the before a caller passes', async () => {
  const { core } = coreWith({ defaults: { changePolicy: 'confirm' }, accounts: { 'acme/slack': account(ACME) } });
  const spec = await widening(core);
  // A caller whose idea of the configuration says `chat` — stale, or made up — gets the policy the file says.
  const claimsChat = structuredClone(spec.before);
  claimsChat.defaults.changePolicy = 'chat';
  const after = structuredClone(spec.after);
  after.defaults.changePolicy = 'chat';
  const forged = { ...spec, before: claimsChat, after };
  const prepared = await prepareChange(core, { ...forged, summary: 'x' }, { channel: 'core', surface: 'mcp' });
  assert.equal(prepared.policy, 'confirm');
  // And at the claim too: the record's policy aside, the live one alone would refuse it.
  const record = asV2(await core.approvals.get(prepared.approvalId));
  const file = join(core.approvals.directory, `${prepared.approvalId}.json`);
  writeFileSync(file, JSON.stringify({ ...record, policy: 'chat', requiredPolicy: 'chat' }));
  await assert.rejects(
    claimChange(core, prepared.approvalId, forged, { surface: 'mcp' }),
    refusedWith('APPROVAL_PENDING', /at a terminal first/),
  );
});

test('a claimed consent still refuses the write if the account changes between the claim and the write', async () => {
  const { core, write } = coreWith({ accounts: { 'acme/slack': account(ACME) } });
  const spec = await widening(core);
  const prepared = await prepareChange(
    core,
    { ...spec, summary: 'Let acme/slack post' },
    { channel: 'core', surface: 'mcp' },
  );
  const consent = await claimChange(core, prepared.approvalId, spec, { surface: 'mcp' });
  // A sign-in can take minutes. Meanwhile a different workspace was connected under the name.
  write({ accounts: { 'acme/slack': account(OTHER, { workspace: 'T_ELSEWHERE' }) } });
  const widen = (config: Config) => {
    config.accounts['acme/slack'] = { ...(config.accounts['acme/slack'] as AccountConfig), mode: 'send', tier: 'send' };
    return config;
  };
  await assert.rejects(
    core.config.update(widen, { consent }),
    refusedWith('LOOSENING_REFUSED', /this is not the change that was approved: accounts\.acme\/slack\.mode/),
  );
  assert.equal((await core.config.load()).accounts['acme/slack']?.mode, 'read');
});

test('an act that cannot be taken back is bound to the mailbox or workspace it was shown for', async () => {
  // Replaced under the same name before the removal was applied: it would remove something nobody was shown.
  const cases = [
    {
      kind: 'account' as const,
      name: 'acme/slack',
      was: { accounts: { 'acme/slack': account(ACME) } },
      now: { accounts: { 'acme/slack': account(OTHER, { workspace: 'T_ELSEWHERE' }) } },
    },
    {
      kind: 'inbox' as const,
      name: 'acme/gmail',
      was: { inboxes: { 'acme/gmail': inbox(MAIL) } },
      now: { inboxes: { 'acme/gmail': inbox('ibx_BBBBBBBBBBBBBBBB', { email: 'someone@else.test' }) } },
    },
  ];
  for (const { kind, name, was, now } of cases) {
    const { core, write } = coreWith(was);
    const removal = async (): Promise<ChangeSpec> => {
      const before = await core.config.load();
      const after = structuredClone(before);
      delete after[kind === 'inbox' ? 'inboxes' : 'accounts'][name];
      return { [kind]: name, before, after, effects: [`deletes the credential stored for ${name}`] };
    };
    const prepared = await prepareChange(
      core,
      { ...(await removal()), summary: `Remove ${name}` },
      { channel: 'core', surface: 'cli' },
    );
    write(now);
    // The one it was shown for is gone (D2), whatever holds its name now.
    await assert.rejects(
      claimChange(core, prepared.approvalId, await removal(), { surface: 'cli' }),
      refusedWith('APPROVAL_VOID', /the approval was voided \(its mailbox or account was removed\)/),
      kind,
    );
  }
});

test('an act that cannot be taken back is approved by its effects alone, and its consent loosens nothing', async () => {
  const { core } = coreWith({ accounts: { 'acme/slack': account(ACME), 'other/slack': account(OTHER) } });
  const before = await core.config.load();
  const after = structuredClone(before);
  delete after.accounts['acme/slack'];
  const removal = { account: 'acme/slack', before, after, effects: ['deletes the token stored for acme/slack'] };
  const prepared = await prepareChange(
    core,
    { ...removal, summary: 'Remove acme/slack' },
    { channel: 'core', surface: 'cli' },
  );
  assert.deepEqual(prepared.loosened, []);
  assert.match(
    prepared.preview,
    /For: account acme\/slack\n\nIt loosens no safety setting\.\n\nIt also:\n {2}- deletes the token/,
  );

  const consent = await claimChange(core, prepared.approvalId, removal, { surface: 'cli' });
  assert.deepEqual(consent, { kind: 'loosening-consent', paths: [], changes: [] });
  // Spent on anything that loosens, it permits nothing.
  const widened = structuredClone(after);
  widened.accounts['other/slack'] = {
    ...(widened.accounts['other/slack'] as AccountConfig),
    mode: 'send',
    tier: 'send',
  };
  await assert.rejects(
    core.config.update(() => widened, { consent }),
    refusedWith('LOOSENING_REFUSED', /other\/slack\.mode/),
  );
  await core.config.update(() => after, { consent });
  assert.equal((await core.config.load()).accounts['acme/slack'], undefined);
});

test('prepare refuses a change with nothing to approve, one about nothing connected, and one about two things', async () => {
  const { core } = coreWith({ accounts: { 'acme/slack': account(ACME) } });
  const config = await core.config.load();
  await assert.rejects(
    prepareChange(core, { before: config, after: config, summary: 'nothing' }, { channel: 'core', surface: 'mcp' }),
    refusedWith('USAGE', /nothing to approve/),
  );
  await assert.rejects(
    prepareChange(
      core,
      { account: 'zed/slack', before: config, after: config, effects: ['x'], summary: 's' },
      { channel: 'core', surface: 'mcp' },
    ),
    refusedWith('NOT_FOUND', /zed\/slack/),
  );
  await assert.rejects(
    prepareChange(
      core,
      { account: 'acme/slack', inbox: 'acme/gmail', before: config, after: config, effects: ['x'], summary: 's' },
      { channel: 'core', surface: 'mcp' },
    ),
    refusedWith('USAGE', /one inbox or one account, not both/),
  );
  await assert.rejects(
    prepareChange(
      core,
      { before: config, after: config, effects: ['x'], summary: '  ' },
      { channel: 'core', surface: 'mcp' },
    ),
    refusedWith('USAGE', /needs a summary/),
  );
});

test('the terminal shows only a change that reproduces its own digest, and only a change', async () => {
  const { core } = coreWith({ accounts: { 'acme/slack': account(ACME) } });
  const spec = await widening(core);
  const prepared = await prepareChange(
    core,
    { ...spec, summary: 'Let acme/slack post' },
    { channel: 'core', surface: 'mcp' },
  );
  // The record says it widens something else than it is bound to: the screen would lie, so it is never shown.
  const file = join(core.approvals.directory, `${prepared.approvalId}.json`);
  const stored = JSON.parse(readFileSync(file, 'utf8'));
  stored.change.loosened[0].after = 'read';
  writeFileSync(file, JSON.stringify(stored));
  // Its content digest no longer recomputes: the record is corrupt, and says only that.
  await assert.rejects(
    beginChangeApproval(core, prepared.approvalId, { surface: 'cli' }),
    refusedWith('APPROVAL_VOID', /is corrupt \(content-digest-mismatch\)/),
  );

  // A send's approval is not approved here.
  const send = await core.approvals.create({
    channel: 'gmail',
    inboxId: MAIL,
    draftId: 'r-1',
    draftMessageId: 'm-1',
    contentDigest: 'd'.repeat(64),
    sendEpoch: 0,
    policy: 'confirm',
    requiredPolicy: 'confirm',
    riskFlags: [],
    expect: { to: ['sam@partner.test'], cc: [], bcc: [], subject: 'hi' },
  });
  // Another kind's id is the one NOT_FOUND (design 2026-10-05 §D2), byte for byte an id nobody prepared, before
  // anything of the record is classified or shown — at the terminal too.
  const envelope = async (id: string) => {
    const error = await beginChangeApproval(core, id, { surface: 'cli' }).then(
      () => assert.fail('refused'),
      (refused: unknown) => refused as CommsError,
    );
    assert.equal(error.code, 'NOT_FOUND', error.message);
    return JSON.stringify({ message: error.message, hint: error.hint, details: error.details }).replaceAll(id, 'ID');
  };
  assert.equal(await envelope(send.approvalId), await envelope(`ap_${'7'.repeat(26)}`));
  assert.equal(asV2(await core.approvals.get(send.approvalId))?.challengeHash, undefined, 'no challenge was issued');
});

test('every step is in the audit trail: surface, policy and outcome', async () => {
  const { core } = coreWith({ defaults: { changePolicy: 'confirm' }, accounts: { 'acme/slack': account(ACME) } });
  const spec = await widening(core);
  const prepared = await prepareChange(
    core,
    { ...spec, summary: 'Let acme/slack post' },
    { channel: 'core', surface: 'mcp' },
  );
  await claimChange(core, prepared.approvalId, spec, { surface: 'mcp' }).catch(() => undefined);
  await assert.rejects(finishChangeApproval(core, prepared.approvalId, 'ZZZZ', { surface: 'cli' }));
  const prompt = await beginChangeApproval(core, prepared.approvalId, { surface: 'cli' });
  await assert.rejects(finishChangeApproval(core, prepared.approvalId, 'ZZZZ', { surface: 'cli' }));
  await finishChangeApproval(core, prepared.approvalId, prompt.challenge, { surface: 'cli' });
  await claimChange(core, prepared.approvalId, spec, { surface: 'mcp' });

  const lines = (await core.audit.tail()).map((line) => ({
    operation: line.operation,
    outcome: line.outcome,
    surface: line.surface,
    policy: line.policy,
    approvalId: line.approvalId,
    inboxId: line.inboxId,
    alias: line.alias,
  }));
  const on = { approvalId: prepared.approvalId, inboxId: ACME, alias: 'acme/slack', policy: 'confirm' };
  assert.deepEqual(lines, [
    { operation: 'change.prepare', outcome: 'ok', surface: 'mcp', ...on },
    { operation: 'change.claim', outcome: 'refused', surface: 'mcp', ...on },
    { operation: 'change.approve', outcome: 'refused', surface: 'cli', ...on },
    { operation: 'change.approve', outcome: 'refused', surface: 'cli', ...on },
    { operation: 'change.approve', outcome: 'ok', surface: 'cli', ...on },
    { operation: 'change.claim', outcome: 'ok', surface: 'mcp', ...on },
  ]);
  const tail = await core.audit.tail();
  assert.match(tail[1]?.reason ?? '', /needs a person to approve it at a terminal first/);
  assert.match(tail[3]?.reason ?? '', /the challenge did not match/);
  assert.deepEqual(tail[0]?.ids, { paths: ['accounts.acme/slack.mode'] });
});

/* ---------------------------------------------------------------------------------------------------------------- */
/* `agentcomms approve`                                                                                               */
/* ---------------------------------------------------------------------------------------------------------------- */

/** Streams that are a terminal, and a person at it who types whatever `answer` returns for the code shown. */
function terminal(answer: (challenge: string) => string) {
  const stdin = Object.assign(new PassThrough(), { isTTY: true });
  const stdout = Object.assign(new PassThrough(), { isTTY: true });
  const stderr = new PassThrough();
  let shown = '';
  stdout.on('data', (chunk) => {
    shown += String(chunk);
  });
  stderr.on('data', (chunk) => {
    const asked = /Type (\w{4}) to approve this change/.exec(String(chunk));
    if (asked?.[1]) stdin.write(`${answer(asked[1])}\n`);
  });
  return { streams: { stdin, stdout, stderr } as unknown as Streams, shown: () => shown };
}

test('agentcomms approve: a person reads the change and types the code; Enter cancels it', async () => {
  const { approveChangeAtTerminal } = await import('../src/change-flow.ts');
  const { core } = coreWith({ defaults: { changePolicy: 'confirm' }, accounts: { 'acme/slack': account(ACME) } });
  const spec = await widening(core);

  const first = await prepareChange(
    core,
    { ...spec, summary: 'Let acme/slack post' },
    { channel: 'core', surface: 'mcp' },
  );
  const person = terminal((code) => code);
  const approved = await approveChangeAtTerminal(core, first.approvalId, {}, { color: false }, person.streams);
  assert.deepEqual(approved, { approvalId: first.approvalId, state: 'approved' });
  assert.match(person.shown(), /CHANGE PREVIEW/);
  assert.match(person.shown(), /acme\/slack mode: read → send/);
  const record = asV2(await core.approvals.get(first.approvalId));
  assert.equal(record?.state, 'approved');
  assert.equal(record?.approvedVia, 'terminal');

  const second = await prepareChange(
    core,
    { ...spec, summary: 'Let acme/slack post' },
    { channel: 'core', surface: 'mcp' },
  );
  const declines = terminal(() => '');
  const cancelled = await approveChangeAtTerminal(core, second.approvalId, {}, { color: false }, declines.streams);
  assert.equal(cancelled.state, 'cancelled');
  assert.equal(asV2(await core.approvals.get(second.approvalId))?.state, 'revoked');
});

test("the terminal's approve renders its handoff for the selected shell platform", async () => {
  const { approveChangeAtTerminal } = await import('../src/change-flow.ts');
  const { core } = coreWith({});
  const approve = coreHandoffs(core.paths, 'win32').own(['approve', '7']);
  assert.ok(isCommand(approve) && / approve "7"$/.test(approve.line ?? ''), JSON.stringify(approve));
  await assert.rejects(
    approveChangeAtTerminal(core, '7', { CODEX_SANDBOX: '1' }, { color: false, platform: 'win32' }),
    (error: unknown) => {
      assert.ok(error instanceof CommsError);
      assert.equal(error.hint, `Ask the user to run ${inlineCommand(approve)} in their own terminal.`);
      return true;
    },
  );
});

test("change approval handoffs render this installation's own approve for the selected shell platform", async () => {
  const { core } = coreWith({ defaults: { changePolicy: 'confirm' }, accounts: { 'acme/slack': account(ACME) } });
  const spec = await widening(core);
  const prepared = await prepareChange(
    core,
    { ...spec, summary: 'Let acme/slack post' },
    { channel: 'core', surface: 'mcp', platform: 'win32' },
  );
  const approve = coreHandoffs(core.paths, 'win32').own(['approve', prepared.approvalId]);
  assert.ok(isCommand(approve));
  assert.ok(prepared.next.includes(inlineCommand(approve)), prepared.next);
  await assert.rejects(
    claimChange(core, prepared.approvalId, spec, { surface: 'mcp', platform: 'win32' }),
    (error: unknown) => {
      assert.ok(error instanceof CommsError);
      assert.ok(error.hint?.includes(inlineCommand(approve)), error.hint);
      return true;
    },
  );
});

// ── A change an earlier release prepared (version 1) ─────────────────────────────────────────────────────────────

test('a person’s revoke of a v1 change writes a v1-shaped revoked', async () => {
  const { core, dir } = coreWith({ accounts: { 'acme/slack': account(ACME) } });
  void dir;
  const change = {
    summary: 'Let acme/slack post',
    target: { kind: 'account', name: 'acme/slack', id: ACME },
    loosened: [{ path: 'accounts.acme/slack.mode', before: 'read', after: 'send', id: ACME }],
    effects: ['signs in to Slack again'],
  };
  const approvalId = `ap_${'0'.repeat(25)}5`;
  const original = v1ChangeRecord({
    approvalId,
    digest: changeDigest(change as never),
    change,
    createdAt: '2026-09-25T09:59:00.000Z',
  });
  writeV1Record(core.paths.stateDir, original);
  // Through what `agentcomms approvals revoke <id>` and `comms_approval_revoke` call.
  const view = await revokeApproval(core, approvalId, 'cli');
  assert.equal(view.state, 'revoked');
  const after = JSON.parse(readV1Record(core.paths.stateDir, approvalId)) as Record<string, unknown>;
  assert.equal(after.digestVersion, 1);
  assert.deepStrictEqual(after, {
    ...original,
    state: 'revoked',
    reason: 'revoked by the user',
    updatedAt: '2026-09-25T10:00:00.000Z',
  });
  assert.equal(existsSync(v1RecordPath(core.paths.stateDir, approvalId, '.claim')), false, 'no claim marker');
  const row = (await core.audit.tail({ limit: 10 })).find((line) => line.operation === 'change.revoke');
  assert.equal(row?.approvalId, approvalId, 'the revoke is audited');
  assert.equal(row?.outcome, 'ok');
});

test('a v1 change is never approved at a terminal or claimed here, and nothing is written to it', async () => {
  const { core } = coreWith({ accounts: { 'acme/slack': account(ACME, { mode: 'read' }) } });
  const spec = await widening(core);
  const prepared = await prepareChange(
    core,
    { ...spec, summary: 'Let acme/slack post' },
    { channel: 'core', surface: 'mcp' },
  );
  const stored = asV2(await core.approvals.get(prepared.approvalId));
  assert.ok(stored?.change);
  for (const [moment, createdAt] of [
    ['fresh', '2026-09-25T09:59:00.000Z'],
    ['past its original expiry', '2026-09-25T09:40:00.000Z'],
  ] as const) {
    const approvalId = `ap_${'0'.repeat(25)}${moment === 'fresh' ? '6' : '7'}`;
    const bytes = writeV1Record(
      core.paths.stateDir,
      v1ChangeRecord({ approvalId, digest: stored.contentDigest, change: { ...stored.change }, createdAt }),
    );
    const version = refusedWith('APPROVAL_VOID', /prepared by a different version of agent-communications/);
    await assert.rejects(beginChangeApproval(core, approvalId, { surface: 'cli' }), version, `begin, ${moment}`);
    await assert.rejects(
      finishChangeApproval(core, approvalId, 'ABCD', { surface: 'cli' }),
      version,
      `finish, ${moment}`,
    );
    await assert.rejects(claimChange(core, approvalId, spec, { surface: 'mcp' }), version, `claim, ${moment}`);
    assert.equal(readV1Record(core.paths.stateDir, approvalId), bytes, `${moment}: byte-identical`);
    assert.equal(existsSync(v1RecordPath(core.paths.stateDir, approvalId, '.claim')), false, `${moment}: no marker`);
  }
});

/* ---------------------------------------------------------------------------------------------------------------- */
/* Every surface classifies before it acts, and says where the approval stands (CUE-404 Task 9; design §D2, §D8)      */
/* ---------------------------------------------------------------------------------------------------------------- */

/** A change as every surface runs it (`gatedChange`): `plan`, then `after` written with the consent its claim gave. */
function applying(core: Core, plan: (config: Config) => ChangeRequest) {
  return {
    plan,
    apply: async (consent: LooseningConsent | undefined, request: ChangeRequest) => {
      await core.config.update(() => structuredClone(request.after), consent === undefined ? {} : { consent });
      return 'applied';
    },
  };
}

test('a global or prospective change is never owner-removed: prepared pending, claimable by its route, approved and applied, under chat and under confirm (R34a)', async () => {
  const { gatedChange } = await import('../src/change-flow.ts');
  const cases: Record<
    string,
    { policy: 'chat' | 'confirm'; scope: 'global' | 'prospective'; plan: (c: Config) => ChangeRequest }
  > = {
    'the default change policy, confirm → chat': {
      policy: 'confirm',
      scope: 'global',
      plan: (before) => {
        const after = structuredClone(before);
        after.defaults.changePolicy = 'chat';
        return { before, after, summary: 'Let a yes in the chat loosen settings' };
      },
    },
    'the daily update check, turned off': {
      policy: 'chat',
      scope: 'global',
      plan: (before) => {
        const after = structuredClone(before);
        after.defaults.updateCheck = 'off';
        return { before, after, summary: 'Stop asking npm for releases' };
      },
    },
    ...Object.fromEntries(
      (['chat', 'confirm'] as const).flatMap((policy) => [
        [
          `an installer change, under ${policy}`,
          {
            policy,
            scope: 'global' as const,
            plan: (before: Config) => ({
              before,
              after: structuredClone(before),
              effects: ['registers the Gmail MCP server with cursor'],
              summary: 'Register the Gmail server',
            }),
          },
        ],
        [
          `a first connection, under ${policy}`,
          {
            policy,
            scope: 'prospective' as const,
            plan: (before: Config) => {
              const after = structuredClone(before);
              after.inboxes['new/gmail'] = inbox('ibx_NNNNNNNNNNNNNNNN');
              return {
                inbox: 'new/gmail',
                before,
                after,
                effects: ['signs in to Gmail'],
                summary: 'Connect new/gmail',
              };
            },
          },
        ],
      ]),
    ),
  };
  for (const [label, spec] of Object.entries(cases)) {
    const { core } = coreWith({
      defaults: { changePolicy: spec.policy },
      accounts: { 'acme/slack': account(ACME) },
    });
    const change = applying(core, spec.plan);
    const first = await gatedChange(core, change, { channel: 'core', surface: 'mcp' });
    assert.equal(first.status, 'approval-required', label);
    const prepared = (first as { prepared: PreparedChange }).prepared;
    // Prepared: pending, on its route, claimable in the chat only on the chat route, and never owner-removed.
    assert.equal(prepared.approval.state, 'pending', label);
    assert.equal(prepared.approval.route, spec.policy, label);
    assert.equal(prepared.approval.claimable, spec.policy === 'chat', label);
    assert.equal(prepared.approval.ownerRemoved, undefined, label);
    const looked = await core.approvals.inspect(prepared.approvalId, { kind: 'change' });
    assert.deepEqual(looked.outcome.approval, prepared.approval, `${label}: status says the same`);
    assert.equal(asV2(looked.stored)?.ownerScope, spec.scope, label);
    if (spec.policy === 'confirm') {
      await assert.rejects(
        gatedChange(core, change, { channel: 'core', surface: 'mcp', approvalId: prepared.approvalId }),
        (error: unknown) => {
          assert.ok(error instanceof CommsError && error.code === 'APPROVAL_PENDING', `${label}: ${String(error)}`);
          const approval = error.details?.approval as { state?: string; claimable?: boolean };
          assert.equal(approval.state, 'pending', label);
          assert.equal(approval.claimable, false, label);
          return true;
        },
      );
      const prompt = await beginChangeApproval(core, prepared.approvalId, { surface: 'cli' });
      await finishChangeApproval(core, prepared.approvalId, prompt.challenge, { surface: 'cli' });
      const approved = (await core.approvals.inspect(prepared.approvalId, { kind: 'change' })).outcome.approval;
      assert.equal(approved.state, 'approved', label);
      assert.equal(approved.claimable, true, label);
      assert.equal(approved.ownerRemoved, undefined, label);
    }
    const second = await gatedChange(core, change, {
      channel: 'core',
      surface: 'mcp',
      approvalId: prepared.approvalId,
    });
    assert.deepEqual(second, { status: 'applied', result: 'applied' }, label);
    const used = (await core.approvals.inspect(prepared.approvalId, { kind: 'change' })).outcome.approval;
    assert.equal(used.state, 'used', label);
    assert.equal(used.ownerRemoved, undefined, label);
  }
});

test('an owner change whose account is then removed is owner-removed: shown revoked, refused, and revoked by the first action (R34b)', async () => {
  const { core, write } = coreWith({ accounts: { 'acme/slack': account(ACME) } });
  const spec = await widening(core);
  const prepared = await prepareChange(
    core,
    { ...spec, summary: 'Let acme/slack post' },
    { channel: 'core', surface: 'mcp' },
  );
  assert.equal(prepared.approval.ownerRemoved, undefined);
  write({});
  const seen = await core.approvals.inspect(prepared.approvalId, { kind: 'change' });
  assert.equal(seen.outcome.approval.state, 'revoked');
  assert.equal(seen.outcome.approval.ownerRemoved, true);
  assert.equal(seen.outcome.approval.claimable, false);
  assert.equal(asV2(await core.approvals.get(prepared.approvalId))?.state, 'pending', 'a look writes no revocation');
  // The terminal refuses it before showing it, and that first action writes the revocation.
  await assert.rejects(beginChangeApproval(core, prepared.approvalId, { surface: 'cli' }), (error: unknown) => {
    assert.ok(error instanceof CommsError && error.code === 'APPROVAL_VOID', String(error));
    assert.match(error.message, /its mailbox or account was removed/);
    assert.equal((error.details?.approval as { ownerRemoved?: boolean } | undefined)?.ownerRemoved, true);
    return true;
  });
  assert.equal(asV2(await core.approvals.get(prepared.approvalId))?.state, 'revoked');
});

test('the change surfaces find another kind’s id, a corrupt one of another kind and an id nobody prepared as the one NOT_FOUND, with approval null, before classifying it (D2-b)', async () => {
  const { core } = coreWith({ inboxes: { 'acme/gmail': inbox(MAIL) }, accounts: { 'acme/slack': account(ACME) } });
  const spec = await widening(core);
  const send = await core.approvals.create({
    channel: 'gmail',
    inboxId: MAIL,
    draftId: 'r-1',
    draftMessageId: 'm-1',
    contentDigest: 'd'.repeat(64),
    sendEpoch: 0,
    policy: 'chat',
    requiredPolicy: 'chat',
    riskFlags: [],
    expect: { to: ['sam@partner.test'], cc: [], bcc: [], subject: 'hi' },
  });
  // A send whose timestamps are wrong: corrupt, with its binding intact, so its kind is still known. Classified, it
  // would be refused as corrupt — so a NOT_FOUND here is one given before it was classified.
  const corrupt = await core.approvals.create({ ...send, sendEpoch: 0, inboxSub: undefined } as never);
  const file = join(core.approvals.directory, `${corrupt.approvalId}.json`);
  writeFileSync(
    file,
    JSON.stringify({ ...JSON.parse(readFileSync(file, 'utf8')), expiresAt: '2026-09-25T10:03:00.000Z' }),
  );
  const corruptBytes = readFileSync(file, 'utf8');
  const unknown = `ap_${'7'.repeat(26)}`;
  const attempts: Record<string, (id: string) => Promise<unknown>> = {
    claim: (id) => claimChange(core, id, spec, { surface: 'mcp' }),
    begin: (id) => beginChangeApproval(core, id, { surface: 'cli' }),
    finish: (id) => finishChangeApproval(core, id, 'ABCD', { surface: 'cli' }),
  };
  for (const [step, attempt] of Object.entries(attempts)) {
    const envelopes = [];
    for (const id of [unknown, send.approvalId, corrupt.approvalId]) {
      const error = await attempt(id).then(
        () => assert.fail(`${step} refused`),
        (refused: unknown) => refused as CommsError,
      );
      assert.equal(error.code, 'NOT_FOUND', `${step}: ${error.message}`);
      assert.deepEqual(error.details, { approval: null }, step);
      envelopes.push(JSON.stringify({ m: error.message, h: error.hint, d: error.details }).replaceAll(id, 'ID'));
    }
    assert.equal(new Set(envelopes).size, 1, `${step}: one envelope, byte for byte`);
  }
  assert.equal(asV2(await core.approvals.get(send.approvalId))?.state, 'pending', 'the send is as it was');
  assert.equal(asV2(await core.approvals.get(send.approvalId))?.challengeHash, undefined, 'no challenge issued');
  assert.equal(readFileSync(file, 'utf8'), corruptBytes, 'the corrupt record is as it was');
});

test('a change says where its approval stands on every result and refusal; one refused before it exists says nothing of one (D8o-a, D8o-b, D8o-d)', async () => {
  const { core, time } = coreWith({ defaults: { changePolicy: 'confirm' }, accounts: { 'acme/slack': account(ACME) } });
  const spec = await widening(core);
  // Refused before any approval exists: no object.
  for (const request of [
    { ...spec, summary: '' },
    { before: spec.before, after: spec.before, summary: 'nothing' },
  ]) {
    await assert.rejects(prepareChange(core, request, { channel: 'core', surface: 'mcp' }), (error: unknown) => {
      assert.ok(error instanceof CommsError && error.code === 'USAGE', String(error));
      assert.equal(error.details?.approval, undefined, 'no approval exists to say anything of');
      return true;
    });
  }
  const prepared = await prepareChange(
    core,
    { ...spec, summary: 'Let acme/slack post' },
    { channel: 'core', surface: 'mcp' },
  );
  assert.equal(prepared.approval.id, prepared.approvalId);
  assert.equal(prepared.approval.kind, 'change');
  assert.equal(prepared.approval.state, 'pending');
  assert.equal(prepared.approval.expiresAt, prepared.expiresAt);
  // Waiting for the terminal: refused, with the record as it stands.
  await assert.rejects(claimChange(core, prepared.approvalId, spec, { surface: 'mcp' }), (error: unknown) => {
    assert.ok(error instanceof CommsError && error.code === 'APPROVAL_PENDING', String(error));
    assert.equal((error.details?.approval as { state?: string } | undefined)?.state, 'pending');
    return true;
  });
  const prompt = await beginChangeApproval(core, prepared.approvalId, { surface: 'cli' });
  const approved = await finishChangeApproval(core, prepared.approvalId, prompt.challenge, { surface: 'cli' });
  // Approved, and then a day passes unused: expired after approval, said so, with when it was approved.
  time.advance(24 * 60 * 60 * 1000 + 60_000);
  await assert.rejects(claimChange(core, prepared.approvalId, spec, { surface: 'mcp' }), (error: unknown) => {
    assert.ok(error instanceof CommsError && error.code === 'APPROVAL_EXPIRED', String(error));
    assert.match(
      error.message,
      /this approval expired; nothing was changed with it: approved at .*, expired unused at /,
    );
    const approval = error.details?.approval as { state?: string; approvedAt?: string; expiredAt?: string };
    assert.equal(approval.state, 'expired');
    assert.equal(approval.approvedAt, approved.approvedAt);
    assert.equal(approval.expiredAt, approved.usableUntil);
    return true;
  });
  // A voided claim says it is revoked, and why.
  const again = await prepareChange(
    core,
    { ...spec, summary: 'Let acme/slack post' },
    { channel: 'core', surface: 'mcp' },
  );
  const other = await widening(core);
  other.effects = ['something else'];
  await assert.rejects(claimChange(core, again.approvalId, other, { surface: 'mcp' }), (error: unknown) => {
    assert.ok(error instanceof CommsError && error.code === 'APPROVAL_VOID', String(error));
    const approval = error.details?.approval as { state?: string; reason?: string; revokedAt?: string };
    assert.equal(approval.state, 'revoked');
    assert.ok(approval.revokedAt);
    return true;
  });
});
