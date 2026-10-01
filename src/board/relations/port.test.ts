/**
 * Tests for the one runtime value the relations port holds:
 * {@link isWaiting}, the rule both adapters' readings are read by.
 *
 * Everything else in `port.ts` is a type, and the root tsconfig excludes
 * `*.test.ts`, so a type-level case here would prove nothing; the
 * adapters' contract suite (`./contract.ts`) is what holds them to it.
 *
 * Each case is a literal reading. The cleared cases are paired with the
 * same reading one blocker away from holding, so a rule that answered
 * the same thing for every reading fails one side of each pair.
 */
import type { Blocker, BlockersReading } from './port.js';

import { describe, expect, it } from 'bun:test';

import { isWaiting } from './port.js';

/** A blocker on this board. */
function local(number: number, state: Blocker['state']): Blocker {
  return { number, repository: null, state };
}

/** A blocker on another repository. */
function foreign(number: number, state: Blocker['state']): Blocker {
  return { number, repository: 'open-tomato/agentic-research', state };
}

/** A `blocked` reading of #10 naming `blockers`. */
function blockedBy(...blockers: readonly Blocker[]): BlockersReading {
  return { kind: 'blocked', issue: 10, blockers };
}

describe('isWaiting', () => {
  it('answers false for an issue that waits on nothing', () => {
    expect(isWaiting({ kind: 'none', issue: 10 })).toBe(false);
  });

  it('answers true for a fault, which is reported and never guessed at', () => {
    const reading: BlockersReading = {
      kind: 'fault',
      issue: 10,
      line: { kind: 'no-line', issue: 10, line: null, text: null, blockers: [], foreign: [], unknown: [] },
      message: 'a fault',
    };

    expect(isWaiting(reading)).toBe(true);
  });

  it('answers false when every blocker is closed, and true when one of them is open', () => {
    expect(isWaiting(blockedBy(local(20, 'CLOSED'), local(21, 'CLOSED')))).toBe(false);
    expect(isWaiting(blockedBy(local(20, 'CLOSED'), local(21, 'OPEN')))).toBe(true);
  });

  it('holds on a local blocker whose state was not read, as not cleared', () => {
    expect(isWaiting(blockedBy(local(20, 'CLOSED'), local(21, null)))).toBe(true);
  });

  it('does not hold on a foreign blocker with no state, which labels mode never asks', () => {
    expect(isWaiting(blockedBy(local(20, 'CLOSED'), foreign(1, null)))).toBe(false);
  });

  it('holds on a foreign blocker read open, and clears on one read closed', () => {
    expect(isWaiting(blockedBy(foreign(1, 'OPEN')))).toBe(true);
    expect(isWaiting(blockedBy(foreign(1, 'CLOSED')))).toBe(false);
  });

  it('holds on a truncated list even when every node answered is closed', () => {
    const whole = blockedBy(local(20, 'CLOSED'));
    const truncated: BlockersReading = { ...whole, truncated: { total: 51 } };

    expect(isWaiting(whole)).toBe(false);
    expect(isWaiting(truncated)).toBe(true);
  });
});
