import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'bun:test';

import { Badge } from './Badge.js';

describe('Badge', () => {
  it('paints the good tone and medium size by default, with a dot when asked', () => {
    render(<Badge dot>running</Badge>);
    const badge = screen.getByText('running');

    expect(badge.className).toContain('text-good');
    expect(badge.className).toContain('py-1');
    expect(badge.querySelector('span')?.className).toContain('bg-current');
  });

  it('paints the tone and size from its variants, the passthrough last', () => {
    render(<Badge tone="critical" size="sm" className="ml-2">failed</Badge>);
    const badge = screen.getByText('failed');

    expect(badge.className).toContain('text-critical');
    expect(badge.className).toContain('py-0.5');
    expect(badge.className.endsWith('ml-2')).toBe(true);
  });
});
