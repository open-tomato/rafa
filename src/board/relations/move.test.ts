/**
 * `planRelationsMove` (`./move.ts`): the ordered writes and the old
 * mode's marks of a move in each direction, over fixture boards whose
 * rows carry both modes' fields, as a listing read for the move does.
 *
 * Idempotence is held by SENDING a plan: {@link applyWrites} and
 * {@link removeMarks} edit the listing as the board would once each write
 * or removal went through, and the plan is asked again over the result.
 * The control that this can fail is the first plan itself, which holds
 * writes over the untouched listing, and the half-finished case, which
 * sends only the first k writes and finds exactly the rest planned.
 */
import type { RelationsMoveMark, RelationsMovePlan, RelationsMoveSide, RelationsMoveWrite } from './move.js';
import type { RelatedIssue } from './port.js';
import type { GhRunner } from '../../adapters/tracker/github.js';
import type { BoardIssue, BoardIssueLink } from '../roadmap-board.js';

import { describe, expect, it } from 'bun:test';

import { SPEC_BLOCKED_LABEL } from '../blocked.js';
import { appendLine, tickLine } from '../epic-checklist.js';

import { addBlockerToBody } from './labels-blocked-edit.js';
import { LABELS_READS } from './labels.js';
import { planRelationsMove } from './move.js';
import { createNativeRelations } from './native.js';

const REPOSITORY = 'acme/board';

/** The keys a listing read for the `native` mode adds to every row. */
const NATIVE_KEYS: readonly string[] = ['parent', 'blockedBy', 'blocking', 'subIssuesSummary', 'subIssues'];
const FOREIGN = 'acme/other';

/** A runner no plan may call: planning is pure. */
const NO_GH: GhRunner = () => Promise.reject(new Error('planRelationsMove sent a gh call'));

const LABELS: RelationsMoveSide = LABELS_READS;
const NATIVE: RelationsMoveSide = createNativeRelations({ gh: NO_GH, repository: REPOSITORY });

/** A link to issue `number` on `repository`. */
function link(number: number, repository = REPOSITORY): BoardIssueLink {
  return { number, title: `Issue #${String(number)}`, state: 'OPEN', repository };
}

/** What a fixture row is made of; everything left out is empty. */
interface RowSpec {
  readonly number: number;
  readonly type?: 'epic' | 'code';
  readonly state?: 'OPEN' | 'CLOSED';
  readonly labels?: readonly string[];
  readonly body?: string;
  readonly parent?: number;
  readonly blockedBy?: readonly BoardIssueLink[];
  readonly blockedTotal?: number;
  readonly subIssues?: readonly number[];
}

/** One row carrying both modes' fields. */
function row(spec: RowSpec): BoardIssue {
  const subIssues = (spec.subIssues ?? []).map((number) => link(number));
  const blockedBy = spec.blockedBy ?? [];
  return {
    number: spec.number,
    title: `Issue #${String(spec.number)}`,
    body: spec.body ?? '',
    state: spec.state ?? 'OPEN',
    stateReason: spec.state === 'CLOSED'
      ? 'COMPLETED'
      : null,
    labels: spec.labels ?? (spec.type === 'epic'
      ? ['type:epic']
      : []),
    type: spec.type ?? 'code',
    module: 'unassigned',
    parent: spec.parent === undefined
      ? null
      : link(spec.parent),
    blockedBy: spec.blockedTotal === undefined
      ? { nodes: blockedBy }
      : { nodes: blockedBy, truncated: { total: spec.blockedTotal } },
    blocking: { nodes: [] },
    subIssuesSummary: { total: subIssues.length, completed: 0, percentCompleted: 0 },
    subIssues: { nodes: subIssues },
  };
}

/** A board recorded in labels, no native link on it. */
const LABELS_BOARD: readonly BoardIssue[] = [
  row({ number: 1, type: 'epic', labels: ['type:epic', 'epic:alpha'], body: '- [ ] #11 second\n- [ ] #10 first\n' }),
  row({ number: 2, type: 'epic', labels: ['type:epic', 'epic:beta'], body: '- [ ] #21 b\n- [ ] #20 a\n' }),
  row({ number: 3, type: 'epic', labels: ['type:epic'] }),
  row({ number: 10, labels: ['epic:alpha'] }),
  row({ number: 11, labels: ['epic:alpha'] }),
  row({ number: 12, labels: ['epic:alpha'] }),
  row({ number: 13, labels: ['epic:alpha'], state: 'CLOSED' }),
  row({ number: 20, labels: ['epic:beta'] }),
  row({ number: 21, labels: ['epic:beta'] }),
  row({ number: 22, labels: ['epic:alpha', 'epic:beta'] }),
  row({ number: 30, labels: [SPEC_BLOCKED_LABEL], body: `Blocked by: #31 ${FOREIGN}#7\n` }),
  row({ number: 31 }),
  row({ number: 32 }),
  row({ number: 33, labels: [SPEC_BLOCKED_LABEL] }),
  row({ number: 34, body: 'Blocked by: #31\n' }),
];

/** A board recorded natively; the epics keep their own `epic:` label where they have one. */
const NATIVE_BOARD: readonly BoardIssue[] = [
  row({ number: 1, type: 'epic', labels: ['type:epic', 'epic:alpha'], body: '## Acceptance criteria\n\n- Alpha ships.\n', subIssues: [11, 10, 13] }),
  row({ number: 2, type: 'epic', subIssues: [20] }),
  row({ number: 10, parent: 1 }),
  row({ number: 11, parent: 1 }),
  row({ number: 13, parent: 1, state: 'CLOSED' }),
  row({ number: 20, parent: 2 }),
  row({ number: 30, blockedBy: [link(31), link(7, FOREIGN)] }),
  row({ number: 31 }),
  row({ number: 32 }),
  row({ number: 33, blockedBy: [link(31)], blockedTotal: 60 }),
  row({ number: 35, labels: [SPEC_BLOCKED_LABEL], body: 'Blocked by: #31\n', blockedBy: [link(31), link(32)] }),
];

/** `listing` with row `number` replaced by `edit`'s answer. */
function edited(listing: readonly BoardIssue[], number: number, edit: (current: BoardIssue) => BoardIssue): readonly BoardIssue[] {
  return listing.map((current) => (current.number === number
    ? edit(current)
    : current));
}

/** `blocker` as a native link node. */
function linkOf(blocker: RelatedIssue): BoardIssueLink {
  return link(blocker.number, blocker.repository ?? REPOSITORY);
}

/** `listing` as the board holds it once `write` went through. */
function applyWrite(listing: readonly BoardIssue[], write: RelationsMoveWrite): readonly BoardIssue[] {
  switch (write.kind) {
    case 'sub-issues':
      return write.issues.reduce((current, issue) => edited(
        edited(current, issue, (member) => ({ ...member, parent: link(write.epic) })),
        write.epic,
        (epic) => ({ ...epic, subIssues: { nodes: [...epic.subIssues?.nodes ?? [], link(issue)] } }),
      ), listing);
    case 'blocked-by':
      return edited(listing, write.issue, (issue) => ({
        ...issue,
        blockedBy: { nodes: [...issue.blockedBy?.nodes ?? [], ...write.blockers.map(linkOf)] },
      }));
    case 'epic-label':
      return edited(listing, write.issue, (issue) => ({ ...issue, labels: [...issue.labels, write.label] }));
    case 'checklist':
      return edited(listing, write.epic, (epic) => ({
        ...epic,
        body: write.lines.reduce((body, line) => (line.ticked
          ? tickLine(appendLine(body, line.issue, line.why), line.issue)
          : appendLine(body, line.issue, line.why)), epic.body),
      }));
    case 'blocked-line':
      return edited(listing, write.issue, (issue) => ({
        ...issue,
        labels: write.label
          ? [...issue.labels, SPEC_BLOCKED_LABEL]
          : issue.labels,
        body: write.blockers.reduce((body, blocker) => addBlockerToBody(issue.number, body, blocker), issue.body),
      }));
  }
}

/** `listing` once every write in `writes` went through, in order. */
function applyWrites(listing: readonly BoardIssue[], writes: readonly RelationsMoveWrite[]): readonly BoardIssue[] {
  return writes.reduce(applyWrite, listing);
}

/** `listing` as the board holds it once `mark` was removed. */
function removeMark(listing: readonly BoardIssue[], mark: RelationsMoveMark): readonly BoardIssue[] {
  switch (mark.kind) {
    case 'epic-label':
      return edited(listing, mark.issue, (issue) => ({ ...issue, labels: issue.labels.filter((label) => label !== mark.label) }));
    case 'blocked-line':
      return edited(listing, mark.issue, (issue) => ({
        ...issue,
        labels: issue.labels.filter((label) => !mark.labels.includes(label)),
        body: issue.body
          .split('\n')
          .filter((line) => !line.startsWith('Blocked by:'))
          .join('\n'),
      }));
    case 'parent':
      return edited(
        edited(listing, mark.issue, (issue) => ({ ...issue, parent: null })),
        mark.parent,
        (epic) => ({ ...epic, subIssues: { nodes: (epic.subIssues?.nodes ?? []).filter((node) => node.number !== mark.issue) } }),
      );
    case 'blocked-by':
      return edited(listing, mark.issue, (issue) => ({ ...issue, blockedBy: { nodes: [] } }));
  }
}

/** `listing` once every mark in `marks` was removed. */
function removeMarks(listing: readonly BoardIssue[], marks: readonly RelationsMoveMark[]): readonly BoardIssue[] {
  return marks.reduce(removeMark, listing);
}

/** Each write's kind and target, the order a test reads. */
function outline(plan: RelationsMovePlan): readonly string[] {
  return plan.writes.map((write) => `${write.kind} ${write.what}`);
}

describe('planRelationsMove from labels to native', () => {
  const plan = planRelationsMove(LABELS_BOARD, LABELS, NATIVE);

  it('plans one sub-issues write per epic in checklist order, then one blocked-by write per line', () => {
    expect(plan.from).toBe('labels');
    expect(plan.to).toBe('native');
    expect(outline(plan)).toEqual([
      'sub-issues make #11, #10, #12, #13 sub-issues of epic #1',
      'sub-issues make #21, #20 sub-issues of epic #2',
      `blocked-by link #30 as blocked by #31 ${FOREIGN}#7`,
    ]);
    expect(plan.writes[0]).toEqual({
      kind: 'sub-issues',
      epic: 1,
      issues: [11, 10, 12, 13],
      what: 'make #11, #10, #12, #13 sub-issues of epic #1',
    });
    expect(plan.writes[2]).toEqual({
      kind: 'blocked-by',
      issue: 30,
      blockers: [{ number: 31, repository: null }, { number: 7, repository: FOREIGN }],
      what: `link #30 as blocked by #31 ${FOREIGN}#7`,
    });
  });

  it('names each moved member\'s epic: label and each blocked issue\'s label and line as old marks', () => {
    expect(plan.marks).toEqual([
      ...[11, 10, 12, 13].map((issue) => ({ kind: 'epic-label', issue, label: 'epic:alpha', what: `take epic:alpha off #${String(issue)}` })),
      ...[21, 20].map((issue) => ({ kind: 'epic-label', issue, label: 'epic:beta', what: `take epic:beta off #${String(issue)}` })),
      { kind: 'blocked-line', issue: 30, labels: [SPEC_BLOCKED_LABEL], what: 'take spec:blocked and the Blocked by: line off #30' },
    ]);
  });

  it('skips a member with two epic labels and a blocked fault, and names no mark for either', () => {
    expect(plan.skipped.map((each) => each.issue)).toEqual([22, 22, 33]);
    expect(plan.skipped[0]?.reason).toBe('#22 is not moved into epic #1: in labels mode its marks (epic:alpha, epic:beta) name no single epic');
    expect(plan.skipped[2]?.reason).toStartWith('#33\'s blockers are not moved: #33 is labelled spec:blocked');
    expect(plan.marks.some((mark) => mark.issue === 22 || mark.issue === 33 || mark.issue === 34)).toBe(false);
  });

  it('leaves a member the epic already holds as a sub-issue out of the write, keeping the rest in checklist order', () => {
    const partly = applyWrite(LABELS_BOARD, { kind: 'sub-issues', epic: 1, issues: [10], what: '' });
    const again = planRelationsMove(partly, LABELS, NATIVE);
    expect(again.writes[0]).toMatchObject({ kind: 'sub-issues', epic: 1, issues: [11, 12, 13] });
    expect(again.marks.filter((mark) => mark.kind === 'epic-label').map((mark) => mark.issue)).toEqual([11, 10, 12, 13, 21, 20]);
  });

  it('skips a member the native board already puts in another epic, planning no write or mark for it', () => {
    const elsewhere = edited(LABELS_BOARD, 12, (issue) => ({ ...issue, parent: link(2) }));
    const again = planRelationsMove(elsewhere, LABELS, NATIVE);
    expect(again.writes[0]).toMatchObject({ issues: [11, 10, 13] });
    expect(again.skipped[0]).toEqual({ issue: 12, reason: '#12 is not moved into epic #1: in native mode it is already in epic #2' });
    expect(again.marks.some((mark) => mark.issue === 12)).toBe(false);
  });

  it('links only the blockers a native issue does not hold yet', () => {
    const linked = edited(LABELS_BOARD, 30, (issue) => ({ ...issue, blockedBy: { nodes: [link(7, 'ACME/Other')] } }));
    expect(planRelationsMove(linked, LABELS, NATIVE).writes[2]).toMatchObject({ kind: 'blocked-by', blockers: [{ number: 31, repository: null }] });
  });
});

describe('planRelationsMove from native to labels', () => {
  const plan = planRelationsMove(NATIVE_BOARD, NATIVE, LABELS);

  it('labels each sub-issue in sub-issue order, then puts the checklist lines on, then the blocked lines', () => {
    expect(plan.from).toBe('native');
    expect(plan.to).toBe('labels');
    expect(outline(plan)).toEqual([
      'epic-label label #11 epic:alpha, putting it in epic #1',
      'epic-label label #10 epic:alpha, putting it in epic #1',
      'epic-label label #13 epic:alpha, putting it in epic #1',
      'checklist put #11, #10, #13 on epic #1\'s checklist',
      `blocked-line label #30 spec:blocked and name #31 ${FOREIGN}#7 on #30's Blocked by: line`,
      'blocked-line name #32 on #35\'s Blocked by: line',
    ]);
    expect(plan.writes[3]).toEqual({
      kind: 'checklist',
      epic: 1,
      lines: [
        { issue: 11, why: 'Issue #11', ticked: false },
        { issue: 10, why: 'Issue #10', ticked: false },
        { issue: 13, why: 'Issue #13', ticked: true },
      ],
      what: 'put #11, #10, #13 on epic #1\'s checklist',
    });
    expect(plan.writes[5]).toMatchObject({ kind: 'blocked-line', issue: 35, label: false, blockers: [{ number: 32, repository: null }] });
  });

  it('names each member\'s parent and each blocked issue\'s links as old marks', () => {
    expect(plan.marks).toEqual([
      ...[11, 10, 13].map((issue) => ({ kind: 'parent', issue, parent: 1, what: `take #${String(issue)} out of epic #1's sub-issues` })),
      {
        kind: 'blocked-by',
        issue: 30,
        blockers: [{ number: 31, repository: null }, { number: 7, repository: FOREIGN }],
        what: `unlink #30 from its blockers #31 ${FOREIGN}#7`,
      },
      {
        kind: 'blocked-by',
        issue: 35,
        blockers: [{ number: 31, repository: null }, { number: 32, repository: null }],
        what: 'unlink #35 from its blockers #31 #32',
      },
    ]);
  });

  it('skips the sub-issues of an epic with no epic: label and a truncated blocked-by list', () => {
    expect(plan.skipped).toEqual([
      { issue: 20, reason: '#20 is not moved into epic #2: the epic carries no epic:<slug> label to give it' },
      { issue: 33, reason: '#33\'s blockers are not moved: native mode holds 60 and the listing read 1' },
    ]);
  });

  it('puts no checklist line for a sub-issue the checklist names already', () => {
    const listed = edited(NATIVE_BOARD, 1, (epic) => ({ ...epic, body: `${epic.body}- [ ] #10 already here\n` }));
    expect(planRelationsMove(listed, NATIVE, LABELS).writes[3]).toMatchObject({
      kind: 'checklist',
      lines: [{ issue: 11 }, { issue: 13 }],
    });
  });
});

describe('planRelationsMove is idempotent', () => {
  const directions: readonly (readonly [string, readonly BoardIssue[], RelationsMoveSide, RelationsMoveSide])[] = [
    ['labels to native', LABELS_BOARD, LABELS, NATIVE],
    ['native to labels', NATIVE_BOARD, NATIVE, LABELS],
  ];

  for (const [name, board, from, to] of directions) {
    it(`${name}: a move sent whole plans no write, and still names the kept marks`, () => {
      const first = planRelationsMove(board, from, to);
      expect(first.writes.length).toBeGreaterThan(0);
      const moved = applyWrites(board, first.writes);
      const second = planRelationsMove(moved, from, to);
      expect(second.writes).toEqual([]);
      expect(second.marks).toEqual(first.marks);
      expect(second.skipped).toEqual(first.skipped);
    });

    it(`${name}: once the old marks are removed, a run plans neither writes nor marks`, () => {
      const first = planRelationsMove(board, from, to);
      const moved = removeMarks(applyWrites(board, first.writes), first.marks);
      const second = planRelationsMove(moved, from, to);
      expect(second.writes).toEqual([]);
      expect(second.marks).toEqual([]);
    });

    it(`${name}: a move stopped after any write plans exactly the writes it did not send`, () => {
      const first = planRelationsMove(board, from, to);
      for (let sent = 0; sent <= first.writes.length; sent += 1) {
        const rerun = planRelationsMove(applyWrites(board, first.writes.slice(0, sent)), from, to);
        expect(rerun.writes).toEqual(first.writes.slice(sent));
      }
    });
  }

  it('moves a labels board to native and back to the same members in checklist order, a skipped one kept, and the same blockers', () => {
    const toNative = planRelationsMove(LABELS_BOARD, LABELS, NATIVE);
    const native = removeMarks(applyWrites(LABELS_BOARD, toNative.writes), toNative.marks);
    const toLabels = planRelationsMove(native, NATIVE, LABELS);
    const back = applyWrites(native, toLabels.writes);
    const before = LABELS.read(LABELS_BOARD);
    const after = LABELS.read(back);
    const epicRow = (listing: readonly BoardIssue[]): BoardIssue => listing.find((issue) => issue.number === 1) ?? row({ number: 1 });
    const issue30 = (listing: readonly BoardIssue[]): BoardIssue => listing.find((issue) => issue.number === 30) ?? row({ number: 30 });
    expect(after.membersOf(epicRow(back)).members.map((member) => member.number))
      .toEqual(before.membersOf(epicRow(LABELS_BOARD)).members.map((member) => member.number));
    expect(after.blockersOf(issue30(back))).toEqual(before.blockersOf(issue30(LABELS_BOARD)));
  });
});

describe('planRelationsMove refusals', () => {
  it('refuses two sides reading one mode with a TypeError', () => {
    expect(() => planRelationsMove(LABELS_BOARD, LABELS, LABELS)).toThrow(TypeError);
    expect(() => planRelationsMove(LABELS_BOARD, NATIVE, NATIVE)).toThrow('board relations move: refused to move a board from native to native');
  });

  it('refuses a listing read without the native fields, whichever way the move goes', () => {
    const bare = LABELS_BOARD.map((issue): BoardIssue => Object.fromEntries(Object.entries(issue)
      .filter(([key]) => !NATIVE_KEYS.includes(key))) as unknown as BoardIssue);
    expect(bare.every((issue) => !Object.hasOwn(issue, 'parent'))).toBe(true);
    expect(() => planRelationsMove(bare, LABELS, NATIVE)).toThrow('board.relationships');
    expect(() => planRelationsMove(bare, NATIVE, LABELS)).toThrow('board.relationships');
  });
});
