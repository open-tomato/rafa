/**
 * The end-to-end story `bring-forward.test.ts`, `development-build.test.ts`
 * and `forward-compat.test.ts` each cover a slice of: one store, in one
 * file under a fresh temporary directory, driven through the sequence the
 * spec describes in order —
 *
 *   1. a pre-log store adopts, its thirteen legacy entries logged with no
 *      run, the entries past them run and logged, and `user_version` left
 *      at `LEGACY_GATE_OPEN`;
 *   2. an installed identity applies a synthetic additive tail, logging
 *      it and raising the gate to match;
 *   3. a development build with nothing pending reads (and writes) the
 *      same store, since a store with a log and nothing left to apply is
 *      current for any rafa;
 *   4. a development build asked to apply a second synthetic tail over
 *      that store is refused, its bytes and its log left exactly as step
 *      2 left them.
 *
 * Each step reads `schema_migrations` and `PRAGMA user_version` itself,
 * rather than trust the return value alone, and the refusal step checks
 * the spec's text verbatim. The store sits under `tmpdir()` throughout,
 * as the test guard (`location.ts`) requires; a synthetic tail is always
 * passed through the `migrations` option, never appended to
 * `SQLITE_MIGRATIONS`.
 */
import type { BringForwardOptions } from './bring-forward.js';
import type { SqliteMigration } from './migrations.js';
import type { StoreIdentitySeams, StoreMeta } from './store-meta.js';
import type { RuntimeIdentity } from '../../runtime/identity.js';

import { mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { Database } from 'bun:sqlite';
import { afterAll, describe, expect, it } from 'bun:test';

import { bringForward, MIGRATION_LOG_TABLE } from './bring-forward.js';
import { copyEffortStore, vacuumInto } from './copy.js';
import { DEVELOPMENT_NEXT_STEP, DevelopmentBuildRefusedError } from './development-build.js';
import { fixStoreSchema } from './fix-schema.js';
import { effortStoreDir } from './location.js';
import { mergeStore } from './merge-store.js';
import { migrateStore } from './migrate.js';
import { LEGACY_GATE_OPEN, SQLITE_MIGRATIONS } from './migrations.js';
import { sqliteStorePath, withSqliteStore } from './sqlite.js';
import { readStoreGeneration } from './store-generation.js';
import { readStoreMeta } from './store-meta.js';

const tempBase = mkdtempSync(join(tmpdir(), 'rafa-store-lifecycle-'));

afterAll(() => {
  rmSync(tempBase, { recursive: true, force: true });
});

const STORE_PATH = join(tempBase, 'effort.sqlite');

const CHECKOUT = '/work/rafa';
const DEVELOPMENT: RuntimeIdentity = { kind: 'development', entry: `${CHECKOUT}/src/rafa.ts`, checkout: CHECKOUT };
const INSTALLED: RuntimeIdentity = { kind: 'installed', entry: '/home/op/.rafa/runtime/0.25.0/cli.js' };

/** The first synthetic additive tail, applied by the installed identity in step 2. */
const FIRST_TAIL: SqliteMigration = {
  id: 'lifecycle-first-tail',
  breaks: [],
  sql: 'CREATE TABLE lifecycle_first (seq INTEGER PRIMARY KEY, note TEXT);',
};
const WITH_FIRST_TAIL = [...SQLITE_MIGRATIONS, FIRST_TAIL];

/** A second synthetic additive tail, pending only at step 4, never applied. */
const SECOND_TAIL: SqliteMigration = {
  id: 'lifecycle-second-tail',
  breaks: [],
  sql: 'CREATE TABLE lifecycle_second (seq INTEGER PRIMARY KEY, note TEXT);',
};
const WITH_BOTH_TAILS = [...WITH_FIRST_TAIL, SECOND_TAIL];

/** A development build over a store `tempBase` does not sit under: `tempDir` moves ownership elsewhere. */
function unowned(migrations: readonly SqliteMigration[]): BringForwardOptions {
  return {
    identity: DEVELOPMENT,
    env: {},
    tempDir: mkdtempSync(join(tmpdir(), 'rafa-store-lifecycle-elsewhere-')),
    appliedBy: '0.25.0',
    migrations,
  };
}

/** Runs `use` over a connection to the shared store, closing it whatever `use` did. */
function withDb<T>(use: (db: Database) => T): T {
  const db = new Database(STORE_PATH, { readwrite: true, create: true });
  try {
    return use(db);
  } finally {
    db.close();
  }
}

interface LogRow {
  readonly id: string;
  readonly applied_at: string;
  readonly applied_by: string;
}

/** The store's migration log, in apply order. */
function readLog(): readonly LogRow[] {
  return withDb((db) => db
    .query<LogRow, []>(`SELECT id, applied_at, applied_by FROM ${MIGRATION_LOG_TABLE} ORDER BY seq`)
    .all());
}

/** `PRAGMA user_version`, read fresh. */
function readUserVersion(): number {
  return withDb((db) => db.query<{ user_version: number }, []>('PRAGMA user_version').get()?.user_version ?? 0);
}

/** The store file's bytes, for a before-and-after comparison across a refused open. */
function readBytes(): Buffer {
  return readFileSync(STORE_PATH);
}

/** Plants a pre-log store: the thirteen legacy entries run, `user_version` at the open gate, no log. */
function plantPreLogStore(): void {
  withDb((db) => {
    for (const { sql } of SQLITE_MIGRATIONS.slice(0, LEGACY_GATE_OPEN)) db.run(sql);
    db.run(`PRAGMA user_version = ${String(LEGACY_GATE_OPEN)}`);
  });
}

describe('one store driven through adoption, an applied tail, a clean read and a refusal', () => {
  it('runs the whole sequence, checking schema_migrations, user_version and the refusal text at each step', () => {
    plantPreLogStore();
    expect(readUserVersion()).toBe(LEGACY_GATE_OPEN);

    // 1. Adoption: a pre-log store gets its log, the thirteen legacy ids
    // logged unrun and the entries past them run.
    const adoption = withDb((db) => bringForward(db, STORE_PATH, 'write', 'open', {
      identity: INSTALLED,
      env: {},
      appliedBy: '0.24.1',
    }));

    expect(adoption.adopted).toHaveLength(LEGACY_GATE_OPEN);
    expect(adoption.applied).toEqual(SQLITE_MIGRATIONS.slice(LEGACY_GATE_OPEN).map(({ id }) => id));
    expect(adoption.userVersion).toBe(LEGACY_GATE_OPEN);
    const afterAdoption = readLog();
    expect(afterAdoption.map((row) => row.id)).toEqual(SQLITE_MIGRATIONS.map(({ id }) => id));
    expect(afterAdoption.every((row) => row.applied_by === '0.24.1')).toBe(true);
    expect(readUserVersion()).toBe(LEGACY_GATE_OPEN);

    // 2. An installed identity applies a synthetic additive tail over the now-logged store.
    const applied = withDb((db) => bringForward(db, STORE_PATH, 'write', 'open', {
      identity: INSTALLED,
      env: {},
      appliedBy: '0.25.0',
      migrations: WITH_FIRST_TAIL,
    }));

    expect(applied.adopted).toEqual([]);
    expect(applied.applied).toEqual([FIRST_TAIL.id]);
    expect(applied.userVersion).toBe(LEGACY_GATE_OPEN);
    const afterApplied = readLog();
    expect(afterApplied.map((row) => row.id)).toEqual([...SQLITE_MIGRATIONS.map(({ id }) => id), FIRST_TAIL.id]);
    expect(afterApplied.at(-1)?.applied_by).toBe('0.25.0');
    expect(readUserVersion()).toBe(LEGACY_GATE_OPEN);
    const bytesAfterStep2 = readBytes();
    const logAfterStep2 = afterApplied;

    // 3. A development build with nothing pending reads the same store, since it is now current.
    const read = withDb((db) => bringForward(db, STORE_PATH, 'read', 'open', unowned(WITH_FIRST_TAIL)));

    expect(read).toEqual({ adopted: [], applied: [], userVersion: LEGACY_GATE_OPEN });
    expect(readLog()).toEqual(logAfterStep2);
    expect(readUserVersion()).toBe(LEGACY_GATE_OPEN);
    expect(readBytes().equals(bytesAfterStep2)).toBe(true);

    // A development build with nothing pending writes it too, as any rafa does.
    withDb((db) => {
      bringForward(db, STORE_PATH, 'write', 'open', unowned(WITH_FIRST_TAIL));
      db.run('INSERT INTO sessions (session_id, row_json) VALUES (?, ?)', ['s-lifecycle', '{"sessionId":"s-lifecycle"}']);
    });
    const bytesAfterStep3 = readBytes();

    // 4. A development build with a second synthetic tail pending is refused, byte-identical after.
    let refusal: DevelopmentBuildRefusedError | null = null;
    try {
      withDb((db) => bringForward(db, STORE_PATH, 'write', 'open', unowned(WITH_BOTH_TAILS)));
    } catch (error) {
      if (!(error instanceof DevelopmentBuildRefusedError)) throw error;
      refusal = error;
    }

    expect(refusal).not.toBeNull();
    expect(refusal?.message).toBe(
      `effort store: ${STORE_PATH} needs migration ${SECOND_TAIL.id} and this rafa is a development build`
        + ` (${CHECKOUT}); a development build migrates only a store under the temp directory or`
        + ' RAFA_EFFORT_DIR. Copy it with \'rafa effort copy\' and run this command with RAFA_EFFORT_DIR=<the copy>.',
    );
    expect(refusal?.nextStep).toBe(DEVELOPMENT_NEXT_STEP);
    expect(readLog().map((row) => row.id)).not.toContain(SECOND_TAIL.id);
    expect(readUserVersion()).toBe(LEGACY_GATE_OPEN);
    expect(readBytes().equals(bytesAfterStep3)).toBe(true);
  });
});

/** The identity seams every settle here passes: no git, no host read, ids and generations counted. */
function seams(label: string): StoreIdentitySeams {
  let minted = 0;
  let rotated = 0;
  return {
    readHostId: () => 'host-lifecycle',
    readProject: () => ({ rootCommit: 'a1b2c3d4', remote: null }),
    newStoreId: () => `${label}-origin-${String(++minted)}`,
    newGeneration: () => `${label}-generation-${String(++rotated)}`,
    now: () => new Date('2026-09-29T10:00:00.000Z'),
  };
}

let casesMade = 0;

/** A fresh directory for one case, under the suite's temporary base. */
function caseDir(): string {
  casesMade += 1;
  const dir = join(tempBase, `case-${String(casesMade)}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

/** One writing open of the store at `path`, the seams passed through; answers the row it leaves. */
function writeOpen(path: string, identity: StoreIdentitySeams, create = false): StoreMeta | null {
  return withSqliteStore(path, 'write', create, (db) => readStoreMeta(db), identity);
}

/** The row of the store at `path`, read on a connection of its own. */
function rowOf(path: string): StoreMeta | null {
  const db = new Database(path, { readonly: true });
  try {
    return readStoreMeta(db);
  } finally {
    db.close();
  }
}

const INSTALLED_RUNTIME: RuntimeIdentity = { kind: 'installed', entry: '/home/op/.rafa/runtime/0.25.0/cli.js' };
const STAMP = '20260929T120000Z';
const NOW = new Date('2026-09-29T12:00:00.000Z');

/** A store minted at `path`, the first writing open under `identity`. */
function mintedStore(path: string, identity: StoreIdentitySeams): StoreMeta {
  const meta = writeOpen(path, identity, true);
  if (meta === null) throw new Error('the first writing open left no store_meta row');
  return meta;
}

describe('the identity, generation and copy modules over one store', () => {
  it('keeps one origin over ten writing opens, the row and the side record equal after each', () => {
    const path = join(caseDir(), 'effort.sqlite');
    const identity = seams('ten');
    const first = mintedStore(path, identity);
    const generations = new Set<string | null>([first.generation]);

    for (let open = 0; open < 9; open += 1) {
      const row = writeOpen(path, identity);
      expect(row?.storeId).toBe(first.storeId);
      expect(row?.generation).not.toBeNull();
      expect(readStoreGeneration(path)).toBe(row?.generation ?? null);
      generations.add(row?.generation ?? null);
    }

    expect(generations.size).toBe(10);
    expect(rowOf(path)?.mintedAt).toBe(first.mintedAt);
  });

  it('mints its own origin and its own side record for the store rafa effort copy builds', () => {
    const source = join(caseDir(), 'project');
    const sourcePath = sqliteStorePath(source);
    const original = mintedStore(sourcePath, seams('source'));
    const target = join(caseDir(), 'project');

    copyEffortStore({ source: effortStoreDir(source), target: effortStoreDir(target) });
    const targetPath = sqliteStorePath(target);
    const copied = writeOpen(targetPath, seams('copy'));

    expect(copied?.storeId).toBe('copy-origin-1');
    expect(copied?.storeId).not.toBe(original.storeId);
    expect(readStoreGeneration(targetPath)).toBe(copied?.generation ?? null);
    expect(readStoreGeneration(targetPath)).not.toBe(readStoreGeneration(sourcePath));
    expect(rowOf(sourcePath)?.storeId).toBe(original.storeId);
  });

  it('mints a new origin and side record for the store fix-schema swaps in', () => {
    const path = join(caseDir(), 'effort.sqlite');
    const original = mintedStore(path, seams('fixed'));
    withSqliteStore(path, 'write', false, (db) => {
      db.run(`INSERT INTO ${MIGRATION_LOG_TABLE} (id, sha256, breaks, applied_at, applied_by)`
        + ` VALUES ('future-readings', '${'a'.repeat(64)}', '["writers"]', '2026-10-01T09:00:00.000Z', '0.30.0')`);
    }, seams('fixed'));

    const result = fixStoreSchema({ path, dryRun: false, stamp: STAMP, now: () => NOW, identity: INSTALLED_RUNTIME });
    const rebuilt = writeOpen(path, seams('rebuilt'));

    expect(result.status).toBe('rebuilt');
    expect(rebuilt?.storeId).toBe('rebuilt-origin-1');
    expect(rebuilt?.storeId).not.toBe(original.storeId);
    expect(readStoreGeneration(path)).toBe(rebuilt?.generation ?? null);
  });

  it('mints a new origin and side record for the store migrate swaps in', () => {
    const path = join(caseDir(), 'effort.sqlite');
    const original = mintedStore(path, seams('migrated'));
    const tail: SqliteMigration = { id: 'lifecycle-migrate-tail', breaks: [], sql: 'CREATE TABLE lifecycle_migrate (seq INTEGER PRIMARY KEY);' };

    const result = migrateStore({
      path, dryRun: false, stamp: STAMP, now: () => NOW, identity: INSTALLED_RUNTIME,
      migrations: [...SQLITE_MIGRATIONS, tail],
    });
    const rebuilt = writeOpen(path, seams('after-migrate'));

    expect(result.status).toBe('migrated');
    expect(rebuilt?.storeId).toBe('after-migrate-origin-1');
    expect(rebuilt?.storeId).not.toBe(original.storeId);
    expect(readStoreGeneration(path)).toBe(rebuilt?.generation ?? null);
  });

  it('mints for a store rebuilt aside and renamed over the original', () => {
    const dir = caseDir();
    const path = join(dir, 'effort.sqlite');
    const original = mintedStore(path, seams('aside'));
    const asidePath = join(dir, 'effort.sqlite.aside');

    vacuumInto(path, asidePath);
    renameSync(asidePath, path);
    const renamedOver = writeOpen(path, seams('renamed'));

    expect(renamedOver?.storeId).toBe('renamed-origin-1');
    expect(renamedOver?.storeId).not.toBe(original.storeId);
    expect(readStoreGeneration(path)).toBe(renamedOver?.generation ?? null);
  });

  it('reads a merged store\'s row with its generation, the other store\'s origin named in the result', () => {
    const dir = caseDir();
    const path = join(dir, 'here', 'effort.sqlite');
    const otherPath = join(dir, 'there', 'effort.sqlite');
    mintedStore(path, seams('here'));
    const other = mintedStore(otherPath, seams('there'));
    writeOpen(otherPath, seams('there'));

    const result = mergeStore({
      path, otherPath, backend: 'sqlite', dryRun: false, stamp: STAMP, now: () => NOW,
      newMergeId: () => 'merge-lifecycle', readProject: () => ({ rootCommit: null, remote: null }),
      identity: INSTALLED_RUNTIME, isAlive: () => false,
    });
    const merged = rowOf(path);

    expect(result.status).toBe('merged');
    expect(result.otherStore).toBe(other.storeId);
    expect(merged?.generation).not.toBeNull();
    expect(merged?.storeId).toBe('here-origin-1');
  });
});
