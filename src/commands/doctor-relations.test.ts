/**
 * Tests for the relationships row of `rafa doctor`
 * (`doctor-relations.ts`): the truncated `blockedBy` lists of open
 * issues and the truncated `subIssues` lists of epics, read through the
 * `native` adapter over one listing, and the `Relationships:` lines.
 *
 * Every case drives a recorded runner answering `gh repo view` and a
 * listing thunk answering a literal native board, so no case reaches
 * GitHub or spawns `gh`. Each truncated reading is paired with the same
 * board read whole, the control that shows the row could have stayed
 * quiet.
 */
import type { GhResult, GhRunner } from '../adapters/tracker/github.js';
import type { BoardIssue, BoardListing } from '../board/roadmap-board.js';

import { describe, expect, it } from 'bun:test';

import { parseBoardListing } from '../board/roadmap-board.js';

import {
  readDoctorRelations,
  RELATIONS_HEADING,
  renderDoctorRelations,
  truncationMessage,
} from './doctor-relations.js';
import { NATIVE_MODE } from './epic/move-native.js';

/** The board's own repository. */
const REPOSITORY = 'acme/board';

/** The repository read, as the recorder spells it. */
const REPO_VIEW = 'repo view --json nameWithOwner';

/** A link node naming issue `number` on the board, as `gh` writes it. */
function node(number: number, state: 'OPEN' | 'CLOSED' = 'OPEN'): object {
  return { number, title: `Issue ${String(number)}`, state, url: `https://github.com/${REPOSITORY}/issues/${String(number)}` };
}

/** A list of link nodes, as `gh` writes one, `total` defaulting to the node count. */
function links(nodes: readonly object[], total: number = nodes.length): object {
  return { nodes, totalCount: total };
}

/** The fields a row may set. */
interface RowFields {
  readonly state?: 'OPEN' | 'CLOSED';
  readonly epic?: boolean;
  readonly parent?: number;
  readonly blockedBy?: readonly object[];
  readonly blockedTotal?: number;
  readonly subIssues?: readonly object[];
  readonly subTotal?: number;
}

/** One issue as `gh issue list --json <native fields>` writes it. */
function row(number: number, fields: RowFields = {}): object {
  const state = fields.state ?? 'OPEN';
  const subIssues = fields.subIssues ?? [];
  return {
    number,
    title: `Issue ${String(number)}`,
    body: '',
    state,
    stateReason: state === 'CLOSED'
      ? 'COMPLETED'
      : null,
    labels: fields.epic === true
      ? [{ name: 'type:epic' }]
      : [],
    parent: fields.parent === undefined
      ? null
      : node(fields.parent),
    blockedBy: links(fields.blockedBy ?? [], fields.blockedTotal),
    blocking: links([]),
    subIssuesSummary: { total: fields.subTotal ?? subIssues.length, completed: 0, percentCompleted: 0 },
    subIssues: links(subIssues, fields.subTotal),
  };
}

/** `rows` parsed as the native listing parses them. */
function parsed(rows: readonly object[]): readonly BoardIssue[] {
  return parseBoardListing(JSON.stringify(rows), 'gh issue list', 'native');
}

/** A listing answering `rows`, counting how often it was read. */
function listingOf(rows: readonly object[]): { listing: BoardListing; reads: () => number } {
  let reads = 0;
  const listing: BoardListing = () => {
    reads += 1;
    return Promise.resolve(parsed(rows));
  };
  return { listing, reads: () => reads };
}

/** A runner answering the repository read with `repo`, recording every argv. */
function fakeGh(repo: GhResult = { ok: true, stdout: JSON.stringify({ nameWithOwner: REPOSITORY }), stderr: '' }): {
  run: GhRunner;
  ran: () => readonly string[];
} {
  const ran: string[] = [];
  const run: GhRunner = (args) => {
    const line = args.join(' ');
    ran.push(line);
    return Promise.resolve(line === REPO_VIEW
      ? repo
      : { ok: false, stdout: '', stderr: `no route for ${line}` });
  };
  return { run, ran: () => ran };
}

/**
 * A board with an epic #1 holding #5 and #6, #5 waiting on #6, and a
 * closed #7 waiting on #6. `truncated` makes #5's blockers and #1's
 * sub-issues longer than `gh` answered, and #7's blockers too.
 */
function board(truncated: boolean): readonly object[] {
  const past = (total: number): number | undefined => truncated
    ? total
    : undefined;
  return [
    row(1, { epic: true, subIssues: [node(5), node(6)], subTotal: past(130) }),
    row(5, { parent: 1, blockedBy: [node(6)], blockedTotal: past(57) }),
    row(6, { parent: 1 }),
    row(7, { state: 'CLOSED', blockedBy: [node(6)], blockedTotal: past(60) }),
  ];
}

describe('readDoctorRelations', () => {
  it('names the open issue and the epic whose lists were truncated, where the control board reads whole', async () => {
    const truncated = await readDoctorRelations({ gh: fakeGh().run, listing: listingOf(board(true)).listing });
    const control = await readDoctorRelations({ gh: fakeGh().run, listing: listingOf(board(false)).listing });

    expect(truncated).toEqual({
      relationships: 'native',
      blocked: 1,
      epics: 1,
      truncated: [
        { kind: 'blockers', issue: 5, answered: 1, total: 57 },
        { kind: 'sub-issues', epic: 1, total: 130 },
      ],
      problem: null,
    });
    expect(control).toEqual({ relationships: 'native', blocked: 1, epics: 1, truncated: [], problem: null });
  });

  it('never names a closed issue, whose blockers hold nothing back', async () => {
    const report = await readDoctorRelations({ gh: fakeGh().run, listing: listingOf(board(true)).listing });

    expect(report.truncated.some((each) => each.kind === 'blockers' && each.issue === 7)).toBe(false);
  });

  it('reads the listing once and the repository once, sending no other gh command', async () => {
    const gh = fakeGh();
    const { listing, reads } = listingOf(board(true));

    await readDoctorRelations({ gh: gh.run, listing });

    expect(reads()).toBe(1);
    expect(gh.ran()).toEqual([REPO_VIEW]);
  });

  it('answers a failed listing as its problem, reading no repository', async () => {
    const gh = fakeGh();
    const listing: BoardListing = () => Promise.reject(new Error('board listing: gh issue list failed: offline'));

    const report = await readDoctorRelations({ gh: gh.run, listing });

    expect(report).toEqual({
      relationships: 'native',
      blocked: 0,
      epics: 0,
      truncated: [],
      problem: 'board listing: gh issue list failed: offline',
    });
    expect(gh.ran()).toEqual([]);
  });

  it('answers a failed repository read as its problem, never throwing', async () => {
    const gh = fakeGh({ ok: false, stdout: '', stderr: 'not a repository' });

    const report = await readDoctorRelations({ gh: gh.run, listing: listingOf(board(true)).listing });

    expect(report.problem).toBe('gh repo view --json nameWithOwner failed: not a repository');
    expect(report.truncated).toEqual([]);
  });

  it('refuses a labels-mode listing as a problem naming board.relationships', async () => {
    const labelsRow = { number: 3, title: 'x', body: '', state: 'OPEN', stateReason: null, labels: [] };
    const listing: BoardListing = () => Promise.resolve(parseBoardListing(JSON.stringify([labelsRow]), 'gh issue list', 'labels'));

    const report = await readDoctorRelations({ gh: fakeGh().run, listing });

    expect(report.problem).toContain('board.relationships');
  });
});

describe('renderDoctorRelations', () => {
  it('writes the heading and one sentence per truncated list', async () => {
    const report = await readDoctorRelations({ gh: fakeGh().run, listing: listingOf(board(true)).listing });

    expect(renderDoctorRelations(report)).toEqual([
      RELATIONS_HEADING,
      '  #5: GitHub holds 57 blockers and gh answered 1, so it reads as waiting whatever the rest hold',
      '  epic #1: GitHub holds 130 sub-issues, more than gh answers in order,'
        + ' so the members past them read after the others in number order',
    ]);
  });

  it('writes one line counting a board whose lists all read whole', async () => {
    const report = await readDoctorRelations({ gh: fakeGh().run, listing: listingOf(board(false)).listing });

    expect(renderDoctorRelations(report)).toEqual([
      RELATIONS_HEADING,
      '  1 open issue with blockers and 1 epic with sub-issues, every list read whole',
    ]);
  });

  it('writes nothing for a board with no blocker and no sub-issue, or for no reading', async () => {
    const report = await readDoctorRelations({ gh: fakeGh().run, listing: listingOf([row(1, { epic: true }), row(2)]).listing });

    expect(report.problem).toBe(null);
    expect(renderDoctorRelations(report)).toEqual([]);
    expect(renderDoctorRelations(null)).toEqual([]);
  });

  it('writes the heading and the problem, naming the mode, for a reading that failed', () => {
    const lines = renderDoctorRelations({ relationships: 'native', blocked: 0, epics: 0, truncated: [], problem: 'offline' });

    expect(lines).toEqual([RELATIONS_HEADING, `  the ${NATIVE_MODE} relationships could not be read: offline`]);
  });

  it('counts one blocker and one sub-issue in the singular', () => {
    expect(truncationMessage({ kind: 'blockers', issue: 4, answered: 0, total: 1 })).toBe(
      '#4: GitHub holds 1 blocker and gh answered 0, so it reads as waiting whatever the rest hold',
    );
    expect(truncationMessage({ kind: 'sub-issues', epic: 2, total: 1 })).toContain('GitHub holds 1 sub-issue,');
  });
});
