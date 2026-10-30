/**
 * The argv parser of `rafa effort report`, apart from the report in
 * `report.ts` it configures, as `collect-args.ts` is for
 * `rafa effort collect`.
 *
 * Every flag the parser reads is compared against here and nowhere else,
 * and any other argument is refused.
 *
 * `--skills` switches the command to the skills report
 * (`report-skills.ts`), and `--plan=<stub>[,<stub>]` narrows that report
 * to the plans named. `--plan=` narrows nothing else, so it is refused
 * without `--skills`, naming the flag, rather than read as no filter over
 * the session tables. `--kind` and `--entrypoint` narrow the session rows,
 * which the skills report does not read, so each is refused beside
 * `--skills` for the same reason.
 *
 * `--trend` switches the command to the trend report (`report-trend.ts`),
 * read with `--days=`, `--recent=`, `--loops=` and `--by=`. Each of those
 * four is refused without `--trend`, since no other report reads it, and
 * `--trend` is refused beside `--skills`, `--kind` and `--entrypoint`: it
 * reads the task sessions alone, so a filter would narrow nothing.
 */

import type { SessionKind } from './classify.js';
import type { TrendOptions } from './report-trend.js';

import { SESSION_KINDS } from './report.js';

/** What the parsed argv asked for. */
export interface ReportArgs {
  json: boolean;
  kinds: readonly SessionKind[] | null;
  entrypoints: readonly string[] | null;
  /** Whether `--skills` asked for the skills report in place of the session tables. */
  skills: boolean;
  /** The plan stubs `--plan=` named, each once, in the order typed; null for every plan. */
  plans: readonly string[] | null;
  /** The trend report's options when `--trend` asked for it; null otherwise. */
  trend: TrendOptions | null;
  /** Every refusal, so all of them are reported and not just the first. */
  errors: string[];
}

/** What `--by` splits each loop of the trend report into. */
export const TREND_GROUPINGS = ['effort', 'model', 'agent'] as const;

/** One `--by` value. */
export type TrendGrouping = typeof TREND_GROUPINGS[number];

/** The baseline, and loop, window of the trend report when `--days=` is not typed. */
export const DEFAULT_TREND_DAYS = 14;

/** The recent window of the trend report when `--recent=` is not typed. */
export const DEFAULT_TREND_RECENT_DAYS = 3;

/**
 * The most days `--days=` and `--recent=` take: ten years, far past any
 * store, and far short of a window whose first day is no date at all.
 */
export const MAX_TREND_DAYS = 3650;

/** The trend flags that take a whole number of one or more. */
const TREND_COUNT_FLAGS = ['--days', '--recent', '--loops'] as const;

/** One of {@link TREND_COUNT_FLAGS}. */
type TrendCountFlag = typeof TREND_COUNT_FLAGS[number];

/** The trend flags as typed, before `--trend` decides whether they apply. */
interface TypedTrendFlags {
  counts: Partial<Record<TrendCountFlag, number>>;
  by: TrendGrouping | null;
  /** Each trend flag typed, once, so its refusal without `--trend` names it. */
  typed: string[];
  /**
   * The refusals of the values typed. Reported only under `--trend`: without
   * it the one refusal is that the flag needs it, whatever its value.
   */
  valueErrors: string[];
}

/** Splits a comma-separated flag value into its members. */
function splitList(raw: string): string[] {
  return raw
    .split(',')
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
}

/** Narrows a string to a session kind, or null when it is not one. */
function asSessionKind(value: string): SessionKind | null {
  return SESSION_KINDS.find((kind) => kind === value) ?? null;
}

/** Narrows a string to a `--by` value, or null when it is not one. */
function asTrendGrouping(value: string): TrendGrouping | null {
  return TREND_GROUPINGS.find((grouping) => grouping === value) ?? null;
}

/** Whether a count flag's value is in range: at most {@link MAX_TREND_DAYS} for a day count. */
function inRange(flag: TrendCountFlag, count: number): boolean {
  return count >= 1 && (flag === '--loops' || count <= MAX_TREND_DAYS);
}

/**
 * Reads one trend flag into `flags`, or answers false when `arg` is none.
 * Each takes one value, so a second of the same flag is refused rather
 * than read over the first, as a set-valued flag above would union it. A
 * value out of range, or not a grouping, is refused into its
 * `valueErrors`.
 */
function readTrendFlag(arg: string, flags: TypedTrendFlags): boolean {
  const [flag = '', value] = arg.split(/=(.*)/s, 2);
  const countFlag = TREND_COUNT_FLAGS.find((name) => name === flag);
  if (flag !== '--by' && countFlag === undefined) return false;
  const errors = flags.valueErrors;
  if (flags.typed.includes(flag)) {
    errors.push(`${flag} takes one value and was given more than once`);
    return true;
  }
  flags.typed.push(flag);
  if (value === undefined) {
    errors.push(`${flag} takes a value, as ${flag}=<value>`);
  } else if (countFlag !== undefined) {
    const count = Number(value);
    if (/^[0-9]+$/.test(value) && Number.isSafeInteger(count) && inRange(countFlag, count)) {
      flags.counts[countFlag] = count;
    } else {
      const most = countFlag === '--loops'
        ? ''
        : ` and at most ${MAX_TREND_DAYS}`;
      errors.push(`${flag} takes a whole number of one or more${most}: ${arg}`);
    }
  } else {
    const grouping = asTrendGrouping(value);
    if (grouping === null) {
      errors.push(`--by value is not a grouping: ${value} (one of ${TREND_GROUPINGS.join(', ')})`);
    } else {
      flags.by = grouping;
    }
  }
  return true;
}

/**
 * The refusals of the trend flags: each one typed without `--trend`, else
 * their values, `--trend` beside `--skills`, and a session-row filter
 * beside `--trend`. With `--skills` typed too, the filter's refusal is
 * the one {@link combinationErrors} already gives, so it is not repeated.
 */
function trendErrors(trend: boolean, skills: boolean, flags: TypedTrendFlags, filters: readonly string[]): string[] {
  if (!trend) return flags.typed.map((flag) => `${flag} reads the trend report and needs --trend`);
  if (skills) return [...flags.valueErrors, '--trend and --skills each print a report of their own; pick one'];

  return [
    ...flags.valueErrors,
    ...filters.map((flag) => `${flag} narrows the session tables, which --trend does not print`),
  ];
}

/**
 * The refusals of flags that do not combine: `--plan=` without
 * `--skills`, and a session-row filter beside it.
 */
function combinationErrors(
  skills: boolean,
  planTyped: boolean,
  filters: readonly string[],
): string[] {
  if (!skills) {
    return planTyped
      ? ['--plan narrows the skills report and needs --skills']
      : [];
  }
  return filters.map((flag) => `${flag} narrows the session tables, which --skills does not print`);
}

/**
 * Parses the report argv.
 *
 * Every refusal is collected rather than thrown at the first, and an
 * unrecognised argument IS a refusal: a mistyped `--entrypint=sdk-cli`
 * that parsed as "no filter" would print the whole directory's traffic
 * under a command line that reads like the loop's own.
 *
 * A repeated flag UNIONS rather than replacing, because each of these
 * takes a set and `--kind=task --kind=wrap-up` has one obvious meaning;
 * `--plan=a --plan=b` reads both plans as `--plan=a,b` does.
 * The trend flags each take one value, so a repeat of one is refused.
 */
export function parseReportArgs(args: readonly string[]): ReportArgs {
  const errors: string[] = [];
  const kinds: SessionKind[] = [];
  const entrypoints: string[] = [];
  const plans: string[] = [];
  const filters: string[] = [];
  let json = false;
  let skills = false;
  let trend = false;
  let planTyped = false;
  const trendFlags: TypedTrendFlags = { counts: {}, by: null, typed: [], valueErrors: [] };

  for (const arg of args) {
    if (arg === '--json') {
      json = true;
    } else if (arg === '--skills') {
      skills = true;
    } else if (arg === '--trend') {
      trend = true;
    } else if (readTrendFlag(arg, trendFlags)) {
      continue;
    } else if (arg === '--kind' || arg === '--entrypoint' || arg === '--plan') {
      errors.push(`${arg} takes a value, as ${arg}=<value>`);
    } else if (arg.startsWith('--plan=')) {
      planTyped = true;
      const stubs = splitList(arg.slice('--plan='.length));
      if (stubs.length === 0) errors.push(`--plan names no plan stub: ${arg}`);
      for (const stub of stubs) {
        if (!plans.includes(stub)) plans.push(stub);
      }
    } else if (arg.startsWith('--kind=')) {
      if (!filters.includes('--kind')) filters.push('--kind');
      for (const value of splitList(arg.slice('--kind='.length))) {
        const kind = asSessionKind(value);
        if (kind === null) {
          errors.push(
            `--kind value is not a session kind: ${value}`
            + ` (one of ${SESSION_KINDS.join(', ')})`,
          );
        } else if (!kinds.includes(kind)) {
          kinds.push(kind);
        }
      }
    } else if (arg.startsWith('--entrypoint=')) {
      if (!filters.includes('--entrypoint')) filters.push('--entrypoint');
      for (const value of splitList(arg.slice('--entrypoint='.length))) {
        if (!entrypoints.includes(value)) entrypoints.push(value);
      }
    } else {
      errors.push(`unrecognised argument: ${arg}`);
    }
  }
  errors.push(...combinationErrors(skills, planTyped, filters));
  errors.push(...trendErrors(trend, skills, trendFlags, filters));

  return {
    json,
    kinds: kinds.length === 0
      ? null
      : kinds,
    entrypoints: entrypoints.length === 0
      ? null
      : entrypoints,
    skills,
    plans: plans.length === 0
      ? null
      : plans,
    trend: trend
      ? {
        days: trendFlags.counts['--days'] ?? DEFAULT_TREND_DAYS,
        recentDays: trendFlags.counts['--recent'] ?? DEFAULT_TREND_RECENT_DAYS,
        loops: trendFlags.counts['--loops'] ?? null,
        by: trendFlags.by,
      }
      : null,
    errors,
  };
}
