/**
 * What the SQLite engine alone holds in memory while it answers queries.
 *
 * Usage: bun rss-sqlite.ts <extract.jsonl> <built .db from engine-sqlite.ts> [--dims=384]
 *
 * `engine-sqlite.ts` reports its own process's memory, which includes the
 * whole extract and a second database built for the collapse count, so it
 * says nothing about the engine. This opens a database that run already
 * built, in a process that loaded only what it needs to sample queries,
 * and reports the memory the queries add on top of that baseline.
 */
import { Database } from 'bun:sqlite';

import { DIMS, createEmbedder } from './embed.js';
import { percentiles, readExtract, sampleQueries, timed } from './common.js';

const TOP_K = 10;
const RRF_K = 60;

const args = process.argv.slice(2);
const positional = args.filter((a) => !a.startsWith('--'));
const dimsFlag = args.find((a) => a.startsWith('--dims='));
const [extractPath, dbPath] = positional;
if (extractPath === undefined || dbPath === undefined) {
  console.error('usage: bun rss-sqlite.ts <extract.jsonl> <built .db> [--dims=<n>]');
  process.exit(2);
}

const embedder = createEmbedder(Number(dimsFlag?.slice('--dims='.length) ?? DIMS));
const mb = (bytes: number): number => Math.round(bytes / 1048576);

const rows = await readExtract(extractPath);
const queries = sampleQueries(rows, 200, 11, 5, embedder.embed);
rows.length = 0;
Bun.gc(true);
const baseline = process.memoryUsage().rss;

const vec = (await import('sqlite-vec')) as { getLoadablePath: () => string };
const db = new Database(dbPath, { readonly: true });
db.loadExtension(vec.getLoadablePath());

const hybrid = db.prepare<{ id: string }, [string, Uint8Array]>(
  `with fts_matches as (
       select rowid, row_number() over (order by bm25(records_fts)) as rank
         from records_fts where records_fts match ?1 limit ${TOP_K * 4}
     ), vec_matches as (
       select rowid, row_number() over (order by distance) as rank
         from records_vec where embedding match ?2 and k = ${TOP_K * 4}
     ), fused as (
       select rowid, sum(score) as score from (
         select rowid, 1.0 / (${RRF_K} + rank) as score from fts_matches
         union all
         select rowid, 1.0 / (${RRF_K} + rank) as score from vec_matches
       ) group by rowid
     )
     select r.id as id from fused join records r on r.rowid = fused.rowid
       order by fused.score desc limit ${TOP_K}`,
);

const samples: number[] = [];
let peak = 0;
for (const query of queries) {
  const match = query.text
    .split(/\s+/)
    .filter((t) => t.length > 0)
    .map((t) => `"${t.replace(/"/g, '')}"`)
    .join(' OR ');
  const blob = new Uint8Array(query.vector.buffer.slice(0));
  const run = await timed(() => hybrid.all(match, blob));
  samples.push(run.ms);
  peak = Math.max(peak, process.memoryUsage().rss);
}

console.log(
  JSON.stringify({
    dims: embedder.dims,
    baselineRssMb: mb(baseline),
    peakRssMb: mb(peak),
    addedByEngineMb: mb(peak - baseline),
    hybrid: percentiles(samples),
  }),
);
