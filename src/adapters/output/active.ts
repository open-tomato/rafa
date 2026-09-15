/**
 * The Output this process writes through, and the mode it renders in.
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
 * ## The mode
 *
 * An Output carries no mode of its own, and two writers need one, so the
 * mode is set beside the output. `utils/claude.ts` echoes a session's
 * stdout as the bytes it wrote in `text` mode and as one `log` event per
 * line in `json` mode. `start/dispatch.ts` emits a `step` event per task
 * in `json` mode alone, where the `text` adapter would render it as a
 * `step: ` line beside the line announcing the task. The dispatcher sets
 * each invocation's mode with its output. The default, and an output set
 * with no mode, render in `text`.
 *
 * Bun runs every test file in one process, and this is module state: a
 * case that sets an output sets `null` after it, or each file bun runs
 * later writes through that case's output, in that case's mode.
 */
import type { OutputMode } from '../../config-sections.js';
import type { Output } from '../../ports/index.js';

import { createTextOutput } from './text.js';

/** The output active while nothing is set. */
const DEFAULT_OUTPUT: Output = createTextOutput({ verbosity: 0, stream: process.stdout });

/** The output active now. */
let active: Output = DEFAULT_OUTPUT;

/** The mode the active output renders in. */
let activeMode: OutputMode = 'text';

/**
 * Sets the output this process writes through and the mode it renders
 * in, `text` unless one is named. `null` puts the default back, in
 * `text` whatever mode is named.
 */
export function setActiveOutput(output: Output | null, mode: OutputMode = 'text'): void {
  active = output ?? DEFAULT_OUTPUT;
  activeMode = output === null
    ? 'text'
    : mode;
}

/** The output this process writes through. */
export function activeOutput(): Output {
  return active;
}

/** The mode the active output renders in; see the module note. */
export function activeOutputMode(): OutputMode {
  return activeMode;
}
