/**
 * The loop guard at work in a run: the commit the run starts its
 * checkout at, the guard run before each task is dispatched and before
 * each task commit, the guard run around the wrap-up, and the expected
 * HEAD moved on by the loop's own task commits.
 *
 * `./checkout-guard.ts` reads a checkout and compares it with a
 * {@link CheckoutExpectation}; this module holds that expectation across
 * the run and acts on what the guard answers.
 *
 * ## The expectation
 *
 * {@link openCheckoutExpectation} is called once the run's checkout and
 * branch are settled (`./run-checkout.ts`) and before the session record
 * is written, so a checkout it cannot hold refuses the run with exit code
 * 1 the way every refusal before the record does. It reads the checkout
 * and takes its HEAD as the commit the run starts from. It refuses a
 * checkout that is not on the run's branch at a commit: a detached HEAD
 * (where the branch the run names is git's `HEAD`, which no reading ever
 * answers), a branch with no commit yet, and a checkout that is gone or
 * no checkout of its own. Guarding any of them would halt the first task
 * on a move nobody made.
 *
 * {@link advanceExpectation} moves the expected HEAD to the commit a
 * finished task's attempt made, so the loop's own commits never trip the
 * guard before the next dispatch or the next commit. An attempt that made no commit leaves
 * it where it was. A `committed` attempt whose sha git did not answer
 * (`utils/commit.ts` keeps that shape) cannot be told from a commit made
 * outside the loop, so it leaves the expectation where it was too, and
 * the next guard halts on it rather than guessing.
 *
 * ## The halt before a dispatch
 *
 * {@link haltIfCheckoutMoved} runs the guard for the task about to be
 * dispatched. When the checkout held, it answers false and writes
 * nothing. When it moved, or its directory is gone, it marks the task's
 * tracker line `[BLOCKED]` with {@link CHECKOUT_MOVED} as its blocker
 * text (`writeTrackerBlocker` in `utils/tracker.ts`), as `./budget.ts`
 * marks a task that ran out of its budget, prints the guard's lines
 * through the active output's `error`, and answers true: `start()` then
 * stops the run by returning, with no session spawned and nothing
 * committed. A line that comment cannot go on is marked as
 * `updateTrackerLine` marks it.
 *
 * No report is stored for it: no session ran, so there is no session id
 * for a row to carry and no output to read. The tracker line is what the
 * next run reads, and it hands the blocker text to the task's next
 * dispatch. The tracker lives under the project root's `.rafa/`, never
 * in a worktree checkout, so marking it touches nothing the guard found
 * moved.
 *
 * ## The halt before a task commit
 *
 * The same halt runs once a task's session has returned 0 and before the
 * loop commits its work (`before: 'commit'`). A session is told never to
 * commit, so a HEAD it moved reads as a commit made outside the loop and
 * halts like one. The task is marked as above; the session did run, so
 * `start()` stores its report as `blocked` the way it stores any blocked
 * task, and the session's work stays uncommitted in the checkout for the
 * task's next dispatch to find.
 *
 * ## The wrap-up
 *
 * The wrap-up has no tracker line, so {@link haltIfWrapUpMoved} marks
 * nothing: it prints the halt and answers true, and the next run, whose
 * tracker still holds no open task, runs the wrap-up again. It runs at
 * two points. Before the wrap-up session is dispatched (`before:
 * 'dispatch'`) it holds the checkout to the last task commit, as every
 * dispatch does. Before the loop's own `chore: release` commit
 * (`before: 'release'`, `./release-stage.ts`) HEAD has moved by design:
 * the wrap-up session commits, and syncs the branch with main, itself.
 * So that guard runs against {@link expectWrapUpCommits}, the
 * expectation re-based on the HEAD the session left while the checkout
 * still holds the run's branch, and it halts only on a branch that
 * moved or a checkout that is gone. Its headline says the release was
 * not committed, since the session's own commits stand; the release
 * commit, its push and the CI wait are what the halt withholds. The
 * release commit is the run's last loop commit, and no guard follows it.
 *
 * Nothing here switches, stashes, resets or recreates the checkout; the
 * restore line is printed for the operator to run.
 */
import type { CheckoutExpectation, CheckoutGuardSeams } from './checkout-guard.js';
import type { CommitAttempt } from '../utils/commit.js';
import type { TaskInfo } from '../utils/tracker.js';

import { activeOutput } from '../adapters/output/active.js';
import { CommandExit } from '../cli/command.js';
import { updateTrackerLine, writeTrackerBlocker } from '../utils/tracker.js';

import { CHECKOUT_MOVED, guardCheckout, haltHeadline, readCheckout } from './checkout-guard.js';

/** What the run's expectation is opened from: its directories and branch. */
export type CheckoutOpening = Omit<CheckoutExpectation, 'head'>;

/** The HEAD a checkout read at the run's start is held at, or why it cannot be; see the module note. */
function startingHead(opening: CheckoutOpening, seams: CheckoutGuardSeams): { readonly head: string } | { readonly reason: string } {
  const reading = readCheckout(opening.checkout, seams);
  if (reading.kind === 'missing') return { reason: `${opening.checkout} does not exist` };
  if (reading.kind === 'foreign') return { reason: `${opening.checkout} is no git checkout of its own` };
  if (reading.branch === null) return { reason: `${opening.checkout} is at a detached HEAD, on no branch` };
  if (reading.branch !== opening.branch) return { reason: `${opening.checkout} is on ${reading.branch}, not ${opening.branch}` };
  if (reading.head === null) return { reason: `${opening.branch} has no commit yet` };
  return { head: reading.head };
}

/**
 * The expectation the run starts with: its checkout on its branch at the
 * HEAD read now. Throws a {@link CommandExit} with exit code 1 when that
 * checkout cannot be held; see the module note.
 */
export function openCheckoutExpectation(opening: CheckoutOpening, seams: CheckoutGuardSeams = {}): CheckoutExpectation {
  const start = startingHead(opening, seams);
  if ('reason' in start) {
    throw new CommandExit(1, `❌ Refusing to start: the loop guard cannot hold this checkout: ${start.reason}.`);
  }
  return Object.freeze({ ...opening, head: start.head });
}

/**
 * The expectation after a task's commit attempt: at the commit it made,
 * or unchanged when it made none or git did not name it.
 */
export function advanceExpectation(expected: CheckoutExpectation, attempt: Pick<CommitAttempt, 'outcome' | 'sha'>): CheckoutExpectation {
  if (attempt.outcome !== 'committed' || attempt.sha === null) return expected;
  return Object.freeze({ ...expected, head: attempt.sha });
}

/** What {@link haltIfCheckoutMoved} needs: the expectation and the task about to run. */
export interface CheckoutHaltOptions {
  /** The pair the run holds its checkout to. */
  readonly expected: CheckoutExpectation;
  /** The tracker holding the task's line. */
  readonly trackerPath: string;
  /** The task about to be dispatched or committed, as `findNextTask` answered it. */
  readonly taskInfo: Pick<TaskInfo, 'lineNum'>;
  /** Which step the guard runs ahead of: the task's dispatch (the default) or its commit. */
  readonly before?: 'dispatch' | 'commit';
}

/** The line after a task's halt, by the step the guard ran ahead of. */
const TASK_HALT_TAIL: Readonly<Record<'dispatch' | 'commit', string>> = Object.freeze({
  dispatch: `   Task marked as blocked on ${CHECKOUT_MOVED}; nothing was dispatched. Restore the checkout, then run again.`,
  commit: `   Task marked as blocked on ${CHECKOUT_MOVED}; its session's work was left uncommitted. Restore the checkout, then run again to retry the task.`,
});

/** Prints a halt's lines through the active output's `error`, a blank line above the headline. */
function printHalt(lines: readonly string[]): void {
  const [headline, ...rest] = lines;
  activeOutput().error(`\n${headline ?? ''}`);
  for (const line of rest) activeOutput().error(line);
}

/**
 * Runs the guard before a task's dispatch or its commit. False when the
 * checkout held; true once a moved or missing checkout has marked the
 * task `[BLOCKED]` with {@link CHECKOUT_MOVED} and printed the halt. See
 * the module note.
 */
export function haltIfCheckoutMoved(options: CheckoutHaltOptions, seams: CheckoutGuardSeams = {}): boolean {
  const verdict = guardCheckout(options.expected, seams);
  if (verdict.held) return false;

  const { trackerPath, taskInfo } = options;
  if (!writeTrackerBlocker(trackerPath, taskInfo.lineNum, CHECKOUT_MOVED)) {
    updateTrackerLine(trackerPath, taskInfo.lineNum, 'blocked');
  }
  printHalt(verdict.lines);
  activeOutput().error(TASK_HALT_TAIL[options.before ?? 'dispatch']);
  return true;
}

/**
 * The expectation the release commit is guarded against: re-based on the
 * HEAD the wrap-up session left, while the checkout still holds the run's
 * branch at a commit; `expected` as it was otherwise, so the guard after
 * it halts on the move. Reads the checkout; never changes it.
 */
export function expectWrapUpCommits(expected: CheckoutExpectation, seams: CheckoutGuardSeams = {}): CheckoutExpectation {
  const reading = readCheckout(expected.checkout, seams);
  if (reading.kind !== 'read' || reading.branch !== expected.branch || reading.head === null) return expected;
  if (reading.head === expected.head) return expected;
  return Object.freeze({ ...expected, head: reading.head });
}

/** What {@link haltIfWrapUpMoved} needs: the expectation and the step it runs ahead of. */
export interface WrapUpHaltOptions {
  /** The pair the run holds its checkout to; {@link expectWrapUpCommits} ahead of the release. */
  readonly expected: CheckoutExpectation;
  /** The wrap-up session's dispatch, or the loop's release commit after it. */
  readonly before: 'dispatch' | 'release';
}

/**
 * Runs the guard before the wrap-up session or the release commit. False
 * when the checkout held; true once the halt is printed. Marks nothing:
 * the wrap-up has no tracker line. See the module note.
 */
export function haltIfWrapUpMoved(options: WrapUpHaltOptions, seams: CheckoutGuardSeams = {}): boolean {
  const verdict = guardCheckout(options.expected, seams);
  if (verdict.held) return false;

  if (options.before === 'dispatch') {
    printHalt(verdict.lines);
    activeOutput().error('   The wrap-up was not started. Restore the checkout, then run again to retry the wrap-up.');
    return true;
  }
  const [, ...rest] = verdict.lines;
  printHalt([haltHeadline(options.expected.checkout, 'The release was not committed.'), ...rest]);
  activeOutput().error('   The wrap-up session\'s own commits stand; the release commit, its push and the CI wait were skipped. Restore the checkout, then run again to retry the wrap-up.');
  return true;
}
