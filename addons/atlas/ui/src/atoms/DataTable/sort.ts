import type { TableCell } from '../../context/types.js';

/** A sort direction. */
export type SortDirection = 'asc' | 'desc';

/** The table's sort: a column index and a direction, or none. */
export interface TableSort {
  readonly column: number;
  readonly direction: SortDirection;
}

/** Text that reads as a number once its grouping, unit and sign marks are set aside: `1,204`, `12%`, `-3.5`. */
const NUMERIC_TEXT = /^[\d.,%\s+-]+[×x]?$/u;

/** A cell as a number when it reads as one, `undefined` otherwise. */
function asNumber(cell: TableCell): number | undefined {
  if (typeof cell === 'number') return cell;
  if (!NUMERIC_TEXT.test(cell)) return undefined;
  const parsed = Number.parseFloat(cell.replaceAll(',', ''));
  return Number.isNaN(parsed)
    ? undefined
    : parsed;
}

/** Orders two cells: numerically when both read as numbers, by locale otherwise. */
export function compareCells(a: TableCell, b: TableCell, locale = 'en-US'): number {
  const na = asNumber(a);
  const nb = asNumber(b);
  if (na !== undefined && nb !== undefined) return na - nb;
  return String(a).localeCompare(String(b), locale);
}

/** The rows in `sort` order, as a new array; the input is never reordered. */
export function sortRows<Row extends readonly TableCell[]>(rows: readonly Row[], sort: TableSort | null, locale?: string): readonly Row[] {
  if (sort === null) return rows;
  const sign = sort.direction === 'asc'
    ? 1
    : -1;
  return [...rows].sort((a, b) => sign * compareCells(a[sort.column] ?? '', b[sort.column] ?? '', locale));
}

/**
 * The sort after a click on `column`: a new column starts ascending for
 * the first (label) column and descending for a value column, a second
 * click flips to ascending, and a third clears the sort.
 */
export function nextSort(current: TableSort | null, column: number): TableSort | null {
  if (current === null || current.column !== column) {
    return { column, direction: column === 0
      ? 'asc'
      : 'desc' };
  }
  if (current.direction === 'desc' && column !== 0) return { column, direction: 'asc' };
  if (current.direction === 'asc' && column === 0) return { column, direction: 'desc' };
  return null;
}

/** The `aria-sort` value of a column under `sort`. */
export function ariaSortOf(sort: TableSort | null, column: number): 'ascending' | 'descending' | 'none' {
  if (sort?.column !== column) return 'none';
  return sort.direction === 'asc'
    ? 'ascending'
    : 'descending';
}
