/**
 * Tests for the run's retry budget: how many retries `--retry` or
 * `loop.retries` grants one run, and what each call to take one answers.
 *
 * The budget's functions are pure, so each case hands one a budget and
 * reads the answer, and the budget handed in is read again afterwards to
 * hold that taking a retry never edits it. A budget that granted every
 * call would pass the granting cases alone, so each is paired with the
 * call past its last retry, which must be refused.
 *
 * {@link createRunRetries} is what `start.ts` asks at each retry-safe
 * stop. Its cases read the warning line and the `retry` event it writes
 * through a `sinkOutput` set as the active output, and a refused retry
 * is read to write neither. A checkout that moved refuses a retry as an
 * interrupt does, spending nothing; its control is the same budget
 * granting once the checkout reads as held, and a count of the reads
 * holds that a run with no retry left never reads the checkout at all.
 */
import type { CliEvent } from '../ports/index.js';

import { afterEach, beforeEach, describe, expect, it } from 'bun:test';

import { setActiveOutput } from '../adapters/output/active.js';
import { sinkOutput } from '../tests/output-sinks.js';

import {
  createRunRetries,
  openRetryBudget,
  resolveRunRetries,
  movedLine,
  retryLine,
  takeRetry,
} from './retry-budget.js';

/** Lines written at warn level. */
let warnings: string[] = [];

/** Every event but a log. */
let events: CliEvent[] = [];

beforeEach(() => {
  warnings = [];
  events = [];
  setActiveOutput(sinkOutput({
    warn: (message) => {
      warnings.push(message);
    },
    event: (event) => {
      events.push(event);
    },
  }));
});

afterEach(() => {
  setActiveOutput(null);
});

describe('resolveRunRetries', () => {
  it('takes the flag over the config when the flag names a count', () => {
    expect(resolveRunRetries(2, false)).toBe(2);
    expect(resolveRunRetries(1, 3)).toBe(1);
  });

  it('takes the config when the line names no --retry', () => {
    expect(resolveRunRetries(undefined, 3)).toBe(3);
    expect(resolveRunRetries(undefined, false)).toBe(false);
  });
});

describe('openRetryBudget', () => {
  it('opens a budget of n retries, none used, for a count', () => {
    expect(openRetryBudget(3)).toEqual({ of: 3, used: 0 });
  });

  it('opens an empty budget for false', () => {
    expect(openRetryBudget(false)).toEqual({ of: 0, used: 0 });
  });

  it('answers a frozen budget', () => {
    expect(Object.isFrozen(openRetryBudget(2))).toBe(true);
  });
});

describe('takeRetry', () => {
  it('grants the first retry of two, numbered 1 of 2, and counts it used', () => {
    const grant = takeRetry(openRetryBudget(2));

    expect(grant).toEqual({ granted: true, attempt: 1, of: 2, budget: { of: 2, used: 1 } });
  });

  it('grants each retry in turn, then refuses the one past the last', () => {
    const first = takeRetry(openRetryBudget(2));
    const second = takeRetry(first.budget);
    const third = takeRetry(second.budget);

    expect([first.granted, second.granted, third.granted]).toEqual([true, true, false]);
    expect(second).toMatchObject({ attempt: 2, of: 2 });
    expect(third).toEqual({ granted: false, budget: { of: 2, used: 2 } });
  });

  it('refuses every retry of an empty budget, so false halts as a run always did', () => {
    const refused = takeRetry(openRetryBudget(false));

    expect(refused).toEqual({ granted: false, budget: { of: 0, used: 0 } });
    expect(takeRetry(refused.budget).granted).toBe(false);
  });

  it('never edits the budget it is handed', () => {
    const budget = openRetryBudget(3);
    const grant = takeRetry(budget);

    expect(budget).toEqual({ of: 3, used: 0 });
    expect(grant.budget).not.toBe(budget);
    expect(Object.isFrozen(grant.budget)).toBe(true);
  });
});

describe('movedLine', () => {
  it('says no retry is taken, the stop, and that the checkout moved', () => {
    const line = movedLine('session exited 1');

    expect(line).toContain('No retry');
    expect(line).toContain('session exited 1');
    expect(line).toContain('checkout has moved');
  });
});

describe('retryLine', () => {
  it('says it retries, which retry of how many, and the stop', () => {
    expect(retryLine({ attempt: 1, of: 2 }, 'suite step red')).toBe(
      '🔁 Retrying (retry 1 of 2) after the stop: suite step red. The loop goes on without a new rafa loop start.',
    );
  });
});

describe('createRunRetries', () => {
  it('grants n retries, warning and emitting a retry event for each, then refuses', () => {
    const retries = createRunRetries({ retries: 2, isInterrupted: () => false, isCheckoutHeld: () => true });

    expect([retries.retry('suite step red'), retries.retry('session exited 1'), retries.retry('suite step red')])
      .toEqual([true, true, false]);
    expect(warnings).toEqual([
      retryLine({ attempt: 1, of: 2 }, 'suite step red'),
      retryLine({ attempt: 2, of: 2 }, 'session exited 1'),
    ]);
    expect(events.map((event) => event.type === 'event'
      ? [event.name, event.data]
      : null)).toEqual([
      ['retry', { attempt: 1, of: 2, reason: 'suite step red' }],
      ['retry', { attempt: 2, of: 2, reason: 'session exited 1' }],
    ]);
  });

  it('refuses every retry under false, writing nothing', () => {
    const retries = createRunRetries({ retries: false, isInterrupted: () => false, isCheckoutHeld: () => true });

    expect(retries.retry('suite step red')).toBe(false);
    expect([warnings, events]).toEqual([[], []]);
  });

  it('refuses once the run is interrupted, spending nothing of the budget', () => {
    let interrupted = true;
    const retries = createRunRetries({ retries: 1, isInterrupted: () => interrupted, isCheckoutHeld: () => true });

    expect(retries.retry('session exited 130')).toBe(false);
    expect([warnings, events]).toEqual([[], []]);

    // The control: the same budget grants its one retry once the flag is down.
    interrupted = false;
    expect(retries.retry('session exited 1')).toBe(true);
    expect(warnings).toHaveLength(1);
  });

  it('refuses while the checkout has moved, spending nothing of the budget, warning once and emitting nothing', () => {
    let held = false;
    const retries = createRunRetries({ retries: 1, isInterrupted: () => false, isCheckoutHeld: () => held });

    expect(retries.retry('session exited 1')).toBe(false);
    expect(warnings).toEqual([movedLine('session exited 1')]);
    expect(events).toEqual([]);
    warnings = [];

    // The control: the one retry is still there once the checkout holds.
    held = true;
    expect(retries.retry('session exited 1')).toBe(true);
    expect(warnings).toEqual([retryLine({ attempt: 1, of: 1 }, 'session exited 1')]);
  });

  it('reads the checkout only when a retry is left and the run is not interrupted', () => {
    let reads = 0;
    const isCheckoutHeld = (): boolean => {
      reads += 1;
      return true;
    };
    const none = createRunRetries({ retries: false, isInterrupted: () => false, isCheckoutHeld });
    const interrupted = createRunRetries({ retries: 1, isInterrupted: () => true, isCheckoutHeld });

    expect([none.retry('suite step red'), interrupted.retry('suite step red')]).toEqual([false, false]);
    expect(reads).toBe(0);

    // The control: a run with a retry left reads it once per ask.
    const one = createRunRetries({ retries: 1, isInterrupted: () => false, isCheckoutHeld });
    expect([one.retry('suite step red'), one.retry('suite step red')]).toEqual([true, false]);
    expect(reads).toBe(1);
  });
});

describe('createRunRetries readings for --continue', () => {
  it('counts the retries left, down to none', () => {
    const retries = createRunRetries({ retries: 2, isInterrupted: () => false, isCheckoutHeld: () => true });

    expect(retries.left()).toBe(2);
    retries.retry('suite step red');
    expect(retries.left()).toBe(1);
    retries.retry('suite step red');
    retries.retry('suite step red');
    expect(retries.left()).toBe(0);
    expect(createRunRetries({ retries: false, isInterrupted: () => false, isCheckoutHeld: () => true }).left()).toBe(0);
  });

  it('names why the last retry was refused: spent, interrupted or the checkout moved, and none after a grant', () => {
    let interrupted = false;
    let held = true;
    const retries = createRunRetries({ retries: 1, isInterrupted: () => interrupted, isCheckoutHeld: () => held });

    expect(retries.lastRefusal()).toBeNull();
    interrupted = true;
    retries.retry('session exited 1');
    expect(retries.lastRefusal()).toBe('interrupted');
    interrupted = false;
    held = false;
    retries.retry('session exited 1');
    expect(retries.lastRefusal()).toBe('checkout moved');
    held = true;
    retries.retry('session exited 1');
    expect(retries.lastRefusal()).toBeNull();
    retries.retry('session exited 1');
    expect(retries.lastRefusal()).toBe('spent');
  });
});
