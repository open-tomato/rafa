/**
 * Reads every merged table straight off a store's own SQLite file and
 * compares its content across several stores, order-free and with no
 * row-count shortcut: what `two-devices.integration.test.ts` and
 * `hub-unreachable.integration.test.ts` both need once their devices and
 * the hub are supposed to hold the same rows.
 *
 * `schema_migrations`, `store_meta`, `merges` and `merge_conflicts` are
 * the store's own local bookkeeping (`context/effort-store.md`, "Tables
 * outside the port") and are set aside; every other table the merge
 * unions is compared. `commits.row_json`'s recomputed
 * `minutesSincePrevious` is set aside too, since a merge rewrites it
 * from whichever side ran last, exactly as
 * `store/merge-commit-gaps.ts`'s own comparison does. The local `seq`
 * column, which side holds a row and in what order, is set aside on
 * every table.
 */
import { Database } from 'bun:sqlite';
import { expect } from 'bun:test';

/** Every table the merge unions, past the store's own local bookkeeping; see the module note. */
export const LOCAL_ONLY_TABLES: ReadonlySet<string> = new Set(['schema_migrations', 'store_meta', 'merges', 'merge_conflicts']);

/** One row read off a store, by column. */
export type Row = Readonly<Record<string, unknown>>;

/** Every merged table's name on the store at `path`, sorted. */
export function mergedTableNames(path: string): string[] {
  const db = new Database(path, { readonly: true });
  try {
    return db.query<{ name: string }, []>('SELECT name FROM sqlite_master WHERE type = \'table\'')
      .all()
      .map((row) => row.name)
      .filter((name) => !LOCAL_ONLY_TABLES.has(name))
      .sort();
  } finally {
    db.close();
  }
}

/** Every row of `table` on the store at `path`, read-only. */
export function rowsOf(path: string, table: string): Row[] {
  const db = new Database(path, { readonly: true });
  try {
    return db.query<Row, []>(`SELECT * FROM "${table}"`).all();
  } finally {
    db.close();
  }
}

/** `rowJson`, its recomputed `minutesSincePrevious` set aside, as `store/merge-commit-gaps.ts`'s own comparison does. */
function withoutRecomputedGap(rowJson: string): string {
  const parsed = JSON.parse(rowJson) as Record<string, unknown>;
  const rest = Object.fromEntries(Object.entries(parsed).filter(([key]) => key !== 'minutesSincePrevious'));
  return JSON.stringify(rest);
}

/**
 * `row`'s content as one comparable string: the local `seq` (which side
 * holds it, and in what order) is set aside, and `commits.row_json`'s
 * recomputed gap along with it, since a merge rewrites it from whichever
 * side ran last.
 */
export function contentOf(table: string, row: Row): string {
  const entries = Object.entries(row)
    .filter(([column]) => column !== 'seq')
    .map(([column, value]): readonly [string, unknown] => (table === 'commits' && column === 'row_json' && typeof value === 'string'
      ? [column, withoutRecomputedGap(value)]
      : [column, value]));
  return JSON.stringify(entries.sort(([a], [b]) => a.localeCompare(b)));
}

/** Every row of `table` on the store at `path`, as content strings, sorted so two stores compare order-free. */
export function sortedContent(path: string, table: string): string[] {
  return rowsOf(path, table)
    .map((row) => contentOf(table, row))
    .sort();
}

/** Every merged table of every store at `paths` holds the same rows under the content comparison above. */
export function expectSameMergedTables(paths: readonly string[]): void {
  const [first, ...rest] = paths;
  if (first === undefined) throw new Error('expectSameMergedTables needs at least one path');
  for (const table of mergedTableNames(first)) {
    const base = sortedContent(first, table);
    for (const path of rest) expect(sortedContent(path, table)).toEqual(base);
  }
}
