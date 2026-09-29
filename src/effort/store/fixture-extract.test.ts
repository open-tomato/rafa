/**
 * `extractStores` over two store files under `tmpdir()` shaped as
 * scenario 4, a copy then divergence: store A is brought through every
 * migration by `bringForward`, given a `store_meta` row and four rows in
 * every merged table (the first with a NULL origin, as an older runtime
 * writes it), and copied byte for byte to B; then A gains three rows of
 * its own and B three of its own under a new origin. Four rows of each
 * merged table therefore overlap, and three lie past the divergence on
 * each side.
 *
 * Every free-text value planted carries the marker `SRC`, and the paths
 * sit under `/home/SRC-alice`, so "no source text survives" is a search
 * for those strings in what the extract writes. The search is paired
 * with its control: the same strings found in the source files' bytes.
 */
import type { Extract, ExtractSide, ExtractValue } from './fixture-extract.js';
import type { OriginTable } from './origins.js';
import type { SQLQueryBindings } from 'bun:sqlite';

import { copyFileSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { Database } from 'bun:sqlite';
import { afterEach, beforeEach, describe, expect, it } from 'bun:test';

import { bringForward } from './bring-forward.js';
import {
  anonymiseValue,
  createPlaceholderMap,
  EXTRACT_FILE_NAMES,
  extractStores,
  PlaceholderCollision,
  readExtractSide,
  restoreExtractSide,
  writeExtract,
} from './fixture-extract.js';
import { unionStores } from './merge-union.js';
import { SQLITE_MIGRATIONS } from './migrations.js';
import { ORIGIN_TABLES } from './origins.js';

/** A planted row's columns other than `seq` and its origin pair. */
type FixtureRow = Readonly<Record<string, SQLQueryBindings>>;

/** The origins of the two stores. */
const ORIGIN_A = 'SRC-store-a-7f3a';
const ORIGIN_B = 'SRC-store-b-91c2';

/** Keys planted in A before the copy, the first with a NULL origin. */
const SHARED_KEYS = ['k0', 'k1', 'k2', 'k3'] as const;

/** Keys planted after the copy on each side. */
const A_KEYS = ['a1', 'a2', 'a3'] as const;
const B_KEYS = ['b1', 'b2', 'b3'] as const;

/** Keys whose finding holds the artifact several findings share. */
const SHARED_ARTIFACT_KEYS: ReadonlySet<string> = new Set(['k1', 'a1', 'b1']);

/** Keys whose finding was filed as a bug. */
const FILED_KEYS: ReadonlySet<string> = new Set(['k2', 'a2']);

/** Every key in plant order, for its timestamp. */
const ALL_KEYS: readonly string[] = [...SHARED_KEYS, ...A_KEYS, ...B_KEYS];

/** When the row of `key` was collected: a minute apart, in plant order. */
function timeOf(key: string): string {
  const minute = String(ALL_KEYS.indexOf(key)).padStart(2, '0');
  return `2026-09-28T10:${minute}:00.000Z`;
}

/** The session id every row of `key` names. */
function sessionOf(key: string): string {
  return `SRC-session-${key}`;
}

/** The columns every report-derived table holds beside its own. */
function reportRow(key: string): FixtureRow {
  return {
    id: `SRC-id-${key}`, session_id: sessionOf(key), plan_stub: 'SRC-plan', task_line: `SRC task line ${key}`,
    outcome: 'done', collected_at: timeOf(key),
  };
}

/** One valid row of each merged table for `key`, free text marked `SRC`. */
const FIXTURES: Readonly<Record<OriginTable, (key: string) => FixtureRow>> = {
  sessions: (key) => ({
    session_id: sessionOf(key),
    row_json: JSON.stringify({
      sessionId: sessionOf(key), filePath: `/home/SRC-alice/.claude/projects/p/${key}.jsonl`,
      firstTimestamp: timeOf(key), gitBranchCounts: { 'feat/SRC-branch': 3 }, usage: { inputTokens: 12 },
      taskText: 'SRC do the thing',
    }),
  }),
  commits: (key) => ({
    sha: `SRCsha${key}`,
    row_json: JSON.stringify({
      sha: `SRCsha${key}`, timestamp: timeOf(key), subject: 'SRC subject', author: 'SRC Alice', minutesSincePrevious: 5,
    }),
  }),
  findings: (key) => ({
    ...reportRow(key), kind: 'gotcha', trigger: 'SRC when', what: 'SRC what', cause: 'SRC cause',
    resolution: 'SRC resolution', signal: 'loud',
    artifact: SHARED_ARTIFACT_KEYS.has(key)
      ? 'SRC shared artifact /home/SRC-alice/p/x.ts:12'
      : `SRC artifact ${key}`,
    tracker_ref: FILED_KEYS.has(key)
      ? `SRC https://github.com/SRC-alice/p/issues/${key}`
      : null,
  }),
  blockers: (key) => ({ ...reportRow(key), what: `SRC blocked on ${key}` }),
  out_of_scope_bugs: (key) => ({ ...reportRow(key), what: `SRC bug ${key}`, security: 0 }),
  report_absences: (key) => ({ ...reportRow(key), reason: 'no-block', detail: `SRC no block in ${key}` }),
  task_reports: (key) => ({ ...reportRow(key), status: 'done', skills_used: '["SRC-skill"]' }),
  preflight: (key) => ({
    run_id: `SRC-run-${key}`, position: 0, tier: 'required', kind: 'command', item: `SRC item ${key}`,
    outcome: 'pass', duration_ms: 5, collected_at: timeOf(key),
  }),
  dispatches: (key) => ({
    session_id: sessionOf(key), task_line: `SRC task ${key}`, model: 'SRC-opus', tools: 'SRC-Read,SRC-Edit',
    flags: '["--model","SRC-opus"]', skills_offered: '["SRC-skill"]', collected_at: timeOf(key),
  }),
  changes: (key) => ({
    id: `SRC-id-${key}`, session_id: sessionOf(key), task_line: `SRC task ${key}`, level: 'patch',
    summary: `SRC change ${key}`, collected_at: timeOf(key),
  }),
  skill_invocations: (key) => ({ session_id: sessionOf(key), name: 'SRC-skill', sidechain: 0, count: 2 }),
  plan_ci: (key) => ({
    plan_stub: 'SRC-plan', pr: 9, head_sha: `SRC-head-${key}`, verdict: 'red', failing: '["SRC lint"]',
    read_at: timeOf(key),
  }),
};

let base = '';
const opened: Database[] = [];

beforeEach(() => {
  base = realpathSync(mkdtempSync(join(tmpdir(), 'rafa-fixture-extract-')));
});

afterEach(() => {
  for (const db of opened.splice(0)) db.close();
  rmSync(base, { recursive: true, force: true });
});

/** Opens `path` for the case, closed after it. */
function open(path: string): Database {
  const db = new Database(path);
  opened.push(db);
  return db;
}

/** Plants `row` into `table` under the next `seq`, stamped with `origin` or NULL in both. */
function plantRow(db: Database, table: OriginTable, row: FixtureRow, origin: string | null): void {
  const columns = Object.keys(row);
  const nextSeq = `(SELECT COALESCE(MAX(seq), 0) + 1 FROM ${table})`;
  const originSeq = origin === null
    ? 'NULL'
    : nextSeq;
  db.query<unknown, SQLQueryBindings[]>(
    `INSERT INTO ${table} (seq, origin_store, origin_seq, ${columns.join(', ')})`
      + ` VALUES (${nextSeq}, ?, ${originSeq}, ${columns.map(() => '?').join(', ')})`,
  ).run(origin, ...Object.values(row));
}

/** Plants the fixture row of each key into every merged table. */
function plantKeys(db: Database, keys: readonly string[], origin: (key: string) => string | null): void {
  for (const key of keys) {
    for (const table of ORIGIN_TABLES) plantRow(db, table, FIXTURES[table](key), origin(key));
  }
}

/** Records the store's identity row, as a mint writes it. */
function plantMeta(db: Database, storeId: string, host: string, path: string): void {
  db.query<unknown, SQLQueryBindings[]>(
    'INSERT OR REPLACE INTO store_meta (id, store_id, project_root_commit, project_remote, host_id, store_path,'
      + ' file_dev, file_ino, minted_at) VALUES (1, ?, ?, ?, ?, ?, ?, ?, ?)',
  ).run(storeId, 'SRCrootcommit', 'git@github.com:SRC-alice/p.git', host, path, 2049, 8812345, timeOf('k0'));
}

/** Stores A and B of scenario 4, as the module note says. */
function plantScenario(): { pathA: string; pathB: string } {
  const pathA = join(base, 'a.sqlite');
  const pathB = join(base, 'b.sqlite');
  const dbA = open(pathA);
  bringForward(dbA, pathA, 'write', 'open', { appliedBy: 'SRC-runtime /home/SRC-alice/.rafa' });
  plantMeta(dbA, ORIGIN_A, 'SRC-host-a', `/home/SRC-alice/p/${'.rafa'}/effort/effort.sqlite`);
  plantKeys(dbA, SHARED_KEYS, (key) => key === 'k0'
    ? null
    : ORIGIN_A);
  dbA.close();
  copyFileSync(pathA, pathB);
  const dbB = open(pathB);
  plantMeta(dbB, ORIGIN_B, 'SRC-host-b', '/home/SRC-bob/p/effort.sqlite');
  plantKeys(dbB, B_KEYS, () => ORIGIN_B);
  const reopenedA = open(pathA);
  plantKeys(reopenedA, A_KEYS, () => ORIGIN_A);
  return { pathA, pathB };
}

/** The value of `column` in the row of `side`'s `table` whose `seq` (or `id`) is `seq`. */
function valueAt(side: ExtractSide, table: string, seq: number, column: string): ExtractValue {
  const found = side.tables[table];
  if (found === undefined) throw new Error(`no ${table} in side ${side.side}`);
  const key = found.columns.includes('seq')
    ? 'seq'
    : 'id';
  const row = found.rows.find((candidate) => candidate[found.columns.indexOf(key)] === seq);
  if (row === undefined) throw new Error(`no ${table} row ${String(seq)} in side ${side.side}`);
  return row[found.columns.indexOf(column)] ?? null;
}

/** Every value of `column` in `side`'s `table`, in row order. */
function columnOf(side: ExtractSide, table: string, column: string): ExtractValue[] {
  const found = side.tables[table];
  if (found === undefined) throw new Error(`no ${table} in side ${side.side}`);
  return found.rows.map((row) => row[found.columns.indexOf(column)] ?? null);
}

/** The `seq` of `key`'s row on its side: shared keys first, then that side's own. */
function seqOf(key: string): number {
  const shared = SHARED_KEYS.indexOf(key as typeof SHARED_KEYS[number]);
  if (shared >= 0) return shared + 1;
  const own = [...A_KEYS, ...B_KEYS].indexOf(key as typeof A_KEYS[number]) % A_KEYS.length;
  return SHARED_KEYS.length + own + 1;
}

/** A parsed JSON column value. */
function parsed(value: ExtractValue): Record<string, unknown> {
  if (typeof value !== 'string') throw new Error(`not JSON text: ${String(value)}`);
  return JSON.parse(value) as Record<string, unknown>;
}

/** Runs the extract over a fresh scenario. */
function extractScenario(perSide?: number): Extract {
  const { pathA, pathB } = plantScenario();
  return extractStores(pathA, pathB, perSide);
}

describe('extractStores over a copy then divergence', () => {
  it('maps one value to one placeholder across both stores and every column holding it', () => {
    const { a, b } = extractScenario();

    const session = valueAt(a, 'sessions', seqOf('k1'), 'session_id');
    expect(session).toMatch(/^anon:[0-9a-f]{24}$/);
    expect(valueAt(b, 'sessions', seqOf('k1'), 'session_id')).toBe(session);
    expect(parsed(valueAt(a, 'sessions', seqOf('k1'), 'row_json'))['sessionId']).toBe(session);
    expect(parsed(valueAt(b, 'sessions', seqOf('k1'), 'row_json'))['sessionId']).toBe(session);
    for (const table of ['findings', 'dispatches', 'skill_invocations', 'task_reports']) {
      expect(valueAt(a, table, seqOf('k1'), 'session_id')).toBe(session);
      expect(valueAt(b, table, seqOf('k1'), 'session_id')).toBe(session);
    }
    expect(valueAt(b, 'store_meta', 1, 'project_root_commit')).toBe(valueAt(a, 'store_meta', 1, 'project_root_commit'));
    expect(valueAt(b, 'store_meta', 1, 'project_remote')).toBe(valueAt(a, 'store_meta', 1, 'project_remote'));
    const storeA = valueAt(a, 'store_meta', 1, 'store_id');
    const storeB = valueAt(b, 'store_meta', 1, 'store_id');
    expect(storeB).not.toBe(storeA);
    expect(valueAt(a, 'findings', seqOf('k1'), 'origin_store')).toBe(storeA);
    expect(valueAt(b, 'findings', seqOf('k1'), 'origin_store')).toBe(storeA);
    expect(valueAt(b, 'findings', seqOf('b1'), 'origin_store')).toBe(storeB);
    expect(new Set(columnOf(a, 'findings', 'session_id')).size).toBe(SHARED_KEYS.length + A_KEYS.length);
  });

  it('keeps every overlapping row, identical on both sides, and the union matches exactly those', () => {
    const extract = extractScenario();

    for (const table of ORIGIN_TABLES) {
      const summary = extract.summary.find((entry) => entry.table === table);
      expect(summary).toEqual({ table, rowsA: 7, rowsB: 7, overlap: 4, keptA: 7, keptB: 7 });
      for (const key of SHARED_KEYS) {
        const rowOf = (side: ExtractSide): ExtractValue[] => extract[side.side].tables[table]?.rows[seqOf(key) - 1]?.slice() ?? [];
        expect(rowOf(extract.b)).toEqual(rowOf(extract.a));
      }
    }
    const restoredA = join(base, 'restored-a.sqlite');
    const restoredB = join(base, 'restored-b.sqlite');
    restoreExtractSide(extract.a, restoredA);
    restoreExtractSide(extract.b, restoredB);
    const unions = unionStores(open(restoredB), open(restoredA));
    expect(unions.map(({ table }) => table)).toEqual([...ORIGIN_TABLES]);
    for (const union of unions) {
      expect([union.table, union.matched.length, union.added.length, union.collided.length])
        .toEqual([union.table, SHARED_KEYS.length, A_KEYS.length, 0]);
    }
    expect(unions.find(({ table }) => table === 'findings')?.matched.map(({ by }) => by))
      .toEqual(['identity', 'origin', 'origin', 'origin']);
  });

  it('keeps which findings share an artifact and which tracker_refs are filled, not what they say', () => {
    const { a, b } = extractScenario();

    const shared = valueAt(a, 'findings', seqOf('k1'), 'artifact');
    expect(valueAt(a, 'findings', seqOf('a1'), 'artifact')).toBe(shared);
    expect(valueAt(b, 'findings', seqOf('b1'), 'artifact')).toBe(shared);
    expect(new Set([...columnOf(a, 'findings', 'artifact'), ...columnOf(b, 'findings', 'artifact')]).size)
      .toBe(1 + ALL_KEYS.length - SHARED_ARTIFACT_KEYS.size);
    const filled = (side: ExtractSide, keys: readonly string[]): boolean[] => (
      keys.map((key) => valueAt(side, 'findings', seqOf(key), 'tracker_ref') !== null)
    );
    expect(filled(a, [...SHARED_KEYS, ...A_KEYS])).toEqual([false, false, true, false, false, true, false]);
    expect(filled(b, [...SHARED_KEYS, ...B_KEYS])).toEqual([false, false, true, false, false, false, false]);
    expect(valueAt(b, 'findings', seqOf('k2'), 'tracker_ref')).toBe(valueAt(a, 'findings', seqOf('k2'), 'tracker_ref'));
  });

  it('keeps timestamps, their order, seq, NULLs, numbers, the closed words and the row schema keys', () => {
    const { pathA, pathB } = plantScenario();
    const { a, b } = extractStores(pathA, pathB);
    const sourceVersion = open(pathA)
      .query<{ user_version: number }, []>('PRAGMA user_version')
      .get()?.user_version;

    expect(columnOf(a, 'findings', 'collected_at')).toEqual([...SHARED_KEYS, ...A_KEYS].map(timeOf));
    expect(columnOf(b, 'plan_ci', 'read_at')).toEqual([...SHARED_KEYS, ...B_KEYS].map(timeOf));
    expect(columnOf(a, 'findings', 'seq')).toEqual([1, 2, 3, 4, 5, 6, 7]);
    expect(columnOf(a, 'findings', 'origin_store')[0]).toBeNull();
    expect(columnOf(a, 'findings', 'origin_seq')).toEqual([null, 2, 3, 4, 5, 6, 7]);
    expect(new Set(columnOf(a, 'findings', 'kind'))).toEqual(new Set(['gotcha']));
    expect(new Set(columnOf(b, 'report_absences', 'reason'))).toEqual(new Set(['no-block']));
    expect(new Set(columnOf(b, 'plan_ci', 'verdict'))).toEqual(new Set(['red']));
    expect(parsed(valueAt(a, 'plan_ci', 1, 'failing'))).toHaveLength(1);
    expect(columnOf(a, 'store_meta', 'file_ino')).toEqual([0]);
    expect(columnOf(a, 'schema_migrations', 'id')).toEqual(SQLITE_MIGRATIONS.map(({ id }) => id));
    expect(a.userVersion).toBe(sourceVersion ?? -1);

    const session = parsed(valueAt(a, 'sessions', seqOf('a2'), 'row_json'));
    expect(session['firstTimestamp']).toBe(timeOf('a2'));
    expect(session['usage']).toEqual({ inputTokens: 12 });
    expect(Object.keys(session)).toEqual(['sessionId', 'filePath', 'firstTimestamp', 'gitBranchCounts', 'usage', 'taskText']);
    expect(Object.values(session['gitBranchCounts'] as Record<string, number>)).toEqual([3]);
    expect(Object.keys(session['gitBranchCounts'] as Record<string, number>)[0]).toMatch(/^anon:/);
    const commit = parsed(valueAt(b, 'commits', seqOf('b3'), 'row_json'));
    expect([commit['timestamp'], commit['minutesSincePrevious']]).toEqual([timeOf('b3'), 5]);
    expect(commit['sha']).toBe(valueAt(b, 'commits', seqOf('b3'), 'sha'));
  });

  it('leaves no source text in what it writes, where the source files hold it', () => {
    const { pathA, pathB } = plantScenario();
    const outDir = join(base, 'out');

    writeExtract(extractStores(pathA, pathB), outDir);

    const written = readdirSync(outDir)
      .map((name) => readFileSync(join(outDir, name), 'utf8'))
      .join('\n');
    const source = [pathA, pathB].map((path) => readFileSync(path).toString('latin1')).join('\n');
    for (const needle of ['SRC', '/home/', 'alice', 'bob', 'github.com']) {
      expect([needle, source.includes(needle)]).toEqual([needle, true]);
      expect([needle, written.includes(needle)]).toEqual([needle, false]);
    }
  });

  it('reads both stores without changing a byte of either', () => {
    const { pathA, pathB } = plantScenario();
    for (const db of opened.splice(0)) db.close();
    const bytes = (): string[] => [pathA, pathB].map((path) => readFileSync(path).toString('base64'));
    const before = bytes();

    extractStores(pathA, pathB);

    expect(bytes()).toEqual(before);
    expect(readdirSync(base).sort((x, y) => x.localeCompare(y))).toEqual(['a.sqlite', 'b.sqlite']);
  });

  it('gives different placeholders on two runs over the same stores, and the same shape', () => {
    const { pathA, pathB } = plantScenario();

    const first = extractStores(pathA, pathB);
    const second = extractStores(pathA, pathB);

    expect(second.summary).toEqual(first.summary);
    for (const [table, column] of [['sessions', 'session_id'], ['findings', 'artifact'], ['store_meta', 'store_id']] as const) {
      const once = columnOf(first.a, table, column);
      const again = columnOf(second.a, table, column);
      expect(again).toHaveLength(once.length);
      expect(again.filter((value, index) => value === once[index])).toEqual([]);
    }
    expect(columnOf(second.a, 'findings', 'collected_at')).toEqual(columnOf(first.a, 'findings', 'collected_at'));
  });

  it('keeps every overlapping row and the first perSide rows past the divergence on each side', () => {
    const extract = extractScenario(1);

    for (const table of ORIGIN_TABLES) {
      expect(extract.summary.find((entry) => entry.table === table))
        .toEqual({ table, rowsA: 7, rowsB: 7, overlap: 4, keptA: 5, keptB: 5 });
      expect(columnOf(extract.a, table, 'seq')).toEqual([1, 2, 3, 4, 5]);
      expect(columnOf(extract.b, table, 'seq')).toEqual([1, 2, 3, 4, 5]);
    }
    const log = extract.summary.find((entry) => entry.table === 'schema_migrations');
    expect([log?.keptA, log?.keptB]).toEqual([SQLITE_MIGRATIONS.length, SQLITE_MIGRATIONS.length]);
  });

  it('refuses a per-side sample that is not a whole number and a store that is not there', () => {
    const { pathA } = plantScenario();

    expect(() => extractStores(pathA, pathA, -1)).toThrow('per-side sample -1 is not a whole number of rows');
    expect(() => extractStores(pathA, pathA, 1.5)).toThrow('per-side sample 1.5 is not a whole number of rows');
    expect(() => extractStores(pathA, join(base, 'absent.sqlite'))).toThrow(`no store at ${join(base, 'absent.sqlite')}`);
  });
});

describe('writeExtract and readExtractSide', () => {
  it('writes the three files under the directory and nothing else, and refuses to replace one', () => {
    const extract = extractScenario();
    const outDir = join(base, 'nested', 'out');

    const paths = writeExtract(extract, outDir);

    expect(readdirSync(join(base, 'nested'))).toEqual(['out']);
    expect(readdirSync(outDir).sort((x, y) => x.localeCompare(y))).toEqual(['a.json', 'b.json', 'summary.json']);
    expect(paths).toEqual(['a.json', 'b.json', 'summary.json'].map((name) => join(outDir, name)));
    const before = readFileSync(join(outDir, EXTRACT_FILE_NAMES.a), 'utf8');
    expect(() => writeExtract(extract, outDir)).toThrow('the extract would replace');
    expect(readFileSync(join(outDir, EXTRACT_FILE_NAMES.a), 'utf8')).toBe(before);
    expect(readExtractSide(join(outDir, EXTRACT_FILE_NAMES.b))).toEqual(extract.b);
  });

  it('refuses a file that is not an extract, naming what is wrong', () => {
    const path = join(base, 'bad.json');
    const side = extractScenario().a;
    const cases: readonly [unknown, string][] = [
      [{ ...side, format: 'other' }, 'its format is not rafa-merge-fixture/1'],
      [{ ...side, side: 'c' }, 'it names no side'],
      [{ ...side, schema: [1] }, 'it holds no schema'],
      [{ ...side, tables: { findings: { columns: ['seq'], rows: [[1, 2]] } } }, 'table findings row 0 does not match its 1 columns'],
    ];
    for (const [content, message] of cases) {
      writeFileSync(path, JSON.stringify(content));
      expect(() => readExtractSide(path)).toThrow(message);
    }
  });
});

describe('the placeholder map and the value rules', () => {
  it('answers one placeholder per value, and throws when two values reach one', () => {
    const map = createPlaceholderMap(() => '0123456789abcdef0123456789abcdef');

    expect(map('first')).toBe('anon:0123456789abcdef01234567');
    expect(map('first')).toBe('anon:0123456789abcdef01234567');
    expect(() => map('second')).toThrow(PlaceholderCollision);
  });

  it('replaces prose in a kept column, JSON text that does not parse, and throws on a BLOB', () => {
    const map = createPlaceholderMap((value) => Buffer.from(value)
      .toString('hex')
      .padEnd(24, '0'));

    expect(anonymiseValue('findings', 'outcome', 'done', map)).toBe('done');
    expect(anonymiseValue('findings', 'outcome', 'SRC done by alice', map)).toMatch(/^anon:/);
    expect(anonymiseValue('sessions', 'row_json', 'SRC {not json', map)).toMatch(/^anon:/);
    expect(anonymiseValue('findings', 'cause', '', map)).toBe('');
    expect(anonymiseValue('findings', 'cause', null, map)).toBeNull();
    expect(anonymiseValue('store_meta', 'file_dev', 2049, map)).toBe(0);
    expect(() => anonymiseValue('findings', 'what', new Uint8Array([1]), map)).toThrow('findings.what holds a BLOB');
  });
});
