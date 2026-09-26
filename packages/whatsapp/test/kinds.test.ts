import assert from 'node:assert/strict';
import { test } from 'node:test';
import { chatKindOf, phoneOf } from '../src/source/types.ts';

/**
 * What a chat is, from its JID. The sources name three kinds of conversation — `@s.whatsapp.net`, `@lid` and `@g.us`
 * are the only ones msgvault imports — plus `@newsletter` channels (iLEAPP); a real store added per-contact
 * `<number>@status` sessions. Nothing that is not a conversation may read as one, or as `unknown`.
 */

test('every kind of JID the sources and a real store show is classified — status updates are status, not unknown', () => {
  const cases: [string, string][] = [
    ['15555550101@s.whatsapp.net', 'direct'],
    ['100000000000001@lid', 'hidden-number'],
    ['120363000000000001@g.us', 'group'],
    ['status@broadcast', 'status'],
    ['15555550105@status', 'status'],
    ['1690000000@broadcast', 'broadcast'],
    ['120363000000000099@newsletter', 'channel'],
    // JIDs are compared without regard to case, as msgvault does.
    ['STATUS@BROADCAST', 'status'],
    ['15555550105@Status', 'status'],
    ['15555550101@S.WHATSAPP.NET', 'direct'],
    // Nothing a source names: reported as unknown rather than guessed.
    ['15555550101@call', 'unknown'],
    ['no-server-at-all', 'unknown'],
  ];
  for (const [jid, kind] of cases) assert.equal(chatKindOf(jid), kind, jid);
});

test('a one-to-one chat’s number is read from its id, whatever its case; nothing else has one', () => {
  assert.equal(phoneOf('15555550101@s.whatsapp.net'), '15555550101');
  assert.equal(phoneOf('15555550101@S.WhatsApp.Net'), '15555550101', 'the kind says direct, so the number is there');
  for (const jid of ['100000000000001@lid', '120363000000000001@g.us', '15555550105@status', '1690000000@broadcast']) {
    assert.equal(phoneOf(jid), null, jid);
  }
});
