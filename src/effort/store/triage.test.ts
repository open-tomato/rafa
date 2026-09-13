/**
 * Tests for the triage writer and the migration that creates its two
 * tables.
 *
 * Every store sits under a fresh temporary repo root, and the disk is
 * real. Every reading goes through `bun:sqlite` directly and never
 * through the module, so the column names, the constraints and the
 * dedupe rule are spelled here rather than read off the code under test.
 *
 * Entries are built in the shape `parseReport` answers, and one case
 * feeds the writer a report parsed for real.
 *
 * Fifteen mutations of the writer and its migration were driven against
 * this file alone, with the unmutated sources green before and after and
 * restored byte-identical. Fourteen reddened at least one of its 43
 * cases: dedupe made table-wide, `security` dropped from the bug key,
 * the blockers index on the bare artifact column, rejected entries
 * written anyway, the whole-write check dropped, the clock read once per
 * list, a write with nothing to insert opening the store, the two lists
 * inserted outside one transaction, any flag accepted, a missing `what`
 * accepted, the security CHECK dropped from the migration, the outcome
 * ignored, the refusal naming the findings write, and bug ids generated
 * before blocker ids. The fifteenth stayed green, as expected: binding
 * `security` as the raw boolean, which bun 1.3.14 binds as 1 or 0, so
 * the explicit conversion is not something this file can pin. A
 * sixteenth, the refusal subject ignored inside `findings.ts`, reddened
 * five cases of `findings.test.ts`, which pins the wording the two
 * writers share.
 */
import type { FindingsWriterSeams } from './findings.js';
import type { TriageWrite, TriageWriteResult } from './triage.js';
import type { ReportBlocker, ReportBug } from '../../report/parse.js';

import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { Database } from 'bun:sqlite';
import { afterAll, describe, expect, it } from 'bun:test';

import { parseReport } from '../../report/parse.js';

import { migrateSchema, SQLITE_MIGRATIONS, SQLITE_SCHEMA_VERSION } from './sqlite.js';
import { writeTriage } from './triage.js';

/** The two tables, by name. */
type TriageTableName = 'blockers' | 'out_of_scope_bugs';

/** A blockers row as the table holds it. */
interface StoredBlocker {
  seq: number;
  id: string;
  session_id: string;
  plan_stub: string | null;
  task_line: string;
  what: string;
  artifact: string | null;
  outcome: string;
  collected_at: string;
}

/** An out-of-scope bugs row as the table holds it. */
interface StoredBug extends StoredBlocker {
  security: number | null;
}

/** Each table's columns, in order. */
const COLUMNS: Readonly<Record<TriageTableName, readonly string[]>> = {
  blockers: [
    'seq',
    'id',
    'session_id',
    'plan_stub',
    'task_line',
    'what',
    'artifact',
    'outcome',
    'collected_at',
  ],
  out_of_scope_bugs: [
    'seq',
    'id',
    'session_id',
    'plan_stub',
    'task_line',
    'what',
    'artifact',
    'security',
    'outcome',
    'collected_at',
  ],
};

const tempBase = mkdtempSync(join(tmpdir(), 'rafa-triage-'));
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

/** Every blockers row, in append order. */
function blockerRows(root: string): StoredBlocker[] {
  return rawQuery<StoredBlocker>(root, 'SELECT * FROM blockers ORDER BY seq');
}

/** Every out-of-scope bugs row, in append order. */
function bugRows(root: string): StoredBug[] {
  return rawQuery<StoredBug>(root, 'SELECT * FROM out_of_scope_bugs ORDER BY seq');
}

/** One column of every row of one table, in append order. */
function columnOf(root: string, table: TriageTableName, column: string): unknown[] {
  const sql = `SELECT ${column} AS value FROM ${table} ORDER BY seq`;
  return rawQuery<{ value: unknown }>(root, sql).map(({ value }) => value);
}

/**
 * Inserts one row by hand, bypassing the writer, with every column valid
 * unless overridden. `security` is only set on the bugs table.
 */
function rawInsert(
  root: string,
  table: TriageTableName,
  overrides: Record<string, string | number | null> = {},
): void {
  const row: Record<string, string | number | null> = {
    id: `raw-${planted}-${Math.random()}`,
    session_id: 'raw-session',
    plan_stub: null,
    task_line: 'A raw task',
    what: `a raw what ${Math.random()}`,
    artifact: null,
    ...(table === 'out_of_scope_bugs'
      ? { security: null }
      : {}),
    outcome: 'done',
    collected_at: '2026-09-13T00:00:00.000Z',
    ...overrides,
  };
  const names = Object.keys(row);
  const holes = names.map(() => '?').join(', ');
  const db = new Database(storeFile(root), { readwrite: true, create: false });
  try {
    db.query<unknown, (string | number | null)[]>(
      `INSERT INTO ${table} (${names.join(', ')}) VALUES (${holes})`,
    ).run(...Object.values(row));
  } finally {
    db.close();
  }
}

/** A blocker as `parseReport` answers one, every field filled. */
function blocker(overrides: Partial<ReportBlocker> = {}): ReportBlocker {
  return {
    what: 'LINEAR_API_KEY unset',
    artifact: '401 Unauthorized',
    extras: [],
    ...overrides,
  };
}

/** An out-of-scope bug as `parseReport` answers one, every field filled. */
function bug(overrides: Partial<ReportBug> = {}): ReportBug {
  return {
    what: 'report writer drops the last line',
    artifact: 'Unexpected end of JSON input',
    security: false,
    extras: [],
    ...overrides,
  };
}

/** The dispatch most cases write under. */
const DISPATCH = {
  sessionId: 'aaaa-1111',
  planStub: 'phase-0',
  taskLine: 'Add the blockers and out-of-scope-bug tables',
};

/** A write of both lists under the default dispatch, outcome `done`. */
function writeOf(overrides: Partial<TriageWrite> = {}): TriageWrite {
  return {
    dispatch: DISPATCH,
    outcome: 'done',
    blockers: [],
    outOfScopeBugs: [],
    ...overrides,
  };
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

/** A write's counts and the indexes it refused, per list, path left out. */
function counts(result: TriageWriteResult): unknown {
  const listCounts = (list: TriageWriteResult['blockers']): unknown => ({
    appended: list.appended,
    skipped: list.skipped,
    rejected: list.rejected.map(({ index }) => index),
  });
  return {
    blockers: listCounts(result.blockers),
    outOfScopeBugs: listCounts(result.outOfScopeBugs),
  };
}

/** Counts for one list, in the shape `counts` answers. */
function listOf(appended: number, skipped: number, rejected: number[] = []): unknown {
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

describe('the triage migration', () => {
  it('creates both tables with their columns, in order, at the last version', () => {
    const root = freshRoot('columns');
    writeTriage(root, writeOf({ blockers: [blocker()] }), seams('columns'));
    const columns = 'SELECT name FROM pragma_table_info(?) ORDER BY cid';
    const tables = 'SELECT name FROM sqlite_master WHERE type = ? ORDER BY name';

    for (const table of ['blockers', 'out_of_scope_bugs'] as const) {
      expect(rawQuery<{ name: string }>(root, columns, table).map(({ name }) => name))
        .toEqual([...COLUMNS[table]]);
    }
    expect(rawQuery<{ name: string }>(root, tables, 'table').map(({ name }) => name))
      .toEqual(['blockers', 'commits', 'findings', 'out_of_scope_bugs', 'sessions']);
    expect(rawQuery(root, 'PRAGMA user_version'))
      .toEqual([{ user_version: SQLITE_SCHEMA_VERSION }]);
  });

  it('brings a version-2 store forward, keeping the findings it holds', () => {
    const root = freshRoot('from-v2');
    mkdirSync(dirname(storeFile(root)), { recursive: true });
    const db = new Database(storeFile(root), { create: true, readwrite: true });
    migrateSchema(db, storeFile(root), SQLITE_MIGRATIONS.slice(0, 2));
    db.run(
      'INSERT INTO findings (id, session_id, task_line, trigger, what, outcome, collected_at)'
        + ' VALUES (?, ?, ?, ?, ?, ?, ?)',
      ['f-1', 's-1', 'A task', 'a trigger', 'a what', 'done', '2026-09-13T00:00:00.000Z'],
    );
    db.close();

    const write = writeOf({ blockers: [blocker()], outOfScopeBugs: [bug()] });
    const result = writeTriage(root, write, seams('from-v2'));

    expect(counts(result)).toEqual({ blockers: listOf(1, 0), outOfScopeBugs: listOf(1, 0) });
    expect(rawQuery(root, 'PRAGMA user_version'))
      .toEqual([{ user_version: SQLITE_SCHEMA_VERSION }]);
    expect(rawQuery(root, 'SELECT id FROM findings')).toEqual([{ id: 'f-1' }]);
    expect(columnOf(root, 'blockers', 'id')).toEqual(['from-v2-1']);
    expect(columnOf(root, 'out_of_scope_bugs', 'id')).toEqual(['from-v2-2']);
  });

  it.each(['blockers', 'out_of_scope_bugs'] as const)(
    'refuses a %s row with no what, or an empty field, in the schema itself',
    (table) => {
      const root = freshRoot(`schema-${table}`);
      writeTriage(root, writeOf({ blockers: [blocker()], outOfScopeBugs: [bug()] }));

      expect(() => rawInsert(root, table, { what: null }))
        .toThrow(`NOT NULL constraint failed: ${table}.what`);
      expect(() => rawInsert(root, table, { what: '' })).toThrow(/CHECK constraint failed/);
      expect(() => rawInsert(root, table, { artifact: '' })).toThrow(/CHECK constraint failed/);
      expect(() => rawInsert(root, table, { session_id: '' })).toThrow(/CHECK constraint failed/);
      expect(() => rawInsert(root, table, { id: '' })).toThrow(/CHECK constraint failed/);
      expect(() => rawInsert(root, table, { id: 'same' })).not.toThrow();
      expect(() => rawInsert(root, table, { id: 'same' }))
        .toThrow(`UNIQUE constraint failed: ${table}.id`);
    },
  );

  it('holds a security flag of 0, 1 or NULL, and nothing else', () => {
    const root = freshRoot('schema-security');
    writeTriage(root, writeOf({ outOfScopeBugs: [bug()] }));

    for (const security of [0, 1, null]) {
      expect(() => rawInsert(root, 'out_of_scope_bugs', { security })).not.toThrow();
    }
    expect(() => rawInsert(root, 'out_of_scope_bugs', { security: 2 }))
      .toThrow(/CHECK constraint failed/);
    expect(() => rawInsert(root, 'out_of_scope_bugs', { security: 'true' }))
      .toThrow(/CHECK constraint failed/);
  });

  it.each(['blockers', 'out_of_scope_bugs'] as const)(
    'refuses a repeated %s entry written from outside, a missing artifact and flag included',
    (table) => {
      const root = freshRoot(`schema-dedupe-${table}`);
      writeTriage(root, writeOf({ blockers: [blocker()], outOfScopeBugs: [bug()] }));
      const entry = { session_id: 's', what: 'w', artifact: null };

      expect(() => rawInsert(root, table, entry)).not.toThrow();
      expect(() => rawInsert(root, table, entry)).toThrow(/UNIQUE constraint failed/);
      expect(() => rawInsert(root, table, { ...entry, session_id: 't' })).not.toThrow();
    },
  );

  it('leaves outcome open in both tables, so a CI verdict can join it', () => {
    const root = freshRoot('open-outcome');
    writeTriage(root, writeOf({ blockers: [blocker()] }));

    for (const table of ['blockers', 'out_of_scope_bugs'] as const) {
      expect(() => rawInsert(root, table, { outcome: 'ci-failed' })).not.toThrow();
      expect(() => rawInsert(root, table, { outcome: null }))
        .toThrow(`NOT NULL constraint failed: ${table}.outcome`);
    }
  });
});

describe('writeTriage rows', () => {
  it('writes one row per entry: dispatch, entry, outcome, write time', () => {
    const root = freshRoot('rows');
    const write = writeOf({
      outcome: 'blocked',
      blockers: [blocker(), blocker({ what: 'no network', artifact: null })],
      outOfScopeBugs: [
        bug({ security: true }),
        bug({ what: 'token in log', artifact: null, security: false }),
        bug({ what: 'unflagged', security: null }),
      ],
    });
    const result = writeTriage(root, write, seams('rows'));
    const provenance = {
      session_id: 'aaaa-1111',
      plan_stub: 'phase-0',
      task_line: 'Add the blockers and out-of-scope-bug tables',
    };
    const written = { outcome: 'blocked', collected_at: '2026-09-13T10:00:00.000Z' };

    expect(result.path).toBe(storeFile(root));
    expect(counts(result)).toEqual({ blockers: listOf(2, 0), outOfScopeBugs: listOf(3, 0) });
    expect(blockerRows(root)).toEqual([
      {
        seq: 1,
        id: 'rows-1',
        ...provenance,
        what: 'LINEAR_API_KEY unset',
        artifact: '401 Unauthorized',
        ...written,
      },
      { seq: 2, id: 'rows-2', ...provenance, what: 'no network', artifact: null, ...written },
    ]);
    expect(bugRows(root)).toEqual([
      {
        seq: 1,
        id: 'rows-3',
        ...provenance,
        what: 'report writer drops the last line',
        artifact: 'Unexpected end of JSON input',
        security: 1,
        ...written,
      },
      {
        seq: 2,
        id: 'rows-4',
        ...provenance,
        what: 'token in log',
        artifact: null,
        security: 0,
        ...written,
      },
      {
        seq: 3,
        id: 'rows-5',
        ...provenance,
        what: 'unflagged',
        artifact: 'Unexpected end of JSON input',
        security: null,
        ...written,
      },
    ]);
  });

  it('stores a null plan stub as NULL in both tables', () => {
    const root = freshRoot('null-stub');
    const dispatch = { ...DISPATCH, planStub: null };
    const write = writeOf({ dispatch, blockers: [blocker()], outOfScopeBugs: [bug()] });
    writeTriage(root, write, seams('null-stub'));

    expect(columnOf(root, 'blockers', 'plan_stub')).toEqual([null]);
    expect(columnOf(root, 'out_of_scope_bugs', 'plan_stub')).toEqual([null]);
  });

  it('stamps every row of both tables with one time, taken once', () => {
    const root = freshRoot('one-time');
    let calls = 0;
    const now = (): Date => {
      calls += 1;
      return new Date(Date.UTC(2026, 8, 13, 10, calls));
    };
    const write = writeOf({
      blockers: [blocker(), blocker({ what: 'b' })],
      outOfScopeBugs: [bug(), bug({ what: 'c' })],
    });
    writeTriage(root, write, { ...seams('one-time'), now });
    const stamp = '2026-09-13T10:01:00.000Z';

    expect(calls).toBe(1);
    expect(columnOf(root, 'blockers', 'collected_at')).toEqual([stamp, stamp]);
    expect(columnOf(root, 'out_of_scope_bugs', 'collected_at')).toEqual([stamp, stamp]);
  });

  it('generates a distinct UUID per row across both tables and reads the clock by default', () => {
    const root = freshRoot('defaults');
    const before = Date.now();
    writeTriage(root, writeOf({ blockers: [blocker()], outOfScopeBugs: [bug(), bug({ what: 'x' })] }));
    const after = Date.now();
    const ids = [
      ...columnOf(root, 'blockers', 'id'),
      ...columnOf(root, 'out_of_scope_bugs', 'id'),
    ];
    const times = [
      ...columnOf(root, 'blockers', 'collected_at'),
      ...columnOf(root, 'out_of_scope_bugs', 'collected_at'),
    ];
    const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

    expect(ids).toHaveLength(3);
    expect(new Set(ids).size).toBe(3);
    for (const id of ids) expect(String(id)).toMatch(uuid);
    for (const at of times) {
      const time = Date.parse(String(at));
      expect(time).toBeGreaterThanOrEqual(before);
      expect(time).toBeLessThanOrEqual(after);
    }
  });

  it('carries a parsed report entry for entry', () => {
    const output = [
      'Blocked.',
      '',
      '```rafa:report',
      'status: blocked',
      'blockers:',
      '  - what: "LINEAR_API_KEY unset"',
      '    artifact: "401 Unauthorized"',
      '  - what: "the sibling checkout is absent"',
      '    extra_key: kept by the parser, not stored',
      'out_of_scope_bugs:',
      '  - what: "the hook path names a missing file"',
      '    artifact: "No such file or directory"',
      '    security: false',
      '  - what: "a token is printed in the log"',
      '    artifact: "ghp_"',
      '    security: true',
      '  - what: "a flag the report left out"',
      '```',
    ].join('\n');
    const reading = parseReport(output);
    if (!reading.present) throw new Error(reading.text);
    const root = freshRoot('parsed');
    const { blockers, outOfScopeBugs } = reading.report;
    writeTriage(root, writeOf({ blockers, outOfScopeBugs }), seams('parsed'));

    const blockerFields = (row: StoredBlocker | ReportBlocker): unknown => ({
      what: row.what,
      artifact: row.artifact,
    });
    const bugFields = (row: StoredBug | ReportBug): unknown => ({
      what: row.what,
      artifact: row.artifact,
      security: typeof row.security === 'boolean'
        ? Number(row.security)
        : row.security,
    });

    expect(blockers).toHaveLength(2);
    expect(outOfScopeBugs).toHaveLength(3);
    expect(blockerRows(root).map(blockerFields)).toEqual(blockers.map(blockerFields));
    expect(bugRows(root).map(bugFields)).toEqual(outOfScopeBugs.map(bugFields));
    expect(columnOf(root, 'out_of_scope_bugs', 'security')).toEqual([0, 1, null]);
  });
});

describe('deduplication', () => {
  it('keeps the first of two identical entries within a write, a missing artifact and flag included', () => {
    const root = freshRoot('identical');
    const bare = { artifact: null };
    const write = writeOf({
      blockers: [blocker(), blocker(), blocker(bare), blocker(bare)],
      outOfScopeBugs: [bug(), bug(), bug({ ...bare, security: null }), bug({ ...bare, security: null })],
    });
    const result = writeTriage(root, write, seams('identical'));

    expect(counts(result)).toEqual({ blockers: listOf(2, 2), outOfScopeBugs: listOf(2, 2) });
    expect(columnOf(root, 'blockers', 'id')).toEqual(['identical-1', 'identical-3']);
    expect(columnOf(root, 'out_of_scope_bugs', 'id')).toEqual(['identical-5', 'identical-7']);
  });

  it('dedupes against the disk, changing no byte on a repeated write', () => {
    const root = freshRoot('repeat');
    const write = writeOf({
      blockers: [blocker(), blocker({ artifact: null })],
      outOfScopeBugs: [bug(), bug({ artifact: null, security: null })],
    });
    writeTriage(root, write, seams('repeat'));
    const before = readRaw(root);
    const again = writeTriage(root, write, seams('repeat-again'));

    expect(counts(again)).toEqual({ blockers: listOf(0, 2), outOfScopeBugs: listOf(0, 2) });
    expect(readRaw(root)).toEqual(before);
  });

  it('stores two entries sharing an artifact but not a what as two rows', () => {
    const root = freshRoot('shared-artifact');
    const write = writeOf({
      blockers: [blocker(), blocker({ what: 'GITHUB_TOKEN unset' })],
      outOfScopeBugs: [bug(), bug({ what: 'another bug, same message' })],
    });
    const result = writeTriage(root, write, seams('shared-artifact'));

    expect(counts(result)).toEqual({ blockers: listOf(2, 0), outOfScopeBugs: listOf(2, 0) });
  });

  it('never drops a security flag as the duplicate of another', () => {
    const root = freshRoot('security-key');
    const write = writeOf({
      outOfScopeBugs: [bug({ security: false }), bug({ security: null }), bug({ security: true })],
    });
    const result = writeTriage(root, write, seams('security-key'));

    expect(counts(result)).toEqual({ blockers: listOf(0, 0), outOfScopeBugs: listOf(3, 0) });
    expect(columnOf(root, 'out_of_scope_bugs', 'security')).toEqual([0, null, 1]);
  });

  it('matches what and artifact byte for byte, and a missing artifact never matches one', () => {
    const root = freshRoot('exact');
    const what = 'LINEAR_API_KEY unset';
    const artifact = '401 Unauthorized';
    const whats = [what, 'linear_api_key unset', `${what} `];
    const artifacts = [artifact, '401 unauthorized', `${artifact} `, null];
    const entries = [
      ...whats.map((each) => ({ what: each, artifact })),
      ...artifacts.map((each) => ({ what, artifact: each })),
    ];
    const write = writeOf({
      blockers: entries.map((entry) => blocker(entry)),
      outOfScopeBugs: entries.map((entry) => bug(entry)),
    });
    const result = writeTriage(root, write, seams('exact'));

    expect(counts(result)).toEqual({ blockers: listOf(6, 1), outOfScopeBugs: listOf(6, 1) });
  });

  it('stores the same entries again for another session, so they can recur', () => {
    const root = freshRoot('recurrence');
    const lists = { blockers: [blocker()], outOfScopeBugs: [bug({ artifact: null })] };
    const ids = seams('recurrence');
    writeTriage(root, writeOf(lists), ids);
    const other = { ...DISPATCH, sessionId: 'bbbb-2222', taskLine: 'A later task' };
    const result = writeTriage(root, writeOf({ ...lists, dispatch: other }), ids);

    expect(counts(result)).toEqual({ blockers: listOf(1, 0), outOfScopeBugs: listOf(1, 0) });
    expect(columnOf(root, 'blockers', 'session_id')).toEqual(['aaaa-1111', 'bbbb-2222']);
    expect(columnOf(root, 'out_of_scope_bugs', 'session_id')).toEqual(['aaaa-1111', 'bbbb-2222']);
  });

  it('keeps the two lists apart: one what and artifact in both is a row in each', () => {
    const root = freshRoot('lists-apart');
    const shared = { what: 'the same text', artifact: 'the same artifact' };
    const write = writeOf({ blockers: [blocker(shared)], outOfScopeBugs: [bug(shared)] });
    const result = writeTriage(root, write, seams('lists-apart'));

    expect(counts(result)).toEqual({ blockers: listOf(1, 0), outOfScopeBugs: listOf(1, 0) });
  });
});

describe('entry rejections', () => {
  it.each([
    ['no what', { what: null }, 'what', 'missing-field', 'is missing'],
    ['a blank what', { what: '  ' }, 'what', 'unstorable-field', 'is blank'],
    ['an absent what', { what: undefined as never }, 'what', 'unstorable-field', 'is undefined, not a string'],
    ['a numeric artifact', { artifact: 404 as never }, 'artifact', 'unstorable-field', 'is 404, not a string'],
    ['a blank artifact', { artifact: '' }, 'artifact', 'unstorable-field', 'is blank'],
    ['a lone surrogate', { what: 'ab\uD800cd' }, 'what', 'unstorable-field', 'lone UTF-16 surrogate'],
  ] as const)('refuses a blocker with %s alone, writing the rest', (_label, overrides, field, reason, why) => {
    const root = freshRoot('blocker-refused');
    const blockers = [
      blocker({ what: 'kept before' }),
      blocker({ ...overrides }),
      blocker({ what: 'kept after' }),
    ];
    const result = writeTriage(root, writeOf({ blockers }), seams(`blocker-refused-${planted}`));

    expect(counts(result)).toEqual({ blockers: listOf(2, 0, [1]), outOfScopeBugs: listOf(0, 0) });
    expect(result.blockers.rejected[0]).toMatchObject({ index: 1, reason, field });
    expect(result.blockers.rejected[0]?.text).toStartWith(`blockers[1].${field} `);
    expect(result.blockers.rejected[0]?.text).toContain(why);
    expect(columnOf(root, 'blockers', 'what')).toEqual(['kept before', 'kept after']);
  });

  it.each([
    ['no what', { what: null }, 'what', 'missing-field', 'is missing'],
    ['a numeric artifact', { artifact: 7 as never }, 'artifact', 'unstorable-field', 'is 7, not a string'],
    ['a string flag', { security: 'yes' as never }, 'security', 'unstorable-field', 'is "yes", not a boolean'],
    ['a string flag that SQLite would coerce', { security: '1' as never }, 'security', 'unstorable-field', 'is "1", not a boolean'],
    ['a numeric flag', { security: 1 as never }, 'security', 'unstorable-field', 'is 1, not a boolean'],
  ] as const)('refuses a bug with %s alone, writing the rest', (_label, overrides, field, reason, why) => {
    const root = freshRoot('bug-refused');
    const outOfScopeBugs = [
      bug({ what: 'kept before' }),
      bug({ ...overrides }),
      bug({ what: 'kept after' }),
    ];
    const result = writeTriage(root, writeOf({ outOfScopeBugs }), seams(`bug-refused-${planted}`));

    expect(counts(result)).toEqual({ blockers: listOf(0, 0), outOfScopeBugs: listOf(2, 0, [1]) });
    expect(result.outOfScopeBugs.rejected[0]).toMatchObject({ index: 1, reason, field });
    expect(result.outOfScopeBugs.rejected[0]?.text).toStartWith(`out_of_scope_bugs[1].${field} `);
    expect(result.outOfScopeBugs.rejected[0]?.text).toContain(why);
    expect(result.outOfScopeBugs.rejected[0]?.text).toEndWith('; not written');
    expect(columnOf(root, 'out_of_scope_bugs', 'what')).toEqual(['kept before', 'kept after']);
  });

  it('adds up per list: appended, skipped and rejected', () => {
    const root = freshRoot('sum');
    const write = writeOf({
      blockers: [blocker(), blocker(), blocker({ what: null }), blocker({ what: 'y' })],
      outOfScopeBugs: [bug({ security: 'no' as never }), bug(), bug(), bug(), bug({ artifact: '' })],
    });
    const result = writeTriage(root, write, seams('sum'));

    expect(counts(result)).toEqual({
      blockers: listOf(2, 1, [2]),
      outOfScopeBugs: listOf(1, 2, [0, 4]),
    });
    for (const [list, length] of [[result.blockers, 4], [result.outOfScopeBugs, 5]] as const) {
      expect(list.appended + list.skipped + list.rejected.length).toBe(length);
    }
  });

  it('writes one list when every entry of the other is refused', () => {
    const root = freshRoot('one-list');
    const write = writeOf({ blockers: [blocker({ what: null })], outOfScopeBugs: [bug()] });
    const result = writeTriage(root, write, seams('one-list'));

    expect(counts(result)).toEqual({ blockers: listOf(0, 0, [0]), outOfScopeBugs: listOf(1, 0) });
    expect(blockerRows(root)).toEqual([]);
    expect(bugRows(root)).toHaveLength(1);
  });

  it('creates no file and no directory when every entry of both lists is refused', () => {
    const root = freshRoot('all-refused');
    const write = writeOf({
      blockers: [blocker({ what: null })],
      outOfScopeBugs: [bug({ security: 'maybe' as never })],
    });
    const result = writeTriage(root, write, seams('all-refused'));

    expect(counts(result)).toEqual({ blockers: listOf(0, 0, [0]), outOfScopeBugs: listOf(0, 0, [0]) });
    expect(existsSync(root)).toBe(false);
  });

  it('creates no file and no directory for two empty lists', () => {
    const root = freshRoot('empty');
    const result = writeTriage(root, writeOf(), seams('empty'));

    expect(result).toEqual({
      path: storeFile(root),
      blockers: { appended: 0, skipped: 0, rejected: [] },
      outOfScopeBugs: { appended: 0, skipped: 0, rejected: [] },
    });
    expect(existsSync(root)).toBe(false);
  });
});

describe('whole-write refusals', () => {
  it.each([
    ['an empty session id', { dispatch: { ...DISPATCH, sessionId: '' } }, 'session id ""'],
    ['an unknown outcome', { outcome: 'succeeded' as never }, 'outcome "succeeded"'],
    ['a null task line', { dispatch: { ...DISPATCH, taskLine: null as never } }, 'task line null'],
    ['a numeric plan stub', { dispatch: { ...DISPATCH, planStub: 7 as never } }, 'plan stub 7'],
    [
      'a lone surrogate in the session id',
      { dispatch: { ...DISPATCH, sessionId: 'x\uDC00' } },
      'session id holding a lone UTF-16 surrogate',
    ],
  ] as const)('refuses %s even with both lists empty, creating nothing', (_label, overrides, why) => {
    const root = freshRoot('refused-write');
    const refusal = refusalOf(() => writeTriage(root, writeOf(overrides)));

    expect(refusal).toStartWith('effort store: triage write ');
    expect(refusal).toContain(why);
    expect(refusal).toEndWith('; nothing written');
    expect(existsSync(root)).toBe(false);
  });

  it('refuses before opening an existing store, changing no byte', () => {
    const root = freshRoot('refused-existing');
    writeTriage(root, writeOf({ blockers: [blocker()] }), seams('refused-existing'));
    const before = readRaw(root);
    const write = writeOf({ outcome: 'passed' as never, outOfScopeBugs: [bug()] });

    expect(() => writeTriage(root, write)).toThrow('not one of done, blocked, failed');
    expect(readRaw(root)).toEqual(before);
  });

  it('rolls both tables back when a generated id repeats in the second', () => {
    const root = freshRoot('id-repeat');
    writeTriage(root, writeOf({ blockers: [blocker()] }), seams('id-repeat'));
    const before = readRaw(root);
    const write = writeOf({
      blockers: [blocker({ what: 'inserted, then rolled back' })],
      outOfScopeBugs: [bug({ what: 'a' }), bug({ what: 'b' })],
    });

    expect(() => writeTriage(root, write, { newId: () => 'same' }))
      .toThrow('UNIQUE constraint failed: out_of_scope_bugs.id');
    expect(readRaw(root)).toEqual(before);
    expect(columnOf(root, 'blockers', 'what')).toEqual(['LINEAR_API_KEY unset']);
    expect(bugRows(root)).toEqual([]);
  });

  it('refuses a store past the version this rafa knows, touching nothing', () => {
    const root = freshRoot('newer');
    writeTriage(root, writeOf({ blockers: [blocker()] }), seams('newer'));
    const db = new Database(storeFile(root));
    db.run(`PRAGMA user_version = ${SQLITE_SCHEMA_VERSION + 1}`);
    db.close();
    const before = readRaw(root);

    expect(() => writeTriage(root, writeOf({ outOfScopeBugs: [bug()] }), seams('newer-2')))
      .toThrow(`past the ${SQLITE_SCHEMA_VERSION} this rafa knows`);
    expect(readRaw(root)).toEqual(before);
  });
});
