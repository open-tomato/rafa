/**
 * Tests for the findings writer and the migration that creates its
 * table.
 *
 * Every store sits under a fresh temporary repo root, and the disk is
 * real. Every reading goes through `bun:sqlite` directly and never
 * through the module, so the column names, the constraints and the
 * dedupe rule are spelled here as the spec gives them rather than read
 * off the code under test.
 *
 * Findings are built in the shape `parseReport` answers, and one case
 * feeds the writer the report the spec illustrates, parsed for real.
 *
 * Twenty mutations of the writer and its migration were driven
 * against this file alone, and every one reddened at least one of its
 * 43 cases, with the unmutated sources green before and after and
 * restored byte-identical: dedupe made table-wide (session id dropped
 * from both indexes and both conflict targets), one bare `ON CONFLICT
 * DO NOTHING`, rejected entries written anyway, the whole-write check
 * dropped, the clock read per row, blank text accepted, a lone
 * surrogate accepted, the kind and signal sets unchecked, an unkeyed
 * entry accepted, an empty write creating a store that does not exist,
 * an empty write leaving a store that exists unopened (red only on the
 * empty write past the last version), `tracker_ref` written non-null,
 * the outcome set unchecked, an empty session id accepted, a lone
 * surrogate in the dispatch accepted, the store never created,
 * `skill-suggestion` dropped from the migration's kind set, a CHECK
 * added on outcome, and the unkeyed-row and blank-artifact CHECKs
 * dropped from the migration.
 */
import type { FindingsWrite, FindingsWriterSeams } from './findings.js';
import type { ReportFinding } from '../../report/parse.js';

import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { Database } from 'bun:sqlite';
import { afterAll, describe, expect, it } from 'bun:test';

import { FINDING_KINDS, FINDING_SIGNALS, parseReport } from '../../report/parse.js';

import { FINDING_OUTCOMES, writeFindings } from './findings.js';
import {
  migrateSchema,
  openSqliteStore,
  SQLITE_MIGRATIONS,
  SQLITE_SCHEMA_VERSION,
} from './sqlite.js';

/** A findings row as the table holds it, by the spec's column names. */
interface StoredFinding {
  seq: number;
  id: string;
  session_id: string;
  plan_stub: string | null;
  task_line: string;
  kind: string | null;
  trigger: string | null;
  what: string | null;
  cause: string | null;
  resolution: string | null;
  artifact: string | null;
  signal: string | null;
  outcome: string;
  tracker_ref: string | null;
  collected_at: string;
}

/** The spec's columns, in its order, after the append order. */
const COLUMNS = [
  'seq',
  'id',
  'session_id',
  'plan_stub',
  'task_line',
  'kind',
  'trigger',
  'what',
  'cause',
  'resolution',
  'artifact',
  'signal',
  'outcome',
  'tracker_ref',
  'collected_at',
];

const tempBase = mkdtempSync(join(tmpdir(), 'rafa-findings-'));
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

/** Runs one statement against an existing store file, module uninvolved. */
function rawRun(root: string, sql: string, ...bindings: (string | null)[]): void {
  const db = new Database(storeFile(root), { readwrite: true, create: false });
  try {
    db.query<unknown, (string | null)[]>(sql).run(...bindings);
  } finally {
    db.close();
  }
}

/** Every findings row, in append order. */
function rowsOf(root: string): StoredFinding[] {
  return rawQuery<StoredFinding>(root, 'SELECT * FROM findings ORDER BY seq');
}

/** One column of every findings row, in append order. */
function columnOf(root: string, column: keyof StoredFinding): unknown[] {
  return rowsOf(root).map((row) => row[column]);
}

/**
 * Inserts one findings row by hand, bypassing the writer, with every
 * column valid unless overridden.
 */
function rawInsert(root: string, overrides: Partial<StoredFinding> = {}): void {
  const row = {
    id: `raw-${planted}-${Math.random()}`,
    session_id: 'raw-session',
    plan_stub: null,
    task_line: 'A raw task',
    kind: 'gotcha',
    trigger: 'a raw trigger',
    what: 'a raw what',
    cause: null,
    resolution: null,
    artifact: `raw artifact ${Math.random()}`,
    signal: 'loud',
    outcome: 'done',
    tracker_ref: null,
    collected_at: '2026-09-13T00:00:00.000Z',
    ...overrides,
  };
  const names = Object.keys(row);
  const values = Object.values(row).map((value) => value === null
    ? null
    : String(value));
  const holes = names.map(() => '?').join(', ');
  rawRun(root, `INSERT INTO findings (${names.join(', ')}) VALUES (${holes})`, ...values);
}

/** A finding as `parseReport` answers one, every field filled. */
function finding(overrides: Partial<ReportFinding> = {}): ReportFinding {
  return {
    trigger: 'when running bun test under a fresh worktree',
    kind: 'gotcha',
    what: 'node_modules is absent after fork',
    cause: 'worktree creation does not run bun install',
    resolution: 'run bun install before the first test',
    artifact: 'Cannot find package',
    signal: 'loud',
    domain: null,
    extras: [],
    ...overrides,
  };
}

/** The dispatch most cases write under. */
const DISPATCH = {
  sessionId: 'aaaa-1111',
  planStub: 'phase-0',
  taskLine: 'Add the findings table',
};

/** A write of `findings` under the default dispatch, outcome `done`. */
function writeOf(
  findings: readonly ReportFinding[],
  overrides: Partial<FindingsWrite> = {},
): FindingsWrite {
  return { dispatch: DISPATCH, outcome: 'done', findings, ...overrides };
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

/** A write's counts and the indexes it refused, with its path left out. */
function counts(result: ReturnType<typeof writeFindings>): unknown {
  return {
    appended: result.appended,
    skipped: result.skipped,
    rejected: result.rejected.map(({ index }) => index),
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

describe('the findings migration', () => {
  it('creates the findings table with the spec columns, in order', () => {
    const root = freshRoot('columns');
    writeFindings(root, writeOf([finding()]), seams('columns'));
    const columns = 'SELECT name FROM pragma_table_info(?) ORDER BY cid';

    expect(rawQuery<{ name: string }>(root, columns, 'findings').map(({ name }) => name))
      .toEqual(COLUMNS);
    expect(rawQuery(root, 'PRAGMA user_version'))
      .toEqual([{ user_version: SQLITE_SCHEMA_VERSION }]);
  });

  it('brings a version-1 store forward, keeping the rows it holds', () => {
    const root = freshRoot('from-v1');
    mkdirSync(dirname(storeFile(root)), { recursive: true });
    const db = new Database(storeFile(root), { create: true, readwrite: true });
    migrateSchema(db, storeFile(root), SQLITE_MIGRATIONS.slice(0, 1));
    db.run(
      'INSERT INTO sessions (session_id, row_json) VALUES (?, ?)',
      ['s-1', '{"sessionId":"s-1"}'],
    );
    db.close();

    const result = writeFindings(root, writeOf([finding()]), seams('from-v1'));

    expect(result.appended).toBe(1);
    expect(rawQuery(root, 'PRAGMA user_version'))
      .toEqual([{ user_version: SQLITE_SCHEMA_VERSION }]);
    expect(openSqliteStore(root).read('sessions')).toEqual([
      { sessionId: 's-1' } as never,
    ]);
    expect(columnOf(root, 'id')).toEqual(['from-v1-1']);
  });

  it('refuses a row with no key, or a blank one, in the schema itself', () => {
    const root = freshRoot('schema-keys');
    writeFindings(root, writeOf([finding()]), seams('schema-keys'));

    expect(() => rawInsert(root, { artifact: null, trigger: null }))
      .toThrow(/CHECK constraint failed/);
    expect(() => rawInsert(root, { artifact: null, what: null }))
      .toThrow(/CHECK constraint failed/);
    expect(() => rawInsert(root, { artifact: '' })).toThrow(/CHECK constraint failed/);
    expect(() => rawInsert(root, { trigger: '' })).toThrow(/CHECK constraint failed/);
    expect(() => rawInsert(root, { what: '' })).toThrow(/CHECK constraint failed/);
    expect(() => rawInsert(root, { session_id: '' })).toThrow(/CHECK constraint failed/);
    expect(() => rawInsert(root, { id: 'columns-1', session_id: 'x' }))
      .not.toThrow();
    expect(() => rawInsert(root, { id: 'columns-1', session_id: 'y' }))
      .toThrow(/UNIQUE constraint failed: findings.id/);
  });

  it('holds exactly the kinds and signals the report parser answers', () => {
    const root = freshRoot('closed-sets');
    writeFindings(root, writeOf([finding()]), seams('closed-sets'));

    for (const kind of FINDING_KINDS) {
      expect(() => rawInsert(root, { kind })).not.toThrow();
    }
    for (const signal of FINDING_SIGNALS) {
      expect(() => rawInsert(root, { signal })).not.toThrow();
    }
    expect(() => rawInsert(root, { kind: 'Gotcha' })).toThrow(/CHECK constraint failed/);
    expect(() => rawInsert(root, { signal: 'noisy' })).toThrow(/CHECK constraint failed/);
    expect(() => rawInsert(root, { kind: null, signal: null })).not.toThrow();
  });

  it('leaves outcome open, so a CI verdict can join it', () => {
    const root = freshRoot('open-outcome');
    writeFindings(root, writeOf([finding()]), seams('open-outcome'));

    expect(() => rawInsert(root, { outcome: 'ci-failed' })).not.toThrow();
    expect(() => rawInsert(root, { outcome: null as never }))
      .toThrow(/NOT NULL constraint failed: findings.outcome/);
  });
});

describe('writeFindings rows', () => {
  it('writes one row per entry: dispatch, entry, outcome, null tracker ref, write time', () => {
    const root = freshRoot('rows');
    const sparse = finding({
      trigger: 'when a gate exits 0 on a skipped suite',
      kind: 'pattern',
      what: 'green does not mean ran',
      cause: null,
      resolution: null,
      artifact: null,
      signal: 'silent',
    });
    const result = writeFindings(
      root,
      writeOf([finding(), sparse], { outcome: 'blocked' }),
      seams('rows'),
    );

    expect(result.path).toBe(storeFile(root));
    expect(counts(result)).toEqual({ appended: 2, skipped: 0, rejected: [] });
    expect(rowsOf(root)).toEqual([
      {
        seq: 1,
        id: 'rows-1',
        session_id: 'aaaa-1111',
        plan_stub: 'phase-0',
        task_line: 'Add the findings table',
        kind: 'gotcha',
        trigger: 'when running bun test under a fresh worktree',
        what: 'node_modules is absent after fork',
        cause: 'worktree creation does not run bun install',
        resolution: 'run bun install before the first test',
        artifact: 'Cannot find package',
        signal: 'loud',
        outcome: 'blocked',
        tracker_ref: null,
        collected_at: '2026-09-13T10:00:00.000Z',
      },
      {
        seq: 2,
        id: 'rows-2',
        session_id: 'aaaa-1111',
        plan_stub: 'phase-0',
        task_line: 'Add the findings table',
        kind: 'pattern',
        trigger: 'when a gate exits 0 on a skipped suite',
        what: 'green does not mean ran',
        cause: null,
        resolution: null,
        artifact: null,
        signal: 'silent',
        outcome: 'blocked',
        tracker_ref: null,
        collected_at: '2026-09-13T10:00:00.000Z',
      },
    ]);
  });

  it('stores a null plan stub as NULL', () => {
    const root = freshRoot('null-stub');
    const dispatch = { ...DISPATCH, planStub: null };
    writeFindings(root, writeOf([finding()], { dispatch }), seams('null-stub'));

    expect(columnOf(root, 'plan_stub')).toEqual([null]);
  });

  it.each([...FINDING_OUTCOMES])('stores the outcome %s', (outcome) => {
    const root = freshRoot(`outcome-${outcome}`);
    writeFindings(root, writeOf([finding()], { outcome }), seams(`outcome-${outcome}`));

    expect(columnOf(root, 'outcome')).toEqual([outcome]);
  });

  it('stamps every row of one write with one time, taken once', () => {
    const root = freshRoot('one-time');
    let calls = 0;
    const now = (): Date => {
      calls += 1;
      return new Date(Date.UTC(2026, 8, 13, 10, calls));
    };
    const entries = [finding(), finding({ artifact: 'b' }), finding({ artifact: 'c' })];
    writeFindings(root, writeOf(entries), { ...seams('one-time'), now });

    expect(calls).toBe(1);
    expect(columnOf(root, 'collected_at')).toEqual([
      '2026-09-13T10:01:00.000Z',
      '2026-09-13T10:01:00.000Z',
      '2026-09-13T10:01:00.000Z',
    ]);
  });

  it('generates a distinct UUID per row and reads the clock by default', () => {
    const root = freshRoot('defaults');
    const before = Date.now();
    writeFindings(root, writeOf([finding(), finding({ artifact: 'other' })]));
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
      'findings:',
      '  - trigger: "when running bun test under a fresh worktree"',
      '    kind: gotcha',
      '    what: "node_modules is absent after fork"',
      '    cause: "worktree creation does not run bun install"',
      '    resolution: "run bun install before the first test"',
      '    artifact: "Cannot find package"',
      '    signal: loud',
      '  - trigger: "when a suite is gated on an env var"',
      '    kind: pattern',
      '    what: "describe.skipIf still runs its callback"',
      '    signal: silent',
      '    extra_key: kept by the parser, not stored',
      '```',
    ].join('\n');
    const reading = parseReport(output);
    if (!reading.present) throw new Error(reading.text);
    const root = freshRoot('parsed');
    writeFindings(root, writeOf(reading.report.findings), seams('parsed'));

    const fieldsOf = (row: StoredFinding | ReportFinding): unknown => {
      const { kind, trigger, what, cause, resolution, artifact, signal } = row;
      return { kind, trigger, what, cause, resolution, artifact, signal };
    };

    expect(reading.report.findings).toHaveLength(2);
    expect(rowsOf(root).map(fieldsOf)).toEqual(reading.report.findings.map(fieldsOf));
  });
});

describe('deduplication', () => {
  it('keeps the first of two entries sharing an artifact', () => {
    const root = freshRoot('same-artifact');
    const first = finding({ trigger: 't1', what: 'w1', resolution: 'r1' });
    const second = finding({ trigger: 't2', what: 'w2', resolution: 'r2' });
    const result = writeFindings(root, writeOf([first, second]), seams('same-artifact'));

    expect(counts(result)).toEqual({ appended: 1, skipped: 1, rejected: [] });
    expect(columnOf(root, 'trigger')).toEqual(['t1']);
  });

  it('keeps the first of two artifactless entries sharing trigger and what', () => {
    const root = freshRoot('same-trigger-what');
    const first = finding({ artifact: null, cause: 'c1' });
    const second = finding({ artifact: null, cause: 'c2', kind: 'pattern' });
    const result = writeFindings(root, writeOf([first, second]), seams('same-trigger-what'));

    expect(counts(result)).toEqual({ appended: 1, skipped: 1, rejected: [] });
    expect(columnOf(root, 'cause')).toEqual(['c1']);
  });

  it.each([
    ['with an artifact', 'Cannot find package'],
    ['without an artifact', null],
  ])('dedupes two entries differing only in resolution, %s', (_label, artifact) => {
    const root = freshRoot('only-resolution');
    const first = finding({ artifact, resolution: 'first' });
    const second = finding({ artifact, resolution: 'second' });
    const result = writeFindings(root, writeOf([first, second]), seams(`only-resolution-${planted}`));

    expect(counts(result)).toEqual({ appended: 1, skipped: 1, rejected: [] });
    expect(columnOf(root, 'resolution')).toEqual(['first']);
  });

  it('matches artifact, trigger and what byte for byte', () => {
    const root = freshRoot('exact');
    const entries = [
      finding({ artifact: 'Cannot find package' }),
      finding({ artifact: 'cannot find package' }),
      finding({ artifact: 'Cannot find package ' }),
      finding({ artifact: null, trigger: 'T', what: 'W' }),
      finding({ artifact: null, trigger: 't', what: 'W' }),
      finding({ artifact: null, trigger: 'T', what: 'W ' }),
    ];
    const result = writeFindings(root, writeOf(entries), seams('exact'));

    expect(counts(result)).toEqual({ appended: 6, skipped: 0, rejected: [] });
  });

  it('never dedupes an entry with an artifact against one without', () => {
    const root = freshRoot('mixed-keys');
    const entries = [finding(), finding({ artifact: null })];
    const result = writeFindings(root, writeOf(entries), seams('mixed-keys'));

    expect(counts(result)).toEqual({ appended: 2, skipped: 0, rejected: [] });
    expect(columnOf(root, 'artifact')).toEqual(['Cannot find package', null]);
  });

  it('dedupes against the disk, changing no byte on a repeated write', () => {
    const root = freshRoot('repeat');
    const entries = [finding(), finding({ artifact: null })];
    const ids = seams('repeat');
    writeFindings(root, writeOf(entries), ids);
    const before = readRaw(root);
    const again = writeFindings(root, writeOf(entries), ids);

    expect(counts(again)).toEqual({ appended: 0, skipped: 2, rejected: [] });
    expect(readRaw(root)).toEqual(before);
    expect(columnOf(root, 'id')).toEqual(['repeat-1', 'repeat-2']);
  });

  it('stores the same findings again for another session, so they can recur', () => {
    const root = freshRoot('recurrence');
    const entries = [finding(), finding({ artifact: null })];
    const ids = seams('recurrence');
    writeFindings(root, writeOf(entries), ids);
    const other = { ...DISPATCH, sessionId: 'bbbb-2222', taskLine: 'A later task' };
    const result = writeFindings(root, writeOf(entries, { dispatch: other }), ids);

    expect(counts(result)).toEqual({ appended: 2, skipped: 0, rejected: [] });
    expect(columnOf(root, 'session_id'))
      .toEqual(['aaaa-1111', 'aaaa-1111', 'bbbb-2222', 'bbbb-2222']);
  });
});

describe('entry rejections', () => {
  it.each([
    ['a blank artifact', { artifact: '  ' }, 'artifact', 'is blank'],
    ['a blank what', { what: '' }, 'what', 'is blank'],
    ['a numeric trigger', { trigger: 42 as never }, 'trigger', 'is 42, not a string'],
    ['an absent what', { what: undefined as never }, 'what', 'is undefined, not a string'],
    ['a lone surrogate', { cause: 'ab\uD800cd' }, 'cause', 'lone UTF-16 surrogate'],
    ['a kind outside the set', { kind: 'gotchas' as never }, 'kind', 'not one of gotcha'],
    ['a signal outside the set', { signal: 'Loud' as never }, 'signal', 'not one of loud, silent'],
  ])('refuses %s alone, writing the rest', (_label, overrides, field, why) => {
    const root = freshRoot('unstorable');
    const entries = [
      finding({ artifact: 'kept before' }),
      finding({ artifact: 'refused', ...overrides }),
      finding({ artifact: 'kept after' }),
    ];
    const result = writeFindings(root, writeOf(entries), seams(`unstorable-${planted}`));

    expect(counts(result)).toEqual({ appended: 2, skipped: 0, rejected: [1] });
    expect(result.rejected[0]).toMatchObject({ index: 1, reason: 'unstorable-field', field });
    expect(result.rejected[0]?.text).toContain(`findings[1].${field} `);
    expect(result.rejected[0]?.text).toContain(why);
    expect(columnOf(root, 'artifact')).toEqual(['kept before', 'kept after']);
  });

  it.each([
    ['no trigger', { trigger: null }],
    ['no what', { what: null }],
    ['neither', { trigger: null, what: null }],
  ])('refuses an artifactless entry with %s as unkeyed', (_label, overrides) => {
    const root = freshRoot('unkeyed');
    const entries = [finding({ artifact: null, ...overrides }), finding()];
    const result = writeFindings(root, writeOf(entries), seams(`unkeyed-${planted}`));

    expect(counts(result)).toEqual({ appended: 1, skipped: 0, rejected: [0] });
    expect(result.rejected[0]).toMatchObject({ index: 0, reason: 'unkeyed', field: null });
    expect(result.rejected).toHaveLength(1);
  });

  it('adds up to the list: appended, skipped and rejected', () => {
    const root = freshRoot('sum');
    const entries = [
      finding(),
      finding({ trigger: 'dup of 0' }),
      finding({ artifact: null, what: null }),
      finding({ artifact: 'x', kind: 'nope' as never }),
      finding({ artifact: 'y' }),
    ];
    const result = writeFindings(root, writeOf(entries), seams('sum'));

    expect(counts(result)).toEqual({ appended: 2, skipped: 1, rejected: [2, 3] });
    expect(result.appended + result.skipped + result.rejected.length).toBe(entries.length);
  });

  it('creates no file and no directory when every entry is refused', () => {
    const root = freshRoot('all-refused');
    const entries = [finding({ artifact: null, trigger: null }), finding({ kind: 'x' as never })];
    const result = writeFindings(root, writeOf(entries), seams('all-refused'));

    expect(counts(result)).toEqual({ appended: 0, skipped: 0, rejected: [0, 1] });
    expect(existsSync(root)).toBe(false);
  });

  it('creates no file and no directory for an empty findings list', () => {
    const root = freshRoot('empty');
    const result = writeFindings(root, writeOf([]), seams('empty'));

    expect(result).toEqual({ path: storeFile(root), appended: 0, skipped: 0, rejected: [] });
    expect(existsSync(root)).toBe(false);
  });
});

describe('whole-write refusals', () => {
  it.each([
    ['an empty session id', writeOf([], { dispatch: { ...DISPATCH, sessionId: '' } }), 'session id ""'],
    ['an unknown outcome', writeOf([], { outcome: 'succeeded' as never }), 'outcome "succeeded"'],
    ['a null task line', writeOf([], { dispatch: { ...DISPATCH, taskLine: null as never } }), 'task line null'],
    ['a numeric plan stub', writeOf([], { dispatch: { ...DISPATCH, planStub: 7 as never } }), 'plan stub 7'],
    [
      'a lone surrogate in the task line',
      writeOf([], { dispatch: { ...DISPATCH, taskLine: 'x\uDC00' } }),
      'task line holding a lone UTF-16 surrogate',
    ],
  ])('refuses %s even with no findings, creating nothing', (_label, write, why) => {
    const root = freshRoot('refused-write');
    const refusal = refusalOf(() => writeFindings(root, write));

    expect(refusal).toStartWith('effort store: findings write ');
    expect(refusal).toContain(why);
    expect(refusal).toEndWith('; nothing written');
    expect(existsSync(root)).toBe(false);
  });

  it('refuses before opening an existing store, changing no byte', () => {
    const root = freshRoot('refused-existing');
    writeFindings(root, writeOf([finding()]), seams('refused-existing'));
    const before = readRaw(root);

    expect(() => writeFindings(root, writeOf([finding({ artifact: 'new' })], {
      outcome: 'passed' as never,
    }))).toThrow('not one of done, blocked, failed');
    expect(readRaw(root)).toEqual(before);
  });

  it('rolls the whole write back when a generated id repeats', () => {
    const root = freshRoot('id-repeat');
    writeFindings(root, writeOf([finding()]), seams('id-repeat'));
    const before = readRaw(root);
    const entries = [finding({ artifact: 'a' }), finding({ artifact: 'b' })];

    expect(() => writeFindings(root, writeOf(entries), { newId: () => 'same' }))
      .toThrow('UNIQUE constraint failed: findings.id');
    expect(readRaw(root)).toEqual(before);
    expect(columnOf(root, 'id')).toEqual(['id-repeat-1']);
  });

  it('refuses a store past the version this rafa knows, touching nothing', () => {
    const root = freshRoot('newer');
    writeFindings(root, writeOf([finding()]), seams('newer'));
    const db = new Database(storeFile(root));
    db.run(`PRAGMA user_version = ${SQLITE_SCHEMA_VERSION + 1}`);
    db.close();
    const before = readRaw(root);

    expect(() => writeFindings(root, writeOf([finding({ artifact: 'new' })]), seams('newer-2')))
      .toThrow(`past the ${SQLITE_SCHEMA_VERSION} this rafa knows`);
    expect(readRaw(root)).toEqual(before);
  });

  it('refuses an empty write on a store past the version this rafa knows, bytes untouched', () => {
    const root = freshRoot('newer-empty');
    writeFindings(root, writeOf([finding()]), seams('newer-empty'));
    const current = readRaw(root);
    const control = writeFindings(root, writeOf([]));

    expect(counts(control)).toEqual({ appended: 0, skipped: 0, rejected: [] });
    expect(readRaw(root)).toEqual(current);

    const newer = SQLITE_SCHEMA_VERSION + 1;
    const db = new Database(storeFile(root));
    db.run(`PRAGMA user_version = ${newer}`);
    db.close();
    const before = readRaw(root);
    const refusal = `is at schema version ${newer}, past the`
      + ` ${SQLITE_SCHEMA_VERSION} this rafa knows`;
    const allRefused = [finding({ artifact: null, trigger: null })];

    expect(() => writeFindings(root, writeOf([]))).toThrow(refusal);
    expect(() => writeFindings(root, writeOf(allRefused))).toThrow(refusal);
    expect(readRaw(root)).toEqual(before);
  });
});
