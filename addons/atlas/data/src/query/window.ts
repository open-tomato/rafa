/**
 * Windows: a query's `window` resolved to bounds, the window just before
 * it for `compare: 'previous'`, and a bound as the text the time field is
 * compared with.
 *
 * A window is half open, `[from, to)`. A bound written as a plain date
 * names the whole day: `from: '2026-11-01'` starts at that day's first
 * instant, and `to: '2026-11-07'` ends after that day, at the next one's
 * first. A bound written as a stamp is that instant. `last` counts back
 * from `to`, or, without one, from the end of today (UTC), so `7d` is the
 * seven whole days that end with today, `12w` the 84 days that do, and
 * `6m` the six calendar months back from the same end.
 *
 * The previous window ends where the asked one starts and is as long: as
 * many months for a `last` in months, else as many milliseconds. It needs
 * both bounds, so a window open at either end has none.
 */
import type { FieldType, Window } from '../contract/types.js';

import { InvalidParams } from '../contract/errors.js';

import { dateText } from './grain.js';

/** Bounds as instants; null for an end the window leaves open. */
export interface ResolvedWindow {
  readonly from: Date | null;
  readonly to: Date | null;
}

/** A window closed at both ends. */
export interface ClosedWindow {
  readonly from: Date;
  readonly to: Date;
}

const DAY_MS = 86_400_000;
const DAYS_PER_WEEK = 7;
const PLAIN_DATE = /^\d{4}-\d{2}-\d{2}$/;
const LAST_PATTERN = /^(\d{1,4})([dwm])$/;

interface Last {
  readonly count: number;
  readonly unit: 'd' | 'w' | 'm';
}

function refuse(message: string): never {
  throw new InvalidParams(message, ['window']);
}

function instantOf(text: string, end: boolean): Date {
  const ms = Date.parse(text);
  if (Number.isNaN(ms)) refuse(`the window bound ${JSON.stringify(text)} is not a date or stamp`);
  return PLAIN_DATE.test(text) && end
    ? new Date(ms + DAY_MS)
    : new Date(ms);
}

function lastOf(text: string): Last {
  const match = LAST_PATTERN.exec(text);
  const count = Number(match?.[1]);
  const unit = match?.[2];
  if (unit !== 'd' && unit !== 'w' && unit !== 'm') refuse(`the window's last ${JSON.stringify(text)} is not a count and d, w or m`);
  if (count < 1) refuse('the window\'s last counts at least one day, week or month');
  return { count, unit };
}

/** The first instant of the UTC day after `now`'s. */
function endOfToday(now: Date): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()) + DAY_MS);
}

/** `date` moved by `months` calendar months, the day of month kept or cut to the month's last. */
function shiftMonths(date: Date, months: number): Date {
  const year = date.getUTCFullYear();
  const month = date.getUTCMonth() + months;
  const lastDay = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  const day = Math.min(date.getUTCDate(), lastDay);
  return new Date(Date.UTC(year, month, day, date.getUTCHours(), date.getUTCMinutes(), date.getUTCSeconds(), date.getUTCMilliseconds()));
}

function back(to: Date, last: Last): Date {
  if (last.unit === 'm') return shiftMonths(to, -last.count);
  const days = last.unit === 'w'
    ? last.count * DAYS_PER_WEEK
    : last.count;
  return new Date(to.getTime() - days * DAY_MS);
}

/** The bounds of `window` at `now`; no window is open at both ends. */
export function resolveWindow(window: Window | undefined, now: Date): ResolvedWindow {
  if (window === undefined) return { from: null, to: null };
  if (window.last !== undefined && window.from !== undefined) refuse('last and from exclude each other');
  const to = window.to === undefined
    ? null
    : instantOf(window.to, true);
  if (window.last !== undefined) {
    const end = to ?? endOfToday(now);
    return { from: back(end, lastOf(window.last)), to: end };
  }
  const from = window.from === undefined
    ? null
    : instantOf(window.from, false);
  if (from !== null && to !== null && from.getTime() > to.getTime()) refuse('the window starts after it ends');
  return { from, to };
}

/** The window just before `resolved`, as long as it; refused for a window open at either end. */
export function previousWindow(window: Window | undefined, resolved: ResolvedWindow): ClosedWindow {
  const { from, to } = resolved;
  if (from === null || to === null) refuse('compare: previous needs a window closed at both ends');
  if (window?.last !== undefined && lastOf(window.last).unit === 'm') {
    return { from: shiftMonths(from, -lastOf(window.last).count), to: from };
  }
  return { from: new Date(from.getTime() - (to.getTime() - from.getTime())), to: from };
}

/** A bound as the time field's text: a `YYYY-MM-DD` day for a `date` field, else a full ISO stamp. */
export function boundText(bound: Date, type: FieldType): string {
  return type === 'date'
    ? dateText(bound)
    : bound.toISOString();
}
