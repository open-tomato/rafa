/**
 * Tests for the roadmap rows (`src/board/roadmap-rows.ts`) in `native`
 * mode: the `blocked by` column read through the relationships port's
 * `blockersOf` over the one listing, each blocker's state off its
 * `blockedBy` node, and a node list `gh` cut short carried as a warning.
 * The `labels` cases stay in `./roadmap-rows.test.ts`.
 *
 * Every read is planted, as there: the board a fixed native listing, git
 * a runner answering no refs, the pull requests and plan names empty and
 * the saved copies an empty map. The port is the real `native` adapter
 * made over a `gh` that fails any call, so a read that spawned per
 * blocker would fail the case.
 *
 * ## The controls
 *
 *  - Every blocked row also carries `spec:blocked` and a `Blocked by:`
 *    line naming other issues, and the same board read in `labels` mode
 *    must print that line's issues, so a native reading that fell back to
 *    the line fails.
 *  - `labels` mode is read with a port whose `read` throws, so a `labels`
 *    reading that asked the port fails, and its rows must equal the rows
 *    read with no port at all.
 */
import type { EpicRelations } from './epics.js';
import type { BoardIssue, BoardIssueLink, BoardIssueLinks, BoardListing } from './roadmap-board.js';
import type { LineRowsOptions, RefsCell } from './roadmap-rows.js';
import type { RoadmapLine } from './roadmap.js';
import type { GhRunner } from '../adapters/tracker/github.js';

import { describe, expect, it } from 'bun:test';

import { completeSpecBody } from '../tests/spec-bodies.js';

import { SPEC_READY_LABEL } from './readiness.js';
import { createNativeRelations } from './relations/native.js';
import {
  blockersText,
  readLineRows,
  readNativeBlockersColumn,
  truncatedBlockersWarning,
  UNKNOWN_STATE,
} from './roadmap-rows.js';

/** The board's own repository, and another. */
const BOARD = 'acme/board';
const OTHER = 'acme/other';

/** A `gh` every call to which fails the case: reads never spawn. */
const NO_GH: GhRunner = (args) => {
  throw new Error(`a read sent gh ${args.join(' ')}`);
};

const NATIVE = createNativeRelations({ gh: NO_GH, repository: BOARD });

/** A `labels` port whose read fails the case if it is ever called. */
const LABELS_UNCALLED: EpicRelations = {
  mode: 'labels',
  read: () => {
    throw new Error('labels mode asked the port');
  },
};

/** Issue `number` as a link node names it. */
function link(number: number, state: 'OPEN' | 'CLOSED', repository = BOARD): BoardIssueLink {
  return { number, title: `issue ${String(number)}`, state, repository };
}

/** A native row, ready, with every native field, `fields` laid over it. */
function row(number: number, fields: Partial<BoardIssue> = {}): BoardIssue {
  return {
    number,
    title: `Issue ${String(number)}`,
    body: completeSpecBody(`Issue ${String(number)}`),
    state: 'OPEN',
    stateReason: null,
    labels: [SPEC_READY_LABEL],
    type: 'code',
    module: 'unassigned',
    parent: null,
    blockedBy: { nodes: [] },
    blocking: { nodes: [] },
    subIssuesSummary: { total: 0, completed: 0, percentCompleted: 0 },
    subIssues: { nodes: [] },
    ...fields,
  };
}

/** A row blocked by `blockedBy`, whose body and labels name #90 and #91 in the `labels` way. */
function blockedRow(number: number, blockedBy: BoardIssueLinks): BoardIssue {
  return row(number, {
    labels: [SPEC_READY_LABEL, 'spec:blocked'],
    body: `${completeSpecBody(`Issue ${String(number)}`)}\nBlocked by: #90 #91\n`,
    blockedBy,
  });
}

/**
 * #16 is blocked by open #20, closed #21, #32 closed as not planned, and
 * #3 on another repository, closed, in that node order; #17 by nothing;
 * #18 by 60 issues of which `gh` answered two. #90 is open and #91
 * closed, the issues the `labels` line names.
 */
const LISTING: readonly BoardIssue[] = [
  blockedRow(16, {
    nodes: [link(20, 'OPEN'), link(21, 'CLOSED'), link(32, 'CLOSED'), link(3, 'CLOSED', OTHER)],
  }),
  row(17),
  blockedRow(18, { nodes: [link(20, 'OPEN'), link(21, 'CLOSED')], truncated: { total: 60 } }),
  row(20),
  row(21, { state: 'CLOSED' }),
  row(32, { state: 'CLOSED', stateReason: 'NOT_PLANNED' }),
  row(90),
  row(91, { state: 'CLOSED' }),
];

/** One unticked line per number, in order. */
function lines(numbers: readonly number[]): readonly RoadmapLine[] {
  return numbers.map((issue, index) => ({ issue, ticked: false, why: `line ${String(issue)}`, lineNumber: index + 1 }));
}

/** The options over `listing`, `overrides` laid over them, and how often the listing was asked. */
function planted(
  overrides: Partial<LineRowsOptions> = {},
  listing: readonly BoardIssue[] = LISTING,
): { options: LineRowsOptions; asked: () => number } {
  let asked = 0;
  const board: BoardListing = () => {
    asked += 1;
    return Promise.resolve(listing);
  };
  const options: LineRowsOptions = {
    board,
    git: () => ({ ok: true, stdout: '', stderr: '' }),
    pullRequests: () => Promise.resolve([]),
    planNames: () => [],
    refs: () => Promise.resolve(new Map<number, RefsCell>()),
    ...overrides,
  };
  return { options, asked: () => asked };
}

describe('readLineRows in native mode: the blocked by column', () => {
  it('names every blockedBy node in gh order, each state off its node, a foreign one with its repository', async () => {
    const read = await readLineRows(lines([16]), planted({ relations: NATIVE }).options);
    const [sixteen] = read.rows;

    expect(sixteen?.blockers).toEqual([
      { reference: '#20', state: 'open' },
      { reference: '#21', state: 'closed' },
      { reference: '#32', state: 'closed' },
      { reference: 'acme/other#3', state: 'closed' },
    ]);
    expect(blockersText(sixteen?.blockers ?? [])).toBe('#20 open, #21 closed, #32 closed, acme/other#3 closed');
  });

  it('reads the Blocked by: line on the same board in labels mode (control)', async () => {
    const read = await readLineRows(lines([16]), planted().options);

    expect(read.rows[0]?.blockers).toEqual([
      { reference: '#90', state: 'open' },
      { reference: '#91', state: 'closed' },
    ]);
    expect(read.rows[0]?.blocked?.kind).toBe('blocked');
  });

  it('carries no Blocked by: reading in native mode, and keeps the spec column', async () => {
    const read = await readLineRows(lines([16, 17]), planted({ relations: NATIVE }).options);

    expect(read.rows.map((one) => one.blocked)).toEqual([null, null]);
    expect(read.rows.map((one) => one.spec?.kind)).toEqual(['ready', 'ready']);
    expect(read.rows[1]?.blockers).toEqual([]);
  });

  it('warns once per issue whose blockedBy nodes gh cut short, naming GitHub\'s count', async () => {
    const read = await readLineRows(lines([16, 18, 18]), planted({ relations: NATIVE }).options);

    expect(read.rows[1]?.blockers.map((cell) => cell.reference)).toEqual(['#20', '#21']);
    expect(read.warnings).toEqual([
      '#18 is blocked by 60 issues, more than the board read answered, so its blocked by column names the first 2',
    ]);
  });

  it('warns no truncation in labels mode on the same board (control)', async () => {
    const read = await readLineRows(lines([16, 18]), planted().options);
    expect(read.warnings).toEqual([]);
  });

  it('lists the board once, and sends no gh', async () => {
    const { options, asked } = planted({ relations: NATIVE });
    await readLineRows(lines([16, 17, 18]), options);
    expect(asked()).toBe(1);
  });

  it('empties the column when the listing failed, as in labels mode', async () => {
    const { options } = planted({ relations: NATIVE, board: () => Promise.reject(new Error('gh: HTTP 502')) });
    const read = await readLineRows(lines([16]), options);

    expect(read.rows[0]?.issue).toBeNull();
    expect(read.rows[0]?.blockers).toEqual([]);
    expect(read.warnings).toEqual([
      'the board could not be listed, so the spec and blocked by columns are empty: gh: HTTP 502',
    ]);
  });

  it('refuses a listing read without the native fields, naming board.relationships', async () => {
    const native = new Set(['parent', 'blockedBy', 'blocking', 'subIssuesSummary', 'subIssues']);
    const bare = Object.fromEntries(Object.entries(row(17)).filter(([key]) => !native.has(key))) as unknown as BoardIssue;
    const { options } = planted({ relations: NATIVE }, [bare]);

    let caught: unknown = null;
    try {
      await readLineRows(lines([17]), options);
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(TypeError);
    expect((caught as Error).message).toContain('board.relationships is native');
  });
});

describe('readLineRows in labels mode with a port', () => {
  it('never asks the port, and answers the rows read with no port', async () => {
    const withPort = await readLineRows(lines([16, 17, 18]), planted({ relations: LABELS_UNCALLED }).options);
    const without = await readLineRows(lines([16, 17, 18]), planted().options);

    expect(withPort).toEqual(without);
    expect(withPort.rows.map((one) => Object.keys(one))).toEqual(without.rows.map((one) => Object.keys(one)));
  });
});

describe('readNativeBlockersColumn', () => {
  it('answers no cell for an issue waiting on nothing', () => {
    expect(readNativeBlockersColumn({ kind: 'none', issue: 5 })).toEqual([]);
  });

  it('spells a blocker whose state was not read as unknown', () => {
    const cells = readNativeBlockersColumn({
      kind: 'blocked',
      issue: 5,
      blockers: [{ number: 7, repository: null, state: null }],
    });
    expect(cells).toEqual([{ reference: '#7', state: UNKNOWN_STATE }]);
  });
});

describe('truncatedBlockersWarning', () => {
  it('is null for a reading gh answered whole, and for none', () => {
    expect(truncatedBlockersWarning({ kind: 'none', issue: 5 })).toBeNull();
    expect(truncatedBlockersWarning({
      kind: 'blocked',
      issue: 5,
      blockers: [{ number: 7, repository: null, state: 'OPEN' }],
    })).toBeNull();
  });
});
