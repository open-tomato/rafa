/** Which column leads the sort, and which way. */
export interface TableSortState {
  readonly key: string | null;
  readonly dir: 'asc' | 'desc';
}

/** No column leads. */
export const NO_TABLE_SORT: TableSortState = { key: null, dir: 'asc' };

/** A sortable value: a number sorts numerically, anything else by locale. */
export type SortValue = number | string;

/** The part of a column the sort reads. */
export interface SortableColumn<Row> {
  readonly key: string;
  readonly sortable?: boolean;
  /** Sorts by this value instead of `row[key]`. */
  readonly sortAccessor?: (row: Row) => SortValue;
}

/** The next state when `key`'s header is pressed: ascending, then descending, then none. */
export function nextTableSort(current: TableSortState, key: string): TableSortState {
  if (current.key !== key) return { key, dir: 'asc' };
  if (current.dir === 'asc') return { key, dir: 'desc' };
  return NO_TABLE_SORT;
}

/** The value a column reads off a row: its accessor, or the row's field by key. */
function valueOf<Row>(column: SortableColumn<Row>, row: Row): SortValue {
  if (column.sortAccessor) return column.sortAccessor(row);
  const value = (row as Record<string, unknown>)[column.key];
  return typeof value === 'number'
    ? value
    : String(value ?? '');
}

/** `rows` in sort order; the original order when no column leads or the column is unknown. */
export function sortTableRows<Row>(rows: readonly Row[], columns: readonly SortableColumn<Row>[], sort: TableSortState): readonly Row[] {
  if (sort.key === null) return rows;
  const column = columns.find((candidate) => candidate.key === sort.key);
  if (column === undefined) return rows;
  const sign = sort.dir === 'asc'
    ? 1
    : -1;
  return [...rows].sort((a, b) => {
    const left = valueOf(column, a);
    const right = valueOf(column, b);
    const order = typeof left === 'number' && typeof right === 'number'
      ? left - right
      : String(left).localeCompare(String(right));
    return sign * order;
  });
}

/** The `aria-sort` value of a header. */
export function tableAriaSort(sort: TableSortState, key: string): 'ascending' | 'descending' | undefined {
  if (sort.key !== key) return undefined;
  return sort.dir === 'asc'
    ? 'ascending'
    : 'descending';
}
