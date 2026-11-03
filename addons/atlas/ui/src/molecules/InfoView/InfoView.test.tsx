import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'bun:test';

import { InfoView } from './InfoView.js';

describe('InfoView', () => {
  it('says so when the card has no description', () => {
    render(<InfoView />);

    expect(screen.getByText('No description yet for this card.')).toBeDefined();
  });

  it('renders the description, note, legend and source', () => {
    render(
      <InfoView
        description="How to read it"
        note="a proxy"
        source="sample"
        legend={[{ id: 'a', label: 'A', tone: 'series-1' }, { id: 'b', label: 'B', tone: 'series-2' }]}
      />,
    );

    expect(screen.getByText('How to read it')).toBeDefined();
    expect(screen.getByText('Source: sample')).toBeDefined();
    expect(screen.getByRole('list', { name: 'Legend' })).toBeDefined();
  });
});
