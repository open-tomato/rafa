/**
 * The command this process is running, and the flags its line was parsed
 * into.
 *
 * A reader deep below a command's `run` — the spend guard in
 * `src/utils/claude.ts` — asks {@link runningCommand} which command it
 * runs under, without a context threaded down to it. The record is held
 * in two places, and the reader answers the first that has one.
 *
 * ## The scope
 *
 * {@link runAsRunningCommand} runs a function with a record in an async
 * scope of its own, an `AsyncLocalStorage` (`node:async_hooks`). Inside
 * that function, and in everything it awaits or starts, the reader
 * answers that record; once the function ends, however it ends, nothing
 * of it is left.
 *
 * A scope belongs to one run, so runs need not nest to stay apart. Two
 * runs that overlap in one process, started together and awaited with
 * `Promise.all`, each read their own record whichever ends first. A run
 * started inside another reads the inner record inside and the outer one
 * after. The module-level value below keeps overlapping runs apart only
 * while they nest: set and put back in a `finally` it is a stack, and
 * two that end out of order leave the record of one of them for the
 * rest of the process (#927).
 *
 * ## The module-level value
 *
 * {@link setRunningCommand} records a command with its parsed flags at
 * module level and answers the record it replaced, null when nothing was
 * recorded. {@link restoreRunningCommand} puts back a record
 * {@link setRunningCommand} answered, so a caller that sets one restores
 * it in a `finally`. Outside every scope the reader answers this value,
 * or null.
 *
 * ## A set made inside a scope
 *
 * The reader prefers the scope, and the setters write the module-level
 * value alone, inside a scope as outside one. So a set made inside a
 * scope changes nothing that scope reads, answers the module-level
 * record it replaced, and is what the reader answers once the scope has
 * ended. A scope's record cannot be replaced from inside it.
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
 * scope gets the module-level value; one that needs the scope's is
 * wrapped with `AsyncResource.bind` where it is registered.
 *
 * The flags are copied and frozen when recorded, so a caller changing
 * its own flags object afterwards changes nothing recorded.
 *
 * Bun runs every test file in one process, and the module-level value is
 * module state: a case that sets a record restores the one it replaced
 * after it.
 */
import type { RafaCommand } from './command.js';
import type { CliContext } from './core/types.js';

import { AsyncLocalStorage } from 'node:async_hooks';

/** A running command and the flags its line was parsed into. */
export interface RunningCommand {
  /** The command running. */
  readonly command: RafaCommand;
  /** Its parsed flags by name, as the context carries them. */
  readonly flags: CliContext['flags'];
}

/** The record of each run {@link runAsRunningCommand} has in flight, by async scope. */
const scopes = new AsyncLocalStorage<RunningCommand>();

/** The module-level record, or null while none is set. */
let running: RunningCommand | null = null;

/** `command` and a frozen copy of `flags` as one frozen record. */
function recordOf(command: RafaCommand, flags: CliContext['flags']): RunningCommand {
  return Object.freeze({ command, flags: Object.freeze({ ...flags }) });
}

/**
 * Runs `run` with `command` and `flags` recorded as running in an async
 * scope of its own, and answers what `run` answers. The record is read
 * inside `run` and whatever it awaits, and nowhere after it; see the
 * module note.
 */
export function runAsRunningCommand<T>(command: RafaCommand, flags: CliContext['flags'], run: () => T): T {
  return scopes.run(recordOf(command, flags), run);
}

/**
 * Records `command` as running with `flags` at module level, and answers
 * the module-level record it replaced for {@link restoreRunningCommand}.
 * Inside a scope it changes nothing that scope reads; see the module
 * note.
 */
export function setRunningCommand(command: RafaCommand, flags: CliContext['flags']): RunningCommand | null {
  const previous = running;
  running = recordOf(command, flags);
  return previous;
}

/**
 * The command running now with its flags: the record of the scope this
 * is read in, else the module-level one, else null.
 */
export function runningCommand(): RunningCommand | null {
  return scopes.getStore() ?? running;
}

/** Puts back `previous`, a module-level record {@link setRunningCommand} answered. */
export function restoreRunningCommand(previous: RunningCommand | null): void {
  running = previous;
}
