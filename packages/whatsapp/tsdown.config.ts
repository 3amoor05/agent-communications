import { defineConfig } from 'tsdown';

// Bundled like the Slack package — commander, zod, the MCP SDK and comms-core inlined — so `agent-whatsapp` runs from
// its own files. `@agentcomms/core` is still installed beside it, as its one runtime dependency, pinned to this
// version: the bundle does not import it, but a handoff finds core's own command through that installed package
// (design 2026-10-04, D4). Nothing of WhatsApp's is installed: SQLite is Node's own `node:sqlite`. The native keychain
// module stays external only because core's secret store names it; this package never opens a secret store, since it
// holds no secret.
export default defineConfig({
  entry: { index: 'src/index.ts', cli: 'src/cli.ts' },
  format: 'esm',
  platform: 'node',
  target: 'node22',
  clean: true,
  dts: { resolve: true },
  noExternal: [/.*/],
  external: ['@napi-rs/keyring'],
});
