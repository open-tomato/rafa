import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'bun:test';

import { Grid } from './Grid.js';

describe('Grid', () => {
  it('lays its children in auto-fill tracks with the medium gap by default', () => {
    render(<Grid><span>one</span><span>two</span></Grid>);
    const grid = screen.getByText('one').parentElement;

    expect(grid?.className).toContain('grid-cols-[repeat(auto-fill,minmax(180px,1fr))]');
    expect(grid?.className).toContain('gap-4');
  });

  it('paints a fixed column count and gap from its variants, the passthrough last', () => {
    render(<Grid cols="3" gap="lg" className="mt-2"><span>one</span></Grid>);
    const grid = screen.getByText('one').parentElement;

    expect(grid?.className).toContain('grid-cols-3');
    expect(grid?.className).toContain('gap-6');
    expect(grid?.className.endsWith('mt-2')).toBe(true);
  });
});
