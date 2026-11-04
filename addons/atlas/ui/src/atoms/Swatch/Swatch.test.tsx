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

  it('draws a pole tone as a circle', () => {
    render(<Swatch label="Shipping" tone="pole-ship-core" shape="circle" />);
    const swatch = screen.getByRole('img', { name: 'Shipping' });

    expect(swatch.className).toContain('bg-pole-ship-core');
    expect(swatch.className).toContain('rounded-full');
  });

  it('is decorative without a label', () => {
    const { container } = render(<Swatch tone="good" />);

    expect(screen.queryByRole('img')).toBeNull();
    expect(container.firstElementChild?.getAttribute('aria-hidden')).toBe('true');
  });

  it('merges the passthrough class last', () => {
    render(<Swatch label="Layout" className="ml-2" />);

    expect(screen.getByRole('img', { name: 'Layout' }).className.endsWith('ml-2')).toBe(true);
  });
});
