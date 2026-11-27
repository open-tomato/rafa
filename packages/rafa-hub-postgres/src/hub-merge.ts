/**
 * How a push merges one table's rows into a project's schema, decided
 * without the database: which rows of the payload are new, and the hub
 * `seq` each new one takes. `hub-store.ts` reads what the schema holds,
 * hands it here, and inserts what this answers.
 *
 * ## By origin pair
 *
 * A row whose `origin_store` and `origin_seq` are both set is the row of
 * that pair, whoever pushed it: one the schema already holds adds
 * nothing, and the payload's second copy of a pair adds nothing beyond
 * the first. So a repeated push, an overlapping one and one relaying a
 * row another device pushed first leave the schema as it was.
 *
 * ## A row with no origin
 *
 * A row an older device wrote carries no origin pair. A device's own
 * merge matches such a row by its table's identity columns, but core's
 * store entry does not export that registry, so the hub matches it by
 * every column but `seq`: the same row pushed twice adds nothing, and
 * two rows that differ in any column are both kept.
 *
 * ## What it does not do
 *
 * A device's merge also fills a set-once field held NULL from the other
 * store and recomputes a commit's `minutesSincePrevious`; the hub keeps
 * each row as its first push carried it. A row's columns are checked
 * against the table by {@link unknownColumns} before anything is
 * merged; a column the row leaves out, as a device behind the hub's
 * schema leaves out a column it lacks, is held as NULL.
 */
import type { WireRow, WireValue } from '@open-tomato/rafa/store';

/** The column every row table opens with: the hub's own `seq`, the cursor a pull answers. */
export const SEQ = 'seq';

/** What a project's table holds of the rows a payload carries. */
export interface HeldRows {
  /** The origin pairs held, each as {@link pairKey} spells it. */
  readonly pairs: ReadonlySet<string>;
  /** The rows held with no origin pair, each as {@link contentKey} spells it. */
  readonly contents: ReadonlySet<string>;
}

/** A row's origin pair as one string, or `null` when either half is unset. */
export function pairKey(row: WireRow): string | null {
  const store = row['origin_store'] ?? null;
  const seq = row['origin_seq'] ?? null;
  if (store === null || seq === null) return null;
  return `${String(store)}:${String(seq)}`;
}

/** A row's every column but `seq`, in `columns` order, as one string. */
export function contentKey(row: WireRow, columns: readonly string[]): string {
  return JSON.stringify(columns.filter((column) => column !== SEQ).map((column) => row[column] ?? null));
}

/** The columns `rows` carry that `columns` does not, sorted; empty when each row fits the table. */
export function unknownColumns(rows: readonly WireRow[], columns: readonly string[]): string[] {
  const known = new Set(columns);
  return [...new Set(rows.flatMap((row) => Object.keys(row)))].filter((column) => !known.has(column)).sort();
}

/**
 * The rows of `incoming` new to a table holding `held`, in payload
 * order, each holding every one of `columns` (a column left out as
 * NULL) and `seq` from `firstSeq` up, one apart. See the module note.
 */
export function mergeByOrigin(
  incoming: readonly WireRow[],
  held: HeldRows,
  columns: readonly string[],
  firstSeq: number,
): WireRow[] {
  const pairs = new Set(held.pairs);
  const contents = new Set(held.contents);
  const fresh = incoming.filter((row) => {
    const pair = pairKey(row);
    const key = pair ?? contentKey(row, columns);
    const seen = pair === null
      ? contents
      : pairs;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  return fresh.map((row, index) => Object.freeze(Object.fromEntries(columns.map((column): [string, WireValue] => [
    column,
    column === SEQ
      ? firstSeq + index
      : row[column] ?? null,
  ]))));
}
