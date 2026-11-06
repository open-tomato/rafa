/** Anything thrown or rejected, as an `Error`: a thrown string or object keeps its text as the message. */
export function toError(thrown: unknown): Error {
  if (thrown instanceof Error) return thrown;
  return new Error(typeof thrown === 'string'
    ? thrown
    : `Non-error thrown: ${String(thrown)}`);
}
