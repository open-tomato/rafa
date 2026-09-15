/**
 * Tests for the task-report writer and the migration that creates its
 * table.
 *
 * Every store sits under a fresh temporary repo root, and the disk is
 * real. Every reading goes through `bun:sqlite` directly and never
 * through the module, so the columns, the status set and the
 * one-row-per-session rule are spelled here rather than read off the code
 * under test. Each report is `parseReport`'s own answer over an output a
 * session could end with.
 *
 * Twelve mutations of the writer and its migration were driven against
 * this file alone, with the unmutated file green before and after and
 * both modules restored sha256-identical, and every one reddened at least
 * one of its 22 cases: a bare `ON CONFLICT DO NOTHING` (1 red), the
 * status unchecked by the writer (3), the status CHECK dropped (1),
 * `session_id` not UNIQUE (17), status and outcome bound swapped (6), a
 * missing status stored as `done` (3), the table folded into the shipped
 * version-4 entry (1), `skipped` always 0 (1), `status` NOT NULL (4), a
 * row count of 0 passed to `writeSqliteStore` (17), the dispatch
 * unchecked (3), and the version-5 entry removed (17, and 4 in the three
 * suites whose full table lists name the table).
 *
 * The reader's cases came after that grid. Four legs of
 * `readTaskReportTallies` were driven against this file and
 * `effort/report.test.ts`, restored the same way: the tallies ordered
 * otherwise (1 red here, 1 there), every count written as 1 (1), an absent
 * store opened with `create` (1, here alone, since a report over the store
 * it creates still reads empty), and `status` dropped from the GROUP BY.
 * That last leg reddened nothing while the counting case held no plan and
 * outcome under two statuses, SQLite answering one of them for the bare
 * column; with its seventh row it reddens that case.
 */
import type { FindingOutcome, FindingsWriterSeams } from './findings.js';
import type { TaskReportWrite } from './reports.js';
import type { ReportStatus, TaskReport } from '../../report/parse.js';

import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { Database } from 'bun:sqlite';
import { afterAll, describe, expect, it } from 'bun:test';

import { loadConfig } from '../../config-load.js';
import { parseReport, REPORT_STATUSES } from '../../report/parse.js';

import { FINDING_OUTCOMES } from './findings.js';
import { readTaskReportTallies, writeTaskReport } from './reports.js';
import { migrateSchema, SQLITE_MIGRATIONS, SQLITE_SCHEMA_VERSION } from './sqlite.js';

/** A task report row as the table holds it. */
interface StoredReport {
  seq: number;
  id: string;
  session_id: string;
  plan_stub: string | null;
  task_line: string;
  status: string | null;
  outcome: string;
  collected_at: string;
}

/** The table's columns, in order. */
const COLUMNS = [
  'seq',
  'id',
  'session_id',
  'plan_stub',
  'task_line',
  'status',
  'outcome',
  'collected_at',
];

/** A fence, kept out of the template literals. */
const FENCE = '```';

/** A lone high surrogate, built from its code unit. */
const LONE_HIGH = String.fromCharCode(0xd800);

/** A session output ending with a report whose status lines are `statusLines`. */
function outputWith(...statusLines: string[]): string {
  return [
    'Done.',
    '',
    `${FENCE}rafa:report`,
    ...statusLines,
    'feedback: "it went fine"',
    'findings: []',
    'skills_used: []',
    'blockers: []',
    'out_of_scope_bugs: []',
    FENCE,
    '',
  ].join('\n');
}

/** One output per status a row can hold, and the status each one stores. */
const OUTPUTS: readonly (readonly [string, string, ReportStatus | null])[] = [
  ['a done report', outputWith('status: done'), 'done'],
  ['a blocked report', outputWith('status: blocked'), 'blocked'],
  ['a report with no status', outputWith(), null],
  ['a report with an unreadable status', outputWith('status: finished'), null],
];

const tempBase = mkdtempSync(join(tmpdir(), 'rafa-task-reports-'));
let planted = 0;

afterAll(() => {
  rmSync(tempBase, { recursive: true, force: true });
});

/** A repo root of its own, not yet on disk, so no case sees another's. */
function freshRoot(name: string): string {
  planted += 1;
  return join(tempBase, `${planted}-${name}`);
}

/** The store file under a root. */
function storeFile(root: string): string {
  return join(root, '.rafa', 'effort', 'effort.sqlite');
}

/** The store file's bytes, or null when nothing was ever written. */
function readRaw(root: string): Buffer | null {
  const path = storeFile(root);
  return existsSync(path)
    ? readFileSync(path)
    : null;
}

/** Runs one query against the store file, read-only, module uninvolved. */
function rawQuery<T>(root: string, sql: string, ...bindings: string[]): T[] {
  const db = new Database(storeFile(root), { readonly: true });
  try {
    return db.query<T, string[]>(sql).all(...bindings);
  } finally {
    db.close();
  }
}

/** Every table the store file holds, by name. */
function tablesOf(root: string): string[] {
  const sql = 'SELECT name FROM sqlite_master WHERE type = ? ORDER BY name';
  return rawQuery<{ name: string }>(root, sql, 'table').map(({ name }) => name);
}

/** Every task report row, in append order. */
function rowsOf(root: string): StoredReport[] {
  return rawQuery<StoredReport>(root, 'SELECT * FROM task_reports ORDER BY seq');
}

/**
 * Inserts one task report row by hand, bypassing the writer, with every
 * column valid unless overridden.
 */
function rawInsert(root: string, overrides: Partial<StoredReport> = {}): void {
  planted += 1;
  const row = {
    id: `raw-${planted}`,
    session_id: `raw-session-${planted}`,
    plan_stub: null,
    task_line: 'A raw task',
    status: 'done',
    outcome: 'done',
    collected_at: '2026-09-14T00:00:00.000Z',
    ...overrides,
  };
  const names = Object.keys(row);
  const values = Object.values(row).map((value) => value === null
    ? null
    : String(value));
  const holes = names.map(() => '?').join(', ');
  const db = new Database(storeFile(root), { readwrite: true, create: false });
  try {
    const sql = `INSERT INTO task_reports (${names.join(', ')}) VALUES (${holes})`;
    db.query<unknown, (string | null)[]>(sql).run(...values);
  } finally {
    db.close();
  }
}

/** The report `parseReport` answers for an output. Throws for an absence. */
function reportOf(output: string): TaskReport {
  const reading = parseReport(output);
  if (!reading.present) throw new Error(`the fixture output holds no report: ${reading.text}`);
  return reading.report;
}

/** The dispatch most cases write under. */
const DISPATCH = {
  sessionId: 'aaaa-1111',
  planStub: 'phase-1',
  taskLine: 'Store the report status beside the outcome',
};

/** The same task, dispatched again as another session. */
const RETRY = { ...DISPATCH, sessionId: 'bbbb-2222' };

/** A write of a done report under the default dispatch, outcome `done`. */
function writeOf(overrides: Partial<TaskReportWrite> = {}): TaskReportWrite {
  return {
    dispatch: DISPATCH,
    outcome: 'done',
    report: reportOf(outputWith('status: done')),
    ...overrides,
  };
}

/** Ids no other case generates, and a fixed clock. */
function seams(prefix: string): Required<FindingsWriterSeams> {
  let count = 0;
  return {
    now: () => new Date('2026-09-14T10:00:00.000Z'),
    newId: () => {
      count += 1;
      return `${prefix}-${count}`;
    },
  };
}

/** The message a call throws. Fails the case when it throws nothing. */
function refusalOf(call: () => unknown): string {
  try {
    call();
  } catch (error) {
    return error instanceof Error
      ? error.message
      : String(error);
  }
  throw new Error('expected the call to throw');
}

describe('the task reports migration', () => {
  it('creates the table with its columns, in order, at the last version', () => {
    const root = freshRoot('columns');
    const result = writeTaskReport(root, writeOf(), seams('columns'));
    const columns = 'SELECT name FROM pragma_table_info(?) ORDER BY cid';

    expect(result.path).toBe(storeFile(root));
    expect(result.path.startsWith(`${tempBase}/`)).toBe(true);
    expect(rawQuery<{ name: string }>(root, columns, 'task_reports').map(({ name }) => name))
      .toEqual(COLUMNS);
    expect(tablesOf(root))
      .toEqual(['blockers', 'commits', 'findings', 'out_of_scope_bugs', 'report_absences', 'sessions', 'task_reports']);
    expect(rawQuery(root, 'PRAGMA user_version'))
      .toEqual([{ user_version: SQLITE_SCHEMA_VERSION }]);
  });

  it('brings a version-4 store forward through a new entry, keeping the rows it holds', () => {
    const root = freshRoot('from-v4');
    mkdirSync(dirname(storeFile(root)), { recursive: true });
    const db = new Database(storeFile(root), { create: true, readwrite: true });
    migrateSchema(db, storeFile(root), SQLITE_MIGRATIONS.slice(0, 4));
    db.run(
      'INSERT INTO report_absences (id, session_id, task_line, reason, detail, outcome, collected_at)'
        + ' VALUES (?, ?, ?, ?, ?, ?, ?)',
      ['a-1', 's-1', 'A task', 'no-block', 'no block', 'failed', '2026-09-14T00:00:00.000Z'],
    );
    db.close();

    // The control: the first four entries make every earlier table and no
    // task reports table, so the table this write fills came from a later
    // entry, and was not added to a shipped one.
    expect(tablesOf(root))
      .toEqual(['blockers', 'commits', 'findings', 'out_of_scope_bugs', 'report_absences', 'sessions']);

    const result = writeTaskReport(root, writeOf(), seams('from-v4'));

    expect([result.appended, result.skipped]).toEqual([1, 0]);
    expect(rawQuery(root, 'PRAGMA user_version'))
      .toEqual([{ user_version: SQLITE_SCHEMA_VERSION }]);
    expect(rawQuery(root, 'SELECT id FROM report_absences')).toEqual([{ id: 'a-1' }]);
    expect(rowsOf(root).map(({ id }) => id)).toEqual(['from-v4-1']);
  });

  it('refuses a blank id or session, a missing column, or a repeated session in the schema itself', () => {
    const root = freshRoot('schema');
    writeTaskReport(root, writeOf(), seams('schema'));

    // The control: a row with nothing wrong in it goes in, so each
    // refusal below is its own column's.
    expect(() => rawInsert(root)).not.toThrow();
    expect(() => rawInsert(root, { id: '' })).toThrow(/CHECK constraint failed/);
    expect(() => rawInsert(root, { session_id: '' })).toThrow(/CHECK constraint failed/);
    for (const column of ['task_line', 'outcome', 'collected_at'] as const) {
      expect(() => rawInsert(root, { [column]: null as never }))
        .toThrow(`NOT NULL constraint failed: task_reports.${column}`);
    }
    expect(() => rawInsert(root, { session_id: DISPATCH.sessionId }))
      .toThrow(/UNIQUE constraint failed: task_reports.session_id/);
  });

  it('holds exactly the statuses the report parser answers, and NULL', () => {
    const root = freshRoot('closed-status');
    writeTaskReport(root, writeOf(), seams('closed-status'));

    for (const status of REPORT_STATUSES) {
      expect(() => rawInsert(root, { status })).not.toThrow();
    }
    expect(() => rawInsert(root, { status: null })).not.toThrow();
    expect(() => rawInsert(root, { status: 'Done' })).toThrow(/CHECK constraint failed/);
    expect(() => rawInsert(root, { status: 'partial' })).toThrow(/CHECK constraint failed/);
    expect(() => rawInsert(root, { status: '' })).toThrow(/CHECK constraint failed/);
  });

  it('leaves outcome open, so a CI verdict can join it', () => {
    const root = freshRoot('open-outcome');
    writeTaskReport(root, writeOf(), seams('open-outcome'));

    expect(() => rawInsert(root, { outcome: 'ci-failed' })).not.toThrow();
  });
});

describe('writeTaskReport rows', () => {
  it.each(OUTPUTS)('stores %s as parseReport answered it', (name, output, status) => {
    const root = freshRoot('status');
    const report = reportOf(output);

    // The control: the parser really answers this status for the output.
    expect(report.status).toBe(status);

    const result = writeTaskReport(root, writeOf({ report, outcome: 'failed' }), seams(name));

    expect(result).toEqual({ path: storeFile(root), appended: 1, skipped: 0 });
    expect(rowsOf(root)).toEqual([{
      seq: 1,
      id: `${name}-1`,
      session_id: 'aaaa-1111',
      plan_stub: 'phase-1',
      task_line: 'Store the report status beside the outcome',
      status,
      outcome: 'failed',
      collected_at: '2026-09-14T10:00:00.000Z',
    }]);
  });

  it('stores every status beside every outcome, so the two can disagree', () => {
    const root = freshRoot('pairs');
    const statuses: readonly (ReportStatus | null)[] = [...REPORT_STATUSES, null];
    const pairs = statuses.flatMap((status) => FINDING_OUTCOMES.map((outcome) => ({ status, outcome })));
    for (const [index, pair] of pairs.entries()) {
      const dispatch = { ...DISPATCH, sessionId: `pair-${index}` };
      writeTaskReport(root, { dispatch, outcome: pair.outcome, report: { status: pair.status } });
    }

    expect(pairs).toHaveLength(9);
    expect(rowsOf(root).map((row) => [row.status, row.outcome]))
      .toEqual(pairs.map((pair) => [pair.status, pair.outcome]));
  });

  it('stores a dispatch with no plan stub as NULL', () => {
    const root = freshRoot('null-stub');
    const dispatch = { ...DISPATCH, planStub: null };
    writeTaskReport(root, writeOf({ dispatch }), seams('null-stub'));

    expect(rowsOf(root).map(({ plan_stub }) => plan_stub)).toEqual([null]);
  });

  it('writes into the SQLite file when the config selects the NDJSON backend', () => {
    const root = freshRoot('ndjson-selected');
    mkdirSync(join(root, '.rafa'), { recursive: true });
    writeFileSync(join(root, '.rafa', 'config.yaml'), 'store: ndjson\n');

    // The control: the planted config really selects the other backend.
    expect(loadConfig({ root, home: join(tempBase, 'home') }, {}, () => undefined).config.store)
      .toBe('ndjson');

    writeTaskReport(root, writeOf(), seams('ndjson-selected'));

    expect(readdirSync(dirname(storeFile(root)))).toEqual(['effort.sqlite']);
    expect(rowsOf(root).map(({ id }) => id)).toEqual(['ndjson-selected-1']);
  });
});

describe('readTaskReportTallies', () => {
  it('answers none and creates nothing when no store exists', () => {
    const root = freshRoot('tallies-absent');

    expect(readTaskReportTallies(root)).toEqual([]);
    expect(existsSync(root)).toBe(false);
  });

  it('counts the rows sharing a plan, a status and an outcome, NULL first in each', () => {
    const root = freshRoot('tallies');
    const writes: readonly (readonly [string, string | null, ReportStatus | null, FindingOutcome])[] = [
      ['s1', 'phase-1', 'done', 'done'],
      ['s2', 'phase-1', 'done', 'done'],
      ['s3', 'phase-1', 'done', 'blocked'],
      ['s4', 'phase-1', null, 'failed'],
      ['s5', null, 'blocked', 'blocked'],
      ['s6', 'phase-0', 'blocked', 'blocked'],
      ['s7', 'phase-1', 'blocked', 'blocked'],
    ];
    for (const [sessionId, planStub, status, outcome] of writes) {
      writeTaskReport(root, { dispatch: { ...DISPATCH, sessionId, planStub }, outcome, report: { status } });
    }

    // The control, read without the module: seven rows went in. `phase-1`
    // holds two statuses under the outcome `blocked`, so a tally that did
    // not group by status would merge them into one row.
    expect(rowsOf(root)).toHaveLength(7);
    expect(readTaskReportTallies(root)).toEqual([
      { planStub: null, status: 'blocked', outcome: 'blocked', reports: 1 },
      { planStub: 'phase-0', status: 'blocked', outcome: 'blocked', reports: 1 },
      { planStub: 'phase-1', status: null, outcome: 'failed', reports: 1 },
      { planStub: 'phase-1', status: 'blocked', outcome: 'blocked', reports: 1 },
      { planStub: 'phase-1', status: 'done', outcome: 'blocked', reports: 1 },
      { planStub: 'phase-1', status: 'done', outcome: 'done', reports: 2 },
    ]);
  });

  it('leaves a store at the last version byte-identical', () => {
    const root = freshRoot('tallies-bytes');
    writeTaskReport(root, writeOf(), seams('tallies-bytes'));
    const before = readRaw(root);

    expect(readTaskReportTallies(root)).toHaveLength(1);
    expect(before).not.toBeNull();
    expect(readRaw(root)).toEqual(before);
  });

  it('refuses a store past the last version, as a write does', () => {
    const root = freshRoot('tallies-newer');
    writeTaskReport(root, writeOf(), seams('tallies-newer'));

    // The control: the same store reads before its version is moved.
    expect(readTaskReportTallies(root)).toHaveLength(1);

    const db = new Database(storeFile(root), { readwrite: true });
    db.run(`PRAGMA user_version = ${SQLITE_SCHEMA_VERSION + 1}`);
    db.close();
    const before = readRaw(root);

    expect(() => readTaskReportTallies(root)).toThrow(`past the ${SQLITE_SCHEMA_VERSION} this rafa knows`);
    expect(readRaw(root)).toEqual(before);
  });
});

describe('one task report row per session', () => {
  it('adds nothing for a session already recorded, whatever the second says', () => {
    const root = freshRoot('repeat');
    writeTaskReport(root, writeOf(), seams('repeat-first'));
    const second = writeOf({ outcome: 'failed', report: { status: 'blocked' } });
    const again = writeTaskReport(root, second, seams('repeat-second'));

    expect([again.appended, again.skipped]).toEqual([0, 1]);
    expect(rowsOf(root).map(({ id, status, outcome }) => [id, status, outcome]))
      .toEqual([['repeat-first-1', 'done', 'done']]);
  });

  it('records two sessions of one task apart', () => {
    const root = freshRoot('two-sessions');
    writeTaskReport(root, writeOf(), seams('two-first'));
    const again = writeTaskReport(root, writeOf({ dispatch: RETRY }), seams('two-second'));

    expect([again.appended, again.skipped]).toEqual([1, 0]);
    expect(rowsOf(root).map(({ session_id }) => session_id)).toEqual(['aaaa-1111', 'bbbb-2222']);
  });

  it('throws on an id generated twice rather than absorbing it', () => {
    const root = freshRoot('id-repeat');
    writeTaskReport(root, writeOf(), { newId: () => 'same' });

    expect(() => writeTaskReport(root, writeOf({ dispatch: RETRY }), { newId: () => 'same' }))
      .toThrow('UNIQUE constraint failed: task_reports.id');
    expect(rowsOf(root)).toHaveLength(1);
  });
});

describe('what a task report write refuses', () => {
  const refusals: readonly (readonly [string, () => TaskReportWrite, string])[] = [
    [
      'an empty session id',
      () => writeOf({ dispatch: { ...DISPATCH, sessionId: '' } }),
      'has session id "", not a non-empty string',
    ],
    [
      'an outcome outside the set',
      () => writeOf({ outcome: 'skipped' as never }),
      'has outcome "skipped", not one of done, blocked, failed',
    ],
    [
      'a plan stub holding a lone surrogate',
      () => writeOf({ dispatch: { ...DISPATCH, planStub: `phase${LONE_HIGH}` } }),
      'has a plan stub holding a lone UTF-16 surrogate',
    ],
    [
      'a status outside the set',
      () => writeOf({ report: { status: 'partial' as never } }),
      'has status "partial", not null or one of done, blocked',
    ],
    [
      'a status that is not a string',
      () => writeOf({ report: { status: 7 as never } }),
      'has status 7, not null or one of done, blocked',
    ],
  ];

  it.each(refusals)('refuses %s whole, creating nothing', (_name, writeFor, message) => {
    const root = freshRoot('refused');
    const refusal = refusalOf(() => writeTaskReport(root, writeFor()));

    expect(refusal).toContain(message);
    expect(refusal.startsWith('effort store: task report write ')).toBe(true);
    expect(refusal.endsWith('; nothing written')).toBe(true);
    expect(existsSync(root)).toBe(false);
  });

  it('leaves a store that exists byte-identical when it refuses', () => {
    const root = freshRoot('refused-existing');
    writeTaskReport(root, writeOf(), seams('refused-existing'));
    const before = readRaw(root);
    const refused = writeOf({ dispatch: RETRY, report: { status: 'partial' as never } });

    // The control: the same write with a status in the set changes the
    // file, so an unchanged file below is the refusal's doing.
    const control = freshRoot('refused-existing-control');
    writeTaskReport(control, writeOf(), seams('refused-existing'));
    const controlBefore = readRaw(control);
    writeTaskReport(control, { ...refused, report: { status: 'blocked' } }, seams('control-2'));
    expect(readRaw(control)).not.toEqual(controlBefore);

    expect(() => writeTaskReport(root, refused)).toThrow('nothing written');
    expect(readRaw(root)).toEqual(before);
  });

  it('refuses a store past the last version, touching nothing', () => {
    const root = freshRoot('newer');
    writeTaskReport(root, writeOf(), seams('newer'));
    const db = new Database(storeFile(root), { readwrite: true });
    db.run(`PRAGMA user_version = ${SQLITE_SCHEMA_VERSION + 1}`);
    db.close();
    const before = readRaw(root);

    expect(() => writeTaskReport(root, writeOf({ dispatch: RETRY }), seams('newer-2')))
      .toThrow(`past the ${SQLITE_SCHEMA_VERSION} this rafa knows`);
    expect(readRaw(root)).toEqual(before);
  });
});
