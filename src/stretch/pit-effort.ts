/**
 * The effort reading of the pit stop (#1477): the item's plan as the
 * effort store holds it once `rafa effort collect` has run, set against
 * the store's baseline, so the engineer no longer types
 * `rafa effort collect` and `rafa effort dashboard` by hand.
 *
 * ## What it reads
 *
 * - **The collect.** `runCollect` runs the child line
 *   `rafa effort collect`, as typed, and answers its exit code, or null
 *   when it could not start. It is timed with the `now` seam, and the
 *   time is printed on a line of its own, {@link collectLine}. The
 *   collect is never imported: `collectEffort` is not on the
 *   `@open-tomato/rafa-effort` facade.
 * - **The dashboard.** `readDashboard`, the facade's, with the trend
 *   options `parseReportArgs(['--trend'])` answers: the defaults
 *   `rafa effort dashboard` prints with.
 * - **The item's row.** The `loops.rows` entry whose `kind` is `plan` and
 *   whose `key` is the item's stub; its figures are `tasks`,
 *   `perTask.minutes.p50` and `perTask.minutes.max`. No such row reads as
 *   `{ stub, rows: 0 }`: a reading that was read, of a plan with no task
 *   sessions stored.
 * - **The baseline.** The `baselineP50` of the `trend.metrics` entry named
 *   `minutes`, null when the store has none.
 *
 * ## When it is not read
 *
 * A collect that could not start or ended non-zero leaves the reading not
 * read, and the dashboard is never read: figures read without the item's
 * sessions would understate it. A dashboard read that throws is not read
 * with its message. Neither is ever rendered as a zero.
 */
import type { Reading } from './pit-readings.js';
import type { Dashboard, readDashboard } from '@open-tomato/rafa-effort';

import { homedir } from 'node:os';

import { parseReportArgs } from '@open-tomato/rafa-effort';

import { messageOf } from '@open-tomato/rafa/core/config/sections';

/** The options the facade's `readDashboard` takes. */
export type DashboardReadOptions = Parameters<typeof readDashboard>[0];

/** Where the effort reading comes from. */
export interface PitEffortSeams {
  /** Runs `rafa effort collect` and answers its exit code, or null when it could not start. */
  readonly runCollect: () => Promise<number | null>;
  /** The effort dashboard, the facade's `readDashboard` in production. */
  readonly readDashboard: (options: DashboardReadOptions) => Promise<Dashboard>;
  /** The clock the collect is timed with and the dashboard reads to. */
  readonly now: () => Date;
}

/** What to read. */
export interface PitEffortQuery {
  /** The project root the store and the session records are read under. */
  readonly root: string;
  /** The item's plan stub, the key of its loops row. */
  readonly stub: string;
  /** The home the user scope's config is read under; left out, the user's own. */
  readonly home?: string;
}

/** The item's plan as the store holds it. */
export interface PitEffortFigures {
  readonly stub: string;
  readonly tasks: number;
  /** Per-task minutes, median; null when the store holds no figure. */
  readonly p50: number | null;
  /** Per-task minutes, longest; null when the store holds no figure. */
  readonly max: number | null;
  /** The store's baseline per-task minutes, median; null with no baseline. */
  readonly baseline: number | null;
}

/** A plan with no task sessions stored. */
export interface PitEffortNoRows {
  readonly stub: string;
  readonly rows: 0;
}

/** The value of a read effort reading. */
export type PitEffortValue = PitEffortFigures | PitEffortNoRows;

/** How the collect ended. */
export interface PitCollect {
  /** Its exit code, or null when it could not start. */
  readonly exitCode: number | null;
  /** Its wall time in seconds. */
  readonly seconds: number;
}

/** The effort reading and the collect it was read after. */
export interface PitEffort {
  readonly effort: Reading<PitEffortValue>;
  readonly collect: PitCollect;
}

/** The kind of a loops row keyed by a plan stub. */
const PLAN_ROW_KIND = 'plan';

/** The trend metric the baseline is read from. */
const MINUTES_METRIC = 'minutes';

/** Milliseconds in a second. */
const MS_PER_SECOND = 1000;

/** Decimals a minute figure, and the collect's seconds, are shown with. */
const DECIMALS = 1;

/** Why the effort is not read after a collect that did not end 0. */
function collectFailure(exitCode: number | null): string {
  return exitCode === null
    ? 'rafa effort collect could not start'
    : `rafa effort collect ended with exit code ${String(exitCode)}`;
}

/** The trend options `rafa effort dashboard` prints with when no flag is typed. */
function defaultTrendOptions(): DashboardReadOptions['trend'] {
  const parsed = parseReportArgs(['--trend']);
  if (parsed.trend === null) throw new Error(`the trend options did not parse: ${parsed.errors.join('; ')}`);
  return parsed.trend;
}

/** The item's row and the baseline, read off `dashboard`. */
export function effortOf(dashboard: Dashboard, stub: string): PitEffortValue {
  const row = dashboard.loops.rows.find((entry) => entry.kind === PLAN_ROW_KIND && entry.key === stub);
  if (row === undefined) return { stub, rows: 0 };
  const minutes = dashboard.trend.metrics.find((metric) => metric.name === MINUTES_METRIC);
  return {
    stub,
    tasks: row.tasks,
    p50: row.perTask.minutes.p50,
    max: row.perTask.minutes.max,
    baseline: minutes?.baselineP50 ?? null,
  };
}

/** Runs the collect, then reads the item's effort; see the module note. Never throws. */
export async function readPitEffort(seams: PitEffortSeams, query: PitEffortQuery): Promise<PitEffort> {
  const started = seams.now().getTime();
  let exitCode: number | null;
  try {
    exitCode = await seams.runCollect();
  } catch {
    exitCode = null;
  }
  const collect = { exitCode, seconds: (seams.now().getTime() - started) / MS_PER_SECOND };
  if (exitCode !== 0) return { effort: { ok: false, reason: collectFailure(exitCode) }, collect };
  try {
    const dashboard = await seams.readDashboard({
      repoRoot: query.root,
      home: query.home ?? homedir(),
      trend: defaultTrendOptions(),
      now: seams.now(),
    });
    return { effort: { ok: true, value: effortOf(dashboard, query.stub) }, collect };
  } catch (error) {
    return { effort: { ok: false, reason: messageOf(error) }, collect };
  }
}

/** A minute figure to one decimal, or `no figure` for none. */
function minutesText(value: number | null): string {
  return value === null
    ? 'no figure'
    : `${value.toFixed(DECIMALS)} min`;
}

/** The `Effort:` line for `effort`. */
export function renderPitEffort(effort: Reading<PitEffortValue>): string {
  if (!effort.ok) return `Effort: not read (${effort.reason}).`;
  const value = effort.value;
  if ('rows' in value) return `Effort: ${value.stub}: no task sessions stored.`;
  const against = value.baseline === null
    ? 'no baseline'
    : minutesText(value.baseline);
  return `Effort: ${value.stub}: ${String(value.tasks)} tasks, p50 ${minutesText(value.p50)}`
    + ` against ${against}, max ${minutesText(value.max)}.`;
}

/** The collect's line, `rafa effort collect ended <code> in <s>s`. */
export function collectLine(collect: PitCollect): string {
  const seconds = collect.seconds.toFixed(DECIMALS);
  return collect.exitCode === null
    ? `rafa effort collect could not start (${seconds}s)`
    : `rafa effort collect ended ${String(collect.exitCode)} in ${seconds}s`;
}
