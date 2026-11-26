/**
 * The connector's index rebuild: {@link rebuildProjectIndex} builds one
 * project's index as a build schema of its own and repoints the project
 * at it, dropping the build it served before.
 *
 * ## A build is a schema
 *
 * The index never sits on the row tables. `pg_search` allows one BM25
 * index per table ("a relation may only have one ParadeDB index"), so a
 * rebuild beside the serving index needs tables of its own, and an index
 * on the row tables would be one a later fold of the rows could not
 * apply. Each build is the schema `index_<project>_<build>`
 * ({@link buildSchemaName}): `<project>` the project's id lower-cased,
 * `default` on a single-project hub, and `<build>` a random tail of
 * {@link BUILD_ID_LENGTH} hex digits, so a 40-character project id still
 * makes a name within Postgres's 63. It holds:
 *
 *   - a copy of each row table `sqlite-index.ts` indexes: each wire table
 *     the project's schema holds with the origin pair (`origin_store`,
 *     `origin_seq`), in `WIRE_TABLES` order, every column copied, the rows
 *     with a null origin pair left out, as the SQLite rebuild leaves them
 *     out. Each copy adds {@link BODY_COLUMN}, the row's text columns other
 *     than `origin_store`, in column order, the null ones left out, joined
 *     by a newline: the body the SQLite rebuild indexes;
 *   - the BM25 index (`pg_search`) of each copy, `<table>_bm25`, over
 *     `seq`, its key field, and the body;
 *   - with an embedder, {@link EMBEDDING_COLUMN} on each copy, one vector
 *     per row embedded from its body, and its HNSW index (`pgvector`),
 *     `<table>_hnsw`, by cosine distance: `halfvec` under precision `half`,
 *     `vector` under `full`;
 *   - a copy of `ref_links` when the project's schema holds one, which
 *     `links` walks, with no index;
 *   - {@link BUILD_META_TABLE}, one row: the project the request named, the
 *     stamp, when it was built, and the dimension and precision of its
 *     vectors (both null with no embedder).
 *
 * ## The serving build and the swap
 *
 * The project's schema holds the pointer, `hub_index_serving`
 * (`schema.ts`): one row naming the serving build, none before the first
 * rebuild. The rebuild runs in one repeatable-read transaction, so every
 * row table is copied at one point of its history: it makes the build's
 * schema, copies, embeds and indexes, then locks the pointer row `FOR
 * UPDATE`, repoints it at the new build and drops the old build's schema.
 * Nothing of the build is seen before that transaction commits, so no
 * query reads its tables while their indexes are built, and a rebuild
 * that fails anywhere, or whose process dies, leaves the serving build
 * and the pointer as they were and no schema of its own behind.
 *
 * A reader reads the pointer with {@link servingBuild}, which locks the
 * row `FOR SHARE`, and queries the build in the same transaction. The
 * swap's `FOR UPDATE` waits for every reader holding the old pointer, and
 * a reader arriving during the swap waits for its commit and reads the
 * new pointer, so the old build is never dropped under a reader. The
 * transaction must be read-write: Postgres refuses `FOR SHARE` in a
 * read-only one.
 *
 * Two rebuilds of one project, from this hub or another on the same
 * database, run one after the other: each opens its transaction with
 * `LOCK TABLE hub_index_serving IN SHARE ROW EXCLUSIVE MODE`, which
 * conflicts with itself and not with a reader's `FOR SHARE`. A `LOCK`
 * takes no snapshot, so the later rebuild's snapshot is taken once the
 * earlier one has committed, and it reads the earlier one's swap.
 *
 * ## Refusals
 *
 * Refused with `rafa-index`'s `IndexRebuildRefusal` before anything is
 * touched: a `vector`-scoped rebuild with no embedder, naming `fts`, and
 * an embedder dimension the HNSW index cannot take
 * ({@link HNSW_MAX_DIMENSION}). Refused inside the build, so nothing
 * changes: an embedder answering another count of vectors than bodies, or
 * a vector of another length than its dimension, and a row table holding
 * a column named as the build's own.
 *
 * Nothing here is exported from the package's entry: it takes the
 * `Bun.sql` client and the Drizzle database, which the leak rule keeps
 * inside the connector.
 */
import type { ProjectSchema } from './hub-projects.js';
import type { HubDatabase, HubTransaction } from './hub-tables.js';
import type { IndexRebuildRequest, IndexRebuildResult } from '@open-tomato/rafa-hub-port';
import type { IndexEmbedder } from '@open-tomato/rafa-index';

import { randomUUID } from 'node:crypto';

import { IndexRebuildRefusal, NO_EMBEDDER } from '@open-tomato/rafa-index';
import { eq, sql } from 'drizzle-orm';

import { inProjectSchema } from './hub-tables.js';
import { SCHEMA_NAME } from './migrator.js';
import { hubIndexServing, WIRE_TABLES } from './schema.js';

/** How a build stores its vectors: `halfvec` (2-byte floats) under `half`, `vector` under `full`. */
export type EmbeddingPrecision = 'half' | 'full';

/** Every {@link EmbeddingPrecision}. */
export const EMBEDDING_PRECISIONS: readonly EmbeddingPrecision[] = Object.freeze(['half', 'full']);

/** The opening of every build schema's name. */
export const BUILD_SCHEMA_PREFIX = 'index_';

/** The hex digits of a build's random tail. */
export const BUILD_ID_LENGTH = 12;

/** The column each copied table holds its row's body in. */
export const BODY_COLUMN = 'index_body';

/** The column each copied table holds its row's vector in, with an embedder. */
export const EMBEDDING_COLUMN = 'index_embedding';

/** The build's one-row metadata table. */
export const BUILD_META_TABLE = 'index_meta';

/** The link table a build copies when the project's schema holds it. */
export const LINKS_TABLE = 'ref_links';

/** How many bodies one call of the embedder is handed, as `rafa-index`'s rebuild hands them. */
export const EMBED_BATCH = 64;

/** The most dimensions pgvector's HNSW index takes on a column of each precision. */
export const HNSW_MAX_DIMENSION: Readonly<Record<EmbeddingPrecision, number>> = Object.freeze({ half: 4000, full: 2000 });

/** The column type and HNSW operator class of each precision, for a dimension already checked. */
const VECTOR_TYPES: Readonly<Record<EmbeddingPrecision, { readonly type: string; readonly ops: string }>> = Object.freeze({
  half: { type: 'halfvec', ops: 'halfvec_cosine_ops' },
  full: { type: 'vector', ops: 'vector_cosine_ops' },
});

/** pgvector's name in `pg_extension`. */
const VECTOR_EXTENSION = 'vector';

/** The columns a row table must carry to be copied. */
const ORIGIN_COLUMNS: readonly string[] = Object.freeze(['origin_store', 'origin_seq']);

/** The column types a body is read from: Postgres's text types. */
const TEXT_TYPES: readonly string[] = Object.freeze(['text', 'character varying', 'character']);

/** The build a project's searches read: its schema and stamp. */
export interface ServingBuild {
  /** The build's schema, `index_<project>_<build>`. */
  readonly schema: string;
  /** The stamp its rebuild recorded. */
  readonly stamp: string;
}

/** A test's hook inside the rebuild's transaction. */
export interface IndexBuildHooks {
  /** Runs once the build is filled and indexed, before the pointer is locked; a throw rolls the whole build back. */
  readonly beforeSwap?: (schema: string) => void | Promise<void>;
}

/** What one rebuild of a project's index is handed. */
export interface IndexBuildOptions {
  /** The connector's Drizzle database, the rebuild's transaction taken on it. */
  readonly db: HubDatabase;
  /** The project's schema, migrated and recorded by the store. */
  readonly place: ProjectSchema;
  /** The request: the project recorded in the build's metadata, and the scope. */
  readonly request: IndexRebuildRequest;
  /** The clock the stamp and the build time are read from. */
  readonly now: () => Date;
  /** The embedder; without one the build holds no vector and no HNSW index. */
  readonly embedder?: IndexEmbedder;
  /** How the vectors are stored; `half` when left out. */
  readonly precision?: EmbeddingPrecision;
  /** The test hooks. */
  readonly hooks?: IndexBuildHooks;
}

/** What a rebuild that swapped its build in answers: the port's result, and the build's schema for the connector. */
export interface IndexBuild {
  /** The new serving build's schema. */
  readonly schema: string;
  /** The port's answer, frozen. */
  readonly result: IndexRebuildResult;
}

/** An index table with the rows the build counted in it, as the port's result carries it. */
type IndexTableRows = IndexRebuildResult['tables'][number];

/** A column of a row table, as `information_schema.columns` answers it. */
interface ColumnRow extends Record<string, unknown> {
  readonly table_name: string;
  readonly column_name: string;
  readonly data_type: string;
}

/** A row table to copy, with its columns in order and those its body is read from. */
interface CopiedTable {
  readonly table: string;
  readonly columns: readonly string[];
  readonly body: readonly string[];
}

/** What the project's schema holds that a build copies. */
interface Copied {
  readonly tables: readonly CopiedTable[];
  readonly links: boolean;
}

/** The vector half a build makes, or none. */
interface VectorPlan {
  readonly embedder: IndexEmbedder;
  readonly precision: EmbeddingPrecision;
}

/** A name quoted as an SQL identifier. */
function quoted(name: string): string {
  return `"${name.replaceAll('"', '""')}"`;
}

/** The build schema of `project` for `build`, refused when it is no name the connector quotes safely. */
export function buildSchemaName(project: string, build: string): string {
  const name = `${BUILD_SCHEMA_PREFIX}${project.toLowerCase()}_${build}`;
  if (!SCHEMA_NAME.test(name)) {
    throw new TypeError(`hub postgres: project ${project} with build ${build} makes "${name}", which is no schema name (lower case letters, digits and _, at most 63)`);
  }
  return name;
}

/** A build schema read back from the pointer, refused unless it is one a rebuild names. */
function checkedBuild(schema: string): string {
  if (!SCHEMA_NAME.test(schema) || !schema.startsWith(BUILD_SCHEMA_PREFIX)) {
    throw new Error(`hub postgres: the serving build "${schema}" is no build schema name`);
  }
  return schema;
}

/** A rebuild stamp: the clock, compact, then a short random tail so two rebuilds never share one. */
function rebuildStamp(now: () => Date): string {
  const clock = now()
    .toISOString()
    .replace(/[-:.]/g, '');
  return `${clock}-${randomUUID().slice(0, 8)}`;
}

/** The vector half the request asks for, refused before anything is touched; see the module note. */
function vectorPlan(options: IndexBuildOptions): VectorPlan | null {
  const { embedder, precision = 'half', request } = options;
  if (!EMBEDDING_PRECISIONS.includes(precision)) {
    throw new TypeError(`hub postgres: the precision ${String(precision)} is neither half nor full`);
  }
  if (embedder === undefined) {
    if (request.scope === 'vector') {
      throw new IndexRebuildRefusal(`a vector rebuild needs vector search, which is off (${NO_EMBEDDER}); rebuild with scope 'fts'`);
    }
    return null;
  }
  const cap = HNSW_MAX_DIMENSION[precision];
  const { dimension } = embedder;
  if (!Number.isInteger(dimension) || dimension < 1 || dimension > cap) {
    throw new IndexRebuildRefusal(`the embedder's dimension ${String(dimension)} is no whole number from 1 to ${String(cap)}, the most an HNSW index on ${VECTOR_TYPES[precision].type} takes`);
  }
  return { embedder, precision };
}

/** The row tables `schema` holds with the origin pair, in `WIRE_TABLES` order, and whether it holds `ref_links`. */
async function copiedOf(tx: HubTransaction, schema: string): Promise<Copied> {
  // Drizzle's bun-sql result types its rows loosely; they are the three text columns selected.
  const rows = await tx.execute<ColumnRow>(sql`SELECT table_name, column_name, data_type FROM information_schema.columns
    WHERE table_schema = ${schema} ORDER BY table_name, ordinal_position`) as unknown as readonly ColumnRow[];
  const columnsOf = (table: string): readonly ColumnRow[] => rows.filter((row) => row.table_name === table);
  const tables = Object.keys(WIRE_TABLES).flatMap((table): CopiedTable[] => {
    const columns = columnsOf(table);
    const names = columns.map((column) => column.column_name);
    if (!ORIGIN_COLUMNS.every((column) => names.includes(column))) return [];
    const own = names.filter((name) => name === BODY_COLUMN || name === EMBEDDING_COLUMN);
    if (own.length > 0) {
      throw new IndexRebuildRefusal(`the row table ${table} holds ${own.join(', ')}, which the index build names as its own`);
    }
    const body = columns
      .filter((column) => column.column_name !== 'origin_store' && TEXT_TYPES.includes(column.data_type))
      .map((column) => column.column_name);
    return [{ table, columns: names, body }];
  });
  return { tables, links: columnsOf(LINKS_TABLE).length > 0 };
}

/** The rows `table` of `build` holds, and those of them with a vector, read only when `embedded`. */
async function countOf(tx: HubTransaction, build: string, table: string, embedded: boolean): Promise<{ readonly rows: number; readonly vectors: number }> {
  const vectors = embedded
    ? `count(${quoted(EMBEDDING_COLUMN)})`
    : '0';
  const [counted] = await tx.execute<{ rows: number; vectors: number }>(sql.raw(`SELECT count(*)::int AS rows, ${vectors}::int AS vectors FROM ${quoted(build)}.${quoted(table)}`));
  return { rows: Number(counted?.rows ?? 0), vectors: Number(counted?.vectors ?? 0) };
}

/** Copies one row table into the build, its body beside it, and makes its BM25 index. */
async function copyTable(tx: HubTransaction, from: string, build: string, table: CopiedTable): Promise<void> {
  const target = `${quoted(build)}.${quoted(table.table)}`;
  const body = ['E\'\\n\'', ...table.body.map(quoted)].join(', ');
  await tx.execute(sql.raw(`CREATE TABLE ${target} AS SELECT ${table.columns.map(quoted).join(', ')}, concat_ws(${body}) AS ${quoted(BODY_COLUMN)}
    FROM ${quoted(from)}.${quoted(table.table)}
    WHERE origin_store IS NOT NULL AND origin_seq IS NOT NULL ORDER BY origin_store, origin_seq`));
  await tx.execute(sql.raw(`CREATE INDEX ${quoted(`${table.table}_bm25`)} ON ${target} USING bm25 (seq, ${quoted(BODY_COLUMN)}) WITH (key_field = 'seq')`));
}

/** Refuses an embedder's answer for a batch that is not one vector of its dimension per text. */
function checkVectors(vectors: readonly Float32Array[], texts: number, dimension: number): void {
  if (vectors.length !== texts) {
    throw new IndexRebuildRefusal(`the embedder answered ${String(vectors.length)} vectors for ${String(texts)} texts`);
  }
  const wrong = vectors.find((vector) => vector.length !== dimension);
  if (wrong !== undefined) {
    throw new IndexRebuildRefusal(`the embedder answered a vector of ${String(wrong.length)} numbers, its dimension being ${String(dimension)}`);
  }
}

/**
 * The schema pgvector's types and operator classes live in, read from
 * `pg_extension`: the rebuild's `search_path` is the project's schema
 * alone, so each is named under it.
 */
async function vectorSchemaOf(tx: HubTransaction): Promise<string> {
  const [found] = await tx.execute<{ schema: string }>(sql`SELECT n.nspname AS schema FROM pg_extension e
    JOIN pg_namespace n ON n.oid = e.extnamespace WHERE e.extname = ${VECTOR_EXTENSION}`);
  if (found === undefined) {
    throw new IndexRebuildRefusal(`the database holds no ${VECTOR_EXTENSION} extension, which a build with an embedder needs`);
  }
  return String(found.schema);
}

/** Embeds every body of one copied table, {@link EMBED_BATCH} at a time, and makes its HNSW index. */
async function embedTable(tx: HubTransaction, build: string, table: string, plan: VectorPlan, vectorSchema: string): Promise<void> {
  const { embedder, precision } = plan;
  const { type, ops } = VECTOR_TYPES[precision];
  const target = `${quoted(build)}.${quoted(table)}`;
  const column = `${quoted(vectorSchema)}.${type}(${String(embedder.dimension)})`;
  await tx.execute(sql.raw(`ALTER TABLE ${target} ADD COLUMN ${quoted(EMBEDDING_COLUMN)} ${column}`));
  const rows = await tx.execute<{ seq: number | string; body: string }>(sql.raw(`SELECT seq, ${quoted(BODY_COLUMN)} AS body FROM ${target} ORDER BY seq`));
  for (let start = 0; start < rows.length; start += EMBED_BATCH) {
    const batch = rows.slice(start, start + EMBED_BATCH);
    const vectors = await embedder.embed(batch.map((row) => row.body));
    checkVectors(vectors, batch.length, embedder.dimension);
    const pairs = JSON.stringify(batch.map((row, at) => ({ seq: Number(row.seq), e: `[${Array.from(vectors[at] ?? []).join(',')}]` })));
    await tx.execute(sql`UPDATE ${sql.raw(target)} AS copied SET ${sql.raw(quoted(EMBEDDING_COLUMN))} = given.e::${sql.raw(column)}
      FROM jsonb_to_recordset(CAST(${pairs} AS text)::jsonb) AS given(seq bigint, e text) WHERE copied.seq = given.seq`);
  }
  await tx.execute(sql.raw(`CREATE INDEX ${quoted(`${table}_hnsw`)} ON ${target} USING hnsw (${quoted(EMBEDDING_COLUMN)} ${quoted(vectorSchema)}.${ops})`));
}

/** Makes the build's metadata table and writes its one row. */
async function writeMeta(tx: HubTransaction, build: string, request: IndexRebuildRequest, stamp: string, at: string, plan: VectorPlan | null): Promise<void> {
  const target = `${quoted(build)}.${quoted(BUILD_META_TABLE)}`;
  await tx.execute(sql.raw(`CREATE TABLE ${target} (
    id integer PRIMARY KEY CHECK (id = 1),
    project text NOT NULL,
    stamp text NOT NULL,
    built_at text NOT NULL,
    dimension integer,
    precision text
  )`));
  await tx.execute(sql`INSERT INTO ${sql.raw(target)} (id, project, stamp, built_at, dimension, precision)
    VALUES (1, ${request.project}, ${stamp}, ${at}, ${plan?.embedder.dimension ?? null}, ${plan?.precision ?? null})`);
}

/** Repoints the project at `build` under the pointer's row lock and drops the build it served before. */
async function swapTo(tx: HubTransaction, build: string, stamp: string, at: string): Promise<void> {
  const [old] = await tx
    .select({ schema: hubIndexServing.buildSchema })
    .from(hubIndexServing)
    .where(eq(hubIndexServing.id, 1))
    .for('update');
  await tx
    .insert(hubIndexServing)
    .values({ id: 1, buildSchema: build, stamp, builtAt: at })
    .onConflictDoUpdate({ target: hubIndexServing.id, set: { buildSchema: build, stamp, builtAt: at } });
  if (old !== undefined && old.schema !== build) {
    await tx.execute(sql.raw(`DROP SCHEMA IF EXISTS ${quoted(checkedBuild(old.schema))} CASCADE`));
  }
}

/**
 * The build the project's searches read, `null` before its first
 * rebuild, its pointer row locked `FOR SHARE` until `tx` ends so no swap
 * drops it under the caller. `tx` runs in the project's schema
 * (`inProjectSchema`) and must be read-write; see the module note.
 */
export async function servingBuild(tx: HubTransaction): Promise<ServingBuild | null> {
  const [row] = await tx
    .select({ schema: hubIndexServing.buildSchema, stamp: hubIndexServing.stamp })
    .from(hubIndexServing)
    .where(eq(hubIndexServing.id, 1))
    .for('share');
  return row === undefined
    ? null
    : Object.freeze({ schema: checkedBuild(row.schema), stamp: row.stamp });
}

/** Fills, indexes and swaps in one build, inside the rebuild's transaction; answers the port's result. */
async function buildAndSwap(tx: HubTransaction, options: IndexBuildOptions, build: string, plan: VectorPlan | null): Promise<IndexRebuildResult> {
  const { hooks = {}, now, place, request } = options;
  await tx.execute(sql`LOCK TABLE ${hubIndexServing} IN SHARE ROW EXCLUSIVE MODE`);
  const stamp = rebuildStamp(now);
  const at = now().toISOString();
  const copied = await copiedOf(tx, place.schema);
  const vectorSchema = plan === null
    ? null
    : await vectorSchemaOf(tx);
  await tx.execute(sql.raw(`CREATE SCHEMA ${quoted(build)}`));
  const tables: IndexTableRows[] = [];
  let rows = 0;
  let vectors = 0;
  for (const table of copied.tables) {
    await copyTable(tx, place.schema, build, table);
    if (plan !== null && vectorSchema !== null) await embedTable(tx, build, table.table, plan, vectorSchema);
    const counted = await countOf(tx, build, table.table, plan !== null);
    if (plan !== null && counted.vectors !== counted.rows) {
      throw new IndexRebuildRefusal(`the build's ${table.table} holds ${String(counted.vectors)} vectors for ${String(counted.rows)} rows`);
    }
    rows += counted.rows;
    vectors += counted.vectors;
    tables.push(Object.freeze({ table: table.table, rows: counted.rows }));
  }
  if (copied.links) {
    await tx.execute(sql.raw(`CREATE TABLE ${quoted(build)}.${quoted(LINKS_TABLE)} AS SELECT * FROM ${quoted(place.schema)}.${quoted(LINKS_TABLE)}`));
    tables.push(Object.freeze({ table: LINKS_TABLE, rows: (await countOf(tx, build, LINKS_TABLE, false)).rows }));
  }
  await writeMeta(tx, build, request, stamp, at, plan);
  tables.push(Object.freeze({ table: BUILD_META_TABLE, rows: 1 }));
  await hooks.beforeSwap?.(build);
  await swapTo(tx, build, stamp, at);
  return Object.freeze({
    project: request.project,
    stamp,
    rows,
    vectors,
    tables: Object.freeze(tables),
    vector: plan !== null,
    why: plan === null
      ? NO_EMBEDDER
      : null,
  });
}

/**
 * Rebuilds the project's index as a new build schema and swaps it in,
 * in one transaction that waits for any other rebuild of the project;
 * see the module note. Rejects with nothing changed on a refusal or any
 * failure.
 */
export async function rebuildProjectIndex(options: IndexBuildOptions): Promise<IndexBuild> {
  const { db, place } = options;
  const plan = vectorPlan(options);
  const tail = randomUUID()
    .replaceAll('-', '')
    .slice(0, BUILD_ID_LENGTH);
  const build = buildSchemaName(place.id, tail);
  const result = await inProjectSchema(db, place.schema, (tx) => buildAndSwap(tx, options, build, plan), { isolationLevel: 'repeatable read' });
  return Object.freeze({ schema: build, result });
}
