/**
 * An Output a test reads, level by level, for a module that writes
 * through the active output (`src/adapters/output/active.ts`).
 *
 * A case sets one with `setActiveOutput`, drives the module, and sets
 * `null` after it. The active output is module state and bun runs every
 * test file in one process, so an output left set would take the lines
 * of every file bun runs later.
 *
 * Each line goes to the sink of its level as the module handed it: no
 * `warn: ` prefix, no newline and no stream, so a case reads the bytes
 * of the message itself. A `log` event goes to the sink of its level
 * too, any other event to `event`, and a payload to `result`. What has
 * no sink is dropped, so `sinkOutput({})` silences a module.
 */
import type { CliEvent, CliEventLog, Output } from '../ports/index.js';

/** A sink for the lines of one level. */
type LineSink = (message: string) => void;

/** Where a {@link sinkOutput} hands what it is given. Each is optional. */
export interface OutputSinks {
  readonly info?: LineSink;
  readonly warn?: LineSink;
  readonly error?: LineSink;
  readonly debug?: LineSink;
  /** Every event but a `log`, which goes to the sink of its level. */
  readonly event?: (event: CliEvent) => void;
  /** Every payload handed to `result`. */
  readonly result?: (payload: unknown) => void;
}

/** Takes a line or an event and does nothing with it. */
function drop(): void {}

/** A frozen Output handing each line, event and payload to its sink; see the module note. */
export function sinkOutput(sinks: OutputSinks): Output {
  const levels: Readonly<Record<CliEventLog['level'], LineSink>> = {
    info: sinks.info ?? drop,
    warn: sinks.warn ?? drop,
    error: sinks.error ?? drop,
    debug: sinks.debug ?? drop,
  };
  const event = sinks.event ?? drop;
  const result = sinks.result ?? drop;

  return Object.freeze({
    info: (message: string) => {
      levels.info(message);
    },
    warn: (message: string) => {
      levels.warn(message);
    },
    error: (message: string) => {
      levels.error(message);
    },
    debug: (message: string) => {
      levels.debug(message);
    },
    emit: (handed: CliEvent) => {
      if (handed.type === 'log') {
        levels[handed.level](handed.message);
        return;
      }
      event(handed);
    },
    result: (payload: unknown) => {
      result(payload);
    },
  });
}
