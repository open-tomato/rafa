/**
 * `rafa effort merge` dispatched in planted projects under the temp
 * directory, over this store at `<root>/.rafa/effort/effort.sqlite` and
 * another device's store in a directory of its own. Each case runs as an
 * installed runtime with no live loop and reads no git, unless it says
 * otherwise; `mergeStore`'s own cases (`merge-store.test.ts`) hold the
 * union, the conflicts and the gaps, so these hold what the command adds:
 * the lines it prints, the exit code of each refusal, the file argument
 * and the flag.
 *
 * Every refusal snapshots both directories before and after and finds
 * them byte-identical; the merge case finds this store's directory
 * changed, so a snapshot that could not tell would fail there. The exit
 * code 2 on another project's store has the same planting naming the
 * same project beside it, which merges with 0.
 */
import type { MergeCommandSeams } from './merge.js';
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
import { beginSession } from '../../loop/sessions.js';
import { projectConfigText } from '../../project/scaffold.js';
import { dispatchInProject, eventsOf, plantProject } from '../../tests/cli-capture.js';

import { createMergeCommand } from './merge.js';

const scope = realpathSync(mkdtempSync(join(tmpdir(), 'rafa-effort-merge-')));
afterAll(() => {
  rmSync(scope, { recursive: true, force: true });
});

const NOW = new Date('2026-09-29T12:00:00.000Z');

const STAMP = '20260929T120000Z';

const COLLECTED_AT = '2026-09-29T10:00:00.000Z';

/** An installed runtime, which may swap a merged store in anywhere. */
const INSTALLED: RuntimeIdentity = { kind: 'installed', entry: '/home/u/.rafa/runtime/0.24.1/cli.js' };

/** The subject the command sits under, declared for the registry the test dispatches over. */
const EFFORT_SUBJECT = { name: 'effort', summary: 'the effort store' };

/** Both stores' origins, and the projects their `store_meta` rows name. */
const HERE = 'store-a';
const THERE = 'store-b';
const PROJECT = 'root-commit-1';
const OTHER_PROJECT = 'root-commit-2';

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

/** Plants finding `a1` here, shared there, and `b1` there only; the other store names `otherProject`. */
function plantPair(testCase: Case, otherProject: string = PROJECT): void {
  withStore(testCase.path, (db) => {
    plantMeta(db, testCase.path, HERE, PROJECT);
    plantFinding(db, HERE, 'a1');
  });
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

/** Dispatches `effort merge` with `words` in `testCase`'s project, as an installed runtime reading no git. */
async function run(testCase: Case, words: readonly string[], seams: MergeCommandSeams = {}): Promise<CapturedRun> {
  const command = createMergeCommand({
    now: () => NOW,
    identity: INSTALLED,
    isAlive: () => false,
    newMergeId: () => 'merge-1',
    readProject: () => ({ rootCommit: null, remote: null }),
    ...seams,
  });
  return dispatchInProject(['effort', 'merge', ...words], [EFFORT_SUBJECT], [command], testCase.project);
}

describe('rafa effort merge', () => {
  it('merges, printing per table the rows added, skipped and in conflict, and the backup name', async () => {
    const testCase = freshCase();
    plantPair(testCase);
    const before = snapshotBoth(testCase);

    const outcome = await run(testCase, [testCase.otherPath]);

    const backup = `${testCase.path}.before-merge-${STAMP}.bak`;
    expect(outcome.exitCode).toBe(0);
    expect(outcome.stdout).toContain(`Merges ${testCase.otherPath} (store ${THERE}) into ${testCase.path}, as merge merge-1.`);
    expect(outcome.stdout).toContain('  findings: 1 added, 1 skipped, 0 in conflict\n');
    expect(outcome.stdout).toContain('  sessions: 0 added, 0 skipped, 0 in conflict\n');
    expect(outcome.stdout).toContain('Total: 1 added, 1 skipped, 0 in conflict; 0 commit gaps recomputed.');
    expect(outcome.stdout).toContain(`✅ Merged. The original is kept whole at ${backup}; rename it back to undo.`);
    expect(outcome.stdout).toContain('The merged store keeps the store\'s id; the backup is a copy, so renamed back it'
      + ' takes a new id on its next write.');
    expect(existsSync(backup)).toBe(true);
    expect(findingSessions(testCase.path)).toEqual(['session-a1', 'session-b1']);
    // Control for every byte-identical reading below: a merge changes this store's directory.
    expect(unchanged(before, snapshotBoth(testCase))).toBe(false);
  });

  it('adds nothing when the same merge runs again', async () => {
    const testCase = freshCase();
    plantPair(testCase);
    await run(testCase, [testCase.otherPath]);

    const again = await run(testCase, [testCase.otherPath], { now: () => new Date('2026-09-29T12:05:00.000Z'), newMergeId: () => 'merge-2' });

    expect(again.exitCode).toBe(0);
    expect(again.stdout).toContain('  findings: 0 added, 2 skipped, 0 in conflict\n');
    expect(findingSessions(testCase.path)).toEqual(['session-a1', 'session-b1']);
  });

  it('reads a relative file against the directory the command runs from', async () => {
    const testCase = freshCase();
    plantPair(testCase);

    const outcome = await run(testCase, [join('device-b', 'effort.sqlite')], { cwd: () => dirname(testCase.project.root) });

    expect(outcome.exitCode).toBe(0);
    expect(outcome.stdout).toContain(`Merges ${testCase.otherPath} `);
  });

  it('leaves both directories byte-identical under --dry-run, printing what it would add', async () => {
    const testCase = freshCase();
    plantPair(testCase);
    const before = snapshotBoth(testCase);

    const outcome = await run(testCase, [testCase.otherPath, '--dry-run']);

    expect(outcome.exitCode).toBe(0);
    expect(outcome.stdout).toContain('  findings: 1 added, 1 skipped, 0 in conflict\n');
    expect(outcome.stdout).toContain('🔍 Dry run: the merged store was built beside it');
    expect(outcome.stdout).toContain(`${testCase.path}.before-merge-<stamp>.bak`);
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

describe('rafa effort merge refusals, each leaving both directories byte-identical', () => {
  it('exits 2 on another project\'s store', async () => {
    const testCase = freshCase();
    plantPair(testCase, OTHER_PROJECT);
    const before = snapshotBoth(testCase);

    const outcome = await run(testCase, [testCase.otherPath]);

    expect(outcome.exitCode).toBe(2);
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

  it('exits 1 beside a live loop, and merges as a dry run beside it (control)', async () => {
    const testCase = freshCase();
    plantPair(testCase);
    beginSession(testCase.project.root, {
      sessionId: '11111111-2222-3333-4444-555555555555',
      planStub: 'rafa-322-demo',
      plan: '.rafa/plans/PLAN-rafa-322-demo.md',
      branch: 'feat/rafa-322-demo',
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
    expect(outcome.stderr).toContain('the other store');
    expect(unchanged(before, snapshotBoth(testCase))).toBe(true);
  });

  it('exits 1 with the usage when the line names no file, or a value for --dry-run', async () => {
    const testCase = freshCase();
    plantPair(testCase);

    const bare = await run(testCase, []);
    const valued = await run(testCase, [testCase.otherPath, '--dry-run=yes']);

    expect(bare.exitCode).toBe(1);
    expect(bare.stderr).toContain('Usage: rafa effort merge <file> [--dry-run]');
    expect(valued.exitCode).toBe(1);
    expect(valued.stderr).toContain('--dry-run takes no value');
  });
});
