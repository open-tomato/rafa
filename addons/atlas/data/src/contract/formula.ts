/**
 * `applyFormula`: the formula of a metric over the result its query
 * answered. Pure: it returns a new result with one column added at the end
 * (none for `none`), computed over the rows and, under
 * `compare: 'previous'`, over the previous window's rows on their own.
 */
import type { Formula, QueryColumn, QueryResult, Scalar } from './types.js';

import { InvalidParams } from './errors.js';

type Row = readonly Scalar[];

/** The added column's values, one per row, in row order. */
type Compute = (rows: readonly Row[]) => readonly Scalar[];

const NUMERIC_TYPES: ReadonlySet<string> = new Set(['integer', 'number']);

/** A finite number, or null for anything else (NULL, text, NaN). */
function numberOf(value: Scalar | undefined): number | null {
  return typeof value === 'number' && Number.isFinite(value)
    ? value
    : null;
}

/** The index of the numeric column `key`; a missing or non-numeric one is `InvalidParams`. */
function numericColumn(result: QueryResult, key: string): number {
  const index = result.columns.findIndex((column) => column.key === key);
  const column = result.columns[index];
  if (column === undefined) {
    throw new InvalidParams(`the formula reads a column the result lacks: ${key}`, [key]);
  }
  if (!NUMERIC_TYPES.has(column.type)) {
    throw new InvalidParams(`the formula reads a column that is not numeric: ${key}`, [key]);
  }
  return index;
}

function ratio(numerator: number, denominator: number): Compute {
  return (rows) => rows.map((row) => {
    const top = numberOf(row[numerator]);
    const bottom = numberOf(row[denominator]);
    return top === null || bottom === null || bottom === 0
      ? null
      : top / bottom;
  });
}

function share(of: number): Compute {
  return (rows) => {
    const total = rows.reduce((sum, row) => sum + (numberOf(row[of]) ?? 0), 0);
    return rows.map((row) => {
      const value = numberOf(row[of]);
      return value === null || total === 0
        ? null
        : value / total;
    });
  };
}

/** A running sum in row order; a row with no number keeps the sum so far. */
function cumulative(of: number): Compute {
  return (rows) => {
    let running = 0;
    return rows.map((row) => {
      running += numberOf(row[of]) ?? 0;
      return running;
    });
  };
}

function withColumn(result: QueryResult, column: QueryColumn, compute: Compute): QueryResult {
  if (result.columns.some((existing) => existing.key === column.key)) {
    throw new InvalidParams(`the formula names a column the result already has: ${column.key}`, [
      column.key,
    ]);
  }
  const extend = (rows: readonly Row[]): readonly Row[] => {
    const values = compute(rows);
    return rows.map((row, index) => [...row, values[index] ?? null]);
  };
  const previous = result.meta.previous;
  return {
    columns: [...result.columns, column],
    rows: extend(result.rows),
    meta: previous === undefined
      ? result.meta
      : { ...result.meta, previous: { ...previous, rows: extend(previous.rows) } },
  };
}

/** Adds the formula's column to `result`; `none` answers `result` itself. */
export function applyFormula(result: QueryResult, formula: Formula): QueryResult {
  switch (formula.kind) {
    case 'none':
      return result;
    case 'ratio':
      return withColumn(
        result,
        { key: formula.as, label: formula.as, type: 'number' },
        ratio(numericColumn(result, formula.numerator), numericColumn(result, formula.denominator)),
      );
    case 'share':
      return withColumn(
        result,
        { key: formula.as, label: formula.as, type: 'number' },
        share(numericColumn(result, formula.of)),
      );
    case 'cumulative': {
      const index = numericColumn(result, formula.of);
      const source = result.columns[index];
      const column: QueryColumn = source?.unit === undefined
        ? { key: formula.as, label: formula.as, type: source?.type ?? 'number' }
        : { key: formula.as, label: formula.as, type: source.type, unit: source.unit };
      return withColumn(result, column, cumulative(index));
    }
  }
}
