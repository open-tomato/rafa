/**
 * `stretch readings`: one item's time, read from the files a loop leaves
 * and never from the effort store. Task windows come from the task
 * sessions' own logs, so a suspend is subtracted from the task it fell
 * in; the `rafa·` lines say which session was which task; the run
 * records give each test step's scope and seconds.
 *
 * @module bundled/operators/scripts/readings
 */

import type { Io } from './io.js';
import type { Summary } from './stats.js';
import type { Stretch } from './stretch-dir.js';
import type { Suspend, SuspendReading } from './suspends.js';

import { join } from 'node:path';

import { round1, summarise } from './stats.js';
import { sessionWindow, transcriptDir } from './stretch-dir.js';
import { readSuspends, suspendedMinutes } from './suspends.js';

/** One `rafa· task <i>/<n> done|blocked` line. */
export interface TaskLine {
  readonly index: number;
  readonly total: number;
  readonly outcome: 'done' | 'blocked';
  readonly minutes: number | undefined;
}

/** One task, its line matched to its session when the two agree. */
export interface TaskReading {
  readonly index: number;
  readonly outcome: 'done' | 'blocked';
  readonly lineMinutes: number | undefined;
  readonly wallMinutes: number | undefined;
  readonly awakeMinutes: number | undefined;
}

/** The test steps of one scope. */
export interface StepTotal {
  readonly count: number;
  readonly minutes: number;
}

/** What `readings` reports for one item. */
export interface ItemReading {
  readonly issue: string;
  readonly tasks: readonly TaskReading[];
  /** Whether every line found its session; when not, awake minutes are the lines'. */
  readonly matched: boolean;
  readonly work: Summary;
  readonly steps: Readonly<Record<string, StepTotal>>;
  readonly testMinutes: number;
  readonly testsPerWork: number;
  readonly suspends: SuspendReading;
  /** Minutes asleep from the item's first session to its last. */
  readonly asleepMinutes: number;
  /** Of those, the minutes outside every task session: test steps and the gaps between them. */
  readonly asleepBetweenMinutes: number;
  /**
   * Test-step minutes with the sleep between sessions taken out. An
   * estimate: a step's start and end are not recorded, so the sleep is
   * charged to the steps rather than to the gaps around them.
   */
  readonly testAwakeMinutes: number;
}

/** A task line, with the minutes and tokens a `done` line carries. */
const TASK_LINE = /^rafa· task (\d+)\/(\d+) (done|blocked)\s+(?:(\d+)m\b)?/;

/** A test step's duration in its summary: `[293.77s]` or `[12.4ms]`. */
const STEP_SECONDS = /\[([\d.]+)(ms|s)\]/;

/** Minutes either side within which a line and its session agree. */
const MATCH_TOLERANCE_MIN = 1.5;

/** The task lines of a loop log, in order. */
export function parseTaskLines(log: string): TaskLine[] {
  return log.split('\n').flatMap((line) => {
    const match = TASK_LINE.exec(line);

    if (!match) {
      return [];
    }

    return [{
      index: Number(match[1]),
      total: Number(match[2]),
      outcome: match[3] === 'done'
        ? 'done'
        : 'blocked',
      minutes: match[4] === undefined
        ? undefined
        : Number(match[4]),
    } satisfies TaskLine];
  });
}

/** A run record's test steps, totalled by scope, in minutes. */
export function stepTotals(records: readonly unknown[]): Record<string, StepTotal> {
  const totals: Record<string, { count: number; seconds: number }> = {};

  for (const record of records) {
    const steps = (record as { steps?: unknown }).steps;

    for (const step of Array.isArray(steps)
      ? steps
      : []) {
      const { scope = 'unknown', summary = '' } = step as { scope?: string; summary?: string };
      const match = STEP_SECONDS.exec(summary);
      const seconds = match
        ? Number(match[1]) / (match[2] === 'ms'
          ? 1000
          : 1)
        : 0;
      const total = totals[scope] ?? { count: 0, seconds: 0 };

      totals[scope] = { count: total.count + 1, seconds: total.seconds + seconds };
    }
  }

  return Object.fromEntries(Object.entries(totals).map(([scope, total]) => [scope, { count: total.count, minutes: round1(total.seconds / 60) }]));
}

/** Pairs each line with the next session whose length agrees with it. */
export function matchSessions(lines: readonly TaskLine[], sessions: readonly { from: number; to: number }[], suspends: readonly Suspend[]): { tasks: TaskReading[]; matched: boolean } {
  let cursor = 0;
  let matched = true;
  const tasks = lines.map((line) => {
    const session = sessions[cursor];
    const wall = session
      ? (session.to - session.from) / 60_000
      : undefined;
    const agrees = wall !== undefined && (line.minutes === undefined || Math.abs(Math.max(1, Math.round(wall)) - line.minutes) <= MATCH_TOLERANCE_MIN);

    if (!session || !agrees) {
      matched = false;

      return { index: line.index, outcome: line.outcome, lineMinutes: line.minutes, wallMinutes: undefined, awakeMinutes: line.minutes };
    }
    cursor += 1;
    const asleep = suspendedMinutes(suspends, session.from, session.to);

    return { index: line.index, outcome: line.outcome, lineMinutes: line.minutes, wallMinutes: round1(wall), awakeMinutes: round1(wall - asleep) };
  });

  return { tasks, matched };
}

/** The run records under `.rafa/runs/` of the item's plan, started since `since`. */
function itemRuns(io: Io, root: string, issue: string, since: number): unknown[] {
  const dir = join(root, '.rafa', 'runs');

  return io.list(dir).filter((name) => name.endsWith('.json'))
    .flatMap((name) => {
      try {
        const record = JSON.parse(io.read(join(dir, name)) ?? '') as { planStub?: string; startedAt?: string };
        const started = Date.parse(record.startedAt ?? '');

        return record.planStub?.startsWith(`rafa-${issue}-`) && started >= since
          ? [record]
          : [];
      } catch {
        return [];
      }
    });
}

/** The session windows of every worktree the runs named, oldest first, since `since`. */
function itemSessions(io: Io, runs: readonly unknown[], since: number): { from: number; to: number }[] {
  const cwds = new Set(runs.map((run) => (run as { worktree?: string }).worktree).filter((cwd): cwd is string => typeof cwd === 'string'));

  return [...cwds].flatMap((cwd) => {
    const dir = transcriptDir(io, cwd);

    return io.list(dir).filter((name) => name.endsWith('.jsonl'))
      .flatMap((name) => {
        const window = sessionWindow(io.read(join(dir, name)) ?? '');

        return window && window.from >= since
          ? [window]
          : [];
      });
  }).sort((a, b) => a.from - b.from);
}

/** Reads one item of a stretch: its tasks, its test steps and the sleep inside it. */
export function readItem(io: Io, stretch: Stretch, issue: string, since: number): ItemReading {
  const log = io.read(join(stretch.dir, `loop-${issue}.log`)) ?? '';
  const lines = parseTaskLines(log);
  const runs = itemRuns(io, stretch.root, issue, since);
  const sessions = itemSessions(io, runs, since);
  const suspends = readSuspends(io, since);
  const known = suspends.known
    ? suspends.suspends
    : [];
  const { tasks, matched } = matchSessions(lines, sessions, known);
  const work = summarise(tasks.flatMap((task) => (task.outcome === 'done' && task.awakeMinutes !== undefined
    ? [task.awakeMinutes]
    : [])));
  const steps = stepTotals(runs);
  const testMinutes = round1(Object.values(steps).reduce((total, step) => total + step.minutes, 0));
  const first = sessions[0]?.from;
  const last = sessions.at(-1)?.to;
  const asleepMinutes = first === undefined || last === undefined
    ? 0
    : round1(suspendedMinutes(known, first, last));
  const asleepInTasks = tasks.reduce((total, task) => total + (task.wallMinutes ?? 0) - (task.wallMinutes === undefined
    ? 0
    : task.awakeMinutes ?? 0), 0);
  const asleepBetweenMinutes = round1(Math.max(0, asleepMinutes - asleepInTasks));

  return {
    issue,
    tasks,
    matched,
    work,
    steps,
    testMinutes,
    testsPerWork: work.sum === 0
      ? 0
      : round1(testMinutes / work.sum),
    suspends,
    asleepMinutes,
    asleepBetweenMinutes,
    testAwakeMinutes: round1(Math.max(0, testMinutes - asleepBetweenMinutes)),
  };
}

/** The reading as text: a summary line, the test steps, then any warning. */
export function formatItem(reading: ItemReading): string {
  const steps = Object.entries(reading.steps).map(([scope, step]) => `${step.count} ${scope} (${step.minutes} min)`)
    .join(', ') || 'none';
  const lines = [
    `#${reading.issue}: ${reading.work.count} tasks done, ${reading.work.sum} min awake work (mean ${reading.work.mean}, p50 ${reading.work.p50}, p90 ${reading.work.p90})`,
    `  test steps: ${reading.testMinutes} min, ${steps}; tests ÷ work ${reading.testsPerWork}×`,
    `  asleep inside the item: ${reading.asleepMinutes} min, ${reading.asleepBetweenMinutes} of them outside the task sessions`,
  ];

  if (reading.asleepBetweenMinutes > 0) {
    lines.push(`  ⚠️ test steps hold up to ${reading.asleepBetweenMinutes} min of sleep: about ${reading.testAwakeMinutes} min awake (an estimate; steps record no start or end)`);
  }

  if (!reading.suspends.known) {
    lines.push(`  ⚠️ suspends unknown (${reading.suspends.reason}): minutes are wall time`);
  }
  if (!reading.matched) {
    lines.push('  ⚠️ some task lines found no session of the same length: those minutes are the lines\' wall time');
  }

  return lines.join('\n');
}
