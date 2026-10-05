import { defineConfig } from 'tsdown';

// Both entries are fully bundled — commander and comms-core included — for the same reason the Gmail and Slack
// packages are: `agent-resend` should start immediately, from its own files. `@agentcomms/core` is still installed
// beside it, as a runtime dependency pinned to this version, because a handoff finds core's own command through that
// installed package (design 2026-10-04, D4). The optional native keychain module is the only import left external,
// because it ships a binary per platform.
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
