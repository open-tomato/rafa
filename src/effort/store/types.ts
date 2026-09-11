/**
 * The effort store's port: the contract both backends implement, and
 * the one value they share.
 *
 * The sibling's store was bound to one file and one key projection per
 * instance. This port is parameterised by row kind instead, per the
 * spec's signature, so one store holds every kind and each call names
 * the kind it acts on. Left there, that would reopen the failure the
 * binding existed to prevent: a collector skipping by one projection of
 * a row while the append dedupes by another, so work is read again or
 * rows are duplicated, and both look like a store that is working. So
 * the projection is not the caller's to pass. No method takes one;
 * {@link EFFORT_KEY_PROJECTIONS} is a closed record a backend reads for
 * `keys` and `append` alike.
 *
 * ## What every backend owes
 *
 * These are the sibling's NDJSON store's rules, carried over unchanged
 * in behaviour, and the SQLite backend owes them too, so that nothing a
 * caller typed against {@link EffortStore} relies on holds for one
 * backend and not the other.
 *
 *   - Append-only. Nothing a store holds is rewritten or removed.
 *   - `keys` is read back from the rows, never from a sidecar index,
 *     which would be a second authority free to disagree with them. A
 *     stored row with no key contributes nothing, rather than a
 *     placeholder every other keyless row would collide with.
 *   - `append` adds only the rows whose key is not already held,
 *     whether it is held in storage or earlier in the same batch.
 *   - A row with no key REFUSES the whole batch: the append throws
 *     before anything is written. Such a row could never be
 *     deduplicated, so appending it would duplicate it on every run.
 *   - Writing nothing writes NOTHING. An append left with no row to add
 *     creates no file and no directory, and `read` and `keys` on a
 *     store that does not exist answer empty and create nothing either:
 *     absence is the first-run case. Only absence is absorbed. A store
 *     that exists and cannot be read throws, so it cannot pass for an
 *     empty one and have everything appended again.
 *
 * ## What the port leaves out
 *
 * Readings only one storage format can make, such as the NDJSON line
 * arithmetic, its unparsed-line count, or the newline it writes ahead
 * of a partial last line, are not the port's. A backend reports those
 * on a wider type of its own; {@link AppendResult} and `read` carry
 * only what both backends can answer.
 *
 * There is no `close`, because the spec's port has no lifecycle method.
 * A backend acquires and releases what it needs within each call; a
 * handle held across calls would have no owner to release it.
 *
 * The port is synchronous because both backends can be. The sibling's
 * NDJSON store reads and appends through `node:fs`'s synchronous calls,
 * and `bun:sqlite`'s `run` and `all` return plain values rather than
 * promises, measured on bun 1.3.14.
 */
import type { PlanStubMatch } from '../attribution.js';
import type { SessionKind } from '../classify.js';
import type { CommitStats } from '../commits.js';
import type { SessionStats } from '../session-log.js';

/**
 * One stats row widened with everything attribution answered — the row
 * the collector's session half writes.
 *
 * Declared here rather than beside the collector that builds it, so the
 * port depends only on the modules the row is made of and never on its
 * own caller. `effort/collect.ts` re-exports it.
 */
export interface SessionEffortRow extends SessionStats {
  /** What the session was dispatched to do. */
  kind: SessionKind;
  /** The modal branch of the session's records, or null. */
  branch: string | null;
  /** Records carrying it, and how many distinct branches were seen. */
  branchRecordCount: number;
  distinctBranchCount: number;
  /** The branch split; the stub is not yet a plan stub. */
  branchType: string | null;
  branchStub: string | null;
  /** The resolved plan, or null — never the branch stub as a fallback. */
  planStub: string | null;
  planStubMatch: PlanStubMatch;
  /** The dispatched task sentence, for a task session only. */
  taskText: string | null;
  /** Index of the enqueue among parsed records, or null if none. */
  enqueueRecordIndex: number | null;
  /** File size at collection; short of the file means a frozen row. */
  sizeBytes: number;
  /** File mtime at collection, ISO 8601. */
  modifiedAt: string;
}

/**
 * One commit's row: the commit parser's answer, stored as parsed.
 *
 * An alias rather than a widening. The commit half appends exactly
 * what `effort/commits.ts` answers, so the row is declared there.
 */
export type CommitEffortRow = CommitStats;

/**
 * The row each kind stores — the closed set every per-kind record in
 * this module is typed against.
 *
 * A type alias rather than an interface, on purpose. An interface can
 * be widened from outside this file by declaration merging and a type
 * alias cannot: measured, a module augmentation re-declaring an alias
 * is refused as a duplicate identifier, where the same merge into an
 * interface compiles silently. A kind therefore enters the store here
 * or nowhere, and entering it here is a compile error until
 * {@link EFFORT_KEY_PROJECTIONS} names its key.
 */
export type EffortRowByKind = {
  sessions: SessionEffortRow;
  commits: CommitEffortRow;
};

/** The row kinds a store holds. */
export type EffortRowKind = keyof EffortRowByKind;

/** The row one kind stores. */
export type EffortRow<K extends EffortRowKind> = EffortRowByKind[K];

/** What one append did. */
export interface AppendResult {
  /**
   * The file the append targeted, whether or not anything was written
   * to it: the kind's own file, or one shared by every kind, as the
   * backend lays its store out.
   */
  path: string;
  /** Rows appended. Zero writes nothing and creates nothing. */
  appended: number;
  /**
   * Rows whose key was already held, in storage or earlier in the
   * batch. A batch that was not refused has no third outcome, so
   * `appended + skipped` is its length.
   */
  skipped: number;
}

/**
 * An effort store holding every row kind, under the rules in the
 * module note.
 *
 * Property signatures rather than method signatures, as the sibling's
 * store interface spelled its own. TypeScript compares a method's
 * parameters bivariantly and a function-typed property's strictly, so
 * a backend whose `keys` accepted only one of the kinds compiles
 * against a method signature and is refused against this one.
 */
export interface EffortStore {
  /**
   * Appends the rows of one kind the store does not already hold.
   *
   * Throws, having written nothing, when any row of the batch carries
   * no key under {@link EFFORT_KEY_PROJECTIONS}.
   */
  append: <K extends EffortRowKind>(
    kind: K,
    rows: readonly EffortRow<K>[],
  ) => AppendResult;
  /**
   * The keys one kind already holds, which is what a collector skips.
   * Read back from the rows, into a fresh set the caller owns.
   */
  keys: (kind: EffortRowKind) => Set<string>;
  /** Every row one kind holds, in the order they were appended. */
  read: <K extends EffortRowKind>(kind: K) => EffortRow<K>[];
}

/** Each kind's key projection, typed against that kind's own row. */
export type EffortKeyProjections = {
  readonly [K in EffortRowKind]: (row: EffortRow<K>) => string | null;
};

/** A non-empty string, or null — an empty key is no key. */
function keyOrNull(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0
    ? value
    : null;
}

/**
 * The key each kind is deduplicated by: `sessions` by session id,
 * `commits` by sha.
 *
 * Closed over {@link EffortRowByKind}. A kind added there without a key
 * here is a compile error, and so is a projection reading a field its
 * kind's row does not carry. A backend answers `keys` and dedupes an
 * `append` through this one record, with no projection of its own to
 * substitute, and that is what keeps the set a collector skips by and
 * the set an append dedupes by the same set.
 *
 * A projection answers null for a row that carries no key: the field
 * absent, not a string, or empty. That puts the keyless rule a batch
 * is refused by in one place too. The check is made on the value
 * rather than trusted to the row's type, because a row read back from
 * storage is only as typed as the file it came from. Only the empty
 * string is empty — a key is not trimmed — which is the sibling store's
 * rule, so the two agree on every stored row's key.
 */
export const EFFORT_KEY_PROJECTIONS: EffortKeyProjections = {
  sessions: (row) => keyOrNull(row.sessionId),
  commits: (row) => keyOrNull(row.sha),
};
