/**
 * The bug-route writer and reader: one row in the store's `bug_routes`
 * table per `out_of_scope_bugs` entry the triage step routed, saying
 * which kind the session gave the entry, which kind the loop routed it
 * under, and where it went, and every row one plan's sessions wrote
 * read back under its stub.
 *
 * {@link writeBugRoutes} stores the routes its caller names and files
 * nothing anywhere: the routing is the caller's, and this module only
 * records it. {@link readBugRoutesForPlan} answers a plan's rows back,
 * one per entry stored.
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
 *   - `said` and `kind` are each one of `BUG_KINDS` (`packages/rafa/src/report/parse.ts`)
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
 * The insert's conflict target is that index, so a row the session
 * already holds, on disk or earlier in the same write, adds nothing and
 * the earlier row stays, whatever kind and route the later one says. The
 * match is exact, byte for byte, and its scope is the session. Only that
 * conflict is absorbed: an id generated twice throws `UNIQUE constraint
 * failed: bug_routes.id` and rolls the whole write back.
 *
 * ## What is refused, and at which level
 *
 * The dispatch refuses the WHOLE write, by the findings writer's rule
 * (`checkDispatch`, with no outcome, as `changes.ts` passes it). The
 * write throws before the store is opened, even with the list empty,
 * and leaves no file behind and no byte of one changed.
 *
 * A route ENTRY is refused alone, and the rest are written. A refused
 * entry is never stored, and is answered in
 * {@link BugRoutesWriteResult.rejected}, by its index in the write's
 * `routes` list:
 *
 *   - `missing-field`: a `what`, `kind` or `route` of null.
 *   - `unstorable-field`: an `entryIndex` that is not a non-negative
 *     safe integer; a `what` that is not a string, is blank, or holds a
 *     lone UTF-16 surrogate (bound lossily, see `sqlite.ts`); a `said`
 *     or `kind` outside `BUG_KINDS`, or a `route` outside
 *     {@link BUG_ROUTES}.
 *
 * Each is checked here and not left to the table's CHECKs, which would
 * throw on the first such row and roll back every row beside it.
 *
 * ## Reading a plan's rows back
 *
 * {@link readBugRoutesForPlan} answers every row stored under one plan
 * stub, in append order. `plan_stub` is matched with `IS`, so the stub
 * null reads the rows written under no plan rather than none at all, as
 * `readStaleDocsForPlan` matches its own.
 *
 * Append order is `ACROSS_STORES_ORDER` (`origins.ts`): `collected_at`,
 * then the origin pair, then `seq`, never `seq` alone, for the reason
 * `changes.ts` gives. One write stamps its rows with one time, and
 * `origin_seq` then keeps them in the order the write listed them.
 *
 * It opens and creates nothing when the store file does not exist, and
 * answers none. A store that exists is opened through `withSqliteStore`
 * for a read, so it is brought forward, or refused, as `sqlite.ts` says
 * a read's is. `said`, `kind` and `route` are typed rather than checked
 * on the way out: the table's CHECKs are what bound them.
 *
 * ## Writing nothing writes nothing, and still checks the schema
 *
 * A write left with no entry to insert, because the list was empty or
 * every entry was refused, inserts no row. On a store that does not
 * exist it opens nothing, and creates no file and no directory. On one
 * that exists it still opens the store, through `writeSqliteStore`, as
 * the findings writer does.
 *
 * ## In a merge
 *
 * The table is `merged` in `MERGE_RULES`, append-only and matched by
 * `id`, and one of the `ORIGIN_TABLES`, the tables whose inserts stamp
 * their origin pair (`origins.ts`).
 */
import type { FindingsDispatch, FindingsWriterSeams } from './findings.js';
import type { BugKind } from '../../report/parse.js';
import type { Database } from 'bun:sqlite';

import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';

import { BUG_KINDS } from '../../report/parse.js';

import { checkDispatch, describeValue, textProblem } from './findings.js';
import { ACROSS_STORES_ORDER, STAMPED_COLUMNS, stampedValues } from './origins.js';
import { sqliteStorePath, withSqliteStore, writeSqliteStore } from './sqlite.js';

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

/** One routed entry, as the triage step hands it to the writer. */
export interface BugRouteEntry {
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
}

/** One write: one report's routed entries and their dispatch. */
export interface BugRoutesWrite {
  readonly dispatch: FindingsDispatch;
  /** One per routed entry, in the order the report listed them. */
  readonly routes: readonly BugRouteEntry[];
}

/** Why one entry was not written. */
export type BugRouteRejectionReason =
  /** A `what`, `kind` or `route` of null. */
  | 'missing-field'
  /** A field holds a value the table cannot hold. */
  | 'unstorable-field';

/** One entry that was not written, and why. */
export interface BugRouteRejection {
  /** The entry's index in the write's `routes` list. */
  readonly index: number;
  readonly reason: BugRouteRejectionReason;
  /** The field at fault, by its {@link BugRouteEntry} key. */
  readonly field: string;
  /** One sentence for an operator to read, naming the entry by its place in the write. */
  readonly text: string;
}

/** What one write did. */
export interface BugRoutesWriteResult {
  /** The store's file, whether or not anything was written to it. */
  readonly path: string;
  /** Rows written. */
  readonly appended: number;
  /** Entries the session already held, on disk or earlier in the write. */
  readonly skipped: number;
  /**
   * Entries refused, in list order. With these, `appended + skipped +
   * rejected.length` is the `routes` list's length.
   */
  readonly rejected: readonly BugRouteRejection[];
}

/** A column value, as it is bound. */
type Bound = string | number | null;

/** Why a field's value cannot be stored. */
interface FieldProblem {
  readonly reason: BugRouteRejectionReason;
  /** The problem, worded to follow the field's path. */
  readonly problem: string;
}

/** A field's check: its problem, or null when the value can be stored. */
type FieldCheck = (value: unknown) => FieldProblem | null;

/** The insert. Its conflict target is the index `bug_routes_by_entry`. */
const INSERT_BUG_ROUTE = `
  INSERT INTO bug_routes (
    id, session_id, plan_stub, task_line,
    entry_index, what, said, kind, route,
    collected_at,
    ${STAMPED_COLUMNS}
  )
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ${stampedValues('bug_routes')})
  ON CONFLICT (session_id, entry_index, what) DO NOTHING
`;

/** The problem of a value that is null when it has to be present. */
const MISSING: FieldProblem = { reason: 'missing-field', problem: 'is missing' };

/** An index into the report's list: a non-negative safe integer. */
function indexCheck(value: unknown): FieldProblem | null {
  return Number.isSafeInteger(value) && (value as number) >= 0
    ? null
    : { reason: 'unstorable-field', problem: `is ${describeValue(value)}, not a non-negative integer` };
}

/** A text field that has to be present. */
function requiredText(value: unknown): FieldProblem | null {
  if (value === null) return MISSING;
  const problem = textProblem(value);
  return problem === null
    ? null
    : { reason: 'unstorable-field', problem };
}

/** A check that a value is one of a closed set, or null when `nullable`. */
function choiceCheck(choices: readonly string[], nullable: boolean): FieldCheck {
  return (value) => {
    if (value === null) {
      return nullable
        ? null
        : MISSING;
    }
    return (choices as readonly unknown[]).includes(value)
      ? null
      : { reason: 'unstorable-field', problem: `is ${describeValue(value)}, not one of ${choices.join(', ')}` };
  };
}

/** Each field's check, in the order a row lists its columns. */
const FIELD_CHECKS: readonly (readonly [keyof BugRouteEntry, FieldCheck])[] = [
  ['entryIndex', indexCheck],
  ['what', requiredText],
  ['said', choiceCheck(BUG_KINDS, true)],
  ['kind', choiceCheck(BUG_KINDS, false)],
  ['route', choiceCheck(BUG_ROUTES, false)],
];

/** Why one entry cannot be written, or null when it can. */
function rejectionOf(entry: BugRouteEntry, index: number): BugRouteRejection | null {
  for (const [field, check] of FIELD_CHECKS) {
    const found = check(entry[field]);
    if (found !== null) {
      const text = `bug routes[${index}].${field} ${found.problem}; not written`;
      return { index, reason: found.reason, field, text };
    }
  }
  return null;
}

/** One stored entry's column values, in the insert's order. */
function rowValues(
  entry: BugRouteEntry,
  dispatch: FindingsDispatch,
  id: string,
  collectedAt: string,
): Bound[] {
  const { sessionId, planStub, taskLine } = dispatch;
  return [
    id, sessionId, planStub, taskLine,
    entry.entryIndex, entry.what, entry.said, entry.kind, entry.route,
    collectedAt,
  ];
}

/**
 * Inserts every row in one transaction and answers how many were added.
 * A row whose entry the session already holds, on disk or earlier in
 * the write, adds nothing.
 */
function insertRows(db: Database, rows: readonly Bound[][]): number {
  const insert = db.query<unknown, Bound[]>(INSERT_BUG_ROUTE);
  const insertAll = db.transaction(() => rows.reduce(
    (appended, values) => appended + insert.run(...values).changes,
    0,
  ));
  return insertAll.immediate();
}

/**
 * Writes one report's routed entries for one dispatch, one row per entry
 * the session does not already hold.
 *
 * Throws, having opened nothing, when the dispatch cannot be stored.
 * Throws the store's own refusal of a schema past this rafa's version
 * whenever the store exists, even with nothing to insert. An entry that
 * cannot be stored is left out and answered in `rejected`, and the
 * others are written. See the module note for the dedupe rule and each
 * refusal.
 */
export function writeBugRoutes(
  repoRoot: string,
  write: BugRoutesWrite,
  seams: FindingsWriterSeams = {},
): BugRoutesWriteResult {
  checkDispatch('bug routes', write.dispatch, null);
  const path = sqliteStorePath(repoRoot);

  const rejected: BugRouteRejection[] = [];
  const stored: BugRouteEntry[] = [];
  for (const [index, entry] of write.routes.entries()) {
    const rejection = rejectionOf(entry, index);
    if (rejection === null) stored.push(entry);
    else rejected.push(rejection);
  }

  const collectedAt = (seams.now ?? (() => new Date()))().toISOString();
  const newId = seams.newId ?? randomUUID;
  const rows = stored.map((entry) => rowValues(entry, write.dispatch, newId(), collectedAt));

  const appended = writeSqliteStore(path, rows.length, 0, (db) => insertRows(db, rows));
  return { path, appended, skipped: stored.length - appended, rejected };
}

/** A `bug_routes` row, as the read's query answers it. */
interface StoredBugRoute {
  readonly id: string;
  readonly session_id: string;
  readonly plan_stub: string | null;
  readonly task_line: string;
  readonly entry_index: number;
  readonly what: string;
  readonly said: BugKind | null;
  readonly kind: BugKind;
  readonly route: BugRoute;
  readonly collected_at: string;
}

/** Every row under one plan stub, in the append order every store holding them reads. */
const SELECT_PLAN_BUG_ROUTES = `
  SELECT id, session_id, plan_stub, task_line, entry_index, what, said, kind, route, collected_at
  FROM bug_routes
  WHERE plan_stub IS ?
  ORDER BY ${ACROSS_STORES_ORDER}
`;

/**
 * Every `bug_routes` row stored under one plan stub, in append order.
 * Pass null for the rows written under no plan.
 *
 * Answers none, opening nothing, when the store file does not exist, and
 * throws when it exists and cannot be read. See the module note.
 */
export function readBugRoutesForPlan(repoRoot: string, planStub: string | null): BugRouteRow[] {
  const path = sqliteStorePath(repoRoot);
  if (!existsSync(path)) return [];

  const rows = withSqliteStore(
    path,
    'read',
    false,
    (db) => db.query<StoredBugRoute, [string | null]>(SELECT_PLAN_BUG_ROUTES).all(planStub),
  );
  return rows.map((row) => ({
    id: row.id,
    sessionId: row.session_id,
    planStub: row.plan_stub,
    taskLine: row.task_line,
    entryIndex: row.entry_index,
    what: row.what,
    said: row.said,
    kind: row.kind,
    route: row.route,
    collectedAt: row.collected_at,
  }));
}
