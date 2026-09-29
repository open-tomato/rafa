/**
 * Two `rafa loop start --as-worktree` runs, over two different plans of
 * the SAME project, spawned at once against the ONE effort store the
 * plan intro promises: "one `.rafa/` and one effort store shared by every
 * loop of a project." Neither `worktree-start-integration.test.ts` (one
 * run) nor `checkout-guard-worktree-integration.test.ts` (one worktree
 * loop beside a second session touching the SAME worktree) proves the
 * ONE thing this file does: that two loops in their own worktrees, on
 * their own branches, under their own plan stubs, write to
 * `<root>/.rafa/effort/effort.sqlite` at the same time without losing or
 * corrupting either run's rows, and that `rafa effort report` rolls both
 * up.
 *
 * `dispatchTask` (`start/dispatch.ts`) always writes the task report
 * under `options.repoRoot`, the project root, whichever checkout the
 * session ran in — never under the worktree it dispatched into. So the
 * sharing this file proves is not a new code path: it is what falls out
 * of every write already going through the one `repoRoot`, and what
 * SQLite's own `busy_timeout` (`effort.busyTimeoutMs`) is for. Two
 * sessions are spawned back to back, with no wait between them, and each
 * stand-in sleeps a moment before answering, so their windows overlap
 * rather than merely interleave by luck.
 *
 * As `worktree-start-integration.test.ts` does, both runs are killed
 * once their worktree holds its task's commit, before either reaches its
 * wrap-up session: nothing here proves the wrap-up's own git traffic (a
 * merge with `origin/<base>`, a push, a `gh pr create`), only that the
 * task dispatch of two concurrent worktree loops lands cleanly in one
 * store.
 */
import type { ScratchRepo } from './cli-capture.js';
import type { EffortReport } from '../effort/report.js';
import type { TaskReportTally } from '../effort/store/reports.js';

import { execFileSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterAll, describe, expect, it } from 'bun:test';

import { CONFIG_DEFAULTS } from '../config-schema.js';
import { sqliteStorePath, withSqliteStore } from '../effort/store/sqlite.js';

import { plantScratchRepo, runRafa } from './cli-capture.js';
import { resultEvent } from './loop-session-fixtures.js';

/** The CLI entry every spawn in this file runs. */
const RAFA_ENTRY = fileURLToPath(new URL('../rafa.ts', import.meta.url));

/** How long the whole case, both background runs included, may take. */
const RUN_TIMEOUT = { timeout: 60_000 };

/** How long either worktree's commit may take to land before this file gives up waiting for it. */
const POLL_TIMEOUT_MS = 45_000;

/** How long the stand-in sleeps per call, so the two runs' sessions overlap rather than race by luck. */
const STAND_IN_DELAY_SECONDS = 1;

const tempBase = realpathSync(mkdtempSync(join(tmpdir(), 'rafa-worktree-shared-store-')));
afterAll(() => {
  rmSync(tempBase, { recursive: true, force: true });
});

/** One of the two plans this file runs at once. */
interface PlantedRun {
  /** The plan's stub, naming its branch `feat/<stub>` and its worktree directory. */
  readonly stub: string;
  /** The plan's one task. */
  readonly task: string;
  /** Where the plan sits, relative to the project root. */
  readonly planRel: string;
}

/**
 * The tracked file the stand-in task session writes, the same relative
 * name for both runs: their sessions run with distinct worktrees as
 * `cwd` (`start/dispatch.ts`), so one relative name lands in two
 * different files and never collides.
 */
const MARKER_FILE = 'shared-store-task-output.txt';

/** The two runs, on distinct stubs, branches and worktrees. */
const RUNS: readonly PlantedRun[] = [
  {
    stub: 'rafa-370-shared-store-a',
    task: 'Write the shared-store probe file A',
    planRel: join('.plans', 'PLAN-rafa-370-shared-store-a.md'),
  },
  {
    stub: 'rafa-370-shared-store-b',
    task: 'Write the shared-store probe file B',
    planRel: join('.plans', 'PLAN-rafa-370-shared-store-b.md'),
  },
];

/** The branch a run's stub names. */
function branchOf(run: PlantedRun): string {
  return `feat/${run.stub}`;
}

/** Runs git in `cwd` under `scratch`'s isolated identity, no gpg signing, and answers its trimmed stdout. */
function git(scratch: ScratchRepo, cwd: string, ...args: string[]): string {
  return execFileSync(
    'git',
    ['-c', 'user.email=loop@example.test', '-c', 'user.name=Rafa Loop', '-c', 'commit.gpgsign=false', ...args],
    {
      cwd,
      encoding: 'utf8',
      stdio: 'pipe',
      env: { ...process.env, HOME: scratch.home, GIT_CONFIG_GLOBAL: join(scratch.home, '.gitconfig'), GIT_CONFIG_NOSYSTEM: '1' },
    },
  ).trim();
}

/** The branch checked out in `cwd`, `scratch`'s repository by default. */
function currentBranch(scratch: ScratchRepo, cwd: string = scratch.repo): string {
  return git(scratch, cwd, 'rev-parse', '--abbrev-ref', 'HEAD');
}

/** How many commits `HEAD` in `cwd` carries. */
function commitCount(scratch: ScratchRepo, cwd: string): number {
  return Number(git(scratch, cwd, 'rev-list', '--count', 'HEAD'));
}

/** Where `--as-worktree` adds a run's worktree, under the default `loop.worktreeDir`. */
function worktreePathFor(scratch: ScratchRepo, run: PlantedRun): string {
  return join(scratch.repo, CONFIG_DEFAULTS.loopWorktreeDir, run.stub);
}

/** A bare repository at `path`, standing in for `origin`, under `scratch`'s isolated identity. */
function initBareOrigin(scratch: ScratchRepo, path: string): void {
  execFileSync('git', ['init', '-q', '--bare', path], {
    stdio: 'pipe',
    env: { ...process.env, HOME: scratch.home, GIT_CONFIG_GLOBAL: join(scratch.home, '.gitconfig'), GIT_CONFIG_NOSYSTEM: '1' },
  });
}

/**
 * Writes a stand-in `claude` into `scratch`'s `bin/`, shared by both
 * runs: it drains its prompt, sleeps {@link STAND_IN_DELAY_SECONDS} so
 * the two runs' sessions overlap, writes {@link MARKER_FILE} — a tracked
 * change `commitTaskWork` finds waiting once the task session returns,
 * landing in whichever worktree the session was dispatched into — logs
 * the call, and answers a `rafa:report` naming the task done, whichever
 * run it was called for. Nothing here runs a real `git`, so neither run
 * reaches its wrap-up's own commit, merge or push; see the module note.
 */
function plantWorktreeClaude(scratch: ScratchRepo): void {
  const claude = join(scratch.bin, 'claude');
  const reportLines = [
    '```rafa:report',
    'status: done',
    'feedback: "the stand-in wrote the shared-store probe file"',
    'findings: []',
    'skills_used: []',
    'blockers: []',
    'out_of_scope_bugs: []',
    '```',
  ];
  writeFileSync(claude, [
    '#!/bin/sh',
    'while read -r _line; do :; done',
    `/bin/sleep ${STAND_IN_DELAY_SECONDS}`,
    `printf 'written by the shared-store task\\n' > '${MARKER_FILE}'`,
    `echo called >> '${scratch.callLog}'`,
    // `cat` is not on the PATH this stand-in runs under when git's own
    // directory holds no coreutils, so the report is printed one line at
    // a time with the shell's own `printf` rather than a `cat` heredoc.
    ...reportLines.map((line) => `printf '%s\\n' '${line}'`),
    'exit 0',
    '',
  ].join('\n'), 'utf8');
  chmodSync(claude, 0o755);
}

/**
 * A scratch project on its initial branch, one commit, a bare `origin`
 * holding that same branch, both plans of {@link RUNS} and the shared
 * stand-in `claude`. `.plans/`, `.rafa/` and `progress.txt` are
 * gitignored, as a real project's are, so nothing either run reads or
 * writes under them ever shows as untracked in `git status`.
 */
function plantSharedStoreScratch(): ScratchRepo {
  const scratch = plantScratchRepo(tempBase);
  const originPath = join(dirname(scratch.repo), 'origin.git');
  initBareOrigin(scratch, originPath);

  writeFileSync(join(scratch.repo, '.gitignore'), '.plans/\n.rafa/\nprogress.txt\n', 'utf8');
  writeFileSync(join(scratch.repo, 'kept.txt'), 'kept\n', 'utf8');
  git(scratch, scratch.repo, 'add', '-A');
  git(scratch, scratch.repo, 'commit', '-q', '--no-verify', '-m', 'seed');

  const base = currentBranch(scratch);
  git(scratch, scratch.repo, 'remote', 'add', 'origin', originPath);
  git(scratch, scratch.repo, 'push', '-q', '-u', 'origin', base);

  mkdirSync(join(scratch.repo, '.plans'));
  for (const run of RUNS) {
    writeFileSync(join(scratch.repo, run.planRel), `# Plan: ${run.stub}\n\n- [ ] ${run.task}\n`, 'utf8');
  }

  plantWorktreeClaude(scratch);
  return scratch;
}

/** Polls `read` every `pollMs` until it answers other than null, or throws past `timeoutMs`. */
async function waitUntil<T>(read: () => T | null, timeoutMs: number, pollMs = 50): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  while (true) {
    const value = read();
    if (value !== null) return value;
    if (Date.now() >= deadline) throw new Error('timed out waiting for a condition to hold');
    await Bun.sleep(pollMs);
  }
}

/**
 * Whether the store under `scratch` holds a `task_reports` row for
 * `run`'s plan stub. Opened through {@link withSqliteStore}, exactly as
 * every reader of this store is, so a concurrent writer's own
 * `bringForward` transaction is waited out through the store's busy
 * timeout rather than read mid-migration.
 */
function hasStoredReport(scratch: ScratchRepo, run: PlantedRun): boolean {
  const path = sqliteStorePath(scratch.repo);
  if (!existsSync(path)) return false;
  return withSqliteStore(path, 'read', false, (db) => {
    const row = db.query<{ found: number }, [string]>(
      'SELECT COUNT(*) AS found FROM task_reports WHERE plan_stub = ?',
    ).get(run.stub);
    return (row?.found ?? 0) > 0;
  });
}

/**
 * Waits until `run`'s task report has landed in the shared store — proof
 * that `storeTaskReport` (`start.ts`), which runs only after
 * `finishCleanExit` has committed the task's change, has completed for
 * this run. The commit itself is therefore already there once every run
 * resolves this wait, which the case's own assertions check directly.
 */
function waitForTaskReport(scratch: ScratchRepo, run: PlantedRun): Promise<true> {
  return waitUntil(() => (hasStoredReport(scratch, run)
    ? true
    : null), POLL_TIMEOUT_MS);
}

/**
 * Spawns `rafa loop start --as-worktree` over `run`'s plan, in the
 * background, its streams ignored. `TMPDIR` is handed on as this suite's
 * own `tmpdir()`, since without it a spawned `bun src/rafa.ts` reads
 * `/tmp` as its own temporary directory (measured: `node:os`'s `tmpdir()`
 * only reads `TMPDIR` from the environment, never the OS default this
 * suite's own process gets from its shell), which would read the scratch
 * store as outside the temporary directory and refuse it as a
 * development build does not own (`store/development-build.ts`).
 */
function spawnLoopStart(scratch: ScratchRepo, run: PlantedRun) {
  const resolved = Bun.which('claude', { PATH: scratch.path });
  if (resolved !== join(scratch.bin, 'claude')) {
    throw new Error(`claude resolves to ${String(resolved)}, not the stand-in`);
  }
  return Bun.spawn(
    [process.execPath, RAFA_ENTRY, 'loop', 'start', `--plan=${run.planRel}`, '--as-worktree', '--no-ci-wait'],
    {
      cwd: scratch.repo,
      env: { PATH: scratch.path, HOME: scratch.home, TMPDIR: tmpdir() },
      stdout: 'ignore',
      stderr: 'ignore',
    },
  );
}

/** The `task_reports` rows the store holds, oldest first. */
function readTaskReportRows(scratch: ScratchRepo): { plan_stub: string | null; outcome: string }[] {
  return withSqliteStore(sqliteStorePath(scratch.repo), 'read', false, (db) => db.query<{ plan_stub: string | null; outcome: string }, []>(
    'SELECT plan_stub, outcome FROM task_reports ORDER BY seq',
  ).all());
}

describe('two rafa loop start --as-worktree runs, spawned at once over one project', () => {
  it('write both task reports to the one shared store, which rafa effort report rolls up together', async () => {
    const scratch = plantSharedStoreScratch();
    const base = currentBranch(scratch);
    const baseHead = git(scratch, scratch.repo, 'rev-parse', 'HEAD');

    // Spawned back to back, with no await between them, so both runs'
    // sessions are in flight over the same store at once.
    const procs = RUNS.map((run) => spawnLoopStart(scratch, run));
    try {
      await Promise.all(RUNS.map((run) => waitForTaskReport(scratch, run)));

      for (const run of RUNS) {
        const worktreePath = worktreePathFor(scratch, run);
        expect(commitCount(scratch, worktreePath)).toBeGreaterThan(1);
        expect(currentBranch(scratch, worktreePath)).toBe(branchOf(run));
        const changedFiles = git(scratch, worktreePath, 'diff-tree', '--no-commit-id', '--name-only', '-r', 'HEAD');
        expect(changedFiles.split('\n')).toContain(MARKER_FILE);
        expect(existsSync(join(worktreePath, MARKER_FILE))).toBe(true);
      }

      // The main checkout: never switched, never behind or ahead of where it started.
      expect(currentBranch(scratch)).toBe(base);
      expect(git(scratch, scratch.repo, 'rev-parse', 'HEAD')).toBe(baseHead);
      expect(git(scratch, scratch.repo, 'status', '--porcelain')).toBe('');

      // Both runs' rows landed in the ONE store under the project root,
      // neither overwriting nor dropping the other's.
      const rows = readTaskReportRows(scratch);
      expect(rows.map((row) => row.plan_stub).sort()).toEqual(RUNS.map((run) => run.stub).sort());
      for (const row of rows) expect(row.outcome).toBe('done');

      // `rafa effort report` reads the same store through its own
      // dispatcher path, and its task-report tallies list both stubs.
      const reportRun = runRafa(scratch, scratch.repo, ['effort', 'report', '--output=json']);
      expect(reportRun.exitCode).toBe(0);
      const answer = resultEvent(reportRun.stdout);
      expect(answer.ok).toBe(true);
      const report = answer.data as EffortReport;
      const tallies: readonly TaskReportTally[] = report.taskReports;
      expect(tallies.map((tally) => tally.planStub).sort()).toEqual(RUNS.map((run) => run.stub).sort());
      for (const tally of tallies) {
        expect(tally.outcome).toBe('done');
        expect(tally.reports).toBe(1);
      }
    } finally {
      for (const proc of procs) proc.kill();
    }
  }, RUN_TIMEOUT);
});
