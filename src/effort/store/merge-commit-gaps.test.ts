/**
 * `recomputeCommitGaps` over the commits `unionStores` brought into an
 * in-memory store, each built by running every entry of
 * `SQLITE_MIGRATIONS` on a `:memory:` connection, so no file is made
 * anywhere.
 *
 * The full recompute every case is held to is production code, not a
 * second spelling of it: `parseCommitLog` (`src/effort/commits.ts`) over
 * a planted `git log` capture of the commits, which fills each gap
 * through `assignElapsedMinutes`. The capture lists the commits by sha,
 * so the stable sort there breaks a tie by sha as the recompute does.
 * Each store holds real `CommitStats` rows from such a parse, stored as
 * `JSON.stringify` of the row as `store/sqlite.ts` stores it.
 */
import type { CommitStats } from '../commits.js';

import { Database } from 'bun:sqlite';
import { afterEach, describe, expect, it } from 'bun:test';

import { COMMIT_RECORD_MARKER, parseCommitLog } from '../commits.js';

import { recomputeCommitGaps, withoutGap } from './merge-commit-gaps.js';
import { unionStores } from './merge-union.js';
import { SQLITE_MIGRATIONS } from './migrations.js';

/** One commit as planted: its sha and author date. */
interface PlantedCommit {
  readonly sha: string;
  readonly timestamp: string;
}

/** The first local commit's instant, in epoch milliseconds. */
const BASE = Date.parse('2026-09-01T08:00:00.000Z');

const MINUTE = 60_000;

/** Commits in the store the others are brought into. */
const LOCAL_COUNT = 98;

/** Commits brought in. */
const INCOMING_COUNT = 12;

/** Rows each commit brought in may touch: its own and the one after it. */
const ROWS_PER_COMMIT = 2;

const opened: Database[] = [];
afterEach(() => {
  for (const db of opened.splice(0)) db.close();
});

/** A store in memory, brought through every migration. */
function memoryStore(): Database {
  const db = new Database(':memory:');
  opened.push(db);
  for (const { sql } of SQLITE_MIGRATIONS) db.run(sql);
  return db;
}

/** `epoch` as an author date with a `+02:00` offset, as `%aI` prints one. */
function authorDate(epoch: number): string {
  const shifted = new Date(epoch + 2 * 60 * MINUTE)
    .toISOString()
    .slice(0, 19);
  return `${shifted}+02:00`;
}

/** The capture `git log` would print for `commits`, listed by sha. */
function capture(commits: readonly PlantedCommit[]): string {
  return [...commits]
    .sort((left, right) => (left.sha < right.sha
      ? -1
      : 1))
    .map(({ sha, timestamp }) => [COMMIT_RECORD_MARKER, sha, timestamp, 'parent', 'Author', 'refs/heads/main', `feat: ${sha}`]
      .join('\t'))
    .join('\n\n');
}

/** The rows a collection over `commits` alone yields, gaps filled by `parseCommitLog`. */
function collected(commits: readonly PlantedCommit[]): CommitStats[] {
  return parseCommitLog(capture(commits)).rows;
}

/** The gap of each commit a full recompute over `commits` gives, by sha. */
function fullRecompute(commits: readonly PlantedCommit[]): Record<string, number | null> {
  return Object.fromEntries(collected(commits).map((row) => [row.sha, row.minutesSincePrevious]));
}

/** Plants `rows` into `db`'s commits in the order given, stamped with `origin`. */
function plantCommits(db: Database, rows: readonly CommitStats[], origin: string): void {
  const nextSeq = '(SELECT COALESCE(MAX(seq), 0) + 1 FROM commits)';
  for (const row of rows) {
    db.query<unknown, [string, string, string]>(
      `INSERT INTO commits (seq, origin_store, origin_seq, sha, row_json) VALUES (${nextSeq}, ?, ${nextSeq}, ?, ?)`,
    ).run(origin, row.sha, JSON.stringify(row));
  }
}

/** Every commit's `row_json` in `db`, by sha. */
function rowJsonOf(db: Database): Record<string, string> {
  return Object.fromEntries(db
    .query<{ sha: string; row_json: string }, []>('SELECT sha, row_json FROM commits')
    .all()
    .map(({ sha, row_json: json }) => [sha, json]));
}

/** Every commit's gap in `db`, by sha. */
function gapsOf(db: Database): Record<string, number | null> {
  return Object.fromEntries(Object.entries(rowJsonOf(db))
    .map(([sha, json]) => [sha, (JSON.parse(json) as CommitStats).minutesSincePrevious]));
}

/** Rows SQLite has written on `db`'s connection since it opened. */
function totalChanges(db: Database): number {
  return db.query<{ n: number }, []>('SELECT total_changes() AS n').get()?.n ?? 0;
}

/** The 98 local commits, irregularly spaced so every gap is its own. */
const LOCAL: readonly PlantedCommit[] = Array.from({ length: LOCAL_COUNT }, (_, index) => ({
  sha: `a${String(index).padStart(3, '0')}`,
  timestamp: authorDate(BASE + index * 40 * MINUTE + ((index * index) % 17) * MINUTE),
}));

/** The local commit at `index`'s instant, in epoch milliseconds. */
function localEpoch(index: number): number {
  return Date.parse(LOCAL[index]?.timestamp ?? '');
}

/**
 * The 12 commits brought in: one before every local commit, one after
 * them, a run of three between one pair of local commits, one at the
 * same instant as a local commit, and the rest spread between.
 */
const INCOMING: readonly PlantedCommit[] = [
  { sha: 'b00', timestamp: authorDate(BASE - 90 * MINUTE) },
  { sha: 'b01', timestamp: authorDate(localEpoch(10) + 7 * MINUTE) },
  { sha: 'b02', timestamp: authorDate(localEpoch(20) + 3 * MINUTE) },
  { sha: 'b03', timestamp: authorDate(localEpoch(20) + 5 * MINUTE) },
  { sha: 'b04', timestamp: authorDate(localEpoch(20) + 11 * MINUTE) },
  { sha: 'b05', timestamp: new Date(localEpoch(33)).toISOString() },
  { sha: 'b06', timestamp: authorDate(localEpoch(45) + 1 * MINUTE) },
  { sha: 'b07', timestamp: authorDate(localEpoch(58) + 19 * MINUTE) },
  { sha: 'b08', timestamp: authorDate(localEpoch(66) + 2 * MINUTE) },
  { sha: 'b09', timestamp: authorDate(localEpoch(79) + 30 * MINUTE) },
  { sha: 'b10', timestamp: authorDate(localEpoch(88) + 9 * MINUTE) },
  { sha: 'b11', timestamp: authorDate(localEpoch(LOCAL_COUNT - 1) + 120 * MINUTE) },
];

/** `rows` in a fixed order that is not time order, so no case leans on `seq` following time. */
function shuffled<T>(rows: readonly T[]): T[] {
  return rows
    .map((row, index) => ({ row, key: (index * 37) % rows.length }))
    .sort((left, right) => left.key - right.key)
    .map(({ row }) => row);
}

/** A local store of the 98 and another of the 12, each holding the gaps a collection over its own commits gives. */
function plantedPair(): { local: Database; other: Database } {
  const local = memoryStore();
  const other = memoryStore();
  plantCommits(local, shuffled(collected(LOCAL)), 'store-a');
  plantCommits(other, shuffled(collected(INCOMING)), 'store-b');
  return { local, other };
}

/** Unions `other` into `local` and answers the local `seq` of each commit it added. */
function unionCommits(local: Database, other: Database): number[] {
  const commits = unionStores(local, other).find(({ table }) => table === 'commits');
  if (commits === undefined) throw new Error('the union answered no commits entry');
  return [...commits.added];
}

describe('12 commits brought into a store of 98', () => {
  it('plants a local store whose gaps are the full recompute over its own commits (control)', () => {
    const { local } = plantedPair();

    expect(Object.keys(gapsOf(local))).toHaveLength(LOCAL_COUNT);
    expect(gapsOf(local)).toEqual(fullRecompute(LOCAL));
  });

  it('leaves the union with gaps that are not the full recompute before the recompute runs (control)', () => {
    const { local, other } = plantedPair();
    unionCommits(local, other);
    const expected = fullRecompute([...LOCAL, ...INCOMING]);

    const wrong = Object.entries(gapsOf(local)).filter(([sha, gap]) => expected[sha] !== gap);

    expect(wrong.length).toBeGreaterThan(INCOMING_COUNT);
  });

  it('yields the gaps a full recompute over the union gives', () => {
    const { local, other } = plantedPair();
    const added = unionCommits(local, other);

    recomputeCommitGaps(local, added);

    expect(added).toHaveLength(INCOMING_COUNT);
    expect(Object.keys(gapsOf(local))).toHaveLength(LOCAL_COUNT + INCOMING_COUNT);
    expect(gapsOf(local)).toEqual(fullRecompute([...LOCAL, ...INCOMING]));
  });

  it('touches at most 24 rows, as SQLite counts its writes and as the rows\' bytes show', () => {
    const { local, other } = plantedPair();
    const added = unionCommits(local, other);
    const before = rowJsonOf(local);
    const changesBefore = totalChanges(local);

    const rewrites = recomputeCommitGaps(local, added);

    const written = totalChanges(local) - changesBefore;
    const after = rowJsonOf(local);
    const differing = Object.keys(after).filter((sha) => after[sha] !== before[sha]);
    expect(written).toBe(rewrites.length);
    expect(differing.sort()).toEqual(rewrites.map(({ sha }) => sha).sort());
    expect(written).toBeLessThanOrEqual(INCOMING_COUNT * ROWS_PER_COMMIT);
    expect(written).toBeGreaterThan(0);
  });

  it('rewrites only the gap, keeping every other key of the row and its order', () => {
    const { local, other } = plantedPair();
    const added = unionCommits(local, other);
    const before = rowJsonOf(local);

    const rewrites = recomputeCommitGaps(local, added);

    const after = rowJsonOf(local);
    for (const { sha } of rewrites) {
      expect(withoutGap(after[sha] ?? '')).toBe(withoutGap(before[sha] ?? ''));
      expect(Object.keys(JSON.parse(after[sha] ?? '{}') as object)).toEqual(Object.keys(JSON.parse(before[sha] ?? '{}') as object));
    }
  });

  it('writes nothing when run again over the same commits', () => {
    const { local, other } = plantedPair();
    const added = unionCommits(local, other);
    recomputeCommitGaps(local, added);
    const changesBefore = totalChanges(local);

    expect(recomputeCommitGaps(local, added)).toEqual([]);
    expect(totalChanges(local) - changesBefore).toBe(0);
  });

  it('comes to the same gaps whichever of the two stores runs the merge', () => {
    const forward = plantedPair();
    const backward = plantedPair();

    recomputeCommitGaps(forward.local, unionCommits(forward.local, forward.other));
    recomputeCommitGaps(backward.other, unionCommits(backward.other, backward.local));

    expect(gapsOf(backward.other)).toEqual(gapsOf(forward.local));
  });
});

describe('the rows a recompute leaves out', () => {
  it('gives a commit brought in with a timestamp that does not parse a null gap, and orders the rest without it', () => {
    const local = memoryStore();
    const other = memoryStore();
    plantCommits(local, collected(LOCAL.slice(0, 3)), 'store-a');
    const [broken] = collected([{ sha: 'b99', timestamp: authorDate(localEpoch(1) + MINUTE) }]);
    if (broken === undefined) throw new Error('the capture parsed to no row');
    plantCommits(other, [{ ...broken, timestamp: 'not a date', minutesSincePrevious: 4 }], 'store-b');

    const rewrites = recomputeCommitGaps(local, unionCommits(local, other));

    expect(rewrites).toEqual([{ seq: 4, sha: 'b99', before: 4, after: null }]);
    expect(gapsOf(local)).toEqual({ ...fullRecompute(LOCAL.slice(0, 3)), b99: null });
  });

  it('leaves a row whose row_json is not a JSON object as it is', () => {
    const local = memoryStore();
    plantCommits(local, collected(LOCAL.slice(0, 2)), 'store-a');
    local.run('INSERT INTO commits (seq, origin_store, origin_seq, sha, row_json) VALUES (3, \'store-b\', 3, \'b98\', \'[1]\')');

    expect(recomputeCommitGaps(local, [3, 404])).toEqual([]);
    expect(rowJsonOf(local).b98).toBe('[1]');
  });
});
