/**
 * Tests for the flags every command reads
 * (`packages/rafa/src/core/command/global-flags.ts`).
 *
 * The four spellings are held in order, since the root help lists them
 * in this order and `src/cli/help.test.ts` freezes that help, and each
 * row carries a note. The array is held frozen, so no reader can add a
 * flag the help would then list.
 */
import { describe, expect, it } from 'bun:test';

import { GLOBAL_FLAGS } from './global-flags.js';

describe('the global flags', () => {
  it('spells the four flags in the order the root help lists them', () => {
    expect(GLOBAL_FLAGS.map((flag) => flag.spelling)).toEqual([
      '--output=json',
      '--output=events',
      '-v, --verbose',
      '--version',
    ]);
  });

  it('gives each flag a note', () => {
    for (const flag of GLOBAL_FLAGS) {
      expect([flag.spelling, flag.note.length > 0]).toEqual([flag.spelling, true]);
    }
  });

  it('is frozen', () => {
    expect(Object.isFrozen(GLOBAL_FLAGS)).toBe(true);
  });
});
