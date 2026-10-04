/**
 * `mergeStore` over store files planted under one temp directory: this
 * store in a project's `.rafa/effort/`, so a loop record can sit beside
 * it, and the other in a directory of its own.
 *
 * Rows are planted stamped as a production insert stamps them, `seq` and
 * `origin_seq` equal under the store's origin, and `store_meta` is
 * planted by hand, since a store under the temp directory outside a
 * repository is never minted. Every case runs as an installed runtime
 * unless it says otherwise, and reads no git: `readProject` answers no
 * project.
 *
 * The backup a merge leaves is a `VACUUM INTO` snapshot of this store,
 * not its bytes, so it is compared by every table's rows and its
 * `user_version` (`storeRows`), `store_meta` among them.
 *
 * Each refusal snapshots both directories before and after and finds
 * them byte-identical. Each has a control beside it, the same planting
 * less the one fault, which merges, and the merge case finds this
 * store's directory changed, so a snapshot that could not tell would
 * fail there.
 */
import type { MergeOptions } from './merge-store.js';
import type { RuntimeIdentity } from '../../runtime/identity.js';

import { mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { Database } from 'bun:sqlite';
import { afterAll, describe, expect, it } from 'bun:test';

import { beginSession } from '../../loop/sessions.js';

import { bringForward } from './bring-forward.js';
import { DevelopmentBuildRefusedError } from './development-build.js';
import { MergeRefusal, mergeStore, MOVE_TO_SQLITE } from './merge-store.js';
import { migrateSchema, SQLITE_MIGRATIONS } from './sqlite.js';
import { storeRows } from './testdata/store-rows.js';

const scope = realpathSync(mkdtempSync(join(tmpdir(), 'rafa-merge-store-')));
afterAll(() => {
  rmSync(scope, { recursive: true, force: true });
});

const NOW = new Date('2026-09-29T12:00:00.000Z');

const STAMP = '20260929T120000Z';

const COLLECTED_AT = '2026-09-29T10:00:00.000Z';

/** An installed runtime, which may swap a merged store in anywhere. */
const INSTALLED: RuntimeIdentity = { kind: 'installed', entry: '/home/u/.rafa/runtime/0.24.1/cli.js' };

/** A development build, which owns only stores under the temp directory or `RAFA_EFFORT_DIR`. */
const DEVELOPMENT: RuntimeIdentity = { kind: 'development', entry: '/work/rafa/src/rafa.ts', checkout: '/work/rafa' };

/** Both stores' origins, and the projects their `store_meta` rows name. */
const HERE = 'store-a';
const THERE = 'store-b';
const PROJECT = 'root-commit-1';
const OTHER_PROJECT = 'root-commit-2';

/** Where one case's two stores live. */
interface Case {
  readonly root: string;
  readonly path: string;
  readonly otherPath: string;
}

/** A fresh case: this store's path in a project, the other's in a directory of its own; neither file made. */
function freshCase(): Case {
  const dir = realpathSync(mkdtempSync(join(scope, 'case-')));
  const root = join(dir, 'project');
  return { root, path: join(root, '.rafa', 'effort', 'effort.sqlite'), otherPath: join(dir, 'device-b', 'effort.sqlite') };
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

/** Plants a finding for `key` under `origin`, stamped as a production insert stamps it; `what` varies its content. */
function plantFinding(db: Database, origin: string, key: string, what = `what ${key}`): void {
  const seq = nextSeq(db, 'findings');
  db.query(
    'INSERT INTO findings (seq, origin_store, origin_seq, id, session_id, task_line, kind, what, artifact, signal, outcome, collected_at)'
      + ' VALUES (?, ?, ?, ?, ?, ?, \'gotcha\', ?, ?, \'loud\', \'done\', ?)',
  ).run(seq, origin, seq, `id-${key}`, `session-${key}`, `task ${key}`, what, `artifact-${key}`, COLLECTED_AT);
}

/** Plants a commit at `timestamp` under `origin`, holding `gap` as its `minutesSincePrevious`. */
function plantCommit(db: Database, origin: string, sha: string, timestamp: string, gap: number | null): void {
  const seq = nextSeq(db, 'commits');
  db.query('INSERT INTO commits (seq, origin_store, origin_seq, sha, row_json) VALUES (?, ?, ?, ?, ?)')
    .run(seq, origin, seq, sha, JSON.stringify({ sha, timestamp, minutesSincePrevious: gap }));
}

/** Plants the `store_meta` row naming `storeId` of `project`. */
function plantMeta(db: Database, path: string, storeId: string, project: string): void {
  db.query(
    'INSERT INTO store_meta (id, store_id, project_root_commit, project_remote, host_id, store_path, file_dev, file_ino, minted_at)'
      + ' VALUES (1, ?, ?, NULL, \'host\', ?, 1, 1, ?)',
  ).run(storeId, project, path, COLLECTED_AT);
}

/**
 * The two stores of scenario 4: finding `a1` shared under this store's
 * origin, `a2` here only and `b1` there only; commits at 10:00 and 10:20
 * here, and the one at 10:10 there, with gaps each side measured alone.
 */
function plantPair(testCase: Case, otherProject: string | null = PROJECT): void {
  withStore(testCase.path, (db) => {
    plantMeta(db, testCase.path, HERE, PROJECT);
    plantFinding(db, HERE, 'a1');
    plantFinding(db, HERE, 'a2');
    plantCommit(db, HERE, 'sha-1000', '2026-09-29T10:00:00.000Z', null);
    plantCommit(db, HERE, 'sha-1020', '2026-09-29T10:20:00.000Z', 20);
  });
  withStore(testCase.otherPath, (db) => {
    if (otherProject !== null) plantMeta(db, testCase.otherPath, THERE, otherProject);
    plantFinding(db, HERE, 'a1');
    plantFinding(db, THERE, 'b1');
    plantCommit(db, THERE, 'sha-1010', '2026-09-29T10:10:00.000Z', 99);
  });
}

/** The options of one run over `testCase`, as an installed runtime with no live loop. */
function mergeOptions(testCase: Case, extra: Partial<MergeOptions> = {}): MergeOptions {
  return {
    path: testCase.path,
    otherPath: testCase.otherPath,
    backend: 'sqlite',
    dryRun: false,
    stamp: STAMP,
    now: () => NOW,
    newMergeId: () => 'merge-1',
    readProject: () => ({ rootCommit: null, remote: null }),
    identity: INSTALLED,
    isAlive: () => false,
    ...extra,
  };
}

/** Every file in `dir` by name, with its bytes. */
function snapshot(dir: string): ReadonlyMap<string, Buffer> {
  return new Map(readdirSync(dir).sort()
    .map((name) => [name, readFileSync(join(dir, name))]));
}

/** Both stores' directories, snapshotted. */
function snapshotBoth(testCase: Case): readonly ReadonlyMap<string, Buffer>[] {
  return [snapshot(dirname(testCase.path)), snapshot(dirname(testCase.otherPath))];
}

/** Whether two snapshots hold the same names with the same bytes. */
function sameFiles(before: ReadonlyMap<string, Buffer>, after: ReadonlyMap<string, Buffer>): boolean {
  return before.size === after.size
    && [...before].every(([name, bytes]) => after.get(name)?.equals(bytes) === true);
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

/** The gap each commit of the store at `path` holds, by sha. */
function gaps(path: string): Record<string, unknown> {
  return Object.fromEntries(readRows<{ sha: string; row_json: string }>(path, 'SELECT sha, row_json FROM commits')
    .map(({ sha, row_json: rowJson }) => [sha, (JSON.parse(rowJson) as Record<string, unknown>).minutesSincePrevious]));
}

/** Runs `refused`, expecting it to throw `expected`, and finds both directories byte-identical. */
function expectRefusedUnchanged(testCase: Case, refused: () => unknown, expected: (error: unknown) => void): void {
  const [hereBefore, thereBefore] = snapshotBoth(testCase);

  let thrown: unknown = null;
  try {
    refused();
  } catch (error) {
    thrown = error;
  }

  expected(thrown);
  const [hereAfter, thereAfter] = snapshotBoth(testCase);
  expect(hereBefore !== undefined && hereAfter !== undefined && sameFiles(hereBefore, hereAfter)).toBe(true);
  expect(thereBefore !== undefined && thereAfter !== undefined && sameFiles(thereBefore, thereAfter)).toBe(true);
}

/** A check that the error is a {@link MergeRefusal} for `reason` whose message holds `text`. */
function refusal(reason: string, text: string): (error: unknown) => void {
  return (error) => {
    expect(error).toBeInstanceOf(MergeRefusal);
    expect((error as MergeRefusal).reason).toBe(reason);
    expect((error as MergeRefusal).message).toContain(text);
  };
}

describe('mergeStore', () => {
  it('swaps the union in behind a backup, recording the merge and recomputing the gaps around the commit brought in', () => {
    const testCase = freshCase();
    plantPair(testCase);
    const original = storeRows(testCase.path);
    const [, thereBefore] = snapshotBoth(testCase);

    const result = mergeStore(mergeOptions(testCase));

    expect(result.status).toBe('merged');
    expect(result).toMatchObject({ mergeId: 'merge-1', otherStore: THERE, rowsAdded: 2, rowsSkipped: 1, rowsInConflict: 0 });
    expect(result.tables.find(({ table }) => table === 'findings')).toEqual({
      table: 'findings', added: 1, skipped: 1, inConflict: 0, filled: 0, collided: 0,
    });
    expect(result.otherBroughtForward).toEqual([]);
    expect(result.backupPath).toBe(`${testCase.path}.before-merge-${STAMP}.bak`);
    expect(storeRows(`${testCase.path}.before-merge-${STAMP}.bak`)).toEqual(original);
    expect(storeRows(testCase.path)).not.toEqual(original);
    expect(original.tables.findings).toHaveLength(2);
    expect(original.tables.store_meta).toHaveLength(1);
    expect(readdirSync(dirname(testCase.path)).sort()).toEqual(['effort.sqlite', `effort.sqlite.before-merge-${STAMP}.bak`]);
    expect(readRows(testCase.path, 'SELECT id, origin_store, origin_seq FROM findings ORDER BY seq')).toEqual([
      { id: 'id-a1', origin_store: HERE, origin_seq: 1 },
      { id: 'id-a2', origin_store: HERE, origin_seq: 2 },
      { id: 'id-b1', origin_store: THERE, origin_seq: 2 },
    ]);
    expect(readRows(testCase.path, 'SELECT id, other_store, merged_at, rows_added, rows_skipped, rows_in_conflict FROM merges'))
      .toEqual([{
        id: 'merge-1', other_store: THERE, merged_at: NOW.toISOString(), rows_added: 2, rows_skipped: 1, rows_in_conflict: 0,
      }]);
    expect(result.gapsRewritten).toBe(2);
    expect(gaps(testCase.path)).toEqual({ 'sha-1000': null, 'sha-1020': 10, 'sha-1010': 10 });
    const [, thereAfter] = snapshotBoth(testCase);
    expect(thereBefore !== undefined && thereAfter !== undefined && sameFiles(thereBefore, thereAfter)).toBe(true);
  });

  it('adds nothing when the same merge runs again', () => {
    const testCase = freshCase();
    plantPair(testCase);
    mergeStore(mergeOptions(testCase));

    const again = mergeStore(mergeOptions(testCase, { stamp: `${STAMP}-2`, newMergeId: () => 'merge-2' }));

    expect(again).toMatchObject({ rowsAdded: 0, rowsSkipped: 3, rowsInConflict: 0, gapsRewritten: 0 });
    expect(readRows(testCase.path, 'SELECT count(*) AS n FROM findings')).toEqual([{ n: 3 }]);
    expect(readRows(testCase.path, 'SELECT id FROM merges ORDER BY seq')).toEqual([{ id: 'merge-1' }, { id: 'merge-2' }]);
  });

  it('builds, checks and deletes the merge under dryRun, leaving both directories byte-identical', () => {
    const testCase = freshCase();
    plantPair(testCase);
    const [hereBefore, thereBefore] = snapshotBoth(testCase);

    const result = mergeStore(mergeOptions(testCase, { dryRun: true }));

    expect(result).toMatchObject({ status: 'would-merge', rowsAdded: 2, rowsSkipped: 1, backupPath: null });
    const [hereAfter, thereAfter] = snapshotBoth(testCase);
    expect(hereBefore !== undefined && hereAfter !== undefined && sameFiles(hereBefore, hereAfter)).toBe(true);
    expect(thereBefore !== undefined && thereAfter !== undefined && sameFiles(thereBefore, thereAfter)).toBe(true);
  });

  it('records one origin pair holding different content as a conflict, and counts it in merge_conflicts', () => {
    const testCase = freshCase();
    withStore(testCase.path, (db) => plantFinding(db, HERE, 'a1'));
    withStore(testCase.otherPath, (db) => plantFinding(db, HERE, 'a1', 'what a cloned disk wrote'));

    const result = mergeStore(mergeOptions(testCase));

    expect(result).toMatchObject({ rowsAdded: 0, rowsSkipped: 0, rowsInConflict: 1, otherStore: null });
    expect(readRows(testCase.path, 'SELECT merge_id, table_name, local_seq, field FROM merge_conflicts')).toEqual([
      { merge_id: 'merge-1', table_name: 'findings', local_seq: 1, field: null },
    ]);
    expect(readRows(testCase.path, 'SELECT rows_in_conflict FROM merges')).toEqual([{ rows_in_conflict: 1 }]);
  });

  it('brings a copy of an other store that lacks migrations forward, never the file itself', () => {
    const testCase = freshCase();
    withStore(testCase.path, (db) => plantFinding(db, HERE, 'a1'));
    mkdirSync(dirname(testCase.otherPath), { recursive: true });
    const old = new Database(testCase.otherPath, { create: true, readwrite: true });
    try {
      migrateSchema(old, testCase.otherPath, SQLITE_MIGRATIONS.slice(0, 12));
      old.run('INSERT INTO findings (id, session_id, task_line, kind, what, artifact, signal, outcome, collected_at)'
        + ' VALUES (\'id-old\', \'session-old\', \'task old\', \'gotcha\', \'what old\', \'artifact-old\', \'loud\', \'done\', ?)', [COLLECTED_AT]);
    } finally {
      old.close();
    }
    const [, thereBefore] = snapshotBoth(testCase);

    const result = mergeStore(mergeOptions(testCase));

    expect(result.otherBroughtForward).toEqual(['schema_migrations', ...SQLITE_MIGRATIONS.slice(12).map(({ id }) => id)]);
    expect(result).toMatchObject({ rowsAdded: 1, otherStore: null });
    expect(readRows(testCase.path, 'SELECT id, origin_store, origin_seq FROM findings WHERE id = \'id-old\'')).toEqual([
      { id: 'id-old', origin_store: null, origin_seq: null },
    ]);
    const [, thereAfter] = snapshotBoth(testCase);
    expect(thereBefore !== undefined && thereAfter !== undefined && sameFiles(thereBefore, thereAfter)).toBe(true);
    expect(readdirSync(tmpdir()).filter((name) => name.startsWith('rafa-merge-other-'))).toEqual([]);
  });
});

describe('mergeStore refusals, each leaving both files byte-identical', () => {
  it('refuses a store project whose store is NDJSON, naming the move', () => {
    const testCase = freshCase();
    plantPair(testCase);

    expectRefusedUnchanged(testCase, () => mergeStore(mergeOptions(testCase, { backend: 'ndjson' })), refusal('ndjson', MOVE_TO_SQLITE));
  });

  it('refuses an other file whose integrity_check fails, and merges the same store undamaged (control)', () => {
    const control = freshCase();
    plantPair(control);
    const testCase = freshCase();
    plantPair(testCase);
    const bytes = readFileSync(testCase.otherPath);
    const at = bytes.indexOf('session-b1');
    expect(at).toBeGreaterThan(0);
    bytes[at] = 'S'.charCodeAt(0);
    writeFileSync(testCase.otherPath, bytes);

    expectRefusedUnchanged(testCase, () => mergeStore(mergeOptions(testCase)), refusal('damaged', 'failed integrity_check: '));
    expect(mergeStore(mergeOptions(control)).status).toBe('merged');
  });

  it('refuses an other file SQLite cannot read as a database', () => {
    const testCase = freshCase();
    plantPair(testCase);
    writeFileSync(testCase.otherPath, 'not a store at all, only text a partial copy might leave\n'.repeat(80));

    expectRefusedUnchanged(testCase, () => mergeStore(mergeOptions(testCase)), refusal('damaged', 'cannot be read as a SQLite store'));
  });

  it('refuses another project\'s store, and merges one that names no project (control)', () => {
    const testCase = freshCase();
    plantPair(testCase, OTHER_PROJECT);
    const control = freshCase();
    plantPair(control, null);

    expectRefusedUnchanged(testCase, () => mergeStore(mergeOptions(testCase)), refusal('other-project', OTHER_PROJECT));
    expect(mergeStore(mergeOptions(control))).toMatchObject({ status: 'merged', otherStore: null });
  });

  it('refuses another project\'s store when this store is unminted, reading its project from git', () => {
    const testCase = freshCase();
    withStore(testCase.path, (db) => plantFinding(db, HERE, 'a1'));
    withStore(testCase.otherPath, (db) => plantMeta(db, testCase.otherPath, THERE, OTHER_PROJECT));
    const readProject = (): { rootCommit: string; remote: null } => ({ rootCommit: PROJECT, remote: null });

    expectRefusedUnchanged(testCase, () => mergeStore(mergeOptions(testCase, { readProject })), refusal('other-project', PROJECT));
  });

  it('refuses the swap beside a live loop, and runs it with the loop gone and as a dry run beside it (controls)', () => {
    const testCase = freshCase();
    plantPair(testCase);
    beginSession(testCase.root, {
      sessionId: '11111111-2222-3333-4444-555555555555',
      planStub: 'rafa-322-demo',
      plan: '.rafa/plans/PLAN-rafa-322-demo.md',
      branch: 'feat/rafa-322-demo',
      pid: 424242,
      startedAt: '2026-09-29T09:00:00.000Z',
    }, { isAlive: () => true });
    const alive = { isAlive: (): boolean => true };

    expectRefusedUnchanged(testCase, () => mergeStore(mergeOptions(testCase, alive)), refusal('live-loop', 'loop 11111111-2222-3333-4444-555555555555'));
    expect(mergeStore(mergeOptions(testCase, { ...alive, dryRun: true })).status).toBe('would-merge');
    expect(mergeStore(mergeOptions(testCase)).status).toBe('merged');
  });

  it('passes the live record whose session id the caller names, and refuses another sharing its pid', () => {
    const own = '11111111-2222-3333-4444-555555555555';
    const other = '66666666-7777-8888-9999-000000000000';
    const draft = { branch: 'feat/rafa-322-demo', pid: 424242 };
    const alive = { isAlive: (): boolean => true };
    const testCase = freshCase();
    plantPair(testCase);
    const control = freshCase();
    plantPair(control);
    for (const root of [testCase.root, control.root]) {
      beginSession(root, {
        ...draft,
        sessionId: own,
        planStub: 'rafa-322-demo',
        plan: '.rafa/plans/PLAN-rafa-322-demo.md',
        startedAt: '2026-09-29T09:00:00.000Z',
      }, alive);
    }
    beginSession(testCase.root, {
      ...draft,
      sessionId: other,
      planStub: 'rafa-323-other',
      plan: '.rafa/plans/PLAN-rafa-323-other.md',
      startedAt: '2026-09-29T09:30:00.000Z',
    }, alive);

    expectRefusedUnchanged(
      testCase,
      () => mergeStore(mergeOptions(testCase, { ...alive, sessionId: own })),
      refusal('live-loop', `loop ${other} (pid 424242`),
    );
    expectRefusedUnchanged(
      testCase,
      () => mergeStore(mergeOptions(testCase, { ...alive, sessionId: other })),
      refusal('live-loop', `loop ${own} (pid 424242`),
    );
    expectRefusedUnchanged(control, () => mergeStore(mergeOptions(control, alive)), refusal('live-loop', `loop ${own}`));
    expect(mergeStore(mergeOptions(control, { ...alive, sessionId: own })).status).toBe('merged');
  });

  it('refuses a development build\'s swap over a store it does not own, and runs it over one it owns (control)', () => {
    const testCase = freshCase();
    plantPair(testCase);
    const unowned = { identity: DEVELOPMENT, env: {}, tempDir: join(scope, 'another-temp') };

    expectRefusedUnchanged(testCase, () => mergeStore(mergeOptions(testCase, unowned)), (error) => {
      expect(error).toBeInstanceOf(DevelopmentBuildRefusedError);
      expect((error as Error).message).toContain(`${testCase.path} needs migration merges and this rafa is a development build`);
    });
    expect(mergeStore(mergeOptions(testCase, { identity: DEVELOPMENT, env: {} })).status).toBe('merged');
  });

  it('refuses when this store is not there, making nothing', () => {
    const testCase = freshCase();
    withStore(testCase.otherPath, (db) => plantFinding(db, THERE, 'b1'));
    mkdirSync(dirname(testCase.path), { recursive: true });

    expectRefusedUnchanged(testCase, () => mergeStore(mergeOptions(testCase)), refusal('missing', 'this store'));
  });
});
