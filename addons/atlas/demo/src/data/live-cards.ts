/**
 * The mappers of three remaining cards (spec C1, C3 and C4), each from one
 * `QueryResult` of the Atlas API into the field its card reads.
 * `live-sources.ts` registers their metrics and calls them.
 *
 * - `scopeCreepOf` reads `pm.out-of-scope-per-week` (C1): the out-of-scope
 *   entries per ISO week of the series window, 0 for a week with none, the
 *   last week's count, and the window's weekly average, the entries over
 *   the window's days in weeks.
 * - `taskPileOf` reads `pm.task-pile` (C3): the open typed issues, the
 *   type label on the inner ring and the age on the outer ring, in the
 *   mock's three buckets (`AGE_BUCKETS`), measured from `created_at` to
 *   the replica's build time (the answer's `meta.asOf`). An issue exactly
 *   7 days old is 1 to 4 weeks old, and one exactly 28 days old still is:
 *   over 4 weeks starts past the 28th day.
 * - `workDoneOf` reads `dev.work-done` (C4): the changelog entries, D4's
 *   work type by level on the inner ring (`major` and `minor` a feature,
 *   `patch` a fix, `none` a chore) and the tidied area (`tidyArea`) on the
 *   outer ring, the five largest per kind by name, the rest folded into
 *   `other` and an entry with no area under `no area`.
 *
 * A mapper invents no number: an empty answer is an empty field, and a
 * task pile with no build time to measure to is no ring at all.
 */
import type { TreeBranch } from './mock.js';
import type { QueryResult } from '@open-tomato/atlas-data/contract';

import { NO_AREA, tidyArea } from './areas.js';
import { boundsOf, columnOf, DAY_MS, numberOf, round1, stampOrNull, textOf, UNKNOWN, WEEK_MS, windowWeeksOf } from './live-read.js';
import { AGE_BUCKETS, WORK_KINDS } from './mock.js';

/** What the out-of-scope tile shows: the weekly counts, the last of them, and the window's weekly average. */
export interface ScopeCreep {
  /** The entries per ISO week of the window, oldest first, 0 for a week with none. */
  readonly perWeek: number[];
  /** The last week's count: the entries of the week holding the window's last day. */
  readonly lastWeek: number;
  /** The window's entries per week, to one decimal. */
  readonly average: number;
}

/** One tree branch's child: an outer ring slice. */
type TreeLeaf = TreeBranch['children'][number];

/** The age, in days, under which an issue is under a week old. */
const WEEK_DAYS = 7;

/** The age, in days, past which an issue is over 4 weeks old. */
const FOUR_WEEK_DAYS = 28;

/** How many areas a kind of work shows by name; the rest fold into `other`. */
export const TOP_AREAS = 5;

/** The outer ring slice the areas past the top five fold into. */
export const OTHER_AREA = 'other';

/** D4: the work kind (`WORK_KINDS` id) each change level counts as. */
export const LEVEL_KINDS: Readonly<Record<string, string>> = {
  major: 'features',
  minor: 'features',
  patch: 'fixes',
  none: 'chores',
};

/* ---------- C1, out-of-scope entries ---------- */

/** The weeks `result`'s window spans, for its average: its days over 7, or its ISO weeks when open. */
function weeksSpannedOf(result: QueryResult, weekCount: number): number {
  const bounds = boundsOf(result);
  return bounds === null
    ? weekCount
    : (bounds.to.getTime() - bounds.from.getTime()) / WEEK_MS;
}

/**
 * The out-of-scope tile's numbers from `week` and `entries` rows: the
 * entries per window week (0 for a week with no row), the last week's,
 * and the window's entries per week to one decimal, 0 for no week.
 */
export function scopeCreepOf(result: QueryResult): ScopeCreep {
  const week = columnOf(result, 'week');
  const entries = columnOf(result, 'entries');
  const perWeek = windowWeeksOf(result, 'week').map((key) => result.rows
    .filter((row) => row[week] === key)
    .reduce((sum, row) => sum + numberOf(row[entries]), 0));
  const total = perWeek.reduce((sum, count) => sum + count, 0);
  const weeks = weeksSpannedOf(result, perWeek.length);
  return {
    perWeek,
    lastWeek: perWeek.at(-1) ?? 0,
    average: weeks > 0
      ? round1(total / weeks)
      : 0,
  };
}

/* ---------- C3, the task pile ---------- */

/** The age bucket (`AGE_BUCKETS`) of an issue `days` old. */
export function ageBucketOf(days: number): string {
  const [underAWeek = '', oneToFour = '', overFour = ''] = AGE_BUCKETS;
  if (days < WEEK_DAYS) return underAWeek;
  return days <= FOUR_WEEK_DAYS
    ? oneToFour
    : overFour;
}

/** The counts of `byPart` as outer ring slices of `branch`, in `order`, a part with none left out. */
function leavesOf(branch: string, byPart: ReadonlyMap<string, number>, order: readonly string[]): TreeLeaf[] {
  return order
    .filter((part) => (byPart.get(part) ?? 0) > 0)
    .map((part) => ({ id: `${branch}/${part}`, label: part, value: byPart.get(part) ?? 0, group: branch }));
}

/** The sum of a branch's slices. */
function totalOf(branch: TreeBranch): number {
  return branch.children.reduce((sum, child) => sum + child.value, 0);
}

/** `branches` the largest first, ties by id. */
function largestFirst(branches: readonly TreeBranch[]): TreeBranch[] {
  return [...branches].sort((a, b) => totalOf(b) - totalOf(a) || a.id.localeCompare(b.id));
}

/**
 * The task pile from `issue_type`, `created_at` and `issues` rows: one
 * branch per type label, the largest first, with its issues by age to
 * the build time (`meta.asOf`) in `AGE_BUCKETS` order, a bucket with none
 * left out. A row with no open time adds nothing, and an answer with no
 * build time answers no branch.
 */
export function taskPileOf(result: QueryResult): TreeBranch[] {
  const type = columnOf(result, 'issue_type');
  const created = columnOf(result, 'created_at');
  const issues = columnOf(result, 'issues');
  const builtAt = result.meta.asOf === null
    ? null
    : Date.parse(result.meta.asOf);
  if (builtAt === null || Number.isNaN(builtAt)) return [];
  const byType = new Map<string, Map<string, number>>();
  for (const row of result.rows) {
    const opened = stampOrNull(row[created]);
    if (opened === null) continue;
    const label = textOf(row[type], UNKNOWN);
    const bucket = ageBucketOf((builtAt - opened) / DAY_MS);
    const buckets = byType.get(label) ?? new Map<string, number>();
    byType.set(label, new Map([...buckets, [bucket, (buckets.get(bucket) ?? 0) + numberOf(row[issues])]]));
  }
  return largestFirst([...byType.entries()].map(([label, buckets]) => ({ id: label, label, group: label, children: leavesOf(label, buckets, AGE_BUCKETS) })))
    .filter((branch) => branch.children.length > 0);
}

/* ---------- C4, work done ---------- */

/**
 * The areas of one kind folded: the `TOP_AREAS` largest by name (ties by
 * name), then `other` for the rest and for an area tidied to `other`
 * itself, then `no area`.
 */
function foldedAreasOf(byArea: ReadonlyMap<string, number>): Map<string, number> {
  const named = [...byArea.entries()]
    .filter(([area]) => area !== NO_AREA && area !== OTHER_AREA)
    .sort(([a, x], [b, y]) => y - x || a.localeCompare(b));
  const rest = named.slice(TOP_AREAS).reduce((sum, [, count]) => sum + count, byArea.get(OTHER_AREA) ?? 0);
  return new Map([...named.slice(0, TOP_AREAS), [OTHER_AREA, rest], [NO_AREA, byArea.get(NO_AREA) ?? 0]]);
}

/**
 * Work done from `level`, `area` and `entries` rows: one branch per D4
 * kind in `WORK_KINDS` order, a kind with no entry left out, its entries
 * by tidied area folded to the top five, `other` and `no area`. A level
 * D4 does not name adds nothing.
 */
export function workDoneOf(result: QueryResult): TreeBranch[] {
  const level = columnOf(result, 'level');
  const area = columnOf(result, 'area');
  const entries = columnOf(result, 'entries');
  const byKind = new Map<string, Map<string, number>>();
  for (const row of result.rows) {
    const kind = LEVEL_KINDS[textOf(row[level], '')];
    if (kind === undefined) continue;
    const raw = row[area];
    const tidied = tidyArea(typeof raw === 'string'
      ? raw
      : null);
    const areas = byKind.get(kind) ?? new Map<string, number>();
    byKind.set(kind, new Map([...areas, [tidied, (areas.get(tidied) ?? 0) + numberOf(row[entries])]]));
  }
  return WORK_KINDS.flatMap((kind) => {
    const areas = byKind.get(kind.id);
    if (areas === undefined) return [];
    const folded = foldedAreasOf(areas);
    const children = leavesOf(kind.id, folded, [...folded.keys()]);
    return children.length === 0
      ? []
      : [{ id: kind.id, label: kind.label, group: kind.id, children }];
  });
}
