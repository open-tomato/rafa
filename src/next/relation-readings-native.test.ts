/**
 * Unit cases for `rafa next`'s relationship readings
 * (`./relation-readings.ts`) handed the board's relationships port in
 * `native` mode: what a line waits on read off its `blockedBy` nodes, an
 * epic's lines in sub-issue order, the pick that passes a blocked line
 * rather than leave one for the `unblock` row, the pick under `roadmap`
 * that stops only for a line the hop rows take, and the hop read through
 * the port. The `labels` cases stay in `./relation-readings.test.ts`.
 *
 * The board, on `acme/board`: board #1 lists epic #5 (`home`), then
 * epic #6 (`far`) and epic #7 (`side`), each `horizon:now`. Epic #5's
 * sub-issues are #11 then #10, the reverse of its checklist; #10 is
 * blocked by #20, open, a sub-issue of #6. Epic #7's sub-issues are #17,
 * blocked by open #20, then #18. #23 waits on #20 and on an open issue
 * of `other/lib`. The other rows are named where a case reads them. Every case reads through the real adapters made over a
 * `gh` that fails any call, so a read that spawned would be seen.
 *
 * ## The controls
 *
 *  - The rows carry the `labels` mode's marks too: `epic:` labels and
 *    checklists, and #10 carries no `spec:blocked`. The same listing
 *    read without the port walks the checklist and reads #10 as waiting
 *    on nothing, so a reading that fell back to labels is seen.
 *  - Each passed line is paired with the pick the `labels` mode makes over
 *    the same lines, which stops at it, or with the same line whose
 *    blocker closed, which is picked.
 */
import type { FollowedHop, HopSeams, WalkAnswer } from './relation-readings.js';
import type { GhRunner } from '../adapters/tracker/github.js';
import type { SpecIssueReader } from '../board/issue.js';
import type { BoardIssue, BoardIssueLink, BoardIssueState } from '../board/roadmap-board.js';
import type { RoadmapLine, RoadmapReadings } from '../board/roadmap.js';
import type { Position } from '../project/position.js';

import { describe, expect, it } from 'bun:test';

import { typeOfLabels } from '../adapters/tracker/github.js';
import { createNativeRelations } from '../board/relations/native.js';

import {
  blockedLineReadings,
  nativeHopPick,
  nativePick,
  pickerFor,
  plainPick,
  readHopAnswer,
  waitingPick,
  walkEpic,
} from './relation-readings.js';

/** The board's own repository. */
const BOARD = 'acme/board';

/** A `gh` every call to which fails the case: reads never spawn. */
const NO_GH: GhRunner = (args) => {
  throw new Error(`a read sent gh ${args.join(' ')}`);
};

/** The `native` adapter on {@link BOARD}. */
const NATIVE = createNativeRelations({ gh: NO_GH, repository: BOARD });

/** A link to issue `number` on `repository`, in `state`. */
function link(number: number, state: BoardIssueState = 'OPEN', repository = BOARD): BoardIssueLink {
  return { number, title: `Issue ${String(number)}`, state, repository };
}

/** The fields a case may set on a native row. */
interface RowFields {
  readonly labels?: readonly string[];
  readonly body?: string;
  readonly state?: BoardIssueState;
  readonly stateReason?: string | null;
  readonly parent?: number;
  readonly blockedBy?: readonly BoardIssueLink[];
  readonly subIssues?: readonly number[];
}

/** A native row carrying all five native fields, its type read from its labels. */
function row(number: number, fields: RowFields = {}): BoardIssue {
  const labels = fields.labels ?? [];
  const state = fields.state ?? 'OPEN';
  const subIssues = fields.subIssues ?? [];
  return {
    number,
    title: `Issue ${String(number)}`,
    body: fields.body ?? '',
    state,
    stateReason: fields.stateReason ?? (state === 'CLOSED'
      ? 'COMPLETED'
      : null),
    labels,
    type: typeOfLabels(labels),
    module: 'unassigned',
    parent: fields.parent === undefined
      ? null
      : link(fields.parent),
    blockedBy: { nodes: fields.blockedBy ?? [] },
    blocking: { nodes: [] },
    subIssuesSummary: { total: subIssues.length, completed: 0, percentCompleted: 0 },
    subIssues: { nodes: subIssues.map((sub) => link(sub)) },
  };
}

/** A checklist naming `items`, unticked. */
function checklist(items: readonly number[]): string {
  return items.map((item) => `- [ ] #${String(item)}`).join('\n');
}

/** An epic whose own slug is `slug`, listing `listed` and holding `subIssues` in that order. */
function epic(number: number, slug: string, listed: readonly number[], subIssues: readonly number[]): BoardIssue {
  return row(number, { labels: ['type:epic', `epic:${slug}`, 'horizon:now'], body: checklist(listed), subIssues });
}

/** The board the module note describes; `overrides` replace rows by number. */
function listingWith(...overrides: readonly BoardIssue[]): readonly BoardIssue[] {
  const rows: readonly BoardIssue[] = [
    row(1, { labels: ['type:roadmap'], body: checklist([5, 6, 7]) }),
    epic(5, 'home', [10, 11], [11, 10]),
    epic(6, 'far', [20, 21], [20, 21]),
    epic(7, 'side', [17, 18], [17, 18]),
    row(10, { labels: ['epic:home'], parent: 5, blockedBy: [link(20)] }),
    row(11, { labels: ['epic:home'], parent: 5 }),
    row(12, { blockedBy: [link(30, 'CLOSED')] }),
    row(14, { blockedBy: [link(40)] }),
    row(15, { blockedBy: [link(7, 'OPEN', 'other/lib')] }),
    row(16, { blockedBy: [link(20)] }),
    row(17, { labels: ['epic:side'], parent: 7, blockedBy: [link(20)] }),
    row(18, { labels: ['epic:side'], parent: 7 }),
    row(19, { blockedBy: [link(22)] }),
    row(20, { labels: ['epic:far'], parent: 6 }),
    row(21, { labels: ['epic:far'], parent: 6 }),
    row(22, { parent: 6, blockedBy: [link(21)] }),
    row(23, { blockedBy: [link(20), link(7, 'OPEN', 'other/lib')] }),
    row(30, { state: 'CLOSED', stateReason: 'NOT_PLANNED' }),
    row(40),
  ];
  return rows.map((each) => overrides.find((over) => over.number === each.number) ?? each);
}

/** #20 closed as done, as its blockers' nodes then read it. */
function withTwentyClosed(): readonly BoardIssue[] {
  const closed = link(20, 'CLOSED');
  return listingWith(
    row(10, { labels: ['epic:home'], parent: 5, blockedBy: [closed] }),
    row(17, { labels: ['epic:side'], parent: 7, blockedBy: [closed] }),
    row(20, { labels: ['epic:far'], parent: 6, state: 'CLOSED' }),
  );
}

/** An issue reader over `rows`, counting what it was asked. */
function readerOver(rows: readonly BoardIssue[]): { readonly issues: SpecIssueReader; readonly asked: number[] } {
  const asked: number[] = [];
  const issues: SpecIssueReader = (number) => {
    asked.push(number);
    const found = rows.find((each) => each.number === number);
    if (found === undefined) return Promise.reject(new Error(`#${String(number)} is not planted`));
    return Promise.resolve({ number, title: found.title, body: found.body, state: found.state, labels: found.labels, author: 'owner' });
  };
  return { issues, asked };
}

/** Readings answering `closed` closed off the listing, `branches` taken by a branch, and nothing else taken. */
function readingsOver(rows: readonly BoardIssue[], branches: ReadonlyMap<number, string> = new Map()): RoadmapReadings {
  return {
    isClosed: (issue) => Promise.resolve(rows.find((each) => each.number === issue)?.state === 'CLOSED'),
    branchFor: (issue) => branches.get(issue) ?? null,
    pullRequestFor: () => Promise.resolve(null),
  };
}

/** Roadmap lines for `issues`, in order. */
function linesFor(...issues: readonly number[]): readonly RoadmapLine[] {
  return issues.map((issue, index) => ({ issue, ticked: false, why: '', lineNumber: index + 1 }));
}

/** The `native` blocking reading over `rows`, the reader failing any read. */
function nativeBlocking(rows: readonly BoardIssue[]): HopSeams['blocking'] {
  const { issues } = readerOver([]);
  return blockedLineReadings(issues, { relations: NATIVE, listing: () => Promise.resolve(rows) }).blocking;
}

/** The hop seams over `rows` in `native` mode, board #1 the default and the walked board. */
function nativeSeams(rows: readonly BoardIssue[], branches: ReadonlyMap<number, string> = new Map()): HopSeams {
  return {
    blocking: nativeBlocking(rows),
    readings: readingsOver(rows, branches),
    listing: () => Promise.resolve(rows),
    fallback: 1,
    roadmap: 1,
    relations: NATIVE,
  };
}

const HOME = { board: 1, epic: 5 } as const;

/** A turn at home, with no hop record. */
const AT_HOME: FollowedHop = {
  record: null,
  stale: null,
  position: { current: HOME, previous: null, home: HOME },
  problems: [],
};

describe('blockedLineReadings in native mode', () => {
  it('reads #10 waiting on open #20 from its blockedBy node, asking the issue reader nothing', async () => {
    const rows = listingWith();
    const { issues, asked } = readerOver(rows);
    const { blocking } = blockedLineReadings(issues, { relations: NATIVE, listing: () => Promise.resolve(rows) });

    const blocked = await blocking(10);

    expect(blocked).toEqual({ issue: 10, blockers: [20], open: [20], unread: [], fault: null });
    expect(asked).toEqual([]);
  });

  it('reads #10 as waiting on nothing without the port, the labels control', async () => {
    const rows = listingWith();
    const { issues, asked } = readerOver(rows);

    expect(await blockedLineReadings(issues).blocking(10)).toBeNull();
    expect(asked).toEqual([10]);
  });

  it('clears a line whose one blocker closed as NOT_PLANNED', async () => {
    expect(await nativeBlocking(listingWith())(12)).toBeNull();
  });

  it('holds a line on an open blocker in another repository, named from its node', async () => {
    const blocked = await nativeBlocking(listingWith())(15);

    expect(blocked?.foreignOpen).toEqual([{ number: 7, repository: 'other/lib' }]);
    expect(blocked?.blockers).toEqual([]);
  });

  it('reads the ready label off the issue reader in either mode', async () => {
    const rows = listingWith(row(11, { labels: ['epic:home', 'spec:ready'], parent: 5 }));
    const { issues } = readerOver(rows);
    const { isReady } = blockedLineReadings(issues, { relations: NATIVE, listing: () => Promise.resolve(rows) });

    expect([await isReady(11), await isReady(10)]).toEqual([true, false]);
  });
});

describe('nativePick', () => {
  it('passes #10, blocked by open #20, and picks #11, counting it passed', async () => {
    const rows = listingWith();

    const pick = await nativePick(nativeBlocking(rows))(linesFor(10, 11), readingsOver(rows), null);

    expect(pick.line?.issue).toBe(11);
    expect(pick.passed).toBe(1);
    expect(pick.waiting).toEqual([]);
  });

  it('stops at #10 in the labels pick over the same lines, the control', async () => {
    const pick = await plainPick(linesFor(10, 11), readingsOver(listingWith()), null);

    expect(pick.line?.issue).toBe(10);
  });

  it('picks #10 once #20 has closed', async () => {
    const rows = withTwentyClosed();

    const pick = await nativePick(nativeBlocking(rows))(linesFor(10, 11), readingsOver(rows), null);

    expect(pick.line?.issue).toBe(10);
    expect(pick.passed).toBe(0);
  });

  it('passes an issue the listing does not hold, whose links were not read', async () => {
    const rows = listingWith();

    const pick = await nativePick(nativeBlocking(rows))(linesFor(99, 11), readingsOver(rows), null);

    expect(pick.line?.issue).toBe(11);
    expect(pick.passed).toBe(1);
  });

  it('answers no line when every line is blocked, each passed', async () => {
    const rows = listingWith();

    const pick = await nativePick(nativeBlocking(rows))(linesFor(10, 14, 15), readingsOver(rows), null);

    expect(pick.line).toBeNull();
    expect(pick.passed).toBe(3);
  });
});

describe('walkEpic in native mode', () => {
  it('walks epic #5 in sub-issue order, #11 before #10', async () => {
    const rows = listingWith();

    const walk = await walkEpic(5, () => Promise.resolve(rows), readingsOver(rows), plainPick, NATIVE);

    expect(walk.line?.issue).toBe(11);
    expect(walk.epic).toBe(5);
  });

  it('walks epic #5 in checklist order without the port, the control', async () => {
    const rows = listingWith();

    const walk = await walkEpic(5, () => Promise.resolve(rows), readingsOver(rows), plainPick);

    expect(walk.line?.issue).toBe(10);
  });

  it('passes epic #7\'s blocked #17 and picks #18', async () => {
    const rows = listingWith();

    const walk = await walkEpic(7, () => Promise.resolve(rows), readingsOver(rows), nativePick(nativeBlocking(rows)), NATIVE);

    expect(walk.line?.issue).toBe(18);
    expect(walk.passed).toBe(1);
    expect(walk.dry).toBeNull();
  });

  it('runs dry once every line is passed, naming the epic', async () => {
    const rows = listingWith(row(18, { labels: ['epic:side'], parent: 7, blockedBy: [link(40)] }));

    const walk = await walkEpic(7, () => Promise.resolve(rows), readingsOver(rows), nativePick(nativeBlocking(rows)), NATIVE);

    expect(walk.line).toBeNull();
    expect(walk.dry).toEqual({ number: 7, title: 'Issue 7' });
  });
});

describe('nativeHopPick', () => {
  it('stops at #10, whose blocker #20 is a sub-issue of epic #6: the hop rows take it', async () => {
    const rows = listingWith();

    const pick = await nativeHopPick(AT_HOME, nativeSeams(rows))(linesFor(10, 11), readingsOver(rows), 5);

    expect(pick.line?.issue).toBe(10);
    expect(pick.passed).toBe(0);
  });

  it('stops at #19, whose blocker #22 is blocked in turn: a halt the hop rows take', async () => {
    const rows = listingWith();

    const pick = await nativeHopPick(AT_HOME, nativeSeams(rows))(linesFor(19, 11), readingsOver(rows), 5);

    expect(pick.line?.issue).toBe(19);
  });

  it('passes #14, whose blocker #40 is in no epic, and picks #11', async () => {
    const rows = listingWith();

    const pick = await nativeHopPick(AT_HOME, nativeSeams(rows))(linesFor(14, 11), readingsOver(rows), 5);

    expect(pick.line?.issue).toBe(11);
    expect(pick.passed).toBe(1);
    expect(pick.waiting).toEqual([]);
  });

  it('stops at #14 in the labels waiting pick over the same blocking, the control', async () => {
    const rows = listingWith();

    const pick = await waitingPick(nativeBlocking(rows))(linesFor(14, 11), readingsOver(rows), 5);

    expect(pick.line?.issue).toBe(14);
  });

  it('passes #16 as waiting while a branch has taken its blocker #20', async () => {
    const rows = listingWith();
    const branches = new Map([[20, 'rafa-20-far']]);

    const pick = await nativeHopPick(AT_HOME, nativeSeams(rows, branches))(linesFor(16, 11), readingsOver(rows, branches), 5);

    expect(pick.line?.issue).toBe(11);
    expect(pick.waiting.map((waiting) => waiting.line.issue)).toEqual([16]);
    expect(pick.waiting[0]?.blockers).toEqual([{ issue: 20, taken: { by: 'branch', branch: 'rafa-20-far' } }]);
  });

  it('never names a line also held by a foreign blocker as waiting, though it passes it', async () => {
    const rows = listingWith();
    const branches = new Map([[20, 'rafa-20-far']]);

    const pick = await nativeHopPick(AT_HOME, nativeSeams(rows, branches))(linesFor(23, 11), readingsOver(rows, branches), 5);

    expect(pick.line?.issue).toBe(11);
    expect(pick.passed).toBe(1);
    expect(pick.waiting).toEqual([]);
  });

  it('passes #10 while a dry hop is away, whose hop the hop rows do not take', async () => {
    const rows = listingWith();
    const far = { board: 1, epic: 6 } as const;
    const position: Position = { current: HOME, previous: far, home: far };
    const away: FollowedHop = {
      record: {
        kind: 'dry',
        home: far,
        from: far,
        blocked: null,
        target: null,
        targetEpic: 5,
        targetBoard: 1,
        state: 'away',
        pullRequest: null,
        startedAt: '2026-09-30T00:00:00.000Z',
      },
      stale: null,
      position,
      problems: [],
    };
    const noRecord: FollowedHop = { ...away, record: null };

    const passing = await nativeHopPick(away, nativeSeams(rows))(linesFor(10, 11), readingsOver(rows), 5);
    const stopping = await nativeHopPick(noRecord, nativeSeams(rows))(linesFor(10, 11), readingsOver(rows), 5);

    expect([passing.line?.issue, stopping.line?.issue]).toEqual([11, 10]);
  });
});

describe('pickerFor', () => {
  const labelsSeams: HopSeams = { ...nativeSeams(listingWith()), relations: undefined };

  it('answers the labels pickers without the port, as before it', async () => {
    const rows = listingWith();
    const labelsWaiting = await pickerFor(AT_HOME, labelsSeams)(linesFor(14, 11), readingsOver(rows), 5);

    expect(pickerFor(null, labelsSeams)).toBe(plainPick);
    expect(labelsWaiting.line?.issue).toBe(14);
  });

  it('answers the native pickers in native mode', async () => {
    const rows = listingWith();
    const seams = nativeSeams(rows);

    const plain = await pickerFor(null, seams)(linesFor(10, 11), readingsOver(rows), null);
    const hop = await pickerFor(AT_HOME, seams)(linesFor(14, 11), readingsOver(rows), 5);

    expect([plain.line?.issue, hop.line?.issue]).toEqual([11, 11]);
  });
});

describe('readHopAnswer in native mode', () => {
  /** A walk that answered `line` in epic #5, or ran dry there. */
  function walkAt(line: number | null): WalkAnswer {
    return {
      line: line === null
        ? null
        : { issue: line, ticked: false, why: '', lineNumber: 1 },
      passed: 0,
      dry: line === null
        ? { number: 5, title: 'Issue 5' }
        : null,
      epic: 5,
      waiting: [],
    };
  }

  it('decides the hop from #10 to epic #6, read off #20\'s parent', async () => {
    const answer = await readHopAnswer(walkAt(10), AT_HOME, nativeSeams(listingWith()));

    expect(answer.problems).toEqual([]);
    expect(answer.decision).toMatchObject({ kind: 'hop', blocked: 10, blocker: 20, epic: 6, slug: null, board: 1 });
  });

  it('decides nothing for #10 without the port, which reads no spec:blocked on it, the control', async () => {
    const answer = await readHopAnswer(walkAt(10), AT_HOME, { ...nativeSeams(listingWith()), blocking: () => Promise.resolve(null), relations: undefined });

    expect(answer.decision).toBeNull();
  });

  it('reads epic #6 as the next now epic after a dry #5 through the port', async () => {
    const rows = listingWith(row(6, { labels: ['type:epic', 'horizon:now'], subIssues: [20, 21] }));

    const native = await readHopAnswer(walkAt(null), AT_HOME, nativeSeams(rows));
    const labels = await readHopAnswer(walkAt(null), AT_HOME, { ...nativeSeams(rows), relations: undefined });

    expect(native.nextEpic?.number).toBe(6);
    expect(labels.nextEpic?.number).not.toBe(6);
  });
});
