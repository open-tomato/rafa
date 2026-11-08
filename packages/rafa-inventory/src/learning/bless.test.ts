/**
 * Tests for `bless` and `promotable`: the ordering, the flagged and
 * promoted exclusions, both thresholds, and `promotable`'s reading of
 * one action under several triggers as one same-action group.
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

/** `count` distinct sources, named after `id`, as many tasks push them. */
function sourcesFrom(id: string, count: number): string[] {
  return Array.from({ length: count }, (_, index) => `${id}-session-${String(index + 1)}`);
}

/** A record confirmed by `count` distinct sources, its usage their number. */
function confirmed(id: string, confidence: number, count: number, extra: Partial<InstinctRecord> = {}): InstinctRecord {
  return record(id, confidence, { usage_count: count, sources: sourcesFrom(id, count), ...extra });
}

describe('promotable', () => {
  const options = { after: 3, minConfidence: 0.7 };

  test('keeps a record at both thresholds and drops one under the source threshold', () => {
    const held = [confirmed('at', 0.7, 3), confirmed('fewer', 0.9, 2)];
    expect(ids(promotable(held, options))).toEqual(['at']);
  });

  test('counts distinct sources, not usage: a record naming none is one source', () => {
    const held = [confirmed('at', 0.7, 3), record('sourceless', 0.9, { usage_count: 5 })];
    expect(ids(promotable(held, options))).toEqual(['at']);
  });

  test('drops a record a hundredth under the confidence threshold', () => {
    const held = [confirmed('at', 0.7, 3), confirmed('below', 0.69, 5)];
    expect(ids(promotable(held, options))).toEqual(['at']);
  });

  test('leaves out a flagged record', () => {
    const held = [confirmed('kept', 0.7, 3), confirmed('flagged', 0.9, 5, { status: 'flagged' })];
    expect(ids(promotable(held, options))).toEqual(['kept']);
  });

  test('leaves out a record already promoted', () => {
    const held = [
      confirmed('kept', 0.7, 3),
      confirmed('promoted', 0.9, 5, { promoted_to: 'context/source.md' }),
    ];
    expect(ids(promotable(held, options))).toEqual(['kept']);
  });

  test('answers the most trusted first: confidence, then source count, then id', () => {
    const held = [confirmed('c', 0.8, 3), confirmed('a', 0.9, 3), confirmed('b', 0.8, 4)];
    expect(ids(promotable(held, options))).toEqual(['a', 'b', 'c']);
  });
});

/** The action every wording of the grouped lesson takes. */
const SHARED_ACTION = 'Pipe the list through xargs.';

/** One wording of {@link SHARED_ACTION}: its own trigger, pushed by `source`. */
function wording(id: string, source: string, confidence: number, extra: Partial<InstinctRecord> = {}): InstinctRecord {
  return record(id, confidence, {
    action: SHARED_ACTION,
    action_hash: actionHash(SHARED_ACTION),
    sources: [source],
    ...extra,
  });
}

/** One action under three triggers, each from its own session at 0.5. */
function threeWordings(): InstinctRecord[] {
  return [
    wording('w-c', 'session-c', 0.5),
    wording('w-a', 'session-a', 0.5),
    wording('w-b', 'session-b', 0.5),
  ];
}

describe('promotable over same-action groups', () => {
  test('names one action under three triggers from three sessions once at after 3, minConfidence 0.6', () => {
    const held = threeWordings();
    expect(ids(promotable(held, { after: 3, minConfidence: 0.6 }))).toEqual(['w-a']);
    // Control: no wording meets the floor alone, so the group's pooled 0.6 passed it.
    expect(bless(held, { minConfidence: 0.6 }).instincts).toEqual([]);
  });

  test('refuses the same group at minConfidence 0.7', () => {
    expect(promotable(threeWordings(), { after: 3, minConfidence: 0.7 })).toEqual([]);
  });

  test('neither counts nor answers a flagged fourth wording', () => {
    const fourth = wording('w-d', 'session-d', 0.9, { status: 'flagged' });
    const held = [...threeWordings(), fourth];
    expect(promotable(held, { after: 4, minConfidence: 0.6 })).toEqual([]);
    expect(promotable(held, { after: 3, minConfidence: 0.7 })).toEqual([]);
    expect(ids(promotable(held, { after: 3, minConfidence: 0.6 }))).toEqual(['w-a']);
    // Control: the same fourth wording unflagged is counted, lifts the group and is named.
    const counted = [...threeWordings(), { ...fourth, status: 'active' as const }];
    expect(ids(promotable(counted, { after: 4, minConfidence: 0.7 }))).toEqual(['w-d']);
  });

  test('answers a single-trigger record three sources confirmed', () => {
    const single = record('single', 0.6, { usage_count: 3, sources: ['session-a', 'session-b', 'session-c'] });
    expect(ids(promotable([single], { after: 3, minConfidence: 0.6 }))).toEqual(['single']);
    // Control: one source short of after answers nothing.
    const short = { ...single, usage_count: 2, sources: ['session-a', 'session-b'] };
    expect(promotable([short], { after: 3, minConfidence: 0.6 })).toEqual([]);
  });
});
