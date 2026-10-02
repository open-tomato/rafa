/**
 * `rafa effort import` dispatched in planted projects under the temp
 * directory, over this store at `<root>/.rafa/effort/effort.sqlite` and
 * another device's store in a directory of its own. Each case runs as an
 * installed runtime with no live loop and reads no git, unless it says
 * otherwise. `mergeStore`'s own cases hold the union and the file
 * adapter's (`src/effort/sync/file.test.ts`) hold the pull, so these hold
 * what the command adds: that it pulls through the `file` strategy, that
 * its lines and exit codes are `rafa effort merge`'s, and its argument
 * and flag.
 *
 * Every refusal snapshots both directories before and after and finds
 * them byte-identical; the import case finds this store's directory
 * changed, so a snapshot that could not tell would fail there. The exit
 * code 2 on another project's store has the same planting naming the
 * same project beside it, which imports with 0, and the live-loop
 * refusal has the same import as a dry run beside it, which runs.
 */
import type { ImportCommandSeams } from './import.js';
import type { FileSyncOptions } from '../../effort/sync/file.js';
import type { SyncPullRequest } from '../../ports/index.js';
import type { RuntimeIdentity } from '../../runtime/identity.js';
import type { CapturedRun, PlantedProject } from '../../tests/cli-capture.js';

import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { Database } from 'bun:sqlite';
import { afterAll, describe, expect, it } from 'bun:test';

import { bringForward } from '../../effort/store/bring-forward.js';
import { MOVE_TO_SQLITE } from '../../effort/store/merge-store.js';
import { sqliteStorePath } from '../../effort/store/sqlite.js';
import { createFileSync } from '../../effort/sync/file.js';
import { createLocalSync } from '../../effort/sync/select.js';
import { beginSession } from '../../loop/sessions.js';
import { projectConfigText } from '../../project/scaffold.js';
import { dispatchInProject, eventsOf, plantProject } from '../../tests/cli-capture.js';

import { createImportCommand } from './import.js';
import { createMergeCommand } from './merge.js';

const scope = realpathSync(mkdtempSync(join(tmpdir(), 'rafa-effort-import-')));
afterAll(() => {
  rmSync(scope, { recursive: true, force: true });
});

const NOW = new Date('2026-09-29T12:00:00.000Z');

const STAMP = '20260929T120000Z';

const COLLECTED_AT = '2026-09-29T10:00:00.000Z';

/** An installed runtime, which may swap a merged store in anywhere. */
const INSTALLED: RuntimeIdentity = { kind: 'installed', entry: '/home/u/.rafa/runtime/0.26.0/cli.js' };

/** The subject the command sits under, declared for the registry the test dispatches over. */
const EFFORT_SUBJECT = { name: 'effort', summary: 'the effort store' };

/** Both stores' origins, and the projects their `store_meta` rows name. */
const HERE = 'store-a';
const THERE = 'store-b';
const PROJECT = 'root-commit-1';
const OTHER_PROJECT = 'root-commit-2';

/** The seams every case runs under unless it names others. */
const BASE_SEAMS: ImportCommandSeams = {
  now: () => NOW,
  identity: INSTALLED,
  isAlive: () => false,
  newMergeId: () => 'merge-1',
  readProject: () => ({ rootCommit: null, remote: null }),
};

/** One case: a planted project, its store's path, and the other device's store's path. */
interface Case {
  readonly project: PlantedProject;
  readonly path: string;
  readonly otherPath: string;
}

/** A fresh case whose project config is `configText`; neither store made. */
function freshCase(configText: string = projectConfigText()): Case {
  const dir = realpathSync(mkdtempSync(join(scope, 'case-')));
  const project = plantProject(dir, configText);
  return { project, path: sqliteStorePath(project.root), otherPath: join(dir, 'device-b', 'effort.sqlite') };
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

/** Plants a finding for `key` under `origin`, stamped as a production insert stamps it. */
function plantFinding(db: Database, origin: string, key: string): void {
  const seq = (db.query<{ n: number }, []>('SELECT COALESCE(MAX(seq), 0) + 1 AS n FROM findings').get()?.n ?? 1);
  db.query(
    'INSERT INTO findings (seq, origin_store, origin_seq, id, session_id, task_line, kind, what, artifact, signal, outcome, collected_at)'
      + ' VALUES (?, ?, ?, ?, ?, ?, \'gotcha\', ?, ?, \'loud\', \'done\', ?)',
  ).run(seq, origin, seq, `id-${key}`, `session-${key}`, `task ${key}`, `what ${key}`, `artifact-${key}`, COLLECTED_AT);
}

/** Plants the `store_meta` row naming `storeId` of `project`. */
function plantMeta(db: Database, path: string, storeId: string, project: string): void {
  db.query(
    'INSERT INTO store_meta (id, store_id, project_root_commit, project_remote, host_id, store_path, file_dev, file_ino, minted_at)'
      + ' VALUES (1, ?, ?, NULL, \'host\', ?, 1, 1, ?)',
  ).run(storeId, project, path, COLLECTED_AT);
}

/** Plants finding `a1` in the store at `path`, as this device's store. */
function plantHere(path: string): void {
  withStore(path, (db) => {
    plantMeta(db, path, HERE, PROJECT);
    plantFinding(db, HERE, 'a1');
  });
}

/** Plants finding `a1` here, shared there, and `b1` there only; the other store names `otherProject`. */
function plantPair(testCase: Case, otherProject: string = PROJECT): void {
  plantHere(testCase.path);
  withStore(testCase.otherPath, (db) => {
    plantMeta(db, testCase.otherPath, THERE, otherProject);
    plantFinding(db, HERE, 'a1');
    plantFinding(db, THERE, 'b1');
  });
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

/** Whether two snapshots of both directories hold the same names with the same bytes. */
function unchanged(before: readonly ReadonlyMap<string, Buffer>[], after: readonly ReadonlyMap<string, Buffer>[]): boolean {
  return before.length === after.length && before.every((files, index) => {
    const other = after[index];
    return other !== undefined && files.size === other.size
      && [...files].every(([name, bytes]) => other.get(name)?.equals(bytes) === true);
  });
}

/** The session ids of the findings the store at `path` holds, in `seq` order. */
function findingSessions(path: string): string[] {
  const db = new Database(path, { readonly: true });
  try {
    return db.query<{ session_id: string }, []>('SELECT session_id FROM findings ORDER BY seq').all()
      .map((row) => row.session_id);
  } finally {
    db.close();
  }
}

/** Dispatches `effort import` with `words` in `testCase`'s project, as an installed runtime reading no git. */
async function run(
  testCase: Case,
  words: readonly string[],
  seams: ImportCommandSeams = {},
  env: Readonly<Record<string, string>> = {},
): Promise<CapturedRun> {
  const command = createImportCommand({ ...BASE_SEAMS, ...seams });
  return dispatchInProject(['effort', 'import', ...words], [EFFORT_SUBJECT], [command], testCase.project, env);
}

/** Dispatches `effort merge` with `words` in `testCase`'s project, under the same seams as {@link run}. */
async function runMerge(testCase: Case, words: readonly string[]): Promise<CapturedRun> {
  const command = createMergeCommand(BASE_SEAMS);
  return dispatchInProject(['effort', 'merge', ...words], [EFFORT_SUBJECT], [command], testCase.project);
}

describe('rafa effort import', () => {
  it('imports, printing per table the rows added, skipped and in conflict, and the backup name', async () => {
    const testCase = freshCase();
    plantPair(testCase);
    const before = snapshotBoth(testCase);

    const outcome = await run(testCase, [testCase.otherPath]);

    const backup = `${testCase.path}.before-merge-${STAMP}.bak`;
    expect(outcome.exitCode).toBe(0);
    expect(outcome.stdout).toContain(`Merges ${testCase.otherPath} (store ${THERE}) into ${testCase.path}, as merge merge-1.`);
    expect(outcome.stdout).toContain('  findings: 1 added, 1 skipped, 0 in conflict\n');
    expect(outcome.stdout).toContain('Total: 1 added, 1 skipped, 0 in conflict; 0 commit gaps recomputed.');
    expect(outcome.stdout).toContain(`✅ Merged. A copy of the original is kept at ${backup}; renamed back to undo, it takes a new store id on its next write.`);
    expect(existsSync(backup)).toBe(true);
    expect(findingSessions(testCase.path)).toEqual(['session-a1', 'session-b1']);
    // Control for every byte-identical reading below: an import changes this store's directory.
    expect(unchanged(before, snapshotBoth(testCase))).toBe(false);
  });

  it('adds nothing when the same import runs again', async () => {
    const testCase = freshCase();
    plantPair(testCase);
    await run(testCase, [testCase.otherPath]);

    const again = await run(testCase, [testCase.otherPath], { now: () => new Date('2026-09-29T12:05:00.000Z'), newMergeId: () => 'merge-2' });

    expect(again.exitCode).toBe(0);
    expect(again.stdout).toContain('  findings: 0 added, 2 skipped, 0 in conflict\n');
    expect(again.stdout).toContain('Total: 0 added, 2 skipped, 0 in conflict;');
    expect(findingSessions(testCase.path)).toEqual(['session-a1', 'session-b1']);
  });

  it('pulls through the file strategy, handing it the project, its backend, the environment and an absolute file', async () => {
    const testCase = freshCase();
    plantPair(testCase);
    const made: FileSyncOptions[] = [];
    const requests: SyncPullRequest[] = [];
    const env = { RAFA_TEST: '1' };
    const createSync: ImportCommandSeams['createSync'] = (options) => {
      made.push(options);
      const sync = createFileSync(options);
      return {
        ...sync,
        pull: async (request) => {
          requests.push(request);
          return sync.pull(request);
        },
      };
    };

    const outcome = await run(testCase, [join('device-b', 'effort.sqlite'), '--dry-run'], {
      createSync,
      cwd: () => dirname(testCase.project.root),
    }, env);

    expect(outcome.exitCode).toBe(0);
    expect(made).toHaveLength(1);
    expect(made[0]).toMatchObject({ repoRoot: testCase.project.root, backend: 'sqlite', env, identity: INSTALLED });
    expect(requests).toEqual([{ from: testCase.otherPath, dryRun: true }]);
  });

  it('merges into the store RAFA_EFFORT_DIR names, the environment reaching the adapter', async () => {
    const testCase = freshCase();
    plantPair(testCase);
    const copyDir = join(dirname(testCase.otherPath), '..', 'copy-here');
    const copyPath = join(copyDir, 'effort.sqlite');
    plantHere(copyPath);
    const ownBefore = findingSessions(testCase.path);

    const outcome = await run(testCase, [testCase.otherPath], {}, { RAFA_EFFORT_DIR: copyDir });

    expect(outcome.exitCode).toBe(0);
    expect(findingSessions(copyPath)).toEqual(['session-a1', 'session-b1']);
    expect(findingSessions(testCase.path)).toEqual(ownBefore);
  });

  it('merges whatever effort.sync names, reading no strategy', async () => {
    const testCase = freshCase(`${projectConfigText()}effort:\n  sync: git\n`);
    plantPair(testCase);

    const outcome = await run(testCase, [testCase.otherPath]);

    expect(outcome.exitCode).toBe(0);
    expect(findingSessions(testCase.path)).toEqual(['session-a1', 'session-b1']);
  });

  it('prints the lines rafa effort merge prints, its dry run naming this command', async () => {
    const testCase = freshCase();
    plantPair(testCase);

    const imported = await run(testCase, [testCase.otherPath, '--dry-run']);
    const merged = await runMerge(testCase, [testCase.otherPath, '--dry-run']);

    expect(imported.exitCode).toBe(0);
    expect(merged.exitCode).toBe(0);
    expect(imported.stdout).toContain(`Run \`rafa effort import ${testCase.otherPath}\` to swap it in`);
    expect(merged.stdout).toContain(`Run \`rafa effort merge ${testCase.otherPath}\` to swap it in`);
    expect(imported.stdout.replaceAll('rafa effort import', 'rafa effort merge')).toBe(merged.stdout);
  });

  it('leaves both directories byte-identical under --dry-run, printing what it would add', async () => {
    const testCase = freshCase();
    plantPair(testCase);
    const before = snapshotBoth(testCase);

    const outcome = await run(testCase, [testCase.otherPath, '--dry-run']);

    expect(outcome.exitCode).toBe(0);
    expect(outcome.stdout).toContain('  findings: 1 added, 1 skipped, 0 in conflict\n');
    expect(outcome.stdout).toContain('🔍 Dry run: the merged store was built beside it');
    expect(unchanged(before, snapshotBoth(testCase))).toBe(true);
  });

  it('writes the merge as the data of the terminal result in json mode', async () => {
    const testCase = freshCase();
    plantPair(testCase);

    const outcome = await run(testCase, [testCase.otherPath, '--dry-run', '--output=json']);

    const result = eventsOf(outcome.stdout).find((event) => event.type === 'result') as unknown as {
      data: { status: string; rowsAdded: number; otherStore: string; backupPath: string | null };
    };
    expect(outcome.exitCode).toBe(0);
    expect(result.data).toMatchObject({ status: 'would-merge', rowsAdded: 1, otherStore: THERE, backupPath: null });
  });
});

describe('rafa effort import refusals, each leaving both directories byte-identical', () => {
  it('exits 2 on another project\'s store', async () => {
    const testCase = freshCase();
    plantPair(testCase, OTHER_PROJECT);
    const before = snapshotBoth(testCase);

    const outcome = await run(testCase, [testCase.otherPath]);

    expect(outcome.exitCode).toBe(2);
    expect(outcome.stderr).toContain('❌ rafa effort import: ');
    expect(outcome.stderr).toContain(`is the effort store of another project (root commit ${OTHER_PROJECT})`);
    expect(unchanged(before, snapshotBoth(testCase))).toBe(true);
  });

  it('exits 2 on a store: ndjson project, naming the move', async () => {
    const testCase = freshCase(`${projectConfigText()}store: ndjson\n`);
    plantPair(testCase);
    const before = snapshotBoth(testCase);

    const outcome = await run(testCase, [testCase.otherPath]);

    expect(outcome.exitCode).toBe(2);
    expect(outcome.stderr).toContain(`Next safe step: ${MOVE_TO_SQLITE}`);
    expect(unchanged(before, snapshotBoth(testCase))).toBe(true);
  });

  it('exits 1 beside a live loop, and imports as a dry run beside it (control)', async () => {
    const testCase = freshCase();
    plantPair(testCase);
    beginSession(testCase.project.root, {
      sessionId: '11111111-2222-3333-4444-555555555555',
      planStub: 'rafa-323-demo',
      plan: '.rafa/plans/PLAN-rafa-323-demo.md',
      branch: 'feat/rafa-323-demo',
      pid: 424242,
      startedAt: '2026-09-29T09:00:00.000Z',
    }, { isAlive: () => true });
    const alive = { isAlive: (): boolean => true };
    const before = snapshotBoth(testCase);

    const outcome = await run(testCase, [testCase.otherPath], alive);

    expect(outcome.exitCode).toBe(1);
    expect(outcome.stderr).toContain('loop 11111111-2222-3333-4444-555555555555');
    expect(unchanged(before, snapshotBoth(testCase))).toBe(true);
    expect((await run(testCase, [testCase.otherPath, '--dry-run'], alive)).exitCode).toBe(0);
  });

  it('exits 1 when the other file is not there', async () => {
    const testCase = freshCase();
    plantPair(testCase);
    const before = snapshotBoth(testCase);

    const outcome = await run(testCase, [join(dirname(testCase.otherPath), 'absent.sqlite')]);

    expect(outcome.exitCode).toBe(1);
    expect(outcome.stderr).toContain('❌ rafa effort import: ');
    expect(outcome.stderr).toContain('the other store');
    expect(unchanged(before, snapshotBoth(testCase))).toBe(true);
  });

  it('exits 1 on a relative RAFA_EFFORT_DIR before the adapter is made', async () => {
    const testCase = freshCase();
    plantPair(testCase);
    const made: FileSyncOptions[] = [];
    const before = snapshotBoth(testCase);

    const outcome = await run(testCase, [testCase.otherPath], {
      createSync: (options) => {
        made.push(options);
        return createFileSync(options);
      },
    }, { RAFA_EFFORT_DIR: 'relative/effort' });

    expect(outcome.exitCode).toBe(1);
    expect(outcome.stderr).toContain('❌ rafa effort import: effort store: RAFA_EFFORT_DIR is not an absolute path');
    expect(made).toEqual([]);
    expect(unchanged(before, snapshotBoth(testCase))).toBe(true);
  });

  it('exits 1 with the usage when the line names no file, or a value for --dry-run', async () => {
    const testCase = freshCase();
    plantPair(testCase);

    const bare = await run(testCase, []);
    const valued = await run(testCase, [testCase.otherPath, '--dry-run=yes']);

    expect(bare.exitCode).toBe(1);
    expect(bare.stderr).toContain('Usage: rafa effort import <file> [--dry-run]');
    expect(valued.exitCode).toBe(1);
    expect(valued.stderr).toContain('--dry-run takes no value');
  });

  it('refuses a strategy that answers no merge, changing nothing', async () => {
    const testCase = freshCase();
    plantPair(testCase);
    const before = snapshotBoth(testCase);

    const outcome = await run(testCase, [testCase.otherPath], { createSync: () => createLocalSync() });

    expect(outcome.exitCode).not.toBe(0);
    expect(outcome.stderr).toContain('the local strategy answered nothing-to-sync, expected a merge');
    expect(unchanged(before, snapshotBoth(testCase))).toBe(true);
  });
});
