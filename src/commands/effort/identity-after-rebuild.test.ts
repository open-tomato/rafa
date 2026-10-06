/**
 * `rafa effort merge`, `migrate`, `fix-schema` and `copy` dispatched in-process, as
 * an installed runtime, over a project whose store was minted, each
 * followed by one writing open through `withSqliteStore` with the host
 * and the project injected. The store's `store_meta.store_id` is the same
 * after as before, and the backup the command printed, renamed back over
 * the live store, and the copy `rafa effort copy` made, each mint a new
 * one on their next write. No case asserts that an inode moved or stayed.
 *
 * Every case writes once before it reads `store_id`, since a read never
 * mints and a read-only check passes while wrong. The store ids come from
 * a list that throws when it runs out, so a write minting more than the
 * case expects fails there.
 */
import type { StoreIdentitySeams, StoreMeta } from '../../effort/store/store-meta.js';
import type { RuntimeIdentity } from '../../runtime/identity.js';
import type { PlantedProject } from '../../tests/cli-capture.js';

import { mkdirSync, mkdtempSync, realpathSync, renameSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { Database } from 'bun:sqlite';
import { afterAll, describe, expect, it } from 'bun:test';

import { bringForward, MIGRATION_LOG_TABLE } from '../../effort/store/bring-forward.js';
import { SQLITE_MIGRATIONS, sqliteStorePath, withSqliteStore } from '../../effort/store/sqlite.js';
import { readHostId } from '../../effort/store/store-identity.js';
import { readStoreMeta } from '../../effort/store/store-meta.js';
import { dispatchInProject, plantProject } from '../../tests/cli-capture.js';

import { createCopyCommand } from './copy.js';
import { createFixSchemaCommand } from './fix-schema.js';
import { createMergeCommand } from './merge.js';
import { createMigrateCommand } from './migrate.js';

const scope = realpathSync(mkdtempSync(join(tmpdir(), 'rafa-effort-identity-')));
afterAll(() => {
  rmSync(scope, { recursive: true, force: true });
});

const NOW = new Date('2026-10-02T12:00:00.000Z');

const COLLECTED_AT = '2026-10-02T10:00:00.000Z';

const INSTALLED: RuntimeIdentity = { kind: 'installed', entry: '/home/u/.rafa/runtime/0.24.1/cli.js' };

const EFFORT_SUBJECT = { name: 'effort', summary: 'the effort store' };

const ORIGIN = 'store-local';

/** This machine's host id: the rebuild's carry reads it itself, so the mints record it too. */
const HOST = readHostId();

const PROJECT = { rootCommit: 'a1b2c3d4', remote: null };

/** The backup path a done line prints. */
const BACKUP_LINE = /copied to (\S+\.bak)/;

/** Seams of one host and project whose store ids come from `ids` in order, and throw when none is left. */
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

/** One writing open of `path`, answering the `store_meta` row the open left. */
function writeOpen(path: string, seams: StoreIdentitySeams, create = false): StoreMeta | null {
  return withSqliteStore(path, 'write', create, (db) => readStoreMeta(db), seams);
}

/** Runs `use` on a writable connection to `path`. */
function withRaw(path: string, use: (db: Database) => void): void {
  const db = new Database(path, { readwrite: true });
  try {
    use(db);
  } finally {
    db.close();
  }
}

/** Plants a finding for `key` under `origin`. */
function plantFinding(path: string, origin: string, key: string): void {
  withRaw(path, (db) => {
    const seq = db.query<{ n: number }, []>('SELECT COALESCE(MAX(seq), 0) + 1 AS n FROM findings').get()?.n ?? 1;
    db.query(
      'INSERT INTO findings (seq, origin_store, origin_seq, id, session_id, task_line, kind, what, artifact, signal, outcome, collected_at)'
        + ' VALUES (?, ?, ?, ?, ?, ?, \'gotcha\', ?, ?, \'loud\', \'done\', ?)',
    ).run(seq, origin, seq, `id-${key}`, `session-${key}`, `task ${key}`, `what ${key}`, `artifact-${key}`, COLLECTED_AT);
  });
}

/** A planted project with a minted store holding finding `a1`. */
function mintedProject(): { project: PlantedProject; path: string; meta: StoreMeta } {
  const project = plantProject(realpathSync(mkdtempSync(join(scope, 'case-'))));
  const path = sqliteStorePath(project.root);
  const meta = writeOpen(path, seamsOf(ORIGIN), true);
  if (meta === null) throw new Error('the first write minted nothing');
  plantFinding(path, meta.storeId, 'a1');
  return { project, path, meta };
}

/** The backup path the command's stdout printed. */
function printedBackup(stdout: string): string {
  const backup = BACKUP_LINE.exec(stdout)?.[1];
  if (backup === undefined) throw new Error(`no backup named in: ${stdout}`);
  return backup;
}

/** Asserts one write keeps `before`'s store id, then renames the backup back over the live store. */
function expectKeptThenRestore(path: string, backup: string, before: StoreMeta): void {
  const kept = writeOpen(path, seamsOf());
  expect(kept?.storeId).toBe(before.storeId);
  renameSync(backup, path);
}

/** Asserts the next write of the restored backup mints a new store id. */
function expectMintsOnNextWrite(path: string): void {
  const restored = writeOpen(path, seamsOf('store-restored'));
  expect(restored?.storeId).toBe('store-restored');
}

describe('a file that is not the store its id was minted for mints on its next write', () => {
  it('mints when the backup rafa effort migrate printed is renamed back over the live store', async () => {
    const { project, path, meta } = mintedProject();
    const command = createMigrateCommand({
      now: () => NOW,
      identity: INSTALLED,
      isAlive: () => false,
      migrations: [...SQLITE_MIGRATIONS, { id: 'synthetic-notes', breaks: [], sql: 'CREATE TABLE synthetic_notes (seq INTEGER PRIMARY KEY);' }],
    });

    const outcome = await dispatchInProject(['effort', 'migrate'], [EFFORT_SUBJECT], [command], project);
    renameSync(printedBackup(outcome.stdout), path);

    expect(outcome.exitCode).toBe(0);
    expect(meta.storeId).toBe(ORIGIN);
    expectMintsOnNextWrite(path);
  });

  it('mints in the copy rafa effort copy made, and the live store keeps its own', async () => {
    const { project, path, meta } = mintedProject();
    const target = join(scope, `copy-${String(Date.now())}`, 'effort-copy');

    const outcome = await dispatchInProject(['effort', 'copy', `--to=${target}`], [EFFORT_SUBJECT], [createCopyCommand({ now: () => NOW })], project);
    const copyPath = join(target, 'effort.sqlite');
    const copied = writeOpen(copyPath, seamsOf('store-copy'));
    const kept = writeOpen(path, seamsOf());

    expect(outcome.exitCode).toBe(0);
    expect(copied?.storeId).toBe('store-copy');
    expect(kept?.storeId).toBe(meta.storeId);
  });
});

describe('a command that rebuilds the store keeps its store id on the next write', () => {
  it('keeps it through rafa effort merge adding 0 rows, the printed backup minting when renamed back', async () => {
    const { project, path, meta } = mintedProject();
    const otherPath = join(dirname(path), '..', '..', '..', 'device-b', 'effort.sqlite');
    mkdirSync(dirname(otherPath), { recursive: true });
    const other = new Database(otherPath, { create: true, readwrite: true });
    try {
      bringForward(other, otherPath, 'write', 'open', { identity: INSTALLED });
    } finally {
      other.close();
    }
    plantFinding(otherPath, meta.storeId, 'a1');
    const command = createMergeCommand({
      now: () => NOW,
      identity: INSTALLED,
      isAlive: () => false,
      newMergeId: () => 'merge-1',
      readProject: () => PROJECT,
    });

    const outcome = await dispatchInProject(['effort', 'merge', otherPath], [EFFORT_SUBJECT], [command], project);

    expect(outcome.exitCode).toBe(0);
    expect(outcome.stdout).toContain('Total: 0 added');
    expectKeptThenRestore(path, printedBackup(outcome.stdout), meta);
    expectMintsOnNextWrite(path);
  });

  it('keeps it through rafa effort migrate, the printed backup minting when renamed back', async () => {
    const { project, path, meta } = mintedProject();
    const command = createMigrateCommand({
      now: () => NOW,
      identity: INSTALLED,
      isAlive: () => false,
      migrations: [...SQLITE_MIGRATIONS, { id: 'synthetic-notes', breaks: [], sql: 'CREATE TABLE synthetic_notes (seq INTEGER PRIMARY KEY);' }],
    });

    const outcome = await dispatchInProject(['effort', 'migrate'], [EFFORT_SUBJECT], [command], project);

    expect(outcome.exitCode).toBe(0);
    expect(outcome.stdout).toContain('✅ Migrated.');
    expectKeptThenRestore(path, printedBackup(outcome.stdout), meta);
    expectMintsOnNextWrite(path);
  });

  it('keeps it through rafa effort fix-schema, the printed backup minting when renamed back', async () => {
    const { project, path, meta } = mintedProject();
    withRaw(path, (db) => {
      db.run('CREATE TABLE future_readings (seq INTEGER PRIMARY KEY, session_id TEXT NOT NULL)');
      db.run(
        `INSERT INTO ${MIGRATION_LOG_TABLE} (id, sha256, breaks, applied_at, applied_by)`
          + ` VALUES ('future-readings', '${'a'.repeat(64)}', '["writers"]', '2026-10-01T09:00:00.000Z', '0.30.0')`,
      );
    });
    const command = createFixSchemaCommand({ now: () => NOW, identity: INSTALLED, isAlive: () => false });

    const outcome = await dispatchInProject(['effort', 'fix-schema'], [EFFORT_SUBJECT], [command], project);

    expect(outcome.exitCode).toBe(0);
    expect(outcome.stdout).toContain('Rebuilt at this rafa\'s migrations.');
    expectKeptThenRestore(path, printedBackup(outcome.stdout), meta);
    // The restored backup still holds the migration that refuses writes, so it is repaired again first.
    const again = createFixSchemaCommand({ now: () => new Date('2026-10-02T12:05:00.000Z'), identity: INSTALLED, isAlive: () => false });
    const repaired = await dispatchInProject(['effort', 'fix-schema'], [EFFORT_SUBJECT], [again], project);
    expect(repaired.exitCode).toBe(0);
    expectMintsOnNextWrite(path);
  });
});
