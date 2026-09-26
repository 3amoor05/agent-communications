import { defineConfig } from 'tsdown';

// Bundled like the Slack package — commander, zod, the MCP SDK and comms-core inlined — so `agent-whatsapp` is one
// file with nothing to install. The spike has no runtime dependency of its own: SQLite is Node's own `node:sqlite`.
// The native keychain module stays external only because core's secret store names it; this package never opens a
// secret store, since it holds no secret.
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
