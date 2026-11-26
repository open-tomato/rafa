/**
 * The connector's Drizzle schema: the tables one project's Postgres
 * schema holds, the file `drizzle-kit generate` reads (`SCHEMA_FILE`).
 *
 * ## The row tables
 *
 * One table per table a device's `exportWirePayload`
 * (`@open-tomato/rafa/store`) answers under wire contract 1: the merged
 * tables of the device's `MERGE_RULES`, each column by the name the wire
 * carries it under, at the schema the device's migration ids in
 * `wire-migrations.ts` make. `schema.test.ts` exports a device store
 * brought through every migration, a row planted in each table, and fails
 * on a wire table or column with no column here, and on one here the
 * wire does not carry.
 *
 * A device's SQLite types read across as the wire carries them: TEXT as
 * `text`, INTEGER as `bigint` read as a JS number (the wire carries safe
 * integers only, a flag and a count alike), REAL as `double precision`.
 * A column the device holds NOT NULL is NOT NULL here, and one the device
 * leaves nullable stays nullable, so a row a device writes lands here as
 * written. The device's CHECK constraints and natural-key UNIQUE
 * constraints are not repeated: a row reaches the hub through the
 * device's own store, which held it to them, and the hub's merge matches
 * rows by origin pair, which the one index below keeps unique.
 *
 * Each row table holds:
 *
 *   - `seq`, the hub's own, the cursor a pull answers. It has no default:
 *     an identity value is taken when a transaction asks for it and is
 *     seen when that transaction commits, so two pushes could commit
 *     their values out of order and a pull past the higher one would
 *     never read the lower. The push assigns `seq` itself, one push to a
 *     table at a time;
 *   - the device's columns;
 *   - the origin pair, `origin_store` and `origin_seq`, with the unique
 *     index `<table>_by_origin` over the pair where `origin_store` is
 *     set, as the device's own `<table>_by_origin` is.
 *
 * A table or column a later device migration adds (the backfill spec's
 * `prov_*` columns, `backfill_runs`, `ref_links`, `calibrations`,
 * `source_windows`) joins here by a schema change, a new generated
 * Drizzle migration and its entry in `wire-migrations.ts`, in one commit.
 *
 * ## The store metadata
 *
 * {@link hubStoreMeta}, one row: the project the schema holds, the wire
 * contract version its tables mirror, and the embedding record (`model`,
 * `hash`, `dimension`, `precision`) the index's vectors were built under,
 * all four set or none. It is the hub's, never a device's `store_meta`,
 * which is local to its machine and never crosses the wire.
 *
 * ## The devices
 *
 * {@link hubDevices}, one row per device that has pushed to the project:
 * its store origin and when its latest push was taken. The hub's own, as
 * the metadata is, and no wire table, so the Drizzle migration that adds
 * it covers no wire id in `wire-migrations.ts`.
 *
 * ## The serving build
 *
 * {@link hubIndexServing}, one row once the project's index has been
 * built: the schema of the build its searches read. The index itself is
 * never in the project's schema: each build is a schema of its own
 * (`index-build.ts`), made at rebuild and never migrated. The pointer is
 * the hub's own, so its Drizzle migration covers no wire id either.
 *
 * ## One schema per project
 *
 * The tables are declared with no Postgres schema, so the SQL
 * `drizzle-kit generate` writes names none: the connector creates the
 * project's schema and sets `search_path` to it before it migrates or
 * queries, and the same migrations build every project's tables apart.
 *
 * Nothing here is exported from the package's entry: under the leak rule
 * no Drizzle table leaves the connector.
 */
import type { BuildColumns } from 'drizzle-orm';
import type {
  IsPrimaryKey,
  NotNull,
} from 'drizzle-orm/column-builder';
import type {
  PgColumnBuilderBase,
  PgIntegerBuilderInitial,
  PgTableWithColumns,
  PgTextBuilderInitial,
} from 'drizzle-orm/pg-core';

import { sql } from 'drizzle-orm';
import {
  bigint,
  check,
  doublePrecision,
  integer,
  pgTable,
  text,
  uniqueIndex,
} from 'drizzle-orm/pg-core';

/**
 * A row table of the wire, by its columns' wire names: each property is
 * the column of that name, so a wire row is the table's insert value as
 * it stands. Typed wide, one type for every row table, since a push or a
 * pull reads its columns by the names a payload carries, never by a
 * name the compiler knows.
 */
export type WireTable = PgTableWithColumns<{
  name: string;
  schema: undefined;
  columns: BuildColumns<string, WireColumns, 'pg'>;
  dialect: 'pg';
}>;

/** A row table's column builders, by the wire names of their columns. */
type WireColumns = Record<string, PgColumnBuilderBase>;

/** A device INTEGER column: a whole number the wire carries as a safe integer. */
function wholeNumber<TName extends string>(name: TName) {
  return bigint(name, { mode: 'number' });
}

/**
 * A row table of the wire: `seq`, then the device's `columns`, then the
 * origin pair and its partial unique index; see the module note.
 */
function wireTable(name: string, columns: WireColumns): WireTable {
  const all: WireColumns = {
    seq: wholeNumber('seq').primaryKey(),
    ...columns,
    origin_store: text('origin_store'),
    origin_seq: wholeNumber('origin_seq'),
  };
  return pgTable(name, all, (table) => {
    const store = table['origin_store'];
    const seq = table['origin_seq'];
    if (store === undefined || seq === undefined) throw new Error(`hub schema: ${name} lost its origin pair`);
    return [
      uniqueIndex(`${name}_by_origin`)
        .on(store, seq)
        .where(sql`${store} IS NOT NULL`),
    ];
  });
}

/** The columns a task's report rows open with: whose session, which plan and which task line. */
function reportColumns() {
  return {
    session_id: text('session_id').notNull(),
    plan_stub: text('plan_stub'),
    task_line: text('task_line').notNull(),
  };
}

/** Sessions: the session's id and its row, held as JSON. */
export const sessions: WireTable = wireTable('sessions', {
  session_id: text('session_id').notNull(),
  row_json: text('row_json').notNull(),
  worktree: text('worktree'),
});

/** Commits: the commit's sha and its row, held as JSON. */
export const commits: WireTable = wireTable('commits', {
  sha: text('sha').notNull(),
  row_json: text('row_json').notNull(),
});

/** A report's findings. */
export const findings: WireTable = wireTable('findings', {
  id: text('id').notNull(),
  ...reportColumns(),
  kind: text('kind'),
  trigger: text('trigger'),
  what: text('what'),
  cause: text('cause'),
  resolution: text('resolution'),
  artifact: text('artifact'),
  signal: text('signal'),
  outcome: text('outcome').notNull(),
  tracker_ref: text('tracker_ref'),
  collected_at: text('collected_at').notNull(),
});

/** A report's blockers. */
export const blockers: WireTable = wireTable('blockers', {
  id: text('id').notNull(),
  ...reportColumns(),
  what: text('what').notNull(),
  artifact: text('artifact'),
  outcome: text('outcome').notNull(),
  collected_at: text('collected_at').notNull(),
});

/** A report's out-of-scope bugs. */
export const outOfScopeBugs: WireTable = wireTable('out_of_scope_bugs', {
  id: text('id').notNull(),
  ...reportColumns(),
  what: text('what').notNull(),
  artifact: text('artifact'),
  security: wholeNumber('security'),
  outcome: text('outcome').notNull(),
  collected_at: text('collected_at').notNull(),
  scope: text('scope'),
});

/** A task that ended with no readable report, and why. */
export const reportAbsences: WireTable = wireTable('report_absences', {
  id: text('id').notNull(),
  ...reportColumns(),
  reason: text('reason').notNull(),
  detail: text('detail').notNull(),
  block_body: text('block_body'),
  outcome: text('outcome').notNull(),
  collected_at: text('collected_at').notNull(),
});

/** One row per task report: its status and the skills it named. */
export const taskReports: WireTable = wireTable('task_reports', {
  id: text('id').notNull(),
  ...reportColumns(),
  status: text('status'),
  outcome: text('outcome').notNull(),
  collected_at: text('collected_at').notNull(),
  skills_used: text('skills_used'),
});

/** The preflight's items, one row per item of a run. */
export const preflight: WireTable = wireTable('preflight', {
  run_id: text('run_id').notNull(),
  position: wholeNumber('position').notNull(),
  tier: text('tier').notNull(),
  kind: text('kind').notNull(),
  item: text('item').notNull(),
  probe: text('probe'),
  outcome: text('outcome').notNull(),
  duration_ms: wholeNumber('duration_ms').notNull(),
  failure: text('failure'),
  collected_at: text('collected_at').notNull(),
});

/** How each task's session was dispatched. */
export const dispatches: WireTable = wireTable('dispatches', {
  session_id: text('session_id').notNull(),
  plan_stub: text('plan_stub'),
  task_line: text('task_line').notNull(),
  declaration: text('declaration'),
  agent: text('agent'),
  model: text('model'),
  effort: text('effort'),
  budget_usd: doublePrecision('budget_usd'),
  tools: text('tools'),
  flags: text('flags').notNull(),
  collected_at: text('collected_at').notNull(),
  resolver: text('resolver'),
  skills_offered: text('skills_offered'),
  lessons_offered: text('lessons_offered'),
});

/** A report's changelog entries. */
export const changes: WireTable = wireTable('changes', {
  id: text('id').notNull(),
  ...reportColumns(),
  level: text('level').notNull(),
  area: text('area'),
  summary: text('summary').notNull(),
  collected_at: text('collected_at').notNull(),
});

/** The skills a session invoked, with how often. */
export const skillInvocations: WireTable = wireTable('skill_invocations', {
  session_id: text('session_id').notNull(),
  name: text('name'),
  sidechain: wholeNumber('sidechain'),
  count: wholeNumber('count'),
});

/** A plan's pull request checks, one row per reading. */
export const planCi: WireTable = wireTable('plan_ci', {
  plan_stub: text('plan_stub').notNull(),
  pr: wholeNumber('pr').notNull(),
  head_sha: text('head_sha').notNull(),
  verdict: text('verdict').notNull(),
  failing: text('failing').notNull(),
  read_at: text('read_at').notNull(),
});

/** A report's stale documentation lines. */
export const staleDocs: WireTable = wireTable('stale_docs', {
  id: text('id').notNull(),
  ...reportColumns(),
  kind: text('kind').notNull(),
  where_at: text('where_at'),
  what: text('what').notNull(),
  outcome: text('outcome').notNull(),
  collected_at: text('collected_at').notNull(),
});

/** Where each out-of-scope bug of a report was routed. */
export const bugRoutes: WireTable = wireTable('bug_routes', {
  id: text('id').notNull(),
  ...reportColumns(),
  entry_index: wholeNumber('entry_index').notNull(),
  what: text('what').notNull(),
  said: text('said'),
  kind: text('kind').notNull(),
  route: text('route').notNull(),
  collected_at: text('collected_at').notNull(),
});

/** Which reading of a table supersedes which, by key. */
export const readingSupersedes: WireTable = wireTable('reading_supersedes', {
  table_name: text('table_name').notNull(),
  canonical_key: text('canonical_key').notNull(),
  superseded_key: text('superseded_key').notNull(),
  rule: text('rule').notNull(),
});

/** A `text` column of the metadata, by its name. */
type MetaText<TName extends string> = PgTextBuilderInitial<TName, [string, ...string[]]>;

/** The metadata's columns, as `pgTable` takes them. */
type HubStoreMetaColumns = {
  readonly id: IsPrimaryKey<NotNull<PgIntegerBuilderInitial<'id'>>>;
  readonly projectId: NotNull<MetaText<'project_id'>>;
  readonly contractVersion: NotNull<PgIntegerBuilderInitial<'contract_version'>>;
  readonly createdAt: NotNull<MetaText<'created_at'>>;
  readonly embeddingModel: MetaText<'embedding_model'>;
  readonly embeddingHash: MetaText<'embedding_hash'>;
  readonly embeddingDimension: PgIntegerBuilderInitial<'embedding_dimension'>;
  readonly embeddingPrecision: MetaText<'embedding_precision'>;
};

/** The metadata table's type, its columns by name. */
export type HubStoreMetaTable = PgTableWithColumns<{
  name: 'hub_store_meta';
  schema: undefined;
  columns: BuildColumns<'hub_store_meta', HubStoreMetaColumns, 'pg'>;
  dialect: 'pg';
}>;

/** The one row a project's schema is held to: its project, contract and embedding record. */
export const hubStoreMeta: HubStoreMetaTable = pgTable(
  'hub_store_meta',
  {
    id: integer('id').primaryKey(),
    projectId: text('project_id').notNull(),
    contractVersion: integer('contract_version').notNull(),
    createdAt: text('created_at').notNull(),
    embeddingModel: text('embedding_model'),
    embeddingHash: text('embedding_hash'),
    embeddingDimension: integer('embedding_dimension'),
    embeddingPrecision: text('embedding_precision'),
  },
  (table) => [
    check('hub_store_meta_one_row', sql`${table.id} = 1`),
    check('hub_store_meta_project', sql`${table.projectId} <> ''`),
    check('hub_store_meta_contract', sql`${table.contractVersion} > 0`),
    check('hub_store_meta_dimension', sql`${table.embeddingDimension} > 0`),
    check('hub_store_meta_precision', sql`${table.embeddingPrecision} IN ('half', 'full')`),
    check('hub_store_meta_embedding', sql`(
      ${table.embeddingModel} IS NULL
      AND ${table.embeddingHash} IS NULL
      AND ${table.embeddingDimension} IS NULL
      AND ${table.embeddingPrecision} IS NULL
    ) OR (
      ${table.embeddingModel} IS NOT NULL
      AND ${table.embeddingHash} IS NOT NULL
      AND ${table.embeddingDimension} IS NOT NULL
      AND ${table.embeddingPrecision} IS NOT NULL
    )`),
  ],
);

/** The devices table's columns, as `pgTable` takes them. */
type HubDevicesColumns = {
  readonly device: IsPrimaryKey<NotNull<MetaText<'device'>>>;
  readonly lastPushAt: NotNull<MetaText<'last_push_at'>>;
};

/** The devices table's type, its columns by name. */
export type HubDevicesTable = PgTableWithColumns<{
  name: 'hub_devices';
  schema: undefined;
  columns: BuildColumns<'hub_devices', HubDevicesColumns, 'pg'>;
  dialect: 'pg';
}>;

/**
 * Each device's last push to the project, by the device's store origin:
 * the hub's own, as the metadata is, never a wire table. A push stamps
 * it, one that adds nothing included; `status()` answers it in `device`
 * order.
 */
export const hubDevices: HubDevicesTable = pgTable('hub_devices', {
  device: text('device').primaryKey(),
  lastPushAt: text('last_push_at').notNull(),
});

/** The serving build's columns, as `pgTable` takes them. */
type HubIndexServingColumns = {
  readonly id: IsPrimaryKey<NotNull<PgIntegerBuilderInitial<'id'>>>;
  readonly buildSchema: NotNull<MetaText<'build_schema'>>;
  readonly stamp: NotNull<MetaText<'stamp'>>;
  readonly builtAt: NotNull<MetaText<'built_at'>>;
};

/** The serving build's table type, its columns by name. */
export type HubIndexServingTable = PgTableWithColumns<{
  name: 'hub_index_serving';
  schema: undefined;
  columns: BuildColumns<'hub_index_serving', HubIndexServingColumns, 'pg'>;
  dialect: 'pg';
}>;

/**
 * The build the project's index is served from, one row once a rebuild
 * has swapped one in: the build's schema (`index_<project>_<build>`),
 * its stamp and when it was built. The hub's own, never a wire table.
 * The rebuild repoints it in the transaction that drops the old build;
 * a reader locks it `FOR SHARE` (`index-build.ts`).
 */
export const hubIndexServing: HubIndexServingTable = pgTable(
  'hub_index_serving',
  {
    id: integer('id').primaryKey(),
    buildSchema: text('build_schema').notNull(),
    stamp: text('stamp').notNull(),
    builtAt: text('built_at').notNull(),
  },
  (table) => [
    check('hub_index_serving_one_row', sql`${table.id} = 1`),
    check('hub_index_serving_build', sql`${table.buildSchema} LIKE 'index\\_%'`),
  ],
);

/** Every row table, by the wire table name it mirrors. */
export const WIRE_TABLES: Readonly<Record<string, WireTable>> = {
  sessions,
  commits,
  findings,
  blockers,
  out_of_scope_bugs: outOfScopeBugs,
  report_absences: reportAbsences,
  task_reports: taskReports,
  preflight,
  dispatches,
  changes,
  skill_invocations: skillInvocations,
  plan_ci: planCi,
  stale_docs: staleDocs,
  bug_routes: bugRoutes,
  reading_supersedes: readingSupersedes,
} as const;
