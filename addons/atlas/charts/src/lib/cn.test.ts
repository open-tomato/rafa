import { describe, expect, it } from 'bun:test';

import { cn } from './cn.js';

describe('cn', () => {
  it('joins class values and drops falsy ones', () => {
    expect(cn('p-2', false, undefined, 'text-ink')).toBe('p-2 text-ink');
  });

  it('lets the later of two conflicting Tailwind classes win', () => {
    expect(cn('p-2 bg-surface', 'p-4')).toBe('bg-surface p-4');
  });

  it('reads the token colour names as colours, so a later tone replaces an earlier one', () => {
    expect(cn('bg-series-1', 'bg-series-2')).toBe('bg-series-2');
  });
});
