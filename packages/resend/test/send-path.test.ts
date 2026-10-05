import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import { join, relative, sep } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

/**
 * **Mail leaves through exactly one function**: `executeSend` in `operations/send.ts`. A second path — added in good
 * faith, in a hurry — would fail no other test, so this one exists to fail instead, as the Gmail package's does.
 *
 * Three rules, read from the source with comments stripped:
 *
 * 1. Only `operations/send.ts` opens a permit for `emails.send`, and only `operations/scheduled.ts` one for
 *    `emails.cancel` (the route table and the guard name them to define them).
 * 2. Only those two call `spendOn` at all.
 * 3. Only `api/client.ts` calls `fetch`, so nothing reaches Resend without the guard in between.
 */

const SRC = fileURLToPath(new URL('../src', import.meta.url));

function withoutComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/.*$/gm, '$1');
}

async function sources(directory: string): Promise<{ path: string; text: string }[]> {
  const found: { path: string; text: string }[] = [];
  for (const entry of await readdir(directory, { withFileTypes: true, recursive: true })) {
    if (!entry.isFile() || !entry.name.endsWith('.ts')) continue;
    const path = join(entry.parentPath, entry.name);
    found.push({
      path: relative(directory, path).split(sep).join('/'),
      text: withoutComments(await readFile(path, 'utf8')),
    });
  }
  return found;
}

interface Rule {
  name: string;
  pattern: RegExp;
  allowed: readonly string[];
}

export const RULES: readonly Rule[] = [
  {
    name: 'the send route',
    pattern: /['"`]emails\.send['"`]/,
    allowed: ['api/guard.ts', 'api/routes.ts', 'operations/send.ts'],
  },
  {
    name: 'the cancel route',
    pattern: /['"`]emails\.cancel['"`]/,
    allowed: ['api/guard.ts', 'api/routes.ts', 'operations/scheduled.ts'],
  },
  {
    name: 'a permit',
    pattern: /\bspendOn\s*\(/,
    allowed: ['api/guard.ts', 'operations/send.ts', 'operations/scheduled.ts'],
  },
  {
    name: 'a POST to Resend',
    pattern: /resendRequest\s*(<[^>]*>)?\s*\([^)]*['"`]POST['"`]/,
    // The client is where the function is defined, with `'GET' | 'POST'` in its signature.
    allowed: ['api/client.ts', 'operations/send.ts', 'operations/scheduled.ts'],
  },
  { name: 'a bare fetch', pattern: /(?<![.\w])fetch\s*\(|\bglobalThis\.fetch\b/, allowed: [] },
];

export function offenders(files: readonly { path: string; text: string }[], rules: readonly Rule[] = RULES): string[] {
  const found: string[] = [];
  for (const rule of rules) {
    for (const file of files) {
      if (rule.allowed.includes(file.path)) continue;
      if (rule.pattern.test(file.text)) found.push(`${file.path}: ${rule.name}`);
    }
  }
  return found;
}

test('only the send gate sends, only the scheduled cancel cancels, and only the client talks to the network', async () => {
  assert.deepEqual(offenders(await sources(SRC)), []);
});

test('each rule finds what it forbids, so an empty answer means something', () => {
  const planted = [
    {
      path: 'operations/read.ts',
      text: "await spendOn(permit, id, 'emails.send', () => resendRequest(t, 'POST', '/emails'))",
    },
    { path: 'operations/accounts.ts', text: "spendOn(permit, id, 'emails.cancel', go)" },
    { path: 'mcp/server.ts', text: 'const r = await fetch(url)' },
    { path: 'operations/doctor.ts', text: "resendRequest<{ id: string }>(transport, 'POST', `/emails`, {})" },
  ];
  const found = offenders(planted);
  for (const expected of [
    'operations/read.ts: the send route',
    'operations/read.ts: a permit',
    'operations/read.ts: a POST to Resend',
    'operations/accounts.ts: the cancel route',
    'mcp/server.ts: a bare fetch',
    'operations/doctor.ts: a POST to Resend',
  ]) {
    assert.ok(found.includes(expected), `${expected} not found in ${found.join('; ')}`);
  }
  // And the allowed files are allowed.
  assert.deepEqual(offenders([{ path: 'operations/send.ts', text: "spendOn(p, a, 'emails.send', go)" }]), []);
});

test('the one function that opens the send permit is executeSend', async () => {
  const send = (await sources(SRC)).find((file) => file.path === 'operations/send.ts');
  assert.ok(send);
  const opens = [...send.text.matchAll(/spendOn\s*\(/g)];
  assert.equal(opens.length, 1, 'one permit, in one place');
  const start = send.text.indexOf('export async function executeSend');
  const end = send.text.indexOf('\nexport ', start + 1);
  const at = opens[0]?.index ?? -1;
  assert.ok(start >= 0 && at > start && at < end, 'inside executeSend');
});

test('the send permit opens only after the fence: one fence, inside executeSend, before its one spendOn (CUE-404 Task 17)', async () => {
  const send = (await sources(SRC)).find((file) => file.path === 'operations/send.ts');
  assert.ok(send);
  const start = send.text.indexOf('export async function executeSend');
  const end = send.text.indexOf('\nexport ', start + 1);
  const fences = [...send.text.matchAll(/\bfenceOrStop\s*\(/g)].map((found) => found.index ?? -1);
  assert.equal(fences.length, 1, 'one fence: the send has one provider step');
  const opens = send.text.search(/\bspendOn\s*\(/);
  const fence = fences[0] ?? -1;
  assert.ok(fence > start && fence < end, 'the fence is inside executeSend');
  assert.ok(fence < opens, 'and comes before the permit that lets the request leave');
  // Nothing between the fence and the permit asks the network.
  assert.doesNotMatch(send.text.slice(fence, opens), /resendRequest\s*[<(]/);
});
