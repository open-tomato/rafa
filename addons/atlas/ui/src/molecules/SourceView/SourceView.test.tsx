import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'bun:test';

import { SourceView } from './SourceView.js';

describe('SourceView', () => {
  it('renders the source line over a sortable table', () => {
    render(<SourceView caption="Tokens" source="Fixed sample" table={{ columns: ['A', 'B'], rows: [['x', 1]] }} />);

    expect(screen.getByText('Source: Fixed sample')).toBeDefined();
    expect(screen.getByRole('table', { name: 'Tokens' })).toBeDefined();
    expect(screen.getByRole('button', { name: 'B' })).toBeDefined();
  });

  it('caps and un-sorts the table as the table data says', () => {
    render(<SourceView caption="Links" table={{ columns: ['From', 'To'], rows: [['a', 'b'], ['b', 'c'], ['c', 'd']], limit: 2, sortable: false }} />);

    expect(screen.getAllByRole('row')).toHaveLength(3);
    expect(screen.getByText('1 more row not shown')).toBeDefined();
    expect(screen.queryByRole('button', { name: 'To' })).toBeNull();
  });

  it('lets its own props override the table data', () => {
    render(<SourceView caption="Links" limit={3} table={{ columns: ['From', 'To'], rows: [['a', 'b'], ['b', 'c'], ['c', 'd']], limit: 2 }} />);

    expect(screen.getAllByRole('row')).toHaveLength(4);
  });
});
