/**
 * The `session-worktree` migration over a store an older runtime left,
 * and the `worktree` field it records through both backends.
 *
 * The older store is planted the way that runtime leaves one: brought
 * through `bringForward` with the catalogue up to the entry before
 * `session-worktree`, and given a session row inserted as that runtime
 * inserts it, naming no `worktree`. The next open through the SQLite
 * backend applies the entry, and the row keeps its `row_json` byte for
 * byte, reads NULL in the new column and comes back from `read`
 * unchanged. A control shows the planted store has no such column, so
 * the NULL reading cannot come from a column that was already there.
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
import { SQLITE_MIGRATIONS } from './migrations.js';
import { openNdjsonStore } from './ndjson.js';
import { openSqliteStore, sqliteStorePath } from './sqlite.js';

const tempBase = realpathSync(mkdtempSync(join(tmpdir(), 'rafa-session-worktree-')));

afterAll(() => {
  rmSync(tempBase, { recursive: true, force: true });
});

/** The index of `session-worktree` in the catalogue. */
const ENTRY_INDEX = SQLITE_MIGRATIONS.findIndex(({ id }) => id === 'session-worktree');

/** The catalogue a runtime before `session-worktree` holds. */
const BEFORE_ENTRY = SQLITE_MIGRATIONS.slice(0, ENTRY_INDEX);

/** The row an older runtime inserted, as the JSON text it wrote. */
const OLD_ROW_JSON = '{"sessionId":"01d-5e55","assistantRecordCount":2}';

/** A worktree path a session of a run's worktree records. */
const WORKTREE = '/home/someone/project/.rafa/worktrees/rafa-768-bug-sweep-8';

let planted = 0;

/** A fresh repo root of its own under the temporary directory. */
function freshRoot(): string {
  planted += 1;
  const root = join(tempBase, `root-${String(planted)}`);
  mkdirSync(root, { recursive: true });
  return root;
}

/** A session row carrying its key, one counter and `worktree`. The cast is the plant. */
function sessionRow(sessionId: string, worktree: string | null): SessionEffortRow {
  return { sessionId, assistantRecordCount: 1, worktree } as unknown as SessionEffortRow;
}

/**
 * The SQLite store under `root`, brought to the entry before
 * `session-worktree`, holding one session row inserted as an older
 * runtime inserts it. Answers the store file.
 */
function plantOlderStore(root: string): string {
  const path = sqliteStorePath(root);
  mkdirSync(dirname(path), { recursive: true });
  const db = new Database(path, { readwrite: true, create: true });
  try {
    bringForward(db, path, 'write', 'open', { migrations: BEFORE_ENTRY });
    db.query('INSERT INTO sessions (session_id, row_json) VALUES (?, ?)').run('01d-5e55', OLD_ROW_JSON);
  } finally {
    db.close();
  }
  return path;
}

/** The `sessions` columns `columns` names, every row in `seq` order. */
function sessionColumns(path: string, columns: readonly string[]): Record<string, unknown>[] {
  const db = new Database(path, { readonly: true });
  try {
    return db
      .query<Record<string, unknown>, []>(`SELECT ${columns.join(', ')} FROM sessions ORDER BY seq`)
      .all();
  } finally {
    db.close();
  }
}

/** The migration ids the store at `path` has logged, in the order it applied them. */
function loggedIds(path: string): string[] {
  const db = new Database(path, { readonly: true });
  try {
    return db
      .query<{ id: string }, []>('SELECT id FROM schema_migrations ORDER BY rowid')
      .all()
      .map(({ id }) => id);
  } finally {
    db.close();
  }
}

describe('the session-worktree entry', () => {
  it('is the entry right after store-meta-generation, additive', () => {
    expect(SQLITE_MIGRATIONS[ENTRY_INDEX - 1]?.id).toBe('store-meta-generation');
    expect(SQLITE_MIGRATIONS[ENTRY_INDEX]?.breaks).toEqual([]);
  });
});

describe('session-worktree over a store an older runtime left', () => {
  it('control: the planted store has no worktree column to read', () => {
    const path = plantOlderStore(freshRoot());

    expect(() => sessionColumns(path, ['worktree'])).toThrow('no such column: worktree');
    expect(loggedIds(path)).not.toContain('session-worktree');
  });

  it('applies on the next open, leaving the old row NULL in worktree and its row_json as it was', () => {
    const root = freshRoot();
    const path = plantOlderStore(root);

    const read = openSqliteStore(root).read('sessions');

    expect(loggedIds(path).at(-1)).toBe('session-worktree');
    expect(sessionColumns(path, ['session_id', 'row_json', 'worktree'])).toEqual([
      { session_id: '01d-5e55', row_json: OLD_ROW_JSON, worktree: null },
    ]);
    expect(read).toEqual([JSON.parse(OLD_ROW_JSON) as SessionEffortRow]);
  });

  it('still takes an insert that names no worktree, as the older runtime writes one', () => {
    const root = freshRoot();
    const path = plantOlderStore(root);
    openSqliteStore(root).read('sessions');

    const db = new Database(path, { readwrite: true });
    try {
      db.query('INSERT INTO sessions (session_id, row_json) VALUES (?, ?)')
        .run('0ld-2', '{"sessionId":"0ld-2"}');
    } finally {
      db.close();
    }

    expect(sessionColumns(path, ['session_id', 'worktree'])).toEqual([
      { session_id: '01d-5e55', worktree: null },
      { session_id: '0ld-2', worktree: null },
    ]);
  });
});

describe('the worktree field through both backends', () => {
  it('fills the SQLite column from the row, NULL for the main checkout\'s', () => {
    const root = freshRoot();
    const path = plantOlderStore(root);
    const store = openSqliteStore(root);

    const appended = store.append('sessions', [sessionRow('w0rk-1', WORKTREE), sessionRow('ma1n-1', null)]);

    expect(appended.appended).toBe(2);
    expect(sessionColumns(path, ['session_id', 'worktree'])).toEqual([
      { session_id: '01d-5e55', worktree: null },
      { session_id: 'w0rk-1', worktree: WORKTREE },
      { session_id: 'ma1n-1', worktree: null },
    ]);
  });

  it('reads NULL in the column for a row that carries no worktree field at all', () => {
    const root = freshRoot();
    const store = openSqliteStore(root);
    const fieldless = { sessionId: 'n0-f1eld', assistantRecordCount: 1 } as unknown as SessionEffortRow;

    store.append('sessions', [fieldless]);

    expect(sessionColumns(sqliteStorePath(root), ['session_id', 'worktree'])).toEqual([
      { session_id: 'n0-f1eld', worktree: null },
    ]);
    expect(store.read('sessions')).toEqual([fieldless]);
  });

  it('reads back the same rows from the NDJSON and the SQLite backend', () => {
    const rows = [sessionRow('w0rk-2', WORKTREE), sessionRow('ma1n-2', null)];
    const sqlite = openSqliteStore(freshRoot());
    const ndjson = openNdjsonStore(freshRoot());

    sqlite.append('sessions', rows);
    ndjson.append('sessions', rows);

    expect(sqlite.read('sessions')).toEqual(rows);
    expect(ndjson.read('sessions')).toEqual(rows);
    expect(sqlite.read('sessions').map((row) => row.worktree)).toEqual([WORKTREE, null]);
  });
});
