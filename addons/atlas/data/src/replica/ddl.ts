/**
 * The replica's tables: the seven buckets of the PoC (`task_facts`,
 * `plan_facts`, `daily_rollup`, `bug_facts`, `finding_facts`,
 * `change_facts`, `ci_facts`) and the two meta tables every replica holds (`atlas_meta`,
 * `atlas_sources`). Dates are ISO-8601 UTC text, and `day` is
 * `YYYY-MM-DD`.
 *
 * `REPLICA_TABLES` is the table whitelist: a source reads only a bucket
 * named as one of its keys, so no table name from outside this file
 * reaches SQL text. The meta tables are not keys of it, because no source
 * reads them; the writer stamps them and the reader checks them.
 *
 * A change to any statement here is a new `REPLICA_VERSION`, and a reader
 * refuses a replica stamped with another one.
 */

/** The DDL version stamped as `replica_version`; a reader opens only its own. */
export const REPLICA_VERSION: string = '2';

/** One row per stamp: the keys of `META_KEYS`. */
const ATLAS_META_DDL = 'CREATE TABLE atlas_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)';

/** One row per source read by the build, with its as-of and read-at times. */
const ATLAS_SOURCES_DDL = `CREATE TABLE atlas_sources (source TEXT PRIMARY KEY, as_of TEXT,
  read_at TEXT NOT NULL, rows INTEGER NOT NULL, partial INTEGER NOT NULL DEFAULT 0, reason TEXT)`;

/** The two meta tables, in the order the writer creates them. */
export const META_TABLES: Readonly<Record<'atlas_meta' | 'atlas_sources', string>> = {
  atlas_meta: ATLAS_META_DDL,
  atlas_sources: ATLAS_SOURCES_DDL,
};

/** The stamps the writer puts in `atlas_meta`, by meta key. */
export const META_KEYS: {
  readonly contractVersion: 'contract_version';
  readonly replicaVersion: 'replica_version';
  readonly buildId: 'build_id';
  readonly builtAt: 'built_at';
  readonly projectLabel: 'project_label';
} = {
  contractVersion: 'contract_version',
  replicaVersion: 'replica_version',
  buildId: 'build_id',
  builtAt: 'built_at',
  projectLabel: 'project_label',
};

/** One row per Claude Code session. */
const TASK_FACTS_DDL = `CREATE TABLE task_facts (
  session_id TEXT PRIMARY KEY, origin_store TEXT, origin_seq INTEGER,
  kind TEXT NOT NULL,
  plan_stub TEXT, task_line TEXT, task_text TEXT, branch TEXT, branch_type TEXT,
  agent TEXT, model TEXT, effort TEXT, budget_usd REAL,
  started_at TEXT, ended_at TEXT, day TEXT, minutes REAL,
  input_tokens INTEGER, output_tokens INTEGER, cache_read_tokens INTEGER,
  cache_creation_tokens INTEGER, tokens INTEGER,
  status TEXT,
  attempt INTEGER,
  findings INTEGER NOT NULL DEFAULT 0, bugs INTEGER NOT NULL DEFAULT 0,
  blockers INTEGER NOT NULL DEFAULT 0, skills_used INTEGER NOT NULL DEFAULT 0,
  UNIQUE (origin_store, origin_seq))`;

/** One row per plan. */
const PLAN_FACTS_DDL = `CREATE TABLE plan_facts (
  plan_stub TEXT PRIMARY KEY, issue_number INTEGER, epic_slug TEXT,
  plan_source TEXT NOT NULL,
  tasks_planned INTEGER, tasks_done INTEGER, tasks_blocked INTEGER,
  sessions INTEGER NOT NULL, task_sessions INTEGER NOT NULL, reports_done INTEGER NOT NULL,
  reports_blocked INTEGER NOT NULL, repeat_sessions INTEGER NOT NULL, ci_repair_sessions INTEGER NOT NULL,
  first_at TEXT, last_at TEXT, minutes REAL, tokens INTEGER,
  ci_last_verdict TEXT, ci_red_readings INTEGER NOT NULL DEFAULT 0,
  pr_number INTEGER, merged_at TEXT, completed INTEGER NOT NULL DEFAULT 0)`;

/** One row per calendar day. */
const DAILY_ROLLUP_DDL = `CREATE TABLE daily_rollup (
  day TEXT PRIMARY KEY, sessions INTEGER, task_sessions INTEGER,
  minutes_task REAL, minutes_plan REAL, minutes_wrap_up REAL, minutes_ci_repair REAL, minutes_other REAL,
  tokens_task INTEGER, tokens_plan INTEGER, tokens_wrap_up INTEGER, tokens_ci_repair INTEGER,
  tokens_other INTEGER, tokens_total INTEGER,
  tasks_done INTEGER, tasks_blocked INTEGER, findings INTEGER, bugs INTEGER, changes INTEGER,
  commits INTEGER, prs_merged INTEGER, preflight_runs INTEGER, preflight_halts INTEGER)`;

/** One row per out-of-scope bug or bug route. */
const BUG_FACTS_DDL = `CREATE TABLE bug_facts (
  id TEXT PRIMARY KEY, origin_store TEXT, origin_seq INTEGER,
  source TEXT NOT NULL,
  session_id TEXT, plan_stub TEXT, task_line TEXT, what TEXT, artifact TEXT, module TEXT,
  security INTEGER, scope TEXT,
  kind TEXT, route TEXT,
  outcome TEXT, issue_number INTEGER, day TEXT,
  UNIQUE (origin_store, origin_seq, source))`;

/** One row per finding or blocker. */
const FINDING_FACTS_DDL = `CREATE TABLE finding_facts (
  id TEXT PRIMARY KEY, origin_store TEXT, origin_seq INTEGER,
  source TEXT NOT NULL,
  session_id TEXT, plan_stub TEXT, task_line TEXT, kind TEXT, signal TEXT,
  trigger TEXT, what TEXT, artifact TEXT, module TEXT, outcome TEXT, tracker_ref TEXT, day TEXT,
  UNIQUE (origin_store, origin_seq, source))`;

/** One row per changelog entry a task reported. */
const CHANGE_FACTS_DDL = `CREATE TABLE change_facts (
  id TEXT PRIMARY KEY, origin_store TEXT, origin_seq INTEGER, session_id TEXT, plan_stub TEXT,
  level TEXT, area TEXT, module TEXT, summary TEXT, day TEXT, UNIQUE (origin_store, origin_seq))`;

/** One row per CI reading of a plan's head. */
const CI_FACTS_DDL = `CREATE TABLE ci_facts (
  plan_stub TEXT NOT NULL, pr INTEGER, head_sha TEXT NOT NULL, verdict TEXT NOT NULL,
  failing_json TEXT NOT NULL DEFAULT '[]', failing_count INTEGER NOT NULL DEFAULT 0,
  read_at TEXT NOT NULL, day TEXT,
  flipped INTEGER NOT NULL DEFAULT 0,
  origin_store TEXT, origin_seq INTEGER, PRIMARY KEY (plan_stub, head_sha, read_at))`;

/** A bucket a source may read: a key of `REPLICA_TABLES`. */
export type ReplicaTable =
  | 'task_facts'
  | 'plan_facts'
  | 'daily_rollup'
  | 'bug_facts'
  | 'finding_facts'
  | 'change_facts'
  | 'ci_facts';

/** The table whitelist: each bucket of the PoC with the statement that creates it. */
export const REPLICA_TABLES: Readonly<Record<ReplicaTable, string>> = {
  task_facts: TASK_FACTS_DDL,
  plan_facts: PLAN_FACTS_DDL,
  daily_rollup: DAILY_ROLLUP_DDL,
  bug_facts: BUG_FACTS_DDL,
  finding_facts: FINDING_FACTS_DDL,
  change_facts: CHANGE_FACTS_DDL,
  ci_facts: CI_FACTS_DDL,
};

/** Whether `name` is a whitelisted bucket, compared as an own key of `REPLICA_TABLES`. */
export function isReplicaTable(name: string): name is ReplicaTable {
  return Object.prototype.hasOwnProperty.call(REPLICA_TABLES, name);
}

/** Every statement a new replica runs, meta tables first, then the buckets. */
export function replicaDdl(): readonly string[] {
  return [...Object.values(META_TABLES), ...Object.values(REPLICA_TABLES)];
}
