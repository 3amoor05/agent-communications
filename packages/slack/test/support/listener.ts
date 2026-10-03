import { lookup } from 'node:dns/promises';
import { fileURLToPath } from 'node:url';
import type { ListenerEntry } from '../../src/operations/signin.ts';

/**
 * The detached sign-in listener, as the tests start it: the CLI from source, with a guard preloaded that ends it
 * once the test process that started it has gone.
 *
 * A test file can end without running any of its own cleanup. The runner ends a file that overruns its timeout with
 * SIGTERM, and after that no hook of the file's runs — so every listener it had started stayed up, re-parented,
 * holding its port for the ten minutes a sign-in lasts. `exit-with-parent.ts` is what a killed test process cannot
 * do for itself. A URL rather than a path, because `--import` resolves its argument as a module specifier, and a
 * Windows path is not one.
 */
export const LISTENER_COMMAND: ListenerEntry = {
  command: process.execPath,
  args: [
    '--experimental-strip-types',
    '--disable-warning=ExperimentalWarning',
    '--import',
    new URL('./exit-with-parent.ts', import.meta.url).href,
    fileURLToPath(new URL('../../src/cli.ts', import.meta.url)),
  ],
};

/** Whether a process with this id is still running. */
export function running(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/**
 * Stops listeners a test started, and returns only once they have actually gone.
 *
 * Waiting is the point: a SIGTERM that has been sent is not a listener that has stopped, and the next test must not
 * start while this one's still holds a port. SIGKILL after five seconds, for one that will not go.
 */
export async function stopListeners(pids: readonly number[]): Promise<void> {
  for (const pid of pids) {
    try {
      process.kill(pid, 'SIGTERM');
    } catch {
      // already gone, which is the normal case for a sign-in that was finished
    }
  }
  const deadline = Date.now() + 5_000;
  while (pids.some(running) && Date.now() < deadline) await new Promise((settle) => setTimeout(settle, 50));
  for (const pid of pids.filter(running)) {
    try {
      process.kill(pid, 'SIGKILL');
    } catch {
      // it went between the look and the kill
    }
  }
}

/**
 * A redirect address with `localhost` replaced by the address the sign-in listener is actually bound to.
 *
 * The listener binds `localhost`, and `server.listen` resolves that name once and binds the first answer alone: `::1`
 * on a Mac, with nothing on `127.0.0.1`. `fetch` asked for `http://localhost:…` resolves both and races them, giving
 * each 250 ms before it moves on to the next. On a busy machine this process can stall for longer than that after
 * the connection to `::1` has been made but before it has noticed, so the attempt is abandoned and `127.0.0.1`
 * refuses: `connect ETIMEDOUT ::1`, then `ECONNREFUSED 127.0.0.1`. A release run failed on it once. A browser has no
 * such budget, which is why sign-in itself was fine and only the tests were not.
 *
 * So the name is resolved here the way the listener resolved it — one lookup, its first answer — and the request goes
 * to that literal address: one connection, with no per-address timer to lose to. Any other host is left alone; the
 * fake Slack, for one, already listens on a literal address.
 */
export async function boundAddress(address: string | URL): Promise<URL> {
  const url = new URL(address);
  if (url.hostname !== 'localhost') return url;
  const found = await lookup(url.hostname);
  url.hostname = found.family === 6 ? `[${found.address}]` : found.address;
  return url;
}

/** The browser's last step: a request to the sign-in listener, at the address it is bound to ({@link boundAddress}). */
export async function fetchListener(address: string | URL, init?: RequestInit): Promise<Response> {
  return fetch(await boundAddress(address), init);
}
