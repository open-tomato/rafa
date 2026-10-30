/**
 * Engine 2: LanceDB under Bun, with its own FTS and vector indexes and
 * its first-party reciprocal-rank-fusion reranker for hybrid search.
 *
 * Usage: bun engine-lance.ts <extract.jsonl> [--out=<json>] [--queries=200] [--dir=<path>]
 *
 * Vectors are the deterministic pseudo-embeddings of `embed.ts`, the
 * same ones engine 1 uses, so the two engines index identical numbers.
 * Rows go in in batches, because one `add` of 100,000 rows with 384
 * dimensions is a 150 MB Arrow batch.
 */
import { statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import * as lancedb from '@lancedb/lancedb';

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

const TOP_K = 10;
const ADD_BATCH = 5_000;

/** One row as LanceDB stores it; the index signature is what `createTable` takes. */
type LanceRecord = Record<string, unknown> & {
  id: string;
  tbl: string;
  kind: string;
  derived: string;
  ts: string;
  text: string;
  vector: number[];
};

/** Turns extract rows into LanceDB records with their vectors. */
function toRecords(rows: readonly ExtractRow[]): LanceRecord[] {
  return rows.map((row) => ({
    id: row.id,
    tbl: row.table,
    kind: row.kind ?? '',
    derived: row.derived,
    ts: row.ts,
    text: row.text,
    vector: Array.from(embed(row.text)),
  }));
}

/** Bytes of a directory tree. */
function treeBytes(dir: string): number {
  let total = 0;
  const walk = (path: string): void => {
    for (const entry of new Bun.Glob('**/*').scanSync({ cwd: path, onlyFiles: true, dot: true })) {
      try {
        total += statSync(join(path, entry)).size;
      } catch {
        // a file Lance removed while walking
      }
    }
  };
  walk(dir);
  return total;
}

/** Builds a table with its FTS index, and a vector index when the row count asks for one. */
async function rebuild(
  dir: string,
  rows: readonly ExtractRow[],
  withVectorIndex: boolean,
): Promise<{ table: lancedb.Table; addMs: number; ftsMs: number; vectorIndexMs: number | null }> {
  const db = await lancedb.connect(dir);
  const records = toRecords(rows);
  const first = records.slice(0, Math.min(ADD_BATCH, records.length));
  const rest = records.slice(first.length);

  const add = await timed(async () => {
    const table = await db.createTable('records', first, { mode: 'overwrite' });
    for (let at = 0; at < rest.length; at += ADD_BATCH) {
      await table.add(rest.slice(at, at + ADD_BATCH));
    }
    return table;
  });
  const table = add.value;

  const fts = await timed(() =>
    table.createIndex('text', { config: lancedb.Index.fts({ withPosition: false, baseTokenizer: 'simple', stem: true, removeStopWords: true }) }),
  );

  let vectorIndexMs: number | null = null;
  if (withVectorIndex) {
    const built = await timed(() => table.createIndex('vector', { config: lancedb.Index.ivfPq({ numPartitions: 256, numSubVectors: 48 }) }));
    vectorIndexMs = built.ms;
  }

  return { table, addMs: add.ms, ftsMs: fts.ms, vectorIndexMs };
}

/** Row ids of a result array. */
function idsOf(rows: Array<Record<string, unknown>>): string[] {
  return rows.map((row) => String(row.id));
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
  console.error('usage: bun engine-lance.ts <extract.jsonl> [--out=<json>] [--queries=<n>] [--dir=<path>]');
  process.exit(2);
}
const queryCount = Number(flagValue('queries') ?? 200);
const terms = Number(flagValue('terms') ?? 5);
const outPath = flagValue('out');
const warnings: string[] = [];
process.on('warning', (warning) => warnings.push(`${warning.name}: ${warning.message}`));

const rows = await readExtract(extractPath);
const baseDir = flagValue('dir') ?? join(tmpdir(), `spike-lance-${rows.length}`);
const dir = `${baseDir}.lance`;
await Bun.$`rm -rf ${dir}`.quiet();

// A vector index at and above 50k rows, unless the caller turns it off to
// compare against an engine that has none.
const withVectorIndex = rows.length >= 50_000 && !flags.includes('--no-vector-index');
const built = await rebuild(dir, rows, withVectorIndex);
const table = built.table;

const queries = sampleQueries(rows, queryCount, 11, terms);
const reranker = await lancedb.rerankers.RRFReranker.create();

const ftsMs: number[] = [];
const knnMs: number[] = [];
const hybridMs: number[] = [];
const ftsLists: string[][] = [];
const hybridLists: string[][] = [];
let hybridError: string | null = null;

for (const query of queries) {
  const f = await timed(() => table.query().fullTextSearch(query.text).limit(TOP_K).toArray());
  ftsMs.push(f.ms);
  ftsLists.push(idsOf(f.value as Array<Record<string, unknown>>));

  const k = await timed(() => table.query().nearestTo(Array.from(query.vector)).limit(TOP_K).toArray());
  knnMs.push(k.ms);

  if (hybridError === null) {
    try {
      const h = await timed(() =>
        table
          .query()
          .fullTextSearch(query.text)
          .nearestTo(Array.from(query.vector))
          .rerank(reranker)
          .limit(TOP_K)
          .toArray(),
      );
      hybridMs.push(h.ms);
      hybridLists.push(idsOf(h.value as Array<Record<string, unknown>>));
    } catch (error) {
      hybridError = error instanceof Error ? error.message : String(error);
    }
  }
}

const hubLists = (hybridLists.length > 0 ? hybridLists : ftsLists).slice(0, 100);

const collapsed = collapseDuplicates(rows);
const collapsedDir = `${baseDir}-collapsed.lance`;
await Bun.$`rm -rf ${collapsedDir}`.quiet();
const collapsedBuilt = await rebuild(collapsedDir, collapsed.rows, withVectorIndex);
const collapsedLists: string[][] = [];
for (const query of queries.slice(0, 100)) {
  const built2 = collapsedBuilt.table.query().fullTextSearch(query.text);
  const result =
    hybridError === null
      ? await built2.nearestTo(Array.from(query.vector)).rerank(reranker).limit(TOP_K).toArray()
      : await built2.limit(TOP_K).toArray();
  collapsedLists.push(idsOf(result as Array<Record<string, unknown>>));
}

/** The platform binary alone, and every @lancedb package under node_modules. */
function nativeSizes(): { platformBinaryBytes: number; lancedbPackagesBytes: number } {
  const root = join(import.meta.dir, 'node_modules', '@lancedb');
  let platformBinaryBytes = 0;
  try {
    for (const entry of new Bun.Glob('*/*.node').scanSync({ cwd: root, onlyFiles: true })) {
      platformBinaryBytes = Math.max(platformBinaryBytes, statSync(join(root, entry)).size);
    }
  } catch {
    platformBinaryBytes = 0;
  }
  let lancedbPackagesBytes = 0;
  try {
    lancedbPackagesBytes = treeBytes(root);
  } catch {
    lancedbPackagesBytes = 0;
  }
  return { platformBinaryBytes, lancedbPackagesBytes };
}
const native = nativeSizes();

const report = {
  engine: 'lancedb',
  version: '0.41.0',
  bun: Bun.version,
  platform: `${process.platform}-${process.arch}`,
  dims: DIMS,
  embeddings: 'deterministic hashed bag of words, 384 dims, no model call',
  rows: rows.length,
  queryTerms: terms,
  vectorIndex: withVectorIndex ? 'ivfPq(256, 48)' : 'none: brute force under 50k rows',
  rebuild: {
    totalMs: built.addMs + built.ftsMs + (built.vectorIndexMs ?? 0),
    addMs: built.addMs,
    ftsMs: built.ftsMs,
    vectorIndexMs: built.vectorIndexMs,
  },
  query: {
    samples: queries.length,
    fts: percentiles(ftsMs),
    knn: percentiles(knnMs),
    hybrid: hybridError === null ? percentiles(hybridMs) : `not measured: ${hybridError}`,
  },
  sizeBytes: { table: treeBytes(dir), ...native },
  hubness: {
    before: hubness(hubLists),
    afterCollapse: hubness(collapsedLists),
    collapsedRows: collapsed.rows.length,
    droppedDuplicates: rows.length - collapsed.rows.length,
  },
  warnings,
};

console.log(JSON.stringify(report, null, 2));
if (outPath) await Bun.write(outPath, JSON.stringify(report, null, 2) + '\n');
