import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'bun:test';

import { Progress } from './Progress.js';

describe('Progress', () => {
  it('renders a progress bar whose fill width is the clamped value', () => {
    render(<Progress value={134} label="Token budget" />);
    const bar = screen.getByRole('progressbar', { name: 'Token budget' });

    expect(bar.getAttribute('aria-valuenow')).toBe('100');
    expect(bar.querySelector('rect')?.getAttribute('width')).toBe('100%');
  });

  it('inks the fill by tone and sweeps while indeterminate, with no value', () => {
    render(<Progress indeterminate tone="critical" label="Working" />);
    const bar = screen.getByRole('progressbar', { name: 'Working' });
    const fill = bar.querySelector('rect');

    expect(bar.getAttribute('aria-valuenow')).toBeNull();
    expect(fill?.getAttribute('class')).toContain('text-critical');
    expect(fill?.getAttribute('class')).toContain('animate-indeterminate');
  });
});
