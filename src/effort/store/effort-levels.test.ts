/**
 * Tests for the effort levels (`src/effort/store/effort-levels.ts`).
 *
 * The case imports its own module and nothing of the declaration parser
 * that re-exports it.
 */

import type { EffortLevel } from './effort-levels.js';

import { describe, expect, it } from 'bun:test';

import { EFFORT_LEVELS } from './effort-levels.js';

describe('EFFORT_LEVELS', () => {
  it('lists the five levels the CLI accepts, lowest first', () => {
    expect([...EFFORT_LEVELS]).toEqual(['low', 'medium', 'high', 'xhigh', 'max']);
  });

  it('types a listed level as an EffortLevel', () => {
    const level: EffortLevel = EFFORT_LEVELS[3];
    expect(level).toBe('xhigh');
  });
});
