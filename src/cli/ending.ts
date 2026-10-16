/**
 * How an invocation ends: the {@link Ending} a settled route answers,
 * the terminal `result` event it is told as, and how that event, or in
 * text mode what a person reads of it, is written.
 *
 * The dispatcher (`dispatch.ts`) settles a route into an `Ending`, built
 * with {@link success} or {@link failure} or by hand for a
 * `command_exit`, and hands it to {@link finish}, which builds the event
 * ({@link resultEvent}), writes it ({@link writeEnding}) and answers the
 * exit code with it. Which ending each way a command ends gives is the
 * dispatcher's "How a command ends", in its module note.
 *
 * What is written, by mode:
 *
 *   - **json**: the terminal event, as NDJSON through the context's
 *     output.
 *   - **events**: for a failed ending, one `rafa· error` line on stdout,
 *     its stderr line or `exit code <n>` when it carries none, so a
 *     watcher reading only those lines sees how the run ended; nothing
 *     for a success.
 *   - **text**: the stderr line, when the ending has one, then the
 *     payload a command gave, as the `text` adapter writes a result.
 *
 * An event that cannot be written, such as a payload `JSON.stringify`
 * refuses, is replaced by the `result_unwritable` failure with exit code
 * 1, written the same way, and that is the outcome answered.
 */
import type { DispatchErrorCode, DispatchOutcome } from './dispatch.js';
import type { CliContext } from '@open-tomato/rafa/core/command';
import type { OutputStream } from '@open-tomato/rafa/core/output';
import type { CliEventResult } from '@open-tomato/rafa/ports';

/** How a route settled, before its terminal event is built. */
export interface Ending {
  readonly exitCode: number;
  /** The payload a command gave, or null. */
  readonly payload: { readonly value: unknown } | null;
  readonly error: { readonly code: DispatchErrorCode; readonly message: string } | null;
  /** The line text mode writes to stderr, or null. */
  readonly stderrLine: string | null;
}

/** What writing an ending reads of the dispatcher's settings. */
export interface EndingSettings {
  /** Where text mode writes an ending's stderr line. */
  readonly stderr: OutputStream;
  /** The clock the terminal event is stamped from. */
  readonly now: () => Date;
}

/** What was thrown, as a message. */
export function messageOf(error: unknown): string {
  return error instanceof Error
    ? error.message
    : String(error);
}

/** A failure with exit code 1 and the `rafa: <message>` stderr line. */
export function failure(code: DispatchErrorCode, message: string): Ending {
  return { exitCode: 1, payload: null, error: { code, message }, stderrLine: `rafa: ${message}` };
}

/** A success, carrying the payload a command gave. */
export function success(payload: { readonly value: unknown } | null): Ending {
  return { exitCode: 0, payload, error: null, stderrLine: null };
}

/** The terminal event an ending is told as. */
export function resultEvent(ending: Ending, now: () => Date): CliEventResult {
  const ts = now().toISOString();
  if (ending.error !== null) return { type: 'result', ok: false, error: { ...ending.error }, ts };
  return ending.payload === null
    ? { type: 'result', ok: true, ts }
    : { type: 'result', ok: true, data: ending.payload.value, ts };
}

/**
 * Writes an ending's terminal event, or in text mode what a person reads
 * of it. In events mode a failed ending is one `rafa· error` line on
 * stdout, its exit code when it carries no message, so a watcher reading
 * only those lines sees how the run ended.
 */
export function writeEnding(ending: Ending, event: CliEventResult, base: CliContext, settings: EndingSettings): void {
  if (base.outputMode === 'json') {
    base.output.emit(event);
    return;
  }
  if (base.outputMode === 'events') {
    if (ending.exitCode !== 0) base.output.error(ending.stderrLine ?? `exit code ${ending.exitCode}`);
    return;
  }
  if (ending.stderrLine !== null) settings.stderr.write(`${ending.stderrLine}\n`);
  if (ending.payload !== null) base.output.result(ending.payload.value);
}

/** Writes the terminal event, falling back to `result_unwritable`, and answers the outcome. */
export function finish(ending: Ending, base: CliContext, settings: EndingSettings): DispatchOutcome {
  const event = resultEvent(ending, settings.now);
  try {
    writeEnding(ending, event, base, settings);
    return { exitCode: ending.exitCode, result: event };
  } catch (error) {
    const fallback = failure('result_unwritable', `the result could not be written: ${messageOf(error)}`);
    const fallbackEvent = resultEvent(fallback, settings.now);
    writeEnding(fallback, fallbackEvent, base, settings);
    return { exitCode: fallback.exitCode, result: fallbackEvent };
  }
}
