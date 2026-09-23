/**
 * The command this process is running, and the flags its line was parsed
 * into.
 *
 * One module-level value with a setter, as `src/adapters/output/active.ts`
 * holds the active output, so a reader deep below a command's `run` — the
 * spend guard in `src/utils/claude.ts` — can ask which command it runs
 * under without a context threaded down to it.
 *
 * ## Set, read, restore
 *
 * {@link setRunningCommand} records a command with its parsed flags and
 * answers the record it replaced, null when nothing was recorded.
 * {@link runningCommand} answers the record now, or null.
 * {@link restoreRunningCommand} puts back a record {@link setRunningCommand}
 * answered, so a caller that sets one restores it in a `finally` and a
 * nested set leaves the outer record in place once it ends.
 *
 * The flags are copied and frozen when set, so a caller changing its own
 * flags object afterwards changes nothing recorded.
 *
 * Bun runs every test file in one process, and this is module state: a
 * case that sets a record restores the one it replaced after it.
 */
import type { RafaCommand } from './command.js';
import type { CliContext } from './core/types.js';

/** A running command and the flags its line was parsed into. */
export interface RunningCommand {
  /** The command running. */
  readonly command: RafaCommand;
  /** Its parsed flags by name, as the context carries them. */
  readonly flags: CliContext['flags'];
}

/** The record now, or null while no command runs. */
let running: RunningCommand | null = null;

/**
 * Records `command` as running with `flags`, and answers the record it
 * replaced for {@link restoreRunningCommand}.
 */
export function setRunningCommand(command: RafaCommand, flags: CliContext['flags']): RunningCommand | null {
  const previous = running;
  running = Object.freeze({ command, flags: Object.freeze({ ...flags }) });
  return previous;
}

/** The command running now with its flags, or null when none is recorded. */
export function runningCommand(): RunningCommand | null {
  return running;
}

/** Puts back `previous`, a record {@link setRunningCommand} answered. */
export function restoreRunningCommand(previous: RunningCommand | null): void {
  running = previous;
}
