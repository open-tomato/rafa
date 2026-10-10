/**
 * Tests for `exit-codes.ts`: the code is the one the sibling refusals
 * carry, so a gate refusal reads alike whichever check threw it
 * (`src/commands/issue/edit-run.ts` relies on the three being one code).
 */
import { describe, expect, it } from 'bun:test';

import { BOARD_REFUSAL_EXIT } from './exit-codes.js';
import { LEAK_REFUSAL_EXIT } from './leak.js';
import { TRUST_REFUSAL_EXIT } from './trust.js';

describe('BOARD_REFUSAL_EXIT', () => {
  it('is 2, the code the trust and leak refusals carry too', () => {
    expect(BOARD_REFUSAL_EXIT).toBe(2);
    expect([TRUST_REFUSAL_EXIT, LEAK_REFUSAL_EXIT]).toEqual([BOARD_REFUSAL_EXIT, BOARD_REFUSAL_EXIT]);
  });
});
