/**
 * The merge's commit gaps: once the union (`merge-union.ts`) has brought
 * another store's commits in, each one's `minutesSincePrevious` and that
 * of the commit right after it in time are recomputed from the
 * timestamps the store holds.
 *
 * ## Why only those rows
 *
 * A commit's gap is the minutes since the commit before it in time
 * (`assignElapsedMinutes`, `src/effort/commits.ts`), measured with
 * {@link minutesBetween}. A commit brought in between two commits here
 * changes exactly two gaps: its own, which the other store measured
 * against its own neighbours, and that of the commit after it, which now
 * follows it rather than the commit before it. Every other gap keeps its
 * predecessor. So each commit brought in touches at most two rows, and a
 * row two of them name is written once. Where the store held the gaps a
 * full recompute over its commits gives, it holds them over the union
 * afterwards too; a gap a collection measured over a narrower range,
 * such as the null of an incremental run's first commit, is left as it
 * was unless a commit brought in lands right before it.
 *
 * There is no git call: the order and every gap come from the
 * `timestamp` in each row's `row_json`.
 *
 * ## The order
 *
 * Commits are ordered by `Date.parse` of their timestamp, as
 * `assignElapsedMinutes` orders them, and two at the same instant by
 * sha, so a merge run from either side orders a tie alike. A row whose
 * `row_json` does not parse, or whose timestamp does not, is left out of
 * the order as `assignElapsedMinutes` leaves it out: it is no one's
 * predecessor, and one brought in takes a null gap. The first commit in
 * the order takes null.
 *
 * ## The write
 *
 * The gap lives inside `row_json`, so a recompute rewrites that column,
 * `JSON.stringify` of the row with the one key replaced, which keeps the
 * row's other keys and their order. A row whose gap already reads the
 * recomputed value is not written. `MERGE_RULES` (`merge-rules.ts`)
 * declares `commits.row_json` edited under {@link RECOMPUTED} for this
 * statement, and `merge-conflicts.ts` compares two rows of one commit
 * without the gap through {@link withoutGap}.
 */
import type { Database } from 'bun:sqlite';

import { minutesBetween } from '../commits.js';

/** The key of `commits.row_json` a merge recomputes. */
export const GAP_FIELD = 'minutesSincePrevious';

/** One commit row whose gap the recompute rewrote. */
export interface GapRewrite {
  readonly seq: number;
  readonly sha: string;
  readonly before: number | null;
  readonly after: number | null;
}

/** A commit row as the recompute reads it. */
interface CommitEntry {
  readonly seq: number;
  readonly sha: string;
  /** The parsed `row_json`, or null when it is not a JSON object. */
  readonly row: Readonly<Record<string, unknown>> | null;
  /** The row's timestamp, or null when it has none. */
  readonly timestamp: string | null;
  /** `Date.parse` of the timestamp, or NaN when it has none or it does not parse. */
  readonly epoch: number;
}

const UPDATE_GAP = 'UPDATE commits SET row_json = ? WHERE seq = ?';

/** `text` parsed as a JSON object, or null when it is not one. */
function parsedObject(text: string): Readonly<Record<string, unknown>> | null {
  try {
    const value: unknown = JSON.parse(text);
    return typeof value === 'object' && value !== null && !Array.isArray(value)
      ? value as Record<string, unknown>
      : null;
  } catch {
    return null;
  }
}

/**
 * `row_json` without its gap, for comparing two rows of one commit:
 * the text unchanged when it is not a JSON object.
 */
export function withoutGap(rowJson: string): string {
  const row = parsedObject(rowJson);
  if (row === null) return rowJson;
  const rest = Object.fromEntries(Object.entries(row).filter(([key]) => key !== GAP_FIELD));
  return JSON.stringify(rest);
}

/** Every commit row, with its timestamp read. */
function readCommits(db: Database): CommitEntry[] {
  return db
    .query<{ seq: number; sha: string; row_json: string }, []>('SELECT seq, sha, row_json FROM commits')
    .all()
    .map(({ seq, sha, row_json: rowJson }) => {
      const row = parsedObject(rowJson);
      const timestamp = typeof row?.timestamp === 'string'
        ? row.timestamp
        : null;
      return { seq, sha, row, timestamp, epoch: timestamp === null
        ? Number.NaN
        : Date.parse(timestamp) };
    });
}

/** The commits with a parsed timestamp, in time order and by sha within an instant. */
function timeOrder(entries: readonly CommitEntry[]): CommitEntry[] {
  return entries
    .filter((entry) => !Number.isNaN(entry.epoch))
    .sort((left, right) => left.epoch - right.epoch || compareText(left.sha, right.sha));
}

/** Code-unit order, the same on every machine. */
function compareText(left: string, right: string): number {
  if (left === right) return 0;
  return left < right
    ? -1
    : 1;
}

/** The gap `row_json` holds, null when it holds none. */
function storedGap(entry: CommitEntry): number | null {
  const value = entry.row?.[GAP_FIELD];
  return typeof value === 'number'
    ? value
    : null;
}

/** The rows a commit brought in names: itself and the commit after it in time. */
function namedRows(inserted: CommitEntry, positions: ReadonlyMap<number, number>, order: readonly CommitEntry[]): number[] {
  const position = positions.get(inserted.seq);
  if (position === undefined) return [inserted.seq];
  const next = order[position + 1];
  return next === undefined
    ? [inserted.seq]
    : [inserted.seq, next.seq];
}

/** The gap `entry` takes in `order`: null first or out of the order. */
function recomputedGap(entry: CommitEntry, positions: ReadonlyMap<number, number>, order: readonly CommitEntry[]): number | null {
  const position = positions.get(entry.seq);
  if (position === undefined || position === 0) return null;
  const previous = order[position - 1];
  if (previous?.timestamp == null || entry.timestamp === null) return null;
  return minutesBetween(previous.timestamp, entry.timestamp);
}

/**
 * Recomputes, in `db`, the gap of each commit whose local `seq` is in
 * `inserted` and of the commit right after it in time, as the module
 * note says, in one transaction. Answers each row it rewrote, in time
 * order; a row whose gap was already right, or whose `row_json` is not
 * a JSON object, is not written and not answered. A `seq` no commit
 * holds is ignored.
 */
export function recomputeCommitGaps(db: Database, inserted: readonly number[]): GapRewrite[] {
  return db.transaction(() => {
    const entries = readCommits(db);
    const bySeq = new Map(entries.map((entry) => [entry.seq, entry]));
    const order = timeOrder(entries);
    const positions = new Map(order.map((entry, position) => [entry.seq, position]));
    const named = new Set(inserted.flatMap((seq) => {
      const entry = bySeq.get(seq);
      return entry === undefined
        ? []
        : namedRows(entry, positions, order);
    }));
    const targets = [...named]
      .map((seq) => bySeq.get(seq))
      .filter((entry): entry is CommitEntry => entry?.row != null)
      .sort((left, right) => (positions.get(left.seq) ?? -1) - (positions.get(right.seq) ?? -1));
    return targets.flatMap((entry) => {
      const before = storedGap(entry);
      const after = recomputedGap(entry, positions, order);
      if (before === after && entry.row !== null && Object.hasOwn(entry.row, GAP_FIELD)) return [];
      db.query<unknown, [string, number]>(UPDATE_GAP).run(JSON.stringify({ ...entry.row, [GAP_FIELD]: after }), entry.seq);
      return [{ seq: entry.seq, sha: entry.sha, before, after }];
    });
  })();
}
