/**
 * Tests for the epic reader (`src/board/epics.ts`): the grouping by
 * `epic:<slug>`, every computed state, `done/total` with the not-planned
 * tally, the stored state, the disagreement line, lateness and the
 * blocked-by epics.
 *
 * Every case is a pure call over a literal listing built by {@link issue},
 * which reads each row's type with the tracker's own `typeOfLabels`, as
 * `parseBoardListing` does; the module spawns nothing and opens nothing.
 *
 * ## The controls
 *
 * Each reading the task names could pass while wrong, so each is paired
 * with one that must read the other way:
 *
 *  - The not-planned member is read beside the same epic with that
 *    member closed as completed, which must count it; a reader that
 *    dropped every closed member, or none, fails one of the two.
 *  - The empty epic is read beside a one-member epic whose member is
 *    closed, which must read `done`, so an `empty` that was really
 *    "nothing open" fails.
 *  - The failed listing is read beside the same epic read from a listing,
 *    which must not be `unknown`.
 *  - Lateness is read on the day before, on and after the date, and on a
 *    done epic past its date.
 *  - A blocked-by epic is read beside the same blocker closed, which must
 *    name no epic.
 */
import type { BoardIssue } from './roadmap-board.js';

import { describe, expect, it } from 'bun:test';

import { typeOfLabels } from '../adapters/tracker/github.js';

import {
  disagreementOf,
  epicSlugsOf,
  groupByEpicLabel,
  localDay,
  readEpics,
  unknownEpic,
} from './epics.js';

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

/** An epic issue for `slug`, open unless told otherwise. */
function epic(number: number, slug: string, fields: IssueFields = {}): BoardIssue {
  return issue(number, { ...fields, labels: ['type:epic', `epic:${slug}`, 'horizon:now'] });
}

/** A member of `slug`. */
function member(number: number, slug: string, fields: IssueFields = {}): BoardIssue {
  return issue(number, { ...fields, labels: [`epic:${slug}`, ...fields.labels ?? []] });
}

/** A member closed as completed. */
const COMPLETED: IssueFields = { state: 'CLOSED', stateReason: 'COMPLETED' };

/** A member closed as not planned. */
const NOT_PLANNED: IssueFields = { state: 'CLOSED', stateReason: 'NOT_PLANNED' };

/** The day every case is read on: the evening of 2026-10-31, local time. */
const TODAY = new Date(2026, 9, 31, 23, 30);

/** The one epic `issues` answers, read with `claims`. */
function readOne(issues: readonly BoardIssue[], claims: readonly number[] = []) {
  const read = readEpics({ issues, claims: new Set(claims), today: TODAY });
  expect(read.unknown).toBeNull();
  expect(read.epics).toHaveLength(1);
  const [only] = read.epics;
  if (only === undefined) throw new Error('no epic read');
  return only;
}

describe('epicSlugsOf', () => {
  it('answers every epic: label\'s slug in label order, deduped', () => {
    expect(epicSlugsOf(['type:code', 'epic:board', 'module:cli', 'epic:views', 'epic:board']))
      .toEqual(['board', 'views']);
  });

  it('answers no slug for labels carrying no epic: prefix', () => {
    expect(epicSlugsOf(['type:epic', 'horizon:now', 'Epic:board'])).toEqual([]);
  });
});

describe('groupByEpicLabel', () => {
  it('groups by slug in ascending number, leaving every type:epic issue out', () => {
    const groups = groupByEpicLabel([
      member(12, 'board'),
      epic(10, 'board'),
      member(11, 'board'),
      member(20, 'views'),
      issue(30),
    ]);

    expect([...groups.keys()].sort((left, right) => left.localeCompare(right))).toEqual(['board', 'views']);
    expect(groups.get('board')?.map((found) => found.number)).toEqual([11, 12]);
    expect(groups.get('views')?.map((found) => found.number)).toEqual([20]);
  });

  it('puts an issue carrying two epic: labels in both groups', () => {
    const groups = groupByEpicLabel([member(11, 'board', { labels: ['epic:views'] })]);

    expect(groups.get('board')?.map((found) => found.number)).toEqual([11]);
    expect(groups.get('views')?.map((found) => found.number)).toEqual([11]);
  });
});

describe('readEpics computed state', () => {
  it('reads backlog when no member is closed or claimed', () => {
    const read = readOne([epic(10, 'board'), member(11, 'board'), member(12, 'board')]);

    expect(read.state).toBe('backlog');
    expect(read.progress).toEqual({ done: 0, total: 2, notPlanned: 0 });
  });

  it('reads in-progress when a member is claimed and none is closed', () => {
    const read = readOne([epic(10, 'board'), member(11, 'board'), member(12, 'board')], [12]);

    expect(read.state).toBe('in-progress');
    expect(read.progress).toEqual({ done: 0, total: 2, notPlanned: 0 });
  });

  it('reads in-progress when a member is closed and another open', () => {
    const read = readOne([epic(10, 'board'), member(11, 'board', COMPLETED), member(12, 'board')]);

    expect(read.state).toBe('in-progress');
    expect(read.progress).toEqual({ done: 1, total: 2, notPlanned: 0 });
  });

  it('reads done when every member is closed, a null reason counted as done', () => {
    const read = readOne([
      epic(10, 'board'),
      member(11, 'board', COMPLETED),
      member(12, 'board', { state: 'CLOSED', stateReason: null }),
    ]);

    expect(read.state).toBe('done');
    expect(read.progress).toEqual({ done: 2, total: 2, notPlanned: 0 });
  });

  it('never counts a member closed as not planned as done', () => {
    const read = readOne([
      epic(10, 'board'),
      member(11, 'board', COMPLETED),
      member(12, 'board', NOT_PLANNED),
      member(13, 'board'),
    ]);

    expect(read.state).toBe('in-progress');
    expect(read.progress).toEqual({ done: 1, total: 2, notPlanned: 1 });
  });

  it('counts the same member closed as completed on both sides (control)', () => {
    const read = readOne([
      epic(10, 'board'),
      member(11, 'board', COMPLETED),
      member(12, 'board', COMPLETED),
      member(13, 'board'),
    ]);

    expect(read.state).toBe('in-progress');
    expect(read.progress).toEqual({ done: 2, total: 3, notPlanned: 0 });
  });

  it('reads done once every counted member is closed, the not-planned one tallied apart', () => {
    const read = readOne([epic(10, 'board'), member(11, 'board', COMPLETED), member(12, 'board', NOT_PLANNED)]);

    expect(read.state).toBe('done');
    expect(read.progress).toEqual({ done: 1, total: 1, notPlanned: 1 });
  });

  it('reads backlog, not in-progress, when the only closed member was not planned', () => {
    const read = readOne([epic(10, 'board'), member(11, 'board', NOT_PLANNED), member(12, 'board')]);

    expect(read.state).toBe('backlog');
    expect(read.progress).toEqual({ done: 0, total: 1, notPlanned: 1 });
  });

  it('reads backlog at 0/0, never done, when every member was closed as not planned', () => {
    const read = readOne([epic(10, 'board'), member(11, 'board', NOT_PLANNED), member(12, 'board', NOT_PLANNED)]);

    expect(read.state).toBe('backlog');
    expect(read.progress).toEqual({ done: 0, total: 0, notPlanned: 2 });
  });

  it('reads empty, never done, for an epic with no members', () => {
    const read = readOne([epic(10, 'board'), member(11, 'views', COMPLETED)]);

    expect(read.state).toBe('empty');
    expect(read.members).toEqual([]);
    expect(read.progress).toEqual({ done: 0, total: 0, notPlanned: 0 });
  });

  it('reads done for the same epic once its one member carries its label (control)', () => {
    const read = readOne([epic(10, 'board'), member(11, 'board', COMPLETED)]);

    expect(read.state).toBe('done');
    expect(read.members.map((found) => found.number)).toEqual([11]);
  });

  it('reads empty for an epic carrying no epic: label of its own', () => {
    const read = readOne([issue(10, { labels: ['type:epic'] }), member(11, 'board')]);

    expect(read.slug).toBeNull();
    expect(read.state).toBe('empty');
  });

  it('answers members in ascending number, the epic itself left out', () => {
    const read = readOne([member(13, 'board'), epic(10, 'board'), member(11, 'board')]);

    expect(read.slug).toBe('board');
    expect(read.members.map((found) => found.number)).toEqual([11, 13]);
  });
});

describe('readEpics on a failed listing', () => {
  it('reads unknown with its reason, never backlog', () => {
    const read = readEpics({ issues: null, reason: 'gh: HTTP 502', claims: new Set(), today: TODAY });

    expect(read.unknown).toBe('gh: HTTP 502');
    expect(read.epics).toEqual([]);
  });

  it('keeps a reason saying it gave none when the caller names none', () => {
    const read = readEpics({ issues: null, claims: new Set(), today: TODAY });

    expect(read.unknown).toBe('the board listing failed and gave no reason');
  });

  it('answers an epic known by number as unknown, with no members, progress or stored state', () => {
    const read = unknownEpic(10, 'gh: HTTP 502');

    expect(read.state).toBe('unknown');
    expect(read.reason).toBe('gh: HTTP 502');
    expect(read.members).toEqual([]);
    expect(read.progress).toEqual({ done: 0, total: 0, notPlanned: 0 });
    expect(read.stored).toBeNull();
    expect(read.disagreement).toBeNull();
    expect(read.late).toBe(false);
  });

  it('reads the same epic off a listing as something other than unknown (control)', () => {
    const read = readOne([epic(10, 'board'), member(11, 'board')]);

    expect(read.state).toBe('backlog');
    expect(read.reason).toBeNull();
  });
});

describe('readEpics stored state', () => {
  it('reads open for an open epic', () => {
    expect(readOne([epic(10, 'board'), member(11, 'board')]).stored).toBe('open');
  });

  it('reads closed for an epic closed as completed', () => {
    expect(readOne([epic(10, 'board', COMPLETED), member(11, 'board', COMPLETED)]).stored).toBe('closed');
  });

  it('reads cancelled for an epic closed as not planned after a member closed', () => {
    const read = readOne([epic(10, 'board', NOT_PLANNED), member(11, 'board', COMPLETED), member(12, 'board', NOT_PLANNED)]);

    expect(read.stored).toBe('cancelled');
  });

  it('reads cancelled when the only sign of work is a claim on a member dropped since', () => {
    const read = readOne([epic(10, 'board', NOT_PLANNED), member(11, 'board', NOT_PLANNED)], [11]);

    expect(read.stored).toBe('cancelled');
  });

  it('reads discarded for an epic closed as not planned with no work started', () => {
    const read = readOne([epic(10, 'board', NOT_PLANNED), member(11, 'board', NOT_PLANNED), member(12, 'board')]);

    expect(read.stored).toBe('discarded');
  });
});

describe('readEpics disagreement', () => {
  it('prints the done-but-open line for an open epic whose members are all closed', () => {
    const read = readOne([epic(10, 'board'), member(11, 'board', COMPLETED)]);

    expect(read.disagreement).toBe('done, but epic #10 is still open');
  });

  it('prints the computed state for a closed epic with open work', () => {
    const read = readOne([epic(10, 'board', COMPLETED), member(11, 'board', COMPLETED), member(12, 'board')]);

    expect(read.disagreement).toBe('in-progress, but epic #10 is closed');
  });

  it('prints the empty-but-closed line for a closed epic with no members', () => {
    expect(readOne([epic(10, 'board', COMPLETED)]).disagreement).toBe('empty, but epic #10 is closed');
  });

  it('prints nothing when stored and computed agree', () => {
    expect(readOne([epic(10, 'board', COMPLETED), member(11, 'board', COMPLETED)]).disagreement).toBeNull();
    expect(readOne([epic(10, 'board'), member(11, 'board')]).disagreement).toBeNull();
  });

  it('prints nothing for an epic dropped on purpose, whatever it computes', () => {
    expect(readOne([epic(10, 'board', NOT_PLANNED), member(11, 'board', COMPLETED)]).disagreement).toBeNull();
    expect(readOne([epic(10, 'board', NOT_PLANNED), member(11, 'board')]).disagreement).toBeNull();
  });

  it('prints nothing for an unknown epic', () => {
    expect(disagreementOf(10, 'unknown', 'closed')).toBeNull();
    expect(disagreementOf(10, 'unknown', null)).toBeNull();
  });
});

describe('readEpics lateness', () => {
  /** The epic dated `date`, with one open member unless `done`. */
  function dated(date: string, done = false): boolean {
    const body = `## Acceptance criteria\n\n- it works\n\nEstimate: a week\nDate: ${date}\n`;
    return readOne([
      epic(10, 'board', { body }),
      member(11, 'board', done
        ? COMPLETED
        : {}),
    ]).late;
  }

  it('reads today as the local calendar day, even late in the evening', () => {
    expect(localDay(TODAY)).toBe('2026-10-31');
    expect(localDay(new Date(2026, 0, 5, 0, 1))).toBe('2026-01-05');
  });

  it('reads an epic dated before today and not done as late', () => {
    expect(dated('2026-10-30')).toBe(true);
  });

  it('reads an epic on its own date, or before it, as not late', () => {
    expect(dated('2026-10-31')).toBe(false);
    expect(dated('2026-11-01')).toBe(false);
  });

  it('reads a done epic past its date as not late', () => {
    expect(dated('2026-10-30', true)).toBe(false);
  });

  it('reads an epic with no date, or a malformed one, as not late', () => {
    expect(readOne([epic(10, 'board'), member(11, 'board')]).late).toBe(false);
    expect(dated('2026-02-30')).toBe(false);
  });
});

describe('readEpics blocked by', () => {
  /** Two epics, a member of `board` blocked by #21, a member of `views` in `blocker`'s state. */
  function board(blocker: IssueFields, blocked: IssueFields = {}): readonly BoardIssue[] {
    return [
      epic(10, 'board'),
      member(11, 'board', { ...blocked, body: 'Blocked by: #21' }),
      epic(20, 'views'),
      member(21, 'views', blocker),
    ];
  }

  /** The blocked-by epics of epic `number` on `issues`. */
  function blockedBy(issues: readonly BoardIssue[], number: number): readonly number[] | undefined {
    return readEpics({ issues, claims: new Set(), today: TODAY }).epics
      .find((found) => found.number === number)?.blockedBy;
  }

  it('names the epic owning an open blocker of an open member', () => {
    expect(blockedBy(board({}), 10)).toEqual([20]);
    expect(blockedBy(board({}), 20)).toEqual([]);
  });

  it('names no epic once the blocker is closed (control)', () => {
    expect(blockedBy(board(COMPLETED), 10)).toEqual([]);
  });

  it('names no epic for a blocked member that is itself closed', () => {
    expect(blockedBy(board({}, COMPLETED), 10)).toEqual([]);
  });

  it('leaves the epic itself out when the blocker is its own member', () => {
    const issues = [epic(10, 'board'), member(11, 'board', { body: 'Blocked by: #12' }), member(12, 'board')];

    expect(blockedBy(issues, 10)).toEqual([]);
  });

  it('names a type:epic blocker as the epic it is', () => {
    const issues = [epic(10, 'board'), member(11, 'board', { body: 'Blocked by: #20' }), epic(20, 'views')];

    expect(blockedBy(issues, 10)).toEqual([20]);
  });

  it('acts on no faulty line: one naming its own issue names no epic', () => {
    const issues = [...board({}), member(12, 'board', { body: 'Blocked by: #12 #21' })]
      .map((found) => found.number === 11
        ? member(11, 'board')
        : found);

    expect(blockedBy(issues, 10)).toEqual([]);
  });

  it('dedupes and sorts the epics named by several members', () => {
    const issues = [
      epic(10, 'board'),
      member(11, 'board', { body: 'Blocked by: #31 #21' }),
      member(12, 'board', { body: 'Blocked by: #21' }),
      epic(20, 'views'),
      member(21, 'views'),
      epic(30, 'docs'),
      member(31, 'docs'),
    ];

    expect(blockedBy(issues, 10)).toEqual([20, 30]);
  });

  it('names no epic for an open blocker whose slug no epic carries', () => {
    const issues = [epic(10, 'board'), member(11, 'board', { body: 'Blocked by: #21' }), member(21, 'bord')];

    expect(blockedBy(issues, 10)).toEqual([]);
  });
});
