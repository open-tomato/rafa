/**
 * The loop guard `start()` runs ahead of a session, whichever it is: a
 * task's or the wrap-up's.
 *
 * `./checkout-watch.ts` holds the two halts, one for a task, which marks
 * its tracker line, and one for the wrap-up, which has no line to mark.
 * {@link haltBeforeSession} picks between them from what `findNextTask`
 * answered, and on a halt emits the run's `halt` event with
 * {@link CHECKOUT_MOVED} as its reason (`./loop-events.ts`), so every
 * call in the loop reads as one line and stops the run the same way.
 *
 * ## Where it runs
 *
 * `start()` calls it twice per turn of the loop:
 *
 * 1. At the top of the turn, once the next task is read and before the
 *    suite steps, so nothing is run in or written into a checkout that
 *    moved.
 * 2. Again right before `renderProgressForDispatch` (`./dispatch.ts`).
 *    The suite steps sit between the two, and the full suite takes
 *    minutes, so a worktree can be removed after the first reading.
 *    Without the second, the render then fails writing `progress.txt`
 *    into a directory that is gone, and the run stops on `progress.txt
 *    could not be rendered from the findings store` and `Make the store
 *    readable, then run again`: a line about a store that is readable,
 *    with the task left unmarked. With it, the task is marked
 *    `[BLOCKED]` with {@link CHECKOUT_MOVED}, the halt names the
 *    checkout and the command that restores it, and the render is never
 *    reached.
 *
 * `dispatchTask` runs the task's halt a third time, immediately before
 * its spawn, since the prompt is built and the session served after the
 * render.
 *
 * The guard reads the checkout and the render writes into it one after
 * the other, never as one step, so a checkout removed between the two
 * still reaches the render's own failure. The second call closes the
 * minutes the suite steps take; it does not close that last instant.
 *
 * No `task-blocked` event is emitted here: both calls come before the
 * task's `task-start` event, as the first always did, and the tracker
 * line carries the blocker to the next run.
 *
 * @module start/session-guard
 */
import type { CheckoutExpectation, CheckoutGuardSeams } from './checkout-guard.js';
import type { TaskInfo } from '../utils/tracker.js';

import { CHECKOUT_MOVED } from './checkout-guard.js';
import { haltIfCheckoutMoved, haltIfWrapUpMoved } from './checkout-watch.js';
import { emitLoopEvent } from './loop-events.js';

/** What {@link haltBeforeSession} needs: the expectation and the session it runs ahead of. */
export interface SessionGuardOptions {
  /** The pair the run holds its checkout to. */
  readonly expected: CheckoutExpectation;
  /** The tracker holding the task's line. Read only when there is a task. */
  readonly trackerPath: string;
  /** The task about to be dispatched, as `findNextTask` answered it, or null ahead of the wrap-up. */
  readonly taskInfo: Pick<TaskInfo, 'lineNum'> | null;
}

/**
 * Runs the loop guard ahead of a session. False when the checkout held,
 * with nothing written, printed or emitted. True once a moved or missing
 * checkout has printed the halt and emitted the `halt` event: for a task,
 * its tracker line is marked `[BLOCKED]` with {@link CHECKOUT_MOVED}; for
 * the wrap-up (a null `taskInfo`), nothing is marked. The caller stops
 * the run by returning. See the module note.
 */
export function haltBeforeSession(options: SessionGuardOptions, seams: CheckoutGuardSeams = {}): boolean {
  const { expected, trackerPath, taskInfo } = options;
  const moved = taskInfo === null
    ? haltIfWrapUpMoved({ expected, before: 'dispatch' }, seams)
    : haltIfCheckoutMoved({ expected, trackerPath, taskInfo }, seams);
  if (moved) emitLoopEvent({ kind: 'halt', reason: CHECKOUT_MOVED });
  return moved;
}
