import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'bun:test';

import { Tag } from './Tag.js';

describe('Tag', () => {
  it('is mono and neutral by default', () => {
    render(<Tag>agt_8x21</Tag>);
    const tag = screen.getByText('agt_8x21');

    expect(tag.className).toContain('font-mono');
    expect(tag.className).toContain('text-ink-2');
  });

  it('switches to the body face when an icon leads, and paints its tone', () => {
    render(<Tag tone="good" icon={<svg data-testid="icon" />}>verified</Tag>);
    const tag = screen.getByText('verified');

    expect(tag.className).toContain('font-sans');
    expect(tag.className).toContain('text-good');
    expect(screen.getByTestId('icon').parentElement).toBe(tag);
  });
});
