/**
 * Tests for `sameActionGroups`: one action read across triggers, its
 * sources and confidence, the flagged exclusion, the cap, and the order
 * of members and groups.
 *
 * Each exclusion case carries a control the rule must keep, so an empty
 * answer cannot pass it, and the cap case sits beside one the cap does
 * not reach, so a function answering a constant fails one of the two.
 * One case pushes the same three sources through `merge` on one
 * trigger, so the group and the collapsed record are held to one
 * arithmetic rather than each to its own copy of it.
 */

import type { InstinctRecord } from './types.js';

import { describe, expect, test } from 'bun:test';

import { sameActionGroups } from './groups.js';
import { actionHash } from './identity.js';
import { merge } from './merge.js';

/** The time every fixture record was written at. */
const EARLIER = '2026-09-20T08:00:00.000Z';

/** The time a merge stamps. */
const NOW = '2026-09-21T08:00:00.000Z';

/** The action most cases share. */
const SHARED = 'write the list to a file and pipe it through xargs';

/** A record taking `action` under its own trigger, from one source named after it. */
function record(
  id: string,
  confidence: number,
  extra: Partial<InstinctRecord> = {},
  action = SHARED,
): InstinctRecord {
  return {
    id,
    trigger: `trigger of ${id}`,
    action,
    action_hash: actionHash(action),
    confidence,
    usage_count: 1,
    sources: [`session-${id}`],
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

describe('one action under several triggers', () => {
  test('reads three triggers from three sources at 0.5 as one group at 0.6', () => {
    const held = [record('a', 0.5), record('b', 0.5), record('c', 0.5)];

    const groups = sameActionGroups(held);

    expect(groups).toHaveLength(1);
    expect(groups[0]!.action_hash).toBe(actionHash(SHARED));
    expect(ids(groups[0]!.members)).toEqual(['a', 'b', 'c']);
    expect(groups[0]!.sources).toEqual(['session-a', 'session-b', 'session-c']);
    expect(groups[0]!.confidence).toBe(0.6);
  });

  test('reads what merge collapses the same three sources to on one trigger', () => {
    let held: InstinctRecord[] = [];
    for (const source of ['session-a', 'session-b', 'session-c']) {
      const pushed = record('pushed', 0.5, { trigger: 'one trigger', sources: undefined });
      held = merge(held, { source_id: source, instincts: [pushed] }, NOW).decisions[0]!.produced;
    }
    const acrossTriggers = sameActionGroups([record('a', 0.5), record('b', 0.5), record('c', 0.5)]);

    expect(held).toHaveLength(1);
    expect(acrossTriggers[0]!.confidence).toBe(held[0]!.confidence);
    expect(acrossTriggers[0]!.sources).toEqual(held[0]!.sources!);
  });

  test('takes a member\'s own source step off before the mean', () => {
    // 0.55 over two sources is 0.50 a source; with a third the union reads 0.60, not 0.62.
    const held = [record('a', 0.55, { sources: ['s1', 's2'], usage_count: 2 }), record('b', 0.5)];

    expect(sameActionGroups(held)[0]!.confidence).toBe(0.6);
  });

  test('counts a source two members share once', () => {
    const held = [record('a', 0.5, { sources: ['s1'] }), record('b', 0.5, { sources: ['s1'] })];

    const [group] = sameActionGroups(held);

    expect(group!.sources).toEqual(['s1']);
    expect(group!.confidence).toBe(0.5);
  });

  test('answers an action held under one trigger as a group of one', () => {
    const lone = record('a', 0.65, { sources: ['s1', 's2', 's3'], usage_count: 3 });

    const groups = sameActionGroups([lone]);

    expect(groups).toHaveLength(1);
    expect(groups[0]!.members).toEqual([lone]);
    expect(groups[0]!.named).toBe(lone);
    expect(groups[0]!.sources).toEqual(['s1', 's2', 's3']);
    expect(groups[0]!.confidence).toBe(0.65);
  });

  test('answers no group for an empty held set', () => {
    expect(sameActionGroups([])).toEqual([]);
  });
});

describe('a flagged member', () => {
  test('is left out of the members, the sources and the confidence', () => {
    const flagged = record('d', 0.9, { status: 'flagged', sources: ['session-d', 'session-e'] });
    const held = [record('a', 0.5), record('b', 0.5), record('c', 0.5), flagged];

    const [group] = sameActionGroups(held);

    expect(ids(group!.members)).toEqual(['a', 'b', 'c']);
    expect(group!.sources).toEqual(['session-a', 'session-b', 'session-c']);
    expect(group!.confidence).toBe(0.6);
    expect(group!.named.id).toBe('a');
  });

  test('answers no group for an action only flagged records take, beside one an active record takes', () => {
    const held = [
      record('flagged', 0.9, { status: 'flagged' }, 'a flagged action'),
      record('kept', 0.5, {}, 'a kept action'),
    ];

    const groups = sameActionGroups(held);

    expect(groups.map((group) => group.action_hash)).toEqual([actionHash('a kept action')]);
  });
});

describe('a record without sources', () => {
  test('counts as one source named by its own id', () => {
    const held = [record('a', 0.5), record('b', 0.5, { sources: undefined })];

    const [group] = sameActionGroups(held);

    expect(group!.sources).toEqual(['b', 'session-a']);
    expect(group!.confidence).toBe(0.55);
  });

  test('counts an empty sources list as its own id too', () => {
    const held = [record('a', 0.5), record('b', 0.5, { sources: [] })];

    expect(sameActionGroups(held)[0]!.sources).toEqual(['b', 'session-a']);
  });
});

describe('the cap', () => {
  test('caps three sources at 0.9 at CONFIDENCE_MAX rather than reading 1.0', () => {
    const held = [record('a', 0.9), record('b', 0.9), record('c', 0.9)];

    expect(sameActionGroups(held)[0]!.confidence).toBe(0.9);
  });

  test('leaves three sources at 0.7 stepped to 0.8, below the cap', () => {
    const held = [record('a', 0.7), record('b', 0.7), record('c', 0.7)];

    expect(sameActionGroups(held)[0]!.confidence).toBe(0.8);
  });
});

describe('ordering', () => {
  test('orders members by confidence, then usage, then id, and names the first', () => {
    const held = [
      record('d', 0.5, { usage_count: 1 }),
      record('c', 0.5, { usage_count: 2, sources: ['session-c', 'session-x'] }),
      record('b', 0.6),
      record('a', 0.5, { usage_count: 1 }),
    ];

    const [group] = sameActionGroups(held);

    expect(ids(group!.members)).toEqual(['b', 'c', 'a', 'd']);
    expect(group!.named.id).toBe('b');
  });

  test('orders groups by confidence, then source count, then the named id', () => {
    const held = [
      // One source at 0.6: confidence 0.60, one source.
      record('lone', 0.6, {}, 'lone action'),
      // Three sources at 0.5: confidence 0.60, three sources.
      record('wide-a', 0.5, {}, 'wide action'),
      record('wide-b', 0.5, {}, 'wide action'),
      record('wide-c', 0.5, {}, 'wide action'),
      // One source at 0.6 named 'early': ties 'lone' on both, named first.
      record('early', 0.6, {}, 'early action'),
      // One source at 0.7: the highest confidence.
      record('top', 0.7, {}, 'top action'),
    ];

    const named = sameActionGroups(held).map((group) => group.named.id);

    expect(named).toEqual(['top', 'wide-a', 'early', 'lone']);
  });

  test('compares member confidences in whole hundredths', () => {
    // 0.8 - 0.1 is 0.7000000000000001: above 0.7 as a float, 0.70 in
    // hundredths, so usage decides and the float order would not.
    const held = [
      record('a', 0.8 - 0.1),
      record('b', 0.7, { sources: ['s1', 's2'], usage_count: 2 }),
    ];

    expect(ids(sameActionGroups(held)[0]!.members)).toEqual(['b', 'a']);
  });
});

describe('the records passed in', () => {
  test('are left as they were, in their order', () => {
    const held = [record('b', 0.5), record('a', 0.6, { status: 'flagged' }), record('c', 0.5)];
    const before = JSON.stringify(held);

    sameActionGroups(held);

    expect(JSON.stringify(held)).toBe(before);
  });
});
