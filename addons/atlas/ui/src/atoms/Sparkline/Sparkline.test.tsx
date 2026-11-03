import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';

import { sparkPath } from './points.js';
import { Sparkline } from './Sparkline.js';

describe('sparkPath', () => {
  it('spreads the values across the width, min at the bottom inset and max at the top', () => {
    expect(sparkPath([0, 10], 100, 20)).toEqual({ points: '0,18 100,2', last: { x: 100, y: 2 } });
  });

  it('draws a flat series at the bottom inset', () => {
    expect(sparkPath([3, 3, 3], 10, 10)?.points).toBe('0,8 5,8 10,8');
  });

  it('has no path under two values', () => {
    expect(sparkPath([1], 10, 10)).toBeNull();
  });
});

describe('Sparkline', () => {
  it('renders an image named by its label', () => {
    render(<Sparkline values={[1, 2, 3]} label="Trend" tone="good" />);

    expect(screen.getByRole('img', { name: 'Trend' }).getAttribute('class')).toContain('text-good');
  });

  it('renders nothing under two values', () => {
    const { container } = render(<Sparkline values={[1]} />);

    expect(container.innerHTML).toBe('');
  });

  it('renders on the server with no browser API', () => {
    expect(renderToStaticMarkup(<Sparkline values={[1, 2]} />)).toContain('<polyline');
  });
});
