/**
 * The origin pair every production insert stamps on the row it writes:
 * `origin_store`, the store id `store_meta` records, and `origin_seq`,
 * the row's own `seq`.
 *
 * ## One counter, not two
 *
 * `origin_seq` is the row's local `seq` at insert, never a second
 * counter. So a store that mints a new origin, being a copy, keeps
 * counting `seq` from the rows it holds, and its first row under the
 * new origin carries the next `seq` rather than 1. Two stores that
 * share rows then disagree on `origin_store` for everything written
 * after the copy, which is what keeps their pairs apart.
 *
 * Every stamped insert names `seq` itself, as `COALESCE(MAX(seq), 0) + 1`
 * over its own table, and writes that same value into `origin_seq`, so
 * the two cannot differ. SQLite would pick the same rowid for an
 * `INTEGER PRIMARY KEY` left out, but only while the largest rowid is
 * below 2^63 - 1: measured with Bun 1.4.2, a row inserted after one
 * at `9223372036854775807` got `4005337119280845049`, a random pick
 * no `MAX(seq)` read beforehand predicts. Both subqueries sit in the one
 * `INSERT` statement, which SQLite runs atomically under the write lock
 * it takes, so a row inserted by another process cannot land between
 * the reading of `MAX(seq)` and the insert. Nothing here reads a row
 * back or updates one after the insert.
 *
 * ## Where the origin comes from
 *
 * The insert reads `store_id` from `store_meta` (`id = 1`) in the same
 * statement. `withSqliteStore` settles the store's identity before any
 * writer runs (`store-meta.ts`), so on a `write` open the row holds the
 * origin this very file was minted for: the one recorded, kept, or the
 * one just minted for a copy. A store with no `store_meta` row, as one
 * under `tmpdir()` outside any repository with commits is left, stamps
 * NULL in both columns, as a runtime before `row-origins` does. It
 * never stamps a `seq` without a store: a pair is both or neither.
 *
 * ## No trigger, and no `UPDATE`
 *
 * A trigger filling the columns would break `writers` as
 * `classifyMigration` reads it, since an older runtime's insert would
 * fire it. A second statement updating the pair after the insert would
 * be a production `UPDATE … SET origin_store` that the merge's registry
 * would have to give a rule. The pair is therefore written by the
 * insert's own column list, which {@link STAMPED_COLUMNS} and
 * {@link stampedValues} spell for every writer alike.
 *
 * ## Readers
 *
 * No reader filters on either column, so a row an older runtime
 * inserts, NULL in both, is read as every stamped row is. The partial
 * unique index `<table>_by_origin` covers only rows whose
 * `origin_store` is not NULL, so any number of such rows coexist.
 *
 * A reader that answers rows in order and may run over a merged store
 * sorts by {@link ACROSS_STORES_ORDER}, which names both columns. `seq`
 * alone cannot be that order: a merge inserts the other store's rows
 * under new local `seq` values after its own, so the two sides of one
 * merge would read the same rows in two orders.
 */

/**
 * The twelve tables a merge unions, each carrying `origin_store` and
 * `origin_seq` since migration `row-origins`. Every production insert
 * into one of them is stamped; `schema_migrations`, `store_meta`,
 * `merges` and `merge_conflicts` are the store's own bookkeeping and
 * carry no origin.
 */
export const ORIGIN_TABLES = [
  'sessions',
  'commits',
  'findings',
  'blockers',
  'out_of_scope_bugs',
  'report_absences',
  'task_reports',
  'preflight',
  'dispatches',
  'changes',
  'skill_invocations',
  'plan_ci',
] as const;

/** One of the {@link ORIGIN_TABLES}. */
export type OriginTable = typeof ORIGIN_TABLES[number];

/**
 * The `ORDER BY` terms of a reader that answers the rows of a table
 * with `collected_at` in the same order on every store holding them:
 * the write's time first, then the origin pair, then the local `seq`.
 *
 *   - `collected_at` orders rows written at different times, whichever
 *     store wrote them and whichever side ran a merge.
 *   - The origin pair breaks a tie. One write stamps every row it
 *     inserts with one time, and `origin_seq` is the `seq` each row got
 *     in the store that wrote it, so one device's rows of one write keep
 *     the order that device appended them in, on any store, and two
 *     devices' rows at one time are ordered by their `origin_store`.
 *   - `seq` breaks what remains: rows with a NULL origin, which SQLite
 *     sorts before every origin. Among those at one time the order is
 *     the store's own append order, which is not the same on both sides
 *     of a merge.
 *
 * A clock that goes backwards reorders rows here; the append order no
 * longer wins over the stamp.
 */
export const ACROSS_STORES_ORDER = 'collected_at, origin_store, origin_seq, seq';

/**
 * The columns a stamped insert names after its own, in the order
 * {@link stampedValues} answers their values.
 */
export const STAMPED_COLUMNS = 'seq, origin_store, origin_seq';

/** The store id the store's identity row records, or NULL when it has none. */
const STORE_ID = '(SELECT store_id FROM store_meta WHERE id = 1)';

/**
 * The SQL values of {@link STAMPED_COLUMNS} for an insert into `table`:
 * the next `seq`, the store's origin, and that `seq` again as
 * `origin_seq` when the store has an origin, NULL beside a NULL origin.
 *
 * `table` is interpolated into the SQL, which is safe because the type
 * admits only the names in {@link ORIGIN_TABLES}.
 */
export function stampedValues(table: OriginTable): string {
  const nextSeq = `(SELECT COALESCE(MAX(seq), 0) + 1 FROM ${table})`;
  return `${nextSeq}, ${STORE_ID}, CASE WHEN ${STORE_ID} IS NULL THEN NULL ELSE ${nextSeq} END`;
}
