/**
 * Tests for the effort reading of the pit stop (`pit-effort.ts`): the
 * collect run and timed through planted seams, the item's row and the
 * baseline read off a planted dashboard, and the lines rendered from them.
 *
 * No case runs `rafa` or reads the real store: `runCollect`,
 * `readDashboard` and `now` are planted. The store-read case plants the
 * rafa-1478 row and the `minutes` metric the plan measured at `9f5a5101`,
 * beside a row of another plan and a row of another kind keyed by the
 * same stub, so the row is seen to be picked by kind and key. Controls:
 * the no-rows and null-baseline cases read the same dashboard shape, so
 * their lines are seen to come from the missing row and the missing
 * baseline alone; the failed-collect cases count the dashboard calls
 * beside the store-read case, which counts one.
 */
import type { DashboardReadOptions, PitEffortSeams } from './pit-effort.js';
import type { Dashboard } from '@open-tomato/rafa-effort';

import { describe, expect, test } from 'bun:test';

import { collectLine, readPitEffort, renderPitEffort } from './pit-effort.js';

const STUB = 'rafa-1478-spec-loop-start-refuses';

/** A loops row with the figures the pit stop reads. */
function row(key: string, kind: string, tasks: number, p50: number, max: number): object {
  return { key, kind, tasks, perTask: { minutes: { min: null, avg: null, p50, max } } };
}

/** A dashboard holding `rows` and a `minutes` baseline of `baseline`. */
function dashboard(rows: readonly object[], baseline: number | null): Dashboard {
  const planted = {
    trend: {
      metrics: [
        { name: 'outputTokens', baselineP50: 9000 },
        { name: 'minutes', baselineP50: baseline },
      ],
    },
    loops: { rows },
  };
  return planted as unknown as Dashboard;
}

/** The measured rafa-1478 row, with a sibling plan and a non-plan row on the same key. */
const MEASURED_ROWS = [
  row('rafa-1470-other-plan', 'plan', 9, 3.2, 7.7),
  row(STUB, 'branch', 2, 9.9, 9.9),
  row(STUB, 'plan', 5, 1.483, 4.318),
];

interface Planted {
  readonly seams: PitEffortSeams;
  readonly dashboardCalls: DashboardReadOptions[];
}

/** Seams answering `exitCode` for the collect and `read` for the dashboard, the clock stepping 2.5 s a call. */
function plant(exitCode: number | null, read: () => Promise<Dashboard>): Planted {
  const dashboardCalls: DashboardReadOptions[] = [];
  let tick = Date.parse('2026-11-06T10:00:00.000Z');
  const seams: PitEffortSeams = {
    runCollect: () => Promise.resolve(exitCode),
    readDashboard: (options) => {
      dashboardCalls.push(options);
      return read();
    },
    now: () => {
      const at = new Date(tick);
      tick += 2500;
      return at;
    },
  };
  return { seams, dashboardCalls };
}

const QUERY = { root: '/repo', stub: STUB, home: '/home/user' };

describe('readPitEffort', () => {
  test('a store read renders the measured rafa-1478 row as the plan describes', async () => {
    const { seams, dashboardCalls } = plant(0, () => Promise.resolve(dashboard(MEASURED_ROWS, 5.484)));

    const { effort, collect } = await readPitEffort(seams, QUERY);

    expect(effort).toEqual({ ok: true, value: { stub: STUB, tasks: 5, p50: 1.483, max: 4.318, baseline: 5.484 } });
    expect(renderPitEffort(effort)).toBe(
      'Effort: rafa-1478-spec-loop-start-refuses: 5 tasks, p50 1.5 min against 5.5 min, max 4.3 min.',
    );
    expect(collect).toEqual({ exitCode: 0, seconds: 2.5 });
    expect(collectLine(collect)).toBe('rafa effort collect ended 0 in 2.5s');
    expect(dashboardCalls).toHaveLength(1);
    expect(dashboardCalls[0]?.repoRoot).toBe('/repo');
    expect(dashboardCalls[0]?.home).toBe('/home/user');
    expect(dashboardCalls[0]?.trend).toMatchObject({ days: 14, recentDays: 3, loops: null, by: null });
  });

  test('a store not read is not read with its message, and no figure reads 0', async () => {
    const { seams } = plant(0, () => Promise.reject(new Error('the effort store is locked')));

    const { effort } = await readPitEffort(seams, QUERY);

    expect(effort).toEqual({ ok: false, reason: 'the effort store is locked' });
    const line = renderPitEffort(effort);
    expect(line).toBe('Effort: not read (the effort store is locked).');
    expect(line).not.toMatch(/\b0\b/);
  });

  test('a collect that ended 1 is not read and the dashboard is never read', async () => {
    const { seams, dashboardCalls } = plant(1, () => Promise.resolve(dashboard(MEASURED_ROWS, 5.484)));

    const { effort, collect } = await readPitEffort(seams, QUERY);

    expect(renderPitEffort(effort)).toBe('Effort: not read (rafa effort collect ended with exit code 1).');
    expect(collectLine(collect)).toBe('rafa effort collect ended 1 in 2.5s');
    expect(dashboardCalls).toHaveLength(0);
  });

  test('a collect that could not start is not read and the dashboard is never read', async () => {
    const { seams, dashboardCalls } = plant(null, () => Promise.resolve(dashboard(MEASURED_ROWS, 5.484)));

    const { effort, collect } = await readPitEffort(seams, QUERY);

    expect(renderPitEffort(effort)).toBe('Effort: not read (rafa effort collect could not start).');
    expect(collect.exitCode).toBeNull();
    expect(collectLine(collect)).not.toMatch(/ended/);
    expect(dashboardCalls).toHaveLength(0);
  });

  test('a collect that throws reads as one that could not start', async () => {
    const { seams, dashboardCalls } = plant(0, () => Promise.resolve(dashboard(MEASURED_ROWS, 5.484)));
    const throwing: PitEffortSeams = { ...seams, runCollect: () => Promise.reject(new Error('spawn ENOENT')) };

    const { effort } = await readPitEffort(throwing, QUERY);

    expect(effort).toEqual({ ok: false, reason: 'rafa effort collect could not start' });
    expect(dashboardCalls).toHaveLength(0);
  });

  test('a plan with no rows reads as no task sessions stored', async () => {
    const { seams } = plant(0, () => Promise.resolve(dashboard([MEASURED_ROWS[0] ?? {}], 5.484)));

    const { effort } = await readPitEffort(seams, QUERY);

    expect(effort).toEqual({ ok: true, value: { stub: STUB, rows: 0 } });
    expect(renderPitEffort(effort)).toBe('Effort: rafa-1478-spec-loop-start-refuses: no task sessions stored.');
  });

  test('a null baseline renders against no baseline', async () => {
    const { seams } = plant(0, () => Promise.resolve(dashboard(MEASURED_ROWS, null)));

    const { effort } = await readPitEffort(seams, QUERY);

    expect(renderPitEffort(effort)).toBe(
      'Effort: rafa-1478-spec-loop-start-refuses: 5 tasks, p50 1.5 min against no baseline, max 4.3 min.',
    );
  });
});
