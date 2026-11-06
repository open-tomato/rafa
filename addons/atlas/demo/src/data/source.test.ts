/**
 * The page source: 'past-month' is the bake-off's mock, every range draws
 * a different set, and the source answers the range it was asked.
 */
import { TIME_RANGES } from '@open-tomato/atlas-ui';
import { describe, expect, it } from 'bun:test';

import { BALANCE_CATALOGUE } from './balance.js';
import { buildMock, MOCK_SEEDS } from './mock.js';
import { createLensSource, lensResultOf, seedsOf } from './source.js';

describe('lensResultOf', () => {
  it('draws past-month with the bake-off seeds and catalogue', () => {
    const result = lensResultOf('past-month');

    expect(seedsOf('past-month')).toEqual(MOCK_SEEDS);
    expect(result.mock).toEqual(buildMock(MOCK_SEEDS));
    expect(result.balance).toBe(BALANCE_CATALOGUE);
  });

  it('draws a different set for each range', () => {
    const series = TIME_RANGES.map((range) => JSON.stringify(lensResultOf(range).mock.tokensPerDay));
    const balances = TIME_RANGES.map((range) => JSON.stringify(lensResultOf(range).balance.map((index) => index.value)));

    expect(new Set(series).size).toBe(TIME_RANGES.length);
    expect(new Set(balances).size).toBe(TIME_RANGES.length);
  });

  it('keeps the frame of the mock in every range: twelve weeks of days, seven weekdays of halts', () => {
    for (const range of TIME_RANGES) {
      const { mock } = lensResultOf(range);

      expect(mock.tokensPerDay).toHaveLength(84);
      expect(mock.preflightHalts).toHaveLength(7);
    }
  });
});

describe('createLensSource', () => {
  it('answers the range it was asked', async () => {
    const result = await createLensSource(0)('last-week');

    expect(result.range).toBe('last-week');
    expect(result.mock).toEqual(lensResultOf('last-week').mock);
  });
});
