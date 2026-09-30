/**
 * Tests for the dependents query (`src/board/epic-dependents.ts`) in
 * `native` mode: the epic's members are its sub-issues, an outsider
 * waits on the epic through its `blockedBy` nodes, and no `epic:` label
 * or `Blocked by:` line is read. The `labels` cases stay in
 * `./epic-dependents.test.ts`.
 *
 * Every case is a pure call over a literal native listing, read through
 * the real `native` adapter made over a `gh` that fails any call.
 *
 * ## The controls
 *
 *  - Every native row also carries the `labels` mode's marks naming
 *    OTHER issues: an `epic:` label and a `Blocked by:` line. The same
 *    listing read with no port must answer those, so a native reading
 *    that fell back to labels or lines fails.
 *  - The dependent is read beside the same listing with the blocking
 *    member closed, which must list nothing.
 *  - A foreign blocker numbered like an open member is read beside the
 *    same number on this board, which must be a dependent.
 *  - The labels-mode answer's keys are asserted by `Object.keys` beside
 *    the native one, so neither mode grows a key the other lacks.
 */
import type { BoardIssue, BoardIssueLink } from './roadmap-board.js';
import type { GhRunner } from '../adapters/tracker/github.js';

import { describe, expect, it } from 'bun:test';

import { typeOfLabels } from '../adapters/tracker/github.js';

import { readEpicDependents } from './epic-dependents.js';
import { LABELS_READS } from './relations/labels.js';
import { createNativeRelations } from './relations/native.js';

/** The board's own repository. */
const BOARD = 'acme/board';

/** Another repository. */
const FOREIGN = 'acme/other';

/** A `gh` every call to which fails the case: reads never spawn. */
const NO_GH: GhRunner = (args) => {
  throw new Error(`a read sent gh ${args.join(' ')}`);
};

/** The `native` adapter on {@link BOARD}. */
const NATIVE = createNativeRelations({ gh: NO_GH, repository: BOARD });

/** Issue `number` on `repository` as a link node names it. */
function link(number: number, repository: string = BOARD, state: 'OPEN' | 'CLOSED' = 'OPEN'): BoardIssueLink {
  return { number, title: `issue ${String(number)}`, state, repository };
}

/** The fields a case may set on a native row. */
interface RowFields {
  readonly labels?: readonly string[];
  readonly state?: 'OPEN' | 'CLOSED';
  readonly body?: string;
  readonly parent?: number;
  readonly subIssues?: readonly number[];
  readonly blockedBy?: readonly BoardIssueLink[];
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
    stateReason: fields.state === 'CLOSED'
      ? 'COMPLETED'
      : null,
    labels,
    type: typeOfLabels(labels),
    module: 'unassigned',
    parent: fields.parent === undefined
      ? null
      : link(fields.parent),
    blockedBy: { nodes: fields.blockedBy ?? [] },
    blocking: { nodes: [] },
    subIssuesSummary: { total: subIssues.length, completed: 0, percentCompleted: 0 },
    subIssues: { nodes: subIssues.map((number) => link(number)) },
  };
}

/** A `Blocked by:` line naming `ids`, the labels mode's mark. */
function blockedLine(...ids: readonly number[]): string {
  return `Some prose.\n\nBlocked by: ${ids.map((id) => `#${String(id)}`).join(' ')}\n`;
}

/**
 * Epic #1 holds #3 and #2 as sub-issues (sub-issue order, not number
 * order) and #4 closed; its `epic:auth` label is carried by #20 alone.
 * Outsider #30 waits on #3 natively, while its `Blocked by:` line names
 * #20. Outsider #31 carries `spec:blocked` and a line naming #3, and no
 * `blockedBy` link. Epic #10 is another epic, holding #11.
 */
function board(options: { readonly member3?: 'OPEN' | 'CLOSED'; readonly extra?: readonly BoardIssue[] } = {}): readonly BoardIssue[] {
  const member3 = options.member3 ?? 'OPEN';
  return [
    row(1, { labels: ['type:epic', 'epic:auth', 'horizon:now'], subIssues: [3, 2, 4] }),
    row(2, { labels: ['type:spec'], parent: 1 }),
    row(3, { labels: ['type:spec'], parent: 1, state: member3 }),
    row(4, { labels: ['type:spec'], parent: 1, state: 'CLOSED' }),
    row(10, { labels: ['type:epic', 'epic:billing', 'horizon:next'], subIssues: [11] }),
    row(11, { labels: ['type:spec'], parent: 10 }),
    row(20, { labels: ['type:spec', 'epic:auth'] }),
    row(30, { labels: ['type:spec'], body: blockedLine(20), blockedBy: [link(3, BOARD, member3)] }),
    row(31, { labels: ['type:spec', 'spec:blocked'], body: blockedLine(3) }),
    ...options.extra ?? [],
  ];
}

describe('readEpicDependents in native mode', () => {
  it('reads the sub-issues as members and the blockedBy nodes as waiting, and no label or line', () => {
    const read = readEpicDependents(board(), 1, { relations: NATIVE });
    expect(read?.slug).toBeNull();
    expect(read?.openMembers).toEqual([2, 3]);
    expect(read?.dependents.map((each) => [each.issue.number, each.waitsOn])).toEqual([[30, [3]]]);
    expect(read?.problems).toEqual([]);
  });

  it('control: the same listing with no port reads the labels and lines instead', () => {
    const read = readEpicDependents(board(), 1);
    expect(read?.slug).toBe('auth');
    expect(read?.openMembers).toEqual([20]);
    expect(read?.dependents.map((each) => [each.issue.number, each.waitsOn])).toEqual([[30, [20]]]);
    expect(readEpicDependents(board(), 1, { relations: LABELS_READS })).toEqual(read);
  });

  it('lists nothing once the member it waits on is closed', () => {
    const read = readEpicDependents(board({ member3: 'CLOSED' }), 1, { relations: NATIVE });
    expect(read?.openMembers).toEqual([2]);
    expect(read?.dependents).toEqual([]);
  });

  it('keeps the blockedBy node order in waitsOn', () => {
    const waiting = row(32, { labels: ['type:spec'], blockedBy: [link(3), link(99), link(2)] });
    const read = readEpicDependents(board({ extra: [waiting] }), 1, { relations: NATIVE });
    const dependent = read?.dependents.find((each) => each.issue.number === 32);
    expect(dependent?.waitsOn).toEqual([3, 2]);
  });

  it('never reads a foreign blocker as a member, whatever its number', () => {
    const foreign = row(33, { labels: ['type:spec'], blockedBy: [link(3, FOREIGN)] });
    const read = readEpicDependents(board({ extra: [foreign] }), 1, { relations: NATIVE });
    expect(read?.dependents.map((each) => each.issue.number)).toEqual([30]);
  });

  it('control: the same number on this board is a dependent', () => {
    const local = row(33, { labels: ['type:spec'], blockedBy: [link(3)] });
    const read = readEpicDependents(board({ extra: [local] }), 1, { relations: NATIVE });
    expect(read?.dependents.map((each) => each.issue.number)).toEqual([30, 33]);
  });

  it('leaves a member waiting on a member, and a closed outsider, alone', () => {
    const inside = row(5, { labels: ['type:spec'], parent: 1, blockedBy: [link(3)] });
    const closed = row(34, { labels: ['type:spec'], state: 'CLOSED', blockedBy: [link(3)] });
    const read = readEpicDependents(board({ extra: [inside, closed] }), 1, { relations: NATIVE });
    expect(read?.dependents.map((each) => each.issue.number)).toEqual([30]);
  });

  it('reads another epic waiting on a member like any outsider', () => {
    const waitingEpic = row(12, { labels: ['type:epic', 'horizon:later'], blockedBy: [link(2)] });
    const read = readEpicDependents(board({ extra: [waitingEpic] }), 1, { relations: NATIVE });
    expect(read?.dependents.map((each) => [each.issue.number, each.waitsOn])).toEqual([[12, [2]], [30, [3]]]);
  });

  it('answers null for a number the listing holds no epic for', () => {
    expect(readEpicDependents(board(), 2, { relations: NATIVE })).toBeNull();
    expect(readEpicDependents(board(), 999, { relations: NATIVE })).toBeNull();
  });

  it('answers the same keys in both modes', () => {
    const native = readEpicDependents(board(), 1, { relations: NATIVE });
    const labels = readEpicDependents(board(), 1);
    expect(Object.keys(native ?? {})).toEqual(Object.keys(labels ?? {}));
    expect(Object.keys(native?.dependents[0] ?? {})).toEqual(['issue', 'waitsOn']);
  });

  it('refuses a listing read without the native fields, naming board.relationships', () => {
    const labelsRow: BoardIssue = {
      number: 1, title: 'epic', body: '', state: 'OPEN', stateReason: null,
      labels: ['type:epic'], type: 'epic', module: 'unassigned',
    };
    expect(() => readEpicDependents([labelsRow], 1, { relations: NATIVE })).toThrow('board.relationships is native');
  });
});
