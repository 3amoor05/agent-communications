// §4 7c: a binary taken from a manifest written whole to stderr, and to a stream handed in.
declare const options: { binary: string };
declare const streams: { stdout: { write(text: string): void } };

process.stderr.write(options.binary); // expect: sink-stream
streams.stdout.write(options.binary); // expect: sink-stream
