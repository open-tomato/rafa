/**
 * Tests for {@link freedByOver} (`./freed.ts`), the `freedBy` rule both
 * relationships adapters answer through.
 *
 * Each case plants literal readings behind a `blockersOf` over a small
 * listing, so the rule is read apart from either adapter. Each freed case
 * is paired with the same reading one blocker away, so a rule freeing
 * everything or nothing fails one side.
 */
import type { Blocker, BlockersReading } from './port.js';
import type { BoardIssue } from '../roadmap-board.js';

import { describe, expect, it } from 'bun:test';

import { freedByOver } from './freed.js';

/** An open or closed row numbered `number`. */
function row(number: number, state: BoardIssue['state'] = 'OPEN'): BoardIssue {
  return { number, title: `#${String(number)}`, body: '', state, stateReason: null, labels: [], type: 'code', module: 'unassigned' };
}

/** A blocker on this board. */
function local(number: number, state: Blocker['state'] = 'OPEN'): Blocker {
  return { number, repository: null, state };
}

/** `freedByOver` over rows numbered by `readings`' keys, each reading as planted. */
function freed(readings: Readonly<Record<number, BlockersReading>>, closed: readonly number[], states: Readonly<Record<number, BoardIssue['state']>> = {}): readonly number[] {
  const listing = Object.keys(readings).map((key) => row(Number(key), states[Number(key)] ?? 'OPEN'));
  return freedByOver(listing, closed, (issue) => readings[issue.number] ?? { kind: 'none', issue: issue.number });
}

describe('freedByOver', () => {
  it('frees an issue whose only open blocker is closed, whatever else was closed already', () => {
    expect(freed({ 30: { kind: 'blocked', issue: 30, blockers: [local(31), local(32, 'CLOSED')] } }, [31])).toEqual([30]);
  });

  it('does not free an issue still waiting on another open blocker', () => {
    expect(freed({ 34: { kind: 'blocked', issue: 34, blockers: [local(31), local(35)] } }, [31])).toEqual([]);
    expect(freed({ 34: { kind: 'blocked', issue: 34, blockers: [local(31), local(35)] } }, [31, 35])).toEqual([34]);
  });

  it('does not free an issue none of whose blockers was closed', () => {
    expect(freed({ 30: { kind: 'blocked', issue: 30, blockers: [local(32, 'CLOSED')] } }, [31])).toEqual([]);
  });

  it('keeps waiting a truncated list, a local blocker with no state, and a fault', () => {
    expect(freed({ 30: { kind: 'blocked', issue: 30, blockers: [local(31)], truncated: { total: 60 } } }, [31])).toEqual([]);
    expect(freed({ 30: { kind: 'blocked', issue: 30, blockers: [local(31), local(33, null)] } }, [31])).toEqual([]);
    expect(freed({ 30: { kind: 'blocked', issue: 30, blockers: [local(31), local(33, null)] } }, [31, 33])).toEqual([30]);
  });

  it('frees past a foreign blocker with no state, and never reads a closed local number as a foreign issue', () => {
    const foreign: Blocker = { number: 31, repository: 'acme/other', state: 'OPEN' };

    expect(freed({ 33: { kind: 'blocked', issue: 33, blockers: [local(31), { ...foreign, state: null }] } }, [31])).toEqual([33]);
    expect(freed({ 33: { kind: 'blocked', issue: 33, blockers: [local(31), foreign] } }, [31])).toEqual([]);
  });

  it('answers only open issues, in ascending number, and nothing for no closed issue', () => {
    const readings: Record<number, BlockersReading> = {
      50: { kind: 'blocked', issue: 50, blockers: [local(31)] },
      40: { kind: 'blocked', issue: 40, blockers: [local(31)] },
      45: { kind: 'blocked', issue: 45, blockers: [local(31)] },
    };

    expect(freed(readings, [31], { 45: 'CLOSED' })).toEqual([40, 50]);
    expect(freed(readings, [])).toEqual([]);
  });
});
