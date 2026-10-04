/**
 * What a store's origin does across a rebuild beside it (`rebuild-aside.ts`),
 * end to end through the three commands that swap one in, `mergeStore`,
 * `migrateStore` and `fixStoreSchema`, and the writing open of
 * `withSqliteStore` that follows.
 *
 * The cases that mint come first, since they are what the carry must not
 * hide: a file that is not the store the origin was minted for still
 * mints on its next write, whether it got there by a backup renamed back
 * over the live store, a `cp` to another path, a `copyEffortStore`
 * copy, or a renamed-back backup rebuilt before anything wrote to it.
 * Then each command rebuilds a minted store and the first write after it
 * finds the same `store_id`.
 *
 * No case asserts that an inode moved or stayed: whether a deleted file's
 * inode number goes to the next file is the filesystem's choice, so each
 * case asserts the mint or the kept `store_id` and nothing about numbers.
 *
 * Every case writes once after the rebuild before it reads
 * `store_meta.store_id`, because a read never mints and a read-only
 * check passes while wrong. Every store is a real file under `tmpdir()`;
 * the project is injected and the host id is this machine's, which the rebuild's carry reads itself, and the store ids come from
 * a list that throws when it runs out, so a write that mints more than
 * the case expects fails there.
 */
import type { SqliteMigration } from './migrations.js';
import type { StoreIdentitySeams, StoreMeta } from './store-meta.js';
import type { RuntimeIdentity } from '../../runtime/identity.js';

import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  realpathSync,
  renameSync,
  rmSync,
  statSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { Database } from 'bun:sqlite';
import { afterAll, describe, expect, it } from 'bun:test';

import { bringForward, MIGRATION_LOG_TABLE } from './bring-forward.js';
import { copyEffortStore } from './copy.js';
import { fixStoreSchema } from './fix-schema.js';
import { mergeStore } from './merge-store.js';
import { migrateStore } from './migrate.js';
import { SQLITE_MIGRATIONS, withSqliteStore } from './sqlite.js';
import { readHostId } from './store-identity.js';
import { readStoreMeta } from './store-meta.js';

const scope = realpathSync(mkdtempSync(join(tmpdir(), 'rafa-rebuild-identity-')));
afterAll(() => {
  rmSync(scope, { recursive: true, force: true });
});

const NOW = new Date('2026-10-02T12:00:00.000Z');

const COLLECTED_AT = '2026-10-02T10:00:00.000Z';

/** An installed runtime, which may swap a rebuild in anywhere. */
const INSTALLED: RuntimeIdentity = { kind: 'installed', entry: '/home/u/.rafa/runtime/0.24.1/cli.js' };

/** The origin the first mint of a case records. */
const ORIGIN = 'store-local';

/** The origin of the store a case merges in. */
const OTHER_ORIGIN = 'store-other';

/** The project every mint records. */
/** This machine's host id: the rebuild's carry reads it itself, so the mints record it too. */
const HOST = readHostId();

const PROJECT = { rootCommit: 'a1b2c3d4', remote: null };

/** An additive entry this build does not ship, appended to make a migration pending. */
const ADDITIVE_TAIL: SqliteMigration = {
  id: 'synthetic-notes',
  breaks: [],
  sql: 'CREATE TABLE synthetic_notes (seq INTEGER PRIMARY KEY, note TEXT);',
};

let stamped = 0;

/** A stamp no earlier run of the case used, so two rebuilds never collide. */
function nextStamp(): string {
  stamped += 1;
  return `20261002T12000${String(stamped)}Z`;
}

/**
 * Seams of one host and project whose store ids come from `ids` in
 * order, and throw when none is left.
 */
function seamsOf(...ids: readonly string[]): StoreIdentitySeams {
  const queue = [...ids];
  return {
    readHostId: () => HOST,
    readProject: () => PROJECT,
    newStoreId: () => {
      const next = queue.shift();
      if (next === undefined) throw new Error('a write minted a store id the case did not expect');
      return next;
    },
    now: () => NOW,
  };
}

/** A project directory of its own: the store in `.rafa/effort/`, and the other store beside it. */
interface Case {
  readonly path: string;
  readonly otherPath: string;
}

/** A fresh case, no file made. */
function freshCase(): Case {
  const dir = realpathSync(mkdtempSync(join(scope, 'case-')));
  return {
    path: join(dir, 'project', '.rafa', 'effort', 'effort.sqlite'),
    otherPath: join(dir, 'device-b', 'effort.sqlite'),
  };
}

/** One writing open of `path`, answering the `store_meta` row the open left. */
function writeOpen(path: string, seams: StoreIdentitySeams, create = false): StoreMeta | null {
  return withSqliteStore(path, 'write', create, (db) => readStoreMeta(db), seams);
}

/** A minted store at `path`: the row its first writing open recorded. */
function mint(path: string): StoreMeta {
  const meta = writeOpen(path, seamsOf(ORIGIN), true);
  if (meta === null) throw new Error('the first write minted nothing');
  return meta;
}

/** The `store_meta` row of the file at `path`, read on a connection of its own. */
function metaOf(path: string): StoreMeta | null {
  const db = new Database(path, { readonly: true });
  try {
    return readStoreMeta(db);
  } finally {
    db.close();
  }
}

/** The device and inode of the file at `path`. */
function factsOf(path: string): { readonly fileDev: bigint; readonly fileIno: bigint } {
  const { dev, ino } = statSync(path, { bigint: true });
  return { fileDev: dev, fileIno: ino };
}

/** Runs `use` on a writable connection to `path`, closing it after. */
function withRaw(path: string, use: (db: Database) => void): void {
  const db = new Database(path, { readwrite: true });
  try {
    use(db);
  } finally {
    db.close();
  }
}

/**
 * Plants the row a reused inode would leave: the live file's own device and
 * inode in its `store_meta`, whatever this filesystem did with the numbers.
 */
function plantReuseShape(path: string): void {
  const { fileDev, fileIno } = factsOf(path);
  withRaw(path, (db) => {
    db.query('UPDATE store_meta SET file_dev = ?, file_ino = ?').run(fileDev.toString(), fileIno.toString());
  });
}

/** Plants a finding for `key` under `origin`, with the next `seq`. */
function plantFinding(path: string, origin: string, key: string): void {
  withRaw(path, (db) => {
    const seq = db.query<{ n: number }, []>('SELECT COALESCE(MAX(seq), 0) + 1 AS n FROM findings').get()?.n ?? 1;
    db.query(
      'INSERT INTO findings (seq, origin_store, origin_seq, id, session_id, task_line, kind, what, artifact, signal, outcome, collected_at)'
        + ' VALUES (?, ?, ?, ?, ?, ?, \'gotcha\', ?, ?, \'loud\', \'done\', ?)',
    ).run(seq, origin, seq, `id-${key}`, `session-${key}`, `task ${key}`, `what ${key}`, `artifact-${key}`, COLLECTED_AT);
  });
}

/** Plants the other store at `otherPath`, brought forward and holding the findings named by `keys` under `origin`. */
function plantOther(testCase: Case, origin: string, keys: readonly string[]): void {
  mkdirSync(dirname(testCase.otherPath), { recursive: true });
  const db = new Database(testCase.otherPath, { create: true, readwrite: true });
  try {
    bringForward(db, testCase.otherPath, 'write', 'open', { identity: INSTALLED });
  } finally {
    db.close();
  }
  for (const key of keys) plantFinding(testCase.otherPath, origin, key);
}

/** A minted store holding finding `a1` under its own origin, and the row its mint recorded. */
function mintedWithFinding(testCase: Case): StoreMeta {
  const meta = mint(testCase.path);
  plantFinding(testCase.path, meta.storeId, 'a1');
  return meta;
}

/** Merges the other store into the one at `testCase.path`, swapping the result in, and answers the backup's path. */
function merge(testCase: Case, expectedAdded: number): string {
  const result = mergeStore({
    path: testCase.path,
    otherPath: testCase.otherPath,
    backend: 'sqlite',
    dryRun: false,
    stamp: nextStamp(),
    now: () => NOW,
    newMergeId: () => `merge-${nextStamp()}`,
    readProject: () => PROJECT,
    identity: INSTALLED,
    isAlive: () => false,
  });
  expect(result.status).toBe('merged');
  expect(result.rowsAdded).toBe(expectedAdded);
  if (result.backupPath === null) throw new Error('the merge swapped in and named no backup');
  return result.backupPath;
}

/** A directory-shaped store holding the file at `path`, as `copyEffortStore` copies it from. */
function storeDirOf(path: string): string {
  return dirname(path);
}

describe('a store that is not the one its origin was minted for mints on its next write', () => {
  it('mints a new origin when the backup of a merge is renamed back over the live store', () => {
    const testCase = freshCase();
    const before = mintedWithFinding(testCase);
    plantOther(testCase, OTHER_ORIGIN, ['b1']);
    const backupPath = merge(testCase, 1);
    const kept = writeOpen(testCase.path, seamsOf());
    renameSync(backupPath, testCase.path);

    const written = writeOpen(testCase.path, seamsOf('store-restored'));

    expect(before.storeId).toBe(ORIGIN);
    expect(kept?.storeId).toBe(ORIGIN);
    expect(written?.storeId).toBe('store-restored');
    expect(written?.fileIno).toBe(factsOf(testCase.path).fileIno);
    expect(metaOf(testCase.path)?.storeId).toBe('store-restored');
  });

  it('mints a new origin in a cp of the store at another path, and the store keeps its own', () => {
    const testCase = freshCase();
    const before = mintedWithFinding(testCase);
    const copyPath = join(dirname(testCase.otherPath), 'cp', 'effort.sqlite');
    mkdirSync(dirname(copyPath), { recursive: true });
    copyFileSync(testCase.path, copyPath);
    expect(metaOf(copyPath)?.storeId).toBe(before.storeId);

    const copied = writeOpen(copyPath, seamsOf('store-cp'));
    const kept = writeOpen(testCase.path, seamsOf());

    expect(copied?.storeId).toBe('store-cp');
    expect(copied?.storePath).toBe(realpathSync(copyPath));
    expect(kept).toEqual({ ...before, generation: kept?.generation });
  });

  it('mints a new origin in a copyEffortStore copy, and the store keeps its own', () => {
    const testCase = freshCase();
    const before = mintedWithFinding(testCase);
    const target = join(dirname(testCase.otherPath), 'effort-copy');

    const result = copyEffortStore({ source: storeDirOf(testCase.path), target });
    const copyPath = join(result.directory, 'effort.sqlite');
    expect(metaOf(copyPath)?.storeId).toBe(before.storeId);

    const copied = writeOpen(copyPath, seamsOf('store-copy'));
    const kept = writeOpen(testCase.path, seamsOf());

    expect(copied?.storeId).toBe('store-copy');
    expect(copied?.storePath).toBe(realpathSync(copyPath));
    expect(kept).toEqual({ ...before, generation: kept?.generation });
  });

  it.failing('mints a new origin on a renamed-back backup that was rebuilt before any write, with the reuse shape planted', () => {
    const testCase = freshCase();
    mintedWithFinding(testCase);
    plantOther(testCase, OTHER_ORIGIN, ['b1']);
    const backupPath = merge(testCase, 1);
    renameSync(backupPath, testCase.path);

    merge(testCase, 1);
    plantReuseShape(testCase.path);
    const written = writeOpen(testCase.path, seamsOf('store-rebuilt'));

    expect(written?.storeId).toBe('store-rebuilt');
    expect(metaOf(testCase.path)?.storeId).toBe('store-rebuilt');
  });

  it('mints a new origin on a backup restored after a writing open and rebuilt again before any write, with the reuse shape planted', () => {
    const testCase = freshCase();
    mintedWithFinding(testCase);
    plantOther(testCase, OTHER_ORIGIN, ['b1']);
    const backupPath = merge(testCase, 1);
    const kept = writeOpen(testCase.path, seamsOf());
    renameSync(backupPath, testCase.path);

    merge(testCase, 1);
    plantReuseShape(testCase.path);
    const written = writeOpen(testCase.path, seamsOf('store-rebuilt'));

    expect(kept?.storeId).toBe(ORIGIN);
    expect(written?.storeId).toBe('store-rebuilt');
    expect(metaOf(testCase.path)?.storeId).toBe('store-rebuilt');
  });
});

/**
 * Writes once through `withSqliteStore`, minting nothing, and finds the
 * `store_id` the store held before the rebuild, on the file the row now
 * names.
 */
function expectOriginKept(path: string, before: StoreMeta): void {
  const written = writeOpen(path, seamsOf());

  expect(written?.storeId).toBe(before.storeId);
  expect(metaOf(path)?.storeId).toBe(before.storeId);
  expect(metaOf(path)).toEqual({ ...before, ...factsOf(path), generation: metaOf(path)?.generation });
}

describe('a store rebuilt beside itself keeps its origin on the first write after', () => {
  it('keeps it through a merge that adds no rows', () => {
    const testCase = freshCase();
    const before = mintedWithFinding(testCase);
    plantOther(testCase, before.storeId, ['a1']);

    merge(testCase, 0);

    expectOriginKept(testCase.path, before);
  });

  it('keeps it through a merge that adds rows', () => {
    const testCase = freshCase();
    const before = mintedWithFinding(testCase);
    plantOther(testCase, OTHER_ORIGIN, ['b1', 'b2']);

    merge(testCase, 2);

    expectOriginKept(testCase.path, before);
  });

  it('keeps it through a migration', () => {
    const testCase = freshCase();
    const before = mintedWithFinding(testCase);

    const result = migrateStore({
      path: testCase.path,
      dryRun: false,
      stamp: nextStamp(),
      migrations: [...SQLITE_MIGRATIONS, ADDITIVE_TAIL],
      now: () => NOW,
      identity: INSTALLED,
      isAlive: () => false,
    });

    expect(result.status).toBe('migrated');
    expectOriginKept(testCase.path, before);
  });

  it('keeps it through a schema repair', () => {
    const testCase = freshCase();
    const before = mintedWithFinding(testCase);
    withRaw(testCase.path, (db) => {
      db.run('CREATE TABLE future_readings (seq INTEGER PRIMARY KEY, session_id TEXT NOT NULL)');
      db.run(
        `INSERT INTO ${MIGRATION_LOG_TABLE} (id, sha256, breaks, applied_at, applied_by)`
          + ` VALUES ('future-readings', '${'a'.repeat(64)}', '["writers"]', '2026-10-01T09:00:00.000Z', '0.30.0')`,
      );
    });

    const result = fixStoreSchema({
      path: testCase.path,
      dryRun: false,
      stamp: nextStamp(),
      now: () => NOW,
      identity: INSTALLED,
    });

    expect(result.status).toBe('rebuilt');
    expectOriginKept(testCase.path, before);
  });
});
