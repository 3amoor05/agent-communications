import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { ConfigStore, emptyConfig, NEW_CONFIG_VERSION } from '../src/config.ts';
import { migrateNames, planNamesMigration } from '../src/names.ts';
import { tempDir } from './helpers/temp.ts';

/**
 * This release writes version 2 — the one before it could only read it.
 *
 * The gate that held the transition shut follows the version a new config is created at, so the two can never
 * disagree: a release that creates version 2 is a release that may migrate to it, and one that creates version 1
 * may not. This is the same file that proved the shut case; it now proves the open one.
 */

test('this release creates version 2 and can migrate a version-1 config to it', async () => {
  assert.equal(NEW_CONFIG_VERSION, 2);
  assert.equal(emptyConfig().version, 2);

  const dir = tempDir('comms-gate-');
  writeFileSync(
    join(dir, 'config.json'),
    `${JSON.stringify({
      version: 1,
      inboxes: {
        work: {
          id: 'ibx_AAAAAAAAAAAAAAAA',
          provider: 'gmail',
          email: 'jo@example.test',
          identity: 'oidc',
          client: 'desktop',
          tier: 'read',
          secretRef: 'gmail:refresh:ibx_AAAAAAAAAAAAAAAA',
          createdAt: '2026-09-22T00:00:00.000Z',
        },
      },
    })}\n`,
  );
  const store = new ConfigStore(dir);
  const plan = planNamesMigration(await store.load());
  assert.equal(plan.status, 'ready');
  if (plan.status !== 'ready') return;

  const result = await migrateNames(store, plan);
  assert.equal(result.status, 'migrated');
  const written = JSON.parse(readFileSync(join(dir, 'config.json'), 'utf8'));
  assert.equal(written.version, 2);
  assert.deepEqual(Object.keys(written.inboxes), ['work/gmail']);
  assert.deepEqual(written.formerNames.inboxes.work, { name: 'work/gmail', id: 'ibx_AAAAAAAAAAAAAAAA' });
});

test('a version-3 config named the version-1 way migrates its names and stays version 3, keeping its epochs, its drain and what it does not know', async () => {
  const dir = tempDir('comms-gate-');
  const drain = { since: '2026-10-05T10:00:00.000Z', tracked: { [`ap_${'0'.repeat(25)}1`]: 'revoked' } };
  writeFileSync(
    join(dir, 'config.json'),
    `${JSON.stringify({
      version: 3,
      naming: 1,
      inboxes: {
        work: {
          id: 'ibx_AAAAAAAAAAAAAAAA',
          provider: 'gmail',
          email: 'jo@example.test',
          identity: 'oidc',
          client: 'desktop',
          tier: 'read',
          secretRef: 'gmail:refresh:ibx_AAAAAAAAAAAAAAAA',
          createdAt: '2026-09-22T00:00:00.000Z',
          laterInboxField: 'kept',
        },
      },
      defaults: { sendPolicy: 'never', laterDefault: 7 },
      sendEpochs: { ibx_AAAAAAAAAAAAAAAA: 2 },
      legacyDrain: drain,
      laterRelease: { kept: true },
    })}\n`,
  );
  const store = new ConfigStore(dir);
  const plan = planNamesMigration(await store.load());
  assert.equal(plan.status, 'ready');
  if (plan.status !== 'ready') return;

  const result = await migrateNames(store, plan);
  assert.equal(result.status, 'migrated');
  const written = JSON.parse(readFileSync(join(dir, 'config.json'), 'utf8'));
  assert.equal(written.version, 3, 'never written back as version 2');
  assert.equal(written.naming, 2);
  assert.deepEqual(Object.keys(written.inboxes), ['work/gmail']);
  assert.deepEqual(written.formerNames.inboxes.work, { name: 'work/gmail', id: 'ibx_AAAAAAAAAAAAAAAA' });
  assert.deepEqual(written.sendEpochs, { ibx_AAAAAAAAAAAAAAAA: 2 });
  assert.deepEqual(written.legacyDrain, drain);
  assert.deepEqual(written.laterRelease, { kept: true });
  assert.equal(written.defaults.laterDefault, 7);
  assert.equal(written.inboxes['work/gmail'].laterInboxField, 'kept');

  // Done once: a retry finds its own mapping in version 3.
  const again = await migrateNames(store, plan);
  assert.equal(again.status, 'already-migrated');
  assert.equal(JSON.parse(readFileSync(join(dir, 'config.json'), 'utf8')).version, 3);
});
