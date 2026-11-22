/**
 * The effort ingest: one snapshot of the effort store (`snapshot.ts`)
 * read into five buckets of the build, `task_facts` here, one row per
 * session, and `finding_facts`, `bug_facts`, `change_facts` and
 * `ci_facts` through `facts.ts`, whose note says what each of those
 * holds. Each bucket's source is stamped in `atlas_sources`:
 * `local.tasks`, then `local.findings`, `local.bugs`, `local.changes`
 * and `local.ci`.
 *
 * 1. **Column check** (`columns.ts`). Each column of `READ_COLUMNS` the
 *    snapshot lacks is named in the reason of each source read from its
 *    table, with that source marked `partial`. A missing column reads
 *    NULL; a missing `sessions.seq`, `session_id` or `row_json` reads no
 *    session at all. A session whose `row_json` is not valid JSON is
 *    skipped and counted in the reason too.
 * 2. **Read.** `sessions` (its facts through `json_extract` on
 *    `row_json`) left-joined to `dispatches` and `task_reports` on
 *    `session_id`, in `seq` order.
 * 3. **Dedupe (D3).** A row's key is `coalesce(origin_store,
 *    store_meta.store_id)` with `coalesce(origin_seq, seq)`: a row with
 *    no origin pair was written by this store, so its store id and `seq`
 *    are its origin. A plain `UNIQUE` with `INSERT OR IGNORE` would keep
 *    every such row, since SQLite holds NULLs distinct; here the first row
 *    of a key, in `seq` order, is kept and the rest are dropped, before
 *    any insert. The key is what each bucket stores as its origin pair.
 * 4. **Insert** into the build's `task_facts`, with `attempt` numbered
 *    per plan stub and task line by start time, then into the four fact
 *    buckets, which also fill each session's three counts below.
 *
 * What each column holds:
 *
 * - `model` is the model most of the session's records ran
 *   (`modelCounts`), else the model the dispatch declared; `effort` the
 *   same over `effortCounts` and the dispatch's effort. Ties break on
 *   the name.
 * - `minutes` is the span from `firstTimestamp` to `lastTimestamp`,
 *   through core's `minutesBetween`, the rule rafa-effort's
 *   `sessionSpanMinutes` applies; null when either is missing.
 * - `tokens` sums input, output, cache read and cache creation tokens, as
 *   `summariseEpicCost` does: `thinkingTokens` and the ephemeral counts
 *   are left out.
 * - `status` is the report's status for a task session, `absent` when it
 *   has no report or the report holds none, and null for any other kind.
 * - `skills_used` counts the report's `skills_used` list.
 * - `findings` and `blockers` count the session's rows of
 *   `finding_facts`, a tracker-ref-only findings row in neither; `bugs`
 *   counts its out-of-scope rows of `bug_facts`.
 *
 * The `local.tasks` stamp's `as_of` is the newest of the sessions'
 * `lastTimestamp` and the dispatches' and reports' `collected_at`; each
 * fact source's is the newest `collected_at` of its rows, or `read_at`
 * for `local.ci`. The `module` column is filled only when the caller
 * hands the project's modules (`attribute.ts`).
 */
import type { ColumnCheck, EffortTable } from './columns.js';
import type { EffortFactsRead, FactSource } from './facts.js';
import type { EffortSnapshot, EffortSnapshotOptions } from './snapshot.js';
import type { ReplicaBuild, SourceStamp } from '@open-tomato/atlas-data/replica';

import { minutesBetween } from '@open-tomato/rafa-core/store/commit-stats';
import { guardTestProcess } from '@open-tomato/rafa-core/store/location';
import { Database } from 'bun:sqlite';

import { checkEffortColumns, dayOf, missingOf, newest, numberOrNull, textOrNull } from './columns.js';
import {
  BUGS_SOURCE,
  CHANGES_SOURCE,
  CI_SOURCE,
  FACT_SOURCE_TABLES,
  FINDINGS_SOURCE,
  insertEffortFacts,
  readable,
  readEffortFacts,
} from './facts.js';
import { takeEffortSnapshot } from './snapshot.js';

/** The `atlas_sources` row the ingest stamps; `local.tasks` reads it. */
export const TASKS_SOURCE = 'local.tasks';

/** The tables `local.tasks` is read from; its stamp names their missing columns only. */
const TASK_TABLES: readonly EffortTable[] = ['sessions', 'dispatches', 'task_reports', 'store_meta'];

/** The `sessions` columns without which no row is read. */
const SESSION_KEY_COLUMNS: readonly string[] = ['seq', 'session_id', 'row_json'];

/** One `task_facts` row, before its attempt is numbered. */
export interface TaskFact {
  readonly sessionId: string;
  readonly originStore: string | null;
  readonly originSeq: number;
  readonly kind: string;
  readonly planStub: string | null;
  readonly taskLine: string | null;
  readonly taskText: string | null;
  readonly branch: string | null;
  readonly branchType: string | null;
  readonly agent: string | null;
  readonly model: string | null;
  readonly effort: string | null;
  readonly budgetUsd: number | null;
  readonly startedAt: string | null;
  readonly endedAt: string | null;
  readonly day: string | null;
  readonly minutes: number | null;
  readonly inputTokens: number | null;
  readonly outputTokens: number | null;
  readonly cacheReadTokens: number | null;
  readonly cacheCreationTokens: number | null;
  readonly tokens: number | null;
  readonly status: string | null;
  readonly skillsUsed: number;
}

/** What one read of a snapshot answered. */
export interface TaskFactsRead {
  readonly columns: ColumnCheck;
  /** One row per D3 key, in `seq` order. */
  readonly facts: readonly TaskFact[];
  /** Rows dropped as a second row of a D3 key. */
  readonly duplicates: number;
  /** Rows skipped because their `row_json` is not valid JSON. */
  readonly unreadable: number;
  /** The newest fact the snapshot holds, or null. */
  readonly asOf: string | null;
}

/** What one ingest did. */
export interface EffortIngest {
  readonly snapshot: EffortSnapshot;
  readonly read: TaskFactsRead;
  /** The four fact buckets, as read. */
  readonly facts: EffortFactsRead;
  /** The `atlas_sources` row stamped for {@link TASKS_SOURCE}. */
  readonly stamp: SourceStamp;
  /** Every `atlas_sources` row stamped, `local.tasks` first, then the four fact sources. */
  readonly stamps: readonly SourceStamp[];
}

/** One joined row, as the read query answers it. */
interface JoinedRow {
  readonly seq: number;
  readonly session_id: string;
  readonly origin_store: string | null;
  readonly origin_seq: number | null;
  readonly store_id: string | null;
  readonly kind: unknown;
  readonly plan_stub: unknown;
  readonly task_text: unknown;
  readonly branch: unknown;
  readonly branch_type: unknown;
  readonly first_at: unknown;
  readonly last_at: unknown;
  readonly input_tokens: unknown;
  readonly output_tokens: unknown;
  readonly cache_read_tokens: unknown;
  readonly cache_creation_tokens: unknown;
  readonly model_counts: unknown;
  readonly effort_counts: unknown;
  readonly d_plan_stub: unknown;
  readonly d_task_line: unknown;
  readonly agent: unknown;
  readonly d_model: unknown;
  readonly d_effort: unknown;
  readonly budget_usd: unknown;
  readonly r_plan_stub: unknown;
  readonly r_task_line: unknown;
  readonly status: unknown;
  readonly skills_used: unknown;
}

/** The key of a JSON count map with the most records, ties broken on the name; null for none. */
export function dominantKey(countsJson: unknown): string | null {
  if (typeof countsJson !== 'string') return null;
  let counts: unknown;
  try {
    counts = JSON.parse(countsJson);
  } catch {
    return null;
  }
  if (counts === null || typeof counts !== 'object' || Array.isArray(counts)) return null;
  const entries = Object.entries(counts as Record<string, unknown>)
    .filter((entry): entry is [string, number] => typeof entry[1] === 'number' && entry[1] > 0)
    .sort((a, b) => b[1] - a[1] || (a[0] < b[0]
      ? -1
      : 1));
  return entries[0]?.[0] ?? null;
}

function sumOrNull(values: readonly (number | null)[]): number | null {
  const held = values.filter((value): value is number => value !== null);
  return held.length === 0
    ? null
    : held.reduce((sum, value) => sum + value, 0);
}

function skillCount(skillsJson: unknown): number {
  if (typeof skillsJson !== 'string') return 0;
  try {
    const skills: unknown = JSON.parse(skillsJson);
    return Array.isArray(skills)
      ? skills.length
      : 0;
  } catch {
    return 0;
  }
}

/** The SELECT over the snapshot, each column missing from it read as NULL. */
function readQuery(present: ColumnCheck['present']): string {
  const col = (table: EffortTable, alias: string, column: string): string => present[table].has(column)
    ? `${alias}.${column}`
    : 'NULL';
  const joins = (table: EffortTable, alias: string): string => present[table].has('session_id')
    ? `LEFT JOIN ${table} ${alias} ON ${alias}.session_id = s.session_id`
    : '';
  const storeId = present.store_meta.has('id') && present.store_meta.has('store_id')
    ? '(SELECT store_id FROM store_meta WHERE id = 1)'
    : 'NULL';
  const json = (path: string): string => `json_extract(s.row_json, '$.${path}')`;
  return `SELECT s.seq AS seq, s.session_id AS session_id,
    ${col('sessions', 's', 'origin_store')} AS origin_store, ${col('sessions', 's', 'origin_seq')} AS origin_seq,
    ${storeId} AS store_id,
    ${json('kind')} AS kind, ${json('planStub')} AS plan_stub, ${json('taskText')} AS task_text,
    ${json('branch')} AS branch, ${json('branchType')} AS branch_type,
    ${json('firstTimestamp')} AS first_at, ${json('lastTimestamp')} AS last_at,
    ${json('usage.inputTokens')} AS input_tokens, ${json('usage.outputTokens')} AS output_tokens,
    ${json('usage.cacheReadInputTokens')} AS cache_read_tokens,
    ${json('usage.cacheCreationInputTokens')} AS cache_creation_tokens,
    ${json('modelCounts')} AS model_counts, ${json('effortCounts')} AS effort_counts,
    ${col('dispatches', 'd', 'plan_stub')} AS d_plan_stub, ${col('dispatches', 'd', 'task_line')} AS d_task_line,
    ${col('dispatches', 'd', 'agent')} AS agent, ${col('dispatches', 'd', 'model')} AS d_model,
    ${col('dispatches', 'd', 'effort')} AS d_effort, ${col('dispatches', 'd', 'budget_usd')} AS budget_usd,
    ${col('task_reports', 'r', 'plan_stub')} AS r_plan_stub, ${col('task_reports', 'r', 'task_line')} AS r_task_line,
    ${col('task_reports', 'r', 'status')} AS status, ${col('task_reports', 'r', 'skills_used')} AS skills_used
    FROM sessions s ${joins('dispatches', 'd')} ${joins('task_reports', 'r')}
    WHERE json_valid(s.row_json) ORDER BY s.seq`;
}

function factOf(row: JoinedRow): TaskFact {
  const kind = textOrNull(row.kind) ?? 'other';
  const startedAt = textOrNull(row.first_at);
  const endedAt = textOrNull(row.last_at);
  const usage = [row.input_tokens, row.output_tokens, row.cache_read_tokens, row.cache_creation_tokens].map(numberOrNull);
  const [inputTokens = null, outputTokens = null, cacheReadTokens = null, cacheCreationTokens = null] = usage;
  const minutes = startedAt === null || endedAt === null
    ? null
    : minutesBetween(startedAt, endedAt);
  const reportStatus = textOrNull(row.status);
  return {
    sessionId: row.session_id,
    originStore: row.origin_store ?? row.store_id,
    originSeq: row.origin_seq ?? row.seq,
    kind,
    planStub: textOrNull(row.plan_stub) ?? textOrNull(row.d_plan_stub) ?? textOrNull(row.r_plan_stub),
    taskLine: textOrNull(row.d_task_line) ?? textOrNull(row.r_task_line),
    taskText: textOrNull(row.task_text),
    branch: textOrNull(row.branch),
    branchType: textOrNull(row.branch_type),
    agent: textOrNull(row.agent),
    model: dominantKey(row.model_counts) ?? textOrNull(row.d_model),
    effort: dominantKey(row.effort_counts) ?? textOrNull(row.d_effort),
    budgetUsd: numberOrNull(row.budget_usd),
    startedAt,
    endedAt,
    day: dayOf(startedAt),
    minutes,
    inputTokens,
    outputTokens,
    cacheReadTokens,
    cacheCreationTokens,
    tokens: sumOrNull(usage),
    status: kind === 'task'
      ? reportStatus ?? 'absent'
      : null,
    skillsUsed: skillCount(row.skills_used),
  };
}

/** The D3 key of a fact, NULL store id spelled apart from any string. */
function keyOf(fact: TaskFact): string {
  return JSON.stringify([fact.originStore, fact.originSeq]);
}

function collectedAtMax(snapshot: Database, present: ColumnCheck['present'], table: 'dispatches' | 'task_reports'): string | null {
  if (!present[table].has('collected_at')) return null;
  const row = snapshot.query<{ readonly at: unknown }, []>(`SELECT max(collected_at) AS at FROM ${table}`).get();
  return textOrNull(row?.at);
}

/** Read the snapshot's sessions into facts, one per D3 key; see the module note. */
export function readTaskFacts(snapshot: Database): TaskFactsRead {
  const columns = checkEffortColumns(snapshot);
  const { present } = columns;
  if (!SESSION_KEY_COLUMNS.every((column) => present.sessions.has(column))) {
    return { columns, facts: [], duplicates: 0, unreadable: 0, asOf: null };
  }
  const unreadableRow = snapshot
    .query<{ readonly n: number }, []>('SELECT count(*) AS n FROM sessions WHERE NOT json_valid(row_json)')
    .get();
  const seen = new Set<string>();
  const facts: TaskFact[] = [];
  let duplicates = 0;
  for (const row of snapshot.query<JoinedRow, []>(readQuery(present)).all()) {
    const fact = factOf(row);
    const key = keyOf(fact);
    if (seen.has(key)) {
      duplicates += 1;
      continue;
    }
    seen.add(key);
    facts.push(fact);
  }
  const asOf = newest([
    ...facts.map((fact) => fact.endedAt),
    collectedAtMax(snapshot, present, 'dispatches'),
    collectedAtMax(snapshot, present, 'task_reports'),
  ]);
  return { columns, facts, duplicates, unreadable: unreadableRow?.n ?? 0, asOf };
}

/** Each fact's 1-based attempt per plan stub and task line, by start time then `seq` order. */
export function numberAttempts(facts: readonly TaskFact[]): ReadonlyMap<string, number> {
  const groups = new Map<string, { readonly fact: TaskFact; readonly order: number }[]>();
  facts.forEach((fact, order) => {
    if (fact.kind !== 'task' || fact.taskLine === null) return;
    const group = JSON.stringify([fact.planStub, fact.taskLine]);
    groups.set(group, [...(groups.get(group) ?? []), { fact, order }]);
  });
  const attempts = new Map<string, number>();
  for (const members of groups.values()) {
    const started = (entry: { readonly fact: TaskFact }): number => {
      const ms = Date.parse(entry.fact.startedAt ?? '');
      return Number.isNaN(ms)
        ? Number.MAX_SAFE_INTEGER
        : ms;
    };
    [...members]
      .sort((a, b) => started(a) - started(b) || a.order - b.order)
      .forEach((entry, index) => attempts.set(entry.fact.sessionId, index + 1));
  }
  return attempts;
}

/** The `task_facts` columns the ingest writes, in the order {@link insertTaskFacts} binds them. */
const TASK_FACT_COLUMNS: readonly string[] = [
  'session_id', 'origin_store', 'origin_seq', 'kind', 'plan_stub', 'task_line', 'task_text', 'branch', 'branch_type',
  'agent', 'model', 'effort', 'budget_usd', 'started_at', 'ended_at', 'day', 'minutes',
  'input_tokens', 'output_tokens', 'cache_read_tokens', 'cache_creation_tokens', 'tokens',
  'status', 'attempt', 'skills_used',
];

const INSERT_TASK_FACT = `INSERT INTO task_facts (${TASK_FACT_COLUMNS.join(', ')})
  VALUES (${TASK_FACT_COLUMNS.map(() => '?').join(', ')})`;

/** Insert `facts` into the build's `task_facts` in one transaction; answers the rows written. */
export function insertTaskFacts(replica: Database, facts: readonly TaskFact[]): number {
  const attempts = numberAttempts(facts);
  const insert = replica.prepare<unknown, (string | number | null)[]>(INSERT_TASK_FACT);
  replica.transaction(() => {
    for (const fact of facts) {
      const values: (string | number | null)[] = [
        fact.sessionId, fact.originStore, fact.originSeq, fact.kind, fact.planStub, fact.taskLine, fact.taskText,
        fact.branch, fact.branchType, fact.agent, fact.model, fact.effort, fact.budgetUsd,
        fact.startedAt, fact.endedAt, fact.day, fact.minutes,
        fact.inputTokens, fact.outputTokens, fact.cacheReadTokens, fact.cacheCreationTokens, fact.tokens,
        fact.status, attempts.get(fact.sessionId) ?? null, fact.skillsUsed,
      ];
      insert.run(...values);
    }
  })();
  return facts.length;
}

/** The stamp's reason, or null when the read was whole. */
function partialReason(read: TaskFactsRead): string | null {
  const reasons: string[] = [];
  const missing = missingOf(read.columns, TASK_TABLES);
  if (missing.length > 0) {
    reasons.push(`the effort store has no ${missing.join(', ')}; those fields read NULL`);
  }
  if (!SESSION_KEY_COLUMNS.every((column) => read.columns.present.sessions.has(column))) {
    reasons.push('no session row was read');
  }
  if (read.unreadable > 0) {
    reasons.push(`${String(read.unreadable)} session rows hold no valid JSON and were skipped`);
  }
  return reasons.length === 0
    ? null
    : reasons.join('; ');
}

/** The reason of a fact source's stamp, or null when it was read whole. */
function factReason(columns: ColumnCheck, source: FactSource): string | null {
  const tables = FACT_SOURCE_TABLES[source];
  const reasons: string[] = [];
  const missing = missingOf(columns, tables);
  if (missing.length > 0) reasons.push(`the effort store has no ${missing.join(', ')}; those fields read NULL`);
  const unread = tables.filter((table) => table !== 'store_meta' && !readable(columns.present, table));
  if (unread.length > 0) reasons.push(`no row of ${unread.join(', ')} was read`);
  return reasons.length === 0
    ? null
    : reasons.join('; ');
}

/** What one ingest is handed: the snapshot's options and the modules the `module` column names. */
export interface EffortIngestOptions extends EffortSnapshotOptions {
  /** The project's modules, as `discoverModules` answers them; none reads every `module` as NULL. */
  readonly modules?: readonly string[];
}

/**
 * Snapshot the store under `options.root`, fill the build's `task_facts`
 * and the four fact buckets from the copy, and stamp {@link TASKS_SOURCE}
 * then each fact bucket's source. The copy is opened read-only and closed
 * before this returns.
 */
export function ingestEffort(build: ReplicaBuild, options: EffortIngestOptions): EffortIngest {
  const snapshot = takeEffortSnapshot(options);
  guardTestProcess(snapshot.snapshotPath);
  const database = new Database(snapshot.snapshotPath, { readonly: true });
  try {
    const read = readTaskFacts(database);
    const rows = insertTaskFacts(build.database, read.facts);
    const facts = readEffortFacts(database, read.columns, options.modules ?? []);
    const written = insertEffortFacts(build.database, facts);
    const reason = partialReason(read);
    const stampOf = (source: string, sourceRows: number, asOf: string | null, why: string | null): SourceStamp => ({
      source,
      asOf,
      readAt: snapshot.takenAt,
      rows: sourceRows,
      partial: why !== null,
      reason: why,
    });
    const stamp = stampOf(TASKS_SOURCE, rows, read.asOf, reason);
    const stamps = [
      stamp,
      stampOf(FINDINGS_SOURCE, written.finding_facts, facts.asOf[FINDINGS_SOURCE], factReason(read.columns, FINDINGS_SOURCE)),
      stampOf(BUGS_SOURCE, written.bug_facts, facts.asOf[BUGS_SOURCE], factReason(read.columns, BUGS_SOURCE)),
      stampOf(CHANGES_SOURCE, written.change_facts, facts.asOf[CHANGES_SOURCE], factReason(read.columns, CHANGES_SOURCE)),
      stampOf(CI_SOURCE, written.ci_facts, facts.asOf[CI_SOURCE], factReason(read.columns, CI_SOURCE)),
    ];
    stamps.forEach((each) => build.stampSource(each));
    return { snapshot, read, facts, stamp, stamps };
  } finally {
    database.close();
  }
}
