/**
 * The reading "out-of-scope entries by routed kind" of
 * `rafa effort report`: per plan, how many of the entries the triage step
 * routed went under each kind, and the share of them filed as an issue.
 *
 * The triage step stores one `bug_routes` row per `out_of_scope_bugs`
 * entry it routed (`store/bug-routes.ts`), naming the kind it routed the
 * entry under and the route the entry took. Of the six kinds only `bug`
 * reaches a tracker as an issue of its own, so the share filed is the
 * figure a plan's sweep is judged on: a sweep whose entries are its own
 * fallout reads a low share, and one whose sessions file everything reads
 * a high one.
 *
 * ## What is counted
 *
 * Every `bug_routes` row, grouped by its `plan_stub`, NULL for the rows
 * written under no plan. Within a plan, one count per kind of
 * `BUG_KINDS` (`src/report/parse.ts`), taken on the row's routed `kind`
 * and never on the `said` kind the session wrote, and the rows whose
 * `route` is `filed`. A row is counted once per session that routed it,
 * as the table stores it: a triage repeated on a resumed run writes its
 * rows once, so a resume does not double a plan's figures.
 *
 * Plans are listed by stub, the rows under no plan last, so two reads
 * over an unchanged store answer the same bytes.
 *
 * ## The read
 *
 * {@link readBugKinds} reads under the repo root whichever backend
 * `store` selects, as `report-doc-bugs.ts` reads its rows: it opens and
 * creates nothing when the store file does not exist and answers no
 * plan, and a store that exists is opened through `withSqliteStore` for
 * a read, so its schema is brought forward, or refused, as
 * `store/sqlite.ts` says a read's is. Unlike that reading, a store that
 * cannot be read answers a `problem` sentence and no plan in place of a
 * throw, so one unreadable table costs the report one line rather than
 * the whole report. {@link countBugKinds} is the count alone, pure over
 * the rows.
 */
import type { BugRoute } from './store/bug-routes.js';
import type { BugKind } from '../report/parse.js';

import { existsSync } from 'node:fs';

import { BUG_KINDS } from '../report/parse.js';

import { sqliteStorePath, withSqliteStore } from './store/sqlite.js';

/** One plan's routed entries, counted by kind. */
export interface PlanBugKinds {
  /** The plan's stub, or null for the rows written under no plan. */
  readonly planStub: string | null;
  /** The plan's rows, one per routed entry. */
  readonly entries: number;
  /** One count per kind of `BUG_KINDS`, zero for a kind no entry was routed under. */
  readonly kinds: Readonly<Record<BugKind, number>>;
  /** The rows routed `filed`. */
  readonly filed: number;
  /** `filed` over `entries`, from 0 to 1. */
  readonly filedShare: number;
}

/** The reading: every plan holding a routed entry, or why none could be read. */
export interface BugKindsReading {
  /** One per plan, by stub, the rows under no plan last. */
  readonly plans: readonly PlanBugKinds[];
  /** Why the store could not be read, or null when it was read or is absent. */
  readonly problem: string | null;
}

/** The three columns of a `bug_routes` row the reading needs. */
export interface RoutedEntry {
  readonly planStub: string | null;
  readonly kind: BugKind;
  readonly route: BugRoute;
}

/** Every row, by the three columns the reading needs. */
const SELECT_ROUTED_ENTRIES = `
  SELECT plan_stub AS planStub, kind, route
  FROM bug_routes
`;

/** A count of zero for every kind. */
function noKinds(): Record<BugKind, number> {
  return Object.fromEntries(BUG_KINDS.map((kind) => [kind, 0])) as Record<BugKind, number>;
}

/** Stubs in order, the null stub last. */
function compareStubs(a: string | null, b: string | null): number {
  if (a === b) return 0;
  if (a === null) return 1;
  if (b === null) return -1;
  return a < b
    ? -1
    : 1;
}

/** One plan's rows as its counts. */
function planCounts(planStub: string | null, rows: readonly RoutedEntry[]): PlanBugKinds {
  const kinds = noKinds();
  for (const row of rows) kinds[row.kind] += 1;
  const filed = rows.filter((row) => row.route === 'filed').length;
  return { planStub, entries: rows.length, kinds, filed, filedShare: filed / rows.length };
}

/**
 * The rows counted by plan, kind and filed route. Pure over its input;
 * see the module note for what is counted and in which order.
 */
export function countBugKinds(rows: readonly RoutedEntry[]): PlanBugKinds[] {
  const byPlan = new Map<string | null, RoutedEntry[]>();
  for (const row of rows) {
    byPlan.set(row.planStub, [...(byPlan.get(row.planStub) ?? []), row]);
  }
  return [...byPlan.keys()]
    .sort(compareStubs)
    .map((planStub) => planCounts(planStub, byPlan.get(planStub) ?? []));
}

/**
 * Counts the `bug_routes` rows under `repoRoot` by plan, kind and filed
 * route.
 *
 * Answers no plan and no problem, opening and creating nothing, when the
 * store file does not exist. Answers no plan and a `problem` when it
 * exists and cannot be read, and never throws. See the module note.
 */
export function readBugKinds(repoRoot: string): BugKindsReading {
  const path = sqliteStorePath(repoRoot);
  if (!existsSync(path)) return { plans: [], problem: null };

  try {
    const rows = withSqliteStore(
      path,
      'read',
      false,
      (db) => db.query<RoutedEntry, []>(SELECT_ROUTED_ENTRIES).all(),
    );
    return { plans: countBugKinds(rows), problem: null };
  } catch (error) {
    const reason = error instanceof Error
      ? error.message
      : String(error);
    return { plans: [], problem: `cannot read the bug routes in ${path}: ${reason}` };
  }
}
