/**
 * The tidied area: each synonym merges, case and spaces fold, and a NULL
 * or blank area reads `no area`.
 */
import { describe, expect, it } from 'bun:test';

import { AREA_SYNONYMS, NO_AREA, tidyArea } from './areas.js';

describe('tidyArea', () => {
  it.each(Object.entries(AREA_SYNONYMS))('merges %s into %s', (spelling, area) => {
    expect(tidyArea(spelling)).toBe(area);
  });

  it('names the three synonyms the spec fixes', () => {
    expect(tidyArea('documentation')).toBe('docs');
    expect(tidyArea('testing')).toBe('tests');
    expect(tidyArea('effort store')).toBe('effort');
  });

  it('lower-cases a mixed-case spelling before merging', () => {
    expect(tidyArea('DocuMentation')).toBe('docs');
    expect(tidyArea('Internal')).toBe('internal');
  });

  it('trims surrounding spaces', () => {
    expect(tidyArea('  Testing \t')).toBe('tests');
  });

  it('keeps an area with no synonym as it is', () => {
    expect(tidyArea('loop')).toBe('loop');
  });

  it('answers no area for a NULL or blank area', () => {
    expect(tidyArea(null)).toBe(NO_AREA);
    expect(tidyArea(undefined)).toBe(NO_AREA);
    expect(tidyArea('   ')).toBe(NO_AREA);
    expect(NO_AREA).toBe('no area');
  });
});
