/**
 * `deriveBuild`: the buckets derived from the effort, git, board and
 * module ingests', run after them inside the same build. In order:
 *
 * 1. **Work type (D4).** `task_facts.work_type` is the session's change
 *    level read as a kind of work ({@link CHANGE_LEVELS}): `major` and
 *    `minor` are `feature`, `patch` is `fix`, `none` is `chore` (chore or
 *    docs). The level is the highest the session reported in
 *    `change_facts`, joined on `session_id`, so a session reporting a
 *    patch and a minor change is a feature. A session with no change of a
 *    known level, a blocked attempt that reported none say, reads NULL.
 *    `branch_type` is `feat` on every loop branch and is not read. The
 *    split is a proxy, and the metrics over it carry a `ProxyNote`.
 * 2. **`daily_rollup`.** `rollupDaily` (`daily.ts`) fills the minutes and
 *    tokens columns; then each day a preflight ran on with no session
 *    gets a row, its minutes and tokens 0. Each day's counts are taken
 *    over the sessions that started on it, so each sums to the
 *    `task_facts` figure over those sessions: `sessions`,
 *    `task_sessions` (kind `task`), `tasks_done` and `tasks_blocked`
 *    (task sessions by report status), `findings` and `bugs` (the
 *    sessions' own counts, so a tracker-ref-only finding and a routed
 *    bug add nothing), and `changes` (the `change_facts` rows of those
 *    sessions). `preflight_runs` counts the runs whose rows were first
 *    written that day, `preflight_halts` those of them with a required
 *    check that did not pass, the rule `runPreflight` halts by; both are
 *    read from the snapshot's `preflight` table and read NULL when it
 *    lacks a column of {@link PREFLIGHT_COLUMNS}. `commits` counts the
 *    `commit_facts` rows of the day (`ingest/git.ts`), and each day a
 *    commit landed on with no session gets a row, its minutes and tokens
 *    0, so the column summed equals the commits read; it reads NULL on
 *    every day when no git history was read, and the stamp says so.
 *    `prs_merged` reads NULL until the GitHub source lands, so
 *    `local.daily` is stamped partial and names it.
 * 3. **`plan_facts`**, one row per plan the plan folder holds or a
 *    session or CI reading names (`readPlans`, `ingest/plans.ts`). From
 *    the plan file: `plan_source`, `issue_number`, `tasks_planned`,
 *    `tasks_done`, `tasks_blocked` (null for a `missing` plan), and
 *    `completed`, 1 when the file holds a task and every task is done.
 *    From the plan's sessions: `sessions`, `task_sessions`,
 *    `reports_done`, `reports_blocked`, `repeat_sessions` (task sessions
 *    of `attempt` 2 or more, a retry of a task line), `ci_repair_sessions`,
 *    `first_at` (earliest start), `last_at` (latest end), `minutes` and
 *    `tokens` (summed as the day columns are; null for a plan with no
 *    session). From `ci_facts`: `ci_last_verdict` (the latest reading's),
 *    `ci_red_readings` and `pr_number` (the latest reading's that names
 *    one). `merged_at` reads NULL until the GitHub source lands, so
 *    `local.plans` is stamped partial.
 * 4. **`commit_facts.plan_stub`**, the plan whose `plan_facts.pr_number`
 *    is the commit's `pr_number`. A pull request two plans name links
 *    neither, and the commit's plan reads NULL, as does a commit naming
 *    no pull request.
 * 5. **`plan_facts.epic_slug`**, the `issue_facts.epic_slug` of the
 *    plan's `issue_number` (`ingest/board.ts`): the slug of the epic the
 *    plan's issue is a member of, or of the epic itself when the plan's
 *    issue is one. A plan with no issue number, or one the board cache
 *    does not hold, reads NULL; with no cache read every plan does, and
 *    the stamp says so.
 * 6. **`module_facts` counts**, each module's rows of the effort buckets
 *    whose `module` is its `path` (`ingest/modules.ts`): `bugs` the
 *    out-of-scope rows of `bug_facts`, so a routed bug, the same entry
 *    again, is not counted twice; `findings` the rows of `finding_facts`
 *    with a kind, blockers left out, as `task_facts.findings` counts
 *    them; `changes` the rows of `change_facts`. A module no row names
 *    reads 0. `module_facts` is stamped by its ingest, not here.
 *
 * Each stamp takes the effort ingest's `read_at`, and carries over the
 * reason of each partial input it was derived from. `local.plans`'s
 * `as_of` is the newest of the plan files' modification times and its
 * inputs' `as_of`; `local.daily`'s the newest of its inputs'.
 */
import type { PlanReading } from '../ingest/plans.js';
import type { ReplicaBuild, SourceStamp } from '@open-tomato/atlas-data/replica';

import { statSync } from 'node:fs';

import { guardTestProcess } from '@open-tomato/rafa-core/store/location';
import { Database } from 'bun:sqlite';

import { dayOf, newest } from '../ingest/columns.js';
import { TASKS_SOURCE } from '../ingest/effort.js';
import { BUGS_SOURCE, CHANGES_SOURCE, CI_SOURCE, FINDINGS_SOURCE } from '../ingest/facts.js';
import { COMMITS_SOURCE } from '../ingest/git.js';
import { readPlans } from '../ingest/plans.js';

import { DAILY_SOURCE, KIND_SUFFIXES, rollupDaily } from './daily.js';

/** The `atlas_sources` row `plan_facts` is stamped as. */
export const PLANS_SOURCE = 'local.plans';

/** The kind of work a session did, read from its change level (D4). */
export type WorkType = 'feature' | 'fix' | 'chore';

/** A change level's rank among a session's changes, the highest winning, and the work type it reads as. */
export interface ChangeLevel {
  readonly rank: number;
  readonly workType: WorkType;
}

/** Each change level a report may name, with its rank and work type (D4). */
export const CHANGE_LEVELS: Readonly<Record<string, ChangeLevel>> = {
  major: { rank: 3, workType: 'feature' },
  minor: { rank: 2, workType: 'feature' },
  patch: { rank: 1, workType: 'fix' },
  none: { rank: 0, workType: 'chore' },
};

/** The `preflight` columns the day counts read; a missing one leaves both preflight columns NULL. */
export const PREFLIGHT_COLUMNS: readonly string[] = ['run_id', 'tier', 'outcome', 'collected_at'];

/** The `daily_rollup` columns no source read here fills; they read NULL. */
export const UNREAD_DAILY_COLUMNS: readonly string[] = ['prs_merged'];

/** The `plan_facts` columns no source read here fills; they read NULL. */
export const UNREAD_PLAN_COLUMNS: readonly string[] = ['merged_at'];

/** What one derivation is handed. */
export interface DeriveOptions {
  /** The plan folder, absolute: the project's `plan.dir`. */
  readonly planDir: string;
  /** The effort snapshot the ingest read, opened read-only here for `preflight`. */
  readonly snapshotPath: string;
  /** The effort ingest's stamps, then the git and board ingests'; `local.tasks` must be among them. */
  readonly stamps: readonly SourceStamp[];
  /** True when the git ingest read the history into `commit_facts`; `daily_rollup.commits` reads NULL otherwise. */
  readonly gitRead?: boolean;
  /** True when the board ingest read the cache into `issue_facts`; `plan_facts.epic_slug` reads NULL otherwise. */
  readonly boardRead?: boolean;
}

/** One day's preflight runs, and how many of them halted. */
export interface PreflightDay {
  readonly runs: number;
  readonly halts: number;
}

/** What the snapshot's `preflight` table gave. */
export interface PreflightRead {
  /** Runs and halts per day, or null when the table lacks a column of {@link PREFLIGHT_COLUMNS}. */
  readonly days: ReadonlyMap<string, PreflightDay> | null;
  /** The columns missing, as `preflight.<column>`. */
  readonly missing: readonly string[];
}

/** What one derivation did. */
export interface Derivation {
  /** The sessions given a work type. */
  readonly workTyped: number;
  /** The `commit_facts` rows given a plan through `plan_facts.pr_number`. */
  readonly commitsLinked: number;
  /** The `plan_facts` rows given an epic through their issue's `issue_facts.epic_slug`. */
  readonly plansEpicLinked: number;
  /** The `module_facts` rows given their bug, finding and change counts. */
  readonly modulesCounted: number;
  readonly plans: readonly PlanReading[];
  readonly preflight: PreflightRead;
  /** The stamps written: `local.daily`, then `local.plans`. */
  readonly stamps: readonly SourceStamp[];
}

/** The UPDATE giving each session the work type of its highest change level. */
function workTypeStatement(): string {
  const levels = Object.entries(CHANGE_LEVELS);
  const rank = `CASE c.level ${levels.map(([level, { rank: value }]) => `WHEN '${level}' THEN ${String(value)}`).join(' ')} END`;
  const type = levels.map(([, { rank: value, workType }]) => `WHEN ${String(value)} THEN '${workType}'`).join(' ');
  return `UPDATE task_facts SET work_type = (
    SELECT CASE max(${rank}) ${type} END FROM change_facts c WHERE c.session_id = task_facts.session_id)`;
}

/** Fill `task_facts.work_type` (D4); answers the sessions given one. */
export function deriveWorkType(database: Database): number {
  database.run(workTypeStatement());
  const row = database.query<{ readonly n: number }, []>('SELECT count(*) AS n FROM task_facts WHERE work_type IS NOT NULL').get();
  return row?.n ?? 0;
}

/** Read each preflight run's day and whether it halted, from the snapshot; see the module note. */
export function readPreflightDays(snapshot: Database): PreflightRead {
  const held = new Set(snapshot
    .query<{ readonly name: string }, []>('SELECT name FROM pragma_table_info(\'preflight\')')
    .all()
    .map((row) => row.name));
  const missing = PREFLIGHT_COLUMNS.filter((column) => !held.has(column)).map((column) => `preflight.${column}`);
  if (missing.length > 0) return { days: null, missing };
  const runs = snapshot.query<{ readonly at: string | null; readonly halted: number | null }, []>(
    `SELECT min(collected_at) AS at, max(tier = 'required' AND outcome <> 'pass') AS halted
      FROM preflight GROUP BY run_id`,
  ).all();
  const days = new Map<string, PreflightDay>();
  for (const run of runs) {
    const day = dayOf(run.at);
    if (day === null) continue;
    const sofar = days.get(day) ?? { runs: 0, halts: 0 };
    days.set(day, { runs: sofar.runs + 1, halts: sofar.halts + (run.halted === 1
      ? 1
      : 0) });
  }
  return { days, missing };
}

/** Open the snapshot read-only past the test guard and read its preflight days. */
function readSnapshotPreflight(snapshotPath: string): PreflightRead {
  guardTestProcess(snapshotPath);
  const snapshot = new Database(snapshotPath, { readonly: true });
  try {
    return readPreflightDays(snapshot);
  } finally {
    snapshot.close();
  }
}

/** The UPDATE taking each day's counts over the sessions that started on it. */
const DAY_COUNTS = `UPDATE daily_rollup SET
  sessions = (SELECT count(*) FROM task_facts t WHERE t.day = daily_rollup.day),
  task_sessions = (SELECT count(*) FROM task_facts t WHERE t.day = daily_rollup.day AND t.kind = 'task'),
  tasks_done = (SELECT count(*) FROM task_facts t WHERE t.day = daily_rollup.day AND t.kind = 'task' AND t.status = 'done'),
  tasks_blocked = (SELECT count(*) FROM task_facts t WHERE t.day = daily_rollup.day AND t.kind = 'task' AND t.status = 'blocked'),
  findings = (SELECT coalesce(sum(t.findings), 0) FROM task_facts t WHERE t.day = daily_rollup.day),
  bugs = (SELECT coalesce(sum(t.bugs), 0) FROM task_facts t WHERE t.day = daily_rollup.day),
  changes = (SELECT count(*) FROM change_facts c JOIN task_facts t ON t.session_id = c.session_id
    WHERE t.day = daily_rollup.day)`;

/** Each day's commit count, from `commit_facts`. */
const DAY_COMMITS = `UPDATE daily_rollup SET
  commits = (SELECT count(*) FROM commit_facts c WHERE c.day = daily_rollup.day)`;

/** The days a commit landed on. */
function commitDays(database: Database): readonly string[] {
  return database
    .query<{ readonly day: string }, []>('SELECT DISTINCT day FROM commit_facts WHERE day IS NOT NULL')
    .all()
    .map((row) => row.day);
}

/** Add the commit-only and preflight-only days, then fill every day's counts; answers the rows the bucket holds. */
function fillDailyCounts(database: Database, preflight: PreflightRead, gitRead: boolean): number {
  const zeros = [...KIND_SUFFIXES.flatMap((suffix) => [`minutes_${suffix}`, `tokens_${suffix}`]), 'tokens_total'];
  const addDay = database.prepare<unknown, [string]>(
    `INSERT OR IGNORE INTO daily_rollup (day, ${zeros.join(', ')}) VALUES (?, ${zeros.map(() => '0').join(', ')})`,
  );
  const setPreflight = database.prepare<unknown, [number, number, string]>(
    'UPDATE daily_rollup SET preflight_runs = ?, preflight_halts = ? WHERE day = ?',
  );
  database.transaction(() => {
    if (gitRead) for (const day of commitDays(database)) addDay.run(day);
    const days = preflight.days;
    if (days !== null) {
      for (const day of days.keys()) addDay.run(day);
      database.run('UPDATE daily_rollup SET preflight_runs = 0, preflight_halts = 0');
      for (const [day, counts] of days) setPreflight.run(counts.runs, counts.halts, day);
    }
    database.run(DAY_COUNTS);
    if (gitRead) database.run(DAY_COMMITS);
  })();
  const row = database.query<{ readonly n: number }, []>('SELECT count(*) AS n FROM daily_rollup').get();
  return row?.n ?? 0;
}

/** One plan's session totals, as the plan query answers them. */
interface SessionTotals {
  readonly plan_stub: string;
  readonly sessions: number;
  readonly task_sessions: number;
  readonly reports_done: number;
  readonly reports_blocked: number;
  readonly repeat_sessions: number;
  readonly ci_repair_sessions: number;
  readonly first_at: string | null;
  readonly last_at: string | null;
  readonly minutes: number;
  readonly tokens: number;
}

/** One plan's CI totals, as the CI query answers them. */
interface CiTotals {
  readonly plan_stub: string;
  readonly red_readings: number;
  readonly last_verdict: string | null;
  readonly pr: number | null;
}

const SESSION_TOTALS = `SELECT plan_stub, count(*) AS sessions,
  sum(kind = 'task') AS task_sessions,
  sum(kind = 'task' AND status = 'done') AS reports_done,
  sum(kind = 'task' AND status = 'blocked') AS reports_blocked,
  sum(kind = 'task' AND coalesce(attempt, 1) > 1) AS repeat_sessions,
  sum(kind = 'ci-repair') AS ci_repair_sessions,
  min(started_at) AS first_at, max(ended_at) AS last_at,
  total(minutes) AS minutes, coalesce(sum(tokens), 0) AS tokens
  FROM task_facts WHERE plan_stub IS NOT NULL GROUP BY plan_stub`;

const CI_TOTALS = `SELECT plan_stub, sum(verdict = 'red') AS red_readings,
  (SELECT l.verdict FROM ci_facts l WHERE l.plan_stub = c.plan_stub ORDER BY l.read_at DESC, l.head_sha DESC LIMIT 1) AS last_verdict,
  (SELECT l.pr FROM ci_facts l WHERE l.plan_stub = c.plan_stub AND l.pr IS NOT NULL
    ORDER BY l.read_at DESC, l.head_sha DESC LIMIT 1) AS pr
  FROM ci_facts c GROUP BY plan_stub`;

/** The plan stubs the build's sessions and CI readings name. */
function storeStubs(database: Database): readonly string[] {
  return database
    .query<{ readonly plan_stub: string }, []>(
      'SELECT plan_stub FROM task_facts WHERE plan_stub IS NOT NULL UNION SELECT plan_stub FROM ci_facts',
    )
    .all()
    .map((row) => row.plan_stub);
}

/** The `plan_facts` columns written, in the order {@link insertPlanFacts} binds them. */
const PLAN_COLUMNS: readonly string[] = [
  'plan_stub', 'issue_number', 'plan_source', 'tasks_planned', 'tasks_done', 'tasks_blocked',
  'sessions', 'task_sessions', 'reports_done', 'reports_blocked', 'repeat_sessions', 'ci_repair_sessions',
  'first_at', 'last_at', 'minutes', 'tokens', 'ci_last_verdict', 'ci_red_readings', 'pr_number', 'completed',
];

/** One plan's row, in {@link PLAN_COLUMNS} order. */
function planRow(reading: PlanReading, sessions: SessionTotals | undefined, ci: CiTotals | undefined): (string | number | null)[] {
  const { tasks } = reading;
  const completed = tasks !== null && tasks.total > 0 && tasks.done === tasks.total;
  return [
    reading.stub, reading.issueNumber, reading.source, tasks?.total ?? null, tasks?.done ?? null, tasks?.blocked ?? null,
    sessions?.sessions ?? 0, sessions?.task_sessions ?? 0, sessions?.reports_done ?? 0, sessions?.reports_blocked ?? 0,
    sessions?.repeat_sessions ?? 0, sessions?.ci_repair_sessions ?? 0,
    sessions?.first_at ?? null, sessions?.last_at ?? null, sessions?.minutes ?? null, sessions?.tokens ?? null,
    ci?.last_verdict ?? null, ci?.red_readings ?? 0, ci?.pr ?? null, completed
      ? 1
      : 0,
  ];
}

/** Insert one `plan_facts` row per reading; answers the rows written. */
function insertPlanFacts(database: Database, readings: readonly PlanReading[]): number {
  const sessions = new Map(database.query<SessionTotals, []>(SESSION_TOTALS).all()
    .map((row) => [row.plan_stub, row]));
  const ci = new Map(database.query<CiTotals, []>(CI_TOTALS).all()
    .map((row) => [row.plan_stub, row]));
  const insert = database.prepare<unknown, (string | number | null)[]>(
    `INSERT INTO plan_facts (${PLAN_COLUMNS.join(', ')}) VALUES (${PLAN_COLUMNS.map(() => '?').join(', ')})`,
  );
  database.transaction(() => {
    for (const reading of readings) insert.run(...planRow(reading, sessions.get(reading.stub), ci.get(reading.stub)));
  })();
  return readings.length;
}

/** The UPDATE giving each commit the one plan naming its pull request. */
const COMMIT_PLANS = `UPDATE commit_facts SET plan_stub = (
    SELECT min(p.plan_stub) FROM plan_facts p WHERE p.pr_number = commit_facts.pr_number)
  WHERE pr_number IS NOT NULL
    AND (SELECT count(*) FROM plan_facts p WHERE p.pr_number = commit_facts.pr_number) = 1`;

/** Fill `commit_facts.plan_stub` through `plan_facts.pr_number`; answers the commits given a plan. */
export function linkCommitPlans(database: Database): number {
  database.run(COMMIT_PLANS);
  const row = database.query<{ readonly n: number }, []>('SELECT count(*) AS n FROM commit_facts WHERE plan_stub IS NOT NULL').get();
  return row?.n ?? 0;
}

/** The UPDATE giving each plan the epic slug of its issue. */
const PLAN_EPICS = `UPDATE plan_facts SET epic_slug = (
    SELECT i.epic_slug FROM issue_facts i WHERE i.number = plan_facts.issue_number)
  WHERE issue_number IS NOT NULL`;

/** Fill `plan_facts.epic_slug` through the plan's `issue_number`; answers the plans given an epic. */
export function linkPlanEpics(database: Database): number {
  database.run(PLAN_EPICS);
  const row = database.query<{ readonly n: number }, []>('SELECT count(*) AS n FROM plan_facts WHERE epic_slug IS NOT NULL').get();
  return row?.n ?? 0;
}

/** The UPDATE counting each module's bugs, findings and changes from the effort buckets. */
const MODULE_COUNTS = `UPDATE module_facts SET
  bugs = (SELECT count(*) FROM bug_facts b WHERE b.module = module_facts.path AND b.source = 'out_of_scope'),
  findings = (SELECT count(*) FROM finding_facts f WHERE f.module = module_facts.path AND f.source = 'finding'),
  changes = (SELECT count(*) FROM change_facts c WHERE c.module = module_facts.path)`;

/** Fill `module_facts.bugs`, `findings` and `changes` by module; answers the modules counted. */
export function countModuleFacts(database: Database): number {
  database.run(MODULE_COUNTS);
  const row = database.query<{ readonly n: number }, []>('SELECT count(*) AS n FROM module_facts').get();
  return row?.n ?? 0;
}

/** The modification time of a plan's file, ISO-8601 UTC, or null for a `missing` plan. */
function modifiedAt(reading: PlanReading): string | null {
  return reading.path === null
    ? null
    : statSync(reading.path).mtime.toISOString();
}

/** A stamp's reason: its own reasons, then each partial input's, named by source. */
function reasonOf(own: readonly string[], inputs: readonly SourceStamp[]): string | null {
  const carried = inputs
    .filter((input) => input.partial && input.reason !== null)
    .map((input) => `${input.source}: ${String(input.reason)}`);
  const reasons = [...own, ...carried];
  return reasons.length === 0
    ? null
    : reasons.join('; ');
}

/** The input stamps of `sources`, in that order, those the ingest stamped. */
function inputsOf(stamps: readonly SourceStamp[], sources: readonly string[]): readonly SourceStamp[] {
  return sources
    .map((source) => stamps.find((stamp) => stamp.source === source))
    .filter((stamp): stamp is SourceStamp => stamp !== undefined);
}

/** The stamp of `source`, partial when it has a reason. */
function stampOf(source: string, rows: number, asOf: string | null, readAt: string, reason: string | null): SourceStamp {
  return { source, asOf, readAt, rows, partial: reason !== null, reason };
}

/** The sentence naming `columns` a later source fills. */
function unreadSentence(columns: readonly string[], sources: string): string {
  return columns.length === 1
    ? `${columns.join(', ')} is not read yet (${sources}) and reads NULL`
    : `${columns.join(', ')} are not read yet (${sources}) and read NULL`;
}

/** The `local.daily` stamp: the unread columns, a missing preflight column or git history, and its inputs' reasons. */
function dailyStamp(stamps: readonly SourceStamp[], readAt: string, rows: number, preflight: PreflightRead, gitRead: boolean): SourceStamp {
  const inputs = inputsOf(stamps, [TASKS_SOURCE, FINDINGS_SOURCE, BUGS_SOURCE, CHANGES_SOURCE, COMMITS_SOURCE]);
  const own = [
    unreadSentence(UNREAD_DAILY_COLUMNS, 'the GitHub source'),
    ...(gitRead
      ? []
      : ['no git history was read; commits reads NULL']),
    ...(preflight.missing.length === 0
      ? []
      : [`the effort store has no ${preflight.missing.join(', ')}; preflight_runs, preflight_halts read NULL`]),
  ];
  const asOf = newest(inputs.map((input) => input.asOf));
  return stampOf(DAILY_SOURCE, rows, asOf, readAt, reasonOf(own, inputs));
}

/** The `local.plans` stamp: the unread columns, a missing board cache, and its inputs' reasons, as of the newest plan file or input. */
function plansStamp(stamps: readonly SourceStamp[], readAt: string, rows: number, plans: readonly PlanReading[], boardRead: boolean): SourceStamp {
  const inputs = inputsOf(stamps, [TASKS_SOURCE, CI_SOURCE]);
  const own = [
    unreadSentence(UNREAD_PLAN_COLUMNS, 'the GitHub source'),
    ...(boardRead
      ? []
      : ['no board cache was read; epic_slug reads NULL']),
  ];
  const asOf = newest([...plans.map(modifiedAt), ...inputs.map((input) => input.asOf)]);
  return stampOf(PLANS_SOURCE, rows, asOf, readAt, reasonOf(own, inputs));
}

/**
 * Derive the work type, the whole of `daily_rollup` and `plan_facts` in
 * the build, the plan of each commit, the epic of each plan and each
 * module's counts, after the effort, git, board and module ingests have
 * filled their buckets, and stamp {@link DAILY_SOURCE} then
 * {@link PLANS_SOURCE}; see the module note.
 * Throws when `options.stamps` holds no `local.tasks` stamp.
 */
export function deriveBuild(build: ReplicaBuild, options: DeriveOptions): Derivation {
  const tasks = options.stamps.find((stamp) => stamp.source === TASKS_SOURCE);
  if (tasks === undefined) throw new Error(`atlas: the derivation needs the ${TASKS_SOURCE} stamp of the effort ingest`);
  const { database } = build;
  const workTyped = deriveWorkType(database);
  rollupDaily(database);
  const gitRead = options.gitRead ?? false;
  const preflight = readSnapshotPreflight(options.snapshotPath);
  const days = fillDailyCounts(database, preflight, gitRead);
  const plans = readPlans({ planDir: options.planDir, stubs: storeStubs(database) });
  const planRows = insertPlanFacts(database, plans);
  const commitsLinked = linkCommitPlans(database);
  const boardRead = options.boardRead ?? false;
  const plansEpicLinked = boardRead
    ? linkPlanEpics(database)
    : 0;
  const modulesCounted = countModuleFacts(database);
  const stamps = [
    dailyStamp(options.stamps, tasks.readAt, days, preflight, gitRead),
    plansStamp(options.stamps, tasks.readAt, planRows, plans, boardRead),
  ];
  stamps.forEach((stamp) => build.stampSource(stamp));
  return { workTyped, commitsLinked, plansEpicLinked, modulesCounted, plans, preflight, stamps };
}
