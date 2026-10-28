/**
 * Tests for the merge methods (`merge-method.ts`): the list GitHub's
 * three flags make, frozen, and the guard that accepts exactly them.
 *
 * The type is held by the compiled probes of `packages/rafa/src/pr/types.test.ts`,
 * which read it through the port's re-export.
 */
import { describe, expect, it } from 'bun:test';

import { isMergeMethod, MERGE_METHODS } from './merge-method.js';

describe('MERGE_METHODS', () => {
  it('holds GitHub three merge flags, in the order a refusal lists them', () => {
    expect(MERGE_METHODS).toEqual(['squash', 'merge', 'rebase']);
  });

  it('is frozen, so a caller cannot change what is accepted', () => {
    expect(Object.isFrozen(MERGE_METHODS)).toBe(true);
  });
});

describe('isMergeMethod', () => {
  it.each([...MERGE_METHODS])('accepts %s', (method) => {
    expect(isMergeMethod(method)).toBe(true);
  });

  it.each([
    ['a method GitHub has no flag for', 'ff'],
    ['another case of one it has', 'Squash'],
    ['an empty string', ''],
    ['a string with space around a method', ' squash '],
    ['a number', 1],
    ['null', null],
    ['undefined', undefined],
    ['an array holding a method', ['squash']],
  ])('refuses %s', (_label, value) => {
    expect(isMergeMethod(value)).toBe(false);
  });
});
