/**
 * The merge's second step: each pair of rows the union matched
 * (`merge-union.ts`) is compared, an edited field the two stores
 * disagree on is settled by its rule, and any difference no rule settles
 * is recorded in `merge_conflicts`, both rows kept.
 *
 * ## Comparing a pair
 *
 * The two rows are compared on every column but `seq` and the origin
 * pair. `seq` is local order, and the pair may differ in a match on
 * identity by design: a row with a NULL origin on one side, or a commit
 * two devices collected under an origin each, is the same row.
 *
 * - **Equal** content: nothing is written, and the pair is skipped.
 * - **Differing only in edited fields** (`MERGE_RULES`, `merge-rules.ts`):
 *   each field follows its rule. Under {@link SET_ONCE} a filled value
 *   beats NULL from either side: NULL here takes the other store's value,
 *   and a value here is kept against NULL there; the pair is then
 *   skipped. Two different filled values mean one finding was filed
 *   twice: the value here is kept, and the incoming row is recorded with
 *   `field` naming the column. Under {@link RECOMPUTED} the two values
 *   are compared without the part the merge recomputes, through the
 *   field's entry in {@link RECOMPUTED_COMPARISONS}: `commits.row_json`
 *   without its `minutesSincePrevious` (`merge-commit-gaps.ts`), and
 *   `sessions.row_json` with its `filePath` passed through
 *   `storedLogPathOf` (`session-log-path.ts`), so an old row's absolute
 *   path and a fresh row's `<folder>/<file>` compare alike. Equal so, the
 *   pair is skipped and the row here kept: the gap of a commit brought in
 *   is the merge's to rewrite, not a matched one's, and a session's path
 *   is answered in its stored form by `read` whichever form the row here
 *   holds. Unequal, the rows differ outside every edited field, below.
 * - **Any other difference**: the incoming row is recorded with `field`
 *   NULL, and the row here is left as it is, edited fields included. The
 *   same `(origin_store, origin_seq)` holding different content can only
 *   come from a copy the open did not catch, such as a cloned disk, and
 *   one UUID holding different content is as unexplained.
 *
 * A recorded conflict keeps the incoming row as the JSON of all its
 * columns, its `seq` in the other store and its origin pair included,
 * beside the local row's `seq`. Nothing blocks on it: the next pair is
 * compared. A merge run again meets the same pair and records it again
 * under its own merge id.
 *
 * ## The fill statements
 *
 * A fill is an `UPDATE` of a merged table, which `merge-rules.sweep.test.ts`
 * reads from source and holds to `MERGE_RULES`; it can only read a
 * statement whose table and column are spelled out. So each set-once
 * field has its statement in {@link SET_ONCE_FILLS}, and a set-once
 * field `MERGE_RULES` gains without one there makes the settling throw.
 *
 * The union's collisions, rows it refused on another UNIQUE key, are
 * not matches and are not read here.
 *
 * ## A held copy
 *
 * A row a projected pull brought in is listed in `held_rows` by its
 * table and origin pair (`merge-store.ts`): it lacks the columns of the
 * migrations its listing names, so it is a truncated copy of a row, not
 * a settled one. Before the comparison, {@link takeHeldCopies} reads
 * each pair whose row here is listed. It rewrites that row from the
 * incoming one, every column taken whole and no column rule consulted,
 * except three kept from the row here: its `seq`, its origin pair, and
 * each {@link SET_ONCE} field, today `findings.tracker_ref`. The listing
 * is then dropped, and the pair goes on to the comparison above, which
 * now finds the two rows equal, or differing only in a set-once field,
 * and settles that field by its rule (`settleSetOnce`): a value here,
 * written while the row was held, is kept against NULL there, and NULL
 * here takes the value there. So a held copy records no
 * `merge_conflicts` row for what its truncation left out; only two
 * different filled values of a set-once field, one finding filed twice,
 * are recorded, as for any pair. A pair whose row here is not listed is
 * compared as it always was, and so is every pair of a table the
 * caller names as cut: under a projected merge the incoming rows of a
 * projected table lack columns too, so none of them is a full row, and
 * the listing step (`merge-store.ts`) keeps the row listed, its
 * `missing` the ids of both lists.
 *
 * The rewrite deletes the row here and inserts the incoming one under
 * the same `seq`, since a statement whose table and columns are read
 * from the store is one `merge-rules.sweep.test.ts` cannot read. When
 * the incoming row collides with another row here on a UNIQUE key, the
 * rewrite is rolled back: the row here stays as it was and listed, and
 * the pair is compared as any other, a difference outside every edited
 * field recorded as a conflict.
 */
import type { TableUnion, UnionMatch } from './merge-union.js';
import type { Database, SQLQueryBindings } from 'bun:sqlite';

import { SQLiteError } from 'bun:sqlite';

import { storedLogPathOf } from '../session-log-path.js';

import { withoutGap } from './merge-commit-gaps.js';
import { MERGE_RULES, RECOMPUTED, SET_ONCE } from './merge-rules.js';
import { carriedColumns } from './merge-union.js';
import { quoted } from './rebuild-aside.js';

/** The merge these conflicts are recorded under. */
export interface ConflictTrail {
  /** The `merges.id` of the merge. */
  readonly mergeId: string;
  /** When the conflicts are recorded, as an ISO timestamp. */
  readonly recordedAt: string;
}

/** An edited field this store took from the other store. */
export interface FieldFill {
  readonly localSeq: number;
  readonly field: string;
}

/** A pair recorded in `merge_conflicts`. */
export interface RecordedConflict {
  readonly localSeq: number;
  /** The incoming row's `seq` in the other store. */
  readonly incomingSeq: number;
  /** The edited field whose two values differ, or null when the rows differ outside every edited field. */
  readonly field: string | null;
}

/** What the conflict step did with one merged table's matched pairs. */
export interface TableSettlement {
  readonly table: string;
  /** The local `seq` of each pair left with equal content, before or after its fills. */
  readonly skipped: readonly number[];
  readonly filled: readonly FieldFill[];
  readonly conflicts: readonly RecordedConflict[];
}

/** The statement filling one set-once field of a row left NULL, by `<table>.<column>`. */
export const SET_ONCE_FILLS: Readonly<Record<string, string>> = {
  'findings.tracker_ref': 'UPDATE findings SET tracker_ref = ? WHERE seq = ? AND tracker_ref IS NULL',
};

/** The key of `sessions.row_json` that holds the log's path, in one of two forms. */
const LOG_PATH_FIELD = 'filePath';

/**
 * A session's `row_json` with its `filePath` in the stored form, the
 * other keys and their order kept, or the text unchanged when it is not
 * a JSON object or holds no `filePath`.
 */
function withStoredLogPath(rowJson: string): string {
  let row: unknown;
  try {
    row = JSON.parse(rowJson);
  } catch {
    return rowJson;
  }
  if (typeof row !== 'object' || row === null || Array.isArray(row) || !Object.hasOwn(row, LOG_PATH_FIELD)) return rowJson;
  const entries = Object.entries(row).map(([key, value]: [string, unknown]) => key === LOG_PATH_FIELD
    ? [key, storedLogPathOf(value)]
    : [key, value]);
  return JSON.stringify(Object.fromEntries(entries));
}

/** The comparable form of one recomputed field's value, by `<table>.<column>`. */
export const RECOMPUTED_COMPARISONS: Readonly<Record<string, (value: string) => string>> = {
  'sessions.row_json': withStoredLogPath,
  'commits.row_json': withoutGap,
};

/** Columns a pair's content is compared without. */
const NOT_CONTENT = new Set(['seq', 'origin_store', 'origin_seq']);

/** One row as a store holds it, by column name. */
type StoredRow = Readonly<Record<string, SQLQueryBindings>>;

/** What settling one pair came to. */
interface PairOutcome {
  readonly skipped: boolean;
  readonly filled: readonly string[];
  readonly conflictFields: readonly (string | null)[];
}

const INSERT_CONFLICT = `INSERT INTO merge_conflicts (merge_id, table_name, local_seq, field, incoming, recorded_at)
  VALUES (?, ?, ?, ?, ?, ?)`;

/** The row of `table` at `seq`, every column, or a throw naming which store lacks it. */
function rowAt(db: Database, table: string, columns: readonly string[], seq: number, side: string): StoredRow {
  const row = db
    .query<StoredRow, [number]>(`SELECT seq, ${columns.map(quoted).join(', ')} FROM ${quoted(table)} WHERE seq = ?`)
    .get(seq);
  if (row === null) throw new Error(`the union matched ${table} row ${seq} ${side}, which that store does not hold`);
  return row;
}

/** Whether two stored values are the same. */
function sameValue(left: SQLQueryBindings | undefined, right: SQLQueryBindings | undefined): boolean {
  if (left instanceof Uint8Array && right instanceof Uint8Array) return Buffer.from(left).equals(right);
  return (left ?? null) === (right ?? null);
}

/** The statement filling `table.field`, or a throw when `SET_ONCE_FILLS` lacks it. */
function fillStatement(table: string, field: string): string {
  const statement = SET_ONCE_FILLS[`${table}.${field}`];
  if (statement === undefined) {
    throw new Error(`${table}.${field} is set-once in MERGE_RULES and has no statement in SET_ONCE_FILLS`);
  }
  return statement;
}

/** Settles one set-once field the two rows disagree on: a fill, nothing, or a conflict. */
function settleSetOnce(local: Database, table: string, field: string, here: StoredRow, there: StoredRow): PairOutcome {
  const incoming = there[field] ?? null;
  if (incoming === null) return { skipped: true, filled: [], conflictFields: [] };
  if ((here[field] ?? null) !== null) return { skipped: false, filled: [], conflictFields: [field] };
  local.query<unknown, [SQLQueryBindings, number]>(fillStatement(table, field)).run(incoming, Number(here.seq));
  return { skipped: true, filled: [field], conflictFields: [] };
}

/** Settles one recomputed field the two rows disagree on: nothing, or a conflict outside every edited field. */
function settleRecomputed(table: string, field: string, here: StoredRow, there: StoredRow): PairOutcome {
  const comparable = RECOMPUTED_COMPARISONS[`${table}.${field}`];
  if (comparable === undefined) {
    throw new Error(`${table}.${field} is recomputed in MERGE_RULES and has no entry in RECOMPUTED_COMPARISONS`);
  }
  const hereValue = here[field];
  const thereValue = there[field];
  const same = typeof hereValue === 'string' && typeof thereValue === 'string'
    && comparable(hereValue) === comparable(thereValue);
  return same
    ? { skipped: true, filled: [], conflictFields: [] }
    : { skipped: false, filled: [], conflictFields: [null] };
}

/** Compares one matched pair and settles it as the module note says. */
function settlePair(
  local: Database,
  table: string,
  edited: Readonly<Record<string, string>>,
  here: StoredRow,
  there: StoredRow,
): PairOutcome {
  const differing = Object.keys(here).filter((column) => !NOT_CONTENT.has(column) && !sameValue(here[column], there[column]));
  if (differing.length === 0) return { skipped: true, filled: [], conflictFields: [] };
  if (differing.some((column) => !Object.hasOwn(edited, column))) return { skipped: false, filled: [], conflictFields: [null] };
  const outcomes = differing.map((field) => {
    if (edited[field] === SET_ONCE) return settleSetOnce(local, table, field, here, there);
    if (edited[field] === RECOMPUTED) return settleRecomputed(table, field, here, there);
    throw new Error(`${table}.${field} has the rule ${edited[field]}, which the merge does not apply`);
  });
  return {
    skipped: outcomes.every((outcome) => outcome.skipped),
    filled: outcomes.flatMap((outcome) => outcome.filled),
    conflictFields: outcomes.flatMap((outcome) => outcome.conflictFields),
  };
}

/** Settles every matched pair of one table, recording its conflicts under `trail`. */
function settleTable(local: Database, other: Database, union: TableUnion, trail: ConflictTrail): TableSettlement {
  const rule = MERGE_RULES[union.table];
  if (rule?.scope !== 'merged') throw new Error(`${union.table} is not a merged table in MERGE_RULES`);
  const columns = carriedColumns(local, union.table);
  const settled = union.matched.map((match: UnionMatch) => {
    const here = rowAt(local, union.table, columns, match.localSeq, 'here');
    const there = rowAt(other, union.table, columns, match.incomingSeq, 'in the other store');
    const outcome = settlePair(local, union.table, rule.edited, here, there);
    const conflicts = outcome.conflictFields.map((field) => {
      local
        .query<unknown, SQLQueryBindings[]>(INSERT_CONFLICT)
        .run(trail.mergeId, union.table, match.localSeq, field, JSON.stringify(there), trail.recordedAt);
      return { localSeq: match.localSeq, incomingSeq: match.incomingSeq, field };
    });
    return { match, outcome, conflicts };
  });
  return {
    table: union.table,
    skipped: settled.flatMap(({ match, outcome }) => outcome.skipped
      ? [match.localSeq]
      : []),
    filled: settled.flatMap(({ match, outcome }) => outcome.filled.map((field) => ({ localSeq: match.localSeq, field }))),
    conflicts: settled.flatMap(({ conflicts }) => conflicts),
  };
}

/**
 * Settles every pair `unions` matched, as the module note says: fills
 * the set-once fields `local` holds NULL in, and records each conflict
 * in `local`'s `merge_conflicts` under `trail`, in one transaction.
 * `other` is only read. Answers one entry per union entry, in its order.
 */
export function settleMatches(
  local: Database,
  other: Database,
  unions: readonly TableUnion[],
  trail: ConflictTrail,
): TableSettlement[] {
  return local.transaction(() => unions.map((union) => settleTable(local, other, union, trail)))();
}

/** What the held-copy step did with one merged table's matched pairs. */
export interface HeldCopy {
  readonly table: string;
  /** The local `seq` of each listed row rewritten from the incoming row, its listing dropped. */
  readonly taken: readonly number[];
  /** The local `seq` of each listed row the incoming row collided on another UNIQUE key, left as it was and listed. */
  readonly refused: readonly number[];
}

/** The local table naming each row a projected pull brought in truncated. */
const HELD_TABLE = 'held_rows';

const HELD_LISTING = 'SELECT count(*) AS n FROM held_rows WHERE table_name = ? AND origin_store = ? AND origin_seq = ?';

const DROP_LISTING = 'DELETE FROM held_rows WHERE table_name = ? AND origin_store = ? AND origin_seq = ?';

/** The columns a held copy keeps from the row here besides `seq`: the origin pair. */
const KEPT_ORIGIN = ['origin_store', 'origin_seq'];

/** Whether the store open on `db` holds a listing in `held_rows`; false for a schema before the table. */
function holdsListings(db: Database): boolean {
  const table = db
    .query<{ n: number }, [string]>('SELECT count(*) AS n FROM sqlite_master WHERE type = \'table\' AND name = ?')
    .get(HELD_TABLE);
  if (table?.n !== 1) return false;
  return (db.query<{ n: number }, []>('SELECT count(*) AS n FROM held_rows').get()?.n ?? 0) > 0;
}

/** Whether `row`, a row of `table` here, is listed in `held_rows` by its origin pair. */
function isListed(db: Database, table: string, row: StoredRow): boolean {
  const { origin_store: store, origin_seq: seq } = row;
  if (typeof store !== 'string' || typeof seq !== 'number') return false;
  return (db.query<{ n: number }, [string, string, number]>(HELD_LISTING).get(table, store, seq)?.n ?? 0) > 0;
}

/** Whether `error` is SQLite refusing a row on a constraint. */
function isConstraintRefusal(error: unknown): boolean {
  return error instanceof SQLiteError && (error.code ?? '').startsWith('SQLITE_CONSTRAINT');
}

/**
 * Rewrites the listed row `here` from `there` and drops its listing, in
 * one savepoint, as the module note says; answers false, with nothing
 * written, when the incoming row collides on another UNIQUE key.
 */
function rewriteHeld(
  local: Database,
  table: string,
  columns: readonly string[],
  kept: ReadonlySet<string>,
  here: StoredRow,
  there: StoredRow,
): boolean {
  const values = columns.map((column) => (kept.has(column)
    ? here[column]
    : there[column]) ?? null);
  const placeholders = columns.map(() => '?').join(', ');
  try {
    local.transaction(() => {
      local.query<unknown, [number]>(`DELETE FROM ${quoted(table)} WHERE seq = ?`).run(Number(here.seq));
      local
        .query<unknown, SQLQueryBindings[]>(`INSERT INTO ${quoted(table)} (seq, ${columns.map(quoted).join(', ')}) VALUES (?, ${placeholders})`)
        .run(Number(here.seq), ...values);
      local.query<unknown, SQLQueryBindings[]>(DROP_LISTING).run(table, here.origin_store ?? null, here.origin_seq ?? null);
    })();
    return true;
  } catch (error) {
    if (isConstraintRefusal(error)) return false;
    throw error;
  }
}

/** Takes the held copies among one table's matched pairs. */
function takeTableCopies(local: Database, other: Database, union: TableUnion): HeldCopy {
  const rule = MERGE_RULES[union.table];
  if (rule?.scope !== 'merged') throw new Error(`${union.table} is not a merged table in MERGE_RULES`);
  const columns = carriedColumns(local, union.table);
  const setOnce = Object.keys(rule.edited).filter((field) => rule.edited[field] === SET_ONCE);
  const kept = new Set([...KEPT_ORIGIN, ...setOnce]);
  const outcomes = union.matched.flatMap((match: UnionMatch) => {
    const here = rowAt(local, union.table, columns, match.localSeq, 'here');
    if (!isListed(local, union.table, here)) return [];
    const there = rowAt(other, union.table, columns, match.incomingSeq, 'in the other store');
    return [{ localSeq: match.localSeq, taken: rewriteHeld(local, union.table, columns, kept, here, there) }];
  });
  return {
    table: union.table,
    taken: outcomes.filter(({ taken }) => taken).map(({ localSeq }) => localSeq),
    refused: outcomes.filter(({ taken }) => !taken).map(({ localSeq }) => localSeq),
  };
}

/**
 * The held-copy step, run before {@link settleMatches} over the same
 * `unions`: rewrites each matched row here that `held_rows` lists from
 * the incoming row and drops its listing, as the module note says, in
 * one transaction. A table in `cut`, whose incoming rows a projected
 * pull cut down, takes no copy. `other` is only read, and a store with
 * nothing listed is not read at all. Answers one entry per union entry,
 * in its order; every pair stays in `unions` for the comparison.
 */
export function takeHeldCopies(
  local: Database,
  other: Database,
  unions: readonly TableUnion[],
  cut: ReadonlySet<string> = new Set(),
): HeldCopy[] {
  const none = (table: string): HeldCopy => ({ table, taken: [], refused: [] });
  if (!holdsListings(local)) return unions.map(({ table }) => none(table));
  return local.transaction(() => unions.map((union) => cut.has(union.table)
    ? none(union.table)
    : takeTableCopies(local, other, union)))();
}
