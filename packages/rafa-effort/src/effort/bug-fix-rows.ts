/**
 * The store's side of the bug-fix join: the rows `pairBugFixes`
 * (`packages/rafa-inventory/src/report/bug-fix-pairs.ts`) reads, taken
 * from the effort store and mapped onto its `BugFixRows` shape.
 *
 * ## What is read
 *
 * Four selections, each in `ACROSS_STORES_ORDER` (`store/origins.ts`), so
 * two reads over an unchanged store, or over two merged copies of one,
 * answer the rows in one order:
 *
 *   - `bugs`: every `findings` row with a `tracker_ref` and no
 *     `resolution`, every column selected. Its `tracker_ref` is the
 *     reference's stored JSON (`store/tracker-refs.ts`), of which `kind`,
 *     `externalId` and `url` are kept.
 *   - `outOfScope`: every `out_of_scope_bugs` row of a session that holds
 *     one of those bugs, by its `what` and `artifact`. The join finds a
 *     bug's own words among them.
 *   - `resolved`: every `findings` row with a `resolution`.
 *   - `reports`: every `task_reports` row whose `status` is `done`, with
 *     its `collected_at`.
 *
 * Nothing is filtered past that: matching a bug to its words, its plan
 * and its fix is the join's, and the join is pure over these rows.
 *
 * ## The NDJSON backend
 *
 * The four tables live in `effort.sqlite` whichever backend `store`
 * selects: the NDJSON backend has no findings, bugs or reports file
 * (`store/findings.ts`, `store/triage.ts`, `store/reports.ts` each say
 * so of its table). So a `store: ndjson` project's rows are read from
 * the same file. What such a project often lacks is that file: until a
 * session's report is stored, there is none. With no `effort.sqlite`
 * under the root, {@link readBugFixRows} opens and creates nothing and
 * answers empty rows with a `note` naming the missing file, so a caller
 * can tell "no store to read" from "a store holding no bug". A store
 * that exists is opened through `withSqliteStore` for a read, so its
 * schema is brought forward, or refused, as `store/sqlite.ts` says a
 * read's is.
 *
 * A stored reference that is no JSON object with a string `kind` and
 * `externalId` throws, naming its row, as the tracker-ref reader throws
 * on one: it was written from outside, and a guess at its issue would
 * pair the bug with the wrong fix.
 */
import type {
  BugFindingRow,
  BugFixRows,
  BugTrackerRef,
  DoneReportRow,
  OutOfScopeBugRow,
  ResolvedFindingRow,
} from '@open-tomato/rafa-inventory/report/bug-fix-pairs';
import type { Database } from 'bun:sqlite';

import { existsSync } from 'node:fs';

import { ACROSS_STORES_ORDER } from '@open-tomato/rafa/store/origins';
import { sqliteStorePath, withSqliteStore } from '@open-tomato/rafa/store/sqlite';

/** What {@link readBugFixRows} answers. */
export interface BugFixRowsReading {
  /** The rows the join reads; every list empty when `note` is set. */
  readonly rows: BugFixRows;
  /** Why no store was read, or null when one was. */
  readonly note: string | null;
}

/** A `findings` row as `SELECT *` answers it, the columns the mapping reads. */
interface BugFindingColumns {
  readonly seq: number;
  readonly id: string;
  readonly session_id: string;
  readonly plan_stub: string | null;
  readonly task_line: string;
  readonly artifact: string | null;
  readonly tracker_ref: string;
  readonly outcome: string;
  readonly collected_at: string;
}

interface OutOfScopeColumns {
  readonly session_id: string;
  readonly what: string;
  readonly artifact: string | null;
}

interface ResolvedColumns {
  readonly session_id: string;
  readonly plan_stub: string | null;
  readonly task_line: string;
  readonly artifact: string | null;
  readonly resolution: string;
}

interface DoneReportColumns {
  readonly session_id: string;
  readonly plan_stub: string | null;
  readonly task_line: string;
  readonly outcome: string;
  readonly collected_at: string;
}

/** The bug findings' condition, shared by the bugs and their sessions. */
const IS_BUG = 'tracker_ref IS NOT NULL AND resolution IS NULL';

const SELECT_BUGS = `
  SELECT *
  FROM findings
  WHERE ${IS_BUG}
  ORDER BY ${ACROSS_STORES_ORDER}
`;

const SELECT_OUT_OF_SCOPE = `
  SELECT session_id, what, artifact
  FROM out_of_scope_bugs
  WHERE session_id IN (SELECT session_id FROM findings WHERE ${IS_BUG})
  ORDER BY ${ACROSS_STORES_ORDER}
`;

const SELECT_RESOLVED = `
  SELECT session_id, plan_stub, task_line, artifact, resolution
  FROM findings
  WHERE resolution IS NOT NULL
  ORDER BY ${ACROSS_STORES_ORDER}
`;

const SELECT_DONE_REPORTS = `
  SELECT session_id, plan_stub, task_line, outcome, collected_at
  FROM task_reports
  WHERE status = 'done'
  ORDER BY ${ACROSS_STORES_ORDER}
`;

/** The rows of a store holding nothing to join. */
const NO_ROWS: BugFixRows = Object.freeze({
  bugs: [],
  outOfScope: [],
  resolved: [],
  reports: [],
});

/** The refusal of a bug row the join cannot read. */
function unreadableRow(path: string, seq: number, reason: string): Error {
  return new Error(`effort store: ${path}: findings row ${String(seq)} ${reason}`);
}

/** A string field of a parsed reference, or null when it is none. */
function stringField(value: Record<string, unknown>, key: string): string | null {
  const field = value[key];
  return typeof field === 'string'
    ? field
    : null;
}

/** The parsed JSON of a stored reference, or null when it is no object. */
function parseRefJson(json: string): Record<string, unknown> | null {
  try {
    const value: unknown = JSON.parse(json);
    return typeof value === 'object' && value !== null && !Array.isArray(value)
      ? value as Record<string, unknown>
      : null;
  } catch {
    return null;
  }
}

/** The reference a bug row stores, as the join reads it; throws on one it cannot. */
function trackerRefOf(path: string, row: BugFindingColumns): BugTrackerRef {
  const value = parseRefJson(row.tracker_ref);
  if (value === null) throw unreadableRow(path, row.seq, 'holds a tracker_ref that is no JSON object');

  const kind = stringField(value, 'kind');
  const externalId = stringField(value, 'externalId');
  if (kind === null || externalId === null) {
    throw unreadableRow(path, row.seq, 'holds a tracker_ref with no string kind and externalId');
  }
  return { kind, externalId, url: stringField(value, 'url') };
}

function bugOf(path: string, row: BugFindingColumns): BugFindingRow {
  if (row.artifact === null) throw unreadableRow(path, row.seq, 'holds a tracker_ref and no artifact');
  return {
    id: row.id,
    sessionId: row.session_id,
    planStub: row.plan_stub,
    taskLine: row.task_line,
    artifact: row.artifact,
    trackerRef: trackerRefOf(path, row),
    outcome: row.outcome,
    collectedAt: row.collected_at,
  };
}

/** Reads the four selections from an open store. */
function selectRows(db: Database, path: string): BugFixRows {
  const bugs = db.query<BugFindingColumns, []>(SELECT_BUGS).all();
  const outOfScope = db.query<OutOfScopeColumns, []>(SELECT_OUT_OF_SCOPE).all();
  const resolved = db.query<ResolvedColumns, []>(SELECT_RESOLVED).all();
  const reports = db.query<DoneReportColumns, []>(SELECT_DONE_REPORTS).all();

  return {
    bugs: bugs.map((row) => bugOf(path, row)),
    outOfScope: outOfScope.map((row): OutOfScopeBugRow => ({
      sessionId: row.session_id,
      what: row.what,
      artifact: row.artifact,
    })),
    resolved: resolved.map((row): ResolvedFindingRow => ({
      sessionId: row.session_id,
      planStub: row.plan_stub,
      taskLine: row.task_line,
      artifact: row.artifact,
      resolution: row.resolution,
    })),
    reports: reports.map((row): DoneReportRow => ({
      sessionId: row.session_id,
      planStub: row.plan_stub,
      taskLine: row.task_line,
      outcome: row.outcome,
      collectedAt: row.collected_at,
    })),
  };
}

/**
 * The rows the bug-fix join reads, from the effort store under
 * `repoRoot`.
 *
 * Answers empty rows and a note, opening and creating nothing, when the
 * store file does not exist. Throws when it exists and cannot be read,
 * and on a bug row whose reference cannot be read. See the module note.
 */
export function readBugFixRows(repoRoot: string): BugFixRowsReading {
  const path = sqliteStorePath(repoRoot);
  if (!existsSync(path)) {
    return {
      rows: NO_ROWS,
      note: `no effort store at ${path}, so no bug findings to pair;`
        + ' a store: ndjson project keeps its findings and reports in this file too',
    };
  }

  return {
    rows: withSqliteStore(path, 'read', false, (db) => selectRows(db, path)),
    note: null,
  };
}
