/**
 * Engine 3, the mid tier: Postgres with `pg_search` for BM25 and
 * `pgvector` for the vectors, fused by reciprocal rank in SQL.
 *
 * Usage: bun engine-postgres.ts <extract.jsonl> [--out=<json>] [--queries=200]
 *                               [--terms=5] [--url=<postgres url>]
 *                               [--no-vector-index] [--no-collapse]
 *
 * The same extract, the same deterministic pseudo-embeddings and the same
 * 200 sampled queries as the two SQLite-side engines, so the figures sit
 * beside theirs. Unlike those, every query here is a loopback round trip,
 * which is part of what the mid tier costs and is named in the report.
 *
 * `pg_search` wants its key field first in the index, and `pgvector`'s
 * HNSW index is built after the rows land, both of which the rebuild
 * below times separately.
 */
import { SQL } from 'bun';

import { DIMS, embed } from './embed.js';
import {
  type ExtractRow,
  collapseDuplicates,
  hubness,
  percentiles,
  readExtract,
  sampleQueries,
  timed,
} from './common.js';

const RRF_K = 60;
const TOP_K = 10;
const INSERT_BATCH = 400;
const MAINTENANCE_WORK_MEM = '1GB';

/** The columns one row contributes to an insert, in placeholder order. */
const COLUMNS = ['rowid', 'id', 'tbl', 'kind', 'derived', 'ts', 'text', 'embedding'] as const;

/** What one rebuild cost, split by the piece that cost it. */
interface RebuildCost {
  totalMs: number;
  insertMs: number;
  bm25Ms: number;
  hnswMs: number | null;
}

/** The byte sizes Postgres reports for one table and its two indexes. */
interface IndexSizes {
  table: number;
  bm25: number;
  hnsw: number;
  total: number;
}

/** A vector as the text literal pgvector parses. */
function vectorLiteral(vector: Float32Array): string {
  return `[${Array.from(vector).join(',')}]`;
}

/** The placeholder tuple list of one insert batch, 1-based across the batch. */
function placeholders(count: number): string {
  const tuples: string[] = [];
  for (let row = 0; row < count; row++) {
    const base = row * COLUMNS.length;
    const slots = COLUMNS.map((_, column) => `$${base + column + 1}`);
    slots[COLUMNS.length - 1] = `${slots[COLUMNS.length - 1]}::vector`;
    tuples.push(`(${slots.join(', ')})`);
  }
  return tuples.join(', ');
}

/** Drops and rebuilds one table, its BM25 index and, when asked, its HNSW index. */
async function rebuild(
  sql: SQL,
  table: string,
  rows: readonly ExtractRow[],
  withVectorIndex: boolean,
): Promise<RebuildCost> {
  await sql.unsafe(`drop table if exists ${table} cascade`);
  await sql.unsafe(`create table ${table} (
      rowid bigint primary key,
      id text not null unique,
      tbl text not null,
      kind text,
      derived text not null,
      ts text not null,
      text text not null,
      embedding vector(${DIMS}) not null
    )`);

  const insert = await timed(async () => {
    for (let start = 0; start < rows.length; start += INSERT_BATCH) {
      const batch = rows.slice(start, start + INSERT_BATCH);
      const params: unknown[] = [];
      batch.forEach((row, index) => {
        params.push(
          start + index + 1,
          row.id,
          row.table,
          row.kind,
          row.derived,
          row.ts,
          row.text,
          vectorLiteral(embed(row.text)),
        );
      });
      await sql.unsafe(
        `insert into ${table} (${COLUMNS.join(', ')}) values ${placeholders(batch.length)}`,
        params,
      );
    }
  });

  const bm25 = await timed(() =>
    sql.unsafe(
      `create index ${table}_bm25 on ${table}
         using bm25 (rowid, text) with (key_field = 'rowid')`,
    ),
  );

  let hnswMs: number | null = null;
  if (withVectorIndex) {
    const hnsw = await timed(() =>
      sql.unsafe(`create index ${table}_hnsw on ${table} using hnsw (embedding vector_cosine_ops)`),
    );
    hnswMs = hnsw.ms;
  }

  return { totalMs: insert.ms + bm25.ms + (hnswMs ?? 0), insertMs: insert.ms, bm25Ms: bm25.ms, hnswMs };
}

/** The sizes Postgres reports once the table has been analysed. */
async function sizes(sql: SQL, table: string, withVectorIndex: boolean): Promise<IndexSizes> {
  await sql.unsafe(`analyze ${table}`);
  const rows = (await sql.unsafe(
    `select pg_relation_size($1) as tbl,
            pg_relation_size($2) as bm25,
            case when $4 then pg_relation_size($3) else 0 end as hnsw,
            pg_total_relation_size($1) as total`,
    [table, `${table}_bm25`, `${table}_hnsw`, withVectorIndex],
  )) as Array<{ tbl: string; bm25: string; hnsw: string; total: string }>;
  const row = rows[0]!;
  return {
    table: Number(row.tbl),
    bm25: Number(row.bm25),
    hnsw: Number(row.hnsw),
    total: Number(row.total),
  };
}

/** A term bag as `pg_search`'s parser reads an OR of terms. */
function searchQuery(text: string): string {
  return text
    .split(/\s+/)
    .map((term) => term.replace(/[^\p{L}\p{N}]/gu, ''))
    .filter((term) => term.length > 0)
    .join(' OR ');
}

/** The three query shapes, each returning top-k ids for one query. */
interface Queries {
  fts: (match: string) => Promise<string[]>;
  knn: (vector: string) => Promise<string[]>;
  hybrid: (match: string, vector: string) => Promise<string[]>;
}

/** Binds the three query shapes to one table. */
function queriesFor(sql: SQL, table: string): Queries {
  const ids = (rows: unknown): string[] => (rows as Array<{ id: string }>).map((row) => row.id);
  return {
    fts: async (match) =>
      ids(
        await sql.unsafe(
          `select id from ${table} where text @@@ $1
             order by paradedb.score(rowid) desc limit ${TOP_K}`,
          [match],
        ),
      ),
    knn: async (vector) =>
      ids(
        await sql.unsafe(
          `select id from ${table} order by embedding <=> $1::vector limit ${TOP_K}`,
          [vector],
        ),
      ),
    hybrid: async (match, vector) =>
      ids(
        await sql.unsafe(
          `with fts_matches as (
               select rowid, row_number() over () as rank from (
                 select rowid from ${table} where text @@@ $1
                   order by paradedb.score(rowid) desc limit ${TOP_K * 4}
               ) ranked
             ), vec_matches as (
               select rowid, row_number() over () as rank from (
                 select rowid from ${table} order by embedding <=> $2::vector limit ${TOP_K * 4}
               ) ranked
             ), fused as (
               select rowid, sum(score) as score from (
                 select rowid, 1.0 / (${RRF_K} + rank) as score from fts_matches
                 union all
                 select rowid, 1.0 / (${RRF_K} + rank) as score from vec_matches
               ) both_lists group by rowid
             )
             select r.id as id from fused join ${table} r on r.rowid = fused.rowid
               order by fused.score desc limit ${TOP_K}`,
          [match, vector],
        ),
      ),
  };
}

const argv = process.argv.slice(2);
const flags = argv.filter((a) => a.startsWith('--'));
const positional = argv.filter((a) => !a.startsWith('--'));
const flagValue = (name: string): string | undefined => {
  const hit = flags.find((f) => f.startsWith(`--${name}=`));
  return hit?.slice(name.length + 3);
};

const extractPath = positional[0];
if (extractPath === undefined) {
  console.error(
    'usage: bun engine-postgres.ts <extract.jsonl> [--out=<json>] [--queries=<n>] [--terms=<n>] [--url=<postgres url>] [--no-vector-index] [--no-collapse]',
  );
  process.exit(2);
}

const url = flagValue('url') ?? process.env.PGURL ?? 'postgres://postgres:spike@127.0.0.1:55432/spike';
const queryCount = Number(flagValue('queries') ?? 200);
const terms = Number(flagValue('terms') ?? 5);
const outPath = flagValue('out');
const withVectorIndex = !flags.includes('--no-vector-index');

const sql = new SQL(url, { max: 1 });
await sql.unsafe(`set maintenance_work_mem = '${MAINTENANCE_WORK_MEM}'`);
const versions = (await sql.unsafe(
  `select current_setting('server_version') as pg,
          (select extversion from pg_extension where extname = 'pg_search') as pg_search,
          (select extversion from pg_extension where extname = 'vector') as vector`,
)) as Array<{ pg: string; pg_search: string; vector: string }>;

const rows = await readExtract(extractPath);
const built = await rebuild(sql, 'records', rows, withVectorIndex);
const reportedSizes = await sizes(sql, 'records', withVectorIndex);
const query = queriesFor(sql, 'records');

const queries = sampleQueries(rows, queryCount, 11, terms);
const ftsMs: number[] = [];
const knnMs: number[] = [];
const hybridMs: number[] = [];
const hybridLists: string[][] = [];

for (const sample of queries) {
  const match = searchQuery(sample.text);
  const vector = vectorLiteral(sample.vector);
  const fts = await timed(() => query.fts(match));
  ftsMs.push(fts.ms);
  const knn = await timed(() => query.knn(vector));
  knnMs.push(knn.ms);
  const hybrid = await timed(() => query.hybrid(match, vector));
  hybridMs.push(hybrid.ms);
  hybridLists.push(hybrid.value);
}

const report: Record<string, unknown> = {
  engine: 'postgres-pg_search+pgvector',
  bun: Bun.version,
  platform: `${process.platform}-${process.arch}`,
  versions: versions[0],
  settings: { maintenance_work_mem: MAINTENANCE_WORK_MEM, insertBatch: INSERT_BATCH },
  dims: DIMS,
  embeddings: 'deterministic hashed bag of words, 384 dims, no model call',
  queryNote: 'every query is a loopback round trip, unlike the in-process SQLite engines',
  vectorIndex: withVectorIndex ? 'hnsw (vector_cosine_ops)' : 'none: --no-vector-index, so KNN is a sequential scan',
  rows: rows.length,
  queryTerms: terms,
  rebuild: built,
  sizeBytes: reportedSizes,
  query: {
    samples: queries.length,
    fts: percentiles(ftsMs),
    knn: percentiles(knnMs),
    hybrid: percentiles(hybridMs),
  },
};

if (!flags.includes('--no-collapse')) {
  const collapsed = collapseDuplicates(rows);
  await rebuild(sql, 'records_collapsed', collapsed.rows, withVectorIndex);
  const collapsedQuery = queriesFor(sql, 'records_collapsed');
  const collapsedLists: string[][] = [];
  for (const sample of queries.slice(0, 100)) {
    collapsedLists.push(await collapsedQuery.hybrid(searchQuery(sample.text), vectorLiteral(sample.vector)));
  }
  report.hubness = {
    before: hubness(hybridLists.slice(0, 100)),
    afterCollapse: hubness(collapsedLists),
    collapsedRows: collapsed.rows.length,
    droppedDuplicates: rows.length - collapsed.rows.length,
  };
}

await sql.end();
console.log(JSON.stringify(report, null, 2));
if (outPath) await Bun.write(outPath, JSON.stringify(report, null, 2) + '\n');
