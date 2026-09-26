import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { REGISTRY, skillFamilyOf } from '../scripts/channels.mjs';

/**
 * Each skill carries its own platform's contract, and nothing from another platform's.
 *
 * The three Slack skills shipped with the Gmail contract copied into them word for word: an agent following
 * `slack-reading` was told to call `gmail_inboxes_list`, that only `gmail-send` sends, and to fall back to
 * `npx @agentcomms/gmail` when the Slack tools were missing. `sync-skills --check` passed, because the copies
 * matched their source — the source was simply the wrong one. This checks the thing that was wrong.
 */

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const SKILLS = join(ROOT, 'skills');

/**
 * What one platform's skills must never name, because it belongs to another: every other channel's tools, commands,
 * packages and skills, derived from the channel registry — so a new channel's skills are checked against every other
 * channel's words, and every other channel's against its, without an entry here. The core's `comms-` skills manage
 * every channel, and may name any.
 */
const FOREIGN = Object.fromEntries(REGISTRY.skillFamilies.map((family) => [family.family, family.foreign]));

/**
 * Words beyond another channel's names that a platform's skills must not use: a Slack skill that says "mailbox" has
 * been copied from a Gmail one. Gmail's may say "workspace" — Google Workspace is a thing a mailbox belongs to.
 */
const ALSO_FOREIGN = { slack: [/\bmailbox(es)?\b/i] };

async function skills() {
  return (await readdir(SKILLS, { withFileTypes: true }))
    .filter((entry) => entry.isDirectory() && !entry.name.startsWith('_'))
    .map((entry) => entry.name)
    .sort();
}

test('every skill belongs to a channel, and carries the contract its channel names', async () => {
  for (const name of await skills()) {
    // An unknown prefix used to be `?? []` below: a skill of a platform nobody listed was simply not checked.
    const family = skillFamilyOf(REGISTRY, name);
    assert.ok(family, `${name}: no channel's manifest declares skills starting "${name.split('-')[0]}-"`);
    const source = await readFile(join(ROOT, family.contract), 'utf8');
    const copy = await readFile(join(SKILLS, name, 'references', 'contract.md'), 'utf8');
    assert.equal(copy, source, `${name} should carry ${family.contract}`);
  }
});

test('the words each family must not use include every other channel’s tools, commands and packages', () => {
  const words = (family) => FOREIGN[family].map(String).join(' ');
  assert.match(words('gmail'), /slack_/);
  assert.match(words('gmail'), /agent-slack/);
  assert.match(words('slack'), /gmail_/);
  assert.match(words('slack'), /agent-gmail/);
  assert.match(words('slack'), /gmail-send/);
  assert.deepEqual(FOREIGN.comms, []);
});

test('no skill names another platform’s tools, commands or package', async () => {
  const offenders = [];
  for (const name of await skills()) {
    const platform = skillFamilyOf(REGISTRY, name)?.family;
    assert.ok(platform, `${name} belongs to no channel`);
    const directory = join(SKILLS, name);
    for (const file of await readdir(directory, { recursive: true })) {
      if (!file.endsWith('.md')) continue;
      const text = await readFile(join(directory, file), 'utf8');
      for (const pattern of [...FOREIGN[platform], ...(ALSO_FOREIGN[platform] ?? [])]) {
        const found = pattern.exec(text);
        if (found) offenders.push(`skills/${name}/${file}: ${found[0]}`);
      }
    }
  }
  assert.deepEqual(offenders, [], `a skill that borrows another platform's words:\n${offenders.join('\n')}`);
});
