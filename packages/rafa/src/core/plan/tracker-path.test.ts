/**
 * Tests for `tracker-path.ts`: the tracker path a plan file derives.
 *
 * These cases moved here with `trackerPathFor` from
 * `src/tests/plan-and-schedule.test.ts`.
 */
import { describe, expect, it } from 'bun:test';

import { trackerPathFor } from './tracker-path.js';

/**
 * The spec's one-second bound on a crafted path: the old pattern, tried
 * from every `PLAN` of a long name, took about 1.8 s on
 * {@link CRAFTED_STUBS} stubs and grows with its square.
 */
const REDOS_BOUND_MS = 1000;

/**
 * `PLAN-` stubs in the crafted name, 100,000 characters: at the plan's
 * 50,000 the old pattern took about 0.45 s, under the bound, so the
 * shape is doubled for the case to fail on it.
 */
const CRAFTED_STUBS = 20_000;

describe('trackerPathFor', () => {
  it('maps the default plan to the default tracker', () => {
    expect(trackerPathFor('/repo/PLAN.md')).toBe('/repo/PLAN_TRACKER.md');
  });

  it('keeps the stub suffix so plans get independent trackers', () => {
    expect(trackerPathFor('/repo/PLAN-auth-basic.md')).toBe('/repo/PLAN_TRACKER-auth-basic.md');
  });

  it('rewrites the first PLAN of the last path segment, wherever in the name it stands', () => {
    expect(trackerPathFor('/a/PLAN-x/PLAN.md')).toBe('/a/PLAN-x/PLAN_TRACKER.md');
    expect(trackerPathFor('/repo/MYPLAN-a.md')).toBe('/repo/MYPLAN_TRACKER-a.md');
    expect(trackerPathFor('/repo/PLAN-a-PLAN-b.md')).toBe('/repo/PLAN_TRACKER-a-PLAN-b.md');
    expect(trackerPathFor('/repo/PLANPLAN.md')).toBe('/repo/PLANPLAN_TRACKER.md');
    expect(trackerPathFor('PLAN-.md')).toBe('PLAN_TRACKER-.md');
  });

  it('leaves a path that names no plan file as it is', () => {
    for (const path of ['/repo/PLAN-a.txt', '/repo/PLANS.md', '/repo/PLAN-a.md/', '/repo/PLAN.md.md', '']) {
      expect(trackerPathFor(path)).toBe(path);
    }
  });

  it('leaves a long name of stubs and no .md as it is, within REDOS_BOUND_MS', () => {
    const path = 'PLAN-'.repeat(CRAFTED_STUBS);

    const started = performance.now();
    const tracker = trackerPathFor(path);
    const elapsed = performance.now() - started;

    expect(elapsed).toBeLessThan(REDOS_BOUND_MS);
    expect(tracker).toBe(path);
    // Control: the same name ending in .md is a plan file, its first PLAN rewritten.
    expect(trackerPathFor(`${path}.md`)).toBe(`PLAN_TRACKER-${path.slice('PLAN-'.length)}.md`);
  });
});
