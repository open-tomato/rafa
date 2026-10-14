/**
 * The `stale-docs` migration over a store an older runtime left, the
 * table it creates, and what it leaves alone in both backends.
 *
 * The older store is planted the way that runtime leaves one: brought
 * through `bringForward` with the catalogue up to the entry before
 * `stale-docs`, found by its id, and given a session row and a bug row
 * inserted as that runtime inserts them. The next open applies the
 * entry. A control shows the planted store has no such table, so the
 * table read afterwards cannot have been there already, and every other
 * table is compared row for row across the open.
 *
 * The table's own refusals are read through raw inserts, since the
 * table has no writer to go through: each CHECK and each unique index
 * is paired with the row that differs in one value and is stored.
 *
 * Every store is planted under this file's own temporary directory.
 */
import type { SessionEffortRow } from './types.js';

import { mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { Database } from 'bun:sqlite';
import { afterAll, describe, expect, it } from 'bun:test';

import { bringForward } from './bring-forward.js';
import { LEGACY_GATE_OPEN, SQLITE_MIGRATIONS } from './migrations.js';
import { openNdjsonStore } from './ndjson.js';
import { openSqliteStore, sqliteStorePath, writeSqliteStore } from './sqlite.js';
import { STALE_DOC_KINDS } from './stale-docs.js';
import { EFFORT_KEY_PROJECTIONS } from './types.js';

const tempBase = realpathSync(mkdtempSync(join(tmpdir(), 'rafa-stale-docs-migration-')));

afterAll(() => {
  rmSync(tempBase, { recursive: true, force: true });
});

/** The entry, found by its id. */
const ENTRY = SQLITE_MIGRATIONS.find(({ id }) => id === 'stale-docs');

/** The catalogue a runtime before `stale-docs` holds: every entry ahead of it. */
const BEFORE_ENTRY = SQLITE_MIGRATIONS.slice(0, SQLITE_MIGRATIONS.findIndex(({ id }) => id === 'stale-docs'));

/** The session row an older runtime inserted, as the JSON text it wrote. */
const OLD_ROW_JSON = '{"sessionId":"01d-5e55","assistantRecordCount":2}';

/** The bug row an older runtime inserted, naming no origin column. */
const OLD_BUG_SQL = 'INSERT INTO out_of_scope_bugs (id, session_id, plan_stub, task_line, what, artifact, security, scope, outcome, collected_at)'
  + ' VALUES (\'o-old\', \'01d-5e55\', \'phase-1\', \'Add the module\', \'an old bug\', NULL, 0, \'rafa\', \'done\', \'2026-10-01T10:00:00.000Z\')';

/** The table's columns, in the order the entry declares them. */
const COLUMNS = [
  'seq',
  'id',
  'session_id',
  'plan_stub',
  'task_line',
  'kind',
  'where_at',
  'what',
  'outcome',
  'collected_at',
  'origin_store',
  'origin_seq',
];

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
 * `stale-docs`, holding one session row and one bug row inserted as an
 * older runtime inserts them. Answers the store file.
 */
function plantOlderStore(root: string): string {
  const path = sqliteStorePath(root);
  mkdirSync(dirname(path), { recursive: true });
  const db = new Database(path, { readwrite: true, create: true });
  try {
    bringForward(db, path, 'write', 'open', { migrations: BEFORE_ENTRY });
    db.query('INSERT INTO sessions (session_id, row_json) VALUES (?, ?)').run('01d-5e55', OLD_ROW_JSON);
    db.run(OLD_BUG_SQL);
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

/** One `stale_docs` row to insert, by column, with nothing left to a default. */
interface PlantedStaleDoc {
  readonly id: unknown;
  readonly session_id: unknown;
  readonly plan_stub: unknown;
  readonly task_line: unknown;
  readonly kind: unknown;
  readonly where_at: unknown;
  readonly what: unknown;
  readonly outcome: unknown;
  readonly collected_at: unknown;
  readonly origin_store: unknown;
  readonly origin_seq: unknown;
}

let rowIds = 0;

/** A row the table takes, under an id of its own, with `over` laid over it. */
function staleDoc(over: Partial<PlantedStaleDoc> = {}): PlantedStaleDoc {
  rowIds += 1;
  return {
    id: `stale-${String(rowIds)}`,
    session_id: 's-1',
    plan_stub: 'phase-1',
    task_line: 'Add the module',
    kind: 'sighting',
    where_at: 'context/triage.md:12',
    what: 'the page names three channels',
    outcome: 'done',
    collected_at: '2026-10-14T10:00:00.000Z',
    origin_store: null,
    origin_seq: null,
    ...over,
  };
}

/** Inserts `row` into `stale_docs`, every column but `seq` named. */
function insert(db: Database, row: PlantedStaleDoc): void {
  const columns = Object.keys(row);
  db.query(`INSERT INTO stale_docs (${columns.join(', ')}) VALUES (${columns.map(() => '?').join(', ')})`)
    .run(...(Object.values(row) as (string | number | null)[]));
}

/** How many rows `stale_docs` holds. */
function countOf(db: Database): number {
  return db.query<{ n: number }, []>('SELECT count(*) AS n FROM stale_docs').get()?.n ?? -1;
}

describe('the stale-docs entry', () => {
  it('is in the catalogue under its id, additive', () => {
    expect(ENTRY?.id).toBe('stale-docs');
    expect(ENTRY?.breaks).toEqual([]);
    expect(ENTRY?.contract).toBeUndefined();
  });
});

describe('stale-docs over a store an older runtime left', () => {
  it('control: the planted store has no stale_docs table and has not logged the entry', () => {
    const path = plantOlderStore(freshRoot());

    expect(tablesOf(path)).not.toContain('stale_docs');
    expect(() => read(path, 'SELECT seq FROM stale_docs')).toThrow('no such table: stale_docs');
    expect(loggedIds(path)).not.toContain('stale-docs');
    expect(loggedIds(path)).toEqual(BEFORE_ENTRY.map(({ id }) => id));
  });

  it('applies on the next open, creating the table empty with its columns in order', () => {
    const root = freshRoot();
    const path = plantOlderStore(root);

    openSqliteStore(root).read('sessions');

    expect(loggedIds(path)).toContain('stale-docs');
    expect(read(path, 'SELECT name FROM pragma_table_info(\'stale_docs\') ORDER BY cid').map(({ name }) => name)).toEqual(COLUMNS);
    expect(read(path, 'SELECT count(*) AS n FROM stale_docs')).toEqual([{ n: 0 }]);
    expect(read(path, 'SELECT name FROM sqlite_master WHERE type = \'index\' AND tbl_name = \'stale_docs\' AND sql IS NOT NULL ORDER BY name'))
      .toEqual([{ name: 'stale_docs_by_entry' }, { name: 'stale_docs_by_origin' }]);
  });

  it('leaves every row the older runtime wrote as it was, in every other table', () => {
    const root = freshRoot();
    const path = plantOlderStore(root);
    const tables = tablesOf(path).filter((table) => table !== 'schema_migrations');
    const before = rowsOf(path, tables);

    const sessions = openSqliteStore(root).read('sessions');

    expect(before.sessions).toHaveLength(1);
    expect(before.out_of_scope_bugs).toHaveLength(1);
    expect(rowsOf(path, tables)).toEqual(before);
    expect(tablesOf(path).filter((table) => !tables.includes(table))).toEqual(['schema_migrations', 'stale_docs']);
    expect(sessions).toEqual([JSON.parse(OLD_ROW_JSON) as SessionEffortRow]);
  });

  it('keeps the legacy gate open, so a pre-log runtime still gets in', () => {
    const root = freshRoot();
    const path = plantOlderStore(root);
    expect(read(path, 'PRAGMA user_version')).toEqual([{ user_version: LEGACY_GATE_OPEN }]);

    openSqliteStore(root).read('sessions');

    expect(read(path, 'PRAGMA user_version')).toEqual([{ user_version: LEGACY_GATE_OPEN }]);
  });

  it('still takes an older runtime\'s insert into another table, naming no new column', () => {
    const root = freshRoot();
    const path = plantOlderStore(root);
    openSqliteStore(root).read('sessions');

    const db = new Database(path, { readwrite: true });
    try {
      db.run(OLD_BUG_SQL.replace('\'o-old\'', '\'o-old-2\'').replace('an old bug', 'a second old bug'));
    } finally {
      db.close();
    }

    expect(read(path, 'SELECT id, origin_store FROM out_of_scope_bugs ORDER BY seq')).toEqual([
      { id: 'o-old', origin_store: null },
      { id: 'o-old-2', origin_store: null },
    ]);
  });

  it('applies once: a second open logs nothing more and leaves the table as it is', () => {
    const root = freshRoot();
    const path = plantOlderStore(root);
    openSqliteStore(root).read('sessions');
    const logged = loggedIds(path);

    openSqliteStore(root).read('sessions');

    expect(loggedIds(path)).toEqual(logged);
    expect(logged.filter((id) => id === 'stale-docs')).toHaveLength(1);
  });
});

describe('the stale_docs table', () => {
  it('takes a row of each kind the row type names, and no other word', () => {
    withCurrentStore((db) => {
      for (const kind of STALE_DOC_KINDS) insert(db, staleDoc({ kind, what: `a ${kind} row` }));

      const stored = db.query<{ kind: string }, []>('SELECT kind FROM stale_docs ORDER BY seq').all();
      expect(stored.map(({ kind }) => kind)).toEqual([...STALE_DOC_KINDS]);
      expect(() => insert(db, staleDoc({ kind: 'settled', what: 'a third kind' })))
        .toThrow('CHECK constraint failed: kind IN (\'sighting\', \'unsettled\')');
      expect(() => insert(db, staleDoc({ kind: null, what: 'no kind' }))).toThrow('NOT NULL constraint failed: stale_docs.kind');
      expect(countOf(db)).toBe(STALE_DOC_KINDS.length);
    });
  });

  it('refuses a missing or empty what, and an empty place, id or session', () => {
    withCurrentStore((db) => {
      expect(() => insert(db, staleDoc({ what: null }))).toThrow('NOT NULL constraint failed: stale_docs.what');
      expect(() => insert(db, staleDoc({ what: '' }))).toThrow('CHECK constraint failed: what <> \'\'');
      expect(() => insert(db, staleDoc({ where_at: '' }))).toThrow('CHECK constraint failed: where_at <> \'\'');
      expect(() => insert(db, staleDoc({ id: '' }))).toThrow('CHECK constraint failed: id <> \'\'');
      expect(() => insert(db, staleDoc({ session_id: '' }))).toThrow('CHECK constraint failed: session_id <> \'\'');
      expect(() => insert(db, staleDoc({ session_id: null }))).toThrow('NOT NULL constraint failed: stale_docs.session_id');
      expect(countOf(db)).toBe(0);
    });
  });

  it('takes a row with no place and no plan, NULL in both', () => {
    withCurrentStore((db) => {
      insert(db, staleDoc({ where_at: null, plan_stub: null }));

      expect(db.query<Row, []>('SELECT seq, plan_stub, where_at, what FROM stale_docs').all()).toEqual([
        { seq: 1, plan_stub: null, where_at: null, what: 'the page names three channels' },
      ]);
    });
  });

  it('refuses one session\'s repeat of an entry under one kind, with a place and without one', () => {
    withCurrentStore((db) => {
      insert(db, staleDoc());
      insert(db, staleDoc({ where_at: null }));

      expect(() => insert(db, staleDoc())).toThrow('UNIQUE constraint failed: index \'stale_docs_by_entry\'');
      expect(() => insert(db, staleDoc({ where_at: null }))).toThrow('UNIQUE constraint failed: index \'stale_docs_by_entry\'');
      expect(countOf(db)).toBe(2);
    });
  });

  it('stores the same entry again under the other kind, another session, another place or another what', () => {
    withCurrentStore((db) => {
      insert(db, staleDoc());

      insert(db, staleDoc({ kind: 'unsettled' }));
      insert(db, staleDoc({ session_id: 's-2' }));
      insert(db, staleDoc({ where_at: 'context/triage.md:13' }));
      insert(db, staleDoc({ what: 'the page names no docs channel' }));

      expect(countOf(db)).toBe(5);
    });
  });

  it('refuses a second row under one id', () => {
    withCurrentStore((db) => {
      insert(db, staleDoc({ id: 'stale-twice' }));

      expect(() => insert(db, staleDoc({ id: 'stale-twice', what: 'another line' })))
        .toThrow('UNIQUE constraint failed: stale_docs.id');
    });
  });

  it('refuses a second row under one origin pair, and takes any number with no origin', () => {
    withCurrentStore((db) => {
      insert(db, staleDoc({ what: 'first', origin_store: 'store-a', origin_seq: 1 }));
      insert(db, staleDoc({ what: 'second' }));
      insert(db, staleDoc({ what: 'third' }));

      expect(() => insert(db, staleDoc({ what: 'fourth', origin_store: 'store-a', origin_seq: 1 })))
        .toThrow('UNIQUE constraint failed: stale_docs.origin_store, stale_docs.origin_seq');
      insert(db, staleDoc({ what: 'fifth', origin_store: 'store-b', origin_seq: 1 }));
      expect(countOf(db)).toBe(4);
    });
  });
});

describe('stale-docs beside both backends', () => {
  it('names no kind of the port, so neither backend routes the table as one', () => {
    expect(Object.keys(EFFORT_KEY_PROJECTIONS)).toEqual(['sessions', 'commits']);
  });

  it('is applied by the SQLite backend\'s own append, which stores its row beside the old one', () => {
    const root = freshRoot();
    const path = plantOlderStore(root);
    const row = { sessionId: 'n3w-5e55', assistantRecordCount: 1 } as unknown as SessionEffortRow;

    const appended = openSqliteStore(root).append('sessions', [row]);

    expect(appended.appended).toBe(1);
    expect(loggedIds(path)).toContain('stale-docs');
    expect(read(path, 'SELECT session_id FROM sessions ORDER BY seq')).toEqual([{ session_id: '01d-5e55' }, { session_id: 'n3w-5e55' }]);
  });

  it('reaches the SQLite file of a project whose rows the NDJSON backend holds, and leaves that backend\'s files alone', () => {
    const root = freshRoot();
    const ndjson = openNdjsonStore(root);
    const row = { sessionId: 'nd-5e55', assistantRecordCount: 1 } as unknown as SessionEffortRow;
    ndjson.append('sessions', [row]);
    const path = plantOlderStore(root);
    const ndjsonFile = ndjson.path('sessions');
    const before = readFileSync(ndjsonFile);

    writeSqliteStore(path, 0, undefined, () => undefined);

    expect(loggedIds(path)).toContain('stale-docs');
    expect(tablesOf(path)).toContain('stale_docs');
    expect(readFileSync(ndjsonFile).equals(before)).toBe(true);
    expect(ndjson.read('sessions')).toEqual([row]);
    expect(readdirSync(dirname(path)).filter((name) => name.includes('stale'))).toEqual([]);
  });
});
