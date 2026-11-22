/**
 * The select the engine runs. The only text from outside this file that
 * reaches the SQL is a table name the source checked against
 * `REPLICA_TABLES` and field keys from the descriptor, each lower snake
 * case and quoted. Every value, the window's bounds and each filter's
 * value alike, is a bound parameter.
 *
 * NULL reads as a value, not as SQL's unknown: `ne` and `nin` are true for
 * a NULL cell, unless `nin` lists NULL itself, and `in` listing NULL
 * matches it. `eq` and the comparisons never match NULL; `is_null` asks
 * for it, or with `value: false` for anything else.
 */
import type { Filter, Scalar } from '../contract/types.js';

import { InvalidParams } from '../contract/errors.js';

/** A value SQLite binds: booleans go in as 1 and 0. */
export type SqlValue = string | number | null;

/** One statement and the values bound to its `?` in text order. */
export interface SqlSelect {
  readonly sql: string;
  readonly bindings: readonly SqlValue[];
}

/** The most values one `in` or `nin` filter may list. */
export const MAX_FILTER_VALUES = 1_000;

const IDENTIFIER = /^[a-z][a-z0-9_]*$/;

interface Clause {
  readonly sql: string;
  readonly bindings: readonly SqlValue[];
}

/** `name` quoted for SQL, refused unless lower snake case. */
export function identifier(name: string): string {
  if (!IDENTIFIER.test(name)) throw new InvalidParams('a field or table name is not lower snake case', [name]);
  return `"${name}"`;
}

function bindable(value: Scalar): SqlValue {
  if (typeof value === 'boolean') {
    return value
      ? 1
      : 0;
  }
  return value;
}

function refuse(filter: Filter, why: string): never {
  throw new InvalidParams(`the ${filter.op} filter on ${filter.field} ${why}`, [filter.field]);
}

function single(filter: Filter): SqlValue {
  const { value } = filter;
  if (value === undefined || value === null || Array.isArray(value)) refuse(filter, 'takes one value that is not null');
  return bindable(value as Scalar);
}

function list(filter: Filter): { readonly values: readonly SqlValue[]; readonly hasNull: boolean } {
  const { value } = filter;
  if (!Array.isArray(value) || value.length === 0) refuse(filter, 'takes a list of at least one value');
  if (value.length > MAX_FILTER_VALUES) refuse(filter, `takes at most ${MAX_FILTER_VALUES} values`);
  const scalars = value as readonly Scalar[];
  return {
    values: scalars.filter((item) => item !== null).map(bindable),
    hasNull: scalars.includes(null),
  };
}

function marks(count: number): string {
  return Array.from({ length: count }, () => '?').join(', ');
}

const COMPARISONS: Readonly<Record<'eq' | 'gt' | 'gte' | 'lt' | 'lte', string>> = {
  eq: '=',
  gt: '>',
  gte: '>=',
  lt: '<',
  lte: '<=',
};

function inClause(column: string, filter: Filter): Clause {
  const { values, hasNull } = list(filter);
  if (values.length === 0) return { sql: `${column} IS NULL`, bindings: [] };
  const sql = hasNull
    ? `(${column} IN (${marks(values.length)}) OR ${column} IS NULL)`
    : `${column} IN (${marks(values.length)})`;
  return { sql, bindings: values };
}

function notInClause(column: string, filter: Filter): Clause {
  const { values, hasNull } = list(filter);
  if (values.length === 0) return { sql: `${column} IS NOT NULL`, bindings: [] };
  const sql = hasNull
    ? `(${column} IS NOT NULL AND ${column} NOT IN (${marks(values.length)}))`
    : `(${column} IS NULL OR ${column} NOT IN (${marks(values.length)}))`;
  return { sql, bindings: values };
}

function isNullClause(column: string, filter: Filter): Clause {
  const { value } = filter;
  if (value !== undefined && typeof value !== 'boolean') refuse(filter, 'takes true, false or no value');
  return value === false
    ? { sql: `${column} IS NOT NULL`, bindings: [] }
    : { sql: `${column} IS NULL`, bindings: [] };
}

function containsClause(column: string, filter: Filter): Clause {
  const value = single(filter);
  if (typeof value !== 'string') refuse(filter, 'takes text');
  return { sql: `instr(${column}, ?) > 0`, bindings: [value] };
}

/** One filter as a condition with its bindings. */
export function filterClause(filter: Filter): Clause {
  const column = identifier(filter.field);
  switch (filter.op) {
    case 'eq':
    case 'gt':
    case 'gte':
    case 'lt':
    case 'lte':
      return { sql: `${column} ${COMPARISONS[filter.op]} ?`, bindings: [single(filter)] };
    case 'ne':
      return { sql: `(${column} IS NULL OR ${column} <> ?)`, bindings: [single(filter)] };
    case 'in':
      return inClause(column, filter);
    case 'nin':
      return notInClause(column, filter);
    case 'contains':
      return containsClause(column, filter);
    case 'is_null':
      return isNullClause(column, filter);
  }
}

/** What one select reads: which fields of which table, bounded how. */
export interface SelectSpec {
  readonly table: string;
  readonly fields: readonly string[];
  readonly filters: readonly Filter[];
  /** The time field and the window's bounds as its text; null bounds leave that end open. */
  readonly time: { readonly field: string; readonly from: string | null; readonly to: string | null } | null;
  /** Rows read at most; the select asks for one more to tell a cut scan. */
  readonly cap: number;
}

function windowClauses(time: SelectSpec['time']): Clause[] {
  if (time === null) return [];
  const column = identifier(time.field);
  return [
    ...(time.from === null
      ? []
      : [{ sql: `${column} >= ?`, bindings: [time.from] }]),
    ...(time.to === null
      ? []
      : [{ sql: `${column} < ?`, bindings: [time.to] }]),
  ];
}

/**
 * The select for `spec`: its fields, newest first when there is a time
 * field, so a cut scan keeps the newest rows, and `cap + 1` rows at most.
 */
export function selectSql(spec: SelectSpec): SqlSelect {
  const clauses = [...windowClauses(spec.time), ...spec.filters.map(filterClause)];
  const columns = spec.fields.length === 0
    ? '1'
    : spec.fields.map(identifier).join(', ');
  const where = clauses.length === 0
    ? ''
    : ` WHERE ${clauses.map((clause) => clause.sql).join(' AND ')}`;
  const order = spec.time === null
    ? ''
    : ` ORDER BY ${identifier(spec.time.field)} DESC`;
  return {
    sql: `SELECT ${columns} FROM ${identifier(spec.table)}${where}${order} LIMIT ?`,
    bindings: [...clauses.flatMap((clause) => clause.bindings), spec.cap + 1],
  };
}
