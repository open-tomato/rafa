/**
 * The ids a store carried before its present one: reading the table
 * `store_replaced`, recording one id into it with the time it was
 * replaced, and emptying it.
 *
 * ## What the table holds
 *
 * Migration `store-replaced` creates `store_replaced`, one row per id:
 * `store_id`, its primary key, and `replaced_at`, an ISO string. Like
 * `store_meta` it is SQLite-only, outside the port's row map, and
 * `local` in `MERGE_RULES`, so it never leaves the machine. A store
 * file found under the host and path its `store_meta` row names is this
 * device's own store, moved or rolled back, and a claim made under an
 * id held here is still this device's.
 *
 * ## What this module does not decide
 *
 * It reads and writes rows and nothing else. Which mint records the
 * outgoing id and which one empties the table is the caller's decision,
 * as is the transaction either write runs in: every function takes the
 * open handle and begins none of its own, so a write made inside the
 * caller's transaction commits or rolls back with it. No function opens
 * a store; a caller passes the handle `withSqliteStore` (`sqlite.ts`)
 * gave it.
 *
 * ## A store without the table
 *
 * A store an older runtime left has no `store_replaced`.
 * {@link readReplacedStoreIds}
 * answers none for it, the same answer as for an empty table, and
 * creates nothing. {@link clearReplacedStoreIds} writes nothing to it,
 * since a table that does not exist already holds no id.
 * {@link recordReplacedStoreId} is the one that throws there, with
 * SQLite's own `no such table: store_replaced`: an id that cannot be
 * kept is not reported as kept.
 *
 * ## An id recorded twice
 *
 * The id is the primary key. Recording one the table already holds
 * adds no row and keeps the time first recorded, because that is when
 * the store stopped carrying the id.
 */
import type { Database } from 'bun:sqlite';

/** The name of the table, as migration `store-replaced` creates it. */
const STORE_REPLACED_TABLE = 'store_replaced';

/** One id a store carried before its present one. */
export interface ReplacedStoreId {
  /** The id the store carried. */
  readonly storeId: string;
  /** When the store stopped carrying it, as an ISO string. */
  readonly replacedAt: string;
}

/** A row as SQLite answers it. */
interface ReplacedStoreIdColumns {
  readonly store_id: string;
  readonly replaced_at: string;
}

/** Whether `db` holds the table `store_replaced`. */
function hasStoreReplacedTable(db: Database): boolean {
  return db.query<{ n: number }, [string]>(
    'SELECT count(*) AS n FROM sqlite_master WHERE type = \'table\' AND name = ?',
  ).get(STORE_REPLACED_TABLE)?.n === 1;
}

/**
 * The ids the store `db` holds replaced, each with the time it was
 * replaced, the earliest first and by id within one instant. Answers
 * none for a store without the table and for one with it empty, and
 * writes nothing either way.
 */
export function readReplacedStoreIds(db: Database): readonly ReplacedStoreId[] {
  if (!hasStoreReplacedTable(db)) return [];
  return db.query<ReplacedStoreIdColumns, []>(
    'SELECT store_id, replaced_at FROM store_replaced ORDER BY replaced_at, store_id',
  )
    .all()
    .map((row) => ({ storeId: row.store_id, replacedAt: row.replaced_at }));
}

/**
 * Records that the store `db` holds stopped carrying `storeId` at
 * `replacedAt`, written as an ISO string. An id the table already holds
 * keeps its first time and adds no row. Throws, writing nothing, when
 * the id is empty or the time is no valid date, and throws SQLite's own
 * error when the store has no `store_replaced` table. Begins no
 * transaction; see the module note.
 */
export function recordReplacedStoreId(db: Database, storeId: string, replacedAt: Date): void {
  if (storeId === '') throw new Error('replaced store id must be non-empty');
  if (Number.isNaN(replacedAt.getTime())) {
    throw new Error(`replaced time of store ${storeId} is not a valid date`);
  }
  db.query<unknown, [string, string]>(
    'INSERT INTO store_replaced (store_id, replaced_at) VALUES (?, ?) ON CONFLICT (store_id) DO NOTHING',
  ).run(storeId, replacedAt.toISOString());
}

/**
 * Removes every row of `store_replaced` from the store `db` holds and
 * keeps the table. Writes nothing to a store without the table, and
 * does not create it. Begins no transaction; see the module note.
 */
export function clearReplacedStoreIds(db: Database): void {
  if (!hasStoreReplacedTable(db)) return;
  db.run('DELETE FROM store_replaced');
}
