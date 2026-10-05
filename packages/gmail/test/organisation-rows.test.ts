import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { test } from 'node:test';
import { CommsError, gatedChange, inlineCommand, isCommand, type ResolvedPaths } from '@agentcomms/core';
import { clientSecretRef } from '../src/auth/session.ts';
import { GmailContext } from '../src/context.ts';
import { clientAdd, clientAddChange, clientRemove } from '../src/operations/clients.ts';
import { gmailHandoffs, locatedCoreLine } from './support/handoffs.ts';
import { newHarness, tempDir } from './support/harness.ts';
import { connect, toolError } from './support/surfaces.ts';

/*
 * A client an organisation profile made is the profile's to change (design 2026-10-02 §D4): in this release `client add
 * --replace` and `client remove` refuse a row that carries `organisation`, and point at `agentcomms org update` and
 * `agentcomms org remove`. A client the person registered — or one whose mark names an organisation with no profile
 * here, which no `org` command could change — is theirs, exactly as before.
 */

const ORG_CLIENT = '111111111111-aaaaaaaaaaaa.apps.googleusercontent.com';
const ORG_SECRET = 'fake-organisation-secret-not-real';
const CREATED = '2026-09-20T00:00:00.000Z';

/** A version-2 configuration holding the client `acme-1` that the profile `acme` owns — or only its mark. */
async function withOrganisationRow(options: { record: boolean; organisation?: string; platform?: NodeJS.Platform }) {
  const harness = await newHarness();
  const organisation = options.organisation ?? 'acme';
  const row = {
    provider: 'gmail',
    clientId: ORG_CLIENT,
    secretRef: clientSecretRef('acme-1'),
    addedAt: CREATED,
    organisation,
  };
  const organisations = {
    [organisation]: {
      label: 'Acme Test Org',
      source: { kind: 'file', path: join(harness.configDir, 'acme.agentcomms.json') },
      sha256: 'a'.repeat(64),
      readAt: CREATED,
      addedAt: CREATED,
      forOtherAddresses: false,
      gmail: {
        active: 'acme-1',
        generations: [{ name: 'acme-1', clientId: ORG_CLIENT, ownership: 'owned', serves: 'any', addedAt: CREATED }],
      },
    },
  };
  await writeFile(
    join(harness.configDir, 'config.json'),
    `${JSON.stringify(
      {
        version: 2,
        secrets: { store: 'file' },
        clients: { 'acme-1': row },
        ...(options.record ? { organisations } : {}),
      },
      null,
      2,
    )}\n`,
  );
  await (await harness.core.secrets('file')).set(clientSecretRef('acme-1'), ORG_SECRET);
  return {
    harness,
    context: new GmailContext({
      core: harness.core,
      env: harness.env,
      platform: options.platform ?? 'darwin',
    }),
    row,
  };
}

async function clientFile(clientId = ORG_CLIENT): Promise<string> {
  const path = join(tempDir(), 'client_secret.json');
  await writeFile(path, JSON.stringify({ installed: { client_id: clientId, client_secret: 'fake-other-secret' } }));
  return path;
}

function refusedFor(act: 'replace' | 'remove') {
  return (error: unknown) => {
    assert.ok(error instanceof CommsError, String(error));
    assert.equal(error.code, 'CONFIG');
    assert.match(error.message, /belongs to the organisation profile "acme"/);
    // Core's own command, located through Gmail's dependency on core (CUE-403).
    locatedCoreLine(error.hint ?? '', ['org', act === 'replace' ? 'update' : 'remove', 'acme']);
    return true;
  };
}

test('client remove refuses a client an organisation profile owns, from the command, the tool and the change', async () => {
  const { harness, context, row } = await withOrganisationRow({ record: true });
  await assert.rejects(clientRemove(context, 'acme-1'), refusedFor('remove'));
  const { call, close } = await connect({ core: harness.core, env: harness.env });
  try {
    const refused = toolError(await call('gmail_client_remove', { name: 'acme-1' }));
    assert.match(refused.message, /belongs to the organisation profile "acme"/);
  } finally {
    await close();
  }
  assert.deepEqual((await harness.core.config.load()).clients['acme-1'], row);
  assert.equal(await (await harness.core.secrets('file')).get(clientSecretRef('acme-1')), ORG_SECRET);
});

test('organisation-owned client refusals quote org update and remove for darwin and win32', async () => {
  for (const platform of ['darwin', 'win32'] as const) {
    // Core's own commands, located from Gmail through its dependency on core and quoted for the platform (CUE-403).
    const core = (paths: ResolvedPaths, words: string[]) => {
      const handoff = gmailHandoffs(paths, platform).core(words);
      assert.ok(isCommand(handoff), 'message' in handoff ? handoff.message : '');
      return inlineCommand(handoff);
    };
    const replacement = await withOrganisationRow({ record: true, organisation: '7', platform });
    const update = core(replacement.harness.core.paths, ['org', 'update', '7']);

    await assert.rejects(
      clientAdd(replacement.context, {
        path: await clientFile(),
        name: 'acme-1',
        replace: true,
        store: 'file',
        noProbe: true,
      }),
      (error: unknown) => {
        assert.ok(error instanceof CommsError);
        assert.equal(
          error.hint,
          `To read the profile again — a new secret, a repaired client — run ${update}. To register a client of your own, choose another name with --name.`,
          platform,
        );
        return true;
      },
    );

    const removal = await withOrganisationRow({ record: true, organisation: '7', platform });
    const paths = removal.harness.core.paths;
    await assert.rejects(clientRemove(removal.context, 'acme-1'), (error: unknown) => {
      assert.ok(error instanceof CommsError);
      assert.equal(
        error.hint,
        `To stop using the organisation's apps, run ${core(paths, ['org', 'remove', '7'])}; if the client has drifted from the profile, ${core(paths, ['org', 'update', '7'])} repairs it.`,
        platform,
      );
      return true;
    });
  }
});

test('client add refuses to replace a client an organisation profile owns, with --replace or without', async () => {
  const { harness, context, row } = await withOrganisationRow({ record: true });
  const path = await clientFile();
  await assert.rejects(
    clientAdd(context, { path, name: 'acme-1', replace: true, store: 'file', noProbe: true }),
    refusedFor('replace'),
  );
  await assert.rejects(
    clientAdd(context, { path, name: 'acme-1', store: 'file', noProbe: true }),
    refusedFor('replace'),
  );
  // Refused before anybody is asked to approve it, as every conflict is.
  await assert.rejects(
    gatedChange(harness.core, clientAddChange(context, { path, name: 'acme-1', replace: true, noProbe: true }), {
      surface: 'mcp',
    }),
    refusedFor('replace'),
  );
  assert.deepEqual((await harness.core.config.load()).clients['acme-1'], row);
  assert.equal(await (await harness.core.secrets('file')).get(clientSecretRef('acme-1')), ORG_SECRET);
  // A name of the person's own is registered as it always was.
  const other = await clientAdd(context, { path, name: 'desktop', store: 'file', noProbe: true });
  assert.equal(other.name, 'desktop');
});

test('the refusal holds under the lock: a profile that took the name while a replacement ran is not overwritten', async () => {
  const { harness, context } = await withOrganisationRow({ record: true });
  // The row starts as the person's: no mark, so the replacement is planned and begins.
  const configPath = join(harness.configDir, 'config.json');
  const raw = JSON.parse(await readFile(configPath, 'utf8'));
  delete raw.clients['acme-1'].organisation;
  await writeFile(configPath, `${JSON.stringify(raw, null, 2)}\n`);
  // Meanwhile — after every check made before the credentials lock, as the secret store is opened — `org update acme`
  // marks it as the profile's again.
  const secrets = harness.core.secrets.bind(harness.core);
  let marked = false;
  harness.core.secrets = async (kind) => {
    if (!marked) {
      marked = true;
      raw.clients['acme-1'].organisation = 'acme';
      await writeFile(configPath, `${JSON.stringify(raw, null, 2)}\n`);
    }
    return secrets(kind);
  };
  await assert.rejects(
    clientAdd(context, { path: await clientFile(), name: 'acme-1', replace: true, store: 'file', noProbe: true }),
    refusedFor('replace'),
  );
  assert.ok(marked, 'the mark landed while the replacement ran');
  harness.core.secrets = secrets;
  assert.equal(await (await harness.core.secrets('file')).get(clientSecretRef('acme-1')), ORG_SECRET);
});

test('a mark naming an organisation with no profile here refuses nothing: the row is a client of the person’s', async () => {
  const { harness, context } = await withOrganisationRow({ record: false });
  await clientAdd(context, { path: await clientFile(), name: 'acme-1', replace: true, store: 'file', noProbe: true });
  assert.equal(await (await harness.core.secrets('file')).get(clientSecretRef('acme-1')), 'fake-other-secret');
  await clientRemove(context, 'acme-1');
  assert.equal((await harness.core.config.load()).clients['acme-1'], undefined);
});
