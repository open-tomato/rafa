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
});
