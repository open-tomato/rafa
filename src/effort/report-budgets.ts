/**
 * The budgeted sessions `rafa effort report` lists: each task session the
 * loop dispatched with a declared budget, beside the usage that session's
 * row measured.
 *
 * The budget comes from the `dispatches` table (`store/dispatches.ts`),
 * read under the repo root whichever backend `store` selects; the usage
 * comes from the session rows handed to the rollup, joined on the session
 * id. A session is listed whether or not `effort collect` has read its log
 * yet. One it has not has null for its usage rather than zeroes, since a
 * session not yet read is not a session that spent nothing.
 *
 * The usage is tokens. A session row stores token counts and no dollar
 * figure, and a text-mode session prints none: measured on Claude Code
 * 2.1.268, the line a session ending on its budget prints names the
 * budget it was handed, not what it spent (`start/budget.ts`). So no cost
 * sits beside the budget, and the two are in different units.
 *
 * The filters do not narrow the list, as they narrow neither the task
 * report tallies nor the preflight halts: the join reads every row handed
 * in, so a session a filter left out of the table still shows its usage
 * here.
 *
 * The import back into `report.ts` is type-only, so `report.ts` importing
 * {@link budgetedSessions} forms no runtime cycle.
 */
import type { ReportSessionRow } from './report.js';
import type { SessionBudget } from './store/dispatches.js';

/** What one session's row measured, in the columns the report's table uses. */
export interface BudgetUsage {
  readonly assistantTurns: number;
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly cacheReadTokens: number;
  readonly cacheWriteTokens: number;
  /** The four token counts above, summed, as a group's total is. */
  readonly totalTokens: number;
}

/** One session dispatched with a budget, beside what its row measured. */
export interface BudgetedSession extends SessionBudget {
  /** Its row's usage, or null when no row for the session was handed in. */
  readonly usage: BudgetUsage | null;
}

/** One row's usage, summed as `report.ts` sums a group's. */
function usageOf(row: ReportSessionRow): BudgetUsage {
  const { usage } = row;
  return {
    assistantTurns: row.assistantRecordCount,
    inputTokens: usage.inputTokens,
    outputTokens: usage.outputTokens,
    cacheReadTokens: usage.cacheReadInputTokens,
    cacheWriteTokens: usage.cacheCreationInputTokens,
    totalTokens: usage.inputTokens
      + usage.outputTokens
      + usage.cacheReadInputTokens
      + usage.cacheCreationInputTokens,
  };
}

/**
 * Each budgeted session, in the order handed in, beside the usage of the
 * row holding its session id. Pure over its inputs; see the module note.
 */
export function budgetedSessions(
  rows: readonly ReportSessionRow[],
  budgets: readonly SessionBudget[],
): BudgetedSession[] {
  const bySession = new Map(rows.map((row) => [row.sessionId, row]));
  return budgets.map((budget) => {
    const row = bySession.get(budget.sessionId);
    return {
      ...budget,
      usage: row === undefined
        ? null
        : usageOf(row),
    };
  });
}
