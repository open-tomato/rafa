/**
 * Shared pieces of both engine benchmarks: the extract reader, the
 * timing helpers, the query sampler and the hubness count.
 */
import { embed, tokensOf } from './embed.js';

/** One row of an extract file. */
export interface ExtractRow {
  id: string;
  table: string;
  kind: string | null;
  derived: 'real' | 'copy' | 'splice';
  ts: string;
  text: string;
  src: string[];
}

/** Reads a JSONL extract into memory. */
export async function readExtract(path: string): Promise<ExtractRow[]> {
  const text = await Bun.file(path).text();
  return text
    .split('\n')
    .filter((line) => line.length > 0)
    .map((line) => JSON.parse(line) as ExtractRow);
}

/** Milliseconds a thunk takes. */
export async function timed<T>(run: () => Promise<T> | T): Promise<{ ms: number; value: T }> {
  const start = Bun.nanoseconds();
  const value = await run();
  return { ms: (Bun.nanoseconds() - start) / 1e6, value };
}

/** The p50 and p95 of a sample, in the sample's own unit. */
export function percentiles(samples: number[]): { p50: number; p95: number } {
  const sorted = [...samples].sort((a, b) => a - b);
  const at = (share: number): number => sorted[Math.min(sorted.length - 1, Math.floor(share * sorted.length))] ?? 0;
  return { p50: at(0.5), p95: at(0.95) };
}

/** A deterministic PRNG, so both engines see the same queries. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** One query drawn from a row: its first few distinct tokens, and the row's own vector. */
export interface SampleQuery {
  text: string;
  vector: Float32Array;
}

/** Draws `count` queries from the rows, each a run of `terms` tokens of one row. */
export function sampleQueries(rows: readonly ExtractRow[], count: number, seed: number, terms = 5): SampleQuery[] {
  const rand = mulberry32(seed);
  const out: SampleQuery[] = [];
  let guard = 0;
  while (out.length < count && guard < count * 50) {
    guard++;
    const row = rows[Math.floor(rand() * rows.length)]!;
    const tokens = [...new Set(tokensOf(row.text))].filter((t) => t.length > 2);
    if (tokens.length < terms) continue;
    const start = Math.floor(rand() * (tokens.length - terms + 1));
    const text = tokens.slice(start, start + terms).join(' ');
    out.push({ text, vector: embed(text) });
  }
  return out;
}

/** What the hubness count answers for one engine and one query set. */
export interface Hubness {
  queries: number;
  unionSize: number;
  distinctRows: number;
  topFiveShare: number;
  topFive: Array<{ id: string; hits: number }>;
}

/** Counts how concentrated the union of top-k result lists is. */
export function hubness(resultLists: ReadonlyArray<readonly string[]>): Hubness {
  const hits = new Map<string, number>();
  let unionSize = 0;
  for (const list of resultLists) {
    for (const id of list) {
      unionSize++;
      hits.set(id, (hits.get(id) ?? 0) + 1);
    }
  }
  const ranked = [...hits.entries()].sort((a, b) => b[1] - a[1]);
  const topFive = ranked.slice(0, 5);
  const topFiveHits = topFive.reduce((sum, [, n]) => sum + n, 0);
  return {
    queries: resultLists.length,
    unionSize,
    distinctRows: hits.size,
    topFiveShare: unionSize === 0 ? 0 : topFiveHits / unionSize,
    topFive: topFive.map(([id, n]) => ({ id, hits: n })),
  };
}

/** Collapses rows whose text is byte-identical into one row carrying a count. */
export function collapseDuplicates(rows: readonly ExtractRow[]): { rows: ExtractRow[]; counts: Map<string, number> } {
  const byText = new Map<string, ExtractRow>();
  const counts = new Map<string, number>();
  for (const row of rows) {
    const held = byText.get(row.text);
    if (held) {
      counts.set(held.id, (counts.get(held.id) ?? 1) + 1);
      continue;
    }
    byText.set(row.text, row);
    counts.set(row.id, 1);
  }
  return { rows: [...byText.values()], counts };
}

export { embed, tokensOf };
