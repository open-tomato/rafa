/**
 * Tests for the awake clock (`loop/awake-clock.ts`): awake minutes follow
 * the monotonic clock alone, a suspend (wall advancing past monotonic)
 * does not count toward them, and the suspended minutes are reported only
 * past one minute.
 *
 * Every case drives a fake {@link ClockSource} whose two clocks the case
 * advances by hand, so nothing sleeps. Each suspend case sits beside a
 * control with no suspend, so a clock that ignored the wall reading, or
 * read awake time from the wall, fails one of the pair.
 */
import type { ClockSource } from './awake-clock.js';

import { describe, expect, it } from 'bun:test';

import {
  createAwakeClock,
  SUSPEND_REPORT_MINUTES,
  SYSTEM_CLOCK_SOURCE,
} from './awake-clock.js';

const NS_PER_MINUTE = 60_000_000_000n;
const MS_PER_MINUTE = 60_000;

/** A fake pair of clocks, advanced together (awake) or wall alone (asleep). */
function fakeClocks() {
  let monotonicNs = 5n * NS_PER_MINUTE;
  let wallMs = 1_700_000_000_000;
  const source: ClockSource = {
    monotonicNs: () => monotonicNs,
    wallMs: () => wallMs,
  };
  return {
    source,
    awake(minutes: number) {
      monotonicNs += BigInt(Math.round(minutes * MS_PER_MINUTE)) * 1_000_000n;
      wallMs += minutes * MS_PER_MINUTE;
    },
    suspend(minutes: number) {
      wallMs += minutes * MS_PER_MINUTE;
    },
    stepWall(minutes: number) {
      wallMs += minutes * MS_PER_MINUTE;
    },
  };
}

describe('createAwakeClock', () => {
  it('reads awake minutes with no suspend reported when both clocks advance together', () => {
    const clocks = fakeClocks();
    const clock = createAwakeClock(clocks.source);
    const mark = clock.mark();

    clocks.awake(12);

    expect(clock.since(mark)).toEqual({ awakeMinutes: 12, suspendedMinutes: 0 });
  });

  it('does not count a suspend toward awake minutes', () => {
    const clocks = fakeClocks();
    const clock = createAwakeClock(clocks.source);
    const mark = clock.mark();

    clocks.awake(3);
    clocks.suspend(625.7);
    clocks.awake(2);

    const reading = clock.since(mark);
    expect(reading.awakeMinutes).toBe(5);
    expect(reading.suspendedMinutes).toBeCloseTo(625.7, 6);
  });

  it('reports no suspend for a gap of exactly one minute', () => {
    const clocks = fakeClocks();
    const clock = createAwakeClock(clocks.source);
    const mark = clock.mark();

    clocks.awake(4);
    clocks.suspend(SUSPEND_REPORT_MINUTES);

    expect(clock.since(mark)).toEqual({ awakeMinutes: 4, suspendedMinutes: 0 });
  });

  it('reports a gap just past one minute whole', () => {
    const clocks = fakeClocks();
    const clock = createAwakeClock(clocks.source);
    const mark = clock.mark();

    clocks.awake(4);
    clocks.suspend(1.5);

    expect(clock.since(mark)).toEqual({ awakeMinutes: 4, suspendedMinutes: 1.5 });
  });

  it('keeps a short suspend out of awake minutes even though it is not reported', () => {
    const clocks = fakeClocks();
    const clock = createAwakeClock(clocks.source);
    const mark = clock.mark();

    clocks.awake(4);
    clocks.suspend(0.5);

    expect(clock.since(mark)).toEqual({ awakeMinutes: 4, suspendedMinutes: 0 });
  });

  it('reports no suspend when the wall clock is stepped back', () => {
    const clocks = fakeClocks();
    const clock = createAwakeClock(clocks.source);
    const mark = clock.mark();

    clocks.awake(10);
    clocks.stepWall(-30);

    expect(clock.since(mark)).toEqual({ awakeMinutes: 10, suspendedMinutes: 0 });
  });

  it('answers zero awake minutes for a monotonic reading behind the mark', () => {
    const clocks = fakeClocks();
    const clock = createAwakeClock(clocks.source);
    const mark = { monotonicNs: clocks.source.monotonicNs() + NS_PER_MINUTE, wallMs: clocks.source.wallMs() };

    expect(clock.since(mark).awakeMinutes).toBe(0);
  });

  it('measures each mark on its own', () => {
    const clocks = fakeClocks();
    const clock = createAwakeClock(clocks.source);
    const first = clock.mark();
    clocks.awake(2);
    const second = clock.mark();
    clocks.suspend(20);
    clocks.awake(1);

    expect(clock.since(first)).toEqual({ awakeMinutes: 3, suspendedMinutes: 20 });
    expect(clock.since(second)).toEqual({ awakeMinutes: 1, suspendedMinutes: 20 });
  });
});

describe('SYSTEM_CLOCK_SOURCE', () => {
  it('reads the process clocks, which agree with no suspend between two readings', () => {
    const clock = createAwakeClock(SYSTEM_CLOCK_SOURCE);
    const mark = clock.mark();

    const reading = clock.since(mark);

    expect(typeof mark.monotonicNs).toBe('bigint');
    expect(mark.wallMs).toBeGreaterThan(0);
    expect(reading.awakeMinutes).toBeGreaterThanOrEqual(0);
    expect(reading.awakeMinutes).toBeLessThan(1);
    expect(reading.suspendedMinutes).toBe(0);
  });

  it('is the default source', () => {
    const before = process.hrtime.bigint();
    const mark = createAwakeClock().mark();
    const after = process.hrtime.bigint();

    expect(mark.monotonicNs >= before && mark.monotonicNs <= after).toBe(true);
  });
});
