import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'bun:test';

import { Swatch } from './Swatch.js';

describe('Swatch', () => {
  it('renders an image role named by its label', () => {
    render(<Swatch label="Opus" tone="series-2" />);

    expect(screen.getByRole('img', { name: 'Opus' })).toBeDefined();
  });

  it('paints the tone and size classes from its variants', () => {
    render(<Swatch label="Critical" tone="critical" size="lg" />);
    const swatch = screen.getByRole('img', { name: 'Critical' });

    expect(swatch.className).toContain('bg-critical');
    expect(swatch.className).toContain('size-5');
  });

  it('merges the passthrough class last', () => {
    render(<Swatch label="Layout" className="ml-2" />);

    expect(screen.getByRole('img', { name: 'Layout' }).className.endsWith('ml-2')).toBe(true);
  });
});
