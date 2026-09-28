/**
 * Tests for the cancelled-epic notice (`src/board/epic-cancel-notice.ts`):
 * one line per epic closed as not planned whose dependents list is not
 * empty, and no line otherwise.
 *
 * Every case is a pure call over a literal listing built by {@link issue},
 * which reads each row's type with the tracker's own `typeOfLabels`, as
 * `parseBoardListing` does.
 *
 * ## The controls
 *
 *  - No epic cancelled answers no line; the same listing with the epic
 *    closed as not planned answers one, so the empty answer is not a
 *    reader that never answers.
 *  - An epic closed as COMPLETED with the same dependent answers none.
 *  - An unblocked dependent (its body carrying the cancel's note for this
 *    epic) is dropped, beside the same dependent with another epic's note,
 *    which is still named.
 */
import type { BoardIssue } from './roadmap-board.js';

import { describe, expect, it } from 'bun:test';

import { typeOfLabels } from '../adapters/tracker/github.js';

import {
  cancelledEpicNoticeLines,
  readCancelledEpicNotices,
  renderCancelledEpicNotice,
} from './epic-cancel-notice.js';
import { renderUnblockNote } from './epic-trail.js';

/** The fields a case may set on an issue. */
interface IssueFields {
  readonly labels?: readonly string[];
  readonly state?: 'OPEN' | 'CLOSED';
  readonly stateReason?: string | null;
  readonly body?: string;
}

/** One listing row, its type read from its labels. */
function issue(number: number, fields: IssueFields = {}): BoardIssue {
  const labels = fields.labels ?? [];
  return {
    number,
    title: `issue ${String(number)}`,
    body: fields.body ?? '',
    state: fields.state ?? 'OPEN',
    stateReason: fields.stateReason ?? null,
    labels,
    type: typeOfLabels(labels),
    module: 'unassigned',
  };
}

/** An epic issue for `slug`. */
function epic(number: number, slug: string, fields: IssueFields = {}): BoardIssue {
  return issue(number, { ...fields, labels: ['type:epic', `epic:${slug}`, 'horizon:now'] });
}

/** A member of `slug`. */
function member(number: number, slug: string, fields: IssueFields = {}): BoardIssue {
  return issue(number, { ...fields, labels: [`epic:${slug}`] });
}

/** A body waiting on `ids`. */
function blockedBy(...ids: readonly number[]): string {
  return `Some prose.\n\nBlocked by: ${ids.map((id) => `#${String(id)}`).join(' ')}\n`;
}

const NOT_PLANNED: IssueFields = { state: 'CLOSED', stateReason: 'NOT_PLANNED' };
const COMPLETED: IssueFields = { state: 'CLOSED', stateReason: 'COMPLETED' };

/** Epic #1 (`auth`) with `fields`, its open member #2, and #11 in epic #10 waiting on #2. */
function board(fields: IssueFields = {}, dependentBody = blockedBy(2)): readonly BoardIssue[] {
  return [
    epic(1, 'auth', fields),
    member(2, 'auth'),
    epic(10, 'billing'),
    member(11, 'billing', { body: dependentBody }),
  ];
}

describe('readCancelledEpicNotices', () => {
  it('answers no line when no epic is cancelled', () => {
    expect(readCancelledEpicNotices(board())).toEqual([]);
    expect(cancelledEpicNoticeLines(board())).toEqual([]);
  });

  it('answers no line for an empty listing and one with no epic at all', () => {
    expect(cancelledEpicNoticeLines([])).toEqual([]);
    expect(cancelledEpicNoticeLines([issue(5), issue(6, { body: blockedBy(5) })])).toEqual([]);
  });

  it('names the dependents of an epic closed as not planned (control for the empty answers)', () => {
    expect(readCancelledEpicNotices(board(NOT_PLANNED))).toEqual([{ epic: 1, dependents: [11] }]);
  });

  it('answers no line for an epic closed as completed with the same dependent', () => {
    expect(readCancelledEpicNotices(board(COMPLETED))).toEqual([]);
  });

  it('answers no line for a cancelled epic nothing outside it waits on', () => {
    expect(readCancelledEpicNotices(board(NOT_PLANNED, 'no field here'))).toEqual([]);
  });

  it('drops a dependent a cancel closed, since it is no longer open', () => {
    const listing = [...board(NOT_PLANNED).filter((row) => row.number !== 11), member(11, 'billing', { ...NOT_PLANNED, body: blockedBy(2) })];

    expect(readCancelledEpicNotices(listing)).toEqual([]);
  });

  it('drops a dependent carrying the unblock note for this epic', () => {
    const body = `${blockedBy(2)}\n${renderUnblockNote('2026-09-28', 1, [2], [])}`;

    expect(readCancelledEpicNotices(board(NOT_PLANNED, body))).toEqual([]);
  });

  it('still names a dependent carrying another epic\'s note (control)', () => {
    const body = `${blockedBy(2)}\n${renderUnblockNote('2026-09-28', 7, [2], [])}`;

    expect(readCancelledEpicNotices(board(NOT_PLANNED, body))).toEqual([{ epic: 1, dependents: [11] }]);
  });

  it('still names a dependent a cancel moved to another epic, whose line still names the member', () => {
    const listing = [...board(NOT_PLANNED).filter((row) => row.number !== 11), member(11, 'search', { body: blockedBy(2) }), epic(20, 'search')];

    expect(readCancelledEpicNotices(listing)).toEqual([{ epic: 1, dependents: [11] }]);
  });

  it('answers one notice per cancelled epic in ascending number, dependents ascending', () => {
    const listing = [
      epic(30, 'search', NOT_PLANNED),
      member(31, 'search'),
      issue(42, { body: blockedBy(31) }),
      issue(41, { body: blockedBy(31) }),
      ...board(NOT_PLANNED),
    ];

    expect(readCancelledEpicNotices(listing)).toEqual([
      { epic: 1, dependents: [11] },
      { epic: 30, dependents: [41, 42] },
    ]);
  });
});

describe('renderCancelledEpicNotice', () => {
  it('names one dependent and the command', () => {
    expect(renderCancelledEpicNotice({ epic: 50, dependents: [12] })).toBe(
      'Epic #50 was closed as not planned, and #12 still waits on its open members;'
        + ' rafa epic cancel 50 asks what becomes of it.',
    );
  });

  it('names several dependents and the command', () => {
    expect(renderCancelledEpicNotice({ epic: 50, dependents: [12, 13, 14] })).toBe(
      'Epic #50 was closed as not planned, and #12, #13 and #14 still wait on its open members;'
        + ' rafa epic cancel 50 asks what becomes of each.',
    );
  });
});

describe('cancelledEpicNoticeLines', () => {
  it('renders one line per notice', () => {
    expect(cancelledEpicNoticeLines(board(NOT_PLANNED))).toEqual([
      renderCancelledEpicNotice({ epic: 1, dependents: [11] }),
    ]);
  });
});
