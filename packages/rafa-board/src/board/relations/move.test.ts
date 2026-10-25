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
 *
 * `writeRelationsMove` is held over {@link fakeBoard}, an in-process `gh`
 * that edits the fixture listing as GitHub would for each argv the writer
 * sends, so a move it stopped is planned again over what the board then
 * holds, and a rerun is sent over the same board.
 */
import type { RelationsMoveMark, RelationsMovePlan, RelationsMoveSide, RelationsMoveWrite } from './move.js';
import type { RelatedIssue } from './port.js';
import type { GhResult, GhRunner } from '../../adapters/tracker/github.js';
import type { BoardIssue, BoardIssueLink } from '../roadmap-board.js';

import { describe, expect, it } from 'bun:test';

import { SPEC_BLOCKED_LABEL } from '../blocked.js';
import { appendLine, tickLine } from '../epic-checklist.js';

import { addBlockerToBody } from './labels-blocked-edit.js';
import { LABELS_READS } from './labels.js';
import { planRelationsMove, writeRelationsMove } from './move.js';
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

/** What the fake board answers a call it takes with no output. */
const TAKEN: GhResult = { ok: true, stdout: '', stderr: '' };

/** What it answers a call it refuses. */
const DOWN: GhResult = { ok: false, stdout: '', stderr: 'HTTP 502: the board is down' };

/** The path `createGhRoadmapBody` reads and writes a body at. */
const BODY_PATH = /^repos\/\{owner\}\/\{repo\}\/issues\/(\d+)$/u;

/** A foreign blocker's URL, as the writer sends it. */
const ISSUE_URL = /^https:\/\/github\.com\/([^/]+\/[^/]+)\/issues\/(\d+)$/u;

/** A `gh issue edit` list item as a link node: a number on the board, a URL elsewhere. */
function linkOfArg(arg: string): BoardIssueLink {
  const url = ISSUE_URL.exec(arg);
  return url === null
    ? link(Number(arg))
    : link(Number(url[2]), url[1]);
}

/** `listing` with `issue` made a sub-issue of `epic`, last. */
function withSubIssue(listing: readonly BoardIssue[], epic: number, issue: number): readonly BoardIssue[] {
  return edited(
    edited(listing, issue, (member) => ({ ...member, parent: link(epic) })),
    epic,
    (row) => ({ ...row, subIssues: { nodes: [...row.subIssues?.nodes ?? [], link(issue)] } }),
  );
}

/** `listing` with `issue` taken out of its parent's sub-issues. */
function withoutParent(listing: readonly BoardIssue[], issue: number): readonly BoardIssue[] {
  const parent = listing.find((row) => row.number === issue)?.parent?.number ?? 0;
  return edited(
    edited(listing, issue, (member) => ({ ...member, parent: null })),
    parent,
    (row) => ({ ...row, subIssues: { nodes: (row.subIssues?.nodes ?? []).filter((node) => node.number !== issue) } }),
  );
}

/** `listing` once `flag` with `value` went through on `issue`. */
function editFlag(listing: readonly BoardIssue[], issue: number, flag: string, value: string): readonly BoardIssue[] {
  const on = (edit: (row: BoardIssue) => BoardIssue): readonly BoardIssue[] => edited(listing, issue, edit);
  const items = value.split(',');
  switch (flag) {
    case '--add-sub-issue':
      return items.reduce((current, item) => withSubIssue(current, issue, Number(item)), listing);
    case '--remove-parent':
      return withoutParent(listing, issue);
    case '--add-blocked-by':
      return on((row) => ({ ...row, blockedBy: { nodes: [...row.blockedBy?.nodes ?? [], ...items.map(linkOfArg)] } }));
    case '--remove-blocked-by': {
      const gone = items.map(linkOfArg);
      return on((row) => ({ ...row, blockedBy: { nodes: (row.blockedBy?.nodes ?? []).filter((node) => !gone
        .some((each) => each.number === node.number && each.repository === node.repository)) } }));
    }
    case '--add-label':
      return on((row) => ({ ...row, labels: [...row.labels, value] }));
    case '--remove-label':
      return on((row) => ({ ...row, labels: row.labels.filter((label) => label !== value) }));
    case '--body':
      return on((row) => ({ ...row, body: value }));
    default:
      throw new Error(`fake board: no flag ${flag}`);
  }
}

/** `listing` once `gh issue edit <issue> ...flags` went through. */
function editIssue(listing: readonly BoardIssue[], issue: number, flags: readonly string[]): readonly BoardIssue[] {
  const [flag, ...rest] = flags;
  if (flag === undefined) return listing;
  if (flag.startsWith('--body=')) return editIssue(editFlag(listing, issue, '--body', flag.slice('--body='.length)), issue, rest);
  if (flag === '--remove-parent') return editIssue(editFlag(listing, issue, flag, ''), issue, rest);
  return editIssue(editFlag(listing, issue, flag, rest[0] ?? ''), issue, rest.slice(1));
}

/** A fixture board behind an in-process `gh`, and what it was sent. */
interface FakeBoard {
  readonly gh: GhRunner;
  /** The board as it reads now. */
  readonly listing: () => readonly BoardIssue[];
  /** Every call, in order. */
  readonly calls: () => readonly (readonly string[])[];
}

/**
 * A board holding `start` that answers the writer's calls as GitHub
 * would: `gh issue edit` flags and the body read and write. From the
 * `downFrom`th call that changes something (1 for the first), every such
 * call is refused, as a board gone down mid-move.
 */
function fakeBoard(start: readonly BoardIssue[], downFrom = Number.POSITIVE_INFINITY): FakeBoard {
  let listing = start;
  let changes = 0;
  const calls: (readonly string[])[] = [];
  const bodyOf = (issue: number): GhResult => ({
    ok: true,
    stdout: JSON.stringify({ body: listing.find((row) => row.number === issue)?.body ?? '' }),
    stderr: '',
  });
  const gh: GhRunner = (args) => {
    calls.push([...args]);
    const path = args[0] === 'api'
      ? BODY_PATH.exec(args[1] ?? '')
      : null;
    if (path !== null && args[2] !== '-X') return Promise.resolve(bodyOf(Number(path[1])));
    changes += 1;
    if (changes >= downFrom) return Promise.resolve(DOWN);
    if (path !== null) {
      listing = edited(listing, Number(path[1]), (row) => ({ ...row, body: (args[5] ?? '').slice('body='.length) }));
      return Promise.resolve(bodyOf(Number(path[1])));
    }
    if (args[0] !== 'issue' || args[1] !== 'edit') throw new Error(`fake board: no call ${args.join(' ')}`);
    listing = editIssue(listing, Number(args[2]), args.slice(3));
    return Promise.resolve(TAKEN);
  };
  return { gh, listing: () => listing, calls: () => calls };
}

/** An ask answering `answer`, and the questions it was asked. */
function asking(answer: boolean): { readonly ask: (question: string) => Promise<boolean>; readonly asked: () => readonly string[] } {
  const asked: string[] = [];
  return {
    ask: (question) => {
      asked.push(question);
      return Promise.resolve(answer);
    },
    asked: () => asked,
  };
}

/** The `gh issue edit` calls among `calls`, as one line each. */
function issueEdits(calls: readonly (readonly string[])[]): readonly string[] {
  return calls.filter((call) => call[1] === 'edit').map((call) => call.slice(2).join(' '));
}

describe('writeRelationsMove sends a plan', () => {
  it('labels to native: one --add-sub-issue per epic in checklist order, one --add-blocked-by per issue, a foreign one by URL', async () => {
    const board = fakeBoard(LABELS_BOARD);
    const plan = planRelationsMove(LABELS_BOARD, LABELS, NATIVE);
    const result = await writeRelationsMove({ gh: board.gh, ask: asking(false).ask }, plan);
    expect(issueEdits(board.calls())).toEqual([
      '1 --add-sub-issue 11,10,12,13',
      '2 --add-sub-issue 21,20',
      `30 --add-blocked-by 31,https://github.com/${FOREIGN}/issues/7`,
    ]);
    expect(board.calls()).toHaveLength(3);
    expect(result.done).toEqual(plan.writes);
    expect(result.left).toEqual([]);
    expect(result.failure).toBeNull();
    expect(result.touched).toEqual([1, 2, 10, 11, 12, 13, 20, 21, 30, 31]);
    expect(planRelationsMove(board.listing(), LABELS, NATIVE).writes).toEqual([]);
  });

  it('native to labels: labels, then the checklist through the body, then the blocked line with its label in one call', async () => {
    const board = fakeBoard(NATIVE_BOARD);
    const plan = planRelationsMove(NATIVE_BOARD, NATIVE, LABELS);
    const result = await writeRelationsMove({ gh: board.gh, ask: asking(false).ask }, plan);
    expect(result.failure).toBeNull();
    expect(issueEdits(board.calls())).toEqual([
      '11 --add-label epic:alpha',
      '10 --add-label epic:alpha',
      '13 --add-label epic:alpha',
      `30 --add-label ${SPEC_BLOCKED_LABEL} --body=Blocked by: #31 ${FOREIGN}#7\n`,
      '35 --body=Blocked by: #31 #32\n',
    ]);
    const epic = board.listing().find((issue) => issue.number === 1);
    expect(epic?.body).toBe('## Acceptance criteria\n\n- Alpha ships.\n- [ ] #11 Issue #11\n- [ ] #10 Issue #10\n- [x] #13 Issue #13\n');
    expect(planRelationsMove(board.listing(), NATIVE, LABELS).writes).toEqual([]);
  });

  it('reads a body afresh, so an epic that also waits keeps the checklist lines written before its blocked line', async () => {
    const start = edited(NATIVE_BOARD, 1, (epic) => ({ ...epic, blockedBy: { nodes: [link(31)] } }));
    const plan = planRelationsMove(start, NATIVE, LABELS);
    expect(plan.writes.filter((write) => write.kind === 'checklist' && write.epic === 1
      || write.kind === 'blocked-line' && write.issue === 1).map((write) => write.kind)).toEqual(['checklist', 'blocked-line']);
    const board = fakeBoard(start);
    await writeRelationsMove({ gh: board.gh, ask: asking(false).ask }, plan);
    const body = board.listing().find((issue) => issue.number === 1)?.body ?? '';
    expect(body).toContain('- [ ] #11 Issue #11');
    expect(body).toContain('Blocked by: #31');
  });

  it('sends nothing and asks nothing for a plan with neither writes nor marks', async () => {
    const board = fakeBoard(LABELS_BOARD);
    const questions = asking(true);
    const empty: RelationsMovePlan = { from: 'labels', to: 'native', writes: [], marks: [], skipped: [] };
    const result = await writeRelationsMove({ gh: board.gh, ask: questions.ask }, empty);
    expect(board.calls()).toEqual([]);
    expect(questions.asked()).toEqual([]);
    expect(result).toEqual({ done: [], left: [], asked: false, removed: [], kept: [], failure: null, touched: [] });
  });
});

describe('writeRelationsMove stops at the first refusal', () => {
  it('names the refused write and every write after it as left, and asks nothing', async () => {
    const plan = planRelationsMove(LABELS_BOARD, LABELS, NATIVE);
    const board = fakeBoard(LABELS_BOARD, 2);
    const questions = asking(true);
    const result = await writeRelationsMove({ gh: board.gh, ask: questions.ask }, plan);
    expect(result.done).toEqual(plan.writes.slice(0, 1));
    expect(result.left).toEqual(plan.writes.slice(1));
    expect(result.failure).toEqual({ what: 'make #21, #20 sub-issues of epic #2', problem: 'HTTP 502: the board is down' });
    expect(board.calls()).toHaveLength(2);
    expect(questions.asked()).toEqual([]);
    expect(result.asked).toBe(false);
    expect(result.removed).toEqual([]);
    expect(result.kept).toEqual(plan.marks);
    expect(result.touched).toEqual([1, 2, 10, 11, 12, 13, 20, 21]);
  });

  it('answers a body it could not read and a checklist edit that failed as the refusal', async () => {
    const plan = planRelationsMove(NATIVE_BOARD, NATIVE, LABELS);
    const checklist = plan.writes.findIndex((write) => write.kind === 'checklist');
    const board = fakeBoard(NATIVE_BOARD, checklist + 1);
    const result = await writeRelationsMove({ gh: board.gh, ask: asking(true).ask }, plan);
    expect(result.done).toEqual(plan.writes.slice(0, checklist));
    expect(result.failure?.what).toBe('put #11, #10, #13 on epic #1\'s checklist');
    expect(result.failure?.problem).toContain('HTTP 502: the board is down');

    const unreadable: GhRunner = (args) => Promise.resolve(args[0] === 'api'
      ? DOWN
      : TAKEN);
    const line = plan.writes.filter((write) => write.kind === 'blocked-line');
    const refused = await writeRelationsMove({ gh: unreadable, ask: asking(true).ask }, { ...plan, writes: line });
    expect(refused.left).toEqual(line);
    expect(refused.failure?.problem).toContain('HTTP 502: the board is down');
  });

  const directions: readonly (readonly [string, readonly BoardIssue[], RelationsMoveSide, RelationsMoveSide])[] = [
    ['labels to native', LABELS_BOARD, LABELS, NATIVE],
    ['native to labels', NATIVE_BOARD, NATIVE, LABELS],
  ];

  for (const [name, start, from, to] of directions) {
    it(`${name}: a move stopped at any write reruns exactly what was left, then finishes and plans nothing`, async () => {
      const first = planRelationsMove(start, from, to);
      expect(first.writes.length).toBeGreaterThan(1);
      for (let stop = 1; stop <= first.writes.length; stop += 1) {
        const broken = fakeBoard(start, stop);
        const stopped = await writeRelationsMove({ gh: broken.gh, ask: asking(true).ask }, first);
        expect(stopped.done).toEqual(first.writes.slice(0, stop - 1));
        expect(stopped.left).toEqual(first.writes.slice(stop - 1));
        expect(stopped.asked).toBe(false);
        expect(issueEdits(broken.calls()).some((call) => call.includes('--remove-'))).toBe(false);

        const rerun = planRelationsMove(broken.listing(), from, to);
        expect(rerun.writes).toEqual(stopped.left);
        expect(rerun.marks).toEqual(first.marks);
        const healthy = fakeBoard(broken.listing());
        const finished = await writeRelationsMove({ gh: healthy.gh, ask: asking(true).ask }, rerun);
        expect(finished.failure).toBeNull();
        expect(finished.removed).toEqual(first.marks);
        const after = planRelationsMove(healthy.listing(), from, to);
        expect(after.writes).toEqual([]);
        expect(after.marks).toEqual([]);
      }
    });
  }
});

describe('writeRelationsMove and the old marks', () => {
  it('asks once every write went through, and keeps every mark on a no', async () => {
    const plan = planRelationsMove(LABELS_BOARD, LABELS, NATIVE);
    const board = fakeBoard(LABELS_BOARD);
    const questions = asking(false);
    const result = await writeRelationsMove({ gh: board.gh, ask: questions.ask }, plan);
    expect(questions.asked()).toEqual(['Remove the 7 old labels marks from the board?']);
    expect(result.asked).toBe(true);
    expect(result.removed).toEqual([]);
    expect(result.kept).toEqual(plan.marks);
    expect(issueEdits(board.calls()).some((call) => call.includes('--remove-'))).toBe(false);
    expect(planRelationsMove(board.listing(), LABELS, NATIVE).marks).toEqual(plan.marks);
  });

  it('labels to native: on a yes takes each epic: label off, and spec:blocked with the Blocked by: line in one call', async () => {
    const plan = planRelationsMove(LABELS_BOARD, LABELS, NATIVE);
    const board = fakeBoard(LABELS_BOARD);
    const result = await writeRelationsMove({ gh: board.gh, ask: asking(true).ask }, plan);
    expect(issueEdits(board.calls()).slice(3)).toEqual([
      ...[11, 10, 12, 13].map((issue) => `${String(issue)} --remove-label epic:alpha`),
      ...[21, 20].map((issue) => `${String(issue)} --remove-label epic:beta`),
      `30 --remove-label ${SPEC_BLOCKED_LABEL} --body=`,
    ]);
    expect(result.removed).toEqual(plan.marks);
    expect(result.kept).toEqual([]);
    expect(planRelationsMove(board.listing(), LABELS, NATIVE).marks).toEqual([]);
  });

  it('native to labels: on a yes takes each member out of its parent and unlinks each blocked issue, a foreign blocker by URL', async () => {
    const plan = planRelationsMove(NATIVE_BOARD, NATIVE, LABELS);
    const board = fakeBoard(NATIVE_BOARD);
    const result = await writeRelationsMove({ gh: board.gh, ask: asking(true).ask }, plan);
    expect(issueEdits(board.calls()).slice(-5)).toEqual([
      '11 --remove-parent',
      '10 --remove-parent',
      '13 --remove-parent',
      `30 --remove-blocked-by 31,https://github.com/${FOREIGN}/issues/7`,
      '35 --remove-blocked-by 31,32',
    ]);
    expect(result.removed).toEqual(plan.marks);
    expect(result.touched).toContain(32);
  });

  it('asks about marks kept by an earlier run even when no write is left', async () => {
    const first = planRelationsMove(LABELS_BOARD, LABELS, NATIVE);
    const moved = applyWrites(LABELS_BOARD, first.writes);
    const second = planRelationsMove(moved, LABELS, NATIVE);
    expect(second.writes).toEqual([]);
    const board = fakeBoard(moved);
    const questions = asking(true);
    const result = await writeRelationsMove({ gh: board.gh, ask: questions.ask }, second);
    expect(questions.asked()).toHaveLength(1);
    expect(result.removed).toEqual(first.marks);
  });

  it('stops removing at the first refusal, naming the removed marks and the kept ones', async () => {
    const plan = planRelationsMove(LABELS_BOARD, LABELS, NATIVE);
    const board = fakeBoard(LABELS_BOARD, plan.writes.length + 3);
    const result = await writeRelationsMove({ gh: board.gh, ask: asking(true).ask }, plan);
    expect(result.done).toEqual(plan.writes);
    expect(result.removed).toEqual(plan.marks.slice(0, 2));
    expect(result.kept).toEqual(plan.marks.slice(2));
    expect(result.failure).toEqual({ what: 'take epic:alpha off #12', problem: 'HTTP 502: the board is down' });
    expect(planRelationsMove(board.listing(), LABELS, NATIVE).marks).toEqual(plan.marks.slice(2));
  });
});
