import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'bun:test';

import { Content } from './Content.js';

describe('Content', () => {
  it('stacks children in a column with the medium gap by default', () => {
    render(<Content><span>one</span></Content>);
    const stack = screen.getByText('one').parentElement;

    expect(stack?.className).toContain('flex-col');
    expect(stack?.className).toContain('gap-3');
    expect(stack?.className).toContain('flex-nowrap');
  });

  it('paints a wrapping row with its alignment and distribution', () => {
    render(<Content direction="row" wrap align="center" justify="between"><span>one</span></Content>);
    const stack = screen.getByText('one').parentElement;

    expect(stack?.className).toContain('flex-row');
    expect(stack?.className).toContain('flex-wrap');
    expect(stack?.className).toContain('items-center');
    expect(stack?.className).toContain('justify-between');
  });
});
