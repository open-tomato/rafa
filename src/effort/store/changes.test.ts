/**
 * Tests for the change-note writer, the reader of a plan's notes, and
 * the migration that creates their table.
 *
 * Every store sits under a fresh temporary repo root, and the disk is
 * real. Every reading goes through `bun:sqlite` directly and never
 * through the module, so the column names, the constraints and the
 * dedupe rule are spelled here rather than read off the code under test.
 *
 * Entries are built in the shape `parseReport` answers, and one case
 * feeds the writer a report parsed for real.
 *
 * Each refusal sits beside the write it was varied from, which the store
 * takes, so a writer refusing everything reddens.
 *
 * Eight mutations of the writer and its migration were driven against
 * this file alone, with the unmutated sources green before and after and
 * restored byte-identical. All eight reddened at least one of the
 * writer's 39 cases: the dedupe index made non-unique (33), refused entries written
 * anyway (11), the whole-write dispatch check dropped (5), the dedupe
 * key on the bare `area` column in both the index and the conflict
 * target (3), the level check accepting any value that is present (2),
 * `level` left nullable and unchecked in the migration (2), the clock
 * read once per row rather than once per write (1), and the plan stub
 * dropped from the stored row (1). A ninth, the bare column in the
 * conflict target alone, reddens every case that writes: measured with
 * bun 1.3.14 on SQLite 3.51.0, the insert then throws `ON CONFLICT
 * clause does not match any PRIMARY KEY or UNIQUE constraint`, which is
 * the reading `triage.ts` records for its own index.
 *
 * The reader's ten cases sit in their own block, and each reads a store
 * written through `writeChanges` rather than planted, so the columns the
 * writer fills and the ones the reader answers are checked against each
 * other. Every case asking for one stub writes notes under another stub
 * and under none beside them.
 *
 * Eight mutations of the reader were driven against this file, with the
 * unmutated source green before and after and restored byte-identical.
 * All eight redden: the stub filter dropped (3 cases), `ORDER BY seq`
 * made `ORDER BY summary` (3), `collected_at` answered blank (2), and
 * one each for `IS` made `=`, the missing-store guard dropped, the area
 * answered null, the session id taken from the task line, and
 * `ORDER BY seq` made `ORDER BY collected_at`. The last one SURVIVED
 * until the backwards-clock case was written: with the stamps agreeing
 * with the append order, both orderings answer the same rows in the same
 * order, and measured on SQLite 3.51.0 a tie inside one write comes back
 * in rowid order either way.
 */
import type { ChangesWrite, ChangesWriteResult } from './changes.js';
import type { FindingsWriterSeams } from './findings.js';
import type { ReportChange } from '../../report/parse.js';

import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { Database } from 'bun:sqlite';
import { afterAll, describe, expect, it } from 'bun:test';

import { CHANGE_LEVELS, parseReport } from '../../report/parse.js';

import { readPlanChanges, writeChanges } from './changes.js';
import { migrateSchema, SQLITE_MIGRATIONS, SQLITE_SCHEMA_VERSION } from './sqlite.js';

/** A changes row as the table holds it. */
interface StoredChange {
  seq: number;
  id: string;
  session_id: string;
  plan_stub: string | null;
  task_line: string;
  level: string;
  area: string | null;
  summary: string;
  collected_at: string;
}

/** The table's columns, in order. No outcome: the note is about the diff. */
const COLUMNS = [
  'seq',
  'id',
  'session_id',
  'plan_stub',
  'task_line',
  'level',
  'area',
  'summary',
  'collected_at',
];

/** Every table a store at the last version holds, by name. */
const TABLES = [
  'blockers',
  'changes',
  'commits',
  'dispatches',
  'findings',
  'out_of_scope_bugs',
  'preflight',
  'report_absences',
  'sessions',
  'task_reports',
];

const tempBase = mkdtempSync(join(tmpdir(), 'rafa-changes-'));
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

/** Every changes row, in append order. */
function rowsOf(root: string): StoredChange[] {
  return rawQuery<StoredChange>(root, 'SELECT * FROM changes ORDER BY seq');
}

/** One column of every row, in append order. */
function columnOf(root: string, column: string): unknown[] {
  const sql = `SELECT ${column} AS value FROM changes ORDER BY seq`;
  return rawQuery<{ value: unknown }>(root, sql).map(({ value }) => value);
}

/** Every table under `root`, by name. */
function tablesOf(root: string): string[] {
  const sql = 'SELECT name FROM sqlite_master WHERE type = ? ORDER BY name';
  return rawQuery<{ name: string }>(root, sql, 'table').map(({ name }) => name);
}

/**
 * Inserts one row by hand, bypassing the writer, with every column valid
 * unless overridden.
 */
function rawInsert(
  root: string,
  overrides: Record<string, string | null> = {},
): void {
  const row: Record<string, string | null> = {
    id: `raw-${planted}-${Math.random()}`,
    session_id: 'raw-session',
    plan_stub: null,
    task_line: 'A raw task',
    level: 'patch',
    area: null,
    summary: `a raw summary ${Math.random()}`,
    collected_at: '2026-09-20T00:00:00.000Z',
    ...overrides,
  };
  const names = Object.keys(row);
  const holes = names.map(() => '?').join(', ');
  const db = new Database(storeFile(root), { readwrite: true, create: false });
  try {
    db.query<unknown, (string | null)[]>(
      `INSERT INTO changes (${names.join(', ')}) VALUES (${holes})`,
    ).run(...Object.values(row));
  } finally {
    db.close();
  }
}

/** A change note as `parseReport` answers one, every field filled. */
function change(overrides: Partial<ReportChange> = {}): ReportChange {
  return {
    level: 'minor',
    area: 'effort store',
    summary: 'Task reports now store the changelog lines a task returns',
    extras: [],
    ...overrides,
  };
}

/** The dispatch most cases write under. */
const DISPATCH = {
  sessionId: 'aaaa-1111',
  planStub: 'rafa-21-changelog-and-release',
  taskLine: 'Add the changes table and its writer',
};

/** A write of the notes under the default dispatch. */
function writeOf(overrides: Partial<ChangesWrite> = {}): ChangesWrite {
  return { dispatch: DISPATCH, changes: [], ...overrides };
}

/** Ids no other case generates, and a fixed clock. */
function seams(prefix: string): Required<FindingsWriterSeams> {
  let count = 0;
  return {
    now: () => new Date('2026-09-20T10:00:00.000Z'),
    newId: () => {
      count += 1;
      return `${prefix}-${count}`;
    },
  };
}

/** A write's counts and the indexes it refused, path left out. */
function counts(result: ChangesWriteResult): unknown {
  return {
    appended: result.appended,
    skipped: result.skipped,
    rejected: result.rejected.map(({ index }) => index),
  };
}

/** Counts in the shape {@link counts} answers. */
function countsOf(appended: number, skipped: number, rejected: number[] = []): unknown {
  return { appended, skipped, rejected };
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

describe('the changes migration', () => {
  it('creates the table with its columns, in order, at the last version', () => {
    const root = freshRoot('columns');

    writeChanges(root, writeOf({ changes: [change()] }), seams('columns'));

    const columns = rawQuery<{ name: string }>(
      root,
      'SELECT name FROM pragma_table_info(?) ORDER BY cid',
      'changes',
    );
    expect(columns.map(({ name }) => name)).toEqual(COLUMNS);
    expect(columns.map(({ name }) => name)).not.toContain('outcome');
    expect(tablesOf(root)).toEqual(TABLES);
    expect(rawQuery(root, 'PRAGMA user_version'))
      .toEqual([{ user_version: SQLITE_SCHEMA_VERSION }]);
  });

  it('brings a version-7 store forward, keeping the rows it holds', () => {
    const root = freshRoot('from-v7');
    mkdirSync(dirname(storeFile(root)), { recursive: true });
    const db = new Database(storeFile(root), { create: true, readwrite: true });
    migrateSchema(db, storeFile(root), SQLITE_MIGRATIONS.slice(0, 7));
    db.run(
      'INSERT INTO task_reports (id, session_id, task_line, status, outcome, collected_at)'
        + ' VALUES (?, ?, ?, ?, ?, ?)',
      ['t-1', 's-0', 'An earlier task', 'done', 'done', '2026-09-19T00:00:00.000Z'],
    );
    db.close();

    // The control: the first seven entries make every earlier table and no
    // changes table, so the table this write fills came from a later
    // entry, and was not added to a shipped one.
    expect(tablesOf(root)).toEqual(TABLES.filter((table) => table !== 'changes'));

    const result = writeChanges(root, writeOf({ changes: [change()] }), seams('from-v7'));

    expect(counts(result)).toEqual(countsOf(1, 0));
    expect(rawQuery(root, 'PRAGMA user_version'))
      .toEqual([{ user_version: SQLITE_SCHEMA_VERSION }]);
    expect(rawQuery(root, 'SELECT id FROM task_reports')).toEqual([{ id: 't-1' }]);
    expect(columnOf(root, 'id')).toEqual(['from-v7-1']);
  });

  it('refuses a row with a missing or empty field in the schema itself', () => {
    const root = freshRoot('schema-fields');
    writeChanges(root, writeOf({ changes: [change()] }), seams('schema-fields'));

    expect(() => rawInsert(root, { level: null }))
      .toThrow('NOT NULL constraint failed: changes.level');
    expect(() => rawInsert(root, { summary: null }))
      .toThrow('NOT NULL constraint failed: changes.summary');
    expect(() => rawInsert(root, { task_line: null }))
      .toThrow('NOT NULL constraint failed: changes.task_line');
    expect(() => rawInsert(root, { collected_at: null }))
      .toThrow('NOT NULL constraint failed: changes.collected_at');
    expect(() => rawInsert(root, { summary: '' })).toThrow(/CHECK constraint failed/);
    expect(() => rawInsert(root, { area: '' })).toThrow(/CHECK constraint failed/);
    expect(() => rawInsert(root, { session_id: '' })).toThrow(/CHECK constraint failed/);
    expect(() => rawInsert(root, { id: '' })).toThrow(/CHECK constraint failed/);
    expect(() => rawInsert(root, { id: 'same' })).not.toThrow();
    expect(() => rawInsert(root, { id: 'same' }))
      .toThrow('UNIQUE constraint failed: changes.id');
  });

  it('holds exactly the levels the report parser answers', () => {
    const root = freshRoot('closed-set');
    writeChanges(root, writeOf({ changes: [change()] }), seams('closed-set'));

    for (const level of CHANGE_LEVELS) {
      expect(() => rawInsert(root, { level })).not.toThrow();
    }
    expect(() => rawInsert(root, { level: 'Patch' })).toThrow(/CHECK constraint failed/);
    expect(() => rawInsert(root, { level: 'breaking' })).toThrow(/CHECK constraint failed/);
    expect(columnOf(root, 'level')).toEqual(['minor', ...CHANGE_LEVELS]);
  });

  it('refuses a repeated entry written from outside, a missing area included', () => {
    const root = freshRoot('schema-dedupe');
    writeChanges(root, writeOf({ changes: [change()] }), seams('schema-dedupe'));
    const entry = { session_id: 's', level: 'patch', area: null, summary: 'one line' };

    expect(() => rawInsert(root, entry)).not.toThrow();
    expect(() => rawInsert(root, entry)).toThrow(/UNIQUE constraint failed/);
    expect(() => rawInsert(root, { ...entry, session_id: 't' })).not.toThrow();
    expect(() => rawInsert(root, { ...entry, area: 'cli' })).not.toThrow();
    expect(() => rawInsert(root, { ...entry, level: 'minor' })).not.toThrow();
  });
});

describe('writeChanges rows', () => {
  it('writes one row per entry: dispatch, entry, write time', () => {
    const root = freshRoot('rows');
    const write = writeOf({
      changes: [change(), change({ level: 'none', area: null, summary: 'Internal only' })],
    });

    const result = writeChanges(root, write, seams('rows'));

    const provenance = {
      session_id: 'aaaa-1111',
      plan_stub: 'rafa-21-changelog-and-release',
      task_line: 'Add the changes table and its writer',
    };
    expect(result.path).toBe(storeFile(root));
    expect(counts(result)).toEqual(countsOf(2, 0));
    expect(rowsOf(root)).toEqual([
      {
        seq: 1,
        id: 'rows-1',
        ...provenance,
        level: 'minor',
        area: 'effort store',
        summary: 'Task reports now store the changelog lines a task returns',
        collected_at: '2026-09-20T10:00:00.000Z',
      },
      {
        seq: 2,
        id: 'rows-2',
        ...provenance,
        level: 'none',
        area: null,
        summary: 'Internal only',
        collected_at: '2026-09-20T10:00:00.000Z',
      },
    ]);
  });

  it.each([...CHANGE_LEVELS])('stores the level %s', (level) => {
    const root = freshRoot(`level-${level}`);

    writeChanges(root, writeOf({ changes: [change({ level })] }), seams(`level-${level}`));

    expect(columnOf(root, 'level')).toEqual([level]);
  });

  it('stores a null plan stub as NULL', () => {
    const root = freshRoot('null-stub');
    const dispatch = { ...DISPATCH, planStub: null };

    writeChanges(root, writeOf({ dispatch, changes: [change()] }), seams('null-stub'));

    expect(columnOf(root, 'plan_stub')).toEqual([null]);
  });

  it('stamps every row with one time, taken once', () => {
    const root = freshRoot('one-time');
    let calls = 0;
    const now = (): Date => {
      calls += 1;
      return new Date(Date.UTC(2026, 8, 20, 10, calls));
    };
    const changes = [change(), change({ summary: 'A second line' })];

    writeChanges(root, writeOf({ changes }), { ...seams('one-time'), now });

    const stamp = '2026-09-20T10:01:00.000Z';
    expect(calls).toBe(1);
    expect(columnOf(root, 'collected_at')).toEqual([stamp, stamp]);
  });

  it('generates a distinct UUID per row and reads the clock by default', () => {
    const root = freshRoot('defaults');
    const before = Date.now();

    writeChanges(root, writeOf({ changes: [change(), change({ summary: 'Another' })] }));

    const after = Date.now();
    const ids = columnOf(root, 'id');
    const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
    expect(ids).toHaveLength(2);
    expect(new Set(ids).size).toBe(2);
    for (const id of ids) expect(String(id)).toMatch(uuid);
    for (const at of columnOf(root, 'collected_at')) {
      const time = Date.parse(String(at));
      expect(time).toBeGreaterThanOrEqual(before);
      expect(time).toBeLessThanOrEqual(after);
    }
  });

  it('carries a parsed report entry for entry', () => {
    const output = [
      'Done.',
      '',
      '```rafa:report',
      'status: done',
      'changes:',
      '  - level: minor',
      '    area: "effort store"',
      '    summary: "Change notes are stored per task session"',
      '  - level: patch',
      '    summary: "A refused note now names its own field"',
      '    extra_key: kept by the parser, not stored',
      '  - level: none',
      '    summary: "Nothing a user would notice"',
      '```',
    ].join('\n');
    const reading = parseReport(output);
    if (!reading.present) throw new Error(reading.text);
    const root = freshRoot('parsed');
    const { changes } = reading.report;

    writeChanges(root, writeOf({ changes }), seams('parsed'));

    const fields = (row: StoredChange | ReportChange): unknown => ({
      level: row.level,
      area: row.area,
      summary: row.summary,
    });
    expect(changes).toHaveLength(3);
    expect(rowsOf(root).map(fields)).toEqual(changes.map(fields));
    expect(columnOf(root, 'area')).toEqual(['effort store', null, null]);
  });
});

describe('deduplication', () => {
  it('keeps the first of two identical entries within a write, a missing area included', () => {
    const root = freshRoot('identical');
    const bare = { area: null };
    const changes = [change(), change(), change(bare), change(bare)];

    const result = writeChanges(root, writeOf({ changes }), seams('identical'));

    expect(counts(result)).toEqual(countsOf(2, 2));
    expect(columnOf(root, 'id')).toEqual(['identical-1', 'identical-3']);
  });

  it('dedupes against the disk, changing no byte on a repeated write', () => {
    const root = freshRoot('repeat');
    const write = writeOf({ changes: [change(), change({ area: null })] });
    writeChanges(root, write, seams('repeat'));
    const before = readRaw(root);

    const again = writeChanges(root, write, seams('repeat-again'));

    expect(counts(again)).toEqual(countsOf(0, 2));
    expect(readRaw(root)).toEqual(before);
  });

  it('stores entries that differ in any stored field as rows of their own', () => {
    const root = freshRoot('distinct');
    const changes = [
      change(),
      change({ level: 'patch' }),
      change({ area: 'cli' }),
      change({ area: null }),
      change({ summary: 'A different line' }),
    ];

    const result = writeChanges(root, writeOf({ changes }), seams('distinct'));

    expect(counts(result)).toEqual(countsOf(5, 0));
  });

  it('matches every stored field byte for byte', () => {
    const root = freshRoot('exact');
    const summary = 'Task reports now store the changelog lines a task returns';
    const area = 'effort store';
    const changes = [
      change(),
      change({ summary: summary.toUpperCase() }),
      change({ summary: `${summary} ` }),
      change({ area: area.toUpperCase() }),
      change({ area: `${area} ` }),
      change(),
    ];

    const result = writeChanges(root, writeOf({ changes }), seams('exact'));

    expect(counts(result)).toEqual(countsOf(5, 1));
  });

  it('stores the same notes again for another session', () => {
    const root = freshRoot('another-session');
    const changes = [change(), change({ area: null })];
    const ids = seams('another-session');
    writeChanges(root, writeOf({ changes }), ids);
    const other = { ...DISPATCH, sessionId: 'bbbb-2222', taskLine: 'A later task' };

    const result = writeChanges(root, writeOf({ changes, dispatch: other }), ids);

    expect(counts(result)).toEqual(countsOf(2, 0));
    expect(columnOf(root, 'session_id'))
      .toEqual(['aaaa-1111', 'aaaa-1111', 'bbbb-2222', 'bbbb-2222']);
  });
});

describe('entry rejections', () => {
  it.each([
    ['no level', { level: null }, 'level', 'missing-field', 'is missing'],
    ['an unknown level', { level: 'breaking' as never }, 'level', 'unstorable-field', 'not one of patch, minor, major, none'],
    ['a numeric level', { level: 2 as never }, 'level', 'unstorable-field', 'is 2, not one of'],
    ['no summary', { summary: null }, 'summary', 'missing-field', 'is missing'],
    ['a blank summary', { summary: '  ' }, 'summary', 'unstorable-field', 'is blank'],
    ['a numeric summary', { summary: 7 as never }, 'summary', 'unstorable-field', 'is 7, not a string'],
    ['a summary holding a lone surrogate', { summary: 'ab\uD800cd' }, 'summary', 'unstorable-field', 'lone UTF-16 surrogate'],
    ['a blank area', { area: '' }, 'area', 'unstorable-field', 'is blank'],
    ['a numeric area', { area: 4 as never }, 'area', 'unstorable-field', 'is 4, not a string'],
  ] as const)('refuses a note with %s alone, writing the rest', (_label, overrides, field, reason, why) => {
    const root = freshRoot('entry-refused');
    const changes = [
      change({ summary: 'kept before' }),
      change({ ...overrides }),
      change({ summary: 'kept after' }),
    ];

    const result = writeChanges(root, writeOf({ changes }), seams(`entry-refused-${planted}`));

    expect(counts(result)).toEqual(countsOf(2, 0, [1]));
    expect(result.rejected[0]).toMatchObject({ index: 1, reason, field });
    expect(result.rejected[0]?.text).toStartWith(`changes[1].${field} `);
    expect(result.rejected[0]?.text).toContain(why);
    expect(result.rejected[0]?.text).toEndWith('; not written');
    expect(columnOf(root, 'summary')).toEqual(['kept before', 'kept after']);
  });

  it('adds up: appended, skipped and rejected', () => {
    const root = freshRoot('sum');
    const changes = [
      change(),
      change(),
      change({ level: null }),
      change({ summary: 'A line of its own' }),
      change({ area: '' }),
    ];

    const result = writeChanges(root, writeOf({ changes }), seams('sum'));

    expect(counts(result)).toEqual(countsOf(2, 1, [2, 4]));
    expect(result.appended + result.skipped + result.rejected.length).toBe(5);
  });

  it('creates no file and no directory when every entry is refused', () => {
    const root = freshRoot('all-refused');
    const changes = [change({ level: null }), change({ summary: null })];

    const result = writeChanges(root, writeOf({ changes }), seams('all-refused'));

    expect(counts(result)).toEqual(countsOf(0, 0, [0, 1]));
    expect(existsSync(root)).toBe(false);
  });

  it('creates no file and no directory for an empty list', () => {
    const root = freshRoot('empty');

    const result = writeChanges(root, writeOf(), seams('empty'));

    expect(result).toEqual({
      path: storeFile(root),
      appended: 0,
      skipped: 0,
      rejected: [],
    });
    expect(existsSync(root)).toBe(false);
  });
});

describe('whole-write refusals', () => {
  it.each([
    ['an empty session id', { ...DISPATCH, sessionId: '' }, 'session id ""'],
    ['a null task line', { ...DISPATCH, taskLine: null as never }, 'task line null'],
    ['a numeric plan stub', { ...DISPATCH, planStub: 7 as never }, 'plan stub 7'],
    [
      'a lone surrogate in the session id',
      { ...DISPATCH, sessionId: 'x\uDC00' },
      'session id holding a lone UTF-16 surrogate',
    ],
  ] as const)('refuses %s even with the list empty, creating nothing', (_label, dispatch, why) => {
    const root = freshRoot('refused-write');

    const refusal = refusalOf(() => writeChanges(root, writeOf({ dispatch })));

    expect(refusal).toStartWith('effort store: changes write ');
    expect(refusal).toContain(why);
    expect(refusal).toEndWith('; nothing written');
    expect(existsSync(root)).toBe(false);
  });

  it('refuses before opening an existing store, changing no byte', () => {
    const root = freshRoot('refused-existing');
    writeChanges(root, writeOf({ changes: [change()] }), seams('refused-existing'));
    const before = readRaw(root);
    const dispatch = { ...DISPATCH, sessionId: '' };

    expect(() => writeChanges(root, writeOf({ dispatch, changes: [change({ area: null })] })))
      .toThrow('effort store: changes write has session id ""');
    expect(readRaw(root)).toEqual(before);
  });

  it('rolls the write back when a generated id repeats', () => {
    const root = freshRoot('id-repeat');
    writeChanges(root, writeOf({ changes: [change()] }), seams('id-repeat'));
    const before = readRaw(root);
    const changes = [change({ summary: 'a' }), change({ summary: 'b' })];

    expect(() => writeChanges(root, writeOf({ changes }), { newId: () => 'same' }))
      .toThrow('UNIQUE constraint failed: changes.id');
    expect(readRaw(root)).toEqual(before);
    expect(columnOf(root, 'id')).toEqual(['id-repeat-1']);
  });

  it('refuses a store past the version this rafa knows, touching nothing', () => {
    const root = freshRoot('newer');
    writeChanges(root, writeOf({ changes: [change()] }), seams('newer'));
    const db = new Database(storeFile(root));
    db.run(`PRAGMA user_version = ${SQLITE_SCHEMA_VERSION + 1}`);
    db.close();
    const before = readRaw(root);

    expect(() => writeChanges(root, writeOf({ changes: [change({ area: null })] }), seams('newer-2')))
      .toThrow(`past the ${SQLITE_SCHEMA_VERSION} this rafa knows`);
    expect(readRaw(root)).toEqual(before);
  });

  it('refuses an empty write on a store past the version this rafa knows, bytes untouched', () => {
    const root = freshRoot('newer-empty');
    writeChanges(root, writeOf({ changes: [change()] }), seams('newer-empty'));
    const current = readRaw(root);

    // The control: an empty write on a current store opens it and changes
    // nothing, so the refusal below is the version and not the emptiness.
    const control = writeChanges(root, writeOf());
    expect(counts(control)).toEqual(countsOf(0, 0));
    expect(readRaw(root)).toEqual(current);

    const newer = SQLITE_SCHEMA_VERSION + 1;
    const db = new Database(storeFile(root));
    db.run(`PRAGMA user_version = ${newer}`);
    db.close();
    const before = readRaw(root);
    const refusal = `is at schema version ${newer}, past the`
      + ` ${SQLITE_SCHEMA_VERSION} this rafa knows`;
    const allRefused = writeOf({ changes: [change({ level: null })] });

    expect(() => writeChanges(root, writeOf())).toThrow(refusal);
    expect(() => writeChanges(root, allRefused)).toThrow(refusal);
    expect(readRaw(root)).toEqual(before);
  });
});

describe('readPlanChanges', () => {
  /** A dispatch of one session under one plan stub. */
  function dispatchOf(sessionId: string, planStub: string | null): ChangesWrite['dispatch'] {
    return { sessionId, planStub, taskLine: `Task of ${sessionId}` };
  }

  /** The store a case reads from, read-only, module uninvolved. */
  function storedSummaries(root: string, planStub: string | null): unknown[] {
    const sql = 'SELECT summary FROM changes WHERE plan_stub IS ? ORDER BY seq';
    return rawQuery<{ summary: string }>(root, sql, planStub as string).map(({ summary }) => summary);
  }

  it('answers every note under the stub, oldest first, and no other stub', () => {
    const root = freshRoot('by-stub');
    const stub = 'rafa-21-changelog-and-release';
    writeChanges(root, {
      dispatch: dispatchOf('s-1', stub),
      changes: [change({ summary: 'first' }), change({ summary: 'second', area: null })],
    }, seams('by-stub-1'));
    writeChanges(root, {
      dispatch: dispatchOf('s-2', 'rafa-20-pr-commands'),
      changes: [change({ summary: 'another plan' })],
    }, seams('by-stub-2'));
    writeChanges(root, {
      dispatch: dispatchOf('s-3', null),
      changes: [change({ summary: 'no plan at all' })],
    }, seams('by-stub-3'));
    writeChanges(root, {
      dispatch: dispatchOf('s-4', stub),
      changes: [change({ summary: 'third' })],
    }, seams('by-stub-4'));

    // The control: all four writes landed, so a reader answering only the
    // stub's three is filtering rather than missing rows.
    expect(columnOf(root, 'summary'))
      .toEqual(['first', 'second', 'another plan', 'no plan at all', 'third']);
    expect(readPlanChanges(root, stub).map(({ summary }) => summary))
      .toEqual(['first', 'second', 'third']);
    expect(readPlanChanges(root, 'rafa-20-pr-commands').map(({ summary }) => summary))
      .toEqual(['another plan']);
  });

  it('answers the notes of the sessions that resolved no plan for the null stub', () => {
    const root = freshRoot('null-stub');
    writeChanges(root, {
      dispatch: dispatchOf('s-1', 'rafa-21-changelog-and-release'),
      changes: [change({ summary: 'under a stub' })],
    }, seams('null-stub-1'));
    writeChanges(root, {
      dispatch: dispatchOf('s-2', null),
      changes: [change({ summary: 'under none' }), change({ summary: 'under none too' })],
    }, seams('null-stub-2'));

    expect(storedSummaries(root, null)).toEqual(['under none', 'under none too']);
    expect(readPlanChanges(root, null).map(({ summary }) => summary))
      .toEqual(['under none', 'under none too']);
  });

  it('answers each row whole: session, task line, level, area, summary, time', () => {
    const root = freshRoot('fields');
    const stub = 'rafa-21-changelog-and-release';
    writeChanges(root, {
      dispatch: { sessionId: 'aaaa-1111', planStub: stub, taskLine: 'Add the reader' },
      changes: [
        change({ level: 'major', area: 'cli', summary: 'rafa release tag ships' }),
        change({ level: 'none', area: null, summary: 'Internal only' }),
      ],
    }, seams('fields'));

    expect(readPlanChanges(root, stub)).toEqual([
      {
        sessionId: 'aaaa-1111',
        taskLine: 'Add the reader',
        level: 'major',
        area: 'cli',
        summary: 'rafa release tag ships',
        collectedAt: '2026-09-20T10:00:00.000Z',
      },
      {
        sessionId: 'aaaa-1111',
        taskLine: 'Add the reader',
        level: 'none',
        area: null,
        summary: 'Internal only',
        collectedAt: '2026-09-20T10:00:00.000Z',
      },
    ]);
  });

  it('keeps one write in the order the report listed its notes, times tied', () => {
    const root = freshRoot('tied-times');
    const stub = 'rafa-21-changelog-and-release';
    const summaries = ['zebra last alphabetically', 'alpha first alphabetically', 'middle one'];
    writeChanges(root, {
      dispatch: dispatchOf('s-1', stub),
      changes: summaries.map((summary) => change({ summary })),
    }, seams('tied-times'));

    // The control: every row carries the one write's time, so the order
    // below cannot have come from the clock.
    expect(new Set(columnOf(root, 'collected_at')).size).toBe(1);
    expect(readPlanChanges(root, stub).map(({ summary }) => summary)).toEqual(summaries);
  });

  it('answers the writes in the order they landed, later clock or not', () => {
    const root = freshRoot('across-writes');
    const stub = 'rafa-21-changelog-and-release';
    writeChanges(root, {
      dispatch: dispatchOf('s-1', stub),
      changes: [change({ summary: 'written first' })],
    }, { now: () => new Date('2026-09-20T09:00:00.000Z'), newId: () => 'across-1' });
    writeChanges(root, {
      dispatch: dispatchOf('s-2', stub),
      changes: [change({ summary: 'written second' })],
    }, { now: () => new Date('2026-09-20T11:00:00.000Z'), newId: () => 'across-2' });

    expect(readPlanChanges(root, stub).map(({ summary, collectedAt }) => [summary, collectedAt]))
      .toEqual([
        ['written first', '2026-09-20T09:00:00.000Z'],
        ['written second', '2026-09-20T11:00:00.000Z'],
      ]);
  });

  it('orders by the append order, not the stamp, when a clock goes backwards', () => {
    const root = freshRoot('backwards-clock');
    const stub = 'rafa-21-changelog-and-release';
    writeChanges(root, {
      dispatch: dispatchOf('s-1', stub),
      changes: [change({ summary: 'written first' })],
    }, { now: () => new Date('2026-09-20T11:00:00.000Z'), newId: () => 'backwards-1' });
    writeChanges(root, {
      dispatch: dispatchOf('s-2', stub),
      changes: [change({ summary: 'written second' })],
    }, { now: () => new Date('2026-09-20T09:00:00.000Z'), newId: () => 'backwards-2' });

    // The control: the stamps disagree with the append order here, so the
    // order below is `seq` and cannot be `collected_at`.
    expect(columnOf(root, 'collected_at'))
      .toEqual(['2026-09-20T11:00:00.000Z', '2026-09-20T09:00:00.000Z']);
    expect(readPlanChanges(root, stub).map(({ summary }) => summary))
      .toEqual(['written first', 'written second']);
  });

  it('answers none for a store that does not exist, creating nothing', () => {
    const root = freshRoot('no-store');

    expect(readPlanChanges(root, 'rafa-21-changelog-and-release')).toEqual([]);
    expect(readPlanChanges(root, null)).toEqual([]);
    expect(existsSync(storeFile(root))).toBe(false);
    expect(existsSync(dirname(storeFile(root)))).toBe(false);
    expect(existsSync(root)).toBe(false);

    // The control: the same root, once written, answers the note, so the
    // emptiness above was the missing store and not the query.
    writeChanges(root, {
      dispatch: dispatchOf('s-1', 'rafa-21-changelog-and-release'),
      changes: [change({ summary: 'now it exists' })],
    }, seams('no-store'));
    expect(readPlanChanges(root, 'rafa-21-changelog-and-release').map(({ summary }) => summary))
      .toEqual(['now it exists']);
  });

  it('answers none for a stub the store holds no note under', () => {
    const root = freshRoot('unknown-stub');
    writeChanges(root, {
      dispatch: dispatchOf('s-1', 'rafa-21-changelog-and-release'),
      changes: [change({ summary: 'the only note' })],
    }, seams('unknown-stub'));

    expect(readPlanChanges(root, 'rafa-99-nothing-here')).toEqual([]);
    expect(readPlanChanges(root, null)).toEqual([]);
  });

  it('refuses a store past the version this rafa knows', () => {
    const root = freshRoot('read-newer');
    const stub = 'rafa-21-changelog-and-release';
    writeChanges(root, {
      dispatch: dispatchOf('s-1', stub),
      changes: [change({ summary: 'stored before the bump' })],
    }, seams('read-newer'));

    // The control: the read works at this version, so the refusal below
    // is the version and nothing else about the store.
    expect(readPlanChanges(root, stub)).toHaveLength(1);

    const db = new Database(storeFile(root));
    db.run(`PRAGMA user_version = ${SQLITE_SCHEMA_VERSION + 1}`);
    db.close();
    const before = readRaw(root);

    expect(() => readPlanChanges(root, stub))
      .toThrow(`past the ${SQLITE_SCHEMA_VERSION} this rafa knows`);
    expect(readRaw(root)).toEqual(before);
  });

  it('brings a version-7 store forward and answers none, the table just made', () => {
    const root = freshRoot('read-from-v7');
    mkdirSync(dirname(storeFile(root)), { recursive: true });
    const db = new Database(storeFile(root), { create: true, readwrite: true });
    migrateSchema(db, storeFile(root), SQLITE_MIGRATIONS.slice(0, 7));
    db.close();
    expect(tablesOf(root)).toEqual(TABLES.filter((table) => table !== 'changes'));

    expect(readPlanChanges(root, 'rafa-21-changelog-and-release')).toEqual([]);
    expect(tablesOf(root)).toEqual(TABLES);
  });

  it('answers a level the table holds, the closed set being what bounds it', () => {
    const root = freshRoot('read-levels');
    const stub = 'rafa-21-changelog-and-release';
    writeChanges(root, {
      dispatch: dispatchOf('s-1', stub),
      changes: CHANGE_LEVELS.map((level) => change({ level, summary: `a ${level} line` })),
    }, seams('read-levels'));

    expect(readPlanChanges(root, stub).map(({ level }) => level)).toEqual([...CHANGE_LEVELS]);

    // The control: nothing outside the set can reach a reader, because
    // the table refuses it even from a writer outside this module.
    expect(() => rawInsert(root, { plan_stub: stub, level: 'breaking' }))
      .toThrow(/CHECK constraint failed/);
  });
});
