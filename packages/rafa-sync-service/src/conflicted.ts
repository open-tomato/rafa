/**
 * Leaving the conflicted rows out of a push payload.
 *
 * A conflicted row is a local row `merge_conflicts` names by its
 * `table_name` and `local_seq`, whichever merge recorded it: a hub pull
 * or `rafa effort merge`. Core's `readConflictedRows` reads them from a
 * store file as a map from each table name to its set of `seq` values.
 * They are not the rows `held_rows` lists, which a projected pull
 * brought in cut short; nothing here reads those.
 *
 * {@link withoutConflicted} takes a payload past the push cursor and
 * answers it without each row whose `(table, seq)` the map names, with
 * the count it dropped. Everything else the payload holds stays as it
 * was: its `format`, `version` and `migrations`, its `cursor`, so a
 * push that writes it still moves past a dropped row and does not
 * resend it, and its `projected` and `projectedColumns` fields when
 * present. A table keeps its key with the rows left, none if each was
 * dropped. A table the map names and the payload lacks drops nothing.
 */
import type { WirePayload, WireRow } from '@open-tomato/rafa/store';

/**
 * The conflicted rows by table: each table name with the set of the
 * `local_seq` values `merge_conflicts` names under it, the shape core's
 * `readConflictedRows` answers.
 */
export type ConflictedRowsByTable = ReadonlyMap<string, ReadonlySet<number>>;

/** What {@link withoutConflicted} answers. */
export interface WithoutConflicted {
  /** The payload with every conflicted row left out; see the module note. */
  readonly payload: WirePayload;
  /** How many rows were left out, across every table. */
  readonly dropped: number;
}

/**
 * Answers `payload` without each row whose table and `seq` the
 * `conflicted` map names, and the count dropped; see the module note.
 * A map naming no row of the payload answers the payload itself with
 * `dropped: 0`. Neither argument is changed.
 */
export function withoutConflicted(payload: WirePayload, conflicted: ConflictedRowsByTable): WithoutConflicted {
  let dropped = 0;
  const tables = Object.entries(payload.tables).map(([table, rows]): [string, readonly WireRow[]] => {
    const seqs = conflicted.get(table);
    if (seqs === undefined || seqs.size === 0) return [table, rows];
    const kept = rows.filter((row) => !seqs.has(Number(row.seq)));
    dropped += rows.length - kept.length;
    return kept.length === rows.length
      ? [table, rows]
      : [table, Object.freeze(kept)];
  });
  if (dropped === 0) return Object.freeze({ payload, dropped });
  return Object.freeze({
    payload: Object.freeze({ ...payload, tables: Object.freeze(Object.fromEntries(tables)) }),
    dropped,
  });
}
