/**
 * Tests for the dependents query (`src/board/epic-dependents.ts`): the
 * open issues outside an epic whose `Blocked by:` line names one of its
 * open members, the members each waits on, and the unreadable lines
 * reported as problems.
 *
 * Every case is a pure call over a literal listing built by {@link issue},
 * which reads each row's type with the tracker's own `typeOfLabels`, as
 * `parseBoardListing` does.
 *
 * ## The controls
 *
 * Each reading could pass while wrong, so each is paired with one that
 * must read the other way:
 *
 *  - The dependent is read beside the same listing with the blocking
 *    member closed, which must list nothing; a query that ignored the
 *    member's state passes the first and fails the second.
 *  - An issue inside the epic naming a member is read beside the same
 *    body on an outsider, which must be a dependent.
 *  - A closed outsider is read beside the same outsider open.
 *  - The unreadable line is read beside the same line with the unknown
 *    id dropped, which must be a dependent and no problem.
 *  - The problem is read beside a faulty line naming no member, which
 *    must be no problem.
 */
import type { BoardIssue } from './roadmap-board.js';

import { describe, expect, it } from 'bun:test';

import { typeOfLabels } from '../adapters/tracker/github.js';

import { blockedFaultMessage, readBlockedBy } from './blocked.js';
import { readEpicDependents } from './epic-dependents.js';

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
  return issue(number, { ...fields, labels: [`epic:${slug}`, ...fields.labels ?? []] });
}

/** A body waiting on `ids`. */
function blockedBy(...ids: readonly number[]): string {
  return `Some prose.\n\nBlocked by: ${ids.map((id) => `#${String(id)}`).join(' ')}\n`;
}

/** Closed as completed. */
const CLOSED: IssueFields = { state: 'CLOSED', stateReason: 'COMPLETED' };

/** The epic under test (#1, `auth`), two open members, one closed, and another epic (#10, `billing`). */
function board(...rest: readonly BoardIssue[]): readonly BoardIssue[] {
  return [
    epic(1, 'auth'),
    member(2, 'auth'),
    member(3, 'auth'),
    member(4, 'auth', CLOSED),
    epic(10, 'billing'),
    ...rest,
  ];
}

/** The numbers of the dependents, and what each waits on. */
function waits(issues: readonly BoardIssue[], number = 1): readonly (readonly [number, readonly number[]])[] {
  return (readEpicDependents(issues, number)?.dependents ?? [])
    .map((dependent) => [dependent.issue.number, dependent.waitsOn] as const);
}

describe('readEpicDependents', () => {
  it('lists an open issue in another epic that waits on an open member', () => {
    const read = readEpicDependents(board(member(11, 'billing', { body: blockedBy(2) })), 1);

    expect(read?.epic).toBe(1);
    expect(read?.slug).toBe('auth');
    expect(read?.openMembers).toEqual([2, 3]);
    expect(read?.dependents.map((dependent) => dependent.issue.number)).toEqual([11]);
    expect(read?.dependents[0]?.waitsOn).toEqual([2]);
    expect(read?.problems).toEqual([]);
  });

  it('lists nothing when the named member is closed (control)', () => {
    expect(waits(board(member(11, 'billing', { body: blockedBy(4) })))).toEqual([]);
  });

  it('names only the open members a line waits on, in line order', () => {
    const listing = board(issue(20, { body: blockedBy(3, 4, 11, 2) }), member(11, 'billing'));

    expect(waits(listing)).toEqual([[20, [3, 2]]]);
  });

  it('lists an issue in no epic and a type:epic issue of another epic', () => {
    const listing = [
      ...board(issue(20, { body: blockedBy(3) })),
      epic(30, 'search', { body: blockedBy(2) }),
    ];

    expect(waits(listing)).toEqual([[20, [3]], [30, [2]]]);
  });

  it('answers dependents in ascending issue number whatever the listing order', () => {
    const listing = [...board(), issue(40, { body: blockedBy(2) }), issue(20, { body: blockedBy(3) })];

    expect(waits(listing)).toEqual([[20, [3]], [40, [2]]]);
  });

  it('never lists a member of the epic, even one carrying another epic label', () => {
    const inside = board(
      member(5, 'auth', { body: blockedBy(2) }),
      member(6, 'auth', { labels: ['epic:billing'], body: blockedBy(3) }),
    );

    expect(waits(inside)).toEqual([]);
  });

  it('lists the same body on an outsider (control)', () => {
    expect(waits(board(member(5, 'billing', { body: blockedBy(2) })))).toEqual([[5, [2]]]);
  });

  it('leaves a closed outsider out', () => {
    expect(waits(board(issue(20, { ...CLOSED, body: blockedBy(2) })))).toEqual([]);
    expect(waits(board(issue(20, { body: blockedBy(2) })))).toEqual([[20, [2]]]);
  });

  it('leaves the epic itself out when its body names a member', () => {
    const listing = [epic(1, 'auth', { body: blockedBy(2) }), member(2, 'auth')];

    expect(waits(listing)).toEqual([]);
  });

  it('leaves out an issue naming only non-members, and one with no line', () => {
    const listing = board(issue(20, { body: blockedBy(10) }), issue(21, { body: 'no field here' }));

    expect(readEpicDependents(listing, 1)).toMatchObject({ dependents: [], problems: [] });
  });

  it('reports an unreadable line naming an open member as a problem, not a dependent', () => {
    const body = blockedBy(2, 999);
    const read = readEpicDependents(board(issue(20, { body })), 1);
    const reading = readBlockedBy(20, body, new Set([1, 2, 3, 4, 10, 20]));

    expect(read?.dependents).toEqual([]);
    expect(read?.problems).toHaveLength(1);
    expect(read?.problems[0]?.issue).toBe(20);
    expect(read?.problems[0]?.names).toEqual([2]);
    expect(read?.problems[0]?.reading.kind).toBe('unknown-issue');
    expect(read?.problems[0]?.message).toBe(blockedFaultMessage(reading));
  });

  it('lists the same line without the unknown id as a dependent (control)', () => {
    const read = readEpicDependents(board(issue(20, { body: blockedBy(2) })), 1);

    expect(read?.problems).toEqual([]);
    expect(read?.dependents.map((dependent) => dependent.issue.number)).toEqual([20]);
  });

  it('reports a self-referencing line naming a member', () => {
    const read = readEpicDependents(board(issue(20, { body: blockedBy(20, 3) })), 1);

    expect(read?.dependents).toEqual([]);
    expect(read?.problems.map((problem) => [problem.issue, problem.reading.kind, problem.names])).toEqual([
      [20, 'self-reference', [3]],
    ]);
  });

  it('does not report a faulty line naming no member of the epic', () => {
    const read = readEpicDependents(board(issue(20, { body: blockedBy(10, 999) }), issue(21, { body: 'Blocked by: the API work' })), 1);

    expect(read?.problems).toEqual([]);
    expect(read?.dependents).toEqual([]);
  });

  it('answers no dependents for an epic carrying no epic label', () => {
    const listing = [issue(1, { labels: ['type:epic'] }), issue(20, { body: blockedBy(2) }), member(2, 'auth')];

    expect(readEpicDependents(listing, 1)).toEqual({
      epic: 1,
      slug: null,
      openMembers: [],
      dependents: [],
      problems: [],
    });
  });

  it('still answers the dependents of an epic closed as not planned', () => {
    const listing = [
      epic(1, 'auth', { state: 'CLOSED', stateReason: 'NOT_PLANNED' }),
      member(2, 'auth'),
      issue(20, { body: blockedBy(2) }),
    ];

    expect(waits(listing)).toEqual([[20, [2]]]);
  });

  it('answers null for a number the listing has no type:epic issue for', () => {
    expect(readEpicDependents(board(), 2)).toBeNull();
    expect(readEpicDependents(board(), 99)).toBeNull();
    expect(readEpicDependents(board(), 10)).not.toBeNull();
  });
});
