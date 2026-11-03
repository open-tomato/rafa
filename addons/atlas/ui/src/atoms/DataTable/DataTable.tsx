import type { TableData } from '../../context/types.js';

import { cn } from '@open-tomato/charts';
import { ArrowDown, ArrowUp, ArrowUpDown } from 'lucide-react';
import { useMemo, useState, type ReactElement } from 'react';

import {
  dataTableCaptionVariants,
  dataTableCellVariants,
  dataTableFootnoteVariants,
  dataTableHeadVariants,
  dataTableRowVariants,
  dataTableSortVariants,
  dataTableTableVariants,
  dataTableVariants,
} from './DataTable.variants.js';
import { ariaSortOf, nextSort, sortRows, type TableSort } from './sort.js';

/** How many rows a table shows unless told otherwise. */
export const DEFAULT_TABLE_LIMIT = 12;

/** The size of the sort direction icon, in pixels. */
const SORT_ICON_SIZE = 12;

/** A data table's props: the table, its caption, a row limit and whether headers sort. */
export interface DataTableProps extends TableData {
  /** Names the table for assistive technology; not drawn. */
  readonly caption: string;
  /** Rows past this count are cut, with a line saying how many. */
  readonly limit?: number;
  /** Headers become sort buttons: numbers sort numerically, text by locale. */
  readonly sortable?: boolean;
  /** Layout context from the parent (margin); never colour or size. */
  readonly className?: string;
}

/** The icon for a column's sort state. */
function SortIcon({ state }: { readonly state: 'ascending' | 'descending' | 'none' }): ReactElement {
  if (state === 'ascending') return <ArrowUp size={SORT_ICON_SIZE} aria-hidden="true" />;
  if (state === 'descending') return <ArrowDown size={SORT_ICON_SIZE} aria-hidden="true" />;
  return <ArrowUpDown size={SORT_ICON_SIZE} aria-hidden="true" />;
}

/**
 * The table behind a chart, so nothing hides behind hover. A sortable
 * table marks the leading column with `aria-sort`; a long one is cut at
 * `limit` rows with a line saying how many more there are.
 */
export function DataTable({ columns, rows, caption, limit = DEFAULT_TABLE_LIMIT, sortable = false, className }: DataTableProps): ReactElement {
  const [sort, setSort] = useState<TableSort | null>(null);
  const sorted = useMemo(() => sortRows(rows, sort), [rows, sort]);
  const shown = sorted.slice(0, limit);
  const cut = rows.length - shown.length;

  return (
    <div className={cn(dataTableVariants(), className)}>
      <table className={dataTableTableVariants()}>
        <caption className={dataTableCaptionVariants()}>{caption}</caption>
        <thead>
          <tr>
            {columns.map((column, index) => {
              const state = ariaSortOf(sort, index);
              const align = index === 0
                ? 'start'
                : 'end';
              return (
                <th key={column} scope="col" aria-sort={sortable
                  ? state
                  : undefined} className={dataTableHeadVariants({ align })}>
                  {sortable
                    ? (
                      <button type="button" className={dataTableSortVariants({ active: state !== 'none' })} onClick={() => setSort((current) => nextSort(current, index))}>
                        {column}
                        <SortIcon state={state} />
                      </button>
                    )
                    : column}
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {shown.map((row, rowIndex) => (
            <tr key={rowIndex} className={dataTableRowVariants()}>
              {row.map((cell, cellIndex) => (
                <td key={cellIndex} className={dataTableCellVariants({ align: cellIndex === 0
                  ? 'start'
                  : 'end' })}>
                  {cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      {cut > 0 && <p className={dataTableFootnoteVariants()}>{cut} more {cut === 1
        ? 'row'
        : 'rows'} not shown</p>}
    </div>
  );
}
