/**
 * Where an Output adapter writes.
 *
 * Copied from open-tomato's `packages/shared/cli-core/src/output.ts`,
 * where it is named `CliOutputStream`, at commit
 * `18f94c843fff1bce65ed2245f8712ed9b64a2d51` (2026-06-25). Both adapters
 * beside this module write through it, so it lives in neither.
 *
 * The source spells `write` as a method. It is a function-typed property
 * here, as every port function is in `src/ports/index.ts`, whose note
 * gives the reason. `process.stdout` is assignable to it, which
 * `src/adapters/registry.ts` relies on when a context names no stream.
 */

/** A stream an Output adapter writes whole lines to. */
export interface OutputStream {
  /** Writes one chunk. What it answers is never read. */
  write: (chunk: string) => unknown;
}
