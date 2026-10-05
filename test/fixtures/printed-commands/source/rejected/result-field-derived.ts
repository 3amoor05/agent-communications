// §4 7c: a result's field of any name takes a binary from a manifest, whole.
declare const entry: { manifest: { binary: string; approve: string } };

export function report() {
  return { howToApprove: entry.manifest.approve, program: 'x', run: entry.manifest.binary }; // expect: sink-result, sink-result
}
