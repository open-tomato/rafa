/**
 * Tests for the contract's clocks
 * (`packages/rafa-board/src/adapters/tracker/contract-clock.ts`).
 *
 * The advanceable clock is held to moving `now()` by exactly what was
 * advanced, to staying frozen between advances, and to resolving
 * `advance` without waiting, measured on the wall clock. The real
 * clock's `advance(20)` is held to waiting at least 20 ms on the wall
 * clock: the control that the wall-clock reading the advanceable cases
 * take could have seen a wait.
 */
import { describe, expect, it } from 'bun:test';

import { advanceableContractClock, realContractClock } from './contract-clock.js';

/** A start far from the wall clock, so a `now()` reading it is not one. */
const START_MS = Date.UTC(2026, 0, 1);

/** The most a resolved-at-once `advance` may take on the wall clock. */
const NO_WAIT_CEILING_MS = 10;

describe('advanceableContractClock', () => {
  it('answers its start before any advance', () => {
    expect(advanceableContractClock(START_MS).now()).toBe(START_MS);
  });

  it('moves now() by exactly the advanced milliseconds', async () => {
    const clock = advanceableContractClock(START_MS);

    await clock.advance(1100);
    expect(clock.now()).toBe(START_MS + 1100);
    await clock.advance(1);
    expect(clock.now()).toBe(START_MS + 1101);
  });

  it('stays frozen between advances', async () => {
    const clock = advanceableContractClock(START_MS);

    await clock.advance(5);
    const first = clock.now();
    await new Promise((resolve) => {
      setTimeout(resolve, 15);
    });

    expect(clock.now()).toBe(first);
  });

  it('resolves advance without waiting', async () => {
    const clock = advanceableContractClock(START_MS);
    const before = performance.now();

    await clock.advance(60_000);

    expect(performance.now() - before).toBeLessThan(NO_WAIT_CEILING_MS);
    expect(clock.now()).toBe(START_MS + 60_000);
  });

  it('starts at the wall clock by default', () => {
    const before = Date.now();
    const now = advanceableContractClock().now();

    expect(now).toBeGreaterThanOrEqual(before);
    expect(now).toBeLessThanOrEqual(Date.now());
  });
});

describe('realContractClock', () => {
  it('reads the wall clock', () => {
    const before = Date.now();
    const now = realContractClock().now();

    expect(now).toBeGreaterThanOrEqual(before);
    expect(now).toBeLessThanOrEqual(Date.now());
  });

  it('waits at least 20 ms for advance(20)', async () => {
    const clock = realContractClock();
    const before = performance.now();
    const nowBefore = clock.now();

    await clock.advance(20);

    expect(performance.now() - before).toBeGreaterThanOrEqual(20);
    expect(clock.now() - nowBefore).toBeGreaterThanOrEqual(20);
  });
});
