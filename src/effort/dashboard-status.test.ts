/**
 * Tests for the dashboard's status widget (`dashboard-status.ts`): the two
 * estimates it computes itself over hand-built counts, and `statusWidget`
 * over records planted under a temporary project root holding plan files.
 *
 * `statusWidget` reads the states it is handed and probes no pid. The
 * store is absent unless a case writes task reports into it, in which case
 * the third estimate, `bySession`, has finishes to read.
 *
 * The demo plan counts 1 done, 1 blocked and 2 open, so 3 tasks are left.
 * The second plan, `other`, counts 1 done and 4 open, so 4 are left.
 */
import type { LoopRow } from './report-trend.js';
import type { TaskCounts } from '../plan/plan-files.js';

import { mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, describe, expect, it } from 'bun:test';

import {
  DEMO_PLAN_PATH,
  plantDemoProject,
  plantFile,
  sessionRecord,
} from '../tests/loop-session-fixtures.js';

import { byProgressEstimate, byTaskEstimate, statusWidget } from './dashboard-status.js';
import { writeTaskReport } from './store/reports.js';

const tempBase = realpathSync(mkdtempSync(join(tmpdir(), 'rafa-dashboard-status-')));

afterAll(() => {
  rmSync(tempBase, { recursive: true, force: true });
});

/** The demo tracker's counts. */
const DEMO_COUNTS: TaskCounts = { total: 4, done: 1, blocked: 1, open: 2 };

/** The plan `other`, at its own path beside the demo plan. */
const OTHER_PLAN_PATH = '.plans/PLAN-other.md';
const OTHER_PLAN = [
  '# Plan: other',
  '',
  '# Stage: one',
  '',
  '- [x] One',
  '- [ ] Two',
  '- [ ] Three',
  '- [ ] Four',
  '- [ ] Five',
  '',
].join('\n');

/** A loop row of `key` and `kind` whose tasks average `avgMinutes` over `tasks` sessions. */
function loopRow(key: string, avgMinutes: number | null, tasks = 3, kind: LoopRow['kind'] = 'plan'): LoopRow {
  const spread = { min: null, max: null, avg: avgMinutes, p50: null };
  return {
    key,
    kind,
    firstTimestamp: '2026-09-15T10:00:00.000Z',
    lastTimestamp: '2026-09-15T11:00:00.000Z',
    wallMinutes: 60,
    workMinutes: 30,
    tasks,
    notDone: 0,
    unreported: 0,
    perTask: { minutes: spread, outputTokens: spread, cacheReadTokens: spread, turns: spread },
    models: {},
    efforts: {},
    agents: {},
    groups: null,
  };
}

/** A task report of `planStub` collected at `at`, written under `root` as the loop writes one. */
function finish(root: string, at: string, planStub = 'demo'): void {
  writeTaskReport(root, {
    dispatch: { sessionId: `task-${at}`, planStub, taskLine: '- [ ] A task' },
    outcome: 'done',
    report: { status: 'done' },
  }, { now: () => new Date(at), newId: () => `row-${at}` });
}

describe('byTaskEstimate', () => {
  it('multiplies the mean task minutes as seconds by the open and blocked tasks left', () => {
    // 12.5 min = 750 s per task, times 3 left.
    expect(byTaskEstimate(loopRow('demo', 12.5, 7), DEMO_COUNTS)).toEqual({
      secondsPerTask: 750,
      seconds: 2250,
      sessions: 7,
    });
  });

  it('rounds the pace to whole seconds before the total is rounded from the unrounded pace', () => {
    // 1.234 min = 74.04 s: 74 per task, and 74.04 * 3 = 222.12 rounds to 222.
    expect(byTaskEstimate(loopRow('demo', 1.234), DEMO_COUNTS)).toMatchObject({ secondsPerTask: 74, seconds: 222 });
  });

  it('answers a zero total when no task is left', () => {
    expect(byTaskEstimate(loopRow('demo', 10), { total: 2, done: 2, blocked: 0, open: 0 })).toMatchObject({
      secondsPerTask: 600,
      seconds: 0,
    });
  });

  it('counts a blocked task as left', () => {
    expect(byTaskEstimate(loopRow('demo', 1), { total: 1, done: 0, blocked: 1, open: 0 })?.seconds).toBe(60);
  });

  it('answers null without a loop row', () => {
    expect(byTaskEstimate(undefined, DEMO_COUNTS)).toBeNull();
  });

  it('answers null when the row has no mean', () => {
    expect(byTaskEstimate(loopRow('demo', null), DEMO_COUNTS)).toBeNull();
  });
});

describe('byProgressEstimate', () => {
  const started = '2026-09-15T10:00:00.000Z';
  const now = new Date('2026-09-15T12:00:00.000Z');

  it('divides the time since the plan started by the tasks done, then multiplies by the tasks left', () => {
    // 2 h = 7200 s for 1 task done, 3 left.
    expect(byProgressEstimate(started, DEMO_COUNTS, now)).toEqual({
      secondsPerTask: 7200,
      seconds: 21_600,
      planStartedAt: started,
      elapsedSeconds: 7200,
    });
  });

  it('spreads the elapsed time over every task done', () => {
    // 7200 s over 2 done = 3600 per task, 3 left.
    expect(byProgressEstimate(started, { total: 5, done: 2, blocked: 0, open: 3 }, now)).toMatchObject({
      secondsPerTask: 3600,
      seconds: 10_800,
    });
  });

  it('answers null when no task is done', () => {
    expect(byProgressEstimate(started, { total: 4, done: 0, blocked: 0, open: 4 }, now)).toBeNull();
  });

  it('holds elapsed time at zero when now is before the start', () => {
    expect(byProgressEstimate(started, DEMO_COUNTS, new Date('2026-09-15T09:00:00.000Z'))).toMatchObject({
      secondsPerTask: 0,
      seconds: 0,
      elapsedSeconds: 0,
    });
  });

  it('answers a zero total when nothing is left', () => {
    expect(byProgressEstimate(started, { total: 1, done: 1, blocked: 0, open: 0 }, now)?.seconds).toBe(0);
  });
});

describe('statusWidget', () => {
  const now = new Date('2026-09-15T14:00:00.000Z');

  it('lists only running and paused records, counting each state', () => {
    const { root } = plantDemoProject(tempBase);
    const records = [
      sessionRecord({ sessionId: 'run', state: 'running' }),
      sessionRecord({ sessionId: 'pause', state: 'paused' }),
      sessionRecord({ sessionId: 'finished', state: 'done' }),
      sessionRecord({ sessionId: 'gone', state: 'stopped' }),
    ];

    const widget = statusWidget(root, records, { loopRows: [], now });

    expect(widget.loops.map((loop) => [loop.sessionId, loop.state])).toEqual([['run', 'running'], ['pause', 'paused']]);
    expect([widget.running, widget.paused]).toEqual([1, 1]);
  });

  it('answers an empty widget for no record', () => {
    const { root } = plantDemoProject(tempBase);

    expect(statusWidget(root, [], { loopRows: [], now })).toEqual({
      running: 0,
      paused: 0,
      tasks: { total: 0, done: 0, blocked: 0, open: 0 },
      longest: { byTask: null, byProgress: null, bySession: null },
      loops: [],
    });
  });

  it('answers empty counters when every record is finished', () => {
    const { root } = plantDemoProject(tempBase);

    const widget = statusWidget(root, [sessionRecord({ state: 'done' })], { loopRows: [], now });

    expect(widget).toMatchObject({ running: 0, paused: 0, loops: [] });
  });

  it('carries each loop\'s identity, task and counts from its record and plan', () => {
    const { root } = plantDemoProject(tempBase);

    const [loop] = statusWidget(root, [sessionRecord()], { loopRows: [], now }).loops;

    expect(loop).toMatchObject({
      sessionId: 'session-0500',
      planStub: 'demo',
      branch: 'feat/demo',
      state: 'running',
      startedAt: '2026-09-15T12:00:00.000Z',
      task: { line: 6, text: 'Second task' },
      tasks: DEMO_COUNTS,
    });
  });

  it('reads byProgress from the oldest record of the same plan stub, finished records included', () => {
    const { root } = plantDemoProject(tempBase);
    const records = [
      sessionRecord({ sessionId: 'earlier', startedAt: '2026-09-15T08:00:00.000Z', state: 'done' }),
      sessionRecord({ sessionId: 'later', startedAt: '2026-09-15T12:00:00.000Z' }),
    ];

    const [loop] = statusWidget(root, records, { loopRows: [], now }).loops;

    // From 08:00 to 14:00 is 21600 s, per 1 task done, times 3 left.
    expect(loop?.byProgress).toEqual({
      secondsPerTask: 21_600,
      seconds: 64_800,
      planStartedAt: '2026-09-15T08:00:00.000Z',
      elapsedSeconds: 21_600,
    });
  });

  it('does not take another plan\'s record as the start', () => {
    const { root } = plantDemoProject(tempBase);
    const records = [
      sessionRecord({ sessionId: 'elsewhere', planStub: 'other', startedAt: '2026-09-15T01:00:00.000Z', state: 'done' }),
      sessionRecord({ sessionId: 'mine', startedAt: '2026-09-15T12:00:00.000Z' }),
    ];

    const [loop] = statusWidget(root, records, { loopRows: [], now }).loops;

    expect(loop?.byProgress?.planStartedAt).toBe('2026-09-15T12:00:00.000Z');
  });

  it('passes over a record whose start does not parse and uses the plan\'s valid older one', () => {
    const { root } = plantDemoProject(tempBase);
    const records = [
      sessionRecord({ sessionId: 'bad', startedAt: 'not a date', state: 'done' }),
      sessionRecord({ sessionId: 'older', startedAt: '2026-09-15T08:00:00.000Z', state: 'done' }),
      sessionRecord({ sessionId: 'live', startedAt: '2026-09-15T12:00:00.000Z' }),
    ];

    const [loop] = statusWidget(root, records, { loopRows: [], now }).loops;

    expect(loop?.byProgress).toMatchObject({ planStartedAt: '2026-09-15T08:00:00.000Z', elapsedSeconds: 21_600 });
  });

  it('uses a valid peer\'s start when the live record\'s own does not parse', () => {
    const { root } = plantDemoProject(tempBase);
    const records = [
      sessionRecord({ sessionId: 'peer', startedAt: '2026-09-15T10:00:00.000Z', state: 'done' }),
      sessionRecord({ sessionId: 'live', startedAt: 'garbled' }),
    ];

    const [loop] = statusWidget(root, records, { loopRows: [], now }).loops;

    expect(loop?.byProgress?.planStartedAt).toBe('2026-09-15T10:00:00.000Z');
  });

  it('answers a null byProgress, never a NaN one, when no start of the plan parses', () => {
    const { root } = plantDemoProject(tempBase);
    const records = [
      sessionRecord({ sessionId: 'bad', startedAt: 'garbled' }),
      sessionRecord({ sessionId: 'worse', startedAt: '', state: 'done' }),
    ];

    const widget = statusWidget(root, records, { loopRows: [], now });

    expect(widget.loops[0]?.byProgress).toBeNull();
    expect(widget.longest.byProgress).toBeNull();
  });

  it('takes a record with no plan stub as its own start', () => {
    const { root } = plantDemoProject(tempBase);
    const records = [
      sessionRecord({ sessionId: 'old', planStub: null, startedAt: '2026-09-15T05:00:00.000Z', state: 'done' }),
      sessionRecord({ sessionId: 'new', planStub: null, startedAt: '2026-09-15T12:00:00.000Z' }),
    ];

    const [loop] = statusWidget(root, records, { loopRows: [], now }).loops;

    expect(loop?.byProgress?.planStartedAt).toBe('2026-09-15T12:00:00.000Z');
  });

  it('reads byTask from the loop row keyed by the plan stub, and none from a branch row of the same name', () => {
    const { root } = plantDemoProject(tempBase);
    const loopRows = [loopRow('demo', 5, 9, 'branch'), loopRow('demo', 10, 4)];

    const matched = statusWidget(root, [sessionRecord()], { loopRows, now }).loops[0];
    const branchOnly = statusWidget(root, [sessionRecord()], { loopRows: [loopRow('demo', 5, 9, 'branch')], now }).loops[0];

    // 10 min = 600 s per task, 3 left, from the 4 sessions of the plan row.
    expect(matched?.byTask).toEqual({ secondsPerTask: 600, seconds: 1800, sessions: 4 });
    expect(branchOnly?.byTask).toBeNull();
  });

  it('reads bySession from the finishes the store holds for the plan from the record\'s start on', () => {
    const { root } = plantDemoProject(tempBase);
    finish(root, '2026-09-15T11:00:00.000Z');
    finish(root, '2026-09-15T12:30:00.000Z');
    finish(root, '2026-09-15T12:45:00.000Z', 'other');

    const [loop] = statusWidget(root, [sessionRecord()], { loopRows: [], now }).loops;

    // One finish, 30 min after the 12:00 start: 1800 s per task, 3 left.
    expect(loop?.bySession).toEqual({ finished: 1, left: 3, secondsPerTask: 1800, seconds: 5400 });
  });

  it('answers a bySession with no pace when the store is absent', () => {
    const { root } = plantDemoProject(tempBase);

    const [loop] = statusWidget(root, [sessionRecord()], { loopRows: [], now }).loops;

    expect(loop?.bySession).toEqual({ finished: 0, left: 3, secondsPerTask: null, seconds: null });
  });

  it('answers no counts and no estimate for a record whose plan is gone', () => {
    const { root } = plantDemoProject(tempBase);
    const record = sessionRecord({ plan: '.plans/PLAN-missing.md' });

    const widget = statusWidget(root, [record], { loopRows: [loopRow('demo', 10)], now });

    expect(widget.loops[0]).toMatchObject({ tasks: null, byTask: null, byProgress: null, bySession: null });
    expect(widget.tasks).toEqual({ total: 0, done: 0, blocked: 0, open: 0 });
    expect(widget.longest).toEqual({ byTask: null, byProgress: null, bySession: null });
    expect(widget.running).toBe(1);
  });

  it('answers a null byProgress for a plan with no task done', () => {
    const { root } = plantDemoProject(tempBase);
    plantFile(root, DEMO_PLAN_PATH, '# Plan: demo\n\n# Stage: one\n\n- [ ] First\n- [ ] Second\n');
    plantFile(root, '.plans/PLAN_TRACKER-demo.md', '# Plan: demo\n\n# Stage: one\n\n- [ ] First\n- [ ] Second\n');

    const [loop] = statusWidget(root, [sessionRecord()], { loopRows: [loopRow('demo', 10)], now }).loops;

    expect(loop?.tasks).toEqual({ total: 2, done: 0, blocked: 0, open: 2 });
    expect(loop?.byProgress).toBeNull();
    expect(loop?.byTask?.seconds).toBe(1200);
  });

  it('sums the counts of the live loops and picks the longest estimate of each kind', () => {
    const { root } = plantDemoProject(tempBase);
    plantFile(root, OTHER_PLAN_PATH, OTHER_PLAN);
    finish(root, '2026-09-15T12:30:00.000Z');
    const records = [
      sessionRecord({ sessionId: 'demo-run', startedAt: '2026-09-15T12:00:00.000Z' }),
      sessionRecord({ sessionId: 'other-run', planStub: 'other', plan: OTHER_PLAN_PATH, startedAt: '2026-09-15T13:00:00.000Z', state: 'paused' }),
      sessionRecord({ sessionId: 'done-run', state: 'done', startedAt: '2026-09-15T12:00:00.000Z' }),
    ];
    const loopRows = [loopRow('demo', 10), loopRow('other', 5)];

    const widget = statusWidget(root, records, { loopRows, now });

    // Demo: 4 tasks, 1 done, 1 blocked, 2 open. Other: 5 tasks, 1 done, 0 blocked, 4 open.
    expect(widget.tasks).toEqual({ total: 9, done: 2, blocked: 1, open: 6 });
    // byTask: demo 600 s * 3 = 1800; other 300 s * 4 = 1200.
    expect(widget.loops.map((loop) => loop.byTask?.seconds)).toEqual([1800, 1200]);
    expect(widget.longest.byTask).toBe(1800);
    // byProgress: demo 7200 s per done * 3 = 21600; other 3600 s * 4 = 14400.
    expect(widget.loops.map((loop) => loop.byProgress?.seconds)).toEqual([21_600, 14_400]);
    expect(widget.longest.byProgress).toBe(21_600);
    // bySession: only demo has a finish, 1800 s * 3 = 5400; other has none.
    expect(widget.loops.map((loop) => loop.bySession?.seconds)).toEqual([5400, null]);
    expect(widget.longest.bySession).toBe(5400);
  });

  it('leaves out of the longest the loops with no estimate of a kind', () => {
    const { root } = plantDemoProject(tempBase);
    plantFile(root, OTHER_PLAN_PATH, OTHER_PLAN);
    const records = [
      sessionRecord({ sessionId: 'demo-run' }),
      sessionRecord({ sessionId: 'other-run', planStub: 'other', plan: OTHER_PLAN_PATH }),
    ];

    const widget = statusWidget(root, records, { loopRows: [loopRow('other', 5)], now });

    expect(widget.loops[0]?.byTask).toBeNull();
    expect(widget.longest.byTask).toBe(1200);
  });
});
