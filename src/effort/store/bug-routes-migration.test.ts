/**
 * The `bug-routes` migration over a store an older runtime left, the
 * table it creates, and what it leaves alone in both backends.
 *
 * The older store is planted the way that runtime leaves one: brought
 * through `bringForward` with the catalogue up to the entry before
 * `bug-routes`, found by its id, and given a session row and a bug row
 * inserted as that runtime inserts them. The next open applies the
 * entry. A control shows the planted store has no such table, so the
 * table read afterwards cannot have been there already, and every other
 * table is compared row for row across the open.
 *
 * The table's own refusals are read through raw inserts, since the
 * table has no writer yet: each CHECK and each unique index is paired
 * with the row that differs in one value and is stored. The CHECKs are
 * read against `BUG_KINDS` and `BUG_ROUTES` word by word, so a word the
 * constants and the SQL spell differently fails here.
 *
 * Every store is planted under this file's own temporary directory.
 */
import type { SessionEffortRow } from './types.js';

import { mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { Database } from 'bun:sqlite';
import { afterAll, describe, expect, it } from 'bun:test';

import { BUG_KINDS } from '../../report/parse.js';

import { bringForward } from './bring-forward.js';
import { BUG_ROUTES } from './bug-routes.js';
import { MERGE_RULES } from './merge-rules.js';
import { LEGACY_GATE_OPEN, SQLITE_MIGRATIONS } from './migrations.js';
import { openNdjsonStore } from './ndjson.js';
import { ORIGIN_TABLES } from './origins.js';
import { openSqliteStore, sqliteStorePath, writeSqliteStore } from './sqlite.js';
import { EFFORT_KEY_PROJECTIONS } from './types.js';

const tempBase = realpathSync(mkdtempSync(join(tmpdir(), 'rafa-bug-routes-migration-')));

afterAll(() => {
  rmSync(tempBase, { recursive: true, force: true });
});

/** The entry, found by its id. */
const ENTRY = SQLITE_MIGRATIONS.find(({ id }) => id === 'bug-routes');

/** The catalogue a runtime before `bug-routes` holds: every entry ahead of it. */
const BEFORE_ENTRY = SQLITE_MIGRATIONS.slice(0, SQLITE_MIGRATIONS.findIndex(({ id }) => id === 'bug-routes'));

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
  'entry_index',
  'what',
  'said',
  'kind',
  'route',
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
 * `bug-routes`, holding one session row and one bug row inserted as an
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

/** One `bug_routes` row to insert, by column, with nothing left to a default. */
interface PlantedBugRoute {
  readonly id: unknown;
  readonly session_id: unknown;
  readonly plan_stub: unknown;
  readonly task_line: unknown;
  readonly entry_index: unknown;
  readonly what: unknown;
  readonly said: unknown;
  readonly kind: unknown;
  readonly route: unknown;
  readonly collected_at: unknown;
  readonly origin_store: unknown;
  readonly origin_seq: unknown;
}

let rowIds = 0;

/** A row the table takes, under an id of its own, with `over` laid over it. */
function bugRoute(over: Partial<PlantedBugRoute> = {}): PlantedBugRoute {
  rowIds += 1;
  return {
    id: `route-${String(rowIds)}`,
    session_id: 's-1',
    plan_stub: 'phase-1',
    task_line: 'Add the module',
    entry_index: 0,
    what: 'the parser drops a key',
    said: 'bug',
    kind: 'bug',
    route: 'filed',
    collected_at: '2026-10-14T10:00:00.000Z',
    origin_store: null,
    origin_seq: null,
    ...over,
  };
}

/** Inserts `row` into `bug_routes`, every column but `seq` named. */
function insert(db: Database, row: PlantedBugRoute): void {
  const columns = Object.keys(row);
  db.query(`INSERT INTO bug_routes (${columns.join(', ')}) VALUES (${columns.map(() => '?').join(', ')})`)
    .run(...(Object.values(row) as (string | number | null)[]));
}

/** How many rows `bug_routes` holds. */
function countOf(db: Database): number {
  return db.query<{ n: number }, []>('SELECT count(*) AS n FROM bug_routes').get()?.n ?? -1;
}

describe('the bug-routes entry', () => {
  it('is in the catalogue under its id, additive', () => {
    expect(ENTRY?.id).toBe('bug-routes');
    expect(ENTRY?.breaks).toEqual([]);
    expect(ENTRY?.contract).toBeUndefined();
  });

  it('makes a merged table, append-only by id, among the tables whose inserts stamp their origin', () => {
    expect(MERGE_RULES['bug_routes']).toEqual({ scope: 'merged', identity: ['id'], edited: {} });
    expect(ORIGIN_TABLES).toContain('bug_routes');
  });
});

describe('bug-routes over a store an older runtime left', () => {
  it('control: the planted store has no bug_routes table and has not logged the entry', () => {
    const path = plantOlderStore(freshRoot());

    expect(tablesOf(path)).not.toContain('bug_routes');
    expect(() => read(path, 'SELECT seq FROM bug_routes')).toThrow('no such table: bug_routes');
    expect(loggedIds(path)).not.toContain('bug-routes');
    expect(loggedIds(path)).toEqual(BEFORE_ENTRY.map(({ id }) => id));
  });

  it('applies on the next open, creating the table empty with its columns in order', () => {
    const root = freshRoot();
    const path = plantOlderStore(root);

    openSqliteStore(root).read('sessions');

    expect(loggedIds(path)).toContain('bug-routes');
    expect(read(path, 'SELECT name FROM pragma_table_info(\'bug_routes\') ORDER BY cid').map(({ name }) => name)).toEqual(COLUMNS);
    expect(read(path, 'SELECT count(*) AS n FROM bug_routes')).toEqual([{ n: 0 }]);
    expect(read(path, 'SELECT name FROM sqlite_master WHERE type = \'index\' AND tbl_name = \'bug_routes\' AND sql IS NOT NULL ORDER BY name'))
      .toEqual([{ name: 'bug_routes_by_entry' }, { name: 'bug_routes_by_origin' }]);
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
    expect(tablesOf(path).filter((table) => !tables.includes(table))).toEqual(['bug_routes', 'schema_migrations']);
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
    expect(logged.filter((id) => id === 'bug-routes')).toHaveLength(1);
  });
});

describe('the bug_routes table', () => {
  it('takes every kind of BUG_KINDS as the kind said and the kind routed, and no other word', () => {
    withCurrentStore((db) => {
      BUG_KINDS.forEach((kind, index) => insert(db, bugRoute({ said: kind, kind, entry_index: index })));

      const stored = db.query<{ said: string; kind: string }, []>('SELECT said, kind FROM bug_routes ORDER BY seq').all();
      expect(stored.map(({ said }) => said)).toEqual([...BUG_KINDS]);
      expect(stored.map(({ kind }) => kind)).toEqual([...BUG_KINDS]);
      expect(() => insert(db, bugRoute({ said: 'feature', entry_index: 10 }))).toThrow('CHECK constraint failed: said IN (');
      expect(() => insert(db, bugRoute({ kind: 'feature', entry_index: 11 }))).toThrow('CHECK constraint failed: kind IN (');
      expect(() => insert(db, bugRoute({ kind: null, entry_index: 12 }))).toThrow('NOT NULL constraint failed: bug_routes.kind');
      expect(countOf(db)).toBe(BUG_KINDS.length);
    });
  });

  it('takes every route of BUG_ROUTES, and no other word', () => {
    withCurrentStore((db) => {
      BUG_ROUTES.forEach((route, index) => insert(db, bugRoute({ route, entry_index: index })));

      const stored = db.query<{ route: string }, []>('SELECT route FROM bug_routes ORDER BY seq').all();
      expect(stored.map(({ route }) => route)).toEqual([...BUG_ROUTES]);
      expect(BUG_ROUTES).toHaveLength(8);
      expect(() => insert(db, bugRoute({ route: 'dropped', entry_index: 10 }))).toThrow('CHECK constraint failed: route IN (');
      expect(() => insert(db, bugRoute({ route: null, entry_index: 11 }))).toThrow('NOT NULL constraint failed: bug_routes.route');
      expect(countOf(db)).toBe(BUG_ROUTES.length);
    });
  });

  it('takes a row whose report held no kind key and was written under no plan, NULL in both', () => {
    withCurrentStore((db) => {
      insert(db, bugRoute({ said: null, plan_stub: null }));

      expect(db.query<Row, []>('SELECT seq, plan_stub, said, kind, route FROM bug_routes').all()).toEqual([
        { seq: 1, plan_stub: null, said: null, kind: 'bug', route: 'filed' },
      ]);
    });
  });

  it('refuses a missing or empty what, an empty id or session, and a missing or negative entry index', () => {
    withCurrentStore((db) => {
      expect(() => insert(db, bugRoute({ what: null }))).toThrow('NOT NULL constraint failed: bug_routes.what');
      expect(() => insert(db, bugRoute({ what: '' }))).toThrow('CHECK constraint failed: what <> \'\'');
      expect(() => insert(db, bugRoute({ id: '' }))).toThrow('CHECK constraint failed: id <> \'\'');
      expect(() => insert(db, bugRoute({ session_id: '' }))).toThrow('CHECK constraint failed: session_id <> \'\'');
      expect(() => insert(db, bugRoute({ session_id: null }))).toThrow('NOT NULL constraint failed: bug_routes.session_id');
      expect(() => insert(db, bugRoute({ entry_index: null }))).toThrow('NOT NULL constraint failed: bug_routes.entry_index');
      expect(() => insert(db, bugRoute({ entry_index: -1 }))).toThrow('CHECK constraint failed: entry_index >= 0');
      expect(countOf(db)).toBe(0);
    });
  });

  it('refuses one session\'s repeat of an entry, whatever it was routed under the second time', () => {
    withCurrentStore((db) => {
      insert(db, bugRoute());

      expect(() => insert(db, bugRoute())).toThrow('UNIQUE constraint failed: bug_routes.session_id, bug_routes.entry_index, bug_routes.what');
      expect(() => insert(db, bugRoute({ kind: 'own-gap', route: 'repair' })))
        .toThrow('UNIQUE constraint failed: bug_routes.session_id, bug_routes.entry_index, bug_routes.what');
      expect(countOf(db)).toBe(1);
    });
  });

  it('stores the same entry again under another session, another index or another what', () => {
    withCurrentStore((db) => {
      insert(db, bugRoute());

      insert(db, bugRoute({ session_id: 's-2' }));
      insert(db, bugRoute({ entry_index: 1 }));
      insert(db, bugRoute({ what: 'the parser drops a second key' }));

      expect(countOf(db)).toBe(4);
    });
  });

  it('refuses a second row under one id', () => {
    withCurrentStore((db) => {
      insert(db, bugRoute({ id: 'route-twice' }));

      expect(() => insert(db, bugRoute({ id: 'route-twice', what: 'another bug' })))
        .toThrow('UNIQUE constraint failed: bug_routes.id');
    });
  });

  it('refuses a second row under one origin pair, and takes any number with no origin', () => {
    withCurrentStore((db) => {
      insert(db, bugRoute({ what: 'first', origin_store: 'store-a', origin_seq: 1 }));
      insert(db, bugRoute({ what: 'second' }));
      insert(db, bugRoute({ what: 'third' }));

      expect(() => insert(db, bugRoute({ what: 'fourth', origin_store: 'store-a', origin_seq: 1 })))
        .toThrow('UNIQUE constraint failed: bug_routes.origin_store, bug_routes.origin_seq');
      insert(db, bugRoute({ what: 'fifth', origin_store: 'store-b', origin_seq: 1 }));
      expect(countOf(db)).toBe(4);
    });
  });
});

describe('bug-routes beside both backends', () => {
  it('names no kind of the port, so neither backend routes the table as one', () => {
    expect(Object.keys(EFFORT_KEY_PROJECTIONS)).toEqual(['sessions', 'commits']);
  });

  it('is applied by the SQLite backend\'s own append, which stores its row beside the old one', () => {
    const root = freshRoot();
    const path = plantOlderStore(root);
    const row = { sessionId: 'n3w-5e55', assistantRecordCount: 1 } as unknown as SessionEffortRow;

    const appended = openSqliteStore(root).append('sessions', [row]);

    expect(appended.appended).toBe(1);
    expect(loggedIds(path)).toContain('bug-routes');
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

    expect(loggedIds(path)).toContain('bug-routes');
    expect(tablesOf(path)).toContain('bug_routes');
    expect(readFileSync(ndjsonFile).equals(before)).toBe(true);
    expect(ndjson.read('sessions')).toEqual([row]);
    expect(readdirSync(dirname(path)).filter((name) => name.includes('route'))).toEqual([]);
  });
});
