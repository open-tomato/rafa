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
 */
import type { TableSettlement } from './merge-conflicts.js';
import type { SQLQueryBindings } from 'bun:sqlite';

import { Database } from 'bun:sqlite';
import { afterEach, describe, expect, it } from 'bun:test';

import { SET_ONCE_FILLS, settleMatches } from './merge-conflicts.js';
import { MERGE_RULES, SET_ONCE } from './merge-rules.js';
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
});
