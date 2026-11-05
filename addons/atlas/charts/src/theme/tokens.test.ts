import { describe, expect, it } from 'bun:test';

import { POLE_TOKENS, SERIES_TOKENS, THEME_TOKENS, tokenName, tokenNames, tokenVar } from './tokens.js';

describe('the theme token names', () => {
  it('names each token once', () => {
    expect(new Set(THEME_TOKENS).size).toBe(THEME_TOKENS.length);
  });

  it('names Tailwind colour tokens only', () => {
    const outside = THEME_TOKENS.filter((token) => !/^--color-[a-z0-9-]+$/.test(token));

    expect(outside).toEqual([]);
  });

  it('holds eight series colours', () => {
    expect(SERIES_TOKENS).toHaveLength(8);
  });

  it('wraps a token in var()', () => {
    expect(tokenVar('--color-series-3')).toBe('var(--color-series-3)');
  });

  it('drops the colour prefix from a token name', () => {
    expect(tokenName('--color-series-3')).toBe('series-3');
  });

  it('names a list of tokens in order', () => {
    expect(tokenNames(POLE_TOKENS)).toEqual([
      'pole-ship', 'pole-ship-core', 'pole-fail', 'pole-fail-core', 'pole-base', 'pole-base-core',
    ]);
  });
});
