/**
 * Tests for the report-absence writer and the migration that creates its
 * table.
 *
 * Every store sits under a fresh temporary repo root, and the disk is
 * real. Every reading goes through `bun:sqlite` directly and never
 * through the module, so the columns and the one-row-per-session rule
 * are spelled here rather than read off the code under test. Each
 * absence is `parseReport`'s own answer over an output a session could
 * end with, one output per reason.
 *
 * Seven mutations of the writer and its migration were driven against
 * this file alone, with the unmutated file green before and after and
 * both modules restored byte-identical, and every one reddened at least
 * one of its 28 cases: a bare `ON CONFLICT DO NOTHING` (1 red), the
 * reason unchecked (1), the block body dropped (4), the detail's text
 * checks skipped (3), a surrogate body accepted (1), `session_id` not
 * UNIQUE in the migration (18), and the reason closed by a CHECK (1).
 */
import type { ReportAbsenceWrite } from './absences.js';
import type { FindingsWriterSeams } from './findings.js';
import type { ReportAbsenceReason, ReportAbsent } from '../../report/parse.js';

import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { Database } from 'bun:sqlite';
import { afterAll, describe, expect, it } from 'bun:test';

import { parseReport } from '../../report/parse.js';

import { REPORT_ABSENCE_REASONS, writeReportAbsence } from './absences.js';
import { FINDING_OUTCOMES } from './findings.js';
import { migrateSchema, SQLITE_MIGRATIONS, SQLITE_SCHEMA_VERSION } from './sqlite.js';

/** An absence row as the table holds it. */
interface StoredAbsence {
  seq: number;
  id: string;
  session_id: string;
  plan_stub: string | null;
  task_line: string;
  reason: string;
  detail: string;
  block_body: string | null;
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
  'reason',
  'detail',
  'block_body',
  'outcome',
  'collected_at',
];

/** A fence, kept out of the template literals. */
const FENCE = '```';

/** A lone high surrogate, built from its code unit. */
const LONE_HIGH = String.fromCharCode(0xd800);

/** One output per absence reason, each ending the way a session might. */
const OUTPUTS: Readonly<Record<ReportAbsenceReason, string>> = {
  'no-block': 'Done. The report was left out.\n',
  'unclosed-block': ['Done.', '', `${FENCE}rafa:report`, 'status: done', 'findings:', ''].join('\n'),
  'malformed-block': [
    'Done.',
    '',
    `${FENCE}rafa:report`,
    'status: done',
    'feedback: it broke: twice',
    FENCE,
    '',
  ].join('\n'),
};

const tempBase = mkdtempSync(join(tmpdir(), 'rafa-absences-'));
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
  return join(root, '.ralph', 'effort', 'effort.sqlite');
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

/** Every absence row, in append order. */
function rowsOf(root: string): StoredAbsence[] {
  return rawQuery<StoredAbsence>(root, 'SELECT * FROM report_absences ORDER BY seq');
}

/**
 * Inserts one absence row by hand, bypassing the writer, with every
 * column valid unless overridden.
 */
function rawInsert(root: string, overrides: Partial<StoredAbsence> = {}): void {
  planted += 1;
  const row = {
    id: `raw-${planted}`,
    session_id: `raw-session-${planted}`,
    plan_stub: null,
    task_line: 'A raw task',
    reason: 'no-block',
    detail: 'a raw detail',
    block_body: null,
    outcome: 'done',
    collected_at: '2026-09-13T00:00:00.000Z',
    ...overrides,
  };
  const names = Object.keys(row);
  const values = Object.values(row).map((value) => value === null
    ? null
    : String(value));
  const holes = names.map(() => '?').join(', ');
  const db = new Database(storeFile(root), { readwrite: true, create: false });
  try {
    const sql = `INSERT INTO report_absences (${names.join(', ')}) VALUES (${holes})`;
    db.query<unknown, (string | null)[]>(sql).run(...values);
  } finally {
    db.close();
  }
}

/** The absence `parseReport` answers for an output. Throws for a report. */
function absenceOf(output: string): ReportAbsent {
  const reading = parseReport(output);
  if (reading.present) throw new Error('the fixture output holds a readable report');
  return reading;
}

/** The dispatch most cases write under. */
const DISPATCH = {
  sessionId: 'aaaa-1111',
  planStub: 'phase-0',
  taskLine: 'Wire the report into the loop',
};

/** The same task, dispatched again as another session. */
const RETRY = { ...DISPATCH, sessionId: 'bbbb-2222' };

/** A write of one reason's absence under the default dispatch, outcome `done`. */
function writeOf(
  reason: ReportAbsenceReason = 'no-block',
  overrides: Partial<ReportAbsenceWrite> = {},
): ReportAbsenceWrite {
  return { dispatch: DISPATCH, outcome: 'done', absence: absenceOf(OUTPUTS[reason]), ...overrides };
}

/** A malformed-block write whose absence has some fields replaced. */
function withAbsence(overrides: Record<string, unknown>): ReportAbsenceWrite {
  const absence = { ...absenceOf(OUTPUTS['malformed-block']), ...overrides };
  return writeOf('malformed-block', { absence: absence as ReportAbsent });
}

/** A malformed-block write whose block carries `body` instead. */
function withBody(body: unknown): ReportAbsenceWrite {
  const absence = absenceOf(OUTPUTS['malformed-block']);
  if (absence.block === null) throw new Error('the malformed fixture carries no block');
  return withAbsence({ block: { ...absence.block, body } });
}

/** Ids no other case generates, and a fixed clock. */
function seams(prefix: string): Required<FindingsWriterSeams> {
  let count = 0;
  return {
    now: () => new Date('2026-09-13T10:00:00.000Z'),
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

describe('the report absences migration', () => {
  it('creates the table with its columns, in order, at the last version', () => {
    const root = freshRoot('columns');
    writeReportAbsence(root, writeOf(), seams('columns'));
    const columns = 'SELECT name FROM pragma_table_info(?) ORDER BY cid';
    const tables = 'SELECT name FROM sqlite_master WHERE type = ? ORDER BY name';

    expect(rawQuery<{ name: string }>(root, columns, 'report_absences').map(({ name }) => name))
      .toEqual(COLUMNS);
    expect(rawQuery<{ name: string }>(root, tables, 'table').map(({ name }) => name))
      .toEqual(['blockers', 'commits', 'findings', 'out_of_scope_bugs', 'report_absences', 'sessions', 'task_reports']);
    expect(rawQuery(root, 'PRAGMA user_version'))
      .toEqual([{ user_version: SQLITE_SCHEMA_VERSION }]);
  });

  it('brings a version-3 store forward, keeping the rows it holds', () => {
    const root = freshRoot('from-v3');
    mkdirSync(dirname(storeFile(root)), { recursive: true });
    const db = new Database(storeFile(root), { create: true, readwrite: true });
    migrateSchema(db, storeFile(root), SQLITE_MIGRATIONS.slice(0, 3));
    db.run(
      'INSERT INTO blockers (id, session_id, task_line, what, outcome, collected_at)'
        + ' VALUES (?, ?, ?, ?, ?, ?)',
      ['b-1', 's-1', 'A task', 'a blocker', 'done', '2026-09-13T00:00:00.000Z'],
    );
    db.close();

    const result = writeReportAbsence(root, writeOf(), seams('from-v3'));

    expect([result.appended, result.skipped]).toEqual([1, 0]);
    expect(rawQuery(root, 'PRAGMA user_version'))
      .toEqual([{ user_version: SQLITE_SCHEMA_VERSION }]);
    expect(rawQuery(root, 'SELECT id FROM blockers')).toEqual([{ id: 'b-1' }]);
    expect(rowsOf(root).map(({ id }) => id)).toEqual(['from-v3-1']);
  });

  it('refuses a blank id, session, reason or detail in the schema itself', () => {
    const root = freshRoot('schema');
    writeReportAbsence(root, writeOf(), seams('schema'));

    // The control: a row with nothing wrong in it goes in, so each
    // refusal below is its own column's.
    expect(() => rawInsert(root)).not.toThrow();
    expect(() => rawInsert(root, { id: '' })).toThrow(/CHECK constraint failed/);
    expect(() => rawInsert(root, { session_id: '' })).toThrow(/CHECK constraint failed/);
    expect(() => rawInsert(root, { reason: '' })).toThrow(/CHECK constraint failed/);
    expect(() => rawInsert(root, { detail: '' })).toThrow(/CHECK constraint failed/);
    expect(() => rawInsert(root, { detail: null as never }))
      .toThrow(/NOT NULL constraint failed: report_absences.detail/);
    expect(() => rawInsert(root, { session_id: DISPATCH.sessionId }))
      .toThrow(/UNIQUE constraint failed: report_absences.session_id/);
  });

  it('leaves reason and outcome open, so either set can grow', () => {
    const root = freshRoot('open-sets');
    writeReportAbsence(root, writeOf(), seams('open-sets'));

    expect(() => rawInsert(root, { reason: 'empty-output' })).not.toThrow();
    expect(() => rawInsert(root, { outcome: 'ci-failed' })).not.toThrow();
  });
});

describe('writeReportAbsence rows', () => {
  it('has an output for every reason it may record', () => {
    expect([...REPORT_ABSENCE_REASONS].sort())
      .toEqual(['malformed-block', 'no-block', 'unclosed-block']);
    for (const reason of REPORT_ABSENCE_REASONS) {
      expect(absenceOf(OUTPUTS[reason]).reason).toBe(reason);
    }
  });

  it.each([...REPORT_ABSENCE_REASONS])('stores a %s absence as parseReport answered it', (reason) => {
    const root = freshRoot(`reason-${reason}`);
    const write = writeOf(reason);
    const result = writeReportAbsence(root, write, seams(`reason-${reason}`));

    expect(result).toEqual({ path: storeFile(root), appended: 1, skipped: 0 });
    expect(rowsOf(root)).toEqual([{
      seq: 1,
      id: `reason-${reason}-1`,
      session_id: 'aaaa-1111',
      plan_stub: 'phase-0',
      task_line: 'Wire the report into the loop',
      reason,
      detail: write.absence.text,
      block_body: write.absence.block?.body ?? null,
      outcome: 'done',
      collected_at: '2026-09-13T10:00:00.000Z',
    }]);
  });

  it('keeps no body for no block, and the unread body of any other', () => {
    const root = freshRoot('bodies');
    writeReportAbsence(root, writeOf('no-block'), seams('bodies-none'));
    const malformed = writeOf('malformed-block', { dispatch: RETRY });
    writeReportAbsence(root, malformed, seams('bodies-malformed'));
    const [none, unread] = rowsOf(root);

    expect(none?.block_body).toBeNull();
    expect(unread?.block_body).toContain('feedback: it broke: twice');
    expect(unread?.detail).toContain('not valid YAML');
  });

  it('stores an empty block body as empty, not as NULL', () => {
    const root = freshRoot('empty-body');
    const absence = absenceOf([`${FENCE}rafa:report`, FENCE, ''].join('\n'));

    // The control: the parser really answers an empty body here.
    expect(absence.reason).toBe('malformed-block');
    expect(absence.block?.body).toBe('');

    writeReportAbsence(root, writeOf('no-block', { absence }), seams('empty-body'));

    expect(rowsOf(root).map(({ block_body }) => block_body)).toEqual(['']);
  });

  it('stores a dispatch with no plan stub as NULL', () => {
    const root = freshRoot('null-stub');
    const dispatch = { ...DISPATCH, planStub: null };
    writeReportAbsence(root, writeOf('no-block', { dispatch }), seams('null-stub'));

    expect(rowsOf(root).map(({ plan_stub }) => plan_stub)).toEqual([null]);
  });

  it.each([...FINDING_OUTCOMES])('stores the %s outcome', (outcome) => {
    const root = freshRoot(`outcome-${outcome}`);
    writeReportAbsence(root, writeOf('no-block', { outcome }), seams(`outcome-${outcome}`));

    expect(rowsOf(root).map((row) => row.outcome)).toEqual([outcome]);
  });
});

describe('one absence row per session', () => {
  it('adds nothing for a session already recorded, whatever the second says', () => {
    const root = freshRoot('repeat');
    writeReportAbsence(root, writeOf('no-block'), seams('repeat-first'));
    const second = writeOf('malformed-block', { outcome: 'failed' });
    const again = writeReportAbsence(root, second, seams('repeat-second'));

    expect([again.appended, again.skipped]).toEqual([0, 1]);
    expect(rowsOf(root).map(({ id, reason, outcome }) => [id, reason, outcome]))
      .toEqual([['repeat-first-1', 'no-block', 'done']]);
  });

  it('records two sessions of one task apart', () => {
    const root = freshRoot('two-sessions');
    writeReportAbsence(root, writeOf('no-block'), seams('two-first'));
    const again = writeReportAbsence(root, writeOf('no-block', { dispatch: RETRY }), seams('two-second'));

    expect([again.appended, again.skipped]).toEqual([1, 0]);
    expect(rowsOf(root).map(({ session_id }) => session_id)).toEqual(['aaaa-1111', 'bbbb-2222']);
  });

  it('throws on an id generated twice rather than absorbing it', () => {
    const root = freshRoot('id-repeat');
    writeReportAbsence(root, writeOf(), { newId: () => 'same' });

    expect(() => writeReportAbsence(root, writeOf('no-block', { dispatch: RETRY }), { newId: () => 'same' }))
      .toThrow('UNIQUE constraint failed: report_absences.id');
    expect(rowsOf(root)).toHaveLength(1);
  });
});

describe('what an absence write refuses', () => {
  const refusals: readonly (readonly [string, () => ReportAbsenceWrite, string])[] = [
    [
      'an empty session id',
      () => writeOf('no-block', { dispatch: { ...DISPATCH, sessionId: '' } }),
      'has session id "", not a non-empty string',
    ],
    [
      'an outcome outside the set',
      () => writeOf('no-block', { outcome: 'skipped' as never }),
      'has outcome "skipped", not one of done, blocked, failed',
    ],
    [
      'a plan stub holding a lone surrogate',
      () => writeOf('no-block', { dispatch: { ...DISPATCH, planStub: `phase${LONE_HIGH}` } }),
      'has a plan stub holding a lone UTF-16 surrogate',
    ],
    [
      'a reason outside the set',
      () => withAbsence({ reason: 'lost' }),
      'has reason "lost", not one of no-block, unclosed-block, malformed-block',
    ],
    ['a blank detail', () => withAbsence({ text: '  ' }), 'has a detail that is blank'],
    ['a detail that is not a string', () => withAbsence({ text: 42 }), 'has detail 42, not a string'],
    [
      'a detail holding a lone surrogate',
      () => withAbsence({ text: `it broke${LONE_HIGH}` }),
      'has a detail that holds a lone UTF-16 surrogate',
    ],
    ['a block body that is not a string', () => withBody(7), 'has block body 7, not a string'],
    [
      'a block body holding a lone surrogate',
      () => withBody(`status: done${LONE_HIGH}`),
      'has a block body holding a lone UTF-16 surrogate',
    ],
  ];

  it.each(refusals)('refuses %s whole, creating nothing', (_name, writeFor, message) => {
    const root = freshRoot('refused');
    const refusal = refusalOf(() => writeReportAbsence(root, writeFor()));

    expect(refusal).toContain(message);
    expect(refusal.endsWith('; nothing written')).toBe(true);
    expect(existsSync(root)).toBe(false);
  });

  it('leaves a store that exists byte-identical when it refuses', () => {
    const root = freshRoot('refused-existing');
    writeReportAbsence(root, writeOf(), seams('refused-existing'));
    const before = readRaw(root);
    const refused = { ...withAbsence({ text: '' }), dispatch: RETRY };

    expect(() => writeReportAbsence(root, refused)).toThrow('nothing written');
    expect(readRaw(root)).toEqual(before);
  });

  it('refuses a store past the last version, touching nothing', () => {
    const root = freshRoot('newer');
    writeReportAbsence(root, writeOf(), seams('newer'));
    const db = new Database(storeFile(root), { readwrite: true });
    db.run(`PRAGMA user_version = ${SQLITE_SCHEMA_VERSION + 1}`);
    db.close();
    const before = readRaw(root);

    expect(() => writeReportAbsence(root, writeOf('no-block', { dispatch: RETRY }), seams('newer-2')))
      .toThrow(`past the ${SQLITE_SCHEMA_VERSION} this rafa knows`);
    expect(readRaw(root)).toEqual(before);
  });
});
