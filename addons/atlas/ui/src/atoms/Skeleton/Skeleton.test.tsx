import { render } from '@testing-library/react';
import { describe, expect, it } from 'bun:test';

import { Skeleton } from './Skeleton.js';

describe('Skeleton', () => {
  it('is a hidden shimmering line by default', () => {
    const { container } = render(<Skeleton />);
    const skeleton = container.firstElementChild;

    expect(skeleton?.getAttribute('aria-hidden')).toBe('true');
    expect(skeleton?.className).toContain('animate-shimmer');
    expect(skeleton?.className).toContain('rounded-full');
    expect(skeleton?.className).toContain('h-3');
  });

  it('paints its shape, width and height from the variants', () => {
    const { container } = render(<Skeleton shape="block" width="half" height="value" />);
    const skeleton = container.firstElementChild;

    expect(skeleton?.className).toContain('rounded-md');
    expect(skeleton?.className).toContain('w-[55%]');
    expect(skeleton?.className).toContain('h-9');
  });
});
