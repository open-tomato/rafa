/**
 * The union at the heart of a merge: every row of each `merged` table in
 * another store that matches no row here is inserted here, so the two
 * stores' rows end up in this one, one copy of each.
 *
 * ## Matching
 *
 * An incoming row is looked up here in two steps, and the first to find
 * a row wins:
 *
 * 1. **The origin pair.** An incoming row whose `origin_store` and
 *    `origin_seq` are both set matches the row here holding the same
 *    pair. The pair is unique wherever it is set (`<table>_by_origin`),
 *    so at most one row answers.
 * 2. **Identity.** Otherwise the row matches the row here holding the
 *    same values in the table's identity columns from `MERGE_RULES`
 *    (`merge-rules.ts`): `session_id` for sessions and dispatches, `sha`
 *    for commits, `id` for the UUID tables, `(pr, head_sha, read_at)`
 *    for `plan_ci`. Two NULLs count as equal, as `IS` compares them.
 *
 * Step 2 is what a row with a NULL origin, on either side, is matched
 * by. It also runs when both rows carry a pair and the pairs differ,
 * because every identity is a UNIQUE key of its table: a commit two
 * devices collected from one pushed history holds one sha under two
 * origins, and the table could not hold both. Such a match, and one on
 * a pair whose two rows differ, is what the merge's conflict step reads
 * the {@link UnionMatch} list for; the union itself compares no content.
 *
 * ## Inserting
 *
 * An unmatched row is inserted with a new local `seq`, named in the
 * insert as `COALESCE(MAX(seq), 0) + 1` for the reason `origins.ts`
 * gives, and every other column as the other store holds it: its origin
 * pair unchanged, NULL staying NULL. Rows go in in the other store's
 * `seq` order, and each lookup reads the rows inserted before it, so two
 * rows of one identity in the other store land as one.
 *
 * An unmatched row can still collide with a row here on one of the
 * table's other UNIQUE keys, such as `findings_by_artifact`, when one
 * report was stored under two UUIDs. Nothing in `MERGE_RULES` says which
 * row that is, so the row is not inserted and is returned as a
 * {@link UnionCollision}; the union goes on with the next row.
 *
 * ## What it refuses
 *
 * Both stores must hold the same columns in every merged table, which
 * the merge sees to by bringing both to the same migrations first. A
 * column one side lacks would be dropped from every row copied or read
 * as NULL, so the union checks every table before it inserts anything
 * and throws {@link UnionSchemaMismatch} naming the columns. The inserts
 * run in one transaction on `local`; `other` is only read.
 */
import type { Database, SQLQueryBindings } from 'bun:sqlite';

import { SQLiteError } from 'bun:sqlite';

import { MERGE_RULES } from './merge-rules.js';
import { quoted } from './rebuild-aside.js';

/** Which of the two lookups found an incoming row's match. */
export type MatchedBy = 'origin' | 'identity';

/** An incoming row that matched a row already here, which the union left alone. */
export interface UnionMatch {
  /** The local row's `seq`. */
  readonly localSeq: number;
  /** The incoming row's `seq` in the other store. */
  readonly incomingSeq: number;
  readonly by: MatchedBy;
}

/** An unmatched incoming row the table refused on another of its UNIQUE keys. */
export interface UnionCollision {
  /** The incoming row's `seq` in the other store. */
  readonly incomingSeq: number;
  /** SQLite's own message, naming the key. */
  readonly reason: string;
}

/** What the union did with one merged table. */
export interface TableUnion {
  readonly table: string;
  /** The local `seq` of each row inserted, in insert order. */
  readonly added: readonly number[];
  readonly matched: readonly UnionMatch[];
  readonly collided: readonly UnionCollision[];
}

/** The two stores disagree on the columns of a merged table. */
export class UnionSchemaMismatch extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'UnionSchemaMismatch';
  }
}

/** One row as a store holds it, by column name. */
type StoredRow = Readonly<Record<string, SQLQueryBindings>>;

/** What happened to one incoming row. */
type RowOutcome =
  | { readonly kind: 'added'; readonly localSeq: number }
  | { readonly kind: 'matched'; readonly match: UnionMatch }
  | { readonly kind: 'collided'; readonly collision: UnionCollision };

/** A merged table's name, with the columns its rows are matched by. */
interface MergedTable {
  readonly table: string;
  readonly identity: readonly string[];
}

/** The SQLite error code of a UNIQUE key's refusal. */
const UNIQUE_REFUSAL = 'SQLITE_CONSTRAINT_UNIQUE';

/** Every table `MERGE_RULES` merges, in registry order. */
function mergedTables(): MergedTable[] {
  return Object.entries(MERGE_RULES).flatMap(([table, rule]) => rule.scope === 'merged'
    ? [{ table, identity: rule.identity }]
    : []);
}

/** The columns of `table` other than `seq`, in table order. */
function carriedColumns(db: Database, table: string): string[] {
  return db
    .query<{ name: string }, []>(`PRAGMA table_info(${quoted(table)})`)
    .all()
    .map(({ name }) => name)
    .filter((name) => name !== 'seq');
}

/** Throws unless both stores hold the same columns in every merged table. */
function refuseColumnMismatch(local: Database, other: Database, tables: readonly MergedTable[]): void {
  const faults = tables.flatMap(({ table }) => {
    const here = new Set(carriedColumns(local, table));
    const there = new Set(carriedColumns(other, table));
    const onlyHere = [...here].filter((column) => !there.has(column)).map((column) => `${table}.${column} only here`);
    const onlyThere = [...there].filter((column) => !here.has(column)).map((column) => `${table}.${column} only there`);
    return [...onlyHere, ...onlyThere];
  });
  if (faults.length > 0) {
    throw new UnionSchemaMismatch(
      `the two stores hold different columns (${faults.join(', ')}); bring both to the same migrations first`,
    );
  }
}

/** The value `row` holds in `column`, NULL when it holds none. */
function valueOf(row: StoredRow, column: string): SQLQueryBindings {
  return row[column] ?? null;
}

/** The local `seq` of the row holding `row`'s origin pair, or null when `row` has none or nothing here holds it. */
function byOrigin(local: Database, table: string, row: StoredRow): number | null {
  const store = valueOf(row, 'origin_store');
  const seq = valueOf(row, 'origin_seq');
  if (store === null || seq === null) return null;
  return local
    .query<{ seq: number }, [SQLQueryBindings, SQLQueryBindings]>(
      `SELECT seq FROM ${quoted(table)} WHERE origin_store = ? AND origin_seq = ?`,
    )
    .get(store, seq)?.seq ?? null;
}

/** The local `seq` of the first row holding `row`'s identity, or null when none does. */
function byIdentity(local: Database, { table, identity }: MergedTable, row: StoredRow): number | null {
  const where = identity.map((column) => `${quoted(column)} IS ?`).join(' AND ');
  return local
    .query<{ seq: number }, SQLQueryBindings[]>(`SELECT seq FROM ${quoted(table)} WHERE ${where} ORDER BY seq LIMIT 1`)
    .get(...identity.map((column) => valueOf(row, column)))?.seq ?? null;
}

/** Inserts `row` under a new local `seq`, answering that `seq`, or the collision a UNIQUE key refused it on. */
function insertRow(local: Database, table: string, columns: readonly string[], row: StoredRow, incomingSeq: number): RowOutcome {
  const columnList = columns.map(quoted).join(', ');
  const placeholders = columns.map(() => '?').join(', ');
  const nextSeq = `(SELECT COALESCE(MAX(seq), 0) + 1 FROM ${quoted(table)})`;
  try {
    const inserted = local
      .query<{ seq: number }, SQLQueryBindings[]>(
        `INSERT INTO ${quoted(table)} (seq, ${columnList}) VALUES (${nextSeq}, ${placeholders}) RETURNING seq`,
      )
      .get(...columns.map((column) => valueOf(row, column)));
    if (inserted === null) throw new Error(`the insert into ${table} returned no seq`);
    return { kind: 'added', localSeq: inserted.seq };
  } catch (error) {
    if (!(error instanceof SQLiteError) || error.code !== UNIQUE_REFUSAL) throw error;
    return { kind: 'collided', collision: { incomingSeq, reason: error.message } };
  }
}

/** Matches one incoming row here, or inserts it. */
function placeRow(local: Database, merged: MergedTable, columns: readonly string[], row: StoredRow): RowOutcome {
  const incomingSeq = Number(valueOf(row, 'seq'));
  const origin = byOrigin(local, merged.table, row);
  if (origin !== null) return { kind: 'matched', match: { localSeq: origin, incomingSeq, by: 'origin' } };
  const identity = byIdentity(local, merged, row);
  if (identity !== null) return { kind: 'matched', match: { localSeq: identity, incomingSeq, by: 'identity' } };
  return insertRow(local, merged.table, columns, row, incomingSeq);
}

/** Unions one merged table of `other` into `local`. */
function unionTable(local: Database, other: Database, merged: MergedTable): TableUnion {
  const columns = carriedColumns(local, merged.table);
  const incoming = other
    .query<StoredRow, []>(`SELECT seq, ${columns.map(quoted).join(', ')} FROM ${quoted(merged.table)} ORDER BY seq`)
    .all();
  const outcomes = incoming.map((row) => placeRow(local, merged, columns, row));
  return {
    table: merged.table,
    added: outcomes.flatMap((outcome) => outcome.kind === 'added'
      ? [outcome.localSeq]
      : []),
    matched: outcomes.flatMap((outcome) => outcome.kind === 'matched'
      ? [outcome.match]
      : []),
    collided: outcomes.flatMap((outcome) => outcome.kind === 'collided'
      ? [outcome.collision]
      : []),
  };
}

/**
 * Inserts into `local` every row of each merged table of `other` that
 * matches no row of `local`, as the module note says, and answers what
 * it did with each table, in `MERGE_RULES` order. Throws
 * {@link UnionSchemaMismatch}, having inserted nothing, when the two
 * stores hold different columns in any merged table.
 */
export function unionStores(local: Database, other: Database): TableUnion[] {
  const tables = mergedTables();
  refuseColumnMismatch(local, other, tables);
  return local.transaction(() => tables.map((merged) => unionTable(local, other, merged)))();
}
