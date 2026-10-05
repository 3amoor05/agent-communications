import { ApprovalStore, type Expectation } from '../../src/approvals.ts';
import { ConfigStore } from '../../src/config.ts';
import { CommsError } from '../../src/errors.ts';

/*
 * Another process sharing an approval store, for the race tests (`approval-outcome.test.ts`): run as a child with
 * `--experimental-strip-types`, it opens its own store over the same directories — the configuration read through
 * its own `ConfigStore`, as a separate program's would be — and does what the parent asks over IPC.
 *
 * - `{ op: 'claim', id, stateDir, configDir, approvalId, now, live }` claims a send;
 * - `{ op: 'revoke', id, stateDir, configDir, approvalId, now }` revokes, as a person's cancel does.
 *
 * Each answers `{ id, ok: true, state }` or `{ id, ok: false, code }`, and `{ op: 'ready' }` once it is listening.
 */

interface Request {
  op: 'claim' | 'revoke';
  id: string;
  stateDir: string;
  configDir: string;
  approvalId: string;
  /** The time it acts at, as the parent's clock has it: the two processes agree on the time. */
  now: number;
  live?: {
    inboxId: string;
    inboxSub?: string;
    draftMessageId: string;
    contentDigest: string;
    expect: Expectation;
  };
}

process.on('message', async (message: Request) => {
  const config = new ConfigStore(message.configDir);
  const store = new ApprovalStore(message.stateDir, {
    now: () => new Date(message.now),
    loadConfig: () => config.load(),
  });
  try {
    if (message.op === 'claim') {
      if (message.live === undefined) throw new Error('a claim needs what it claims for');
      const claimed = await store.claimForSend(message.approvalId, message.live);
      process.send?.({ id: message.id, ok: true, state: claimed.record.state });
    } else {
      const revoked = await store.revoke(message.approvalId, 'cancelled by the person', { disposition: 'person' });
      process.send?.({ id: message.id, ok: true, state: revoked.form === 'v2' ? revoked.record.state : revoked.form });
    }
  } catch (error) {
    process.send?.({ id: message.id, ok: false, code: error instanceof CommsError ? error.code : String(error) });
  }
});

process.send?.({ op: 'ready' });
