/**
 * The `json` Output adapter: a command's output as NDJSON, one
 * `CliEvent` per line, for a service or the TUI to read.
 *
 * Copied from `createJsonOutput` in open-tomato's
 * `packages/shared/cli-core/src/output.ts` at commit
 * `18f94c843fff1bce65ed2245f8712ed9b64a2d51` (2026-06-25), and retyped
 * against rafa's `Output` port, which `src/ports/index.ts` copies from
 * the same file's `CliOutput`.
 *
 * ## One terminal result
 *
 * A command emits exactly one terminal `result` event, so once one is
 * written the adapter refuses a second rather than writing it: `result`,
 * and `emit` handed a `result` event, throw and write nothing. The source
 * writes every result it is handed. The adapter refuses a second result
 * and nothing else: a `log` or `step` event after the result is written
 * as one before it is.
 *
 * The count belongs to the adapter made, never to this module, so each
 * adapter writes one result of its own. Only a result that was written
 * counts. A payload `JSON.stringify` refuses, such as a `bigint`, throws
 * the serialiser's error before anything is written, as a stream whose
 * `write` throws does, and the command keeps its one result. The
 * refusal is checked first, so a second result is refused as one
 * whatever its payload.
 *
 * ## What else the copy changes
 *
 * The `ts` of a `log` or `result` event the adapter builds is read from
 * `now`, which defaults to the system clock; the source reads the clock
 * itself, and the seam lets a test hold a line to its exact bytes. An
 * event handed to `emit` is written as it is, its own `ts` included. The
 * stream's `write` is a property, as `stream.ts` says, and the output
 * answered is frozen.
 */
import type { OutputStream } from './stream.js';
import type { CliEvent, CliEventLog, Output } from '../../ports/index.js';

/** What a second terminal result is refused with. */
const SECOND_RESULT_REFUSAL
  = 'json output: refused a second terminal result event; a command emits exactly one';

/** What {@link createJsonOutput} makes an adapter with. */
export interface CreateJsonOutputOptions {
  /** Where every event is written, one per line. */
  stream: OutputStream;
  /** The clock a built `log` or `result` event is stamped from. Defaults to the system clock. */
  now?: () => Date;
}

/**
 * Makes a `json` Output writing one `CliEvent` per line to `stream`.
 *
 * Throws, writing nothing, when a second terminal `result` is handed to
 * the output answered; see the module note.
 */
export function createJsonOutput({
  stream,
  now = () => new Date(),
}: CreateJsonOutputOptions): Output {
  let resultWritten = false;

  const writeEvent = (event: CliEvent): void => {
    const isResult = event.type === 'result';
    if (isResult && resultWritten) throw new Error(SECOND_RESULT_REFUSAL);
    stream.write(`${JSON.stringify(event)}\n`);
    if (isResult) resultWritten = true;
  };

  const logAt = (level: CliEventLog['level'], message: string): void => {
    writeEvent({ type: 'log', level, message, ts: now().toISOString() });
  };

  const debug = (message: string): void => {
    logAt('debug', message);
  };

  const info = (message: string): void => {
    logAt('info', message);
  };

  const warn = (message: string): void => {
    logAt('warn', message);
  };

  const error = (message: string): void => {
    logAt('error', message);
  };

  const emit = (event: CliEvent): void => {
    writeEvent(event);
  };

  const result = (payload: unknown): void => {
    writeEvent({ type: 'result', ok: true, data: payload, ts: now().toISOString() });
  };

  return Object.freeze({ info, warn, error, debug, emit, result });
}
