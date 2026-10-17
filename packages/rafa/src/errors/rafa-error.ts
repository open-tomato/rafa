/**
 * `RafaError`: the base of rafa's coded errors (#952). An error built on
 * it carries a cause code (`./codes.ts`), a hint, a level, and the module
 * and action that threw it, beside JavaScript's own message and cause.
 *
 * A module class sets its module once, as a static, and needs no
 * constructor of its own:
 *
 * ```ts
 * class LoopError extends RafaError {
 *   static readonly module = 'loop';
 * }
 *
 * throw new LoopError({ code: 'git:no-identity', message: 'no author identity is set' });
 * ```
 *
 * The constructor never throws: a failure while an error is built would
 * replace the failure it was built to report. So a code that is not
 * `<family>:<leaf>` becomes `unknown:new-context`, with the value given
 * kept as `context.code`, and a shaped code is kept as written, whether
 * rafa's list holds it or not. A project's code is checked where a config
 * exists, by the bug filer, never here.
 *
 * The file imports `./codes.js` and `./rafa-codes.js` and nothing else.
 * `ScopeError` extends this class and is reached from the effort store,
 * so any further import, the config's above all, risks an import cycle.
 */

import type { ErrorCodeEntry, ErrorLevel } from './codes.js';

import { CODE_PATTERN, NEW_CONTEXT_LEAF, UNKNOWN_FAMILY } from './codes.js';
import { RAFA_CODES } from './rafa-codes.js';

/** The module of a class that sets no `static module`. */
export const UNKNOWN_MODULE = 'unknown';

/** The code an unshaped one is replaced by. */
const LAST_RESORT_CODE = `${UNKNOWN_FAMILY}:${NEW_CONTEXT_LEAF}`;

/** What a {@link RafaError} is built from. */
export interface RafaErrorOptions {
  /** The cause code, `<family>:<leaf>`; see the module note for any other value. */
  readonly code: string;
  /** The error line, as `Error` takes it. */
  readonly message: string;
  /** The action that threw, when the thrower names one. */
  readonly action?: string;
  /** The next step for the reader; the code's own hint when absent. */
  readonly hint?: string;
  /** What else the thrower knows; never a secret's value. */
  readonly context?: Readonly<Record<string, unknown>>;
  /** The error this one is reported for, as `ErrorOptions.cause`. */
  readonly cause?: unknown;
}

/**
 * The class a `RafaError` is built as, read for its `static module`.
 * `RafaError` declares no static of its own: a class that sets none, or
 * sets one that is not a non-empty string, answers `unknown`.
 */
interface ModuleClass {
  readonly name: string;
  readonly module?: unknown;
}

/** `value` when it is a non-empty string, else {@link UNKNOWN_MODULE}. */
function moduleOf(value: unknown): string {
  return typeof value === 'string' && value !== ''
    ? value
    : UNKNOWN_MODULE;
}

/** rafa's entry for `code`, or undefined: a `new-context` code has none. */
function entryOf(code: string): ErrorCodeEntry | undefined {
  return RAFA_CODES.find((entry) => entry.code === code);
}

/** The base of rafa's coded errors; see the module note. */
export class RafaError extends Error {
  /** The cause code: as given when shaped, else `unknown:new-context`. */
  readonly code: string;
  /** The hint given, else the code's entry's in `RAFA_CODES`, else null. */
  readonly hint: string | null;
  /** The code's entry's level, else `error`. A thrown error fails whatever its level. */
  readonly level: ErrorLevel;
  /** The constructed class's `static module`, or `unknown`. */
  readonly module: string;
  /** The action given, or null. */
  readonly action: string | null;
  /** The context given, frozen, with `code` holding an unshaped code. */
  readonly context: Readonly<Record<string, unknown>>;

  constructor(options: RafaErrorOptions) {
    super(options.message, 'cause' in options
      ? { cause: options.cause }
      : undefined);
    const shaped = CODE_PATTERN.test(options.code);
    const code = shaped
      ? options.code
      : LAST_RESORT_CODE;
    const entry = entryOf(code);
    const built: ModuleClass = new.target;
    this.code = code;
    this.hint = options.hint ?? entry?.hint ?? null;
    this.level = entry?.level ?? 'error';
    this.module = moduleOf(built.module);
    this.action = options.action ?? null;
    this.context = Object.freeze(shaped
      ? { ...options.context }
      : { ...options.context, code: options.code });
    this.name = built.name;
    if (typeof Error.captureStackTrace === 'function') Error.captureStackTrace(this, new.target);
  }
}
