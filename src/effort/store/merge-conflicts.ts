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
 *   without its `minutesSincePrevious` (`merge-commit-gaps.ts`). Equal
 *   so, the pair is skipped and the row here kept; the gap of a commit
 *   brought in is the merge's to rewrite, not a matched one's. Unequal,
 *   the rows differ outside every edited field, below.
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
 */
import type { TableUnion, UnionMatch } from './merge-union.js';
import type { Database, SQLQueryBindings } from 'bun:sqlite';

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

/** The comparable form of one recomputed field's value, by `<table>.<column>`. */
export const RECOMPUTED_COMPARISONS: Readonly<Record<string, (value: string) => string>> = {
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
