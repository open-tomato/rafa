/**
 * Tests for the skill-invocation writer, its reader, and the migration
 * that creates their table.
 *
 * Every store sits under a fresh temporary repo root, and the disk is
 * real. Every reading of the table goes through `bun:sqlite` directly and
 * never through the module, save in the reader's own cases, so the
 * columns, the `unknown` row and the one-reading-per-session rule are
 * spelled here rather than read off the code under test.
 *
 * Each refusal sits beside the write it was varied from, which the store
 * takes, so a writer refusing everything reddens.
 */
import type { SkillUseReading } from './skill-invocations.js';

import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { Database } from 'bun:sqlite';
import { afterAll, describe, expect, it } from 'bun:test';

import { readSkillInvocations, UNKNOWN_SKILL_COUNT, writeSkillInvocations } from './skill-invocations.js';
import {
  migrateSchema,
  SQLITE_MIGRATIONS,
  SQLITE_SCHEMA_VERSION,
  sqliteStorePath,
} from './sqlite.js';

/** A skill-invocation row as the table holds it. */
interface StoredInvocation {
  seq: number;
  session_id: string;
  name: string | null;
  sidechain: number | null;
  count: number | null;
}

/** The table's columns, in order. */
const COLUMNS = ['seq', 'session_id', 'name', 'sidechain', 'count'];

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
  'skill_invocations',
  'task_reports',
];

/** A lone high surrogate, built from its code unit. */
const LONE_HIGH = String.fromCharCode(0xd800);

/** A session that invoked one skill from both sides and another from its main thread. */
const COUNTED: SkillUseReading = {
  sessionId: 's-1',
  uses: [
    { name: 'bun-testing', sidechain: false, count: 2 },
    { name: 'bun-testing', sidechain: true, count: 1 },
    { name: 'git-workflow', sidechain: false, count: 3 },
  ],
};

const tempBase = mkdtempSync(join(tmpdir(), 'rafa-skill-invocations-'));
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

/** Every skill-invocation row under `root`, in append order. */
function rowsOf(root: string): StoredInvocation[] {
  return rawQuery<StoredInvocation>(root, 'SELECT * FROM skill_invocations ORDER BY seq');
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

describe('the skill_invocations table', () => {
  it('is created with its columns, in order, at the last version', () => {
    const root = freshRoot('columns');

    const result = writeSkillInvocations(root, [COUNTED]);

    expect(result).toEqual({ path: sqliteStorePath(root), appended: 3, skipped: 0 });
    expect(result.path.startsWith(`${tempBase}/`)).toBe(true);
    const columns = rawQuery<{ name: string }>(root, 'SELECT name FROM pragma_table_info(?) ORDER BY cid', 'skill_invocations');
    expect(columns.map(({ name }) => name)).toEqual(COLUMNS);
    expect(tablesOf(root)).toEqual(TABLES);
    expect(rawQuery(root, 'PRAGMA user_version')).toEqual([{ user_version: SQLITE_SCHEMA_VERSION }]);
  });

  it('brings a version-10 store forward, keeping the rows it holds', () => {
    const root = freshRoot('v10');
    plantAtVersion(root, 10);
    const db = new Database(sqliteStorePath(root), { readwrite: true });
    db.run(
      'INSERT INTO dispatches (session_id, task_line, flags, collected_at) VALUES (?, ?, ?, ?)',
      ['s-0', 'An earlier task', '[]', '2026-09-26T00:00:00.000Z'],
    );
    db.close();

    // The control: the first ten entries make every earlier table and no
    // skill_invocations table, so the table this write fills came from a
    // later entry, and was not added to a shipped one.
    expect(tablesOf(root)).toEqual(TABLES.filter((table) => table !== 'skill_invocations'));

    writeSkillInvocations(root, [COUNTED]);

    expect(rawQuery(root, 'PRAGMA user_version')).toEqual([{ user_version: SQLITE_SCHEMA_VERSION }]);
    expect(rawQuery(root, 'SELECT session_id FROM dispatches')).toEqual([{ session_id: 's-0' }]);
    expect(rowsOf(root)).toHaveLength(3);
  });

  it('refuses, at the table, a row half unknown, a zero count and one use stored twice', () => {
    const root = freshRoot('checks');
    writeSkillInvocations(root, [COUNTED]);
    const db = new Database(sqliteStorePath(root), { readwrite: true });
    const insert = (values: (string | number | null)[]): void => {
      db.run('INSERT INTO skill_invocations (session_id, name, sidechain, count) VALUES (?, ?, ?, ?)', values);
    };
    try {
      expect(() => insert(['s-2', 'bun-testing', 0, null])).toThrow(/CHECK constraint failed/);
      expect(() => insert(['s-2', null, null, 1])).toThrow(/CHECK constraint failed/);
      expect(() => insert(['s-2', null, 0, null])).toThrow(/CHECK constraint failed/);
      expect(() => insert(['s-2', 'bun-testing', 0, 0])).toThrow(/CHECK constraint failed/);
      expect(() => insert(['s-2', 'bun-testing', 0, 1.5])).toThrow(/CHECK constraint failed/);
      expect(() => insert(['s-2', 'bun-testing', 2, 1])).toThrow(/CHECK constraint failed/);
      expect(() => insert(['s-2', '', 0, 1])).toThrow(/CHECK constraint failed/);
      expect(() => insert(['s-1', 'bun-testing', 0, 5])).toThrow(/UNIQUE constraint failed/);
      insert(['s-3', null, null, null]);
      expect(() => insert(['s-3', null, null, null])).toThrow(/UNIQUE constraint failed/);

      // The control: the same shapes holding values the table takes.
      insert(['s-2', 'bun-testing', 0, 1]);
      insert(['s-2', 'bun-testing', 1, 1]);
    } finally {
      db.close();
    }
    expect(rowsOf(root).map(({ session_id }) => session_id)).toEqual(['s-1', 's-1', 's-1', 's-3', 's-2', 's-2']);
  });
});

describe('writeSkillInvocations', () => {
  it('stores one row per skill and side, and an unknown session as one row of NULLs', () => {
    const root = freshRoot('rows');

    const result = writeSkillInvocations(root, [COUNTED, { sessionId: 's-2', uses: UNKNOWN_SKILL_COUNT }]);

    expect(result).toMatchObject({ appended: 4, skipped: 0 });
    expect(rowsOf(root)).toEqual([
      { seq: 1, session_id: 's-1', name: 'bun-testing', sidechain: 0, count: 2 },
      { seq: 2, session_id: 's-1', name: 'bun-testing', sidechain: 1, count: 1 },
      { seq: 3, session_id: 's-1', name: 'git-workflow', sidechain: 0, count: 3 },
      { seq: 4, session_id: 's-2', name: null, sidechain: null, count: null },
    ]);
  });

  it('stores no row for a session that invoked no skill, and creates no store for it', () => {
    const root = freshRoot('none-used');

    expect(writeSkillInvocations(root, [{ sessionId: 's-1', uses: [] }])).toMatchObject({ appended: 0, skipped: 0 });
    expect(existsSync(root)).toBe(false);

    // The control: the same session with a use creates the store.
    expect(writeSkillInvocations(root, [{ sessionId: 's-1', uses: [{ name: 'a', sidechain: false, count: 1 }] }]).appended).toBe(1);
    expect(existsSync(sqliteStorePath(root))).toBe(true);
  });

  it('brings an existing store forward on a write with nothing to insert', () => {
    const root = freshRoot('empty-on-v10');
    plantAtVersion(root, 10);

    expect(writeSkillInvocations(root, [{ sessionId: 's-1', uses: [] }]).appended).toBe(0);

    expect(tablesOf(root)).toEqual(TABLES);
    expect(rawQuery(root, 'PRAGMA user_version')).toEqual([{ user_version: SQLITE_SCHEMA_VERSION }]);
  });

  it('skips a session already holding a row, whole, and writes the others', () => {
    const root = freshRoot('dedup');
    writeSkillInvocations(root, [{ sessionId: 's-1', uses: UNKNOWN_SKILL_COUNT }]);

    const again = writeSkillInvocations(root, [COUNTED, { sessionId: 's-2', uses: [{ name: 'a', sidechain: true, count: 4 }] }]);

    expect(again).toMatchObject({ appended: 1, skipped: 3 });
    expect(rowsOf(root).map(({ session_id, name, count }) => [session_id, name, count])).toEqual([
      ['s-1', null, null],
      ['s-2', 'a', 4],
    ]);
  });

  it('leaves a store byte-identical when every session is already held', () => {
    const root = freshRoot('held');
    writeSkillInvocations(root, [COUNTED]);
    const before = readFileSync(sqliteStorePath(root));

    expect(writeSkillInvocations(root, [COUNTED])).toMatchObject({ appended: 0, skipped: 3 });

    expect(readFileSync(sqliteStorePath(root)).equals(before)).toBe(true);
  });

  it('refuses a write it cannot store, opening nothing', () => {
    const use = { name: 'bun-testing', sidechain: false, count: 1 };
    const refused: readonly (readonly [string, readonly SkillUseReading[]])[] = [
      ['an empty session id', [{ sessionId: '', uses: [use] }]],
      ['a session id that is no string', [{ sessionId: 7, uses: [use] } as unknown as SkillUseReading]],
      ['one session read twice', [{ sessionId: 's-1', uses: [use] }, { sessionId: 's-1', uses: UNKNOWN_SKILL_COUNT }]],
      ['uses that are no list', [{ sessionId: 's-1', uses: 'none' } as unknown as SkillUseReading]],
      ['a blank skill name', [{ sessionId: 's-1', uses: [{ ...use, name: ' ' }] }]],
      ['a skill name that is null', [{ sessionId: 's-1', uses: [{ ...use, name: null }] } as unknown as SkillUseReading]],
      ['a skill name holding a lone surrogate', [{ sessionId: 's-1', uses: [{ ...use, name: `a${LONE_HIGH}` }] }]],
      ['a sidechain that is no boolean', [{ sessionId: 's-1', uses: [{ ...use, sidechain: 1 }] } as unknown as SkillUseReading]],
      ['a zero count', [{ sessionId: 's-1', uses: [{ ...use, count: 0 }] }]],
      ['a fractional count', [{ sessionId: 's-1', uses: [{ ...use, count: 1.5 }] }]],
      ['a count that is no number', [{ sessionId: 's-1', uses: [{ ...use, count: '1' }] } as unknown as SkillUseReading]],
      ['one skill twice on one side', [{ sessionId: 's-1', uses: [use, { ...use, count: 2 }] }]],
    ];

    for (const [label, readings] of refused) {
      const root = freshRoot('refused');
      expect(() => writeSkillInvocations(root, readings), label).toThrow(/^effort store: skill invocation write .+; nothing written$/);
      expect(existsSync(root), label).toBe(false);
    }

    // The control: the write each refusal was varied from is stored, and
    // so is one skill on both sides and two sessions in one write.
    const root = freshRoot('refused-control');
    const control: readonly SkillUseReading[] = [
      { sessionId: 's-1', uses: [use, { ...use, sidechain: true }] },
      { sessionId: 's-2', uses: UNKNOWN_SKILL_COUNT },
    ];
    expect(writeSkillInvocations(root, control).appended).toBe(3);
  });
});

describe('readSkillInvocations', () => {
  it('reads every row back in append order, a NULL count as unknown and never 0', () => {
    const root = freshRoot('read');
    writeSkillInvocations(root, [{ sessionId: 's-2', uses: UNKNOWN_SKILL_COUNT }, COUNTED]);

    expect(readSkillInvocations(root)).toEqual([
      { sessionId: 's-2', name: null, sidechain: null, count: 'unknown' },
      { sessionId: 's-1', name: 'bun-testing', sidechain: false, count: 2 },
      { sessionId: 's-1', name: 'bun-testing', sidechain: true, count: 1 },
      { sessionId: 's-1', name: 'git-workflow', sidechain: false, count: 3 },
    ]);
  });

  it('reads none, and creates nothing, under a root with no store', () => {
    const root = freshRoot('absent');

    expect(readSkillInvocations(root)).toEqual([]);
    expect(existsSync(root)).toBe(false);
  });

  it('brings a version-10 store forward and answers none, the table just made', () => {
    const root = freshRoot('read-from-v10');
    plantAtVersion(root, 10);
    expect(tablesOf(root)).toEqual(TABLES.filter((table) => table !== 'skill_invocations'));

    expect(readSkillInvocations(root)).toEqual([]);
    expect(tablesOf(root)).toEqual(TABLES);
  });
});
