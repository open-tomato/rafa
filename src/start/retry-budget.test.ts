/**
 * Tests for the run's retry budget: how many retries `--retry` or
 * `loop.retries` grants one run, and what each call to take one answers.
 *
 * Every function here is pure, so each case hands it a budget and reads
 * the answer, and the budget handed in is read again afterwards to hold
 * that taking a retry never edits it. A budget that granted every call
 * would pass the granting cases alone, so each is paired with the call
 * past its last retry, which must be refused.
 */
import { describe, expect, it } from 'bun:test';

import {
  openRetryBudget,
  resolveRunRetries,
  takeRetry,
} from './retry-budget.js';

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
