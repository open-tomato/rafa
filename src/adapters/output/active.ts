/**
 * The Output this process writes through, and the mode it renders in.
 *
 * A function that prints asks {@link activeOutput} for the output rather
 * than taking one as an argument, as `src/start/stamp.ts` holds a run's
 * plan stub: an `Output` threaded through every function that prints
 * would add an argument to call sites that have nothing to say about
 * output. The output is held in two places, and the readers answer the
 * first that has one.
 *
 * ## The scope
 *
 * {@link runWithActiveOutput} runs a function with an output and a mode
 * in an async scope of its own, an `AsyncLocalStorage`
 * (`node:async_hooks`). Inside that function, and in everything it
 * awaits or starts, the readers answer that output and that mode; once
 * the function ends, however it ends, nothing of them is left.
 *
 * A scope belongs to one run, so runs need not nest to stay apart. Two
 * runs that overlap in one process, started together and awaited with
 * `Promise.all`, each write through their own output whichever ends
 * first. A run started inside another reads the inner output inside and
 * the outer one after. The module-level value below keeps overlapping
 * runs apart only while they nest: set and put back in a `finally` it is
 * a stack, and two that end out of order leave the output of one of them
 * for the rest of the process (#927).
 *
 * ## The module-level value
 *
 * Outside every scope the readers answer one module-level value. Until
 * something sets another, it is the `text` adapter at verbosity 0
 * writing to `process.stdout`. {@link setActiveOutput} with `null` puts
 * that default back. The default is made once, when this module is first
 * imported, so {@link activeOutput} answers the same object on every
 * read while nothing is set. It holds `process.stdout` itself and calls
 * its `write` on each line, so a spy set on `process.stdout.write` after
 * the import sees every line.
 *
 * ## A set made inside a scope
 *
 * The readers prefer the scope, and {@link setActiveOutput} writes the
 * module-level value alone, inside a scope as outside one. So a set made
 * inside a scope changes nothing that scope reads, and is what the
 * readers answer once the scope has ended. A scope's output cannot be
 * replaced from inside it.
 *
 * ## What reads outside the scope
 *
 * A scope follows the awaits and the callbacks started inside it. A
 * callback the runtime calls from elsewhere does not carry it. Measured
 * under bun 1.3.14, three listeners registered inside a scope read no
 * store: a `process.on` signal listener when the signal arrived, an
 * abort listener that handler fired, and an abort listener an
 * `AbortSignal.timeout` fired. A timer, a child process's `data`
 * listener, a `readline` `line` listener and the code after an await
 * such a handler settled all read the scope's. A reader outside the
 * scope writes through the module-level value; one that needs the
 * scope's output reads it where the listener is registered, or is
 * wrapped with `AsyncResource.bind` there.
 *
 * ## The mode
 *
 * An Output carries no mode of its own, and two writers need one, so the
 * mode is held beside the output, in the scope and at module level
 * alike. `utils/claude.ts` echoes a session's stdout as the bytes it
 * wrote in `text` mode and as one `log` event per line in `json` mode.
 * `start/dispatch.ts` emits a `step` event per task in `json` mode
 * alone, where the `text` adapter would render it as a `step: ` line
 * beside the line announcing the task. The dispatcher sets each
 * invocation's mode with its output. The default, and an output set at
 * module level with no mode, render in `text`.
 *
 * Bun runs every test file in one process, and the module-level value is
 * module state: a case that sets an output sets `null` after it, or each
 * file bun runs later writes through that case's output, in that case's
 * mode.
 */
import type { OutputMode } from '../../config-sections.js';
import type { Output } from '../../ports/index.js';

import { AsyncLocalStorage } from 'node:async_hooks';

import { createTextOutput } from './text.js';

/** An output and the mode it renders in, as one scope holds them. */
interface ScopedOutput {
  readonly output: Output;
  readonly mode: OutputMode;
}

/** The output of each run {@link runWithActiveOutput} has in flight, by async scope. */
const scopes = new AsyncLocalStorage<ScopedOutput>();

/** The output active while nothing is set. */
const DEFAULT_OUTPUT: Output = createTextOutput({ verbosity: 0, stream: process.stdout });

/** The module-level output. */
let active: Output = DEFAULT_OUTPUT;

/** The mode the module-level output renders in. */
let activeMode: OutputMode = 'text';

/**
 * Runs `run` with `output` as the active output, rendering in `mode`, in
 * an async scope of its own, and answers what `run` answers. Both are
 * read inside `run` and whatever it awaits, and nowhere after it; see
 * the module note.
 */
export function runWithActiveOutput<T>(output: Output, mode: OutputMode, run: () => T): T {
  return scopes.run(Object.freeze({ output, mode }), run);
}

/**
 * Sets the module-level output and the mode it renders in, `text`
 * unless one is named. `null` puts the default back, in `text` whatever
 * mode is named. Inside a scope it changes nothing that scope reads; see
 * the module note.
 */
export function setActiveOutput(output: Output | null, mode: OutputMode = 'text'): void {
  active = output ?? DEFAULT_OUTPUT;
  activeMode = output === null
    ? 'text'
    : mode;
}

/** The output to write through: the one of the scope this is read in, else the module-level one. */
export function activeOutput(): Output {
  return scopes.getStore()?.output ?? active;
}

/** The mode the active output renders in, read as {@link activeOutput} is; see the module note. */
export function activeOutputMode(): OutputMode {
  return scopes.getStore()?.mode ?? activeMode;
}
