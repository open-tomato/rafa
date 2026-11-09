/**
 * The `reading-supersedes` migration over a store an older runtime left,
 * the table it creates, and the rules the registries give that table.
 *
 * The older store is planted the way that runtime leaves one: brought
 * through `bringForward` with the catalogue up to the entry before
 * `reading-supersedes`, found by its id, and given a session row and a
 * `plan_ci` reading inserted as that runtime inserts them. The next open
 * applies the entry. A control shows the planted store has no such
 * table, so the table read afterwards cannot have been there already,
 * and every other table is compared row for row across the open.
 *
 * The table's own refusals are read through raw inserts, since the
 * table has no writer yet: each CHECK and each unique index is paired
 * with the row that differs in one value and is stored.
 *
 * Every store is planted under this file's own temporary directory.
 */
import type { SessionEffortRow } from './types.js';

import { mkdirSync, mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { Database } from 'bun:sqlite';
import { afterAll, describe, expect, it } from 'bun:test';

import { bringForward } from './bring-forward.js';
import { KEPT_COLUMNS } from './fixture-extract.js';
import { MERGE_RULES } from './merge-rules.js';
import { LEGACY_GATE_OPEN, SQLITE_MIGRATIONS } from './migrations.js';
import { ORIGIN_TABLES } from './origins.js';
import { openSqliteStore, sqliteStorePath } from './sqlite.js';

const tempBase = realpathSync(mkdtempSync(join(tmpdir(), 'rafa-reading-supersedes-migration-')));

afterAll(() => {
  rmSync(tempBase, { recursive: true, force: true });
});

/** The entry's id. */
const ENTRY_ID = 'reading-supersedes';

/** The entry, found by its id. */
const ENTRY = SQLITE_MIGRATIONS.find(({ id }) => id === ENTRY_ID);

/** The catalogue a runtime before `reading-supersedes` holds: every entry ahead of it. */
const BEFORE_ENTRY = SQLITE_MIGRATIONS.slice(0, SQLITE_MIGRATIONS.findIndex(({ id }) => id === ENTRY_ID));

/** The session row an older runtime inserted, as the JSON text it wrote. */
const OLD_ROW_JSON = '{"sessionId":"01d-5e55","assistantRecordCount":2}';

/** The `plan_ci` reading an older runtime inserted, naming no origin column. */
const OLD_READING_SQL = 'INSERT INTO plan_ci (plan_stub, pr, head_sha, verdict, failing, read_at)'
  + ' VALUES (\'phase-1\', 6, \'sha-old\', \'red\', \'["lint"]\', \'2026-10-01T10:00:00.000Z\')';

/** The table's columns, in the order the entry declares them. */
const COLUMNS = ['seq', 'table_name', 'canonical_key', 'superseded_key', 'rule', 'origin_store', 'origin_seq'];

/** The four columns every row fills, each refused blank. */
const FILLED_COLUMNS = ['table_name', 'canonical_key', 'superseded_key', 'rule'] as const;

/** One row read off a store, by column. */
type Row = Record<string, unknown>;

let planted = 0;

/** A fresh repo root of its own under the temporary directory. */
function freshRoot(): string {
  planted += 1;
  const root = join(tempBase, `root-${String(planted)}`);
  mkdirSync(root, { recursive: true });
  return root;
}

/**
 * The SQLite store under `root`, brought to the entry before
 * `reading-supersedes`, holding one session row and one `plan_ci`
 * reading inserted as an older runtime inserts them. Answers the store
 * file.
 */
function plantOlderStore(root: string): string {
  const path = sqliteStorePath(root);
  mkdirSync(dirname(path), { recursive: true });
  const db = new Database(path, { readwrite: true, create: true });
  try {
    bringForward(db, path, 'write', 'open', { migrations: BEFORE_ENTRY });
    db.query('INSERT INTO sessions (session_id, row_json) VALUES (?, ?)').run('01d-5e55', OLD_ROW_JSON);
    db.run(OLD_READING_SQL);
  } finally {
    db.close();
  }
  return path;
}

/** What `sql` answers on the store at `path`, read-only. */
function read(path: string, sql: string): Row[] {
  const db = new Database(path, { readonly: true });
  try {
    return db.query<Row, []>(sql).all();
  } finally {
    db.close();
  }
}

/** The tables the store at `path` holds, by name, sorted. */
function tablesOf(path: string): string[] {
  return read(path, 'SELECT name FROM sqlite_master WHERE type = \'table\' ORDER BY name').map(({ name }) => String(name));
}

/** The migration ids the store at `path` has logged, in the order it applied them. */
function loggedIds(path: string): string[] {
  return read(path, 'SELECT id FROM schema_migrations ORDER BY rowid').map(({ id }) => String(id));
}

/** Every row of every table of `tables` on the store at `path`, in `rowid` order. */
function rowsOf(path: string, tables: readonly string[]): Record<string, Row[]> {
  return Object.fromEntries(tables.map((table) => [table, read(path, `SELECT * FROM ${table} ORDER BY rowid`)]));
}

/** A store under a fresh root brought through every migration, open for writing until `use` returns. */
function withCurrentStore<T>(use: (db: Database) => T): T {
  const path = sqliteStorePath(freshRoot());
  mkdirSync(dirname(path), { recursive: true });
  const db = new Database(path, { readwrite: true, create: true });
  try {
    bringForward(db, path, 'write', 'open');
    return use(db);
  } finally {
    db.close();
  }
}

/** One `reading_supersedes` row to insert, by column, with nothing left to a default. */
interface PlantedSupersede {
  readonly table_name: unknown;
  readonly canonical_key: unknown;
  readonly superseded_key: unknown;
  readonly rule: unknown;
  readonly origin_store: unknown;
  readonly origin_seq: unknown;
}

/** A row the table takes, superseding a later reading of one `plan_ci` fact, with `over` laid over it. */
function supersede(over: Partial<PlantedSupersede> = {}): PlantedSupersede {
  return {
    table_name: 'plan_ci',
    canonical_key: '[6,"sha-old","2026-10-01T10:00:00.000Z"]',
    superseded_key: '[6,"sha-old","2026-10-01T11:00:00.000Z"]',
    rule: 'same-fact@1',
    origin_store: null,
    origin_seq: null,
    ...over,
  };
}

/** Inserts `row` into `reading_supersedes`, every column but `seq` named. */
function insert(db: Database, row: PlantedSupersede): void {
  const columns = Object.keys(row);
  db.query(`INSERT INTO reading_supersedes (${columns.join(', ')}) VALUES (${columns.map(() => '?').join(', ')})`)
    .run(...(Object.values(row) as (string | number | null)[]));
}

/** How many rows `reading_supersedes` holds. */
function countOf(db: Database): number {
  return db.query<{ n: number }, []>('SELECT count(*) AS n FROM reading_supersedes').get()?.n ?? -1;
}

describe('the reading-supersedes entry', () => {
  it('is in the catalogue under its id, additive, as the last entry', () => {
    expect(ENTRY?.id).toBe(ENTRY_ID);
    expect(ENTRY?.breaks).toEqual([]);
    expect(ENTRY?.contract).toBeUndefined();
    expect(SQLITE_MIGRATIONS.at(-1)?.id).toBe(ENTRY_ID);
  });

  it('makes a merged table, append-only by the fact it names, among the tables whose inserts stamp their origin', () => {
    expect(MERGE_RULES['reading_supersedes']).toEqual({
      scope: 'merged',
      identity: ['table_name', 'canonical_key', 'superseded_key'],
      edited: {},
    });
    expect(ORIGIN_TABLES).toContain('reading_supersedes');
  });

  it('keeps no column of the table in an extract, since no CHECK admits a closed set of words', () => {
    expect(Object.keys(KEPT_COLUMNS).filter((column) => column.startsWith('reading_supersedes.'))).toEqual([]);
  });
});

describe('reading-supersedes over a store an older runtime left', () => {
  it('control: the planted store has no reading_supersedes table and has not logged the entry', () => {
    const path = plantOlderStore(freshRoot());

    expect(tablesOf(path)).not.toContain('reading_supersedes');
    expect(() => read(path, 'SELECT seq FROM reading_supersedes')).toThrow('no such table: reading_supersedes');
    expect(loggedIds(path)).not.toContain(ENTRY_ID);
    expect(loggedIds(path)).toEqual(BEFORE_ENTRY.map(({ id }) => id));
  });

  it('applies on the next open, creating the table empty with its columns in order and its two indexes', () => {
    const root = freshRoot();
    const path = plantOlderStore(root);

    openSqliteStore(root).read('sessions');

    expect(loggedIds(path)).toContain(ENTRY_ID);
    expect(read(path, 'SELECT name FROM pragma_table_info(\'reading_supersedes\') ORDER BY cid').map(({ name }) => name)).toEqual(COLUMNS);
    expect(read(path, 'SELECT count(*) AS n FROM reading_supersedes')).toEqual([{ n: 0 }]);
    expect(read(path, 'SELECT name FROM sqlite_master WHERE type = \'index\' AND tbl_name = \'reading_supersedes\' AND sql IS NOT NULL ORDER BY name'))
      .toEqual([{ name: 'reading_supersedes_by_fact' }, { name: 'reading_supersedes_by_origin' }]);
  });

  it('leaves every row the older runtime wrote as it was, in every other table', () => {
    const root = freshRoot();
    const path = plantOlderStore(root);
    const tables = tablesOf(path).filter((table) => table !== 'schema_migrations');
    const before = rowsOf(path, tables);

    const sessions = openSqliteStore(root).read('sessions');

    expect(before.sessions).toHaveLength(1);
    expect(before.plan_ci).toHaveLength(1);
    expect(rowsOf(path, tables)).toEqual(before);
    expect(tablesOf(path).filter((table) => !tables.includes(table))).toEqual(['reading_supersedes', 'schema_migrations']);
    expect(sessions).toEqual([JSON.parse(OLD_ROW_JSON) as SessionEffortRow]);
  });

  it('keeps the legacy gate open, so a pre-log runtime still gets in', () => {
    const root = freshRoot();
    const path = plantOlderStore(root);
    expect(read(path, 'PRAGMA user_version')).toEqual([{ user_version: LEGACY_GATE_OPEN }]);

    openSqliteStore(root).read('sessions');

    expect(read(path, 'PRAGMA user_version')).toEqual([{ user_version: LEGACY_GATE_OPEN }]);
  });

  it('still takes an older runtime\'s reading, naming no new column', () => {
    const root = freshRoot();
    const path = plantOlderStore(root);
    openSqliteStore(root).read('sessions');

    const db = new Database(path, { readwrite: true });
    try {
      db.run(OLD_READING_SQL.replace('2026-10-01T10:00:00.000Z', '2026-10-01T11:00:00.000Z'));
    } finally {
      db.close();
    }

    expect(read(path, 'SELECT read_at, origin_store FROM plan_ci ORDER BY seq')).toEqual([
      { read_at: '2026-10-01T10:00:00.000Z', origin_store: null },
      { read_at: '2026-10-01T11:00:00.000Z', origin_store: null },
    ]);
  });

  it('applies once: a second open logs nothing more and leaves the table as it is', () => {
    const root = freshRoot();
    const path = plantOlderStore(root);
    openSqliteStore(root).read('sessions');
    const logged = loggedIds(path);

    openSqliteStore(root).read('sessions');

    expect(loggedIds(path)).toEqual(logged);
    expect(logged.filter((id) => id === ENTRY_ID)).toHaveLength(1);
  });
});

describe('the reading_supersedes table', () => {
  it('takes a row naming a table, two keys and a rule, under no origin', () => {
    withCurrentStore((db) => {
      insert(db, supersede());

      expect(db.query<Row, []>(`SELECT ${COLUMNS.join(', ')} FROM reading_supersedes`).all()).toEqual([{
        seq: 1,
        table_name: 'plan_ci',
        canonical_key: '[6,"sha-old","2026-10-01T10:00:00.000Z"]',
        superseded_key: '[6,"sha-old","2026-10-01T11:00:00.000Z"]',
        rule: 'same-fact@1',
        origin_store: null,
        origin_seq: null,
      }]);
    });
  });

  it.each(FILLED_COLUMNS.map((column) => [column] as const))('refuses a missing or blank %s', (column) => {
    withCurrentStore((db) => {
      expect(() => insert(db, supersede({ [column]: null }))).toThrow(`NOT NULL constraint failed: reading_supersedes.${column}`);
      expect(() => insert(db, supersede({ [column]: '' }))).toThrow(`CHECK constraint failed: ${column} <> ''`);
      expect(countOf(db)).toBe(0);
    });
  });

  it('refuses a blank origin store, and takes a NULL one', () => {
    withCurrentStore((db) => {
      expect(() => insert(db, supersede({ origin_store: '', origin_seq: 1 }))).toThrow('CHECK constraint failed: origin_store <> \'\'');
      insert(db, supersede({ origin_store: null }));

      expect(countOf(db)).toBe(1);
    });
  });

  it('refuses a second row naming one supersede, whatever rule or origin it carries', () => {
    withCurrentStore((db) => {
      insert(db, supersede());

      const unique = 'UNIQUE constraint failed: reading_supersedes.table_name, reading_supersedes.canonical_key, reading_supersedes.superseded_key';
      expect(() => insert(db, supersede())).toThrow(unique);
      expect(() => insert(db, supersede({ rule: 'same-fact@2', origin_store: 'store-b', origin_seq: 1 }))).toThrow(unique);
      expect(countOf(db)).toBe(1);
    });
  });

  it('absorbs a second write of one supersede on its identity, as the writer will', () => {
    withCurrentStore((db) => {
      const sql = 'INSERT INTO reading_supersedes (table_name, canonical_key, superseded_key, rule) VALUES (?, ?, ?, ?)'
        + ' ON CONFLICT (table_name, canonical_key, superseded_key) DO NOTHING';
      const row = supersede();
      const values = [row.table_name, row.canonical_key, row.superseded_key, row.rule] as string[];

      db.query(sql).run(...values);
      db.query(sql).run(...values);

      expect(countOf(db)).toBe(1);
    });
  });

  it('stores a supersede that differs in the table, the canonical key or the superseded key', () => {
    withCurrentStore((db) => {
      insert(db, supersede());

      insert(db, supersede({ table_name: 'other_readings' }));
      insert(db, supersede({ canonical_key: '[6,"sha-old","2026-10-01T09:00:00.000Z"]' }));
      insert(db, supersede({ superseded_key: '[6,"sha-old","2026-10-01T12:00:00.000Z"]' }));

      expect(countOf(db)).toBe(4);
    });
  });

  it('refuses a second row under one origin pair, and takes any number with no origin', () => {
    withCurrentStore((db) => {
      insert(db, supersede({ superseded_key: '["first"]', origin_store: 'store-a', origin_seq: 1 }));
      insert(db, supersede({ superseded_key: '["second"]' }));
      insert(db, supersede({ superseded_key: '["third"]' }));

      expect(() => insert(db, supersede({ superseded_key: '["fourth"]', origin_store: 'store-a', origin_seq: 1 })))
        .toThrow('UNIQUE constraint failed: reading_supersedes.origin_store, reading_supersedes.origin_seq');
      insert(db, supersede({ superseded_key: '["fifth"]', origin_store: 'store-b', origin_seq: 1 }));
      expect(countOf(db)).toBe(4);
    });
  });
});
