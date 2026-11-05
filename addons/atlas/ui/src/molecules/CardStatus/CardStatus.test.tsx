import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'bun:test';

import { CardStatus } from './CardStatus.js';

describe('CardStatus', () => {
  it('renders a status region with the default line for its kind', () => {
    render(<CardStatus kind="empty" />);

    expect(screen.getByRole('status').textContent).toBe('No data for this range');
  });

  it('renders a given line and detail', () => {
    render(<CardStatus kind="error" title="Broke" detail="See Errors" />);

    expect(screen.getByRole('status').textContent).toBe('BrokeSee Errors');
  });
});
