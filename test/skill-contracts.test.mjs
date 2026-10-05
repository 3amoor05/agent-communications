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

test('the Gmail Cloud walkthrough acknowledges organisation-provided clients', async () => {
  const guide = await readFile(join(SKILLS, 'gmail-setup', 'references', 'google-cloud-setup.md'), 'utf8');
  assert.doesNotMatch(guide, /There is no shared client to borrow\./);
  assert.match(guide, /organisation.*provide.*client/is);
  assert.match(guide, /organisation profile/i);
});

test('Slack setup documents profile apps and own apps as distinct paths', async () => {
  const cases = [
    {
      file: '_shared/contract-comms.md',
      required: [
        /organisation profile.*read.*send.*apps/is,
        /own app.*manifest|own app.*api\.slack\.com/is,
        /do not ask.*edit or uninstall.*organisation apps/is,
      ],
    },
    {
      file: '_shared/contract-slack.md',
      required: [/organisation provenance.*signing.*other app.*profile/is, /own app.*manifest/is, /own app.*remov/is],
    },
    {
      file: 'comms-onboarding/SKILL.md',
      required: [
        /Gmail picks the eligible client before consent/,
        /Slack.*automatically.*profile.*read.*send/is,
        /slack_workspace_add.*rgc\/slack/is,
        /agent-slack workspace add rgc\/slack/,
      ],
    },
    {
      file: 'slack-setup/SKILL.md',
      required: [
        /profile.*read app.*send app/is,
        /read.*send.*profile.*sign.in/is,
        /send.*read.*profile.*sign.in/is,
        /own.app.*manifest/is,
        /own.app.*remov/is,
        /administrator.*approve.*app/is,
        /cancel.*finish/is,
        /pending.*access.*refresh/is,
        /doctor.*retr/is,
      ],
    },
  ];

  for (const { file, required } of cases) {
    const prose = await readFile(join(SKILLS, file), 'utf8');
    for (const pattern of required) assert.match(prose, pattern, `${file}: missing ${pattern}`);
    assert.doesNotMatch(
      prose,
      /not used by `slack_workspace_add` yet|comes in a later release|`workspace add` does not use the profile by itself/i,
      `${file}: stale release promise`,
    );
  }

  for (const file of ['comms-onboarding/SKILL.md', 'slack-setup/SKILL.md']) {
    const prose = await readFile(join(SKILLS, file), 'utf8');
    const profiles = [...prose.matchAll(/^.*agent-slack workspace add rgc\/slack.*$/gm)].map(([line]) => line);
    assert.ok(profiles.length > 0, `${file}: profile CLI example is missing`);
    for (const profile of profiles) {
      assert.doesNotMatch(profile, /--client-id|--port/, `${file}: profile CLI example must select its app and port`);
    }
    const ownApp = prose.match(/^.*agent-slack workspace add (?:acme\/slack|<name>).*--client-id.*$/m)?.[0];
    assert.ok(ownApp, `${file}: own-app CLI example is missing`);
    assert.match(ownApp, /--client-id\s+\S+.*--port\s+\S+/, `${file}: own-app example needs client id and port`);
  }
});

test('Slack mode guidance keeps each account path and consent step in its own section', async () => {
  const setup = await readFile(join(SKILLS, 'slack-setup', 'SKILL.md'), 'utf8');
  const onboarding = await readFile(join(SKILLS, 'comms-onboarding', 'SKILL.md'), 'utf8');

  function between(text, start, end, label) {
    const from = text.indexOf(start);
    assert.notEqual(from, -1, `${label}: start marker missing`);
    const to = text.indexOf(end, from + start.length);
    assert.notEqual(to, -1, `${label}: end marker missing`);
    return text.slice(from + start.length, to);
  }

  const send = between(setup, '## Moving a workspace to `send`', '## Going back to `read`', 'send mode');
  const read = between(setup, '## Going back to `read`', '## Removing a workspace', 'read mode');
  const cases = [
    {
      label: 'profile read to send',
      text: between(send, 'For an account with organisation provenance', "For a person's own app", 'profile send'),
      required: [
        /profile's send app/i,
        /send app after approval/i,
        /Slack consent/i,
        /slack_workspace_finish/,
        /No manifest edit.*app update.*--app-updated/is,
      ],
    },
    {
      label: 'own-app read to send',
      text: between(send, "For a person's own app", 'If Slack grants no posting scope', 'own-app send'),
      required: [
        /manifest.*`send`/is,
        /--app-updated/,
        /change approval/i,
        /approves that in\s+Slack/i,
        /slack_workspace_finish/,
      ],
    },
    {
      label: 'profile send to read',
      text: between(read, 'For an account with organisation provenance', "For a person's own app", 'profile read'),
      required: [
        /starts immediately through the profile's read app/i,
        /Slack consent/i,
        /slack_workspace_finish/,
        /no\s+change approval, manifest replacement, or app removal/i,
      ],
    },
    {
      label: 'own-app send to read',
      text: between(read, "For a person's own app", 'For an own-app account', 'own-app read'),
      required: [
        /replace the app's manifest with the `read` one/i,
        /Remove app/i,
        /workspace reauth.*--mode read/i,
        /Slack consent/i,
      ],
    },
    {
      label: 'onboarding direct profile move',
      text: between(
        onboarding,
        '- **Slack, with an organisation profile added:**',
        '- **Slack, without one:**',
        'onboarding profile',
      ),
      required: [
        /moves the account\s+directly between the profile's read and send apps through another sign-in/i,
        /neither app is edited/i,
      ],
    },
  ];

  for (const { label, text, required } of cases) {
    for (const pattern of required) assert.match(text, pattern, `${label}: missing ${pattern}`);
  }
});

test('every channel’s contract says a command for a person is the one a result gives, or why there is none (CUE-403)', async () => {
  // From the registry: a new channel's contract has to say it from its first commit.
  for (const family of REGISTRY.skillFamilies) {
    const prose = (await readFile(join(ROOT, family.contract), 'utf8')).replace(/\s+/g, ' ');
    const required = [
      /## \d+\. A command for a person is the one a result gives\./,
      // The first outcome: the command itself, handed over as given.
      /Hand it over exactly as given/,
      /Never write one yourself/,
      // The second: words to type, on Windows.
      /words as JSON/,
      /C:\\Program Files/,
      // The third: none here, said, and no command put in its place.
      /not locatable here/,
      /installs or updates it the way they usually do/,
    ];
    for (const pattern of required) assert.match(prose, pattern, `${family.contract}: missing ${pattern}`);
  }
});

test('WhatsApp’s person-only commands are handed over as words, never as a bare command line (CUE-403)', async () => {
  // `add`, `remove`, `allow`, `deny` and `clear` have no tool and refuse an agent: a person runs them with the WhatsApp
  // CLI as this installation has it. A skill gives the words, never `agent-whatsapp …` as a line to paste.
  const contract = await readFile(join(ROOT, 'skills', '_shared', 'contract-whatsapp.md'), 'utf8');
  const reading = await readFile(join(SKILLS, 'whatsapp-reading', 'SKILL.md'), 'utf8');
  for (const [name, text] of [
    ['contract-whatsapp.md', contract],
    ['whatsapp-reading', reading],
  ]) {
    assert.doesNotMatch(text, /agent-whatsapp (?:add|remove|allow|deny|clear)\b/, name);
    assert.match(text.replace(/\s+/g, ' '), /`deny \+15555550102 --account personal\/whatsapp`/, name);
  }
});
