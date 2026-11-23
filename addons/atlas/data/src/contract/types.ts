/**
 * The Atlas contract as types: what a data source exposes
 * (`DataSourceDescriptor`), what a query accepts (`QueryParams`), what comes
 * back (`QueryResult`), what a named metric is (`MetricDefinition`), and the
 * envelope every response travels in, with the error inside a failed one.
 * `schemas.ts` mirrors each type one to one as a zod schema.
 */

/** The value type of a field; `date` is `YYYY-MM-DD`, `datetime` an ISO stamp. */
export type FieldType = 'string' | 'integer' | 'number' | 'boolean' | 'date' | 'datetime' | 'json';

/** What a field is for: a group key, a value to aggregate, the time axis or a row id. */
export type FieldRole = 'dimension' | 'measure' | 'time' | 'id';

/** The aggregates the engine computes; `p50`, `p90` and `p99` are nearest-rank quantiles. */
export type Aggregate =
  | 'count'
  | 'count_distinct'
  | 'sum'
  | 'mean'
  | 'min'
  | 'max'
  | 'p50'
  | 'p90'
  | 'p99';

/** The filter operators; `ne` and `nin` read true for a NULL value. */
export type FilterOp =
  | 'eq'
  | 'ne'
  | 'in'
  | 'nin'
  | 'gt'
  | 'gte'
  | 'lt'
  | 'lte'
  | 'contains'
  | 'is_null';

/** The time buckets a query can group by; `plan` groups by plan, `all` by nothing. */
export type Grain = 'day' | 'week' | 'month' | 'plan' | 'all';

/** The four audiences a metric is written for. */
export type Lens = 'pm' | 'architect' | 'developer' | 'qa';

/** The chart a metric is drawn as. */
export type ChartKind =
  | 'kpi'
  | 'line'
  | 'area'
  | 'bar'
  | 'stacked-bar'
  | 'percent-bar'
  | 'scatter'
  | 'histogram'
  | 'box'
  | 'gauge'
  | 'bullet'
  | 'donut'
  | 'treemap'
  | 'heatmap'
  | 'calendar'
  | 'table'
  | 'list';

/**
 * How close a metric comes to what it is named for: measured as named
 * (`direct`), a nearest measure (`proxy`), needing the GitHub source (`gh`)
 * or needing a collector that does not exist yet (`collect`).
 */
export type Feasibility = 'direct' | 'proxy' | 'gh' | 'collect';

/** One cell of a result row. */
export type Scalar = string | number | boolean | null;

/** One field a source exposes, and what the engine accepts on it. */
export interface FieldDescriptor {
  /** Lower snake case; the only field text that reaches the engine's SQL. */
  readonly key: string;
  readonly label: string;
  readonly type: FieldType;
  readonly role: FieldRole;
  readonly unit?: string;
  readonly description?: string;
  /** A closed set of values, for a select. */
  readonly values?: readonly string[];
  readonly range?: { readonly min?: number; readonly max?: number };
  /** The aggregates the engine accepts on this field. */
  readonly aggregates: readonly Aggregate[];
  readonly filterable: boolean;
  readonly groupable: boolean;
}

/** What one data source exposes: its fields, grains and how fresh it is. */
export interface DataSourceDescriptor {
  /** `<source>.<channel>`, such as `local.tasks`. */
  readonly id: string;
  readonly source: string;
  readonly channel: string;
  readonly title: string;
  readonly description: string;
  /** The field a window bounds, or null for a source with no time axis. */
  readonly timeField: string | null;
  readonly grains: readonly Grain[];
  readonly fields: readonly FieldDescriptor[];
  /** When the data was last true, or null when unknown. */
  readonly asOf: string | null;
  /** True when the source was built with something missing; `partialReasons` says what. */
  readonly partial: boolean;
  readonly partialReasons: readonly string[];
}

/**
 * The time a query covers: `from` and `to` as ISO dates or stamps, or
 * `last` as a count and a unit (`28d`, `12w`, `6m`). `last` and `from`
 * exclude each other.
 */
export interface Window {
  readonly from?: string;
  readonly to?: string;
  readonly last?: string;
}

/** One aggregate over one field, named `as` in the result when given. */
export interface Measure {
  readonly field: string;
  readonly agg: Aggregate;
  readonly as?: string;
}

/** One condition on one field; `in` and `nin` take a list. */
export interface Filter {
  readonly field: string;
  readonly op: FilterOp;
  readonly value?: Scalar | readonly Scalar[];
}

export interface OrderBy {
  /** A result column key: a field, a group key or a measure's name. */
  readonly key: string;
  readonly dir: 'asc' | 'desc';
}

/** What one query asks a source for; every member is optional. */
export interface QueryParams {
  readonly window?: Window;
  readonly grain?: Grain;
  readonly groupBy?: readonly string[];
  readonly measures?: readonly Measure[];
  readonly filters?: readonly Filter[];
  /** Row mode: the fields to return, used when `measures` is empty. */
  readonly fields?: readonly string[];
  readonly orderBy?: readonly OrderBy[];
  readonly limit?: number;
  /** Also run the window just before the asked one, returned in `meta.previous`. */
  readonly compare?: 'previous';
}

/** One column of a result. */
export interface QueryColumn {
  readonly key: string;
  readonly label: string;
  readonly type: FieldType;
  readonly unit?: string;
}

/** What a result says about itself. */
export interface QueryMeta {
  readonly asOf: string | null;
  readonly partial: boolean;
  readonly partialReasons: readonly string[];
  readonly rowCount: number;
  /** True when the engine's row cap cut the scan short. */
  readonly truncated: boolean;
  /** The window the query ran over, resolved to bounds. */
  readonly window: { readonly from: string | null; readonly to: string | null };
  /** The previous window's rows, under `compare: 'previous'`. */
  readonly previous?: {
    readonly rows: readonly (readonly Scalar[])[];
    readonly window: { readonly from: string; readonly to: string };
  };
}

/** A tabular answer: columns, rows in column order, and meta. */
export interface QueryResult {
  readonly columns: readonly QueryColumn[];
  readonly rows: readonly (readonly Scalar[])[];
  readonly meta: QueryMeta;
}

/**
 * One column computed from a result's columns: `ratio` divides two,
 * `share` divides a value by its column total, `cumulative` keeps a
 * running sum, and `none` adds nothing.
 */
export type Formula =
  | { readonly kind: 'none' }
  | {
    readonly kind: 'ratio';
    readonly numerator: string;
    readonly denominator: string;
    readonly as: string;
  }
  | { readonly kind: 'share'; readonly of: string; readonly as: string }
  | { readonly kind: 'cumulative'; readonly of: string; readonly as: string };

/** A line on a chart or a band on a KPI, from `at` upwards. */
export interface Threshold {
  readonly at: number;
  readonly tone: 'success' | 'gold' | 'danger';
  readonly label: string;
}

/** A named metric: a source, fixed query params and a formula, with how to draw it. */
export interface MetricDefinition {
  /** `<lens>.<name>`, such as `pm.tokens-per-day`. */
  readonly id: string;
  readonly title: string;
  readonly lenses: readonly Lens[];
  readonly description: string;
  readonly sourceId: string;
  readonly params: QueryParams;
  readonly formula: Formula;
  readonly unit?: string;
  readonly chart: ChartKind;
  readonly goal?: number;
  readonly thresholds?: readonly Threshold[];
  readonly feasibility: Feasibility;
  /** What a `proxy` metric stands in for. */
  readonly proxyFor?: string;
  /** The line a card shows under a `proxy` metric. */
  readonly proxyNote?: string;
}

/** The error codes a handler answers with; each maps to one HTTP status. */
export type AtlasErrorCode =
  | 'invalid_params'
  | 'invalid_body'
  | 'unknown_route'
  | 'unknown_source'
  | 'unknown_metric'
  | 'method_not_allowed'
  | 'contract_mismatch'
  | 'replica_unavailable'
  | 'internal';

export interface AtlasError {
  readonly code: AtlasErrorCode;
  readonly message: string;
  /** Field names and validation issues only; never a path or SQL text. */
  readonly details?: unknown;
}

export interface EnvelopeMeta {
  /** When the data was last true: the replica's build time, or the source's own stamp. */
  readonly asOf: string | null;
  /** The contract version the server speaks. */
  readonly version: string;
  readonly elapsedMs: number;
}

/** status/data/error/meta: `data` is null on an error, `error` is null on success. */
export interface Envelope<T> {
  readonly status: 'ok' | 'error';
  readonly data: T | null;
  readonly error: AtlasError | null;
  readonly meta: EnvelopeMeta;
}
