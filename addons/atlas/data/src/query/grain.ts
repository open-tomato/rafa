/**
 * The time grains: the key a time value falls under for `day`, `week` and
 * `month`, each a `YYYY-MM-DD` date in UTC. A week is an ISO week, keyed by
 * its Monday; a month is keyed by its first day.
 */
import type { Grain, Scalar } from '../contract/types.js';

/** The grains that bucket the time field. */
export type TimeGrain = Extract<Grain, 'day' | 'week' | 'month'>;

const DAY_MS = 86_400_000;
/** Days from Monday for each `getUTCDay()` value, Sunday first. */
const DAYS_SINCE_MONDAY: readonly number[] = [6, 0, 1, 2, 3, 4, 5];
/** The length of `YYYY-MM-DD`. */
const DATE_LENGTH = 10;

export function isTimeGrain(grain: Grain): grain is TimeGrain {
  return grain === 'day' || grain === 'week' || grain === 'month';
}

/** A Date's UTC calendar day, as `YYYY-MM-DD`. */
export function dateText(date: Date): string {
  return date.toISOString().slice(0, DATE_LENGTH);
}

/** The bucket of `value` under `grain`, or null for a value that is not a date or stamp. */
export function timeKey(value: Scalar, grain: TimeGrain): string | null {
  if (typeof value !== 'string') return null;
  const ms = Date.parse(value);
  if (Number.isNaN(ms)) return null;
  const date = new Date(ms);
  if (grain === 'day') return dateText(date);
  if (grain === 'month') return dateText(new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1)));
  const dayStart = Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
  const back = DAYS_SINCE_MONDAY[date.getUTCDay()] ?? 0;
  return dateText(new Date(dayStart - back * DAY_MS));
}
