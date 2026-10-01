/**
 * Tests for the other mode's marks row of `rafa doctor`
 * (`doctor-marks.ts`) and its wiring through `readDoctorBoard`
 * (`doctor-board.ts`): in `native` mode the `epic:` labels, `spec:blocked`
 * labels and their `Blocked by:` lines; in `labels` mode the sub-issue
 * parents and blocked-by links; the lines pointing at `rafa init --board`;
 * and a key left unset reading, sending and printing nothing new.
 *
 * Every case drives a listing thunk over a literal native board and a
 * recorded runner answering each command from literals, so no case
 * reaches GitHub or spawns `gh`. Each board holding marks is paired with
 * one holding none, the control that shows the row could stay quiet.
 */
import type { GhResult, GhRunner } from '../adapters/tracker/github.js';
import type { BoardIssue, BoardListing } from '../board/roadmap-board.js';

import { mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, describe, expect, it } from 'bun:test';

import { BOARD_LIST_FIELDS, nativeBoardListFields, parseBoardListing } from '../board/roadmap-board.js';

import { readDoctorBoard, relationsResultOf, renderDoctorBoard } from './doctor-board.js';
import { MARKS_HEADING, markMessage, otherModeOf, readDoctorMarks, renderDoctorMarks } from './doctor-marks.js';

/** The project root the wiring cases read in: an empty directory, so no config and no template. */
const ROOT = realpathSync(mkdtempSync(join(tmpdir(), 'rafa-doctor-marks-')));

afterAll(() => {
  rmSync(ROOT, { recursive: true, force: true });
});

/** The board's own repository. */
const REPOSITORY = 'acme/board';

/** A link node naming issue `number`, on the board's repository unless `repository` names another. */
function node(number: number, repository: string = REPOSITORY): object {
  return { number, title: `Issue ${String(number)}`, state: 'OPEN', url: `https://github.com/${repository}/issues/${String(number)}` };
}

/** The fields a row may set. */
interface RowFields {
  readonly state?: 'OPEN' | 'CLOSED';
  readonly labels?: readonly string[];
  readonly body?: string;
  readonly parent?: object;
  readonly blockedBy?: readonly object[];
  readonly blockedTotal?: number;
}

/** One issue as `gh issue list --json <native fields>` writes it. */
function row(number: number, fields: RowFields = {}): object {
  const blockedBy = fields.blockedBy ?? [];
  return {
    number,
    title: `Issue ${String(number)}`,
    body: fields.body ?? '',
    state: fields.state ?? 'OPEN',
    stateReason: null,
    labels: (fields.labels ?? []).map((name) => ({ name })),
    parent: fields.parent ?? null,
    blockedBy: { nodes: blockedBy, totalCount: fields.blockedTotal ?? blockedBy.length },
    blocking: { nodes: [], totalCount: 0 },
    subIssuesSummary: { total: 0, completed: 0, percentCompleted: 0 },
    subIssues: { nodes: [], totalCount: 0 },
  };
}

/** `rows` parsed as the native listing parses them. */
function parsed(rows: readonly object[]): readonly BoardIssue[] {
  return parseBoardListing(JSON.stringify(rows), 'gh issue list', 'native');
}

/** A listing answering `rows`, counting how often it was asked. */
function listingOf(rows: readonly object[]): { listing: BoardListing; asked: () => number } {
  let asked = 0;
  const listing: BoardListing = () => {
    asked += 1;
    return Promise.resolve(parsed(rows));
  };
  return { listing, asked: () => asked };
}

/** A runner answering `gh repo view` with the board's repository, recording every call. */
function repoGh(ok = true): { run: GhRunner; calls: () => readonly string[] } {
  const calls: string[] = [];
  const run: GhRunner = (args) => {
    calls.push(args.join(' '));
    const result: GhResult = ok && args[0] === 'repo'
      ? { ok: true, stdout: JSON.stringify({ nameWithOwner: REPOSITORY }), stderr: '' }
      : { ok: false, stdout: '', stderr: 'gh: not authenticated' };
    return Promise.resolve(result);
  };
  return { run, calls: () => calls };
}

/** A board still recorded in labels: #1 the epic, #7 and #5 its members, #5 blocked by #7, #9 a stale line. */
const LABELS_BOARD: readonly object[] = [
  row(1, { labels: ['type:epic', 'epic:auth'], body: '- [ ] #5\n- [ ] #7\n' }),
  row(7, { labels: ['epic:auth'], state: 'CLOSED' }),
  row(5, { labels: ['epic:auth', 'spec:blocked'], body: 'Blocked by: #7\n' }),
  row(9, { body: 'Blocked by: #7\n' }),
  row(11, { labels: ['Spec:Blocked'] }),
];

/** A board recorded natively: #3 and #4 sub-issues of #1, #4 blocked by #3 and a foreign issue, #6 truncated. */
const NATIVE_BOARD: readonly object[] = [
  row(1, { labels: ['type:epic', 'epic:auth'] }),
  row(4, { parent: node(1), blockedBy: [node(3), node(12, 'acme/other')] }),
  row(3, { parent: node(1), state: 'CLOSED' }),
  row(6, { blockedBy: [node(3)], blockedTotal: 58 }),
];

/** Every mark's issue and kind, in order. */
function kinds(marks: readonly { readonly issue: number; readonly kind: string }[]): readonly string[] {
  return marks.map((mark) => `#${String(mark.issue)} ${mark.kind}`);
}

describe('otherModeOf', () => {
  it('answers the mode the key does not name', () => {
    expect([otherModeOf('native'), otherModeOf('labels')]).toEqual(['labels', 'native']);
  });
});

describe('readDoctorMarks in native mode', () => {
  it('names epic: labels off non-epics and spec:blocked with its line, in number order, open and closed alike', async () => {
    const { run, calls } = repoGh();
    const report = await readDoctorMarks({ gh: run, listing: listingOf(LABELS_BOARD).listing, mode: 'native' });

    expect(report.relationships).toBe('native');
    expect(report.other).toBe('labels');
    expect(report.problem).toBeNull();
    expect(kinds(report.marks)).toEqual(['#5 epic-label', '#5 spec-blocked', '#7 epic-label', '#11 spec-blocked']);
    expect(report.marks.map(markMessage)).toEqual([
      '#5 carries epic:auth',
      '#5 carries spec:blocked and a Blocked by: line',
      '#7 carries epic:auth',
      '#11 carries spec:blocked',
    ]);
    expect(calls()).toEqual([]);
  });

  it('names nothing on a board recorded natively, the control', async () => {
    const report = await readDoctorMarks({ gh: repoGh().run, listing: listingOf(NATIVE_BOARD).listing, mode: 'native' });

    expect(report.marks).toEqual([]);
    expect(report.problem).toBeNull();
  });

  it('leaves out a Blocked by: line without spec:blocked, which labels mode never reads', async () => {
    const report = await readDoctorMarks({ gh: repoGh().run, listing: listingOf([row(9, { body: 'Blocked by: #7\n' })]).listing, mode: 'native' });

    expect(report.marks).toEqual([]);
  });
});

describe('readDoctorMarks in labels mode', () => {
  it('names sub-issue parents and blocked-by links, a foreign link by owner/name, after one repository read', async () => {
    const { run, calls } = repoGh();
    const { listing, asked } = listingOf(NATIVE_BOARD);
    const report = await readDoctorMarks({ gh: run, listing, mode: 'labels' });

    expect(report.other).toBe('native');
    expect(report.problem).toBeNull();
    expect(kinds(report.marks)).toEqual(['#3 parent', '#4 parent', '#4 blocked-by', '#6 blocked-by']);
    expect(report.marks.map(markMessage)).toEqual([
      '#3 is a sub-issue of #1',
      '#4 is a sub-issue of #1',
      '#4 is linked as blocked by #3 acme/other#12',
      '#6 is linked as blocked by #3 and 57 more',
    ]);
    expect(calls()).toEqual(['repo view --json nameWithOwner']);
    expect(asked()).toBe(1);
  });

  it('names nothing on a board recorded in labels, the control', async () => {
    const report = await readDoctorMarks({ gh: repoGh().run, listing: listingOf(LABELS_BOARD).listing, mode: 'labels' });

    expect(report.marks).toEqual([]);
    expect(report.problem).toBeNull();
  });

  it('answers a repository read that failed as the problem, with no mark', async () => {
    const report = await readDoctorMarks({ gh: repoGh(false).run, listing: listingOf(NATIVE_BOARD).listing, mode: 'labels' });

    expect(report.marks).toEqual([]);
    expect(report.problem).toContain('gh repo view --json nameWithOwner failed: gh: not authenticated');
  });

  it('answers a listing read without the native fields as the problem', async () => {
    const labelsOnly = parseBoardListing(JSON.stringify([{ number: 2, title: 't', body: '', state: 'OPEN', stateReason: null, labels: [] }]), 'gh', 'labels');
    const report = await readDoctorMarks({ gh: repoGh().run, listing: () => Promise.resolve(labelsOnly), mode: 'labels' });

    expect(report.problem).toBe('the listing carries no native fields for #2');
  });
});

describe('readDoctorMarks when the listing fails', () => {
  it('answers the failure as the problem and never throws', async () => {
    const listing: BoardListing = () => Promise.reject(new Error('board listing: gh failed'));
    const report = await readDoctorMarks({ gh: repoGh().run, listing, mode: 'native' });

    expect(report).toEqual({ relationships: 'native', other: 'labels', marks: [], problem: 'board listing: gh failed' });
  });
});

describe('renderDoctorMarks', () => {
  it('prints the heading, the count, a line per mark and rafa init --board', async () => {
    const report = await readDoctorMarks({ gh: repoGh().run, listing: listingOf(NATIVE_BOARD).listing, mode: 'labels' });

    expect(renderDoctorMarks(report)).toEqual([
      MARKS_HEADING,
      '  board.relationships is labels, and the board holds 4 native marks it does not read:',
      '    #3 is a sub-issue of #1',
      '    #4 is a sub-issue of #1',
      '    #4 is linked as blocked by #3 acme/other#12',
      '    #6 is linked as blocked by #3 and 57 more',
      '  run rafa init --board to move them into labels mode; its second question takes them off',
    ]);
  });

  it('prints nothing for no mark and for null', () => {
    expect(renderDoctorMarks({ relationships: 'native', other: 'labels', marks: [], problem: null })).toEqual([]);
    expect(renderDoctorMarks(null)).toEqual([]);
  });

  it('prints the heading and the problem for a read that failed', () => {
    expect(renderDoctorMarks({ relationships: 'labels', other: 'native', marks: [], problem: 'boom' })).toEqual([
      MARKS_HEADING,
      '  board.relationships is labels: the board could not be read for native marks: boom',
    ]);
  });
});

/** Which reading a command is, named for the wiring cases. */
function routeOf(args: readonly string[]): string {
  if (args[0] === 'label') return 'labels';
  if (args[0] === 'repo') return 'repo';
  if (args.includes(nativeBoardListFields)) return 'native-listing';
  if (args.includes(BOARD_LIST_FIELDS)) return 'listing';
  if (args.includes('--label')) return 'blocked';
  if (args.includes('--search')) return 'roadmap';
  return 'other';
}

/** A runner answering every route of `readDoctorBoard` over `board`, recording the routes. */
function boardGh(board: readonly object[]): { run: GhRunner; calls: () => readonly string[] } {
  const calls: string[] = [];
  const answers: Record<string, unknown> = {
    'labels': [],
    'roadmap': [{ number: 8, title: 'Roadmap' }],
    'blocked': [],
    'repo': { nameWithOwner: REPOSITORY },
    'native-listing': board,
    'listing': board.map((each) => {
      const { number, title, body, state, stateReason, labels } = each as Record<string, unknown>;
      return { number, title, body, state, stateReason, labels };
    }),
  };
  const run: GhRunner = (args) => {
    const route = routeOf(args);
    calls.push(route);
    const answer = answers[route];
    const result: GhResult = answer === undefined
      ? { ok: false, stdout: '', stderr: `no route for ${args.join(' ')}` }
      : { ok: true, stdout: JSON.stringify(answer), stderr: '' };
    return Promise.resolve(result);
  };
  return { run, calls: () => calls };
}

describe('readDoctorBoard and the other mode\'s marks', () => {
  it('leaves the marks key out and reads the labels fields when the key is unset', async () => {
    const { run, calls } = boardGh(NATIVE_BOARD);
    const readings = await readDoctorBoard(run, ROOT, null, 'labels');

    expect(Object.keys(readings)).not.toContain('marks');
    expect(Object.keys(relationsResultOf(readings))).toEqual([]);
    expect(calls()).not.toContain('native-listing');
    expect(calls()).not.toContain('repo');
    expect(renderDoctorBoard(readings)).not.toContain(MARKS_HEADING);
  });

  it('names native marks when labels is set, reading the native fields once and sharing them', async () => {
    const { run, calls } = boardGh(NATIVE_BOARD);
    const readings = await readDoctorBoard(run, ROOT, null, 'labels', true);

    expect(readings.marks?.marks.length).toBe(4);
    expect(calls().filter((route) => route === 'native-listing')).toHaveLength(1);
    expect(calls()).not.toContain('listing');
    expect(Object.keys(relationsResultOf(readings))).toEqual(['marks']);
    expect(renderDoctorBoard(readings)).toContain('  run rafa init --board to move them into labels mode; its second question takes them off');
  });

  it('names labels marks when native is set, beside the relationships row, over one listing', async () => {
    const { run, calls } = boardGh(LABELS_BOARD);
    const readings = await readDoctorBoard(run, ROOT, null, 'native', true);

    expect(kinds(readings.marks?.marks ?? [])).toEqual(['#5 epic-label', '#5 spec-blocked', '#7 epic-label', '#11 spec-blocked']);
    expect(calls().filter((route) => route === 'native-listing')).toHaveLength(1);
    expect(Object.keys(relationsResultOf(readings))).toEqual(['relations', 'marks']);
    const lines = renderDoctorBoard(readings);
    expect(lines).toContain(MARKS_HEADING);
    expect(lines).toContain('    #5 carries spec:blocked and a Blocked by: line');
  });

  it('carries an empty marks reading and prints nothing for a board holding none, the control', async () => {
    const { run } = boardGh(LABELS_BOARD);
    const readings = await readDoctorBoard(run, ROOT, null, 'labels', true);

    expect(readings.marks?.marks).toEqual([]);
    expect(renderDoctorBoard(readings)).not.toContain(MARKS_HEADING);
  });

  it('reads nothing without a runner', async () => {
    const readings = await readDoctorBoard(null, ROOT, null, 'native', true);

    expect(Object.keys(readings)).not.toContain('marks');
  });
});
