/**
 * `rollupDaily`: `daily_rollup` derived from the build's `task_facts`, one
 * row per calendar day a session started on, stamped in `atlas_sources`
 * as `local.daily`.
 *
 * Only the minutes and tokens columns are derived here: `minutes_<kind>`
 * and `tokens_<kind>` sum the `minutes` and `tokens` of that day's
 * sessions of each kind, and `tokens_total` sums the `tokens` of every
 * session of the day. A session's kind falls in one of five columns
 * ({@link KIND_COLUMNS}): `task`, `plan` (`plan-generation`), `wrap_up`,
 * `ci_repair`, and `other` for `other`, `search` and any kind core adds
 * later. A day with no session of a kind reads 0 in its columns, and a
 * session with a NULL `minutes` or `tokens` adds nothing to the sum.
 *
 * A session with no `day` (no start time) is in no row, so the day sums
 * equal the task sums over the sessions that have a day.
 *
 * Every other column (`sessions`, `task_sessions`, `tasks_done`,
 * `tasks_blocked`, `findings`, `bugs`, `changes`, `commits`, `prs_merged`,
 * `preflight_runs`, `preflight_halts`) stays NULL until the derivation of
 * the rest of the bucket lands, so the stamp marks `local.daily` partial
 * and names them in its reason. A partial `local.tasks` stamp carries its
 * reason over too, since the rollup is only as whole as its input.
 */
import type { ReplicaBuild, SourceStamp } from '@open-tomato/atlas-data/replica';

/** The `atlas_sources` row the rollup stamps; `local.daily` reads it. */
export const DAILY_SOURCE = 'local.daily';

/** The column suffix of each kind; a kind not named here falls in `other`. */
export const KIND_COLUMNS: Readonly<Record<string, 'task' | 'plan' | 'wrap_up' | 'ci_repair'>> = {
  'task': 'task',
  'plan-generation': 'plan',
  'wrap-up': 'wrap_up',
  'ci-repair': 'ci_repair',
};

/** The `daily_rollup` columns no derivation fills yet; they read NULL. */
export const UNDERIVED_COLUMNS: readonly string[] = [
  'sessions', 'task_sessions', 'tasks_done', 'tasks_blocked', 'findings', 'bugs', 'changes',
  'commits', 'prs_merged', 'preflight_runs', 'preflight_halts',
];

/** The five column suffixes, in DDL order. */
const SUFFIXES: readonly string[] = ['task', 'plan', 'wrap_up', 'ci_repair', 'other'];

/** The SQL expression giving a fact's column suffix. */
function suffixCase(): string {
  const whens = Object.entries(KIND_COLUMNS).map(([kind, suffix]) => `WHEN '${kind}' THEN '${suffix}'`);
  return `CASE kind ${whens.join(' ')} ELSE 'other' END`;
}

/** The INSERT ... SELECT filling the minutes and tokens columns, one row per day. */
function rollupStatement(): string {
  const suffix = suffixCase();
  const minutes = SUFFIXES.map((name) => `total(CASE WHEN ${suffix} = '${name}' THEN minutes END)`);
  const tokens = SUFFIXES.map((name) => `coalesce(sum(CASE WHEN ${suffix} = '${name}' THEN tokens END), 0)`);
  const columns = [
    'day',
    ...SUFFIXES.map((name) => `minutes_${name}`),
    ...SUFFIXES.map((name) => `tokens_${name}`),
    'tokens_total',
  ];
  return `INSERT INTO daily_rollup (${columns.join(', ')})
    SELECT day, ${[...minutes, ...tokens, 'coalesce(sum(tokens), 0)'].join(', ')}
    FROM task_facts WHERE day IS NOT NULL GROUP BY day ORDER BY day`;
}

/** The stamp's reason: the NULL columns, then the input's own reason when it was partial. */
function rollupReason(tasks: SourceStamp): string {
  const reasons = [`${UNDERIVED_COLUMNS.join(', ')} are not derived yet and read NULL`];
  if (tasks.partial && tasks.reason !== null) reasons.push(`${tasks.source}: ${tasks.reason}`);
  return reasons.join('; ');
}

/**
 * Fill the build's `daily_rollup` from its `task_facts` and stamp
 * {@link DAILY_SOURCE}, its times taken over from `tasks`, the stamp of
 * the source `task_facts` was read from. Answers the stamp.
 */
export function rollupDaily(build: ReplicaBuild, tasks: SourceStamp): SourceStamp {
  const rows = build.database.run(rollupStatement()).changes;
  const stamp: SourceStamp = {
    source: DAILY_SOURCE,
    asOf: tasks.asOf,
    readAt: tasks.readAt,
    rows,
    partial: true,
    reason: rollupReason(tasks),
  };
  build.stampSource(stamp);
  return stamp;
}
