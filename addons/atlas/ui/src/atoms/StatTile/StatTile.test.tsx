import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'bun:test';

import { readDelta } from './delta.js';
import { StatTile } from './StatTile.js';

describe('readDelta', () => {
  it('reads a rise as good unless up is bad', () => {
    expect(readDelta({ text: '', direction: 'up' })).toBe('good');
    expect(readDelta({ text: '', direction: 'up', upIsGood: false })).toBe('bad');
    expect(readDelta({ text: '', direction: 'down' })).toBe('bad');
    expect(readDelta({ text: '', direction: 'down', upIsGood: false })).toBe('good');
    expect(readDelta({ text: '', direction: 'flat' })).toBe('flat');
  });
});

describe('StatTile', () => {
  it('renders a region named by its label with the value', () => {
    render(<StatTile label="Tasks landed" value="128" />);

    expect(screen.getByRole('region', { name: 'Tasks landed' }).textContent).toContain('128');
  });

  it('inks a bad delta critical', () => {
    render(<StatTile label="Failures" value="9" delta={{ text: '+3', direction: 'up', upIsGood: false }} />);

    expect(screen.getByText('+3').className).toContain('text-critical');
  });
});
