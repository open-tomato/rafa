/**
 * The error handler (#952): what the dispatcher writes for an error that
 * ended a command, read from the error and the command that ran.
 *
 * {@link failureOf} is pure. It reads no logger, no output and no config,
 * since the dispatcher's catch sites sit outside the command's scope and
 * would read the process defaults there; the dispatcher writes the one
 * error line from what it answers. It answers, in order of precedence:
 *
 * - for a `RafaError`, its code, hint, module and action, with the
 *   boundary's action where it has none;
 * - for an error whose `cause` chain holds a `RafaError`, a `CommandExit`
 *   converting a typed error among them, the same read from the first
 *   `RafaError` the chain holds, walked {@link MAX_CAUSE_LINKS} links at
 *   most;
 * - for anything else, `unknown:new-context`, no hint, the boundary's
 *   module and action, and `coded: false`. A plain error is never wrapped
 *   in a new `RafaError` here: its stack would start in this file.
 *
 * {@link codedErrorOf} is the walk alone, which `toBugFields` reads the
 * artifact from. {@link causeOfDispatchCode} answers the cause of one of
 * the dispatcher's own codes. It takes the code as a string, so this file
 * never imports `src/cli/dispatch.ts`, which imports it.
 */

import { familyOf, NEW_CONTEXT_LEAF, UNKNOWN_FAMILY } from '@open-tomato/rafa/errors/codes';
import { RAFA_CODES } from '@open-tomato/rafa/errors/rafa-codes';
import { RafaError } from '@open-tomato/rafa/errors/rafa-error';

/**
 * How many errors the walk reads, the one given counted first: a
 * `RafaError` eight links down is found, one nine links down is not. The
 * bound also ends a chain whose `cause` loops back on itself.
 */
export const MAX_CAUSE_LINKS = 8;

/** The cause of a failure no coded error explains. */
export const UNCODED_CAUSE: string = `${UNKNOWN_FAMILY}:${NEW_CONTEXT_LEAF}`;

/** The family of the dispatcher's own codes in `RAFA_CODES`. */
const DISPATCH_FAMILY = 'cli';

/** The dispatcher's code for a command that threw; see {@link causeOfDispatchCode}. */
const COMMAND_ERROR = 'command_error';

/**
 * The command that ran, as the dispatcher routed it: its
 * `RafaCommand.subject` as `module` and its `RafaCommand.action`.
 */
export interface FailureBoundary {
  readonly module: string;
  readonly action: string;
}

/** What the dispatcher writes for a failure; see the module note. */
export interface Failure {
  /** The coded error's code, else `unknown:new-context`. */
  readonly cause: string;
  /** The coded error's hint, or null; an uncoded failure has none. */
  readonly hint: string | null;
  /** The coded error's module, else the boundary's, else null. */
  readonly module: string | null;
  /** The coded error's action, else the boundary's, else null. */
  readonly action: string | null;
  /** True when a `RafaError` was found, on the error or in its chain. */
  readonly coded: boolean;
}

/**
 * The first `RafaError` among `error` and the errors its `cause` chain
 * reaches, {@link MAX_CAUSE_LINKS} links at most, or null when there is
 * none. A link that is not an object ends the walk.
 */
export function codedErrorOf(error: unknown): RafaError | null {
  let link: unknown = error;
  for (let read = 0; read < MAX_CAUSE_LINKS; read += 1) {
    if (link instanceof RafaError) return link;
    if (typeof link !== 'object' || link === null || !('cause' in link)) return null;
    link = link.cause;
  }
  return null;
}

/**
 * What the dispatcher writes for `error`, thrown by the command at
 * `boundary`, or with `boundary` null where no command ran; see the
 * module note.
 */
export function failureOf(error: unknown, boundary: FailureBoundary | null): Failure {
  const coded = codedErrorOf(error);
  if (coded === null) {
    return {
      cause: UNCODED_CAUSE,
      hint: null,
      module: boundary?.module ?? null,
      action: boundary?.action ?? null,
      coded: false,
    };
  }
  return {
    cause: coded.code,
    hint: coded.hint,
    module: coded.module,
    action: coded.action ?? boundary?.action ?? null,
    coded: true,
  };
}

/**
 * The cause of a dispatcher code, as `src/cli/dispatch.ts` spells it
 * (`unknown_subject`, `no_project`): the code of the `cli:` entry of
 * `RAFA_CODES` whose `legacy` is `code`. `command_error` answers
 * `unknown:new-context`, since the cause of a crash is not known, and so
 * does a code no entry spells.
 */
export function causeOfDispatchCode(code: string): string {
  if (code === COMMAND_ERROR) return UNCODED_CAUSE;
  const entry = RAFA_CODES.find((candidate) => candidate.legacy === code && familyOf(candidate.code) === DISPATCH_FAMILY);
  return entry?.code ?? UNCODED_CAUSE;
}
