import { describe, expect, it } from 'bun:test';

import { closestNames, editDistance } from './closest.js';

describe('the names closest to a value', () => {
  it.each([
    ['loop', 'loop', 0],
    ['loop', 'loops', 1],
    ['', 'abc', 3],
    ['abc', '', 3],
    ['kitten', 'sitting', 3],
  ])('counts %p to %p as %p edits', (a, b, edits) => {
    expect(editDistance(a, b)).toBe(edits);
  });

  it('answers the nearest first, none further than half the value', () => {
    expect(closestNames('bilin', ['auth', 'billing', 'loop', 'building'])).toEqual(['billing']);
    expect(closestNames('billin', ['auth', 'building', 'billing'])).toEqual(['billing', 'building']);
    expect(closestNames('zzzzzz', ['auth', 'billing'])).toEqual([]);
  });

  it('answers three at most, by name where the edits tie', () => {
    expect(closestNames('a', ['e', 'd', 'c', 'b'])).toEqual(['b', 'c', 'd']);
    expect(closestNames('a', ['e', 'd', 'c', 'b'], 1)).toEqual(['b']);
  });

  it('leaves the names it was handed in their order', () => {
    const names = ['e', 'd', 'c', 'b'];
    closestNames('a', names);
    expect(names).toEqual(['e', 'd', 'c', 'b']);
  });
});
