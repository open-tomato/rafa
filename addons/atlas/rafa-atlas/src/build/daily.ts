/**
 * `rollupDaily`: the minutes and tokens half of `daily_rollup`, derived
 * from the build's `task_facts`, one row per calendar day a session
 * started on.
 *
 * `minutes_<kind>` and `tokens_<kind>` sum the `minutes` and `tokens` of
 * that day's sessions of each kind, and `tokens_total` sums the `tokens`
 * of every session of the day. A session's kind falls in one of five
 * columns ({@link KIND_COLUMNS}): `task`, `plan` (`plan-generation`),
 * `wrap_up`, `ci_repair`, and `other` for `other`, `search` and any kind
 * core adds later. A day with no session of a kind reads 0 in its
 * columns, and a session with a NULL `minutes` or `tokens` adds nothing
 * to the sum.
 *
 * A session with no `day` (no start time) is in no row, so the day sums
 * equal the task sums over the sessions that have a day.
 *
 * The rest of the bucket, {@link COUNT_COLUMNS}, reads NULL here:
 * `derive.ts` calls this first, then fills those counts, adds the days a
 * preflight ran on with no session, and stamps `local.daily`
 * ({@link DAILY_SOURCE}) over the whole bucket.
 */
import type { Database } from 'bun:sqlite';

/** The `atlas_sources` row the rollup stamps; `local.daily` reads it. */
export const DAILY_SOURCE = 'local.daily';

/** The column suffix of each kind; a kind not named here falls in `other`. */
export const KIND_COLUMNS: Readonly<Record<string, 'task' | 'plan' | 'wrap_up' | 'ci_repair'>> = {
  'task': 'task',
  'plan-generation': 'plan',
  'wrap-up': 'wrap_up',
  'ci-repair': 'ci_repair',
};

/** The `daily_rollup` columns {@link rollupDaily} leaves NULL, for `derive.ts` to fill. */
export const COUNT_COLUMNS: readonly string[] = [
  'sessions', 'task_sessions', 'tasks_done', 'tasks_blocked', 'findings', 'bugs', 'changes',
  'commits', 'prs_merged', 'preflight_runs', 'preflight_halts',
];

/** The five column suffixes, in DDL order. */
export const KIND_SUFFIXES: readonly string[] = ['task', 'plan', 'wrap_up', 'ci_repair', 'other'];

/** The SQL expression giving a fact's column suffix. */
function suffixCase(): string {
  const whens = Object.entries(KIND_COLUMNS).map(([kind, suffix]) => `WHEN '${kind}' THEN '${suffix}'`);
  return `CASE kind ${whens.join(' ')} ELSE 'other' END`;
}

/** The INSERT ... SELECT filling the minutes and tokens columns, one row per day. */
function rollupStatement(): string {
  const suffix = suffixCase();
  const minutes = KIND_SUFFIXES.map((name) => `total(CASE WHEN ${suffix} = '${name}' THEN minutes END)`);
  const tokens = KIND_SUFFIXES.map((name) => `coalesce(sum(CASE WHEN ${suffix} = '${name}' THEN tokens END), 0)`);
  const columns = [
    'day',
    ...KIND_SUFFIXES.map((name) => `minutes_${name}`),
    ...KIND_SUFFIXES.map((name) => `tokens_${name}`),
    'tokens_total',
  ];
  return `INSERT INTO daily_rollup (${columns.join(', ')})
    SELECT day, ${[...minutes, ...tokens, 'coalesce(sum(tokens), 0)'].join(', ')}
    FROM task_facts WHERE day IS NOT NULL GROUP BY day ORDER BY day`;
}

/** Fill the minutes and tokens columns of `daily_rollup` from `task_facts`; answers the rows written. */
export function rollupDaily(database: Database): number {
  return database.run(rollupStatement()).changes;
}
