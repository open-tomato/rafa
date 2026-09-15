/**
 * Tests for the join `rafa effort report` lists its budgeted sessions by
 * (`report-budgets.ts`).
 *
 * Pure over planted session rows and budgets, so no store is opened: the
 * store's reader has its own cases in `store/dispatches.test.ts`, and a
 * report built over a real store has one in `report.test.ts`. The rows
 * carry token counters the report does not sum, thinking and the
 * one-hour cache among them, so a join summing every counter reddens.
 */
import type { ReportSessionRow } from './report.js';
import type { SessionUsageTotals } from './session-log.js';
import type { SessionBudget } from './store/dispatches.js';

import { describe, expect, it } from 'bun:test';

import { budgetedSessions } from './report-budgets.js';
import { emptyUsageTotals } from './session-log.js';

/** A session row holding `usage` over zeroes, and `turns` assistant records. */
function row(sessionId: string, turns: number, usage: Partial<SessionUsageTotals>): ReportSessionRow {
  return {
    sessionId,
    planStub: 'phase-1-installable',
    branch: 'feat/phase-1-installable',
    kind: 'task',
    assistantRecordCount: turns,
    firstTimestamp: null,
    lastTimestamp: null,
    entrypointCounts: {},
    modelCounts: {},
    usage: { ...emptyUsageTotals(), ...usage },
  };
}

/** A budget of `budgetUsd` for `sessionId`. */
function budget(sessionId: string, budgetUsd: number): SessionBudget {
  return { sessionId, planStub: 'phase-1-installable', taskLine: `Task of ${sessionId}`, budgetUsd };
}

const ROWS: readonly ReportSessionRow[] = [
  row('s-a', 4, {
    inputTokens: 10,
    outputTokens: 20,
    cacheReadInputTokens: 300,
    cacheCreationInputTokens: 4000,
    thinkingTokens: 99999,
    ephemeral1hInputTokens: 77777,
  }),
  row('s-b', 1, { inputTokens: 5 }),
];

describe('budgetedSessions', () => {
  it('sets each budget beside the usage of the row holding its session id, in budget order', () => {
    const joined = budgetedSessions(ROWS, [budget('s-b', 2), budget('s-a', 0.5)]);

    expect(joined).toEqual([
      {
        ...budget('s-b', 2),
        usage: { assistantTurns: 1, inputTokens: 5, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, totalTokens: 5 },
      },
      {
        ...budget('s-a', 0.5),
        usage: { assistantTurns: 4, inputTokens: 10, outputTokens: 20, cacheReadTokens: 300, cacheWriteTokens: 4000, totalTokens: 4330 },
      },
    ]);
  });

  it('answers no usage for a session no row holds, and zeroes for one whose row holds zeroes', () => {
    const zeroed = row('s-zero', 0, {});

    const joined = budgetedSessions([...ROWS, zeroed], [budget('s-uncollected', 1), budget('s-zero', 1)]);

    expect(joined.map(({ sessionId, usage }) => [sessionId, usage])).toEqual([
      ['s-uncollected', null],
      ['s-zero', { assistantTurns: 0, inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, totalTokens: 0 }],
    ]);
  });

  it('answers nothing for no budgets, whatever the rows hold', () => {
    expect(budgetedSessions(ROWS, [])).toEqual([]);
  });
});
