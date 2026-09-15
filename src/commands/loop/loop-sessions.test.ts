/**
 * Tests for what the `loop` session actions share
 * (`commands/loop/loop-sessions.ts`): the rough ETA and how it is written,
 * the checklist a record's tasks are counted from, a session as a line,
 * the `--session-id` declaration and the seams left out.
 *
 * Which session a line picks, and each refusal, are read through the
 * commands that pick one, in `status.test.ts` above all, since a pick
 * reads its flag off a dispatched context. The default branch reader runs
 * git with the suite's own environment, so no case here calls it; the
 * spawned readings in the close-out of this task reach it.
 *
 * Each estimate sits beside the one differing in a single input: no
 * finish beside one, a finish at the start beside one after it, and blocked
 * tasks left beside open ones.
 */
import type { TaskCounts } from '../plan/plan-files.js';

import { mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, describe, expect, it } from 'bun:test';

import { isPidAlive } from '../../loop/sessions.js';
import {
  DEMO_PLAN,
  DEMO_PLAN_PATH,
  DEMO_TRACKER_PATH,
  plantDemoProject,
  plantFile,
  sessionRecord,
  STARTED_AT,
} from '../../tests/loop-session-fixtures.js';

import {
  checkboxAt,
  estimateEta,
  etaLine,
  formatDuration,
  isLive,
  planLabel,
  readSessionChecklist,
  resolveLoopSeams,
  sessionIdFlag,
  sessionLine,
  STOP_POLL_MS,
  STOP_WAIT_MS,
} from './loop-sessions.js';

/** A temporary directory of this file's own. */
const tempBase = realpathSync(mkdtempSync(join(tmpdir(), 'rafa-loop-sessions-shared-')));

afterAll(() => {
  rmSync(tempBase, { recursive: true, force: true });
});

/** Counts with `open` and `blocked` tasks left, and two done. */
function counts(open: number, blocked: number): TaskCounts {
  return { total: 2 + open + blocked, done: 2, blocked, open };
}

describe('estimateEta', () => {
  it('gives no pace before the session finishes a task, and still counts what is left', () => {
    expect(estimateEta(STARTED_AT, [], counts(2, 1))).toEqual({ finished: 0, left: 3, secondsPerTask: null, seconds: null });
  });

  it('paces the tasks left by the time from the start to the last finish, over the finishes', () => {
    const finishes = ['2026-09-15T12:07:00.000Z', '2026-09-15T12:20:00.000Z'];

    expect(estimateEta(STARTED_AT, finishes, counts(2, 1))).toEqual({ finished: 2, left: 3, secondsPerTask: 600, seconds: 1800 });
    expect(estimateEta(STARTED_AT, finishes, counts(3, 0)).seconds).toBe(1800);
    expect(estimateEta(STARTED_AT, finishes, counts(0, 0))).toEqual({ finished: 2, left: 0, secondsPerTask: 600, seconds: 0 });
  });

  it('rounds to whole seconds, and never paces below zero', () => {
    expect(estimateEta(STARTED_AT, ['2026-09-15T12:00:10.000Z', '2026-09-15T12:00:10.000Z', '2026-09-15T12:00:10.000Z'], counts(1, 0)))
      .toEqual({ finished: 3, left: 1, secondsPerTask: 3, seconds: 3 });
    expect(estimateEta(STARTED_AT, ['2026-09-15T11:59:00.000Z'], counts(1, 0)).secondsPerTask).toBe(0);
  });
});

describe('formatDuration', () => {
  it.each([
    [0, 'under a minute'],
    [59, 'under a minute'],
    [60, '1m'],
    [89, '1m'],
    [90, '2m'],
    [3599, '1h'],
    [3600, '1h'],
    [3900, '1h 5m'],
    [9000, '2h 30m'],
  ])('writes %d seconds as %s', (seconds, written) => {
    expect(formatDuration(seconds)).toBe(written);
  });
});

describe('etaLine', () => {
  it('says there is no task left, that there is no pace yet, or the estimate with its pace', () => {
    expect(etaLine({ finished: 2, left: 0, secondsPerTask: 600, seconds: 0 })).toBe('ETA: no task left');
    expect(etaLine({ finished: 0, left: 3, secondsPerTask: null, seconds: null })).toBe('ETA: none until the session finishes a task');
    expect(etaLine({ finished: 2, left: 3, secondsPerTask: 600, seconds: 1800 }))
      .toBe('ETA: about 30m for 3 tasks left, at 10m per task over the 2 tasks this session finished');
    expect(etaLine({ finished: 1, left: 1, secondsPerTask: 30, seconds: 30 }))
      .toBe('ETA: under a minute for 1 task left, at under a minute per task over the 1 task this session finished');
  });
});

describe('readSessionChecklist and checkboxAt', () => {
  it('reads the tracker once there is one, and the checkbox at each 1-based line', () => {
    const { root } = plantDemoProject(tempBase);

    const checklist = readSessionChecklist(root, sessionRecord());

    expect(checklist?.file).toBe(join(root, DEMO_TRACKER_PATH));
    expect([5, 6, 7, 8, 4, 9].map((line) => checkboxAt(checklist, line))).toEqual(['done', 'blocked', 'unchecked', 'unchecked', null, null]);
  });

  it('reads the plan before its tracker exists, and nothing when neither is there', () => {
    const { root } = plantDemoProject(tempBase);
    rmSync(join(root, DEMO_TRACKER_PATH));

    const fromPlan = readSessionChecklist(root, sessionRecord());

    expect(fromPlan?.file).toBe(join(root, DEMO_PLAN_PATH));
    expect(fromPlan?.tasks.map((task) => task.status)).toEqual(['unchecked', 'unchecked', 'unchecked', 'unchecked']);
    expect(readSessionChecklist(root, sessionRecord({ plan: '.plans/PLAN-gone.md' }))).toBeNull();
    expect(checkboxAt(null, 5)).toBeNull();
  });

  it('finds the tracker of a plan with no stub beside it', () => {
    const { root } = plantDemoProject(tempBase);
    plantFile(root, 'PLAN.md', DEMO_PLAN);
    plantFile(root, 'PLAN_TRACKER.md', DEMO_PLAN.replace('- [ ] Fourth task', '- [x] Fourth task'));

    const checklist = readSessionChecklist(root, sessionRecord({ planStub: null, plan: 'PLAN.md' }));

    expect(checklist?.file).toBe(join(root, 'PLAN_TRACKER.md'));
    expect(checkboxAt(checklist, 8)).toBe('done');
  });
});

describe('a session as a line', () => {
  it('names the plan by its stub, or by its path when it carries none', () => {
    expect(planLabel(sessionRecord())).toBe('demo');
    expect(planLabel(sessionRecord({ planStub: null, plan: 'PLAN.md' }))).toBe('PLAN.md');
    expect(sessionLine(sessionRecord({ state: 'paused' })))
      .toBe('session-0500: plan `demo` on `feat/demo`, paused, pid 7171, started 2026-09-15T12:00:00.000Z');
  });

  it('reads running and paused as live, and stopped and done as ended', () => {
    expect((['running', 'paused', 'stopped', 'done'] as const).map((state) => isLive({ state }))).toEqual([true, true, false, false]);
  });
});

describe('the declaration and the seams', () => {
  it('declares --session-id as a string aliased s, saying what the session is for', () => {
    const flag = sessionIdFlag('to stop');

    expect({ ...flag, description: undefined }).toEqual({ name: 'session-id', type: 'string', aliases: ['s'], description: undefined });
    expect(flag.description).toStartWith('The session to stop, by the id its record under `.rafa/runs/` is named with.');
  });

  it('fills each seam left out with the system own, and keeps each handed in', () => {
    const defaults = resolveLoopSeams();
    const sleep = async (): Promise<void> => {};
    const handed = resolveLoopSeams({ sleep, stopWaitMs: 5, pollMs: 1 });

    expect([defaults.isAlive, defaults.stopWaitMs, defaults.pollMs]).toEqual([isPidAlive, STOP_WAIT_MS, STOP_POLL_MS]);
    expect([STOP_WAIT_MS, STOP_POLL_MS]).toEqual([30_000, 200]);
    expect([handed.sleep, handed.stopWaitMs, handed.pollMs, handed.isAlive]).toEqual([sleep, 5, 1, isPidAlive]);
  });
});
