/**
 * `planQuery`: query params checked for meaning against a source's
 * descriptor, and turned into the plan the engine runs. The schema has
 * already checked shape; this checks that every field named exists, that a
 * measure's aggregate is one its field accepts, that a `groupBy` field is
 * groupable and a filtered one filterable, that the grain is one the
 * source has, and that every `orderBy` key is a column of the result. Each
 * failure is `InvalidParams` naming the fields at fault.
 *
 * A query is in one of two modes. With measures, it groups: by the time
 * grain's bucket, then by the `groupBy` fields, one row per group. Without,
 * it lists rows: the `fields` named, or every field when none is.
 */
import type { TimeGrain } from './grain.js';
import type {
  DataSourceDescriptor,
  FieldDescriptor,
  FieldType,
  Filter,
  Grain,
  Measure,
  QueryColumn,
  QueryParams,
} from '../contract/types.js';

import { InvalidParams } from '../contract/errors.js';
import { DEFAULT_LIMIT } from '../contract/schemas.js';

import { isTimeGrain } from './grain.js';

/** The field `grain: 'plan'` groups by. */
export const PLAN_FIELD = 'plan_stub';

/** One group key: the time bucket of the time field, or a field's value. */
export type GroupKey =
  | { readonly kind: 'time'; readonly grain: TimeGrain; readonly cell: number }
  | { readonly kind: 'field'; readonly cell: number };

/** One measure, reading the selected cell at `cell`. */
export interface PlannedMeasure {
  readonly cell: number;
  readonly agg: Measure['agg'];
}

export interface PlannedOrder {
  readonly column: number;
  readonly dir: 'asc' | 'desc';
}

export interface QueryPlan {
  readonly mode: 'rows' | 'groups';
  /** The fields the select reads, in cell order; each a descriptor key. */
  readonly selected: readonly FieldDescriptor[];
  readonly columns: readonly QueryColumn[];
  readonly groupKeys: readonly GroupKey[];
  readonly measures: readonly PlannedMeasure[];
  readonly filters: readonly Filter[];
  /** The asked order first, then every column ascending as the tie-break. */
  readonly order: readonly PlannedOrder[];
  readonly limit: number;
}

const TIME_LABELS: Readonly<Record<TimeGrain, string>> = { day: 'Day', week: 'Week', month: 'Month' };

const INTEGER_AGGREGATES: ReadonlySet<string> = new Set(['count', 'count_distinct']);

function columnOf(field: FieldDescriptor): QueryColumn {
  return field.unit === undefined
    ? { key: field.key, label: field.label, type: field.type }
    : { key: field.key, label: field.label, type: field.type, unit: field.unit };
}

function measureType(field: FieldDescriptor, agg: Measure['agg']): FieldType {
  if (INTEGER_AGGREGATES.has(agg)) return 'integer';
  return agg === 'mean'
    ? 'number'
    : field.type;
}

function measureColumn(field: FieldDescriptor, measure: Measure): QueryColumn {
  const key = measure.as ?? `${field.key}_${measure.agg}`;
  const label = `${field.label} (${measure.agg})`;
  const type = measureType(field, measure.agg);
  return INTEGER_AGGREGATES.has(measure.agg) || field.unit === undefined
    ? { key, label, type }
    : { key, label, type, unit: field.unit };
}

/** Collects the selected fields, each once, and answers a field's cell. */
class Selection {
  readonly fields: FieldDescriptor[] = [];

  cellOf(field: FieldDescriptor): number {
    const index = this.fields.indexOf(field);
    if (index >= 0) return index;
    this.fields.push(field);
    return this.fields.length - 1;
  }
}

function fieldsByKey(descriptor: DataSourceDescriptor): ReadonlyMap<string, FieldDescriptor> {
  return new Map(descriptor.fields.map((field) => [field.key, field]));
}

/** Every name the params use that the descriptor lacks, refused at once. */
function checkKnown(params: QueryParams, fields: ReadonlyMap<string, FieldDescriptor>): void {
  const named = [
    ...(params.groupBy ?? []),
    ...(params.measures ?? []).map((measure) => measure.field),
    ...(params.filters ?? []).map((filter) => filter.field),
    ...(params.fields ?? []),
  ];
  const unknown = [...new Set(named.filter((name) => !fields.has(name)))];
  if (unknown.length > 0) {
    throw new InvalidParams(`the source has no field ${unknown.join(', ')}`, unknown);
  }
}

function fieldOf(fields: ReadonlyMap<string, FieldDescriptor>, key: string): FieldDescriptor {
  const field = fields.get(key);
  if (field === undefined) throw new InvalidParams(`the source has no field ${key}`, [key]);
  return field;
}

function checkGrain(descriptor: DataSourceDescriptor, grain: Grain): void {
  if (grain === 'all') return;
  if (!descriptor.grains.includes(grain)) {
    throw new InvalidParams(`the source ${descriptor.id} has no grain ${grain}`, ['grain']);
  }
}

function checkFilters(filters: readonly Filter[], fields: ReadonlyMap<string, FieldDescriptor>): void {
  const refused = filters.map((filter) => filter.field).filter((key) => fields.get(key)?.filterable !== true);
  if (refused.length > 0) {
    throw new InvalidParams(`these fields take no filter: ${refused.join(', ')}`, refused);
  }
}

function timeKeys(descriptor: DataSourceDescriptor, grain: Grain, fields: ReadonlyMap<string, FieldDescriptor>, selection: Selection): {
  readonly keys: GroupKey[];
  readonly columns: QueryColumn[];
} {
  if (grain === 'plan') {
    const field = fields.get(PLAN_FIELD);
    if (field === undefined) throw new InvalidParams(`grain plan needs a ${PLAN_FIELD} field`, ['grain']);
    return { keys: [{ kind: 'field', cell: selection.cellOf(field) }], columns: [columnOf(field)] };
  }
  if (!isTimeGrain(grain)) return { keys: [], columns: [] };
  if (descriptor.timeField === null) {
    throw new InvalidParams(`the source ${descriptor.id} has no time field to bucket by ${grain}`, ['grain']);
  }
  const field = fieldOf(fields, descriptor.timeField);
  return {
    keys: [{ kind: 'time', grain, cell: selection.cellOf(field) }],
    columns: [{ key: grain, label: TIME_LABELS[grain], type: 'date' }],
  };
}

function groupPlan(descriptor: DataSourceDescriptor, params: QueryParams, fields: ReadonlyMap<string, FieldDescriptor>, selection: Selection): {
  readonly keys: GroupKey[];
  readonly measures: PlannedMeasure[];
  readonly columns: QueryColumn[];
} {
  if (params.fields !== undefined && params.fields.length > 0) {
    throw new InvalidParams('fields lists rows; leave it out of a query with measures', ['fields']);
  }
  const time = timeKeys(descriptor, params.grain ?? 'all', fields, selection);
  const groupFields = (params.groupBy ?? []).map((key) => fieldOf(fields, key));
  const ungroupable = groupFields.filter((field) => !field.groupable).map((field) => field.key);
  if (ungroupable.length > 0) {
    throw new InvalidParams(`these fields cannot be grouped by: ${ungroupable.join(', ')}`, ungroupable);
  }
  const measureList = params.measures ?? [];
  const refused = measureList
    .filter((measure) => !fieldOf(fields, measure.field).aggregates.includes(measure.agg))
    .map((measure) => measure.field);
  if (refused.length > 0) {
    throw new InvalidParams(`these fields refuse the aggregate asked: ${refused.join(', ')}`, refused);
  }
  const keys = [...time.keys, ...groupFields.map((field): GroupKey => ({ kind: 'field', cell: selection.cellOf(field) }))];
  const measures = measureList.map((measure) => ({ cell: selection.cellOf(fieldOf(fields, measure.field)), agg: measure.agg }));
  const columns = [
    ...time.columns,
    ...groupFields.map(columnOf),
    ...measureList.map((measure) => measureColumn(fieldOf(fields, measure.field), measure)),
  ];
  return { keys, measures, columns };
}

function orderPlan(params: QueryParams, columns: readonly QueryColumn[]): PlannedOrder[] {
  const keys = columns.map((column) => column.key);
  const asked = params.orderBy ?? [];
  const unknown = asked.map((order) => order.key).filter((key) => !keys.includes(key));
  if (unknown.length > 0) {
    throw new InvalidParams(`the result has no column ${unknown.join(', ')} to order by`, unknown);
  }
  const ties = keys.map((_, column): PlannedOrder => ({ column, dir: 'asc' }));
  return [...asked.map((order) => ({ column: keys.indexOf(order.key), dir: order.dir })), ...ties];
}

function checkUnique(columns: readonly QueryColumn[]): void {
  const keys = columns.map((column) => column.key);
  const twice = [...new Set(keys.filter((key, index) => keys.indexOf(key) !== index))];
  if (twice.length > 0) {
    throw new InvalidParams(`the result would hold the column ${twice.join(', ')} twice; rename a measure with as`, twice);
  }
}

/** The plan for `params` over a source described by `descriptor`, or `InvalidParams`. */
export function planQuery(descriptor: DataSourceDescriptor, params: QueryParams): QueryPlan {
  const fields = fieldsByKey(descriptor);
  checkKnown(params, fields);
  checkGrain(descriptor, params.grain ?? 'all');
  const filters = params.filters ?? [];
  checkFilters(filters, fields);
  if (params.window !== undefined && descriptor.timeField === null) {
    throw new InvalidParams(`the source ${descriptor.id} has no time field to bound by a window`, ['window']);
  }
  const selection = new Selection();
  const limit = params.limit ?? DEFAULT_LIMIT;
  const measured = (params.measures ?? []).length > 0;
  if (!measured) {
    if ((params.groupBy ?? []).length > 0 || isTimeGrain(params.grain ?? 'all') || params.grain === 'plan') {
      throw new InvalidParams('a grouped query needs at least one measure', ['measures']);
    }
    const listed = params.fields === undefined || params.fields.length === 0
      ? descriptor.fields
      : params.fields.map((key) => fieldOf(fields, key));
    listed.forEach((field) => selection.cellOf(field));
    const columns = selection.fields.map(columnOf);
    return { mode: 'rows', selected: selection.fields, columns, groupKeys: [], measures: [], filters, order: orderPlan(params, columns), limit };
  }
  const groups = groupPlan(descriptor, params, fields, selection);
  checkUnique(groups.columns);
  return {
    mode: 'groups',
    selected: selection.fields,
    columns: groups.columns,
    groupKeys: groups.keys,
    measures: groups.measures,
    filters,
    order: orderPlan(params, groups.columns),
    limit,
  };
}
