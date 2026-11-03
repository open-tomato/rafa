import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'bun:test';

import { GridItem } from './GridItem.js';

describe('GridItem', () => {
  it('spans one column and aligns itself by default', () => {
    render(<GridItem><span>tile</span></GridItem>);
    const item = screen.getByText('tile').parentElement;

    expect(item?.className).toContain('col-span-1');
    expect(item?.className).toContain('self-auto');
  });

  it('paints the span and alignment from its variants', () => {
    render(<GridItem span="full" align="center"><span>tile</span></GridItem>);
    const item = screen.getByText('tile').parentElement;

    expect(item?.className).toContain('col-span-full');
    expect(item?.className).toContain('self-center');
  });
});
