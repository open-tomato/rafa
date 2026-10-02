/**
 * `rafa effort import` spawned as a real subprocess (`bun src/rafa.ts`) in
 * scratch git repositories under the temp directory, over stores built by
 * hand with `bringForward` under an installed identity. The in-process
 * suite (`commands/effort/import.test.ts`) and the merge command's own
 * spawned suite (`effort-merge-move-spawn.test.ts`) already cover every
 * seam this command shares with `rafa effort merge`; this file only
 * proves the real binary wires the file strategy to the merge past a
 * missing file, another project's store, a `store: ndjson` project, and
 * a clean import repeated to add nothing.
 *
 * Every store here sits under the temp directory, so a development build
 * owns it and `runRafa`'s default `RAFA_TEST=1`/`TMPDIR` needs no
 * override.
 */
import type { ScratchRepo } from './cli-capture.js';

import { mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { Database } from 'bun:sqlite';
import { afterAll, describe, expect, it } from 'bun:test';

import { bringForward } from '../effort/store/bring-forward.js';
import { MOVE_TO_SQLITE } from '../effort/store/merge-store.js';

import { plantProjectConfig, plantScratchRepo, runRafa } from './cli-capture.js';

const scope = realpathSync(mkdtempSync(join(tmpdir(), 'rafa-effort-import-spawn-')));
afterAll(() => {
  rmSync(scope, { recursive: true, force: true });
});

/** How long a spawned run may take before it is killed. */
const SPAWN_TIMEOUT = 60_000;

/** Both stores' origins, and the projects their `store_meta` rows name. */
const HERE = 'store-a';
const THERE = 'store-b';
const PROJECT = 'root-commit-1';
const OTHER_PROJECT = 'root-commit-2';

const COLLECTED_AT = '2026-09-29T10:00:00.000Z';

/** An NDJSON project's config, as `move.test.ts` writes it. */
const NDJSON_CONFIG = 'version: 1\nstore: ndjson\n';

/** A fresh scratch repository under {@link scope}. */
function freshRepo(): ScratchRepo {
  return plantScratchRepo(scope);
}

/** Runs `use` on the store at `path`, made and brought through every migration first, as an installed runtime would. */
function withStore(path: string, use: (db: Database) => void): void {
  mkdirSync(dirname(path), { recursive: true });
  const db = new Database(path, { create: true, readwrite: true });
  try {
    bringForward(db, path, 'write', 'open', { identity: { kind: 'installed', entry: '/home/u/.rafa/runtime/0.24.1/cli.js' } });
    use(db);
  } finally {
    db.close();
  }
}

/** Plants a session for `key` under `origin`, stamped as a production insert stamps it. */
function plantSession(db: Database, origin: string, key: string): void {
  const seq = (db.query<{ n: number }, []>('SELECT COALESCE(MAX(seq), 0) + 1 AS n FROM sessions').get()?.n ?? 1);
  db.query('INSERT INTO sessions (seq, origin_store, origin_seq, session_id, row_json) VALUES (?, ?, ?, ?, ?)')
    .run(seq, origin, seq, `session-${key}`, '{}');
}

/** Plants the `store_meta` row naming `storeId` of `project`. */
function plantMeta(db: Database, path: string, storeId: string, project: string): void {
  db.query(
    'INSERT INTO store_meta (id, store_id, project_root_commit, project_remote, host_id, store_path, file_dev, file_ino, minted_at)'
      + ' VALUES (1, ?, ?, NULL, \'host\', ?, 1, 1, ?)',
  ).run(storeId, project, path, COLLECTED_AT);
}

/** Every file in `dir` by name, with its bytes. */
function snapshot(dir: string): ReadonlyMap<string, Buffer> {
  return new Map(readdirSync(dir).sort()
    .map((name) => [name, readFileSync(join(dir, name))]));
}

describe('rafa effort import, spawned', () => {
  it('exits 1 when the other file is not there, changing nothing', () => {
    const scratch = freshRepo();
    const effortDir = join(scratch.repo, 'device-a');
    const path = join(effortDir, 'effort.sqlite');
    withStore(path, (db) => {
      plantMeta(db, path, HERE, PROJECT);
      plantSession(db, HERE, 'a1');
    });
    const missingOther = join(scratch.repo, 'not-there.sqlite');
    const before = snapshot(effortDir);

    const outcome = runRafa(scratch, scratch.repo, ['effort', 'import', missingOther], { RAFA_EFFORT_DIR: effortDir });

    expect(outcome.exitCode).toBe(1);
    expect(outcome.stderr).toContain('❌ rafa effort import: ');
    expect(outcome.stderr).toContain('the other store');
    expect(snapshot(effortDir)).toEqual(before);
  }, SPAWN_TIMEOUT);

  it('exits 2 on another project\'s store, changing nothing', () => {
    const scratch = freshRepo();
    const effortDir = join(scratch.repo, 'device-a');
    const path = join(effortDir, 'effort.sqlite');
    const otherDir = realpathSync(mkdtempSync(join(scope, 'device-b-')));
    const otherPath = join(otherDir, 'effort.sqlite');
    withStore(path, (db) => {
      plantMeta(db, path, HERE, PROJECT);
      plantSession(db, HERE, 'a1');
    });
    withStore(otherPath, (db) => {
      plantMeta(db, otherPath, THERE, OTHER_PROJECT);
      plantSession(db, THERE, 'b1');
    });
    const before = snapshot(effortDir);
    const otherBefore = snapshot(otherDir);

    const outcome = runRafa(scratch, scratch.repo, ['effort', 'import', otherPath], { RAFA_EFFORT_DIR: effortDir });

    expect(outcome.exitCode).toBe(2);
    expect(outcome.stderr).toContain('❌ rafa effort import: ');
    expect(outcome.stderr).toContain(`is the effort store of another project (root commit ${OTHER_PROJECT})`);
    expect(snapshot(effortDir)).toEqual(before);
    expect(snapshot(otherDir)).toEqual(otherBefore);
  }, SPAWN_TIMEOUT);

  it('exits 2 on a store: ndjson project, naming the move, changing nothing', () => {
    const scratch = freshRepo();
    plantProjectConfig(scratch.repo, NDJSON_CONFIG);
    const missingOther = join(scratch.repo, 'not-there.sqlite');

    const outcome = runRafa(scratch, scratch.repo, ['effort', 'import', missingOther]);

    expect(outcome.exitCode).toBe(2);
    expect(outcome.stderr).toContain(`Next safe step: ${MOVE_TO_SQLITE}`);
  }, SPAWN_TIMEOUT);

  it('imports, then adds nothing when the same import runs again', () => {
    const scratch = freshRepo();
    const effortDir = join(scratch.repo, 'device-a');
    const path = join(effortDir, 'effort.sqlite');
    const otherDir = realpathSync(mkdtempSync(join(scope, 'device-b-')));
    const otherPath = join(otherDir, 'effort.sqlite');
    withStore(path, (db) => {
      plantMeta(db, path, HERE, PROJECT);
      plantSession(db, HERE, 'a1');
    });
    withStore(otherPath, (db) => {
      plantMeta(db, otherPath, THERE, PROJECT);
      plantSession(db, HERE, 'a1');
      plantSession(db, THERE, 'b1');
    });

    const outcome = runRafa(scratch, scratch.repo, ['effort', 'import', otherPath], { RAFA_EFFORT_DIR: effortDir });

    expect(outcome.exitCode).toBe(0);
    expect(outcome.stdout).toContain(`Merges ${otherPath} (store ${THERE}) into ${path}`);
    expect(outcome.stdout).toContain('  sessions: 1 added, 1 skipped, 0 in conflict\n');
    expect(outcome.stdout).toContain('Total: 1 added, 1 skipped, 0 in conflict;');
    expect(outcome.stdout).toContain('✅ Merged. A copy of the original is kept at');
    const [backupName] = readdirSync(effortDir).sort()
      .filter((name) => name !== 'effort.sqlite');
    expect(readdirSync(effortDir).sort()).toEqual([
      'effort.sqlite',
      expect.stringMatching(/^effort\.sqlite\.before-merge-\d{8}T\d{6}Z\.bak$/) as unknown as string,
    ]);
    // Removed so a repeated import inside the same clock second does not collide with this backup's stamp.
    if (backupName !== undefined) rmSync(join(effortDir, backupName));

    const again = runRafa(scratch, scratch.repo, ['effort', 'import', otherPath], { RAFA_EFFORT_DIR: effortDir });

    expect(again.exitCode).toBe(0);
    expect(again.stdout).toContain('  sessions: 0 added, 2 skipped, 0 in conflict\n');
    expect(again.stdout).toContain('Total: 0 added, 2 skipped, 0 in conflict;');
  }, SPAWN_TIMEOUT);
});
