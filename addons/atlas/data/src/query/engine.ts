/**
 * `runQuery`: the tabular query engine, in two steps.
 *
 * 1. SQL selects the rows: only descriptor field keys reach the SQL text,
 *    the window and the filters are bound parameters, and a scan reads at
 *    most `MAX_SCAN_ROWS` rows, the newest kept when it is cut.
 * 2. TypeScript groups, aggregates, orders and limits: one row per group
 *    under measures, else the rows themselves.
 *
 * With `compare: 'previous'`, the window just before the asked one is
 * selected in the same run and answered in `meta.previous`, shaped as the
 * rows are. The engine reads no database itself: `run` takes the selects
 * and answers each one's rows, so a source runs them over one replica
 * build and both windows come from the same one.
 */
import type { QueryPlan } from './plan.js';
import type { SqlSelect } from './sql.js';
import type { ClosedWindow, ResolvedWindow } from './window.js';
import type {
  DataSourceDescriptor,
  FieldDescriptor,
  QueryMeta,
  QueryParams,
  QueryResult,
  Scalar,
} from '../contract/types.js';

import { InvalidParams } from '../contract/errors.js';
import { QueryParamsSchema } from '../contract/schemas.js';

import { aggregate } from './aggregate.js';
import { timeKey } from './grain.js';
import { compareCells } from './order.js';
import { planQuery } from './plan.js';
import { selectSql } from './sql.js';
import { boundText, previousWindow, resolveWindow } from './window.js';

/** The most rows one scan reads; a scan cut there sets `meta.truncated`. */
export const MAX_SCAN_ROWS = 200_000;

type Row = readonly Scalar[];

/**
 * Runs each select, in order, and answers its rows as cells in select
 * order. A cell that is not text, a number or NULL reads as NULL.
 */
export type RunSelects = (selects: readonly SqlSelect[]) => readonly (readonly (readonly unknown[])[])[];

/** The table a query reads and the descriptor that says what it holds. */
export interface QueryTarget {
  /** A table name the caller has checked against its whitelist. */
  readonly table: string;
  readonly descriptor: DataSourceDescriptor;
}

export interface RunQueryOptions {
  /** The clock a `last` window counts back from; defaults to the system clock. */
  readonly now?: Date;
  /** The scan cap; defaults to `MAX_SCAN_ROWS`. */
  readonly maxScanRows?: number;
}

interface Shaped {
  readonly rows: readonly Row[];
  readonly scanned: number;
  readonly truncated: boolean;
}

/** Params checked for shape, a failure named by the paths zod found at fault. */
function parseParams(params: unknown): QueryParams {
  const parsed = QueryParamsSchema.safeParse(params);
  if (parsed.success) return parsed.data;
  const paths = [...new Set(parsed.error.issues.map((issue) => issue.path.map(String).join('.') || 'params'))];
  throw new InvalidParams('the query parameters do not match the contract', paths);
}

/** A cell as the result carries it: a boolean field's 1 and 0 read as true and false. */
function cellOf(value: unknown, field: FieldDescriptor): Scalar {
  if (field.type === 'boolean' && typeof value === 'number') return value !== 0;
  if (value === null || typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return value;
  return null;
}

function keyCells(plan: QueryPlan, row: Row): Scalar[] {
  return plan.groupKeys.map((key) => key.kind === 'time'
    ? timeKey(row[key.cell] ?? null, key.grain)
    : row[key.cell] ?? null);
}

function grouped(plan: QueryPlan, rows: readonly Row[]): Row[] {
  const groups = rows.reduce((map, row) => {
    const keys = keyCells(plan, row);
    const id = JSON.stringify(keys);
    const group = map.get(id);
    if (group === undefined) return map.set(id, { keys, rows: [row] });
    group.rows.push(row);
    return map;
  }, new Map<string, { readonly keys: Scalar[]; readonly rows: Row[] }>());
  if (groups.size === 0 && plan.groupKeys.length === 0) groups.set('[]', { keys: [], rows: [] });
  return [...groups.values()].map((group) => [
    ...group.keys,
    ...plan.measures.map((measure) => aggregate(group.rows.map((row) => row[measure.cell] ?? null), measure.agg)),
  ]);
}

function ordered(plan: QueryPlan, rows: readonly Row[]): Row[] {
  return [...rows].sort((left, right) => {
    for (const order of plan.order) {
      const by = compareCells(left[order.column] ?? null, right[order.column] ?? null, order.dir);
      if (by !== 0) return by;
    }
    return 0;
  });
}

function shape(plan: QueryPlan, raw: readonly (readonly unknown[])[], cap: number): Shaped {
  const truncated = raw.length > cap;
  const kept = raw.slice(0, cap).map((row) => plan.selected.map((field, index) => cellOf(row[index], field)));
  const rows = plan.mode === 'groups'
    ? grouped(plan, kept)
    : kept;
  return { rows: ordered(plan, rows).slice(0, plan.limit), scanned: kept.length, truncated };
}

function selectFor(target: QueryTarget, plan: QueryPlan, window: ResolvedWindow, cap: number): SqlSelect {
  const { timeField } = target.descriptor;
  const timeType = target.descriptor.fields.find((field) => field.key === timeField)?.type ?? 'datetime';
  const time = timeField === null
    ? null
    : {
      field: timeField,
      from: window.from === null
        ? null
        : boundText(window.from, timeType),
      to: window.to === null
        ? null
        : boundText(window.to, timeType),
    };
  return selectSql({ table: target.table, fields: plan.selected.map((field) => field.key), filters: plan.filters, time, cap });
}

function iso(date: Date | null): string | null {
  return date === null
    ? null
    : date.toISOString();
}

function metaOf(target: QueryTarget, window: ResolvedWindow, current: Shaped, previous: { readonly shaped: Shaped; readonly window: ClosedWindow } | null): QueryMeta {
  const base: QueryMeta = {
    asOf: target.descriptor.asOf,
    partial: target.descriptor.partial,
    partialReasons: target.descriptor.partialReasons,
    rowCount: current.scanned,
    truncated: current.truncated || (previous?.shaped.truncated ?? false),
    window: { from: iso(window.from), to: iso(window.to) },
  };
  return previous === null
    ? base
    : {
      ...base,
      previous: {
        rows: previous.shaped.rows,
        window: { from: previous.window.from.toISOString(), to: previous.window.to.toISOString() },
      },
    };
}

/**
 * Run `params` over `target` through `run`. Throws `InvalidParams` for
 * params that fail the schema or the descriptor, before any select runs.
 * `meta.rowCount` is the rows the scan of the asked window read.
 */
export function runQuery(run: RunSelects, target: QueryTarget, params: QueryParams, options: RunQueryOptions = {}): QueryResult {
  const checked = parseParams(params);
  const plan = planQuery(target.descriptor, checked);
  const window = resolveWindow(checked.window, options.now ?? new Date());
  const previous = checked.compare === 'previous'
    ? previousWindow(checked.window, window)
    : null;
  const cap = options.maxScanRows ?? MAX_SCAN_ROWS;
  const selects = [selectFor(target, plan, window, cap), ...(previous === null
    ? []
    : [selectFor(target, plan, previous, cap)])];
  const [currentRows = [], previousRows = []] = run(selects);
  const current = shape(plan, currentRows, cap);
  const before = previous === null
    ? null
    : { shaped: shape(plan, previousRows, cap), window: previous };
  return { columns: plan.columns, rows: current.rows, meta: metaOf(target, window, current, before) };
}
