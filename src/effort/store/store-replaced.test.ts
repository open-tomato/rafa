/**
 * `store-replaced.ts`: the read of the ids a store replaced (none for a
 * store without the table and for one with it empty), the record of one
 * id with its time, and the emptying of the table. Every store is a real
 * file under `tmpdir()`. The table is made by the SQL of the migration
 * `store-replaced` itself, found by its id, so a case fails when the
 * module and the migration name different columns; one group opens a
 * store through `withSqliteStore`, the open claim code reads through.
 */
import type { StoreIdentitySeams } from './store-meta.js';
import type { ReplacedStoreId } from './store-replaced.js';

import { mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { Database } from 'bun:sqlite';
import { afterAll, describe, expect, it } from 'bun:test';

import { SQLITE_MIGRATIONS } from './migrations.js';
import { withSqliteStore } from './sqlite.js';
import {
  clearReplacedStoreIds,
  readReplacedStoreIds,
  recordReplacedStoreId,
} from './store-replaced.js';

const scope = realpathSync(mkdtempSync(join(tmpdir(), 'rafa-store-replaced-')));
afterAll(() => {
  rmSync(scope, { recursive: true, force: true });
});

const FIRST_MOVE = new Date('2026-10-01T08:00:00.000Z');
const SECOND_MOVE = new Date('2026-10-02T09:30:00.000Z');

/** The SQL of the migration `store-replaced`, found by its id. */
function storeReplacedSql(): string {
  const migration = SQLITE_MIGRATIONS.find(({ id }) => id === 'store-replaced');
  if (migration === undefined) throw new Error('migration store-replaced is not in SQLITE_MIGRATIONS');
  return migration.sql;
}

/** A store path in a fresh directory of its own, not yet created. */
function freshPath(name: string): string {
  return join(realpathSync(mkdtempSync(join(scope, `${name}-`))), 'effort.sqlite');
}

/**
 * Runs `use` over a new database file under `tmpdir()`, holding the
 * table `store_replaced` when `withTable`, and closes it whatever `use`
 * did.
 */
function withDatabase<T>(name: string, withTable: boolean, use: (db: Database) => T): T {
  const db = new Database(freshPath(name), { readwrite: true, create: true });
  try {
    if (withTable) db.run(storeReplacedSql());
    return use(db);
  } finally {
    db.close();
  }
}

/** Whether `db` holds the table `store_replaced`, read from `sqlite_master`. */
function hasTable(db: Database): boolean {
  return db.query<{ n: number }, []>(
    'SELECT count(*) AS n FROM sqlite_master WHERE type = \'table\' AND name = \'store_replaced\'',
  ).get()?.n === 1;
}

/** The rows of `store_replaced` as SQLite holds them, read apart from the module. */
function rawRows(db: Database): { store_id: string; replaced_at: string }[] {
  return db.query<{ store_id: string; replaced_at: string }, []>(
    'SELECT store_id, replaced_at FROM store_replaced ORDER BY store_id',
  ).all();
}

describe('readReplacedStoreIds', () => {
  it('answers none for a store without the table', () => {
    withDatabase('absent', false, (db) => {
      expect(hasTable(db)).toBe(false);

      expect(readReplacedStoreIds(db)).toEqual([]);
    });
  });

  it('answers none for a store with the table empty', () => {
    withDatabase('empty', true, (db) => {
      expect(hasTable(db)).toBe(true);

      expect(readReplacedStoreIds(db)).toEqual([]);
    });
  });

  it('leaves a store without the table without it', () => {
    withDatabase('absent-untouched', false, (db) => {
      readReplacedStoreIds(db);

      expect(hasTable(db)).toBe(false);
    });
  });

  it('answers each id with the time it was replaced, the earliest first', () => {
    withDatabase('ordered', true, (db) => {
      recordReplacedStoreId(db, 'store-z', FIRST_MOVE);
      recordReplacedStoreId(db, 'store-a', SECOND_MOVE);

      const replaced: readonly ReplacedStoreId[] = readReplacedStoreIds(db);

      expect(replaced).toEqual([
        { storeId: 'store-z', replacedAt: '2026-10-01T08:00:00.000Z' },
        { storeId: 'store-a', replacedAt: '2026-10-02T09:30:00.000Z' },
      ]);
    });
  });

  it('orders two ids replaced at one instant by id', () => {
    withDatabase('same-instant', true, (db) => {
      recordReplacedStoreId(db, 'store-b', FIRST_MOVE);
      recordReplacedStoreId(db, 'store-a', FIRST_MOVE);

      expect(readReplacedStoreIds(db).map(({ storeId }) => storeId)).toEqual(['store-a', 'store-b']);
    });
  });
});

describe('recordReplacedStoreId', () => {
  it('writes one row holding the id and the time as an ISO string', () => {
    withDatabase('record', true, (db) => {
      recordReplacedStoreId(db, 'store-1', FIRST_MOVE);

      expect(rawRows(db)).toEqual([{ store_id: 'store-1', replaced_at: '2026-10-01T08:00:00.000Z' }]);
    });
  });

  it('keeps an earlier id when a second one is recorded', () => {
    withDatabase('two-moves', true, (db) => {
      recordReplacedStoreId(db, 'store-1', FIRST_MOVE);

      recordReplacedStoreId(db, 'store-2', SECOND_MOVE);

      expect(rawRows(db)).toEqual([
        { store_id: 'store-1', replaced_at: '2026-10-01T08:00:00.000Z' },
        { store_id: 'store-2', replaced_at: '2026-10-02T09:30:00.000Z' },
      ]);
    });
  });

  it('keeps the first time of an id recorded twice and adds no row', () => {
    withDatabase('twice', true, (db) => {
      recordReplacedStoreId(db, 'store-1', FIRST_MOVE);

      recordReplacedStoreId(db, 'store-1', SECOND_MOVE);

      expect(rawRows(db)).toEqual([{ store_id: 'store-1', replaced_at: '2026-10-01T08:00:00.000Z' }]);
    });
  });

  it('refuses an empty id and writes nothing', () => {
    withDatabase('empty-id', true, (db) => {
      expect(() => {
        recordReplacedStoreId(db, '', FIRST_MOVE);
      }).toThrow(/replaced store id must be non-empty/);

      expect(rawRows(db)).toEqual([]);
    });
  });

  it('refuses a time that is no date and writes nothing', () => {
    withDatabase('invalid-time', true, (db) => {
      expect(() => {
        recordReplacedStoreId(db, 'store-1', new Date(Number.NaN));
      }).toThrow(/replaced time of store store-1 is not a valid date/);

      expect(rawRows(db)).toEqual([]);
    });
  });

  it('throws SQLite\'s own error for a store without the table', () => {
    withDatabase('record-absent', false, (db) => {
      expect(() => {
        recordReplacedStoreId(db, 'store-1', FIRST_MOVE);
      }).toThrow(/no such table: store_replaced/);
    });
  });
});

describe('clearReplacedStoreIds', () => {
  it('removes every row and keeps the table', () => {
    withDatabase('clear', true, (db) => {
      recordReplacedStoreId(db, 'store-1', FIRST_MOVE);
      recordReplacedStoreId(db, 'store-2', SECOND_MOVE);
      expect(rawRows(db)).toHaveLength(2);

      clearReplacedStoreIds(db);

      expect(rawRows(db)).toEqual([]);
      expect(readReplacedStoreIds(db)).toEqual([]);
      expect(hasTable(db)).toBe(true);
    });
  });

  it('leaves an empty table empty', () => {
    withDatabase('clear-empty', true, (db) => {
      clearReplacedStoreIds(db);

      expect(rawRows(db)).toEqual([]);
    });
  });

  it('writes nothing to a store without the table and does not create it', () => {
    withDatabase('clear-absent', false, (db) => {
      clearReplacedStoreIds(db);

      expect(hasTable(db)).toBe(false);
      expect(readReplacedStoreIds(db)).toEqual([]);
    });
  });

  it('lets an id be recorded again after the table was emptied', () => {
    withDatabase('clear-then-record', true, (db) => {
      recordReplacedStoreId(db, 'store-1', FIRST_MOVE);
      clearReplacedStoreIds(db);

      recordReplacedStoreId(db, 'store-1', SECOND_MOVE);

      expect(readReplacedStoreIds(db)).toEqual([{ storeId: 'store-1', replacedAt: '2026-10-02T09:30:00.000Z' }]);
    });
  });
});

describe('inside the caller\'s transaction', () => {
  it('commits a record and a clear with the transaction', () => {
    withDatabase('commit', true, (db) => {
      recordReplacedStoreId(db, 'store-1', FIRST_MOVE);

      db.transaction(() => {
        clearReplacedStoreIds(db);
        recordReplacedStoreId(db, 'store-2', SECOND_MOVE);
      }).immediate();

      expect(rawRows(db)).toEqual([{ store_id: 'store-2', replaced_at: '2026-10-02T09:30:00.000Z' }]);
    });
  });

  it('rolls a record and a clear back with a transaction that throws', () => {
    withDatabase('rollback', true, (db) => {
      recordReplacedStoreId(db, 'store-1', FIRST_MOVE);
      const failing = db.transaction(() => {
        clearReplacedStoreIds(db);
        recordReplacedStoreId(db, 'store-2', SECOND_MOVE);
        throw new Error('side record failed');
      });

      expect(() => {
        failing.immediate();
      }).toThrow('side record failed');

      expect(rawRows(db)).toEqual([{ store_id: 'store-1', replaced_at: '2026-10-01T08:00:00.000Z' }]);
    });
  });
});

describe('over a store opened through withSqliteStore', () => {
  /** Seams that read neither this machine's host id nor git. */
  const seams: StoreIdentitySeams = {
    readHostId: () => 'host-a',
    readProject: () => ({ rootCommit: 'a1b2c3d4', remote: null }),
    newStoreId: () => 'store-now',
    newGeneration: () => 'gen-1',
    now: () => FIRST_MOVE,
  };

  it('reads none from a new store, whose table the open created', () => {
    const path = freshPath('opened-new');

    const read = withSqliteStore(path, 'write', true, (db) => ({
      table: hasTable(db),
      replaced: readReplacedStoreIds(db),
    }), seams);

    expect(read).toEqual({ table: true, replaced: [] });
  });

  it('reads through a read open what a write open recorded', () => {
    const path = freshPath('opened-recorded');
    withSqliteStore(path, 'write', true, (db) => {
      recordReplacedStoreId(db, 'store-before', SECOND_MOVE);
    }, seams);

    const replaced = withSqliteStore(path, 'read', false, (db) => readReplacedStoreIds(db), seams);

    expect(replaced).toEqual([{ storeId: 'store-before', replacedAt: '2026-10-02T09:30:00.000Z' }]);
  });
});
