import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { prepareChange } from '../src/changes.ts';
import { type Config, ConfigStore, classifyChange, emptyConfig, parseConfig } from '../src/config.ts';
import { openCore } from '../src/core.ts';
import { CommsError } from '../src/errors.ts';
import { tempDir } from './helpers/temp.ts';

/*
 * An account's `mode` is a closed vocabulary: `read` or `send`, narrow to wide.
 *
 * The classifier used to flag exactly one move, `read` → `send`, and let every other word through. A channel that
 * stored `post` or `full` — or a platform this release has never heard of, whose `read` means whatever that platform
 * says it means — widened an account with nobody's consent, because nothing recognised the word as a widening. A
 * word this release does not know is now judged as the widest thing it could be, and one it knew before as the
 * narrowest, so an unknown word can only ever cost a person a question.
 */

function account(id: string, fields: Record<string, unknown> = {}) {
  return {
    id,
    platform: 'slack',
    workspace: 'T_ACME',
    userId: 'U_ME',
    tier: 'read',
    secretRef: `slack:token:${id}`,
    createdAt: '2026-09-26T00:00:00.000Z',
    ...fields,
  };
}

function withAccount(alias: string, fields: Record<string, unknown>, id = 'acc_AAAAAAAAAAAAAAAA'): Config {
  return parseConfig(JSON.stringify({ version: 1, accounts: { [alias]: account(id, fields) } }));
}

const loosened = (before: Config, after: Config): string[] => classifyChange(before, after).loosened;

test('mode: a word outside read/send on an existing account is a loosening', () => {
  const before = withAccount('acme', { mode: 'read' });
  for (const word of ['post', 'full', 'admin', 'Send', 'send ']) {
    assert.deepEqual(loosened(before, withAccount('acme', { mode: word })), ['accounts.acme.mode'], word);
  }
  // Across a reauth's new id too, which is how a reauth writes it.
  assert.deepEqual(loosened(before, withAccount('acme', { mode: 'post' }, 'acc_BBBBBBBBBBBBBBBB')), [
    'accounts.acme.mode',
  ]);
});

test('mode: a new account arriving with an unknown word is a loosening, and so is one with only a tier', () => {
  assert.deepEqual(loosened(emptyConfig(), withAccount('zed', { mode: 'full' })), ['accounts.zed.mode']);
  // An older record keeps its mode in `tier`; the same word there is the same claim.
  assert.deepEqual(loosened(emptyConfig(), withAccount('zed', { tier: 'full' })), ['accounts.zed.mode']);
});

test('mode: any mode on a platform this release does not know is a loosening', () => {
  // `read` on Slack is a token that cannot post. On a platform nothing here describes, it is only a word.
  assert.deepEqual(loosened(emptyConfig(), withAccount('zed', { platform: 'discord', mode: 'read' })), [
    'accounts.zed.mode',
  ]);
  assert.deepEqual(loosened(emptyConfig(), withAccount('zed', { platform: 'discord', tier: 'read' })), [
    'accounts.zed.mode',
  ]);
  // An account moved onto an unknown platform under the same id is measured on the platform it arrives on.
  assert.deepEqual(
    loosened(withAccount('acme', { mode: 'read' }), withAccount('acme', { platform: 'discord', mode: 'read' })),
    ['accounts.acme.mode'],
  );
});

test('mode: from a word this release does not know, only the floor is free', () => {
  const unknown = withAccount('acme', { mode: 'post' });
  // What `post` allowed cannot be told, so it counts as the narrowest: moving to `send` widens it.
  assert.deepEqual(loosened(unknown, withAccount('acme', { mode: 'send' })), ['accounts.acme.mode']);
  // Down to `read`, the floor, is a tightening whatever it was.
  assert.deepEqual(loosened(unknown, withAccount('acme', { mode: 'read' })), []);
  // And an account left exactly as it was is no change at all: nothing about it moved.
  assert.deepEqual(loosened(unknown, withAccount('acme', { mode: 'post', sendPolicy: 'never' })), []);
});

test('mode: Slack’s own words behave exactly as before', () => {
  const read = withAccount('acme', { mode: 'read' });
  const send = withAccount('acme', { mode: 'send', tier: 'send' });
  assert.deepEqual(loosened(read, send), ['accounts.acme.mode']);
  assert.deepEqual(loosened(send, read), []);
  assert.deepEqual(loosened(read, read), []);
  assert.deepEqual(loosened(send, send), []);
  assert.deepEqual(loosened(emptyConfig(), send), ['accounts.acme.mode']);
  assert.deepEqual(loosened(emptyConfig(), read), []);
  // An older record with only a tier reads the same.
  assert.deepEqual(loosened(withAccount('acme', {}), withAccount('acme', { tier: 'send' })), ['accounts.acme.mode']);
  // And the values the classifier judged are the ones an approval is bound to.
  assert.deepEqual(classifyChange(emptyConfig(), withAccount('zed', { mode: 'post' })).changes, [
    { path: 'accounts.zed.mode', before: 'read', after: 'post' },
  ]);
});

test('the store refuses an unknown mode without consent, and writes it with one', async () => {
  const store = new ConfigStore(tempDir());
  // Named for the platform, as version 2 requires of every account.
  const nameOf = (fields: Record<string, unknown>) => `zed/${String(fields.platform ?? 'slack')}`;
  const add =
    (fields: Record<string, unknown>) =>
    (config: Config): Config => ({
      ...config,
      accounts: { ...config.accounts, [nameOf(fields)]: account('acc_DDDDDDDDDDDDDDDD', fields) as never },
    });
  for (const fields of [{ mode: 'post' }, { mode: 'full' }, { platform: 'discord', mode: 'read' }]) {
    await assert.rejects(
      store.update(add(fields)),
      (error: unknown) =>
        error instanceof CommsError &&
        error.code === 'LOOSENING_REFUSED' &&
        error.message.includes(`accounts.${nameOf(fields)}.mode`),
      JSON.stringify(fields),
    );
    assert.deepEqual((await store.load()).accounts, {});
  }
  await store.update(add({ mode: 'post' }), {
    consent: { kind: 'loosening-consent', paths: ['accounts.zed/slack.mode'] },
  });
  assert.equal((await store.load()).accounts['zed/slack']?.mode, 'post');
});

test('a preview says an unknown mode cannot be judged, and keeps the sentence for send exactly as it was', async () => {
  const dir = tempDir();
  writeFileSync(
    join(dir, 'config.json'),
    JSON.stringify({ version: 2, accounts: { 'acme/slack': account('acc_AAAAAAAAAAAAAAAA', { mode: 'read' }) } }),
  );
  const core = openCore({
    env: { AGENT_COMMS_CONFIG_DIR: dir, HOME: dir },
    now: () => new Date('2026-09-26T10:00:00Z'),
  });
  const to = async (mode: string) => {
    const before = await core.config.load();
    const after = structuredClone(before);
    after.accounts['acme/slack'] = { ...account('acc_AAAAAAAAAAAAAAAA', { mode, tier: mode }) } as never;
    return (
      await prepareChange(core, { account: 'acme/slack', before, after, effects: [], summary: 'x' }, { surface: 'mcp' })
    ).preview;
  };
  assert.match(
    await to('post'),
    /acme\/slack mode: read → post — this release cannot tell what that mode allows here, so it counts as the widest there is/,
  );
  assert.match(await to('send'), /acme\/slack mode: read → send — it will be able to send, not only read$/m);
});
