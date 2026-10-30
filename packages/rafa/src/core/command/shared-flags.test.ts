/**
 * Tests for the flags commands of several features declare
 * (`packages/rafa/src/core/command/shared-flags.ts`).
 *
 * The hint flag's spec is held field by field, the description spelled
 * in full, since the help of six commands prints it and
 * `src/cli/help.test.ts` freezes that help; its freeze; and that its
 * name is the {@link HINT_FLAG} the hint reads (`packages/rafa-run/src/next/hint.ts`).
 * The CI default is held at 20, the minutes the help of `loop start`
 * and `pr wait` prints.
 */
import { describe, expect, it } from 'bun:test';

import { DEFAULT_CI_TIMEOUT_MIN, HINT_FLAG, HINT_FLAG_SPEC } from './shared-flags.js';

describe('the hint flag', () => {
  it('is named hint', () => {
    expect(HINT_FLAG).toBe('hint');
  });

  it('is declared as a boolean defaulting to true, which is what makes --no-hint read as false', () => {
    expect(HINT_FLAG_SPEC.name).toBe('hint');
    expect(HINT_FLAG_SPEC.type).toBe('boolean');
    expect(HINT_FLAG_SPEC.default).toBe(true);
    expect(HINT_FLAG_SPEC.description).toBe(
      'Ends by naming the one step that follows, asking it where there is a terminal to answer on;'
      + ' `--no-hint` reads nothing and prints nothing.',
    );
  });

  it('is frozen', () => {
    expect(Object.isFrozen(HINT_FLAG_SPEC)).toBe(true);
  });

  it('carries the name the hint reads', () => {
    expect(HINT_FLAG_SPEC.name).toBe(HINT_FLAG);
  });
});

describe('the CI default', () => {
  it('is twenty minutes', () => {
    expect(DEFAULT_CI_TIMEOUT_MIN).toBe(20);
  });
});
