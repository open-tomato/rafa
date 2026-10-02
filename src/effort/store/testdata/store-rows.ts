/**
 * Every row a SQLite store file holds, read so that two files compare by
 * content rather than by bytes.
 *
 * The backup the build-aside swap leaves (`rebuild-aside.ts`) is written
 * with `VACUUM INTO`, so it is a snapshot of the store, not its bytes:
 * the pages are laid out afresh, and SQLite's documentation says a
 * vacuum may renumber the rowids of a table with no `INTEGER PRIMARY
 * KEY`. So a test that finds a backup holds the original reads both
 * through {@link storeRows} and compares the answers: each table's rows
 * as JSON, sorted, so their order counts for nothing, and the file's
 * `user_version`. Every table is read, `store_meta` and the migration
 * log among them.
 */
import { Database } from 'bun:sqlite';

/** What a store file holds: its `user_version`, and every table's rows as sorted JSON, by table name. */
export interface StoreRows {
  readonly userVersion: number;
  readonly tables: Readonly<Record<string, readonly string[]>>;
}

/** Reads {@link StoreRows} off the SQLite file at `path`, on a read-only connection of its own. */
export function storeRows(path: string): StoreRows {
  const db = new Database(path, { readonly: true });
  try {
    const names = db.query<{ name: string }, []>('SELECT name FROM sqlite_master WHERE type = \'table\' ORDER BY name').all();
    const tables = Object.fromEntries(names.map(({ name }) => [
      name,
      db.query<Record<string, unknown>, []>(`SELECT * FROM "${name.replaceAll('"', '""')}"`).all()
        .map((row) => JSON.stringify(row))
        .sort(),
    ]));
    const userVersion = db.query<{ user_version: number }, []>('PRAGMA user_version').get()?.user_version ?? 0;
    return { userVersion, tables };
  } finally {
    db.close();
  }
}
