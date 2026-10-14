/**
 * The `bug_routes` row: one per `out_of_scope_bugs` entry the triage
 * step routed, saying which kind the session gave the entry, which kind
 * the loop routed it under, and where it went.
 *
 * ## The rows
 *
 * The table carries the findings table's provenance, as `stale_docs`
 * does, less `outcome`, so the tables one report fills join on
 * `session_id`:
 *
 * | Column | Field | From |
 * | --- | --- | --- |
 * | `id` | `id` | generated, unique in the table |
 * | `session_id`, `plan_stub`, `task_line` | `sessionId`, `planStub`, `taskLine` | the dispatch |
 * | `entry_index` | `entryIndex` | the entry's place in the report's parsed list, from 0 |
 * | `what` | `what` | the report entry, as parsed |
 * | `said` | `said` | the kind the session wrote, NULL when its report held no `kind` key |
 * | `kind` | `kind` | the kind the loop routed the entry under |
 * | `route` | `route` | where the entry went |
 * | `collected_at` | `collectedAt` | the write's time, ISO 8601 |
 * | `origin_store`, `origin_seq` | none | the store's origin and the row's own `seq`, NULL in both when unminted (`origins.ts`) |
 *
 * `seq` comes first, the append order, as in every table of the store.
 *
 *   - `said` and `kind` are each one of `BUG_KINDS` (`src/report/parse.ts`)
 *     and `route` one of {@link BUG_ROUTES}; the table's CHECKs spell the
 *     same words and admit no other. `said` alone may be NULL.
 *   - `plan_stub` is NULL for a row written under no plan.
 *
 * ## Where the table lives
 *
 * In the SQLite store's file, created by the migration `bug-routes` of
 * `SQLITE_MIGRATIONS`, whichever backend the `store` setting selects.
 * `findings.ts` says why a table a report fills is not a kind, so the
 * port's row map and the NDJSON backend hold nothing of it.
 *
 * ## One entry, one row, per session
 *
 * The unique index `bug_routes_by_entry` covers `session_id`,
 * `entry_index` and `what`, so a triage repeated on a resumed run, which
 * routes the same report's entries again, writes its rows once, while
 * two entries of one report that share a `what` stay two rows.
 *
 * ## In a merge
 *
 * The table is `merged` in `MERGE_RULES`, append-only and matched by
 * `id`, and one of the `ORIGIN_TABLES`, the tables whose inserts stamp
 * their origin pair (`origins.ts`).
 */
import type { BugKind } from '../../report/parse.js';

/**
 * Where a routed entry went: `filed`, an issue on the public tracker;
 * `private`, the private channel a security entry takes; `machine`, the
 * machine channel; `inherited`, a failure the plan's base already held,
 * left unfiled; `repair`, a repair task added to the plan; `follow-up`, a
 * follow-up of the plan; `pr-body`, a line of the pull request's body;
 * `docs`, the stale-docs channel.
 */
export const BUG_ROUTES = [
  'filed',
  'private',
  'machine',
  'inherited',
  'repair',
  'follow-up',
  'pr-body',
  'docs',
] as const;

/** One of the {@link BUG_ROUTES}. */
export type BugRoute = (typeof BUG_ROUTES)[number];

/** One `bug_routes` row, as a reader answers it. */
export interface BugRouteRow {
  /** The row's own id, unique in the table. */
  readonly id: string;
  /** The session whose report held the entry. */
  readonly sessionId: string;
  /** The plan's stub, or null for a row written under no plan. */
  readonly planStub: string | null;
  /** The task line, as the dispatch quoted it. */
  readonly taskLine: string;
  /** The entry's index in the report's parsed `out_of_scope_bugs` list, from 0. */
  readonly entryIndex: number;
  /** The entry's `what`, as parsed. */
  readonly what: string;
  /** The kind the session wrote, or null for a report with no `kind` key. */
  readonly said: BugKind | null;
  /** The kind the loop routed the entry under. */
  readonly kind: BugKind;
  /** Where the entry went. */
  readonly route: BugRoute;
  /** When the row's write was stamped, ISO 8601. */
  readonly collectedAt: string;
}
