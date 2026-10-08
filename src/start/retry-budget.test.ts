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
 * is read to write neither.
 */
import type { CliEvent } from '../ports/index.js';

import { afterEach, beforeEach, describe, expect, it } from 'bun:test';

import { setActiveOutput } from '../adapters/output/active.js';
import { sinkOutput } from '../tests/output-sinks.js';

import {
  createRunRetries,
  openRetryBudget,
  resolveRunRetries,
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

describe('retryLine', () => {
  it('says it retries, which retry of how many, and the stop', () => {
    expect(retryLine({ attempt: 1, of: 2 }, 'suite step red')).toBe(
      '🔁 Retrying (retry 1 of 2) after the stop: suite step red. The loop goes on without a new rafa loop start.',
    );
  });
});

describe('createRunRetries', () => {
  it('grants n retries, warning and emitting a retry event for each, then refuses', () => {
    const retries = createRunRetries({ retries: 2, isInterrupted: () => false });

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
    const retries = createRunRetries({ retries: false, isInterrupted: () => false });

    expect(retries.retry('suite step red')).toBe(false);
    expect([warnings, events]).toEqual([[], []]);
  });

  it('refuses once the run is interrupted, spending nothing of the budget', () => {
    let interrupted = true;
    const retries = createRunRetries({ retries: 1, isInterrupted: () => interrupted });

    expect(retries.retry('session exited 130')).toBe(false);
    expect([warnings, events]).toEqual([[], []]);

    // The control: the same budget grants its one retry once the flag is down.
    interrupted = false;
    expect(retries.retry('session exited 1')).toBe(true);
    expect(warnings).toHaveLength(1);
  });
});
