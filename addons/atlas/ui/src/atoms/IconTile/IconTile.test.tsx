import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'bun:test';

import { IconTile } from './IconTile.js';

describe('IconTile', () => {
  it('is a medium rounded accent tile by default', () => {
    render(<IconTile icon={<svg data-testid="icon" />} />);
    const tile = screen.getByTestId('icon').parentElement;

    expect(tile?.className).toContain('size-9');
    expect(tile?.className).toContain('rounded-md');
    expect(tile?.className).toContain('text-series-1');
  });

  it('draws a circle in its tone and size, with a pulse ring when asked', () => {
    render(<IconTile icon={<svg data-testid="icon" />} tone="good" size="2xl" shape="circle" pulse />);
    const tile = screen.getByTestId('icon').parentElement;

    expect(tile?.className).toContain('rounded-full');
    expect(tile?.className).toContain('size-20');
    expect(tile?.querySelector('span')?.className).toContain('animate-pulse-ring');
  });
});
