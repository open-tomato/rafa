/**
 * Tests for `withSubIssuesSummary` (`src/board/epic-summary.ts`): a
 * `native`-mode epic's `done/total` and state taken off its row's
 * `subIssuesSummary`, over the epic `readEpics` read from the same
 * listing through the real `native` adapter.
 *
 * ## The controls
 *
 * Every summary below disagrees with the members the listing holds (the
 * epic has one sub-issue on the listing, open, and GitHub counts more),
 * so each case is also read without the summary: the listing's own count
 * answers otherwise, and a function that ignored the summary could not
 * pass both.
 */
import type { Epic } from './epics.js';
import type { BoardIssue, BoardSubIssuesSummary } from './roadmap-board.js';
import type { GhRunner } from '../adapters/tracker/github.js';

import { describe, expect, it } from 'bun:test';

import { withSubIssuesSummary } from './epic-summary.js';
import { readEpics } from './epics.js';
import { createNativeRelations } from './relations/native.js';

/** The board's own repository. */
const BOARD = 'acme/board';

/** A `gh` every call to which fails the case. */
const NO_GH: GhRunner = (args) => {
  throw new Error(`a read sent gh ${args.join(' ')}`);
};

const NATIVE = createNativeRelations({ gh: NO_GH, repository: BOARD });

/** A fixed day: the epic's date below is before it. */
const TODAY = new Date(2026, 8, 30);

/** The epic's number, and its one sub-issue on the listing. */
const EPIC = 10;
const MEMBER = 11;

/** A native row with every native field, `fields` laid over it. */
function row(number: number, fields: Partial<BoardIssue> = {}): BoardIssue {
  return {
    number,
    title: `issue ${String(number)}`,
    body: '',
    state: 'OPEN',
    stateReason: null,
    labels: [],
    type: 'spec',
    module: 'unassigned',
    parent: null,
    blockedBy: { nodes: [] },
    blocking: { nodes: [] },
    subIssuesSummary: { total: 0, completed: 0, percentCompleted: 0 },
    subIssues: { nodes: [] },
    ...fields,
  };
}

/** The epic's row, GitHub counting `summary`, dated before {@link TODAY}. */
function epicRow(summary: BoardSubIssuesSummary, fields: Partial<BoardIssue> = {}): BoardIssue {
  return row(EPIC, {
    labels: ['type:epic', 'horizon:now'],
    type: 'epic',
    body: '## Acceptance criteria\n\n- it works\n\nDate: 2026-01-01\n',
    subIssuesSummary: summary,
    subIssues: { nodes: [{ number: MEMBER, title: 'member', state: 'OPEN', repository: BOARD }] },
    ...fields,
  });
}

/** The one sub-issue on the listing, open. */
const MEMBER_ROW = row(MEMBER, { parent: { number: EPIC, title: 'epic', state: 'OPEN', repository: BOARD } });

/** The epic `readEpics` reads in `native` mode off `epic` and its member. */
function readEpic(epic: BoardIssue, claims: ReadonlySet<number> = new Set()): Epic {
  const read = readEpics({ issues: [epic, MEMBER_ROW], claims, today: TODAY, relations: NATIVE }).epics[0];
  if (read === undefined) throw new Error('the epic was not read');
  return read;
}

/** Summary `completed` of `total`. */
function summary(completed: number, total: number): BoardSubIssuesSummary {
  return { total, completed, percentCompleted: total === 0
    ? 0
    : Math.floor((completed * 100) / total) };
}

describe('withSubIssuesSummary', () => {
  it('takes done and total from the summary, and keeps the listing\'s not-planned tally', () => {
    const row10 = epicRow(summary(2, 5));
    const epic = readEpic(row10);
    expect(epic.progress).toEqual({ done: 0, total: 1, notPlanned: 0 });

    expect(withSubIssuesSummary(epic, row10, new Set(), TODAY).progress).toEqual({ done: 2, total: 5, notPlanned: 0 });
  });

  it('reads done when every sub-issue GitHub counts is completed, and is then not late', () => {
    const row10 = epicRow(summary(3, 3));
    const epic = readEpic(row10);
    expect(epic.state).toBe('backlog');
    expect(epic.late).toBe(true);

    const read = withSubIssuesSummary(epic, row10, new Set(), TODAY);
    expect(read.state).toBe('done');
    expect(read.late).toBe(false);
  });

  it('reads in-progress when a sub-issue is completed, though no member on the listing is closed', () => {
    const row10 = epicRow(summary(1, 3));
    const epic = readEpic(row10);
    expect(epic.state).toBe('backlog');

    expect(withSubIssuesSummary(epic, row10, new Set(), TODAY).state).toBe('in-progress');
  });

  it('reads in-progress when a member on the listing is claimed, and backlog without the claim', () => {
    const row10 = epicRow(summary(0, 3));
    expect(withSubIssuesSummary(readEpic(row10), row10, new Set(), TODAY).state).toBe('backlog');
    expect(withSubIssuesSummary(readEpic(row10), row10, new Set([MEMBER]), TODAY).state).toBe('in-progress');
  });

  it('reads empty when GitHub counts no sub-issue, whatever the listing holds', () => {
    const row10 = epicRow(summary(0, 0));
    const epic = readEpic(row10);
    expect(epic.members).toHaveLength(1);

    const read = withSubIssuesSummary(epic, row10, new Set(), TODAY);
    expect(read.state).toBe('empty');
    expect(read.progress).toEqual({ done: 0, total: 0, notPlanned: 0 });
  });

  it('recomputes the disagreement from the summary\'s state', () => {
    const open = epicRow(summary(2, 2));
    expect(readEpic(open).disagreement).toBeNull();
    expect(withSubIssuesSummary(readEpic(open), open, new Set(), TODAY).disagreement).toBe('done, but epic #10 is still open');

    const closed = epicRow(summary(1, 2), { state: 'CLOSED', stateReason: 'COMPLETED' });
    expect(withSubIssuesSummary(readEpic(closed), closed, new Set(), TODAY).disagreement)
      .toBe('in-progress, but epic #10 is closed');
  });

  it('keeps the members, the order and the stored state readEpics read', () => {
    const row10 = epicRow(summary(1, 4));
    const epic = readEpic(row10);
    const read = withSubIssuesSummary(epic, row10, new Set(), TODAY);

    expect(read.members).toBe(epic.members);
    expect(read.order).toBe('sub-issues');
    expect(read.stored).toBe('open');
    expect(read.slug).toBeNull();
  });

  it('refuses a row with no summary, naming board.relationships', () => {
    const row10 = epicRow(summary(1, 2));
    const epic = readEpic(row10);
    const bare = Object.fromEntries(Object.entries(row10).filter(([key]) => key !== 'subIssuesSummary')) as unknown as BoardIssue;

    expect(() => withSubIssuesSummary(epic, bare, new Set(), TODAY)).toThrow(TypeError);
    expect(() => withSubIssuesSummary(epic, bare, new Set(), TODAY)).toThrow(/board\.relationships is native/u);
  });

  it('refuses a row that is not the epic\'s', () => {
    const row10 = epicRow(summary(1, 2));
    expect(() => withSubIssuesSummary(readEpic(row10), MEMBER_ROW, new Set(), TODAY))
      .toThrow('board epic summary: row #11 is not epic #10\'s row');
  });
});
