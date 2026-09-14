/**
 * The Output this process writes through.
 *
 * One module-level value with a setter, as `src/start/stamp.ts` holds a
 * run's plan stub, rather than an `Output` threaded through every
 * function that prints, which would add an argument to call sites that
 * have nothing to say about output.
 *
 * Until something sets another, the value is the `text` adapter at
 * verbosity 0 writing to `process.stdout`. {@link setActiveOutput} with
 * `null` puts that default back. The default is made once, when this
 * module is first imported, so {@link activeOutput} answers the same
 * object on every read while nothing is set. It holds `process.stdout`
 * itself and calls its `write` on each line, so a spy set on
 * `process.stdout.write` after the import sees every line.
 *
 * Bun runs every test file in one process, and this is module state: a
 * case that sets an output sets `null` after it, or each file bun runs
 * later writes through that case's output.
 */
import type { Output } from '../../ports/index.js';

import { createTextOutput } from './text.js';

/** The output active while nothing is set. */
const DEFAULT_OUTPUT: Output = createTextOutput({ verbosity: 0, stream: process.stdout });

/** The output active now. */
let active: Output = DEFAULT_OUTPUT;

/** Sets the output this process writes through, or puts the default back with `null`. */
export function setActiveOutput(output: Output | null): void {
  active = output ?? DEFAULT_OUTPUT;
}

/** The output this process writes through. */
export function activeOutput(): Output {
  return active;
}
