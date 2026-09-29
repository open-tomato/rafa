/**
 * `unionStores` over two in-memory stores, each built by running every
 * entry of `SQLITE_MIGRATIONS` on a `:memory:` connection, so no file is
 * made anywhere.
 *
 * Rows are planted with a column list naming `seq`, `origin_store` and
 * `origin_seq` as a stamped production insert fills them: the next `seq`
 * and, under an origin, that same `seq` as `origin_seq`, or NULL in both
 * as a runtime before `row-origins` writes. A planted row's other
 * columns come from its table's fixture and a key, so two rows of one
 * key share every identity and every UNIQUE key of the table, and two of
 * different keys share none.
 */
import type { TableUnion } from './merge-union.js';
import type { OriginTable } from './origins.js';
import type { SQLQueryBindings } from 'bun:sqlite';

import { Database } from 'bun:sqlite';
import { afterEach, describe, expect, it } from 'bun:test';

import { unionStores, UnionSchemaMismatch } from './merge-union.js';
import { SQLITE_MIGRATIONS } from './migrations.js';
import { ORIGIN_TABLES } from './origins.js';

/** A planted row's columns other than `seq` and its origin pair. */
type FixtureRow = Readonly<Record<string, SQLQueryBindings>>;

/** When every row here was collected. */
const COLLECTED_AT = '2026-09-29T10:00:00.000Z';

/** The columns every report-derived table holds beside its own. */
function reportRow(key: string): FixtureRow {
  return { id: `id-${key}`, session_id: `session-${key}`, task_line: `task ${key}`, outcome: 'done', collected_at: COLLECTED_AT };
}

/** One valid row of each merged table for `key`. */
const FIXTURES: Readonly<Record<OriginTable, (key: string) => FixtureRow>> = {
  sessions: (key) => ({ session_id: `session-${key}`, row_json: `{"sessionId":"session-${key}"}` }),
  commits: (key) => ({ sha: `sha-${key}`, row_json: `{"sha":"sha-${key}"}` }),
  findings: (key) => ({ ...reportRow(key), kind: 'gotcha', artifact: `artifact-${key}`, signal: 'loud' }),
  blockers: (key) => ({ ...reportRow(key), what: `blocked on ${key}` }),
  out_of_scope_bugs: (key) => ({ ...reportRow(key), what: `bug ${key}`, security: 0 }),
  report_absences: (key) => ({ ...reportRow(key), reason: 'no-report', detail: `no block in ${key}` }),
  task_reports: (key) => ({ ...reportRow(key), status: 'done', skills_used: '[]' }),
  preflight: (key) => ({
    run_id: `run-${key}`, position: 0, tier: 'required', kind: 'command', item: `item ${key}`,
    outcome: 'pass', duration_ms: 5, collected_at: COLLECTED_AT,
  }),
  dispatches: (key) => ({ session_id: `session-${key}`, task_line: `task ${key}`, flags: '[]', collected_at: COLLECTED_AT }),
  changes: (key) => ({
    id: `id-${key}`, session_id: `session-${key}`, task_line: `task ${key}`, level: 'patch', summary: `change ${key}`,
    collected_at: COLLECTED_AT,
  }),
  skill_invocations: (key) => ({ session_id: `session-${key}`, name: 'bun-testing', sidechain: 0, count: 2 }),
  plan_ci: (key) => ({
    plan_stub: 'rafa-322', pr: 9, head_sha: `sha-${key}`, verdict: 'none', failing: '[]', read_at: COLLECTED_AT,
  }),
};

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

/**
 * Plants `row` into `table` under the next `seq`, stamped with `origin`
 * and that `seq` as a production insert stamps it, or NULL in both when
 * `origin` is null.
 */
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

/** Plants the fixture row of `key` into every merged table. */
function plantEverywhere(db: Database, key: string, origin: string | null): void {
  for (const table of ORIGIN_TABLES) plantRow(db, table, FIXTURES[table](key), origin);
}

/** One row read back: its `seq`, its origin pair, and every other column. */
interface ReadRow {
  readonly seq: number;
  readonly origin_store: string | null;
  readonly origin_seq: number | null;
  readonly [column: string]: SQLQueryBindings;
}

/** Every row of `table`, every column, in `seq` order. */
function rowsOf(db: Database, table: string): ReadRow[] {
  const columns = db
    .query<{ name: string }, []>(`PRAGMA table_info(${table})`)
    .all()
    .map(({ name }) => name);
  return db.query<ReadRow, []>(`SELECT ${columns.join(', ')} FROM ${table} ORDER BY seq`).all();
}

/** `seq` with its origin pair, for each row of `table`. */
function originsOf(db: Database, table: string): [number, string | null, number | null][] {
  return rowsOf(db, table).map((row) => [row.seq, row.origin_store, row.origin_seq]);
}

/** A row without its local `seq`: what the union must carry over unchanged. */
function withoutSeq(row: ReadRow): Record<string, SQLQueryBindings> {
  return Object.fromEntries(Object.entries(row).filter(([column]) => column !== 'seq'));
}

/** The union's entry for `table`. */
function entryFor(result: readonly TableUnion[], table: string): TableUnion {
  const entry = result.find((union) => union.table === table);
  if (entry === undefined) throw new Error(`no union entry for ${table}`);
  return entry;
}

/** Every table's rows, for a whole-store comparison. */
function dumpOf(db: Database): Record<string, ReadRow[]> {
  return Object.fromEntries(ORIGIN_TABLES.map((table) => [table, rowsOf(db, table)]));
}

describe('two disjoint stores', () => {
  it('inserts every row of the other store in every merged table, each under a new local seq with its origin pair and columns unchanged', () => {
    const local = memoryStore();
    const other = memoryStore();
    plantEverywhere(local, 'a1', 'store-a');
    plantEverywhere(other, 'b1', 'store-b');
    plantEverywhere(other, 'b2', 'store-b');

    const result = unionStores(local, other);

    expect(result.map(({ table }) => table)).toEqual([...ORIGIN_TABLES]);
    for (const table of ORIGIN_TABLES) {
      expect(entryFor(result, table)).toEqual({ table, added: [2, 3], matched: [], collided: [] });
      expect(originsOf(local, table)).toEqual([[1, 'store-a', 1], [2, 'store-b', 1], [3, 'store-b', 2]]);
      const copied = rowsOf(local, table).slice(1);
      expect(copied.map(withoutSeq)).toEqual(rowsOf(other, table).map(withoutSeq));
    }
  });

  it('leaves the other store as it was', () => {
    const local = memoryStore();
    const other = memoryStore();
    plantEverywhere(local, 'a1', 'store-a');
    plantEverywhere(other, 'b1', 'store-b');
    const before = dumpOf(other);

    unionStores(local, other);

    expect(dumpOf(other)).toEqual(before);
  });

  it('keeps NULL on an unmatched row that has no origin in the other store', () => {
    const local = memoryStore();
    const other = memoryStore();
    plantRow(local, 'findings', FIXTURES.findings('a1'), 'store-a');
    plantRow(other, 'findings', FIXTURES.findings('old'), null);

    const result = unionStores(local, other);

    expect(entryFor(result, 'findings').added).toEqual([2]);
    expect(originsOf(local, 'findings')).toEqual([[1, 'store-a', 1], [2, null, null]]);
  });
});

describe('a store copied from the other, then both moved on', () => {
  /** Two stores sharing `s1` and `s2` under `store-a`, then writing under an origin each. */
  function divergedStores(): { local: Database; other: Database } {
    const local = memoryStore();
    const other = memoryStore();
    for (const db of [local, other]) {
      plantEverywhere(db, 's1', 'store-a');
      plantEverywhere(db, 's2', 'store-a');
    }
    plantEverywhere(local, 'l3', 'store-l');
    plantEverywhere(other, 'o3', 'store-o');
    plantEverywhere(other, 'o4', 'store-o');
    return { local, other };
  }

  it('collapses the shared prefix to one copy, matched on its origin pairs, and adds what the other wrote after the copy', () => {
    const { local, other } = divergedStores();

    const result = unionStores(local, other);

    for (const table of ORIGIN_TABLES) {
      expect(entryFor(result, table)).toEqual({
        table,
        added: [4, 5],
        matched: [
          { localSeq: 1, incomingSeq: 1, by: 'origin' },
          { localSeq: 2, incomingSeq: 2, by: 'origin' },
        ],
        collided: [],
      });
      expect(originsOf(local, table)).toEqual([
        [1, 'store-a', 1], [2, 'store-a', 2], [3, 'store-l', 3], [4, 'store-o', 3], [5, 'store-o', 4],
      ]);
    }
  });

  it('adds nothing on a second run, and leaves every row as the first run left it', () => {
    const { local, other } = divergedStores();
    unionStores(local, other);
    const afterFirst = dumpOf(local);

    const second = unionStores(local, other);

    for (const table of ORIGIN_TABLES) {
      const entry = entryFor(second, table);
      expect(entry.added).toEqual([]);
      expect(entry.collided).toEqual([]);
      expect(entry.matched.map(({ localSeq, by }) => [localSeq, by])).toEqual([
        [1, 'origin'], [2, 'origin'], [4, 'origin'], [5, 'origin'],
      ]);
    }
    expect(dumpOf(local)).toEqual(afterFirst);
  });
});

describe('rows with a NULL origin, matched by identity', () => {
  it('matches a finding by its UUID whether the origin is NULL here, there, or on both sides', () => {
    const local = memoryStore();
    const other = memoryStore();
    plantRow(local, 'findings', FIXTURES.findings('both-null'), null);
    plantRow(local, 'findings', FIXTURES.findings('null-here'), null);
    plantRow(local, 'findings', FIXTURES.findings('null-there'), 'store-a');
    plantRow(other, 'findings', FIXTURES.findings('both-null'), null);
    plantRow(other, 'findings', FIXTURES.findings('null-here'), 'store-b');
    plantRow(other, 'findings', FIXTURES.findings('null-there'), null);

    const result = unionStores(local, other);

    expect(entryFor(result, 'findings')).toEqual({
      table: 'findings',
      added: [],
      matched: [
        { localSeq: 1, incomingSeq: 1, by: 'identity' },
        { localSeq: 2, incomingSeq: 2, by: 'identity' },
        { localSeq: 3, incomingSeq: 3, by: 'identity' },
      ],
      collided: [],
    });
    expect(originsOf(local, 'findings')).toEqual([[1, null, null], [2, null, null], [3, 'store-a', 3]]);
  });

  it('inserts a NULL-origin row of the same table whose UUID differs (control)', () => {
    const local = memoryStore();
    const other = memoryStore();
    plantRow(local, 'findings', FIXTURES.findings('kept'), null);
    plantRow(other, 'findings', FIXTURES.findings('another'), null);

    const result = unionStores(local, other);

    expect(entryFor(result, 'findings').added).toEqual([2]);
    expect(rowsOf(local, 'findings').map(({ id }) => id)).toEqual(['id-kept', 'id-another']);
  });

  it('matches by natural key: the session id, the sha, the run and position, and plan CI\'s pull request, head and reading time', () => {
    const local = memoryStore();
    const other = memoryStore();
    const tables = ['sessions', 'commits', 'dispatches', 'preflight', 'plan_ci'] as const;
    for (const table of tables) {
      plantRow(local, table, FIXTURES[table]('old'), null);
      plantRow(other, table, FIXTURES[table]('old'), 'store-b');
    }

    const result = unionStores(local, other);

    for (const table of tables) {
      expect(entryFor(result, table)).toEqual({
        table, added: [], matched: [{ localSeq: 1, incomingSeq: 1, by: 'identity' }], collided: [],
      });
    }
  });

  it('inserts a plan CI reading of the same pull request and head read at another time (control)', () => {
    const local = memoryStore();
    const other = memoryStore();
    plantRow(local, 'plan_ci', FIXTURES.plan_ci('head'), null);
    plantRow(other, 'plan_ci', { ...FIXTURES.plan_ci('head'), read_at: '2026-09-29T11:00:00.000Z' }, null);

    const result = unionStores(local, other);

    expect(entryFor(result, 'plan_ci').added).toEqual([2]);
  });

  it('counts two NULLs in an identity column as equal, as skill_invocations stores an unknown use', () => {
    const local = memoryStore();
    const other = memoryStore();
    const unknownUse = { session_id: 'session-old', name: null, sidechain: null, count: null };
    plantRow(local, 'skill_invocations', unknownUse, null);
    plantRow(other, 'skill_invocations', unknownUse, null);

    const result = unionStores(local, other);

    expect(entryFor(result, 'skill_invocations').matched).toEqual([{ localSeq: 1, incomingSeq: 1, by: 'identity' }]);
    expect(entryFor(result, 'skill_invocations').added).toEqual([]);
  });
});

describe('two rows under two different origin pairs', () => {
  it('matches one commit two devices collected by its sha, as the table holds each sha once', () => {
    const local = memoryStore();
    const other = memoryStore();
    plantRow(local, 'commits', FIXTURES.commits('pushed'), 'store-a');
    plantRow(other, 'commits', FIXTURES.commits('pushed'), 'store-b');

    const result = unionStores(local, other);

    expect(entryFor(result, 'commits').matched).toEqual([{ localSeq: 1, incomingSeq: 1, by: 'identity' }]);
    expect(originsOf(local, 'commits')).toEqual([[1, 'store-a', 1]]);
  });

  it('matches on the origin pair first, even where the two rows hold different identities', () => {
    const local = memoryStore();
    const other = memoryStore();
    plantRow(local, 'findings', FIXTURES.findings('here'), 'store-cloned');
    plantRow(other, 'findings', FIXTURES.findings('there'), 'store-cloned');

    const result = unionStores(local, other);

    expect(entryFor(result, 'findings').matched).toEqual([{ localSeq: 1, incomingSeq: 1, by: 'origin' }]);
    expect(rowsOf(local, 'findings').map(({ id }) => id)).toEqual(['id-here']);
  });
});

describe('an unmatched row the table refuses on another UNIQUE key', () => {
  it('is returned as a collision naming the key, inserted nowhere, and the union goes on with the next row', () => {
    const local = memoryStore();
    const other = memoryStore();
    plantRow(local, 'findings', FIXTURES.findings('report'), 'store-a');
    plantRow(other, 'findings', { ...FIXTURES.findings('report'), id: 'id-second-uuid' }, 'store-b');
    plantRow(other, 'findings', FIXTURES.findings('next'), 'store-b');

    const result = unionStores(local, other);

    expect(entryFor(result, 'findings')).toEqual({
      table: 'findings',
      added: [2],
      matched: [],
      collided: [{ incomingSeq: 1, reason: 'UNIQUE constraint failed: findings.session_id, findings.artifact' }],
    });
    expect(rowsOf(local, 'findings').map(({ id }) => id)).toEqual(['id-report', 'id-next']);
  });
});

describe('two stores holding different columns', () => {
  it('throws naming the column, having inserted nothing in any table', () => {
    const local = memoryStore();
    const other = memoryStore();
    plantEverywhere(other, 'b1', 'store-b');
    other.run('ALTER TABLE plan_ci ADD COLUMN newer TEXT');
    local.run('ALTER TABLE commits ADD COLUMN mine TEXT');

    expect(() => unionStores(local, other)).toThrow(new UnionSchemaMismatch(
      'the two stores hold different columns (commits.mine only here, plan_ci.newer only there);'
        + ' bring both to the same migrations first',
    ));
    for (const table of ORIGIN_TABLES) expect(rowsOf(local, table)).toEqual([]);
  });
});
