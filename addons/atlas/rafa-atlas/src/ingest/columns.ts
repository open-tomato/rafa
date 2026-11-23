/**
 * The column check of the effort ingest, and the cell readers its two
 * halves share (`effort.ts` for `task_facts`, `facts.ts` for the finding,
 * bug, change and CI buckets).
 *
 * `pragma_table_info` lists the columns of each store table the ingest
 * reads, and each column of {@link READ_COLUMNS} the snapshot lacks is
 * listed in `missing`, as `<table>.<column>`. A table the store does not
 * hold at all lists every column of its own. Each source's stamp names
 * the missing columns of the tables it is read from ({@link missingOf}),
 * marks itself `partial`, and reads those fields as NULL. The snapshot is
 * never migrated, so a store from an older or newer runtime is read as it
 * is.
 */
import type { Database } from 'bun:sqlite';

/** The store tables the ingest reads. */
export type EffortTable =
  | 'sessions'
  | 'dispatches'
  | 'task_reports'
  | 'store_meta'
  | 'findings'
  | 'blockers'
  | 'out_of_scope_bugs'
  | 'bug_routes'
  | 'changes'
  | 'plan_ci';

/** The two columns of a row's own origin, which the D3 key falls back from. */
const ORIGIN_COLUMNS: readonly string[] = ['origin_store', 'origin_seq'];

/** Every column the ingest reads, by table; a missing one marks the source partial. */
export const READ_COLUMNS: Readonly<Record<EffortTable, readonly string[]>> = {
  sessions: ['seq', 'session_id', 'row_json', ...ORIGIN_COLUMNS],
  dispatches: ['session_id', 'plan_stub', 'task_line', 'agent', 'model', 'effort', 'budget_usd', 'collected_at'],
  task_reports: ['session_id', 'plan_stub', 'task_line', 'status', 'skills_used', 'collected_at'],
  store_meta: ['id', 'store_id'],
  findings: [
    'seq', 'id', 'session_id', 'plan_stub', 'task_line', 'kind', 'trigger', 'what', 'artifact', 'signal',
    'outcome', 'tracker_ref', 'collected_at', ...ORIGIN_COLUMNS,
  ],
  blockers: ['seq', 'id', 'session_id', 'plan_stub', 'task_line', 'what', 'artifact', 'outcome', 'collected_at', ...ORIGIN_COLUMNS],
  out_of_scope_bugs: [
    'seq', 'id', 'session_id', 'plan_stub', 'task_line', 'what', 'artifact', 'security', 'scope', 'outcome',
    'collected_at', ...ORIGIN_COLUMNS,
  ],
  bug_routes: ['seq', 'id', 'session_id', 'plan_stub', 'task_line', 'what', 'kind', 'route', 'collected_at', ...ORIGIN_COLUMNS],
  changes: ['seq', 'id', 'session_id', 'plan_stub', 'task_line', 'level', 'area', 'summary', 'collected_at', ...ORIGIN_COLUMNS],
  plan_ci: ['seq', 'plan_stub', 'pr', 'head_sha', 'verdict', 'failing', 'read_at', ...ORIGIN_COLUMNS],
};

/** What the column check found. */
export interface ColumnCheck {
  /** The columns each table holds, of those the ingest reads. */
  readonly present: Readonly<Record<EffortTable, ReadonlySet<string>>>;
  /** Each column read and not held, as `<table>.<column>`, in {@link READ_COLUMNS} order. */
  readonly missing: readonly string[];
}

/** Check the snapshot's columns against {@link READ_COLUMNS}. */
export function checkEffortColumns(snapshot: Database): ColumnCheck {
  const columnsOf = snapshot.query<{ readonly name: string }, [string]>('SELECT name FROM pragma_table_info(?)');
  const heldOf = (table: EffortTable): ReadonlySet<string> => {
    const held = new Set(columnsOf.all(table).map((row) => row.name));
    return new Set(READ_COLUMNS[table].filter((column) => held.has(column)));
  };
  const tables = Object.keys(READ_COLUMNS) as EffortTable[];
  const present = Object.fromEntries(tables.map((table) => [table, heldOf(table)])) as Record<EffortTable, ReadonlySet<string>>;
  const missing = tables.flatMap((table) => READ_COLUMNS[table]
    .filter((column) => !present[table].has(column))
    .map((column) => `${table}.${column}`));
  return { present, missing };
}

/** `value` when it is a non-empty string, else null. */
export function textOrNull(value: unknown): string | null {
  return typeof value === 'string' && value !== ''
    ? value
    : null;
}

/** `value` when it is a finite number, else null. */
export function numberOrNull(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value)
    ? value
    : null;
}

/** The UTC calendar day of an ISO time, `YYYY-MM-DD`, or null for none or one that does not parse. */
export function dayOf(timestamp: string | null): string | null {
  if (timestamp === null) return null;
  const ms = Date.parse(timestamp);
  return Number.isNaN(ms)
    ? null
    : new Date(ms).toISOString()
      .slice(0, 'YYYY-MM-DD'.length);
}

/** The columns of `tables` the check found missing, as `<table>.<column>`, in check order. */
export function missingOf(columns: ColumnCheck, tables: readonly EffortTable[]): readonly string[] {
  return columns.missing.filter((column) => tables.some((table) => column.startsWith(`${table}.`)));
}

/** The newest ISO time of `times`, or null; a value that does not parse is skipped. */
export function newest(times: readonly (string | null)[]): string | null {
  return times.reduce<string | null>((latest, time) => {
    if (time === null || Number.isNaN(Date.parse(time))) return latest;
    return latest === null || Date.parse(time) > Date.parse(latest)
      ? time
      : latest;
  }, null);
}
