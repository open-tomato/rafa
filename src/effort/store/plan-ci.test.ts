/**
 * Tests for the plan CI writer, its reader, the reading of a verdict and
 * a plan stub off a pull request, and the migration that creates their
 * table.
 *
 * Every store sits under a fresh temporary repo root, and the disk is
 * real. Every reading of the table goes through `bun:sqlite` directly and
 * never through the module, save in the reader's own cases, so the
 * columns and the key are spelled here rather than read off the code
 * under test.
 *
 * Each refusal sits beside the write it was varied from, which the store
 * takes, so a writer refusing everything reddens.
 */
import type { PlanCiPullRequest, PlanCiRow } from './plan-ci.js';
import type { CheckRow } from '../../pr/checks.js';

import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { Database } from 'bun:sqlite';
import { afterAll, describe, expect, it } from 'bun:test';

import { LEGACY_GATE_OPEN } from './migrations.js';
import {
  planCiReading,
  planStubOfBranch,
  readPlanCi,
  recordPlanCi,
  writePlanCi,
} from './plan-ci.js';
import {
  migrateSchema,
  SQLITE_MIGRATIONS,
  sqliteStorePath,
} from './sqlite.js';

/** A plan CI row as the table holds it. */
interface StoredPlanCi {
  seq: number;
  plan_stub: string;
  pr: number;
  head_sha: string;
  verdict: string;
  failing: string;
  read_at: string;
  origin_store: string | null;
  origin_seq: number | null;
}

/** The table's columns, in order. */
const COLUMNS = ['seq', 'plan_stub', 'pr', 'head_sha', 'verdict', 'failing', 'read_at', 'origin_store', 'origin_seq'];

/** Every table a store at the last version holds, by name. */
const TABLES = [
  'blockers',
  'changes',
  'commits',
  'dispatches',
  'findings',
  'merge_conflicts',
  'merges',
  'out_of_scope_bugs',
  'plan_ci',
  'preflight',
  'report_absences',
  'schema_migrations',
  'sessions',
  'skill_invocations',
  'store_meta',
  'task_reports',
];

/** A lone high surrogate, built from its code unit. */
const LONE_HIGH = String.fromCharCode(0xd800);

/** The time every reading here is stamped with. */
const READ_AT = '2026-09-27T12:00:00.000Z';

/** A red reading of one plan's pull request. */
const RED: PlanCiRow = {
  planStub: 'rafa-24-know-which-skills-earn',
  pr: 42,
  headSha: 'a1b2c3d',
  verdict: 'red',
  failing: ['lint', 'test'],
  readAt: READ_AT,
};

/** The pull request the readings below are taken of. */
const PULL: PlanCiPullRequest = {
  number: 42,
  headRefName: 'feat/rafa-24-know-which-skills-earn',
  headRefOid: 'a1b2c3d',
};

/** A check row with `outcome` as given. */
function check(name: string, outcome: CheckRow['outcome']): CheckRow {
  const state = { pass: 'SUCCESS', fail: 'FAILURE', pending: 'IN_PROGRESS' }[outcome];
  return { name, state, link: '', outcome };
}

const tempBase = mkdtempSync(join(tmpdir(), 'rafa-plan-ci-'));
let planted = 0;

afterAll(() => {
  rmSync(tempBase, { recursive: true, force: true });
});

/** A new repo root under {@link tempBase}, not yet created. */
function freshRoot(name: string): string {
  planted += 1;
  return join(tempBase, `${planted}-${name}`);
}

/** Every row a query answers over the store under `root`, opened read-only. */
function rawQuery<T>(root: string, sql: string, ...params: string[]): T[] {
  const db = new Database(sqliteStorePath(root), { readonly: true });
  try {
    return db.query<T, string[]>(sql).all(...params);
  } finally {
    db.close();
  }
}

/** Every plan CI row under `root`, in append order. */
function rowsOf(root: string): StoredPlanCi[] {
  return rawQuery<StoredPlanCi>(root, 'SELECT * FROM plan_ci ORDER BY seq');
}

/** Every table under `root`, by name. */
function tablesOf(root: string): string[] {
  const tables = rawQuery<{ name: string }>(root, 'SELECT name FROM sqlite_master WHERE type = ? ORDER BY name', 'table');
  return tables.map(({ name }) => name);
}

/** A store under `root` migrated to `version` and no further. */
function plantAtVersion(root: string, version: number): void {
  mkdirSync(dirname(sqliteStorePath(root)), { recursive: true });
  const db = new Database(sqliteStorePath(root), { create: true, readwrite: true });
  migrateSchema(db, sqliteStorePath(root), SQLITE_MIGRATIONS.slice(0, version));
  db.close();
}

/** A plans directory under `root` holding one plan file per stub. */
function plantPlans(root: string, stubs: readonly string[]): void {
  const dir = join(root, '.rafa', 'plans');
  mkdirSync(dir, { recursive: true });
  for (const stub of stubs) writeFileSync(join(dir, `PLAN-${stub}.md`), '# plan\n');
}

describe('the plan_ci table', () => {
  it('is created at the last version, holding one written reading', () => {
    const root = freshRoot('fresh');

    const result = writePlanCi(root, RED);

    expect(result).toEqual({ path: sqliteStorePath(root), appended: 1 });
    const columns = rawQuery<{ name: string }>(root, 'SELECT name FROM pragma_table_info(?) ORDER BY cid', 'plan_ci');
    expect(columns.map(({ name }) => name)).toEqual(COLUMNS);
    expect(tablesOf(root)).toEqual(TABLES);
    expect(rawQuery(root, 'PRAGMA user_version')).toEqual([{ user_version: LEGACY_GATE_OPEN }]);
    expect(rowsOf(root)).toEqual([{
      seq: 1,
      plan_stub: 'rafa-24-know-which-skills-earn',
      pr: 42,
      head_sha: 'a1b2c3d',
      verdict: 'red',
      failing: '["lint","test"]',
      read_at: READ_AT,
      origin_store: null,
      origin_seq: null,
    }]);
  });

  it('brings a version-12 store forward, keeping the rows it holds', () => {
    const root = freshRoot('v12');
    plantAtVersion(root, 12);
    const db = new Database(sqliteStorePath(root), { readwrite: true });
    db.run(
      'INSERT INTO dispatches (session_id, task_line, flags, collected_at) VALUES (?, ?, ?, ?)',
      ['s-0', 'An earlier task', '[]', '2026-09-26T00:00:00.000Z'],
    );
    db.close();

    // The control: the first twelve entries make every earlier table and
    // no plan_ci table, so the table this write fills came from a later
    // entry, and was not added to a shipped one.
    expect(tablesOf(root)).toEqual(TABLES.filter((table) => table !== 'schema_migrations' && table !== 'plan_ci' && table !== 'store_meta' && table !== 'merges' && table !== 'merge_conflicts'));

    writePlanCi(root, RED);

    expect(rawQuery(root, 'PRAGMA user_version')).toEqual([{ user_version: LEGACY_GATE_OPEN }]);
    expect(rawQuery(root, 'SELECT session_id FROM dispatches')).toEqual([{ session_id: 's-0' }]);
    expect(rowsOf(root)).toHaveLength(1);
  });

  it('stores one reading of one head at one time once, and the same head read later again', () => {
    const root = freshRoot('key');

    expect(writePlanCi(root, RED).appended).toBe(1);
    expect(writePlanCi(root, RED).appended).toBe(0);
    const later = { ...RED, verdict: 'green' as const, failing: [], readAt: '2026-09-27T13:00:00.000Z' };
    expect(writePlanCi(root, later).appended).toBe(1);

    expect(rowsOf(root).map(({ verdict, read_at }) => [verdict, read_at])).toEqual([
      ['red', READ_AT],
      ['green', '2026-09-27T13:00:00.000Z'],
    ]);
  });

  it('holds its CHECKs against a row inserted past the writer', () => {
    const root = freshRoot('checks');
    writePlanCi(root, RED);
    const db = new Database(sqliteStorePath(root), { readwrite: true });
    const insert = (verdict: string, failing: string, readAt: string): void => {
      db.run(
        'INSERT INTO plan_ci (plan_stub, pr, head_sha, verdict, failing, read_at) VALUES (?, ?, ?, ?, ?, ?)',
        ['rafa-24', 42, 'a1b2c3d', verdict, failing, readAt],
      );
    };
    try {
      // The control: a row the CHECKs admit is taken.
      insert('green', '[]', 'control');
      expect(() => insert('pending', '[]', 't-1')).toThrow('CHECK constraint failed');
      expect(() => insert('red', '[]', 't-2')).toThrow('CHECK constraint failed');
      expect(() => insert('green', '["lint"]', 't-3')).toThrow('CHECK constraint failed');
      expect(() => insert('none', '{"a":1}', 't-4')).toThrow('CHECK constraint failed');
      expect(() => insert('none', 'not json', 't-5')).toThrow();
    } finally {
      db.close();
    }
    expect(rowsOf(root)).toHaveLength(2);
  });
});

describe('writePlanCi refusals', () => {
  const refusals: readonly (readonly [string, Readonly<Record<string, unknown>>, string])[] = [
    ['a pending verdict', { verdict: 'pending', failing: [] }, 'has verdict "pending", not one of green, red, none'],
    ['a blank plan stub', { planStub: ' ' }, 'has a plan stub that is blank'],
    ['a blank head sha', { headSha: '' }, 'has a head sha that is blank'],
    ['a lone surrogate in the read time', { readAt: LONE_HIGH }, 'has a read time that'],
    ['a pull request of zero', { pr: 0 }, 'has pull request 0, not a whole number above zero'],
    ['a fractional pull request', { pr: 4.5 }, 'has pull request 4.5, not a whole number above zero'],
    ['a red verdict with nothing failing', { failing: [] }, 'has verdict red beside 0 failing checks'],
    ['a green verdict with a failing check', { verdict: 'green' }, 'has verdict green beside 2 failing checks'],
    ['a failing list that is not a list', { failing: 'lint' }, 'has failing "lint", not a list'],
    ['a blank failing name', { failing: ['lint', ''] }, 'has a failing check name that is blank'],
  ];

  it('takes the row every refusal below varies', () => {
    expect(writePlanCi(freshRoot('control'), RED).appended).toBe(1);
  });

  for (const [what, change, message] of refusals) {
    it(`refuses ${what}, writing nothing`, () => {
      const root = freshRoot('refused');
      const row = { ...RED, ...change } as unknown as PlanCiRow;

      expect(() => writePlanCi(root, row)).toThrow(message);
      expect(existsSync(root)).toBe(false);
    });
  }
});

describe('planStubOfBranch', () => {
  it('answers the branch stub the roster holds', () => {
    expect(planStubOfBranch('feat/rafa-24-x', ['rafa-24-x', 'rafa-23-y'])).toBe('rafa-24-x');
  });

  it('answers the one plan a queue id reaches', () => {
    expect(planStubOfBranch('feat/q7-short', ['q7-the-full-plan', 'q8-other'])).toBe('q7-the-full-plan');
  });

  it('takes a stub the roster does not hold verbatim', () => {
    expect(planStubOfBranch('feat/rafa-24-x', [])).toBe('rafa-24-x');
  });

  it('answers null for a branch naming no stub, or a queue id reaching two plans', () => {
    expect(planStubOfBranch('main', ['rafa-24-x'])).toBeNull();
    expect(planStubOfBranch('feat/a/b', ['rafa-24-x'])).toBeNull();
    expect(planStubOfBranch('feat/q7', ['q7-one', 'q7-two'])).toBeNull();
  });
});

describe('planCiReading', () => {
  const stubs = ['rafa-24-know-which-skills-earn'];

  it('reads red, naming the failing checks in the order they came', () => {
    const rows = [check('test', 'fail'), check('build', 'pass'), check('lint', 'fail')];

    expect(planCiReading(PULL, rows, stubs, READ_AT)).toEqual({
      row: { ...RED, failing: ['test', 'lint'] },
      skipped: null,
    });
  });

  it('reads green over passing checks, and none over no checks, each failing nothing', () => {
    const green = planCiReading(PULL, [check('build', 'pass')], stubs, READ_AT);
    const none = planCiReading(PULL, [], stubs, READ_AT);

    expect(green.row).toEqual({ ...RED, verdict: 'green', failing: [] });
    expect(none.row).toEqual({ ...RED, verdict: 'none', failing: [] });
  });

  it('stores no row while a check is still running, even beside a failure', () => {
    const rows = [check('test', 'fail'), check('build', 'pending')];

    expect(planCiReading(PULL, rows, stubs, READ_AT)).toEqual({
      row: null,
      skipped: 'the checks of #42 are still running',
    });
  });

  it('stores no row for a head branch resolving to no plan', () => {
    const pull = { ...PULL, headRefName: 'main' };

    expect(planCiReading(pull, [check('build', 'pass')], stubs, READ_AT)).toEqual({
      row: null,
      skipped: 'the branch "main" of #42 resolves to no plan',
    });
  });
});

describe('readPlanCi', () => {
  it('answers every row in append order, or one plan\'s', () => {
    const root = freshRoot('read');
    const other = { ...RED, planStub: 'rafa-23-other', pr: 41, readAt: '2026-09-27T11:00:00.000Z' };
    writePlanCi(root, RED);
    writePlanCi(root, other);

    expect(readPlanCi(root)).toEqual([RED, other]);
    expect(readPlanCi(root, 'rafa-23-other')).toEqual([other]);
    expect(readPlanCi(root, 'rafa-99-absent')).toEqual([]);
  });

  it('reads none, and creates nothing, under a root with no store', () => {
    const root = freshRoot('absent');

    expect(readPlanCi(root)).toEqual([]);
    expect(existsSync(root)).toBe(false);
  });

  it('brings a version-12 store forward and answers none, the table just made', () => {
    const root = freshRoot('read-from-v12');
    plantAtVersion(root, 12);
    expect(tablesOf(root)).toEqual(TABLES.filter((table) => table !== 'schema_migrations' && table !== 'plan_ci' && table !== 'store_meta' && table !== 'merges' && table !== 'merge_conflicts'));

    expect(readPlanCi(root)).toEqual([]);
    expect(tablesOf(root)).toEqual(TABLES);
  });
});

describe('recordPlanCi', () => {
  const now = (): Date => new Date(READ_AT);

  it('stores the reading under the plan the roster resolves the head branch to', () => {
    const root = freshRoot('record');
    plantPlans(root, ['q7-the-full-plan']);
    const warnings: string[] = [];
    const pullRequest = { ...PULL, headRefName: 'feat/q7-short' };

    const record = recordPlanCi({
      repoRoot: root,
      planDir: join('.rafa', 'plans'),
      pullRequest,
      rows: [check('test', 'fail')],
      warn: (message) => warnings.push(message),
      now,
    });

    const row = { ...RED, planStub: 'q7-the-full-plan', failing: ['test'] };
    expect(record).toEqual({ row, skipped: null, appended: 1, problem: null });
    expect(readPlanCi(root)).toEqual([row]);
    expect(warnings).toEqual([]);
  });

  it('stores nothing, creating no store, for a pending reading', () => {
    const root = freshRoot('record-pending');
    const warnings: string[] = [];

    const record = recordPlanCi({
      repoRoot: root,
      planDir: join('.rafa', 'plans'),
      pullRequest: PULL,
      rows: [check('build', 'pending')],
      warn: (message) => warnings.push(message),
      now,
    });

    expect(record).toEqual({ row: null, skipped: 'the checks of #42 are still running', appended: 0, problem: null });
    expect(existsSync(root)).toBe(false);
    expect(warnings).toEqual([]);
  });

  it('warns about a store it cannot write, and does not throw', () => {
    const root = freshRoot('record-broken');
    // The store's file is a directory, so opening it fails.
    mkdirSync(sqliteStorePath(root), { recursive: true });
    const warnings: string[] = [];

    const record = recordPlanCi({
      repoRoot: root,
      planDir: join('.rafa', 'plans'),
      pullRequest: PULL,
      rows: [check('build', 'pass')],
      warn: (message) => warnings.push(message),
      now,
    });

    expect(record.row).toEqual({ ...RED, verdict: 'green', failing: [] });
    expect(record.appended).toBe(0);
    expect(record.problem).toStartWith('the CI reading of #42 was not stored: ');
    expect(warnings).toEqual([record.problem ?? '']);
  });
});
