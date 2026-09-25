/**
 * Property tests for `merge`: the held set does not depend on the order
 * payloads arrive in, and a source pushing the same payload twice
 * changes nothing the first push did not.
 *
 * The fixtures keep every action within the gap of its trigger's leader,
 * so no push discards one: a discarded action comes back with only later
 * sources, which the merge module note names as order dependent.
 */

import type { InstinctRecord, MergeResult, SyncPayload } from './types.js';

import { describe, expect, test } from 'bun:test';

import { actionHash, triggerKey } from './identity.js';
import { merge } from './merge.js';

const NOW = '2026-09-25T12:00:00.000Z';
const EARLIER = '2026-09-20T08:00:00.000Z';

function record(id: string, trigger: string, action: string, confidence: number): InstinctRecord {
  return {
    id,
    trigger,
    action,
    action_hash: actionHash(action),
    confidence,
    usage_count: 1,
    signal: 'loud',
    status: 'active',
    created_at: EARLIER,
    updated_at: EARLIER,
  };
}

const T1 = 'when running bun test under a fresh worktree';
const T2 = 'when the lint gate reports an unused import';

/** Three sources: two agree on one action, one disagrees, plus a second trigger. */
const PAYLOADS: readonly SyncPayload[] = [
  { source_id: 'session-a', instincts: [record('a-1', T1, 'run bun install first', 0.5), record('a-2', T2, 'remove the import', 0.6)] },
  { source_id: 'session-b', instincts: [record('b-1', T1, 'Run bun install first ', 0.5)] },
  { source_id: 'session-c', instincts: [record('c-1', T1, 'copy node_modules', 0.55), record('c-2', T2, 'Remove the import', 0.6)] },
];

/** Every ordering of `items`. */
function permutations<T>(items: readonly T[]): T[][] {
  if (items.length <= 1) {
    return [[...items]];
  }
  return items.flatMap((item, index) => permutations([...items.slice(0, index), ...items.slice(index + 1)])
    .map((rest) => [item, ...rest]));
}

/** The held set after `result`: untouched records, then each touched trigger's produced. */
function heldAfter(held: readonly InstinctRecord[], result: MergeResult): InstinctRecord[] {
  const produced = new Map(result.decisions.map((decision) => [triggerKey(decision.incoming.trigger), decision.produced]));
  const untouched = held.filter((each) => !produced.has(triggerKey(each.trigger)));
  return [...untouched, ...[...produced.values()].flat()];
}

function push(held: readonly InstinctRecord[], payloads: readonly SyncPayload[]): InstinctRecord[] {
  return payloads.reduce((current, each) => heldAfter(current, merge(current, each, NOW)), [...held]);
}

/** A held set as comparable data: order and `updated_at` are not part of the answer. */
function canonical(held: readonly InstinctRecord[]): unknown[] {
  return held
    .map((each) => ({ ...each, updated_at: undefined }))
    .sort((left, right) => left.id.localeCompare(right.id))
    .map((each) => JSON.parse(JSON.stringify(each)));
}

describe('permutation', () => {
  const orders = permutations(PAYLOADS);
  const expected = canonical(push([], PAYLOADS));

  test('there are six orders', () => {
    expect(orders).toHaveLength(6);
  });

  test('the fixtures settle to more than one record, so equality says something', () => {
    expect(expected.length).toBeGreaterThan(2);
  });

  test.each(orders.map((order) => [order.map((each) => each.source_id).join(' → '), order] as const))(
    'pushed %s leaves the same held set',
    (_label, order) => {
      expect(canonical(push([], order))).toEqual(expected);
    },
  );
});

describe('idempotence', () => {
  test.each(PAYLOADS.map((each) => [each.source_id, each] as const))(
    '%s pushed twice equals pushed once',
    (_label, each) => {
      const once = push([], [each]);
      const twice = push([], [each, each]);
      expect(canonical(twice)).toEqual(canonical(once));
    },
  );

  test('a repeat leaves usage_count at the number of distinct sources', () => {
    const held = push([], [...PAYLOADS, ...PAYLOADS]);
    expect(canonical(held)).toEqual(canonical(push([], PAYLOADS)));
    for (const each of held) {
      expect(each.usage_count).toBe(each.sources?.length ?? each.usage_count);
    }
  });
});
