/**
 * `rafa loop start --as-worktree` spawned end to end over a two-task plan,
 * proving the loop guard (`./checkout-watch.ts`, `./checkout-guard.ts`)
 * halts, and recreates nothing, when the worktree it runs the checkout's
 * git commands and sessions in is removed mid-task.
 *
 * The first task's stand-in session sleeps before it writes its tracked
 * change, the same window `checkout-guard-commits-integration.test.ts` uses
 * to pause the run; here it is used instead to delete the worktree's whole
 * directory while that session still holds it — standing in for someone (or
 * something) removing the worktree from another terminal, or `git worktree
 * remove`, while a task runs inside it. The session goes on to try to write
 * its marker file into a directory that no longer exists and exits
 * nonzero, unaware its checkout is gone; the guard the third checklist item
 * wired in before the task's own commit (`./checkout-watch.ts`, `before:
 * 'commit'`) must catch the missing checkout there: the task marked
 * `[BLOCKED]` on `checkout moved`, the second task never dispatched, the
 * worktree directory never recreated, and the MAIN checkout — the
 * directory `bun src/rafa.ts` was spawned in — never touched.
 *
 * `checkout-guard.test.ts`'s own cases already pin `guardCheckout` reading
 * a missing checkout directly, called over a real repository. What it
 * cannot prove is that a real `loop start --as-worktree` run, with a real
 * session between the removal and the guard's next check, reaches the same
 * halt rather than crashing, hanging, or recreating the worktree on its
 * own — which is what this file spawns the whole command to show.
 * `worktree-start-integration.test.ts` already proves the success path this
 * file's plant is modeled on; it never removes the worktree.
 */
import type { ScratchRepo } from '../tests/cli-capture.js';

import { execFileSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterAll, describe, expect, it } from 'bun:test';

import { CONFIG_DEFAULTS } from '../config-schema.js';
import { readSessions } from '../loop/sessions.js';
import { plantScratchRepo } from '../tests/cli-capture.js';
import { gitIdentityEnv } from '../tests/git-identity.js';
import { scratchHomeEnv } from '../tests/scratch-home-env.js';

import { CHECKOUT_MOVED } from './checkout-guard.js';

/** The CLI entry this file spawns. */
const RAFA_ENTRY = fileURLToPath(new URL('../rafa.ts', import.meta.url));

/** How long the stand-in sleeps per call, in whole seconds: a window to remove the worktree mid-session. */
const STAND_IN_DELAY_SECONDS = 2;

/** How long a case may wait for a condition to hold, or the spawned run to finish. */
const RUN_TIMEOUT = 90_000;

/** The plan's stub, naming the branch `feat/<stub>` and the worktree's directory. */
const STUB = 'checkout-guard-worktree';

/** The branch {@link STUB} names. */
const BRANCH = `feat/${STUB}`;

/** Where the plan sits, relative to the project root. */
const PLAN_REL = join('.plans', `PLAN-${STUB}.md`);

/** The tracker's file name, beside the plan under `.plans/`. */
const TRACKER_NAME = `PLAN_TRACKER-${STUB}.md`;

/** The first task: its worktree is the one removed mid-run. */
const TASK1 = 'Write an edit while the worktree is removed from under the loop';

/** The second task: never dispatched, since the halt on the first task's commit stops the run first. */
const TASK2 = 'Never dispatched: the halt on the first task\'s commit stops the run first';

/** The plan both tasks sit on. */
const PLAN = `# Plan: ${STUB}\n\n- [ ] ${TASK1}\n- [ ] ${TASK2}\n`;

/** The tracked file the stand-in's session writes into the worktree. */
const MARKER_FILE = 'worktree-task-output.txt';

const tempBase = realpathSync(mkdtempSync(join(tmpdir(), 'rafa-checkout-guard-worktree-')));
afterAll(() => {
  rmSync(tempBase, { recursive: true, force: true });
});

/** Runs git in `cwd` under `scratch`'s isolated identity, no gpg signing, and answers its trimmed stdout. */
function git(scratch: ScratchRepo, cwd: string, ...args: string[]): string {
  return execFileSync(
    'git',
    ['-c', 'user.email=loop@example.test', '-c', 'user.name=Rafa Loop', '-c', 'commit.gpgsign=false', ...args],
    {
      cwd,
      encoding: 'utf8',
      stdio: 'pipe',
      env: { ...process.env, HOME: scratch.home, ...gitIdentityEnv(), GIT_CONFIG_GLOBAL: join(scratch.home, '.gitconfig'), GIT_CONFIG_NOSYSTEM: '1' },
    },
  ).trim();
}

/** The branch checked out in `cwd`, `scratch`'s repository by default. */
function currentBranch(scratch: ScratchRepo, cwd: string = scratch.repo): string {
  return git(scratch, cwd, 'rev-parse', '--abbrev-ref', 'HEAD');
}

/** Where `--as-worktree` adds the plan's worktree, under the default `loop.worktreeDir`. */
function worktreePathFor(scratch: ScratchRepo): string {
  return join(scratch.repo, CONFIG_DEFAULTS.loopWorktreeDir, STUB);
}

/** A bare repository at `path`, standing in for `origin`, under `scratch`'s isolated identity. */
function initBareOrigin(scratch: ScratchRepo, path: string): void {
  execFileSync('git', ['init', '-q', '--bare', path], {
    stdio: 'pipe',
    env: { ...process.env, HOME: scratch.home, ...gitIdentityEnv(), GIT_CONFIG_GLOBAL: join(scratch.home, '.gitconfig'), GIT_CONFIG_NOSYSTEM: '1' },
  });
}

/**
 * Where the stand-in logs that it has started, outside the worktree: the
 * session is spawned only after the run record names its task, so removing
 * the worktree before this log appears races the spawn itself.
 */
function startedLogFor(scratch: ScratchRepo): string {
  return `${scratch.callLog}.started`;
}

/**
 * Writes the stand-in `claude` into `scratch`'s `bin/`. It drains its
 * prompt, logs its start to {@link startedLogFor}, sleeps {@link STAND_IN_DELAY_SECONDS} — a window to remove the
 * worktree while it holds the first task's session — then tries to write
 * {@link MARKER_FILE} into its `cwd` (the worktree, once removed no longer
 * there to write into), logs the call regardless, and answers a
 * `rafa:report` naming the task done. A second call (which the halt this
 * file proves must never happen) would append a second `called` line; the
 * call log is what tells the two apart.
 */
function plantWorktreeStandIn(scratch: ScratchRepo): void {
  const claude = join(scratch.bin, 'claude');
  writeFileSync(claude, [
    '#!/bin/sh',
    'while read -r _line; do :; done',
    `echo started >> '${startedLogFor(scratch)}'`,
    `/bin/sleep ${STAND_IN_DELAY_SECONDS}`,
    `printf 'written by the worktree task\\n' > '${MARKER_FILE}' 2>/dev/null`,
    `echo called >> '${scratch.callLog}'`,
    'cat <<\'REPORT_EOF\'',
    '```rafa:report',
    'status: done',
    'feedback: "the stand-in tried to write while the worktree was removed"',
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
 * holding that same branch, the plan at {@link PLAN_REL} and the stand-in
 * `claude`. `.plans/`, `.rafa/` and `progress.txt` are gitignored, as a
 * real project's are.
 */
function plant(): ScratchRepo {
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
  writeFileSync(join(scratch.repo, '.plans', `PLAN-${STUB}.md`), PLAN, 'utf8');

  plantWorktreeStandIn(scratch);
  return scratch;
}

/** Spawns `rafa loop start --as-worktree` over the planted plan, in the background, its streams ignored. */
function spawnLoopStart(scratch: ScratchRepo) {
  const resolved = Bun.which('claude', { PATH: scratch.path });
  if (resolved !== join(scratch.bin, 'claude')) {
    throw new Error(`claude resolves to ${String(resolved)}, not the stand-in`);
  }
  return Bun.spawn(
    [process.execPath, RAFA_ENTRY, 'loop', 'start', `--plan=${PLAN_REL}`, '--as-worktree', '--no-ci-wait', '--inject=full'],
    {
      cwd: scratch.repo,
      env: { RAFA_TEST: '1', TMPDIR: tmpdir(), PATH: scratch.path, ...scratchHomeEnv(scratch.home) },
      stdout: 'ignore',
      stderr: 'ignore',
    },
  );
}

/** Polls `read` every `pollMs` until it answers other than null, or throws past `timeoutMs`. */
async function waitUntil<T>(read: () => T | null, timeoutMs: number, pollMs = 25): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  while (true) {
    const value = read();
    if (value !== null) return value;
    if (Date.now() >= deadline) throw new Error('timed out waiting for a condition to hold');
    await Bun.sleep(pollMs);
  }
}

/** Waits until `repo`'s sole session names `text` as its running task. */
function waitForTask(repo: string, text: string): Promise<true> {
  return waitUntil(() => {
    const sessions = readSessions(repo);
    return sessions.length === 1 && sessions[0]?.task?.text === text
      ? true
      : null;
  }, RUN_TIMEOUT);
}

/** Waits until `repo`'s sole session reads `stopped`, the run having ended. */
function waitForStopped(repo: string): Promise<true> {
  return waitUntil(() => {
    const sessions = readSessions(repo);
    return sessions.length === 1 && sessions[0]?.state === 'stopped'
      ? true
      : null;
  }, RUN_TIMEOUT);
}

describe('the loop guard replaying a removed worktree in a real --as-worktree run', () => {
  it('halts the first task at its commit when its worktree directory is removed mid-task, recreating nothing', async () => {
    const scratch = plant();
    const base = currentBranch(scratch);
    const baseHead = git(scratch, scratch.repo, 'rev-parse', 'HEAD');
    const worktreePath = worktreePathFor(scratch);

    const proc = spawnLoopStart(scratch);
    try {
      // The first task dispatches and its stand-in session starts, about to
      // sleep; wait for that session's start log, then remove the worktree
      // whole while the session holds it — standing in for the worktree
      // being torn down from under a running task. Removing it on the run
      // record alone races the session's spawn into the worktree.
      await waitForTask(scratch.repo, TASK1);
      await waitUntil(() => (existsSync(join(worktreePath, '.git'))
        ? true
        : null), RUN_TIMEOUT);
      await waitUntil(() => (existsSync(startedLogFor(scratch))
        ? true
        : null), RUN_TIMEOUT);
      rmSync(worktreePath, { recursive: true, force: true });
      expect(existsSync(worktreePath)).toBe(false);

      await waitForStopped(scratch.repo);
      expect(await proc.exited).toBe(0);

      // The session ran and logged its call before its write into the now
      // gone worktree failed; the guard is what caught the checkout
      // missing, ahead of `commitTaskWork`.
      expect(readFileSync(scratch.callLog, 'utf8')).toBe('called\n');

      const trackerPath = join(scratch.repo, '.plans', TRACKER_NAME);
      const tracker = readFileSync(trackerPath, 'utf8');
      expect(tracker).toContain(`- [BLOCKED] ${TASK1}  <!-- blocked: ${CHECKOUT_MOVED} -->`);
      expect(tracker).toContain(`- [ ] ${TASK2}`);

      // Nothing was recreated: the guard names a restore line but never
      // runs it, so the worktree directory stays gone.
      expect(existsSync(worktreePath)).toBe(false);
      expect(existsSync(join(scratch.repo, CONFIG_DEFAULTS.loopWorktreeDir, STUB, MARKER_FILE))).toBe(false);

      // The MAIN checkout — where `bun src/rafa.ts` was spawned — is left
      // exactly as it started: same branch, same HEAD, nothing untracked.
      expect(currentBranch(scratch)).toBe(base);
      expect(git(scratch, scratch.repo, 'rev-parse', 'HEAD')).toBe(baseHead);
      expect(git(scratch, scratch.repo, 'status', '--porcelain')).toBe('');

      // `feat/<stub>` never gained the task's commit either: the branch
      // the removed worktree held stays exactly at the seed it started
      // from, wherever the branch ref still points.
      const branchTip = git(scratch, scratch.repo, 'rev-parse', '--verify', '--quiet', `refs/heads/${BRANCH}`);
      if (branchTip !== '') expect(branchTip).toBe(baseHead);
    } finally {
      proc.kill();
    }
  }, RUN_TIMEOUT);
});
