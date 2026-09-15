/**
 * A task session that ended on its budget: how the loop tells one from
 * any other failed session, and what it does with the task.
 *
 * ## The rule, from its measurement
 *
 * A task declaring `budget=<usd>` is spawned with `--max-budget-usd`
 * (`utils/declaration.ts`). Measured on Claude Code 2.1.268, `claude -p
 * "Say hello" --max-budget-usd 0.01` in the default text output mode
 * exited 1, wrote exactly `Error: Exceeded USD budget (0.01)` to stdout
 * with no newline after it, and wrote nothing to stderr. The amount in
 * the parentheses is the budget the session was handed, not what it
 * spent, and no other text in that mode carries a dollar figure.
 *
 * {@link isBudgetExit} holds a session to what that reading gives, and to
 * one thing the loop knows beside it:
 *
 *   - It was spawned with `--max-budget-usd`. A session handed no budget
 *     never reads as one that ran out of it, whatever it printed.
 *   - It exited 1, the code measured. Any other code is a failed task.
 *   - The last line of its stdout, trailing whitespace off, is the
 *     measured line, with any amount in its parentheses. Only the last
 *     line counts, so a session that quotes the line and then fails is a
 *     failed session. The amount is not compared with the one handed
 *     over, since how the CLI spells a budget other than `0.01` was not
 *     measured.
 *
 * Only stdout is read: the loop captures a task session's stdout and
 * leaves its stderr to the operator (`utils/claude.ts`), and the
 * measurement found the line on stdout.
 *
 * ## What becomes of the task
 *
 * {@link markBudgetExit} marks the task's line `[BLOCKED]` with
 * {@link BUDGET_EXCEEDED} as its blocker comment (`writeTrackerBlocker` in
 * `utils/tracker.ts`), so the task's next dispatch reads what blocked it,
 * and tells the operator through the active output's `error`. A line
 * that comment cannot go on, being no open or blocked task line with
 * text, is marked as `updateTrackerLine` marks it. `start()` then stores
 * the session under the outcome `blocked` and stops the run, as it does
 * for every blocked task: `findNextTask` resumes a blocked task first, so
 * going on would dispatch the same task again at the same budget. Nothing
 * is committed. A budget exit is not a clean exit, and the session's work
 * stays in the tree as a failed session's does.
 */
import type { TaskDispatch } from './dispatch.js';
import type { TaskInfo } from '../utils/tracker.js';

import { activeOutput } from '../adapters/output/active.js';
import { BUDGET_FLAG } from '../utils/declaration.js';
import { updateTrackerLine, writeTrackerBlocker } from '../utils/tracker.js';

/** The blocker text a task that ran out of its budget is marked with. */
export const BUDGET_EXCEEDED = 'budget exceeded';

/** The exit code a session that ran out of its budget was measured with. */
export const BUDGET_EXIT_CODE = 1;

/** The last line of such a session's stdout, whatever amount it names. */
const BUDGET_EXIT_LINE = /^Error: Exceeded USD budget \([^()\n]*\)$/;

/** True when a dispatched session ended on its budget. See the module note. */
export function isBudgetExit(dispatch: Pick<TaskDispatch, 'flags' | 'exitCode' | 'output'>): boolean {
  if (!dispatch.flags.includes(BUDGET_FLAG)) return false;
  if (dispatch.exitCode !== BUDGET_EXIT_CODE) return false;

  const lines = dispatch.output.trimEnd().split('\n');
  return BUDGET_EXIT_LINE.test(lines[lines.length - 1] ?? '');
}

/** What the operator is told a session was handed, when its flags name no budget. */
const NO_AMOUNT = 'its declared amount';

/** The value `flags` passed the budget flag, or {@link NO_AMOUNT} when they pass none. */
function budgetAmount(flags: readonly string[]): string {
  const at = flags.indexOf(BUDGET_FLAG);
  return at === -1
    ? NO_AMOUNT
    : flags[at + 1] ?? NO_AMOUNT;
}

/** What {@link markBudgetExit} needs: the tracker, the task's line, and its dispatch. */
export interface BudgetExitOptions {
  /** The tracker holding the task's line. */
  readonly trackerPath: string;
  /** The task, as `findNextTask` answered it. */
  readonly taskInfo: Pick<TaskInfo, 'lineNum'>;
  /** The flags its session was spawned with, the budget among them. */
  readonly dispatch: Pick<TaskDispatch, 'flags'>;
}

/**
 * Marks a task whose session ended on its budget `[BLOCKED]`, with
 * {@link BUDGET_EXCEEDED} as its blocker text, and says so. See the module
 * note.
 */
export function markBudgetExit(options: BudgetExitOptions): void {
  const { trackerPath, taskInfo, dispatch } = options;
  if (!writeTrackerBlocker(trackerPath, taskInfo.lineNum, BUDGET_EXCEEDED)) {
    updateTrackerLine(trackerPath, taskInfo.lineNum, 'blocked');
  }

  const amount = budgetAmount(dispatch.flags);
  activeOutput().error(`\n⛔ Task stopped on its budget (${BUDGET_FLAG} ${amount}): ${BUDGET_EXCEEDED}. Marked as blocked.`);
  activeOutput().error('   Raise its budget= or split it, then run again to retry.');
}
