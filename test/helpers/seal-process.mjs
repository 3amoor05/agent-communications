/**
 * A seal for a test's child process, loaded before anything else runs in it (`NODE_OPTIONS=--import=<this file>`).
 *
 * The real-shell tests (CUE-403) paste printed commands into a real shell, where nothing a test injects can reach the
 * process: a command that went to a provider, or to the system keychain, would go to the real one. So every process
 * they start is sealed here, the way the parity drive seals its own (`scripts/operations.mjs`'s `seal`):
 *
 * - the system keychain is refused outright: `@napi-rs/keyring` cannot be imported;
 * - no connection leaves the machine: a socket may connect only to a loopback address (a test's own fake provider) or
 *   a local pipe, a name other than `localhost` is not looked up, and no datagram is sent.
 *
 * Every attempt is refused and written, one JSON line each, to the file `AGENTCOMMS_TEST_SEAL_LOG` names, so a test
 * can assert that nothing tried: what a command does not reach shows nowhere else. A person's own `NODE_OPTIONS`
 * applies to a printed command too — it is part of their shell (design 2026-10-04, D6) — which is how this gets in.
 */

import dgram from 'node:dgram';
import dns from 'node:dns';
import { appendFileSync } from 'node:fs';
import { registerHooks, syncBuiltinESMExports } from 'node:module';
import net from 'node:net';

const LOG = process.env.AGENTCOMMS_TEST_SEAL_LOG;

/** Writes the attempt down and refuses it. */
function refuse(what, target) {
  if (LOG) appendFileSync(LOG, `${JSON.stringify({ what, target: String(target), pid: process.pid })}\n`);
  throw new Error(`sealed by the test: no ${what} (${target})`);
}

const LOOPBACK = /^(?:localhost|127(?:\.\d{1,3}){3}|::1|\[::1\]|::ffff:127(?:\.\d{1,3}){3})$/i;

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === '@napi-rs/keyring' || specifier.startsWith('@napi-rs/keyring/')) {
      refuse('keychain', specifier);
    }
    return nextResolve(specifier, context);
  },
});

/** Where a `connect` call goes: a local pipe, or a host. Node hands the method its arguments normalised, or not. */
function destination(args) {
  const [first, second] = args;
  const options = Array.isArray(first) ? first[0] : first;
  if (options !== null && typeof options === 'object') {
    if (typeof options.path === 'string') return { pipe: options.path };
    return { host: options.host ?? 'localhost' };
  }
  if (typeof options === 'number' || /^\d+$/.test(String(options))) {
    return { host: typeof second === 'string' ? second : 'localhost' };
  }
  return { pipe: String(options) };
}

const connect = net.Socket.prototype.connect;
net.Socket.prototype.connect = function sealedConnect(...args) {
  const where = destination(args);
  if (where.pipe === undefined && !LOOPBACK.test(where.host)) refuse('connection', where.host);
  return connect.apply(this, args);
};

for (const target of [dns, dns.promises]) {
  const lookup = target.lookup;
  target.lookup = function sealedLookup(hostname, ...rest) {
    if (!LOOPBACK.test(String(hostname))) refuse('name lookup', hostname);
    return lookup.call(this, hostname, ...rest);
  };
}
dgram.createSocket = (...args) => refuse('datagram', JSON.stringify(args[0]));
syncBuiltinESMExports();
