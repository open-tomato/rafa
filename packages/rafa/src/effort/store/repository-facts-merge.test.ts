/**
 * Repository facts across a merge: two stores that read one fact count
 * it once after `mergeStore`, answered through `readRepositoryFacts`.
 *
 * Every store is a real file under one temp directory, brought through
 * every migration and planted by raw SQL, stamped as a production insert
 * stamps a row (`seq` and `origin_seq` equal under the store's origin);
 * `store_meta` is planted by hand, since a store under the temp
 * directory outside a repository is never minted. The merge reads no
 * git and runs as an installed runtime.
 *
 * The negative cases come first: each says what a merge does NOT write
 * or keep twice. The positive ones follow, and the last case runs no
 * merge at all, the port of a project with no hub, whose own writer
 * folds its readings.
 */
import type { MergeOptions } from './merge-store.js';
import type { RuntimeIdentity } from '../../core/runtime/index.js';

import { mkdirSync, mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { Database } from 'bun:sqlite';
import { afterAll, describe, expect, it } from 'bun:test';

import { bringForward } from './bring-forward.js';
import { mergeStore } from './merge-store.js';
import { readPlanCiFacts, writePlanCi } from './plan-ci.js';
import { readingKey, readRepositoryFacts, writeSupersedes } from './repository-facts.js';

const scope = realpathSync(mkdtempSync(join(tmpdir(), 'rafa-repository-facts-merge-')));
afterAll(() => {
  rmSync(scope, { recursive: true, force: true });
});

const NOW = new Date('2026-11-09T12:00:00.000Z');
const INSTALLED: RuntimeIdentity = { kind: 'installed', entry: '/home/u/.rafa/runtime/0.24.1/cli.js' };

/** The two stores' origins: the port and the hub. */
const PORT = 'store-port';
const HUB = 'store-hub';
const PROJECT = 'root-commit-1';

/** Three reading times of one fact, oldest first. */
const T1 = '2026-11-08T10:00:00.000Z';
const T2 = '2026-11-08T11:00:00.000Z';
const T3 = '2026-11-08T12:00:00.000Z';

/** Where one case's two stores live. */
interface Case {
  readonly root: string;
  readonly path: string;
  readonly otherPath: string;
}

/** A fresh case: the port's store in a project, the hub's in a directory of its own. */
function freshCase(): Case {
  const dir = realpathSync(mkdtempSync(join(scope, 'case-')));
  const root = join(dir, 'project');
  return { root, path: join(root, '.rafa', 'effort', 'effort.sqlite'), otherPath: join(dir, 'hub', 'effort.sqlite') };
}

/** Runs `use` on the store at `path`, made and brought through every migration first. */
function withStore(path: string, use: (db: Database) => void): void {
  mkdirSync(dirname(path), { recursive: true });
  const db = new Database(path, { create: true, readwrite: true });
  try {
    bringForward(db, path, 'write', 'open', { identity: INSTALLED });
    use(db);
  } finally {
    db.close();
  }
}

/** The next `seq` of `table`. */
function nextSeq(db: Database, table: string): number {
  return (db.query<{ n: number }, []>(`SELECT COALESCE(MAX(seq), 0) + 1 AS n FROM ${table}`).get()?.n ?? 1);
}

/** Plants the `store_meta` row naming `storeId` of `PROJECT`. */
function plantMeta(db: Database, path: string, storeId: string): void {
  db.query(
    'INSERT INTO store_meta (id, store_id, project_root_commit, project_remote, host_id, store_path, file_dev, file_ino, minted_at)'
      + ' VALUES (1, ?, ?, NULL, \'host\', ?, 1, 1, ?)',
  ).run(storeId, PROJECT, path, T1);
}

/** Plants a red `plan_ci` reading of pr 7 on `sha-a` at `readAt` under `origin`. */
function plantReading(db: Database, origin: string, readAt: string): void {
  const seq = nextSeq(db, 'plan_ci');
  db.query('INSERT INTO plan_ci (seq, origin_store, origin_seq, plan_stub, pr, head_sha, verdict, failing, read_at)'
    + ' VALUES (?, ?, ?, \'phase-1\', 7, \'sha-a\', \'red\', \'["lint"]\', ?)')
    .run(seq, origin, seq, readAt);
}

/** The key of the reading of pr 7 on `sha-a` at `readAt`, as the module spells it. */
function keyAt(readAt: string): string {
  return readingKey('plan_ci', { pr: 7, head_sha: 'sha-a', read_at: readAt });
}

/** Plants the readings at `times` into the store at `path` under `origin`, as that store's meta names it. */
function plantStore(path: string, origin: string, times: readonly string[], supersedes = false): void {
  withStore(path, (db) => {
    plantMeta(db, path, origin);
    for (const time of times) plantReading(db, origin, time);
    if (supersedes) writeSupersedes(db, 'plan_ci', times.map(keyAt));
  });
}

/** The options of one run over `testCase`. */
function mergeOptions(testCase: Case): MergeOptions {
  return {
    path: testCase.path,
    otherPath: testCase.otherPath,
    backend: 'sqlite',
    dryRun: false,
    stamp: '20261109T120000Z',
    now: () => NOW,
    newMergeId: () => 'merge-1',
    readProject: () => ({ rootCommit: null, remote: null }),
    identity: INSTALLED,
    isAlive: () => false,
  };
}

/** Rows `sql` answers on the store at `path`, read-only. */
function readRows<Row>(path: string, sql: string): Row[] {
  const db = new Database(path, { readonly: true });
  try {
    return db.query<Row, []>(sql).all();
  } finally {
    db.close();
  }
}

/** The facts of `plan_ci` in the store at `path`, as the generic reader answers them. */
function factsOf(path: string): ReturnType<typeof readRepositoryFacts> {
  const db = new Database(path, { readonly: true });
  try {
    return readRepositoryFacts(db, 'plan_ci');
  } finally {
    db.close();
  }
}

describe('repository facts across a merge', () => {
  it('keeps one row and writes no supersede when both stores hold one reading with one read_at', () => {
    const testCase = freshCase();
    plantStore(testCase.path, PORT, [T1]);
    plantStore(testCase.otherPath, HUB, [T1]);

    const result = mergeStore(mergeOptions(testCase));

    expect(result).toMatchObject({ status: 'merged', rowsAdded: 0, rowsSkipped: 1, rowsInConflict: 0 });
    expect(readRows(testCase.path, 'SELECT read_at FROM plan_ci')).toEqual([{ read_at: T1 }]);
    expect(readRows(testCase.path, 'SELECT * FROM reading_supersedes')).toEqual([]);
    expect(factsOf(testCase.path).map(({ sightings }) => sightings)).toEqual([0]);
  });

  it('lands one row and no merge_conflicts row when a port and a hub write the same supersede', () => {
    const testCase = freshCase();
    plantStore(testCase.path, PORT, [T1, T2], true);
    plantStore(testCase.otherPath, HUB, [T1, T2], true);
    expect(readRows(testCase.path, 'SELECT origin_store FROM reading_supersedes')).toEqual([{ origin_store: PORT }]);
    expect(readRows(testCase.otherPath, 'SELECT origin_store FROM reading_supersedes')).toEqual([{ origin_store: HUB }]);

    const result = mergeStore(mergeOptions(testCase));

    expect(result).toMatchObject({ status: 'merged', rowsAdded: 0, rowsSkipped: 3, rowsInConflict: 0 });
    expect(readRows(testCase.path, 'SELECT canonical_key, superseded_key, origin_store FROM reading_supersedes')).toEqual([
      { canonical_key: keyAt(T1), superseded_key: keyAt(T2), origin_store: PORT },
    ]);
    expect(readRows(testCase.path, 'SELECT * FROM merge_conflicts')).toEqual([]);
  });

  it('answers one fact with one sighting for two readings of it from two origins', () => {
    const testCase = freshCase();
    plantStore(testCase.path, PORT, [T1]);
    plantStore(testCase.otherPath, HUB, [T2]);

    mergeStore(mergeOptions(testCase));

    const facts = factsOf(testCase.path);
    expect(facts).toHaveLength(1);
    expect(facts[0]).toMatchObject({ sightings: 1, origins: [HUB, PORT], lastSighting: T2 });
    expect(facts[0]?.canonical.key).toBe(keyAt(T1));
    expect(readRows(testCase.path, 'SELECT count(*) AS n FROM plan_ci')).toEqual([{ n: 2 }]);
  });

  it('makes a merged reading older than the canonical one canonical, with two sightings', () => {
    const testCase = freshCase();
    plantStore(testCase.path, PORT, [T2, T3], true);
    plantStore(testCase.otherPath, HUB, [T1]);

    mergeStore(mergeOptions(testCase));

    const facts = factsOf(testCase.path);
    expect(facts).toHaveLength(1);
    expect(facts[0]).toMatchObject({ sightings: 2, origins: [HUB, PORT], lastSighting: T3 });
    expect(facts[0]?.canonical.key).toBe(keyAt(T1));
    expect(facts[0]?.canonical.origin).toBe(HUB);
  });

  it('answers one fact with one sighting for a port with no hub folding its own two readings', () => {
    const root = join(scope, 'port-only');
    const reading = { planStub: 'phase-1', pr: 7, headSha: 'sha-a', verdict: 'red', failing: ['lint'] } as const;

    writePlanCi(root, { ...reading, readAt: T1 });
    writePlanCi(root, { ...reading, readAt: T2 });

    const facts = readPlanCiFacts(root);
    expect(facts).toHaveLength(1);
    expect(facts[0]).toMatchObject({ sightings: 1, lastSighting: T2 });
    expect(facts[0]?.row.readAt).toBe(T1);
  });
});
