/**
 * Tests for the epic reader (`src/board/epics.ts`) in `native` mode:
 * `readEpics` handed the board's relationships port, reading membership
 * from `parent`, order from `subIssues`, and the epics a member waits on
 * from `blockedBy` nodes. The `labels` cases stay in `./epics.test.ts`.
 *
 * Every case is a pure call over a literal native listing, read through
 * the real `native` adapter made over a `gh` that fails any call, so a
 * read that spawned would fail the case.
 *
 * ## The controls
 *
 *  - Every native board also carries `epic:` labels, `spec:blocked` and
 *    `Blocked by:` lines naming a different grouping, and the same board
 *    read in `labels` mode must answer that grouping, so a native reading
 *    that fell back to the labels fails.
 *  - Sub-issue order is chosen to differ from ascending number.
 *  - An epic waiting on an open blocker is read beside the same blocker
 *    closed on its node, and beside a foreign blocker of the same number.
 *  - `labels` mode is read with a port whose `read` throws, so a
 *    `labels` reading that called the port back fails.
 */
import type { EpicRelations } from './epics.js';
import type { BoardIssue, BoardIssueLink } from './roadmap-board.js';
import type { GhRunner } from '../adapters/tracker/github.js';

import { describe, expect, it } from 'bun:test';

import { typeOfLabels } from '../adapters/tracker/github.js';

import { readEpics } from './epics.js';
import { createNativeRelations } from './relations/native.js';

/** The board's own repository. */
const BOARD = 'acme/board';

/** A `gh` every call to which fails the case: reads never spawn. */
const NO_GH: GhRunner = (args) => {
  throw new Error(`a read sent gh ${args.join(' ')}`);
};

/** The `native` adapter on {@link BOARD}. */
const NATIVE = createNativeRelations({ gh: NO_GH, repository: BOARD });

/** A `labels` port whose read fails the case if it is ever called. */
const LABELS_UNCALLED: EpicRelations = {
  mode: 'labels',
  read: () => {
    throw new Error('labels mode called the port back');
  },
};

/** A day no epic below is late on. */
const TODAY = new Date(2026, 0, 1);

/** Issue `number` as a link node names it, on {@link BOARD} unless told otherwise. */
function link(number: number, state: 'OPEN' | 'CLOSED' = 'OPEN', repository = BOARD): BoardIssueLink {
  return { number, title: `issue ${String(number)}`, state, repository };
}

/** The fields a case may set on a native row. */
interface RowFields {
  readonly labels?: readonly string[];
  readonly state?: 'OPEN' | 'CLOSED';
  readonly stateReason?: string | null;
  readonly body?: string;
  readonly parent?: number | null;
  readonly blockedBy?: readonly BoardIssueLink[];
  readonly subIssues?: readonly number[];
}

/** A native row carrying all five native fields, its type read from its labels. */
function row(number: number, fields: RowFields = {}): BoardIssue {
  const labels = fields.labels ?? [];
  const subIssues = fields.subIssues ?? [];
  return {
    number,
    title: `issue ${String(number)}`,
    body: fields.body ?? '',
    state: fields.state ?? 'OPEN',
    stateReason: fields.stateReason ?? null,
    labels,
    type: typeOfLabels(labels),
    module: 'unassigned',
    parent: fields.parent === undefined || fields.parent === null
      ? null
      : link(fields.parent),
    blockedBy: { nodes: fields.blockedBy ?? [] },
    blocking: { nodes: [] },
    subIssuesSummary: { total: subIssues.length, completed: 0, percentCompleted: 0 },
    subIssues: { nodes: subIssues.map((child) => link(child)) },
  };
}

/** An epic row: `type:epic` and `epic:<slug>`, its sub-issues in `order`. */
function epic(number: number, slug: string, order: readonly number[], fields: RowFields = {}): BoardIssue {
  return row(number, { labels: ['type:epic', `epic:${slug}`, 'horizon:now'], subIssues: order, ...fields });
}

/** A `type:spec` row, carrying `epic:<slug>` when `slug` is given. */
function spec(number: number, slug: string | null, fields: RowFields = {}): BoardIssue {
  const labels = slug === null
    ? ['type:spec']
    : ['type:spec', `epic:${slug}`];
  return row(number, { labels: [...labels, ...fields.labels ?? []], ...fields });
}

/** Every epic on `issues`, read in `native` mode. */
function readNative(issues: readonly BoardIssue[]): ReturnType<typeof readEpics>['epics'] {
  return readEpics({ issues, claims: new Set(), today: TODAY, relations: NATIVE }).epics;
}

/** Every epic on `issues`, read in `labels` mode with no port. */
function readLabels(issues: readonly BoardIssue[]): ReturnType<typeof readEpics>['epics'] {
  return readEpics({ issues, claims: new Set(), today: TODAY }).epics;
}

/** The epic numbered `number` in `epics`; fails the case when it is missing. */
function epicNumbered(epics: ReturnType<typeof readNative>, number: number): ReturnType<typeof readNative>[number] {
  const found = epics.find((read) => read.number === number);
  if (found === undefined) throw new Error(`epic #${String(number)} was not read`);
  return found;
}

/**
 * Epic #10 `alpha` holds #13, #11, #12 as sub-issues in that order; #14
 * carries `epic:alpha` but no parent, and #12 carries `epic:beta`, the
 * slug of epic #20, which has no sub-issues.
 */
const MEMBERSHIP_BOARD: readonly BoardIssue[] = [
  epic(10, 'alpha', [13, 11, 12]),
  spec(11, null, { parent: 10 }),
  spec(12, 'beta', { parent: 10 }),
  spec(13, null, { parent: 10 }),
  spec(14, 'alpha'),
  epic(20, 'beta', []),
];

describe('readEpics in native mode: membership and order', () => {
  it('reads the members from parent, in sub-issue order, never by number or label', () => {
    const alpha = epicNumbered(readNative(MEMBERSHIP_BOARD), 10);

    expect(alpha.members.map((member) => member.number)).toEqual([13, 11, 12]);
    expect(alpha.order).toBe('sub-issues');
    expect(alpha.slug).toBeNull();
  });

  it('reads an epic with no sub-issue empty, whatever its epic: label groups', () => {
    const beta = epicNumbered(readNative(MEMBERSHIP_BOARD), 20);

    expect(beta.members).toEqual([]);
    expect(beta.state).toBe('empty');
  });

  it('control: the same board in labels mode groups by the labels, ascending, with no order key', () => {
    const epics = readLabels(MEMBERSHIP_BOARD);
    const alpha = epicNumbered(epics, 10);

    expect(alpha.members.map((member) => member.number)).toEqual([14]);
    expect(epicNumbered(epics, 20).members.map((member) => member.number)).toEqual([12]);
    expect(alpha.slug).toBe('alpha');
    expect(Object.keys(alpha)).not.toContain('order');
  });

  it('labels mode through the port reads what no port reads, and never calls it back', () => {
    const through = readEpics({ issues: MEMBERSHIP_BOARD, claims: new Set(), today: TODAY, relations: LABELS_UNCALLED });

    expect(through.epics).toEqual(readLabels(MEMBERSHIP_BOARD));
    expect(through.epics.flatMap((read) => Object.keys(read))).not.toContain('order');
  });

  it('counts done/total over the sub-issues, a not-planned one on neither side', () => {
    const board = [
      epic(10, 'alpha', [11, 12, 13]),
      spec(11, null, { parent: 10, state: 'CLOSED', stateReason: 'COMPLETED' }),
      spec(12, null, { parent: 10, state: 'CLOSED', stateReason: 'NOT_PLANNED' }),
      spec(13, null, { parent: 10 }),
    ];

    const alpha = epicNumbered(readNative(board), 10);

    expect(alpha.progress).toEqual({ done: 1, total: 2, notPlanned: 1 });
    expect(alpha.state).toBe('in-progress');
  });

  it('reads an epic whose every sub-issue closed as done, and its stored state against it', () => {
    const board = [
      epic(10, 'alpha', [11]),
      spec(11, null, { parent: 10, state: 'CLOSED', stateReason: 'COMPLETED' }),
    ];

    const alpha = epicNumbered(readNative(board), 10);

    expect(alpha.state).toBe('done');
    expect(alpha.disagreement).toBe('done, but epic #10 is still open');
  });

  it('refuses a listing read without the native fields, naming board.relationships', () => {
    const bare: BoardIssue = {
      number: 11,
      title: 'issue 11',
      body: '',
      state: 'OPEN',
      stateReason: null,
      labels: ['type:spec'],
      type: 'spec',
      module: 'unassigned',
    };

    expect(() => readNative([epic(10, 'alpha', []), bare])).toThrow(/board\.relationships/u);
  });

  it('answers a failed listing unknown without reading the port', () => {
    const read = readEpics({ issues: null, reason: 'gh failed', claims: new Set(), today: TODAY, relations: NATIVE });

    expect(read).toEqual({ epics: [], unknown: 'gh failed' });
  });
});

describe('readEpics in native mode: the epics a member waits on', () => {
  /** Epic #10 whose open #11 is blocked by `blocker`; epic #20 holds #21, and #30 is an epic of its own. */
  function board(blocker: BoardIssueLink): readonly BoardIssue[] {
    return [
      epic(10, 'alpha', [11]),
      spec(11, null, {
        parent: 10,
        blockedBy: [blocker],
        labels: ['spec:blocked'],
        body: 'Blocked by: #40',
      }),
      epic(20, 'beta', [21]),
      spec(21, null, { parent: 20 }),
      epic(30, 'gamma', []),
      epic(40, 'delta', []),
    ];
  }

  it('names the epic an open blocker is a sub-issue of', () => {
    expect(epicNumbered(readNative(board(link(21))), 10).blockedBy).toEqual([20]);
  });

  it('names a blocker that is an epic itself', () => {
    expect(epicNumbered(readNative(board(link(30))), 10).blockedBy).toEqual([30]);
  });

  it('control: the same blocker closed on its node names no epic', () => {
    expect(epicNumbered(readNative(board(link(21, 'CLOSED'))), 10).blockedBy).toEqual([]);
  });

  it('control: a foreign blocker numbered as #21 names no epic on this board', () => {
    expect(epicNumbered(readNative(board(link(21, 'OPEN', 'other/repo'))), 10).blockedBy).toEqual([]);
  });

  it('control: the member\'s Blocked by: line names epic #40 in labels mode only', () => {
    const labelsBoard = board(link(21)).map((read) => read.number === 11
      ? { ...read, labels: ['type:spec', 'epic:alpha', 'spec:blocked'] }
      : read);

    expect(epicNumbered(readLabels(labelsBoard), 10).blockedBy).toEqual([40]);
    expect(epicNumbered(readNative(labelsBoard), 10).blockedBy).toEqual([20]);
  });

  it('names no epic for a blocker the listing does not hold', () => {
    expect(epicNumbered(readNative(board(link(99))), 10).blockedBy).toEqual([]);
  });

  it('leaves an epic\'s own sub-issue out of what it waits on', () => {
    const own = [
      epic(10, 'alpha', [11, 12]),
      spec(11, null, { parent: 10, blockedBy: [link(12)] }),
      spec(12, null, { parent: 10 }),
    ];

    expect(epicNumbered(readNative(own), 10).blockedBy).toEqual([]);
  });

  it('reads no blocker of a closed member', () => {
    const closed = board(link(21)).map((read) => read.number === 11
      ? { ...read, state: 'CLOSED' as const, stateReason: 'COMPLETED' }
      : read);

    expect(epicNumbered(readNative(closed), 10).blockedBy).toEqual([]);
  });
});
