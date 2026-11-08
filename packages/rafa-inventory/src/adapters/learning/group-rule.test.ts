/**
 * Tests for the push log's rule (`packages/rafa-inventory/src/adapters/learning/group-rule.ts`).
 *
 * Every result a case reads comes from the library's own `merge` over
 * a held set built here, not from a hand-built decision, so a case
 * about "a third wording of a held action" is about the decision
 * `merge` answers for it. Each `same-action-group` reading sits beside a
 * control that the merge rule was reachable: the same push with no
 * other wording held, or with the other wording flagged.
 */
import type { InstinctRecord, MergeResult } from '@open-tomato/rafa/ports';

import { describe, expect, test } from 'bun:test';

import { actionHash, merge } from '../../learning/index.js';

import { heldAfterPush, loggedRule } from './group-rule.js';

/** The time every merge here stamps. */
const NOW = '2026-11-07T12:00:00Z';

/** When every held record here was written, before {@link NOW}. */
const EARLIER = '2026-11-06T12:00:00Z';

/** The action every record here takes unless it says otherwise. */
const ACTION = 'run each gate in its own foreground call';

/** A second action, to put a trigger in conflict. */
const RIVAL = 'rerun the suite until it passes';

/** Three wordings of one lesson's trigger. */
const FIRST = 'when the full suite runs past the tool timeout';
const SECOND = 'when a gate is backgrounded and its output lost';
const THIRD = 'when a long test run is polled with sleep';

/** A record on `trigger` with any field replaced, its hash that of its action. */
function record(id: string, trigger: string, overrides: Partial<InstinctRecord> = {}): InstinctRecord {
  const drafted: InstinctRecord = {
    id,
    trigger,
    action: ACTION,
    action_hash: '',
    confidence: 0.5,
    usage_count: 1,
    sources: [`session-${id}`],
    signal: 'loud',
    status: 'active',
    created_at: EARLIER,
    updated_at: EARLIER,
    ...overrides,
  };
  return { ...drafted, action_hash: actionHash(drafted.action) };
}

/** What `merge` answers for `incoming` from one source over `held`. */
function pushed(held: InstinctRecord[], incoming: InstinctRecord[], sourceId = 'session-new'): MergeResult {
  return merge(held, { source_id: sourceId, instincts: incoming }, NOW);
}

/** Each decision's logged rule over the held set after the push. */
function rulesOf(held: InstinctRecord[], result: MergeResult): string[] {
  const after = heldAfterPush(held, result);
  return result.decisions.map((decision) => loggedRule(decision, after));
}

describe('loggedRule', () => {
  test('logs a third wording of a held action as same-action-group, where merge reads new-trigger', () => {
    const held = [record('first', FIRST), record('second', SECOND)];
    const result = pushed(held, [record('third', THIRD)]);

    expect(result.decisions.map((decision) => decision.rule)).toEqual(['new-trigger']);
    expect(rulesOf(held, result)).toEqual(['same-action-group']);
  });

  test('logs new-trigger for the same push when no other wording is held', () => {
    const held = [record('elsewhere', FIRST, { action: RIVAL })];
    const result = pushed(held, [record('third', THIRD)]);

    expect(rulesOf(held, result)).toEqual(['new-trigger']);
  });

  test('logs a same-action confirmation as same-action-group when another trigger holds the action', () => {
    const held = [record('first', FIRST), record('second', SECOND)];
    const result = pushed(held, [record('again', FIRST)]);

    expect(result.decisions.map((decision) => decision.rule)).toEqual(['same-action']);
    expect(rulesOf(held, result)).toEqual(['same-action-group']);
  });

  test('logs same-action when the only trigger holding the action is its own', () => {
    const held = [record('first', FIRST)];
    const result = pushed(held, [record('again', FIRST)]);

    expect(rulesOf(held, result)).toEqual(['same-action']);
  });

  test('logs its merge rule for a push onto a group whose other wordings are all flagged', () => {
    const held = [
      record('second', SECOND),
      record('second-rival', SECOND, { action: RIVAL, confidence: 0.55 }),
    ];
    const result = pushed(held, [record('third', THIRD)]);

    expect(heldAfterPush(held, result).find((each) => each.id === 'second')?.status).toBe('flagged');
    expect(rulesOf(held, result)).toEqual(['new-trigger']);
  });

  test('logs its merge rule when its own record is not active in the held set after', () => {
    const held = [record('first', FIRST), record('second', SECOND)];
    const result = pushed(held, [record('third', THIRD)]);
    // `merge` never leaves a `new-trigger` record beside a rival, so the
    // held set after is read with the produced record flagged by hand.
    const after = heldAfterPush(held, result).map((each) => each.id === 'third'
      ? { ...each, status: 'flagged' as const }
      : each);

    expect(loggedRule(result.decisions[0]!, after)).toBe('new-trigger');
  });

  test('keeps higher-confidence and flagged whatever group the action is in', () => {
    const grouped = [record('first', FIRST), record('second', SECOND, { action: RIVAL, confidence: 0.4 })];
    const displacing = pushed(grouped, [record('second-new', SECOND, { confidence: 0.8 })]);
    const rivalled = [record('first', FIRST), record('second', SECOND, { action: RIVAL })];
    const flagging = pushed(rivalled, [record('second-new', SECOND, { confidence: 0.55 })]);

    expect(rulesOf(grouped, displacing)).toEqual(['higher-confidence']);
    expect(rulesOf(rivalled, flagging)).toEqual(['flagged']);
  });

  test('reads the whole push, so two new wordings in one payload each log same-action-group', () => {
    const held = [record('elsewhere', FIRST, { action: RIVAL })];
    const result = pushed(held, [record('second', SECOND), record('third', THIRD)]);

    expect(rulesOf(held, result)).toEqual(['same-action-group', 'same-action-group']);
  });
});

describe('heldAfterPush', () => {
  test('holds each touched trigger as its produced records and leaves the rest as they were', () => {
    const untouched = record('elsewhere', SECOND, { action: RIVAL });
    const held = [record('first', FIRST), untouched];
    const result = pushed(held, [record('again', FIRST, { created_at: NOW, updated_at: NOW })]);

    const after = heldAfterPush(held, result);

    expect(after.map((each) => each.id)).toEqual(['elsewhere', 'first']);
    expect(after[0]).toBe(untouched);
    expect(after[1]!.sources).toEqual(['session-again', 'session-first', 'session-new']);
  });

  test('reads a record pushed flagged alone on its trigger as active, as the files read back', () => {
    const incoming = record('third', THIRD, { status: 'flagged' });
    const result = pushed([], [incoming]);

    expect(result.decisions[0]!.produced[0]!.status).toBe('flagged');
    expect(heldAfterPush([], result).map((each) => each.status)).toEqual(['active']);
    expect(incoming.status).toBe('flagged');
  });
});
