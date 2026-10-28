/**
 * Tests for `bless` and `promotable`: the ordering, the flagged and
 * promoted exclusions, and both thresholds.
 *
 * Each threshold case is paired with the case one step past it, so a
 * function that kept or dropped every record fails one of the two. The
 * exclusion cases carry a control record that is blessed, so an empty
 * answer cannot pass them.
 */

import type { InstinctRecord } from './types.js';

import { describe, expect, test } from 'bun:test';

import { bless, promotable } from './bless.js';
import { actionHash } from './identity.js';

/** The time every fixture record was written at. */
const EARLIER = '2026-09-20T08:00:00.000Z';

/** A record with the fields a case does not set. */
function record(id: string, confidence: number, extra: Partial<InstinctRecord> = {}): InstinctRecord {
  const action = `action of ${id}`;
  return {
    id,
    trigger: `trigger of ${id}`,
    action,
    action_hash: actionHash(action),
    confidence,
    usage_count: 1,
    signal: 'loud',
    status: 'active',
    created_at: EARLIER,
    updated_at: EARLIER,
    ...extra,
  };
}

/** The ids of `records`, in order. */
function ids(records: readonly InstinctRecord[]): string[] {
  return records.map((each) => each.id);
}

describe('bless ordering', () => {
  test('orders by confidence, highest first', () => {
    const held = [record('a', 0.6), record('b', 0.9), record('c', 0.7)];
    expect(ids(bless(held, { minConfidence: 0.5 }).instincts)).toEqual(['b', 'c', 'a']);
  });

  test('breaks a confidence tie by usage, highest first', () => {
    const held = [record('a', 0.7, { usage_count: 1 }), record('b', 0.7, { usage_count: 3 })];
    expect(ids(bless(held, { minConfidence: 0.5 }).instincts)).toEqual(['b', 'a']);
  });

  test('breaks a confidence and usage tie by id, in code-unit order', () => {
    const held = [record('b', 0.7), record('a', 0.7), record('B', 0.7)];
    expect(ids(bless(held, { minConfidence: 0.5 }).instincts)).toEqual(['B', 'a', 'b']);
  });

  test('reads a confidence tie in hundredths', () => {
    // 0.1 + 0.6 is 0.7 in hundredths but not as a float; usage decides.
    const held = [record('a', 0.7, { usage_count: 1 }), record('b', 0.1 + 0.6, { usage_count: 2 })];
    expect(ids(bless(held, { minConfidence: 0.5 }).instincts)).toEqual(['b', 'a']);
  });

  test('leaves the held list in its order', () => {
    const held = [record('a', 0.6), record('b', 0.9)];
    bless(held, { minConfidence: 0.5 });
    expect(ids(held)).toEqual(['a', 'b']);
  });
});

describe('bless exclusions', () => {
  test('leaves out a flagged record', () => {
    const held = [record('kept', 0.6), record('flagged', 0.9, { status: 'flagged' })];
    expect(ids(bless(held, { minConfidence: 0.5 }).instincts)).toEqual(['kept']);
  });

  test('leaves out a promoted record', () => {
    const held = [record('kept', 0.6), record('promoted', 0.9, { promoted_to: 'context/source.md' })];
    expect(ids(bless(held, { minConfidence: 0.5 }).instincts)).toEqual(['kept']);
  });
});

describe('bless threshold', () => {
  test('keeps a record at the floor and drops one a hundredth below it', () => {
    const held = [record('at', 0.5), record('below', 0.49)];
    expect(ids(bless(held, { minConfidence: 0.5 }).instincts)).toEqual(['at']);
  });

  test('compares with the floor in hundredths', () => {
    const confidence = 0.7 - 0.2;
    expect(confidence).toBeLessThan(0.5);
    expect(ids(bless([record('a', confidence)], { minConfidence: 0.5 }).instincts)).toEqual(['a']);
  });
});

describe('bless version', () => {
  test('answers one version for one blessed list, whatever the held order', () => {
    const first = bless([record('a', 0.6), record('b', 0.9)], { minConfidence: 0.5 });
    const second = bless([record('b', 0.9), record('a', 0.6)], { minConfidence: 0.5 });
    expect(first.version).toMatch(/^[0-9a-f]{64}$/);
    expect(second.version).toBe(first.version);
  });

  test('answers another version when the blessed list differs', () => {
    const first = bless([record('a', 0.6)], { minConfidence: 0.5 });
    const second = bless([record('a', 0.7)], { minConfidence: 0.5 });
    expect(second.version).not.toBe(first.version);
  });
});

describe('promotable', () => {
  const options = { after: 3, minConfidence: 0.7 };

  test('keeps a record at both thresholds and drops one under the usage threshold', () => {
    const held = [record('at', 0.7, { usage_count: 3 }), record('fewer', 0.9, { usage_count: 2 })];
    expect(ids(promotable(held, options))).toEqual(['at']);
  });

  test('drops a record a hundredth under the confidence threshold', () => {
    const held = [record('at', 0.7, { usage_count: 3 }), record('below', 0.69, { usage_count: 5 })];
    expect(ids(promotable(held, options))).toEqual(['at']);
  });

  test('leaves out a flagged record', () => {
    const held = [record('kept', 0.7, { usage_count: 3 }), record('flagged', 0.9, { usage_count: 5, status: 'flagged' })];
    expect(ids(promotable(held, options))).toEqual(['kept']);
  });

  test('leaves out a record already promoted', () => {
    const held = [
      record('kept', 0.7, { usage_count: 3 }),
      record('promoted', 0.9, { usage_count: 5, promoted_to: 'context/source.md' }),
    ];
    expect(ids(promotable(held, options))).toEqual(['kept']);
  });

  test('answers in bless order', () => {
    const held = [
      record('c', 0.8, { usage_count: 3 }),
      record('a', 0.9, { usage_count: 3 }),
      record('b', 0.8, { usage_count: 4 }),
    ];
    expect(ids(promotable(held, options))).toEqual(['a', 'b', 'c']);
  });
});
