/**
 * Tests for `readClaimState` (`stale.ts`): the four answers, the
 * boundary at exactly `staleAfter`, `disabled` never stale, and a claim
 * whose issue is in development, or whose stage label is missing or
 * doubled, never answered as a takeover candidate.
 *
 * Every "not stale" case has a control beside it: the same claim with
 * the one input changed that makes it stale, so a reading that could
 * never answer stale would fail the control rather than pass the case.
 */
import type { ClaimOwnership, ClaimStateInput } from './stale.js';

import { describe, expect, it } from 'bun:test';

import { CLAIMED_LABEL, IN_DEVELOPMENT_LABEL, readClaimState } from './stale.js';

const OWNER = 'store-a';
const RECEIVER = 'store-b';
const HOUR = 3_600_000;
const NOW = new Date('2026-09-30T12:00:00Z');

/** A tip committed `hours` before {@link NOW}. */
function hoursAgo(hours: number): Date {
  return new Date(NOW.getTime() - hours * HOUR);
}

const HELD: ClaimOwnership = { state: 'held', owner: OWNER, pending: null, ignored: [] };

/** A held `rafa:claimed` claim idle for four days against `3d`, overridden by `change`. */
function input(change: Partial<ClaimStateInput> = {}): ClaimStateInput {
  return {
    ownership: HELD,
    tipCommittedAt: hoursAgo(96),
    labels: [CLAIMED_LABEL],
    staleAfter: '3d',
    now: NOW,
    ...change,
  };
}

describe('readClaimState', () => {
  it('answers held for a claim idle for less than staleAfter', () => {
    expect(readClaimState(input({ tipCommittedAt: hoursAgo(71) })))
      .toEqual({ state: 'held', owner: OWNER, pending: null });
  });

  it('answers stale-claimed for a rafa:claimed claim idle for staleAfter or more', () => {
    expect(readClaimState(input())).toEqual({ state: 'stale-claimed', owner: OWNER, idleMs: 96 * HOUR });
  });

  it('reads a claim idle for exactly staleAfter as stale, and one millisecond less as held', () => {
    const exact = readClaimState(input({ tipCommittedAt: hoursAgo(72) }));
    const under = readClaimState(input({ tipCommittedAt: new Date(hoursAgo(72).getTime() + 1) }));
    expect([exact.state, under.state]).toEqual(['stale-claimed', 'held']);
  });

  it('reads an hour duration as hours', () => {
    const states = [35, 36].map((hours) => readClaimState(input({ staleAfter: '36h', tipCommittedAt: hoursAgo(hours) })).state);
    expect(states).toEqual(['held', 'stale-claimed']);
  });

  it('answers released for a released claim, whatever its age and labels', () => {
    const released: ClaimOwnership = { state: 'released', releasedBy: OWNER, ignored: [] };
    const readAt = (labels: readonly string[], hours: number) => readClaimState(input({ ownership: released, labels, tipCommittedAt: hoursAgo(hours) }));
    const readings = [[], [CLAIMED_LABEL], [IN_DEVELOPMENT_LABEL]].flatMap((labels) => [1, 1000].map((hours) => readAt(labels, hours)));
    expect(new Set(readings.map((reading) => JSON.stringify(reading))))
      .toEqual(new Set([JSON.stringify({ state: 'released', releasedBy: OWNER })]));
  });

  it('keeps a pending handover on a held claim', () => {
    const pending = { to: RECEIVER, sha: 'a'.repeat(40) };
    const ownership: ClaimOwnership = { state: 'held', owner: OWNER, pending, ignored: [] };
    expect(readClaimState(input({ ownership, tipCommittedAt: hoursAgo(1) })))
      .toEqual({ state: 'held', owner: OWNER, pending });
  });

  describe('disabled', () => {
    it('is never stale, for any label and any age', () => {
      const labelSets = [[CLAIMED_LABEL], [IN_DEVELOPMENT_LABEL], [], [CLAIMED_LABEL, IN_DEVELOPMENT_LABEL]];
      const readAt = (labels: readonly string[], hours: number) => readClaimState(input({ staleAfter: 'disabled', labels, tipCommittedAt: hoursAgo(hours) })).state;
      const states = labelSets.flatMap((labels) => [0, 72, 24 * 365 * 10].map((hours) => readAt(labels, hours)));
      expect(new Set(states)).toEqual(new Set(['held']));
    });

    it('control: the same ten-year-old claim is stale under 3d', () => {
      expect(readClaimState(input({ tipCommittedAt: hoursAgo(24 * 365 * 10) })).state).toBe('stale-claimed');
    });
  });

  describe('rafa:in-development', () => {
    it('is never answered stale-claimed, only stale-in-development', () => {
      const readAt = (hours: number) => readClaimState(input({ labels: [IN_DEVELOPMENT_LABEL], tipCommittedAt: hoursAgo(hours) })).state;
      const states = [72, 96, 24 * 365].map(readAt);
      expect(new Set(states)).toEqual(new Set(['stale-in-development']));
    });

    it('wins over rafa:claimed when a failed swap left both', () => {
      expect(readClaimState(input({ labels: [CLAIMED_LABEL, IN_DEVELOPMENT_LABEL] })))
        .toEqual({ state: 'stale-in-development', owner: OWNER, idleMs: 96 * HOUR });
    });

    it('stays held while fresh', () => {
      expect(readClaimState(input({ labels: [IN_DEVELOPMENT_LABEL], tipCommittedAt: hoursAgo(1) })).state).toBe('held');
    });
  });

  it('reads an issue with no stage label as in development, never as a takeover candidate', () => {
    const states = [[], ['bug', 'rafa:ready']].map((labels) => readClaimState(input({ labels })).state);
    expect(states).toEqual(['stale-in-development', 'stale-in-development']);
  });

  it('matches the labels exactly, so a look-alike is no stage label', () => {
    expect(readClaimState(input({ labels: ['Rafa:Claimed', 'rafa:claimed-x'] })).state).toBe('stale-in-development');
  });

  it('reads a tip dated after now as idle for no time', () => {
    const future = new Date(NOW.getTime() + 1000 * HOUR);
    expect(readClaimState(input({ tipCommittedAt: future, staleAfter: '1h' }))).toEqual({ state: 'held', owner: OWNER, pending: null });
  });

  it('reads an invalid tip date as never stale', () => {
    expect(readClaimState(input({ tipCommittedAt: new Date(Number.NaN), staleAfter: '1h' })).state).toBe('held');
  });

  it('throws on a staleAfter the config reader would have refused', () => {
    const invalid = ['0d', '3w'].map((raw) => () => readClaimState(input({ staleAfter: raw as ClaimStateInput['staleAfter'] })));
    for (const call of invalid) {
      expect(call).toThrow('is no duration');
    }
  });
});
