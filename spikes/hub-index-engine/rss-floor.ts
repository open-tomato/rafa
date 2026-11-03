/**
 * The absolute memory a SQLite client holds: a bare Bun process, then one
 * that has opened a replica and answered hybrid queries.
 *
 * Usage: bun rss-floor.ts <built .db from engine-sqlite.ts> [--dims=384]
 *
 * Unlike `rss-sqlite.ts` it loads no extract, so the figures are what a
 * small device would see. Its queries are the first five tokens of rows
 * read back from the database itself.
 */
import { Database } from 'bun:sqlite';

import { DIMS, createEmbedder, tokensOf } from './embed.js';

const TOP_K = 10;
const RRF_K = 60;
const QUERY_COUNT = 50;

const args = process.argv.slice(2);
const dbPath = args.find((a) => !a.startsWith('--'));
const dimsFlag = args.find((a) => a.startsWith('--dims='));
if (dbPath === undefined) {
  console.error('usage: bun rss-floor.ts <built .db> [--dims=<n>]');
  process.exit(2);
}

const mb = (bytes: number): number => Math.round((bytes / 1048576) * 10) / 10;
const rss = (): number => mb(process.memoryUsage().rss);
const bare = rss();

const embedder = createEmbedder(Number(dimsFlag?.slice('--dims='.length) ?? DIMS));
const vec = (await import('sqlite-vec')) as { getLoadablePath: () => string };
const db = new Database(dbPath, { readonly: true });
db.loadExtension(vec.getLoadablePath());
const rowCount = db.query<{ n: number }, []>('select count(*) as n from records').get()?.n ?? 0;
const opened = rss();

const texts = db
  .query<{ text: string }, [number]>('select text from records order by random() limit ?1')
  .all(QUERY_COUNT)
  .map((row) => [...new Set(tokensOf(row.text))].filter((t) => t.length > 2).slice(0, 5).join(' '))
  .filter((text) => text.length > 0);

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

let peak = opened;
const times: number[] = [];
for (const text of texts) {
  const match = text
    .split(/\s+/)
    .map((t) => `"${t}"`)
    .join(' OR ');
  const blob = new Uint8Array(embedder.embed(text).buffer.slice(0));
  const start = performance.now();
  hybrid.all(match, blob);
  times.push(performance.now() - start);
  peak = Math.max(peak, rss());
}
times.sort((a, b) => a - b);

console.log(
  JSON.stringify({
    rows: rowCount,
    dims: embedder.dims,
    bareBunMb: bare,
    afterOpenMb: opened,
    peakAfterQueriesMb: peak,
    hybridP50Ms: Math.round(times[Math.floor(times.length / 2)]! * 10) / 10,
  }),
);
