/**
 * The `events` Output adapter: one `rafa· ` line per named event, one
 * per error, and nothing else, so a watcher matches every line it prints
 * with a single prefix. A named event is printed as its `summary`; an
 * error, whether called or emitted as a `log` at `error`, is folded onto
 * one line after a padded `error` kind. `info`, `warn`, `debug`, `result`,
 * a `step` and a `log` below `error` write nothing.
 *
 * Only a command declaring `events` among its outputs is given this
 * adapter; any other command reads the mode as text
 * (`cli/core/assembleContext.ts`). The output answered is frozen.
 *
 * @module adapters/output/events
 */
import type { OutputStream } from './stream.js';
import type { CliEvent, Output } from '../../ports/index.js';

/** The prefix every line this output writes starts with. */
export const EVENT_PREFIX = 'rafa· ';

/** The width the error kind is padded to, the width a loop event's kind is padded to. */
const KIND_WIDTH = 16;

/** A message's lines, trimmed and joined with single spaces, blank ones dropped. */
function oneLine(message: string): string {
  return message
    .split('\n')
    .map((part) => part.trim())
    .filter((part) => part !== '')
    .join(' ');
}

/** What {@link createEventsOutput} builds an output over. */
export interface CreateEventsOutputOptions {
  /** Where the lines are written. */
  readonly stream: OutputStream;
}

/** Builds the events output over `stream`; see the module note. */
export function createEventsOutput({ stream }: CreateEventsOutputOptions): Output {
  const writeLine = (line: string): void => {
    stream.write(`${EVENT_PREFIX}${line}\n`);
  };

  const error = (message: string): void => {
    writeLine(`${'error'.padEnd(KIND_WIDTH)}${oneLine(message)}`);
  };

  const silent = (): void => {};

  const emit = (event: CliEvent): void => {
    if (event.type === 'event') writeLine(event.summary);
    if (event.type === 'log' && event.level === 'error') error(event.message);
  };

  return Object.freeze({ info: silent, warn: silent, debug: silent, error, emit, result: silent });
}
