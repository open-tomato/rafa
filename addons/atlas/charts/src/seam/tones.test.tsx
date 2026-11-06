import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'bun:test';

import { THEME_ATTRIBUTE, THEME_TOKENS } from '../theme/index.js';

import {
  ALL_TONES,
  CHROME_ROLES,
  chartTone,
  readTokens,
  SEQUENTIAL_STEPS,
  toneVar,
} from './tones.js';
import { useResolvedTokens } from './useResolvedTokens.js';

const root = document.documentElement;

afterEach(() => {
  // Unmount first, so resetting the page does not wake a mounted observer.
  cleanup();
  root.removeAttribute('style');
  root.removeAttribute(THEME_ATTRIBUTE);
});

describe('the tone lists', () => {
  it('lists every series, status and pole token once, then the two neutrals', () => {
    expect(ALL_TONES).toHaveLength(20);
    expect(new Set(ALL_TONES).size).toBe(ALL_TONES.length);
    expect(ALL_TONES.slice(-2)).toEqual(['neutral', 'muted']);
  });

  it('reads the sequential ramp from the theme, without the diverging midpoint', () => {
    expect(SEQUENTIAL_STEPS).toEqual(['seq-100', 'seq-200', 'seq-300', 'seq-400', 'seq-500', 'seq-600', 'seq-700']);
  });

  it('reads the chrome roles from the theme', () => {
    expect(CHROME_ROLES).toEqual(['surface', 'plane', 'ink', 'ink-2', 'muted', 'grid', 'baseline', 'ring']);
  });

  it('names only tokens the theme lists', () => {
    const named = new Set(THEME_TOKENS.map((token) => token.replace('--color-', '')));
    const outside = [...ALL_TONES.filter((tone) => tone !== 'neutral'), ...SEQUENTIAL_STEPS, ...CHROME_ROLES].filter((name) => !named.has(name));

    expect(outside).toEqual([]);
  });

  it('has a chartTone class for every tone', () => {
    for (const tone of ALL_TONES) {
      expect(chartTone({ tone })).toMatch(/^text-/);
    }
  });

  it('reads neutral as ink-2 in the class and in the variable', () => {
    expect(chartTone({ tone: 'neutral' })).toBe('text-ink-2');
    expect(toneVar('neutral')).toBe('var(--color-ink-2)');
  });
});

describe('toneVar', () => {
  it('wraps a tone or a chrome role in its token variable', () => {
    expect(toneVar('series-2')).toBe('var(--color-series-2)');
    expect(toneVar('grid')).toBe('var(--color-grid)');
  });
});

describe('the token bridge', () => {
  it('reads each tone and token from the computed style of the page', () => {
    root.style.setProperty('--color-series-1', ' #2a78d6 ');
    root.style.setProperty('--color-ink-2', '#52514e');
    const tokens = readTokens();

    expect(tokens['series-1']).toBe('#2a78d6');
    expect(tokens['neutral']).toBe('#52514e');
    expect(tokens['ink-2']).toBe('#52514e');
  });

  it('reads a name the theme leaves undefined as an empty string', () => {
    expect(readTokens()['series-3']).toBe('');
  });

  it('re-reads when the theme attribute flips', async () => {
    root.style.setProperty('--color-ink', '#000000');
    const { result } = renderHook(() => useResolvedTokens());

    expect(result.current['ink']).toBe('#000000');

    await act(async () => {
      root.style.setProperty('--color-ink', '#ffffff');
      root.setAttribute(THEME_ATTRIBUTE, 'dark');
      // The observer reports in a later task than the mutation.
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(result.current['ink']).toBe('#ffffff');
  });

  it('keeps the same object when the attribute is written but no colour changed', async () => {
    root.style.setProperty('--color-ink', '#000000');
    const { result } = renderHook(() => useResolvedTokens());
    const before = result.current;

    await act(async () => {
      root.setAttribute(THEME_ATTRIBUTE, 'light');
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(result.current).toBe(before);
  });
});
