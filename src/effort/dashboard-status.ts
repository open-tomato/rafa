/**
 * The status widget of `rafa effort dashboard`: every loop running or
 * paused in the project, its tasks done over total, and three estimates
 * of the time it has left.
 *
 * ## The three estimates
 *
 * Each is the tasks left, open and blocked alike, times a time per task.
 * They differ in where the time per task comes from, and the gap between
 * them is the reading: a loop whose `byProgress` runs well above its
 * `byTask` spends time between tasks that no task session measures.
 *
 * - `byTask`: the mean span of the plan's task sessions in the effort
 *   store. It counts only the time a task session ran, so it is the
 *   lowest, and it lags until `rafa effort collect` reads new sessions.
 * - `byProgress`: the time since the plan's first `loop start` (its
 *   oldest session record), divided by the plan's tasks done. It counts
 *   everything between tasks as well: gates, commits, reviews, restarts,
 *   and any gap between two runs of the plan.
 * - `bySession`: the estimate `rafa loop status` prints, unchanged
 *   (`commands/loop/loop-sessions.ts`, "The rough ETA"): from this run's
 *   start to its last finished task, per task finished in this run.
 *
 * `byProgress` reads the clock, which is why the dashboard, unlike
 * `rafa effort report`, is not a pure projection of the store.
 */
import type { LoopRow } from './report-trend.js';
import type { SessionEta } from '../commands/loop/loop-sessions.js';
import type { PidProbe, SessionRecord, SessionTask } from '../loop/sessions.js';
import type { TaskCounts } from '../plan/plan-files.js';

import { estimateEta, isLive, readSessionChecklist, readSessionFinishes } from '../commands/loop/loop-sessions.js';
import { readSessions } from '../loop/sessions.js';
import { countTasks } from '../plan/plan-files.js';

/** Milliseconds in one second. */
const MS_PER_SECOND = 1_000;

/** Seconds in one minute. */
const SECONDS_PER_MINUTE = 60;

/** An estimate of the time left, from one time per task. */
export interface Estimate {
  /** Whole seconds per task. */
  secondsPerTask: number;
  /** Whole seconds for the tasks left at that pace. */
  seconds: number;
}

/** The `byTask` estimate, and the sessions its time per task was read from. */
export interface ByTaskEstimate extends Estimate {
  sessions: number;
}

/** The `byProgress` estimate, and the start and elapsed time it was read from. */
export interface ByProgressEstimate extends Estimate {
  /** The oldest session record's start for the plan. */
  planStartedAt: string;
  elapsedSeconds: number;
}

/** One loop running or paused. */
export interface StatusLoop {
  sessionId: string;
  planStub: string | null;
  branch: string;
  state: SessionRecord['state'];
  startedAt: string;
  /** The task the record names, or null between tasks. */
  task: SessionTask | null;
  /** The whole plan's tasks, or null when neither the plan nor its tracker is there. */
  tasks: TaskCounts | null;
  /** Null when there is nothing to divide by; see the module note. */
  byTask: ByTaskEstimate | null;
  byProgress: ByProgressEstimate | null;
  bySession: SessionEta | null;
}

/** The status widget: the counters over every live loop, then each loop. */
export interface StatusWidget {
  running: number;
  paused: number;
  /** Tasks summed over the live loops that have a checklist. */
  tasks: TaskCounts;
  /** The longest estimate of each kind: the live loops run side by side. */
  longest: { byTask: number | null; byProgress: number | null; bySession: number | null };
  loops: StatusLoop[];
}

/** What the status reads beyond the records. */
export interface StatusInputs {
  /** The trend report's loop rows; the one keyed by a plan stub gives `byTask`. */
  loopRows: readonly LoopRow[];
  /** The instant `byProgress` measures to. */
  now: Date;
}

/** The tasks left: open and blocked, as `rafa loop status` counts them. */
function tasksLeft(counts: TaskCounts): number {
  return counts.open + counts.blocked;
}

/** An estimate from seconds per task, or null when there is no pace. */
function estimateFrom(secondsPerTask: number | null, left: number): Estimate | null {
  if (secondsPerTask === null || !Number.isFinite(secondsPerTask)) return null;
  return { secondsPerTask: Math.round(secondsPerTask), seconds: Math.round(secondsPerTask * left) };
}

/** `byTask`: the plan's mean task span, from its loop row. */
export function byTaskEstimate(row: LoopRow | undefined, counts: TaskCounts): ByTaskEstimate | null {
  const minutes = row?.perTask.minutes.avg ?? null;
  const estimate = estimateFrom(minutes === null
    ? null
    : minutes * SECONDS_PER_MINUTE, tasksLeft(counts));
  return estimate === null || row === undefined
    ? null
    : { ...estimate, sessions: row.tasks };
}

/** `byProgress`: the time since the plan's first start, per task done. */
export function byProgressEstimate(planStartedAt: string, counts: TaskCounts, now: Date): ByProgressEstimate | null {
  if (counts.done === 0) return null;
  const elapsedSeconds = Math.max(0, (now.getTime() - Date.parse(planStartedAt)) / MS_PER_SECOND);
  const estimate = estimateFrom(elapsedSeconds / counts.done, tasksLeft(counts));
  return estimate === null
    ? null
    : { ...estimate, planStartedAt, elapsedSeconds: Math.round(elapsedSeconds) };
}

/**
 * The oldest parseable start among the records of one plan, the record's
 * own when it has no stub. A start that does not parse is passed over, so
 * one bad record cannot hide the plan's others.
 */
function planStartOf(record: SessionRecord, records: readonly SessionRecord[]): string {
  const peers = record.planStub === null
    ? [record]
    : records.filter((other) => other.planStub === record.planStub);
  const starts = peers.map((other) => other.startedAt).filter((stamp) => !Number.isNaN(Date.parse(stamp)));
  return starts.reduce((oldest, stamp) => (Date.parse(stamp) < Date.parse(oldest)
    ? stamp
    : oldest), starts[0] ?? record.startedAt);
}

/** One live loop's status. */
function statusLoop(root: string, record: SessionRecord, records: readonly SessionRecord[], inputs: StatusInputs): StatusLoop {
  const checklist = readSessionChecklist(root, record);
  const tasks = checklist === null
    ? null
    : countTasks(checklist.tasks);
  const row = inputs.loopRows.find((loop) => loop.kind === 'plan' && loop.key === record.planStub);
  return {
    sessionId: record.sessionId,
    planStub: record.planStub,
    branch: record.branch,
    state: record.state,
    startedAt: record.startedAt,
    task: record.task,
    tasks,
    byTask: tasks === null
      ? null
      : byTaskEstimate(row, tasks),
    byProgress: tasks === null
      ? null
      : byProgressEstimate(planStartOf(record, records), tasks, inputs.now),
    bySession: tasks === null
      ? null
      : estimateEta(record.startedAt, readSessionFinishes(root, record), tasks),
  };
}

/** The largest of some estimates in seconds, or null when none has one. */
function longestOf(values: readonly (number | null | undefined)[]): number | null {
  const known = values.filter((value): value is number => typeof value === 'number');
  return known.length === 0
    ? null
    : Math.max(...known);
}

/** The counts summed over the loops that have them. */
function summedTasks(loops: readonly StatusLoop[]): TaskCounts {
  return loops.reduce<TaskCounts>((sum, loop) => (loop.tasks === null
    ? sum
    : {
      total: sum.total + loop.tasks.total,
      done: sum.done + loop.tasks.done,
      blocked: sum.blocked + loop.tasks.blocked,
      open: sum.open + loop.tasks.open,
    }), { total: 0, done: 0, blocked: 0, open: 0 });
}

/** The widget over the given records. Pure but for the checklists and finishes it reads under `root`. */
export function statusWidget(root: string, records: readonly SessionRecord[], inputs: StatusInputs): StatusWidget {
  const loops = records.filter(isLive).map((record) => statusLoop(root, record, records, inputs));
  return {
    running: loops.filter((loop) => loop.state === 'running').length,
    paused: loops.filter((loop) => loop.state === 'paused').length,
    tasks: summedTasks(loops),
    longest: {
      byTask: longestOf(loops.map((loop) => loop.byTask?.seconds)),
      byProgress: longestOf(loops.map((loop) => loop.byProgress?.seconds)),
      bySession: longestOf(loops.map((loop) => loop.bySession?.seconds)),
    },
    loops,
  };
}

/** The widget over the records under `root`, each read with the state its pid gives it. */
export function readStatusWidget(root: string, inputs: StatusInputs, isAlive?: PidProbe): StatusWidget {
  const seams = isAlive === undefined
    ? {}
    : { isAlive };
  return statusWidget(root, readSessions(root, seams), inputs);
}
