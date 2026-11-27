/**
 * `settleMatches` over the pairs `unionStores` matched between two
 * in-memory stores, each built by running every entry of
 * `SQLITE_MIGRATIONS` on a `:memory:` connection, so no file is made
 * anywhere.
 *
 * Findings are planted as `merge-union.test.ts` plants them: the next
 * `seq`, and under an origin that same `seq` as `origin_seq`, or NULL in
 * both as a runtime before `row-origins` writes. Each case unions first,
 * so the pairs settled are the ones the merge itself would hand over.
 *
 * A held row is planted as a projected pull leaves it: the columns a
 * migration the pull lacked would fill read NULL here, `cause` and
 * `resolution` standing in for them, and its pair is listed in
 * `held_rows` with a migration id of no real catalogue.
 *
 * `readConflictedRows` takes a path, so its cases build the store as a
 * file under one directory of `tmpdir()`, removed after the file runs,
 * close the writing connection, and read the file back. A conflict it
 * reads is either recorded by `settleMatches` or planted straight into
 * `merge_conflicts`, as two fields of one row or a second table need.
 */
import type { HeldCopy, TableSettlement } from './merge-conflicts.js';
import type { SQLQueryBindings } from 'bun:sqlite';

import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { Database } from 'bun:sqlite';
import { afterAll, afterEach, describe, expect, it } from 'bun:test';

import {
  readConflictedRows,
  RECOMPUTED_COMPARISONS,
  SET_ONCE_FILLS,
  settleMatches,
  takeHeldCopies,
} from './merge-conflicts.js';
import { MERGE_RULES, RECOMPUTED, SET_ONCE } from './merge-rules.js';
import { unionStores } from './merge-union.js';
import { SQLITE_MIGRATIONS } from './migrations.js';

/** A planted finding's columns other than `seq` and its origin pair. */
type FindingRow = Readonly<Record<string, SQLQueryBindings>>;

/** The merge the conflicts are recorded under. */
const TRAIL = { mergeId: 'merge-1', recordedAt: '2026-09-29T12:00:00.000Z' };

/** A tracker reference as `writeTrackerRef` stores it. */
const FIRST_REF = '{"provider":"github","number":101}';
const SECOND_REF = '{"provider":"github","number":202}';

/** One valid finding for `key`, holding `trackerRef`. */
function finding(key: string, trackerRef: string | null = null): FindingRow {
  return {
    id: `id-${key}`, session_id: `session-${key}`, task_line: `task ${key}`, outcome: 'done',
    collected_at: '2026-09-29T10:00:00.000Z', kind: 'gotcha', trigger: `when ${key}`, artifact: `artifact-${key}`,
    signal: 'loud', tracker_ref: trackerRef,
  };
}

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

/** Plants `row` into `findings` under the next `seq`, stamped with `origin` or NULL in both. */
function plantFinding(db: Database, row: FindingRow, origin: string | null): void {
  const columns = Object.keys(row);
  const nextSeq = '(SELECT COALESCE(MAX(seq), 0) + 1 FROM findings)';
  const originSeq = origin === null
    ? 'NULL'
    : nextSeq;
  db.query<unknown, SQLQueryBindings[]>(
    `INSERT INTO findings (seq, origin_store, origin_seq, ${columns.join(', ')})`
      + ` VALUES (${nextSeq}, ?, ${originSeq}, ${columns.map(() => '?').join(', ')})`,
  ).run(origin, ...Object.values(row));
}

/** One stored row, every column. */
type ReadRow = Readonly<Record<string, SQLQueryBindings>>;

/** Every finding of `db`, every column, in `seq` order. */
function findingsOf(db: Database): ReadRow[] {
  const columns = db
    .query<{ name: string }, []>('PRAGMA table_info(findings)')
    .all()
    .map(({ name }) => name);
  return db.query<ReadRow, []>(`SELECT ${columns.join(', ')} FROM findings ORDER BY seq`).all();
}

/** A recorded conflict row as the table holds it, `incoming` parsed. */
interface ConflictRow {
  readonly merge_id: string;
  readonly table_name: string;
  readonly local_seq: number;
  readonly field: string | null;
  readonly incoming: Record<string, SQLQueryBindings>;
  readonly recorded_at: string;
}

/** Every row of `merge_conflicts` in `db`, in `seq` order. */
function conflictsOf(db: Database): ConflictRow[] {
  return db
    .query<Omit<ConflictRow, 'incoming'> & { incoming: string }, []>(
      'SELECT merge_id, table_name, local_seq, field, incoming, recorded_at FROM merge_conflicts ORDER BY seq',
    )
    .all()
    .map((row) => ({ ...row, incoming: JSON.parse(row.incoming) as Record<string, SQLQueryBindings> }));
}

/** Unions `other` into `local`, then settles what matched. */
function merge(local: Database, other: Database): TableSettlement[] {
  return settleMatches(local, other, unionStores(local, other), TRAIL);
}

/** The settlement's entry for `table`. */
function entryFor(result: readonly TableSettlement[], table: string): TableSettlement {
  const entry = result.find((settlement) => settlement.table === table);
  if (entry === undefined) throw new Error(`no settlement entry for ${table}`);
  return entry;
}

/** The `tracker_ref` of every finding of `db`, in `seq` order. */
function trackerRefsOf(db: Database): (SQLQueryBindings | undefined)[] {
  return findingsOf(db).map((row) => row.tracker_ref);
}

describe('a pair of equal rows', () => {
  it('is skipped, writing nothing, whether matched on its origin pair or on its UUID (control)', () => {
    const local = memoryStore();
    const other = memoryStore();
    plantFinding(local, finding('shared', FIRST_REF), 'store-a');
    plantFinding(local, finding('old'), null);
    plantFinding(other, finding('shared', FIRST_REF), 'store-a');
    plantFinding(other, finding('old'), 'store-b');
    const before = findingsOf(local);

    const result = merge(local, other);

    expect(entryFor(result, 'findings')).toEqual({ table: 'findings', skipped: [1, 2], filled: [], conflicts: [] });
    expect(findingsOf(local)).toEqual(before);
    expect(conflictsOf(local)).toEqual([]);
  });
});

describe('tracker_ref, set once', () => {
  it('takes the other store\'s filled value over NULL here', () => {
    const local = memoryStore();
    const other = memoryStore();
    plantFinding(local, finding('bug'), 'store-a');
    plantFinding(other, finding('bug', FIRST_REF), 'store-a');

    const result = merge(local, other);

    expect(entryFor(result, 'findings')).toEqual({
      table: 'findings', skipped: [1], filled: [{ localSeq: 1, field: 'tracker_ref' }], conflicts: [],
    });
    expect(trackerRefsOf(local)).toEqual([FIRST_REF]);
    expect(conflictsOf(local)).toEqual([]);
  });

  it('keeps the filled value here over NULL in the other store', () => {
    const local = memoryStore();
    const other = memoryStore();
    plantFinding(local, finding('bug', FIRST_REF), 'store-a');
    plantFinding(other, finding('bug'), 'store-a');

    const result = merge(local, other);

    expect(entryFor(result, 'findings')).toEqual({ table: 'findings', skipped: [1], filled: [], conflicts: [] });
    expect(trackerRefsOf(local)).toEqual([FIRST_REF]);
    expect(conflictsOf(local)).toEqual([]);
  });

  it('comes to the same value whichever of the two stores runs the merge', () => {
    const [aFirst, bFirst, aSecond, bSecond] = [memoryStore(), memoryStore(), memoryStore(), memoryStore()];
    for (const [a, b] of [[aFirst, bFirst], [aSecond, bSecond]] as const) {
      plantFinding(a, finding('bug'), null);
      plantFinding(b, finding('bug', FIRST_REF), null);
    }

    merge(aFirst, bFirst);
    merge(bSecond, aSecond);

    expect(trackerRefsOf(aFirst)).toEqual([FIRST_REF]);
    expect(trackerRefsOf(bSecond)).toEqual([FIRST_REF]);
  });

  it('keeps both of two different filled values, the one here in its row and the incoming one recorded under the field', () => {
    const local = memoryStore();
    const other = memoryStore();
    plantFinding(local, finding('bug', FIRST_REF), null);
    plantFinding(other, finding('bug', SECOND_REF), 'store-b');
    const incoming = findingsOf(other)[0];

    const result = merge(local, other);

    expect(entryFor(result, 'findings')).toEqual({
      table: 'findings', skipped: [], filled: [], conflicts: [{ localSeq: 1, incomingSeq: 1, field: 'tracker_ref' }],
    });
    expect(trackerRefsOf(local)).toEqual([FIRST_REF]);
    expect(conflictsOf(local)).toEqual([{
      merge_id: 'merge-1', table_name: 'findings', local_seq: 1, field: 'tracker_ref', incoming,
      recorded_at: '2026-09-29T12:00:00.000Z',
    }]);
    expect(conflictsOf(local)[0]?.incoming.tracker_ref).toBe(SECOND_REF);
  });
});

describe('one identity holding different content', () => {
  it('records the pair one origin pair matched, as a cloned disk leaves it, with field NULL and both rows kept', () => {
    const local = memoryStore();
    const other = memoryStore();
    plantFinding(local, finding('here'), 'store-cloned');
    plantFinding(other, finding('there'), 'store-cloned');
    const before = findingsOf(local);
    const incoming = findingsOf(other)[0];

    const result = merge(local, other);

    expect(entryFor(result, 'findings')).toEqual({
      table: 'findings', skipped: [], filled: [], conflicts: [{ localSeq: 1, incomingSeq: 1, field: null }],
    });
    expect(findingsOf(local)).toEqual(before);
    expect(conflictsOf(local)).toEqual([{
      merge_id: 'merge-1', table_name: 'findings', local_seq: 1, field: null, incoming,
      recorded_at: '2026-09-29T12:00:00.000Z',
    }]);
    expect(conflictsOf(local)[0]?.incoming.id).toBe('id-there');
  });

  it('records the pair one UUID matched with different content, field NULL, and fills no edited field of it', () => {
    const local = memoryStore();
    const other = memoryStore();
    plantFinding(local, finding('bug'), null);
    plantFinding(other, { ...finding('bug', FIRST_REF), trigger: 'when told otherwise' }, 'store-b');
    const before = findingsOf(local);

    const result = merge(local, other);

    expect(entryFor(result, 'findings').conflicts).toEqual([{ localSeq: 1, incomingSeq: 1, field: null }]);
    expect(entryFor(result, 'findings').filled).toEqual([]);
    expect(findingsOf(local)).toEqual(before);
    expect(conflictsOf(local).map(({ incoming }) => [incoming.trigger, incoming.tracker_ref]))
      .toEqual([['when told otherwise', FIRST_REF]]);
  });

  it('goes on to the next pair after a conflict, and settles the other tables\' pairs as well', () => {
    const local = memoryStore();
    const other = memoryStore();
    plantFinding(local, finding('clash'), 'store-a');
    plantFinding(local, finding('fill'), 'store-a');
    plantFinding(other, { ...finding('clash'), outcome: 'blocked' }, 'store-a');
    plantFinding(other, finding('fill', FIRST_REF), 'store-a');
    for (const db of [local, other]) {
      db.run('INSERT INTO commits (seq, origin_store, origin_seq, sha, row_json) VALUES (1, \'store-a\', 1, \'sha-1\', \'{}\')');
    }

    const result = merge(local, other);

    expect(entryFor(result, 'findings')).toEqual({
      table: 'findings',
      skipped: [2],
      filled: [{ localSeq: 2, field: 'tracker_ref' }],
      conflicts: [{ localSeq: 1, incomingSeq: 1, field: null }],
    });
    expect(entryFor(result, 'commits')).toEqual({ table: 'commits', skipped: [1], filled: [], conflicts: [] });
    expect(result.map(({ table }) => table)).toEqual(Object.keys(MERGE_RULES).filter((table) => MERGE_RULES[table]?.scope === 'merged'));
  });
});

describe('a recomputed field: one commit collected by two devices', () => {
  /** A commit's `row_json` holding `gap` and `branch`, as `JSON.stringify` of a `CommitStats` spells it. */
  function commitJson(gap: number | null, branch: string | null = 'main'): string {
    return JSON.stringify({
      sha: 'sha-1', timestamp: '2026-09-29T10:00:00+02:00', subject: 'feat: one', author: 'A', branch,
      filesChanged: 1, insertions: 2, deletions: 0, parentCount: 1, minutesSincePrevious: gap,
    });
  }

  /** Plants the commit `sha-1` into `db` under `origin` with `rowJson`. */
  function plantCommit(db: Database, origin: string, rowJson: string): void {
    db.query<unknown, [string, string]>('INSERT INTO commits (seq, origin_store, origin_seq, sha, row_json) VALUES (1, ?, 1, \'sha-1\', ?)')
      .run(origin, rowJson);
  }

  /** The `row_json` of every commit in `db`, in `seq` order. */
  function commitJsonOf(db: Database): string[] {
    return db
      .query<{ row_json: string }, []>('SELECT row_json FROM commits ORDER BY seq')
      .all()
      .map(({ row_json: json }) => json);
  }

  it('skips a pair that differs only in minutesSincePrevious, keeping the gap here', () => {
    const local = memoryStore();
    const other = memoryStore();
    plantCommit(local, 'store-a', commitJson(12.5));
    plantCommit(other, 'store-b', commitJson(null));

    const result = merge(local, other);

    expect(entryFor(result, 'commits')).toEqual({ table: 'commits', skipped: [1], filled: [], conflicts: [] });
    expect(commitJsonOf(local)).toEqual([commitJson(12.5)]);
    expect(conflictsOf(local)).toEqual([]);
  });

  it('records a pair that differs outside the gap, field NULL, both rows kept (control)', () => {
    const local = memoryStore();
    const other = memoryStore();
    plantCommit(local, 'store-a', commitJson(12.5));
    plantCommit(other, 'store-b', commitJson(null, 'feat/other'));

    const result = merge(local, other);

    expect(entryFor(result, 'commits').conflicts).toEqual([{ localSeq: 1, incomingSeq: 1, field: null }]);
    expect(commitJsonOf(local)).toEqual([commitJson(12.5)]);
    expect(conflictsOf(local).map(({ table_name: table, field, incoming }) => [table, field, incoming.row_json]))
      .toEqual([['commits', null, commitJson(null, 'feat/other')]]);
  });
});

describe('a recomputed field: one session held with its log path in two forms', () => {
  /** The stored form of the session's log path, `<folder>/<file>`. */
  const RELATIVE_PATH = '-home-u-repo/session-1.jsonl';

  /** A session's `row_json` holding `filePath` and `model`, as `JSON.stringify` of a `SessionStats` spells it. */
  function sessionJson(filePath: string, model = 'claude-opus'): string {
    return JSON.stringify({
      sessionId: 'session-1', filePath, model, startedAt: '2026-09-29T10:00:00.000Z',
      endedAt: '2026-09-29T10:30:00.000Z', inputTokens: 10, outputTokens: 20,
    });
  }

  /** Plants the session `session-1` into `db` under `origin` with `rowJson`. */
  function plantSession(db: Database, origin: string, rowJson: string): void {
    db.query<unknown, [string, string]>(
      'INSERT INTO sessions (seq, origin_store, origin_seq, session_id, row_json) VALUES (1, ?, 1, \'session-1\', ?)',
    ).run(origin, rowJson);
  }

  /** The `row_json` of every session in `db`, in `seq` order. */
  function sessionJsonOf(db: Database): string[] {
    return db
      .query<{ row_json: string }, []>('SELECT row_json FROM sessions ORDER BY seq')
      .all()
      .map(({ row_json: json }) => json);
  }

  it('skips a pair that differs only in the form of filePath, keeping the row here', () => {
    const local = memoryStore();
    const other = memoryStore();
    plantSession(local, 'store-a', sessionJson(`/home/u/.claude/projects/${RELATIVE_PATH}`));
    plantSession(other, 'store-b', sessionJson(RELATIVE_PATH));

    const result = merge(local, other);

    expect(entryFor(result, 'sessions')).toEqual({ table: 'sessions', skipped: [1], filled: [], conflicts: [] });
    expect(sessionJsonOf(local)).toEqual([sessionJson(`/home/u/.claude/projects/${RELATIVE_PATH}`)]);
    expect(conflictsOf(local)).toEqual([]);
  });

  it('skips a pair whose two absolute paths name two homes, a Linux and a macOS one', () => {
    const local = memoryStore();
    const other = memoryStore();
    plantSession(local, 'store-a', sessionJson(RELATIVE_PATH));
    plantSession(other, 'store-b', sessionJson(`/Users/u/.claude/projects/${RELATIVE_PATH}`));

    const result = merge(local, other);

    expect(entryFor(result, 'sessions')).toEqual({ table: 'sessions', skipped: [1], filled: [], conflicts: [] });
    expect(sessionJsonOf(local)).toEqual([sessionJson(RELATIVE_PATH)]);
    expect(conflictsOf(local)).toEqual([]);
  });

  it('records a pair that differs in another row_json key, field NULL, both rows kept (control)', () => {
    const local = memoryStore();
    const other = memoryStore();
    plantSession(local, 'store-a', sessionJson(`/home/u/.claude/projects/${RELATIVE_PATH}`));
    plantSession(other, 'store-b', sessionJson(RELATIVE_PATH, 'claude-sonnet'));

    const result = merge(local, other);

    expect(entryFor(result, 'sessions').conflicts).toEqual([{ localSeq: 1, incomingSeq: 1, field: null }]);
    expect(sessionJsonOf(local)).toEqual([sessionJson(`/home/u/.claude/projects/${RELATIVE_PATH}`)]);
    expect(conflictsOf(local).map(({ table_name: table, field, incoming }) => [table, field, incoming.row_json]))
      .toEqual([['sessions', null, sessionJson(RELATIVE_PATH, 'claude-sonnet')]]);
  });

  it('records a pair whose two paths name two different logs, field NULL (control)', () => {
    const local = memoryStore();
    const other = memoryStore();
    plantSession(local, 'store-a', sessionJson(`/home/u/.claude/projects/${RELATIVE_PATH}`));
    plantSession(other, 'store-b', sessionJson('-home-u-other/session-1.jsonl'));

    const result = merge(local, other);

    expect(entryFor(result, 'sessions').conflicts).toEqual([{ localSeq: 1, incomingSeq: 1, field: null }]);
    expect(sessionJsonOf(local)).toEqual([sessionJson(`/home/u/.claude/projects/${RELATIVE_PATH}`)]);
  });
});

describe('what the settling refuses', () => {
  it('rolls back every fill and conflict when a matched row is missing from the other store', () => {
    const local = memoryStore();
    const other = memoryStore();
    plantFinding(local, finding('bug'), 'store-a');
    plantFinding(other, finding('bug', FIRST_REF), 'store-a');
    const unions = unionStores(local, other);
    other.run('DELETE FROM findings');

    expect(() => settleMatches(local, other, unions, TRAIL))
      .toThrow('the union matched findings row 1 in the other store, which that store does not hold');
    expect(trackerRefsOf(local)).toEqual([null]);
    expect(conflictsOf(local)).toEqual([]);
  });

  it('has a fill statement for every set-once field in MERGE_RULES, each naming its table and column', () => {
    const setOnce = Object.entries(MERGE_RULES).flatMap(([table, rule]) => rule.scope === 'merged'
      ? Object.entries(rule.edited)
        .filter(([, edit]) => edit === SET_ONCE)
        .map(([field]) => `${table}.${field}`)
      : []);

    expect(Object.keys(SET_ONCE_FILLS).sort()).toEqual(setOnce.sort());
    for (const key of setOnce) {
      const [table, field] = key.split('.');
      expect(SET_ONCE_FILLS[key]).toStartWith(`UPDATE ${table} SET ${field} = ?`);
    }
  });

  it('has a comparison for every recomputed field in MERGE_RULES', () => {
    const recomputed = Object.entries(MERGE_RULES).flatMap(([table, rule]) => rule.scope === 'merged'
      ? Object.entries(rule.edited)
        .filter(([, edit]) => edit === RECOMPUTED)
        .map(([field]) => `${table}.${field}`)
      : []);

    expect(recomputed).toEqual(['sessions.row_json', 'commits.row_json']);
    expect(Object.keys(RECOMPUTED_COMPARISONS).sort()).toEqual(recomputed.sort());
  });
});

/** The migration id a planted listing names: one no real catalogue holds. */
const LACKED = 'scratch-lacked-columns';

/** Lists the `table` row under `origin_store`/`origin_seq` in `held_rows` of `db`, as a projected merge does. */
function listHeld(db: Database, table: string, originStore: string, originSeq: number): void {
  db.query<unknown, [string, string, number, string]>(
    'INSERT INTO held_rows (table_name, origin_store, origin_seq, missing) VALUES (?, ?, ?, ?)',
  ).run(table, originStore, originSeq, JSON.stringify([LACKED]));
}

/** Every listing of `db`'s `held_rows`, as `<table> <origin_store>/<origin_seq>`, sorted. */
function listingsOf(db: Database): string[] {
  return db
    .query<{ listing: string }, []>('SELECT table_name || \' \' || origin_store || \'/\' || origin_seq AS listing FROM held_rows')
    .all()
    .map(({ listing }) => listing)
    .sort();
}

/** The full finding for `key` the other store holds: the columns the held copy lacked, filled. */
function wholeFinding(key: string, trackerRef: string | null = null): FindingRow {
  return { ...finding(key, trackerRef), cause: `the cause of ${key}`, resolution: `the fix for ${key}` };
}

/** Unions `other` into `local`, takes the held copies, then settles what matched, as `mergeStore` runs them. */
function mergeHeld(local: Database, other: Database): { copies: HeldCopy[]; settled: TableSettlement[] } {
  const unions = unionStores(local, other);
  const copies = takeHeldCopies(local, other, unions);
  return { copies, settled: settleMatches(local, other, unions, TRAIL) };
}

/** The held-copy step's entry for `table`. */
function copyFor(copies: readonly HeldCopy[], table: string): HeldCopy {
  const entry = copies.find((copy) => copy.table === table);
  if (entry === undefined) throw new Error(`no held-copy entry for ${table}`);
  return entry;
}

/** A finding as `findingsOf` reads it, from `row` under `seq` and the pair `originStore`/`seq`. */
function storedFinding(db: Database, seq: number, originStore: string, row: FindingRow): ReadRow {
  const columns = db
    .query<{ name: string }, []>('PRAGMA table_info(findings)')
    .all()
    .map(({ name }) => name);
  const stored: Record<string, SQLQueryBindings> = { ...row, seq, origin_store: originStore, origin_seq: seq };
  return Object.fromEntries(columns.map((column) => [column, stored[column] ?? null]));
}

describe('a held copy, taken whole before the comparison', () => {
  it('takes the incoming row whole for a listed row, drops the listing and records no conflict', () => {
    const local = memoryStore();
    const other = memoryStore();
    plantFinding(local, finding('held'), 'store-a');
    listHeld(local, 'findings', 'store-a', 1);
    plantFinding(other, wholeFinding('held'), 'store-a');

    const { copies, settled } = mergeHeld(local, other);

    expect(copyFor(copies, 'findings')).toEqual({ table: 'findings', taken: [1], refused: [] });
    expect(findingsOf(local)).toEqual([storedFinding(local, 1, 'store-a', wholeFinding('held'))]);
    expect(entryFor(settled, 'findings')).toEqual({ table: 'findings', skipped: [1], filled: [], conflicts: [] });
    expect(listingsOf(local)).toEqual([]);
    expect(conflictsOf(local)).toEqual([]);
  });

  it('records the same pair as a conflict, field NULL, when its row is not listed (control)', () => {
    const local = memoryStore();
    const other = memoryStore();
    plantFinding(local, finding('held'), 'store-a');
    plantFinding(other, wholeFinding('held'), 'store-a');
    const before = findingsOf(local);

    const { copies, settled } = mergeHeld(local, other);

    expect(copyFor(copies, 'findings')).toEqual({ table: 'findings', taken: [], refused: [] });
    expect(findingsOf(local)).toEqual(before);
    expect(entryFor(settled, 'findings').conflicts).toEqual([{ localSeq: 1, incomingSeq: 1, field: null }]);
    expect(conflictsOf(local)).toHaveLength(1);
  });

  it('keeps a tracker_ref set here while the row was held against NULL there, and takes the rest whole', () => {
    const local = memoryStore();
    const other = memoryStore();
    plantFinding(local, finding('held', FIRST_REF), 'store-a');
    listHeld(local, 'findings', 'store-a', 1);
    plantFinding(other, wholeFinding('held'), 'store-a');

    const { copies, settled } = mergeHeld(local, other);

    expect(copyFor(copies, 'findings').taken).toEqual([1]);
    expect(findingsOf(local)).toEqual([storedFinding(local, 1, 'store-a', wholeFinding('held', FIRST_REF))]);
    expect(entryFor(settled, 'findings')).toEqual({ table: 'findings', skipped: [1], filled: [], conflicts: [] });
    expect(listingsOf(local)).toEqual([]);
    expect(conflictsOf(local)).toEqual([]);
  });

  it('fills a tracker_ref NULL here from the incoming row by its set-once rule', () => {
    const local = memoryStore();
    const other = memoryStore();
    plantFinding(local, finding('held'), 'store-a');
    listHeld(local, 'findings', 'store-a', 1);
    plantFinding(other, wholeFinding('held', FIRST_REF), 'store-a');

    const { settled } = mergeHeld(local, other);

    expect(findingsOf(local)).toEqual([storedFinding(local, 1, 'store-a', wholeFinding('held', FIRST_REF))]);
    expect(entryFor(settled, 'findings')).toEqual({
      table: 'findings', skipped: [1], filled: [{ localSeq: 1, field: 'tracker_ref' }], conflicts: [],
    });
    expect(conflictsOf(local)).toEqual([]);
  });

  it('keeps the tracker_ref here against a different one there and records that field alone, as set-once does', () => {
    const local = memoryStore();
    const other = memoryStore();
    plantFinding(local, finding('held', FIRST_REF), 'store-a');
    listHeld(local, 'findings', 'store-a', 1);
    plantFinding(other, wholeFinding('held', SECOND_REF), 'store-a');

    const { settled } = mergeHeld(local, other);

    expect(findingsOf(local)).toEqual([storedFinding(local, 1, 'store-a', wholeFinding('held', FIRST_REF))]);
    expect(entryFor(settled, 'findings').conflicts).toEqual([{ localSeq: 1, incomingSeq: 1, field: 'tracker_ref' }]);
    expect(conflictsOf(local).map(({ field, incoming }) => [field, incoming.tracker_ref])).toEqual([['tracker_ref', SECOND_REF]]);
    expect(listingsOf(local)).toEqual([]);
  });

  it('keeps the seq and origin pair here when the incoming row matched by its UUID under another pair', () => {
    const local = memoryStore();
    const other = memoryStore();
    plantFinding(local, finding('first'), 'store-a');
    plantFinding(local, finding('held'), 'store-a');
    listHeld(local, 'findings', 'store-a', 2);
    plantFinding(other, wholeFinding('held'), 'store-b');

    const { copies } = mergeHeld(local, other);

    expect(copyFor(copies, 'findings').taken).toEqual([2]);
    expect(findingsOf(local)[1]).toEqual(storedFinding(local, 2, 'store-a', wholeFinding('held')));
    expect(listingsOf(local)).toEqual([]);
  });

  it('leaves a listing whose row the other store does not hold, and every unlisted pair, as they were', () => {
    const local = memoryStore();
    const other = memoryStore();
    plantFinding(local, finding('held'), 'store-a');
    plantFinding(local, finding('waiting'), 'store-a');
    plantFinding(local, finding('fill'), 'store-a');
    listHeld(local, 'findings', 'store-a', 1);
    listHeld(local, 'findings', 'store-a', 2);
    plantFinding(other, finding('fill', FIRST_REF), 'store-b');
    const waiting = findingsOf(local)[1];

    const { copies, settled } = mergeHeld(local, other);

    expect(copyFor(copies, 'findings')).toEqual({ table: 'findings', taken: [], refused: [] });
    expect(findingsOf(local)[1]).toEqual(waiting);
    expect(listingsOf(local)).toEqual(['findings store-a/1', 'findings store-a/2']);
    expect(entryFor(settled, 'findings').filled).toEqual([{ localSeq: 3, field: 'tracker_ref' }]);
  });

  it('rolls the rewrite back, keeping the row here and its listing, when the incoming row collides on another key', () => {
    const local = memoryStore();
    const other = memoryStore();
    plantFinding(local, finding('held'), 'store-a');
    plantFinding(local, { ...finding('neighbour'), session_id: 'session-held', artifact: 'artifact-moved' }, 'store-c');
    listHeld(local, 'findings', 'store-a', 1);
    plantFinding(other, { ...wholeFinding('held'), artifact: 'artifact-moved' }, 'store-a');
    const before = findingsOf(local);

    const { copies, settled } = mergeHeld(local, other);

    expect(copyFor(copies, 'findings')).toEqual({ table: 'findings', taken: [], refused: [1] });
    expect(findingsOf(local)).toEqual(before);
    expect(listingsOf(local)).toEqual(['findings store-a/1']);
    expect(entryFor(settled, 'findings').conflicts).toEqual([{ localSeq: 1, incomingSeq: 1, field: null }]);
  });

  it('takes a listed row of a table with no set-once field whole, row_json included', () => {
    const local = memoryStore();
    const other = memoryStore();
    local.run('INSERT INTO commits (seq, origin_store, origin_seq, sha, row_json) VALUES (1, \'store-a\', 1, \'sha-1\', \'{"sha":"sha-1"}\')');
    other.run('INSERT INTO commits (seq, origin_store, origin_seq, sha, row_json) VALUES (1, \'store-a\', 1, \'sha-1\', \'{"sha":"sha-1","insertions":2}\')');
    listHeld(local, 'commits', 'store-a', 1);

    const { copies, settled } = mergeHeld(local, other);

    expect(copyFor(copies, 'commits').taken).toEqual([1]);
    expect(local.query<{ row_json: string }, []>('SELECT row_json FROM commits').all()).toEqual([{ row_json: '{"sha":"sha-1","insertions":2}' }]);
    expect(entryFor(settled, 'commits')).toEqual({ table: 'commits', skipped: [1], filled: [], conflicts: [] });
    expect(conflictsOf(local)).toEqual([]);
  });

  it('takes no copy for a table named as cut, leaving its listing and comparing the pair as any other', () => {
    const local = memoryStore();
    const other = memoryStore();
    plantFinding(local, finding('held'), 'store-a');
    listHeld(local, 'findings', 'store-a', 1);
    plantFinding(other, finding('held'), 'store-a');
    const before = findingsOf(local);
    const unions = unionStores(local, other);

    const copies = takeHeldCopies(local, other, unions, new Set(['findings']));

    expect(copyFor(copies, 'findings')).toEqual({ table: 'findings', taken: [], refused: [] });
    expect(findingsOf(local)).toEqual(before);
    expect(listingsOf(local)).toEqual(['findings store-a/1']);
    expect(entryFor(settleMatches(local, other, unions, TRAIL), 'findings').skipped).toEqual([1]);
  });

  it('answers an empty entry per table, reading nothing, for a store whose schema predates held_rows', () => {
    const local = new Database(':memory:');
    opened.push(local);
    for (const { id, sql } of SQLITE_MIGRATIONS) if (id !== 'held-rows') local.run(sql);
    const other = memoryStore();
    plantFinding(local, finding('old'), 'store-a');
    plantFinding(other, wholeFinding('old'), 'store-a');
    const unions = unionStores(local, other);

    const copies = takeHeldCopies(local, other, unions);

    expect(copies).toEqual(unions.map(({ table }) => ({ table, taken: [], refused: [] })));
    expect(local.query('SELECT name FROM sqlite_master WHERE name = \'held_rows\'').all()).toEqual([]);
  });
});

/** The directory the file stores of `readConflictedRows` live in. */
const scope = mkdtempSync(join(tmpdir(), 'rafa-merge-conflicts-'));
afterAll(() => {
  rmSync(scope, { recursive: true, force: true });
});

/** A store file `name` under {@link scope}, brought through every migration, planted by `plant`, then closed. */
function storeFile(name: string, plant: (db: Database) => void): string {
  const path = join(scope, `${name}.sqlite`);
  const db = new Database(path, { create: true });
  try {
    for (const { sql } of SQLITE_MIGRATIONS) db.run(sql);
    plant(db);
  } finally {
    db.close();
  }
  return path;
}

/** Records a conflict on `table`'s row `localSeq` straight into `merge_conflicts`. */
function recordConflict(db: Database, table: string, localSeq: number, field: string | null, mergeId = 'merge-1'): void {
  db.query<unknown, SQLQueryBindings[]>(
    'INSERT INTO merge_conflicts (merge_id, table_name, local_seq, field, incoming, recorded_at) VALUES (?, ?, ?, ?, ?, ?)',
  ).run(mergeId, table, localSeq, field, '{}', TRAIL.recordedAt);
}

/** The number of rows `merge_conflicts` holds in the store file at `path`. */
function conflictCount(path: string): number {
  const db = new Database(path, { readonly: true });
  try {
    return db.query<{ n: number }, []>('SELECT count(*) AS n FROM merge_conflicts').get()?.n ?? 0;
  } finally {
    db.close();
  }
}

/** A conflicted-rows map as plain entries, each set spread in its order. */
function entriesOf(rows: ReadonlyMap<string, ReadonlySet<number>>): [string, number[]][] {
  return [...rows].map(([table, seqs]) => [table, [...seqs]]);
}

describe('readConflictedRows', () => {
  it('answers an empty, frozen map for a store with no conflict recorded', () => {
    const path = storeFile('none', (db) => {
      plantFinding(db, finding('alone'), 'store-a');
    });

    const rows = readConflictedRows(path);

    expect(rows.size).toBe(0);
    expect(Object.isFrozen(rows)).toBe(true);
    expect(conflictCount(path)).toBe(0);
  });

  it('answers an empty map for a path with no file, and makes none', () => {
    const path = join(scope, 'absent.sqlite');

    expect(readConflictedRows(path).size).toBe(0);
    expect(existsSync(path)).toBe(false);
  });

  it('answers an empty map for a schema before merge_conflicts', () => {
    const path = join(scope, 'early.sqlite');
    const db = new Database(path, { create: true });
    db.run('CREATE TABLE findings (seq INTEGER PRIMARY KEY)');
    db.close();

    expect(readConflictedRows(path).size).toBe(0);
  });

  it('names the local row of the one conflict settleMatches recorded', () => {
    const path = storeFile('settled', (db) => {
      const other = memoryStore();
      plantFinding(db, finding('agree'), 'store-a');
      plantFinding(other, finding('agree'), 'store-a');
      plantFinding(db, finding('here'), 'store-cloned');
      plantFinding(other, finding('there'), 'store-cloned');
      const settled = settleMatches(db, other, unionStores(db, other), TRAIL);
      expect(entryFor(settled, 'findings').conflicts).toEqual([{ localSeq: 2, incomingSeq: 2, field: null }]);
    });

    const rows = readConflictedRows(path);

    expect(entriesOf(rows)).toEqual([['findings', [2]]]);
    expect(Object.isFrozen(rows.get('findings'))).toBe(true);
  });

  it('gives one entry for two fields of one row, recorded under two merges', () => {
    const path = storeFile('two-fields', (db) => {
      plantFinding(db, finding('twice'), 'store-a');
      recordConflict(db, 'findings', 1, 'tracker_ref');
      recordConflict(db, 'findings', 1, null, 'merge-2');
    });

    expect(conflictCount(path)).toBe(2);
    expect(entriesOf(readConflictedRows(path))).toEqual([['findings', [1]]]);
  });

  it('keys each table apart, in name order, its seqs ascending', () => {
    const path = storeFile('two-tables', (db) => {
      recordConflict(db, 'sessions', 7, null);
      recordConflict(db, 'findings', 4, null);
      recordConflict(db, 'findings', 2, 'tracker_ref');
      recordConflict(db, 'sessions', 3, null);
    });

    expect(entriesOf(readConflictedRows(path))).toEqual([['findings', [2, 4]], ['sessions', [3, 7]]]);
  });
});
