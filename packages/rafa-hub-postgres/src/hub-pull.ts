/**
 * The connector's pull: one project's rows past a cursor, the caller's
 * own left out, read in one snapshot and cut to a page when the request
 * names a `limit`.
 *
 * ## One snapshot
 *
 * Every table is read inside one `repeatable read`, `read only`
 * transaction, so the rows and the cursor answered are one moment of
 * the schema. A push assigns `seq` under its table's lock and commits
 * before the next push to that table reads its highest one, so no
 * snapshot sees a `seq` while a lower one is still to commit: a pull
 * past the cursor it was answered never skips a row.
 *
 * ## Rows and cursor
 *
 * Each row table of `schema.ts` is answered, in that order, with its
 * rows past the request's cursor for it (from the start when it names
 * none) whose `origin_store` is not the caller's, in `seq` order, each
 * carrying every column as pushed and `seq` the hub's own. A table
 * answered whole moves the cursor to the highest `seq` past the
 * request's, the caller's own rows included, so they are never read
 * again; one with no row past it keeps the request's, `0` when it named
 * none. The request's cursor for a table the schema does not hold is
 * answered as it came.
 *
 * ## Pages
 *
 * A `limit` caps the rows answered across every table, the caller's own
 * counting none, and is refused with a `RangeError` before the schema
 * is read when it is not a whole number above zero. The tables are
 * taken in order until the limit is spent. The table the page is cut in
 * moves the cursor to its last answered row's `seq`; a table past the
 * cut that holds a row the caller would be answered keeps the request's
 * cursor, so the next page starts there; one holding none is answered
 * whole. Each table reads at most one row more than the room left, so a
 * page reads no further than it answers.
 *
 * A pull naming the caller's `migrations` is answered whole: the store
 * answers `projection: false`, so the hub's route refuses a device
 * behind the schema before the store is asked.
 */
import type { HubTransaction } from './hub-tables.js';
import type { WireCursor, WireRow } from '@open-tomato/rafa/store';

import { and, asc, gt, max, sql } from 'drizzle-orm';

import { SEQ } from './hub-merge.js';
import { columnOf, wireRowOf } from './hub-tables.js';
import { WIRE_TABLES } from './schema.js';

/** What one pull reads: the caller, the cursor and the page's limit. */
export interface PullRead {
  /** The caller's store origin; its rows are left out. */
  readonly device: string;
  /** The cursor the caller passed. */
  readonly since: WireCursor;
  /** The most rows answered across every table; every row past the cursor when left out. */
  readonly limit?: number;
}

/** What one pull answers before the payload's frame: the rows per table and the cursor past them. */
export interface PulledRows {
  readonly tables: Readonly<Record<string, readonly WireRow[]>>;
  readonly cursor: WireCursor;
}

/** Refuses a pull `limit` that is not a whole number above zero; see the module note on pages. */
export function checkLimit(limit: number | undefined): void {
  if (limit === undefined || (Number.isInteger(limit) && limit > 0)) return;
  throw new RangeError(`rafa-hub: a pull limit of ${String(limit)} cannot be served; expected a whole number above zero`);
}

/** Reads one pull inside `tx`, whose `search_path` is the project's schema; see the module note. */
export async function readPulledRows(tx: HubTransaction, read: PullRead): Promise<PulledRows> {
  const tables: Record<string, readonly WireRow[]> = {};
  const cursor: Record<string, number> = { ...read.since };
  let room = read.limit;
  for (const [name, table] of Object.entries(WIRE_TABLES)) {
    const from = read.since[name] ?? 0;
    const seq = columnOf(table, SEQ);
    const past = gt(seq, from);
    const [top] = await tx
      .select({ highest: max(seq) })
      .from(table)
      .where(past);
    let query = tx
      .select()
      .from(table)
      .where(and(past, sql`${columnOf(table, 'origin_store')} IS DISTINCT FROM ${read.device}`))
      .orderBy(asc(seq))
      .$dynamic();
    if (room !== undefined) query = query.limit(room + 1);
    const rows = (await query).map((row) => wireRowOf(name, row));
    if (room === undefined || rows.length <= room) {
      tables[name] = Object.freeze(rows);
      cursor[name] = Number(top?.highest ?? from);
      if (room !== undefined) room -= rows.length;
      continue;
    }
    const kept = Object.freeze(rows.slice(0, room));
    tables[name] = kept;
    cursor[name] = Number(kept.at(-1)?.[SEQ] ?? from);
    room = 0;
  }
  return { tables: Object.freeze(tables), cursor: Object.freeze(cursor) };
}
