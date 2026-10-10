/**
 * What an epic cost, read from the effort store's session rows, and the
 * line `rafa epic close` prints beside the estimate its body wrote.
 *
 * ## Which rows count
 *
 * A session row counts toward an epic when it names one of the epic's
 * members, in either of two fields the collector writes:
 *
 *   - `issueIdentifier`, upper-cased by attribution, equal to a member's
 *     board id upper-cased (`RAFA-246` for #246);
 *   - `planStub`, equal to a member's board id or opening with it and a
 *     hyphen (`rafa-246` or `rafa-246-epic-lifecycle` for #246), the rule
 *     `hasPlanFor` (`src/board/roadmap-rows.ts`) applies to plan files. So
 *     `rafa-2460-other` does not name #246.
 *
 * A row naming a member in both fields, or two members at once, is one
 * run. Runs are counted by distinct `sessionId`, so a store holding a
 * session twice still counts it once.
 *
 * ## What the members are
 *
 * The members handed in are the epic's members when the reading is taken,
 * which for `rafa epic close` is close time. Cost therefore FOLLOWS
 * MEMBERSHIP: work on an issue moved out of the epic before it closed is
 * not counted, and work done on an issue before it was moved in is. The
 * rendered cost says so on a line of its own ({@link MEMBERSHIP_NOTE}),
 * because a figure that silently moved with a label would read as spend.
 *
 * ## The three figures
 *
 *   - runs: distinct sessions, as above;
 *   - wall time: the sum of each run's own span, first record to last,
 *     through `minutesBetween` as `rafa effort report`'s work minutes
 *     are. It is time sessions ran, not elapsed calendar time, so
 *     overlapping runs both count. A run with no parseable span adds
 *     nothing and is counted in {@link EpicCost.runsWithoutTime};
 *   - tokens: input, output, cache read and cache write, summed as the
 *     report's `totalTokens` sums them.
 *
 * Pure over the rows except {@link readEpicCost}, which reads the
 * `sessions` kind of the store it is handed and nothing else.
 */
import type { EffortStore, SessionEffortRow } from './store/types.js';

import { boardId } from '../board/naming.js';
import { formatDuration } from '../commands/loop/loop-sessions.js';
import { plural } from '../plan/plan-files.js';

import { minutesBetween } from './commits.js';
import { formatCount } from './report-format.js';

/** The fields of a session row this module reads. */
export type EpicCostRow = Pick<
  SessionEffortRow,
  'sessionId' | 'issueIdentifier' | 'planStub' | 'firstTimestamp' | 'lastTimestamp' | 'usage'
>;

/** What the sessions naming an epic's members cost. */
export interface EpicCost {
  /** Distinct sessions naming a member. */
  readonly runs: number;
  /** The sum of each run's own span, in seconds. */
  readonly wallSeconds: number;
  /** Runs whose timestamps gave no span, so they add no time. */
  readonly runsWithoutTime: number;
  /** Input, output, cache read and cache write tokens, summed. */
  readonly tokens: number;
}

/** The line under the cost; see the module note. */
export const MEMBERSHIP_NOTE =
  'cost follows membership at close time: it counts the sessions of the issues in the epic now, '
  + 'so work on an issue moved out is not counted and work on an issue moved in is';

/** The estimate's stand-in when the epic's body wrote none. */
export const NO_ESTIMATE = 'none written';

const SECONDS_PER_MINUTE = 60;

/** True when `stub` is a member's board id, alone or before a hyphen. */
function stubNames(stub: string, id: string): boolean {
  return stub === id || stub.startsWith(`${id}-`);
}

/** True when the row names one of the members' board ids. */
function namesMember(row: EpicCostRow, ids: readonly string[]): boolean {
  const identifier = row.issueIdentifier;
  if (typeof identifier === 'string' && ids.some((id) => identifier.toUpperCase() === id.toUpperCase())) {
    return true;
  }
  const stub = row.planStub;
  return typeof stub === 'string' && ids.some((id) => stubNames(stub, id));
}

/** One run's span in minutes, or null when it has none. */
function spanMinutes(row: EpicCostRow): number | null {
  const first = row.firstTimestamp;
  const last = row.lastTimestamp;
  if (first === null || last === null) return null;
  return minutesBetween(first, last);
}

/** The run's tokens, summed as the report's `totalTokens` is. */
function tokensOf(row: EpicCostRow): number {
  const usage = row.usage;
  return usage.inputTokens + usage.outputTokens + usage.cacheReadInputTokens + usage.cacheCreationInputTokens;
}

/** Sums the rows naming any of `members`; see the module note. */
export function summariseEpicCost(rows: readonly EpicCostRow[], members: readonly number[]): EpicCost {
  const ids = members.map(boardId);
  const seen = new Set<string>();
  let minutes = 0;
  let runsWithoutTime = 0;
  let tokens = 0;
  for (const row of rows) {
    if (seen.has(row.sessionId) || !namesMember(row, ids)) continue;
    seen.add(row.sessionId);
    const span = spanMinutes(row);
    if (span === null) {
      runsWithoutTime += 1;
    } else {
      minutes += span;
    }
    tokens += tokensOf(row);
  }
  return {
    runs: seen.size,
    wallSeconds: Math.round(minutes * SECONDS_PER_MINUTE),
    runsWithoutTime,
    tokens,
  };
}

/** Reads the store's session rows and sums the ones naming a member. */
export function readEpicCost(store: EffortStore, members: readonly number[]): EpicCost {
  return summariseEpicCost(store.read('sessions'), members);
}

/** Wall time as a person reads it; no time at all is `0m`, not `under a minute`. */
function formatWallTime(seconds: number): string {
  return seconds === 0
    ? '0m'
    : formatDuration(seconds);
}

/**
 * The cost beside the estimate, then the membership note:
 * `cost: <runs> runs · <time> · <tokens> tokens — estimate: <free text>`.
 */
export function renderEpicCost(cost: EpicCost, estimate: string | null): readonly string[] {
  const written = estimate === null || estimate.trim() === ''
    ? NO_ESTIMATE
    : estimate.trim();
  const runs = plural(cost.runs, 'run');
  const time = formatWallTime(cost.wallSeconds);
  return [
    `cost: ${runs} · ${time} · ${formatCount(cost.tokens)} tokens — estimate: ${written}`,
    MEMBERSHIP_NOTE,
  ];
}
