import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'bun:test';

import { ChartSkeleton } from './ChartSkeleton.js';

describe('ChartSkeleton', () => {
  it('is a busy status region reading Loading, in a box of the chart height', () => {
    render(<ChartSkeleton kind="bars" height={180} />);
    const status = screen.getByRole('status');

    expect(status.textContent).toContain('Loading');
    expect(status.getAttribute('aria-busy')).toBe('true');
    expect(status.style.height).toBe('180px');
    expect(status.querySelectorAll('[aria-hidden="true"]').length).toBe(8);
  });

  it('fills its container under height fill, and draws each family', () => {
    const { rerender } = render(<ChartSkeleton kind="ring" height="fill" />);

    expect(screen.getByRole('status').style.height).toBe('100%');
    expect(screen.getByRole('status').querySelector('.rounded-full')).not.toBeNull();

    rerender(<ChartSkeleton kind="rows" />);
    expect(screen.getByRole('status').querySelectorAll('[aria-hidden="true"]').length).toBe(12);

    rerender(<ChartSkeleton kind="line" />);
    expect(screen.getByRole('status').querySelector('svg polyline')).not.toBeNull();
  });
});
