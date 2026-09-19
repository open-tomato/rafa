/**
 * Tests for the attempt guard (`src/pr/triage/attempts.ts`): the
 * counter raised before each `--resolve` run, and the two readings that
 * stop the loop.
 *
 * The module is pure, so every case here is a direct call over
 * literals. Nothing plants a repository, spawns a process or reads a
 * clock.
 *
 * The guard is a STOP, which is the shape of check that passes while
 * wrong most easily: a reading stuck at "stop" satisfies every case
 * that asserts a stop and is a `--resolve` that never resolves
 * anything. So each stop here is paired with a control that must NOT
 * stop:
 *
 *  - the cap case walks a whole loop at `--max-attempts=2` and asserts
 *    the first two readings run and only the third stops, rather than
 *    asserting the stop alone;
 *  - the repeat case pairs the same class at the same step against the
 *    same class at a DIFFERENT step and against a different class at
 *    the same step, both of which are progress and must go on;
 *  - the both-steps-absent repeat is paired with a first run, whose
 *    null `previous` must never read as a repeat.
 *
 * The stop set is held closed from both ends the way
 * `classes.test.ts` holds the class set: {@link EVERY_STOP} labels one
 * input per stop and the closed-set case asserts the stops it produced
 * are exactly {@link ATTEMPT_STOPS}, so a third stop added to the
 * module without a case here reddens rather than passing unmeasured.
 *
 * Five mutations of `attempts.ts` were driven against this file on
 * 2026-09-19, one at a time, the module restored from a scratch copy
 * and verified with `shasum -c` after each. 25 pass either side, and
 * each count below is the run's own, not a prediction:
 *
 *  - `readAttemptStart` comparing `spent > maxAttempts` instead of
 *    `>=`, which hands every pull request one extra run: 4 fail, the
 *    two loop cases, the cap-on-the-reading case and the closed-set
 *    case, which is what ties the cap stop to the declared set.
 *  - the counter raised to `spent` rather than `spent + 1`, so a loop
 *    never advances: 4 fail, every case that reads a running attempt.
 *  - `spentAttempts` passing a negative stored count straight through:
 *    2 fail, the unusable-stored-count case and the hand-edited `-5`
 *    case that shows what a passthrough would spend.
 *  - `isSameAttemptOutcome` comparing the class alone: 2 fail, the
 *    same-class-different-step control and the repeat reading built on
 *    it.
 *  - `stepKey` answering the raw name, so a re-indented command reads
 *    as a different step: 1 fail, the whitespace case.
 */
import type { AttemptOutcome, AttemptStop } from './attempts.js';
import type { FailedStep } from './evidence.js';

import { describe, expect, it } from 'bun:test';

import {
  ATTEMPT_STOPS,
  isAttemptStop,
  isSameAttemptOutcome,
  NO_STEP_KEY,
  readAttemptRepeat,
  readAttemptStart,
  spentAttempts,
  stepKey,
} from './attempts.js';

/** The cap every case that does not vary it reads against. */
const CAP = 2;

/** A failing step as the log reader answers one. */
function step(name: string, source: FailedStep['source'] = 'step-column'): FailedStep {
  return { name, source };
}

/** What one run ended as. */
function ended(
  triageClass: AttemptOutcome['triageClass'],
  failing?: FailedStep,
): AttemptOutcome {
  return { triageClass, step: failing };
}

/** One input per stop, so the closed-set case can produce every one of them. */
const EVERY_STOP: Readonly<Record<AttemptStop, () => AttemptStop | null>> = {
  cap: () => readAttemptStart({ stored: CAP, maxAttempts: CAP }).stop,
  repeat: () => readAttemptRepeat({
    previous: ended('ci-lint', step('bun run lint')),
    outcome: ended('ci-lint', step('bun run lint')),
    attempts: 2,
    maxAttempts: CAP,
  }).stop,
};

describe('spentAttempts', () => {
  it('reads an absent or unusable stored count as none spent', () => {
    // Arrange
    const stored = [null, undefined, -5, -0.5, 0.75, Number.NaN, '3', {}];

    // Act
    const counts = stored.map((value) => spentAttempts(value));

    // Assert
    expect(counts).toEqual([0, 0, 0, 0, 0, 0, 0, 0]);
  });

  it('reads a whole stored count as itself and floors a fractional one', () => {
    // Arrange
    const stored = [0, 1, 2, 9, 1.9];

    // Act
    const counts = stored.map((value) => spentAttempts(value));

    // Assert
    expect(counts).toEqual([0, 1, 2, 9, 1]);
  });
});

describe('readAttemptStart', () => {
  it('runs twice and stops on the third reading at a cap of two', () => {
    // Arrange
    const cap = 2;

    // Act
    const first = readAttemptStart({ stored: 0, maxAttempts: cap });
    const second = readAttemptStart({ stored: first.attempts, maxAttempts: cap });
    const third = readAttemptStart({ stored: second.attempts, maxAttempts: cap });

    // Assert
    expect([first.stopped, second.stopped, third.stopped]).toEqual([false, false, true]);
    expect([first.attempts, second.attempts, third.attempts]).toEqual([1, 2, 2]);
    expect(third.stop).toBe('cap');
    expect([first.stop, second.stop]).toEqual([null, null]);
  });

  it('runs three times at a cap of three, so the cap is read and not hardcoded', () => {
    // Arrange
    const cap = 3;

    // Act
    const readings = [0, 1, 2, 3].map(
      (stored) => readAttemptStart({ stored, maxAttempts: cap }),
    );

    // Assert
    expect(readings.map((reading) => reading.stopped)).toEqual([false, false, false, true]);
    expect(readings.map((reading) => reading.attempts)).toEqual([1, 2, 3, 3]);
  });

  it('stops at a stored count over the cap without raising it further', () => {
    // Arrange
    const stored = 7;

    // Act
    const reading = readAttemptStart({ stored, maxAttempts: CAP });

    // Assert
    expect(reading.stop).toBe('cap');
    expect(reading.attempts).toBe(stored);
    expect(reading.reason).toBe('7 of 2 resolve attempts spent');
  });

  it('runs a first attempt from a hand-edited negative stored count', () => {
    // Arrange
    const stored = -5;

    // Act
    const reading = readAttemptStart({ stored, maxAttempts: CAP });

    // Assert
    expect(reading.stopped).toBe(false);
    expect(reading.attempts).toBe(1);
    expect(reading.reason).toBe('resolve attempt 1 of 2');
  });

  it('carries the cap onto the reading and names both numbers in the reason', () => {
    // Act
    const running = readAttemptStart({ stored: 1, maxAttempts: 4 });
    const stopped = readAttemptStart({ stored: 4, maxAttempts: 4 });

    // Assert
    expect(running.maxAttempts).toBe(4);
    expect(running.reason).toBe('resolve attempt 2 of 4');
    expect(stopped.maxAttempts).toBe(4);
    expect(stopped.reason).toBe('4 of 4 resolve attempts spent');
  });

  it('refuses a cap that is not a positive whole number', () => {
    // Arrange
    const caps = [0, -1, 1.5, Number.NaN];

    // Act
    const refusals = caps.map((cap) => {
      try {
        readAttemptStart({ stored: 0, maxAttempts: cap });
        return 'accepted';
      } catch (error) {
        return (error as Error).message;
      }
    });

    // Assert
    expect(refusals.every((message) => message.startsWith('pr triage attempts:'))).toBe(true);
    expect(refusals[0]).toBe(
      'pr triage attempts: refused a cap of 0, expected a positive whole number',
    );
  });
});

describe('stepKey', () => {
  it('answers the empty key for a run whose log named no step', () => {
    // Act & Assert
    expect(stepKey(undefined)).toBe(NO_STEP_KEY);
    expect(NO_STEP_KEY).toBe('');
  });

  it('collapses whitespace so a re-indented command is the same step', () => {
    // Arrange
    const loose = step('  bun run\n\t lint  ', 'group-marker');

    // Act
    const key = stepKey(loose);

    // Assert
    expect(key).toBe('bun run lint');
    expect(key).toBe(stepKey(step('bun run lint')));
  });
});

describe('isSameAttemptOutcome', () => {
  it('reads the same class at the same step as the same outcome', () => {
    // Act & Assert
    expect(isSameAttemptOutcome(
      ended('ci-install', step('bun install')),
      ended('ci-install', step('bun install')),
    )).toBe(true);
  });

  it('reads the same step under a different class as progress', () => {
    // Act & Assert
    expect(isSameAttemptOutcome(
      ended('ci-install', step('bun install')),
      ended('ci-lint', step('bun install')),
    )).toBe(false);
  });

  it('reads the same class at a different step as progress', () => {
    // Act & Assert
    expect(isSameAttemptOutcome(
      ended('ci-lint', step('bun run lint')),
      ended('ci-lint', step('bun run lint:css')),
    )).toBe(false);
  });

  it('ignores where the step name was read from', () => {
    // Act & Assert
    expect(isSameAttemptOutcome(
      ended('ci-lint', step('bun run lint', 'step-column')),
      ended('ci-lint', step('bun run lint', 'group-marker')),
    )).toBe(true);
  });

  it('reads two runs that named no step as the same outcome', () => {
    // Act & Assert
    expect(isSameAttemptOutcome(ended('ci-other'), ended('ci-other'))).toBe(true);
  });

  it('never reads a first run as a repeat', () => {
    // Act & Assert
    expect(isSameAttemptOutcome(null, ended('ci-other'))).toBe(false);
    expect(isSameAttemptOutcome(null, ended('ci-lint', step('bun run lint')))).toBe(false);
  });
});

describe('readAttemptRepeat', () => {
  it('stops on the same class at the same step and names both in the reason', () => {
    // Arrange
    const failing = step('bun run lint');

    // Act
    const reading = readAttemptRepeat({
      previous: ended('ci-lint', failing),
      outcome: ended('ci-lint', failing),
      attempts: 2,
      maxAttempts: CAP,
    });

    // Assert
    expect(reading.stop).toBe('repeat');
    expect(reading.stopped).toBe(true);
    expect(reading.reason).toBe(
      'attempt 2 ended as `ci-lint` at `bun run lint`, the same reading as the run before it',
    );
  });

  it('goes on when the step moved under the same class', () => {
    // Act
    const reading = readAttemptRepeat({
      previous: ended('ci-lint', step('bun run lint')),
      outcome: ended('ci-lint', step('bun run typecheck')),
      attempts: 2,
      maxAttempts: CAP,
    });

    // Assert
    expect(reading.stop).toBe(null);
    expect(reading.stopped).toBe(false);
    expect(reading.reason).toContain('the run before it ended as `ci-lint` at `bun run lint`');
  });

  it('goes on after a first run, with no earlier run to compare against', () => {
    // Act
    const reading = readAttemptRepeat({
      previous: null,
      outcome: ended('conflict-lockfile'),
      attempts: 1,
      maxAttempts: CAP,
    });

    // Assert
    expect(reading.stopped).toBe(false);
    expect(reading.reason).toBe(
      'attempt 1 ended as `conflict-lockfile` with no step named,'
        + ' no earlier run to compare against',
    );
  });

  it('stops on two runs that both named no step', () => {
    // Act
    const reading = readAttemptRepeat({
      previous: ended('ci-other'),
      outcome: ended('ci-other'),
      attempts: 2,
      maxAttempts: CAP,
    });

    // Assert
    expect(reading.stop).toBe('repeat');
    expect(reading.reason).toBe(
      'attempt 2 ended as `ci-other` with no step named, the same reading as the run before it',
    );
  });

  it('carries the count and the cap through without spending another attempt', () => {
    // Act
    const reading = readAttemptRepeat({
      previous: ended('ci-lint', step('bun run lint')),
      outcome: ended('ci-test', step('bun test')),
      attempts: 1,
      maxAttempts: 3,
    });

    // Assert
    expect(reading.attempts).toBe(1);
    expect(reading.maxAttempts).toBe(3);
  });

  it('refuses a cap that is not a positive whole number', () => {
    // Act & Assert
    expect(() => readAttemptRepeat({
      previous: null,
      outcome: ended('ci-lint', step('bun run lint')),
      attempts: 1,
      maxAttempts: 0,
    })).toThrow('pr triage attempts: refused a cap of 0');
  });
});

describe('the stop set', () => {
  it('accepts every stop and refuses anything else', () => {
    // Act & Assert
    expect(ATTEMPT_STOPS.every((stop) => isAttemptStop(stop))).toBe(true);
    expect([null, undefined, 'stop', 'cap ', 3].some((value) => isAttemptStop(value)))
      .toBe(false);
  });

  it('produces exactly the stops the module declares', () => {
    // Arrange
    const labelled = Object.keys(EVERY_STOP) as readonly AttemptStop[];

    // Act
    const produced = labelled.map((stop) => EVERY_STOP[stop]());

    // Assert
    expect(produced).toEqual([...labelled]);
    expect([...labelled].sort()).toEqual([...ATTEMPT_STOPS].sort());
  });

  it('is frozen, so no caller widens what a later reader accepts', () => {
    // Act & Assert
    expect(Object.isFrozen(ATTEMPT_STOPS)).toBe(true);
  });
});
