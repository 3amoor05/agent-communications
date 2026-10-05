/**
 * One writer of the shared history caches, in a process of its own (history-cache.test.ts): records `count` entries,
 * one locked change each, numbered from `from`, all observed at `at`, into a cache capped at `cap`.
 *
 *   node --experimental-strip-types history-cache-child.ts <stateDir> <addresses|correspondents> <from> <count> <at> <cap>
 */
import { HistoryCache } from '../../src/operations/history-cache.ts';

const [stateDir, kind, from, count, at, cap] = process.argv.slice(2);
if (stateDir === undefined || kind === undefined || at === undefined) throw new Error('usage: see the comment above');
const cache = new HistoryCache(stateDir, { now: () => new Date(at), cap: Number(cap) });
for (let index = Number(from); index < Number(from) + Number(count); index += 1) {
  const name = `k${String(index).padStart(5, '0')}`;
  if (kind === 'addresses') {
    await cache.recordAddresses('ibx_CHILDCHILDCHILD0', new Map([[`${name}@vendor.test`, 'not-written']]));
  } else {
    await cache.recordCorrespondents(`ibx_${name.toUpperCase().padEnd(16, 'X')}`, [`${name}.test`]);
  }
}
