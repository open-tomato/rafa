/**
 * `rafa loop start --as-worktree` started a second time over the worktree
 * a stopped run left, spawned as `bun src/rafa.ts loop start` through a
 * real git repository with a bare `origin`.
 *
 * `src/start/worktree.test.ts` pins `addRunWorktree`'s reuse over porcelain
 * listings, and `worktree-start-integration.test.ts` runs a FIRST start to
 * a real task commit. Neither proves the whole command, run again over
 * what the first one left: that the second start adds no entry to `git
 * worktree list`, and that the tracker's first unticked task is the one
 * its session runs, with the worktree as its working directory.
 *
 * The first run is stopped by its own stand-in `claude`: it commits task
 * one's file, then fails the second session while no release file is
 * planted, which marks task two `[BLOCKED]` and ends the run with the
 * worktree on `feat/<stub>` and the tracker's first unticked line being
 * task two. The release file is then planted and the loop started again;
 * it is killed once task two's commit lands, before the wrap-up that
 * follows would add git traffic this file proves nothing with, as
 * `worktree-start-integration.test.ts` does.
 *
 * The refusals are the other half: a start over a worktree path that
 * holds another branch, and one whose `feat/<stub>` is checked out at
 * another path. Each is spawned with a `git` stand-in first on the PATH
 * that logs every call before running the real one, so the case reads
 * from the log that no `git worktree add` ran, and from the main
 * checkout that its branch, HEAD and working tree were left alone.
 */
import type { ScratchRepo } from './cli-capture.js';

import { execFileSync } from 'node:child_process';
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterAll, describe, expect, it } from 'bun:test';

import { CONFIG_DEFAULTS } from '../config-schema.js';

import { describeRun, expectExit, plantScratchRepo, runRafa } from './cli-capture.js';
import { gitIdentityEnv } from './git-identity.js';
import { scratchHomeEnv } from './scratch-home-env.js';
import { hostGitDir } from './stand-in-gh.js';

/** The CLI entry the second start spawns. */
const RAFA_ENTRY = fileURLToPath(new URL('../rafa.ts', import.meta.url));

/** How long the whole case, both runs included, may take. */
const RUN_TIMEOUT = { timeout: 90_000 };

/** How long task two's commit may take to land before this file gives up waiting for it. */
const POLL_TIMEOUT_MS = 45_000;

const tempBase = realpathSync(mkdtempSync(join(tmpdir(), 'rafa-worktree-restart-')));
afterAll(() => {
  rmSync(tempBase, { recursive: true, force: true });
});

/** The plan's stub, naming the branch `feat/<stub>` and the worktree's directory. */
const STUB = 'rafa-579-restart-probe';

/** The branch {@link STUB} names. */
const BRANCH = `feat/${STUB}`;

/** The plan's first task, which the first run completes. */
const FIRST_TASK = 'Write the first probe file';

/** The plan's second task, which the first run fails and the second run completes. */
const SECOND_TASK = 'Write the second probe file';

/** The plan, two tasks. */
const PLAN = `# Plan: ${STUB}\n\n- [ ] ${FIRST_TASK}\n- [ ] ${SECOND_TASK}\n`;

/** Where the plan sits, relative to the project root. */
const PLAN_REL = join('.plans', `PLAN-${STUB}.md`);

/** The tracker the run derives from the plan, relative to the project root. */
const TRACKER_REL = join('.plans', `PLAN_TRACKER-${STUB}.md`);

/** The flags both starts run under. */
const START_ARGS = ['loop', 'start', `--plan=${PLAN_REL}`, '--as-worktree', '--no-ci-wait'];

/** Runs git in `cwd` under `scratch`'s isolated identity, no gpg signing, and answers its trimmed stdout. */
function git(scratch: ScratchRepo, cwd: string, ...args: string[]): string {
  return execFileSync(
    'git',
    ['-c', 'user.email=loop@example.test', '-c', 'user.name=Rafa Loop', '-c', 'commit.gpgsign=false', ...args],
    {
      cwd,
      encoding: 'utf8',
      stdio: 'pipe',
      env: { ...process.env, HOME: scratch.home, GIT_CONFIG_GLOBAL: join(scratch.home, '.gitconfig'), GIT_CONFIG_NOSYSTEM: '1', ...gitIdentityEnv() },
    },
  ).trim();
}

/** The paths `git worktree list --porcelain` lists, main checkout first. */
function worktreePaths(scratch: ScratchRepo): string[] {
  return git(scratch, scratch.repo, 'worktree', 'list', '--porcelain')
    .split('\n')
    .filter((line) => line.startsWith('worktree '))
    .map((line) => line.slice('worktree '.length));
}

/** How many commits `HEAD` in `cwd` carries. */
function commitCount(scratch: ScratchRepo, cwd: string): number {
  return Number(git(scratch, cwd, 'rev-list', '--count', 'HEAD'));
}

/** Where `--as-worktree` adds the plan's worktree, under the default `loop.worktreeDir`. */
function worktreePathFor(scratch: ScratchRepo): string {
  return join(scratch.repo, CONFIG_DEFAULTS.loopWorktreeDir, STUB);
}

/** The file whose presence lets the stand-in's second session succeed. */
function releaseFileFor(scratch: ScratchRepo): string {
  return join(scratch.home, 'release');
}

/**
 * Writes a stand-in `claude` into `scratch`'s `bin/`: it drains its
 * prompt and logs its working directory. Its first session writes
 * `probe-1.txt` and answers a `rafa:report` naming the task done. Any
 * later one fails with exit 1 until the release file exists, and then
 * writes `probe-<n>.txt` for the n-th probe, `n` counted from the files
 * already in its working directory, so the file a session leaves says
 * which directory it ran in and which task it was.
 */
function plantRestartClaude(scratch: ScratchRepo): void {
  const claude = join(scratch.bin, 'claude');
  writeFileSync(claude, [
    '#!/bin/sh',
    'while read -r _line; do :; done',
    `echo "called $PWD" >> '${scratch.callLog}'`,
    'count=$(ls probe-*.txt 2>/dev/null | wc -l)',
    `if [ "$count" -gt 0 ] && [ ! -e '${releaseFileFor(scratch)}' ]; then exit 1; fi`,
    'next=$((count + 1))',
    'printf \'written by the restart probe\\n\' > "probe-$next.txt"',
    'cat <<\'REPORT_EOF\'',
    '```rafa:report',
    'status: done',
    'feedback: "the stand-in wrote a probe file"',
    'findings: []',
    'skills_used: []',
    'blockers: []',
    'out_of_scope_bugs: []',
    '```',
    'REPORT_EOF',
    'exit 0',
    '',
  ].join('\n'), 'utf8');
  chmodSync(claude, 0o755);
}

/**
 * A scratch project on its initial branch, one commit, a bare `origin`
 * holding that same branch, the two-task plan at {@link PLAN_REL} and the
 * stand-in `claude`. `.plans/`, `.rafa/` and `progress.txt` are
 * gitignored, as a real project's are.
 */
function plantRestartScratch(): ScratchRepo {
  const scratch = plantScratchRepo(tempBase);
  const originPath = join(dirname(scratch.repo), 'origin.git');
  execFileSync('git', ['init', '-q', '--bare', originPath], {
    stdio: 'pipe',
    env: { ...process.env, HOME: scratch.home, GIT_CONFIG_GLOBAL: join(scratch.home, '.gitconfig'), GIT_CONFIG_NOSYSTEM: '1', ...gitIdentityEnv() },
  });

  git(scratch, scratch.repo, 'config', 'user.name', 'Rafa Loop');
  git(scratch, scratch.repo, 'config', 'user.email', 'loop@example.test');
  git(scratch, scratch.repo, 'config', 'commit.gpgsign', 'false');
  writeFileSync(join(scratch.repo, '.gitignore'), '.plans/\n.rafa/\nprogress.txt\n', 'utf8');
  writeFileSync(join(scratch.repo, 'kept.txt'), 'kept\n', 'utf8');
  git(scratch, scratch.repo, 'add', '-A');
  git(scratch, scratch.repo, 'commit', '-q', '--no-verify', '-m', 'seed');

  const base = git(scratch, scratch.repo, 'rev-parse', '--abbrev-ref', 'HEAD');
  git(scratch, scratch.repo, 'remote', 'add', 'origin', originPath);
  git(scratch, scratch.repo, 'push', '-q', '-u', 'origin', base);

  mkdirSync(join(scratch.repo, '.plans'));
  writeFileSync(join(scratch.repo, PLAN_REL), PLAN, 'utf8');

  plantRestartClaude(scratch);
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

/** The tracker's task lines, as written. */
function trackerTaskLines(scratch: ScratchRepo): string[] {
  return readFileSync(join(scratch.repo, TRACKER_REL), 'utf8')
    .split('\n')
    .filter((line) => line.startsWith('- ['));
}

/** The directories the stand-in logged a session in, one per call. */
function calledIn(scratch: ScratchRepo): string[] {
  return readFileSync(scratch.callLog, 'utf8')
    .split('\n')
    .filter((line) => line.startsWith('called '))
    .map((line) => line.slice('called '.length));
}

/** Spawns the second `rafa loop start --as-worktree` in the background, its streams ignored. */
function spawnSecondStart(scratch: ScratchRepo) {
  return Bun.spawn([process.execPath, RAFA_ENTRY, ...START_ARGS], {
    cwd: scratch.repo,
    env: { RAFA_TEST: '1', TMPDIR: tmpdir(), PATH: scratch.path, ...scratchHomeEnv(scratch.home) },
    stdout: 'ignore',
    stderr: 'ignore',
  });
}

/** The file the `git` stand-in appends each call's arguments to, one line per call. */
function gitLogFor(scratch: ScratchRepo): string {
  return join(scratch.home, 'git-calls.log');
}

/**
 * Writes a `git` stand-in into `scratch`'s `bin/`, first on the PATH: it
 * logs its arguments, then runs the host's git with them unchanged.
 */
function plantGitRecorder(scratch: ScratchRepo): void {
  const recorder = join(scratch.bin, 'git');
  writeFileSync(recorder, [
    '#!/bin/sh',
    `echo "$*" >> '${gitLogFor(scratch)}'`,
    `exec '${join(hostGitDir(), 'git')}' "$@"`,
    '',
  ].join('\n'), 'utf8');
  chmodSync(recorder, 0o755);
}

/** The git calls the recorder logged, one entry per call; none when git never ran. */
function gitCalls(scratch: ScratchRepo): string[] {
  const log = gitLogFor(scratch);
  return existsSync(log)
    ? readFileSync(log, 'utf8').split('\n')
      .filter((line) => line !== '')
    : [];
}

/** Whether a logged git call is a `git worktree add`, whatever global options precede it. */
function isWorktreeAdd(call: string): boolean {
  return /(^|\s)worktree add(\s|$)/.test(call);
}

/** Leaves the main checkout with an edited tracked file and an untracked one, so "untouched" has something to keep. */
function dirtyMainCheckout(scratch: ScratchRepo): void {
  writeFileSync(join(scratch.repo, 'kept.txt'), 'edited by hand\n', 'utf8');
  writeFileSync(join(scratch.repo, 'untracked.txt'), 'not committed\n', 'utf8');
}

/** What the main checkout holds that a refused start must leave as it is. */
function mainCheckoutState(scratch: ScratchRepo) {
  return {
    branch: git(scratch, scratch.repo, 'rev-parse', '--abbrev-ref', 'HEAD'),
    head: git(scratch, scratch.repo, 'rev-parse', 'HEAD'),
    status: git(scratch, scratch.repo, 'status', '--short'),
    kept: readFileSync(join(scratch.repo, 'kept.txt'), 'utf8'),
    untracked: existsSync(join(scratch.repo, 'untracked.txt')),
  };
}

/**
 * Runs the start over `scratch` and asserts it refused: exit 1, the
 * refusal text, no session, no `git worktree add`, and the main checkout
 * as `before` read it.
 */
function expectRefusedUntouched(
  scratch: ScratchRepo,
  before: ReturnType<typeof mainCheckoutState>,
  refusal: string,
): void {
  const run = runRafa(scratch, scratch.repo, START_ARGS);
  const output = `${run.stdout}${run.stderr}`;

  expectExit(run, 1, scratch);
  expect(output).toContain(refusal);
  expect(output).toContain('The main checkout\'s branch and working tree were not touched.');
  expect(existsSync(scratch.callLog)).toBe(false);
  const calls = gitCalls(scratch);
  expect(calls.some((call) => call.includes('worktree list'))).toBe(true);
  expect(calls.filter(isWorktreeAdd)).toEqual([]);
  expect(mainCheckoutState(scratch)).toEqual(before);
}

describe('rafa loop start --as-worktree, refused over a worktree it cannot reuse', () => {
  it('refuses a worktree path that holds another branch, adding nothing', () => {
    const scratch = plantRestartScratch();
    const worktreePath = worktreePathFor(scratch);
    git(scratch, scratch.repo, 'worktree', 'add', '-q', '-b', 'feat/someone-elses', worktreePath);
    plantGitRecorder(scratch);
    dirtyMainCheckout(scratch);
    const listingBefore = worktreePaths(scratch);
    const before = mainCheckoutState(scratch);

    expectRefusedUntouched(
      scratch,
      before,
      `Refusing to reuse the worktree at ${worktreePath} for ${BRANCH}: it holds feat/someone-elses.`,
    );

    expect(worktreePaths(scratch)).toEqual(listingBefore);
    expect(git(scratch, worktreePath, 'rev-parse', '--abbrev-ref', 'HEAD')).toBe('feat/someone-elses');
    expect(git(scratch, scratch.repo, 'branch', '--list', BRANCH)).toBe('');
  }, RUN_TIMEOUT);

  it('refuses a run whose feat/<stub> is checked out at another path, adding nothing', () => {
    const scratch = plantRestartScratch();
    const elsewhere = join(dirname(scratch.repo), 'elsewhere');
    git(scratch, scratch.repo, 'worktree', 'add', '-q', '-b', BRANCH, elsewhere);
    plantGitRecorder(scratch);
    dirtyMainCheckout(scratch);
    const listingBefore = worktreePaths(scratch);
    const before = mainCheckoutState(scratch);

    expectRefusedUntouched(
      scratch,
      before,
      `Refusing to add a worktree for ${BRANCH}: it is checked out in another worktree at ${elsewhere}.`,
    );

    expect(worktreePaths(scratch)).toEqual(listingBefore);
    expect(existsSync(worktreePathFor(scratch))).toBe(false);
    expect(git(scratch, elsewhere, 'rev-parse', '--abbrev-ref', 'HEAD')).toBe(BRANCH);
  }, RUN_TIMEOUT);
});

describe('rafa loop start --as-worktree, started again over a stopped run\'s worktree', () => {
  it('adds no worktree and runs the tracker\'s first unticked task in the one already there', async () => {
    const scratch = plantRestartScratch();
    const worktreePath = worktreePathFor(scratch);

    const first = runRafa(scratch, scratch.repo, START_ARGS);
    expect(`${first.stdout}${first.stderr}`, describeRun(first, scratch)).toContain('Task failed (exit 1). Marked as blocked.');
    expect(existsSync(join(worktreePath, 'probe-1.txt'))).toBe(true);
    expect(trackerTaskLines(scratch)[0]).toStartWith('- [x] ');
    expect(trackerTaskLines(scratch)[1]).not.toStartWith('- [x] ');
    expect(trackerTaskLines(scratch)[1]).toContain(SECOND_TASK);
    expect(calledIn(scratch)).toEqual([worktreePath, worktreePath]);

    const listingBefore = worktreePaths(scratch);
    expect(listingBefore).toEqual([scratch.repo, worktreePath]);
    const commitsBefore = commitCount(scratch, worktreePath);
    writeFileSync(releaseFileFor(scratch), 'release\n', 'utf8');

    const proc = spawnSecondStart(scratch);
    try {
      await waitUntil(() => commitCount(scratch, worktreePath) > commitsBefore
        ? true
        : null, POLL_TIMEOUT_MS);

      expect(worktreePaths(scratch)).toEqual(listingBefore);
      expect(git(scratch, worktreePath, 'rev-parse', '--abbrev-ref', 'HEAD')).toBe(BRANCH);
      expect(calledIn(scratch)[2]).toBe(worktreePath);
      expect(existsSync(join(worktreePath, 'probe-2.txt'))).toBe(true);
      const changedFiles = git(scratch, worktreePath, 'diff-tree', '--no-commit-id', '--name-only', '-r', 'HEAD');
      expect(changedFiles.split('\n')).toContain('probe-2.txt');
      expect(existsSync(join(scratch.repo, 'probe-2.txt'))).toBe(false);
      expect(trackerTaskLines(scratch).slice(0, 2)).toEqual([
        `- [x] ${FIRST_TASK}`,
        `- [x] ${SECOND_TASK}`,
      ]);
    } finally {
      proc.kill();
    }
  }, RUN_TIMEOUT);
});
