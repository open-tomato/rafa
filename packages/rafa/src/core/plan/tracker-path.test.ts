/**
 * Tests for `tracker-path.ts`: the tracker path a plan file derives.
 *
 * These cases moved here with `trackerPathFor` from
 * `src/tests/plan-and-schedule.test.ts`.
 */
import { describe, expect, it } from 'bun:test';

import { trackerPathFor } from './tracker-path.js';

describe('trackerPathFor', () => {
  it('maps the default plan to the default tracker', () => {
    expect(trackerPathFor('/repo/PLAN.md')).toBe('/repo/PLAN_TRACKER.md');
  });

  it('keeps the stub suffix so plans get independent trackers', () => {
    expect(trackerPathFor('/repo/PLAN-auth-basic.md')).toBe('/repo/PLAN_TRACKER-auth-basic.md');
  });
});
