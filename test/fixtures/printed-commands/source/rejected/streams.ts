// §4 7c: a bare command written straight to stdout, to stderr, and to a stream handed in.
declare const streams: { stdout: { write(text: string): void }; stderr: { write(text: string): void } };

process.stdout.write('Next: agent-whatsapp sync --account personal/whatsapp\n'); // expect: binary
process.stderr.write('agentcomms update --later puts it off\n'); // expect: binary
streams.stderr.write(`Run agent-slack doctor for details.\n`); // expect: binary
