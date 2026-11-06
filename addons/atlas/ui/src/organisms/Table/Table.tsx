import type { ReactElement, ReactNode } from 'react';

import { cn } from '@open-tomato/charts';
import { useState } from 'react';

import { nextTableSort, NO_TABLE_SORT, sortTableRows, tableAriaSort, type SortValue, type TableSortState } from './sort.js';
import {
  tableBandVariants,
  tableCellVariants,
  tableElementVariants,
  tableFootVariants,
  tableFrameVariants,
  tableHeadLabelVariants,
  tableHeadVariants,
  tableModifierCellVariants,
  tableModifierHeadVariants,
  tableRowVariants,
  tableScrollVariants,
  tableTipVariants,
  type TableAlign,
  type TableDensity,
  type TableLayout,
  type TableOverflow,
} from './Table.variants.js';
import { SortGlyph, TableCellContent, TableRowCheckbox, TableSortHandle, type TableTip } from './TableParts.js';
import { useRowReorder } from './useRowReorder.js';

/** The leading modifier tracks, in pixels: the grip, then the checkbox. */
const HANDLE_TRACK = 34;
const CHECKBOX_TRACK = 42;

/** How far above a clipped cell its tip floats, in pixels. */
const TIP_LIFT = 10;

/** A column, configured once: its width, alignment, sort and overflow live here, never on a cell. */
export interface TableColumn<Row> {
  readonly key: string;
  readonly header: ReactNode;
  /** A fixed track, in pixels or as a CSS width; left out, the column fills what remains. */
  readonly width?: number | string;
  readonly align?: TableAlign;
  readonly sortable?: boolean;
  /** Sorts by this value instead of `row[key]`. */
  readonly sortAccessor?: (row: Row) => SortValue;
  readonly cell?: (row: Row) => ReactNode;
  /** `wrap` (the default), `truncate` (one line and a tip) or `clamp` (N lines and a tip). */
  readonly overflow?: TableOverflow;
  readonly clampLines?: number;
  /** The summary cell in the footer band, computed over every row. */
  readonly footer?: (rows: readonly Row[]) => ReactNode;
}

/** A table's props: the columns, the rows and their ids, the layout, the sort, and the row modifiers. */
export interface TableProps<Row> {
  readonly columns: readonly TableColumn<Row>[];
  readonly data: readonly Row[];
  readonly getRowId: (row: Row) => string;
  /** `fit` renders at its natural height; `scroll` caps the body at `maxHeight`. */
  readonly layout?: TableLayout;
  readonly density?: TableDensity;
  /** The body's height cap, in pixels, under `layout="scroll"`. */
  readonly maxHeight?: number;
  /** Renders the footer band; its cells come from each column's `footer`. */
  readonly stickyFooter?: boolean;
  /** `false` when a wrapper, the toolbar say, paints the frame. */
  readonly frame?: boolean;
  readonly initialSort?: TableSortState;
  /** Odd and even rows striped. */
  readonly striped?: boolean;
  /**
   * The checkbox column, always first. The table renders the boxes and
   * the header's all-or-some state; the parent owns the selection:
   * `selectedIds` in, the next id array out through `onSelectionChange`.
   */
  readonly selectable?: boolean;
  readonly selectedIds?: readonly string[];
  readonly onSelectionChange?: (ids: readonly string[]) => void;
  /** A row that answers `false` renders its box disabled. */
  readonly isRowSelectable?: (row: Row) => boolean;
  /**
   * The grip column for drag-to-reorder. `onReorder` emits the full next
   * order. The row order is the data order, so the sort headers are off
   * while reorderable.
   */
  readonly reorderable?: boolean;
  readonly onReorder?: (next: readonly Row[]) => void;
  /** A row that answers `false` renders its grip inert. */
  readonly isRowReorderable?: (row: Row) => boolean;
  /** Layout context from the parent (margin, placement); never colour or size. */
  readonly className?: string;
}

/** A column's `<col>` width: pixels as a number, a CSS width as a string, or auto. */
function trackWidth(width: number | string | undefined): string {
  if (width === undefined) return 'auto';
  return typeof width === 'number'
    ? `${width}px`
    : width;
}

/** The shared column group, one per inner table, so the header, body and footer tracks line up. */
function ColGroup<Row>({ columns, leadWidths }: { readonly columns: readonly TableColumn<Row>[]; readonly leadWidths: readonly number[] }): ReactElement {
  // Track widths are the column's own numbers, so they are set at the site.
  return (
    <colgroup>
      {leadWidths.map((width, index) => <col key={`modifier-${index}`} style={{ width: `${width}px` }} />)}
      {columns.map((column) => <col key={column.key} style={{ width: trackWidth(column.width) }} />)}
    </colgroup>
  );
}

/** The fixed-track data table: a header band, the one scrolling body, and an optional footer band. */
export function Table<Row>({
  columns,
  data,
  getRowId,
  layout = 'fit',
  density = 'comfortable',
  maxHeight,
  stickyFooter = false,
  frame = true,
  initialSort,
  striped = false,
  selectable = false,
  selectedIds,
  onSelectionChange,
  isRowSelectable,
  reorderable = false,
  onReorder,
  isRowReorderable,
  className,
}: TableProps<Row>): ReactElement {
  const [sort, setSort] = useState<TableSortState>(initialSort ?? NO_TABLE_SORT);
  const [tip, setTip] = useState<TableTip | null>(null);
  const reorder = useRowReorder({ data, onReorder });

  const onSort = (column: TableColumn<Row>): void => {
    if (column.sortable !== true || reorderable) return;
    setSort((current) => nextTableSort(current, column.key));
  };

  const sorted = reorderable
    ? data
    : sortTableRows(data, columns, sort);
  const scroll = layout === 'scroll';
  const leadWidths = [...(reorderable
    ? [HANDLE_TRACK]
    : []), ...(selectable
    ? [CHECKBOX_TRACK]
    : [])];

  const selected = new Set(selectedIds ?? []);
  const selectableRows = selectable
    ? sorted.filter((row) => isRowSelectable?.(row) ?? true)
    : [];
  const allSelected = selectableRows.length > 0 && selectableRows.every((row) => selected.has(getRowId(row)));
  const someSelected = !allSelected && selectableRows.some((row) => selected.has(getRowId(row)));
  const toggleAll = (checked: boolean): void => {
    onSelectionChange?.(checked
      ? selectableRows.map(getRowId)
      : []);
  };
  const toggleRow = (id: string, checked: boolean): void => {
    onSelectionChange?.(checked
      ? [...(selectedIds ?? []), id]
      : (selectedIds ?? []).filter((candidate) => candidate !== id));
  };

  // The body cap and the tip's coordinates are measured numbers, set at the site.
  const bodyStyle = scroll && maxHeight !== undefined
    ? { maxHeight }
    : undefined;
  const tipStyle = tip === null
    ? undefined
    : { left: tip.x, top: tip.y - TIP_LIFT };

  return (
    <div className={cn(tableFrameVariants({ frame }), className)}>
      <div className={tableBandVariants({ edge: 'header', gutter: scroll })}>
        <table className={tableElementVariants()}>
          <ColGroup columns={columns} leadWidths={leadWidths} />
          <thead>
            <tr>
              {reorderable && <th className={tableModifierHeadVariants({ density })} />}
              {selectable && (
                <th className={tableModifierHeadVariants({ density })}>
                  <TableRowCheckbox checked={allSelected} indeterminate={someSelected} onChange={toggleAll} label="Select all rows" />
                </th>
              )}
              {columns.map((column) => {
                const active = sort.key === column.key;
                return (
                  <th
                    key={column.key}
                    scope="col"
                    onClick={() => onSort(column)}
                    aria-sort={tableAriaSort(sort, column.key)}
                    className={tableHeadVariants({ density, active, sortable: column.sortable === true })}
                  >
                    <span className={tableHeadLabelVariants({ align: column.align })}>
                      {column.align === 'end' && <SortGlyph sortable={column.sortable} active={active} dir={sort.dir} />}
                      {column.header}
                      {column.align !== 'end' && <SortGlyph sortable={column.sortable} active={active} dir={sort.dir} />}
                    </span>
                  </th>
                );
              })}
            </tr>
          </thead>
        </table>
      </div>

      <div className={tableScrollVariants({ layout })} style={bodyStyle}>
        <table className={tableElementVariants()}>
          <ColGroup columns={columns} leadWidths={leadWidths} />
          <tbody>
            {sorted.map((row, index) => {
              const id = getRowId(row);
              const rowSelectable = isRowSelectable?.(row) ?? true;
              const rowProps = reorderable
                ? reorder.rowProps(index)
                : {};
              return (
                <tr
                  key={id}
                  className={tableRowVariants({
                    striped,
                    drop: reorderable
                      ? reorder.dropFor(index)
                      : 'none',
                    dragging: reorderable && reorder.isDragging(index),
                  })}
                  {...rowProps}
                >
                  {reorderable && (
                    <td className={tableModifierCellVariants({ density })}>
                      {(isRowReorderable?.(row) ?? true)
                        ? <span {...reorder.handleProps()}><TableSortHandle /></span>
                        : <TableSortHandle disabled />}
                    </td>
                  )}
                  {selectable && (
                    <td className={tableModifierCellVariants({ density })}>
                      <TableRowCheckbox checked={selected.has(id)} disabled={!rowSelectable} onChange={(checked) => toggleRow(id, checked)} label={`Select row ${id}`} />
                    </td>
                  )}
                  {columns.map((column) => (
                    <td key={column.key} className={tableCellVariants({ density })}>
                      <TableCellContent mode={column.overflow} lines={column.clampLines} align={column.align} onTip={setTip} offTip={() => setTip(null)}>
                        {column.cell
                          ? column.cell(row)
                          : (row as Record<string, ReactNode>)[column.key]}
                      </TableCellContent>
                    </td>
                  ))}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {stickyFooter && (
        <div className={tableBandVariants({ edge: 'footer', gutter: scroll })}>
          <table className={tableElementVariants()}>
            <ColGroup columns={columns} leadWidths={leadWidths} />
            <tfoot>
              <tr>
                {reorderable && <td className={tableFootVariants({ density })} />}
                {selectable && <td className={tableFootVariants({ density })} />}
                {columns.map((column) => (
                  <td key={column.key} className={tableFootVariants({ density, align: column.align })}>
                    {column.footer
                      ? column.footer(data)
                      : null}
                  </td>
                ))}
              </tr>
            </tfoot>
          </table>
        </div>
      )}

      {tip !== null && <div role="tooltip" className={tableTipVariants()} style={tipStyle}>{tip.text}</div>}
    </div>
  );
}
