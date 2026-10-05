import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { type Config, ConfigStore } from '../../src/config.ts';

/*
 * Another program sharing the configuration, for the version-3 conversion's barrier tests (`config-v3.test.ts`): run
 * as a child process with `--experimental-strip-types`, it does what the parent asks over IPC and says when.
 *
 * - `{ op: 'v1', stateDir, record }` writes a version-1 approval record, as a paused 0.13 prepare would.
 * - `{ op: 'update', configDir, changePolicy?, key? }` commits a `ConfigStore.update` — a change-policy tightening, an
 *   unknown key — answering `started` just before it asks for the lock and `committed` once it has written.
 */

interface V1Message {
  op: 'v1';
  stateDir: string;
  record: Record<string, unknown>;
}

interface UpdateMessage {
  op: 'update';
  id: string;
  configDir: string;
  changePolicy?: 'chat' | 'confirm';
  key?: { name: string; value: unknown };
}

process.on('message', async (message: V1Message | UpdateMessage) => {
  try {
    if (message.op === 'v1') {
      mkdirSync(join(message.stateDir, 'approvals'), { recursive: true, mode: 0o700 });
      writeFileSync(
        join(message.stateDir, 'approvals', `${String(message.record.approvalId)}.json`),
        `${JSON.stringify(message.record, null, 2)}\n`,
        { mode: 0o600 },
      );
      process.send?.({ op: 'v1', done: true });
      return;
    }
    process.send?.({ op: 'update', id: message.id, started: true });
    const written = await new ConfigStore(message.configDir).update((current: Config) => ({
      ...current,
      defaults: {
        ...current.defaults,
        ...(message.changePolicy === undefined ? {} : { changePolicy: message.changePolicy }),
      },
      ...(message.key === undefined ? {} : { [message.key.name]: message.key.value }),
    }));
    process.send?.({ op: 'update', id: message.id, committed: true, version: written.version });
  } catch (error) {
    process.send?.({ op: 'error', message: error instanceof Error ? error.message : String(error) });
  }
});

process.send?.({ op: 'ready' });
