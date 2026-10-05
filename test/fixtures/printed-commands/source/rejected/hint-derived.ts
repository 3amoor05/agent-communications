// §4 7c: a `CommsError` message or hint that is a binary taken from a manifest, whole.
declare class CommsError extends Error {
  constructor(code: string, message: string, options?: { hint?: string });
}
declare const product: { binary: string };

export const refused = new CommsError('USAGE', 'refused', { hint: product.binary }); // expect: sink-hint
