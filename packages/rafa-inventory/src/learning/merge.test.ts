/**
 * Tests for `merge`: one case per merge rule, the spec's
 * definition-of-done numbers, the two-decimal gap comparison and the
 * cap.
 *
 * Each boundary case is paired with the case one hundredth past it, so
 * a merge that answered one rule for every input fails one of the two.
 * The two-decimal case also asserts that the plain float difference is
 * over the gap, which is what makes it a case at all.
 */

import type { InstinctRecord, MergeResult, SyncPayload } from './types.js';

import { describe, expect, test } from 'bun:test';

import { GAP, actionHash, triggerKey } from './identity.js';
import { merge } from './merge.js';

/** The time every case merges at. */
const NOW = '2026-09-25T12:00:00.000Z';

/** The time every fixture record was written at. */
const EARLIER = '2026-09-20T08:00:00.000Z';

/** The trigger most cases share. */
const TRIGGER = 'when running bun test under a fresh worktree';

/** A record on {@link TRIGGER}, with the fields a case does not set. */
function record(id: string, action: string, confidence: number, extra: Partial<InstinctRecord> = {}): InstinctRecord {
  return {
    id,
    trigger: TRIGGER,
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

/** One source's payload. */
function payload(sourceId: string, ...instincts: InstinctRecord[]): SyncPayload {
  return { source_id: sourceId, instincts };
}

/**
 * What the held set is after `result`: every held record on a trigger
 * no decision touched, then each touched trigger's `produced`.
 */
function heldAfter(held: readonly InstinctRecord[], result: MergeResult): InstinctRecord[] {
  const produced = new Map(result.decisions.map((decision) => [triggerKey(decision.incoming.trigger), decision.produced]));
  const untouched = held.filter((each) => !produced.has(triggerKey(each.trigger)));
  return [...untouched, ...[...produced.values()].flat()];
}

describe('new-trigger', () => {
  test('keeps a record on a trigger nothing held, joining the payload\'s source', () => {
    const pushed = record('a', 'run bun install first', 0.5);
    const result = merge([], payload('s1', pushed), NOW);

    expect(result.decisions).toEqual([{
      incoming: pushed,
      rule: 'new-trigger',
      produced: [{ ...pushed, sources: ['s1'], usage_count: 1 }],
    }]);
    expect(result.discarded).toEqual([]);
  });

  test('leaves the held records of other triggers out of the decision', () => {
    const other = { ...record('h', 'use a scratch tsconfig', 0.7), trigger: 'when tsc skips tests' };
    const pushed = record('a', 'run bun install first', 0.5);
    const result = merge([other], payload('s1', pushed), NOW);

    expect(result.decisions[0]!.rule).toBe('new-trigger');
    expect(result.decisions[0]!.produced.map((each) => each.id)).toEqual(['a']);
  });
});

describe('same-action', () => {
  test('two sources at 0.5 on one action give one record at 0.55 with usage_count 2', () => {
    const first = merge([], payload('s1', record('a', 'run bun install first', 0.5)), NOW);
    const held = heldAfter([], first);
    const second = merge(held, payload('s2', record('b', 'Run bun install first  ', 0.5)), NOW);

    expect(second.decisions[0]!.rule).toBe('same-action');
    expect(second.decisions[0]!.produced).toHaveLength(1);
    expect(second.decisions[0]!.produced[0]).toMatchObject({
      id: 'a',
      confidence: 0.55,
      usage_count: 2,
      sources: ['s1', 's2'],
      status: 'active',
      updated_at: NOW,
    });
    expect(second.discarded).toEqual([]);
  });

  test('weights each member by the sources it brings', () => {
    const held = [record('a', 'run bun install first', 0.65, { sources: ['s1', 's2'], usage_count: 2 })];
    const result = merge(held, payload('s3', record('b', 'run bun install first', 0.9)), NOW);

    // The held pair stands at 0.60 before its step: (0.60 * 2 + 0.90) / 3 + 0.10.
    expect(result.decisions[0]!.produced[0]).toMatchObject({ confidence: 0.8, usage_count: 3 });
  });

  test('adds the step once per source beyond the first, however many pushes it took', () => {
    const action = 'run bun install first';
    const one = heldAfter([], merge([], payload('s1', record('a', action, 0.5)), NOW));
    const two = heldAfter(one, merge(one, payload('s2', record('b', action, 0.5)), NOW));
    const three = merge(two, payload('s3', record('c', action, 0.5)), NOW);

    // Averaging 0.55 and 0.5 as they stand would give 0.63.
    expect(three.decisions[0]!.produced[0]).toMatchObject({ confidence: 0.6, usage_count: 3 });
  });

  test('counts a source that already confirmed the action once', () => {
    const held = [record('a', 'run bun install first', 0.5, { sources: ['s1'] })];
    const result = merge(held, payload('s1', record('b', 'run bun install first', 0.5)), NOW);

    expect(result.decisions[0]!.rule).toBe('same-action');
    expect(result.decisions[0]!.produced).toEqual(held);
  });

  test('keeps the oldest member\'s identity whichever was pushed first', () => {
    const older = record('z-old', 'run bun install first', 0.5, { created_at: '2026-09-01T00:00:00.000Z' });
    const newer = record('a-new', 'run bun install first', 0.5, { artifact: 'Cannot find package' });

    const oldHeld = merge([{ ...older, sources: ['s1'] }], payload('s2', newer), NOW);
    const newHeld = merge([{ ...newer, sources: ['s2'] }], payload('s1', older), NOW);

    expect(oldHeld.decisions[0]!.produced).toEqual(newHeld.decisions[0]!.produced);
    expect(oldHeld.decisions[0]!.produced[0]).toMatchObject({
      id: 'z-old',
      created_at: '2026-09-01T00:00:00.000Z',
      artifact: 'Cannot find package',
    });
  });

  test('counts a held record without sources as one source named by its id', () => {
    const held = [record('legacy', 'run bun install first', 0.5)];
    const result = merge(held, payload('s1', record('b', 'run bun install first', 0.5)), NOW);

    expect(result.decisions[0]!.produced[0]).toMatchObject({
      confidence: 0.55,
      usage_count: 2,
      sources: ['legacy', 's1'],
    });
  });

  test('meets a held record whose trigger differs only in case and whitespace', () => {
    const held = [{ ...record('a', 'run bun install first', 0.5, { sources: ['s1'] }), trigger: `  ${TRIGGER.toUpperCase()}` }];
    const pushed = { ...record('b', 'run bun install first', 0.5), trigger: TRIGGER.replace(' ', '\t\t') };
    const result = merge(held, payload('s2', pushed), NOW);

    expect(result.decisions[0]!.rule).toBe('same-action');
    expect(result.decisions[0]!.produced).toHaveLength(1);
  });
});

describe('the cap', () => {
  test('stops a same-action confidence at 0.9', () => {
    const held = [record('a', 'run bun install first', 0.9, { sources: ['s1'] })];
    const result = merge(held, payload('s2', record('b', 'run bun install first', 0.9)), NOW);

    expect(result.decisions[0]!.produced[0]).toMatchObject({ confidence: 0.9, usage_count: 2 });
  });

  test('leaves a confidence the step keeps under it', () => {
    const held = [record('a', 'run bun install first', 0.8, { sources: ['s1'] })];
    const result = merge(held, payload('s2', record('b', 'run bun install first', 0.8)), NOW);

    expect(result.decisions[0]!.produced[0]).toMatchObject({ confidence: 0.85, usage_count: 2 });
  });
});

describe('higher-confidence', () => {
  test('0.5 against 0.8 discards the 0.5 action', () => {
    const low = record('low', 'run bun install first', 0.5, { sources: ['s1'] });
    const high = record('high', 'copy node_modules from main', 0.8);
    const result = merge([low], payload('s2', high), NOW);

    expect(result.decisions[0]!.rule).toBe('higher-confidence');
    expect(result.decisions[0]!.produced).toEqual([{ ...high, sources: ['s2'], usage_count: 1, updated_at: NOW }]);
    expect(result.discarded).toEqual([low]);
  });

  test('discards an incoming action more than the gap below the held one', () => {
    const high = record('high', 'copy node_modules from main', 0.8, { sources: ['s1'] });
    const low = record('low', 'run bun install first', 0.5);
    const result = merge([high], payload('s2', low), NOW);

    expect(result.decisions[0]!.rule).toBe('higher-confidence');
    expect(result.decisions[0]!.produced).toEqual([high]);
    expect(result.discarded.map((each) => each.id)).toEqual(['low']);
  });

  test('measures every action against the leader, not against its neighbour', () => {
    const held = [
      record('lead', 'copy node_modules from main', 0.8, { sources: ['s1'] }),
      record('near', 'run bun install first', 0.72, { sources: ['s2'] }),
    ];
    const result = merge(held, payload('s3', record('far', 'reinstall bun', 0.65)), NOW);

    // 0.65 is within the gap of 0.72, and 0.15 below the leader.
    expect(result.discarded.map((each) => each.id)).toEqual(['far']);
    expect(result.decisions[0]!.produced.map((each) => [each.id, each.status])).toEqual([
      ['lead', 'flagged'],
      ['near', 'flagged'],
    ]);
  });
});

describe('flagged', () => {
  test('0.5 against 0.55 flags both', () => {
    const held = [record('low', 'run bun install first', 0.5, { sources: ['s1'] })];
    const result = merge(held, payload('s2', record('high', 'copy node_modules from main', 0.55)), NOW);

    expect(result.decisions[0]!.rule).toBe('flagged');
    expect(result.decisions[0]!.produced.map((each) => [each.id, each.confidence, each.status])).toEqual([
      ['high', 0.55, 'flagged'],
      ['low', 0.5, 'flagged'],
    ]);
    expect(result.discarded).toEqual([]);
    expect(result.decisions[0]!.produced.every((each) => each.updated_at === NOW)).toBe(true);
  });

  test('flags an exact tie', () => {
    const held = [record('one', 'run bun install first', 0.6, { sources: ['s1'] })];
    const result = merge(held, payload('s2', record('two', 'copy node_modules from main', 0.6)), NOW);

    expect(result.decisions[0]!.rule).toBe('flagged');
    expect(result.decisions[0]!.produced.map((each) => each.status)).toEqual(['flagged', 'flagged']);
  });

  test('settles two actions pushed together on a trigger nothing held', () => {
    const result = merge([], payload(
      's1',
      record('one', 'run bun install first', 0.5),
      record('two', 'copy node_modules from main', 0.55),
    ), NOW);

    expect(result.decisions.map((decision) => decision.rule)).toEqual(['flagged', 'flagged']);
  });
});

describe('the two-decimal gap comparison', () => {
  test('reads 0.55 against 0.45 as the gap itself, and flags', () => {
    // The control: as floats, the difference is over the gap.
    expect(0.55 - 0.45).toBeGreaterThan(GAP);

    const held = [record('low', 'run bun install first', 0.45, { sources: ['s1'] })];
    const result = merge(held, payload('s2', record('high', 'copy node_modules from main', 0.55)), NOW);

    expect(result.decisions[0]!.rule).toBe('flagged');
    expect(result.discarded).toEqual([]);
  });

  test('discards one hundredth past the gap', () => {
    const held = [record('low', 'run bun install first', 0.45, { sources: ['s1'] })];
    const result = merge(held, payload('s2', record('high', 'copy node_modules from main', 0.56)), NOW);

    expect(result.decisions[0]!.rule).toBe('higher-confidence');
    expect(result.discarded.map((each) => each.id)).toEqual(['low']);
  });
});

describe('merge', () => {
  test('answers one decision per pushed record, in the payload\'s order', () => {
    const second = { ...record('b', 'use a scratch tsconfig', 0.7), trigger: 'when tsc skips tests' };
    const first = record('a', 'run bun install first', 0.5);
    const result = merge([], payload('s1', second, first), NOW);

    expect(result.decisions.map((decision) => decision.incoming)).toEqual([second, first]);
  });

  test('changes no record it is given', () => {
    const held = [record('low', 'run bun install first', 0.5, { sources: ['s1'] })];
    const pushed = record('high', 'copy node_modules from main', 0.55);
    const before = structuredClone({ held, pushed });

    merge(held, payload('s2', pushed), NOW);

    expect({ held, pushed }).toEqual(before);
  });

  test('keeps the updated_at of a held record the settle left as it was', () => {
    const lead = record('lead', 'copy node_modules from main', 0.8, { sources: ['s1'] });
    const result = merge([lead], payload('s2', record('low', 'run bun install first', 0.5)), NOW);

    expect(result.decisions[0]!.produced[0]!.updated_at).toBe(EARLIER);
  });
});
