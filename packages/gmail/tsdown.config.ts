import { defineConfig } from 'tsdown';

// Both entries are fully bundled — Google client libraries, the MCP SDK, commander and comms-core included — so
// `agent-gmail` starts in a fraction of a second, from its own files. `@agentcomms/core` is still installed beside it,
// as a runtime dependency pinned to this version: the bundle does not import it, but a handoff finds core's own
// command through that installed package (design 2026-10-04, D4). The only import left outside the bundle is the
// optional native keychain module, which ships a binary per platform.
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
