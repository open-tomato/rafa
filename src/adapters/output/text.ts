/**
 * The `text` Output adapter: a command's output as lines a person reads.
 *
 * Copied from `createTextOutput` in open-tomato's
 * `packages/shared/cli-core/src/output.ts` at commit
 * `18f94c843fff1bce65ed2245f8712ed9b64a2d51` (2026-06-25), and retyped
 * against rafa's `Output` port, which `src/ports/index.ts` copies from
 * the same file's `CliOutput`.
 *
 * ## What the copy changes
 *
 * `info` is written at every verbosity, with no prefix. The source writes
 * it at verbosity 1 and above, as `info: <message>`. The loop prints its
 * progress lines at every verbosity, so under the source's threshold
 * each would vanish at verbosity 0, and under its prefix each one left
 * would change. `info(message)` writes `message`
 * and a newline, the bytes `console.log(message)` writes for a single
 * string: `text.test.ts` holds the two equal in a child process, over
 * messages holding `%s`, `%%`, `%d`, `%o`, `%c` and `%j`, none of which
 * `console.log` formats when it is handed one string.
 *
 * The rendering is otherwise the source's. `debug` is written at
 * verbosity 2 and above as `debug: <message>`, `warn` and `error` at
 * every verbosity as `warn: ` and `error: `, and `result` as `result: `
 * followed by a string payload as it is or any other payload as JSON.
 * `emit` renders a `log` event through the function of its level, and
 * each other kind on a line of its own. The stream's `write` is a
 * property, as `stream.ts` says, and the output answered is frozen.
 *
 * ## One stream
 *
 * Every line goes to the one stream the adapter is made with, `warn` and
 * `error` included, as in the source. A `console.warn` or `console.error`
 * line goes to stderr and carries no prefix, so the same message written
 * through `warn` or `error` differs from it in both. `emit` also writes a
 * line for a `start` event and a `result` event, `start: <command>` and
 * `result: ok`, whatever the verbosity.
 */
import type { OutputStream } from './stream.js';
import type { CliEvent, CliEventLog, CliEventResult, Output } from '../../ports/index.js';

/** The verbosity at and above which `debug` lines are written. */
const DEBUG_VERBOSITY = 2;

/** What {@link createTextOutput} makes an adapter with. */
export interface CreateTextOutputOptions {
  /** How much is written: `debug` lines from 2, every other line at any verbosity. */
  verbosity: number;
  /** Where every line is written. */
  stream: OutputStream;
}

/** A payload as a `result` line carries it: a string as it is, anything else as JSON. */
function formatPayload(payload: unknown): string {
  return typeof payload === 'string'
    ? payload
    : JSON.stringify(payload);
}

/** The line a `result` event renders as, without its newline. */
function resultLine(event: CliEventResult): string {
  if (event.ok) {
    return event.data === undefined
      ? 'result: ok'
      : `result: ok ${formatPayload(event.data)}`;
  }
  const code = event.error?.code ?? 'unknown';
  const message = event.error?.message ?? '';
  return message === ''
    ? `result: error ${code}`
    : `result: error ${code}: ${message}`;
}

/**
 * Makes a `text` Output writing each line to `stream`.
 *
 * The output answered is frozen, so no caller replaces one of its
 * functions on an output `active.ts` may be handing every module of the
 * process.
 */
export function createTextOutput({ verbosity, stream }: CreateTextOutputOptions): Output {
  const writeLine = (line: string): void => {
    stream.write(`${line}\n`);
  };

  const debug = (message: string): void => {
    if (verbosity >= DEBUG_VERBOSITY) writeLine(`debug: ${message}`);
  };

  const info = (message: string): void => {
    writeLine(message);
  };

  const warn = (message: string): void => {
    writeLine(`warn: ${message}`);
  };

  const error = (message: string): void => {
    writeLine(`error: ${message}`);
  };

  const result = (payload: unknown): void => {
    writeLine(`result: ${formatPayload(payload)}`);
  };

  const writeLog = (event: CliEventLog): void => {
    switch (event.level) {
      case 'debug': {
        debug(event.message);
        return;
      }
      case 'info': {
        info(event.message);
        return;
      }
      case 'warn': {
        warn(event.message);
        return;
      }
      case 'error': {
        error(event.message);
        return;
      }
    }
  };

  const emit = (event: CliEvent): void => {
    switch (event.type) {
      case 'start': {
        writeLine(`start: ${event.command}`);
        return;
      }
      case 'step': {
        writeLine(`step: ${event.name}`);
        return;
      }
      case 'log': {
        writeLog(event);
        return;
      }
      case 'result': {
        writeLine(resultLine(event));
        return;
      }
    }
  };

  return Object.freeze({ info, warn, error, debug, emit, result });
}
