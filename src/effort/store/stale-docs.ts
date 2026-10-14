/**
 * The store's `stale_docs` table as a row: one documentation line a task
 * report named as no longer matching the code.
 *
 * ## The rows
 *
 * The table carries the findings table's provenance, as `blockers` and
 * `out_of_scope_bugs` do, so the tables one report fills are read the
 * same way and join on `session_id`:
 *
 * | Column | Field | From |
 * | --- | --- | --- |
 * | `id` | `id` | generated, one per row |
 * | `session_id`, `plan_stub`, `task_line` | `sessionId`, `planStub`, `taskLine` | the dispatch |
 * | `kind` | `kind` | the writer: `sighting` or `unsettled` |
 * | `where_at`, `what` | `where`, `what` | the report entry, as parsed |
 * | `outcome` | `outcome` | the loop's verdict on the session |
 * | `collected_at` | `collectedAt` | the write's time, ISO 8601 |
 * | `origin_store`, `origin_seq` | none | the store's origin and the row's own `seq` (`origins.ts`) |
 *
 * `seq` comes first, the append order, as in every table of the store.
 *
 *   - The column is `where_at` and the field `where`: WHERE is an SQL
 *     keyword, and the report's key is `where`. It is NULL for an entry
 *     that named no place, which the report parser keeps.
 *   - `kind` is the one column no report holds. A `sighting` is an entry
 *     a task reported; an `unsettled` row is an entry the plan's doc task
 *     could not settle. The table's CHECK admits {@link STALE_DOC_KINDS}
 *     and nothing else.
 *   - `plan_stub` is NULL for a row written under no plan.
 *   - `outcome` has no CHECK, for the reason `findings.ts` gives, so a
 *     row read back holds whatever text the store does.
 *
 * ## Where the table lives
 *
 * In the SQLite store's file, created by the migration `stale-docs` of
 * `SQLITE_MIGRATIONS`, whichever backend the `store` setting selects.
 * `findings.ts` says why a table a report fills is not a kind, so the
 * port's row map and the NDJSON backend hold nothing of it.
 *
 * ## One entry, one row, per session and kind
 *
 * The unique index `stale_docs_by_entry` covers `session_id`, `kind`,
 * `ifnull(where_at, '')` and `what`. The two fields copied from the
 * report are in it, so a report written twice writes its rows once, and
 * two entries naming no place collide through the `ifnull`, which a bare
 * NULL column would not make them do. `kind` is in it as well: without
 * it, a session's unsettled row for an entry it also holds as a sighting
 * would be dropped as that sighting's duplicate, and the row kept would
 * say whichever kind was written first.
 *
 * ## In a merge
 *
 * The table is `merged` in `MERGE_RULES`, append-only and matched by
 * `id`, and one of the `ORIGIN_TABLES`, the tables whose inserts stamp
 * their origin pair (`origins.ts`).
 */

/** Who wrote a row: a task's report, or the doc task that could not settle it. */
export const STALE_DOC_KINDS = ['sighting', 'unsettled'] as const;

/** One of the {@link STALE_DOC_KINDS}. */
export type StaleDocKind = (typeof STALE_DOC_KINDS)[number];

/** One `stale_docs` row, as a reader answers it. */
export interface StaleDocRow {
  /** The row's own id, unique in the table. */
  readonly id: string;
  /** The session whose report named the line. */
  readonly sessionId: string;
  /** The plan's stub, or null for a row written under no plan. */
  readonly planStub: string | null;
  /** The task line, as the dispatch quoted it. */
  readonly taskLine: string;
  /** Whether a task reported the line or the doc task left it unsettled. */
  readonly kind: StaleDocKind;
  /** The file, with the line when known, or null when the entry named none. */
  readonly where: string | null;
  /** What no longer matches. */
  readonly what: string;
  /** The loop's verdict on the session, as stored. */
  readonly outcome: string;
  /** When the row's write was stamped, ISO 8601. */
  readonly collectedAt: string;
}
