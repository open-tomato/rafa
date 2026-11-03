import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, mock } from 'bun:test';

import { nextTableSort, NO_TABLE_SORT, sortTableRows } from './sort.js';
import { Table, type TableColumn } from './Table.js';
import { moveRow } from './useRowReorder.js';

interface Row {
  readonly id: string;
  readonly name: string;
  readonly count: number;
}

const ROWS: readonly Row[] = [
  { id: 'b', name: 'beta', count: 2 },
  { id: 'a', name: 'alpha', count: 10 },
  { id: 'c', name: 'gamma', count: 1 },
];

const COLUMNS: readonly TableColumn<Row>[] = [
  { key: 'name', header: 'Name', sortable: true, footer: (rows) => `${rows.length} rows` },
  { key: 'count', header: 'Count', align: 'end', sortable: true },
];

describe('table sort', () => {
  it('cycles a header ascending, descending, then none', () => {
    const first = nextTableSort(NO_TABLE_SORT, 'name');
    const second = nextTableSort(first, 'name');

    expect(first).toEqual({ key: 'name', dir: 'asc' });
    expect(second).toEqual({ key: 'name', dir: 'desc' });
    expect(nextTableSort(second, 'name')).toEqual(NO_TABLE_SORT);
    expect(nextTableSort(second, 'count')).toEqual({ key: 'count', dir: 'asc' });
  });

  it('sorts numbers numerically and text by locale, through an accessor when given', () => {
    const byCount = sortTableRows(ROWS, COLUMNS, { key: 'count', dir: 'desc' }).map((row) => row.id);
    const byName = sortTableRows(ROWS, COLUMNS, { key: 'name', dir: 'asc' }).map((row) => row.id);
    const byLength = sortTableRows(ROWS, [{ key: 'name', sortAccessor: (row) => row.name.length }], { key: 'name', dir: 'asc' }).map((row) => row.id);

    expect(byCount).toEqual(['a', 'b', 'c']);
    expect(byName).toEqual(['a', 'b', 'c']);
    expect(byLength).toEqual(['b', 'a', 'c']);
  });

  it('moves a row to an insert position without touching the input', () => {
    expect(moveRow(['a', 'b', 'c'], 0, 3)).toEqual(['b', 'c', 'a']);
    expect(moveRow(['a', 'b', 'c'], 2, 0)).toEqual(['c', 'a', 'b']);
  });
});

describe('Table', () => {
  it('marks the sorted header and reorders the rows when a header is pressed', () => {
    render(<Table columns={COLUMNS} data={ROWS} getRowId={(row) => row.id} />);

    fireEvent.click(screen.getByRole('columnheader', { name: 'Count' }));

    const header = screen.getByRole('columnheader', { name: 'Count' });
    const cells = screen.getAllByRole('cell').map((cell) => cell.textContent);
    expect(header.getAttribute('aria-sort')).toBe('ascending');
    expect(cells).toEqual(['gamma', '1', 'beta', '2', 'alpha', '10']);
  });

  it('renders the footer band from the columns and the body under a height cap', () => {
    render(<Table columns={COLUMNS} data={ROWS} getRowId={(row) => row.id} layout="scroll" maxHeight={120} stickyFooter />);

    expect(screen.getByText('3 rows').className).toContain('bg-plane');
  });

  it('draws the selection column: a mixed header clears, a row adds its id, an opted-out row is disabled', () => {
    const onSelectionChange = mock((ids: readonly string[]) => ids);
    render(
      <Table
        columns={COLUMNS}
        data={ROWS}
        getRowId={(row) => row.id}
        selectable
        selectedIds={['a']}
        onSelectionChange={onSelectionChange}
        isRowSelectable={(row) => row.id !== 'c'}
      />,
    );

    expect(screen.getByRole('checkbox', { name: 'Select all rows' }).getAttribute('aria-checked')).toBe('mixed');
    expect(screen.getByRole('checkbox', { name: 'Select row c' }).hasAttribute('disabled')).toBe(true);

    fireEvent.click(screen.getByRole('checkbox', { name: 'Select all rows' }));
    expect(onSelectionChange).toHaveBeenLastCalledWith([]);

    fireEvent.click(screen.getByRole('checkbox', { name: 'Select row b' }));
    expect(onSelectionChange).toHaveBeenLastCalledWith(['a', 'b']);
  });

  it('keeps the data order and ignores the sort headers while reorderable', () => {
    render(<Table columns={COLUMNS} data={ROWS} getRowId={(row) => row.id} reorderable initialSort={{ key: 'count', dir: 'asc' }} />);

    fireEvent.click(screen.getByRole('columnheader', { name: 'Name' }));

    const firstCells = screen.getAllByRole('cell')
      .slice(0, 3)
      .map((cell) => cell.textContent);
    expect(firstCells[1]).toBe('beta');
  });
});
