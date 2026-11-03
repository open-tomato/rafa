import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'bun:test';

import { formatSignedPercent, trendDirection } from './trend.js';
import { TrendIndicator } from './TrendIndicator.js';

describe('trend readings', () => {
  it('reads the direction off the sign and writes a signed percentage', () => {
    expect(trendDirection(0.1)).toBe('up');
    expect(trendDirection(-0.3)).toBe('down');
    expect(trendDirection(0)).toBe('flat');
    expect(formatSignedPercent(0.12)).toBe('+12%');
    expect(formatSignedPercent(-0.3)).toBe('-30%');
    expect(formatSignedPercent(0.153, 1)).toBe('+15.3%');
  });
});

describe('TrendIndicator', () => {
  it('names itself by the direction and value, and writes the value when asked', () => {
    render(<TrendIndicator trend={0.12} showValue />);
    const indicator = screen.getByRole('img', { name: 'trending up +12%' });

    expect(indicator.textContent).toBe('+12%');
    expect(indicator.className).toContain('text-good');
  });

  it('draws a muted dash on a flat trend, or nothing when told to hide it', () => {
    const { rerender } = render(<TrendIndicator trend={0} />);

    expect(screen.getByRole('img', { name: 'no change' }).className).toContain('text-muted');

    rerender(<TrendIndicator trend={0} showZero={false} />);

    expect(screen.queryByRole('img')).toBeNull();
  });
});
