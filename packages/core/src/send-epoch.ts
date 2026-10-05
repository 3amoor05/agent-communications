import type { Config } from './config.ts';

/**
 * The send epoch (design 2026-10-05 §D1, "`never` revokes; loosening revives nothing").
 *
 * Config keeps a per-owner integer that every write turning an owner's effective send policy to `never` raises, and
 * nothing ever lowers. A send's approval stores its owner's epoch as read at prepare, bound into its identity, and a
 * claim or an approval compares it with the live one: a record from before a `never` can never send, whatever the
 * policy says by then.
 */

/** An owner's send epoch in `config`: its stored value, or 0 when it has none. */
export function sendEpochOf(config: Config, ownerId: string): number {
  const epochs = (config as { sendEpochs?: Record<string, unknown> | undefined }).sendEpochs;
  const epoch = epochs !== undefined && Object.hasOwn(epochs, ownerId) ? epochs[ownerId] : undefined;
  return typeof epoch === 'number' && Number.isInteger(epoch) && epoch >= 0 ? epoch : 0;
}
