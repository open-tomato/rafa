/**
 * Tests for the SQLite backend of the effort store port.
 *
 * Every store sits under a fresh temporary repo root, so the suite
 * touches no `.ralph/` anywhere, and the disk is real rather than
 * mocked: the rules under test are properties of a file.
 *
 * The expectations are spelled HERE rather than read off the module:
 * the file's name and place, each table's name and key column, and the
 * SQL that inspects them. Every such reading, and every plant, goes
 * through `bun:sqlite` directly and never through the module, so a
 * backend that laid its store out wrongly fails instead of agreeing
 * with itself, and a planted store cannot share a fault with the code
 * that reads it back.
 *
 * Rows are planted by casting partial objects, as the port's suite and
 * the NDJSON backend's suite plant them, except for one fully typed row
 * of each kind carrying what a real row carries: nested counters, an
 * integer-like histogram key, nulls, a float and escaped text.
 *
 * The parity case replays one sequence of batches through this backend
 * and through the NDJSON one, and requires the same answers, the same
 * refusal, the same rows, and bodies whose text, joined in append
 * order, is the NDJSON file.
 *
 * Twenty-six module mutations were driven against this file and every
 * one reddened at least one case, with the unmutated module green
 * before them and restored byte-identical after: `INSERT OR IGNORE` for
 * the upsert form, the lone-surrogate refusal dropped, the keyless
 * refusal dropped, the refusal worded differently from the NDJSON
 * backend's, the directory made before the batch is checked or when
 * the store is opened, rows serialised inside the transaction, an empty
 * batch creating a store that does not exist, an empty batch leaving a
 * store that exists unopened (red only on the empty append past the
 * last version), `read` and `keys` each ordered by something other than
 * `seq`, `keys` opening an absent store with the create flag, `read`
 * skipping the existence check, the key columns swapped between kinds,
 * keys projected from the bodies instead of the key column, the key set
 * cached across calls, the file renamed, the last occurrence of a key
 * winning, the batch inserted outside a transaction, the version bump
 * dropped, the newer-version refusal dropped, `IF NOT EXISTS` in the
 * migration, one transaction per migration, reads skipping the
 * migration, a malformed body tolerated, and the schema accepting an
 * empty key.
 *
 * One compile-time claim was driven red against `check-types`, with
 * mutated copies of the port and of this module planted beside them
 * and moved out after: a third kind added to the port's row map and key
 * record compiled in the port and failed in this module's table record
 * (TS2741).
 */
import type {
  AppendResult,
  CommitEffortRow,
  EffortRowKind,
  SessionEffortRow,
} from './types.js';

import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { Database } from 'bun:sqlite';
import { afterAll, describe, expect, it } from 'bun:test';

import { openNdjsonStore } from './ndjson.js';
import {
  migrateSchema,
  openSqliteStore,
  SQLITE_MIGRATIONS,
  SQLITE_SCHEMA_VERSION,
} from './sqlite.js';

/** A session row carrying its key and one counter. The cast is the plant. */
function sessionRow(
  sessionId: string,
  assistantRecordCount = 1,
): SessionEffortRow {
  return { sessionId, assistantRecordCount } as unknown as SessionEffortRow;
}

/** A commit row carrying its key and one counter. The cast is the plant. */
function commitRow(sha: string, insertions = 1): CommitEffortRow {
  return { sha, insertions } as unknown as CommitEffortRow;
}

const S_A = sessionRow('aaaa-1111', 3);
const S_B = sessionRow('bbbb-2222', 7);
const S_C = sessionRow('cccc-3333', 1);
const C_A = commitRow('deadbeef', 4);
const C_B = commitRow('feedface', 9);

/** A session row as the collector writes one, every field present. */
const FULL_SESSION: SessionEffortRow = {
  sessionId: 'eeee-5555',
  filePath: '/logs/eeee-5555.jsonl',
  lineCount: 12,
  recordCount: 11,
  unparsedLineCount: 1,
  recordTypeCounts: { assistant: 6, user: 4, '2': 1 },
  assistantRecordCount: 6,
  firstTimestamp: '2026-09-11T08:00:00.1Z',
  lastTimestamp: '2026-09-11T08:30:00.125Z',
  gitBranchCounts: { 'feat/phase-0': 9 },
  entrypointCounts: { cli: 11 },
  effortCounts: { xhigh: 6 },
  sidechainRecordCount: 0,
  modelCounts: { 'claude-opus-4-1': 5, '<synthetic>': 1 },
  usage: {
    inputTokens: 1200,
    outputTokens: 340,
    cacheCreationInputTokens: 0,
    cacheReadInputTokens: 9007199254740991,
    ephemeral1hInputTokens: 0,
    ephemeral5mInputTokens: 0,
    webSearchRequests: 0,
    webFetchRequests: 0,
    thinkingTokens: 0,
  },
  kind: 'task',
  mode: 'local',
  branch: 'feat/phase-0',
  branchRecordCount: 9,
  distinctBranchCount: 1,
  branchType: 'feat',
  branchStub: 'phase-0',
  planStub: null,
  planStubMatch: 'none',
  issueIdentifier: null,
  taskText: 'Add "quoted" text,\na tab\t, a backslash \\, \u{e9} and \u{1F345}',
  enqueueRecordIndex: 0,
  sizeBytes: 4096,
  modifiedAt: '2026-09-11T08:30:01.000Z',
};

/** A commit row as the commit parser answers one. */
const FULL_COMMIT: CommitEffortRow = {
  sha: '0123456789abcdef0123456789abcdef01234567',
  timestamp: '2026-09-11T10:00:00+02:00',
  subject: 'feat: a subject with\ta tab',
  author: 'An Author',
  branch: null,
  filesChanged: 3,
  insertions: 10,
  deletions: 2,
  parentCount: 1,
  minutesSincePrevious: 12.345,
};

/** Each kind's key column, spelled here rather than read off the module. */
const KEY_COLUMNS: Readonly<Record<EffortRowKind, string>> = {
  sessions: 'session_id',
  commits: 'sha',
};

const tempBase = mkdtempSync(join(tmpdir(), 'rafa-sqlite-store-'));
let planted = 0;

afterAll(() => {
  rmSync(tempBase, { recursive: true, force: true });
});

/** A repo root of its own, not yet on disk, so no case sees another's. */
function freshRoot(name: string): string {
  planted += 1;
  return join(tempBase, `${planted}-${name}`);
}

/** Where the store lives under a root. */
function storeDir(root: string): string {
  return join(root, '.ralph', 'effort');
}

/** The one file every kind lives in under a root. */
function storeFile(root: string): string {
  return join(storeDir(root), 'effort.sqlite');
}

/** The store file's bytes, or null when nothing was ever written. */
function readRaw(root: string): Buffer | null {
  const path = storeFile(root);
  return existsSync(path)
    ? readFileSync(path)
    : null;
}

/** Runs one query against the store file, read-only, module uninvolved. */
function rawQuery<T>(root: string, sql: string, ...bindings: string[]): T[] {
  const db = new Database(storeFile(root), { readonly: true });
  try {
    return db.query<T, string[]>(sql).all(...bindings);
  } finally {
    db.close();
  }
}

/**
 * Runs SQL against the store file, creating the file and its directory
 * when absent, module uninvolved. Several statements may go at once.
 */
function rawExec(root: string, sql: string): void {
  mkdirSync(storeDir(root), { recursive: true });
  const db = new Database(storeFile(root));
  try {
    db.run(sql);
  } finally {
    db.close();
  }
}

/** Inserts one row by hand, bypassing every check the module makes. */
function rawInsert(
  root: string,
  kind: EffortRowKind,
  key: string | null,
  body: string,
): void {
  const db = new Database(storeFile(root), { readwrite: true, create: false });
  try {
    db.run(
      `INSERT INTO ${kind} (${KEY_COLUMNS[kind]}, row_json) VALUES (?, ?)`,
      [key, body],
    );
  } finally {
    db.close();
  }
}

/** The schema version the store file records. */
function versionOf(root: string): number | undefined {
  const [row] = rawQuery<{ user_version: number }>(root, 'PRAGMA user_version');
  return row?.user_version;
}

/** The tables the store file holds, by name. */
function tablesOf(root: string): string[] {
  const sql = 'SELECT name FROM sqlite_master WHERE type = ? ORDER BY name';
  return rawQuery<{ name: string }>(root, sql, 'table').map(({ name }) => name);
}

/** The bodies one kind's table holds, in append order. */
function bodiesOf(root: string, kind: EffortRowKind): string[] {
  const sql = `SELECT row_json AS body FROM ${kind} ORDER BY seq`;
  return rawQuery<{ body: string }>(root, sql).map(({ body }) => body);
}

/** An append's answer with its path left out, which differs by root. */
function answers(result: AppendResult): readonly [number, number] {
  return [result.appended, result.skipped];
}

/** The message a call throws. Fails the case when it throws nothing. */
function refusalOf(call: () => unknown): string {
  try {
    call();
  } catch (error) {
    return error instanceof Error
      ? error.message
      : String(error);
  }
  throw new Error('expected the call to throw');
}

describe('openSqliteStore layout', () => {
  it('keeps every kind in one file under .ralph/effort, alone', () => {
    const root = freshRoot('layout');
    const store = openSqliteStore(root);
    store.append('sessions', [S_A, S_B]);
    store.append('commits', [C_A]);

    expect(readdirSync(storeDir(root))).toEqual(['effort.sqlite']);
  });

  it('answers that one file as every kind\'s path, written or not', () => {
    const root = freshRoot('paths');
    const store = openSqliteStore(root);

    expect(store.path('sessions')).toBe(storeFile(root));
    expect(store.path('commits')).toBe(storeFile(root));
    expect(store.append('sessions', [S_A]).path).toBe(storeFile(root));
    expect(store.append('commits', []).path).toBe(storeFile(root));
  });

  it('holds one table per kind, keyed by its NDJSON rows\' key', () => {
    const root = freshRoot('tables');
    const store = openSqliteStore(root);
    store.append('sessions', [S_A, S_B]);
    store.append('commits', [C_A]);
    const columns = 'SELECT name FROM pragma_table_info(?) ORDER BY cid';

    expect(tablesOf(root))
      .toEqual(['blockers', 'commits', 'findings', 'out_of_scope_bugs', 'report_absences', 'sessions']);
    for (const [kind, keyColumn] of Object.entries(KEY_COLUMNS)) {
      expect(rawQuery<{ name: string }>(root, columns, kind))
        .toEqual([{ name: 'seq' }, { name: keyColumn }, { name: 'row_json' }]);
    }
    expect(rawQuery(root, 'SELECT session_id AS key FROM sessions'))
      .toEqual([{ key: 'aaaa-1111' }, { key: 'bbbb-2222' }]);
    expect(rawQuery(root, 'SELECT sha AS key FROM commits'))
      .toEqual([{ key: 'deadbeef' }]);
  });

  it('refuses a stored row with no key in the schema itself', () => {
    const root = freshRoot('schema-keys');
    openSqliteStore(root).append('sessions', [S_A]);

    expect(() => rawInsert(root, 'sessions', '', '{}'))
      .toThrow(/CHECK constraint failed/);
    expect(() => rawInsert(root, 'commits', null, '{}'))
      .toThrow(/NOT NULL constraint failed/);
    expect(() => rawInsert(root, 'sessions', 'aaaa-1111', '{}'))
      .toThrow(/UNIQUE constraint failed/);
  });

  it('stores each row as its JSON text, and reads it back whole', () => {
    const root = freshRoot('bodies');
    const store = openSqliteStore(root);
    store.append('sessions', [FULL_SESSION]);
    store.append('commits', [FULL_COMMIT]);

    expect(bodiesOf(root, 'sessions')).toEqual([JSON.stringify(FULL_SESSION)]);
    expect(bodiesOf(root, 'commits')).toEqual([JSON.stringify(FULL_COMMIT)]);
    expect(store.read('sessions')).toEqual([FULL_SESSION]);
    expect(store.read('commits')).toEqual([FULL_COMMIT]);
    expect(JSON.stringify(store.read('sessions')[0]))
      .toBe(JSON.stringify(FULL_SESSION));
  });

  it('touches nothing on disk when it is opened', () => {
    const root = freshRoot('open-only');
    openSqliteStore(root);

    expect(existsSync(root)).toBe(false);
  });
});

describe('keys and read', () => {
  it('keys each kind by its own key field, in append order', () => {
    const root = freshRoot('key-fields');
    const store = openSqliteStore(root);
    store.append('sessions', [S_B, S_A]);
    store.append('commits', [C_B, C_A]);

    expect([...store.keys('sessions')]).toEqual(['bbbb-2222', 'aaaa-1111']);
    expect([...store.keys('commits')]).toEqual(['feedface', 'deadbeef']);
  });

  it('never dedupes one kind against the other', () => {
    const root = freshRoot('kinds-apart');
    const store = openSqliteStore(root);
    store.append('sessions', [sessionRow('deadbeef')]);
    const result = store.append('commits', [commitRow('deadbeef')]);

    expect(result.appended).toBe(1);
    expect(store.read('commits')).toEqual([commitRow('deadbeef')]);
  });

  it('answers rows in the order they were appended', () => {
    const root = freshRoot('order');
    const store = openSqliteStore(root);
    store.append('sessions', [S_C]);
    store.append('sessions', [S_A, S_B]);

    expect(store.read('sessions')).toEqual([S_C, S_A, S_B]);
  });

  it('hands the caller a fresh set and a fresh array on every call', () => {
    const root = freshRoot('fresh');
    const store = openSqliteStore(root);
    store.append('sessions', [S_A]);
    const keys = store.keys('sessions');
    const rows = store.read('sessions');
    keys.delete('aaaa-1111');
    keys.add('zzzz-9999');
    rows.push(S_B);

    expect([...store.keys('sessions')]).toEqual(['aaaa-1111']);
    expect(store.read('sessions')).toEqual([S_A]);
  });

  it('answers the key column, which is the set append dedupes by', () => {
    const root = freshRoot('key-column');
    const store = openSqliteStore(root);
    store.append('sessions', [S_A]);
    rawInsert(root, 'sessions', 'zzzz-0000', JSON.stringify(S_B));

    expect([...store.keys('sessions')]).toEqual(['aaaa-1111', 'zzzz-0000']);
    expect(store.append('sessions', [sessionRow('zzzz-0000')]).appended)
      .toBe(0);
    expect(store.append('sessions', [S_B]).appended).toBe(1);
  });
});

describe('append', () => {
  it('adds nothing and changes no byte on a second identical append', () => {
    const root = freshRoot('rerun');
    const store = openSqliteStore(root);
    store.append('commits', [C_A, C_B]);
    const before = readRaw(root);
    const again = store.append('commits', [C_A, C_B]);

    expect(answers(again)).toEqual([0, 2]);
    expect(readRaw(root)).toEqual(before);
  });

  it('dedupes within the batch as well as against the disk', () => {
    const root = freshRoot('batch-and-disk');
    const store = openSqliteStore(root);
    store.append('sessions', [S_A]);
    const result = store.append('sessions', [S_B, S_A, S_B, S_C]);

    expect(answers(result)).toEqual([2, 2]);
    expect(store.read('sessions')).toEqual([S_A, S_B, S_C]);
  });

  it('keeps a key\'s first occurrence in the batch', () => {
    const root = freshRoot('first-wins');
    const store = openSqliteStore(root);
    store.append('sessions', [S_B, sessionRow('bbbb-2222', 99)]);

    expect(store.read('sessions')).toEqual([S_B]);
  });

  it('dedupes by the key, not by the row body', () => {
    const root = freshRoot('key-not-body');
    const store = openSqliteStore(root);
    store.append('sessions', [S_A]);
    store.append('commits', [C_A]);

    expect(store.append('sessions', [sessionRow('aaaa-1111', 99)]).appended)
      .toBe(0);
    expect(store.append('commits', [commitRow('deadbeef', 0)]).appended)
      .toBe(0);
    expect(store.read('sessions')).toEqual([S_A]);
    expect(store.read('commits')).toEqual([C_A]);
  });

  it('lands a batch whole or not at all', () => {
    const root = freshRoot('whole-or-none');
    const store = openSqliteStore(root);
    store.append('sessions', [S_A]);
    rawExec(root, `
      CREATE TRIGGER planted BEFORE INSERT ON sessions
      WHEN NEW.session_id = 'cccc-3333'
      BEGIN SELECT RAISE(ABORT, 'planted refusal'); END;
    `);
    const before = readRaw(root);

    expect(() => store.append('sessions', [S_B, S_C]))
      .toThrow(/planted refusal/);
    expect(store.read('sessions')).toEqual([S_A]);
    expect(readRaw(root)).toEqual(before);
  });

  it('absorbs a key conflict and nothing else', () => {
    const root = freshRoot('only-key-conflicts');
    rawExec(root, `
      CREATE TABLE sessions (
        seq INTEGER PRIMARY KEY,
        session_id TEXT NOT NULL UNIQUE,
        row_json TEXT NOT NULL CHECK (instr(row_json, 'refuse-me') = 0)
      );
      CREATE TABLE commits (
        seq INTEGER PRIMARY KEY,
        sha TEXT NOT NULL UNIQUE,
        row_json TEXT NOT NULL
      );
      PRAGMA user_version = 1;
    `);
    const store = openSqliteStore(root);
    const refusedByCheck = {
      sessionId: 'hhhh-8888',
      note: 'refuse-me',
    } as unknown as SessionEffortRow;

    expect(() => store.append('sessions', [S_A, refusedByCheck]))
      .toThrow(/CHECK constraint failed/);
    expect(store.read('sessions')).toEqual([]);
  });
});

describe('append refusals', () => {
  it('refuses the whole batch for a keyless row, bytes untouched', () => {
    const root = freshRoot('keyless');
    const store = openSqliteStore(root);
    store.append('sessions', [S_A]);
    const before = readRaw(root);

    expect(() => store.append('sessions', [S_B, sessionRow(''), S_C]))
      .toThrow('effort store: row 1 of 3 carries no key; batch refused');
    expect(readRaw(root)).toEqual(before);
  });

  it('leaves no file and no directory when it refuses on no store', () => {
    const root = freshRoot('keyless-fresh');
    const store = openSqliteStore(root);

    expect(() => store.append('commits', [C_A, commitRow('')]))
      .toThrow(/row 1 of 2 carries no key/);
    expect(existsSync(root)).toBe(false);
  });

  it('refuses a row appended under the other kind', () => {
    const root = freshRoot('wrong-kind');
    const store = openSqliteStore(root);
    const asSession = C_A as unknown as SessionEffortRow;
    const asCommit = S_A as unknown as CommitEffortRow;

    expect(() => store.append('sessions', [S_B, asSession]))
      .toThrow(/row 1 of 2 carries no key/);
    expect(() => store.append('commits', [asCommit]))
      .toThrow(/row 0 of 1 carries no key/);
    expect(existsSync(root)).toBe(false);
  });

  it.each([
    ['a high half before an ordinary character', 'ab\uD800cd'],
    ['a high half at the end', 'abc\uD800'],
    ['a low half with no high half', 'x\uDC00y'],
  ])('refuses a key holding %s, before opening anything', (_label, key) => {
    const root = freshRoot('lone-surrogate');
    const store = openSqliteStore(root);

    expect(() => store.append('sessions', [S_A, sessionRow(key)]))
      .toThrow(/row 1 of 2 carries a key with a lone UTF-16 surrogate/);
    expect(existsSync(root)).toBe(false);
  });

  it('stores a key holding a whole surrogate pair exactly', () => {
    const root = freshRoot('surrogate-pair');
    const store = openSqliteStore(root);
    const key = 'ab\u{10063}d';
    store.append('sessions', [sessionRow(key)]);

    expect([...store.keys('sessions')]).toEqual([key]);
    expect(store.read('sessions')).toEqual([sessionRow(key)]);
  });

  it('writes nothing when a row cannot be serialised', () => {
    const root = freshRoot('unserialisable');
    const store = openSqliteStore(root);
    const unserialisable = {
      sessionId: 'ffff-6666',
      sizeBytes: 1n,
    } as unknown as SessionEffortRow;

    expect(() => store.append('sessions', [S_A, unserialisable]))
      .toThrow(/BigInt/);
    expect(existsSync(root)).toBe(false);

    store.append('sessions', [S_B]);
    const before = readRaw(root);

    expect(() => store.append('sessions', [S_A, unserialisable]))
      .toThrow(/BigInt/);
    expect(readRaw(root)).toEqual(before);
  });
});

describe('schema versioning', () => {
  it('creates a store at the last version the history holds', () => {
    const root = freshRoot('fresh-version');
    openSqliteStore(root).append('sessions', [S_A]);

    expect(SQLITE_SCHEMA_VERSION).toBe(SQLITE_MIGRATIONS.length);
    expect(versionOf(root)).toBe(SQLITE_SCHEMA_VERSION);
  });

  it('reads a zero-byte file as an empty store and gives it the schema', () => {
    const root = freshRoot('zero-bytes');
    mkdirSync(storeDir(root), { recursive: true });
    writeFileSync(storeFile(root), '');
    const store = openSqliteStore(root);

    expect(store.keys('sessions').size).toBe(0);
    expect(versionOf(root)).toBe(SQLITE_SCHEMA_VERSION);
    expect(tablesOf(root))
      .toEqual(['blockers', 'commits', 'findings', 'out_of_scope_bugs', 'report_absences', 'sessions']);
    expect(store.append('sessions', [S_A]).appended).toBe(1);
  });

  const NEWER = SQLITE_SCHEMA_VERSION + 1;
  const NEWER_REFUSAL = `is at schema version ${NEWER}, past the`
    + ` ${SQLITE_SCHEMA_VERSION} this rafa knows`;

  it('refuses a store past the last version, touching nothing', () => {
    const root = freshRoot('newer');
    rawExec(root, `PRAGMA user_version = ${NEWER}`);
    const before = readRaw(root);
    const store = openSqliteStore(root);

    expect(() => store.append('sessions', [S_A])).toThrow(NEWER_REFUSAL);
    expect(() => store.keys('sessions')).toThrow(NEWER_REFUSAL);
    expect(() => store.read('commits')).toThrow(NEWER_REFUSAL);
    expect(readRaw(root)).toEqual(before);
  });

  it('refuses an empty append on a store past the last version, bytes untouched', () => {
    const root = freshRoot('newer-empty');
    rawExec(root, `PRAGMA user_version = ${NEWER}`);
    const before = readRaw(root);
    const store = openSqliteStore(root);

    expect(() => store.append('sessions', [])).toThrow(NEWER_REFUSAL);
    expect(() => store.append('commits', [])).toThrow(NEWER_REFUSAL);
    expect(readRaw(root)).toEqual(before);
  });

  it('refuses a version-0 file already holding a kind\'s table', () => {
    const root = freshRoot('foreign-table');
    rawExec(root, 'CREATE TABLE sessions (x)');
    const before = readRaw(root);

    expect(() => openSqliteStore(root).append('commits', [C_A]))
      .toThrow(/table sessions already exists/);
    expect(readRaw(root)).toEqual(before);
    expect(readdirSync(storeDir(root))).toEqual(['effort.sqlite']);
    expect(versionOf(root)).toBe(0);
  });

  it('changes no byte of a current store it only reads', () => {
    const root = freshRoot('read-only-calls');
    const store = openSqliteStore(root);
    store.append('sessions', [S_A]);
    const before = readRaw(root);
    store.keys('sessions');
    store.read('commits');

    expect(readRaw(root)).toEqual(before);
  });
});

describe('migrateSchema', () => {
  const HISTORY = [
    'CREATE TABLE a (x)',
    'CREATE TABLE b (x)',
    'CREATE TABLE c (x)',
  ];

  /** An in-memory database, set up by the SQL given. */
  function memoryDb(setup?: string): Database {
    const db = new Database(':memory:');
    if (setup !== undefined) db.run(setup);
    return db;
  }

  /** The version a database records. */
  function versionIn(db: Database): number | undefined {
    return db
      .query<{ user_version: number }, []>('PRAGMA user_version')
      .get()?.user_version;
  }

  /** The tables a database holds, by name. */
  function tablesIn(db: Database): string[] {
    return db
      .query<{ name: string }, [string]>(
        'SELECT name FROM sqlite_master WHERE type = ? ORDER BY name',
      )
      .all('table')
      .map(({ name }) => name);
  }

  it('applies every migration to a new database, recording the last', () => {
    const db = memoryDb();
    migrateSchema(db, 'memory', HISTORY);

    expect(tablesIn(db)).toEqual(['a', 'b', 'c']);
    expect(versionIn(db)).toBe(3);
    db.close();
  });

  it('applies only the migrations past the version it finds', () => {
    const db = memoryDb(
      'CREATE TABLE a (x); CREATE TABLE b (x); PRAGMA user_version = 2',
    );
    migrateSchema(db, 'memory', HISTORY);

    expect(tablesIn(db)).toEqual(['a', 'b', 'c']);
    expect(versionIn(db)).toBe(3);
    db.close();
  });

  it('leaves a database at the last version untouched', () => {
    const db = memoryDb('PRAGMA user_version = 3');
    migrateSchema(db, 'memory', HISTORY);

    expect(tablesIn(db)).toEqual([]);
    expect(versionIn(db)).toBe(3);
    db.close();
  });

  it('rolls every pending migration back when one fails', () => {
    const db = memoryDb();
    const broken = ['CREATE TABLE a (x)', 'CREATE TABLE b (', 'CREATE c'];

    expect(() => migrateSchema(db, 'memory', broken)).toThrow();
    expect(tablesIn(db)).toEqual([]);
    expect(versionIn(db)).toBe(0);
    db.close();
  });

  it('refuses a database past the last version, applying nothing', () => {
    const db = memoryDb('PRAGMA user_version = 4');

    expect(() => migrateSchema(db, 'memory', HISTORY))
      .toThrow('effort store: memory is at schema version 4, past the 3');
    expect(tablesIn(db)).toEqual([]);
    db.close();
  });
});

describe('absence and unreadability', () => {
  it('answers a store that does not exist as empty, creating nothing', () => {
    const root = freshRoot('absent');
    const store = openSqliteStore(root);

    for (const kind of ['sessions', 'commits'] as const) {
      expect(store.read(kind)).toEqual([]);
      expect(store.keys(kind).size).toBe(0);
      expect(store.append(kind, [])).toEqual({
        path: storeFile(root),
        appended: 0,
        skipped: 0,
      });
    }
    expect(existsSync(root)).toBe(false);
  });

  it('throws when a directory sits at the store\'s path', () => {
    const root = freshRoot('directory');
    mkdirSync(storeFile(root), { recursive: true });
    const store = openSqliteStore(root);

    expect(() => store.read('sessions')).toThrow(/unable to open database/);
    expect(() => store.keys('commits')).toThrow(/unable to open database/);
    expect(() => store.append('sessions', [S_A]))
      .toThrow(/unable to open database/);
    expect(readdirSync(storeFile(root))).toEqual([]);
  });

  it('throws for a file that is not a database, leaving it untouched', () => {
    const root = freshRoot('not-a-database');
    const text = 'not a database, only text\n'.repeat(40);
    mkdirSync(storeDir(root), { recursive: true });
    writeFileSync(storeFile(root), text, 'utf8');
    const store = openSqliteStore(root);

    expect(() => store.read('sessions')).toThrow(/file is not a database/);
    expect(() => store.keys('sessions')).toThrow(/file is not a database/);
    expect(() => store.append('sessions', [S_A]))
      .toThrow(/file is not a database/);
    expect(readFileSync(storeFile(root), 'utf8')).toBe(text);
  });

  it.each([
    ['an array', '[1, 2]'],
    ['a scalar', '42'],
    ['malformed JSON', '{"sessionId":'],
  ])('throws on a stored body that is %s, naming its row', (_label, body) => {
    const root = freshRoot('bad-body');
    const store = openSqliteStore(root);
    store.append('sessions', [S_A]);
    rawInsert(root, 'sessions', 'gggg-7777', body);

    expect(() => store.read('sessions'))
      .toThrow(/sessions row 2 does not hold a JSON object/);
    expect([...store.keys('sessions')]).toEqual(['aaaa-1111', 'gggg-7777']);
  });
});

describe('parity with the NDJSON backend', () => {
  it('answers the same and stores the same text, batch for batch', () => {
    const ours = freshRoot('parity-sqlite');
    const theirs = freshRoot('parity-ndjson');
    const store = openSqliteStore(ours);
    const ndjson = openNdjsonStore(theirs);
    const keyless = [S_C, sessionRow('')];

    for (const batch of [[S_B, S_A], [S_C, S_C, S_B], [], [S_A, FULL_SESSION]]) {
      expect(answers(store.append('sessions', batch)))
        .toEqual(answers(ndjson.append('sessions', batch)));
    }
    for (const batch of [[C_A, C_B, C_A], [C_B], [], [FULL_COMMIT]]) {
      expect(answers(store.append('commits', batch)))
        .toEqual(answers(ndjson.append('commits', batch)));
    }
    expect(() => store.append('sessions', keyless))
      .toThrow(refusalOf(() => ndjson.append('sessions', keyless)));

    for (const kind of ['sessions', 'commits'] as const) {
      const lines = bodiesOf(ours, kind).map((body) => `${body}\n`);

      expect([...store.keys(kind)]).toEqual([...ndjson.keys(kind)]);
      expect(store.read(kind)).toEqual(ndjson.read(kind));
      expect(lines.join('')).toBe(readFileSync(ndjson.path(kind), 'utf8'));
    }
  });
});
