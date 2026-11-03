import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'bun:test';

import { Card } from './Card.js';

describe('Card', () => {
  it('renders a region named by its label, holding its children', () => {
    render(<Card label="Tokens per day">body</Card>);

    expect(screen.getByRole('region', { name: 'Tokens per day' }).textContent).toBe('body');
  });

  it('paints the surface, span and padding from its variants', () => {
    render(<Card label="Card" surface="sunken" span="full" padding="sm" />);
    const card = screen.getByRole('region', { name: 'Card' });

    expect(card.className).toContain('bg-plane');
    expect(card.className).toContain('col-span-full');
    expect(card.className).toContain('p-3');
  });

  it('merges the passthrough class last', () => {
    render(<Card label="Layout" className="mt-2" />);

    expect(screen.getByRole('region', { name: 'Layout' }).className.endsWith('mt-2')).toBe(true);
  });
});
