/**
 * What a merge of two effort stores does with each table: the registry
 * every table of the SQLite store has an entry in.
 *
 * ## Scope
 *
 * A `merged` table travels: a merge unions its rows from both stores,
 * one copy of each identity. Each carries `origin_store` and
 * `origin_seq` since migration `row-origins`, with the partial unique
 * index `<table>_by_origin` over the pair, and is one of the
 * `ORIGIN_TABLES` (`origins.ts`). A `local` table never leaves its
 * machine: the migration log, the store's identity row and the merge
 * trail describe this one file, and a merge neither reads them from the
 * other store nor writes them from it.
 *
 * ## Identity
 *
 * The columns that make two rows of a merged table the same row, for a
 * row whose origin is NULL, as every row written before `row-origins`
 * or by an older runtime is. A UUID `id` where the table has one, the
 * session id for sessions and dispatches, the sha for commits, and the
 * natural key the table's own UNIQUE constraint or index names for the
 * rest. Two NULLs in an identity column count as equal, as the
 * `ifnull` of `skill_invocations_by_use` counts them.
 *
 * ## Edited fields
 *
 * The store is almost append-only. A column a production statement
 * changes after the insert is an edited field, and the merge has to know
 * which of two stores' values to keep. There are two today.
 * `findings.tracker_ref`, written by `writeTrackerRef`
 * (`tracker-refs.ts`) once a bug is filed, is {@link SET_ONCE}: a
 * filled value beats NULL, and two different filled values mean one
 * finding was filed twice, which the merge keeps in `merge_conflicts`.
 * A reference that supersedes another is a row of its own, never a new
 * value of this field; the `findings` entry says how.
 * `commits.row_json` is {@link RECOMPUTED}: its `minutesSincePrevious`
 * is rewritten by the merge itself (`merge-commit-gaps.ts`) for each
 * commit brought in and the commit after it in time, so two rows of one
 * commit that differ only in that key are the same row.
 *
 * ## What holds the registry to the schema
 *
 * `merge-rules.test.ts` reads a store brought through every migration
 * and fails on a table with no entry, an entry with no table, a merged
 * table without both origin columns and their partial unique index, an
 * identity or edited column the table lacks, and a production edit of a
 * merged table's column that has no rule here. A migration that adds a
 * table therefore adds its entry in the same commit.
 */

/** Whether a merge unions a table's rows or leaves the table on its machine. */
export type MergeScope = 'merged' | 'local';

/**
 * A filled value beats NULL, and two different filled values are both
 * kept, the incoming one as a conflict.
 */
export const SET_ONCE = 'set-once';

/**
 * The merge recomputes the field from the rows it holds, so two stores'
 * values of it are never compared: for `commits.row_json`, its
 * `minutesSincePrevious` key.
 */
export const RECOMPUTED = 'recomputed';

/** How a merge settles an edited field whose two stores disagree. */
export type EditRule = typeof SET_ONCE | typeof RECOMPUTED;

/** A table a merge unions. */
export interface MergedTableRule {
  readonly scope: 'merged';
  /** The columns two rows with a NULL origin are matched by. */
  readonly identity: readonly string[];
  /** Every column a production statement changes after the insert, with its rule. */
  readonly edited: Readonly<Record<string, EditRule>>;
}

/** A table that never leaves its machine. */
export interface LocalTableRule {
  readonly scope: 'local';
}

/** One table's entry in {@link MERGE_RULES}. */
export type MergeRule = MergedTableRule | LocalTableRule;

/** No column is changed after the insert. */
const APPEND_ONLY: Readonly<Record<string, EditRule>> = {};

/** A merged table matched by `identity` whose rows are never edited. */
function appendOnly(...identity: readonly string[]): MergedTableRule {
  return { scope: 'merged', identity, edited: APPEND_ONLY };
}

/** Every table of the SQLite store, by name, and what a merge does with it. */
export const MERGE_RULES: Readonly<Record<string, MergeRule>> = {
  sessions: appendOnly('session_id'),
  commits: { scope: 'merged', identity: ['sha'], edited: { row_json: RECOMPUTED } },
  /**
   * `tracker_ref` is set once. A superseding reference, filed after the
   * issue under a key closed as completed, is inserted as a new row
   * under the same key and never written over the old one, so a merge of
   * two stores keeps both rows, as two rows with two ids. The lookup
   * (`readTrackerRef`) answers the newest by `ACROSS_STORES_ORDER`
   * (`origins.ts`) read backwards, which both sides of a merge read
   * alike. One session holds one row per key (`findings_by_artifact`),
   * so a session's write superseding its own row's reference is refused
   * (`SupersedeInSessionRefusal`); the migration that would allow it is
   * #656's.
   */
  findings: { scope: 'merged', identity: ['id'], edited: { tracker_ref: SET_ONCE } },
  blockers: appendOnly('id'),
  out_of_scope_bugs: appendOnly('id'),
  report_absences: appendOnly('id'),
  task_reports: appendOnly('id'),
  preflight: appendOnly('run_id', 'position'),
  dispatches: appendOnly('session_id'),
  changes: appendOnly('id'),
  skill_invocations: appendOnly('session_id', 'name', 'sidechain'),
  plan_ci: appendOnly('pr', 'head_sha', 'read_at'),
  schema_migrations: { scope: 'local' },
  store_meta: { scope: 'local' },
  merges: { scope: 'local' },
  merge_conflicts: { scope: 'local' },
};
