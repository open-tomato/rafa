/**
 * Tests for the epic labels row of `rafa doctor` (`doctor-epics.ts`):
 * the one listing it sends, the two faults it keeps of those
 * `readEpicProblems` answers, the orphans it refuses to report on a
 * board it did not read whole, and the lines it prints.
 *
 * Every case drives a recorded runner of its own, answering the board
 * listing from a literal board and failing every other command, so no
 * case reaches GitHub, spawns `gh`, or reads a repository.
 *
 * ## The controls
 *
 * Each reading that could pass while wrong is paired with one differing
 * in a single thing:
 *
 *  - The fault case runs the faulted board against the same board with
 *    both labels fixed, and holds two faults against none, so a reader
 *    that reported nothing would redden the first half.
 *  - The kinds case runs a board holding only horizon and checklist
 *    faults, and holds `readEpicProblems` answering them on that board
 *    against this row answering none: without it, a board this row
 *    reports nothing about could simply be one with no fault at all.
 *  - The truncation case runs one board under a limit it fills and
 *    under a limit one larger, and holds `unchecked` with no orphan
 *    against the orphan reported.
 *
 * ## Mutations driven
 *
 * Two mutations of `./doctor-epics.ts` were driven against these cases
 * on 2026-09-27, the file run alone on a baseline of 9 pass and restored
 * from a scratch copy verified by sha256: the kind filter dropped, so
 * every problem `readEpicProblems` answers is reported, reddened 6
 * cases; the full-listing guard dropped, so an orphan is reported on a
 * board read only in part, reddened 1.
 */
import type { GhResult, GhRunner } from '../adapters/tracker/github.js';

import { describe, expect, it } from 'bun:test';

import { readEpicProblems } from '../board/epic-problems.js';
import { BOARD_LIST_FIELDS, BOARD_LISTING_LIMIT, parseBoardListing } from '../board/roadmap-board.js';

import { DOCTOR_EPIC_KINDS, EPICS_HEADING, readDoctorEpics, renderDoctorEpics } from './doctor-epics.js';

/** One issue on a literal board: its number, labels and body. */
interface ListedIssue {
  readonly number: number;
  readonly labels: readonly string[];
  readonly body?: string;
}

/** One issue as `gh issue list --json` answers it. */
function rowOf(issue: ListedIssue): Record<string, unknown> {
  return {
    number: issue.number,
    title: `issue ${String(issue.number)}`,
    body: issue.body ?? '',
    state: 'OPEN',
    stateReason: null,
    labels: issue.labels.map((name) => ({ name })),
  };
}

/** A runner answering the board listing with `board`, or with `result` when given, and the argument lists it was handed. */
function fakeGh(board: readonly ListedIssue[], result?: GhResult): { run: GhRunner; calls: () => readonly (readonly string[])[] } {
  const calls: (readonly string[])[] = [];
  const run: GhRunner = (args) => {
    calls.push(args);
    if (!args.includes(BOARD_LIST_FIELDS)) return Promise.resolve({ ok: false, stdout: '', stderr: 'no route' });
    return Promise.resolve(result ?? { ok: true, stdout: JSON.stringify(board.map(rowOf)), stderr: '' });
  };
  return { run, calls: () => calls };
}

/** Epic #1 `epic:auth` and epic #2 `epic:billing`, each with its horizon. */
const EPICS: readonly ListedIssue[] = [
  { number: 1, labels: ['type:epic', 'epic:auth', 'horizon:now'], body: '- [ ] #5\n- [ ] #6\n' },
  { number: 2, labels: ['type:epic', 'epic:billing', 'horizon:next'], body: '- [ ] #5\n' },
];

/** #5 carries both epics' labels and #6 a mistyped slug. */
const FAULTED: readonly ListedIssue[] = [
  ...EPICS,
  { number: 5, labels: ['type:spec', 'epic:auth', 'epic:billing'] },
  { number: 6, labels: ['type:spec', 'epic:atuh'] },
];

/** The same board with each label fixed. */
const FIXED: readonly ListedIssue[] = [
  ...EPICS,
  { number: 5, labels: ['type:spec', 'epic:auth'] },
  { number: 6, labels: ['type:spec', 'epic:auth'] },
];

describe('readDoctorEpics', () => {
  it('sends the one board listing and nothing else', async () => {
    const gh = fakeGh(FIXED);

    await readDoctorEpics({ gh: gh.run });

    expect(gh.calls()).toEqual([
      ['issue', 'list', '--state', 'all', '--limit', String(BOARD_LISTING_LIMIT), '--json', BOARD_LIST_FIELDS],
    ]);
  });

  it('reports an issue with two epic labels and a label no epic carries, where the fixed board reports none', async () => {
    const run = await readDoctorEpics({ gh: fakeGh(FAULTED).run });
    const control = await readDoctorEpics({ gh: fakeGh(FIXED).run });

    expect(run.faults.map((fault) => [fault.kind, fault.issue, fault.slug])).toEqual([
      ['several-epic-labels', 5, 'auth'],
      ['orphan-label', 6, 'atuh'],
    ]);
    expect(run.labelled).toBe(4);
    expect(run.problem).toBe(null);
    expect(run.unchecked).toBe(null);
    expect(control.faults).toEqual([]);
    expect(control.labelled).toBe(4);
  });

  it('keeps only its two kinds, where readEpicProblems answers the horizon and checklist faults of the same board', async () => {
    const board: readonly ListedIssue[] = [
      { number: 1, labels: ['type:epic', 'epic:auth'], body: '- [ ] #7\n' },
      { number: 5, labels: ['type:spec', 'epic:auth'] },
      { number: 7, labels: ['type:spec'] },
    ];
    const listed = parseBoardListing(JSON.stringify(board.map(rowOf)), 'the case\'s listing');

    const run = await readDoctorEpics({ gh: fakeGh(board).run });

    expect(run.faults).toEqual([]);
    expect(readEpicProblems(listed).map((problem) => problem.kind)).toEqual(['horizon', 'unlabelled-checklist', 'unlisted-member']);
    expect([...DOCTOR_EPIC_KINDS]).toEqual(['several-epic-labels', 'orphan-label']);
  });

  it('reports no orphan on a listing that came back full, where one larger limit reports it', async () => {
    const run = await readDoctorEpics({ gh: fakeGh(FAULTED).run, limit: FAULTED.length });
    const control = await readDoctorEpics({ gh: fakeGh(FAULTED).run, limit: FAULTED.length + 1 });

    expect(run.faults.map((fault) => fault.kind)).toEqual(['several-epic-labels']);
    expect(run.unchecked).toBe(
      'the board answered the 4 issues the listing asked for and may hold more, so no epic: label was checked for an epic carrying it',
    );
    expect(control.faults.map((fault) => fault.kind)).toEqual(['several-epic-labels', 'orphan-label']);
    expect(control.unchecked).toBe(null);
  });

  it('answers a failed listing as its problem, never throwing, and one that is not JSON the same way', async () => {
    const failed = await readDoctorEpics({ gh: fakeGh([], { ok: false, stdout: '', stderr: 'HTTP 401' }).run });
    const garbled = await readDoctorEpics({ gh: fakeGh([], { ok: true, stdout: 'not json', stderr: '' }).run });

    expect(failed).toEqual({
      labelled: 0,
      faults: [],
      problem: `board listing: gh issue list --state all --limit 1000 --json ${BOARD_LIST_FIELDS} failed: HTTP 401`,
      unchecked: null,
    });
    expect(garbled.problem).toStartWith('board listing: ');
    expect(garbled.problem).toContain('not JSON');
    expect(garbled.faults).toEqual([]);
  });
});

describe('renderDoctorEpics', () => {
  it('prints nothing for no board and for a board carrying no epic label, where one carrying labels prints the heading', async () => {
    const bare = await readDoctorEpics({ gh: fakeGh([{ number: 5, labels: ['type:spec'] }]).run });
    const labelled = await readDoctorEpics({ gh: fakeGh(FIXED).run });

    expect(renderDoctorEpics(null)).toEqual([]);
    expect(renderDoctorEpics(bare)).toEqual([]);
    expect(renderDoctorEpics(labelled)).toEqual([
      EPICS_HEADING,
      '  4 issues with an epic: label, none with two, every slug one a type:epic issue carries',
    ]);
  });

  it('prints one line per fault in the reader\'s words', async () => {
    const report = await readDoctorEpics({ gh: fakeGh(FAULTED).run });

    expect(renderDoctorEpics(report)).toEqual([
      EPICS_HEADING,
      '  #5 carries 2 epic labels (epic:auth, epic:billing); an issue belongs to one epic, so remove all but one',
      '  #6 carries epic:atuh, which no type:epic issue carries; fix the slug or open the epic',
    ]);
  });

  it('drops the slug claim from the clean line and names why when orphans were not checked', async () => {
    const report = await readDoctorEpics({ gh: fakeGh(FIXED).run, limit: FIXED.length });

    expect(renderDoctorEpics(report)).toEqual([
      EPICS_HEADING,
      '  4 issues with an epic: label, none with two',
      `  ${report.unchecked ?? ''}`,
    ]);
  });

  it('prints the heading and why for a listing that failed', async () => {
    const report = await readDoctorEpics({ gh: fakeGh([], { ok: false, stdout: '', stderr: '' }).run });

    expect(renderDoctorEpics(report)).toEqual([
      EPICS_HEADING,
      '  the epic: labels could not be read: board listing:'
        + ` gh issue list --state all --limit 1000 --json ${BOARD_LIST_FIELDS} failed and wrote nothing`,
    ]);
  });
});
