/**
 * Tests for `ci-poll.ts`: the interval both waits poll a pull request's
 * checks at is twenty seconds, a positive whole number of milliseconds.
 */
import { describe, expect, it } from 'bun:test';

import { CI_POLL_INTERVAL_MS } from './ci-poll.js';

describe('CI_POLL_INTERVAL_MS', () => {
  it('is twenty seconds', () => {
    expect(CI_POLL_INTERVAL_MS).toBe(20_000);
  });

  it('is a positive integer of milliseconds', () => {
    expect(Number.isInteger(CI_POLL_INTERVAL_MS)).toBe(true);
    expect(CI_POLL_INTERVAL_MS).toBeGreaterThan(0);
  });
});
