/**
 * The awake clock: how many minutes the machine has been awake since a
 * mark, and how many it spent suspended. `rafa loop wait` counts its
 * `quiet:<minutes>` reason on {@link AwakeReading.awakeMinutes}, so a
 * laptop closed over a running loop does not read as a stuck loop.
 *
 * ## Two clocks
 *
 * A mark holds two readings taken together: the monotonic clock
 * (`process.hrtime.bigint`, nanoseconds) and the wall clock
 * (`Date.now`, milliseconds). Awake time is the monotonic distance from
 * the mark; on Linux that clock (`CLOCK_MONOTONIC`) does not advance
 * while the machine is suspended. Suspended time is what the wall clock
 * advanced beyond it. Both arrive through {@link ClockSource}, so a test
 * hands in a fake and never sleeps.
 *
 * ## Reported only past one minute
 *
 * The two clocks drift apart by small amounts with no suspend at all: an
 * NTP slew, a wall clock stepped by hand. A gap of
 * {@link SUSPEND_REPORT_MINUTES} or less therefore reads as no suspend
 * (`suspendedMinutes` is `0`), and so does a wall clock stepped back
 * behind the monotonic one. Past that, the whole gap is reported.
 *
 * ## The macOS gap
 *
 * On macOS `process.hrtime` keeps counting through sleep, so there the
 * awake minutes include the time asleep and the suspended minutes read
 * `0`: a long sleep can raise a false `quiet`. That reading is the
 * spec's (#639) and was not measured here, where only Linux runs; a
 * later spec closes the gap. Until then `quiet` stays out of
 * `loop wait`'s default reasons and its help names the gap.
 */

/** Nanoseconds in one minute, for the monotonic clock. */
const NS_PER_MINUTE = 60_000_000_000n;

/** Milliseconds in one minute, for the wall clock. */
const MS_PER_MINUTE = 60_000;

/**
 * The gap between wall and monotonic time, in minutes, at or under which
 * no suspend is reported. A gap must be strictly past it to count.
 */
export const SUSPEND_REPORT_MINUTES = 1;

/** The two clocks the awake clock reads, injectable for tests. */
export interface ClockSource {
  /** Monotonic time in nanoseconds, as `process.hrtime.bigint` answers. */
  readonly monotonicNs: () => bigint;
  /** Wall time in milliseconds since the epoch, as `Date.now` answers. */
  readonly wallMs: () => number;
}

/** The process's own clocks. */
export const SYSTEM_CLOCK_SOURCE: ClockSource = Object.freeze({
  monotonicNs: () => process.hrtime.bigint(),
  wallMs: () => Date.now(),
});

/** Both clocks read at one moment; the point minutes are counted from. */
export interface AwakeMark {
  readonly monotonicNs: bigint;
  readonly wallMs: number;
}

/** The minutes since a mark, split into awake and suspended. */
export interface AwakeReading {
  /** Minutes the monotonic clock advanced: time the machine was awake. */
  readonly awakeMinutes: number;
  /**
   * Minutes the wall clock advanced past the monotonic one, or `0` when
   * that gap is {@link SUSPEND_REPORT_MINUTES} or less.
   */
  readonly suspendedMinutes: number;
}

/** Marks a moment and answers the awake and suspended minutes since one. */
export interface AwakeClock {
  readonly mark: () => AwakeMark;
  readonly since: (mark: AwakeMark) => AwakeReading;
}

/**
 * The suspended minutes a wall and a monotonic distance imply: their
 * difference when it is past {@link SUSPEND_REPORT_MINUTES}, else `0`.
 */
function suspendedMinutesOf(wallMinutes: number, awakeMinutes: number): number {
  const gap = wallMinutes - awakeMinutes;
  return gap > SUSPEND_REPORT_MINUTES
    ? gap
    : 0;
}

/**
 * An awake clock over `source`, the process's own clocks by default.
 * A monotonic reading behind the mark (a mark from another process, or
 * a fake run backwards) answers `0` awake minutes rather than a negative.
 */
export function createAwakeClock(source: ClockSource = SYSTEM_CLOCK_SOURCE): AwakeClock {
  const mark = (): AwakeMark => Object.freeze({
    monotonicNs: source.monotonicNs(),
    wallMs: source.wallMs(),
  });

  const since = (from: AwakeMark): AwakeReading => {
    const monotonicNs = source.monotonicNs() - from.monotonicNs;
    const awakeMinutes = monotonicNs > 0n
      ? Number(monotonicNs) / Number(NS_PER_MINUTE)
      : 0;
    const wallMinutes = (source.wallMs() - from.wallMs) / MS_PER_MINUTE;
    return Object.freeze({
      awakeMinutes,
      suspendedMinutes: suspendedMinutesOf(wallMinutes, awakeMinutes),
    });
  };

  return Object.freeze({ mark, since });
}
