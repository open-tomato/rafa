/**
 * Tests for recording a task session's report into the store, and for
 * the lines the loop prints about a record.
 *
 * Every output is a whole session output, prose and then a `rafa:report`
 * block, recorded under a fresh temporary repo root. What the four report
 * tables hold is read back through `bun:sqlite` directly and never
 * through the writers, so each case reads the disk rather than the
 * answer.
 *
 * Five mutations of `record.ts` were driven against this file alone, with
 * the unmutated file green before and after and the module restored
 * byte-identical, and every one reddened at least one of the 11 cases it
 * then held: triage never written (4 red), findings stored as `done`
 * whatever the outcome (1), refused entries not warned (1), the
 * already-recorded wording flipped (1), and an absence row written beside
 * a report (3).
 *
 * Two more came with the `task_reports` row, driven the same way once the
 * cases reading that table were in, the module restored sha256-identical:
 * the row never written (4 of the 12 cases red) and the row written with a
 * NULL status whatever the report said (3).
 */
import type { TaskReportInput } from './record.js';

import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { Database } from 'bun:sqlite';
import { afterAll, describe, expect, it } from 'bun:test';

import { describeTaskReportRecord, recordTaskReport } from './record.js';

/** A fence, kept out of the template literals. */
const FENCE = '```';

/** A `rafa:report` block holding `lines`. */
function reportBlock(...lines: string[]): string {
  return [`${FENCE}rafa:report`, ...lines, FENCE].join('\n');
}

/** A session output: a line of prose, then each block given. */
function outputOf(...blocks: string[]): string {
  return ['Work finished, the gates are green.', '', ...blocks, ''].join('\n');
}

/** A report with two findings, one blocker and one out-of-scope bug. */
const FULL_REPORT = reportBlock(
  'status: done',
  'feedback: |',
  '  Added the table.',
  'findings:',
  '  - trigger: "when writing the store twice"',
  '    kind: gotcha',
  '    what: "a second write adds nothing"',
  '    cause: "dedupe is per session"',
  '    resolution: "record under a new session id"',
  '    artifact: "skipped: 1"',
  '    signal: silent',
  '  - trigger: "when looking for the store"',
  '    kind: location',
  '    what: "the store lives under .ralph/effort"',
  '    signal: loud',
  'skills_used: []',
  'blockers:',
  '  - what: "LINEAR_API_KEY unset"',
  '    artifact: "401 Unauthorized"',
  'out_of_scope_bugs:',
  '  - what: "the collector double counts"',
  '    artifact: "count mismatch"',
  '    security: false',
);

const tempBase = mkdtempSync(join(tmpdir(), 'rafa-record-'));
let planted = 0;

afterAll(() => {
  rmSync(tempBase, { recursive: true, force: true });
});

/** A repo root of its own, not yet on disk, so no case sees another's. */
function freshRoot(name: string): string {
  planted += 1;
  return join(tempBase, `${planted}-${name}`);
}

/** Some columns of every row of one table, in append order. */
function rowsOf(root: string, table: string, columns: string): Record<string, unknown>[] {
  const db = new Database(join(root, '.ralph', 'effort', 'effort.sqlite'), { readonly: true });
  try {
    return db.query<Record<string, unknown>, []>(`SELECT ${columns} FROM ${table} ORDER BY seq`).all();
  } finally {
    db.close();
  }
}

/** The dispatch most cases record under. */
const DISPATCH = {
  sessionId: 'aaaa-1111',
  planStub: 'phase-0',
  taskLine: 'Wire the report into the loop',
};

/** The columns every report table takes from the dispatch and the loop. */
const PROVENANCE = 'session_id, plan_stub, task_line, outcome';

/** Those columns as the default dispatch fills them. */
const DISPATCHED = {
  session_id: 'aaaa-1111',
  plan_stub: 'phase-0',
  task_line: 'Wire the report into the loop',
};

/** One output under the default dispatch, outcome `done`. */
function inputOf(output: string, overrides: Partial<TaskReportInput> = {}): TaskReportInput {
  return { dispatch: DISPATCH, outcome: 'done', output, ...overrides };
}

describe('recordTaskReport', () => {
  it('stores every list of a report under one dispatch and the loop outcome', () => {
    const root = freshRoot('full');
    const record = recordTaskReport(root, inputOf(outputOf(FULL_REPORT), { outcome: 'blocked' }));
    const stored = { ...DISPATCHED, outcome: 'blocked' };

    expect(record.present).toBe(true);
    expect(rowsOf(root, 'findings', `${PROVENANCE}, what`)).toEqual([
      { ...stored, what: 'a second write adds nothing' },
      { ...stored, what: 'the store lives under .ralph/effort' },
    ]);
    expect(rowsOf(root, 'blockers', `${PROVENANCE}, what`))
      .toEqual([{ ...stored, what: 'LINEAR_API_KEY unset' }]);
    expect(rowsOf(root, 'out_of_scope_bugs', `${PROVENANCE}, what, security`))
      .toEqual([{ ...stored, what: 'the collector double counts', security: 0 }]);
    expect(rowsOf(root, 'report_absences', PROVENANCE)).toEqual([]);

    // The session claimed done and the loop made its task blocked: the
    // one status row holds the two side by side.
    expect(rowsOf(root, 'task_reports', `${PROVENANCE}, status`))
      .toEqual([{ ...stored, status: 'done' }]);
  });

  it('stores an output with no report as one absence row and nothing else', () => {
    const root = freshRoot('absent');
    const record = recordTaskReport(root, inputOf(outputOf(), { outcome: 'failed' }));

    expect(record.present).toBe(false);
    expect(rowsOf(root, 'report_absences', `${PROVENANCE}, reason, block_body`))
      .toEqual([{ ...DISPATCHED, outcome: 'failed', reason: 'no-block', block_body: null }]);
    for (const table of ['findings', 'blockers', 'out_of_scope_bugs', 'task_reports']) {
      expect(rowsOf(root, table, 'id')).toEqual([]);
    }
  });

  it('records a last block it cannot read as an absence, never the report before it', () => {
    const root = freshRoot('replaced');
    const broken = reportBlock('status: done', 'feedback: it broke: twice');
    const record = recordTaskReport(root, inputOf(outputOf(FULL_REPORT, '', broken)));
    const [absence] = rowsOf(root, 'report_absences', 'reason, block_body');

    expect(record.present).toBe(false);
    expect(absence?.['reason']).toBe('malformed-block');
    expect(String(absence?.['block_body'])).toContain('feedback: it broke: twice');
    expect(rowsOf(root, 'findings', 'id')).toEqual([]);
    expect(rowsOf(root, 'task_reports', 'id')).toEqual([]);
  });

  it('stores the status of a report whose lists are all empty as its one row', () => {
    const root = freshRoot('empty-lists');
    const record = recordTaskReport(root, inputOf(outputOf(reportBlock('status: done'))));

    expect(record.present).toBe(true);
    expect(rowsOf(root, 'task_reports', `${PROVENANCE}, status`))
      .toEqual([{ ...DISPATCHED, outcome: 'done', status: 'done' }]);
    for (const table of ['findings', 'blockers', 'out_of_scope_bugs', 'report_absences']) {
      expect(rowsOf(root, table, 'id')).toEqual([]);
    }
  });

  it('stores a report with no usable status as NULL beside the outcome', () => {
    const root = freshRoot('no-status');
    const report = reportBlock('feedback: "the status was left out"');
    recordTaskReport(root, inputOf(outputOf(report), { outcome: 'failed' }));

    // The control: a status the parser reads is stored as written.
    const other = { ...DISPATCH, sessionId: 'bbbb-2222' };
    const blocked = reportBlock('status: blocked');
    recordTaskReport(root, inputOf(outputOf(blocked), { dispatch: other, outcome: 'failed' }));

    expect(rowsOf(root, 'task_reports', 'session_id, status, outcome')).toEqual([
      { session_id: 'aaaa-1111', status: null, outcome: 'failed' },
      { session_id: 'bbbb-2222', status: 'blocked', outcome: 'failed' },
    ]);
  });

  it('adds no row when one session output is recorded twice', () => {
    const root = freshRoot('twice');
    recordTaskReport(root, inputOf(outputOf(FULL_REPORT)));
    const again = recordTaskReport(root, inputOf(outputOf(FULL_REPORT)));
    const other = { ...DISPATCH, sessionId: 'bbbb-2222' };
    recordTaskReport(root, inputOf(outputOf(), { dispatch: other }));
    const absentAgain = recordTaskReport(root, inputOf(outputOf(), { dispatch: other }));

    if (!again.present || absentAgain.present) throw new Error('a fixture output read wrongly');
    expect([again.findings.appended, again.findings.skipped]).toEqual([0, 2]);
    expect([again.triage.blockers.skipped, again.triage.outOfScopeBugs.skipped]).toEqual([1, 1]);
    expect([absentAgain.absence.appended, absentAgain.absence.skipped]).toEqual([0, 1]);
    expect([again.taskReport.appended, again.taskReport.skipped]).toEqual([0, 1]);
    expect(rowsOf(root, 'task_reports', 'session_id')).toEqual([{ session_id: 'aaaa-1111' }]);
    expect(rowsOf(root, 'findings', 'id')).toHaveLength(2);
    expect(rowsOf(root, 'report_absences', 'id')).toHaveLength(1);
  });

  it('throws a refused dispatch, report or not, before writing anything', () => {
    const root = freshRoot('refused');
    const dispatch = { ...DISPATCH, sessionId: '' };

    expect(() => recordTaskReport(root, inputOf(outputOf(FULL_REPORT), { dispatch })))
      .toThrow('nothing written');
    expect(() => recordTaskReport(root, inputOf(outputOf(), { dispatch })))
      .toThrow('nothing written');
    expect(existsSync(root)).toBe(false);
  });
});

describe('describeTaskReportRecord', () => {
  it('sums a clean report up in one note and warns about nothing', () => {
    const root = freshRoot('describe-clean');
    const lines = describeTaskReportRecord(recordTaskReport(root, inputOf(outputOf(FULL_REPORT))));

    expect(lines).toEqual({
      notes: [[
        'Report: status done',
        'findings 2 stored, 0 already held, 0 refused',
        'blockers 1 stored, 0 already held, 0 refused',
        'out-of-scope bugs 1 stored, 0 already held, 0 refused',
      ].join('; ')],
      warnings: [],
    });
  });

  it('counts what the session already held on a second record', () => {
    const root = freshRoot('describe-held');
    recordTaskReport(root, inputOf(outputOf(FULL_REPORT)));
    const lines = describeTaskReportRecord(recordTaskReport(root, inputOf(outputOf(FULL_REPORT))));

    expect(lines.notes[0]).toContain('findings 0 stored, 2 already held, 0 refused');
    expect(lines.notes[0]).toContain('out-of-scope bugs 0 stored, 1 already held, 0 refused');
  });

  it('warns once per report issue and once per entry a writer refused', () => {
    const root = freshRoot('describe-issues');
    const report = reportBlock(
      'status: done',
      'findings:',
      '  - trigger: "a trigger"',
      '    kind: gotcha',
      '    what: "kept by its artifact"',
      '    artifact: "an artifact"',
      '  - kind: pattern',
      '    signal: loud',
    );
    const lines = describeTaskReportRecord(recordTaskReport(root, inputOf(outputOf(report))));

    expect(lines.notes[0]).toContain('findings 1 stored, 0 already held, 1 refused');
    expect(lines.warnings).toHaveLength(4);
    expect(lines.warnings.every((line) => line.startsWith('Report: '))).toBe(true);
    expect(lines.warnings[0]).toContain('findings[0].signal');
    expect(lines.warnings[1]).toContain('findings[1].trigger');
    expect(lines.warnings[2]).toContain('findings[1].what');
    expect(lines.warnings[3]).toContain('findings[1] has no artifact');
    expect(lines.warnings[3]).toContain('not written');
  });

  it('names a report that gives no status', () => {
    const root = freshRoot('describe-status');
    const report = reportBlock('feedback: "done, status left out"');
    const lines = describeTaskReportRecord(recordTaskReport(root, inputOf(outputOf(report))));

    expect(lines.notes[0]?.startsWith('Report: status not given; ')).toBe(true);
    expect(lines.warnings.some((line) => line.includes('status'))).toBe(true);
  });

  it('warns once about an absent report, naming why and that it was recorded', () => {
    const root = freshRoot('describe-absent');
    const first = recordTaskReport(root, inputOf(outputOf()));
    const again = recordTaskReport(root, inputOf(outputOf()));

    if (first.present) throw new Error('an output with no block read as a report');
    expect(first.reading.text).toBe('the session output holds no rafa:report block');
    expect(describeTaskReportRecord(first)).toEqual({
      notes: [],
      warnings: ['No task report: the session output holds no rafa:report block; recorded as telemetry'],
    });
    expect(describeTaskReportRecord(again).warnings).toEqual([
      'No task report: the session output holds no rafa:report block; already recorded for this session',
    ]);
  });
});
