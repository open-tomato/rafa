/**
 * Anonymised extract of the effort store for the index-engine spike.
 *
 * Usage: bun extract.ts <effort.sqlite copy> <out dir> [--seed=<n>]
 *
 * Reads findings, task_reports and sessions from a `rafa effort copy`,
 * replaces every alphanumeric run of every free-text field by a keyed
 * hash of the same length (HMAC-SHA256 under a random 32-byte key that
 * is never written), keeps separators, timestamps and the closed
 * vocabularies (kind, signal, outcome, status), and writes:
 *
 *   extract-real.jsonl   one row per real record (derived = "real")
 *   extract-20k.jsonl    the real rows plus synthetic rows up to 20,000
 *   extract-100k.jsonl   the real rows plus synthetic rows up to 100,000
 *   manifest.json        the counts
 *
 * A synthetic row takes a new id and either copies one real row's text
 * (derived = "copy", one in five) or splices the first tokens of one
 * real row to the last tokens of another (derived = "splice", four in
 * five). Its table, kind and timestamp come from the first source row.
 * The same word always maps to the same hash, so term frequencies, text
 * lengths and token counts survive and the content does not.
 */
import { Database } from 'bun:sqlite';
import { createHmac, randomBytes } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

interface Row {
  id: string;
  table: 'findings' | 'task_reports' | 'sessions';
  kind: string | null;
  derived: 'real' | 'copy' | 'splice';
  ts: string;
  text: string;
  src: string[];
}

const SIZES = [20_000, 100_000];
const COPY_SHARE = 0.2;
const LETTERS = 'abcdefghijklmnopqrstuvwxyz';
const ALNUM = /[\p{L}\p{N}]+/gu;

const key = randomBytes(32);
const tokenMap = new Map<string, string>();

function hashToken(token: string): string {
  const lower = token.toLowerCase();
  const hit = tokenMap.get(lower);
  if (hit !== undefined) return hit;
  let out = '';
  for (let counter = 0; out.length < lower.length; counter++) {
    const digest = createHmac('sha256', key).update(`${counter}:${lower}`).digest();
    for (const byte of digest) {
      if (out.length >= lower.length) break;
      out += LETTERS[byte % LETTERS.length];
    }
  }
  tokenMap.set(lower, out);
  return out;
}

function anonymise(text: string | null): string {
  if (text === null || text === '') return '';
  return text.replace(ALNUM, (run) => hashToken(run));
}

function joinFields(fields: Array<string | null>): string {
  return fields.filter((f): f is string => f !== null && f !== '').map(anonymise).join('\n');
}

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function readReal(db: Database): Row[] {
  const findings = db
    .query<{ seq: number; kind: string | null; trigger: string | null; what: string | null; cause: string | null; resolution: string | null; artifact: string | null; task_line: string; collected_at: string }, []>(
      'SELECT seq, kind, trigger, what, cause, resolution, artifact, task_line, collected_at FROM findings ORDER BY seq',
    )
    .all()
    .map((r): Row => ({
      id: `f${r.seq}`,
      table: 'findings',
      kind: r.kind,
      derived: 'real',
      ts: r.collected_at,
      text: joinFields([r.trigger, r.what, r.cause, r.resolution, r.artifact, r.task_line]),
      src: [],
    }));
  const reports = db
    .query<{ seq: number; status: string | null; task_line: string; collected_at: string }, []>(
      'SELECT seq, status, task_line, collected_at FROM task_reports ORDER BY seq',
    )
    .all()
    .map((r): Row => ({
      id: `r${r.seq}`,
      table: 'task_reports',
      kind: r.status,
      derived: 'real',
      ts: r.collected_at,
      text: joinFields([r.task_line]),
      src: [],
    }));
  const sessions = db
    .query<{ seq: number; kind: string | null; task_text: string | null; ts: string | null }, []>(
      "SELECT seq, json_extract(row_json,'$.kind') AS kind, json_extract(row_json,'$.taskText') AS task_text, json_extract(row_json,'$.firstTimestamp') AS ts FROM sessions WHERE json_extract(row_json,'$.taskText') IS NOT NULL ORDER BY seq",
    )
    .all()
    .map((r): Row => ({
      id: `s${r.seq}`,
      table: 'sessions',
      kind: r.kind,
      derived: 'real',
      ts: r.ts ?? '',
      text: joinFields([r.task_text]),
      src: [],
    }));
  return [...findings, ...reports, ...sessions].filter((row) => row.text.length > 0);
}

function splice(a: Row, b: Row, rand: () => number): string {
  const ta = a.text.split(/(\s+)/);
  const tb = b.text.split(/(\s+)/);
  const cutA = Math.floor(rand() * ta.length);
  const cutB = Math.floor(rand() * tb.length);
  return [...ta.slice(0, cutA), ...tb.slice(cutB)].join('').trim() || a.text;
}

function grow(real: Row[], size: number, rand: () => number): Row[] {
  const out = [...real];
  for (let n = real.length; n < size; n++) {
    const a = real[Math.floor(rand() * real.length)]!;
    const isCopy = rand() < COPY_SHARE;
    const b = isCopy ? a : real[Math.floor(rand() * real.length)]!;
    out.push({
      id: `x${n}`,
      table: a.table,
      kind: a.kind,
      derived: isCopy ? 'copy' : 'splice',
      ts: a.ts,
      text: isCopy ? a.text : splice(a, b, rand),
      src: isCopy ? [a.id] : [a.id, b.id],
    });
  }
  return out;
}

function writeJsonl(path: string, rows: Row[]): void {
  writeFileSync(path, rows.map((r) => JSON.stringify(r)).join('\n') + '\n');
}

function count(rows: Row[]): Record<string, number> {
  const tally: Record<string, number> = {};
  for (const r of rows) {
    tally[`${r.table}/${r.derived}`] = (tally[`${r.table}/${r.derived}`] ?? 0) + 1;
  }
  return { total: rows.length, ...tally };
}

const [storePath, outDir, ...flags] = process.argv.slice(2);
if (!storePath || !outDir) {
  console.error('usage: bun extract.ts <effort.sqlite> <out dir> [--seed=<n>]');
  process.exit(2);
}
const seedFlag = flags.find((f) => f.startsWith('--seed='));
const seed = seedFlag ? Number(seedFlag.slice('--seed='.length)) : 1;
mkdirSync(outDir, { recursive: true });

const db = new Database(storePath, { readonly: true });
const real = readReal(db);
db.close();

const manifest: Record<string, unknown> = { seed, vocabulary: tokenMap.size, real: count(real) };
writeJsonl(join(outDir, 'extract-real.jsonl'), real);
for (const size of SIZES) {
  const rows = grow(real, size, mulberry32(seed + size));
  const label = `${size / 1000}k`;
  writeJsonl(join(outDir, `extract-${label}.jsonl`), rows);
  manifest[label] = count(rows);
}
key.fill(0);
writeFileSync(join(outDir, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
console.log(JSON.stringify(manifest, null, 2));
