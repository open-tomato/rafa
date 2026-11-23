/**
 * Tests for `kindsOf`: the mock's rows keep the fixed list as it is, and
 * a live answer's groups keep the known ones in order and add the others
 * with a free tone.
 */
import type { Kind } from '../data/mock.js';

import { describe, expect, it } from 'bun:test';

import { BUG_KINDS } from '../data/mock.js';

import { kindsOf } from './kinds.js';

const KNOWN: readonly Kind[] = [
  { id: 'bug', label: 'bug', tone: 'series-1' },
  { id: 'docs', label: 'docs', tone: 'series-5' },
];

describe('kindsOf', () => {
  it('answers the known list as it is when every row names each kind', () => {
    const rows = [Object.fromEntries(BUG_KINDS.map((kind) => [kind.id, 1]))];

    expect(kindsOf(rows, BUG_KINDS)).toEqual(BUG_KINDS);
  });

  it('keeps the known kinds named, in their order, then adds the others with the first free tone', () => {
    const rows: readonly Readonly<Record<string, number>>[] = [{ machine: 1, docs: 2 }, { unknown: 1, docs: 0 }];

    expect(kindsOf(rows, KNOWN)).toEqual([
      { id: 'docs', label: 'docs', tone: 'series-5' },
      { id: 'machine', label: 'machine', tone: 'series-1' },
      { id: 'unknown', label: 'unknown', tone: 'series-2' },
    ]);
  });

  it('tones a group past the eighth series tone muted', () => {
    const ids = Array.from({ length: 9 }, (_, index) => `g${index}`);
    const kinds = kindsOf([Object.fromEntries(ids.map((id) => [id, 1]))], []);

    expect(kinds.map((kind) => kind.tone).at(-1)).toBe('muted');
    expect(kinds.at(-2)?.tone).toBe('series-8');
  });

  it('answers no kind for no row', () => {
    expect(kindsOf([], KNOWN)).toEqual([]);
  });
});
