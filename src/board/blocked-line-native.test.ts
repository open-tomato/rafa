/**
 * Tests for the blocked roadmap line (`src/board/blocked-line.ts`) in
 * `native` mode: `blockingOf` and `pickPlannableLine` handed the board's
 * relationships port, reading what a line waits on from its listing
 * row's `blockedBy` nodes. The `labels` cases stay in
 * `./blocked-line.test.ts`.
 *
 * Every case plants one literal native board and reads it through the
 * real `native` adapter made over a `gh` that fails any call. Nothing
 * spawns, and the walk's issue reader fails any number a case did not
 * plant, so a per-blocker read would be seen.
 *
 * ## The controls
 *
 *  - Every row also carries `spec:blocked` and a `Blocked by:` line
 *    naming an OPEN issue other than its native blocker, and the same
 *    board read in `labels` mode must name that one. A native reading
 *    that fell back to the label or the line names the wrong blocker.
 *  - The `NOT_PLANNED` blocker is paired with the same blocker OPEN,
 *    which holds the line.
 *  - The foreign blocker is numbered as a local issue the listing holds
 *    CLOSED, so a reading that dropped the repository clears the line;
 *    it is paired with the same foreign blocker CLOSED, which clears it.
 *  - The native-only keys are asserted absent, by `Object.keys`, on the
 *    same line read in `labels` mode, since `toEqual` ignores keys set to
 *    undefined.
 */
import type { SpecIssue } from './issue.js';
import type { RelationsReading } from './relations/port.js';
import type { BoardIssue, BoardIssueLink } from './roadmap-board.js';
import type { RoadmapLine } from './roadmap.js';
import type { GhRunner } from '../adapters/tracker/github.js';

import { describe, expect, it } from 'bun:test';

import { typeOfLabels } from '../adapters/tracker/github.js';

import {
  blockedLineOf,
  blockedLineSentence,
  blockingOf,
  notOnListingMessage,
  pickPlannableLine,
  plannableReadings,
} from './blocked-line.js';
import { SPEC_BLOCKED_LABEL } from './blocked.js';
import { SPEC_LABEL } from './issue.js';
import { SPEC_READY_LABEL } from './readiness.js';
import { createLabelsRelations } from './relations/labels.js';
import { createNativeRelations } from './relations/native.js';
import { createRoadmapReadings, parseRoadmapBody } from './roadmap.js';

/** The board's own repository. */
const BOARD = 'acme/board';

/** The repository a foreign blocker lives on. */
const OTHER = 'other/lib';

/** A `gh` every call to which fails the case: reads never spawn. */
const NO_GH: GhRunner = (args) => {
  throw new Error(`a read sent gh ${args.join(' ')}`);
};

/** The `native` adapter on {@link BOARD}. */
const NATIVE = createNativeRelations({ gh: NO_GH, repository: BOARD });

/** The `labels` adapter, for the controls. */
const LABELS = createLabelsRelations({ gh: NO_GH });

/** A `blockedBy` node: issue `number` on `repository`, in `state`. */
function node(number: number, state: 'OPEN' | 'CLOSED', repository = BOARD): BoardIssueLink {
  return { number, title: `issue ${String(number)}`, state, repository };
}

/** The fields a case may set on a native row. */
interface RowFields {
  readonly labels?: readonly string[];
  readonly state?: 'OPEN' | 'CLOSED';
  readonly stateReason?: string | null;
  readonly body?: string;
  readonly blockedBy?: readonly BoardIssueLink[];
  /** GitHub's `totalCount`, when above the nodes. */
  readonly total?: number;
}

/** A native row carrying all five native fields, its type read from its labels. */
function row(number: number, fields: RowFields = {}): BoardIssue {
  const labels = fields.labels ?? [SPEC_LABEL, SPEC_READY_LABEL];
  const nodes = fields.blockedBy ?? [];
  return {
    number,
    title: `issue ${String(number)}`,
    body: fields.body ?? `## What you get\n\nIssue ${String(number)}.\n`,
    state: fields.state ?? 'OPEN',
    stateReason: fields.stateReason ?? null,
    labels,
    type: typeOfLabels(labels),
    module: 'unassigned',
    parent: null,
    blockedBy: fields.total === undefined
      ? { nodes }
      : { nodes, truncated: { total: fields.total } },
    blocking: { nodes: [] },
    subIssuesSummary: { total: 0, completed: 0, percentCompleted: 0 },
    subIssues: { nodes: [] },
  };
}

/**
 * A row labelled `spec:blocked` whose body's line names the OPEN #30,
 * the control every case carries, waiting natively on `blockedBy`.
 */
function waiting(number: number, blockedBy: readonly BoardIssueLink[], fields: RowFields = {}): BoardIssue {
  return row(number, {
    labels: [SPEC_LABEL, SPEC_READY_LABEL, SPEC_BLOCKED_LABEL],
    body: `## What you get\n\nIssue ${String(number)}.\n\nBlocked by: #30\n`,
    blockedBy,
    ...fields,
  });
}

/** The board around `rows`: the OPEN #30 the labels name, #24 OPEN, #7 CLOSED, and #25 closed as not planned. */
function boardOf(...rows: readonly BoardIssue[]): readonly BoardIssue[] {
  return [
    row(30),
    row(24),
    row(7, { state: 'CLOSED', stateReason: 'COMPLETED' }),
    row(25, { state: 'CLOSED', stateReason: 'NOT_PLANNED' }),
    ...rows,
  ];
}

/** `row` as the walk's issue reader answers it. */
function specIssueOf(board: BoardIssue): SpecIssue {
  return {
    number: board.number,
    title: board.title,
    body: board.body,
    state: board.state,
    labels: board.labels,
    author: 'maintainer',
  };
}

/** A reader over `board`, recording every number asked; one nobody planted is a failed read. */
function plantedIssues(board: readonly BoardIssue[]): {
  readonly issues: (issue: number) => Promise<SpecIssue>;
  readonly asked: () => readonly number[];
} {
  let asked: readonly number[] = [];
  return {
    issues: (issue: number) => {
      asked = [...asked, issue];
      const found = board.find((planted) => planted.number === issue);
      return found === undefined
        ? Promise.reject(new Error(`no issue ${String(issue)} was planted`))
        : Promise.resolve(specIssueOf(found));
    },
    asked: () => asked,
  };
}

/** A listing over `board`, counting its reads. */
function countedListing(board: readonly BoardIssue[]): {
  readonly listing: () => Promise<readonly BoardIssue[]>;
  readonly reads: () => number;
} {
  let reads = 0;
  return {
    listing: () => {
      reads += 1;
      return Promise.resolve(board);
    },
    reads: () => reads,
  };
}

/** Whether `issue` is blocked on `board`, read in the mode `relations` answers. */
async function blockingOn(
  board: readonly BoardIssue[],
  issue: number,
  relations: Pick<typeof NATIVE, 'mode' | 'read'> = NATIVE,
): ReturnType<ReturnType<typeof blockingOf>> {
  const { issues } = plantedIssues(board);
  return blockingOf({ issues, waiting: { relations, listing: () => Promise.resolve(board) } })(issue);
}

describe('what makes a line blocked in native mode', () => {
  it('reads an open blockedBy node as blocked, never the label or the Blocked by: line', async () => {
    const board = boardOf(waiting(57, [node(24, 'OPEN')]));

    const native = await blockingOn(board, 57);
    const labels = await blockingOn(board, 57, LABELS);

    expect(native?.open).toEqual([24]);
    expect(blockedLineSentence(native!)).toBe('#57 is blocked by #24 (open)');
    expect(labels?.open).toEqual([30]);
  });

  it('reads an issue with no blockedBy node as not blocked, though its label and line say it waits', async () => {
    const board = boardOf(waiting(57, []));

    expect(await blockingOn(board, 57)).toBeNull();
    expect(await blockingOn(board, 57, LABELS)).not.toBeNull();
  });

  it('clears a line whose blocker closed as NOT_PLANNED, where the same blocker open holds it', async () => {
    const cleared = boardOf(waiting(57, [node(25, 'CLOSED')]));
    const held = boardOf(waiting(57, [node(25, 'OPEN')]));

    expect(await blockingOn(cleared, 57)).toBeNull();
    expect((await blockingOn(held, 57))?.open).toEqual([25]);
  });

  it('holds a line on an open foreign blocker, named with its repository and never as the local issue of its number', async () => {
    const board = boardOf(waiting(57, [node(7, 'OPEN', OTHER)]));

    const read = await blockingOn(board, 57);

    expect(read).toEqual({
      issue: 57,
      blockers: [],
      open: [],
      unread: [],
      fault: null,
      foreignOpen: [{ number: 7, repository: OTHER }],
    });
    expect(blockedLineSentence(read!)).toBe('#57 is blocked by other/lib#7 (open)');
  });

  it('clears a line whose foreign blocker is closed', async () => {
    const board = boardOf(waiting(57, [node(7, 'CLOSED', OTHER)]));

    expect(await blockingOn(board, 57)).toBeNull();
  });

  it('names local open blockers, then foreign ones, in the order gh answered them, passing closed ones', async () => {
    const board = boardOf(waiting(57, [
      node(8, 'OPEN', OTHER),
      node(24, 'OPEN'),
      node(25, 'CLOSED'),
      node(9, 'CLOSED', OTHER),
      node(30, 'OPEN'),
    ]));

    const read = await blockingOn(board, 57);

    expect(read?.blockers).toEqual([24, 25, 30]);
    expect(read?.open).toEqual([24, 30]);
    expect(read?.foreignOpen).toEqual([{ number: 8, repository: OTHER }]);
    expect(blockedLineSentence(read!)).toBe('#57 is blocked by #24 (open), #30 (open), other/lib#8 (open)');
  });

  it('holds a line whose blockedBy list gh stopped short of, though every node read is closed', async () => {
    const board = boardOf(waiting(57, [node(25, 'CLOSED')], { total: 60 }));

    const read = await blockingOn(board, 57);

    expect(read?.truncated).toEqual({ total: 60 });
    expect(Object.keys(read!)).not.toContain('foreignOpen');
    expect(blockedLineSentence(read!)).toBe('#57 is blocked by the rest of its 60 blockers (state not read)');
  });

  it('reports an issue the listing does not hold as a fault, rather than as waiting on nothing', async () => {
    const read = await blockingOn(boardOf(), 57);

    expect(read?.fault).toBe(notOnListingMessage(57));
    expect(blockedLineSentence(read!)).toBe(notOnListingMessage(57));
  });
});

describe('what the native reading reads', () => {
  it('reads the listing once and the port once over it, and asks no issue one at a time', async () => {
    const board = boardOf(waiting(57, [node(24, 'OPEN')]), waiting(58, [node(25, 'CLOSED')]));
    const { issues, asked } = plantedIssues(board);
    const { listing, reads } = countedListing(board);
    let ported = 0;
    const relations = {
      mode: NATIVE.mode,
      read: (rows: readonly BoardIssue[]): RelationsReading => {
        ported += 1;
        return NATIVE.read(rows);
      },
    };
    const blocking = blockingOf({ issues, waiting: { relations, listing } });

    await blocking(57);
    await blocking(58);

    expect(asked()).toEqual([]);
    expect(reads()).toBe(2);
    expect(ported).toBe(1);
  });

  it('never asks the listing in labels mode, answering the key set a labels reading always had', async () => {
    const board = boardOf(waiting(57, [node(8, 'OPEN', OTHER)], { total: 60 }));
    const { issues, asked } = plantedIssues(board);
    const listing = (): Promise<readonly BoardIssue[]> => Promise.reject(new Error('the listing was read in labels mode'));

    const read = await blockingOf({ issues, waiting: { relations: LABELS, listing } })(57);

    expect(Object.keys(read!)).toEqual(['issue', 'blockers', 'open', 'unread', 'fault']);
    expect(asked()).toEqual([57, 30]);
  });

  it('turns a native port reading into the same line as the adapter answers it, whatever the mode', () => {
    const board = boardOf(waiting(57, [node(24, 'OPEN')]));
    const reading = NATIVE.read(board);
    const issue = board.find((candidate) => candidate.number === 57)!;

    expect(blockedLineOf(reading.blockersOf(issue))?.open).toEqual([24]);
    expect(blockedLineOf(LABELS.read(board).blockersOf(issue))?.open).toEqual([30]);
  });
});

/** A roadmap body naming #57, #58 and #59. */
function roadmapLines(): readonly RoadmapLine[] {
  return parseRoadmapBody(['- [ ] #57 the state reader', '- [ ] #58 the ending hint', '- [ ] #59 the close-out'].join('\n'));
}

/** The three readings over `board`, as the walk takes them, in the mode `relations` answers. */
function walkReadings(
  board: readonly BoardIssue[],
  relations: Pick<typeof NATIVE, 'mode' | 'read'> = NATIVE,
): ReturnType<typeof plannableReadings> {
  const { issues } = plantedIssues(board);
  return plannableReadings({
    issues,
    readings: createRoadmapReadings({ issues, branches: { refs: [], problems: [] }, pullRequests: () => Promise.resolve([]) }),
    waiting: { relations, listing: () => Promise.resolve(board) },
  });
}

describe('the line offered in place of a blocked one, in native mode', () => {
  it('passes a line held by a foreign blocker and offers the one whose blocker closed as NOT_PLANNED', async () => {
    const board = boardOf(
      waiting(57, [node(24, 'OPEN')]),
      waiting(58, [node(7, 'OPEN', OTHER)]),
      waiting(59, [node(25, 'CLOSED')]),
    );
    const [first] = roadmapLines();

    const pick = await pickPlannableLine(roadmapLines(), first!, walkReadings(board));
    const labels = await pickPlannableLine(roadmapLines(), first!, walkReadings(board, LABELS));

    expect(pick.line?.issue).toBe(59);
    expect(pick.passed.map((passed) => passed.sentence)).toEqual(['#58 is blocked by other/lib#7 (open)']);
    expect(labels.line).toBeNull();
    expect(labels.passed.map((passed) => passed.sentence)).toEqual([
      '#58 is blocked by #30 (open)',
      '#59 is blocked by #30 (open)',
    ]);
  });
});
