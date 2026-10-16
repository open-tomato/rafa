/**
 * Errors to bug fields (#952): the part of a bug record an error knows,
 * for the filer to start from.
 *
 * {@link toBugFields} answers four fields and nothing else. `module`,
 * `action` and `cause` are what `failureOf` (`./handler.ts`) answers for
 * the same error and boundary, so a bug filed from a failure names what
 * the dispatcher's error line named. `artifact` is the name, message and
 * stack of the coded error `codedErrorOf` finds, or of the error itself
 * when none is coded: the stack of a `CommandExit` starts in the command
 * that converted the error, the coded error's in the module that threw it.
 *
 * It redacts nothing and fills no version. `readBugLine`
 * (`../commands/issue/create-bug.ts`) takes local paths and named secrets
 * out of every free text, cuts the artifact, reads the error line from
 * its first line and writes the Versions section.
 */
import type { FailureBoundary } from './handler.js';
import type { BugRecord } from '../bugs/record.js';

import { codedErrorOf, failureOf } from './handler.js';

/** The fields of a bug record {@link toBugFields} fills. */
export type ErrorBugFields = Pick<BugRecord, 'action' | 'artifact' | 'cause' | 'module'>;

/**
 * The first line of `error`'s artifact, as the runtime writes it at the
 * head of a stack: the name, then `: ` and the message when there is one.
 */
function headerOf(error: Error): string {
  return error.message === ''
    ? error.name
    : `${error.name}: ${error.message}`;
}

/**
 * The name, message and stack of `error`. A stack that already opens
 * with them is answered as it is; any other is written under them, and
 * an error with no stack answers them alone. A thrown value that is not
 * an `Error` answers its string form.
 */
function artifactOf(error: unknown): string {
  if (!(error instanceof Error)) return String(error);
  const header = headerOf(error);
  const stack = typeof error.stack === 'string'
    ? error.stack
    : '';
  if (stack === '') return header;
  return stack.startsWith(header)
    ? stack
    : `${header}\n${stack}`;
}

/**
 * The bug fields `error` knows, thrown by the command at `boundary`, or
 * with `boundary` null where no command ran; see the module note.
 */
export function toBugFields(error: unknown, boundary: FailureBoundary | null): ErrorBugFields {
  const failure = failureOf(error, boundary);
  return {
    module: failure.module,
    action: failure.action,
    cause: failure.cause,
    artifact: artifactOf(codedErrorOf(error) ?? error),
  };
}
