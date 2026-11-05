import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'bun:test';

import { DataTable } from './DataTable.js';
import { ariaSortOf, compareCells, nextSort, sortRows } from './sort.js';

const COLUMNS = ['Model', 'Tokens'];
const ROWS = [['Opus', 1204], ['Haiku', 512], ['Sonnet', '1,980']];

describe('the table sort', () => {
  it('compares numbers and numeric text numerically, other text by locale', () => {
    expect(compareCells(2, 10)).toBeLessThan(0);
    expect(compareCells('1,980', 512)).toBeGreaterThan(0);
    expect(compareCells('12%', '9%')).toBeGreaterThan(0);
    expect(compareCells('Beta', 'alpha')).toBeGreaterThan(0);
  });

  it('sorts a copy and leaves the input order alone', () => {
    const sorted = sortRows(ROWS, { column: 1, direction: 'desc' });

    expect(sorted.map((row) => row[0])).toEqual(['Sonnet', 'Opus', 'Haiku']);
    expect(ROWS[0]?.[0]).toBe('Opus');
    expect(sortRows(ROWS, null)).toBe(ROWS);
  });

  it('cycles a value column desc, asc, none and a label column asc, desc, none', () => {
    expect(nextSort(null, 1)).toEqual({ column: 1, direction: 'desc' });
    expect(nextSort({ column: 1, direction: 'desc' }, 1)).toEqual({ column: 1, direction: 'asc' });
    expect(nextSort({ column: 1, direction: 'asc' }, 1)).toBeNull();
    expect(nextSort(null, 0)).toEqual({ column: 0, direction: 'asc' });
    expect(nextSort({ column: 0, direction: 'asc' }, 0)).toEqual({ column: 0, direction: 'desc' });
    expect(nextSort({ column: 0, direction: 'desc' }, 0)).toBeNull();
  });

  it('names the aria-sort of each column', () => {
    expect(ariaSortOf(null, 0)).toBe('none');
    expect(ariaSortOf({ column: 1, direction: 'asc' }, 1)).toBe('ascending');
    expect(ariaSortOf({ column: 1, direction: 'asc' }, 0)).toBe('none');
  });
});

describe('DataTable', () => {
  it('renders a table named by its caption', () => {
    render(<DataTable caption="Tokens by model" columns={COLUMNS} rows={ROWS} />);

    expect(screen.getByRole('table', { name: 'Tokens by model' })).toBeDefined();
    expect(screen.getAllByRole('row')).toHaveLength(4);
  });

  it('sorts on a header click and marks the column with aria-sort', () => {
    render(<DataTable caption="Tokens" columns={COLUMNS} rows={ROWS} sortable />);
    fireEvent.click(screen.getByRole('button', { name: 'Tokens' }));
    const header = screen.getAllByRole('columnheader')[1];
    const firstRow = screen.getAllByRole('row')[1];

    expect(header?.getAttribute('aria-sort')).toBe('descending');
    expect(firstRow && within(firstRow).getAllByRole('cell')[0]?.textContent).toBe('Sonnet');
  });

  it('cuts rows past the limit and says how many', () => {
    render(<DataTable caption="Tokens" columns={COLUMNS} rows={ROWS} limit={1} />);

    expect(screen.getAllByRole('row')).toHaveLength(2);
    expect(screen.getByText('2 more rows not shown')).toBeDefined();
  });
});
