/**
 * `rafa effort merge` and `rafa effort move --to=sqlite` spawned as real
 * subprocesses (`bun src/rafa.ts`) in scratch git repositories under the
 * temp directory, over stores built by hand with `bringForward` under an
 * installed identity. `mergeStore`'s and `moveToSqlite`'s own suites
 * (`merge-store.test.ts`, `move.test.ts`) and the in-process command
 * suites (`commands/effort/merge.test.ts`, `commands/effort/move.test.ts`)
 * already cover every seam; this file only proves the real binary wires
 * them together end to end: `RAFA_EFFORT_DIR`, the exit codes, and the
 * bytes a refusal must leave untouched.
 *
 * Every store here sits under the temp directory, so a development build
 * owns it and `runRafa`'s default `RAFA_TEST=1`/`TMPDIR` needs no
 * override; only the development-build refusal itself is out of scope
 * (`store-version-guard.test.ts` and `migrate.test.ts` already spawn
 * that path). The live-loop case uses the project's own
 * `<root>/.rafa/effort/effort.sqlite`, the one path the loop's live-loop
 * check reads a project root from; the other cases redirect this side
 * through `RAFA_EFFORT_DIR` to prove the variable is honoured by the
 * spawned command.
 */
import type { ScratchRepo } from './cli-capture.js';
import type { EffortRow } from '../effort/store/types.js';
import type { SessionRecord } from '../loop/sessions.js';

import {
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { Database } from 'bun:sqlite';
import { afterAll, describe, expect, it } from 'bun:test';

import { bringForward } from '../effort/store/bring-forward.js';
import { MOVE_TO_SQLITE } from '../effort/store/merge-store.js';
import { openNdjsonStore } from '../effort/store/ndjson.js';
import { sqliteStorePath } from '../effort/store/sqlite.js';
import { runsDir, sessionFilePath } from '../loop/sessions.js';

import { expectExit, plantProjectConfig, plantScratchRepo, runRafa } from './cli-capture.js';

const scope = realpathSync(mkdtempSync(join(tmpdir(), 'rafa-effort-merge-move-spawn-')));
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

/** Writes a `running` loop record under `root`, its pid the test process's own, so a real `isPidAlive` reads it alive. */
function plantLiveLoop(root: string, sessionId: string): void {
  const record: SessionRecord = {
    sessionId,
    planStub: 'rafa-322-merge-spawn',
    plan: '.rafa/plans/PLAN-rafa-322-merge-spawn.md',
    branch: 'feat/rafa-322-merge-spawn',
    pid: process.pid,
    startedAt: '2026-09-29T09:00:00.000Z',
    state: 'running',
    task: null,
  };
  mkdirSync(runsDir(root), { recursive: true });
  writeFileSync(sessionFilePath(root, sessionId), `${JSON.stringify(record, null, 2)}\n`, 'utf8');
}

describe('rafa effort merge, spawned', () => {
  it('exits 0, printing the rows added, skipped and in conflict, with RAFA_EFFORT_DIR moving this store', () => {
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

    const outcome = runRafa(scratch, scratch.repo, ['effort', 'merge', otherPath], { RAFA_EFFORT_DIR: effortDir });

    expectExit(outcome, 0, scratch);
    expect(outcome.stdout).toContain(`Merges ${otherPath} (store ${THERE}) into ${path}`);
    expect(outcome.stdout).toContain('  sessions: 1 added, 1 skipped, 0 in conflict\n');
    expect(outcome.stdout).toContain('Total: 1 added, 1 skipped, 0 in conflict;');
    expect(outcome.stdout).toContain('✅ Merged. Every row the original held is copied to');
    expect(readdirSync(effortDir).sort()).toEqual([
      'effort.sqlite',
      expect.stringMatching(/^effort\.sqlite\.before-merge-\d{8}T\d{6}Z\.bak$/) as unknown as string,
    ]);
  }, SPAWN_TIMEOUT);

  it('leaves the directory byte-identical under --dry-run', () => {
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
    const before = snapshot(effortDir);

    const outcome = runRafa(scratch, scratch.repo, ['effort', 'merge', otherPath, '--dry-run'], { RAFA_EFFORT_DIR: effortDir });

    expectExit(outcome, 0, scratch);
    expect(outcome.stdout).toContain('  sessions: 1 added, 1 skipped, 0 in conflict\n');
    expect(outcome.stdout).toContain('🔍 Dry run: the merged store was built beside it');
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

    const outcome = runRafa(scratch, scratch.repo, ['effort', 'merge', otherPath], { RAFA_EFFORT_DIR: effortDir });

    expectExit(outcome, 2, scratch);
    expect(outcome.stderr).toContain(`is the effort store of another project (root commit ${OTHER_PROJECT})`);
    expect(snapshot(effortDir)).toEqual(before);
    expect(snapshot(otherDir)).toEqual(otherBefore);
  }, SPAWN_TIMEOUT);

  it('refuses beside a planted live loop record, naming it, and changes nothing', () => {
    const scratch = freshRepo();
    const path = sqliteStorePath(scratch.repo);
    const otherDir = realpathSync(mkdtempSync(join(scope, 'device-b-')));
    const otherPath = join(otherDir, 'effort.sqlite');
    withStore(path, (db) => {
      plantMeta(db, path, HERE, PROJECT);
      plantSession(db, HERE, 'a1');
    });
    withStore(otherPath, (db) => {
      plantSession(db, THERE, 'b1');
    });
    const sessionId = '11111111-2222-3333-4444-555555555555';
    plantLiveLoop(scratch.repo, sessionId);
    const before = readFileSync(path);

    const outcome = runRafa(scratch, scratch.repo, ['effort', 'merge', otherPath]);

    expectExit(outcome, 1, scratch);
    expect(outcome.stderr).toContain(`loop ${sessionId} (pid ${String(process.pid)}, plan rafa-322-merge-spawn) is running on this store`);
    expect(readFileSync(path)).toEqual(before);
  }, SPAWN_TIMEOUT);
});

describe('rafa effort merge and rafa effort move --to=sqlite, spawned', () => {
  it('exits 2 on a store: ndjson project naming the move, which runs and lets the merge that follows succeed', () => {
    const scratch = freshRepo();
    plantProjectConfig(scratch.repo, NDJSON_CONFIG);
    openNdjsonStore(scratch.repo).append('sessions', [{ sessionId: 'session-ndjson-1', assistantRecordCount: 1 } as unknown as EffortRow<'sessions'>]);
    const missingOther = join(scratch.repo, 'not-there.sqlite');

    const refused = runRafa(scratch, scratch.repo, ['effort', 'merge', missingOther]);

    expectExit(refused, 2, scratch);
    expect(refused.stderr).toContain(`Next safe step: ${MOVE_TO_SQLITE}`);

    const moved = runRafa(scratch, scratch.repo, ['effort', 'move', '--to=sqlite']);

    expectExit(moved, 0, scratch);
    expect(moved.stdout).toContain('✅ Set store: sqlite in');

    const otherDir = realpathSync(mkdtempSync(join(scope, 'device-b-')));
    const otherPath = join(otherDir, 'effort.sqlite');
    withStore(otherPath, (db) => {
      plantSession(db, THERE, 'b1');
    });

    const merged = runRafa(scratch, scratch.repo, ['effort', 'merge', otherPath]);

    expectExit(merged, 0, scratch);
    expect(merged.stdout).toContain('✅ Merged. Every row the original held is copied to');
  }, SPAWN_TIMEOUT);
});
