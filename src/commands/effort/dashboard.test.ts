/**
 * Tests for `rafa effort dashboard` (`dashboard.ts`), dispatched in-process
 * in projects planted under a temporary directory.
 *
 * The clock and the home go in through the command's seams, and the home is
 * an empty directory of the case's own, so nothing reads the real home. The
 * projects hold no effort store, so every widget answers from nothing.
 */
import type { CapturedRun, PlantedProject } from '../../tests/cli-capture.js';

import { mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, describe, expect, it } from 'bun:test';

import { withSqliteStore, sqliteStorePath } from '../../effort/store/sqlite.js';
import { eventsOf, dispatchInProject, plantProject, plantProjectConfig } from '../../tests/cli-capture.js';
import { plantDemoProject, plantSession, sessionRecord } from '../../tests/loop-session-fixtures.js';

import { createEffortDashboardCommand } from './dashboard.js';

const tempBase = realpathSync(mkdtempSync(join(tmpdir(), 'rafa-effort-dashboard-')));

afterAll(() => {
  rmSync(tempBase, { recursive: true, force: true });
});

const EFFORT_SUBJECT = { name: 'effort', summary: 'the effort store' };

const NOW = new Date('2026-09-28T10:15:00.000Z');

const USAGE_LINE = 'Usage: rafa effort dashboard [--days=<n>] [--recent=<n>] [--loops=<n>] [--by=effort|model|agent]';

/** A project of a case's own, with a home beside it. */
function plant(): PlantedProject {
  return plantProject(realpathSync(mkdtempSync(join(tempBase, 'case-'))));
}

/** Dispatches `effort dashboard` with `words` in `project`, the clock and home handed in. */
function dashboard(project: PlantedProject, words: readonly string[]): Promise<CapturedRun> {
  const command = createEffortDashboardCommand({ now: () => NOW, home: project.home });
  return dispatchInProject(['effort', 'dashboard', ...words], [EFFORT_SUBJECT], [command], project);
}

/** The data of the result event a json-mode run ended with. */
function resultData(run: CapturedRun): Record<string, unknown> {
  const result = eventsOf(run.stdout).find((event) => event.type === 'result');
  if (result === undefined || result.type !== 'result') throw new Error(`no result event in: ${run.stdout}`);
  return result.data as Record<string, unknown>;
}

describe('rafa effort dashboard, its refusals', () => {
  it('refuses an argument with exit code 1 and the usage line', async () => {
    const run = await dashboard(plant(), ['extra']);

    expect(run.exitCode).toBe(1);
    expect(run.stderr + run.stdout).toContain('Expected no argument, got 1: extra');
    expect(run.stderr + run.stdout).toContain(USAGE_LINE);
  });

  it('refuses --days=0 with the command\'s line and the usage line', async () => {
    const run = await dashboard(plant(), ['--days=0']);

    expect(run.exitCode).toBe(1);
    expect(run.stderr + run.stdout).toContain('❌ rafa effort dashboard: --days takes a whole number of one or more and at most 3650: --days=0');
    expect(run.stderr + run.stdout).toContain(USAGE_LINE);
  });

  it('refuses --by=x, listing the groupings', async () => {
    const run = await dashboard(plant(), ['--by=x']);

    expect(run.exitCode).toBe(1);
    expect(run.stderr + run.stdout).toContain('❌ rafa effort dashboard: --by value is not a grouping: x (one of effort, model, agent)');
    expect(run.stderr + run.stdout).toContain(USAGE_LINE);
  });

  it('refuses each bad flag on its own line', async () => {
    const run = await dashboard(plant(), ['--days=0', '--recent=abc', '--by=x']);

    const lines = (run.stderr + run.stdout).split('\n').filter((line) => line.startsWith('❌ rafa effort dashboard:'));
    expect(run.exitCode).toBe(1);
    expect(lines).toHaveLength(3);
  });

  it('refuses in json mode too, exiting 1', async () => {
    const run = await dashboard(plant(), ['--loops=-1', '--output=json']);

    expect(run.exitCode).toBe(1);
    expect(run.stdout + run.stderr).toContain('--loops takes a whole number of one or more: --loops=-1');
  });
});

describe('rafa effort dashboard, over a config the loop cannot run on', () => {
  it('refuses with exit code 1, one line for the command, and no widget', async () => {
    const project = plant();
    plantProjectConfig(project.root, 'not: [valid\n');

    const run = await dashboard(project, ['--output=json']);

    expect(run.exitCode).toBe(1);
    expect(run.stdout + run.stderr).toContain('❌ rafa effort dashboard: ');
    expect(eventsOf(run.stdout).some((event) => event.type === 'result' && event.ok === true)).toBe(false);
  });
});

describe('rafa effort dashboard, over a project with no store', () => {
  it('gives one key per widget as the json result', async () => {
    const run = await dashboard(plant(), ['--output=json']);

    expect(run.exitCode).toBe(0);
    const data = resultData(run);
    expect(Object.keys(data).sort()).toEqual(['generatedAt', 'loops', 'skills', 'status', 'totals', 'trend']);
    expect(data.generatedAt).toBe(NOW.toISOString());
  });

  it('answers every widget from nothing', async () => {
    const data = resultData(await dashboard(plant(), ['--output=json']));

    expect(data.status).toEqual({
      running: 0,
      paused: 0,
      tasks: { total: 0, done: 0, blocked: 0, open: 0 },
      longest: { byTask: null, byProgress: null, bySession: null },
      loops: [],
    });
    expect(data.trend).toMatchObject({ anchor: null, baseline: null, recent: null, metrics: [], days: [] });
    expect(data.loops).toMatchObject({ days: 14, loops: null, by: null, rows: [] });
    expect(data.skills).toMatchObject({ plans: [] });
    expect(data.totals).toEqual({
      sessions: 0,
      workMinutes: 0,
      tokens: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      taskReports: { done: 0, notDone: 0 },
      preflightHalts: 0,
      budgetedSessions: 0,
    });
  });

  it('hands the flags to the loops widget as the trend options', async () => {
    const data = resultData(await dashboard(plant(), ['--days=7', '--recent=2', '--loops=5', '--by=agent', '--output=json']));

    expect(data.loops).toMatchObject({ days: null, loops: 5, by: 'agent' });
  });

  it('prints the widgets as text without --output=json, exiting 0', async () => {
    const run = await dashboard(plant(), []);

    expect(run.exitCode).toBe(0);
    expect(run.stdout).toContain('TREND');
    expect(run.stdout).toContain('LOOPS');
  });
});

/** Stores a task session row of `minutes` starting at `start`, as the collector's JSON holds one. */
function storeSession(root: string, sessionId: string, start: string, minutes: number, where: { planStub: string | null; branch: string | null }): void {
  const row = {
    sessionId,
    planStub: where.planStub,
    branch: where.branch,
    kind: 'task',
    assistantRecordCount: 4,
    firstTimestamp: start,
    lastTimestamp: new Date(Date.parse(start) + minutes * 60_000).toISOString(),
    entrypointCounts: {},
    modelCounts: {},
    usage: { inputTokens: 1, outputTokens: 2, cacheCreationInputTokens: 3, cacheReadInputTokens: 4 },
  };
  withSqliteStore(sqliteStorePath(root), 'write', true, (db) => {
    db.run('INSERT INTO sessions (session_id, row_json) VALUES (?, ?)', [sessionId, JSON.stringify(row)]);
  });
}

describe('rafa effort dashboard, over a project with a store and a running loop', () => {
  /** A demo project whose running record names this process, so its pid probe finds it alive. */
  function plantRunningDemo(): PlantedProject {
    const project = plantDemoProject(tempBase);
    plantSession(project.root, sessionRecord({ pid: process.pid, startedAt: '2026-09-15T12:00:00.000Z' }));
    // The demo plan's two old sessions ran 10 minutes each, a fortnight before the newest loop's.
    storeSession(project.root, 'demo-1', '2026-09-01T10:00:00.000Z', 10, { planStub: 'demo', branch: null });
    storeSession(project.root, 'demo-2', '2026-09-01T11:00:00.000Z', 10, { planStub: 'demo', branch: null });
    storeSession(project.root, 'newer-1', '2026-09-28T09:00:00.000Z', 5, { planStub: null, branch: 'feat/newer' });
    return project;
  }

  it('keeps a running loop\'s byTask when --loops=1 shows only the newest loop', async () => {
    const data = resultData(await dashboard(plantRunningDemo(), ['--loops=1', '--output=json']));

    const loops = data.loops as { rows: { key: string }[] };
    const status = data.status as { running: number; loops: { planStub: string; byTask: unknown }[] };
    expect(loops.rows.map((row) => row.key)).toEqual(['feat/newer']);
    expect(status.running).toBe(1);
    // 10 minutes per task is 600 s, times the 3 tasks the demo tracker leaves.
    expect(status.loops[0]?.byTask).toEqual({ secondsPerTask: 600, seconds: 1800, sessions: 2 });
  });

  it('keeps it when --days=1 leaves the demo loop out of the loop window', async () => {
    const data = resultData(await dashboard(plantRunningDemo(), ['--days=1', '--output=json']));

    const loops = data.loops as { rows: { key: string }[] };
    const status = data.status as { loops: { byTask: unknown }[] };
    expect(loops.rows.map((row) => row.key)).toEqual(['feat/newer']);
    expect(status.loops[0]?.byTask).toMatchObject({ secondsPerTask: 600, sessions: 2 });
  });

  it('counts the stored sessions in the totals widget', async () => {
    const data = resultData(await dashboard(plantRunningDemo(), ['--output=json']));

    expect(data.totals).toMatchObject({ sessions: 3, workMinutes: 25 });
  });
});
