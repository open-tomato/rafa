/**
 * Tests for the pull request's check-row readers (`src/pr/checks.ts`).
 *
 * Everything here is driven through injected probes and an injected
 * clock, so no `gh`, no network and no real timers are involved. The
 * JSON fixtures are the shapes `gh pr checks --json name,state,link`
 * actually emitted for this repo, including the plain-text message it
 * writes when a PR has no checks at all.
 *
 * The grace cases run on {@link steppedClock}: a counter the sleeps
 * alone move, so "polled until a row appears" and "polled until the
 * grace has passed" are exact poll counts, and the two endings on the
 * first poll (no head time, a head past the grace) are held to NO
 * sleep at all. Each grace case has a control beside it that differs
 * in the one input under test, so a wait that ignored the head time
 * could not pass both.
 */

import type { CheckRow } from './checks.js';

import { describe, expect, it } from 'bun:test';

import {
  classifyState,
  failingRows,
  FIRST_CHECK_GRACE_MS,
  formatRows,
  parseChecks,
  verdictOf,
  waitForChecks,
} from './checks.js';

const JOB = 'https://github.com/o/r/actions/runs/1/job/2';

function rowsJson(states: Record<string, string>): string {
  const entries = Object.entries(states);
  const mapped = entries.map(([name, state]) => ({ name, state, link: JOB }));
  return JSON.stringify(mapped);
}

/**
 * One poll's rows, read from the stdout `gh pr checks` writes for them.
 * `waitForChecks` polls rows rather than stdout, so a case that wants a
 * provider's own output goes through `parseChecks` as the adapter does.
 */
function rowsOf(states: Record<string, string>): CheckRow[] {
  return parseChecks(rowsJson(states));
}

/** The instant the grace cases start at: 2026-10-12T12:00:00Z, in milliseconds. */
const NOW = Date.UTC(2026, 9, 12, 12);

/** A clock a case advances by sleeping, so no case waits on a real timer. */
interface SteppedClock {
  readonly now: () => number;
  readonly sleep: (ms: number) => Promise<void>;
  /** Every wait asked for, in order. */
  readonly sleeps: () => readonly number[];
}

/** A clock starting at `start` that only the sleeps move. */
function steppedClock(start: number): SteppedClock {
  let ms = start;
  let waits: readonly number[] = [];
  return {
    now: () => ms,
    sleep: (asked: number) => {
      waits = [...waits, asked];
      ms += asked;
      return Promise.resolve();
    },
    sleeps: () => [...waits],
  };
}

describe('classifyState', () => {
  it('maps GitHub success states to pass', () => {
    expect(classifyState('SUCCESS')).toBe('pass');
    expect(classifyState('SKIPPED')).toBe('pass');
    expect(classifyState('NEUTRAL')).toBe('pass');
  });

  it('maps failure states to fail', () => {
    expect(classifyState('FAILURE')).toBe('fail');
    expect(classifyState('CANCELLED')).toBe('fail');
    expect(classifyState('TIMED_OUT')).toBe('fail');
  });

  it('maps in-flight states to pending', () => {
    expect(classifyState('PENDING')).toBe('pending');
    expect(classifyState('IN_PROGRESS')).toBe('pending');
    expect(classifyState('QUEUED')).toBe('pending');
  });

  it('treats an unknown state as pending, never as pass', () => {
    // A wrong green here lands a plan CI never agreed with; waiting is
    // recoverable because the deadline ends it.
    expect(classifyState('SOMETHING_NEW')).toBe('pending');
    expect(classifyState('')).toBe('pending');
  });

  it('is case-insensitive and tolerates surrounding space', () => {
    expect(classifyState('  success ')).toBe('pass');
  });
});

describe('parseChecks', () => {
  it('parses the three-job shape this repo emits', () => {
    const rows = parseChecks(rowsJson({
      checks: 'SUCCESS',
      test: 'SUCCESS',
      visual: 'FAILURE',
    }));

    expect(rows).toHaveLength(3);
    expect(rows.map((r) => r.name)).toEqual(['checks', 'test', 'visual']);
    expect(rows.map((r) => r.outcome)).toEqual(['pass', 'pass', 'fail']);
  });

  it('keeps the raw state so an unknown one stays reportable', () => {
    const rows = parseChecks(rowsJson({ checks: 'WEIRD' }));
    expect(rows[0]?.state).toBe('WEIRD');
    expect(rows[0]?.outcome).toBe('pending');
  });

  it('returns no rows for the no-checks-reported message', () => {
    // `gh` writes this as plain text and exits non-zero, which is why the
    // exit code cannot carry the verdict.
    expect(parseChecks('no checks reported on the \'x\' branch')).toEqual([]);
  });

  it('returns no rows for empty or malformed output', () => {
    expect(parseChecks('')).toEqual([]);
    expect(parseChecks('[not json')).toEqual([]);
    expect(parseChecks('{"name":"x"}')).toEqual([]);
  });
});

describe('verdictOf', () => {
  it('reports none when there are no rows', () => {
    expect(verdictOf([])).toBe('none');
  });

  it('reports green when every row passed', () => {
    const rows = parseChecks(rowsJson({ a: 'SUCCESS', b: 'SKIPPED' }));
    expect(verdictOf(rows)).toBe('green');
  });

  it('reports red when any row failed', () => {
    const rows = parseChecks(rowsJson({ a: 'SUCCESS', b: 'FAILURE' }));
    expect(verdictOf(rows)).toBe('red');
  });

  it('lets pending outrank failure on a partial reading', () => {
    // Half a run is not a verdict: a job can be red while another is
    // still going, and calling that red would repair against a moving
    // target.
    const rows = parseChecks(rowsJson({ a: 'FAILURE', b: 'IN_PROGRESS' }));
    expect(verdictOf(rows)).toBe('pending');
  });
});

describe('failingRows and formatRows', () => {
  it('selects only the failing rows', () => {
    const rows = parseChecks(rowsJson({ a: 'SUCCESS', b: 'FAILURE' }));
    expect(failingRows(rows).map((r) => r.name)).toEqual(['b']);
  });

  it('names the check, its raw state and its link', () => {
    const rows = parseChecks(rowsJson({ visual: 'FAILURE' }));
    const text = formatRows(rows);

    expect(text).toContain('visual');
    expect(text).toContain('FAILURE');
    expect(text).toContain(JOB);
  });

  it('says so when there are no checks', () => {
    expect(formatRows([])).toContain('no checks reported');
  });
});

describe('waitForChecks', () => {
  const noSleep = (): Promise<void> => Promise.resolve();

  it('returns green on the first poll when CI already passed', async () => {
    const result = await waitForChecks({
      probe: () => Promise.resolve(rowsOf({ checks: 'SUCCESS' })),
      timeoutMs: 60_000,
      intervalMs: 1_000,
      sleep: noSleep,
    });

    expect(result.verdict).toBe('green');
    expect(result.polls).toBe(1);
  });

  it('keeps polling while checks are in flight', async () => {
    const states = ['PENDING', 'IN_PROGRESS', 'SUCCESS'];
    let call = 0;
    const probe = (): Promise<CheckRow[]> => {
      const state = states[call] ?? 'SUCCESS';
      call += 1;
      return Promise.resolve(rowsOf({ checks: state }));
    };

    const result = await waitForChecks({
      probe,
      timeoutMs: 60_000,
      intervalMs: 1_000,
      sleep: noSleep,
    });

    expect(result.verdict).toBe('green');
    expect(result.polls).toBe(3);
  });

  it('returns none on the first poll when it is handed no head time', async () => {
    // With no head time there is no grace to wait out: this is the wait
    // the loop's CI gate and `pr triage --resolve` make.
    const clock = steppedClock(NOW);
    const result = await waitForChecks({
      probe: () => Promise.resolve(parseChecks('no checks reported')),
      timeoutMs: 600_000,
      intervalMs: 1_000,
      now: clock.now,
      sleep: clock.sleep,
    });

    expect(result.verdict).toBe('none');
    expect(result.polls).toBe(1);
    expect(clock.sleeps()).toEqual([]);
  });

  it('gives up at the deadline instead of polling forever', async () => {
    let clock = 0;
    const result = await waitForChecks({
      probe: () => Promise.resolve(rowsOf({ checks: 'IN_PROGRESS' })),
      timeoutMs: 10_000,
      intervalMs: 2_000,
      now: () => {
        clock += 2_000;
        return clock;
      },
      sleep: noSleep,
    });

    expect(result.verdict).toBe('timeout');
    expect(result.rows).toHaveLength(1);
  });

  it('reports every poll to the caller', async () => {
    const seen: string[] = [];
    await waitForChecks({
      probe: () => Promise.resolve(rowsOf({ checks: 'FAILURE' })),
      timeoutMs: 10_000,
      intervalMs: 1_000,
      sleep: noSleep,
      onPoll: (_rows, verdict) => {
        seen.push(verdict);
      },
    });

    expect(seen).toEqual(['red']);
  });
});

describe('waitForChecks on a head whose first check may not have registered', () => {
  /** The interval every case here polls at. */
  const INTERVAL = 20_000;

  /** A deadline no case here reaches unless it says so. */
  const LONG = 20 * 60_000;

  it('declares the grace as two minutes', () => {
    expect(FIRST_CHECK_GRACE_MS).toBe(120_000);
  });

  it('polls zero rows on a young head until a row appears', async () => {
    const clock = steppedClock(NOW);
    const answers = [[], [], rowsOf({ checks: 'SUCCESS' })];
    let call = 0;
    const result = await waitForChecks({
      probe: () => {
        const rows = answers[Math.min(call, answers.length - 1)] ?? [];
        call += 1;
        return Promise.resolve(rows);
      },
      timeoutMs: LONG,
      intervalMs: INTERVAL,
      now: clock.now,
      sleep: clock.sleep,
      headCommittedAtMs: NOW - 1_000,
    });

    expect([result.verdict, result.polls]).toEqual(['green', 3]);
    expect(clock.sleeps()).toEqual([INTERVAL, INTERVAL]);
  });

  it('goes on to poll a row that registered pending, as it would with no grace', async () => {
    const clock = steppedClock(NOW);
    const answers = [[], rowsOf({ checks: 'IN_PROGRESS' }), rowsOf({ checks: 'FAILURE' })];
    let call = 0;
    const result = await waitForChecks({
      probe: () => {
        const rows = answers[Math.min(call, answers.length - 1)] ?? [];
        call += 1;
        return Promise.resolve(rows);
      },
      timeoutMs: LONG,
      intervalMs: INTERVAL,
      now: clock.now,
      sleep: clock.sleep,
      headCommittedAtMs: NOW - 1_000,
    });

    expect([result.verdict, result.polls]).toEqual(['red', 3]);
  });

  it('ends none on the first poll for zero rows on a head past the grace', async () => {
    const clock = steppedClock(NOW);
    const result = await waitForChecks({
      probe: () => Promise.resolve([]),
      timeoutMs: LONG,
      intervalMs: INTERVAL,
      now: clock.now,
      sleep: clock.sleep,
      headCommittedAtMs: NOW - FIRST_CHECK_GRACE_MS,
    });

    expect([result.verdict, result.polls]).toEqual(['none', 1]);
    expect(clock.sleeps()).toEqual([]);
  });

  it('holds a head one millisecond inside the grace, the control on the case above', async () => {
    const clock = steppedClock(NOW);
    const result = await waitForChecks({
      probe: () => Promise.resolve([]),
      timeoutMs: LONG,
      intervalMs: INTERVAL,
      now: clock.now,
      sleep: clock.sleep,
      headCommittedAtMs: NOW - FIRST_CHECK_GRACE_MS + 1,
    });

    // Held on the first poll, and past the grace by the second.
    expect([result.verdict, result.polls]).toEqual(['none', 2]);
    expect(clock.sleeps()).toEqual([INTERVAL]);
  });

  it('polls a young head that never gets a check until the grace has passed, then ends none', async () => {
    const clock = steppedClock(NOW);
    const result = await waitForChecks({
      probe: () => Promise.resolve([]),
      timeoutMs: LONG,
      intervalMs: INTERVAL,
      now: clock.now,
      sleep: clock.sleep,
      headCommittedAtMs: NOW - 1_000,
    });

    // The head is 1s old at the first poll and 121s old at the seventh.
    expect([result.verdict, result.polls, result.elapsedMs]).toEqual(['none', 7, 6 * INTERVAL]);
    expect(result.rows).toEqual([]);
  });

  it('gives up at the deadline when it passes inside the grace', async () => {
    const clock = steppedClock(NOW);
    const result = await waitForChecks({
      probe: () => Promise.resolve([]),
      timeoutMs: 60_000,
      intervalMs: INTERVAL,
      now: clock.now,
      sleep: clock.sleep,
      headCommittedAtMs: NOW - 1_000,
    });

    expect([result.verdict, result.polls]).toEqual(['timeout', 3]);
    expect(result.rows).toEqual([]);
  });

  it('never holds a wait past the grace from its own start, whatever date the head carries', async () => {
    // A committed date is the committer's clock, so it can read ahead of
    // this one. An hour ahead must not turn two minutes into the deadline.
    const clock = steppedClock(NOW);
    const result = await waitForChecks({
      probe: () => Promise.resolve([]),
      timeoutMs: LONG,
      intervalMs: INTERVAL,
      now: clock.now,
      sleep: clock.sleep,
      headCommittedAtMs: NOW + 60 * 60_000,
    });

    expect([result.verdict, result.elapsedMs]).toEqual(['none', FIRST_CHECK_GRACE_MS]);
  });

  it('reads a head time that is no number as no head time', async () => {
    const clock = steppedClock(NOW);
    const result = await waitForChecks({
      probe: () => Promise.resolve([]),
      timeoutMs: LONG,
      intervalMs: INTERVAL,
      now: clock.now,
      sleep: clock.sleep,
      headCommittedAtMs: Number.NaN,
    });

    expect([result.verdict, result.polls]).toEqual(['none', 1]);
  });

  it('reports a poll the grace holds as pending, and the last one as none', async () => {
    const clock = steppedClock(NOW);
    const seen: string[] = [];
    await waitForChecks({
      probe: () => Promise.resolve([]),
      timeoutMs: LONG,
      intervalMs: INTERVAL,
      now: clock.now,
      sleep: clock.sleep,
      headCommittedAtMs: NOW - FIRST_CHECK_GRACE_MS + INTERVAL + 1,
      onPoll: (rows, verdict) => {
        seen.push(`${verdict} ${rows.length}`);
      },
    });

    expect(seen).toEqual(['pending 0', 'pending 0', 'none 0']);
  });
});
