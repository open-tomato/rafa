/**
 * Engine 1: SQLite FTS5 plus sqlite-vec inside `bun:sqlite`, with
 * reciprocal-rank fusion in SQL.
 *
 * Usage: bun engine-sqlite.ts <extract.jsonl> [--out=<json>] [--queries=200]
 *                             [--custom-sqlite=<libsqlite3 path>] [--probe-only]
 *
 * The first thing it reports is whether this Bun loads the sqlite-vec
 * extension at all: `loadExtension` is tried on a plain `bun:sqlite`
 * database, and again after `Database.setCustomSQLite`, with the exact
 * error of each attempt kept. The two attempts run in child processes of
 * their own (`--mode=plain`, `--mode=custom`), because opening any
 * database loads SQLite and `setCustomSQLite` is refused from then on.
 * Without vectors it still measures the FTS5 half and marks the vector
 * and hybrid cells unmeasured.
 *
 * Vectors are the deterministic pseudo-embeddings of `embed.ts`: 384
 * dimensions from a hashed bag of words, no model call.
 */
import { Database } from 'bun:sqlite';
import { statSync, unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { DIMS, createEmbedder } from './embed.js';
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

/** True once `setCustomSQLite` ran in this process; it is refused a second time. */
let customSqliteSet = false;
const TOP_K = 10;

/** What one extension-loading attempt answered. */
interface LoadAttempt {
  how: string;
  ok: boolean;
  detail: string;
}

/** Path of the platform's sqlite-vec loadable, from the npm package. */
async function vecPath(): Promise<string> {
  const mod = (await import('sqlite-vec')) as { getLoadablePath: () => string };
  return mod.getLoadablePath();
}

/** One probe mode: the default bun:sqlite, or one under a custom libsqlite3. */
type ProbeMode = 'plain' | 'custom';

/** Tries to load sqlite-vec in this process, in one mode only. */
async function probeOne(mode: ProbeMode, customSqlite: string | undefined): Promise<LoadAttempt> {
  const loadable = await vecPath();
  if (mode === 'custom') {
    if (customSqlite === undefined) {
      return { how: 'Database.setCustomSQLite(<path>)', ok: false, detail: 'not tried: no --custom-sqlite path given' };
    }
    try {
      Database.setCustomSQLite(customSqlite);
    } catch (error) {
      return {
        how: `Database.setCustomSQLite(${customSqlite})`,
        ok: false,
        detail: error instanceof Error ? error.message : String(error),
      };
    }
  }
  const how =
    mode === 'plain'
      ? 'db.loadExtension(getLoadablePath()) on the default bun:sqlite'
      : `Database.setCustomSQLite(${customSqlite ?? '?'}) then db.loadExtension(getLoadablePath())`;
  const db = new Database(':memory:');
  try {
    db.loadExtension(loadable);
    const version = db.query<{ v: string }, []>('select vec_version() as v').get()?.v ?? '?';
    const build = buildFacts(db);
    db.close();
    return { how, ok: true, detail: `vec_version ${version}; ${build.sqlite_version}; ${build.compile_options}` };
  } catch (error) {
    const build = buildFacts(db);
    db.close();
    return {
      how,
      ok: false,
      detail: `${error instanceof Error ? error.message : String(error)} (sqlite ${build.sqlite_version}; ${build.compile_options})`,
    };
  }
}

/** Runs both probe modes, each in a child process of its own. */
async function probeBothModes(customSqlite: string | undefined): Promise<LoadAttempt[]> {
  const attempts: LoadAttempt[] = [];
  for (const mode of ['plain', 'custom'] as const) {
    const args = [process.execPath, import.meta.path, 'probe', `--mode=${mode}`];
    if (customSqlite !== undefined) args.push(`--custom-sqlite=${customSqlite}`);
    const child = Bun.spawnSync(args, { stdout: 'pipe', stderr: 'pipe' });
    const out = child.stdout.toString().trim();
    try {
      attempts.push(JSON.parse(out) as LoadAttempt);
    } catch {
      attempts.push({
        how: `child process --mode=${mode}`,
        ok: false,
        detail: `child exited ${child.exitCode}: ${(out + ' ' + child.stderr.toString()).trim().slice(0, 400)}`,
      });
    }
  }
  return attempts;
}

/** The sqlite3 build the open database reports. */
function buildFacts(db: Database): Record<string, string> {
  const version = db.query<{ v: string }, []>('select sqlite_version() as v').get()?.v ?? '?';
  const options = db
    .query<{ o: string }, []>('select * from pragma_compile_options()')
    .all()
    .map((row) => Object.values(row)[0] as string)
    .filter((o) => /FTS5|LOAD_EXTENSION|THREADSAFE/.test(o));
  return { sqlite_version: version, compile_options: options.join(', ') };
}

/** Builds the base table, the FTS5 index and, when vectors load, the vec0 table. */
async function rebuild(
  path: string,
  rows: readonly ExtractRow[],
  withVectors: boolean,
  customSqlite: string | undefined,
): Promise<{ db: Database; rebuildMs: number; ftsMs: number; vecMs: number | null; vectors: Float32Array[] }> {
  try {
    unlinkSync(path);
    unlinkSync(`${path}-wal`);
    unlinkSync(`${path}-shm`);
  } catch {
    // nothing to remove
  }
  if (withVectors && customSqlite !== undefined && !customSqliteSet) {
    Database.setCustomSQLite(customSqlite);
    customSqliteSet = true;
  }
  const db = new Database(path, { create: true });
  if (withVectors) db.loadExtension(await vecPath());
  db.exec('pragma journal_mode = wal; pragma synchronous = off;');
  db.exec(`create table records (
      rowid integer primary key,
      id text not null unique,
      tbl text not null,
      kind text,
      derived text not null,
      ts text not null,
      text text not null
    );`);

  const vectors = rows.map((row) => embedder.embed(row.text));

  const insert = db.prepare('insert into records (rowid, id, tbl, kind, derived, ts, text) values (?, ?, ?, ?, ?, ?, ?)');
  const insertAll = db.transaction((batch: readonly ExtractRow[]) => {
    batch.forEach((row, index) => {
      insert.run(index + 1, row.id, row.table, row.kind, row.derived, row.ts, row.text);
    });
  });
  const base = await timed(() => insertAll(rows));

  const fts = await timed(() => {
    db.exec("create virtual table records_fts using fts5(text, content='records', content_rowid='rowid', tokenize='porter unicode61');");
    db.exec("insert into records_fts(records_fts) values('rebuild');");
  });

  let vecMs: number | null = null;
  if (withVectors) {
    const vec = await timed(() => {
      db.exec(`create virtual table records_vec using vec0(rowid integer primary key, embedding float[${embedder.dims}]);`);
      const insertVec = db.prepare('insert into records_vec (rowid, embedding) values (?, ?)');
      const insertVectors = db.transaction(() => {
        vectors.forEach((vector, index) => {
          insertVec.run(index + 1, new Uint8Array(vector.buffer.slice(0)));
        });
      });
      insertVectors();
    });
    vecMs = vec.ms;
  }

  return { db, rebuildMs: base.ms + fts.ms + (vecMs ?? 0), ftsMs: fts.ms, vecMs, vectors };
}

/** Quotes a query for FTS5 MATCH as a bag of terms. */
function ftsQuery(text: string): string {
  return text
    .split(/\s+/)
    .filter((term) => term.length > 0)
    .map((term) => `"${term.replace(/"/g, '')}"`)
    .join(' OR ');
}

const argv = process.argv.slice(2);
const flags = argv.filter((a) => a.startsWith('--'));
const positional = argv.filter((a) => !a.startsWith('--'));
const flagValue = (name: string): string | undefined => {
  const hit = flags.find((f) => f.startsWith(`--${name}=`));
  return hit?.slice(name.length + 3);
};
const customSqlite = flagValue('custom-sqlite');
/** The vector width, 384 unless `--dims` says otherwise. */
const embedder = createEmbedder(Number(flagValue('dims') ?? DIMS));

// The child process of one probe mode: one attempt, as JSON, nothing else.
const mode = flagValue('mode');
if (mode === 'plain' || mode === 'custom') {
  console.log(JSON.stringify(await probeOne(mode, customSqlite)));
  process.exit(0);
}

const extractPath = positional[0];
const probeOnly = flags.includes('--probe-only') || positional[0] === 'probe';
if (extractPath === undefined && !probeOnly) {
  console.error('usage: bun engine-sqlite.ts <extract.jsonl> [--out=<json>] [--queries=<n>] [--dims=<n>] [--custom-sqlite=<path>] [--probe-only]');
  process.exit(2);
}
const queryCount = Number(flagValue('queries') ?? 200);
const terms = Number(flagValue('terms') ?? 5);
const outPath = flagValue('out');

const attempts = await probeBothModes(customSqlite);
const working = attempts.find((a) => a.ok);
const vectorsWork = working !== undefined;
// Vectors need a custom libsqlite3 only when the plain attempt failed and the custom one worked.
const needsCustom = vectorsWork && !attempts[0]!.ok;
const report: Record<string, unknown> = {
  engine: 'sqlite-fts5+sqlite-vec',
  bun: Bun.version,
  platform: `${process.platform}-${process.arch}`,
  extension: { vectorsWork, needsCustomSqlite: needsCustom, attempts },
  dims: embedder.dims,
  embeddings: `deterministic hashed bag of words, ${embedder.dims} dims, no model call`,
};

if (probeOnly || extractPath === undefined) {
  console.log(JSON.stringify(report, null, 2));
  if (outPath) await Bun.write(outPath, JSON.stringify(report, null, 2) + '\n');
  process.exit(0);
}

const vecSqlite = needsCustom ? customSqlite : undefined;

const rows = await readExtract(extractPath);
const dbPath = join(tmpdir(), `spike-sqlite-${rows.length}.db`);
const built = await rebuild(dbPath, rows, vectorsWork, vecSqlite);
const { db } = built;

const queries = sampleQueries(rows, queryCount, 11, terms, embedder.embed);

/** Top-k row ids by bm25. */
const ftsTop = db.prepare<{ id: string }, [string]>(
  `select r.id as id from records_fts f join records r on r.rowid = f.rowid
     where records_fts match ?1 order by bm25(records_fts) limit ${TOP_K}`,
);
/** Top-k row ids by vector distance. */
const vecTop = vectorsWork
  ? db.prepare<{ id: string }, [Uint8Array]>(
      `select r.id as id from records_vec v join records r on r.rowid = v.rowid
         where v.embedding match ?1 and k = ${TOP_K} order by distance`,
    )
  : null;
/** Top-k row ids by reciprocal-rank fusion of both lists, ranked in SQL. */
const hybridTop = vectorsWork
  ? db.prepare<{ id: string }, [string, Uint8Array]>(
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
    )
  : null;

const ftsMs: number[] = [];
const vecMs: number[] = [];
const hybridMs: number[] = [];
const ftsLists: string[][] = [];
const vecLists: string[][] = [];
const hybridLists: string[][] = [];

for (const query of queries) {
  const match = ftsQuery(query.text);
  const blob = new Uint8Array(query.vector.buffer.slice(0));
  const f = await timed(() => ftsTop.all(match).map((r) => r.id));
  ftsMs.push(f.ms);
  ftsLists.push(f.value);
  if (vecTop) {
    const v = await timed(() => vecTop.all(blob).map((r) => r.id));
    vecMs.push(v.ms);
    vecLists.push(v.value);
  }
  if (hybridTop) {
    const h = await timed(() => hybridTop.all(match, blob).map((r) => r.id));
    hybridMs.push(h.ms);
    hybridLists.push(h.value);
  }
}

db.exec("pragma wal_checkpoint(truncate);");
const sizeOf = (suffix: string): number => {
  try {
    return statSync(`${dbPath}${suffix}`).size;
  } catch {
    return 0;
  }
};
const totalBytes = sizeOf('') + sizeOf('-wal');

/** The hubness count over the first 100 queries' hybrid (or FTS) lists. */
const hubLists = (hybridLists.length > 0 ? hybridLists : ftsLists).slice(0, 100);

const collapsed = collapseDuplicates(rows);
const collapsedPath = join(tmpdir(), `spike-sqlite-collapsed-${collapsed.rows.length}.db`);
const collapsedBuilt = await rebuild(collapsedPath, collapsed.rows, vectorsWork, vecSqlite);
const collapsedFts = collapsedBuilt.db.prepare<{ id: string }, [string]>(
  `select r.id as id from records_fts f join records r on r.rowid = f.rowid
     where records_fts match ?1 order by bm25(records_fts) limit ${TOP_K}`,
);
const collapsedHybrid = vectorsWork
  ? collapsedBuilt.db.prepare<{ id: string }, [string, Uint8Array]>(
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
    )
  : null;
const collapsedLists: string[][] = [];
for (const query of queries.slice(0, 100)) {
  const match = ftsQuery(query.text);
  const blob = new Uint8Array(query.vector.buffer.slice(0));
  collapsedLists.push(
    collapsedHybrid ? collapsedHybrid.all(match, blob).map((r) => r.id) : collapsedFts.all(match).map((r) => r.id),
  );
}

report.build = buildFacts(db);
report.queryTerms = terms;
report.rows = rows.length;
report.rebuild = {
  totalMs: built.rebuildMs,
  ftsMs: built.ftsMs,
  vecMs: built.vecMs,
};
report.query = {
  samples: queries.length,
  fts: percentiles(ftsMs),
  knn: vectorsWork ? percentiles(vecMs) : 'not measured: extension did not load',
  hybrid: vectorsWork ? percentiles(hybridMs) : 'not measured: extension did not load',
};
report.sizeBytes = { total: totalBytes, db: sizeOf(''), wal: sizeOf('-wal') };
report.rssMb = Math.round(process.memoryUsage().rss / 1048576);
report.hubness = {
  before: hubness(hubLists),
  afterCollapse: hubness(collapsedLists),
  collapsedRows: collapsed.rows.length,
  droppedDuplicates: rows.length - collapsed.rows.length,
};

db.close();
collapsedBuilt.db.close();
console.log(JSON.stringify(report, null, 2));
if (outPath) await Bun.write(outPath, JSON.stringify(report, null, 2) + '\n');
