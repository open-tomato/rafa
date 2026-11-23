/**
 * Reading one `QueryResult`: its columns, its cells and its window. The
 * live source's two mapper modules share these, the PoC metrics' in
 * `live.ts` and the git, board, module and GitHub metrics' in
 * `live-sources.ts`, which `live.ts` imports; neither imports the other
 * for them.
 *
 * A cell reader refuses what it cannot read (no column, no day) and reads
 * an aggregate over no value as 0. A week is keyed as the engine keys
 * one: the `YYYY-MM-DD` of its Monday, UTC.
 */
import type { QueryResult, Scalar } from '@open-tomato/atlas-data/contract';

/** One day in milliseconds. */
export const DAY_MS = 86_400_000;

/** One week in milliseconds. */
export const WEEK_MS: number = 7 * DAY_MS;

/** The label of a row whose group (model, plan, kind, route, priority) the store did not record. */
export const UNKNOWN = 'unknown';

/** The position of column `key` in `result`; an answer without it is refused. */
export function columnOf(result: QueryResult, key: string): number {
  const index = result.columns.findIndex((column) => column.key === key);
  if (index < 0) throw new Error(`atlas: the answer holds no ${key} column`);
  return index;
}

/** A cell as a number: an aggregate over no value reads 0. */
export function numberOf(value: Scalar | undefined): number {
  return typeof value === 'number'
    ? value
    : 0;
}

/** A cell as text, or `fallback` for a NULL or a number. */
export function textOf(value: Scalar | undefined, fallback: string): string {
  return typeof value === 'string'
    ? value
    : fallback;
}

/** A `YYYY-MM-DD` key or a stamp as the instant it names; anything else is refused. */
export function dayOf(value: Scalar | undefined): Date {
  const ms = typeof value === 'string'
    ? Date.parse(value)
    : Number.NaN;
  if (Number.isNaN(ms)) throw new Error(`atlas: ${JSON.stringify(value)} is not a day`);
  return new Date(ms);
}

/** A stamp cell as its instant, or null for a NULL; a text that names no time is refused. */
export function stampOrNull(value: Scalar | undefined): number | null {
  return value === null || value === undefined
    ? null
    : dayOf(value).getTime();
}

/** The names of one JSON array cell (`failing_json`, `imports_json`); a cell that is no list of names is refused, naming `what`. */
export function stringListOf(value: Scalar | undefined, what: string): string[] {
  const parsed: unknown = typeof value === 'string'
    ? JSON.parse(value)
    : null;
  if (!Array.isArray(parsed) || !parsed.every((name) => typeof name === 'string')) {
    throw new Error(`atlas: ${JSON.stringify(value)} is not a list of ${what}`);
  }
  return parsed;
}

export function round1(value: number): number {
  return Math.round(value * 10) / 10;
}

/** The start (UTC midnight) of the day holding `ms`. */
export function dayStartOf(ms: number): number {
  return Math.floor(ms / DAY_MS) * DAY_MS;
}

/** The `YYYY-MM-DD` key of the ISO week (its Monday, UTC) holding `ms`, as the engine keys a week. */
export function weekKeyOf(ms: number): string {
  const date = new Date(ms);
  const monday = Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate() - ((date.getUTCDay() + 6) % 7));
  return new Date(monday)
    .toISOString()
    .slice(0, 10);
}

/** The window's bounds as instants, or null for a window open at either end. */
export function boundsOf(result: QueryResult): { readonly from: Date; readonly to: Date } | null {
  const { from, to } = result.meta.window;
  return from === null || to === null
    ? null
    : { from: new Date(from), to: new Date(to) };
}

/**
 * The ISO week keys of the window, the first to the one holding its last
 * day; for an open window, the weeks from the answer's first to its last.
 */
export function windowWeeksOf(result: QueryResult, timeKey: string): string[] {
  const bounds = boundsOf(result);
  const time = columnOf(result, timeKey);
  const stamps = result.rows.map((row) => dayOf(row[time]).getTime());
  const first = bounds?.from.getTime() ?? Math.min(...stamps);
  const last = bounds === null
    ? Math.max(...stamps)
    : bounds.to.getTime() - 1;
  if (!Number.isFinite(first) || !Number.isFinite(last)) return [];
  const weeks: string[] = [];
  for (let monday = Date.parse(weekKeyOf(first)); monday <= last; monday += WEEK_MS) weeks.push(weekKeyOf(monday));
  return weeks;
}
