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
 * A failed ending's `error` carries the dispatcher's `code` and the
 * `message`, and beside them what the error handler
 * (`src/errors/handler.ts`) answered for the failure (#952): its `cause`
 * on every failure, the dispatcher code's own (`no_project` gives
 * `cli:no-project`, {@link causeOfDispatchCode}) unless a coded error
 * explained it; its `hint` when a coded error has one; and its `module`
 * and `action` for a coded failure or a command that ran. A failure is
 * coded when the handler found a `RafaError`, on what was thrown or in
 * its `cause` chain.
 *
 * What is written, by mode:
 *
 *   - **json**: the terminal event, as NDJSON through the context's
 *     output.
 *   - **events**: for a failed ending, one `rafa· error` line on stdout,
 *     its stderr line or `exit code <n>` when it carries none, so a
 *     watcher reading only those lines sees how the run ended; a coded
 *     failure's line ends with its cause in brackets, and no hint line
 *     follows. Nothing for a success.
 *   - **text**: the stderr line, when the ending has one, then the
 *     payload a command gave, as the `text` adapter writes a result. A
 *     coded failure's line ends with its cause in brackets,
 *     `rafa: x [git:no-identity]`, and its hint follows on a line of its
 *     own, `  hint: <hint>`, when it has one. An ending with no stderr
 *     line writes neither. An uncoded failure's line is written as it
 *     is. `--no-hint` never hides the hint line.
 *
 * An event that cannot be written, such as a payload `JSON.stringify`
 * refuses, is replaced by the `result_unwritable` failure with exit code
 * 1, written the same way, and that is the outcome answered.
 */
import type { DispatchErrorCode, DispatchOutcome } from './dispatch.js';
import type { Failure } from '../errors/handler.js';
import type { CliContext } from '@open-tomato/rafa/core/command';
import type { OutputStream } from '@open-tomato/rafa/core/output';
import type { CliEventResult } from '@open-tomato/rafa/ports';

import { causeOfDispatchCode } from '../errors/handler.js';

/** What opens the line a coded failure's hint is written on in text mode. */
const HINT_LINE_OPENING = '  hint: ';

/** A failed ending's error, as its terminal event carries it; see the module note. */
export interface EndingError {
  readonly code: DispatchErrorCode;
  readonly message: string;
  /** The cause code: a coded error's, else the dispatcher code's own. */
  readonly cause?: string;
  /** A coded error's hint, when it has one. */
  readonly hint?: string;
  /** A coded error's module, or the subject of the command that ran. */
  readonly module?: string;
  /** A coded error's action, or the action of the command that ran. */
  readonly action?: string;
}

/** How a route settled, before its terminal event is built. */
export interface Ending {
  readonly exitCode: number;
  /** The payload a command gave, or null. */
  readonly payload: { readonly value: unknown } | null;
  readonly error: EndingError | null;
  /** The line text mode writes to stderr, or null. */
  readonly stderrLine: string | null;
  /**
   * True when a coded error explained the failure, so its cause is
   * written in brackets after the line and its hint below it; see the
   * module note.
   */
  readonly coded: boolean;
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

/**
 * The error a failed ending carries for `code` and `message`, with what
 * the handler answered for it, `found`, or null where nothing was
 * thrown. Its `cause` is `found`'s when `found` is coded, else
 * {@link causeOfDispatchCode}'s for `code`. Its `module` and `action`
 * are `found`'s when it names them, so a caller hands an uncoded
 * `found` in only where a command ran; see the module note.
 */
export function endingError(code: DispatchErrorCode, message: string, found: Failure | null): EndingError {
  const coded = found?.coded === true;
  const cause = coded
    ? found.cause
    : causeOfDispatchCode(code);
  const hint = coded
    ? found.hint
    : null;
  const moduleName = found?.module ?? null;
  const action = found?.action ?? null;
  return {
    code,
    message,
    cause,
    ...(hint === null
      ? {}
      : { hint }),
    ...(moduleName === null
      ? {}
      : { module: moduleName }),
    ...(action === null
      ? {}
      : { action }),
  };
}

/**
 * A failure with exit code 1 and the `rafa: <message>` stderr line,
 * carrying what the handler answered for it, `found`, when anything was
 * thrown; see {@link endingError}.
 */
export function failure(code: DispatchErrorCode, message: string, found: Failure | null = null): Ending {
  return {
    exitCode: 1,
    payload: null,
    error: endingError(code, message, found),
    stderrLine: `rafa: ${message}`,
    coded: found?.coded === true,
  };
}

/** A success, carrying the payload a command gave. */
export function success(payload: { readonly value: unknown } | null): Ending {
  return { exitCode: 0, payload, error: null, stderrLine: null, coded: false };
}

/** The terminal event an ending is told as. */
export function resultEvent(ending: Ending, now: () => Date): CliEventResult {
  const ts = now().toISOString();
  if (ending.error !== null) return { type: 'result', ok: false, error: { ...ending.error }, ts };
  return ending.payload === null
    ? { type: 'result', ok: true, ts }
    : { type: 'result', ok: true, data: ending.payload.value, ts };
}

/** What a failure's line ends with: ` [<cause>]` for a coded failure, else nothing. */
function bracketOf(ending: Ending): string {
  const cause = ending.error?.cause;
  return ending.coded && cause !== undefined
    ? ` [${cause}]`
    : '';
}

/**
 * Writes an ending's terminal event, or in text mode what a person reads
 * of it. In events mode a failed ending is one `rafa· error` line on
 * stdout, its exit code when it carries no message, so a watcher reading
 * only those lines sees how the run ended. A coded failure's line ends
 * with its cause in brackets, and in text mode its hint follows; see the
 * module note.
 */
export function writeEnding(ending: Ending, event: CliEventResult, base: CliContext, settings: EndingSettings): void {
  if (base.outputMode === 'json') {
    base.output.emit(event);
    return;
  }
  if (base.outputMode === 'events') {
    if (ending.exitCode !== 0) base.output.error(`${ending.stderrLine ?? `exit code ${ending.exitCode}`}${bracketOf(ending)}`);
    return;
  }
  if (ending.stderrLine !== null) {
    settings.stderr.write(`${ending.stderrLine}${bracketOf(ending)}\n`);
    const hint = ending.error?.hint;
    if (ending.coded && hint !== undefined) settings.stderr.write(`${HINT_LINE_OPENING}${hint}\n`);
  }
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
