# Spike: hub index engine

Branch-only spike behind `.rafa/specs/draft-hub-index-engine-spike.md`. It
measures three index engines over an anonymised extract of a real effort
store: SQLite FTS5 plus sqlite-vec inside `bun:sqlite`, LanceDB, and
Postgres with `pg_search` and `pgvector`. The first two are the low tier,
a standalone project or a one-person local hub; the third is the mid tier,
what a small organisation runs. Nothing here is merged to `integration`.

## The commands

```sh
bun install

# 1. the extract, from a `rafa effort copy` (never the live store)
bun extract.ts <copy>/effort.sqlite <out dir> --seed=7

# 2. the Linux extension answer alone, no data needed
bun engine-sqlite.ts probe [--custom-sqlite=<libsqlite3 path>]

# 3. engine 1, per extract size
bun engine-sqlite.ts <out dir>/extract-20k.jsonl --queries=200 \
  --out=sqlite-20k.json [--custom-sqlite=<libsqlite3 path>]

# 4. engine 2, per extract size
bun engine-lance.ts <out dir>/extract-20k.jsonl --queries=200 --out=lance-20k.json

# 5. engine 3, the mid tier, against a Postgres carrying both extensions
docker run -d --name spike-pg -e POSTGRES_PASSWORD=spike -e POSTGRES_DB=spike \
  -p 127.0.0.1:55432:5432 --shm-size=1g -v spike-pg-data:/var/lib/postgresql \
  paradedb/paradedb:latest
docker exec spike-pg psql -U postgres -d spike \
  -c 'create extension if not exists pg_search' \
  -c 'create extension if not exists vector'
bun engine-postgres.ts <out dir>/extract-20k.jsonl --queries=200 --out=pg-20k.json
```

The mount point is `/var/lib/postgresql`, not `/var/lib/postgresql/data`:
the Postgres 18 image refuses the older path and exits during init.

All three engine commands take `--queries=<n>` (how many sampled queries, 200 by
default) and `--terms=<n>` (how many tokens each query carries, 5 by default).
A one-term run is how the record separates the cost of ranking a wide `OR`
match set from the cost of the index itself. `engine-lance.ts` also takes
`--no-vector-index`, which skips the `ivfPq` build it would otherwise do at and
above 50,000 rows, for a comparison against an engine that has no vector index
at all. `engine-postgres.ts` takes the same `--no-vector-index`, which skips the
HNSW build, plus `--url=<postgres url>` (or `PGURL`) and `--no-collapse`.

## What each file is

| File | What it does |
|---|---|
| `extract.ts` | Reads findings, task_reports and sessions from a store copy, replaces every alphanumeric run by an equal-length keyed hash under a random key that is never written, keeps timestamps and the closed vocabularies, and grows the rows to 20k and 100k by copying and splicing. |
| `embed.ts` | Deterministic pseudo-embeddings: 384 dimensions, a hashed bag of words, no model call. Both engines index the same numbers. |
| `common.ts` | The extract reader, timing and percentile helpers, the query sampler, the hubness count and the duplicate collapse. |
| `engine-sqlite.ts` | Engine 1. Probes extension loading in two child processes (plain, then under `setCustomSQLite`), then measures the FTS5 rebuild, the vec0 insert, and FTS-only, KNN and reciprocal-rank-fusion queries. |
| `engine-lance.ts` | Engine 2. Builds a LanceDB table with its FTS index (and `ivfPq` at and above 50k rows), then measures FTS-only, KNN and hybrid search through the first-party RRF reranker. |
| `engine-postgres.ts` | Engine 3, the mid tier. Loads the rows over the wire with `Bun.sql`, builds a `pg_search` BM25 index and a `pgvector` HNSW index, then measures the same three query shapes with the fusion written as a CTE. |

## Reading the numbers

The embeddings are hashed bags of words, so every figure is an index
cost, never a retrieval-quality score. `extract.ts` keeps text lengths,
token counts and term frequencies and loses the content, which is what
the costs depend on.

Engine 3's query figures each include a loopback round trip, which the two
in-process engines do not pay, and its load figure is what a client pays to
ship rows over the wire rather than what Postgres pays to store them.
