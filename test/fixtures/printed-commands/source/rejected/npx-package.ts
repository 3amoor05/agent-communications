// §4 7c-launches: `npx` before a suite package, as a line and as a list of words — no binary named anywhere.
export const line = 'npx -y @agentcomms/core@latest update'; // expect: npx-package
export const words = ['npx', '-y', '@agentcomms/gmail', 'approve', 'ap_1']; // expect: npx-package
